import { GameCharacter } from '@udonarium/game-character';
import { ImageEffectSource } from '@udonarium/table-fx/image-effect';
import { MaskTokenFxConfig } from '@udonarium/table-fx/mask-appearance';
import { TabletopObject } from '@udonarium/tabletop-object';

export type MaskTokenFxTarget = TabletopObject & ImageEffectSource & {
  altitude: number;
  mutateAppearance: (mutator: () => void) => void;
};

export interface MaskTokenFxSnapshot {
  isInverse: boolean;
  isHollow: boolean;
  isBlackPaint: boolean;
  isGrayscale: boolean;
  isSepia: boolean;
  isWhitePaint: boolean;
  isMatrix: boolean;
  isFlipVertical: boolean;
  isContrast: boolean;
  altitude: number;
  altitudeTouched: boolean;
}

const FX_KEYS: (keyof ImageEffectSource)[] = [
  'isInverse',
  'isHollow',
  'isBlackPaint',
  'isGrayscale',
  'isSepia',
  'isWhitePaint',
  'isMatrix',
  'isFlipVertical',
  'isContrast',
];

export function snapshotCharacterTokenFx(ch: MaskTokenFxTarget): MaskTokenFxSnapshot {
  return {
    isInverse: !!ch.isInverse,
    isHollow: !!ch.isHollow,
    isBlackPaint: !!ch.isBlackPaint,
    isGrayscale: !!ch.isGrayscale,
    isSepia: !!ch.isSepia,
    isWhitePaint: !!ch.isWhitePaint,
    isMatrix: !!ch.isMatrix,
    isFlipVertical: !!ch.isFlipVertical,
    isContrast: !!ch.isContrast,
    altitude: Number(ch.altitude) || 0,
    altitudeTouched: false,
  };
}

function setAltitudeValue(ch: MaskTokenFxTarget, altitude: number) {
  if (ch instanceof GameCharacter) {
    const el = ch.commonDataElement?.getFirstElementByName('altitude');
    if (el) el.value = altitude;
    return;
  }
  // CharacterToken (and similar): write SyncVar inside the caller's mutateAppearance.
  // Do not call the altitude setter — it would nest another mutateAppearance.
  if ('altitudeValue' in (ch as object)) {
    (ch as any).altitudeValue = Number(altitude) || 0;
    return;
  }
  (ch as any).altitude = Number(altitude) || 0;
}

/** Apply mask FX config to character/token; returns snapshot taken before apply. */
export function applyMaskTokenFxToCharacter(ch: MaskTokenFxTarget, cfg: MaskTokenFxConfig): MaskTokenFxSnapshot {
  const snap = snapshotCharacterTokenFx(ch);
  if (!ch || !cfg) return snap;
  const mode = cfg.altitudeMode || 'none';
  ch.mutateAppearance(() => {
    for (const key of FX_KEYS) {
      (ch as any)[key] = !!cfg[key];
    }
    if (mode === 'set') {
      setAltitudeValue(ch, Number(cfg.altitude) || 0);
      snap.altitudeTouched = true;
    } else if (mode === 'delta') {
      setAltitudeValue(ch, (Number(ch.altitude) || 0) + (Number(cfg.altitude) || 0));
      snap.altitudeTouched = true;
    }
  });
  return snap;
}

export function restoreMaskTokenFxSnapshot(ch: MaskTokenFxTarget, snap: MaskTokenFxSnapshot): void {
  if (!ch || !snap) return;
  ch.mutateAppearance(() => {
    ch.isInverse = snap.isInverse;
    ch.isHollow = snap.isHollow;
    ch.isBlackPaint = snap.isBlackPaint;
    ch.isGrayscale = snap.isGrayscale;
    ch.isSepia = snap.isSepia;
    ch.isWhitePaint = snap.isWhitePaint;
    ch.isMatrix = snap.isMatrix;
    ch.isFlipVertical = snap.isFlipVertical;
    ch.isContrast = snap.isContrast;
    if (snap.altitudeTouched) {
      setAltitudeValue(ch, snap.altitude);
    }
  });
}
