import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

// T-10: the PDF reader's chrome in the atelier language — line icons instead
// of emoji in the top bar, the terracotta accent instead of the old indigo,
// and a page desk that follows the theme. No DOM here, so markup, styles and
// app.ts are checked as text, like the other UI contract tests.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
const html = read('../../index.html');
const css = read('./styles.css');
const app = read('./app.ts');

const EMOJI = /\p{Extended_Pictographic}/u;

function rule(selector: string, source = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
}

/** The atelier chrome section added for the reader. */
const section = css.slice(
  css.indexOf('/* ── Reader Atelier Chrome (T-10)'),
  css.indexOf('/* ── Reader Night Chrome'),
);

/** The reader night mode chrome section. */
const nightSection = css.slice(
  css.indexOf('/* ── Reader Night Chrome'),
  css.indexOf('/* ── Reduced Motion'),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
});
afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

describe('reader top bar buttons', () => {
  for (const id of ['savePdfBtn', 'sharePdfBtn', 'printPdfBtn']) {
    it(`#${id} is a line icon, not an emoji`, () => {
      const at = html.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const button = html.slice(at, html.indexOf('</button>', at));
      expect(button).toContain('<svg aria-hidden="true" class="icon-svg"');
      expect(button).not.toMatch(EMOJI);
      expect(button).toMatch(/data-i18n-aria-label="common\.\w+"/);
    });
  }

  it('the save dialog hint no longer points at an emoji button', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLanguage(lang);
      expect(t('modal.saveDoc.hint'), lang).not.toMatch(EMOJI);
    }
    const at = html.indexOf('data-i18n="modal.saveDoc.hint"');
    expect(html.slice(at, html.indexOf('</p>', at))).not.toMatch(EMOJI);
  });
});

