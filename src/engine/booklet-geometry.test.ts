import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  computeClipRects,
  makeBookletCore,
  pageGeometry,
  rotatedPlacement,
} from './booklet-engine';
import type { BookletOptions } from './types';

// Expected values in this file are worked out by hand from the sheet and page
// sizes and written out literally, not recomputed from the production formulas.

/** Decodes every content stream of page `pageIndex` as text. */
function pageStreamText(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  const streams =
    contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
    .join('\n');
}

const NUM = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';

/** The `cm` matrices of one sheet, grouped four per drawPage (translate, rotate, scale, skew). */
async function drawsOf(pdf: Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(pdf);
  const text = pageStreamText(doc, pageIndex);
  const mats = [...text.matchAll(new RegExp(`${Array(6).fill(NUM).join(' ')} cm`, 'g'))].map((m) =>
    m.slice(1, 7).map(Number),
  );
  const draws: Array<{ translate: number[]; rotate: number[]; scale: number[] }> = [];
  for (let i = 0; i + 3 < mats.length; i += 4) {
    draws.push({ translate: mats[i], rotate: mats[i + 1], scale: mats[i + 2] });
  }
  return { draws, text };
}

/** Form XObject BBoxes of the drawn pages on sheet `pageIndex`. */
async function bboxesOf(pdf: Uint8Array, pageIndex = 0): Promise<number[][]> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(pageIndex);
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'));
  if (!xobjects || !('keys' in xobjects)) return [];
  const dict = xobjects as unknown as { keys(): PDFName[]; lookup(k: PDFName): PDFRawStream };
  return dict.keys().map((k) => {
    const bbox = dict.lookup(k).dict.lookup(PDFName.of('BBox')) as PDFArray;
    return bbox.asArray().map((n) => Number(n.toString()));
  });
}

async function build(
  count: number,
  setup: (page: ReturnType<PDFDocument['addPage']>, i: number) => void,
  size: [number, number] = [595, 842],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage(size);
    page.pushOperators();
    setup(page, i);
  }
  return doc.save();
}

const run = (bytes: Uint8Array, options: BookletOptions = {}) => makeBookletCore(bytes, options);

describe('pageGeometry', () => {
  it('uses the MediaBox when no TrimBox or CropBox is set', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    expect(pageGeometry(page)).toEqual({
      box: { left: 0, bottom: 0, right: 595, top: 842 },
      rotation: 0,
      width: 595,
      height: 842,
      trimmed: false,
    });
  });

  it('prefers the TrimBox over the MediaBox', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([615, 862]);
    page.setTrimBox(10, 10, 595, 842);
    const g = pageGeometry(page);
    expect(g.box).toEqual({ left: 10, bottom: 10, right: 605, top: 852 });
    expect([g.width, g.height]).toEqual([595, 842]);
    expect(g.trimmed).toBe(true);
  });

  it('falls back to the CropBox when there is no TrimBox', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([615, 862]);
    page.setCropBox(5, 5, 600, 850);
    expect(pageGeometry(page).box).toEqual({ left: 5, bottom: 5, right: 605, top: 855 });
  });

  it('clips the TrimBox to the MediaBox', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 700]);
    page.setTrimBox(-20, 10, 600, 650);
    expect(pageGeometry(page).box).toEqual({ left: 0, bottom: 10, right: 500, top: 660 });
  });

  it('ignores a TrimBox that does not overlap the MediaBox', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 700]);
    page.setTrimBox(900, 900, 100, 100);
    const g = pageGeometry(page);
    expect(g.box).toEqual({ left: 0, bottom: 0, right: 500, top: 700 });
    expect(g.trimmed).toBe(false);
  });

  it('keeps a MediaBox that does not start at the origin', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.setMediaBox(100, 100, 595, 842);
    expect(pageGeometry(page).box).toEqual({ left: 100, bottom: 100, right: 695, top: 942 });
  });

  it('swaps the displayed size for /Rotate 90 and 270, and normalizes the angle', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([842, 595]);
    page.setRotation(degrees(90));
    expect(pageGeometry(page)).toMatchObject({ rotation: 90, width: 595, height: 842 });
    page.setRotation(degrees(-90));
    expect(pageGeometry(page)).toMatchObject({ rotation: 270, width: 595, height: 842 });
    page.setRotation(degrees(540));
    expect(pageGeometry(page)).toMatchObject({ rotation: 180, width: 842, height: 595 });
  });
});

