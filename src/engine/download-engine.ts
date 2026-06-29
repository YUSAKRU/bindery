import { validatePdf } from './validator';
import { NetworkError, PDFCorruptedError } from './types';

/**
 * Fetches a PDF file from a remote URL, validates that it is a valid
 * unencrypted PDF, and returns its raw bytes.
 */
export async function downloadPdfFromUrl(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new NetworkError(`Ağ bağlantısı kurulamadı veya URL geçersiz: ${message}`);
  }

  if (!response.ok) {
    throw new NetworkError(`Sunucu hata kodu döndürdü: ${response.status} ${response.statusText}`);
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

  const bytes = new Uint8Array(buffer);

  // Validate the downloaded bytes to make sure it's a valid PDF.
  await validatePdf(bytes);

  return bytes;
}
