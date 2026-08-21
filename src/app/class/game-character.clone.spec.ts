import { ObjectStore } from './core/synchronize-object/object-store';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import {
  makeCharacter,
  makeTable,
  makeToken,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('GameCharacter.cloneCharacter', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('creates a new body in inventory plus one Token on the current view', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('hero', 'Hero');
    src.location = { name: 'common', x: 0, y: 0 };
    src.isInventoryIndicate = true;
    const srcTok = makeToken(src, { x: 10, y: 20, posZ: 0 }, 'mapA');
    srcTok.rotate = 45;

    const { body, token } = GameCharacter.cloneCharacter(src, {
      pose: { x: 60, y: 70, posZ: 1 },
      copyAppearanceFrom: srcTok,
    });

    expect(body.identifier).not.toBe(src.identifier);
    expect(body.name).toBe('Hero');
    expect(body.location.name).toBe('common');
    expect(body.location.name).not.toBe('table');
    expect(token).toBeTruthy();
    expect(token!.characterId).toBe(body.identifier);
    expect(token!.hasPlacement('mapA')).toBeTrue();
    expect(token!.getPoseForTable('mapA')).toEqual(jasmine.objectContaining({ x: 60, y: 70, posZ: 1 }));
    expect(token!.rotate).toBe(45);
    // Source body stays one inventory entry; source token unchanged.
    expect(ObjectStore.instance.getObjects(GameCharacter).length).toBe(2);
    expect(CharacterToken.tokensOnTable(src.identifier, 'mapA').length).toBe(1);
    expect(CharacterToken.tokensOnTable(body.identifier, 'mapA').length).toBe(1);
  });

  it('numbered clone renames the new body without renaming the source', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('hero2', 'Hero');
    src.location = { name: 'common', x: 0, y: 0 };

    const { body } = GameCharacter.cloneCharacter(src, {
      numbered: true,
      pose: { x: 1, y: 1 },
    });

    expect(src.name).toBe('Hero');
    expect(body.name).toBe('Hero_1');
  });

  it('duplicateToken shares characterId and does not add a body', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('hero3', 'Hero');
    src.location = { name: 'common', x: 0, y: 0 };
    const tok = makeToken(src, { x: 5, y: 5 }, 'mapA');
    const before = ObjectStore.instance.getObjects(GameCharacter).length;

    const copy = tok.duplicateToken({ x: 55, y: 55 });

    expect(copy.characterId).toBe(src.identifier);
    expect(ObjectStore.instance.getObjects(GameCharacter).length).toBe(before);
    expect(CharacterToken.tokensOnTable(src.identifier, 'mapA').length).toBe(2);
  });
});
