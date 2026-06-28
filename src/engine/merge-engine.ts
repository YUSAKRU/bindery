import { PDFDocument } from 'pdf-lib';
import { validatePdf } from './validator';
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
    throw new BookletError('En az 2 PDF seçmelisiniz.');
  }

  const mergedDoc = await PDFDocument.create();
  let pageCount = 0;

  for (const input of inputs) {
    await validatePdf(input.bytes);
    const srcDoc = await PDFDocument.load(input.bytes);
    const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    copiedPages.forEach((page) => mergedDoc.addPage(page));
    pageCount += copiedPages.length;
  }

  const mergedPdf = await mergedDoc.save();

  return { fileCount: inputs.length, pageCount, mergedPdf };
}
