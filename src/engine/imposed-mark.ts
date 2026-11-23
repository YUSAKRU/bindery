// Pure: no pdf-lib, so the UI can recognise the mark without loading the engine.

/**
 * Keyword the booklet engine writes into every imposed output (front, back,
 * combined, cover). A file that carries it is already laid out on sheets,
 * however it was renamed, shared or moved since.
 */
export const IMPOSED_KEYWORD = 'bindery-imposed';

/** Whether a PDF's Keywords entry (as pdf.js or pdf-lib reports it) carries the mark. */
export function hasImposedKeyword(keywords: unknown): boolean {
  if (typeof keywords !== 'string') return false;
  return keywords.split(/[\s,;]+/).includes(IMPOSED_KEYWORD);
}
