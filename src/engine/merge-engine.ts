import { PDFDocument } from 'pdf-lib';
import { loadAndValidatePdf } from './validator';
import { BookletError } from './types';

export interface MergeInput {
  name: string;
  bytes: Uint8Array;
}

export interface MergeResult {
  fileCount: number;
  pageCount: number;
  mergedPdf: Uint8Array;
}

/**
 * Merges multiple PDFs, in the given order, into a single PDF. Uses
 * `copyPages` (not page embedding) so the merged document's pages stay
 * independent/editable rather than flattened form XObjects.
 */
export async function mergePdfs(inputs: MergeInput[]): Promise<MergeResult> {
  if (inputs.length < 2) {
    throw new BookletError('MERGE_MIN_FILES', undefined, 'You must select at least 2 PDFs.');
  }

  const mergedDoc = await PDFDocument.create();
  let pageCount = 0;

  for (const input of inputs) {
    const { doc: srcDoc } = await loadAndValidatePdf(input.bytes);
    const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    copiedPages.forEach((page) => mergedDoc.addPage(page));
    pageCount += copiedPages.length;
  }

  const mergedPdf = await mergedDoc.save();

  return { fileCount: inputs.length, pageCount, mergedPdf };
}
