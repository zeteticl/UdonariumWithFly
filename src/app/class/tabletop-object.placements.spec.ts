import { CardState } from './card';
import { Terrain, TerrainViewState } from './terrain';
import { TabletopObject } from './tabletop-object';
import { PLACEMENT_VIEW_STATE_KEYS } from './table-placement-view-state';
import { ObjectStore } from './core/synchronize-object/object-store';
import { DataElement } from './data-element';
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

describe('TabletopObject placements / migrate / repair', () => {
  beforeEach(() => {
    resetTabletopStore();
    // These specs exercise multi-map TabletopObject placement APIs via GameCharacter.
    GameCharacter.allowLegacyBodyOnTable = true;
  });
  afterEach(() => resetTabletopStore());

  it('migrateUnboundTablePieces does not rebind objects that already have placements', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_a');
    ch.location = { name: 'table', x: 10, y: 20 };
    ch.posZ = 0;
    ch.addToTable('tableA', { x: 10, y: 20, posZ: 0 }, true);

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();

    TabletopObject.migrateUnboundTablePieces('tableB');

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();
    expect(ch.getPoseForTable('tableA')).toEqual(jasmine.objectContaining({ x: 10, y: 20, posZ: 0 }));
  });

  it('migrateUnboundTablePieces binds truly unbound pieces to the given view', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_unbound');
    ch.location = { name: 'table', x: 5, y: 6 };
    ch.posZ = 1;
    ch.tableIdentifier = '';
    ch.tablePlacements = '';

    TabletopObject.migrateUnboundTablePieces('tableA');

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.tableIdentifier).toBe('tableA');
  });

  it('migrateUnboundTablePieces heals empty primary id from existing placements', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_heal');
    ch.location = { name: 'table', x: 1, y: 2 };
    ch.tablePlacements = JSON.stringify({ tableA: { x: 1, y: 2, posZ: 0 } });
    ch.tableIdentifier = '';

    TabletopObject.migrateUnboundTablePieces('tableA');

    expect(ch.tableIdentifier).toBe('tableA');
    expect(ch.hasPlacement('tableB' as string)).toBeFalse();
  });

  it('addToTable exclusive clears other map poses; non-exclusive keeps them', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_dual');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 100, y: 100, posZ: 0 }, true);
    ch.addToTable('tableB', { x: 200, y: 200, posZ: 0 }, false);

    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeTrue();

    ch.addToTable('tableA', { x: 111, y: 111, posZ: 0 }, true);
    expect(ch.hasPlacement('tableA')).toBeTrue();
    expect(ch.hasPlacement('tableB')).toBeFalse();
    expect(ch.getPoseForTable('tableA')).toEqual(jasmine.objectContaining({ x: 111, y: 111, posZ: 0 }));
  });

  it('repairOrphanedPieceBindings remaps 1:1 when orphan count equals table count', () => {
    makeTable('realTable0');
    makeTable('realTable1');
    viewTables('realTable0');
    expect(ObjectStore.instance.getObjects('game-table').length).toBe(2);

    const ch0 = makeCharacter('piece0');
    ch0.location = { name: 'table', x: 1, y: 1 };
    ch0.tableIdentifier = 'orphan0';
    ch0.tablePlacements = JSON.stringify({ orphan0: { x: 1, y: 1, posZ: 0 } });

    const ch1 = makeCharacter('piece1');
    ch1.location = { name: 'table', x: 2, y: 2 };
    ch1.tableIdentifier = 'orphan1';
    ch1.tablePlacements = JSON.stringify({ orphan1: { x: 2, y: 2, posZ: 0 } });

    const remap = TabletopObject.repairOrphanedPieceBindings();
    // Sorted orphan ids ↔ sorted table ids (stable across ObjectStore iteration order).
    expect(remap.size).toBe(2);
    expect(remap.get('orphan0')).toBe('realTable0');
    expect(remap.get('orphan1')).toBe('realTable1');
    expect(ch0.hasPlacement('realTable0')).toBeTrue();
    expect(ch1.hasPlacement('realTable1')).toBeTrue();
    expect(ch0.hasPlacement('orphan0')).toBeFalse();
    expect(ch1.hasPlacement('orphan1')).toBeFalse();
  });

  it('repairOrphanedPieceBindings collapses mismatched orphans onto view/first table', () => {
    makeTable('onlyTable');
    viewTables('onlyTable');

    const ch = makeCharacter('pieceX');
    ch.location = { name: 'table', x: 9, y: 9 };
    ch.tableIdentifier = 'goneUuid';
    ch.tablePlacements = JSON.stringify({ goneUuid: { x: 9, y: 9, posZ: 0 } });

    TabletopObject.repairOrphanedPieceBindings();
    expect(ch.hasPlacement('onlyTable')).toBeTrue();
    expect(ch.hasPlacement('goneUuid')).toBeFalse();
  });

  it('flushLivePosesToView writes live coords into placements for that view only', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_flush');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);
    ch.hydratePoseForView('tableA');
    ch.location.x = 77;
    ch.location.y = 88;

    TabletopObject.flushLivePosesToView('tableA');

    expect(ch.getPoseForTable('tableA')!.x).toBe(77);
    expect(ch.getPoseForTable('tableA')!.y).toBe(88);
    expect(ch.getPoseForTable('tableA')!.posZ).toBe(0);
    expect(ch.getPoseForTable('tableB')!.x).toBe(50);
    expect(ch.getPoseForTable('tableB')!.y).toBe(50);
  });

  it('keeps height/size/altitude independent per map placement', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_height');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    const heightEl = ch.commonDataElement.getFirstElementByName('height');
    expect(heightEl).toBeTruthy();

    // Product path: mutateAppearance backfills from pre-edit live, then writes current view.
    ch.mutateAppearance(() => { heightEl!.value = 5; });

    expect(ch.getPoseForTable('tableA')!.height).toBe(5);
    expect(ch.getPoseForTable('tableB')!.height).toBe(0);

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.height).toBe(0);
    expect(heightEl!.value).toBe(0);

    ch.mutateAppearance(() => { heightEl!.value = 2; });
    TabletopObject.flushLivePosesToView('tableB');
    viewTables('tableA');
    ch.hydratePoseForView('tableA');

    expect(ch.height).toBe(5);
    expect(ch.getPoseForTable('tableA')!.height).toBe(5);
    expect(ch.getPoseForTable('tableB')!.height).toBe(2);
  });

  it('keeps rotate/roll and image FX independent per map', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_pose');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    ch.mutateAppearance(() => {
      ch.rotate = 90;
      ch.roll = 30;
      ch.isInverse = true;
      ch.currntImageIndex = 0;
    });

    expect(ch.getPoseForTable('tableA')!.rotate).toBe(90);
    expect(ch.getPoseForTable('tableA')!.roll).toBe(30);
    expect(ch.getPoseForTable('tableA')!.isInverse).toBeTrue();
    expect(ch.getPoseForTable('tableB')!.rotate).toBe(0);
    expect(ch.getPoseForTable('tableB')!.roll).toBe(0);
    expect(ch.getPoseForTable('tableB')!.isInverse).toBeFalse();

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.rotate).toBe(0);
    expect(ch.roll).toBe(0);
    expect(ch.isInverse).toBeFalse();

    ch.mutateAppearance(() => { ch.rotate = 45; });
    TabletopObject.flushLivePosesToView('tableB');
    viewTables('tableA');
    ch.hydratePoseForView('tableA');

    expect(ch.rotate).toBe(90);
    expect(ch.roll).toBe(30);
    expect(ch.isInverse).toBeTrue();
    expect(ch.getPoseForTable('tableB')!.rotate).toBe(45);
  });

  it('hydrate resets SyncVar cosmetics when destination pose omits them', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_leak');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    // Simulate legacy B pose with coords only (no rotate / FX / light).
    const map = JSON.parse(ch.tablePlacements);
    map.tableB = { x: 50, y: 50, posZ: 0 };
    ch.tablePlacements = JSON.stringify(map);

    ch.mutateAppearance(() => {
      ch.rotate = 90;
      ch.isInverse = true;
      ch.visionRange = 12;
    });

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.rotate).toBe(0);
    expect(ch.isInverse).toBeFalse();
    expect(ch.visionRange).toBe(6);
  });

  it('keeps appearance independent on mutate-then-sync without prior backfill (drag path)', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_rotate_leak');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    // Legacy dual-map: coords only — mirrors RotableDirective (mutate SyncVar, then sync).
    const map = JSON.parse(ch.tablePlacements);
    map.tableA = { x: 10, y: 10, posZ: 0 };
    map.tableB = { x: 50, y: 50, posZ: 0 };
    ch.tablePlacements = JSON.stringify(map);

    ch.rotate = 90;
    ch.isInverse = true;
    ch.syncAppearanceToCurrentViewPlacement();

    expect(ch.getPoseForTable('tableB')!.rotate).toBe(90);
    expect(ch.getPoseForTable('tableB')!.isInverse).toBeTrue();
    // Other map must not inherit post-edit live SyncVars (defaults seed).
    expect(ch.getPoseForTable('tableA')!.rotate).toBe(0);
    expect(ch.getPoseForTable('tableA')!.isInverse).toBeFalse();

    TabletopObject.flushLivePosesToView('tableB');
    viewTables('tableA');
    ch.hydratePoseForView('tableA');
    expect(ch.rotate).toBe(0);
    expect(ch.isInverse).toBeFalse();
  });

  it('ensureAppearanceBackfilled does not copy post-edit live rotate onto sibling maps', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_ensure_leak');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    const map = JSON.parse(ch.tablePlacements);
    map.tableA = { x: 10, y: 10, posZ: 0 };
    map.tableB = { x: 50, y: 50, posZ: 0 };
    ch.tablePlacements = JSON.stringify(map);

    // Simulate mistaken ensure AFTER SyncVar was already rotated.
    ch.rotate = 90;
    ch.ensureAppearanceBackfilled();

    expect(ch.getPoseForTable('tableB')!.rotate).toBe(90);
    expect(ch.getPoseForTable('tableA')!.rotate).toBe(0);
  });

  it('writeDataElementValue routes footprint fields through mutateAppearance', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_write_de');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    TabletopObject.writeDataElementValue(altitudeEl, 4);

    expect(ch.altitude).toBe(4);
    expect(ch.getPoseForTable('tableA')!.altitude).toBe(4);
    expect(ch.getPoseForTable('tableB')!.altitude).toBe(0);

    ch.mutateAppearance(() => { ch.isAltitudeIndicate = false; });
    expect(ch.isAltitudeIndicate).toBeFalse();
    expect(ch.getPoseForTable('tableA')!.isAltitudeIndicate).toBeFalse();
  });

  it('resolveOwningTabletop finds token from altitude/height DataElement', () => {
    makeTable('tableA');
    const ch = makeCharacter('char_owner');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 2, posZ: 0 }, true);
    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude');
    const heightEl = ch.commonDataElement.getFirstElementByName('height');
    expect(altitudeEl).toBeTruthy();
    expect(heightEl).toBeTruthy();
    expect(TabletopObject.resolveOwningTabletop(altitudeEl!)).toBe(ch);
    expect(TabletopObject.resolveOwningTabletop(heightEl!)).toBe(ch);
    expect(TabletopObject.resolveOwningTabletop(ch.commonDataElement)).toBe(ch);
  });

  it('reproject after remote DataElement altitude/height overwrite keeps local map', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_remote_alt');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0, altitude: 3, height: 5 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0, altitude: 0, height: 0 }, false);
    ch.hydratePoseForView('tableB');
    expect(ch.altitude).toBe(0);
    expect(ch.height).toBe(0);

    // Peer on map A wrote shared DataElements (arrives as DataElement UPDATE, not Character).
    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    const heightEl = ch.commonDataElement.getFirstElementByName('height')!;
    altitudeEl.value = 3;
    heightEl.value = 5;
    expect(ch.altitude).toBe(3);
    expect(ch.height).toBe(5);

    const owner = TabletopObject.resolveOwningTabletop(altitudeEl);
    expect(owner).toBe(ch);
    TabletopObject.reprojectForLocalView(owner!);

    expect(ch.altitude).toBe(0);
    expect(ch.height).toBe(0);
    expect(ch.getPoseForTable('tableA')!.altitude).toBe(3);
    expect(ch.getPoseForTable('tableA')!.height).toBe(5);
    expect(ch.getPoseForTable('tableB')!.altitude).toBe(0);
    expect(ch.getPoseForTable('tableB')!.height).toBe(0);
  });

  it('reprojectForLocalView does not broadcast DataElement updates (no sync storm)', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_no_storm');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0, altitude: 3, size: 2 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0, altitude: 0, size: 1 }, false);
    ch.hydratePoseForView('tableB');

    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    const sizeEl = ch.commonDataElement.getFirstElementByName('size')!;
    altitudeEl.value = 3;
    sizeEl.value = 2;

    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();
    TabletopObject.reprojectForLocalView(ch);

    expect(ch.altitude).toBe(0);
    expect(ch.size).toBe(1);
    // apply must restore footprint locally without ObjectStore.update fan-out
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).not.toContain(altitudeEl.identifier);
    expect(updatedIds).not.toContain(sizeEl.identifier);
  });

  it('silent hydrateAllForView does not broadcast footprint DataElements', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_hydrate_silent');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0, altitude: 1, size: 1 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0, altitude: 4, size: 2 }, false);
    ch.hydratePoseForView('tableA');

    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    const sizeEl = ch.commonDataElement.getFirstElementByName('size')!;
    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();

    viewTables('tableB');
    TabletopObject.hydrateAllForView('tableB', true);

    expect(ch.altitude).toBe(4);
    expect(ch.size).toBe(2);
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).not.toContain(altitudeEl.identifier);
    expect(updatedIds).not.toContain(sizeEl.identifier);
  });

  it('resolveReprojectTarget ignores non-footprint DataElements (HP etc.)', () => {
    makeTable('tableA');
    const ch = makeCharacter('char_hp_filter');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 2, posZ: 0 }, true);

    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;
    const sizeEl = ch.commonDataElement.getFirstElementByName('size')!;
    expect(TabletopObject.resolveReprojectTarget(ch)).toBe(ch);
    expect(TabletopObject.resolveReprojectTarget(altitudeEl)).toBe(ch);
    expect(TabletopObject.resolveReprojectTarget(sizeEl)).toBe(ch);

    const hp = DataElement.create('HP', 10, { type: 'numberResource' }, 'fake_hp_reproject');
    ch.commonDataElement.appendChild(hp);
    expect(TabletopObject.resolveOwningTabletop(hp)).toBe(ch);
    expect(TabletopObject.resolveReprojectTarget(hp)).toBeNull();
  });

  it('writeDataElementValue still broadcasts intentional footprint edits', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('char_write_broadcast');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 1, posZ: 0, altitude: 0 }, true);
    const altitudeEl = ch.commonDataElement.getFirstElementByName('altitude')!;

    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();
    TabletopObject.writeDataElementValue(altitudeEl, 7);

    expect(ch.altitude).toBe(7);
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).toContain(altitudeEl.identifier);
  });

  it('reproject restores note/terrain footprint without DataElement broadcast', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const note = makeTextNote('note_storm');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 10, y: 10, posZ: 0, width: 3, height: 2 }, false);
    note.addToTable('tableB', { x: 40, y: 40, posZ: 0, width: 1, height: 1 }, false);
    note.hydratePoseForView('tableB');

    const widthEl = note.commonDataElement.getFirstElementByName('width')!;
    const heightEl = note.commonDataElement.getFirstElementByName('height')!;
    widthEl.value = 3;
    heightEl.value = 2;

    const terrain = makeTerrain('terrain_storm');
    terrain.location = { name: 'table', x: 0, y: 0 };
    terrain.addToTable('tableA', { x: 5, y: 5, posZ: 0, width: 4, height: 3, depth: 2 }, false);
    terrain.addToTable('tableB', { x: 20, y: 20, posZ: 0, width: 1, height: 1, depth: 1 }, false);
    terrain.hydratePoseForView('tableB');
    const tWidth = terrain.commonDataElement.getFirstElementByName('width')!;
    tWidth.value = 4;

    const updateSpy = spyOn(ObjectStore.instance, 'update').and.callThrough();
    TabletopObject.reprojectForLocalView(note);
    TabletopObject.reprojectForLocalView(terrain);

    expect(note.width).toBe(1);
    expect(note.height).toBe(1);
    expect(terrain.width).toBe(1);
    const updatedIds = updateSpy.calls.allArgs().map(args => {
      const arg = args[0];
      return typeof arg === 'string' ? arg : arg?.identifier;
    });
    expect(updatedIds).not.toContain(widthEl.identifier);
    expect(updatedIds).not.toContain(heightEl.identifier);
    expect(updatedIds).not.toContain(tWidth.identifier);
  });

  it('reprojectForLocalView restores local map rotate after remote SyncVar overwrite', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_remote_rot');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0, rotate: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0, rotate: 0 }, false);
    ch.hydratePoseForView('tableB');

    // Peer on map A rotated the token: SyncVar + placements[A] update arrive together.
    const map = JSON.parse(ch.tablePlacements);
    map.tableA.rotate = 90;
    ch.tablePlacements = JSON.stringify(map);
    ch.rotate = 90; // live SyncVar follows the remote editor

    TabletopObject.reprojectForLocalView(ch);

    expect(ch.rotate).toBe(0);
    expect(ch.location.x).toBe(50);
    expect(ch.getPoseForTable('tableA')!.rotate).toBe(90);
    expect(ch.getPoseForTable('tableB')!.rotate).toBe(0);
  });

  it('reprojectForLocalView restores placement SyncVars but keeps intentional globals', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const ch = makeCharacter('char_remote_suite');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', {
      x: 10, y: 10, posZ: 0,
      rotate: 90, roll: 15, isInverse: true, aura: 2,
      visionRange: 12, brightLight: 3, dimLight: 5,
      tokenFrame: 'polaroid', pushPin: true,
      size: 2, height: 4, altitude: 1,
    }, false);
    ch.addToTable('tableB', {
      x: 50, y: 50, posZ: 2,
      rotate: 0, roll: 0, isInverse: false, aura: -1,
      visionRange: 6, brightLight: 0, dimLight: 0,
      tokenFrame: 'none', pushPin: false,
      size: 1, height: 0, altitude: 0,
    }, false);
    ch.hydratePoseForView('tableB');
    ch.statusesJson = '[{"id":"ok"}]';
    ch.owner = 'localOwner';

    // Remote peer on A pushed live SyncVars + their placement edit + global status.
    const map = JSON.parse(ch.tablePlacements);
    map.tableA.rotate = 180;
    ch.tablePlacements = JSON.stringify(map);
    ch.location = { name: 'table', x: 10, y: 10 };
    ch.posZ = 0;
    ch.rotate = 180;
    ch.roll = 15;
    ch.isInverse = true;
    ch.aura = 2;
    ch.visionRange = 12;
    ch.brightLight = 3;
    ch.dimLight = 5;
    ch.tokenFrame = 'polaroid';
    ch.pushPin = true;
    // Raw SyncVar/DataElement writes (remote apply) — do not use altitude/size setters
    // (those call mutateAppearance and would contaminate the local view placement).
    ch.commonDataElement.getFirstElementByName('size')!.value = 2;
    ch.commonDataElement.getFirstElementByName('height')!.value = 4;
    ch.commonDataElement.getFirstElementByName('altitude')!.value = 1;
    ch.statusesJson = '[{"id":"fromA"}]';
    ch.owner = 'peerA';

    TabletopObject.reprojectForLocalView(ch);

    expect(ch.location.x).toBe(50);
    expect(ch.location.y).toBe(50);
    expect(ch.posZ).toBe(2);
    expect(ch.rotate).toBe(0);
    expect(ch.roll).toBe(0);
    expect(ch.isInverse).toBeFalse();
    expect(ch.aura).toBe(-1);
    expect(ch.visionRange).toBe(6);
    expect(ch.brightLight).toBe(0);
    expect(ch.dimLight).toBe(0);
    expect(ch.tokenFrame).toBe('none');
    expect(ch.pushPin).toBeFalse();
    expect(ch.size).toBe(1);
    expect(ch.height).toBe(0);
    expect(ch.altitude).toBe(0);
    // Intentional globals must follow the remote apply.
    expect(ch.statusesJson).toBe('[{"id":"fromA"}]');
    expect(ch.owner).toBe('peerA');
  });

  it('reprojectForLocalView is a no-op for single-map pieces', () => {
    makeTable('tableA');
    viewTables('tableA');
    const ch = makeCharacter('char_single');
    ch.location = { name: 'table', x: 1, y: 2 };
    ch.addToTable('tableA', { x: 1, y: 2, posZ: 0, rotate: 0 }, true);
    ch.hydratePoseForView('tableA');
    ch.rotate = 45;
    TabletopObject.reprojectForLocalView(ch);
    expect(ch.rotate).toBe(45);
  });

  it('reprojectForLocalView restores note / card / dice / terrain / mask desktop SyncVars', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableB');

    const note = makeTextNote('note_remote');
    note.location = { name: 'table', x: 0, y: 0 };
    note.addToTable('tableA', { x: 1, y: 1, posZ: 0, rotate: 90, isWhiteOut: true, paperStyle: 'a4' }, false);
    note.addToTable('tableB', { x: 9, y: 9, posZ: 0, rotate: 0, isWhiteOut: false, paperStyle: 'none' }, false);
    note.hydratePoseForView('tableB');
    note.rotate = 90;
    note.isWhiteOut = true;
    note.paperStyle = 'a4';
    TabletopObject.reprojectForLocalView(note);
    expect(note.rotate).toBe(0);
    expect(note.isWhiteOut).toBeFalse();
    expect(note.paperStyle).toBe('none');
    expect(note.location.x).toBe(9);

    const card = makeCard('card_remote');
    card.location = { name: 'table', x: 0, y: 0 };
    card.addToTable('tableA', { x: 2, y: 2, posZ: 0, rotate: 90, cardState: CardState.BACK }, false);
    card.addToTable('tableB', { x: 8, y: 8, posZ: 0, rotate: 0, cardState: CardState.FRONT }, false);
    card.hydratePoseForView('tableB');
    card.rotate = 90;
    card.state = CardState.BACK;
    TabletopObject.reprojectForLocalView(card);
    expect(card.rotate).toBe(0);
    expect(card.state as CardState).toBe(CardState.FRONT);

    const dice = makeDice('dice_remote');
    dice.location = { name: 'table', x: 0, y: 0 };
    dice.addToTable('tableA', { x: 3, y: 3, posZ: 0, rotate: 45, diceFace: '6', isLock: true }, false);
    dice.addToTable('tableB', { x: 7, y: 7, posZ: 0, rotate: 0, diceFace: '1', isLock: false }, false);
    dice.hydratePoseForView('tableB');
    dice.rotate = 45;
    dice.face = '6';
    dice.isLock = true;
    TabletopObject.reprojectForLocalView(dice);
    expect(dice.rotate).toBe(0);
    expect(dice.face).toBe('1');
    expect(dice.isLock).toBeFalse();

    const terrain = makeTerrain('terrain_remote');
    terrain.location = { name: 'table', x: 0, y: 0 };
    terrain.addToTable('tableA', {
      x: 4, y: 4, posZ: 0, rotate: 30, terrainMode: TerrainViewState.FLOOR, isSlope: true, slopeDirection: 2,
    }, false);
    terrain.addToTable('tableB', {
      x: 6, y: 6, posZ: 0, rotate: 0, terrainMode: TerrainViewState.ALL, isSlope: false, slopeDirection: 0,
    }, false);
    terrain.hydratePoseForView('tableB');
    terrain.rotate = 30;
    terrain.mode = TerrainViewState.FLOOR;
    terrain.isSlope = true;
    terrain.slopeDirection = 2;
    TabletopObject.reprojectForLocalView(terrain);
    expect(terrain.rotate).toBe(0);
    expect(terrain.mode as TerrainViewState).toBe(TerrainViewState.ALL);
    expect(terrain.isSlope).toBeFalse();
    expect(terrain.slopeDirection).toBe(0);

    const mask = makeMask('mask_remote');
    mask.location = { name: 'table', x: 0, y: 0 };
    mask.addToTable('tableA', { x: 5, y: 5, posZ: 0, blendType: 2, borderType: 0, textPosition: 'top-left', isLock: true }, false);
    mask.addToTable('tableB', { x: 1, y: 1, posZ: 0, blendType: 0, borderType: 1, textPosition: 'middle-center', isLock: false }, false);
    mask.hydratePoseForView('tableB');
    mask.blendType = 2;
    mask.borderType = 0;
    mask.textPosition = 'top-left';
    mask.isLock = true;
    TabletopObject.reprojectForLocalView(mask);
    expect(mask.blendType).toBe(0);
    expect(mask.borderType).toBe(1);
    expect(mask.textPosition).toBe('middle-center');
    expect(mask.isLock).toBeFalse();
  });

  it('placement view-state keys exclude intentional globals', () => {
    const keys = new Set<string>(PLACEMENT_VIEW_STATE_KEYS as readonly string[]);
    for (const globalKey of [
      'owner', 'playerOwner', 'visionOwner', 'statusesJson', 'name',
      'password', 'scope', 'contentMode', 'pdfIdentifier', 'videoIdentifier',
      'chatDialogText', 'isAllowsChat', 'isInventoryIndicate', 'isNotRide',
      'clickAction', 'appearanceDefaultJson', 'tokenFxJson', 'scratchingGrids',
    ]) {
      expect(keys.has(globalKey)).withContext(globalKey).toBeFalse();
    }
    for (const perMap of ['rotate', 'roll', 'cardState', 'diceFace', 'terrainMode', 'blendType', 'visionRange']) {
      expect(keys.has(perMap)).withContext(perMap).toBeTrue();
    }
  });

  it('setPoseForTable merge preserves appearance when only coords change', () => {
    makeTable('tableA');
    viewTables('tableA');

    const ch = makeCharacter('char_merge');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 1, y: 2, posZ: 0, height: 7, size: 2, rotate: 15 }, true);

    ch.setPoseForTable('tableA', { x: 9, y: 8, posZ: 1 }, false);

    const pose = ch.getPoseForTable('tableA')!;
    expect(pose.x).toBe(9);
    expect(pose.y).toBe(8);
    expect(pose.posZ).toBe(1);
    expect(pose.height).toBe(7);
    expect(pose.size).toBe(2);
    expect(pose.rotate).toBe(15);
  });

  it('FX mutateAppearance keeps other map independent after switch', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_fx');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    ch.mutateAppearance(() => {
      ch.isInverse = true;
      ch.aura = 2;
      ch.tokenFrame = 'polaroid';
    });

    expect(ch.getPoseForTable('tableA')!.isInverse).toBeTrue();
    expect(ch.getPoseForTable('tableA')!.aura).toBe(2);
    expect(ch.getPoseForTable('tableA')!.tokenFrame).toBe('polaroid');
    expect(ch.getPoseForTable('tableB')!.isInverse).toBeFalse();
    expect(ch.getPoseForTable('tableB')!.aura).toBe(-1);
    expect(ch.getPoseForTable('tableB')!.tokenFrame).toBe('none');

    TabletopObject.flushLivePosesToView('tableA');
    viewTables('tableB');
    ch.hydratePoseForView('tableB');
    expect(ch.isInverse).toBeFalse();
    expect(ch.aura).toBe(-1);
    expect(ch.tokenFrame).toBe('none');
  });

  it('hydrate does not seed previous-map live into destination placements', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const ch = makeCharacter('char_hydrate_live');
    ch.location = { name: 'table', x: 0, y: 0 };
    ch.addToTable('tableA', { x: 10, y: 10, posZ: 0 }, false);
    ch.addToTable('tableB', { x: 50, y: 50, posZ: 0 }, false);

    // Coords-only placements; live still shows map A cosmetics after a local edit.
    const map = JSON.parse(ch.tablePlacements);
    map.tableA = { x: 10, y: 10, posZ: 0, rotate: 0, isInverse: false };
    map.tableB = { x: 50, y: 50, posZ: 0 };
    ch.tablePlacements = JSON.stringify(map);

    ch.rotate = 120;
    ch.isInverse = true;
    // Switch without flushing the bad live into B via ensureAppearanceBackfilled.
    viewTables('tableB');
    ch.hydratePoseForView('tableB');

    expect(ch.rotate).toBe(0);
    expect(ch.isInverse).toBeFalse();
    expect(ch.getPoseForTable('tableB')!.rotate).toBeUndefined();
    expect(ch.getPoseForTable('tableA')!.rotate).toBe(0);
  });

  it('appendChild reorders an already-attached mask (bring-to-front)', () => {
    const table = makeTable('tableA');
    viewTables('tableA');
    const a = makeMask('mask_front_a');
    const b = makeMask('mask_front_b');
    table.appendChild(a);
    table.appendChild(b);
    expect(table.masks.map(m => m.identifier)).toEqual(['mask_front_a', 'mask_front_b']);

    table.appendChild(a);
    expect(table.masks.map(m => m.identifier)).toEqual(['mask_front_b', 'mask_front_a']);
  });

  it('moveToTopmost persists zindex into current-view placement only', () => {
    makeTable('tableA');
    makeTable('tableB');
    viewTables('tableA');

    const c1 = makeCard('card_layer_1');
    const c2 = makeCard('card_layer_2');
    c1.location = { name: 'table', x: 0, y: 0 };
    c2.location = { name: 'table', x: 10, y: 10 };
    c1.addToTable('tableA', { x: 0, y: 0, posZ: 0, zindex: 0 }, false);
    c1.addToTable('tableB', { x: 0, y: 0, posZ: 0, zindex: 5 }, false);
    c2.addToTable('tableA', { x: 10, y: 10, posZ: 0, zindex: 0 }, false);
    c2.addToTable('tableB', { x: 10, y: 10, posZ: 0, zindex: 0 }, false);
    c1.hydratePoseForView('tableA');
    c2.hydratePoseForView('tableA');

    c1.toTopmost();

    expect(c1.zindex).toBeGreaterThan(c2.zindex);
    expect(c1.getPoseForTable('tableA')!.zindex).toBe(c1.zindex);
    expect(c1.getPoseForTable('tableB')!.zindex).toBe(5);
  });

  it('getUrls is empty when the data tree has not synced yet', () => {
    const terrain = new Terrain('bareTerrain');
    expect(terrain.getUrls()).toEqual([]);
  });
});
