/**
 * Diagnostics for folder-backup room load / token visibility.
 * Filter DevTools console by: FolderBackup
 * Set FOLDER_BACKUP_DEBUG = false to silence.
 */
export const FOLDER_BACKUP_DEBUG = false;

export function folderBackupDebug(tag: string, data?: Record<string, unknown>) {
  if (!FOLDER_BACKUP_DEBUG) return;
  const ts = Date.now();
  // Always stringify so pasted console logs include nested fields (Chrome collapses objects as …).
  if (data !== undefined) {
    try {
      console.log(`[FolderBackup] ${tag} ${JSON.stringify({ t: ts, ...data })}`);
    } catch {
      console.log(`[FolderBackup] ${tag}`, { t: ts, ...data });
    }
  } else {
    console.log(`[FolderBackup] ${tag}`, { t: ts });
  }
}

export function folderBackupWarn(tag: string, data?: Record<string, unknown>) {
  if (!FOLDER_BACKUP_DEBUG) return;
  const ts = Date.now();
  if (data !== undefined) {
    try {
      console.warn(`[FolderBackup] ${tag} ${JSON.stringify({ t: ts, ...data })}`);
    } catch {
      console.warn(`[FolderBackup] ${tag}`, { t: ts, ...data });
    }
  } else {
    console.warn(`[FolderBackup] ${tag}`, { t: ts });
  }
}

/** Compact placement snapshot for map-switch / dual-map diagnosis. */
export interface CharPlacementSnap {
  name: string;
  id: string;
  maps: string[];
  dual: boolean;
  onFrom: boolean;
  onTo: boolean;
  survivor: boolean;
  live: string;
  poseFrom: string;
  poseTo: string;
  loaded: boolean;
}

export interface CharPlacementLike {
  name?: string;
  identifier: string;
  location?: { name?: string; x?: number; y?: number };
  posZ?: number;
  isLoaded?: boolean;
  placementTableIds: string[];
  hasPlacement(tableId: string): boolean;
  getPoseForTable(tableId: string): { x: number; y: number; posZ: number } | null;
}

/** Summarize which tabletop chars survive a from→to view switch (dual-map focus). */
export function summarizeCharPlacements(
  chars: CharPlacementLike[],
  fromId: string,
  toId: string,
  limit = 16,
): { total: number; dual: number; survivors: number; enter: number; leave: number; samples: string[] } {
  const snaps: CharPlacementSnap[] = [];
  let dual = 0;
  let survivors = 0;
  let enter = 0;
  let leave = 0;
  for (const c of chars) {
    if (!c || c.location?.name !== 'table') continue;
    const maps = c.placementTableIds || [];
    const onFrom = !!(fromId && c.hasPlacement(fromId));
    const onTo = !!(toId && c.hasPlacement(toId));
    const isDual = maps.length > 1;
    if (isDual) dual++;
    if (onFrom && onTo) survivors++;
    if (!onFrom && onTo) enter++;
    if (onFrom && !onTo) leave++;
    if (snaps.length >= limit) continue;
    // Prefer dual / transition tokens in the sample list.
    if (!isDual && !(onFrom !== onTo)) continue;
    const pf = fromId ? c.getPoseForTable(fromId) : null;
    const pt = toId ? c.getPoseForTable(toId) : null;
    snaps.push({
      name: c.name || '',
      id: c.identifier.slice(0, 10),
      maps: maps.map(m => m.slice(0, 14)),
      dual: isDual,
      onFrom,
      onTo,
      survivor: onFrom && onTo,
      live: `${c.location?.x | 0},${c.location?.y | 0},${c.posZ | 0}`,
      poseFrom: pf ? `${pf.x | 0},${pf.y | 0},${pf.posZ | 0}` : '-',
      poseTo: pt ? `${pt.x | 0},${pt.y | 0},${pt.posZ | 0}` : '-',
      loaded: !!c.isLoaded,
    });
  }
  // If few dual/transition, fill with onTo tokens.
  if (snaps.length < Math.min(8, limit)) {
    for (const c of chars) {
      if (snaps.length >= limit) break;
      if (!c || c.location?.name !== 'table') continue;
      if (toId && !c.hasPlacement(toId)) continue;
      if (snaps.some(s => s.id === c.identifier.slice(0, 10))) continue;
      const maps = c.placementTableIds || [];
      const pf = fromId ? c.getPoseForTable(fromId) : null;
      const pt = toId ? c.getPoseForTable(toId) : null;
      snaps.push({
        name: c.name || '',
        id: c.identifier.slice(0, 10),
        maps: maps.map(m => m.slice(0, 14)),
        dual: maps.length > 1,
        onFrom: !!(fromId && c.hasPlacement(fromId)),
        onTo: !!(toId && c.hasPlacement(toId)),
        survivor: !!(fromId && toId && c.hasPlacement(fromId) && c.hasPlacement(toId)),
        live: `${c.location?.x | 0},${c.location?.y | 0},${c.posZ | 0}`,
        poseFrom: pf ? `${pf.x | 0},${pf.y | 0},${pf.posZ | 0}` : '-',
        poseTo: pt ? `${pt.x | 0},${pt.y | 0},${pt.posZ | 0}` : '-',
        loaded: !!c.isLoaded,
      });
    }
  }
  return {
    total: chars.filter(c => c?.location?.name === 'table').length,
    dual,
    survivors,
    enter,
    leave,
    samples: snaps.map(s =>
      `${s.name}|${s.id}|maps=${s.maps.join('+')}|surv=${s.survivor}|` +
      `from=${s.poseFrom}|to=${s.poseTo}|live=${s.live}|load=${s.loaded}`
    ),
  };
}

