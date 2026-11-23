import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');

const PHASE1_SCREENS = [
  'screen-merge-picker',
  'screen-organize',
  'screen-rotate',
  'screen-page-numbers',
  'screen-watermark',
] as const;

function extractSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  expect(start, `expected start marker "${startMarker}"`).toBeGreaterThan(-1);
  expect(end, `expected end marker "${endMarker}"`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function extractTagBlock(markup: string, openMarker: string, tagName: string): string {
  const start = markup.indexOf(openMarker);
  expect(start, `expected to find "${openMarker}" in index.html`).toBeGreaterThanOrEqual(0);
  const tagStart = markup.lastIndexOf(`<${tagName}`, start);
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'g');
  const closeRe = new RegExp(`</${tagName}>`, 'g');
  let depth = 0;
  let cursor = tagStart;
  while (cursor < markup.length) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(markup);
    const nextClose = closeRe.exec(markup);
    if (!nextClose) throw new Error(`unterminated <${tagName}> for "${openMarker}"`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return markup.slice(tagStart, cursor);
    }
  }
  throw new Error(`unterminated <${tagName}> for "${openMarker}"`);
}

function extractTokenSelectorBlocks(): { light: string; prefersDark: string; darkClass: string } {
  const lightStart = css.indexOf('/* 2. Scoped CSS Variables (Light Theme Default) */');
  const darkMediaStart = css.indexOf('/* Scoped Dark Mode Overrides */');
  const darkClassStart = css.indexOf(':root.dark-theme .atelier-hub,');
  const containerStart = css.indexOf('/* 3. Main Atelier Container & Millimeter Dot Grid */');

  expect(lightStart).toBeGreaterThan(-1);
  expect(darkMediaStart).toBeGreaterThan(lightStart);
  expect(darkClassStart).toBeGreaterThan(darkMediaStart);
  expect(containerStart).toBeGreaterThan(darkClassStart);

  return {
    light: css.slice(lightStart, darkMediaStart),
    prefersDark: css.slice(darkMediaStart, darkClassStart),
    darkClass: css.slice(darkClassStart, containerStart),
  };
}

