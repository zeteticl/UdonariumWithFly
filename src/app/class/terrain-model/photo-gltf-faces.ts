import { MeshAabb, MODEL_BAKE_SIZE_MAX, MODEL_PHOTO_BAKE_SIZE } from './mesh-ir';
import { loadFbxScene } from './load-fbx';
import { loadGltfScene, LoadedGltf } from './load-gltf';
import { packagePathOf } from './model-package-files';
import { BakedFaceBlobs } from './ortho-bake';
import {
  FACE_VIEWS,
  aabbCenter,
  aabbMaxExtent,
  canvasSizeForFace,
  faceOrthoSize,
} from './ortho-face-views';
import { dilateAlphaInPlace } from './photo-alpha-dilate';
import { expandVisualAabbFromGlPixels } from './photo-opaque-aabb';
import { footprintBoxSummary, footprintDebug } from './footprint-debug';
import { splitFootprintFromPositions } from './footprint-split';
import { collectVisibleTrianglePositions, hidePhotoSkippedMeshes, robustSolidMeshAabb } from './scene-aabb';

export type PhotoGltfBox = {
  blobs: BakedFaceBlobs;
  aabb: MeshAabb;
};

export type PhotoGltfFacesResult = {
  blobs: BakedFaceBlobs;
  aabb: MeshAabb;
  boxes: PhotoGltfBox[];
  fullAabb: MeshAabb;
  warnings: string[];
};

const EDGE_DILATE_PX = 2;

/**
 * Photograph a glTF / FBX scene from six orthographic sides (real materials).
 * Transparent PNG: empty space stays empty (L courtyard, glass). Tightens the
 * box to opaque pixels so leftover helper padding does not become a hole.
 */
export async function photoGltfFaces(
  files: File[],
  maxSize: number = MODEL_PHOTO_BAKE_SIZE,
): Promise<PhotoGltfFacesResult> {
  const { THREE, scene, dispose } = await loadPhotoScene(files);
  let renderer: import('three').WebGLRenderer | undefined;
  try {
    await waitForMaps(scene);
    hidePhotoSkippedMeshes(scene);
    const meshAabb = robustSolidMeshAabb(THREE, scene);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      throw new Error('MODEL_NO_WEBGL');
    }
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const root = new THREE.Scene();
    root.add(scene);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.85);
    const fill = new THREE.AmbientLight(0xffffff, 0.25);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    root.add(hemi, fill, key);

    const bakeSize = Math.max(64, Math.min(MODEL_BAKE_SIZE_MAX, maxSize | 0));
    const positions = collectVisibleTrianglePositions(THREE, scene);
    // Split on the full mesh AABB (not a visual probe). Visual tightening
    // clamps verts and turns L/U courtyards into vertical strips (一字排).
    // Multiple boxes are required for L/U — a single AABB leaves a missing corner.
    const splitAabbs = splitFootprintFromPositions(positions, meshAabb);
    const fullAabb = meshAabb;
    const refLongEdge = aabbMaxExtent(fullAabb);
    const z0 = splitAabbs.map(b => b.min[2]);
    const zSpan = z0.length ? Math.max(...z0) - Math.min(...z0) : 0;
    const fullSz = Math.max(1e-9, fullAabb.max[2] - fullAabb.min[2]);
    footprintDebug('photoGltf split', {
      triFloats: positions.length,
      tris: (positions.length / 9) | 0,
      meshAabb: footprintBoxSummary(meshAabb),
      n: splitAabbs.length,
      zSpan: +zSpan.toFixed(3),
      isLine: zSpan < fullSz * 0.15,
      boxes: splitAabbs.map((b, i) => ({ i, ...footprintBoxSummary(b, fullAabb) })),
    });

    const boxes: PhotoGltfBox[] = [];
    for (const boxAabb of splitAabbs) {
      const blobs = await renderFaceSet(
        THREE,
        renderer,
        root,
        key,
        boxAabb,
        bakeSize,
        { collectVisual: null, emitBlobs: true, dilatePx: EDGE_DILATE_PX, refLongEdge },
      );
      boxes.push({ blobs, aabb: boxAabb });
    }
    if (!boxes.length) throw new Error('MODEL_BAKE_FAILED');

    return {
      blobs: boxes[0].blobs,
      aabb: boxes[0].aabb,
      boxes,
      fullAabb,
      warnings: [],
    };
  } finally {
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.width = 0;
      renderer.domElement.height = 0;
    }
    dispose();
  }
}

