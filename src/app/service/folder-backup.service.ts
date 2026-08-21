import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { MimeType } from '@udonarium/core/file-storage/mime-type';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { ObjectSynchronizer } from '@udonarium/core/synchronize-object/object-synchronizer';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { Room } from '@udonarium/room';
import { RoleAuthInput, RoomAuth } from '@udonarium/room-auth';
import { captureMapPreviewDataUrl } from '@udonarium/scene-preset-preview';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import { TabletopObject } from '@udonarium/tabletop-object';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { FolderBackupListComponent } from 'component/folder-backup-list/folder-backup-list.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import * as localForage from 'localforage';
import { I18nService } from './i18n.service';
import { ModalService } from './modal.service';
import { FolderBackupCrypto, FolderBackupSecretsBlob } from './folder-backup-crypto';
import { folderBackupDebug } from './folder-backup-debug';
import { shouldPersistLeaveFlush } from './folder-backup-persist';
import {
  FOLDER_BACKUP_FORMAT_VERSION,
  FolderBackupManifest,
  FolderBackupRoomMetaV2,
  FolderBackupSlotKind,
  LATEST_DIR,
  MANIFEST_FILE,
  MEDIA_DIR,
  PREVIEW_FILE,
  RECENT_DIR,
  RECENT_INTERVAL_MS,
  RECENT_SLOT_COUNT,
  ROOM_META_FILE,
  ROOMS_DIR,
  SNAP_1D_MS,
  SNAP_7D_MS,
  SNAP_30D_MS,
  SNAP_DIRS,
  STATE_ZIP_FILE,
  dataUrlToJpegBlob,
} from './folder-backup-layout';
import { RoomInviteService } from './room-invite.service';
import { SaveDataService } from './save-data.service';
import { ConnectionBusyService } from './connection-busy.service';
import { PanelService } from './panel.service';

export type FolderBackupStatus = 'unsupported' | 'unbound' | 'needAuth' | 'ready' | 'writing' | 'error';

export interface RoomBackupAuthSettings {
  allowUser: boolean;
  allowGuest: boolean;
  gmPassword: string;
  userPassword: string;
  guestPassword: string;
}

export type RoomBackupAuthStatus = 'ready' | 'legacy' | 'missing' | 'undecryptable';

export interface RoomBackupSlot {
  id: string;
  kind: FolderBackupSlotKind;
  savedAt: string;
  previewUrl?: string;
  /** Legacy ZIP only. */
  fileHandle?: FileSystemFileHandle;
  zipFile?: string;
}

export interface RoomBackupInfo {
  roomId: string;
  displayName: string;
  savedAt: string;
  auth?: RoomBackupAuthSettings;
  authStatus: RoomBackupAuthStatus;
  previewUrl?: string;
  format: 'v2' | 'legacy';
  slots: RoomBackupSlot[];
  /** @deprecated legacy ZIP */
  zipFile?: string;
  /** @deprecated legacy ZIP */
  fileHandle?: FileSystemFileHandle;
}

export interface RoomBackupSelection {
  room: RoomBackupInfo;
  slot: RoomBackupSlot;
}

export interface RoomBackupMeta {
  roomId: string;
  displayName: string;
  savedAt: string;
  zipFile?: string;
  formatVersion?: number;
  allowUser?: boolean;
  allowGuest?: boolean;
  secrets?: FolderBackupSecretsBlob;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  gmPassword?: string;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  userPassword?: string;
  /** @deprecated Legacy plaintext — read once for migration, never written again. */
  guestPassword?: string;
  slots?: FolderBackupRoomMetaV2['slots'];
}

export interface FolderFlushOptions {
  timeoutMs?: number;
  /** Write even if current identity is Guest (use after role already switched). */
  bypassGuest?: boolean;
  /** Write using last room snapshot even if peer left the room. */
  allowLeave?: boolean;
  /**
   * Call requestPermission when queryPermission is not granted.
   * Must run in a user-gesture stack (button click); background flush must omit this.
   */
  requestAuth?: boolean;
  /**
   * Force write target identity (roomId/name/auth).
   * Required when switching rooms: Network.peer already points at the new room,
   * but tabletop content is still the previous room until load finishes.
   */
  snapshot?: RoomSnapshot;
}

interface RoomSnapshot {
  roomId: string;
  displayName: string;
  auth?: RoomBackupAuthSettings;
}

@Injectable({
  providedIn: 'root'
})
export class FolderBackupService implements OnDestroy {
  private static _instance: FolderBackupService | null = null;
  static get instance(): FolderBackupService | null {
    return FolderBackupService._instance;
  }

  static readonly STORAGE_KEY = 'udonarium.folderBackup.dirHandle';
  /** Hot state writes (cheap XML). */
  private static readonly DEBOUNCE_MS = 2000;
  private static readonly MIN_INTERVAL_MS = 10000;
  /** Retention slots must be at least this much older than latest to list / keep. */
  private static readonly RETENTION_DISTINCT_MS = 5000;
  /** Includes time to materialize ./assets URL images into the room save. */
  private static readonly DEFAULT_FLUSH_TIMEOUT_MS = 60000;

  private dirHandle: FileSystemDirectoryHandle | null = null;
  private listening = false;
  private dirty = false;
  private writing = false;
  private writeAgain = false;
  private writePromise: Promise<void> | null = null;
  private leaveFlushPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private minIntervalTimer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteAt = 0;
  /** Room id of the last successful folder write (may differ from activeRoomId after switch). */
  private lastWriteRoomId = '';
  private activeRoomId = '';
  private lastRoomSnapshot: RoomSnapshot | null = null;
  /** False until a live mesh or a successful ZIP load — blocks writing empty join leftovers. */
  private contentTrusted = false;
  /** True while lobby/invite join is connecting; auto-write stays off. */
  private joinQuarantine = false;
  /** Load backup after OPEN_NETWORK flush finishes (must not race ahead of old-room write). */
  private pendingLoadAfterOpen: (() => Promise<void>) | null = null;
  /** Unified resume/load owns flush+open; skip parallel onNetworkOpen flush. */
  private suppressNetworkOpenFlush = false;
  /** Pause folder auto-write while room XML/media is being replaced. */
  private suspendAutoWrite = false;
  private initialized = false;
  private onVisibilityChange: (() => void) | null = null;

  status: FolderBackupStatus = 'unsupported';
  folderName = '';
  lastSavedAt: string | null = null;
  lastError = '';

  constructor(
    private saveDataService: SaveDataService,
    private roomInvite: RoomInviteService,
    private ngZone: NgZone,
    private modalService: ModalService,
    private i18n: I18nService
  ) {
    FolderBackupService._instance = this;
  }

  get needsBind(): boolean {
    return this.isSupported && (!this.hasFolder || this.status === 'unbound' || this.status === 'needAuth');
  }

  get canLoadFromFolder(): boolean {
    return this.isSupported && !Network.GuestMode() && this.isReady;
  }

  get isSupported(): boolean {
    return typeof window !== 'undefined'
      && !!window.isSecureContext
      && typeof window.showDirectoryPicker === 'function';
  }

  get isReady(): boolean {
    return this.status === 'ready' || this.status === 'writing';
  }

  get hasFolder(): boolean {
    return !!this.dirHandle;
  }

  get hasError(): boolean {
    return this.status === 'error';
  }

  get canAutoWrite(): boolean {
    return !!this.dirHandle
      && (this.status === 'ready' || this.status === 'writing' || this.status === 'error')
      && !!Network.peer?.isRoom
      && !Network.GuestMode()
      && this.contentTrusted;
  }

  /** Unwritten or in-flight folder backup work remains. */
  get hasPendingWrite(): boolean {
    return this.dirty || this.writing || !!this.writePromise || this.writeAgain;
  }

  /** Bound folder already holds the current room state (safe to reload without flush). */
  get isBackupCurrent(): boolean {
    return this.isReady
      && this.lastWriteAt > 0
      && !this.hasPendingWrite
      && !!this.activeRoomId
      && this.lastWriteRoomId === this.activeRoomId;
  }

