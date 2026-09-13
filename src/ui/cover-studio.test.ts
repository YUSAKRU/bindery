import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { t, setLanguage } from '../i18n';
import {
  A4_LONG_EDGE_MM,
  computeSpineWidth,
  computeCoverDimensions,
  computeSplitCoverDimensions,
  MM_TO_PT,
  type PaperGsm,
} from '../engine/cover-engine';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const appSource = readFileSync(appTsPath, 'utf-8');

const i18nPath = fileURLToPath(new URL('../i18n/index.ts', import.meta.url));
const i18nSource = readFileSync(i18nPath, 'utf-8');

describe('Cover Studio - UI & DOM Invariants', () => {
  it('contains screen-cover and screen-cover-result in index.html', () => {
    expect(htmlSource).toContain('id="screen-cover"');
    expect(htmlSource).toContain('id="screen-cover-result"');
  });

  it('contains Cover Studio navigation in tools menu, hub carousel, and result screen', () => {
    expect(htmlSource).toContain('data-tool="cover"');
    expect(htmlSource).toContain('id="resultOpenCoverStudioBtn"');
  });

  it('contains all required Cover Studio input and preview elements', () => {
    const requiredIds = [
      'coverSourceModeGroup',
      'coverPdfSourceCard',
      'coverPickPdfBtn',
      'coverPdfBadge',
      'coverClearPdfBtn',
      'coverManualCountsCard',
      'coverSheetCountInput',
      'coverSigCountRow',
      'coverSigCountInput',
      'coverTitleInput',
      'coverAuthorInput',
      'coverSynopsisInput',
      'coverPickImageBtn',
      'coverRemoveImageBtn',
      'coverPreviewThumbImg',
      'coverGsmGroup',
      'coverBindingGroup',
      'coverKindGroup',
      'coverBoardThicknessBlock',
      'coverBoardGroup',
      'coverPageTrimGroup',
      'coverSpineWidthLabel',
      'coverTotalDimensionsLabel',
      'coverSpineFitBadge',
      'coverGenerateBtn',
      'coverBackPreview',
      'coverSpinePreview',
      'coverFrontPreview',
      'coverFormatGroup',
      'coverFormatHint',
      'coverPreviewHeading',
      'coverSplitPreview',
      'coverSplitSheet1Preview',
      'coverSplitSheet2Preview',
      'coverSplitSpinePreview',
      'coverSplitFlapPreview',
      'coverSplitTabPreview',
      'coverSplitSynopsisText',
      'coverSplitSpineText',
      'coverSplitThumbImg',
      'coverSplitTitleText',
      'coverSplitAuthorText',
    ];

    for (const id of requiredIds) {
      expect(htmlSource, `expected #${id} to exist in index.html`).toContain(`id="${id}"`);
    }
  });

  it('contains all required Cover Result screen elements', () => {
    const resultIds = [
      'coverResultSpineStat',
      'coverResultDimStat',
      'coverFileNameInput',
      'coverSaveBtn',
      'coverShareBtn',
      'coverGoToLocationBtn',
      'coverNewBtn',
      'coverResultBreakdownCard',
      'coverResultSheet1Line',
      'coverResultSheet2Line',
    ];

    for (const id of resultIds) {
      expect(htmlSource, `expected #${id} to exist in index.html`).toContain(`id="${id}"`);
    }
  });

  it('registers cover screens and navigation wiring in app.ts', () => {
    expect(appSource).toContain("cover: byId('screen-cover')");
    expect(appSource).toContain("'cover-result': byId('screen-cover-result')");
    expect(appSource).toContain("} else if (id === 'cover') {");
    expect(appSource).toContain("'status.cover.saved'");
  });
});

