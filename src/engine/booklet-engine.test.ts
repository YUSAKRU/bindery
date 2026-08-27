/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildInstructionsLines, makeInstructionsPage } from './instructions-page';
import type { InstructionsData } from './instructions-page';

// Wrap the real sheet so tests can see what makeBooklet passes it, while still
// producing a genuine PDF for the structural assertions below.
vi.mock('./instructions-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./instructions-page')>();
  return { ...actual, makeInstructionsPage: vi.fn(actual.makeInstructionsPage) };
});
import {
  computeCollationMarkRect,
  computeSheetMapping,
  computeSignatureMappings,
  computeSlotRects,
  makeBooklet,
  mirrorMapping,
  modePageSize,
  resolveSheetSize,
  resolveSignatureSize,
  signatureStartPages,
} from './booklet-engine';
import { BookletError } from './types';


// makeBooklet's instructions sheet now embeds a Unicode font subset, fetched
// through a Vite `?url` asset import. Feed it the real bytes from disk so these
// tests exercise the true path rather than a stub.
const __dirname = dirname(fileURLToPath(import.meta.url));
const readFont = (name: string) => {
  const b = readFileSync(resolve(__dirname, `../assets/fonts/${name}`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const FONT_REGULAR = readFont('NotoSans-Latin.ttf');
const FONT_BOLD = readFont('NotoSans-Latin-Bold.ttf');

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => (String(url).includes('Bold') ? FONT_BOLD : FONT_REGULAR),
    })),
  );
});
afterAll(() => vi.unstubAllGlobals());

/**
 * Captures the InstructionsData makeBooklet hands to the sheet.
 *
 * These assertions used to grep the generated PDF's content stream, which
 * worked only because the sheet drew ASCII through a WinAnsi StandardFont.
 * Localising it (Turkish needs ı/ş/ğ/İ) means embedding a Unicode subset, and
 * subset-encoded text is not readable in the stream any more. Asserting on the
 * data passed across the boundary is both possible again and a more direct test
 * of what makeBooklet is actually responsible for.
 *
 * Uses vi.mock rather than reassigning the module namespace: booklet-engine
 * binds the import at load time, so patching the namespace object afterwards
 * would not be seen by it.
 */
async function instructionsDataFor(
  input: Uint8Array,
  options: Parameters<typeof makeBooklet>[1],
): Promise<InstructionsData> {
  const spy = vi.mocked(makeInstructionsPage);
  spy.mockClear();
  await makeBooklet(input, options);
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0][0];
}

/** Asserts a synchronous throw is a BookletError carrying the given code. */
function expectThrowsCode(fn: () => unknown, code: string): void {
  let error: unknown;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error).toBeInstanceOf(BookletError);
  expect((error as BookletError).code).toBe(code);
}

/** Asserts a promise rejects with a BookletError carrying the given code. */
async function expectRejectsCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error('expected promise to reject, but it resolved');
    },
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(BookletError);
  expect((error as BookletError).code).toBe(code);
}

import type { BookletOptions } from './types';

/** One drawn source page as reconstructed from the sheet's content stream. */
interface DrawnPage {
  /** translate operator: [a, b, c, d, e=X, f=Y] */
  translate: number[];
  /** rotate operator: [a, b, c, d, 0, 0] */
  rotate: number[];
  /** scale operator: [sx, 0, 0, sy, 0, 0] */
  scale: number[];
}

/** Decodes the content stream of a single page (index `pageIndex`) as text. */
function pageStreamText(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
    .join('\n');
}

/**
 * Reconstructs the drawn pages from a sheet's content stream by reading the
 * raw `cm` matrices pdf-lib emits (translate, rotate, scale, skew per draw).
 * This inspects the OUTPUT only — it never calls the production layout code —
 * so assertions against it are not self-referential.
 */
async function drawnPagesOf(pdf: Uint8Array, pageIndex = 0): Promise<DrawnPage[]> {
  const doc = await PDFDocument.load(pdf);
  const text = pageStreamText(doc, pageIndex);
  const num = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
  const cmRx = new RegExp(Array(6).fill(num).join(' ') + ' cm', 'g');
  const mats = [...text.matchAll(cmRx)].map((m) => m.slice(1, 7).map(Number));
  const draws: DrawnPage[] = [];
  // pdf-lib emits exactly four cm operators per drawPage: translate, rotate,
  // scale, skew — in that order.
  for (let i = 0; i + 3 < mats.length; i += 4) {
    draws.push({ translate: mats[i], rotate: mats[i + 1], scale: mats[i + 2] });
  }
  return draws;
}

async function buildTestPdf(pageCount: number, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    // pushOperators() forces a (possibly empty) Contents stream to exist,
    // which embedPdf() requires of every source page.
    doc.addPage(size).pushOperators();
  }
  return doc.save();
}

/** Builds an in-memory PDFDocument whose pages have the given per-page sizes. */
async function buildMixedDoc(sizes: Array<[number, number]>): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const size of sizes) {
    doc.addPage(size).pushOperators();
  }
  return doc;
}

