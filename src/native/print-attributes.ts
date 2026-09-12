export type PrintOrientation = 'portrait' | 'landscape';
export type PrintMediaSize = 'ISO_A3' | 'ISO_A4' | 'ISO_A5' | 'NA_LETTER';

export interface PrintMediaAttributes {
  orientation: PrintOrientation;
  mediaSize: PrintMediaSize;
}

export const PRINT_MEDIA_TOLERANCE_PT = 2;

interface PresetDefinition {
  readonly mediaSize: PrintMediaSize;
  readonly shortPt: number;
  readonly longPt: number;
}

// Preset definitions matching booklet-engine:
// A4 [842, 595], Letter [792, 612], A5 [595, 420], A3 [1191, 842]
const PRESETS: readonly PresetDefinition[] = [
  { mediaSize: 'ISO_A5', shortPt: 420, longPt: 595 },
  { mediaSize: 'NA_LETTER', shortPt: 612, longPt: 792 },
  { mediaSize: 'ISO_A4', shortPt: 595, longPt: 842 },
  { mediaSize: 'ISO_A3', shortPt: 842, longPt: 1191 },
];

// Enclosing envelope boundaries for non-preset dimensions.
// Accounts for standard physical sheet boundaries in points (e.g. 210mm = ~595.28pt).
const ENVELOPE_A4_SHORT = 595.28;
const ENVELOPE_A4_LONG = 842;
const ENVELOPE_LETTER_SHORT = 612;
const ENVELOPE_LETTER_LONG = 792;

/**
 * Resolves standard print attributes (orientation and media size) from page dimensions in points.
 *
 * Checks against known presets with a ~2 pt tolerance to reconcile integer-rounded
 * booklet presets with exact mm-to-pt calculations (e.g. discrete cover sheets or markdown A5).
 * Non-preset dimensions never drop below ISO_A4 because standard home printer trays are loaded with A4 paper.
 * Formats exceeding A4 boundaries map to NA_LETTER or ISO_A3 covering envelopes.
 */
export function resolvePrintMediaAttributes(
  widthPt: number,
  heightPt: number,
): PrintMediaAttributes {
  const orientation: PrintOrientation = widthPt > heightPt ? 'landscape' : 'portrait';
  const longPt = Math.max(widthPt, heightPt);
  const shortPt = Math.min(widthPt, heightPt);

  // 1. Direct preset matching with tolerance (~2 pt)
  for (const preset of PRESETS) {
    if (
      Math.abs(shortPt - preset.shortPt) <= PRINT_MEDIA_TOLERANCE_PT &&
      Math.abs(longPt - preset.longPt) <= PRINT_MEDIA_TOLERANCE_PT
    ) {
      return { orientation, mediaSize: preset.mediaSize };
    }
  }

  // 2. Covering envelope: non-preset dimensions do not drop below ISO_A4 (standard home tray paper)
  if (shortPt <= ENVELOPE_A4_SHORT && longPt <= ENVELOPE_A4_LONG) {
    return { orientation, mediaSize: 'ISO_A4' };
  }
  if (shortPt <= ENVELOPE_LETTER_SHORT && longPt <= ENVELOPE_LETTER_LONG) {
    return { orientation, mediaSize: 'NA_LETTER' };
  }

  // Fallback for single wrap cover (~872 x ~613 pt) and oversized sheets up to/past A3
  return { orientation, mediaSize: 'ISO_A3' };
}
