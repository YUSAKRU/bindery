import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above module-scope variable declarations, so the
// mock fns themselves must be created via vi.hoisted() to be visible inside them.
const { pickFiles } = vi.hoisted(() => ({ pickFiles: vi.fn() }));

const { writeFile, appendFile, readFile, readFileInChunks, readdir, mkdir, stat, getUri } = vi.hoisted(() => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  readFile: vi.fn(),
  readFileInChunks: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Data: 'DATA', Cache: 'CACHE' },
  Filesystem: { writeFile, appendFile, readFile, readFileInChunks, readdir, mkdir, stat, getUri },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn() },
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: { pickFiles },
}));

const { getPhoto } = vi.hoisted(() => ({ getPhoto: vi.fn() }));

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Camera: 'CAMERA' },
}));

const { printPdfUri, canPrint } = vi.hoisted(() => ({
  printPdfUri: vi.fn(),
  canPrint: vi.fn(() => true),
}));

vi.mock('./print', () => ({ printPdfUri, canPrint }));

const {
  savePdfPrivately,
  readPdfFromUri,
  listPrivateFolder,
  pickPdf,
  pickPdfs,
  printPdf,
  sharePdf,
  shareText,
  takePhoto,
  PhotoPathError,
  PrintUnavailableError,
} = await import('./file-bridge');
const { Share } = await import('@capacitor/share');

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

/**
 * Byte-exact comparison for multi-megabyte fixtures. expect().toEqual() walks
 * typed arrays element by element and takes seconds on a 4 MB array — long
 * enough to blow the default test timeout. Buffer.compare does it in one pass,
 * and on mismatch we point at the first bad byte, which is a better diff than
 * toEqual would print for an array this size anyway.
 */
function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  if (Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0) return;
  const at = actual.findIndex((b, i) => b !== expected[i]);
  throw new Error(
    `bytes differ at index ${at}: got ${actual[at]}, expected ${expected[at]} (length ${actual.length})`,
  );
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

/**
 * Stands in for the native side of readFileInChunks: slice the file into
 * chunkSize-byte pieces and base64-encode **each piece independently**, exactly
 * as Android does. That independence is the whole risk — if the chunk size were
 * not a multiple of 3, each piece would carry its own '=' padding and the
 * reassembled file would be corrupt. Encoding per chunk here is what makes
 * these tests able to catch that.
 */
function mockNativeChunkedRead(content: Uint8Array): void {
  readFileInChunks.mockImplementation(
    async (options: { chunkSize: number }, callback: (c: { data: string } | null, e?: unknown) => void) => {
      for (let i = 0; i < content.length; i += options.chunkSize) {
        const piece = content.subarray(i, i + options.chunkSize);
        callback({ data: Buffer.from(piece).toString('base64') });
      }
      callback({ data: '' }); // empty chunk = end of file
      return 'callback-id';
    },
  );
}

/**
 * The base64 helpers take the platform methods (Chrome/WebView 140+) when they
 * exist and the hand-rolled loops otherwise. Node 24 — what this suite runs on —
 * has neither, so without this block CI would only ever exercise the fallback
 * and the fast path could rot untested.
 *
 * Polyfilling with Buffer proves the *dispatch* is right and that both paths
 * agree byte for byte. It deliberately does not try to prove V8's own encoder
 * correct; that was verified on a real device (WebView 150), where all three
 * encoders produced identical output for a 50 MB payload.
 */
