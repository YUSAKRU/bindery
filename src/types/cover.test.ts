import { describe, expect, it } from 'vitest';
import {
  calculateCoverSpine,
  createCoverOptions,
  DEFAULT_COVER_OPTIONS,
  MM_TO_PT,
  PAPER_CALIPERS_MM,
  resolvePaperDimensions,
  STANDARD_PAPER_SIZES_PT,
  validateCoverOptions,
  type CoverOptionsInput,
} from './cover';
import { BookletError } from '../engine/types';

describe('PAPER_CALIPERS_MM table', () => {
  it('contains calibrated thicknesses for 70, 80, 90, 100, and 120 GSM', () => {
    expect(PAPER_CALIPERS_MM[70]).toBe(0.090);
    expect(PAPER_CALIPERS_MM[80]).toBe(0.100);
    expect(PAPER_CALIPERS_MM[90]).toBe(0.115);
    expect(PAPER_CALIPERS_MM[100]).toBe(0.130);
    expect(PAPER_CALIPERS_MM[120]).toBe(0.155);
  });
});

describe('CoverOptions - Defaults & Creation', () => {
  it('provides complete canonical defaults in DEFAULT_COVER_OPTIONS', () => {
    expect(DEFAULT_COVER_OPTIONS.paper.size).toBe('A4');
    expect(DEFAULT_COVER_OPTIONS.paper.bleed.top).toBe(9);
    expect(DEFAULT_COVER_OPTIONS.scale.mode).toBe('fit');
    expect(DEFAULT_COVER_OPTIONS.scale.maintainAspectRatio).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.placement.horizontal).toBe('center');
    expect(DEFAULT_COVER_OPTIONS.placement.vertical).toBe('center');
    expect(DEFAULT_COVER_OPTIONS.pageSelection.target).toBe('spread');
    expect(DEFAULT_COVER_OPTIONS.pageSelection.includeFront).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.pageSelection.includeBack).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.pageSelection.includeSpine).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.wrapFold.format).toBe('split');
    expect(DEFAULT_COVER_OPTIONS.wrapFold.foldGuides).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.wrapFold.cropMarks).toBe(true);
    expect(DEFAULT_COVER_OPTIONS.spine.sheetCount).toBe(16);
    expect(DEFAULT_COVER_OPTIONS.spine.paperGsm).toBe(80);
    expect(DEFAULT_COVER_OPTIONS.spine.bindingType).toBe('sewn');
    expect(DEFAULT_COVER_OPTIONS.export.dpi).toBe(300);
    expect(DEFAULT_COVER_OPTIONS.export.format).toBe('pdf');
    expect(DEFAULT_COVER_OPTIONS.content.theme).toBe('cream');
  });

  it('createCoverOptions returns a deep clone when no overrides given', () => {
    const opts = createCoverOptions();
    expect(opts).toEqual(DEFAULT_COVER_OPTIONS);
    // Ensure deep clone independence
    opts.paper.margins.top = 20;
    expect(DEFAULT_COVER_OPTIONS.paper.margins.top).toBe(0);
  });

  it('merges partial overrides across multiple sections', () => {
    const overrides: CoverOptionsInput = {
      paper: {
        size: 'A5',
        margins: { top: 12, bottom: 12, left: 10, right: 10 },
      },
      scale: {
        mode: 'custom',
        customScale: 0.85,
      },
      wrapFold: {
        format: 'a4-direct',
        foldGuides: false,
      },
      spine: {
        sheetCount: 24,
        paperGsm: 100,
        bindingType: 'perfect',
      },
      export: {
        dpi: 600,
        format: 'png',
      },
      content: {
        title: 'Unified Model Book',
        author: 'Bindery Team',
      },
    };

    const result = createCoverOptions(overrides);
    expect(result.paper.size).toBe('A5');
    expect(result.paper.margins.top).toBe(12);
    expect(result.paper.bleed.top).toBe(DEFAULT_COVER_OPTIONS.paper.bleed.top); // preserves default
    expect(result.scale.mode).toBe('custom');
    expect(result.scale.customScale).toBe(0.85);
    expect(result.scale.maintainAspectRatio).toBe(true); // preserves default
    expect(result.wrapFold.format).toBe('a4-direct');
    expect(result.wrapFold.foldGuides).toBe(false);
    expect(result.spine.sheetCount).toBe(24);
    expect(result.spine.paperGsm).toBe(100);
    expect(result.spine.bindingType).toBe('perfect');
    expect(result.export.dpi).toBe(600);
    expect(result.export.format).toBe('png');
    expect(result.content.title).toBe('Unified Model Book');
    expect(result.content.author).toBe('Bindery Team');
  });
});

