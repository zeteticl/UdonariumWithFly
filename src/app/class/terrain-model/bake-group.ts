import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import { UUID } from '@udonarium/core/system/util/uuid';
import { PointerCoordinate } from 'service/pointer-device.service';

import { parseBakeCropState, serializeBakeCropState, TerrainBakeCropState } from './bake-crop';
import { footprintDebug } from './footprint-debug';

export function newBakeGroupId(): string {
  return UUID.generateUuid();
}

/**
 * Members sharing bakeGroupId. Prefer view-table children; fall back to ObjectStore
 * when none are parented yet (mid-import / mid-sync).
 */
export function terrainsInBakeGroup(groupId: string): Terrain[] {
  if (!groupId) return [];
  const all = ObjectStore.instance.getObjects(Terrain).filter(t => t?.bakeGroupId === groupId);
  const table = TableSelecter.instance?.viewTable;
  if (!table) return all;
  const onTable = all.filter(t => t.parent === table);
  return onTable.length ? onTable : all;
}

export function bakeGroupLocalOf(terrain: Terrain): { x: number; y: number } | null {
  const state = parseBakeCropState(terrain?.bakeCropJson);
  if (!state) return null;
  if (typeof state.groupLocalX === 'number' && typeof state.groupLocalY === 'number') {
    return { x: state.groupLocalX, y: state.groupLocalY };
  }
  return null;
}

/** Expected member count from any part's bakeCrop snapshot; null if legacy/unset. */
export function expectedBakeGroupSize(terrains: Terrain[]): number | null {
  for (const t of terrains) {
    const state = parseBakeCropState(t?.bakeCropJson);
    if (state?.groupSize && state.groupSize > 0) return state.groupSize;
  }
  return null;
}

/** True when the list looks complete (legacy groups without groupSize always pass if length >= 2). */
export function isBakeGroupComplete(terrains: Terrain[]): boolean {
  if (terrains.length < 2) return false;
  const expected = expectedBakeGroupSize(terrains);
  if (expected == null) return true;
  return terrains.length >= expected;
}

/**
 * Place bake-group parts in their modeled relative layout, centered on `center`.
 * Restores import-time width/depth/height (and zero rotate) from bakeCropJson when
 * present, then uses groupLocalX/Y so reassemble matches the load-time GROUP.
 * Batches size+pose SyncVar writes per part (one UPDATE each).
 */
export function assembleBakeGroupAt(terrains: Terrain[], center: PointerCoordinate): boolean {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 2) return false;
  if (parts.some(t => !!t.isLocked)) return false;
  if (!isBakeGroupComplete(parts)) return false;

  const locals = parts.map(t => {
    const local = bakeGroupLocalOf(t);
    if (local) return { terrain: t, lx: local.x, ly: local.y };
    return { terrain: t, lx: t.location.x, ly: t.location.y };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of locals) {
    const { w, d } = footprintPxForAssemble(p.terrain);
    if (p.lx < minX) minX = p.lx;
    if (p.ly < minY) minY = p.ly;
    if (p.lx + w > maxX) maxX = p.lx + w;
    if (p.ly + d > maxY) maxY = p.ly + d;
  }
  const originX = center.x - (minX + maxX) / 2;
  const originY = center.y - (minY + maxY) / 2;

  footprintDebug('assembleBakeGroupAt', {
    center,
    originX: +originX.toFixed(2),
    originY: +originY.toFixed(2),
    bounds: { minX, minY, maxX, maxY },
    parts: locals.map(p => ({
      name: p.terrain.name,
      lx: +p.lx.toFixed(2),
      ly: +p.ly.toFixed(2),
      w: p.terrain.width,
      d: p.terrain.depth,
      h: p.terrain.height,
      fromJson: !!bakeGroupLocalOf(p.terrain),
      before: { x: p.terrain.location?.x, y: p.terrain.location?.y },
    })),
  });

  for (const p of locals) {
    commitTerrainPose(p.terrain, originX + p.lx, originY + p.ly, center.z, { restoreSize: true });
  }

  footprintDebug('assembleBakeGroupAt after', {
    parts: locals.map(p => ({
      name: p.terrain.name,
      location: { ...p.terrain.location },
      pose: p.terrain.getPoseForView?.() ?? null,
      placements: (p.terrain.tablePlacements || '').slice(0, 180),
    })),
    ySpan: (() => {
      const ys = locals.map(p => p.terrain.location?.y ?? 0);
      return +(Math.max(...ys) - Math.min(...ys)).toFixed(2);
    })(),
  });
  return true;
}

