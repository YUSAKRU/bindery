import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n';
import type { LibraryRecord } from '../native/library-store';
import type { RecentEntry } from '../native/recents-store';
import {
  coverInitials,
  detailFields,
  filterDesk,
  isImposedOutput,
  filterRecords,
  formatLine,
  rowMeta,
  SHELF_MAX,
  shelfSlice,
} from './library-view-model';

function record(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: 'r1',
    title: 'Rapor',
    sourceName: 'rapor.pdf',
    sourcePageCount: 32,
    signatureCount: 2,
    sheetCount: 8,
    sheetSizePt: [841.89, 595.28],
    paddingApplied: 0,
    blanksInserted: 0,
    settings: { options: { paperSize: 'A4', binding: 'ltr' }, wrapCover: null },
    source: { kind: 'private', relPath: 'docs/rapor.pdf' },
    output: null,
    thumb: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const formatDate = (ts: number) => `@${ts}`;

describe('library view model', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });
    setLanguage('en');
  });

  afterEach(() => {
    setLanguage('en');
    vi.unstubAllGlobals();
  });

  describe('search', () => {
    const records = [
      record({ id: 'a', title: 'İstanbul Notları', sourceName: 'notes.pdf', updatedAt: 1 }),
      record({ id: 'b', title: 'Kağıt Rehberi', sourceName: 'guide.pdf', updatedAt: 3 }),
      record({ id: 'c', title: 'Report', sourceName: 'ISTANBUL-2026.pdf', updatedAt: 2 }),
    ];

    it('matches Turkish dotted/dotless I in both languages', () => {
      expect(filterRecords(records, 'istanbul', 'tr').map((r) => r.id)).toEqual(['c', 'a']);
      expect(filterRecords(records, 'ISTANBUL', 'en').map((r) => r.id)).toEqual(['c', 'a']);
      expect(filterRecords(records, 'İSTANBUL', 'tr').map((r) => r.id)).toEqual(['c', 'a']);
    });

    it('ignores diacritics', () => {
      expect(filterRecords(records, 'kagit', 'tr').map((r) => r.id)).toEqual(['b']);
      expect(filterRecords(records, 'KAĞIT', 'en').map((r) => r.id)).toEqual(['b']);
    });

    it('matches the source file name, and an empty query keeps everything newest first', () => {
      expect(filterRecords(records, 'guide', 'en').map((r) => r.id)).toEqual(['b']);
      expect(filterRecords(records, '  ', 'en').map((r) => r.id)).toEqual(['b', 'c', 'a']);
      expect(filterRecords(records, 'nothing', 'en')).toEqual([]);
    });

    it('searches the desk by name, newest first', () => {
      const desk: RecentEntry[] = [
        { uri: 'a', name: 'Şiirler.pdf', lastPage: 1, openedAt: 1 },
        { uri: 'b', name: 'siir-taslak.pdf', lastPage: 4, openedAt: 5 },
        { uri: 'c', name: 'Fatura.pdf', lastPage: 1, openedAt: 3 },
      ];
      expect(filterDesk(desk, 'siir', 'tr').map((e) => e.uri)).toEqual(['b', 'a']);
      expect(filterDesk(desk, '', 'tr').map((e) => e.uri)).toEqual(['b', 'c', 'a']);
    });
  });

  describe('shelf', () => {
    it('shows at most SHELF_MAX books, newest first', () => {
      const many = Array.from({ length: 11 }, (_, i) => record({ id: `r${i}`, updatedAt: i }));
      const slice = shelfSlice(many);
      expect(SHELF_MAX).toBe(8);
      expect(slice).toHaveLength(8);
      expect(slice[0].id).toBe('r10');
      expect(slice[7].id).toBe('r3');
    });

    it('is empty with no records', () => {
      expect(shelfSlice([])).toEqual([]);
    });
  });

  describe('format line', () => {
    it('names the folded page of each preset sheet', () => {
      expect(formatLine('A4', t)).toBe('A4 sheet → A5 pages');
      expect(formatLine('A5', t)).toBe('A5 sheet → A6 pages');
      expect(formatLine('A3', t)).toBe('A3 sheet → A4 pages');
      expect(formatLine('Letter', t)).toBe('Letter sheet → half-Letter pages');
      expect(formatLine(undefined, t)).toBe('A4 sheet → A5 pages');
    });

    it('says source size rather than guessing a name, and gives custom sheets in mm', () => {
      expect(formatLine('source', t)).toBe('Sheet at source size');
      expect(formatLine({ width: 841.89, height: 595.28 }, t)).toBe('297 × 210 mm sheet → 149 × 210 mm pages');
      setLanguage('tr');
      expect(formatLine('A4', t)).toBe('A4 yaprak → A5 sayfa');
      expect(formatLine('source', t)).toBe('Kaynak boyutunda yaprak');
    });
  });

  describe('detail fields — only what the record stores', () => {
    const ctx = { t, sourceState: 'ok' as const, formatDate };

    it('omits separate cover and the cover line when they were not part of the booklet', () => {
      const keys = detailFields(record(), ctx).map((f) => f.key);
      expect(keys).toEqual(['pages', 'signatures', 'sheets', 'binding', 'source', 'date']);
    });

    it('shows separate cover, the wrap cover and the saved folder when stored', () => {
      const fields = detailFields(
        record({
          settings: {
            options: { paperSize: 'A4', binding: 'rtl', separateCover: true },
            wrapCover: {
              format: 'split',
              binding: 'perfect',
              kind: 'hardcover',
              boardMm: 2.0,
              gsm: 120,
              theme: 'navy',
              title: 'T',
              author: 'A',
              synopsis: '',
            },
          },
          output: { relPath: 'booklets/Rapor' },
        }),
        ctx,
      );
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      expect(byKey.separateCover).toBe('Yes');
      expect(byKey.binding).toBe('Right to left');
      expect(byKey.cover).toBe('Perfect Binding · Hard cover (board) · A4 paper (2 sheets)');
      expect(byKey.saved).toBe('Bindery › booklets › Rapor');
    });

    it('never reports paper weight, spine width or binding materials', () => {
      const fields = detailFields(
        record({
          settings: {
            options: { paperSize: 'A4', separateCover: true },
            wrapCover: {
              format: 'single',
              binding: 'sewn',
              kind: 'softcover',
              boardMm: 2.0,
              gsm: 120,
              theme: 'cream',
              title: '',
              author: '',
              synopsis: '',
            },
          },
        }),
        ctx,
      );
      const text = fields.map((f) => `${f.label} ${f.value}`).join(' | ');
      expect(text).not.toMatch(/120|gsm|g\/m|spine|mm\b/i);
      expect(fields.map((f) => f.key)).not.toContain('gsm');
    });

    it('adds blanks to the page count and states the source reachability', () => {
      const fields = detailFields(record({ blanksInserted: 1, paddingApplied: 3 }), {
        ...ctx,
        sourceState: 'missing',
      });
      const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
      expect(byKey.pages).toBe('32 pp (+4 blank)');
      expect(byKey.source).toBe("rapor.pdf · can't be reached");
      expect(byKey.date).toBe('@1000');
    });
  });

  it('summarises a row as pages · signatures · paper', () => {
    expect(rowMeta(record(), t)).toBe('32 pp · 2 sig. · A4');
    setLanguage('tr');
    expect(rowMeta(record({ settings: { options: { paperSize: 'source' }, wrapCover: null } }), t)).toBe(
      '32 sf · 2 forma · Kaynak boyutu',
    );
  });

  it('draws initials for a typographic cover', () => {
    expect(coverInitials('ılık şiirler')).toBe('IŞ');
    expect(coverInitials('Rapor')).toBe('R');
    expect(coverInitials('  ')).toBe('');
  });
});

