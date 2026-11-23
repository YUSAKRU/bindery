import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  expect(start, `expected start marker "${startMarker}"`).toBeGreaterThan(-1);
  expect(end, `expected end marker "${endMarker}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function extractTagBlock(markup: string, openMarker: string, tagName: string): string {
  const start = markup.indexOf(openMarker);
  expect(start, `expected to find "${openMarker}" in index.html`).toBeGreaterThanOrEqual(0);
  const tagStart = markup.lastIndexOf(`<${tagName}`, start);
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'g');
  const closeRe = new RegExp(`</${tagName}>`, 'g');
  let depth = 0;
  let cursor = tagStart;
  while (cursor < markup.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(markup);
    const nextClose = closeRe.exec(markup);
    if (!nextClose) throw new Error(`unterminated <${tagName}> for "${openMarker}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return markup.slice(tagStart, cursor);
    }
  }
  throw new Error(`unterminated <${tagName}> for "${openMarker}"`);
}

function extractTokenSelectorBlocks(): { light: string; prefersDark: string; darkClass: string } {
  const lightStart = css.indexOf('/* 2. Scoped CSS Variables (Light Theme Default) */');
  const darkMediaStart = css.indexOf('/* Scoped Dark Mode Overrides */');
  const darkClassStart = css.indexOf(':root.dark-theme .atelier-hub,');
  const containerStart = css.indexOf('/* 3. Main Atelier Container & Millimeter Dot Grid */');

  expect(lightStart).toBeGreaterThan(-1);
  expect(darkMediaStart).toBeGreaterThan(lightStart);
  expect(darkClassStart).toBeGreaterThan(darkMediaStart);
  expect(containerStart).toBeGreaterThan(darkClassStart);

  return {
    light: css.slice(lightStart, darkMediaStart),
    prefersDark: css.slice(darkMediaStart, darkClassStart),
    darkClass: css.slice(darkClassStart, containerStart),
  };
}

const INDIGO_RE =
  /--color-primary(?:-rgb|-container)?\b|#4f46e5|#ede9fe|#a5b4fc|#3730a3|#7c8cf8|\b79\s*,\s*70\s*,\s*229\b|\b124\s*,\s*140\s*,\s*248\b|\b187\s*,\s*134\s*,\s*252\b/i;

