import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addPageNumbers, computeTextPosition, formatPageLabel } from './page-numbers-engine';
import { BookletError } from './types';

async function buildTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([300, 400]).pushOperators();
  }
  return doc.save();
}

describe('formatPageLabel', () => {
  it('formats a plain number', () => {
    expect(formatPageLabel('number', 5, 12)).toBe('5');
  });

  it('formats a number-of-total label', () => {
    expect(formatPageLabel('number-of-total', 5, 12)).toBe('Sayfa 5 / 12');
  });
});

describe('computeTextPosition', () => {
  const pageWidth = 300;
  const pageHeight = 400;
  const textWidth = 20;
  const fontSize = 10;
  const margin = 24;

  it('bottom-right anchors to the bottom-right corner', () => {
    expect(computeTextPosition('bottom-right', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 256,
      y: 24,
    });
  });

  it('bottom-left anchors to the bottom-left corner', () => {
    expect(computeTextPosition('bottom-left', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 24,
      y: 24,
    });
  });

  it('bottom-center centers horizontally at the bottom', () => {
    expect(computeTextPosition('bottom-center', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 140,
      y: 24,
    });
  });

  it('top-right anchors to the top-right corner', () => {
    expect(computeTextPosition('top-right', pageWidth, pageHeight, textWidth, fontSize, margin)).toEqual({
      x: 256,
      y: 366,
    });
  });
});

describe('addPageNumbers', () => {
  it('preserves page count while adding numbers', async () => {
    const input = await buildTestPdf(3);
    const result = await addPageNumbers(input, { position: 'bottom-right', format: 'number', startNumber: 1 });

    expect(result.pageCount).toBe(3);

    const outDoc = await PDFDocument.load(result.numberedPdf);
    expect(outDoc.getPageCount()).toBe(3);
    expect(outDoc.getPage(0).getSize()).toEqual({ width: 300, height: 400 });
  });

  it('rejects a non-positive start number', async () => {
    const input = await buildTestPdf(2);
    await expect(
      addPageNumbers(input, { position: 'bottom-right', format: 'number', startNumber: 0 }),
    ).rejects.toBeInstanceOf(BookletError);
  });
});
