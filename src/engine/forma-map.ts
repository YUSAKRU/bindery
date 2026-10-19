import {
  computeSheetMapping,
  computeSignatureMappings,
  mirrorMapping,
  type SheetMapping,
} from './booklet-engine';
import type { Binding, BookletOptions } from './types';

/**
 * The physical book a stored set of booklet options produces: every page in
 * reading order as it comes out folded and gathered — inserted blanks and
 * padding blanks included — and, for each, the sheet, side and half it is
 * printed on.
 *
 * This re-derives the page order `makeBookletCore` builds inline (blank
 * insertion → separate-cover split → mod-4 padding → signatures → RTL mirror →
 * emission order). It uses only the engine's exported, pure mapping functions
 * and never touches PDF bytes. `forma-map.test.ts` holds it against the real
 * `makeBooklet` output (the oracle test), so the two cannot drift apart
 * unnoticed.
 */

export type PhysicalPageKind = 'page' | 'inserted-blank' | 'padding';

export interface PhysicalPage {
  /** 0-based source page index; null for a blank. */
  src: number | null;
  kind: PhysicalPageKind;
}

export type SheetSide = 'front' | 'back';
export type SheetHalf = 'left' | 'right';

export interface FormaSlot {
  part: 'block' | 'cover';
  /** 1-based emission order in the block's combined PDF; the cover is its own sheet 1. */
  printSheet: number;
  /** 1-based signature; 0 for the separate cover. */
  signature: number;
  /** 1 = the outermost sheet of its signature. */
  depth: number;
  side: SheetSide;
  /** The half as the sheet mapping defines it (before any long-edge rotation of the back). */
  slot: SheetHalf;
}

export interface FormaSheet {
  part: 'block' | 'cover';
  printSheet: number;
  signature: number;
  depth: number;
  /** Indices into `sequence`, [left, right]. */
  front: [number, number];
  back: [number, number];
}

export interface FormaSignature {
  /** 1-based. */
  index: number;
  firstSeq: number;
  lastSeq: number;
  sheets: number;
}

export interface FormaMap {
  binding: Binding;
  /** The book in reading order, as printed and folded. */
  sequence: PhysicalPage[];
  /** Parallel to `sequence`. */
  slots: FormaSlot[];
  /** Block sheets in emission (print) order. */
  sheets: FormaSheet[];
  /** The separate cover's single sheet, when there is one. */
  coverSheet: FormaSheet | null;
  signatures: FormaSignature[];
}

/**
 * Computes the physical book for `originalPages` source pages under `options`.
 * Returns null wherever `makeBooklet` would refuse the same input (separate
 * cover under 8 pages, a blank position outside the document, an invalid
 * signature size), so a reader can simply leave the signature view out.
 */
export function computeFormaMap(originalPages: number, options: BookletOptions = {}): FormaMap | null {
  if (!Number.isInteger(originalPages) || originalPages < 1) return null;
  const binding: Binding = options.binding === 'rtl' ? 'rtl' : 'ltr';
  const separateCover = options.separateCover ?? false;
  const insertBlankAfter = options.insertBlankAfter ?? [];
  for (const position of insertBlankAfter) {
    if (!Number.isInteger(position) || position < 0 || position > originalPages) return null;
  }
  if (separateCover && originalPages < 8) return null;

  // Logical order: source pages with the requested blanks in place.
  const sorted = [...insertBlankAfter].sort((a, b) => a - b);
  const logical: PhysicalPage[] = [];
  let insertPtr = 0;
  const blanksAt = (position: number): void => {
    while (insertPtr < sorted.length && sorted[insertPtr] === position) {
      logical.push({ src: null, kind: 'inserted-blank' });
      insertPtr += 1;
    }
  };
  blanksAt(0);
  for (let p = 1; p <= originalPages; p++) {
    logical.push({ src: p - 1, kind: 'page' });
    blanksAt(p);
  }

  // Separate cover: the logical order's first two and last two pages.
  const L = logical.length;
  const cover = separateCover ? [logical[0], logical[1], logical[L - 2], logical[L - 1]] : null;
  const block = separateCover ? logical.slice(2, L - 2) : logical.slice();
  while (block.length % 4 !== 0) block.push({ src: null, kind: 'padding' });
  const N = block.length;

  let signatures: SheetMapping[][];
  try {
    signatures = computeSignatureMappings(N, options.signatureSize);
  } catch {
    return null;
  }
  if (binding === 'rtl') signatures = signatures.map((s) => mirrorMapping(s));

  // Reading order: the cover wraps the block — its first two pages before it,
  // its last two after.
  const offset = cover ? 2 : 0;
  const sequence: PhysicalPage[] = cover
    ? [cover[0], cover[1], ...block, cover[2], cover[3]]
    : block;
  const blockSeq = (local: number): number => offset + local;
  const coverSeq = (local: number): number => (local < 2 ? local : offset + N + (local - 2));

  const slots: FormaSlot[] = new Array(sequence.length);
  const place = (
    sheet: SheetMapping,
    toSeq: (local: number) => number,
    meta: Omit<FormaSheet, 'front' | 'back'>,
  ): FormaSheet => {
    const out: FormaSheet = {
      ...meta,
      front: [toSeq(sheet.frontLeft), toSeq(sheet.frontRight)],
      back: [toSeq(sheet.backLeft), toSeq(sheet.backRight)],
    };
    const base = { part: meta.part, printSheet: meta.printSheet, signature: meta.signature, depth: meta.depth };
    slots[out.front[0]] = { ...base, side: 'front', slot: 'left' };
    slots[out.front[1]] = { ...base, side: 'front', slot: 'right' };
    slots[out.back[0]] = { ...base, side: 'back', slot: 'left' };
    slots[out.back[1]] = { ...base, side: 'back', slot: 'right' };
    return out;
  };

  const sheets: FormaSheet[] = [];
  const signatureInfo: FormaSignature[] = [];
  let start = 0;
  signatures.forEach((signature, s) => {
    // Depth is the sheet's nesting position; reverseSheetOrder changes only
    // the order the sheets are printed in, never where they sit in the fold.
    const entries = signature.map((sheet, depth) => ({ sheet, depth }));
    if (options.reverseSheetOrder) entries.reverse();
    for (const { sheet, depth } of entries) {
      sheets.push(
        place(sheet, blockSeq, {
          part: 'block',
          printSheet: sheets.length + 1,
          signature: s + 1,
          depth: depth + 1,
        }),
      );
    }
    const len = signature.length * 4;
    signatureInfo.push({ index: s + 1, firstSeq: blockSeq(start), lastSeq: blockSeq(start + len - 1), sheets: signature.length });
    start += len;
  });

  let coverSheet: FormaSheet | null = null;
  if (cover) {
    let mapping = computeSheetMapping(4);
    if (binding === 'rtl') mapping = mirrorMapping(mapping);
    coverSheet = place(mapping[0], coverSeq, { part: 'cover', printSheet: 1, signature: 0, depth: 1 });
  }

  return { binding, sequence, slots, sheets, coverSheet, signatures: signatureInfo };
}

/** The sheet a page of the book is printed on. */
export function sheetOfPage(map: FormaMap, seqIndex: number): FormaSheet | null {
  const slot = map.slots[seqIndex];
  if (!slot) return null;
  if (slot.part === 'cover') return map.coverSheet;
  return map.sheets[slot.printSheet - 1] ?? null;
}
