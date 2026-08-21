import { wallLeftCssTransform, wallLeftPreRotateCorners } from './terrain-wall-transform';

function aabb(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map(p => p.x)) + 0,
    maxX: Math.max(...points.map(p => p.x)) + 0,
    minY: Math.min(...points.map(p => p.y)) + 0,
    maxY: Math.max(...points.map(p => p.y)) + 0,
  };
}

describe('wallLeftPreRotateCorners', () => {
  const W = 200;
  const H = 100;

  it('keeps the west wall on the box edge whether or not legacy mirror is on', () => {
    const mirrored = aabb(wallLeftPreRotateCorners(true, W, H));
    const plain = aabb(wallLeftPreRotateCorners(false, W, H));
    expect(mirrored).toEqual({ minX: 0, maxX: W, minY: -H, maxY: 0 });
    expect(plain).toEqual({ minX: 0, maxX: W, minY: -H, maxY: 0 });
  });

  it('omits the flip-compensating translateX when mirror is off', () => {
    expect(wallLeftCssTransform(true)).toContain('scaleX(-1.0)');
    expect(wallLeftCssTransform(true)).toContain('translateX(-100%)');
    expect(wallLeftCssTransform(false)).not.toContain('scaleX');
    expect(wallLeftCssTransform(false)).not.toContain('translateX');
    expect(wallLeftCssTransform(false)).toContain('translateY(-100%)');
  });
});
