import { BookletError } from './types';

let workerInstance: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  {
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }
>();

export function isWorkerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof (window as unknown as { Worker: unknown }).Worker === 'function' &&
    !(globalThis as unknown as { __IS_PDF_WORKER__?: boolean }).__IS_PDF_WORKER__
  );
}

export function getPdfWorker(): Worker | null {
  if (!isWorkerSupported()) return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (event: MessageEvent) => {
        const { id, success, result, error } = event.data;
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);

        if (success) {
          pending.resolve(result);
        } else {
          const err = new BookletError(
            error.code ?? 'WORKER_ERROR',
            error.params,
            error.message,
          );
          if (error.name) err.name = error.name;
          pending.reject(err);
        }
      };
      workerInstance.onerror = (evt: ErrorEvent) => {
        console.error('PDF Worker error:', evt);
        const failureErr = new BookletError('WORKER_CRASH', undefined, evt.message || 'Worker error');
        for (const [, pending] of pendingRequests) {
          pending.reject(failureErr);
        }
        pendingRequests.clear();
        terminatePdfWorker();
      };
    } catch (e) {
      console.warn('Could not instantiate PDF Web Worker, falling back to main thread:', e);
      workerInstance = null;
    }
  }
  return workerInstance;
}

export function terminatePdfWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  pendingRequests.clear();
}

export async function runInPdfWorker<T>(
  type: string,
  payload: any,
  fallbackFn: () => Promise<T>,
): Promise<T> {
  const worker = getPdfWorker();
  if (!worker) {
    return fallbackFn();
  }

  const id = nextRequestId++;
  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, type, payload });
    } catch (postErr) {
      pendingRequests.delete(id);
      console.warn('Failed to postMessage to PDF worker, running fallback:', postErr);
      fallbackFn().then(resolve, reject);
    }
  });
}
