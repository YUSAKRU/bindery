import type { LibraryRecord } from '../native/library-store';
import type { RecentEntry } from '../native/recents-store';
import { canReopen, type LibraryPlatform } from './library-record';
import {
  coverInitials,
  detailFields,
  filterDesk,
  filterRecords,
  formatLine,
  isImposedOutput,
  rowMeta,
  shelfSlice,
  type SourceState,
} from './library-view-model';

export type LibraryTab = 'books' | 'desk' | 'files';

const TAB_ORDER: readonly LibraryTab[] = ['books', 'desk', 'files'];

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
  /** Desk entry in the book reader — spreads only, no signature view. Never offered for imposed outputs. */
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
  onTabChange?: (tab: LibraryTab) => void;
  matchMedia?: (query: string) => { matches: boolean };
  IntersectionObserver?: ObserverCtor;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Search input debounce; 0 filters on every keystroke. */
  searchDebounceMs?: number;
}

export interface LibraryScreenController {
  show(tab?: LibraryTab): Promise<void>;
  hide(): void;
  selectTab(tab: LibraryTab): void;
  refreshTexts(): void;
  isDetailOpen(): boolean;
  closeDetail(): void;
  isSearchOpen(): boolean;
  closeSearch(): void;
  destroy(): void;
}

export const LIBRARY_TAB_STORAGE_KEY = 'bindery.library.tab';
/** The leftmost ~40% of the shelf: room for one book at the left gutter. */
export const SHELF_FRONT_ZONE = '0px -60% 0px 0px';
const SHELF_FRONT_RATIO = 0.6;

