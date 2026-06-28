import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { computeSheetMapping, makeBooklet } from './booklet-engine';

async function buildTestPdf(pageCount: number, size: [number, number] = [595, 842]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    // pushOperators() forces a (possibly empty) Contents stream to exist,
    // which embedPdf() requires of every source page.
    doc.addPage(size).pushOperators();
  }
  return doc.save();
}

describe('computeSheetMapping', () => {
  // Worked example from docs/SPECIFICATION.md: 16-page document, sheet 1
  // (1-based) -> Front: page16(left)|page1(right), Back: page2(left)|page15(right)
  it('matches the documented 16-page example for sheet 1', () => {
    const sheets = computeSheetMapping(16);
    expect(sheets).toHaveLength(4);
    expect(sheets[0]).toEqual({ frontLeft: 15, frontRight: 0, backLeft: 1, backRight: 14 });
  });

  it('covers every page index exactly once across front+back slots', () => {
    const N = 24;
    const sheets = computeSheetMapping(N);
    const used = sheets.flatMap((s) => [s.frontLeft, s.frontRight, s.backLeft, s.backRight]);
    expect(used.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
  });

  it('produces N/4 sheets', () => {
    expect(computeSheetMapping(8)).toHaveLength(2);
    expect(computeSheetMapping(20)).toHaveLength(5);
  });
});

describe('makeBooklet', () => {
  it('pads a non-multiple-of-4 page count up to the next multiple of 4', async () => {
    const input = await buildTestPdf(10);
    const result = await makeBooklet(input);
    expect(result.originalPages).toBe(10);
    expect(result.paddingApplied).toBe(2);
    expect(result.paddedPages).toBe(12);
    expect(result.sheetsCount).toBe(3);
  });

  it('applies no padding when the page count is already a multiple of 4', async () => {
    const input = await buildTestPdf(16);
    const result = await makeBooklet(input);
    expect(result.paddingApplied).toBe(0);
    expect(result.paddedPages).toBe(16);
    expect(result.sheetsCount).toBe(4);
  });

  it('produces front/back PDFs with one page per sheet', async () => {
    const input = await buildTestPdf(8);
    const result = await makeBooklet(input);
    const frontDoc = await PDFDocument.load(result.frontPdf);
    const backDoc = await PDFDocument.load(result.backPdf);
    expect(frontDoc.getPageCount()).toBe(result.sheetsCount);
    expect(backDoc.getPageCount()).toBe(result.sheetsCount);
  });
});
