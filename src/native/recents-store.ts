import { Preferences } from '@capacitor/preferences';

export interface RecentEntry {
  uri: string | null;
  name: string;
  lastPage: number;
  openedAt: number;
}

const STORAGE_KEY = 'quire.recents.v1';
const MAX_ENTRIES = 8;

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

export async function getRecents(): Promise<RecentEntry[]> {
  return readAll();
}

/** Adds/moves an entry to the front, deduped by name, capped at `MAX_ENTRIES`. */
export async function recordOpened(entry: { uri: string | null; name: string }): Promise<void> {
  const entries = await readAll();
  const existing = entries.find((e) => e.name === entry.name);
  const next: RecentEntry = { uri: entry.uri, name: entry.name, lastPage: existing?.lastPage ?? 1, openedAt: Date.now() };
  const filtered = entries.filter((e) => e.name !== entry.name);
  filtered.unshift(next);
  await writeAll(filtered.slice(0, MAX_ENTRIES));
}

export async function updateLastPage(name: string, page: number): Promise<void> {
  const entries = await readAll();
  const target = entries.find((e) => e.name === name);
  if (!target) return;
  target.lastPage = page;
  await writeAll(entries);
}

export async function removeRecent(name: string): Promise<void> {
  const entries = await readAll();
  await writeAll(entries.filter((e) => e.name !== name));
}