describe('base64 helpers: platform path and fallback agree', () => {
  const sizes = [0, 1, 2, 3, 100, 32766, 32767, 65533, 250_000];

  function installNativeBase64(): void {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value(this: Uint8Array) { return Buffer.from(this).toString('base64'); },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value(s: string) { return new Uint8Array(Buffer.from(s, 'base64')); },
      configurable: true,
      writable: true,
    });
  }

  function removeNativeBase64(): void {
    delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
    delete (Uint8Array as { fromBase64?: unknown }).fromBase64;
  }

  afterEach(() => {
    removeNativeBase64();
  });

  it('the host runtime really lacks these, so the fallback is what runs by default', () => {
    expect(typeof (Uint8Array.prototype as { toBase64?: unknown }).toBase64).toBe('undefined');
    expect(typeof (Uint8Array as { fromBase64?: unknown }).fromBase64).toBe('undefined');
  });

  it.each(sizes)('encodes %i bytes to the same string on both paths', async (size) => {
    const original = pseudoRandomBytes(size, size + 11);

    removeNativeBase64();
    writeFile.mockResolvedValueOnce({ uri: 'file://x' });
    await savePdfPrivately(original, 'scans/fallback.pdf');
    const viaFallback = writeFile.mock.calls[0][0].data as string;

    vi.clearAllMocks();

    installNativeBase64();
    writeFile.mockResolvedValueOnce({ uri: 'file://x' });
    await savePdfPrivately(original, 'scans/native.pdf');
    const viaNative = writeFile.mock.calls[0][0].data as string;

    expect(viaNative).toBe(viaFallback);
    expect(viaNative).toBe(Buffer.from(original).toString('base64'));
  });

  it.each(sizes)('decodes %i bytes identically on both paths', async (size) => {
    const original = pseudoRandomBytes(size, size + 17);

    removeNativeBase64();
    stat.mockResolvedValueOnce({ size, name: 'test.pdf' });
    mockNativeChunkedRead(original);
    const viaFallback = await readPdfFromUri('content://fake/test.pdf');
    expectBytesEqual(viaFallback.bytes, original);

    vi.clearAllMocks();

    installNativeBase64();
    stat.mockResolvedValueOnce({ size, name: 'test.pdf' });
    mockNativeChunkedRead(original);
    const viaNative = await readPdfFromUri('content://fake/test.pdf');
    expectBytesEqual(viaNative.bytes, original);
  });

  it('falls back to the loop when the platform decoder rejects the input', async () => {
    const original = pseudoRandomBytes(300, 5);
    // atob() skips ASCII whitespace; Uint8Array.fromBase64 throws on it. If a
    // platform ever hands back wrapped base64, the read must still succeed.
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value() { throw new SyntaxError('invalid character'); },
      configurable: true,
      writable: true,
    });
    stat.mockResolvedValueOnce({ size: original.length, name: 'wrapped.pdf' });
    mockNativeChunkedRead(original);

    const result = await readPdfFromUri('content://fake/wrapped.pdf');

    expectBytesEqual(result.bytes, original);
  });
});

