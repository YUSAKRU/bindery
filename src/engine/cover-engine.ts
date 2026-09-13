import { PDFDocument, degrees, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import notoSansUrl from '../assets/fonts/NotoSans-Latin.ttf?url';
import notoSansBoldUrl from '../assets/fonts/NotoSans-Latin-Bold.ttf?url';
import { computeCenteredRotatedPosition } from './watermark-engine';
import { BookletError } from './types';

export type BindingType = 'sewn' | 'perfect' | 'saddle';
export type PaperGsm = 70 | 80 | 90 | 100 | 120;

export const PAPER_CALIPERS_MM: Record<PaperGsm, number> = {
  70: 0.090, 80: 0.100, 90: 0.115, 100: 0.130, 120: 0.155,
};
export const THREAD_SWELL_PER_SIG_MM = 0.15;
export const MM_TO_PT = 72 / 25.4;

/** Below this, spine text is illegible and should be suppressed entirely (same philosophy as booklet-engine's COLLATION_BAR_LEGIBILITY_FLOOR). */
const SPINE_TEXT_LEGIBILITY_FLOOR_MM = 3.5;

/** mm added for a case-bound (board) cover's hinge/groove, independent of bindingType. */
const BOARD_HINGE_ALLOWANCE_MM = 7;
/** mm added for a soft-cover fold/score line on a sewn book block. */
const SEWN_HINGE_ALLOWANCE_MM = 1.0;
/** mm added for the glued edge of a perfect-bound book block. */
const PERFECT_HINGE_ALLOWANCE_MM = 1.5;
/** Saddle-stitched covers share the same fold as the text block, so no extra allowance. */
const SADDLE_HINGE_ALLOWANCE_MM = 0;

export interface SpineCalculationInput {
  sheetCount: number;
  signatureCount: number;
  paperGsm: PaperGsm;
  bindingType: BindingType;
  boardThicknessMm?: number;
}
export interface SpineCalculationResult {
  textBlockThicknessMm: number;
  threadSwellMm: number;
  hingeAllowanceMm: number;
  totalSpineWidthMm: number;
  totalSpineWidthPt: number;
  canPrintSpineText: boolean;
}
/**
 * How the wrap is cut up across printed sheets.
 *
 * `single` is the classic one-piece wrap (back + spine + front on one wide
 * sheet). For an A5 book that sheet is at least 148.5 + spine + 148.5 mm wide,
 * which no A4 home printer can feed, so it needs A3 or a copy shop.
 *
 * `split` cuts the same wrap into two A4-feedable sheets that overlap at the
 * spine: sheet 1 carries back + spine + a lap flap, sheet 2 carries the front
 * cover + a glue tab that is bonded underneath that flap. The overlap is not a
 * compromise — it doubles the material over the spine, which is exactly where a
 * home-bound book fails first.
 */
export type CoverFormat = 'single' | 'split' | 'a4-direct';

/** Width of sheet 1's lap flap: the tongue that reaches past the spine and over sheet 2's glue tab. */
export const LAP_FLAP_WIDTH_MM = 20;
/** Width of sheet 2's glue tab: the strip on its spine edge that is bonded under sheet 1's lap flap. */
export const GLUE_TAB_WIDTH_MM = 10;
/** Long edge of A4 (mm) — the widest sheet a home printer can feed, landscape. */
export const A4_LONG_EDGE_MM = 297;
/** Short edge of A4 (mm). With A4_LONG_EDGE_MM, the portrait sheet a home printer actually feeds. */
export const A4_SHORT_EDGE_MM = 210;

export interface CoverRect { x: number; y: number; width: number; height: number }

export interface CoverDimensionsInput {
  pageWidthPt: number; pageHeightPt: number; spineWidthPt: number;
  bleedPt?: number; wrapMarginPt?: number;
  format?: CoverFormat;
}
export interface CoverDimensionsResult {
  format: 'single';
  totalWidthPt: number; totalHeightPt: number;
  backCoverRect: CoverRect;
  spineRect: CoverRect;
  frontCoverRect: CoverRect;
}

export interface A4DirectCoverDimensionsResult {
  format: 'a4-direct';
  totalWidthPt: number;
  totalHeightPt: number;
  backCoverRect: CoverRect;
  spineRect: CoverRect;
  frontCoverRect: CoverRect;
  sheetWidthPt: number;  // 297 mm in points
  sheetHeightPt: number; // 210 mm in points
  fitsSheet: boolean;
}

export interface SplitCoverDimensionsInput extends CoverDimensionsInput {
  lapFlapPt?: number;
  glueTabPt?: number;
}
/** One printed sheet of a split cover, plus the x positions of its dashed crease guides. */
export interface CoverSheetLayout {
  widthPt: number;
  heightPt: number;
  /** x offsets of the fold/crease guides on this sheet, left to right. */
  foldLinesX: number[];
}
export interface SplitCoverSheet1 extends CoverSheetLayout {
  backCoverRect: CoverRect;
  spineRect: CoverRect;
  lapFlapRect: CoverRect;
}
export interface SplitCoverSheet2 extends CoverSheetLayout {
  glueTabRect: CoverRect;
  frontCoverRect: CoverRect;
}
export interface SplitCoverDimensionsResult {
  format: 'split';
  totalHeightPt: number;
  sheet1: SplitCoverSheet1;
  sheet2: SplitCoverSheet2;
}
export type AnyCoverDimensions =
  | CoverDimensionsResult
  | SplitCoverDimensionsResult
  | A4DirectCoverDimensionsResult;
export type CoverTheme = 'cream' | 'white' | 'navy' | 'burgundy' | 'charcoal';

export interface ThemeColors {
  backgroundRgb: [number, number, number];
  textRgb: [number, number, number];
}

/** Mirrors the swatch hex values in index.html / app.ts's themeConfigs, converted to 0..1 RGB for pdf-lib. */
export const COVER_THEMES: Record<CoverTheme, ThemeColors> = {
  cream: { backgroundRgb: [0.984, 0.973, 0.949], textRgb: [0.161, 0.145, 0.141] },
  white: { backgroundRgb: [1, 1, 1], textRgb: [0.059, 0.090, 0.165] },
  navy: { backgroundRgb: [0.059, 0.090, 0.165], textRgb: [0.973, 0.980, 0.988] },
  burgundy: { backgroundRgb: [0.271, 0.039, 0.039], textRgb: [0.996, 0.949, 0.949] },
  charcoal: { backgroundRgb: [0.118, 0.161, 0.231], textRgb: [0.973, 0.980, 0.988] },
};

const DEFAULT_COVER_THEME: CoverTheme = 'cream';

export interface CoverContentInput {
  title: string; author?: string; synopsis?: string; coverImageBytes?: Uint8Array; theme?: CoverTheme;
}
export interface GenerateCoverOptions {
  dimensions: AnyCoverDimensions;
  content: CoverContentInput;
  spineResult: SpineCalculationResult;
  /** Optional assertion of the intended format; must match `dimensions.format`. */
  format?: CoverFormat;
}

const DEFAULT_BLEED_PT = 9;
const DEFAULT_WRAP_MARGIN_PT = 0;

export function computeSpineWidth(input: SpineCalculationInput): SpineCalculationResult {
  const { sheetCount, signatureCount, paperGsm, bindingType, boardThicknessMm } = input;

  if (sheetCount <= 0) {
    throw new BookletError(
      'COVER_INVALID_SHEET_COUNT',
      { sheetCount },
      `Sheet count must be positive, got ${sheetCount}.`,
    );
  }
  if (signatureCount <= 0) {
    throw new BookletError(
      'COVER_INVALID_SIGNATURE_COUNT',
      { signatureCount },
      `Signature count must be positive, got ${signatureCount}.`,
    );
  }

  const textBlockThicknessMm = sheetCount * PAPER_CALIPERS_MM[paperGsm];

  // Thread swell only accumulates when signatures are gathered and sewn together;
  // saddle-stitching shares the text block's own fold (no separate stitching), and
  // perfect binding glues rather than sews, so neither has a swell to account for.
  const threadSwellMm = bindingType === 'sewn' ? signatureCount * THREAD_SWELL_PER_SIG_MM : 0;

  let hingeAllowanceMm: number;
  if (boardThicknessMm !== undefined) {
    // Case-bound (board) covers need groove/hinge clearance regardless of how the
    // text block itself is bound, so this overrides the bindingType-based default.
    hingeAllowanceMm = 2 * boardThicknessMm + BOARD_HINGE_ALLOWANCE_MM;
  } else if (bindingType === 'saddle') {
    hingeAllowanceMm = SADDLE_HINGE_ALLOWANCE_MM;
  } else if (bindingType === 'sewn') {
    hingeAllowanceMm = SEWN_HINGE_ALLOWANCE_MM;
  } else {
    hingeAllowanceMm = PERFECT_HINGE_ALLOWANCE_MM;
  }

  const totalSpineWidthMm = textBlockThicknessMm + threadSwellMm + hingeAllowanceMm;
  const totalSpineWidthPt = totalSpineWidthMm * MM_TO_PT;
  const canPrintSpineText = totalSpineWidthMm >= SPINE_TEXT_LEGIBILITY_FLOOR_MM;

  return { textBlockThicknessMm, threadSwellMm, hingeAllowanceMm, totalSpineWidthMm, totalSpineWidthPt, canPrintSpineText };
}

/**
 * Geometry for a one-sheet wrap printed directly on a single A4 landscape sheet (297 x 210 mm).
 *
 * For smaller books (e.g. saddle-stitched A5 or trimmed booklets), the full wrap
 * (back + spine + front) fits across 297 mm without needing A3 paper or a split overlap.
 * The artwork is centered on the A4 sheet when it fits.
 */
export function computeA4DirectCoverDimensions(input: CoverDimensionsInput): A4DirectCoverDimensionsResult {
  const { pageWidthPt, pageHeightPt, spineWidthPt } = input;
  const bleedPt = input.bleedPt ?? DEFAULT_BLEED_PT;
  const wrapMarginPt = input.wrapMarginPt ?? DEFAULT_WRAP_MARGIN_PT;

  const sheetWidthPt = A4_LONG_EDGE_MM * MM_TO_PT;
  const sheetHeightPt = A4_SHORT_EDGE_MM * MM_TO_PT;

  const outerPanelWidthPt = pageWidthPt + bleedPt + wrapMarginPt;
  const totalWidthPt = 2 * pageWidthPt + spineWidthPt + 2 * bleedPt + 2 * wrapMarginPt;
  const totalHeightPt = pageHeightPt + 2 * bleedPt;

  const fitsSheet = totalWidthPt <= sheetWidthPt + 1e-6 && totalHeightPt <= sheetHeightPt + 1e-6;

  const offsetXPt = fitsSheet ? (sheetWidthPt - totalWidthPt) / 2 : 0;
  const offsetYPt = fitsSheet ? (sheetHeightPt - totalHeightPt) / 2 : 0;

  const backCoverRect: CoverRect = {
    x: offsetXPt,
    y: offsetYPt,
    width: outerPanelWidthPt,
    height: totalHeightPt,
  };
  const spineRect: CoverRect = {
    x: backCoverRect.x + backCoverRect.width,
    y: offsetYPt,
    width: spineWidthPt,
    height: totalHeightPt,
  };
  const frontCoverRect: CoverRect = {
    x: spineRect.x + spineRect.width,
    y: offsetYPt,
    width: outerPanelWidthPt,
    height: totalHeightPt,
  };

  return {
    format: 'a4-direct',
    totalWidthPt,
    totalHeightPt,
    backCoverRect,
    spineRect,
    frontCoverRect,
    sheetWidthPt,
    sheetHeightPt,
    fitsSheet,
  };
}

export function computeCoverDimensions(input: CoverDimensionsInput & { format: 'a4-direct' }): A4DirectCoverDimensionsResult;
export function computeCoverDimensions(input: CoverDimensionsInput & { format?: 'single' }): CoverDimensionsResult;
export function computeCoverDimensions(input: CoverDimensionsInput): AnyCoverDimensions;
export function computeCoverDimensions(input: CoverDimensionsInput): AnyCoverDimensions {
  if (input.format === 'a4-direct') {
    return computeA4DirectCoverDimensions(input);
  }
  const { pageWidthPt, pageHeightPt, spineWidthPt } = input;
  const bleedPt = input.bleedPt ?? DEFAULT_BLEED_PT;
  const wrapMarginPt = input.wrapMarginPt ?? DEFAULT_WRAP_MARGIN_PT;

  const totalWidthPt = pageWidthPt + spineWidthPt + pageWidthPt + 2 * bleedPt + 2 * wrapMarginPt;
  const totalHeightPt = pageHeightPt + 2 * bleedPt;

  // Bleed and wrap margin sit on each cover's OUTER edge only (the fore-edge trim);
  // the two edges facing the spine are fold lines, not trimmed edges, so the spine
  // itself carries none of that allowance.
  const outerPanelWidthPt = pageWidthPt + bleedPt + wrapMarginPt;

  const backCoverRect = { x: 0, y: 0, width: outerPanelWidthPt, height: totalHeightPt };
  const spineRect = { x: backCoverRect.x + backCoverRect.width, y: 0, width: spineWidthPt, height: totalHeightPt };
  const frontCoverRect = { x: spineRect.x + spineRect.width, y: 0, width: outerPanelWidthPt, height: totalHeightPt };

  return { format: 'single', totalWidthPt, totalHeightPt, backCoverRect, spineRect, frontCoverRect };
}

/**
 * Geometry for the two-sheet split cover.
 *
 * Kept as its own function rather than folding a `format` switch into
 * computeCoverDimensions: the two layouts have genuinely different panel sets
 * (a lap flap and a glue tab exist only here), and a discriminated return type
 * would push narrowing onto every existing single-wrap caller for no gain.
 *
 * Sheet 1, left to right: back cover | spine | lap flap.
 * Sheet 2, left to right: glue tab | front cover.
 * Laid out that way the two sheets read as one continuous wrap, and sheet 2's
 * tab lands inside the footprint of sheet 1's flap when they are bonded.
 */
export function computeSplitCoverDimensions(input: SplitCoverDimensionsInput): SplitCoverDimensionsResult {
  const { pageWidthPt, pageHeightPt, spineWidthPt } = input;
  const bleedPt = input.bleedPt ?? DEFAULT_BLEED_PT;
  const wrapMarginPt = input.wrapMarginPt ?? DEFAULT_WRAP_MARGIN_PT;
  const lapFlapPt = input.lapFlapPt ?? LAP_FLAP_WIDTH_MM * MM_TO_PT;
  const glueTabPt = input.glueTabPt ?? GLUE_TAB_WIDTH_MM * MM_TO_PT;

  const totalHeightPt = pageHeightPt + 2 * bleedPt;

  // Same rule as the single wrap: bleed and wrap allowance belong to a cover's
  // OUTER fore-edge only. Here that outer edge is the back cover's left side on
  // sheet 1 and the front cover's right side on sheet 2; the spine, the lap flap
  // and the glue tab are folds or glue surfaces, never trimmed edges.
  const outerPanelWidthPt = pageWidthPt + bleedPt + wrapMarginPt;

  const backCoverRect: CoverRect = { x: 0, y: 0, width: outerPanelWidthPt, height: totalHeightPt };
  const spineRect: CoverRect = { x: backCoverRect.width, y: 0, width: spineWidthPt, height: totalHeightPt };
  const lapFlapRect: CoverRect = { x: spineRect.x + spineRect.width, y: 0, width: lapFlapPt, height: totalHeightPt };

  const glueTabRect: CoverRect = { x: 0, y: 0, width: glueTabPt, height: totalHeightPt };
  const frontCoverRect: CoverRect = { x: glueTabRect.width, y: 0, width: outerPanelWidthPt, height: totalHeightPt };

  return {
    format: 'split',
    totalHeightPt,
    sheet1: {
      widthPt: lapFlapRect.x + lapFlapRect.width,
      heightPt: totalHeightPt,
      backCoverRect,
      spineRect,
      lapFlapRect,
      // Two creases: the spine's two folds. The second doubles as the flap fold.
      foldLinesX: [spineRect.x, lapFlapRect.x],
    },
    sheet2: {
      widthPt: frontCoverRect.x + frontCoverRect.width,
      heightPt: totalHeightPt,
      glueTabRect,
      frontCoverRect,
      foldLinesX: [frontCoverRect.x],
    },
  };
}

/** Which edge of a split sheet meets the other one: sheet 1's lap flap is on its right, sheet 2's glue tab on its left. */
export type MatingEdge = 'left' | 'right';

export interface SheetPlacement {
  /** The page box to open: the printer's own sheet when the artwork fits it, otherwise the artwork itself. */
  pageWidthPt: number;
  pageHeightPt: number;
  offsetXPt: number;
  offsetYPt: number;
  /** False when the artwork is larger than A4 and is therefore emitted at its own size. */
  fitsPrinterSheet: boolean;
}

/**
 * Where a split sheet's artwork sits on the paper that is actually fed.
 *
 * Until this existed the cover PDF opened its page at the ARTWORK's size — a
 * 176.60 x 216.00 mm box for an A5 split — and every print driver then fitted
 * that to the paper, scaling it up by 210 / 176.60 = 1.189. A 5.10 mm spine
 * printed 6.06 mm wide and the cover no longer sat on its own book block. The
 * geometry was never wrong; the page box lied about what paper it was for.
 *
 * The artwork is centred vertically but butted HORIZONTALLY against the mating
 * edge rather than centred. Centring would leave white on all four sides, so
 * the binder would cut four edges instead of two — and the two extra cuts would
 * land exactly on the lap flap and the glue tab, the pair of edges whose
 * alignment decides whether the two sheets meet cleanly.
 *
 * Artwork too big for A4 (the single wrap, or an A4-trim book) keeps its own
 * page box: those already print correctly on A3 and must not regress.
 */
export function placeSheetOnPrinterPaper(
  artworkWidthPt: number,
  artworkHeightPt: number,
  matingEdge: MatingEdge,
): SheetPlacement {
  const paperWidthPt = A4_SHORT_EDGE_MM * MM_TO_PT;
  const paperHeightPt = A4_LONG_EDGE_MM * MM_TO_PT;

  if (artworkWidthPt > paperWidthPt || artworkHeightPt > paperHeightPt) {
    return {
      pageWidthPt: artworkWidthPt,
      pageHeightPt: artworkHeightPt,
      offsetXPt: 0,
      offsetYPt: 0,
      fitsPrinterSheet: false,
    };
  }

  return {
    pageWidthPt: paperWidthPt,
    pageHeightPt: paperHeightPt,
    offsetXPt: matingEdge === 'right' ? paperWidthPt - artworkWidthPt : 0,
    offsetYPt: (paperHeightPt - artworkHeightPt) / 2,
    fitsPrinterSheet: true,
  };
}

/**
 * Whether every sheet of this cover clears an A4 printer.
 *
 * Asks placeSheetOnPrinterPaper the same question it answers when it lays the
 * artwork down, so a warning shown next to the geometry and the page box the
 * PDF actually gets can never disagree. A split cover is printable only when
 * BOTH of its sheets fit; the single wrap is one piece and stands on its own.
 *
 * Pure: it decides nothing and changes nothing about the emitted PDF. An
 * oversize cover is still produced exactly as before, on its own page box.
 */
export function coverFitsPrinterSheet(dimensions: AnyCoverDimensions): boolean {
  if (dimensions.format === 'split') {
    return placeSheetOnPrinterPaper(dimensions.sheet1.widthPt, dimensions.sheet1.heightPt, 'right').fitsPrinterSheet
      && placeSheetOnPrinterPaper(dimensions.sheet2.widthPt, dimensions.sheet2.heightPt, 'left').fitsPrinterSheet;
  }
  if (dimensions.format === 'a4-direct') {
    return dimensions.fitsSheet;
  }
  return placeSheetOnPrinterPaper(dimensions.totalWidthPt, dimensions.totalHeightPt, 'right').fitsPrinterSheet;
}

/** Moves a panel rect out of artwork space and onto the printed page. */
function onPaper(rect: CoverRect, placement: SheetPlacement): CoverRect {
  return {
    x: rect.x + placement.offsetXPt,
    y: rect.y + placement.offsetYPt,
    width: rect.width,
    height: rect.height,
  };
}

/** Sniffs the PNG signature; anything else is treated as JPEG (mirrors image-to-pdf-engine's explicit format field, but this contract carries raw bytes only). */
function detectImageFormat(bytes: Uint8Array): 'png' | 'jpg' {
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? 'png' : 'jpg';
}

/** Naive greedy word-wrap for the back-cover synopsis. */
function wrapText(text: string, font: { widthOfTextAtSize(t: string, size: number): number }, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

let cachedCoverFontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;

/**
 * Loads the bundled Noto Sans subset (regular + bold) used for cover text.
 * pdf-lib's StandardFonts are WinAnsi-encoded and cannot draw Turkish
 * ı/ş/ğ/İ/ö/ü/ç — the same Unicode gap watermark-engine and instructions-page
 * solve by embedding this font instead. Fetched lazily and memoised, so
 * repeated cover generation shares one fetch.
 */
async function loadCoverFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (!cachedCoverFontsPromise) {
    const grab = async (url: string): Promise<ArrayBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    cachedCoverFontsPromise = Promise.all([grab(notoSansUrl), grab(notoSansBoldUrl)])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((err) => {
        cachedCoverFontsPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        throw new BookletError('COVER_FONT_LOAD_FAILED', { message }, `Could not load the cover font: ${message}`);
      });
  }
  return cachedCoverFontsPromise;
}

const TITLE_FONT_SIZE = 24;
const AUTHOR_FONT_SIZE = 14;
const SPINE_FONT_SIZE = 12;
const SYNOPSIS_FONT_SIZE = 10;
const SYNOPSIS_LINE_HEIGHT = 14;
const PANEL_INSET_PT = 24;
/** Spine title is truncated to this many characters so it has a chance of fitting even on a narrow spine. */
const SPINE_TITLE_MAX_CHARS = 40;

/** Crease guides are printed marks on a finished cover, so they are drawn faint enough to disappear once folded. */
const FOLD_GUIDE_OPACITY = 0.35;
const FOLD_GUIDE_THICKNESS = 0.5;
const FOLD_GUIDE_DASH: [number, number] = [4, 4];

/** Hairline crop/trim marks indicating where to cut the margins on a split cover sheet. */
const CROP_MARK_LENGTH_PT = 14;
const CROP_MARK_THICKNESS = 0.5;
const CROP_MARK_OPACITY = 0.6;
/**
 * Crop marks sit in the WASTE margin, on bare paper outside the artwork, so they
 * are drawn in a fixed near-black rather than the theme's text color: on the
 * dark themes that text color is near-white and the marks would vanish.
 */
const CROP_MARK_COLOR = rgb(0.1, 0.1, 0.1);

interface CoverFonts { font: PDFFont; boldFont: PDFFont }

/**
 * A dashed crease guide at `x`, spanning the artwork from `yBottom` upwards.
 *
 * Drawn in the theme's own text color rather than a fixed grey so it stays
 * visible on the dark themes (navy/burgundy/charcoal), where a grey hairline
 * would vanish into the background.
 */
function drawFoldGuide(page: PDFPage, x: number, yBottom: number, heightPt: number, color: RGB): void {
  page.drawLine({
    start: { x, y: yBottom },
    end: { x, y: yBottom + heightPt },
    thickness: FOLD_GUIDE_THICKNESS,
    color,
    opacity: FOLD_GUIDE_OPACITY,
    dashArray: [...FOLD_GUIDE_DASH],
  });
}

/**
 * Hairline crop marks drawn in the waste margin outside the artwork box.
 *
 * For split sheets on A4, waste paper is left on 3 sides (top, bottom, and
 * the non-mating outer edge). Crop marks extend outward into the waste margin
 * so that cuts leave no marks on the finished cover.
 *
 * - Sheet 1 (matingEdge === 'right'): marks at top-left and bottom-left (both
 *   horizontal and vertical).
 * - Sheet 2 (matingEdge === 'left'): marks at top-right and bottom-right (both
 *   horizontal and vertical).
 *
 * The mating edge itself gets no marks: placeSheetOnPrinterPaper butts it
 * against the paper edge, so it is never cut and a mark there would land on
 * the clipped, unprintable edge of the sheet.
 */
export function drawCropMarks(
  page: PDFPage,
  place: SheetPlacement,
  artworkWidthPt: number,
  artworkHeightPt: number,
  matingEdge: MatingEdge,
): void {
  if (!place.fitsPrinterSheet) return;

  const x0 = place.offsetXPt;
  const x1 = place.offsetXPt + artworkWidthPt;
  const y0 = place.offsetYPt;
  const y1 = place.offsetYPt + artworkHeightPt;

  const drawLine = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    page.drawLine({
      start,
      end,
      thickness: CROP_MARK_THICKNESS,
      color: CROP_MARK_COLOR,
      opacity: CROP_MARK_OPACITY,
    });
  };

  if (matingEdge === 'right') {
    // Sheet 1: the left edge is the cut edge; x1 is the paper's own right edge.
    drawLine({ x: x0, y: y1 }, { x: x0, y: y1 + CROP_MARK_LENGTH_PT });
    drawLine({ x: x0, y: y0 - CROP_MARK_LENGTH_PT }, { x: x0, y: y0 });
    drawLine({ x: x0 - CROP_MARK_LENGTH_PT, y: y1 }, { x: x0, y: y1 });
    drawLine({ x: x0 - CROP_MARK_LENGTH_PT, y: y0 }, { x: x0, y: y0 });
  } else {
    // Sheet 2: the right edge is the cut edge; x0 is the paper's own left edge.
    drawLine({ x: x1, y: y1 }, { x: x1, y: y1 + CROP_MARK_LENGTH_PT });
    drawLine({ x: x1, y: y0 - CROP_MARK_LENGTH_PT }, { x: x1, y: y0 });
    drawLine({ x: x1, y: y1 }, { x: x1 + CROP_MARK_LENGTH_PT, y: y1 });
    drawLine({ x: x1, y: y0 }, { x: x1 + CROP_MARK_LENGTH_PT, y: y0 });
  }
}

