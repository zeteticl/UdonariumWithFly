import { AudioFile } from './core/file-storage/audio-file';
import { AudioStorage } from './core/file-storage/audio-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { InnerXml } from './core/synchronize-object/object-serializer';

/** HTML5 DnD MIME for library ↔ track / HUD drops. */
export const JUKEBOX_AUDIO_DRAG_MIME = 'application/x-udonarium-jukebox-audio';
/** JSON string[] of audio ids when dragging a multi-selection. */
export const JUKEBOX_AUDIO_DRAG_LIST_MIME = 'application/x-udonarium-jukebox-audio-list';
/** Stable library folder id for soundboard pads (created on first pad assign / drop). */
export const SOUNDBOARD_FOLDER_ID = 'soundboard';

export interface AudioLibraryFolder {
  id: string;
  name: string;
}

export interface AudioLibraryData {
  folders: AudioLibraryFolder[];
  /** audioId -> folderId (empty string = root) */
  membership: { [audioId: string]: string };
  /** audioId -> display name override */
  names: { [audioId: string]: string };
  /** folderId ('' = root) -> ordered audio ids */
  orders: { [folderId: string]: string[] };
  /** audioId -> preferred jukebox track index (only when user set) */
  trackTypes: { [audioId: string]: number };
  /** audioId -> true = LOOP, false = once (only when user set) */
  playLoops: { [audioId: string]: boolean };
  /** folderId -> default track index for folder playback */
  folderTrackTypes: { [folderId: string]: number };
  /** folderId -> default LOOP for folder playback */
  folderPlayLoops: { [folderId: string]: boolean };
  /** folderId -> true = shuffle order, false/unset = sequential */
  folderShuffles: { [folderId: string]: boolean };
}

function emptyData(): AudioLibraryData {
  return {
    folders: [],
    membership: {},
    names: {},
    orders: {},
    trackTypes: {},
    playLoops: {},
    folderTrackTypes: {},
    folderPlayLoops: {},
    folderShuffles: {},
  };
}

function normalizeData(raw: any): AudioLibraryData {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  if (Array.isArray(raw.folders)) {
    for (const f of raw.folders) {
      if (!f || typeof f.id !== 'string' || !f.id) continue;
      data.folders.push({
        id: f.id,
        name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : 'Folder',
      });
    }
  }
  if (raw.membership && typeof raw.membership === 'object') {
    for (const key of Object.keys(raw.membership)) {
      const v = raw.membership[key];
      data.membership[key] = typeof v === 'string' ? v : '';
    }
  }
  if (raw.names && typeof raw.names === 'object') {
    for (const key of Object.keys(raw.names)) {
      const v = raw.names[key];
      if (typeof v === 'string' && v.trim()) data.names[key] = v.trim();
    }
  }
  if (raw.orders && typeof raw.orders === 'object') {
    for (const key of Object.keys(raw.orders)) {
      const list = raw.orders[key];
      if (!Array.isArray(list)) continue;
      data.orders[key] = list.filter((id: any) => typeof id === 'string' && id);
    }
  }
  if (raw.trackTypes && typeof raw.trackTypes === 'object') {
    for (const key of Object.keys(raw.trackTypes)) {
      const v = Number(raw.trackTypes[key]);
      if (Number.isFinite(v) && v >= 0) data.trackTypes[key] = Math.floor(v);
    }
  }
  if (raw.playLoops && typeof raw.playLoops === 'object') {
    for (const key of Object.keys(raw.playLoops)) {
      data.playLoops[key] = !!raw.playLoops[key];
    }
  }
  if (raw.folderTrackTypes && typeof raw.folderTrackTypes === 'object') {
    for (const key of Object.keys(raw.folderTrackTypes)) {
      const v = Number(raw.folderTrackTypes[key]);
      if (Number.isFinite(v) && v >= 0) data.folderTrackTypes[key] = Math.floor(v);
    }
  }
  if (raw.folderPlayLoops && typeof raw.folderPlayLoops === 'object') {
    for (const key of Object.keys(raw.folderPlayLoops)) {
      data.folderPlayLoops[key] = !!raw.folderPlayLoops[key];
    }
  }
  if (raw.folderShuffles && typeof raw.folderShuffles === 'object') {
    for (const key of Object.keys(raw.folderShuffles)) {
      if (raw.folderShuffles[key]) data.folderShuffles[key] = true;
    }
  }
  return data;
}

