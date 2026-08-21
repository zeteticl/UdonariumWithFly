import { ImageFile } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { GameObject } from './core/synchronize-object/game-object';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem } from './core/system';
import { MathUtil } from './core/system/util/math-util';
import { setZeroTimeout } from './core/system/util/zero-timeout';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';
import { poseDebug } from './table-fx/pose-debug';
import {
  applyPlacementViewState,
  capturePlacementViewState,
  defaultPlacementViewState,
  pickPlacementViewState,
  placementHasViewState,
  PlacementViewState,
  PLACEMENT_VIEW_STATE_KEYS,
  viewStatesEqual,
} from './table-placement-view-state';

export interface TabletopLocation {
  name: string;
  x: number;
  y: number;
}

/** Per-map pose for multi-map presence (same SyncObject on several tables). */
export interface TablePlacementPose extends PlacementViewState {
  x: number;
  y: number;
  posZ: number;
}

@SyncObject('TabletopObject')
export class TabletopObject extends ObjectNode {
  @SyncVar() location: TabletopLocation = {
    name: 'table',
    x: 0,
    y: 0
  };

  @SyncVar() posZ: number = 0;

  /**
   * Last-touched / primary GameTable id (compat). Visibility uses tablePlacements.
   * Empty when in inventory / graveyard / hand.
   */
  @SyncVar() tableIdentifier: string = '';

  /**
   * JSON map of tableId → { x, y, posZ }. Same object can sit on multiple maps.
   * Migrated from legacy single tableIdentifier + location when empty.
   */
  @SyncVar() tablePlacements: string = '';

  /** Clone from「建立暫存副本」/ CTRL+drag; delete destroys (no graveyard). */
  @SyncVar() isTemporaryCopy: boolean = false;

  get isVisibleOnTable(): boolean {
    if (this.location.name !== 'table') return false;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    if (!viewId) return false;
    // Do not write SyncVars here (breaks CD / freezes panels). Migrate elsewhere.
    return this.hasPlacement(viewId);
  }

  /** Parsed placements (may migrate legacy binding — do not call from pure getters used in CD). */
  getPlacements(): { [tableId: string]: TablePlacementPose } {
    this.ensurePlacementsMigrated();
    return this.parsePlacements();
  }

  /** Read-only placement check; supports legacy single tableIdentifier without writing. */
  hasPlacement(tableId: string): boolean {
    if (!tableId) return false;
    if (this.tablePlacements) {
      return !!this.parsePlacements()[tableId];
    }
    return this.tableIdentifier === tableId;
  }

  get placementTableIds(): string[] {
    if (this.tablePlacements) return Object.keys(this.parsePlacements());
    if (this.location.name === 'table' && this.tableIdentifier) return [this.tableIdentifier];
    return [];
  }

  getPoseForTable(tableId: string): TablePlacementPose | null {
    if (!tableId) return null;
    if (this.tablePlacements) {
      return this.parsePlacements()[tableId] || null;
    }
    if (this.tableIdentifier === tableId && this.location.name === 'table') {
      return { x: this.location.x, y: this.location.y, posZ: this.posZ };
    }
    return null;
  }

  /** Pose for current view table, else live location/posZ. */
  getPoseForView(): TablePlacementPose {
    const viewId = TabletopObject.resolveViewTableIdentifier();
    const pose = viewId ? this.getPoseForTable(viewId) : null;
    if (pose) return pose;
    return { x: this.location.x, y: this.location.y, posZ: this.posZ };
  }

  setPoseForTable(tableId: string, pose: TablePlacementPose, syncLive = true) {
    if (!tableId) return;
    // Do not call ensurePlacementsMigrated() — that can seed the current view map
    // and invent dual placements when exclusive-placing onto another table.
    const map = this.parsePlacements();
    const prev = map[tableId];
    // Merge so movable x/y/posZ updates do not wipe per-map appearance fields.
    map[tableId] = {
      ...prev,
      ...pose,
      x: pose.x,
      y: pose.y,
      posZ: pose.posZ,
    };
    this.tablePlacements = JSON.stringify(map);
    this.tableIdentifier = tableId;
    this.location.name = 'table';
    if (syncLive) {
      const viewId = TabletopObject.resolveViewTableIdentifier();
      // Always apply live coords when this is the only placement (common for Tokens
      // seeded onto a non-viewed map). Otherwise movable mounts at 0,0 until hydrate.
      const onlyPlacement = Object.keys(map).length === 1;
      if (!viewId || viewId === tableId || onlyPlacement) {
        this.location.x = pose.x;
        this.location.y = pose.y;
        this.posZ = pose.posZ;
      }
    }
    this.update();
  }

