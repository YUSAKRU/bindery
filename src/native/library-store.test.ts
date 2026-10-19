import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRecordDraft } from './library-store';

const store = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));

const fs = vi.hoisted(() => ({
  stat: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: fs,
}));

const readPdfFromUri = vi.hoisted(() => vi.fn());
vi.mock('./file-bridge', () => ({ readPdfFromUri }));

const STORAGE_KEY = 'bindery.library.v1';

beforeEach(() => {
  store.clear();
  vi.resetModules();
  fs.stat.mockReset();
  fs.getUri.mockReset();
  readPdfFromUri.mockReset();
});

async function importStore() {
  return import('./library-store');
}

function draft(id: string, overrides: Partial<LibraryRecordDraft> = {}): LibraryRecordDraft {
  return {
    id,
    title: `Book ${id}`,
    sourceName: `${id}.pdf`,
    sourcePageCount: 12,
    signatureCount: 1,
    sheetCount: 3,
    sheetSizePt: [842, 595],
    paddingApplied: 0,
    blanksInserted: 0,
    settings: { options: { paperSize: 'A4', signatureSize: 'auto' }, wrapCover: null },
    source: { kind: 'private', relPath: `documents/${id}.pdf` },
    output: null,
    thumb: null,
    ...overrides,
  };
}

function storedRecord(id: string, extra: Record<string, unknown> = {}) {
  return { ...draft(id), createdAt: 1, updatedAt: 1, ...extra };
}

function stored(): { version: number; records: Array<Record<string, unknown>> } {
  return JSON.parse(store.get(STORAGE_KEY) ?? 'null');
}

describe('parseLibrary', () => {
  it('never throws on missing or malformed payloads', async () => {
    const { parseLibrary } = await importStore();
    expect(parseLibrary(null)).toEqual([]);
    expect(parseLibrary('')).toEqual([]);
    expect(parseLibrary('{')).toEqual([]);
    expect(parseLibrary('42')).toEqual([]);
  });

  it('drops a record without settings.options or with an unknown source kind, keeping valid siblings', async () => {
    const { parseLibrary } = await importStore();
    const noOptions = { ...storedRecord('a'), settings: { wrapCover: null } };
    const badSource = { ...storedRecord('b'), source: { kind: 'cloud', url: 'x' } };
    const good = storedRecord('c');
    const records = parseLibrary(JSON.stringify({ version: 1, records: [noOptions, badSource, good] }));
    expect(records.map((r) => r.id)).toEqual(['c']);
  });

  it('dedupes by id, first occurrence wins', async () => {
    const { parseLibrary } = await importStore();
    const first = storedRecord('a', { title: 'first' });
    const second = storedRecord('a', { title: 'second' });
    const records = parseLibrary(JSON.stringify({ version: 1, records: [first, second] }));
    expect(records).toHaveLength(1);
    expect(records[0].title).toBe('first');
  });
});

