export class BookletError extends Error {}
export class PDFCorruptedError extends BookletError {}
export class PDFEncryptedError extends BookletError {}
export class InvalidPDFPageError extends BookletError {}
export class NetworkError extends BookletError {}

export interface PdfMetadata {
  pageCount: number;
  pageSizes: Array<[number, number]>;
}

export type FlipEdge = 'short' | 'long';

export type Binding = 'ltr' | 'rtl';

export type PaperSizePreset = 'A4' | 'Letter' | 'A5' | 'A3' | 'source';

/**
 * Physical (landscape) size of the printed sheet. Each half becomes one booklet
 * page. A named preset, `'source'` (derived from the document's mode page size),
 * or an explicit landscape `{ width, height }` in points.
 */
export type PaperSize = PaperSizePreset | { width: number; height: number };

export interface BookletOptions {
  gutter?: number;
  creep?: number;
  /**
   * Duplex flip edge of the printer. 'short' (default) matches short-edge
   * binding — the back sheet is laid out identically to the front. 'long'
   * compensates long-edge flipping by rotating the entire back composition
   * 180°, so the back content prints upright relative to the front.
   */
  flipEdge?: FlipEdge;
  /**
   * Physical sheet size to print on. Defaults to 'A4' (842×595pt landscape),
   * which reproduces the historical fixed output.
   */
  paperSize?: PaperSize;
  /**
   * Pages per signature — a signature is a group of sheets folded together.
   * A positive multiple of 4, or 'auto' (single signature up to 40 pages, else
   * 16-page signatures). Defaults to a single signature spanning the whole
   * document, reproducing the historical output.
   */
  signatureSize?: number | 'auto';
  /**
   * Binding direction. 'ltr' (default) places page 1 on the right of the first
   * sheet's front; 'rtl' mirrors every sheet for right-to-left books (Arabic,
   * Ottoman, manga).
   */
  binding?: Binding;
  /**
   * When true, the original first 2 + last 2 pages are imposed as a separate
   * cover sheet (returned as `coverPdf`) and excluded from the front/back/
   * combined book block. Requires at least 8 original pages. Default false.
   */
  separateCover?: boolean;
  /**
   * When true, an English single-page printing-instructions + reading-order
   * sheet is generated as `instructionsPdf`. The front/back/combined book PDFs
   * are unaffected. Default false.
   */
  includeInstructions?: boolean;
  /**
   * Positions, as 1-based ORIGINAL page numbers, after which to insert one blank
   * page (0 = before the first page). A value may repeat to insert multiple
   * blanks; order does not matter. Inserted blanks join the logical page order
   * before the cover split and padding, so they can deliberately land on a
   * chapter start or the inside of a cover. Default: none.
   */
  insertBlankAfter?: number[];
}

export interface BookletResult {
  originalPages: number;
  paddedPages: number;
  sheetsCount: number;
  paddingApplied: number;
  /** Number of user-requested blank pages inserted (separate from padding). */
  blanksInserted: number;
  /** Number of signatures the document was split into (1 for a single booklet). */
  signaturesCount: number;
  frontPdf: Uint8Array;
  backPdf: Uint8Array;
  combinedPdf: Uint8Array;
  /**
   * The cover sheet (2 pages: front + back), present only when `separateCover`
   * was requested. The book block PDFs above exclude these pages.
   */
  coverPdf?: Uint8Array;
  /**
   * A single-page English printing-instructions sheet, present only when
   * `includeInstructions` was requested.
   */
  instructionsPdf?: Uint8Array;
}