  /** Lobby/invite join: do not persist tabletop until a live peer is confirmed. */
  beginJoinQuarantine() {
    this.joinQuarantine = true;
    this.contentTrusted = false;
    this.listening = false;
    this.dirty = false;
    this.clearTimers();
  }

  /** Failed probe: drop quarantine without writing. */
  abortJoinQuarantine() {
    this.joinQuarantine = false;
    this.contentTrusted = false;
    this.listening = false;
    this.dirty = false;
    this.clearTimers();
  }

  /** ZIP load finished or a live mesh stayed up — folder writes are safe. */
  markContentTrusted() {
    this.joinQuarantine = false;
    this.contentTrusted = true;
    if (Network.peer?.isRoom && !Network.GuestMode() && !this.suspendAutoWrite) {
      this.listening = true;
      this.captureRoomSnapshot();
    }
  }

  private settlePeerSyncAfterLoad(loadOk: boolean, trust: boolean) {
    ObjectSynchronizer.instance.releasePeerSync(loadOk);
    if (trust) {
      this.markContentTrusted();
      return;
    }
    this.listening = false;
    this.contentTrusted = false;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.isSupported) {
      this.setStatus('unsupported');
      return;
    }

    this.setStatus('unbound');
    try {
      const stored = await localForage.getItem<FileSystemDirectoryHandle>(FolderBackupService.STORAGE_KEY);
      if (stored) {
        this.dirHandle = stored;
        this.folderName = stored.name || '';
        const perm = await this.queryPermission(stored);
        this.setStatus(perm === 'granted' ? 'ready' : 'needAuth');
      }
    } catch (e) {
      console.warn('FolderBackup restore handle failed', e);
      this.dirHandle = null;
      this.setStatus('unbound');
    }

    EventSystem.register(this)
      .on('OPEN_NETWORK', () => { void this.onNetworkOpen(); })
      .on('CHANGE_GM_MODE', () => { void this.onGuestModePossiblyChanged(); })
      .on('UPDATE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName))
      .on('DELETE_GAME_OBJECT', event => this.onGameObjectDirty(event.data?.aliasName));

    this.onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (this.suspendAutoWrite) return;
        void this.flush({ timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS });
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    void this.onNetworkOpen();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.clearTimers();
    if (this.onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    if (FolderBackupService._instance === this) FolderBackupService._instance = null;
  }

  async bindFolder(): Promise<boolean> {
    if (!this.isSupported) {
      this.setStatus('unsupported');
      return false;
    }
    try {
      // Music preference first; only then ask for the folder.
      const includeAudio = await this.saveDataService.askIncludeAudio('folder');
      if (includeAudio == null) {
        return false;
      }

      const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
      const perm = await this.requestPermission(handle);
      if (perm !== 'granted') {
        this.dirHandle = handle;
        this.folderName = handle.name || '';
        this.setStatus('needAuth');
        return false;
      }

      this.dirHandle = handle;
      this.folderName = handle.name || '';
      await localForage.setItem(FolderBackupService.STORAGE_KEY, handle);
      this.lastError = '';
      this.setStatus('ready');
      void this.onNetworkOpen();
      return true;
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return false;
      console.warn('FolderBackup bind failed', e);
      this.lastError = String((e as Error)?.message || e);
      this.setStatus('error');
      return false;
    }
  }

  async requestAccess(): Promise<boolean> {
    if (!this.dirHandle) return this.bindFolder();
    try {
      const perm = await this.requestPermission(this.dirHandle);
      if (perm !== 'granted') {
        this.setStatus('needAuth');
        return false;
      }
      this.lastError = '';
      this.setStatus('ready');
      void this.onNetworkOpen();
      return true;
    } catch (e) {
      console.warn('FolderBackup requestAccess failed', e);
      this.lastError = String((e as Error)?.message || e);
      this.setStatus('needAuth');
      return false;
    }
  }

  async unbindFolder(): Promise<void> {
    this.clearTimers();
    this.dirty = false;
    this.writeAgain = false;
    this.dirHandle = null;
    this.folderName = '';
    this.lastSavedAt = null;
    this.lastError = '';
    this.listening = false;
    this.lastRoomSnapshot = null;
    try {
      await localForage.removeItem(FolderBackupService.STORAGE_KEY);
    } catch (e) {
      console.warn(e);
    }
    this.setStatus(this.isSupported ? 'unbound' : 'unsupported');
  }

  markDirty() {
    if (!this.canAutoWrite) return;
    this.dirty = true;
    this.scheduleWrite();
  }

  async flush(options?: FolderFlushOptions): Promise<boolean> {
    if (!this.dirHandle) {
      return false;
    }
    // Mid-load ObjectStore is lobby defaults or a half-parsed ZIP — do not persist it.
    if (this.suspendAutoWrite && !options?.allowLeave) {
      return false;
    }
    if (options?.allowLeave && !shouldPersistLeaveFlush(this.contentTrusted, !!options.snapshot)) {
      this.dirty = false;
      this.clearTimers();
      return false;
    }
    if (Network.GuestMode() && !options?.bypassGuest) {
      return false;
    }
    const inRoom = !!Network.peer?.isRoom;
    if (!inRoom && !options?.allowLeave) {
      return false;
    }
    if (!inRoom && options?.allowLeave && !this.lastRoomSnapshot) {
      this.dirty = false;
      this.clearTimers();
      return false;
    }

    if (this.status === 'needAuth' || this.status === 'error' || this.status === 'unbound' || options?.requestAuth) {
      let perm = await this.queryPermission(this.dirHandle);
      if (perm !== 'granted' && options?.requestAuth) {
        perm = await this.requestPermission(this.dirHandle);
      }
      if (perm !== 'granted') {
        this.setStatus('needAuth');
        this.lastError = this.lastError || 'Folder permission not granted';
        return false;
      }
      this.setStatus(this.writing ? 'writing' : 'ready');
    }

    this.clearTimers();
    this.dirty = true;
    const timeoutMs = options?.timeoutMs ?? FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS;
    const writeAtBefore = this.lastWriteAt;
    try {
      await this.withTimeout(this.flushWrites(options), timeoutMs);
      if (this.lastError) return false;
      // A concurrent markDirty during flush must not look like failure after a successful write.
      return this.lastWriteAt > writeAtBefore || (!this.dirty && !this.lastError);
    } catch (e) {
      console.warn('FolderBackup flush failed', e);
      this.lastError = String((e as Error)?.message || e);
      return false;
    }
  }

  async listRoomBackups(): Promise<RoomBackupInfo[]> {
    if (!this.dirHandle) return [];
    const perm = await this.queryPermission(this.dirHandle);
    if (perm !== 'granted') {
      this.setStatus('needAuth');
      return [];
    }

    const byRoom = new Map<string, RoomBackupInfo>();

    // v2 rooms/<roomId>/
    try {
      const roomsDir = await this.dirHandle.getDirectoryHandle(ROOMS_DIR);
      for await (const [name, handle] of roomsDir.entries()) {
        if (handle.kind !== 'directory') continue;
        if (!this.isSafeRoomFileName(name)) continue;
        try {
          const room = await this.readV2RoomBackup(roomsDir, name, handle as FileSystemDirectoryHandle);
          if (room) byRoom.set(room.roomId, room);
        } catch (e) {
          console.warn('Skip v2 room backup', name, e);
        }
      }
    } catch { /* no rooms/ yet */ }

    // Legacy root {roomId}.meta.json + zip
    for await (const [name, handle] of this.dirHandle.entries()) {
      if (handle.kind !== 'file') continue;
      if (!name.endsWith('.meta.json')) continue;
      try {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const meta = JSON.parse(await file.text()) as RoomBackupMeta;
        if (!meta?.roomId || !meta?.zipFile) continue;
        if (!this.isSafeRoomFileName(meta.roomId) || !this.isSafeZipFileName(meta.zipFile)) continue;
        if (byRoom.has(meta.roomId)) continue; // prefer v2
        const zipHandle = await this.dirHandle.getFileHandle(meta.zipFile);
        const resolved = await this.authFromMeta(meta);
        const slot: RoomBackupSlot = {
          id: 'legacy',
          kind: 'legacy_zip',
          savedAt: meta.savedAt || '',
          fileHandle: zipHandle,
          zipFile: meta.zipFile,
        };
        byRoom.set(meta.roomId, {
          roomId: meta.roomId,
          displayName: meta.displayName || meta.roomId,
          savedAt: meta.savedAt || '',
          zipFile: meta.zipFile,
          fileHandle: zipHandle,
          auth: resolved.auth,
          authStatus: resolved.status,
          format: 'legacy',
          slots: [slot],
        });
      } catch (e) {
        console.warn('Skip backup meta', name, e);
      }
    }

    const results = Array.from(byRoom.values());
    results.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    return results;
  }

  async loadRoomBackup(selection: RoomBackupSelection | RoomBackupInfo): Promise<void> {
    const room = 'room' in selection ? selection.room : selection;
    const slot = 'slot' in selection
      ? selection.slot
      : (room.slots?.[0] || (room.fileHandle ? {
        id: 'legacy',
        kind: 'legacy_zip' as const,
        savedAt: room.savedAt,
        fileHandle: room.fileHandle,
        zipFile: room.zipFile,
      } : null));
    if (!slot) throw new Error('No backup slot to load');

    folderBackupDebug('loadRoomBackup start', {
      roomId: room.roomId,
      slotId: slot.id,
      kind: slot.kind,
      format: room.format || '',
      zipFile: slot.zipFile || room.zipFile || '',
    });

    if (slot.kind === 'legacy_zip' || room.format === 'legacy') {
      const zipHandle = slot.fileHandle || room.fileHandle;
      if (!zipHandle) throw new Error('Missing zip handle');
      const zipName = slot.zipFile || room.zipFile || `${room.roomId}.zip`;
      const file = await zipHandle.getFile();
      folderBackupDebug('loadRoomBackup legacy zip', { zipName, bytes: file.size });
      await FileArchiver.instance.load([
        new File([file], zipName, { type: 'application/zip' }),
      ]);
      folderBackupDebug('loadRoomBackup FileArchiver.load done (legacy)');
      return;
    }

    if (!this.dirHandle) throw new Error('No folder');
    const files = await this.collectV2SlotFiles(room.roomId, slot);
    if (!files.length) throw new Error('Empty backup slot');
    folderBackupDebug('loadRoomBackup v2 files', {
      count: files.length,
      names: files.slice(0, 20).map(f => f.name),
      totalBytes: files.reduce((s, f) => s + (f.size || 0), 0),
    });
    await FileArchiver.instance.load(files);
    folderBackupDebug('loadRoomBackup FileArchiver.load done (v2)');
  }

  /** Blocks UI while reading media + state and letting piece views remount. */
  private async loadRoomBackupWithBusy(selection: RoomBackupSelection | RoomBackupInfo): Promise<void> {
    const busy = ConnectionBusyService.instance;
    busy?.show('folderBackup.loadingRoom');
    try {
      await this.loadRoomBackup(selection);
      await this.waitForTabletopLoadSettle();
    } finally {
      TabletopLoadSettle.forceRelease();
      busy?.hide();
    }
  }

  /**
   * Align busy overlay with TabletopLoadSettle (not a fixed 700ms).
   * Connection reopen ownership is unrelated — this only waits for bounce/remount gate.
   */
  private waitForTabletopLoadSettle(timeoutMs = 2500): Promise<void> {
    if (!TabletopLoadSettle.busy) {
      return new Promise(resolve => setTimeout(resolve, 250));
    }
    return new Promise(resolve => {
      const key = { folderBackupSettleWait: true };
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        EventSystem.unregister(key);
        resolve();
      };
      EventSystem.register(key).on('TABLETOP_LOAD_SETTLE_DONE', () => finish());
      setTimeout(finish, timeoutMs);
    });
  }

