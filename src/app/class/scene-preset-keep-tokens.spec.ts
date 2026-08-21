import { CharacterToken } from './character-token';
import { ScenePresetList } from './scene-preset-list';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('ScenePreset keep-tokens helpers', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('captureVisibleTokenPoses records visible CharacterTokens only', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const bodyVis = makeCharacter('vis');
    CharacterToken.ensureBodyOffTable(bodyVis);
    const visible = CharacterToken.create(bodyVis.identifier, { x: 11, y: 22, posZ: 0 }, { tableId: 'mapA' });

    const bodyHid = makeCharacter('hid');
    CharacterToken.ensureBodyOffTable(bodyHid);
    CharacterToken.create(bodyHid.identifier, { x: 1, y: 1, posZ: 0 }, { tableId: 'mapB' });

    const list = ScenePresetList.instance;
    const kept = (list as any).captureVisibleTokenPoses();

    expect(kept.length).toBe(1);
    expect(kept[0].obj.identifier).toBe(visible.identifier);
    expect(kept[0].x).toBe(11);
    expect(kept[0].y).toBe(22);
  });

  it('applyKeptTokenPoses stamps poses onto the target map without exclusive wipe', () => {
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');

    const body = makeCharacter('stamp');
    CharacterToken.ensureBodyOffTable(body);
    const tok = CharacterToken.create(body.identifier, { x: 5, y: 6, posZ: 0 }, { tableId: 'mapA' });

    const list = ScenePresetList.instance;
    (list as any).applyKeptTokenPoses('mapB', [
      { obj: tok, x: 90, y: 91, posZ: 2 },
    ]);

    expect(tok.hasPlacement('mapA')).toBeTrue();
    expect(tok.hasPlacement('mapB')).toBeTrue();
    expect(tok.getPoseForTable('mapB')).toEqual(jasmine.objectContaining({ x: 90, y: 91, posZ: 2 }));
  });

  it('removeExtraPiecesFromTable keeps captured tokens when skipTokens', () => {
    makeTable('mapA');
    viewTables('mapA');

    const bodyKeep = makeCharacter('keepMe');
    CharacterToken.ensureBodyOffTable(bodyKeep);
    const keep = CharacterToken.create(bodyKeep.identifier, { x: 1, y: 1, posZ: 0 }, { tableId: 'mapA' });

    const bodyDrop = makeCharacter('dropMe');
    CharacterToken.ensureBodyOffTable(bodyDrop);
    const drop = CharacterToken.create(bodyDrop.identifier, { x: 2, y: 2, posZ: 0 }, { tableId: 'mapA' });

    const list = ScenePresetList.instance;
    (list as any).removeExtraPiecesFromTable(
      'mapA',
      { version: 1, pieces: [], tableChildren: [] },
      { skipTokens: true },
      new Set([keep.identifier])
    );

    expect(keep.hasPlacement('mapA')).toBeTrue();
    // removeFromTable may keep tableIdentifier for per-map inventory binding;
    // the piece must leave the table surface.
    expect(drop.location.name).not.toBe('table');
    expect(drop.isVisibleOnTable).toBeFalse();
  });
});
