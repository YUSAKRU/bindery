import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, splitInlineMath } from './markdown-parse';
import {
  A5_PAGE,
  CODE_WRAP_INDENT,
  DEFAULT_MARGIN,
  DEFAULT_TYPOGRAPHY,
  MIN_COLUMN_WIDTH,
  TYPOGRAPHY_PRESETS,
  computeColumnWidths,
  layoutDocument,
  longestWordWidth,
  scaleTypography,
  layoutDocuments,
  wrapCodeLine,
  SMALL_MONO_FALLBACK_SCALE,
  wrapSpans,
} from './markdown-layout';
import type { FontMetrics, LayoutLine, LayoutPage, MdBlock } from './markdown-types';
import { BookletError } from './types';

/**
 * Constant-ratio stand-in for an embedded font. The whole point of the
 * duck-typed FontMetrics is that these numbers are exact and hand-checkable, so
 * every wrap and page-break assertion below is arithmetic rather than a
 * screenshot comparison. Mono is deliberately a fixed advance, as the real
 * NotoSansMono is.
 */
const RATIOS = { body: 0.5, bold: 0.55, mono: 0.6 } as const;
const metrics: FontMetrics = {
  widthOfText: (text, size, font) => text.length * size * RATIOS[font],
  heightOf: (size) => size * 0.75,
};

const PRINTABLE_WIDTH = A5_PAGE.width - DEFAULT_MARGIN * 2;
const PRINTABLE_HEIGHT = A5_PAGE.height - DEFAULT_MARGIN * 2;

const linesOf = (page: LayoutPage): LayoutLine[] =>
  page.items.filter((item): item is LayoutLine => item.kind === 'line');
const textOf = (line: LayoutLine): string => line.runs.map((run) => run.text).join('');
const pageText = (page: LayoutPage): string => linesOf(page).map(textOf).join('\n');

