import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryRecord } from '../native/library-store';
import type { RecentEntry } from '../native/recents-store';
import { createLibraryScreen, LIBRARY_TAB_STORAGE_KEY, SHELF_FRONT_ZONE, type LibraryScreenDeps } from './library-screen';

// Minimal DOM double (no jsdom in this suite, see app.dom.test.ts): enough
// of Element for the controller — ids, classes, attributes, children, events.
class FakeClassList {
  private set = new Set<string>();
  add(...tokens: string[]): void {
    tokens.forEach((x) => this.set.add(x));
  }
  remove(...tokens: string[]): void {
    tokens.forEach((x) => this.set.delete(x));
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
  toggle(token: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(token);
    if (on) this.set.add(token);
    else this.set.delete(token);
    return on;
  }
  reset(value: string): void {
    this.set = new Set(value.split(/\s+/).filter(Boolean));
  }
}

class FakeElement {
  id = '';
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  disabled = false;
  value = '';
  src = '';
  alt = '';
  innerHTML = '';
  private text = '';
  private listeners = new Map<string, Set<(e: unknown) => void>>();

  tagName: string;

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  set className(value: string) {
    this.classList.reset(value);
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    this.text = value;
    this.children.forEach((c) => (c.parentNode = null));
    this.children = [];
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  focus(): void {}
  addEventListener(type: string, fn: (e: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    this.listeners.get(type)?.forEach((fn) => fn({ type, target: this, preventDefault() {}, ...extra }));
  }
  click(): void {
    this.dispatch('click');
  }
  private all(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    if (selector.startsWith('#')) return this.all().filter((e) => e.id === selector.slice(1));
    if (selector.startsWith('.')) return this.all().filter((e) => e.classList.contains(selector.slice(1)));
    throw new Error(`unsupported selector ${selector}`);
  }
}

const IDS = [
  'libraryCount',
  'libraryTabBooks',
  'libraryTabDesk',
  'libraryTabFiles',
  'libraryBooksBadge',
  'libraryDeskBadge',
  'librarySearchWrap',
  'librarySearchToggle',
  'librarySearch',
  'librarySearchClose',
  'libraryNoMatch',
  'libraryBooksPanel',
  'libraryDeskPanel',
  'libraryFilesPanel',
  'libraryShelfSection',
  'libraryShelf',
  'libraryAllSection',
  'libraryBookList',
  'libraryBooksEmpty',
  'libraryProduceBtn',
  'libraryOpenPdfBtn',
  'libraryDeskList',
  'libraryDeskEmpty',
  'libraryDetailSheet',
  'libraryDetailCloseBtn',
  'libraryDetailThumb',
  'libraryDetailCoverFallback',
  'libraryDetailFormat',
  'libraryDetailTitle',
  'libraryDetailSpecs',
  'libraryDetailSourceState',
  'libraryReadBtn',
  'libraryPrintSheetBtn',
  'libraryRelinkBtn',
  'libraryOpenOutputBtn',
  'libraryRemoveBtn',
  'libraryDeskSheet',
  'libraryDeskSheetTitle',
  'libraryDeskSheetCloseBtn',
  'libraryDeskReadBtn',
  'libraryDeskRemoveBtn',
] as const;

function record(id: string, overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id,
    title: `Book ${id}`,
    sourceName: `${id}.pdf`,
    sourcePageCount: 16,
    signatureCount: 1,
    sheetCount: 4,
    sheetSizePt: [841.89, 595.28],
    paddingApplied: 0,
    blanksInserted: 0,
    settings: { options: { paperSize: 'A4' }, wrapCover: null },
    source: { kind: 'private', relPath: `${id}.pdf` },
    output: null,
    thumb: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const desk: RecentEntry[] = [
  { uri: 'content://a', name: 'a.pdf', lastPage: 3, openedAt: 2 },
  { uri: 'content://b', name: 'b.pdf', lastPage: 1, openedAt: 1 },
];

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: unknown[] = [];
  disconnect = vi.fn();
  callback: unknown;
  options: { root?: unknown; rootMargin?: string; threshold?: number };

  constructor(callback: unknown, options: { root?: unknown; rootMargin?: string; threshold?: number } = {}) {
    this.callback = callback;
    this.options = options;
    FakeObserver.instances.push(this);
  }
  observe(el: unknown): void {
    this.observed.push(el);
  }
  unobserve(): void {}
}

function setup(overrides: Partial<LibraryScreenDeps> = {}, books: LibraryRecord[] = [record('a'), record('b')]) {
  FakeObserver.instances = [];
  const root = new FakeElement();
  const els = {} as Record<(typeof IDS)[number], FakeElement>;
  for (const id of IDS) {
    const el = new FakeElement();
    el.id = id;
    root.appendChild(el);
    els[id] = el;
  }
  els.libraryDetailSheet.classList.add('hidden');
  els.libraryDeskSheet.classList.add('hidden');
  els.libraryDeskPanel.classList.add('hidden');
  els.libraryFilesPanel.classList.add('hidden');
  const store = new Map<string, string>();
  const deps: LibraryScreenDeps = {
    root: root as unknown as ParentNode,
    createElement: (tag) => new FakeElement(tag) as unknown as HTMLElement,
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    getLang: () => 'en',
    platform: 'android',
    loadBooks: async () => books,
    loadDesk: async () => desk,
    loadThumb: async () => null,
    probeSource: async () => 'ok',
    formatDate: (ts) => `@${ts}`,
    onOpenPdf: vi.fn(),
    onOpenDesk: vi.fn(),
    onReadDeskAsBook: vi.fn(),
    onProduce: vi.fn(),
    onRead: vi.fn(),
    onPrintSheet: vi.fn(),
    onRelink: vi.fn(async () => null),
    onOpenOutput: vi.fn(),
    onRemove: vi.fn(async () => true),
    onRemoveDesk: vi.fn(async () => {}),
    openModal: vi.fn((el: HTMLElement) => el.classList.remove('hidden')),
    closeModal: vi.fn((el: HTMLElement) => el.classList.add('hidden')),
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: FakeObserver as unknown as LibraryScreenDeps['IntersectionObserver'],
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    searchDebounceMs: 0,
    ...overrides,
  };
  const controller = createLibraryScreen(deps);
  return { controller, els, deps, store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function rows(list: FakeElement, className: string): FakeElement[] {
  return list.querySelectorAll(`.${className}`);
}

describe('library screen controller', () => {
  it('switches tabs: panels, aria-selected and the remembered tab follow', async () => {
    const { controller, els, store } = setup();
    await controller.show('books');
    expect(els.libraryBooksPanel.classList.contains('hidden')).toBe(false);
    expect(els.libraryDeskPanel.classList.contains('hidden')).toBe(true);
    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('true');

    els.libraryTabDesk.click();
    expect(els.libraryBooksPanel.classList.contains('hidden')).toBe(true);
    expect(els.libraryDeskPanel.classList.contains('hidden')).toBe(false);
    expect(els.libraryTabDesk.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('false');
    expect(store.get(LIBRARY_TAB_STORAGE_KEY)).toBe('desk');
  });

  it('shows the book and desk counts on the badges', async () => {
    const { controller, els } = setup();
    await controller.show();
    expect(els.libraryBooksBadge.textContent).toBe('2');
    expect(els.libraryDeskBadge.textContent).toBe('2');
    expect(els.libraryCount.textContent).toBe('library.count:{"count":2}');
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(2);
    expect(rows(els.libraryDeskList, 'library-desk-row')).toHaveLength(2);
  });

  it('opens the detail sheet through openModal and closes it through closeModal', async () => {
    const { controller, els, deps } = setup();
    await controller.show('books');
    rows(els.libraryBookList, 'library-row')[0].click();
    expect(deps.openModal).toHaveBeenCalledWith(els.libraryDetailSheet, expect.anything());
    expect(controller.isDetailOpen()).toBe(true);
    els.libraryDetailCloseBtn.click();
    expect(deps.closeModal).toHaveBeenCalledWith(els.libraryDetailSheet);
    expect(controller.isDetailOpen()).toBe(false);
  });

  it('a missing source offers re-link and blocks read/print; a reachable one the reverse', async () => {
    const probe = vi.fn(async (r: LibraryRecord) => (r.id === 'a' ? ('missing' as const) : ('ok' as const)));
    const { controller, els } = setup({ probeSource: probe });
    await controller.show('books');
    const [rowA, rowB] = rows(els.libraryBookList, 'library-row');

    rowA.click();
    await flush();
    expect(els.libraryRelinkBtn.classList.contains('hidden')).toBe(false);
    expect(els.libraryReadBtn.disabled).toBe(true);
    expect(els.libraryPrintSheetBtn.disabled).toBe(true);
    expect(els.libraryDetailSourceState.classList.contains('hidden')).toBe(false);

    rowB.click();
    await flush();
    expect(els.libraryRelinkBtn.classList.contains('hidden')).toBe(true);
    expect(els.libraryReadBtn.disabled).toBe(false);
    expect(els.libraryPrintSheetBtn.disabled).toBe(false);
    expect(els.libraryDetailSourceState.classList.contains('hidden')).toBe(true);
  });

  it('shows webSession note only when source is missing, not while linked in the current tab', async () => {
    const probe = vi.fn(async (r: LibraryRecord) => (r.id === 'linked' ? ('ok' as const) : ('missing' as const)));
    const { controller, els } = setup({ platform: 'web', probeSource: probe }, [
      record('linked', { source: { kind: 'none' } }),
      record('gone', { source: { kind: 'none' } }),
    ]);
    await controller.show('books');
    const [rowLinked, rowGone] = rows(els.libraryBookList, 'library-row');

    rowLinked.click();
    await flush();
    expect(els.libraryDetailSourceState.classList.contains('hidden')).toBe(true);
    expect(els.libraryDetailSourceState.textContent).toBe('');

    rowGone.click();
    await flush();
    expect(els.libraryDetailSourceState.classList.contains('hidden')).toBe(false);
    expect(els.libraryDetailSourceState.textContent).toContain('library.source.missing');
    expect(els.libraryDetailSourceState.textContent).toContain('library.source.webSession');
  });

  it('renders library.output.none with muted meta row styling when output is null and hides it otherwise', async () => {
    const { controller, els } = setup({}, [
      record('no-out', { output: null }),
      record('has-out', { output: { relPath: 'booklets/has-out' } }),
    ]);
    await controller.show('books');
    const [rowNoOut, rowHasOut] = rows(els.libraryBookList, 'library-row');

    rowNoOut.click();
    await flush();
    const noneRow = els.libraryDetailSpecs.querySelector('.library-spec-outputNone');
    expect(noneRow).not.toBeNull();
    expect(noneRow!.classList.contains('library-spec-source')).toBe(true);
    expect(noneRow!.textContent).toContain('library.output.none');

    rowHasOut.click();
    await flush();
    expect(els.libraryDetailSpecs.querySelector('.library-spec-outputNone')).toBeNull();
    expect(els.libraryDetailSpecs.textContent).not.toContain('library.output.none');
  });

  it('a slow probe for a previous record does not overwrite the record now shown', async () => {
    let finishA: (state: 'missing') => void = () => {};
    const probe = vi.fn((r: LibraryRecord) =>
      r.id === 'a' ? new Promise<'missing'>((resolve) => (finishA = resolve)) : Promise.resolve('ok' as const),
    );
    const { controller, els } = setup({ probeSource: probe });
    await controller.show('books');
    const [rowA, rowB] = rows(els.libraryBookList, 'library-row');
    rowA.click();
    rowB.click();
    await flush();
    finishA('missing');
    await flush();
    expect(els.libraryDetailTitle.textContent).toBe('Book b');
    expect(els.libraryReadBtn.disabled).toBe(false);
    expect(els.libraryRelinkBtn.classList.contains('hidden')).toBe(true);
  });

  it('remove keeps the row when the user declines, drops it once confirmed', async () => {
    const onRemove = vi.fn(async () => false);
    const { controller, els } = setup({ onRemove });
    await controller.show('books');
    rows(els.libraryBookList, 'library-row')[0].click();
    els.libraryRemoveBtn.click();
    await flush();
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(2);

    onRemove.mockResolvedValueOnce(true);
    els.libraryRemoveBtn.click();
    await flush();
    const left = rows(els.libraryBookList, 'library-row');
    expect(left).toHaveLength(1);
    expect(left[0].dataset.recordId).toBe('b');
    expect(els.libraryBooksBadge.textContent).toBe('1');
    expect(controller.isDetailOpen()).toBe(false);
  });

  it('"Print sheets" closes the sheet before handing the record over', async () => {
    const { controller, els, deps } = setup();
    await controller.show('books');
    rows(els.libraryBookList, 'library-row')[1].click();
    await flush();
    els.libraryPrintSheetBtn.click();
    expect(controller.isDetailOpen()).toBe(false);
    expect(deps.onPrintSheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('hide() disconnects the shelf observer, so nothing runs off-screen', async () => {
    const { controller } = setup();
    await controller.show('books');
    const shelfObserver = FakeObserver.instances.find((o) => o.options.threshold === 0.6);
    expect(shelfObserver).toBeDefined();
    expect(shelfObserver!.observed).toHaveLength(2);
    controller.hide();
    expect(shelfObserver!.disconnect).toHaveBeenCalled();
  });

  it('reduced motion gives a static shelf with no observer', async () => {
    const { controller, els } = setup({ matchMedia: () => ({ matches: true }) });
    await controller.show('books');
    expect(els.libraryShelf.classList.contains('is-static')).toBe(true);
    expect(FakeObserver.instances.some((o) => o.options.threshold === 0.6)).toBe(false);
  });

  it('shows the empty state with a produce button when there are no books', async () => {
    const { controller, els, deps } = setup({}, []);
    await controller.show('books');
    expect(els.libraryBooksEmpty.classList.contains('hidden')).toBe(false);
    expect(els.libraryShelfSection.classList.contains('hidden')).toBe(true);
    els.libraryProduceBtn.click();
    expect(deps.onProduce).toHaveBeenCalled();
  });

  it('says so when a search matches nothing, and hides the shelf while searching', async () => {
    const { controller, els } = setup();
    await controller.show('books');
    els.librarySearch.value = 'zzz';
    els.librarySearch.dispatch('input');
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(false);
    expect(els.libraryNoMatch.textContent).toBe('library.noMatch:{"query":"zzz"}');
    expect(els.libraryShelfSection.classList.contains('hidden')).toBe(true);
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(0);

    els.librarySearch.value = 'Book a';
    els.librarySearch.dispatch('input');
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(true);
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(1);
  });

  it('toggles search pill and handles close and Escape', async () => {
    const { controller, els } = setup();
    await controller.show('books');

    // Clicking toggle opens search
    els.librarySearchToggle.click();
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(true);
    expect(els.librarySearchToggle.getAttribute('aria-expanded')).toBe('true');

    // Typing query and clicking close clears input but leaves wrap open
    els.librarySearch.value = 'Book a';
    els.librarySearch.dispatch('input');
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(1);

    els.librarySearchClose.click();
    expect(els.librarySearch.value).toBe('');
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(true);

    // Clicking close when empty closes wrap
    els.librarySearchClose.click();
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(false);
    expect(els.librarySearchToggle.getAttribute('aria-expanded')).toBe('false');

    // Open again, press Escape with input
    els.librarySearchToggle.click();
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(true);
    els.librarySearch.value = 'abc';
    els.librarySearch.dispatch('keydown', { key: 'Escape' });
    expect(els.librarySearch.value).toBe('');
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(true);

    // Press Escape when empty closes wrap
    els.librarySearch.dispatch('keydown', { key: 'Escape' });
    expect(els.librarySearchWrap.classList.contains('is-open')).toBe(false);
  });

  it('desk rows open the entry; "Remove from desk" in the row menu drops it', async () => {
    const { controller, els, deps } = setup();
    await controller.show('desk');
    rows(els.libraryDeskList, 'library-desk-row')[0].click();
    expect(deps.onOpenDesk).toHaveBeenCalledWith(desk[0]);
    rows(els.libraryDeskList, 'library-desk-more')[1].click();
    expect(deps.openModal).toHaveBeenCalledWith(els.libraryDeskSheet, expect.anything());
    expect(els.libraryDeskSheetTitle.textContent).toBe('b.pdf');
    els.libraryDeskRemoveBtn.click();
    await flush();
    expect(deps.closeModal).toHaveBeenCalledWith(els.libraryDeskSheet);
    expect(deps.onRemoveDesk).toHaveBeenCalledWith(desk[1]);
    expect(rows(els.libraryDeskList, 'library-desk-row')).toHaveLength(1);
    expect(els.libraryDeskBadge.textContent).toBe('1');
    els.libraryOpenPdfBtn.click();
    expect(deps.onOpenPdf).toHaveBeenCalled();
  });

  it('each desk row has one labelled menu button and no direct remove or book button', async () => {
    const { controller, els } = setup();
    await controller.show('desk');
    const more = rows(els.libraryDeskList, 'library-desk-more');
    expect(more).toHaveLength(2);
    expect(more[1].getAttribute('aria-label')).toBe('library.desk.more: b.pdf');
    expect(more[1].getAttribute('aria-haspopup')).toBe('dialog');
    expect(rows(els.libraryDeskList, 'library-desk-remove')).toHaveLength(0);
    expect(rows(els.libraryDeskList, 'library-desk-book')).toHaveLength(0);
  });

  it('"Read as a book" in the row menu closes the sheet and hands the entry over', async () => {
    const { controller, els, deps } = setup();
    await controller.show('desk');
    rows(els.libraryDeskList, 'library-desk-more')[1].click();
    expect(els.libraryDeskReadBtn.classList.contains('hidden')).toBe(false);
    els.libraryDeskReadBtn.click();
    expect(els.libraryDeskSheet.classList.contains('hidden')).toBe(true);
    expect(deps.onReadDeskAsBook).toHaveBeenCalledWith(desk[1]);
    expect(deps.onOpenDesk).not.toHaveBeenCalled();
  });

  it('imposed booklet outputs are marked and never offered "Read as a book"', async () => {
    const imposedDesk: RecentEntry[] = [
      { uri: '/DATA/booklets/Deneme/Front Side.pdf', name: 'Front Side.pdf', lastPage: 1, openedAt: 3 },
      { uri: 'content://plain', name: 'plain.pdf', lastPage: 1, openedAt: 2 },
    ];
    const { controller, els, deps } = setup({ loadDesk: async () => imposedDesk });
    await controller.show('desk');
    const icons = rows(els.libraryDeskList, 'library-desk-icon');
    expect(icons[0].classList.contains('is-imposed')).toBe(true);
    expect(icons[1].classList.contains('is-imposed')).toBe(false);
    const tags = rows(els.libraryDeskList, 'library-desk-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toBe('library.desk.imposedTag');

    rows(els.libraryDeskList, 'library-desk-more')[0].click();
    expect(els.libraryDeskReadBtn.classList.contains('hidden')).toBe(true);
    els.libraryDeskReadBtn.click();
    expect(deps.onReadDeskAsBook).not.toHaveBeenCalled();

    rows(els.libraryDeskList, 'library-desk-more')[1].click();
    expect(els.libraryDeskReadBtn.classList.contains('hidden')).toBe(false);
  });

  it('desk meta puts the page first, and leaves page 1 out', async () => {
    const { controller, els } = setup();
    await controller.show('desk');
    const metas = rows(els.libraryDeskList, 'library-desk-meta');
    // desk[0] is on page 3, desk[1] on page 1.
    expect(metas[0].children[0].classList.contains('library-desk-page')).toBe(true);
    expect(metas[0].textContent).toBe('recents.pageAbbrev:{"n":3}·@2');
    expect(rows(metas[1], 'library-desk-page')).toHaveLength(0);
    expect(metas[1].textContent).toBe('@1');
  });

  it('hide() also closes the desk sheet', async () => {
    const { controller, els } = setup();
    await controller.show('desk');
    rows(els.libraryDeskList, 'library-desk-more')[0].click();
    controller.hide();
    expect(els.libraryDeskSheet.classList.contains('hidden')).toBe(true);
  });

  it('the unreachable-source dot says what it means', async () => {
    const { controller, els } = setup({ platform: 'web' }, [record('a', { source: { kind: 'none' } }), record('b')]);
    await controller.show('books');
    const dots = rows(els.libraryBookList, 'library-row-missing');
    expect(dots).toHaveLength(1);
    expect(dots[0].getAttribute('aria-label')).toBe('library.source.rowMissing');
    expect(dots[0].getAttribute('title')).toBe('library.source.rowMissing');
    expect(dots[0].getAttribute('role')).toBe('img');
  });

  it('the front book is the one filling the left slot, and only once it fills most of it', async () => {
    const { controller, els } = setup({}, [record('a', { updatedAt: 3 }), record('b', { updatedAt: 2 }), record('c', { updatedAt: 1 })]);
    await controller.show('books');
    const observer = FakeObserver.instances.find((o) => o.options.root === els.libraryShelf)!;
    expect(observer.options.rootMargin).toBe(SHELF_FRONT_ZONE);
    const books = rows(els.libraryShelf, 'library-book');
    expect(books[0].classList.contains('is-front')).toBe(true);
    const fire = observer.callback as (e: { target: unknown; isIntersecting: boolean; intersectionRatio: number }[]) => void;
    // Book b entering the zone a little does not make it the front book yet.
    fire([{ target: books[1], isIntersecting: true, intersectionRatio: 0.3 }]);
    expect(books[0].classList.contains('is-front')).toBe(true);
    fire([{ target: books[1], isIntersecting: true, intersectionRatio: 0.9 }]);
    expect(books[1].classList.contains('is-front')).toBe(true);
    expect(books[0].classList.contains('is-before')).toBe(true);
  });

  it('clicking the Files tab selects it, shows only its panel, and updates roving tabindex', async () => {
    const { controller, els } = setup();
    await controller.show('books');

    els.librarySearch.value = 'zzz';
    els.librarySearch.dispatch('input');
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(false);

    els.libraryTabFiles.click();

    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('false');
    expect(els.libraryTabDesk.getAttribute('aria-selected')).toBe('false');
    expect(els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryTabBooks.classList.contains('is-active')).toBe(false);
    expect(els.libraryTabDesk.classList.contains('is-active')).toBe(false);
    expect(els.libraryTabFiles.classList.contains('is-active')).toBe(true);
    expect(els.libraryTabBooks.getAttribute('tabindex')).toBe('-1');
    expect(els.libraryTabDesk.getAttribute('tabindex')).toBe('-1');
    expect(els.libraryTabFiles.getAttribute('tabindex')).toBe('0');
    expect(els.libraryBooksPanel.classList.contains('hidden')).toBe(true);
    expect(els.libraryDeskPanel.classList.contains('hidden')).toBe(true);
    expect(els.libraryFilesPanel.classList.contains('hidden')).toBe(false);
    expect(els.librarySearch.getAttribute('aria-controls')).toBe('libraryFilesPanel');
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(true);
  });

  it('supports 3-way keyboard navigation (ArrowRight, ArrowLeft with wrap, Home, End) and moves focus', async () => {
    const { controller, els } = setup();
    const focusBooks = vi.spyOn(els.libraryTabBooks, 'focus');
    const focusDesk = vi.spyOn(els.libraryTabDesk, 'focus');
    const focusFiles = vi.spyOn(els.libraryTabFiles, 'focus');

    await controller.show('desk');
    els.libraryTabDesk.dispatch('keydown', { key: 'ArrowRight' });
    expect(els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryFilesPanel.classList.contains('hidden')).toBe(false);
    expect(els.libraryDeskPanel.classList.contains('hidden')).toBe(true);
    expect(focusFiles).toHaveBeenCalledTimes(1);

    els.libraryTabFiles.dispatch('keydown', { key: 'ArrowRight' });
    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryBooksPanel.classList.contains('hidden')).toBe(false);
    expect(els.libraryFilesPanel.classList.contains('hidden')).toBe(true);
    expect(focusBooks).toHaveBeenCalledTimes(1);

    els.libraryTabBooks.dispatch('keydown', { key: 'ArrowLeft' });
    expect(els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryFilesPanel.classList.contains('hidden')).toBe(false);
    expect(focusFiles).toHaveBeenCalledTimes(2);

    els.libraryTabFiles.dispatch('keydown', { key: 'ArrowLeft' });
    expect(els.libraryTabDesk.getAttribute('aria-selected')).toBe('true');
    expect(focusDesk).toHaveBeenCalledTimes(1);

    els.libraryTabDesk.dispatch('keydown', { key: 'End' });
    expect(els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(focusFiles).toHaveBeenCalledTimes(3);

    els.libraryTabFiles.dispatch('keydown', { key: 'Home' });
    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('true');
    expect(focusBooks).toHaveBeenCalledTimes(2);
  });

  it('never stores "files" in storage, reads a stored "files" back as "books", and honours show("files")', async () => {
    const raw = new Map<string, string>();
    const storage = {
      getItem: (k: string) => raw.get(k) ?? null,
      setItem: vi.fn((k: string, v: string) => void raw.set(k, v)),
    };
    const { controller, els } = setup({ storage });
    await controller.show('desk');
    expect(raw.get(LIBRARY_TAB_STORAGE_KEY)).toBe('desk');

    els.libraryTabFiles.click();
    expect(raw.get(LIBRARY_TAB_STORAGE_KEY)).toBe('desk');
    expect(storage.setItem).not.toHaveBeenCalledWith(LIBRARY_TAB_STORAGE_KEY, 'files');

    raw.set(LIBRARY_TAB_STORAGE_KEY, 'files');
    const second = setup({ storage });
    await second.controller.show();
    expect(second.els.libraryTabBooks.getAttribute('aria-selected')).toBe('true');
    expect(second.els.libraryBooksPanel.classList.contains('hidden')).toBe(false);

    raw.set(LIBRARY_TAB_STORAGE_KEY, 'desk');
    await second.controller.show('files');
    expect(second.els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(second.els.libraryFilesPanel.classList.contains('hidden')).toBe(false);
    expect(raw.get(LIBRARY_TAB_STORAGE_KEY)).toBe('desk');
  });

  it('ships three tabs with no badge on Files in index.html and a 380px rule in styles.css', () => {
    const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
    const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

    const tabsStart = html.indexOf('id="libraryTabs"');
    const tabsEnd = html.indexOf('id="libraryNoMatch"', tabsStart);
    expect(tabsStart).toBeGreaterThan(-1);
    expect(tabsEnd).toBeGreaterThan(tabsStart);
    const tabsBlock = html.slice(tabsStart, tabsEnd);
    expect(tabsBlock.match(/role="tab"/g)).toHaveLength(3);
    expect(tabsBlock).toContain('id="libraryTabBooks"');
    expect(tabsBlock).toContain('id="libraryTabDesk"');
    expect(tabsBlock).toContain('id="libraryTabFiles"');

    const filesTabStart = tabsBlock.indexOf('id="libraryTabFiles"');
    const filesTabEnd = tabsBlock.indexOf('</button>', filesTabStart);
    const filesTabBlock = tabsBlock.slice(filesTabStart, filesTabEnd);
    expect(filesTabBlock).not.toContain('library-tab-badge');
    expect(filesTabBlock).toContain('data-i18n="library.tab.files"');
    expect(html).toContain('id="libraryFilesPanel"');

    const mediaIdx = css.indexOf('@media (max-width: 380px)');
    expect(mediaIdx).toBeGreaterThan(-1);
    expect(css).toMatch(/@media\s*\(max-width:\s*380px\)\s*\{[^}]*\.library-tabs\s*\{[^}]*gap:\s*12px;[^}]*\}[^}]*\.library-tab\s+svg\s*\{[^}]*display:\s*none;[^}]*\}/s);
  });

  it('calls onTabChange with the active tab on init, show, click, keyboard nav, and selectTab', async () => {
    const onTabChange = vi.fn();
    const { controller, els } = setup({ onTabChange });
    expect(onTabChange).toHaveBeenLastCalledWith('books');

    onTabChange.mockClear();
    await controller.show('desk');
    expect(onTabChange).toHaveBeenCalledWith('desk');

    els.libraryTabFiles.click();
    expect(onTabChange).toHaveBeenLastCalledWith('files');

    els.libraryTabFiles.dispatch('keydown', { key: 'Home' });
    expect(onTabChange).toHaveBeenLastCalledWith('books');

    controller.selectTab('files');
    expect(onTabChange).toHaveBeenLastCalledWith('files');
    expect(els.libraryTabFiles.getAttribute('aria-selected')).toBe('true');
    expect(els.libraryFilesPanel.classList.contains('hidden')).toBe(false);
    expect(els.libraryBooksPanel.classList.contains('hidden')).toBe(true);
    expect(els.libraryDeskPanel.classList.contains('hidden')).toBe(true);
  });

  it('hides library search on Files, closes open search, and restores it on Books and Desk', async () => {
    const { controller, els } = setup();
    await controller.show('books');

    els.librarySearchToggle.click();
    els.librarySearch.value = 'zzz';
    els.librarySearch.dispatch('input');
    expect(controller.isSearchOpen()).toBe(true);
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(false);
    expect(els.librarySearchToggle.classList.contains('hidden')).toBe(false);
    expect(els.librarySearchWrap.classList.contains('hidden')).toBe(false);

    controller.selectTab('files');
    expect(controller.isSearchOpen()).toBe(false);
    expect(els.librarySearchToggle.getAttribute('aria-expanded')).toBe('false');
    expect(els.librarySearchToggle.classList.contains('hidden')).toBe(true);
    expect(els.librarySearchWrap.classList.contains('hidden')).toBe(true);
    expect(els.libraryNoMatch.classList.contains('hidden')).toBe(true);
    expect(els.libraryNoMatch.textContent).toBe('');

    controller.selectTab('desk');
    expect(els.librarySearchToggle.classList.contains('hidden')).toBe(false);
    expect(els.librarySearchWrap.classList.contains('hidden')).toBe(false);

    controller.selectTab('files');
    expect(els.librarySearchToggle.classList.contains('hidden')).toBe(true);
    expect(els.librarySearchWrap.classList.contains('hidden')).toBe(true);

    controller.selectTab('books');
    expect(els.librarySearchToggle.classList.contains('hidden')).toBe(false);
    expect(els.librarySearchWrap.classList.contains('hidden')).toBe(false);
  });

  it('exposes isSearchOpen() and closeSearch() for external back handling', async () => {
    const { controller, els } = setup();
    await controller.show('books');

    expect(controller.isSearchOpen()).toBe(false);
    els.librarySearchToggle.click();
    els.librarySearch.value = 'Book a';
    els.librarySearch.dispatch('input');
    expect(controller.isSearchOpen()).toBe(true);
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(1);

    controller.closeSearch();
    expect(controller.isSearchOpen()).toBe(false);
    expect(els.librarySearch.value).toBe('');
    expect(els.librarySearchToggle.getAttribute('aria-expanded')).toBe('false');
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(2);
  });

  it('reloads books and desk data (and updates badges without losing search query) when switching to books or desk tabs', async () => {
    let currentBooks = [record('a'), record('b')];
    let currentDesk: RecentEntry[] = [
      { uri: '/DATA/booklets/x/a.pdf', name: 'a.pdf', lastPage: 2, openedAt: 2 },
      { uri: '/DATA/scans/b.pdf', name: 'b.pdf', lastPage: 1, openedAt: 1 },
    ];
    const loadBooks = vi.fn(async () => currentBooks);
    const loadDesk = vi.fn(async () => currentDesk);
    const { controller, els } = setup({ loadBooks, loadDesk });

    expect(loadBooks).toHaveBeenCalledTimes(0);
    expect(loadDesk).toHaveBeenCalledTimes(0);

    await controller.show('books');
    expect(loadBooks).toHaveBeenCalledTimes(1);
    expect(loadDesk).toHaveBeenCalledTimes(1);
    expect(els.libraryBooksBadge.textContent).toBe('2');
    expect(els.libraryDeskBadge.textContent).toBe('2');

    // Switching to Files does not reload books/desk.
    els.libraryTabFiles.click();
    await flush();
    expect(loadBooks).toHaveBeenCalledTimes(1);
    expect(loadDesk).toHaveBeenCalledTimes(1);

    // Simulate deleting a folder in Files that pruned a desk entry and changed books.
    currentDesk = [{ uri: '/DATA/scans/b.pdf', name: 'b.pdf', lastPage: 1, openedAt: 1 }];
    currentBooks = [record('a')];

    els.libraryTabDesk.click();
    await flush();
    expect(loadBooks).toHaveBeenCalledTimes(2);
    expect(loadDesk).toHaveBeenCalledTimes(2);
    expect(els.libraryDeskBadge.textContent).toBe('1');
    expect(els.libraryBooksBadge.textContent).toBe('1');
    expect(rows(els.libraryDeskList, 'library-desk-row')).toHaveLength(1);
    expect(els.libraryTabDesk.getAttribute('aria-selected')).toBe('true');

    // Active search query is preserved when switching from desk to books.
    els.librarySearchToggle.click();
    els.librarySearch.value = 'Book a';
    els.librarySearch.dispatch('input');
    currentBooks = [record('a'), record('c')];

    els.libraryTabBooks.click();
    await flush();
    expect(loadBooks).toHaveBeenCalledTimes(3);
    expect(loadDesk).toHaveBeenCalledTimes(3);
    expect(els.libraryBooksBadge.textContent).toBe('2');
    expect(els.librarySearch.value).toBe('Book a');
    expect(rows(els.libraryBookList, 'library-row')).toHaveLength(1);
    expect(els.libraryTabBooks.getAttribute('aria-selected')).toBe('true');
  });

  it('hides null-uri entries from the Desk list and Desk badge', async () => {
    const mixedDesk: RecentEntry[] = [
      { uri: null, name: 'unopenable-1.pdf', lastPage: 5, openedAt: 3 },
      { uri: 'content://reopenable', name: 'reopenable.pdf', lastPage: 2, openedAt: 2 },
      { uri: null, name: 'unopenable-2.pdf', lastPage: 1, openedAt: 1 },
    ];
    const { controller, els } = setup({ loadDesk: async () => mixedDesk });
    await controller.show('desk');

    expect(els.libraryDeskBadge.textContent).toBe('1');
    const deskRows = rows(els.libraryDeskList, 'library-desk-row');
    expect(deskRows).toHaveLength(1);
    expect(deskRows[0].textContent).toContain('reopenable.pdf');
    expect(els.libraryDeskEmpty.classList.contains('hidden')).toBe(true);

    // When only null-uri entries exist, Desk shows its empty state and badge 0.
    const onlyNullDesk: RecentEntry[] = [{ uri: null, name: 'only-null.pdf', lastPage: 4, openedAt: 1 }];
    const emptyCase = setup({ loadDesk: async () => onlyNullDesk });
    await emptyCase.controller.show('desk');
    expect(emptyCase.els.libraryDeskBadge.textContent).toBe('0');
    expect(rows(emptyCase.els.libraryDeskList, 'library-desk-row')).toHaveLength(0);
    expect(emptyCase.els.libraryDeskEmpty.classList.contains('hidden')).toBe(false);
  });
});