describe('isImposedOutput', () => {
  const is = (uri: string | null) => isImposedOutput({ uri });

  it('recognises the booklet outputs saved under booklets/<name>/', () => {
    expect(is('/DATA/booklets/Deneme/Front Side.pdf')).toBe(true);
    expect(is('/DATA/booklets/Deneme/Back Side.pdf')).toBe(true);
    expect(is('/DATA/booklets/Deneme/Combined Booklet.pdf')).toBe(true);
    // The cover is imposed too: one wrap-around sheet.
    expect(is('/DATA/booklets/Deneme/Cover.pdf')).toBe(true);
    expect(is('file:///data/user/0/com.eduplayconnect.bindery/files/booklets/Deneme/Front Side.pdf')).toBe(true);
  });

  it('reads percent-encoded uris, including encoded slashes', () => {
    expect(is('file:///data/files/booklets/Deneme%20Kitap%C3%A7%C4%B1%C4%9F%C4%B1/Front%20Side.pdf')).toBe(true);
    expect(is('content://com.android.externalstorage.documents/document/primary%3ADocuments%2Fbooklets%2FX%2FBack%20Side.pdf')).toBe(true);
  });

  it('counts a renamed file that still sits in a booklet folder', () => {
    expect(is('/DATA/booklets/Deneme/print me.pdf')).toBe(true);
  });

  it('leaves the plain instructions document out', () => {
    expect(is('/DATA/booklets/Deneme/Instructions.pdf')).toBe(false);
    expect(is('/DATA/booklets/Deneme/instructions.PDF')).toBe(false);
  });

  it('leaves everything outside a booklet folder out', () => {
    expect(is(null)).toBe(false);
    expect(is('content://com.android.providers.downloads.documents/document/msf%3A1001')).toBe(false);
    expect(is('/DATA/scans/Scan.pdf')).toBe(false);
    expect(is('/DATA/Front Side.pdf')).toBe(false);
    // A file directly in booklets/ is not inside a booklet's folder.
    expect(is('/DATA/booklets/Front Side.pdf')).toBe(false);
    expect(is('/DATA/booklets')).toBe(false);
    expect(is('/DATA/notebooklets/X/Front Side.pdf')).toBe(false);
  });

  it('survives a malformed escape', () => {
    expect(is('/DATA/booklets/100%/Front Side.pdf')).toBe(true);
    expect(is('/DATA/scans/100%.pdf')).toBe(false);
  });
});
