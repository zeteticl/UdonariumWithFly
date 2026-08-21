import { rbCornerResizeSize, rotateTableDeltaToLocal } from './tabletop-corner-resize';

describe('tabletop-corner-resize', () => {
  it('RB drag right enlarges width (free aspect)', () => {
    const r = rbCornerResizeSize({
      startW: 4,
      startH: 5,
      localDxPx: 100,
      localDyPx: 0,
      gridSize: 50,
      lockAspect: false,
    });
    expect(r.width).toBeGreaterThan(4);
    expect(r.height).toBe(5);
  });

  it('RB drag left shrinks width (free aspect)', () => {
    const r = rbCornerResizeSize({
      startW: 4,
      startH: 5,
      localDxPx: -50,
      localDyPx: 0,
      gridSize: 50,
      lockAspect: false,
    });
    expect(r.width).toBeLessThan(4);
  });

  it('lockAspect: drag right enlarges both; drag left shrinks both', () => {
    const bigger = rbCornerResizeSize({
      startW: 10,
      startH: 14,
      localDxPx: 100,
      localDyPx: -40, // noisy opposite axis must not force shrink
      gridSize: 50,
      lockAspect: true,
    });
    expect(bigger.width).toBeGreaterThan(10);
    expect(bigger.height).toBeGreaterThan(14);

    const smaller = rbCornerResizeSize({
      startW: 10,
      startH: 14,
      localDxPx: -100,
      localDyPx: 40,
      gridSize: 50,
      lockAspect: true,
    });
    expect(smaller.width).toBeLessThan(10);
    expect(smaller.height).toBeLessThan(14);
  });

  it('lockAspect keeps start aspect ratio', () => {
    const r = rbCornerResizeSize({
      startW: 10,
      startH: 14,
      localDxPx: 150,
      localDyPx: 20,
      gridSize: 50,
      lockAspect: true,
    });
    expect(r.width / r.height).toBeCloseTo(10 / 14, 1);
  });

  it('rotateTableDeltaToLocal identity at 0°', () => {
    const r = rotateTableDeltaToLocal(30, -10, 0);
    expect(r.localDx).toBeCloseTo(30);
    expect(r.localDy).toBeCloseTo(-10);
  });
});
