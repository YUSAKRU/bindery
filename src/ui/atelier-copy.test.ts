import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf-8');

const i18nPath = fileURLToPath(new URL('../i18n/index.ts', import.meta.url));
const i18nSource = readFileSync(i18nPath, 'utf-8');
// Every library string, plus the card-2 copy and the library error.
const libraryKeys = [
  ...new Set(Array.from(i18nSource.matchAll(/^\s*'((?:library\.|atelier\.card2\.|error\.LIBRARY_)[^']+)':/gm), (m) => m[1])),
];

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

  // Card 2 now counts the booklets in the library, not opened documents.
  it('reads the library count correctly for 0, 1 and many booklets', () => {
    setLanguage('en');
    expect([0, 1, 7].map((count) => t('atelier.card2.meta', { count }))).toEqual([
      'Booklets in library: 0',
      'Booklets in library: 1',
      'Booklets in library: 7',
    ]);
    setLanguage('tr');
    expect([0, 1, 7].map((count) => t('atelier.card2.meta', { count }))).toEqual([
      'Kitaplıkta 0 kitapçık',
      'Kitaplıkta 1 kitapçık',
      'Kitaplıkta 7 kitapçık',
    ]);
  });

  it('names card 2 and the menu entry after the library', () => {
    setLanguage('en');
    expect(t('atelier.card2.ctaTitle')).toBe('Open library');
    expect(t('atelier.card2.ctaSub')).toBe('Your booklets and PDFs');
    expect(t('atelier.menuRecents')).toBe('My Library');
    setLanguage('tr');
    expect(t('atelier.card2.ctaTitle')).toBe('Kitaplığı aç');
    expect(t('atelier.card2.ctaSub')).toBe("Kitapçıklarınız ve PDF'leriniz");
    expect(t('atelier.menuRecents')).toBe('Kitaplığım');
  });

  it('uses the plain-language Turkish hub texts', () => {
    setLanguage('tr');
    expect(t('atelier.deskTitle')).toBe('Bugün ne hazırlıyoruz?');
    expect(t('atelier.hintFree')).toBe('Bir karta dokunun');
    expect(t('atelier.hintCarousel')).toBe('Kaydırarak seçin, boşluğa dokunup geri dönün');
    expect(t('atelier.card3.ctaTitle')).toBe('Kapak hazırla');
    expect(t('atelier.privacySeal')).toBe('Her şey cihazınızda kalır, hiçbir dosya yüklenmez');
  });

  it('has every library string in both languages', () => {
    expect(libraryKeys.length).toBeGreaterThan(40);
    for (const key of libraryKeys) {
      const definitions = i18nSource.split('\n').filter((line) => line.trimStart().startsWith(`'${key}':`));
      expect(definitions, key).toHaveLength(2);
    }
  });

  // docs/BRAND.md: Bindery produces, never creates; it never uploads; and the
  // library shows only what a record stores, so no paper weight, spine width
  // or binding-material claims.
  it('keeps library copy within the brand rules in both languages', () => {
    const banned = /oluştur|yarat|create|yükle|upload|gramaj|sırt payı|koptik|yaldız|ebru|coptic|foil|marbl|grammage|gsm|spine/;
    for (const lang of ['en', 'tr'] as const) {
      setLanguage(lang);
      for (const key of libraryKeys) {
        const value = t(key).toLocaleLowerCase(lang);
        expect(value, `${lang} ${key}`).not.toBe(key.toLocaleLowerCase(lang));
        expect(value, `${lang} ${key}: "${value}"`).not.toMatch(banned);
      }
    }
  });

  it('uses the polite form in the Turkish library copy', () => {
    setLanguage('tr');
    expect(t('library.subtitle')).toBe("Ürettiğiniz kitapçıklar ve masanızdaki PDF'ler.");
    expect(t('library.booksEmpty')).toBe('Kaydettiğiniz ya da paylaştığınız kitapçıklar burada görünür.');
    expect(t('library.deskEmpty')).toBe("Açtığınız PDF'ler burada görünür.");
    expect(t('library.detail.heading')).toBe('Forma Tezgâhı');
    setLanguage('en');
    expect(t('library.detail.heading')).toBe('Booklet details');
  });
});
