import { describe, expect, it } from 'vitest';
import { BookletError } from './types';
import { getHomographyMatrix } from './perspective-warp';

describe('Perspective Warp Math', () => {
  it('calculates the correct homography matrix for simple translation', () => {
    // 4 source corners
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ];

    // 4 destination corners translated by (+10, +20) and scaled by 2
    const dst = [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 10, y: 220 },
      { x: 210, y: 220 },
    ];

    const h = getHomographyMatrix(src, dst);

    // Homography matrix H should perform translation and scaling:
    // H = [ 2, 0, 10 ]
    //     [ 0, 2, 20 ]
    //     [ 0, 0, 1  ]
    // Represented in row-major order: [2, 0, 10, 0, 2, 20, 0, 0, 1]
    expect(h[0]).toBeCloseTo(2);  // h00 (scale x)
    expect(h[1]).toBeCloseTo(0);  // h01
    expect(h[2]).toBeCloseTo(10); // h02 (translate x)
    expect(h[3]).toBeCloseTo(0);  // h10
    expect(h[4]).toBeCloseTo(2);  // h11 (scale y)
    expect(h[5]).toBeCloseTo(20); // h12 (translate y)
    expect(h[6]).toBeCloseTo(0);  // h20
    expect(h[7]).toBeCloseTo(0);  // h21
    expect(h[8]).toBeCloseTo(1);  // h22 (fixed 1)
  });

  it('throws BookletError when fewer than 4 source points are given', () => {
    const threePoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    const fourPoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
    expect(() => getHomographyMatrix(threePoints, fourPoints)).toThrow(BookletError);
    expect(() => getHomographyMatrix(fourPoints, threePoints)).toThrow(BookletError);
  });

  it('throws BookletError for collinear (degenerate) corners', () => {
    // All 4 points on a line — matrix is singular
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
    expect(() => getHomographyMatrix(collinear, rect)).toThrow(BookletError);
  });

  // NOTE: warpPerspective's full WebGL render path (document.createElement, canvas.getContext)
  // is browser-only and cannot run under vitest/node. Error paths and math helpers are
  // covered above; the render path requires an integration/e2e test in a browser environment.
});
