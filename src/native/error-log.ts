import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';

/**
 * A local-only record of things that went wrong, kept on the device and shown
 * under Settings. Nothing is ever sent anywhere: the only way an entry leaves
 * the device is the user tapping share.
 *
 * It exists because the app is a WebView with no analytics by choice, so a JS
 * failure produces no native crash and Play Console vitals never see it. Without
 * this, a production break has no signal at all.
 *
 * Storage mirrors `recents-store.ts` — one Preferences key, a size cap, and a
 * promise queue so overlapping writes don't lose each other.
 */

export type ErrorKind = 'caught' | 'uncaught' | 'rejection' | 'abnormal-exit';

export interface ErrorEntry {
  at: number;
  kind: ErrorKind;
  /** Present when the failure carried one; looked up as `error.<code>` for a localized summary. */
  code?: string;
  /**
   * Substitutions for the `code` translation. Stored because those strings
   * carry placeholders — without these the summary renders a literal
   * `{message}` instead of the sentence the user was actually shown.
   */
  params?: Record<string, string | number>;
  /** English, developer-facing — the readable fallback, never the primary UI text when `code` exists. */
  message: string;
  stack?: string;
  /** Screen id the app was on, as recorded by `setErrorScreen`. */
  screen?: string;
  appVersion: string;
}

const STORAGE_KEY = 'bindery.errors.v1';
/** Written by BinderyCrashListener.java (native), drained here on the next launch. */
const CRASH_KEY = 'bindery.lastCrash.v1';
/**
 * Written here, read only by BinderyCrashListener.java: at crash time it is the
 * one place native code can find out where the user was.
 */
const SCREEN_KEY = 'bindery.lastScreen.v1';

const MAX_ENTRIES = 20;
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 2000;
/**
 * Android loads the whole SharedPreferences file into memory at process start,
 * so an entry cap alone is not enough — one pathological stack could still
 * bloat the file. The byte ceiling is the backstop.
 */
const MAX_TOTAL_BYTES = 65536;

/**
 * Resolved once, in the background. Reading it is synchronous so `recordError`
 * never has to await — an unresolved version is recorded as 'unknown' rather
 * than delaying (or dropping) the entry.
 */
let appVersion = 'unknown';
void App.getInfo()
  .then((info) => {
    appVersion = info.version;
  })
  .catch(() => {});

/** Kept in memory as well as in storage so `recordError` can stamp it without awaiting. */
let currentScreen = '';

// Same reason as recents-store: every write is a read-modify-write over one
// key, so they have to run one after another instead of racing.
let queue: Promise<void> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function readAll(): Promise<ErrorEntry[]> {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

/** Applies both caps — newest-first, so the oldest entries fall off the end. */
async function writeAll(entries: ErrorEntry[]): Promise<void> {
  let capped = entries.slice(0, MAX_ENTRIES);
  let value = JSON.stringify(capped);
  while (capped.length > 1 && byteLength(value) > MAX_TOTAL_BYTES) {
    capped = capped.slice(0, -1);
    value = JSON.stringify(capped);
  }
  await Preferences.set({ key: STORAGE_KEY, value });
}

/** Pulls what a thrown value can tell us. `code` is how BookletError identifies itself. */
function describeError(error: unknown): Pick<ErrorEntry, 'message' | 'stack' | 'code' | 'params'> {
  const coded = error as { code?: unknown; stack?: unknown; params?: unknown };
  const raw = error instanceof Error ? error.message : String(error);
  const described: Pick<ErrorEntry, 'message' | 'stack' | 'code' | 'params'> = {
    message: truncate(raw, MAX_MESSAGE_CHARS),
  };
  if (typeof coded.stack === 'string') {
    described.stack = truncate(coded.stack, MAX_STACK_CHARS);
  }
  if (typeof coded.code === 'string') {
    described.code = coded.code;
    if (coded.params && typeof coded.params === 'object') {
      described.params = coded.params as Record<string, string | number>;
    }
  }
  return described;
}

function append(entry: ErrorEntry): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    entries.unshift(entry);
    await writeAll(entries);
  });
}

