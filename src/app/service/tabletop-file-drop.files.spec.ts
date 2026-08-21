import { filesFromDataTransfer, TabletopFileDropService } from './tabletop-file-drop.service';

function fakeTransfer(opts: {
  files?: File[];
  items?: Array<{ kind: string; type: string; file: File | null }>;
}): DataTransfer {
  const files = opts.files || [];
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] || null,
    ...files,
  };
  const items = (opts.items || []).map(item => ({
    kind: item.kind,
    type: item.type,
    getAsFile: () => item.file,
  }));
  return { files: fileList, items } as unknown as DataTransfer;
}

describe('filesFromDataTransfer', () => {
  it('returns empty for null', () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
  });

  it('reads file items (screenshot / Explorer copy)', () => {
    const png = new File([new Uint8Array([1, 2, 3])], 'snap.png', { type: 'image/png' });
    const dt = fakeTransfer({
      items: [{ kind: 'file', type: 'image/png', file: png }],
    });
    expect(filesFromDataTransfer(dt).map(f => f.name)).toEqual(['snap.png']);
  });

  it('falls back to files[] when items are empty', () => {
    const stl = new File([new Uint8Array([9])], 'mini.stl', { type: 'model/stl' });
    const dt = fakeTransfer({ files: [stl], items: [] });
    expect(filesFromDataTransfer(dt).map(f => f.name)).toEqual(['mini.stl']);
  });

  it('names an unnamed clipboard image', () => {
    const blob = new File([new Uint8Array([1])], '', { type: 'image/png' });
    const dt = fakeTransfer({
      items: [{ kind: 'file', type: 'image/png', file: blob }],
    });
    const files = filesFromDataTransfer(dt);
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('clipboard.png');
    expect(files[0].type).toBe('image/png');
  });

  it('ignores string items', () => {
    const dt = fakeTransfer({
      items: [{ kind: 'string', type: 'text/plain', file: null }],
    });
    expect(filesFromDataTransfer(dt)).toEqual([]);
  });
});

describe('TabletopFileDropService.looksAcceptable', () => {
  const svc = Object.create(TabletopFileDropService.prototype) as TabletopFileDropService;

  it('accepts images and models', () => {
    expect(svc.looksAcceptable([
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
    ])).toBeTrue();
    expect(svc.looksAcceptable([
      new File([new Uint8Array([1])], 'a.glb', { type: 'model/gltf-binary' }),
    ])).toBeTrue();
  });

  it('rejects blend-only batches so Ctrl+V can fall through', () => {
    expect(svc.looksAcceptable([
      new File(['BLENDER'], 'x.blend', { type: 'application/octet-stream' }),
    ])).toBeFalse();
  });

  it('accepts mixed blend + usable file', () => {
    expect(svc.looksAcceptable([
      new File(['BLENDER'], 'x.blend', { type: 'application/octet-stream' }),
      new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
    ])).toBeTrue();
  });
});
