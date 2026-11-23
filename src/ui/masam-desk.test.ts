import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

// The "Masam" (desk) tab of the library: the row menu sheet, the undo toast
// and the app wiring behind them. No DOM here, so markup, styles and app.ts
// are checked as text, like the other UI contract tests.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
const html = read('../../index.html');
const css = read('./styles.css');
const app = read('./app.ts');

function block(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `expected "${signature}"`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start + signature.length);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced');
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))?.[1] ?? '';
}

const EMOJI = /\p{Extended_Pictographic}/u;

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
});
afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

describe('desk actions sheet markup', () => {
  const start = html.indexOf('id="libraryDeskSheet"');
  const sheet = html.slice(html.lastIndexOf('<div', start), html.indexOf('</section>', start));

  it('is a labelled modal dialog inside the library screen', () => {
    expect(start).toBeGreaterThan(html.indexOf('id="screen-library"'));
    expect(start).toBeLessThan(html.indexOf('id="screen-book"'));
    expect(sheet).toMatch(/class="library-sheet-backdrop hidden" id="libraryDeskSheet" role="dialog" aria-modal="true" aria-labelledby="libraryDeskSheetTitle"/);
  });

  it('offers "Read as a book" and "Remove from desk" with the file-stays hint', () => {
    expect(sheet).toMatch(/id="libraryDeskReadBtn"[\s\S]*data-i18n="library\.action\.readDesk"/);
    expect(sheet).toMatch(/id="libraryDeskRemoveBtn"[\s\S]*data-i18n="library\.desk\.remove"[\s\S]*data-i18n="library\.desk\.removeHint"/);
    expect(sheet).toMatch(/id="libraryDeskSheetCloseBtn"[^>]*data-i18n-aria-label="common\.close"/);
    expect(sheet).not.toMatch(EMOJI);
  });
});

