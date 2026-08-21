import { Terrain, TerrainFaceName, TERRAIN_SIZE_MIN } from '@udonarium/terrain';

import { MeshAabb } from './mesh-ir';
import { BakedFaceBlobs } from './ortho-bake';

/** 0.8% of the face long edge, clamped 1–16 px (texel pad at 1024). */
export const BAKE_CROP_PAD_FRACTION = 0.008;
export const BAKE_CROP_PAD_MIN_PX = 1;
export const BAKE_CROP_PAD_MAX_PX = 16;
export const BAKE_CROP_ALPHA_MIN = 12;
/**
 * A column/row counts as part of the solid mass when its opaque count is at least
 * this fraction of the peak column/row (ignores thin sign / AC whiskers).
 */
export const BAKE_CROP_SOLID_PEAK_FRAC = 0.35;
/** Absolute floor: opaque pixels vs the *band* cross-axis length. */
export const BAKE_CROP_SOLID_ABS_FRAC = 0.2;
/**
 * After picking the longest solid run, shrink edges while fill is below this
 * fraction of the band peak.
 */
export const BAKE_CROP_EDGE_PEAK_FRAC = 0.5;
/** Shrink while fill is below this fraction of the band cross-axis length. */
export const BAKE_CROP_EDGE_FILL_FRAC = 0.25;
/**
 * Wall/floor joining edges: trim lines that are sparse, much darker than the
 * band median, or a narrow brighter quoin/corner strip.
 *
 * Fill floor is ~0.70 (not 0.98): L-notch roofs have south rows ~50% filled
 * (must crop) while a shorter west wing stays ~80%+ (must keep).
 */
export const BAKE_CROP_QUALITY_FILL_MIN = 0.7;
/** Trim lines darker than median by this RGB-sum margin. */
export const BAKE_CROP_QUALITY_DARK_TOL = 100;
/** Bright quoin/corner strip: brighter than median by this RGB-sum margin. */
export const BAKE_CROP_QUALITY_BRIGHT_TOL = 70;
/** Max width of a bright edge strip to remove, as a fraction of that axis. */
export const BAKE_CROP_QUOIN_STRIP_MAX_FRAC = 0.08;
/** Extra bleed only on edges that quality-trim actually moved. */
export const BAKE_CROP_EDGE_BLEED_FRAC = 0.012;
const INSET_SUM_MAX = 0.999;

export type BakeCropInsetsOptions = {
  /**
   * Trim sparse/dark fringes and narrow bright corner strips on all four edges
   * (W/E columns and N/S rows), using density inside the solid band so wall
   * height is not judged against empty canvas beside the facade.
   */
  qualityEdges?: boolean;
};

export type FaceEdgeInsets = {
  west: number;
  east: number;
  south: number;
  north: number;
};

/** @deprecated Use FaceEdgeInsets — same shape; NESW are that photo's edges (north = top). */
export type FootprintInsets = FaceEdgeInsets;

export type PerFaceInsets = Partial<Record<TerrainFaceName, FaceEdgeInsets>>;

export const BAKE_CROP_FACES: TerrainFaceName[] = [
  'floor', 'underside', 'wallTop', 'wallBottom', 'wallLeft', 'wallRight',
];

export type TerrainBakeCropState = {
  sources: Partial<Record<TerrainFaceName, string>>;
  /** Per-face photo edges. north = top of that image (south wall top = 北). */
  faces: PerFaceInsets;
  /** Legacy single footprint crop; migrated into `faces` on parse. */
  insets?: FaceEdgeInsets;
  fullWidth: number;
  fullDepth: number;
  fullHeight: number;
  anchorX: number;
  anchorY: number;
  /** Offset from the multi-box model origin (table px); used to reassemble groups. */
  groupLocalX?: number;
  groupLocalY?: number;
  /** Expected member count for this bake group (completeness checks). */
  groupSize?: number;
};

export type PixelRect = { x: number; y: number; w: number; h: number };

export function emptyInsets(): FootprintInsets {
  return { west: 0, east: 0, south: 0, north: 0 };
}

export function padPxForLongEdge(longEdgePx: number): number {
  const raw = Math.round(Math.max(0, longEdgePx) * BAKE_CROP_PAD_FRACTION);
  return Math.min(BAKE_CROP_PAD_MAX_PX, Math.max(BAKE_CROP_PAD_MIN_PX, raw));
}

