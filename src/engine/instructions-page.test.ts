/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeInstructionsPage } from './instructions-page';
import type { InstructionsData } from './instructions-page';

import { setLanguage } from '../i18n';

// Same approach as watermark-engine.test.ts: the sheet fetches its two bundled
// font subsets through Vite `?url` asset imports, which resolve under vitest but
// are not fetchable URLs in Node. Hand back the real TTF bytes from disk so the
// test exercises the actual fontkit/embedFont path — a stub font would pass even
// if the real embedding were broken. The stub is URL-aware because this sheet
// needs both weights.
const __dirname = dirname(fileURLToPath(import.meta.url));
const readFont = (name: string) => {
  const b = readFileSync(resolve(__dirname, `../assets/fonts/${name}`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const REGULAR = readFont('NotoSans-Latin.ttf');
const BOLD = readFont('NotoSans-Latin-Bold.ttf');

let fetchCalls: string[] = [];

function stubFontFetch(ok = true) {
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchCalls.push(String(url));
      if (!ok) return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
      return {
        ok: true,
        arrayBuffer: async () => (String(url).includes('Bold') ? BOLD : REGULAR),
      };
    }),
  );
}

// setLanguage persists the choice, which needs a browser API vitest doesn't have.
const store = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
});
afterAll(() => {
  // Reset the language before removing the stubs — setLanguage persists through
  // localStorage, so unstubbing first makes this throw.
  setLanguage('en');
  vi.unstubAllGlobals();
});
afterEach(() => setLanguage('en'));

const baseData: InstructionsData = {
  sheetWidth: 842,
  sheetHeight: 595,
  paperLabel: 'A4 landscape',
  totalSheets: 4,
  signaturesCount: 1,
  sheetsPerSignature: [4],
  signatureStartPages: [1],
  flipEdge: 'short',
  binding: 'ltr',
  separateCover: false,
  gutter: 0,
  creep: 0,
};

async function pageCountOf(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('makeInstructionsPage', () => {
  it('renders a single-page sheet at the requested size in English', async () => {
    stubFontFetch();
    setLanguage('en');
    const pdf = await makeInstructionsPage(baseData);
    expect(await pageCountOf(pdf)).toBe(1);
    const { width, height } = (await PDFDocument.load(pdf)).getPage(0).getSize();
    expect(Math.round(width)).toBe(842);
    expect(Math.round(height)).toBe(595);
  });

  // Every Turkish string on this sheet contains at least one character
  // (ı, ş, ğ, İ) that pdf-lib's WinAnsi-encoded StandardFonts cannot encode, so
  // this fails the moment the sheet stops embedding a Unicode font.
  //
  // Note this is NOT a regression test: the previous implementation had no
  // localisation at all — it drew hardcoded English — so it passes this test
  // vacuously rather than failing it. Checked, rather than assumed.
  it('renders in Turkish without throwing on ı/ş/ğ/İ', async () => {
    stubFontFetch();
    setLanguage('tr');
    const pdf = await makeInstructionsPage(baseData);
    expect(await pageCountOf(pdf)).toBe(1);
  });

  it('renders every optional block in Turkish (cover, RTL, signature overflow)', async () => {
    stubFontFetch();
    setLanguage('tr');
    const pdf = await makeInstructionsPage({
      ...baseData,
      separateCover: true,
      binding: 'rtl',
      flipEdge: 'long',
      signaturesCount: 14,
      sheetsPerSignature: Array(14).fill(4),
      signatureStartPages: Array.from({ length: 14 }, (_, i) => i * 16 + 1),
      gutter: 12,
      creep: 0.5,
    });
    expect(await pageCountOf(pdf)).toBe(1);
  });

  // Needs a module instance whose font cache is still empty, so it resets the
  // registry first — by this point the tests above have already populated the
  // shared one.
  it('loads both font weights, and only once across repeated calls', async () => {
    vi.resetModules();
    stubFontFetch();
    const { makeInstructionsPage: fresh } = await import('./instructions-page');
    await fresh(baseData);
    const afterFirst = fetchCalls.length;
    expect(afterFirst).toBe(2);
    expect(fetchCalls.some((u) => u.includes('Bold'))).toBe(true);
    // Memoised at module scope: the second run must not re-fetch.
    await fresh(baseData);
    expect(fetchCalls.length).toBe(afterFirst);
  });

  it('reports a coded BookletError when the font cannot be loaded', async () => {
    vi.resetModules();
    stubFontFetch(false);
    // Pull BookletError from the same fresh module graph — after resetModules
    // the top-level import is a different class object and instanceof would
    // fail for the wrong reason.
    const [{ makeInstructionsPage: fresh }, types] = await Promise.all([
      import('./instructions-page'),
      import('./types'),
    ]);
    await expect(fresh(baseData)).rejects.toThrow(types.BookletError);
    await expect(fresh(baseData)).rejects.toMatchObject({
      code: 'INSTRUCTIONS_FONT_LOAD_FAILED',
    });
  });
});