describe('computeSheetMapping', () => {
  // Worked example from docs/SPECIFICATION.md: 16-page document, sheet 1
  // (1-based) -> Front: page16(left)|page1(right), Back: page2(left)|page15(right)
  it('matches the documented 16-page example for sheet 1', () => {
    const sheets = computeSheetMapping(16);
    expect(sheets).toHaveLength(4);
    expect(sheets[0]).toEqual({ frontLeft: 15, frontRight: 0, backLeft: 1, backRight: 14 });
  });

  it('covers every page index exactly once across front+back slots', () => {
    const N = 24;
    const sheets = computeSheetMapping(N);
    const used = sheets.flatMap((s) => [s.frontLeft, s.frontRight, s.backLeft, s.backRight]);
    expect(used.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
  });

  it('produces N/4 sheets', () => {
    expect(computeSheetMapping(8)).toHaveLength(2);
    expect(computeSheetMapping(20)).toHaveLength(5);
  });
});

describe('computeSlotRects', () => {
  // Hand-computed against wSlot = 842/2 = 421, hSlot = 595. Constants below are
  // written out literally (NOT recomputed from the production formula).
  it('places the two slots edge-to-edge with no gutter or creep', () => {
    const { left, right } = computeSlotRects(0, 0, 0);
    expect(left).toEqual({ x: 0, y: 0, width: 421, height: 595 });
    expect(right).toEqual({ x: 421, y: 0, width: 421, height: 595 });
  });

  it('shifts both slots outward by half the gutter', () => {
    // gutter = 10 -> shiftInward = -5 -> left.x = -5, right.x = 421 - (-5) = 426
    const { left, right } = computeSlotRects(0, 10, 0);
    expect(left.x).toBe(-5);
    expect(right.x).toBe(426);
    expect(left).toEqual({ x: -5, y: 0, width: 421, height: 595 });
    expect(right).toEqual({ x: 426, y: 0, width: 421, height: 595 });
  });

  it('shifts slots inward by creep * sheetIndex', () => {
    // creep = 2, gutter = 0:
    //   j = 0 -> shiftInward = 0  -> left.x = 0, right.x = 421
    expect(computeSlotRects(0, 0, 2).left.x).toBe(0);
    expect(computeSlotRects(0, 0, 2).right.x).toBe(421);
    //   j = 1 -> shiftInward = 2  -> left.x = 2, right.x = 419
    expect(computeSlotRects(1, 0, 2).left.x).toBe(2);
    expect(computeSlotRects(1, 0, 2).right.x).toBe(419);
    //   j = 3 -> shiftInward = 6  -> left.x = 6, right.x = 415
    expect(computeSlotRects(3, 0, 2).left.x).toBe(6);
    expect(computeSlotRects(3, 0, 2).right.x).toBe(415);
  });

  it('combines gutter and creep (gutter = 10, creep = 4, j = 2)', () => {
    // shiftInward = 2*4 - 10/2 = 8 - 5 = 3 -> left.x = 3, right.x = 418
    const { left, right } = computeSlotRects(2, 10, 4);
    expect(left.x).toBe(3);
    expect(right.x).toBe(418);
  });
});

describe('modePageSize', () => {
  it('returns the most common size, ignoring a stray final page', async () => {
    const sizes: Array<[number, number]> = [
      [595, 842], [595, 842], [595, 842], [595, 842],
      [595, 842], [595, 842], [595, 842], [595, 842],
      [842, 595],
    ];
    const doc = await buildMixedDoc(sizes);
    expect(modePageSize(doc, 9)).toEqual([595, 842]);
  });

  it('breaks ties in favour of the first page size', async () => {
    const doc = await buildMixedDoc([[595, 842], [595, 842], [400, 300], [400, 300]]);
    expect(modePageSize(doc, 4)).toEqual([595, 842]);
  });

  it('groups sizes that differ by less than the tolerance', async () => {
    // 595.3 vs 595.0 and 842.4 vs 842.0 are within 0.5pt -> counted together.
    const doc = await buildMixedDoc([[595, 842], [595.3, 842.4], [595.2, 841.7], [300, 300]]);
    expect(modePageSize(doc, 4)).toEqual([595, 842]);
  });
});

describe('makeBooklet', () => {
  it('pads a non-multiple-of-4 page count up to the next multiple of 4', async () => {
    const input = await buildTestPdf(10);
    const result = await makeBooklet(input);
    expect(result.originalPages).toBe(10);
    expect(result.paddingApplied).toBe(2);
    expect(result.paddedPages).toBe(12);
    expect(result.sheetsCount).toBe(3);
  });

  it('applies no padding when the page count is already a multiple of 4', async () => {
    const input = await buildTestPdf(16);
    const result = await makeBooklet(input);
    expect(result.paddingApplied).toBe(0);
    expect(result.paddedPages).toBe(16);
    expect(result.sheetsCount).toBe(4);
  });

  it('produces front/back PDFs with one page per sheet', async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input);
    const frontDoc = await PDFDocument.load(result.frontPdf);
    const backDoc = await PDFDocument.load(result.backPdf);
    expect(frontDoc.getPageCount()).toBe(result.sheetsCount);
    expect(backDoc.getPageCount()).toBe(result.sheetsCount);
  });

  it('produces combined PDF with 2 * sheetsCount pages', async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input);
    const combinedDoc = await PDFDocument.load(result.combinedPdf);
    expect(combinedDoc.getPageCount()).toBe(2 * result.sheetsCount);
  });

  it('pads using the mode page size, not the stray last page (E7)', async () => {
    // 9 pages: first 8 portrait [595,842], last one landscape [842,595].
    // Padding should add 3 pages using the mode (portrait) size, not landscape.
    const doc = await buildMixedDoc([
      [595, 842], [595, 842], [595, 842], [595, 842],
      [595, 842], [595, 842], [595, 842], [595, 842],
      [842, 595],
    ]);
    // The padding size is exactly what modePageSize reports for this document.
    expect(modePageSize(doc, 9)).toEqual([595, 842]);

    const input = await doc.save();
    const result = await makeBooklet(input);
    expect(result.originalPages).toBe(9);
    expect(result.paddingApplied).toBe(3);
    expect(result.paddedPages).toBe(12);
  });

  it('rejects a creep so large the last sheet overflows its slot', async () => {
    // 40 pages -> S = 10 sheets. Last-sheet shift = 9 * 25 = 225pt > 210.5pt.
    const input = await buildTestPdf(40);
    await expect(makeBooklet(input, { creep: 25 })).rejects.toThrow(/creep/i);
  });

  it('accepts a reasonable creep that stays within the slot', async () => {
    // 40 pages -> S = 10 sheets. Last-sheet shift = 9 * 5 = 45pt < 210.5pt.
    const input = await buildTestPdf(40);
    await expect(makeBooklet(input, { creep: 5 })).resolves.toBeDefined();
  });
});

describe('makeBooklet flipEdge', () => {
  // ---- Hand-computed geometry (source page 595x842 fitted into a 421x595 slot) ----
  // Uniform-height fit: scale = min(421/595, 595/842) = 595/842 = 0.7066508...
  // Scaled page width  = 595 * 0.7066508 = 420.4572...  (height fills 595 exactly).
  // Left slot centring : x = (421 - 420.4572)/2 = 0.27138 ;  y = 0.
  // Right slot         : x = 421 + 0.27138     = 421.27138 ; y = 0.
  // The numbers below are derived by hand from that geometry, NOT read back from
  // the production layout functions.
  const SCALE = 0.7066508; // 595 / 842
  const SHORT_LEFT_X = 0.27138;
  const SHORT_RIGHT_X = 421.27138;
  const SHEET_W = 842;
  const SHEET_H = 595;

  function expectTranslate(draw: DrawnPage, x: number, y: number): void {
    expect(draw.translate[4]).toBeCloseTo(x, 3);
    expect(draw.translate[5]).toBeCloseTo(y, 3);
  }
  function expectScale(draw: DrawnPage, s: number): void {
    expect(draw.scale[0]).toBeCloseTo(s, 5);
    expect(draw.scale[3]).toBeCloseTo(s, 5);
  }
  function expectRotation(draw: DrawnPage, a: number, d: number): void {
    expect(draw.rotate[0]).toBeCloseTo(a, 6); // cos component
    expect(draw.rotate[3]).toBeCloseTo(d, 6);
    expect(draw.rotate[1]).toBeCloseTo(0, 6); // sin components ~ 0 (0° / 180°)
    expect(draw.rotate[2]).toBeCloseTo(0, 6);
  }

  it("short-mode back sheet draws upright at the hand-computed offsets", async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input, { flipEdge: 'short' });
    const [left, right] = await drawnPagesOf(result.backPdf, 0);

    expectScale(left, SCALE);
    expectRotation(left, 1, 1); // identity: no rotation
    expectTranslate(left, SHORT_LEFT_X, 0);
    expectTranslate(right, SHORT_RIGHT_X, 0);
  });

  it("long-mode back sheet is the short back rotated 180° about the sheet centre", async () => {
    const input = await buildTestPdf(8);
    const shortBack = await drawnPagesOf((await makeBooklet(input, { flipEdge: 'short' })).backPdf, 0);
    const longBack = await drawnPagesOf((await makeBooklet(input, { flipEdge: 'long' })).backPdf, 0);

    for (let i = 0; i < shortBack.length; i++) {
      // 180° means a negative-scale matrix, NOT a mirror (which would be
      // [-s 0 0 s ...] or [s 0 0 -s ...]). Both diagonal terms flip sign.
      expectRotation(longBack[i], -1, -1);
      // Point reflection about the sheet centre: (x,y) -> (842 - x, 595 - y),
      // computed from the short-mode output, not from production code.
      expectTranslate(longBack[i], SHEET_W - shortBack[i].translate[4], SHEET_H - shortBack[i].translate[5]);
      // Same magnitude of scale in both modes.
      expectScale(longBack[i], shortBack[i].scale[0]);
    }

    // And it matches the absolute hand-computed anchors too.
    expectTranslate(longBack[0], SHEET_W - SHORT_LEFT_X, SHEET_H); // 841.72862, 595
    expectTranslate(longBack[1], SHEET_W - SHORT_RIGHT_X, SHEET_H); // 420.72862, 595
  });

  it('leaves the FRONT sheet identical in long mode (only the back is rotated)', async () => {
    const input = await buildTestPdf(8);
    const shortFront = await drawnPagesOf((await makeBooklet(input, { flipEdge: 'short' })).frontPdf, 0);
    const longFront = await drawnPagesOf((await makeBooklet(input, { flipEdge: 'long' })).frontPdf, 0);
    expect(longFront).toEqual(shortFront);
    // Explicitly: front is never rotated.
    expectRotation(longFront[0], 1, 1);
    expectTranslate(longFront[0], SHORT_LEFT_X, 0);
  });

  it('produces the same layout with no options as with flipEdge:short (default preserved)', async () => {
    const input = await buildTestPdf(8);
    const defaultBack = await drawnPagesOf((await makeBooklet(input)).backPdf, 0);
    const shortBack = await drawnPagesOf((await makeBooklet(input, { flipEdge: 'short' })).backPdf, 0);
    expect(defaultBack).toEqual(shortBack);
  });

  it('rejects an invalid flipEdge value with a BookletError', async () => {
    const input = await buildTestPdf(8);
    await expectRejectsCode(
      makeBooklet(input, { flipEdge: 'diagonal' } as unknown as BookletOptions),
      'BOOKLET_INVALID_FLIP_EDGE',
    );
  });
});