export function clampInsets(insets: FootprintInsets): FootprintInsets {
  let west = clamp01(insets.west);
  let east = clamp01(insets.east);
  let south = clamp01(insets.south);
  let north = clamp01(insets.north);
  const we = west + east;
  if (we > INSET_SUM_MAX && we > 0) {
    const s = INSET_SUM_MAX / we;
    west *= s;
    east *= s;
  }
  const ns = north + south;
  if (ns > INSET_SUM_MAX && ns > 0) {
    const s = INSET_SUM_MAX / ns;
    north *= s;
    south *= s;
  }
  return { west, east, south, north };
}

/**
 * Opaque solid core of a photo → NESW fractions of THAT image.
 * north = top, south = bottom, west = left, east = right.
 *
 * Two-pass longest dense run: after an initial column band is found, row
 * density is measured *inside that band* (and columns remeasured inside the
 * row band). Side walls that only fill half the bake canvas must not have
 * their height judged against a full-width peak row (that used to crop ~77%
 * of the facade). Soft fringe columns (~25% fill) are still trimmed.
 *
 * With `qualityEdges`, also trims dark/sparse fringes and narrow bright corner
 * strips on all four edges. Sparse means fill below ~70% of the solid band
 * (south notches ~50% crop; shorter wings ~80% keep).
 */
