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

const FORBIDDEN_INDIGO_RE =
  /--color-primary(?:-rgb|-container)?\b|--color-surface-variant\b|#4f46e5|#ede9fe|#a5b4fc|#3730a3|#7c8cf8|#d0aaff|\b79\s*,\s*70\s*,\s*229\b|\b124\s*,\s*140\s*,\s*248\b|\b187\s*,\s*134\s*,\s*252\b/i;

describe('Atelier All Tools screen (#screen-tools-all)', () => {
  const toolsAllCss = extractSection(
    css,
    '/* Atelier All Tools (#screen-tools-all) */',
    '/* End Atelier All Tools */',
  );

  it('registers #screen-tools-all and its top-bar and screen-container in all three Atelier token lists', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();

    const baseSelectors = [
      '#screen-tools-all',
      '.app:has(#screen-tools-all:not(.hidden)) .top-bar',
      '.app:has(#screen-tools-all:not(.hidden)) .screen-container',
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

  it('includes #screen-tools-all in all three shared Atelier top-bar selector groups and dotted screen-container', () => {
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

    expect(ruleSelectors[0]).toContain('.app:has(#screen-tools-all:not(.hidden)) .top-bar');
    expect(ruleSelectors[1]).toContain('.app:has(#screen-tools-all:not(.hidden)) .top-bar-title');
    expect(ruleSelectors[2]).toContain(
      '.app:has(#screen-tools-all:not(.hidden)) .top-bar .icon-btn:not([hidden])',
    );

    expect(toolsAllCss).toMatch(
      /\.app:has\(#screen-tools-all:not\(\.hidden\)\) \.screen-container\s*\{[^}]*background-color:\s*var\(--atelier-bg\)[^}]*radial-gradient\(var\(--atelier-grid-dot1\)/s,
    );
  });

  it('scopes category titles, rows, icon tiles, icons, and soon badges to Atelier tokens in light and dark themes', () => {
    expect(toolsAllCss).toMatch(/#screen-tools-all\s*\{[^}]*color:\s*var\(--atelier-ink-black\)/);
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-category-title\s*\{[^}]*'Space Mono'[^}]*text-transform:\s*uppercase[^}]*letter-spacing:\s*0?\.08em[^}]*color:\s*var\(--atelier-ink-muted\)/s,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-rows\s*\{[^}]*background:\s*var\(--atelier-surface-cream\)[^}]*border:\s*1px solid var\(--atelier-paper-edge\)[^}]*border-radius:\s*14px/s,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-row\s*\{[^}]*border-bottom:\s*1px solid var\(--atelier-border-hairline\)/,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-rows \.tool-row:last-child\s*\{[^}]*border-bottom:\s*none/,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-row:active\s*\{[^}]*background:\s*rgba\(154,\s*64,\s*29,\s*0?\.08\)/,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-row-icon\s*\{[^}]*background:\s*rgba\(154,\s*64,\s*29,\s*0?\.10?\)[^}]*border-radius:\s*10px/s,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-icon,\s*#screen-tools-all \.tool-row:hover \.tool-icon,\s*#screen-tools-all \.tool-row:active \.tool-icon\s*\{[^}]*stroke:\s*var\(--atelier-primary\)/,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-row-title\s*\{[^}]*font-weight:\s*600[^}]*color:\s*var\(--atelier-ink-black\)/s,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.tool-row-desc,\s*#screen-tools-all \.tool-row-chevron\s*\{[^}]*color:\s*var\(--atelier-ink-muted\)/,
    );
    expect(toolsAllCss).toMatch(
      /#screen-tools-all \.badge-soon\s*\{[^}]*color:\s*var\(--atelier-ink-muted\)[^}]*background:\s*var\(--atelier-bg\)/s,
    );
    expect(toolsAllCss).toMatch(
      /:root:not\(\.light-theme\) #screen-tools-all \.tool-row:active\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.12\)/,
    );
    expect(toolsAllCss).toMatch(
      /:root:not\(\.light-theme\) #screen-tools-all \.tool-row-icon\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.14\)/,
    );
    expect(toolsAllCss).toMatch(
      /:root:not\(\.light-theme\) #screen-tools-all \.tool-icon,\s*:root:not\(\.light-theme\) #screen-tools-all \.tool-row:hover \.tool-icon,\s*:root:not\(\.light-theme\) #screen-tools-all \.tool-row:active \.tool-icon\s*\{[^}]*stroke:\s*#d9875f/i,
    );
    expect(toolsAllCss).toMatch(
      /:root\.dark-theme #screen-tools-all \.tool-row:active\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.12\)/,
    );
    expect(toolsAllCss).toMatch(
      /:root\.dark-theme #screen-tools-all \.tool-row-icon\s*\{[^}]*background:\s*rgba\(217,\s*135,\s*95,\s*0?\.14\)/,
    );
    expect(toolsAllCss).toMatch(
      /:root\.dark-theme #screen-tools-all \.tool-icon,\s*:root\.dark-theme #screen-tools-all \.tool-row:hover \.tool-icon,\s*:root\.dark-theme #screen-tools-all \.tool-row:active \.tool-icon\s*\{[^}]*stroke:\s*#d9875f/i,
    );

    const usedVars = new Set([...toolsAllCss.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const v of usedVars) {
      expect(css, `CSS variable ${v} must be defined`).toContain(`${v}:`);
    }
  });

  it('uses no --color-primary*, --color-surface-variant, or indigo/purple literals in the scoped #screen-tools-all CSS', () => {
    expect(toolsAllCss).not.toMatch(FORBIDDEN_INDIGO_RE);
  });

  it('leaves global .tool-rows, .tool-row-icon, .tool-icon, and .badge-soon rules untouched', () => {
    const globalToolRows = css.match(/^\.tool-rows\s*\{([^}]+)\}/m);
    expect(globalToolRows).not.toBeNull();
    expect(globalToolRows![1]).toContain('background: var(--color-surface-variant);');

    const globalToolRowIcon = css.match(/^\.tool-row-icon\s*\{([^}]+)\}/m);
    expect(globalToolRowIcon).not.toBeNull();
    expect(globalToolRowIcon![1]).toContain('background: var(--color-primary-container);');

    const globalToolRowActive = css.match(/^\.tool-row:active\s*\{([^}]+)\}/m);
    expect(globalToolRowActive).not.toBeNull();
    expect(globalToolRowActive![1]).toContain('background: var(--color-primary-container);');

    const globalToolIconHover = css.match(
      /^\.tool-row:hover \.tool-icon,\s*\n\.tool-row:active \.tool-icon\s*\{([^}]+)\}/m,
    );
    expect(globalToolIconHover).not.toBeNull();
    expect(globalToolIconHover![1]).toContain('stroke: var(--color-primary);');
  });

  it('preserves the exact tool sequence inside #screen-tools-all in index.html', () => {
    const toolsAllHtml = extractTagBlock(html, 'id="screen-tools-all"', 'section');
    const dataTools = [...toolsAllHtml.matchAll(/data-tool="([^"]+)"/g)].map((m) => m[1]);
    expect(dataTools).toEqual([
      'rotate',
      'organize',
      'page-numbers',
      'merge',
      'booklet',
      'watermark',
      'image-to-pdf',
      'md-to-pdf',
    ]);
  });
});
