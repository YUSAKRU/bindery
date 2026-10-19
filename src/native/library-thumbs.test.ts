import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: fs,
}));

beforeEach(() => {
  vi.resetModules();
  fs.writeFile.mockReset();
  fs.readFile.mockReset();
  fs.deleteFile.mockReset();
});

describe('library-thumbs', () => {
  it('writes the base64 payload under .library/thumbs in Data and returns its relPath', async () => {
    const { writeLibraryThumb } = await import('./library-thumbs');
    fs.writeFile.mockResolvedValue({ uri: 'x' });
    expect(await writeLibraryThumb('r1', 'data:image/jpeg;base64,QUJD')).toBe('.library/thumbs/r1.jpg');
    expect(fs.writeFile).toHaveBeenCalledWith({
      path: '.library/thumbs/r1.jpg',
      data: 'QUJD',
      directory: 'DATA',
      recursive: true,
    });
  });

  it('write, read and delete failures never throw: write/read yield null', async () => {
    const { writeLibraryThumb, readLibraryThumb, deleteLibraryThumb } = await import('./library-thumbs');
    fs.writeFile.mockRejectedValue(new Error('disk full'));
    fs.readFile.mockRejectedValue(new Error('missing'));
    fs.deleteFile.mockRejectedValue(new Error('missing'));
    await expect(writeLibraryThumb('r1', 'data:image/jpeg;base64,QUJD')).resolves.toBeNull();
    await expect(readLibraryThumb('.library/thumbs/r2.jpg')).resolves.toBeNull();
    await expect(deleteLibraryThumb('.library/thumbs/r2.jpg')).resolves.toBeUndefined();
  });

  it('reads a stored thumbnail back as a JPEG data URL', async () => {
    const { readLibraryThumb } = await import('./library-thumbs');
    fs.readFile.mockResolvedValue({ data: 'QUJD' });
    expect(await readLibraryThumb('.library/thumbs/r3.jpg')).toBe('data:image/jpeg;base64,QUJD');
  });
});

// D7: renderPageThumbnail's optional mime/quality. Lives here (the library is
// its only JPEG caller) because pdf-thumbnails.ts has no test file of its own.
vi.mock('pdfjs-dist/build/pdf.min.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));

describe('renderPageThumbnail mime', () => {
  function fakeDoc() {
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => undefined,
    };
    return { getPage: async () => page } as never;
  }

  function stubCanvas() {
    const toDataURL = vi.fn((_mime?: string, _quality?: number) => 'data:x');
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, toDataURL }) });
    return toDataURL;
  }

  it('passes image/jpeg and the quality through to toDataURL', async () => {
    const toDataURL = stubCanvas();
    const { renderPageThumbnail } = await import('./pdf-thumbnails');
    await renderPageThumbnail(fakeDoc(), 1, 240, 'image/jpeg', 0.8);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8);
    vi.unstubAllGlobals();
  });

  it('still defaults to PNG for existing callers', async () => {
    const toDataURL = stubCanvas();
    const { renderPageThumbnail } = await import('./pdf-thumbnails');
    await renderPageThumbnail(fakeDoc(), 1, 96);
    expect(toDataURL.mock.calls[0][0]).toBe('image/png');
    vi.unstubAllGlobals();
  });
});
