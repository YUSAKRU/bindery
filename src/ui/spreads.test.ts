import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildSpreads, clampSpread, pagesOf, pagesToKeep, spreadIndexOfPage } from './spreads';

describe('spreads', () => {
  it('a single page opens alone on the right', () => {
    expect(buildSpreads(1)).toEqual([{ left: null, right: 0 }]);
  });

  it('left to right: 1 alone, then 2|3, and an even book ends on a lone left page', () => {
    expect(buildSpreads(4)).toEqual([
      { left: null, right: 0 },
      { left: 1, right: 2 },
      { left: 3, right: null },
    ]);
    expect(buildSpreads(5).at(-1)).toEqual({ left: 3, right: 4 });
  });

  it('right to left mirrors every spread', () => {
    expect(buildSpreads(4, 'rtl')).toEqual([
      { left: 0, right: null },
      { left: 2, right: 1 },
      { left: null, right: 3 },
    ]);
  });

  it('shows every page exactly once, in reading order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), fc.constantFrom('ltr' as const, 'rtl' as const), (n, binding) => {
        const pages = buildSpreads(n, binding).flatMap(pagesOf);
        expect(pages).toEqual(Array.from({ length: n }, (_, i) => i));
      }),
    );
  });

  it('finds the spread of a page and clamps out-of-range spreads', () => {
    const spreads = buildSpreads(10);
    expect(spreadIndexOfPage(spreads, 0)).toBe(0);
    expect(spreadIndexOfPage(spreads, 4)).toBe(2);
    expect(spreadIndexOfPage(spreads, 99)).toBe(0);
    expect(clampSpread(-3, spreads.length)).toBe(0);
    expect(clampSpread(42, spreads.length)).toBe(spreads.length - 1);
  });

  it('keeps only the visible spread and its neighbours — at most six pages', () => {
    const spreads = buildSpreads(40);
    expect(pagesToKeep(spreads, 0)).toEqual([0, 1, 2]);
    expect(pagesToKeep(spreads, 5)).toEqual([7, 8, 9, 10, 11, 12]);
    for (let i = 0; i < spreads.length; i++) expect(pagesToKeep(spreads, i).length).toBeLessThanOrEqual(6);
  });
});
