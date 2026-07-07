import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  addPageNumbers,
  computeTextPosition,
  formatPageLabel,
  normalizeRotation,
  toContentSpacePosition,
} from './page-numbers-engine';
import { BookletError } from './types';

async function buildTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([300, 400]).pushOperators();
  }
  return doc.save();
}

async function buildRotatedTestPdf(rotationDegrees: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  page.setRotation(degrees(rotationDegrees));
  return doc.save();
}

async function buildOffsetTestPdf(x: number, y: number, width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);
  page.setMediaBox(x, y, width, height);
  return doc.save();
}

// Mirrors the private MARGIN constant in page-numbers-engine.ts.
const MARGIN = 24;

const NUM = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;
const TM_RE = new RegExp(`(${NUM}) (${NUM}) (${NUM}) (${NUM}) (${NUM}) (${NUM}) Tm`);

// A true 1:1 byte <-> char-code mapping. TextDecoder's "latin1" label actually
// resolves to windows-1252 per the WHATWG spec, which is lossy for bytes
// 0x80-0x9F, so plain String.fromCharCode/charCodeAt is used instead.
function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function binaryStringToBytes(str: string): Uint8Array {
  return Uint8Array.from(str, (ch) => ch.charCodeAt(0));
}

async function inflateDeflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBinaryString(new Uint8Array(buf));
}

/** Extracts the text matrix (a b c d e f) set right before the drawn page number, by
 * inflating the page's content stream(s) and locating the `Tm` operator. */
async function extractTextMatrix(pdfBytes: Uint8Array): Promise<{ a: number; b: number; c: number; d: number; e: number; f: number }> {
  const raw = bytesToBinaryString(pdfBytes);
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    // Strip the EOL that PDF requires before the `endstream` keyword - it's not
    // part of the compressed payload, and Node's DecompressionStream (unlike
    // zlib.inflateSync) rejects such trailing bytes as junk.
    const body = binaryStringToBytes(match[1].replace(/[\r\n]+$/, ''));
    let decoded: string;
    try {
      decoded = await inflateDeflate(body);
    } catch {
      decoded = bytesToBinaryString(body);
    }
    const tmMatch = TM_RE.exec(decoded);
    if (tmMatch && decoded.includes('Tj')) {
      const [, a, b, c, d, e, f] = tmMatch;
      return { a: Number(a), b: Number(b), c: Number(c), d: Number(d), e: Number(e), f: Number(f) };
    }
  }
  throw new Error('Text matrix not found in PDF content stream');
}

/**
 * Renders the PDF with pdf.js (independent of pdf-lib, the library used by
 * page-numbers-engine.ts itself) and reports where the first drawn text item
 * actually ends up in the rotation-aware viewport. This is the ground truth
 * for "what a viewer shows", so it catches a wrong-but-self-consistent
 * position formula that a round-trip test against the same formula would not.
 */
async function getVisiblePosition(
  pdfBytes: Uint8Array,
): Promise<{ x: number; y: number; viewportWidth: number; viewportHeight: number }> {
  const loadingTask = getDocument({ data: pdfBytes });
  try {
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const [item] = textContent.items as Array<{ transform: number[] }>;
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return { x, y, viewportWidth: viewport.width, viewportHeight: viewport.height };
  } finally {
    await loadingTask.destroy();
  }
}

describe('formatPageLabel', () => {
  it('formats a plain number', () => {
    expect(formatPageLabel('number', 5, 12)).toBe('5');
  });

  it('formats a number-of-total label', () => {
    expect(formatPageLabel('number-of-total', 5, 12)).toBe('Sayfa 5 / 12');
  });
});

describe('computeTextPosition', () => {
  const pageWidth = 300;
  const pageHeight = 400;
  const textWidth = 20;
  const fontSize = 10;
  const margin = 24;

  it('bottom-right anchors to the bottom-right corner', () => {
    expect(computeTextPosition('bottom-right', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 256,
      y: 24,
    });
  });

  it('bottom-left anchors to the bottom-left corner', () => {
    expect(computeTextPosition('bottom-left', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 24,
      y: 24,
    });
  });

  it('bottom-center centers horizontally at the bottom', () => {
    expect(computeTextPosition('bottom-center', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 140,
      y: 24,
    });
  });

  it('top-right anchors to the top-right corner', () => {
    expect(computeTextPosition('top-right', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 256,
      y: 366,
    });
  });

  it('top-left anchors to the top-left corner', () => {
    expect(computeTextPosition('top-left', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 24,
      y: 366,
    });
  });

  it('top-center centers horizontally at the top', () => {
    expect(computeTextPosition('top-center', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 140,
      y: 366,
    });
  });
});

describe('normalizeRotation', () => {
  it('passes through the four canonical angles', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it('wraps angles beyond a full turn and negative angles', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
  });
});

