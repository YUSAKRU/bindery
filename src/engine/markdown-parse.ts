import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import type { InlineSpan, MdBlock, TableAlign } from './markdown-types';

/**
 * Normalises GFM Markdown into the flat {@link MdBlock} list the layout engine
 * consumes. Pure: no DOM, no PDF library, no file access.
 *
 * `marked` is used only as a lexer (`marked.lexer`) — never as an HTML
 * renderer. The tokens it returns are its own shape and change between major
 * versions, so they are converted here once and every downstream module speaks
 * `MdBlock` instead.
 */

/** Display-math delimiter. Phase 1 prints the source; see MdBlock's 'math'. */
const BLOCK_MATH = '$$';

// Inline math: a $…$ pair that stays on one line. Deliberately strict — an
// unpaired '$' in prose (a price, a shell variable quoted outside a code span)
// must not swallow the rest of the paragraph.
const INLINE_MATH = /\$([^$\n]+)\$/g;

/**
 * Splits a plain-text run on inline `$…$`, marking the maths as monospace and
 * leaving the surrounding prose alone. The `$` delimiters are kept: the reader
 * is looking at LaTeX source in Phase 1, and stripping them would make
 * `$O(n)$` read as ordinary prose that happens to be in a different face.
 */
export function splitInlineMath(text: string, base: InlineSpan): InlineSpan[] {
  const out: InlineSpan[] = [];
  let last = 0;
  INLINE_MATH.lastIndex = 0;
  let match = INLINE_MATH.exec(text);
  while (match !== null) {
    if (match.index > last) {
      out.push({ ...base, text: text.slice(last, match.index) });
    }
    out.push({ ...base, text: match[0], mono: true });
    last = match.index + match[0].length;
    match = INLINE_MATH.exec(text);
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) });
  return out.length > 0 ? out : [{ ...base, text }];
}

/**
 * Turns the whitespace Markdown reads as a word separator into a real space.
 *
 * A soft line break inside a paragraph, a list item's continuation line and a
 * tab between words are all separators in the source, not glyphs. Left in the
 * span they reach the renderer, which finds no `U+000A` or `U+0009` in any
 * bundled face and prints `?` — every bullet of a real document came out as
 * `01_PRD_AND_VISION.md?Ürün kimliği …` before this. `\r` needs no handling:
 * `marked` has already folded CRLF to `\n` by the time tokens arrive.
 *
 * This runs AFTER `splitInlineMath`, and the order is not cosmetic. The inline
 * maths pattern deliberately refuses to cross a line (`[^$\n]+`) so that two
 * prices on consecutive lines are not read as one formula. Collapsing the
 * break first would hand it `Tutar $50. Sonraki ürün $100.` on one line, and
 * `$50. Sonraki ürün $` would be swallowed as maths and set in monospace.
 */
function collapseInlineWhitespace(text: string): string {
  return text.replace(/[\n\t]+/g, ' ');
}

/** Flattens marked's inline tokens into styled spans. */
export function inlineSpans(tokens: Token[] | undefined, base: InlineSpan = { text: '' }): InlineSpan[] {
  if (!tokens) return [];
  const out: InlineSpan[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        out.push(...inlineSpans((token as Tokens.Strong).tokens, { ...base, bold: true }));
        break;
      case 'em':
        out.push(...inlineSpans((token as Tokens.Em).tokens, { ...base, italic: true }));
        break;
      case 'del':
        out.push(...inlineSpans((token as Tokens.Del).tokens, base));
        break;
      case 'link':
        // The URL is dropped: a printed booklet cannot be clicked, and the
        // link text is what the reader needs on paper.
        out.push(...inlineSpans((token as Tokens.Link).tokens, base));
        break;
      case 'codespan':
        out.push({ ...base, text: (token as Tokens.Codespan).text, mono: true });
        break;
      case 'br':
        out.push({ ...base, text: ' ' });
        break;
      case 'escape':
      case 'text': {
        const raw = (token as Tokens.Text).text ?? '';
        const nested = (token as Tokens.Text).tokens;
        if (nested && nested.length > 0) out.push(...inlineSpans(nested, base));
        else out.push(...splitInlineMath(raw, base));
        break;
      }
      default: {
        // html, image and anything a future marked version adds: keep the
        // literal text rather than silently dropping content off the page.
        const raw = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (raw) out.push({ ...base, text: raw });
      }
    }
  }
  return out
    .map((span) => ({ ...span, text: collapseInlineWhitespace(span.text) }))
    .filter((span) => span.text.length > 0);
}

