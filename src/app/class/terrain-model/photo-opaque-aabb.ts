import { MeshAabb, emptyAabb, expandAabb } from './mesh-ir';

/** Snap a world point onto the photographed AABB face (along the camera axis). */
export function snapWorldPointToAabbFace(
  p: [number, number, number],
  eye: [number, number, number],
  aabb: MeshAabb,
): [number, number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  if (eye[1] > 0.5) return [x, aabb.max[1], z];
  if (eye[1] < -0.5) return [x, aabb.min[1], z];
  if (eye[2] > 0.5) return [x, y, aabb.max[2]];
  if (eye[2] < -0.5) return [x, y, aabb.min[2]];
  if (eye[0] > 0.5) return [aabb.max[0], y, z];
  if (eye[0] < -0.5) return [aabb.min[0], y, z];
  return [x, y, z];
}

/**
 * Grow `visual` from opaque GL pixels (bottom-left origin, RGBA).
 * `unprojectNdc` maps NDC x/y (y up) to a world point on the view ray.
 */
export function expandVisualAabbFromGlPixels(
  visual: MeshAabb,
  photoAabb: MeshAabb,
  eye: [number, number, number],
  pixels: Uint8Array,
  width: number,
  height: number,
  unprojectNdc: (ndcX: number, ndcY: number) => [number, number, number],
  alphaMin = 12,
): void {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const a = pixels[(y * width + x) * 4 + 3];
      if (a < alphaMin) continue;
      const ndcX = ((x + 0.5) / width) * 2 - 1;
      const ndcY = ((y + 0.5) / height) * 2 - 1;
      const snapped = snapWorldPointToAabbFace(unprojectNdc(ndcX, ndcY), eye, photoAabb);
      expandAabb(visual, snapped[0], snapped[1], snapped[2]);
    }
  }
}

export function isAabbFinite(aabb: MeshAabb): boolean {
  return Number.isFinite(aabb.min[0]) && Number.isFinite(aabb.max[0]);
}

/** Intersect two AABBs; empty if they miss. */
export function intersectAabb(a: MeshAabb, b: MeshAabb): MeshAabb {
  const min: [number, number, number] = [
    Math.max(a.min[0], b.min[0]),
    Math.max(a.min[1], b.min[1]),
    Math.max(a.min[2], b.min[2]),
  ];
  const max: [number, number, number] = [
    Math.min(a.max[0], b.max[0]),
    Math.min(a.max[1], b.max[1]),
    Math.min(a.max[2], b.max[2]),
  ];
  return { min, max };
}

export function inflateAabb(aabb: MeshAabb, fraction: number): MeshAabb {
  const sx = Math.max(1e-6, aabb.max[0] - aabb.min[0]);
  const sy = Math.max(1e-6, aabb.max[1] - aabb.min[1]);
  const sz = Math.max(1e-6, aabb.max[2] - aabb.min[2]);
  const f = Math.max(0, fraction);
  return {
    min: [aabb.min[0] - sx * f, aabb.min[1] - sy * f, aabb.min[2] - sz * f],
    max: [aabb.max[0] + sx * f, aabb.max[1] + sy * f, aabb.max[2] + sz * f],
  };
}

export { emptyAabb };
