import * as pdfjsLib from 'pdfjs-dist/build/pdf.min.mjs';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist/types/src/display/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Tracks the loading task behind each proxy so destroyThumbnailDoc() can
// call loadingTask.destroy() — the only path that fully releases worker
// and document-level resources.
const loadingTasks = new WeakMap<PDFDocumentProxy, PDFDocumentLoadingTask>();

/**
 * Parses a PDF for rendering — keep the returned proxy around to render multiple
 * pages cheaply.
 *
 * The `.slice()` is required, not defensive. pdf.js posts the array's buffer to
 * its worker in the transfer list (`sendWithPromise("GetDocRequest", …, [data.buffer])`
 * in pdfjs-dist), and a transferred ArrayBuffer is detached in the sender — the
 * caller's `Uint8Array` would silently become length 0. Every caller here keeps
 * its bytes for the actual PDF operation afterwards, so the copy stays.
 *
 * Callers must NOT slice again on their way in: this one copy already protects
 * them, and a second one costs another full file's worth of memory.
 */
export async function loadPdfForThumbnails(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: bytes.slice() });
  const proxy = await task.promise;
  loadingTasks.set(proxy, task);
  return proxy;
}

/**
 * Releases all worker and document-level resources held by a proxy returned
 * from `loadPdfForThumbnails`. Call this whenever the proxy is no longer needed
 * (e.g., when resetting a feature panel that owns the proxy).
 */
export async function destroyThumbnailDoc(proxy: PDFDocumentProxy): Promise<void> {
  const task = loadingTasks.get(proxy);
  if (task) {
    loadingTasks.delete(proxy);
    await task.destroy();
  }
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
  const dataUrl = canvas.toDataURL('image/png');
  page.cleanup();
  return dataUrl;
}
