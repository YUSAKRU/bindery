import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  coverGeometryInput,
  normalizeCoverOptions,
  resolveCoverPageTrim,
  spineInput,
  type CoverOptions,
} from './cover-options';
import { MM_TO_PT } from '../engine/cover-engine';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const appSource = readFileSync(appTsPath, 'utf-8');

const i18nPath = fileURLToPath(new URL('../i18n/index.ts', import.meta.url));
const i18nSource = readFileSync(i18nPath, 'utf-8');

describe('CoverOptions - normalizeCoverOptions', () => {
  const bindings = ['saddle', 'sewn', 'perfect'] as const;
  const kinds = ['softcover', 'hardcover'] as const;
  const papers = ['split', 'single'] as const;

  // Test all 3 x 2 x 2 = 12 combinations
  for (const binding of bindings) {
    for (const kind of kinds) {
      for (const paper of papers) {
        it(`normalizes binding=${binding}, kind=${kind}, paper=${paper}`, () => {
          const input: CoverOptions = {
            binding,
            kind,
            paper,
            boardMm: 2.0,
            gsm: 80,
            theme: 'cream',
          };
          const normalized = normalizeCoverOptions(input);

          // Paper format is always preserved
          expect(normalized.paper).toBe(paper);
          // Binding is preserved
          expect(normalized.binding).toBe(binding);
          // Saddle stitch must always be softcover
          if (binding === 'saddle') {
            expect(normalized.kind).toBe('softcover');
          } else {
            expect(normalized.kind).toBe(kind);
          }
          expect(normalized.boardMm).toBe(2.0);
          expect(normalized.gsm).toBe(80);
          expect(normalized.theme).toBe('cream');
        });
      }
    }
  }

  it('clamps invalid board thickness to 2.0 default', () => {
    const opt = normalizeCoverOptions({
      binding: 'sewn',
      kind: 'hardcover',
      paper: 'split',
      boardMm: 3.5 as unknown as 1.5 | 2.0 | 2.5,
      gsm: 80,
      theme: 'cream',
    });
    expect(opt.boardMm).toBe(2.0);
  });
});

describe('CoverOptions - spineInput', () => {
  it('only passes boardThicknessMm when kind is hardcover', () => {
    const hard: CoverOptions = {
      binding: 'sewn',
      kind: 'hardcover',
      paper: 'single',
      boardMm: 2.5,
      gsm: 90,
      theme: 'navy',
    };
    const soft: CoverOptions = {
      binding: 'sewn',
      kind: 'softcover',
      paper: 'split',
      boardMm: 2.5,
      gsm: 90,
      theme: 'navy',
    };
    const saddleHard: CoverOptions = {
      binding: 'saddle',
      kind: 'hardcover',
      paper: 'split',
      boardMm: 2.5,
      gsm: 80,
      theme: 'cream',
    };

    expect(spineInput(hard, 20, 5).boardThicknessMm).toBe(2.5);
    expect(spineInput(soft, 20, 5).boardThicknessMm).toBeUndefined();
    // Saddle stitch normalized to softcover, so boardThicknessMm must be undefined
    expect(spineInput(saddleHard, 20, 5).boardThicknessMm).toBeUndefined();
  });

  it('forces signatureCount to 1 for saddle binding and enforces minimum 1 sheet', () => {
    const opt: CoverOptions = {
      binding: 'saddle',
      kind: 'softcover',
      paper: 'split',
      boardMm: 2.0,
      gsm: 80,
      theme: 'cream',
    };
    const res = spineInput(opt, 0, 8);
    expect(res.sheetCount).toBe(1);
    expect(res.signatureCount).toBe(1);
    expect(res.bindingType).toBe('saddle');
  });
});

