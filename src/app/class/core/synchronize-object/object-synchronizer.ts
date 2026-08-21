import { EventSystem, Network } from '../system';
import { netDebug } from '../system/network/net-debug';
import { GameObject, ObjectContext } from './game-object';
import { markForChanged } from './object-event-extension';
import { ObjectFactory } from './object-factory';
import { CatalogItem, ObjectStore } from './object-store';
import { SynchronizeRequest, SynchronizeTask } from './synchronize-task';

type PeerId = string;
type ObjectIdentifier = string;

export class ObjectSynchronizer {
  private static _instance: ObjectSynchronizer
  static get instance(): ObjectSynchronizer {
    if (!ObjectSynchronizer._instance) ObjectSynchronizer._instance = new ObjectSynchronizer();
    return ObjectSynchronizer._instance;
  }

  private requestMap: Map<ObjectIdentifier, SynchronizeRequest> = new Map();
  private peerMap: Map<PeerId, SynchronizeTask[]> = new Map();
  private tasks: SynchronizeTask[] = [];
  /** Nested hold: skip inbound apply and delay catalog send (folder resume / ZIP load). */
  private peerSyncHold = 0;
  private pendingCatalogPeers = new Set<PeerId>();
  private pendingInboundCatalogs: { items: CatalogItem[]; sendFrom: string }[] = [];
  private pendingInboundUpdates: { context: ObjectContext; sendFrom: string }[] = [];
  /** Join probe: pull host catalogs/requests while still holding inbound apply. */
  private joinFetch = false;

  private constructor() { }

  initialize() {
    this.destroy();
    EventSystem.register(this)
      .on('CONNECT_PEER', 2, event => {
        if (!event.isSendFromSelf) return;
        netDebug('CONNECT_PEER GameRoomService !!!', event.data.peerId);
        if (this.peerSyncHold > 0) {
          this.pendingCatalogPeers.add(event.data.peerId);
          return;
        }
        this.sendCatalog(event.data.peerId);
      })
      .on('DISCONNECT_PEER', event => {
        this.removePeerMap(event.data.peerId);
        this.pendingCatalogPeers.delete(event.data.peerId);
      })
      .on<CatalogItem[]>('SYNCHRONIZE_GAME_OBJECT', event => {
        if (event.isSendFromSelf) return;
        if (this.peerSyncHold > 0) {
          if (this.joinFetch) {
            this.applyInboundCatalog(event.data, event.sendFrom);
          } else {
            const items = Array.isArray(event.data) ? event.data.slice() : [];
            this.pendingInboundCatalogs.push({ items, sendFrom: event.sendFrom });
          }
          return;
        }
        this.applyInboundCatalog(event.data, event.sendFrom);
      })
      .on('REQUEST_GAME_OBJECT', event => {
        if (event.isSendFromSelf) return;
        if (this.peerSyncHold > 0) return;
        if (ObjectStore.instance.isDeleted(event.data)) {
          EventSystem.call('DELETE_GAME_OBJECT', { aliasName: '', identifier: event.data }, event.sendFrom);
        } else {
          let object: GameObject = ObjectStore.instance.get(event.data);
          if (object) EventSystem.call('UPDATE_GAME_OBJECT', object.toContext(), event.sendFrom);
        }
      })
      .on('UPDATE_GAME_OBJECT', 1000, event => {
        if (this.peerSyncHold > 0 && !event.isSendFromSelf) {
          this.pendingInboundUpdates.push({ context: event.data, sendFrom: event.sendFrom });
          return;
        }
        this.applyInboundUpdate(event.data, event.sendFrom, event.isSendFromSelf);
      })
      .on('DELETE_GAME_OBJECT', 1000, event => {
        // Local destroy already removed the object; the network layer echoes our own
        // DELETE back on a later tick. Applying that echo after Room ZIP reload would
        // delete the freshly recreated objects that reuse the same syncId.
        if (event.isSendFromSelf) return;
        if (this.peerSyncHold > 0) return;
        let identifier: ObjectIdentifier = event.data.identifier;
        ObjectStore.instance.delete(identifier, false);
      });
  }