export function insetsFromOpaqueRgba(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  alphaMin: number = BAKE_CROP_ALPHA_MIN,
  options?: BakeCropInsetsOptions,
): FootprintInsets {
  if (width < 1 || height < 1) return emptyInsets();

  const col = new Uint32Array(width);
  const row = new Uint32Array(height);
  let any = false;
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(rowOff + x) * 4 + 3] < alphaMin) continue;
      col[x]++;
      row[y]++;
      any = true;
    }
  }
  if (!any) return emptyInsets();

  let peakC = 0;
  let peakR = 0;
  for (let x = 0; x < width; x++) if (col[x] > peakC) peakC = col[x];
  for (let y = 0; y < height; y++) if (row[y] > peakR) peakR = row[y];

  const thrC0 = Math.max(peakC * BAKE_CROP_SOLID_PEAK_FRAC, height * BAKE_CROP_SOLID_ABS_FRAC);
  const thrR0 = Math.max(peakR * BAKE_CROP_SOLID_PEAK_FRAC, width * BAKE_CROP_SOLID_ABS_FRAC);

  let minX = longestDenseRunStart(col, thrC0);
  let maxX = longestDenseRunEnd(col, thrC0);
  let minY = longestDenseRunStart(row, thrR0);
  let maxY = longestDenseRunEnd(row, thrR0);
  if (maxX < minX || maxY < minY) return emptyInsets();

  // Pass 2: density inside the opposite band (fixes half-width side walls /
  // partial-height floors whose global peak misleads edge thresholds).
  const rowBand = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let n = 0;
    for (let x = minX; x <= maxX; x++) {
      if (data[(rowOff + x) * 4 + 3] >= alphaMin) n++;
    }
    rowBand[y] = n;
  }
  let peakR2 = 0;
  for (let y = 0; y < height; y++) if (rowBand[y] > peakR2) peakR2 = rowBand[y];
  const bandW0 = Math.max(1, maxX - minX + 1);
  const thrR2 = Math.max(peakR2 * BAKE_CROP_SOLID_PEAK_FRAC, bandW0 * BAKE_CROP_SOLID_ABS_FRAC);
  minY = longestDenseRunStart(rowBand, thrR2);
  maxY = longestDenseRunEnd(rowBand, thrR2);
  if (maxY < minY) return emptyInsets();

  const colBand = new Uint32Array(width);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = minY; y <= maxY; y++) {
      if (data[(y * width + x) * 4 + 3] >= alphaMin) n++;
    }
    colBand[x] = n;
  }
  let peakC2 = 0;
  for (let x = 0; x < width; x++) if (colBand[x] > peakC2) peakC2 = colBand[x];
  const bandH0 = Math.max(1, maxY - minY + 1);
  const thrC2 = Math.max(peakC2 * BAKE_CROP_SOLID_PEAK_FRAC, bandH0 * BAKE_CROP_SOLID_ABS_FRAC);
  minX = longestDenseRunStart(colBand, thrC2);
  maxX = longestDenseRunEnd(colBand, thrC2);
  if (maxX < minX) return emptyInsets();

  let bandPeakC = 0;
  for (let x = minX; x <= maxX; x++) if (colBand[x] > bandPeakC) bandPeakC = colBand[x];
  let bandPeakR = 0;
  for (let y = minY; y <= maxY; y++) if (rowBand[y] > bandPeakR) bandPeakR = rowBand[y];
  const bandW = Math.max(1, maxX - minX + 1);
  const bandH = Math.max(1, maxY - minY + 1);
  const edgeC = Math.max(bandPeakC * BAKE_CROP_EDGE_PEAK_FRAC, bandH * BAKE_CROP_EDGE_FILL_FRAC);
  const edgeR = Math.max(bandPeakR * BAKE_CROP_EDGE_PEAK_FRAC, bandW * BAKE_CROP_EDGE_FILL_FRAC);
  while (minX < maxX && colBand[minX] < edgeC) minX++;
  while (maxX > minX && colBand[maxX] < edgeC) maxX--;
  while (minY < maxY && rowBand[minY] < edgeR) minY++;
  while (maxY > minY && rowBand[maxY] < edgeR) maxY--;

  if (options?.qualityEdges) {
    const before = { minX, maxX, minY, maxY };
    const q = tightenQualityEdges(data, width, height, minX, maxX, minY, maxY, alphaMin);
    minX = q.minX;
    maxX = q.maxX;
    minY = q.minY;
    maxY = q.maxY;
    const bleedX = Math.round(width * BAKE_CROP_EDGE_BLEED_FRAC);
    const bleedY = Math.round(height * BAKE_CROP_EDGE_BLEED_FRAC);
    if (minX > before.minX) minX = Math.min(maxX, minX + bleedX);
    if (maxX < before.maxX) maxX = Math.max(minX, maxX - bleedX);
    if (minY > before.minY) minY = Math.min(maxY, minY + bleedY);
    if (maxY < before.maxY) maxY = Math.max(minY, maxY - bleedY);
  }

  const pad = padPxForLongEdge(Math.max(width, height));
  // Pad only into fully empty cells — never re-include soft fringe we just trimmed.
  let left = minX;
  let right = maxX;
  let top = minY;
  let bottom = maxY;
  for (let i = 0; i < pad && left > 0 && col[left - 1] === 0; i++) left--;
  for (let i = 0; i < pad && right < width - 1 && col[right + 1] === 0; i++) right++;
  for (let i = 0; i < pad && top > 0 && row[top - 1] === 0; i++) top--;
  for (let i = 0; i < pad && bottom < height - 1 && row[bottom + 1] === 0; i++) bottom++;
  return clampInsets({
    west: left / width,
    east: (width - 1 - right) / width,
    north: top / height,
    south: (height - 1 - bottom) / height,
  });
}

/**
 * Trim W/E columns and N/S rows that are sparse, much darker than the band
 * median, or a narrow brighter corner strip. Fill is measured inside the solid
 * band so side-wall height is not destroyed by empty canvas beside the facade.
 */
function tightenQualityEdges(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  alphaMin: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const bandH = Math.max(1, maxY - minY + 1);
  const bandW = Math.max(1, maxX - minX + 1);

  const colFill = new Float64Array(width);
  const colLuma = new Float64Array(width);
  for (let x = minX; x <= maxX; x++) {
    let op = 0;
    let lumaSum = 0;
    for (let y = minY; y <= maxY; y++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < alphaMin) continue;
      op++;
      lumaSum += data[i] + data[i + 1] + data[i + 2];
    }
    colFill[x] = op / bandH;
    colLuma[x] = op ? lumaSum / op : 0;
  }

  const rowFill = new Float64Array(height);
  const rowLuma = new Float64Array(height);
  for (let y = minY; y <= maxY; y++) {
    let op = 0;
    let lumaSum = 0;
    for (let x = minX; x <= maxX; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < alphaMin) continue;
      op++;
      lumaSum += data[i] + data[i + 1] + data[i + 2];
    }
    rowFill[y] = op / bandW;
    rowLuma[y] = op ? lumaSum / op : 0;
  }

  const tightenedX = tightenAxisEdges(colFill, colLuma, minX, maxX, width);
  minX = tightenedX.lo;
  maxX = tightenedX.hi;
  const tightenedY = tightenAxisEdges(rowFill, rowLuma, minY, maxY, height);
  minY = tightenedY.lo;
  maxY = tightenedY.hi;
  return { minX, maxX, minY, maxY };
}

