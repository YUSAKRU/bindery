/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBooklet } from './booklet-engine';
import { A5_PAGE, DEFAULT_MARGIN } from './markdown-layout';
import { parseMarkdown } from './markdown-parse';
import {
  UNSUPPORTED_GLYPH,
  markdownToPdf,
  resolvePageSize,
  sanitizeBlocks,
  sanitizeText,
} from './markdown-render';
import type { FontCoverage } from './markdown-render';
import type { MdBlock } from './markdown-types';
import { BookletError } from './types';

// Same approach as instructions-page.test.ts: the module reaches its three
// bundled subsets through Vite `?url` asset imports, which resolve under vitest
// but are not fetchable URLs in Node. Hand back the real TTF bytes so the test
// exercises the actual fontkit/embedFont path — a stub font would pass even if
// the real embedding were broken.
const __dirname = dirname(fileURLToPath(import.meta.url));
const readFont = (name: string) => {
  const b = readFileSync(resolve(__dirname, `../assets/fonts/${name}`));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const FACES = {
  bold: readFont('NotoSans-Latin-Bold.ttf'),
  mono: readFont('NotoSansMono-Regular.ttf'),
  regular: readFont('NotoSans-Latin.ttf'),
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = String(url);
      const bytes = name.includes('Mono') ? FACES.mono : name.includes('Bold') ? FACES.bold : FACES.regular;
      return { ok: true, arrayBuffer: async () => bytes };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Returns a page's content stream as text. pdf-lib Flate-compresses content
 * streams, so they are inflated here. Only the OPERATORS are meaningful to
 * assert on: the text arguments are subset glyph IDs, not readable characters.
 */
const operators = async (bytes: Uint8Array, index: number): Promise<string> => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(index);
  // biome-ignore lint/suspicious/noExplicitAny: reaching into pdf-lib's object model
  const contents = (page.node as any).Contents();
  const parts: string[] = [];
  for (const ref of contents.asArray()) {
    // biome-ignore lint/suspicious/noExplicitAny: same
    const stream = doc.context.lookup(ref) as any;
    parts.push(inflateSync(Buffer.from(stream.getContents())).toString('latin1'));
  }
  return parts.join('');
};

/** Counts occurrences of a standalone PDF operator token. */
const countOp = (stream: string, op: string): number =>
  (stream.match(new RegExp(`(^|[\\s])${op}(?=[\\s]|$)`, 'g')) ?? []).length;

/** Offset of the first standalone occurrence of an operator, or -1. */
const firstOp = (stream: string, op: string): number =>
  stream.search(new RegExp(`(^|[\\s])${op}(?=[\\s]|$)`));

const coverage = (body: string, bold: string, mono: string): FontCoverage => ({
  body: new Set([...body].map((c) => c.codePointAt(0) as number)),
  bold: new Set([...bold].map((c) => c.codePointAt(0) as number)),
  mono: new Set([...mono].map((c) => c.codePointAt(0) as number)),
});

describe('sanitizeText', () => {
  it('leaves fully supported text identical', () => {
    const supported = new Set([...'abc'].map((c) => c.codePointAt(0) as number));
    expect(sanitizeText('abc', supported)).toBe('abc');
  });

  it('replaces only the code points the face cannot draw', () => {
    const supported = new Set([...'abc'].map((c) => c.codePointAt(0) as number));
    expect(sanitizeText('aXbYc', supported)).toBe(`a${UNSUPPORTED_GLYPH}b${UNSUPPORTED_GLYPH}c`);
  });

  it('handles astral characters as single code points', () => {
    const supported = new Set([0x61]);
    expect(sanitizeText('a😀a', supported)).toBe(`a${UNSUPPORTED_GLYPH}a`);
  });
});

describe('sanitizeBlocks', () => {
  it('checks heading text against the BOLD face, which is what draws it', () => {
    // 'H' is missing from bold but present in body: sanitising against the
    // wrong face here would let an undrawable glyph reach pdf-lib. Mono lacks
    // it too, so the promotion path below cannot rescue it and this stays a
    // test about picking the drawing face.
    const cov = coverage('Hi', 'i', 'i');
    const blocks: MdBlock[] = [{ kind: 'heading', level: 2, spans: [{ text: 'Hi' }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'heading') throw new Error('expected a heading');
    expect(out.spans[0].text).toBe(`${UNSUPPORTED_GLYPH}i`);
  });

  it('checks code and math against the monospace face', () => {
    const cov = coverage('', '', 'ab');
    const blocks: MdBlock[] = [
      { kind: 'code', lang: null, lines: ['abZ'] },
      { kind: 'math', lines: ['Zab'] },
    ];
    const out = sanitizeBlocks(blocks, cov);
    expect(out[0]).toMatchObject({ lines: [`ab${UNSUPPORTED_GLYPH}`] });
    expect(out[1]).toMatchObject({ lines: [`${UNSUPPORTED_GLYPH}ab`] });
  });

  it('checks a code span inside prose against the monospace face', () => {
    // 'Z' is drawable in mono only; as a code span it must survive.
    const cov = coverage('ab', 'ab', 'abZ');
    const blocks: MdBlock[] = [
      { kind: 'paragraph', spans: [{ text: 'a' }, { text: 'Z', mono: true }, { text: 'b' }] },
    ];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(out.spans.map((s) => s.text).join('')).toBe('aZb');
  });

  it('draws a body glyph the proportional face lacks with the monospace face', () => {
    // The real gap this guards: the bundled Noto Sans subsets carry no arrows,
    // Noto Sans Mono carries all four. Before the split, `a→b` printed `a?b`.
    const cov = coverage('ab', 'ab', 'ab→');
    const blocks: MdBlock[] = [{ kind: 'paragraph', spans: [{ text: 'a→b' }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(out.spans.map((s) => s.text).join('')).toBe('a→b');
    expect(out.spans.map((s) => ({ text: s.text, mono: s.mono === true }))).toEqual([
      { text: 'a', mono: false },
      { text: '→', mono: true },
      { text: 'b', mono: false },
    ]);
  });

  it('keeps neighbouring promoted characters in one run', () => {
    const cov = coverage('ab', 'ab', 'ab→←');
    const blocks: MdBlock[] = [{ kind: 'paragraph', spans: [{ text: 'a→←b' }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(out.spans).toHaveLength(3);
    expect(out.spans[1]).toMatchObject({ text: '→←', mono: true });
  });

  it('still replaces a glyph no bundled face can draw', () => {
    const cov = coverage('ab', 'ab', 'ab');
    const blocks: MdBlock[] = [{ kind: 'paragraph', spans: [{ text: 'a→b' }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(out.spans.map((s) => s.text).join('')).toBe(`a${UNSUPPORTED_GLYPH}b`);
    expect(out.spans.some((s) => s.mono)).toBe(false);
  });

  it('promotes against the BOLD face inside a heading, not the body face', () => {
    // '→' is drawable in body, but a heading is drawn bold and bold lacks it.
    // Checking the wrong face here would leave it in the proportional run and
    // sanitising would then replace it.
    const cov = coverage('Hi→', 'Hi', 'Hi→');
    const blocks: MdBlock[] = [{ kind: 'heading', level: 2, spans: [{ text: 'H→i' }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'heading') throw new Error('expected a heading');
    expect(out.spans.map((s) => s.text).join('')).toBe('H→i');
    expect(out.spans[1]).toMatchObject({ text: '→', mono: true });
  });

  it('preserves emphasis on the surviving parts of a split span', () => {
    const cov = coverage('ab', 'ab', 'ab→');
    const blocks: MdBlock[] = [{ kind: 'paragraph', spans: [{ text: 'a→b', bold: true }] }];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'paragraph') throw new Error('expected a paragraph');
    expect(out.spans[0]).toMatchObject({ text: 'a', bold: true });
    expect(out.spans[2]).toMatchObject({ text: 'b', bold: true });
  });

  it('walks table header and body cells', () => {
    const cov = coverage('ab', 'ab', 'ab');
    const blocks: MdBlock[] = [
      { kind: 'table', align: ['left'], header: [[{ text: 'aQ' }]], rows: [[[{ text: 'Qb' }]]] },
    ];
    const [out] = sanitizeBlocks(blocks, cov);
    if (out.kind !== 'table') throw new Error('expected a table');
    expect(out.header[0][0].text).toBe(`a${UNSUPPORTED_GLYPH}`);
    expect(out.rows[0][0][0].text).toBe(`${UNSUPPORTED_GLYPH}b`);
  });
});

describe('resolvePageSize', () => {
  it('defaults to A5 portrait', () => {
    expect(resolvePageSize()).toEqual({ width: A5_PAGE.width, height: A5_PAGE.height });
  });

  it('honours a caller-supplied sheet', () => {
    expect(resolvePageSize({ pageWidth: 300, pageHeight: 200 })).toEqual({ width: 300, height: 200 });
  });
});

describe('markdownToPdf', () => {
  const SAMPLE = [
    '# Mimari Şartname',
    '',
    'Bu bölümde **çıktı** üretimi ve `zero-copy` aktarımı anlatılıyor. Değerler $t_f$ ile gösterilir.',
    '',
    '## Boru hattı',
    '',
    '```rust',
    'fn map_avframe(properties: &AVFrameProperties) -> Result<VulkanYcbcrConversion, MapError> {',
    '    todo!()',
    '}',
    '```',
    '',
    '```',
    '┌──────────────────────┐',
    '│ [VPU Decoder] ──► VRAM │',
    '├──────────────────────┤',
    '└──────────────────────┘',
    '```',
    '',
    '| Aşama | Süre |',
    '|---|--:|',
    '| Çözme | 4 ms |',
    '| Aktarım | 1 ms |',
    '',
    '- İlk madde',
    '  - İç madde',
    '',
    '> Alıntı satırı.',
    '',
    '$$ E = mc^2 $$',
  ].join('\n');

  it('renders Turkish, Rust and box-drawing content without an encoding failure', async () => {
    const bytes = await markdownToPdf(SAMPLE);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
    const [width, height] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(width).toBeCloseTo(A5_PAGE.width, 2);
    expect(height).toBeCloseTo(A5_PAGE.height, 2);
  });

  it('draws a background panel behind every fenced code row', async () => {
    // Subset-encoded text cannot be read back out of the stream, so the
    // assertion is on the graphics operators, which stay plain ASCII: three
    // code rows must produce three filled rectangles, each before its text.
    const stream = await operators(await markdownToPdf('```\naaa\nbbb\nccc\n```\n'), 0);
    // pdf-lib draws a rectangle as an explicit path, so 'f' (fill) is the
    // operator that marks a panel, not 're'.
    expect(countOp(stream, 'f')).toBe(3);
    expect(countOp(stream, 'Tj')).toBe(3);
    // The panel is laid down first, so it cannot paint over its own text.
    expect(firstOp(stream, 'f')).toBeLessThan(firstOp(stream, 'Tj'));
  });

  it('draws no rectangle for prose that has no panel', async () => {
    const stream = await operators(await markdownToPdf('just words here\n'), 0);
    expect(countOp(stream, 'f')).toBe(0);
    expect(countOp(stream, 'Tj')).toBe(1);
  });

  it('gives a blank padding page a content stream makeBooklet can embed', async () => {
    const bytes = await markdownToPdf(
      [
        { name: 'a.md', blocks: parseMarkdown('alpha\n') },
        { name: 'b.md', blocks: parseMarkdown('beta\n') },
      ],
      { padDocumentsToEven: true },
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    // The verso is empty but must still carry a stream, or embedding throws.
    const blank = await operators(bytes, 1);
    expect(countOp(blank, 'Tj')).toBe(0);
    expect(blank.length).toBeGreaterThan(0);
  });

  it('starts each document on its own page', async () => {
    const bytes = await markdownToPdf([
      { name: 'a.md', blocks: parseMarkdown('alpha\n') },
      { name: 'b.md', blocks: parseMarkdown('beta\n') },
      { name: 'c.md', blocks: parseMarkdown('gamma\n') },
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it('honours page size and margin options', async () => {
    const bytes = await markdownToPdf('hello\n', { pageWidth: 300, pageHeight: 200, margin: 10 });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(300, 2);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(200, 2);
  });

  it('substitutes characters no bundled face can draw instead of aborting', async () => {
    // Greek and Cyrillic are explicitly outside every subset (see
    // src/assets/fonts/README.md). The conversion must still produce a booklet.
    const bytes = await markdownToPdf('Alpha α beta β, Привет, and 😀 too.\n');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('rejects empty input with a coded error rather than an empty PDF', async () => {
    await expect(markdownToPdf('')).rejects.toBeInstanceOf(BookletError);
    await expect(markdownToPdf('')).rejects.toMatchObject({ code: 'MARKDOWN_NO_CONTENT' });
    await expect(markdownToPdf([])).rejects.toMatchObject({ code: 'MARKDOWN_NO_CONTENT' });
  });

  it('bails out on empty input before paying for the font download', async () => {
    // The guard exists to save a mobile device three font fetches for a
    // document that was never going to produce a page. A fresh module instance
    // is required: the font bytes are memoised, so an already-warm cache would
    // hide the fetch this test is asserting never happens.
    vi.resetModules();
    const fetchMock = vi.fn(async (url: string) => {
      const name = String(url);
      const bytes = name.includes('Mono') ? FACES.mono : name.includes('Bold') ? FACES.bold : FACES.regular;
      return { ok: true, arrayBuffer: async () => bytes };
    });
    vi.stubGlobal('fetch', fetchMock);
    const fresh = await import('./markdown-render');

    await expect(fresh.markdownToPdf('   \n')).rejects.toMatchObject({ code: 'MARKDOWN_NO_CONTENT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a font fetch failure as a coded BookletError', async () => {
    // The module memoises the font fetch, so a fresh instance is needed to see
    // the failure path at all — the cache would otherwise serve the bytes an
    // earlier test in this file already loaded.
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) })));
    const fresh = await import('./markdown-render');
    await expect(fresh.markdownToPdf('hello\n')).rejects.toMatchObject({
      code: 'MARKDOWN_FONT_LOAD_FAILED',
    });
  });
});

describe('makeBooklet handshake', () => {
  it('imposes the generated PDF into front/back sheets', async () => {
    const source = Array.from({ length: 30 }, (_, i) => `## Bölüm ${i}\n\nİçerik paragrafı ${i}.\n`).join('\n');
    const pdf = await markdownToPdf(source);
    const pageCount = (await PDFDocument.load(pdf)).getPageCount();
    expect(pageCount).toBeGreaterThan(1);

    const result = await makeBooklet(pdf, { paperSize: 'A4' });

    expect(result.originalPages).toBe(pageCount);
    expect(result.paddedPages % 4).toBe(0);
    expect(result.sheetsCount).toBe(result.paddedPages / 4);
    expect(result.frontPdf.byteLength).toBeGreaterThan(0);
    expect(result.backPdf.byteLength).toBeGreaterThan(0);

    // The imposed sheets really are A4 landscape, two booklet pages per side.
    const front = await PDFDocument.load(result.frontPdf);
    expect(front.getPageCount()).toBe(result.sheetsCount);
    expect(front.getPage(0).getWidth()).toBeCloseTo(842, 0);
    expect(front.getPage(0).getHeight()).toBeCloseTo(595, 0);
  });

  it('survives multi-signature imposition with assembly marks', async () => {
    const source = Array.from({ length: 60 }, (_, i) => `Paragraf ${i} — yeterince uzun bir metin.\n`).join('\n');
    const pdf = await markdownToPdf(source, { padDocumentsToEven: true });

    const result = await makeBooklet(pdf, {
      paperSize: 'A4',
      signatureSize: 'auto',
      foldGuides: true,
      collationMarks: true,
      includeInstructions: true,
    });

    expect(result.signaturesCount).toBeGreaterThanOrEqual(1);
    expect(result.combinedPdf.byteLength).toBeGreaterThan(0);
    expect(result.instructionsPdf).toBeDefined();
    await expect(PDFDocument.load(result.combinedPdf)).resolves.toBeDefined();
  });

  it('keeps the A5 page geometry the booklet engine expects from a folded A4', () => {
    // Two A5 portrait pages side by side are an A4 landscape sheet: this is the
    // arithmetic that lets `paperSize: 'A4'` impose the output without scaling.
    expect(A5_PAGE.width * 2).toBeCloseTo(841.88, 1);
    expect(A5_PAGE.height).toBeCloseTo(595.28, 2);
    expect(DEFAULT_MARGIN).toBe(36);
  });
});