describe('resolveSheetSize', () => {
  it('returns the documented landscape presets (hand constants)', () => {
    expect(resolveSheetSize(undefined)).toEqual([842, 595]); // default = A4
    expect(resolveSheetSize('A4')).toEqual([842, 595]);
    expect(resolveSheetSize('Letter')).toEqual([792, 612]);
    expect(resolveSheetSize('A5')).toEqual([595, 420]);
    expect(resolveSheetSize('A3')).toEqual([1191, 842]);
  });

  it("derives 'source' as [2 * modeWidth, modeHeight]", async () => {
    const doc = await buildMixedDoc([[595, 842], [595, 842], [595, 842]]);
    // Portrait 595x842 source -> sheet 1190 x 842.
    expect(resolveSheetSize('source', doc, 3)).toEqual([1190, 842]);
  });

  it("throws when 'source' sheet dimensions are out of bounds", async () => {
    // 2 * 30 = 60 < MIN_SHEET_PT (72)
    const docSmall = await buildMixedDoc([[30, 100]]);
    expectThrowsCode(() => resolveSheetSize('source', docSmall, 1), 'BOOKLET_INVALID_SHEET_SIZE');

    // 2 * 8000 = 16000 > MAX_SHEET_PT (14400)
    const docLarge = await buildMixedDoc([[8000, 500]]);
    expectThrowsCode(() => resolveSheetSize('source', docLarge, 1), 'BOOKLET_INVALID_SHEET_SIZE');
  });

  it("throws when 'source' is requested without a document", () => {
    expect(() => resolveSheetSize('source')).toThrow(/source/i);
  });

  it('accepts custom sizes inside [72, 14400] and rejects out-of-bounds ones', () => {
    expect(resolveSheetSize({ width: 1000, height: 700 })).toEqual([1000, 700]);
    expect(resolveSheetSize({ width: 72, height: 72 })).toEqual([72, 72]);
    expect(resolveSheetSize({ width: 14400, height: 14400 })).toEqual([14400, 14400]);
    // 71pt is below the 72pt floor.
    expectThrowsCode(() => resolveSheetSize({ width: 71, height: 500 }), 'BOOKLET_INVALID_SHEET_SIZE');
    // 14401pt exceeds the PDF 14400pt page cap.
    expectThrowsCode(() => resolveSheetSize({ width: 500, height: 14401 }), 'BOOKLET_INVALID_SHEET_SIZE');
  });

  it('rejects an unknown preset string', () => {
    expectThrowsCode(() => resolveSheetSize('B5' as never), 'BOOKLET_UNKNOWN_PAPER_PRESET');
  });
});

describe('makeBooklet paperSize', () => {
  function expectDraw(
    draw: DrawnPage,
    x: number,
    y: number,
    scale: number,
    rot: [number, number] = [1, 1],
  ): void {
    expect(draw.translate[4]).toBeCloseTo(x, 3);
    expect(draw.translate[5]).toBeCloseTo(y, 3);
    expect(draw.scale[0]).toBeCloseTo(scale, 6);
    expect(draw.scale[3]).toBeCloseTo(scale, 6);
    expect(draw.rotate[0]).toBeCloseTo(rot[0], 6);
    expect(draw.rotate[3]).toBeCloseTo(rot[1], 6);
    expect(draw.rotate[1]).toBeCloseTo(0, 6);
    expect(draw.rotate[2]).toBeCloseTo(0, 6);
  }

  // ---- Hand-computed Letter geometry (INDEPENDENTLY derived) ----
  // Sheet Letter landscape = 792 x 612 ; slot = 396 x 612.
  // Source 595 x 842 into slot: scale = min(396/595, 612/842) = 396/595 = 0.6655462 (width-bound).
  // Drawn width  = 595 * 0.6655462 = 396.0 (fills slot width exactly).
  // Drawn height = 842 * 0.6655462 = 842 * 396 / 595 = 560.38992.
  // Vertical centring y = (612 - 560.38992) / 2 = 25.80504.  (NOT 25.72)
  // Left slot x = 0 ; right slot x = 396.
  const LETTER_SCALE = 0.6655462;
  const LETTER_Y = 25.80504;
  const LETTER_LONG_Y = 612 - LETTER_Y; // 586.19496

  it('lays a Letter sheet out at the hand-computed offsets', async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input, { paperSize: 'Letter' });

    // Both front & back sheets are 792 x 612.
    const backDoc = await PDFDocument.load(result.backPdf);
    expect(backDoc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });

    const [left, right] = await drawnPagesOf(result.backPdf, 0);
    expectDraw(left, 0, LETTER_Y, LETTER_SCALE);
    expectDraw(right, 396, LETTER_Y, LETTER_SCALE);
  });

  it('reflects the Letter back sheet about the Letter centre in long mode', async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input, { paperSize: 'Letter', flipEdge: 'long' });
    const [left, right] = await drawnPagesOf(result.backPdf, 0);

    // Point reflection uses 792 x 612 (the SHEET size), not A4 842 x 595:
    //   left : (792 - 0,   612 - 25.80504) = (792, 586.19496)
    //   right: (792 - 396, 612 - 25.80504) = (396, 586.19496)
    expectDraw(left, 792, LETTER_LONG_Y, LETTER_SCALE, [-1, -1]);
    expectDraw(right, 396, LETTER_LONG_Y, LETTER_SCALE, [-1, -1]);
  });

  it('produces the same layout with no options as with paperSize:A4 (default preserved)', async () => {
    const input = await buildTestPdf(8);
    const defaultBack = await drawnPagesOf((await makeBooklet(input)).backPdf, 0);
    const a4Back = await drawnPagesOf((await makeBooklet(input, { paperSize: 'A4' })).backPdf, 0);
    expect(defaultBack).toEqual(a4Back);
  });

  it("sizes an 'source' sheet to twice the source page width", async () => {
    // 8 portrait pages 595x842 -> sheet 1190 x 842.
    const input = await buildTestPdf(8, [595, 842]);
    const result = await makeBooklet(input, { paperSize: 'source' });
    const backDoc = await PDFDocument.load(result.backPdf);
    expect(backDoc.getPage(0).getSize()).toEqual({ width: 1190, height: 842 });
  });

  it('scales the gutter bound to the selected sheet width', async () => {
    const input = await buildTestPdf(8);
    // A5 slot half-width = 595/2 = 297.5 -> gutter 300 overflows.
    await expect(makeBooklet(input, { paperSize: 'A5', gutter: 300 })).rejects.toThrow(/gutter/i);
    // A4 slot half-width = 842/2 = 421 -> the same gutter is fine.
    await expect(makeBooklet(input, { paperSize: 'A4', gutter: 300 })).resolves.toBeDefined();
  });

  it('rejects a custom sheet size outside the PDF page bounds', async () => {
    const input = await buildTestPdf(8);
    await expectRejectsCode(
      makeBooklet(input, { paperSize: { width: 50, height: 500 } }),
      'BOOKLET_INVALID_SHEET_SIZE',
    );
  });
});

