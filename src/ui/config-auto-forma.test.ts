import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {};
  }
});

import { setLanguage, t } from '../i18n';
import {
  formatSummaryFlipEdge,
  formatSummarySignature,
  shouldWarnSingleSignature,
} from './app';

const root = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf-8');

const indexHtml = read('index.html');
const appTs = read('src/ui/app.ts');
const stylesCss = read('src/ui/styles.css');

function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `expected to find "${marker}"`).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', at);
  expect(braceStart, `expected an opening brace after "${marker}"`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated block for "${marker}"`);
}

describe('booklet config defaults & summary/warning fixes (T-03 / T-04 / T-07)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: { lang: '' }, querySelectorAll: () => [] });
  });

  afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
  });

  it('Decision 1: defaults to auto on startup and resetPicker while keeping Library undefined->single', () => {
    const sigGroupMatch = indexHtml.match(/<div[^>]*id="signatureSizeGroup"[^>]*>([\s\S]*?)<\/div>/);
    expect(sigGroupMatch).not.toBeNull();
    const activeButtons = [...sigGroupMatch![1].matchAll(/<button[^>]*class="[^"]*\bis-active\b[^"]*"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(activeButtons).toHaveLength(1);
    expect(activeButtons[0]).toContain('data-sig="auto"');

    expect(appTs).toMatch(/\blet bookletSignature = 'auto';/);

    const resetBody = blockAfter(appTs, 'function resetPicker(): void {');
    expect(resetBody).toContain("bookletSignature = 'auto';");
    expect(resetBody).toContain("setActiveSegment(signatureSizeGroup, 'sig', 'auto');");

    const applyBody = blockAfter(appTs, 'function applyStoredBookletSettings(settings: StoredBookletSettings): void {');
    expect(applyBody).toContain("options.signatureSize === undefined ? 'single' : String(options.signatureSize)");
  });

  it('Decision 2: Step 3 summary formats auto as localized Otomatik/Auto without Pages suffix', () => {
    setLanguage('tr');
    expect(formatSummarySignature('auto')).toBe('Otomatik');
    expect(formatSummarySignature('auto')).toBe(t('config.signature.auto'));
    expect(formatSummarySignature('auto')).not.toContain('Sayfa');
    expect(formatSummarySignature('single')).toBe('Tek forma');
    expect(formatSummarySignature('16')).toBe('16 Sayfa');

    setLanguage('en');
    expect(formatSummarySignature('auto')).toBe('Auto');
    expect(formatSummarySignature('auto')).toBe(t('config.signature.auto'));
    expect(formatSummarySignature('auto')).not.toContain('Pages');
    expect(formatSummarySignature('single')).toBe('Single');
    expect(formatSummarySignature('16')).toBe('16 Pages');

    const summaryBody = blockAfter(appTs, 'function renderConfigSummarySpec(): void {');
    expect(summaryBody).toContain('summaryFormaVal.textContent = formatSummarySignature(bookletSignature);');
  });

  it('Decision 3: #formaBadge avoids stale static 4 Sayfa and updates on startup and config screen entry', () => {
    const badgeMatch = indexHtml.match(/<span[^>]*id="formaBadge"[^>]*>([^<]*)<\/span>/);
    expect(badgeMatch).not.toBeNull();
    expect(badgeMatch![1]).toBe('Otomatik');
    expect(badgeMatch![1]).not.toContain('4 Sayfa');

    const initBody = blockAfter(appTs, 'export function initApp(): void {');
    const showHubIndex = initBody.indexOf("showScreen('hub');");
    expect(showHubIndex).toBeGreaterThan(0);
    const startupTail = initBody.slice(Math.max(0, showHubIndex - 300), showHubIndex);
    expect(startupTail).toContain('updateFormaBadge();');

    const showScreenBody = blockAfter(appTs, 'function showScreen(id: ScreenId): void {');
    const configBranchAt = showScreenBody.indexOf("else if (id === 'config')");
    expect(configBranchAt).toBeGreaterThanOrEqual(0);
    const configBranch = blockAfter(showScreenBody.slice(configBranchAt), "else if (id === 'config')");
    expect(configBranch).toContain('updateFormaBadge();');
    expect(configBranch).toContain('updatePaperSelectedBadge();');
    expect(configBranch).toContain('updateConfigPreflightWarning();');
  });

  it('Decision 4: Step 3 summary uses short flip labels without recommended suffix while keeping button labels', () => {
    setLanguage('tr');
    expect(formatSummaryFlipEdge('short')).toBe('Kısa kenar');
    expect(formatSummaryFlipEdge('long')).toBe('Uzun kenar');
    expect(`${t('config.binding.ltr')} · ${formatSummaryFlipEdge('short')}`).toBe('Soldan (LTR) · Kısa kenar');
    expect(t('config.flipEdge.short')).toBe('Kısa kenar (önerilen)');
    expect(t('config.flipEdge.long')).toBe('Uzun kenar');

    setLanguage('en');
    expect(formatSummaryFlipEdge('short')).toBe('Short edge');
    expect(formatSummaryFlipEdge('long')).toBe('Long edge');
    expect(`${t('config.binding.ltr')} · ${formatSummaryFlipEdge('short')}`).toBe('Left (LTR) · Short edge');
    expect(t('config.flipEdge.short')).toBe('Short edge (recommended)');
    expect(t('config.flipEdge.long')).toBe('Long edge');

    const summaryBody = blockAfter(appTs, 'function renderConfigSummarySpec(): void {');
    expect(summaryBody).toContain('formatSummaryFlipEdge(bookletFlipEdge)');
    expect(summaryBody).not.toContain('config.flipEdge.short');
    expect(summaryBody).not.toContain('config.flipEdge.long');
  });

  it('Decision 5a: shouldWarnSingleSignature triggers only for single and >40 pages', () => {
    expect(shouldWarnSingleSignature('single', 41)).toBe(true);
    expect(shouldWarnSingleSignature('single', 120)).toBe(true);

    expect(shouldWarnSingleSignature('single', 40)).toBe(false);
    expect(shouldWarnSingleSignature('single', 0)).toBe(false);
    expect(shouldWarnSingleSignature('auto', 41)).toBe(false);
    expect(shouldWarnSingleSignature('auto', 300)).toBe(false);
    expect(shouldWarnSingleSignature('4', 100)).toBe(false);
    expect(shouldWarnSingleSignature('8', 100)).toBe(false);
    expect(shouldWarnSingleSignature('16', 100)).toBe(false);
    expect(shouldWarnSingleSignature('32', 100)).toBe(false);
  });

  it('Decision 5b: warning copy in TR + EN matches single-signature >40 condition and keeps picker warning separate', () => {
    setLanguage('tr');
    const trWarning = t('config.preflightWarning', { pages: 120 });
    expect(trWarning).toBe(
      'Bu belge 120 sayfa. Tek forma, katlanması zor kalın bir blok olur; Otomatik veya 16/32 sayfalık forma önerilir.',
    );
    expect(trWarning).not.toContain('150');
    expect(trWarning).not.toContain('50 MB');
    expect(t('picker.largeFileWarning')).toContain('150+');

    setLanguage('en');
    const enWarning = t('config.preflightWarning', { pages: 120 });
    expect(enWarning).toContain('120 pages');
    expect(enWarning).toContain('Auto');
    expect(enWarning).toContain('16/32');
    expect(enWarning).not.toContain('150');
    expect(enWarning).not.toContain('50 MB');
    expect(t('picker.largeFileWarning')).toContain('>150 pages');
  });

  it('Decision 5c: relocates #configPreflightWarning into Step 1 below signature card with monochrome SVG', () => {
    const step1Start = indexHtml.indexOf('id="configStepLayout"');
    const step2Start = indexHtml.indexOf('id="configStepPrint"');
    const footerStart = indexHtml.indexOf('id="configStickyFooter"');
    expect(step1Start).toBeGreaterThan(0);
    expect(step2Start).toBeGreaterThan(step1Start);
    expect(footerStart).toBeGreaterThan(step2Start);

    const step1Html = indexHtml.slice(step1Start, step2Start);
    const footerHtml = indexHtml.slice(footerStart);

    const calloutAt = step1Html.indexOf('id="signatureCallout"');
    const warnAt = step1Html.indexOf('id="configPreflightWarning"');
    const bindingAt = step1Html.indexOf('id="bindingGroup"');
    expect(calloutAt).toBeGreaterThan(0);
    expect(warnAt).toBeGreaterThan(calloutAt);
    expect(bindingAt).toBeGreaterThan(warnAt);
    expect(footerHtml).not.toContain('id="configPreflightWarning"');

    const warnBlockMatch = step1Html.match(/<div[^>]*id="configPreflightWarning"[^>]*>[\s\S]*?<\/div>/);
    expect(warnBlockMatch).not.toBeNull();
    const warnBlock = warnBlockMatch![0];
    expect(warnBlock).toContain('config-signature-warning');
    expect(warnBlock).toContain('hidden');
    expect(warnBlock).toContain('<svg');
    expect(warnBlock).toContain('aria-hidden="true"');
    expect(warnBlock).toContain('stroke="currentColor"');
    expect(warnBlock).not.toContain('⚠️');
    expect(warnBlock).toContain('<span id="configPreflightWarningText"></span>');
    expect(warnBlock).not.toContain('data-i18n="config.preflightWarning"');

    const pickerHtml = indexHtml.slice(indexHtml.indexOf('id="screen-picker"'), step1Start);
    expect(pickerHtml).toContain('id="preflightLargeFileWarning"');

    expect(stylesCss).toContain('#screen-config .config-signature-warning');
    expect(stylesCss).toContain('.dark-theme #screen-config .config-signature-warning');
    expect(stylesCss).not.toContain('#configStickyFooter .warning-banner');
  });

  it('Decision 5d: re-evaluates config warning on signature click, file load, reset, library apply, config open, and language change', () => {
    const warnFn = blockAfter(appTs, 'function updateConfigPreflightWarning(): void {');
    expect(warnFn).toContain('shouldWarnSingleSignature(bookletSignature, bookletOriginalPages)');
    expect(warnFn).toContain("t('config.preflightWarning', {");
    expect(warnFn).toContain("configPreflightWarning.classList.toggle('hidden', !shouldShow);");

    const resetBody = blockAfter(appTs, 'function resetPicker(): void {');
    expect(resetBody).toContain('updateConfigPreflightWarning();');

    const applyBody = blockAfter(appTs, 'function applyStoredBookletSettings(settings: StoredBookletSettings): void {');
    expect(applyBody).toContain('updateConfigPreflightWarning();');

    const loadBody = blockAfter(appTs, 'async function loadBookletFile(');
    expect(loadBody).toContain('updateConfigPreflightWarning();');
    expect(loadBody.indexOf('updateConfigPreflightWarning();')).toBeLessThan(
      loadBody.indexOf('showMixedSizeWarningIfNeeded('),
    );

    const inspectBody = blockAfter(appTs, 'async function showMixedSizeWarningIfNeeded(');
    expect(inspectBody).toContain("preflightLargeFileWarning.classList.toggle('hidden', !isLarge);");
    expect(inspectBody).toContain('updateConfigPreflightWarning();');

    const sigClickBody = blockAfter(appTs, "signatureSizeGroup.addEventListener('click',");
    expect(sigClickBody).toContain('updateConfigPreflightWarning();');

    const langBody = blockAfter(appTs, 'function applyLanguageChange(lang: Lang): void {');
    expect(langBody).toContain('updateConfigPreflightWarning();');
    expect(langBody).toContain('renderConfigSummarySpec();');
  });
});
