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
  'libraryBooksBadge',
  'libraryDeskBadge',
  'librarySearch',
  'libraryNoMatch',
  'libraryBooksPanel',
  'libraryDeskPanel',
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
  els.libraryDeskPanel.classList.add('hidden');
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

  it('desk rows open the entry and the remove button drops it', async () => {
    const { controller, els, deps } = setup();
    await controller.show('desk');
    rows(els.libraryDeskList, 'library-desk-row')[0].click();
    expect(deps.onOpenDesk).toHaveBeenCalledWith(desk[0]);
    rows(els.libraryDeskList, 'library-desk-remove')[1].click();
    await flush();
    expect(deps.onRemoveDesk).toHaveBeenCalledWith(desk[1]);
    expect(rows(els.libraryDeskList, 'library-desk-row')).toHaveLength(1);
    els.libraryOpenPdfBtn.click();
    expect(deps.onOpenPdf).toHaveBeenCalled();
  });

  it('desk rows offer "read as a book" as a second action', async () => {
    const { controller, els, deps } = setup();
    await controller.show('desk');
    const buttons = rows(els.libraryDeskList, 'library-desk-book');
    expect(buttons).toHaveLength(2);
    expect(buttons[1].getAttribute('aria-label')).toBe('library.action.readDesk: b.pdf');
    buttons[1].click();
    expect(deps.onReadDeskAsBook).toHaveBeenCalledWith(desk[1]);
    expect(deps.onOpenDesk).not.toHaveBeenCalled();
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
});
