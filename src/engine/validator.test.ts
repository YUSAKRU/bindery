import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { validatePdf } from './validator';
import { InvalidPDFPageError, PDFCorruptedError, PDFEncryptedError } from './types';

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

  it('rejects an encrypted PDF with PDFEncryptedError', async () => {
    // pdf-lib v1.17.1 does not support creating encrypted PDFs via save().
    // This is a minimal hand-crafted PDF with an /Encrypt dictionary in its trailer,
    // which causes pdf-lib to throw its encrypted-document error on load.
    const ENCRYPTED_PDF_B64 =
      'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nIC9QYWdlcyAyIDAgUj4+CmVuZG9iagoyIDAgb2JqCjw8' +
      'L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlIC9QYWdl' +
      'IC9QYXJlbnQgMiAwIFIgL01lZGlhQm94IFswIDAgNjEyIDc5Ml0+PgplbmRvYmoKNCAwIG9iago8PC9GaWx0ZXIg' +
      'L1N0YW5kYXJkIC9WIDEgL1IgMiAvTyA8MjhCRjRFNUU0RTc1OEE0MTY0MDA0RTU2RkZGQTAxMDgyRTJFMDBCNkQw' +
      'NjgzRTgwMkYwQ0E5RkU2NDUzNjk3QT4gL1UgPDI4QkY0RTVFNEVBNThBNDE2NDAwNEU1NkZGRkEwMTA4MkUyRTAw' +
      'QjZEMDY4M0U4MDJGMENBOUZFNjQ1MzY5N0E+IC9QIC00Pj4KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1' +
      'MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAK' +
      'MDAwMDAwMDE5NCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNSAvUm9vdCAxIDAgUiAvRW5jcnlwdCA0IDAgUj4+' +
      'CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=';
    const binary = atob(ENCRYPTED_PDF_B64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    await expect(validatePdf(bytes)).rejects.toBeInstanceOf(PDFEncryptedError);
  });
});
