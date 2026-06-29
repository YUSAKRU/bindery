import { PDFDocument, StandardFonts } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';

export type PageNumberPosition = 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left' | 'top-center';
export type PageNumberFormat = 'number' | 'number-of-total';

export interface PageNumberOptions {
  position: PageNumberPosition;
  format: PageNumberFormat;
  startNumber: number;
  pageWord?: string;
}

export interface PageNumberResult {
  pageCount: number;
  numberedPdf: Uint8Array;
}

const FONT_SIZE = 10;
const MARGIN = 24;

export function formatPageLabel(
  format: PageNumberFormat,
  pageNumber: number,
  totalPages: number,
  pageWord = 'Sayfa',
): string {
  return format === 'number' ? `${pageNumber}` : `${pageWord} ${pageNumber} / ${totalPages}`;
}

export function computeTextPosition(
  position: PageNumberPosition,
  pageWidth: number,
  pageHeight: number,
  textWidth: number,
  fontSize: number,
  margin: number,
): { x: number; y: number } {
  switch (position) {
    case 'bottom-left':
      return { x: margin, y: margin };
    case 'bottom-center':
      return { x: (pageWidth - textWidth) / 2, y: margin };
    case 'top-left':
      return { x: margin, y: pageHeight - margin - fontSize };
    case 'top-center':
      return { x: (pageWidth - textWidth) / 2, y: pageHeight - margin - fontSize };
    case 'top-right':
      return { x: pageWidth - margin - textWidth, y: pageHeight - margin - fontSize };
    case 'bottom-right':
    default:
      return { x: pageWidth - margin - textWidth, y: margin };
  }
}

export async function addPageNumbers(inputBytes: Uint8Array, options: PageNumberOptions): Promise<PageNumberResult> {
  const { pageCount } = await validatePdf(inputBytes);

  if (!Number.isInteger(options.startNumber) || options.startNumber < 1) {
    throw new BookletError('Başlangıç numarası 1 veya daha büyük bir tam sayı olmalı.');
  }

  const doc = await PDFDocument.load(inputBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lastNumber = options.startNumber + pageCount - 1;

  doc.getPages().forEach((page, i) => {
    const label = formatPageLabel(options.format, options.startNumber + i, lastNumber, options.pageWord);
    const textWidth = font.widthOfTextAtSize(label, FONT_SIZE);
    const { width, height } = page.getSize();
    const { x, y } = computeTextPosition(options.position, width, height, textWidth, FONT_SIZE, MARGIN);
    page.drawText(label, { x, y, size: FONT_SIZE, font });
  });

  const numberedPdf = await doc.save();

  return { pageCount, numberedPdf };
}
