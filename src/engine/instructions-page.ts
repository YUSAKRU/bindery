import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import type { Binding, FlipEdge } from './types';

/**
 * Everything the printed instructions sheet needs, derived from the booklet
 * options and imposition result. See {@link makeInstructionsPage}.
 */
export interface InstructionsData {
  sheetWidth: number;
  sheetHeight: number;
  /** Human label for the sheet, e.g. "A4 landscape" or "792 x 612 pt". */
  paperLabel: string;
  totalSheets: number;
  signaturesCount: number;
  /** Sheet count of each signature, in order, e.g. [4, 4, 3]. */
  sheetsPerSignature: number[];
  /** 1-based original-document page where each signature begins. */
  signatureStartPages: number[];
  flipEdge: FlipEdge;
  binding: Binding;
  separateCover: boolean;
  gutter: number;
  creep: number;
}

// Cap on the per-signature reading-order lines before collapsing the tail into
// a single "... and N more" summary, so the page never overflows.
const MAX_SIGNATURE_LINES = 10;

// Wraps `text` to lines no wider than `maxWidth` at the given font/size.
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Renders a single-page, printer-shop-style instructions sheet (plus a
 * reading-order check) at the selected sheet size. English only: pdf-lib's
 * StandardFonts are WinAnsi-encoded and cannot draw Turkish ı/ş/ğ/İ; embedding a
 * Unicode font is deliberately out of scope here. All copy is ASCII so it is
 * WinAnsi-safe and greppable in the content stream.
 */
export async function makeInstructionsPage(data: InstructionsData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([data.sheetWidth, data.sheetHeight]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const maxWidth = data.sheetWidth - margin * 2;
  const ink = rgb(0.12, 0.12, 0.13);
  let y = data.sheetHeight - margin;

  const line = (text: string, size: number, f: PDFFont = font, gap = size * 1.5): void => {
    page.drawText(text, { x: margin, y, size, font: f, color: ink });
    y -= gap;
  };
  const paragraph = (text: string, size: number, f: PDFFont = font): void => {
    for (const l of wrapLines(text, f, size, maxWidth)) line(l, size, f);
  };
  const gap = (h: number): void => {
    y -= h;
  };

  line('Booklet Printing Instructions', 18, bold, 28);

  // Summary block.
  paragraph(`Paper: ${data.paperLabel}`, 10);
  paragraph(`Total sheets: ${data.totalSheets}`, 10);
  paragraph(
    `Signatures: ${data.signaturesCount} (sheets per signature: ${data.sheetsPerSignature.join(', ')})`,
    10,
  );
  paragraph(`Separate cover: ${data.separateCover ? 'yes' : 'no'}`, 10);
  gap(10);

  // Steps.
  line('Steps', 13, bold, 20);
  const flipLabel = data.flipEdge === 'long' ? 'LONG' : 'SHORT';
  line(`1. Printer duplex: Flip on ${flipLabel} edge.`, 11, bold, 17);
  paragraph('2. Print Combined Booklet.pdf double-sided (duplex), all sheets.', 11);
  paragraph(
    `3. Fold each signature at the center. Sheets per signature: ${data.sheetsPerSignature.join(', ')}.`,
    11,
  );
  let stepNo = 4;
  if (data.separateCover) {
    paragraph(
      `${stepNo}. Print Cover.pdf double-sided on heavier paper; it wraps the folded block.`,
      11,
    );
    stepNo += 1;
  }
  if (data.binding === 'rtl') {
    paragraph(
      `${stepNo}. Note: right-to-left book - the spine is on the right when folding.`,
      11,
    );
  }
  gap(10);

  // Reading-order check. Cap the per-signature lines so a document with many
  // signatures cannot push the list (and everything after it) off the page.
  line('Reading order check', 13, bold, 20);
  const shown = data.signatureStartPages.slice(0, MAX_SIGNATURE_LINES);
  shown.forEach((startPage, i) => {
    line(`Signature ${i + 1} starts at page ${startPage}`, 10);
  });
  const remaining = data.signatureStartPages.length - shown.length;
  if (remaining > 0) {
    const interval =
      data.signatureStartPages.length > 1
        ? data.signatureStartPages[1] - data.signatureStartPages[0]
        : 0;
    paragraph(`... and ${remaining} more signatures (every ${interval} pages).`, 10);
  }
  gap(4);
  paragraph(
    'After folding and collating, flip through: pages must read 1, 2, 3, ... in order.',
    10,
  );

  // Footer with the fine geometry values, pinned to a fixed bottom baseline so
  // it is always on the page regardless of how much content precedes it.
  page.drawText(`Gutter: ${data.gutter} pt   Creep: ${data.creep} pt`, {
    x: margin,
    y: margin,
    size: 8,
    font,
    color: ink,
  });

  return doc.save();
}
