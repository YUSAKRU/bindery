import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { canPrint, printPdfUri } from './print';

export interface PickedPdf {
  name: string;
  bytes: Uint8Array;
}

const FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

export class FileTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly code = 'FILE_TOO_LARGE';
  readonly params: Record<string, string | number>;
  constructor(sizeBytes: number) {
    const mb = Math.round(sizeBytes / (1024 * 1024));
    const limitMb = FILE_SIZE_LIMIT_BYTES / (1024 * 1024);
    super(`File is too large (${mb} MB). Maximum allowed size is ${limitMb} MB.`);
    this.name = 'FileTooLargeError';
    this.sizeBytes = sizeBytes;
    this.params = { mb, limitMb };
  }
}

// Multiple of 3 so every chunk but the last encodes to a padding-free base64
// run — btoa() on a non-multiple-of-3 chunk emits '=' padding, which corrupts
// the output if it lands in the middle of the concatenated string.
const ENCODE_CHUNK_BYTES = 0x8000 - (0x8000 % 3);

function bytesToBase64(bytes: Uint8Array): string {
  let base64 = '';
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK_BYTES) {
    const chunk = bytes.subarray(i, i + ENCODE_CHUNK_BYTES);
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    base64 += btoa(binary);
  }
  return base64;
}

// Multiple of 4 so every slice is independently valid base64 for atob() —
// splitting mid-group would misalign the decoded bytes.
const DECODE_CHUNK_CHARS = 0x8000 - (0x8000 % 4);

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
  const paddingLength = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((cleaned.length / 4) * 3 - paddingLength);

  let offset = 0;
  for (let i = 0; i < cleaned.length; i += DECODE_CHUNK_CHARS) {
    const binary = atob(cleaned.slice(i, i + DECODE_CHUNK_CHARS));
    for (let j = 0; j < binary.length; j++) {
      bytes[offset++] = binary.charCodeAt(j);
    }
  }
  return bytes;
}

async function filePickedToBytes(file: PickedFile): Promise<PickedPdf> {
  if (file.data) {
    return { name: file.name, bytes: base64ToBytes(file.data) };
  }
  if (file.blob) {
    const buffer = await file.blob.arrayBuffer();
    return { name: file.name, bytes: new Uint8Array(buffer) };
  }
  throw new Error(`'${file.name}' dosyasının verisi okunamadı.`);
}

/** Reads an arbitrary `content://`/`file://` URI (e.g. from Android's "Open with") into bytes. */
export async function readPdfFromUri(uri: string): Promise<PickedPdf> {
  // stat() is unreliable on raw content:// URIs (may throw on some Android versions
  // and may return a path segment rather than a display name). Try it first for the
  // size check and a best-effort display name; fall through gracefully on failure.
  let statName: string | undefined;
  try {
    const stat = await Filesystem.stat({ path: uri });
    if (stat.size > FILE_SIZE_LIMIT_BYTES) throw new FileTooLargeError(stat.size);
    statName = stat.name;
  } catch (e) {
    if (e instanceof FileTooLargeError) throw e;
    // Some content providers don't support stat — proceed without size guard.
  }

  const file = await Filesystem.readFile({ path: uri });

  let bytes: Uint8Array;
  if (typeof file.data !== 'string') {
    const buffer = await (file.data as Blob).arrayBuffer();
    bytes = new Uint8Array(buffer);
  } else {
    bytes = base64ToBytes(file.data);
  }

  // Safe name fallback: decode the last path segment of the URI.
  const name =
    (statName ?? decodeURIComponent(uri.split('/').pop() ?? '').split('?')[0]) ||
    'document.pdf';

  return { name, bytes };
}

/** Opens the native file picker restricted to PDFs and returns its raw bytes. */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await FilePicker.pickFiles({
    types: ['application/pdf'],
    limit: 1,
    readData: true,
  });

  const file = result.files[0];
  if (!file) return null;
  if (file.size > FILE_SIZE_LIMIT_BYTES) throw new FileTooLargeError(file.size);
  return filePickedToBytes(file);
}

/** Opens the native file picker allowing multiple PDFs and returns their raw bytes. */
export async function pickPdfs(): Promise<PickedPdf[]> {
  const result = await FilePicker.pickFiles({
    types: ['application/pdf'],
    readData: true,
  });

  const totalSize = result.files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > FILE_SIZE_LIMIT_BYTES) throw new FileTooLargeError(totalSize);

  return Promise.all(result.files.map(filePickedToBytes));
}

/** Opens the native file picker restricted to PNG/JPEG images and returns its raw bytes. */
export async function pickImage(): Promise<PickedPdf | null> {
  const result = await FilePicker.pickFiles({
    types: ['image/png', 'image/jpeg'],
    limit: 1,
    readData: true,
  });

  const file = result.files[0];
  if (!file) return null;
  return filePickedToBytes(file);
}