describe('computeSignatureMappings', () => {
  it('matches the hand-derived 16-page / 8-per-signature example', () => {
    // Two signatures of two sheets each. Signature 2 == signature 1 shifted +8.
    // Derived by hand from the saddle-stitch formula on each 8-page range.
    const sigs = computeSignatureMappings(16, 8);
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toEqual([
      { frontLeft: 7, frontRight: 0, backLeft: 1, backRight: 6 },
      { frontLeft: 5, frontRight: 2, backLeft: 3, backRight: 4 },
    ]);
    expect(sigs[1]).toEqual([
      { frontLeft: 15, frontRight: 8, backLeft: 9, backRight: 14 },
      { frontLeft: 13, frontRight: 10, backLeft: 11, backRight: 12 },
    ]);
  });

  it('covers every page index exactly once for several N / signatureSize combos', () => {
    const cases: Array<{ N: number; size: number }> = [
      { N: 32, size: 8 },
      { N: 48, size: 16 },
      { N: 20, size: 16 }, // last signature is only 4 pages
    ];
    for (const { N, size } of cases) {
      const used = computeSignatureMappings(N, size)
        .flat()
        .flatMap((s) => [s.frontLeft, s.frontRight, s.backLeft, s.backRight]);
      expect(used.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: N }, (_, i) => i),
      );
    }
  });

  it("resolves the 'auto' threshold: <=40 single, >40 into 16-page signatures", () => {
    // Sheet counts per signature: 16 pages -> 4 sheets, 12 pages -> 3 sheets.
    expect(computeSignatureMappings(40, 'auto')).toHaveLength(1); // 40 <= 40
    const auto44 = computeSignatureMappings(44, 'auto');
    expect(auto44.map((s) => s.length)).toEqual([4, 4, 3]); // 16 + 16 + 12 pages
  });

  it('treats undefined and a size >= N as a single signature', () => {
    expect(computeSignatureMappings(16)).toHaveLength(1);
    expect(computeSignatureMappings(16, 32)).toHaveLength(1);
    expect(computeSignatureMappings(16)[0]).toEqual(computeSheetMapping(16));
  });

  it('balances the remainder across signatures instead of dumping it in the last one', () => {
    // Naive fixed-size chunking of 56 pages at 16-per-signature would give
    // 16/16/16/8 (4/4/4/2 sheets) — one thin "runt" signature. Balancing
    // spreads the remainder for a sturdier, more even spine.
    const sigs = computeSignatureMappings(56, 16);
    expect(sigs.map((s) => s.length)).toEqual([4, 4, 3, 3]); // sheets/signature -> 16/16/12/12 pages
  });

  it('keeps the same signature count as naive chunking, only redistributing pages', () => {
    // Same ceil(N/signatureSize) signature count either way.
    expect(computeSignatureMappings(56, 16)).toHaveLength(4);
  });
});

describe('resolveSignatureSize', () => {
  it('returns the whole document for undefined / auto-below-threshold', () => {
    expect(resolveSignatureSize(24)).toBe(24);
    expect(resolveSignatureSize(40, 'auto')).toBe(40);
    expect(resolveSignatureSize(44, 'auto')).toBe(16);
  });

  it('rejects non-positive, non-multiple-of-4, and non-integer sizes', () => {
    for (const bad of [0, -4, 6, 3.5]) {
      expectThrowsCode(() => resolveSignatureSize(16, bad), 'BOOKLET_INVALID_SIGNATURE_SIZE');
    }
    expect(resolveSignatureSize(16, 8)).toBe(8);
  });
});

describe('makeBooklet signatureSize', () => {
  it('reports signaturesCount', async () => {
    const single = await makeBooklet(await buildTestPdf(16));
    expect(single.signaturesCount).toBe(1);
    const split = await makeBooklet(await buildTestPdf(16), { signatureSize: 8 });
    expect(split.signaturesCount).toBe(2);
    expect(split.sheetsCount).toBe(4); // 2 signatures x 2 sheets
  });

  it('restarts creep at each signature (verified from the output stream)', async () => {
    // 16 pages, 8-per-signature, creep=2. Sheet order in the back PDF:
    //   page 0 = sig1 sheet0 (local index 0)
    //   page 1 = sig1 sheet1 (local index 1)
    //   page 2 = sig2 sheet0 (local index 0)  <- creep reset to 0 here
    //   page 3 = sig2 sheet1 (local index 1)
    const input = await buildTestPdf(16);
    const result = await makeBooklet(input, { signatureSize: 8, creep: 2 });

    const sig1sheet0 = await drawnPagesOf(result.backPdf, 0);
    const sig1sheet1 = await drawnPagesOf(result.backPdf, 1);
    const sig2sheet0 = await drawnPagesOf(result.backPdf, 2);

    // Creep reset: the first sheet of signature 2 has the SAME transform as the
    // first sheet of signature 1 (output-to-output, not recomputed).
    expect(sig2sheet0).toEqual(sig1sheet0);

    // Within a signature, local index 1 shifts the left slot inward by exactly
    // creep = 2pt versus local index 0 (hand constant).
    expect(sig1sheet1[0].translate[4] - sig1sheet0[0].translate[4]).toBeCloseTo(2, 6);
  });

  it('produces byte-identical layout for undefined vs an explicit single signature', async () => {
    const input = await buildTestPdf(16);
    const a = await drawnPagesOf((await makeBooklet(input)).backPdf, 0);
    const b = await drawnPagesOf((await makeBooklet(input, { signatureSize: undefined })).backPdf, 0);
    expect(a).toEqual(b);
  });

  it('applies the creep guard per signature (largest signature)', async () => {
    // 80 pages. Single signature -> 20 sheets -> creep guard trips early.
    // But 8-per-signature -> max 2 sheets/signature -> creep barely shifts, ok.
    const input = await buildTestPdf(80);
    await expect(makeBooklet(input, { creep: 25 })).rejects.toThrow(/creep/i);
    await expect(
      makeBooklet(input, { creep: 25, signatureSize: 8 }),
    ).resolves.toBeDefined();
  });

  it('rejects invalid signatureSize values', async () => {
    const input = await buildTestPdf(16);
    for (const bad of [0, -4, 6, 3.5]) {
      await expectRejectsCode(makeBooklet(input, { signatureSize: bad }), 'BOOKLET_INVALID_SIGNATURE_SIZE');
    }
  });
});

