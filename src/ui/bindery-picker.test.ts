import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {};
  }
});

import { pickerFolderLabel, sortPickerEntries } from './app';
import { setLanguage, t } from '../i18n';

// The Bindery documents picker (#binderyFilePickerModal), opened from
// "Bindery Belgeleri" in the PDF source modal. No DOM here, so markup, styles
// and the render code are checked as text, like the other UI contract tests.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
const html = read('../../index.html');
const css = read('./styles.css');
const source = read('./app.ts');

function modalHtml(): string {
  const start = html.indexOf('id="binderyFilePickerModal"');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('id="toast"', start);
  return html.slice(html.lastIndexOf('<div', start), end);
}

function modalCss(): string {
  const start = css.indexOf('/* Atelier Bindery Picker Modal (#binderyFilePickerModal) */');
  const end = css.indexOf('/* End Atelier Bindery Picker Modal */');
  expect(start, 'scoped picker CSS section').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

function fnBody(signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `expected "${signature}" in app.ts`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start + signature.length);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced');
}

const EMOJI = /\p{Extended_Pictographic}/u;

// setLanguage persists the choice and relabels the DOM; give it inert stand-ins.
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
});
afterEach(() => {
  setLanguage('en');
  vi.unstubAllGlobals();
});

describe('sortPickerEntries', () => {
  it('lists folders before files', () => {
    const out = sortPickerEntries([
      { type: 'file' as const, name: 'a.pdf' },
      { type: 'directory' as const, name: 'scans' },
      { type: 'file' as const, name: 'b.pdf' },
      { type: 'directory' as const, name: 'booklets' },
    ]);
    expect(out.map((e) => e.name)).toEqual(['booklets', 'scans', 'a.pdf', 'b.pdf']);
  });

  it('orders numbered names numerically, not character by character', () => {
    const out = sortPickerEntries([
      { type: 'file' as const, name: '10 - Ek.pdf' },
      { type: 'file' as const, name: '2 - Okuma.pdf' },
    ]);
    expect(out.map((e) => e.name)).toEqual(['2 - Okuma.pdf', '10 - Ek.pdf']);
  });

  it('does not mutate its input', () => {
    const input = [
      { type: 'file' as const, name: 'b.pdf' },
      { type: 'directory' as const, name: 'a' },
    ];
    sortPickerEntries(input);
    expect(input[0].name).toBe('b.pdf');
  });
});

describe('pickerFolderLabel', () => {

  it('translates the app’s own top-level folders', () => {
    setLanguage('tr');
    expect(pickerFolderLabel('booklets', 0)).toBe('Kitapçıklar');
    expect(pickerFolderLabel('scans', 0)).toBe('Taramalar');
    setLanguage('en');
    expect(pickerFolderLabel('booklets', 0)).toBe('Booklets');
  });

  it('leaves user-named and nested folders as they are on disk', () => {
    setLanguage('tr');
    expect(pickerFolderLabel('Deneme Kitapçığı', 1)).toBe('Deneme Kitapçığı');
    expect(pickerFolderLabel('booklets', 1)).toBe('booklets');
    expect(pickerFolderLabel('Notes', 0)).toBe('Notes');
  });
});

describe('#binderyFilePickerModal markup', () => {
  const m = modalHtml();

  it('carries no emoji', () => {
    expect(m).not.toMatch(EMOJI);
  });

  it('has an up button, a labelled breadcrumb nav and the list', () => {
    expect(m).toMatch(/<button type="button" class="bp-up hidden" id="binderyPickerUpBtn"[^>]*data-i18n-aria-label="modal\.binderyPicker\.up"/);
    expect(m).toMatch(/<nav class="bp-crumbs" id="binderyPickerBreadcrumb"[^>]*data-i18n-aria-label="modal\.binderyPicker\.path"/);
    expect(m).toContain('id="binderyPickerList"');
    expect(m).not.toContain('folder-select-list');
  });
});

