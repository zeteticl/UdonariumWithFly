import { emptyAabb } from './mesh-ir';
import { dilateAlphaInPlace } from './photo-alpha-dilate';
import {
  expandVisualAabbFromGlPixels,
  inflateAabb,
  intersectAabb,
  isAabbFinite,
  snapWorldPointToAabbFace,
} from './photo-opaque-aabb';

describe('snapWorldPointToAabbFace', () => {
  const aabb = { min: [0, 0, 0] as [number, number, number], max: [10, 4, 6] as [number, number, number] };

  it('pins the sample onto the photographed face', () => {
    expect(snapWorldPointToAabbFace([3, 9, 2], [0, 1, 0], aabb)).toEqual([3, 4, 2]);
    expect(snapWorldPointToAabbFace([3, 1, 2], [-1, 0, 0], aabb)).toEqual([0, 1, 2]);
  });
});

describe('expandVisualAabbFromGlPixels', () => {
  it('tightens XZ from an opaque island in a top-down photo', () => {
    const photo = { min: [0, 0, 0] as [number, number, number], max: [10, 2, 10] as [number, number, number] };
    const visual = emptyAabb();
    const w = 10;
    const h = 10;
    const pixels = new Uint8Array(w * h * 4);
    // Opaque 4×4 block at GL origin (bottom-left): x=2..5, y=2..5
    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        const i = (y * w + x) * 4;
        pixels[i] = 255;
        pixels[i + 3] = 255;
      }
    }
    expandVisualAabbFromGlPixels(
      visual,
      photo,
      [0, 1, 0],
      pixels,
      w,
      h,
      (ndcX, ndcY) => {
        const u = (ndcX + 1) * 0.5;
        const v = (ndcY + 1) * 0.5;
        return [u * 10, 2, v * 10];
      },
    );
    expect(isAabbFinite(visual)).toBeTrue();
    expect(visual.min[0]).toBeGreaterThan(1);
    expect(visual.max[0]).toBeLessThan(7);
    expect(visual.min[2]).toBeGreaterThan(1);
    expect(visual.max[2]).toBeLessThan(7);
  });
});

describe('intersectAabb / inflateAabb', () => {
  it('clips a visual box to the photo box', () => {
    const a = { min: [-1, 0, 0] as [number, number, number], max: [12, 2, 2] as [number, number, number] };
    const b = { min: [0, 0, 0] as [number, number, number], max: [10, 2, 2] as [number, number, number] };
    const c = intersectAabb(a, b);
    expect(c.min[0]).toBe(0);
    expect(c.max[0]).toBe(10);
    const fat = inflateAabb(b, 0.05);
    expect(fat.min[0]).toBeCloseTo(-0.5, 5);
    expect(fat.max[0]).toBeCloseTo(10.5, 5);
  });
});

describe('dilateAlphaInPlace', () => {
  it('spreads one opaque pixel into its 4-neighborhood without filling the whole canvas', () => {
    const w = 5;
    const h = 5;
    const data = new Uint8ClampedArray(w * h * 4);
    const mid = (2 * w + 2) * 4;
    data[mid] = 10;
    data[mid + 1] = 20;
    data[mid + 2] = 30;
    data[mid + 3] = 255;
    dilateAlphaInPlace(data, w, h, 1);
    expect(data[(2 * w + 3) * 4 + 3]).toBe(255);
    expect(data[0 + 3]).toBe(0);
  });
});
