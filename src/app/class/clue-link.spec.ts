import { CharacterToken } from './character-token';
import { ClueLink } from './clue-link';
import { GameCharacter } from './game-character';
import { TextNote } from './text-note';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('ClueLink', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  function placeToken(ch: GameCharacter, tableId: string, x: number, y: number): CharacterToken {
    ch.location = { name: 'common', x: 0, y: 0 };
    const tok = makeToken(ch, { x, y, posZ: 0 }, tableId);
    tok.pushPin = false;
    return tok;
  }

  it('isValidOnTable is true when both endpoints are visible on the view', () => {
    makeTable('t1');
    viewTables('t1');
    const a = makeCharacter('a');
    const b = makeCharacter('b');
    placeToken(a, 't1', 0, 0);
    placeToken(b, 't1', 10, 10);

    // Body ids resolve to Tokens on the view.
    const link = ClueLink.create(a.identifier, b.identifier, { tableIdentifier: 't1' });
    expect(link.isValidOnTable('t1')).toBeTrue();
  });

  it('does not require pushPin on endpoints', () => {
    makeTable('t1');
    viewTables('t1');
    const a = makeCharacter('a2');
    const b = makeCharacter('b2');
    const ta = placeToken(a, 't1', 0, 0);
    const tb = placeToken(b, 't1', 10, 10);
    expect(ta.pushPin).toBeFalse();
    expect(tb.pushPin).toBeFalse();

    const link = ClueLink.create(a.identifier, b.identifier, { tableIdentifier: 't1' });
    expect(link.isValidOnTable('t1')).toBeTrue();
  });

  it('isValidOnTable is false when tableIdentifier is another map', () => {
    makeTable('t1');
    makeTable('t2');
    viewTables('t1');
    const a = makeCharacter('a3');
    const b = makeCharacter('b3');
    const ta = placeToken(a, 't1', 0, 0);
    placeToken(b, 't1', 10, 10);

    const link = ClueLink.create(a.identifier, b.identifier, { tableIdentifier: 't2' });
    // Viewing t1 but link is stamped for t2.
    expect(link.isValidOnTable('t1')).toBeFalse();

    // Switch view to t2: table id matches, but Tokens are not placed on t2.
    viewTables('t2');
    expect(ta.isVisibleOnTable).toBeFalse();
    expect(link.isValidOnTable('t2')).toBeFalse();
  });

  it('isValidOnTable is false when an endpoint is missing or off-table', () => {
    makeTable('t1');
    viewTables('t1');
    const a = makeCharacter('a4');
    placeToken(a, 't1', 0, 0);

    const missing = ClueLink.create(a.identifier, 'no-such-id', { tableIdentifier: 't1' });
    expect(missing.isValidOnTable('t1')).toBeFalse();

    const b = makeCharacter('b4');
    const tokB = placeToken(b, 't1', 1, 1);
    tokB.destroy();
    const off = ClueLink.create(a.identifier, b.identifier, { tableIdentifier: 't1' });
    expect(off.isValidOnTable('t1')).toBeFalse();
  });

  it('create stores tableIdentifier used for view filtering', () => {
    makeTable('battle');
    makeTable('clue');
    viewTables('battle');
    const a = makeCharacter('ba');
    const b = makeCharacter('bb');
    placeToken(a, 'battle', 0, 0);
    placeToken(b, 'battle', 20, 20);

    const link = ClueLink.create(a.identifier, b.identifier, {
      tableIdentifier: 'battle',
      identifier: 'link_battle_1',
    });
    expect(link.tableIdentifier).toBe('battle');
    expect(link.isValidOnTable('battle')).toBeTrue();
    expect(link.isValidOnTable('clue')).toBeFalse();
  });

  it('shouldCleanupOnEndpointDelete skips self-echo after reload', () => {
    expect(ClueLink.shouldCleanupOnEndpointDelete({
      isSendFromSelf: true,
      aliasName: GameCharacter.aliasName,
    })).toBeFalse();

    expect(ClueLink.shouldCleanupOnEndpointDelete({
      isSendFromSelf: false,
      aliasName: GameCharacter.aliasName,
    })).toBeTrue();

    expect(ClueLink.shouldCleanupOnEndpointDelete({
      isSendFromSelf: false,
      aliasName: CharacterToken.aliasName,
    })).toBeTrue();

    expect(ClueLink.shouldCleanupOnEndpointDelete({
      isSendFromSelf: false,
      aliasName: TextNote.aliasName,
    })).toBeTrue();

    expect(ClueLink.shouldCleanupOnEndpointDelete({
      isSendFromSelf: false,
      aliasName: 'terrain',
    })).toBeFalse();
  });

  it('cleanupFor destroys links touching the endpoint', () => {
    makeTable('t1');
    viewTables('t1');
    const a = makeCharacter('ca');
    const b = makeCharacter('cb');
    placeToken(a, 't1', 0, 0);
    placeToken(b, 't1', 1, 1);
    ClueLink.create(a.identifier, b.identifier, { identifier: 'to-clean' });
    expect(ClueLink.all().length).toBe(1);
    ClueLink.cleanupFor(a.identifier);
    expect(ClueLink.all().length).toBe(0);
  });
});
