import { sheetOfPage, type FormaMap, type FormaSheet, type PhysicalPage } from '../engine/forma-map';
import type { Binding, FlipEdge } from '../engine/types';
import { buildSpreads, clampSpread, pagesOf, pagesToKeep, spreadIndexOfPage, type Spread } from './spreads';

/**
 * The book reader: a document shown two facing pages at a time, the way the
 * produced booklet opens once it is folded — blanks included. For a library
 * record the signature view ("Forma görünümü") shows which sheet, side and half
 * each page is printed on.
 *
 * Rendering is injected (the app passes pdf.js through `renderPage`), so this
 * controller runs against fake elements in tests. Only the visible spread and
 * its neighbours are ever rendered; everything else is released.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface RenderedBookPage {
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
}

export interface BookDocument {
  sequence: PhysicalPage[];
  binding: Binding;
  /** Only for library records with stored booklet settings. */
  forma: FormaMap | null;
  /** Print-time options the signature view explains. */
  printNotes?: { reverseSheetOrder?: boolean; flipEdge?: FlipEdge };
  /** Index into `sequence` to open at. */
  startPage: number;
  /** Height / width of the document's first page, for the page shape. */
  pageAspect: number;
  /** Renders 0-based source page `src` at `widthPx` CSS pixels wide. */
  renderPage(src: number, widthPx: number): Promise<RenderedBookPage>;
  destroy(): Promise<void>;
}

export interface BookReaderDeps {
  root?: ParentNode;
  createElement?: (tag: string) => HTMLElement;
  t: Translate;
  /** Stops every in-flight page render; called before the document is destroyed. */
  cancelRenders: () => void;
  measureStage?: () => { width: number; height: number };
  matchMedia?: (query: string) => { matches: boolean };
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
  /** The earliest visible page (index into the sequence) after every move. */
  onPositionChange?: (seqIndex: number) => void;
  /** Double-tap on a page: open that source page (0-based) somewhere roomier. */
  onOpenPage?: (src: number) => void;
}

export interface BookReaderController {
  open(doc: BookDocument): void;
  /** Cancels renders, then destroys the document. Resolves to the last position. */
  close(): Promise<number | null>;
  isOpen(): boolean;
  next(): void;
  prev(): void;
  goToSpread(index: number, animate?: boolean): void;
  goToPage(seqIndex: number): void;
  currentSpread(): number;
  currentPage(): number | null;
  isFormaOpen(): boolean;
  setFormaOpen(open: boolean): void;
  relayout(): void;
  refreshTexts(): void;
  destroy(): void;
}

/** One leaf, transform only. Matches the CSS animation length. */
export const BOOK_TURN_MS = 320;
export const BOOK_FADE_MS = 120;
const SWIPE_PX = 40;
const EDGE_ZONE = 0.22;
const DOUBLE_TAP_MS = 320;

interface PageEntry {
  el: HTMLElement;
  canvas: HTMLCanvasElement | null;
}

type TurnDirection = 'leftward' | 'rightward';

interface Turn {
  direction: TurnDirection;
  to: Spread;
  timer: unknown;
}

