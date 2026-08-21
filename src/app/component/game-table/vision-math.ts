import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { Terrain } from '@udonarium/terrain';

import { collectFootprintWalls, WallPolyline } from './footprint-walls';

/** Minimal table actor for FoW / lighting (GameCharacter or CharacterToken). */
export interface VisionLightActor {
  identifier: string;
  location: { x: number; y: number };
  size: number;
  visionRangeGrid: number;
  brightLightGrid: number;
  dimLightGrid: number;
}

/** Foundry-style: GI on unless darkness meets/exceeds optional threshold. */
export function isGlobalIlluminationActive(table: GameTable): boolean {
  if (!table?.globalIlluminationEnabled) return false;
  const threshold = table.globalIlluminationThreshold;
  if (threshold == null || threshold < 0) return true;
  const darkness = Math.max(0, Math.min(1, table.darkness ?? 0));
  return darkness < threshold;
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const den = abx * cdy - aby * cdx;
  if (Math.abs(den) < 1e-9) return false;
  const acx = cx - ax;
  const acy = cy - ay;
  const t = (acx * cdy - acy * cdx) / den;
  const u = (acx * aby - acy * abx) / den;
  return t > 0.001 && t < 0.999 && u >= 0 && u <= 1;
}

export function isLineBlockedByWalls(
  x0: number, y0: number, x1: number, y1: number,
  walls: WallPolyline[],
): boolean {
  for (const wall of walls || []) {
    const pts = wall.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      if (segmentsIntersect(x0, y0, x1, y1, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)) {
        return true;
      }
    }
  }
  return false;
}

function charCenter(ch: VisionLightActor, grid: number): { x: number; y: number } {
  return {
    x: ch.location.x + (ch.size * grid) / 2,
    y: ch.location.y + (ch.size * grid) / 2,
  };
}

function visionAndLightWalls(
  table: GameTable,
  masks?: GameTableMask[],
  terrains?: Terrain[],
): { vision: WallPolyline[]; light: WallPolyline[] } {
  const fp = collectFootprintWalls(table, masks || table?.masks || [], terrains || table?.terrains || []);
  return {
    vision: [...(table.walls || []).filter(w => w.blocksVision), ...fp],
    light: [...(table.walls || []).filter(w => w.blocksLight), ...fp],
  };
}

/** Whether a table point is currently revealed to the local player under FoW rules. */
export function isPointRevealedToViewer(
  x: number,
  y: number,
  table: GameTable,
  visionCharacters: VisionLightActor[],
  lightCharacters: VisionLightActor[],
  masks?: GameTableMask[],
  terrains?: Terrain[],
): boolean {
  if (!table?.visionEnabled) return true;
  if (!visionCharacters?.length) return false;

  const grid = table.gridSize || 50;
  const { vision: wallsVision, light: wallsLight } = visionAndLightWalls(table, masks, terrains);
  const gi = isGlobalIlluminationActive(table);
  const darkness = Math.max(0, Math.min(1, table.darkness ?? 0));

  let inVision = false;
  for (const ch of visionCharacters) {
    const c = charCenter(ch, grid);
    const visionR = Math.max(0, ch.visionRangeGrid * grid);
    if (visionR <= 0) continue;
    if (Math.hypot(x - c.x, y - c.y) > visionR) continue;
    if (isLineBlockedByWalls(c.x, c.y, x, y, wallsVision)) continue;
    inVision = true;
    break;
  }
  if (!inVision) return false;
  if (gi) return true;

  // GI off: must also be illuminated by a light source.
  for (const light of table.lights || []) {
    if (!light.isActiveAtDarkness(darkness)) continue;
    const r = Math.max(light.dimRadius, light.brightRadius, 0);
    if (r <= 0) continue;
    if (Math.hypot(x - light.x, y - light.y) > r) continue;
    if (isLineBlockedByWalls(light.x, light.y, x, y, wallsLight)) continue;
    return true;
  }
  for (const ch of lightCharacters || []) {
    const dimR = ch.dimLightGrid * grid;
    if (dimR <= 0) continue;
    const c = charCenter(ch, grid);
    if (Math.hypot(x - c.x, y - c.y) > dimR) continue;
    if (isLineBlockedByWalls(c.x, c.y, x, y, wallsLight)) continue;
    return true;
  }
  return false;
}

export function isCharacterRevealedToViewer(
  target: VisionLightActor & { providesVisionTo?(userId: string): boolean },
  table: GameTable,
  visionCharacters: VisionLightActor[],
  lightCharacters: VisionLightActor[],
  viewerUserId: string,
  masks?: GameTableMask[],
  terrains?: Terrain[],
): boolean {
  if (!table?.visionEnabled) return true;
  if (target.providesVisionTo?.(viewerUserId)) return true;
  const grid = table.gridSize || 50;
  const c = charCenter(target, grid);
  return isPointRevealedToViewer(c.x, c.y, table, visionCharacters, lightCharacters, masks, terrains);
}