function newFolderId(): string {
  return 'af_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function ensureOrderList(data: AudioLibraryData, folderId: string): string[] {
  const key = folderId || '';
  if (!Array.isArray(data.orders[key])) data.orders[key] = [];
  return data.orders[key];
}

function removeFromAllOrders(data: AudioLibraryData, audioId: string) {
  for (const key of Object.keys(data.orders)) {
    data.orders[key] = (data.orders[key] || []).filter(id => id !== audioId);
  }
}

function removeFromOrder(data: AudioLibraryData, folderId: string, audioId: string) {
  const key = folderId || '';
  data.orders[key] = (data.orders[key] || []).filter(id => id !== audioId);
}

/** Per-folder item setting key (legacy keys are bare audioId). */
function itemSettingKey(folderId: string, audioId: string): string {
  return (folderId || '') + '\n' + audioId;
}

function folderIdsContaining(data: AudioLibraryData, audioId: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(data.orders)) {
    if ((data.orders[key] || []).includes(audioId) && !seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
  }
  if (Object.prototype.hasOwnProperty.call(data.membership, audioId)) {
    const m = data.membership[audioId] || '';
    if (!seen.has(m)) found.push(m);
  }
  return found;
}

function clearItemSettingsForAudio(data: AudioLibraryData, audioId: string) {
  delete data.names[audioId];
  delete data.trackTypes[audioId];
  delete data.playLoops[audioId];
  const suffix = '\n' + audioId;
  for (const key of Object.keys(data.trackTypes)) {
    if (key.endsWith(suffix)) delete data.trackTypes[key];
  }
  for (const key of Object.keys(data.playLoops)) {
    if (key.endsWith(suffix)) delete data.playLoops[key];
  }
}

function clearItemSettingsForFolder(data: AudioLibraryData, folderId: string) {
  const prefix = (folderId || '') + '\n';
  for (const key of Object.keys(data.trackTypes)) {
    if (key.startsWith(prefix)) delete data.trackTypes[key];
  }
  for (const key of Object.keys(data.playLoops)) {
    if (key.startsWith(prefix)) delete data.playLoops[key];
  }
}

@SyncObject('audio-library')
export class AudioLibrary extends GameObject implements InnerXml {
  @SyncVar() dataJson: string = JSON.stringify(emptyData());

  private static _instance: AudioLibrary;

  static get instance(): AudioLibrary {
    if (AudioLibrary._instance) return AudioLibrary._instance;
    const existing = ObjectStore.instance.get<AudioLibrary>('AudioLibrary');
    if (existing) {
      AudioLibrary._instance = existing;
      return existing;
    }
    AudioLibrary._instance = new AudioLibrary('AudioLibrary');
    AudioLibrary._instance.initialize();
    return AudioLibrary._instance;
  }

  /** Target folder for the next FileArchiver audio import (null = root / unchanged). */
  importFolderId: string | null = null;

  get data(): AudioLibraryData {
    try {
      return normalizeData(this.dataJson ? JSON.parse(this.dataJson) : null);
    } catch {
      return emptyData();
    }
  }

  set data(value: AudioLibraryData) {
    this.dataJson = JSON.stringify(normalizeData(value));
  }

  get folders(): AudioLibraryFolder[] {
    return this.data.folders;
  }

  displayName(audio: AudioFile): string {
    if (!audio) return '';
    const override = this.data.names[audio.identifier];
    return override || audio.name || audio.identifier;
  }

  folderOf(audioId: string): string {
    if (!audioId) return '';
    if (Object.prototype.hasOwnProperty.call(this.data.membership, audioId)) {
      return this.data.membership[audioId] || '';
    }
    const folders = folderIdsContaining(this.data, audioId);
    return folders.length ? folders[0] : '';
  }

  /** Folders that currently list this audio (same blob may appear in several). */
  foldersOf(audioId: string): string[] {
    if (!audioId) return [];
    return folderIdsContaining(this.data, audioId);
  }

  isInFolder(audioId: string, folderId: string): boolean {
    if (!audioId) return false;
    const fid = folderId || '';
    if ((this.data.orders[fid] || []).includes(audioId)) return true;
    const inAnyOrder = Object.keys(this.data.orders).some(k => (this.data.orders[k] || []).includes(audioId));
    if (inAnyOrder) return false;
    return (this.data.membership[audioId] || '') === fid;
  }

