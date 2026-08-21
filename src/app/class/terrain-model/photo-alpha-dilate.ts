/** Morphological dilate: copy nearest opaque RGB into transparent pixels (CSS seam only). */
export function dilateAlphaInPlace(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
  const r = Math.max(0, radius | 0);
  if (!r) return;
  const copy = new Uint8ClampedArray(data);
  for (let pass = 0; pass < r; pass++) {
    copy.set(data);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (copy[i + 3] >= 12) continue;
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = (ny * width + nx) * 4;
            if (copy[ni + 3] < 12) continue;
            data[i] = copy[ni];
            data[i + 1] = copy[ni + 1];
            data[i + 2] = copy[ni + 2];
            data[i + 3] = copy[ni + 3];
            found = true;
            break;
          }
        }
      }
    }
  }
}
