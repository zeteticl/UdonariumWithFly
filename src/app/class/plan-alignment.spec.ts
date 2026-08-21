import { ObjectStore } from './core/synchronize-object/object-store';
import { Network } from './core/system';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';
import { OverviewPanelComponent } from 'component/overview-panel/overview-panel.component';

describe('Plan alignment gaps', () => {
  beforeEach(() => {
    resetTabletopStore();
    makeTable('mapA');
    viewTables('mapA');
  });
  afterEach(() => resetTabletopStore());

  it('destroying a body cascades to all of its Tokens', () => {
    const body = makeCharacter('cascade_body');
    const a = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    const b = CharacterToken.create(body.identifier, { x: 40, y: 40 }, { tableId: 'mapA' });
    const aId = a.identifier;
    const bId = b.identifier;
    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(2);

    body.destroy();

    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(0);
    expect(ObjectStore.instance.get(aId)).toBeNull();
    expect(ObjectStore.instance.get(bId)).toBeNull();
    expect(ObjectStore.instance.get(body.identifier)).toBeNull();
  });

  it('vision on map Token is what FoW focus reads', () => {
    const body = makeCharacter('vision_body');
    body.visionRange = 3;
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    expect(tok.visionRange).toBe(3);

    tok.mutateAppearance(() => { tok.visionRange = 12; });
    expect(CharacterToken.focusTokenForCharacter(body.identifier, 'mapA')!.visionRange).toBe(12);
  });

  it('temporary bodies are excluded from chat-select style filters', () => {
    const normal = makeCharacter('chat_ok');
    normal.isAllowsChat = true;
    normal.location.name = 'common';

    const temp = makeCharacter('chat_temp');
    temp.isTemporaryCopy = true;
    temp.isAllowsChat = true;
    temp.location.name = 'common';

    const list = [normal, temp].filter(c => !c.isTemporaryCopy && c.isAllowsChat);
    expect(list.map(c => c.identifier)).toEqual([normal.identifier]);
  });

  it('isStealthMode only considers Tokens on the table', () => {
    const body = makeCharacter('stealth_body');
    body.owner = 'someone';
    expect(GameCharacter.isStealthMode).toBeFalse();

    spyOnProperty(Network, 'peer', 'get').and.returnValue({ userId: 'someone' } as any);
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    tok.owner = 'someone';
    expect(tok.isHideIn).toBeTrue();
    expect(tok.isVisible).toBeTrue();
    expect(tok.isVisibleOnTable).toBeTrue();
    expect(CharacterToken.isStealthMode).toBeTrue();
    expect(GameCharacter.isStealthMode).toBeTrue();
  });

  it('stealth ownerName is empty string when PeerCursor is missing (room-load safe)', () => {
    const body = makeCharacter('stealth_owner_name');
    body.owner = 'missing-peer';
    expect(body.ownerName).toBe('');
    expect(() => body.ownerName.length).not.toThrow();

    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    tok.owner = 'missing-peer';
    expect(tok.isHideIn).toBeTrue();
    expect(tok.ownerName).toBe('');
    expect(() => tok.ownerName.length).not.toThrow();
  });

  it('setLocation(graveyard) destroys all map Tokens', () => {
    const body = makeCharacter('grave_body');
    body.location.name = 'common';
    const a = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    const b = CharacterToken.create(body.identifier, { x: 40, y: 40 }, { tableId: 'mapA' });
    const aId = a.identifier;
    const bId = b.identifier;

    body.setLocation('graveyard');

    expect(body.location.name).toBe('graveyard');
    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(0);
    expect(ObjectStore.instance.get(aId)).toBeNull();
    expect(ObjectStore.instance.get(bId)).toBeNull();
    expect(ObjectStore.instance.get(body.identifier)).toBeTruthy();
  });

  it('Token cosmetics stay on Token when mutated via appearance host', () => {
    const body = makeCharacter('fx_body');
    body.isDropShadow = true;
    body.aura = -1;
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    expect(tok.isDropShadow).toBeTrue();

    tok.mutateAppearance(() => {
      tok.isDropShadow = false;
      tok.aura = 3;
    });

    expect(tok.isDropShadow).toBeFalse();
    expect(tok.aura).toBe(3);
    // Sheet seed unchanged — map projection owns live cosmetics.
    expect(body.isDropShadow).toBeTrue();
    expect(body.aura).toBe(-1);
  });

  it('placing a Token revives the sheet out of the graveyard', () => {
    const body = makeCharacter('revive_body');
    body.setLocation('graveyard');
    expect(body.location.name).toBe('graveyard');

    CharacterToken.create(body.identifier, { x: 10, y: 20 }, { tableId: 'mapA' });

    expect(body.location.name).toBe('common');
    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(1);
  });

  it('graveyard is room-wide (visible regardless of viewed map)', () => {
    makeTable('mapB');
    const body = makeCharacter('grave_shared');
    body.tableIdentifier = 'mapA';
    body.setLocation('graveyard');

    expect(body.location.name).toBe('graveyard');
    expect(body.tableIdentifier).toBe('');

    viewTables('mapB');
    // Inventory filter is location===graveyard only (no per-map check).
    expect(body.location.name === 'graveyard' && !body.isTemporaryCopy).toBeTrue();
  });

  it('CharacterToken exposes altitude for context-menu / keyboard nudge', () => {
    const body = makeCharacter('alt_body');
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    expect(tok.isHaveAltitude).toBeTrue();
    tok.altitude = 3;
    expect(tok.altitude).toBe(3);
    expect(tok.altitudeValue).toBe(3);
  });

  it('appearanceHostFor prefers the viewed Token over the sheet', () => {
    const body = makeCharacter('host_body');
    body.aura = -1;
    expect(CharacterToken.appearanceHostFor(body)).toBe(body);

    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    tok.aura = 2;
    expect(CharacterToken.appearanceHostFor(body)).toBe(tok);
    expect(CharacterToken.appearanceHostFor(body, { preferredToken: tok })).toBe(tok);
  });

  it('overview face flag is on Token appearance host, not the sheet SyncVar', () => {
    const body = makeCharacter('overview_face_body');
    body.isUseIconToOverviewImage = false;
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    tok.mutateAppearance(() => { tok.isUseIconToOverviewImage = true; });

    expect(body.isUseIconToOverviewImage).toBeFalse();
    expect(tok.isUseIconToOverviewImage).toBeTrue();
    const host = CharacterToken.appearanceHostFor(body);
    expect(host).toBe(tok);
    expect(!!(host && host.isUseIconToOverviewImage)).toBeTrue();
  });

  it('OverviewPanel isUseIcon follows Token flag (not sheet SyncVar)', () => {
    const body = makeCharacter('ov_panel_face');
    Object.defineProperty(body, 'faceIcon', {
      configurable: true,
      get: () => ({ url: 'blob:test-face-icon' }),
    });
    body.isUseIconToOverviewImage = false;
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    tok.mutateAppearance(() => { tok.isUseIconToOverviewImage = true; });

    const panel = Object.create(OverviewPanelComponent.prototype) as OverviewPanelComponent;
    panel.tabletopObject = tok;
    expect(panel.isUseIcon).toBeTrue();

    tok.mutateAppearance(() => { tok.isUseIconToOverviewImage = false; });
    expect(panel.isUseIcon).toBeFalse();

    tok.mutateAppearance(() => { tok.isUseIconToOverviewImage = true; });
    panel.tabletopObject = body;
    expect(panel.isUseIcon).toBeTrue();
  });
});
