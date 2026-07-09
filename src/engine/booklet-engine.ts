import { PDFDocument, PDFEmbeddedPage, PDFPage, degrees } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';
import type { BookletOptions, BookletResult, PaperSize } from './types';

const TARGET_WIDTH = 842.0; // A4 landscape, points
const TARGET_HEIGHT = 595.0;

// Named sheet presets, in points and always landscape (width >= height). Each
// half of the sheet holds one booklet page.
const SHEET_PRESETS = {
  A4: [842, 595],
  Letter: [792, 612],
  A5: [595, 420],
  A3: [1191, 842],
} as const satisfies Record<string, readonly [number, number]>;

// PDF spec caps a page dimension at 14400pt (200 inches); 72pt (1 inch) is a
// sane floor for a printable sheet.
const MIN_SHEET_PT = 72;
const MAX_SHEET_PT = 14400;

/**
 * Resolves a {@link PaperSize} into a concrete `[width, height]` sheet size in
 * points. `'source'` derives the sheet from the document's most common page
 * size (width = 2×modeWidth so each half matches the source page), which needs
 * `srcDoc`/`pageCount`. Custom sizes are validated against the PDF page bounds.
 * Pure aside from the optional mode-size lookup, so it is unit-testable.
 */
export function resolveSheetSize(
  paperSize: PaperSize | undefined,
  srcDoc?: PDFDocument,
  pageCount?: number,
): [number, number] {
  if (paperSize === undefined) {
    return [TARGET_WIDTH, TARGET_HEIGHT];
  }

  if (typeof paperSize === 'string') {
    if (paperSize === 'source') {
      if (!srcDoc || pageCount === undefined) {
        throw new BookletError("'source' kağıt boyutu için kaynak belge gerekli.");
      }
      const [modeWidth, modeHeight] = modePageSize(srcDoc, pageCount);
      return [2 * modeWidth, modeHeight];
    }
    const preset = SHEET_PRESETS[paperSize];
    if (!preset) {
      throw new BookletError(`Geçersiz kağıt boyutu: ${paperSize}.`);
    }
    return [preset[0], preset[1]];
  }

  const { width, height } = paperSize;
  const inBounds = (v: number) => Number.isFinite(v) && v >= MIN_SHEET_PT && v <= MAX_SHEET_PT;
  if (!inBounds(width) || !inBounds(height)) {
    throw new BookletError(
      `Geçersiz kağıt boyutu: ${width}×${height}pt. Her iki kenar da ${MIN_SHEET_PT}–${MAX_SHEET_PT}pt aralığında olmalı.`,
    );
  }
  return [width, height];
}

export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes the left/right slot rectangles for one booklet sheet, applying the
 * gutter/creep inward shift. Pure arithmetic extracted 1:1 from makeBooklet's
 * per-sheet layout so it can be unit-tested against hand-computed constants.
 *
 * `sheetIndex` is the 0-based sheet number, `gutter` the total binding gutter
 * and `creep` the per-sheet creep step (all in points). `sheetWidth`/
 * `sheetHeight` default to A4 landscape so existing callers are unaffected.
 */
export function computeSlotRects(
  sheetIndex: number,
  gutter: number,
  creep: number,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): { left: FitRect; right: FitRect } {
  const wSlot = sheetWidth / 2.0;
  const hSlot = sheetHeight;
  const creepShift = sheetIndex * creep;
  const shiftInward = creepShift - gutter / 2.0;

  const left: FitRect = { x: shiftInward, y: 0, width: wSlot, height: hSlot };
  const right: FitRect = { x: wSlot - shiftInward, y: 0, width: wSlot, height: hSlot };
  return { left, right };
}

/**
 * Scales an embedded source page to fit inside `rect` while preserving its
 * aspect ratio, centering it within the rect — mirrors PyMuPDF's
 * `show_pdf_page(rect, ..., keep_proportion=True)` behaviour.
 */
