import type { BookletOptions } from '../engine/types';
import type { LibraryRecordDraft, SourceRef, StoredWrapCover } from '../native/library-store';

/**
 * What a booklet generation produced, captured right after `makeBooklet`
 * resolves: the options it was given and the counts it reported.
 */
export interface BookletResultMeta {
  options: BookletOptions;
  originalPages: number;
  signaturesCount: number;
  sheetsCount: number;
  paddingApplied: number;
  blanksInserted: number;
  sheetSizePt: [number, number];
  wrapCover: StoredWrapCover | null;
}

export interface RecordDraftInput {
  id: string;
  /** Name the user gave the booklet; blank falls back to the source file's stem. */
  title: string;
  sourceName: string;
  sourceSize?: number;
  source: SourceRef;
  meta: BookletResultMeta;
  output: null | { relPath: string };
  thumb?: null | { relPath: string };
}

export type LibraryPlatform = 'android' | 'ios' | 'web';

function stem(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').trim();
}

// JSON round trip rather than structuredClone: the record is stored as JSON,
// so this is also the exact shape that will be read back (undefined dropped).
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds the library record for a produced booklet. Everything is copied, so
 * later changes to the live config state cannot reach a stored record.
 */
export function buildRecordDraft(input: RecordDraftInput): LibraryRecordDraft {
  const { meta } = input;
  const draft: LibraryRecordDraft = {
    id: input.id,
    title: input.title.trim() || stem(input.sourceName) || input.sourceName,
    sourceName: input.sourceName,
    sourcePageCount: meta.originalPages,
    signatureCount: meta.signaturesCount,
    sheetCount: meta.sheetsCount,
    sheetSizePt: [meta.sheetSizePt[0], meta.sheetSizePt[1]],
    paddingApplied: meta.paddingApplied,
    blanksInserted: meta.blanksInserted,
    settings: snapshot({ options: meta.options, wrapCover: meta.wrapCover }),
    source: snapshot(input.source),
    output: input.output ? { relPath: input.output.relPath } : null,
    thumb: input.thumb ? { relPath: input.thumb.relPath } : null,
  };
  if (input.sourceSize !== undefined) draft.sourceSize = input.sourceSize;
  return draft;
}

/** How the library describes where a record's source lives. */
export function describeSource(
  ref: SourceRef,
  platform: LibraryPlatform,
): 'private' | 'device' | 'sample' | 'unavailable' {
  switch (ref.kind) {
    case 'private':
      return 'private';
    case 'asset':
      return 'sample';
    case 'saf':
      // SAF grants exist only on Android; anywhere else the uri is meaningless.
      return platform === 'android' ? 'device' : 'unavailable';
    case 'none':
      return 'unavailable';
  }
}

/** Whether the source can, in principle, be read again on this platform. */
export function canReopen(ref: SourceRef, platform: LibraryPlatform): boolean {
  return describeSource(ref, platform) !== 'unavailable';
}
