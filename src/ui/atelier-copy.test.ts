import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf-8');

// The hub used to carry a "Mode: Free Float (Active)" pill that toggled the
// cards. Tapping a card or empty space already switches the mode, so the pill
// was dropped together with its copy.
describe('Atelier hub copy', () => {
  beforeEach(() => {
    // setLanguage persists the choice and re-labels the DOM; neither exists in Node.
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
  });

  afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
  });

  it('no longer ships the mode toggle pill', () => {
    expect(htmlSource).not.toContain('atelierModeToggleBtn');
    expect(htmlSource).not.toContain('atelierModeToggleLabel');
    expect(htmlSource).not.toContain('atelier-mode-bar');
    expect(cssSource).not.toContain('atelier-mode-btn');
    for (const lang of ['en', 'tr'] as const) {
      setLanguage(lang);
      expect(t('atelier.modeFree')).toBe('atelier.modeFree');
      expect(t('atelier.modeCarousel')).toBe('atelier.modeCarousel');
    }
  });

  it('reads the saved count correctly for 0, 1 and many documents', () => {
    setLanguage('en');
    expect([0, 1, 7].map((count) => t('atelier.card2.meta', { count }))).toEqual([
      'Saved documents: 0',
      'Saved documents: 1',
      'Saved documents: 7',
    ]);
    setLanguage('tr');
    expect([0, 1, 7].map((count) => t('atelier.card2.meta', { count }))).toEqual([
      '0 belge kayıtlı',
      '1 belge kayıtlı',
      '7 belge kayıtlı',
    ]);
  });

  it('uses the plain-language Turkish hub texts', () => {
    setLanguage('tr');
    expect(t('atelier.deskTitle')).toBe('Bugün ne hazırlıyoruz?');
    expect(t('atelier.hintFree')).toBe('Bir karta dokunun');
    expect(t('atelier.hintCarousel')).toBe('Kaydırarak seçin, boşluğa dokunup geri dönün');
    expect(t('atelier.card3.ctaTitle')).toBe('Kapak hazırla');
    expect(t('atelier.privacySeal')).toBe('Her şey cihazınızda kalır, hiçbir dosya yüklenmez');
  });
});
