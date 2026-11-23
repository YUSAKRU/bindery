import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf-8');

function extractPdfSourceModalHtml(): string {
  const start = htmlSource.indexOf('id="pdfSourceModal"');
  expect(start, 'expected #pdfSourceModal in index.html').toBeGreaterThan(-1);
  const tagStart = htmlSource.lastIndexOf('<div', start);
  const nextModal = htmlSource.indexOf('id="binderyFilePickerModal"', start);
  expect(nextModal, 'expected #binderyFilePickerModal after #pdfSourceModal').toBeGreaterThan(start);
  return htmlSource.slice(tagStart, nextModal);
}

function extractPdfSourceCssSection(): string {
  const startMarker = '/* Atelier PDF Source Modal (#pdfSourceModal) */';
  const endMarker = '/* End Atelier PDF Source Modal */';
  const start = cssSource.indexOf(startMarker);
  const end = cssSource.indexOf(endMarker);
  expect(start, 'expected scoped #pdfSourceModal Atelier CSS section').toBeGreaterThan(-1);
  expect(end, 'expected end marker for #pdfSourceModal Atelier CSS section').toBeGreaterThan(start);
  return cssSource.slice(start, end);
}

describe('#pdfSourceModal Atelier restyling (T-01)', () => {
  const modalHtml = extractPdfSourceModalHtml();
  const modalCss = extractPdfSourceCssSection();

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
  });

  afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
  });

  it('removes emojis and pre-selected primary button styling from modal markup', () => {
    expect(modalHtml).not.toContain('📱');
    expect(modalHtml).not.toContain('📂');
    expect(modalHtml).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(modalHtml).not.toContain('modal-source-btn--primary');

    const deviceBtnTag = modalHtml.match(/<button[^>]*id="pdfSourceDeviceBtn"[^>]*>/)?.[0];
    const binderyBtnTag = modalHtml.match(/<button[^>]*id="pdfSourceBinderyBtn"[^>]*>/)?.[0];
    expect(deviceBtnTag).toContain('class="modal-source-btn"');
    expect(binderyBtnTag).toContain('class="modal-source-btn"');
  });

  it('uses monochrome inline SVGs and preserves required ids and data-i18n attributes', () => {
    for (const id of [
      'pdfSourceModal',
      'pdfSourceModalTitle',
      'pdfSourceDeviceBtn',
      'pdfSourceBinderyBtn',
      'pdfSourceCancelBtn',
    ]) {
      expect(modalHtml, `missing id="${id}"`).toContain(`id="${id}"`);
    }

    for (const key of [
      'modal.pdfSource.title',
      'modal.pdfSource.device',
      'modal.pdfSource.deviceDesc',
      'modal.pdfSource.bindery',
      'modal.pdfSource.binderyDesc',
      'common.cancel',
    ]) {
      expect(modalHtml, `missing data-i18n="${key}"`).toContain(`data-i18n="${key}"`);
    }

    const iconSvgs = Array.from(
      modalHtml.matchAll(/<span class="file-item-icon" aria-hidden="true">\s*(<svg[\s\S]*?<\/svg>)/g),
      (m) => m[1],
    );
    expect(iconSvgs).toHaveLength(2);
    for (const svg of iconSvgs) {
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it('scopes Atelier tokens and warm cream/terracotta styles strictly to #pdfSourceModal without indigo', () => {
    const tokenScopeCount = cssSource.match(/#pdfSourceModal,/g)?.length ?? 0;
    expect(tokenScopeCount, 'light, prefers-color-scheme dark, and .dark-theme blocks').toBe(3);

    expect(modalCss).toContain('--atelier-bg');
    expect(modalCss).toContain('--atelier-surface-cream');
    expect(modalCss).toContain('--atelier-paper-edge');
    expect(modalCss).toContain('--atelier-ink-black');
    expect(modalCss).toContain('--atelier-ink-muted');
    expect(modalCss).toContain('--atelier-primary');
    expect(modalCss).toContain("'EB Garamond'");

    expect(modalCss).not.toContain('--color-primary');
    expect(modalCss).not.toMatch(/#4f46e5|#ede9fe|#a5b4fc|#3730a3/i);

    expect(modalCss).toContain('#pdfSourceModal .modal-source-btn:focus-visible');
    expect(modalCss).toContain('#pdfSourceModal .modal-source-btn:focus:not(:focus-visible)');
    expect(modalCss).toContain('#pdfSourceModal .modal-source-btn:active');
    expect(modalCss).toContain('#pdfSourceModal .btn-text:focus-visible');
    expect(modalCss).toContain('#pdfSourceModal .btn-text:active');
    expect(modalCss).toContain('overflow-x: hidden');
    expect(modalCss).toContain('min-width: 0');
    expect(modalCss).toContain('@media (max-width: 380px)');
  });

  it("fixes the Turkish PDF'ler typo while keeping form of address and EN/TR keys intact", () => {
    setLanguage('tr');
    expect(t('modal.pdfSource.binderyDesc')).toContain("PDF'ler");
    expect(t('modal.pdfSource.binderyDesc')).not.toContain('PDFler');
    expect(t('modal.pdfSource.title')).toBe('Belge Kaynağı Seçin');
    expect(t('modal.pdfSource.device')).toBe('Cihaz Dosyaları');
    expect(t('modal.pdfSource.deviceDesc')).toBe('Cihazınızın hafızasından bir PDF seçin.');
    expect(t('modal.pdfSource.bindery')).toBe('Bindery Belgeleri');

    setLanguage('en');
    expect(t('modal.pdfSource.title')).toBe('Select PDF Source');
    expect(t('modal.pdfSource.device')).toBe('Device Files');
    expect(t('modal.pdfSource.deviceDesc')).toBe('Choose a PDF file from your device storage.');
    expect(t('modal.pdfSource.bindery')).toBe('Bindery Documents');
    expect(t('modal.pdfSource.binderyDesc')).toBe(
      'PDFs saved inside Bindery — sample file and results from other tools.',
    );
  });
});