  /** Pause catalog/inbound apply so a join-then-load does not push lobby defaults. */
  holdPeerSync() {
    this.peerSyncHold++;
  }

  /** Join probe: request host objects without applying them to the local tabletop. */
  enableJoinFetch() {
    this.joinFetch = true;
  }

  disableJoinFetch() {
    this.joinFetch = false;
  }

  /**
   * Resume sync. When applyQueued is true, apply held inbound updates/catalogs then
   * send our catalog. When false (failed join/load), drop the queues.
   */
  releasePeerSync(applyQueued = true) {
    if (this.peerSyncHold < 1) return;
    this.peerSyncHold--;
    if (this.peerSyncHold > 0) return;
    const updates = this.pendingInboundUpdates;
    this.pendingInboundUpdates = [];
    const inbound = this.pendingInboundCatalogs;
    this.pendingInboundCatalogs = [];
    if (applyQueued) {
      updates.sort((a, b) => inboundApplyRank(a.context?.aliasName) - inboundApplyRank(b.context?.aliasName));
      for (const { context, sendFrom } of updates) {
        this.applyInboundUpdate(context, sendFrom, false);
      }
      for (const { items, sendFrom } of inbound) {
        this.applyInboundCatalog(items, sendFrom);
      }
      for (const peerId of this.pendingCatalogPeers) {
        this.sendCatalog(peerId);
      }
    }
    this.pendingCatalogPeers.clear();
  }

  destroy() {
    EventSystem.unregister(this);
    this.peerSyncHold = 0;
    this.pendingCatalogPeers.clear();
    this.pendingInboundCatalogs = [];
    this.pendingInboundUpdates = [];
    this.joinFetch = false;
  }

  private applyInboundUpdate(context: ObjectContext, sendFrom: string, isSendFromSelf: boolean) {
    let object: GameObject = ObjectStore.instance.get(context.identifier);
    if (object) {
      let updateObject = isSendFromSelf ? object : this.updateObject(object, context);
      if (updateObject) {
        markForChanged(updateObject, sendFrom);
      } else if (!isSendFromSelf) {
        EventSystem.call('UPDATE_GAME_OBJECT', object.toContext(), sendFrom);
      }
    } else if (ObjectStore.instance.isDeleted(context.identifier)) {
      EventSystem.call('DELETE_GAME_OBJECT', { aliasName: context.aliasName, identifier: context.identifier }, sendFrom);
    } else {
      let newObject = this.createObject(context);
      if (newObject) markForChanged(newObject, sendFrom);
    }
  }

  private applyInboundCatalog(catalog: CatalogItem[], sendFrom: string) {
    if (!Array.isArray(catalog) || catalog.length < 1) return;
    netDebug('SYNCHRONIZE_GAME_OBJECT ' + sendFrom);
    for (let item of catalog) {
      if (ObjectStore.instance.isDeleted(item.identifier) && !this.joinFetch) {
        EventSystem.call('DELETE_GAME_OBJECT', { aliasName: '', identifier: item.identifier }, sendFrom);
      } else {
        this.addRequestMap(item, sendFrom);
      }
    }
    this.synchronize();
  }

  private updateObject(object: GameObject, context: ObjectContext): GameObject {
    let version = context.majorVersion + context.minorVersion;
    if (object.version < version) {
      object.apply(context);
    } else if (version < object.version) {
      return null;
    }
    return object;
  }

  private createObject(context: ObjectContext): GameObject {
    let newObject: GameObject = ObjectFactory.instance.create(context.aliasName, context.identifier);
    if (!newObject) {
      console.warn(context.aliasName + ' is Unknown...?', context);
      return null;
    }
    // Room ZIP reload / peer resync reuses syncIds that were just DELETE-marked.
    ObjectStore.instance.clearDeleted(context.identifier);
    // Suppress SyncVar update() during add?apply so onStoreAdded cannot broadcast
    // default 0,0 poses before real syncData is applied (multi-tab top-left drift).
    // Add before apply so ObjectStore.get works when onChildAdded fires MESSAGE_ADDED.
    newObject.syncSuppressed = true;
    try {
      ObjectStore.instance.add(newObject, false);
      newObject.apply(context);
    } finally {
      newObject.syncSuppressed = false;
    }
    return newObject;
  }

