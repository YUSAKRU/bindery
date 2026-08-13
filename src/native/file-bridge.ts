import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { canPrint, printPdfUri } from './print';

export interface PickedPdf {
  name: string;
  bytes: Uint8Array;
}

export const FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

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

// The platform base64 methods (Chrome/WebView 140+) do the whole conversion in
// C++. They are the fast path below; the hand-rolled loops stay as the fallback
// because minSdk is 24, and Android 7 is capped at WebView 119 forever — Chrome
// 120 raised the floor to API 26 — so those devices can never reach 140.
//
// tsconfig's lib is ES2023 and these are only typed in lib.esnext.typedarrays,
// so describe just the shape we call. Both are checked per call rather than
// cached: a typeof on the prototype is free next to encoding 1.5 MiB, and it
// keeps both paths reachable from tests (Node 24, which the suite runs on, does
// not have them, so the fallback is what CI exercises by default).
type NativeBase64Bytes = Uint8Array & { toBase64?: () => string };
type NativeBase64Ctor = { fromBase64?: (base64: string) => Uint8Array };

// Multiple of 3 so every chunk but the last encodes to a padding-free base64
// run — btoa() on a non-multiple-of-3 chunk emits '=' padding, which corrupts
// the output if it lands in the middle of the concatenated string.
const ENCODE_CHUNK_BYTES = 0x8000 - (0x8000 % 3);

// String.fromCharCode.apply() takes a whole run of bytes per call instead of one
// per iteration. Kept well under the argument-count limit that makes apply()
// throw on large arrays.
const FROM_CHAR_CODE_MAX_ARGS = 8192;

/**
 * Encodes bytes to base64, preferring the platform encoder.
 *
 * Measured on device (Redmi 2412DPC0AG, WebView 150), encoding 50 MB in the
 * 1.5 MiB slices writeFileChunked actually uses: the byte-by-byte loop cost
 * 552 ms with a 38.8 ms worst slice, the apply() fallback 274 ms, and
 * toBase64() 23 ms with a 1.8 ms worst slice. All three produce identical
 * output — verified on device and in the tests below.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as NativeBase64Bytes).toBase64;
  if (typeof native === 'function') return native.call(bytes);

  let base64 = '';
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK_BYTES) {
    const chunk = bytes.subarray(i, i + ENCODE_CHUNK_BYTES);
    let binary = '';
    for (let j = 0; j < chunk.length; j += FROM_CHAR_CODE_MAX_ARGS) {
      binary += String.fromCharCode.apply(
        null,
        chunk.subarray(j, j + FROM_CHAR_CODE_MAX_ARGS) as unknown as number[],
      );
    }
    base64 += btoa(binary);
  }
  return base64;
}

// Multiple of 4 so every slice is independently valid base64 for atob() —
// splitting mid-group would misalign the decoded bytes.
const DECODE_CHUNK_CHARS = 0x8000 - (0x8000 % 4);

/**
 * Decodes base64 to bytes, preferring the platform decoder.
 *
 * Runs on every file read, once per 1.5 MiB chunk. Measured on device for a
 * 48 MB read: the loop cost 207 ms, Uint8Array.fromBase64 58 ms.
 *
 * The native decoder is stricter than atob(), which skips ASCII whitespace —
 * so if a platform ever hands back wrapped base64, fall through to the loop
 * rather than failing the read. Nothing observed does that (wrapped input would
 * already break the length arithmetic below, and reads work today), but a file
 * the user is trying to open is the wrong place to find out.
 */
function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;

  const nativeFrom = (Uint8Array as NativeBase64Ctor).fromBase64;
  if (typeof nativeFrom === 'function') {
    try {
      return nativeFrom.call(Uint8Array, cleaned);
    } catch {
      // fall through to the loop
    }
  }

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

