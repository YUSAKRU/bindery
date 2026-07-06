import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
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

/**
 * Normalizes a page rotation angle (which pdf-lib returns verbatim from the
 * /Rotate entry, e.g. it may be negative or >360) to one of 0/90/180/270.
 */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const normalized = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  return normalized as 0 | 90 | 180 | 270;
}

/**
 * Converts a position expressed in "visible" (post-rotation, as seen by a
 * viewer) coordinates into the page's actual unrotated content-space
 * coordinates. A page's /Rotate entry does not transform its content stream
 * coordinate system - it tells viewers to rotate the whole rendered page
 * clockwise for display. So text drawn "upright" at (x, y) with no local
 * rotation will itself appear rotated on screen for a rotated page, and its
 * anchor point maps to a different on-screen location than (x, y). This
 * inverts that clockwise display transform so a caller can reason purely in
 * terms of where the text should visually end up.
 */
export function toContentSpacePosition(
  visibleX: number,
  visibleY: number,
  visibleWidth: number,
  visibleHeight: number,
  rotation: number,
): { x: number; y: number } {
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: visibleHeight - visibleY, y: visibleX };
    case 180:
      return { x: visibleWidth - visibleX, y: visibleHeight - visibleY };
    case 270:
      return { x: visibleY, y: visibleWidth - visibleX };
    case 0:
    default:
      return { x: visibleX, y: visibleY };
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

    const mediaBox = page.getMediaBox();
    const { width, height } = page.getSize();
    const rotation = normalizeRotation(page.getRotation().angle);
    const isSideways = rotation === 90 || rotation === 270;
    const visibleWidth = isSideways ? height : width;
    const visibleHeight = isSideways ? width : height;

    const { x: visibleX, y: visibleY } = computeTextPosition(
      options.position,
      visibleWidth,
      visibleHeight,
      textWidth,
      FONT_SIZE,
      MARGIN,
    );
    const { x: localX, y: localY } = toContentSpacePosition(visibleX, visibleY, visibleWidth, visibleHeight, rotation);

    page.drawText(label, {
      x: mediaBox.x + localX,
      y: mediaBox.y + localY,
      size: FONT_SIZE,
      font,
      rotate: degrees(rotation),
    });
  });

  const numberedPdf = await doc.save();

  return { pageCount, numberedPdf };
}
