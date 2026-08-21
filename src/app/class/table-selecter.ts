import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { InnerXml } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { GameTable } from './game-table';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';
import { poseDebug } from './table-fx/pose-debug';
import { folderBackupDebug, summarizeCharPlacements } from '../service/folder-backup-debug';
import { CharacterToken } from './character-token';
import { GameCharacter } from './game-character';
import { reconcileLayerStack } from './tabletop-object-util';
import { TabletopLoadSettle } from './tabletop-load-settle';

/**
 * Foundry-style scene selection:
 * - active (`viewTableIdentifier` SyncVar, kept for save/compat) — one room-wide active table
 * - viewed (`viewedTableIdentifier`, local) — canvas currently rendered for this client
 */
@SyncObject('TableSelecter')
export class TableSelecter extends GameObject implements InnerXml {
  private static _instance: TableSelecter;
  static get instance(): TableSelecter {
    if (!TableSelecter._instance) {
      TableSelecter._instance = new TableSelecter('TableSelecter');
      TableSelecter._instance.initialize();
    }
    return TableSelecter._instance;
  }

  /** Room-wide active table id (Foundry “active scene”). Legacy SyncVar name kept for compat. */
  @SyncVar() viewTableIdentifier: string = '';

  /** Soft pause watermark for all clients; does not block input. */
  @SyncVar() isPaused: boolean = false;

  /** Per-client viewed table id (Foundry “viewed scene”). Not synced. */
  viewedTableIdentifier: string = '';

  gridShow: boolean = false; // true=一律顯示格線
  gridSnap: boolean = true;

  /** Alias for active table id. */
  get activeTableIdentifier(): string { return this.viewTableIdentifier; }
  set activeTableIdentifier(id: string) { this.viewTableIdentifier = id; }

  innerXml(): string { return ''; }

  /** Merge room/ZIP parse into the singleton (AuraNameConfig pattern). */
  parseInnerXml(_element: Element) {
    const context = TableSelecter.instance.toContext();
    context.syncData = this.toContext().syncData;
    TableSelecter.instance.apply(context);
    TableSelecter.instance.update();
    if (this !== TableSelecter.instance) this.destroy();
  }

  /**
   * Before Room XML parse: drop stale session view so legacy ZIPs without TableSelecter
   * fall back to GameTable.selected / first table instead of the previous session's map.
   */
  prepareForRoomReload() {
    this.viewedTableIdentifier = '';
    this.viewTableIdentifier = '';
    this.isPaused = false;
    // Start bounce gate early so XML→restore remounts do not run enter animations.
    // Does not touch Network / join reopen ownership.
    TabletopLoadSettle.begin();
  }

