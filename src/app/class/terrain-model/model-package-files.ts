import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

import { MimeType } from '@udonarium/core/file-storage/mime-type';

import { MODEL_MAX_FILE_BYTES } from './mesh-ir';

/** Zip of glTF + textures is often larger than a single mesh file. */
export const MODEL_ZIP_MAX_BYTES = 256 * 1024 * 1024;

const PRIMARY_MODEL_RE = /\.(stl|obj|glb|gltf|fbx)$/i;
const PACKAGE_MEMBER_RE = /\.(stl|obj|mtl|glb|gltf|fbx|bin|png|jpe?g|webp|gif|bmp|zip)$/i;
/** Marketplace packs sometimes nest model.zip inside an outer zip. */
const NESTED_ZIP_MAX_DEPTH = 2;


type PathTaggedFile = File & { packagePath?: string };

/**
 * Preserve zip / folder relative path. `File.name` is basename-only in browsers.
 */
export function attachPackagePath(file: File, path: string): File {
  Object.defineProperty(file, 'packagePath', {
    value: normalizePackagePath(path),
    enumerable: false,
    configurable: true,
  });
  return file;
}

export function packagePathOf(file: File): string {
  const tagged = (file as PathTaggedFile).packagePath;
  if (tagged) return tagged;
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (rel) return normalizePackagePath(rel);
  return normalizePackagePath(file.name || '');
}

