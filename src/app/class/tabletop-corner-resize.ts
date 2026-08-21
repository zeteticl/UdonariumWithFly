/**
 * Tabletop SE-corner resize helpers — same delta→scale model as terrain
 * (`cornerDragScaleFactors` RB + `scaleBakeGroupFrom` aspect unify).
 */

export function rotateTableDeltaToLocal(
  dx: number,
  dy: number,
  rotateDeg: number
): { localDx: number; localDy: number } {
  const rad = (-(rotateDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    localDx: dx * cos - dy * sin,
    localDy: dx * sin + dy * cos,
  };
}

export interface RbCornerResizeArgs {
  startW: number;
  startH: number;
  /** Pointer delta in object-local px (after rotate). */
  localDxPx: number;
  localDyPx: number;
  gridSize: number;
  /** When true, keep startW/startH aspect (terrain-style unify). */
  lockAspect: boolean;
  min?: number;
  max?: number;
}

/**
 * Compute new width/height for a right-bottom corner drag.
 * - Free: independent scales from (size + delta) / size
 * - Locked: one uniform scale from the dominant axis (avoids geo-mean
 *   shrinking when the other axis has noise / opposite sign)
 */
export function rbCornerResizeSize(args: RbCornerResizeArgs): { width: number; height: number } {
  const grid = Math.max(1, args.gridSize || 1);
  const w0 = Math.max(0.1, args.startW);
  const h0 = Math.max(0.1, args.startH);
  const min = args.min ?? 1;
  const max = args.max ?? 40;

  let scaleX = Math.max(0.05, (w0 * grid + args.localDxPx) / (w0 * grid));
  let scaleY = Math.max(0.05, (h0 * grid + args.localDyPx) / (h0 * grid));

  if (args.lockAspect) {
    // Dominant-axis uniform scale (SE corner): horizontal drag must enlarge/shrink,
    // not get pulled under 1 by a noisy opposite-axis delta.
    const scale = Math.abs(args.localDxPx) >= Math.abs(args.localDyPx) ? scaleX : scaleY;
    scaleX = scaleY = Math.max(0.05, scale);
  }

  let w = Math.min(max, Math.max(min, w0 * scaleX));
  let h = Math.min(max, Math.max(min, h0 * scaleY));
  w = Math.round(w * 2) / 2;
  h = Math.round(h * 2) / 2;
  w = Math.min(max, Math.max(min, w));
  h = Math.min(max, Math.max(min, h));

  if (args.lockAspect) {
    const aspect = w0 / h0;
    if (Math.abs(args.localDxPx) >= Math.abs(args.localDyPx)) {
      h = Math.min(max, Math.max(min, Math.round((w / aspect) * 2) / 2));
    } else {
      w = Math.min(max, Math.max(min, Math.round((h * aspect) * 2) / 2));
    }
  }

  return { width: w, height: h };
}
