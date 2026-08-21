import { ImageFile, ImageState } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { GameObject, ObjectContext } from './core/synchronize-object/game-object';
import { ObjectStore } from './core/synchronize-object/object-store';
import { EventSystem, Network } from './core/system';
import { translate } from 'i18n';
import { PEER_PASTEL_PALETTE } from './peer-pastel-palette';

import * as localForage from 'localforage';

type UserId = string;
type PeerId = string;
type ObjectIdentifier = string;

@SyncObject('PeerCursor')
export class PeerCursor extends GameObject {
  @SyncVar() userId: UserId = '';
  @SyncVar() peerId: PeerId = '';
  @SyncVar() name: string = '';
  @SyncVar() imageIdentifier: string = '';
  @SyncVar() color: string = PeerCursor.CHAT_DEFAULT_COLOR;
  @SyncVar() isGMMode: boolean = true;
  /** Which GameTable this peer is currently viewing (scene presence). */
  @SyncVar() viewedSceneIdentifier: string = '';

  static isGMHold: boolean = false;

  static readonly CHAT_MY_NAME_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-name-local-storage';
  static readonly CHAT_MY_COLOR_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-color-local-storage';
  static readonly CHAT_MY_ICON_LOCAL_STORAGE_KEY = 'udonanaumu-chat-my-icon-local-storage';

  static readonly CHAT_DEFAULT_COLOR = '#444444';
  static get CHAT_DEFAULT_NAME(): string { return translate('peer.defaultName'); }
  static readonly CHAT_TRANSPARENT_COLOR = '#ffffff';
  static readonly PASTEL_PALETTE = PEER_PASTEL_PALETTE;
  /** Alias: mid-tone readable peer colors (same array as PASTEL_PALETTE). */
  static readonly COLOR_PALETTE = PEER_PASTEL_PALETTE;
  /** e.g. `玩家3847` / `Player0421` — used when no nickname has been saved yet. */
  static generateDefaultName(): string {
    const n = Math.floor(Math.random() * 10000);
    return `${PeerCursor.CHAT_DEFAULT_NAME}${String(n).padStart(4, '0')}`;
  }

