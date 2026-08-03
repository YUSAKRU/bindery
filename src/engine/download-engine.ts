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
      throw new NetworkError(`İstek zaman aşımına uğradı (${DOWNLOAD_TIMEOUT_MS / 1000} saniye).`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new NetworkError(`Ağ bağlantısı kurulamadı veya URL geçersiz: ${message}`);
  }

  if (!response.ok) {
    throw new NetworkError(`Sunucu hata kodu döndürdü: ${response.status} ${response.statusText}`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > DOWNLOAD_SIZE_LIMIT_BYTES) {
      throw new NetworkError(
      `Dosya boyutu çok büyük (limit: ${DOWNLOAD_SIZE_LIMIT_BYTES / (1024 * 1024)} MB).`,
    );
    }
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/')) {
    throw new NetworkError(`URL geçerli bir PDF döndürmüyor (Content-Type: ${contentType}).`);
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PDFCorruptedError(`Dosya verisi indirilirken hata oluştu: ${message}`);
  }

  if (buffer.byteLength > DOWNLOAD_SIZE_LIMIT_BYTES) {
    throw new NetworkError(
      `Dosya boyutu çok büyük (limit: ${DOWNLOAD_SIZE_LIMIT_BYTES / (1024 * 1024)} MB).`,
    );
  }

  const bytes = new Uint8Array(buffer);

  // Validate the downloaded bytes to make sure it's a valid PDF.
  await validatePdf(bytes);

  return bytes;
}
