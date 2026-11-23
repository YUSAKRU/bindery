import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const appSource = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

function extractBlock(source: string, signature: string, bodyOpen = '{'): string {
  const start = source.indexOf(signature);
  expect(start, `expected to find "${signature}"`).toBeGreaterThanOrEqual(0);
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

const LEGACY_FILES_SCREEN = ['screen', 'files'].join('-');
const LEGACY_SHOW_FILES = ["showScreen('", "files')"].join('');

describe('Files browser inside Library (T-12 steps 3+4)', () => {
  it('removes the standalone files screen and places all Files ids inside #libraryFilesPanel', () => {
    expect(html).not.toContain(`id="${LEGACY_FILES_SCREEN}"`);

    const panel = extractTagBlock(html, 'id="libraryFilesPanel"', 'section');
    for (const id of [
      'filesBreadcrumb',
      'filesSortBtn',
      'filesDownloadBtn',
      'filesNewFolderBtn',
      'filesSearchInput',
      'filesList',
      'filesEmptyHint',
      'filesSortSheet',
      'filesSortBackdrop',
    ]) {
      expect(panel, `expected #${id} inside #libraryFilesPanel`).toContain(`id="${id}"`);
    }
    expect(panel).toContain('data-sort="name-asc"');
    expect(panel).toContain('data-sort="date-desc"');
  });

  it('uses SVG icons instead of emojis in the breadcrumb and file action sheet', () => {
    const emojiRe = /\p{Extended_Pictographic}/u;

    const breadcrumbStart = appSource.indexOf('const FILES_ICON_HOME');
    const breadcrumbEnd = appSource.indexOf('const FILE_TOOL_LOADERS', breadcrumbStart);
    expect(breadcrumbStart).toBeGreaterThanOrEqual(0);
    expect(breadcrumbEnd).toBeGreaterThan(breadcrumbStart);
    const breadcrumbCode = appSource.slice(breadcrumbStart, breadcrumbEnd);
    expect(breadcrumbCode).not.toMatch(emojiRe);
    expect(breadcrumbCode).toContain('<svg aria-hidden="true" class="icon-svg"');
    expect(breadcrumbCode).toContain("t('files.goToRoot')");

    const actionStart = appSource.indexOf('const FILES_ACTION_ICON_OPEN_IN');
    const actionEnd = appSource.indexOf('const FILES_ICON_FOLDER', actionStart);
    expect(actionStart).toBeGreaterThanOrEqual(0);
    expect(actionEnd).toBeGreaterThan(actionStart);
    const actionCode = appSource.slice(actionStart, actionEnd);
    expect(actionCode).not.toMatch(emojiRe);
    expect(actionCode).toContain('folder-select-icon');
    expect(actionCode).toContain('FILES_ACTION_ICON_OPEN_IN');
    expect(actionCode).toContain('FILES_ACTION_ICON_SHARE');
    expect(actionCode).toContain('FILES_ACTION_ICON_MOVE');
    expect(actionCode).toContain('FILES_ACTION_ICON_RENAME');
    expect(actionCode).toContain('FILES_ACTION_ICON_DELETE');

    const folderSelectRule = css.slice(
      css.indexOf('.folder-select-item {'),
      css.indexOf('}', css.indexOf('.folder-select-item {')),
    );
    expect(folderSelectRule).toContain('display: flex;');
    expect(folderSelectRule).toContain('align-items: center;');
    expect(folderSelectRule).toContain('gap: 10px;');
  });

  it('removes the files screen from ScreenId, PARENT_SCREEN, SCREEN_TITLES, screens, and showScreen', () => {
    const screenIdBlock = appSource.slice(
      appSource.indexOf('type ScreenId ='),
      appSource.indexOf('const PARENT_SCREEN'),
    );
    expect(screenIdBlock).not.toContain("'files'");

    expect(extractBlock(appSource, 'const PARENT_SCREEN')).not.toMatch(/\bfiles\s*:/);
    expect(extractBlock(appSource, 'const SCREEN_TITLES')).not.toMatch(/\bfiles\s*:/);
    expect(extractBlock(appSource, 'const screens: Record<ScreenId, HTMLElement> =')).not.toContain(LEGACY_FILES_SCREEN);
    expect(appSource).not.toContain(LEGACY_SHOW_FILES);

    const showScreenBody = extractBlock(appSource, 'function showScreen(id: ScreenId): void');
    expect(showScreenBody).not.toContain("id === 'files'");
    expect(showScreenBody).toContain("id !== 'library' && id !== 'reader' && id !== 'book'");
    expect(showScreenBody).toContain('filesBackTarget = null;');
    expect(showScreenBody).toContain('filesLandingPath = null;');
    expect(showScreenBody).toContain('readerReturnLibraryTab = null;');
    expect(showScreenBody).toContain('libraryScreen?.show(tabToShow)');
  });

  it('routes all six go-to-location buttons through openLibrary with a screen backTarget', () => {
    const cases = [
      ['bookletGoToLocationBtn', 'result'],
      ['mergeGoToLocationBtn', 'merge-result'],
      ['organizeGoToLocationBtn', 'organize-result'],
      ['rotateGoToLocationBtn', 'rotate-result'],
      ['pageNumbersGoToLocationBtn', 'page-numbers-result'],
      ['watermarkGoToLocationBtn', 'watermark-result'],
    ] as const;

    for (const [btnName, expectedScreen] of cases) {
      const body = extractBlock(appSource, `${btnName}.addEventListener('click', () =>`);
      expect(body, btnName).toContain("openLibrary('files'");
      expect(body, btnName).toMatch(new RegExp(`backTarget:\\s*\\{\\s*screen:\\s*'${expectedScreen}'\\s*\\}`));
    }
  });

  it('wires library onOpenOutput with backTarget { tab: "books" } and onTabChange', () => {
    const lib = extractBlock(appSource, 'libraryScreen = createLibraryScreen', '({');
    expect(lib).toMatch(
      /onOpenOutput:\s*\(record\)\s*=>\s*\{[^}]*openLibrary\('files',\s*\{\s*folderPath:\s*record\.output\.relPath,\s*backTarget:\s*\{\s*tab:\s*'books'\s*\}\s*\}\)/s,
    );
    expect(lib).toMatch(
      /onTabChange:\s*\(tab\)\s*=>\s*\{[^}]*if \(tab === 'files'\) void renderFilesList\(\);[^}]*setErrorScreen\(`library:\$\{tab\}`\);/s,
    );
  });

  it('opens the reader from Files with returnTo="library" and returnLibraryTab="files"', () => {
    const readerTool = extractBlock(appSource, 'const FILE_TOOL_LOADERS', '= {');
    expect(readerTool).not.toContain("'files', 1");
    expect(readerTool).toContain("openReaderWithBytes(bytes, name, uri, 'library', 1, relPath, 'files')");

    const renderFiles = extractBlock(appSource, 'async function renderFilesList(): Promise<void>');
    expect(renderFiles).not.toContain("'files', 1");
    expect(renderFiles).toContain("openReaderWithBytes(picked.bytes, picked.name, item.uri, 'library', 1, relPath, 'files')");

    const downloadConfirm = extractBlock(appSource, "downloadPdfConfirmBtn.addEventListener('click', async () =>");
    expect(downloadConfirm).not.toContain("'files', 1");
    expect(downloadConfirm).toContain("openReaderWithBytes(bytes, filename, savedUri, 'library', 1, targetPath, 'files')");

    const backHandler = extractBlock(appSource, "backBtn.addEventListener('click', async () =>");
    expect(backHandler).toContain("readerReturnTo === 'library' && readerReturnLibraryTab");
    expect(backHandler).toContain('openLibrary(returnTab)');
  });

  it('shares handleLibraryFilesBack between top-bar back and Android back, and closes search first on Android', () => {
    const shared = extractBlock(appSource, 'function handleLibraryFilesBack(): boolean');
    expect(shared).toContain("getCurrentScreenId() !== 'library' || currentLibraryTab !== 'files'");
    expect(shared).toContain('filesLandingPath !== null && currentFolderPath === filesLandingPath && filesBackTarget');
    expect(shared).toContain('libraryScreen?.selectTab(target.tab)');
    expect(shared).toContain('showScreen(target.screen)');
    expect(shared).toContain('void renderFilesList();');

    const backHandler = extractBlock(appSource, "backBtn.addEventListener('click', async () =>");
    expect(backHandler).toContain("if (current === 'library' && handleLibraryFilesBack())");

    const androidBack = extractBlock(appSource, "App.addListener('backButton', () =>");
    const searchIdx = androidBack.indexOf("if (current === 'library' && libraryScreen?.isSearchOpen())");
    const filesBackIdx = androidBack.indexOf("if (current === 'library' && handleLibraryFilesBack())");
    expect(searchIdx).toBeGreaterThanOrEqual(0);
    expect(androidBack).toContain('libraryScreen.closeSearch();');
    expect(filesBackIdx).toBeGreaterThan(searchIdx);
    expect(androidBack).not.toContain("current === 'files'");
  });

  it('opens and closes the files sort sheet through openModal and closeModal', () => {
    const openBtn = extractBlock(appSource, "filesSortBtn.addEventListener('click', () =>");
    expect(openBtn).toContain('openModal(filesSortSheet, filesSortBtn)');
    expect(openBtn).not.toContain("classList.remove('hidden')");

    const backdrop = extractBlock(appSource, "filesSortBackdrop.addEventListener('click', () =>");
    expect(backdrop).toContain('closeModal(filesSortSheet)');
    expect(backdrop).not.toContain("classList.add('hidden')");

    const rowsLoop = extractBlock(appSource, "\n  filesSortRows.forEach((row) =>");
    expect(rowsLoop).toContain("row.addEventListener('click'");
    expect(rowsLoop).toContain('closeModal(filesSortSheet)');
    expect(rowsLoop).not.toContain("classList.add('hidden')");
  });
});
