import { describe, expect, it, vi } from 'vitest';
import { computeFormaMap, type PhysicalPage } from '../engine/forma-map';
import { BOOK_TURN_MS, createBookReader, type BookDocument, type BookReaderDeps } from './book-reader';

// Minimal DOM double (no jsdom in this suite, see app.dom.test.ts).
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
  max = '';
  style = { props: new Map<string, string>(), setProperty(k: string, v: string) { this.props.set(k, v); } };
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
  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 300 };
  }
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
  'screen-book',
  'bookStage',
  'bookPageLeft',
  'bookPageRight',
  'bookTagLeft',
  'bookTagRight',
  'bookTurnLeaf',
  'bookLeafFront',
  'bookLeafBack',
  'bookPrevBtn',
  'bookNextBtn',
  'bookFormaToggle',
  'bookPageLabel',
  'bookScrubber',
  'bookFormaPanel',
  'bookFormaPages',
  'bookFormaSheets',
  'bookFormaSignatures',
  'bookFormaNotes',
] as const;

type FakeCanvas = { width: number; height: number; src: number };

function plainSequence(n: number): PhysicalPage[] {
  return Array.from({ length: n }, (_, i) => ({ src: i, kind: 'page' as const }));
}

function setup(overrides: Partial<BookReaderDeps> = {}) {
  const root = new FakeElement();
  const els = {} as Record<(typeof IDS)[number], FakeElement>;
  for (const id of IDS) {
    const el = new FakeElement();
    el.id = id;
    root.appendChild(el);
    els[id] = el;
  }
  els.bookTurnLeaf.classList.add('hidden');
  const timers: Array<{ fn: () => void; ms: number; done: boolean }> = [];
  let clock = 1000;
  const deps: BookReaderDeps = {
    root: root as unknown as ParentNode,
    createElement: (tag) => new FakeElement(tag) as unknown as HTMLElement,
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    cancelRenders: vi.fn(),
    measureStage: () => ({ width: 400, height: 300 }),
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, done: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (h) => {
      if (h) (h as { done: boolean }).done = true;
    },
    now: () => clock,
    ...overrides,
  };
  const reader = createBookReader(deps);
  const runTimers = () => {
    for (const timer of timers.splice(0)) if (!timer.done) timer.fn();
  };
  const tick = (ms: number) => {
    clock += ms;
  };
  return { reader, els, deps, runTimers, tick };
}

