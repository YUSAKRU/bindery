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
 * LaTeX commands that have a faithful printed form, and what to print.
 *
 * Every target was checked against the bundled subsets before it was put here.
 * `× · ± µ` are in all three faces. `→ ←` are in the monospace face only and
 * reach the page through the fallback in `markdown-render.ts`.
 *
 * `≤ ≥ ≠` are in **no** bundled face, and widening the `pyftsubset` ranges
 * cannot add them: they are absent from Noto Sans Regular itself, so they would
 * cost a whole extra font family. They are written as ASCII instead, which is
 * legible in a technical booklet and needs nothing new. Anything not listed
 * here is left as LaTeX source rather than guessed at.
 */
const LATEX_TEXT: Readonly<Record<string, string>> = {
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  gets: '←',
  times: '×',
  cdot: '·',
  pm: '±',
  // The micro sign, not Greek mu: U+00B5 is in the subsets, U+03BC is not, and
  // in "\mu s" the author means microseconds.
  mu: 'µ',
  // Function names print as themselves; LaTeX only sets them upright.
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  log: 'log',
  ln: 'ln',
  exp: 'exp',
  max: 'max',
  min: 'min',
  // No bundled face has ∞ and neither does Noto Sans Regular, so it is spelt.
  infty: 'inf',
  le: '<=',
  leq: '<=',
  ge: '>=',
  geq: '>=',
  ne: '!=',
  neq: '!=',
  ll: '<<',
  gg: '>>',
};

/** `\mathbf{…}` and friends: a command that styles the group it wraps. */
const LATEX_BOLD = new Set(['mathbf', 'bm', 'textbf', 'mathrm', 'text', 'mathit', 'textit']);

/** Thrown internally when a formula uses something with no faithful printed form. */
class UnprintableLatex extends Error {}

/**
 * Renders the inside of a `$…$` into spans.
 *
 * Bails by throwing the moment it meets a command it cannot print faithfully,
 * so a real formula is never half-converted into something that reads as
 * different maths — the caller then keeps the LaTeX source verbatim, which is
 * the behaviour this pipeline shipped with.
 */
function latexSpans(source: string, base: InlineSpan): InlineSpan[] {
  const out: InlineSpan[] = [];
  const push = (text: string, bold: boolean) => {
    if (text.length === 0) return;
    const last = out[out.length - 1];
    if (last && (last.bold === true) === bold) last.text += text;
    else out.push(bold ? { ...base, text, bold: true } : { ...base, text });
  };

  const walk = (input: string, bold: boolean): void => {
    let i = 0;
    let plain = '';
    const flush = () => {
      push(plain, bold);
      plain = '';
    };
    while (i < input.length) {
      const ch = input[i];
      if (ch === '{') {
        // A bare group is only grouping in LaTeX — "R=96{,}000" is a number
        // whose comma is punctuation, not a decimal point. Its content prints.
        let depth = 1;
        let j = i + 1;
        while (j < input.length && depth > 0) {
          if (input[j] === '{') depth += 1;
          else if (input[j] === '}') depth -= 1;
          j += 1;
        }
        if (depth !== 0) throw new UnprintableLatex(input);
        flush();
        walk(input.slice(i + 1, j - 1), bold);
        i = j;
        continue;
      }
      if (ch !== '\\') {
        if (ch === '}') throw new UnprintableLatex(input);
        // '^' and '_' change the meaning of what follows and cannot be shown
        // on one line; a formula using them stays as source.
        if (ch === '^' || ch === '_') throw new UnprintableLatex(input);
        plain += ch;
        i += 1;
        continue;
      }
      const rest = input.slice(i + 1);
      const nameMatch = /^[a-zA-Z]+/.exec(rest);
      if (!nameMatch) {
        // "\ " is an explicit space; "\%" and friends are escaped literals.
        const escaped = rest[0];
        if (escaped === undefined) throw new UnprintableLatex(input);
        plain += escaped === ' ' ? ' ' : escaped;
        i += 2;
        continue;
      }
      const name = nameMatch[0];
      let after = i + 1 + name.length;
      if (LATEX_BOLD.has(name)) {
        if (input[after] !== '{') throw new UnprintableLatex(input);
        let depth = 1;
        let j = after + 1;
        while (j < input.length && depth > 0) {
          if (input[j] === '{') depth += 1;
          else if (input[j] === '}') depth -= 1;
          j += 1;
        }
        if (depth !== 0) throw new UnprintableLatex(input);
        flush();
        walk(input.slice(after + 1, j - 1), name === 'mathbf' || name === 'bm' || name === 'textbf');
        i = j;
        continue;
      }
      const replacement = LATEX_TEXT[name];
      if (replacement === undefined) throw new UnprintableLatex(input);
      plain += replacement;
      if (input[after] === ' ') {
        after += 1;
        // LaTeX drops the space that terminates a command name, and for a
        // single character that is what the author means: "\mu s" is "µs", not
        // "µ s". The multi-character replacements are all relations written as
        // ASCII, and "<=500 ms" reads as one token — keep their space so
        // "\le \mathbf{500\ ms}" prints "<= 500 ms".
        if (replacement.length > 1) plain += ' ';
      }
      i = after;
    }
    flush();
  };

  walk(source, false);
  return out;
}