describe('rotatedPlacement', () => {
  it('moves the origin to the corner each rotation swings the box away from', () => {
    expect(rotatedPlacement(0, 10, 20, 100, 200)).toEqual({ x: 10, y: 20, angle: 0 });
    expect(rotatedPlacement(90, 10, 20, 100, 200)).toEqual({ x: 10, y: 220, angle: -90 });
    expect(rotatedPlacement(180, 10, 20, 100, 200)).toEqual({ x: 110, y: 220, angle: -180 });
    expect(rotatedPlacement(270, 10, 20, 100, 200)).toEqual({ x: 110, y: 20, angle: -270 });
  });
});

describe('computeClipRects', () => {
  it('splits the sheet at the fold', () => {
    expect(computeClipRects(842, 595)).toEqual({
      left: { x: 0, y: 0, width: 421, height: 595 },
      right: { x: 421, y: 0, width: 421, height: 595 },
    });
  });
});

describe('makeBooklet: /Rotate', () => {
  // A landscape MediaBox (842x595) with /Rotate 90 displays as A4 portrait
  // (595x842). Into a 421x595 slot: scale = min(421/595, 595/842) = 595/842.
  const s = 595 / 842;

  it('draws a /Rotate 90 page upright, at the scale of its displayed size', async () => {
    const bytes = await build(4, (p) => p.setRotation(degrees(90)), [842, 595]);
    const { draws } = await drawsOf((await run(bytes)).frontPdf);
    expect(draws).toHaveLength(2);
    const [left] = draws;
    // Displayed size after scaling: 595*s x 842*s = 420.457 x 595.
    // Centred in [0, 421]: x = (421 - 420.457)/2 = 0.2714; y = 0.
    // Rotation 90: origin at (x, y + 595), content turned -90°.
    expect(left.translate[4]).toBeCloseTo(0.2714, 3);
    expect(left.translate[5]).toBeCloseTo(595, 6);
    // rotate(-90°) = [cos, sin, -sin, cos] = [0, -1, 1, 0]
    expect(left.rotate.slice(0, 4).map((v) => Math.round(v) + 0)).toEqual([0, -1, 1, 0]);
    // Scale is applied to the unrotated 842x595 box.
    expect(left.scale[0]).toBeCloseTo(s, 5);
    expect(left.scale[3]).toBeCloseTo(s, 5);
  });

  it('adds a half turn on the long-edge back side', async () => {
    const bytes = await build(4, (p) => p.setRotation(degrees(90)), [842, 595]);
    const { draws } = await drawsOf((await run(bytes, { flipEdge: 'long' })).backPdf);
    // 90 + 180 = 270 -> drawn at -270° = [0, 1, -1, 0].
    for (const d of draws) {
      expect(d.rotate.slice(0, 4).map((v) => Math.round(v) + 0)).toEqual([0, 1, -1, 0]);
    }
  });

  it('sizes the source sheet from the displayed (rotated) page size', async () => {
    const bytes = await build(4, (p) => p.setRotation(degrees(90)), [842, 595]);
    const { draws } = await drawsOf((await run(bytes, { paperSize: 'source' })).frontPdf);
    // 'source' sheet = 2 x 595 by 842; each page fills its slot at scale 1.
    expect(draws[0].scale[0]).toBeCloseTo(1, 6);
  });
});