function tightenAxisEdges(
  fill: Float64Array,
  meanL: Float64Array,
  lo: number,
  hi: number,
  axisLen: number,
): { lo: number; hi: number } {
  const c0 = lo + Math.floor((hi - lo) / 3);
  const c1 = hi - Math.floor((hi - lo) / 3);
  const samples: number[] = [];
  for (let i = c0; i <= c1; i++) {
    if (fill[i] >= 0.5) samples.push(meanL[i]);
  }
  samples.sort((a, b) => a - b);
  const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
  const darkMax = median - BAKE_CROP_QUALITY_DARK_TOL;
  const brightMin = median + BAKE_CROP_QUALITY_BRIGHT_TOL;

  const sparseOrDark = (i: number) =>
    fill[i] < BAKE_CROP_QUALITY_FILL_MIN || meanL[i] < darkMax;

  while (lo < hi && sparseOrDark(lo)) lo++;
  while (hi > lo && sparseOrDark(hi)) hi--;

  const maxStrip = Math.max(1, Math.floor(axisLen * BAKE_CROP_QUOIN_STRIP_MAX_FRAC));
  if (hi > lo && meanL[hi] > brightMin && fill[hi] >= BAKE_CROP_QUALITY_FILL_MIN) {
    let i = hi;
    while (i > lo && meanL[i] > brightMin && fill[i] >= BAKE_CROP_QUALITY_FILL_MIN) i--;
    const strip = hi - i;
    if (strip > 0 && strip <= maxStrip) hi = i;
  }
  if (hi > lo && meanL[lo] > brightMin && fill[lo] >= BAKE_CROP_QUALITY_FILL_MIN) {
    let i = lo;
    while (i < hi && meanL[i] > brightMin && fill[i] >= BAKE_CROP_QUALITY_FILL_MIN) i++;
    const strip = i - lo;
    if (strip > 0 && strip <= maxStrip) lo = i;
  }
  return { lo, hi };
}

/** First index of the longest contiguous run where values[i] >= thr. */
function longestDenseRunStart(values: Uint32Array, thr: number): number {
  const [start] = longestDenseRun(values, thr);
  return start;
}

function longestDenseRunEnd(values: Uint32Array, thr: number): number {
  const [, end] = longestDenseRun(values, thr);
  return end;
}

function longestDenseRun(values: Uint32Array, thr: number): [number, number] {
  let bestStart = 0;
  let bestEnd = -1;
  let curStart = -1;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] >= thr;
    if (on) {
      if (curStart < 0) curStart = i;
      continue;
    }
    if (curStart >= 0) {
      const end = i - 1;
      if (end - curStart > bestEnd - bestStart) {
        bestStart = curStart;
        bestEnd = end;
      }
      curStart = -1;
    }
  }
  return [bestStart, bestEnd];
}

/**
 * Crop a face photo. NESW are that image's edges (north = top), so a south
 * wall can crop its upper sign band with north.
 */
export function cropRectForFace(
  _face: TerrainFaceName,
  width: number,
  height: number,
  insets: FaceEdgeInsets,
): PixelRect {
  const i = clampInsets(insets);
  if (width < 1 || height < 1) return { x: 0, y: 0, w: width, h: height };
  const x = Math.round(i.west * width);
  const y = Math.round(i.north * height);
  const w = Math.max(1, Math.round(width * (1 - i.west - i.east)));
  const h = Math.max(1, Math.round(height * (1 - i.north - i.south)));
  return {
    x: Math.max(0, Math.min(width - 1, x)),
    y: Math.max(0, Math.min(height - 1, y)),
    w: Math.max(1, Math.min(width - Math.max(0, x), w)),
    h: Math.max(1, Math.min(height - Math.max(0, y), h)),
  };
}