describe('desk styles', () => {
  it('styles every class the desk row and sheet use', () => {
    for (const cls of [
      'library-desk-more',
      'library-desk-meta',
      'library-desk-tag',
      'library-desk-date',
      'library-desk-sheet-title',
      'library-desk-action',
      'library-desk-action-text',
      'library-desk-action-label',
      'library-desk-action-hint',
      'toast-action',
    ]) {
      expect(css, cls).toMatch(new RegExp(`\\.${cls}[\\s{.:,]`));
    }
    expect(css).toMatch(/\.library-desk-icon\.is-imposed \{/);
  });

  it('drops the old per-row remove and book buttons', () => {
    expect(css).not.toMatch(/\.library-desk-remove\b/);
    expect(css).not.toMatch(/\.library-desk-book\b/);
  });

  it('keeps touch targets at least 44px', () => {
    const px = (sel: string, prop: string) => Number(rule(sel).match(new RegExp(`\\b${prop}:\\s*(\\d+)px`))?.[1] ?? 0);
    expect(px('.library-desk-more', 'height')).toBeGreaterThanOrEqual(44);
    expect(px('.library-desk-action', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px('.toast-action', 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('gives a toast with an action the full row, not half the screen', () => {
    expect(rule('.toast.has-action')).toContain('width: max-content');
    expect(rule('.toast.has-action')).toMatch(/max-width: min\(calc\(100vw - 32px\)/);
  });

  it('lets the date give way before the page number', () => {
    expect(rule('.library-desk-page,\n.library-desk-tag,\n.library-desk-sep')).toContain('flex-shrink: 0');
    expect(rule('.library-desk-date')).toContain('text-overflow: ellipsis');
  });

  it('allows desk titles two lines, without touching book rows', () => {
    const title = rule('.library-desk-row .library-row-title');
    expect(title).toContain('-webkit-line-clamp: 2');
    expect(rule('.library-row-title')).toContain('white-space: nowrap');
  });

  it('mixes the active tab count toward the ink so it reads in the dark theme', () => {
    expect(rule('.library-tab.is-active .library-tab-badge')).toMatch(/color: color-mix\(in srgb, var\(--atelier-primary\) \d+%, var\(--atelier-ink-black\)\)/);
  });

  it('only uses CSS variables that are defined somewhere', () => {
    const desk = css.slice(css.indexOf('.library-desk-icon.is-imposed'), css.indexOf('/* ── Empty state (Atelier Zen Card)'));
    expect(desk.length).toBeGreaterThan(100);
    for (const v of new Set([...desk.matchAll(/var\((--[\w-]+)/g)].map((x) => x[1]))) expect(css, v).toContain(`${v}:`);
  });
});

describe('app wiring', () => {
  it('reopening a desk entry keeps the name the desk knows', () => {
    const body = block(app, 'async function openRecent(entry: RecentEntry): Promise<void>');
    expect(body).toContain('openReaderWithBytes(picked.bytes, entry.name || picked.name, entry.uri');
  });

  it('removing from the desk offers a 5 s undo that restores the exact entry', () => {
    const at = app.indexOf('onRemoveDesk: async (entry) =>');
    expect(at).toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf('openModal:', at));
    expect(body).toContain('await removeRecent(entry)');
    expect(body).toContain("showToast(t('library.desk.removed')");
    expect(body).toContain('durationMs: 5000');
    expect(body).toContain("label: t('common.undo')");
    expect(body).toContain('restoreRecent(entry)');
    expect(body).toContain("libraryScreen?.show('desk')");
  });

  it('the toast can carry one action button and its own duration', () => {
    // The parameter list has braces of its own; the body starts after "): void".
    const at = app.indexOf('function showToast(');
    const body = block(app.slice(app.indexOf('): void', at)), '): void');
    expect(body).toContain("button.className = 'toast-action'");
    expect(body).toContain("button.type = 'button'");
    expect(body).toContain("toast.classList.toggle('has-action', Boolean(action))");
    expect(body).toContain('opts?.durationMs ?? 2500');
  });
});

describe('desk bookkeeping in app.ts', () => {
  it('every recordOpened in app.ts carries a fingerprint of the bytes at hand', () => {
    const calls = [...app.matchAll(/recordOpened\(\{[^}]*\}\)/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call, call).toMatch(/fp: fingerprintPdf\(\w+\)/);
    expect(app).toContain('async function rememberSaved(uri: string, name: string, bytes: Uint8Array)');
  });

  it('rename and move follow the file with rekeyRecent instead of remove + record', () => {
    expect(app.match(/rekeyRecent\(/g)?.length).toBe(3);
    expect(app).not.toMatch(/removeRecent\([^)]*\);\s*await recordOpened\(/);
    expect(app).toContain('await rekeyRecent({ uri: readerUri, name: readerName }, { uri: newUri, name: newName });');
    expect(app).toContain('await rekeyRecent({ uri: item.uri, name: currentName }, { uri: newUri, name: newName });');
    expect(app).toContain('await rekeyRecent(moveSourceFile, { uri: newUri, name: moveSourceFile.name });');
  });
});

describe('reader bookkeeping', () => {
  it('a rename inside the reader is not recorded again after rekeyRecent', () => {
    const at = app.indexOf('await rekeyRecent({ uri: readerUri, name: readerName }');
    expect(at).toBeGreaterThan(-1);
    // Up to the toast that ends the private-save branch.
    const rest = app.slice(at, app.indexOf("showToast(t('toast.savedToBindery'))", at));
    const elseAt = rest.indexOf('} else {');
    const rename = rest.slice(0, elseAt);
    // The else block itself (a new copy in scans/), by brace matching.
    const copy = block(rest.slice(elseAt + 1), 'else');
    const after = rest.slice(elseAt + 1 + rest.slice(elseAt + 1).indexOf(copy) + copy.length);
    expect(rename).not.toMatch(/rememberSaved|recordOpened/);
    expect(copy).toContain('await rememberSaved(newUri, newName, readerBytes);');
    expect(after).not.toMatch(/rememberSaved|recordOpened/);
  });

  it('an open without its own page resumes where the desk says the file was left', () => {
    expect(app).toContain('const recorded = await recordOpened({ uri: sourceUri, name, fp: fingerprintPdf(bytes), imposed: readerImposed });');
    expect(app).toMatch(/if \(initialPage <= 1 && recorded\.lastPage > 1 && readerDoc\) \{\s*readerScroll\.scrollTop = readerScrollTopForPage\(Math\.min\(recorded\.lastPage, readerDoc\.proxy\.numPages\)\);/);
  });
});

describe('imposed mark in the reader', () => {
  it('reads the Keywords through pdf.js and records what it found', () => {
    // Behaviour lives in imposedFromInfo (unit-tested in booklet-engine.test.ts);
    // this pins that the reader uses it and hands the result to the desk.
    expect(app).toContain("import { imposedFromInfo } from '../engine/imposed-mark';");
    expect(app).toContain('const readerImposed = imposedFromInfo((await readerDoc.proxy.getMetadata().catch(() => null))?.info);');
    expect(app).toContain('fp: fingerprintPdf(bytes), imposed: readerImposed });');
  });
});

describe('desk strings', () => {
  const keys = [
    'library.desk.more',
    'library.desk.remove',
    'library.desk.removeHint',
    'library.desk.removed',
    'library.desk.imposedTag',
    'common.undo',
  ];

  it('exist in EN and TR without emoji', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLanguage(lang);
      for (const k of keys) {
        expect(t(k), `${lang}:${k}`).not.toBe(k);
        expect(t(k)).not.toMatch(EMOJI);
      }
    }
    setLanguage('tr');
    expect(t('library.desk.remove')).toBe("Masam'dan kaldır");
    expect(t('library.desk.imposedTag')).toBe('Baskı yaprağı');
    expect(t('common.undo')).toBe('Geri al');
  });
});