/** Title, author and (optional) artwork, centred in `rect`. Shared by both cover formats. */
async function drawFrontCoverPanel(
  doc: PDFDocument,
  page: PDFPage,
  rect: CoverRect,
  content: CoverContentInput,
  fonts: CoverFonts,
  textColor: RGB,
): Promise<void> {
  const titleWidth = fonts.boldFont.widthOfTextAtSize(content.title, TITLE_FONT_SIZE);
  const titleX = rect.x + (rect.width - titleWidth) / 2;
  const titleY = rect.y + rect.height * 0.65;
  page.drawText(content.title, { x: titleX, y: titleY, size: TITLE_FONT_SIZE, font: fonts.boldFont, color: textColor });

  if (content.author) {
    const authorWidth = fonts.font.widthOfTextAtSize(content.author, AUTHOR_FONT_SIZE);
    const authorX = rect.x + (rect.width - authorWidth) / 2;
    page.drawText(content.author, { x: authorX, y: titleY - AUTHOR_FONT_SIZE * 2, size: AUTHOR_FONT_SIZE, font: fonts.font, color: textColor });
  }

  if (content.coverImageBytes) {
    const format = detectImageFormat(content.coverImageBytes);
    const image = format === 'png'
      ? await doc.embedPng(content.coverImageBytes)
      : await doc.embedJpg(content.coverImageBytes);

    const maxWidth = rect.width - 2 * PANEL_INSET_PT;
    const maxHeight = rect.height * 0.45;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const imageWidth = image.width * scale;
    const imageHeight = image.height * scale;
    const imageX = rect.x + (rect.width - imageWidth) / 2;
    const imageY = rect.y + rect.height * 0.15;
    page.drawImage(image, { x: imageX, y: imageY, width: imageWidth, height: imageHeight });
  }
}

