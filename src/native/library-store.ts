import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { BookletOptions } from '../engine/types';
import { readPdfFromUri, type PickedPdf } from './file-bridge';

/**
 * Where a booklet's source PDF can be read again from.
 *
 * - `saf`: an Android SAF uri the app holds a persistable grant for.
 * - `private`: a path relative to `Directory.Data` (Bindery's own files).
 * - `asset`: a file bundled with the app (e.g. the onboarding sample).
 * - `none`: no handle survives — a web pick, a session-only uri, unknown.
 */
export type SourceRef =
  | { kind: 'saf'; uri: string }
  | { kind: 'private'; relPath: string }
  | { kind: 'asset'; path: string }
  | { kind: 'none' };

/**
 * Wrap-cover choices, copied structurally from the ui-layer cover model so the
 * native layer never imports from `ui`. app.ts assigns the ui values into this
 * shape, so a ui type that widens past it fails to compile there.
 */
export interface StoredWrapCover {
  format: 'single' | 'split' | 'a4-direct';
  binding: 'sewn' | 'perfect' | 'saddle';
  kind: 'softcover' | 'hardcover';
  boardMm: 1.5 | 2.0 | 2.5 | 3.0;
  gsm: 70 | 80 | 90 | 100 | 120;
  theme: 'cream' | 'white' | 'navy' | 'burgundy' | 'charcoal';
  title: string;
  author: string;
  synopsis: string;
}

export interface StoredBookletSettings {
  /** Exactly what was passed to `makeBooklet`. */
  options: BookletOptions;
  /** Only when the wrap-cover section was on. */
  wrapCover: StoredWrapCover | null;
}

export interface LibraryRecord {
  id: string;
  title: string;
  sourceName: string;
  sourcePageCount: number;
  sourceSize?: number;
  signatureCount: number;
  sheetCount: number;
  sheetSizePt: [number, number];
  paddingApplied: number;
  blanksInserted: number;
  settings: StoredBookletSettings;
  source: SourceRef;
  /** `booklets/<docName>` when the booklet was saved privately. */
  output: null | { relPath: string };
  /** `.library/thumbs/<id>.jpg` in `Directory.Data`. */
  thumb: null | { relPath: string };
  createdAt: number;
  updatedAt: number;
  /** Book reader position (physical page index, 1-based). */
  lastReadPage?: number;
}

export type LibraryRecordDraft = Omit<LibraryRecord, 'createdAt' | 'updatedAt'> & { id: string };

export type LibraryRecordPatch = Partial<
  Pick<LibraryRecord, 'title' | 'source' | 'output' | 'thumb' | 'lastReadPage' | 'sourceSize'>
>;

const STORAGE_KEY = 'bindery.library.v1';
const STORAGE_VERSION = 1;
export const LIBRARY_MAX_RECORDS = 200;

/** Thrown by every write while the stored library was written by a newer app version. */
export class LibraryNewerVersionError extends Error {
  readonly code = 'LIBRARY_NEWER_VERSION';
  constructor() {
    super('The library was written by a newer version of Bindery; not overwriting it.');
  }
}

/** Thrown by `readSource` when a record has no source that can be read again. */
export class SourceUnavailableError extends Error {
  readonly code = 'LIBRARY_SOURCE_MISSING';
  constructor() {
    super('The source file for this booklet is no longer available.');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRelPathHolder(value: unknown): value is { relPath: string } {
  return isObject(value) && typeof value.relPath === 'string';
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case 'saf':
      return typeof value.uri === 'string';
    case 'private':
      return typeof value.relPath === 'string';
    case 'asset':
      return typeof value.path === 'string';
    case 'none':
      return true;
    default:
      return false;
  }
}

export function isLibraryRecord(value: unknown): value is LibraryRecord {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || value.id === '') return false;
  if (typeof value.title !== 'string' || typeof value.sourceName !== 'string') return false;
  for (const key of ['sourcePageCount', 'signatureCount', 'sheetCount', 'paddingApplied', 'blanksInserted', 'createdAt', 'updatedAt']) {
    if (!isFiniteNumber(value[key])) return false;
  }
  for (const key of ['sourceSize', 'lastReadPage']) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) return false;
  }
  const size = value.sheetSizePt;
  if (!Array.isArray(size) || size.length !== 2 || !size.every(isFiniteNumber)) return false;
  const settings = value.settings;
  if (!isObject(settings) || !isObject(settings.options)) return false;
  if (settings.wrapCover !== null && !isObject(settings.wrapCover)) return false;
  if (!isSourceRef(value.source)) return false;
  if (value.output !== null && !isRelPathHolder(value.output)) return false;
  if (value.thumb !== null && !isRelPathHolder(value.thumb)) return false;
  return true;
}