describe('makeBooklet reverseSheetOrder', () => {
  it("reverses the front PDF's physical sheet order, each sheet keeping its own creep shift", async () => {
    // 32 pages, SINGLE signature -> 8 sheets, sheetInSignature 0..7. With only
    // one signature, "reverse the whole document" and "reverse each
    // signature's own sheets, signatures in order" are indistinguishable —
    // see the multi-signature test below for the case that tells them apart.
    // A nonzero creep makes each sheet's left-slot x-shift distinct and traceable.
    const input = await buildTestPdf(32);
    const creep = 2;
    const forward = await makeBooklet(input, { creep });
    const reversed = await makeBooklet(input, { creep, reverseSheetOrder: true });

    expect(reversed.sheetsCount).toBe(forward.sheetsCount);
    const S = forward.sheetsCount;

    const shiftOf = async (pdf: Uint8Array, pageIndex: number) =>
      (await drawnPagesOf(pdf, pageIndex))[0].translate[4];

    const forwardFirstShift = await shiftOf(forward.frontPdf, 0);
    const forwardLastShift = await shiftOf(forward.frontPdf, S - 1);
    const reversedFirstShift = await shiftOf(reversed.frontPdf, 0);
    const reversedLastShift = await shiftOf(reversed.frontPdf, S - 1);

    expect(reversedFirstShift).toBeCloseTo(forwardLastShift);
    expect(reversedLastShift).toBeCloseTo(forwardFirstShift);
  });

  it('defaults to the original (non-reversed) order', async () => {
    const input = await buildTestPdf(16);
    const a = await drawnPagesOf((await makeBooklet(input)).frontPdf, 0);
    const b = await drawnPagesOf(
      (await makeBooklet(input, { reverseSheetOrder: false })).frontPdf,
      0,
    );
    expect(a).toEqual(b);
  });

  it("keeps signatures in their original order, reversing only each signature's own sheets", async () => {
    // r/bookbinding regression: an auto-folding printer nests one signature
    // backwards, but the FIX must not also swap which signature prints first
    // — the reporter was explicit that signatures stay in order. 2 signatures
    // of 16 pages each; signature 1's source pages are a distinct size from
    // signature 2's, so the drawn scale (embedded page size vs the fixed A4
    // slot) identifies which signature's content landed on a given output
    // sheet. Creep-shift geometry alone can't tell these apart here: with
    // equal-length signatures, reversing the whole flat list and reversing
    // each signature internally produce the identical sheetInSignature
    // sequence (3,2,1,0,3,2,1,0) — only the actual page identity differs.
    const doc = await PDFDocument.create();
    for (let i = 0; i < 16; i++) doc.addPage([595, 842]).pushOperators(); // signature 1
    for (let i = 0; i < 16; i++) doc.addPage([400, 600]).pushOperators(); // signature 2
    const input = await doc.save();

    const SIG1_SCALE = 595 / 842; // height-bound, matches INNER_SCALE elsewhere
    const SIG2_SCALE = 595 / 600; // height-bound, matches COVER_SCALE elsewhere

    const result = await makeBooklet(input, { signatureSize: 16, reverseSheetOrder: true });
    expect(result.signaturesCount).toBe(2);
    expect(result.sheetsCount).toBe(8);

    // First output sheet must still be signature 1's content (its own sheets
    // reversed internally, so this is signature 1's sheetInSignature 3) — a
    // whole-document reversal would wrongly put signature 2 here instead.
    const firstDraw = (await drawnPagesOf(result.frontPdf, 0))[0];
    expect(firstDraw.scale[0]).toBeCloseTo(SIG1_SCALE, 5);

    // Sheet 4 (0-indexed) is signature 2's first emitted sheet.
    const fifthDraw = (await drawnPagesOf(result.frontPdf, 4))[0];
    expect(fifthDraw.scale[0]).toBeCloseTo(SIG2_SCALE, 5);

    // Last output sheet must be signature 2's content.
    const lastDraw = (await drawnPagesOf(result.frontPdf, 7))[0];
    expect(lastDraw.scale[0]).toBeCloseTo(SIG2_SCALE, 5);
  });
});

/**
 * Reads back an assembly mark from a sheet's raw content stream. Both marks are
 * drawn after the imposed content, so they are the tail of the stream: the
 * collation bar is the only black fill on the sheet, and the fold guide the only
 * dashed stroke. Inspects OUTPUT bytes only, never the layout code.
 */
async function marksOn(
  pdf: Uint8Array,
  pageIndex: number,
): Promise<{ bar: { x: number; y: number; width: number; height: number } | null; foldGuide: boolean }> {
  const doc = await PDFDocument.load(pdf);
  const text = pageStreamText(doc, pageIndex);
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const barRx = new RegExp(
    `0 0 0 rg\\n0 w\\n\\[\\] 0 d\\n1 0 0 1 ${num} ${num} cm(?:\\n1 0 0 1 0 0 cm){2}\\n0 0 m\\n0 ${num} l\\n${num} `,
  );
  const m = text.match(barRx);
  return {
    bar: m
      ? { x: Number(m[1]), y: Number(m[2]), height: Number(m[3]), width: Number(m[4]) }
      : null,
    foldGuide: text.includes('[4 4] 0 d'),
  };
}

describe('computeCollationMarkRect', () => {
  // A4 landscape spine: 595pt tall, 24pt left free at head and tail -> 547pt of
  // usable spine. Four signatures therefore band at 547 / 4 = 136.75pt each; the
  // bar is capped at 36pt and centred in its band, so it starts 50.375pt above
  // the band floor. Centred on the fold at 842 / 2 = 421, x = 421 - 14 / 2 = 414.
  it('bands the usable spine evenly, top signature first', () => {
    const first = computeCollationMarkRect(0, 4, 842, 595);
    expect(first).toEqual({ x: 414, y: 484.625, width: 14, height: 36 });

    const last = computeCollationMarkRect(3, 4, 842, 595);
    expect(last.y).toBeCloseTo(74.375, 6); // centred in the bottom band, above the tail margin
    expect(last.height).toBeCloseTo(36, 6);
  });

  it('steps down exactly one band per signature', () => {
    // The mark is read as a POSITION on the spine: consecutive bars must be one
    // whole band apart, or a missing signature would not visibly break the
    // staircase — which is the failure the mark exists to catch.
    const band = (595 - 2 * 24) / 5;
    const rects = [0, 1, 2, 3, 4].map((i) => computeCollationMarkRect(i, 5, 842, 595));
    for (let i = 0; i + 1 < rects.length; i++) {
      expect(rects[i].y - rects[i + 1].y).toBeCloseTo(band, 6);
    }
  });

  it('keeps every bar inside the usable spine', () => {
    for (const count of [1, 2, 4, 9]) {
      for (let i = 0; i < count; i++) {
        const r = computeCollationMarkRect(i, count, 842, 595);
        expect(r.y).toBeGreaterThanOrEqual(24 - 1e-9);
        expect(r.y + r.height).toBeLessThanOrEqual(595 - 24 + 1e-9);
      }
    }
  });

  it('shrinks the bar to its band once the band is thinner than the cap', () => {
    // 20 signatures band at 547 / 20 = 27.35pt, below the 36pt cap, so the bars
    // fill their bands and the steps stay flush instead of overlapping.
    const band = 547 / 20;
    const rects = [0, 1, 2].map((i) => computeCollationMarkRect(i, 20, 842, 595));
    for (const r of rects) expect(r.height).toBeCloseTo(band, 6);
    expect(rects[0].y).toBeCloseTo(rects[1].y + band, 6);
  });

  it('centres a single signature\'s bar on the usable spine', () => {
    const only = computeCollationMarkRect(0, 1, 842, 595);
    expect(only.height).toBeCloseTo(36, 6);
    expect(only.y + only.height / 2).toBeCloseTo(24 + 547 / 2, 6);
  });
});

