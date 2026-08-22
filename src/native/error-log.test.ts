import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookletError } from '../engine/types';

const store = new Map<string, string>();
let setImpl: (key: string, value: string) => void = (key, value) => {
  store.set(key, value);
};

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      setImpl(key, value);
    }),
    remove: vi.fn(async ({ key }: { key: string }) => {
      store.delete(key);
    }),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: { getInfo: vi.fn(async () => ({ version: '0.4.1' })) },
}));

const STORAGE_KEY = 'bindery.errors.v1';
const CRASH_KEY = 'bindery.lastCrash.v1';
const SCREEN_KEY = 'bindery.lastScreen.v1';
const MAX_TOTAL_BYTES = 65536;

beforeEach(() => {
  store.clear();
  setImpl = (key, value) => {
    store.set(key, value);
  };
  vi.resetModules();
});

async function importStore() {
  return import('./error-log');
}

describe('error-log', () => {
  it('keeps the newest entry first', async () => {
    const { recordError, getErrors } = await importStore();
    recordError('caught', new Error('first'));
    recordError('caught', new Error('second'));

    const entries = await getErrors();
    expect(entries.map((e) => e.message)).toEqual(['second', 'first']);
  });

  it('caps the log at 20 entries, dropping the oldest', async () => {
    const { recordError, getErrors } = await importStore();
    for (let i = 0; i < 25; i += 1) {
      recordError('caught', new Error(`error ${i}`));
    }

    const entries = await getErrors();
    expect(entries).toHaveLength(20);
    expect(entries[0].message).toBe('error 24');
    expect(entries.at(-1)?.message).toBe('error 5');
  });

  it('truncates an oversized message and stack', async () => {
    const { recordError, getErrors } = await importStore();
    const error = new Error('m'.repeat(900));
    error.stack = 's'.repeat(5000);
    recordError('caught', error);

    const [entry] = await getErrors();
    expect(entry.message).toHaveLength(500);
    expect(entry.stack).toHaveLength(2000);
    expect(entry.message.endsWith('…')).toBe(true);
  });

  it('holds the stored JSON under the byte ceiling even when entries are multi-byte', async () => {
    const { recordError, getErrors } = await importStore();
    // Turkish text is 2 bytes/char in UTF-8, so 20 full-size entries exceed the
    // ceiling on bytes while staying inside the entry cap — the case the byte
    // cap exists for.
    for (let i = 0; i < 20; i += 1) {
      const error = new Error(`ç${i} ${'ğ'.repeat(480)}`);
      error.stack = 'ş'.repeat(2000);
      recordError('caught', error);
    }

    const entries = await getErrors();
    const stored = store.get(STORAGE_KEY) ?? '';
    expect(new TextEncoder().encode(stored).length).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect(entries.length).toBeLessThan(20);
    // The most recent failure is the one worth keeping.
    expect(entries[0].message.startsWith('ç19')).toBe(true);
  });

  it('carries the code off a BookletError', async () => {
    const { recordError, getErrors } = await importStore();
    recordError('caught', new BookletError('WATERMARK_EMPTY_TEXT', undefined, 'Watermark text cannot be empty.'));

    const [entry] = await getErrors();
    expect(entry.code).toBe('WATERMARK_EMPTY_TEXT');
    expect(entry.message).toBe('Watermark text cannot be empty.');
  });

  it('keeps the params a coded error carries, so the summary can fill its placeholders', async () => {
    const { recordError, getErrors } = await importStore();
    recordError(
      'caught',
      new BookletError('DOWNLOAD_NETWORK_ERROR', { message: 'timed out' }, 'Download failed.'),
    );

    const [entry] = await getErrors();
    expect(entry.params).toEqual({ message: 'timed out' });
  });

  it('records a non-Error throw without a code or stack', async () => {
    const { recordError, getErrors } = await importStore();
    recordError('rejection', 'plain string failure');

    const [entry] = await getErrors();
    expect(entry.kind).toBe('rejection');
    expect(entry.message).toBe('plain string failure');
    expect(entry.code).toBeUndefined();
    expect(entry.stack).toBeUndefined();
  });

  it('stamps the current screen and app version', async () => {
    const { recordError, setErrorScreen, getErrors } = await importStore();
    // Let the lazily-resolved version land before recording.
    await Promise.resolve();
    setErrorScreen('reader');
    recordError('caught', new Error('boom'));

    const [entry] = await getErrors();
    expect(entry.screen).toBe('reader');
    expect(entry.appVersion).toBe('0.4.1');
    expect(store.get(SCREEN_KEY)).toBe('reader');
  });

  it('never throws when storage fails, and keeps working afterwards', async () => {
    const { recordError, getErrors } = await importStore();
    setImpl = () => {
      throw new Error('storage full');
    };

    expect(() => recordError('caught', new Error('during outage'))).not.toThrow();
    // Drain the queue so a rejection would surface as unhandled here if it escaped.
    await getErrors();

    setImpl = (key, value) => {
      store.set(key, value);
    };
    recordError('caught', new Error('after recovery'));
    const entries = await getErrors();
    expect(entries.map((e) => e.message)).toEqual(['after recovery']);
  });

  it('turns a native crash marker into an entry and clears it', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1_700_000_000_000, didCrash: true, screen: 'reader' }));

    await drainCrashMarker();

    const [entry] = await getErrors();
    expect(entry.kind).toBe('abnormal-exit');
    expect(entry.code).toBe('ABNORMAL_EXIT_CRASH');
    expect(entry.at).toBe(1_700_000_000_000);
    expect(entry.screen).toBe('reader');
    expect(store.has(CRASH_KEY)).toBe(false);
  });

  it('attributes the crash to the screen in the marker, not the one this launch routed to', async () => {
    const { drainCrashMarker, setErrorScreen, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1, didCrash: true, screen: 'reader' }));

    // What startup actually does: initApp() runs to completion — showScreen()
    // included — while drainCrashMarker is still waiting on its first bridge
    // call. Reading the live screen key here would report 'hub' every time and
    // lose the only field that says where the app died.
    const drained = drainCrashMarker();
    setErrorScreen('hub');
    await drained;

    const [entry] = await getErrors();
    expect(entry.screen).toBe('reader');
  });

  it('records a crash with no screen when the marker carries none', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1, didCrash: true }));

    await drainCrashMarker();

    const [entry] = await getErrors();
    expect(entry.screen).toBeUndefined();
  });

  it('distinguishes an OS reclaim from a renderer crash', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1, didCrash: false }));

    await drainCrashMarker();

    const [entry] = await getErrors();
    expect(entry.code).toBe('ABNORMAL_EXIT_RECLAIMED');
  });

  it('reports an unknown cause when didCrash is absent (below API 26)', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1 }));

    await drainCrashMarker();

    const [entry] = await getErrors();
    expect(entry.code).toBe('ABNORMAL_EXIT_UNKNOWN');
  });

  it('never reports the same crash twice', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    store.set(CRASH_KEY, JSON.stringify({ at: 1, didCrash: true }));

    await drainCrashMarker();
    await drainCrashMarker();

    expect(await getErrors()).toHaveLength(1);
  });

  it('does nothing when there is no crash marker', async () => {
    const { drainCrashMarker, getErrors } = await importStore();
    await drainCrashMarker();
    expect(await getErrors()).toEqual([]);
  });

  it('clears the log without touching the crash marker key', async () => {
    const { recordError, clearErrors, getErrors } = await importStore();
    recordError('caught', new Error('boom'));
    await getErrors();

    await clearErrors();

    expect(await getErrors()).toEqual([]);
  });
});
