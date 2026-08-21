import { MODEL_BAKE_SIZE_MAX, MODEL_MAX_FILE_BYTES, fitModelGridSize, uniformFitScale, MODEL_GRID_EDGE_MAX, MODEL_GRID_EDGE_MIN } from './mesh-ir';
import { MODEL_ZIP_MAX_BYTES } from './model-package-files';
import { canvasSizeForFace, faceOrthoSize } from './ortho-face-views';
import { createDevModelLayoutCursor, placeDevModelAndAdvance } from './dev-3dmodel-layout';

describe('faceOrthoSize', () => {
  const aabb = { min: [0, 0, 0] as [number, number, number], max: [10, 2, 4] as [number, number, number] };

  it('uses Z×Y for a west-wall camera', () => {
    expect(faceOrthoSize(aabb, [-1, 0, 0])).toEqual({ width: 4, height: 2 });
  });

  it('uses X×Z for a top-down camera', () => {
    expect(faceOrthoSize(aabb, [0, 1, 0])).toEqual({ width: 10, height: 4 });
  });

  it('uses X×Y for a south-wall camera', () => {
    expect(faceOrthoSize(aabb, [0, 0, -1])).toEqual({ width: 10, height: 2 });
  });
});

describe('canvasSizeForFace', () => {
  it('keeps the long side at maxSize when no ref', () => {
    expect(canvasSizeForFace(10, 5, 1024)).toEqual({ width: 1024, height: 512 });
    expect(canvasSizeForFace(4, 8, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it('scales canvas by face size vs refLongEdge for uniform world texels', () => {
    expect(canvasSizeForFace(5, 2.5, 1024, 10)).toEqual({ width: 512, height: 256 });
  });
});

describe('uniformFitScale', () => {
  it('matches the dominant-axis scale of fitModelGridSize', () => {
    expect(uniformFitScale(100, 40, 60)).toBeCloseTo(MODEL_GRID_EDGE_MAX / 100, 5);
  });
});

describe('fitModelGridSize', () => {
  it('scales down uniformly when the longest edge exceeds max', () => {
    const size = fitModelGridSize(100, 40, 60);
    expect(size.width).toBeCloseTo(MODEL_GRID_EDGE_MAX, 5);
    expect(size.depth).toBeCloseTo(16, 5);
    expect(size.height).toBeCloseTo(24, 5);
  });

  it('scales up uniformly when the shortest edge is below min', () => {
    const size = fitModelGridSize(0.8, 0.4, 1.6);
    expect(size.depth).toBeCloseTo(MODEL_GRID_EDGE_MIN, 5);
    expect(size.width).toBeCloseTo(4, 5);
    expect(size.height).toBeCloseTo(8, 5);
  });
});

describe('placeDevModelAndAdvance', () => {
  it('wraps to the next row when the table width would be exceeded', () => {
    const cursor = createDevModelLayoutCursor(10);
    const a = placeDevModelAndAdvance(cursor, 400, 100, 500, 20, 10);
    expect(a).toEqual({ x: 10, y: 10 });
    const b = placeDevModelAndAdvance(cursor, 400, 80, 500, 20, 10);
    expect(b).toEqual({ x: 10, y: 130 });
  });
});

describe('model package caps', () => {
  it('allows Sketchfab-scale files and 1024 photo bake', () => {
    expect(MODEL_MAX_FILE_BYTES).toBe(192 * 1024 * 1024);
    expect(MODEL_ZIP_MAX_BYTES).toBe(256 * 1024 * 1024);
    expect(MODEL_BAKE_SIZE_MAX).toBe(1024);
  });
});
