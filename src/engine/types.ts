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
}

export interface BookletResult {
  originalPages: number;
  paddedPages: number;
  sheetsCount: number;
  paddingApplied: number;
  /** Number of signatures the document was split into (1 for a single booklet). */
  signaturesCount: number;
  frontPdf: Uint8Array;
  backPdf: Uint8Array;
  combinedPdf: Uint8Array;
}
