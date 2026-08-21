import { GameTableMask } from '@udonarium/game-table-mask';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';

const GRID = 50;

export type MaskOverlapPiece = TabletopObject & { size?: number };

/** Same view/active table check for mask ↔ character / token. */
export function sameTableForMask(ch: TabletopObject, mask: GameTableMask): boolean {
  if (!ch || !mask) return false;
  if (ch.location.name !== 'table' || mask.location.name !== 'table') return false;
  const viewId = TableSelecter.instance.viewTable?.identifier || '';
  const maskTable = mask.tableIdentifier || viewId;
  if (!maskTable) return true;
  if (typeof ch.hasPlacement === 'function' && ch.hasPlacement(maskTable)) return true;
  if (ch.tableIdentifier && ch.tableIdentifier === maskTable) return true;
  if (!ch.tableIdentifier && !mask.tableIdentifier) return true;
  return ch.tableIdentifier === mask.tableIdentifier;
}

/** Axis-aligned overlap in table pixels (grid size 50). */
export function isCharacterOnMask(ch: MaskOverlapPiece, mask: GameTableMask, gridSize: number = GRID): boolean {
  if (!sameTableForMask(ch, mask)) return false;
  const poseCh = ch.getPoseForView();
  const poseMask = mask.getPoseForView();
  const cx = poseCh.x;
  const cy = poseCh.y;
  const cs = Math.max(0.5, Number(ch.size) || 1) * gridSize;
  const mx = poseMask.x;
  const my = poseMask.y;
  const mw = Math.max(0.5, Number(mask.width) || 1) * gridSize;
  const mh = Math.max(0.5, Number(mask.height) || 1) * gridSize;
  return !(cx + cs <= mx || mx + mw <= cx || cy + cs <= my || my + mh <= cy);
}

/** Pieces whose footprint overlaps the mask (CharacterToken or legacy body). */
export function charactersOnMask<T extends MaskOverlapPiece>(
  characters: T[],
  mask: GameTableMask,
  gridSize: number = GRID,
): T[] {
  if (!mask || !characters?.length) return [];
  return characters.filter(ch => isCharacterOnMask(ch, mask, gridSize));
}

/** Prefer highest posZ when multiple passive masks cover a token. */
export function pickTopPassiveMask(masks: GameTableMask[], ch: TabletopObject & { size?: number }): GameTableMask | null {
  let best: GameTableMask = null;
  let bestZ = -Infinity;
  for (const mask of masks) {
    if (!mask?.tokenFxPassive) continue;
    if (!isCharacterOnMask(ch, mask)) continue;
    const z = Number(mask.posZ) || 0;
    if (!best || z >= bestZ) {
      best = mask;
      bestZ = z;
    }
  }
  return best;
}
