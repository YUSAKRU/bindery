import { describe, it, expect } from 'vitest';
import { safeFileName, safeBaseName } from './filename';

describe('safeFileName', () => {
  it('keeps a plain name as-is', () => {
    expect(safeFileName('Report')).toBe('Report');
  });

  it('appends .pdf when ensurePdf is set', () => {
    expect(safeFileName('Report', { ensurePdf: true })).toBe('Report.pdf');
  });

  it('replaces illegal path characters', () => {
    expect(safeFileName('a/b')).toBe('a_b');
    expect(safeFileName('a\\b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
  });

  it('rejects a name that resolves to ".."', () => {
    expect(safeFileName('..')).toBe('');
    expect(safeFileName('../../etc/passwd')).not.toContain('/');
  });

  it('rejects a name that resolves to "."', () => {
    expect(safeFileName('.')).toBe('');
  });

  it('rejects whitespace-only input', () => {
    expect(safeFileName('   ')).toBe('');
  });

  it('rejects empty input', () => {
    expect(safeFileName('')).toBe('');
  });

  it('does not double-append when the name already ends in .pdf', () => {
    expect(safeFileName('Report.pdf', { ensurePdf: true })).toBe('Report.pdf');
  });

  it('does not double-append when the name ends in .PDF (case-insensitive)', () => {
    expect(safeFileName('Report.PDF', { ensurePdf: true })).toBe('Report.PDF');
  });

  it('rejects a name made only of illegal characters', () => {
    expect(safeFileName('///')).toBe('');
    expect(safeFileName('***', { ensurePdf: true })).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(safeFileName('  Report  ')).toBe('Report');
  });
});

describe('safeBaseName', () => {
  it('strips a trailing .pdf extension', () => {
    expect(safeBaseName('Report.pdf')).toBe('Report');
  });

  it('strips a trailing .PDF extension case-insensitively', () => {
    expect(safeBaseName('Report.PDF')).toBe('Report');
  });

  it('leaves a name without a .pdf extension unchanged', () => {
    expect(safeBaseName('Report')).toBe('Report');
  });

  it('still sanitizes illegal characters', () => {
    expect(safeBaseName('a/b.pdf')).toBe('a_b');
  });

  it('rejects a name that resolves to ".."', () => {
    expect(safeBaseName('..')).toBe('');
  });
});
