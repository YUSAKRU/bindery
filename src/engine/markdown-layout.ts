import { BookletError } from './types';
import type {
  FontMetrics,
  FontRole,
  InlineSpan,
  LayoutItem,
  LayoutLine,
  LayoutOptions,
  LayoutPage,
  LayoutRun,
  MdBlock,
  MdDocument,
  TableAlign,
  TypographyPreset,
} from './markdown-types';

/**
 * Turns parsed {@link MdBlock}s into absolutely positioned {@link LayoutPage}s.
 *
 * Contains no PDF library: every measurement goes through the duck-typed
 * {@link FontMetrics}, so page breaking, code soft-wrap and table fitting are
 * asserted directly in tests against a constant-ratio stub. The renderer
 * (Package 2) only walks the emitted items and draws them.
 *
 * Coordinates are PDF user space — origin bottom-left, `LayoutLine.y` is the
 * baseline, `LayoutRect.y` the lower-left corner — so the renderer performs no
 * arithmetic of its own and cannot drift from what the tests assert.
 */

/**
 * A5 portrait: the page you get by folding a landscape A4 sheet in half, which
 * is what `makeBooklet` imposes two-up. Kept here rather than imported from the
 * booklet engine so this module stays free of that dependency.
 */
export const A5_PAGE = { width: 420.94, height: 595.28 } as const;

export const DEFAULT_MARGIN = 36;

export const DEFAULT_TYPOGRAPHY: TypographyPreset = {
  bodySize: 9.5,
  bodyLeading: 13,
  headingSizes: [16, 13, 11],
  headingLeadings: [20, 17, 15],
  codeSize: 8,
  codeLeading: 10.5,
  blockGap: 7,
  listIndent: 14,
  codePadding: 4,
};

/**
 * Scales a typography preset, keeping every measurement in proportion.
 *
 * Type size and line advance must move together: raising `bodySize` alone
 * leaves the leading behind and the lines collide. Exposing the ten fields of
 * {@link TypographyPreset} individually to a caller invites exactly that, so
 * size changes go through here instead.
 *
 * `codeScale` defaults to `bodyScale` but is separate on purpose. Prose reflows
 * when it grows; fenced code BREAKS, because `wrapCodeLine` splits by character
 * rather than re-flowing. Measured on a 12-file corpus, scaling everything to
 * 1.4x took the share of soft-wrapped code lines from 18% to 34% — so a preset
 * that enlarges body text for readability should leave code nearly alone.
 */
export function scaleTypography(
  base: TypographyPreset,
  bodyScale: number,
  codeScale: number = bodyScale,
): TypographyPreset {
  for (const [name, value] of [
    ['bodyScale', bodyScale],
    ['codeScale', codeScale],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BookletError(
        'MARKDOWN_INVALID_TYPE_SCALE',
        { name, value: String(value) },
        `${name} must be a positive finite number, got ${value}.`,
      );
    }
  }

  // Two decimals: enough precision for type, and it keeps values like
  // 9.5 * (8 / 9.5) landing on 8 rather than 8.000000000000002.
  const round = (v: number) => Math.round(v * 100) / 100;
  const byBody = (v: number) => round(v * bodyScale);
  const byCode = (v: number) => round(v * codeScale);

  return {
    bodySize: byBody(base.bodySize),
    bodyLeading: byBody(base.bodyLeading),
    headingSizes: base.headingSizes.map(byBody) as [number, number, number],
    headingLeadings: base.headingLeadings.map(byBody) as [number, number, number],
    codeSize: byCode(base.codeSize),
    codeLeading: byCode(base.codeLeading),
    blockGap: byBody(base.blockGap),
    listIndent: byBody(base.listIndent),
    codePadding: byCode(base.codePadding),
  };
}

export type TypographyPresetName = 'compact' | 'standard' | 'large';

