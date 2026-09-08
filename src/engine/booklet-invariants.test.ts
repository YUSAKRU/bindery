import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeCollationMarkRect,
  computeSignatureMappings,
  computeSlotRects,
  foldGuideCrossesContent,
  makeBooklet,
} from './booklet-engine';
import type { BookletOptions } from './types';

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
  //
  // count goes up to 300 (not just 120): signatureSize 8 on a 1600+ page
  // document — theses, scanned archives — really does reach 200 signatures,
  // where the A4 band (547 / 200 = 2.735pt) is well past the cap (36pt) and
  // deep into the near-flush-collapse regime the 0.4.6-polish legibility
  // warning exists for (see COLLATION_BAR_LEGIBILITY_FLOOR in
  // booklet-engine.ts). The range below still covers band > cap (few, large
  // signatures) at the low end.
  const spine = fc.record({
    sheetWidth: fc.double({ min: 72, max: 14400, noNaN: true }),
    sheetHeight: fc.double({ min: 72, max: 14400, noNaN: true }),
    count: fc.integer({ min: 1, max: 300 }),
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

  // Crossing the fold (above) says the bar straddles both halves; this says
  // WHERE exactly — dead centre, not merely somewhere that overlaps both
  // sides. A bar shifted a point off-centre would still satisfy the crossing
  // property above but would print an uneven mark on the folded spine.
  it('centres the bar exactly on the fold line', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        for (let i = 0; i < count; i++) {
          const r = computeCollationMarkRect(i, count, sheetWidth, sheetHeight);
          expect(near(r.x + r.width / 2, sheetWidth / 2)).toBe(true);
        }
      }),
    );
  });

  // The neighbour-clearance property above only says a bar does not overlap
  // the NEXT bar; it would still pass if a bar drifted into a band two steps
  // away while staying clear of its immediate neighbour. This pins the bar to
  // its OWN band's y-range directly.
  it('keeps the bar within its own band, not just clear of its neighbours', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        const band = (sheetHeight - 2 * MARGIN) / count;
        for (let i = 0; i < count; i++) {
          const r = computeCollationMarkRect(i, count, sheetWidth, sheetHeight);
          const bandBottom = sheetHeight - MARGIN - (i + 1) * band;
          const bandTop = bandBottom + band;
          expect(r.y >= bandBottom || near(r.y, bandBottom)).toBe(true);
          const top = r.y + r.height;
          expect(top <= bandTop || near(top, bandTop)).toBe(true);
        }
      }),
    );
  });

  // signaturesCount <= 0 is not a value the UI can produce, but the function
  // clamps it (`Math.max(1, signaturesCount)`) rather than rejecting it —
  // guard that the clamp actually lands on the single-signature case instead
  // of leaking a zero/negative band count into NaN or negative geometry.
  it('clamps signaturesCount <= 0 to behave exactly like a single signature', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50, max: 0 }),
        fc.double({ min: 72, max: 14400, noNaN: true }),
        fc.double({ min: 72, max: 14400, noNaN: true }),
        (nonPositiveCount, sheetWidth, sheetHeight) => {
          const clamped = computeCollationMarkRect(0, nonPositiveCount, sheetWidth, sheetHeight);
          const single = computeCollationMarkRect(0, 1, sheetWidth, sheetHeight);
          expect(clamped).toEqual(single);
        },
      ),
    );
  });

  // Cheap, but guards against an accidental source of non-determinism (e.g. a
  // Date.now() or Math.random() creeping into the geometry) going unnoticed.
  it('is deterministic: identical inputs produce identical rects', () => {
    fc.assert(
      fc.property(spine, ({ sheetWidth, sheetHeight, count }) => {
        for (let i = 0; i < count; i++) {
          const a = computeCollationMarkRect(i, count, sheetWidth, sheetHeight);
          const b = computeCollationMarkRect(i, count, sheetWidth, sheetHeight);
          expect(a).toEqual(b);
        }
      }),
    );
  });

  // "shrinks the bar to its band once the band is thinner than the cap"
  // (computeCollationMarkRect describe block, above) shows this happens at
  // one hand-picked count. This pins the transition BY NAME across the whole
  // domain: once the band no longer exceeds the cap, the bar fills the band
  // completely, so consecutive bars sit exactly flush — zero gap. The
  // generator below derives count from a target band <= CAP rather than
  // filtering `spine` with fc.pre, so every generated case actually lands in
  // the flush regime instead of being discarded.
  it('sits consecutive bars exactly flush once the band no longer exceeds the cap', () => {
    const CAP = 36; // mirrors COLLATION_BAR_MAX_HEIGHT (booklet-engine.ts); not exported
    const flushSpine = fc
      .record({
        sheetWidth: fc.double({ min: 72, max: 14400, noNaN: true }),
        sheetHeight: fc.double({ min: 72, max: 14400, noNaN: true }),
        extra: fc.integer({ min: 0, max: 50 }),
      })
      .map(({ sheetWidth, sheetHeight, extra }) => {
        const usable = sheetHeight - 2 * MARGIN;
        // The smallest count that already puts the band at or under the cap,
        // plus a few more so the flush case is exercised at various depths.
        const minCount = Math.max(1, Math.ceil(usable / CAP));
        return { sheetWidth, sheetHeight, count: minCount + extra };
      });

    fc.assert(
      fc.property(flushSpine, ({ sheetWidth, sheetHeight, count }) => {
        const rects = Array.from({ length: count }, (_, i) =>
          computeCollationMarkRect(i, count, sheetWidth, sheetHeight),
        );
        for (let i = 0; i + 1 < rects.length; i++) {
          const floor = rects[i + 1].y + rects[i + 1].height;
          expect(near(rects[i].y, floor)).toBe(true);
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

describe('makeBooklet content-flow invariant', () => {
  // computeSignatureMappings, above, is only the innermost step. makeBooklet
  // layers three more transformations on top of it — blank insertion
  // (insertBlankAfter), cover splitting (separateCover pulls the logical
  // order's first/last 2 pages into a separate sheet), and mod-4 blank
  // padding — none of which are exercised by the invariants above. Rather
  // than trust the engine's own page-index bookkeeping (which is exactly what
  // could be wrong), this stamps each source page with a unique text marker
  // and reads back the ACTUAL rendered text of the produced PDF with pdf.js —
  // a library entirely independent of pdf-lib, which the engine itself uses
  // to build the PDF. A page genuinely dropped or duplicated in the output
  // shows up here even if every internal counter still adds up.

  /** A pageCount-page PDF where page i (0-based) carries the unique marker `MARK_<i>`. */
  async function buildMarkedTestPdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pageCount; i++) {
      const page = doc.addPage([200, 280]);
      page.drawText(`MARK_${i}`, { x: 20, y: 140, size: 14, font });
    }
    return doc.save();
  }

  /** All `MARK_<n>` markers found in the PDF's rendered text, across every page. */
  async function extractMarks(pdfBytes: Uint8Array): Promise<number[]> {
    const loadingTask = getDocument({ data: pdfBytes });
    const marks: number[] = [];
    try {
      const pdfDoc = await loadingTask.promise;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map((item) => ('str' in item ? item.str : '')).join('');
        for (const match of text.matchAll(/MARK_(\d+)/g)) {
          marks.push(Number(match[1]));
        }
      }
    } finally {
      await loadingTask.destroy();
    }
    return marks;
  }

  // originalPageCount is deliberately NOT constrained to a multiple of 4 here
  // (unlike `pageCount` above) — makeBooklet's own mod-4 padding is one of the
  // transformations under test, so the input must be free to land on either
  // side of that boundary. separateCover needs >=8 original pages (the engine
  // throws BOOKLET_COVER_MIN_PAGES otherwise), so a `true` draw bumps a
  // too-small count up to 8 rather than being discarded.
  const scenario = fc.integer({ min: 4, max: 40 }).chain((rawPageCount) =>
    fc.boolean().chain((separateCover) => {
      const originalPageCount = separateCover && rawPageCount < 8 ? 8 : rawPageCount;
      return fc.record({
        originalPageCount: fc.constant(originalPageCount),
        separateCover: fc.constant(separateCover),
        insertBlankAfter: fc.array(fc.integer({ min: 0, max: originalPageCount }), { maxLength: 6 }),
        signatureSize,
      });
    }),
  );

  it(
    'renders every original page exactly once, however it pads, covers, or inserts blanks',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          scenario,
          async ({ originalPageCount, separateCover, insertBlankAfter, signatureSize }) => {
            const inputBytes = await buildMarkedTestPdf(originalPageCount);
            const options: BookletOptions = { separateCover, insertBlankAfter, signatureSize };
            const result = await makeBooklet(inputBytes, options);

            // combinedPdf carries every book-block page (front+back interleaved);
            // coverPdf, when present, carries the 4 pages split off from it. Together
            // they are the entirety of what makeBooklet produced from the source.
            const producedPdfs = [result.combinedPdf, result.coverPdf].filter(
              (pdf): pdf is Uint8Array => pdf !== undefined,
            );
            const allMarks: number[] = [];
            for (const pdf of producedPdfs) {
              allMarks.push(...(await extractMarks(pdf)));
            }

            const counts = new Map<number, number>();
            for (const mark of allMarks) counts.set(mark, (counts.get(mark) ?? 0) + 1);

            for (let n = 0; n < originalPageCount; n++) {
              expect(counts.get(n)).toBe(1);
            }
            // No marker beyond the source range, and no ghost duplicates counted
            // under a foreign key - the exact-count checks above only look inward.
            expect(counts.size).toBe(originalPageCount);
          },
        ),
        { numRuns: 15 },
      );
    },
    60_000,
  );
});