describe('picker render code', () => {
  const list = fnBody('async function renderBinderyPickerList(allowMultiple: boolean): Promise<void>');
  const crumbs = fnBody('function renderBinderyPickerBreadcrumb(): void');

  it('renders each row as a real button, sorted, without emoji icons', () => {
    expect(list).toContain("document.createElement('button')");
    expect(list).toContain("row.type = 'button'");
    expect(list).toContain('sortPickerEntries(items.filter(isBrowsableEntry))');
    expect(list).not.toMatch(EMOJI);
    expect(list).not.toContain('file-item-card');
  });

  it('exposes multi-select state to assistive tech', () => {
    expect(list).toContain("row.setAttribute('aria-pressed', String(isSelected))");
    expect(list).toContain("row.setAttribute('aria-pressed', String(nowSelected))");
  });

  it('shows translated folder labels in rows and in the trail', () => {
    expect(list).toContain('pickerFolderLabel(item.name, depth)');
    expect(crumbs).toContain('pickerFolderLabel(part, idx)');
  });

  it('builds the trail from styled segments, rooted at “Bindery Documents”', () => {
    expect(crumbs).toContain("t('modal.binderyPicker.root')");
    expect(crumbs).toContain("seg.className = 'bp-crumb'");
    expect(crumbs).not.toContain('breadcrumb-item');
    expect(crumbs).not.toContain("t('files.root')");
    expect(crumbs).toContain("seg.setAttribute('aria-current', 'location')");
  });

  it('hides the up button at the root and keeps the current folder in view', () => {
    expect(crumbs).toContain("binderyPickerUpBtn.classList.toggle('hidden', parts.length === 0)");
    expect(crumbs).toContain('binderyPickerBreadcrumb.scrollLeft = binderyPickerBreadcrumb.scrollWidth');
  });
});

describe('#binderyFilePickerModal styles', () => {
  const c = modalCss();

  it('styles every class the markup and render code use', () => {
    for (const cls of ['bp-head', 'bp-up', 'bp-crumbs', 'bp-crumb', 'bp-crumb-sep', 'bp-list', 'bp-item', 'bp-item-icon', 'bp-item-text', 'bp-item-name', 'bp-item-meta', 'bp-item-trail', 'bp-empty']) {
      expect(c, cls).toMatch(new RegExp(`#binderyFilePickerModal \\.${cls}[\\s{.:,]`));
    }
  });

  it('receives the atelier tokens in light, OS-dark and in-app dark', () => {
    expect(css).toMatch(/#pdfSourceModal,\n#binderyFilePickerModal,\n#confirmModal,/);
    expect(css).toMatch(/:root:not\(\.light-theme\) #binderyFilePickerModal,\n/);
    expect(css).toMatch(/:root\.dark-theme #binderyFilePickerModal,\n/);
  });

  it('only uses CSS variables that are defined somewhere', () => {
    const used = new Set([...c.matchAll(/var\((--[\w-]+)/g)].map((x) => x[1]));
    for (const v of used) expect(css, v).toContain(`${v}:`);
  });

  it('keeps touch targets at least 44px', () => {
    const px = (sel: string, prop: string) => {
      const block = c.match(new RegExp(`#binderyFilePickerModal \\.${sel} \\{([^}]*)\\}`))?.[1] ?? '';
      return Number(block.match(new RegExp(`\\b${prop}:\\s*(\\d+)px`))?.[1] ?? 0);
    };
    expect(px('bp-item', 'min-height')).toBeGreaterThanOrEqual(44);
    expect(px('bp-up', 'height')).toBeGreaterThanOrEqual(44);
    expect(px('btn-text', 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('does not trap the list in a fixed 200px box', () => {
    expect(c).not.toMatch(/max-height:\s*200px/);
    expect(c).toMatch(/\.bp-list \{[^}]*overflow-y: auto/);
  });
});

describe('picker strings', () => {
  const keys = ['modal.binderyPicker.root', 'modal.binderyPicker.up', 'modal.binderyPicker.path', 'modal.binderyPicker.folder.booklets', 'modal.binderyPicker.folder.scans'];

  it('exist in EN and TR without emoji', () => {
    for (const lang of ['en', 'tr'] as const) {
      setLanguage(lang);
      for (const k of keys) {
        expect(t(k), `${lang}:${k}`).not.toBe(k);
        expect(t(k)).not.toMatch(EMOJI);
      }
    }
    setLanguage('tr');
    expect(t('modal.binderyPicker.root')).toBe('Bindery Belgeleri');
  });
});