/**
 * The three type sizes the UI offers. A closed set, not a continuous control:
 * the four sizes below are calibrated together, and an arbitrary value would
 * let a caller pair a large body size with a small leading.
 *
 * Body and code sizes (and their leadings) are the values the architecture
 * decision fixed; everything else — headings, gaps, indents — is derived by
 * {@link scaleTypography} so it stays in proportion. The specified leadings are
 * NOT an exact multiple of their sizes (13/9.5 vs 11/8 vs 15/11), so they are
 * applied on top of the scaled preset rather than produced by it.
 *
 * Approximate cost on the 12-file, 168 KB reference corpus:
 * compact ~80 A5 pages / 20 A4 sheets, standard ~114 / 29, large ~150 / 38.
 */
export const TYPOGRAPHY_PRESETS: Record<TypographyPresetName, TypographyPreset> = {
  compact: {
    ...scaleTypography(DEFAULT_TYPOGRAPHY, 8 / 9.5, 7.5 / 8),
    bodySize: 8,
    bodyLeading: 11,
    codeSize: 7.5,
    codeLeading: 9.5,
  },
  standard: { ...DEFAULT_TYPOGRAPHY },
  large: {
    ...scaleTypography(DEFAULT_TYPOGRAPHY, 11 / 9.5, 8.5 / 8),
    bodySize: 11,
    bodyLeading: 15,
    codeSize: 8.5,
    codeLeading: 11,
  },
};

/**
 * Continuation prefix for a soft-wrapped code line. Two spaces, not a glyph:
 * the corpus draws box-drawing diagrams inside fences, and any visible marker
 * would be read as part of the diagram.
 */
export const CODE_WRAP_INDENT = '  ';

/** Gap between a list marker and its text, and between table columns. */
const LIST_MARKER_GAP = 4;
const TABLE_CELL_PADDING = 4;
const QUOTE_BAR_WIDTH = 2;
const QUOTE_INDENT = 10;
const RULE_THICKNESS = 0.5;
/**
 * Narrowest a table column may be squeezed to, as a multiple of the body type
 * size. Proportional rather than absolute so it keeps its meaning when the
 * caller changes the type size: at the default 9.5pt body this is 23.75pt,
 * within a rounding error of the fixed 24pt it replaces.
 */
const MIN_COLUMN_WIDTH_EMS = 2.5;

/** The floor at the default body size, for callers that do not pass one. */
export const MIN_COLUMN_WIDTH = Math.round(DEFAULT_TYPOGRAPHY.bodySize * MIN_COLUMN_WIDTH_EMS);

// ---------------------------------------------------------------------------
// Wrapping — pure, exported for direct testing
// ---------------------------------------------------------------------------

/**
 * Soft-wraps one line of monospace code to `maxWidth`, indenting every
 * continuation row by {@link CODE_WRAP_INDENT}.
 *
 * The corpus this pipeline was calibrated against reaches 112 characters inside
 * fences, while an A5 text column fits roughly 72 at 8pt — so wrapping is not
 * an edge case, it is the common path. Breaking is by character, never by word:
 * a Rust signature or an ASCII diagram row must not be re-flowed.
 */
export function wrapCodeLine(
  line: string,
  maxWidth: number,
  size: number,
  metrics: FontMetrics,
): string[] {
  if (line.length === 0) return [''];
  const full = metrics.widthOfText(line, size, 'mono');
  if (full <= maxWidth) return [line];

  // Constant advance width, so one division gives the exact character budget.
  const perChar = full / line.length;
  const firstBudget = Math.max(1, Math.floor(maxWidth / perChar));
  const contBudget = Math.max(1, firstBudget - CODE_WRAP_INDENT.length);

  const out: string[] = [line.slice(0, firstBudget)];
  let rest = line.slice(firstBudget);
  while (rest.length > 0) {
    out.push(CODE_WRAP_INDENT + rest.slice(0, contBudget));
    rest = rest.slice(contBudget);
  }
  return out;
}

interface Token {
  text: string;
  font: FontRole;
  size: number;
  width: number;
}

