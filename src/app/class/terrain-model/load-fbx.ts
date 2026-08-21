import { dirOfPackagePath, packagePathOf, resolvePackageFile } from './model-package-files';

import type { LoadedGltf } from './load-gltf';

/** Load FBX with package-relative textures; caller must dispose(). */
export async function loadFbxScene(files: File[]): Promise<LoadedGltf> {
  const fbx = files.find(f => /\.fbx$/i.test(packagePathOf(f)) || /\.fbx$/i.test(f.name));
  if (!fbx) throw new Error('MODEL_NO_FBX');

  const THREE = await import('three');
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

  const manager = new THREE.LoadingManager();
  const blobUrls: string[] = [];
  const baseDir = dirOfPackagePath(packagePathOf(fbx));
  manager.setURLModifier((url) => {
    if (/^(blob:|data:)/i.test(url || '')) return url;
    const file = resolvePackageFile(files, url, baseDir);
    if (!file) return url;
    const u = URL.createObjectURL(file);
    blobUrls.push(u);
    return u;
  });

  const loader = new FBXLoader(manager);
  const buffer = await fbx.arrayBuffer();
  let scene: import('three').Group;
  try {
    scene = loader.parse(buffer, '');
  } catch (err) {
    for (const u of blobUrls) URL.revokeObjectURL(u);
    console.warn('FBXLoader.parse failed', err);
    throw new Error('MODEL_INVALID_FBX');
  }
  scene.updateMatrixWorld(true);

  return {
    THREE,
    scene,
    dispose: () => {
      scene.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose?.();
        const mats = obj.material
          ? (Array.isArray(obj.material) ? obj.material : [obj.material])
          : [];
        for (const m of mats) {
          m.map?.dispose?.();
          m.dispose?.();
        }
      });
      for (const u of blobUrls) URL.revokeObjectURL(u);
    },
  };
}
