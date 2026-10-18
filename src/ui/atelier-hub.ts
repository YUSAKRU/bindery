export type AtelierModuleIndex = 0 | 1 | 2;
export type AtelierNavTarget = 'files' | 'recents' | 'tools-all' | 'settings';

export interface AtelierHubDeps {
  root?: ParentNode;
  t: (key: string, params?: Record<string, string | number>) => string;
  onSelectModule: (moduleIndex: AtelierModuleIndex) => void;
  onNavigateScreen?: (target: AtelierNavTarget) => void;
  isHubVisible?: () => boolean;
}

export interface AtelierHubController {
  refreshTexts: () => void;
  setSavedCount: (count: number) => void;
  applyFreeFloat: () => void;
  applyCoverflow: (targetIdx: number, dragOffsetX?: number) => void;
  openMenu: () => void;
  closeMenu: () => void;
  isMenuOpen: () => boolean;
  getState: () => { isCoverflow: boolean; activeIndex: AtelierModuleIndex; savedCount: number };
  destroy: () => void;
}

export interface AtelierCardPosition {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  rotY: number;
  rotX: number;
  scale: number;
  floatClass: string;
}

export const FREE_POSITIONS: readonly [AtelierCardPosition, AtelierCardPosition, AtelierCardPosition] = [
  { x: -84, y: -62, z: 60, rotZ: -8, rotY: 5, rotX: 2, scale: 0.65, floatClass: 'atelier-card-float-1' },
  { x: 86, y: -36, z: 5, rotZ: 7, rotY: -5, rotX: 2, scale: 0.65, floatClass: 'atelier-card-float-2' },
  { x: -4, y: 94, z: -50, rotZ: -2.5, rotY: 3, rotX: 2, scale: 0.65, floatClass: 'atelier-card-float-3' },
] as const;

export interface AtelierDockMeta {
  titleKey: string;
  subKey: string;
  bgHex: string;
  borderHex: string;
  shadow: string;
}

export const DOCK_META: readonly [AtelierDockMeta, AtelierDockMeta, AtelierDockMeta] = [
  {
    titleKey: 'atelier.card1.ctaTitle',
    subKey: 'atelier.card1.ctaSub',
    bgHex: '#9a401d',
    borderHex: 'rgba(186, 88, 50, 0.6)',
    shadow: '0 8px 20px -4px rgba(154, 64, 29, 0.42)',
  },
  {
    titleKey: 'atelier.card2.ctaTitle',
    subKey: 'atelier.card2.ctaSub',
    bgHex: '#6b502d',
    borderHex: 'rgba(148, 118, 78, 0.55)',
    shadow: '0 8px 20px -4px rgba(107, 80, 45, 0.38)',
  },
  {
    titleKey: 'atelier.card3.ctaTitle',
    subKey: 'atelier.card3.ctaSub',
    bgHex: '#212429',
    borderHex: 'rgba(200, 157, 83, 0.4)',
    shadow: '0 8px 20px -4px rgba(20, 23, 28, 0.45)',
  },
] as const;

export type AtelierBackAction = 'close-menu' | 'free-float' | 'none';

// What the Android back button should do on the hub: step back out of the
// menu, then out of the coverflow, before the app is allowed to exit. Mirrors
// the Escape handling in onKeyDown.
export function resolveAtelierBackAction(state: {
  menuOpen: boolean;
  isCoverflow: boolean;
}): AtelierBackAction {
  if (state.menuOpen) return 'close-menu';
  if (state.isCoverflow) return 'free-float';
  return 'none';
}

function spawnTapRipple(clientX: number, clientY: number): void {
  if (typeof document === 'undefined' || !document.body) return;
  const ripple = document.createElement('div');
  ripple.className = 'tap-ripple';
  ripple.style.left = `${clientX}px`;
  ripple.style.top = `${clientY}px`;
  document.body.appendChild(ripple);
  setTimeout(() => {
    if (ripple.parentNode) {
      ripple.remove();
    }
  }, 600);
}