describe('parseMarkdown', () => {
  it('normalises headings, emphasis and code spans', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and `code` text.\n');
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    const paragraph = blocks.find((b) => b.kind === 'paragraph');
    expect(paragraph).toBeDefined();
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.find((s) => s.bold)?.text).toBe('bold');
    expect(paragraph.spans.find((s) => s.mono)?.text).toBe('code');
  });

  it('keeps the fence language and drops the trailing newline', () => {
    const blocks = parseMarkdown('```rust\nfn main() {}\n```\n');
    expect(blocks[0]).toEqual({ kind: 'code', lang: 'rust', lines: ['fn main() {}'] });
  });

  it('preserves box-drawing characters inside fences byte for byte', () => {
    const diagram = '[VPU Hardware Decoder] ──► [VRAM Surface: VASurfaceID / NVDEC Surface]';
    const blocks = parseMarkdown(`\`\`\`\n${diagram}\n\`\`\`\n`);
    expect(blocks[0]).toMatchObject({ kind: 'code', lines: [diagram] });
  });

  it('treats a $$ block as display math and inline $…$ as monospace', () => {
    const blocks = parseMarkdown('$$ E = mc^2 $$\n\nBudget is $t_f$ per frame.\n');
    expect(blocks[0]).toEqual({ kind: 'math', lines: ['E = mc^2'] });
    const paragraph = blocks[1];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.filter((s) => s.mono).map((s) => s.text)).toEqual(['$t_f$']);
  });

  describe('inline LaTeX', () => {
    const flat = (src: string) => {
      const block = parseMarkdown(`${src}\n`)[0];
      if (block?.kind !== 'paragraph') throw new Error('expected a paragraph');
      return block.spans;
    };
    const text = (src: string) =>
      flat(src)
        .map((s) => s.text)
        .join('');

    it('prints the commands it can draw as real characters', () => {
      // Every target was checked against the bundled subsets: × · ± µ are in
      // all three faces, → ← in the monospace face via the fallback.
      expect(text('Hattı $\\rightarrow$ DMA-BUF')).toBe('Hattı → DMA-BUF');
      expect(text('Oran $2 \\times 3$ kadar')).toBe('Oran 2 ×3 kadar');
    });

    it('writes the relations no bundled face carries as ASCII, spaced', () => {
      // ≤ ≥ ≠ are absent from Noto Sans Regular itself, so they cannot be
      // subset in — they would cost another font family.
      expect(text('Başlangıç $\\le \\mathbf{500\\ ms}$')).toBe('Başlangıç <= 500 ms');
      expect(text('En az $\\ge 10$ kere')).toBe('En az >= 10 kere');
    });

    it('keeps the micro sign glued to its unit', () => {
      // "\mu s" means microseconds. The terminating space is LaTeX syntax, not
      // a space the author wants printed.
      expect(text('Gecikme $\\mathbf{0\\ \\mu s}$ olmalı')).toBe('Gecikme 0 µs olmalı');
    });

    it('carries \\mathbf through as real bold, not as literal source', () => {
      const spans = flat('Kayıp $\\mathbf{0%}$ hedefi');
      expect(spans.find((s) => s.bold)?.text).toBe('0%');
      expect(spans.some((s) => s.mono)).toBe(false);
    });

    it('leaves a formula it cannot print faithfully as source', () => {
      // Half-converting real notation would read as different maths, which is
      // worse than showing the source — so superscripts and unknown commands
      // keep the delimiters and the monospace face.
      const sup = flat('Gerçek $E = mc^2$ korunur');
      expect(sup.find((s) => s.mono)?.text).toBe('$E = mc^2$');
      const frac = flat('Karmaşık $\\frac{a}{b}$ korunur');
      expect(frac.find((s) => s.mono)?.text).toBe('$\\frac{a}{b}$');
    });

    it('prints a function name and spells the infinity it cannot draw', () => {
      expect(text('tanjant ($\\tanh$) yumuşatması')).toBe('tanjant (tanh) yumuşatması');
      expect(text('Aralık $\\pm\\infty$ olur')).toBe('Aralık ±inf olur');
    });

    it('treats a bare brace group as grouping, not as a formula it cannot read', () => {
      // "R=96{,}000" is a number whose comma is punctuation; the braces are
      // LaTeX grouping and print nothing of their own.
      expect(text('Örnekleme $R=96{,}000$ Hz')).toBe('Örnekleme R=96,000 Hz');
    });

    it('sees a formula that a markdown escape cut into pieces', () => {
      // `marked` makes "\%" its own escape token, so "$\mathbf{0\%}$" arrives
      // as three tokens; splitting each one alone never finds the formula.
      const spans = flat('sırasında $\\mathbf{0\\%}$ kare düşüşü');
      expect(spans.find((s) => s.bold)?.text).toBe('0%');
      expect(spans.some((s) => s.mono)).toBe(false);
    });

    it('never drops a command it does not know', () => {
      // The safety valve, and the one that has to be tested without braces:
      // "\frac{a}{b}" would bail on the brace anyway, so it cannot tell a
      // deliberate bail from a silent skip. "\oplus" can. Dropping it would
      // print "a b" — a formula quietly turned into different maths.
      const spans = flat('Toplam $a \\oplus b$ olur');
      expect(spans.find((s) => s.mono)?.text).toBe('$a \\oplus b$');
      expect(spans.map((s) => s.text).join('')).toContain('\\oplus');
    });

    it('still leaves a lone dollar amount alone', () => {
      expect(text('Fiyat $50 tek dolar')).toBe('Fiyat $50 tek dolar');
    });
  });

  it('strips inline HTML tags instead of printing them', () => {
    const blocks = parseMarkdown('Su H<sub>2</sub>O olur.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Su H2O olur.');
  });

  it('keeps generics and placeholders that only look like tags', () => {
    // `marked` calls anything tag-shaped inline HTML. These documents are full
    // of Rust generics and shell placeholders that are not markup, and deleting
    // them loses the reader's content — worse than the tags the strip removes.
    const cases: Array<[string, string]> = [
      ['Tampon Vec<u8> olarak tutulur.', 'Tampon Vec<u8> olarak tutulur.'],
      ['Paylaşım Arc<Mutex<T>> ile yapılır.', 'Paylaşım Arc<Mutex<T>> ile yapılır.'],
      ['Yol: pipe kurgu_<USERNAME> olur.', 'Yol: pipe kurgu_<USERNAME> olur.'],
    ];
    for (const [source, expected] of cases) {
      const block = parseMarkdown(`${source}\n`)[0];
      if (block?.kind !== 'paragraph') throw new Error('expected a paragraph');
      expect(block.spans.map((s) => s.text).join('')).toBe(expected);
    }
  });

  it('turns an inline line-break tag into a space, not into nothing', () => {
    const blocks = parseMarkdown('Satır<br>sonu.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Satır sonu.');
  });

  it('keeps the text of an HTML block and drops its tags', () => {
    const blocks = parseMarkdown('<div class="x">içerik</div>\n');
    expect(blocks).toEqual([{ kind: 'paragraph', spans: [{ text: 'içerik' }] }]);
  });

  it('brackets an image so its alt text does not read as prose', () => {
    const blocks = parseMarkdown('Şema: ![Mimari şeması](diagram.png) burada.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Şema: [Mimari şeması] burada.');
  });

  it('prints nothing for an image with no alt text', () => {
    const blocks = parseMarkdown('Şema: ![](diagram.png) burada.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).not.toContain('[');
  });

  it('marks struck text so it does not read as ordinary prose', () => {
    const blocks = parseMarkdown('Bu ~~yanlış~~ doğru.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    const struck = paragraph.spans.filter((span) => span.strike);
    expect(struck.map((span) => span.text)).toEqual(['yanlış']);
    expect(paragraph.spans.filter((span) => span.strike !== true).length).toBeGreaterThan(0);
  });

  it('keeps a task list item\'s state in its marker', () => {
    // `marked` strips the "[x]" from the text and reports the state separately.
    // Dropping it printed a finished task and a pending one identically.
    const blocks = parseMarkdown('- [x] biten iş\n- [ ] bekleyen iş\n');
    expect(blocks.map((b) => (b.kind === 'listItem' ? [b.marker, b.spans[0].text] : b.kind))).toEqual([
      ['[x]', 'biten iş'],
      ['[ ]', 'bekleyen iş'],
    ]);
  });

  it('writes the task marker with glyphs the body face actually has', () => {
    // The marker is drawn straight from the body face and skips sanitising, so
    // an absent glyph aborts the conversion rather than degrading. Nothing in
    // the ☐/☑/✓/□ family is in the bundled subset.
    const blocks = parseMarkdown('- [x] a\n- [ ] b\n');
    for (const block of blocks) {
      if (block.kind !== 'listItem') continue;
      for (const ch of block.marker) expect(ch.codePointAt(0)).toBeLessThan(0x80);
    }
  });

  it('leaves an ordinary bullet and an ordered number alone', () => {
    const bullets = parseMarkdown('- düz madde\n');
    expect(bullets[0]).toMatchObject({ kind: 'listItem', marker: '•' });
    const ordered = parseMarkdown('3. üçüncü\n4. dördüncü\n');
    expect(ordered.map((b) => (b.kind === 'listItem' ? b.marker : b.kind))).toEqual(['3.', '4.']);
  });

  it('collapses a soft line break into a space instead of leaving it in the span', () => {
    // No bundled face maps U+000A, so a newline that survives into a span is
    // printed as '?'. Found on the device: "01_PRD_AND_VISION.md?Ürün kimliği".
    const blocks = parseMarkdown('Birinci satır\nikinci satır\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Birinci satır ikinci satır');
  });

  it('collapses the continuation line of a list item too', () => {
    const blocks = parseMarkdown('- 01_PRD.md\n  Ürün kimliği burada\n');
    const item = blocks[0];
    if (item?.kind !== 'listItem') throw new Error('expected a list item');
    expect(item.spans.map((s) => s.text).join('')).toBe('01_PRD.md Ürün kimliği burada');
  });

  it('collapses a tab between words', () => {
    // `marked` leaves a tab in the span and no bundled face maps U+0009 either.
    const blocks = parseMarkdown('kelime1\tkelime2\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('kelime1 kelime2');
  });

  it('does not let the collapse turn two prices into one formula', () => {
    // The regression the ordering guards. `$…$` deliberately refuses to cross a
    // line, so collapsing the break BEFORE the split would hand the pattern
    // "Tutar $50. Sonraki $100." and "$50. Sonraki $" would be set as maths.
    const blocks = parseMarkdown('Tutar $50.\nSonraki $100.\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.some((s) => s.mono)).toBe(false);
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Tutar $50. Sonraki $100.');
  });

  it('leaves the newlines inside a fenced code block alone', () => {
    // Code blocks reach the layout engine as `lines`, never through
    // `inlineSpans` — a collapse that reached them would flatten the listing.
    const blocks = parseMarkdown('```rust\nfn main() {\n    let a = 1;\n}\n```\n');
    expect(blocks[0]).toEqual({
      kind: 'code',
      lang: 'rust',
      lines: ['fn main() {', '    let a = 1;', '}'],
    });
  });

  it('drops a byte-order mark instead of printing it', () => {
    const blocks = parseMarkdown('﻿Başlangıç\n');
    const paragraph = blocks[0];
    if (paragraph?.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(paragraph.spans.map((s) => s.text).join('')).toBe('Başlangıç');
  });

  it('does not treat a lone dollar sign as maths', () => {
    expect(splitInlineMath('costs $5 and rises', { text: '' })).toEqual([
      { text: 'costs $5 and rises' },
    ]);
  });

  it('flattens tables, nested lists and blockquotes', () => {
    const blocks = parseMarkdown(
      '| A | B |\n|---|--:|\n| 1 | 2 |\n\n- outer\n  - inner\n\n> quoted\n',
    );
    const table = blocks.find((b) => b.kind === 'table');
    expect(table).toMatchObject({ kind: 'table', align: ['left', 'right'] });
    const depths = blocks.filter((b) => b.kind === 'listItem').map((b) => b.depth);
    expect(depths).toEqual([0, 1]);
    expect(blocks.find((b) => b.kind === 'paragraph' && b.quoted)).toBeDefined();
  });
});

describe('wrapCodeLine', () => {
  // Verbatim from 03_GPU_ZERO_COPY_AND_RENDER_PIPELINE.md in the calibration
  // corpus — inlined rather than read from disk so the test stays hermetic and
  // free of machine-absolute paths.
  const RUST_112 =
    '    /// Maps AVFrame properties (colorspace, color_range, format) directly to Vulkan YCbCr conversion parameters';

  it('is the real 112-character line the corpus contains', () => {
    expect(RUST_112).toHaveLength(112);
  });

  it('wraps that line into two rows, the second indented', () => {
    const inner = PRINTABLE_WIDTH - DEFAULT_TYPOGRAPHY.codePadding * 2;
    const rows = wrapCodeLine(RUST_112, inner, DEFAULT_TYPOGRAPHY.codeSize, metrics);

    expect(rows).toHaveLength(2);
    expect(CODE_WRAP_INDENT).toBe('  ');
    expect(rows[1].startsWith('  ')).toBe(true);
    expect(rows[1]).not.toBe(rows[1].trimStart());
    // Nothing is lost or duplicated by the break.
    expect(rows[0] + rows[1].slice(CODE_WRAP_INDENT.length)).toBe(RUST_112);
    for (const row of rows) {
      expect(metrics.widthOfText(row, DEFAULT_TYPOGRAPHY.codeSize, 'mono')).toBeLessThanOrEqual(inner);
    }
  });

  it('leaves a line that already fits untouched, and keeps blank lines', () => {
    expect(wrapCodeLine('fn main() {}', 400, 8, metrics)).toEqual(['fn main() {}']);
    expect(wrapCodeLine('', 400, 8, metrics)).toEqual(['']);
  });

  it('breaks by character, never re-flowing a diagram row', () => {
    const diagram = `├${'─'.repeat(40)}►`;
    const rows = wrapCodeLine(diagram, 20 * 8 * RATIOS.mono, 8, metrics);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r, i) => (i === 0 ? r : r.slice(CODE_WRAP_INDENT.length))).join('')).toBe(diagram);
  });
});

describe('wrapSpans', () => {
  it('greedily fills lines and never exceeds the column', () => {
    const spans = [{ text: 'one two three four five six seven eight nine ten' }];
    const lines = wrapSpans(spans, 10 * 9.5 * RATIOS.body, 9.5, metrics);
    expect(lines.length).toBeGreaterThan(1);
    for (const runs of lines) {
      const width = runs.reduce((sum, run) => sum + metrics.widthOfText(run.text, run.size, run.font), 0);
      expect(width).toBeLessThanOrEqual(10 * 9.5 * RATIOS.body + 1e-9);
    }
  });

  it('keeps emphasis on both halves of a phrase split across lines', () => {
    const spans = [{ text: 'aaa ' }, { text: 'bold words here', bold: true }];
    const lines = wrapSpans(spans, 8 * 9.5 * RATIOS.body, 9.5, metrics);
    const boldLines = lines.filter((runs) => runs.some((run) => run.font === 'bold'));
    expect(boldLines.length).toBeGreaterThan(1);
  });

  it('character-breaks a single token wider than the whole column', () => {
    const lines = wrapSpans([{ text: 'A'.repeat(60) }], 10 * 9.5 * RATIOS.body, 9.5, metrics);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((runs) => runs.map((r) => r.text).join('')).join('')).toBe('A'.repeat(60));
  });

  it('offsets runs from the given left edge', () => {
    const [runs] = wrapSpans([{ text: 'hi' }], 200, 9.5, metrics, 36);
    expect(runs[0].x).toBe(36);
  });

  it('draws a rule over struck text, above the baseline and no wider than the run', () => {
    const pages = layoutDocument(parseMarkdown('Bu ~~yanlış~~ doğru.\n'), metrics);
    const rects = pages
      .flatMap((page) => page.items)
      .filter((item): item is Extract<typeof item, { kind: 'rect' }> => item.kind === 'rect');
    const strikes = rects.filter((rect) => rect.role === 'strike');
    expect(strikes).toHaveLength(1);

    const line = pages
      .flatMap((page) => page.items)
      .find((item): item is LayoutLine => item.kind === 'line');
    if (!line) throw new Error('expected a line');
    const run = line.runs.find((r) => r.strike);
    if (!run) throw new Error('expected a struck run');

    // Over the text, not through the descenders and not floating above it.
    expect(strikes[0].y).toBeGreaterThan(line.y);
    expect(strikes[0].y).toBeLessThan(line.y + run.size * 0.536);
    expect(strikes[0].x).toBeCloseTo(run.x, 6);
    expect(strikes[0].width).toBeCloseTo(run.width as number, 6);
    expect(strikes[0].height).toBeGreaterThan(0);
  });

  it('leaves prose that was never struck without a rule', () => {
    const pages = layoutDocument(parseMarkdown('Bu doğru.\n'), metrics);
    const strikes = pages
      .flatMap((page) => page.items)
      .filter((item) => item.kind === 'rect' && item.role === 'strike');
    expect(strikes).toEqual([]);
  });

  it('keeps a struck run apart from its neighbours and measures it', () => {
    const [runs] = wrapSpans(
      [{ text: 'bu ' }, { text: 'yanlış', strike: true }, { text: ' doğru' }],
      400,
      9.5,
      metrics,
    );
    const struck = runs.filter((run) => run.strike);
    expect(struck).toHaveLength(1);
    expect(struck[0].text).toBe('yanlış');
    expect(struck[0].width).toBeCloseTo(metrics.widthOfText('yanlış', 9.5, 'body'), 6);
    expect(runs.filter((run) => run.strike !== true).length).toBeGreaterThan(0);
  });

  it('enlarges a fallback run of the short mono glyphs so it sits in running text', () => {
    // Noto Sans Mono draws U+2192 234/1000 em tall against an x-height of 536,
    // so a fallback run left at text size reads as a subscript.
    const [runs] = wrapSpans([{ text: '→', mono: true, fallback: true }], 200, 9.5, metrics);
    expect(runs[0].size).toBeCloseTo(9.5 * SMALL_MONO_FALLBACK_SCALE, 6);
  });

  it('leaves a fallback run of normally-sized glyphs at text size', () => {
    // U+25B2 measures 585 tall in the same face and needs no help.
    const [runs] = wrapSpans([{ text: '▲', mono: true, fallback: true }], 200, 9.5, metrics);
    expect(runs[0].size).toBe(9.5);
  });

  it('leaves a real code span at text size even when it holds an arrow', () => {
    // A code span must stay aligned with the code blocks around it, so the
    // enlargement is keyed on `fallback`, not on the character or the face.
    const [runs] = wrapSpans([{ text: '→', mono: true }], 200, 9.5, metrics);
    expect(runs[0].size).toBe(9.5);
  });

  it('does not enlarge a fallback run that mixes short and normal glyphs', () => {
    // The renderer splits these apart, but the sizing rule has to be safe on
    // its own: enlarging a run because of one character would blow up the rest.
    const [runs] = wrapSpans([{ text: '→▲', mono: true, fallback: true }], 200, 9.5, metrics);
    expect(runs[0].size).toBe(9.5);
  });
});