describe('CoverOptions - coverGeometryInput', () => {
  it('computes softcover allowances: bleed 3 mm, wrapMargin 0 mm', () => {
    const opt: CoverOptions = {
      binding: 'sewn',
      kind: 'softcover',
      paper: 'split',
      boardMm: 2.0,
      gsm: 80,
      theme: 'cream',
    };
    const dim = coverGeometryInput(opt, 300, 400, 20);
    expect(dim.pageWidthPt).toBe(300);
    expect(dim.pageHeightPt).toBe(400);
    expect(dim.spineWidthPt).toBe(20);
    expect(dim.bleedPt).toBeCloseTo(3 * MM_TO_PT, 3);
    expect(dim.wrapMarginPt).toBe(0);
    expect(dim.format).toBe('split');
  });

  it('computes hardcover allowances: bleed 0 mm, wrapMargin 15 mm', () => {
    const opt: CoverOptions = {
      binding: 'perfect',
      kind: 'hardcover',
      paper: 'single',
      boardMm: 1.5,
      gsm: 100,
      theme: 'burgundy',
    };
    const dim = coverGeometryInput(opt, 300, 400, 20);
    expect(dim.bleedPt).toBe(0);
    expect(dim.wrapMarginPt).toBeCloseTo(15 * MM_TO_PT, 3);
    expect(dim.format).toBe('single');
  });

  it('forces softcover allowances for saddle stitch even if kind was hardcover', () => {
    const opt: CoverOptions = {
      binding: 'saddle',
      kind: 'hardcover',
      paper: 'split',
      boardMm: 2.0,
      gsm: 80,
      theme: 'cream',
    };
    const dim = coverGeometryInput(opt, 300, 400, 20);
    expect(dim.bleedPt).toBeCloseTo(3 * MM_TO_PT, 3);
    expect(dim.wrapMarginPt).toBe(0);
  });
});

describe('CoverOptions - resolveCoverPageTrim', () => {
  it('resolves A4 sheet size to A5 trim with isSupported true', () => {
    // 210 x 297 mm
    const a4W = (210 * 72) / 25.4;
    const a4H = (297 * 72) / 25.4;
    expect(resolveCoverPageTrim(a4W, a4H)).toEqual({ trim: 'A5', isSupported: true });
    expect(resolveCoverPageTrim(a4H, a4W)).toEqual({ trim: 'A5', isSupported: true });
  });

  it('resolves A3 sheet size to A4 trim with isSupported true', () => {
    // 297 x 420 mm
    const a3W = (297 * 72) / 25.4;
    const a3H = (420 * 72) / 25.4;
    expect(resolveCoverPageTrim(a3W, a3H)).toEqual({ trim: 'A4', isSupported: true });
    expect(resolveCoverPageTrim(a3H, a3W)).toEqual({ trim: 'A4', isSupported: true });
  });

  it('resolves Letter sheet size to A5 trim with isSupported false', () => {
    // 8.5 x 11 in -> 612 x 792 pt
    expect(resolveCoverPageTrim(612, 792)).toEqual({ trim: 'A5', isSupported: false });
  });

  it('resolves A5 sheet size to A5 trim with isSupported false', () => {
    // 148 x 210 mm
    const a5W = (148 * 72) / 25.4;
    const a5H = (210 * 72) / 25.4;
    expect(resolveCoverPageTrim(a5W, a5H)).toEqual({ trim: 'A5', isSupported: false });
  });

  it('resolves custom source size to A5 trim with isSupported false', () => {
    expect(resolveCoverPageTrim(500, 700)).toEqual({ trim: 'A5', isSupported: false });
  });
});

