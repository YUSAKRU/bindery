/**
 * Dedicated Web Worker for offloading CPU-intensive pdf-lib operations
 * (booklet imposition, PDF merge, cover generation, page transformations).
 *
 * Runs completely isolated in a worker thread without DOM or Canvas access.
 */

// Tag globalThis so engines know we are executing inside the worker
(globalThis as unknown as { __IS_PDF_WORKER__?: boolean }).__IS_PDF_WORKER__ = true;

import { inspectPdfCore, makeBookletCore } from './booklet-engine';
import { mergePdfsCore } from './merge-engine';
import { generateCoverPdfCore } from './cover-engine';
import { organizePages } from './organize-engine';
import { rotatePages } from './rotate-engine';
import { addWatermark } from './watermark-engine';
import { addPageNumbers } from './page-numbers-engine';
import { imagesToPdf } from './image-to-pdf-engine';

export interface WorkerRequest {
  id: number;
  type: string;
  payload: any;
}

export interface WorkerSuccessResponse {
  id: number;
  success: true;
  result: any;
}

export interface WorkerErrorResponse {
  id: number;
  success: false;
  error: {
    message: string;
    name?: string;
    code?: string;
    params?: Record<string, unknown>;
  };
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    let result: any;
    const transferables: Transferable[] = [];

    switch (type) {
      case 'makeBooklet': {
        result = await makeBookletCore(payload.pdfBytes, payload.options);
        if (result.frontPdf?.buffer instanceof ArrayBuffer) transferables.push(result.frontPdf.buffer);
        if (result.backPdf?.buffer instanceof ArrayBuffer) transferables.push(result.backPdf.buffer);
        if (result.combinedPdf?.buffer instanceof ArrayBuffer) transferables.push(result.combinedPdf.buffer);
        if (result.coverPdf?.buffer instanceof ArrayBuffer) transferables.push(result.coverPdf.buffer);
        if (result.instructionsPdf?.buffer instanceof ArrayBuffer) transferables.push(result.instructionsPdf.buffer);
        break;
      }
      case 'inspectPdf': {
        result = await inspectPdfCore(payload.pdfBytes);
        break;
      }
      case 'mergePdfs': {
        result = await mergePdfsCore(payload.inputs);
        if (result.mergedPdf?.buffer instanceof ArrayBuffer) transferables.push(result.mergedPdf.buffer);
        break;
      }
      case 'generateCoverPdf': {
        result = await generateCoverPdfCore(payload.options);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      case 'organizePages': {
        result = await organizePages(payload.pdfBytes, payload.pageIndices);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      case 'rotatePages': {
        result = await rotatePages(payload.pdfBytes, payload.rotations);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      case 'addWatermark': {
        result = await addWatermark(payload.pdfBytes, payload.options);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      case 'addPageNumbers': {
        result = await addPageNumbers(payload.pdfBytes, payload.options);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      case 'imagesToPdf': {
        result = await imagesToPdf(payload.images);
        if (result?.buffer instanceof ArrayBuffer) transferables.push(result.buffer);
        break;
      }
      default:
        throw new Error(`Unknown worker operation: ${type}`);
    }

    const response: WorkerSuccessResponse = { id, success: true, result };
    (self as unknown as Worker).postMessage(response, transferables);
  } catch (err: unknown) {
    const errorObj = err as { message?: string; name?: string; code?: string; params?: Record<string, unknown> };
    const response: WorkerErrorResponse = {
      id,
      success: false,
      error: {
        message: errorObj.message ?? String(err),
        name: errorObj.name ?? 'Error',
        code: errorObj.code,
        params: errorObj.params,
      },
    };
    (self as unknown as Worker).postMessage(response);
  }
};
