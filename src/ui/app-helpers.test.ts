import { describe, expect, it } from 'vitest';

import { t } from '../i18n';
import {
  generateDefaultMergeName,
  paperSummaryLabel,
  parseInsertBlankList,
  describeSignatureSplit,
  readerPageAtScrollTop,
  readerScrollTopForPage,
  resolveMarksLabels,
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

describe('resolveMarksLabels', () => {
  // The regression this whole helper exists for: 0.4.6 showed the plain
  // fold-guide summary here, which reads as "your choice was ignored" rather
  // than "this document cannot carry the mark". Both strings must name the
  // single-signature reason, and they must DIFFER from the ordinary fold-guide
  // and default-hint strings — otherwise the collapse is silent again.
  it('explains, rather than hides, a spine bar suppressed by a single signature', () => {
    const { summaryKey, hintKey } = resolveMarksLabels('full', 1);
    expect(summaryKey).toBe('config.summarySpineMarksSuppressed');
    expect(hintKey).toBe('config.marksHintSingleSignature');
    expect(summaryKey).not.toBe('config.summaryFoldGuides');
    expect(hintKey).not.toBe('config.marksHint');
  });

  it('promises the spine bar only when there is more than one signature', () => {
    for (const sigs of [2, 3, 17]) {
      expect(resolveMarksLabels('full', sigs)).toEqual({
        summaryKey: 'config.summarySpineMarks',
        hintKey: 'config.marksHint',
      });
    }
  });

  it('leaves the other two modes alone', () => {
    expect(resolveMarksLabels('none', 1)).toEqual({ summaryKey: null, hintKey: 'config.marksHint' });
    expect(resolveMarksLabels('none', 4)).toEqual({ summaryKey: null, hintKey: 'config.marksHint' });
    // 'fold' prints on every sheet regardless of how the document is split.
    for (const sigs of [1, 4, null]) {
      expect(resolveMarksLabels('fold', sigs)).toEqual({
        summaryKey: 'config.summaryFoldGuides',
        hintKey: 'config.marksHint',
      });
    }
  });

  // null = signature count not known yet. The caller hides or replaces the
  // summary then, so the hint must not accuse a document that may well end up
  // with several signatures once a file is chosen.
  it('does not claim suppression before the signature count is known', () => {
    expect(resolveMarksLabels('full', null)).toEqual({
      summaryKey: 'config.summarySpineMarks',
      hintKey: 'config.marksHint',
    });
  });

  // Every key this helper can return has to exist in the active language, or
  // the UI prints the raw key at the user.
  it('returns keys that actually resolve to text', () => {
    const cases: Array<['none' | 'fold' | 'full', number | null]> = [
      ['none', 1], ['fold', 1], ['full', 1], ['full', 4], ['full', null],
    ];
    for (const [marks, sigs] of cases) {
      const { summaryKey, hintKey } = resolveMarksLabels(marks, sigs);
      if (summaryKey) expect(t(summaryKey)).not.toBe(summaryKey);
      expect(t(hintKey)).not.toBe(hintKey);
    }
  });
});

describe('describeSignatureSplit', () => {
  // The confusion this exists to kill: "32" on a 32-page document is 32 PAGES
  // per signature, which is one signature — not thirty-two. Both numbers have
  // to come out, and the sigs figure is the one the spine-mark rule reads.
  it('reports pages per signature and the signature count separately', () => {
    // 32 pages at size 32 -> one signature of 8 sheets.
    expect(describeSignatureSplit([8])).toEqual({ pages: '32', sigs: 1 });
    // 32 pages at size 8 -> four signatures of 2 sheets.
    expect(describeSignatureSplit([2, 2, 2, 2])).toEqual({ pages: '8', sigs: 4 });
    // 32 pages at size 16 -> two signatures of 4 sheets.
    expect(describeSignatureSplit([4, 4])).toEqual({ pages: '16', sigs: 2 });
  });

  // Signatures are balanced, not naively chunked, so an uneven split is normal
  // and a single pages figure would be a lie for it.
  it('gives a range when the signatures are not all the same size', () => {
    expect(describeSignatureSplit([3, 2, 2])).toEqual({ pages: '8–12', sigs: 3 });
    expect(describeSignatureSplit([2, 3])).toEqual({ pages: '8–12', sigs: 2 });
  });

  it('counts four pages to a sheet', () => {
    expect(describeSignatureSplit([1]).pages).toBe('4');
    expect(describeSignatureSplit([5]).pages).toBe('20');
  });

  // Partial guard, and only that: it pins the key and its two placeholders, so
  // renaming either in the i18n table without following through to the call
  // site shows up here instead of on the user's screen. It cannot see WHICH key
  // app.ts dispatched, so a call site pointed at a different existing key still
  // passes — that half needs the wiring itself to become testable.
  it('keeps the resolved-hint key and its placeholders alive', () => {
    const { pages, sigs } = describeSignatureSplit([2, 2]);
    const resolved = t('config.signatureHintResolved', { pages, sigs });
    expect(resolved).not.toBe('config.signatureHintResolved');
    expect(resolved).not.toContain('{pages}');
    expect(resolved).not.toContain('{sigs}');
    expect(resolved).toContain('8');
    expect(resolved).toContain('2');
  });
});
