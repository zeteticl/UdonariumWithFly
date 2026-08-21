import { GameTable } from '@udonarium/game-table';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { TableSelecter } from '@udonarium/table-selecter';
import { Terrain } from '@udonarium/terrain';
import {
  assembleBakeGroupAt,
  placeTerrainAt,
} from '@udonarium/terrain-model/bake-group';
import {
  createDevModelLayoutCursor,
  placeDevModelAndAdvance,
} from '@udonarium/terrain-model/dev-3dmodel-layout';
import { footprintDebug } from '@udonarium/terrain-model/footprint-debug';
import { expandModelDropFiles } from '@udonarium/terrain-model/model-package-files';
import { importModelAsTerrain } from '@udonarium/terrain-model/model-terrain-import';

import { DEFAULT_TABLE_3D_ID } from './default-room.ids';

const MANIFEST_URL = '/dev-3dmodel/manifest.json';
const GAP_PX = 25;
const MARGIN_PX = 25;

let started = false;

type Dev3dManifest = { files?: string[] };

/**
 * Dev-only: fetch zips/glTFs from the ng-serve /dev-3dmodel proxy and line them up
 * on the first 3D map. Does not block the UI; errors are logged.
 *
 * Multi-box bake groups keep their modeled footprint (U/L); only whole models
 * are packed into the next free slot (never 一字排 the parts).
 */
export async function seedDev3dModelsOnFirstMap(): Promise<void> {
  if (started) return;
  started = true;

  let names: string[];
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as Dev3dManifest;
    names = (json.files || []).filter(n => typeof n === 'string' && n.length > 0);
  } catch (err) {
    console.warn('[dev-3dmodel] manifest unavailable', err);
    return;
  }
  if (!names.length) return;

  const table = ObjectStore.instance.get<GameTable>(DEFAULT_TABLE_3D_ID);
  if (!table) {
    console.warn('[dev-3dmodel] first map not found');
    return;
  }

  const prevView = TableSelecter.instance.viewTableIdentifier;
  TableSelecter.instance.viewTableIdentifier = DEFAULT_TABLE_3D_ID;
  TableSelecter.instance.viewedTableIdentifier = DEFAULT_TABLE_3D_ID;

  const grid = table.gridSize || 50;
  const tableWidthPx = (table.width || 20) * grid;
  const cursor = createDevModelLayoutCursor(MARGIN_PX);

  footprintDebug('devSeed start', { names, tableWidthPx, grid });

  for (const name of names) {
    try {
      await importOneDevModel(name, cursor, tableWidthPx, grid);
    } catch (err) {
      console.warn('[dev-3dmodel] skip', name, err);
    }
    await yieldToUi();
  }

  if (prevView) TableSelecter.instance.viewTableIdentifier = prevView;
  footprintDebug('devSeed done');
}

async function importOneDevModel(
  name: string,
  cursor: ReturnType<typeof createDevModelLayoutCursor>,
  tableWidthPx: number,
  grid: number,
): Promise<void> {
  console.info('[dev-3dmodel] importing', name);
  const res = await fetch(`/dev-3dmodel/${encodeURIComponent(name)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const type = name.toLowerCase().endsWith('.zip') ? 'application/zip' : blob.type || 'application/octet-stream';
  const file = new File([blob], name, { type });
  const files = await expandModelDropFiles([file]);
  const label = name.replace(/\.(zip|glb|gltf)$/i, '');
  const { terrains } = await importModelAsTerrain(files, { x: 0, y: 0, z: 0 }, { name: label });
  if (!terrains.length) return;

  const groupId = terrains[0].bakeGroupId;
  const isBakeGroup = terrains.length > 1 && !!groupId
    && terrains.every(t => t.bakeGroupId === groupId);

  if (isBakeGroup) {
    placeBakeGroupInNextSlot(terrains, cursor, tableWidthPx, grid);
  } else {
    for (const terrain of terrains) {
      const widthPx = Math.max(1, (terrain.width || 1) * grid);
      const depthPx = Math.max(1, (terrain.depth || 1) * grid);
      const pos = placeDevModelAndAdvance(cursor, widthPx, depthPx, tableWidthPx, GAP_PX, MARGIN_PX);
      placeTerrainAt(terrain, pos.x, pos.y, 0);
      terrain.moveToTableOnly(DEFAULT_TABLE_3D_ID);
    }
  }

  footprintDebug('devSeed placed', {
    name,
    isBakeGroup,
    n: terrains.length,
    parts: terrains.map(t => ({
      name: t.name,
      location: { ...t.location },
      pose: t.getPoseForView(),
      w: t.width,
      d: t.depth,
    })),
    poseYSpan: (() => {
      const ys = terrains.map(t => t.getPoseForView().y);
      return +(Math.max(...ys) - Math.min(...ys)).toFixed(2);
    })(),
  });
}

/** Pack one multi-box model as a single footprint; keep relative U/L offsets. */
function placeBakeGroupInNextSlot(
  terrains: Terrain[],
  cursor: ReturnType<typeof createDevModelLayoutCursor>,
  tableWidthPx: number,
  grid: number,
): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of terrains) {
    const x = t.location?.x ?? 0;
    const y = t.location?.y ?? 0;
    const w = Math.max(0.1, t.width || 1) * grid;
    const d = Math.max(0.1, t.depth || 1) * grid;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + d > maxY) maxY = y + d;
  }
  const widthPx = Math.max(1, maxX - minX);
  const depthPx = Math.max(1, maxY - minY);
  const pos = placeDevModelAndAdvance(cursor, widthPx, depthPx, tableWidthPx, GAP_PX, MARGIN_PX);
  const center = {
    x: pos.x + widthPx / 2,
    y: pos.y + depthPx / 2,
    z: 0,
  };
  footprintDebug('devSeed bakeGroup slot', {
    pos,
    widthPx: +widthPx.toFixed(1),
    depthPx: +depthPx.toFixed(1),
    center,
  });
  assembleBakeGroupAt(terrains, center);
  for (const t of terrains) {
    t.moveToTableOnly(DEFAULT_TABLE_3D_ID);
  }
}

function yieldToUi(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
