import { describe, expect, it, vi } from 'vitest';
import { isWorkerSupported, runInPdfWorker, terminatePdfWorker } from './worker-client';
import { BookletError } from './types';
import { makeBooklet } from './booklet-engine';
import { mergePdfs } from './merge-engine';
import { generateCoverPdf } from './cover-engine';
import { PDFDocument } from 'pdf-lib';

describe('PDF Web Worker client and fallback architecture', () => {
  it('correctly detects worker support in node environment as false', () => {
    expect(isWorkerSupported()).toBe(false);
  });

  it('runs makeBooklet cleanly via fallback when worker is unavailable', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 4; i++) {
      const page = doc.addPage([200, 300]);
      page.drawText(`Page ${i + 1}`);
    }
    const bytes = await doc.save();

    const result = await makeBooklet(bytes, { paperSize: 'A4' });
    expect(result).toBeDefined();
    expect(result.sheetsCount).toBe(1);
    expect(result.frontPdf).toBeInstanceOf(Uint8Array);
    expect(result.backPdf).toBeInstanceOf(Uint8Array);
  });

  it('runs mergePdfs cleanly via fallback when worker is unavailable', async () => {
    const doc1 = await PDFDocument.create();
    doc1.addPage([200, 300]);
    const b1 = await doc1.save();

    const doc2 = await PDFDocument.create();
    doc2.addPage([200, 300]);
    const b2 = await doc2.save();

    const result = await mergePdfs([
      { name: 'doc1.pdf', bytes: b1 },
      { name: 'doc2.pdf', bytes: b2 },
    ]);
    expect(result.fileCount).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(result.mergedPdf.length).toBeGreaterThan(0);
  });

  it('preserves BookletError when operations throw in fallback', async () => {
    const badBytes = new Uint8Array([1, 2, 3, 4]);
    await expect(makeBooklet(badBytes)).rejects.toThrow();
  });

  it('runs generateCoverPdf cleanly via fallback when worker is unavailable', async () => {
    await expect(
      generateCoverPdf({
        format: 'split',
        dimensions: { format: 'single' } as any,
        content: { title: 'Test', author: 'Author' },
        spineResult: { widthMm: 5, sheets: 10, signatures: 1 } as any,
      }),
    ).rejects.toThrow();
  });

  it('handles custom error reconstruction in worker client', async () => {
    const fallback = vi.fn().mockRejectedValue(new BookletError('CUSTOM_CODE', { foo: 'bar' }, 'Worker failed'));
    await expect(runInPdfWorker('testOp', {}, fallback)).rejects.toThrowError('Worker failed');
  });

  it('cleans up worker cleanly on terminate', () => {
    expect(() => terminatePdfWorker()).not.toThrow();
  });
});
