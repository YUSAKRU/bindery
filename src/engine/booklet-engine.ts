import {
  PDFDocument,
  clip as clip_,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib';
import type { PDFEmbeddedPage, PDFPage } from 'pdf-lib';
import { loadAndValidatePdf } from './validator';
import { BookletError } from './types';
import type { BookletOptions, BookletResult, PaperSize } from './types';
import { makeInstructionsPage } from './instructions-page';
import { runInPdfWorker } from './worker-client';

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

// Floating-point slack for geometric comparisons, in points.
const EPSILON = 1e-6;

// Assembly marks, all in points. See BookletOptions.foldGuides / collationMarks.
const FOLD_GUIDE_THICKNESS = 0.5;
const FOLD_GUIDE_DASH = 4;
const FOLD_GUIDE_GREY = 0.65;
// Total bar width, centred on the fold, so half lands on each folded half and
// the folded spine shows a full-width bar. 14pt = ~4.9mm: chosen to stay
// legible on a folded spine without being obtrusive on the printed sheet.
const COLLATION_BAR_WIDTH = 14;
// Cap on the drawn bar height. Each signature owns a band of the spine, but the
// bar only fills the middle COLLATION_BAR_MAX_HEIGHT of it: 36pt = ~12.7mm.
// Without the cap a 2-signature booklet prints a 140mm solid black stripe on
// every outer sheet, which is a lot of toner for a mark that is read as a
// position, not as an area.
const COLLATION_BAR_MAX_HEIGHT = 36;
// Head and tail of the spine left free of marks, so the staircase never runs
// into the sheet edge.
const COLLATION_SPINE_MARGIN = 24;
// Below this per-signature band height (pt), the collation bar's steps are
// hard to read at printed size even though the geometry is still valid —
// review measurements: 20 signatures band at 547 / 20 = 27.35pt on A4
// (flush, still clearly legible); the band falls under 3pt by roughly 200
// signatures, a count signatureSize 8 reaches on a real 1600+ page document
// (theses, scanned archives). 4pt sits below the legible reference and fires
// well before the sub-3pt range, without tripping on ordinary signature counts.
const COLLATION_BAR_LEGIBILITY_FLOOR = 4;

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

  const inBounds = (v: number) => Number.isFinite(v) && v >= MIN_SHEET_PT && v <= MAX_SHEET_PT;

  if (typeof paperSize === 'string') {
    if (paperSize === 'source') {
      if (!srcDoc || pageCount === undefined) {
        throw new BookletError(
          'BOOKLET_SOURCE_SHEET_NEEDS_DOC',
          undefined,
          "The 'source' paper size requires a source document.",
        );
      }
      const [modeWidth, modeHeight] = modePageSize(srcDoc, pageCount);
      const width = 2 * modeWidth;
      const height = modeHeight;
      if (!inBounds(width) || !inBounds(height)) {
        throw new BookletError(
          'BOOKLET_INVALID_SHEET_SIZE',
          { width, height, min: MIN_SHEET_PT, max: MAX_SHEET_PT },
          `Invalid paper size: ${width}×${height}pt. Both sides must be within ${MIN_SHEET_PT}–${MAX_SHEET_PT}pt.`,
        );
      }
      return [width, height];
    }
    const preset = SHEET_PRESETS[paperSize];
    if (!preset) {
      throw new BookletError('BOOKLET_UNKNOWN_PAPER_PRESET', { paperSize }, `Invalid paper size: ${paperSize}.`);
    }
    return [preset[0], preset[1]];
  }

  const { width, height } = paperSize;
  if (!inBounds(width) || !inBounds(height)) {
    throw new BookletError(
      'BOOKLET_INVALID_SHEET_SIZE',
      { width, height, min: MIN_SHEET_PT, max: MAX_SHEET_PT },
      `Invalid paper size: ${width}×${height}pt. Both sides must be within ${MIN_SHEET_PT}–${MAX_SHEET_PT}pt.`,
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
 * Computes the left/right content rectangles for one booklet sheet.
 *
 * Each half of the sheet holds one page. The gutter is taken out of the
 * half's width on the fold side, so a page shrinks to make room for it rather
 * than being pushed off the outer edge of the sheet. Creep then translates the
 * rectangle toward the fold by `sheetIndex * creep`. Past the gutter, creep
 * carries the rectangle across the fold line; the page is clipped to its own
 * half there (see {@link computeClipRects}), so it never overprints the
 * facing page.
 *
 * `sheetIndex` is the 0-based sheet number within its signature, `gutter` the
 * total binding gutter and `creep` the per-sheet creep step (all in points).
 * `sheetWidth`/`sheetHeight` default to A4 landscape.
 */
export function computeSlotRects(
  sheetIndex: number,
  gutter: number,
  creep: number,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): { left: FitRect; right: FitRect } {
  const half = sheetWidth / 2.0;
  const width = half - gutter / 2.0;
  const creepShift = sheetIndex * creep;

  const left: FitRect = { x: creepShift, y: 0, width, height: sheetHeight };
  const right: FitRect = { x: half + gutter / 2.0 - creepShift, y: 0, width, height: sheetHeight };
  return { left, right };
}

/**
 * The half of the sheet each page may paint in. A page is clipped to its half
 * only when its content rectangle actually leaves it, i.e. when creep has
 * carried it past the fold.
 */
export function computeClipRects(
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): { left: FitRect; right: FitRect } {
  const half = sheetWidth / 2.0;
  return {
    left: { x: 0, y: 0, width: half, height: sheetHeight },
    right: { x: half, y: 0, width: half, height: sheetHeight },
  };
}

/** A page box in the page's own user space, as pdf-lib's embedPages takes it. */
export interface PageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/**
 * What the imposition needs to know about one source page: the box to embed,
 * the page's /Rotate, and the size the page is DISPLAYED at once that rotation
 * is applied.
 */
export interface PageGeometry {
  box: PageBox;
  rotation: 0 | 90 | 180 | 270;
  /** Displayed width, after /Rotate. */
  width: number;
  /** Displayed height, after /Rotate. */
  height: number;
  /** True when the embedded box is smaller than the MediaBox (TrimBox or CropBox in use). */
  trimmed: boolean;
}

function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const quarter = Math.round(angle / 90);
  return ((((quarter % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
}

/**
 * Resolves the box and rotation a page is imposed with.
 *
 * The box is the TrimBox, which pdf-lib falls back to the CropBox and then
 * the MediaBox when absent, clipped to the MediaBox (ISO 32000-1 §14.11.2).
 * Print-ready PDF/X files carry bleed and printer's marks outside the TrimBox;
 * embedding the MediaBox would shrink the page to fit them and print the marks
 * inside the booklet. A box that does not overlap the MediaBox falls back to
 * the MediaBox.
 *
 * /Rotate (ISO 32000-1 Table 30) is not applied by pdf-lib's embedPages, so it
 * is carried here and applied when the page is drawn.
 */
export function pageGeometry(page: PDFPage): PageGeometry {
  const media = page.getMediaBox();
  const trim = page.getTrimBox();
  const mediaBox: PageBox = {
    left: media.x,
    bottom: media.y,
    right: media.x + media.width,
    top: media.y + media.height,
  };
  const clipped: PageBox = {
    left: Math.max(mediaBox.left, Math.min(trim.x, trim.x + trim.width)),
    bottom: Math.max(mediaBox.bottom, Math.min(trim.y, trim.y + trim.height)),
    right: Math.min(mediaBox.right, Math.max(trim.x, trim.x + trim.width)),
    top: Math.min(mediaBox.top, Math.max(trim.y, trim.y + trim.height)),
  };
  const usable = clipped.right - clipped.left >= 1 && clipped.top - clipped.bottom >= 1;
  const box = usable ? clipped : mediaBox;
  const trimmed =
    usable &&
    (Math.abs(box.left - mediaBox.left) > SIZE_TOLERANCE ||
      Math.abs(box.bottom - mediaBox.bottom) > SIZE_TOLERANCE ||
      Math.abs(box.right - mediaBox.right) > SIZE_TOLERANCE ||
      Math.abs(box.top - mediaBox.top) > SIZE_TOLERANCE);

  const rotation = normalizeRotation(page.getRotation().angle);
  const boxWidth = box.right - box.left;
  const boxHeight = box.top - box.bottom;
  const sideways = rotation === 90 || rotation === 270;
  return {
    box,
    rotation,
    width: sideways ? boxHeight : boxWidth,
    height: sideways ? boxWidth : boxHeight,
    trimmed,
  };
}

/**
 * Where drawPage must put the embedded page's origin, and at what angle, so a
 * page with display rotation `rotation` fills the displayed rectangle at
 * (x, y) of size `drawnWidth` x `drawnHeight`.
 *
 * pdf-lib rotates counter-clockwise about the origin it is given, while /Rotate
 * turns the page clockwise, so the content is drawn at `-rotation` and the
 * origin moved to the corner the rotation swings the box away from:
 *   0   -> (x, y)
 *   90  -> (x, y + drawnHeight)
 *   180 -> (x + drawnWidth, y + drawnHeight)
 *   270 -> (x + drawnWidth, y)
 */
export function rotatedPlacement(
  rotation: 0 | 90 | 180 | 270,
  x: number,
  y: number,
  drawnWidth: number,
  drawnHeight: number,
): { x: number; y: number; angle: number } {
  switch (rotation) {
    case 90:
      return { x, y: y + drawnHeight, angle: -90 };
    case 180:
      return { x: x + drawnWidth, y: y + drawnHeight, angle: -180 };
    case 270:
      return { x: x + drawnWidth, y, angle: -270 };
    default:
      return { x, y, angle: 0 };
  }
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
 * displayed aspect ratio (after /Rotate), centering it within the rect —
 * mirrors PyMuPDF's `show_pdf_page(rect, ..., keep_proportion=True)` behaviour.
 *
 * When the rect leaves `clip`, the page is drawn inside a clipping path so it
 * cannot paint past the fold (`q x y w h re W n ... Q`).
 *
 * `rotate180` turns the whole composition 180° about the sheet centre for
 * long-edge duplex: the displayed rectangle and the clip are point-reflected
 * through the centre, and the page's own rotation gains a half turn.
 */
function drawFitted(
  page: PDFPage,
  embedded: PDFEmbeddedPage,
  geometry: Pick<PageGeometry, 'rotation' | 'width' | 'height'>,
  rect: FitRect,
  clip: FitRect,
  rotate180 = false,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): void {
  const scale = Math.min(rect.width / geometry.width, rect.height / geometry.height);
  const drawnWidth = geometry.width * scale;
  const drawnHeight = geometry.height * scale;
  let x = rect.x + (rect.width - drawnWidth) / 2;
  let y = rect.y + (rect.height - drawnHeight) / 2;
  let clipRect = clip;
  let rotation = geometry.rotation;

  const needsClip =
    rect.x < clip.x - EPSILON ||
    rect.x + rect.width > clip.x + clip.width + EPSILON ||
    rect.y < clip.y - EPSILON ||
    rect.y + rect.height > clip.y + clip.height + EPSILON;

  if (rotate180) {
    x = sheetWidth - x - drawnWidth;
    y = sheetHeight - y - drawnHeight;
    clipRect = {
      x: sheetWidth - clip.x - clip.width,
      y: sheetHeight - clip.y - clip.height,
      width: clip.width,
      height: clip.height,
    };
    rotation = normalizeRotation(rotation + 180);
  }

  // Verified against the emitted content-stream matrix in booklet-engine.test.ts
  // (not assumed): rotation 180 lands the origin on the point-reflected
  // top-right corner, the historical long-edge placement.
  const placement = rotatedPlacement(rotation, x, y, drawnWidth, drawnHeight);

  if (needsClip) {
    page.pushOperators(
      pushGraphicsState(),
      rectangle(clipRect.x, clipRect.y, clipRect.width, clipRect.height),
      clip_(),
      endPath(),
    );
  }
  page.drawPage(embedded, {
    x: placement.x,
    y: placement.y,
    width: embedded.width * scale,
    height: embedded.height * scale,
    ...(placement.angle !== 0 ? { rotate: degrees(placement.angle) } : {}),
  });
  if (needsClip) {
    page.pushOperators(popGraphicsState());
  }
}

/** A rectangle on the imposed sheet, in PDF points from the bottom-left. */
export interface MarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle of the collation (backstep) bar for signature `signatureIndex`
 * (0-based) of `signaturesCount`, straddling the sheet's fold line.
 *
 * The spine is divided into one band per signature, top to bottom, and the bar
 * sits centred in its own band. Band assignment is what makes the mark work: a
 * gathered stack shows the bars stepping down one band at a time, so a missing,
 * doubled or out-of-order signature breaks the staircase. The bar itself is a
 * fixed {@link COLLATION_BAR_MAX_HEIGHT} tall rather than the full band — it is
 * read as a POSITION on the spine, not as an area, so filling the band buys no
 * extra signal and costs a great deal of toner at low signature counts. When
 * there are enough signatures that a band is shorter than the cap, the bar
 * shrinks to its band and the steps stay flush.
 *
 * Independent of gutter and creep: those shift the drawn CONTENT inward, never
 * the fold line itself, which stays at `sheetWidth / 2` on every sheet.
 */
export function computeCollationMarkRect(
  signatureIndex: number,
  signaturesCount: number,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): MarkRect {
  const bands = Math.max(1, signaturesCount);
  const usable = Math.max(0, sheetHeight - 2 * COLLATION_SPINE_MARGIN);
  const band = usable / bands;
  const height = Math.min(band, COLLATION_BAR_MAX_HEIGHT);
  const bandBottom = sheetHeight - COLLATION_SPINE_MARGIN - (signatureIndex + 1) * band;
  return {
    x: sheetWidth / 2 - COLLATION_BAR_WIDTH / 2,
    y: bandBottom + (band - height) / 2,
    width: COLLATION_BAR_WIDTH,
    height,
  };
}

/**
 * True when this sheet's creep/gutter shift (see {@link computeSlotRects}) has
 * pushed its content slot past the fold line at `sheetWidth / 2` — drawing the
 * guide there would print the dashed line over imposed content instead of in
 * the margin. Checked against the SLOT bound, not drawFitted's actual scaled
 * edge, which is always <= the slot: that makes this the conservative
 * direction, so it can suppress the guide where a differently proportioned
 * page would in fact have left a sliver of clear margin, but never draws the
 * guide over content it doesn't know is there.
 */
export function foldGuideCrossesContent(
  sheetInSignature: number,
  gutter: number,
  creep: number,
  sheetWidth: number = TARGET_WIDTH,
  sheetHeight: number = TARGET_HEIGHT,
): boolean {
  const { left } = computeSlotRects(sheetInSignature, gutter, creep, sheetWidth, sheetHeight);
  return left.x + left.width > sheetWidth / 2;
}

/** Dashed guide down the fold line, drawn over the imposed content. */
function drawFoldGuide(page: PDFPage, sheetWidth: number, sheetHeight: number): void {
  page.drawLine({
    start: { x: sheetWidth / 2, y: 0 },
    end: { x: sheetWidth / 2, y: sheetHeight },
    thickness: FOLD_GUIDE_THICKNESS,
    color: rgb(FOLD_GUIDE_GREY, FOLD_GUIDE_GREY, FOLD_GUIDE_GREY),
    dashArray: [FOLD_GUIDE_DASH, FOLD_GUIDE_DASH],
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
    throw new BookletError(
      'BOOKLET_INVALID_SIGNATURE_SIZE',
      { signatureSize },
      `Invalid signature size: ${signatureSize}. Must be a positive multiple of 4.`,
    );
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
 * The number of signatures is `ceil(N / signatureSize)`, same as naive fixed-size
 * chunking, but the `N` pages are then balanced as evenly as possible across that
 * many signatures (each still a multiple of 4) instead of dumping the whole
 * remainder into the last one — e.g. 56 pages at signatureSize 16 gives
 * 16/16/12/12 rather than 16/16/16/8, avoiding a single thin "runt" signature.
 * Every signature is imposed with the same saddle-stitch arithmetic as a
 * standalone booklet ({@link computeSheetMapping}) over its own page range, then
 * offset by the signature's start index.
 */
export function computeSignatureMappings(
  N: number,
  signatureSize?: number | 'auto',
): SheetMapping[][] {
  const sigLen = resolveSignatureSize(N, signatureSize);
  const totalSheets = N / 4;
  if (totalSheets === 0) {
    return [];
  }
  const sigLenSheets = sigLen / 4;
  const numSignatures = Math.ceil(totalSheets / sigLenSheets);
  const baseSheets = Math.floor(totalSheets / numSignatures);
  // The first `extraSheetCount` signatures absorb one extra sheet (4 pages)
  // each so the total still sums to `totalSheets`.
  const extraSheetCount = totalSheets % numSignatures;

  const signatures: SheetMapping[][] = [];
  let start = 0;
  for (let i = 0; i < numSignatures; i++) {
    const len = (baseSheets + (i < extraSheetCount ? 1 : 0)) * 4;
    const sheets = computeSheetMapping(len).map((s) => ({
      frontLeft: s.frontLeft + start,
      frontRight: s.frontRight + start,
      backLeft: s.backLeft + start,
      backRight: s.backRight + start,
    }));
    signatures.push(sheets);
    start += len;
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

/**
 * Displayed sizes of `srcDoc`'s pages at the given 0-based indices: the
 * imposed box (TrimBox, falling back to CropBox/MediaBox) with /Rotate applied.
 */
function pageSizesAt(doc: PDFDocument, indices: number[]): Array<[number, number]> {
  return indices.map((i) => {
    const { width, height } = pageGeometry(doc.getPage(i));
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

/**
 * One imposed sheet: its page mapping, its physical nesting depth inside its
 * signature (0 = outermost fold, drives creep) and which signature it belongs
 * to (drives the collation mark). All three are independent of EMISSION order,
 * so `reverseSheetOrder` cannot disturb them.
 *
 * `sheetInSignature` and `signatureIndex` are only meaningful once blank-page
 * padding and `insertBlankAfter` have already been folded into `blockOrder` —
 * both must run before `N` and {@link computeSignatureMappings} are computed,
 * so a page inserted mid-document shifts signature boundaries before this
 * list is built rather than after. Nothing enforces that ordering beyond the
 * makeBooklet function body doing it in this sequence.
 */
interface FlatSheet {
  sheet: SheetMapping;
  sheetInSignature: number;
  signatureIndex: number;
}

/** Assembly marks to overlay, already resolved from the raw options. */
interface SheetMarks {
  foldGuides: boolean;
  /** Already false when there is only one signature — nothing to gather. */
  collation: boolean;
  signaturesCount: number;
}

interface SheetLayout {
  sheetWidth: number;
  sheetHeight: number;
  gutter: number;
  creep: number;
  rotateBack: boolean;
}

/**
 * Imposes a flat sheet list into one PDFDocument whose pages alternate front,
 * back, front, back… and returns its serialized bytes plus the front-only and
 * back-only PDFs derived from it (skipped when `withSides` is false).
 *
 * Every source page is embedded through ONE embedPdf call, so pdf-lib copies
 * each shared resource (a font, a background image used on every page) into
 * the output once. The front/back PDFs are then taken with copyPages, again
 * one copier each, so each output file carries every resource exactly once.
 *
 * `toSrcIndex` maps a mapping's local page index to a `srcDoc` page index, or
 * to `null` for a blank slot (an inserted blank or mod-4 padding), which is
 * simply left empty. Shared by the book block and the separate cover so both
 * go through identical drawing code.
 */
async function imposeSheets(
  srcDoc: PDFDocument,
  flatSheets: FlatSheet[],
  toSrcIndex: (localIndex: number) => number | null,
  layout: SheetLayout,
  marks: SheetMarks,
  withSides = true,
): Promise<{ frontPdf?: Uint8Array; backPdf?: Uint8Array; combinedPdf: Uint8Array }> {
  const slots: Array<number | null> = [];
  for (const { sheet } of flatSheets) {
    slots.push(
      toSrcIndex(sheet.frontLeft),
      toSrcIndex(sheet.frontRight),
      toSrcIndex(sheet.backLeft),
      toSrcIndex(sheet.backRight),
    );
  }

  const srcPages = srcDoc.getPages();
  const used = [...new Set(slots.filter((i): i is number => i !== null))];
  const geometries = new Map(used.map((i) => [i, pageGeometry(srcPages[i])]));

  const combined = await PDFDocument.create();
  const embeddedList = await combined.embedPages(
    used.map((i) => srcPages[i]),
    used.map((i) => geometries.get(i)!.box),
  );
  const embedded = new Map(used.map((i, k) => [i, embeddedList[k]]));

  const { sheetWidth, sheetHeight, gutter, creep, rotateBack } = layout;
  const clips = computeClipRects(sheetWidth, sheetHeight);
  const draw = (page: PDFPage, srcIndex: number | null, rect: FitRect, clip: FitRect, rotate180: boolean) => {
    if (srcIndex === null) return;
    drawFitted(page, embedded.get(srcIndex)!, geometries.get(srcIndex)!, rect, clip, rotate180, sheetWidth, sheetHeight);
  };

  for (let j = 0; j < flatSheets.length; j++) {
    const { sheetInSignature, signatureIndex } = flatSheets[j];
    const { left: leftRect, right: rightRect } = computeSlotRects(
      sheetInSignature,
      gutter,
      creep,
      sheetWidth,
      sheetHeight,
    );
    const [frontLeft, frontRight, backLeft, backRight] = slots.slice(4 * j, 4 * j + 4);

    const frontPage = combined.addPage([sheetWidth, sheetHeight]);
    draw(frontPage, frontLeft, leftRect, clips.left, false);
    draw(frontPage, frontRight, rightRect, clips.right, false);

    const backPage = combined.addPage([sheetWidth, sheetHeight]);
    draw(backPage, backLeft, leftRect, clips.left, rotateBack);
    draw(backPage, backRight, rightRect, clips.right, rotateBack);

    // A sheet whose creep has carried content past the fold skips the guide
    // rather than draw it over that content (see foldGuideCrossesContent).
    if (
      marks.foldGuides &&
      !foldGuideCrossesContent(sheetInSignature, gutter, creep, sheetWidth, sheetHeight)
    ) {
      drawFoldGuide(frontPage, sheetWidth, sheetHeight);
      drawFoldGuide(backPage, sheetWidth, sheetHeight);
    }
    // Collation bar: outermost sheet of each signature, front side only.
    if (marks.collation && sheetInSignature === 0) {
      const bar = computeCollationMarkRect(signatureIndex, marks.signaturesCount, sheetWidth, sheetHeight);
      frontPage.drawRectangle({ ...bar, color: rgb(0, 0, 0) });
    }
  }

  const S = flatSheets.length;
  const frontIndices = Array.from({ length: S }, (_, j) => 2 * j);
  const backIndices = Array.from({ length: S }, (_, j) => 2 * j + 1);
  const combinedPdf = await combined.save();
  if (!withSides) return { combinedPdf };
  const frontPdf = await saveSubset(combined, frontIndices);
  const backPdf = await saveSubset(combined, backIndices);
  return { frontPdf, backPdf, combinedPdf };
}

/** Serializes the given pages of `doc` as a new PDF, through one object copier. */
async function saveSubset(doc: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, indices);
  for (const page of pages) out.addPage(page);
  return out.save();
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
export async function makeBookletCore(
  inputBytes: Uint8Array,
  options: BookletOptions = {},
): Promise<BookletResult> {
  const baseGutter = options.gutter ?? 0;
  const creepStep = options.creep ?? 0;
  const flipEdge = options.flipEdge ?? 'short';
  const binding = options.binding ?? 'ltr';
  const separateCover = options.separateCover ?? false;
  const reverseSheetOrder = options.reverseSheetOrder ?? false;
  const foldGuides = options.foldGuides ?? false;
  const collationMarks = options.collationMarks ?? false;

  if (creepStep < 0) {
    throw new BookletError('BOOKLET_NEGATIVE_CREEP', undefined, 'Creep value cannot be negative.');
  }
  if (flipEdge !== 'short' && flipEdge !== 'long') {
    throw new BookletError(
      'BOOKLET_INVALID_FLIP_EDGE',
      { flipEdge },
      `Invalid flip edge value: ${flipEdge}. Must be 'short' or 'long'.`,
    );
  }
  if (binding !== 'ltr' && binding !== 'rtl') {
    throw new BookletError(
      'BOOKLET_INVALID_BINDING',
      { binding },
      `Invalid binding value: ${binding}. Must be 'ltr' or 'rtl'.`,
    );
  }

  const { doc: srcDoc, metadata: { pageCount: originalPageCount } } = await loadAndValidatePdf(inputBytes);

  // Resolve the physical sheet size; every slot/shift below is derived from it
  // rather than the fixed A4 constants. 'source' needs the pre-padding pages.
  const [sheetWidth, sheetHeight] = resolveSheetSize(options.paperSize, srcDoc, originalPageCount);
  const wSlot = sheetWidth / 2.0;

  if (baseGutter < 0 || baseGutter >= wSlot) {
    throw new BookletError(
      'BOOKLET_INVALID_GUTTER',
      { gutter: baseGutter, max: wSlot },
      `Invalid gutter value: ${baseGutter}. Must be between 0 and ${wSlot}.`,
    );
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
        'BOOKLET_INVALID_BLANK_POSITION',
        { position, max: originalPageCount },
        `Invalid blank page position: ${position}. Must be an integer between 0 and ${originalPageCount}.`,
      );
    }
  }
  const blanksInserted = insertBlankAfter.length;
  const sortedInserts = [...insertBlankAfter].sort((a, b) => a - b);
  // `null` marks a blank slot. Blanks are never added to srcDoc: a slot with
  // nothing to draw needs no page, and leaving srcDoc unmodified keeps the
  // parsed source reusable.
  const logicalOrder: Array<number | null> = [];
  if (blanksInserted > 0) {
    let insertPtr = 0;
    const emitBlanksAt = (position: number): void => {
      while (insertPtr < sortedInserts.length && sortedInserts[insertPtr] === position) {
        logicalOrder.push(null);
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
  let coverIndices: Array<number | null> | null = null;
  let blockOrder: Array<number | null>;
  if (separateCover) {
    if (originalPageCount < 8) {
      throw new BookletError(
        'BOOKLET_COVER_MIN_PAGES',
        { pageCount: originalPageCount },
        `A separate cover requires at least 8 pages (cover + inner block). Document: ${originalPageCount} pages.`,
      );
    }
    const L = logicalOrder.length;
    coverIndices = [logicalOrder[0], logicalOrder[1], logicalOrder[L - 2], logicalOrder[L - 1]];
    blockOrder = logicalOrder.slice(2, L - 2);
  } else {
    blockOrder = logicalOrder.slice();
  }

  // Blank padding so the block page count is a multiple of 4, as blank slots.
  const remainder = blockOrder.length % 4;
  let paddingApplied = 0;
  if (remainder !== 0) {
    paddingApplied = 4 - remainder;
    for (let i = 0; i < paddingApplied; i++) blockOrder.push(null);
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
  const flatSheets: FlatSheet[] = [];
  let maxSheetsPerSignature = 0;
  for (let signatureIndex = 0; signatureIndex < signatures.length; signatureIndex++) {
    const signature = signatures[signatureIndex];
    maxSheetsPerSignature = Math.max(maxSheetsPerSignature, signature.length);
    // sheetInSignature is the sheet's physical nesting depth (0 = outermost
    // fold), which drives creep below — that stays tied to each sheet's
    // ORIGINAL position regardless of emission order. reverseSheetOrder only
    // reverses the EMISSION order within this signature (for auto-folding
    // printers that nest a signature backwards); signatures themselves stay
    // in their original order — see BookletOptions.reverseSheetOrder.
    const entries = signature.map((sheet, sheetInSignature) => ({
      sheet,
      sheetInSignature,
      signatureIndex,
    }));
    if (reverseSheetOrder) entries.reverse();
    flatSheets.push(...entries);
  }
  const S = flatSheets.length;

  // A collation bar exists to catch a gathering mistake; with a single
  // signature there is nothing to gather, so the request is dropped rather
  // than printing a mark that can never be wrong.
  const marks: SheetMarks = {
    foldGuides,
    collation: collationMarks && signaturesCount > 1,
    signaturesCount,
  };

  // Same band formula as computeCollationMarkRect, evaluated once for the
  // whole document rather than per signature — the band is identical for
  // every signature, and only its magnitude (not the per-bar geometry)
  // matters for the legibility note.
  const collationBand =
    Math.max(0, sheetHeight - 2 * COLLATION_SPINE_MARGIN) / Math.max(1, signaturesCount);
  const collationLegibilityWarning = marks.collation && collationBand < COLLATION_BAR_LEGIBILITY_FLOOR;

  // Guard against excessive creep, evaluated per signature: since creep restarts
  // each signature, the worst-case inward shift is on the last sheet of the
  // LARGEST signature — not the last sheet overall.
  const maxShiftInward = (maxSheetsPerSignature - 1) * creepStep - baseGutter / 2.0;
  if (maxShiftInward > wSlot / 2.0) {
    const shift = maxShiftInward.toFixed(1);
    const maxShift = wSlot / 2.0;
    throw new BookletError(
      'BOOKLET_EXCESSIVE_CREEP',
      { creep: creepStep, shift, maxShift },
      `Invalid creep value: ${creepStep}. The resulting shift on the last leaf (${shift}pt) exceeds half the slot width (${maxShift}pt).`,
    );
  }

  // Impose the book block. `blockOrder[localIndex]` maps a mapping page index to
  // the real srcDoc page (identity for a whole document, a lookup for a cover's
  // inner block), or null for a blank slot.
  const block = await imposeSheets(
    srcDoc,
    flatSheets,
    (localIndex) => blockOrder[localIndex],
    layout,
    marks,
  );

  // Impose the cover as a single four-page sheet: front [last | first],
  // back [second | second-last]; mirrored for RTL. Creep is 0 (one sheet).
  let coverPdf: Uint8Array | undefined;
  if (coverIndices) {
    let coverSheets = computeSheetMapping(4);
    if (binding === 'rtl') {
      coverSheets = mirrorMapping(coverSheets);
    }
    const coverFlat = coverSheets.map((sheet) => ({
      sheet,
      sheetInSignature: 0,
      signatureIndex: 0,
    }));
    // The cover is one wrap-around sheet, not a signature in the gathered
    // stack, so it takes the fold guide but never a collation bar.
    const cover = await imposeSheets(
      srcDoc,
      coverFlat,
      (localIndex) => coverIndices![localIndex],
      { ...layout, creep: 0 },
      { foldGuides, collation: false, signaturesCount: 1 },
      false,
    );
    coverPdf = cover.combinedPdf;
  }

  // Optional printing-instructions + reading-order sheet, in the app's current
  // language. Standalone;
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
      reverseSheetOrder,
      blanksInserted,
      paddingApplied,
      foldGuides,
      // The EFFECTIVE value, so the sheet never describes a bar that was
      // suppressed for a single-signature booklet.
      collationMarks: marks.collation,
      collationLegibilityWarning,
    });
  }

  return {
    originalPages: originalPageCount,
    paddedPages: N,
    sheetsCount: S,
    paddingApplied,
    blanksInserted,
    signaturesCount,
    frontPdf: block.frontPdf!,
    backPdf: block.backPdf!,
    combinedPdf: block.combinedPdf,
    coverPdf,
    instructionsPdf,
  };
}

export async function makeBooklet(
  inputBytes: Uint8Array,
  options: BookletOptions = {},
): Promise<BookletResult> {
  return runInPdfWorker(
    'makeBooklet',
    { pdfBytes: inputBytes, options },
    () => makeBookletCore(inputBytes, options),
  );
}