export function createAtelierHub(deps: AtelierHubDeps): AtelierHubController {
  const doc = deps.root ?? document;

  const canvasContainer = doc.querySelector<HTMLElement>('#atelierCanvasContainer');
  const viewport = doc.querySelector<HTMLElement>('#atelierViewport3D');
  const card0 =
    doc.querySelector<HTMLElement>('#atelierCard0') ??
    doc.querySelector<HTMLElement>('[data-atelier-index="0"]');
  const card1 =
    doc.querySelector<HTMLElement>('#atelierCard1') ??
    doc.querySelector<HTMLElement>('[data-atelier-index="1"]');
  const card2 =
    doc.querySelector<HTMLElement>('#atelierCard2') ??
    doc.querySelector<HTMLElement>('[data-atelier-index="2"]');
  const cards: [HTMLElement | null, HTMLElement | null, HTMLElement | null] = [card0, card1, card2];

  const savedCountEl = doc.querySelector<HTMLElement>('#atelierCard1SavedCount');

  const ind0 = doc.querySelector<HTMLElement>('[data-atelier-indicator="0"]');
  const ind1 = doc.querySelector<HTMLElement>('[data-atelier-indicator="1"]');
  const ind2 = doc.querySelector<HTMLElement>('[data-atelier-indicator="2"]');
  const indicators: (HTMLElement | null)[] = [
    ind0 ?? doc.querySelectorAll<HTMLElement>('[data-atelier-indicator]')[0] ?? null,
    ind1 ?? doc.querySelectorAll<HTMLElement>('[data-atelier-indicator]')[1] ?? null,
    ind2 ?? doc.querySelectorAll<HTMLElement>('[data-atelier-indicator]')[2] ?? null,
  ];

  const modeHint = doc.querySelector<HTMLElement>('#atelierModeHint');
  const actionBtn = doc.querySelector<HTMLElement>('#atelierPrimaryActionBtn');
  const btnTitle = doc.querySelector<HTMLElement>('#atelierBtnActionTitle');
  const btnSub = doc.querySelector<HTMLElement>('#atelierBtnActionSub');
  const btnIcon = doc.querySelector<HTMLElement>('#atelierBtnIcon');

  const menuBtn = doc.querySelector<HTMLElement>('#atelierMenuBtn');
  const menuSheet = doc.querySelector<HTMLElement>('#atelierMenuSheet');
  const menuPanel = doc.querySelector<HTMLElement>('#atelierMenuPanel');
  const menuNavButtons = Array.from(doc.querySelectorAll<HTMLElement>('[data-atelier-nav]'));

  let isCoverflow = false;
  let activeIndex: AtelierModuleIndex = 0;
  let savedCount = 0;

  function isMenuOpen(): boolean {
    return Boolean(menuSheet && !menuSheet.classList.contains('hidden'));
  }

  // The pills drop from just under the menu button, wherever the safe-area
  // inset and header padding put it; CSS carries a fallback for when the
  // layout cannot be measured.
  function anchorMenuUnderButton(): void {
    if (!menuSheet || !menuPanel || !menuBtn) return;
    const gap = 8;
    const top = menuBtn.getBoundingClientRect().bottom - menuSheet.getBoundingClientRect().top;
    menuPanel.style.top = `${Math.round(top + gap)}px`;
  }

  function openMenu(): void {
    if (!menuSheet) return;
    menuSheet.classList.remove('hidden');
    anchorMenuUnderButton();
    menuBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeMenu(): void {
    if (!menuSheet) return;
    menuSheet.classList.add('hidden');
    menuBtn?.setAttribute('aria-expanded', 'false');
  }

  function findNearestCardIndex(clientX: number, clientY: number): AtelierModuleIndex {
    let nearestIdx: AtelierModuleIndex = 0;
    let minDistance = Infinity;

    cards.forEach((card, idx) => {
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - centerX, clientY - centerY);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = idx as AtelierModuleIndex;
      }
    });

    return nearestIdx;
  }

  function updateBottomDock(): void {
    const meta = DOCK_META[activeIndex];
    if (btnTitle) btnTitle.textContent = deps.t(meta.titleKey);
    if (btnSub) btnSub.textContent = deps.t(meta.subKey);
    if (actionBtn) {
      actionBtn.style.backgroundColor = meta.bgHex;
      actionBtn.style.borderColor = meta.borderHex;
      actionBtn.style.boxShadow = meta.shadow;
    }
    const icons = btnIcon
      ? btnIcon.querySelectorAll<HTMLElement>('[data-atelier-icon]')
      : doc.querySelectorAll<HTMLElement>('#atelierBtnIcon [data-atelier-icon]');
    icons.forEach((icon) => {
      const rawIdx = icon.getAttribute('data-atelier-icon');
      if (rawIdx === String(activeIndex)) {
        icon.classList.remove('hidden');
      } else {
        icon.classList.add('hidden');
      }
    });
  }

  function updateIndicators(): void {
    indicators.forEach((dot, idx) => {
      if (!dot) return;
      dot.setAttribute('aria-label', deps.t('atelier.indicatorAria', { n: idx + 1 }));
      if (!isCoverflow) {
        dot.classList.add('is-free');
        dot.classList.remove('is-active');
      } else if (idx === activeIndex) {
        dot.classList.add('is-active');
        dot.classList.remove('is-free');
      } else {
        dot.classList.remove('is-active', 'is-free');
      }
    });
  }

  function applyFreeFloat(): void {
    isCoverflow = false;
    if (modeHint) modeHint.textContent = deps.t('atelier.hintFree');

    cards.forEach((card, idx) => {
      if (!card) return;
      card.classList.remove('atelier-card-dragging');
      card.classList.remove('atelier-card-float-1', 'atelier-card-float-2', 'atelier-card-float-3');
      const pos = FREE_POSITIONS[idx];
      card.style.transform = `translate3d(${pos.x}px, ${pos.y}px, ${pos.z}px) rotateY(${pos.rotY}deg) rotateX(${pos.rotX}deg) rotateZ(${pos.rotZ}deg) scale(${pos.scale})`;
      card.style.zIndex = String(20 - idx * 5);
      card.style.opacity = '0.98';
      card.style.filter = 'drop-shadow(0 14px 26px rgba(40,30,20,0.20))';
      card.classList.add(pos.floatClass);
    });

    updateBottomDock();
    updateIndicators();
  }

  function applyCoverflow(targetIdx: number, dragOffsetX = 0): void {
    isCoverflow = true;
    activeIndex = (((targetIdx % 3) + 3) % 3) as AtelierModuleIndex;
    if (modeHint) modeHint.textContent = deps.t('atelier.hintCarousel');

    const normalizedDrag = Math.max(-140, Math.min(140, dragOffsetX));

    cards.forEach((card, idx) => {
      if (!card) return;
      card.classList.remove('atelier-card-float-1', 'atelier-card-float-2', 'atelier-card-float-3');

      let diff = (idx - activeIndex + 3) % 3;
      if (diff === 2) diff = -1;

      if (diff === 0) {
        const shiftX = normalizedDrag * 0.55;
        const tiltY = normalizedDrag * 0.08;
        const tiltZ = normalizedDrag * 0.02;
        const scaleVal = 1.03 - Math.min(0.06, Math.abs(normalizedDrag) * 0.0004);
        card.style.transform = `translate3d(${shiftX}px, -4px, 95px) rotateY(${tiltY}deg) rotateX(0deg) rotateZ(${tiltZ}deg) scale(${scaleVal})`;
        card.style.zIndex = '30';
        card.style.opacity = '1';
        card.style.filter = 'drop-shadow(0 24px 44px rgba(35,25,15,0.34))';
      } else if (diff === 1) {
        const shiftX = 116 + normalizedDrag * 0.35;
        const rotY = -28 + normalizedDrag * 0.06;
        card.style.transform = `translate3d(${shiftX}px, 8px, -45px) rotateY(${rotY}deg) rotateX(0deg) rotateZ(2deg) scale(0.83)`;
        card.style.zIndex = normalizedDrag < 0 ? '18' : '15';
        card.style.opacity = '0.82';
        card.style.filter = 'drop-shadow(0 10px 20px rgba(35,25,15,0.16))';
      } else {
        const shiftX = -116 + normalizedDrag * 0.35;
        const rotY = 28 + normalizedDrag * 0.06;
        card.style.transform = `translate3d(${shiftX}px, 8px, -45px) rotateY(${rotY}deg) rotateX(0deg) rotateZ(-2deg) scale(0.83)`;
        card.style.zIndex = normalizedDrag > 0 ? '18' : '15';
        card.style.opacity = '0.82';
        card.style.filter = 'drop-shadow(0 10px 20px rgba(35,25,15,0.16))';
      }
    });

    updateBottomDock();
    updateIndicators();
  }

  function setSavedCount(count: number): void {
    savedCount = Math.max(0, Math.floor(count));
    if (savedCountEl) {
      savedCountEl.textContent = deps.t('atelier.card2.meta', { count: savedCount });
    }
  }

  function refreshTexts(): void {
    if (modeHint) {
      modeHint.textContent = deps.t(isCoverflow ? 'atelier.hintCarousel' : 'atelier.hintFree');
    }
    updateBottomDock();
    updateIndicators();
    if (savedCountEl) {
      savedCountEl.textContent = deps.t('atelier.card2.meta', { count: savedCount });
    }
  }

  // Pointer drag & click handling
  let pointerDown = false;
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let deltaY = 0;
  let hasDragged = false;

  const onPointerDown = (e: PointerEvent): void => {
    const targetEl = e.target as HTMLElement | null;
    if (isCoverflow && activeIndex === 1 && targetEl?.closest('#atelierCard1SavedCount')) return;
    pointerDown = true;
    hasDragged = false;
    startX = e.clientX;
    startY = e.clientY;
    deltaX = 0;
    deltaY = 0;
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointerDown) return;
    deltaX = e.clientX - startX;
    deltaY = e.clientY - startY;

    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
      hasDragged = true;
      if (isCoverflow) {
        cards.forEach((c) => c?.classList.add('atelier-card-dragging'));
        applyCoverflow(activeIndex, deltaX);
      }
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!pointerDown) return;
    pointerDown = false;
    cards.forEach((c) => c?.classList.remove('atelier-card-dragging'));

    if ((e.target as HTMLElement | null)?.closest('#atelierPrimaryActionBtn, [data-atelier-indicator]')) {
      return;
    }

    // Case 1: Dragged horizontally beyond threshold
    if (hasDragged && Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (!isCoverflow) {
        const startIdx = findNearestCardIndex(startX, startY);
        applyCoverflow(startIdx);
      } else {
        if (deltaX < 0) {
          applyCoverflow(activeIndex + 1);
        } else {
          applyCoverflow(activeIndex - 1);
        }
      }
      return;
    }

    // Slight drag in coverflow that didn't cross threshold -> snap back
    if (hasDragged) {
      if (isCoverflow) {
        applyCoverflow(activeIndex, 0);
      }
      return;
    }

    // Case 2: Clean click / tap
    if (!isCoverflow) {
      spawnTapRipple(e.clientX, e.clientY);
      const nearestIdx = findNearestCardIndex(e.clientX, e.clientY);
      applyCoverflow(nearestIdx);
    } else {
      const clickedCard = (e.target as HTMLElement | null)?.closest('[data-atelier-index]');
      if (clickedCard) {
        const rawIdx = (clickedCard as HTMLElement).getAttribute('data-atelier-index');
        const clickedIdx =
          rawIdx !== null && rawIdx !== undefined ? (Number(rawIdx) as AtelierModuleIndex) : null;
        if (clickedIdx === activeIndex) {
          deps.onSelectModule(activeIndex);
        } else if (
          clickedIdx !== null &&
          (clickedIdx === 0 || clickedIdx === 1 || clickedIdx === 2)
        ) {
          applyCoverflow(clickedIdx);
        }
      } else {
        spawnTapRipple(e.clientX, e.clientY);
        applyFreeFloat();
      }
    }
  };

  const onPointerCancel = (): void => {
    pointerDown = false;
    cards.forEach((c) => c?.classList.remove('atelier-card-dragging'));
    if (hasDragged && isCoverflow) {
      applyCoverflow(activeIndex, 0);
    }
  };

  const onActionBtnClick = (): void => {
    deps.onSelectModule(activeIndex);
  };

  const onSavedCountClick = (e: MouseEvent): void => {
    if (!isCoverflow || activeIndex !== 1) return;
    e.stopPropagation();
    deps.onNavigateScreen?.('recents');
  };

  const onMenuBtnClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (isMenuOpen()) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  const onMenuBackdropClick = (e: MouseEvent): void => {
    if (e.target === menuSheet) {
      closeMenu();
    }
  };

  const menuNavCleanups: Array<() => void> = [];
  menuNavButtons.forEach((btn) => {
    const handler = (e: MouseEvent): void => {
      e.stopPropagation();
      const target = btn.getAttribute('data-atelier-nav') as AtelierNavTarget | null;
      closeMenu();
      if (
        target === 'files' ||
        target === 'recents' ||
        target === 'tools-all' ||
        target === 'settings'
      ) {
        deps.onNavigateScreen?.(target);
      }
    };
    btn.addEventListener('click', handler);
    menuNavCleanups.push(() => btn.removeEventListener('click', handler));
  });

  const indicatorCleanups: Array<() => void> = [];
  indicators.forEach((dot, idx) => {
    if (!dot) return;
    const clickHandler = (e: MouseEvent): void => {
      e.stopPropagation();
      applyCoverflow(idx as AtelierModuleIndex);
    };
    dot.addEventListener('click', clickHandler);
    indicatorCleanups.push(() => dot.removeEventListener('click', clickHandler));
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isMenuOpen()) {
      closeMenu();
      return;
    }
    if (deps.isHubVisible && !deps.isHubVisible()) return;
    if (e.key === 'ArrowRight') {
      applyCoverflow(isCoverflow ? activeIndex + 1 : activeIndex);
    } else if (e.key === 'ArrowLeft') {
      applyCoverflow(isCoverflow ? activeIndex - 1 : activeIndex);
    } else if (e.key === 'Escape' && isCoverflow) {
      applyFreeFloat();
    }
  };

  let wheelLocked = false;
  let wheelTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const onWheel = (e: WheelEvent): void => {
    if (!isCoverflow || wheelLocked) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) > 18) {
      wheelLocked = true;
      applyCoverflow(delta > 0 ? activeIndex + 1 : activeIndex - 1);
      if (wheelTimeoutId) clearTimeout(wheelTimeoutId);
      wheelTimeoutId = setTimeout(() => {
        wheelLocked = false;
        wheelTimeoutId = null;
      }, 420);
    }
  };

  canvasContainer?.addEventListener('pointerdown', onPointerDown);
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  }
  viewport?.addEventListener('wheel', onWheel, { passive: true });
  actionBtn?.addEventListener('click', onActionBtnClick);
  savedCountEl?.addEventListener('click', onSavedCountClick);
  menuBtn?.addEventListener('click', onMenuBtnClick);
  menuSheet?.addEventListener('click', onMenuBackdropClick);

  function destroy(): void {
    canvasContainer?.removeEventListener('pointerdown', onPointerDown);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
    }
    viewport?.removeEventListener('wheel', onWheel);
    if (wheelTimeoutId) {
      clearTimeout(wheelTimeoutId);
      wheelTimeoutId = null;
    }
    actionBtn?.removeEventListener('click', onActionBtnClick);
    savedCountEl?.removeEventListener('click', onSavedCountClick);
    menuBtn?.removeEventListener('click', onMenuBtnClick);
    menuSheet?.removeEventListener('click', onMenuBackdropClick);
    menuNavCleanups.forEach((cleanup) => cleanup());
    indicatorCleanups.forEach((cleanup) => cleanup());
  }

  // Initial setup: check optional ?mode=carousel&active=N or default to free-float
  let initialModeCarousel = false;
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('mode') === 'carousel') {
        const initialIdx = parseInt(params.get('active') || '0', 10) || 0;
        applyCoverflow(initialIdx);
        initialModeCarousel = true;
      }
    }
  } catch {
    // ignore
  }

  if (!initialModeCarousel) {
    applyFreeFloat();
  }

  if (savedCountEl) {
    savedCountEl.textContent = deps.t('atelier.card2.meta', { count: savedCount });
  }

  return {
    refreshTexts,
    setSavedCount,
    applyFreeFloat,
    applyCoverflow,
    openMenu,
    closeMenu,
    isMenuOpen,
    getState: () => ({ isCoverflow, activeIndex, savedCount }),
    destroy,
  };
}

export const initAtelierHub = createAtelierHub;