export function createBookReader(deps: BookReaderDeps): BookReaderController {
  const root = deps.root ?? document;
  const make = deps.createElement ?? ((tag: string) => document.createElement(tag));
  const { t } = deps;
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelLater = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => Date.now());

  function q<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  }

  const screenEl = q('screen-book');
  const stage = q('bookStage');
  const slotLeft = q('bookPageLeft');
  const slotRight = q('bookPageRight');
  const tagLeft = q('bookTagLeft');
  const tagRight = q('bookTagRight');
  const leaf = q('bookTurnLeaf');
  const leafFront = q('bookLeafFront');
  const leafBack = q('bookLeafBack');
  const prevBtn = q<HTMLButtonElement>('bookPrevBtn');
  const nextBtn = q<HTMLButtonElement>('bookNextBtn');
  const formaToggle = q<HTMLButtonElement>('bookFormaToggle');
  const pageLabel = q('bookPageLabel');
  const scrubber = q<HTMLInputElement>('bookScrubber');
  const formaPanel = q('bookFormaPanel');
  const formaPages = q('bookFormaPages');
  const formaSheets = q('bookFormaSheets');
  const formaSignatures = q('bookFormaSignatures');
  const formaNotes = q('bookFormaNotes');

  let doc: BookDocument | null = null;
  let spreads: Spread[] = [];
  let current = 0;
  let formaOpen = false;
  let pageWidth = 0;
  // Bumped on open, close and relayout: a render that finishes after its
  // document or size is gone is dropped.
  let generation = 0;
  const pages = new Map<number, PageEntry>();
  let turn: Turn | null = null;
  let fadeTimer: unknown = null;
  let pointer: { x: number; y: number } | null = null;
  let lastTap: { seq: number; at: number } | null = null;

  function el(tag: string, className = '', text?: string): HTMLElement {
    const node = make(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node: HTMLElement): void {
    node.textContent = '';
    const kids = (node as unknown as { children?: ArrayLike<{ remove(): void }> }).children;
    if (kids) Array.from(kids).forEach((child) => child.remove());
  }

  function reducedMotion(): boolean {
    try {
      return Boolean(deps.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  // ── Pages ─────────────────────────────────────────────────────────────────

  function pageEl(seq: number): HTMLElement {
    const cached = pages.get(seq);
    if (cached) return cached.el;
    const page = doc!.sequence[seq];
    const node = el('div', 'book-paper');
    node.dataset.seq = String(seq);
    const entry: PageEntry = { el: node, canvas: null };
    pages.set(seq, entry);
    if (page.src === null) {
      node.classList.add('is-blank');
      return node;
    }
    node.classList.add('is-loading');
    const gen = generation;
    const target = doc!;
    target
      .renderPage(page.src, pageWidth)
      .then(({ wrapper, canvas }) => {
        if (gen !== generation || pages.get(seq) !== entry) {
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
        entry.canvas = canvas;
        node.classList.remove('is-loading');
        node.appendChild(wrapper);
      })
      .catch(() => {
        // A cancelled render (page left the window, document closed) is normal.
        if (pages.get(seq) === entry) node.classList.remove('is-loading');
      });
    return node;
  }

  function evict(seq: number): void {
    const entry = pages.get(seq);
    if (!entry) return;
    if (entry.canvas) {
      // Releases the backing store now rather than whenever GC gets to it.
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    entry.el.remove();
    pages.delete(seq);
  }

  function evictAll(): void {
    for (const seq of [...pages.keys()]) evict(seq);
  }

  function fill(slot: HTMLElement, seq: number | null): void {
    clear(slot);
    slot.classList.toggle('is-empty', seq === null);
    if (seq !== null) slot.appendChild(pageEl(seq));
  }

  function place(spread: Spread): void {
    fill(slotLeft, spread.left);
    fill(slotRight, spread.right);
  }

  function keepWindow(): void {
    const keep = new Set(pagesToKeep(spreads, current));
    for (const seq of [...pages.keys()]) {
      if (!keep.has(seq)) evict(seq);
    }
    // Neighbours render ahead, off-screen, so a turn reveals finished pages.
    for (const seq of keep) pageEl(seq);
  }

  // ── Turning ───────────────────────────────────────────────────────────────

  function finishTurn(): void {
    if (!turn) return;
    const done = turn;
    turn = null;
    cancelLater(done.timer);
    leaf.classList.remove('is-turning', 'turn-leftward', 'turn-rightward');
    leaf.classList.add('hidden');
    clear(leafFront);
    clear(leafBack);
    place(done.to);
  }

  function finishFade(): void {
    if (fadeTimer !== null) cancelLater(fadeTimer);
    fadeTimer = null;
    stage.classList.remove('is-crossfade');
  }

  function startTurn(from: Spread, to: Spread, direction: TurnDirection): void {
    // Leftward: the right-hand page swings over to the left (left-to-right
    // books going forward). Underneath it the next right page is already in
    // place; the leaf's back is the next left page.
    const fromSeq = direction === 'leftward' ? from.right : from.left;
    const backSeq = direction === 'leftward' ? to.left : to.right;
    clear(leafFront);
    clear(leafBack);
    if (fromSeq !== null) leafFront.appendChild(pageEl(fromSeq));
    if (backSeq !== null) leafBack.appendChild(pageEl(backSeq));
    leafFront.classList.toggle('is-empty', fromSeq === null);
    leafBack.classList.toggle('is-empty', backSeq === null);
    if (direction === 'leftward') fill(slotRight, to.right);
    else fill(slotLeft, to.left);
    leaf.classList.remove('hidden', 'turn-leftward', 'turn-rightward');
    leaf.classList.add('is-turning', `turn-${direction}`);
    turn = { direction, to, timer: later(finishTurn, BOOK_TURN_MS) };
  }

  function show(index: number, animate: boolean): void {
    if (!doc || spreads.length === 0) return;
    finishTurn();
    finishFade();
    const target = clampSpread(index, spreads.length);
    const from = spreads[current];
    const step = target - current;
    current = target;
    const to = spreads[current];
    if (animate && step !== 0 && Math.abs(step) === 1 && !reducedMotion() && pageWidth > 0) {
      const forward = step > 0;
      const leftward = doc.binding === 'rtl' ? !forward : forward;
      startTurn(from, to, leftward ? 'leftward' : 'rightward');
    } else {
      place(to);
      if (animate && step !== 0) {
        // Reduced motion: a short crossfade instead of a moving leaf.
        stage.classList.add('is-crossfade');
        fadeTimer = later(finishFade, BOOK_FADE_MS);
      }
    }
    keepWindow();
    renderChrome();
    const first = pagesOf(to)[0];
    if (first !== undefined) deps.onPositionChange?.(first);
  }

  // Physical directions: the page on the right swings left, or the left one right.
  function turnLeftward(): void {
    if (!doc) return;
    show(current + (doc.binding === 'rtl' ? -1 : 1), true);
  }
  function turnRightward(): void {
    if (!doc) return;
    show(current + (doc.binding === 'rtl' ? 1 : -1), true);
  }

  // ── Chrome ────────────────────────────────────────────────────────────────

  function pageNumberText(seq: number): string {
    const page = doc!.sequence[seq];
    let text = t('book.page.number', { n: seq + 1 });
    if (page.src !== null && page.src !== seq) text += ` · ${t('book.page.source', { n: page.src + 1 })}`;
    return text;
  }

  function slotText(seq: number): string {
    const forma = doc!.forma!;
    const slot = forma.slots[seq];
    const side = t(slot.side === 'front' ? 'book.side.front' : 'book.side.back');
    const half = t(slot.slot === 'left' ? 'book.slot.left' : 'book.slot.right');
    if (slot.part === 'cover') return t('book.forma.coverLabel', { side, slot: half });
    return t('book.forma.label', {
      sig: slot.signature,
      sheet: slot.printSheet,
      depth: slot.depth,
      side,
      slot: half,
    });
  }

  function blankText(seq: number): string | null {
    const kind = doc!.sequence[seq].kind;
    if (kind === 'inserted-blank') return t('book.blank.inserted');
    if (kind === 'padding') return t('book.blank.padding');
    return null;
  }

  function renderTag(tag: HTMLElement, seq: number | null): void {
    clear(tag);
    const showTag = formaOpen && doc?.forma && seq !== null;
    tag.classList.toggle('hidden', !showTag);
    if (!showTag) return;
    tag.appendChild(el('span', 'book-tag-main', slotText(seq!)));
    const blank = blankText(seq!);
    if (blank) tag.appendChild(el('span', 'book-tag-blank', blank));
  }

  function sheetFigure(sheet: FormaSheet, visible: Set<number>): HTMLElement {
    const figure = el('figure', 'book-sheet');
    const caption =
      sheet.part === 'cover'
        ? t('book.cover')
        : t('book.sheet.title', { sheet: sheet.printSheet, sig: sheet.signature, depth: sheet.depth });
    figure.appendChild(el('figcaption', 'book-sheet-caption', caption));
    const sides: Array<['front' | 'back', [number, number]]> = [
      ['front', sheet.front],
      ['back', sheet.back],
    ];
    for (const [side, pair] of sides) {
      const row = el('div', `book-sheet-side is-${side}`);
      row.appendChild(el('span', 'book-sheet-side-label', t(side === 'front' ? 'book.side.front' : 'book.side.back')));
      const halves = el('div', 'book-sheet-halves');
      for (const seq of pair) {
        const cell = el('span', 'book-sheet-cell');
        cell.dataset.seq = String(seq);
        cell.classList.toggle('is-current', visible.has(seq));
        const page = doc!.sequence[seq];
        cell.appendChild(el('span', 'book-sheet-num', page.src === null ? t('book.page.blank') : String(seq + 1)));
        if (page.src !== null && page.src !== seq) {
          cell.appendChild(el('span', 'book-sheet-src', t('book.page.source', { n: page.src + 1 })));
        }
        halves.appendChild(cell);
      }
      row.appendChild(halves);
      figure.appendChild(row);
    }
    return figure;
  }

  function renderForma(): void {
    const forma = doc?.forma ?? null;
    formaToggle.classList.toggle('hidden', !forma);
    formaToggle.setAttribute('aria-pressed', String(formaOpen && !!forma));
    formaPanel.classList.toggle('hidden', !(formaOpen && forma));
    screenEl.classList.toggle('is-forma', formaOpen && !!forma);
    const spread = spreads[current];
    renderTag(tagLeft, spread?.left ?? null);
    renderTag(tagRight, spread?.right ?? null);
    clear(formaPages);
    clear(formaSheets);
    clear(formaSignatures);
    clear(formaNotes);
    if (!forma || !formaOpen || !spread) return;

    const visible = pagesOf(spread);
    for (const seq of visible) {
      const item = el('li', 'book-forma-page');
      item.appendChild(el('span', 'book-forma-page-num', pageNumberText(seq)));
      item.appendChild(el('span', 'book-forma-page-slot', slotText(seq)));
      const blank = blankText(seq);
      if (blank) item.appendChild(el('span', 'book-forma-page-blank', blank));
      formaPages.appendChild(item);
    }

    const seen = new Set<FormaSheet>();
    const visibleSet = new Set(visible);
    for (const seq of visible) {
      const sheet = sheetOfPage(forma, seq);
      if (!sheet || seen.has(sheet)) continue;
      seen.add(sheet);
      formaSheets.appendChild(sheetFigure(sheet, visibleSet));
    }

    const currentSig = forma.slots[visible[0]]?.signature ?? 0;
    for (const sig of forma.signatures) {
      const chip = el(
        'button',
        'book-sig-chip',
        t('book.signature.chip', { sig: sig.index, from: sig.firstSeq + 1, to: sig.lastSeq + 1 }),
      );
      chip.setAttribute('type', 'button');
      chip.dataset.sig = String(sig.index);
      chip.classList.toggle('is-current', sig.index === currentSig);
      chip.addEventListener('click', () => goToPage(sig.firstSeq));
      formaSignatures.appendChild(chip);
    }

    const notes: string[] = [];
    if (doc!.printNotes?.reverseSheetOrder) notes.push(t('book.note.reversed'));
    if (doc!.printNotes?.flipEdge === 'long') notes.push(t('book.note.longEdge'));
    for (const note of notes) formaNotes.appendChild(el('p', 'book-forma-note', note));
    formaNotes.classList.toggle('hidden', notes.length === 0);
  }

  function renderChrome(): void {
    if (!doc) return;
    const spread = spreads[current];
    const visible = spread ? pagesOf(spread) : [];
    const total = doc.sequence.length;
    pageLabel.textContent =
      visible.length === 2
        ? t('book.pageRange', { from: visible[0] + 1, to: visible[1] + 1, total })
        : t('book.pageSingle', { n: (visible[0] ?? 0) + 1, total });
    const atStart = current === 0;
    const atEnd = current >= spreads.length - 1;
    prevBtn.disabled = atStart;
    nextBtn.disabled = atEnd;
    scrubber.max = String(Math.max(0, spreads.length - 1));
    scrubber.value = String(current);
    scrubber.disabled = spreads.length <= 1;
    renderForma();
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  function measure(): { width: number; height: number } {
    if (deps.measureStage) return deps.measureStage();
    return { width: stage.clientWidth, height: stage.clientHeight };
  }

  function layout(): boolean {
    if (!doc) return false;
    const { width, height } = measure();
    const aspect = doc.pageAspect > 0 ? doc.pageAspect : Math.SQRT2;
    const w = Math.max(0, Math.floor(Math.min(width / 2, height / aspect)));
    const h = Math.floor(w * aspect);
    const changed = w !== pageWidth;
    pageWidth = w;
    stage.style.setProperty('--book-page-w', `${w}px`);
    stage.style.setProperty('--book-page-h', `${h}px`);
    return changed;
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  const onPrev = (): void => show(current - 1, true);
  const onNext = (): void => show(current + 1, true);
  const onToggle = (): void => setFormaOpen(!formaOpen);
  const onScrub = (): void => show(Number(scrubber.value), false);
  // Arrow keys anywhere on the screen turn pages — except on the scrubber,
  // which moves by itself.
  const onKey = (event: Event): void => {
    if (event.target === scrubber) return;
    const key = (event as KeyboardEvent).key;
    if (key === 'ArrowLeft') {
      event.preventDefault?.();
      turnRightward();
    } else if (key === 'ArrowRight') {
      event.preventDefault?.();
      turnLeftward();
    }
  };
  const onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    pointer = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (event: Event): void => {
    const e = event as PointerEvent;
    const start = pointer;
    pointer = null;
    if (!start || !doc) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      // Finger moving left drags the right-hand page over to the left.
      if (dx < 0) turnLeftward();
      else turnRightward();
      lastTap = null;
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fx = (e.clientX - rect.left) / rect.width;
    if (fx < EDGE_ZONE) {
      turnRightward();
      lastTap = null;
      return;
    }
    if (fx > 1 - EDGE_ZONE) {
      turnLeftward();
      lastTap = null;
      return;
    }
    const spread = spreads[current];
    const seq = fx < 0.5 ? spread?.left : spread?.right;
    if (seq === null || seq === undefined) return;
    const at = now();
    if (lastTap && lastTap.seq === seq && at - lastTap.at <= DOUBLE_TAP_MS) {
      lastTap = null;
      const src = doc.sequence[seq].src;
      if (src !== null) deps.onOpenPage?.(src);
      return;
    }
    lastTap = { seq, at };
  };
  const onPointerCancel = (): void => {
    pointer = null;
  };

  prevBtn.addEventListener('click', onPrev);
  nextBtn.addEventListener('click', onNext);
  formaToggle.addEventListener('click', onToggle);
  scrubber.addEventListener('input', onScrub);
  screenEl.addEventListener('keydown', onKey);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerCancel);

  // ── API ───────────────────────────────────────────────────────────────────

  function open(next: BookDocument): void {
    if (doc) evictAll();
    finishTurn();
    finishFade();
    generation++;
    doc = next;
    spreads = buildSpreads(next.sequence.length, next.binding);
    current = spreadIndexOfPage(spreads, next.startPage);
    formaOpen = false;
    lastTap = null;
    screenEl.classList.toggle('is-rtl', next.binding === 'rtl');
    scrubber.setAttribute('dir', next.binding === 'rtl' ? 'rtl' : 'ltr');
    layout();
    place(spreads[current]);
    keepWindow();
    renderChrome();
  }

  async function close(): Promise<number | null> {
    const closing = doc;
    if (!closing) return null;
    const position = currentPage();
    finishTurn();
    finishFade();
    generation++;
    doc = null;
    // Renders first: the render map is shared app-wide, and a task left
    // running against a destroyed document would outlive it.
    deps.cancelRenders();
    evictAll();
    clear(slotLeft);
    clear(slotRight);
    spreads = [];
    current = 0;
    formaOpen = false;
    renderForma();
    await closing.destroy();
    return position;
  }

  function goToPage(seqIndex: number): void {
    show(spreadIndexOfPage(spreads, seqIndex), true);
  }

  function currentPage(): number | null {
    const spread = spreads[current];
    if (!spread) return null;
    return pagesOf(spread)[0] ?? null;
  }

  function setFormaOpen(value: boolean): void {
    const next = value && !!doc?.forma;
    if (next === formaOpen) return;
    formaOpen = next;
    renderForma();
    // The panel takes room from the stage; the pages follow its new size.
    relayout();
  }

  function relayout(): void {
    if (!doc) return;
    finishTurn();
    if (!layout()) return;
    // A new page width means new renders; the old canvases are the wrong size.
    generation++;
    evictAll();
    place(spreads[current]);
    keepWindow();
  }

  function destroy(): void {
    void close();
    prevBtn.removeEventListener('click', onPrev);
    nextBtn.removeEventListener('click', onNext);
    formaToggle.removeEventListener('click', onToggle);
    scrubber.removeEventListener('input', onScrub);
    screenEl.removeEventListener('keydown', onKey);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerCancel);
  }

  return {
    open,
    close,
    isOpen: () => doc !== null,
    next: onNext,
    prev: onPrev,
    goToSpread: (index, animate = true) => show(index, animate),
    goToPage,
    currentSpread: () => current,
    currentPage,
    isFormaOpen: () => formaOpen,
    setFormaOpen,
    relayout,
    refreshTexts: renderChrome,
    destroy,
  };
}
