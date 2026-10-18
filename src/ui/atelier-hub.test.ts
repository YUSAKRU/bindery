import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage, t } from '../i18n';
import {
  type AtelierHubController,
  type AtelierModuleIndex,
  type AtelierNavTarget,
  createAtelierHub,
  DOCK_META,
  FREE_POSITIONS,
  initAtelierHub,
  resolveAtelierBackAction,
} from './atelier-hub';

interface FakeDomEvent {
  type: string;
  clientX?: number;
  clientY?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  target?: FakeElement;
  stopPropagation?: () => void;
  cancelBubble?: boolean;
}

// Lightweight deterministic DOM double for Node.js Vitest environment
class FakeClassList {
  private classes = new Set<string>();

  constructor(initial = '') {
    initial
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this.classes.add(c));
  }

  add(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.add(t));
  }

  remove(...tokens: string[]): void {
    tokens.forEach((t) => this.classes.delete(t));
  }

  contains(token: string): boolean {
    return this.classes.has(token);
  }

  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class FakeElement {
  id = '';
  tagName = 'DIV';
  classList = new FakeClassList();
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  textContent = '';
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private listeners: Map<string, Set<(e: FakeDomEvent) => void>> = new Map();
  rect = { left: 0, top: 0, width: 240, height: 310, right: 240, bottom: 310 };

  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.classList = new FakeClassList(value);
  }

  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.classList.toString() || null;
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'id') return Boolean(this.id);
    return this.attributes.has(name);
  }

  getBoundingClientRect() {
    return this.rect;
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) {
        this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = null;
    }
  }

  addEventListener(type: string, listener: (e: FakeDomEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: FakeDomEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    if (!event.target) event.target = this;
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        h(event);
      }
    }
    return true;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map((s) => s.trim());
    return parts.some((part) => {
      if (part.startsWith('#')) {
        return this.id === part.slice(1);
      }
      if (part.startsWith('.')) {
        return this.classList.contains(part.slice(1));
      }
      const attrMatch = part.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]$/);
      if (attrMatch) {
        const [, attr, val] = attrMatch;
        if (val === undefined) {
          return this.hasAttribute(attr);
        }
        return this.getAttribute(attr) === val;
      }
      return this.tagName.toLowerCase() === part.toLowerCase();
    });
  }

  closest(selector: string): FakeElement | null {
    let curr: FakeElement | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector<T = FakeElement>(selector: string): T | null {
    const all = this.querySelectorAll<T>(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll<T = FakeElement>(selector: string): T[] {
    const results: FakeElement[] = [];
    const check = (node: FakeElement) => {
      if (selector.includes(' ')) {
        const [ancestorSel, descendantSel] = selector.split(/\s+/);
        if (node.matches(descendantSel)) {
          let p = node.parentNode;
          let matched = false;
          while (p) {
            if (p.matches(ancestorSel)) {
              matched = true;
              break;
            }
            p = p.parentNode;
          }
          if (matched) results.push(node);
        }
      } else if (node.matches(selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        check(child);
      }
    };
    for (const child of this.children) {
      check(child);
    }
    return results as unknown as T[];
  }
}

class FakeWindow {
  private listeners: Map<string, Set<(e: FakeDomEvent) => void>> = new Map();
  location = { search: '' };

  addEventListener(type: string, listener: (e: FakeDomEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: FakeDomEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: FakeDomEvent): boolean {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        h(event);
      }
    }
    return true;
  }
}

interface HubFixture {
  root: FakeElement;
  canvasContainer: FakeElement;
  viewport: FakeElement;
  cards: [FakeElement, FakeElement, FakeElement];
  savedCountEl: FakeElement;
  indicators: [FakeElement, FakeElement, FakeElement];
  modeToggleBtn: FakeElement;
  modeToggleLabel: FakeElement;
  modeHint: FakeElement;
  actionBtn: FakeElement;
  btnTitle: FakeElement;
  btnSub: FakeElement;
  btnIcon: FakeElement;
  icons: [FakeElement, FakeElement, FakeElement];
  menuBtn: FakeElement;
  menuSheet: FakeElement;
  menuPanel: FakeElement;
  menuNavBtns: Record<AtelierNavTarget, FakeElement>;
}

function createFixture(): HubFixture {
  const root = new FakeElement('div');
  root.id = 'hubAtelierView';

  const header = new FakeElement('header');
  root.appendChild(header);
  const menuBtn = new FakeElement('button');
  menuBtn.id = 'atelierMenuBtn';
  menuBtn.setAttribute('aria-expanded', 'false');
  header.appendChild(menuBtn);

  const canvasContainer = new FakeElement('main');
  canvasContainer.id = 'atelierCanvasContainer';
  root.appendChild(canvasContainer);

  const viewport = new FakeElement('div');
  viewport.id = 'atelierViewport3D';
  canvasContainer.appendChild(viewport);

  // Cards positioned in non-colliding desk space
  const card0 = new FakeElement('div');
  card0.id = 'atelierCard0';
  card0.setAttribute('data-atelier-index', '0');
  card0.rect = { left: 50, top: 50, width: 240, height: 310, right: 290, bottom: 360 }; // Center: (170, 205)
  viewport.appendChild(card0);

  const card1 = new FakeElement('div');
  card1.id = 'atelierCard1';
  card1.setAttribute('data-atelier-index', '1');
  card1.rect = { left: 400, top: 100, width: 240, height: 310, right: 640, bottom: 410 }; // Center: (520, 255)
  viewport.appendChild(card1);

  const savedCountEl = new FakeElement('span');
  savedCountEl.id = 'atelierCard1SavedCount';
  card1.appendChild(savedCountEl);

  const card2 = new FakeElement('div');
  card2.id = 'atelierCard2';
  card2.setAttribute('data-atelier-index', '2');
  card2.rect = { left: 200, top: 500, width: 240, height: 310, right: 440, bottom: 810 }; // Center: (320, 655)
  viewport.appendChild(card2);

  const modeToggleBtn = new FakeElement('button');
  modeToggleBtn.id = 'atelierModeToggleBtn';
  const modeToggleLabel = new FakeElement('span');
  modeToggleLabel.id = 'atelierModeToggleLabel';
  modeToggleBtn.appendChild(modeToggleLabel);
  canvasContainer.appendChild(modeToggleBtn);

  const modeHint = new FakeElement('p');
  modeHint.id = 'atelierModeHint';
  canvasContainer.appendChild(modeHint);

  const footer = new FakeElement('footer');
  root.appendChild(footer);

  const ind0 = new FakeElement('button');
  ind0.setAttribute('data-atelier-indicator', '0');
  footer.appendChild(ind0);

  const ind1 = new FakeElement('button');
  ind1.setAttribute('data-atelier-indicator', '1');
  footer.appendChild(ind1);

  const ind2 = new FakeElement('button');
  ind2.setAttribute('data-atelier-indicator', '2');
  footer.appendChild(ind2);

  const actionBtn = new FakeElement('button');
  actionBtn.id = 'atelierPrimaryActionBtn';
  footer.appendChild(actionBtn);

  const btnIcon = new FakeElement('div');
  btnIcon.id = 'atelierBtnIcon';
  actionBtn.appendChild(btnIcon);

  const icon0 = new FakeElement('svg');
  icon0.setAttribute('data-atelier-icon', '0');
  btnIcon.appendChild(icon0);

  const icon1 = new FakeElement('svg');
  icon1.setAttribute('data-atelier-icon', '1');
  icon1.classList.add('hidden');
  btnIcon.appendChild(icon1);

  const icon2 = new FakeElement('svg');
  icon2.setAttribute('data-atelier-icon', '2');
  icon2.classList.add('hidden');
  btnIcon.appendChild(icon2);

  const btnTitle = new FakeElement('div');
  btnTitle.id = 'atelierBtnActionTitle';
  actionBtn.appendChild(btnTitle);

  const btnSub = new FakeElement('div');
  btnSub.id = 'atelierBtnActionSub';
  actionBtn.appendChild(btnSub);

  const menuSheet = new FakeElement('div');
  menuSheet.id = 'atelierMenuSheet';
  menuSheet.classList.add('hidden');
  root.appendChild(menuSheet);

  const menuPanel = new FakeElement('div');
  menuPanel.id = 'atelierMenuPanel';
  menuSheet.appendChild(menuPanel);

  const menuNavBtns = {} as Record<AtelierNavTarget, FakeElement>;
  for (const nav of ['files', 'recents', 'tools-all', 'settings'] as const) {
    const btn = new FakeElement('button');
    btn.setAttribute('data-atelier-nav', nav);
    menuSheet.appendChild(btn);
    menuNavBtns[nav] = btn;
  }

  return {
    root,
    canvasContainer,
    viewport,
    cards: [card0, card1, card2],
    savedCountEl,
    indicators: [ind0, ind1, ind2],
    modeToggleBtn,
    modeToggleLabel,
    modeHint,
    actionBtn,
    btnTitle,
    btnSub,
    btnIcon,
    icons: [icon0, icon1, icon2],
    menuBtn,
    menuSheet,
    menuPanel,
    menuNavBtns,
  };
}

describe('Atelier Hub Controller (Unit & Interaction Tests)', () => {
  let fakeWindow: FakeWindow;
  let fakeBody: FakeElement;
  let originalWindow: unknown;
  let originalDocument: unknown;
  let fixture: HubFixture;
  let onSelectModuleMock: ReturnType<typeof vi.fn<(moduleIndex: AtelierModuleIndex) => void>>;
  let onNavigateScreenMock: ReturnType<typeof vi.fn<(target: AtelierNavTarget) => void>>;
  let isHubVisibleMock: ReturnType<typeof vi.fn<() => boolean>>;
  let controller: AtelierHubController;

  beforeEach(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    originalWindow = g.window;
    originalDocument = g.document;

    const storage = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    };

    fakeWindow = new FakeWindow();
    fakeBody = new FakeElement('body');
    const fakeHtml = new FakeElement('html');

    fixture = createFixture();

    g.window = fakeWindow;
    g.document = {
      body: fakeBody,
      documentElement: fakeHtml,
      createElement: (tag: string) => new FakeElement(tag),
      querySelector: (sel: string) => fixture.root.querySelector(sel),
      querySelectorAll: (sel: string) => fixture.root.querySelectorAll(sel),
    };

    setLanguage('en');
    onSelectModuleMock = vi.fn<(moduleIndex: AtelierModuleIndex) => void>();
    onNavigateScreenMock = vi.fn<(target: AtelierNavTarget) => void>();
    isHubVisibleMock = vi.fn<() => boolean>().mockReturnValue(true);

    controller = createAtelierHub({
      root: fixture.root as unknown as ParentNode,
      t,
      onSelectModule: onSelectModuleMock,
      onNavigateScreen: onNavigateScreenMock,
      isHubVisible: isHubVisibleMock,
    });
  });

  afterEach(() => {
    controller?.destroy();
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = originalWindow;
    g.document = originalDocument;
  });

  describe('1. Initial Free-Float State', () => {
    it('initializes with isCoverflow=false, activeIndex=0, and savedCount=0', () => {
      const state = controller.getState();
      expect(state.isCoverflow).toBe(false);
      expect(state.activeIndex).toBe(0);
      expect(state.savedCount).toBe(0);
    });

    it('applies FREE_POSITIONS 3D coordinates, opacities, and orbit classes to all 3 cards', () => {
      fixture.cards.forEach((card, idx) => {
        const pos = FREE_POSITIONS[idx];
        expect(card.classList.contains(pos.floatClass)).toBe(true);
        expect(card.classList.contains('atelier-card-dragging')).toBe(false);
        expect(card.style.transform).toBe(
          `translate3d(${pos.x}px, ${pos.y}px, ${pos.z}px) rotateY(${pos.rotY}deg) rotateX(${pos.rotX}deg) rotateZ(${pos.rotZ}deg) scale(${pos.scale})`,
        );
        expect(card.style.zIndex).toBe(String(20 - idx * 5));
        expect(card.style.opacity).toBe('0.98');
        expect(card.style.filter).toBe('drop-shadow(0 14px 26px rgba(40,30,20,0.20))');
      });
    });

    it('sets the mode label and mode hint text for free float mode', () => {
      expect(fixture.modeToggleLabel.textContent).toBe(t('atelier.modeFree'));
      expect(fixture.modeHint.textContent).toBe(t('atelier.hintFree'));
    });

    it('sets indicator dots to is-free and removes is-active in free float mode', () => {
      fixture.indicators.forEach((dot, idx) => {
        expect(dot.classList.contains('is-free')).toBe(true);
        expect(dot.classList.contains('is-active')).toBe(false);
        expect(dot.getAttribute('aria-label')).toBe(t('atelier.indicatorAria', { n: idx + 1 }));
      });
    });

    it('aliases initAtelierHub to createAtelierHub', () => {
      expect(initAtelierHub).toBe(createAtelierHub);
    });
  });

  describe('2. Nearest-Card Hit Detection & Clean Tap on Canvas', () => {
    it('focuses Card 0 when tapping near Card 0 center (170, 205)', () => {
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 165,
        clientY: 200,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 165,
        clientY: 200,
        target: fixture.canvasContainer,
      });

      const state = controller.getState();
      expect(state.isCoverflow).toBe(true);
      expect(state.activeIndex).toBe(0);
      expect(fixture.modeToggleLabel.textContent).toBe(t('atelier.modeCarousel'));
      expect(fixture.modeHint.textContent).toBe(t('atelier.hintCarousel'));
    });

    it('focuses Card 1 when tapping near Card 1 center (520, 255)', () => {
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 510,
        clientY: 250,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 510,
        clientY: 250,
        target: fixture.canvasContainer,
      });

      const state = controller.getState();
      expect(state.isCoverflow).toBe(true);
      expect(state.activeIndex).toBe(1);
    });

    it('focuses Card 2 when tapping near Card 2 center (320, 655)', () => {
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 325,
        clientY: 650,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 325,
        clientY: 650,
        target: fixture.canvasContainer,
      });

      const state = controller.getState();
      expect(state.isCoverflow).toBe(true);
      expect(state.activeIndex).toBe(2);
    });

    it('applies center stage transform to activeIndex and wing transforms to left/right cards', () => {
      controller.applyCoverflow(1);

      // Card 1 is center stage (diff = 0)
      const centerCard = fixture.cards[1];
      expect(centerCard.style.transform).toContain('scale(1.03)');
      expect(centerCard.style.zIndex).toBe('30');
      expect(centerCard.style.opacity).toBe('1');
      expect(centerCard.style.filter).toBe('drop-shadow(0 24px 44px rgba(35,25,15,0.34))');

      // Card 2 is right wing (diff = 1)
      const rightWing = fixture.cards[2];
      expect(rightWing.style.transform).toContain('rotateY(-28deg)');
      expect(rightWing.style.transform).toContain('scale(0.83)');
      expect(rightWing.style.opacity).toBe('0.82');

      // Card 0 is left wing (diff = -1)
      const leftWing = fixture.cards[0];
      expect(leftWing.style.transform).toContain('rotateY(28deg)');
      expect(leftWing.style.transform).toContain('scale(0.83)');
      expect(leftWing.style.opacity).toBe('0.82');

      // Indicator 1 is active
      expect(fixture.indicators[1].classList.contains('is-active')).toBe(true);
      expect(fixture.indicators[0].classList.contains('is-active')).toBe(false);
      expect(fixture.indicators[2].classList.contains('is-active')).toBe(false);
    });
  });

  describe('3. Bottom Dock Theme, Launch Action & In-Coverflow Taps', () => {
    it('updates bottom dock theme, text, and active icon for each module index', () => {
      for (const idx of [0, 1, 2] as const) {
        controller.applyCoverflow(idx);
        const meta = DOCK_META[idx];

        expect(fixture.btnTitle.textContent).toBe(t(meta.titleKey));
        expect(fixture.btnSub.textContent).toBe(t(meta.subKey));
        expect(fixture.actionBtn.style.backgroundColor).toBe(meta.bgHex);
        expect(fixture.actionBtn.style.borderColor).toBe(meta.borderHex);
        expect(fixture.actionBtn.style.boxShadow).toBe(meta.shadow);

        fixture.icons.forEach((icon, i) => {
          if (i === idx) {
            expect(icon.classList.contains('hidden')).toBe(false);
          } else {
            expect(icon.classList.contains('hidden')).toBe(true);
          }
        });
      }
    });

    it('calls onSelectModule with activeIndex when clicking the primary action button', () => {
      controller.applyCoverflow(2);
      fixture.actionBtn.dispatchEvent({ type: 'click' });
      expect(onSelectModuleMock).toHaveBeenCalledTimes(1);
      expect(onSelectModuleMock).toHaveBeenCalledWith(2);
    });

    it('triggers onSelectModule when tapping the center focused card in Carousel mode', () => {
      controller.applyCoverflow(1);

      // Tap Card 1 (already active)
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 520,
        clientY: 255,
        target: fixture.cards[1],
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 520,
        clientY: 255,
        target: fixture.cards[1],
      });

      expect(onSelectModuleMock).toHaveBeenCalledWith(1);
    });

    it('focuses a wing card without calling onSelectModule when tapping a non-active card in Carousel mode', () => {
      controller.applyCoverflow(0); // Card 0 active

      // Tap Card 2 (wing card)
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 320,
        clientY: 655,
        target: fixture.cards[2],
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 320,
        clientY: 655,
        target: fixture.cards[2],
      });

      expect(onSelectModuleMock).not.toHaveBeenCalled();
      expect(controller.getState().activeIndex).toBe(2);
    });

    it('returns to Free-Float mode when tapping empty background space in Carousel mode', () => {
      controller.applyCoverflow(0);
      expect(controller.getState().isCoverflow).toBe(true);

      // Tap canvas container background (not a card)
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 10,
        clientY: 10,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 10,
        clientY: 10,
        target: fixture.canvasContainer,
      });

      expect(controller.getState().isCoverflow).toBe(false);
      expect(fixture.modeToggleLabel.textContent).toBe(t('atelier.modeFree'));
    });
  });

  describe('4. Horizontal Drag & Swipe Navigation', () => {
    it('advances to next card on swipe left in Coverflow mode (deltaX < -35)', () => {
      controller.applyCoverflow(0);

      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 200,
        clientY: 200,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointermove',
        clientX: 140, // deltaX = -60
        clientY: 200,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 140,
        clientY: 200,
        target: fixture.canvasContainer,
      });

      expect(controller.getState().activeIndex).toBe(1);
    });

    it('moves to previous card on swipe right in Coverflow mode (deltaX > 35)', () => {
      controller.applyCoverflow(1);

      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 200,
        clientY: 200,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointermove',
        clientX: 260, // deltaX = +60
        clientY: 200,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 260,
        clientY: 200,
        target: fixture.canvasContainer,
      });

      expect(controller.getState().activeIndex).toBe(0);
    });

    it('snaps back to current card without advancing when drag does not exceed 35px threshold', () => {
      controller.applyCoverflow(1);

      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 200,
        clientY: 200,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointermove',
        clientX: 185, // deltaX = -15 (>10 triggers drag, but <=35 does not swipe)
        clientY: 200,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 185,
        clientY: 200,
        target: fixture.canvasContainer,
      });

      expect(controller.getState().activeIndex).toBe(1);
    });

    it('starts coverflow from nearest card when dragged horizontally while in Free Mode', () => {
      controller.applyFreeFloat();

      // Start drag near Card 2 center (320, 655)
      fixture.canvasContainer.dispatchEvent({
        type: 'pointerdown',
        clientX: 320,
        clientY: 655,
        target: fixture.canvasContainer,
      });
      fakeWindow.dispatchEvent({
        type: 'pointermove',
        clientX: 260, // deltaX = -60
        clientY: 655,
      });
      fakeWindow.dispatchEvent({
        type: 'pointerup',
        clientX: 260,
        clientY: 655,
        target: fixture.canvasContainer,
      });

      expect(controller.getState().isCoverflow).toBe(true);
      expect(controller.getState().activeIndex).toBe(2);
    });
  });

  describe('5. Keyboard, Mode Toggle Button, Indicator Dots & Wheel', () => {
    it('cycles cards with ArrowRight and ArrowLeft in Coverflow mode', () => {
      controller.applyCoverflow(0);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      expect(controller.getState().activeIndex).toBe(1);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      expect(controller.getState().activeIndex).toBe(2);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      expect(controller.getState().activeIndex).toBe(0);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
      expect(controller.getState().activeIndex).toBe(2);
    });

    it('exits Coverflow mode when Escape key is pressed', () => {
      controller.applyCoverflow(1);
      fakeWindow.dispatchEvent({ type: 'keydown', key: 'Escape' });
      expect(controller.getState().isCoverflow).toBe(false);
    });

    it('ignores keyboard navigation when isHubVisible returns false', () => {
      controller.applyCoverflow(0);
      isHubVisibleMock.mockReturnValue(false);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      expect(controller.getState().activeIndex).toBe(0);

      fakeWindow.dispatchEvent({ type: 'keydown', key: 'Escape' });
      expect(controller.getState().isCoverflow).toBe(true);
    });

    it('toggles between Free-Float and Carousel when clicking modeToggleBtn', () => {
      expect(controller.getState().isCoverflow).toBe(false);

      fixture.modeToggleBtn.dispatchEvent({
        type: 'click',
        stopPropagation: vi.fn(),
      });
      expect(controller.getState().isCoverflow).toBe(true);

      fixture.modeToggleBtn.dispatchEvent({
        type: 'click',
        stopPropagation: vi.fn(),
      });
      expect(controller.getState().isCoverflow).toBe(false);
    });

    it('switches to Coverflow on target card when clicking an indicator dot', () => {
      fixture.indicators[2].dispatchEvent({
        type: 'click',
        stopPropagation: vi.fn(),
      });

      expect(controller.getState().isCoverflow).toBe(true);
      expect(controller.getState().activeIndex).toBe(2);
    });

    it('changes card index on viewport wheel event', () => {
      controller.applyCoverflow(0);
      fixture.viewport.dispatchEvent({
        type: 'wheel',
        deltaX: 0,
        deltaY: 25,
      });

      expect(controller.getState().activeIndex).toBe(1);
    });
  });

  describe('6. Saved Count, Bilingual i18n & refreshTexts', () => {
    it('updates savedCount state and formats Card 1 count label with setSavedCount', () => {
      controller.setSavedCount(5);
      expect(controller.getState().savedCount).toBe(5);
      expect(fixture.savedCountEl.textContent).toBe(t('atelier.card2.meta', { count: 5 }));
      expect(fixture.savedCountEl.textContent).toBe('5 Fascicles Saved');

      controller.setSavedCount(-2); // clamp to 0
      expect(controller.getState().savedCount).toBe(0);
    });

    it('re-translates all dynamic texts when switching language and calling refreshTexts', () => {
      controller.setSavedCount(4);
      setLanguage('tr');
      controller.refreshTexts();

      expect(getLanguage()).toBe('tr');
      expect(fixture.modeToggleLabel.textContent).toBe('Mod: Serbest Salınım (Aktif)');
      expect(fixture.modeHint.textContent).toBe(
        'Herhangi bir noktaya dokunarak en yakın karttan karusele geçin',
      );
      expect(fixture.savedCountEl.textContent).toBe('4 Fasikül Kayıtlı');
      expect(fixture.btnTitle.textContent).toBe('Kitapçık Üretimini Başlat');
      expect(fixture.indicators[0].getAttribute('aria-label')).toBe('1. Kart');
    });

    it('verifies that all atelier i18n keys exist and are non-empty in both en and tr dictionaries', () => {
      const keys = [
        'atelier.brandSub',
        'atelier.starGithub',
        'atelier.starAria',
        'atelier.menuAria',
        'atelier.menuLabel',
        'atelier.menuTitle',
        'atelier.menuAllTools',
        'atelier.menuRecents',
        'atelier.deskTitle',
        'atelier.hintFree',
        'atelier.hintCarousel',
        'atelier.modeFree',
        'atelier.modeCarousel',
        'atelier.card1.badge',
        'atelier.card1.title',
        'atelier.card1.desc',
        'atelier.card1.module',
        'atelier.card1.meta',
        'atelier.card1.ctaTitle',
        'atelier.card1.ctaSub',
        'atelier.card2.badge',
        'atelier.card2.title',
        'atelier.card2.desc',
        'atelier.card2.module',
        'atelier.card2.meta',
        'atelier.card2.ctaTitle',
        'atelier.card2.ctaSub',
        'atelier.card3.badge',
        'atelier.card3.title',
        'atelier.card3.desc',
        'atelier.card3.module',
        'atelier.card3.meta',
        'atelier.card3.ctaTitle',
        'atelier.card3.ctaSub',
        'atelier.privacySeal',
        'atelier.indicatorAria',
      ];

      for (const lang of ['en', 'tr'] as const) {
        setLanguage(lang);
        for (const key of keys) {
          const val = t(key, { count: 1, n: 1 });
          expect(val, `Missing translation for key: ${key} in ${lang}`).toBeTruthy();
          expect(val).not.toBe(key);
        }
      }

      // Brand compliance: EN card1.title must use 'Produce Booklet' (never 'create')
      setLanguage('en');
      expect(t('atelier.card1.title')).toBe('Produce Booklet');
      expect(t('atelier.card1.title').toLowerCase()).not.toContain('create');
    });
  });

  describe('7. Lifecycle destroy', () => {
    it('cleans up event listeners and prevents further reactions', () => {
      controller.destroy();

      // Keyboard events should no longer affect controller
      fakeWindow.dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      expect(controller.getState().activeIndex).toBe(0);

      // Primary action button click should no longer invoke callback
      fixture.actionBtn.dispatchEvent({ type: 'click' });
      expect(onSelectModuleMock).not.toHaveBeenCalled();

      // Menu button click should no longer open menu
      fixture.menuBtn.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(controller.isMenuOpen()).toBe(false);
    });
  });

  describe('8. One Door Menu Sheet & Saved Count Tap-Through', () => {
    it('toggles the menu sheet open and closed via #atelierMenuBtn and updates aria-expanded', () => {
      expect(controller.isMenuOpen()).toBe(false);
      expect(fixture.menuSheet.classList.contains('hidden')).toBe(true);
      expect(fixture.menuBtn.getAttribute('aria-expanded')).toBe('false');

      fixture.menuBtn.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(controller.isMenuOpen()).toBe(true);
      expect(fixture.menuSheet.classList.contains('hidden')).toBe(false);
      expect(fixture.menuBtn.getAttribute('aria-expanded')).toBe('true');

      fixture.menuBtn.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(controller.isMenuOpen()).toBe(false);
      expect(fixture.menuSheet.classList.contains('hidden')).toBe(true);
      expect(fixture.menuBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('drops the menu panel just below the menu button, measured from the tap-catcher', () => {
      fixture.menuSheet.rect = { ...fixture.menuSheet.rect, top: 20 };
      fixture.menuBtn.rect = { ...fixture.menuBtn.rect, bottom: 92 };
      controller.openMenu();
      expect(fixture.menuPanel.style.top).toBe('80px');
    });

    it('closes the menu via an outside tap or Escape key without exiting Coverflow', () => {
      controller.applyCoverflow(1);

      // Close via a tap outside the pills (lands on the transparent tap-catcher)
      controller.openMenu();
      expect(controller.isMenuOpen()).toBe(true);
      fixture.menuSheet.dispatchEvent({ type: 'click', target: fixture.menuSheet });
      expect(controller.isMenuOpen()).toBe(false);

      // Reopen and press Escape -> closes menu first while keeping Coverflow active
      controller.openMenu();
      fakeWindow.dispatchEvent({ type: 'keydown', key: 'Escape' });
      expect(controller.isMenuOpen()).toBe(false);
      expect(controller.getState().isCoverflow).toBe(true);
    });

    it('navigates to files, recents, tools-all, and settings from menu sheet items and closes the sheet', () => {
      for (const target of ['files', 'recents', 'tools-all', 'settings'] as const) {
        controller.openMenu();
        expect(controller.isMenuOpen()).toBe(true);

        fixture.menuNavBtns[target].dispatchEvent({
          type: 'click',
          stopPropagation: vi.fn(),
        });

        expect(controller.isMenuOpen()).toBe(false);
        expect(onNavigateScreenMock).toHaveBeenLastCalledWith(target);
      }
      expect(onNavigateScreenMock).toHaveBeenCalledTimes(4);
    });

    it('navigates to recents when tapping #atelierCard1SavedCount while Card 1 is focused in Coverflow mode', () => {
      // In Free-Float mode, clicking savedCountEl does NOT navigate to recents
      fixture.savedCountEl.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(onNavigateScreenMock).not.toHaveBeenCalled();

      // In Coverflow mode with Card 0 focused, clicking savedCountEl does NOT navigate to recents
      controller.applyCoverflow(0);
      fixture.savedCountEl.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(onNavigateScreenMock).not.toHaveBeenCalled();

      // In Coverflow mode with Card 1 focused, clicking savedCountEl navigates to 'recents'
      controller.applyCoverflow(1);
      fixture.savedCountEl.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(onNavigateScreenMock).toHaveBeenCalledTimes(1);
      expect(onNavigateScreenMock).toHaveBeenCalledWith('recents');
    });
  });
});

describe('resolveAtelierBackAction', () => {
  it('closes the menu first when it is open, even over the coverflow', () => {
    expect(resolveAtelierBackAction({ menuOpen: true, isCoverflow: false })).toBe('close-menu');
    expect(resolveAtelierBackAction({ menuOpen: true, isCoverflow: true })).toBe('close-menu');
  });

  it('returns the cards to free float when the menu is closed and the coverflow is shown', () => {
    expect(resolveAtelierBackAction({ menuOpen: false, isCoverflow: true })).toBe('free-float');
  });

  it('leaves the hub alone when neither the menu nor the coverflow is shown', () => {
    expect(resolveAtelierBackAction({ menuOpen: false, isCoverflow: false })).toBe('none');
  });
});
