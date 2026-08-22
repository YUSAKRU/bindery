import { PDFDocument } from 'pdf-lib';
import { loadAndValidatePdf } from './validator';
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
  const { doc: srcDoc, metadata: { pageCount: originalPageCount } } = await loadAndValidatePdf(inputBytes);

  if (pageOrder.length === 0) {
    throw new BookletError('ORGANIZE_MIN_PAGES', undefined, 'At least 1 page must remain.');
  }

  for (const idx of pageOrder) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= originalPageCount) {
      const max = originalPageCount - 1;
      throw new BookletError(
        'ORGANIZE_INVALID_PAGE_INDEX',
        { index: idx, max },
        `Invalid page index: ${idx}. Must be between 0 and ${max}.`,
      );
    }
  }

  const outDoc = await PDFDocument.create();
  const copiedPages = await outDoc.copyPages(srcDoc, pageOrder);
  copiedPages.forEach((page) => outDoc.addPage(page));

  const organizedPdf = await outDoc.save();

  return { originalPageCount, pageCount: copiedPages.length, organizedPdf };
}
