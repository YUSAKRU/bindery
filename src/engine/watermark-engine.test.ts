/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addWatermark, computeCenteredRotatedPosition } from './watermark-engine';
import { BookletError } from './types';

// The engine fetches its bundled Unicode font via a Vite `?url` asset import,
// which resolves under vitest but can't be `fetch()`-ed as a plain Node test
// runner (it isn't an absolute http URL). Stub `fetch` to hand back the real
// TTF bytes from disk, so tests exercise the actual embedFont/fontkit path
// rather than a fake one.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fontFileBytes = readFileSync(resolve(__dirname, '../assets/fonts/NotoSans-Latin.ttf'));

function stubFontFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => fontFileBytes.buffer.slice(fontFileBytes.byteOffset, fontFileBytes.byteOffset + fontFileBytes.byteLength),
    })),
  );
}

// Minimal valid 1x1 PNG, used only to exercise embedPng — no fixture file needed.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function tinyPngBytes(): Uint8Array {
  const binary = atob(TINY_PNG_BASE64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function buildTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([300, 400]).pushOperators();
  }
  return doc.save();
}

beforeAll(() => {
  stubFontFetch();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('computeCenteredRotatedPosition', () => {
  it('centers unrotated content by simple half-extent offset', () => {
    expect(computeCenteredRotatedPosition(300, 400, 100, 50, 0)).toEqual({ x: 100, y: 175 });
  });

  it('swaps the offset axes for a 90° rotation', () => {
    const { x, y } = computeCenteredRotatedPosition(300, 400, 100, 50, 90);
    expect(x).toBeCloseTo(150 + 25, 5);
    expect(y).toBeCloseTo(200 - 50, 5);
  });

  it('computes a diagonal offset for a 45° rotation', () => {
    const { x, y } = computeCenteredRotatedPosition(200, 200, 100, 100, 45);
    // half-extents are equal (50,50); at 45° the rotated offset has a zero x-component.
    expect(x).toBeCloseTo(100, 5);
    expect(y).toBeCloseTo(100 - 50 * Math.SQRT2, 5);
  });
});

describe('addWatermark', () => {
  it('preserves page count and size for a text watermark', async () => {
    const input = await buildTestPdf(3);
    const result = await addWatermark(input, { type: 'text', text: 'TASLAK', opacity: 0.3, rotateDegrees: 45 });

    expect(result.pageCount).toBe(3);
    const outDoc = await PDFDocument.load(result.watermarkedPdf);
    expect(outDoc.getPageCount()).toBe(3);
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  });

  it('rejects an empty watermark text', async () => {
    const input = await buildTestPdf(1);
    await expect(
      addWatermark(input, { type: 'text', text: '   ', opacity: 0.3, rotateDegrees: 0 }),
    ).rejects.toBeInstanceOf(BookletError);
  });

  it('rejects an out-of-range opacity', async () => {
    const input = await buildTestPdf(1);
    await expect(
      addWatermark(input, { type: 'text', text: 'X', opacity: 1.5, rotateDegrees: 0 }),
    ).rejects.toBeInstanceOf(BookletError);
  });

  it('allows opacity 0 (invisible watermark)', async () => {
    const input = await buildTestPdf(1);
    await expect(
      addWatermark(input, { type: 'text', text: 'INVISIBLE', opacity: 0, rotateDegrees: 0 }),
    ).resolves.toBeDefined();
  });

  it('preserves page count for an image watermark', async () => {
    const input = await buildTestPdf(2);
    const result = await addWatermark(input, {
      type: 'image',
      imageBytes: tinyPngBytes(),
      imageFormat: 'png',
      opacity: 0.4,
      scale: 0.5,
      rotateDegrees: 0,
    });

    expect(result.pageCount).toBe(2);
    const outDoc = await PDFDocument.load(result.watermarkedPdf);
    expect(outDoc.getPageCount()).toBe(2);
  });

  // Regression test for [C1]: StandardFonts.HelveticaBold is WinAnsi-encoded and
  // throws on Turkish characters (`WinAnsi cannot encode "ş"`). This must succeed
  // against the bundled Unicode font and would fail against the old implementation.
  it('does not throw for Turkish characters', async () => {
    const input = await buildTestPdf(1);
    const result = await addWatermark(input, { type: 'text', text: 'ışğİŞĞ', opacity: 0.3, rotateDegrees: 0 });

    expect(result.pageCount).toBe(1);
    const outDoc = await PDFDocument.load(result.watermarkedPdf);
    expect(outDoc.getPageCount()).toBe(1);
  });

  it('does not throw for an em-dash and the Turkish lira sign', async () => {
    const input = await buildTestPdf(1);
    const result = await addWatermark(input, { type: 'text', text: 'Gizli — 100₺', opacity: 0.3, rotateDegrees: 0 });

    expect(result.pageCount).toBe(1);
    const outDoc = await PDFDocument.load(result.watermarkedPdf);
    expect(outDoc.getPageCount()).toBe(1);
  });

  it('does not fetch the watermark font for an image watermark', async () => {
    vi.resetModules();
    const fetchSpy = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
    vi.stubGlobal('fetch', fetchSpy);

    const { addWatermark: freshAddWatermark } = await import('./watermark-engine');
    const input = await buildTestPdf(1);
    await freshAddWatermark(input, {
      type: 'image',
      imageBytes: tinyPngBytes(),
      imageFormat: 'png',
      opacity: 0.4,
      scale: 0.5,
      rotateDegrees: 0,
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    // Restore the suite-wide font stub for any tests that run after this one.
    stubFontFetch();
  });
});
