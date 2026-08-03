import { validatePdf } from './validator';
import { NetworkError, PDFCorruptedError } from './types';

export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const DOWNLOAD_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;

/**
 * Fetches a PDF file from a remote URL, validates that it is a valid
 * unencrypted PDF, and returns its raw bytes.
 */
export async function downloadPdfFromUrl(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      const seconds = DOWNLOAD_TIMEOUT_MS / 1000;
      throw new NetworkError(
        'DOWNLOAD_TIMEOUT',
        { seconds },
        `Request timed out after ${seconds} seconds.`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new NetworkError(
      'DOWNLOAD_NETWORK_ERROR',
      { message },
      `Could not connect or the URL is invalid: ${message}`,
    );
  }

  if (!response.ok) {
    throw new NetworkError(
      'DOWNLOAD_SERVER_ERROR',
      { status: response.status, statusText: response.statusText },
      `Server returned an error: ${response.status} ${response.statusText}`,
    );
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > DOWNLOAD_SIZE_LIMIT_BYTES) {
      const limitMb = DOWNLOAD_SIZE_LIMIT_BYTES / (1024 * 1024);
      throw new NetworkError(
        'DOWNLOAD_FILE_TOO_LARGE',
        { limitMb },
        `File is too large (limit: ${limitMb} MB).`,
      );
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/')) {
    throw new NetworkError(
      'DOWNLOAD_NOT_A_PDF',
      { contentType },
      `The URL did not return a valid PDF (Content-Type: ${contentType}).`,
    );
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFCorruptedError(
      'DOWNLOAD_READ_ERROR',
      { message },
      `An error occurred while downloading the file data: ${message}`,
    );
  }

  if (buffer.byteLength > DOWNLOAD_SIZE_LIMIT_BYTES) {
    const limitMb = DOWNLOAD_SIZE_LIMIT_BYTES / (1024 * 1024);
    throw new NetworkError(
      'DOWNLOAD_FILE_TOO_LARGE',
      { limitMb },
      `File is too large (limit: ${limitMb} MB).`,
    );
  }

  const bytes = new Uint8Array(buffer);

  // Validate the downloaded bytes to make sure it's a valid PDF.
  await validatePdf(bytes);

  return bytes;
}
