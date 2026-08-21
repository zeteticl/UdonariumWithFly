import { ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { DataElement } from './data-element';
import { DiceSymbol } from './dice-symbol';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { Room } from './room';
import { TextNote } from './text-note';
import { makeTable, resetTabletopStore } from '../../testing/tabletop-test.util';

describe('Room load resilience', () => {
  beforeEach(() => {
    resetTabletopStore();
    Room.lastLoadReport = { loaded: 0, skipped: [] };
    Room.lastSaveReport = { written: 0, skipped: [] };
    Room.pendingLoadUserNotice = false;
  });
  afterEach(() => resetTabletopStore());

  it('skips unknown / corrupt top-level objects and keeps the rest', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<room syncId="resilient_room">
  <game-table name="Keep" width="10" height="10" selected="true" syncId="keepTable"/>
  <not-a-real-alias location.name="table" syncId="bogus_obj"/>
  <character owner="offline" location.name="common" location.x="0" location.y="0" syncId="keepChar">
    <data name="character" syncId="character_keepChar">
      <data name="image" syncId="image_keepChar">
        <data type="image" name="imageIdentifier" syncId="imageIdentifier_keepChar"/>
      </data>
      <data name="common" syncId="common_keepChar">
        <data name="name" syncId="name_keepChar">Survivor</data>
        <data name="size" syncId="size_keepChar">1</data>
      </data>
      <data name="detail" syncId="detail_keepChar"/>
    </data>
  </character>
  <text-note title="Note" location.name="common" syncId="keepNote">
    <data name="note" syncId="root_keepNote">
      <data name="common" syncId="common_keepNote">
        <data name="title" syncId="title_keepNote">Note</data>
        <data name="text" syncId="text_keepNote">ok</data>
      </data>
    </data>
  </text-note>
</room>`;
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const room = new Room();
    expect(() => room.parseInnerXml(doc.documentElement)).not.toThrow();

    expect(ObjectStore.instance.get<GameTable>('keepTable')).toBeTruthy();
    expect(ObjectStore.instance.get<GameCharacter>('keepChar')).toBeTruthy();
    expect(ObjectStore.instance.get<TextNote>('keepNote')).toBeTruthy();
    expect(ObjectStore.instance.get('bogus_obj')).toBeNull();

    expect(Room.lastLoadReport.loaded).toBeGreaterThanOrEqual(3);
    expect(Room.lastLoadReport.skipped.some(s => s.tag === 'not-a-real-alias')).toBeTrue();
    expect(Room.pendingLoadUserNotice).toBeTrue();
  });

  it('records save skips when toXml fails and keeps writing siblings', () => {
    makeTable('keepTable');
    const char = GameCharacter.create('BrokenChar', 1, '');
    spyOn(char, 'toXml').and.throwError('serialize boom');

    const room = new Room();
    const xml = room.innerXml();

    expect(xml).toContain('game-table');
    expect(xml).not.toContain(char.identifier);
    expect(Room.lastSaveReport.written).toBeGreaterThan(0);
    expect(Room.lastSaveReport.skipped.some(s => s.identifier === char.identifier)).toBeTrue();
  });

  it('DataElement.create aligns attribute name without requiring initialize first', () => {
    const el = DataElement.create('hp', 10, { type: 'numberResource', currentValue: 10 });
    expect(el.name).toBe('hp');
    expect(el.getAttribute('name')).toBe('hp');
    expect(el.type).toBe('numberResource');
  });

  it('ObjectSerializer.parseXml never throws for unknown aliases', () => {
    const xml = `<totally-unknown-thing syncId="x1" foo.bar="1"/>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    expect(() => ObjectSerializer.instance.parseXml(el)).not.toThrow();
    expect(ObjectSerializer.instance.parseXml(el)).toBeNull();
  });

  it('skips a corrupt attribute without aborting the object', () => {
    // location is an object SyncVar; a non-JSON value must be skipped, not throw.
    const xml = `<dice-symbol owner="" location="{not-json" syncId="dice_ok"/>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const dice = ObjectSerializer.instance.parseXml(el) as DiceSymbol;
    expect(dice).toBeTruthy();
    expect(dice.identifier).toBe('dice_ok');
  });

  it('skips one broken character child and still loads siblings in a sheet', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<character location.name="common" syncId="parentChar">
  <data name="character" syncId="character_parentChar">
    <data name="image" syncId="image_parentChar">
      <data type="image" name="imageIdentifier" syncId="imageIdentifier_parentChar"/>
    </data>
    <data name="common" syncId="common_parentChar">
      <data name="name" syncId="name_parentChar">OK</data>
      <not-a-real-alias syncId="broken_child"/>
      <data name="size" syncId="size_parentChar">2</data>
    </data>
    <data name="detail" syncId="detail_parentChar"/>
  </data>
</character>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const ch = ObjectSerializer.instance.parseXml(el) as GameCharacter;
    expect(ch).toBeTruthy();
    expect(ch.identifier).toBe('parentChar');
    expect(ch.size).toBe(2);
    expect(ObjectStore.instance.get('broken_child')).toBeNull();
  });
});
