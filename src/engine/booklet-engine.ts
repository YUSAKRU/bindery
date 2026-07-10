import { PDFDocument, PDFEmbeddedPage, PDFPage, degrees } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';
import type { BookletOptions, BookletResult, PaperSize } from './types';
import { makeInstructionsPage } from './instructions-page';

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

/** Human-readable label for the resolved sheet, for the instructions page. */
function paperLabel(paperSize: PaperSize | undefined, width: number, height: number): string {
  if (paperSize === undefined) return 'A4 landscape';
  if (typeof paperSize === 'string') {
    if (paperSize === 'source') return `${Math.round(width)} x ${Math.round(height)} pt (source)`;
    return `${paperSize} landscape`;
  }
  return `${Math.round(width)} x ${Math.round(height)} pt`;
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

// Documents longer than this many pages default (under 'auto') to being split
// into 16-page signatures rather than one huge saddle-stitched booklet.
const AUTO_SIGNATURE_THRESHOLD = 40;
const AUTO_SIGNATURE_SIZE = 16;

/**
 * Resolves the effective signature length (pages per signature) for an already
 * padded `N`-page document. `undefined` → a single signature spanning the whole
 * document (historical behaviour); `'auto'` → one signature up to
 * {@link AUTO_SIGNATURE_THRESHOLD} pages, else {@link AUTO_SIGNATURE_SIZE}. A
 * number must be a positive multiple of 4. A size ≥ N collapses to one
 * signature naturally (no error).
 */
export function resolveSignatureSize(N: number, signatureSize?: number | 'auto'): number {
  if (signatureSize === undefined) {
    return N;
  }
  if (signatureSize === 'auto') {
    return N <= AUTO_SIGNATURE_THRESHOLD ? N : AUTO_SIGNATURE_SIZE;
  }
  if (!Number.isInteger(signatureSize) || signatureSize <= 0 || signatureSize % 4 !== 0) {
    throw new BookletError(`Geçersiz imza boyutu: ${signatureSize}. Pozitif ve 4'ün katı olmalı.`);
  }
  return signatureSize;
}

/**
 * Returns the 1-based page number (within the padded block) at which each
 * signature begins — i.e. the front-right slot of each signature's first sheet.
 * Callers imposing a separate cover add the inner-block offset themselves. Used
 * by the printed instructions/reading-order check. Pure and test-friendly.
 */
export function signatureStartPages(N: number, signatureSize?: number | 'auto'): number[] {
  const sigLen = resolveSignatureSize(N, signatureSize);
  const starts: number[] = [];
  for (let start = 0; start < N; start += sigLen) {
    starts.push(start + 1);
  }
  return starts;
}

/**
 * Splits an already-padded `N`-page document into signatures — groups of sheets
 * folded together — and returns the per-sheet mapping for each. The outer array
 * is the signatures in order; each inner array is that signature's sheets.
 *
 * Every signature is imposed with the same saddle-stitch arithmetic as a
 * standalone booklet ({@link computeSheetMapping}) over its own page range, then
 * offset by the signature's start index. The final signature may be shorter than
 * `signatureSize` but is still a multiple of 4 (since both `N` and the size are).
 */
export function computeSignatureMappings(
  N: number,
  signatureSize?: number | 'auto',
): SheetMapping[][] {
  const sigLen = resolveSignatureSize(N, signatureSize);
  const signatures: SheetMapping[][] = [];
  for (let start = 0; start < N; start += sigLen) {
    const len = Math.min(sigLen, N - start);
    const sheets = computeSheetMapping(len).map((s) => ({
      frontLeft: s.frontLeft + start,
      frontRight: s.frontRight + start,
      backLeft: s.backLeft + start,
      backRight: s.backRight + start,
    }));
    signatures.push(sheets);
  }
  return signatures;
}

// Two page dimensions are treated as equal within this many points, absorbing
// the sub-point rounding noise common in real PDFs.
const SIZE_TOLERANCE = 0.5;

/**
 * Returns the most common (mode) size from a list. Sizes within SIZE_TOLERANCE
 * points on both axes are grouped as the same size; ties are broken in favour of
 * the size that appears earliest, so a uniform list (and a tie) yields the first.
 */
function modeOfSizes(sizes: Array<[number, number]>): [number, number] {
  const buckets: Array<{ size: [number, number]; count: number; firstIndex: number }> = [];
  sizes.forEach(([width, height], i) => {
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
  });

  let best = buckets[0];
  for (const b of buckets) {
    if (b.count > best.count || (b.count === best.count && b.firstIndex < best.firstIndex)) {
      best = b;
    }
  }
  return best.size;
}

/** Page sizes of `srcDoc` at the given 0-based indices. */
function pageSizesAt(doc: PDFDocument, indices: number[]): Array<[number, number]> {
  return indices.map((i) => {
    const { width, height } = doc.getPage(i).getSize();
    return [width, height];
  });
}

/**
 * Returns the most common (mode) page size across the first `pageCount` pages
 * of `doc`. Ties break toward the earliest page (uniform docs yield page 0).
 */
export function modePageSize(doc: PDFDocument, pageCount: number): [number, number] {
  return modeOfSizes(pageSizesAt(doc, Array.from({ length: pageCount }, (_, i) => i)));
}

/**
 * Mirrors each sheet's slot assignment left↔right (front and back) for
 * right-to-left (RTL) binding — Arabic, Ottoman, manga. The gutter/creep shift
 * geometry is symmetric across the two slots, so only *which* page lands in each
 * slot changes, not the slot rectangles. Pure and test-friendly.
 */
export function mirrorMapping(sheets: SheetMapping[]): SheetMapping[] {
  return sheets.map((s) => ({
    frontLeft: s.frontRight,
    frontRight: s.frontLeft,
    backLeft: s.backRight,
    backRight: s.backLeft,
  }));
}

interface SheetLayout {
  sheetWidth: number;
  sheetHeight: number;
  gutter: number;
  creep: number;
  rotateBack: boolean;
}

/**
 * Imposes a flat sheet list into separate front/back PDFDocuments, embedding the
 * required source pages from `srcDoc`. `toSrcIndex` maps a mapping's local page
 * index to the actual `srcDoc` page index (identity for a whole document, a
 * lookup table for a padded sub-block or the cover). Shared by the book block
 * and the separate cover so both go through identical drawing code.
 */
async function imposeFrontBack(
  srcDoc: PDFDocument,
  flatSheets: Array<{ sheet: SheetMapping; sheetInSignature: number }>,
  toSrcIndex: (localIndex: number) => number,
  layout: SheetLayout,
): Promise<{ frontDoc: PDFDocument; backDoc: PDFDocument }> {
  const frontIndices: number[] = [];
  const backIndices: number[] = [];
  for (const { sheet } of flatSheets) {
    frontIndices.push(toSrcIndex(sheet.frontLeft), toSrcIndex(sheet.frontRight));
    backIndices.push(toSrcIndex(sheet.backLeft), toSrcIndex(sheet.backRight));
  }

  const frontDoc = await PDFDocument.create();
  const backDoc = await PDFDocument.create();
  const frontEmbedded = await frontDoc.embedPdf(srcDoc, frontIndices);
  const backEmbedded = await backDoc.embedPdf(srcDoc, backIndices);

  const { sheetWidth, sheetHeight, gutter, creep, rotateBack } = layout;
  for (let j = 0; j < flatSheets.length; j++) {
    const { left: leftRect, right: rightRect } = computeSlotRects(
      flatSheets[j].sheetInSignature,
      gutter,
      creep,
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

  return { frontDoc, backDoc };
}

/** Interleaves front/back sheets (front₀, back₀, front₁, …) into one PDF. */
async function combineFrontBack(frontDoc: PDFDocument, backDoc: PDFDocument): Promise<Uint8Array> {
  const S = frontDoc.getPageCount();
  const combinedDoc = await PDFDocument.create();
  const indices = Array.from({ length: S }, (_, i) => i);
  const frontPages = await combinedDoc.copyPages(frontDoc, indices);
  const backPages = await combinedDoc.copyPages(backDoc, indices);
  for (let j = 0; j < S; j++) {
    combinedDoc.addPage(frontPages[j]);
    combinedDoc.addPage(backPages[j]);
  }
  return combinedDoc.save();
}

/**
 * Performs the booklet imposition: pads the source to a multiple of 4 pages,
 * then splits it into front/back landscape sheets ready for duplex printing and
 * center folding.
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
  const binding = options.binding ?? 'ltr';
  const separateCover = options.separateCover ?? false;

  if (creepStep < 0) {
    throw new BookletError('Creep değeri negatif olamaz.');
  }
  if (flipEdge !== 'short' && flipEdge !== 'long') {
    throw new BookletError(`Geçersiz çevirme kenarı değeri: ${flipEdge}. 'short' veya 'long' olmalı.`);
  }
  if (binding !== 'ltr' && binding !== 'rtl') {
    throw new BookletError(`Geçersiz cilt yönü değeri: ${binding}. 'ltr' veya 'rtl' olmalı.`);
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

  const rotateBack = flipEdge === 'long';
  const layout: SheetLayout = {
    sheetWidth,
    sheetHeight,
    gutter: baseGutter,
    creep: creepStep,
    rotateBack,
  };

  // Build the logical page order: the original pages plus any user-requested
  // blank pages. Inserted blanks join the order BEFORE the cover split and
  // padding, so a blank can intentionally land on a chapter start or the inside
  // of a cover. Blanks take the document's mode page size, like padding.
  const insertBlankAfter = options.insertBlankAfter ?? [];
  for (const position of insertBlankAfter) {
    if (!Number.isInteger(position) || position < 0 || position > originalPageCount) {
      throw new BookletError(
        `Geçersiz boş sayfa konumu: ${position}. 0 ile ${originalPageCount} arasında tam sayı olmalı.`,
      );
    }
  }
  const blanksInserted = insertBlankAfter.length;
  const sortedInserts = [...insertBlankAfter].sort((a, b) => a - b);
  const logicalOrder: number[] = [];
  if (blanksInserted > 0) {
    const blankSize = modePageSize(srcDoc, originalPageCount);
    let insertPtr = 0;
    const emitBlanksAt = (position: number): void => {
      while (insertPtr < sortedInserts.length && sortedInserts[insertPtr] === position) {
        const blank = srcDoc.addPage(blankSize);
        blank.pushOperators();
        logicalOrder.push(srcDoc.getPageCount() - 1);
        insertPtr += 1;
      }
    };
    emitBlanksAt(0);
    for (let p = 1; p <= originalPageCount; p++) {
      logicalOrder.push(p - 1);
      emitBlanksAt(p);
    }
  } else {
    for (let i = 0; i < originalPageCount; i++) logicalOrder.push(i);
  }

  // Split off a separate cover (outer wrap) when requested: the first 2 and last
  // 2 pages of the LOGICAL order. The remaining inner pages form the "book
  // block" that is padded and imposed on their own. Without a separate cover the
  // block is the whole logical order.
  let coverIndices: number[] | null = null;
  let blockOrder: number[];
  if (separateCover) {
    if (originalPageCount < 8) {
      throw new BookletError(
        `Ayrı kapak için en az 8 sayfa gerekir (kapak + iç yaprak). Belge: ${originalPageCount} sayfa.`,
      );
    }
    const L = logicalOrder.length;
    coverIndices = [logicalOrder[0], logicalOrder[1], logicalOrder[L - 2], logicalOrder[L - 1]];
    blockOrder = logicalOrder.slice(2, L - 2);
  } else {
    blockOrder = logicalOrder.slice();
  }

  // Dynamic blank page padding so the block page count is a multiple of 4.
  // Blank pages take the block's most common (mode) page size rather than merely
  // the last page's, so a stray final page doesn't dictate the padding geometry.
  const remainder = blockOrder.length % 4;
  let paddingApplied = 0;
  if (remainder !== 0) {
    paddingApplied = 4 - remainder;
    const [padWidth, padHeight] = modeOfSizes(pageSizesAt(srcDoc, blockOrder));
    for (let i = 0; i < paddingApplied; i++) {
      const blankPage = srcDoc.addPage([padWidth, padHeight]);
      // pdf-lib only materializes a page's Contents stream once something is
      // drawn on it; embedPdf() requires Contents to exist, so force it here.
      blankPage.pushOperators();
      blockOrder.push(srcDoc.getPageCount() - 1);
    }
  }

  const N = blockOrder.length;

  // Split the block into signatures and flatten to a sheet list that remembers
  // each sheet's index WITHIN its signature (creep restarts at every signature).
  // For RTL binding, mirror each sheet's slot assignment left↔right.
  let signatures = computeSignatureMappings(N, options.signatureSize);
  if (binding === 'rtl') {
    signatures = signatures.map((signature) => mirrorMapping(signature));
  }
  const signaturesCount = signatures.length;
  const flatSheets: Array<{ sheet: SheetMapping; sheetInSignature: number }> = [];
  let maxSheetsPerSignature = 0;
  for (const signature of signatures) {
    maxSheetsPerSignature = Math.max(maxSheetsPerSignature, signature.length);
    signature.forEach((sheet, sheetInSignature) => flatSheets.push({ sheet, sheetInSignature }));
  }
  const S = flatSheets.length;

  // Guard against excessive creep, evaluated per signature: since creep restarts
  // each signature, the worst-case inward shift is on the last sheet of the
  // LARGEST signature — not the last sheet overall.
  const maxShiftInward = (maxSheetsPerSignature - 1) * creepStep - baseGutter / 2.0;
  if (maxShiftInward > wSlot / 2.0) {
    throw new BookletError(
      `Geçersiz creep değeri: ${creepStep}. Son yaprakta oluşan kayma (${maxShiftInward.toFixed(1)}pt) slot yarısını (${wSlot / 2.0}pt) aşıyor.`,
    );
  }

  // Impose the book block. `blockOrder[localIndex]` maps a mapping page index to
  // the real srcDoc page (identity for a whole document, a lookup for a cover's
  // inner block or padding pages).
  const { frontDoc, backDoc } = await imposeFrontBack(
    srcDoc,
    flatSheets,
    (localIndex) => blockOrder[localIndex],
    layout,
  );
  const frontPdf = await frontDoc.save();
  const backPdf = await backDoc.save();
  const combinedPdf = await combineFrontBack(frontDoc, backDoc);

  // Impose the cover as a single four-page sheet: front [last | first],
  // back [second | second-last]; mirrored for RTL. Creep is 0 (one sheet).
  let coverPdf: Uint8Array | undefined;
  if (coverIndices) {
    let coverSheets = computeSheetMapping(4);
    if (binding === 'rtl') {
      coverSheets = mirrorMapping(coverSheets);
    }
    const coverFlat = coverSheets.map((sheet) => ({ sheet, sheetInSignature: 0 }));
    const { frontDoc: coverFront, backDoc: coverBack } = await imposeFrontBack(
      srcDoc,
      coverFlat,
      (localIndex) => coverIndices![localIndex],
      { ...layout, creep: 0 },
    );
    coverPdf = await combineFrontBack(coverFront, coverBack);
  }

  // Optional English printing-instructions + reading-order sheet. Standalone;
  // the book PDFs above are untouched.
  let instructionsPdf: Uint8Array | undefined;
  if (options.includeInstructions) {
    const coverOffset = separateCover ? 2 : 0;
    instructionsPdf = await makeInstructionsPage({
      sheetWidth,
      sheetHeight,
      paperLabel: paperLabel(options.paperSize, sheetWidth, sheetHeight),
      totalSheets: S,
      signaturesCount,
      sheetsPerSignature: signatures.map((signature) => signature.length),
      signatureStartPages: signatureStartPages(N, options.signatureSize).map(
        (p) => p + coverOffset,
      ),
      flipEdge,
      binding,
      separateCover,
      gutter: baseGutter,
      creep: creepStep,
    });
  }

  return {
    originalPages: originalPageCount,
    paddedPages: N,
    sheetsCount: S,
    paddingApplied,
    blanksInserted,
    signaturesCount,
    frontPdf,
    backPdf,
    combinedPdf,
    coverPdf,
    instructionsPdf,
  };
}