const SVG_NS_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_DOC = `<svg ${SVG_NS_ATTRS}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
// Two pages side by side on one sheet, with the fold between them.
const ICON_SHEET = `<svg ${SVG_NS_ATTRS}><rect x="2.5" y="6" width="19" height="13" rx="1.5"/><path d="M12 6v13" stroke-dasharray="2 2"/></svg>`;
const ICON_MORE = `<svg ${SVG_NS_ATTRS}><circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>`;

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
  const tabFiles = q<HTMLButtonElement>('libraryTabFiles');
  const booksBadge = q('libraryBooksBadge');
  const deskBadge = q('libraryDeskBadge');
  const searchWrap = root.querySelector<HTMLElement>('#librarySearchWrap');
  const searchToggle = root.querySelector<HTMLButtonElement>('#librarySearchToggle');
  const searchInput = q<HTMLInputElement>('librarySearch');
  const searchClose = root.querySelector<HTMLButtonElement>('#librarySearchClose');
  const noMatch = q('libraryNoMatch');
  const booksPanel = q('libraryBooksPanel');
  const deskPanel = q('libraryDeskPanel');
  const filesPanel = q('libraryFilesPanel');

  const tabEntries: Record<LibraryTab, { tab: HTMLButtonElement; panel: HTMLElement; panelId: string }> = {
    books: { tab: tabBooks, panel: booksPanel, panelId: 'libraryBooksPanel' },
    desk: { tab: tabDesk, panel: deskPanel, panelId: 'libraryDeskPanel' },
    files: { tab: tabFiles, panel: filesPanel, panelId: 'libraryFilesPanel' },
  };
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
  const deskSheet = q('libraryDeskSheet');
  const deskSheetTitle = q('libraryDeskSheetTitle');
  const deskSheetCloseBtn = q<HTMLButtonElement>('libraryDeskSheetCloseBtn');
  const deskReadBtn = q<HTMLButtonElement>('libraryDeskReadBtn');
  const deskRemoveBtn = q<HTMLButtonElement>('libraryDeskRemoveBtn');

  let books: LibraryRecord[] = [];
  let desk: RecentEntry[] = [];
  let tab: LibraryTab = readStoredTab();
  let query = '';
  let detailRecord: LibraryRecord | null = null;
  let deskSheetEntry: RecentEntry | null = null;
  let detailState: SourceState = 'checking';
  // Bumped on every detail open, so a slow probe for a previous record cannot
  // overwrite the state of the one now shown.
  let detailToken = 0;
  // Bumped on every reload/hide, so a slow load cannot overwrite newer data or
  // restart observers after the screen is hidden.
  let loadToken = 0;
  let shelfObserver: ObserverLike | null = null;
  let thumbObserver: ObserverLike | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingThumbs = new Map<Element, string>();

  function readStoredTab(): 'books' | 'desk' {
    try {
      return deps.storage?.getItem(LIBRARY_TAB_STORAGE_KEY) === 'desk' ? 'desk' : 'books';
    } catch {
      return 'books';
    }
  }

  function storeTab(value: LibraryTab): void {
    if (value === 'files') return;
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

  function applyTab(next: LibraryTab): void {
    tab = next;
    for (const id of TAB_ORDER) {
      const active = id === next;
      const entry = tabEntries[id];
      entry.tab.setAttribute('aria-selected', String(active));
      entry.tab.classList.toggle('is-active', active);
      entry.tab.setAttribute('tabindex', active ? '0' : '-1');
      entry.panel.classList.toggle('hidden', !active);
    }
    const isFiles = next === 'files';
    if (isFiles && isSearchOpen()) {
      closeSearch();
    }
    searchToggle?.classList.toggle('hidden', isFiles);
    searchWrap?.classList.toggle('hidden', isFiles);
    searchInput.setAttribute('aria-controls', tabEntries[next].panelId);
    storeTab(next);
    renderNoMatch();
    deps.onTabChange?.(next);
  }

  function setTab(next: LibraryTab): void {
    applyTab(next);
    if (next === 'books' || next === 'desk') {
      void reload();
    }
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
      const imposed = isImposedOutput(entry);
      const li = el('li', 'library-desk-item');
      const row = el('button', 'library-desk-row');
      row.setAttribute('type', 'button');
      const icon = el('span', imposed ? 'library-desk-icon is-imposed' : 'library-desk-icon');
      icon.innerHTML = imposed ? ICON_SHEET : ICON_DOC;
      row.appendChild(icon);
      const text = el('span', 'library-row-text');
      text.appendChild(el('span', 'library-row-title', entry.name));
      // Page first: when the line is too long, the date gives way, not the
      // place the reader stopped. Page 1 is where every file starts, so it is
      // not worth a mention.
      const meta = el('span', 'library-row-meta library-desk-meta');
      const parts: HTMLElement[] = [];
      if (entry.lastPage > 1) parts.push(el('span', 'library-desk-page', t('recents.pageAbbrev', { n: entry.lastPage })));
      if (imposed) parts.push(el('span', 'library-desk-tag', t('library.desk.imposedTag')));
      parts.push(el('span', 'library-desk-date', deps.formatDate(entry.openedAt)));
      parts.forEach((part, i) => {
        if (i > 0) meta.appendChild(el('span', 'library-desk-sep', '·'));
        meta.appendChild(part);
      });
      text.appendChild(meta);
      row.appendChild(text);
      row.addEventListener('click', () => deps.onOpenDesk(entry));
      li.appendChild(row);

      const more = el('button', 'library-desk-more');
      more.setAttribute('type', 'button');
      more.setAttribute('aria-haspopup', 'dialog');
      more.setAttribute('aria-label', `${t('library.desk.more')}: ${entry.name}`);
      more.innerHTML = ICON_MORE;
      more.addEventListener('click', () => openDeskSheet(entry, more));
      li.appendChild(more);
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
      if (tab === 'books') {
        none = books.length > 0 && filterRecords(books, trimmed, deps.getLang()).length === 0;
      } else if (tab === 'desk') {
        none = desk.length > 0 && filterDesk(desk, trimmed, deps.getLang()).length === 0;
      }
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

  // ── Desk actions sheet ────────────────────────────────────────────────────

  function openDeskSheet(entry: RecentEntry, trigger: Element | null): void {
    deskSheetEntry = entry;
    deskSheetTitle.textContent = entry.name;
    // An imposed output is already laid out on sheets; reading it as a book
    // would impose it a second time.
    deskReadBtn.classList.toggle('hidden', isImposedOutput(entry));
    if (deskSheet.classList.contains('hidden')) deps.openModal(deskSheet, trigger);
  }

  function closeDeskSheet(): void {
    if (!deskSheet.classList.contains('hidden')) deps.closeModal(deskSheet);
  }

  function onDeskReadClick(): void {
    const entry = deskSheetEntry;
    if (!entry || isImposedOutput(entry)) return;
    closeDeskSheet();
    deps.onReadDeskAsBook(entry);
  }

  async function onDeskRemoveClick(): Promise<void> {
    const entry = deskSheetEntry;
    if (!entry) return;
    closeDeskSheet();
    deskSheetEntry = null;
    await deps.onRemoveDesk(entry);
    desk = desk.filter((d) => d !== entry);
    renderCounts();
    renderDesk();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  const onTabBooks = (): void => setTab('books');
  const onTabDesk = (): void => setTab('desk');
  const onTabFiles = (): void => setTab('files');
  const onTabKey = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    const idx = TAB_ORDER.indexOf(tab);
    let next: LibraryTab | undefined;
    if (key === 'ArrowRight') next = TAB_ORDER[(idx + 1) % TAB_ORDER.length];
    else if (key === 'ArrowLeft') next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    else if (key === 'Home') next = TAB_ORDER[0];
    else if (key === 'End') next = TAB_ORDER[TAB_ORDER.length - 1];
    if (!next) return;
    event.preventDefault?.();
    setTab(next);
    tabEntries[next].tab.focus?.();
  };
  const applySearch = (): void => {
    query = searchInput.value;
    renderBooks();
    renderDesk();
  };
  function isSearchOpen(): boolean {
    return Boolean(searchWrap?.classList.contains('is-open'));
  }
  function collapseSearch(): void {
    searchWrap?.classList.remove('is-open');
    searchToggle?.setAttribute('aria-expanded', 'false');
  }
  function openSearch(): void {
    searchWrap?.classList.add('is-open');
    searchToggle?.setAttribute('aria-expanded', 'true');
    searchInput.focus?.();
  }
  function closeSearch(): void {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (searchInput.value) {
      searchInput.value = '';
      applySearch();
    }
    collapseSearch();
  }
  const onSearchToggleClick = (): void => {
    if (isSearchOpen()) {
      closeSearch();
    } else {
      openSearch();
    }
  };
  const onSearchCloseClick = (): void => {
    if (searchInput.value) {
      searchInput.value = '';
      applySearch();
    } else {
      collapseSearch();
    }
  };
  const onSearchKeydown = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    if (key === 'Escape') {
      if (searchInput.value) {
        searchInput.value = '';
        applySearch();
      } else {
        collapseSearch();
        searchToggle?.focus?.();
      }
    }
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
  const onDeskSheetClose = (): void => closeDeskSheet();
  const onDeskSheetClick = (event: Event): void => {
    if (event.target === deskSheet) closeDeskSheet();
  };
  const onDeskRemoveBtn = (): void => void onDeskRemoveClick();

  tabBooks.addEventListener('click', onTabBooks);
  tabDesk.addEventListener('click', onTabDesk);
  tabFiles.addEventListener('click', onTabFiles);
  tabBooks.addEventListener('keydown', onTabKey);
  tabDesk.addEventListener('keydown', onTabKey);
  tabFiles.addEventListener('keydown', onTabKey);
  searchToggle?.addEventListener('click', onSearchToggleClick);
  searchClose?.addEventListener('click', onSearchCloseClick);
  searchInput.addEventListener('input', onSearchInput);
  searchInput.addEventListener('keydown', onSearchKeydown);
  produceBtn.addEventListener('click', onProduceClick);
  openPdfBtn.addEventListener('click', onOpenPdfClick);
  detailCloseBtn.addEventListener('click', onCloseClick);
  sheet.addEventListener('click', onSheetClick);
  readBtn.addEventListener('click', onRead);
  printSheetBtn.addEventListener('click', onPrint);
  relinkBtn.addEventListener('click', onRelinkBtn);
  openOutputBtn.addEventListener('click', onOutput);
  removeBtn.addEventListener('click', onRemoveBtn);
  deskSheetCloseBtn.addEventListener('click', onDeskSheetClose);
  deskSheet.addEventListener('click', onDeskSheetClick);
  deskReadBtn.addEventListener('click', onDeskReadClick);
  deskRemoveBtn.addEventListener('click', onDeskRemoveBtn);

  async function reload(): Promise<void> {
    const token = ++loadToken;
    const [loadedBooks, loadedDesk] = await Promise.all([
      deps.loadBooks().catch(() => [] as LibraryRecord[]),
      deps.loadDesk().catch(() => [] as RecentEntry[]),
    ]);
    if (token !== loadToken) return;
    books = loadedBooks;
    desk = loadedDesk.filter((entry) => entry.uri !== null);
    renderCounts();
    renderBooks();
    renderDesk();
  }

  async function show(requested?: LibraryTab): Promise<void> {
    applyTab(requested ?? readStoredTab());
    await reload();
  }

  function hide(): void {
    loadToken++;
    closeDetail();
    closeDeskSheet();
    shelfObserver?.disconnect();
    shelfObserver = null;
    thumbObserver?.disconnect();
    thumbObserver = null;
    pendingThumbs.clear();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    if (!searchInput.value) {
      searchWrap?.classList.remove('is-open');
      searchToggle?.setAttribute('aria-expanded', 'false');
    }
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
    tabFiles.removeEventListener('click', onTabFiles);
    tabBooks.removeEventListener('keydown', onTabKey);
    tabDesk.removeEventListener('keydown', onTabKey);
    tabFiles.removeEventListener('keydown', onTabKey);
    searchToggle?.removeEventListener('click', onSearchToggleClick);
    searchClose?.removeEventListener('click', onSearchCloseClick);
    searchInput.removeEventListener('input', onSearchInput);
    searchInput.removeEventListener('keydown', onSearchKeydown);
    produceBtn.removeEventListener('click', onProduceClick);
    openPdfBtn.removeEventListener('click', onOpenPdfClick);
    detailCloseBtn.removeEventListener('click', onCloseClick);
    sheet.removeEventListener('click', onSheetClick);
    readBtn.removeEventListener('click', onRead);
    printSheetBtn.removeEventListener('click', onPrint);
    relinkBtn.removeEventListener('click', onRelinkBtn);
    openOutputBtn.removeEventListener('click', onOutput);
    removeBtn.removeEventListener('click', onRemoveBtn);
    deskSheetCloseBtn.removeEventListener('click', onDeskSheetClose);
    deskSheet.removeEventListener('click', onDeskSheetClick);
    deskReadBtn.removeEventListener('click', onDeskReadClick);
    deskRemoveBtn.removeEventListener('click', onDeskRemoveBtn);
  }

  applyTab(tab);

  return { show, hide, selectTab: setTab, refreshTexts, isDetailOpen, closeDetail, isSearchOpen, closeSearch, destroy };
}
