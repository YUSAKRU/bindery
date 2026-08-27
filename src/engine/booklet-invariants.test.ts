import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeCollationMarkRect,
  computeSignatureMappings,
  computeSlotRects,
  foldGuideCrossesContent,
} from './booklet-engine';

// Property-based tests for the booklet engine's structural invariants.
//
// These are deliberately NOT example tests. An example test written next to the
// code it covers tends to describe what the code already does, which makes
// whatever the code does automatically "correct" — the exact trap that let the
// 0.4.5 reverseSheetOrder scope bug through a green suite. An invariant is
// stated independently of the implementation and then checked against hundreds
// of generated inputs, so it can disagree with the code.

/** Page counts the engine accepts: positive multiples of 4. */
const pageCount = fc.integer({ min: 1, max: 100 }).map((n) => n * 4);
/** Signature sizes the UI can produce: unset, 'auto', or a multiple of 4. */
const signatureSize = fc.oneof(
  fc.constant(undefined),
  fc.constant('auto' as const),
  fc.integer({ min: 1, max: 16 }).map((n) => n * 4),
);

const pagesOf = (sheet: { frontLeft: number; frontRight: number; backLeft: number; backRight: number }) =>
  [sheet.frontLeft, sheet.frontRight, sheet.backLeft, sheet.backRight];

describe('booklet engine invariants', () => {
  // The one that matters most: imposition may reorder pages freely, but it may
  // never lose one, never print one twice, and never invent an index outside the
  // document. Everything else the engine does is a rearrangement of this set.
  it('places every page exactly once, and no page that does not exist', () => {
    fc.assert(
      fc.property(pageCount, signatureSize, (N, size) => {
        const signatures = computeSignatureMappings(N, size);
        const placed = signatures.flat().flatMap(pagesOf);

        expect(placed).toHaveLength(N);
        expect([...placed].sort((a, b) => a - b)).toEqual(
          Array.from({ length: N }, (_, i) => i),
        );
      }),
    );
  });

  // Sheet accounting. The balance clause guards the 0.4.5 balanced-distribution
  // feature: before it, the remainder was dumped into the last signature, which
  // could leave a runt (56pp @16 gave 16/16/16/8) and an uneven spine.
  it('splits the sheets into balanced, non-empty signatures that sum to the whole', () => {
    fc.assert(
      fc.property(pageCount, signatureSize, (N, size) => {
        const signatures = computeSignatureMappings(N, size);
        const lengths = signatures.map((s) => s.length);

        expect(lengths.reduce((a, b) => a + b, 0)).toBe(N / 4);
        for (const len of lengths) expect(len).toBeGreaterThan(0);
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
      }),
    );
  });

  // Each signature is a self-contained block of the document, and the blocks run
  // in reading order. This is what makes per-signature work (reversal, collation
  // marks, the instructions sheet's start pages) meaningful at all: signature k
  // owns a contiguous page range, so anything scoped "within a signature" cannot
  // leak into its neighbours.
  it('gives each signature a contiguous page range, in reading order', () => {
    fc.assert(
      fc.property(pageCount, signatureSize, (N, size) => {
        const signatures = computeSignatureMappings(N, size);
        let expectedStart = 0;

        for (const signature of signatures) {
          const pages = signature.flatMap(pagesOf).sort((a, b) => a - b);
          expect(pages[0]).toBe(expectedStart);
          expect(pages).toEqual(
            Array.from({ length: pages.length }, (_, i) => expectedStart + i),
          );
          expectedStart += pages.length;
        }

        expect(expectedStart).toBe(N);
      }),
    );
  });
});

