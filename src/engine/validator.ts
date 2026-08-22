import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import {
  InvalidPDFPageError,
  PDFCorruptedError,
  PDFEncryptedError,
} from './types';
import type { PdfMetadata } from './types';

export interface ValidatedPdf {
  doc: PDFDocument;
  metadata: PdfMetadata;
}

/**
 * Loads and validates an in-memory PDF before imposition: rejects
 * encrypted/DRM documents, corrupted files, and empty page sets. Returns the
 * loaded document alongside its metadata for callers that need to read or
 * mutate pages, so they don't have to parse the same bytes a second time.
 */
export async function loadAndValidatePdf(bytes: Uint8Array): Promise<ValidatedPdf> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    // pdf-lib v1.17.1: EncryptedPDFError does not properly extend Error, so instanceof
    // checks fail at runtime. Check both instanceof and the message string as a fallback.
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof EncryptedPDFError || message.includes('is encrypted')) {
      throw new PDFEncryptedError('PDF_ENCRYPTED', undefined, 'The PDF file is encrypted or DRM-protected.');
    }
    throw new PDFCorruptedError(
      'PDF_CORRUPTED',
      { message },
      `PDF file is corrupted or could not be read: ${message}`,
    );
  }

  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new InvalidPDFPageError('PDF_NO_PAGES', undefined, 'The PDF file contains no pages.');
  }

  const pageSizes: Array<[number, number]> = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [width, height];
  });

  return { doc, metadata: { pageCount, pageSizes } };
}

/** Metadata-only validation, for callers that never need the loaded document. */
export async function validatePdf(bytes: Uint8Array): Promise<PdfMetadata> {
  return (await loadAndValidatePdf(bytes)).metadata;
}