describe('makeBooklet assembly marks', () => {
  // 32 pages at 8 per signature -> 4 signatures of 2 sheets each. Output sheets
  // 0, 2, 4, 6 are the outermost sheet of signatures 1..4.
  const OUTER_SHEETS = [0, 2, 4, 6];
  const INNER_SHEETS = [1, 3, 5, 7];
  // Bars capped at 36pt, centred in their 136.75pt bands (see computeCollationMarkRect).
  const STEP_Y = [484.625, 347.875, 211.125, 74.375];

  it('draws one stepped bar per signature, on its outermost sheet only', async () => {
    const input = await buildTestPdf(32);
    const result = await makeBooklet(input, { signatureSize: 8, collationMarks: true });
    expect(result.signaturesCount).toBe(4);

    for (let i = 0; i < OUTER_SHEETS.length; i++) {
      const { bar } = await marksOn(result.frontPdf, OUTER_SHEETS[i]);
      expect(bar).not.toBeNull();
      expect(bar!.x).toBeCloseTo(414, 6);
      expect(bar!.y).toBeCloseTo(STEP_Y[i], 6);
    }
    for (const sheet of INNER_SHEETS) {
      expect((await marksOn(result.frontPdf, sheet)).bar).toBeNull();
    }
    // Front side only: the folded signature shows its outer face on the spine,
    // and this keeps the bar clear of the long-edge 180° back composition.
    expect((await marksOn(result.backPdf, 0)).bar).toBeNull();
  });

  it('keeps each bar with its own signature when sheets print in reverse order', async () => {
    // reverseSheetOrder flips EMISSION order inside a signature, so the
    // outermost sheet is emitted last. The mark must follow the physical sheet,
    // not the print position — otherwise a reversed run would step the bars in
    // the wrong direction and the diagonal check would fail on a correct stack.
    const input = await buildTestPdf(32);
    const result = await makeBooklet(input, {
      signatureSize: 8,
      collationMarks: true,
      reverseSheetOrder: true,
    });

    for (let i = 0; i < INNER_SHEETS.length; i++) {
      const { bar } = await marksOn(result.frontPdf, INNER_SHEETS[i]);
      expect(bar).not.toBeNull();
      expect(bar!.y).toBeCloseTo(STEP_Y[i], 6);
    }
    for (const sheet of OUTER_SHEETS) {
      expect((await marksOn(result.frontPdf, sheet)).bar).toBeNull();
    }
  });

  it('suppresses the bar when the document is a single signature', async () => {
    // Nothing to gather, so a mark that can never be wrong is not printed.
    const result = await makeBooklet(await buildTestPdf(16), { collationMarks: true });
    expect(result.signaturesCount).toBe(1);
    for (let i = 0; i < result.sheetsCount; i++) {
      expect((await marksOn(result.frontPdf, i)).bar).toBeNull();
    }
  });

  it('places the bar on the fold line regardless of gutter and creep', async () => {
    // Gutter and creep shift the drawn CONTENT inward; the fold itself never
    // moves, so neither does the mark.
    const input = await buildTestPdf(32);
    const plain = await makeBooklet(input, { signatureSize: 8, collationMarks: true });
    const shifted = await makeBooklet(input, {
      signatureSize: 8,
      collationMarks: true,
      gutter: 20,
      creep: 3,
    });
    expect((await marksOn(shifted.frontPdf, 2)).bar).toEqual((await marksOn(plain.frontPdf, 2)).bar);
  });

  it('bands the bar against the actual sheet size, not the A4 default (A5 paper)', async () => {
    // A5 landscape is 595 x 420 -- both dimensions differ from the A4-default
    // TARGET_WIDTH/TARGET_HEIGHT (842 x 595) computeCollationMarkRect falls
    // back to, so a bug that silently dropped sheetHeight through to the
    // default would land the bar at a visibly different y.
    const input = await buildTestPdf(32);
    const result = await makeBooklet(input, {
      signatureSize: 8,
      collationMarks: true,
      paperSize: 'A5',
    });
    expect(result.signaturesCount).toBe(4);

    const expected = computeCollationMarkRect(0, 4, 595, 420);
    const { bar } = await marksOn(result.frontPdf, 0);
    expect(bar).not.toBeNull();
    expect(bar).toEqual(expected);
  });

  it('draws the fold guide on both sides of every sheet, and the cover', async () => {
    const input = await buildTestPdf(32);
    const result = await makeBooklet(input, {
      signatureSize: 8,
      foldGuides: true,
      separateCover: true,
    });
    for (let i = 0; i < result.sheetsCount; i++) {
      expect((await marksOn(result.frontPdf, i)).foldGuide).toBe(true);
      expect((await marksOn(result.backPdf, i)).foldGuide).toBe(true);
    }
    expect((await marksOn(result.coverPdf!, 0)).foldGuide).toBe(true);
  });

  it('never bars the separate cover — it wraps the stack, it is not gathered in it', async () => {
    const result = await makeBooklet(await buildTestPdf(32), {
      signatureSize: 8,
      collationMarks: true,
      separateCover: true,
    });
    expect((await marksOn(result.coverPdf!, 0)).bar).toBeNull();
    expect((await marksOn(result.coverPdf!, 1)).bar).toBeNull();
  });

  it('never bars the separate cover even when the block itself needed padding', async () => {
    // 19-page source + separate cover -> inner block is 19 - 4 = 15 pages,
    // padded to 16 (paddingApplied 1). The 32-page/signatureSize-8 case above
    // never exercises this: block there is 32 - 4 = 28, already a multiple
    // of 4, so paddingApplied stays 0.
    const result = await makeBooklet(await buildTestPdf(19), {
      signatureSize: 8,
      collationMarks: true,
      separateCover: true,
    });
    expect(result.paddedPages).toBe(16);
    expect((await marksOn(result.coverPdf!, 0)).bar).toBeNull();
    expect((await marksOn(result.coverPdf!, 1)).bar).toBeNull();
  });

  it('draws nothing by default', async () => {
    const result = await makeBooklet(await buildTestPdf(32), { signatureSize: 8 });
    const marks = await marksOn(result.frontPdf, 0);
    expect(marks.bar).toBeNull();
    expect(marks.foldGuide).toBe(false);
  });

  it('places bars correctly when a blank is inserted mid-signature', async () => {
    // 31 pages + 1 blank inserted after page 4 (mid the first signature,
    // which spans logical pages 1-8) -> 32 logical pages, signatureSize 8 ->
    // same 4-signature/2-sheet-each shape as OUTER_SHEETS/STEP_Y above, but
    // built from a page order that is not simply 1..N.
    const result = await makeBooklet(await buildTestPdf(31), {
      signatureSize: 8,
      collationMarks: true,
      insertBlankAfter: [4],
    });
    expect(result.signaturesCount).toBe(4);

    for (let i = 0; i < OUTER_SHEETS.length; i++) {
      const { bar } = await marksOn(result.frontPdf, OUTER_SHEETS[i]);
      expect(bar).not.toBeNull();
      expect(bar!.y).toBeCloseTo(STEP_Y[i], 6);
    }
    for (const sheet of INNER_SHEETS) {
      expect((await marksOn(result.frontPdf, sheet)).bar).toBeNull();
    }
  });

  it('draws exactly one bar per signature, for a range of signature counts', async () => {
    // States explicitly what the FlatSheet-building loop in imposeFrontBack
    // (`signature.map((sheet, sheetInSignature) => ...)`) only guarantees by
    // construction: exactly one sheetInSignature===0 entry per signature, so
    // the drawn-bar count always equals signaturesCount. A small representative
    // sweep across real makeBooklet calls, not a fast-check property -- this
    // needs full PDF assembly to exercise the actual (unexported) FlatSheet
    // loop, which is too slow to run under randomized generation.
    const cases: Array<[number, number | 'auto']> = [
      [16, 4],
      [32, 8],
      [44, 'auto'],
      [64, 16],
    ];
    for (const [pages, size] of cases) {
      const result = await makeBooklet(await buildTestPdf(pages), {
        signatureSize: size,
        collationMarks: true,
      });
      let barCount = 0;
      for (let i = 0; i < result.sheetsCount; i++) {
        if ((await marksOn(result.frontPdf, i)).bar) barCount += 1;
      }
      expect(barCount).toBe(result.signaturesCount);
    }
  });
});