  async deleteRoomBackup(backup: RoomBackupInfo): Promise<boolean> {
    if (!this.dirHandle) return false;
    const perm = await this.queryPermission(this.dirHandle);
    if (perm !== 'granted') {
      this.setStatus('needAuth');
      return false;
    }
    if (!this.isSafeRoomFileName(backup.roomId)) return false;

    let removed = false;
    if (backup.format === 'v2') {
      try {
        const roomsDir = await this.dirHandle.getDirectoryHandle(ROOMS_DIR);
        await FileArchiver.instance.removeDirectoryRecursive(roomsDir, backup.roomId);
        removed = true;
      } catch (e) {
        console.warn('Failed to remove v2 room backup', backup.roomId, e);
      }
    }

    const zipFile = backup.zipFile || `${backup.roomId}.zip`;
    const metaFile = `${backup.roomId}.meta.json`;
    if (backup.format === 'legacy' || backup.fileHandle) {
      if (this.isSafeZipFileName(zipFile)) {
        try {
          await this.dirHandle.removeEntry(zipFile);
          removed = true;
        } catch (e) {
          console.warn('Failed to remove backup zip', zipFile, e);
        }
        try {
          await this.dirHandle.removeEntry(`${zipFile}.tmp`);
        } catch { /* ignore */ }
      }
      try {
        await this.dirHandle.removeEntry(metaFile);
        removed = true;
      } catch (e) {
        console.warn('Failed to remove backup meta', metaFile, e);
      }
    }

    for (const slot of backup.slots || []) {
      if (slot.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(slot.previewUrl);
    }
    if (backup.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(backup.previewUrl);

    return removed;
  }

  async ensureBound(): Promise<boolean> {
    if (!this.isSupported || Network.GuestMode()) return false;
    if (this.status === 'needAuth') return this.requestAccess();
    if (!this.hasFolder || this.status === 'unbound') return this.bindFolder();
    if (this.status === 'error') return this.requestAccess();
    return this.isReady;
  }

  async openLoadUi(): Promise<void> {
    if (!this.canLoadFromFolder) return;
    if (!SceneToolPermission.instance.canLoadRoom()) return;

    const backups = await this.listRoomBackups();
    const selected = await this.modalService.open(FolderBackupListComponent, {
      width: 640,
      height: 560,
      backups,
    }) as RoomBackupSelection | null;
    if (!selected?.room || !selected?.slot) return;

    const room = selected.room;
    const isRoom = !!Network.peer?.isRoom;
    if (!isRoom) {
      const choice = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.confirm.loadFolder.title'),
        text: this.i18n.t('menu.confirm.loadFolder.text', {
          name: room.displayName || room.roomId,
          id: room.roomId,
        }),
        help: this.resumeConfirmHelp(room.authStatus),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'folder',
        okLabel: this.i18n.t('menu.confirm.loadFolder.resumeRoom'),
        cancelLabel: this.i18n.t('confirm.cancel'),
      });
      if (choice !== true) return;
      await this.resumeOrLoadBackupUnified(selected, { switchFromCurrent: false });
      return;
    }

    const sameRoom = Network.peer.roomId === room.roomId;
    if (sameRoom) {
      const overwrite = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.confirm.loadFolder.overwrite.title'),
        text: this.i18n.t('menu.confirm.loadFolder.overwrite.text'),
        help: this.i18n.t('menu.confirm.loadFolder.overwrite.help'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'folder',
      });
      if (overwrite === true) {
        await this.loadBackupOnlyUnified(selected);
      }
      return;
    }

