import * as pdfjsLib from 'pdfjs-dist/build/pdf.min.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/** Parses a PDF for rendering — keep the returned proxy around to render multiple pages cheaply. */
export async function loadPdfForThumbnails(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data: bytes }).promise;
}

/** Renders a single page (1-based `pageNumber`) to a small PNG data URL. */
export async function renderPageThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
  maxWidth = 96,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = maxWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL('image/png');
}
