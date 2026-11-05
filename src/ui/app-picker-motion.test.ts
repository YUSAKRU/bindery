import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexHtmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const stylesCssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));

const indexHtml = readFileSync(indexHtmlPath, 'utf-8');
const stylesCss = readFileSync(stylesCssPath, 'utf-8');
const appTs = readFileSync(appTsPath, 'utf-8');

describe('Picker Fluid Motion & Dynamic Sizing (feat/atelier-picker)', () => {
  describe('Gate 1 & Invariant: Markup Structure & P0 Regression Fix', () => {
    it('removes static hidden class from #continueWrap to allow CSS data-state control', () => {
      // Find the element with id="continueWrap"
      const match = indexHtml.match(/<[^>]+id=["']continueWrap["'][^>]*>/);
      expect(match, 'expected to find #continueWrap in index.html').toBeTruthy();
      const continueWrapTag = match![0];

      // Invariant: must NOT contain class="hidden" or have "hidden" in class list
      expect(continueWrapTag).not.toMatch(/\bclass="[^"]*\bhidden\b/);
      expect(continueWrapTag).toMatch(/picker-slot-continue/);
    });

    it('wraps craft card and file card in .picker-slot and .picker-slot-clip', () => {
      expect(indexHtml).toContain('class="picker-slot picker-slot-featured"');
      expect(indexHtml).toContain('class="picker-slot picker-slot-file"');
      expect(indexHtml).toContain('class="picker-slot-clip"');

      // Check dropzoneCard is wrapped inside a slot clip
      const dropzoneIdx = indexHtml.indexOf('id="dropzoneCard"');
      expect(dropzoneIdx).toBeGreaterThan(0);
      const precedingClipFeatured = indexHtml.lastIndexOf('class="picker-slot-clip"', dropzoneIdx);
      expect(precedingClipFeatured).toBeGreaterThan(0);

      // Check fileCard is wrapped inside a slot clip
      const fileCardIdx = indexHtml.indexOf('id="fileCard"');
      expect(fileCardIdx).toBeGreaterThan(0);
      const precedingClipFile = indexHtml.lastIndexOf('class="picker-slot-clip"', fileCardIdx);
      expect(precedingClipFile).toBeGreaterThan(0);
    });

    it('wraps picker inline error, warnings, and continue button in .picker-slot wrappers', () => {
      expect(indexHtml).toMatch(/class=["'][^"']*picker-slot-error[^"']*["']\s+id=["']pickerInlineError["']/);
      expect(indexHtml).toMatch(/class=["'][^"']*picker-slot-warnings[^"']*["']\s+id=["']pickerWarningsWrap["']/);
      expect(indexHtml).toMatch(/class=["'][^"']*picker-slot-continue[^"']*["']\s+id=["']continueWrap["']/);
    });
  });

  describe('Gate 2: CSS Grid Slot Model & Performance Physics', () => {
    it('defines --ease-out-spring and motion duration tokens', () => {
      expect(stylesCss).toContain('--ease-out-spring: cubic-bezier(0.16, 1, 0.3, 1)');
      expect(stylesCss).toContain('--ease-out: cubic-bezier(0.2, 0, 0, 1)');
      expect(stylesCss).toContain('--motion-slot: 420ms');
      expect(stylesCss).toContain('--motion-slot-delay: 120ms');
    });

    it('pins .picker-slot-featured and .picker-slot-file to grid-area: 1 / 1 with align-self: start for in-place morph', () => {
      const stageIdx = stylesCss.indexOf('#screen-picker .picker-slot-featured,');
      expect(stageIdx).toBeGreaterThan(0);
      const stageBlock = stylesCss.slice(stageIdx, stageIdx + 200);
      expect(stageBlock).toContain('grid-area: 1 / 1');
      expect(stageBlock).toContain('align-self: start');
    });

    it('configures .picker-slot default to 0fr and clips with contain: paint', () => {
      const slotIdx = stylesCss.indexOf('#screen-picker .picker-slot {');
      expect(slotIdx).toBeGreaterThan(0);
      const slotBlock = stylesCss.slice(slotIdx, slotIdx + 300);
      expect(slotBlock).toContain('grid-template-rows: 0fr');
      expect(slotBlock).toContain('pointer-events: none');

      const clipIdx = stylesCss.indexOf('#screen-picker .picker-slot-clip {');
      expect(clipIdx).toBeGreaterThan(0);
      const clipBlock = stylesCss.slice(clipIdx, clipIdx + 300);
      expect(clipBlock).toContain('overflow: clip');
      expect(clipBlock).toContain('contain: paint');
    });

    it('enforces overflow: hidden on .file-card to prevent spine scan beam leakage', () => {
      const fileCardIdx = stylesCss.indexOf('/* File Selected State (Manuscript Card) */');
      expect(fileCardIdx).toBeGreaterThan(0);
      const fileCardBlock = stylesCss.slice(fileCardIdx, fileCardIdx + 600);
      expect(fileCardBlock).toContain('overflow: hidden');
    });

    it('enforces nowrap and ellipsis on .file-card-size for zero-CLS on 320px screens', () => {
      const sizeIdx = stylesCss.indexOf('#screen-picker .file-card-size {');
      expect(sizeIdx).toBeGreaterThan(0);
      const sizeBlock = stylesCss.slice(sizeIdx, sizeIdx + 350);
      expect(sizeBlock).toContain('white-space: nowrap');
      expect(sizeBlock).toContain('text-overflow: ellipsis');
    });

    it('guarantees zero dead-freeze delay in prefers-reduced-motion override', () => {
      const reducedMotionIdx = stylesCss.lastIndexOf('@media (prefers-reduced-motion: reduce)');
      expect(reducedMotionIdx).toBeGreaterThan(0);
      const reducedMotionBlock = stylesCss.slice(reducedMotionIdx, reducedMotionIdx + 250);
      expect(reducedMotionBlock).toContain('transition-delay: 0s !important');
      expect(reducedMotionBlock).toContain('animation-delay: 0s !important');
    });
  });

  describe('Gate 3: TypeScript Mechanics & Non-Blocking Intake Interaction', () => {
    it('implements runPickerIntake without synchronous offsetWidth reflow', () => {
      expect(appTs).toContain('function runPickerIntake(): void');
      const intakeStart = appTs.indexOf('function runPickerIntake(): void');
      const intakeBlock = appTs.slice(intakeStart, intakeStart + 500);

      expect(intakeBlock).not.toContain('offsetWidth');
      expect(intakeBlock).toContain('requestAnimationFrame');
      expect(intakeBlock).toContain("classList.add('is-intake')");
    });

    it('clears intakeTimer and removes .is-intake on resetPicker via stopPickerIntake', () => {
      const resetPickerStart = appTs.indexOf('function resetPicker(): void');
      expect(resetPickerStart).toBeGreaterThan(0);
      const resetPickerBlock = appTs.slice(resetPickerStart, resetPickerStart + 250);

      expect(resetPickerBlock).toContain('stopPickerIntake()');

      const stopIntakeStart = appTs.indexOf('function stopPickerIntake(): void');
      expect(stopIntakeStart).toBeGreaterThan(0);
      const stopIntakeBlock = appTs.slice(stopIntakeStart, stopIntakeStart + 250);
      expect(stopIntakeBlock).toContain('clearTimeout(intakeTimer)');
      expect(stopIntakeBlock).toContain("classList.remove('is-intake')");
    });

    it('triggers runPickerIntake on pickFileBtn and dropzoneCard drop', () => {
      const pickBtnIdx = appTs.indexOf("pickFileBtn.addEventListener('click'");
      expect(pickBtnIdx).toBeGreaterThan(0);
      const pickBtnBlock = appTs.slice(pickBtnIdx, pickBtnIdx + 400);
      expect(pickBtnBlock).toContain('runPickerIntake()');

      const dropIdx = appTs.indexOf("dropzoneCard.addEventListener('drop'");
      expect(dropIdx).toBeGreaterThan(0);
      const dropBlock = appTs.slice(dropIdx, dropIdx + 400);
      expect(dropBlock).toContain('runPickerIntake()');
    });

    it('maintains setPickerState dataset.state contract', () => {
      const setPickerStateIdx = appTs.indexOf('function setPickerState(');
      expect(setPickerStateIdx).toBeGreaterThan(0);
      const setPickerStateBlock = appTs.slice(setPickerStateIdx, setPickerStateIdx + 400);
      expect(setPickerStateBlock).toContain('screenPicker.dataset.state = state');
    });

    it('uses i18n plural key common.pageWordPlural instead of naive english "+s" concatenation', () => {
      expect(appTs).toContain("pageCount === 1 ? t('common.pageWord') : t('common.pageWordPlural')");
      expect(appTs).not.toContain("`${t('common.pageWord')}s`");
      expect(appTs).not.toContain("t('common.pageWord') + 's'");

      const i18nTsPath = fileURLToPath(new URL('../i18n/index.ts', import.meta.url));
      const i18nTs = readFileSync(i18nTsPath, 'utf-8');

      // English contract: Page / Pages
      expect(i18nTs).toContain("'common.pageWord': 'Page'");
      expect(i18nTs).toContain("'common.pageWordPlural': 'Pages'");

      // Turkish contract: Sayfa / Sayfa (no plural suffix after numeral)
      expect(i18nTs).toContain("'common.pageWord': 'Sayfa'");
      expect(i18nTs).toContain("'common.pageWordPlural': 'Sayfa'");
    });
  });
});
