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
