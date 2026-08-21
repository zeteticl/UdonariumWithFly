import {
  applyPlacementViewState,
  capturePlacementViewState,
  viewStatesEqual,
} from './table-placement-view-state';
import { CardState } from './card';
import { TerrainViewState } from './terrain';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import {
  makeCard,
  makeCharacter,
  makeDice,
  makeMask,
  makeTable,
  makeTerrain,
  makeTextNote,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('table-placement-view-state', () => {
  beforeEach(() => {
    resetTabletopStore();
    GameCharacter.allowLegacyBodyOnTable = true;
  });
  afterEach(() => resetTabletopStore());

  it('captures and reapplies rotate/roll/fx/width-related footprint', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('vs_char');
    ch.rotate = 12;
    ch.roll = 8;
    ch.isInverse = true;
    ch.tokenFrame = 'polaroid';

    const snap = capturePlacementViewState(ch);
    expect(snap.rotate).toBe(12);
    expect(snap.roll).toBe(8);
    expect(snap.isInverse).toBeTrue();
    expect(snap.tokenFrame).toBe('polaroid');
    expect(snap.size).toBe(1);
    expect('statusesJson' in snap).toBeFalse();
    expect(snap.visionRange).toBeDefined();
    expect(snap.brightLight).toBeDefined();
    expect(snap.dimLight).toBeDefined();

    ch.rotate = 0;
    ch.roll = 0;
    ch.isInverse = false;
    ch.tokenFrame = 'none';
    applyPlacementViewState(ch, snap);

    expect(ch.rotate).toBe(12);
    expect(ch.roll).toBe(8);
    expect(ch.isInverse).toBeTrue();
    expect(ch.tokenFrame).toBe('polaroid');
    expect(viewStatesEqual(snap, capturePlacementViewState(ch))).toBeTrue();
  });

  it('applyPlacementViewState never broadcasts DataElement updates', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('vs_no_broadcast');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 1, posZ: 0, altitude: 0, size: 1 }, true);

    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    const sizeEl = ch.commonDataElement.getFirstElementByName('size')!;
    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();

    applyPlacementViewState(ch, { altitude: 5, size: 3, rotate: 45 });

    expect(ch.altitude).toBe(5);
    expect(ch.size).toBe(3);
    expect(ch.rotate).toBe(45);
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).not.toContain(altitudeEl.identifier);
    expect(updatedIds).not.toContain(sizeEl.identifier);
  });

  it('applyPlacementViewState skips unchanged SyncVars (no redundant update)', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('vs_skip_same');
    ch.rotate = 10;
    ch.isInverse = true;
    const snap = capturePlacementViewState(ch);
    const before = ch.version;
    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();

    applyPlacementViewState(ch, snap);

    expect(ch.rotate).toBe(10);
    expect(ch.isInverse).toBeTrue();
    expect(ch.version).toBe(before);
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).not.toContain(ch.identifier);
  });

  it('captures card / dice / terrain / mask / note desktop SyncVars', () => {
    makeTable('tableA');
    viewTables('tableA');

    const card = makeCard('vs_card');
    card.state = CardState.BACK;
    card.rotate = 90;
    const cardSnap = capturePlacementViewState(card);
    expect(cardSnap.cardState).toBe(CardState.BACK);
    expect(cardSnap.rotate).toBe(90);
    card.state = CardState.FRONT;
    applyPlacementViewState(card, cardSnap);
    expect(card.state as CardState).toBe(CardState.BACK);

    const dice = makeDice('vs_dice');
    dice.face = '3';
    dice.isLock = true;
    const diceSnap = capturePlacementViewState(dice);
    expect(diceSnap.diceFace).toBe('3');
    expect(diceSnap.isLock).toBeTrue();

    const terrain = makeTerrain('vs_terrain');
    terrain.mode = TerrainViewState.FLOOR;
    terrain.isSlope = true;
    terrain.slopeDirection = 1;
    const terrainSnap = capturePlacementViewState(terrain);
    expect(terrainSnap.terrainMode).toBe(TerrainViewState.FLOOR);
    expect(terrainSnap.isSlope).toBeTrue();
    expect(terrainSnap.slopeDirection).toBe(1);

    const mask = makeMask('vs_mask');
    mask.blendType = 2;
    mask.textPosition = 'bottom-right';
    const maskSnap = capturePlacementViewState(mask);
    expect(maskSnap.blendType).toBe(2);
    expect(maskSnap.textPosition).toBe('bottom-right');

    const note = makeTextNote('vs_note');
    note.paperStyle = 'sticky';
    note.isFlipped = true;
    const noteSnap = capturePlacementViewState(note);
    expect(noteSnap.paperStyle).toBe('sticky');
    expect(noteSnap.isFlipped).toBeTrue();
  });
});