describe('reader atelier tokens', () => {
  it('the reader and its top bar get the atelier tokens in all three theme copies', () => {
    expect(css).toMatch(/\n#screen-reader,\n\.app:has\(#screen-reader:not\(\.hidden\)\) \.top-bar,\n/);
    expect(css).toContain('  :root:not(.light-theme) #screen-reader,\n  :root:not(.light-theme) .app:has(#screen-reader:not(.hidden)) .top-bar,\n');
    expect(css).toContain(':root.dark-theme #screen-reader,\n:root.dark-theme .app:has(#screen-reader:not(.hidden)) .top-bar,\n');

    const lightBg =
      css.match(
        /\n\.atelier-hub,[^{}]*\n#screen-reader,\n\.app:has\(#screen-reader:not\(\.hidden\)\) \.top-bar,[^{}]*\{[^}]*--atelier-bg:\s*(#[0-9a-f]{6})/i,
      )?.[1] ?? '';
    const mediaDarkBg =
      css.match(
        /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light-theme\) \.atelier-hub,[^{}]*\n {2}:root:not\(\.light-theme\) #screen-reader,\n {2}:root:not\(\.light-theme\) \.app:has\(#screen-reader:not\(\.hidden\)\) \.top-bar,[^{}]*\{[^}]*--atelier-bg:\s*(#[0-9a-f]{6})[^}]*\}\s*\}/i,
      )?.[1] ?? '';
    const classDarkBg =
      css.match(
        /\n:root\.dark-theme \.atelier-hub,[^{}]*\n:root\.dark-theme #screen-reader,\n:root\.dark-theme \.app:has\(#screen-reader:not\(\.hidden\)\) \.top-bar,[^{}]*\{[^}]*--atelier-bg:\s*(#[0-9a-f]{6})/i,
      )?.[1] ?? '';
    expect(lightBg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mediaDarkBg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(classDarkBg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(luminance(lightBg)).toBeGreaterThan(0.75);
    expect(luminance(mediaDarkBg)).toBeLessThan(0.1);
    expect(luminance(classDarkBg)).toBeLessThan(0.1);
  });

  it('the page desk is light in the light theme and dark in both dark copies', () => {
    const light = section.match(/(?:^|\n)#screen-reader \{[^}]*--reader-desk: (#[0-9a-f]{6})/)?.[1] ?? '';
    const mediaDark =
      section.match(
        /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light-theme\) #screen-reader \{[^}]*--reader-desk: (#[0-9a-f]{6})[^}]*\}\s*\}/,
      )?.[1] ?? '';
    const classDark =
      section.match(/(?:^|\n):root\.dark-theme #screen-reader \{[^}]*--reader-desk: (#[0-9a-f]{6})/)?.[1] ?? '';
    expect(light).toMatch(/^#[0-9a-f]{6}$/);
    expect(mediaDark).toMatch(/^#[0-9a-f]{6}$/);
    expect(classDark).toMatch(/^#[0-9a-f]{6}$/);
    expect(luminance(light)).toBeGreaterThan(0.75);
    expect(luminance(mediaDark)).toBeLessThan(0.1);
    expect(luminance(classDark)).toBeLessThan(0.1);
  });
});

describe('reader atelier chrome', () => {
  it('styles the bars, badge, tools button, scrubber, desk and pages from tokens', () => {
    expect(section.length).toBeGreaterThan(500);
    expect(rule(':root:not(.reader-night) .app:has(#screen-reader:not(.hidden)) .top-bar')).toContain('var(--atelier-bg)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-subbar')).toContain('var(--atelier-bg)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-page-indicator')).toContain('var(--atelier-surface-cream)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-subbar .btn-tonal')).toContain('var(--reader-accent)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-scrubber-thumb')).toContain('var(--reader-accent-rgb)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-scroll')).toContain('var(--reader-desk)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-page')).toContain('var(--reader-page-shadow)');
  });

  it('never uses the old indigo theme', () => {
    expect(section).not.toMatch(/--color-primary|--color-on-primary/);
    expect(section).not.toMatch(/79, ?70, ?229|#4f46e5|124, ?140, ?248|#7c8cf8|187, ?134, ?252|#d0aaff|#1e2030/i);
  });

  it('styles the reader tools and pages sheets with atelier tokens in day mode', () => {
    const panel = rule(':root:not(.reader-night) #screen-reader .reader-tools-panel', section);
    expect(panel).toContain('var(--atelier-bg)');
    expect(panel).toContain('var(--atelier-border-hairline)');

    expect(rule(':root:not(.reader-night) #screen-reader .reader-sheet-grabber', section)).toContain(
      'var(--atelier-paper-edge)',
    );
    const sheetTitle = rule(':root:not(.reader-night) #screen-reader .reader-sheet-title', section);
    expect(sheetTitle).toContain('var(--atelier-ink-black)');
    expect(sheetTitle).toContain("'EB Garamond'");

    const tile = rule(':root:not(.reader-night) #screen-reader .reader-tool-tile', section);
    expect(tile).toContain('var(--atelier-surface-cream)');
    expect(tile).toContain('var(--atelier-paper-edge)');
    expect(tile).toContain('border-radius: 14px');
    expect(tile).toContain('var(--atelier-ink-black)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-tool-tile:active', section)).toContain(
      'var(--atelier-paper-edge)',
    );
    expect(rule(':root:not(.reader-night) #screen-reader .reader-tool-tile-title', section)).toContain(
      'var(--atelier-ink-black)',
    );

    const tileIcon = rule(':root:not(.reader-night) #screen-reader .reader-tool-tile-icon', section);
    expect(tileIcon).toContain('var(--reader-accent-rgb)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-tool-tile-icon .tool-icon', section)).toContain(
      'var(--reader-accent)',
    );

    const navTab = rule(':root:not(.reader-night) #screen-reader .reader-nav-tab', section);
    expect(navTab).toContain('var(--atelier-surface-cream)');
    expect(navTab).toContain('var(--atelier-ink-muted)');
    const navTabActive = rule(':root:not(.reader-night) #screen-reader .reader-nav-tab.is-active', section);
    expect(navTabActive).toContain('var(--reader-accent-rgb)');
    expect(navTabActive).toContain('var(--reader-accent)');
    expect(navTabActive).toContain('font-weight: 600');

    expect(
      rule(':root:not(.reader-night) #screen-reader .reader-nav-cell.is-current .reader-nav-cell-thumb', section),
    ).toContain('var(--reader-accent)');
    expect(
      rule(':root:not(.reader-night) #screen-reader .reader-nav-cell.is-current .reader-nav-cell-num', section),
    ).toContain('var(--reader-accent)');

    expect(rule(':root:not(.reader-night) #screen-reader .reader-nav-outline-row:active', section)).toContain(
      'var(--reader-accent-rgb)',
    );
    const recentRow = rule(':root:not(.reader-night) #screen-reader .reader-nav-recent-row', section);
    expect(recentRow).toContain('var(--atelier-surface-cream)');
    expect(recentRow).toContain('var(--atelier-ink-black)');
    expect(rule(':root:not(.reader-night) #screen-reader .reader-nav-recent-page', section)).toContain(
      'var(--atelier-ink-muted)',
    );
  });

  it('leaves night mode alone: every styling rule is guarded against it', () => {
    const cleanSection = section.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...cleanSection.matchAll(/(?:^|\n)([^\n{}@/*][^{}]*?) \{([^}]*)\}/g)].map((m) => ({
      selectorList: m[1].trim(),
      body: m[2].trim(),
    }));
    expect(rules.length).toBeGreaterThan(8);
    let stylingRules = 0;
    for (const { selectorList, body } of rules) {
      const decls = body
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean);
      const isTokenRule =
        /^(?:(?::root:not\(\.light-theme\)|:root\.dark-theme)\s+)?#screen-reader$/.test(selectorList) &&
        decls.length > 0 &&
        decls.every((d) => /^--[\w-]+\s*:/.test(d));
      if (isTokenRule) continue;

      stylingRules++;
      for (const sel of selectorList.split(',').map((s) => s.trim())) {
        expect(sel, sel).toMatch(/:root:not\(\.reader-night\)|#screen-reader:not\(\.night-mode\)/);
      }
    }
    expect(stylingRules).toBeGreaterThan(8);
  });

  it('the night mode scrubber is no longer purple', () => {
    expect(rule('.reader-night .reader-scrubber-thumb')).not.toMatch(/187, ?134, ?252/);
  });

  it('the night mode active sub-bar button uses warm gold instead of purple', () => {
    const nightActive = rule('.reader-night .reader-subbar .icon-btn-sm.is-active', nightSection);
    expect(nightActive).not.toMatch(/187, ?134, ?252|#d0aaff/i);
    expect(nightActive).toContain('rgba(200, 157, 83, .25)');
    expect(nightActive).toContain('#e6c07b');
  });

  it('the night mode tools and pages sheets use warm gold and drop all purple/indigo', () => {
    expect(nightSection).not.toMatch(/187, ?134, ?252|#d0aaff|--color-primary|79, ?70, ?229|#4f46e5|124, ?140, ?248/i);
    expect(rule('.reader-night .reader-tool-tile:active', nightSection)).toContain('rgba(200, 157, 83, .25)');
    expect(rule('.reader-night .reader-tool-tile-icon', nightSection)).toContain('rgba(200, 157, 83, .20)');
    expect(rule('.reader-night .reader-tool-tile-icon .tool-icon', nightSection)).toContain('#e6c07b');

    const nightNavActive = rule('.reader-night .reader-nav-tab.is-active', nightSection);
    expect(nightNavActive).toContain('rgba(200, 157, 83, .25)');
    expect(nightNavActive).toContain('#e6c07b');

    expect(rule('.reader-night .reader-nav-cell.is-current .reader-nav-cell-thumb', nightSection)).toContain('#e6c07b');
    expect(rule('.reader-night .reader-nav-cell.is-current .reader-nav-cell-num', nightSection)).toContain('#e6c07b');
    expect(rule('.reader-night .reader-nav-outline-row:active', nightSection)).toContain('rgba(200, 157, 83, .20)');
  });

  it('the active search button uses the reader accent in atelier mode and warm gold in night mode', () => {
    const atelierSearchActive = rule(
      ':root:not(.reader-night) #screen-reader .reader-subbar #readerSearchBtn.search-active',
      section,
    );
    expect(atelierSearchActive).toContain('color: var(--reader-accent)');
    expect(atelierSearchActive).toContain('background: rgba(var(--reader-accent-rgb), 0.15)');

    const nightSearchActive = rule('.reader-night .reader-subbar #readerSearchBtn.search-active', nightSection);
    expect(nightSearchActive).toContain('color: #e6c07b');
    expect(nightSearchActive).toContain('background: rgba(200, 157, 83, .25)');
  });

  it('the sub-bar icon press flash uses the reader accent in atelier mode and warm gold in night mode', () => {
    const atelierPress = rule(':root:not(.reader-night) #screen-reader .reader-subbar .icon-btn-sm:active', section);
    expect(atelierPress).toContain('background: rgba(var(--reader-accent-rgb), 0.16)');

    const nightPress = rule('.reader-night .reader-subbar .icon-btn-sm:active', nightSection);
    expect(nightPress).toContain('background: rgba(200, 157, 83, .2)');
  });
});

describe('reader search panel', () => {
  for (const id of ['readerSearchPrevBtn', 'readerSearchNextBtn', 'readerSearchCloseBtn']) {
    it(`#${id} uses a line icon SVG and not a plain text glyph`, () => {
      const at = html.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const button = html.slice(at, html.indexOf('</button>', at));
      expect(button).toContain('<svg aria-hidden="true" class="icon-svg"');
      expect(button).toContain('</svg>');
      expect(button).not.toMatch(/[‹›✕]/);
      expect(button).toMatch(/data-i18n-aria-label="reader\.\w+"/);
    });
  }

  it('app.ts does not overwrite the search button SVGs via textContent or innerHTML', () => {
    expect(app).not.toMatch(/readerSearch(?:Prev|Next|Close)Btn\.(?:textContent|innerHTML)\s*=/);
  });

  it('styles the search panel, input, count and buttons with atelier tokens in day mode', () => {
    const panel = rule(':root:not(.reader-night) #screen-reader .reader-search-panel', section);
    expect(panel).toContain('var(--atelier-bg)');
    expect(panel).toContain('var(--atelier-border-hairline)');

    const input = rule(':root:not(.reader-night) #screen-reader .reader-search-input', section);
    expect(input).toContain('var(--atelier-surface-cream)');
    expect(input).toContain('var(--atelier-paper-edge)');
    expect(input).toContain('border-radius: 10px');
    expect(input).toContain('var(--atelier-ink-black)');

    expect(rule(':root:not(.reader-night) #screen-reader .reader-search-input::placeholder', section)).toContain(
      'var(--atelier-ink-muted)',
    );

    const inputFocus = rule(':root:not(.reader-night) #screen-reader .reader-search-input:focus', section);
    expect(inputFocus).toContain('var(--reader-accent)');
    expect(inputFocus).toContain('var(--atelier-surface-cream)');

    expect(rule(':root:not(.reader-night) #screen-reader .reader-search-count', section)).toContain(
      'var(--atelier-ink-muted)',
    );

    const hasResults = rule(':root:not(.reader-night) #screen-reader .reader-search-count.has-results', section);
    expect(hasResults).toContain('var(--reader-accent)');
    expect(hasResults).toContain('font-weight: 600');

    expect(rule(':root:not(.reader-night) #screen-reader .reader-search-count.no-results', section)).toContain(
      'var(--reader-error)',
    );
    expect(section).toMatch(/(?:^|\n)#screen-reader \{[^}]*--reader-error:\s*#b3261e/);
    expect(section).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\.light-theme\) #screen-reader \{[^}]*--reader-error:\s*#f2b8b5[^}]*\}\s*\}/,
    );
    expect(section).toMatch(/(?:^|\n):root\.dark-theme #screen-reader \{[^}]*--reader-error:\s*#f2b8b5/);

    expect(rule(':root:not(.reader-night) #screen-reader .reader-search-panel .icon-btn-sm', section)).toContain(
      'var(--atelier-ink-muted)',
    );
    expect(rule(':root:not(.reader-night) #screen-reader .reader-search-panel .icon-btn-sm:active', section)).toContain(
      'rgba(var(--reader-accent-rgb), 0.16)',
    );
    expect(
      rule(':root:not(.reader-night) #screen-reader .reader-search-panel .icon-btn-sm:disabled', section),
    ).toContain('opacity: 0.35');
  });

  it('styles the search panel in night mode with warm gold and no indigo', () => {
    expect(nightSection).not.toMatch(/#7c8cf8|#1e2030/i);

    const nightPanel = rule('.reader-night .reader-search-panel', nightSection);
    expect(nightPanel).toContain('#181818');
    expect(nightPanel).toContain('rgba(255, 255, 255, .07)');

    const nightInput = rule('.reader-night .reader-search-input', nightSection);
    expect(nightInput).toContain('rgba(255, 255, 255, .08)');
    expect(nightInput).toContain('rgba(255, 255, 255, .14)');
    expect(nightInput).toContain('#e0e0e0');

    expect(rule('.reader-night .reader-search-input:focus', nightSection)).toContain('#e6c07b');
    expect(rule('.reader-night .reader-search-count', nightSection)).toContain('rgba(255, 255, 255, .5)');
    expect(rule('.reader-night .reader-search-count.has-results', nightSection)).toContain('#e6c07b');
    expect(rule('.reader-night .reader-search-panel .icon-btn-sm', nightSection)).toContain('#e0e0e0');
    expect(rule('.reader-night .reader-search-panel .icon-btn-sm:active', nightSection)).toContain(
      'rgba(200, 157, 83, .2)',
    );
  });
});

describe('reader page list spacing', () => {
  it('CSS gap and top padding match the constants the scroll math uses', () => {
    expect([...css.matchAll(/(?:^|\n)\s*\.reader-page-list \{/g)]).toHaveLength(1);
    const list = rule('.reader-page-list');
    const gap = Number(list.match(/\bgap: (\d+)px/)?.[1]);
    const top = Number(list.match(/\bpadding: (\d+)px/)?.[1]);
    const appGap = Number(app.match(/const READER_PAGE_GAP_PX = (\d+);/)?.[1]);
    const appTop = Number(app.match(/const READER_LIST_TOP_PADDING_PX = (\d+);/)?.[1]);
    expect(Number.isFinite(gap)).toBe(true);
    expect(Number.isFinite(top)).toBe(true);
    expect(Number.isFinite(appGap)).toBe(true);
    expect(Number.isFinite(appTop)).toBe(true);
    expect(gap).toBe(appGap);
    expect(top).toBe(appTop);
    expect(gap).toBeGreaterThan(6);
  });
});

describe('reader sub-bar on narrow phones', () => {
  it('keeps the page badge on one line', () => {
    expect(rule('.reader-page-indicator')).toContain('white-space: nowrap');
    expect(rule('.reader-page-indicator')).toContain('flex-shrink: 0');
  });

  it('tightens the row at 360px and below', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 360px) {\n  .reader-subbar'));
    expect(narrow).toMatch(/^@media \(max-width: 360px\) \{\n {2}\.reader-subbar \{\n {4}gap: 4px;/);
  });
});
