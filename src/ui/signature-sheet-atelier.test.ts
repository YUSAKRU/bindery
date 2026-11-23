import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
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
  /--color-primary(?:-rgb|-container)?\b|--color-on-primary\b|#241d63|#4f46e5|#6366f1|#7c8cf8|#ede9fe|#a5b4fc|#3730a3|\b79\s*,\s*70\s*,\s*229\b|\b99\s*,\s*102\s*,\s*241\b|\b124\s*,\s*140\s*,\s*248\b/i;

describe('Atelier "What is a signature?" sheet (#signatureInfoSheet)', () => {
  const imzaCss = extractSection(
    css,
    '"What is a signature?" info button + interactive sheet',
    '/* ── PWA Install & iOS Add-to-Home-Screen Banners',
  );

  it('registers #signatureInfoSheet in all three Atelier token lists', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();

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

    expect(lightSelectors).toContain('#signatureInfoSheet');
    expect(prefersDarkSelectors).toContain(':root:not(.light-theme) #signatureInfoSheet');
    expect(darkClassSelectors).toContain(':root.dark-theme #signatureInfoSheet');
  });

  it('contains no --color-primary*, --color-on-primary, #241d63, or indigo/purple literals in the imza section', () => {
    expect(imzaCss).not.toMatch(FORBIDDEN_INDIGO_RE);
  });

  it('styles selected picker pill, primary button, and progress dots with --atelier-primary', () => {
    expect(imzaCss).toMatch(
      /\.imza-picker button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--atelier-primary\)/,
    );
    expect(imzaCss).toMatch(
      /\.imza-btn--primary\s*\{[^}]*background:\s*var\(--atelier-primary\)/,
    );
    expect(imzaCss).toMatch(/\.imza-dots i\.on\s*\{[^}]*background:\s*var\(--atelier-primary\)/);
  });

  it('uses EB Garamond for the sheet title and Atelier tokens for panel, kicker, cover, picker, and buttons in both themes', () => {
    expect(imzaCss).toMatch(/\.imza-title\s*\{[^}]*font-family:[^;]*'EB Garamond'/);
    expect(imzaCss).toMatch(
      /\.imza-kicker\s*\{[^}]*'Space Mono'[^}]*color:\s*var\(--atelier-primary\)/s,
    );
    expect(imzaCss).toMatch(
      /\.imza-panel\s*\{[^}]*background:\s*var\(--atelier-bg\)[^}]*border-top:\s*1px solid var\(--atelier-border-hairline\)/s,
    );
    expect(imzaCss).toMatch(
      /\.imza-cover\s*\{[^}]*linear-gradient\(135deg,\s*var\(--atelier-primary\),\s*#6e2c12\)/,
    );
    expect(imzaCss).toMatch(
      /:root:not\(\.light-theme\) \.imza-cover\s*\{[^}]*linear-gradient\(135deg,\s*#d9875f,\s*#9a401d\)/,
    );
    expect(imzaCss).toMatch(
      /:root\.dark-theme \.imza-cover\s*\{[^}]*linear-gradient\(135deg,\s*#d9875f,\s*#9a401d\)/,
    );
    expect(imzaCss).toMatch(
      /\.imza-btn--ghost\s*\{[^}]*background:\s*var\(--atelier-surface-cream\)[^}]*color:\s*var\(--atelier-ink-black\)[^}]*border-color:\s*var\(--atelier-paper-edge\)/s,
    );
    expect(imzaCss).toMatch(
      /:root:not\(\.light-theme\) #signatureInfoSheet\s*\{[^}]*--atelier-primary:\s*#d9875f/i,
    );
    expect(imzaCss).toMatch(
      /:root\.dark-theme #signatureInfoSheet\s*\{[^}]*--atelier-primary:\s*#d9875f/i,
    );
  });

  it('preserves the semantic --imza-paper tokens for the 3D sheet animation', () => {
    for (const token of [
      '--imza-paper:',
      '--imza-paper-2:',
      '--imza-paper-edge:',
      '--imza-paper-back:',
      '--imza-crease:',
      '--imza-stage-a:',
      '--imza-stage-b:',
      '--imza-floor:',
    ]) {
      expect(imzaCss, `expected semantic paper token ${token}`).toContain(token);
    }
  });

  it('leaves the #signatureInfoSheet markup in index.html unchanged (imza- class count and IDs)', () => {
    const sheetHtml = extractTagBlock(html, 'id="signatureInfoSheet"', 'div');
    const imzaClasses = [...sheetHtml.matchAll(/\bimza-[a-z0-9-]+\b/g)].map((m) => m[0]);
    const ids = [...sheetHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

    expect(imzaClasses).toHaveLength(25);
    expect(ids).toEqual([
      'signatureInfoSheet',
      'signatureInfoBackdrop',
      'signatureInfoTitle',
      'signatureInfoStage',
      'signatureInfoDeck',
      'signatureInfoBridge',
      'signatureInfoPicker',
      'signatureInfoTag',
      'signatureInfoStepName',
      'signatureInfoStepText',
      'signatureInfoReplay',
      'signatureInfoGotIt',
    ]);
  });
});