/**
 * Records a failure. Fire-and-forget by design.
 *
 * This must never throw and never leave an unhandled rejection: it is called
 * from `errorText()`, which is called from catch blocks. A failure raised in
 * here would be a failure raised inside the app's own error handling, which is
 * how you get a loop.
 */
export function recordError(kind: ErrorKind, error: unknown): void {
  try {
    const entry: ErrorEntry = {
      at: Date.now(),
      kind,
      ...describeError(error),
      appVersion,
    };
    if (currentScreen) entry.screen = currentScreen;
    void append(entry).catch(() => {});
  } catch {
    // Deliberately silent — see the contract above.
  }
}

/**
 * Newest first. Goes through the queue rather than reading directly, so a
 * record still in flight is included instead of being read past.
 */
export async function getErrors(): Promise<ErrorEntry[]> {
  return enqueue(readAll);
}

export async function clearErrors(): Promise<void> {
  return enqueue(async () => {
    await Preferences.remove({ key: STORAGE_KEY });
  });
}

/** Records the current screen so a later failure — including a native crash — can name it. */
export function setErrorScreen(screen: string): void {
  currentScreen = screen;
  try {
    void Preferences.set({ key: SCREEN_KEY, value: screen }).catch(() => {});
  } catch {
    // Screen context is a nice-to-have; never let it surface.
  }
}

/**
 * Converts a marker left by the native crash listener into a normal entry.
 *
 * The renderer process is dead by the time `onRenderProcessGone` fires, so no
 * JS can run then — Java writes a minimal marker and all the policy (caps,
 * rotation, shape) stays here, in one place, rather than being duplicated in
 * two languages.
 *
 * Called once at startup. Safe to call again: the marker is removed before the
 * entry is written, so a failure loses one crash rather than reporting the same
 * one on every launch forever.
 */
export async function drainCrashMarker(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: CRASH_KEY });
    if (!value) return;
    await Preferences.remove({ key: CRASH_KEY });

    let at = Date.now();
    let didCrash: boolean | undefined;
    let screen: string | undefined;
    try {
      const parsed = JSON.parse(value) as { at?: unknown; didCrash?: unknown; screen?: unknown };
      if (typeof parsed.at === 'number') at = parsed.at;
      if (typeof parsed.didCrash === 'boolean') didCrash = parsed.didCrash;
      // Captured by the native listener at crash time. Reading SCREEN_KEY here
      // instead would report the screen this launch has already routed to —
      // initApp() runs to completion, showScreen() and all, while this function
      // is still waiting on its first bridge call.
      if (typeof parsed.screen === 'string') screen = parsed.screen;
    } catch {
      // A malformed marker still means the app died; keep the entry.
    }

    // didCrash is unavailable below API 26, so the cause is reported as unknown
    // rather than guessed at.
    const code =
      didCrash === undefined
        ? 'ABNORMAL_EXIT_UNKNOWN'
        : didCrash
          ? 'ABNORMAL_EXIT_CRASH'
          : 'ABNORMAL_EXIT_RECLAIMED';
    const message =
      didCrash === undefined
        ? 'The app closed unexpectedly (cause unavailable on this Android version).'
        : didCrash
          ? 'The WebView renderer process crashed.'
          : 'The system reclaimed the WebView renderer, most likely under memory pressure.';

    const entry: ErrorEntry = {
      at,
      kind: 'abnormal-exit',
      code,
      message,
      // The version of the run that died. Only wrong if the app was updated
      // between that crash and this launch, which also makes it unreportable.
      appVersion,
    };
    if (screen) entry.screen = screen;
    await append(entry);
  } catch {
    // Startup must not fail because of the error log.
  }
}
