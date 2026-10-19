import type { Binding } from '../engine/types';

/**
 * Two facing pages of an open book, as indices into the book's page
 * sequence; null where the facing side is empty (the first page alone, the
 * last page alone).
 */
export interface Spread {
  left: number | null;
  right: number | null;
}

/**
 * Pairs a book of `length` pages into spreads the way a bound book opens.
 * Left to right: page 1 alone on the right, then 2|3, 4|5 …, and the last page
 * alone on the left when the count is even. Right to left mirrors it: page 1
 * alone on the left, then 3|2, 5|4 …
 */
export function buildSpreads(length: number, binding: Binding = 'ltr'): Spread[] {
  if (length <= 0) return [];
  const pairs: Array<[number | null, number | null]> = [[null, 0]];
  for (let first = 1; first < length; first += 2) {
    pairs.push([first, first + 1 < length ? first + 1 : null]);
  }
  // Each pair is [earlier, later] in reading order; the binding decides which
  // side the earlier page sits on.
  return pairs.map(([earlier, later]) =>
    binding === 'rtl' ? { left: later, right: earlier } : { left: earlier, right: later },
  );
}

/** The spread that shows page `seqIndex` (0 when out of range). */
export function spreadIndexOfPage(spreads: readonly Spread[], seqIndex: number): number {
  const index = spreads.findIndex((s) => s.left === seqIndex || s.right === seqIndex);
  return index < 0 ? 0 : index;
}

export function clampSpread(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), total - 1);
}

/** Pages of a spread, earlier page first. */
export function pagesOf(spread: Spread): number[] {
  return [spread.left, spread.right]
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
}

/**
 * The pages worth holding rendered while `current` is shown: the visible
 * spread and the one on each side of it — never more than six pages.
 */
export function pagesToKeep(spreads: readonly Spread[], current: number): number[] {
  const keep: number[] = [];
  for (let i = current - 1; i <= current + 1; i++) {
    const spread = spreads[i];
    if (spread) keep.push(...pagesOf(spread));
  }
  return keep;
}
