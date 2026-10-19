import type { LibraryRecord } from '../native/library-store';
import type { RecentEntry } from '../native/recents-store';
import { canReopen, type LibraryPlatform } from './library-record';
import {
  coverInitials,
  detailFields,
  filterDesk,
  filterRecords,
  formatLine,
  rowMeta,
  shelfSlice,
  type SourceState,
} from './library-view-model';

export type LibraryTab = 'books' | 'desk';

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ObserverLike {
  observe(el: Element): void;
  unobserve?(el: Element): void;
  disconnect(): void;
}

type ObserverCtor = new (
  callback: (entries: { target: Element; isIntersecting: boolean; intersectionRatio: number }[]) => void,
  options?: { root?: Element | null; rootMargin?: string; threshold?: number | number[] },
) => ObserverLike;

export interface LibraryScreenDeps {
  /** Where the screen's markup lives; `document` by default. */
  root?: ParentNode;
  createElement?: (tag: string) => HTMLElement;
  t: Translate;
  getLang: () => string;
  platform: LibraryPlatform;
  loadBooks: () => Promise<LibraryRecord[]>;
  loadDesk: () => Promise<RecentEntry[]>;
  loadThumb: (relPath: string) => Promise<string | null>;
  /** Whether the record's source can be read right now. */
  probeSource: (record: LibraryRecord) => Promise<'ok' | 'missing' | 'unknown'>;
  formatDate: (timestamp: number) => string;
  onOpenPdf: () => void;
  onOpenDesk: (entry: RecentEntry) => void;
  /** Desk entry in the book reader — spreads only, no signature view. */
  onReadDeskAsBook: (entry: RecentEntry) => void;
  onProduce: () => void;
  onRead: (record: LibraryRecord) => void;
  onPrintSheet: (record: LibraryRecord) => void;
  /** Resolves to the updated record, or null when nothing was linked. */
  onRelink: (record: LibraryRecord) => Promise<LibraryRecord | null>;
  onOpenOutput: (record: LibraryRecord) => void;
  /** Asks the user first; resolves true once the record is gone. */
  onRemove: (record: LibraryRecord) => Promise<boolean>;
  onRemoveDesk: (entry: RecentEntry) => Promise<void>;
  openModal: (el: HTMLElement, trigger?: Element | null) => void;
  closeModal: (el: HTMLElement) => void;
  matchMedia?: (query: string) => { matches: boolean };
  IntersectionObserver?: ObserverCtor;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Search input debounce; 0 filters on every keystroke. */
  searchDebounceMs?: number;
}

export interface LibraryScreenController {
  show(tab?: LibraryTab): Promise<void>;
  hide(): void;
  refreshTexts(): void;
  isDetailOpen(): boolean;
  closeDetail(): void;
  destroy(): void;
}

export const LIBRARY_TAB_STORAGE_KEY = 'bindery.library.tab';
/** The leftmost ~40% of the shelf: room for one book at the left gutter. */
export const SHELF_FRONT_ZONE = '0px -60% 0px 0px';
const SHELF_FRONT_RATIO = 0.6;

const SVG_NS_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_DOC = `<svg ${SVG_NS_ATTRS}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
const ICON_CLOSE = `<svg ${SVG_NS_ATTRS}><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const ICON_BOOK = `<svg ${SVG_NS_ATTRS}><path d="M3 5.5C5.5 4.3 8.6 4.3 12 6c3.4-1.7 6.5-1.7 9-.5V19c-2.5-1.2-5.6-1.2-9 .5-3.4-1.7-6.5-1.7-9-.5z"/><path d="M12 6v13.5"/></svg>`;