// Set by the last read when the stored payload declares a version newer than
// this code understands. Writes then refuse rather than strip what a newer app
// stored.
let readOnlyNewer = false;
let warnedReadOnly = false;

/**
 * Parses the stored library. Never throws: anything unreadable yields `[]`,
 * invalid records are dropped, unknown extra fields on a valid record are kept
 * verbatim (so a downgrade does not destroy them), and duplicate ids keep the
 * first occurrence.
 */
export function parseLibrary(raw: string | null): LibraryRecord[] {
  return parsePayload(raw).records;
}

function parsePayload(raw: string | null): { version: number; records: LibraryRecord[] } {
  if (!raw) return { version: STORAGE_VERSION, records: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: STORAGE_VERSION, records: [] };
  }
  let version = STORAGE_VERSION;
  let list: unknown;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (isObject(parsed)) {
    if (isFiniteNumber(parsed.version)) version = parsed.version;
    list = parsed.records;
  }
  if (!Array.isArray(list)) return { version, records: [] };
  const seen = new Set<string>();
  const records: LibraryRecord[] = [];
  for (const item of list) {
    if (!isLibraryRecord(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    records.push({ ...item });
  }
  return { version, records };
}

async function readAll(): Promise<LibraryRecord[]> {
  const { value } = await Preferences.get({ key: STORAGE_KEY });
  const { version, records } = parsePayload(value);
  readOnlyNewer = version > STORAGE_VERSION;
  return records;
}

async function writeAll(records: LibraryRecord[]): Promise<void> {
  if (readOnlyNewer) {
    if (!warnedReadOnly) {
      warnedReadOnly = true;
      console.warn('Library was written by a newer app version; leaving it untouched.');
    }
    throw new LibraryNewerVersionError();
  }
  await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify({ version: STORAGE_VERSION, records }) });
}

// Every mutation is a read-modify-write over one Preferences key; chaining them
// onto one queue makes overlapping calls run in turn instead of losing a write.
// Same pattern as recents-store.ts.
let queue: Promise<void> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function byUpdatedDesc(a: LibraryRecord, b: LibraryRecord): number {
  return b.updatedAt - a.updatedAt;
}

export function newRecordId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** All records, newest (by `updatedAt`) first. */
export async function getLibrary(): Promise<LibraryRecord[]> {
  const records = await readAll();
  return records.sort(byUpdatedDesc);
}

export async function getRecord(id: string): Promise<LibraryRecord | null> {
  const records = await readAll();
  return records.find((r) => r.id === id) ?? null;
}

/**
 * Inserts a record, or updates the one with the same id (keeping its
 * `createdAt`, and keeping its `output`/`thumb` when the draft brings none —
 * a share after a save must not forget where the save went). Past
 * `LIBRARY_MAX_RECORDS`, the oldest records by `createdAt` are evicted and
 * returned so the caller can delete their thumbnails.
 */
export async function upsertRecord(
  draft: LibraryRecordDraft,
): Promise<{ record: LibraryRecord; evicted: LibraryRecord[] }> {
  return enqueue(async () => {
    const records = await readAll();
    const now = Date.now();
    // Strictly later than every stored record, so "newest first" holds even
    // for two writes within one clock tick.
    const stamp = records.reduce((max, r) => Math.max(max, r.updatedAt + 1), now);
    const index = records.findIndex((r) => r.id === draft.id);
    const existing = index >= 0 ? records[index] : undefined;
    let record: LibraryRecord;
    if (existing) {
      record = { ...existing };
      for (const [key, value] of Object.entries(draft)) {
        if (value !== undefined) (record as unknown as Record<string, unknown>)[key] = value;
      }
      if (draft.output === null) record.output = existing.output;
      if (draft.thumb === null) record.thumb = existing.thumb;
      record.createdAt = existing.createdAt;
      record.updatedAt = stamp;
      records.splice(index, 1);
    } else {
      record = { ...draft, createdAt: now, updatedAt: stamp };
    }
    records.push(record);

    const evicted: LibraryRecord[] = [];
    while (records.length > LIBRARY_MAX_RECORDS) {
      let oldest = -1;
      records.forEach((r, i) => {
        if (r.id === record.id) return;
        if (oldest < 0 || r.createdAt < records[oldest].createdAt) oldest = i;
      });
      if (oldest < 0) break;
      evicted.push(...records.splice(oldest, 1));
    }

    await writeAll(records.sort(byUpdatedDesc));
    return { record, evicted };
  });
}

