import { describe, expect, it } from 'vitest';
import { latexToPlainText, parseMarkdown } from './markdown-parse';
import type { InlineSpan, MdBlock } from './markdown-types';

/**
 * Regression coverage for the `latexSpans -> walk` recursion depth limit.
 *
 * Nested `{...}` groups, `\mathbf`, and `\frac` recurse once per nesting
 * level with no depth limit prior to this fix, so a deeply nested formula
 * overflowed the call stack with a `RangeError` that `renderFormula` did not
 * catch (it only caught `UnprintableLatex`), crashing the whole markdown
 * conversion pipeline instead of degrading to the LaTeX source.
 */

const flat = (src: string): InlineSpan[] => {
  const block: MdBlock | undefined = parseMarkdown(`${src}\n`)[0];
  if (block?.kind !== 'paragraph') throw new Error('expected a paragraph');
  return block.spans;
};

const text = (src: string): string =>
  flat(src)
    .map((s) => s.text)
    .join('');

describe('latexSpans recursion depth limit', () => {
  it('does not crash on 50 levels of bare nested braces and degrades to source', () => {
    const nested = `${'{'.repeat(50)}x${'}'.repeat(50)}`;
    expect(() => flat(`Değer $${nested}$ olur`)).not.toThrow();
    const spans = flat(`Değer $${nested}$ olur`);
    expect(spans.find((s) => s.mono)?.text).toBe(`$${nested}$`);
  });

  it('does not crash on 50 levels of nested \\mathbf and degrades to source', () => {
    const nested = `${'\\mathbf{'.repeat(50)}x${'}'.repeat(50)}`;
    expect(() => flat(`Değer $${nested}$ olur`)).not.toThrow();
    const spans = flat(`Değer $${nested}$ olur`);
    expect(spans.find((s) => s.mono)?.text).toBe(`$${nested}$`);
  });

  it('does not crash on a \\frac numerator nested 50 levels deep and degrades to source', () => {
    // \frac needs two groups; nest the numerator and give a trivial
    // denominator so the token itself is well-formed \frac syntax.
    const formula = `\\frac{${'{'.repeat(50)}x${'}'.repeat(50)}}{y}`;
    expect(() => flat(`Değer $${formula}$ olur`)).not.toThrow();
    const spans = flat(`Değer $${formula}$ olur`);
    expect(spans.find((s) => s.mono)?.text).toBe(`$${formula}$`);
  });

  it('does not crash on a deeply nested display block and returns null', () => {
    const nested = `${'{'.repeat(50)}x${'}'.repeat(50)}`;
    expect(() => latexToPlainText(nested)).not.toThrow();
    expect(latexToPlainText(nested)).toBeNull();
  });

  it('still converts standard, shallow formulas faithfully', () => {
    expect(text('Hattı $\\rightarrow$ DMA-BUF')).toBe('Hattı → DMA-BUF');
    expect(text('Başlangıç $\\le \\mathbf{500\\ ms}$')).toBe('Başlangıç <= 500 ms');
    expect(text('Süre $\\frac{S + 1}{R}$ olur')).toBe('Süre (S + 1) / (R) olur');
    expect(text('Örnekleme $R=96{,}000$ Hz')).toBe('Örnekleme R=96,000 Hz');
    expect(latexToPlainText('\\text{snap}(T) \\equiv T')).toBe('snap(T) == T');
  });
});

describe('formatting commands do not make their group literal', () => {
  it('degrades $\\mathbf{x_1}$ to source monospace instead of printing the underscore', () => {
    const spans = flat('Vektör $\\mathbf{x_1}$ olur');
    expect(spans.find((s) => s.mono)?.text).toBe('$\\mathbf{x_1}$');
    expect(spans.some((s) => s.bold)).toBe(false);
  });

  it('degrades $\\mathrm{x^2}$ to source monospace', () => {
    expect(flat('Kare $\\mathrm{x^2}$ olur').find((s) => s.mono)?.text).toBe('$\\mathrm{x^2}$');
  });

  it('still treats \\text{...} as literal, including inside \\mathbf', () => {
    expect(latexToPlainText('\\text{samples_to_us}')).toBe('samples_to_us');
    expect(latexToPlainText('\\mathbf{\\text{a_b}}')).toBe('a_b');
  });
});

describe('display math detection', () => {
  it('does not read two $$ blocks with prose between them as one display block', () => {
    const blocks = parseMarkdown('$$ a $$ text $$ b $$\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
  });

  it('still reads a paragraph that is exactly one $$ block as display math', () => {
    expect(parseMarkdown('$$ a + b $$\n')[0]).toEqual({ kind: 'math', lines: ['a + b'] });
  });
});

describe('HTML stripping keeps generic type parameters', () => {
  it.each(['Vec<U>', 'Option<S>', 'Box<B>', 'Result<a>'])('preserves %s', (source) => {
    expect(text(`Tip ${source} döner`)).toBe(`Tip ${source} döner`);
  });

  it('still strips real multi-letter HTML elements', () => {
    expect(text('H<sub>2</sub>O')).toBe('H2O');
  });

  it('still strips real one-letter HTML elements with attributes or closing tags', () => {
    expect(text('See <a href="https://x.io">docs</a> and <b>bold</b>')).toBe('See docs and bold');
  });

  it('replaces <br /> (with trailing space) and <hr /> with a space', () => {
    expect(text('line one<br />line two')).toBe('line one line two');
    expect(text('line one<br/>line two')).toBe('line one line two');
  });

  it('strips block-level HTML tags cleanly', () => {
    const blocks = parseMarkdown('<p align="center"><b>Title</b></p>\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('paragraph');
    expect((blocks[0] as { spans: Array<{ text: string }> }).spans[0].text).toBe('Title');
  });

  it('strips uppercase HTML tag pairs cleanly', () => {
    expect(text('Make <B>loud</B> text')).toBe('Make loud text');
  });

  it('keeps generic <a> parameter when an HTML link tag is also in the block', () => {
    expect(text('Option<a> and <a href="x">link</a>')).toBe('Option<a> and link');
  });
});

describe('escaped dollar signs', () => {
  it('prints \\$ as a literal dollar sign, not as a math delimiter', () => {
    const spans = flat('Set \\$HOME_DIR and \\$PATH');
    expect(spans.map((s) => s.text).join('')).toBe('Set $HOME_DIR and $PATH');
    expect(spans.some((s) => s.mono)).toBe(false);
    expect(spans.some((s) => s.text.includes('\uE000'))).toBe(false);
  });
});