/**
 * Splits a plain-text run on inline `$…$`.
 *
 * A formula whose every command has a faithful printed form is set as ordinary
 * text — `$\le \mathbf{500\ ms}$` prints as `<= **500 ms**`, which is what the
 * author meant and what a reader on paper can use. These documents' "maths" is
 * mostly units, comparisons and bold, not real notation.
 *
 * Anything else keeps the LaTeX source in the monospace face, delimiters and
 * all. That was the original Phase 1 behaviour and it stays the fallback: a
 * half-converted formula would read as different maths, which is worse than
 * showing the source. Stripping the `$` there would also make `$O(n)$` look
 * like prose that happens to be in another face.
 */
function renderFormula(inner: string, raw: string, base: InlineSpan): InlineSpan[] {
  try {
    const spans = latexSpans(inner, base);
    if (spans.length > 0) return spans;
  } catch (error) {
    if (!(error instanceof UnprintableLatex)) throw error;
  }
  return [{ ...base, text: raw, mono: true }];
}

export function splitInlineMath(text: string, base: InlineSpan): InlineSpan[] {
  const out: InlineSpan[] = [];
  let last = 0;
  INLINE_MATH.lastIndex = 0;
  let match = INLINE_MATH.exec(text);
  while (match !== null) {
    if (match.index > last) {
      out.push({ ...base, text: text.slice(last, match.index) });
    }
    out.push(...renderFormula(match[1], match[0], base));
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

/** A single tag, which is how `marked` hands inline HTML over: one token each. */
const HTML_TAG = /<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?\/?>/g;

/**
 * The element names that may be deleted as markup.
 *
 * `marked` calls anything shaped like a tag inline HTML, and these documents
 * are full of things that are shaped like one but are not: `Vec<u8>`,
 * `Arc<Mutex<T>>`, `Result<T, E>`, `\\.\pipe\kurgu_<USERNAME>`. Deleting those
 * loses the reader's content, which is worse than the tags this strip exists to
 * remove. So the rule is inverted: a name has to be a real HTML element before
 * it is dropped, and everything else is prose and stays.
 */
const HTML_ELEMENTS = new Set(
  ('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas ' +
   'caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed ' +
   'fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe ' +
   'img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol ' +
   'optgroup option output p param picture pre progress q rp rt ruby s samp script section select ' +
   'slot small source span strong style sub summary sup table tbody td template textarea tfoot th ' +
   'thead time title tr track u ul var video wbr').split(' '),
);

/**
 * Reduces HTML to the text a printed page can carry.
 *
 * `marked` is used as a lexer, never as an HTML renderer, so a tag arrives as
 * its own token and used to be printed literally — `H<sub>2</sub>O` reached the
 * page with the tags showing. A booklet cannot render markup, and the tag tells
 * the reader nothing, so the tags go and their text content stays. A line break
 * becomes a space rather than nothing, or the words on either side would run
 * together.
 *
 * Entities (`&amp;`, `&nbsp;`) are left as written; decoding them is a separate
 * job and inventing a half-decoder here would be worse than leaving them
 * visible.
 */
export function stripHtmlTags(raw: string): string {
  return raw.replace(HTML_TAG, (tag: string, name: string) => {
    if (!HTML_ELEMENTS.has(name.toLowerCase())) return tag;
    return /^(br|hr)$/i.test(name) ? ' ' : '';
  });
}

/** Flattens marked's inline tokens into styled spans. */
export function inlineSpans(tokens: Token[] | undefined, base: InlineSpan = { text: '' }): InlineSpan[] {
  if (!tokens) return [];
  const out: InlineSpan[] = [];
  let pending = '';
  const flushPending = () => {
    if (pending.length === 0) return;
    out.push(...splitInlineMath(pending, base));
    pending = '';
  };
  for (const token of tokens) {
    if (token.type !== 'text' && token.type !== 'escape') flushPending();
    switch (token.type) {
      case 'strong':
        out.push(...inlineSpans((token as Tokens.Strong).tokens, { ...base, bold: true }));
        break;
      case 'em':
        out.push(...inlineSpans((token as Tokens.Em).tokens, { ...base, italic: true }));
        break;
      case 'del':
        out.push(...inlineSpans((token as Tokens.Del).tokens, { ...base, strike: true }));
        break;
      case 'link':
        // The URL is dropped: a printed booklet cannot be clicked, and the
        // link text is what the reader needs on paper.
        out.push(...inlineSpans((token as Tokens.Link).tokens, base));
        break;
      case 'codespan':
        out.push({ ...base, text: (token as Tokens.Codespan).text, mono: true });
        break;
      case 'html':
        out.push({ ...base, text: stripHtmlTags((token as Tokens.HTML).raw ?? '') });
        break;
      case 'image': {
        // The file cannot travel into the booklet, so the alt text stands in
        // for it — bracketed, because dropped straight into the sentence it
        // reads as prose the author never wrote. Language-neutral on purpose:
        // this module stays free of i18n. An image with no alt text says
        // nothing a reader could use, so nothing is printed for it.
        const alt = ((token as Tokens.Image).text ?? '').trim();
        if (alt) out.push({ ...base, text: `[${alt}]` });
        break;
      }
      case 'br':
        out.push({ ...base, text: ' ' });
        break;
      case 'escape':
      case 'text': {
        const nested = (token as Tokens.Text).tokens;
        if (nested && nested.length > 0) {
          flushPending();
          out.push(...inlineSpans(nested, base));
        } else {
          // Buffered rather than split on the spot: `marked` cuts a markdown
          // escape into its own token, so "$\mathbf{0\%}$" arrives as three
          // pieces and a formula split across them would never be recognised.
          pending += (token as Tokens.Text).text ?? '';
        }
        break;
      }
      default: {
        // Anything a future marked version adds: keep the literal text rather
        // than silently dropping content off the page.
        const raw = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (raw) out.push({ ...base, text: raw });
      }
    }
  }
  flushPending();
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

/**
 * The bullet a list item is printed with.
 *
 * A task item carries its state in the marker, because `marked` strips the
 * `[x]` from the item's text and hands the state over separately — ignoring it
 * printed a finished task and a pending one identically, which is the one thing
 * a checklist exists to tell apart.
 *
 * The state is written as ASCII rather than `☑`/`☐` on purpose. The marker is
 * drawn straight from the body face in `markdown-layout.ts` and never passes
 * through `sanitizeBlocks`, so a glyph that face lacks would not degrade to
 * `?` — it would abort the whole conversion inside pdf-lib. Neither box
 * character, nor `✓`, nor `□` is in the bundled subset; `[x]` is, and it is
 * what the author typed.
 */
function listMarker(token: Tokens.List, item: Tokens.ListItem, index: number): string {
  if (item.task) return item.checked ? '[x]' : '[ ]';
  return token.ordered ? `${(token.start || 1) + index}.` : '•';
}

function pushList(token: Tokens.List, depth: number, out: MdBlock[]): void {
  token.items.forEach((item, index) => {
    const marker = listMarker(token, item, index);
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
    case 'html': {
      // A block of HTML: same reasoning as the inline case, but the whole block
      // arrives as one token, so the tags are stripped and whatever text they
      // wrapped is kept as a paragraph.
      const text = stripHtmlTags((token as Tokens.HTML).raw ?? '').trim();
      if (text) out.push({ kind: 'paragraph', spans: [{ text }] });
      break;
    }
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