describe('longestWordWidth', () => {
  it('measures the widest single word, not the whole run', () => {
    // The widest word sits in the MIDDLE on purpose: a implementation that
    // simply keeps the last word measured would pass an ascending list.
    const spans = [{ text: 'a cccc bb' }];
    expect(longestWordWidth(spans, 10, metrics)).toBeCloseTo(4 * 10 * RATIOS.body, 9);
  });

  it('spans several runs, keeping the widest across all of them', () => {
    const spans = [{ text: 'aaaaaa' }, { text: 'bb' }];
    expect(longestWordWidth(spans, 10, metrics)).toBeCloseTo(6 * 10 * RATIOS.body, 9);
  });

  it('measures each span in the face it will be drawn with', () => {
    // The same four characters are wider in mono than in body.
    const body = longestWordWidth([{ text: 'abcd' }], 10, metrics);
    const mono = longestWordWidth([{ text: 'abcd', mono: true }], 10, metrics);
    expect(mono).toBeGreaterThan(body);
  });

  it('is zero for empty or whitespace-only content', () => {
    expect(longestWordWidth([], 10, metrics)).toBe(0);
    expect(longestWordWidth([{ text: '   ' }], 10, metrics)).toBe(0);
  });
});

describe('computeColumnWidths', () => {
  it('leaves columns at their natural width when the table fits', () => {
    expect(computeColumnWidths([50, 60], 200)).toEqual([50, 60]);
  });

  it('takes the overflow from the slack, never below the floor', () => {
    const widths = computeColumnWidths([30, 400], 200);
    expect(widths[0] + widths[1]).toBeCloseTo(200, 6);
    // The narrow column keeps almost all of its width; the wide one absorbs the cut.
    expect(widths[0]).toBeGreaterThan(24);
    expect(widths[1]).toBeLessThan(400);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });

  it('gives every column its longest word before sharing out the surplus', () => {
    // The real technology table from 02_SYSTEM_ARCHITECTURE in the calibration
    // corpus: natural widths 191/146/1390pt into a 348.94pt column, with
    // longest words of 76/76/151pt. Those three minimums total 303pt and so
    // fit — no column may be pushed below its own longest word.
    const natural = [191, 146, 1390];
    const minimums = [76, 76, 151];
    const widths = computeColumnWidths(natural, 348.94, minimums);

    widths.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(minimums[i]));
    expect(widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(348.94, 6);
    // The widest column still ends up widest — the fix redistributes, it does
    // not equalise.
    expect(widths[2]).toBeGreaterThan(widths[0]);
    expect(widths[2]).toBeGreaterThan(widths[1]);
  });

  it('never lifts a column above the width it actually needs', () => {
    // A minimum larger than the column's own content must not inflate it.
    const widths = computeColumnWidths([30, 400], 200, [500, 40]);
    expect(widths[0]).toBeLessThanOrEqual(30);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(200, 6);
  });

  it('shares the width proportionally when even the longest words overflow', () => {
    // Unbreakable content wider than the page: the table cannot be saved, but
    // the damage is spread rather than dumped on one column, and the row still
    // fits the printable width.
    const widths = computeColumnWidths([300, 300], 200, [300, 100]);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBeCloseTo(200, 6);
    expect(widths[0]).toBeGreaterThan(widths[1]);
  });
});