type RenderFaceOpts = {
  collectVisual: MeshAabb | null;
  emitBlobs: boolean;
  dilatePx: number;
  /** Full-model long edge so small boxes keep the same world texel density. */
  refLongEdge?: number;
};

async function renderFaceSet(
  THREE: typeof import('three'),
  renderer: import('three').WebGLRenderer,
  root: import('three').Scene,
  key: import('three').DirectionalLight,
  aabb: MeshAabb,
  maxSize: number,
  opts: RenderFaceOpts,
): Promise<BakedFaceBlobs> {
  const blobs: BakedFaceBlobs = {};
  const center = aabbCenter(aabb);
  const sx = Math.max(1e-6, aabb.max[0] - aabb.min[0]);
  const sy = Math.max(1e-6, aabb.max[1] - aabb.min[1]);
  const sz = Math.max(1e-6, aabb.max[2] - aabb.min[2]);
  const maxExtent = aabbMaxExtent(aabb);
  const camDist = maxExtent * 2;
  const tmp = new THREE.Vector3();

  for (const view of FACE_VIEWS) {
    const face = faceOrthoSize(aabb, view.eye);
    const { width, height } = canvasSizeForFace(
      face.width,
      face.height,
      maxSize,
      opts.refLongEdge,
    );
    renderer.setSize(width, height, false);

    const pad = 1.001;
    const hw = (face.width * pad) / 2;
    const hh = (face.height * pad) / 2;
    const halfAlongView =
      Math.abs(view.eye[0]) * sx * 0.5
      + Math.abs(view.eye[1]) * sy * 0.5
      + Math.abs(view.eye[2]) * sz * 0.5;
    const near = Math.max(0.01, camDist - halfAlongView - maxExtent * 0.02);
    const far = camDist + halfAlongView + maxExtent * 0.02;
    const camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, near, far);
    camera.up.set(view.up[0], view.up[1], view.up[2]);
    camera.position.set(
      center[0] + view.eye[0] * camDist,
      center[1] + view.eye[1] * camDist,
      center[2] + view.eye[2] * camDist,
    );
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    key.position.copy(camera.position);
    renderer.render(root, camera);

    if (opts.collectVisual) {
      const gl = renderer.getContext();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      expandVisualAabbFromGlPixels(
        opts.collectVisual,
        aabb,
        view.eye,
        pixels,
        width,
        height,
        (ndcX, ndcY) => {
          tmp.set(ndcX, ndcY, 0).unproject(camera);
          return [tmp.x, tmp.y, tmp.z];
        },
      );
    }

    if (opts.emitBlobs) {
      blobs[view.face] = opts.dilatePx
        ? await canvasToDilatedPng(renderer.domElement, opts.dilatePx)
        : await canvasToPng(renderer.domElement);
    }
  }
  return blobs;
}

async function waitForMaps(scene: import('three').Object3D): Promise<void> {
  const pending: Promise<void>[] = [];
  scene.traverse((obj: any) => {
    const mats = obj.material
      ? (Array.isArray(obj.material) ? obj.material : [obj.material])
      : [];
    for (const m of mats) {
      for (const key of ['map', 'normalMap', 'emissiveMap', 'aoMap', 'metalnessMap', 'roughnessMap']) {
        const img = m[key]?.image;
        if (img && typeof img === 'object' && 'complete' in img && !img.complete) {
          pending.push(new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve());
            img.addEventListener('error', () => resolve());
          }));
        }
      }
    }
  });
  if (pending.length) await Promise.all(pending);
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('MODEL_BAKE_FAILED'))),
      'image/png',
    );
  });
}

async function canvasToDilatedPng(src: HTMLCanvasElement, radius: number): Promise<Blob> {
  const c2 = document.createElement('canvas');
  c2.width = src.width;
  c2.height = src.height;
  const ctx = c2.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvasToPng(src);
  ctx.clearRect(0, 0, c2.width, c2.height);
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c2.width, c2.height);
  dilateAlphaInPlace(img.data, img.width, img.height, radius);
  ctx.putImageData(img, 0, 0);
  return canvasToPng(c2);
}

function isExt(file: File, re: RegExp): boolean {
  return re.test(packagePathOf(file)) || re.test(file.name || '');
}

async function loadPhotoScene(files: File[]): Promise<LoadedGltf> {
  if (files.some(f => isExt(f, /\.glb$/i) || isExt(f, /\.gltf$/i))) {
    return loadGltfScene(files);
  }
  if (files.some(f => isExt(f, /\.fbx$/i))) {
    return loadFbxScene(files);
  }
  throw new Error('MODEL_NO_GLTF');
}
