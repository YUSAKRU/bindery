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
    const nested = '{'.repeat(50) + 'x' + '}'.repeat(50);
    expect(() => flat(`Değer $${nested}$ olur`)).not.toThrow();
    const spans = flat(`Değer $${nested}$ olur`);
    expect(spans.find((s) => s.mono)?.text).toBe(`$${nested}$`);
  });

  it('does not crash on 50 levels of nested \\mathbf and degrades to source', () => {
    const nested = '\\mathbf{'.repeat(50) + 'x' + '}'.repeat(50);
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
    const nested = '{'.repeat(50) + 'x' + '}'.repeat(50);
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
