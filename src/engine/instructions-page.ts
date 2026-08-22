import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import notoSansUrl from '../assets/fonts/NotoSans-Latin.ttf?url';
import notoSansBoldUrl from '../assets/fonts/NotoSans-Latin-Bold.ttf?url';
import { t } from '../i18n';
import { BookletError } from './types';
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

// The names of the files makeBooklet actually writes to disk (see the booklet
// save flow in src/ui/app.ts). They are literal filenames the user will look
// for, so they stay in English in every locale — only the sentence around them
// is translated.
const FILE_COMBINED = 'Combined Booklet.pdf';
const FILE_COVER = 'Cover.pdf';

let cachedFontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;

/**
 * Loads the bundled Unicode subset used for this sheet. pdf-lib's StandardFonts
 * are WinAnsi-encoded and cannot draw Turkish ı/ş/ğ/İ, which is why this sheet
 * used to be English-only; v0.3.5 bundled a Noto Sans subset for the watermark
 * tool and this reuses it. Fetched lazily and memoised as a promise, so two
 * concurrent booklet runs share one fetch and the bytes are never re-downloaded.
 */
async function loadFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (!cachedFontsPromise) {
    const grab = async (url: string): Promise<ArrayBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    cachedFontsPromise = Promise.all([grab(notoSansUrl), grab(notoSansBoldUrl)])
      .then(([regular, bold]) => ({ regular, bold }))
      .catch((err) => {
        // Reset so a later attempt is not stuck on a permanently rejected promise.
        cachedFontsPromise = null;
        throw new BookletError(
          'INSTRUCTIONS_FONT_LOAD_FAILED',
          { message: err instanceof Error ? err.message : String(err) },
          `Could not load the instructions sheet font: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
  return cachedFontsPromise;
}

/** One rendered line of the sheet. `gapAfter` overrides the default leading. */
export interface InstructionsLine {
  text: string;
  size: number;
  bold?: boolean;
  gapAfter?: number;
}

/**
 * Builds the sheet's copy, in the current language, as an ordered list of lines.
 *
 * Separated from the drawing below on purpose. The sheet used to draw ASCII
 * through a WinAnsi StandardFont, which left the text readable in the PDF
 * content stream, and the booklet-engine tests asserted on the copy by grepping
 * that stream. Embedding a Unicode subset — the whole point of localising this
 * sheet — encodes text as subset glyph IDs, so that trick no longer works.
 * Exposing the copy as data keeps it directly assertable without weakening the
 * tests or reading bytes out of a PDF.
 */
export function buildInstructionsLines(data: InstructionsData): InstructionsLine[] {
  const perSignature = data.sheetsPerSignature.join(', ');
  const out: InstructionsLine[] = [];
  const push = (text: string, size: number, bold?: boolean, gapAfter?: number) =>
    out.push({ text, size, bold, gapAfter });

  push(t('instructions.title'), 18, true, 28);

  push(t('instructions.paper', { paper: data.paperLabel }), 10);
  push(t('instructions.totalSheets', { count: data.totalSheets }), 10);
  push(t('instructions.signatures', { count: data.signaturesCount, perSignature }), 10);
  push(
    t('instructions.separateCover', {
      value: t(data.separateCover ? 'instructions.yes' : 'instructions.no'),
    }),
    10,
    undefined,
    10 + 15, // trailing block gap
  );

  push(t('instructions.steps'), 13, true, 20);
  const flipLabel = t(
    data.flipEdge === 'long' ? 'instructions.edge.long' : 'instructions.edge.short',
  );
  push(t('instructions.step.duplex', { edge: flipLabel }), 11, true, 17);
  push(t('instructions.step.print', { file: FILE_COMBINED }), 11);
  push(t('instructions.step.fold', { perSignature }), 11);
  let stepNo = 4;
  if (data.separateCover) {
    push(t('instructions.step.cover', { n: stepNo, file: FILE_COVER }), 11);
    stepNo += 1;
  }
  if (data.binding === 'rtl') {
    push(t('instructions.step.rtl', { n: stepNo }), 11);
  }
  out[out.length - 1].gapAfter = (out[out.length - 1].size ?? 11) * 1.5 + 10;

  push(t('instructions.readingOrder'), 13, true, 20);
  const shown = data.signatureStartPages.slice(0, MAX_SIGNATURE_LINES);
  shown.forEach((startPage, i) => {
    push(t('instructions.signatureStart', { n: i + 1, page: startPage }), 10);
  });
  const remaining = data.signatureStartPages.length - shown.length;
  if (remaining > 0) {
    const interval =
      data.signatureStartPages.length > 1
        ? data.signatureStartPages[1] - data.signatureStartPages[0]
        : 0;
    push(t('instructions.andMore', { count: remaining, interval }), 10);
  }
  out[out.length - 1].gapAfter = 10 * 1.5 + 4;
  push(t('instructions.verify'), 10);

  return out;
}

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
 * reading-order check) at the selected sheet size, in the app's current
 * language. The user follows this sheet while folding, or hands it to a print
 * shop, so it must be readable in their own language — see {@link loadFonts}
 * for why that was not possible before v0.3.5.
 *
 * The output PDF filenames it references are deliberately left untranslated:
 * they are the actual names on disk.
 */
export async function makeInstructionsPage(data: InstructionsData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([data.sheetWidth, data.sheetHeight]);

  const { regular, bold: boldBytes } = await loadFonts();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(regular, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const margin = 48;
  const maxWidth = data.sheetWidth - margin * 2;
  const ink = rgb(0.12, 0.12, 0.13);
  let y = data.sheetHeight - margin;

  // Long lines are wrapped to the sheet width; `gapAfter` (when the copy sets
  // one) applies to the last wrapped row, so block spacing survives wrapping.
  for (const item of buildInstructionsLines(data)) {
    const f = item.bold ? bold : font;
    const rows = wrapLines(item.text, f, item.size, maxWidth);
    rows.forEach((row, i) => {
      page.drawText(row, { x: margin, y, size: item.size, font: f, color: ink });
      const isLast = i === rows.length - 1;
      y -= isLast ? (item.gapAfter ?? item.size * 1.5) : item.size * 1.5;
    });
  }

  // Footer with the fine geometry values, pinned to a fixed bottom baseline so
  // it is always on the page regardless of how much content precedes it.
  page.drawText(t('instructions.footer', { gutter: data.gutter, creep: data.creep }), {
    x: margin,
    y: margin,
    size: 8,
    font,
    color: ink,
  });

  return doc.save();
}
