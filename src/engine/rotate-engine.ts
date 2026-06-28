import { degrees, PDFDocument } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';

export interface RotateResult {
  pageCount: number;
  rotatedPdf: Uint8Array;
}

/** Sets each page's absolute rotation (0/90/180/270) to the matching entry in `angles`. */
export async function rotatePages(inputBytes: Uint8Array, angles: number[]): Promise<RotateResult> {
  const { pageCount } = await validatePdf(inputBytes);

  if (angles.length !== pageCount) {
    throw new BookletError('Sayfa sayısı uyuşmuyor.');
  }

  const doc = await PDFDocument.load(inputBytes);
  doc.getPages().forEach((page, i) => page.setRotation(degrees(angles[i])));

  const rotatedPdf = await doc.save();

  return { pageCount, rotatedPdf };
}
