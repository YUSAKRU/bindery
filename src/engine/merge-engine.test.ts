import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { mergePdfs } from './merge-engine';
import { BookletError } from './types';

async function buildTestPdf(pageCount: number, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    // pushOperators() forces a Contents stream to exist, required by copyPages/embedPdf.
    doc.addPage(size).pushOperators();
  }
  return doc.save();
}

describe('mergePdfs', () => {
  it('merges multiple PDFs in the given order, summing page counts', async () => {
    const a = await buildTestPdf(3);
    const b = await buildTestPdf(2);
    const c = await buildTestPdf(4);

    const result = await mergePdfs([
      { name: 'a.pdf', bytes: a },
      { name: 'b.pdf', bytes: b },
      { name: 'c.pdf', bytes: c },
    ]);

    expect(result.fileCount).toBe(3);
    expect(result.pageCount).toBe(9);

    const mergedDoc = await PDFDocument.load(result.mergedPdf);
    expect(mergedDoc.getPageCount()).toBe(9);
  });

  it('respects input order when merging', async () => {
    const wide = await buildTestPdf(1, [800, 400]);
    const tall = await buildTestPdf(1, [400, 800]);

    const result = await mergePdfs([
      { name: 'wide.pdf', bytes: wide },
      { name: 'tall.pdf', bytes: tall },
    ]);

    const mergedDoc = await PDFDocument.load(result.mergedPdf);
    expect(mergedDoc.getPage(0).getSize()).toEqual({ width: 800, height: 400 });
    expect(mergedDoc.getPage(1).getSize()).toEqual({ width: 400, height: 800 });
  });

  it('rejects fewer than 2 inputs', async () => {
    const a = await buildTestPdf(2);
    await expect(mergePdfs([{ name: 'a.pdf', bytes: a }])).rejects.toBeInstanceOf(BookletError);
  });
});
