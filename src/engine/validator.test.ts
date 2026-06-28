import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { validatePdf } from './validator';
import { InvalidPDFPageError, PDFCorruptedError } from './types';

describe('validatePdf', () => {
  it('returns page count and sizes for a valid PDF', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const bytes = await doc.save();

    const metadata = await validatePdf(bytes);
    expect(metadata.pageCount).toBe(2);
    expect(metadata.pageSizes).toEqual([[595, 842], [595, 842]]);
  });

  it('rejects a PDF with no pages', async () => {
    const doc = await PDFDocument.create();
    // pdf-lib's save() injects a default page for 0-page docs unless told not to.
    const bytes = await doc.save({ addDefaultPage: false });
    await expect(validatePdf(bytes)).rejects.toBeInstanceOf(InvalidPDFPageError);
  });

  it('rejects corrupted/non-PDF bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(validatePdf(bytes)).rejects.toBeInstanceOf(PDFCorruptedError);
  });
});
