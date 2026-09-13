import { BookletError } from '../engine/types';

// ============================================================================
// Physical Constants & Conversion Factors
// ============================================================================

export const MM_TO_PT = 72 / 25.4;
export const PT_TO_MM = 25.4 / 72;

export const A4_LONG_EDGE_MM = 297;
export const A4_SHORT_EDGE_MM = 210;

export const LAP_FLAP_WIDTH_MM = 20;
export const GLUE_TAB_WIDTH_MM = 10;

export const SPINE_TEXT_LEGIBILITY_FLOOR_MM = 3.5;
export const BOARD_HINGE_ALLOWANCE_MM = 7.0;
export const SEWN_HINGE_ALLOWANCE_MM = 1.0;
export const PERFECT_HINGE_ALLOWANCE_MM = 1.5;
export const SADDLE_HINGE_ALLOWANCE_MM = 0.0;
export const THREAD_SWELL_PER_SIG_MM = 0.15;

export const DEFAULT_BLEED_PT = 9; // ~3.175 mm
export const DEFAULT_WRAP_MARGIN_PT = 0;

// ============================================================================
// 1. Paper Selection Types
// ============================================================================

export type PaperSizePreset =
  | 'A4'
  | 'A3'
  | 'A5'
  | 'Letter'
  | 'Legal'
  | 'Tabloid'
  | 'source'
  | 'custom';

export interface DimensionsPt {
  width: number;
  height: number;
}

export type UnitType = 'pt' | 'mm' | 'in';

export interface ExplicitPaperDimensions {
  width: number;
  height: number;
  unit?: UnitType;
}

export type CoverPaperSize = PaperSizePreset | ExplicitPaperDimensions;