export function normalizePackagePath(path: string): string {
  return (path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

export function dirOfPackagePath(path: string): string {
  const n = normalizePackagePath(path);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

export function isZipFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return name.endsWith('.zip')
    || type === 'application/zip'
    || type === 'application/x-zip-compressed';
}

export function isPrimaryModelPath(path: string): boolean {
  return PRIMARY_MODEL_RE.test(path || '');
}

export function isPrimaryModelFile(file: File): boolean {
  return isPrimaryModelPath(packagePathOf(file)) || isPrimaryModelPath(file.name || '');
}

/** Unpack model zips (nested packs allowed up to NESTED_ZIP_MAX_DEPTH). Non-zip files pass through. */
export async function expandModelDropFiles(files: File[], depth = 0): Promise<File[]> {
  const out: File[] = [];
  let zipWithoutModel = false;
  let sawBlendOnly = false;

  for (const file of files || []) {
    // Skip bare .blend so mixed drops (glb + blend, png + blend) still proceed.
    if (isBlendFile(file)) {
      sawBlendOnly = true;
      continue;
    }

    if (!isZipFile(file) && !/\.zip$/i.test(packagePathOf(file))) {
      out.push(file);
      continue;
    }
    if (file.size > MODEL_ZIP_MAX_BYTES) throw new Error('MODEL_FILE_TOO_LARGE');

    let extracted: File[];
    let sawBlend = false;
    try {
      const unpacked = await unzipModelPackage(file);
      extracted = unpacked.files;
      sawBlend = unpacked.sawBlend;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('MODEL_')) throw err;
      throw new Error('MODEL_INVALID_ZIP');
    }

    if (depth < NESTED_ZIP_MAX_DEPTH) {
      extracted = await expandNestedZips(extracted, depth);
    } else {
      extracted = extracted.filter(f => !isNestedZipMember(f));
    }

    if (extracted.some(isPrimaryModelFile)) {
      out.push(...extracted);
    } else if (sawBlend) {
      sawBlendOnly = true;
    } else {
      zipWithoutModel = true;
    }
  }

  if (out.length > 0) return out;
  if (sawBlendOnly) throw new Error('MODEL_BLEND_ONLY');
  if (zipWithoutModel) throw new Error('MODEL_NO_MODEL_IN_ZIP');
  return out;
}

export function isBlendFile(file: File): boolean {
  return /\.blend$/i.test(packagePathOf(file)) || /\.blend$/i.test(file.name || '');
}

function isNestedZipMember(file: File): boolean {
  return isZipFile(file) || /\.zip$/i.test(packagePathOf(file));
}

/** Unpack zip members that are themselves zips; keep sibling textures. */
async function expandNestedZips(files: File[], depth: number): Promise<File[]> {
  const out: File[] = [];
  for (const file of files) {
    if (!isNestedZipMember(file)) {
      out.push(file);
      continue;
    }
    if (file.size > MODEL_ZIP_MAX_BYTES) continue;
    const nestDir = dirOfPackagePath(packagePathOf(file));
    let inner: File[];
    try {
      inner = await expandModelDropFiles([file], depth + 1);
    } catch {
      continue;
    }
    for (const f of inner) {
      const rel = packagePathOf(f);
      const prefixed = nestDir ? `${nestDir}/${rel}` : rel;
      out.push(attachPackagePath(f, prefixed));
    }
  }
  return out;
}

/**
 * Resolve a glTF/OBJ resource URI against dropped / unzipped files.
 * Matches zip folder layout (`scene.gltf` + `textures/foo.jpeg`) and basename fallback.
 */
export function resolvePackageFile(files: File[], url: string, baseDir = ''): File | undefined {
  const rel = stripResourceUrl(url);
  if (!rel || /^(blob:|data:)/i.test(rel)) return undefined;

  const normRel = normalizePackagePath(rel);
  const joined = joinPackagePath(baseDir, normRel);
  const base = basename(normRel);
  const indexed = (files || []).map(file => ({ file, path: packagePathOf(file) }));

  const exact = indexed.find(x => x.path === joined) || indexed.find(x => x.path === normRel);
  if (exact) return exact.file;

  const suffix = indexed.find(x =>
    (joined && x.path.endsWith('/' + joined))
    || x.path.endsWith('/' + normRel)
  );
  if (suffix) return suffix.file;

  const byBase = indexed.filter(x => x.path === base || x.path.endsWith('/' + base));
  if (!byBase.length) return undefined;
  if (baseDir) {
    const prefix = normalizePackagePath(baseDir) + '/';
    const under = byBase.find(x => x.path.startsWith(prefix));
    if (under) return under.file;
  }
  return byBase[0].file;
}

function joinPackagePath(baseDir: string, rel: string): string {
  const r = normalizePackagePath(rel);
  const d = normalizePackagePath(baseDir);
  if (!d) return r;
  if (!r) return d;
  if (r.startsWith(d + '/')) return r;
  return `${d}/${r}`;
}

function basename(path: string): string {
  const n = normalizePackagePath(path);
  const i = n.lastIndexOf('/');
  return i < 0 ? n : n.slice(i + 1);
}

function stripResourceUrl(url: string): string {
  const cut = (url || '').split('?')[0].split('#')[0];
  if (/^(blob:|data:)/i.test(cut)) return cut;
  if (/^https?:\/\//i.test(cut)) {
    try {
      return decodeURIComponent(new URL(cut).pathname).replace(/^\/+/, '');
    } catch {
      return cut;
    }
  }
  return cut.replace(/^\.\//, '');
}

function isModelPackageMember(path: string): boolean {
  return PACKAGE_MEMBER_RE.test(path);
}

function shouldSkipZipEntry(path: string): boolean {
  if (!path || path.endsWith('/')) return true;
  if (path.startsWith('__macosx/')) return true;
  if (/(^|\/)\./.test(path)) return true;
  return !isModelPackageMember(path);
}

async function unzipModelPackage(zipFile: File): Promise<{ files: File[]; sawBlend: boolean }> {
  const zipReader = new ZipReader(new BlobReader(zipFile));
  try {
    const entries = await zipReader.getEntries();
    const out: File[] = [];
    let sawBlend = false;
    for (const entry of entries || []) {
      if (entry.directory) continue;
      const rawPath = (entry.filename || '').replace(/\\/g, '/');
      const path = normalizePackagePath(rawPath);
      if (/\.blend$/i.test(path)) {
        // Blender sources cannot be baked in-browser; detect without extracting (~tens of MB).
        sawBlend = true;
        continue;
      }
      if (shouldSkipZipEntry(path)) continue;
      const listedSize = (entry as { uncompressedSize?: number }).uncompressedSize;
      if (listedSize && listedSize > MODEL_MAX_FILE_BYTES) continue;
      const blob = await entry.getData(new BlobWriter());
      if (blob.size > MODEL_MAX_FILE_BYTES) continue;
      const base = rawPath.replace(/^.*\//, '') || 'file';
      const file = new File([blob], base, { type: MimeType.type(base) });
      out.push(attachPackagePath(file, path));
    }
    return { files: out, sawBlend };
  } finally {
    await zipReader.close();
  }
}
