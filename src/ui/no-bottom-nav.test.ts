import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const htmlSource = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8');
const cssSource = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf-8');
const appSource = readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf-8');

const FORBIDDEN_TOKENS = [
  ['bottom', 'Nav'].join(''),
  ['bottom', 'nav'].join('-'),
];

describe('Navigation — bottom bar removed, hub is the only root screen', () => {
  it('removes all bottom bar references from index.html, app.ts, and styles.css', () => {
    for (const [label, content] of [
      ['index.html', htmlSource],
      ['src/ui/app.ts', appSource],
      ['src/ui/styles.css', cssSource],
    ] as const) {
      for (const token of FORBIDDEN_TOKENS) {
        expect(content, `${label} must not contain ${token}`).not.toContain(token);
      }
    }
  });

  it('hides the top-bar back button only when id === hub in showScreen', () => {
    expect(appSource).toContain("backBtn.hidden = id === 'hub';");
  });
});
