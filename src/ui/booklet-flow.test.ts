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
} from '../engine/cover-engine';
import { computeSignatureMappings, resolveSheetSize } from '../engine/booklet-engine';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const appSource = readFileSync(appTsPath, 'utf-8');

const i18nPath = fileURLToPath(new URL('../i18n/index.ts', import.meta.url));
const i18nSource = readFileSync(i18nPath, 'utf-8');

/** The source text between two known landmarks in app.ts. */
function sourceBetween(from: string, to: string): string {
  const start = appSource.indexOf(from);
  expect(start, `expected to find "${from}" in app.ts`).toBeGreaterThanOrEqual(0);
  const end = appSource.indexOf(to, start);
  expect(end, `expected to find "${to}" after "${from}" in app.ts`).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

/** A function body located by brace-matching from its signature. */
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

describe('Booklet pipeline - Inline Wrap Cover DOM', () => {
  it('puts the cover toggle and every inline option on the config screen', () => {
    const requiredIds = [
      'wrapCoverToggleGroup',
      'wrapCoverHintText',
      'wrapCoverOptions',
      'wrapCoverFormatGroup',
      'wrapCoverFormatHint',
      'wrapCoverBindingGroup',
      'wrapCoverGsmGroup',
      'wrapCoverPaletteGroup',
      'wrapCoverTitleInput',
      'wrapCoverAuthorInput',
      'wrapCoverSynopsisInput',
      'wrapCoverSpineLabel',
      'wrapCoverPaperBulkBadge',
      'wrapCoverThreadSwellBadge',
      'wrapCoverHingeBadge',
      'wrapCoverFitBadge',
      'wrapCoverDimsLabel',
      'wrapCoverMiniPreview',
      'wrapCoverMiniSynopsis',
      'wrapCoverMiniSpine',
      'wrapCoverMiniSpineText',
      'wrapCoverMiniTitle',
      'wrapCoverMiniAuthor',
    ];
    for (const id of requiredIds) {
      expect(htmlSource, `expected #${id} to exist in index.html`).toContain(`id="${id}"`);
    }
  });

  it('nests the cover options inside the config screen, not the collapsed Advanced panel', () => {
    // The cover is a headline feature of this pipeline; burying it behind the
    // accordion would hide it from exactly the users it is for.
    const configScreen = htmlSource.slice(
      htmlSource.indexOf('id="screen-config"'),
      htmlSource.indexOf('id="advancedPanel"'),
    );
    expect(configScreen).toContain('id="wrapCoverToggleGroup"');
    expect(configScreen).toContain('id="wrapCoverOptions"');
  });

  it('defaults the toggle to off and the format to the 2 × A4 split', () => {
    const buttonTag = (attr: string, value: string): string => {
      const match = htmlSource.match(new RegExp(`<button[^>]*data-${attr}="${value}"[^>]*>`));
      expect(match, `expected a <button> carrying data-${attr}="${value}"`).not.toBeNull();
      return match![0];
    };
    expect(buttonTag('wrapcover', 'off')).toContain('is-active');
    expect(buttonTag('wrapcover', 'on')).not.toContain('is-active');

    const options = htmlSource.slice(
      htmlSource.indexOf('id="wrapCoverFormatGroup"'),
      htmlSource.indexOf('id="wrapCoverFormatHint"'),
    );
    expect(options.match(/<button[^>]*data-format="split"[^>]*>/)![0]).toContain('is-active');
    expect(options.match(/<button[^>]*data-format="single"[^>]*>/)![0]).not.toContain('is-active');
  });

  it('offers all four cover styles, including hardcover', () => {
    const group = htmlSource.slice(
      htmlSource.indexOf('id="wrapCoverBindingGroup"'),
      htmlSource.indexOf('id="wrapCoverGsmGroup"'),
    );
    for (const binding of ['saddle', 'sewn', 'perfect', 'hardcover']) {
      expect(group, `expected a data-wrapbinding="${binding}" button`).toContain(`data-wrapbinding="${binding}"`);
    }
    expect(group.match(/<button[^>]*data-wrapbinding="sewn"[^>]*>/)![0]).toContain('is-active');
  });

  it('offers every cover theme the engine defines', () => {
    const group = htmlSource.slice(
      htmlSource.indexOf('id="wrapCoverPaletteGroup"'),
      htmlSource.indexOf('id="wrapCoverTitleInput"'),
    );
    for (const theme of ['cream', 'white', 'navy', 'burgundy', 'charcoal']) {
      expect(group, `expected a data-theme="${theme}" swatch`).toContain(`data-theme="${theme}"`);
    }
  });

  it('adds cover rows and preview cells to the result screen', () => {
    const requiredIds = [
      'wrapCoverSheet1ActionRow',
      'wrapCoverSheet2ActionRow',
      'wrapCoverSheet1Label',
      'wrapCoverSheet1PreviewCell',
      'wrapCoverSheet1PreviewImg',
      'wrapCoverSheet1PreviewSpinner',
      'wrapCoverSheet1PreviewError',
      'wrapCoverSheet1PreviewLabel',
      'wrapCoverSheet2PreviewCell',
      'wrapCoverSheet2PreviewImg',
      'wrapCoverSheet2PreviewSpinner',
      'wrapCoverSheet2PreviewError',
    ];
    for (const id of requiredIds) {
      expect(htmlSource, `expected #${id} to exist in index.html`).toContain(`id="${id}"`);
    }
    for (const target of ['wrapCover1', 'wrapCover2']) {
      expect(htmlSource).toContain(`data-target="${target}" data-action="share"`);
      expect(htmlSource).toContain(`data-target="${target}" data-action="print"`);
    }
  });

  it('starts both cover rows and preview cells hidden — a booklet without a cover shows neither', () => {
    for (const id of [
      'wrapCoverSheet1ActionRow',
      'wrapCoverSheet2ActionRow',
      'wrapCoverSheet1PreviewCell',
      'wrapCoverSheet2PreviewCell',
      'wrapCoverOptions',
    ]) {
      const tag = htmlSource.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))![0];
      expect(tag, `expected #${id} to start hidden`).toContain('hidden');
    }
  });
});