function drawFitted(
  page: PDFPage,
  embedded: PDFEmbeddedPage,
  rect: FitRect,
  rotate180 = false,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): void {
  const scale = Math.min(rect.width / embedded.width, rect.height / embedded.height);
  const drawnWidth = embedded.width * scale;
  const drawnHeight = embedded.height * scale;
  const x = rect.x + (rect.width - drawnWidth) / 2;
  const y = rect.y + (rect.height - drawnHeight) / 2;

  if (!rotate180) {
    page.drawPage(embedded, { x, y, width: drawnWidth, height: drawnHeight });
    return;
  }

  // Long-edge duplex: rotate the whole back composition 180° about the sheet
  // centre (point reflection). pdf-lib's drawPage rotates about the supplied
  // (x, y) origin, and with rotate:180 the scaled page extends *down-left* from
  // that origin. Passing the point-reflected top-right corner
  // (sheetWidth - x, sheetHeight - y) therefore lands the rotated page in the
  // reflected rectangle — the reflection MUST use the actual sheet size, not a
  // fixed A4 constant. Offset verified against the emitted content-stream matrix
  // in booklet-engine.test.ts (not assumed).
  page.drawPage(embedded, {
    x: sheetWidth - x,
    y: sheetHeight - y,
    width: drawnWidth,
    height: drawnHeight,
    rotate: degrees(180),
  });
}

export interface SheetMapping {
  frontLeft: number;
  frontRight: number;
  backLeft: number;
  backRight: number;
}

/**
 * Computes the 0-based source page index for each slot of every sheet, for
 * a (already-padded) document of `N` pages. Pure arithmetic, ported 1:1
 * from engine.py's per-sheet index formulas — see SPECIFICATION.md for the
 * worked 16-page example this is verified against.
 */
export function computeSheetMapping(N: number): SheetMapping[] {
  const S = Math.floor(N / 4);
  const sheets: SheetMapping[] = [];
  for (let j = 0; j < S; j++) {
    sheets.push({
      frontLeft: N - 2 * j - 1,
      frontRight: 2 * j,
      backLeft: 2 * j + 1,
      backRight: N - 2 * j - 2,
    });
  }
  return sheets;
}

// Two page dimensions are treated as equal within this many points, absorbing
// the sub-point rounding noise common in real PDFs.
const SIZE_TOLERANCE = 0.5;

/**
 * Returns the most common (mode) page size across the first `pageCount` pages
 * of `doc`. Sizes within SIZE_TOLERANCE points on both axes are grouped as the
 * same size; ties are broken in favour of the size that appears earliest, so a
 * uniform document (and a tie) always yields the first page's size.
 */
export function modePageSize(doc: PDFDocument, pageCount: number): [number, number] {
  const buckets: Array<{ size: [number, number]; count: number; firstIndex: number }> = [];
  for (let i = 0; i < pageCount; i++) {
    const { width, height } = doc.getPage(i).getSize();
    const bucket = buckets.find(
      (b) =>
        Math.abs(b.size[0] - width) <= SIZE_TOLERANCE &&
        Math.abs(b.size[1] - height) <= SIZE_TOLERANCE,
    );
    if (bucket) {
      bucket.count += 1;
    } else {
      buckets.push({ size: [width, height], count: 1, firstIndex: i });
    }
  }

  let best = buckets[0];
  for (const b of buckets) {
    if (b.count > best.count || (b.count === best.count && b.firstIndex < best.firstIndex)) {
      best = b;
    }
  }
  return best.size;
}

/**
 * Performs the booklet imposition: pads the source to a multiple of 4 pages,
 * then splits it into front/back A4-landscape sheets ready for duplex
 * printing and center folding.
 *
 * Page-mapping arithmetic and gutter/creep shift formulas are a direct port
 * of pdf_booklet/engine.py (BookletEngine.make_booklet) — kept numerically
 * identical so the two implementations always agree.
 */
