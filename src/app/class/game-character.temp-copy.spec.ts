import { ObjectStore } from './core/synchronize-object/object-store';
import { CharacterToken } from './character-token';
import { DataElement } from './data-element';
import { GameCharacter } from './game-character';
import { TabletopObject } from './tabletop-object';
import {
  makeCharacter,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('GameCharacter temporary copy', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('createTemporaryCopy clones an independent sheet (HP not shared)', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('srcChar', 'Hero');
    src.location = { name: 'common', x: 10, y: 20 };
    src.isInventoryIndicate = true;

    const copy = GameCharacter.createTemporaryCopy(src, { x: 50, y: 60, posZ: 1 }, 'mapA');

    expect(copy).toBeInstanceOf(CharacterToken);
    expect(copy.identifier).not.toBe(src.identifier);
    expect(copy.characterId).not.toBe(src.identifier);
    expect(copy.isTemporaryCopy).toBeTrue();
    expect(copy.hasPlacement('mapA')).toBeTrue();
    expect(copy.getPoseForTable('mapA')).toEqual(jasmine.objectContaining({ x: 50, y: 60, posZ: 1 }));

    const tempBody = copy.character;
    expect(tempBody).toBeTruthy();
    expect(tempBody.isTemporaryCopy).toBeTrue();
    expect(tempBody.isInventoryIndicate).toBeFalse();
    expect(src.isTemporaryCopy).toBeFalse();
    expect(src.location.name).not.toBe('table');

    const srcHp = src.detailDataElement?.getFirstElementByName('HP') as DataElement;
    const tempHp = tempBody.detailDataElement?.getFirstElementByName('HP') as DataElement;
    expect(srcHp).toBeTruthy();
    expect(tempHp).toBeTruthy();
    expect(tempHp.identifier).not.toBe(srcHp.identifier);

    const before = String(srcHp.currentValue ?? srcHp.value);
    tempHp.currentValue = '3';
    expect(String(srcHp.currentValue ?? srcHp.value)).toBe(before);
    expect(String(tempHp.currentValue)).toBe('3');
  });

  it('disposeObject / destroyToken remove temporary token and its body', () => {
    makeTable('mapA');
    viewTables('mapA');
    const src = makeCharacter('src2');
    src.location = { name: 'common', x: 0, y: 0 };
    const copy = GameCharacter.createTemporaryCopy(src, { x: 1, y: 1 }, 'mapA');
    const tokenId = copy.identifier;
    const bodyId = copy.characterId;
    let graveyard = false;

    TabletopObject.disposeObject(copy, () => { graveyard = true; });

    expect(graveyard).toBeFalse();
    expect(ObjectStore.instance.get(tokenId)).toBeFalsy();
    expect(ObjectStore.instance.get(bodyId)).toBeFalsy();
    expect(ObjectStore.instance.get(src.identifier)).toBeTruthy();
  });

  it('disposeObject uses graveyard callback for normal character bodies', () => {
    makeTable('mapA');
    viewTables('mapA');
    const ch = makeCharacter('normal');
    ch.location = { name: 'common', x: 0, y: 0 };
    let graveyard = false;

    TabletopObject.disposeObject(ch, () => { graveyard = true; });

    expect(graveyard).toBeTrue();
  });
});
