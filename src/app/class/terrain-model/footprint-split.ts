import { MeshAabb } from './mesh-ir';

/** Soft cap — L→2, U→3 (bar + each wing); do not over-split into dust. */
export const FOOTPRINT_MAX_BOXES = 3;
export const FOOTPRINT_FILL_OK = 0.88;
export const FOOTPRINT_GRID = 96;
/** Combined cut score must clear this fraction of parent area (waste↓ + fill↑). */
export const FOOTPRINT_MIN_CUT_WASTE_FRAC = 0.03;
/**
 * Min kept-box area as a fraction of the root (prune dust).
 * NYC left wing is ~2.5–3% of the root AABB; keep that, drop 1-cell stubs.
 */
export const FOOTPRINT_MIN_BOX_AREA_FRAC = 0.02;
/**
 * Min child filled/area as a fraction of the *parent* rect when cutting.
 * Must stay below the smaller wing's share (uneven U ≈ 15/85).
 */
export const FOOTPRINT_MIN_CUT_CHILD_FRAC = 0.05;
/** Child fill must reach this to count as a "solid" capture in cut scoring. */
export const FOOTPRINT_SOLID_FILL = 0.9;
/** Reject peels thinner than this fraction of the parent's shorter side. */
export const FOOTPRINT_MIN_CHILD_SIDE_FRAC = 0.08;

export type FootprintSplitOpts = {
  maxBoxes?: number;
  fillOk?: number;
  grid?: number;
  minCutWasteFrac?: number;
  minBoxAreaFrac?: number;
};

/**
 * Split a Y-up mesh into axis-aligned XZ boxes (same height).
 * Cuts at empty corridors / concave corners (guillotine).
 * High fill ratio or a weak cut → stop. Tiny remnant boxes are pruned.
 */
export function splitFootprintFromPositions(
  positions: Float32Array,
  aabb: MeshAabb,
  opts: FootprintSplitOpts = {},
): MeshAabb[] {
  const maxBoxes = Math.max(1, Math.min(8, opts.maxBoxes ?? FOOTPRINT_MAX_BOXES));
  const fillOk = opts.fillOk ?? FOOTPRINT_FILL_OK;
  const gridN = Math.max(16, Math.min(192, opts.grid ?? FOOTPRINT_GRID));
  const minCutWasteFrac = opts.minCutWasteFrac ?? FOOTPRINT_MIN_CUT_WASTE_FRAC;
  const minBoxAreaFrac = opts.minBoxAreaFrac ?? FOOTPRINT_MIN_BOX_AREA_FRAC;

  const sx = aabb.max[0] - aabb.min[0];
  const sy = aabb.max[1] - aabb.min[1];
  const sz = aabb.max[2] - aabb.min[2];
  if (!(sx > 1e-8) || !(sz > 1e-8) || !positions?.length) return [cloneAabb(aabb)];

  const cols = gridN;
  const rows = gridN;
  const filled = new Uint8Array(cols * rows);
  rasterizeXz(positions, aabb, filled, cols, rows);
  closeHoles(filled, cols, rows);
  dropSmallComponents(filled, cols, rows, Math.max(8, Math.floor(cols * rows * 0.008)));

  const root = tightRect(filled, cols, rows, 0, cols, 0, rows);
  if (!root) return [cloneAabb(aabb)];

  // Vertical cuts first; if that yields a 一字排 of strips, retry with
  // horizontal peels (U/L bar) and keep the less-colinear result.
  const rects = splitRect(filled, cols, rows, root, maxBoxes, fillOk, minCutWasteFrac, false);
  let pruned = pruneTinyRects(rects, root, minBoxAreaFrac);
  if (looksLikeColinearStrips(pruned, root)) {
    const alt = splitRect(filled, cols, rows, root, maxBoxes, fillOk, minCutWasteFrac, true);
    const altPruned = pruneTinyRects(alt, root, minBoxAreaFrac);
    if (altPruned.length) {
      if (!looksLikeColinearStrips(altPruned, root)) {
        pruned = altPruned;
      } else if (zCenterSpan(altPruned) > zCenterSpan(pruned)) {
        pruned = altPruned;
      }
    }
  }
  const boxes = pruned.map(r => rectToAabb(r, aabb, cols, rows, sy));
  return boxes.length ? boxes : [cloneAabb(aabb)];
}

type GridRect = { c0: number; c1: number; r0: number; r1: number };

