import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookletError } from '../engine/types';
import { MAX_MD_FILES, MdFlowManager } from './md-flow';

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

describe('MdFlowManager', () => {
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

  it('manages file addition and computes exact line count without trailing empty row', () => {
    const mgr = new MdFlowManager();
    const f1 = mgr.addFile('01_intro.md', '# Intro\nLine 2\nLine 3\n');
    expect(f1.name).toBe('01_intro.md');
    expect(f1.lineCount).toBe(3); // Trailing newline does not add 4th line
    expect(mgr.getFiles()).toHaveLength(1);
  });

  it('reorders files up and down', () => {
    const mgr = new MdFlowManager();
    const f1 = mgr.addFile('01.md', 'Content 1');
    const f2 = mgr.addFile('02.md', 'Content 2');
    const f3 = mgr.addFile('03.md', 'Content 3');

    // Move f2 down
    expect(mgr.moveFileDown(f2.id)).toBe(true);
    expect(mgr.getFiles().map((f) => f.id)).toEqual([f1.id, f3.id, f2.id]);

    // Move f2 up
    expect(mgr.moveFileUp(f2.id)).toBe(true);
    expect(mgr.getFiles().map((f) => f.id)).toEqual([f1.id, f2.id, f3.id]);

    // Boundary checks
    expect(mgr.moveFileUp(f1.id)).toBe(false);
    expect(mgr.moveFileDown(f3.id)).toBe(false);
  });

  it('removes files by id', () => {
    const mgr = new MdFlowManager();
    const f1 = mgr.addFile('01.md', 'A');
    const f2 = mgr.addFile('02.md', 'B');

    expect(mgr.removeFile(f1.id)).toBe(true);
    expect(mgr.getFiles()).toHaveLength(1);
    expect(mgr.getFiles()[0].id).toBe(f2.id);
    expect(mgr.removeFile('non-existent')).toBe(false);
  });

  it('converts to MdDocument array with stripped extension titles', () => {
    const mgr = new MdFlowManager();
    mgr.addFile('01_ARCHITECTURE.md', '# Content');
    mgr.addFile('02_TESTING.markdown', '## Tests');

    const docs = mgr.toMdDocuments();
    expect(docs).toHaveLength(2);
    expect(docs[0].name).toBe('01_ARCHITECTURE');
    expect(docs[0].blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(docs[1].name).toBe('02_TESTING');
    expect(docs[1].blocks[0]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('enforces maximum file count limit with exact error code', () => {
    const mgr = new MdFlowManager();
    for (let i = 0; i < MAX_MD_FILES; i++) {
      mgr.addFile(`doc_${i}.md`, `Content ${i}`);
    }
    let error: BookletError | undefined;
    try {
      mgr.addFile('overflow.md', 'Overflow');
    } catch (err) {
      if (err instanceof BookletError) error = err;
    }
    expect(error).toBeDefined();
    expect(error?.code).toBe('MARKDOWN_FILE_LIMIT');
    expect(error?.params).toEqual({ max: '50' });
  });

  it('enforces total file size limit with exact error code', () => {
    const mgr = new MdFlowManager();
    const chunk20MB = 'a'.repeat(20 * 1024 * 1024);
    const chunk6MB = 'b'.repeat(6 * 1024 * 1024);
    mgr.addFile('large1.md', chunk20MB);

    let error: BookletError | undefined;
    try {
      mgr.addFile('large2.md', chunk6MB);
    } catch (err) {
      if (err instanceof BookletError) error = err;
    }
    expect(error).toBeDefined();
    expect(error?.code).toBe('MARKDOWN_TOTAL_SIZE_LIMIT');
    expect(error?.params).toEqual({ limit: '25' });
  });

  it('rejects files without .md extension with exact error code', () => {
    const mgr = new MdFlowManager();
    let error: BookletError | undefined;
    try {
      mgr.addFile('notes.txt', 'Some plain text');
    } catch (err) {
      if (err instanceof BookletError) error = err;
    }
    expect(error).toBeDefined();
    expect(error?.code).toBe('MARKDOWN_INVALID_EXTENSION');
    expect(error?.params).toEqual({ name: 'notes.txt' });
  });

  it('throws BookletError with MARKDOWN_NO_CONTENT when generating PDF with zero files', async () => {
    const mgr = new MdFlowManager();
    await expect(mgr.generatePdf()).rejects.toThrowError(BookletError);
    await expect(mgr.generatePdf()).rejects.toMatchObject({
      code: 'MARKDOWN_NO_CONTENT',
    });
  });

  it('generates PDF bytes from selected files', async () => {
    const mgr = new MdFlowManager();
    mgr.addFile('doc1.md', '# Doc 1\nSome paragraph text.');
    mgr.addFile('doc2.md', '# Doc 2\n```rust\nfn hello() {}\n```');

    const bytes = await mgr.generatePdf();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('defaults typography preset to standard, switches correctly, and resets on clear', () => {
    const mgr = new MdFlowManager();
    expect(mgr.getTypographyPreset()).toBe('standard');

    mgr.setTypographyPreset('compact');
    expect(mgr.getTypographyPreset()).toBe('compact');

    mgr.setTypographyPreset('large');
    expect(mgr.getTypographyPreset()).toBe('large');

    mgr.clear();
    expect(mgr.getTypographyPreset()).toBe('standard');
  });

  it('generates PDF with custom typography presets', async () => {
    const mgr = new MdFlowManager();
    const content = `# Title\n${'Line of text inside body paragraph.\n'.repeat(20)}`;
    mgr.addFile('doc.md', content);

    mgr.setTypographyPreset('compact');
    const compactBytes = await mgr.generatePdf();
    expect(compactBytes).toBeInstanceOf(Uint8Array);
    expect(compactBytes.length).toBeGreaterThan(1000);

    mgr.setTypographyPreset('large');
    const largeBytes = await mgr.generatePdf();
    expect(largeBytes).toBeInstanceOf(Uint8Array);
    expect(largeBytes.length).toBeGreaterThan(1000);

    expect(compactBytes).not.toEqual(largeBytes);
  });
});