  /**
   * Place on a table without removing other map placements.
   * @param exclusive if true, clear other placements first (「僅移至此地圖」)
   */
  addToTable(tableId?: string, pose?: Partial<TablePlacementPose>, exclusive = false) {
    const id = tableId || TabletopObject.resolveViewTableIdentifier() || this.tableIdentifier || '';
    if (!id) {
      this.location.name = 'table';
      this.update();
      return;
    }
    if (exclusive) {
      this.clearPlacements(false);
      this.tableIdentifier = '';
    }
    const existing = this.getPoseForTable(id);
    const appearance = existing && TabletopObject.placementHasAppearance(existing)
      ? TabletopObject.pickAppearance(existing)
      : this.captureLiveAppearance();
    const next: TablePlacementPose = {
      ...appearance,
      x: pose?.x ?? existing?.x ?? this.location.x,
      y: pose?.y ?? existing?.y ?? this.location.y,
      posZ: pose?.posZ ?? existing?.posZ ?? this.posZ,
    };
    // Explicit pose overrides (coords already set; copy any view-state keys provided).
    if (pose) {
      for (const key of PLACEMENT_VIEW_STATE_KEYS) {
        if (pose[key] !== undefined) (next as any)[key] = pose[key];
      }
    }
    this.setPoseForTable(id, next, true);
  }

  /** Remove from one map; if none left, move to inventoryLocation (default common). */
  removeFromTable(tableId?: string, inventoryLocation = 'common') {
    const id = tableId || TabletopObject.resolveViewTableIdentifier() || this.tableIdentifier || '';
    if (!id) return;
    this.ensurePlacementsMigrated();
    const map = this.parsePlacements();
    if (!map[id]) return;
    delete map[id];
    const keys = Object.keys(map);
    if (keys.length < 1) {
      this.tablePlacements = '';
      // Keep map id so common / graveyard / personal inventories stay per-map.
      this.tableIdentifier = id;
      this.location.name = inventoryLocation;
      this.update();
      return;
    }
    this.tablePlacements = JSON.stringify(map);
    const viewId = TabletopObject.resolveViewTableIdentifier();
    const keep = (viewId && map[viewId]) ? viewId : keys[0];
    this.tableIdentifier = keep;
    const pose = map[keep];
    this.location.name = 'table';
    this.location.x = pose.x;
    this.location.y = pose.y;
    this.posZ = pose.posZ;
    this.applyAppearanceFromPose(pose);
    this.update();
  }

