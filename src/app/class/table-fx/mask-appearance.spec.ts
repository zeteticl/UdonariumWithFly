import {
  emptyMaskTokenFxConfig,
  parseMaskTokenFxConfig,
  stringifyMaskTokenFxConfig,
  tokenFxConfigHasWork,
} from './mask-appearance';

describe('tokenFxConfigHasWork', () => {
  it('is false for empty / null configs', () => {
    expect(tokenFxConfigHasWork(null as any)).toBeFalse();
    expect(tokenFxConfigHasWork(emptyMaskTokenFxConfig())).toBeFalse();
    expect(tokenFxConfigHasWork({ altitudeMode: 'none' })).toBeFalse();
  });

  it('is true when any FX flag is set', () => {
    expect(tokenFxConfigHasWork({ isInverse: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isGrayscale: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isMatrix: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isHollow: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isBlackPaint: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isSepia: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isWhitePaint: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isFlipVertical: true })).toBeTrue();
    expect(tokenFxConfigHasWork({ isContrast: true })).toBeTrue();
  });

  it('is true when altitudeMode is set or delta', () => {
    expect(tokenFxConfigHasWork({ altitudeMode: 'set', altitude: 2 })).toBeTrue();
    expect(tokenFxConfigHasWork({ altitudeMode: 'delta', altitude: 1 })).toBeTrue();
  });
});

describe('mask token FX config parse / stringify', () => {
  it('parseMaskTokenFxConfig returns empty for blank / invalid JSON', () => {
    expect(parseMaskTokenFxConfig('')).toEqual(emptyMaskTokenFxConfig());
    expect(parseMaskTokenFxConfig('not-json')).toEqual(emptyMaskTokenFxConfig());
    expect(parseMaskTokenFxConfig('null')).toEqual(emptyMaskTokenFxConfig());
  });

  it('round-trips flags through stringify / parse', () => {
    const cfg = {
      isInverse: true,
      isGrayscale: true,
      altitudeMode: 'set' as const,
      altitude: 3,
    };
    const raw = stringifyMaskTokenFxConfig(cfg);
    const parsed = parseMaskTokenFxConfig(raw);
    expect(parsed.isInverse).toBeTrue();
    expect(parsed.isGrayscale).toBeTrue();
    expect(parsed.altitudeMode).toBe('set');
    expect(parsed.altitude).toBe(3);
    expect(tokenFxConfigHasWork(parsed)).toBeTrue();
  });
});
