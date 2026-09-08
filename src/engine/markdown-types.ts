/**
 * Shared vocabulary for the Markdown → booklet pipeline.
 *
 * Deliberately split from both `marked` and `pdf-lib`: `markdown-parse.ts`
 * normalises the lexer's tokens into the {@link MdBlock} tree below, and
 * `markdown-layout.ts` turns that tree into {@link LayoutPage}s of absolute
 * coordinates. Neither module imports a PDF library, so page breaking, code
 * soft-wrap and table column fitting are unit-testable against a fake
 * {@link FontMetrics} instead of an embedded TTF.
 *
 * That separation is not a preference — it is the lesson recorded at the top of
 * `instructions-page.ts`: once a subset font is embedded, text is encoded as
 * subset glyph IDs and can no longer be grepped back out of the PDF content
 * stream, so assertions have to be made on layout data, not on output bytes.
 */

/** Which of the three bundled faces a run of text is drawn with. */
export type FontRole = 'body' | 'bold' | 'mono';

/**
 * Font measurements the layout engine needs. Structural (duck-typed) on
 * purpose — the same shape is satisfied by a pdf-lib `PDFFont` wrapper in the
 * renderer and by a constant-ratio stub in tests. Mirrors the existing
 * `wrapText(text, font: { widthOfTextAtSize }, ...)` pattern in
 * `cover-engine.ts`.
 */
export interface FontMetrics {
  /** Advance width of `text` at `size`, in points. */
  widthOfText(text: string, size: number, font: FontRole): number;
  /**
   * Ascent above the baseline at `size`, in points — i.e. how far below the
   * top of a line box the baseline sits. (`PDFFont.heightAtSize(size, {
   * descender: false })` in the renderer.)
   */
  heightOf(size: number, font: FontRole): number;
}

/** A run of inline text carrying its own emphasis. */
export interface InlineSpan {
  text: string;
  bold?: boolean;
  /**
   * No italic face is bundled (see `src/assets/fonts/README.md`), so emphasis
   * is preserved in the AST but currently rendered with the regular face. Kept
   * as data rather than dropped, so adding the face later needs no re-parse.
   */
  italic?: boolean;
  /** `code spans`, and Phase 1's raw LaTeX, draw in the monospace face. */
  mono?: boolean;
}

export type TableAlign = 'left' | 'center' | 'right';

export type MdBlock =
  | { kind: 'heading'; level: number; spans: InlineSpan[] }
  | { kind: 'paragraph'; spans: InlineSpan[]; quoted?: boolean }
  | { kind: 'listItem'; depth: number; marker: string; spans: InlineSpan[] }
  /** A fenced block. `lang` is the info string, lower-cased, or null. */
  | { kind: 'code'; lang: string | null; lines: string[] }
  /**
   * A display-math block (`$$ … $$`). Phase 1 prints the LaTeX source verbatim
   * in the monospace face — approved by the requesting project, since the specs
   * state the Rust integer equivalent alongside every formula.
   */
  | { kind: 'math'; lines: string[] }
  | { kind: 'table'; align: TableAlign[]; header: InlineSpan[][]; rows: InlineSpan[][][] }
  | { kind: 'rule' };

/** One source file, in the order the user arranged them. */
export interface MdDocument {
  /** Display name, used only for diagnostics — the title comes from the H1. */
  name: string;
  blocks: MdBlock[];
}

/** A horizontal piece of a laid-out line, positioned from the page's left edge. */
export interface LayoutRun {
  text: string;
  font: FontRole;
  size: number;
  /** Left edge of the run, in points from the page's left edge. */
  x: number;
}

/**
 * One drawn text line. `y` is the BASELINE in PDF user space — measured from
 * the bottom of the page, because that is the coordinate `page.drawText` wants
 * and converting once here keeps the renderer free of arithmetic.
 */
export interface LayoutLine {
  kind: 'line';
  y: number;
  runs: LayoutRun[];
}

/** A filled or stroked box: code-block backgrounds and table rules. */
export interface LayoutRect {
  kind: 'rect';
  /** Lower-left corner, PDF user space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Semantic role; the renderer owns the actual colours. */
  role: 'codeBackground' | 'tableRule' | 'quoteBar';
}

export type LayoutItem = LayoutLine | LayoutRect;

export interface LayoutPage {
  items: LayoutItem[];
  /** 0-based index of the source document this page belongs to. */
  docIndex: number;
}

/** Per-block-kind type sizes and line advances, all in points. */
export interface TypographyPreset {
  bodySize: number;
  bodyLeading: number;
  headingSizes: [number, number, number];
  headingLeadings: [number, number, number];
  codeSize: number;
  codeLeading: number;
  /** Vertical gap left after a block before the next one starts. */
  blockGap: number;
  /** Left indent applied per list nesting level. */
  listIndent: number;
  /** Padding inside a fenced-code background box. */
  codePadding: number;
}

export interface LayoutOptions {
  pageWidth?: number;
  pageHeight?: number;
  margin?: number;
  typography?: Partial<TypographyPreset>;
  /**
   * When true, each document is padded with blank pages to an even page count,
   * so the next chapter always opens on a recto. Off by default: the caller may
   * prefer to spend the sheets elsewhere.
   */
  padDocumentsToEven?: boolean;
}
