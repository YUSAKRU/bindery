import { PDFDocument } from 'pdf-lib';
import { loadAndValidatePdf } from './validator';
import { BookletError } from './types';
import { runInPdfWorker } from './worker-client';

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
 * Core implementation of merging multiple PDFs into a single PDF.
 */
export async function mergePdfsCore(inputs: MergeInput[]): Promise<MergeResult> {
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

/**
 * Merges multiple PDFs, running in a Web Worker when available.
 */
export async function mergePdfs(inputs: MergeInput[]): Promise<MergeResult> {
  return runInPdfWorker(
    'mergePdfs',
    { inputs },
    () => mergePdfsCore(inputs),
  );
}