  /** Mirror placements[view] into live location for the current view (call on map switch). */
  hydratePoseForView(viewTableId?: string, silent = false) {
    const viewId = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!viewId || this.location.name !== 'table') return;
    // Do not ensureAppearanceBackfilled() here: live SyncVars may still hold the
    // previous map's values and would pollute sibling placements (!anyHas seed).
    const pose = this.getPoseForTable(viewId);
    if (!pose) return;
    const apply = () => {
      this.location = { name: 'table', x: pose.x, y: pose.y };
      this.posZ = pose.posZ;
      this.tableIdentifier = viewId;
      this.applyAppearanceFromPose(pose);
    };
    if (silent) {
      this.withSyncSuppressed(apply);
      // Fan out identifier events so MovableDirective.setPosition runs (plain UPDATE_GAME_OBJECT does not).
      EventSystem.trigger('UPDATE_GAME_OBJECT', this.toContext());
      EventSystem.trigger(`UPDATE_GAME_OBJECT/identifier/${this.identifier}`, this.toContext());
    } else {
      apply();
    }
  }

  static hydrateAllForView(viewTableId?: string, silent = false) {
    const viewId = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!viewId) {
      poseDebug('hydrateAllForView skip: no viewId');
      return;
    }
    let hydrated = 0;
    let skipped = 0;
    for (const obj of TabletopObject.getAll()) {
      if (obj.location.name === 'table' && obj.hasPlacement(viewId)) {
        obj.hydratePoseForView(viewId, silent);
        hydrated++;
      } else if (obj.location.name === 'table') {
        skipped++;
      }
    }
    poseDebug('hydrateAllForView', { viewId, silent, hydrated, skippedNoPlacement: skipped });
  }

  /**
   * Walk ObjectNode parents to the owning TabletopObject.
   * Remote altitude/height/size arrive as DataElement UPDATEs, not Character UPDATEs.
   */
  static resolveOwningTabletop(node: ObjectNode | null | undefined): TabletopObject | null {
    let cur: ObjectNode | null | undefined = node;
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.identifier)) break;
      seen.add(cur.identifier);
      if (cur instanceof TabletopObject) return cur;
      cur = cur.parent;
    }
    return null;
  }

  /**
   * Which tabletop (if any) should reproject after a remote UPDATE.
   * Only the piece itself or footprint DataElements — never HP/status sheet fields.
   */
  static resolveReprojectTarget(obj: GameObject | null | undefined): TabletopObject | null {
    if (!obj) return null;
    if (obj instanceof TabletopObject) return obj;
    const name = (obj as any).name;
    if (typeof name === 'string' && TabletopObject.isPlacementFootprintName(name)) {
      return TabletopObject.resolveOwningTabletop(obj as any);
    }
    return null;
  }

  /**
   * After a remote SyncVar apply, live rotate/coords follow the editor's map.
   * Re-apply this client's current view pose so dual-map peers stay independent.
   */
  static reprojectForLocalView(obj: TabletopObject) {
    if (!obj || obj.location.name !== 'table') return;
    if (obj.placementTableIds.length < 2) return;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    if (!viewId || !obj.hasPlacement(viewId)) return;
    obj.hydratePoseForView(viewId, true);
  }

  /**
   * Persist live location/posZ/appearance into placements[viewId] before leaving that map.
   * Does not change which maps the object belongs to.
   */
  static flushLivePosesToView(viewTableId?: string) {
    const viewId = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!viewId) return;
    for (const obj of TabletopObject.getAll()) {
      if (obj.location.name !== 'table') continue;
      if (!obj.hasPlacement(viewId)) continue;
      // Do not ensureAppearanceBackfilled() here: live values may already be a
      // per-map edit and must not be copied onto sibling placements.
      const live: TablePlacementPose = {
        x: obj.location.x,
        y: obj.location.y,
        posZ: obj.posZ,
        ...obj.captureLiveAppearance(),
      };
      const saved = obj.getPoseForTable(viewId);
      if (saved && TabletopObject.posesEqual(saved, live)) continue;
      obj.setPoseForTable(viewId, live, false);
    }
  }

  /**
   * Write live view-state into a map's placement (default: current view).
   * Call after sheet / rotate / FX edits so other maps keep their own records.
   *
   * Important: do NOT call ensureAppearanceBackfilled() here after SyncVars were
   * already mutated — that would seed maps from post-edit live values.
   * Prefer {@link mutateAppearance}, or call ensureAppearanceBackfilled() before mutating.
   * Pass {@code viewTableId} when writing from a deferred batch (map may have switched).
   */
  syncAppearanceToCurrentViewPlacement(viewTableId?: string) {
    if (this.location.name !== 'table') return;
    const viewId = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!viewId || !this.hasPlacement(viewId)) return;
    const map = this.parsePlacements();
    const saved = map[viewId];
    if (!saved) return;
    const liveAppearance = this.captureLiveAppearance();
    if (!Object.keys(liveAppearance).length) return;

    // Seed sibling placements that still lack fields. Use the target map's
    // pre-write record (shared baseline) or defaults — never post-edit live.
    const defaults = defaultPlacementViewState(this);
    for (const id of Object.keys(map)) {
      if (id === viewId) continue;
      for (const key of PLACEMENT_VIEW_STATE_KEYS) {
        if (map[id][key] !== undefined) continue;
        if (saved[key] !== undefined) (map[id] as any)[key] = saved[key];
        else if (defaults[key] !== undefined) (map[id] as any)[key] = defaults[key];
      }
    }

    const next: TablePlacementPose = {
      ...saved,
      ...liveAppearance,
      x: saved.x,
      y: saved.y,
      posZ: saved.posZ,
    };
    map[viewId] = next;
    if (TabletopObject.posesEqual(saved, next) && JSON.stringify(map) === this.tablePlacements) return;
    this.tablePlacements = JSON.stringify(map);
    this.update();
  }

  /** Backfill missing placement keys from pre-edit live, mutate, then write current view. */
  mutateAppearance(mutator: () => void) {
    if (this.location.name === 'table') this.ensureAppearanceBackfilled();
    mutator();
    this.syncAppearanceToCurrentViewPlacement();
  }

  /** Destroy temporary copies; otherwise optional graveyard callback. */
  static disposeObject(obj: TabletopObject, toGraveyard?: () => void) {
    if (obj.isTemporaryCopy) {
      // Temporary CharacterTokens own a hidden independent sheet — destroy both.
      if (obj.aliasName === 'character-token') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { CharacterToken } = require('./character-token') as typeof import('./character-token');
        CharacterToken.destroyToken(obj as import('./character-token').CharacterToken);
      } else {
        obj.destroy();
      }
      return;
    }
    if (toGraveyard) toGraveyard();
    else obj.destroy();
  }

  private parsePlacements(): { [tableId: string]: TablePlacementPose } {
    if (!this.tablePlacements) return {};
    try {
      const raw = JSON.parse(this.tablePlacements);
      if (!raw || typeof raw !== 'object') return {};
      return raw as { [tableId: string]: TablePlacementPose };
    } catch {
      return {};
    }
  }

  private clearPlacements(update = true) {
    this.tablePlacements = '';
    if (update) this.update();
  }

  /**
   * Seed placements from legacy tableIdentifier + location once.
   * Never falls back to the current view id (that seeds dual placements).
   */
  ensurePlacementsMigrated() {
    if (this.tablePlacements) {
      this.ensureAppearanceBackfilled();
      return;
    }
    if (this.location.name !== 'table') return;
    if (!this.tableIdentifier) return;
    this.tablePlacements = JSON.stringify({
      [this.tableIdentifier]: {
        x: this.location.x,
        y: this.location.y,
        posZ: this.posZ,
        ...this.captureLiveAppearance(),
      },
    });
  }

  /** Snapshot live per-map view state for the current map record. */
  captureLiveAppearance(): Partial<TablePlacementPose> {
    return capturePlacementViewState(this);
  }

  /** Apply per-map view state onto shared SyncVars / DataElements (current view live values). */
  applyAppearanceFromPose(pose: TablePlacementPose) {
    applyPlacementViewState(this, pose);
  }

  /**
   * Per-field backfill for legacy dual-map saves.
   * - If no placement has a key yet: current view gets live (shared look); siblings
   *   get defaults — never copy post-edit live onto every map.
   * - If some have it: fill missing siblings with defaults only.
   */
  ensureAppearanceBackfilled() {
    if (!this.tablePlacements) return;
    const map = this.parsePlacements();
    const keys = Object.keys(map);
    if (!keys.length) return;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    const live = this.captureLiveAppearance();
    const defaults = defaultPlacementViewState(this);
    let changed = false;
    for (const field of PLACEMENT_VIEW_STATE_KEYS) {
      const liveVal = live[field];
      const defaultVal = defaults[field];
      if (liveVal === undefined && defaultVal === undefined) continue;
      const anyHas = keys.some(k => map[k][field] !== undefined);
      if (!anyHas) {
        for (const k of keys) {
          let seed: any;
          if (viewId && k === viewId) {
            seed = liveVal !== undefined ? liveVal : defaultVal;
          } else {
            // Other maps: defaults only (never post-edit / current-view live).
            seed = defaultVal;
          }
          if (seed === undefined) continue;
          (map[k] as any)[field] = seed;
          changed = true;
        }
      } else {
        for (const k of keys) {
          if (map[k][field] !== undefined) continue;
          // Missing siblings get defaults only — never post-edit live.
          if (defaultVal === undefined) continue;
          (map[k] as any)[field] = defaultVal;
          changed = true;
        }
      }
    }
    if (changed) this.tablePlacements = JSON.stringify(map);
  }

  static placementHasAppearance(pose: TablePlacementPose | null | undefined): boolean {
    return placementHasViewState(pose);
  }

  static pickAppearance(pose: TablePlacementPose): Partial<TablePlacementPose> {
    return pickPlacementViewState(pose);
  }

  static posesEqual(a: TablePlacementPose, b: TablePlacementPose): boolean {
    return a.x === b.x
      && a.y === b.y
      && a.posZ === b.posZ
      && viewStatesEqual(a, b);
  }

  /** All tabletop subclasses (character/card/dice/…). getObjects(TabletopObject) only matches the base alias. */
  static getAll(): TabletopObject[] {
    const list: TabletopObject[] = [];
    for (const obj of ObjectStore.instance.getObjects()) {
      if (obj instanceof TabletopObject) list.push(obj);
    }
    return list;
  }

  /**
   * Repair legacy pieces missing tablePlacements / tableIdentifier.
   * Never rebinds an object that already has placements onto a different map
   * (that was wiping per-map poses when switching scenes).
   */
  static migrateUnboundTablePieces(viewTableId?: string) {
    const id = viewTableId || TabletopObject.resolveViewTableIdentifier();
    if (!id) return;
    for (const obj of TabletopObject.getAll()) {
      try {
        if (obj.location.name !== 'table') continue;
        if (obj.tablePlacements) {
          // Placements already authoritative — only heal empty primary id.
          if (!obj.tableIdentifier) {
            const keys = Object.keys(obj.parsePlacements());
            if (keys.length) obj.tableIdentifier = keys[0];
          }
          continue;
        }
        if (obj.tableIdentifier) {
          obj.ensurePlacementsMigrated();
          continue;
        }
        // Truly unbound (no id, no placements): bind once to the given/current view.
        obj.addToTable(id, undefined, true);
      } catch (e) {
        console.warn('[TabletopObject] migrateUnbound skip', obj?.identifier, e);
      }
    }
  }

  /**
   * After room XML load: rebind pieces whose tableIdentifier points at vanished UUIDs
   * (saves from before syncId). Returns old→new table id remap for scene presets.
   */
  static repairOrphanedPieceBindings(extraOrphanIds: string[] = []): Map<string, string> {
    // Use alias string — importing GameTable here creates a circular init cycle
    // (game-table → game-table-mask → tabletop-object).
    const tables = ObjectStore.instance.getObjects('game-table') as Array<{ identifier: string }>;
    const remap = new Map<string, string>();
    if (tables.length < 1) {
      TabletopObject.migrateUnboundTablePieces();
      return remap;
    }
    const validIds = new Set(tables.map(t => t.identifier));
    const orphanIds: string[] = [];
    const seen = new Set<string>();

    const consider = (tid: string) => {
      if (!tid || validIds.has(tid) || seen.has(tid)) return;
      seen.add(tid);
      orphanIds.push(tid);
    };

    for (const obj of TabletopObject.getAll()) {
      try {
        if (obj.location.name !== 'table') continue;
        obj.ensurePlacementsMigrated();
        consider(obj.tableIdentifier);
        for (const tid of Object.keys(obj.parsePlacements())) consider(tid);
      } catch (e) {
        console.warn('[TabletopObject] repairOrphan consider skip', obj?.identifier, e);
      }
    }
    for (const tid of extraOrphanIds) consider(tid);

    if (orphanIds.length > 0) {
      if (tables.length === 1) {
        for (const id of orphanIds) remap.set(id, tables[0].identifier);
      } else if (orphanIds.length === tables.length) {
        // Pair by sorted id — ObjectStore / getAll() order is not stable across browsers.
        const sortedOrphans = [...orphanIds].sort();
        const sortedTableIds = tables.map(t => t.identifier).sort();
        for (let i = 0; i < sortedOrphans.length; i++) {
          remap.set(sortedOrphans[i], sortedTableIds[i]);
        }
      } else {
        const viewId = TabletopObject.resolveViewTableIdentifier() || tables[0].identifier;
        for (const id of orphanIds) remap.set(id, viewId);
      }

      for (const obj of TabletopObject.getAll()) {
        try {
          if (obj.location.name !== 'table') continue;
          const nextPrimary = remap.get(obj.tableIdentifier);
          if (nextPrimary) obj.tableIdentifier = nextPrimary;
          const map = obj.parsePlacements();
          let changed = false;
          const nextMap: { [tableId: string]: TablePlacementPose } = {};
          for (const [tid, pose] of Object.entries(map)) {
            const next = remap.get(tid) || tid;
            if (validIds.has(next)) {
              nextMap[next] = pose;
              if (next !== tid) changed = true;
            } else {
              changed = true;
            }
          }
          if (changed || Object.keys(nextMap).length !== Object.keys(map).length) {
            obj.tablePlacements = Object.keys(nextMap).length ? JSON.stringify(nextMap) : '';
          }
        } catch (e) {
          console.warn('[TabletopObject] repairOrphan remap skip', obj?.identifier, e);
        }
      }
    }

    TabletopObject.migrateUnboundTablePieces();
    return remap;
  }

  static resolveViewTableIdentifier(): string {
    const selecter = ObjectStore.instance.get<any>('TableSelecter');
    if (!selecter) return '';
    const viewed = selecter.viewedTableIdentifier;
    if (viewed && ObjectStore.instance.get(viewed)) return viewed;
    const active = selecter.viewTableIdentifier;
    if (active && ObjectStore.instance.get(active)) return active;
    return '';
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    // Only bind table id here. Do not seed placements yet — create flows set
    // location.x/y after initialize(), then call setLocation('table').
    // Defer SyncVar write so createObject.apply() can load real coords first;
    // otherwise a 0,0 + tableIdentifier broadcast drifts peers on join.
    if (this.location.name === 'table' && !this.tableIdentifier) {
      const viewId = TabletopObject.resolveViewTableIdentifier();
      if (!viewId) return;
      setZeroTimeout(() => {
        if (this.location.name === 'table' && !this.tableIdentifier) {
          this.tableIdentifier = viewId;
        }
      });
    }
  }

  private _imageFile: ImageFile = ImageFile.Empty;
  private _shadowImageFile: ImageFile = ImageFile.Empty;
  //private _faceIcon: ImageFile = null;
  private _dataElements: { [name: string]: string } = {};

  // GameDataElement getter/setter
  get rootDataElement(): DataElement {
    for (let node of this.children) {
      if (node.getAttribute('name') === this.aliasName) return <DataElement>node;
    }
    return null;
  }

  get imageDataElement(): DataElement { return this.getElement('image'); }
  get commonDataElement(): DataElement { return this.getElement('common'); }
  get detailDataElement(): DataElement { return this.getElement('detail'); }

  @SyncVar() currntImageIndex: number = 0;
  /*
  get imageFile(): ImageFile {
    if (!this.imageDataElement) return this._imageFile;
    let imageIdElement: DataElement = this.imageDataElement.getFirstElementByName('imageIdentifier');
    if (imageIdElement && this._imageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._imageFile = file ? file : ImageFile.Empty;
    }
    return this._imageFile;
  }
  */
  get imageElement(): DataElement {
    if (!this.imageDataElement) return null;
    let imageIdElements: DataElement[] = this.imageDataElement.getElementsByName('imageIdentifier');
    return imageIdElements[this.currntImageIndex < 0 ? 0 : this.currntImageIndex >= imageIdElements.length ? imageIdElements.length - 1 : this.currntImageIndex];
  }
  get imageFile(): ImageFile {
    if (!this.imageDataElement) return this._imageFile;
    let imageIdElement = this.imageElement;
    if (imageIdElement && this._imageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._imageFile = file ? file : ImageFile.Empty;
    }
    return this._imageFile;
  }
  get imageFiles(): ImageFile[] {
    if (!this.imageDataElement) return [];
    let elements = this.imageDataElement.getElementsByName('imageIdentifier');
    return elements.map((element) => {
      let file: ImageFile = ImageStorage.instance.get(<string>element.value);
      return file ? file : null;
    }).filter((file) => { return file != null });
  }

  @SyncVar() isUseIconToOverviewImage: boolean = false;
  @SyncVar() currntIconIndex: number = 0;
  get faceIcon(): ImageFile {
    if (!this.imageDataElement) return null;
    let elements = this.imageDataElement.getElementsByName('faceIcon');
    if (elements) {
      let imageIdElement = elements[this.currntIconIndex];
      if (this.currntIconIndex < 0) this.currntIconIndex = 0;
      return imageIdElement ? ImageStorage.instance.get(<string>imageIdElement.value) : null;
    }
    return null;
  }
  get faceIcons(): ImageFile[] {
    if (!this.imageDataElement) return [];
    let elements = this.imageDataElement.getElementsByName('faceIcon');
    return elements.map((element) => {
      let file: ImageFile = ImageStorage.instance.get(<string>element.value);
      return file ? file : null;
    }).filter((file) => { return file != null });
  }

  get shadowImageFile(): ImageFile {
    if (!this.imageDataElement) return this._shadowImageFile;
    let imageIdElement: DataElement = this.imageDataElement.getFirstElementByName('shadowImageIdentifier');
    if (imageIdElement && this._shadowImageFile.identifier !== imageIdElement.value) {
      let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.value);
      this._shadowImageFile = file ? file : ImageFile.Empty;
    } else {
      let imageIdElement: DataElement = this.imageElement;
      if (imageIdElement && this._shadowImageFile.identifier !== imageIdElement.currentValue) {
        let file: ImageFile = ImageStorage.instance.get(<string>imageIdElement.currentValue);
        this._shadowImageFile = file ? file : ImageFile.Empty;
      }
    }
    return this._shadowImageFile;
  }

  @SyncVar() isAltitudeIndicate: boolean = false;
  get altitude(): number {
    let element = this.getElement('altitude', this.commonDataElement);
    //if (!element && this.commonDataElement) {
    //  this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    //}
    let num = element ? +element.value : 0;
    return Number.isNaN(num) ? 0 : num;
  }
  set altitude(altitude: number) {
    let element = this.getElement('altitude', this.commonDataElement);
    if (element) {
      this.mutateAppearance(() => { element.value = altitude; });
    }
  }

  get isHaveAltitude(): boolean {
    return !!this.getElement('altitude', this.commonDataElement);
  }

  @SyncVar() isInverse: boolean = false;
  @SyncVar() isHollow: boolean = false;
  @SyncVar() isBlackPaint: boolean = false;
  @SyncVar() isGrayscale: boolean = false;
  @SyncVar() isSepia: boolean = false;
  @SyncVar() isWhitePaint: boolean = false;
  @SyncVar() isMatrix: boolean = false;
  @SyncVar() isFlipVertical: boolean = false;
  @SyncVar() isContrast: boolean = false;
  @SyncVar() aura = -1;

  @SyncVar() isNotRide: boolean = true;
  @SyncVar() isInventoryIndicate: boolean = true;

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  calcSqrDistance(other: TabletopObject): number {
    let pos1 = { x: this.location.x, y: this.location.y, z: this.posZ };
    let pos2 = { x: other.location.x, y: other.location.y, z: other.posZ };
    return MathUtil.sqrMagnitude(pos1, pos2);
  }

  protected createDataElements() {
    this.initialize();
    let aliasName: string = this.aliasName;
    if (!this.rootDataElement) {
      let rootElement = DataElement.create(aliasName, '', {}, aliasName + '_' + this.identifier);
      this.appendChild(rootElement);
    }

    if (!this.imageDataElement) {
      this.rootDataElement.appendChild(DataElement.create('image', '', {}, 'image_' + this.identifier));
      this.imageDataElement.appendChild(DataElement.create('imageIdentifier', '', { type: 'image' }, 'imageIdentifier_' + this.identifier));
    }
    if (!this.commonDataElement) this.rootDataElement.appendChild(DataElement.create('common', '', {}, 'common_' + this.identifier));
    if (!this.detailDataElement) this.rootDataElement.appendChild(DataElement.create('detail', '', {}, 'detail_' + this.identifier));
  }

  /** Footprint DataElements stored per map in tablePlacements. */
  static isPlacementFootprintName(name: string): boolean {
    return name === 'size' || name === 'height' || name === 'altitude'
      || name === 'width' || name === 'depth' || name === 'length';
  }

  /**
   * Write a DataElement value. Footprint fields go through mutateAppearance so
   * other maps keep their own size/height/altitude; other fields write directly.
   */
  static writeDataElementValue(el: DataElement | null | undefined, value: any) {
    if (!el) return;
    const owner = TabletopObject.resolveOwningTabletop(el);
    if (owner && TabletopObject.isPlacementFootprintName(el.name)) {
      owner.mutateAppearance(() => { el.value = value; });
      return;
    }
    el.value = value;
  }

  protected getElement(name: string, from: DataElement = this.rootDataElement): DataElement {
    if (!from) return null;
    let element: DataElement = this._dataElements[name] ? ObjectStore.instance.get(this._dataElements[name]) : null;
    if (!element || !from.contains(element)) {
      element = from.getFirstElementByName(name);
      this._dataElements[name] = element ? element.identifier : null;
    }
    return element;
  }

  protected getCommonValue<T extends string | number>(elementName: string, defaultValue: T): T {
    let element = this.getElement(elementName, this.commonDataElement);
    if (!element) return defaultValue;

    if (typeof defaultValue === 'number') {
      let number: number = +element.value;
      return <T>(Number.isNaN(number) ? defaultValue : number);
    } else {
      return <T>(element.value + '');
    }
  }

  getUrls(): DataElement[] {
    return this.rootDataElement?.getElementsByType('url') ?? [];
  }

  protected setCommonValue(elementName: string, value: any) {
    let element = this.getElement(elementName, this.commonDataElement);
    if (!element) { return; }
    const isAppearance = TabletopObject.isPlacementFootprintName(elementName);
    if (isAppearance) {
      this.mutateAppearance(() => { element.value = value; });
      return;
    }
    element.value = value;
  }

  protected getImageFile(elementName: string) {
    if (!this.imageDataElement) return null;
    let image = this.getElement(elementName, this.imageDataElement);
    return image ? ImageStorage.instance.get(<string>image.value) : null;
  }

  protected setImageFile(elementName: string, imageFile: ImageFile) {
    let image = imageFile ? this.getElement(elementName, this.imageDataElement) : null;
    if (!image) return;
    image.value = imageFile.identifier;
  }

  setLocation(location: string, tableIdentifier?: string) {
    if (location === 'table') {
      // Prefer current live coords (create/drop set x/y before setLocation).
      // Exclusive only when coming from inventory (no map placements yet).
      // Tokens already on another map must keep those placements (use moveToTableOnly for「僅此地圖」).
      const exclusive = this.location.name !== 'table' && this.placementTableIds.length < 1;
      this.addToTable(tableIdentifier, {
        x: this.location.x,
        y: this.location.y,
        posZ: this.posZ,
      }, exclusive);
      return;
    }
    this.clearPlacements(false);
    // Bind off-table inventory to a map (per-map common / graveyard / personal).
    this.tableIdentifier = tableIdentifier
      || TabletopObject.resolveViewTableIdentifier()
      || this.tableIdentifier
      || '';
    this.location.name = location;
    this.update();
  }

  /** Whether an off-table inventory entry belongs to the currently viewed map. */
  isInventoryForCurrentView(): boolean {
    if (this.location.name === 'table') return false;
    const viewId = TabletopObject.resolveViewTableIdentifier();
    if (!viewId) return true;
    // Legacy unbound inventory entries remain visible on every map until rebound.
    if (!this.tableIdentifier) return true;
    return this.tableIdentifier === viewId;
  }

  /**
   * Leave the current view map for an inventory (common / graveyard / personal).
   * Other maps' placements are kept. If this was the last map, moves to {@param inventoryLocation}.
   * Use this instead of {@link setLocation} when removing from one map only.
   */
  leaveCurrentTable(inventoryLocation: string = 'common') {
    if (this.location.name !== 'table') {
      this.setLocation(inventoryLocation);
      return;
    }
    const viewId = TabletopObject.resolveViewTableIdentifier();
    this.removeFromTable(viewId || undefined, inventoryLocation);
  }

  /** Move exclusively to one map (clear other placements). */
  moveToTableOnly(tableIdentifier?: string, pose?: Partial<TablePlacementPose>) {
    this.addToTable(tableIdentifier, pose, true);
  }

  /** Drop every placement except {@param tableId} (keeps pose on that map). */
  keepOnlyTablePlacement(tableId: string) {
    if (!tableId) return;
    const pose = this.getPoseForTable(tableId) || {
      x: this.location.x,
      y: this.location.y,
      posZ: this.posZ,
      ...this.captureLiveAppearance(),
    };
    this.clearPlacements(false);
    this.tableIdentifier = '';
    this.setPoseForTable(tableId, pose, true);
  }
}
