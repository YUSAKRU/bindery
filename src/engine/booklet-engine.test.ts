import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
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

/**
 * Extracts the visible text of a generated PDF by decoding the hex string tokens
 * (`<...> Tj/TJ`) pdf-lib emits for subset-embedded fonts. Output-only — no
 * production text-layout code is invoked.
 */
async function extractText(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  let raw = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        const t = new TextDecoder().decode(decodePDFRawStream(obj).decode());
        if (t.includes('Tj') || t.includes('TJ')) raw += `${t}\n`;
      } catch {
        /* not a content stream */
      }
    }
  }
  return [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((m) => {
      const hex = m[1];
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      return s;
    })
    .join('\n');
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
    await expect(
      makeBooklet(input, { flipEdge: 'diagonal' } as unknown as BookletOptions),
    ).rejects.toThrow(/çevirme kenarı/i);
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

  it("throws when 'source' is requested without a document", () => {
    expect(() => resolveSheetSize('source')).toThrow(/source/i);
  });

  it('accepts custom sizes inside [72, 14400] and rejects out-of-bounds ones', () => {
    expect(resolveSheetSize({ width: 1000, height: 700 })).toEqual([1000, 700]);
    expect(resolveSheetSize({ width: 72, height: 72 })).toEqual([72, 72]);
    expect(resolveSheetSize({ width: 14400, height: 14400 })).toEqual([14400, 14400]);
    // 71pt is below the 72pt floor.
    expect(() => resolveSheetSize({ width: 71, height: 500 })).toThrow(/kağıt boyutu/i);
    // 14401pt exceeds the PDF 14400pt page cap.
    expect(() => resolveSheetSize({ width: 500, height: 14401 })).toThrow(/kağıt boyutu/i);
  });

  it('rejects an unknown preset string', () => {
    expect(() => resolveSheetSize('B5' as never)).toThrow(/kağıt boyutu/i);
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
    await expect(
      makeBooklet(input, { paperSize: { width: 50, height: 500 } }),
    ).rejects.toThrow(/kağıt boyutu/i);
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
});

describe('resolveSignatureSize', () => {
  it('returns the whole document for undefined / auto-below-threshold', () => {
    expect(resolveSignatureSize(24)).toBe(24);
    expect(resolveSignatureSize(40, 'auto')).toBe(40);
    expect(resolveSignatureSize(44, 'auto')).toBe(16);
  });

  it('rejects non-positive, non-multiple-of-4, and non-integer sizes', () => {
    for (const bad of [0, -4, 6, 3.5]) {
      expect(() => resolveSignatureSize(16, bad)).toThrow(/imza boyutu/i);
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
      await expect(
        makeBooklet(input, { signatureSize: bad }),
      ).rejects.toThrow(/imza boyutu/i);
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
    await expect(
      makeBooklet(input, { binding: 'diagonal' as unknown as 'ltr' }),
    ).rejects.toThrow(/cilt yönü/i);
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
    await expect(makeBooklet(input, { separateCover: true })).rejects.toThrow(/kapak/i);
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
    const shortText = await extractText(
      (await makeBooklet(input, { includeInstructions: true, flipEdge: 'short' })).instructionsPdf!,
    );
    expect(shortText).toContain('SHORT edge');
    expect(shortText).not.toContain('LONG edge');

    const longText = await extractText(
      (await makeBooklet(input, { includeInstructions: true, flipEdge: 'long' })).instructionsPdf!,
    );
    expect(longText).toContain('LONG edge');
  });

  it('lists the signature count and reading-order start pages', async () => {
    // 44 pages, auto -> 3 signatures starting at pages 1, 17, 33.
    const input = await buildTestPdf(44);
    const text = await extractText(
      (await makeBooklet(input, { includeInstructions: true, signatureSize: 'auto' })).instructionsPdf!,
    );
    expect(text).toContain('Signatures: 3');
    expect(text).toContain('Signature 2 starts at page 17');
    expect(text).toContain('Signature 3 starts at page 33');
  });

  it('offsets reading-order pages by the cover when a cover is separated', async () => {
    // 48 pages, separate cover -> inner block 44 -> signatures at 1,17,33, then
    // shifted +2 for the two leading cover pages: 3, 19, 35.
    const input = await buildTestPdf(48);
    const text = await extractText(
      (
        await makeBooklet(input, {
          includeInstructions: true,
          signatureSize: 16,
          separateCover: true,
        })
      ).instructionsPdf!,
    );
    expect(text).toContain('Signature 1 starts at page 3');
    expect(text).toContain('Signature 2 starts at page 19');
    expect(text).toContain('Signature 3 starts at page 35');
  });

  it('caps the reading-order list for many signatures and stays one page', async () => {
    // 400 pages, auto -> 16-page signatures -> 25 signatures. The list shows the
    // first 10 and collapses the rest into a single summary line.
    const input = await buildTestPdf(400);
    const result = await makeBooklet(input, { includeInstructions: true, signatureSize: 'auto' });
    const doc = await PDFDocument.load(result.instructionsPdf!);
    expect(doc.getPageCount()).toBe(1);

    const text = await extractText(result.instructionsPdf!);
    expect(text).toContain('Signature 10 starts at page');
    expect(text).toContain('and 15 more signatures (every 16 pages)');
    expect(text).not.toContain('Signature 25');
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
      await expect(makeBooklet(input, { insertBlankAfter: [bad] })).rejects.toThrow(
        /boş sayfa konumu/i,
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
