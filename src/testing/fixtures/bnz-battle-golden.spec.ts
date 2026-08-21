import { CharacterToken } from '@udonarium/character-token';
import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { Room } from '@udonarium/room';
import { resetTabletopStore } from '../tabletop-test.util';

declare const require: any;

describe('BNZ golden fly_data fixture', () => {
  beforeEach(() => resetTabletopStore());
  afterEach(() => resetTabletopStore());

  it('parses dual-map monster C and battle clue link', () => {
    // Karma serves files; fetch fixture from relative URL under /base when available,
    // otherwise embed minimal parse via DOM from bundled string.
    const xml = (window as any).__BNZ_GOLDEN_XML__ as string | undefined;
    const source = xml || BNZ_GOLDEN_INLINE;
    const doc = new DOMParser().parseFromString(source, 'text/xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    const room = new Room();
    room.parseInnerXml(doc.documentElement);

    expect(ObjectStore.instance.get<GameTable>('gameTable')).toBeTruthy();
    expect(ObjectStore.instance.get<GameTable>('gameTable_clue2d')).toBeTruthy();

    const c = ObjectStore.instance.get<GameCharacter>('testCharacter_3');
    expect(c).toBeTruthy();
    // Room load migrates on-table bodies → CharacterTokens; sheet stays off-table.
    expect(c.location.name).not.toBe('table');

    const tokC = ObjectStore.instance.get<CharacterToken>(CharacterToken.legacyTokenId('testCharacter_3'));
    const tokA = ObjectStore.instance.get<CharacterToken>(CharacterToken.legacyTokenId('testCharacter_1'));
    expect(tokC).toBeTruthy();
    expect(tokA).toBeTruthy();
    expect(tokC.characterId).toBe('testCharacter_3');
    // Legacy multi-map body placements collapse to the first map Token.
    expect(tokC.hasPlacement('gameTable') || tokC.hasPlacement('gameTable_clue2d')).toBeTrue();

    const link = ObjectStore.instance.get<ClueLink>('battleClueLink_1');
    expect(link).toBeTruthy();
    expect(link.tableIdentifier).toBe('gameTable');
    expect(link.fromIdentifier).toBe(CharacterToken.legacyTokenId('testCharacter_3'));
    expect(link.toIdentifier).toBe(CharacterToken.legacyTokenId('testCharacter_1'));
  });
});

/** Inline fallback so the spec runs without raw-loader. */
const BNZ_GOLDEN_INLINE = `<?xml version="1.0" encoding="UTF-8"?>
<room syncId="golden_bnz_room">
  <game-table name="Battle" width="20" height="15" selected="true" is2DMode="false" syncId="gameTable"/>
  <game-table name="Clue" width="31" height="17" selected="false" is2DMode="true" syncId="gameTable_clue2d"/>
  <character location.name="table" location.x="250" location.y="450" posZ="0" tableIdentifier="gameTable" tablePlacements="{&quot;gameTable&quot;:{&quot;x&quot;:250,&quot;y&quot;:450,&quot;posZ&quot;:0}}" syncId="testCharacter_1">
    <data name="character" syncId="character_testCharacter_1">
      <data name="image" syncId="image_testCharacter_1"><data type="image" name="imageIdentifier" syncId="imageIdentifier_testCharacter_1"/></data>
      <data name="common" syncId="common_testCharacter_1">
        <data name="name" syncId="name_testCharacter_1">A</data>
        <data name="size" syncId="size_testCharacter_1">1</data>
        <data name="height" syncId="height_testCharacter_1">0</data>
        <data name="altitude" syncId="altitude_testCharacter_1">0</data>
      </data>
      <data name="detail" syncId="detail_testCharacter_1"/>
    </data>
  </character>
  <character pushPin="true" pushPinAngle="13" pushPinStyle="2" location.name="table" location.x="175" location.y="225" posZ="0" tableIdentifier="gameTable" tablePlacements="{&quot;gameTable&quot;:{&quot;x&quot;:175,&quot;y&quot;:225,&quot;posZ&quot;:0},&quot;gameTable_clue2d&quot;:{&quot;x&quot;:175,&quot;y&quot;:400,&quot;posZ&quot;:0}}" syncId="testCharacter_3">
    <data name="character" syncId="character_testCharacter_3">
      <data name="image" syncId="image_testCharacter_3"><data type="image" name="imageIdentifier" syncId="imageIdentifier_testCharacter_3"/></data>
      <data name="common" syncId="common_testCharacter_3">
        <data name="name" syncId="name_testCharacter_3">C</data>
        <data name="size" syncId="size_testCharacter_3">3</data>
        <data name="height" syncId="height_testCharacter_3">0</data>
        <data name="altitude" syncId="altitude_testCharacter_3">0</data>
      </data>
      <data name="detail" syncId="detail_testCharacter_3"/>
    </data>
  </character>
  <clue-link fromIdentifier="testCharacter_3" toIdentifier="testCharacter_1" sag="0.22" color="#c62828" tableIdentifier="gameTable" syncId="battleClueLink_1"/>
</room>`;
