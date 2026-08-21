import { CharacterToken } from '@udonarium/character-token';
import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { TableSelecter } from '@udonarium/table-selecter';
import {
  DEFAULT_TABLE_2D_ID,
  DEFAULT_TABLE_3D_ID,
} from 'service/default-room/default-room.ids';
import {
  makeDefaultTables,
  seedDefaultRoomObjects,
} from 'service/default-room/default-room.seed';
import { resetTabletopStore } from '../../../testing/tabletop-test.util';

describe('default-room.seed contracts', () => {
  beforeEach(() => {
    resetTabletopStore();
    // Seed must follow product rule: body off table, Token on maps.
    GameCharacter.allowLegacyBodyOnTable = false;
  });
  afterEach(() => resetTabletopStore());

  const t = (key: string) => key;

  it('seeds dual-map monster C and battle + clue red strings', () => {
    makeDefaultTables(t);
    seedDefaultRoomObjects(t);

    expect(ObjectStore.instance.get<GameTable>(DEFAULT_TABLE_3D_ID)).toBeTruthy();
    expect(ObjectStore.instance.get<GameTable>(DEFAULT_TABLE_2D_ID)).toBeTruthy();

    const c = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
    expect(c).toBeTruthy();
    expect(c.location.name).not.toBe('table');
    expect(CharacterToken.tokensOnTable(c.identifier, DEFAULT_TABLE_3D_ID).length).toBe(1);
    expect(CharacterToken.tokensOnTable(c.identifier, DEFAULT_TABLE_2D_ID).length).toBe(1);

    const links = ClueLink.all();
    const battleLinks = links.filter(l => l.tableIdentifier === DEFAULT_TABLE_3D_ID);
    const clueLinks = links.filter(l => l.tableIdentifier === DEFAULT_TABLE_2D_ID);
    expect(battleLinks.length).toBe(2);
    expect(clueLinks.length).toBe(5);
    for (const link of battleLinks) {
      expect(ObjectStore.instance.get(link.fromIdentifier)).toBeInstanceOf(CharacterToken);
      expect(ObjectStore.instance.get(link.toIdentifier)).toBeInstanceOf(CharacterToken);
    }

    const tok2d = CharacterToken.tokensOnTable(c.identifier, DEFAULT_TABLE_2D_ID)[0];
    expect(tok2d).toBeTruthy();
    expect(tok2d.getPoseForTable(DEFAULT_TABLE_2D_ID)).toEqual(
      jasmine.objectContaining({ x: 175, y: 400, posZ: 0 })
    );
    expect(tok2d.location.x).toBe(175);
    expect(tok2d.location.y).toBe(400);

    // Fixed syncIds only (no random "新角色").
    const chars = ObjectStore.instance.getObjects(GameCharacter);
    for (const ch of chars) {
      expect(ch.identifier.startsWith('testCharacter_') || ch.identifier.startsWith('clueCharacter_')).toBeTrue();
    }
  });

  it('keeps character Tokens above the clue-board cover mask', () => {
    makeDefaultTables(t);
    seedDefaultRoomObjects(t);

    TableSelecter.instance.viewedTableIdentifier = DEFAULT_TABLE_2D_ID;
    const mask = ObjectStore.instance.get<GameTableMask>('clueMask_org');
    const tok = CharacterToken.tokensOnTable('testCharacter_3', DEFAULT_TABLE_2D_ID)[0];
    expect(mask).toBeTruthy();
    expect(tok).toBeTruthy();
    expect(tok.zindex).toBeGreaterThan(mask.zindex);
  });
});
