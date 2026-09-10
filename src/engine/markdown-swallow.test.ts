import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_WRAP_INDENT, wrapCodeLine } from './markdown-layout';
import { parseMarkdown } from './markdown-parse';
import { UNSUPPORTED_GLYPH, fontCoverage, sanitizeBlocks } from './markdown-render';
import type { FontMetrics, MdBlock } from './markdown-types';

/**
 * The swallow test.
 *
 * Every bug this file exists for was the same shape: content went into the
 * pipeline and quietly did not come out. A soft line break printed as `?`, a
 * checkbox vanished, `Vec<u8>` lost its type parameter, two prices in one
 * sentence lost both dollar signs. None of them failed a unit test, because a
 * unit test asserts what you thought to ask about — and what was swallowed was
 * exactly what nobody thought to ask about.
 *
 * So this one asks about the whole document at once. `__fixtures__/swallow.md`
 * holds one line for every construct that has bitten a real corpus, and the
 * golden below is the whole flattened result. Any silent change shows up as a
 * diff rather than as a surprise in a printed booklet.
 *
 * When the fixture changes on purpose, update the golden in the same commit and
 * say in the message what moved and why.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const readFixture = () => readFileSync(resolve(__dirname, '__fixtures__/swallow.md'), 'utf8');
const readFont = (name: string) => {
  const bytes = readFileSync(resolve(__dirname, `../assets/fonts/${name}`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const FACES = {
  bold: readFont('NotoSans-Latin-Bold.ttf'),
  mono: readFont('NotoSansMono-Regular.ttf'),
  regular: readFont('NotoSans-Latin.ttf'),
};

/**
 * How a span's formatting is shown in the flattened form.
 *
 * Emphasis is carried by flags, not by characters, so a flatten that joined
 * only `text` could not see bold or a strike being dropped — and dropping the
 * strike is the one failure that inverts meaning, since struck text then reads
 * as current.
 */
function markUp(span: { text: string; bold?: boolean; mono?: boolean; strike?: boolean }): string {
  let out = span.text;
  if (span.strike) out = `~~${out}~~`;
  if (span.bold) out = `**${out}**`;
  if (span.mono) out = `\`${out}\``;
  return out;
}

/**
 * The same shape with the formatting markers left off.
 *
 * The font layer legitimately changes formatting — a glyph the proportional
 * face cannot draw is moved to the monospace one — so the marked-up form is not
 * stable across it. The characters are, and that is what "nothing was
 * swallowed" means.
 */
