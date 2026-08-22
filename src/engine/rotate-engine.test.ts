import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { rotatePages } from './rotate-engine';
import { BookletError } from './types';

async function buildTestPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([300, 400]).pushOperators();
  }
  return doc.save();
}

describe('rotatePages', () => {
  it('sets each page rotation to the matching absolute angle', async () => {
    const input = await buildTestPdf(3);
    const result = await rotatePages(input, [90, 180, 270]);

    expect(result.pageCount).toBe(3);

    const outDoc = await PDFDocument.load(result.rotatedPdf);
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);
    expect(outDoc.getPage(1).getRotation().angle).toBe(180);
    expect(outDoc.getPage(2).getRotation().angle).toBe(270);
  });

  it('rejects an angle array whose length does not match the page count', async () => {
    const input = await buildTestPdf(2);
    await expect(rotatePages(input, [90])).rejects.toBeInstanceOf(BookletError);
  });

  it('rejects a non-standard angle (e.g. 45°)', async () => {
    const input = await buildTestPdf(1);
    await expect(rotatePages(input, [45])).rejects.toBeInstanceOf(BookletError);
  });

  it('accepts 0° as an identity rotation', async () => {
    const input = await buildTestPdf(1);
    const result = await rotatePages(input, [0]);
    const outDoc = await PDFDocument.load(result.rotatedPdf);
    expect(outDoc.getPage(0).getRotation().angle).toBe(0);
  });
});
