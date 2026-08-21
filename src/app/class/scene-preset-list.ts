import { SyncObject } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { Jukebox } from './Jukebox';
import { PeerCursor } from './peer-cursor';
import { TableSelecter } from './table-selecter';
import { ChatTab } from './chat-tab';
import { ChatTabList } from './chat-tab-list';
import { SceneObjectSnap, ScenePreset, SceneTabletopSnap, resolveScenePresetTable } from './scene-preset';
import { captureMapPreviewDataUrl } from './scene-preset-preview';
import { StringUtil } from './core/system/util/string-util';
import { translate } from 'i18n';
import { TabletopLocation, TabletopObject } from './tabletop-object';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { MovableDirective } from 'directive/movable.directive';
import { RotableSelectionSynchronizer } from 'directive/rotable-selection-synchronizer';

export interface ScenePresetApplyOptions {
  skipBgm?: boolean;
  skipText?: boolean;
  skipTabletop?: boolean;
  /**
   * Keep currently visible tokens: switch map / restore atmosphere, but do not apply
   * token poses from the snapshot. Visible tokens are re-stamped onto the target map;
   * other characters are removed from the target map only.
   */
  skipTokens?: boolean;
  chatTab?: ChatTab;
}

interface PendingPose {
  obj: TabletopObject;
  x: number;
  y: number;
  posZ: number;
  rotate?: number;
}

@SyncObject('scene-preset-list')
export class ScenePresetList extends ObjectNode implements InnerXml {
  private static _instance: ScenePresetList;
  static get instance(): ScenePresetList {
    if (!ScenePresetList._instance) {
      ScenePresetList._instance = new ScenePresetList('ScenePresetList');
      ScenePresetList._instance.initialize();
    }
    return ScenePresetList._instance;
  }

  get presets(): ScenePreset[] { return this.children as ScenePreset[]; }

  addPreset(preset: ScenePreset): ScenePreset
  addPreset(title?: string): ScenePreset
  addPreset(...args: any[]): ScenePreset {
    let preset: ScenePreset = null;
    if (args[0] instanceof ScenePreset) {
      preset = args[0];
    } else {
      preset = new ScenePreset();
      preset.title = (typeof args[0] === 'string' && args[0]) ? args[0] : translate('scenePreset.defaultTitle');
      preset.initialize();
    }
    return this.appendChild(preset);
  }

  createFromCurrent(title?: string): ScenePreset {
    const preset = this.addPreset(title);
    void this.writeSnapshot(preset);
    return preset;
  }

  /** Create preset and wait for snapshot + map preview. */
  async createFromCurrentAsync(title?: string): Promise<ScenePreset> {
    const preset = this.addPreset(title);
    await this.writeSnapshot(preset);
    return preset;
  }

  async writeSnapshot(preset: ScenePreset): Promise<void> {
    const table = TableSelecter.instance.viewTable;
    const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
    preset.tableIdentifier = table ? table.identifier : '';
    preset.tracksJson = jukebox ? jukebox.snapshotTracksJson() : '';
    preset.savedAt = Date.now();
    const snap = this.captureTabletopSnap(table);
    preset.tabletopJson = JSON.stringify(snap);
    try {
      const preview = await captureMapPreviewDataUrl();
      if (preview) preset.previewJpeg = preview;
    } catch (e) {
      console.warn('[ScenePreset] preview capture skipped', e);
    }
  }

