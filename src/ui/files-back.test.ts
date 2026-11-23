import { describe, expect, it } from 'vitest';
import { isWithinLanding, resolveFilesBack, type FilesBackAction } from './files-back';

describe('isWithinLanding', () => {
  const cases: ReadonlyArray<{
    name: string;
    path: string;
    landing: string;
    expected: boolean;
  }> = [
    { name: 'root landing contains root', path: '', landing: '', expected: true },
    { name: 'root landing contains top-level folder', path: 'edits', landing: '', expected: true },
    { name: 'root landing contains nested folder', path: 'booklets/x/sub', landing: '', expected: true },
    { name: 'nested landing contains itself', path: 'booklets/x', landing: 'booklets/x', expected: true },
    { name: 'nested landing contains direct child', path: 'booklets/x/sub', landing: 'booklets/x', expected: true },
    { name: 'nested landing contains deep descendant', path: 'booklets/x/sub/leaf', landing: 'booklets/x', expected: true },
    { name: 'parent above nested landing is outside', path: 'booklets', landing: 'booklets/x', expected: false },
    { name: 'root above nested landing is outside', path: '', landing: 'booklets/x', expected: false },
    { name: 'unrelated sibling folder is outside', path: 'edits', landing: 'booklets/x', expected: false },
    { name: 'same-parent sibling folder is outside', path: 'booklets/y', landing: 'booklets/x', expected: false },
    { name: 'prefix trap without slash boundary is outside', path: 'booklets/xy', landing: 'booklets/x', expected: false },
    { name: 'prefix trap descendant is outside', path: 'booklets/xy/sub', landing: 'booklets/x', expected: false },
    { name: 'single-segment landing contains itself', path: 'edits', landing: 'edits', expected: true },
    { name: 'single-segment landing contains child', path: 'edits/sub', landing: 'edits', expected: true },
    { name: 'single-segment prefix trap is outside', path: 'edits2', landing: 'edits', expected: false },
    { name: 'root above single-segment landing is outside', path: '', landing: 'edits', expected: false },
  ];

  it.each(cases)('$name: isWithinLanding($path, $landing) -> $expected', ({ path, landing, expected }) => {
    expect(isWithinLanding(path, landing)).toBe(expected);
  });
});

describe('resolveFilesBack', () => {
  const cases: ReadonlyArray<{
    name: string;
    path: string;
    landing: string | null;
    hasTarget: boolean;
    expected: FilesBackAction;
  }> = [
    // Root landing ('')
    { name: 'at root landing with target returns target', path: '', landing: '', hasTarget: true, expected: 'target' },
    { name: 'at root landing without target leaves', path: '', landing: '', hasTarget: false, expected: 'leave' },
    { name: 'deeper than root landing climbs', path: 'edits', landing: '', hasTarget: true, expected: 'climb' },
    { name: 'nested deeper than root landing climbs', path: 'booklets/x', landing: '', hasTarget: true, expected: 'climb' },
    { name: 'deeper than root landing without target still climbs', path: 'edits', landing: '', hasTarget: false, expected: 'climb' },

    // Nested landing ('booklets/x')
    { name: 'at nested landing with target returns target', path: 'booklets/x', landing: 'booklets/x', hasTarget: true, expected: 'target' },
    { name: 'at nested landing without target leaves', path: 'booklets/x', landing: 'booklets/x', hasTarget: false, expected: 'leave' },
    { name: 'deeper than nested landing with target climbs', path: 'booklets/x/sub', landing: 'booklets/x', hasTarget: true, expected: 'climb' },
    { name: 'deeper than nested landing without target climbs', path: 'booklets/x/sub', landing: 'booklets/x', hasTarget: false, expected: 'climb' },
    { name: 'above nested landing (parent) leaves', path: 'booklets', landing: 'booklets/x', hasTarget: true, expected: 'leave' },
    { name: 'above nested landing (root) leaves', path: '', landing: 'booklets/x', hasTarget: true, expected: 'leave' },
    { name: 'sibling folder vs nested landing leaves', path: 'edits', landing: 'booklets/x', hasTarget: true, expected: 'leave' },
    { name: 'prefix trap vs nested landing leaves', path: 'booklets/xy', landing: 'booklets/x', hasTarget: true, expected: 'leave' },
    { name: 'prefix trap child vs nested landing leaves', path: 'booklets/xy/sub', landing: 'booklets/x', hasTarget: true, expected: 'leave' },

    // No landing (null)
    { name: 'no landing at root without target leaves', path: '', landing: null, hasTarget: false, expected: 'leave' },
    { name: 'no landing at root with stale target leaves', path: '', landing: null, hasTarget: true, expected: 'leave' },
    { name: 'no landing in subfolder climbs', path: 'edits', landing: null, hasTarget: false, expected: 'climb' },
    { name: 'no landing in nested subfolder climbs', path: 'booklets/x', landing: null, hasTarget: false, expected: 'climb' },
    { name: 'no landing in subfolder with stale target climbs', path: 'booklets/x', landing: null, hasTarget: true, expected: 'climb' },
  ];

  it.each(cases)('$name', ({ path, landing, hasTarget, expected }) => {
    expect(resolveFilesBack({ path, landing, hasTarget })).toBe(expected);
  });
});