describe('library-store', () => {
  it('keeps unknown extra fields on a stored record through a write of another record', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ version: 1, records: [storedRecord('old', { futureField: { x: 1 } })] }));
    const { upsertRecord } = await importStore();
    await upsertRecord(draft('new'));
    const old = stored().records.find((r) => r.id === 'old');
    expect(old?.futureField).toEqual({ x: 1 });
  });

  it('reads a newer-version payload but refuses to overwrite it', async () => {
    const raw = JSON.stringify({ version: 2, records: [storedRecord('a')] });
    store.set(STORAGE_KEY, raw);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { getLibrary, upsertRecord } = await importStore();
    expect((await getLibrary()).map((r) => r.id)).toEqual(['a']);
    await expect(upsertRecord(draft('b'))).rejects.toThrow(/newer version/);
    expect(store.get(STORAGE_KEY)).toBe(raw);
    warn.mockRestore();
  });

  it('lists newest first; upserting the same id keeps one record, its createdAt, and bumps updatedAt', async () => {
    const { upsertRecord, getLibrary } = await importStore();
    const { record: a1 } = await upsertRecord(draft('a'));
    await upsertRecord(draft('b'));
    expect((await getLibrary()).map((r) => r.id)).toEqual(['b', 'a']);

    const { record: a2 } = await upsertRecord(draft('a', { title: 'renamed' }));
    const all = await getLibrary();
    expect(all.map((r) => r.id)).toEqual(['a', 'b']);
    // Stored once, not merely deduped on the way back out.
    expect(stored().records.filter((r) => r.id === 'a')).toHaveLength(1);
    expect(a2.title).toBe('renamed');
    expect(a2.createdAt).toBe(a1.createdAt);
    expect(a2.updatedAt).toBeGreaterThan(a1.updatedAt);
  });

  it('a share (output null) after a save keeps the saved output', async () => {
    const { upsertRecord, getRecord } = await importStore();
    await upsertRecord(draft('a', { output: { relPath: 'booklets/A' } }));
    await upsertRecord(draft('a', { output: null }));
    expect((await getRecord('a'))?.output).toEqual({ relPath: 'booklets/A' });
  });

  it('the 201st record evicts the oldest by createdAt and returns it', async () => {
    const records = Array.from({ length: 200 }, (_, i) =>
      storedRecord(`r${i}`, { createdAt: 1000 + i, updatedAt: 5000 - i }),
    );
    // r57 is the oldest by creation even though it is not the least recently updated.
    records[57] = storedRecord('r57', { createdAt: 10, updatedAt: 9000 });
    store.set(STORAGE_KEY, JSON.stringify({ version: 1, records }));
    const { upsertRecord, getLibrary, LIBRARY_MAX_RECORDS } = await importStore();
    const { evicted } = await upsertRecord(draft('new'));
    expect(evicted.map((r) => r.id)).toEqual(['r57']);
    const all = await getLibrary();
    expect(all).toHaveLength(LIBRARY_MAX_RECORDS);
    expect(all.some((r) => r.id === 'new')).toBe(true);
  });

  it('overlapping writes all land (no lost update)', async () => {
    store.set(STORAGE_KEY, JSON.stringify({ version: 1, records: [storedRecord('gone')] }));
    const { upsertRecord, removeRecord, getLibrary } = await importStore();
    await Promise.all([upsertRecord(draft('a')), upsertRecord(draft('b')), removeRecord('gone')]);
    expect((await getLibrary()).map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('rewritePrivatePaths moves output and private sources, leaving saf and sibling prefixes alone', async () => {
    const { upsertRecord, rewritePrivatePaths, getRecord } = await importStore();
    await upsertRecord(draft('out', { output: { relPath: 'booklets/A' } }));
    await upsertRecord(draft('src', { source: { kind: 'private', relPath: 'booklets/A/x.pdf' } }));
    await upsertRecord(draft('saf', { source: { kind: 'saf', uri: 'booklets/A/x.pdf' } }));
    await upsertRecord(draft('sib', { output: { relPath: 'booklets/AB' }, source: { kind: 'private', relPath: 'booklets/AB/y.pdf' } }));

    expect(await rewritePrivatePaths('booklets/A', 'booklets/B')).toBe(2);
    expect((await getRecord('out'))?.output).toEqual({ relPath: 'booklets/B' });
    expect((await getRecord('src'))?.source).toEqual({ kind: 'private', relPath: 'booklets/B/x.pdf' });
    expect((await getRecord('saf'))?.source).toEqual({ kind: 'saf', uri: 'booklets/A/x.pdf' });
    const sib = await getRecord('sib');
    expect(sib?.output).toEqual({ relPath: 'booklets/AB' });
    expect(sib?.source).toEqual({ kind: 'private', relPath: 'booklets/AB/y.pdf' });
  });

  it('clearOutputUnder forgets outputs at or under the deleted path only', async () => {
    const { upsertRecord, clearOutputUnder, getRecord } = await importStore();
    await upsertRecord(draft('a', { output: { relPath: 'booklets/A' } }));
    await upsertRecord(draft('ab', { output: { relPath: 'booklets/AB' } }));
    expect(await clearOutputUnder('booklets/A')).toBe(1);
    expect((await getRecord('a'))?.output).toBeNull();
    expect((await getRecord('ab'))?.output).toEqual({ relPath: 'booklets/AB' });
  });
});

describe('probeSource / readSource', () => {
  it('a SAF uri whose stat throws is unknown, not missing; a private path whose stat throws is missing', async () => {
    const { probeSource } = await importStore();
    fs.stat.mockRejectedValue(new Error('no stat'));
    expect(await probeSource({ kind: 'saf', uri: 'content://x' })).toBe('unknown');
    expect(await probeSource({ kind: 'private', relPath: 'documents/x.pdf' })).toBe('missing');
    expect(await probeSource({ kind: 'none' })).toBe('missing');
    expect(await probeSource({ kind: 'asset', path: 'onboarding/quick-start-en.pdf' })).toBe('ok');
  });

  it('reads a private source through its Data uri; a none source throws LIBRARY_SOURCE_MISSING', async () => {
    const { readSource } = await importStore();
    fs.getUri.mockResolvedValue({ uri: 'file:///data/documents/x.pdf' });
    readPdfFromUri.mockResolvedValue({ name: 'x.pdf', bytes: new Uint8Array([1]) });
    await readSource({ kind: 'private', relPath: 'documents/x.pdf' });
    expect(fs.getUri).toHaveBeenCalledWith({ path: 'documents/x.pdf', directory: 'DATA' });
    expect(readPdfFromUri).toHaveBeenCalledWith('file:///data/documents/x.pdf');
    await expect(readSource({ kind: 'none' })).rejects.toMatchObject({ code: 'LIBRARY_SOURCE_MISSING' });
  });
});
