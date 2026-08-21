import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';
import { TabletopObject } from './tabletop-object';

type AliasName = string;

export interface Stackable extends TabletopObject {
  zindex: number;
}

/**
 * Shared [ ] paint-order peers at the same height (DOM + dense zindex + tiny translateZ).
 * Card / note / character / mask (+ card-stack). Range stays separate.
 */
export const LAYER_STACK_ALIASES: readonly AliasName[] = [
  'text-note',
  'card',
  'card-stack',
  'table-mask',
  'character',
  'character-token',
];

/**
 * Sort rank only (not stored as SyncVar floors).
 * Default paint order: desk < mask < character. Click stays in-tier until [ ] crosses.
 */
export const LAYER_TIER_RANK = {
  DESK: 0,
  MASK: 1,
  CHARACTER: 2,
} as const;

/** @deprecated Use LAYER_TIER_RANK — kept so old call sites compile during transition. */
export const LAYER_TIER = LAYER_TIER_RANK;

export function layerTierRank(aliasName: string): number {
  if (aliasName === 'character' || aliasName === 'character-token') return LAYER_TIER_RANK.CHARACTER;
  if (aliasName === 'table-mask') return LAYER_TIER_RANK.MASK;
  return LAYER_TIER_RANK.DESK;
}

/** @deprecated Use layerTierRank */
export function layerTierBase(aliasName: string): number {
  return layerTierRank(aliasName);
}

/** Write zindex; masks are table children (often no placements) so assign SyncVar directly when needed. */
function setStackableZindex(obj: Stackable, zindex: number) {
  if (obj.aliasName === 'table-mask') {
    if (obj.zindex === zindex) return;
    obj.zindex = zindex;
    return;
  }
  obj.mutateAppearance(() => { obj.zindex = zindex; });
}

function sortByZindex(a: Stackable, b: Stackable): number {
  return (a.zindex - b.zindex) || a.identifier.localeCompare(b.identifier);
}

function sortByTierThenZindex(a: Stackable, b: Stackable): number {
  return (layerTierRank(a.aliasName) - layerTierRank(b.aliasName))
    || (a.zindex - b.zindex)
    || a.identifier.localeCompare(b.identifier);
}

/** Assign dense 0..n-1 in current array order. @returns true if any value changed */
function densifyLayerOrder(objects: Stackable[]): boolean {
  let changed = false;
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].zindex === i) continue;
    setStackableZindex(objects[i], i);
    changed = true;
  }
  return changed;
}

function emitLayerChanged(toFront: boolean) {
  EventSystem.trigger('TABLETOP_LAYER_CHANGED', { toFront });
}

function collectLayerStackables(relative: AliasName = 'character', otherRelatives: AliasName[] = []): Stackable[] {
  const aliases = new Set<AliasName>([...LAYER_STACK_ALIASES, relative, ...otherRelatives]);
  let objects: Stackable[] = [];
  for (const aliasName of aliases) {
    objects = objects.concat(ObjectStore.instance.getObjects(aliasName) as Stackable[]);
  }
  return objects.filter(obj => obj && obj.isVisibleOnTable && typeof obj.zindex === 'number');
}

function ensureInList(objects: Stackable[], target: Stackable): Stackable[] | null {
  if (objects.some(o => o.identifier === target.identifier)) return objects;
  if (!target.isVisibleOnTable || typeof target.zindex !== 'number') return null;
  return objects.concat([target]);
}

function partitionByTier(objects: Stackable[]): { desk: Stackable[]; mask: Stackable[]; character: Stackable[] } {
  const desk: Stackable[] = [];
  const mask: Stackable[] = [];
  const character: Stackable[] = [];
  for (const o of objects) {
    const rank = layerTierRank(o.aliasName);
    if (rank === LAYER_TIER_RANK.CHARACTER) character.push(o);
    else if (rank === LAYER_TIER_RANK.MASK) mask.push(o);
    else desk.push(o);
  }
  return { desk, mask, character };
}

function raiseWithin(list: Stackable[], target: Stackable): Stackable[] {
  const rest = list.filter(o => o.identifier !== target.identifier);
  return rest.concat([target]);
}

/**
 * True when a lower-tier piece has been painted above a higher-tier piece (user used [ ]).
 * A brand-new higher-tier piece still at z=0 under densified peers is NOT manual — reconcile repairs it.
 */
export function isManualLayerOrder(objects?: Stackable[]): boolean {
  const list = objects ?? collectLayerStackables();
  const { desk, mask, character } = partitionByTier(list);
  const maxZ = (arr: Stackable[]) => (arr.length ? Math.max(...arr.map(o => o.zindex)) : -Infinity);
  const minZ = (arr: Stackable[]) => (arr.length ? Math.min(...arr.map(o => o.zindex)) : Infinity);

  // Desk above mask ⇒ crossed ( [ ] on a note/card ).
  if (desk.length && mask.length && maxZ(desk) > minZ(mask)) return true;

  // Desk above character ⇒ crossed only if that character already sat in/above the mask band
  // (not a fresh character still at z=0 under densified desks).
  if (desk.length && character.length && maxZ(desk) > minZ(character)) {
    if (mask.length) {
      const maskMin = minZ(mask);
      return desk.some(d =>
        character.some(c => d.zindex > c.zindex && c.zindex >= maskMin));
    }
    const deskMin = minZ(desk);
    return desk.some(d =>
      character.some(c => d.zindex > c.zindex && c.zindex > deskMin));
  }

  // Mask above character after [ ]: some character remains between desks and the top mask.
  if (mask.length && character.length && maxZ(mask) > minZ(character)) {
    const deskMax = maxZ(desk);
    return character.some(c => c.zindex > deskMax && c.zindex < maxZ(mask));
  }
  return false;
}

