import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, initLanguage, languageFromLocale, setLanguage } from '../i18n';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');
const i18nSource = readFileSync(fileURLToPath(new URL('../i18n/index.ts', import.meta.url)), 'utf-8');
const appSource = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf-8');

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

const FORBIDDEN_PURPLE_RE =
  /--color-primary(?:-rgb|-container)?\b|--color-surface-variant\b|--color-outline\b|#4f46e5|#7c8cf8|\b79\s*,\s*70\s*,\s*229\b|\b124\s*,\s*140\s*,\s*248\b/i;

describe('languageFromLocale and initLanguage()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects Turkish for tr, tr-TR, TR, tr_TR and defaults all other locales to English', () => {
    expect(languageFromLocale('tr')).toBe('tr');
    expect(languageFromLocale('tr-TR')).toBe('tr');
    expect(languageFromLocale('TR')).toBe('tr');
    expect(languageFromLocale('tr_TR')).toBe('tr');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale('de')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
    expect(languageFromLocale('')).toBe('en');
  });

  it('uses navigator.language on first launch without writing storage, and respects stored bindery.lang', () => {
    const setItem = vi.fn();
    vi.stubGlobal('document', { documentElement: { lang: '' }, querySelectorAll: () => [] });

    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    vi.stubGlobal('navigator', { language: 'tr-TR' });
    initLanguage();
    expect(getLanguage()).toBe('tr');
    expect(setItem).not.toHaveBeenCalled();

    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem });
    vi.stubGlobal('navigator', { language: 'tr-TR' });
    initLanguage();
    expect(getLanguage()).toBe('en');
    expect(setItem).not.toHaveBeenCalled();

    setLanguage('en');
  });
});

describe('Atelier Onboarding CSS (#onboardingOverlay)', () => {
  const onboardingCss = extractSection(css, '/* Onboarding overlay */', '/* End Onboarding overlay */');

  it('registers #onboardingOverlay in all three Atelier token lists', () => {
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

    expect(lightSelectors).toContain('#onboardingOverlay');
    expect(prefersDarkSelectors).toContain(':root:not(.light-theme) #onboardingOverlay');
    expect(darkClassSelectors).toContain(':root.dark-theme #onboardingOverlay');
  });

  it('uses Atelier tokens without --color-primary, --color-surface-variant, or purple literals', () => {
    expect(onboardingCss).not.toMatch(FORBIDDEN_PURPLE_RE);
    expect(onboardingCss).toMatch(/\.onboarding-overlay\s*\{[^}]*background-color:\s*var\(--atelier-bg\)/s);
    expect(onboardingCss).toMatch(/\.onboarding-overlay\s*\{[^}]*radial-gradient\(var\(--atelier-grid-dot1\)/s);
    expect(onboardingCss).toMatch(/\.onboarding-title\s*\{[^}]*'EB Garamond'/s);
    expect(onboardingCss).toMatch(/\.onboarding-skip-btn\s*\{[^}]*'Space Mono'/s);
    expect(onboardingCss).toMatch(/\.onboarding-next-btn\s*\{[^}]*background-color:\s*var\(--atelier-primary\)/s);
  });
});

describe('Atelier Onboarding Markup & i18n (#onboardingOverlay)', () => {
  const overlayHtml = extractTagBlock(html, 'id="onboardingOverlay"', 'div');

  it('contains no emoji anywhere inside #onboardingOverlay', () => {
    expect(overlayHtml).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('renders the brand logo, skip button, 3 how-it-works steps, theme cards, and privacy seal', () => {
    expect(overlayHtml).toMatch(/<img\b[^>]*\bsrc="favicon\.svg"/);
    expect(overlayHtml).toMatch(/<button\b[^>]*id="onboardingSkipBtn"[^>]*data-i18n="onboarding\.skip"/);
    expect(overlayHtml).toContain('data-i18n="atelier.privacySeal"');
    expect(overlayHtml).toContain('data-i18n="onboarding.how.title"');
    expect(overlayHtml).toContain('data-i18n="onboarding.how.step1"');
    expect(overlayHtml).toContain('data-i18n="onboarding.how.step2"');
    expect(overlayHtml).toContain('data-i18n="onboarding.how.step3"');
    expect(overlayHtml).toContain('data-i18n="onboarding.how.more"');
    expect(overlayHtml).toContain('data-i18n="onboarding.quickStartNote"');
    expect(overlayHtml.match(/class="onboarding-step"/g)).toHaveLength(3);
  });

  it('defines every new onboarding i18n key in both EN and TR without banned vocabulary', () => {
    const enStart = i18nSource.indexOf('  en: {');
    const trStart = i18nSource.indexOf('  tr: {');
    const storageStart = i18nSource.indexOf('const STORAGE_KEY');
    const enBlock = i18nSource.slice(enStart, trStart);
    const trBlock = i18nSource.slice(trStart, storageStart);

    const newKeys = [
      'onboarding.skip',
      'onboarding.how.title',
      'onboarding.how.step1',
      'onboarding.how.step2',
      'onboarding.how.step3',
      'onboarding.how.more',
      'onboarding.quickStartNote',
    ];
    for (const key of newKeys) {
      expect(enBlock, `EN missing ${key}`).toContain(`'${key}':`);
      expect(trBlock, `TR missing ${key}`).toContain(`'${key}':`);
    }
    for (const block of [enBlock, trBlock]) {
      for (const key of newKeys) {
        const line = block.split('\n').find((l) => l.trimStart().startsWith(`'${key}':`)) ?? '';
        expect(line.toLowerCase()).not.toMatch(/yarat|create|oluştur/);
      }
    }
  });
});

describe('Onboarding Skip & Auto-Theme Wiring (app.ts)', () => {
  it('binds onboardingSkipBtn, hides it on the last page, and wires click to finishOnboarding()', () => {
    expect(appSource).toContain("const onboardingSkipBtn = byId<HTMLButtonElement>('onboardingSkipBtn');");
    expect(appSource).toMatch(/onboardingSkipBtn\.hidden\s*=\s*isLast/);
    expect(appSource).toMatch(/onboardingSkipBtn\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*finishOnboarding\(\);/);
  });

  it('auto-preselects system dark mode only when bindery.darkmode is absent and persists on finish', () => {
    const darkInitBlock = appSource.match(
      /const storedDarkMode = localStorage\.getItem\('bindery\.darkmode'\);[\s\S]*?syncOnboardingThemeButtons\(isDarkMode\);/,
    );
    expect(darkInitBlock?.[0]).toBeDefined();
    expect(darkInitBlock![0]).toContain("window.matchMedia('(prefers-color-scheme: dark)').matches");
    expect(darkInitBlock![0]).toContain('syncOnboardingThemeButtons(isDarkMode);');
    expect(appSource).toMatch(/finishOnboarding\(\)[\s\S]*if\s*\(localStorage\.getItem\('bindery\.darkmode'\)\s*===\s*null\)\s*\{\s*localStorage\.setItem\('bindery\.darkmode',\s*String\(currentDarkMode\)\);/);
  });
});