describe('CoverOptions - Cross-flow consistency', () => {
  it('produces identical geometry inputs for the same options across both flows', () => {
    const testOptions: CoverOptions[] = [
      { paper: 'split', kind: 'softcover', binding: 'sewn', boardMm: 2.0, gsm: 80, theme: 'cream' },
      { paper: 'single', kind: 'softcover', binding: 'saddle', boardMm: 2.0, gsm: 80, theme: 'cream' },
      { paper: 'split', kind: 'hardcover', binding: 'sewn', boardMm: 2.5, gsm: 100, theme: 'navy' },
      { paper: 'single', kind: 'hardcover', binding: 'perfect', boardMm: 1.5, gsm: 120, theme: 'charcoal' },
    ];

    for (const opt of testOptions) {
      const pageWidth = 300;
      const pageHeight = 420;
      const spinePt = 18.5;

      const geom = coverGeometryInput(opt, pageWidth, pageHeight, spinePt);
      const spine = spineInput(opt, 32, 4);

      expect(geom.pageWidthPt).toBe(pageWidth);
      expect(geom.pageHeightPt).toBe(pageHeight);
      expect(geom.spineWidthPt).toBe(spinePt);
      expect(geom.format).toBe(opt.paper);
      if (opt.kind === 'hardcover' && opt.binding !== 'saddle') {
        expect(geom.bleedPt).toBe(0);
        expect(geom.wrapMarginPt).toBeCloseTo(15 * MM_TO_PT, 3);
        expect(spine.boardThicknessMm).toBe(opt.boardMm);
      } else {
        expect(geom.bleedPt).toBeCloseTo(3 * MM_TO_PT, 3);
        expect(geom.wrapMarginPt).toBe(0);
        expect(spine.boardThicknessMm).toBeUndefined();
      }
    }
  });

  it('both call sites in app.ts route through coverGeometryInput and spineInput without local allowance literals', () => {
    const wrapCoverFn = appSource.slice(
      appSource.indexOf('function wrapCoverGeometry('),
      appSource.indexOf('function applyWrapCoverKindHint('),
    );
    expect(wrapCoverFn).toContain('spineInput(options, sheets, signatures)');
    expect(wrapCoverFn).toContain('coverGeometryInput(');
    expect(wrapCoverFn).not.toContain('3 * MM_TO_PT');
    expect(wrapCoverFn).not.toContain('15 * MM_TO_PT');
    expect(wrapCoverFn).not.toContain('WRAP_COVER_BOARD_MM');

    const coverLiveFn = appSource.slice(
      appSource.indexOf('function updateCoverLiveCalculations('),
      appSource.indexOf('function updateCoverPreviewVisuals('),
    );
    expect(coverLiveFn).toContain('spineInput(options, coverSheetCount, coverSigCount)');
    expect(coverLiveFn).toContain('coverGeometryInput(');
    expect(coverLiveFn).not.toContain('3 * MM_TO_PT');
    expect(coverLiveFn).not.toContain('15 * MM_TO_PT');

    const generateHandler = appSource.slice(
      appSource.indexOf("coverGenerateBtn.addEventListener('click'"),
      appSource.indexOf('const coverSaveFlow', appSource.indexOf("coverGenerateBtn.addEventListener('click'")),
    );
    expect(generateHandler).toContain('spineInput(options, coverSheetCount, coverSigCount)');
    expect(generateHandler).toContain('coverGeometryInput(');
  });
});

describe('CoverOptions - Handoff', () => {
  it('passes entire CoverOptions and metadata when wrap cover is on', () => {
    const handoff = appSource.slice(
      appSource.indexOf("resultOpenCoverStudioBtn.addEventListener('click'"),
      appSource.indexOf('let readerResizeTimer'),
    );
    expect(handoff).toContain('targetOptions = getBookletCoverOptions()');
    expect(handoff).toContain('coverBindingType = targetOptions.binding');
    expect(handoff).toContain('coverCoverStyle = targetOptions.kind');
    expect(handoff).toContain('coverBoardThicknessMm = targetOptions.boardMm');
    expect(handoff).toContain('coverPaperGsm = targetOptions.gsm');
    expect(handoff).toContain('coverTheme = targetOptions.theme');
    expect(handoff).toContain('coverFormat = targetOptions.paper');
    expect(handoff).toContain('coverAuthorInput.value = wrapCoverAuthorInput.value');
    expect(handoff).toContain('coverSynopsisInput.value = wrapCoverSynopsisInput.value');
  });

  it('infers binding from imposition when wrap cover is off and normalizes', () => {
    const handoff = appSource.slice(
      appSource.indexOf("resultOpenCoverStudioBtn.addEventListener('click'"),
      appSource.indexOf('let readerResizeTimer'),
    );
    expect(handoff).toContain("const isSingle = bookletSignature === 'single'");
    expect(handoff).toContain("targetOptions = normalizeCoverOptions");
    expect(handoff).toContain("binding: isSingle ? 'saddle' : 'sewn'");
  });

  it('resolves sheet size to trim and controls unsupported hint visibility', () => {
    const handoff = appSource.slice(
      appSource.indexOf("resultOpenCoverStudioBtn.addEventListener('click'"),
      appSource.indexOf('let readerResizeTimer'),
    );
    expect(handoff).toContain('const [sheetW, sheetH] = wrapCoverSheetSize()');
    expect(handoff).toContain('const trimResult = resolveCoverPageTrim(sheetW, sheetH)');
    expect(handoff).toContain('coverPageTrim = trimResult.trim');
    expect(handoff).toContain("setActiveSegment(coverPageTrimGroup, 'trim', coverPageTrim)");
    expect(handoff).toContain("coverTrimUnsupportedHint.classList.toggle('hidden', trimResult.isSupported)");
  });
});

