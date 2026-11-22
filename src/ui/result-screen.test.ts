import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {};
  }
});

import { setLanguage } from '../i18n';
import { formatResultSummary, normalizePrinterMode, printerModeTargets } from './app';

const root = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf-8');

const indexHtml = read('index.html');
const resultSection = (() => {
  const match = indexHtml.match(/<section class="screen hidden" id="screen-result"[\s\S]*?<\/section>/);
  expect(match, 'expected #screen-result in index.html').not.toBeNull();
  return match![0];
})();

const NBSP = ' ';
const plain = (s: string): string => s.replaceAll(NBSP, ' ');

describe('formatResultSummary (one-line result summary)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: { lang: '' }, querySelectorAll: () => [] });
  });

  afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
  });

  it('shows pages → sheets · signatures with no extras when nothing was added', () => {
    setLanguage('tr');
    const line = formatResultSummary({
      originalPages: 8,
      sheetsCount: 2,
      signaturesCount: 1,
      paddingApplied: 0,
      blanksInserted: 0,
    });
    expect(plain(line)).toBe('8 sayfa → 2 yaprak · 1 forma');
  });

  it('appends padding and inserted blanks only when non-zero', () => {
    setLanguage('tr');
    const line = formatResultSummary({
      originalPages: 5,
      sheetsCount: 2,
      signaturesCount: 1,
      paddingApplied: 3,
      blanksInserted: 2,
    });
    expect(plain(line)).toBe('5 sayfa → 2 yaprak · 1 forma · +3 boş · +2 ara boş');
  });

  it('uses singular/plural forms in English', () => {
    setLanguage('en');
    expect(
      plain(
        formatResultSummary({
          originalPages: 1,
          sheetsCount: 1,
          signaturesCount: 1,
          paddingApplied: 3,
          blanksInserted: 0,
        }),
      ),
    ).toBe('1 page → 1 sheet · 1 signature · +3 blank');
    expect(
      plain(
        formatResultSummary({
          originalPages: 300,
          sheetsCount: 75,
          signaturesCount: 19,
          paddingApplied: 0,
          blanksInserted: 0,
        }),
      ),
    ).toBe('300 pages → 75 sheets · 19 signatures');
  });

  it('keeps each fragment together so the line only wraps at the separators', () => {
    setLanguage('tr');
    const line = formatResultSummary({
      originalPages: 5,
      sheetsCount: 2,
      signaturesCount: 1,
      paddingApplied: 3,
      blanksInserted: 0,
    });
    expect(line).toContain(`+3${NBSP}boş`);
    expect(line).toContain(`2${NBSP}yaprak`);
    expect(line.split(' · ')).toHaveLength(3);
  });
});

describe('printer mode', () => {
  it('offers only the combined PDF for a two-sided printer', () => {
    expect(printerModeTargets('duplex')).toEqual(['combined']);
  });

  it('offers fronts then backs for a one-sided printer', () => {
    expect(printerModeTargets('simplex')).toEqual(['front', 'back']);
  });

  it('defaults anything unknown or missing to duplex', () => {
    expect(normalizePrinterMode('simplex')).toBe('simplex');
    expect(normalizePrinterMode('duplex')).toBe('duplex');
    expect(normalizePrinterMode(null)).toBe('duplex');
    expect(normalizePrinterMode(undefined)).toBe('duplex');
    expect(normalizePrinterMode('garbage')).toBe('duplex');
  });

  it('has an action row in the markup for every target any mode can offer', () => {
    for (const target of [...printerModeTargets('duplex'), ...printerModeTargets('simplex')]) {
      expect(resultSection).toContain(`data-row-target="${target}"`);
    }
  });
});

describe('#screen-result markup', () => {
  it('keeps a print and a share button for every booklet output', () => {
    for (const target of ['combined', 'front', 'back', 'cover', 'instructions']) {
      expect(resultSection).toMatch(
        new RegExp(`data-target="${target}" data-action="print"`),
      );
      expect(resultSection).toMatch(
        new RegExp(`data-target="${target}" data-action="share"`),
      );
    }
  });

  it('keeps the element ids app.ts looks up', () => {
    for (const id of [
      'bookletFileNameInput',
      'resultSummaryLine',
      'frontPreviewImg',
      'backPreviewImg',
      'coverPreviewCell',
      'coverActionRow',
      'instructionsActionRow',
      'bookletSaveBtn',
      'bookletSaveBtnLabel',
      'bookletSaveSpinner',
      'bookletGoToLocationBtn',
      'actionStatus',
      'newFileBtn',
    ]) {
      expect(resultSection).toContain(`id="${id}"`);
    }
  });

  it('drops the old stat grid and the emoji print hint', () => {
    expect(resultSection).not.toContain('stat-grid');
    expect(resultSection).not.toContain('booklet.printHint');
    expect(resultSection).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