  private sendCatalog(sendTo: PeerId) {
    let catalog = ObjectStore.instance.getCatalog();
    let interval = setInterval(() => {
      let count = catalog.length < 2048 ? catalog.length : 2048;
      EventSystem.call('SYNCHRONIZE_GAME_OBJECT', catalog.splice(0, count), sendTo);
      if (catalog.length < 1) clearInterval(interval);
    });
  }

  private addRequestMap(item: CatalogItem, sendFrom: PeerId) {
    let request = this.requestMap.get(item.identifier);
    if (request && request.version === item.version) {
      request.holderIds.push(sendFrom);
      this.addPeerMap(sendFrom);
    } else if (!request || request.version < item.version) {
      this.requestMap.set(item.identifier, { identifier: item.identifier, version: item.version, holderIds: [sendFrom], ttl: 2 });
      this.addPeerMap(sendFrom);
    }
  }

  private addPeerMap(targetPeerId: PeerId) {
    if (!this.peerMap.has(targetPeerId)) this.peerMap.set(targetPeerId, []);
  }

  private removePeerMap(targetPeerId: PeerId) {
    this.peerMap.delete(targetPeerId);
  }

  private synchronize() {
    let isContinue = true;
    while (0 < this.requestMap.size && this.tasks.length < 32 && isContinue) {
      isContinue = this.runSynchronizeTask();
    };
  }

  private runSynchronizeTask() {
    let targetPeerId = this.getTargetPeerId();
    if (targetPeerId.length < 1) return false;
    let requests: SynchronizeRequest[] = this.makeRequestList(targetPeerId);

    if (requests.length < 1) {
      this.removePeerMap(targetPeerId);
      return 0 < this.peerMap.size;
    }
    let task = SynchronizeTask.create(targetPeerId, requests);
    this.tasks.push(task);

    let targetPeerIdTasks = this.peerMap.get(targetPeerId);
    if (targetPeerIdTasks) targetPeerIdTasks.push(task);

    task.onfinish = task => {
      this.tasks.splice(this.tasks.indexOf(task), 1);
      let targetPeerIdTasks = this.peerMap.get(targetPeerId);
      if (targetPeerIdTasks) targetPeerIdTasks.splice(targetPeerIdTasks.indexOf(task), 1);
      this.synchronize();
    }

    task.ontimeout = (task, remainedRequests) => {
      netDebug('GameObject synchronize timeout');
      remainedRequests.forEach(request => this.requestMap.set(request.identifier, request));
    }

    return true;
  }

  private makeRequestList(targetPeerId: PeerId, maxRequest: number = 32): SynchronizeRequest[] {
    let requests: SynchronizeRequest[] = [];

    for (let [identifier, request] of this.requestMap) {
      if (maxRequest <= requests.length) break;
      if (!request.holderIds.includes(targetPeerId)) continue;

      let gameObject = ObjectStore.instance.get(request.identifier);
      if (!gameObject || gameObject.version < request.version || this.joinFetch) requests.push(request);

      this.requestMap.delete(identifier);
    }
    return requests;
  }

  private getTargetPeerId(): PeerId {
    let min = 9999;
    let selectPeerId: PeerId = '';
    let peers = Network.peers;

    for (let i = peers.length - 1; 0 <= i; i--) {
      let rand = Math.floor(Math.random() * (i + 1));
      [peers[i], peers[rand]] = [peers[rand], peers[i]];
    }

    for (let peer of peers) {
      let tasks = this.peerMap.get(peer.peerId);
      if (peer.isOpen && tasks && tasks.length < min) {
        min = tasks.length;
        selectPeerId = peer.peerId;
      }
    }
    return selectPeerId;
  }
}

/** Data nodes first so tabletop parents attach a complete tree on join apply. */
function inboundApplyRank(aliasName: string): number {
  if (aliasName === 'data' || aliasName === 'node') return 0;
  return 1;
}