function fontOf(span: InlineSpan): FontRole {
  if (span.mono) return 'mono';
  if (span.bold) return 'bold';
  return 'body';
}

/**
 * Noto Sans Mono draws the two horizontal arrows small and low: U+2192's ink is
 * 234/1000 em tall and sits between y=49 and y=283, against an x-height of 536
 * and a cap height of 714. Dropped into running text at text size it reads as a
 * subscript. Every other glyph the fallback promotes measures 429-604 tall and
 * needs no help — the vertical arrows are 592 — so this is the exact set that
 * measured short, not a category.
 */
export const SMALL_MONO_FALLBACK = new Set([0x2190, 0x2192]);

/**
 * Scaling a short fallback run by this much puts U+2192's ink between y=93 and
 * y=538: starting just above the baseline and topping out at x-height, which is
 * where an arrow belongs. Runs are drawn on the line's baseline and carry no
 * vertical offset, so the size is the only lever — and at 1.9x the glyph still
 * stops below cap height, so it cannot collide with the line above.
 */
export const SMALL_MONO_FALLBACK_SCALE = 1.9;

/**
 * The point size a span is drawn at. Only a fallback run made entirely of the
 * short glyphs is scaled; a real code span keeps text size so it stays aligned
 * with the code blocks around it.
 */
function sizeOf(span: InlineSpan, size: number): number {
  if (!span.fallback) return size;
  for (const ch of span.text) {
    if (!SMALL_MONO_FALLBACK.has(ch.codePointAt(0) as number)) return size;
  }
  return size * SMALL_MONO_FALLBACK_SCALE;
}

function tokenize(spans: InlineSpan[], size: number, metrics: FontMetrics): Array<Token | null> {
  // `null` marks a collapsible inter-word space.
  const out: Array<Token | null> = [];
  for (const span of spans) {
    const font = fontOf(span);
    const spanSize = sizeOf(span, size);
    const parts = span.text.split(/(\s+)/);
    for (const part of parts) {
      if (part.length === 0) continue;
      if (/^\s+$/.test(part)) out.push(null);
      else
        out.push({
          text: part,
          font,
          size: spanSize,
          width: metrics.widthOfText(part, spanSize, font),
        });
    }
  }
  return out;
}

