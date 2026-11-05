import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit suite for the Stitch 3-step booklet-settings prototype restoration.
//
// Matches /home/ruveys/Downloads/stitich/booklet/screen.png and code.html:
// - Top stepper / tab bar completely removed
// - Top header only has back button, title, and subtitle
// - 3-step flow: Layout (Step 1) -> Cover (Step 2) -> Print & Flow (Step 3)
// - Step 1 & 2 bottom dock has summary capsule, 3 dots, and next hint ("... için kaydırın >")
// - #generateBtn ("Kitapçığı Oluştur") is hidden on Steps 1 & 2, only visible on Step 3
// - Zero-scroll viewport contracts & warm orange palette maintained

const root = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf-8');

const indexHtml = read('index.html');
const stylesCss = read('src/ui/styles.css');
const appTs = read('src/ui/app.ts');
const i18nTs = read('src/i18n/index.ts');

/** The `<section id="screen-config">` slice, up to the next screen. */
function configSection(): string {
  const start = indexHtml.indexOf('id="screen-config"');
  expect(start, 'expected #screen-config in index.html').toBeGreaterThan(0);
  const nextScreen = indexHtml.slice(start).search(/id="screen-(?!config)/);
  expect(nextScreen, 'expected another screen after #screen-config').toBeGreaterThan(0);
  return indexHtml.slice(start, start + nextScreen);
}

/** Removes TS/JS line + block comments while preserving string literals. */
function stripTsComments(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'single' : c === '"' ? 'double' : 'template';
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c + (n ?? '');
      i += 2;
      continue;
    }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Brace-matched block starting at the first `{` at/after `marker`. */
function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `expected to find "${marker}"`).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', at);
  expect(braceStart, `expected an opening brace after "${marker}"`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated block for "${marker}"`);
}

/** One CSS rule body (`selector { … }`) at top level. */
function cssRule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `expected a top-level "${selector} {" rule`).toBeGreaterThanOrEqual(0);
  return blockAfter(css, `\n${selector} {`);
}

/** Attribute map of a single HTML start tag. */
function attrs(tag: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) map[m[1]] = m[2];
  return map;
}

const configScreen = configSection();
const panelTags = [...configScreen.matchAll(/<div[^>]*class="config-step-panel[^"]*"[^>]*>/g)].map((m) => m[0]);

describe('Stitch 3-step prototype restoration — clutter-free header and 3-step layout', () => {
  it('has completely removed the top stepper and tab bar from index.html', () => {
    expect(indexHtml).not.toContain('class="config-stepper"');
    expect(indexHtml).not.toContain('role="tablist" aria-label="Booklet Settings Steps"');
    expect(indexHtml).not.toContain('class="config-tab');
    expect(indexHtml).not.toContain('id="configTab-layout"');
    expect(indexHtml).not.toContain('id="configTab-cover"');
    expect(indexHtml).not.toContain('id="configTab-pages"');
    expect(indexHtml).not.toContain('id="configTab-print"');
  });

  it('declares exactly three step panels: Layout, Cover, and Print', () => {
    expect(panelTags).toHaveLength(3);
    const panelIds = panelTags.map((t) => attrs(t).id);
    expect(panelIds).toEqual(['configStepLayout', 'configStepCover', 'configStepPrint']);
    expect(configScreen).not.toContain('id="configStepPages"');
  });

  it('starts on Step 1: Layout visible, Cover and Print panels hidden', () => {
    const visible = panelTags.filter((t) => !/(^|\s)hidden(\s|$)/.test(attrs(t).class ?? ''));
    expect(visible.map((t) => attrs(t).id)).toEqual(['configStepLayout']);
  });

  it('includes back button, title, and subtitle in the top header', () => {
    expect(configScreen).toContain('id="configBackBtn"');
    expect(configScreen).toContain('stitch-back-btn');
    expect(configScreen).toContain('stitch-header-title');
    expect(configScreen).toContain('id="stitchStepSubtitle"');
  });

  it('implements switchConfigTab with 3 steps in app.ts', () => {
    const body = blockAfter(appTs, "function switchConfigTab(tab: 'layout' | 'cover' | 'print'): void {");
    expect(body).toContain("panel: configStepLayout, name: 'layout'");
    expect(body).toContain("panel: configStepCover, name: 'cover'");
    expect(body).toContain("panel: configStepPrint, name: 'print'");
    expect(body).toContain('updateStitchDock(tab);');
    expect(appTs).not.toContain("const configStepPages = byId<HTMLDivElement>('configStepPages');");
  });
});

describe('Stitch 2-step prototype restoration — bottom dock & conditional CTA', () => {
  it('declares 2 step dots in #stitchStepNav', () => {
    const navMatch = configScreen.match(/<div[^>]*id="stitchStepNav"[^>]*>([\s\S]*?)<\/div>/);
    expect(navMatch).not.toBeNull();
    const dots = [...navMatch![1].matchAll(/<button[^>]*class="stitch-step-dot[^"]*"[^>]*>/g)];
    expect(dots).toHaveLength(2);
    expect(dots.map((d) => attrs(d[0])['data-step'])).toEqual(['1', '2']);
  });

  it('initializes generateBtn with .hidden on Step 1', () => {
    const genBtnMatch = configScreen.match(/<button[^>]*id="generateBtn"[^>]*>/);
    expect(genBtnMatch).not.toBeNull();
    expect(genBtnMatch![0]).toContain('hidden');
  });

  it('hides generateBtn on Step 1 and reveals it only on Step 2 in updateStitchDock', () => {
    const dockFn = blockAfter(appTs, "function updateStitchDock(tab: 'layout' | 'cover' | 'print'): void {");
    expect(dockFn).toContain('current.step === 2');
    expect(dockFn).toContain("generateBtn.classList.remove('hidden')");
    expect(dockFn).toContain("generateBtn.classList.add('hidden')");
    expect(dockFn).toContain("stitchNextHint.classList.add('hidden')");
    expect(dockFn).toContain("stitchNextHint.classList.remove('hidden')");
  });

  it('updates elongated pill and inactive dots in updateStitchDock', () => {
    const dockFn = blockAfter(appTs, "function updateStitchDock(tab: 'layout' | 'cover' | 'print'): void {");
    expect(dockFn).toContain("dot.classList.toggle('is-active', isActive)");
    expect(dockFn).toContain("dot.classList.toggle('stitch-step-pill-active', isActive)");
    expect(dockFn).toContain("dot.setAttribute('aria-selected', String(isActive))");
  });
});

describe('Stitch 2-step prototype restoration — gesture & dot navigation', () => {
  it('wires dots in stitchStepNav to switchConfigTab', () => {
    const navAt = appTs.indexOf("const stepTabs: Array<'layout' | 'print'>");
    expect(navAt).toBeGreaterThan(0);
    const navBlock = stripTsComments(appTs.slice(navAt, navAt + 500));
    expect(navBlock).toContain("['layout', 'print']");
    expect(navBlock).toContain('switchConfigTab(stepTabs[idx])');
  });

  it('wires stitchNextHint to step from layout -> print', () => {
    const hintAt = appTs.indexOf("stitchNextHint.addEventListener('click'");
    expect(hintAt).toBeGreaterThan(0);
    const hintBlock = stripTsComments(appTs.slice(hintAt, hintAt + 300));
    expect(hintBlock).toContain("currentConfigTab === 'layout'");
    expect(hintBlock).toContain("switchConfigTab('print')");
  });

  it('wires configBackBtn to step back print -> layout -> picker', () => {
    const backBlock = stripTsComments(blockAfter(appTs, 'if (configBackBtn) {'));
    expect(backBlock).toContain("currentConfigTab === 'print'");
    expect(backBlock).toContain("switchConfigTab('layout')");
    expect(backBlock).toContain("showScreen('picker')");
  });

  it('supports horizontal swipe gestures between 2 steps starting over cards and buttons while excluding sliders', () => {
    const bodySwipe = stripTsComments(blockAfter(appTs, 'if (configBody) {'));
    expect(bodySwipe).toContain("currentConfigTab === 'layout'");
    expect(bodySwipe).toContain("switchConfigTab('print')");
    expect(bodySwipe).toContain("currentConfigTab === 'print'");
    expect(bodySwipe).toContain("switchConfigTab('layout')");
    expect(bodySwipe).toContain('input[type="range"]');
    expect(bodySwipe).not.toContain("target.closest('input, textarea, select, button");
    expect(bodySwipe).toContain("window.addEventListener('click'");
  });

  it('updates formaBadge with exact page count without multiplying by 4', () => {
    const badgeBlock = stripTsComments(blockAfter(appTs, 'function updateFormaBadge(): void {'));
    expect(badgeBlock).toContain('formaBadge.textContent = `${bookletSignature} ${pagesSuffix}`;');
    expect(badgeBlock).not.toContain('sheets * 4');
  });
});

describe('Stitch 2-step prototype restoration — invalid blank-page input jumps to Step 2 (print)', () => {
  const generateBlock = stripTsComments(blockAfter(appTs, "generateBtn.addEventListener('click', async () => {"));

  it('lands on Step 2 (print) when parseInsertBlank() rejects the input', () => {
    const parseAt = generateBlock.indexOf('if (insertBlankAfter === null)');
    expect(parseAt).toBeGreaterThanOrEqual(0);
    const branch = generateBlock.slice(parseAt);
    const jumpAt = branch.indexOf('switchConfigTab(');
    expect(jumpAt).toBeGreaterThanOrEqual(0);
    expect(branch.slice(jumpAt, jumpAt + 40)).toContain("switchConfigTab('print')");
  });

  it('keeps visible error affordances on validation failure', () => {
    const parseAt = generateBlock.indexOf('if (insertBlankAfter === null)');
    const branch = generateBlock.slice(parseAt, parseAt + 600);
    expect(branch).toContain("t('config.insertBlankError')");
    expect(branch).toContain("insertBlankError.classList.remove('hidden')");
    expect(branch).toContain("insertBlankInput.setAttribute('aria-invalid', 'true')");
    expect(branch).toContain('insertBlankInput.focus()');
    expect(branch).toContain('insertBlankInput.scrollIntoView(');
    expect(branch).toContain('return;');
  });
});

describe('Stitch prototype restoration — Stitch card classes & indigo palette', () => {
  it('renders the config steps as Stitch cards', () => {
    expect(configScreen.match(/class="[^"]*\bstitch-card\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(configScreen).toContain('stitch-card-head');
    expect(configScreen).toContain('stitch-card-title');
    expect(configScreen).toContain('stitch-card-divider');
    expect(configScreen).toContain('stitch-step-nav');
    expect(configScreen).toContain('stitch-back-btn');
  });

  it('defines the terracotta brand token set from Atölye theme', () => {
    const stitchSection = stylesCss.slice(
      stylesCss.indexOf('Stitch Design Language Tokens'),
      stylesCss.indexOf('Container enclosing the entire configuration flow'),
    );
    expect(stitchSection.length).toBeGreaterThan(1000);
    expect(stitchSection).toContain('--stitch-primary: #9a401d;');
    expect(stitchSection).toContain('--stitch-primary-hover: #8a3819;');
    expect(stitchSection).toContain('--stitch-primary-tint-50: #FAF0EC;');
    expect(stitchSection).toContain('--stitch-primary-glow: rgba(154, 64, 29, 0.28);');
    expect(stitchSection).toContain('--stitch-step-dot-active: #9a401d;');
  });

  it('paints from the Stitch tokens', () => {
    const stitchSection = stylesCss.slice(
      stylesCss.indexOf('Stitch Design Language Tokens'),
      stylesCss.indexOf('Container enclosing the entire configuration flow'),
    );
    expect(stitchSection).toContain('--stitch-primary: #9a401d;');
    const cta = cssRule(stylesCss, '#configStickyFooter #generateBtn');
    expect(cta).toContain('background: var(--stitch-primary)');
  });

  it('keeps the zero-scroll viewport contract that the design depends on', () => {
    const screen = cssRule(stylesCss, '#screen-config');
    expect(screen).toContain('overflow: hidden');
    expect(screen).toContain('height: 100%');
    expect(cssRule(stylesCss, '.config-body')).toContain('overflow: hidden');
    const panel = cssRule(stylesCss, '.config-step-panel');
    expect(panel).toContain('overflow-y: auto');
    expect(panel).toContain('overscroll-behavior: contain');
    const footer = cssRule(stylesCss, '#configStickyFooter');
    expect(footer).toContain('flex-shrink: 0');
  });
});

describe('Stitch 3-step prototype restoration — no regression for essential wiring', () => {
  const bindingPoints = [
    'paperSizeGroup',
    'signatureSizeGroup',
    'signatureInfoBtn',
    'signatureHintText',
    'bindingGroup',
    'flipEdgeGroup',
    'wrapCoverToggleGroup',
    'wrapCoverOptions',
    'coverModeGroup',
    'insertBlankInput',
    'insertBlankError',
    'sheetOrderGroup',
    'instructionsGroup',
    'gutterSlider',
    'creepSlider',
    'marksGroup',
  ];

  it('keeps all 16 essential control IDs on the config screen', () => {
    for (const id of bindingPoints) {
      expect(configScreen, `missing control #${id}`).toContain(`id="${id}"`);
    }
  });

  it('keeps all legacy feature IDs (excluding deleted top stepper tabs)', () => {
    const legacy = `
      screen-config configStepLayout
      paperSizeGroup signatureInfoBtn signatureSizeGroup signatureHintText bindingGroup flipEdgeGroup
      configStepCover wrapCoverToggleGroup wrapCoverHintText coverSlot wrapCoverOptions
      wrapCoverBindingGroup wrapCoverBindingHint wrapCoverKindRow wrapCoverKindGroup wrapCoverKindHint
      wrapCoverBoardThicknessBlock wrapCoverBoardGroup wrapCoverFormatGroup wrapCoverFormatHint
      wrapCoverFormatResultLine wrapCoverGsmGroup wrapCoverPaletteGroup wrapCoverTitleInput
      wrapCoverAuthorInput wrapCoverSynopsisInput wrapCoverSummaryCard wrapCoverSpineLabel
      wrapCoverPaperBulkBadge wrapCoverThreadSwellBadge wrapCoverHingeBadge wrapCoverFitBadge
      wrapCoverPaperFitBadge wrapCoverDimsLabel wrapCoverMiniPreview wrapCoverMiniSynopsis
      wrapCoverMiniSpine wrapCoverMiniSpineText wrapCoverMiniTitle wrapCoverMiniAuthor
      configStepPrint advancedToggle advancedBadge advancedPanel gutterValueLabel gutterSlider
      creepValueLabel creepSlider creepPaperGsm creepPaperTypeGroup coverModeGroup coverHintText
      marksGroup marksHintText sheetOrderGroup instructionsGroup insertBlankInput insertBlankError
      configStickyFooter configSummary configPreflightWarning configPreflightWarningText
      generateBtn generateBtnLabel generateSpinner
    `
      .trim()
      .split(/\s+/);
    const missing = legacy.filter((id) => !configScreen.includes(`id="${id}"`));
    expect(missing, `IDs dropped by restoration: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships EN + TR strings for step labels, hints, and subtitles', () => {
    const keys = [
      'config.stitchTitle',
      'config.stitchStepSubtitle',
      'config.stitchStepSubtitle1',
      'config.stitchStepSubtitle2',
      'config.stitchStepSubtitle3',
      'config.stitchNextHint1',
      'config.stitchNextHint2',
      'config.backBtnLabel',
      'cover.spineBasisDesc',
    ];
    for (const key of keys) {
      const occurrences = i18nTs.split(`'${key}':`).length - 1;
      expect(occurrences, `${key} must exist in both dictionaries`).toBe(2);
      expect(i18nTs).not.toContain(`'${key}': '${key}'`);
    }
    expect(indexHtml).toContain('id="stitchStepSubtitle" data-i18n="config.stitchStepSubtitle"');
    expect(indexHtml).toContain('data-i18n-aria-label="config.backBtnLabel"');
  });

  it('leaves the tab panels inside #screen-config so booklet-flow slicing still finds the cover block', () => {
    const slice = indexHtml.slice(indexHtml.indexOf('id="screen-config"'), indexHtml.indexOf('id="advancedPanel"'));
    expect(slice).toContain('id="wrapCoverToggleGroup"');
    expect(slice).toContain('id="wrapCoverOptions"');
    expect(slice).toContain('id="configStepCover"');
  });
});
