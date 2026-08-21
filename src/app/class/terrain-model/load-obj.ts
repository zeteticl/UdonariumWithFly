import {
  MeshIR,
  aabbFromPositions,
  assertTriangleBudget,
  computeSmoothNormals,
} from './mesh-ir';
import { dirOfPackagePath, packagePathOf, resolvePackageFile } from './model-package-files';

type Vec3 = [number, number, number];
type Vec2 = [number, number];

type ObjIndex = { v: number; vt: number; vn: number };

/**
 * Parse Wavefront OBJ (+ optional MTL / textures from the same file bag).
 * Files are matched by basename (case-insensitive).
 */
export async function parseObjPackage(files: File[]): Promise<MeshIR> {
  const objFile = files.find(f => /\.obj$/i.test(packagePathOf(f)) || /\.obj$/i.test(f.name));
  if (!objFile) throw new Error('MODEL_NO_OBJ');
  const baseDir = dirOfPackagePath(packagePathOf(objFile));

  const objText = await objFile.text();
  const warnings: string[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  const vs: Vec3[] = [];
  const vts: Vec2[] = [];
  const vns: Vec3[] = [];

  let mtlFileName = '';
  const lines = objText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    if (tag === 'v' && parts.length >= 4) {
      vs.push([+parts[1], +parts[2], +parts[3]]);
    } else if (tag === 'vt' && parts.length >= 3) {
      vts.push([+parts[1], +parts[2]]);
    } else if (tag === 'vn' && parts.length >= 4) {
      vns.push([+parts[1], +parts[2], +parts[3]]);
    } else if (tag === 'mtllib' && parts[1]) {
      mtlFileName = parts.slice(1).join(' ');
    } else if (tag === 'f' && parts.length >= 4) {
      const face = parts.slice(1).map(parseObjIndex);
      for (let i = 1; i + 1 < face.length; i++) {
        pushVertex(face[0]);
        pushVertex(face[i]);
        pushVertex(face[i + 1]);
      }
    }
  }

  function pushVertex(idx: ObjIndex) {
    const v = vs[idx.v];
    if (!v) throw new Error('MODEL_INVALID_OBJ');
    positions.push(v[0], v[1], v[2]);
    if (idx.vt >= 0 && vts[idx.vt]) {
      uvs.push(vts[idx.vt][0], vts[idx.vt][1]);
    } else {
      uvs.push(0, 0);
    }
    if (idx.vn >= 0 && vns[idx.vn]) {
      normals.push(vns[idx.vn][0], vns[idx.vn][1], vns[idx.vn][2]);
    } else {
      normals.push(0, 0, 0);
    }
    colors.push(0.75, 0.75, 0.75);
  }

  const triangleCount = positions.length / 9;
  assertTriangleBudget(triangleCount);

  let albedoImage: CanvasImageSource | undefined;
  let hadColor = false;
  let kd: Vec3 = [0.75, 0.75, 0.75];

  const mtlFile = mtlFileName
    ? resolvePackageFile(files, mtlFileName, baseDir)
    : files.find(f => /\.mtl$/i.test(packagePathOf(f)) || /\.mtl$/i.test(f.name));

  if (mtlFile) {
    const mtl = await mtlFile.text();
    const mat = parseMtl(mtl);
    kd = mat.kd;
    if (mat.mapKd) {
      const tex = resolvePackageFile(files, mat.mapKd, baseDir);
      if (tex) {
        albedoImage = await loadImageFromFile(tex);
        hadColor = true;
      } else {
        warnings.push('MODEL_MISSING_TEXTURE');
      }
    } else {
      hadColor = true; // solid Kd counts as color intent
    }
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = kd[0];
      colors[i + 1] = kd[1];
      colors[i + 2] = kd[2];
    }
  } else if (mtlFileName) {
    warnings.push('MODEL_MISSING_MTL');
  }

  const pos = Float32Array.from(positions);
  let nrm = Float32Array.from(normals);
  if (!hasNonZeroNormals(nrm)) nrm = computeSmoothNormals(pos);

  return {
    positions: pos,
    normals: nrm,
    uvs: Float32Array.from(uvs),
    vertexColors: Float32Array.from(colors),
    albedoImage,
    triangleCount,
    aabb: aabbFromPositions(pos),
    sourceFormat: 'obj',
    hadColor,
    warnings,
  };
}

function parseObjIndex(token: string): ObjIndex {
  const bits = token.split('/');
  const v = (+bits[0] || 0) - 1;
  const vt = bits.length > 1 && bits[1] !== '' ? (+bits[1] || 0) - 1 : -1;
  const vn = bits.length > 2 && bits[2] !== '' ? (+bits[2] || 0) - 1 : -1;
  return { v, vt, vn };
}

function parseMtl(text: string): { kd: Vec3; mapKd: string } {
  let kd: Vec3 = [0.75, 0.75, 0.75];
  let mapKd = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'Kd' && parts.length >= 4) {
      kd = [+parts[1], +parts[2], +parts[3]];
    } else if (parts[0] === 'map_Kd' && parts[1]) {
      // Skip options like -o / -s; take last path-like token.
      mapKd = parts[parts.length - 1];
    }
  }
  return { kd, mapKd };
}

function hasNonZeroNormals(n: Float32Array): boolean {
  for (let i = 0; i < n.length; i++) if (n[i] !== 0) return true;
  return false;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('MODEL_TEXTURE_LOAD_FAILED'));
    };
    img.src = url;
  });
}