/** Footprint in table px using bakeCrop full* when present (pre-write bounds). */
function footprintPxForAssemble(terrain: Terrain): { w: number; d: number } {
  const state = parseBakeCropState(terrain.bakeCropJson);
  if (state && state.fullWidth > 0 && state.fullDepth > 0) {
    return {
      w: Math.max(0.1, state.fullWidth) * GRID,
      d: Math.max(0.1, state.fullDepth) * GRID,
    };
  }
  return {
    w: Math.max(0.1, terrain.width || 1) * GRID,
    d: Math.max(0.1, terrain.depth || 1) * GRID,
  };
}

/** Apply bakeCrop full* + zero rotate (caller should suppress sync if batching). */
function applyRestoreBakeGroupPartSize(terrain: Terrain): void {
  const state = parseBakeCropState(terrain.bakeCropJson);
  if (!state) {
    terrain.rotate = 0;
    return;
  }
  const w = Math.max(0.1, state.fullWidth || 0);
  const d = Math.max(0.1, state.fullDepth || 0);
  const h = Math.max(0, state.fullHeight || 0);
  terrain.mutateAppearance(() => {
    if (state.fullWidth > 0) terrain.width = w;
    if (state.fullDepth > 0) terrain.depth = d;
    if (Number.isFinite(state.fullHeight)) terrain.height = h;
    terrain.rotate = 0;
  });
}

/**
 * Bind independent terrains into one bake group using current poses as the
 * modeled layout (locals + full size snapshot for later reassemble).
 */
export function formBakeGroup(terrains: Terrain[]): boolean {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 2) return false;
  if (parts.some(t => !!t.isLocked)) return false;
  const id = newBakeGroupId();
  const b = bakeGroupBoundsPx(parts);
  const groupSize = parts.length;
  for (const t of parts) {
    const prev = parseBakeCropState(t.bakeCropJson);
    const w = Math.max(0.1, t.width || 1);
    const d = Math.max(0.1, t.depth || 1);
    const h = Math.max(0, t.height || 0);
    const state: TerrainBakeCropState = prev || {
      sources: {},
      faces: {},
      fullWidth: w,
      fullDepth: d,
      fullHeight: h,
      anchorX: t.location?.x ?? 0,
      anchorY: t.location?.y ?? 0,
    };
    state.fullWidth = w;
    state.fullDepth = d;
    state.fullHeight = h;
    state.groupLocalX = (t.location?.x ?? 0) - b.minX;
    state.groupLocalY = (t.location?.y ?? 0) - b.minY;
    state.groupSize = groupSize;
    const json = serializeBakeCropState(state);
    if (typeof t.withSyncSuppressed === 'function') {
      t.withSyncSuppressed(() => {
        t.bakeGroupId = id;
        t.bakeCropJson = json;
      });
      t.update();
    } else {
      t.bakeGroupId = id;
      t.bakeCropJson = json;
    }
  }
  return true;
}

/**
 * Write size (optional) + table pose with sync suppressed, then one UPDATE.
 * Keeps addToTable / placement behavior of placeTerrainAt.
 */
export function commitTerrainPose(
  terrain: Terrain,
  x: number,
  y: number,
  posZ: number,
  options?: { restoreSize?: boolean },
): void {
  const hadPlacements = !!terrain.tablePlacements;
  const tableId = TableSelecter.instance?.viewTable?.identifier;
  const apply = () => {
    if (options?.restoreSize) applyRestoreBakeGroupPartSize(terrain);
    terrain.location = { name: 'table', x, y };
    terrain.posZ = posZ;
    if (tableId) {
      terrain.addToTable(tableId, { x, y, posZ }, !hadPlacements);
    }
  };
  if (typeof terrain.withSyncSuppressed === 'function') {
    terrain.withSyncSuppressed(apply);
    terrain.update();
  } else {
    apply();
    terrain.update?.();
  }
  footprintDebug('commitTerrainPose', {
    name: terrain.name,
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    posZ,
    tableId: tableId || '(none)',
    exclusive: !hadPlacements,
    restoreSize: !!options?.restoreSize,
    location: { ...terrain.location },
    pose: terrain.getPoseForView?.() ?? null,
    placements: (terrain.tablePlacements || '').slice(0, 180),
  });
}

/** Table pose for one bake-group part (whole SyncVar write + optional map placement). */
export function placeTerrainAt(terrain: Terrain, x: number, y: number, posZ: number): void {
  commitTerrainPose(terrain, x, y, posZ);
}