describe('makeBooklet: TrimBox', () => {
  it('embeds the TrimBox, so bleed and marks do not shrink the page', async () => {
    // MediaBox 615x862 with a 595x842 TrimBox inset by 10pt.
    const bytes = await build(4, (p) => p.setTrimBox(10, 10, 595, 842), [615, 862]);
    const result = await run(bytes);
    const bboxes = await bboxesOf(result.frontPdf);
    expect(bboxes).toEqual([
      [10, 10, 605, 852],
      [10, 10, 605, 852],
    ]);
    const { draws } = await drawsOf(result.frontPdf);
    // Same scale as a plain A4 page: min(421/595, 595/842) = 595/842.
    expect(draws[0].scale[0]).toBeCloseTo(595 / 842, 5);
  });
});

describe('makeBooklet: gutter and clipping', () => {
  it('shrinks the page for the gutter instead of pushing it off the sheet', async () => {
    const bytes = await build(4, () => {});
    const { draws } = await drawsOf((await run(bytes, { gutter: 20 })).frontPdf);
    // Slot width 421 - 10 = 411: scale = min(411/595, 595/842) = 411/595.
    const s = 411 / 595;
    expect(draws[0].scale[0]).toBeCloseTo(s, 5);
    // Left page: drawn width 411, x = 0 -> stays on the sheet.
    expect(draws[0].translate[4]).toBeCloseTo(0, 6);
    // Right page: x = 421 + 10 = 431, right edge 431 + 411 = 842.
    expect(draws[1].translate[4]).toBeCloseTo(431, 6);
  });

  it('clips only a page whose creep carries it past the fold', async () => {
    const bytes = await build(8, () => {});
    const result = await run(bytes, { creep: 2 });
    const clipOp = /re\nW\nn/g;
    // Sheet 0 (outermost): no creep shift, no clip.
    expect((await drawsOf(result.frontPdf, 0)).text.match(clipOp)).toBeNull();
    // Sheet 1: shifted 2pt past the fold on both halves -> two clips.
    const sheet1 = (await drawsOf(result.frontPdf, 1)).text;
    expect(sheet1.match(clipOp)).toHaveLength(2);
    expect(sheet1).toContain('0 0 421 595 re');
    expect(sheet1).toContain('421 0 421 595 re');
  });

  it('mirrors the clip through the sheet centre on the long-edge back side', async () => {
    const bytes = await build(8, () => {});
    const back = (await drawsOf((await run(bytes, { creep: 2, flipEdge: 'long' })).backPdf, 1)).text;
    // The left page's half [0, 421] maps to [421, 842] after the half turn and
    // vice versa, so both halves still appear, in swapped order.
    const rects = [...back.matchAll(new RegExp(`${NUM} ${NUM} ${NUM} ${NUM} re`, 'g'))].map((m) =>
      Number(m[1]),
    );
    expect(rects).toEqual([421, 0]);
  });
});

describe('makeBooklet: shared resources', () => {
  /** Number of image XObjects stored in the PDF. */
  async function imageCount(pdf: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(pdf);
    return doc.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
      .length;
  }

  it('stores an image shared by every page once in each output, not once per side', async () => {
    const doc = await PDFDocument.create();
    // 1x1 PNG, drawn on every page so all pages share one image object.
    const png = await doc.embedPng(
      Uint8Array.from(
        atob(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ),
        (c) => c.charCodeAt(0),
      ),
    );
    for (let i = 0; i < 8; i++) {
      doc.addPage([595, 842]).drawImage(png, { x: 0, y: 0, width: 50, height: 50 });
    }
    const src = await doc.save();
    // An RGBA PNG is stored as two image streams (colour + /SMask).
    const perCopy = await imageCount(src);
    expect(perCopy).toBe(2);
    const result = await run(src);
    expect(await imageCount(result.combinedPdf)).toBe(perCopy);
    expect(await imageCount(result.frontPdf)).toBe(perCopy);
    expect(await imageCount(result.backPdf)).toBe(perCopy);
  });
});
