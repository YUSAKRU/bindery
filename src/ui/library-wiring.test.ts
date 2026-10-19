import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {};
  }
});

import { isBrowsableEntry } from './app';

// Source-level assertions, like app.dom.test.ts: the booklet save/share
// handlers and the picker are closures inside initApp() and there is no DOM in
// this test environment, so the placement of the library hooks is checked
// against app.ts itself.
const source = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf-8');

// `bodyOpen` locates the body's opening brace when the signature itself
// contains braces (object-typed parameters).
function extractBlock(signature: string, bodyOpen = '{'): string {
  const start = source.indexOf(signature);
  expect(start, `expected to find "${signature}" in app.ts`).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf(bodyOpen, start + signature.length) + bodyOpen.length - 1;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated block for "${signature}"`);
}

describe('library hooks in the booklet result handlers', () => {
  it('save records the booklet after the last private write and before it is marked saved', () => {
    const body = extractBlock("bookletSaveBtn.addEventListener('click', async () =>");
    const record = body.indexOf("recordBookletInLibrary('save'");
    expect(record).toBeGreaterThan(body.lastIndexOf('savePdfPrivately('));
    expect(record).toBeLessThan(body.indexOf("bookletSaveState = 'saved'"));
    expect(body.slice(record - 5, record)).toBe('void ');
  });

  it('share records only after a share that was not canceled, and print never does', () => {
    const body = extractBlock("document.querySelectorAll<HTMLButtonElement>('[data-target][data-action]')");
    const record = body.indexOf("recordBookletInLibrary('share'");
    expect(record).toBeGreaterThan(body.indexOf("=== 'canceled') return;"));
    expect(record).toBeGreaterThan(body.indexOf('printPdf('));
    expect(body.split('recordBookletInLibrary(').length - 1).toBe(1);
    expect(body.slice(record - 5, record)).toBe('void ');
  });

  it('recording swallows its own failures', () => {
    const body = extractBlock('async function recordBookletInLibrary(', '): Promise<void> {');
    expect(body.trimStart().startsWith('{\n    try {')).toBe(true);
    expect(body).toMatch(/\} catch \(error\) \{\s*console\.warn\(/);
  });

  it('a fresh generation starts a new record', () => {
    const body = extractBlock("generateBtn.addEventListener('click', async () =>");
    const reset = body.indexOf('currentLibraryRecordId = null');
    expect(reset).toBeGreaterThan(body.indexOf('await makeBooklet('));
  });
});

describe('booklet source picking (D5)', () => {
  it('the device branch picks through SAF on Android when a persistent source is asked for', () => {
    const body = extractBlock('function promptAndPickPdfs(options: {\n', '> {');
    const branch = body.indexOf("options.persistentSource && Capacitor.getPlatform() === 'android'");
    expect(branch).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('pickPdfWithPersistentUri()', branch)).toBeGreaterThan(branch);
    expect(body).toContain("picked.persistent ? { kind: 'saf', uri: picked.uri } : { kind: 'none' }");
  });

  it('the booklet picker asks for a persistent source and keeps it', () => {
    const body = extractBlock("pickFileBtn.addEventListener('click', async () =>");
    expect(body).toContain('promptAndPickPdfs({ allowMultiple: false, persistentSource: true })');
    expect(body).toContain('loadBookletFile(picked.bytes, picked.name, picked.source)');
  });
});

describe('isBrowsableEntry', () => {
  it('hides dot-entries such as the library thumbnail folder', () => {
    expect(isBrowsableEntry({ type: 'directory', name: '.library' })).toBe(false);
    expect(isBrowsableEntry({ type: 'file', name: '.hidden.pdf' })).toBe(false);
  });

  it('still lists PDFs and folders, and hides non-PDF files', () => {
    expect(isBrowsableEntry({ type: 'file', name: 'x.pdf' })).toBe(true);
    expect(isBrowsableEntry({ type: 'directory', name: 'booklets' })).toBe(true);
    expect(isBrowsableEntry({ type: 'file', name: 'profileInstalled' })).toBe(false);
  });
});