describe('layoutDocument', () => {
  const body = (n: number): MdBlock[] =>
    Array.from({ length: n }, (_, i) => ({ kind: 'paragraph', spans: [{ text: `p${i}` }] }) as MdBlock);

  it('keeps every drawn item inside the page margins', () => {
    const source =
      '# Chapter\n\nSome prose that is long enough to wrap across the column at least once.\n\n' +
      '| Column one | Column two | Column three |\n|---|---|---|\n| a | b | c |\n\n' +
      '```rust\n' +
      'fn very_long_function_name_that_definitely_overflows(argument: &SomeVeryLongTypeName) -> Result<(), Error> {}\n' +
      '```\n\n- list item\n  - nested item\n';
    const pages = layoutDocument(parseMarkdown(source), metrics);

    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      for (const item of page.items) {
        if (item.kind === 'line') {
          expect(item.y).toBeGreaterThanOrEqual(DEFAULT_MARGIN - DEFAULT_TYPOGRAPHY.bodyLeading);
          expect(item.y).toBeLessThanOrEqual(A5_PAGE.height - DEFAULT_MARGIN);
          for (const run of item.runs) {
            expect(run.x).toBeGreaterThanOrEqual(DEFAULT_MARGIN - 1e-9);
            const right = run.x + metrics.widthOfText(run.text, run.size, run.font);
            expect(right).toBeLessThanOrEqual(A5_PAGE.width - DEFAULT_MARGIN + 1e-6);
          }
        } else {
          expect(item.x).toBeGreaterThanOrEqual(DEFAULT_MARGIN - 1e-9);
          expect(item.x + item.width).toBeLessThanOrEqual(A5_PAGE.width - DEFAULT_MARGIN + 1e-6);
        }
      }
    }
  });

  it('moves a sub-heading to the next page rather than stranding it', () => {
    // Deterministic geometry: margin 0 and a 120pt page make the printable
    // column exactly 6 body blocks tall (13pt line + 7pt gap). Five paragraphs
    // leave 20pt — room for the 17pt heading itself, but not for the heading
    // plus its first line of body text, which is precisely the case
    // keepWithNext exists to catch.
    const blocks: MdBlock[] = [
      ...body(5),
      { kind: 'heading', level: 2, spans: [{ text: 'Stranded?' }] },
      ...body(1),
    ];
    const pages = layoutDocument(blocks, metrics, { pageWidth: 300, pageHeight: 120, margin: 0 });

    expect(pages).toHaveLength(2);
    expect(linesOf(pages[0]).map(textOf)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(linesOf(pages[1]).map(textOf)).toEqual(['Stranded?', 'p0']);
  });

  it('never strands a sub-heading as the last line on a page', () => {
    // Enough prose to run past one page several times over, with sub-headings
    // sprinkled at positions that would otherwise land at the foot of a page.
    const blocks: MdBlock[] = [];
    for (let i = 0; i < 12; i++) {
      blocks.push(...body(7));
      blocks.push({ kind: 'heading', level: 2, spans: [{ text: `Section ${i}` }] });
      blocks.push(...body(3));
    }
    const pages = layoutDocument(blocks, metrics);
    expect(pages.length).toBeGreaterThan(2);

    for (const page of pages) {
      const lines = linesOf(page);
      lines.forEach((line, index) => {
        const isHeading = line.runs.some((run) => run.size === DEFAULT_TYPOGRAPHY.headingSizes[1]);
        if (isHeading) expect(index).toBeLessThan(lines.length - 1);
      });
    }
  });

  it('hangs a wrapped list item under its text, not under its bullet', () => {
    const blocks: MdBlock[] = [
      { kind: 'listItem', depth: 0, marker: '\u2022', spans: [{ text: 'wrap '.repeat(40) }] },
    ];
    const [page] = layoutDocument(blocks, metrics);
    const lines = linesOf(page);
    expect(lines.length).toBeGreaterThan(1);

    // Only the first row carries the bullet...
    expect(lines[0].runs[0].text).toBe('\u2022');
    for (const line of lines.slice(1)) {
      expect(line.runs.some((run) => run.text === '\u2022')).toBe(false);
    }
    // ...and every continuation row starts where the first row's TEXT starts.
    const textX = lines[0].runs[1].x;
    expect(textX).toBeGreaterThan(lines[0].runs[0].x);
    for (const line of lines.slice(1)) expect(line.runs[0].x).toBe(textX);
  });

  it('opens every H1 on a fresh page', () => {
    const blocks: MdBlock[] = [
      { kind: 'heading', level: 1, spans: [{ text: 'First' }] },
      ...body(3),
      { kind: 'heading', level: 1, spans: [{ text: 'Second' }] },
      ...body(3),
    ];
    const pages = layoutDocument(blocks, metrics);
    expect(pages).toHaveLength(2);
    expect(textOf(linesOf(pages[0])[0])).toBe('First');
    expect(textOf(linesOf(pages[1])[0])).toBe('Second');
  });

  it('splits a long fenced block across pages and backs every row', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `let value_${i} = compute(${i});`);
    const pages = layoutDocument([{ kind: 'code', lang: 'rust', lines }], metrics);
    expect(pages.length).toBeGreaterThan(1);

    const drawn = pages.flatMap((page) => linesOf(page).map(textOf));
    expect(drawn).toEqual(lines);
    for (const page of pages) {
      const rects = page.items.filter((item) => item.kind === 'rect' && item.role === 'codeBackground');
      expect(rects).toHaveLength(linesOf(page).length);
    }
  });

  it('takes a column minimum from its body rows, not just its header', () => {
    // The header word is short; the long word is down in the data. Measuring
    // only the header would squeeze this column and break 'Supercalifragilistic'.
    const table: MdBlock = {
      kind: 'table',
      align: ['left', 'left'],
      header: [[{ text: 'A' }], [{ text: 'B' }]],
      rows: [[[{ text: 'Supercalifragilistic' }], [{ text: 'short words here and more of them' }]]],
    };
    const pages = layoutDocument([table], metrics, { pageWidth: 160, pageHeight: 400, margin: 0 });
    const drawn = pages.flatMap((page) => linesOf(page)).flatMap((line) => textOf(line).split(/\s+/));
    expect(drawn).toContain('Supercalifragilistic');
  });

  it('counts the cell padding inside a column minimum', () => {
    // Geometry tuned so the floors are all but binding: column A needs 38pt of
    // text plus 2x4pt padding. If the padding is left out of the minimum, the
    // column is handed 42pt, its 34pt text area is too narrow, and the word
    // breaks.
    const table: MdBlock = {
      kind: 'table',
      align: ['left', 'left'],
      header: [[{ text: 'AAAAAAAA xx' }], [{ text: 'BBBBBBBBBB yy yy yy yy' }]],
      rows: [[[{ text: 'AAAAAAAA xx' }], [{ text: 'BBBBBBBBBB yy yy yy yy' }]]],
    };
    const pages = layoutDocument([table], metrics, { pageWidth: 102, pageHeight: 400, margin: 0 });
    const drawn = pages.flatMap((page) => linesOf(page)).flatMap((line) => textOf(line).split(/\s+/)).filter(Boolean);
    expect(drawn).toContain('AAAAAAAA');
    expect(drawn).toContain('BBBBBBBBBB');
    for (const word of drawn) expect(['AAAAAAAA', 'BBBBBBBBBB', 'xx', 'yy']).toContain(word);
  });

  it('lays out a real corpus table without breaking a single word', () => {
    // Shape and content taken from the technology table in
    // 02_SYSTEM_ARCHITECTURE: two narrow label columns beside one very wide
    // prose column. Before min-content allocation the labels were broken into
    // fragments like 'Selecte' / 'd'.
    const cells = (text: string) => [{ text }];
    const table: MdBlock = {
      kind: 'table',
      align: ['left', 'left', 'left'],
      header: [cells('Layer / Responsibility'), cells('Selected Technology / Library'), cells('Rationale and Rejected Alternatives')],
      rows: [
        [
          cells('Primary Programming Language'),
          cells('Rust (2024 Edition)'),
          cells('Zero-cost abstraction, RAII-based memory release, C ABI compatibility, compile-time prevention of data races.'),
        ],
        [
          cells('Graphical User Interface (GUI)'),
          cells('Slint (Native Backend)'),
          cells('Compiles directly into the Rust binary, GPU-based ultra-light rendering, native theme support.'),
        ],
      ],
    };

    const sourceWords = new Set(
      [table.header, ...table.rows]
        .flat(2)
        .flatMap((span) => span.text.split(/\s+/))
        .filter((word) => word.length > 0),
    );

    const pages = layoutDocument([table], metrics);
    const drawn = pages
      .flatMap((page) => linesOf(page))
      .flatMap((line) => textOf(line).split(/\s+/))
      .filter((word) => word.length > 0);

    expect(drawn.length).toBeGreaterThan(10);
    // Every word that reached the page is a whole word from the source: a
    // character-level break would put fragments like 'Selecte' in here.
    for (const word of drawn) expect(sourceWords.has(word)).toBe(true);
  });

  it('repeats the header row when a table spills onto the next page', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [
      [{ text: `row ${i}` }],
      [{ text: `value ${i}` }],
    ]);
    const pages = layoutDocument(
      [{ kind: 'table', align: ['left', 'left'], header: [[{ text: 'Name' }], [{ text: 'Value' }]], rows }],
      metrics,
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(pageText(page)).toContain('Name');
  });

  it('respects a caller-supplied page size and margin', () => {
    const pages = layoutDocument(body(40), metrics, {
      pageWidth: 300,
      pageHeight: 200,
      margin: 10,
    });
    for (const page of pages) {
      for (const line of linesOf(page)) {
        expect(line.y).toBeGreaterThan(0);
        expect(line.y).toBeLessThan(200);
      }
    }
    expect(pages.length).toBeGreaterThan(2);
  });
});

