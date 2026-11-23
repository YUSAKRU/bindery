import { describe, expect, it } from 'vitest';
import type { SourceRef } from '../native/library-store';
import { buildRecordDraft, canReopen, describeSource, type BookletResultMeta, type LibraryPlatform } from './library-record';

function meta(): BookletResultMeta {
  return {
    options: { paperSize: 'A4', signatureSize: 16, insertBlankAfter: [0, 4], binding: 'rtl' },
    originalPages: 30,
    signaturesCount: 2,
    sheetsCount: 8,
    paddingApplied: 2,
    blanksInserted: 2,
    sheetSizePt: [842, 595],
    wrapCover: null,
  };
}

describe('buildRecordDraft', () => {
  it('snapshots the options: changing the live state afterwards does not reach the draft', () => {
    const m = meta();
    const draft = buildRecordDraft({ id: 'r', title: 'T', sourceName: 's.pdf', source: { kind: 'none' }, meta: m, output: null });
    m.options.insertBlankAfter!.push(9);
    m.options.binding = 'ltr';
    m.sheetSizePt[0] = 1;
    expect(draft.settings.options.insertBlankAfter).toEqual([0, 4]);
    expect(draft.settings.options.binding).toBe('rtl');
    expect(draft.sheetSizePt).toEqual([842, 595]);
  });

  it('maps the engine counts onto the record', () => {
    const draft = buildRecordDraft({ id: 'r', title: 'T', sourceName: 's.pdf', source: { kind: 'none' }, meta: meta(), output: null });
    expect(draft).toMatchObject({
      sourcePageCount: 30,
      signatureCount: 2,
      sheetCount: 8,
      paddingApplied: 2,
      blanksInserted: 2,
    });
  });

  it('falls back to the source file stem for a blank title', () => {
    const draft = buildRecordDraft({ id: 'r', title: '  ', sourceName: 'Field Notes.PDF', source: { kind: 'none' }, meta: meta(), output: null });
    expect(draft.title).toBe('Field Notes');
  });
});

describe('describeSource / canReopen', () => {
  const refs: Record<SourceRef['kind'], SourceRef> = {
    saf: { kind: 'saf', uri: 'content://x' },
    private: { kind: 'private', relPath: 'documents/x.pdf' },
    asset: { kind: 'asset', path: 'onboarding/quick-start-en.pdf' },
    none: { kind: 'none' },
  };
  const table: Array<[SourceRef['kind'], LibraryPlatform, string, boolean]> = [
    ['saf', 'android', 'device', true],
    ['saf', 'web', 'unavailable', false],
    ['private', 'android', 'private', true],
    ['private', 'web', 'private', true],
    ['asset', 'android', 'sample', true],
    ['asset', 'web', 'sample', true],
    ['none', 'android', 'unavailable', false],
    ['none', 'web', 'unavailable', false],
  ];
  it.each(table)('%s on %s → %s (reopen: %s)', (kind, platform, described, reopen) => {
    expect(describeSource(refs[kind], platform)).toBe(described);
    expect(canReopen(refs[kind], platform)).toBe(reopen);
  });
});