/** Parse CSS matrix/matrix3d scale approx (1 = normal, ~0 = bounce stuck). */
export function approxCssScale(transform: string): number {
  if (!transform || transform === 'none') return 1;
  try {
    if (transform.startsWith('matrix3d(')) {
      const p = transform.slice(9, -1).split(',').map(s => parseFloat(s.trim()));
      // m00, m11
      return Math.max(Math.abs(p[0] || 0), Math.abs(p[5] || 0));
    }
    if (transform.startsWith('matrix(')) {
      const p = transform.slice(7, -1).split(',').map(s => parseFloat(s.trim()));
      return Math.max(Math.abs(p[0] || 0), Math.abs(p[3] || 0));
    }
    const m = /scale3d\(\s*([\d.eE+-]+)/.exec(transform) || /scale\(\s*([\d.eE+-]+)/.exec(transform);
    if (m) return Math.abs(parseFloat(m[1]));
  } catch { /* ignore */ }
  return 1;
}

export type TokenHideReason =
  | 'ok'
  | 'not-in-dom'
  | 'owner-hidden'
  | 'no-placement'
  | 'not-loaded'
  | 'fow-hidden'
  | 'scale0'
  | 'offscreen'
  | 'zero-size'
  | 'no-image'
  | 'visibility-hidden'
  | 'display-none'
  | 'opacity0'
  | 'flat2d-mismatch';

export interface TokenDomProbe {
  id: string;
  name: string;
  reasons: TokenHideReason[];
  display: string;
  visibility: string;
  opacity: string;
  hostTf: string;
  innerTf: string;
  innerScale: number;
  rect: string;
  imgW: number;
  imgOk: boolean;
  inViewport: boolean;
  movableTf: string;
  dataLive: string;
  dataPose: string;
  isLoaded: boolean;
  isVisible: boolean;
  isVisibleOnTable: boolean;
  fowOk: boolean;
  placements: string;
  dualMap?: boolean;
  /** True when `.upright-transform` still has `is-flat-2d` (stuck after 2D→3D switch). */
  flat2d?: boolean;
  uprightTf?: string;
}
