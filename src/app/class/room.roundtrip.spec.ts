import { CharacterToken } from './character-token';
import { ClueLink } from './clue-link';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { Room } from './room';
import { TableSelecter } from './table-selecter';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('Room XML round-trip', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('migrates legacy on-table bodies to Tokens and retargets clue links', () => {
    GameCharacter.allowLegacyBodyOnTable = true;
    const battle = makeTable('gameTable', 'Battle');
    const clue = makeTable('gameTable_clue2d', 'Clue');
    battle.selected = true;
    clue.selected = false;
    viewTables('gameTable');

    const a = makeCharacter('testCharacter_1', 'A');
    a.location = { name: 'table', x: 250, y: 450 };
    a.addToTable('gameTable', { x: 250, y: 450, posZ: 0 }, true);

    const c = makeCharacter('testCharacter_3', 'C', 3);
    c.location = { name: 'table', x: 175, y: 225 };
    // Product migration collapses multi-map body placements to one exclusive Token.
    c.addToTable('gameTable', { x: 175, y: 225, posZ: 0 }, true);
    c.addToTable('gameTable_clue2d', { x: 175, y: 400, posZ: 0 }, false);

    ClueLink.create(c.identifier, a.identifier, {
      sag: 0.22,
      tableIdentifier: 'gameTable',
      identifier: 'battleClueLink_1',
    });

    TableSelecter.instance.viewTableIdentifier = 'gameTable';
    TableSelecter.instance.viewedTableIdentifier = 'gameTable';

    const room = new Room();
    const xml = `<room syncId="room_test">${room.innerXml()}</room>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    resetTabletopStore();
    room.parseInnerXml(doc.documentElement);

    const battle2 = ObjectStore.instance.get<GameTable>('gameTable');
    const clue2 = ObjectStore.instance.get<GameTable>('gameTable_clue2d');
    expect(battle2).toBeTruthy();
    expect(clue2).toBeTruthy();

    const c2 = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
    expect(c2).toBeTruthy();
    expect(c2.location.name).not.toBe('table');

    const tokC = ObjectStore.instance.get<CharacterToken>(CharacterToken.legacyTokenId('testCharacter_3'));
    const tokA = ObjectStore.instance.get<CharacterToken>(CharacterToken.legacyTokenId('testCharacter_1'));
    expect(tokC).toBeTruthy();
    expect(tokA).toBeTruthy();
    expect(tokC.characterId).toBe('testCharacter_3');
    expect(tokC.hasPlacement('gameTable') || tokC.hasPlacement('gameTable_clue2d')).toBeTrue();

    const link = ObjectStore.instance.get<ClueLink>('battleClueLink_1');
    expect(link).toBeTruthy();
    expect(link.fromIdentifier).toBe(CharacterToken.legacyTokenId('testCharacter_3'));
    expect(link.toIdentifier).toBe(CharacterToken.legacyTokenId('testCharacter_1'));
    expect(link.tableIdentifier).toBe('gameTable');
  });

  it('round-trips body + CharacterToken without inventing extra bodies', () => {
    makeTable('gameTable', 'Battle');
    viewTables('gameTable');

    const body = makeCharacter('heroBody', 'Hero');
    body.location = { name: 'common', x: 0, y: 0 };
    const tok = makeToken(body, { x: 100, y: 200, posZ: 0 }, 'gameTable');
    ClueLink.create(tok.identifier, tok.identifier, {
      tableIdentifier: 'gameTable',
      identifier: 'selfLink',
    });

    const room = new Room();
    const xml = `<room syncId="room_tok">${room.innerXml()}</room>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    resetTabletopStore();
    room.parseInnerXml(doc.documentElement);

    const body2 = ObjectStore.instance.get<GameCharacter>('heroBody');
    expect(body2).toBeTruthy();
    expect(body2.location.name).not.toBe('table');
    expect(ObjectStore.instance.getObjects(GameCharacter).length).toBe(1);

    const tokens = ObjectStore.instance.getObjects(CharacterToken).filter(t => t.characterId === 'heroBody');
    expect(tokens.length).toBe(1);
    expect(tokens[0].getPoseForTable('gameTable')).toEqual(
      jasmine.objectContaining({ x: 100, y: 200, posZ: 0 })
    );
  });

  it('ObjectSerializer preserves syncId on GameTable', () => {
    const t = makeTable('syncTable_x', 'X');
    const xml = t.toXml();
    expect(xml).toContain('syncId="syncTable_x"');
    t.destroy();
    ObjectStore.instance.clearDeleteHistory();
    const parsed = ObjectSerializer.instance.parseXml(
      new DOMParser().parseFromString(xml, 'text/xml').documentElement
    ) as GameTable;
    expect(parsed.identifier).toBe('syncTable_x');
  });
});
