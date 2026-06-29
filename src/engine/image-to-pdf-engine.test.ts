import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { imagesToPdf } from './image-to-pdf-engine';
import { BookletError } from './types';

// A tiny 1x1 transparent PNG file encoded in base64
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function getTinyPngBytes(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

describe('imagesToPdf', () => {
  it('successfully compiles a list of images into a multi-page PDF', async () => {
    const pngBytes = getTinyPngBytes();
    const images = [
      { bytes: pngBytes, format: 'png' as const },
      { bytes: pngBytes, format: 'png' as const },
    ];

    const pdfBytes = await imagesToPdf(images);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);

    // Each page size must be A4 (595.28 x 841.89 pt)
    const page1 = doc.getPage(0);
    expect(page1.getWidth()).toBeCloseTo(595.28);
    expect(page1.getHeight()).toBeCloseTo(841.89);
  });

  it('rejects compiling an empty image array', async () => {
    await expect(imagesToPdf([])).rejects.toBeInstanceOf(BookletError);
  });

  it('rejects an unsupported image format and preserves BookletError identity', async () => {
    const pngBytes = getTinyPngBytes();
    // Cast to bypass TypeScript — simulates a runtime caller passing an unsupported format
    const badInput = [{ bytes: pngBytes, format: 'webp' as 'png' }];
    const error = await imagesToPdf(badInput).catch((e) => e);
    expect(error).toBeInstanceOf(BookletError);
    // Must not be re-wrapped: the original BookletError should surface directly
    expect(error.message).toContain('Desteklenmeyen görsel formatı');
  });
});
