import { ImageFile } from './core/file-storage/image-file';
import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { CardStack } from './card-stack';
import { CharacterToken } from './character-token';
import { DataElement } from './data-element';
import { GameCharacter } from './game-character';
import { Room } from './room';
import {
  makeCard,
  makeDice,
  makeMask,
  makeTable,
  resetTabletopStore,
  viewTables,
} from '../../testing/tabletop-test.util';

describe('null-length safety (room-load templates)', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('ImageFile.url is never nullish when thumbnail.url is null', () => {
    const file = ImageFile.createEmpty('sync-pending');
    (file as any).context.url = null;
    (file as any).context.thumbnail = { blob: null, type: '', url: null };
    expect(file.url).toBe('');
    expect(() => file.url.length).not.toThrow();
  });

  it('dice/card/stack/mask ownerName and hasOwner tolerate missing PeerCursor and null owner', () => {
    const dice = makeDice('d1');
    dice.owner = 'missing-peer';
    expect(dice.ownerName).toBe('');
    expect(dice.hasOwner).toBeTrue();
    expect(() => dice.ownerName.length).not.toThrow();
    (dice as any).owner = null;
    expect(dice.hasOwner).toBeFalse();

    const card = makeCard('c1');
    card.owner = 'missing-peer';
    expect(card.ownerName).toBe('');
    (card as any).owner = null;
    expect(card.hasOwner).toBeFalse();

    const stack = CardStack.create('s1', 'stack1');
    stack.owner = 'missing-peer';
    expect(stack.ownerName).toBe('');
    (stack as any).owner = null;
    expect(stack.hasOwner).toBeFalse();

    const mask = makeMask('m1');
    mask.owner = 'missing-peer';
    expect(mask.ownerName).toBe('');
    (mask as any).owner = null;
    expect(mask.hasOwner).toBeFalse();
  });

  it('DataElement.name defaults to empty string', () => {
    const el = new DataElement();
    expect(el.name).toBe('');
    expect(() => el.name.trim().length).not.toThrow();
  });

  it('legacy room XML: DataElement mirrors attribute name/type onto SyncVars', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<data name="HP" type="numberResource" currentValue="10" syncId="hp_legacy">100</data>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const el = ObjectSerializer.instance.parseXml(doc.documentElement) as DataElement;
    expect(el).toBeTruthy();
    expect(el.getAttribute('name')).toBe('HP');
    expect(el.name).toBe('HP');
    expect(el.type).toBe('numberResource');
    expect(el.currentValue).toBe('10');
    expect(() => el.name.length).not.toThrow();
  });

  it('DataElement create/xml round-trip keeps name for legacy readers', () => {
    const created = DataElement.create('MP', 50, { type: 'numberResource', currentValue: '50' }, 'mp_rt');
    expect(created.name).toBe('MP');
    expect(created.getAttribute('name')).toBe('MP');
    const xml = created.toXml();
    expect(xml).toContain('name="MP"');
    created.destroy();

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const loaded = ObjectSerializer.instance.parseXml(doc.documentElement) as DataElement;
    expect(loaded.name).toBe('MP');
    expect(loaded.getAttribute('name')).toBe('MP');
    expect(loaded.type).toBe('numberResource');
  });

  it('legacy on-table stealth character migrates owner onto Token without crashing ownerName', () => {
    makeTable('gameTable');
    viewTables('gameTable');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<room syncId="legacy_stealth_room">
  <game-table name="Battle" width="20" height="15" selected="true" syncId="gameTable"/>
  <character owner="offline-user" location.name="table" location.x="10" location.y="20" posZ="0"
    tableIdentifier="gameTable"
    tablePlacements="{&quot;gameTable&quot;:{&quot;x&quot;:10,&quot;y&quot;:20,&quot;posZ&quot;:0}}"
    syncId="legacy_stealth_char">
    <data name="character" syncId="character_legacy_stealth_char">
      <data name="image" syncId="image_legacy_stealth_char">
        <data type="image" name="imageIdentifier" syncId="imageIdentifier_legacy_stealth_char"/>
      </data>
      <data name="common" syncId="common_legacy_stealth_char">
        <data name="name" syncId="name_legacy_stealth_char">Stealthy</data>
        <data name="size" syncId="size_legacy_stealth_char">1</data>
      </data>
      <data name="detail" syncId="detail_legacy_stealth_char"/>
    </data>
  </character>
</room>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const room = new Room();
    room.parseInnerXml(doc.documentElement);

    const body = ObjectStore.instance.get<GameCharacter>('legacy_stealth_char');
    expect(body).toBeTruthy();
    const tok = ObjectStore.instance.get<CharacterToken>(
      CharacterToken.legacyTokenId('legacy_stealth_char')
    );
    expect(tok).toBeTruthy();
    expect(tok.owner).toBe('offline-user');
    expect(tok.isHideIn).toBeTrue();
    expect(tok.ownerName).toBe('');
    expect(() => tok.ownerName.length).not.toThrow();
    expect(body.location.name).not.toBe('table');
  });
});
