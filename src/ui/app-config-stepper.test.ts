import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Config Stepper 3-Step Navigation & Invariants (feat/config-stepper-redesign)', () => {
  const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
  const stylesCss = readFileSync(resolve(__dirname, 'styles.css'), 'utf-8');
  const appTs = readFileSync(resolve(__dirname, 'app.ts'), 'utf-8');

  describe('Gate 1 & Invariant: Stepper Markup & ARIA Tablist Specifications', () => {
    it('defines role="tablist" on .config-stepper with 3 tabs and i18n label', () => {
      expect(indexHtml).toContain('class="config-stepper" role="tablist"');
      expect(indexHtml).toContain('id="configTab-layout"');
      expect(indexHtml).toContain('id="configTab-cover"');
      expect(indexHtml).toContain('id="configTab-print"');
      expect(indexHtml).toContain('data-tab="layout"');
      expect(indexHtml).toContain('data-tab="cover"');
      expect(indexHtml).toContain('data-tab="print"');
    });

    it('sets correct initial ARIA states: layout tab active, cover & print inactive', () => {
      const layoutTabMatch = indexHtml.match(/<button[^>]*id="configTab-layout"[^>]*>/);
      expect(layoutTabMatch).not.toBeNull();
      expect(layoutTabMatch![0]).toContain('aria-selected="true"');
      expect(layoutTabMatch![0]).toContain('tabindex="0"');
      expect(layoutTabMatch![0]).toContain('is-active');

      const coverTabMatch = indexHtml.match(/<button[^>]*id="configTab-cover"[^>]*>/);
      expect(coverTabMatch).not.toBeNull();
      expect(coverTabMatch![0]).toContain('aria-selected="false"');
      expect(coverTabMatch![0]).toContain('tabindex="-1"');
      expect(coverTabMatch![0]).not.toContain('is-active');

      const printTabMatch = indexHtml.match(/<button[^>]*id="configTab-print"[^>]*>/);
      expect(printTabMatch).not.toBeNull();
      expect(printTabMatch![0]).toContain('aria-selected="false"');
      expect(printTabMatch![0]).toContain('tabindex="-1"');
      expect(printTabMatch![0]).not.toContain('is-active');
    });

    it('wires each tab to its corresponding tabpanel via aria-controls and aria-labelledby', () => {
      expect(indexHtml).toContain('id="configStepLayout" role="tabpanel" aria-labelledby="configTab-layout"');
      expect(indexHtml).toContain('id="configStepCover" role="tabpanel" aria-labelledby="configTab-cover"');
      expect(indexHtml).toContain('id="configStepPrint" role="tabpanel" aria-labelledby="configTab-print"');

      // Panels 2 and 3 start hidden, Panel 1 is visible
      const layoutPanel = indexHtml.match(/<div[^>]*id="configStepLayout"[^>]*>/);
      expect(layoutPanel![0]).not.toContain('hidden');

      const coverPanel = indexHtml.match(/<div[^>]*id="configStepCover"[^>]*>/);
      expect(coverPanel![0]).toContain('hidden');

      const printPanel = indexHtml.match(/<div[^>]*id="configStepPrint"[^>]*>/);
      expect(printPanel![0]).toContain('hidden');
    });

    it('maintains compatibility slice for booklet-flow.test.ts', () => {
      const configScreen = indexHtml.slice(
        indexHtml.indexOf('id="screen-config"'),
        indexHtml.indexOf('id="advancedPanel"'),
      );
      expect(configScreen).toContain('id="wrapCoverToggleGroup"');
      expect(configScreen).toContain('id="wrapCoverOptions"');
    });
  });

  describe('Gate 2: Zero-Scroll CSS Tokens & Spring Physics', () => {
    it('defines --ease-out-spring and --hub-motion-duration tokens', () => {
      expect(stylesCss).toContain('--ease-out-spring: cubic-bezier(0.16, 1, 0.3, 1)');
      expect(stylesCss).toContain('--hub-motion-duration: 220ms');
    });

    it('enforces zero-scroll on #screen-config and overflow-y: auto on .config-step-panel', () => {
      const screenConfigIdx = stylesCss.indexOf('#screen-config {');
      expect(screenConfigIdx).toBeGreaterThan(0);
      const screenConfigBlock = stylesCss.slice(screenConfigIdx, screenConfigIdx + 280);
      expect(screenConfigBlock).toContain('overflow: hidden');
      expect(screenConfigBlock).toContain('height: 100%');

      const panelIdx = stylesCss.indexOf('.config-step-panel {');
      expect(panelIdx).toBeGreaterThan(0);
      const panelBlock = stylesCss.slice(panelIdx, panelIdx + 320);
      expect(panelBlock).toContain('overflow-y: auto');
      expect(panelBlock).toContain('overscroll-behavior: contain');
    });

    it('pins #configStickyFooter with flex-shrink: 0 and stable border', () => {
      const footerIdx = stylesCss.indexOf('#configStickyFooter {');
      expect(footerIdx).toBeGreaterThan(0);
      const footerBlock = stylesCss.slice(footerIdx, footerIdx + 300);
      expect(footerBlock).toContain('flex-shrink: 0');
      expect(footerBlock).toContain('border-top: 1px solid var(--hub-border)');
    });
  });

  describe('Gate 3: TypeScript Wiring, Keyboard Navigation & Validation Jump', () => {
    it('implements switchConfigTab with tab ARIA update and panel hidden toggle', () => {
      expect(appTs).toContain("function switchConfigTab(tab: 'layout' | 'cover' | 'print'): void");
      const fnStart = appTs.indexOf("function switchConfigTab(tab: 'layout' | 'cover' | 'print'): void");
      const fnBlock = appTs.slice(fnStart, fnStart + 1200);

      expect(fnBlock).toContain("tabEl.classList.toggle('is-active', isActive)");
      expect(fnBlock).toContain("tabEl.setAttribute('aria-selected', String(isActive))");
      expect(fnBlock).toContain("tabEl.setAttribute('tabindex', isActive ? '0' : '-1')");
      expect(fnBlock).toContain("item.panel.classList.toggle('hidden', !isActive)");
    });

    it('supports roving tabindex keyboard navigation across tabs', () => {
      expect(appTs).toContain("e.key === 'ArrowRight' || e.key === 'ArrowDown'");
      expect(appTs).toContain("e.key === 'ArrowLeft' || e.key === 'ArrowUp'");
      expect(appTs).toContain("e.key === 'Home'");
      expect(appTs).toContain("e.key === 'End'");
    });

    it('auto-switches to Step 3 on generateBtn click when insertBlankInput fails validation', () => {
      const genStart = appTs.indexOf("generateBtn.addEventListener('click'");
      expect(genStart).toBeGreaterThan(0);
      const genBlock = appTs.slice(genStart, genStart + 1000);

      expect(genBlock).toContain("switchConfigTab('print')");
      expect(genBlock).toContain("insertBlankError.classList.remove('hidden')");
      expect(genBlock).toContain("insertBlankInput.setAttribute('aria-invalid', 'true')");
      expect(genBlock).toContain('insertBlankInput.focus()');
    });

    it('resets to layout tab on resetPicker and applyStoredBookletSettings', () => {
      const resetPickerStart = appTs.indexOf('function resetPicker(): void');
      expect(resetPickerStart).toBeGreaterThan(0);
      const resetBlock = appTs.slice(resetPickerStart, resetPickerStart + 2500);
      expect(resetBlock).toContain("switchConfigTab('layout')");

      const applyStart = appTs.indexOf('function applyStoredBookletSettings(');
      expect(applyStart).toBeGreaterThan(0);
      const applyBlock = appTs.slice(applyStart, applyStart + 2500);
      expect(applyBlock).toContain("switchConfigTab('layout')");
    });
  });
});
