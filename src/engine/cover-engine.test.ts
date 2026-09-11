/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  A4_LONG_EDGE_MM,
  A4_SHORT_EDGE_MM,
  computeCoverDimensions,
  computeSpineWidth,
  computeSplitCoverDimensions,
  COVER_THEMES,
  generateCoverPdf,
  GLUE_TAB_WIDTH_MM,
  LAP_FLAP_WIDTH_MM,
  MM_TO_PT,
  placeSheetOnPrinterPaper,
} from './cover-engine';
import type { BindingType, CoverTheme, PaperGsm, SpineCalculationResult } from './cover-engine';
import { BookletError } from './types';

// Property-based tests for the cover engine's structural invariants, following
// booklet-invariants.test.ts's philosophy: state invariants independently of the
// implementation (not "what the code already does") so a wrong implementation can
// disagree with them.

const paperGsm = fc.constantFrom<PaperGsm>(70, 80, 90, 100, 120);
const bindingType = fc.constantFrom<BindingType>('sewn', 'perfect', 'saddle');
const sheetCount = fc.integer({ min: 1, max: 500 });
const signatureCount = fc.integer({ min: 1, max: 1000 });

describe('computeSpineWidth', () => {
  it('rejects sheetCount <= 0', () => {
    expect(() =>
      computeSpineWidth({ sheetCount: 0, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
    expect(() =>
      computeSpineWidth({ sheetCount: -3, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
  });

  it('rejects signatureCount <= 0', () => {
    expect(() =>
      computeSpineWidth({ sheetCount: 10, signatureCount: 0, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
    expect(() =>
      computeSpineWidth({ sheetCount: 10, signatureCount: -1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
  });

  it('totalSpineWidthMm increases strictly as sheetCount grows, for any paper/binding', () => {
    fc.assert(
      fc.property(sheetCount, signatureCount, paperGsm, bindingType, (sheets, sigs, gsm, binding) => {
        const a = computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding });
        const b = computeSpineWidth({ sheetCount: sheets + 1, signatureCount: sigs, paperGsm: gsm, bindingType: binding });
        expect(b.totalSpineWidthMm).toBeGreaterThan(a.totalSpineWidthMm);
      }),
    );
  });

  it('a heavier paper (higher gsm / caliper) yields a strictly wider spine for the same sheetCount', () => {
    const gsmValues: PaperGsm[] = [70, 80, 90, 100, 120];
    fc.assert(
      fc.property(sheetCount, signatureCount, bindingType, (sheets, sigs, binding) => {
        const widths = gsmValues.map(
          (gsm) => computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding }).totalSpineWidthMm,
        );
        for (let i = 0; i + 1 < widths.length; i++) {
          expect(widths[i + 1]).toBeGreaterThan(widths[i]);
        }
      }),
    );
  });

  it('sewn binding: threadSwellMm (and the total) strictly increases as signatureCount grows', () => {
    fc.assert(
      fc.property(sheetCount, paperGsm, fc.integer({ min: 1, max: 999 }), (sheets, gsm, extraSigs) => {
        const small = computeSpineWidth({ sheetCount: sheets, signatureCount: 1, paperGsm: gsm, bindingType: 'sewn' });
        const big = computeSpineWidth({ sheetCount: sheets, signatureCount: 1 + extraSigs, paperGsm: gsm, bindingType: 'sewn' });
        expect(big.threadSwellMm).toBeGreaterThan(small.threadSwellMm);
        expect(big.totalSpineWidthMm).toBeGreaterThan(small.totalSpineWidthMm);
      }),
    );
  });

  it('saddle binding always has zero threadSwellMm and zero hingeAllowanceMm (no board given)', () => {
    fc.assert(
      fc.property(sheetCount, signatureCount, paperGsm, (sheets, sigs, gsm) => {
        const result = computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: 'saddle' });
        expect(result.threadSwellMm).toBe(0);
        expect(result.hingeAllowanceMm).toBe(0);
      }),
    );
  });

  it('non-sewn bindings (saddle, perfect) always have zero threadSwellMm', () => {
    fc.assert(
      fc.property(sheetCount, signatureCount, paperGsm, fc.constantFrom<BindingType>('saddle', 'perfect'), (sheets, sigs, gsm, binding) => {
        const result = computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding });
        expect(result.threadSwellMm).toBe(0);
      }),
    );
  });

  it('boardThicknessMm overrides hingeAllowanceMm as 2*board + 7, regardless of bindingType', () => {
    fc.assert(
      fc.property(
        sheetCount,
        signatureCount,
        paperGsm,
        bindingType,
        fc.double({ min: 0, max: 10, noNaN: true }),
        (sheets, sigs, gsm, binding, board) => {
          const result = computeSpineWidth({
            sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding, boardThicknessMm: board,
          });
          expect(result.hingeAllowanceMm).toBeCloseTo(2 * board + 7, 9);
        },
      ),
    );
  });

  it('with boardThicknessMm given, hingeAllowanceMm is identical across every bindingType', () => {
    fc.assert(
      fc.property(sheetCount, signatureCount, paperGsm, fc.double({ min: 0, max: 10, noNaN: true }), (sheets, sigs, gsm, board) => {
        const hinges = (['sewn', 'perfect', 'saddle'] as BindingType[]).map(
          (binding) => computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding, boardThicknessMm: board }).hingeAllowanceMm,
        );
        expect(hinges[0]).toBeCloseTo(hinges[1], 9);
        expect(hinges[1]).toBeCloseTo(hinges[2], 9);
      }),
    );
  });

  it('totalSpineWidthPt is always totalSpineWidthMm converted via MM_TO_PT', () => {
    fc.assert(
      fc.property(sheetCount, signatureCount, paperGsm, bindingType, (sheets, sigs, gsm, binding) => {
        const result = computeSpineWidth({ sheetCount: sheets, signatureCount: sigs, paperGsm: gsm, bindingType: binding });
        expect(result.totalSpineWidthPt).toBeCloseTo(result.totalSpineWidthMm * MM_TO_PT, 9);
      }),
    );
  });

  describe('canPrintSpineText legibility floor (3.5mm)', () => {
    it('is false just under 3.5mm', () => {
      // saddle: no swell, no hinge -> total is exactly sheetCount * caliper(70gsm)
      const r = computeSpineWidth({ sheetCount: 38, signatureCount: 1, paperGsm: 70, bindingType: 'saddle' });
      expect(r.totalSpineWidthMm).toBeCloseTo(3.42, 9);
      expect(r.canPrintSpineText).toBe(false);
    });

    it('is true just over 3.5mm', () => {
      const r = computeSpineWidth({ sheetCount: 39, signatureCount: 1, paperGsm: 70, bindingType: 'saddle' });
      expect(r.totalSpineWidthMm).toBeCloseTo(3.51, 9);
      expect(r.canPrintSpineText).toBe(true);
    });

    it('is true exactly at the 3.5mm boundary (inclusive)', () => {
      const r = computeSpineWidth({ sheetCount: 35, signatureCount: 1, paperGsm: 80, bindingType: 'saddle' });
      expect(r.totalSpineWidthMm).toBeCloseTo(3.5, 9);
      expect(r.canPrintSpineText).toBe(true);
    });
  });
});

describe('computeCoverDimensions', () => {
  const dimsInput = fc.record({
    pageWidthPt: fc.double({ min: 50, max: 2000, noNaN: true }),
    pageHeightPt: fc.double({ min: 50, max: 2000, noNaN: true }),
    spineWidthPt: fc.double({ min: 0, max: 500, noNaN: true }),
    bleedPt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
    wrapMarginPt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  });

  it('the three rects tile left-to-right, share the full height, and sum exactly to totalWidthPt/totalHeightPt', () => {
    fc.assert(
      fc.property(dimsInput, (input) => {
        const result = computeCoverDimensions(input);
        const { backCoverRect, spineRect, frontCoverRect, totalWidthPt, totalHeightPt } = result;

        for (const rect of [backCoverRect, spineRect, frontCoverRect]) {
          expect(rect.y).toBe(0);
          expect(rect.height).toBe(totalHeightPt);
        }

        expect(backCoverRect.x).toBe(0);
        expect(spineRect.x).toBeCloseTo(backCoverRect.x + backCoverRect.width, 9);
        expect(frontCoverRect.x).toBeCloseTo(spineRect.x + spineRect.width, 9);
        expect(frontCoverRect.x + frontCoverRect.width).toBeCloseTo(totalWidthPt, 9);
        expect(backCoverRect.width + spineRect.width + frontCoverRect.width).toBeCloseTo(totalWidthPt, 9);
      }),
    );
  });

  it('applies default bleed (9pt) and wrapMargin (0pt) when omitted', () => {
    const result = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 20 });
    expect(result.totalWidthPt).toBeCloseTo(400 + 20 + 400 + 2 * 9 + 0, 9);
    expect(result.totalHeightPt).toBeCloseTo(600 + 2 * 9, 9);
  });
});

