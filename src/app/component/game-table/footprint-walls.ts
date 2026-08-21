import { GameTable } from '@udonarium/game-table';
import { GameTableMask } from '@udonarium/game-table-mask';
import { Terrain } from '@udonarium/terrain';

/** Minimal wall polyline used by lighting / FoW (same shadow path as TableWall). */
export interface WallPolyline {
  points: { x: number; y: number }[];
}

/** Axis-aligned or rotated rectangle corners → closed loop (4 edges as walls). */
export function rectToClosedWall(
  x: number,
  y: number,
  w: number,
  h: number,
  rotateDeg: number = 0,
): WallPolyline {
  let corners = [
    { x: x, y: y },
    { x: x + w, y: y },
    { x: x + w, y: y + h },
    { x: x, y: y + h },
  ];
  if (rotateDeg) {
    const rad = (rotateDeg * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    corners = corners.map(p => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    });
  }
  // Close the loop so lighting treats all four sides as wall segments.
  return { points: [...corners, corners[0]] };
}

/**
 * Map masks & terrains with affectsLight opted in: each footprint's four sides
 * act as walls for light and vision (same as scene-tool walls).
 * Default is off so floor/decor footprints do not seal LoS.
 */
export function collectFootprintWalls(
  table: GameTable,
  masks: GameTableMask[],
  terrains: Terrain[],
): WallPolyline[] {
  if (!table) return [];
  const grid = table.gridSize || 50;
  const out: WallPolyline[] = [];

  for (const mask of masks || []) {
    if (mask.location?.name !== 'table') continue;
    if (!mask.affectsLight) continue;
    const w = Math.max(1, (mask.width || 1) * grid);
    const h = Math.max(1, (mask.height || 1) * grid);
    out.push(rectToClosedWall(mask.location.x, mask.location.y, w, h));
  }
  for (const terrain of terrains || []) {
    if (terrain.location?.name !== 'table') continue;
    if (!terrain.affectsLight) continue;
    const w = Math.max(1, (terrain.width || 1) * grid);
    const d = Math.max(1, (terrain.depth || 1) * grid);
    out.push(rectToClosedWall(terrain.location.x, terrain.location.y, w, d, terrain.rotate || 0));
  }
  return out;
}