function rasterizeXz(
  positions: Float32Array,
  aabb: MeshAabb,
  filled: Uint8Array,
  cols: number,
  rows: number,
): void {
  const sx = Math.max(1e-9, aabb.max[0] - aabb.min[0]);
  const sz = Math.max(1e-9, aabb.max[2] - aabb.min[2]);
  const toCol = (x: number) => Math.max(0, Math.min(cols - 1, Math.floor(((x - aabb.min[0]) / sx) * cols)));
  const toRow = (z: number) => Math.max(0, Math.min(rows - 1, Math.floor(((z - aabb.min[2]) / sz) * rows)));

  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i]; const az = positions[i + 2];
    const bx = positions[i + 3]; const bz = positions[i + 5];
    const cx = positions[i + 6]; const cz = positions[i + 8];
    if (![ax, az, bx, bz, cx, cz].every(Number.isFinite)) continue;

    const cMin = Math.min(toCol(ax), toCol(bx), toCol(cx));
    const cMax = Math.max(toCol(ax), toCol(bx), toCol(cx));
    const rMin = Math.min(toRow(az), toRow(bz), toRow(cz));
    const rMax = Math.max(toRow(az), toRow(bz), toRow(cz));
    if (cMax - cMin <= 1 && rMax - rMin <= 1) {
      filled[cMin + rMin * cols] = 1;
      filled[cMax + rMax * cols] = 1;
      continue;
    }
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        const px = aabb.min[0] + ((c + 0.5) / cols) * sx;
        const pz = aabb.min[2] + ((r + 0.5) / rows) * sz;
        if (pointInTri(px, pz, ax, az, bx, bz, cx, cz)) {
          filled[c + r * cols] = 1;
        }
      }
    }
  }
}

function pointInTri(
  px: number, pz: number,
  ax: number, az: number,
  bx: number, bz: number,
  cx: number, cz: number,
): boolean {
  const v0x = cx - ax; const v0z = cz - az;
  const v1x = bx - ax; const v1z = bz - az;
  const v2x = px - ax; const v2z = pz - az;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-20) return false;
  const u = (dot11 * dot02 - dot01 * dot12) / denom;
  const v = (dot00 * dot12 - dot01 * dot02) / denom;
  return u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4;
}

/** One-cell close: dilate then erode so 1-cell wall gaps join without filling courtyards. */
function closeHoles(filled: Uint8Array, cols: number, rows: number): void {
  const dil = new Uint8Array(filled.length);
  dilate(filled, dil, cols, rows);
  erode(dil, filled, cols, rows);
}

function dilate(src: Uint8Array, dst: Uint8Array, cols: number, rows: number): void {
  dst.set(src);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!src[c + r * cols]) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          dst[nc + nr * cols] = 1;
        }
      }
    }
  }
}

function erode(src: Uint8Array, dst: Uint8Array, cols: number, rows: number): void {
  dst.fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!src[c + r * cols]) continue;
      let keep = true;
      for (let dr = -1; dr <= 1 && keep; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || !src[nc + nr * cols]) {
            keep = false;
            break;
          }
        }
      }
      if (keep) dst[c + r * cols] = 1;
    }
  }
}

function splitRect(
  filled: Uint8Array,
  cols: number,
  rows: number,
  rect: GridRect,
  budget: number,
  fillOk: number,
  minCutWasteFrac: number,
  preferHorizontal: boolean,
): GridRect[] {
  const tight = tightRect(filled, cols, rows, rect.c0, rect.c1, rect.r0, rect.r1);
  if (!tight) return [];
  const fill = fillRatio(filled, cols, tight);
  if (budget <= 1 || fill >= fillOk) return [tight];
  // Narrow stubs (NYC left wing ~3%): further cuts only produce wall shards.
  const area = (tight.c1 - tight.c0) * (tight.r1 - tight.r0);
  if (area < cols * rows * 0.05 && fill >= 0.55) return [tight];

  const cut = bestCut(filled, cols, rows, tight, minCutWasteFrac, preferHorizontal);
  if (!cut) return [tight];

  // Spend budget on the emptier side first (U wings need the cuts; a solid bar does not).
  const fillA = fillRatio(filled, cols, cut.a);
  const fillB = fillRatio(filled, cols, cut.b);
  const first = fillA <= fillB ? cut.a : cut.b;
  const second = fillA <= fillB ? cut.b : cut.a;
  const firstBoxes = splitRect(filled, cols, rows, first, budget - 1, fillOk, minCutWasteFrac, preferHorizontal);
  const remain = Math.max(1, budget - firstBoxes.length);
  const secondBoxes = splitRect(filled, cols, rows, second, remain, fillOk, minCutWasteFrac, preferHorizontal);
  const out = [...firstBoxes, ...secondBoxes];
  if (!out.length) return [tight];
  if (out.length <= budget) return out;
  return out
    .map(r => ({ r, area: (r.c1 - r.c0) * (r.r1 - r.r0) }))
    .sort((x, y) => y.area - x.area)
    .slice(0, budget)
    .map(x => x.r);
}