// generateCoverPdf fetches its bundled Noto Sans subset via a Vite `?url` asset
// import, which resolves under vitest but is not a fetchable URL in plain Node
// (see watermark-engine.test.ts / instructions-page.test.ts — same approach).
// Hand back the real TTF bytes from disk so tests exercise the actual
// fontkit/embedFont path rather than a fake one.
const __dirname = dirname(fileURLToPath(import.meta.url));
const readFont = (name: string) => {
  const b = readFileSync(resolve(__dirname, `../assets/fonts/${name}`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const REGULAR_FONT = readFont('NotoSans-Latin.ttf');
const BOLD_FONT = readFont('NotoSans-Latin-Bold.ttf');

function stubFontFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => (String(url).includes('Bold') ? BOLD_FONT : REGULAR_FONT),
    })),
  );
}

describe('generateCoverPdf', () => {
  afterEach(() => vi.unstubAllGlobals());

  const baseSpine = (overrides: Partial<SpineCalculationResult> = {}): SpineCalculationResult => ({
    textBlockThicknessMm: 5,
    threadSwellMm: 0,
    hingeAllowanceMm: 1,
    totalSpineWidthMm: 6,
    totalSpineWidthPt: 6 * MM_TO_PT,
    canPrintSpineText: true,
    ...overrides,
  });

  /** pdfjs reports pdf-lib's `rg` fills back as "#rrggbb", rounding each 0..1 channel the same way. */
  function toHex([r, g, b]: [number, number, number]): string {
    const channel = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }

  /** Every `setFillRGBColor` color used anywhere on the page, in drawing order. */
  async function extractFillColors(pdfBytes: Uint8Array): Promise<string[]> {
    const loadingTask = getDocument({ data: pdfBytes.slice() });
    try {
      const pdfDoc = await loadingTask.promise;
      const page = await pdfDoc.getPage(1);
      const opList = await page.getOperatorList();
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const colors: string[] = [];
      for (let i = 0; i < opList.fnArray.length; i++) {
        if (opList.fnArray[i] === OPS.setFillRGBColor) colors.push(opList.argsArray[i][0] as string);
      }
      return colors;
    } finally {
      await loadingTask.destroy();
    }
  }

  it('fills the full page with the theme background color and draws every text run in the theme text color', async () => {
    stubFontFetch();
    const themes = Object.keys(COVER_THEMES) as CoverTheme[];
    for (const theme of themes) {
      const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
      const pdfBytes = await generateCoverPdf({
        dimensions,
        content: { title: 'Theme Test', author: 'An Author', synopsis: 'A synopsis line.', theme },
        spineResult: baseSpine({ canPrintSpineText: true }),
      });

      const colors = await extractFillColors(pdfBytes);
      const { backgroundRgb, textRgb } = COVER_THEMES[theme];
      // The background rect is filled before any text is drawn, so it is always the first fill.
      expect(colors[0]).toBe(toHex(backgroundRgb));
      expect(colors.length).toBeGreaterThan(1);
      for (const color of colors.slice(1)) {
        expect(color).toBe(toHex(textRgb));
      }
    }
  });

  it('defaults to the cream theme when no theme is specified', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'No Theme' },
      spineResult: baseSpine({ canPrintSpineText: true }),
    });

    const colors = await extractFillColors(pdfBytes);
    expect(colors[0]).toBe(toHex(COVER_THEMES.cream.backgroundRgb));
  });

  /** All non-blank text items whose drawing origin's x falls within [xMin, xMax]. */
  async function extractTextInXRange(pdfBytes: Uint8Array, xMin: number, xMax: number): Promise<string[]> {
    const loadingTask = getDocument({ data: pdfBytes.slice() });
    const items: string[] = [];
    try {
      const pdfDoc = await loadingTask.promise;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const x = item.transform[4];
          if (x >= xMin - 0.01 && x <= xMax + 0.01) {
            items.push(item.str);
          }
        }
      }
    } finally {
      await loadingTask.destroy();
    }
    return items;
  }

  it('produces a valid, loadable single-page PDF sized to the computed dimensions', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Test Title', author: 'Test Author', synopsis: 'A short synopsis about the book.' },
      spineResult: baseSpine(),
    });

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(dimensions.totalWidthPt, 6);
    expect(page.getHeight()).toBeCloseTo(dimensions.totalHeightPt, 6);
  });

  it('draws no text at all in the spine area when canPrintSpineText is false', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'A Very Long Title That Would Otherwise Print On The Spine' },
      spineResult: baseSpine({ canPrintSpineText: false }),
    });

    const spineTextItems = await extractTextInXRange(pdfBytes, dimensions.spineRect.x, dimensions.spineRect.x + dimensions.spineRect.width);
    expect(spineTextItems).toHaveLength(0);
  });

  it('prints the (rotated) title on the spine when canPrintSpineText is true', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Spine Title' },
      spineResult: baseSpine({ canPrintSpineText: true }),
    });

    const spineTextItems = await extractTextInXRange(pdfBytes, dimensions.spineRect.x, dimensions.spineRect.x + dimensions.spineRect.width);
    expect(spineTextItems.length).toBeGreaterThan(0);
    expect(spineTextItems.join('')).toContain('Spine');
  });

  // pdf-lib's StandardFonts are WinAnsi-encoded and cannot draw ı/ş/ğ/ö/ü/ç —
  // generateCoverPdf embeds the bundled Noto Sans subset instead (same fix as
  // watermark-engine/instructions-page), so Turkish text must round-trip intact
  // through the PDF's own text layer, not just "not throw".
  it('renders Turkish characters in title, author, and synopsis correctly', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions({ pageWidthPt: 400, pageHeightPt: 600, spineWidthPt: 30 });
    const title = 'Yağmur Öyküleri';
    const author = 'Gülşah İnceçelik';
    const synopsis = 'Küçük bir şehirde geçen üzücü ama iğneleyici bir hikâye.';
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title, author, synopsis },
      spineResult: baseSpine({ canPrintSpineText: true }),
    });

    const allText = await extractTextInXRange(pdfBytes, -Infinity, Infinity);
    const joined = allText.join(' ');
    expect(joined).toContain('Yağmur');
    expect(joined).toContain('Öyküleri');
    expect(joined).toContain('Gülşah');
    expect(joined).toContain('İnceçelik');
    expect(joined).toContain('şehirde');
  });
});

