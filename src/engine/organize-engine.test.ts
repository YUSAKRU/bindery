import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { organizePages } from './organize-engine';
import { BookletError } from './types';

async function buildTestPdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of sizes) {
    doc.addPage(size).pushOperators();
  }
  return doc.save();
}

describe('organizePages', () => {
  it('keeps only the requested pages, in the requested order', async () => {
    // 5 pages, each a distinct size so we can verify identity by dimensions.
    const sizes: Array<[number, number]> = [
      [100, 900],
      [200, 800],
      [300, 700],
      [400, 600],
      [500, 500],
    ];
    const input = await buildTestPdf(sizes);

    // Keep pages 3, 0, 4 (0-based) in that order — covers delete + reorder + extract at once.
    const result = await organizePages(input, [3, 0, 4]);

    expect(result.originalPageCount).toBe(5);
    expect(result.pageCount).toBe(3);

    const outDoc = await PDFDocument.load(result.organizedPdf);
    expect(outDoc.getPageCount()).toBe(3);
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
    expect(outDoc.getPage(1).getSize()).toEqual({ width: 100, height: 900 });
    expect(outDoc.getPage(2).getSize()).toEqual({ width: 500, height: 500 });
  });

  it('rejects an empty page order', async () => {
    const input = await buildTestPdf([[595, 842]]);
    await expect(organizePages(input, [])).rejects.toBeInstanceOf(BookletError);
  });

  it('rejects an out-of-bounds index (>= pageCount)', async () => {
    const input = await buildTestPdf([[595, 842], [595, 842]]);
    await expect(organizePages(input, [0, 2])).rejects.toBeInstanceOf(BookletError);
  });

  it('rejects a negative index', async () => {
    const input = await buildTestPdf([[595, 842]]);
    await expect(organizePages(input, [-1])).rejects.toBeInstanceOf(BookletError);
  });

  it('allows duplicate indices (same page repeated)', async () => {
    const input = await buildTestPdf([[100, 200], [300, 400]]);
    const result = await organizePages(input, [0, 0, 1]);
    expect(result.pageCount).toBe(3);
  });
});