describe('CoverOptions - Validation', () => {
  it('validates default options successfully', () => {
    const res = validateCoverOptions(DEFAULT_COVER_OPTIONS);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects non-object inputs', () => {
    expect(validateCoverOptions(null).valid).toBe(false);
    expect(validateCoverOptions(undefined).valid).toBe(false);
    expect(validateCoverOptions('string').valid).toBe(false);
  });

  it('detects invalid spine numerical parameters', () => {
    const res = validateCoverOptions({
      spine: {
        sheetCount: 0,
        pageCount: -4,
        signatureCount: -1,
        paperGsm: -80,
        paperCaliperMm: -0.1,
        bulkFactor: -1.2,
        boardThicknessMm: -2,
        bindingType: 'invalid-type' as any,
      },
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Sheet count must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Page count must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Signature count must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Paper GSM must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Paper caliper must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Bulk factor must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Board thickness cannot be negative'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Invalid binding type'))).toBe(true);
  });

  it('detects invalid format, scale mode, and placement options', () => {
    const res = validateCoverOptions({
      wrapFold: { format: 'unsupported' as any },
      scale: { mode: 'custom', customScale: 0 },
      placement: { horizontal: 'diagonal' as any, vertical: 'middle' as any },
      export: { dpi: 0, format: 'bmp' as any, colorMode: 'cmyk2' as any, quality: 1.5 },
    });

    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Invalid cover format'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Custom scale mode requires a positive customScale'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Invalid horizontal placement'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Invalid vertical placement'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Export DPI must be positive'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Invalid export format'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Invalid color mode'))).toBe(true);
    expect(res.errors.some((e) => e.includes('Export quality must be between 0.0 and 1.0'))).toBe(true);
  });
});

