import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This is a source-level regression test, NOT a rendered-DOM test.
//
// The bug it guards against: loadBookletFile() used to update `selectedFile`
// synchronously but leave `bookletOriginalPages` (and everything derived from
// it — the config summary, the signature hint, the marks hint) pointing at the
// PREVIOUS document until the async showMixedSizeWarningIfNeeded() -> validatePdf()
// call resolved. That produced a visible flash of stale page/signature info
// during Reader -> Booklet transitions.
//
// initApp() is a single large function by project convention (not to be split
// — see AGENTS.md and the 2026-08-09 decision), and loadBookletFile,
// bookletOriginalPages, and refreshConfigSummary are closures inside it, not
// exported. Actually exercising them requires either running initApp() against
// a real DOM or restructuring the module, and this project has no jsdom/
// happy-dom dependency installed (confirmed: not present in node_modules, and
// only listed as an optional peer of vitest) — adding one means editing
// package.json/package-lock.json, which is out of scope for this fix. So
// rather than skip verification, this test asserts the exact ordering
// property that fixes the bug, directly against the source: within
// loadBookletFile(), `bookletOriginalPages` must be reset to 0 and
// refreshConfigSummary() must run BEFORE the async validation call, not after.
// It will fail if the reset is removed, reordered after the async call, or if
// refreshConfigSummary's "hide until a page count is known" guard is dropped.

const appTsPath = fileURLToPath(new URL('./app.ts', import.meta.url));
const source = readFileSync(appTsPath, 'utf-8');

function extractFunctionBody(fnSignature: string): string {
  const start = source.indexOf(fnSignature);
  expect(start, `expected to find "${fnSignature}" in app.ts`).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unterminated function body for "${fnSignature}"`);
}

describe('loadBookletFile (Reader -> Booklet stale-summary flash fix)', () => {
  const body = extractFunctionBody('function loadBookletFile(');

  it('resets bookletOriginalPages to 0 synchronously, before the async validation call', () => {
    const resetIndex = body.indexOf('bookletOriginalPages = 0');
    const asyncCallIndex = body.indexOf('showMixedSizeWarningIfNeeded(');

    expect(resetIndex, 'bookletOriginalPages must be reset inside loadBookletFile').toBeGreaterThanOrEqual(0);
    expect(asyncCallIndex, 'expected the async validation call in loadBookletFile').toBeGreaterThanOrEqual(0);
    expect(resetIndex).toBeLessThan(asyncCallIndex);
  });

  it('refreshes the config summary synchronously, before the async validation call', () => {
    const refreshIndex = body.indexOf('refreshConfigSummary()');
    const asyncCallIndex = body.indexOf('showMixedSizeWarningIfNeeded(');

    expect(refreshIndex, 'refreshConfigSummary() must run inside loadBookletFile').toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeLessThan(asyncCallIndex);
  });

  it('resets the page count before re-rendering, not after', () => {
    const resetIndex = body.indexOf('bookletOriginalPages = 0');
    const refreshIndex = body.indexOf('refreshConfigSummary()');
    expect(resetIndex).toBeLessThan(refreshIndex);
  });
});

describe('refreshConfigSummary guard (mechanism the fix relies on)', () => {
  const body = extractFunctionBody('function refreshConfigSummary(');

  it('still hides the summary/hints when there is no known page count', () => {
    expect(body).toContain('bookletOriginalPages <= 0');
    expect(body).toContain('refreshMarksHint(null)');
    expect(body).toContain('refreshSignatureHint(null)');
  });
});

// F1 (0.4.9 Package B backlog): app-helpers.test.ts covers describeSignatureSplit
// and resolveMarksLabels as pure functions, but the "wiring" that writes their
// output into the DOM — refreshSignatureHint and refreshMarksHint — was untested.
// Same source-level approach as above: no jsdom, and initApp() is one large
// function by convention, so these are closures we can't call directly. We
// extract each function body and assert the exact calls/assignments it makes.
describe('refreshSignatureHint (wiring: describeSignatureSplit result -> DOM text)', () => {
  const body = extractFunctionBody('function refreshSignatureHint(');

  it('writes the static hint when there is no per-signature data, without calling describeSignatureSplit', () => {
    expect(body).toContain('sheetsPerSignature === null || sheetsPerSignature.length === 0');
    expect(body).toContain("signatureHintText.textContent = t('config.signatureHint')");

    const guardIndex = body.indexOf('sheetsPerSignature === null || sheetsPerSignature.length === 0');
    const staticWriteIndex = body.indexOf("signatureHintText.textContent = t('config.signatureHint')");
    const splitCallIndex = body.indexOf('describeSignatureSplit(');
    // The static-hint write must be inside the null/empty guard, i.e. before
    // the describeSignatureSplit call that only runs in the resolved case.
    expect(guardIndex).toBeLessThan(staticWriteIndex);
    expect(staticWriteIndex).toBeLessThan(splitCallIndex);
  });

  it('otherwise derives split from describeSignatureSplit, resolves hint data, and writes to DOM', () => {
    const splitIndex = body.indexOf('const split = describeSignatureSplit(sheetsPerSignature);');
    const resolveIndex = body.indexOf('const { key, params } = resolveSignatureHintData(split, bookletSignature);');
    const writeIndex = body.indexOf('signatureHintText.textContent = t(key, params);');

    expect(splitIndex, 'expected describeSignatureSplit(sheetsPerSignature) to be called').toBeGreaterThanOrEqual(0);
    expect(resolveIndex, 'expected resolveSignatureHintData(split, bookletSignature) to be called').toBeGreaterThanOrEqual(0);
    expect(writeIndex, 'expected signatureHintText.textContent = t(key, params)').toBeGreaterThanOrEqual(0);
    expect(splitIndex).toBeLessThan(resolveIndex);
    expect(resolveIndex).toBeLessThan(writeIndex);
  });
});

describe('refreshMarksHint (wiring: resolveMarksLabels result -> DOM text)', () => {
  const body = extractFunctionBody('function refreshMarksHint(');

  it('derives labels from resolveMarksLabels(bookletMarks, sigs) and writes labels.hintKey to the DOM', () => {
    const resolveCallIndex = body.indexOf('const labels = resolveMarksLabels(bookletMarks, sigs);');
    const writeIndex = body.indexOf('marksHintText.textContent = t(labels.hintKey);');

    expect(resolveCallIndex, 'expected resolveMarksLabels(bookletMarks, sigs) to be called and assigned to `labels`').toBeGreaterThanOrEqual(0);
    expect(writeIndex, 'expected marksHintText to be written from labels.hintKey').toBeGreaterThanOrEqual(0);
    expect(resolveCallIndex).toBeLessThan(writeIndex);
  });

  it('returns the resolved labels to the caller', () => {
    const writeIndex = body.indexOf('marksHintText.textContent = t(labels.hintKey);');
    const returnIndex = body.indexOf('return labels;');

    expect(returnIndex, 'expected refreshMarksHint to return labels').toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeLessThan(returnIndex);
  });
});

describe('refreshConfigSummary sheets-per-signature breakdown (bonus)', () => {
  const body = extractFunctionBody('function refreshConfigSummary(');

  it('only appends the config.summarySheetsPerSignature breakdown when there is more than one signature', () => {
    const guardIndex = body.indexOf('if (sigs > 1)');
    const keyIndex = body.indexOf('config.summarySheetsPerSignature');

    expect(guardIndex, 'expected an `if (sigs > 1)` guard around the breakdown').toBeGreaterThanOrEqual(0);
    expect(keyIndex, 'expected config.summarySheetsPerSignature to be used for the breakdown').toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(keyIndex);
  });
});