/** The rotated spine title, or nothing at all below the legibility floor. Shared by both cover formats. */
function drawSpinePanel(
  page: PDFPage,
  rect: CoverRect,
  content: CoverContentInput,
  fonts: CoverFonts,
  textColor: RGB,
  spineResult: SpineCalculationResult,
): void {
  // Below the legibility floor, printing anything on the spine would be unreadable
  // once trimmed and bound, so it is left entirely blank rather than shrunk.
  if (!spineResult.canPrintSpineText) return;

  const spineTitle = content.title.length > SPINE_TITLE_MAX_CHARS
    ? content.title.slice(0, SPINE_TITLE_MAX_CHARS)
    : content.title;
  const spineTextWidth = fonts.boldFont.widthOfTextAtSize(spineTitle, SPINE_FONT_SIZE);
  const { x, y } = computeCenteredRotatedPosition(rect.width, rect.height, spineTextWidth, SPINE_FONT_SIZE, 90);
  page.drawText(spineTitle, {
    x: rect.x + x,
    y: rect.y + y,
    size: SPINE_FONT_SIZE,
    font: fonts.boldFont,
    rotate: degrees(90),
    color: textColor,
  });
}

/** The wrapped synopsis, or a placeholder frame when there is no content at all. Shared by both cover formats. */
function drawBackCoverPanel(
  page: PDFPage,
  rect: CoverRect,
  content: CoverContentInput,
  fonts: CoverFonts,
  textColor: RGB,
): void {
  if (content.synopsis) {
    const maxWidth = rect.width - 2 * PANEL_INSET_PT;
    const lines = wrapText(content.synopsis, fonts.font, SYNOPSIS_FONT_SIZE, maxWidth);
    let y = rect.y + rect.height * 0.7;
    for (const line of lines) {
      page.drawText(line, { x: rect.x + PANEL_INSET_PT, y, size: SYNOPSIS_FONT_SIZE, font: fonts.font, color: textColor });
      y -= SYNOPSIS_LINE_HEIGHT;
    }
  } else if (!content.coverImageBytes) {
    // No synopsis and no image at all to fall back on for either cover face:
    // a plain placeholder frame beats a completely blank back cover.
    page.drawRectangle({
      x: rect.x + PANEL_INSET_PT,
      y: rect.y + PANEL_INSET_PT,
      width: rect.width - 2 * PANEL_INSET_PT,
      height: rect.height - 2 * PANEL_INSET_PT,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 1,
    });
  }
}

