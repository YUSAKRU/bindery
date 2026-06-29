import { PDFDocument, PDFEmbeddedPage, PDFPage } from 'pdf-lib';
import { validatePdf } from './validator';
import { BookletError } from './types';
import type { BookletOptions, BookletResult } from './types';

const TARGET_WIDTH = 842.0; // A4 landscape, points
const TARGET_HEIGHT = 595.0;

interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scales an embedded source page to fit inside `rect` while preserving its
 * aspect ratio, centering it within the rect — mirrors PyMuPDF's
 * `show_pdf_page(rect, ..., keep_proportion=True)` behaviour.
 */
function drawFitted(page: PDFPage, embedded: PDFEmbeddedPage, rect: FitRect): void {
  const scale = Math.min(rect.width / embedded.width, rect.height / embedded.height);
  const drawnWidth = embedded.width * scale;
  const drawnHeight = embedded.height * scale;
  const x = rect.x + (rect.width - drawnWidth) / 2;
  const y = rect.y + (rect.height - drawnHeight) / 2;
  page.drawPage(embedded, { x, y, width: drawnWidth, height: drawnHeight });
}

export interface SheetMapping {
  frontLeft: number;
  frontRight: number;
  backLeft: number;
  backRight: number;
}

/**
 * Computes the 0-based source page index for each slot of every sheet, for
 * a (already-padded) document of `N` pages. Pure arithmetic, ported 1:1
 * from engine.py's per-sheet index formulas — see SPECIFICATION.md for the
 * worked 16-page example this is verified against.
 */
export function computeSheetMapping(N: number): SheetMapping[] {
  const S = Math.floor(N / 4);
  const sheets: SheetMapping[] = [];
  for (let j = 0; j < S; j++) {
    sheets.push({
      frontLeft: N - 2 * j - 1,
      frontRight: 2 * j,
      backLeft: 2 * j + 1,
      backRight: N - 2 * j - 2,
    });
  }
  return sheets;
}

/**
 * Performs the booklet imposition: pads the source to a multiple of 4 pages,
 * then splits it into front/back A4-landscape sheets ready for duplex
 * printing and center folding.
 *
 * Page-mapping arithmetic and gutter/creep shift formulas are a direct port
 * of pdf_booklet/engine.py (BookletEngine.make_booklet) — kept numerically
 * identical so the two implementations always agree.
 */
export async function makeBooklet(
  inputBytes: Uint8Array,
  options: BookletOptions = {},
): Promise<BookletResult> {
  const baseGutter = options.gutter ?? 0;
  const creepStep = options.creep ?? 0;

  if (baseGutter < 0 || baseGutter >= TARGET_WIDTH / 2) {
    throw new BookletError(`Geçersiz gutter değeri: ${baseGutter}. 0 ile ${TARGET_WIDTH / 2} arasında olmalı.`);
  }
  if (creepStep < 0) {
    throw new BookletError('Creep değeri negatif olamaz.');
  }

  const { pageCount: originalPageCount } = await validatePdf(inputBytes);
  const srcDoc = await PDFDocument.load(inputBytes);

  const wSlot = TARGET_WIDTH / 2.0;
  const hSlot = TARGET_HEIGHT;

  // 1. Dynamic blank page padding so the page count is a multiple of 4.
  const remainder = originalPageCount % 4;
  let paddingApplied = 0;
  if (remainder !== 0) {
    paddingApplied = 4 - remainder;
    const lastPage = srcDoc.getPage(originalPageCount - 1);
    const { width: lastWidth, height: lastHeight } = lastPage.getSize();
    for (let i = 0; i < paddingApplied; i++) {
      const blankPage = srcDoc.addPage([lastWidth, lastHeight]);
      // pdf-lib only materializes a page's Contents stream once something is
      // drawn on it; embedPdf() requires Contents to exist, so force it here.
      blankPage.pushOperators();
    }
  }

  const N = srcDoc.getPageCount();
  const mapping = computeSheetMapping(N);
  const S = mapping.length;

  // 2. Flatten the per-sheet source page indices (0-based) for batch embedding.
  const frontIndices: number[] = [];
  const backIndices: number[] = [];
  for (const sheet of mapping) {
    frontIndices.push(sheet.frontLeft, sheet.frontRight);
    backIndices.push(sheet.backLeft, sheet.backRight);
  }

  const frontDoc = await PDFDocument.create();
  const backDoc = await PDFDocument.create();

  const frontEmbedded = await frontDoc.embedPdf(srcDoc, frontIndices);
  const backEmbedded = await backDoc.embedPdf(srcDoc, backIndices);

  // 3. Lay out each sheet, applying the gutter/creep inward shift.
  for (let j = 0; j < S; j++) {
    const creepShift = j * creepStep;
    const shiftInward = creepShift - baseGutter / 2.0;

    const leftRect: FitRect = { x: shiftInward, y: 0, width: wSlot, height: hSlot };
    const rightRect: FitRect = {
      x: wSlot - shiftInward,
      y: 0,
      width: wSlot,
      height: hSlot,
    };

    const frontPage = frontDoc.addPage([TARGET_WIDTH, TARGET_HEIGHT]);
    drawFitted(frontPage, frontEmbedded[2 * j], leftRect);
    drawFitted(frontPage, frontEmbedded[2 * j + 1], rightRect);

    const backPage = backDoc.addPage([TARGET_WIDTH, TARGET_HEIGHT]);
    drawFitted(backPage, backEmbedded[2 * j], leftRect);
    drawFitted(backPage, backEmbedded[2 * j + 1], rightRect);
  }

  const frontPdf = await frontDoc.save();
  const backPdf = await backDoc.save();

  return {
    originalPages: originalPageCount,
    paddedPages: N,
    sheetsCount: S,
    paddingApplied,
    frontPdf,
    backPdf,
  };
}