describe('mirrorMapping (RTL binding)', () => {
  it('swaps left<->right slots for the hand-derived 16-page sheet 0', () => {
    // LTR sheet 0 is {fL:15, fR:0, bL:1, bR:14}; RTL swaps both front and back.
    const mirrored = mirrorMapping(computeSheetMapping(16));
    expect(mirrored[0]).toEqual({ frontLeft: 0, frontRight: 15, backLeft: 14, backRight: 1 });
  });

  it('still covers every page index exactly once', () => {
    const used = mirrorMapping(computeSheetMapping(24)).flatMap((s) => [
      s.frontLeft,
      s.frontRight,
      s.backLeft,
      s.backRight,
    ]);
    expect(used.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });
});

describe('makeBooklet binding', () => {
  it('leaves the slot geometry unchanged for RTL (only page assignment swaps)', async () => {
    // A uniform document: RTL swaps which page goes left/right, but the slot
    // rectangles are identical, so the front-sheet transform matrices match LTR
    // byte-for-byte. Verified output-to-output, not via the production formula.
    const input = await buildTestPdf(8);
    const ltr = await drawnPagesOf((await makeBooklet(input, { binding: 'ltr' })).frontPdf, 0);
    const rtl = await drawnPagesOf((await makeBooklet(input, { binding: 'rtl' })).frontPdf, 0);
    expect(rtl).toEqual(ltr);
  });

  it('keeps the RTL+long front identical to the LTR front (front is never rotated)', async () => {
    const input = await buildTestPdf(8);
    const ltrFront = await drawnPagesOf((await makeBooklet(input)).frontPdf, 0);
    const rtlLongFront = await drawnPagesOf(
      (await makeBooklet(input, { binding: 'rtl', flipEdge: 'long' })).frontPdf,
      0,
    );
    expect(rtlLongFront).toEqual(ltrFront);
  });

  it('preserves the default (undefined === ltr)', async () => {
    const input = await buildTestPdf(16);
    const def = await drawnPagesOf((await makeBooklet(input)).backPdf, 0);
    const ltr = await drawnPagesOf((await makeBooklet(input, { binding: 'ltr' })).backPdf, 0);
    expect(def).toEqual(ltr);
  });

  it('rejects an invalid binding value', async () => {
    const input = await buildTestPdf(8);
    await expectRejectsCode(
      makeBooklet(input, { binding: 'diagonal' as unknown as 'ltr' }),
      'BOOKLET_INVALID_BINDING',
    );
  });
});

describe('makeBooklet separateCover', () => {
  // A 12-page document whose cover pages (0,1,10,11) are 400x600 and whose inner
  // pages (2..9) are 595x842 — different sizes, so the scale a page is drawn at
  // reveals whether it landed on the cover or in the book block.
  async function buildCoverDoc(): Promise<Uint8Array> {
    const sizes: Array<[number, number]> = [
      [400, 600],
      [400, 600],
      ...Array.from({ length: 8 }, () => [595, 842] as [number, number]),
      [400, 600],
      [400, 600],
    ];
    return (await buildMixedDoc(sizes)).save();
  }

  // Uniform-fit scale of a page into the A4 slot (421 x 595).
  const INNER_SCALE = 595 / 842; // 595x842 -> height-bound = 0.7066508
  const COVER_SCALE = 595 / 600; // 400x600 -> height-bound = 0.9916667 (min(421/400, 595/600))

  it('emits a 2-page cover and excludes it from the book block', async () => {
    const result = await makeBooklet(await buildCoverDoc(), { separateCover: true });
    expect(result.coverPdf).toBeDefined();
    const coverDoc = await PDFDocument.load(result.coverPdf!);
    expect(coverDoc.getPageCount()).toBe(2); // front + back of the cover sheet

    // originalPages counts the whole document; the block stats reflect the inner
    // 8 pages only (cover sheet NOT counted).
    expect(result.originalPages).toBe(12);
    expect(result.paddedPages).toBe(8);
    expect(result.sheetsCount).toBe(2);
    expect(result.signaturesCount).toBe(1);
    expect(result.paddingApplied).toBe(0);
  });

  it('draws the cover pages on the cover and the inner pages in the block', async () => {
    const result = await makeBooklet(await buildCoverDoc(), { separateCover: true });

    // Book block front sheet draws the inner 595x842 pages.
    const innerFront = await drawnPagesOf(result.frontPdf, 0);
    expect(innerFront).toHaveLength(2);
    for (const draw of innerFront) expect(draw.scale[0]).toBeCloseTo(INNER_SCALE, 5);

    // Cover sheet draws the 400x600 cover pages (2 per side).
    const coverFront = await drawnPagesOf(result.coverPdf!, 0);
    const coverBack = await drawnPagesOf(result.coverPdf!, 1);
    expect(coverFront).toHaveLength(2);
    expect(coverBack).toHaveLength(2);
    for (const draw of [...coverFront, ...coverBack]) {
      expect(draw.scale[0]).toBeCloseTo(COVER_SCALE, 5);
    }
  });

  it('throws when a separate cover is requested for fewer than 8 pages', async () => {
    const input = await buildTestPdf(4);
    await expectRejectsCode(makeBooklet(input, { separateCover: true }), 'BOOKLET_COVER_MIN_PAGES');
  });

  it('leaves coverPdf undefined by default', async () => {
    const result = await makeBooklet(await buildTestPdf(12));
    expect(result.coverPdf).toBeUndefined();
  });
});

describe('signatureStartPages', () => {
  it('matches the hand-derived examples', () => {
    expect(signatureStartPages(16)).toEqual([1]); // single signature
    expect(signatureStartPages(44, 'auto')).toEqual([1, 17, 33]); // 16-page signatures
    // A separate-cover inner block of 44 pages, but the +2 cover offset is
    // applied by the caller, so the pure helper still returns [1, 17, 33].
    expect(signatureStartPages(44, 16)).toEqual([1, 17, 33]);
    expect(signatureStartPages(32, 8)).toEqual([1, 9, 17, 25]);
  });
});

describe('makeBooklet includeInstructions', () => {
  it('emits a single instructions page at the selected sheet size', async () => {
    const input = await buildTestPdf(16);
    const result = await makeBooklet(input, { includeInstructions: true, paperSize: 'Letter' });
    expect(result.instructionsPdf).toBeDefined();
    const doc = await PDFDocument.load(result.instructionsPdf!);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  });

  it('reflects the duplex flip edge in the copy', async () => {
    const input = await buildTestPdf(16);

    const shortCopy = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true, flipEdge: 'short' }),
    ).map((l) => l.text);
    expect(shortCopy.some((l) => l.includes('SHORT edge'))).toBe(true);
    expect(shortCopy.some((l) => l.includes('LONG edge'))).toBe(false);

    const longCopy = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true, flipEdge: 'long' }),
    ).map((l) => l.text);
    expect(longCopy.some((l) => l.includes('LONG edge'))).toBe(true);
  });

  it('notes reversed sheet order in the copy only when requested', async () => {
    const input = await buildTestPdf(16);

    const defaultCopy = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true }),
    ).map((l) => l.text);
    expect(defaultCopy.some((l) => l.includes('innermost-first'))).toBe(false);

    const reversedCopy = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true, reverseSheetOrder: true }),
    ).map((l) => l.text);
    expect(reversedCopy.some((l) => l.includes('innermost-first'))).toBe(true);
  });

  it('explains the assembly marks only when they are actually printed', async () => {
    const input = await buildTestPdf(32);

    const plain = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true, signatureSize: 8 }),
    ).map((l) => l.text);
    expect(plain.some((l) => l.includes('marks the fold'))).toBe(false);
    expect(plain.some((l) => l.includes('like a staircase'))).toBe(false);

    const marked = buildInstructionsLines(
      await instructionsDataFor(input, {
        includeInstructions: true,
        signatureSize: 8,
        foldGuides: true,
        collationMarks: true,
      }),
    ).map((l) => l.text);
    expect(marked.some((l) => l.includes('marks the fold'))).toBe(true);
    expect(marked.some((l) => l.includes('like a staircase'))).toBe(true);
  });

  it('omits the spine-bar note when a single signature suppressed the bar', async () => {
    // The sheet must describe what was printed, not what was asked for.
    const copy = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(16), {
        includeInstructions: true,
        collationMarks: true,
      }),
    ).map((l) => l.text);
    expect(copy.some((l) => l.includes('like a staircase'))).toBe(false);
  });

  it('warns about print legibility only once the collation-bar band gets too thin', async () => {
    // signatureSize 4 over 800 pages -> 200 signatures. Band = (595 - 2*24) /
    // 200 = 2.735pt, under the 4pt legibility floor (see
    // COLLATION_BAR_LEGIBILITY_FLOOR in booklet-engine.ts) -- the sub-3pt,
    // ~200-signature range a real signatureSize-8/1600+-page document
    // (thesis, scanned archive) can reach.
    const thin = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(800), {
        includeInstructions: true,
        signatureSize: 4,
        collationMarks: true,
      }),
    ).map((l) => l.text);
    expect(thin.some((l) => l.includes('prints quite thin'))).toBe(true);

    // 4 signatures (32 pages / 8 per signature): band = 136.75pt, far above
    // the floor -- no warning.
    const flush = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(32), {
        includeInstructions: true,
        signatureSize: 8,
        collationMarks: true,
      }),
    ).map((l) => l.text);
    expect(flush.some((l) => l.includes('prints quite thin'))).toBe(false);

    // No warning at all when the bar itself is not printed -- checked on the
    // raw data, not just the rendered copy, since collationLegibilityWarning
    // is documented to always be false alongside collationMarks: false.
    const noMarksData = await instructionsDataFor(await buildTestPdf(800), {
      includeInstructions: true,
      signatureSize: 4,
    });
    expect(noMarksData.collationLegibilityWarning).toBe(false);
    const noMarksCopy = buildInstructionsLines(noMarksData).map((l) => l.text);
    expect(noMarksCopy.some((l) => l.includes('prints quite thin'))).toBe(false);
  });

  it('reports blank pages inserted by the user and/or added as padding', async () => {
    // 15 pages: 1 auto-padding page needed to reach 16.
    const paddedOnly = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(15), { includeInstructions: true }),
    ).map((l) => l.text);
    expect(paddedOnly.some((l) => l.includes('Blank pages: 1 (added to complete the last sheet)'))).toBe(
      true,
    );

    // 16 pages + 1 user-requested blank -> 17 -> 3 padding pages to reach 20.
    const both = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(16), {
        includeInstructions: true,
        insertBlankAfter: [0],
      }),
    ).map((l) => l.text);
    expect(
      both.some((l) => l.includes('Blank pages: 4 (1 inserted by you, 3 added to complete the last sheet)')),
    ).toBe(true);

    // Evenly-divisible, no inserts -> no blank-pages line at all.
    const neither = buildInstructionsLines(
      await instructionsDataFor(await buildTestPdf(16), { includeInstructions: true }),
    ).map((l) => l.text);
    expect(neither.some((l) => l.includes('Blank pages'))).toBe(false);
  });

  it('lists the signature count and reading-order start pages', async () => {
    // 44 pages, auto -> 3 signatures starting at pages 1, 17, 33.
    const input = await buildTestPdf(44);
    const data = await instructionsDataFor(input, {
      includeInstructions: true,
      signatureSize: 'auto',
    });
    expect(data.signaturesCount).toBe(3);
    expect(data.signatureStartPages).toEqual([1, 17, 33]);
  });

  it('offsets reading-order pages by the cover when a cover is separated', async () => {
    // 48 pages, separate cover -> inner block 44 -> signatures at 1,17,33, then
    // shifted +2 for the two leading cover pages: 3, 19, 35.
    const input = await buildTestPdf(48);
    const data = await instructionsDataFor(input, {
      includeInstructions: true,
      signatureSize: 16,
      separateCover: true,
    });
    expect(data.signatureStartPages).toEqual([3, 19, 35]);
  });

  it('caps the reading-order list for many signatures and stays one page', async () => {
    // 400 pages, auto -> 16-page signatures -> 25 signatures. The list shows the
    // first 10 and collapses the rest into a single summary line.
    const input = await buildTestPdf(400);
    const result = await makeBooklet(input, { includeInstructions: true, signatureSize: 'auto' });
    const doc = await PDFDocument.load(result.instructionsPdf!);
    expect(doc.getPageCount()).toBe(1);

    const copy = buildInstructionsLines(
      await instructionsDataFor(input, { includeInstructions: true, signatureSize: 'auto' }),
    ).map((l) => l.text);
    expect(copy.some((l) => l.includes('Signature 10 starts at page'))).toBe(true);
    expect(copy.some((l) => l.includes('and 15 more signatures (every 16 pages)'))).toBe(true);
    expect(copy.some((l) => l.includes('Signature 25'))).toBe(false);
  });

  it('leaves instructionsPdf undefined by default and does not touch the book PDFs', async () => {
    const input = await buildTestPdf(16);
    const withInstr = await makeBooklet(input, { includeInstructions: true });
    const without = await makeBooklet(input);
    expect(without.instructionsPdf).toBeUndefined();
    // The book block is identical whether or not instructions are generated.
    const a = await drawnPagesOf(withInstr.backPdf, 0);
    const b = await drawnPagesOf(without.backPdf, 0);
    expect(a).toEqual(b);
  });
});

