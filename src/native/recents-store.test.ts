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
});
