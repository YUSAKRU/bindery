import type {
  AnyCoverDimensions,
  CoverDimensionsInput,
  CoverTheme,
  PaperGsm,
  SpineCalculationInput,
} from '../engine/cover-engine';
import { coverFitsPrinterSheet, MM_TO_PT } from '../engine/cover-engine';

export type BoardThicknessMm = 1.5 | 2.0 | 2.5 | 3.0;

export interface CoverOptions {
  paper: 'split' | 'single'; // A4 paper (2 sheets) | A3 paper (1 sheet)
  kind: 'softcover' | 'hardcover'; // flexible | hard (board)
  binding: 'saddle' | 'sewn' | 'perfect';
  boardMm: BoardThicknessMm; // only meaningful when kind === 'hardcover'
  gsm: PaperGsm;
  theme: CoverTheme;
}

export const DEFAULT_COVER_OPTIONS: CoverOptions = {
  paper: 'split',
  kind: 'softcover',
  binding: 'sewn',
  boardMm: 2.0,
  gsm: 80,
  theme: 'cream',
};

/**
 * Normalizes cover options according to physical binding constraints:
 * - Saddle stitch cannot take a hard cover (board): saddle => kind = 'softcover'.
 * - Paper format and cover kind are independent (split/single + soft/hard are valid).
 * - boardMm is validated against [1.5, 2.0, 2.5, 3.0] (defaults to 2.0).
 */
export function normalizeCoverOptions(o: CoverOptions): CoverOptions {
  const kind: 'softcover' | 'hardcover' = o.binding === 'saddle' ? 'softcover' : o.kind;
  const validBoards: BoardThicknessMm[] = [1.5, 2.0, 2.5, 3.0];
  const boardMm: BoardThicknessMm = validBoards.includes(o.boardMm) ? o.boardMm : 2.0;
  return {
    paper: o.paper,
    kind,
    binding: o.binding,
    boardMm,
    gsm: o.gsm,
    theme: o.theme,
  };
}

/**
 * Returns the exact dimInput both flows pass to computeSplitCoverDimensions / computeCoverDimensions:
 * - softcover: bleed 3 mm, turn-in 0
 * - hardcover: bleed 0, turn-in 15 mm
 * - format = o.paper
 */
export function coverGeometryInput(
  o: CoverOptions,
  pageWidthPt: number,
  pageHeightPt: number,
  spineWidthPt: number,
): CoverDimensionsInput {
  const norm = normalizeCoverOptions(o);
  const isHardcover = norm.kind === 'hardcover';
  return {
    pageWidthPt,
    pageHeightPt,
    spineWidthPt,
    bleedPt: (isHardcover ? 0 : 3) * MM_TO_PT,
    wrapMarginPt: (isHardcover ? 15 : 0) * MM_TO_PT,
    format: norm.paper,
  };
}

/**
 * The computeSpineWidth input:
 * - bindingType = o.binding
 * - boardThicknessMm only for hardcover
 */
export function spineInput(
  o: CoverOptions,
  sheets: number,
  signatures: number,
): SpineCalculationInput {
  const norm = normalizeCoverOptions(o);
  return {
    sheetCount: Math.max(1, sheets),
    signatureCount: norm.binding === 'saddle' ? 1 : Math.max(1, signatures),
    paperGsm: norm.gsm,
    bindingType: norm.binding,
    boardThicknessMm: norm.kind === 'hardcover' ? norm.boardMm : undefined,
  };
}

export interface SheetTrimResult {
  trim: 'A5' | 'A4';
  isSupported: boolean;
}

/**
 * Determines Cover Studio book trim from a physical booklet sheet size in points:
 * - An A4 sheet gives an A5 trim.
 * - An A3 sheet gives an A4 trim.
 * - Unsupported sheets (Letter, A5 sheet, custom source) return A5 with isSupported: false.
 */
export function resolveCoverPageTrim(
  sheetWidthPt: number,
  sheetHeightPt: number,
): SheetTrimResult {
  const shortPt = Math.min(sheetWidthPt, sheetHeightPt);
  const longPt = Math.max(sheetWidthPt, sheetHeightPt);

  const a4ShortPt = (210 * 72) / 25.4;
  const a4LongPt = (297 * 72) / 25.4;
  const a3ShortPt = (297 * 72) / 25.4;
  const a3LongPt = (420 * 72) / 25.4;

  const TOLERANCE_PT = 2.0;

  if (Math.abs(shortPt - a4ShortPt) <= TOLERANCE_PT && Math.abs(longPt - a4LongPt) <= TOLERANCE_PT) {
    return { trim: 'A5', isSupported: true };
  }
  if (Math.abs(shortPt - a3ShortPt) <= TOLERANCE_PT && Math.abs(longPt - a3LongPt) <= TOLERANCE_PT) {
    return { trim: 'A4', isSupported: true };
  }
  return { trim: 'A5', isSupported: false };
}

export interface CoverFormatFitResult {
  fits: boolean;
  paperKey: 'cover.paperSplitSheets' | 'cover.paperSingleSheet';
  warnKey: 'cover.needsA3' | 'cover.needsLarger';
  wMm: number;
  hMm: number;
}

/**
 * Checks whether a cover fits on its intended printer sheet:
 * - split (A4 case): judged by coverFitsPrinterSheet (both sheets must fit A4).
 * - single (A3 case): judged against A3 (420 × 297 mm).
 * Returns dimension numbers in mm for formatting into the result line.
 */
export function checkCoverFormatFit(
  dimensions: AnyCoverDimensions,
  mmPerPt: number = 25.4 / 72,
): CoverFormatFitResult {
  if (dimensions.format === 'split') {
    const fits = coverFitsPrinterSheet(dimensions);
    const widestSheetWidthPt = Math.max(dimensions.sheet1.widthPt, dimensions.sheet2.widthPt);
    return {
      fits,
      paperKey: 'cover.paperSplitSheets',
      warnKey: 'cover.needsA3',
      wMm: widestSheetWidthPt * mmPerPt,
      hMm: dimensions.totalHeightPt * mmPerPt,
    };
  }

  // single wrap judged against A3 (420 × 297 mm)
  const wrapWidthMm = dimensions.totalWidthPt * mmPerPt;
  const wrapHeightMm = dimensions.totalHeightPt * mmPerPt;
  const fits = (wrapWidthMm <= 420 && wrapHeightMm <= 297) || (wrapWidthMm <= 297 && wrapHeightMm <= 420);
  return {
    fits,
    paperKey: 'cover.paperSingleSheet',
    warnKey: 'cover.needsLarger',
    wMm: wrapWidthMm,
    hMm: wrapHeightMm,
  };
}

