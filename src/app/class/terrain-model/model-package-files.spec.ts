import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';

import {
  attachPackagePath,
  expandModelDropFiles,
  packagePathOf,
  resolvePackageFile,
} from './model-package-files';

function fileAt(path: string, body = 'x'): File {
  const base = path.replace(/^.*[\\/]/, '') || 'file';
  return attachPackagePath(new File([body], base, { type: 'application/octet-stream' }), path);
}

async function zipFile(entries: { name: string; body: string }[]): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const entry of entries) {
    await writer.add(entry.name, new BlobReader(new Blob([entry.body])));
  }
  const blob = await writer.close();
  return new File([blob], 'model.zip', { type: 'application/zip' });
}

describe('resolvePackageFile', () => {
  it('resolves textures/ relative to the glTF folder', () => {
    const files = [
      fileAt('house/scene.gltf'),
      fileAt('house/textures/Color_001_baseColor.jpeg'),
    ];
    const found = resolvePackageFile(files, 'textures/Color_001_baseColor.jpeg', 'house');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Color_001_baseColor.jpeg');
  });

  it('resolves when the zip has an extra root folder', () => {
    const files = [
      fileAt('export/house/scene.gltf'),
      fileAt('export/house/textures/Wood_Bamboo_baseColor.jpeg'),
    ];
    const found = resolvePackageFile(
      files,
      'textures/Wood_Bamboo_baseColor.jpeg',
      'export/house',
    );
    expect(found).toBeTruthy();
  });

  it('falls back to basename when only loose files are dropped', () => {
    const files = [
      new File(['gltf'], 'scene.gltf'),
      new File(['tex'], 'Color_001_baseColor.jpeg'),
    ];
    const found = resolvePackageFile(files, 'textures/Color_001_baseColor.jpeg', '');
    expect(found).toBeTruthy();
    expect(found!.name).toBe('Color_001_baseColor.jpeg');
  });

  it('strips page-origin URLs produced by an empty loader path', () => {
    const files = [fileAt('textures/Brick_Common_Bond_baseColor.jpeg')];
    const found = resolvePackageFile(
      files,
      'http://127.0.0.1:4200/textures/Brick_Common_Bond_baseColor.jpeg',
      '',
    );
    expect(found).toBeTruthy();
  });
});

describe('expandModelDropFiles', () => {
  it('unpacks a zip that contains glTF plus textures', async () => {
    const zip = await zipFile([
      { name: 'house/scene.gltf', body: '{"asset":{"version":"2.0"}}' },
      { name: 'house/textures/Color_001_baseColor.jpeg', body: 'fake-jpeg' },
    ]);
    const files = await expandModelDropFiles([zip]);
    expect(files.some(f => f.name === 'scene.gltf')).toBeTrue();
    expect(files.some(f => f.name === 'Color_001_baseColor.jpeg')).toBeTrue();
    const tex = resolvePackageFile(files, 'textures/Color_001_baseColor.jpeg', 'house');
    expect(tex).toBeTruthy();
    expect(packagePathOf(tex!)).toBe('house/textures/color_001_basecolor.jpeg');
  });

  it('rejects a zip with no 3D model', async () => {
    const zip = await zipFile([
      { name: 'readme.txt', body: 'hello' },
      { name: 'photo.png', body: 'fake-png' },
    ]);
    await expectAsync(expandModelDropFiles([zip])).toBeRejectedWithError('MODEL_NO_MODEL_IN_ZIP');
  });

  it('unpacks a nested zip that contains FBX', async () => {
    const inner = await zipFile([
      { name: 'old brick building.fbx', body: 'fake-fbx' },
      { name: 'wall.png', body: 'fake-png' },
    ]);
    const innerBuf = new Uint8Array(await inner.arrayBuffer());
    const outerWriter = new ZipWriter(new BlobWriter('application/zip'));
    await outerWriter.add('source/old brick building.zip', new BlobReader(new Blob([innerBuf])));
    await outerWriter.add('textures/wall.png', new BlobReader(new Blob(['outer-tex'])));
    const outerBlob = await outerWriter.close();
    const outer = new File([outerBlob], 'old-brick.zip', { type: 'application/zip' });

    const files = await expandModelDropFiles([outer]);
    expect(files.some(f => /\.fbx$/i.test(f.name))).toBeTrue();
    expect(files.some(f => f.name === 'wall.png')).toBeTrue();
  });

  it('rejects a zip that only contains Blender .blend sources', async () => {
    const zip = await zipFile([
      { name: 'source/building.blend', body: 'BLENDER-v306' },
      { name: 'textures/Base_color.png', body: 'fake-png' },
    ]);
    await expectAsync(expandModelDropFiles([zip])).toBeRejectedWithError('MODEL_BLEND_ONLY');
  });

  it('rejects a bare .blend drop', async () => {
    const blend = new File(['BLENDER-v306'], 'building.blend', { type: 'application/octet-stream' });
    await expectAsync(expandModelDropFiles([blend])).toBeRejectedWithError('MODEL_BLEND_ONLY');
  });

  it('skips bare .blend when the batch also has a usable model', async () => {
    const blend = new File(['BLENDER-v306'], 'building.blend', { type: 'application/octet-stream' });
    const glb = new File([new Uint8Array([1, 2, 3])], 'building.glb', { type: 'model/gltf-binary' });
    const files = await expandModelDropFiles([blend, glb]);
    expect(files.map(f => f.name)).toEqual(['building.glb']);
  });

  it('skips bare .blend when the batch has non-model files for the chooser', async () => {
    const blend = new File(['BLENDER-v306'], 'building.blend', { type: 'application/octet-stream' });
    const png = new File([new Uint8Array([1])], 'map.png', { type: 'image/png' });
    const files = await expandModelDropFiles([blend, png]);
    expect(files.map(f => f.name)).toEqual(['map.png']);
  });

  it('recognizes FBX as a primary model in a zip', async () => {
    const zip = await zipFile([
      { name: 'source/Building.fbx', body: 'fake-fbx' },
      { name: 'textures/Base.png', body: 'fake-png' },
    ]);
    const files = await expandModelDropFiles([zip]);
    expect(files.some(f => /\.fbx$/i.test(f.name))).toBeTrue();
  });
});
