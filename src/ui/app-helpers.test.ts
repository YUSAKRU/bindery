import { describe, expect, it } from 'vitest';

import { t } from '../i18n';
import {
  generateDefaultMergeName,
  paperSummaryLabel,
  parseInsertBlankList,
  readerPageAtScrollTop,
  readerScrollTopForPage,
  sortFileEntries,
  type SortableEntry,
} from './app-helpers';

function entry(name: string, lastModified: number, type: 'file' | 'directory' = 'file'): SortableEntry {
  return { name, lastModified, type };
}

describe('sortFileEntries', () => {
  const items: SortableEntry[] = [
    entry('banana.pdf', 300),
    entry('Zebra', 100, 'directory'),
    entry('apple.pdf', 200),
    entry('alpha', 400, 'directory'),
  ];

  it('always puts directories before files', () => {
    for (const mode of ['name-asc', 'name-desc', 'date-asc', 'date-desc'] as const) {
      const sorted = sortFileEntries(items, mode);
      expect(sorted.slice(0, 2).every((i) => i.type === 'directory')).toBe(true);
      expect(sorted.slice(2).every((i) => i.type === 'file')).toBe(true);
    }
  });

  it('sorts each group by name ascending', () => {
    expect(sortFileEntries(items, 'name-asc').map((i) => i.name)).toEqual([
      'alpha', 'Zebra', 'apple.pdf', 'banana.pdf',
    ]);
  });

  it('sorts each group by name descending', () => {
    expect(sortFileEntries(items, 'name-desc').map((i) => i.name)).toEqual([
      'Zebra', 'alpha', 'banana.pdf', 'apple.pdf',
    ]);
  });

  it('sorts each group newest-first for date-desc', () => {
    expect(sortFileEntries(items, 'date-desc').map((i) => i.name)).toEqual([
      'alpha', 'Zebra', 'banana.pdf', 'apple.pdf',
    ]);
  });

  it('sorts each group oldest-first for date-asc', () => {
    expect(sortFileEntries(items, 'date-asc').map((i) => i.name)).toEqual([
      'Zebra', 'alpha', 'apple.pdf', 'banana.pdf',
    ]);
  });

  it('does not mutate or reorder the caller array', () => {
    const original = [...items];
    sortFileEntries(items, 'name-asc');
    expect(items).toEqual(original);
  });

  it('handles an empty list', () => {
    expect(sortFileEntries([], 'name-asc')).toEqual([]);
  });

  it('keeps extra properties on the entries it is given', () => {
    const withUri = [{ ...entry('a.pdf', 1), uri: 'content://a', size: 10 }];
    expect(sortFileEntries(withUri, 'name-asc')[0].uri).toBe('content://a');
  });
});