export function clipPathForFace(_face: TerrainFaceName, insets: FaceEdgeInsets): string {
  const i = clampInsets(insets);
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
  return `inset(${pct(i.north)} ${pct(i.east)} ${pct(i.south)} ${pct(i.west)})`;
}

/** Stretch the remaining photo region to fill the CSS face (live table preview). */
export function faceCropBackgroundStyle(insets: FaceEdgeInsets | null | undefined): {
  'background-size': string;
  'background-position': string;
  'background-repeat': string;
} {
  const i = clampInsets(insets || emptyInsets());
  const wf = Math.max(1e-3, 1 - i.west - i.east);
  const hf = Math.max(1e-3, 1 - i.north - i.south);
  const posX = i.west + i.east > 1e-6 ? (i.west / (i.west + i.east)) * 100 : 50;
  const posY = i.north + i.south > 1e-6 ? (i.north / (i.north + i.south)) * 100 : 50;
  return {
    'background-size': `${(100 / wf).toFixed(4)}% ${(100 / hf).toFixed(4)}%`,
    'background-position': `${posX}% ${posY}%`,
    'background-repeat': 'no-repeat',
  };
}

export function emptyPerFaceInsets(): PerFaceInsets {
  return {};
}

export function clonePerFaceInsets(faces: PerFaceInsets | null | undefined): PerFaceInsets {
  const out: PerFaceInsets = {};
  for (const face of BAKE_CROP_FACES) {
    const src = faces?.[face];
    if (src) out[face] = clampInsets(src);
  }
  return out;
}

export function insetsAlmostZero(insets: FaceEdgeInsets | null | undefined): boolean {
  const i = clampInsets(insets || emptyInsets());
  return i.west + i.east + i.south + i.north < 1e-6;
}

export function insetAabbXz(aabb: MeshAabb, insets: FaceEdgeInsets): MeshAabb {
  const i = clampInsets(insets);
  const sx = aabb.max[0] - aabb.min[0];
  const sz = aabb.max[2] - aabb.min[2];
  return {
    min: [aabb.min[0] + sx * i.west, aabb.min[1], aabb.min[2] + sz * i.north],
    max: [aabb.max[0] - sx * i.east, aabb.max[1], aabb.max[2] - sz * i.south],
  };
}

export async function insetsFromFaceBlob(
  blob: Blob | undefined,
  options?: BakeCropInsetsOptions,
): Promise<FaceEdgeInsets> {
  if (!blob) return emptyInsets();
  const decoded = await decodeRgba(blob);
  if (!decoded) return emptyInsets();
  return insetsFromOpaqueRgba(decoded.data, decoded.width, decoded.height, BAKE_CROP_ALPHA_MIN, options);
}

export async function insetsFromFloorBlob(blob: Blob | undefined): Promise<FaceEdgeInsets> {
  return insetsFromFaceBlob(blob);
}

export async function autoPerFaceInsets(blobs: BakedFaceBlobs): Promise<PerFaceInsets> {
  const out: PerFaceInsets = {};
  for (const face of BAKE_CROP_FACES) {
    const blob = blobs[face];
    if (!blob) continue;
    // Same rules on every face: density solid-core, then quality fringe/quoin trim.
    out[face] = await insetsFromFaceBlob(blob, { qualityEdges: true });
  }
  return out;
}

/**
 * Optional helper: same north/south crop on every wall.
 * Not used by auto-crop (see autoPerFaceInsets) — kept for callers that want it.
 */
export function unifyWallVerticalInsets(faces: PerFaceInsets): void {
  const walls: TerrainFaceName[] = ['wallTop', 'wallBottom', 'wallLeft', 'wallRight'];
  let north = 0;
  let south = 0;
  let any = false;
  for (const face of walls) {
    const i = faces[face];
    if (!i) continue;
    any = true;
    if (i.north > north) north = i.north;
    if (i.south > south) south = i.south;
  }
  if (!any) return;
  for (const face of walls) {
    const i = faces[face];
    if (!i) continue;
    faces[face] = clampInsets({ ...i, north, south });
  }
}