describe('collation mark invariants', () => {
  const MARGIN = 24;
  // Relative tolerance: sheets go up to MAX_SHEET_PT (14400) and dimensions are
  // fractional in real documents, so a fixed epsilon would either be too tight
  // at large magnitudes or too slack at small ones.
  const near = (actual: number, expected: number) =>
    Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));

  // The engine accepts sheets from MIN_SHEET_PT to MAX_SHEET_PT, and 'source'
  // sizing routinely yields fractional points (595.276 and friends), so the
  // generator is fractional and spans the real range rather than a tidy subset.
  const spine = fc.record({
    sheetWidth: fc.double({ min: 72, max: 14400, noNaN: true }),
    sheetHeight: fc.double({ min: 72, max: 14400, noNaN: true }),
    // N = 400 at signatureSize 4 really does produce 100 signatures.
    count: fc.integer({ min: 1, max: 120 }),
  });

  // A bar that runs past the head or tail margin would be cut off by the trim,
  // and a bar that overlaps its neighbour destroys the step the mark is read by.
  it('keeps every bar inside the usable spine and clear of its neighbours', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        const rects = Array.from({ length: count }, (_, i) =>
          computeCollationMarkRect(i, count, sheetWidth, sheetHeight),
        );

        for (const r of rects) {
          expect(r.y >= MARGIN || near(r.y, MARGIN)).toBe(true);
          const top = r.y + r.height;
          const limit = sheetHeight - MARGIN;
          expect(top <= limit || near(top, limit)).toBe(true);
          expect(r.height).toBeGreaterThan(0);
        }
        // Listed top-down, so each bar sits fully above the next one.
        for (let i = 0; i + 1 < rects.length; i++) {
          const floor = rects[i + 1].y + rects[i + 1].height;
          expect(rects[i].y >= floor || near(rects[i].y, floor)).toBe(true);
        }
      }),
    );
  });

  // The mark is read as a POSITION: signature k's bar must sit exactly one band
  // below signature k-1's. If the step ever varied, a missing signature would
  // not visibly break the staircase — the only thing the mark exists to show.
  it('steps down exactly one band per signature, whatever the sheet', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        const band = (sheetHeight - 2 * MARGIN) / count;
        const rects = Array.from({ length: count }, (_, i) =>
          computeCollationMarkRect(i, count, sheetWidth, sheetHeight),
        );

        for (let i = 0; i + 1 < rects.length; i++) {
          expect(near(rects[i].y - rects[i + 1].y, band)).toBe(true);
        }
      }),
    );
  });

  // Straddling the fold is what puts half the bar on each folded leaf, so the
  // folded spine shows a full-width mark rather than half of one.
  //
  // Stated as "crosses the fold from both sides", NOT as "its centre is on the
  // fold": a zero-width bar sitting exactly on the fold satisfies the centring
  // form of this claim, so that version passes for an implementation that draws
  // nothing at all. (Found by mutating COLLATION_BAR_WIDTH to 0, which left the
  // centring version of this file entirely green.)
  it('always crosses the fold line, from both sides', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        const fold = sheetWidth / 2;
        for (let i = 0; i < count; i++) {
          const r = computeCollationMarkRect(i, count, sheetWidth, sheetHeight);
          expect(r.width).toBeGreaterThan(0);
          expect(r.x).toBeLessThan(fold);
          expect(r.x + r.width).toBeGreaterThan(fold);
        }
      }),
    );
  });
});

describe('fold guide invariant', () => {
  // sheetInSignature is a depth inside a signature: 0 is always valid (the
  // outermost sheet of a 4pp signature), and large signatures nest much
  // deeper, so the range is generous rather than tied to any one UI cap.
  // gutter/creep match the sliders' own ranges (index.html: gutter 0-50 step
  // 1, creep 0-5 step 0.1), widened slightly since fast-check isn't bound to
  // the UI's step.
  const sheetGeometry = fc.record({
    sheetInSignature: fc.integer({ min: 0, max: 32 }),
    gutter: fc.double({ min: 0, max: 50, noNaN: true }),
    creep: fc.double({ min: 0, max: 5, noNaN: true }),
    sheetWidth: fc.double({ min: 72, max: 14400, noNaN: true }),
    sheetHeight: fc.double({ min: 72, max: 14400, noNaN: true }),
  });

  // The bug this guards: creep shifts an inner sheet's content slot inward by
  // `sheetInSignature * creep` (see computeSlotRects), and past a big enough
  // shift the slot's near-fold edge lands beyond the fold line itself —
  // exactly where the fixed-position dashed guide draws, printing the guide
  // over real content instead of the margin. Stated independently of
  // foldGuideCrossesContent's own arithmetic: recompute both slots' near-fold
  // edges directly against the fold line, rather than trusting the one
  // comparison the implementation happens to make.
  it('is flagged exactly when either content slot has crossed the fold line', () => {
    fc.assert(
      fc.property(sheetGeometry, ({ sheetInSignature, gutter, creep, sheetWidth, sheetHeight }) => {
        const { left, right } = computeSlotRects(sheetInSignature, gutter, creep, sheetWidth, sheetHeight);
        const fold = sheetWidth / 2;
        const crosses = left.x + left.width > fold || right.x < fold;

        expect(foldGuideCrossesContent(sheetInSignature, gutter, creep, sheetWidth, sheetHeight)).toBe(
          crosses,
        );
      }),
    );
  });

  // Baseline case must render exactly as before the fix: with no creep and no
  // gutter, every sheet's slot sits flush against the fold with no shift, so
  // the guide must never be suppressed. This is what keeps the fix a
  // suppression for the shifted case only, not a redesign of the mark.
  it('never flags any sheet when creep and gutter are both zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 32 }),
        fc.double({ min: 72, max: 14400, noNaN: true }),
        fc.double({ min: 72, max: 14400, noNaN: true }),
        (sheetInSignature, sheetWidth, sheetHeight) => {
          expect(foldGuideCrossesContent(sheetInSignature, 0, 0, sheetWidth, sheetHeight)).toBe(false);
        },
      ),
    );
  });

  // The exact scenario the bug report measured: A4 portrait imposed onto A4
  // landscape (the default sheet size), creep=1pt, sheetInSignature=1 already
  // overlaps the fold by 0.6pt.
  it('flags the reported case: creep=1pt, sheetInSignature=1, default sheet size', () => {
    expect(foldGuideCrossesContent(1, 0, 1)).toBe(true);
  });
});
