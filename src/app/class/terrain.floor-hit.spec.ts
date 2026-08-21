import { SlopeDirection, Terrain } from './terrain';
import {
  makeTable,
  makeTerrain,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';
import { MovableSelectionSynchronizer } from '../directive/movable-selection-synchronizer';

describe('Terrain.floorHitAt (compat ride surface)', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('TOP slope Z matches legacy floorModCss mid-pivot ramp', () => {
    makeTable('t1');
    viewTables('t1');
    const terrain = makeTerrain('bridge_top');
    terrain.location.name = 'table';
    terrain.location.x = 0;
    terrain.location.y = 0;
    terrain.width = 2;
    terrain.depth = 4;
    terrain.height = 2;
    terrain.altitude = 1;
    terrain.isSlope = true;
    terrain.slopeDirection = SlopeDirection.TOP;
    terrain.mode = 1; // FLOOR

    const g = 50;
    expect(terrain.floorHitAt(50, 0, g)!.posZ).toBeCloseTo(50, 5);
    expect(terrain.floorHitAt(50, 4 * g, g)!.posZ).toBeCloseTo(150, 5);
    expect(terrain.floorHitAt(50, 2 * g, g)!.posZ).toBeCloseTo(100, 5);
    expect(terrain.floorHitAt(50, 2 * g, g)!.alignCss).toContain('rotateX');
    expect(terrain.floorModCss).toContain('rotateX');
  });

  it('flat floor returns posZ without tip CSS', () => {
    makeTable('t2');
    viewTables('t2');
    const terrain = makeTerrain('roof');
    terrain.location.name = 'table';
    terrain.location.x = 0;
    terrain.location.y = 0;
    terrain.width = 2;
    terrain.depth = 2;
    terrain.height = 1;
    terrain.altitude = 3;
    terrain.mode = 1;

    const hit = terrain.floorHitAt(50, 50, 50)!;
    expect(hit.posZ).toBeCloseTo(200, 5);
    expect(hit.alignCss).toBe('');
  });

  it('Terrain.floorHitAt prefers the taller stacked deck', () => {
    makeTable('t3');
    viewTables('t3');
    const low = makeTerrain('low');
    low.location.name = 'table';
    low.location.x = 0;
    low.location.y = 0;
    low.width = 2;
    low.depth = 2;
    low.height = 1;
    low.altitude = 0;
    low.mode = 1;

    const high = makeTerrain('high');
    high.location.name = 'table';
    high.location.x = 0;
    high.location.y = 0;
    high.width = 2;
    high.depth = 2;
    high.height = 1;
    high.altitude = 3;
    high.mode = 1;

    const hit = Terrain.floorHitAt([low, high], 50, 50, 50)!;
    expect(hit.posZ).toBeCloseTo(200, 5);
  });

  it('outside footprint returns null (leave prior pose)', () => {
    makeTable('t4');
    viewTables('t4');
    const terrain = makeTerrain('pad');
    terrain.location.name = 'table';
    terrain.location.x = 100;
    terrain.location.y = 100;
    terrain.width = 1;
    terrain.depth = 1;
    terrain.mode = 1;
    expect(terrain.floorHitAt(0, 0, 50)).toBeNull();
  });

  it('setSlopeDegrees rewrites height from incline', () => {
    const t = Terrain.create('bridge', 2, 4, 1, 'w', 'f');
    t.isSlope = true;
    t.slopeDirection = SlopeDirection.BOTTOM;
    t.setSlopeDegrees(20);
    expect(t.isSlope).toBeTrue();
    expect(t.slopeDegrees).toBeCloseTo(20, 4);
    expect(t.height).toBeCloseTo(Math.tan((20 * Math.PI) / 180) * 4, 5);
    t.setSlopeDegrees(0);
    expect(t.isSlope).toBeFalse();
  });
});

describe('MovableSelectionSynchronizer leave-floor policy', () => {
  it('clears only when still on last ride Z (protects character stacks)', () => {
    expect(MovableSelectionSynchronizer.shouldClearFloorRideOnLeave(100, 100)).toBeTrue();
    expect(MovableSelectionSynchronizer.shouldClearFloorRideOnLeave(100.02, 100)).toBeTrue();
    expect(MovableSelectionSynchronizer.shouldClearFloorRideOnLeave(150, 100)).toBeFalse();
    expect(MovableSelectionSynchronizer.shouldClearFloorRideOnLeave(100, undefined)).toBeFalse();
  });
});

describe('Terrain.mayAffectWorldPoint', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('rejects non-interact and far points', () => {
    makeTable('t5');
    viewTables('t5');
    const t = makeTerrain('deck');
    t.location.name = 'table';
    t.location.x = 0;
    t.location.y = 0;
    t.width = 2;
    t.depth = 2;
    t.mode = 1;
    expect(t.mayAffectWorldPoint(50, 50, 50)).toBeTrue();
    expect(t.mayAffectWorldPoint(500, 500, 50)).toBeFalse();
    t.isInteract = false;
    expect(t.mayAffectWorldPoint(50, 50, 50)).toBeFalse();
  });
});
