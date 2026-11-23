import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { makeBooklet } from './booklet-engine';
import { computeFormaMap, sheetOfPage, type FormaMap, type FormaSheet } from './forma-map';
import type { BookletOptions } from './types';

/** Book page numbers (1-based positions in the sequence) of a sheet's four halves. */
function bookNumbers(sheet: FormaSheet): { front: [number, number]; back: [number, number] } {
  return {
    front: [sheet.front[0] + 1, sheet.front[1] + 1],
    back: [sheet.back[0] + 1, sheet.back[1] + 1],
  };
}

function mapOf(pages: number, options: BookletOptions = {}): FormaMap {
  const map = computeFormaMap(pages, options);
  if (!map) throw new Error('expected a forma map');
  return map;
}

describe('computeFormaMap — worked examples', () => {
  it('16 pages, one signature: the outer sheet carries 16|1 on the front and 2|15 on the back', () => {
    const map = mapOf(16);
    expect(map.sheets).toHaveLength(4);
    expect(bookNumbers(map.sheets[0])).toEqual({ front: [16, 1], back: [2, 15] });
    expect(bookNumbers(map.sheets[3])).toEqual({ front: [10, 7], back: [8, 9] });
    expect(map.sheets.map((s) => s.depth)).toEqual([1, 2, 3, 4]);
    expect(map.signatures).toEqual([{ index: 1, firstSeq: 0, lastSeq: 15, sheets: 4 }]);
  });

  it('56 pages at 16 per signature are balanced 16/16/12/12, as the engine does', () => {
    const map = mapOf(56, { signatureSize: 16 });
    expect(map.signatures.map((s) => s.sheets * 4)).toEqual([16, 16, 12, 12]);
    expect(map.signatures.map((s) => [s.firstSeq, s.lastSeq])).toEqual([
      [0, 15],
      [16, 31],
      [32, 43],
      [44, 55],
    ]);
    expect(map.sheets).toHaveLength(14);
  });

  it('a blank inserted after position 0 is the first page of the book', () => {
    const map = mapOf(7, { insertBlankAfter: [0] });
    expect(map.sequence[0]).toEqual({ src: null, kind: 'inserted-blank' });
    expect(map.sequence[1]).toEqual({ src: 0, kind: 'page' });
    expect(map.sequence).toHaveLength(8);
  });

  it('a separate cover holds source pages 1, 2, 9, 10 and the block is padded to 8', () => {
    const map = mapOf(10, { separateCover: true });
    expect(map.coverSheet).not.toBeNull();
    const cover = map.coverSheet!;
    const srcAt = (i: number) => map.sequence[i].src;
    expect([cover.front, cover.back].flat().map(srcAt).sort()).toEqual([0, 1, 8, 9]);
    // Front of the cover: back cover on the left, front cover on the right.
    expect(cover.front.map(srcAt)).toEqual([9, 0]);
    // Reading order wraps the block: 2 cover pages, 6 pages + 2 padding, 2 cover pages.
    expect(map.sequence.map((p) => p.kind)).toEqual([
      'page', 'page', 'page', 'page', 'page', 'page', 'page', 'page', 'padding', 'padding', 'page', 'page',
    ]);
    expect(map.sheets).toHaveLength(2);
    expect(map.slots[0]).toMatchObject({ part: 'cover', signature: 0, side: 'front', slot: 'right' });
  });

  it('right-to-left binding swaps every half of every sheet', () => {
    const ltr = mapOf(24, { signatureSize: 8 });
    const rtl = mapOf(24, { signatureSize: 8, binding: 'rtl' });
    expect(rtl.sheets.map((s) => [s.front, s.back])).toEqual(
      ltr.sheets.map((s) => [[s.front[1], s.front[0]], [s.back[1], s.back[0]]]),
    );
    expect(rtl.sequence).toEqual(ltr.sequence);
  });

  it('reverseSheetOrder reverses print order inside each signature only; depth stays', () => {
    const plain = mapOf(24, { signatureSize: 8 });
    const reversed = mapOf(24, { signatureSize: 8, reverseSheetOrder: true });
    const bySig = (m: FormaMap, sig: number) => m.sheets.filter((s) => s.signature === sig);
    for (const sig of [1, 2, 3]) {
      expect(bySig(reversed, sig).map((s) => s.front)).toEqual(bySig(plain, sig).map((s) => s.front).reverse());
      expect(bySig(reversed, sig).map((s) => s.depth)).toEqual([2, 1]);
    }
    expect(reversed.sheets.map((s) => s.signature)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(reversed.sheets.map((s) => s.printSheet)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('refuses what the engine refuses: a short separate cover, a blank past the end, a bad signature size', () => {
    expect(computeFormaMap(7, { separateCover: true })).toBeNull();
    expect(computeFormaMap(8, { separateCover: true })).not.toBeNull();
    expect(computeFormaMap(10, { insertBlankAfter: [11] })).toBeNull();
    expect(computeFormaMap(10, { insertBlankAfter: [10] })).not.toBeNull();
    expect(computeFormaMap(10, { signatureSize: 6 })).toBeNull();
    expect(computeFormaMap(0)).toBeNull();
  });

  it('sheetOfPage finds the sheet a page sits on, cover included', () => {
    const map = mapOf(10, { separateCover: true });
    expect(sheetOfPage(map, 0)).toBe(map.coverSheet);
    const sheet = sheetOfPage(map, 2)!;
    expect([...sheet.front, ...sheet.back]).toContain(2);
  });
});

describe('computeFormaMap — invariants', () => {
  const scenario = fc.integer({ min: 1, max: 80 }).chain((pages) =>
    fc.record({
      pages: fc.constant(pages),
      separateCover: fc.boolean(),
      insertBlankAfter: fc.array(fc.integer({ min: 0, max: pages }), { maxLength: 5 }),
      signatureSize: fc.oneof(
        fc.constant(undefined),
        fc.constant('auto' as const),
        fc.integer({ min: 1, max: 8 }).map((n) => n * 4),
      ),
      binding: fc.constantFrom('ltr' as const, 'rtl' as const),
      reverseSheetOrder: fc.boolean(),
    }),
  );

  it('the book holds every source page once, and blanks only as inserted or padding', () => {
    fc.assert(
      fc.property(scenario, ({ pages, ...options }) => {
        const map = computeFormaMap(pages, options);
        if (options.separateCover && pages < 8) {
          expect(map).toBeNull();
          return;
        }
        expect(map).not.toBeNull();
        const { sequence, slots } = map!;
        const srcs = sequence.filter((p) => p.kind === 'page').map((p) => p.src);
        expect(srcs).toEqual(Array.from({ length: pages }, (_, i) => i));
        for (const p of sequence) expect(p.src === null).toBe(p.kind !== 'page');
        expect(sequence.filter((p) => p.kind === 'inserted-blank')).toHaveLength(options.insertBlankAfter.length);
        // Every page of the book is on exactly one half of one sheet.
        const placed = [...map!.sheets, ...(map!.coverSheet ? [map!.coverSheet] : [])].flatMap((s) => [
          ...s.front,
          ...s.back,
        ]);
        expect([...placed].sort((a, b) => a - b)).toEqual(sequence.map((_, i) => i));
        expect(slots.filter(Boolean)).toHaveLength(sequence.length);
      }),
    );
  });
});

// The oracle: forma-map re-derives the engine's page order, so it is checked
// against what makeBooklet actually prints. Each source page carries a unique
// MARK_<i>; pdf.js (independent of pdf-lib, which the engine draws with) reads
// the produced sheets back, and the marker's x position says which half of the
// sheet it landed on. If either side's order logic changes, this goes red.
describe('computeFormaMap — oracle against makeBooklet', () => {
  async function buildMarkedPdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < pageCount; i++) {
      const page = doc.addPage([200, 280]);
      page.drawText(`MARK_${i}`, { x: 20, y: 140, size: 14, font });
    }
    return doc.save();
  }

  type Halves = { left: number | null; right: number | null };

  /** Per produced page, the marker found left and right of the fold. */
  async function readHalves(pdfBytes: Uint8Array): Promise<Halves[]> {
    const loadingTask = getDocument({ data: pdfBytes });
    const out: Halves[] = [];
    try {
      const pdf = await loadingTask.promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const mid = page.view[2] / 2;
        const halves: Halves = { left: null, right: null };
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!('str' in item)) continue;
          const match = /MARK_(\d+)/.exec(item.str);
          if (!match) continue;
          const side = item.transform[4] < mid ? 'left' : 'right';
          expect(halves[side], `page ${i} ${side} holds two markers`).toBeNull();
          halves[side] = Number(match[1]);
        }
        out.push(halves);
      }
    } finally {
      await loadingTask.destroy();
    }
    return out;
  }

  function expected(map: FormaMap, pair: [number, number]): Halves {
    return { left: map.sequence[pair[0]].src, right: map.sequence[pair[1]].src };
  }

  async function check(pages: number, options: BookletOptions, longEdge = false): Promise<void> {
    const map = computeFormaMap(pages, options);
    expect(map).not.toBeNull();
    const result = await makeBooklet(await buildMarkedPdf(pages), options);
    expect(result.signaturesCount).toBe(map!.signatures.length);
    expect(result.sheetsCount).toBe(map!.sheets.length);
    expect(result.paddingApplied).toBe(map!.sequence.filter((p) => p.kind === 'padding').length);

    const swap = (h: Halves): Halves => (longEdge ? { left: h.right, right: h.left } : h);
    const block = await readHalves(result.combinedPdf);
    expect(block).toHaveLength(map!.sheets.length * 2);
    map!.sheets.forEach((sheet, k) => {
      expect(block[2 * k], `sheet ${k + 1} front`).toEqual(expected(map!, sheet.front));
      expect(block[2 * k + 1], `sheet ${k + 1} back`).toEqual(swap(expected(map!, sheet.back)));
    });
    if (map!.coverSheet) {
      expect(result.coverPdf).toBeDefined();
      const cover = await readHalves(result.coverPdf!);
      expect(cover[0], 'cover front').toEqual(expected(map!, map!.coverSheet.front));
      expect(cover[1], 'cover back').toEqual(swap(expected(map!, map!.coverSheet.back)));
    } else {
      expect(result.coverPdf).toBeUndefined();
    }
  }

  const scenario = fc.integer({ min: 4, max: 40 }).chain((raw) =>
    fc.boolean().chain((separateCover) => {
      const pages = separateCover && raw < 8 ? 8 : raw;
      return fc.record({
        pages: fc.constant(pages),
        separateCover: fc.constant(separateCover),
        insertBlankAfter: fc.array(fc.integer({ min: 0, max: pages }), { maxLength: 4 }),
        signatureSize: fc.oneof(
          fc.constant(undefined),
          fc.constant('auto' as const),
          fc.integer({ min: 1, max: 4 }).map((n) => n * 4),
        ),
        binding: fc.constantFrom('ltr' as const, 'rtl' as const),
        reverseSheetOrder: fc.boolean(),
      });
    }),
  );

  it(
    'puts every page on the same sheet, side and half as makeBooklet (short-edge flip)',
    async () => {
      // Two fixed cases that every run covers, then generated ones.
      await check(10, { separateCover: true, insertBlankAfter: [3], binding: 'rtl', reverseSheetOrder: true, signatureSize: 4 });
      await check(23, { signatureSize: 8, binding: 'rtl' });
      await fc.assert(
        fc.asyncProperty(scenario, async ({ pages, ...options }) => {
          await check(pages, { ...options, flipEdge: 'short' });
        }),
        { numRuns: 15 },
      );
    },
    60_000,
  );

  it(
    'with long-edge flip the back is turned half a turn, so its halves trade places — the map stays logical',
    async () => {
      await check(12, { flipEdge: 'long', separateCover: true, signatureSize: 4 }, true);
    },
    30_000,
  );
});