describe('readPdfFromUri chunked reading', () => {
  // Sizes straddling the 1.5 MiB chunk boundary, so reassembly is exercised for
  // one chunk, an exact multiple, and a ragged tail.
  const sizes = [0, 1, 2, 3, 100, 250_000, 1_572_863, 1_572_864, 1_572_865, 4_000_000];

  it.each(sizes)('reassembles %i bytes byte-for-byte when the size is known', async (size) => {
    const original = pseudoRandomBytes(size, size + 13);
    stat.mockResolvedValueOnce({ size, name: 'test.pdf' });
    mockNativeChunkedRead(original);

    const result = await readPdfFromUri('content://fake/test.pdf');

    expectBytesEqual(result.bytes, original);
  });

  it.each([0, 3, 250_000, 1_572_865])(
    'reassembles %i bytes when stat gives no size (collect-and-join path)',
    async (size) => {
      const original = pseudoRandomBytes(size, size + 7);
      stat.mockRejectedValueOnce(new Error('stat not supported for this uri'));
      mockNativeChunkedRead(original);

      const result = await readPdfFromUri('content://fake/test.pdf');

      expectBytesEqual(result.bytes, original);
    },
  );

  it('asks for a chunk size that is a multiple of 3', async () => {
    stat.mockResolvedValueOnce({ size: 10, name: 'test.pdf' });
    mockNativeChunkedRead(pseudoRandomBytes(10));

    await readPdfFromUri('content://fake/test.pdf');

    const { chunkSize } = readFileInChunks.mock.calls[0][0];
    // Android passes chunkSize through unaligned, so getting this wrong yields
    // '=' padding mid-file and a silently corrupt PDF.
    expect(chunkSize % 3).toBe(0);
  });

  it('never asks for the whole file in one piece', async () => {
    stat.mockResolvedValueOnce({ size: 4_000_000, name: 'big.pdf' });
    mockNativeChunkedRead(pseudoRandomBytes(4_000_000));

    await readPdfFromUri('content://fake/big.pdf');

    // readFile() is what ran out of memory on a 48 MB PDF; it must not be used.
    expect(readFile).not.toHaveBeenCalled();
    expect(readFileInChunks).toHaveBeenCalledTimes(1);
  });

  it('survives a stat size smaller than what the provider streams', async () => {
    const original = pseudoRandomBytes(500_000, 3);
    stat.mockResolvedValueOnce({ size: 100, name: 'lying.pdf' }); // stat under-reports
    mockNativeChunkedRead(original);

    const result = await readPdfFromUri('content://fake/lying.pdf');

    expectBytesEqual(result.bytes, original);
  });

  it('rejects when a chunk reports an error mid-stream', async () => {
    stat.mockResolvedValueOnce({ size: 999, name: 'broken.pdf' });
    readFileInChunks.mockImplementation(
      async (_o: unknown, callback: (c: null, e?: unknown) => void) => {
        callback(null, new Error('read failed at chunk 2'));
        return 'callback-id';
      },
    );

    await expect(readPdfFromUri('content://fake/broken.pdf')).rejects.toThrow(/read failed/);
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

  it('resolves "canceled" instead of throwing when the share sheet is dismissed', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///cache/doc.pdf' });
    (Share.share as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Share canceled'));

    await expect(sharePdf(pseudoRandomBytes(64), 'doc.pdf', 'title')).resolves.toBe('canceled');
  });

  it('still throws — and is still logged — for a genuine share failure', async () => {
    writeFile.mockResolvedValue({ uri: 'file:///cache/doc.pdf' });
    (Share.share as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('only file urls are supported'));

    await expect(sharePdf(pseudoRandomBytes(64), 'doc.pdf', 'title')).rejects.toThrow(
      'only file urls are supported',
    );
  });

  it('shareText resolves "canceled" the same way sharePdf does, with no cache write', async () => {
    (Share.share as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Share canceled'));

    await expect(shareText('log contents', 'title')).resolves.toBe('canceled');
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('camera capture', () => {
  it('resolves photo bytes and format on successful camera capture', async () => {
    const rawBytes = pseudoRandomBytes(100);
    const mockBlob = new Blob([rawBytes as any]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      blob: () => Promise.resolve(mockBlob),
    } as Response);

    getPhoto.mockResolvedValueOnce({ webPath: 'blob:http://localhost/shot', format: 'jpeg' });

    const result = await takePhoto();
    expect(result).not.toBeNull();
    expect(result?.format).toBe('jpg');
    expect(result?.bytes).toEqual(rawBytes);
    fetchSpy.mockRestore();
  });

  it('resolves png format correctly', async () => {
    const rawBytes = pseudoRandomBytes(50);
    const mockBlob = new Blob([rawBytes as any]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      blob: () => Promise.resolve(mockBlob),
    } as Response);

    getPhoto.mockResolvedValueOnce({ webPath: 'blob:http://localhost/shot', format: 'png' });

    const result = await takePhoto();
    expect(result?.format).toBe('png');
    expect(result?.bytes).toEqual(rawBytes);
    fetchSpy.mockRestore();
  });

  it('resolves null instead of throwing when the camera is dismissed / cancelled', async () => {
    getPhoto.mockRejectedValueOnce(new Error('User cancelled photos app'));

    await expect(takePhoto()).resolves.toBeNull();
  });

  it('still throws — and is still logged — for a genuine camera failure', async () => {
    getPhoto.mockRejectedValueOnce(new Error('Device does not have a camera available'));

    await expect(takePhoto()).rejects.toThrow('Device does not have a camera available');
  });

  it('throws PhotoPathError when photo.webPath is missing', async () => {
    getPhoto.mockResolvedValueOnce({ webPath: undefined, format: 'jpeg' });

    await expect(takePhoto()).rejects.toThrow(PhotoPathError);
  });
});

describe('file picker reads', () => {
  it('streams the picked file from its uri instead of asking the plugin for the data', async () => {
    const original = pseudoRandomBytes(300_000, 5);
    pickFiles.mockResolvedValueOnce({
      files: [{ name: 'picked.pdf', size: original.length, path: 'content://picked/1', mimeType: 'application/pdf' }],
    });
    mockNativeChunkedRead(original);

    const result = await pickPdf();

    // readData:true made the plugin build one base64 string of the whole file —
    // the allocation that ran a 48 MB PDF out of heap. It must stay off.
    expect(pickFiles.mock.calls[0][0].readData).toBeUndefined();
    expect(readFileInChunks).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'content://picked/1' }),
      expect.any(Function),
    );
    expectBytesEqual(result!.bytes, original);
    expect(result!.name).toBe('picked.pdf');
  });

  it('still decodes inline data when a platform supplies it without a path', async () => {
    const original = pseudoRandomBytes(1_000, 9);
    pickFiles.mockResolvedValueOnce({
      files: [{ name: 'web.pdf', size: original.length, data: Buffer.from(original).toString('base64'), mimeType: 'application/pdf' }],
    });

    const result = await pickPdf();

    expect(readFileInChunks).not.toHaveBeenCalled();
    expectBytesEqual(result!.bytes, original);
  });

  it('rejects a multi-file pick whose combined size exceeds the limit before reading anything', async () => {
    pickFiles.mockResolvedValueOnce({
      files: [
        { name: 'a.pdf', size: 30 * 1024 * 1024, path: 'content://a', mimeType: 'application/pdf' },
        { name: 'b.pdf', size: 30 * 1024 * 1024, path: 'content://b', mimeType: 'application/pdf' },
      ],
    });

    await expect(pickPdfs()).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(readFileInChunks).not.toHaveBeenCalled();
  });
});

describe('chunked writes', () => {
  /** Rebuilds the file the way the native side would: decode each call's own base64. */
  function writtenBytes(): Uint8Array {
    const parts = [
      Buffer.from(writeFile.mock.calls[0][0].data, 'base64'),
      ...appendFile.mock.calls.map((c) => Buffer.from(c[0].data, 'base64')),
    ];
    return new Uint8Array(Buffer.concat(parts));
  }

  it.each([0, 1, 3, 1_572_863, 1_572_864, 1_572_865, 4_000_000])(
    'writes %i bytes back byte-for-byte across the chunk boundary',
    async (size) => {
      const original = pseudoRandomBytes(size, size + 3);
      writeFile.mockResolvedValueOnce({ uri: 'file://out.pdf' });
      appendFile.mockResolvedValue(undefined);

      await savePdfPrivately(original, 'out.pdf');

      expectBytesEqual(writtenBytes(), original);
    },
  );

  it('encodes every chunk on a 3-byte boundary', async () => {
    // A chunk that is not a whole number of 3-byte groups ends in '=' padding,
    // which would then sit in the middle of the file. Only the final chunk may
    // carry padding.
    const original = pseudoRandomBytes(4_000_000, 11);
    writeFile.mockResolvedValueOnce({ uri: 'file://out.pdf' });
    appendFile.mockResolvedValue(undefined);

    await savePdfPrivately(original, 'out.pdf');

    const all = [writeFile.mock.calls[0][0].data, ...appendFile.mock.calls.map((c) => c[0].data)];
    for (const data of all.slice(0, -1)) {
      expect(data.endsWith('=')).toBe(false);
    }
    expect(appendFile).toHaveBeenCalled();
  });

  it('starts with writeFile so a failed earlier save cannot be appended to', async () => {
    const original = pseudoRandomBytes(3_000_000, 21);
    writeFile.mockResolvedValueOnce({ uri: 'file://out.pdf' });
    appendFile.mockResolvedValue(undefined);

    await savePdfPrivately(original, 'out.pdf');

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0].recursive).toBe(true);
    expect(writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      appendFile.mock.invocationCallOrder[0],
    );
  });

  it('never encodes the whole file in one call', async () => {
    const original = pseudoRandomBytes(4_000_000, 31);
    writeFile.mockResolvedValueOnce({ uri: 'file://out.pdf' });
    appendFile.mockResolvedValue(undefined);

    await savePdfPrivately(original, 'out.pdf');

    // ~5.3 MB of base64 in one string is what killed the WebView on a booklet save.
    for (const data of [writeFile.mock.calls[0][0].data, ...appendFile.mock.calls.map((c) => c[0].data)]) {
      expect(data.length).toBeLessThan(3_000_000);
    }
  });
});