/**
 * Turns a picked file into bytes, preferring the streamed path.
 *
 * `file.path` is the raw `content://` URI on Android (FilePicker.java's
 * getPathFromUri is just `uri.toString()`), so it can be read in chunks like any
 * other URI. That is why the pickers no longer ask for `readData: true`: the
 * plugin would slurp the whole file into a single base64 Java String, the exact
 * allocation that ran a 48 MB PDF out of heap. `data` remains as a fallback in
 * case a platform hands it over anyway, and `blob` covers the web, where the
 * picker gives a Blob without being asked.
 */
async function filePickedToBytes(file: PickedFile): Promise<PickedPdf> {
  if (file.path) {
    return { name: file.name, bytes: await readFileChunked(file.path, file.size ?? null) };
  }
  if (file.data) {
    return { name: file.name, bytes: base64ToBytes(file.data) };
  }
  if (file.blob) {
    const buffer = await file.blob.arrayBuffer();
    return { name: file.name, bytes: new Uint8Array(buffer) };
  }
  throw new Error(`'${file.name}' dosyasının verisi okunamadı.`);
}

// Chunk size for streamed reads, in bytes.
//
// MUST be a multiple of 3. Each chunk arrives independently base64-encoded, and
// base64 only splits cleanly on 3-byte groups — anything else pads the chunk
// with '=' and corrupts the file when the pieces are put back together. iOS
// rounds the value up for you (FilesystemOperationExecutor.swift), but Android
// passes it through untouched (FilesystemMethodOptions.kt), so the caller has
// to get it right.
const READ_CHUNK_BYTES = 1_572_864; // 1.5 MiB, and 1572864 % 3 === 0

// Same rule, same reason, for the write direction — see writeFileChunked.
const WRITE_CHUNK_BYTES = 1_572_864; // 1.5 MiB, and 1572864 % 3 === 0

/**
 * Reads a file in chunks, decoding each one straight into the destination.
 *
 * The whole point is that the file's base64 form never exists in one piece.
 * `Filesystem.readFile` returns the entire file as a single base64 string,
 * which for a 48 MB PDF is a ~64 MB Java String that a 256 MB heap cannot
 * allocate — an OOM observed on a real device. Here only one chunk is encoded
 * at a time, and it is decoded into a pre-sized buffer immediately.
 *
 * `expectedSize` comes from stat(); when a content provider won't give one, the
 * chunks are collected and joined at the end instead, which costs a second
 * full-size allocation but keeps the rare path working.
 */
async function readFileChunked(uri: string, expectedSize: number | null): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let target = expectedSize !== null ? new Uint8Array(expectedSize) : null;
    const collected: Uint8Array[] = [];
    let offset = 0;
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (target) {
        // stat() can disagree with what the provider actually streams; trust
        // the bytes, not the metadata.
        resolve(offset === target.length ? target : target.slice(0, offset));
        return;
      }
      const joined = new Uint8Array(offset);
      let at = 0;
      for (const part of collected) {
        joined.set(part, at);
        at += part.length;
      }
      resolve(joined);
    };

    Filesystem.readFileInChunks({ path: uri, chunkSize: READ_CHUNK_BYTES }, (chunk, err) => {
      if (settled) return;
      if (err) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const data = typeof chunk?.data === 'string' ? chunk.data : '';
      if (!data) {
        finish(); // an empty chunk means the file has been read completely
        return;
      }
      const bytes = base64ToBytes(data);
      if (target && offset + bytes.length > target.length) {
        // The file is bigger than stat() claimed. Keep what we have and fall
        // back to collecting, rather than throwing away a nearly-finished read.
        collected.push(target.subarray(0, offset).slice(), bytes);
        target = null;
      } else if (target) {
        target.set(bytes, offset);
      } else {
        collected.push(bytes);
      }
      offset += bytes.length;
    }).catch((error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** Reads an arbitrary `content://`/`file://` URI (e.g. from Android's "Open with") into bytes. */
export async function readPdfFromUri(uri: string): Promise<PickedPdf> {
  // stat() is unreliable on raw content:// URIs (may throw on some Android versions
  // and may return a path segment rather than a display name). Try it first for the
  // size check and a best-effort display name; fall through gracefully on failure.
  let statName: string | undefined;
  let statSize: number | null = null;
  try {
    const stat = await Filesystem.stat({ path: uri });
    if (stat.size > FILE_SIZE_LIMIT_BYTES) throw new FileTooLargeError(stat.size);
    statName = stat.name;
    statSize = stat.size;
  } catch (e) {
    if (e instanceof FileTooLargeError) throw e;
    // Some content providers don't support stat — proceed without size guard.
  }

  const bytes = await readFileChunked(uri, statSize);

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
  });

  const totalSize = result.files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > FILE_SIZE_LIMIT_BYTES) throw new FileTooLargeError(totalSize);

  // One at a time. Promise.all held every picked document in memory at once,
  // which is how a handful of ordinary files added up to a crash.
  const picked: PickedPdf[] = [];
  for (const file of result.files) {
    picked.push(await filePickedToBytes(file));
  }
  return picked;
}