describe('generateDefaultMergeName', () => {
  it('formats as Merged_DD-MM-YYYY_HHMM with zero padding', () => {
    // Local time on purpose — the name is for the user, not for storage.
    expect(generateDefaultMergeName(new Date(2026, 7, 9, 5, 4))).toBe('Merged_09-08-2026_0504');
  });

  it('does not pad the year and handles a two-digit month, day and hour', () => {
    expect(generateDefaultMergeName(new Date(2026, 11, 25, 23, 59))).toBe('Merged_25-12-2026_2359');
  });

  it('produces a name the filename sanitizer leaves untouched', () => {
    const name = generateDefaultMergeName(new Date(2026, 0, 1, 0, 0));
    expect(name).toBe('Merged_01-01-2026_0000');
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('defaults to now when no date is given', () => {
    expect(generateDefaultMergeName()).toMatch(/^Merged_\d{2}-\d{2}-\d{4}_\d{4}$/);
  });
});

describe('readerPageAtScrollTop', () => {
  // Three 1000px pages starting 40px below scrollTop=0.
  const layout = (maxScroll = 3040 - 800) => ({
    pageOffsets: [0, 1000, 2000],
    listTopOffsetPx: 40,
    maxScroll: () => maxScroll,
  });

  it('returns page 1 when there is no layout yet', () => {
    expect(readerPageAtScrollTop(1234, { pageOffsets: [], listTopOffsetPx: 40, maxScroll: () => 0 }))
      .toBe(1);
  });

  it('does not read maxScroll when there are no pages', () => {
    let reads = 0;
    readerPageAtScrollTop(0, {
      pageOffsets: [],
      listTopOffsetPx: 40,
      maxScroll: () => { reads += 1; return 0; },
    });
    expect(reads).toBe(0);
  });

  it('maps a scrollTop inside each page to that page', () => {
    expect(readerPageAtScrollTop(40, layout())).toBe(1);
    expect(readerPageAtScrollTop(500, layout())).toBe(1);
    expect(readerPageAtScrollTop(1040, layout())).toBe(2);
    expect(readerPageAtScrollTop(1500, layout())).toBe(2);
    expect(readerPageAtScrollTop(2040, layout())).toBe(3);
  });

  it('treats a scrollTop a hair short of a page top as that page', () => {
    // Fractional scroll restores land just below the boundary; the 0.75px bias
    // is what stops the page indicator flickering back one page.
    expect(readerPageAtScrollTop(1039.5, layout())).toBe(2);
    expect(readerPageAtScrollTop(1039.4, layout())).toBe(2);
    expect(readerPageAtScrollTop(1039, layout())).toBe(1);
  });

  it('clamps above the list top offset', () => {
    expect(readerPageAtScrollTop(0, layout())).toBe(1);
    expect(readerPageAtScrollTop(-500, layout())).toBe(1);
  });

  it('reports the last page at the hard bottom, even if it is shorter than the viewport', () => {
    const maxScroll = 2100;
    expect(readerPageAtScrollTop(maxScroll, layout(maxScroll))).toBe(3);
    expect(readerPageAtScrollTop(maxScroll - 2, layout(maxScroll))).toBe(3);
    // Just outside the 2px bottom band, normal search applies again.
    expect(readerPageAtScrollTop(maxScroll - 3, layout(maxScroll))).toBe(3);
    expect(readerPageAtScrollTop(1500, layout(maxScroll))).toBe(2);
  });

  it('ignores the bottom band when the content does not scroll', () => {
    expect(readerPageAtScrollTop(0, layout(0))).toBe(1);
  });

  it('agrees with readerScrollTopForPage for every page', () => {
    const l = layout();
    for (const page of [1, 2, 3]) {
      expect(readerPageAtScrollTop(readerScrollTopForPage(page, l), l)).toBe(page);
    }
  });
});

describe('readerScrollTopForPage', () => {
  const layout = { pageOffsets: [0, 1000, 2000], listTopOffsetPx: 40 };

  it('returns 0 when there is no layout yet', () => {
    expect(readerScrollTopForPage(3, { pageOffsets: [], listTopOffsetPx: 40 })).toBe(0);
  });

  it('adds the list top offset to the page offset', () => {
    expect(readerScrollTopForPage(1, layout)).toBe(40);
    expect(readerScrollTopForPage(2, layout)).toBe(1040);
    expect(readerScrollTopForPage(3, layout)).toBe(2040);
  });

  it('clamps out-of-range page numbers to the first and last page', () => {
    expect(readerScrollTopForPage(0, layout)).toBe(40);
    expect(readerScrollTopForPage(-7, layout)).toBe(40);
    expect(readerScrollTopForPage(99, layout)).toBe(2040);
  });
});

describe('paperSummaryLabel', () => {
  it('renders a preset as its own name', () => {
    expect(paperSummaryLabel('A4')).toBe('A4');
    expect(paperSummaryLabel('Letter')).toBe('Letter');
  });

  it('renders "source" through i18n rather than literally', () => {
    expect(paperSummaryLabel('source')).toBe(t('config.summary.source'));
    expect(paperSummaryLabel('source')).not.toBe('source');
  });

  it('labels a custom {width,height} size with its dimensions', () => {
    // Still unreachable from the UI, which only assigns presets — this is the
    // guard for the day it becomes reachable, in place of "[object Object]".
    expect(paperSummaryLabel({ width: 400, height: 600 })).toBe('400 × 600 pt');
  });
});

describe('parseInsertBlankList', () => {
  it('treats an empty or blank field as "feature off"', () => {
    expect(parseInsertBlankList('')).toEqual([]);
    expect(parseInsertBlankList('   ')).toEqual([]);
  });

  it('parses a single position', () => {
    expect(parseInsertBlankList('4')).toEqual([4]);
  });

  it('parses a comma-separated list, tolerating spaces and empty slots', () => {
    expect(parseInsertBlankList(' 1, 2 ,3 ')).toEqual([1, 2, 3]);
    expect(parseInsertBlankList('1,,2,')).toEqual([1, 2]);
  });

  it('accepts 0 (blank before the first page)', () => {
    expect(parseInsertBlankList('0')).toEqual([0]);
  });

  it('keeps the order and duplicates as typed — the engine validates the range', () => {
    expect(parseInsertBlankList('5,1,5')).toEqual([5, 1, 5]);
  });

  it('rejects negatives, fractions and non-numbers with null', () => {
    expect(parseInsertBlankList('-1')).toBeNull();
    expect(parseInsertBlankList('1.5')).toBeNull();
    expect(parseInsertBlankList('abc')).toBeNull();
    expect(parseInsertBlankList('1,abc,3')).toBeNull();
    expect(parseInsertBlankList('1e3x')).toBeNull();
  });

  it('rejects the whole field when any token is bad, not just the bad token', () => {
    expect(parseInsertBlankList('2,4,-6')).toBeNull();
  });

  it('rejects exponent and hex forms', () => {
    // Number() reads these as integers, so they used to pass with no inline
    // error and then fail in the engine at generation time instead.
    expect(parseInsertBlankList('1e3')).toBeNull();
    expect(parseInsertBlankList('0x10')).toBeNull();
    expect(parseInsertBlankList('2, 0x10')).toBeNull();
  });
});