function bestCut(
  filled: Uint8Array,
  cols: number,
  rows: number,
  rect: GridRect,
  minCutWasteFrac: number,
  preferHorizontal: boolean,
): { a: GridRect; b: GridRect } | null {
  const parentWaste = waste(filled, cols, rect);
  const parentArea = Math.max(1, (rect.c1 - rect.c0) * (rect.r1 - rect.r0));
  const parentFilled = countFilled(filled, cols, rect);
  const parentW = rect.c1 - rect.c0;
  const parentH = rect.r1 - rect.r0;
  // Absolute 0.5-cell threshold over-split noisy footprints into max boxes + dust.
  let bestScore = Math.max(6, parentFilled * minCutWasteFrac, parentArea * minCutWasteFrac * 0.5);
  let best: { a: GridRect; b: GridRect } | null = null;
  const minChildFilled = Math.max(8, Math.floor(parentFilled * FOOTPRINT_MIN_CUT_CHILD_FRAC));
  const minChildArea = Math.max(16, Math.floor(parentArea * FOOTPRINT_MIN_CUT_CHILD_FRAC));
  const minSide = Math.max(4, Math.floor(Math.min(parentW, parentH) * FOOTPRINT_MIN_CHILD_SIDE_FRAC));

  const consider = (a: GridRect | null, b: GridRect | null, corridorEmpty: number, horizontal: boolean) => {
    if (!a || !b) return;
    const sideA = Math.min(a.c1 - a.c0, a.r1 - a.r0);
    const sideB = Math.min(b.c1 - b.c0, b.r1 - b.r0);
    if (sideA < minSide || sideB < minSide) return;
    const areaA = (a.c1 - a.c0) * (a.r1 - a.r0);
    const areaB = (b.c1 - b.c0) * (b.r1 - b.r0);
    if (areaA < minChildArea || areaB < minChildArea) return;
    const filledA = countFilled(filled, cols, a);
    const filledB = countFilled(filled, cols, b);
    if (filledA < minChildFilled || filledB < minChildFilled) return;
    const fillA = filledA / Math.max(1, areaA);
    const fillB = filledB / Math.max(1, areaB);
    const solidA = fillA >= FOOTPRINT_SOLID_FILL;
    const solidB = fillB >= FOOTPRINT_SOLID_FILL;
    const wasteReduction = parentWaste - waste(filled, cols, a) - waste(filled, cols, b);
    // Both-solid + no corridor/waste↓ = bisecting a slab into strips (一字排). Reject.
    if (
      solidA && solidB
      && wasteReduction < parentArea * minCutWasteFrac
      && corridorEmpty < 0.45
    ) {
      return;
    }
    const solidCaptured = (solidA ? filledA : 0) + (solidB ? filledB : 0);
    const bothSolidBonus = solidA && solidB ? parentFilled : 0;
    const horizontalBonus = preferHorizontal && horizontal ? parentFilled * 0.5 : 0;
    const score =
      solidCaptured +
      bothSolidBonus +
      horizontalBonus +
      Math.max(0, wasteReduction) * 0.25 +
      corridorEmpty * parentFilled * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = { a, b };
    }
  };

  if (!preferHorizontal) {
    for (let c = rect.c0 + 1; c < rect.c1; c++) {
      consider(
        tightRect(filled, cols, rows, rect.c0, c, rect.r0, rect.r1),
        tightRect(filled, cols, rows, c, rect.c1, rect.r0, rect.r1),
        colEmptyFrac(filled, cols, c, rect.r0, rect.r1),
        false,
      );
    }
  }
  for (let r = rect.r0 + 1; r < rect.r1; r++) {
    consider(
      tightRect(filled, cols, rows, rect.c0, rect.c1, rect.r0, r),
      tightRect(filled, cols, rows, rect.c0, rect.c1, r, rect.r1),
      rowEmptyFrac(filled, cols, r, rect.c0, rect.c1),
      true,
    );
  }
  // Prefer-horizontal pass: if no row cut worked, allow vertical as fallback.
  if (preferHorizontal && !best) {
    for (let c = rect.c0 + 1; c < rect.c1; c++) {
      consider(
        tightRect(filled, cols, rows, rect.c0, c, rect.r0, rect.r1),
        tightRect(filled, cols, rows, c, rect.c1, rect.r0, rect.r1),
        colEmptyFrac(filled, cols, c, rect.r0, rect.r1),
        false,
      );
    }
  }
  return best;
}

function colEmptyFrac(filled: Uint8Array, cols: number, c: number, r0: number, r1: number): number {
  const n = Math.max(1, r1 - r0);
  let empty = 0;
  for (let r = r0; r < r1; r++) if (!filled[c + r * cols]) empty++;
  return empty / n;
}

function rowEmptyFrac(filled: Uint8Array, cols: number, r: number, c0: number, c1: number): number {
  const n = Math.max(1, c1 - c0);
  let empty = 0;
  for (let c = c0; c < c1; c++) if (!filled[c + r * cols]) empty++;
  return empty / n;
}

