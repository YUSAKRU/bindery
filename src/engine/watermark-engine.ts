import { degrees, rgb } from 'pdf-lib';
import notoSansUrl from '../assets/fonts/NotoSans-Latin.ttf?url';
import { loadAndValidatePdf } from './validator';
import { BookletError } from './types';

export interface WatermarkBaseOptions {
  opacity: number;
  rotateDegrees: number;
}

export interface TextWatermarkOptions extends WatermarkBaseOptions {
  type: 'text';
  text: string;
}

export interface ImageWatermarkOptions extends WatermarkBaseOptions {
  type: 'image';
  imageBytes: Uint8Array;
  imageFormat: 'png' | 'jpg';
  scale: number;
}

export type WatermarkOptions = TextWatermarkOptions | ImageWatermarkOptions;

export interface WatermarkResult {
  pageCount: number;
  watermarkedPdf: Uint8Array;
}

const FONT_SIZE = 60;
const TEXT_COLOR = rgb(0.5, 0.5, 0.5);

/**
 * pdf-lib rotates drawText/drawImage around their (x,y) anchor point, not
 * around the content's center. To center a rotated watermark on the page,
 * the anchor must be shifted back by the content's half-extent rotated by
 * the same angle, so that point lands exactly on the page center.
 */
export function computeCenteredRotatedPosition(
  pageWidth: number,
  pageHeight: number,
  contentWidth: number,
  contentHeight: number,
  rotateDegrees: number,
): { x: number; y: number } {
  const angleRad = (rotateDegrees * Math.PI) / 180;
  const halfW = contentWidth / 2;
  const halfH = contentHeight / 2;
  const offsetX = halfW * Math.cos(angleRad) - halfH * Math.sin(angleRad);
  const offsetY = halfW * Math.sin(angleRad) + halfH * Math.cos(angleRad);

  return {
    x: pageWidth / 2 - offsetX,
    y: pageHeight / 2 - offsetY,
  };
}

let cachedFontBytesPromise: Promise<ArrayBuffer> | null = null;

// pdf-lib's StandardFonts are WinAnsi-encoded and throw on Turkish/Cyrillic/etc.
// (see docs/CODE-REVIEW-2026-08-03.md [C1]), so text watermarks embed this bundled
// Unicode subset instead. Fetched lazily and cached at module scope since
// addWatermark can be called repeatedly and the image branch never needs it.
async function loadWatermarkFontBytes(): Promise<ArrayBuffer> {
  if (!cachedFontBytesPromise) {
    cachedFontBytesPromise = fetch(notoSansUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.arrayBuffer();
      })
      .catch((err) => {
        cachedFontBytesPromise = null;
        throw new BookletError(`Filigran yazı tipi yüklenemedi: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
  return cachedFontBytesPromise;
}

export async function addWatermark(inputBytes: Uint8Array, options: WatermarkOptions): Promise<WatermarkResult> {
  const { doc, metadata: { pageCount } } = await loadAndValidatePdf(inputBytes);

  if (options.opacity < 0 || options.opacity > 1) {
    throw new BookletError('Opaklık 0 ile 1 arasında olmalı.');
  }
  if (options.type === 'text' && !options.text.trim()) {
    throw new BookletError('Filigran metni boş olamaz.');
  }

  if (options.type === 'text') {
    // fontkit is ~700kB and is only needed to embed the Unicode TTF, so it is
    // imported dynamically here rather than at module scope. Without this it
    // lands in the eagerly-loaded pdf-lib chunk (see vite.config.ts) and every
    // merge/booklet/rotate operation pays for it too.
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    doc.registerFontkit(fontkit);
    const fontBytes = await loadWatermarkFontBytes();
    const font = await doc.embedFont(fontBytes, { subset: true });
    const textWidth = font.widthOfTextAtSize(options.text, FONT_SIZE);

    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      const { x, y } = computeCenteredRotatedPosition(width, height, textWidth, FONT_SIZE, options.rotateDegrees);
      page.drawText(options.text, {
        x,
        y,
        size: FONT_SIZE,
        font,
        color: TEXT_COLOR,
        opacity: options.opacity,
        rotate: degrees(options.rotateDegrees),
      });
    });
  } else {
    const image = options.imageFormat === 'png' ? await doc.embedPng(options.imageBytes) : await doc.embedJpg(options.imageBytes);

    if (image.width === 0) {
      throw new BookletError('Filigran görseli geçersiz: genişlik sıfır.');
    }

    doc.getPages().forEach((page) => {
      const { width, height } = page.getSize();
      const drawWidth = width * options.scale;
      const drawHeight = drawWidth * (image.height / image.width);
      const { x, y } = computeCenteredRotatedPosition(width, height, drawWidth, drawHeight, options.rotateDegrees);
      page.drawImage(image, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
        opacity: options.opacity,
        rotate: degrees(options.rotateDegrees),
      });
    });
  }

  const watermarkedPdf = await doc.save();

  return { pageCount, watermarkedPdf };
}