/** Writes a PDF to the device's Documents directory for permanent storage. */
export async function savePdfToDevice(bytes: Uint8Array, filename: string): Promise<string> {
  const result = await Filesystem.writeFile({
    path: filename,
    data: bytesToBase64(bytes),
    directory: Directory.Documents,
    recursive: true,
  });
  return result.uri;
}

/** Checks whether a file or folder already exists at the given path inside Directory.Data. */
export async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: relativePath, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

/** Saves a PDF privately inside the app's internal Data directory at a specific path. */
export async function savePdfPrivately(bytes: Uint8Array, relativePath: string): Promise<string> {
  const result = await Filesystem.writeFile({
    path: relativePath,
    data: bytesToBase64(bytes),
    directory: Directory.Data,
    recursive: true,
  });
  return result.uri;
}

/**
 * Writes a PDF to the cache directory and returns its uri.
 *
 * Both handing a file to the share sheet and handing it to the print dialog
 * need a real file on disk rather than bytes, so they share this step.
 */
async function writePdfToCache(bytes: Uint8Array, filename: string): Promise<string> {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: bytesToBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  });
  return uri;
}

/** Writes a PDF to a temp cache location and opens the native share sheet for it. */
export async function sharePdf(bytes: Uint8Array, filename: string, title: string): Promise<void> {
  const uri = await writePdfToCache(bytes, filename);
  await Share.share({ title, files: [uri] });
}

/**
 * Writes a PDF to a temp cache location and opens the system print dialog for it.
 *
 * The bytes go to disk first and only the uri crosses the Capacitor bridge —
 * base64-ing a 50 MB PDF through the bridge is the memory problem fixed in
 * 0.3.5, and printing is exactly the feature people reach for with big files.
 */
export async function printPdf(bytes: Uint8Array, filename: string, jobName: string): Promise<void> {
  if (!canPrint()) {
    throw new PrintUnavailableError();
  }
  const uri = await writePdfToCache(bytes, filename);
  await printPdfUri(uri, jobName);
}

/** Raised when printing is requested on a platform with no system print dialog. */
export class PrintUnavailableError extends Error {
  readonly code = 'PRINT_UNAVAILABLE';
  constructor() {
    super('Printing is not available on this platform.');
    this.name = 'PrintUnavailableError';
  }
}

/** Zorunlu arayüz güncellemesi: Klasör ya da dosya ayrımı için type eklendi */
export interface FileEntryInfo {
  name: string;
  uri: string;
  size: number;
  lastModified: number;
  type: 'file' | 'directory';
}

// Android: IONFILEExceptions.DoesNotExist -> FilesystemErrors.doesNotExist(), which
// the native-bridge copies onto the rejected Error as `.code` (see
// @capacitor/filesystem/android FilesystemErrors.kt and @capacitor/android
// native-bridge.js's `storedCall.reject(result.error)` path). Web has no plugin bridge
// and throws a plain `Error('Folder does not exist.')` with no `.code` at all — matched
// by message as a fallback for that platform.
const MISSING_DIRECTORY_CODE = 'OS-PLUG-FILE-0008';

function isMissingDirectoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: unknown }).code === MISSING_DIRECTORY_CODE) return true;
  return /does not exist/i.test(error.message);
}

/** Lists all files and folders in a specific subdirectory relative to Directory.Data. */
export async function listPrivateFolder(subPath: string): Promise<FileEntryInfo[]> {
  try {
    const result = await Filesystem.readdir({
      path: subPath,
      directory: Directory.Data,
    });

    // Filesystem.readdir already returns name/type/size/mtime/uri per entry (Capacitor
    // 8), so no per-file getUri/stat round trips are needed here.
    return result.files.map((file) => ({
      name: file.name,
      uri: file.uri,
      size: file.size,
      lastModified: file.mtime,
      type: file.type === 'directory' ? ('directory' as const) : ('file' as const),
    }));
  } catch (error) {
    if (!isMissingDirectoryError(error)) throw error;
    try {
      await Filesystem.mkdir({ path: subPath, directory: Directory.Data, recursive: true });
      return [];  // legitimately empty new folder
    } catch {
      throw error;  // mkdir also failed — surface the original error
    }
  }
}

/** Creates a new directory inside Directory.Data. */
export async function createPrivateDirectory(path: string): Promise<void> {
  await Filesystem.mkdir({
    path,
    directory: Directory.Data,
    recursive: true,
  });
}

/** Deletes a private file or directory inside Directory.Data. */
export async function deletePrivateItem(path: string, isDirectory: boolean): Promise<void> {
  if (isDirectory) {
    await Filesystem.rmdir({
      path,
      directory: Directory.Data,
      recursive: true,
    });
  } else {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    });
  }
}

/** Moves or renames a private item in Directory.Data. */
export async function movePrivateItem(fromPath: string, toPath: string): Promise<string> {
  await Filesystem.rename({
    from: fromPath,
    to: toPath,
    directory: Directory.Data,
  });
  const result = await Filesystem.getUri({
    path: toPath,
    directory: Directory.Data,
  });
  return result.uri;
}


