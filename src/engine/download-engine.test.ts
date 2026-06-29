import { describe, expect, it, vi } from 'vitest';
import { downloadPdfFromUrl } from './download-engine';
import { NetworkError, PDFCorruptedError } from './types';
import { PDFDocument } from 'pdf-lib';

describe('downloadPdfFromUrl', () => {
  it('successfully downloads and validates a valid PDF', async () => {
    // Generate valid PDF bytes
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const pdfBytes = await doc.save();

    // Mock fetch response
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'content-type' ? 'application/pdf' : null },
      arrayBuffer: async () => pdfBytes.buffer,
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const result = await downloadPdfFromUrl('https://example.com/test.pdf');
    expect(result).toEqual(pdfBytes);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/test.pdf');

    fetchSpy.mockRestore();
  });

  it('throws NetworkError when fetch fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection timed out'));

    await expect(downloadPdfFromUrl('https://example.com/test.pdf')).rejects.toBeInstanceOf(NetworkError);

    fetchSpy.mockRestore();
  });

  it('throws NetworkError when server returns non-200 status', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(downloadPdfFromUrl('https://example.com/test.pdf')).rejects.toBeInstanceOf(NetworkError);

    fetchSpy.mockRestore();
  });

  it('throws PDFCorruptedError when downloaded data is corrupted', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(downloadPdfFromUrl('https://example.com/test.pdf')).rejects.toBeInstanceOf(PDFCorruptedError);

    fetchSpy.mockRestore();
  });

  it('throws NetworkError when Content-Type is text/html', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'content-type' ? 'text/html; charset=utf-8' : null },
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(downloadPdfFromUrl('https://example.com/test.pdf')).rejects.toBeInstanceOf(NetworkError);

    fetchSpy.mockRestore();
  });

  it('accepts a response with content-type application/octet-stream', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const pdfBytes = await doc.save();

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (name: string) => name === 'content-type' ? 'application/octet-stream' : null },
      arrayBuffer: async () => pdfBytes.buffer,
    } as unknown as Response;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await expect(downloadPdfFromUrl('https://example.com/file.pdf')).resolves.toBeDefined();

    fetchSpy.mockRestore();
  });
});
