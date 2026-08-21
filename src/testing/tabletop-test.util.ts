import { Card, CardState } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { CharacterToken } from '@udonarium/character-token';
import { ClueLink } from '@udonarium/clue-link';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { DiceSymbol, DiceType } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { RangeArea } from '@udonarium/range';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';
import { Terrain } from '@udonarium/terrain';

/** Destroy tabletop-related objects between specs (ObjectStore is a process singleton). */
export function resetTabletopStore(): void {
  // Product default: bodies never sit on the table. Specs that still exercise
  // GameCharacter TabletopObject placement APIs must opt in explicitly.
  GameCharacter.allowLegacyBodyOnTable = false;
  const destroyAll = (list: { destroy(): void }[]) => {
    for (const o of [...list]) {
      try { o.destroy(); } catch { /* ignore */ }
    }
  };
  // Cover every TabletopObject subclass — leftovers change repairOrphan 1:1 pairing.
  destroyAll(ObjectStore.instance.getObjects(ClueLink));
  destroyAll(ObjectStore.instance.getObjects(CharacterToken));
  destroyAll(ObjectStore.instance.getObjects(GameCharacter));
  destroyAll(ObjectStore.instance.getObjects(TextNote));
  destroyAll(ObjectStore.instance.getObjects(Terrain));
  destroyAll(ObjectStore.instance.getObjects(CardStack));
  destroyAll(ObjectStore.instance.getObjects(Card));
  destroyAll(ObjectStore.instance.getObjects(DiceSymbol));
  destroyAll(ObjectStore.instance.getObjects(GameTableMask));
  destroyAll(ObjectStore.instance.getObjects(RangeArea));
  destroyAll(TabletopObject.getAll());
  destroyAll(ObjectStore.instance.getObjects(GameTable));
  ObjectStore.instance.clearDeleteHistory();
  TableSelecter.instance.prepareForRoomReload();
}

export function makeTable(id: string, name = id): GameTable {
  const table = new GameTable(id);
  table.name = name;
  table.initialize();
  return table;
}

export function makeCharacter(id: string, name = id, size = 1): GameCharacter {
  const ch = new GameCharacter(id);
  (ch as any).createDataElements();
  ch.initialize();
  ch.createTestGameDataElement(name, size, '');
  return ch;
}

/** Place a CharacterToken for a body on the given (or current) map. */
export function makeToken(
  body: GameCharacter,
  pose: { x?: number; y?: number; posZ?: number } = {},
  tableId?: string,
  opts?: { temporary?: boolean; major?: boolean; identifier?: string }
): CharacterToken {
  return CharacterToken.create(body.identifier, pose, {
    tableId,
    temporary: opts?.temporary,
    major: opts?.major,
    identifier: opts?.identifier,
    copyAppearanceFrom: body,
  });
}

export function makeTextNote(id: string, title = id): TextNote {
  return TextNote.create(title, 'body', 14, 2, 2, id);
}

export function makeTerrain(id: string, name = id): Terrain {
  return Terrain.create(name, 2, 2, 1, '', '', id);
}

export function makeCard(id: string, name = id): Card {
  const card = Card.create(name, '', '', 2, id);
  card.state = CardState.FRONT;
  return card;
}

export function makeDice(id: string, name = id): DiceSymbol {
  return DiceSymbol.create(name, DiceType.D6, 1, id);
}

export function makeMask(id: string, name = id): GameTableMask {
  return GameTableMask.create(name, 2, 2, 0.5, id);
}

export function viewTables(activeId: string, viewedId = activeId): void {
  const sel = TableSelecter.instance;
  sel.viewTableIdentifier = activeId;
  sel.viewedTableIdentifier = viewedId;
}