/** Stamp groupSize onto each part's bakeCrop (import / model bake). */
export function writeBakeGroupSize(terrains: Terrain[], groupSize: number): void {
  if (groupSize < 2) return;
  for (const t of terrains) {
    if (!t) continue;
    const state = parseBakeCropState(t.bakeCropJson);
    if (!state) continue;
    state.groupSize = groupSize;
    const json = serializeBakeCropState(state);
    if (typeof t.withSyncSuppressed === 'function') {
      t.withSyncSuppressed(() => { t.bakeCropJson = json; });
      t.update();
    } else {
      t.bakeCropJson = json;
    }
  }
}

export function clearBakeGroup(terrains: Terrain[]): void {
  for (const t of terrains) {
    if (!t?.bakeGroupId) continue;
    const state = parseBakeCropState(t.bakeCropJson);
    const clear = () => {
      t.bakeGroupId = '';
      if (!state) return;
      delete state.groupLocalX;
      delete state.groupLocalY;
      delete state.groupSize;
      t.bakeCropJson = serializeBakeCropState(state);
    };
    if (typeof t.withSyncSuppressed === 'function') {
      t.withSyncSuppressed(clear);
      t.update();
    } else {
      clear();
    }
  }
}

const GRID = 50;

export function bakeGroupPartsOf(terrain: Terrain | null | undefined): Terrain[] {
  if (!terrain?.bakeGroupId) return terrain ? [terrain] : [];
  const parts = terrainsInBakeGroup(terrain.bakeGroupId);
  return parts.length ? parts : [terrain];
}

/** Axis-aligned bounds of parts in table px (location = min corner). */
export function bakeGroupBoundsPx(terrains: Terrain[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of terrains) {
    const x = t.location?.x ?? 0;
    const y = t.location?.y ?? 0;
    const w = Math.max(0.1, t.width || 1) * GRID;
    const d = Math.max(0.1, t.depth || 1) * GRID;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + d > maxY) maxY = y + d;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * Rigid rotate: orbit each part around the group center and add delta to facing.
 */
export function rotateBakeGroupBy(terrains: Terrain[], deltaDeg: number): void {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 1 || !Number.isFinite(deltaDeg) || deltaDeg === 0) return;
  if (parts.length === 1) {
    const t = parts[0];
    t.rotate = ((t.rotate || 0) + deltaDeg + 720) % 360;
    if (t.rotate > 180) t.rotate -= 360;
    t.update();
    return;
  }
  const { cx, cy } = bakeGroupBoundsPx(parts);
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const t of parts) {
    const w = Math.max(0.1, t.width || 1) * GRID;
    const d = Math.max(0.1, t.depth || 1) * GRID;
    const pcx = (t.location?.x ?? 0) + w / 2;
    const pcy = (t.location?.y ?? 0) + d / 2;
    const dx = pcx - cx;
    const dy = pcy - cy;
    const nx = cx + dx * cos - dy * sin;
    const ny = cy + dx * sin + dy * cos;
    let rot = ((t.rotate || 0) + deltaDeg + 720) % 360;
    if (rot > 180) rot -= 360;
    const x = nx - w / 2;
    const y = ny - d / 2;
    const posZ = t.posZ || 0;
    if (typeof t.withSyncSuppressed === 'function') {
      t.withSyncSuppressed(() => {
        t.rotate = rot;
        commitTerrainPoseInner(t, x, y, posZ);
      });
      t.update();
    } else {
      t.rotate = rot;
      placeTerrainAt(t, x, y, posZ);
    }
  }
  // Keep bakeCrop groupLocal / full* as import (or formBakeGroup) snapshot so
  // assembleBakeGroupAt can restore load-time layout.
}

/** Pose write without outer suppress/update (for nested batch). */
function commitTerrainPoseInner(terrain: Terrain, x: number, y: number, posZ: number): void {
  const hadPlacements = !!terrain.tablePlacements;
  terrain.location = { name: 'table', x, y };
  terrain.posZ = posZ;
  const tableId = TableSelecter.instance?.viewTable?.identifier;
  if (tableId) {
    terrain.addToTable(tableId, { x, y, posZ }, !hadPlacements);
  }
}

/**
 * Uniform scale from a corner grab (bake groups).
 * Use distance(anchor → pointer), not hypot(w+dx, d+dy): for wide/flat
 * footprints a slight perpendicular drift made hypot grow while shrinking.
 *
 * When `start` lands on/near the anchor (bad pointer sample on small pieces),
 * `fallbackStart` (geometric grabbed corner) keeps scaling responsive.
 */