  /** If name is empty on first cursor create, assign a random-suffixed default and persist it. */
  static async ensureDefaultName(): Promise<void> {
    if (!PeerCursor.myCursor) return;
    if ((PeerCursor.myCursor.name || '').trim()) return;
    PeerCursor.myCursor.name = PeerCursor.generateDefaultName();
    try {
      await localForage.setItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY, PeerCursor.myCursor.name);
    } catch (e) {
      console.log(e);
    }
  }

  /** Pick a random mid-tone color not used by peers in the room (fallback: random from full palette). */
  static pickAvailablePastelColor(): string {
    const palette = PeerCursor.COLOR_PALETTE;
    const used = new Set(
      ObjectStore.instance.getObjects<PeerCursor>(PeerCursor)
        .map(p => (p.color || '').trim().toLowerCase())
        .filter(c => !!c),
    );
    const available = palette.filter(c => !used.has(c.toLowerCase()));
    const pool = available.length ? available : palette;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * First visit (no saved color, or still default gray): assign a soft pastel and persist.
   * Does not overwrite a user-chosen / previously saved color.
   */
  static async ensureDefaultColor(): Promise<void> {
    if (!PeerCursor.myCursor) return;
    const c = (PeerCursor.myCursor.color || '').trim().toLowerCase();
    if (c
      && c !== PeerCursor.CHAT_DEFAULT_COLOR.toLowerCase()
      && c !== PeerCursor.CHAT_TRANSPARENT_COLOR.toLowerCase()
      && /^#[0-9a-f]{6}$/.test(c)) {
      return;
    }
    const next = PeerCursor.pickAvailablePastelColor();
    PeerCursor.myCursor.color = next;
    try {
      await localForage.setItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY, next);
    } catch (e) {
      console.log(e);
    }
  }

  static myCursor: PeerCursor = null;
  private static userIdMap: Map<UserId, ObjectIdentifier> = new Map();
  private static peerIdMap: Map<PeerId, ObjectIdentifier> = new Map();

  get isMine(): boolean { return (PeerCursor.myCursor && PeerCursor.myCursor === this); }
  get image(): ImageFile { return ImageStorage.instance.get(this.imageIdentifier); }

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    if (!this.isMine) {
      EventSystem.register(this)
        .on('DISCONNECT_PEER', event => {
          if (event.data.peerId !== this.peerId) return;
          setTimeout(() => {
            if (Network.peerIds.includes(this.peerId)) return;
            PeerCursor.userIdMap.delete(this.userId);
            PeerCursor.peerIdMap.delete(this.peerId);
            ObjectStore.instance.remove(this);
          }, 30000);
        });
    }
  }

  // GameObject Lifecycle
  onStoreRemoved() {
    super.onStoreRemoved();
    EventSystem.unregister(this);
    PeerCursor.userIdMap.delete(this.userId);
    PeerCursor.peerIdMap.delete(this.peerId);
  }

  static findByUserId(userId: UserId): PeerCursor {
    return this.find(PeerCursor.userIdMap, userId, true);
  }

  static findByPeerId(peerId: PeerId): PeerCursor {
    return this.find(PeerCursor.peerIdMap, peerId, false);
  }

  private static find(map: Map<string, string>, key: string, isUserId: boolean): PeerCursor {
    let identifier = map.get(key);
    if (identifier != null && ObjectStore.instance.get(identifier)) return ObjectStore.instance.get<PeerCursor>(identifier);
    let cursors = ObjectStore.instance.getObjects<PeerCursor>(PeerCursor);
    for (let cursor of cursors) {
      let id = isUserId ? cursor.userId : cursor.peerId;
      if (id === key) {
        map.set(id, cursor.identifier);
        return cursor;
      }
    }
    return null;
  }

  static async createMyCursor(): Promise<PeerCursor> {
    if (PeerCursor.myCursor) {
      console.warn('It is already created.');
      return PeerCursor.myCursor;
    }
    PeerCursor.myCursor = new PeerCursor();
    PeerCursor.myCursor.peerId = Network.peerId;
    PeerCursor.myCursor.initialize();
    try {
      // 為相容暫時保留 ---
      try {
        if (window.localStorage && localStorage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY)) {
          PeerCursor.myCursor.name = localStorage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
          await localForage.setItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY, PeerCursor.myCursor.name, () => {
            localStorage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
          });
        }
      } catch(e) {
        console.log(e);
      }
      try {
        if (window.localStorage && localStorage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY)) {
          PeerCursor.myCursor.color = localStorage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
          await localForage.setItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY, PeerCursor.myCursor.color, () => {
            localStorage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
          });
        }
      } catch(e) {
        console.log(e);
      }
      // ---
      await localForage.getItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).then(name => {
        if (typeof name === 'string') {
          PeerCursor.myCursor.name = name;
        } else {
          if (name !== undefined) localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY);
        }
      });
      await localForage.getItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).then(color => {
        if (typeof color === 'string' && /^\#[0-9a-f]{6}$/.test(color.trim().toLowerCase())) {
          PeerCursor.myCursor.color = color.trim().toLowerCase();
        } else {
          if (color !== undefined) localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY);
        }
      });
      // 圖示
      try { 
        await localForage.getItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY).then(identifierOrImageData => {
          let blob: Blob = null;
          if (typeof identifierOrImageData === 'string') {
            if (identifierOrImageData.startsWith('data:image/')) {
              const type = identifierOrImageData.substring('data:'.length, identifierOrImageData.indexOf(';'));
              const bin = atob(identifierOrImageData.replace(/^.*,/, '')); 
              let buffer = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) {
                buffer[i] = bin.charCodeAt(i);
              }
              blob = new Blob([buffer.buffer], { type: type });
            } else {
              const identifier = ImageStorage.instance.images.find(image => image.identifier === identifierOrImageData);
              if (identifier) {
                PeerCursor.myCursor.imageIdentifier = identifierOrImageData;
              } else {
                localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
              }
            }
          } else if (identifierOrImageData instanceof Blob) {
            blob = identifierOrImageData;
          } else {
            localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
          }
          if (blob) {
            ImageFile.createAsync(blob).then(imageFile => {
              if (imageFile.state === ImageState.COMPLETE) {
                ImageStorage.instance.add(imageFile);
                PeerCursor.myCursor.imageIdentifier = imageFile.identifier;
              } else {
                localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
              }
            });
          }
        }).catch(e => { throw e; });
      } catch (e) {
        console.log(e);
        localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY);
      }
    } catch (e) {
      console.log(e);
      await localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      await localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    await PeerCursor.ensureDefaultName();
    await PeerCursor.ensureDefaultColor();
    // TableSelecter may have run ensureActiveOrFirst before myCursor existed — publish presence now.
    EventSystem.trigger('MY_PEER_CURSOR_READY', {});
    return PeerCursor.myCursor;
  }

  // override
  apply(context: ObjectContext) {
    let userId = context.syncData['userId'];
    let peerId = context.syncData['peerId'];
    if (userId !== this.userId) {
      PeerCursor.userIdMap.set(userId, this.identifier);
      PeerCursor.userIdMap.delete(this.userId);
    }
    if (peerId !== this.peerId) {
      PeerCursor.peerIdMap.set(peerId, this.identifier);
      PeerCursor.peerIdMap.delete(this.peerId);
    }
    super.apply(context);
  }

  isPeerAUdon(): boolean {
    return /u.*d.*o.*n/ig.exec(this.peerId) != null;
  }
}
