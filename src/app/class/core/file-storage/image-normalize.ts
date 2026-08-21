const MEGA = 1024 * 1024;

/** Reject source uploads larger than this before decode. */
export const IMAGE_SOURCE_MAX_BYTES = 20 * MEGA;
/** Stored / synced image should stay at or under this after normalize. */
export const IMAGE_STORED_MAX_BYTES = 2 * MEGA;

/**
 * Hard reject only for absurd decode sizes (decompression bomb / broken SVG).
 * Typical map scans (e.g. 11100×8100) are allowed and downscaled via drawImage.
 */
const DECODE_ABSURD_EDGE = 32768;
const TARGET_MAX_EDGE = 2048;
const FALLBACK_MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const JPEG_QUALITY_FALLBACK = 0.75;

export type NormalizeImageResult = {
  blob: Blob;
  didNormalize: boolean;
};

/**
 * Downscale / re-encode an image for room storage.
 * - Longest edge ≤ 2048 (then ≤ 1600 if still over stored max)
 * - Oversized sources (beyond old 8k guard) are still accepted and scaled down
 * - PNG kept when alpha present; otherwise JPEG
 * - GIF: first frame only
 * - Never allocates a full-resolution canvas (drawImage scales into target)
 * Throws if the result cannot fit IMAGE_STORED_MAX_BYTES.
 */
export async function normalizeImageBlob(blob: Blob): Promise<NormalizeImageResult> {
  if (!blob || blob.size < 1) {
    throw new Error('Empty image blob');
  }

  const img = await loadImageFromBlob(blob);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < 1 || h < 1) {
    throw new Error('Invalid image dimensions');
  }
  if (Math.max(w, h) > DECODE_ABSURD_EDGE) {
    throw new Error(`Image dimensions too large (${w}×${h}; max edge ${DECODE_ABSURD_EDGE})`);
  }

  const needsResize = Math.max(w, h) > TARGET_MAX_EDGE;
  const overStored = blob.size > IMAGE_STORED_MAX_BYTES;
  const mime = (blob.type || '').toLowerCase();
  const isGif = mime === 'image/gif' || /\.gif$/i.test((blob as File).name || '');

  // Small enough already: keep original bytes (hash-stable for classic assets).
  if (!needsResize && !overStored && !isGif && (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp')) {
    return { blob, didNormalize: false };
  }

  // Prefer PNG only when pixels have alpha; opaque PNG/WebP may become JPEG to hit size cap.
  const hasAlpha = await sampleHasAlpha(img, mime);
  let out = await encodeToMaxEdge(img, w, h, TARGET_MAX_EDGE, hasAlpha, JPEG_QUALITY);

  if (out.size > IMAGE_STORED_MAX_BYTES) {
    out = await encodeToMaxEdge(img, w, h, FALLBACK_MAX_EDGE, hasAlpha, JPEG_QUALITY_FALLBACK);
  }

  if (out.size > IMAGE_STORED_MAX_BYTES && hasAlpha) {
    // Never flatten alpha to white JPEG (terrain bake holes became solid white slabs).
    for (const edge of [1024, 768, 512, 384, 256]) {
      out = await encodeToMaxEdge(img, w, h, edge, true, JPEG_QUALITY);
      if (out.size <= IMAGE_STORED_MAX_BYTES) break;
    }
  } else if (out.size > IMAGE_STORED_MAX_BYTES) {
    out = await encodeToMaxEdge(img, w, h, FALLBACK_MAX_EDGE, false, 0.65);
  }

  if (out.size > IMAGE_STORED_MAX_BYTES) {
    throw new Error(
      `Image still exceeds stored limit after normalize (${(out.size / MEGA).toFixed(2)}MB > ${IMAGE_STORED_MAX_BYTES / MEGA}MB)`,
    );
  }

  return { blob: out, didNormalize: true };
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = image.onabort = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    image.src = url;
  });
}

/** Sample a small downsample for non-opaque alpha. */
async function sampleHasAlpha(img: HTMLImageElement, mime: string): Promise<boolean> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
  ctx.drawImage(img, 0, 0, 64, 64);
  try {
    const data = ctx.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true;
    }
  } catch {
    // Tainted / blocked — assume alpha for formats that usually carry it.
    return mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
  }
  return false;
}

/** Scale into a target-sized canvas only (no full-res intermediate buffer). */
function encodeToMaxEdge(
  img: HTMLImageElement,
  srcW: number,
  srcH: number,
  maxEdge: number,
  keepAlpha: boolean,
  jpegQuality: number,
): Promise<Blob> {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas unavailable'));

  if (!keepAlpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dstW, dstH);
  }
  ctx.drawImage(img, 0, 0, dstW, dstH);

  const type = keepAlpha ? 'image/png' : 'image/jpeg';
  const quality = keepAlpha ? undefined : jpegQuality;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}