/** True when a paragraph is really a `$$ … $$` display-math block. */
function asDisplayMath(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(BLOCK_MATH) || trimmed.length < BLOCK_MATH.length * 2) return null;
  if (!trimmed.endsWith(BLOCK_MATH)) return null;
  const inner = trimmed.slice(BLOCK_MATH.length, -BLOCK_MATH.length).trim();
  return inner.length > 0 ? inner.split('\n').map((line) => line.trimEnd()) : null;
}

function tableCells(cells: Tokens.TableCell[] | undefined): InlineSpan[][] {
  return (cells ?? []).map((cell) => inlineSpans(cell.tokens));
}

function pushList(token: Tokens.List, depth: number, out: MdBlock[]): void {
  token.items.forEach((item, index) => {
    const marker = token.ordered ? `${(token.start || 1) + index}.` : '•';
    const own: Token[] = [];
    const nested: MdBlock[] = [];
    for (const child of item.tokens ?? []) {
      if (child.type === 'list') pushList(child as Tokens.List, depth + 1, nested);
      else if (child.type === 'text' || child.type === 'paragraph') {
        own.push(...((child as Tokens.Text).tokens ?? [child]));
      } else {
        pushBlock(child, nested);
      }
    }
    out.push({ kind: 'listItem', depth, marker, spans: inlineSpans(own) });
    out.push(...nested);
  });
}

function pushBlock(token: Token, out: MdBlock[]): void {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading;
      out.push({ kind: 'heading', level: heading.depth, spans: inlineSpans(heading.tokens) });
      break;
    }
    case 'paragraph': {
      const paragraph = token as Tokens.Paragraph;
      const math = asDisplayMath(paragraph.text ?? paragraph.raw ?? '');
      if (math) out.push({ kind: 'math', lines: math });
      else out.push({ kind: 'paragraph', spans: inlineSpans(paragraph.tokens) });
      break;
    }
    case 'code': {
      const code = token as Tokens.Code;
      // Trailing newline in `text` would otherwise become a stray blank row
      // inside the background box.
      out.push({
        kind: 'code',
        lang: code.lang ? code.lang.split(/\s+/)[0].toLowerCase() : null,
        lines: code.text.replace(/\n+$/, '').split('\n'),
      });
      break;
    }
    case 'table': {
      const table = token as Tokens.Table;
      out.push({
        kind: 'table',
        align: (table.align ?? []).map((a) => (a ?? 'left') as TableAlign),
        header: tableCells(table.header),
        rows: (table.rows ?? []).map(tableCells),
      });
      break;
    }
    case 'list':
      pushList(token as Tokens.List, 0, out);
      break;
    case 'blockquote': {
      // Flattened to quoted paragraphs: the layout engine draws a left bar and
      // an indent, which is all a printed page needs, and nesting a block tree
      // inside a block would complicate every page-break decision.
      for (const child of (token as Tokens.Blockquote).tokens ?? []) {
        const nested: MdBlock[] = [];
        pushBlock(child, nested);
        for (const block of nested) {
          out.push(block.kind === 'paragraph' ? { ...block, quoted: true } : block);
        }
      }
      break;
    }
    case 'hr':
      out.push({ kind: 'rule' });
      break;
    case 'space':
      break;
    default: {
      const raw = (token as { text?: string }).text;
      if (raw?.trim()) out.push({ kind: 'paragraph', spans: [{ text: raw.trim() }] });
    }
  }
}

/** Parses one Markdown source file into blocks, in document order. */
export function parseMarkdown(source: string): MdBlock[] {
  const out: MdBlock[] = [];
  // A byte-order mark is not text. `marked` keeps it, no bundled face draws it,
  // and it would print as `?` before the document's first word.
  for (const token of marked.lexer(source.replace(/^\uFEFF/, ''))) pushBlock(token, out);
  return out;
}
