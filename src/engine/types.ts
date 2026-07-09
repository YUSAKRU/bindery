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
}

export interface BookletResult {
  originalPages: number;
  paddedPages: number;
  sheetsCount: number;
  paddingApplied: number;
  frontPdf: Uint8Array;
  backPdf: Uint8Array;
  combinedPdf: Uint8Array;
}