  /**
   * After Room XML parse: restore active+viewed and hydrate.
   * Prefer selecter SyncVar (new saves), then GameTable.selected, then tables[0].
   */
  restoreAfterRoomLoad() {
    try {
      const tables = ObjectStore.instance.getObjects<GameTable>(GameTable);
      if (tables.length < 1) {
        poseDebug('restoreAfterRoomLoad abort: no tables');
        folderBackupDebug('restoreAfterRoomLoad abort: no tables');
        return;
      }

      const selected = tables.find(t => !!t.selected);
      const activeObj = this.viewTableIdentifier
        ? ObjectStore.instance.get<GameTable>(this.viewTableIdentifier)
        : null;

      let targetId = '';
      if (activeObj) targetId = this.viewTableIdentifier;
      else if (selected) targetId = selected.identifier;
      else targetId = tables[0].identifier;

      const pieces = TabletopObject.getAll().filter(o => o.location.name === 'table');
      const onTarget = pieces.filter(o => o.hasPlacement(targetId));
      folderBackupDebug('restoreAfterRoomLoad', {
        targetId,
        source: activeObj ? 'selecter' : (selected ? 'GameTable.selected' : 'tables[0]'),
        tableCount: tables.length,
        tableIds: tables.map(t => t.identifier),
        piecesOnTable: pieces.length,
        piecesOnTarget: onTarget.length,
        pieceSample: onTarget.slice(0, 8).map(o => {
          const p = o.getPoseForTable(targetId);
          return `${o.aliasName}|${o.identifier.slice(0, 8)}|${p ? `${p.x|0},${p.y|0}` : 'nopose'}`;
        }),
      });
      poseDebug('restoreAfterRoomLoad', {
        targetId,
        source: activeObj ? 'selecter' : (selected ? 'GameTable.selected' : 'tables[0]'),
        tableCount: tables.length,
        tableIds: tables.map(t => t.identifier),
        selectedId: selected?.identifier || '',
        piecesOnTable: pieces.length,
        piecesOnTarget: onTarget.length,
        sample: onTarget.slice(0, 5).map(o => ({
          id: o.identifier,
          live: `${o.location.x | 0},${o.location.y | 0},${o.posZ | 0}`,
          pose: (() => {
            const p = o.getPoseForTable(targetId);
            return p ? `${p.x | 0},${p.y | 0},${p.posZ | 0}` : '(none)';
          })(),
          placements: (o.tablePlacements || '').slice(0, 100),
        })),
      });

      for (const t of tables) {
        t.selected = t.identifier === targetId;
      }
      this.viewTableIdentifier = targetId;
      try { TabletopObject.migrateUnboundTablePieces(targetId); }
      catch (e) { console.warn('[TableSelecter] migrateUnboundTablePieces failed', e); }
      try { CharacterToken.migrateLegacyOnTableCharacters(); }
      catch (e) { console.warn('[TableSelecter] migrateLegacyOnTableCharacters failed', e); }
      try { CharacterToken.pruneOrphanTokens(); }
      catch (e) { console.warn('[TableSelecter] pruneOrphanTokens failed', e); }
      EventSystem.trigger('PREPARE_VIEW_TABLE_CHANGE', { tableId: targetId });
      this.viewedTableIdentifier = targetId;
      try { TabletopObject.hydrateAllForView(targetId, true); }
      catch (e) { console.warn('[TableSelecter] hydrateAllForView failed', e); }
      try { reconcileLayerStack(); }
      catch (e) { console.warn('[TableSelecter] reconcileLayerStack failed', e); }
      EventSystem.trigger('AFTER_VIEW_TABLE_CHANGE', { tableId: targetId });
      // Single identity remount owner: ROOM_PIECES_REPLACED (GameTable).
      // SELECT uses _fromRoomLoad so map-switch characterViewEpoch is not double-fired.
      EventSystem.trigger('ROOM_PIECES_REPLACED', { tableId: targetId });
      EventSystem.trigger('SELECT_GAME_TABLE', {
        identifier: targetId,
        _fromSelecter: true,
        _fromRoomLoad: true,
      });
      this.syncMyViewedPresence();
      this.schedulePoseVisualSyncAfterLoad(targetId);
    } catch (e) {
      console.warn('TableSelecter.restoreAfterRoomLoad failed; falling back', e);
      folderBackupDebug('restoreAfterRoomLoad failed', { error: String((e as Error)?.message || e) });
      this.ensureActiveOrFirst();
    }
  }

