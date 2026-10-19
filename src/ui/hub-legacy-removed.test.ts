import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const htmlPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const htmlSource = readFileSync(htmlPath, 'utf-8');

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const appSource = readFileSync(appTsPath, 'utf-8');

// The hub used to keep the old home page hidden in the DOM while the atelier
// view drew on top. The atelier is now the only hub, so nothing may lean on
// that hidden markup again — and what the atelier still needs from it (the
// reader picker, the saved count) must stay wired without it.
describe('Hub — legacy home page removed', () => {
  it('no longer ships the legacy hub markup', () => {
    for (const id of ['hubLegacyView', 'hubOpenReaderBtn', 'recentsList', 'heroFly']) {
      expect(htmlSource, `#${id} should be gone from index.html`).not.toContain(`id="${id}"`);
    }
    expect(htmlSource).not.toContain('class="hub-carousel"');
  });

  // Card 2 used to open the PDF picker directly; it now opens the library,
  // whose desk tab carries "Open PDF".
  it('opens the library from atelier card 2 without clicking a hidden button', () => {
    expect(appSource).not.toContain('hubOpenReaderBtn');
    expect(appSource).not.toContain('requestHeroIntro');
    expect(appSource).toMatch(/moduleIndex === 1\)\s*\{\s*showScreen\('library'\);/);
  });

  it('keeps the card-2 count fed from the library records', () => {
    expect(appSource).toMatch(
      /async function refreshHubSavedCount\(\): Promise<void> \{\s*try \{\s*const books = await getLibrary\(\);\s*atelierHub\?\.setSavedCount\(books\.length\);/,
    );
  });

  it('keeps the PWA install banner ids that pwa-install.ts looks up', () => {
    for (const id of [
      'pwaInstallBanner',
      'pwaInstallBtn',
      'pwaPlayStoreBtn',
      'pwaBannerCloseBtn',
      'iosInstallBanner',
      'iosBannerCloseBtn',
    ]) {
      expect(htmlSource, `expected #${id} to exist in index.html`).toContain(`id="${id}"`);
    }
  });
});