export async function makeBooklet(
  inputBytes: Uint8Array,
  options: BookletOptions = {},
): Promise<BookletResult> {
  const baseGutter = options.gutter ?? 0;
  const creepStep = options.creep ?? 0;
  const flipEdge = options.flipEdge ?? 'short';

  if (creepStep < 0) {
    throw new BookletError('Creep değeri negatif olamaz.');
  }
  if (flipEdge !== 'short' && flipEdge !== 'long') {
    throw new BookletError(`Geçersiz çevirme kenarı değeri: ${flipEdge}. 'short' veya 'long' olmalı.`);
  }

  const { pageCount: originalPageCount } = await validatePdf(inputBytes);
  const srcDoc = await PDFDocument.load(inputBytes);

  // Resolve the physical sheet size; every slot/shift below is derived from it
  // rather than the fixed A4 constants. 'source' needs the pre-padding pages.
  const [sheetWidth, sheetHeight] = resolveSheetSize(options.paperSize, srcDoc, originalPageCount);
  const wSlot = sheetWidth / 2.0;

  if (baseGutter < 0 || baseGutter >= wSlot) {
    throw new BookletError(`Geçersiz gutter değeri: ${baseGutter}. 0 ile ${wSlot} arasında olmalı.`);
  }

  // 1. Dynamic blank page padding so the page count is a multiple of 4.
  //    Blank pages take the document's most common (mode) page size rather
  //    than merely the last page's, so a stray final page (e.g. a landscape
  //    cover in a portrait document) doesn't dictate the padding geometry.
  const remainder = originalPageCount % 4;
  let paddingApplied = 0;
  if (remainder !== 0) {
    paddingApplied = 4 - remainder;
    const [padWidth, padHeight] = modePageSize(srcDoc, originalPageCount);
    for (let i = 0; i < paddingApplied; i++) {
      const blankPage = srcDoc.addPage([padWidth, padHeight]);
      // pdf-lib only materializes a page's Contents stream once something is
      // drawn on it; embedPdf() requires Contents to exist, so force it here.
      blankPage.pushOperators();
    }
  }

  const N = srcDoc.getPageCount();
  const mapping = computeSheetMapping(N);
  const S = mapping.length;

  // Guard against excessive creep: on the last sheet the inward shift must not
  // exceed half a slot, otherwise pages would be pushed off their own half.
  const maxShiftInward = (S - 1) * creepStep - baseGutter / 2.0;
  if (maxShiftInward > wSlot / 2.0) {
    throw new BookletError(
      `Geçersiz creep değeri: ${creepStep}. Son yaprakta oluşan kayma (${maxShiftInward.toFixed(1)}pt) slot yarısını (${wSlot / 2.0}pt) aşıyor.`,
    );
  }

  // 2. Flatten the per-sheet source page indices (0-based) for batch embedding.
  const frontIndices: number[] = [];
  const backIndices: number[] = [];
  for (const sheet of mapping) {
    frontIndices.push(sheet.frontLeft, sheet.frontRight);
    backIndices.push(sheet.backLeft, sheet.backRight);
  }

  const frontDoc = await PDFDocument.create();
  const backDoc = await PDFDocument.create();

  const frontEmbedded = await frontDoc.embedPdf(srcDoc, frontIndices);
  const backEmbedded = await backDoc.embedPdf(srcDoc, backIndices);

  // 3. Lay out each sheet, applying the gutter/creep inward shift. For
  //    long-edge duplex the back composition is rotated 180° as a whole, which
  //    also carries the gutter/creep shift to the correct side automatically.
  const rotateBack = flipEdge === 'long';
  for (let j = 0; j < S; j++) {
    const { left: leftRect, right: rightRect } = computeSlotRects(
      j,
      baseGutter,
      creepStep,
      sheetWidth,
      sheetHeight,
    );

    const frontPage = frontDoc.addPage([sheetWidth, sheetHeight]);
    drawFitted(frontPage, frontEmbedded[2 * j], leftRect);
    drawFitted(frontPage, frontEmbedded[2 * j + 1], rightRect);

    const backPage = backDoc.addPage([sheetWidth, sheetHeight]);
    drawFitted(backPage, backEmbedded[2 * j], leftRect, rotateBack, sheetWidth, sheetHeight);
    drawFitted(backPage, backEmbedded[2 * j + 1], rightRect, rotateBack, sheetWidth, sheetHeight);
  }

  const frontPdf = await frontDoc.save();
  const backPdf = await backDoc.save();

  const combinedDoc = await PDFDocument.create();
  const frontPages = await combinedDoc.copyPages(frontDoc, Array.from({ length: S }, (_, i) => i));
  const backPages = await combinedDoc.copyPages(backDoc, Array.from({ length: S }, (_, i) => i));
  for (let j = 0; j < S; j++) {
    combinedDoc.addPage(frontPages[j]);
    combinedDoc.addPage(backPages[j]);
  }
  const combinedPdf = await combinedDoc.save();

  return {
    originalPages: originalPageCount,
    paddedPages: N,
    sheetsCount: S,
    paddingApplied,
    frontPdf,
    backPdf,
    combinedPdf,
  };
}