/**
 * Two drawn lines overprint when their vertical bands and their horizontal
 * extents both intersect. A line occupies roughly [y, y + ascent]; the stub
 * metrics put ascent at 0.75x the type size.
 */
const overprints = (a: LayoutLine, b: LayoutLine): boolean => {
  const band = (line: LayoutLine) => Math.max(...line.runs.map((run) => run.size)) * 0.75;
  if (Math.abs(a.y - b.y) >= Math.min(band(a), band(b)) - 1e-6) return false;
  const extent = (line: LayoutLine) => {
    const xs = line.runs.map((run) => run.x);
    const rights = line.runs.map((run) => run.x + metrics.widthOfText(run.text, run.size, run.font));
    return [Math.min(...xs), Math.max(...rights)] as const;
  };
  const [ax0, ax1] = extent(a);
  const [bx0, bx1] = extent(b);
  return ax0 < bx1 - 1e-6 && bx0 < ax1 - 1e-6;
};

const overprintingPairs = (pages: LayoutPage[]): number => {
  let hits = 0;
  for (const page of pages) {
    const lines = linesOf(page).filter((line) => line.runs.length > 0);
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (overprints(lines[i], lines[j])) hits++;
      }
    }
  }
  return hits;
};

describe('table rows carried onto a new page', () => {
  // Regression: the header-repeat path laid the carried row out from the old
  // page top and then shifted it down, but advanced the cursor by the HEADER's
  // height instead of the row's. A row taller than the header therefore had the
  // next row printed on top of it — visible as garbled text in the booklet.
  const spillingTable = (): MdBlock => ({
    kind: 'table',
    align: ['left', 'left'],
    header: [[{ text: 'H' }], [{ text: 'H2' }]],
    rows: Array.from({ length: 12 }, (_, i) => [
      [{ text: `r${i}` }],
      [{ text: 'long cell text that wraps over several lines '.repeat(2) }],
    ]),
  });

  it('never prints two lines on top of each other', () => {
    const pages = layoutDocument([spillingTable()], metrics, {
      pageWidth: 200,
      pageHeight: 150,
      margin: 0,
    });
    expect(pages.length).toBeGreaterThan(1);
    expect(overprintingPairs(pages)).toBe(0);
  });

  it('repeats the header and still leaves the carried row intact', () => {
    const pages = layoutDocument([spillingTable()], metrics, {
      pageWidth: 200,
      pageHeight: 150,
      margin: 0,
    });
    // Every page shows the header...
    for (const page of pages) expect(pageText(page)).toContain('H2');
    // ...and no row's text is lost to the shift.
    const drawn = pages.flatMap((page) => linesOf(page).map(textOf)).join(' ');
    for (let i = 0; i < 12; i++) expect(drawn).toContain(`r${i}`);
  });

  it('keeps a mixed document free of overprinting at every preset', () => {
    const blocks: MdBlock[] = [];
    for (let i = 0; i < 4; i++) {
      blocks.push({ kind: 'heading', level: 2, spans: [{ text: `Section ${i}` }] });
      blocks.push({ kind: 'paragraph', spans: [{ text: 'prose '.repeat(40) }] });
      blocks.push(spillingTable());
      blocks.push({ kind: 'code', lang: null, lines: Array.from({ length: 8 }, (_, n) => `line ${n}`) });
    }
    for (const preset of Object.values(TYPOGRAPHY_PRESETS)) {
      expect(overprintingPairs(layoutDocument(blocks, metrics, { typography: preset }))).toBe(0);
    }
  });
});