export interface CoverMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CoverBleed {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CoverPaperOptions {
  /** Physical target sheet or trim size */
  size: CoverPaperSize;
  /** Margin around page in points */
  margins: CoverMargins;
  /** Bleed allowance outside trim line in points */
  bleed: CoverBleed;
  /** Custom dimension in points if size === 'custom' */
  customDimensionsPt?: DimensionsPt;
}

// Preset standard sheet dimensions in points (landscape orientation by default)
export const STANDARD_PAPER_SIZES_PT: Record<Exclude<PaperSizePreset, 'source' | 'custom'>, DimensionsPt> = {
  A4: { width: 841.89, height: 595.28 }, // 297 x 210 mm
  A3: { width: 1190.55, height: 841.89 }, // 420 x 297 mm
  A5: { width: 595.28, height: 419.53 }, // 210 x 148 mm
  Letter: { width: 792.0, height: 612.0 }, // 11 x 8.5 in
  Legal: { width: 1008.0, height: 612.0 }, // 14 x 8.5 in
  Tabloid: { width: 1224.0, height: 792.0 }, // 17 x 11 in
};

// ============================================================================
// 2. Scale & Fit Mode
// ============================================================================

export type CoverScaleMode = 'fit' | 'fill' | 'stretch' | 'custom';

export interface CoverScaleOptions {
  /** Scaling mode for artwork / cover image */
  mode: CoverScaleMode;
  /** Scale factor (1.0 = 100%) when mode is 'custom' */
  customScale?: number;
  /** Whether aspect ratio is preserved */
  maintainAspectRatio: boolean;
}

// ============================================================================
// 3. Placement & Alignment
// ============================================================================

export type HorizontalAlignment = 'left' | 'center' | 'right';
export type VerticalAlignment = 'top' | 'center' | 'bottom';

export interface CoverPlacementOptions {
  horizontal: HorizontalAlignment;
  vertical: VerticalAlignment;
  /** Optional micro-offset in points */
  offsetXPt?: number;
  offsetYPt?: number;
}

// ============================================================================
// 4. Page Selection
// ============================================================================

export type CoverPageTarget = 'front' | 'back' | 'spine' | 'spread' | 'all';

export interface CoverPageSelectionOptions {
  /** Target cover component to render or export */
  target: CoverPageTarget;
  /** Include front cover panel */
  includeFront: boolean;
  /** Include back cover panel */
  includeBack: boolean;
  /** Include spine panel */
  includeSpine: boolean;
  /** Include overlap flaps / glue tabs (for split format) */
  includeFlaps: boolean;
}

// ============================================================================
// 5. Wrap & Fold Settings
// ============================================================================

export type CoverFormat = 'single' | 'split' | 'a4-direct';

export interface CoverWrapFoldOptions {
  /** Format of cover output: single wide sheet, 2-sheet A4 split, or single A4 wrap */
  format: CoverFormat;
  /** Whether to draw dashed crease / fold guides */
  foldGuides: boolean;
  /** Additional wrap allowance / turn-in around fore-edges in points */
  wrapMarginPt: number;
  /** Overlap flap width for sheet 1 in points (split format) */
  lapFlapPt?: number;
  /** Glue tab width for sheet 2 in points (split format) */
  glueTabPt?: number;
  /** Hairline crop marks in waste margins (for split sheets on printer paper) */
  cropMarks: boolean;
}

// ============================================================================
// 6. Spine Calculation
// ============================================================================

export type BindingType = 'sewn' | 'perfect' | 'saddle';
export type PaperGsm = 70 | 80 | 90 | 100 | 120;

export const PAPER_CALIPERS_MM: Record<PaperGsm, number> = {
  70: 0.090,
  80: 0.100,
  90: 0.115,
  100: 0.130,
  120: 0.155,
};

export interface CoverSpineOptions {
  /** Page count of the book block (auto-converted to sheet count if sheetCount omitted) */
  pageCount?: number;
  /** Direct sheet count (takes precedence over pageCount) */
  sheetCount?: number;
  /** Number of signatures gathered together */
  signatureCount?: number;
  /** Commercial paper weight in GSM (70, 80, 90, 100, 120, or custom) */
  paperGsm?: PaperGsm | number;
  /** Direct caliper per sheet in mm. Overrides GSM lookup when provided */
  paperCaliperMm?: number;
  /**
   * Paper bulk factor in cm³/g.
   * Caliper (mm) = (paperGsm * bulkFactor) / 1000.
   * Standard book printing papers typically have a bulk of 1.1 to 1.5.
   */
  bulkFactor?: number;
  /** Binding method */
  bindingType: BindingType;
  /** Board thickness in mm for case-bound / hardcover bindings */
  boardThicknessMm?: number;
  /** Thread swell per signature in mm for sewn binding (defaults to 0.15 mm) */
  threadSwellPerSigMm?: number;
  /** Direct manual override for total spine width in mm */
  manualSpineWidthMm?: number;
}

export interface SpineCalculationResult {
  textBlockThicknessMm: number;
  threadSwellMm: number;
  hingeAllowanceMm: number;
  totalSpineWidthMm: number;
  totalSpineWidthPt: number;
  canPrintSpineText: boolean;
}

export interface CoverSpineResult extends SpineCalculationResult {
  sheetCount: number;
  signatureCount: number;
  effectiveCaliperMm: number;
}

export interface SpineCalculationInput {
  sheetCount: number;
  signatureCount: number;
  paperGsm: PaperGsm;
  bindingType: BindingType;
  boardThicknessMm?: number;
}

// ============================================================================
// 7. Preview & Export Settings
// ============================================================================

export type CoverExportFormat = 'pdf' | 'png' | 'jpg' | 'svg';
export type CoverColorMode = 'rgb' | 'cmyk' | 'grayscale';

export interface CoverExportOptions {
  /** Export resolution in DPI (e.g. 72 for preview, 300 for print) */
  dpi: number;
  /** Output file format */
  format: CoverExportFormat;
  /** Color reproduction mode */
  colorMode: CoverColorMode;
  /** Lossy compression quality (0.0 to 1.0) */
  quality?: number;
  /** Scale factor for on-screen preview (e.g. 0.25 for thumbnails) */
  previewScale?: number;
}

// ============================================================================
// 8. Content & Styling
// ============================================================================

export type CoverTheme = 'cream' | 'white' | 'navy' | 'burgundy' | 'charcoal';

export interface ThemeColors {
  backgroundRgb: [number, number, number];
  textRgb: [number, number, number];
}

export const COVER_THEMES: Record<CoverTheme, ThemeColors> = {
  cream: { backgroundRgb: [0.984, 0.973, 0.949], textRgb: [0.161, 0.145, 0.141] },
  white: { backgroundRgb: [1, 1, 1], textRgb: [0.059, 0.090, 0.165] },
  navy: { backgroundRgb: [0.059, 0.090, 0.165], textRgb: [0.973, 0.980, 0.988] },
  burgundy: { backgroundRgb: [0.271, 0.039, 0.039], textRgb: [0.996, 0.949, 0.949] },
  charcoal: { backgroundRgb: [0.118, 0.161, 0.231], textRgb: [0.973, 0.980, 0.988] },
};

export interface CoverContentOptions {
  title: string;
  author?: string;
  synopsis?: string;
  coverImageBytes?: Uint8Array;
  theme?: CoverTheme;
}

// ============================================================================
// 9. Canonical Unified CoverOptions
// ============================================================================

export interface CoverOptions {
  /** Paper selection: sheet/trim dimensions, margins, and bleed */
  paper: CoverPaperOptions;
  /** Scaling and fitting mode for artwork */
  scale: CoverScaleOptions;
  /** Placement and alignment */
  placement: CoverPlacementOptions;
  /** Page / panel selection */
  pageSelection: CoverPageSelectionOptions;
  /** Wrap, flaps, fold guides, and split format settings */
  wrapFold: CoverWrapFoldOptions;
  /** Spine calculation parameters (caliper, bulk, page/sheet count, binding) */
  spine: CoverSpineOptions;
  /** Preview and export settings (DPI, format, color mode) */
  export: CoverExportOptions;
  /** Content metadata and theme */
  content: CoverContentOptions;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type CoverOptionsInput = DeepPartial<CoverOptions>;

// ============================================================================
// Defaults & Helper Functions
// ============================================================================

export const DEFAULT_COVER_OPTIONS: CoverOptions = {
  paper: {
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    bleed: { top: DEFAULT_BLEED_PT, bottom: DEFAULT_BLEED_PT, left: DEFAULT_BLEED_PT, right: DEFAULT_BLEED_PT },
  },
  scale: {
    mode: 'fit',
    maintainAspectRatio: true,
  },
  placement: {
    horizontal: 'center',
    vertical: 'center',
    offsetXPt: 0,
    offsetYPt: 0,
  },
  pageSelection: {
    target: 'spread',
    includeFront: true,
    includeBack: true,
    includeSpine: true,
    includeFlaps: true,
  },
  wrapFold: {
    format: 'split',
    foldGuides: true,
    wrapMarginPt: DEFAULT_WRAP_MARGIN_PT,
    lapFlapPt: LAP_FLAP_WIDTH_MM * MM_TO_PT,
    glueTabPt: GLUE_TAB_WIDTH_MM * MM_TO_PT,
    cropMarks: true,
  },
  spine: {
    sheetCount: 16,
    signatureCount: 4,
    paperGsm: 80,
    bindingType: 'sewn',
  },
  export: {
    dpi: 300,
    format: 'pdf',
    colorMode: 'rgb',
    quality: 1.0,
    previewScale: 1.0,
  },
  content: {
    title: '',
    theme: 'cream',
  },
};

/**
 * Resolves standard or custom paper dimensions into points.
 */
export function resolvePaperDimensions(size: CoverPaperSize): DimensionsPt {
  if (typeof size === 'string') {
    if (size in STANDARD_PAPER_SIZES_PT) {
      return { ...STANDARD_PAPER_SIZES_PT[size as keyof typeof STANDARD_PAPER_SIZES_PT] };
    }
    // 'source' or fallback to A4
    return { ...STANDARD_PAPER_SIZES_PT.A4 };
  }

  const { width, height, unit = 'pt' } = size;
  if (unit === 'mm') {
    return { width: width * MM_TO_PT, height: height * MM_TO_PT };
  }
  if (unit === 'in') {
    return { width: width * 72, height: height * 72 };
  }
  return { width, height };
}

/**
 * Calculates complete spine geometry and printability based on:
 * - sheetCount or pageCount
 * - paper caliper / bulk factor / GSM
 * - binding type and signatures (thread swell)
 * - board thickness (for hardcover)
 */
export function calculateCoverSpine(input: CoverSpineOptions): CoverSpineResult {
  let { sheetCount, signatureCount, pageCount } = input;
  const {
    paperGsm,
    paperCaliperMm,
    bulkFactor,
    bindingType,
    boardThicknessMm,
    threadSwellPerSigMm,
    manualSpineWidthMm,
  } = input;

  if (sheetCount !== undefined && sheetCount <= 0) {
    throw new BookletError(
      'COVER_INVALID_SHEET_COUNT',
      { sheetCount },
      `Sheet count must be positive, got ${sheetCount}.`,
    );
  }

  if (pageCount !== undefined && pageCount <= 0) {
    throw new BookletError(
      'COVER_INVALID_PAGE_COUNT',
      { pageCount },
      `Page count must be positive, got ${pageCount}.`,
    );
  }

  // Derive sheet count if not explicitly given
  if (sheetCount === undefined) {
    if (pageCount !== undefined) {
      // Folded signatures (sewn/saddle) have 4 pages per sheet; cut-sheet perfect binding has 2 pages per sheet
      const pagesPerSheet = bindingType === 'perfect' ? 2 : 4;
      sheetCount = Math.max(1, Math.ceil(pageCount / pagesPerSheet));
    } else {
      sheetCount = 1;
    }
  }

  if (signatureCount !== undefined && signatureCount <= 0) {
    throw new BookletError(
      'COVER_INVALID_SIGNATURE_COUNT',
      { signatureCount },
      `Signature count must be positive, got ${signatureCount}.`,
    );
  }

  // Derive signature count if omitted
  if (signatureCount === undefined) {
    if (bindingType === 'saddle' || bindingType === 'perfect') {
      signatureCount = 1;
    } else {
      // Standard signature is 4 sheets (16 booklet pages)
      signatureCount = Math.max(1, Math.ceil(sheetCount / 4));
    }
  }

  // Determine effective paper caliper in mm
  let effectiveCaliperMm: number;
  if (paperCaliperMm !== undefined && paperCaliperMm > 0) {
    effectiveCaliperMm = paperCaliperMm;
  } else if (bulkFactor !== undefined && bulkFactor > 0) {
    const gsm = paperGsm ?? 80;
    // Caliper (mm) = (GSM * bulkFactor) / 1000
    effectiveCaliperMm = (gsm * bulkFactor) / 1000;
  } else if (paperGsm !== undefined && paperGsm in PAPER_CALIPERS_MM) {
    effectiveCaliperMm = PAPER_CALIPERS_MM[paperGsm as PaperGsm];
  } else if (paperGsm !== undefined && paperGsm > 0) {
    // Default bulk factor of 1.25 cm³/g for custom GSM
    effectiveCaliperMm = (paperGsm * 1.25) / 1000;
  } else {
    effectiveCaliperMm = PAPER_CALIPERS_MM[80];
  }

  const textBlockThicknessMm = sheetCount * effectiveCaliperMm;

  // Thread swell only applies to sewn gathered signatures
  const swellRate = threadSwellPerSigMm ?? THREAD_SWELL_PER_SIG_MM;
  const threadSwellMm = bindingType === 'sewn' ? signatureCount * swellRate : 0;

  // Hinge allowance
  let hingeAllowanceMm: number;
  if (boardThicknessMm !== undefined) {
    hingeAllowanceMm = 2 * boardThicknessMm + BOARD_HINGE_ALLOWANCE_MM;
  } else if (bindingType === 'saddle') {
    hingeAllowanceMm = SADDLE_HINGE_ALLOWANCE_MM;
  } else if (bindingType === 'sewn') {
    hingeAllowanceMm = SEWN_HINGE_ALLOWANCE_MM;
  } else {
    hingeAllowanceMm = PERFECT_HINGE_ALLOWANCE_MM;
  }

  const calculatedSpineWidthMm = textBlockThicknessMm + threadSwellMm + hingeAllowanceMm;
  const totalSpineWidthMm = manualSpineWidthMm !== undefined && manualSpineWidthMm >= 0
    ? manualSpineWidthMm
    : calculatedSpineWidthMm;

  const totalSpineWidthPt = totalSpineWidthMm * MM_TO_PT;
  const canPrintSpineText = totalSpineWidthMm >= SPINE_TEXT_LEGIBILITY_FLOOR_MM;

  return {
    textBlockThicknessMm,
    threadSwellMm,
    hingeAllowanceMm,
    totalSpineWidthMm,
    totalSpineWidthPt,
    canPrintSpineText,
    sheetCount,
    signatureCount,
    effectiveCaliperMm,
  };
}

/**
 * Merges partial input with default cover options.
 */
export function createCoverOptions(input?: CoverOptionsInput): CoverOptions {
  if (!input) return JSON.parse(JSON.stringify(DEFAULT_COVER_OPTIONS));

  return {
    paper: {
      size: input.paper?.size ?? DEFAULT_COVER_OPTIONS.paper.size,
      margins: {
        top: input.paper?.margins?.top ?? DEFAULT_COVER_OPTIONS.paper.margins.top,
        bottom: input.paper?.margins?.bottom ?? DEFAULT_COVER_OPTIONS.paper.margins.bottom,
        left: input.paper?.margins?.left ?? DEFAULT_COVER_OPTIONS.paper.margins.left,
        right: input.paper?.margins?.right ?? DEFAULT_COVER_OPTIONS.paper.margins.right,
      },
      bleed: {
        top: input.paper?.bleed?.top ?? DEFAULT_COVER_OPTIONS.paper.bleed.top,
        bottom: input.paper?.bleed?.bottom ?? DEFAULT_COVER_OPTIONS.paper.bleed.bottom,
        left: input.paper?.bleed?.left ?? DEFAULT_COVER_OPTIONS.paper.bleed.left,
        right: input.paper?.bleed?.right ?? DEFAULT_COVER_OPTIONS.paper.bleed.right,
      },
      customDimensionsPt: input.paper?.customDimensionsPt,
    },
    scale: {
      mode: input.scale?.mode ?? DEFAULT_COVER_OPTIONS.scale.mode,
      customScale: input.scale?.customScale,
      maintainAspectRatio: input.scale?.maintainAspectRatio ?? DEFAULT_COVER_OPTIONS.scale.maintainAspectRatio,
    },
    placement: {
      horizontal: input.placement?.horizontal ?? DEFAULT_COVER_OPTIONS.placement.horizontal,
      vertical: input.placement?.vertical ?? DEFAULT_COVER_OPTIONS.placement.vertical,
      offsetXPt: input.placement?.offsetXPt ?? DEFAULT_COVER_OPTIONS.placement.offsetXPt,
      offsetYPt: input.placement?.offsetYPt ?? DEFAULT_COVER_OPTIONS.placement.offsetYPt,
    },
    pageSelection: {
      target: input.pageSelection?.target ?? DEFAULT_COVER_OPTIONS.pageSelection.target,
      includeFront: input.pageSelection?.includeFront ?? DEFAULT_COVER_OPTIONS.pageSelection.includeFront,
      includeBack: input.pageSelection?.includeBack ?? DEFAULT_COVER_OPTIONS.pageSelection.includeBack,
      includeSpine: input.pageSelection?.includeSpine ?? DEFAULT_COVER_OPTIONS.pageSelection.includeSpine,
      includeFlaps: input.pageSelection?.includeFlaps ?? DEFAULT_COVER_OPTIONS.pageSelection.includeFlaps,
    },
    wrapFold: {
      format: input.wrapFold?.format ?? DEFAULT_COVER_OPTIONS.wrapFold.format,
      foldGuides: input.wrapFold?.foldGuides ?? DEFAULT_COVER_OPTIONS.wrapFold.foldGuides,
      wrapMarginPt: input.wrapFold?.wrapMarginPt ?? DEFAULT_COVER_OPTIONS.wrapFold.wrapMarginPt,
      lapFlapPt: input.wrapFold?.lapFlapPt ?? DEFAULT_COVER_OPTIONS.wrapFold.lapFlapPt,
      glueTabPt: input.wrapFold?.glueTabPt ?? DEFAULT_COVER_OPTIONS.wrapFold.glueTabPt,
      cropMarks: input.wrapFold?.cropMarks ?? DEFAULT_COVER_OPTIONS.wrapFold.cropMarks,
    },
    spine: {
      sheetCount: input.spine?.sheetCount ?? DEFAULT_COVER_OPTIONS.spine.sheetCount,
      pageCount: input.spine?.pageCount,
      signatureCount: input.spine?.signatureCount ?? DEFAULT_COVER_OPTIONS.spine.signatureCount,
      paperGsm: input.spine?.paperGsm ?? DEFAULT_COVER_OPTIONS.spine.paperGsm,
      paperCaliperMm: input.spine?.paperCaliperMm,
      bulkFactor: input.spine?.bulkFactor,
      bindingType: input.spine?.bindingType ?? DEFAULT_COVER_OPTIONS.spine.bindingType,
      boardThicknessMm: input.spine?.boardThicknessMm,
      threadSwellPerSigMm: input.spine?.threadSwellPerSigMm,
      manualSpineWidthMm: input.spine?.manualSpineWidthMm,
    },
    export: {
      dpi: input.export?.dpi ?? DEFAULT_COVER_OPTIONS.export.dpi,
      format: input.export?.format ?? DEFAULT_COVER_OPTIONS.export.format,
      colorMode: input.export?.colorMode ?? DEFAULT_COVER_OPTIONS.export.colorMode,
      quality: input.export?.quality ?? DEFAULT_COVER_OPTIONS.export.quality,
      previewScale: input.export?.previewScale ?? DEFAULT_COVER_OPTIONS.export.previewScale,
    },
    content: {
      title: input.content?.title ?? DEFAULT_COVER_OPTIONS.content.title,
      author: input.content?.author,
      synopsis: input.content?.synopsis,
      coverImageBytes: input.content?.coverImageBytes,
      theme: input.content?.theme ?? DEFAULT_COVER_OPTIONS.content.theme,
    },
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates cover options ensuring numerical bounds and logical consistency.
 */
export function validateCoverOptions(options: unknown): ValidationResult {
  const errors: string[] = [];

  if (!options || typeof options !== 'object') {
    return { valid: false, errors: ['Cover options must be a non-null object'] };
  }

  const opt = options as Partial<CoverOptions>;

  // Validate spine
  if (opt.spine) {
    if (opt.spine.sheetCount !== undefined && opt.spine.sheetCount <= 0) {
      errors.push(`Sheet count must be positive, got ${opt.spine.sheetCount}`);
    }
    if (opt.spine.pageCount !== undefined && opt.spine.pageCount <= 0) {
      errors.push(`Page count must be positive, got ${opt.spine.pageCount}`);
    }
    if (opt.spine.signatureCount !== undefined && opt.spine.signatureCount <= 0) {
      errors.push(`Signature count must be positive, got ${opt.spine.signatureCount}`);
    }
    if (opt.spine.paperGsm !== undefined && opt.spine.paperGsm <= 0) {
      errors.push(`Paper GSM must be positive, got ${opt.spine.paperGsm}`);
    }
    if (opt.spine.paperCaliperMm !== undefined && opt.spine.paperCaliperMm <= 0) {
      errors.push(`Paper caliper must be positive, got ${opt.spine.paperCaliperMm}`);
    }
    if (opt.spine.bulkFactor !== undefined && opt.spine.bulkFactor <= 0) {
      errors.push(`Bulk factor must be positive, got ${opt.spine.bulkFactor}`);
    }
    if (opt.spine.boardThicknessMm !== undefined && opt.spine.boardThicknessMm < 0) {
      errors.push(`Board thickness cannot be negative, got ${opt.spine.boardThicknessMm}`);
    }
    if (opt.spine.bindingType && !['sewn', 'perfect', 'saddle'].includes(opt.spine.bindingType)) {
      errors.push(`Invalid binding type: ${opt.spine.bindingType}`);
    }
  }

  // Validate format
  if (opt.wrapFold?.format && !['single', 'split', 'a4-direct'].includes(opt.wrapFold.format)) {
    errors.push(`Invalid cover format: ${opt.wrapFold.format}`);
  }

  // Validate scale
  if (opt.scale) {
    if (opt.scale.mode && !['fit', 'fill', 'stretch', 'custom'].includes(opt.scale.mode)) {
      errors.push(`Invalid scale mode: ${opt.scale.mode}`);
    }
    if (opt.scale.mode === 'custom' && (opt.scale.customScale === undefined || opt.scale.customScale <= 0)) {
      errors.push('Custom scale mode requires a positive customScale value');
    }
  }

  // Validate placement
  if (opt.placement) {
    if (opt.placement.horizontal && !['left', 'center', 'right'].includes(opt.placement.horizontal)) {
      errors.push(`Invalid horizontal placement: ${opt.placement.horizontal}`);
    }
    if (opt.placement.vertical && !['top', 'center', 'bottom'].includes(opt.placement.vertical)) {
      errors.push(`Invalid vertical placement: ${opt.placement.vertical}`);
    }
  }

  // Validate export
  if (opt.export) {
    if (opt.export.dpi !== undefined && opt.export.dpi <= 0) {
      errors.push(`Export DPI must be positive, got ${opt.export.dpi}`);
    }
    if (opt.export.format && !['pdf', 'png', 'jpg', 'svg'].includes(opt.export.format)) {
      errors.push(`Invalid export format: ${opt.export.format}`);
    }
    if (opt.export.colorMode && !['rgb', 'cmyk', 'grayscale'].includes(opt.export.colorMode)) {
      errors.push(`Invalid color mode: ${opt.export.colorMode}`);
    }
    if (opt.export.quality !== undefined && (opt.export.quality < 0 || opt.export.quality > 1)) {
      errors.push(`Export quality must be between 0.0 and 1.0, got ${opt.export.quality}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