  /**
   * Room load destroys/recreates pieces before Angular mounts MovableDirective.
   * Immediate AFTER_VIEW_TABLE_CHANGE therefore misses them; map-switch works because
   * components already exist. Retry hydrate + movable sync like scene-preset apply.
   */
  private schedulePoseVisualSyncAfterLoad(tableId: string) {
    const sync = (label: string) => {
      if (!tableId) return;
      if (this.viewedTableIdentifier !== tableId && this.viewTableIdentifier !== tableId) {
        poseDebug(`schedulePose skip (${label})`, {
          tableId,
          viewed: this.viewedTableIdentifier,
          active: this.viewTableIdentifier,
        });
        folderBackupDebug(`schedulePose skip (${label})`, {
          tableId,
          viewed: this.viewedTableIdentifier,
          active: this.viewTableIdentifier,
        });
        return;
      }
      poseDebug(`schedulePose sync (${label})`, { tableId });
      folderBackupDebug(`schedulePose sync (${label})`, { tableId });
      TabletopObject.hydrateAllForView(tableId, true);
      EventSystem.trigger('AFTER_VIEW_TABLE_CHANGE', { tableId });
    };
    queueMicrotask(() => sync('microtask'));
    setTimeout(() => sync('200ms'), 200);
  }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    EventSystem.register(this)
      .on('ACTIVATE_GAME_TABLE', event => {
        const id: string = event.data?.identifier;
        if (!id) return;
        if (event.isSendFromSelf) {
          // Originator already applied via activateTable / legacy SELECT; ensure viewed.
          if (this.viewTableIdentifier !== id) this.applyActivateAsOriginator(id);
          else this.applyViewLocal(id);
        } else {
          this.applyViewLocal(id);
        }
        EventSystem.trigger('SELECT_GAME_TABLE', { identifier: id, _fromSelecter: true });
      })
      .on('VIEW_GAME_TABLE', event => {
        const id: string = event.data?.identifier;
        if (!id) return;
        this.applyViewLocal(id);
        EventSystem.trigger('SELECT_GAME_TABLE', { identifier: id, _fromSelecter: true });
      })
      // Legacy: treat as Activate for old callers that still fire SELECT_GAME_TABLE directly.
      .on('SELECT_GAME_TABLE', event => {
        // Ignore our own re-triggers from activate/view handlers above.
        if (event.data?._fromSelecter) return;
        const id: string = event.data?.identifier;
        if (!id) return;

        // Join catalog / rehydrate of selected GameTable — never rebroadcast Activate
        // (that would yank peers, including a GM previewing another map).
        if (event.data?._fromCatalog) {
          if (this.viewTableIdentifier === id) {
            if (this.viewedTableIdentifier !== id) this.applyViewLocal(id);
            else TabletopObject.hydrateAllForView(id, true);
          }
          return;
        }

        // Already aligned — hydrate only.
        if (this.viewedTableIdentifier === id && this.viewTableIdentifier === id) {
          TabletopObject.hydrateAllForView(id, true);
          return;
        }
        this.applyActivateAsOriginator(id);
        EventSystem.call('ACTIVATE_GAME_TABLE', { identifier: id });
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (event.isSendFromSelf) return;
        if (event.data?.identifier !== this.identifier) return;
        const activeId = this.viewTableIdentifier;
        if (!activeId) return;
        // Remote active change → pull local view (Foundry Activate).
        if (this.viewedTableIdentifier !== activeId) {
          this.applyViewLocal(activeId);
          EventSystem.trigger('SELECT_GAME_TABLE', { identifier: activeId, _fromSelecter: true });
        } else {
          TabletopObject.hydrateAllForView(activeId, true);
        }
      })
      .on('CONNECT_PEER', event => {
        if (!event.isSendFromSelf) return;
        // After join catalog sync, align viewed to active and hydrate poses.
        setTimeout(() => this.ensureActiveOrFirst(), 500);
      })
      .on('MY_PEER_CURSOR_READY', () => {
        // createMyCursor finishes after ensureActiveOrFirst often ran — sync presence now.
        if (!this.viewedTableIdentifier) this.ensureActiveOrFirst();
        else this.syncMyViewedPresence();
      });
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
  }

  /**
   * Activate a table for the whole room (GM). Sets SyncVar active and pulls every peer’s viewed canvas.
   */
  activateTable(identifier: string) {
    if (!identifier) return;
    if (Network.GuestMode()) return;
    if (!PeerCursor.myCursor?.isGMMode) return;
    this.applyActivateAsOriginator(identifier);
    EventSystem.call('ACTIVATE_GAME_TABLE', { identifier });
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier, _fromSelecter: true });
  }

  /**
   * View a table locally only (does not change room active).
   * Players need `playerCanView` on that GameTable; GM always allowed.
   */
  viewTableLocal(identifier: string) {
    if (!identifier) return;
    const table = ObjectStore.instance.get<GameTable>(identifier);
    if (!table) return;
    const isGM = !!PeerCursor.myCursor?.isGMMode;
    if (!isGM && !table.playerCanView) return;
    this.applyViewLocal(identifier);
    EventSystem.trigger('SELECT_GAME_TABLE', { identifier, _fromSelecter: true });
  }

  togglePaused() {
    if (Network.GuestMode()) return;
    if (!PeerCursor.myCursor?.isGMMode) return;
    this.isPaused = !this.isPaused;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.toContext());
  }

  private applyActivateAsOriginator(identifier: string) {
    const prev = ObjectStore.instance.get<GameTable>(this.viewTableIdentifier);
    if (prev && prev.identifier !== identifier) prev.selected = false;
    this.viewTableIdentifier = identifier;
    const next = ObjectStore.instance.get<GameTable>(identifier);
    if (next) next.selected = true;
    TabletopObject.migrateUnboundTablePieces(identifier);
    this.applyViewLocal(identifier);
  }

  private applyViewLocal(identifier: string) {
    const prev = this.viewedTableIdentifier;
    const chars = ObjectStore.instance.getObjects(GameCharacter);
    const beforeSnap = summarizeCharPlacements(chars, prev || '', identifier);
    poseDebug('applyViewLocal (map switch)', {
      from: prev || '(none)',
      to: identifier,
    });
    folderBackupDebug('applyViewLocal', {
      from: prev || '(none)',
      to: identifier,
      same: prev === identifier,
      ...beforeSnap,
    });
    if (prev && prev !== identifier) {
      // Flush movable batches + live poses into placements[prev] before hydrate.
      EventSystem.trigger('BEFORE_VIEW_TABLE_CHANGE', { tableId: prev });
      TabletopObject.flushLivePosesToView(prev);
    }
    this.viewedTableIdentifier = identifier;
    // Clear selection before hydrate — selected tokens ignore self UPDATE and keep the old map's screen pose.
    EventSystem.trigger('PREPARE_VIEW_TABLE_CHANGE', { tableId: identifier });
    TabletopObject.hydrateAllForView(identifier, true);
    // Densify desk < mask < character for peers visible on this view (Tokens above covers).
    reconcileLayerStack();
    EventSystem.trigger('AFTER_VIEW_TABLE_CHANGE', { tableId: identifier });
    if (PeerCursor.myCursor) {
      PeerCursor.myCursor.viewedSceneIdentifier = identifier;
    }
    const afterSnap = summarizeCharPlacements(chars, prev || '', identifier);
    folderBackupDebug('applyViewLocal after hydrate', {
      from: prev || '(none)',
      to: identifier,
      dual: afterSnap.dual,
      survivors: afterSnap.survivors,
      samples: afterSnap.samples,
    });
  }

  /**
   * Canvas table = viewed (fallback active).
   * Read-only: never mutates viewed/active ids. If a known id is still syncing into the store,
   * return null instead of falling back to tables[0] (avoids canvas/presence desync on join).
   */
  get viewTable(): GameTable {
    const id = this.viewedTableIdentifier || this.viewTableIdentifier;
    if (id) {
      const table = ObjectStore.instance.get<GameTable>(id);
      if (table) return table;
      if (!ObjectStore.instance.isDeleted(id)) return null;
    }
    if (id) return null;
    return ObjectStore.instance.getObjects<GameTable>(GameTable)[0] || null;
  }

  get activeTable(): GameTable {
    return this.viewTableIdentifier
      ? ObjectStore.instance.get<GameTable>(this.viewTableIdentifier)
      : null;
  }

  /** Boot / empty-room: ensure active+viewed point at first table without getter side effects. */
  ensureActiveOrFirst() {
    const tables = ObjectStore.instance.getObjects<GameTable>(GameTable);
    if (tables.length < 1) return;

    const activeId = this.viewTableIdentifier;
    const activeObj = activeId ? ObjectStore.instance.get<GameTable>(activeId) : null;
    const activeDeleted = !!(activeId && ObjectStore.instance.isDeleted(activeId));

    // If we already have an active id but the GameTable is not in the store yet
    // (catalog still syncing), do NOT rewrite SyncVar to tables[0] — that races joins.
    if (activeId && !activeObj && !activeDeleted) {
      if (!this.viewedTableIdentifier) this.viewedTableIdentifier = activeId;
      this.syncMyViewedPresence();
      return;
    }

    if (!activeObj || activeDeleted) {
      this.viewTableIdentifier = tables[0].identifier;
      tables[0].selected = true;
    }
    if (!this.viewedTableIdentifier || !ObjectStore.instance.get<GameTable>(this.viewedTableIdentifier)) {
      this.viewedTableIdentifier = this.viewTableIdentifier;
    }
    TabletopObject.hydrateAllForView(this.viewedTableIdentifier, true);
    this.syncMyViewedPresence();
  }

  private syncMyViewedPresence() {
    if (PeerCursor.myCursor && this.viewedTableIdentifier) {
      PeerCursor.myCursor.viewedSceneIdentifier = this.viewedTableIdentifier;
    }
  }
}
