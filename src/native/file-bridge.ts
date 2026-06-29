import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface PickedPdf {
  name: string;
  bytes: Uint8Array;
}

const FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

export class FileTooLargeError extends Error {
  sizeBytes: number;
  constructor(sizeBytes: number) {
    super(`File is too large (${Math.round(sizeBytes / (1024 * 1024))} MB). Maximum allowed size is 50 MB.`);
    this.name = 'FileTooLargeError';
    this.sizeBytes = sizeBytes;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.includes(',') ? base64.split(',')[1] : base64;
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
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

/** Writes a PDF to a temp cache location and opens the native share sheet for it. */
export async function sharePdf(bytes: Uint8Array, filename: string, title: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: bytesToBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title, files: [uri] });
}

/** Zorunlu arayüz güncellemesi: Klasör ya da dosya ayrımı için type eklendi */
export interface FileEntryInfo {
  name: string;
  uri: string;
  size: number;
  lastModified: number;
  type: 'file' | 'directory';
}

/** Lists all files and folders in a specific subdirectory relative to Directory.Data. */
export async function listPrivateFolder(subPath: string): Promise<FileEntryInfo[]> {
  try {
    const result = await Filesystem.readdir({
      path: subPath,
      directory: Directory.Data,
    });

    const list: FileEntryInfo[] = await Promise.all(
      result.files.map(async (file) => {
        const filePath = subPath ? `${subPath}/${file.name}` : file.name;

        const uriPromise = Filesystem.getUri({ path: filePath, directory: Directory.Data });
        const statPromise =
          file.type === 'file'
            ? Filesystem.stat({ path: filePath, directory: Directory.Data }).catch(() => null)
            : Promise.resolve(null);

        const [uriResult, stat] = await Promise.all([uriPromise, statPromise]);

        return {
          name: file.name,
          uri: uriResult.uri,
          size: stat?.size ?? 0,
          lastModified: stat?.mtime ?? Date.now(),
          type: file.type === 'directory' ? 'directory' as const : 'file' as const,
        };
      }),
    );

    return list;
  } catch (error) {
    // Only auto-create if this looks like a first-run (directory not found)
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


