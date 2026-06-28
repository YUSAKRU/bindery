import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import {
  InvalidPDFPageError,
  PDFCorruptedError,
  PDFEncryptedError,
} from './types';
import type { PdfMetadata } from './types';

/**
 * Validates an in-memory PDF before imposition: rejects encrypted/DRM
 * documents, corrupted files, and empty page sets.
 */
export async function validatePdf(bytes: Uint8Array): Promise<PdfMetadata> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new PDFEncryptedError('The PDF file is encrypted or DRM-protected.');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFCorruptedError(`PDF file is corrupted or could not be read: ${message}`);
  }

  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new InvalidPDFPageError('The PDF file contains no pages.');
  }

  const pageSizes: Array<[number, number]> = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [width, height];
  });

  return { pageCount, pageSizes };
}