  audiosInFolder(folderId: string, audios: AudioFile[]): AudioFile[] {
    const fid = folderId || '';
    const byId = new Map(audios.map(a => [a.identifier, a]));
    const order = this.data.orders[fid] || [];
    const result: AudioFile[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      const a = byId.get(id);
      if (!a || seen.has(id)) continue;
      result.push(a);
      seen.add(id);
    }
    // Legacy: membership-only rows not yet written into orders[].
    for (const a of audios) {
      if (seen.has(a.identifier)) continue;
      if ((this.data.membership[a.identifier] || '') === fid) {
        result.push(a);
        seen.add(a.identifier);
      }
    }
    return result;
  }

  /**
   * Full folder order as shown in the UI (membership ∩ order, not the raw orders[] alone).
   * Raw `orders` can be shorter than the visible list — never use it alone for insert indices.
   */
  orderedIdsInFolder(folderId: string): string[] {
    const audios = AudioStorage.instance.audios.filter(a => !a.isHidden);
    return this.audiosInFolder(folderId || '', audios).map(a => a.identifier);
  }

  createFolder(name: string): AudioLibraryFolder {
    const data = this.data;
    const folder: AudioLibraryFolder = {
      id: newFolderId(),
      name: (name || '').trim() || 'Folder',
    };
    data.folders.push(folder);
    data.orders[folder.id] = [];
    this.data = data;
    return folder;
  }

  /**
   * Ensure a folder with a stable id exists (e.g. soundboard).
   * Does not rename an existing folder so user edits stick.
   */
  ensureFolder(id: string, name: string): AudioLibraryFolder {
    const fid = (id || '').trim();
    if (!fid) return this.createFolder(name);
    const data = this.data;
    const existing = data.folders.find(f => f.id === fid);
    if (existing) {
      ensureOrderList(data, fid);
      this.data = data;
      return existing;
    }
    const folder: AudioLibraryFolder = {
      id: fid,
      name: (name || '').trim() || 'Folder',
    };
    data.folders.push(folder);
    data.orders[folder.id] = [];
    this.data = data;
    return folder;
  }

  renameFolder(folderId: string, name: string) {
    const data = this.data;
    const folder = data.folders.find(f => f.id === folderId);
    if (!folder) return;
    folder.name = (name || '').trim() || folder.name;
    this.data = data;
  }

  deleteFolder(folderId: string) {
    const data = this.data;
    data.folders = data.folders.filter(f => f.id !== folderId);
    const moved = data.orders[folderId] || [];
    delete data.orders[folderId];
    delete data.folderTrackTypes[folderId];
    delete data.folderPlayLoops[folderId];
    delete data.folderShuffles[folderId];
    clearItemSettingsForFolder(data, folderId);
    const root = ensureOrderList(data, '');
    for (const id of moved) {
      const others = folderIdsContaining(data, id).filter(fid => fid !== folderId);
      if (others.length < 1) {
        data.membership[id] = '';
        if (!root.includes(id)) root.push(id);
      } else if ((data.membership[id] || '') === folderId) {
        data.membership[id] = others[0];
      }
    }
    for (const id of Object.keys(data.membership)) {
      if (data.membership[id] === folderId) {
        const others = folderIdsContaining(data, id);
        data.membership[id] = others.length ? others[0] : '';
        if (!others.length && !root.includes(id)) root.push(id);
      }
    }
    this.data = data;
  }

