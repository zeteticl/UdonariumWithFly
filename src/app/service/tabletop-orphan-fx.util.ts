import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { TableDrawing } from '@udonarium/table-fx/table-drawing';
import { TableLight } from '@udonarium/table-fx/table-light';
import { TableWall } from '@udonarium/table-fx/table-wall';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';

/**
 * Attach parent-less table FX nodes under a valid GameTable so Room.innerXml includes them.
 * Extracted from SaveDataService for unit coverage of the save-path orphan fix.
 */
export function reparentOrphanTableFx(): void {
  const tables = ObjectStore.instance.getObjects(GameTable);
  if (tables.length < 1) return;
  const fallback =
    TableSelecter.instance.viewTable
    || ObjectStore.instance.get<GameTable>(TableSelecter.instance.viewTableIdentifier)
    || tables[0];

  const resolveTable = (preferredId?: string): GameTable => {
    if (preferredId) {
      const t = ObjectStore.instance.get<GameTable>(preferredId);
      if (t) return t;
    }
    return fallback;
  };

  const reparent = (node: ObjectNode, preferredId?: string) => {
    if (!node || node.parent) return;
    const table = resolveTable(preferredId);
    if (table) table.appendChild(node);
  };

  for (const mask of ObjectStore.instance.getObjects(GameTableMask)) {
    if (mask.parent) continue;
    const tid = mask.tableIdentifier || mask.placementTableIds[0] || '';
    reparent(mask, tid);
  }
  for (const terrain of ObjectStore.instance.getObjects(Terrain)) {
    if (terrain.parent) continue;
    const tid = terrain.tableIdentifier || terrain.placementTableIds[0] || '';
    reparent(terrain, tid);
  }
  for (const wall of ObjectStore.instance.getObjects(TableWall)) {
    reparent(wall);
  }
  for (const light of ObjectStore.instance.getObjects(TableLight)) {
    reparent(light);
  }
  for (const drawing of ObjectStore.instance.getObjects(TableDrawing)) {
    reparent(drawing);
  }
}