/** @deprecated Prefer !isManualLayerOrder() */
export function isDefaultLayerTiersIntact(objects?: Stackable[]): boolean {
  return !isManualLayerOrder(objects);
}

/**
 * If default hierarchy still holds, sort desk→mask→character and densify to 0..n-1.
 * After manual [ ], only densify current order (do not restore tiers).
 * Call after placing a new layer peer on the table.
 */
export function reconcileLayerStack(): boolean {
  let objects = collectLayerStackables();
  if (!objects.length) return false;
  if (!isManualLayerOrder(objects)) {
    objects = objects.slice().sort(sortByTierThenZindex);
  } else {
    objects = objects.slice().sort(sortByZindex);
  }
  const changed = densifyLayerOrder(objects);
  if (changed) emitLayerChanged(true);
  return changed;
}

/**
 * Keyboard ] : raise across all layer peers (may put a note above a token).
 * Always densifies to 0..n-1.
 */
export function moveToTopmost(topmost: Stackable, otherRelatives: AliasName[] = []): boolean {
  let objects = ensureInList(collectLayerStackables(topmost.aliasName, otherRelatives), topmost);
  if (!objects) return false;

  objects.sort(sortByZindex);
  const alreadyTop =
    objects[objects.length - 1].identifier === topmost.identifier
    && objects.filter(o => o.zindex === topmost.zindex).length === 1;
  if (alreadyTop) {
    const densified = densifyLayerOrder(objects);
    if (densified) emitLayerChanged(true);
    return densified;
  }

  objects = objects.filter(o => o.identifier !== topmost.identifier).concat([topmost]);
  const changed = densifyLayerOrder(objects);
  if (changed) emitLayerChanged(true);
  return changed;
}

/**
 * Keyboard [ : send back across all layer peers. Always densifies to 0..n-1.
 */
export function moveToBackmost(backmost: Stackable, otherRelatives: AliasName[] = []): boolean {
  let objects = ensureInList(collectLayerStackables(backmost.aliasName, otherRelatives), backmost);
  if (!objects) return false;

  objects.sort(sortByZindex);
  const alreadyBack =
    objects[0].identifier === backmost.identifier
    && objects.filter(o => o.zindex === backmost.zindex).length === 1;
  if (alreadyBack) {
    const densified = densifyLayerOrder(objects);
    if (densified) emitLayerChanged(false);
    return densified;
  }

  objects = [backmost].concat(objects.filter(o => o.identifier !== backmost.identifier));
  const changed = densifyLayerOrder(objects);
  if (changed) emitLayerChanged(false);
  return changed;
}

/**
 * Click / drag: raise within the same tier, then densify as desk→mask→character.
 * After [ ] has crossed tiers (manual), click does NOT change zindex — escalating to
 * moveToTopmost was yanking cards back to the absolute top and undoing [ ].
 * Use keyboard [ ] to reorder once the stack is manual.
 */
export function moveToTopmostInTier(topmost: Stackable): boolean {
  let objects = ensureInList(collectLayerStackables(topmost.aliasName, []), topmost);
  if (!objects) return false;

  if (isManualLayerOrder(objects)) return false;

  const rank = layerTierRank(topmost.aliasName);
  const { desk, mask, character } = partitionByTier(objects);
  const sortTier = (list: Stackable[]) => list.slice().sort(sortByZindex);

  let nextDesk = sortTier(desk);
  let nextMask = sortTier(mask);
  let nextChar = sortTier(character);
  if (rank === LAYER_TIER_RANK.DESK) nextDesk = raiseWithin(nextDesk, topmost);
  else if (rank === LAYER_TIER_RANK.MASK) nextMask = raiseWithin(nextMask, topmost);
  else nextChar = raiseWithin(nextChar, topmost);

  const ordered = nextDesk.concat(nextMask, nextChar);
  const changed = densifyLayerOrder(ordered);
  if (changed) emitLayerChanged(true);
  return changed;
}

/**
 * Identical base lift for card / note / mask / character (and stacks).
 * Unequal *base* offsets make one type always win hit-tests under preserve-3d.
 */
export const LAYER_PEER_MOVABLE_Z_PX = 0.15;

export function layerPeerMovableTransform(): string {
  return `translateZ(${LAYER_PEER_MOVABLE_Z_PX}px)`;
}

/**
 * Extra translateZ per dense zindex so 3D paint/hit follow [ ] without reordering DOM
 * (DOM reorder made every token flash). Keep the step tiny — large steps shifted
 * 2D yarn pin tips when projecting getBoundingClientRect.
 * Cap keeps corkboard peers under clueStringsZ (~gridHeight+2.2) and below pin (+4px).
 */
export const STACK_TRANSLATE_Z_STEP_PX = 0.02;
/** Max peer stack lift so photo < yarn (~2.2) < pin (+4). */
export const STACK_TRANSLATE_Z_MAX_PX = 1.5;

export function stackTranslateZPx(zindex: number | null | undefined): number {
  if (typeof zindex !== 'number' || !Number.isFinite(zindex) || zindex <= 0) return 0;
  return Math.min(zindex * STACK_TRANSLATE_Z_STEP_PX, STACK_TRANSLATE_Z_MAX_PX);
}

/** Layers that participate in shared [ ] peer lift (not dice etc.). */
export const LAYER_PEER_ALIASES = new Set([
  'character',
  'character-token',
  'card',
  'card-stack',
  'text-note',
  'table-mask',
  'range',
]);
