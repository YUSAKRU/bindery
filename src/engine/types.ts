export class BookletError extends Error {}
export class PDFCorruptedError extends BookletError {}
export class PDFEncryptedError extends BookletError {}
export class InvalidPDFPageError extends BookletError {}
export class NetworkError extends BookletError {}

export interface PdfMetadata {
  pageCount: number;
  pageSizes: Array<[number, number]>;
}

export interface BookletOptions {
  gutter?: number;
  creep?: number;
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
