import {
  assembleBakeGroupAt,
  clearBakeGroup,
  cornerDragScaleFactors,
  formBakeGroup,
  isBakeGroupComplete,
  rotateBakeGroupBy,
  scaleBakeGroupFrom,
  uniformScaleFromCornerDrag,
} from './bake-group';
import { serializeBakeCropState } from './bake-crop';
import { Terrain } from '@udonarium/terrain';

function stubTerrain(opts: {
  groupId: string;
  localX: number;
  localY: number;
  width?: number;
  depth?: number;
  x?: number;
  y?: number;
  groupSize?: number;
  isLocked?: boolean;
}): Terrain {
  const crop: Parameters<typeof serializeBakeCropState>[0] = {
    sources: {},
    faces: {},
    fullWidth: opts.width ?? 2,
    fullDepth: opts.depth ?? 2,
    fullHeight: 1,
    anchorX: 0,
    anchorY: 0,
    groupLocalX: opts.localX,
    groupLocalY: opts.localY,
  };
  if (opts.groupSize != null) crop.groupSize = opts.groupSize;
  const t = {
    bakeGroupId: opts.groupId,
    width: opts.width ?? 2,
    depth: opts.depth ?? 2,
    rotate: 0,
    isLocked: !!opts.isLocked,
    location: { name: 'table', x: opts.x ?? 0, y: opts.y ?? 0 },
    posZ: 0,
    tablePlacements: '',
    bakeCropJson: serializeBakeCropState(crop),
    update() { /* no-op */ },
    addToTable() { /* no-op in unit stub */ },
    mutateAppearance(fn: () => void) { fn(); },
    withSyncSuppressed(fn: () => void) { fn(); },
  };
  return t as unknown as Terrain;
}

