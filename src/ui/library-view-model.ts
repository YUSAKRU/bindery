import type { PaperSize } from '../engine/types';
import type { LibraryRecord, StoredWrapCover } from '../native/library-store';
import type { RecentEntry } from '../native/recents-store';

/**
 * Pure helpers behind the library screen: search, the shelf slice, and the
 * detail sheet's fields. Everything shown here is derived from what a record
 * actually stores — nothing is estimated or invented.
 */

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** How many books the shelf row shows (the newest by `updatedAt`). */
export const SHELF_MAX = 8;

const PT_PER_MM = 72 / 25.4;

/**
 * Folds a string for search: locale-aware lowercase first (so Turkish `İ`/`I`
 * land correctly), then diacritics stripped and dotless `ı` folded onto `i`,
 * so "İstanbul", "ISTANBUL" and "istanbul" — or "Kağıt" and "kagit" — match
 * whichever language the app is in.
 */
export function foldForSearch(text: string, lang: string): string {
  return text
    .toLocaleLowerCase(lang)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

function byUpdatedDesc(a: LibraryRecord, b: LibraryRecord): number {
  return b.updatedAt - a.updatedAt;
}

/** Records whose title or source file name contains `query`, newest first. */
export function filterRecords(records: readonly LibraryRecord[], query: string, lang: string): LibraryRecord[] {
  const needle = foldForSearch(query.trim(), lang);
  const matches = needle
    ? records.filter(
        (r) => foldForSearch(r.title, lang).includes(needle) || foldForSearch(r.sourceName, lang).includes(needle),
      )
    : [...records];
  return matches.sort(byUpdatedDesc);
}

/** Desk (recently opened) entries whose name contains `query`, newest first. */
export function filterDesk(entries: readonly RecentEntry[], query: string, lang: string): RecentEntry[] {
  const needle = foldForSearch(query.trim(), lang);
  const matches = needle ? entries.filter((e) => foldForSearch(e.name, lang).includes(needle)) : [...entries];
  return matches.sort((a, b) => b.openedAt - a.openedAt);
}

/** The books the shelf row shows: at most `SHELF_MAX`, newest first. */
export function shelfSlice(records: readonly LibraryRecord[]): LibraryRecord[] {
  return [...records].sort(byUpdatedDesc).slice(0, SHELF_MAX);
}

function mm(pt: number): number {
  return Math.round(pt / PT_PER_MM);
}

// Folded page of each named sheet: the sheet halved across its long side.
const FOLDED_PAGE: Record<string, string> = { A3: 'A4', A4: 'A5', A5: 'A6' };

/**
 * The sheet → page line, e.g. "A4 sheet → A5 pages". Named sizes say their
 * names; a custom sheet says its size in millimetres; the source size says so
 * rather than guessing a name for it.
 */
export function formatLine(paperSize: PaperSize | undefined, t: Translate): string {
  const paper = paperSize ?? 'A4';
  if (paper === 'source') return t('library.detail.formatSource');
  if (typeof paper === 'object') {
    const sheet = `${mm(paper.width)} × ${mm(paper.height)} mm`;
    const page = `${mm(paper.width / 2)} × ${mm(paper.height)} mm`;
    return t('library.detail.format', { sheet, page });
  }
  if (paper === 'Letter') return t('library.detail.format', { sheet: 'Letter', page: t('library.detail.halfLetter') });
  return t('library.detail.format', { sheet: paper, page: FOLDED_PAGE[paper] ?? paper });
}

/** Short paper name for list rows: "A4", "Letter", "297 × 210 mm", or the source-size label. */
export function paperLabel(paperSize: PaperSize | undefined, t: Translate): string {
  const paper = paperSize ?? 'A4';
  if (paper === 'source') return t('library.paperSource');
  if (typeof paper === 'object') return `${mm(paper.width)} × ${mm(paper.height)} mm`;
  return paper;
}

/** One-line summary for a list row, e.g. "32 pp · 2 signatures · A4". */
export function rowMeta(record: LibraryRecord, t: Translate): string {
  return [
    t('library.detail.pagesValue', { n: record.sourcePageCount }),
    t('library.signaturesValue', { n: record.signatureCount }),
    paperLabel(record.settings.options.paperSize, t),
  ].join(' · ');
}

const COVER_BINDING_KEYS: Record<StoredWrapCover['binding'], string> = {
  saddle: 'cover.bindingSaddle',
  sewn: 'cover.bindingSewn',
  perfect: 'cover.bindingPerfect',
};

const COVER_FORMAT_KEYS: Partial<Record<StoredWrapCover['format'], string>> = {
  split: 'cover.formatSplit',
  single: 'cover.formatSingle',
};

/** The wrap cover as the user chose it: binding · cover kind · print paper. */
export function coverLine(cover: StoredWrapCover, t: Translate): string {
  const parts = [
    t(COVER_BINDING_KEYS[cover.binding] ?? 'cover.bindingSewn'),
    t(cover.kind === 'hardcover' ? 'cover.kindHard' : 'cover.kindSoft'),
  ];
  const formatKey = COVER_FORMAT_KEYS[cover.format];
  if (formatKey) parts.push(t(formatKey));
  return parts.join(' · ');
}

export type SourceState = 'ok' | 'missing' | 'unknown' | 'checking';

export type DetailFieldKey =
  | 'pages'
  | 'signatures'
  | 'sheets'
  | 'binding'
  | 'separateCover'
  | 'cover'
  | 'source'
  | 'saved'
  | 'date';

export interface DetailField {
  key: DetailFieldKey;
  label: string;
  value: string;
}

export interface DetailContext {
  t: Translate;
  sourceState: SourceState;
  formatDate: (timestamp: number) => string;
}

/**
 * The detail sheet's rows — only fields the record stores. Separate cover and
 * the wrap-cover line appear only when they were part of the booklet; paper
 * weight, spine width and binding materials are never stored for the book
 * block, so there is no row for them at all.
 */
export function detailFields(record: LibraryRecord, ctx: DetailContext): DetailField[] {
  const { t } = ctx;
  const { options, wrapCover } = record.settings;
  const blanks = record.blanksInserted + record.paddingApplied;
  let pages = t('library.detail.pagesValue', { n: record.sourcePageCount });
  if (blanks > 0) pages += ` (${t('library.detail.blanks', { n: blanks })})`;

  const fields: DetailField[] = [
    { key: 'pages', label: t('library.detail.pages'), value: pages },
    {
      key: 'signatures',
      label: t('library.detail.signatures'),
      value: t('library.signaturesValue', { n: record.signatureCount }),
    },
    {
      key: 'sheets',
      label: t('library.detail.sheets'),
      value: t('library.sheetsValue', { n: record.sheetCount }),
    },
    {
      key: 'binding',
      label: t('library.detail.binding'),
      value: t(options.binding === 'rtl' ? 'library.detail.bindingRtl' : 'library.detail.bindingLtr'),
    },
  ];
  if (options.separateCover === true) {
    fields.push({ key: 'separateCover', label: t('library.detail.separateCover'), value: t('library.detail.yes') });
  }
  if (wrapCover) {
    fields.push({ key: 'cover', label: t('library.detail.cover'), value: coverLine(wrapCover, t) });
  }
  const sourceNote =
    ctx.sourceState === 'missing'
      ? t('library.source.stateMissing')
      : ctx.sourceState === 'ok'
        ? t('library.source.stateOk')
        : '';
  fields.push({
    key: 'source',
    label: t('library.detail.source'),
    value: sourceNote ? `${record.sourceName} · ${sourceNote}` : record.sourceName,
  });
  if (record.output) {
    fields.push({
      key: 'saved',
      label: t('library.detail.saved'),
      value: ['Bindery', ...record.output.relPath.split('/').filter(Boolean)].join(' › '),
    });
  }
  fields.push({ key: 'date', label: t('library.detail.date'), value: ctx.formatDate(record.createdAt) });
  return fields;
}

/** First letters for a typographic cover when a record has no thumbnail. */
export function coverInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}