export function createLibraryScreen(deps: LibraryScreenDeps): LibraryScreenController {
  const root = deps.root ?? document;
  const make = deps.createElement ?? ((tag: string) => document.createElement(tag));
  const { t } = deps;

  function q<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  }

  const countEl = q('libraryCount');
  const tabBooks = q<HTMLButtonElement>('libraryTabBooks');
  const tabDesk = q<HTMLButtonElement>('libraryTabDesk');
  const booksBadge = q('libraryBooksBadge');
  const deskBadge = q('libraryDeskBadge');
  const searchInput = q<HTMLInputElement>('librarySearch');
  const noMatch = q('libraryNoMatch');
  const booksPanel = q('libraryBooksPanel');
  const deskPanel = q('libraryDeskPanel');
  const shelfSection = q('libraryShelfSection');
  const shelf = q('libraryShelf');
  const allSection = q('libraryAllSection');
  const bookList = q('libraryBookList');
  const booksEmpty = q('libraryBooksEmpty');
  const produceBtn = q<HTMLButtonElement>('libraryProduceBtn');
  const openPdfBtn = q<HTMLButtonElement>('libraryOpenPdfBtn');
  const deskList = q('libraryDeskList');
  const deskEmpty = q('libraryDeskEmpty');
  const sheet = q('libraryDetailSheet');
  const detailCloseBtn = q<HTMLButtonElement>('libraryDetailCloseBtn');
  const detailThumb = q<HTMLImageElement>('libraryDetailThumb');
  const detailFallback = q('libraryDetailCoverFallback');
  const detailFormat = q('libraryDetailFormat');
  const detailTitle = q('libraryDetailTitle');
  const detailSpecs = q('libraryDetailSpecs');
  const detailSourceState = q('libraryDetailSourceState');
  const readBtn = q<HTMLButtonElement>('libraryReadBtn');
  const printSheetBtn = q<HTMLButtonElement>('libraryPrintSheetBtn');
  const relinkBtn = q<HTMLButtonElement>('libraryRelinkBtn');
  const openOutputBtn = q<HTMLButtonElement>('libraryOpenOutputBtn');
  const removeBtn = q<HTMLButtonElement>('libraryRemoveBtn');

  let books: LibraryRecord[] = [];
  let desk: RecentEntry[] = [];
  let tab: LibraryTab = readStoredTab();
  let query = '';
  let detailRecord: LibraryRecord | null = null;
  let detailState: SourceState = 'checking';
  // Bumped on every detail open, so a slow probe for a previous record cannot
  // overwrite the state of the one now shown.
  let detailToken = 0;
  let shelfObserver: ObserverLike | null = null;
  let thumbObserver: ObserverLike | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingThumbs = new Map<Element, string>();

  function readStoredTab(): LibraryTab {
    try {
      return deps.storage?.getItem(LIBRARY_TAB_STORAGE_KEY) === 'desk' ? 'desk' : 'books';
    } catch {
      return 'books';
    }
  }

  function storeTab(value: LibraryTab): void {
    try {
      deps.storage?.setItem(LIBRARY_TAB_STORAGE_KEY, value);
    } catch {
      // private mode / blocked storage: the tab is only a convenience
    }
  }

  function reducedMotion(): boolean {
    try {
      return Boolean(deps.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function el(tag: string, className = '', text?: string): HTMLElement {
    const node = make(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node: HTMLElement): void {
    node.textContent = '';
    // Fake DOMs in tests keep children separately from textContent.
    const kids = (node as unknown as { children?: ArrayLike<{ remove(): void }> }).children;
    if (kids) Array.from(kids).forEach((child) => child.remove());
  }

  function setTab(next: LibraryTab): void {
    tab = next;
    tabBooks.setAttribute('aria-selected', String(next === 'books'));
    tabDesk.setAttribute('aria-selected', String(next === 'desk'));
    tabBooks.classList.toggle('is-active', next === 'books');
    tabDesk.classList.toggle('is-active', next === 'desk');
    tabBooks.setAttribute('tabindex', next === 'books' ? '0' : '-1');
    tabDesk.setAttribute('tabindex', next === 'desk' ? '0' : '-1');
    booksPanel.classList.toggle('hidden', next !== 'books');
    deskPanel.classList.toggle('hidden', next !== 'desk');
    searchInput.setAttribute('aria-controls', next === 'books' ? 'libraryBooksPanel' : 'libraryDeskPanel');
    storeTab(next);
    renderNoMatch();
  }

  function renderCounts(): void {
    countEl.textContent = t('library.count', { count: books.length });
    booksBadge.textContent = String(books.length);
    deskBadge.textContent = String(desk.length);
  }

  // ── Covers ────────────────────────────────────────────────────────────────

  function typographicCover(record: LibraryRecord): HTMLElement {
    const cover = el('div', 'library-cover-type');
    cover.setAttribute('aria-hidden', 'true');
    cover.appendChild(el('span', 'library-cover-initials', coverInitials(record.title)));
    cover.appendChild(el('span', 'library-cover-title', record.title));
    return cover;
  }

  function coverFor(record: LibraryRecord, lazy: boolean): HTMLElement {
    const frame = el('div', 'library-cover');
    frame.appendChild(typographicCover(record));
    if (record.thumb) {
      const relPath = record.thumb.relPath;
      if (lazy && thumbObserver) {
        pendingThumbs.set(frame, relPath);
        thumbObserver.observe(frame);
      } else {
        void fillThumb(frame, relPath);
      }
    }
    return frame;
  }

  async function fillThumb(frame: HTMLElement, relPath: string): Promise<void> {
    const url = await deps.loadThumb(relPath).catch(() => null);
    if (!url) return;
    const img = el('img', 'library-cover-img') as HTMLImageElement;
    img.alt = '';
    img.src = url;
    img.setAttribute('decoding', 'async');
    frame.appendChild(img);
    frame.classList.add('has-thumb');
  }

  // ── Shelf ─────────────────────────────────────────────────────────────────

  function setFront(index: number): void {
    const items = Array.from(shelf.querySelectorAll<HTMLElement>('.library-book'));
    items.forEach((item, i) => {
      item.classList.toggle('is-front', i === index);
      item.classList.toggle('is-before', i < index);
      item.classList.toggle('is-after', i > index);
      item.classList.toggle('is-near', Math.abs(i - index) <= 1);
    });
  }

  function renderShelf(): void {
    shelfObserver?.disconnect();
    shelfObserver = null;
    clear(shelf);
    const items = shelfSlice(books);
    const isStatic = reducedMotion();
    shelf.classList.toggle('is-static', isStatic);
    items.forEach((record, i) => {
      const book = el('button', 'library-book');
      book.setAttribute('type', 'button');
      book.dataset.index = String(i);
      book.dataset.recordId = record.id;
      book.setAttribute('aria-label', `${record.title}, ${t('library.detail.pagesValue', { n: record.sourcePageCount })}`);
      const body = el('span', 'library-book-body');
      body.appendChild(coverFor(record, false));
      book.appendChild(body);
      book.appendChild(el('span', 'library-book-title', record.title));
      book.appendChild(el('span', 'library-book-meta', t('library.detail.pagesValue', { n: record.sourcePageCount })));
      book.addEventListener('click', () => openDetail(record, book));
      shelf.appendChild(book);
    });
    setFront(0);
    // The front book follows the scroll position, and only the scroll
    // position: the observer fires on scroll, never while the shelf is idle.
    if (!isStatic && deps.IntersectionObserver && items.length > 1) {
      shelfObserver = new deps.IntersectionObserver(
        (entries) => {
          let best: { index: number; ratio: number } | null = null;
          for (const entry of entries) {
            if (!entry.isIntersecting || entry.intersectionRatio < SHELF_FRONT_RATIO) continue;
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!best || entry.intersectionRatio > best.ratio) best = { index, ratio: entry.intersectionRatio };
          }
          if (best) setFront(best.index);
        },
        // The shelf starts at its left gutter, so the front book is the one
        // filling the leftmost slot: the observed zone is that slot only.
        { root: shelf, rootMargin: SHELF_FRONT_ZONE, threshold: SHELF_FRONT_RATIO },
      );
      shelf.querySelectorAll<HTMLElement>('.library-book').forEach((book) => shelfObserver?.observe(book));
    }
  }

  // ── Lists ─────────────────────────────────────────────────────────────────

  function renderBookList(records: LibraryRecord[]): void {
    clear(bookList);
    for (const record of records) {
      const li = el('li', 'library-row-item');
      const row = el('button', 'library-row');
      row.setAttribute('type', 'button');
      row.dataset.recordId = record.id;
      row.appendChild(coverFor(record, true));
      const text = el('span', 'library-row-text');
      text.appendChild(el('span', 'library-row-title', record.title));
      text.appendChild(el('span', 'library-row-meta', rowMeta(record, t)));
      text.appendChild(el('span', 'library-row-date', deps.formatDate(record.updatedAt)));
      row.appendChild(text);
      if (!canReopen(record.source, deps.platform)) {
        const dot = el('span', 'library-row-missing');
        dot.setAttribute('role', 'img');
        dot.setAttribute('title', t('library.source.rowMissing'));
        dot.setAttribute('aria-label', t('library.source.rowMissing'));
        row.appendChild(dot);
      }
      row.addEventListener('click', () => openDetail(record, row));
      li.appendChild(row);
      bookList.appendChild(li);
    }
  }

  function renderDeskList(entries: RecentEntry[]): void {
    clear(deskList);
    for (const entry of entries) {
      const li = el('li', 'library-desk-item');
      const row = el('button', 'library-desk-row');
      row.setAttribute('type', 'button');
      const icon = el('span', 'library-desk-icon');
      icon.innerHTML = ICON_DOC;
      row.appendChild(icon);
      const text = el('span', 'library-row-text');
      text.appendChild(el('span', 'library-row-title', entry.name));
      text.appendChild(
        el(
          'span',
          'library-row-meta',
          `${deps.formatDate(entry.openedAt)} · ${t('recents.pageAbbrev', { n: entry.lastPage })}`,
        ),
      );
      row.appendChild(text);
      row.addEventListener('click', () => deps.onOpenDesk(entry));
      li.appendChild(row);

      const asBook = el('button', 'library-desk-book');
      asBook.setAttribute('type', 'button');
      asBook.setAttribute('aria-label', `${t('library.action.readDesk')}: ${entry.name}`);
      asBook.setAttribute('title', t('library.action.readDesk'));
      asBook.innerHTML = ICON_BOOK;
      asBook.addEventListener('click', () => deps.onReadDeskAsBook(entry));
      li.appendChild(asBook);

      const remove = el('button', 'library-desk-remove');
      remove.setAttribute('type', 'button');
      remove.setAttribute('aria-label', t('recents.removeFromHistory'));
      remove.innerHTML = ICON_CLOSE;
      remove.addEventListener('click', async () => {
        await deps.onRemoveDesk(entry);
        desk = desk.filter((d) => d !== entry);
        renderCounts();
        renderDesk();
      });
      li.appendChild(remove);
      deskList.appendChild(li);
    }
  }

  function startThumbObserver(): void {
    thumbObserver?.disconnect();
    thumbObserver = null;
    pendingThumbs.clear();
    if (!deps.IntersectionObserver) return;
    thumbObserver = new deps.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const relPath = pendingThumbs.get(entry.target);
          if (relPath === undefined) continue;
          pendingThumbs.delete(entry.target);
          thumbObserver?.unobserve?.(entry.target);
          void fillThumb(entry.target as HTMLElement, relPath);
        }
      },
      { rootMargin: '200px 0px' },
    );
  }

  function renderBooks(): void {
    const searching = query.trim() !== '';
    const matches = filterRecords(books, query, deps.getLang());
    const empty = books.length === 0;
    booksEmpty.classList.toggle('hidden', !empty);
    shelfSection.classList.toggle('hidden', empty || searching);
    allSection.classList.toggle('hidden', empty || matches.length === 0);
    startThumbObserver();
    if (!searching && !empty) renderShelf();
    renderBookList(matches);
    renderNoMatch();
  }

  function renderDesk(): void {
    const matches = filterDesk(desk, query, deps.getLang());
    deskEmpty.classList.toggle('hidden', desk.length > 0);
    deskList.classList.toggle('hidden', matches.length === 0);
    renderDeskList(matches);
    renderNoMatch();
  }

  function renderNoMatch(): void {
    const trimmed = query.trim();
    let none = false;
    if (trimmed) {
      none =
        tab === 'books'
          ? books.length > 0 && filterRecords(books, trimmed, deps.getLang()).length === 0
          : desk.length > 0 && filterDesk(desk, trimmed, deps.getLang()).length === 0;
    }
    noMatch.textContent = none ? t('library.noMatch', { query: trimmed }) : '';
    noMatch.classList.toggle('hidden', !none);
  }

  // ── Detail sheet ──────────────────────────────────────────────────────────

  function renderDetail(): void {
    const record = detailRecord;
    if (!record) return;
    detailTitle.textContent = record.title;
    detailFormat.textContent = formatLine(record.settings.options.paperSize, t);

    clear(detailSpecs);
    for (const field of detailFields(record, { t, sourceState: detailState, formatDate: deps.formatDate })) {
      const wrap = el('div', `library-spec library-spec-${field.key}`);
      wrap.dataset.field = field.key;
      wrap.appendChild(el('dt', '', field.label));
      wrap.appendChild(el('dd', '', field.value));
      detailSpecs.appendChild(wrap);
    }

    const missing = detailState === 'missing';
    const checking = detailState === 'checking';
    readBtn.disabled = missing || checking;
    printSheetBtn.disabled = missing || checking;
    relinkBtn.classList.toggle('hidden', !missing);
    openOutputBtn.classList.toggle('hidden', !record.output);

    const notes: string[] = [];
    if (missing) notes.push(t('library.source.missing'));
    if (deps.platform === 'web' && record.source.kind === 'none') notes.push(t('library.source.webSession'));
    detailSourceState.textContent = notes.join(' ');
    detailSourceState.classList.toggle('hidden', notes.length === 0);
  }

  async function renderDetailCover(record: LibraryRecord, token: number): Promise<void> {
    detailThumb.classList.add('hidden');
    detailThumb.removeAttribute('src');
    clear(detailFallback);
    detailFallback.appendChild(el('span', 'library-cover-initials', coverInitials(record.title)));
    detailFallback.appendChild(el('span', 'library-cover-title', record.title));
    detailFallback.classList.remove('hidden');
    if (!record.thumb) return;
    const url = await deps.loadThumb(record.thumb.relPath).catch(() => null);
    if (!url || token !== detailToken) return;
    detailThumb.src = url;
    detailThumb.classList.remove('hidden');
    detailFallback.classList.add('hidden');
  }

  async function probe(record: LibraryRecord, token: number): Promise<void> {
    let state: SourceState;
    try {
      state = await deps.probeSource(record);
    } catch {
      state = 'unknown';
    }
    if (token !== detailToken) return;
    detailState = state;
    renderDetail();
  }

  function openDetail(record: LibraryRecord, trigger: Element | null): void {
    detailRecord = record;
    detailState = 'checking';
    const token = ++detailToken;
    renderDetail();
    void renderDetailCover(record, token);
    if (sheet.classList.contains('hidden')) deps.openModal(sheet, trigger);
    void probe(record, token);
  }

  function closeDetail(): void {
    if (!sheet.classList.contains('hidden')) deps.closeModal(sheet);
  }

  function isDetailOpen(): boolean {
    return !sheet.classList.contains('hidden');
  }

  // Leaves the sheet first: these actions move to another screen.
  function leaveWith(action: (record: LibraryRecord) => void): () => void {
    return () => {
      const record = detailRecord;
      if (!record) return;
      closeDetail();
      action(record);
    };
  }

  const onRead = leaveWith((r) => deps.onRead(r));
  const onPrint = leaveWith((r) => deps.onPrintSheet(r));
  const onOutput = leaveWith((r) => deps.onOpenOutput(r));

  async function onRelinkClick(): Promise<void> {
    const record = detailRecord;
    if (!record) return;
    const updated = await deps.onRelink(record);
    if (!updated) return;
    books = books.map((b) => (b.id === updated.id ? updated : b));
    renderBooks();
    if (detailRecord?.id === updated.id && isDetailOpen()) openDetail(updated, null);
  }

  async function onRemoveClick(): Promise<void> {
    const record = detailRecord;
    if (!record) return;
    const removed = await deps.onRemove(record);
    if (!removed) return;
    books = books.filter((b) => b.id !== record.id);
    if (detailRecord?.id === record.id) {
      closeDetail();
      detailRecord = null;
    }
    renderCounts();
    renderBooks();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  const onTabBooks = (): void => setTab('books');
  const onTabDesk = (): void => setTab('desk');
  const onTabKey = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
    event.preventDefault?.();
    const next: LibraryTab = tab === 'books' ? 'desk' : 'books';
    setTab(next);
    (next === 'books' ? tabBooks : tabDesk).focus?.();
  };
  const applySearch = (): void => {
    query = searchInput.value;
    renderBooks();
    renderDesk();
  };
  const onSearchInput = (): void => {
    const wait = deps.searchDebounceMs ?? 120;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    if (wait <= 0) {
      applySearch();
      return;
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      applySearch();
    }, wait);
  };
  const onProduceClick = (): void => deps.onProduce();
  const onOpenPdfClick = (): void => deps.onOpenPdf();
  const onCloseClick = (): void => closeDetail();
  const onSheetClick = (event: Event): void => {
    if (event.target === sheet) closeDetail();
  };
  const onRelinkBtn = (): void => void onRelinkClick();
  const onRemoveBtn = (): void => void onRemoveClick();

  tabBooks.addEventListener('click', onTabBooks);
  tabDesk.addEventListener('click', onTabDesk);
  tabBooks.addEventListener('keydown', onTabKey);
  tabDesk.addEventListener('keydown', onTabKey);
  searchInput.addEventListener('input', onSearchInput);
  produceBtn.addEventListener('click', onProduceClick);
  openPdfBtn.addEventListener('click', onOpenPdfClick);
  detailCloseBtn.addEventListener('click', onCloseClick);
  sheet.addEventListener('click', onSheetClick);
  readBtn.addEventListener('click', onRead);
  printSheetBtn.addEventListener('click', onPrint);
  relinkBtn.addEventListener('click', onRelinkBtn);
  openOutputBtn.addEventListener('click', onOutput);
  removeBtn.addEventListener('click', onRemoveBtn);

  async function show(requested?: LibraryTab): Promise<void> {
    setTab(requested ?? readStoredTab());
    const [loadedBooks, loadedDesk] = await Promise.all([
      deps.loadBooks().catch(() => [] as LibraryRecord[]),
      deps.loadDesk().catch(() => [] as RecentEntry[]),
    ]);
    books = loadedBooks;
    desk = loadedDesk;
    renderCounts();
    renderBooks();
    renderDesk();
  }

  function hide(): void {
    closeDetail();
    shelfObserver?.disconnect();
    shelfObserver = null;
    thumbObserver?.disconnect();
    thumbObserver = null;
    pendingThumbs.clear();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
  }

  function refreshTexts(): void {
    renderCounts();
    renderBooks();
    renderDesk();
    if (detailRecord && isDetailOpen()) renderDetail();
  }

  function destroy(): void {
    hide();
    tabBooks.removeEventListener('click', onTabBooks);
    tabDesk.removeEventListener('click', onTabDesk);
    tabBooks.removeEventListener('keydown', onTabKey);
    tabDesk.removeEventListener('keydown', onTabKey);
    searchInput.removeEventListener('input', onSearchInput);
    produceBtn.removeEventListener('click', onProduceClick);
    openPdfBtn.removeEventListener('click', onOpenPdfClick);
    detailCloseBtn.removeEventListener('click', onCloseClick);
    sheet.removeEventListener('click', onSheetClick);
    readBtn.removeEventListener('click', onRead);
    printSheetBtn.removeEventListener('click', onPrint);
    relinkBtn.removeEventListener('click', onRelinkBtn);
    openOutputBtn.removeEventListener('click', onOutput);
    removeBtn.removeEventListener('click', onRemoveBtn);
  }

  setTab(tab);

  return { show, hide, refreshTexts, isDetailOpen, closeDetail, destroy };
}
