import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');
const i18nSource = readFileSync(fileURLToPath(new URL('../i18n/index.ts', import.meta.url)), 'utf-8');
const appSource = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf-8');

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `expected start marker "${startMarker}"`).toBeGreaterThan(-1);
  expect(end, `expected end marker "${endMarker}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function extractDictionaryKeys(langBlock: string): string[] {
  return [...langBlock.matchAll(/^\s+'([a-zA-Z0-9_.-]+)'\s*:/gm)].map((m) => m[1]);
}

// Covers pictographic emojis (📁🚧🖨🏠💾📤📷🖼🔧📐🔄🔢💧🔗📑📖), ⚠️ (\u26A0), ℹ️ (\u2139\uFE0F), ⭐ (\u2B50), ✨ (\u2728),
// while intentionally permitting typographic glyphs such as ✓ (\u2713), ✕ (\u2715), ▸, ▾, →, ↑.
const UI_PICTOGRAPHIC_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u26FF]|\u2139\uFE0F|\u2B50|\u2728/u;
const EN_FORBIDDEN_CREATE_RE = /\bcreat(?:e|es|ed|ing|ive)\b/i;

describe('Pre-Release Polish & Brand Voice Guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses zero "create" / "creative" variants in EN i18n strings (docs/BRAND.md)', () => {
    const enBlock = extractSection(i18nSource, '  en: {', '  tr: {');
    const enKeys = extractDictionaryKeys(enBlock);
    expect(enKeys.length).toBeGreaterThan(100);

    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
    setLanguage('en');

    const offending = enKeys
      .map((key) => ({ key, value: t(key) }))
      .filter(({ value }) => EN_FORBIDDEN_CREATE_RE.test(value));

    expect(offending).toEqual([]);
  });

  it('removes pictographic UI emojis from index.html, all EN/TR i18n values, and Move modal folder rows', () => {
    const htmlMatches = html
      .split('\n')
      .map((line, idx) => ({ line: idx + 1, text: line.trim() }))
      .filter(({ text }) => UI_PICTOGRAPHIC_EMOJI_RE.test(text));
    expect(htmlMatches).toEqual([]);

    const enBlock = extractSection(i18nSource, '  en: {', '  tr: {');
    const trBlock = extractSection(i18nSource, '  tr: {', '\n};');
    const enKeys = extractDictionaryKeys(enBlock);
    const trKeys = extractDictionaryKeys(trBlock);

    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });

    setLanguage('en');
    const enEmojis = enKeys.map((k) => ({ k, v: t(k) })).filter(({ v }) => UI_PICTOGRAPHIC_EMOJI_RE.test(v));
    expect(enEmojis).toEqual([]);

    setLanguage('tr');
    const trEmojis = trKeys.map((k) => ({ k, v: t(k) })).filter(({ v }) => UI_PICTOGRAPHIC_EMOJI_RE.test(v));
    expect(trEmojis).toEqual([]);

    setLanguage('en');

    const moveModalBlock = extractSection(
      appSource,
      'function setMoveFolderButtonContent(',
      '// --- Toolbar event listeners ---',
    );
    expect(moveModalBlock).not.toMatch(UI_PICTOGRAPHIC_EMOJI_RE);
  });

  it('renders inline warning/info SVGs in all 4 #screen-picker banners without emoji fallbacks', () => {
    const pickerError = extractSection(html, 'id="pickerInlineError"', '<!-- Warning Banners Wrap -->');
    const pickerWarnings = extractSection(html, 'id="pickerWarningsWrap"', '<!-- Continue Action Block -->');

    for (const [name, snippet] of [
      ['pickerInlineError', pickerError],
      ['pickerWarningsWrap', pickerWarnings],
    ] as const) {
      expect(snippet, `${name} must not contain warning/info emojis`).not.toMatch(/⚠️|ℹ️/);
      expect(snippet, `${name} must use SVG warning-banner-icon`).toContain('class="warning-banner-icon"');
      expect(snippet, `${name} must hide decorative SVG from AT`).toContain('aria-hidden="true"');
    }

    const svgMatches = pickerWarnings.match(/<svg\b[^>]*class="warning-banner-icon"[^>]*>/g) ?? [];
    expect(svgMatches).toHaveLength(3);
  });

  it('ensures every <svg> in index.html satisfies accessibility requirements (aria-hidden, label, or <title>)', () => {
    const svgRe = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/g;
    const svgs = [...html.matchAll(svgRe)];
    expect(svgs.length).toBeGreaterThan(20);

    const unlabeled = svgs
      .filter(([, attrs, inner]) => {
        const hasAriaHidden = /\baria-hidden\s*=\s*"true"/.test(attrs);
        const hasAriaLabel = /\baria-label(?:ledby)?\s*=/.test(attrs);
        const hasTitle = /<title\b/.test(inner);
        return !hasAriaHidden && !hasAriaLabel && !hasTitle;
      })
      .map(([full]) => full.slice(0, 80));

    expect(unlabeled).toEqual([]);
  });

  it('uses safe DOM folder SVGs in #moveDocModal and defines light/dark .move-folder-icon styles', () => {
    const moveContentFn = extractSection(
      appSource,
      'function setMoveFolderButtonContent(',
      '/** Builds one expandable folder row for the Move modal',
    );
    expect(moveContentFn).toContain("svg.setAttribute('class', 'move-folder-icon')");
    expect(moveContentFn).toContain("svg.setAttribute('aria-hidden', 'true')");
    expect(moveContentFn).toContain('text.textContent = label;');
    expect(moveContentFn).not.toContain('innerHTML');

    const moveCallSites = extractSection(
      appSource,
      'function buildMoveFolderRow(',
      '// --- Toolbar event listeners ---',
    );
    expect(moveCallSites).toContain('setMoveFolderButtonContent(selectBtn, name)');
    expect(moveCallSites).toContain("setMoveFolderButtonContent(rootBtn, t('files.root'))");

    const phase4Css = extractSection(
      css,
      '/* Atelier Shared Overlays & Modals — Phase 4 */',
      '/* End Atelier Shared Overlays & Modals — Phase 4 */',
    );
    expect(phase4Css).toContain('#moveDocModal .move-folder-icon');
    expect(phase4Css).toContain(':root:not(.light-theme) #moveDocModal .move-folder-icon');
    expect(phase4Css).toContain(':root.dark-theme #moveDocModal .move-folder-icon');
  });
});