describe('CoverOptions - UI Invariants & Voice', () => {
  it('presents the same three questions in the same order in both flows', () => {
    const bookletBindingIdx = htmlSource.indexOf('id="wrapCoverBindingGroup"');
    const bookletKindIdx = htmlSource.indexOf('id="wrapCoverKindGroup"');
    const bookletFormatIdx = htmlSource.indexOf('id="wrapCoverFormatGroup"');
    expect(bookletBindingIdx).toBeGreaterThan(0);
    expect(bookletKindIdx).toBeGreaterThan(bookletBindingIdx);
    expect(bookletFormatIdx).toBeGreaterThan(bookletKindIdx);

    const studioBindingIdx = htmlSource.indexOf('id="coverBindingGroup"');
    const studioKindIdx = htmlSource.indexOf('id="coverKindGroup"');
    const studioFormatIdx = htmlSource.indexOf('id="coverFormatGroup"');
    expect(studioBindingIdx).toBeGreaterThan(0);
    expect(studioKindIdx).toBeGreaterThan(studioBindingIdx);
    expect(studioFormatIdx).toBeGreaterThan(studioKindIdx);
  });

  it('does not contain hardcover in wrapCoverBindingGroup', () => {
    const bindingGroup = htmlSource.slice(
      htmlSource.indexOf('id="wrapCoverBindingGroup"'),
      htmlSource.indexOf('id="wrapCoverBindingHint"'),
    );
    expect(bindingGroup).not.toContain('hardcover');
  });

  it('has completely removed coverStyleGroup', () => {
    expect(htmlSource).not.toContain('id="coverStyleGroup"');
    expect(htmlSource).not.toContain('coverStyleGroup');
    expect(appSource).not.toContain('coverStyleGroup');
  });

  it('provides board thickness 1.5, 2.0, 2.5 in both flows', () => {
    const bookletBoard = htmlSource.slice(
      htmlSource.indexOf('id="wrapCoverBoardGroup"'),
      htmlSource.indexOf('id="wrapCoverFormatGroup"'),
    );
    expect(bookletBoard).toContain('data-wrapboard="1.5"');
    expect(bookletBoard).toContain('data-wrapboard="2.0"');
    expect(bookletBoard).toContain('data-wrapboard="2.5"');
    expect(bookletBoard).not.toContain('data-wrapboard="3.0"');

    const studioBoard = htmlSource.slice(
      htmlSource.indexOf('id="coverBoardGroup"'),
      htmlSource.indexOf('id="coverPageTrimGroup"'),
    );
    expect(studioBoard).toContain('data-board="1.5"');
    expect(studioBoard).toContain('data-board="2.0"');
    expect(studioBoard).toContain('data-board="2.5"');
    expect(studioBoard).not.toContain('data-board="3.0"');
  });

  it('never uses forbidden words in cover labels or hints in HTML or i18n', () => {
    expect(htmlSource).not.toContain('(Karton)');
    expect(htmlSource).not.toContain('(Mukavva)');
    expect(htmlSource).not.toMatch(/ozalit/i);

    expect(i18nSource).not.toContain('(Karton)');
    expect(i18nSource).not.toContain('(Mukavva)');
    expect(i18nSource).not.toMatch(/ozalit/i);

    const coverSectionEn = i18nSource.slice(
      i18nSource.indexOf("'cover.coverKind'"),
      i18nSource.indexOf("'cover.trimUnsupportedHint'"),
    );
    expect(coverSectionEn).not.toMatch(/\bcreate\b/i);

    const coverSectionTr = i18nSource.slice(
      i18nSource.lastIndexOf("'cover.coverKind'"),
      i18nSource.lastIndexOf("'cover.trimUnsupportedHint'"),
    );
    expect(coverSectionTr).not.toMatch(/\byarat/i);
    expect(coverSectionTr).not.toMatch(/\boluştur/i);
  });
});
