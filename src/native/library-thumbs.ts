import { Filesystem, Directory } from '@capacitor/filesystem';

/**
 * Library thumbnails live in `Directory.Data` under a dot-folder, which the
 * Files screen and the Bindery picker never list (`isBrowsableEntry` in
 * app.ts), so they cannot surface as user documents.
 */
export const LIBRARY_THUMBS_DIR = '.library/thumbs';

const MEMORY_CACHE_LIMIT = 50;
const memoryCache = new Map<string, string>();

function remember(relPath: string, dataUrl: string): void {
  memoryCache.delete(relPath);
  memoryCache.set(relPath, dataUrl);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

export function libraryThumbPath(id: string): string {
  return `${LIBRARY_THUMBS_DIR}/${id}.jpg`;
}

/**
 * Writes a JPEG data URL as the thumbnail for record `id`. Returns its relPath,
 * or null on any failure — never throws; a missing thumbnail only means the
 * library draws a typographic cover instead.
 */
export async function writeLibraryThumb(id: string, dataUrl: string): Promise<string | null> {
  try {
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    if (!base64) return null;
    const relPath = libraryThumbPath(id);
    await Filesystem.writeFile({ path: relPath, data: base64, directory: Directory.Data, recursive: true });
    remember(relPath, `data:image/jpeg;base64,${base64}`);
    return relPath;
  } catch {
    return null;
  }
}

/** Reads a thumbnail as a `data:image/jpeg` URL, or null on any failure. */
export async function readLibraryThumb(relPath: string): Promise<string | null> {
  const cached = memoryCache.get(relPath);
  if (cached) {
    remember(relPath, cached);
    return cached;
  }
  try {
    const { data } = await Filesystem.readFile({ path: relPath, directory: Directory.Data });
    if (typeof data !== 'string' || !data) return null;
    const dataUrl = `data:image/jpeg;base64,${data}`;
    remember(relPath, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Deletes a thumbnail file; failures are swallowed. */
export async function deleteLibraryThumb(relPath: string): Promise<void> {
  memoryCache.delete(relPath);
  try {
    await Filesystem.deleteFile({ path: relPath, directory: Directory.Data });
  } catch {
    // already gone or unwritable — nothing the caller can do about it
  }
}
