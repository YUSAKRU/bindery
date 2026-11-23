import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    }),
  },
}));

const STORAGE_KEY = 'bindery.recents.v1';

beforeEach(() => {
  store.clear();
  vi.resetModules();
});

async function importStore() {
  return import('./recents-store');
}

describe('recents-store', () => {
  it('W3 regression: updating one of two same-named entries does not touch the other', async () => {
    const { recordOpened, updateLastPage, getRecents } = await importStore();
    await recordOpened({ uri: 'content://a/document.pdf', name: 'document.pdf' });
    await recordOpened({ uri: 'content://b/document.pdf', name: 'document.pdf' });

    await updateLastPage({ uri: 'content://b/document.pdf', name: 'document.pdf' }, 40);

    const entries = await getRecents();
    const a = entries.find((e) => e.uri === 'content://a/document.pdf');
    const b = entries.find((e) => e.uri === 'content://b/document.pdf');
    expect(a?.lastPage).toBe(1);
    expect(b?.lastPage).toBe(40);
  });

  it('W3 regression: removing one of two same-named entries does not remove the other', async () => {
    const { recordOpened, removeRecent, getRecents } = await importStore();
    await recordOpened({ uri: 'content://a/document.pdf', name: 'document.pdf' });
    await recordOpened({ uri: 'content://b/document.pdf', name: 'document.pdf' });

    await removeRecent({ uri: 'content://b/document.pdf', name: 'document.pdf' });

    const entries = await getRecents();
    expect(entries).toHaveLength(1);
    expect(entries[0].uri).toBe('content://a/document.pdf');
  });

  it('recordOpened moves an existing entry to the front and preserves its lastPage', async () => {
    const { recordOpened, updateLastPage, getRecents } = await importStore();
    await recordOpened({ uri: 'content://a', name: 'a.pdf' });
    await recordOpened({ uri: 'content://b', name: 'b.pdf' });
    await updateLastPage({ uri: 'content://a', name: 'a.pdf' }, 7);

    await recordOpened({ uri: 'content://a', name: 'a.pdf' });

    const entries = await getRecents();
    expect(entries).toHaveLength(2);
    expect(entries[0].uri).toBe('content://a');
    expect(entries[0].lastPage).toBe(7);
  });

  it('caps entries at MAX_ENTRIES (8)', async () => {
    const { recordOpened, getRecents } = await importStore();
    for (let i = 0; i < 10; i += 1) {
      await recordOpened({ uri: `content://${i}`, name: `${i}.pdf` });
    }
    const entries = await getRecents();
    expect(entries).toHaveLength(8);
    // Most recently opened stays, oldest two are evicted.
    expect(entries[0].uri).toBe('content://9');
    expect(entries.some((e) => e.uri === 'content://0')).toBe(false);
    expect(entries.some((e) => e.uri === 'content://1')).toBe(false);
  });

  it('readAll tolerates corrupt or absent storage', async () => {
    const { getRecents } = await importStore();
    expect(await getRecents()).toEqual([]);

    store.set(STORAGE_KEY, 'not json');
    expect(await getRecents()).toEqual([]);

    store.set(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(await getRecents()).toEqual([]);
  });

  it('loads entries persisted in the old shape (no identity field, just uri/name)', async () => {
    const oldShapeEntries = [
      { uri: 'content://old', name: 'old.pdf', lastPage: 3, openedAt: 1000 },
      { uri: null, name: 'legacy.pdf', lastPage: 1, openedAt: 500 },
    ];
    store.set(STORAGE_KEY, JSON.stringify(oldShapeEntries));

    const { getRecents, updateLastPage, removeRecent } = await importStore();
    expect(await getRecents()).toEqual(oldShapeEntries);

    // Old-shape entries must be addressable by the new identity-based API
    // with no migration step, since the identity is derived, not stored.
    await updateLastPage({ uri: 'content://old', name: 'old.pdf' }, 9);
    let entries = await getRecents();
    expect(entries.find((e) => e.uri === 'content://old')?.lastPage).toBe(9);

    await removeRecent({ uri: null, name: 'legacy.pdf' });
    entries = await getRecents();
    expect(entries.some((e) => e.name === 'legacy.pdf')).toBe(false);
  });

  it('serializes overlapping mutating calls so neither write is lost', async () => {
    const { recordOpened, getRecents } = await importStore();
    await Promise.all([
      recordOpened({ uri: 'content://x', name: 'x.pdf' }),
      recordOpened({ uri: 'content://y', name: 'y.pdf' }),
    ]);
    const entries = await getRecents();
    const uris = entries.map((e) => e.uri).sort();
    expect(uris).toEqual(['content://x', 'content://y']);
  });

  it('restoreRecent puts a removed entry back exactly, in its place by openedAt', async () => {
    const { recordOpened, removeRecent, restoreRecent, getRecents } = await importStore();
    await recordOpened({ uri: 'content://old', name: 'old.pdf' });
    await recordOpened({ uri: 'content://mid', name: 'mid.pdf' });
    await recordOpened({ uri: 'content://new', name: 'new.pdf' });
    const before = await getRecents();
    const mid = { ...before.find((e) => e.uri === 'content://mid')!, lastPage: 7 };
    // Stamp distinct times so the order cannot come from insertion order.
    store.set(STORAGE_KEY, JSON.stringify(before.map((e, i) => (e.uri === 'content://mid' ? { ...mid, openedAt: 200 } : { ...e, openedAt: i === 0 ? 300 : 100 }))));
    const removed = (await getRecents()).find((e) => e.uri === 'content://mid')!;
    await removeRecent(removed);
    expect((await getRecents()).map((e) => e.uri)).toEqual(['content://new', 'content://old']);

    await restoreRecent(removed);
    const after = await getRecents();
    expect(after.map((e) => e.uri)).toEqual(['content://new', 'content://mid', 'content://old']);
    expect(after[1]).toEqual({ uri: 'content://mid', name: 'mid.pdf', lastPage: 7, openedAt: 200 });
  });

  it('restoreRecent does nothing when the entry is already back', async () => {
    const { recordOpened, restoreRecent, getRecents } = await importStore();
    await recordOpened({ uri: 'content://a', name: 'a.pdf' });
    const [entry] = await getRecents();
    await restoreRecent({ ...entry, lastPage: 99 });
    const after = await getRecents();
    expect(after).toHaveLength(1);
    expect(after[0].lastPage).toBe(1);
  });

  it('restoreRecent keeps the cap of 8, dropping the oldest', async () => {
    const { recordOpened, removeRecent, restoreRecent, getRecents } = await importStore();
    for (let i = 0; i < 8; i++) await recordOpened({ uri: `content://${i}`, name: `${i}.pdf` });
    const all = await getRecents();
    store.set(STORAGE_KEY, JSON.stringify(all.map((e, i) => ({ ...e, openedAt: 1000 - i }))));
    const oldest = (await getRecents())[7];
    await removeRecent(oldest);
    await recordOpened({ uri: 'content://fresh', name: 'fresh.pdf' });
    await restoreRecent(oldest);
    const after = await getRecents();
    expect(after).toHaveLength(8);
    expect(after.some((e) => e.uri === oldest.uri)).toBe(false);
  });

  describe('fingerprint dedupe', () => {
    it('one file reached through two uris stays one entry, under the newest uri, keeping its page', async () => {
      const { recordOpened, updateLastPage, getRecents } = await importStore();
      await recordOpened({ uri: 'content://downloads/1', name: 'DarHub (1).pdf', fp: 'F1' });
      await updateLastPage({ uri: 'content://downloads/1', name: 'DarHub (1).pdf' }, 4);
      await recordOpened({ uri: 'content://recent/9', name: 'DarHub (1).pdf', fp: 'F1' });
      const entries = await getRecents();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ uri: 'content://recent/9', lastPage: 4, fp: 'F1' });
    });

    it('never merges by name alone: different fingerprints stay apart', async () => {
      const { recordOpened, getRecents } = await importStore();
      await recordOpened({ uri: 'content://a', name: 'document.pdf', fp: 'F1' });
      await recordOpened({ uri: 'content://b', name: 'document.pdf', fp: 'F2' });
      expect(await getRecents()).toHaveLength(2);
    });

    it('an entry without a fingerprint is matched by identity only', async () => {
      const { recordOpened, getRecents } = await importStore();
      // Written before fingerprints existed.
      store.set(STORAGE_KEY, JSON.stringify([{ uri: 'content://old', name: 'x.pdf', lastPage: 9, openedAt: 1 }]));
      await recordOpened({ uri: 'content://new', name: 'x.pdf', fp: 'F1' });
      expect((await getRecents()).map((e) => e.uri)).toEqual(['content://new', 'content://old']);
    });

    it('a legacy pair converges once each side has been opened', async () => {
      const { recordOpened, getRecents } = await importStore();
      store.set(
        STORAGE_KEY,
        JSON.stringify([
          { uri: 'content://a', name: 'DarHub (1).pdf', lastPage: 4, openedAt: 2 },
          { uri: 'content://b', name: 'DarHub (1).pdf', lastPage: 1, openedAt: 1 },
        ]),
      );
      await recordOpened({ uri: 'content://a', name: 'DarHub (1).pdf', fp: 'F1' });
      expect(await getRecents()).toHaveLength(2);
      await recordOpened({ uri: 'content://b', name: 'DarHub (1).pdf', fp: 'F1' });
      const entries = await getRecents();
      expect(entries).toHaveLength(1);
      // content://b carried its own page; its exact identity wins.
      expect(entries[0]).toMatchObject({ uri: 'content://b', lastPage: 1, fp: 'F1' });
    });

    it('recording without bytes keeps the fingerprint the entry already had', async () => {
      const { recordOpened, getRecents } = await importStore();
      await recordOpened({ uri: 'content://a', name: 'a.pdf', fp: 'F1' });
      await recordOpened({ uri: 'content://a', name: 'a.pdf' });
      expect((await getRecents())[0].fp).toBe('F1');
    });

    it('restoreRecent does not bring back a file that is on the desk under another uri', async () => {
      const { recordOpened, removeRecent, restoreRecent, getRecents } = await importStore();
      await recordOpened({ uri: 'content://a', name: 'a.pdf', fp: 'F1' });
      const [removed] = await getRecents();
      await removeRecent(removed);
      await recordOpened({ uri: 'content://b', name: 'a.pdf', fp: 'F1' });
      await restoreRecent(removed);
      expect((await getRecents()).map((e) => e.uri)).toEqual(['content://b']);
    });
  });

  describe('fingerprintPdf', () => {
    it('is stable, and separates different contents and lengths', async () => {
      const { fingerprintPdf, FINGERPRINT_EDGE_BYTES } = await importStore();
      const a = new Uint8Array(3 * FINGERPRINT_EDGE_BYTES).map((_, i) => i % 251);
      expect(fingerprintPdf(a)).toBe(fingerprintPdf(a.slice()));
      const tailChanged = a.slice();
      tailChanged[tailChanged.length - 1] ^= 1;
      expect(fingerprintPdf(tailChanged)).not.toBe(fingerprintPdf(a));
      const headChanged = a.slice();
      headChanged[0] ^= 1;
      expect(fingerprintPdf(headChanged)).not.toBe(fingerprintPdf(a));
      expect(fingerprintPdf(a.slice(0, a.length - 1))).not.toBe(fingerprintPdf(a));
      expect(fingerprintPdf(a)).toMatch(new RegExp(`^${a.length}:[0-9a-f]{16}$`));
    });

    it('handles files shorter than the hashed edges', async () => {
      const { fingerprintPdf } = await importStore();
      expect(fingerprintPdf(new Uint8Array([]))).toMatch(/^0:[0-9a-f]{16}$/);
      expect(fingerprintPdf(new Uint8Array([1, 2, 3]))).not.toBe(fingerprintPdf(new Uint8Array([1, 2, 4])));
    });
  });
});
