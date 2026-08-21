import { splitFootprintFromPositions } from './footprint-split';
import { MeshAabb } from './mesh-ir';

function boxPositions(
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
): Float32Array {
  const faces: [number, number, number][][] = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y0, z0], [x0, y1, z1], [x0, y1, z0]],
  ];
  const out = new Float32Array(faces.length * 6 * 3);
  let i = 0;
  for (const face of faces) {
    for (const p of face) {
      out[i++] = p[0];
      out[i++] = p[1];
      out[i++] = p[2];
    }
  }
  return out;
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

describe('splitFootprintFromPositions', () => {
  it('splits an L into two rectangles', () => {
    const stem = boxPositions(0, 4, 0, 5, 0, 10);
    const arm = boxPositions(0, 10, 0, 5, 0, 4);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [10, 5, 10] };
    const boxes = splitFootprintFromPositions(concat(stem, arm), aabb);
    expect(boxes.length).toBe(2);
    const areas = boxes.map(b => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])).sort((a, b) => a - b);
    expect(areas[0]).toBeGreaterThan(15);
    expect(areas[1]).toBeGreaterThan(15);
    const total = areas[0] + areas[1];
    expect(total).toBeLessThan(90);
    expect(total).toBeGreaterThan(50);
  });

  it('keeps a filled rectangle as one box', () => {
    const solid = boxPositions(0, 10, 0, 5, 0, 8);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [10, 5, 8] };
    const boxes = splitFootprintFromPositions(solid, aabb);
    expect(boxes.length).toBe(1);
  });

  it('does not emit dust boxes from a speckled L', () => {
    // Classic L plus a few tiny islands that used to become leftover pads.
    const stem = boxPositions(0, 4, 0, 5, 0, 10);
    const arm = boxPositions(0, 10, 0, 5, 0, 4);
    const speck = boxPositions(9.6, 9.9, 0, 5, 9.6, 9.9);
    const speck2 = boxPositions(0.05, 0.2, 0, 5, 9.7, 9.95);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [10, 5, 10] };
    const boxes = splitFootprintFromPositions(concat(concat(concat(stem, arm), speck), speck2), aabb);
    expect(boxes.length).toBe(2);
    const areas = boxes.map(b => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]));
    for (const a of areas) expect(a).toBeGreaterThan(12);
  });

  it('stops at two boxes even when maxBoxes is higher', () => {
    const stem = boxPositions(0, 3, 0, 4, 0, 12);
    const arm = boxPositions(0, 12, 0, 4, 0, 3);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [12, 4, 12] };
    const boxes = splitFootprintFromPositions(concat(stem, arm), aabb, { maxBoxes: 8 });
    expect(boxes.length).toBe(2);
  });

  it('splits a U into three rectangles (bar + each wing)', () => {
    // Top bar + left wing + right wing (NYC-style courtyard).
    const bar = boxPositions(0, 12, 0, 5, 8, 12);
    const left = boxPositions(0, 3, 0, 5, 0, 12);
    const right = boxPositions(9, 12, 0, 5, 0, 12);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [12, 5, 12] };
    const boxes = splitFootprintFromPositions(concat(concat(bar, left), right), aabb);
    expect(boxes.length).toBe(3);
    const areas = boxes.map(b => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]));
    for (const a of areas) expect(a).toBeGreaterThan(15);
    // Not a 一字排 of vertical strips: Z mins must differ (bar vs wings).
    const z0 = boxes.map(b => b.min[2]);
    expect(Math.max(...z0) - Math.min(...z0)).toBeGreaterThan(2);
  });

  it('keeps a solid slab as one box (not 一字排 parts)', () => {
    // Three abutting slabs fill a solid rectangle → one box.
    const a = boxPositions(0, 4, 0, 5, 0, 12);
    const b = boxPositions(4, 8, 0, 5, 0, 12);
    const c = boxPositions(8, 12, 0, 5, 0, 12);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [12, 5, 12] };
    const boxes = splitFootprintFromPositions(concat(concat(a, b), c), aabb, { maxBoxes: 3 });
    expect(boxes.length).toBe(1);
  });

  it('splits an uneven U without slicing the larger wing', () => {
    // Narrow left wing + wide right wing (NYC proportions).
    const bar = boxPositions(0, 12, 0, 5, 8, 12);
    const left = boxPositions(0, 2.5, 0, 5, 0, 12);
    const right = boxPositions(7, 12, 0, 5, 0, 12);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [12, 5, 12] };
    const boxes = splitFootprintFromPositions(concat(concat(bar, left), right), aabb);
    expect(boxes.length).toBe(3);
    const sorted = boxes
      .map(b => ({
        dx: b.max[0] - b.min[0],
        dz: b.max[2] - b.min[2],
        area: (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]),
      }))
      .sort((a, b) => a.area - b.area);
    // Smallest piece should still be a real wing, not a thin wall shard.
    expect(sorted[0].area).toBeGreaterThan(12);
    expect(Math.min(sorted[0].dx, sorted[0].dz)).toBeGreaterThan(1.5);
  });

  it('keeps a short stub wing that is only a few percent of the root', () => {
    // Bar + short narrow left stub + tall right wing (matches buildify NYC).
    const bar = boxPositions(0, 12, 0, 5, 5, 12);
    const left = boxPositions(1, 3.5, 0, 5, 5, 8);
    const right = boxPositions(7, 12, 0, 5, 0, 12);
    const aabb: MeshAabb = { min: [0, 0, 0], max: [12, 5, 12] };
    const boxes = splitFootprintFromPositions(concat(concat(bar, left), right), aabb);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    expect(boxes.length).toBeLessThanOrEqual(3);
    for (const b of boxes) {
      const dx = b.max[0] - b.min[0];
      const dz = b.max[2] - b.min[2];
      expect(Math.min(dx, dz)).toBeGreaterThan(1.2);
    }
  });
});