describe('layoutDocuments', () => {
  const doc = (name: string, text: string) => ({ name, blocks: parseMarkdown(text) });

  it('starts each document on its own page and tags every page with its index', () => {
    const pages = layoutDocuments(
      [doc('a.md', 'alpha\n'), doc('b.md', 'beta\n'), doc('c.md', 'gamma\n')],
      metrics,
    );
    expect(pages.map((page) => page.docIndex)).toEqual([0, 1, 2]);
    expect(pageText(pages[1])).toContain('beta');
  });

  it('pads a chapter to an even page count so the next one opens on a recto', () => {
    const pages = layoutDocuments([doc('a.md', 'alpha\n'), doc('b.md', 'beta\n')], metrics, {
      padDocumentsToEven: true,
    });
    expect(pages).toHaveLength(4);
    expect(pages[1].items).toHaveLength(0);
    expect(pages.map((page) => page.docIndex)).toEqual([0, 0, 1, 1]);
  });

  it('lays the whole printable column out without overflowing the page height', () => {
    const pages = layoutDocuments([doc('a.md', 'word '.repeat(4000))], metrics);
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const ys = linesOf(page).map((line) => line.y);
      expect(Math.min(...ys)).toBeGreaterThan(DEFAULT_MARGIN - DEFAULT_TYPOGRAPHY.bodyLeading);
      expect(Math.max(...ys)).toBeLessThanOrEqual(A5_PAGE.height - DEFAULT_MARGIN);
      expect(linesOf(page).length).toBeLessThanOrEqual(
        Math.ceil(PRINTABLE_HEIGHT / DEFAULT_TYPOGRAPHY.bodyLeading),
      );
    }
  });
});

