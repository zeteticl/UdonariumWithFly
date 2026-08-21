import { parseStl } from './load-stl';
import { aabbToGridSize, clampModelGridEdge, transformPositionsZUpToYUp } from './mesh-ir';

function makeBinaryStlCube(): ArrayBuffer {
  // Unit cube 0..1 on XYZ, 12 triangles.
  const tris: number[][] = [];
  const faces: [number, number, number][][] = [
    // +Z
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 1], [1, 1, 1], [0, 1, 1]],
    // -Z
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [1, 0, 0]],
    // +Y
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 1], [1, 1, 0]],
    // -Y
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 0], [1, 0, 1], [0, 0, 1]],
    // +X
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 1, 1], [1, 0, 1]],
    // -X
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 0, 0], [0, 1, 1], [0, 1, 0]],
  ];
  for (const face of faces) {
    for (let i = 0; i < 6; i += 3) {
      tris.push([...face[i], ...face[i + 1], ...face[i + 2]]);
    }
  }
  const triCount = tris.length;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triCount, true);
  let o = 84;
  for (const t of tris) {
    o += 12; // normal zeros
    for (let i = 0; i < 9; i++) {
      view.setFloat32(o, t[i], true);
      o += 4;
    }
    o += 2;
  }
  return buf;
}

describe('parseStl', () => {
  it('parses binary cube and applies Z-up → Y-up', () => {
    const mesh = parseStl(makeBinaryStlCube());
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.sourceFormat).toBe('stl');
    expect(mesh.hadColor).toBeFalse();
    // After Z-up→Y-up, old Z becomes Y: height span ~1 on Y.
    expect(mesh.aabb.max[1] - mesh.aabb.min[1]).toBeCloseTo(1, 5);
  });

  it('parses ascii stl', () => {
    const ascii = `solid cube
 facet normal 0 0 0
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
endsolid cube
`;
    const mesh = parseStl(new TextEncoder().encode(ascii).buffer);
    expect(mesh.triangleCount).toBe(1);
  });

  it('rejects empty geometry', () => {
    expect(() => parseStl(new ArrayBuffer(84))).toThrow();
  });
});

describe('aabbToGridSize', () => {
  it('maps mm AABB to grids at 50mm/grid', () => {
    const size = aabbToGridSize({ min: [0, 0, 0], max: [100, 50, 200] }, 50);
    expect(size.width).toBeCloseTo(2, 5);
    expect(size.height).toBeCloseTo(1, 5);
    expect(size.depth).toBeCloseTo(4, 5);
  });
});

describe('clampModelGridEdge', () => {
  it('raises sub-grid imports to at least 2', () => {
    expect(clampModelGridEdge(0.1)).toBe(2);
    expect(clampModelGridEdge(1.9)).toBe(2);
    expect(clampModelGridEdge(5)).toBe(5);
  });
});

describe('transformPositionsZUpToYUp', () => {
  it('maps (0,0,1) to (0,1,0)', () => {
    const p = new Float32Array([0, 0, 1]);
    transformPositionsZUpToYUp(p);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(1, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });
});
