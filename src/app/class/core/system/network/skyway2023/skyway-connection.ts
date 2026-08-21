import { ArrayUtil } from '../../util/array-util';
import { compressAsync, decompressAsync } from '../../util/compress';
import { MessagePack } from '../../util/message-pack';
import { setZeroTimeout } from '../../util/zero-timeout';
import { Connection, ConnectionCallback } from '../connection';
import { IPeerContext, PeerContext } from '../peer-context';
import { IRoomInfo, RoomInfo } from '../room-info';
import { netDebug } from '../net-debug';
import { SkyWayDataStream } from './skyway-data-stream';
import { SkyWayDataStreamList } from './skyway-data-stream-list';
import { SkyWayFacade } from './skyway-facade';
import { translate } from 'i18n';

type PeerId = string;

interface DataContainer {
  data: Uint8Array;
  users?: string[];
  ttl: number;
  isCompressed?: boolean;
}

export class SkyWayConnection implements Connection {
  private get userIds(): string[] { return this.peers.map(peer => peer.userId).filter(userId => 0 < userId.length).concat([this.peer.userId]); }

  get peerId(): string { return this.peer.peerId; }
  get peerIds(): string[] { return this.streams.peerIds; }

  get peer(): PeerContext { return this.skyWay.peer; }
  get peers(): PeerContext[] { return this.streams.peers; }

  readonly callback: ConnectionCallback = new ConnectionCallback();
  bandwidthUsage: number = 0;
  bandwidthPeak: number = 0;

  clearBandwidthPeak() { this.bandwidthPeak = 0; }

  private addBandwidth(byteLength: number) {
    this.bandwidthUsage += byteLength;
    if (this.bandwidthUsage > this.bandwidthPeak) this.bandwidthPeak = this.bandwidthUsage;
  }

  private readonly skyWay: SkyWayFacade = new SkyWayFacade();
  private readonly streams: SkyWayDataStreamList = new SkyWayDataStreamList();

  private listAllPeersCache: PeerId[] = [];
  private listAllPeersCacheUntil = 0;
  private listAllPeersInFlight: Promise<PeerId[]> | null = null;

  private outboundQueue: Promise<any> = Promise.resolve();
  private inboundQueue: Promise<any> = Promise.resolve();

  private readonly trustedPeerIds: Set<PeerId> = new Set();
  private readonly relayingPeerIds: Map<string, string[]> = new Map();
  private readonly maybeUnavailablePeerIds: Set<string> = new Set();

  configure(config: any) {
    this.skyWay.url = resolveBackendUrl(config?.backend?.url ?? '');
  }

  open(userId?: string)
  open(userId: string, roomId: string, roomName: string, password: string)
  open(...args: any[]) {
    let peer: PeerContext;
    if (args.length === 0) {
      peer = PeerContext.create(PeerContext.generateId());
    } else if (args.length === 1) {
      peer = PeerContext.create(args[0]);
    } else {
      peer = PeerContext.create(args[0], args[1], args[2], args[3]);
    }
    this.trustedPeerIds.clear();
    this.openSkyWay(peer);
  }

  close(): Promise<void> {
    this.disconnectAll();
    this.listAllPeersInFlight = null;
    this.listAllPeersCache = [];
    this.listAllPeersCacheUntil = 0;
    return this.skyWay.close();
  }

  connect(peer: IPeerContext): boolean {
    if (!this.peer.isRoom) {
      console.warn('connect() is Fail. Room connection only');
      let errorType = 'udonarium-unsupported';
      let errorMessage = translate('skyway.privateUnsupported');
      if (this.callback.onError) this.callback.onError(this.peer, errorType, errorMessage, {});
      return false;
    }

    if (!this.shouldConnect(peer.peerId)) return false;

    netDebug(`connect() ${peer.peerId}`);
    this.connectStream(SkyWayDataStream.createSubscription(this.skyWay, peer));
    return true;
  }

  private shouldConnect(peerId: string): boolean {
    if (!this.skyWay.isOpen) {
      netDebug('connect() is Fail. Wait until ID is assigned');
      return false;
    }

    if (this.peerId === peerId) {
      netDebug('connect() is Fail. ' + peerId + ' is me.');
      return false;
    }

    if (this.peerIds.includes(peerId)) {
      netDebug('connect() is Fail. <' + peerId + '> is already connecting.');
      return false;
    }

    if (!this.peer.verifyPeer(peerId)) {
      netDebug('connect() is Fail. <' + peerId + '> is invalid.');
      return false;
    }

    if (!this.skyWay?.room?.members.find(member => member.name === peerId)) {
      netDebug('connect() is Fail.  <' + peerId + '> is not found.');
      return false;
    }

    if (peerId && peerId.length && peerId !== this.peerId) return true;
    return false;
  }

