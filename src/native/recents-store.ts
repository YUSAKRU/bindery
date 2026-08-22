import { Preferences } from '@capacitor/preferences';

export interface RecentEntry {
  uri: string | null;
  name: string;
  lastPage: number;
  openedAt: number;
}

const STORAGE_KEY = 'bindery.recents.v1';
const MAX_ENTRIES = 8;

/**
 * Stable identity for a recent entry: uri when known, name as a fallback —
 * namespaced so a uri can never collide with a name. Derived on the fly
 * (never persisted), so entries written by older versions of this store —
 * which only ever had `uri`/`name` fields — resolve to a correct identity
 * with no migration step.
 */
function entryId(e: { uri: string | null; name: string }): string {
  return e.uri !== null ? `uri:${e.uri}` : `name:${e.name}`;
}

async function readAll(): Promise<RecentEntry[]> {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: RecentEntry[]): Promise<void> {
  await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(entries) });
}

// recordOpened/updateLastPage/removeRecent are all read-modify-write cycles
// over the same Preferences key; chaining them onto one promise queue makes
// overlapping calls run one after another instead of racing and losing a
// write.
let queue: Promise<void> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function getRecents(): Promise<RecentEntry[]> {
  return readAll();
}

/** Adds/moves an entry to the front, deduped by identity (uri, falling back to name), capped at `MAX_ENTRIES`. */
export async function recordOpened(entry: { uri: string | null; name: string }): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    const id = entryId(entry);
    const existing = entries.find((e) => entryId(e) === id);
    const next: RecentEntry = { uri: entry.uri, name: entry.name, lastPage: existing?.lastPage ?? 1, openedAt: Date.now() };
    const filtered = entries.filter((e) => entryId(e) !== id);
    filtered.unshift(next);
    await writeAll(filtered.slice(0, MAX_ENTRIES));
  });
}

export async function updateLastPage(identity: { uri: string | null; name: string }, page: number): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    const id = entryId(identity);
    const target = entries.find((e) => entryId(e) === id);
    if (!target) return;
    target.lastPage = page;
    await writeAll(entries);
  });
}

export async function removeRecent(identity: { uri: string | null; name: string }): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    const id = entryId(identity);
    await writeAll(entries.filter((e) => entryId(e) !== id));
  });
}
