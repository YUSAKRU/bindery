import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveSheetSize } from '../engine/booklet-engine';

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const appSource = readFileSync(appTsPath, 'utf-8');

/** The source text between two known landmarks in app.ts. */
function sourceBetween(from: string, to: string): string {
  const start = appSource.indexOf(from);
  expect(start, `expected to find "${from}" in app.ts`).toBeGreaterThanOrEqual(0);
  const end = appSource.indexOf(to, start);
  expect(end, `expected to find "${to}" after "${from}" in app.ts`).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

/** A function body located by brace-matching from its signature. */
function extractFunctionBody(fnSignature: string): string {
  const start = appSource.indexOf(fnSignature);
  expect(start, `expected to find "${fnSignature}" in app.ts`).toBeGreaterThanOrEqual(0);
  const braceStart = appSource.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    if (appSource[i] === '}') {
      depth--;
      if (depth === 0) return appSource.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated function body for "${fnSignature}"`);
}

describe('Booklet pipeline - Wiring', () => {
  it('resolves the sheet size through the engine, including the cached source size', () => {
    const body = extractFunctionBody('function bookletSheetSize(');
    expect(body).toContain("bookletPaperSize === 'source'");
    expect(body).toContain("bookletSourceSheetSize ?? resolveSheetSize('A4')");
    expect(body).toContain('return resolveSheetSize(bookletPaperSize)');
  });

  it('caches the source sheet size at file-pick time and clears it when the file changes', () => {
    // Resolved once by the worker-side inspection; null (not a throw) when the
    // size is out of bounds, so it never blocks the booklet.
    const preflight = extractFunctionBody('async function showMixedSizeWarningIfNeeded(');
    expect(preflight).toContain('await inspectPdf(bytes)');
    expect(preflight).toContain('bookletSourceSheetSize = sourceSheetSize');
    const load = extractFunctionBody('function loadBookletFile(');
    expect(load).toContain('bookletSourceSheetSize = null');
  });

  it('never parses the picked PDF on the UI thread during preflight', () => {
    const preflight = extractFunctionBody('async function showMixedSizeWarningIfNeeded(');
    expect(preflight).not.toContain('loadAndValidatePdf');
    expect(preflight).toContain("trimBoxNotice.classList.toggle('hidden', trimmedPages === 0)");
    const load = extractFunctionBody('function loadBookletFile(');
    expect(load).toContain("trimBoxNotice.classList.add('hidden')");
  });

  it('computes booklet padding and signatures in one shared metrics helper', () => {
    const summary = extractFunctionBody('function refreshConfigSummary(');
    expect(summary).toContain('const metrics = bookletBlockMetrics()');
    expect(summary).toContain('const { logical, sheets, sigLengths } = metrics');
    expect(summary, 'refreshConfigSummary must not recompute the padding itself').not.toMatch(/Math\.(ceil|floor|round|max)\(/);
    expect(summary).not.toContain('computeSignatureMappings(');

    const helper = sourceBetween('function bookletBlockMetrics(', 'function bookletSheetSize(');
    expect(helper).toContain('computeSignatureMappings(padded, signatureOption())');
    expect(helper).toContain('const separateCover = bookletSeparateCover');
    expect(helper).toContain('const block = separateCover ? logical - 4 : logical');
    expect(helper).toContain('const padded = Math.max(4, Math.ceil(block / 4) * 4)');
    expect(helper).toContain('sheets: padded / 4');
    expect(helper, 'sheets must come from the padded block, never the raw one').not.toContain('sheets: block / 4');
  });

  it('pads a partial last sheet to a whole sheet', () => {
    // 4 pages fit one sheet, and anything past that takes a whole further sheet.
    const sheetsFor = (logical: number) => Math.max(4, Math.ceil(logical / 4) * 4) / 4;
    expect(sheetsFor(1)).toBe(1);
    expect(sheetsFor(4)).toBe(1);
    expect(sheetsFor(5)).toBe(2);
    expect(sheetsFor(8)).toBe(2);
    expect(sheetsFor(9)).toBe(3);
    expect(sheetsFor(53)).toBe(14);
    expect(53 / 4).toBeLessThan(sheetsFor(53));
  });
});

describe('Booklet pipeline - Result screen', () => {
  it('counts optional coverPdf and instructionsPdf in savedPdfCount', () => {
    const body = extractFunctionBody('function savedPdfCount(');
    expect(body).toContain('booklet.coverPdf ? 1 : 0');
    expect(body).toContain('booklet.instructionsPdf ? 1 : 0');
  });

  it('saves booklet outputs privately into the booklet folder without touching recents', () => {
    const save = sourceBetween("bookletSaveBtn.addEventListener('click'", 'bookletGoToLocationBtn.addEventListener');
    expect(save).toContain('savePdfPrivately(booklet.frontPdf, `booklets/${docName}/Front Side.pdf`)');
    expect(save).toContain('savePdfPrivately(booklet.backPdf, `booklets/${docName}/Back Side.pdf`)');
    expect(save).toContain('savePdfPrivately(booklet.combinedPdf, `booklets/${docName}/Combined Booklet.pdf`)');
    expect(save).toContain('savePdfPrivately(booklet.coverPdf, `booklets/${docName}/Cover.pdf`)');
    // Decoupled from recents (Masam) — split sheets are saved to disk and recorded in library, not in recents pool
    expect(save).not.toContain('rememberSaved');
  });
});

describe('Booklet pipeline - Sheet geometry', () => {
  it('an A4-sheet booklet yields an A5 folded half page', () => {
    const [sheetW, sheetH] = resolveSheetSize('A4');
    const mmPerPt = 25.4 / 72;
    const pageWidthMm = (sheetW / 2) * mmPerPt;
    const pageHeightMm = sheetH * mmPerPt;
    expect(pageWidthMm).toBeCloseTo(148.5, 0);
    expect(pageHeightMm).toBeCloseTo(210, 0);
  });
});

describe('Booklet pipeline - Separate cover', () => {
  it('routes every consumer through bookletSeparateCover', () => {
    const consumers: Array<[string, string]> = [
      ['isAdvancedModified', extractFunctionBody('function isAdvancedModified(')],
      ['bookletBlockMetrics', sourceBetween('function bookletBlockMetrics(', 'function bookletSheetSize(')],
      ['refreshConfigSummary', extractFunctionBody('function refreshConfigSummary(')],
      ['makeBooklet call', sourceBetween('const result = await makeBooklet(', 'booklet = {')],
    ];
    for (const [name, body] of consumers) {
      expect(body, `${name} must read bookletSeparateCover`).toContain('bookletSeparateCover');
    }
  });

  it('the raw preference is only ever written by the user’s own click, the reset, a library record, and the too-short rule', () => {
    const assignments = appSource.split('\n').filter((line) => /^\s*bookletSeparateCover =/.test(line));
    expect(assignments).toHaveLength(4);
    expect(assignments.some((l) => l.includes("cover === 'separate'"))).toBe(true);
    expect(assignments.filter((l) => l.trim() === 'bookletSeparateCover = options.separateCover === true;')).toHaveLength(1);
    expect(assignments.filter((l) => l.trim() === 'bookletSeparateCover = false;')).toHaveLength(2);
  });

  it('clears the choice and disables the separate-cover button for a too-short document', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    expect(body).toContain('if (tooFew && bookletSeparateCover) {\n      bookletSeparateCover = false;\n    }');
    expect(body).toContain('separateBtn.disabled = tooFew');
  });

  it('lights the segment from bookletSeparateCover, from one place only', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    expect(body).toContain("setActiveSegment(coverModeGroup, 'cover', bookletSeparateCover ? 'separate' : 'together')");
    const writers = appSource.split('\n').filter((l) => l.includes("setActiveSegment(coverModeGroup, 'cover'"));
    expect(writers).toHaveLength(1);
  });

  it('swaps between the disabled hint and default hint for too-short documents', () => {
    const body = extractFunctionBody('function updateCoverAvailability(');
    const tooFewAt = body.indexOf("t('config.coverDisabledHint')");
    const defaultAt = body.indexOf("t('config.coverHint')");
    expect(tooFewAt).toBeGreaterThan(-1);
    expect(defaultAt).toBeGreaterThan(tooFewAt);
  });

  it('guards separate-cover-on-too-short in bookletBlockMetrics', () => {
    const helper = sourceBetween('function bookletBlockMetrics(', 'function bookletSheetSize(');
    expect(helper).toContain('if (separateCover && bookletOriginalPages < 8) return null');
  });
});