describe('Booklet pipeline - Wiring', () => {
  it('defaults the pipeline to no cover, split format, sewn, 80gsm, cream', () => {
    expect(appSource).toMatch(/let bookletWrapCover = false;/);
    expect(appSource).toMatch(/let wrapCoverFormat: CoverFormat = 'split';/);
    expect(appSource).toMatch(/let wrapCoverBinding: BindingType \| 'hardcover' = 'sewn';/);
    expect(appSource).toMatch(/let wrapCoverGsm: PaperGsm = 80;/);
    expect(appSource).toMatch(/let wrapCoverTheme: CoverTheme = 'cream';/);
  });

  it('derives the cover from the booklet the engine ACTUALLY produced, not the config projection', () => {
    // The engine pads and rebalances signatures; measuring the spine from the
    // pre-generation estimate would leave the cover wrong for exactly the
    // documents where padding kicks in.
    const generate = sourceBetween("generateBtn.addEventListener('click'", 'function applyWrapCoverResultVisibility');
    expect(generate).toContain('buildWrapCoverPdfs(result.sheetsCount, result.signaturesCount)');
    expect(generate).toContain('bookletWrapCover\n        ? await buildWrapCoverPdfs');
  });

  it('takes the cover page size from the booklet sheet, halved — never from a hardcoded trim', () => {
    const body = extractFunctionBody('function wrapCoverGeometry(');
    expect(body).toContain('const [sheetWidthPt, sheetHeightPt] = wrapCoverSheetSize()');
    expect(body).toContain('pageWidthPt: sheetWidthPt / 2');
    expect(body).toContain('pageHeightPt: sheetHeightPt');
  });

  it('resolves the sheet size through the engine, including the cached source size', () => {
    const body = extractFunctionBody('function wrapCoverSheetSize(');
    expect(body).toContain("bookletPaperSize === 'source'");
    expect(body).toContain('bookletSourceSheetSize ?? resolveSheetSize(\'A4\')');
    expect(body).toContain('return resolveSheetSize(bookletPaperSize)');
  });

  it('caches the source sheet size at file-pick time and clears it when the file changes', () => {
    expect(appSource).toContain("bookletSourceSheetSize = resolveSheetSize('source', doc, pageCount)");
    // A failure to resolve must not block the booklet, which does not need it.
    expect(appSource).toContain('} catch {\n          bookletSourceSheetSize = null;\n        }');
    const load = extractFunctionBody('function loadBookletFile(');
    expect(load).toContain('bookletSourceSheetSize = null');
  });

  it('maps hardcover to a sewn block plus board thickness rather than inventing a binding type', () => {
    const body = extractFunctionBody('function wrapCoverGeometry(');
    expect(body).toContain("wrapCoverBinding === 'hardcover' ? 'sewn' : wrapCoverBinding");
    expect(body).toContain('boardThicknessMm: isHardcover ? WRAP_COVER_BOARD_MM : undefined');
    // Hardcover turns in over board (wrap allowance); softcover is trimmed (bleed).
    expect(body).toContain('bleedPt: (isHardcover ? 0 : 3) * MM_TO_PT');
    expect(body).toContain('wrapMarginPt: (isHardcover ? 15 : 0) * MM_TO_PT');
  });

  it('picks split geometry for the split format and the single wrap otherwise', () => {
    const body = extractFunctionBody('function wrapCoverGeometry(');
    expect(body).toContain("wrapCoverFormat === 'split'\n        ? computeSplitCoverDimensions(dimInput)\n        : computeCoverDimensions(dimInput)");
  });

  it('splits the 2-page cover into one PDF per printed sheet via the engine, not hand-rolled page copying', () => {
    const body = sourceBetween('async function buildWrapCoverPdfs(', 'function refreshConfigSummary(');
    expect(body).toContain('organizePages(pdfBytes, [0])');
    expect(body).toContain('organizePages(pdfBytes, [1])');
    // A single wrap is already one sheet; splitting it would be wrong.
    expect(body).toContain("if (dimensions.format === 'single') return { wrapCoverPdf: pdfBytes }");
    expect(body).toContain('format: wrapCoverFormat');
  });

  it('shares one metrics helper between the config summary and the spine calculation', () => {
    // Two independent copies of the padding/signature math would drift, and the
    // printed spine would stop matching the summary the user read. Both readouts
    // must therefore take their numbers straight off bookletBlockMetrics and do
    // no sheet arithmetic of their own — banning the arithmetic, not one exact
    // spelling of it, is what makes that stick.
    const summary = extractFunctionBody('function refreshConfigSummary(');
    expect(summary).toContain('const metrics = bookletBlockMetrics()');
    expect(summary).toContain('const { logical, sheets, sigLengths } = metrics');
    expect(summary, 'refreshConfigSummary must not recompute the padding itself').not.toMatch(/Math\.(ceil|floor|round|max)\(/);
    expect(summary).not.toContain('computeSignatureMappings(');

    const calc = extractFunctionBody('function updateWrapCoverCalculations(');
    expect(calc).toContain('const metrics = bookletBlockMetrics()');
    expect(calc).toContain('metrics.sheets, metrics.sigLengths.length');
    expect(calc, 'the spine readout must not recompute the padding itself').not.toMatch(/Math\.(ceil|floor|round|max)\(/);
    expect(calc).not.toContain('computeSignatureMappings(');

    // ...and exactly one place is allowed to do that arithmetic.
    const helper = sourceBetween('function bookletBlockMetrics(', 'function wrapCoverSheetSize(');
    expect(helper).toContain('computeSignatureMappings(padded, signatureOption())');

    // The padding chain itself: a separate cover takes 4 pages off the block,
    // what is left rounds UP to a whole sheet (minimum one), and both the sheet
    // count and the signature split are taken from that padded figure. Reading
    // sheets off the unpadded block instead would under-count the spine on every
    // document whose page count is not already a multiple of 4 — most of them.
    // Reads the EFFECTIVE separate-cover value: a wrap-cover job never gives up
    // 4 pages, so the spine is measured on the whole block.
    expect(helper).toContain('const separateCover = effectiveSeparateCover()');
    expect(helper).toContain('const block = separateCover ? logical - 4 : logical');
    expect(helper, 'the metrics helper must not read the raw preference').not.toContain('bookletSeparateCover');
    expect(helper).toContain('const padded = Math.max(4, Math.ceil(block / 4) * 4)');
    expect(helper).toContain('sheets: padded / 4');
    expect(helper, 'sheets must come from the padded block, never the raw one').not.toContain('sheets: block / 4');
  });

  it('pads a partial last sheet, so the spine is never measured short', () => {
    // The rule the helper encodes, stated against arithmetic rather than source:
    // 4 pages fit one sheet, and anything past that takes a whole further sheet.
    const sheetsFor = (logical: number) => Math.max(4, Math.ceil(logical / 4) * 4) / 4;
    expect(sheetsFor(1)).toBe(1);
    expect(sheetsFor(4)).toBe(1);
    expect(sheetsFor(5)).toBe(2);
    expect(sheetsFor(8)).toBe(2);
    expect(sheetsFor(9)).toBe(3);
    expect(sheetsFor(53)).toBe(14);
    // Whereas reading the unpadded block would lose that part-sheet entirely.
    expect(53 / 4).toBeLessThan(sheetsFor(53));
  });

  it('says the spine cannot be measured yet instead of showing one from invented counts', () => {
    const body = extractFunctionBody('function updateWrapCoverCalculations(');
    expect(body).toContain("wrapCoverSpineLabel.textContent = '—'");
    expect(body).toContain("t('config.wrapCoverNeedsFile')");
  });

  it('swaps the format hint data-i18n key with its text so a language change keeps the right wording', () => {
    const body = extractFunctionBody('function applyWrapCoverToUi(');
    expect(body).toContain("wrapCoverFormat === 'split' ? 'cover.formatSplitHint' : 'cover.formatSingleHint'");
    expect(body).toContain('wrapCoverFormatHint.dataset.i18n = splitKey');
    expect(body).toContain('wrapCoverFormatHint.textContent = t(splitKey)');
  });

  it('shows the cover options only while the toggle is on', () => {
    const body = extractFunctionBody('function applyWrapCoverToUi(');
    expect(body).toContain("wrapCoverOptions.classList.toggle('hidden', !bookletWrapCover)");
  });

  it('resets every cover setting back to its default with the rest of the config', () => {
    const body = extractFunctionBody('function resetPicker(');
    for (const line of [
      'bookletWrapCover = false',
      "wrapCoverFormat = 'split'",
      "wrapCoverBinding = 'sewn'",
      'wrapCoverGsm = 80',
      "wrapCoverTheme = 'cream'",
      'bookletSourceSheetSize = null',
      "wrapCoverTitleInput.value = ''",
      'applyWrapCoverToUi()',
    ]) {
      expect(body, `expected resetConfig to run: ${line}`).toContain(line);
    }
  });
});

describe('Booklet pipeline - Result screen', () => {
  it('routes one row to split sheet 1 or the single wrap, and the second row to split sheet 2 only', () => {
    const handler = sourceBetween("const target = button.dataset.target as", 'const bytes = bytesByTarget[target]');
    expect(handler).toContain('wrapCover1: booklet.wrapCoverSheet1Pdf ?? booklet.wrapCoverPdf');
    expect(handler).toContain('wrapCover2: booklet.wrapCoverSheet2Pdf');
  });

  it('labels sheet 1 by format — a split sheet and a single wrap are different objects', () => {
    const body = extractFunctionBody('function applyWrapCoverResultVisibility(');
    expect(body).toContain("isSplit ? 'booklet.wrapCoverSheet1Pdf' : 'booklet.wrapCoverPdf'");
    expect(body).toContain("isSplit ? 'booklet.previewWrapCoverSheet1' : 'booklet.previewWrapCover'");
    expect(body).toContain('wrapCoverSheet1Label.dataset.i18n = rowKey');
    expect(body).toContain('wrapCoverSheet1PreviewLabel.dataset.i18n = labelKey');
  });

  it('offers the single wrap from exactly one row, never duplicated into both', () => {
    // Row 2 exists only for the split format's second sheet. Falling back to the
    // single wrap there would list the same file twice, and print it twice.
    const handler = sourceBetween('const bytesByTarget: Record<typeof target', 'const bytes = bytesByTarget[target]');
    const row2 = handler.split('\n').find((line) => line.includes('wrapCover2:'));
    expect(row2, 'expected a wrapCover2 entry in the target map').toBeDefined();
    expect(row2, 'row 2 must never serve the single wrap').not.toContain('wrapCoverPdf');
  });

  it('hides the second row for a single wrap, which has no second sheet', () => {
    const body = extractFunctionBody('function applyWrapCoverResultVisibility(');
    expect(body).toContain("wrapCoverSheet2ActionRow.classList.toggle('hidden', !booklet?.wrapCoverSheet2Pdf)");
    expect(body).toContain("wrapCoverSheet2PreviewCell.classList.toggle('hidden', !booklet?.wrapCoverSheet2Pdf)");
  });

  it('counts every cover file in the Save All label', () => {
    const body = extractFunctionBody('function savedPdfCount(');
    expect(body).toContain('booklet.wrapCoverSheet1Pdf');
    expect(body).toContain('booklet.wrapCoverSheet2Pdf');
    expect(body).toContain('booklet.wrapCoverPdf');
    expect(body).toContain('.filter(Boolean).length');
  });

  it('saves the cover sheets into the booklet folder alongside the block', () => {
    const save = sourceBetween("bookletSaveBtn.addEventListener('click'", 'bookletGoToLocationBtn.addEventListener');
    expect(save).toContain("[booklet.wrapCoverSheet1Pdf, 'Cover Sheet 1.pdf']");
    expect(save).toContain("[booklet.wrapCoverSheet2Pdf, 'Cover Sheet 2.pdf']");
    expect(save).toContain("[booklet.wrapCoverPdf, 'Cover Wrap.pdf']");
    expect(save).toContain('savePdfPrivately(pdf, `booklets/${docName}/${fileName}`)');
    // Every saved file has to be registered, or it never shows in Files/Recents.
    expect(save).toContain('rememberSaved(uri, `${docName} — ${fileName}`)');
  });

  it('renders a preview for each cover sheet', () => {
    const body = extractFunctionBody('async function renderBookletPreviews(');
    expect(body).toContain('booklet.wrapCoverSheet1Pdf ?? booklet.wrapCoverPdf');
    expect(body).toContain('wrapCoverSheet1PreviewImg');
    expect(body).toContain('booklet.wrapCoverSheet2Pdf');
    expect(body).toContain('wrapCoverSheet2PreviewImg');
  });

  it('clears the cover rows and previews when starting a new file', () => {
    const body = sourceBetween("newFileBtn.addEventListener('click'", 'resultOpenCoverStudioBtn.addEventListener');
    expect(body).toContain('applyWrapCoverResultVisibility()');
    expect(body).toContain('wrapCoverSheet1PreviewCell');
    expect(body).toContain('wrapCoverSheet2PreviewCell');
  });

  it('offers to edit rather than design once a cover exists', () => {
    const body = extractFunctionBody('function applyWrapCoverResultVisibility(');
    expect(body).toContain("sheet1 ? 'booklet.editCover' : 'booklet.openCoverStudio'");
    expect(body).toContain('resultOpenCoverStudioBtn.dataset.i18n = btnKey');
  });
});

describe('Booklet pipeline - Cover Studio handoff', () => {
  const handoff = sourceBetween("resultOpenCoverStudioBtn.addEventListener('click'", 'let readerResizeTimer');

  it('carries every inline cover setting into Cover Studio', () => {
    for (const line of [
      'coverPaperGsm = wrapCoverGsm',
      'coverTheme = wrapCoverTheme',
      'coverFormat = wrapCoverFormat',
      'coverAuthorInput.value = wrapCoverAuthorInput.value',
      'coverSynopsisInput.value = wrapCoverSynopsisInput.value',
    ]) {
      expect(handoff, `expected the handoff to carry: ${line}`).toContain(line);
    }
  });

  it('maps hardcover back to Cover Studio’s own softcover/hardcover style control', () => {
    expect(handoff).toContain("coverCoverStyle = wrapCoverBinding === 'hardcover' ? 'hardcover' : 'softcover'");
    expect(handoff).toContain("coverBindingType = wrapCoverBinding === 'hardcover' ? 'sewn' : wrapCoverBinding");
    expect(handoff).toContain('coverBoardThicknessMm = WRAP_COVER_BOARD_MM');
  });

  it('syncs the segmented controls, not just the state behind them', () => {
    for (const call of [
      "setActiveSegment(coverGsmGroup, 'gsm', String(coverPaperGsm))",
      "setActiveSegment(coverStyleGroup, 'style', coverCoverStyle)",
      'applyCoverFormatToUi()',
    ]) {
      expect(handoff, `expected the handoff to run: ${call}`).toContain(call);
    }
  });

  it('still infers the binding from the imposition when no inline cover was used', () => {
    expect(handoff).toContain("const isSingle = bookletSignature === 'single'");
    expect(handoff).toContain("coverBindingType = isSingle ? 'saddle' : 'sewn'");
  });

  it('prefers the cover’s own title over the result screen’s file name', () => {
    expect(handoff).toContain('wrapCoverTitleInput.value.trim() || bookletFileNameInput.value.trim()');
  });

  it('keeps the standalone Cover Studio entry in the tools menu', () => {
    expect(htmlSource).toContain('data-tool="cover"');
    expect(appSource).toContain("cover: byId('screen-cover')");
  });
});

describe('Booklet pipeline - Localization', () => {
  beforeAll(() => {
    let mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('document', { documentElement: { lang: 'en' }, querySelectorAll: () => [] });
  });

  afterAll(() => vi.unstubAllGlobals());

  const requiredKeys = [
    'config.wrapCover',
    'config.wrapCoverOff',
    'config.wrapCoverOn',
    'config.wrapCoverHint',
    'config.wrapCoverContent',
    'config.wrapCoverBindingHardcover',
    'config.wrapCoverBindingHint',
    'config.wrapCoverPreview',
    'config.wrapCoverNeedsFile',
    'config.summaryWrapCover',
    'booklet.fileWrapCoverSheet1',
    'booklet.fileWrapCoverSheet2',
    'booklet.fileWrapCover',
    'booklet.wrapCoverSheet1Lower',
    'booklet.wrapCoverSheet2Lower',
    'booklet.wrapCoverLower',
    'booklet.wrapCoverSheet1Pdf',
    'booklet.wrapCoverSheet2Pdf',
    'booklet.wrapCoverPdf',
    'booklet.previewWrapCoverSheet1',
    'booklet.previewWrapCoverSheet2',
    'booklet.previewWrapCover',
    'booklet.editCover',
  ];

  it('defines every pipeline key in English', () => {
    setLanguage('en');
    for (const key of requiredKeys) {
      expect(t(key), `Missing EN translation for key: ${key}`).not.toBe(key);
    }
  });

  // t() falls back to English for a missing Turkish key, so `t(key) !== key`
  // cannot detect one. Read the tr: half of the dictionary source instead.
  it('gives every pipeline key its own Turkish entry, not an English fallback', () => {
    const trDictionary = i18nSource.slice(i18nSource.indexOf('\n  tr: {'));
    for (const key of requiredKeys) {
      expect(trDictionary, `Missing TR dictionary entry for key: ${key}`).toContain(`'${key}':`);
    }
  });

  it('names the flap and glue tab in the Turkish sheet labels, per the booklet terminology rule', () => {
    setLanguage('tr');
    expect(t('booklet.wrapCoverSheet1Pdf')).toContain('Kulakçık');
    expect(t('booklet.wrapCoverSheet1Pdf')).toContain('Sırt');
    expect(t('booklet.wrapCoverSheet2Pdf')).toContain('Yapıştırma Payı');
    setLanguage('en');
  });
});

describe('Booklet pipeline - End-to-end geometry', () => {
  /**
   * Reproduces what the wiring does for a real job: booklet sheet size from the
   * engine's own preset, finished page = half the sheet, spine from the sheet
   * and signature counts the imposition actually produces.
   */
  function pipelineCover(opts: {
    paper: 'A4' | 'A3' | 'A5';
    originalPages: number;
    signature?: number | 'auto';
    gsm?: 70 | 80 | 90 | 100 | 120;
    binding?: 'saddle' | 'sewn' | 'perfect';
    hardcover?: boolean;
  }) {
    const padded = Math.max(4, Math.ceil(opts.originalPages / 4) * 4);
    const sheets = padded / 4;
    const signatures = computeSignatureMappings(padded, opts.signature).length;

    const [sheetWidthPt, sheetHeightPt] = resolveSheetSize(opts.paper);
    const spine = computeSpineWidth({
      sheetCount: sheets,
      signatureCount: signatures,
      paperGsm: opts.gsm ?? 80,
      bindingType: opts.hardcover ? 'sewn' : (opts.binding ?? 'sewn'),
      boardThicknessMm: opts.hardcover ? 2.0 : undefined,
    });
    const dimInput = {
      pageWidthPt: sheetWidthPt / 2,
      pageHeightPt: sheetHeightPt,
      spineWidthPt: spine.totalSpineWidthPt,
      bleedPt: (opts.hardcover ? 0 : 3) * MM_TO_PT,
      wrapMarginPt: (opts.hardcover ? 15 : 0) * MM_TO_PT,
    };
    return { sheets, signatures, spine, split: computeSplitCoverDimensions(dimInput), single: computeCoverDimensions(dimInput) };
  }

  const a4Pt = A4_LONG_EDGE_MM * MM_TO_PT;

  it('an A4-sheet booklet yields an A5 cover page — the folded half of the sheet', () => {
    const [sheetW, sheetH] = resolveSheetSize('A4');
    const pageWidthMm = (sheetW / 2) / MM_TO_PT;
    const pageHeightMm = sheetH / MM_TO_PT;
    expect(pageWidthMm).toBeCloseTo(148.5, 0);
    expect(pageHeightMm).toBeCloseTo(210, 0);
  });

  it('the default split cover fits A4 for a typical 64-page booklet, while the single wrap does not', () => {
    const { split, single } = pipelineCover({ paper: 'A4', originalPages: 64, signature: 'auto' });
    expect(split.sheet1.widthPt).toBeLessThanOrEqual(a4Pt);
    expect(split.sheet2.widthPt).toBeLessThanOrEqual(a4Pt);
    expect(single.totalWidthPt).toBeGreaterThan(a4Pt);
  });

  it('stays A4-feedable across the full range of jobs the config screen can produce', () => {
    for (const originalPages of [4, 32, 120, 400, 800]) {
      for (const signature of ['auto', 8, 16, 32, undefined] as const) {
        for (const gsm of [70, 120] as const) {
          const { split } = pipelineCover({ paper: 'A4', originalPages, signature, gsm });
          expect(split.sheet1.widthPt, `sheet 1 overflowed A4 at ${originalPages}p/${signature}/${gsm}g`)
            .toBeLessThanOrEqual(a4Pt);
          expect(split.sheet2.widthPt, `sheet 2 overflowed A4 at ${originalPages}p/${signature}/${gsm}g`)
            .toBeLessThanOrEqual(a4Pt);
        }
      }
    }
  });

  it('a thicker book gives a strictly wider spine and a strictly wider sheet 1', () => {
    const thin = pipelineCover({ paper: 'A4', originalPages: 32, signature: 'auto' });
    const thick = pipelineCover({ paper: 'A4', originalPages: 320, signature: 'auto' });
    expect(thick.spine.totalSpineWidthMm).toBeGreaterThan(thin.spine.totalSpineWidthMm);
    expect(thick.split.sheet1.widthPt).toBeGreaterThan(thin.split.sheet1.widthPt);
    // Sheet 2 carries no spine, so it must NOT grow with the book block.
    expect(thick.split.sheet2.widthPt).toBeCloseTo(thin.split.sheet2.widthPt, 9);
  });

  it('hardcover adds board and groove, making the spine wider than the same book in softcover', () => {
    const soft = pipelineCover({ paper: 'A4', originalPages: 200, signature: 'auto' });
    const hard = pipelineCover({ paper: 'A4', originalPages: 200, signature: 'auto', hardcover: true });
    expect(hard.spine.totalSpineWidthMm).toBeGreaterThan(soft.spine.totalSpineWidthMm);
    expect(hard.spine.hingeAllowanceMm).toBeCloseTo(2 * 2.0 + 7, 9);
  });

  it('a saddle-stitched booklet gets no thread swell and no hinge, unlike the sewn default', () => {
    const saddle = pipelineCover({ paper: 'A4', originalPages: 64, binding: 'saddle' });
    const sewn = pipelineCover({ paper: 'A4', originalPages: 64, binding: 'sewn' });
    expect(saddle.spine.threadSwellMm).toBe(0);
    expect(saddle.spine.hingeAllowanceMm).toBe(0);
    expect(sewn.spine.totalSpineWidthMm).toBeGreaterThan(saddle.spine.totalSpineWidthMm);
  });

  it('an A3-sheet booklet (A4 pages) still splits into two feedable sheets', () => {
    const { split } = pipelineCover({ paper: 'A3', originalPages: 64, signature: 'auto' });
    // A4-page covers exceed the A4 long edge, so these need A3 to print — but each
    // split sheet is still far narrower than the single wrap it replaces.
    const { single } = pipelineCover({ paper: 'A3', originalPages: 64, signature: 'auto' });
    expect(split.sheet1.widthPt).toBeLessThan(single.totalWidthPt);
    expect(split.sheet2.widthPt).toBeLessThan(single.totalWidthPt);
  });
});

describe('Booklet pipeline - Wrap cover vs separate cover', () => {
  // A wrap-around cover encloses the whole block, so the block cannot also give
  // up 4 of its own pages to a separate cover. The two are mutually exclusive,
  // and the wrap cover wins while it is on.

  beforeAll(() => {
    let mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('document', { documentElement: { lang: 'en' }, querySelectorAll: () => [] });
  });

  afterAll(() => vi.unstubAllGlobals());

  it('derives the effective value instead of erasing the user’s choice', () => {
    const helper = extractFunctionBody('function effectiveSeparateCover(');
    expect(helper).toContain('return bookletSeparateCover && !bookletWrapCover');
  });

  it('routes every consumer through the effective value — none may read the raw flag', () => {
    // Each of these decides what the run PRODUCES. One left on the raw flag and
    // they disagree: the summary promises a cover PDF that is never written, or
    // the spine is measured on a block 4 pages short of the finished book.
    const consumers: Array<[string, string]> = [
      ['isAdvancedModified', extractFunctionBody('function isAdvancedModified(')],
      ['bookletBlockMetrics', sourceBetween('function bookletBlockMetrics(', 'function wrapCoverSheetSize(')],
      ['refreshConfigSummary', extractFunctionBody('function refreshConfigSummary(')],
      ['makeBooklet call', sourceBetween("const result = await makeBooklet(", 'booklet = {')],
    ];
    for (const [name, body] of consumers) {
      expect(body, `${name} must read effectiveSeparateCover()`).toContain('effectiveSeparateCover()');
      expect(body, `${name} must not read the raw bookletSeparateCover`).not.toContain('bookletSeparateCover');
    }
  });

  it('the raw preference is only ever written by the user’s own click, the reset, and the too-short rule', () => {
    // If anything else assigned it, "remember" would quietly become "erase".
    const assignments = appSource.split('\n').filter((line) => /^\s*bookletSeparateCover =/.test(line));
    expect(assignments).toHaveLength(3);
    expect(assignments.some((l) => l.includes("cover === 'separate'"))).toBe(true);
    expect(assignments.filter((l) => l.trim() === 'bookletSeparateCover = false;')).toHaveLength(2);
  });

  it('parks the choice when the wrap cover is on, and clears it only for a too-short document', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    // Document-driven: cleared for good, because nothing on this screen can make it valid again.
    expect(body).toContain('if (tooFew && bookletSeparateCover) {\n      bookletSeparateCover = false;\n    }');
    // Screen-driven: never assigns, so turning the wrap cover off hands the choice back.
    expect(body).not.toContain('bookletWrapCover) {\n      bookletSeparateCover = false');
  });

  it('disables the separate-cover button for either reason', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    expect(body).toContain('separateBtn.disabled = tooFew || bookletWrapCover');
  });

  it('lights the segment from the effective value, from one place only', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    expect(body).toContain("setActiveSegment(coverModeGroup, 'cover', effectiveSeparateCover() ? 'separate' : 'together')");
    // Any other writer of this segment would be a second source of truth.
    const writers = appSource.split('\n').filter((l) => l.includes("setActiveSegment(coverModeGroup, 'cover'"));
    expect(writers).toHaveLength(1);
  });

  it('shows the document reason ahead of the wrap-cover reason when both apply', () => {
    // Naming the wrap cover would be a lie: turning it off still would not free
    // the button on a document under 8 pages.
    const body = extractFunctionBody('function updateCoverAvailability(');
    const tooFewAt = body.indexOf("t('config.coverDisabledHint')");
    const conflictAt = body.indexOf("t('config.coverWrapConflictHint')");
    const defaultAt = body.indexOf("t('config.coverHint')");
    expect(tooFewAt).toBeGreaterThan(-1);
    expect(conflictAt).toBeGreaterThan(tooFewAt);
    expect(defaultAt).toBeGreaterThan(conflictAt);
  });

  it('re-runs availability whenever the wrap-cover toggle moves, in both directions', () => {
    const handler = sourceBetween("wrapCoverToggleGroup.addEventListener('click'", "wrapCoverFormatGroup.addEventListener");
    expect(handler).toContain('updateCoverAvailability()');
  });

  it('clears the wrap-cover state before reconciling the separate-cover segment on reset', () => {
    const body = extractFunctionBody('function resetPicker(');
    expect(body.indexOf('bookletWrapCover = false')).toBeGreaterThan(-1);
    expect(body.indexOf('updateCoverAvailability()')).toBeGreaterThan(body.indexOf('bookletWrapCover = false'));
  });

  it('a short document with a wrap cover is measurable — the separate-cover guard must not swallow it', () => {
    // bookletBlockMetrics returns null for separate-cover-on-too-short, and the
    // spine readout reads null as "no document loaded". Routing through the
    // effective value keeps a 6-page wrap-cover job out of that branch.
    const helper = sourceBetween('function bookletBlockMetrics(', 'function wrapCoverSheetSize(');
    expect(helper).toContain('if (separateCover && bookletOriginalPages < 8) return null');
  });

  it('defines the conflict hint in both languages', () => {
    setLanguage('en');
    expect(t('config.coverWrapConflictHint')).not.toBe('config.coverWrapConflictHint');
    const trDictionary = i18nSource.slice(i18nSource.indexOf('\n  tr: {'));
    expect(trDictionary).toContain("'config.coverWrapConflictHint':");
  });
});
