import { Preferences } from '@capacitor/preferences';

export { fingerprintPdf, FINGERPRINT_EDGE_BYTES } from './fingerprint';

export interface RecentEntry {
  uri: string | null;
  name: string;
  lastPage: number;
  openedAt: number;
  /**
   * Content fingerprint (`fingerprintPdf`), when the bytes were at hand as the
   * entry was recorded. Android hands out a different content:// uri for one
   * file depending on the provider it was picked through; the fingerprint is
   * what lets those collapse into one desk entry. Absent on entries written
   * before it existed — those are matched by identity only.
   */
  fp?: string;
  /**
   * The file carried the booklet engine's imposed mark when last opened
   * (`hasImposedKeyword`). Absent when unknown: entries from before the mark,
   * or recorded without reading the document.
   */
  imposed?: boolean;
}

/** Same file: same identity, or — when both carry one — the same fingerprint. */
function sameFile(a: { uri: string | null; name: string; fp?: string }, b: { uri: string | null; name: string; fp?: string }): boolean {
  if (entryId(a) === entryId(b)) return true;
  return Boolean(a.fp && b.fp && a.fp === b.fp);
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

/**
 * Adds/moves an entry to the front, capped at `MAX_ENTRIES`. Deduped by
 * identity (uri, falling back to name) and, when both sides carry one, by
 * content fingerprint — so one file reached through two uris stays one entry,
 * under the newest uri. Never by name alone: two files may share a name.
 */
export async function recordOpened(entry: {
  uri: string | null;
  name: string;
  fp?: string;
  imposed?: boolean;
}): Promise<RecentEntry> {
  return enqueue(async () => {
    const entries = await readAll();
    const id = entryId(entry);
    // Same identity is the same document unless the fingerprints disagree —
    // then the file at this uri was replaced, and nothing it knew carries over.
    const byId = entries.find((e) => entryId(e) === id);
    const idSameContent = byId !== undefined && (!entry.fp || !byId.fp || byId.fp === entry.fp);
    const byFp = entry.fp ? entries.find((e) => e !== byId && e.fp === entry.fp) : undefined;
    // The exact identity wins over a fingerprint match: its lastPage is the
    // one the reader was last told about under this uri.
    const existing = (idSameContent ? byId : undefined) ?? byFp;
    const fp = entry.fp ?? (idSameContent ? byId?.fp : undefined);
    const next: RecentEntry = { uri: entry.uri, name: entry.name, lastPage: existing?.lastPage ?? 1, openedAt: Date.now() };
    if (fp) next.fp = fp;
    // Known now, else known before for this same content — under this uri or
    // under another uri being collapsed into this entry.
    const imposed = entry.imposed ?? (idSameContent ? byId?.imposed : undefined) ?? byFp?.imposed;
    if (imposed !== undefined) next.imposed = imposed;
    // One entry per identity, and one per fingerprint.
    const filtered = entries.filter((e) => e !== byId && !(fp && e.fp === fp));
    filtered.unshift(next);
    await writeAll(filtered.slice(0, MAX_ENTRIES));
    return next;
  });
}

/**
 * Follows a file to a new uri/name after a rename or move, keeping what the
 * desk knows about it (lastPage, openedAt, fingerprint) and its place in the
 * list. Does nothing when the file is not on the desk.
 */
export async function rekeyRecent(
  from: { uri: string | null; name: string },
  to: { uri: string | null; name: string },
): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    const index = entries.findIndex((e) => entryId(e) === entryId(from));
    if (index < 0) return;
    const moved: RecentEntry = { ...entries[index], uri: to.uri, name: to.name };
    // In place; an entry already sitting under the target identity is the
    // same file seen before the move, so it goes.
    const next = entries.flatMap((e, i) => (i === index ? [moved] : entryId(e) === entryId(to) ? [] : [e]));
    await writeAll(next);
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

/**
 * Puts a removed entry back exactly as it was (same openedAt and lastPage),
 * in its place by openedAt — the undo of `removeRecent`. Does nothing when an
 * entry with the same identity is already there, e.g. the file was opened
 * again before the undo.
 */
export async function restoreRecent(entry: RecentEntry): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    if (entries.some((e) => sameFile(e, entry))) return;
    const restored: RecentEntry = { uri: entry.uri, name: entry.name, lastPage: entry.lastPage, openedAt: entry.openedAt };
    if (entry.fp) restored.fp = entry.fp;
    if (entry.imposed !== undefined) restored.imposed = entry.imposed;
    const next = [...entries, restored].sort((a, b) => b.openedAt - a.openedAt);
    await writeAll(next.slice(0, MAX_ENTRIES));
  });
}

export async function removeRecent(identity: { uri: string | null; name: string }): Promise<void> {
  return enqueue(async () => {
    const entries = await readAll();
    const id = entryId(identity);
    await writeAll(entries.filter((e) => entryId(e) !== id));
  });
}
