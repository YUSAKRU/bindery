import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract for the booklet settings screen (flow review, 2026-11-22).
//
// The old three-step wizard (Layout -> Print -> Summary) became one screen:
// - the shared top bar (title + back) replaces the floating back pill/header
// - print overrides sit behind one collapsed "Advanced print settings" row
// - the read-only summary step is gone; its yield line sits in a bottom bar
//   right above the one primary action, which therefore never moves
// - segmented controls are real touch targets (>= 40px) and the signature
//   sizes fit one row (Auto / Single / Other -> 4 / 8 / 16 / 32)

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
const appCode = stripTsComments(appTs);

describe('settings screen — one screen, no wizard', () => {
  it('has exactly one settings panel, and it is visible', () => {
    expect(panelTags.map((t) => attrs(t).id)).toEqual(['configStepLayout']);
    expect(attrs(panelTags[0]).class).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('has no step panels, step buttons, step dots or duplicate back links left in the markup', () => {
    for (const id of [
      'configStepPrint',
      'configStepSummary',
      'step1NextBtn',
      'step2NextBtn',
      'step2BackLink',
      'step3GenerateBtn',
      'step3BackLink',
      'stitchStepNav',
      'stitchNextHint',
      'configBackBtn',
      'stitchStepSubtitle',
      'summarySpecCard',
      'printPresetModeGroup',
      'toggleDetailedSettingsBtn',
    ]) {
      expect(indexHtml, `#${id} should be gone`).not.toContain(`id="${id}"`);
    }
    expect(configScreen).not.toContain('⬅');
  });

  it('has no step-switching or swipe logic left in app.ts', () => {
    expect(appCode).not.toContain('switchConfigTab');
    expect(appCode).not.toContain('currentConfigTab');
    expect(appCode).not.toContain('updateStitchDock');
    expect(appCode).not.toMatch(/configBody\.addEventListener\('touch/);
  });

  it('uses the shared top bar (title + back) instead of a private header', () => {
    const hideList = stylesCss.slice(
      stylesCss.indexOf('/* 1. Shell Integration when #screen-hub is active */'),
      stylesCss.indexOf('#screen-hub {'),
    );
    expect(hideList).not.toContain('#screen-config');
    expect(stylesCss).toContain('.app:has(#screen-config:not(.hidden)) .top-bar,\n.app:has(#screen-result:not(.hidden)) .top-bar {');
    expect(stylesCss).toContain(
      '.app:has(#screen-config:not(.hidden)) .top-bar-title,\n.app:has(#screen-result:not(.hidden)) .top-bar-title {',
    );
  });
});

describe('settings screen — bottom action bar', () => {
  const footer = configScreen.slice(configScreen.indexOf('id="configStickyFooter"'));

  it('holds the live yield line and the generate button, both in the bar', () => {
    expect(footer).toContain('id="configSummary"');
    expect(footer).toContain('id="generateBtn"');
    expect(footer.indexOf('id="configSummary"')).toBeLessThan(footer.indexOf('id="generateBtn"'));
  });

  it('shows the generate button from the start (no step gates it)', () => {
    const tag = configScreen.match(/<button[^>]*id="generateBtn"[^>]*>/);
    expect(tag).not.toBeNull();
    expect(attrs(tag![0]).class).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('is laid out as a visible, non-shrinking bar under the scrolling panel', () => {
    const bar = cssRule(stylesCss, '#configStickyFooter');
    expect(bar).not.toContain('display: none');
    expect(bar).toContain('flex-shrink: 0');
    expect(bar).toContain('env(safe-area-inset-bottom');
    expect(cssRule(stylesCss, '#configStickyFooter #generateBtn')).toContain('background: var(--stitch-primary)');
  });

  it('keeps the scroll inside the panel, not the screen', () => {
    const screen = cssRule(stylesCss, '#screen-config');
    expect(screen).toContain('overflow: hidden');
    expect(screen).toContain('height: 100%');
    expect(cssRule(stylesCss, '.config-body')).toContain('overflow: hidden');
    const panel = cssRule(stylesCss, '.config-step-panel');
    expect(panel).toContain('overflow-y: auto');
    expect(panel).toContain('overscroll-behavior: contain');
  });
});

describe('settings screen — advanced print settings behind one row', () => {
  it('puts the disclosure row and its panel inside the settings panel, collapsed', () => {
    const panelStart = configScreen.indexOf('id="configStepLayout"');
    const toggleAt = configScreen.indexOf('id="advancedToggle"');
    const panelAt = configScreen.indexOf('id="advancedPanel"');
    const footerAt = configScreen.indexOf('id="configStickyFooter"');
    expect(toggleAt).toBeGreaterThan(panelStart);
    expect(panelAt).toBeGreaterThan(toggleAt);
    expect(footerAt).toBeGreaterThan(panelAt);

    const toggle = attrs(configScreen.match(/<button[^>]*id="advancedToggle"[^>]*>/)![0]);
    expect(toggle.class).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(toggle['aria-expanded']).toBe('false');
    expect(toggle['aria-controls']).toBe('advancedPanel');
    const panel = attrs(configScreen.match(/<section[^>]*id="advancedPanel"[^>]*>/)![0]);
    expect(panel.class).toMatch(/(^|\s)hidden(\s|$)/);
  });

  it('opens and closes through one function that keeps aria-expanded in step', () => {
    const body = blockAfter(appTs, 'function setAdvancedOpen(open: boolean): void {');
    expect(body).toContain("advancedPanel.classList.toggle('hidden', !open)");
    expect(body).toContain("advancedToggle.setAttribute('aria-expanded', String(open))");
    const click = blockAfter(appTs, "advancedToggle.addEventListener('click', () => {");
    expect(click).toContain('setAdvancedOpen(willOpen)');
  });

  it('says "Recommended" or "Modified" from isAdvancedModified, which ignores the on-screen binding and flip edge', () => {
    const badge = blockAfter(appTs, 'function updateAdvancedBadge(): void {');
    expect(badge).toContain('isAdvancedModified()');
    expect(badge).toContain("advancedBadge.classList.toggle('hidden', !modified)");
    expect(badge).toContain("advancedDefaultLabel.classList.toggle('hidden', modified)");
    const modified = stripTsComments(blockAfter(appTs, 'function isAdvancedModified(): boolean {'));
    expect(modified).not.toContain('bookletFlipEdge');
    expect(modified).not.toContain('bookletBinding');
    expect(modified).toContain('gutterSlider');
    expect(modified).toContain('insertBlankInput');
  });

  it('opens the advanced section when the blank-page field is invalid at generate time', () => {
    const generateBlock = stripTsComments(blockAfter(appTs, "generateBtn.addEventListener('click', async () => {"));
    const parseAt = generateBlock.indexOf('if (insertBlankAfter === null)');
    expect(parseAt).toBeGreaterThanOrEqual(0);
    const branch = generateBlock.slice(parseAt, parseAt + 600);
    expect(branch).toContain('setAdvancedOpen(true)');
    expect(branch).toContain("t('config.insertBlankError')");
    expect(branch).toContain("insertBlankError.classList.remove('hidden')");
    expect(branch).toContain("insertBlankInput.setAttribute('aria-invalid', 'true')");
    expect(branch).toContain('insertBlankInput.focus()');
    expect(branch).toContain('insertBlankInput.scrollIntoView(');
    expect(branch).toContain('return;');
  });
});

describe('settings screen — signature sizes and touch targets', () => {
  const group = configScreen.match(/<div[^>]*id="signatureSizeGroup"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);

  it('shows Auto, Single and Other on one row, with 4/8/16/32 on a hidden sub-row', () => {
    expect(group).not.toBeNull();
    const html = group![1];
    const mainRow = html.slice(0, html.indexOf('id="signatureSizeMore"'));
    const subRow = html.slice(html.indexOf('id="signatureSizeMore"'));
    expect([...mainRow.matchAll(/data-sig="([^"]+)"/g)].map((m) => m[1])).toEqual(['auto', 'single']);
    expect(mainRow).toContain('id="signatureMoreBtn"');
    expect([...subRow.matchAll(/data-sig="([^"]+)"/g)].map((m) => m[1])).toEqual(['4', '8', '16', '32']);
    expect(configScreen).toMatch(/<div class="stitch-sub-segmented hidden" id="signatureSizeMore">/);
  });

  it('lights "Other" and keeps its row open while a numeric size is selected', () => {
    const body = stripTsComments(blockAfter(appTs, 'function syncSignatureMore(open?: boolean): void {'));
    expect(body).toContain("const numeric = bookletSignature !== 'auto' && bookletSignature !== 'single';");
    expect(body).toContain('const show = numeric ||');
    expect(body).toContain("signatureMoreBtn.classList.toggle('is-active', numeric)");
    expect(body).toContain("signatureMoreBtn.setAttribute('aria-expanded', String(show))");
    const click = stripTsComments(blockAfter(appTs, "signatureSizeGroup.addEventListener('click',"));
    expect(click.indexOf('btn === signatureMoreBtn')).toBeLessThan(click.indexOf('bookletSignature = sig'));
  });

  it('exposes the "What is a signature?" explainer next to the signature title', () => {
    const forma = configScreen.slice(configScreen.indexOf('data-i18n="config.signatureSize"'), configScreen.indexOf('id="signatureSizeGroup"'));
    const btn = forma.match(/<button[^>]*id="signatureInfoBtn"[^>]*>/);
    expect(btn).not.toBeNull();
    expect(attrs(btn![0]).class).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(attrs(btn![0])['aria-hidden']).toBeUndefined();
  });

  it('gives segmented pills at least 40px and text links at least 44px of height', () => {
    const pill = cssRule(stylesCss, '.stitch-pill-btn,\n#screen-config .segmented-btn');
    const pillH = Number(pill.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    expect(pillH).toBeGreaterThanOrEqual(40);
    const link = cssRule(stylesCss, '.stitch-info-link');
    expect(Number(link.match(/min-height:\s*(\d+)px/)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
  });

  it('keeps the binding icons outside the translated text so a language pass cannot wipe them', () => {
    const binding = configScreen.match(/<div[^>]*id="bindingGroup"[^>]*>([\s\S]*?)<\/div>/)![1];
    const buttons = [...binding.matchAll(/<button[^>]*>/g)].map((m) => attrs(m[0]));
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b['data-i18n']).toBeUndefined();
    expect(binding.match(/<svg class="stitch-pill-icon"/g)).toHaveLength(2);
    expect(binding).toContain('<span data-i18n="config.binding.ltr">');
    expect(binding).toContain('<span data-i18n="config.binding.rtl">');
  });
});

describe('booklet flow — picker and shared design tokens', () => {
  it('does not use CSS variables that are never defined (they rendered square, shadowless buttons)', () => {
    for (const name of ['--radius-pill', '--atelier-terracotta-glow']) {
      const used = stylesCss.includes(`var(${name})`);
      const defined = new RegExp(`${name}\\s*:`).test(stylesCss);
      expect(used && !defined, `${name} is used but never defined`).toBe(false);
    }
  });

  it('drops the picker Continue button to the bottom once a file is chosen, privacy line above it', () => {
    expect(cssRule(stylesCss, '#screen-picker[data-state="ready"] .picker-slot-continue,\n#screen-picker[data-state="reading"] .picker-slot-continue')).toContain('order: 2');
    expect(cssRule(stylesCss, '#screen-picker[data-state="ready"] .workshop-privacy-footer,\n#screen-picker[data-state="reading"] .workshop-privacy-footer')).toContain('order: 1');
    expect(cssRule(stylesCss, '#screen-picker[data-state="ready"] .picker-stage,\n#screen-picker[data-state="reading"] .picker-stage')).toContain('margin-block: auto');
  });

  it('defines the terracotta brand token set', () => {
    const stitchSection = stylesCss.slice(
      stylesCss.indexOf('Stitch Design Language Tokens'),
      stylesCss.indexOf('Container enclosing the entire configuration flow'),
    );
    expect(stitchSection.length).toBeGreaterThan(1000);
    expect(stitchSection).toContain('--stitch-primary: #9a401d;');
    expect(stitchSection).toContain('--stitch-primary-glow: rgba(154, 64, 29, 0.28);');
  });
});

describe('settings screen — no regression for essential wiring', () => {
  it('keeps every control the generator reads', () => {
    const ids = `
      screen-config configStepLayout
      paperSizeGroup signatureInfoBtn signatureSizeGroup signatureHintText bindingGroup flipEdgeGroup
      advancedToggle advancedBadge advancedPanel gutterValueLabel gutterSlider
      creepValueLabel creepSlider creepPaperGsm creepPaperTypeGroup coverModeGroup coverHintText
      marksGroup marksHintText sheetOrderGroup instructionsGroup insertBlankInput insertBlankError
      configStickyFooter configSummary configPreflightWarning configPreflightWarningText
      generateBtn generateBtnLabel generateSpinner
    `
      .trim()
      .split(/\s+/);
    const missing = ids.filter((id) => !configScreen.includes(`id="${id}"`));
    expect(missing, `IDs dropped: ${missing.join(', ')}`).toEqual([]);
  });

  it('ships EN + TR strings for the new labels', () => {
    for (const key of ['config.advancedPrint', 'config.advancedDefault', 'config.advancedModified', 'config.signatureWhat', 'config.signature.more']) {
      const occurrences = i18nTs.split(`'${key}':`).length - 1;
      expect(occurrences, `${key} must exist in both dictionaries`).toBe(2);
    }
  });

  it('keeps the separate-cover anchors inside #screen-config', () => {
    expect(configScreen).toContain('id="coverModeGroup"');
    expect(configScreen).toContain('id="coverHintText"');
    expect(configScreen).not.toContain('id="wrapCoverToggleGroup"');
  });

  it('aligns static is-active defaults with resetPicker()', () => {
    const paperGroup = configScreen.match(/<div[^>]*id="paperSizeGroup"[^>]*>([\s\S]*?)<\/div>/);
    const paperButtons = [...paperGroup![1].matchAll(/<button[^>]*>/g)].map((m) => attrs(m[0]));
    expect(paperButtons.find((b) => b['data-paper'] === 'source')?.['data-i18n']).toBe('config.paperSource');
    expect(paperButtons.filter((b) => /(^|\s)is-active(\s|$)/.test(b.class ?? '')).map((b) => b['data-paper'])).toEqual(['A4']);

    const sigButtons = [...configScreen.match(/<div[^>]*id="signatureSizeGroup"[^>]*>([\s\S]*?)<\/div>/)![1].matchAll(/<button[^>]*>/g)].map((m) => attrs(m[0]));
    expect(sigButtons.filter((b) => /(^|\s)is-active(\s|$)/.test(b.class ?? '')).map((b) => b['data-sig'])).toEqual(['auto']);

    const resetBody = blockAfter(appTs, 'function resetPicker(): void {');
    expect(resetBody).toContain("setActiveSegment(paperSizeGroup, 'paper', 'A4')");
    expect(resetBody).toContain("setActiveSegment(signatureSizeGroup, 'sig', 'auto')");
    expect(resetBody).toContain('syncSignatureMore(false)');

    const applyBody = blockAfter(appTs, 'function applyStoredBookletSettings(settings: StoredBookletSettings): void {');
    expect(applyBody).toContain("options.signatureSize === undefined ? 'single' : String(options.signatureSize)");
    expect(applyBody).toContain("setActiveSegment(signatureSizeGroup, 'sig', bookletSignature)");
    expect(applyBody).toContain('syncSignatureMore();');
  });
});
