import { IMAGE_STORED_MAX_BYTES, normalizeImageBlob } from './image-normalize';

function pngWithAlpha(size: number, noisy = false): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  if (noisy) {
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (Math.random() * 256) | 0;
      img.data[i + 1] = (Math.random() * 256) | 0;
      img.data[i + 2] = (Math.random() * 256) | 0;
      img.data[i + 3] = (i % 17 === 0) ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    ctx.fillStyle = 'rgba(180, 40, 40, 1)';
    const inset = Math.floor(size * 0.2);
    ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png');
  });
}

describe('normalizeImageBlob alpha', () => {
  it('keeps a small transparent PNG as PNG', async () => {
    const blob = await pngWithAlpha(64);
    const out = await normalizeImageBlob(blob);
    expect(out.blob.type).toBe('image/png');
  });

  it('does not flatten an oversized transparent PNG to white JPEG', async () => {
    const blob = await pngWithAlpha(1600, true);
    if (blob.size <= IMAGE_STORED_MAX_BYTES) {
      pending('PNG compressed under the stored cap; skip flatten check');
      return;
    }
    const out = await normalizeImageBlob(blob);
    expect(out.blob.type).not.toBe('image/jpeg');
    expect(out.blob.size).toBeLessThanOrEqual(IMAGE_STORED_MAX_BYTES);
  });

  it('downscales sources larger than the old 8k decode guard', async () => {
    // 9000 > former DECODE_MAX_EDGE (8192); must shrink instead of throwing.
    const blob = await opaqueJpeg(9000, 100);
    const out = await normalizeImageBlob(blob);
    expect(out.didNormalize).toBeTrue();
    expect(out.blob.size).toBeLessThanOrEqual(IMAGE_STORED_MAX_BYTES);
    const img = await loadImage(out.blob);
    expect(Math.max(img.naturalWidth, img.naturalHeight)).toBeLessThanOrEqual(2048);
  });
});

function opaqueJpeg(w: number, h: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#336699';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ccddee';
  ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.92);
  });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    image.src = url;
  });
}