    const switchChoice = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('menu.confirm.loadFolder.switch.title'),
      text: this.i18n.t('menu.confirm.loadFolder.switch.text', {
        name: room.displayName || room.roomId,
        id: room.roomId,
        currentId: Network.peer.roomId,
      }),
      help: this.resumeConfirmHelp(room.authStatus) + '\n' + this.i18n.t('menu.confirm.loadFolder.switch.help', {
        currentId: Network.peer.roomId,
        backupId: room.roomId,
      }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'folder',
      okLabel: this.i18n.t('menu.confirm.loadFolder.switch.ok', {
        name: room.displayName || room.roomId,
        id: room.roomId,
      }),
      cancelLabel: this.i18n.t('confirm.cancel'),
    });
    if (switchChoice !== true) return;
    await this.resumeOrLoadBackupUnified(selected, { switchFromCurrent: true });
  }

  /**
   * One continuous busy overlay: flush (if switching) → open room as GM → load backup → settle.
   * Skips RoomSetting when auth can be applied from backup meta.
   */
  private async resumeOrLoadBackupUnified(
    selected: RoomBackupSelection,
    opts: { switchFromCurrent: boolean }
  ): Promise<void> {
    const room = selected.room;
    const busy = ConnectionBusyService.instance;
    folderBackupDebug('resumeOrLoad start', {
      roomId: room.roomId,
      displayName: room.displayName,
      authStatus: room.authStatus,
      switchFromCurrent: opts.switchFromCurrent,
      fromRoomId: Network.peer?.roomId || '',
    });
    busy?.show('folderBackup.loadingRoom');
    this.suppressNetworkOpenFlush = true;
    this.suspendAutoWrite = true;
    this.listening = false;
    this.clearTimers();
    ObjectSynchronizer.instance.holdPeerSync();
    let loadOk = false;
    let openedNewRoom = false;
    try {
      if (opts.switchFromCurrent) {
        this.captureRoomSnapshot();
        if (this.dirty || this.writing || this.writePromise) {
          folderBackupDebug('flush previous room before switch', {
            roomId: this.lastRoomSnapshot?.roomId || '',
          });
          await this.flush({
            timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
            bypassGuest: true,
            allowLeave: true,
            snapshot: this.lastRoomSnapshot || undefined,
          });
        }
      }

      const needsPasswordUi = room.authStatus === 'undecryptable';
      if (needsPasswordUi) {
        folderBackupDebug('auth undecryptable → RoomSetting');
        const created = await this.modalService.open(RoomSettingComponent, {
          width: 690,
          height: 600,
          left: 0,
          top: 80,
          preferredRoomId: room.roomId,
          preferredRoomName: room.displayName,
          preferredAuth: room.auth,
          preferredAuthStatus: room.authStatus,
          suppressConnectionBusy: true,
        });
        if (created !== true) return;
        openedNewRoom = true;
      } else {
        await this.openRoomAsGmFromBackup(room);
        openedNewRoom = true;
      }

      // OPEN_NETWORK may have flipped listening on — keep writes off until load settles.
      this.listening = false;
      this.clearTimers();
      this.dirty = false;

      this.logTokenVisibility('before-load');
      await this.loadRoomBackup(selected);
      this.logTokenVisibility('after-load-0ms');
      await this.waitForTabletopLoadSettle();
      this.logTokenVisibility('after-settle');
      folderBackupDebug('resumeOrLoad done', {
        roomId: Network.peer?.roomId || '',
        roomName: RoomAuth.displayRoomName(Network.peer?.roomName || ''),
      });
      this.closeLobbyWindows();
      loadOk = true;
    } catch (e) {
      console.warn('FolderBackup resume/load failed', e);
      folderBackupDebug('resumeOrLoad error', { error: String((e as Error)?.message || e) });
      this.lastError = String((e as Error)?.message || e);
      TabletopLoadSettle.forceRelease();
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.folderBackup.loadFailed.title'),
        text: this.i18n.t('menu.folderBackup.loadFailed.text'),
        help: this.i18n.t('menu.folderBackup.loadFailed.help', { error: this.lastError }),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.suspendAutoWrite = false;
      this.suppressNetworkOpenFlush = false;
      const trust = loadOk || (!openedNewRoom && !!Network.peer?.isRoom);
      this.settlePeerSyncAfterLoad(loadOk, trust);
      if (!trust && openedNewRoom && Network.peer?.isRoom) Network.open();
      TabletopLoadSettle.forceRelease();
      busy?.hide();
    }
  }

  private async loadBackupOnlyUnified(selected: RoomBackupSelection): Promise<void> {
    const busy = ConnectionBusyService.instance;
    folderBackupDebug('same-room overwrite load', {
      roomId: selected.room.roomId,
      slot: selected.slot?.id,
    });
    busy?.show('folderBackup.loadingRoom');
    this.suspendAutoWrite = true;
    this.listening = false;
    this.clearTimers();
    ObjectSynchronizer.instance.holdPeerSync();
    let loadOk = false;
    try {
      this.logTokenVisibility('before-load');
      await this.loadRoomBackup(selected);
      this.logTokenVisibility('after-load-0ms');
      await this.waitForTabletopLoadSettle();
      this.logTokenVisibility('after-settle');
      this.closeLobbyWindows();
      loadOk = true;
    } catch (e) {
      console.warn('FolderBackup load failed', e);
      folderBackupDebug('load error', { error: String((e as Error)?.message || e) });
      this.lastError = String((e as Error)?.message || e);
      TabletopLoadSettle.forceRelease();
      await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('menu.folderBackup.loadFailed.title'),
        text: this.i18n.t('menu.folderBackup.loadFailed.text'),
        help: this.i18n.t('menu.folderBackup.loadFailed.help', { error: this.lastError }),
        type: ConfirmationType.OK,
        materialIcon: 'error',
      });
    } finally {
      this.suspendAutoWrite = false;
      this.settlePeerSyncAfterLoad(
        loadOk,
        !!(loadOk && Network.peer?.isRoom && !Network.GuestMode()),
      );
      TabletopLoadSettle.forceRelease();
      busy?.hide();
    }
  }

  /** Open SkyWay room as GM using backup meta (no RoomSetting UI). */
  private async openRoomAsGmFromBackup(room: RoomBackupInfo): Promise<void> {
    const roomId = room.roomId;
    const displayName = (room.displayName || roomId).trim().slice(0, 16) || roomId;
    const auth = room.auth || {
      allowUser: true,
      allowGuest: false,
      gmPassword: '',
      userPassword: '',
      guestPassword: '',
    };
    const roles: { gm: RoleAuthInput; user: RoleAuthInput; guest: RoleAuthInput } = {
      gm: (auth.gmPassword || '').slice(0, 12),
      user: auth.allowUser ? (auth.userPassword || '').slice(0, 12) : { mode: 'disabled' },
      guest: auth.allowGuest ? (auth.guestPassword || '').slice(0, 12) : { mode: 'disabled' },
    };
    const { roomName: encodedName, meshPassword } = RoomAuth.encode(displayName, roomId, roles);
    const userId = Network.peer.userId;
    folderBackupDebug('openRoomAsGm', {
      roomId,
      displayName,
      allowUser: auth.allowUser,
      allowGuest: auth.allowGuest,
      hasGmPw: !!auth.gmPassword,
    });

    await new Promise<void>((resolve, reject) => {
      const key = { folderResume: true };
      const timer = setTimeout(() => {
        EventSystem.unregister(key);
        reject(new Error('Room open timeout'));
      }, 30000);
      EventSystem.register(key)
        .on('OPEN_NETWORK', () => {
          clearTimeout(timer);
          EventSystem.unregister(key);
          // Drop lobby samples before any catalog can go out (holdPeerSync is already on).
          Room.clearLocalTabletopForJoin();
          PeerCursor.myCursor.peerId = Network.peerId;
          RoomAuth.applyIdentity('gm', roomId);
          RoomAuth.rememberSession('gm', String(roles.gm || ''), meshPassword);
          this.roomInvite.setRolePasswords({
            gm: auth.gmPassword || '',
            user: auth.allowUser ? (auth.userPassword || '') : '',
            guest: auth.allowGuest ? (auth.guestPassword || '') : '',
          });
          folderBackupDebug('OPEN_NETWORK', {
            peerRoomId: Network.peer?.roomId || '',
            peerRoomName: RoomAuth.displayRoomName(Network.peer?.roomName || ''),
          });
          resolve();
        })
        .on('NETWORK_ERROR', () => {
          clearTimeout(timer);
          EventSystem.unregister(key);
          reject(new Error('Room open network error'));
        });
      Network.open(userId, roomId, encodedName, meshPassword);
    });
  }

  private logTokenVisibility(tag: string) {
    try {
      const viewId = TabletopObject.resolveViewTableIdentifier();
      const selecter = TableSelecter.instance;
      const all = ObjectStore.instance.getObjects(GameCharacter);
      const hosts = typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll('game-character') as NodeListOf<HTMLElement>)
        : [];
      const hostById = new Map<string, HTMLElement>();
      for (const el of hosts) {
        const id = el.getAttribute('data-fb-id') || '';
        if (id) hostById.set(id, el);
      }
      const rows = all.map(c => {
        const pose = viewId ? c.getPoseForTable(viewId) : null;
        const img = c.imageFile;
        const imageId = String(c.imageElement?.value ?? '');
        const el = hostById.get(c.identifier);
        let dom = 'missing';
        if (el) {
          // Host is often 0×0; measure Movable `.component` (same as game-table probe).
          const mov = (el.querySelector('.component') as HTMLElement | null) || el;
          const hostCs = getComputedStyle(el);
          const movCs = getComputedStyle(mov);
          const r = mov.getBoundingClientRect();
          const inner = el.querySelector('.component-content') as HTMLElement | null;
          const innerCs = inner ? getComputedStyle(inner) : null;
          const scaleTf = (innerCs?.transform && innerCs.transform !== 'none'
            ? innerCs.transform
            : (inner?.style?.transform || ''));
          const movTf = (mov.style.transform || movCs.transform || '').slice(0, 36);
          dom = `disp=${movCs.display}|vis=${hostCs.visibility}|op=${movCs.opacity}|rect=${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}|movTf=${movTf}|scaleTf=${scaleTf.slice(0, 40)}`;
        }
        return {
          id: c.identifier,
          name: c.name || '',
          loc: c.location?.name || '',
          visibleOnTable: c.isVisibleOnTable,
          isLoaded: !!c.isLoaded,
          isVisible: !!c.isVisible,
          hasPlacement: viewId ? c.hasPlacement(viewId) : false,
          tableId: c.tableIdentifier || '',
          live: `${c.location?.x | 0},${c.location?.y | 0},${c.posZ | 0}`,
          pose: pose ? `${pose.x | 0},${pose.y | 0},${pose.posZ | 0}` : '(none)',
          imageId: imageId.slice(0, 12),
          imageOk: !!(img && img.url && img.url.length > 0),
          imageState: img ? String((img as any).state ?? '') : '',
          placements: (c.tablePlacements || '').slice(0, 120),
          dom,
        };
      });
      const hidden = rows.filter(r => !r.visibleOnTable || !r.isLoaded);
      const noImage = rows.filter(r => r.visibleOnTable && !r.imageOk);
      const noDom = rows.filter(r => r.visibleOnTable && r.dom === 'missing');
      const zeroRect = rows.filter(r => r.dom.includes('rect=0x0'));
      folderBackupDebug(`tokens:${tag}`, {
        viewId: viewId || '(none)',
        viewed: selecter.viewedTableIdentifier || '',
        active: selecter.viewTableIdentifier || '',
        total: all.length,
        domHosts: hosts.length,
        visibleOnTable: rows.filter(r => r.visibleOnTable).length,
        loaded: rows.filter(r => r.isLoaded).length,
        noImage: noImage.length,
        noDom: noDom.length,
        zeroRect: zeroRect.length,
        ids: rows.map(r => `${r.name}|${r.id.slice(0, 8)}|vis=${r.visibleOnTable}|load=${r.isLoaded}|img=${r.imageOk}|live=${r.live}|pose=${r.pose}|${r.dom}`),
        hidden: hidden.map(r => `${r.name}|${r.id.slice(0, 8)}|loc=${r.loc}|place=${r.hasPlacement}|${r.placements}`),
        missingImages: noImage.map(r => `${r.name}|${r.id.slice(0, 8)}|imageId=${r.imageId}|state=${r.imageState}`),
        missingDom: noDom.map(r => `${r.name}|${r.id.slice(0, 8)}`),
      });
    } catch (e) {
      folderBackupDebug(`tokens:${tag} failed`, { error: String(e) });
    }
  }

  private async runPendingLoadAfterOpen() {
    const load = this.pendingLoadAfterOpen;
    if (!load) return;
    this.pendingLoadAfterOpen = null;
    await load();
  }

  private async onNetworkOpen() {
    const peer = Network.peer;
    if (!peer?.isRoom) {
      this.pendingLoadAfterOpen = null;
      if (this.joinQuarantine) {
        this.abortJoinQuarantine();
        this.lastRoomSnapshot = null;
        this.activeRoomId = '';
        return;
      }
      if (!this.leaveFlushPromise) {
        this.leaveFlushPromise = this.handleLeaveRoom().finally(() => {
          this.leaveFlushPromise = null;
        });
      }
      await this.leaveFlushPromise;
      return;
    }

    const roomId = peer.roomId || '';
    const prevSnapshot = this.lastRoomSnapshot;
    if (
      !this.suppressNetworkOpenFlush
      && !this.joinQuarantine
      && prevSnapshot
      && prevSnapshot.roomId !== roomId
      && (this.dirty || this.writing || this.writePromise)
    ) {
      folderBackupDebug('onNetworkOpen flush prev', {
        prev: prevSnapshot.roomId,
        next: roomId,
      });
      await this.flush({
        timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
        bypassGuest: true,
        allowLeave: true,
        snapshot: prevSnapshot,
      });
    }

    this.captureRoomSnapshot();
    this.activeRoomId = roomId;
    if (this.suspendAutoWrite || this.joinQuarantine) {
      this.listening = false;
      this.clearTimers();
    } else {
      this.contentTrusted = true;
      this.listening = !Network.GuestMode();
      if (!this.listening) this.clearTimers();
    }
    await this.runPendingLoadAfterOpen();
  }

  private async handleLeaveRoom() {
    if (this.joinQuarantine) {
      this.abortJoinQuarantine();
      this.activeRoomId = '';
      this.lastWriteRoomId = '';
      this.lastRoomSnapshot = null;
      return;
    }
    if ((this.dirty || this.writing || this.writePromise) && this.dirHandle && this.lastRoomSnapshot) {
      await this.flush({
        timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
        bypassGuest: true,
        allowLeave: true,
      });
    }
    this.activeRoomId = '';
    this.lastWriteRoomId = '';
    this.listening = false;
    this.clearTimers();
    this.dirty = false;
    this.writeAgain = false;
    this.lastRoomSnapshot = null;
    this.contentTrusted = false;
    this.joinQuarantine = false;
  }

  private async onGuestModePossiblyChanged() {
    if (Network.GuestMode()) {
      if (this.dirty || this.writing || this.writePromise) {
        await this.flush({
          timeoutMs: FolderBackupService.DEFAULT_FLUSH_TIMEOUT_MS,
          bypassGuest: true,
        });
      }
      this.listening = false;
      this.clearTimers();
      return;
    }
    await this.onNetworkOpen();
  }

  private onGameObjectDirty(aliasName?: string) {
    if (this.suspendAutoWrite || !this.listening || !this.canAutoWrite) return;
    if (aliasName === PeerCursor.aliasName) return;
    this.captureRoomSnapshot();
    this.markDirty();
  }

  private scheduleWrite() {
    if (!this.canAutoWrite) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.writeWhenAllowed();
    }, FolderBackupService.DEBOUNCE_MS);
  }

  private async writeWhenAllowed() {
    if (!this.canAutoWrite || !this.dirty) return;
    const elapsed = Date.now() - this.lastWriteAt;
    if (this.lastWriteAt > 0 && elapsed < FolderBackupService.MIN_INTERVAL_MS) {
      if (this.minIntervalTimer) clearTimeout(this.minIntervalTimer);
      this.minIntervalTimer = setTimeout(() => {
        this.minIntervalTimer = null;
        void this.writeWhenAllowed();
      }, FolderBackupService.MIN_INTERVAL_MS - elapsed);
      return;
    }
    await this.performWrite({});
  }

  private async flushWrites(options?: FolderFlushOptions): Promise<void> {
    // Suspend auto dirty while flushing — prepareRoomSnapshot / AFTER_ROOM_SAVE
    // otherwise markDirty mid-write and force a second full buildRoomFiles (slow).
    const prevSuspend = this.suspendAutoWrite;
    this.suspendAutoWrite = true;
    this.clearTimers();
    try {
      if (this.writePromise) {
        try {
          await this.writePromise;
        } catch {
          // Retry below.
        }
      }
      this.dirty = true;
      this.writeAgain = false;
      await this.performWrite(options || {});
      // Second pass only if another explicit writer joined mid-flight (writeAgain),
      // not for UI/sync noise while we were suspended.
      if (this.writeAgain) {
        this.writeAgain = false;
        this.dirty = true;
        await this.performWrite(options || {});
      }
    } finally {
      this.suspendAutoWrite = prevSuspend;
    }
  }

  private async performWrite(options: FolderFlushOptions): Promise<void> {
    if (this.writePromise) {
      this.writeAgain = true;
      this.dirty = true;
      await this.writePromise;
      if (!this.dirty && !this.writeAgain) return;
    }

    if (!this.dirHandle) return;
    if (Network.GuestMode() && !options.bypassGuest) return;

    const snapshot = options.snapshot || this.resolveSnapshot(options.allowLeave);
    if (!snapshot || !this.isSafeRoomFileName(snapshot.roomId)) return;

    this.writing = true;
    this.dirty = false;
    this.writeAgain = false;
    this.setStatus('writing');

    const run = async () => {
      // Pose flush / AFTER_ROOM_SAVE emit UPDATE_GAME_OBJECT; ignore them mid-write
      // so we do not immediately schedule a second full pack+zip.
      const prevSuspend = this.suspendAutoWrite;
      this.suspendAutoWrite = true;
      try {
        let metaAuth: {
          allowUser: boolean;
          allowGuest: boolean;
          secrets?: FolderBackupSecretsBlob;
        } | undefined;
        if (snapshot.auth) {
          metaAuth = await this.resolveMetaAuthForWrite(snapshot.roomId, snapshot.auth);
        }
        // Freeze previous latest into recent/calendar slots BEFORE overwriting latest.
        // (Post-write promote stamped slots with the new latestAt and prune/list hid them.)
        try {
          await this.archiveDueRetentionSlots(snapshot.roomId);
        } catch (e) {
          console.warn('FolderBackup retention archive failed (continuing latest write)', e);
        }
        // Capture while the map is still painted; write after state save.
        const previewBlob = await this.capturePreviewBlob();
        await this.saveDataService.saveRoomToDirectoryAsync(
          this.dirHandle,
          snapshot.roomId,
          snapshot.displayName,
          undefined,
          metaAuth
        );
        await this.writeLatestPreview(snapshot.roomId, previewBlob);
        this.lastWriteAt = Date.now();
        this.lastWriteRoomId = snapshot.roomId;
        this.lastSavedAt = new Date().toISOString();
        this.lastError = '';
        this.activeRoomId = snapshot.roomId;
        this.setStatus('ready');
      } catch (e) {
        console.warn('FolderBackup write failed', e);
        this.lastError = String((e as Error)?.message || e);
        this.dirty = true;
        const perm = this.dirHandle ? await this.queryPermission(this.dirHandle) : 'denied';
        this.setStatus(perm === 'granted' ? 'error' : 'needAuth');
        throw e;
      } finally {
        this.suspendAutoWrite = prevSuspend;
        this.writing = false;
        if (this.writeAgain) {
          this.writeAgain = false;
          this.dirty = true;
        }
        if (this.dirty && !options.bypassGuest && !options.allowLeave) {
          this.scheduleWrite();
        } else if (this.status === 'writing') {
          this.setStatus('ready');
        }
      }
    };

    this.writePromise = run().finally(() => {
      this.writePromise = null;
    });
    await this.writePromise;
  }

  private resolveSnapshot(allowLeave?: boolean): RoomSnapshot | null {
    // When leaving/switching, never re-capture from the new peer identity.
    if (allowLeave && this.lastRoomSnapshot) {
      return this.lastRoomSnapshot;
    }
    if (Network.peer?.isRoom && Network.peer.roomId) {
      this.captureRoomSnapshot();
      return this.lastRoomSnapshot;
    }
    return null;
  }

  private captureRoomSnapshot() {
    const peer = Network.peer;
    if (!peer?.isRoom || !peer.roomId) return;
    this.lastRoomSnapshot = {
      roomId: peer.roomId,
      displayName: RoomAuth.displayRoomName(peer.roomName || peer.roomId) || peer.roomId,
      auth: this.captureAuthSettings(peer.roomName || ''),
    };
  }

  private captureAuthSettings(roomName: string): RoomBackupAuthSettings {
    const info = RoomAuth.parse(roomName);
    const allowUser = info.user.mode !== 'disabled';
    const allowGuest = info.guest.mode !== 'disabled';
    return {
      allowUser,
      allowGuest,
      gmPassword: this.roomInvite.getRolePassword('gm'),
      userPassword: allowUser ? this.roomInvite.getRolePassword('user') : '',
      guestPassword: allowGuest ? this.roomInvite.getRolePassword('guest') : '',
    };
  }

  /**
   * GM writes full in-session passwords (including intentional clears).
   * Non-GM must not wipe secrets they don't know:
   * - merge empty fields with decryptable existing meta
   * - if existing secrets are undecryptable, keep the raw blob
   * - if no prior secrets, omit empty encrypted blob entirely
   */
  private async resolveMetaAuthForWrite(
    roomId: string,
    capture: RoomBackupAuthSettings
  ): Promise<{
    allowUser: boolean;
    allowGuest: boolean;
    secrets?: FolderBackupSecretsBlob;
  }> {
    const allow = {
      allowUser: !!capture.allowUser,
      allowGuest: !!capture.allowGuest,
    };
    const next = {
      gmPassword: String(capture.gmPassword || ''),
      userPassword: String(capture.userPassword || ''),
      guestPassword: String(capture.guestPassword || ''),
    };

    if (PeerCursor.myCursor?.isGMMode) {
      return {
        ...allow,
        secrets: await FolderBackupCrypto.encrypt(next),
      };
    }

    const existingMeta = await this.readExistingMeta(roomId);
    const existingPasswords = existingMeta
      ? await this.secretPasswordsFromMeta(existingMeta)
      : null;

    if (existingPasswords) {
      const merged = {
        gmPassword: next.gmPassword || existingPasswords.gmPassword,
        userPassword: next.userPassword || existingPasswords.userPassword,
        guestPassword: next.guestPassword || existingPasswords.guestPassword,
      };
      return {
        ...allow,
        secrets: await FolderBackupCrypto.encrypt(merged),
      };
    }

    if (existingMeta?.secrets) {
      // Other browser/device ciphertext — do not replace with empties or partial knowledge.
      return {
        ...allow,
        secrets: existingMeta.secrets,
      };
    }

    const hasAny = !!(next.gmPassword || next.userPassword || next.guestPassword);
    if (!hasAny) return allow;

    return {
      ...allow,
      secrets: await FolderBackupCrypto.encrypt(next),
    };
  }

  private async readExistingMeta(roomId: string): Promise<RoomBackupMeta | null> {
    if (!this.dirHandle || !this.isSafeRoomFileName(roomId)) return null;
    // Prefer v2 room.meta.json
    try {
      const roomsDir = await this.dirHandle.getDirectoryHandle(ROOMS_DIR);
      const roomDir = await roomsDir.getDirectoryHandle(roomId);
      const fileHandle = await roomDir.getFileHandle(ROOM_META_FILE);
      return JSON.parse(await (await fileHandle.getFile()).text()) as RoomBackupMeta;
    } catch { /* fall through */ }
    try {
      const fileHandle = await this.dirHandle.getFileHandle(`${roomId}.meta.json`);
      return JSON.parse(await (await fileHandle.getFile()).text()) as RoomBackupMeta;
    } catch {
      return null;
    }
  }

  /** Close lobby panel(s) left open after loading / resuming a room. */
  private closeLobbyWindows() {
    try {
      this.ngZone.run(() => PanelService.closePanelsByTourId('menu.lobby'));
    } catch { /* ignore */ }
  }

  private async capturePreviewBlob(): Promise<Blob | null> {
    try {
      const dataUrl = await captureMapPreviewDataUrl();
      return dataUrlToJpegBlob(dataUrl);
    } catch (e) {
      console.warn('FolderBackup preview capture failed', e);
      return null;
    }
  }

  private async writeLatestPreview(roomId: string, blob?: Blob | null): Promise<void> {
    if (!this.dirHandle || !this.isSafeRoomFileName(roomId)) return;
    try {
      const preview = blob ?? await this.capturePreviewBlob();
      if (!preview) return;
      const roomDir = await FileArchiver.instance.ensureDirectoryPath(
        this.dirHandle,
        [ROOMS_DIR, roomId, LATEST_DIR]
      );
      await FileArchiver.instance.writeBlobToDirectory(roomDir, PREVIEW_FILE, preview);
    } catch (e) {
      console.warn('FolderBackup preview failed', e);
    }
  }

  /**
   * Copy current `latest/` into recent/calendar slots when their intervals are due.
   * Must run before the next latest overwrite so checkpoints keep older content and timestamps.
   */
  private async archiveDueRetentionSlots(roomId: string): Promise<void> {
    if (!this.dirHandle) return;
    const archiver = FileArchiver.instance;
    const roomDir = await archiver.ensureDirectoryPath(this.dirHandle, [ROOMS_DIR, roomId]);

    let latestDir: FileSystemDirectoryHandle;
    try {
      latestDir = await roomDir.getDirectoryHandle(LATEST_DIR);
    } catch {
      return; // First save — nothing to archive yet.
    }

    const now = Date.now();
    let meta: FolderBackupRoomMetaV2;
    try {
      const raw = await (await roomDir.getFileHandle(ROOM_META_FILE)).getFile();
      meta = JSON.parse(await raw.text()) as FolderBackupRoomMetaV2;
    } catch {
      return;
    }

    const slots = { ...(meta.slots || {}) };
    const previousLatestIso = slots.latest || meta.savedAt || '';
    const previousLatestAt = Date.parse(previousLatestIso) || 0;
    if (!previousLatestAt) return;

    if (!meta.firstSavedAt) {
      meta.firstSavedAt = previousLatestIso;
    }
    const firstSavedMs = Date.parse(meta.firstSavedAt) || previousLatestAt;

    // Clean copies left by the old post-write promote (same timestamp as latest).
    await this.prunePrematureRetentionSlots(roomDir, slots, previousLatestAt);

    let changed = false;

    const recentTimes = Array.isArray(slots.recent) ? [...slots.recent] : [];
    let recentIndex = typeof slots.recentIndex === 'number' ? slots.recentIndex : 0;
    const lastRecentMs = recentTimes.reduce((max, t) => Math.max(max, Date.parse(t) || 0), 0);
    const recentDue = lastRecentMs
      ? now - lastRecentMs >= RECENT_INTERVAL_MS
      : now - firstSavedMs >= RECENT_INTERVAL_MS;
    if (recentDue) {
      const recentRoot = await archiver.ensureDirectory(roomDir, RECENT_DIR);
      const idx = recentIndex % RECENT_SLOT_COUNT;
      await archiver.replaceDirectoryFrom(recentRoot, String(idx), latestDir);
      recentTimes[idx] = previousLatestIso;
      recentIndex = (idx + 1) % RECENT_SLOT_COUNT;
      slots.recent = recentTimes;
      slots.recentIndex = recentIndex;
      changed = true;
    }

    const calendar: { dir: typeof SNAP_DIRS[number]; key: 'snap_1d' | 'snap_7d' | 'snap_30d'; ms: number }[] = [
      { dir: 'snap_1d', key: 'snap_1d', ms: SNAP_1D_MS },
      { dir: 'snap_7d', key: 'snap_7d', ms: SNAP_7D_MS },
      { dir: 'snap_30d', key: 'snap_30d', ms: SNAP_30D_MS },
    ];
    for (const c of calendar) {
      const prev = Date.parse(slots[c.key] || '') || 0;
      const due = prev ? now - prev >= c.ms : now - firstSavedMs >= c.ms;
      if (!due) continue;
      await archiver.replaceDirectoryFrom(roomDir, c.dir, latestDir);
      slots[c.key] = previousLatestIso;
      changed = true;
    }

    // prunePrematureRetentionSlots mutates `slots`; persist whenever anything changed.
    if (!changed && JSON.stringify(slots) === JSON.stringify(meta.slots || {})) return;

    meta.slots = slots;
    meta.formatVersion = FOLDER_BACKUP_FORMAT_VERSION;
    await archiver.writeBlobToDirectory(
      roomDir,
      ROOM_META_FILE,
      new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    );
  }

  /** Drop retention copies that are not older than latest (duplicate / first-save bug). */
  private async prunePrematureRetentionSlots(
    roomDir: FileSystemDirectoryHandle,
    slots: NonNullable<FolderBackupRoomMetaV2['slots']>,
    latestAt: number
  ): Promise<void> {
    const archiver = FileArchiver.instance;
    // Only drop near-duplicates of latest; valid checkpoints may be only seconds older
    // right after archive-then-write.
    const minGapMs = FolderBackupService.RETENTION_DISTINCT_MS;

    if (Array.isArray(slots.recent)) {
      const next: string[] = [];
      let any = false;
      for (let i = 0; i < Math.max(slots.recent.length, RECENT_SLOT_COUNT); i++) {
        const iso = slots.recent[i];
        const t = Date.parse(iso || '') || 0;
        if (iso && t && latestAt - t >= minGapMs) {
          next[i] = iso;
          any = true;
        } else if (iso) {
          try {
            const recentRoot = await roomDir.getDirectoryHandle(RECENT_DIR);
            await archiver.removeDirectoryRecursive(recentRoot, String(i));
          } catch { /* ignore */ }
        }
      }
      slots.recent = any ? next : undefined;
      if (!any) slots.recentIndex = 0;
    }

    const calendar: { key: 'snap_1d' | 'snap_7d' | 'snap_30d'; dir: string }[] = [
      { key: 'snap_1d', dir: 'snap_1d' },
      { key: 'snap_7d', dir: 'snap_7d' },
      { key: 'snap_30d', dir: 'snap_30d' },
    ];
    for (const c of calendar) {
      const t = Date.parse(slots[c.key] || '') || 0;
      if (!slots[c.key]) continue;
      if (t && latestAt - t >= minGapMs) continue;
      delete slots[c.key];
      try {
        await archiver.removeDirectoryRecursive(roomDir, c.dir);
      } catch { /* ignore */ }
    }
  }

  private async readV2RoomBackup(
    _roomsDir: FileSystemDirectoryHandle,
    roomId: string,
    roomDir: FileSystemDirectoryHandle
  ): Promise<RoomBackupInfo | null> {
    const metaFile = await (await roomDir.getFileHandle(ROOM_META_FILE)).getFile();
    const meta = JSON.parse(await metaFile.text()) as FolderBackupRoomMetaV2;
    if (!meta?.roomId) meta.roomId = roomId;
    const resolved = await this.authFromMeta(meta as RoomBackupMeta);
    const slots: RoomBackupSlot[] = [];

    const pushSlot = async (
      id: string,
      kind: FolderBackupSlotKind,
      savedAt: string,
      dir: FileSystemDirectoryHandle
    ) => {
      let previewUrl: string | undefined;
      try {
        const preview = await (await dir.getFileHandle(PREVIEW_FILE)).getFile();
        previewUrl = URL.createObjectURL(preview);
      } catch { /* no preview */ }
      slots.push({ id, kind, savedAt, previewUrl });
    };

    let latestMs = 0;
    try {
      const latestDir = await roomDir.getDirectoryHandle(LATEST_DIR);
      const latestAt = meta.slots?.latest || meta.savedAt || '';
      latestMs = Date.parse(latestAt) || 0;
      await pushSlot('latest', 'latest', latestAt, latestDir);
    } catch { /* missing latest */ }

    const isDistinctFromLatest = (savedAt: string): boolean => {
      const t = Date.parse(savedAt) || 0;
      if (!t) return false;
      if (latestMs) return latestMs - t >= FolderBackupService.RETENTION_DISTINCT_MS;
      return Date.now() - t >= FolderBackupService.RETENTION_DISTINCT_MS;
    };

    try {
      const recentRoot = await roomDir.getDirectoryHandle(RECENT_DIR);
      const recentTimes = meta.slots?.recent || [];
      for (let i = 0; i < RECENT_SLOT_COUNT; i++) {
        try {
          const d = await recentRoot.getDirectoryHandle(String(i));
          let savedAt = recentTimes[i] || '';
          if (!savedAt) {
            try {
              const man = await (await d.getFileHandle(MANIFEST_FILE)).getFile();
              const m = JSON.parse(await man.text()) as FolderBackupManifest;
              savedAt = m.savedAt || '';
            } catch { /* empty */ }
          }
          if (!savedAt || !isDistinctFromLatest(savedAt)) continue;
          await pushSlot(`recent/${i}`, 'recent', savedAt, d);
        } catch { /* missing slot */ }
      }
    } catch { /* no recent */ }

    for (const snap of SNAP_DIRS) {
      try {
        const d = await roomDir.getDirectoryHandle(snap);
        const savedAt = meta.slots?.[snap] || '';
        if (!savedAt || !isDistinctFromLatest(savedAt)) continue;
        await pushSlot(snap, snap, savedAt, d);
      } catch { /* missing */ }
    }

    const latest = slots.filter(s => s.kind === 'latest');
    const recent = slots.filter(s => s.kind === 'recent')
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
    const calendar = SNAP_DIRS.map(k => slots.find(s => s.kind === k)).filter(Boolean) as RoomBackupSlot[];
    const ordered = [...latest, ...recent, ...calendar];

    return {
      roomId: meta.roomId || roomId,
      displayName: meta.displayName || roomId,
      savedAt: meta.savedAt || latest[0]?.savedAt || '',
      auth: resolved.auth,
      authStatus: resolved.status,
      previewUrl: latest[0]?.previewUrl,
      format: 'v2',
      slots: ordered,
    };
  }

  private async collectV2SlotFiles(roomId: string, slot: RoomBackupSlot): Promise<File[]> {
    if (!this.dirHandle) return [];
    const archiver = FileArchiver.instance;
    const roomDir = await this.dirHandle.getDirectoryHandle(ROOMS_DIR).then(d => d.getDirectoryHandle(roomId));
    let slotDir: FileSystemDirectoryHandle;
    if (slot.id === 'latest') {
      slotDir = await roomDir.getDirectoryHandle(LATEST_DIR);
    } else if (slot.id.startsWith('recent/')) {
      const idx = slot.id.slice('recent/'.length);
      slotDir = await (await roomDir.getDirectoryHandle(RECENT_DIR)).getDirectoryHandle(idx);
    } else {
      slotDir = await roomDir.getDirectoryHandle(slot.id);
    }

    const slotFiles = await archiver.readFilesFromDirectory(slotDir);
    const loadFiles: File[] = [];
    let manifest: FolderBackupManifest | null = null;
    for (const f of slotFiles) {
      if (f.name === MANIFEST_FILE) {
        try {
          manifest = JSON.parse(await f.text()) as FolderBackupManifest;
        } catch { /* ignore */ }
        continue;
      }
      if (f.name === PREVIEW_FILE) continue;
      if (f.name === STATE_ZIP_FILE || f.name.endsWith('.zip')) {
        loadFiles.push(new File([f], f.name, { type: 'application/zip' }));
        continue;
      }
      // Legacy loose XML slots (pre state.zip).
      if (/\.(xml|json)$/i.test(f.name)) {
        loadFiles.push(new File([f], f.name, { type: f.type || MimeType.type(f.name) }));
      }
    }

    if (!loadFiles.some(f => /\.zip$/i.test(f.name)) && !loadFiles.some(f => /\.xml$/i.test(f.name))) {
      throw new Error('Backup slot has no state.zip');
    }

    const mediaDir = await this.dirHandle.getDirectoryHandle(MEDIA_DIR);
    const mediaNames = new Set<string>();
    if (manifest?.media?.length) {
      for (const m of manifest.media) {
        if (m.name) mediaNames.add(m.name);
      }
    } else {
      throw new Error('Backup manifest missing media list');
    }

    const missing: string[] = [];
    for (const name of mediaNames) {
      try {
        const file = await (await mediaDir.getFileHandle(name)).getFile();
        // Prefer extension-based MIME: File System Access often leaves file.type empty,
        // and empty||video/mpeg would mis-route legacy "<hash>.mpeg" MP3s.
        const type = MimeType.type(name) || file.type || '';
        loadFiles.unshift(new File([file], name, { type }));
      } catch {
        missing.push(name);
      }
    }
    if (missing.length) {
      throw new Error(`Missing media files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
    }
    return loadFiles;
  }

  private async secretPasswordsFromMeta(meta: RoomBackupMeta): Promise<{
    gmPassword: string;
    userPassword: string;
    guestPassword: string;
  } | null> {
    const resolved = await this.authFromMeta(meta);
    if (!resolved.auth) return null;
    if (resolved.status !== 'ready' && resolved.status !== 'legacy') return null;
    return {
      gmPassword: String(resolved.auth.gmPassword || ''),
      userPassword: String(resolved.auth.userPassword || ''),
      guestPassword: String(resolved.auth.guestPassword || ''),
    };
  }

  private resumeConfirmHelp(status: RoomBackupAuthStatus): string {
    const base = this.i18n.t('menu.confirm.loadFolder.help');
    let extra = this.i18n.t('menu.confirm.loadFolder.helpAuthMissing');
    switch (status) {
      case 'ready':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthReady');
        break;
      case 'legacy':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthLegacy');
        break;
      case 'undecryptable':
        extra = this.i18n.t('menu.confirm.loadFolder.helpAuthUndecryptable');
        break;
      default:
        break;
    }
    return `${base}\n\n${extra}`;
  }

  private async authFromMeta(meta: RoomBackupMeta): Promise<{
    auth?: RoomBackupAuthSettings;
    status: RoomBackupAuthStatus;
  }> {
    const hasAllow = meta.allowUser != null || meta.allowGuest != null;
    const hasLegacyPlain =
      meta.gmPassword != null || meta.userPassword != null || meta.guestPassword != null;
    const hasSecrets = !!meta.secrets;

    if (!hasAllow && !hasLegacyPlain && !hasSecrets) {
      return { status: 'missing' };
    }

    let gmPassword = '';
    let userPassword = '';
    let guestPassword = '';
    let status: RoomBackupAuthStatus = 'missing';

    if (meta.secrets) {
      const decrypted = await FolderBackupCrypto.decrypt(meta.secrets);
      if (decrypted) {
        gmPassword = decrypted.gmPassword;
        userPassword = decrypted.userPassword;
        guestPassword = decrypted.guestPassword;
        status = 'ready';
      } else {
        status = 'undecryptable';
      }
    } else if (hasLegacyPlain) {
      gmPassword = String(meta.gmPassword || '');
      userPassword = String(meta.userPassword || '');
      guestPassword = String(meta.guestPassword || '');
      status = 'legacy';
    } else if (hasAllow) {
      // Allow flags only — passwords never saved (or empty).
      status = 'missing';
    }

    return {
      status,
      auth: {
        allowUser: meta.allowUser !== false,
        allowGuest: meta.allowGuest !== false,
        gmPassword,
        userPassword,
        guestPassword,
      },
    };
  }

  private isSafeRoomFileName(roomId: string): boolean {
    return !!roomId && /^[A-Za-z0-9_-]{1,32}$/.test(roomId);
  }

  private isSafeZipFileName(name: string): boolean {
    return !!name && /^[A-Za-z0-9_-]{1,32}\.zip$/.test(name);
  }

  private async queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    if (typeof handle.queryPermission === 'function') {
      return handle.queryPermission({ mode: 'readwrite' });
    }
    return 'granted';
  }

  private async requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    if (typeof handle.requestPermission === 'function') {
      return handle.requestPermission({ mode: 'readwrite' });
    }
    return 'granted';
  }

  private setStatus(status: FolderBackupStatus) {
    this.ngZone.run(() => {
      this.status = status;
    });
  }

  private clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.minIntervalTimer) {
      clearTimeout(this.minIntervalTimer);
      this.minIntervalTimer = null;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('FolderBackup flush timeout')), timeoutMs);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }
}