describe('Cover Studio - Localization Coverage', () => {
  beforeAll(() => {
    let mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('document', {
      documentElement: { lang: 'en' },
      querySelectorAll: () => [],
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const requiredKeys = [
    'tool.cover.title',
    'tool.cover.desc',
    'screenTitle.cover',
    'screenTitle.coverResult',
    'status.cover.saved',
    'booklet.openCoverStudio',
    'cover.heroTitle',
    'cover.heroSubtitle',
    'cover.sourceMode',
    'cover.sourcePdf',
    'cover.sourceManual',
    'cover.pickPdf',
    'cover.pdfDetected',
    'cover.sheetCount',
    'cover.sigCount',
    'cover.contentTitle',
    'cover.bookTitle',
    'cover.bookTitlePlaceholder',
    'cover.author',
    'cover.authorPlaceholder',
    'cover.synopsis',
    'cover.synopsisPlaceholder',
    'cover.artTitle',
    'cover.pickImage',
    'cover.removeImage',
    'cover.imageSelected',
    'cover.noImage',
    'cover.colorTheme',
    'cover.themeCream',
    'cover.themeWhite',
    'cover.themeNavy',
    'cover.themeBurgundy',
    'cover.themeCharcoal',
    'cover.specsTitle',
    'cover.paperGsm',
    'cover.bindingStyle',
    'cover.bindingSaddle',
    'cover.bindingSewn',
    'cover.bindingPerfect',
    'cover.coverKind',
    'cover.kindSoft',
    'cover.kindHard',
    'cover.boardThickness',
    'cover.pageTrim',
    'cover.spineCalcTitle',
    'cover.calculatedSpine',
    'cover.paperBulk',
    'cover.threadSwell',
    'cover.hingeAllowance',
    'cover.totalDimensions',
    'cover.spineTextFit',
    'cover.spineTextTooNarrow',
    'cover.generateBtn',
    'cover.generating',
    'cover.coverPdf',
    'cover.formatTitle',
    'cover.formatSplit',
    'cover.formatSingle',
    'cover.formatSplitHint',
    'cover.formatSingleHint',
    'cover.previewTitle',
    'cover.previewTitleSplit',
    'cover.previewSheet1',
    'cover.previewSheet2',
    'cover.previewFlap',
    'cover.previewTab',
    'cover.totalDimensionsSplit',
    'cover.dimStatSplit',
    'cover.splitSheet1Desc',
    'cover.splitSheet2Desc',
    'cover.sheetBreakdown',
  ];

  it('defines all required Cover Studio keys in English dictionary', () => {
    setLanguage('en');
    for (const key of requiredKeys) {
      const translated = t(key);
      expect(translated, `Missing EN translation for key: ${key}`).not.toBe(key);
      expect(translated.length).toBeGreaterThan(0);
    }
  });

  it('defines all required Cover Studio keys in Turkish dictionary', () => {
    setLanguage('tr');
    for (const key of requiredKeys) {
      const translated = t(key);
      expect(translated, `Missing TR translation for key: ${key}`).not.toBe(key);
      expect(translated.length).toBeGreaterThan(0);
    }
  });
});

describe('Cover Studio - Calculations & Specs Integration', () => {
  it('correctly calculates spine for saddle stitch booklets', () => {
    const sheets = 16;
    const gsm: PaperGsm = 80;

    const spine = computeSpineWidth({
      sheetCount: sheets,
      paperGsm: gsm,
      bindingType: 'saddle',
      signatureCount: 1,
    });

    // Saddle stitch spine is paper bulk only (16 * 0.100 = 1.6 mm)
    expect(spine.textBlockThicknessMm).toBeCloseTo(1.6, 2);
    expect(spine.threadSwellMm).toBe(0);
    expect(spine.hingeAllowanceMm).toBe(0);
    expect(spine.totalSpineWidthMm).toBeCloseTo(1.6, 2);
    expect(spine.totalSpineWidthPt).toBeCloseTo(1.6 * MM_TO_PT, 2);
  });

  it('correctly calculates spine and thread swell for sewn multi-signature books', () => {
    const sheets = 64;
    const gsm: PaperGsm = 80;
    const sigCount = 4; // 16 sheets per sig

    const spine = computeSpineWidth({
      sheetCount: sheets,
      paperGsm: gsm,
      bindingType: 'sewn',
      signatureCount: sigCount,
    });

    // 64 * 0.100 = 6.4mm bulk + 4 * 0.15mm thread swell = 7.0mm bulk+swell + 1.0mm sewn hinge = 8.0mm
    expect(spine.textBlockThicknessMm).toBeCloseTo(6.4, 2);
    expect(spine.threadSwellMm).toBeCloseTo(0.6, 2);
    expect(spine.hingeAllowanceMm).toBeCloseTo(1.0, 2);
    expect(spine.totalSpineWidthMm).toBeCloseTo(8.0, 2);
  });

  it('adds board hinge allowance for hardcovers', () => {
    const sheets = 100;
    const gsm: PaperGsm = 80;
    const boardThickness = 2.0;

    const spine = computeSpineWidth({
      sheetCount: sheets,
      paperGsm: gsm,
      bindingType: 'sewn',
      boardThicknessMm: boardThickness,
      signatureCount: 5,
    });

    // bulk: 10mm, swell: 5 * 0.15 = 0.75mm, hinge: 2 * 2.0 + 7 = 11.0mm -> total: 21.75mm
    expect(spine.hingeAllowanceMm).toBeCloseTo(11.0, 2);
    expect(spine.totalSpineWidthMm).toBeCloseTo(21.75, 2);
  });

  it('calculates full wrap-around dimensions including spine, bleeds, and wrap margin', () => {
    const pageWidthPt = 420; // ~A5 width
    const pageHeightPt = 595; // ~A5 height
    const spineWidthPt = 28.35; // ~10mm
    const bleedPt = 8.5; // ~3mm
    const wrapMarginPt = 0; // softcover

    const dims = computeCoverDimensions({
      pageWidthPt,
      pageHeightPt,
      spineWidthPt,
      bleedPt,
      wrapMarginPt,
    });

    // Total width = 2 * (420 + 8.5) + 28.35 = 840 + 17 + 28.35 = 885.35
    expect(dims.totalWidthPt).toBeCloseTo(885.35, 1);
    // Total height = 595 + 2 * 8.5 = 612
    expect(dims.totalHeightPt).toBeCloseTo(612, 1);
    expect(dims.backCoverRect.width).toBeCloseTo(428.5, 1);
    expect(dims.spineRect.width).toBeCloseTo(28.35, 1);
    expect(dims.frontCoverRect.width).toBeCloseTo(428.5, 1);
  });

  it('checks spine text legibility threshold (3.5 mm)', () => {
    const thinSpine = computeSpineWidth({
      sheetCount: 10,
      paperGsm: 80,
      bindingType: 'saddle',
      signatureCount: 1,
    });
    expect(thinSpine.totalSpineWidthMm).toBeLessThan(3.5);
    expect(thinSpine.canPrintSpineText).toBe(false);

    const thickSpine = computeSpineWidth({
      sheetCount: 60,
      paperGsm: 80,
      bindingType: 'sewn',
      signatureCount: 4,
    });
    expect(thickSpine.totalSpineWidthMm).toBeGreaterThanOrEqual(3.5);
    expect(thickSpine.canPrintSpineText).toBe(true);
  });
});

describe('Cover Studio - loadCoverPdf Wiring & Signature Distribution Invariants', () => {
  function extractFunctionBody(fnSignature: string): string {
    const start = appSource.indexOf(fnSignature);
    expect(start, `expected to find "${fnSignature}" in app.ts`).toBeGreaterThanOrEqual(0);
    const braceStart = appSource.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < appSource.length; i++) {
      if (appSource[i] === '{') depth++;
      if (appSource[i] === '}') {
        depth--;
        if (depth === 0) return appSource.slice(braceStart, i + 1);
      }
    }
    throw new Error(`unterminated function body for "${fnSignature}"`);
  }

  const loadCoverPdfBody = extractFunctionBody('async function loadCoverPdf(');

  it('computes signature count via computeSignatureMappings with "auto", not naive sheets / 4', () => {
    expect(loadCoverPdfBody).toContain("computeSignatureMappings(sheets * 4, 'auto')");
    expect(loadCoverPdfBody).not.toContain('Math.ceil(sheets / 4)');
  });

  it('syncs calculated sheets and signatures to DOM inputs and state', () => {
    expect(loadCoverPdfBody).toContain('coverSheetCount = sheets');
    expect(loadCoverPdfBody).toContain('coverSigCount = signatures');
    expect(loadCoverPdfBody).toContain('coverSheetCountInput.value = String(sheets)');
    expect(loadCoverPdfBody).toContain('coverSigCountInput.value = String(signatures)');
  });

  it('updates live calculations upon loading PDF', () => {
    expect(loadCoverPdfBody).toContain('updateCoverLiveCalculations()');
  });

  it('ensures no naive Math.ceil(sheets / 4) signature estimation remains anywhere in app.ts', () => {
    expect(appSource).not.toContain('Math.ceil(sheets / 4)');
  });
});


describe('Cover Studio - Two-Sheet Split Format Wiring', () => {
  beforeAll(() => {
    let mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('document', {
      documentElement: { lang: 'en' },
      querySelectorAll: () => [],
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** The source text between two known landmarks in app.ts. */
  function sourceBetween(from: string, to: string): string {
    const start = appSource.indexOf(from);
    expect(start, `expected to find "${from}" in app.ts`).toBeGreaterThanOrEqual(0);
    const end = appSource.indexOf(to, start);
    expect(end, `expected to find "${to}" after "${from}" in app.ts`).toBeGreaterThan(start);
    return appSource.slice(start, end);
  }

  function extractFunctionBody(fnSignature: string): string {
    const start = appSource.indexOf(fnSignature);
    expect(start, `expected to find "${fnSignature}" in app.ts`).toBeGreaterThanOrEqual(0);
    const braceStart = appSource.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < appSource.length; i++) {
      if (appSource[i] === '{') depth++;
      if (appSource[i] === '}') {
        depth--;
        if (depth === 0) return appSource.slice(braceStart, i + 1);
      }
    }
    throw new Error(`unterminated function body for "${fnSignature}"`);
  }

  it('offers both sheet formats in the selector, with the 2 × A4 split preselected', () => {
    expect(htmlSource).toContain('data-format="split"');
    expect(htmlSource).toContain('data-format="single"');

    const buttonTag = (format: string): string => {
      const match = htmlSource.match(new RegExp(`<button[^>]*data-format="${format}"[^>]*>`));
      expect(match, `expected a <button> carrying data-format="${format}"`).not.toBeNull();
      return match![0];
    };
    expect(buttonTag('split')).toContain('is-active');
    expect(buttonTag('single')).not.toContain('is-active');
  });

  it('defaults the app state to the split format, matching the preselected button', () => {
    expect(appSource).toMatch(/let coverFormat: CoverFormat = 'split';/);
  });

  it('resets back to the split format when the screen is reset', () => {
    expect(extractFunctionBody('function resetCoverScreen(')).toContain("coverFormat = 'split'");
  });

  it('reconciles the format chrome on every entry to the Cover Studio screen, not only on reset', () => {
    // The screen is reachable without a reset (tools menu / hub), so the preview
    // has to be switched there too or it would show the wrong layout.
    expect(appSource).toContain("} else if (id === 'cover') {\n      applyCoverFormatToUi();");
  });

  it('swaps the data-i18n key alongside the text when the format changes, so a later language switch keeps the right wording', () => {
    const body = extractFunctionBody('function applyCoverFormatToUi(');
    expect(body).toContain('coverFormatHint.dataset.i18n = formatKey');
    expect(body).toContain("coverPreviewHeading.dataset.i18n = isSplit ? 'cover.previewTitleSplit' : 'cover.previewTitle'");
    expect(body).toContain('coverFormatHint.textContent = t(coverFormatHint.dataset.i18n)');
    expect(body).toContain('coverPreviewHeading.textContent = t(coverPreviewHeading.dataset.i18n)');
  });

  it('shows exactly one of the two preview layouts at a time', () => {
    const body = extractFunctionBody('function applyCoverFormatToUi(');
    expect(body).toContain("coverLayoutPreview.classList.toggle('hidden', isSplit)");
    expect(body).toContain("coverSplitPreview.classList.toggle('hidden', !isSplit)");
  });

  it('picks the split geometry for the split format and the single wrap otherwise, in both the live preview and the generate flow', () => {
    // updateCoverLiveCalculations declares an inline object return type, so its
    // body cannot be found by brace-matching from the signature.
    const live = sourceBetween('function updateCoverLiveCalculations(', 'function updateCoverPreviewVisuals(');
    expect(live).toContain("options.paper === 'split' ? computeSplitCoverDimensions(dimInput) : null");

    const generateStart = appSource.indexOf("coverGenerateBtn.addEventListener('click'");
    expect(generateStart).toBeGreaterThanOrEqual(0);
    const generate = appSource.slice(generateStart, appSource.indexOf('const coverSaveFlow', generateStart));
    expect(generate).toContain("options.paper === 'split'\n        ? computeSplitCoverDimensions(dimInput)\n        : computeCoverDimensions(dimInput)");
  });

  it('shows the per-sheet breakdown only for the split format', () => {
    const generateStart = appSource.indexOf("coverGenerateBtn.addEventListener('click'");
    const generate = appSource.slice(generateStart, appSource.indexOf('const coverSaveFlow', generateStart));
    expect(generate).toContain("coverResultBreakdownCard.classList.toggle('hidden', dimensions.format !== 'split')");
  });

  it('names what is on each sheet, including the flap and glue tab widths, in both languages', () => {
    setLanguage('en');
    expect(t('cover.splitSheet1Desc')).toContain('20');
    expect(t('cover.splitSheet2Desc')).toContain('10');

    setLanguage('tr');
    // Turkish booklet terminology per docs/BRAND.md: kulakçık (flap), yapıştırma payı (glue tab).
    expect(t('cover.splitSheet1Desc')).toContain('Kulakçık');
    expect(t('cover.splitSheet1Desc')).toContain('20');
    expect(t('cover.splitSheet2Desc')).toContain('Yapıştırma Payı');
    expect(t('cover.splitSheet2Desc')).toContain('10');
    setLanguage('en');
  });
});

describe('Cover Studio - Split Format Printability', () => {
  // Mirrors getEffectiveCoverSpecs(): A5 trim, softcover (3mm bleed, no wrap
  // allowance), 80gsm sewn — the app's own defaults.
  function a5SoftcoverDimInput(sheets: number, signatures: number) {
    const spine = computeSpineWidth({
      sheetCount: sheets, signatureCount: signatures, paperGsm: 80, bindingType: 'sewn',
    });
    return {
      pageWidthPt: (148 * 72) / 25.4,
      pageHeightPt: (210 * 72) / 25.4,
      spineWidthPt: spine.totalSpineWidthPt,
      bleedPt: 3 * MM_TO_PT,
      wrapMarginPt: 0,
    };
  }

  const a4Pt = A4_LONG_EDGE_MM * MM_TO_PT;

  it('the default 20-sheet A5 job: the single wrap overflows A4, both split sheets fit', () => {
    const input = a5SoftcoverDimInput(20, 5);

    expect(computeCoverDimensions(input).totalWidthPt).toBeGreaterThan(a4Pt);

    const { sheet1, sheet2 } = computeSplitCoverDimensions(input);
    expect(sheet1.widthPt).toBeLessThanOrEqual(a4Pt);
    expect(sheet2.widthPt).toBeLessThanOrEqual(a4Pt);
  });

  it('stays A4-feedable for a thick 200-sheet A5 book', () => {
    const { sheet1, sheet2 } = computeSplitCoverDimensions(a5SoftcoverDimInput(200, 13));
    expect(sheet1.widthPt).toBeLessThanOrEqual(a4Pt);
    expect(sheet2.widthPt).toBeLessThanOrEqual(a4Pt);
  });

  it("sheet 1's flap is wide enough to fully cover sheet 2's glue tab", () => {
    const { sheet1, sheet2 } = computeSplitCoverDimensions(a5SoftcoverDimInput(20, 5));
    // Without this the two sheets would meet edge to edge with nothing bonded,
    // which is the failure the overlap exists to prevent.
    expect(sheet1.lapFlapRect.width).toBeGreaterThan(sheet2.glueTabRect.width);
  });
});

describe('Cover Studio - Turkish Dictionary Entries', () => {
  // t() falls back to the English string when a Turkish key is missing, so
  // asserting `t(key) !== key` under setLanguage('tr') passes for an untranslated
  // key. Check the `tr:` half of the dictionary source itself instead.
  const trDictionary = (() => {
    const start = i18nSource.indexOf('\n  tr: {');
    expect(start, "expected a `tr:` dictionary in src/i18n/index.ts").toBeGreaterThan(0);
    return i18nSource.slice(start);
  })();

  const splitFormatKeys = [
    'cover.formatTitle',
    'cover.formatSplit',
    'cover.formatSingle',
    'cover.formatSplitHint',
    'cover.formatSingleHint',
    'cover.previewTitleSplit',
    'cover.previewSheet1',
    'cover.previewSheet2',
    'cover.previewFlap',
    'cover.previewTab',
    'cover.totalDimensionsSplit',
    'cover.dimStatSplit',
    'cover.splitSheet1Desc',
    'cover.splitSheet2Desc',
    'cover.sheetBreakdown',
  ];

  it('gives every split-format key its own Turkish entry, not an English fallback', () => {
    for (const key of splitFormatKeys) {
      expect(trDictionary, `Missing TR dictionary entry for key: ${key}`).toContain(`'${key}':`);
    }
  });

  it('keeps every placeholder the English string uses', () => {
    const enDictionary = i18nSource.slice(i18nSource.indexOf('\n  en: {'), i18nSource.indexOf('\n  tr: {'));
    const placeholders = (dict: string, key: string): string[] => {
      const line = dict.split('\n').find((l) => l.includes(`'${key}':`));
      expect(line, `expected a line for ${key}`).toBeDefined();
      return (line!.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort();
    };
    for (const key of ['cover.totalDimensionsSplit', 'cover.dimStatSplit']) {
      expect(placeholders(trDictionary, key), `placeholder mismatch for ${key}`)
        .toEqual(placeholders(enDictionary, key));
    }
  });
});

describe('Cover Studio - A4 fit warning', () => {
  /**
   * Source of one function, signature to the next sibling function. Sliced this
   * way rather than by brace depth because updateCoverLiveCalculations declares
   * an inline object return type, whose braces close before the body opens.
   */
  function functionSource(fnSignature: string): string {
    const start = appSource.indexOf(fnSignature);
    expect(start, `expected to find "${fnSignature}" in app.ts`).toBeGreaterThanOrEqual(0);
    const next = appSource.indexOf('\n  function ', start + fnSignature.length);
    return appSource.slice(start, next === -1 ? undefined : next);
  }

  function sourceBetween(from: string, to: string): string {
    const start = appSource.indexOf(from);
    expect(start, `expected to find "${from}" in app.ts`).toBeGreaterThanOrEqual(0);
    const end = appSource.indexOf(to, start + from.length);
    expect(end, `expected to find "${to}" in app.ts`).toBeGreaterThanOrEqual(0);
    return appSource.slice(start, end);
  }

  /** The markup of one badge span, looked up by its id. */
  function badgeTag(id: string): string {
    const at = htmlSource.indexOf(`id="${id}"`);
    expect(at, `expected #${id} to exist in index.html`).toBeGreaterThan(0);
    return htmlSource.slice(htmlSource.lastIndexOf('<span', at), htmlSource.indexOf('</span>', at));
  }

  it('carries a warning badge on both cover flows, hidden until a calculation says otherwise', () => {
    for (const id of ['coverPaperFitBadge', 'wrapCoverPaperFitBadge']) {
      const tag = badgeTag(id);
      expect(tag, `#${id} should start hidden`).toContain('hidden');
      expect(tag, `#${id} should carry the shared warning text`).toContain('data-i18n="cover.needsA3"');
    }
  });

  it('toggles that badge from the engine predicate in both flows', () => {
    expect(functionSource('function updateCoverLiveCalculations('))
      .toContain("coverPaperFitBadge.classList.toggle('hidden', fitResult.fits)");
    expect(functionSource('function updateWrapCoverCalculations('))
      .toContain("wrapCoverPaperFitBadge.classList.toggle('hidden', fitResult.fits)");
  });

  it('uses the predicate for nothing but those two badges, so an oversize cover is still produced', () => {
    // Two call sites and no more: the warning tells the binder which paper to
    // feed, it never gates generateCoverPdf or trims anything down to A4.
    expect(appSource.match(/checkCoverFormatFit\(/g) ?? []).toHaveLength(2);
  });

  it('gives the A4 warning its own entry in both dictionaries', () => {
    const enDictionary = i18nSource.slice(i18nSource.indexOf('\n  en: {'), i18nSource.indexOf('\n  tr: {'));
    const trDictionary = i18nSource.slice(i18nSource.indexOf('\n  tr: {'));
    expect(enDictionary).toContain("'cover.needsA3':");
    expect(trDictionary, 'a missing TR entry silently falls back to English').toContain("'cover.needsA3':");
  });

  it('does not offer the retired 1 × A4 direct format in Cover Studio format group', () => {
    const group = htmlSource.slice(
      htmlSource.indexOf('id="coverFormatGroup"'),
      htmlSource.indexOf('id="coverFormatHint"'),
    );
    expect(group).not.toContain('data-format="a4-direct"');
    expect(group).toContain('data-format="split"');
    expect(group).toContain('data-format="single"');
  });

  it('disables hardcover option and falls back to softcover when saddle-stitched binding is selected', () => {
    const bindingHandler = sourceBetween("coverBindingGroup.addEventListener('click'", "coverKindGroup.addEventListener('click'");
    expect(bindingHandler).toContain("hardcoverBtn.disabled = isSaddle");
    expect(bindingHandler).toContain("coverCoverStyle = 'softcover'");
  });

  it('falls back to softcover on studio entry when saddle-stitched booklet was inferred', () => {
    const openStudioHandler = sourceBetween("resultOpenCoverStudioBtn.addEventListener('click'", "let readerResizeTimer");
    expect(openStudioHandler).toContain("binding: isSingle ? 'saddle' : 'sewn'");
    expect(openStudioHandler).toContain("hardcoverBtn.disabled = isSaddle");
  });

  it('does not have coverStyleGroup, but separates cover kind and format groups', () => {
    expect(htmlSource).not.toContain('id="coverStyleGroup"');
    const kindGroup = htmlSource.slice(
      htmlSource.indexOf('id="coverKindGroup"'),
      htmlSource.indexOf('id="coverKindHint"'),
    );
    expect(kindGroup).toContain('data-kind="softcover"');
    expect(kindGroup).toContain('data-kind="hardcover"');

    const formatGroup = htmlSource.slice(
      htmlSource.indexOf('id="coverFormatGroup"'),
      htmlSource.indexOf('id="coverFormatHint"'),
    );
    expect(formatGroup).not.toContain('data-format="a4-direct"');
    expect(formatGroup).toContain('data-format="split"');
    expect(formatGroup).toContain('data-format="single"');
  });

  it('does not define retired a4-direct keys in dictionaries', () => {
    const enDictionary = i18nSource.slice(i18nSource.indexOf('\n  en: {'), i18nSource.indexOf('\n  tr: {'));
    const trDictionary = i18nSource.slice(i18nSource.indexOf('\n  tr: {'));
    expect(enDictionary).not.toContain("'cover.formatA4Direct':");
    expect(enDictionary).not.toContain("'cover.formatA4DirectHint':");
    expect(enDictionary).not.toContain("'cover.needsA4Direct':");
    expect(trDictionary).not.toContain("'cover.formatA4Direct':");
    expect(trDictionary).not.toContain("'cover.formatA4DirectHint':");
    expect(trDictionary).not.toContain("'cover.needsA4Direct':");
  });

  it('falls back to localized title and author in updateCoverPreviewVisuals when empty', () => {
    const fn = functionSource('function updateCoverPreviewVisuals(');
    expect(fn).toContain("t('cover.bookTitle')");
    expect(fn).toContain("t('cover.author')");
  });

  it('does not touch coverGenerateBtn.disabled in updateCoverLiveCalculations', () => {
    const fn = functionSource('function updateCoverLiveCalculations(');
    expect(fn).not.toContain('coverGenerateBtn.disabled');
  });
});

describe('Cover Studio - wrap-cover failure resilience', () => {
  function sourceBetween(from: string, to: string): string {
    const start = appSource.indexOf(from);
    expect(start, `expected to find "${from}" in app.ts`).toBeGreaterThanOrEqual(0);
    const end = appSource.indexOf(to, start + from.length);
    expect(end, `expected to find "${to}" in app.ts`).toBeGreaterThanOrEqual(0);
    return appSource.slice(start, end);
  }

  it('keeps the finished booklet when the wrap cover fails, reporting the cover error by toast instead of the error screen', () => {
    const generate = sourceBetween("generateBtn.addEventListener('click'", 'function applyWrapCoverResultVisibility');
    const coverCall = 'await buildWrapCoverPdfs(result.sheetsCount, result.signaturesCount)';
    const callAt = generate.indexOf(coverCall);
    expect(callAt, 'the wrap cover is still built from the produced booklet').toBeGreaterThan(0);

    // The cover promise carries its own catch, so a COVER_TOO_LARGE rejection
    // never reaches the handler's outer catch (which calls goToError).
    const afterCall = generate.slice(callAt + coverCall.length);
    expect(afterCall.startsWith('.catch((coverError: unknown) => {')).toBe(true);
    const coverCatch = afterCall.slice(0, afterCall.indexOf('\n          })'));
    expect(coverCatch).toContain('console.warn(');
    expect(coverCatch).toContain("showToast(errorText(coverError), { type: 'error' })");
    expect(coverCatch).toContain('return {};');
    expect(coverCatch).not.toContain('goToError');
    expect(coverCatch).not.toContain('throw');

    // ...and the booklet then goes on to the result screen as usual.
    const afterCover = generate.slice(callAt);
    expect(afterCover.indexOf('booklet = {')).toBeGreaterThan(0);
    expect(afterCover.indexOf("showScreen('result')")).toBeGreaterThan(afterCover.indexOf('booklet = {'));
    expect(afterCover.indexOf("showScreen('result')")).toBeLessThan(afterCover.indexOf('goToError('));
  });
});
