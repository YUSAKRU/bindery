import { describe, expect, it } from 'vitest';
import {
  PRINT_MEDIA_TOLERANCE_PT,
  resolvePrintMediaAttributes,
} from './print-attributes';

describe('resolvePrintMediaAttributes', () => {
  describe('preset matching', () => {
    it('matches A4 preset in both landscape and portrait, including discrete cover tolerance', () => {
      // Booklet-engine rounded landscape sheet [842, 595]
      expect(resolvePrintMediaAttributes(842, 595)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A4',
      });
      // A4 portrait
      expect(resolvePrintMediaAttributes(595, 842)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A4',
      });
      // Cover-engine exact mm-to-pt discrete cover sheet (595.28 x 841.89 pt)
      expect(resolvePrintMediaAttributes(595.28, 841.89)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A4',
      });
    });

    it('matches A5 preset in both landscape and portrait', () => {
      // Booklet-engine rounded landscape sheet [595, 420]
      expect(resolvePrintMediaAttributes(595, 420)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A5',
      });
      // A5 portrait
      expect(resolvePrintMediaAttributes(420, 595)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A5',
      });
      // Markdown-rendered exact A5 sheet (420.94 x 595.28 pt) matches preset via tolerance
      expect(resolvePrintMediaAttributes(420.94, 595.28)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A5',
      });
    });

    it('matches Letter preset in both landscape and portrait', () => {
      // Booklet-engine rounded landscape sheet [792, 612]
      expect(resolvePrintMediaAttributes(792, 612)).toEqual({
        orientation: 'landscape',
        mediaSize: 'NA_LETTER',
      });
      // Letter portrait
      expect(resolvePrintMediaAttributes(612, 792)).toEqual({
        orientation: 'portrait',
        mediaSize: 'NA_LETTER',
      });
    });

    it('matches A3 preset in both landscape and portrait', () => {
      // Booklet-engine rounded landscape sheet [1191, 842]
      expect(resolvePrintMediaAttributes(1191, 842)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A3',
      });
      // A3 portrait
      expect(resolvePrintMediaAttributes(842, 1191)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A3',
      });
    });
  });

  describe('covering envelope for non-preset dimensions', () => {
    it('maps single wrap cover exceeding A4 to ISO_A3', () => {
      // Single wrap cover with bleed ~871.94 x 612.28 pt (cannot fit on A4 or Letter)
      expect(resolvePrintMediaAttributes(871.94, 612.28)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A3',
      });
    });

    it('maps custom dimensions fitting within A4 envelope to ISO_A4', () => {
      // 700 x 500 pt: exceeds A5 (500 > 420), fits within A4 (500 <= 595.28, 700 <= 842)
      expect(resolvePrintMediaAttributes(700, 500)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A4',
      });
    });

    it('defaults non-preset dimensions smaller than A4 to ISO_A4 instead of ISO_A5 to match home printer paper', () => {
      // 400 x 300 pt: small non-preset sheet (e.g. reader PDF or custom crop); must not request A5
      expect(resolvePrintMediaAttributes(400, 300)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A4',
      });
    });

    it('maps dimensions wider than A4 short-edge but within Letter envelope to NA_LETTER', () => {
      // 750 x 605 pt: short edge (605 pt) exceeds A4 (595.28 pt), fits within Letter (612 x 792 pt)
      expect(resolvePrintMediaAttributes(750, 605)).toEqual({
        orientation: 'landscape',
        mediaSize: 'NA_LETTER',
      });
    });

    it('falls back safely to ISO_A3 for oversized formats exceeding standard sheets without clipping or throwing', () => {
      // Large poster/sheet 1500 x 1000 pt
      expect(resolvePrintMediaAttributes(1500, 1000)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A3',
      });
    });
  });

  describe('tolerance boundaries and edge cases', () => {
    it('matches preset within tolerance limit', () => {
      // Delta = 1.5 pt (within PRINT_MEDIA_TOLERANCE_PT = 2)
      expect(resolvePrintMediaAttributes(842 + 1.5, 595 + 1.5)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A4',
      });
      // At exact boundary (delta = 2.0 pt)
      expect(
        resolvePrintMediaAttributes(
          842 + PRINT_MEDIA_TOLERANCE_PT,
          595 + PRINT_MEDIA_TOLERANCE_PT,
        ),
      ).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A4',
      });
    });

    it('falls out of preset matching when exceeding tolerance boundary', () => {
      // Delta = 2.5 pt: exceeds A4 preset tolerance, exceeds A4 envelope (597.5 > 595.28) and Letter (844.5 > 792)
      expect(resolvePrintMediaAttributes(842 + 2.5, 595 + 2.5)).toEqual({
        orientation: 'landscape',
        mediaSize: 'ISO_A3',
      });
    });

    it('defaults square dimensions to portrait orientation', () => {
      expect(resolvePrintMediaAttributes(500, 500)).toEqual({
        orientation: 'portrait',
        mediaSize: 'ISO_A4',
      });
    });
  });
});
