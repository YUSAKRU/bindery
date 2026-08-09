import type { PaperSize } from '../engine/types';
import { t } from '../i18n';

/**
 * Pure helpers lifted out of the `initApp()` closure so they can be tested
 * directly. Nothing here reads the DOM or module state: whatever the original
 * closed over is now a parameter. Behaviour is unchanged — the callers in
 * app.ts pass exactly what the closure used to read.
 */

// ── Files explorer ──────────────────────────────────────────────────────────

export type FileSortMode = 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc';

/** The fields sorting looks at; `FileEntryInfo` satisfies this. */
export interface SortableEntry {
  name: string;
  lastModified: number;
  type: 'file' | 'directory';
}

/** Sorts by `mode`, with directories always ahead of files. Never mutates `items`. */
export function sortFileEntries<T extends SortableEntry>(items: T[], mode: FileSortMode): T[] {
  const dirs = items.filter((i) => i.type === 'directory');
  const files = items.filter((i) => i.type === 'file');
  const cmp = (a: T, b: T): number => {
    switch (mode) {
      case 'name-asc': return a.name.localeCompare(b.name);
      case 'name-desc': return b.name.localeCompare(a.name);
      case 'date-asc': return a.lastModified - b.lastModified;
      case 'date-desc': return b.lastModified - a.lastModified;
    }
  };
  return [...dirs.sort(cmp), ...files.sort(cmp)];
}

// ── Merge ───────────────────────────────────────────────────────────────────

/** `Merged_09-08-2026_1435` — local time, extension added later by the save flow. */
export function generateDefaultMergeName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Merged_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Reader geometry ─────────────────────────────────────────────────────────

export interface ReaderPageLayout {
  /** Distance from the list's top edge to each page's top edge, ascending. */
  pageOffsets: number[];
  /** Distance from scrollTop=0 to the first page's top edge. */
  listTopOffsetPx: number;
  /**
   * `scrollHeight - clientHeight` of the scroll container. A function because
   * it is a layout read the caller should not pay for when there are no pages.
   */
  maxScroll(): number;
}

/** Current 1-based page for a given scrollTop (binary search over offsets). */
export function readerPageAtScrollTop(scrollTop: number, layout: ReaderPageLayout): number {
  const { pageOffsets } = layout;
  if (pageOffsets.length === 0) return 1;
  // At the hard bottom the last page's top may never reach scrollTop (it can
  // be shorter than the viewport), so top-anchored search would undercount.
  const maxScroll = layout.maxScroll();
  if (maxScroll > 0 && scrollTop >= maxScroll - 2) return pageOffsets.length;
  // +0.75px bias: fractional scrollTop restores land a hair short of exact
  // page-top boundaries and must not flip the result to the previous page.
  const offset = Math.max(0, scrollTop - layout.listTopOffsetPx) + 0.75;
  let lo = 0;
  let hi = pageOffsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageOffsets[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1;
}

/** scrollTop that puts the given 1-based page's top at the top of the viewport. */
export function readerScrollTopForPage(
  pageNumber: number,
  layout: Pick<ReaderPageLayout, 'pageOffsets' | 'listTopOffsetPx'>,
): number {
  const { pageOffsets } = layout;
  if (pageOffsets.length === 0) return 0;
  const idx = Math.min(Math.max(pageNumber - 1, 0), pageOffsets.length - 1);
  return pageOffsets[idx] + layout.listTopOffsetPx;
}

// ── Booklet config ──────────────────────────────────────────────────────────

/** Short paper label for the summary band ("A4" / "Letter" / "Kaynak" ...). */
export function paperSummaryLabel(paperSize: PaperSize): string {
  return paperSize === 'source' ? t('config.summary.source') : String(paperSize);
}

/**
 * Parses the comma-separated "insert blank after" field. Returns the page
 * numbers, [] when empty (feature off), or null if a token is not a
 * non-negative integer (range is validated by the engine).
 */
export function parseInsertBlankList(rawValue: string): number[] | null {
  const raw = rawValue.trim();
  if (!raw) return [];
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const positions: number[] = [];
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isInteger(n) || n < 0) return null;
    positions.push(n);
  }
  return positions;
}
