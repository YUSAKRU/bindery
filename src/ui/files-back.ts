/**
 * Pure navigation helpers for the Files tab inside Library.
 *
 * When a tool's "Go to location" button or a book detail's "Open output" opens
 * a specific folder in the Files tab, Back returns to that origin while the
 * user stays within the landing folder's subtree, climbs one folder when
 * deeper than the landing folder, and otherwise leaves the Files tab.
 */

export type FilesBackAction = 'target' | 'climb' | 'leave';

/**
 * Returns true when `path` is the `landing` folder itself or a descendant of
 * it. An empty `landing` (`''`) represents the Files root, so every folder
 * path is within it.
 */
export function isWithinLanding(path: string, landing: string): boolean {
  if (landing === '') return true;
  return path === landing || path.startsWith(`${landing}/`);
}

/**
 * Decides what Back should do on the Files tab:
 * - `'target'` when a back target is active and the user is at `landing`;
 * - `'climb'` when not at root and either no landing is active or `path` is
 *   strictly deeper than `landing`;
 * - `'leave'` otherwise (let Back fall through to the Library screen's parent).
 */
export function resolveFilesBack(s: {
  path: string;
  landing: string | null;
  hasTarget: boolean;
}): FilesBackAction {
  if (s.hasTarget && s.landing !== null && s.path === s.landing) {
    return 'target';
  }
  const strictlyDeeper =
    s.landing === null || (isWithinLanding(s.path, s.landing) && s.path !== s.landing);
  if (s.path !== '' && strictlyDeeper) {
    return 'climb';
  }
  return 'leave';
}
