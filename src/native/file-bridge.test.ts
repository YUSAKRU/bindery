import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above module-scope variable declarations, so the
// mock fns themselves must be created via vi.hoisted() to be visible inside them.
const { writeFile, readFile, readdir, mkdir, stat, getUri } = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Data: 'DATA', Cache: 'CACHE' },
  Filesystem: { writeFile, readFile, readdir, mkdir, stat, getUri },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: { pickFiles: vi.fn() },
}));

const { printPdfUri, canPrint } = vi.hoisted(() => ({
  printPdfUri: vi.fn(),
  canPrint: vi.fn(() => true),
}));

vi.mock('./print', () => ({ printPdfUri, canPrint }));

const { savePdfPrivately, readPdfFromUri, listPrivateFolder, printPdf, sharePdf, PrintUnavailableError } =
  await import('./file-bridge');

// Deterministic pseudo-random byte generator (no crypto dependency needed for a test fixture).
function pseudoRandomBytes(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bytesToBase64 (via savePdfPrivately)', () => {
  // Sizes spanning: empty, sub-chunk, multiple encode-chunk boundaries (chunk size
  // is 32766 bytes), and lengths that are/aren't multiples of 3.
  const sizes = [0, 1, 2, 3, 100, 250_000, 32766, 32767, 32768, 65532, 65533];

  it.each(sizes)('round-trips %i pseudo-random bytes losslessly against Node Buffer', async (size) => {
    const original = pseudoRandomBytes(size, size + 7);
    writeFile.mockResolvedValueOnce({ uri: 'file://x' });

    await savePdfPrivately(original, 'scans/test.pdf');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const base64 = writeFile.mock.calls[0][0].data as string;

    // Independent oracle: Node's Buffer implementation, not our own code.
    const decoded = new Uint8Array(Buffer.from(base64, 'base64'));
    expect(decoded).toEqual(original);
  });
});

describe('base64ToBytes (via readPdfFromUri)', () => {
  const sizes = [0, 1, 2, 3, 100, 250_000, 32768, 32769, 65536, 65537];

  it.each(sizes)('decodes %i bytes back to the exact original content', async (size) => {
    const original = pseudoRandomBytes(size, size + 13);
    const base64 = Buffer.from(original).toString('base64');

    stat.mockRejectedValueOnce(new Error('stat not supported for this uri'));
    readFile.mockResolvedValueOnce({ data: base64 });

    const result = await readPdfFromUri('content://fake/test.pdf');

    expect(result.bytes).toEqual(original);
  });
});

describe('listPrivateFolder', () => {
  it('uses fields from readdir directly, without per-entry getUri/stat calls', async () => {
    readdir.mockResolvedValueOnce({
      files: [
        { name: 'a.pdf', type: 'file', size: 123, mtime: 111, uri: 'file:///data/scans/a.pdf' },
        { name: 'sub', type: 'directory', size: 0, mtime: 222, uri: 'file:///data/scans/sub' },
      ],
    });

    const result = await listPrivateFolder('scans');

    expect(result).toEqual([
      { name: 'a.pdf', uri: 'file:///data/scans/a.pdf', size: 123, lastModified: 111, type: 'file' },
      { name: 'sub', uri: 'file:///data/scans/sub', size: 0, lastModified: 222, type: 'directory' },
    ]);
    expect(getUri).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it('auto-creates the folder and returns [] when readdir fails with the Android "does not exist" code', async () => {
    const error = Object.assign(new Error("'readdir' failed because file at 'scans' does not exist."), {
      code: 'OS-PLUG-FILE-0008',
    });
    readdir.mockRejectedValueOnce(error);
    mkdir.mockResolvedValueOnce(undefined);

    const result = await listPrivateFolder('scans');

    expect(result).toEqual([]);
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it('auto-creates the folder and returns [] on the web fallback\'s plain "does not exist" Error', async () => {
    readdir.mockRejectedValueOnce(new Error('Folder does not exist.'));
    mkdir.mockResolvedValueOnce(undefined);

    const result = await listPrivateFolder('scans');

    expect(result).toEqual([]);
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it('rethrows without attempting mkdir when the failure is not a missing-directory error', async () => {
    const permissionError = Object.assign(new Error('Unable to do file operation, user denied permission request.'), {
      code: 'OS-PLUG-FILE-0007',
    });
    readdir.mockRejectedValueOnce(permissionError);

    await expect(listPrivateFolder('scans')).rejects.toBe(permissionError);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('rethrows the original error if mkdir also fails after a genuine missing-directory error', async () => {
    const missingDirError = Object.assign(new Error('does not exist'), { code: 'OS-PLUG-FILE-0008' });
    readdir.mockRejectedValueOnce(missingDirError);
    mkdir.mockRejectedValueOnce(new Error('mkdir failed too'));

    await expect(listPrivateFolder('scans')).rejects.toBe(missingDirError);
  });
});

describe('printPdf', () => {
  it('writes the PDF to the cache directory and hands the plugin only its uri', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///cache/Front%20Side.pdf' });
    const bytes = pseudoRandomBytes(2048);

    await printPdf(bytes, 'Front Side.pdf', 'Front side PDF');

    // Written to Cache, not Data or Documents — it is a scratch copy.
    expect(writeFile).toHaveBeenCalledTimes(1);
    const write = writeFile.mock.calls[0][0];
    expect(write.directory).toBe('CACHE');
    expect(write.path).toBe('Front Side.pdf');

    // The whole point: the bridge sees a location, never the bytes. Pushing a
    // 50 MB PDF through as base64 is the memory problem fixed in 0.3.5.
    expect(printPdfUri).toHaveBeenCalledWith('file:///cache/Front%20Side.pdf', 'Front side PDF');
    const [uriArg, jobArg] = printPdfUri.mock.calls[0];
    expect(typeof uriArg).toBe('string');
    expect(typeof jobArg).toBe('string');
    expect(printPdfUri.mock.calls[0]).toHaveLength(2);
  });

  it('refuses before writing anything when the platform cannot print', async () => {
    canPrint.mockReturnValueOnce(false);

    // One call only — mockReturnValueOnce covers exactly one, and asserting on
    // the caught error keeps every check on that single rejection.
    const error = await printPdf(pseudoRandomBytes(64), 'x.pdf', 'x').then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(PrintUnavailableError);
    // Carries a code, so errorText() renders it in the user's language rather
    // than leaking the English developer message.
    expect(error).toMatchObject({ code: 'PRINT_UNAVAILABLE' });

    // No scratch file left behind on a platform that cannot use it.
    expect(writeFile).not.toHaveBeenCalled();
    expect(printPdfUri).not.toHaveBeenCalled();
  });

  it('shares and prints through the same cache write, so neither can drift', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///cache/doc.pdf' });
    const bytes = pseudoRandomBytes(512);

    await sharePdf(bytes, 'doc.pdf', 'title');
    const shareWrite = writeFile.mock.calls[0][0];
    writeFile.mockClear();

    await printPdf(bytes, 'doc.pdf', 'title');
    const printWrite = writeFile.mock.calls[0][0];

    expect(printWrite.directory).toBe(shareWrite.directory);
    expect(printWrite.recursive).toBe(shareWrite.recursive);
    expect(printWrite.data).toBe(shareWrite.data);
  });
});
