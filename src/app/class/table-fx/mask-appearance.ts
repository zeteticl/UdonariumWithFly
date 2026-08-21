/** Appearance snapshot for mask A/B toggle (default ↔ alt). */
export interface MaskAppearanceSnap {
  opacityPercent: number;
  width: number;
  height: number;
  altitude: number;
  fontsize: number;
  color: string;
  imageIdentifier: string;
}

export interface MaskTokenFxConfig {
  isInverse?: boolean;
  isHollow?: boolean;
  isBlackPaint?: boolean;
  isGrayscale?: boolean;
  isSepia?: boolean;
  isWhitePaint?: boolean;
  isMatrix?: boolean;
  isFlipVertical?: boolean;
  isContrast?: boolean;
  /** none = leave altitude; set = absolute; delta = add to current */
  altitudeMode?: 'none' | 'set' | 'delta';
  altitude?: number;
}

export function emptyMaskAppearanceSnap(): MaskAppearanceSnap {
  return {
    opacityPercent: 100,
    width: 1,
    height: 1,
    altitude: 0,
    fontsize: 18,
    color: '#555555',
    imageIdentifier: '',
  };
}

export function parseMaskAppearanceSnap(json: string): MaskAppearanceSnap {
  const base = emptyMaskAppearanceSnap();
  if (!json) return base;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== 'object') return base;
    return {
      opacityPercent: num(o.opacityPercent, base.opacityPercent),
      width: num(o.width, base.width),
      height: num(o.height, base.height),
      altitude: num(o.altitude, base.altitude),
      fontsize: num(o.fontsize, base.fontsize),
      color: typeof o.color === 'string' ? o.color : base.color,
      imageIdentifier: typeof o.imageIdentifier === 'string' ? o.imageIdentifier : '',
    };
  } catch {
    return base;
  }
}

export function stringifyMaskAppearanceSnap(snap: MaskAppearanceSnap): string {
  return JSON.stringify(snap || emptyMaskAppearanceSnap());
}

export function emptyMaskTokenFxConfig(): MaskTokenFxConfig {
  return { altitudeMode: 'none', altitude: 0 };
}

export function parseMaskTokenFxConfig(json: string): MaskTokenFxConfig {
  const base = emptyMaskTokenFxConfig();
  if (!json) return base;
  try {
    const o = JSON.parse(json);
    if (!o || typeof o !== 'object') return base;
    const mode = o.altitudeMode;
    return {
      isInverse: !!o.isInverse,
      isHollow: !!o.isHollow,
      isBlackPaint: !!o.isBlackPaint,
      isGrayscale: !!o.isGrayscale,
      isSepia: !!o.isSepia,
      isWhitePaint: !!o.isWhitePaint,
      isMatrix: !!o.isMatrix,
      isFlipVertical: !!o.isFlipVertical,
      isContrast: !!o.isContrast,
      altitudeMode: mode === 'set' || mode === 'delta' || mode === 'none' ? mode : 'none',
      altitude: num(o.altitude, 0),
    };
  } catch {
    return base;
  }
}

export function stringifyMaskTokenFxConfig(cfg: MaskTokenFxConfig): string {
  return JSON.stringify(cfg || emptyMaskTokenFxConfig());
}

/** True when config would change image FX flags and/or altitude. */
export function tokenFxConfigHasWork(cfg: MaskTokenFxConfig): boolean {
  if (!cfg) return false;
  if (cfg.isInverse || cfg.isHollow || cfg.isBlackPaint || cfg.isGrayscale || cfg.isSepia
    || cfg.isWhitePaint || cfg.isMatrix || cfg.isFlipVertical || cfg.isContrast) {
    return true;
  }
  return (cfg.altitudeMode || 'none') !== 'none';
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