/** Drop isolated dust islands before guillotine (keeps the main L / building mass). */
function dropSmallComponents(filled: Uint8Array, cols: number, rows: number, minCells: number): void {
  const seen = new Uint8Array(filled.length);
  const queue = new Int32Array(filled.length);
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i] || seen[i]) continue;
    let qh = 0;
    let qt = 0;
    queue[qt++] = i;
    seen[i] = 1;
    const cells: number[] = [];
    while (qh < qt) {
      const cur = queue[qh++];
      cells.push(cur);
      const c = cur % cols;
      const r = (cur / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
          const ni = nc + nr * cols;
          if (!filled[ni] || seen[ni]) continue;
          seen[ni] = 1;
          queue[qt++] = ni;
        }
      }
    }
    if (cells.length < minCells) {
      for (const cell of cells) filled[cell] = 0;
    }
  }
}

/** Drop dust boxes; keep at least the largest piece. */
function pruneTinyRects(rects: GridRect[], root: GridRect, minBoxAreaFrac: number): GridRect[] {
  if (rects.length <= 1) return rects;
  const rootArea = Math.max(1, (root.c1 - root.c0) * (root.r1 - root.r0));
  const minArea = Math.max(4, rootArea * minBoxAreaFrac);
  const kept = rects.filter(r => (r.c1 - r.c0) * (r.r1 - r.r0) >= minArea);
  if (kept.length) return kept;
  let best = rects[0];
  let bestArea = 0;
  for (const r of rects) {
    const a = (r.c1 - r.c0) * (r.r1 - r.r0);
    if (a > bestArea) {
      bestArea = a;
      best = r;
    }
  }
  return [best];
}

/**
 * True when pieces share nearly the same Z-center (side-by-side strips → 一字排).
 * Real L/U parts have a bar and wings with clearly different Z centers.
 */
function looksLikeColinearStrips(rects: GridRect[], root: GridRect): boolean {
  if (rects.length < 2) return false;
  const rootH = Math.max(1, root.r1 - root.r0);
  return zCenterSpan(rects) < rootH * 0.2;
}

function zCenterSpan(rects: GridRect[]): number {
  if (rects.length < 2) return 0;
  const centers = rects.map(r => (r.r0 + r.r1) * 0.5);
  return Math.max(...centers) - Math.min(...centers);
}

function tightRect(
  filled: Uint8Array,
  cols: number,
  rows: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
): GridRect | null {
  let tc0 = cols;
  let tc1 = 0;
  let tr0 = rows;
  let tr1 = 0;
  let any = false;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      if (!filled[c + r * cols]) continue;
      any = true;
      if (c < tc0) tc0 = c;
      if (c + 1 > tc1) tc1 = c + 1;
      if (r < tr0) tr0 = r;
      if (r + 1 > tr1) tr1 = r + 1;
    }
  }
  if (!any) return null;
  return { c0: tc0, c1: tc1, r0: tr0, r1: tr1 };
}

function countFilled(filled: Uint8Array, cols: number, rect: GridRect): number {
  let n = 0;
  for (let r = rect.r0; r < rect.r1; r++) {
    for (let c = rect.c0; c < rect.c1; c++) {
      if (filled[c + r * cols]) n++;
    }
  }
  return n;
}

function fillRatio(filled: Uint8Array, cols: number, rect: GridRect): number {
  const area = Math.max(1, (rect.c1 - rect.c0) * (rect.r1 - rect.r0));
  return countFilled(filled, cols, rect) / area;
}

function waste(filled: Uint8Array, cols: number, rect: GridRect): number {
  const area = Math.max(0, (rect.c1 - rect.c0) * (rect.r1 - rect.r0));
  return area - countFilled(filled, cols, rect);
}

function rectToAabb(
  rect: GridRect,
  aabb: MeshAabb,
  cols: number,
  rows: number,
  sy: number,
): MeshAabb {
  const sx = aabb.max[0] - aabb.min[0];
  const sz = aabb.max[2] - aabb.min[2];
  const padC = 0.5 / cols;
  const padR = 0.5 / rows;
  const u0 = Math.max(0, rect.c0 / cols - padC);
  const u1 = Math.min(1, rect.c1 / cols + padC);
  const v0 = Math.max(0, rect.r0 / rows - padR);
  const v1 = Math.min(1, rect.r1 / rows + padR);
  return {
    min: [aabb.min[0] + u0 * sx, aabb.min[1], aabb.min[2] + v0 * sz],
    max: [aabb.min[0] + u1 * sx, aabb.min[1] + sy, aabb.min[2] + v1 * sz],
  };
}

function cloneAabb(aabb: MeshAabb): MeshAabb {
  return { min: [aabb.min[0], aabb.min[1], aabb.min[2]], max: [aabb.max[0], aabb.max[1], aabb.max[2]] };
}