const FORBIDDEN_INDIGO_RE =
  /--color-primary(?:-rgb|-container)?\b|--color-surface-variant\b|#4f46e5|#ede9fe|#a5b4fc|#3730a3|#7c8cf8|#d0aaff|\b79\s*,\s*70\s*,\s*229\b|\b124\s*,\s*140\s*,\s*248\b|\b187\s*,\s*134\s*,\s*252\b/i;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('Atelier Tool Screens — Phase 1 (Empty / Picker States)', () => {
  const phase1Css = extractSection(
    css,
    '/* Atelier Tool Screens — Phase 1 (Empty / Picker States) */',
    '/* End Atelier Tool Screens — Phase 1 */',
  );

  it('registers all 5 Phase 1 tool screens and their top-bar/screen-container in all three Atelier token lists', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();
    const parseSelectorList = (raw: string): string[] =>
      raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const lightSelectors = parseSelectorList(light.slice(0, light.indexOf('{')));
    const prefersDarkSelectors = parseSelectorList(
      prefersDark.slice(
        prefersDark.indexOf(':root:not(.light-theme)'),
        prefersDark.indexOf('{', prefersDark.indexOf(':root:not(.light-theme)')),
      ),
    );
    const darkClassSelectors = parseSelectorList(darkClass.slice(0, darkClass.indexOf('{')));

    for (const screenId of PHASE1_SCREENS) {
      const baseSelectors = [
        `#${screenId}`,
        `.app:has(#${screenId}:not(.hidden)) .top-bar`,
        `.app:has(#${screenId}:not(.hidden)) .screen-container`,
      ];
      for (const sel of baseSelectors) {
        expect(lightSelectors, `light token block missing ${sel}`).toContain(sel);
        expect(
          prefersDarkSelectors,
          `prefers-color-scheme:dark block missing :root:not(.light-theme) ${sel}`,
        ).toContain(`:root:not(.light-theme) ${sel}`);
        expect(
          darkClassSelectors,
          `:root.dark-theme block missing :root.dark-theme ${sel}`,
        ).toContain(`:root.dark-theme ${sel}`);
      }
    }
  });

  it('includes all 5 Phase 1 tool screens in all three shared Atelier top-bar groups and dotted screen-container', () => {
    const headerPos = css.indexOf('printer needs. Scoped to #screen-result and its parent container.');
    expect(headerPos).toBeGreaterThan(-1);
    const start = css.indexOf('*/', headerPos) + 2;
    const end = css.indexOf('/* Clear the absolute top bar;', start);
    expect(end).toBeGreaterThan(start);
    const topBarBlock = css.slice(start, end);
    const ruleSelectors = [...topBarBlock.matchAll(/([^{}]+)\{/g)].map((m) =>
      m[1]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    expect(ruleSelectors).toHaveLength(3);

    for (const screenId of PHASE1_SCREENS) {
      expect(ruleSelectors[0]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar`);
      expect(ruleSelectors[1]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar-title`);
      expect(ruleSelectors[2]).toContain(
        `.app:has(#${screenId}:not(.hidden)) .top-bar .icon-btn:not([hidden])`,
      );
      expect(phase1Css).toContain(`.app:has(#${screenId}:not(.hidden)) .screen-container`);
    }
    expect(phase1Css).toContain('radial-gradient(var(--atelier-grid-dot1)');
  });

  it('uses zero indigo/purple literals or legacy primary tokens in Phase 1 scoped CSS', () => {
    expect(phase1Css).not.toMatch(FORBIDDEN_INDIGO_RE);
    const usedVars = new Set([...phase1Css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const v of usedVars) {
      expect(css, `CSS variable ${v} must be defined`).toContain(`${v}:`);
    }
  });

  it('replaces hero emojis with inline SVG line icons, frames each CTA inside the craft card, and adds privacy footer', () => {
    const expectedPickIds: Record<(typeof PHASE1_SCREENS)[number], string> = {
      'screen-merge-picker': 'mergeAddFileBtn',
      'screen-organize': 'organizePickBtn',
      'screen-rotate': 'rotatePickBtn',
      'screen-page-numbers': 'pageNumbersPickBtn',
      'screen-watermark': 'watermarkPickBtn',
    };

    for (const screenId of PHASE1_SCREENS) {
      const sectionHtml = extractTagBlock(html, `id="${screenId}"`, 'section');
      const heroHtml = extractTagBlock(sectionHtml, 'class="hero"', 'div');
      const iconMatch = heroHtml.match(/<div class="hero-icon"[^>]*>([\s\S]*?)<\/div>/);
      expect(iconMatch, `${screenId} missing .hero-icon`).not.toBeNull();
      expect(iconMatch![1]).toContain('<svg');
      expect(iconMatch![1]).toContain('class="tool-icon"');
      expect(iconMatch![1]).not.toMatch(EMOJI_RE);
      expect(heroHtml).toContain('class="tool-hero-kicker"');
      expect(heroHtml).toContain(`id="${expectedPickIds[screenId]}"`);
      expect(sectionHtml).toContain('class="tool-privacy-footer"');
      expect(sectionHtml).toContain('data-i18n="atelier.privacySeal"');
    }
  });

  it('uses the combining-sheets SVG icon for Merge instead of the git-branch circle SVG', () => {
    const oldMergeFragment = '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>';
    const newMergeFragment = '<rect x="8" y="6" width="13" height="15" rx="2"/>';

    const toolsAllHtml = extractTagBlock(html, 'id="screen-tools-all"', 'section');
    const readerToolsHtml = extractTagBlock(html, 'id="readerToolsSheet"', 'div');
    const mergePickerHtml = extractTagBlock(html, 'id="screen-merge-picker"', 'section');

    for (const [label, block] of [
      ['#screen-tools-all', toolsAllHtml],
      ['#readerToolsSheet', readerToolsHtml],
      ['#screen-merge-picker', mergePickerHtml],
    ] as const) {
      expect(block, `${label} should use new Merge SVG`).toContain(newMergeFragment);
      expect(block, `${label} should not keep old git-branch SVG`).not.toContain(oldMergeFragment);
    }
  });

  describe('Tool copy, polite Turkish siz register, and BRAND.md rules', () => {
    beforeEach(() => {
      vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
      vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
    });

    afterEach(() => {
      setLanguage('en');
      vi.unstubAllGlobals();
    });

    it('updates category 3 label and removes banned "Create" verb from EN tool CTAs', () => {
      setLanguage('en');
      expect(t('hub.category.add')).toBe('Stamp & Convert');
      expect(t('imageToPdf.generatePdf')).not.toMatch(/\bcreate\b/i);
      expect(t('mdToPdf.generateBooklet')).not.toMatch(/\bcreate\b/i);
      expect(t('mdToPdf.generatePdf')).not.toMatch(/\bcreate\b/i);
      expect(t('imageToPdf.generatePdf')).toBe('Make PDF');
      expect(t('mdToPdf.generateBooklet')).toBe('Make Booklet (A5)');
      expect(t('mdToPdf.generatePdf')).toBe('Make PDF Only');

      setLanguage('tr');
      expect(t('hub.category.add')).toBe('Damga & Dönüştürme');
      expect(t('imageToPdf.generatePdf')).toBe('PDF Üret');
      expect(t('mdToPdf.generateBooklet')).toBe('Kitapçık Üret (A5)');
      expect(t('mdToPdf.generatePdf')).toBe('Yalnızca PDF Üret');
    });

    it('uses polite Turkish siz form and non-repetitive hero titles across Phase 1 tools', () => {
      setLanguage('tr');
      expect(t('tool.organize.desc')).toBe('Sayfaları silin veya yeniden sıralayın');
      expect(t('merge.subtitle')).toContain('ekleyin');
      expect(t('merge.subtitle')).toContain('ayarlayın');
      expect(t('organize.subtitle')).toContain('seçin');
      expect(t('organize.subtitle')).toContain('silin');
      expect(t('rotate.subtitle')).toContain('seçin');
      expect(t('rotate.subtitle')).toContain('çevirin');
      expect(t('pageNumbers.subtitle')).toContain('seçin');
      expect(t('watermark.subtitle')).toContain('seçin');

      // Hero heading must not just repeat the top-bar title verbatim
      expect(t('merge.title')).not.toBe(t('screenTitle.mergePicker'));
      expect(t('organize.title')).not.toBe(t('tool.organize.title'));
      expect(t('rotate.title')).not.toBe(t('tool.rotate.title'));
      expect(t('pageNumbers.title')).not.toBe(t('tool.pageNumbers.title'));
      expect(t('watermark.title')).not.toBe(t('tool.watermark.title'));

      setLanguage('en');
      expect(t('merge.title')).not.toBe(t('screenTitle.mergePicker'));
      expect(t('organize.title')).not.toBe(t('tool.organize.title'));
      expect(t('rotate.title')).not.toBe(t('tool.rotate.title'));
      expect(t('pageNumbers.title')).not.toBe(t('tool.pageNumbers.title'));
      expect(t('watermark.title')).not.toBe(t('tool.watermark.title'));
    });
  });
});

const PHASE2_SCREENS = ['screen-image-to-pdf', 'screen-md-to-pdf', 'screen-crop'] as const;

describe('Atelier Tool Screens — Phase 2 (Working States, Image/MD & Crop)', () => {
  const phase2Css = extractSection(
    css,
    '/* Atelier Tool Screens — Phase 2 (Working States, Image/MD & Crop) */',
    '/* End Atelier Tool Screens — Phase 2 */',
  );

  it('registers #screen-image-to-pdf, #screen-md-to-pdf, #screen-crop in all three Atelier token lists and top-bar groups', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();
    const parseSelectorList = (raw: string): string[] =>
      raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const lightSelectors = parseSelectorList(light.slice(0, light.indexOf('{')));
    const prefersDarkSelectors = parseSelectorList(
      prefersDark.slice(
        prefersDark.indexOf(':root:not(.light-theme)'),
        prefersDark.indexOf('{', prefersDark.indexOf(':root:not(.light-theme)')),
      ),
    );
    const darkClassSelectors = parseSelectorList(darkClass.slice(0, darkClass.indexOf('{')));

    const headerPos = css.indexOf('printer needs. Scoped to #screen-result and its parent container.');
    expect(headerPos).toBeGreaterThan(-1);
    const start = css.indexOf('*/', headerPos) + 2;
    const end = css.indexOf('/* Clear the absolute top bar;', start);
    const ruleSelectors = [...css.slice(start, end).matchAll(/([^{}]+)\{/g)].map((m) =>
      parseSelectorList(m[1]),
    );
    expect(ruleSelectors).toHaveLength(3);

    for (const screenId of PHASE2_SCREENS) {
      for (const sel of [
        `#${screenId}`,
        `.app:has(#${screenId}:not(.hidden)) .top-bar`,
        `.app:has(#${screenId}:not(.hidden)) .screen-container`,
      ]) {
        expect(lightSelectors, `light token block missing ${sel}`).toContain(sel);
        expect(
          prefersDarkSelectors,
          `prefersDark token block missing :root:not(.light-theme) ${sel}`,
        ).toContain(`:root:not(.light-theme) ${sel}`);
        expect(
          darkClassSelectors,
          `darkClass token block missing :root.dark-theme ${sel}`,
        ).toContain(`:root.dark-theme ${sel}`);
      }
      expect(ruleSelectors[0]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar`);
      expect(ruleSelectors[1]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar-title`);
      expect(ruleSelectors[2]).toContain(
        `.app:has(#${screenId}:not(.hidden)) .top-bar .icon-btn:not([hidden])`,
      );
      expect(phase2Css).toContain(`.app:has(#${screenId}:not(.hidden)) .screen-container`);
    }
  });

  it('uses zero indigo/purple literals or legacy primary tokens in Phase 2 CSS and defines all custom properties', () => {
    expect(phase2Css).not.toMatch(FORBIDDEN_INDIGO_RE);
    const usedVars = new Set([...phase2Css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const v of usedVars) {
      expect(css, `CSS variable ${v} must be defined`).toContain(`${v}:`);
    }
  });

  it('removes emojis from #screen-image-to-pdf, #screen-md-to-pdf, and i18n camera/gallery labels while preserving i18n spans', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
    try {
      const imgHtml = extractTagBlock(html, 'id="screen-image-to-pdf"', 'section');
      const mdHtml = extractTagBlock(html, 'id="screen-md-to-pdf"', 'section');

      for (const [name, section] of [
        ['#screen-image-to-pdf', imgHtml],
        ['#screen-md-to-pdf', mdHtml],
      ] as const) {
        expect(section, `${name} should contain no emojis`).not.toMatch(EMOJI_RE);
        const heroHtml = extractTagBlock(section, 'class="hero"', 'div');
        expect(heroHtml).toContain('class="tool-icon"');
        expect(heroHtml).toContain('class="tool-hero-kicker"');
        expect(section).toContain('class="tool-privacy-footer"');
      }

      // SVG inside #imgCameraBtn must survive applyLanguageToDom() by placing data-i18n on inner <span>
      const camBtnMatch = imgHtml.match(/<button[^>]*id="imgCameraBtn"[^>]*>([\s\S]*?)<\/button>/);
      expect(camBtnMatch).not.toBeNull();
      expect(camBtnMatch![0]).not.toMatch(/<button[^>]*data-i18n="/);
      expect(camBtnMatch![1]).toContain('<svg');
      expect(camBtnMatch![1]).toContain('<span data-i18n="imageToPdf.takePhoto">');

      setLanguage('en');
      expect(t('imageToPdf.takePhoto')).not.toMatch(EMOJI_RE);
      expect(t('imageToPdf.pickFromGallery')).not.toMatch(EMOJI_RE);
      expect(t('imageToPdf.heading')).not.toBe(t('tool.imageToPdf.title'));
      expect(t('mdToPdf.heading')).not.toBe(t('tool.mdToPdf.title'));

      setLanguage('tr');
      expect(t('imageToPdf.takePhoto')).not.toMatch(EMOJI_RE);
      expect(t('imageToPdf.pickFromGallery')).not.toMatch(EMOJI_RE);
    } finally {
      setLanguage('en');
      vi.unstubAllGlobals();
    }
  });

  it('styles active tool working states (lists, settings, slider, image cards, crop) in light and dark without altering global .slider', () => {
    for (const selector of [
      '.merge-file-row',
      '.organize-row',
      '.setting-card',
      '.segmented-btn.is-active',
      '#screen-watermark .slider',
      '.pagenum-overlay',
      '.image-card-badge',
      '#screen-crop .crop-line',
      '#screen-crop .crop-handle',
      '#screen-crop .crop-loupe',
    ]) {
      expect(phase2Css, `missing Phase 2 selector ${selector}`).toContain(selector);
    }
    expect(phase2Css).toContain(':root:not(.light-theme) #screen-crop .crop-line');
    expect(phase2Css).toContain(':root.dark-theme #screen-crop .crop-line');

    const globalSliderMatch = css.match(/^\.slider\s*\{([^}]+)\}/m);
    expect(globalSliderMatch).not.toBeNull();
    expect(globalSliderMatch![1]).toContain('height: 4px;');
  });
});

const PHASE3_SCREENS = [
  'screen-merge-result',
  'screen-organize-result',
  'screen-rotate-result',
  'screen-page-numbers-result',
  'screen-watermark-result',
  'screen-error',
] as const;

describe('Atelier Tool Screens — Phase 3 (Result Screens & Error Screen)', () => {
  const phase3Css = extractSection(
    css,
    '/* Atelier Tool Screens — Phase 3 (Result Screens & Error Screen) */',
    '/* End Atelier Tool Screens — Phase 3 */',
  );

  it('registers all 6 Phase 3 screens in all three Atelier token lists and top-bar groups', () => {
    const { light, prefersDark, darkClass } = extractTokenSelectorBlocks();
    const parseSelectorList = (raw: string): string[] =>
      raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const lightSelectors = parseSelectorList(light.slice(0, light.indexOf('{')));
    const prefersDarkSelectors = parseSelectorList(
      prefersDark.slice(
        prefersDark.indexOf(':root:not(.light-theme)'),
        prefersDark.indexOf('{', prefersDark.indexOf(':root:not(.light-theme)')),
      ),
    );
    const darkClassSelectors = parseSelectorList(darkClass.slice(0, darkClass.indexOf('{')));

    const headerPos = css.indexOf('printer needs. Scoped to #screen-result and its parent container.');
    expect(headerPos).toBeGreaterThan(-1);
    const start = css.indexOf('*/', headerPos) + 2;
    const end = css.indexOf('/* Clear the absolute top bar;', start);
    const ruleSelectors = [...css.slice(start, end).matchAll(/([^{}]+)\{/g)].map((m) =>
      parseSelectorList(m[1]),
    );
    expect(ruleSelectors).toHaveLength(3);

    for (const screenId of PHASE3_SCREENS) {
      for (const sel of [
        `#${screenId}`,
        `.app:has(#${screenId}:not(.hidden)) .top-bar`,
        `.app:has(#${screenId}:not(.hidden)) .screen-container`,
      ]) {
        expect(lightSelectors, `light token block missing ${sel}`).toContain(sel);
        expect(
          prefersDarkSelectors,
          `prefersDark token block missing :root:not(.light-theme) ${sel}`,
        ).toContain(`:root:not(.light-theme) ${sel}`);
        expect(
          darkClassSelectors,
          `darkClass token block missing :root.dark-theme ${sel}`,
        ).toContain(`:root.dark-theme ${sel}`);
      }
      expect(ruleSelectors[0]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar`);
      expect(ruleSelectors[1]).toContain(`.app:has(#${screenId}:not(.hidden)) .top-bar-title`);
      expect(ruleSelectors[2]).toContain(
        `.app:has(#${screenId}:not(.hidden)) .top-bar .icon-btn:not([hidden])`,
      );
      expect(phase3Css).toContain(`.app:has(#${screenId}:not(.hidden)) .screen-container`);
    }
  });

  it('uses zero indigo/purple literals or legacy primary tokens in Phase 3 CSS and defines all custom properties', () => {
    expect(phase3Css).not.toMatch(FORBIDDEN_INDIGO_RE);
    const usedVars = new Set([...phase3Css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const v of usedVars) {
      expect(css, `CSS variable ${v} must be defined`).toContain(`${v}:`);
    }
  });

  it('removes 📁 emoji from common.goToLocation and places inline folder SVG beside i18n span in all 5 Go-to-Location buttons', () => {
    const goToIds = [
      'mergeGoToLocationBtn',
      'organizeGoToLocationBtn',
      'rotateGoToLocationBtn',
      'pageNumbersGoToLocationBtn',
      'watermarkGoToLocationBtn',
    ];
    for (const btnId of goToIds) {
      const re = new RegExp(`<button[^>]*id="${btnId}"[^>]*>([\\s\\S]*?)<\\/button>`);
      const match = html.match(re);
      expect(match, `missing #${btnId}`).not.toBeNull();
      expect(match![0], `#${btnId} should not have data-i18n directly on <button>`).not.toMatch(
        /<button[^>]*data-i18n="/,
      );
      expect(match![1], `#${btnId} should contain inline folder SVG`).toContain('<svg');
      expect(match![1], `#${btnId} should contain inner data-i18n span`).toContain(
        '<span data-i18n="common.goToLocation">',
      );
      expect(match![0]).not.toMatch(EMOJI_RE);
    }

    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
    try {
      setLanguage('en');
      expect(t('common.goToLocation')).toBe('Go to Location');
      expect(t('common.goToLocation')).not.toMatch(EMOJI_RE);
      setLanguage('tr');
      expect(t('common.goToLocation')).toBe('Konuma Git');
      expect(t('common.goToLocation')).not.toMatch(EMOJI_RE);
    } finally {
      setLanguage('en');
      vi.unstubAllGlobals();
    }
  });

  it('includes adaptive .stat-grid, .result-icon, .stat-card, #screen-error .error-banner, and dark overrides in Phase 3 CSS', () => {
    expect(phase3Css).toContain('repeat(auto-fit, minmax(130px, 1fr))');
    expect(phase3Css).toContain('.result-icon');
    expect(phase3Css).toContain('.stat-card');
    expect(phase3Css).toContain('#screen-error .error-banner');
    expect(phase3Css).toContain(':root:not(.light-theme) #screen-error .error-banner');
    expect(phase3Css).toContain(':root.dark-theme #screen-error .error-banner');
    expect(phase3Css).toContain(':root:not(.light-theme) #rotateSaveBtn');
    expect(phase3Css).toContain(':root.dark-theme #rotateSaveBtn');
  });
});