export async function cropFaceBlob(
  blob: Blob,
  face: TerrainFaceName,
  insets: FaceEdgeInsets,
): Promise<Blob> {
  const img = await loadImage(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const rect = cropRectForFace(face, w, h, insets);
  if (rect.x === 0 && rect.y === 0 && rect.w === w && rect.h === h) return blob;
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.clearRect(0, 0, rect.w, rect.h);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const out = await canvasToPng(canvas);
  return out || blob;
}

export async function cropAllFaceBlobs(
  blobs: BakedFaceBlobs,
  faces: PerFaceInsets,
): Promise<BakedFaceBlobs> {
  const out: BakedFaceBlobs = {};
  for (const face of Object.keys(blobs) as TerrainFaceName[]) {
    const src = blobs[face];
    if (!src) continue;
    const insets = faces[face] || emptyInsets();
    out[face] = insetsAlmostZero(insets) ? src : await cropFaceBlob(src, face, insets);
  }
  return out;
}

export function parseBakeCropState(raw: string | null | undefined): TerrainBakeCropState | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return null;
    const sources = j.sources && typeof j.sources === 'object' ? j.sources : {};
    const faces: PerFaceInsets = {};
    if (j.faces && typeof j.faces === 'object') {
      for (const face of BAKE_CROP_FACES) {
        const src = j.faces[face];
        if (src) faces[face] = clampInsets(src);
      }
    } else if (j.insets) {
      const legacy = clampInsets(j.insets);
      for (const face of BAKE_CROP_FACES) faces[face] = { ...legacy };
    }
    return {
      sources,
      faces,
      insets: j.insets ? clampInsets(j.insets) : emptyInsets(),
      fullWidth: Math.max(TERRAIN_SIZE_MIN, +j.fullWidth || 0),
      fullDepth: Math.max(TERRAIN_SIZE_MIN, +j.fullDepth || 0),
      fullHeight: Math.max(0, +j.fullHeight || 0),
      anchorX: +j.anchorX || 0,
      anchorY: +j.anchorY || 0,
      groupLocalX: typeof j.groupLocalX === 'number' ? j.groupLocalX : undefined,
      groupLocalY: typeof j.groupLocalY === 'number' ? j.groupLocalY : undefined,
      groupSize: typeof j.groupSize === 'number' && j.groupSize > 0 ? Math.floor(j.groupSize) : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeBakeCropState(state: TerrainBakeCropState): string {
  return JSON.stringify(state);
}

export function hasBakeCropSources(terrain: Terrain | null | undefined): boolean {
  const state = parseBakeCropState(terrain?.bakeCropJson);
  if (!state) return false;
  return !!(state.sources.floor || state.sources.wallBottom);
}

/**
 * Persist crop insets and keep display images = uncropped sources.
 * The table crops via CSS (same as live preview). Re-baking bitmaps while
 * also applying CSS insets double-crops and warps the look after save.
 */
export async function applyBakeCropToTerrain(terrain: Terrain, faces: PerFaceInsets): Promise<void> {
  const state = parseBakeCropState(terrain.bakeCropJson);
  if (!state) return;
  const next = clonePerFaceInsets(faces);
  terrain.mutateAppearance(() => {
    terrain.bakeCropJson = serializeBakeCropState({ ...state, faces: next });
    applyBakeCropSourcesToFaces(terrain, state.sources);
  });
}

/** Point terrain face slots at bake-crop source images (uncropped). */
export function applyBakeCropSourcesToFaces(
  terrain: Terrain,
  sources: Partial<Record<TerrainFaceName, string>>,
): void {
  if (sources.floor) terrain.setFaceImage('floor', sources.floor);
  if (sources.wallBottom) {
    terrain.setFaceImage('wall', sources.wallBottom);
    terrain.setFaceImage('wallBottom', sources.wallBottom);
  }
  if (sources.underside) terrain.setFaceImage('underside', sources.underside);
  if (sources.wallTop) terrain.setFaceImage('wallTop', sources.wallTop);
  if (sources.wallLeft) terrain.setFaceImage('wallLeft', sources.wallLeft);
  if (sources.wallRight) terrain.setFaceImage('wallRight', sources.wallRight);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = image.onabort = () => {
      URL.revokeObjectURL(url);
      reject(new Error('MODEL_BAKE_FAILED'));
    };
    image.src = url;
  });
}

async function decodeRgba(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const img = await loadImage(blob);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    return { data: imgData.data, width: w, height: h };
  } catch {
    return null;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(b => resolve(b), 'image/png');
  });
}