describe('bake-group', () => {
  it('assembles parts using group locals around a center', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2 });
    assembleBakeGroupAt([a, b], { x: 500, y: 400, z: 0 });
    // Combined width 200+100=300 → originX = 500 - 150 = 350
    expect(a.location.x).toBe(350);
    expect(b.location.x).toBe(550);
    expect(a.location.y).toBe(b.location.y);
  });

  it('keeps different groupLocalY so U wings are not 一字排', () => {
    const bar = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 8, depth: 3 });
    const wing = stubTerrain({ groupId: 'g1', localX: 0, localY: 200, width: 2, depth: 4 });
    assembleBakeGroupAt([bar, wing], { x: 500, y: 400, z: 0 });
    expect(Math.abs(wing.location.y - bar.location.y)).toBeGreaterThan(100);
  });

  it('rotateBakeGroupBy orbits parts around the group center', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, x: 0, y: 0 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2, x: 200, y: 0 });
    // Centers at (50,50) and (250,50); group center (150,50). 180° → swap sides.
    rotateBakeGroupBy([a, b], 180);
    expect(a.location.x).toBeCloseTo(200, 0);
    expect(b.location.x).toBeCloseTo(0, 0);
    expect(a.rotate).toBeCloseTo(180, 0);
    expect(b.rotate).toBeCloseTo(180, 0);
  });

  it('scaleBakeGroupFrom scales size and shifts from anchor', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, x: 0, y: 0 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2, x: 200, y: 0 });
    scaleBakeGroupFrom([a, b], { x: 0, y: 0 }, 2, 2);
    expect(a.width).toBeCloseTo(4, 5);
    expect(b.width).toBeCloseTo(4, 5);
    expect(b.location.x).toBeCloseTo(400, 0);
  });

  it('uniformScaleFromCornerDrag shrinks when moving toward the anchor', () => {
    const anchor = { x: 0, y: 0 };
    // Start slightly past a wide island's RB (handle / pointer offset).
    const start = { x: 420, y: 30 };
    // Drift inward on X but out on Y — still closer to the anchor overall.
    const cur = { x: 390, y: 120 };
    const scale = uniformScaleFromCornerDrag(anchor, start, cur);
    expect(scale).toBeLessThan(1);
    // Regression: hypot-of-size formula incorrectly grew on this path.
    const w0 = 400;
    const d0 = 100;
    const dx = cur.x - start.x;
    const dy = cur.y - start.y;
    const legacy = Math.hypot(Math.max(1, w0 + dx), Math.max(1, d0 + dy)) / Math.hypot(w0, d0);
    expect(legacy).toBeGreaterThan(1);
    expect(scale).toBeLessThan(legacy);
  });

  it('uniformScaleFromCornerDrag grows when moving away from the anchor', () => {
    const scale = uniformScaleFromCornerDrag(
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    );
    expect(scale).toBeCloseTo(1.5, 5);
  });

  it('uniformScaleFromCornerDrag falls back to geometric corner when start≈anchor', () => {
    const anchor = { x: 100, y: 100 };
    const geom = { x: 200, y: 200 };
    const start = { x: 100.0001, y: 100 }; // unusable — near anchor
    const cur = { x: 250, y: 250 };
    expect(uniformScaleFromCornerDrag(anchor, start, cur)).toBe(1);
    const scale = uniformScaleFromCornerDrag(anchor, start, cur, geom);
    expect(scale).toBeCloseTo(Math.hypot(150, 150) / Math.hypot(100, 100), 5);
    expect(scale).toBeGreaterThan(1);
  });

  it('cornerDragScaleFactors: single terrain uses free width/depth', () => {
    const factors = cornerDragScaleFactors({
      freeAspect: false,
      partCount: 1,
      corner: 'rb',
      w0: 100,
      d0: 100,
      dx: 50,
      dy: 0,
      anchor: { x: 0, y: 0 },
      start: { x: 100, y: 100 },
      cur: { x: 150, y: 100 },
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    });
    expect(factors.scaleX).toBeCloseTo(1.5, 5);
    expect(factors.scaleY).toBeCloseTo(1, 5);
  });

  it('cornerDragScaleFactors: bake group stays uniform', () => {
    const factors = cornerDragScaleFactors({
      freeAspect: false,
      partCount: 2,
      corner: 'rb',
      w0: 100,
      d0: 100,
      dx: 50,
      dy: 0,
      anchor: { x: 0, y: 0 },
      start: { x: 100, y: 100 },
      cur: { x: 150, y: 100 },
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    });
    expect(factors.scaleX).toBe(factors.scaleY);
    expect(factors.scaleX).toBeCloseTo(Math.hypot(150, 100) / Math.hypot(100, 100), 5);
  });

  it('multi-box scale stays uniform, keeps abutment, and scales height', () => {
    const a = stubTerrain({
      groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 1, x: 0, y: 0,
    });
    (a as any).height = 2;
    const b = stubTerrain({
      groupId: 'g1', localX: 100, localY: 0, width: 2, depth: 1, x: 100, y: 0,
    });
    (b as any).height = 2;
    // Non-uniform request must not shear the group (would open joints / squash bricks).
    scaleBakeGroupFrom([a, b], { x: 0, y: 0 }, 2, 1);
    expect(a.width / a.depth).toBeCloseTo(2, 5); // was 2/1, still 2/1
    expect(a.width).toBeCloseTo(a.depth * 2, 5);
    expect(b.location.x).toBeCloseTo(a.location.x + a.width * 50, 0);
    expect(a.height).toBeCloseTo(b.height, 5);
    expect(a.height).toBeGreaterThan(2.5);
  });

  it('freeAspect allows non-uniform width/depth without changing height', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, x: 0, y: 0 });
    (a as any).height = 3;
    scaleBakeGroupFrom([a], { x: 0, y: 0 }, 2, 1, { freeAspect: true });
    expect(a.width).toBeCloseTo(4, 5);
    expect(a.depth).toBeCloseTo(2, 5);
    expect(a.height).toBeCloseTo(3, 5);
  });

  it('clearBakeGroup drops id and locals', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 10, localY: 20, groupSize: 2 });
    clearBakeGroup([a]);
    expect(a.bakeGroupId).toBe('');
    const j = JSON.parse(a.bakeCropJson);
    expect(j.groupLocalX).toBeUndefined();
    expect(j.groupSize).toBeUndefined();
  });

  it('assembleBakeGroupAt restores import size and height from bakeCrop', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2 });
    (a as any).height = 8;
    (b as any).height = 1;
    a.width = 4;
    b.depth = 5;
    a.rotate = 45;
    assembleBakeGroupAt([a, b], { x: 500, y: 400, z: 0 });
    expect(a.width).toBeCloseTo(2, 5);
    expect(a.depth).toBeCloseTo(2, 5);
    expect(a.height).toBeCloseTo(1, 5);
    expect(b.height).toBeCloseTo(1, 5);
    expect(a.rotate).toBe(0);
    expect(a.location.x).toBe(350);
    expect(b.location.x).toBe(550);
  });

  it('formBakeGroup assigns id, locals, and groupSize from current pose', () => {
    const a = stubTerrain({ groupId: '', localX: 0, localY: 0, width: 2, depth: 2, x: 100, y: 200 });
    const b = stubTerrain({ groupId: '', localX: 0, localY: 0, width: 2, depth: 2, x: 300, y: 200 });
    (a as any).height = 3;
    (b as any).height = 3;
    expect(formBakeGroup([a, b])).toBe(true);
    expect(a.bakeGroupId).toBeTruthy();
    expect(a.bakeGroupId).toBe(b.bakeGroupId);
    const ja = JSON.parse(a.bakeCropJson);
    const jb = JSON.parse(b.bakeCropJson);
    expect(ja.groupLocalX).toBe(0);
    expect(jb.groupLocalX).toBe(200);
    expect(ja.fullHeight).toBe(3);
    expect(ja.groupSize).toBe(2);
    expect(jb.groupSize).toBe(2);
    expect(isBakeGroupComplete([a, b])).toBe(true);
  });

  it('assembleBakeGroupAt refuses incomplete groupSize', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, groupSize: 3 });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2, groupSize: 3 });
    const beforeX = a.location.x;
    expect(assembleBakeGroupAt([a, b], { x: 500, y: 400, z: 0 })).toBe(false);
    expect(a.location.x).toBe(beforeX);
  });

  it('assembleBakeGroupAt refuses locked parts', () => {
    const a = stubTerrain({ groupId: 'g1', localX: 0, localY: 0, width: 2, depth: 2, isLocked: true });
    const b = stubTerrain({ groupId: 'g1', localX: 200, localY: 0, width: 2, depth: 2 });
    expect(assembleBakeGroupAt([a, b], { x: 500, y: 400, z: 0 })).toBe(false);
  });

  it('formBakeGroup refuses locked parts', () => {
    const a = stubTerrain({ groupId: '', localX: 0, localY: 0, x: 0, y: 0, isLocked: true });
    const b = stubTerrain({ groupId: '', localX: 0, localY: 0, x: 100, y: 0 });
    expect(formBakeGroup([a, b])).toBe(false);
  });
});