/** Splits a single token that is wider than the whole column, by character. */
function breakToken(token: Token, maxWidth: number, metrics: FontMetrics): Token[] {
  const out: Token[] = [];
  let current = '';
  for (const ch of token.text) {
    const candidate = current + ch;
    if (current && metrics.widthOfText(candidate, token.size, token.font) > maxWidth) {
      out.push({ ...token, text: current, width: metrics.widthOfText(current, token.size, token.font) });
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) {
    out.push({ ...token, text: current, width: metrics.widthOfText(current, token.size, token.font) });
  }
  return out;
}

/** Merges neighbouring tokens sharing a face and size into single draw runs. */
function toRuns(tokens: Token[], startX: number): LayoutRun[] {
  const runs: LayoutRun[] = [];
  let x = startX;
  for (const token of tokens) {
    const last = runs[runs.length - 1];
    if (last && last.font === token.font && last.size === token.size) {
      last.text += token.text;
    } else {
      runs.push({ text: token.text, font: token.font, size: token.size, x });
    }
    x += token.width;
  }
  return runs;
}

/**
 * Greedy word-wraps styled spans into lines of runs. Emphasis is preserved
 * across the break, so a bold phrase split over two lines stays bold on both.
 */
export function wrapSpans(
  spans: InlineSpan[],
  maxWidth: number,
  size: number,
  metrics: FontMetrics,
  startX = 0,
): LayoutRun[][] {
  const spaceWidth = metrics.widthOfText(' ', size, 'body');
  const lines: LayoutRun[][] = [];
  let current: Token[] = [];
  let width = 0;
  let pendingSpace = false;

  const flush = () => {
    if (current.length > 0) lines.push(toRuns(current, startX));
    current = [];
    width = 0;
    pendingSpace = false;
  };

  for (const token of tokenize(spans, size, metrics)) {
    if (token === null) {
      if (current.length > 0) pendingSpace = true;
      continue;
    }
    const pieces = token.width > maxWidth ? breakToken(token, maxWidth, metrics) : [token];
    for (const piece of pieces) {
      const gap = pendingSpace ? spaceWidth : 0;
      if (current.length > 0 && width + gap + piece.width > maxWidth) {
        flush();
      } else if (pendingSpace) {
        current.push({ text: ' ', font: 'body', size, width: spaceWidth });
        width += spaceWidth;
        pendingSpace = false;
      }
      current.push(piece);
      width += piece.width;
    }
  }
  flush();
  return lines.length > 0 ? lines : [[]];
}

/**
 * Width of the widest single word in a run of spans — a column's min-content
 * width. Narrower than this and the wrapper has to break inside a word, which
 * on paper reads as damaged text rather than as a narrow column.
 */
export function longestWordWidth(
  spans: InlineSpan[],
  size: number,
  metrics: FontMetrics,
): number {
  let widest = 0;
  for (const span of spans) {
    const font = fontOf(span);
    for (const word of span.text.split(/\s+/)) {
      if (word.length > 0) widest = Math.max(widest, metrics.widthOfText(word, size, font));
    }
  }
  return widest;
}

/**
 * Distributes `available` points across table columns, the way CSS table
 * layout does: every column is given its min-content width first, and only the
 * surplus is shared out in proportion to how much more each column could use.
 *
 * The naive version — shrinking each column proportionally towards a fixed
 * floor — let one very wide column hoard the space. On the calibration corpus's
 * technology table (natural widths 191/146/1390pt into 348.9pt) it handed the
 * first two columns 52 and 44pt against a 76pt longest word each, so both
 * broke mid-word ("Selecte/d Technol/ogy") even though the three min-content
 * widths together (303pt) fitted comfortably.
 */
export function computeColumnWidths(
  natural: number[],
  available: number,
  minimums: number[] = [],
  absoluteFloor: number = MIN_COLUMN_WIDTH,
): number[] {
  const total = natural.reduce((sum, w) => sum + w, 0);
  if (total <= available || total === 0) return natural.slice();

  // A column never needs more than its natural width, however long its words.
  const floors = natural.map((w, i) =>
    Math.min(w, Math.max(minimums[i] ?? 0, absoluteFloor)),
  );
  const floorTotal = floors.reduce((sum, w) => sum + w, 0);

  // Even the unbreakable words do not fit: share the width out in proportion to
  // them, so the mid-word breaking is spread instead of falling on one column.
  if (floorTotal >= available) return floors.map((w) => (w / floorTotal) * available);

  const slack = natural.map((w, i) => w - floors[i]);
  const slackTotal = slack.reduce((sum, w) => sum + w, 0);
  if (slackTotal === 0) return floors;
  const keep = (available - floorTotal) / slackTotal;
  return natural.map((_, i) => floors[i] + slack[i] * keep);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface Cursor {
  pages: LayoutPage[];
  items: LayoutItem[];
  /** Top edge of the next line box, in PDF coordinates (distance from bottom). */
  top: number;
  docIndex: number;
  readonly pageTop: number;
  readonly pageBottom: number;
}

function pushPage(cursor: Cursor): void {
  cursor.pages.push({ items: cursor.items, docIndex: cursor.docIndex });
  cursor.items = [];
  cursor.top = cursor.pageTop;
}

function breakPage(cursor: Cursor): void {
  // An empty page is only worth emitting when the caller explicitly asked for
  // padding; a spontaneous break on a fresh page would leave a blank sheet.
  if (cursor.items.length === 0) return;
  pushPage(cursor);
}

/** Remaining vertical space on the current page. */
function remaining(cursor: Cursor): number {
  return cursor.top - cursor.pageBottom;
}

/**
 * Reserves a line box of `leading` points and returns its baseline, breaking
 * the page first when it does not fit. A box taller than a whole page is placed
 * anyway rather than looping forever.
 */
function reserve(cursor: Cursor, leading: number, ascent: number): number {
  if (leading > remaining(cursor) && cursor.items.length > 0) breakPage(cursor);
  const baseline = cursor.top - ascent;
  cursor.top -= leading;
  return baseline;
}

function emitLine(cursor: Cursor, runs: LayoutRun[], leading: number, ascent: number): LayoutLine {
  const line: LayoutLine = { kind: 'line', y: reserve(cursor, leading, ascent), runs };
  cursor.items.push(line);
  return line;
}

interface Geometry {
  left: number;
  width: number;
  typography: TypographyPreset;
}

function headingIndex(level: number): 0 | 1 | 2 {
  if (level <= 1) return 0;
  if (level === 2) return 1;
  return 2;
}

function alignOffset(align: TableAlign, cellWidth: number, textWidth: number): number {
  if (align === 'right') return cellWidth - textWidth;
  if (align === 'center') return (cellWidth - textWidth) / 2;
  return 0;
}

function runsWidth(runs: LayoutRun[], metrics: FontMetrics): number {
  return runs.reduce((sum, run) => sum + metrics.widthOfText(run.text, run.size, run.font), 0);
}

function shiftRuns(runs: LayoutRun[], dx: number): LayoutRun[] {
  return runs.map((run) => ({ ...run, x: run.x + dx }));
}

/** Draws a stack of monospace rows (fenced code or display math) with a background. */
function layoutMonoBlock(
  cursor: Cursor,
  geo: Geometry,
  lines: string[],
  metrics: FontMetrics,
): void {
  const { codeSize, codeLeading, codePadding } = geo.typography;
  const inner = geo.width - codePadding * 2;
  const ascent = metrics.heightOf(codeSize, 'mono');

  for (const source of lines) {
    for (const row of wrapCodeLine(source, inner, codeSize, metrics)) {
      // The background is emitted per row, so a block that spans a page break
      // keeps a continuous panel on both pages without any special casing.
      if (codeLeading > remaining(cursor) && cursor.items.length > 0) breakPage(cursor);
      const top = cursor.top;
      cursor.items.push({
        kind: 'rect',
        x: geo.left,
        y: top - codeLeading,
        width: geo.width,
        height: codeLeading,
        role: 'codeBackground',
      });
      emitLine(
        cursor,
        [{ text: row, font: 'mono', size: codeSize, x: geo.left + codePadding }],
        codeLeading,
        ascent,
      );
    }
  }
}

function layoutTable(
  cursor: Cursor,
  geo: Geometry,
  block: Extract<MdBlock, { kind: 'table' }>,
  metrics: FontMetrics,
): void {
  const { bodySize, bodyLeading } = geo.typography;
  const ascent = metrics.heightOf(bodySize, 'body');
  const columns = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);

  const spanWidth = (spans: InlineSpan[]) =>
    spans.reduce((sum, span) => sum + metrics.widthOfText(span.text, bodySize, fontOf(span)), 0);

  const natural: number[] = [];
  const minimums: number[] = [];
  for (let c = 0; c < columns; c++) {
    let widest = spanWidth(block.header[c] ?? []);
    let longest = longestWordWidth(block.header[c] ?? [], bodySize, metrics);
    for (const row of block.rows) {
      widest = Math.max(widest, spanWidth(row[c] ?? []));
      longest = Math.max(longest, longestWordWidth(row[c] ?? [], bodySize, metrics));
    }
    natural.push(widest + TABLE_CELL_PADDING * 2);
    minimums.push(longest + TABLE_CELL_PADDING * 2);
  }
  const widths = computeColumnWidths(
    natural,
    geo.width,
    minimums,
    Math.round(bodySize * MIN_COLUMN_WIDTH_EMS),
  );
  const offsets: number[] = [];
  let x = geo.left;
  for (const width of widths) {
    offsets.push(x);
    x += width;
  }

  const wrapRow = (cells: InlineSpan[][]) =>
    widths.map((width, c) =>
      wrapSpans(cells[c] ?? [], Math.max(1, width - TABLE_CELL_PADDING * 2), bodySize, metrics),
    );

  const emitRow = (cells: InlineSpan[][], rule: boolean): void => {
    const wrapped = wrapRow(cells);
    const rows = Math.max(...wrapped.map((lines) => lines.length), 1);
    const height = rows * bodyLeading + (rule ? RULE_THICKNESS : 0);
    if (height > remaining(cursor) && cursor.items.length > 0) breakPage(cursor);

    const top = cursor.top;
    wrapped.forEach((lines, c) => {
      lines.forEach((runs, r) => {
        const dx =
          offsets[c] +
          TABLE_CELL_PADDING +
          alignOffset(
            block.align[c] ?? 'left',
            widths[c] - TABLE_CELL_PADDING * 2,
            runsWidth(runs, metrics),
          );
        cursor.items.push({
          kind: 'line',
          y: top - r * bodyLeading - ascent,
          runs: shiftRuns(runs, dx),
        });
      });
    });
    cursor.top = top - rows * bodyLeading;
    if (rule) {
      cursor.items.push({
        kind: 'rect',
        x: geo.left,
        y: cursor.top - RULE_THICKNESS,
        width: geo.width,
        height: RULE_THICKNESS,
        role: 'tableRule',
      });
      cursor.top -= RULE_THICKNESS;
    }
  };

  emitRow(block.header, true);
  const startPage = cursor.pages.length;
  block.rows.forEach((row, index) => {
    const pageBefore = cursor.pages.length;
    emitRow(row, index === block.rows.length - 1);
    // A row that pushed onto a fresh page loses its column headings, so repeat
    // them — the reader needs to know what column three means on page 2.
    if (cursor.pages.length > pageBefore && pageBefore >= startPage) {
      // The row was laid out from the fresh page's top; remember where it
      // actually ended before that origin is reused for the repeated header.
      const rowBottom = cursor.top;
      const pending = cursor.items.splice(0, cursor.items.length);
      cursor.top = cursor.pageTop;
      emitRow(block.header, true);
      const shift = cursor.top - cursor.pageTop;
      for (const item of pending) {
        item.y += shift;
      }
      cursor.items.push(...pending);
      // The cursor must land under the SHIFTED ROW, not merely one header
      // lower. Advancing by `shift` a second time assumed the row was exactly
      // as tall as the header; a taller row then had the next one printed on
      // top of it.
      cursor.top = rowBottom + shift;
    }
  });
}

function layoutBlock(
  cursor: Cursor,
  geo: Geometry,
  block: MdBlock,
  metrics: FontMetrics,
  next: MdBlock | undefined,
): void {
  const typo = geo.typography;

  switch (block.kind) {
    case 'heading': {
      const index = headingIndex(block.level);
      const size = typo.headingSizes[index];
      const leading = typo.headingLeadings[index];
      const ascent = metrics.heightOf(size, 'bold');
      const lines = wrapSpans(
        block.spans.map((span) => ({ ...span, bold: true })),
        geo.width,
        size,
        metrics,
        geo.left,
      );

      if (block.level <= 1) {
        // A chapter opens a page of its own.
        breakPage(cursor);
      } else {
        // keepWithNext: a heading stranded at the foot of a page, with its
        // first line of body text overleaf, reads as a mistake.
        const needed = lines.length * leading + (next ? typo.bodyLeading : 0);
        if (needed > remaining(cursor)) breakPage(cursor);
      }
      for (const runs of lines) emitLine(cursor, runs, leading, ascent);
      break;
    }

    case 'paragraph': {
      const indent = block.quoted ? QUOTE_INDENT : 0;
      const ascent = metrics.heightOf(typo.bodySize, 'body');
      const lines = wrapSpans(
        block.spans,
        geo.width - indent,
        typo.bodySize,
        metrics,
        geo.left + indent,
      );
      for (const runs of lines) {
        if (block.quoted) {
          if (typo.bodyLeading > remaining(cursor) && cursor.items.length > 0) breakPage(cursor);
          cursor.items.push({
            kind: 'rect',
            x: geo.left,
            y: cursor.top - typo.bodyLeading,
            width: QUOTE_BAR_WIDTH,
            height: typo.bodyLeading,
            role: 'quoteBar',
          });
        }
        emitLine(cursor, runs, typo.bodyLeading, ascent);
      }
      break;
    }

    case 'listItem': {
      const ascent = metrics.heightOf(typo.bodySize, 'body');
      const indent = block.depth * typo.listIndent;
      const markerWidth = metrics.widthOfText(block.marker, typo.bodySize, 'body');
      const textX = geo.left + indent + markerWidth + LIST_MARKER_GAP;
      const lines = wrapSpans(
        block.spans,
        geo.width - (textX - geo.left),
        typo.bodySize,
        metrics,
        textX,
      );
      lines.forEach((runs, index) => {
        // Hanging indent: only the first row carries the bullet, continuation
        // rows align with the text, not with the marker.
        const withMarker =
          index === 0
            ? [{ text: block.marker, font: 'body' as FontRole, size: typo.bodySize, x: geo.left + indent }, ...runs]
            : runs;
        emitLine(cursor, withMarker, typo.bodyLeading, ascent);
      });
      break;
    }

    case 'code':
    case 'math':
      layoutMonoBlock(cursor, geo, block.lines, metrics);
      break;

    case 'table':
      layoutTable(cursor, geo, block, metrics);
      break;

    case 'rule': {
      if (typo.blockGap > remaining(cursor) && cursor.items.length > 0) breakPage(cursor);
      cursor.top -= typo.blockGap / 2;
      cursor.items.push({
        kind: 'rect',
        x: geo.left,
        y: cursor.top,
        width: geo.width,
        height: RULE_THICKNESS,
        role: 'tableRule',
      });
      cursor.top -= typo.blockGap / 2;
      break;
    }
  }
}

/**
 * Lays out one or more Markdown documents into a single paginated sequence.
 * Each document starts on a fresh page, so the booklet's chapters line up with
 * the files the user selected and reordered.
 */
export function layoutDocuments(
  docs: MdDocument[],
  metrics: FontMetrics,
  options: LayoutOptions = {},
): LayoutPage[] {
  const pageWidth = options.pageWidth ?? A5_PAGE.width;
  const pageHeight = options.pageHeight ?? A5_PAGE.height;
  const margin = options.margin ?? DEFAULT_MARGIN;
  const typography = { ...DEFAULT_TYPOGRAPHY, ...options.typography };
  const geo: Geometry = { left: margin, width: pageWidth - margin * 2, typography };

  const cursor: Cursor = {
    pages: [],
    items: [],
    top: pageHeight - margin,
    docIndex: 0,
    pageTop: pageHeight - margin,
    pageBottom: margin,
  };

  docs.forEach((doc, docIndex) => {
    cursor.docIndex = docIndex;
    breakPage(cursor);
    doc.blocks.forEach((block, index) => {
      layoutBlock(cursor, geo, block, metrics, doc.blocks[index + 1]);
      if (index < doc.blocks.length - 1) cursor.top -= typography.blockGap;
    });
    if (cursor.items.length > 0) pushPage(cursor);
    if (options.padDocumentsToEven) {
      const inDoc = cursor.pages.filter((page) => page.docIndex === docIndex).length;
      if (inDoc % 2 === 1) cursor.pages.push({ items: [], docIndex });
    }
  });

  return cursor.pages;
}

/** Convenience wrapper for a single document. */
export function layoutDocument(
  blocks: MdBlock[],
  metrics: FontMetrics,
  options: LayoutOptions = {},
): LayoutPage[] {
  return layoutDocuments([{ name: 'document', blocks }], metrics, options);
}