describe('computeSplitCoverDimensions', () => {
  const splitInput = fc.record({
    pageWidthPt: fc.double({ min: 50, max: 2000, noNaN: true }),
    pageHeightPt: fc.double({ min: 50, max: 2000, noNaN: true }),
    spineWidthPt: fc.double({ min: 0, max: 500, noNaN: true }),
    bleedPt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
    wrapMarginPt: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: undefined }),
  });

  it('sheet 1 is exactly back cover + spine + lap flap, sheet 2 exactly front cover + glue tab', () => {
    fc.assert(
      fc.property(splitInput, (input) => {
        const { sheet1, sheet2 } = computeSplitCoverDimensions(input);

        expect(sheet1.widthPt).toBeCloseTo(
          sheet1.backCoverRect.width + sheet1.spineRect.width + sheet1.lapFlapRect.width, 9,
        );
        expect(sheet2.widthPt).toBeCloseTo(
          sheet2.frontCoverRect.width + sheet2.glueTabRect.width, 9,
        );
      }),
    );
  });

  // Stated against the literal millimetre figures the physical design calls for,
  // not against LAP_FLAP_WIDTH_MM / GLUE_TAB_WIDTH_MM — deriving the expectation
  // from the constants under test would make any change to them self-approving.
  it('defaults the lap flap to 20mm and the glue tab to 10mm', () => {
    expect(LAP_FLAP_WIDTH_MM).toBe(20);
    expect(GLUE_TAB_WIDTH_MM).toBe(10);

    fc.assert(
      fc.property(splitInput, (input) => {
        const { sheet1, sheet2 } = computeSplitCoverDimensions(input);
        expect(sheet1.lapFlapRect.width / MM_TO_PT).toBeCloseTo(20, 9);
        expect(sheet2.glueTabRect.width / MM_TO_PT).toBeCloseTo(10, 9);
      }),
    );
  });

  it('honours explicit lapFlapPt / glueTabPt overrides', () => {
    const result = computeSplitCoverDimensions({
      pageWidthPt: 420, pageHeightPt: 595, spineWidthPt: 28, lapFlapPt: 60, glueTabPt: 15,
    });
    expect(result.sheet1.lapFlapRect.width).toBe(60);
    expect(result.sheet2.glueTabRect.width).toBe(15);
  });

  it('panels tile left-to-right with no gap or overlap and share the full sheet height', () => {
    fc.assert(
      fc.property(splitInput, (input) => {
        const { sheet1, sheet2, totalHeightPt } = computeSplitCoverDimensions(input);

        for (const rect of [sheet1.backCoverRect, sheet1.spineRect, sheet1.lapFlapRect, sheet2.glueTabRect, sheet2.frontCoverRect]) {
          expect(rect.y).toBe(0);
          expect(rect.height).toBe(totalHeightPt);
        }
        expect(sheet1.heightPt).toBe(totalHeightPt);
        expect(sheet2.heightPt).toBe(totalHeightPt);

        expect(sheet1.backCoverRect.x).toBe(0);
        expect(sheet1.spineRect.x).toBeCloseTo(sheet1.backCoverRect.x + sheet1.backCoverRect.width, 9);
        expect(sheet1.lapFlapRect.x).toBeCloseTo(sheet1.spineRect.x + sheet1.spineRect.width, 9);
        expect(sheet1.lapFlapRect.x + sheet1.lapFlapRect.width).toBeCloseTo(sheet1.widthPt, 9);

        expect(sheet2.glueTabRect.x).toBe(0);
        expect(sheet2.frontCoverRect.x).toBeCloseTo(sheet2.glueTabRect.x + sheet2.glueTabRect.width, 9);
        expect(sheet2.frontCoverRect.x + sheet2.frontCoverRect.width).toBeCloseTo(sheet2.widthPt, 9);
      }),
    );
  });

  it('every crease guide sits exactly on a panel boundary, never inside a panel', () => {
    fc.assert(
      fc.property(splitInput, (input) => {
        const { sheet1, sheet2 } = computeSplitCoverDimensions(input);

        expect(sheet1.foldLinesX).toEqual([sheet1.spineRect.x, sheet1.lapFlapRect.x]);
        expect(sheet2.foldLinesX).toEqual([sheet2.frontCoverRect.x]);

        for (const x of [...sheet1.foldLinesX, ...sheet2.foldLinesX]) {
          expect(Number.isFinite(x)).toBe(true);
          expect(x).toBeGreaterThan(0);
        }
        for (const x of sheet1.foldLinesX) expect(x).toBeLessThan(sheet1.widthPt);
        for (const x of sheet2.foldLinesX) expect(x).toBeLessThan(sheet2.widthPt);
      }),
    );
  });

  it('the two cover panels are the same size as the single wrap they replace, and the height is identical', () => {
    fc.assert(
      fc.property(splitInput, (input) => {
        const single = computeCoverDimensions(input);
        const split = computeSplitCoverDimensions(input);

        expect(split.totalHeightPt).toBeCloseTo(single.totalHeightPt, 9);
        expect(split.sheet1.backCoverRect.width).toBeCloseTo(single.backCoverRect.width, 9);
        expect(split.sheet2.frontCoverRect.width).toBeCloseTo(single.frontCoverRect.width, 9);
        expect(split.sheet1.spineRect.width).toBeCloseTo(single.spineRect.width, 9);
      }),
    );
  });

  // Splitting only buys width back when a cover panel is wider than the flap it
  // gains, which is true of every real trim size (the smallest here, A6 at
  // 105mm, still dwarfs the 20mm flap).
  const realisticSplitInput = fc.record({
    pageWidthPt: fc.double({ min: 105 * MM_TO_PT, max: 210 * MM_TO_PT, noNaN: true }),
    pageHeightPt: fc.double({ min: 148 * MM_TO_PT, max: 297 * MM_TO_PT, noNaN: true }),
    spineWidthPt: fc.double({ min: 0, max: 30 * MM_TO_PT, noNaN: true }),
    bleedPt: fc.double({ min: 0, max: 3 * MM_TO_PT, noNaN: true }),
    wrapMarginPt: fc.double({ min: 0, max: 15 * MM_TO_PT, noNaN: true }),
  });

  it('both sheets are strictly narrower than the single wrap — the whole point of splitting', () => {
    fc.assert(
      fc.property(realisticSplitInput, (input) => {
        const single = computeCoverDimensions(input);
        const split = computeSplitCoverDimensions(input);
        expect(split.sheet1.widthPt).toBeLessThan(single.totalWidthPt);
        expect(split.sheet2.widthPt).toBeLessThan(single.totalWidthPt);
      }),
    );
  });

  // The physical claim the split format exists to make: for any book a home
  // binder would actually produce on a home printer, BOTH sheets feed through
  // A4. Ranges cover A5 (148mm) through A4 (210mm) trim, a spine up to 30mm
  // (~230 sheets of 120gsm) and the app's full bleed/hardcover-wrap allowances.
  it('both sheets fit within A4 (297mm) for every realistic home-binding job', () => {
    const realisticInput = fc.record({
      pageWidthPt: fc.double({ min: 148 * MM_TO_PT, max: 210 * MM_TO_PT, noNaN: true }),
      pageHeightPt: fc.double({ min: 210 * MM_TO_PT, max: 297 * MM_TO_PT, noNaN: true }),
      spineWidthPt: fc.double({ min: 0, max: 30 * MM_TO_PT, noNaN: true }),
      bleedPt: fc.double({ min: 0, max: 3 * MM_TO_PT, noNaN: true }),
      wrapMarginPt: fc.double({ min: 0, max: 15 * MM_TO_PT, noNaN: true }),
    });

    fc.assert(
      fc.property(realisticInput, (input) => {
        const { sheet1, sheet2 } = computeSplitCoverDimensions(input);
        const a4Pt = A4_LONG_EDGE_MM * MM_TO_PT;
        expect(sheet1.widthPt).toBeLessThanOrEqual(a4Pt);
        expect(sheet2.widthPt).toBeLessThanOrEqual(a4Pt);
      }),
    );
  });

  // Same jobs, single wrap: an A5 book's one-piece cover is already too wide for
  // A4 at zero spine, which is the problem the split format solves. Without this
  // the A4-fit invariant above could pass trivially on inputs that never needed
  // splitting in the first place.
  it('the single wrap does NOT fit A4 for those same jobs', () => {
    // The app's own A5 softcover settings: 148mm trim, 3mm bleed, 8mm spine.
    const single = computeCoverDimensions({
      pageWidthPt: 148 * MM_TO_PT,
      pageHeightPt: 210 * MM_TO_PT,
      spineWidthPt: 8 * MM_TO_PT,
      bleedPt: 3 * MM_TO_PT,
      wrapMarginPt: 0,
    });
    expect(single.totalWidthPt).toBeGreaterThan(A4_LONG_EDGE_MM * MM_TO_PT);

    // ...and even the impossible best case — zero spine, zero bleed — leaves
    // less slack on the A4 long edge than a home printer's non-printable border
    // on the two sides combined, so it is unprintable there too.
    const MIN_PRINTER_SIDE_MARGIN_MM = 3;
    const bestCase = computeCoverDimensions({
      pageWidthPt: 148 * MM_TO_PT, pageHeightPt: 210 * MM_TO_PT, spineWidthPt: 0, bleedPt: 0, wrapMarginPt: 0,
    });
    const slackMm = (A4_LONG_EDGE_MM * MM_TO_PT - bestCase.totalWidthPt) / MM_TO_PT;
    expect(slackMm).toBeLessThan(2 * MIN_PRINTER_SIDE_MARGIN_MM);
  });

  it('pins A4 to its real long edge of 297mm', () => {
    expect(A4_LONG_EDGE_MM).toBe(297);
  });

  it('tags its result "split" while computeCoverDimensions tags "single"', () => {
    const input = { pageWidthPt: 420, pageHeightPt: 595, spineWidthPt: 28 };
    expect(computeSplitCoverDimensions(input).format).toBe('split');
    expect(computeCoverDimensions(input).format).toBe('single');
  });
});

