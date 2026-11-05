import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Independent audit suite for the Stitch 4-step booklet-settings redesign.
//
// This project ships no jsdom/happy-dom (see src/ui/app.dom.test.ts for the
// standing note), so — like every other UI test here — these assertions run
// against the real sources. The difference from the earlier stepper suite is
// that every check below reads an extracted *executable* block (brace-matched,
// comments stripped) instead of grepping the whole file. A string that only
// survives inside a `//` comment does not satisfy these tests; that weakness is
// exactly what let the 3-tab suite keep passing after the code moved to 4 tabs.

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
    // String states: copy verbatim, honouring escapes, until the closing quote.
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

const tabTags = [...indexHtml.matchAll(/<button[^>]*class="config-tab[^"]*"[^>]*>/g)].map((m) => m[0]);
const panelTags = [...indexHtml.matchAll(/<div[^>]*class="config-step-panel[^"]*"[^>]*>/g)].map((m) => m[0]);

describe('Stitch 4-step redesign — tab navigation (Layout → Cover → Pages → Print)', () => {
  it('declares exactly four tabs on one role="tablist"', () => {
    expect(indexHtml).toContain('class="config-stepper" role="tablist"');
    expect(tabTags).toHaveLength(4);
    expect(tabTags.map((t) => attrs(t)['data-tab'])).toEqual(['layout', 'cover', 'pages', 'print']);
    expect(tabTags.map((t) => attrs(t).id)).toEqual([
      'configTab-layout',
      'configTab-cover',
      'configTab-pages',
      'configTab-print',
    ]);
  });

  it('wires tab ⇄ tabpanel both ways and every referenced panel exists', () => {
    expect(panelTags).toHaveLength(4);
    const byId = new Map(panelTags.map((t) => [attrs(t).id, attrs(t)]));
    for (const tag of tabTags) {
      const a = attrs(tag);
      const panel = byId.get(a['aria-controls']);
      expect(panel, `tab ${a.id} controls a missing panel`).toBeDefined();
      expect(panel!['aria-labelledby']).toBe(a.id);
      expect(panel!.role).toBe('tabpanel');
    }
    // …and no orphan panel: every tabpanel is labelled by a real tab.
    const tabIds = new Set(tabTags.map((t) => attrs(t).id));
    for (const tag of panelTags) {
      expect(tabIds.has(attrs(tag)['aria-labelledby'])).toBe(true);
    }
  });

  it('starts on Step 1: Layout visible, the other three panels hidden', () => {
    const visible = panelTags.filter((t) => !/(^|\s)hidden(\s|$)/.test(attrs(t).class ?? ''));
    expect(visible.map((t) => attrs(t).id)).toEqual(['configStepLayout']);

    const layoutTab = attrs(tabTags[0]);
    expect(layoutTab['aria-selected']).toBe('true');
    expect(layoutTab.tabindex).toBe('0');
    expect(layoutTab.class).toContain('is-active');
    for (const tag of tabTags.slice(1)) {
      const a = attrs(tag);
      expect(a['aria-selected']).toBe('false');
      expect(a.tabindex).toBe('-1');
      expect(a.class).not.toContain('is-active');
    }
  });

  it('maps the new "pages" tab onto #configStepPages in switchConfigTab', () => {
    const body = blockAfter(appTs, "function switchConfigTab(tab: 'layout' | 'cover' | 'pages' | 'print'): void {");
    expect(body).toContain("id: 'configTab-layout', panel: configStepLayout, name: 'layout'");
    expect(body).toContain("id: 'configTab-cover', panel: configStepCover, name: 'cover'");
    expect(body).toContain("id: 'configTab-pages', panel: configStepPages, name: 'pages'");
    expect(body).toContain("id: 'configTab-print', panel: configStepPrint, name: 'print'");
    expect(appTs).toContain("const configStepPages = byId<HTMLDivElement>('configStepPages');");
  });

  it('keeps the dock indicator in step with the active tab', () => {
    const dock = blockAfter(appTs, 'function updateStitchDock(tab:');
    expect(dock).toContain('layout: { step: 1');
    expect(dock).toContain('cover: { step: 2');
    expect(dock).toContain('pages: { step: 3');
    expect(dock).toContain('print: { step: 4');
    expect(dock).toContain("dot.classList.toggle('stitch-step-pill-active', isActive)");
    expect(dock).toContain("dot.setAttribute('aria-selected', String(isActive))");
    // The dock must be driven from the single tab switch, not a second state machine.
    expect(blockAfter(appTs, "function switchConfigTab(tab: 'layout' | 'cover' | 'pages' | 'print'): void {")).toContain(
      'updateStitchDock(tab);',
    );
  });
});

describe('Stitch 4-step redesign — roving tabindex keyboard navigation', () => {
  const switchBody = blockAfter(appTs, "function switchConfigTab(tab: 'layout' | 'cover' | 'pages' | 'print'): void {");
  const keyBlock = stripTsComments(blockAfter(appTs, 'configTabButtons.forEach((tabBtn, index) => {'));

  it('roves tabindex and aria-selected as the single source of focus order', () => {
    expect(switchBody).toContain("tabEl.setAttribute('aria-selected', String(isActive))");
    expect(switchBody).toContain("tabEl.setAttribute('tabindex', isActive ? '0' : '-1')");
    expect(switchBody).toContain("tabEl.classList.toggle('is-active', isActive)");
    expect(switchBody).toContain("item.panel.classList.toggle('hidden', !isActive)");
  });

  it('cycles right/down and left/up with wraparound over all four tabs', () => {
    expect(keyBlock).toContain("e.key === 'ArrowRight' || e.key === 'ArrowDown'");
    expect(keyBlock).toContain("e.key === 'ArrowLeft' || e.key === 'ArrowUp'");
    expect(keyBlock).toContain('(index + 1) % configTabNames.length');
    expect(keyBlock).toContain('(index - 1 + configTabNames.length) % configTabNames.length');
  });

  it('supports Home → first step and End → last step, then moves real focus', () => {
    expect(keyBlock).toContain("e.key === 'Home'");
    expect(keyBlock).toContain('targetIndex = 0;');
    expect(keyBlock).toContain("e.key === 'End'");
    expect(keyBlock).toContain('targetIndex = configTabNames.length - 1;');
    expect(keyBlock).toContain('e.preventDefault()');
    expect(keyBlock).toContain('configTabButtons[targetIndex].focus()');
  });

  it('orders the roving set layout → cover → pages → print', () => {
    expect(appTs).toContain(
      "const configTabNames: Array<'layout' | 'cover' | 'pages' | 'print'> = ['layout', 'cover', 'pages', 'print'];",
    );
    expect(appTs).toContain(
      "const stepTabs: Array<'layout' | 'cover' | 'pages' | 'print'> = ['layout', 'cover', 'pages', 'print'];",
    );
  });
});

describe('Stitch 4-step redesign — invalid blank-page input jumps to Step 3', () => {
  const generateBlock = stripTsComments(blockAfter(appTs, "generateBtn.addEventListener('click', async () => {"));

  it('lands on the Pages step, not Print, when parseInsertBlank() rejects the input', () => {
    const parseAt = generateBlock.indexOf('if (insertBlankAfter === null)');
    expect(parseAt).toBeGreaterThanOrEqual(0);
    const branch = generateBlock.slice(parseAt);
    const jumpAt = branch.indexOf('switchConfigTab(');
    expect(jumpAt).toBeGreaterThanOrEqual(0);
    expect(branch.slice(jumpAt, jumpAt + 40)).toContain("switchConfigTab('pages')");
    // The pre-redesign target must be gone from executable code, not just from
    // the comment above it.
    expect(branch.slice(0, branch.indexOf('insertBlankError.classList.remove'))).not.toContain("switchConfigTab('print')");
  });

  it('keeps the visible error affordances on the same path', () => {
    const parseAt = generateBlock.indexOf('if (insertBlankAfter === null)');
    const branch = generateBlock.slice(parseAt, parseAt + 600);
    expect(branch).toContain("t('config.insertBlankError')");
    expect(branch).toContain("insertBlankError.classList.remove('hidden')");
    expect(branch).toContain("insertBlankInput.setAttribute('aria-invalid', 'true')");
    expect(branch).toContain('insertBlankInput.focus()');
    expect(branch).toContain('insertBlankInput.scrollIntoView(');
    expect(branch).toContain('return;');
  });

  it('only jumps after parsing fails (a valid value must not yank the user)', () => {
    const order = generateBlock.indexOf('const insertBlankAfter = parseInsertBlank();');
    const jump = generateBlock.indexOf("switchConfigTab('pages')");
    expect(order).toBeGreaterThanOrEqual(0);
    expect(jump).toBeGreaterThan(order);
    expect(generateBlock.slice(order, jump)).toContain('if (insertBlankAfter === null)');
  });
});

describe('Stitch 4-step redesign — Stitch card classes and warm orange palette', () => {
  it('renders the config steps as Stitch cards', () => {
    expect(configScreen.match(/class="[^"]*\bstitch-card\b/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(configScreen).toContain('stitch-card-head');
    expect(configScreen).toContain('stitch-card-title');
    expect(configScreen).toContain('stitch-card-divider');
    expect(configScreen).toContain('stitch-step-nav');
    expect(configScreen).toContain('stitch-back-btn');
  });

  it('defines the warm orange token set instead of indigo', () => {
    const stitchSection = stylesCss.slice(
      stylesCss.indexOf('Stitch Design Language Tokens'),
      stylesCss.indexOf('Container enclosing the entire configuration flow'),
    );
    expect(stitchSection.length).toBeGreaterThan(1000);
    expect(stitchSection).toContain('--stitch-primary: #ea580c;');
    expect(stitchSection).toContain('--stitch-primary-hover: #c2410c;');
    expect(stitchSection).toContain('--stitch-primary-tint-50: #fff7ed;');
    expect(stitchSection).toContain('--stitch-primary-glow: rgba(234, 88, 12, 0.35);');
    expect(stitchSection).toContain('--stitch-step-dot-active: #ea580c;');
  });

  it('paints from the Stitch tokens, never from the indigo --color-primary', () => {
    const stitchSection = stylesCss.slice(
      stylesCss.indexOf('Stitch Design Language Tokens'),
      stylesCss.indexOf('Container enclosing the entire configuration flow'),
    );
    expect(stitchSection).not.toContain('var(--color-primary)');
    for (const indigo of ['#4f46e5', '#6366f1', '#ede9fe', '#8b5cf6', '#a5b4fc']) {
      expect(stitchSection.toLowerCase()).not.toContain(indigo);
    }
    const cta = cssRule(stylesCss, '#configStickyFooter #generateBtn');
    expect(cta).toContain('background: var(--stitch-primary)');
    const activeTab = cssRule(stylesCss, '.config-tab.is-active,\n.config-tab[aria-selected="true"]');
    expect(activeTab).toContain('color: var(--stitch-pill-active-text)');
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

describe('Stitch 4-step redesign — no regression for existing wiring', () => {
  // The 16 control IDs the design blueprint treats as immutable binding points
  // (docs/CRITIC_STITCH_REPORT.md §5).
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

  it('keeps all 16 control IDs on the config screen', () => {
    for (const id of bindingPoints) {
      expect(configScreen, `missing control #${id}`).toContain(`id="${id}"`);
    }
  });

  it('keeps every one of the 70 pre-redesign config-screen IDs', () => {
    const legacy = `
      screen-config configTab-layout configTab-cover configTab-print configStepLayout
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
    expect(legacy).toHaveLength(70);
    const missing = legacy.filter((id) => !configScreen.includes(`id="${id}"`));
    expect(missing, `IDs dropped by the redesign: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships EN + TR strings for every new step label and hint', () => {
    const newKeys = [
      'config.tabPages',
      'config.stitchTitle',
      'config.stitchStepSubtitle1',
      'config.stitchStepSubtitle2',
      'config.stitchStepSubtitle3',
      'config.stitchStepSubtitle4',
      'config.stitchNextHint1',
      'config.stitchNextHint2',
      'config.stitchNextHint3',
      'config.stitchNextHint4',
      'config.backBtnLabel',
      'config.paperSource',
      'cover.spineBasisDesc',
    ];
    for (const key of newKeys) {
      const occurrences = i18nTs.split(`'${key}':`).length - 1;
      expect(occurrences, `${key} must exist in both dictionaries`).toBe(2);
      expect(i18nTs).not.toContain(`'${key}': '${key}'`);
    }
    // The static markup must be hooked up to those keys, not to a literal.
    expect(indexHtml).toContain('id="stitchStepSubtitle" data-i18n="config.stitchStepSubtitle1"');
    expect(indexHtml).toContain('data-i18n="config.tabPages"');
    expect(indexHtml).toContain('data-i18n-aria-label="config.backBtnLabel"');
  });

  it('leaves the tab panels inside #screen-config so booklet-flow slicing still finds the cover block', () => {
    const slice = indexHtml.slice(indexHtml.indexOf('id="screen-config"'), indexHtml.indexOf('id="advancedPanel"'));
    expect(slice).toContain('id="wrapCoverToggleGroup"');
    expect(slice).toContain('id="wrapCoverOptions"');
    expect(slice).toContain('id="configStepPages"');
  });
});