/** Opens the native file picker restricted to PNG/JPEG images and returns its raw bytes. */
export async function pickImage(): Promise<PickedPdf | null> {
  const result = await FilePicker.pickFiles({
    types: ['image/png', 'image/jpeg'],
    limit: 1,
  });

  const file = result.files[0];
  if (!file) return null;
  return filePickedToBytes(file);
}

/**
 * Writes bytes to a file a slice at a time, so the whole file's base64 form
 * never exists at once.
 *
 * The mirror image of readFileChunked, and it exists for the same reason.
 * Encoding a 48 MB PDF produces a ~64 MB string, and saving a booklet does that
 * for three to five output files in a row: on a device the WebView grew to
 * 672 MB and was killed. Here at most one slice is encoded at a time.
 *
 * The slice size must be a multiple of 3 for exactly the reason reads need it —
 * each call carries its own independently-encoded base64, and a slice that is
 * not a whole number of 3-byte groups ends in '=' padding, which lands in the
 * middle of the file and corrupts it.
 *
 * The first slice goes through writeFile, which creates (and truncates) the
 * file and honours `recursive` for the parent directories; the rest append.
 * Truncating first matters: appending onto the leftovers of an earlier failed
 * save would silently produce a longer, broken PDF.
 */
async function writeFileChunked(
  path: string,
  directory: Directory,
  bytes: Uint8Array,
): Promise<string> {
  const head = bytes.subarray(0, WRITE_CHUNK_BYTES);
  const { uri } = await Filesystem.writeFile({
    path,
    data: bytesToBase64(head),
    directory,
    recursive: true,
  });
  for (let offset = WRITE_CHUNK_BYTES; offset < bytes.length; offset += WRITE_CHUNK_BYTES) {
    await Filesystem.appendFile({
      path,
      data: bytesToBase64(bytes.subarray(offset, offset + WRITE_CHUNK_BYTES)),
      directory,
    });
  }
  return uri;
}

/** Writes a PDF to the device's Documents directory for permanent storage. */
export async function savePdfToDevice(bytes: Uint8Array, filename: string): Promise<string> {
  return writeFileChunked(filename, Directory.Documents, bytes);
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
  return writeFileChunked(relativePath, Directory.Data, bytes);
}

/**
 * Writes a PDF to the cache directory and returns its uri.
 *
 * Both handing a file to the share sheet and handing it to the print dialog
 * need a real file on disk rather than bytes, so they share this step.
 */
async function writePdfToCache(bytes: Uint8Array, filename: string): Promise<string> {
  return writeFileChunked(filename, Directory.Cache, bytes);
}

/** Writes a PDF to a temp cache location and opens the native share sheet for it. */
export async function sharePdf(bytes: Uint8Array, filename: string, title: string): Promise<void> {
  const uri = await writePdfToCache(bytes, filename);
  await Share.share({ title, files: [uri] });
}

/**
 * Opens the share sheet for plain text — no file, no cache write.
 *
 * The error log is the only caller: it is a few KB of text, so putting it
 * through `sharePdf`'s write-to-cache path would be all cost and no benefit.
 */
export async function shareText(text: string, title: string): Promise<void> {
  await Share.share({ title, text });
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