describe('scaleTypography', () => {
  it('moves size and leading together, so lines cannot collide', () => {
    const out = scaleTypography(DEFAULT_TYPOGRAPHY, 2);
    expect(out.bodySize).toBe(19);
    expect(out.bodyLeading).toBe(26);
    expect(out.headingSizes).toEqual([32, 26, 22]);
    expect(out.headingLeadings).toEqual([40, 34, 30]);
    expect(out.blockGap).toBe(14);
    expect(out.listIndent).toBe(28);
  });

  it('scales code independently when a second factor is given', () => {
    const out = scaleTypography(DEFAULT_TYPOGRAPHY, 2, 1);
    // Body doubled...
    expect(out.bodySize).toBe(19);
    // ...code untouched, which is the whole point: fenced lines break rather
    // than reflow, so enlarging body text must not enlarge code with it.
    expect(out.codeSize).toBe(DEFAULT_TYPOGRAPHY.codeSize);
    expect(out.codeLeading).toBe(DEFAULT_TYPOGRAPHY.codeLeading);
    expect(out.codePadding).toBe(DEFAULT_TYPOGRAPHY.codePadding);
  });

  it('defaults the code factor to the body factor', () => {
    expect(scaleTypography(DEFAULT_TYPOGRAPHY, 2)).toEqual(scaleTypography(DEFAULT_TYPOGRAPHY, 2, 2));
  });

  it('leaves a preset untouched at scale 1', () => {
    expect(scaleTypography(DEFAULT_TYPOGRAPHY, 1)).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('rounds to two decimals rather than carrying long fractions', () => {
    // 9.5 / 3 is 3.1666666666666665; the preset must not carry that into the
    // PDF, nor into any width computed from it.
    const out = scaleTypography(DEFAULT_TYPOGRAPHY, 1 / 3);
    expect(out.bodySize).toBe(3.17);
    expect(out.bodyLeading).toBe(4.33);
    expect(out.headingSizes).toEqual([5.33, 4.33, 3.67]);
    // And an exact ratio still lands exactly.
    expect(scaleTypography(DEFAULT_TYPOGRAPHY, 8 / 9.5).bodySize).toBe(8);
  });

  it('rejects a scale that is not a positive finite number', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => scaleTypography(DEFAULT_TYPOGRAPHY, bad)).toThrow(BookletError);
      expect(() => scaleTypography(DEFAULT_TYPOGRAPHY, 1, bad)).toThrow(BookletError);
    }
    expect(() => scaleTypography(DEFAULT_TYPOGRAPHY, 0)).toThrow(
      expect.objectContaining({ code: 'MARKDOWN_INVALID_TYPE_SCALE' }),
    );
  });
});