function makeDoc(sequence: PhysicalPage[], extra: Partial<BookDocument> = {}) {
  const canvases: FakeCanvas[] = [];
  const renderPage = vi.fn(async (src: number) => {
    const canvas: FakeCanvas = { width: 300, height: 400, src };
    canvases.push(canvas);
    return { wrapper: new FakeElement() as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement };
  });
  const destroy = vi.fn(async () => {});
  const doc: BookDocument = {
    sequence,
    binding: 'ltr',
    forma: null,
    startPage: 0,
    pageAspect: 1.4,
    renderPage,
    destroy,
    ...extra,
  };
  return { doc, renderPage, destroy, canvases };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seqIn(slot: FakeElement): number | null {
  const page = slot.children[0];
  return page ? Number(page.dataset.seq) : null;
}

describe('book reader controller', () => {
  it('moves spread by spread: the label follows, and the buttons stop at the ends', () => {
    const { reader, els, runTimers } = setup();
    reader.open(makeDoc(plainSequence(5)).doc);
    expect(els.bookPageLabel.textContent).toBe('book.pageSingle:{"n":1,"total":5}');
    expect(els.bookPrevBtn.disabled).toBe(true);
    expect(els.bookNextBtn.disabled).toBe(false);

    els.bookNextBtn.click();
    runTimers();
    expect(els.bookPageLabel.textContent).toBe('book.pageRange:{"from":2,"to":3,"total":5}');
    expect([seqIn(els.bookPageLeft), seqIn(els.bookPageRight)]).toEqual([1, 2]);

    els.bookNextBtn.click();
    runTimers();
    expect(els.bookPageLabel.textContent).toBe('book.pageRange:{"from":4,"to":5,"total":5}');
    expect(els.bookNextBtn.disabled).toBe(true);
    els.bookNextBtn.click();
    runTimers();
    expect(reader.currentSpread()).toBe(2);

    els.bookPrevBtn.click();
    runTimers();
    expect(reader.currentSpread()).toBe(1);
  });

  it('renders only the visible spread and its neighbours, and releases pages left behind', async () => {
    const { reader, runTimers } = setup();
    const { doc, renderPage, canvases } = makeDoc(plainSequence(40));
    reader.open(doc);
    await flush();
    // Spread 0 (page 1) + spread 1 (pages 2, 3).
    expect(renderPage.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([0, 1, 2]);

    for (let i = 0; i < 3; i++) {
      reader.next();
      runTimers();
      await flush();
    }
    // Now on spread 3 (book pages 6|7): the window is spreads 2–4 → indices 3–8.
    const rendered = new Set(renderPage.mock.calls.map((c) => c[0]));
    expect([...rendered].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const live = canvases.filter((c) => c.width > 0).map((c) => c.src).sort((a, b) => a - b);
    expect(live).toEqual([3, 4, 5, 6, 7, 8]);
    expect(canvases.filter((c) => c.src <= 2).every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it('offers the signature view only for a record with stored settings', () => {
    const { reader, els } = setup();
    reader.open(makeDoc(plainSequence(8)).doc);
    expect(els.bookFormaToggle.classList.contains('hidden')).toBe(true);
    reader.setFormaOpen(true);
    expect(reader.isFormaOpen()).toBe(false);
    expect(els.bookFormaPanel.classList.contains('hidden')).toBe(true);

    const forma = computeFormaMap(8, {})!;
    reader.open(makeDoc(forma.sequence, { forma }).doc);
    expect(els.bookFormaToggle.classList.contains('hidden')).toBe(false);
    els.bookFormaToggle.click();
    expect(els.bookFormaToggle.getAttribute('aria-pressed')).toBe('true');
    expect(els.bookFormaPanel.classList.contains('hidden')).toBe(false);
  });

  it('labels each visible page with its sheet, side and half — cover and blanks included', () => {
    const { reader, els, runTimers } = setup();
    const forma = computeFormaMap(10, { separateCover: true, insertBlankAfter: [4] })!;
    reader.open(makeDoc(forma.sequence, { forma, printNotes: { reverseSheetOrder: true } }).doc);
    reader.setFormaOpen(true);
    // Spread 0: page 1 alone on the right — the front cover.
    expect(els.bookTagRight.textContent).toBe(
      'book.forma.coverLabel:{"side":"book.side.front","slot":"book.slot.right"}',
    );
    expect(els.bookTagLeft.classList.contains('hidden')).toBe(true);
    expect(els.bookFormaSheets.querySelectorAll('.book-sheet')).toHaveLength(1);
    expect(els.bookFormaNotes.textContent).toBe('book.note.reversed');

    // Spread 2: book pages 4|5; page 5 is the inserted blank.
    reader.goToSpread(2, false);
    runTimers();
    expect(forma.sequence[4].kind).toBe('inserted-blank');
    const slot = forma.slots[4];
    expect(els.bookTagRight.textContent).toBe(
      `book.forma.label:${JSON.stringify({ sig: 1, sheet: slot.printSheet, depth: slot.depth, side: `book.side.${slot.side}`, slot: `book.slot.${slot.slot}` })}book.blank.inserted`,
    );
    const chips = els.bookFormaSignatures.querySelectorAll('.book-sig-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0].classList.contains('is-current')).toBe(true);
  });

  it('turns one leaf over the right page going forward, and commits after the turn', () => {
    const { reader, els, runTimers } = setup();
    reader.open(makeDoc(plainSequence(9)).doc);
    reader.next();
    reader.next();
    runTimers();
    // From spread 2 (indices 3|4) to spread 3 (5|6).
    reader.next();
    expect(els.bookTurnLeaf.classList.contains('is-turning')).toBe(true);
    expect(els.bookTurnLeaf.classList.contains('turn-leftward')).toBe(true);
    expect(seqIn(els.bookLeafFront)).toBe(4);
    expect(seqIn(els.bookLeafBack)).toBe(5);
    expect(seqIn(els.bookPageRight)).toBe(6);
    expect(seqIn(els.bookPageLeft)).toBe(3);
    runTimers();
    expect(els.bookTurnLeaf.classList.contains('hidden')).toBe(true);
    expect(els.bookTurnLeaf.classList.contains('is-turning')).toBe(false);
    expect([seqIn(els.bookPageLeft), seqIn(els.bookPageRight)]).toEqual([5, 6]);
  });

  it('right-to-left books turn the left page over to the right going forward', () => {
    const { reader, els } = setup();
    reader.open(makeDoc(plainSequence(9), { binding: 'rtl' }).doc);
    reader.next();
    expect(els.bookTurnLeaf.classList.contains('turn-rightward')).toBe(true);
    expect(seqIn(els.bookLeafFront)).toBe(0);
    // Swipe to the right reveals the next spread of a right-to-left book.
    els.bookStage.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    els.bookStage.dispatch('pointerup', { clientX: 220, clientY: 105 });
    expect(reader.currentSpread()).toBe(2);
  });

  it('reduced motion crossfades instead of turning a leaf', () => {
    const { reader, els, runTimers } = setup({ matchMedia: () => ({ matches: true }) });
    reader.open(makeDoc(plainSequence(9)).doc);
    reader.next();
    expect(els.bookTurnLeaf.classList.contains('is-turning')).toBe(false);
    expect(els.bookTurnLeaf.classList.contains('hidden')).toBe(true);
    expect(els.bookStage.classList.contains('is-crossfade')).toBe(true);
    expect([seqIn(els.bookPageLeft), seqIn(els.bookPageRight)]).toEqual([1, 2]);
    runTimers();
    expect(els.bookStage.classList.contains('is-crossfade')).toBe(false);
  });

  it('the turn lasts BOOK_TURN_MS and nothing is scheduled once it ends', () => {
    const scheduled: number[] = [];
    const { reader, runTimers } = setup({
      setTimeout: (fn, ms) => {
        scheduled.push(ms);
        return { fn };
      },
    });
    reader.open(makeDoc(plainSequence(9)).doc);
    reader.next();
    expect(scheduled).toEqual([BOOK_TURN_MS]);
    runTimers();
  });

  it('close cancels renders before destroying the document, and drops late renders', async () => {
    const order: string[] = [];
    const { reader } = setup({ cancelRenders: () => order.push('cancel') });
    let resolveLate: ((v: { wrapper: HTMLElement; canvas: HTMLCanvasElement }) => void) | null = null;
    const late = { width: 300, height: 400 };
    const { doc } = makeDoc(plainSequence(4), {
      renderPage: () =>
        new Promise((resolve) => {
          resolveLate ??= resolve;
        }),
      destroy: async () => {
        order.push('destroy');
      },
    });
    reader.open(doc);
    reader.goToSpread(1, false);
    const position = await reader.close();
    expect(order).toEqual(['cancel', 'destroy']);
    expect(position).toBe(1);
    expect(reader.isOpen()).toBe(false);
    resolveLate!({ wrapper: new FakeElement() as unknown as HTMLElement, canvas: late as unknown as HTMLCanvasElement });
    await flush();
    expect(late).toEqual({ width: 0, height: 0 });
  });

  it('a double tap on a page opens that source page; an edge tap turns instead', () => {
    const onOpenPage = vi.fn();
    const { reader, els, tick } = setup({ onOpenPage });
    reader.open(makeDoc(plainSequence(9), { startPage: 3 }).doc);
    // Spread 2 = pages 3|4; tap the left page twice (x = 150 of 400).
    const tap = (x: number) => {
      els.bookStage.dispatch('pointerdown', { clientX: x, clientY: 100 });
      els.bookStage.dispatch('pointerup', { clientX: x, clientY: 100 });
    };
    tap(150);
    tick(200);
    tap(150);
    expect(onOpenPage).toHaveBeenCalledWith(3);
    tap(390);
    expect(reader.currentSpread()).toBe(3);
    expect(onOpenPage).toHaveBeenCalledTimes(1);
  });

  it('opens at the stored position and reports moves', () => {
    const onPositionChange = vi.fn();
    const { reader, runTimers } = setup({ onPositionChange });
    reader.open(makeDoc(plainSequence(20), { startPage: 9 }).doc);
    expect(reader.currentSpread()).toBe(5);
    reader.next();
    runTimers();
    expect(onPositionChange).toHaveBeenLastCalledWith(11);
  });
});
