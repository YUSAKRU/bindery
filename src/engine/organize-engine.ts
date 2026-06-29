import { PDFDocument } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';

export interface OrganizeResult {
  originalPageCount: number;
  pageCount: number;
  organizedPdf: Uint8Array;
}

/**
 * Rebuilds a PDF keeping only the pages listed in `pageOrder` (0-based
 * indices into the source document), in the given order. Covers delete,
 * reorder, and extract in one operation — pdf-lib's `copyPages` already
 * accepts arbitrary/partial/repeated index arrays.
 */
export async function organizePages(inputBytes: Uint8Array, pageOrder: number[]): Promise<OrganizeResult> {
  const { pageCount: originalPageCount } = await validatePdf(inputBytes);

  if (pageOrder.length === 0) {
    throw new BookletError('En az 1 sayfa kalmalı.');
  }

  for (const idx of pageOrder) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= originalPageCount) {
      throw new BookletError(
        `Geçersiz sayfa indeksi: ${idx}. 0 ile ${originalPageCount - 1} arasında olmalı.`,
      );
    }
  }

  const srcDoc = await PDFDocument.load(inputBytes);
  const outDoc = await PDFDocument.create();
  const copiedPages = await outDoc.copyPages(srcDoc, pageOrder);
  copiedPages.forEach((page) => outDoc.addPage(page));

  const organizedPdf = await outDoc.save();

  return { originalPageCount, pageCount: copiedPages.length, organizedPdf };
}
