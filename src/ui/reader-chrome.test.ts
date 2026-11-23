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

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
}

/** The atelier chrome section added for the reader. */
const section = css.slice(
  css.indexOf('/* ── Reader Atelier Chrome (T-10)'),
  css.indexOf('/* ── Reader Night Chrome'),
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
  });

  it('the page desk is light in the light theme and dark in both dark copies', () => {
    const light = section.match(/#screen-reader \{[^}]*--reader-desk: (#[0-9a-f]{6})/)?.[1] ?? '';
    const darks = [...section.matchAll(/(?::root:not\(\.light-theme\)|:root\.dark-theme) #screen-reader \{[^}]*--reader-desk: (#[0-9a-f]{6})/g)].map((m) => m[1]);
    expect(luminance(light)).toBeGreaterThan(0.75);
    expect(darks).toHaveLength(2);
    for (const d of darks) expect(luminance(d)).toBeLessThan(0.1);
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
    expect(section).not.toMatch(/79, ?70, ?229|#4f46e5|187, ?134, ?252/i);
  });

  it('leaves night mode alone: every styling rule is guarded against it', () => {
    const selectors = [...section.matchAll(/(?:^|\n)([^\n{}@/*][^{}]*?) \{/g)]
      .map((m) => m[1].trim())
      .filter((sel) => !/#screen-reader$/.test(sel));
    expect(selectors.length).toBeGreaterThan(8);
    for (const sel of selectors) expect(sel, sel).toMatch(/:root:not\(\.reader-night\)|#screen-reader:not\(\.night-mode\)/);
  });

  it('the night mode scrubber is no longer purple', () => {
    expect(rule('.reader-night .reader-scrubber-thumb')).not.toMatch(/187, ?134, ?252/);
  });
});

describe('reader page list spacing', () => {
  it('CSS gap and top padding match the constants the scroll math uses', () => {
    const list = rule('.reader-page-list');
    const gap = Number(list.match(/\bgap: (\d+)px/)?.[1]);
    const top = Number(list.match(/\bpadding: (\d+)px/)?.[1]);
    expect(gap).toBe(Number(app.match(/const READER_PAGE_GAP_PX = (\d+);/)?.[1]));
    expect(top).toBe(Number(app.match(/const READER_LIST_TOP_PADDING_PX = (\d+);/)?.[1]));
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
