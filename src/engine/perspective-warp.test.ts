import { describe, expect, it, vi } from 'vitest';
import { BookletError } from './types';
import { getHomographyMatrix, warpPerspective } from './perspective-warp';

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
});

describe('warpPerspective Resource Management & Bounds Check', () => {
  it('revokes blob URL even when image loading fails', async () => {
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');

    class MockImage {
      onload: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      _src = '';
      set src(val: string) {
        this._src = val;
        setTimeout(() => this.onerror && this.onerror(new Error('Load error')), 0);
      }
      get src() {
        return this._src;
      }
    }

    vi.stubGlobal('Image', MockImage);

    const corners = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
    await expect(warpPerspective(new Uint8Array([1, 2, 3]), corners)).rejects.toThrow(/Görsel yüklenemedi/i);

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');

    vi.unstubAllGlobals();
    revokeObjectURLSpy.mockRestore();
    createObjectURLSpy.mockRestore();
  });

  // NOTE: warpPerspective's WebGL render path (getContext('webgl'), texImage2D,
  // MAX_TEXTURE_SIZE downscaling, resource cleanup) cannot be meaningfully unit
  // tested here — vitest runs in Node with no GPU. A hand-rolled mock GL object
  // only asserts that we call the methods the mock was built to expect, which
  // proves nothing about real driver behaviour and silently passes even when the
  // real upload fails. The test above is kept because it exercises real control
  // flow (the try/finally around image loading) with a minimal Image stub.
  // Everything else here needs a device: see docs/TODO.md, "cihazda test edilmesi
  // gerekenler".
});