describe('CoverSpine - calculateCoverSpine', () => {
  it('throws BookletError on non-positive sheetCount', () => {
    expect(() =>
      calculateCoverSpine({ sheetCount: 0, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
    expect(() =>
      calculateCoverSpine({ sheetCount: -5, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
  });

  it('throws BookletError on non-positive pageCount', () => {
    expect(() =>
      calculateCoverSpine({ pageCount: 0, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
    expect(() =>
      calculateCoverSpine({ pageCount: -12, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' }),
    ).toThrow(BookletError);
  });

  it('throws BookletError on non-positive signatureCount', () => {
    expect(() =>
      calculateCoverSpine({ sheetCount: 10, signatureCount: 0, paperGsm: 80, bindingType: 'sewn' }),
    ).toThrow(BookletError);
  });

  it('derives sheet count correctly from pageCount for folded signatures (sewn/saddle)', () => {
    // 32 pages folded in half = 8 sheets (4 pages per sheet)
    const sewnResult = calculateCoverSpine({ pageCount: 32, paperGsm: 80, bindingType: 'sewn' });
    expect(sewnResult.sheetCount).toBe(8);

    // 33 pages ceiling rounds to 9 sheets
    const oddResult = calculateCoverSpine({ pageCount: 33, paperGsm: 80, bindingType: 'sewn' });
    expect(oddResult.sheetCount).toBe(9);
  });

  it('derives sheet count correctly from pageCount for cut-sheet perfect binding (2 pages/sheet)', () => {
    // 32 pages duplex cut-sheets = 16 sheets
    const perfectResult = calculateCoverSpine({ pageCount: 32, paperGsm: 80, bindingType: 'perfect' });
    expect(perfectResult.sheetCount).toBe(16);

    // 33 pages ceiling rounds to 17 sheets
    const oddResult = calculateCoverSpine({ pageCount: 33, paperGsm: 80, bindingType: 'perfect' });
    expect(oddResult.sheetCount).toBe(17);
  });

  it('explicit sheetCount takes precedence over pageCount', () => {
    const res = calculateCoverSpine({ sheetCount: 10, pageCount: 80, paperGsm: 80, bindingType: 'perfect' });
    expect(res.sheetCount).toBe(10);
  });

  it('uses direct paperCaliperMm when provided, overriding GSM lookup', () => {
    const res = calculateCoverSpine({
      sheetCount: 20,
      signatureCount: 5,
      paperGsm: 80, // normally 0.100 mm
      paperCaliperMm: 0.145, // direct override
      bindingType: 'perfect',
    });

    expect(res.effectiveCaliperMm).toBe(0.145);
    expect(res.textBlockThicknessMm).toBeCloseTo(20 * 0.145, 6);
  });

  it('calculates caliper from bulkFactor and paperGsm: (GSM * bulk) / 1000', () => {
    // 80 gsm * 1.5 bulk = 120 / 1000 = 0.120 mm
    const res = calculateCoverSpine({
      sheetCount: 10,
      signatureCount: 2,
      paperGsm: 80,
      bulkFactor: 1.5,
      bindingType: 'sewn',
    });

    expect(res.effectiveCaliperMm).toBeCloseTo(0.120, 6);
    expect(res.textBlockThicknessMm).toBeCloseTo(10 * 0.120, 6);
  });

  it('calculates thread swell for sewn signatures and zero for saddle / perfect', () => {
    const sewn = calculateCoverSpine({ sheetCount: 16, signatureCount: 4, paperGsm: 80, bindingType: 'sewn' });
    expect(sewn.threadSwellMm).toBeCloseTo(4 * 0.15, 6);

    const saddle = calculateCoverSpine({ sheetCount: 16, signatureCount: 4, paperGsm: 80, bindingType: 'saddle' });
    expect(saddle.threadSwellMm).toBe(0);

    const perfect = calculateCoverSpine({ sheetCount: 16, signatureCount: 4, paperGsm: 80, bindingType: 'perfect' });
    expect(perfect.threadSwellMm).toBe(0);
  });

  it('supports custom threadSwellPerSigMm rate', () => {
    const res = calculateCoverSpine({
      sheetCount: 20,
      signatureCount: 5,
      paperGsm: 80,
      bindingType: 'sewn',
      threadSwellPerSigMm: 0.20,
    });
    expect(res.threadSwellMm).toBeCloseTo(5 * 0.20, 6);
  });

  it('calculates hinge allowance for softcover bindings correctly', () => {
    const saddle = calculateCoverSpine({ sheetCount: 10, signatureCount: 1, paperGsm: 80, bindingType: 'saddle' });
    expect(saddle.hingeAllowanceMm).toBe(0);

    const sewn = calculateCoverSpine({ sheetCount: 10, signatureCount: 1, paperGsm: 80, bindingType: 'sewn' });
    expect(sewn.hingeAllowanceMm).toBe(1.0);

    const perfect = calculateCoverSpine({ sheetCount: 10, signatureCount: 1, paperGsm: 80, bindingType: 'perfect' });
    expect(perfect.hingeAllowanceMm).toBe(1.5);
  });

  it('boardThicknessMm overrides hinge allowance as 2 * board + 7 regardless of bindingType', () => {
    const boardMm = 2.5;
    const expectedHinge = 2 * 2.5 + 7.0; // 12.0 mm

    const sewn = calculateCoverSpine({
      sheetCount: 10,
      signatureCount: 2,
      paperGsm: 80,
      bindingType: 'sewn',
      boardThicknessMm: boardMm,
    });
    expect(sewn.hingeAllowanceMm).toBeCloseTo(expectedHinge, 6);

    const perfect = calculateCoverSpine({
      sheetCount: 10,
      signatureCount: 2,
      paperGsm: 80,
      bindingType: 'perfect',
      boardThicknessMm: boardMm,
    });
    expect(perfect.hingeAllowanceMm).toBeCloseTo(expectedHinge, 6);
  });

  it('manualSpineWidthMm directly overrides the computed total spine width', () => {
    const res = calculateCoverSpine({
      sheetCount: 10,
      signatureCount: 2,
      paperGsm: 80,
      bindingType: 'sewn',
      manualSpineWidthMm: 15.0,
    });

    expect(res.totalSpineWidthMm).toBe(15.0);
    expect(res.totalSpineWidthPt).toBeCloseTo(15.0 * MM_TO_PT, 6);
  });

  it('evaluates canPrintSpineText against the 3.5 mm legibility floor', () => {
    // 10 sheets of 70gsm saddle = 10 * 0.090 = 0.9 mm (< 3.5 mm)
    const small = calculateCoverSpine({ sheetCount: 10, signatureCount: 1, paperGsm: 70, bindingType: 'saddle' });
    expect(small.totalSpineWidthMm).toBeLessThan(3.5);
    expect(small.canPrintSpineText).toBe(false);

    // 50 sheets of 100gsm sewn = 50 * 0.130 + 10 * 0.15 + 1.0 = 6.5 + 1.5 + 1.0 = 9.0 mm (> 3.5 mm)
    const large = calculateCoverSpine({ sheetCount: 50, signatureCount: 10, paperGsm: 100, bindingType: 'sewn' });
    expect(large.totalSpineWidthMm).toBeGreaterThanOrEqual(3.5);
    expect(large.canPrintSpineText).toBe(true);
  });

  it('converts totalSpineWidthPt using MM_TO_PT accurately', () => {
    const res = calculateCoverSpine({ sheetCount: 30, signatureCount: 6, paperGsm: 90, bindingType: 'sewn' });
    expect(res.totalSpineWidthPt).toBeCloseTo(res.totalSpineWidthMm * MM_TO_PT, 8);
  });
});

describe('resolvePaperDimensions', () => {
  it('resolves standard preset sizes correctly', () => {
    expect(resolvePaperDimensions('A4')).toEqual(STANDARD_PAPER_SIZES_PT.A4);
    expect(resolvePaperDimensions('A3')).toEqual(STANDARD_PAPER_SIZES_PT.A3);
    expect(resolvePaperDimensions('A5')).toEqual(STANDARD_PAPER_SIZES_PT.A5);
    expect(resolvePaperDimensions('Letter')).toEqual(STANDARD_PAPER_SIZES_PT.Letter);
    expect(resolvePaperDimensions('source')).toEqual(STANDARD_PAPER_SIZES_PT.A4);
  });

  it('resolves custom dimensions in pt, mm, and in', () => {
    const inPt = resolvePaperDimensions({ width: 500, height: 700, unit: 'pt' });
    expect(inPt.width).toBe(500);
    expect(inPt.height).toBe(700);

    const inMm = resolvePaperDimensions({ width: 200, height: 300, unit: 'mm' });
    expect(inMm.width).toBeCloseTo(200 * MM_TO_PT, 5);
    expect(inMm.height).toBeCloseTo(300 * MM_TO_PT, 5);

    const inInches = resolvePaperDimensions({ width: 8.5, height: 11, unit: 'in' });
    expect(inInches.width).toBeCloseTo(8.5 * 72, 5);
    expect(inInches.height).toBeCloseTo(11 * 72, 5);
  });
});
