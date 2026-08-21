import { CharacterToken } from './character-token';
import {
  applyPlacementViewState,
  capturePlacementViewState,
  viewStatesEqual,
} from './table-placement-view-state';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

/**
 * Token vs sheet data contracts:
 * - Sheet identity (name, size, HP, statuses) stays on GameCharacter.
 * - Map cosmetics / altitude / overview-face live on CharacterToken SyncVars.
 */
describe('CharacterToken appearance / sheet data', () => {
  beforeEach(() => {
    resetTabletopStore();
    makeTable('mapA');
    makeTable('mapB');
    viewTables('mapA');
  });
  afterEach(() => resetTabletopStore());

  it('name and size are read from the sheet, not Token SyncVars', () => {
    const body = makeCharacter('sheet_id', 'Hero', 2);
    const tok = makeToken(body, { x: 0, y: 0 }, 'mapA');

    expect(tok.name).toBe('Hero');
    expect(tok.size).toBe(2);

    body.name = 'Renamed';
    const sizeEl = body.commonDataElement.getFirstElementByName('size');
    expect(sizeEl).toBeTruthy();
    sizeEl!.value = 4;
    expect(tok.name).toBe('Renamed');
    expect(tok.size).toBe(4);
  });

  it('copyTableAppearance seeds cosmetics without mutating sheet SyncVars later', () => {
    const body = makeCharacter('seed_body', 'Hero');
    body.isUseIconToOverviewImage = true;
    body.aura = 3;
    body.isInverse = true;
    body.tokenFrame = 'polaroid';
    body.visionRange = 10;
    body.rotate = 90;

    const tok = CharacterToken.create(body.identifier, { x: 1, y: 2 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });

    expect(tok.isUseIconToOverviewImage).toBeTrue();
    expect(tok.aura).toBe(3);
    expect(tok.isInverse).toBeTrue();
    expect(tok.tokenFrame).toBe('polaroid');
    expect(tok.visionRange).toBe(10);
    expect(tok.rotate).toBe(90);

    tok.mutateAppearance(() => {
      tok.isUseIconToOverviewImage = false;
      tok.aura = -1;
      tok.isInverse = false;
      tok.tokenFrame = 'none';
      tok.visionRange = 4;
      tok.rotate = 0;
    });

    expect(body.isUseIconToOverviewImage).toBeTrue();
    expect(body.aura).toBe(3);
    expect(body.isInverse).toBeTrue();
    expect(body.tokenFrame).toBe('polaroid');
    expect(body.visionRange).toBe(10);
    expect(body.rotate).toBe(90);
  });

  it('create() without copyAppearanceFrom still seeds from the body', () => {
    const body = makeCharacter('auto_seed');
    body.aura = 2;
    body.isDropShadow = false;
    body.isUseIconToOverviewImage = true;

    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });

    expect(tok.aura).toBe(2);
    expect(tok.isDropShadow).toBeFalse();
    expect(tok.isUseIconToOverviewImage).toBeTrue();
  });

  it('two tokens of the same character keep independent cosmetics', () => {
    const body = makeCharacter('multi_tok');
    const a = makeToken(body, { x: 0, y: 0 }, 'mapA');
    const b = CharacterToken.create(body.identifier, { x: 50, y: 50 }, {
      tableId: 'mapA',
      copyAppearanceFrom: a,
    });

    a.mutateAppearance(() => {
      a.aura = 1;
      a.isUseIconToOverviewImage = true;
      a.rotate = 45;
    });
    b.mutateAppearance(() => {
      b.aura = 5;
      b.isUseIconToOverviewImage = false;
      b.rotate = 180;
    });

    expect(a.aura).toBe(1);
    expect(b.aura).toBe(5);
    expect(a.isUseIconToOverviewImage).toBeTrue();
    expect(b.isUseIconToOverviewImage).toBeFalse();
    expect(a.rotate).toBe(45);
    expect(b.rotate).toBe(180);
    expect(a.characterId).toBe(body.identifier);
    expect(b.characterId).toBe(body.identifier);
  });

  it('altitude SyncVar on Token does not write sheet altitude DataElement', () => {
    const body = makeCharacter('alt_iso');
    body.altitude = 7;
    const tok = makeToken(body, { x: 0, y: 0 }, 'mapA');

    tok.altitude = 2;
    expect(tok.altitude).toBe(2);
    expect(tok.altitudeValue).toBe(2);
    expect(Number(body.altitude) || 0).toBe(7);
  });

  it('focusTokenForCharacter and appearanceHostFor are map-scoped', () => {
    const body = makeCharacter('map_scope');
    const onA = makeToken(body, { x: 0, y: 0 }, 'mapA');
    onA.mutateAppearance(() => { onA.aura = 1; });

    viewTables('mapB');
    const onB = makeToken(body, { x: 10, y: 10 }, 'mapB');
    onB.mutateAppearance(() => { onB.aura = 9; });

    expect(CharacterToken.focusTokenForCharacter(body.identifier, 'mapA')).toBe(onA);
    expect(CharacterToken.focusTokenForCharacter(body.identifier, 'mapB')).toBe(onB);
    expect(CharacterToken.appearanceHostFor(body, { tableId: 'mapA' })).toBe(onA);
    expect(CharacterToken.appearanceHostFor(body, { tableId: 'mapB' })).toBe(onB);

    viewTables('mapA');
    expect(CharacterToken.appearanceHostFor(body)).toBe(onA);
    expect((CharacterToken.appearanceHostFor(body) as CharacterToken).aura).toBe(1);
  });

  it('preferredToken wins only when characterId matches', () => {
    const body = makeCharacter('pref_body');
    const other = makeCharacter('other_body');
    const tok = makeToken(body, { x: 0, y: 0 }, 'mapA');
    const otherTok = makeToken(other, { x: 1, y: 1 }, 'mapA');

    expect(CharacterToken.appearanceHostFor(body, { preferredToken: tok })).toBe(tok);
    expect(CharacterToken.appearanceHostFor(body, { preferredToken: otherTok })).toBe(tok);
  });

  it('placement view state round-trips Token cosmetics without touching the sheet', () => {
    const body = makeCharacter('vs_tok');
    body.isUseIconToOverviewImage = false;
    body.aura = -1;
    const tok = makeToken(body, { x: 0, y: 0 }, 'mapA');

    tok.mutateAppearance(() => {
      tok.rotate = 33;
      tok.aura = 4;
      tok.isUseIconToOverviewImage = true;
      tok.tokenFrame = 'polaroid';
      tok.altitudeValue = 6;
    });

    const snap = capturePlacementViewState(tok);
    expect(snap.rotate).toBe(33);
    expect(snap.aura).toBe(4);
    expect(snap.isUseIconToOverviewImage).toBeTrue();
    expect(snap.tokenFrame).toBe('polaroid');
    expect(snap.altitude).toBe(6);

    tok.mutateAppearance(() => {
      tok.rotate = 0;
      tok.aura = -1;
      tok.isUseIconToOverviewImage = false;
      tok.tokenFrame = 'none';
      tok.altitudeValue = 0;
    });
    applyPlacementViewState(tok, snap);

    expect(tok.rotate).toBe(33);
    expect(tok.aura).toBe(4);
    expect(tok.isUseIconToOverviewImage).toBeTrue();
    expect(tok.tokenFrame).toBe('polaroid');
    expect(tok.altitude).toBe(6);
    expect(body.isUseIconToOverviewImage).toBeFalse();
    expect(body.aura).toBe(-1);
    expect(viewStatesEqual(snap, capturePlacementViewState(tok))).toBeTrue();
  });

  it('duplicateToken copies appearance from source Token, not stale sheet seed', () => {
    const body = makeCharacter('dup_app');
    body.aura = -1;
    const src = makeToken(body, { x: 0, y: 0 }, 'mapA');
    src.mutateAppearance(() => {
      src.aura = 7;
      src.isUseIconToOverviewImage = true;
      src.rotate = 15;
    });

    const copy = src.duplicateToken({ x: 40, y: 40 });
    expect(copy.characterId).toBe(body.identifier);
    expect(copy.aura).toBe(7);
    expect(copy.isUseIconToOverviewImage).toBeTrue();
    expect(copy.rotate).toBe(15);
    expect(body.aura).toBe(-1);
  });
});