export function uniformScaleFromCornerDrag(
  anchor: { x: number; y: number },
  start: { x: number; y: number },
  cur: { x: number; y: number },
  fallbackStart?: { x: number; y: number },
): number {
  const minStartDist = 8; // px — below this, treat start as unusable
  let ref = start;
  let startDist = Math.hypot(start.x - anchor.x, start.y - anchor.y);
  if (startDist < minStartDist && fallbackStart) {
    ref = fallbackStart;
    startDist = Math.hypot(ref.x - anchor.x, ref.y - anchor.y);
  }
  // Without a usable reference (no/near-anchor fallback), keep scale at 1
  // instead of dividing by a tiny startDist and exploding.
  if (startDist < minStartDist) return 1;
  const curDist = Math.hypot(cur.x - anchor.x, cur.y - anchor.y);
  return Math.max(0.05, curDist / startDist);
}

/**
 * Corner-drag scale factors.
 * - Single terrain (or Shift): free width/depth from pointer delta (classic resize).
 * - Bake group (2+), no Shift: uniform via distance-to-anchor.
 */
export function cornerDragScaleFactors(args: {
  freeAspect: boolean;
  partCount: number;
  corner: 'lt' | 'rb';
  w0: number;
  d0: number;
  dx: number;
  dy: number;
  anchor: { x: number; y: number };
  start: { x: number; y: number };
  cur: { x: number; y: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}): { scaleX: number; scaleY: number } {
  const useUniform = !args.freeAspect && args.partCount > 1;
  if (!useUniform) {
    if (args.corner === 'rb') {
      return {
        scaleX: Math.max(0.05, (args.w0 + args.dx) / args.w0),
        scaleY: Math.max(0.05, (args.d0 + args.dy) / args.d0),
      };
    }
    return {
      scaleX: Math.max(0.05, (args.w0 - args.dx) / args.w0),
      scaleY: Math.max(0.05, (args.d0 - args.dy) / args.d0),
    };
  }
  const geom =
    args.corner === 'rb'
      ? { x: args.bounds.maxX, y: args.bounds.maxY }
      : { x: args.bounds.minX, y: args.bounds.minY };
  const scale = uniformScaleFromCornerDrag(args.anchor, args.start, args.cur, geom);
  return { scaleX: scale, scaleY: scale };
}

/**
 * Scale footprint around an anchor (table px). Updates size and position.
 * Default (and multi-box): uniform XY + matching height.
 * `freeAspect: true` (Shift-drag): independent width/depth; height unchanged.
 * Does not rewrite bakeCrop locals/full sizes — reassemble uses that snapshot.
 */
export function scaleBakeGroupFrom(
  terrains: Terrain[],
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number,
  options?: { freeAspect?: boolean },
): void {
  const parts = terrains.filter(t => !!t);
  if (parts.length < 1) return;
  let sx = Math.max(0.05, scaleX);
  let sy = Math.max(0.05, scaleY);
  const freeAspect = !!options?.freeAspect;
  if (!freeAspect) {
    const s = Math.abs(sx - sy) < 1e-6 ? sx : Math.sqrt(sx * sy);
    sx = sy = Math.max(0.05, s);
  }
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) return;
  const scaleH = freeAspect ? 1 : sx;

  for (const t of parts) {
    const w0 = Math.max(0.1, t.width || 1);
    const d0 = Math.max(0.1, t.depth || 1);
    const h0 = Math.max(0, t.height || 0);
    const x0 = t.location?.x ?? 0;
    const y0 = t.location?.y ?? 0;
    const w1 = Math.max(0.1, w0 * sx);
    const d1 = Math.max(0.1, d0 * sy);
    const h1 = Math.max(0, h0 * scaleH);
    // Min-corner relative to anchor scales; size change keeps the scaled corner.
    const x1 = anchor.x + (x0 - anchor.x) * sx;
    const y1 = anchor.y + (y0 - anchor.y) * sy;
    if (typeof t.withSyncSuppressed === 'function') {
      t.withSyncSuppressed(() => {
        t.mutateAppearance(() => {
          t.width = w1;
          t.depth = d1;
          if (scaleH !== 1) t.height = h1;
        });
        commitTerrainPoseInner(t, x1, y1, t.posZ || 0);
      });
      t.update();
    } else {
      t.mutateAppearance(() => {
        t.width = w1;
        t.depth = d1;
        if (scaleH !== 1) t.height = h1;
      });
      placeTerrainAt(t, x1, y1, t.posZ || 0);
    }
  }
}