  /**
   * Move/reorder many audios as one block (preserves `audioIds` order).
   * `insertIndex` is the destination index in the *visible* folder list before removal.
   */
  moveManyAt(audioIds: string[], folderId: string, insertIndex: number) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of audioIds || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length < 1) return;

    const data = this.data;
    if (folderId && !data.folders.some(f => f.id === folderId)) folderId = '';
    const dest = folderId || '';

    // Must match UI order (audiosIn), not the possibly-incomplete orders[].
    const current = this.orderedIdsInFolder(dest);
    const raw = Number(insertIndex);
    let index = Number.isFinite(raw)
      ? Math.max(0, Math.min(Math.floor(raw), current.length))
      : current.length;

    for (const id of ids) {
      const at = current.indexOf(id);
      if (at >= 0 && at < index) index--;
    }

    for (const id of ids) {
      data.membership[id] = dest;
      removeFromAllOrders(data, id);
    }

    const remaining = current.filter(id => !seen.has(id));
    index = Math.max(0, Math.min(index, remaining.length));
    remaining.splice(index, 0, ...ids);
    // Persist the full visible order so later inserts stay aligned with the UI.
    data.orders[dest] = remaining;
    this.data = data;
  }

  /**
   * Move/reorder many audios as one block before `beforeAudioId` (or append when null).
   */
  moveMany(audioIds: string[], folderId: string, beforeAudioId: string | null = null) {
    if (folderId && !this.data.folders.some(f => f.id === folderId)) folderId = '';
    const dest = folderId || '';
    const current = this.orderedIdsInFolder(dest);
    let insertIndex = current.length;
    if (beforeAudioId) {
      const at = current.indexOf(beforeAudioId);
      if (at >= 0) insertIndex = at;
    }
    this.moveManyAt(audioIds, dest, insertIndex);
  }

  moveToFolder(audioId: string, folderId: string, beforeAudioId: string | null = null) {
    if (!audioId) return;
    this.moveMany([audioId], folderId, beforeAudioId);
  }

  /** Reorder within the same folder (or move+insert when folder differs). */
  reorder(audioId: string, folderId: string, beforeAudioId: string | null) {
    if (!audioId || audioId === beforeAudioId) return;
    this.moveMany([audioId], folderId || '', beforeAudioId);
  }

  renameAudio(audioId: string, name: string) {
    if (!audioId) return;
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const data = this.data;
    data.names[audioId] = trimmed;
    this.data = data;
    const audio = AudioStorage.instance.get(audioId);
    if (audio) {
      const ctx = audio.toContext();
      AudioStorage.instance.add({
        identifier: audio.identifier,
        name: trimmed,
        type: ctx.type,
        blob: audio.blob,
        url: audio.url,
      });
    }
  }

  removeAudioMeta(audioId: string) {
    if (!audioId) return;
    const data = this.data;
    delete data.membership[audioId];
    clearItemSettingsForAudio(data, audioId);
    removeFromAllOrders(data, audioId);
    this.data = data;
  }

  /**
   * Remove audio from one folder only. Returns true if the audio is no longer listed anywhere
   * (caller may delete the blob from AudioStorage).
   */
  removeFromFolder(audioId: string, folderId: string): boolean {
    if (!audioId) return true;
    const data = this.data;
    const fid = folderId || '';
    removeFromOrder(data, fid, audioId);
    delete data.trackTypes[itemSettingKey(fid, audioId)];
    delete data.playLoops[itemSettingKey(fid, audioId)];
    const remaining = folderIdsContaining(data, audioId).filter(id => id !== fid);
    if (remaining.length < 1) {
      delete data.membership[audioId];
      clearItemSettingsForAudio(data, audioId);
      this.data = data;
      return true;
    }
    if ((data.membership[audioId] || '') === fid) data.membership[audioId] = remaining[0];
    this.data = data;
    return false;
  }

  /** Whether this audio has an explicit track override (folder-scoped when folderId given). */
  hasTrackType(audioId: string, folderId?: string): boolean {
    if (!audioId) return false;
    if (folderId != null) {
      if (Object.prototype.hasOwnProperty.call(this.data.trackTypes, itemSettingKey(folderId, audioId))) return true;
    }
    return Object.prototype.hasOwnProperty.call(this.data.trackTypes, audioId);
  }

  /** Raw preferred track index (0 if unset). Prefer effectiveTrackType(). */
  trackTypeOf(audioId: string, folderId?: string): number {
    if (!audioId) return 0;
    if (folderId != null) {
      const scoped = this.data.trackTypes[itemSettingKey(folderId, audioId)];
      if (Number.isFinite(scoped) && scoped >= 0) return Math.floor(scoped);
    }
    const v = this.data.trackTypes[audioId];
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }

  setTrackType(audioId: string, trackIndex: number, folderId?: string) {
    if (!audioId) return;
    const data = this.data;
    const value = Math.max(0, Math.floor(trackIndex) || 0);
    if (folderId != null) data.trackTypes[itemSettingKey(folderId, audioId)] = value;
    else data.trackTypes[audioId] = value;
    this.data = data;
  }

  clearTrackType(audioId: string, folderId?: string) {
    if (!audioId) return;
    const data = this.data;
    if (folderId != null) delete data.trackTypes[itemSettingKey(folderId, audioId)];
    else delete data.trackTypes[audioId];
    this.data = data;
  }

  folderTrackType(folderId: string): number {
    const v = this.data.folderTrackTypes[folderId || ''];
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  }

  setFolderTrackType(folderId: string, trackIndex: number) {
    const data = this.data;
    data.folderTrackTypes[folderId || ''] = Math.max(0, Math.floor(trackIndex) || 0);
    this.data = data;
  }

  /**
   * Effective track: folder-scoped override > legacy audio override > folder default.
   */
  effectiveTrackType(audioId: string, folderId?: string): number {
    const fid = folderId != null ? folderId : this.folderOf(audioId);
    if (fid != null && Object.prototype.hasOwnProperty.call(this.data.trackTypes, itemSettingKey(fid, audioId))) {
      return this.trackTypeOf(audioId, fid);
    }
    if (Object.prototype.hasOwnProperty.call(this.data.trackTypes, audioId)) {
      return this.trackTypeOf(audioId);
    }
    return this.folderTrackType(fid);
  }

  hasPlayLoop(audioId: string, folderId?: string): boolean {
    if (!audioId) return false;
    if (folderId != null) {
      if (Object.prototype.hasOwnProperty.call(this.data.playLoops, itemSettingKey(folderId, audioId))) return true;
    }
    return Object.prototype.hasOwnProperty.call(this.data.playLoops, audioId);
  }

  /** Raw play-loop flag (default true if unset). Prefer effectivePlayLoop(). */
  playLoopOf(audioId: string, folderId?: string): boolean {
    if (!audioId) return true;
    if (folderId != null) {
      const key = itemSettingKey(folderId, audioId);
      if (Object.prototype.hasOwnProperty.call(this.data.playLoops, key)) return this.data.playLoops[key] !== false;
    }
    return this.data.playLoops[audioId] !== false;
  }

  setPlayLoop(audioId: string, isLoop: boolean, folderId?: string) {
    if (!audioId) return;
    const data = this.data;
    if (folderId != null) data.playLoops[itemSettingKey(folderId, audioId)] = !!isLoop;
    else data.playLoops[audioId] = !!isLoop;
    this.data = data;
  }

  folderPlayLoop(folderId: string): boolean {
    return this.data.folderPlayLoops[folderId || ''] !== false;
  }

  setFolderPlayLoop(folderId: string, isLoop: boolean) {
    const data = this.data;
    data.folderPlayLoops[folderId || ''] = !!isLoop;
    this.data = data;
  }

  /** Whether folder playback uses shuffle order (default: sequential). */
  folderShuffle(folderId: string): boolean {
    return !!this.data.folderShuffles[folderId || ''];
  }

  setFolderShuffle(folderId: string, shuffle: boolean) {
    const data = this.data;
    const fid = folderId || '';
    if (shuffle) data.folderShuffles[fid] = true;
    else delete data.folderShuffles[fid];
    this.data = data;
  }

  /** Effective LOOP: folder-scoped override > legacy audio override > folder default. */
  effectivePlayLoop(audioId: string, folderId?: string): boolean {
    const fid = folderId != null ? folderId : this.folderOf(audioId);
    if (folderId != null && Object.prototype.hasOwnProperty.call(this.data.playLoops, itemSettingKey(folderId, audioId))) {
      return this.playLoopOf(audioId, folderId);
    }
    if (Object.prototype.hasOwnProperty.call(this.data.playLoops, audioId)) {
      return this.playLoopOf(audioId);
    }
    return this.folderPlayLoop(fid);
  }

  /**
   * Ensure audio appears in a folder order.
   * Same content may be listed in multiple folders (does not remove other memberships).
   */
  ensureListed(audioId: string, folderId?: string) {
    if (!audioId) return;
    const data = this.data;
    let dest: string;
    if (folderId !== undefined) dest = folderId || '';
    else if (this.importFolderId != null) dest = this.importFolderId || '';
    else if (Object.prototype.hasOwnProperty.call(data.membership, audioId)) {
      dest = data.membership[audioId] || '';
      const existing = ensureOrderList(data, dest);
      if (!existing.includes(audioId)) existing.push(audioId);
      this.data = data;
      return;
    } else dest = '';

    const list = ensureOrderList(data, dest);
    if (!list.includes(audioId)) list.push(audioId);
    if (!Object.prototype.hasOwnProperty.call(data.membership, audioId)) {
      data.membership[audioId] = dest;
    }
    this.data = data;
  }

  innerXml(): string { return ''; }

  parseInnerXml(element: Element) {
    const context = AudioLibrary.instance.toContext();
    context.syncData = this.toContext().syncData;
    AudioLibrary.instance.apply(context);
    AudioLibrary.instance.update();
    this.destroy();
  }
}
