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

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');

describe('library screen replaces the recents screen (D1–D3)', () => {
  it('ships #screen-library and no #screen-recents', () => {
    expect(html).toContain('id="screen-library"');
    expect(html).not.toContain('id="screen-recents"');
    expect(source).not.toContain("'screen-recents'");
    expect(source).not.toMatch(/\|\s*'recents'\n/);
  });

  it('library sits under the hub and is titled "My Library"', () => {
    expect(extractBlock('const PARENT_SCREEN')).toContain("library: 'hub',");
    expect(extractBlock('const SCREEN_TITLES')).toContain("library: 'library.title',");
  });

  it('the hub menu entry and card 2 lead to the library', () => {
    const hub = extractBlock('atelierHub = initAtelierHub', '({');
    expect(hub).toContain("showScreen(target === 'recents' ? 'library' : target)");
    expect(hub).toMatch(/moduleIndex === 1\) \{\s*showScreen\('library'\);/);
  });

  it('readers opened from the library come back to it', () => {
    expect(extractBlock('async function openRecent(')).toContain(
      "getCurrentScreenId() === 'library' ? 'library' : 'hub'",
    );
    const lib = extractBlock('libraryScreen = createLibraryScreen', '({');
    expect(lib).toContain("onOpenPdf: () => void openReaderFromPicker('library')");
    // "Read as a book" opens the book reader now (Phase 3), not the reader.
    expect(lib).toContain('onRead: (record) => void readLibraryRecordAsBook(record)');
  });

  it('leaving the library stops its observers', () => {
    const body = extractBlock('function showScreen(id: ScreenId): void');
    expect(body).toMatch(/getCurrentScreenId\(\) === 'library' && id !== 'library'\) \{\s*libraryScreen\?\.hide\(\);/);
  });
});

describe('"Print sheets" regenerates into the same record (D9–D11)', () => {
  it('the generation after the reset takes the pending record id, then clears it', () => {
    const body = extractBlock("generateBtn.addEventListener('click', async () =>");
    const reset = body.indexOf('currentLibraryRecordId = null');
    const take = body.indexOf('currentLibraryRecordId = pendingLibraryRecordId;');
    expect(take).toBeGreaterThan(reset);
    expect(body.indexOf('pendingLibraryRecordId = null;', take)).toBeGreaterThan(take);
  });

  it('sets the pending id and the return screen after loading the source, before generating', () => {
    const body = extractBlock('async function printLibraryRecord(');
    const load = body.indexOf('loadBookletFile(');
    const apply = body.indexOf('applyStoredBookletSettings(record.settings)');
    const pending = body.indexOf('pendingLibraryRecordId = record.id;');
    const back = body.indexOf("bookletResultReturnTo = 'library';");
    const go = body.indexOf('generateBtn.click()');
    expect(load).toBeGreaterThan(body.indexOf('resetPicker()'));
    expect(apply).toBeGreaterThan(load);
    expect(pending).toBeGreaterThan(load);
    expect(back).toBeGreaterThan(load);
    expect(go).toBeGreaterThan(Math.max(apply, pending, back));
  });

  it('a newly loaded or reset booklet forgets a pending record', () => {
    for (const signature of ['function loadBookletFile(', 'function resetPicker(): void']) {
      const body = extractBlock(signature, signature.endsWith('void') ? '{' : '> {');
      expect(body, signature).toContain('pendingLibraryRecordId = null;');
      expect(body, signature).toContain("bookletResultReturnTo = 'hub';");
    }
  });

  it('back from the result screen goes where the result came from', () => {
    const body = extractBlock("backBtn.addEventListener('click', async () =>");
    expect(body).toContain("current === 'result' ? bookletResultReturnTo : (PARENT_SCREEN[current] ?? 'hub')");
  });

  it('applyStoredBookletSettings assigns every setting resetPicker resets', () => {
    const reset = extractBlock('function resetPicker(): void');
    const apply = extractBlock('function applyStoredBookletSettings(', '): void {');
    const assigned = (body: string) =>
      new Set(Array.from(body.matchAll(/^\s*([A-Za-z]+(?:\.value)?) = /gm), (m) => m[1]));
    // Per-document or per-result state, not booklet settings: a stored
    // record has nothing to restore into these.
    const notSettings = new Set([
      'selectedFile',
      'bookletSourceRef',
      'currentLibraryRecordId',
      'lastBookletResultMeta',
      'pendingLibraryRecordId',
      'pendingLibraryTitle',
      'bookletResultReturnTo',
      'bookletOriginalPages',
      'bookletSourceSheetSize',
    ]);
    const applied = assigned(apply);
    const missing = [...assigned(reset)].filter((name) => !notSettings.has(name) && !applied.has(name));
    expect(missing).toEqual([]);
    // And the controls that resetPicker does not touch but makeBooklet reads.
    expect(applied.has('gutterSlider.value')).toBe(true);
    expect(applied.has('creepSlider.value')).toBe(true);
  });
});

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

