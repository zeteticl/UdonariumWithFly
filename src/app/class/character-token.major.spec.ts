import { CharacterToken } from './character-token';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('CharacterToken major policy', () => {
  beforeEach(() => {
    resetTabletopStore();
    makeTable('mapA');
    viewTables('mapA');
  });
  afterEach(() => resetTabletopStore());

  it('first token on a map becomes major automatically', () => {
    const body = makeCharacter('body1');
    const tok = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    expect(tok.isMajorMarker).toBeTrue();
  });

  it('second token from inventory-style create does not steal major', () => {
    const body = makeCharacter('body2');
    const first = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    expect(first.isMajorMarker).toBeTrue();

    const second = CharacterToken.create(body.identifier, { x: 50, y: 50 }, {
      tableId: 'mapA',
      copyAppearanceFrom: body,
    });
    expect(first.isMajorMarker).toBeTrue();
    expect(second.isMajorMarker).toBeFalse();
    expect(CharacterToken.majorOnTable(body.identifier, 'mapA')).toBe(first);
  });

  it('explicit major:true claims major from the previous holder', () => {
    const body = makeCharacter('body3');
    const first = CharacterToken.create(body.identifier, { x: 0, y: 0 }, { tableId: 'mapA' });
    const second = CharacterToken.create(body.identifier, { x: 50, y: 50 }, {
      tableId: 'mapA',
      major: true,
    });
    expect(first.isMajorMarker).toBeFalse();
    expect(second.isMajorMarker).toBeTrue();
  });

  it('temporary copy does not steal major from the source body token', () => {
    const body = makeCharacter('body4');
    const first = CharacterToken.create(body.identifier, { x: 0, y: 0 }, {
      tableId: 'mapA',
      major: true,
    });
    expect(first.isMajorMarker).toBeTrue();

    const { GameCharacter } = require('./game-character') as typeof import('./game-character');
    const temp = GameCharacter.createTemporaryCopy(body, { x: 80, y: 80 }, 'mapA');
    // Temp owns an independent sheet — its own major is fine; source major must stay.
    expect(first.isMajorMarker).toBeTrue();
    expect(temp.characterId).not.toBe(body.identifier);
    expect(CharacterToken.majorOnTable(body.identifier, 'mapA')).toBe(first);
    expect(CharacterToken.focusTokenForCharacter(body.identifier, 'mapA')).toBe(first);
  });
});