describe('TYPOGRAPHY_PRESETS', () => {
  it('carries the four calibrated sizes exactly as specified', () => {
    expect(TYPOGRAPHY_PRESETS.compact).toMatchObject({
      bodySize: 8, bodyLeading: 11, codeSize: 7.5, codeLeading: 9.5,
    });
    expect(TYPOGRAPHY_PRESETS.standard).toMatchObject({
      bodySize: 9.5, bodyLeading: 13, codeSize: 8, codeLeading: 10.5,
    });
    expect(TYPOGRAPHY_PRESETS.large).toMatchObject({
      bodySize: 11, bodyLeading: 15, codeSize: 8.5, codeLeading: 11,
    });
  });

  it('keeps standard identical to the engine default', () => {
    expect(TYPOGRAPHY_PRESETS.standard).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('holds code nearly still while body moves', () => {
    const { compact, large } = TYPOGRAPHY_PRESETS;
    const bodySpread = large.bodySize / compact.bodySize;
    const codeSpread = large.codeSize / compact.codeSize;
    expect(bodySpread).toBeGreaterThan(1.3);
    // Code spans a far narrower range — otherwise the large preset would
    // multiply the number of soft-wrapped code lines.
    expect(codeSpread).toBeLessThan(1.2);
    expect(large.codeSize).toBeLessThanOrEqual(8.5);
  });

  it('scales headings and gaps in proportion, not just the body', () => {
    expect(TYPOGRAPHY_PRESETS.large.headingSizes[0]).toBeGreaterThan(
      TYPOGRAPHY_PRESETS.standard.headingSizes[0],
    );
    expect(TYPOGRAPHY_PRESETS.compact.headingSizes[0]).toBeLessThan(
      TYPOGRAPHY_PRESETS.standard.headingSizes[0],
    );
    expect(TYPOGRAPHY_PRESETS.compact.blockGap).toBeLessThan(DEFAULT_TYPOGRAPHY.blockGap);
    expect(TYPOGRAPHY_PRESETS.large.listIndent).toBeGreaterThan(DEFAULT_TYPOGRAPHY.listIndent);
  });

  it('gives every preset a leading taller than its own type size', () => {
    for (const preset of Object.values(TYPOGRAPHY_PRESETS)) {
      expect(preset.bodyLeading).toBeGreaterThan(preset.bodySize);
      expect(preset.codeLeading).toBeGreaterThan(preset.codeSize);
      preset.headingSizes.forEach((size, i) => {
        expect(preset.headingLeadings[i]).toBeGreaterThan(size);
      });
    }
  });
});

describe('column floor follows the type size', () => {
  it('defaults to 2.5x the default body size', () => {
    expect(MIN_COLUMN_WIDTH).toBe(24); // 9.5 * 2.5, rounded
  });

  it('honours a caller-supplied absolute floor', () => {
    // A narrow column (30pt natural) beside a very wide one, squeezed into
    // 200pt: the floor is the only thing protecting the narrow column, so
    // raising it must widen that column.
    const low = computeColumnWidths([30, 400], 200, [], 20);
    const high = computeColumnWidths([30, 400], 200, [], 40);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(low.reduce((a, b) => a + b, 0)).toBeCloseTo(200, 6);
    expect(high.reduce((a, b) => a + b, 0)).toBeCloseTo(200, 6);
  });

  it('lays tables out against the SCALED floor, not the default one', () => {
    // A narrow first column beside a very wide second one, squeezed: the
    // absolute floor is what decides the first column's width. At the compact
    // preset (8pt body) that floor is round(8 * 2.5) = 20pt, not the 24pt that
    // belongs to the 9.5pt default — and the two produce different layouts.
    const typography = TYPOGRAPHY_PRESETS.compact;
    const table: MdBlock = {
      kind: 'table',
      align: ['left', 'left'],
      header: [[{ text: 'ab cd' }], [{ text: 'B' }]],
      rows: [[[{ text: 'ab cd' }], [{ text: 'wide '.repeat(30) }]]],
    };
    const [page] = layoutDocument([table], metrics, {
      typography,
      pageWidth: 200,
      pageHeight: 600,
      margin: 0,
    });

    // The second column's runs start just past the first column's width.
    const secondColumnX = Math.min(
      ...linesOf(page)
        .flatMap((line) => line.runs)
        .filter((run) => run.text.trim().startsWith('wide') || run.text.trim() === 'B')
        .map((run) => run.x),
    );

    const size = typography.bodySize;
    const widthOf = (spans: string[]) => spans.reduce((sum, w) => sum + metrics.widthOfText(w, size, 'body'), 0);
    const natural = [widthOf(['ab cd']) + 8, widthOf(['wide '.repeat(30)]) + 8];
    const minimums = [widthOf(['ab']) + 8, widthOf(['wide']) + 8];

    const scaledFloor = computeColumnWidths(natural, 200, minimums, Math.round(size * 2.5));
    const defaultFloor = computeColumnWidths(natural, 200, minimums, MIN_COLUMN_WIDTH);

    // The two floors genuinely disagree here — otherwise this proves nothing.
    expect(scaledFloor[0]).not.toBeCloseTo(defaultFloor[0], 3);
    expect(secondColumnX).toBeCloseTo(scaledFloor[0] + 4, 3);
  });
});

describe('layout invariants across type sizes', () => {
  const source: MdBlock[] = [
    { kind: 'heading', level: 1, spans: [{ text: 'Chapter with a fairly long title that wraps' }] },
    { kind: 'paragraph', spans: [{ text: 'prose '.repeat(60) }] },
    { kind: 'code', lang: 'rust', lines: ['let x = compute(argument_with_a_very_long_name, another_one);'] },
    { kind: 'table', align: ['left', 'left'], header: [[{ text: 'Name' }], [{ text: 'Rationale and notes' }]], rows: [[[{ text: 'Alpha' }], [{ text: 'some explanatory text here' }]]] },
    { kind: 'listItem', depth: 0, marker: '\u2022', spans: [{ text: 'bullet '.repeat(20) }] },
  ];

  it('never draws outside the printable column, at any scale', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.7, max: 1.6, noNaN: true }), (bodyScale) => {
        const typography = scaleTypography(DEFAULT_TYPOGRAPHY, bodyScale);
        const pages = layoutDocument(source, metrics, { typography });
        for (const page of pages) {
          for (const item of page.items) {
            if (item.kind !== 'line') continue;
            for (const run of item.runs) {
              const right = run.x + metrics.widthOfText(run.text, run.size, run.font);
              if (run.x < DEFAULT_MARGIN - 1e-6) return false;
              if (right > A5_PAGE.width - DEFAULT_MARGIN + 1e-6) return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });

  it('needs more pages as the type grows, never fewer', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.7, max: 1.5, noNaN: true }), (bodyScale) => {
        const small = layoutDocument(source, metrics, {
          typography: scaleTypography(DEFAULT_TYPOGRAPHY, bodyScale),
        }).length;
        const large = layoutDocument(source, metrics, {
          typography: scaleTypography(DEFAULT_TYPOGRAPHY, bodyScale * 1.3),
        }).length;
        return large >= small;
      }),
      { numRuns: 40 },
    );
  });

  it('costs more sheets at each step up the presets', () => {
    const pagesAt = (name: keyof typeof TYPOGRAPHY_PRESETS) =>
      layoutDocument(source, metrics, { typography: TYPOGRAPHY_PRESETS[name] }).length;
    expect(pagesAt('compact')).toBeLessThanOrEqual(pagesAt('standard'));
    expect(pagesAt('standard')).toBeLessThanOrEqual(pagesAt('large'));
  });
});