describe('Atelier Files tab, Settings, and Recent Errors (T-12 step 5)', () => {
  const filesCss = extractSection(
    css,
    '/* Atelier Files Tab (#libraryFilesPanel & #fileActionsModal) */',
    '/* End Atelier Files Tab */',
  );
  const settingsCss = extractSection(
    css,
    '/* Atelier Settings & Recent Errors (#screen-settings & #screen-error-log) */',
    '/* End Atelier Settings & Recent Errors */',
  );

  it('registers #screen-settings, #screen-error-log, #fileActionsModal, and their chrome in all three Atelier token lists', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();

    const baseSelectors = [
      '#screen-settings',
      '#screen-error-log',
      '#fileActionsModal',
      '.app:has(#screen-settings:not(.hidden)) .top-bar',
      '.app:has(#screen-settings:not(.hidden)) .screen-container',
      '.app:has(#screen-error-log:not(.hidden)) .top-bar',
      '.app:has(#screen-error-log:not(.hidden)) .screen-container',
    ];

    const parseSelectorList = (raw: string): string[] =>
      raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const lightSelectors = parseSelectorList(light.slice(0, light.indexOf('{')));
    const prefersDarkSelectors = parseSelectorList(
      prefersDark.slice(
        prefersDark.indexOf(':root:not(.light-theme)'),
        prefersDark.indexOf('{', prefersDark.indexOf(':root:not(.light-theme)')),
      ),
    );
    const darkClassSelectors = parseSelectorList(darkClass.slice(0, darkClass.indexOf('{')));

    for (const sel of baseSelectors) {
      expect(lightSelectors, `light token block missing ${sel}`).toContain(sel);
      expect(
        prefersDarkSelectors,
        `prefers-color-scheme:dark token block missing :root:not(.light-theme) ${sel}`,
      ).toContain(`:root:not(.light-theme) ${sel}`);
      expect(
        darkClassSelectors,
        `:root.dark-theme token block missing :root.dark-theme ${sel}`,
      ).toContain(`:root.dark-theme ${sel}`);
    }
  });

  it('removes the .hero block and gear emoji from #screen-settings while preserving all original settings ids', () => {
    const settingsHtml = extractTagBlock(html, 'id="screen-settings"', 'section');
    expect(settingsHtml).not.toContain('class="hero"');
    expect(settingsHtml).not.toContain('hero-icon');
    expect(settingsHtml).not.toContain('⚙️');

    for (const id of [
      'settingsDarkThemeLabel',
      'settingsDarkModeToggle',
      'settingsLangSwitch',
      'settingsClearCacheBtn',
      'settingsErrorLogBtn',
      'settingsShareAppBtn',
      'settingsRateAppBtn',
      'appVersionValue',
    ]) {
      expect(settingsHtml, `missing #${id} in #screen-settings`).toContain(`id="${id}"`);
    }
  });

  it('uses no --color-primary* or indigo literals in Files, Settings, or Recent Errors CSS blocks', () => {
    expect(filesCss).not.toMatch(INDIGO_RE);
    expect(settingsCss).not.toMatch(INDIGO_RE);

    // Ensure no legacy .settings-* or .error-log-* rules elsewhere in styles.css still carry --color-primary*
    const legacyCss = css.replace(filesCss, '').replace(settingsCss, '');
    expect(legacyCss).not.toMatch(/\.settings-(?:group|row|lang)[^{]*\{[^}]*--color-primary/);
    expect(legacyCss).not.toMatch(/\.error-log-[^{]*\{[^}]*--color-primary/);
  });

  it('styles the Files folder tile with warm terracotta accent in light and dark themes', () => {
    expect(filesCss).toMatch(
      /#libraryFilesPanel \.file-item-thumb--folder\s*\{[^}]*background:\s*rgba\(154,\s*64,\s*29,\s*0?\.10?\)/,
    );
    expect(filesCss).toMatch(
      /#libraryFilesPanel \.file-item-thumb--folder \.tool-icon\s*\{[^}]*stroke:\s*var\(--atelier-primary\)/,
    );
    expect(filesCss).toMatch(
      /:root:not\(\.light-theme\) #libraryFilesPanel \.file-item-thumb--folder\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.16\)/,
    );
    expect(filesCss).toMatch(
      /:root:not\(\.light-theme\) #libraryFilesPanel \.file-item-thumb--folder \.tool-icon\s*\{[^}]*stroke:\s*#d9875f/i,
    );
    expect(filesCss).toMatch(
      /:root\.dark-theme #libraryFilesPanel \.file-item-thumb--folder\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.16\)/,
    );
    expect(filesCss).toMatch(
      /:root\.dark-theme #libraryFilesPanel \.file-item-thumb--folder \.tool-icon\s*\{[^}]*stroke:\s*#d9875f/i,
    );
  });

  it('includes both #screen-settings and #screen-error-log in all three shared Atelier top-bar selector groups', () => {
    const headerPos = css.indexOf('printer needs. Scoped to #screen-result and its parent container.');
    expect(headerPos).toBeGreaterThan(-1);
    const start = css.indexOf('*/', headerPos) + 2;
    const end = css.indexOf('/* Clear the absolute top bar;', start);
    expect(end).toBeGreaterThan(start);
    const topBarBlock = css.slice(start, end);
    const ruleSelectors = [...topBarBlock.matchAll(/([^{}]+)\{/g)].map((m) =>
      m[1]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    expect(ruleSelectors).toHaveLength(3);

    for (const screenId of ['screen-settings', 'screen-error-log']) {
      expect(ruleSelectors[0]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar`);
      expect(ruleSelectors[1]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar-title`);
      expect(ruleSelectors[2]).toContain(
        `.app:has(#${screenId}:not(.hidden)) .top-bar .icon-btn:not([hidden])`,
      );
    }
  });

  it('scopes Files cards, breadcrumb, search, sort sheet, and #fileActionsModal rows to Atelier tokens', () => {
    expect(filesCss).toMatch(
      /#libraryFilesPanel \.file-item-card\s*\{[^}]*background:\s*var\(--atelier-surface-cream\)/,
    );
    expect(filesCss).toMatch(/#libraryFilesPanel \.file-item-card\s*\{[^}]*border-radius:\s*14px/);
    expect(filesCss).toContain('#libraryFilesPanel .file-item-card:active');
    expect(filesCss).toContain('#libraryFilesPanel .file-item-card.is-selected');
    expect(filesCss).toContain('#libraryFilesPanel .files-search');
    expect(filesCss).toContain('#libraryFilesPanel .breadcrumb-segment');
    expect(filesCss).toContain('#libraryFilesPanel .files-sort-panel');
    expect(filesCss).toContain('#fileActionsModal .folder-select-item');
    expect(filesCss).toContain('#libraryFilesPanel .empty-hint');
  });

  it('applies Atelier card language, mono group titles, warm switches, and dot grid to Settings and Recent Errors', () => {
    expect(settingsCss).toContain('.app:has(#screen-settings:not(.hidden)) .screen-container');
    expect(settingsCss).toContain('.app:has(#screen-error-log:not(.hidden)) .screen-container');
    expect(settingsCss).toContain('radial-gradient(var(--atelier-grid-dot1)');

    expect(settingsCss).toMatch(
      /#screen-settings \.settings-group-title\s*\{[^}]*text-transform:\s*uppercase/,
    );
    expect(settingsCss).toMatch(
      /#screen-settings \.settings-group-title\s*\{[^}]*letter-spacing:\s*0?\.08em/,
    );
    expect(settingsCss).toMatch(/#screen-settings \.settings-group\s*\{[^}]*border-radius:\s*14px/);
    expect(settingsCss).toContain('#screen-settings .settings-lang-btn.is-selected');
    expect(settingsCss).toContain('#screen-settings .switch input:checked + .slider');
    expect(settingsCss).toContain(':root:not(.light-theme) #screen-settings .settings-lang-btn.is-selected');
    expect(settingsCss).toContain(':root.dark-theme #screen-settings .settings-lang-btn.is-selected');
    expect(settingsCss).toContain('#screen-error-log .error-log-row');
    expect(settingsCss).toContain('#screen-error-log .error-log-actions .btn');

    const usedVars = new Set(
      [...`${filesCss}\n${settingsCss}`.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]),
    );
    for (const v of usedVars) {
      expect(css, `CSS variable ${v} must be defined`).toContain(`${v}:`);
    }
  });
});