describe('book reader wiring (Phase 3)', () => {
  it('ships #screen-book under the library', () => {
    expect(html).toContain('id="screen-book"');
    expect(extractBlock('const PARENT_SCREEN')).toContain("book: 'library',");
    expect(extractBlock('const SCREEN_TITLES')).toContain("book: 'book.title',");
  });

  it('leaving the book closes its document and locks portrait; entering unlocks and opens the session', () => {
    const body = extractBlock('function showScreen(id: ScreenId): void');
    expect(body).toMatch(
      /getCurrentScreenId\(\) === 'book' && id !== 'book'\) \{[^}]*void closeBookReader\(id === 'reader'\);\s*void ScreenOrientation\.lock\(\{ orientation: 'portrait' \}\)/,
    );
    expect(body).toMatch(/id === 'book'\) \{\s*void ScreenOrientation\.unlock\(\)\.catch\(\(\) => \{\}\);\s*void startBookSession\(\);/);
  });

  it('the book cancels the shared render map before it destroys its document', () => {
    const deps = extractBlock('bookReader = createBookReader', '({');
    expect(deps).toContain('cancelRenders: cancelAllReaderRenders,');
    const close = extractBlock('async function closeBookReader(');
    expect(close).toContain('bookReader?.close()');
    expect(close).not.toContain('destroy(');
  });

  it('signature view only for library records: desk sessions carry no record', () => {
    const start = extractBlock('async function startBookSession(');
    expect(start).toContain('const options = session.record?.settings.options;');
    expect(start).toContain('const forma = options ? computeFormaMap(proxy.numPages, options) : null;');
    const desk = extractBlock('async function readDeskAsBook(');
    expect(desk).toMatch(/record: null,/);
    const lib = extractBlock('libraryScreen = createLibraryScreen', '({');
    expect(lib).toContain('onReadDeskAsBook: (entry) => void readDeskAsBook(entry),');
  });

  it('back closes the signature view first, then leaves the book', () => {
    const body = extractBlock("backBtn.addEventListener('click', async () =>");
    expect(body).toMatch(
      /current === 'book'\) \{\s*if \(bookReader\?\.isFormaOpen\(\)\) \{\s*bookReader\.setFormaOpen\(false\);\s*return;\s*\}\s*showScreen\(PARENT_SCREEN\.book/,
    );
    // Before the unsaved-result check, which belongs to the result screens.
    expect(body.indexOf("current === 'book'")).toBeLessThan(body.indexOf('hasUnsavedResultPdf()'));
  });

  it('the book position is stored when the book closes', () => {
    const close = extractBlock('async function closeBookReader(');
    expect(close).toContain('patchRecord(session.record.id, { lastReadPage: position + 1 })');
    expect(close).toContain('updateLastPage(session.desk, position + 1)');
  });
});

describe('library polish', () => {
  it('the library hides only the top-bar title, not the back button or other screens\' titles', () => {
    expect(css).toMatch(/\.app:has\(#screen-library:not\(\.hidden\)\) \.top-bar-title \{\s*visibility: hidden;/);
    const hides = css.match(/[^}]*\.top-bar-title \{\s*visibility: hidden;/g) ?? [];
    expect(hides).toHaveLength(1);
  });

  it('the shelf starts at the left gutter and snaps books to the start', () => {
    const shelf = css.slice(css.indexOf('.library-shelf {'), css.indexOf('}', css.indexOf('.library-shelf {')));
    expect(shelf).not.toContain('calc(50% - 60px)');
    expect(shelf).toContain('scroll-padding-inline-start: 14px;');
    const book = css.slice(css.indexOf('.library-book {'), css.indexOf('}', css.indexOf('.library-book {')));
    expect(book).toContain('scroll-snap-align: start;');
  });
});
