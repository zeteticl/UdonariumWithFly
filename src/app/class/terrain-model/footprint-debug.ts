/**
 * Temporary diagnostics for multi-box model footprint import / placement.
 * Filter DevTools console by: FootprintDebug
 * Set FOOTPRINT_DEBUG = false to silence.
 */
export const FOOTPRINT_DEBUG = false;

export function footprintDebug(tag: string, data?: Record<string, unknown>) {
  if (!FOOTPRINT_DEBUG) return;
  if (data !== undefined) console.log(`[FootprintDebug] ${tag}`, data);
  else console.log(`[FootprintDebug] ${tag}`);
}

export function footprintBoxSummary(
  aabb: { min: number[]; max: number[] },
  full?: { min: number[]; max: number[] },
): Record<string, number> {
  const dx = aabb.max[0] - aabb.min[0];
  const dy = aabb.max[1] - aabb.min[1];
  const dz = aabb.max[2] - aabb.min[2];
  const out: Record<string, number> = {
    dx: +dx.toFixed(3),
    dy: +dy.toFixed(3),
    dz: +dz.toFixed(3),
    areaXZ: +(dx * dz).toFixed(2),
  };
  if (full) {
    const sx = Math.max(1e-9, full.max[0] - full.min[0]);
    const sz = Math.max(1e-9, full.max[2] - full.min[2]);
    out.u0 = +((aabb.min[0] - full.min[0]) / sx).toFixed(3);
    out.u1 = +((aabb.max[0] - full.min[0]) / sx).toFixed(3);
    out.v0 = +((aabb.min[2] - full.min[2]) / sz).toFixed(3);
    out.v1 = +((aabb.max[2] - full.min[2]) / sz).toFixed(3);
  }
  return out;
}
