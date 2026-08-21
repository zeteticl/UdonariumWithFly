import {
  createGameCharacterFromCcfolia,
  stringifyCcfoliaClipboard,
  toCcfoliaClipboardJson,
  tryParseCcfoliaCharacter,
} from './ccfolia-clipboard';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('CCFOLIA clipboard', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('tryParseCcfoliaCharacter rejects non-character payloads', () => {
    expect(tryParseCcfoliaCharacter('')).toBeNull();
    expect(tryParseCcfoliaCharacter('not json')).toBeNull();
    expect(tryParseCcfoliaCharacter('{"kind":"room","data":{}}')).toBeNull();
    expect(tryParseCcfoliaCharacter('{"kind":"character","data":null}')).toBeNull();
  });

  it('tryParseCcfoliaCharacter accepts character wrapper', () => {
    const raw = JSON.stringify({
      kind: 'character',
      data: { name: 'Alice', memo: 'hi', width: 1, height: 1 },
    });
    const parsed = tryParseCcfoliaCharacter(raw);
    expect(parsed?.kind).toBe('character');
    expect(parsed?.data.name).toBe('Alice');
  });

  it('createGameCharacterFromCcfolia builds a named token at pose', () => {
    makeTable('mapA');
    viewTables('mapA');
    GameCharacter.allowLegacyBodyOnTable = false;
    const clipboard = tryParseCcfoliaCharacter(JSON.stringify({
      kind: 'character',
      data: {
        name: 'Bob',
        memo: 'memo',
        width: 2,
        height: 2,
        angle: 45,
        params: [{ label: 'STR', value: '10' }],
        status: [{ label: 'HP', value: 8, max: 10 }],
      },
    }));
    expect(clipboard).toBeTruthy();
    const ch = createGameCharacterFromCcfolia(clipboard!, { x: 30, y: 40 });
    expect(ch.name).toBe('Bob');
    expect(ch.rotate).toBe(45);
    expect(ch.location.name).not.toBe('table');
    const tokens = CharacterToken.tokensOnTable(ch.identifier, 'mapA');
    expect(tokens.length).toBe(1);
    expect(tokens[0].location.x).toBe(5);
    expect(tokens[0].location.y).toBe(15);
  });

  it('round-trips name via toCcfoliaClipboardJson / stringify', () => {
    makeTable('mapA');
    viewTables('mapA');
    const ch = makeCharacter('exportMe', 'Carol');
    const json = toCcfoliaClipboardJson(ch);
    expect(json.kind).toBe('character');
    expect(json.data.name).toBe('Carol');
    const text = stringifyCcfoliaClipboard(ch);
    expect(tryParseCcfoliaCharacter(text)?.data.name).toBe('Carol');
  });
});
