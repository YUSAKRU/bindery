import { PDFDocument } from 'pdf-lib';
import { BookletError } from './types';

export interface ImagePageInput {
  bytes: Uint8Array;
  format: 'png' | 'jpg';
}

/**
 * Compiles a sequence of images into a single PDF document.
 * Each image is scaled proportionally to fit on a vertical A4 page (595.28 x 841.89 pt).
 */
export async function imagesToPdf(images: ImagePageInput[]): Promise<Uint8Array> {
  if (images.length === 0) {
    throw new BookletError('PDF oluşturmak için en az bir görsel eklemelisiniz.');
  }

  try {
    const pdfDoc = await PDFDocument.create();

    for (const imgData of images) {
      let embedImg;
      if (imgData.format === 'png') {
        embedImg = await pdfDoc.embedPng(imgData.bytes);
      } else {
        embedImg = await pdfDoc.embedJpg(imgData.bytes);
      }

      const { width, height } = embedImg.scale(1);

      // Standard A4 dimensions in points (72 points/inch)
      const a4Width = 595.28;
      const a4Height = 841.89;

      const page = pdfDoc.addPage([a4Width, a4Height]);

      // Calculate scale factor to fit A4 layout proportionally
      const scaleFactor = Math.min(a4Width / width, a4Height / height);
      const finalWidth = width * scaleFactor;
      const finalHeight = height * scaleFactor;

      // Center the image on the page
      const x = (a4Width - finalWidth) / 2;
      const y = (a4Height - finalHeight) / 2;

      page.drawImage(embedImg, {
        x,
        y,
        width: finalWidth,
        height: finalHeight,
      });
    }

    return await pdfDoc.save();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BookletError(`Görseller PDF'e dönüştürülemedi: ${message}`);
  }
}