  disconnect(peer: IPeerContext): boolean {
    let stream = this.streams.find(peer.peerId)
    if (!stream) return false;
    this.disconnectStream(stream);
    return true;
  }

  disconnectAll() {
    for (let peer of this.peers) {
      this.disconnect(peer);
    }
  }

  send(data: any, sendTo?: string) {
    if (this.peers.length < 1) return;
    let container: DataContainer = {
      data: MessagePack.encode(data),
      ttl: 1
    }

    let byteLength = container.data.byteLength;
    this.addBandwidth(byteLength);
    this.outboundQueue = this.outboundQueue.then(() => new Promise<void>((resolve, reject) => {
      setZeroTimeout(async () => {
        if (1 * 1024 < container.data.byteLength && Array.isArray(data) && 1 < data.length) {
          let compressed = await compressAsync(container.data);
          if (compressed.byteLength < container.data.byteLength) {
            container.data = compressed;
            container.isCompressed = true;
          }
        }
        if (sendTo) {
          this.sendUnicast(container, sendTo);
        } else {
          this.sendBroadcast(container);
        }
        this.bandwidthUsage -= byteLength;
        return resolve();
      });
    }));
  }

  private sendUnicast(container: DataContainer, sendTo: string) {
    container.ttl = 0;
    let stream = this.streams.find(sendTo);
    if (stream && stream.open) stream.send(container);
  }

  private sendBroadcast(container: DataContainer) {
    for (let stream of this.streams) {
      if (stream.open) stream.send(container);
    }
  }

  async listAllPeers(force = false): Promise<string[]> {
    if (this.listAllPeersInFlight) {
      return this.listAllPeersInFlight;
    }
    if (!force && performance.now() < this.listAllPeersCacheUntil) {
      return this.listAllPeersCache;
    }

    this.listAllPeersInFlight = this.fetchListAllPeers();
    try {
      return await this.listAllPeersInFlight;
    } finally {
      this.listAllPeersInFlight = null;
    }
  }

  private async fetchListAllPeers(): Promise<PeerId[]> {
    const peers = await this.skyWay.listAllPeers();
    this.listAllPeersCache = peers;
    // Positive hits: rate-limit. Empty: short TTL so lobby/invite retries can re-fetch
    // (concurrent callers used to get a still-empty cache while the first fetch was in flight).
    const ttlMs = peers.length > 0 ? 2500 : 500;
    this.listAllPeersCacheUntil = performance.now() + ttlMs;
    return peers;
  }

  async listAllRooms(force = false): Promise<IRoomInfo[]> {
    let allPeerIds = await this.listAllPeers(force);
    return RoomInfo.listFrom(allPeerIds);
  }

  listRoomMemberPeerIds(): string[] {
    const members = this.skyWay?.room?.members;
    if (!members?.length) return [];
    return members.map(m => m.name).filter((name): name is string => !!name);
  }

  private async openSkyWay(peer: IPeerContext) {
    if (this.skyWay.context) {
      await this.skyWay.close();
    }

    this.skyWay.onOpen = peer => {
      if (this.callback.onOpen) this.callback.onOpen(this.peer);
    };

    this.skyWay.onClose = peer => {
      if (this.peer.isOpen) this.close();
      if (this.callback.onClose) this.callback.onClose(this.peer);
    };

    this.skyWay.onFatalError = (peer, errorType, errorMessage, errorObject) => {
      console.error('skyWay onFatalError', errorObject);
      if (this.peer.isOpen) {
        this.close();
        if (this.callback.onClose) this.callback.onClose(this.peer);
      }
      if (this.callback.onError) this.callback.onError(this.peer, errorType, errorMessage, errorObject);
    };

    this.skyWay.onSubscribed = (peer, subscription) => {
      let stream = SkyWayDataStream.createPublication(this.skyWay, peer);

      if (!this.peer.verifyPeer(stream.peer.peerId)) {
        console.warn('stream is closing. <' + stream.peer.peerId + '> is invalid.');
        stream.reject();
        return;
      }
      this.connectStream(stream);
    }

    this.skyWay.onRoomRestore = (peer) => {
      for (let peerId of this.trustedPeerIds) {
        let peer = PeerContext.parse(peerId);
        this.disconnect(peer);
        this.connect(peer);
      }
    }

    await this.skyWay.open(peer);
    return;
  }

