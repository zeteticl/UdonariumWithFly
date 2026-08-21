import {
  BAKE_CROP_PAD_MAX_PX,
  BAKE_CROP_PAD_MIN_PX,
  clampInsets,
  cropRectForFace,
  faceCropBackgroundStyle,
  insetsFromOpaqueRgba,
  padPxForLongEdge,
} from './bake-crop';

describe('padPxForLongEdge', () => {
  it('uses 0.8% of the long edge, clamped 1–16 px', () => {
    expect(padPxForLongEdge(1000)).toBe(8);
    expect(padPxForLongEdge(50)).toBe(BAKE_CROP_PAD_MIN_PX);
    expect(padPxForLongEdge(10_000)).toBe(BAKE_CROP_PAD_MAX_PX);
  });
});

describe('insetsFromOpaqueRgba', () => {
  it('pads the opaque solid core and converts to W/E/S/N fractions', () => {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y <= 89; y++) {
      for (let x = 10; x <= 89; x++) {
        const i = (y * w + x) * 4;
        data[i + 3] = 255;
      }
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    // 100px long edge → 1px pad (0.8% rounds to 1, min 1)
    expect(insets.west).toBeCloseTo(0.09, 5);
    expect(insets.east).toBeCloseTo(0.09, 5);
    expect(insets.north).toBeCloseTo(0.09, 5);
    expect(insets.south).toBeCloseTo(0.09, 5);
  });

  it('ignores thin sign protrusions and crops to the main solid mass', () => {
    // 200×100 wall: brick 40..159 full height, plus a 3px-tall "sign" at x=5..8.
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 40; x <= 159; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let y = 48; y <= 50; y++) {
      for (let x = 5; x <= 8; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    // Must crop past the sign (x≤8), not stop at opaque-bbox west=5.
    expect(insets.west).toBeGreaterThan(0.15);
    expect(insets.east).toBeGreaterThan(0.15);
    const left = Math.round(insets.west * w);
    const right = w - 1 - Math.round(insets.east * w);
    expect(left).toBeGreaterThan(8);
    expect(left).toBeLessThanOrEqual(41);
    expect(right).toBeGreaterThanOrEqual(158);
    expect(right).toBeLessThan(w - 8);
  });

  it('crops floor transparent margins even when a side strip is opaque', () => {
    // Roof mass 20..179 × 20..79; thin full-height sign strip at x=2..3.
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 20; y <= 79; y++) {
      for (let x = 20; x <= 179; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 2; x <= 3; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    expect(insets.west).toBeGreaterThan(0.08);
    expect(insets.north).toBeGreaterThan(0.12);
    expect(insets.south).toBeGreaterThan(0.12);
    const left = Math.round(insets.west * w);
    expect(left).toBeGreaterThan(3);
  });

  it('crops soft ~25%-fill fringe columns on wall sides (NYC west/east case)', () => {
    // Dense brick 0..196, then 3 fringe cols at ~25% fill (transparent margin look).
    const w = 201;
    const h = 406;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x <= 196; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let x = 197; x < w; x++) {
      for (let y = 0; y < Math.floor(h * 0.25); y++) data[(y * w + x) * 4 + 3] = 255;
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    expect(insets.east).toBeGreaterThan(0.01);
    const right = w - 1 - Math.round(insets.east * w);
    expect(right).toBeLessThanOrEqual(197);
  });

  it('crops sparse leading fringe on the opposite wall edge', () => {
    const w = 201;
    const h = 406;
    const data = new Uint8ClampedArray(w * h * 4);
    // ~22% fill fringe on the left (barely used to pass the old 0.22 peak thr).
    for (let x = 0; x <= 2; x++) {
      for (let y = 0; y < Math.floor(h * 0.22); y++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let y = 0; y < h; y++) {
      for (let x = 3; x < w; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    expect(insets.west).toBeGreaterThan(0.005);
    const left = Math.round(insets.west * w);
    expect(left).toBeGreaterThan(2);
  });

  it('keeps full height on a half-width side wall (does not use full-canvas row peak)', () => {
    // 77×406: brick only in x=0..36 full height; one full-width ledge at y=320..330.
    const w = 77;
    const h = 406;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x <= 36; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let y = 320; y <= 330; y++) {
      for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    expect(insets.north).toBeLessThan(0.05);
    expect(insets.south).toBeLessThan(0.05);
    expect(insets.east).toBeGreaterThan(0.4);
  });

  it('does not collapse a floor roof to a few columns', () => {
    // Roof 5..149 × 0..47 dense; sparse bottom strip 5..177 × 48..74 (8px wide crumbs).
    const w = 181;
    const h = 77;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y <= 47; y++) {
      for (let x = 5; x <= 149; x++) data[(y * w + x) * 4 + 3] = 255;
    }
    for (let y = 48; y <= 74; y++) {
      for (let x = 5; x <= 177; x++) {
        if (x % 20 === 0) data[(y * w + x) * 4 + 3] = 255;
      }
    }
    const insets = insetsFromOpaqueRgba(data, w, h);
    expect(insets.west).toBeLessThan(0.1);
    expect(insets.east).toBeLessThan(0.25);
    expect(insets.south).toBeGreaterThan(0.25);
    const keptW = 1 - insets.west - insets.east;
    expect(keptW).toBeGreaterThan(0.7);
  });

  it('trims dark fringe and narrow bright quoin strip on wall qualityEdges', () => {
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    // Main brick x=10..179, mid luma ~300
    for (let y = 0; y < h; y++) {
      for (let x = 10; x <= 179; x++) {
        const i = (y * w + x) * 4;
        data[i] = 100; data[i + 1] = 100; data[i + 2] = 100; data[i + 3] = 255;
      }
    }
    // Dark soft west fringe x=5..9
    for (let y = 0; y < h; y++) {
      for (let x = 5; x <= 9; x++) {
        const i = (y * w + x) * 4;
        data[i] = 20; data[i + 1] = 20; data[i + 2] = 20; data[i + 3] = 255;
      }
    }
    // Bright quoin strip x=180..189
    for (let y = 0; y < h; y++) {
      for (let x = 180; x <= 189; x++) {
        const i = (y * w + x) * 4;
        data[i] = 200; data[i + 1] = 200; data[i + 2] = 200; data[i + 3] = 255;
      }
    }
    const plain = insetsFromOpaqueRgba(data, w, h);
    const quality = insetsFromOpaqueRgba(data, w, h, 12, { qualityEdges: true });
    expect(quality.west).toBeGreaterThan(plain.west);
    expect(quality.east).toBeGreaterThan(plain.east);
    expect(quality.east).toBeGreaterThan(0.04);
    const left = Math.round(quality.west * w);
    const right = w - 1 - Math.round(quality.east * w);
    expect(left).toBeGreaterThanOrEqual(10);
    expect(right).toBeLessThanOrEqual(179);
  });

  it('trims dark floor-west fringe when qualityEdges is on', () => {
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    // Bright roof x=20..199
    for (let y = 10; y <= 89; y++) {
      for (let x = 20; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] = 140; data[i + 1] = 140; data[i + 2] = 140; data[i + 3] = 255;
      }
    }
    // Near-black west strip x=5..19 (opaque but hollow look)
    for (let y = 10; y <= 89; y++) {
      for (let x = 5; x <= 19; x++) {
        const i = (y * w + x) * 4;
        data[i] = 10; data[i + 1] = 10; data[i + 2] = 10; data[i + 3] = 255;
      }
    }
    const plain = insetsFromOpaqueRgba(data, w, h);
    const quality = insetsFromOpaqueRgba(data, w, h, 12, { qualityEdges: true });
    expect(quality.west).toBeGreaterThan(plain.west);
    expect(quality.west).toBeGreaterThan(0.08);
    expect(Math.round(quality.west * w)).toBeGreaterThanOrEqual(20);
  });

  it('keeps a shorter west wing under unified quality fill (0.70)', () => {
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y <= 89; y++) {
      for (let x = 0; x < w; x++) {
        if (x < 80 && y > 70) continue; // ~76% col fill — above 0.70, below old 0.98
        const i = (y * w + x) * 4;
        data[i] = 140; data[i + 1] = 140; data[i + 2] = 140; data[i + 3] = 255;
      }
    }
    const quality = insetsFromOpaqueRgba(data, w, h, 12, { qualityEdges: true });
    expect(quality.west).toBeLessThan(0.05);
  });

  it('crops south rows that are only ~50% filled (NYC floor notches)', () => {
    const w = 200;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 10; y <= 89; y++) {
      for (let x = 0; x < w; x++) {
        // South half-width fingers: row fill 0.5 — density edge thr keeps them,
        // quality fill min 0.70 trims.
        if (y > 74 && x >= 100) continue;
        const i = (y * w + x) * 4;
        data[i] = 140; data[i + 1] = 140; data[i + 2] = 140; data[i + 3] = 255;
      }
    }
    const plain = insetsFromOpaqueRgba(data, w, h);
    const quality = insetsFromOpaqueRgba(data, w, h, 12, { qualityEdges: true });
    expect(quality.south).toBeGreaterThan(plain.south);
    expect(quality.south).toBeGreaterThan(0.12);
  });
});

describe('cropRectForFace', () => {
  const insets = { west: 0.1, east: 0.2, north: 0.05, south: 0.15 };

  it('crops floor with west/east/north/south as image edges', () => {
    expect(cropRectForFace('floor', 100, 80, insets)).toEqual({ x: 10, y: 4, w: 70, h: 64 });
  });

  it('crops the top of a south wall with north (image top)', () => {
    expect(cropRectForFace('wallBottom', 100, 50, insets)).toEqual({ x: 10, y: 3, w: 70, h: 40 });
  });
});

describe('clampInsets', () => {
  it('allows nearly full crop on one axis (up to ~100%)', () => {
    const c = clampInsets({ west: 0.6, east: 0.6, north: 0, south: 0 });
    expect(c.west + c.east).toBeCloseTo(0.999, 5);
  });

  it('allows a single edge near 100%', () => {
    const c = clampInsets({ west: 1, east: 0, north: 0, south: 0 });
    expect(c.west).toBeCloseTo(0.999, 5);
    expect(c.east).toBe(0);
  });
});

describe('faceCropBackgroundStyle', () => {
  it('zooms the remaining region to fill the CSS face', () => {
    const css = faceCropBackgroundStyle({ west: 0, east: 0, north: 0.2, south: 0 });
    expect(css['background-size']).toContain('125');
    expect(css['background-position']).toBe('50% 100%');
  });
});
