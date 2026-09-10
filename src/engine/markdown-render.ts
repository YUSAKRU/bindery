import { PDFDocument, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import notoSansUrl from '../assets/fonts/NotoSans-Latin.ttf?url';
import notoSansBoldUrl from '../assets/fonts/NotoSans-Latin-Bold.ttf?url';
import notoSansMonoUrl from '../assets/fonts/NotoSansMono-Regular.ttf?url';
import { A5_PAGE, DEFAULT_MARGIN, layoutDocuments, SMALL_MONO_FALLBACK } from './markdown-layout';
import { parseMarkdown } from './markdown-parse';
import { BookletError } from './types';
import type {
  FontMetrics,
  FontRole,
  InlineSpan,
  LayoutOptions,
  LayoutPage,
  LayoutRect,
  MdBlock,
  MdDocument,
} from './markdown-types';

/**
 * Draws laid-out Markdown pages into a real PDF and hands the bytes to the
 * booklet engine.
 *
 * This is the only module in the Markdown pipeline that knows about pdf-lib.
 * All geometry arrives pre-computed from `markdown-layout.ts` in PDF user
 * space, so nothing here does arithmetic that a test could disagree with —
 * which matters, because text drawn with a subset-embedded font is encoded as
 * glyph IDs and cannot be read back out of the content stream (see the note at
 * the top of `instructions-page.ts`).
 */

const INK = rgb(0.12, 0.12, 0.13);

/** Fill colours for the non-text boxes the layout engine emits. */
const RECT_COLORS: Record<LayoutRect['role'], ReturnType<typeof rgb>> = {
  codeBackground: rgb(0.955, 0.957, 0.965),
  tableRule: rgb(0.62, 0.62, 0.65),
  quoteBar: rgb(0.74, 0.74, 0.77),
  // Same ink as the text it crosses: a lighter rule reads as a printing fault.
  strike: INK,
};

/**
 * Stand-in for a character none of the bundled subsets can draw. The subsets
 * cover Latin, Turkish and — in the monospace face only — box drawing; a
 * document containing Greek, Cyrillic or emoji would otherwise abort the whole
 * conversion inside pdf-lib with an encoding error. Replacing the character
 * loses that glyph; failing loses the booklet.
 */
export const UNSUPPORTED_GLYPH = '?';

export interface RenderFonts {
  body: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

export type FontCoverage = Record<FontRole, Set<number>>;

let cachedFontsPromise: Promise<Record<FontRole, ArrayBuffer>> | null = null;

/**
 * Fetches the three bundled subsets. Memoised as a promise so concurrent
 * conversions share one fetch, and cleared on failure so a later attempt is not
 * stuck on a permanently rejected promise — same contract as
 * `instructions-page.ts` and `cover-engine.ts`.
 */
async function loadFontBytes(): Promise<Record<FontRole, ArrayBuffer>> {
  if (!cachedFontsPromise) {
    const grab = async (url: string): Promise<ArrayBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    };
    cachedFontsPromise = Promise.all([
      grab(notoSansUrl),
      grab(notoSansBoldUrl),
      grab(notoSansMonoUrl),
    ])
      .then(([body, bold, mono]) => ({ body, bold, mono }))
      .catch((err) => {
        cachedFontsPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        throw new BookletError(
          'MARKDOWN_FONT_LOAD_FAILED',
          { message },
          `Could not load the Markdown booklet fonts: ${message}`,
        );
      });
  }
  return cachedFontsPromise;
}

/** Wraps embedded pdf-lib fonts in the layout engine's duck-typed metrics. */
export function createFontMetrics(fonts: RenderFonts): FontMetrics {
  return {
    widthOfText: (text, size, font) => fonts[font].widthOfTextAtSize(text, size),
    heightOf: (size, font) => fonts[font].heightAtSize(size, { descender: false }),
  };
}

/** The code points each embedded face can actually draw. */
export function fontCoverage(fonts: RenderFonts): FontCoverage {
  return {
    body: new Set(fonts.body.getCharacterSet()),
    bold: new Set(fonts.bold.getCharacterSet()),
    mono: new Set(fonts.mono.getCharacterSet()),
  };
}

/** Replaces every code point the face cannot draw with {@link UNSUPPORTED_GLYPH}. */
export function sanitizeText(text: string, supported: Set<number>): string {
  let out = '';
  let changed = false;
  for (const ch of text) {
    if (supported.has(ch.codePointAt(0) as number)) {
      out += ch;
    } else {
      out += UNSUPPORTED_GLYPH;
      changed = true;
    }
  }
  return changed ? out : text;
}

/**
 * The face a span is drawn with. Mirrors `markdown-layout.ts` exactly,
 * including its rule that heading text is always bold — sanitising against a
 * different face than the one that draws would let an unsupported glyph
 * through.
 */
function spanRole(span: InlineSpan, forceBold: boolean): FontRole {
  if (span.mono) return 'mono';
  return span.bold || forceBold ? 'bold' : 'body';
}

/**
 * Splits a span so a character its own face cannot draw, but the monospace face
 * can, is handed to the monospace face instead of being replaced.
 *
 * The proportional subsets carry no arrows at all and one of the forty-eight
 * geometric shapes, while the monospace subset carries both (see
 * `src/assets/fonts/README.md`). Without this, `Markdown → Booklet` printed as
 * `Markdown ? Booklet` even though the glyph was already embedded in the same
 * document.
 *
 * Splitting here rather than at draw time is what keeps it honest: each run is
 * measured with the face that draws it, and `markdown-layout.ts` already mixes
 * faces inside one line for code spans, so it needs no change.
 */
function promoteToMono(span: InlineSpan, coverage: FontCoverage, forceBold: boolean): InlineSpan[] {
  // A span already drawn in mono is measured against mono, so the loop below
  // could never promote anything in it. This is a short circuit, not a guard —
  // removing it changes no output, which is why no test asserts it.
  if (span.mono) return [span];
  const own = coverage[spanRole(span, forceBold)];
  const parts: InlineSpan[] = [];
  let run = '';
  // 'own' keeps the span's face; the two mono kinds differ only in the size the
  // layout engine gives them, so they are kept apart here rather than letting a
  // mixed run fall back to text size for all of it.
  let kind: 'own' | 'mono' | 'monoSmall' = 'own';
  const flush = () => {
    if (run.length === 0) return;
    parts.push(
      kind === 'own' ? { ...span, text: run } : { ...span, text: run, mono: true, fallback: true },
    );
    run = '';
  };
  for (const ch of span.text) {
    const cp = ch.codePointAt(0) as number;
    const needsMono = !own.has(cp) && coverage.mono.has(cp);
    const chKind = !needsMono ? 'own' : SMALL_MONO_FALLBACK.has(cp) ? 'monoSmall' : 'mono';
    if (chKind !== kind) {
      flush();
      kind = chKind;
    }
    run += ch;
  }
  flush();
  return parts.length > 0 ? parts : [span];
}

function sanitizeSpans(spans: InlineSpan[], coverage: FontCoverage, forceBold: boolean): InlineSpan[] {
  return spans.flatMap((span) =>
    promoteToMono(span, coverage, forceBold).map((part) => ({
      ...part,
      text: sanitizeText(part.text, coverage[spanRole(part, forceBold)]),
    })),
  );
}

/**
 * Rewrites blocks so every character is drawable, BEFORE layout runs. Doing it
 * here rather than at draw time keeps the measured widths and the drawn text in
 * agreement — a late substitution would shift every line it touched.
 */
export function sanitizeBlocks(blocks: MdBlock[], coverage: FontCoverage): MdBlock[] {
  return blocks.map((block): MdBlock => {
    switch (block.kind) {
      case 'heading':
        return { ...block, spans: sanitizeSpans(block.spans, coverage, true) };
      case 'paragraph':
      case 'listItem':
        return { ...block, spans: sanitizeSpans(block.spans, coverage, false) };
      case 'code':
      case 'math':
        return { ...block, lines: block.lines.map((line) => sanitizeText(line, coverage.mono)) };
      case 'table':
        return {
          ...block,
          header: block.header.map((cell) => sanitizeSpans(cell, coverage, false)),
          rows: block.rows.map((row) => row.map((cell) => sanitizeSpans(cell, coverage, false))),
        };
      case 'rule':
        return block;
    }
  });
}

/**
 * The sheet each page is drawn on.
 *
 * `LayoutPage` carries no size of its own — the layout engine paginates against
 * one page box for the whole run — so the renderer resolves the same defaults
 * the layout engine used, from the same options object.
 */
export function resolvePageSize(options: LayoutOptions = {}): { width: number; height: number } {
  return {
    width: options.pageWidth ?? A5_PAGE.width,
    height: options.pageHeight ?? A5_PAGE.height,
  };
}

/** Draws already-positioned pages into an open document. */
export function drawPages(
  doc: PDFDocument,
  pages: LayoutPage[],
  fonts: RenderFonts,
  size: { width: number; height: number },
): void {
  for (const layoutPage of pages) {
    const page = doc.addPage([size.width, size.height]);

    // A page with nothing on it — the blank verso `padDocumentsToEven` adds —
    // gets no content stream from pdf-lib, and `makeBooklet` then fails to
    // embed it with "Can't embed page with missing Contents". An empty
    // save/restore pair is the cheapest legal stream that avoids that.
    if (layoutPage.items.length === 0) {
      page.pushOperators(pushGraphicsState(), popGraphicsState());
      continue;
    }

    // Items are drawn in emission order, which is what puts a code block's
    // background panel underneath its text rather than over it.
    for (const item of layoutPage.items) {
      if (item.kind === 'rect') {
        page.drawRectangle({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          color: RECT_COLORS[item.role],
        });
      } else {
        for (const run of item.runs) {
          page.drawText(run.text, {
            x: run.x,
            y: item.y,
            size: run.size,
            font: fonts[run.font],
            color: INK,
          });
        }
      }
    }
  }
}

/**
 * Compiles Markdown into a paginated PDF whose bytes feed straight into
 * `makeBooklet`. Accepts one source string, or several documents in the order
 * the user arranged them — each begins on its own page.
 */
export async function markdownToPdf(
  input: string | MdDocument[],
  options: LayoutOptions = {},
): Promise<Uint8Array> {
  const docs: MdDocument[] =
    typeof input === 'string' ? [{ name: 'document', blocks: parseMarkdown(input) }] : input;

  if (docs.length === 0 || docs.every((doc) => doc.blocks.length === 0)) {
    throw new BookletError(
      'MARKDOWN_NO_CONTENT',
      undefined,
      'The selected Markdown files contain no printable content.',
    );
  }

  const bytes = await loadFontBytes();
  try {
    const doc = await PDFDocument.create();
    // fontkit is ~700kB and only needed to embed these Unicode subsets, so it
    // is pulled in on demand — matching `cover-engine.ts` and keeping it out of
    // the chunk every other PDF tool loads.
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    doc.registerFontkit(fontkit);

    const fonts: RenderFonts = {
      body: await doc.embedFont(bytes.body, { subset: true }),
      bold: await doc.embedFont(bytes.bold, { subset: true }),
      mono: await doc.embedFont(bytes.mono, { subset: true }),
    };

    const coverage = fontCoverage(fonts);
    const safeDocs = docs.map((entry) => ({
      ...entry,
      blocks: sanitizeBlocks(entry.blocks, coverage),
    }));

    const pages = layoutDocuments(safeDocs, createFontMetrics(fonts), options);
    if (pages.length === 0) {
      throw new BookletError(
        'MARKDOWN_NO_CONTENT',
        undefined,
        'The selected Markdown files contain no printable content.',
      );
    }

    drawPages(doc, pages, fonts, resolvePageSize(options));
    return await doc.save();
  } catch (error) {
    if (error instanceof BookletError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new BookletError(
      'MARKDOWN_RENDER_FAILED',
      { message },
      `Could not render the Markdown booklet: ${message}`,
    );
  }
}

/** Re-exported so callers need only this module for a default A5 conversion. */
export { A5_PAGE, DEFAULT_MARGIN };
