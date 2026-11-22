import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const cssSource = readFileSync(cssPath, 'utf-8');

function extractConfirmModalCssSection(): string {
  const startMarker = '/* Atelier Confirm Modal (#confirmModal) */';
  const endMarker = '/* End Atelier Confirm Modal */';
  const start = cssSource.indexOf(startMarker);
  const end = cssSource.indexOf(endMarker);
  expect(start, 'expected scoped #confirmModal Atelier CSS section').toBeGreaterThan(-1);
  expect(end, 'expected end marker for #confirmModal Atelier CSS section').toBeGreaterThan(start);
  return cssSource.slice(start, end);
}

describe('#confirmModal Atelier restyling (T-09)', () => {
  const modalCss = extractConfirmModalCssSection();

  it('adds #confirmModal to all three Atelier token scopes while preserving #pdfSourceModal scopes', () => {
    const confirmScopeCount = cssSource.match(/#confirmModal,/g)?.length ?? 0;
    const pdfSourceScopeCount = cssSource.match(/#pdfSourceModal,/g)?.length ?? 0;
    expect(confirmScopeCount, 'light, prefers-color-scheme dark, and .dark-theme blocks').toBe(3);
    expect(pdfSourceScopeCount, 'existing #pdfSourceModal token scopes must remain intact').toBe(3);
  });

  it('contains no legacy --color-primary or indigo hex values inside the #confirmModal block', () => {
    expect(modalCss).not.toContain('--color-primary');
    expect(modalCss).not.toMatch(/#4f46e5|#ede9fe|#a5b4fc|#3730a3/i);
  });

  it('styles overlay, card, body message, buttons, focus-visible, dark themes, responsive and reduced-motion rules', () => {
    expect(modalCss).toContain('#confirmModal {');
    expect(modalCss).toContain('#confirmModal .modal-card');
    expect(modalCss).toContain('max-width: 320px');
    expect(modalCss).toContain('#confirmModal .modal-label');
    expect(modalCss).toContain("'Hanken Grotesk'");
    expect(modalCss).toContain('#confirmModal .btn-text');
    expect(modalCss).toContain('#confirmModal .btn-primary');
    expect(modalCss).toContain('#confirmModal .btn-text:focus-visible');
    expect(modalCss).toContain('#confirmModal .btn-primary:focus-visible');
    expect(modalCss).toContain('#confirmModal .btn-text:focus:not(:focus-visible)');
    expect(modalCss).toContain('#confirmModal .btn-primary:focus:not(:focus-visible)');
    expect(modalCss).toContain('#confirmModal .btn-primary:active');
    expect(modalCss).toContain('scale(0.98)');

    expect(modalCss).toContain('--atelier-bg');
    expect(modalCss).toContain('--atelier-card2-bg');
    expect(modalCss).toContain('--atelier-paper-edge');
    expect(modalCss).toContain('--atelier-ink-black');
    expect(modalCss).toContain('--atelier-primary');
    expect(modalCss).toContain('--atelier-terracotta-deep');
    expect(modalCss).toContain('--atelier-gold-foil');

    expect(modalCss).toContain('@media (prefers-color-scheme: dark)');
    expect(modalCss).toContain(':root:not(.light-theme) #confirmModal');
    expect(modalCss).toContain(':root.dark-theme #confirmModal');
    expect(modalCss).toContain('#c4683c');
    expect(modalCss).toContain('#a35028');
    expect(modalCss).toContain('@media (max-width: 380px)');
    expect(modalCss).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