/** Applies a partial update; null when no record has that id. */
export async function patchRecord(id: string, patch: LibraryRecordPatch): Promise<LibraryRecord | null> {
  return enqueue(async () => {
    const records = await readAll();
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const record: LibraryRecord = { ...records[index], ...patch, updatedAt: Math.max(Date.now(), records[index].updatedAt + 1) };
    records[index] = record;
    await writeAll(records);
    return record;
  });
}

/** Removes a record and returns it; the caller deletes its thumbnail file. */
export async function removeRecord(id: string): Promise<LibraryRecord | null> {
  return enqueue(async () => {
    const records = await readAll();
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const [removed] = records.splice(index, 1);
    await writeAll(records);
    return removed;
  });
}

/**
 * `path` rewritten from under `fromPrefix` to under `toPrefix`, or null when it
 * is not under it. Matches whole path segments only: `booklets/A` covers
 * `booklets/A` and `booklets/A/x.pdf`, never `booklets/AB`.
 */
function rebase(path: string, fromPrefix: string, toPrefix: string): string | null {
  if (path === fromPrefix) return toPrefix;
  if (path.startsWith(`${fromPrefix}/`)) return toPrefix + path.slice(fromPrefix.length);
  return null;
}

function isUnder(path: string, prefix: string): boolean {
  return rebase(path, prefix, prefix) !== null;
}

/**
 * Follows a Files-screen move/rename: every private `source` and every `output`
 * under `fromPrefix` is rewritten to `toPrefix`. Returns how many records changed.
 */
export async function rewritePrivatePaths(fromPrefix: string, toPrefix: string): Promise<number> {
  return enqueue(async () => {
    const records = await readAll();
    let changed = 0;
    const next = records.map((r) => {
      let touched = false;
      const copy = { ...r };
      if (r.source.kind === 'private') {
        const moved = rebase(r.source.relPath, fromPrefix, toPrefix);
        if (moved !== null) {
          copy.source = { kind: 'private', relPath: moved };
          touched = true;
        }
      }
      if (r.output) {
        const moved = rebase(r.output.relPath, fromPrefix, toPrefix);
        if (moved !== null) {
          copy.output = { relPath: moved };
          touched = true;
        }
      }
      if (touched) changed++;
      return copy;
    });
    if (changed > 0) await writeAll(next);
    return changed;
  });
}

/**
 * Follows a Files-screen delete: a record whose saved `output` was at or under
 * `prefix` forgets it. A deleted *source* is deliberately left alone — the
 * record is the user's object, and the detail view discovers a missing source
 * by probing it.
 */
export async function clearOutputUnder(prefix: string): Promise<number> {
  return enqueue(async () => {
    const records = await readAll();
    let changed = 0;
    const next = records.map((r) => {
      if (!r.output || !isUnder(r.output.relPath, prefix)) return r;
      changed++;
      return { ...r, output: null };
    });
    if (changed > 0) await writeAll(next);
    return changed;
  });
}

/**
 * Whether a record's source can be read. A SAF uri whose stat throws is
 * `'unknown'`, not `'missing'`: stat is unreliable on content uris (see
 * readPdfFromUri), so only an actual failed read may call it missing.
 */
export async function probeSource(ref: SourceRef): Promise<'ok' | 'missing' | 'unknown'> {
  switch (ref.kind) {
    case 'asset':
      return 'ok';
    case 'none':
      return 'missing';
    case 'private':
      try {
        await Filesystem.stat({ path: ref.relPath, directory: Directory.Data });
        return 'ok';
      } catch {
        return 'missing';
      }
    case 'saf':
      try {
        await Filesystem.stat({ path: ref.uri });
        return 'ok';
      } catch {
        return 'unknown';
      }
  }
}

/** Reads a record's source back into memory, or throws `SourceUnavailableError`. */
export async function readSource(ref: SourceRef): Promise<PickedPdf> {
  switch (ref.kind) {
    case 'private': {
      const { uri } = await Filesystem.getUri({ path: ref.relPath, directory: Directory.Data });
      return readPdfFromUri(uri);
    }
    case 'saf':
      return readPdfFromUri(ref.uri);
    case 'asset': {
      const response = await fetch(ref.path);
      if (!response.ok) throw new SourceUnavailableError();
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { name: ref.path.split('/').pop() || 'document.pdf', bytes };
    }
    case 'none':
      throw new SourceUnavailableError();
  }
}