describe('makeBooklet insertBlankAfter', () => {
  it('rejects non-integer, negative, and out-of-range positions', async () => {
    const input = await buildTestPdf(8);
    for (const bad of [-1, 1.5, 9]) {
      await expectRejectsCode(
        makeBooklet(input, { insertBlankAfter: [bad] }),
        'BOOKLET_INVALID_BLANK_POSITION',
      );
    }
  });

  it('has no effect for an empty / undefined list (default preserved)', async () => {
    const input = await buildTestPdf(16);
    const base = await drawnPagesOf((await makeBooklet(input)).backPdf, 0);
    const empty = await drawnPagesOf((await makeBooklet(input, { insertBlankAfter: [] })).backPdf, 0);
    expect(empty).toEqual(base);
    const single = await makeBooklet(input);
    expect(single.blanksInserted).toBe(0);
  });

  it('inserts a blank into the logical order and shifts the real pages', async () => {
    // Six differently-sized pages so the scale a page is drawn at reveals which
    // source page occupies a slot. Insert one blank after page 1 -> logical order
    // is [p1, BLANK, p2, p3, p4, p5, p6], padded to 8 (one trailing blank).
    const doc = await buildMixedDoc([
      [100, 200],
      [110, 210],
      [120, 220],
      [130, 230],
      [140, 240],
      [150, 250],
    ]);
    const input = await doc.save();
    const result = await makeBooklet(input, { insertBlankAfter: [1] });
    expect(result.blanksInserted).toBe(1);
    expect(result.paddingApplied).toBe(1); // 7 logical -> pad 1 -> 8
    expect(result.paddedPages).toBe(8);
    expect(result.sheetsCount).toBe(2);

    // Every slot is still drawn (blanks included): 2 draws per sheet page.
    const front1 = await drawnPagesOf(result.frontPdf, 1);
    expect(front1).toHaveLength(2);

    // Hand geometry: pages fit height-bound into the 421x595 slot (scale=595/h).
    const SCALE_210 = 595 / 210; // 2.833333 -> source page 2 (110x210)
    const SCALE_240 = 595 / 240; // 2.479167 -> source page 5 (140x240)
    const SCALE_220 = 595 / 220; // 2.704545 -> source page 3 (120x220)
    // With the insert, sheet 1 front is [p5 (left), p2 (right)].
    expect(front1[0].scale[0]).toBeCloseTo(SCALE_240, 4);
    expect(front1[1].scale[0]).toBeCloseTo(SCALE_210, 4);

    // Without the insert, that same right slot holds page 3, not page 2.
    const noInsert1 = await drawnPagesOf((await makeBooklet(input)).frontPdf, 1);
    expect(noInsert1[1].scale[0]).toBeCloseTo(SCALE_220, 4);
    expect(noInsert1[1].scale[0]).not.toBeCloseTo(SCALE_210, 4);
  });

  it('inserts the blank into the logical order BEFORE the cover split', async () => {
    // 8 source pages + one blank after page 1 -> 9 logical pages. Cover takes the
    // first 2 + last 2 logical pages, leaving 5 inner pages padded to 8.
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input, { insertBlankAfter: [1], separateCover: true });
    expect(result.originalPages).toBe(8);
    expect(result.blanksInserted).toBe(1);
    expect(result.coverPdf).toBeDefined();
    expect((await PDFDocument.load(result.coverPdf!)).getPageCount()).toBe(2);
    // Inner block: 5 logical pages -> padded to 8 -> 2 sheets, 3 padding pages.
    expect(result.paddedPages).toBe(8);
    expect(result.paddingApplied).toBe(3);
    expect(result.sheetsCount).toBe(2);
  });

  it('inserts multiple blanks for a repeated position', async () => {
    const input = await buildTestPdf(6);
    const result = await makeBooklet(input, { insertBlankAfter: [2, 2] });
    // 6 + 2 blanks = 8 logical pages, already a multiple of 4.
    expect(result.blanksInserted).toBe(2);
    expect(result.paddingApplied).toBe(0);
    expect(result.paddedPages).toBe(8);
  });
});