function plainText(blocks: MdBlock[]): string {
  return flatten(blocks).replace(/\*\*|~~|`/g, '');
}

/** One readable line per block, so a diff points at the block that changed. */
function flatten(blocks: MdBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'code':
        case 'math':
          return `${block.kind}:\n${block.lines.map((line) => `  |${line}`).join('\n')}`;
        case 'table':
          return `table:\n${[block.header, ...block.rows]
            .map((row) => `  |${row.map((cell) => cell.map(markUp).join('')).join(' ~ ')}`)
            .join('\n')}`;
        case 'rule':
          return 'rule';
        case 'listItem':
          return `listItem(${block.marker}): ${block.spans.map(markUp).join('')}`;
        default:
          return `${block.kind}: ${block.spans.map(markUp).join('')}`;
      }
    })
    .join('\n');
}

const GOLDEN = `heading: Yutma testi
paragraph: Bu belge, Markdown hattından geçerken sessizce kaybolan içeriği yakalamak için var. Her satırı bir kez gerçek bir belgede ısırdı. Değiştirmeden önce \`markdown-swallow.test.ts\` içindeki beklenen çıktıyı da güncelle. Dosya bilerek bir BOM ile başlıyor: o da basılabilen bir karakter değil ve düşürülmezse ilk başlığın önünde görünürdü.
heading: Yumuşak satır sonu ve sekme
paragraph: Bu paragraf ikinci satıra sarıyor ve arada bir sekme var.
listItem(•): 01_PRD_AND_VISION.md Devam satırı, madde iminin altında.
heading: Görev listesi
listItem([x]): biten iş
listItem([ ]): bekleyen iş
heading: Üstü çizili
paragraph: Eski karar ~~tüm belgede ters çevir~~ yerine imza içinde çevriliyor.
heading: Etiket şeklinde olan ve olmayan
paragraph: Tampon Vec<u8> ve Arc<Mutex<T>> ile tutulur, yol kurgu_<USERNAME> olur. Su H2O olur, Satır sonu da böyle.
paragraph: Blok içindeki metin korunur.
heading: Görsel
paragraph: Şema: [Mimari şeması] burada anlatılıyor.
heading: Para ve kabuk değişkeni
paragraph: Tutar $50 ve $100 arası. Yol $HOME ve $PATH ayarlı.
heading: Satır içi formül
paragraph: Hattı → DMA-BUF, gecikme **0 µs**, başlangıç <= **500 ms**. Örnekleme R=96,000 Hz, tanjant tanh, aralık ±inf, süre (S + 1) / (R). Gerçek notasyon \`$E = mc^2$\` korunur.
heading: Display formül
math:
  |snap(snap(T, FPS), FPS) == snap(T, FPS)
paragraph: Yan yana: a_b(S) = (S) / (R) c_d(U) = U × 2
math:
  |\\sum_{i=0}^{n} x_i
heading: Kod
paragraph: \`x → y\` satır içi kod.
code:
  |    fn prop_frame_snapping_idempotent(us in 0u64..360_000_000_000u64, fps in arb_frame_rate()) {
  |        let t1 = Timecode { us }.snap_to_frame(fps);
  |    }
code:
  |[VPU Decoder] ──────────────────────────────────────────► [VRAM Surface]
heading: Tablo
table:
  |Alan ~ Değer
  |Sırt ~ 12,4 mm
  |Yaprak ~ 46`;

describe('swallow test', () => {
  it('turns the whole fixture into exactly the expected blocks', () => {
    expect(flatten(parseMarkdown(readFixture()))).toBe(GOLDEN);
  });

  it('loses none of the payload that has been swallowed before', () => {
    // The golden above would catch each of these too. They are spelled out
    // separately because a golden diff says "something moved" while this says
    // which promise broke — and every entry is a bug that actually shipped.
    const flat = flatten(parseMarkdown(readFixture()));
    const mustSurvive = [
      // Two prices in one sentence: both delimiters were eaten.
      '$50',
      '$100',
      '$HOME',
      '$PATH',
      // `marked` calls these inline HTML; a broad strip deleted them.
      'Vec<u8>',
      'Arc<Mutex<T>>',
      'kurgu_<USERNAME>',
      // The checkbox is the only thing telling a done task from a pending one.
      'listItem([x])',
      'listItem([ ])',
      // An image cannot travel to paper; its alt text is all the reader gets.
      '[Mimari şeması]',
      // A code row broke mid-identifier: "fps i" / "n arb_frame_rate()".
      'fps in arb_frame_rate()',
      // A soft line break printed as `?` and joined two words into one token.
      'ikinci satıra sarıyor',
      'arada bir sekme var',
      '01_PRD_AND_VISION.md Devam satırı',
    ];
    for (const fragment of mustSurvive) expect(flat).toContain(fragment);
  });

  it('leaves no source syntax on the page that it claims to render', () => {
    const flat = flatten(parseMarkdown(readFixture()));
    const mustNotAppear = [
      '<sub>', // a real HTML tag, and the only kind that may be stripped
      '<br>',
      '<div',
      '\\rightarrow', // converted, not printed as source
      '\\mathbf',
      '\\equiv',
      '\\lfloor',
      '\t',
      '\n\n', // flatten emits one line per block; a stray blank means an empty block
    ];
    for (const fragment of mustNotAppear) expect(flat).not.toContain(fragment);
  });

  it('breaks the fixture\'s long code rows at a word boundary', () => {
    // The layer the checks above cannot see: wrapping happens in the layout
    // engine, not in the parser, so a row cut mid-identifier — "fps i" /
    // "n arb_frame_rate()" — leaves the parsed blocks untouched and slips past
    // every assertion made on them.
    const metrics: FontMetrics = {
      widthOfText: (text, size) => text.length * size * 0.6,
      heightOf: (size) => size * 0.75,
    };
    const codeLines = parseMarkdown(readFixture()).flatMap((block) =>
      block.kind === 'code' ? block.lines : [],
    );
    expect(codeLines.length).toBeGreaterThan(0);

    let wrapped = 0;
    for (const line of codeLines) {
      const rows = wrapCodeLine(line, 40 * 8 * 0.6, 8, metrics);
      if (rows.length === 1) continue;
      wrapped += 1;

      const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
      const prefix = indent + CODE_WRAP_INDENT;
      // Nothing lost or duplicated by the break, whatever the break rule is.
      expect(rows[0] + rows.slice(1).map((row) => row.slice(prefix.length)).join('')).toBe(line);

      // A word may only be split when the row held no space to break at — the
      // case a box-drawing run is, and the reason the character break is kept.
      for (let i = 0; i < rows.length - 1; i += 1) {
        const endsMidWord = /\w$/.test(rows[i]);
        const nextStartsMidWord = /^\w/.test(rows[i + 1].slice(prefix.length));
        if (!endsMidWord || !nextStartsMidWord) continue;
        expect(rows[i].trimEnd().slice(indent.length)).not.toContain(' ');
      }
    }
    // The fixture has to actually contain a row long enough to wrap, or this
    // test passes by having nothing to check.
    expect(wrapped).toBeGreaterThan(0);
  });

  it('draws every character of the fixture with a real embedded face', async () => {
    // The parse-level checks above cannot see the font layer, and that layer has
    // its own way of swallowing: a code point no bundled face carries is
    // replaced by `?`. The fixture is deliberately inside the subsets, so a `?`
    // here means either a real coverage gap or syntax leaking into the text.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const name = String(url);
        const bytes = name.includes('Mono')
          ? FACES.mono
          : name.includes('Bold')
            ? FACES.bold
            : FACES.regular;
        return { ok: true, arrayBuffer: async () => bytes };
      }),
    );
    const { PDFDocument } = await import('pdf-lib');
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const fonts = {
      body: await doc.embedFont(FACES.regular, { subset: true }),
      bold: await doc.embedFont(FACES.bold, { subset: true }),
      mono: await doc.embedFont(FACES.mono, { subset: true }),
    };

    const parsed = parseMarkdown(readFixture());
    const drawn = sanitizeBlocks(parsed, fontCoverage(fonts));

    expect(flatten(drawn)).not.toContain(UNSUPPORTED_GLYPH);
    // Not the marked-up golden: the fallback moves a glyph to the monospace
    // face, which is a formatting change and shows up as one. Character for
    // character, nothing may differ.
    expect(plainText(drawn)).toBe(plainText(parsed));
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
});