describe('generateCoverPdf — split format', () => {
  afterEach(() => vi.unstubAllGlobals());

  const spineResult: SpineCalculationResult = {
    textBlockThicknessMm: 5,
    threadSwellMm: 0,
    hingeAllowanceMm: 1,
    totalSpineWidthMm: 6,
    totalSpineWidthPt: 6 * MM_TO_PT,
    canPrintSpineText: true,
  };

  const A5_SPLIT = {
    pageWidthPt: 148 * MM_TO_PT,
    pageHeightPt: 210 * MM_TO_PT,
    spineWidthPt: 8 * MM_TO_PT,
    bleedPt: 3 * MM_TO_PT,
    wrapMarginPt: 0,
  };

  /** Non-blank text drawn on each page, indexed by page number - 1. */
  async function extractTextPerPage(pdfBytes: Uint8Array): Promise<string[][]> {
    const loadingTask = getDocument({ data: pdfBytes.slice() });
    try {
      const pdfDoc = await loadingTask.promise;
      const pages: string[][] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        pages.push(
          textContent.items
            .filter((item): item is typeof item & { str: string } => 'str' in item && Boolean(item.str.trim()))
            .map((item) => item.str),
        );
      }
      return pages;
    } finally {
      await loadingTask.destroy();
    }
  }

  /** Every `setDash` operand pair on each page, indexed by page number - 1. */
  async function extractDashPatternsPerPage(pdfBytes: Uint8Array): Promise<number[][][]> {
    const loadingTask = getDocument({ data: pdfBytes.slice() });
    try {
      const pdfDoc = await loadingTask.promise;
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pages: number[][][] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const opList = await page.getOperatorList();
        const dashes: number[][] = [];
        for (let op = 0; op < opList.fnArray.length; op++) {
          if (opList.fnArray[op] !== OPS.setDash) continue;
          const pattern = opList.argsArray[op][0] as number[];
          if (Array.isArray(pattern) && pattern.length > 0) dashes.push(pattern);
        }
        pages.push(dashes);
      }
      return pages;
    } finally {
      await loadingTask.destroy();
    }
  }

  it('produces a 2-page PDF on real A4 sheets, not on the artwork\'s own box', async () => {
    stubFontFetch();
    const dimensions = computeSplitCoverDimensions(A5_SPLIT);
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Split Test', author: 'An Author', synopsis: 'Back cover copy.' },
      spineResult,
    });

    // This used to assert the pages WERE the artwork boxes. That is exactly the
    // bug: a 176.60 x 216.00 mm page box made every driver fit-to-page the sheet
    // onto A4, enlarging the spine by 18.9% so the cover missed its book block.
    const a4WidthPt = A4_SHORT_EDGE_MM * MM_TO_PT;
    const a4HeightPt = A4_LONG_EDGE_MM * MM_TO_PT;
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(2);
    for (const page of [doc.getPage(0), doc.getPage(1)]) {
      expect(page.getWidth()).toBeCloseTo(a4WidthPt, 6);
      expect(page.getHeight()).toBeCloseTo(a4HeightPt, 6);
    }
    // The artwork still has to fit inside that sheet, or the page box would be
    // lying in the other direction.
    expect(dimensions.sheet1.widthPt).toBeLessThanOrEqual(a4WidthPt);
    expect(dimensions.totalHeightPt).toBeLessThanOrEqual(a4HeightPt);
  });

  it('butts each split sheet against its own mating edge and centres it vertically', () => {
    const dimensions = computeSplitCoverDimensions(A5_SPLIT);
    const a4WidthPt = A4_SHORT_EDGE_MM * MM_TO_PT;
    const a4HeightPt = A4_LONG_EDGE_MM * MM_TO_PT;

    const place1 = placeSheetOnPrinterPaper(dimensions.sheet1.widthPt, dimensions.totalHeightPt, 'right');
    const place2 = placeSheetOnPrinterPaper(dimensions.sheet2.widthPt, dimensions.totalHeightPt, 'left');

    expect(place1.fitsPrinterSheet).toBe(true);
    expect(place2.fitsPrinterSheet).toBe(true);

    // Sheet 1's lap flap is its right edge and sheet 2's glue tab its left, so
    // each of those lands on the paper's own edge and needs no cut at all.
    expect(place1.offsetXPt).toBeCloseTo(a4WidthPt - dimensions.sheet1.widthPt, 6);
    expect(place2.offsetXPt).toBeCloseTo(0, 6);

    // Vertically there is no mating edge, so the artwork is centred: equal
    // margin at head and tail.
    const expectedY = (a4HeightPt - dimensions.totalHeightPt) / 2;
    expect(place1.offsetYPt).toBeCloseTo(expectedY, 6);
    expect(place2.offsetYPt).toBeCloseTo(expectedY, 6);

    // The mating edges must end up at the same distance from their sheets'
    // opposite paper edges, or the two halves cannot meet flush.
    expect(place1.offsetXPt + dimensions.sheet1.widthPt).toBeCloseTo(a4WidthPt, 6);
    expect(place2.offsetXPt).toBeCloseTo(0, 6);
  });

  it('leaves artwork too large for A4 at its own size rather than shrinking it', () => {
    const a4WidthPt = A4_SHORT_EDGE_MM * MM_TO_PT;
    const a4HeightPt = A4_LONG_EDGE_MM * MM_TO_PT;

    // The single A5 wrap: 302 mm + spine wide, so it clears neither A4 edge and
    // is a legitimate A3 / copy-shop job that must not regress.
    const single = computeCoverDimensions(A5_SPLIT);
    const tooWide = placeSheetOnPrinterPaper(single.totalWidthPt, single.totalHeightPt, 'right');
    expect(single.totalWidthPt).toBeGreaterThan(a4WidthPt);
    expect(tooWide.fitsPrinterSheet).toBe(false);
    expect(tooWide.pageWidthPt).toBeCloseTo(single.totalWidthPt, 6);
    expect(tooWide.pageHeightPt).toBeCloseTo(single.totalHeightPt, 6);
    expect(tooWide.offsetXPt).toBe(0);
    expect(tooWide.offsetYPt).toBe(0);

    // Too tall counts just as much as too wide: an A4-trim book's cover is
    // 303 mm high and must keep its own box too.
    const tooTall = placeSheetOnPrinterPaper(a4WidthPt - 1, a4HeightPt + 1, 'left');
    expect(tooTall.fitsPrinterSheet).toBe(false);
    expect(tooTall.pageHeightPt).toBeCloseTo(a4HeightPt + 1, 6);
  });

  it('the single format still produces exactly 1 page from the same book', async () => {
    stubFontFetch();
    const dimensions = computeCoverDimensions(A5_SPLIT);
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Single Test', author: 'An Author', synopsis: 'Back cover copy.' },
      spineResult,
    });
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);
  });

  it('puts the synopsis and spine title on sheet 1 and the title/author on sheet 2', async () => {
    stubFontFetch();
    const dimensions = computeSplitCoverDimensions(A5_SPLIT);
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Kayıp Defter', author: 'Şule Yılmaz', synopsis: 'Arka kapak tanıtımı burada.' },
      spineResult,
    });

    const [sheet1Text, sheet2Text] = await extractTextPerPage(pdfBytes);
    const sheet1 = sheet1Text.join(' ');
    const sheet2 = sheet2Text.join(' ');

    // Sheet 1 carries the back cover and the spine — never the front-cover author line.
    expect(sheet1).toContain('Arka');
    expect(sheet1).toContain('Kayıp');
    expect(sheet1).not.toContain('Şule');

    // Sheet 2 carries the front cover only — no synopsis bleeding across.
    expect(sheet2).toContain('Kayıp');
    expect(sheet2).toContain('Şule');
    expect(sheet2).not.toContain('Arka');
  });

  it('draws a dashed crease guide for every fold line — two on sheet 1, one on sheet 2', async () => {
    stubFontFetch();
    const dimensions = computeSplitCoverDimensions(A5_SPLIT);
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Creases', synopsis: 'Back.' },
      spineResult,
    });

    const [sheet1Dashes, sheet2Dashes] = await extractDashPatternsPerPage(pdfBytes);
    expect(sheet1Dashes).toHaveLength(dimensions.sheet1.foldLinesX.length);
    expect(sheet2Dashes).toHaveLength(dimensions.sheet2.foldLinesX.length);
    expect(sheet1Dashes).toHaveLength(2);
    expect(sheet2Dashes).toHaveLength(1);
    for (const pattern of [...sheet1Dashes, ...sheet2Dashes]) {
      expect(pattern).toEqual([4, 4]);
    }
  });

  it('the single format draws no crease guides at all', async () => {
    stubFontFetch();
    const pdfBytes = await generateCoverPdf({
      dimensions: computeCoverDimensions(A5_SPLIT),
      content: { title: 'No Creases', synopsis: 'Back.' },
      spineResult,
    });
    expect((await extractDashPatternsPerPage(pdfBytes))[0]).toHaveLength(0);
  });

  it('fills both sheets with the theme background so the two halves match once assembled', async () => {
    stubFontFetch();
    const loadColors = async (pdfBytes: Uint8Array, pageNum: number): Promise<string[]> => {
      const loadingTask = getDocument({ data: pdfBytes.slice() });
      try {
        const pdfDoc = await loadingTask.promise;
        const page = await pdfDoc.getPage(pageNum);
        const opList = await page.getOperatorList();
        const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const colors: string[] = [];
        for (let i = 0; i < opList.fnArray.length; i++) {
          if (opList.fnArray[i] === OPS.setFillRGBColor) colors.push(opList.argsArray[i][0] as string);
        }
        return colors;
      } finally {
        await loadingTask.destroy();
      }
    };
    const channel = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    const expected = `#${COVER_THEMES.navy.backgroundRgb.map(channel).join('')}`;

    const pdfBytes = await generateCoverPdf({
      dimensions: computeSplitCoverDimensions(A5_SPLIT),
      content: { title: 'Navy Split', synopsis: 'Back.', theme: 'navy' },
      spineResult,
    });

    expect((await loadColors(pdfBytes, 1))[0]).toBe(expected);
    expect((await loadColors(pdfBytes, 2))[0]).toBe(expected);
  });

  it('rejects an options.format that disagrees with the dimensions it was given', async () => {
    stubFontFetch();
    await expect(
      generateCoverPdf({
        dimensions: computeCoverDimensions(A5_SPLIT),
        content: { title: 'Mismatch' },
        spineResult,
        format: 'split',
      }),
    ).rejects.toThrow(BookletError);

    await expect(
      generateCoverPdf({
        dimensions: computeSplitCoverDimensions(A5_SPLIT),
        content: { title: 'Mismatch' },
        spineResult,
        format: 'single',
      }),
    ).rejects.toThrow(BookletError);
  });

  it('accepts an options.format that agrees with the dimensions', async () => {
    stubFontFetch();
    const split = await generateCoverPdf({
      dimensions: computeSplitCoverDimensions(A5_SPLIT),
      content: { title: 'Agrees' },
      spineResult,
      format: 'split',
    });
    expect((await PDFDocument.load(split)).getPageCount()).toBe(2);

    const single = await generateCoverPdf({
      dimensions: computeCoverDimensions(A5_SPLIT),
      content: { title: 'Agrees' },
      spineResult,
      format: 'single',
    });
    expect((await PDFDocument.load(single)).getPageCount()).toBe(1);
  });

  it('leaves the spine blank on sheet 1 when the spine is below the legibility floor', async () => {
    stubFontFetch();
    const dimensions = computeSplitCoverDimensions(A5_SPLIT);
    const pdfBytes = await generateCoverPdf({
      dimensions,
      content: { title: 'Unprintable Spine Title' },
      spineResult: { ...spineResult, canPrintSpineText: false },
    });

    const [sheet1Text] = await extractTextPerPage(pdfBytes);
    expect(sheet1Text.join(' ')).not.toContain('Unprintable');
  });
});
