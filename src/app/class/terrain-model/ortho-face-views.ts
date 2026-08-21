import { TerrainFaceName } from '@udonarium/terrain';

import { MeshAabb, MODEL_BAKE_SIZE_MAX } from './mesh-ir';

export type FaceView = {
  face: TerrainFaceName;
  eye: [number, number, number];
  up: [number, number, number];
};

/** Internal Y-up orthographic views → Terrain face slots. */
export const FACE_VIEWS: FaceView[] = [
  { face: 'floor', eye: [0, 1, 0], up: [0, 0, -1] },
  { face: 'underside', eye: [0, -1, 0], up: [0, 0, 1] },
  { face: 'wallBottom', eye: [0, 0, -1], up: [0, 1, 0] },
  { face: 'wallTop', eye: [0, 0, 1], up: [0, 1, 0] },
  { face: 'wallLeft', eye: [-1, 0, 0], up: [0, 1, 0] },
  { face: 'wallRight', eye: [1, 0, 0], up: [0, 1, 0] },
];

/** World extents of the photo for this eye direction (not a cube). */
export function faceOrthoSize(
  aabb: MeshAabb,
  eye: [number, number, number],
): { width: number; height: number } {
  const sx = Math.max(1e-6, aabb.max[0] - aabb.min[0]);
  const sy = Math.max(1e-6, aabb.max[1] - aabb.min[1]);
  const sz = Math.max(1e-6, aabb.max[2] - aabb.min[2]);
  const ax = Math.abs(eye[0]);
  const ay = Math.abs(eye[1]);
  const az = Math.abs(eye[2]);
  if (ay >= ax && ay >= az) return { width: sx, height: sz };
  if (ax >= ay && ax >= az) return { width: sz, height: sy };
  return { width: sx, height: sy };
}

export function aabbCenter(aabb: MeshAabb): [number, number, number] {
  return [
    (aabb.min[0] + aabb.max[0]) * 0.5,
    (aabb.min[1] + aabb.max[1]) * 0.5,
    (aabb.min[2] + aabb.max[2]) * 0.5,
  ];
}

export function aabbMaxExtent(aabb: MeshAabb): number {
  return Math.max(
    aabb.max[0] - aabb.min[0],
    aabb.max[1] - aabb.min[1],
    aabb.max[2] - aabb.min[2],
    1e-3,
  );
}

/** Longest canvas side scales with face size vs refLongEdge (uniform world texels). */
export function canvasSizeForFace(
  faceWidth: number,
  faceHeight: number,
  maxSize: number,
  refLongEdge?: number,
): { width: number; height: number } {
  const dim = Math.max(64, Math.min(MODEL_BAKE_SIZE_MAX, maxSize | 0));
  const fw = Math.max(1e-6, faceWidth);
  const fh = Math.max(1e-6, faceHeight);
  const faceLong = Math.max(fw, fh);
  const ref = Math.max(faceLong, refLongEdge || faceLong);
  const longPx = Math.max(32, Math.round(dim * (faceLong / ref)));
  if (fw >= fh) {
    return { width: longPx, height: Math.max(1, Math.round(longPx * (fh / fw))) };
  }
  return { width: Math.max(1, Math.round(longPx * (fw / fh))), height: longPx };
}
