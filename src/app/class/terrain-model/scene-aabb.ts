import { MeshAabb } from './mesh-ir';

const SKIP_NAME_TOKENS = new Set([
  'ctrl',
  'control',
  'helper',
  'gizmo',
  'collider',
  'collision',
  'hitbox',
  'shadowcatcher',
  'sphere',
  'icosphere',
  'probe',
  'lightprobe',
  'reflector',
]);

const ROBUST_KEEP = 0.97;
const MAX_AABB_SAMPLES = 80_000;

export function shouldSkipPhotoMeshName(name: string): boolean {
  const tokens = (name || '').split(/[^a-zA-Z0-9]+/);
  return tokens.some(t => SKIP_NAME_TOKENS.has(t.toLowerCase()));
}

export function isDegenerateExtent(sx: number, sy: number, sz: number): boolean {
  const maxe = Math.max(sx, sy, sz, 0);
  const mine = Math.min(sx, sy, sz);
  if (maxe < 1e-8) return true;
  return mine < Math.max(1e-6, maxe * 1e-4);
}

/** Small cubic glossy mesh sitting outside the main building (light probes). */
export function isLikelyProbeExtent(
  sx: number,
  sy: number,
  sz: number,
  triangleCount: number,
  sceneMax: number,
): boolean {
  const maxe = Math.max(sx, sy, sz, 0);
  const mine = Math.min(sx, sy, sz);
  if (maxe < 1e-8 || sceneMax < 1e-8) return false;
  const cubic = mine > 0 && maxe / mine < 1.4;
  const small = maxe < sceneMax * 0.22;
  const icosphere = triangleCount >= 16 && triangleCount <= 4000;
  return cubic && small && icosphere;
}

/** Shortest window containing `keepFraction` of values (drops far outliers). */
export function shortestInterval(values: number[], keepFraction: number): [number, number] {
  const n = values.length;
  if (n < 1) return [0, 0];
  const v = values.slice().sort((a, b) => a - b);
  if (n < 8) return [v[0], v[n - 1]];
  const k = Math.max(2, Math.floor(n * Math.min(1, Math.max(0.5, keepFraction))));
  let best = Infinity;
  let lo = v[0];
  let hi = v[n - 1];
  for (let i = 0; i + k - 1 < n; i++) {
    const span = v[i + k - 1] - v[i];
    if (span < best) {
      best = span;
      lo = v[i];
      hi = v[i + k - 1];
    }
  }
  return [lo, hi];
}

export function hidePhotoSkippedMeshes(scene: import('three').Object3D): void {
  scene.updateMatrixWorld(true);
  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (shouldSkipPhotoMeshName(obj.name || '')) obj.visible = false;
    const geomType = obj.geometry?.type || '';
    if (geomType === 'SphereGeometry' || geomType === 'IcosahedronGeometry') obj.visible = false;
  });

  const sceneMax = roughVisibleMaxExtent(scene);
  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.visible === false) return;
    const ext = localExtent(obj);
    if (!ext) return;
    const tris = triangleCountOf(obj);
    if (isLikelyProbeExtent(ext[0], ext[1], ext[2], tris, sceneMax) && isDarkGlossy(obj)) {
      obj.visible = false;
    }
  });
}

/**
 * World AABB of renderable meshes, ignoring animation-control helpers.
 * Falls back to the whole scene if nothing usable remains.
 */
export function solidMeshAabb(
  THREE: typeof import('three'),
  scene: import('three').Object3D,
): MeshAabb {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let found = false;

  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.visible === false) return;
    if (shouldSkipPhotoMeshName(obj.name || '')) return;
    const geom = obj.geometry;
    if (!geom) return;
    if (!geom.boundingBox) geom.computeBoundingBox?.();
    const bb = geom.boundingBox;
    if (!bb || bb.isEmpty()) return;
    tmp.copy(bb);
    const sx = tmp.max.x - tmp.min.x;
    const sy = tmp.max.y - tmp.min.y;
    const sz = tmp.max.z - tmp.min.z;
    if (isDegenerateExtent(sx, sy, sz)) return;
    tmp.applyMatrix4(obj.matrixWorld);
    if (!found) {
      box.copy(tmp);
      found = true;
    } else {
      box.union(tmp);
    }
  });

  if (!found || box.isEmpty()) {
    box.setFromObject(scene, true);
  }
  if (box.isEmpty()) throw new Error('MODEL_EMPTY');

  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/** Vertex-sampled AABB that ignores a few far probes / ground-corner verts. */