describe('toContentSpacePosition', () => {
  // Matches a 300x400 unrotated page: for /Rotate 90|270 the visible page seen
  // by a viewer is 400x300 (dimensions swapped).
  const visibleWidth = 400;
  const visibleHeight = 300;

  // Every expected value below is a fixed number, hand-derived from pdfjs-dist's
  // own PageViewport transform (node_modules/pdfjs-dist/legacy/build/pdf.mjs,
  // the `rotateA/B/C/D` switch) for a viewBox origin of (0,0), and cross-checked
  // by rendering with pdf.js directly (see the `addPageNumbers` rotation tests
  // below, which verify the same values end-to-end through a real render).
  // These are NOT derived by calling toContentSpacePosition/computeTextPosition
  // themselves, so a self-consistent-but-wrong implementation cannot pass both.

  it('is the identity for an unrotated page', () => {
    expect(toContentSpacePosition(24, 24, visibleWidth, visibleHeight, 0)).toEqual({ x: 24, y: 24 });
  });

  it('maps a bottom-left visible point for a /Rotate 90 page', () => {
    // pdf.js transform for rotation=90 is [a,b,c,d,e,f] = [0,1,1,0,0,0], i.e.
    // viewportX = contentY, viewportY = contentX. For the on-screen point to
    // land at (24, 24) in the 400x300 visible page, content must be (276, 24).
    expect(toContentSpacePosition(24, 24, visibleWidth, visibleHeight, 90)).toEqual({ x: 276, y: 24 });
  });

  it('maps a bottom-left visible point for a /Rotate 180 page', () => {
    expect(toContentSpacePosition(24, 24, visibleWidth, visibleHeight, 180)).toEqual({ x: 376, y: 276 });
  });

  it('maps a bottom-left visible point for a /Rotate 270 page', () => {
    // pdf.js transform for rotation=270 is [a,b,c,d,e,f] = [0,-1,-1,0,H,W], i.e.
    // viewportX = H - contentY, viewportY = W - contentX. For (24, 24) in the
    // 400x300 visible page, content must be (24, 376).
    expect(toContentSpacePosition(24, 24, visibleWidth, visibleHeight, 270)).toEqual({ x: 24, y: 376 });
  });
});

describe('addPageNumbers', () => {
  it('preserves page count while adding numbers', async () => {
    const input = await buildTestPdf(3);
    const result = await addPageNumbers(input, { position: 'bottom-right', format: 'number', startNumber: 1 });

    expect(result.pageCount).toBe(3);

    const outDoc = await PDFDocument.load(result.numberedPdf);
    expect(outDoc.getPageCount()).toBe(3);
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  });

  it('rejects a non-positive start number', async () => {
    const input = await buildTestPdf(2);
    await expect(
      addPageNumbers(input, { position: 'bottom-right', format: 'number', startNumber: 0 }),
    ).rejects.toBeInstanceOf(BookletError);
  });

  it('places the number in the visible bottom-left corner on a /Rotate 90 page', async () => {
    const input = await buildRotatedTestPdf(90);
    const result = await addPageNumbers(input, { position: 'bottom-left', format: 'number', startNumber: 1 });

    const outDoc = await PDFDocument.load(result.numberedPdf);
    // The unrotated MediaBox size and the /Rotate flag itself must be untouched.
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);

    const { a, b, c, d, e, f } = await extractTextMatrix(result.numberedPdf);
    // Text must carry a matching local rotation so it reads upright once the
    // viewer applies the page's own clockwise rotation.
    expect(Math.round(a)).toBe(0);
    expect(Math.round(b)).toBe(1);
    expect(Math.round(c)).toBe(-1);
    expect(Math.round(d)).toBe(0);
    // Fixed expectation (see the 'maps a bottom-left visible point for a
    // /Rotate 90 page' case above for the derivation) - not computed by
    // calling the engine's own helpers here.
    expect(e).toBeCloseTo(276);
    expect(f).toBeCloseTo(24);

    // Independent check: actually render with pdf.js and confirm the number
    // lands near the left edge and in the bottom half of the 400x300 visible
    // (post-rotation) viewport, not the top half.
    const visible = await getVisiblePosition(result.numberedPdf);
    expect(visible.viewportWidth).toBe(400);
    expect(visible.viewportHeight).toBe(300);
    expect(visible.x).toBeLessThan(visible.viewportWidth / 2);
    expect(visible.y).toBeGreaterThan(visible.viewportHeight / 2);
  });

  it('places the number in the visible bottom-left corner on a /Rotate 270 page', async () => {
    const input = await buildRotatedTestPdf(270);
    const result = await addPageNumbers(input, { position: 'bottom-left', format: 'number', startNumber: 1 });

    const outDoc = await PDFDocument.load(result.numberedPdf);
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
    expect(outDoc.getPage(0).getRotation().angle).toBe(270);

    const { e, f } = await extractTextMatrix(result.numberedPdf);
    expect(e).toBeCloseTo(24);
    expect(f).toBeCloseTo(376);

    const visible = await getVisiblePosition(result.numberedPdf);
    expect(visible.viewportWidth).toBe(400);
    expect(visible.viewportHeight).toBe(300);
    expect(visible.x).toBeLessThan(visible.viewportWidth / 2);
    expect(visible.y).toBeGreaterThan(visible.viewportHeight / 2);
  });

  it('accounts for a non-zero MediaBox origin so the number stays on the visible page', async () => {
    const input = await buildOffsetTestPdf(100, 200, 300, 400);
    const result = await addPageNumbers(input, { position: 'bottom-left', format: 'number', startNumber: 1 });

    const outDoc = await PDFDocument.load(result.numberedPdf);
    const mediaBox = outDoc.getPage(0).getMediaBox();
    expect(mediaBox).toEqual({ x: 100, y: 200, width: 300, height: 400 });

    const { e, f } = await extractTextMatrix(result.numberedPdf);
    // Absolute position must be offset by the MediaBox origin, not just the margin,
    // otherwise it lands below the visible page (y = 24 < mediaBox.y = 200).
    expect(e).toBeCloseTo(mediaBox.x + MARGIN);
    expect(f).toBeCloseTo(mediaBox.y + MARGIN);
    expect(f).toBeGreaterThan(mediaBox.y);
  });
});
