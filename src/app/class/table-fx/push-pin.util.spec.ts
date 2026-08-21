import {
  PAPER_STYLES,
  PIN_BOX,
  framePinOriginOffset,
  notePinAnchorPx,
  pinAnchorPx,
  randomPinOffset,
  stringBeamStyle3d,
  stringPathD,
  tokenCenterAnchorPx,
  tokenVisualHeightPx,
} from './push-pin.util';

describe('push-pin.util', () => {
  it('keeps note paper styles to none / a4 / sticky (extra styles deferred)', () => {
    expect(PAPER_STYLES).toEqual(['none', 'a4', 'sticky']);
  });

  it('pinAnchorPx uses default tip when offsets are default', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: PIN_BOX.left,
      pushPinTop: PIN_BOX.top,
      location: { x: 100, y: 200 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    const tipX = PIN_BOX.left + PIN_BOX.width * PIN_BOX.tipX;
    const tipY = PIN_BOX.top + PIN_BOX.height * PIN_BOX.tipY;
    expect(p.x).toBeCloseTo(100 + tipX, 5);
    expect(p.y).toBeCloseTo(200 + tipY, 5);
  });

  it('pinAnchorPx includes token frame padding-edge offset', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: PIN_BOX.left,
      pushPinTop: PIN_BOX.top,
      tokenFrame: 'polaroid',
      location: { x: 100, y: 200 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    const frame = framePinOriginOffset('polaroid');
    const tipX = PIN_BOX.left + PIN_BOX.width * PIN_BOX.tipX + frame.x;
    const tipY = PIN_BOX.top + PIN_BOX.height * PIN_BOX.tipY + frame.y;
    expect(frame.x).toBe(-7);
    expect(frame.y).toBe(-7);
    expect(p.x).toBeCloseTo(100 + tipX, 5);
    expect(p.y).toBeCloseTo(200 + tipY, 5);
  });

  it('pinAnchorPx tilts tip around needle plant (50% / 88%)', () => {
    const angle = 20;
    const host = {
      pushPin: true,
      pushPinAngle: angle,
      pushPinLeft: -4,
      pushPinTop: -20,
      location: { x: 0, y: 0 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    const left = -4;
    const top = -20;
    const tipX = left + PIN_BOX.width * 0.5;
    const tipY = top + PIN_BOX.height * 0.5;
    const ox = left + PIN_BOX.width * 0.5;
    const oy = top + PIN_BOX.height * 0.88;
    const rad = (angle * Math.PI) / 180;
    const dx = tipX - ox;
    const dy = tipY - oy;
    expect(p.x).toBeCloseTo(ox + dx * Math.cos(rad) - dy * Math.sin(rad), 5);
    expect(p.y).toBeCloseTo(oy + dx * Math.sin(rad) + dy * Math.cos(rad), 5);
  });

  it('pinAnchorPx respects custom pushPinLeft/Top', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: 10,
      pushPinTop: -30,
      location: { x: 0, y: 0 },
      rotate: 0,
    };
    const p = pinAnchorPx(host, 50, 50);
    expect(p.x).toBeCloseTo(10 + PIN_BOX.width * PIN_BOX.tipX, 5);
    expect(p.y).toBeCloseTo(-30 + PIN_BOX.height * PIN_BOX.tipY, 5);
  });

  it('tokenCenterAnchorPx lifts Z and offsets XY by footprint * -0.02', () => {
    const host = {
      location: { x: 100, y: 200 },
      posZ: 10,
      altitude: 2,
      height: 3,
      size: 1,
      rotate: 0,
    };
    const grid = 50;
    const foot = 50;
    const tall = tokenVisualHeightPx(host, grid);
    expect(tall).toBe(150);
    const c = tokenCenterAnchorPx(host, foot, tall, grid);
    const back = foot * -0.02;
    expect(c.x).toBeCloseTo(125, 5);
    expect(c.y).toBeCloseTo(225 + back, 5);
    const lift = Math.max(grid * 0.16, tall * 0.08);
    expect(c.z).toBeCloseTo(10 + 100 + lift, 5);
    expect(c.z).toBeLessThan(10 + 100 + tall / 2);

    const turned = tokenCenterAnchorPx({ ...host, rotate: 90 }, foot, tall, grid);
    expect(turned.x).toBeCloseTo(125 - back, 5);
    expect(turned.y).toBeCloseTo(225, 5);
  });

  it('tokenVisualHeightPx falls back to size when height unset', () => {
    expect(tokenVisualHeightPx({ size: 2 }, 50)).toBe(100);
    expect(tokenVisualHeightPx({ height: 0, size: 2 }, 50)).toBe(100);
  });

  it('stringBeamStyle3d pitches when endpoint Z differs', () => {
    const flat = stringBeamStyle3d(0, 0, 10, 100, 0, 10);
    expect(flat.transform).toContain('rotateY(0deg)');
    const tilted = stringBeamStyle3d(0, 0, 10, 100, 0, 60);
    expect(tilted.transform).toMatch(/rotateY\(-/);
    expect(parseFloat(tilted.width)).toBeGreaterThan(100);
  });

  it('notePinAnchorPx uses bottom-center paper origin', () => {
    const host = {
      pushPin: true,
      pushPinAngle: 0,
      pushPinLeft: -4,
      pushPinTop: -20,
      location: { x: 500, y: 400 },
      rotate: 0,
    };
    const w = 200;
    const h = 150;
    const p = notePinAnchorPx(host, w, h);
    const tipX = -4 + PIN_BOX.width * PIN_BOX.tipX;
    const tipY = -20 + PIN_BOX.height * PIN_BOX.tipY;
    expect(p.x).toBeCloseTo(500 + (-w / 2 + tipX), 5);
    expect(p.y).toBeCloseTo(400 + (-h + tipY), 5);
  });

  it('stringPathD returns a quadratic path with sag', () => {
    const d = stringPathD(0, 0, 100, 0, 0.22);
    expect(d.startsWith('M 0 0 Q ')).toBeTrue();
    expect(d.endsWith(' 100 0')).toBeTrue();
  });

  it('randomPinOffset keeps top in the allowed band', () => {
    for (let i = 0; i < 40; i++) {
      const off = randomPinOffset(100);
      expect(off.top).toBeGreaterThanOrEqual(-28);
      expect(off.top).toBeLessThanOrEqual(-20);
      expect(off.left).toBeGreaterThanOrEqual(PIN_BOX.left);
    }
  });
});
