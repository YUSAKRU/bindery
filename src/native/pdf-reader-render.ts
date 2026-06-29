import * as pdfjsLib from 'pdfjs-dist/build/pdf.min.mjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export interface ReaderDocument {
  proxy: PDFDocumentProxy;
  destroy(): Promise<void>;
}

const MAX_RENDER_SCALE = 2;

// Keyed by page number so same-page re-renders cancel the stale task without
// affecting concurrent renders of other pages (e.g. IntersectionObserver prefetch).
const activeRenderTasks = new Map<number, RenderTask>();

/**
 * Opens a PDF for full-resolution reading. Unlike `pdf-thumbnails.ts`,
 * this keeps the loading task (not just the resolved proxy) — pdf.js's
 * `PDFDocumentProxy` has no `destroy()` of its own; only the loading task
 * does, and skipping it leaks worker/document memory across opens.
 */
export async function openReaderDocument(bytes: Uint8Array): Promise<ReaderDocument> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const proxy = await loadingTask.promise;
  return { proxy, destroy: () => loadingTask.destroy() };
}

export interface RenderedPage {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
}

// Inverts CSS colors to soft dark mode equivalents (backgrounds become dark gray, text becomes off-white).
function invertColor(colorStr: any): any {
  if (typeof colorStr !== 'string') return colorStr;
  
  const trimmed = colorStr.trim().toLowerCase();
  let r = 0, g = 0, b = 0, hasAlpha = false, a = '1';
  
  if (trimmed.startsWith('#')) {
    const hex = trimmed.substring(1);
    if (hex.length === 3) {
      r = parseInt(hex[0], 16) * 17;
      g = parseInt(hex[1], 16) * 17;
      b = parseInt(hex[2], 16) * 17;
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else {
      return colorStr;
    }
  } else {
    const rgbMatch = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (rgbMatch) {
      r = parseInt(rgbMatch[1], 10);
      g = parseInt(rgbMatch[2], 10);
      b = parseInt(rgbMatch[3], 10);
      if (rgbMatch[4] !== undefined) {
        hasAlpha = true;
        a = rgbMatch[4];
      }
    } else {
      return colorStr;
    }
  }
  
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  let newR = 255 - r;
  let newG = 255 - g;
  let newB = 255 - b;
  
  // Soft dark surface background for pure/near white
  if (luminance > 0.92) {
    newR = 24;  // #181818
    newG = 24;
    newB = 24;
  }
  // Soft light text color for pure/near black
  else if (luminance < 0.08) {
    newR = 228; // #e4e4e4
    newG = 228;
    newB = 228;
  }
  
  if (hasAlpha) {
    return `rgba(${newR}, ${newG}, ${newB}, ${a})`;
  }
  return `rgb(${newR}, ${newG}, ${newB})`;
}

// Proxies a CanvasRenderingContext2D to intercept color-drawing calls and apply soft inversion.
function createSmartDarkContext(originalCtx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  return new Proxy(originalCtx, {
    get(target, prop) {
      // Omit the receiver: native CanvasRenderingContext2D accessors
      // (e.g. `canvas`, `fillStyle`) throw "Illegal invocation" if invoked
      // with the Proxy as `this` instead of the real context.
      const value = Reflect.get(target, prop);

      if (typeof value === 'function') {
        // Draw image directly in original colors!
        if (prop === 'drawImage') {
          return function(...args: any[]) {
            return target.drawImage.apply(target, args as any);
          };
        }
        
        // Wrap gradients to invert color stops
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return function(...args: any[]) {
            const gradient = (target as any)[prop].apply(target, args);
            return new Proxy(gradient, {
              get(gTarget, gProp) {
                const gValue = Reflect.get(gTarget, gProp);
                if (gProp === 'addColorStop' && typeof gValue === 'function') {
                  return function(offset: number, color: string) {
                    return gValue.call(gTarget, offset, invertColor(color));
                  };
                }
                return typeof gValue === 'function' ? gValue.bind(gTarget) : gValue;
              }
            });
          };
        }
        
        return value.bind(target);
      }
      return value;
    },
    set(target, prop, value) {
      if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'shadowColor') {
        const inverted = invertColor(value);
        return Reflect.set(target, prop, inverted);
      }
      return Reflect.set(target, prop, value);
    }
  }) as any;
}

/** Renders a single page (1-based) into a wrapper div containing the canvas and a selectable text layer. */
export async function renderReaderPage(
  proxy: PDFDocumentProxy,
  pageNumber: number,
  widthPx: number,
  nightMode: boolean = false,
): Promise<RenderedPage> {
  // Cancel any stale render of THIS page before starting a fresh one. Renders of
  // other page numbers are left untouched (concurrent prefetch must not be disrupted).
  const prevTask = activeRenderTasks.get(pageNumber);
  if (prevTask) prevTask.cancel();

  const page = await proxy.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
  const scale = (widthPx / baseViewport.width) * pixelRatio;
  const viewport = page.getViewport({ scale });

  // CSS viewport scale (for text layer alignment)
  const cssScale = widthPx / baseViewport.width;
  const cssViewport = page.getViewport({ scale: cssScale });

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page-wrapper';
  wrapper.style.position = 'relative';
  wrapper.style.width = `${widthPx}px`;
  wrapper.style.height = `${widthPx * (baseViewport.height / baseViewport.width)}px`;
  wrapper.style.background = nightMode ? '#181818' : '#ffffff';

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.display = 'block';
  canvas.style.background = nightMode ? '#181818' : '#ffffff';

  wrapper.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d canvas context');

  // Always pass canvasContext explicitly so pdfjs uses it directly for drawing.
  // In night mode the proxy intercepts color calls; both modes avoid the
  // canvas:null workaround that was not part of the documented pdfjs v6 contract.
  const renderTask = page.render({
    canvas,
    canvasContext: nightMode ? createSmartDarkContext(ctx) : ctx,
    viewport,
  });
  activeRenderTasks.set(pageNumber, renderTask);
  try {
    await renderTask.promise;
  } finally {
    if (activeRenderTasks.get(pageNumber) === renderTask) activeRenderTasks.delete(pageNumber);
    page.cleanup();
  }

  // Create text layer
  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  const pageHeight = Math.round(widthPx * (baseViewport.height / baseViewport.width));
  textLayerDiv.style.position = 'absolute';
  textLayerDiv.style.left = '0';
  textLayerDiv.style.top = '0';
  textLayerDiv.style.width = `${widthPx}px`;
  textLayerDiv.style.height = `${pageHeight}px`;

  wrapper.appendChild(textLayerDiv);

  try {
    const textContent = await page.getTextContent();
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: cssViewport,
    });
    await textLayer.render();
  } catch (error) {
    console.error('Failed to render text layer:', error);
  }

  return { wrapper, canvas };
}