  applyPreset(preset: ScenePreset, options: ScenePresetApplyOptions = {}): boolean {
    if (!preset || Network.GuestMode()) return false;

    const table = this.resolvePresetTable(preset);
    if (!table) return false;
    if (preset.tableIdentifier !== table.identifier) {
      preset.tableIdentifier = table.identifier;
    }

    // Capture BEFORE map switch — screen positions of currently visible tokens.
    const keptTokens = options.skipTokens ? this.captureVisibleTokenPoses() : null;
    const keptTokenIds = keptTokens
      ? new Set(keptTokens.map(p => p.obj.identifier))
      : null;

    // Must be sync — EventSystem.call(..., peerId) is queued and apply would hit the old map.
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier: table.identifier });

    if (!options.skipBgm) {
      const jukebox = ObjectStore.instance.get<Jukebox>('Jukebox');
      if (jukebox) jukebox.applyTracksSnapshot(preset.tracksJson || '');
    }

    if (!options.skipTabletop) {
      this.applyTabletopSnap(preset, table, options, keptTokenIds);
    }

    if (keptTokens) {
      this.applyKeptTokenPoses(table.identifier, keptTokens);
    }

    if (!options.skipText && preset.switchText && preset.switchText.trim()) {
      const tab = options.chatTab || ChatTabList.instance.chatTabs[0];
      if (tab) {
        const name = PeerCursor.myCursor?.name || translate('chat.unnamedPlayer');
        tab.addMessage({
          from: Network.peer.userId,
          name: name,
          imageIdentifier: PeerCursor.myCursor?.imageIdentifier || '',
          timestamp: Date.now(),
          tag: 'system',
          text: StringUtil.cr(preset.switchText),
          color: PeerCursor.myCursor?.color || '',
        });
      }
    }

    return true;
  }

  /** Resolve bound table; fall back to snap table name after room reload. */
  resolvePresetTable(preset: ScenePreset): GameTable | null {
    return resolveScenePresetTable(preset);
  }

  /** Rebind presets after XML load (legacy rooms without syncId). */
  repairTableBindingsAfterLoad() {
    const tables = ObjectStore.instance.getObjects(GameTable);
    if (tables.length < 1) return;
    const validIds = new Set(tables.map(t => t.identifier));
    const orphanPresetIds = this.presets
      .map(p => p.tableIdentifier)
      .filter(id => !!id && !validIds.has(id));
    const remap = TabletopObject.repairOrphanedPieceBindings(orphanPresetIds);

    for (const preset of this.presets) {
      const tid = preset.tableIdentifier;
      if (tid && validIds.has(tid)) continue;
      if (tid && remap.has(tid)) {
        preset.tableIdentifier = remap.get(tid);
        continue;
      }
      const table = resolveScenePresetTable(preset);
      if (table) preset.tableIdentifier = table.identifier;
    }
  }

  private captureTabletopSnap(table: GameTable | null): SceneTabletopSnap {
    const snap: SceneTabletopSnap = { version: 1, pieces: [], tableChildren: [] };
    if (!table) return snap;

    const tableCtx = table.toContext();
    snap.tableSync = deepCopy(tableCtx.syncData);

    for (const child of table.children) {
      if (!(child instanceof GameObject)) continue;
      snap.tableChildren.push(this.captureObjectSnap(child));
    }

    const tableId = table.identifier;
    for (const obj of TabletopObject.getAll()) {
      if (obj.location.name !== 'table') continue;
      if (obj.parentIsAssigned && !obj.parentIsDestroyed) continue;
      if (obj.tableIdentifier && obj.tableIdentifier !== tableId) continue;
      if (!obj.tableIdentifier && TabletopObject.resolveViewTableIdentifier() !== tableId) continue;
      snap.pieces.push(this.captureObjectSnap(obj));
    }
    return snap;
  }

  private captureObjectSnap(obj: GameObject): SceneObjectSnap {
    const entry: SceneObjectSnap = {
      identifier: obj.identifier,
      aliasName: obj.aliasName,
      syncData: deepCopy(obj.toContext().syncData),
    };
    if (obj instanceof TabletopObject) {
      entry.x = toNum(obj.location.x);
      entry.y = toNum(obj.location.y);
      entry.posZ = toNum(obj.posZ);
      entry.locationName = obj.location.name || 'table';
      const rotate = (obj as any).rotate;
      if (typeof rotate === 'number' && !Number.isNaN(rotate)) entry.rotate = rotate;
    }
    const altitude = (obj as any).altitude;
    if (typeof altitude === 'number' && !Number.isNaN(altitude)) {
      entry.altitude = altitude;
    }
    return entry;
  }

  private applyTabletopSnap(
    preset: ScenePreset,
    table: GameTable,
    options: ScenePresetApplyOptions = {},
    keptTokenIds: Set<string> | null = null
  ) {
    const snap = preset.tabletopSnap;
    if (!snap || snap.version !== 1) {
      return;
    }

    const pendingPoses: PendingPose[] = [];

    if (snap.tableSync && typeof snap.tableSync === 'object') {
      const merged = deepCopy(snap.tableSync) as any;
      if (merged.attributes && typeof merged.attributes === 'object') {
        merged.attributes.selected = true;
      } else {
        merged.selected = true;
      }
      this.applyObjectSync(table, merged);
    }

    if (Array.isArray(snap.tableChildren)) {
      for (const childSnap of snap.tableChildren) {
        if (options.skipTokens && this.isTokenSnap(childSnap)) {
          continue;
        }
        const pose = this.applyObjectSnap(childSnap, table.identifier, options);
        if (pose) pendingPoses.push(pose);
      }
    }
    if (Array.isArray(snap.pieces)) {
      for (const pieceSnap of snap.pieces) {
        if (options.skipTokens && this.isTokenSnap(pieceSnap)) {
          continue;
        }
        const pose = this.applyObjectSnap(pieceSnap, table.identifier, options);
        if (pose) pendingPoses.push(pose);
      }
    }

    this.removeExtraPiecesFromTable(table.identifier, snap, options, keptTokenIds);

    this.flushPoseVisuals(pendingPoses);
    queueMicrotask(() => this.flushPoseVisuals(pendingPoses));
    setTimeout(() => this.flushPoseVisuals(pendingPoses), 50);
  }

  /**
   * Drop placements on {@param tableId} for objects not listed in the snapshot.
   * Keep-tokens: keep currently-visible characters (re-stamped next); remove other
   * characters from this map so target-map leftovers do not reappear after switch.
   */
  private removeExtraPiecesFromTable(
    tableId: string,
    snap: SceneTabletopSnap,
    options: ScenePresetApplyOptions,
    keptTokenIds: Set<string> | null = null
  ) {
    if (!tableId) return;
    const keepIds = new Set<string>();
    if (Array.isArray(snap.pieces)) {
      for (const p of snap.pieces) {
        if (p?.identifier) keepIds.add(p.identifier);
      }
    }
    if (Array.isArray(snap.tableChildren)) {
      for (const c of snap.tableChildren) {
        if (c?.identifier) keepIds.add(c.identifier);
      }
    }

    for (const obj of TabletopObject.getAll()) {
      if (obj.parentIsAssigned && !obj.parentIsDestroyed) continue;
      if (!this.isPieceOnTable(obj, tableId)) continue;

      if (options.skipTokens && this.isTokenObject(obj)) {
        if (keptTokenIds && keptTokenIds.has(obj.identifier)) {
          continue;
        }
        // Not in the pre-switch visible set — clear off this target map.
        obj.removeFromTable(tableId);
        continue;
      }

      if (keepIds.has(obj.identifier)) continue;
      obj.removeFromTable(tableId);
    }
  }

  /** Same binding rules as captureTabletopSnap for which pieces belong to a map. */
  private isPieceOnTable(obj: TabletopObject, tableId: string): boolean {
    if (obj.hasPlacement(tableId)) return true;
    if (obj.location.name !== 'table') return false;
    if (obj.tableIdentifier) return obj.tableIdentifier === tableId;
    return TabletopObject.resolveViewTableIdentifier() === tableId;
  }

  /** Character tokens on the table (not cards / dice / notes / ranges). */
  private isTokenSnap(entry: SceneObjectSnap): boolean {
    if (!entry) return false;
    if (entry.aliasName === CharacterToken.aliasName || entry.aliasName === 'character-token') return true;
    if (entry.aliasName === GameCharacter.aliasName || entry.aliasName === 'character') return true;
    if (!entry.identifier) return false;
    const obj = ObjectStore.instance.get(entry.identifier);
    return this.isTokenObject(obj);
  }

  private isTokenObject(obj: GameObject | null | undefined): boolean {
    if (!obj) return false;
    return obj instanceof CharacterToken
      || obj instanceof GameCharacter
      || obj.aliasName === 'character'
      || obj.aliasName === 'character-token';
  }

  /** Currently visible character tokens and their screen poses (before map switch). */
  private captureVisibleTokenPoses(): PendingPose[] {
    const kept: PendingPose[] = [];
    for (const tok of ObjectStore.instance.getObjects(CharacterToken) as CharacterToken[]) {
      if (!tok.isVisibleOnTable) continue;
      const pose = tok.getPoseForView();
      const entry: PendingPose = {
        obj: tok,
        x: toNum(pose.x),
        y: toNum(pose.y),
        posZ: toNum(pose.posZ),
      };
      if (typeof tok.rotate === 'number' && !Number.isNaN(tok.rotate)) {
        entry.rotate = tok.rotate;
      }
      kept.push(entry);
    }
    return kept;
  }

  /** Place kept visible tokens onto the target map at the captured screen poses. */
  private applyKeptTokenPoses(tableId: string, kept: PendingPose[]) {
    if (!tableId || kept.length < 1) return;
    const pending: PendingPose[] = [];
    for (const pose of kept) {
      const tok = ObjectStore.instance.get(pose.obj.identifier);
      if (!(tok instanceof CharacterToken) && !(tok instanceof GameCharacter)) continue;
      tok.addToTable(tableId, { x: pose.x, y: pose.y, posZ: pose.posZ }, false);
      if (pose.rotate != null) {
        try { tok.rotate = pose.rotate; } catch { /* optional */ }
      }
      pending.push({
        obj: tok,
        x: pose.x,
        y: pose.y,
        posZ: pose.posZ,
        rotate: pose.rotate,
      });
    }
    this.flushPoseVisuals(pending);
    queueMicrotask(() => this.flushPoseVisuals(pending));
    setTimeout(() => this.flushPoseVisuals(pending), 50);
  }

  private applyObjectSnap(
    entry: SceneObjectSnap,
    tableIdentifier: string,
    options: ScenePresetApplyOptions = {}
  ): PendingPose | null {
    if (!entry?.identifier || !entry.syncData) return null;
    const obj = ObjectStore.instance.get(entry.identifier);
    if (!obj) return null;
    if (options.skipTokens && this.isTokenObject(obj)) {
      return null;
    }
    const syncData = deepCopy(entry.syncData);
    this.applyObjectSync(obj, syncData);
    if (!(obj instanceof TabletopObject)) return null;

    obj.tableIdentifier = tableIdentifier;
    const pose = this.readPose(entry, syncData);
    if (pose) {
      // Mutate like undo — nested location.x does not go through SyncVar setter alone.
      obj.location.name = pose.locationName || obj.location.name || 'table';
      obj.location.x = pose.x;
      obj.location.y = pose.y;
      obj.posZ = pose.posZ;
      if (pose.rotate != null) {
        try { (obj as any).rotate = pose.rotate; } catch { /* optional */ }
      }
    }
    if (typeof entry.altitude === 'number') {
      try { obj.altitude = entry.altitude; } catch { /* optional */ }
    }
    if (!pose) return null;
    return { obj, x: pose.x, y: pose.y, posZ: pose.posZ, rotate: pose.rotate };
  }

  private applyObjectSync(obj: GameObject, syncData: Object) {
    const ctx = obj.toContext();
    ctx.syncData = syncData;
    obj.apply(ctx);
    obj.update();
  }

  private flushPoseVisuals(poses: PendingPose[]) {
    for (const pose of poses) {
      if (!ObjectStore.instance.get(pose.obj.identifier)) continue;
      MovableDirective.syncPoseFromUndo(pose.obj, pose.x, pose.y, pose.posZ);
      if (pose.rotate != null) {
        RotableSelectionSynchronizer.syncRotateFromUndo(pose.obj, pose.rotate);
      }
    }
  }

  private readPose(entry: SceneObjectSnap, syncData: any): {
    x: number; y: number; posZ: number; rotate?: number; locationName?: string;
  } | null {
    if (typeof entry.x === 'number' && typeof entry.y === 'number') {
      return {
        x: entry.x,
        y: entry.y,
        posZ: typeof entry.posZ === 'number' ? entry.posZ : 0,
        rotate: typeof entry.rotate === 'number' ? entry.rotate : undefined,
        locationName: entry.locationName,
      };
    }
    const loc = this.readSnapLocation(syncData);
    if (!loc) return null;
    const posZ = this.readSnapNumber(syncData, 'posZ');
    const rotate = this.readSnapNumber(syncData, 'rotate');
    return {
      x: toNum(loc.x),
      y: toNum(loc.y),
      posZ: posZ != null ? posZ : 0,
      rotate: rotate != null ? rotate : undefined,
      locationName: loc.name,
    };
  }

  private readSnapLocation(syncData: any): TabletopLocation | null {
    if (!syncData || typeof syncData !== 'object') return null;
    const loc = syncData.attributes?.location ?? syncData.location;
    if (!loc || typeof loc !== 'object') return null;
    if (loc.x == null || loc.y == null) return null;
    return loc as TabletopLocation;
  }

  private readSnapNumber(syncData: any, key: string): number | null {
    if (!syncData || typeof syncData !== 'object') return null;
    const value = syncData.attributes?.[key] ?? syncData[key];
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  parseInnerXml(element: Element) {
    const doomed = ScenePresetList.instance.children.map(c => c.identifier);
    for (let child of ScenePresetList.instance.children) {
      child.destroy();
    }
    for (const id of doomed) ObjectStore.instance.clearDeleted(id);
    let context = ScenePresetList.instance.toContext();
    context.syncData = this.toContext().syncData;
    ScenePresetList.instance.apply(context);
    ScenePresetList.instance.update();
    super.parseInnerXml.apply(ScenePresetList.instance, [element]);
    ScenePresetList.instance.repairTableBindingsAfterLoad();
    this.destroy();
  }
}

function deepCopy<T>(obj: T): T {
  if (obj == null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function toNum(value: any): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