  private connectStream(stream: SkyWayDataStream) {
    if (this.streams.add(stream) == null) return;
    netDebug(`openStream ${stream.peer.peerId}`);

    this.trustedPeerIds.delete(stream.peer.peerId);
    this.maybeUnavailablePeerIds.add(stream.peer.peerId);

    stream.on('data', data => {
      this.onData(stream, data);
    });
    stream.on('open', () => {
      this.trustedPeerIds.add(stream.peer.peerId);
      this.maybeUnavailablePeerIds.delete(stream.peer.peerId);
      this.notifyUserList();
      if (this.callback.onConnect) this.callback.onConnect(stream.peer);
    });
    stream.on('close', () => {
      this.disconnectStream(stream);
    });
    stream.on('error', () => {
      this.disconnectStream(stream);
    });
    stream.on('stats', async () => {
      // not implemented
    });

    stream.connect();
  }

  private disconnectStream(stream: SkyWayDataStream) {
    stream.disconnect();
    let closed = this.streams.remove(stream);

    this.relayingPeerIds.delete(stream.peer.peerId);
    this.relayingPeerIds.forEach(peerIds => {
      let index = peerIds.indexOf(stream.peer.peerId);
      if (0 <= index) peerIds.splice(index, 1);
    });
    this.notifyUserList();
    if (closed && this.callback.onDisconnect) this.callback.onDisconnect(closed.peer);
  }

  private onData(stream: SkyWayDataStream, container: DataContainer) {
    if (container.users && 0 < container.users.length) this.onUpdateUserIds(stream, container.users);
    if (0 < container.ttl) this.onRelay(stream, container);
    if (!this.callback.onData) return;
    let byteLength = container.data.byteLength;
    this.addBandwidth(byteLength);
    this.inboundQueue = this.inboundQueue.then(() => new Promise<void>((resolve, reject) => {
      setZeroTimeout(async () => {
        if (!this.callback.onData) return;
        let data = container.isCompressed ? await decompressAsync(container.data) : container.data;
        this.callback.onData(stream.peer, MessagePack.decode(data));
        this.bandwidthUsage -= byteLength;
        return resolve();
      });
    }));
  }

  private onRelay(stream: SkyWayDataStream, container: DataContainer) {
    container.ttl--;

    let relayingPeerIds: string[] = this.relayingPeerIds.get(stream.peer.peerId);
    if (relayingPeerIds == null) return;

    if (container.users && 0 < container.users.length) {
      container.users = this.userIds;
    }

    for (let peerId of relayingPeerIds) {
      let conn = this.streams.find(peerId);
      if (conn && conn.open) {
        netDebug('<' + peerId + '> need to forward...');
        conn.send(container);
      }
    }
  }

  private onUpdateUserIds(stream: SkyWayDataStream, userIds: string[]) {
    let needsNotifyUserList = false;
    userIds.forEach(userId => {
      let peer = this.makeFriendPeer(userId);
      let stream = this.streams.find(peer.peerId);
      if (stream && stream.peer.userId !== userId) {
        stream.peer.userId = userId;
        needsNotifyUserList = true;
      }
    });

    let diff = ArrayUtil.diff(this.userIds, userIds);
    let relayingUserIds = diff.diff1;
    let unknownUserIds = diff.diff2;
    this.relayingPeerIds.set(stream.peer.peerId, relayingUserIds.map(userId => this.makeFriendPeer(userId).peerId));

    if (unknownUserIds.length) {
      for (let userId of unknownUserIds) {
        let peer = this.makeFriendPeer(userId);
        if (!this.maybeUnavailablePeerIds.has(peer.peerId) && this.connect(peer)) {
          netDebug('auto connect to unknown Peer <' + peer.peerId + '>');
        }
      }
    }
    if (needsNotifyUserList) this.notifyUserList();
  }

  private notifyUserList() {
    this.streams.refresh();
    if (this.streams.length < 1) return;
    let container: DataContainer = {
      data: MessagePack.encode([]),
      users: this.userIds,
      ttl: 1
    }
    this.sendBroadcast(container);
  }

  private makeFriendPeer(userId: string): PeerContext {
    return this.peer.isRoom
      ? PeerContext.create(userId, this.peer.roomId, this.peer.roomName, this.peer.channelPassword)
      : PeerContext.create(userId);
  }
}

/** Prefer same-origin so Angular proxy `/v1` works whether the page is localhost or 127.0.0.1. */
function resolveBackendUrl(configured: string): string {
  const url = (configured || '').trim();
  const pageOrigin = typeof location !== 'undefined' ? `${location.origin}/` : '';
  if (!url || url.includes('{your-backend')) return pageOrigin;
  if (!pageOrigin) return url;
  try {
    const configuredUrl = new URL(url);
    const pageHost = location.hostname;
    const configHost = configuredUrl.hostname;
    const isLocal = (h: string) => h === 'localhost' || h === '127.0.0.1';
    if (isLocal(pageHost) && isLocal(configHost) && pageHost !== configHost) {
      return pageOrigin;
    }
  } catch {
    return pageOrigin || url;
  }
  return url.endsWith('/') ? url : `${url}/`;
}