export function robustSolidMeshAabb(
  THREE: typeof import('three'),
  scene: import('three').Object3D,
): MeshAabb {
  scene.updateMatrixWorld(true);
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const v = new THREE.Vector3();

  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.visible === false) return;
    if (shouldSkipPhotoMeshName(obj.name || '')) return;
    const geom = obj.geometry;
    const pos = geom?.attributes?.position;
    if (!pos || pos.count < 3) return;
    const stride = Math.max(1, Math.ceil(pos.count / Math.max(1, Math.floor(MAX_AABB_SAMPLES / 4))));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      if (!Number.isFinite(v.x + v.y + v.z)) continue;
      xs.push(v.x);
      ys.push(v.y);
      zs.push(v.z);
    }
  });

  if (xs.length < 16) return solidMeshAabb(THREE, scene);
  const [xmin, xmax] = shortestInterval(xs, ROBUST_KEEP);
  const [ymin, ymax] = shortestInterval(ys, ROBUST_KEEP);
  const [zmin, zmax] = shortestInterval(zs, ROBUST_KEEP);
  if (xmax <= xmin || ymax <= ymin || zmax <= zmin) return solidMeshAabb(THREE, scene);
  return {
    min: [xmin, ymin, zmin],
    max: [xmax, ymax, zmax],
  };
}

function localExtent(obj: any): [number, number, number] | null {
  const geom = obj.geometry;
  if (!geom) return null;
  if (!geom.boundingBox) geom.computeBoundingBox?.();
  const bb = geom.boundingBox;
  if (!bb || bb.isEmpty()) return null;
  return [
    bb.max.x - bb.min.x,
    bb.max.y - bb.min.y,
    bb.max.z - bb.min.z,
  ];
}

function triangleCountOf(obj: any): number {
  const geom = obj.geometry;
  if (!geom) return 0;
  const index = geom.index;
  const pos = geom.attributes?.position;
  if (index) return Math.floor(index.count / 3);
  if (pos) return Math.floor(pos.count / 3);
  return 0;
}

function isDarkGlossy(obj: any): boolean {
  const mats = obj.material
    ? (Array.isArray(obj.material) ? obj.material : [obj.material])
    : [];
  if (!mats.length) return true;
  return mats.some((m: any) => {
    if (m.map) return false;
    const metal = m.metalness ?? 0;
    const rough = m.roughness ?? 1;
    const c = m.color;
    const lum = c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 1;
    return (metal > 0.45 && rough < 0.55) || lum < 0.08;
  });
}

/**
 * Interleaved xyz triangles of visible meshes (world space).
 * Used for 2.5D footprint occupancy. Caps triangle count with a stride.
 */
export function collectVisibleTrianglePositions(
  THREE: typeof import('three'),
  scene: import('three').Object3D,
  maxTriangles: number = 40_000,
): Float32Array {
  scene.updateMatrixWorld(true);
  const chunks: number[] = [];
  const v = new THREE.Vector3();
  const pushTri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    chunks.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.visible === false) return;
    if (shouldSkipPhotoMeshName(obj.name || '')) return;
    const geom = obj.geometry;
    const pos = geom?.attributes?.position;
    if (!pos || pos.count < 3) return;
    const idx = geom.index;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
    if (triCount < 1) return;
    const stride = Math.max(1, Math.ceil(triCount / maxTriangles));
    const world = obj.matrixWorld;
    const vertex = (i: number): [number, number, number] => {
      v.fromBufferAttribute(pos, i).applyMatrix4(world);
      return [v.x, v.y, v.z];
    };
    if (idx) {
      for (let t = 0; t < triCount; t += stride) {
        const a = vertex(idx.getX(t * 3));
        const b = vertex(idx.getX(t * 3 + 1));
        const c = vertex(idx.getX(t * 3 + 2));
        if (![...a, ...b, ...c].every(Number.isFinite)) continue;
        pushTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    } else {
      for (let t = 0; t < triCount; t += stride) {
        const a = vertex(t * 3);
        const b = vertex(t * 3 + 1);
        const c = vertex(t * 3 + 2);
        if (![...a, ...b, ...c].every(Number.isFinite)) continue;
        pushTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    }
  });

  return new Float32Array(chunks);
}

function roughVisibleMaxExtent(scene: import('three').Object3D): number {
  let maxe = 0;
  scene.traverse((obj: any) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    if (obj.visible === false) return;
    const ext = localExtent(obj);
    if (!ext) return;
    if (isDegenerateExtent(ext[0], ext[1], ext[2])) return;
    maxe = Math.max(maxe, ext[0], ext[1], ext[2]);
  });
  return maxe;
}