/**
 * Generates a print-ready cover PDF.
 *
 * `dimensions.format === 'single'` produces the classic one-page wraparound
 * (back + spine + front, left to right) sized to totalWidthPt x totalHeightPt.
 *
 * `dimensions.format === 'split'` produces a two-page PDF, each page an actual
 * A4 sheet: page 1 is back + spine + lap flap, page 2 is glue tab + front
 * cover, with dashed crease guides where the sheet must be folded and where the
 * two sheets overlap. The artwork is positioned on that sheet by
 * placeSheetOnPrinterPaper; a split too wide for A4 keeps its own page box.
 *
 * `options.format`, when given, must agree with the dimensions it was handed —
 * the two carry different panel sets, so a disagreement is a caller bug, not
 * something to silently resolve.
 *
 * Title/author/synopsis are drawn with the bundled Noto Sans subset (not
 * StandardFonts), so Turkish characters (ı, ş, ğ, ü, ö, ç) render correctly —
 * see loadCoverFonts.
 */
export async function generateCoverPdf(options: GenerateCoverOptions): Promise<Uint8Array> {
  const { dimensions, content, spineResult } = options;

  if (options.format !== undefined && options.format !== dimensions.format) {
    throw new BookletError(
      'COVER_FORMAT_MISMATCH',
      { requested: options.format, dimensions: dimensions.format },
      `Requested cover format "${options.format}" but was given ${dimensions.format} dimensions.`,
    );
  }

  // fontkit is ~700kB and is only needed to embed the Unicode TTF, so it is
  // imported dynamically rather than at module scope (see watermark-engine's
  // identical reasoning) — Cover Studio is its own tool, not part of the
  // eagerly-loaded merge/booklet/rotate path.
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontBytes = await loadCoverFonts();
  const fonts: CoverFonts = {
    font: await doc.embedFont(fontBytes.regular, { subset: true }),
    boldFont: await doc.embedFont(fontBytes.bold, { subset: true }),
  };

  const theme = COVER_THEMES[content.theme ?? DEFAULT_COVER_THEME];
  const textColor = rgb(...theme.textRgb);
  const backgroundColor = rgb(...theme.backgroundRgb);

  if (dimensions.format === 'split') {
    const { sheet1, sheet2 } = dimensions;

    // --- SHEET 1: back cover | spine | lap flap ---
    // The lap flap is this sheet's right-hand edge, so that is the edge butted
    // against the paper — see placeSheetOnPrinterPaper for why.
    const place1 = placeSheetOnPrinterPaper(sheet1.widthPt, sheet1.heightPt, 'right');
    const page1 = doc.addPage([place1.pageWidthPt, place1.pageHeightPt]);
    page1.drawRectangle({ x: place1.offsetXPt, y: place1.offsetYPt, width: sheet1.widthPt, height: sheet1.heightPt, color: backgroundColor });
    drawSpinePanel(page1, onPaper(sheet1.spineRect, place1), content, fonts, textColor, spineResult);
    drawBackCoverPanel(page1, onPaper(sheet1.backCoverRect, place1), content, fonts, textColor);
    // The lap flap itself is deliberately left blank: it ends up bonded under
    // sheet 2's glue tab, so anything printed on it would be buried.
    for (const x of sheet1.foldLinesX) drawFoldGuide(page1, x + place1.offsetXPt, place1.offsetYPt, sheet1.heightPt, textColor);
    if (place1.fitsPrinterSheet) drawCropMarks(page1, place1, sheet1.widthPt, sheet1.heightPt, 'right');

    // --- SHEET 2: glue tab | front cover ---
    // Sheet 2 meets sheet 1 on its left, so it is butted the other way; the two
    // mating edges then sit on the two sheets' own paper edges, uncut.
    const place2 = placeSheetOnPrinterPaper(sheet2.widthPt, sheet2.heightPt, 'left');
    const page2 = doc.addPage([place2.pageWidthPt, place2.pageHeightPt]);
    page2.drawRectangle({ x: place2.offsetXPt, y: place2.offsetYPt, width: sheet2.widthPt, height: sheet2.heightPt, color: backgroundColor });
    await drawFrontCoverPanel(doc, page2, onPaper(sheet2.frontCoverRect, place2), content, fonts, textColor);
    for (const x of sheet2.foldLinesX) drawFoldGuide(page2, x + place2.offsetXPt, place2.offsetYPt, sheet2.heightPt, textColor);
    if (place2.fitsPrinterSheet) drawCropMarks(page2, place2, sheet2.widthPt, sheet2.heightPt, 'left');

    return doc.save();
  }

  if (dimensions.format === 'a4-direct') {
    const { sheetWidthPt, sheetHeightPt, frontCoverRect, spineRect, backCoverRect, totalWidthPt, totalHeightPt } = dimensions;
    if (!dimensions.fitsSheet) {
      throw new BookletError(
        'COVER_TOO_LARGE',
        { totalWidthPt, totalHeightPt, sheetWidthPt, sheetHeightPt },
        `Cover dimensions (${(totalWidthPt * 25.4 / 72).toFixed(1)} × ${(totalHeightPt * 25.4 / 72).toFixed(1)} mm) exceed a single A4 sheet (${(sheetWidthPt * 25.4 / 72).toFixed(1)} × ${(sheetHeightPt * 25.4 / 72).toFixed(1)} mm). Use 2 × A4 split or 1 × A3 format instead.`,
      );
    }
    const page = doc.addPage([sheetWidthPt, sheetHeightPt]);
    page.drawRectangle({
      x: backCoverRect.x,
      y: backCoverRect.y,
      width: totalWidthPt,
      height: totalHeightPt,
      color: backgroundColor,
    });

    await drawFrontCoverPanel(doc, page, frontCoverRect, content, fonts, textColor);
    drawSpinePanel(page, spineRect, content, fonts, textColor, spineResult);
    drawBackCoverPanel(page, backCoverRect, content, fonts, textColor);

    return doc.save();
  }

  const { frontCoverRect, spineRect, backCoverRect, totalWidthPt, totalHeightPt } = dimensions;
  const page = doc.addPage([totalWidthPt, totalHeightPt]);
  page.drawRectangle({ x: 0, y: 0, width: totalWidthPt, height: totalHeightPt, color: backgroundColor });

  await drawFrontCoverPanel(doc, page, frontCoverRect, content, fonts, textColor);
  drawSpinePanel(page, spineRect, content, fonts, textColor, spineResult);
  drawBackCoverPanel(page, backCoverRect, content, fonts, textColor);

  return doc.save();
}
