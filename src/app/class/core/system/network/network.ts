import { GuestSession } from '@udonarium/guest-session';
import { setZeroTimeout } from '../util/zero-timeout';
import { Connection, ConnectionCallback } from './connection';
import { IPeerContext, PeerContext } from './peer-context';
import { IRoomInfo } from './room-info';
import { LastRoomSession } from '@udonarium/room-reconnect.util';

type QueueItem = { data: any, sendTo: string };
type ConnectionClass = new (...args: any[]) => Connection;

const unknownPeer = PeerContext.parse('???');

export class Network {
  private static _instance: Network
  static get instance(): Network {
    if (!Network._instance) Network._instance = new Network();
    return Network._instance;
  }
  get isOpen(): boolean { return this.connection ? this.connection.peer.isOpen : false; }

  get peerId(): string { return this.connection ? this.connection.peerId : unknownPeer.peerId; }
  get peerIds(): string[] { return this.connection ? this.connection.peerIds.concat() : []; }

  get peer(): IPeerContext { return this.connection ? this.connection.peer : unknownPeer; }
  get peers(): IPeerContext[] { return this.connection ? this.connection.peers.concat() : []; }

  readonly callback: ConnectionCallback = new ConnectionCallback();
  get bandwidthUsage(): number { return this.connection ? this.connection.bandwidthUsage : 0; }
  get bandwidthPeak(): number { return this.connection ? this.connection.bandwidthPeak : 0; }
  clearBandwidthPeak() { this.connection?.clearBandwidthPeak(); }

  private config: any = {}
  private connectionClassPromise: Promise<ConnectionClass>;
  private connectionClass: ConnectionClass;
  private connection: Connection;
  /** Serializes reopen so SkyWay dispose finishes before the next open. */
  private openSeq = 0;
  private closing: Promise<void> = Promise.resolve();
  /** Bumped on close so dispose-time callbacks from the old connection are ignored. */
  private connectionGen = 0;
  /** Survives fatal close() which wipes peer to ??? — used for room reopen. */
  private lastRoomSession: LastRoomSession | null = null;

  private queue: Set<QueueItem> = new Set();
  private sendInterval: number = null;
  private sendCallback = () => { this.sendQueue(); }
  private callbackUnload: any = (e) => { this.close(); };

  private constructor() {
  }

  /** Remember a successful room open so NETWORK_ERROR can reopen the same house. */
  rememberRoomSession(session: LastRoomSession) {
    if (!session?.roomId || !session?.roomName) return;
    this.lastRoomSession = {
      userId: session.userId || '',
      roomId: session.roomId,
      roomName: session.roomName,
      meshPassword: session.meshPassword || '',
    };
  }

  getLastRoomSession(): LastRoomSession | null {
    return this.lastRoomSession ? { ...this.lastRoomSession } : null;
  }

  clearLastRoomSession() {
    this.lastRoomSession = null;
  }

  configure(config: any) {
    this.config = config;
  }

  open(userId?: string)
  open(userId: string, roomId: string, roomName: string, password: string)
  open(...args: any[]) {
    const seq = ++this.openSeq;
    void this.openSerialized(seq, ...args);
  }

  private async openSerialized(seq: number, ...args: any[]) {
    await this.closing;
    if (seq !== this.openSeq) return;

    // Reopen is normal (lobby → room, room switch, backup load).
    if (this.connection || this.connectionClassPromise) {
      await this.closeAsync();
    }
    if (seq !== this.openSeq) return;

    await this.openAsync(seq, ...args);
  }

  private async openAsync(seq: number, ...args: any[]) {
    let promise = this.dynamicImport(this.config?.backend?.mode);
    this.connectionClassPromise = promise;
    this.connectionClass = await promise;
    if (seq !== this.openSeq || this.connectionClassPromise != promise) {
      // Superseded by a newer open() or close() while importing.
      return;
    }

    this.connection = this.initializeConnection();
    this.connection.open.apply(this.connection, args);

    // Prefer pagehide — Permissions-Policy may block the unload event.
    window.addEventListener('pagehide', this.callbackUnload, false);
  }

  private close() {
    void this.closeAsync();
  }

  private async closeAsync() {
    this.connectionGen++;
    const conn = this.connection;
    this.connection = null;
    this.connectionClassPromise = null;
    window.removeEventListener('pagehide', this.callbackUnload, false);

    const prev = this.closing;
    const done = (async () => {
      await prev;
      if (!conn) return;
      try {
        await Promise.resolve(conn.close());
      } catch {
        // Dispose races are non-fatal when switching rooms.
      }
    })();
    this.closing = done;
    await done;
  }

  connect(peer: IPeerContext): boolean {
    if (this.connection) return this.connection.connect(peer);
    return false;
  }

  disconnect(peer: IPeerContext) {
    if (!this.connection) return;
    if (this.connection.disconnect(peer)) {
      console.log('<disconnectPeer()> Peer:' + peer.peerId);
      this.disconnect(peer);
    }
  }

  send(data: any, sendTo?: string) {
    this.queue.add({ data: data, sendTo: sendTo });
    if (this.sendInterval === null) {
      this.sendInterval = setZeroTimeout(this.sendCallback);
    }
  }

  private sendQueue() {
    let broadcast: any[] = [];
    let unicast: { [sendTo: string]: any[] } = {};
    let echocast: any[] = [];

    let loopCount = this.queue.size < 128 ? this.queue.size : 128;
    for (let item of this.queue) {
      if (loopCount <= 0) break;
      loopCount--;
      this.queue.delete(item);
      if (item.sendTo == null) {
        broadcast.push(item.data);
      } else if (item.sendTo === this.peerId) {
        echocast.push(item.data);
      } else {
        if (!(item.sendTo in unicast)) unicast[item.sendTo] = [];
        unicast[item.sendTo].push(item.data);
      }
    }

    // 盡量合併後再送出
    if (this.connection) {
      if (broadcast.length) this.connection.send(broadcast);
      for (let sendTo in unicast) this.connection.send(unicast[sendTo], sendTo);
    }

    // 傳送給自己
    if (this.callback.onData) {
      this.callback.onData(null, broadcast);
      this.callback.onData(this.peer, echocast);
    }

    if (0 < this.queue.size) {
      this.sendInterval = setZeroTimeout(this.sendCallback);
    } else {
      this.sendInterval = null;
    }
  }

  listAllPeers(force?: boolean): Promise<string[]> {
    return this.connection ? this.connection.listAllPeers(force) : Promise.resolve([]);
  }

  listAllRooms(force?: boolean): Promise<IRoomInfo[]> {
    return this.connection ? this.connection.listAllRooms(force) : Promise.resolve([]);
  }

  /** SkyWay room channel member names — prefer over lobby list when remeshing. */
  listRoomMemberPeerIds(): string[] {
    return this.connection ? this.connection.listRoomMemberPeerIds() : [];
  }

  GuestMode(): boolean {
    return GuestSession.GuestMode();
  }

  private initializeConnection(): Connection {
    const gen = this.connectionGen;
    let connection = new this.connectionClass();
    connection.configure(this.config);

    const live = () => gen === this.connectionGen;
    connection.callback.onOpen = (peer) => { if (live() && this.callback.onOpen) this.callback.onOpen(peer); }
    connection.callback.onClose = (peer) => { if (live() && this.callback.onClose) this.callback.onClose(peer); }
    connection.callback.onConnect = (peer) => { if (live() && this.callback.onConnect) this.callback.onConnect(peer); }
    connection.callback.onDisconnect = (peer) => { if (live() && this.callback.onDisconnect) this.callback.onDisconnect(peer); }
    connection.callback.onData = (peer, data: any[]) => { if (live() && this.callback.onData) this.callback.onData(peer, data); }
    connection.callback.onError = (peer, errorType, errorMessage, errorObject) => {
      if (live() && this.callback.onError) this.callback.onError(peer, errorType, errorMessage, errorObject);
    };

    if (0 < this.queue.size && this.sendInterval === null) this.sendInterval = setZeroTimeout(this.sendCallback);

    return connection;
  }

  private async dynamicImport(mode: string = ''): Promise<ConnectionClass> {
    if (mode && mode !== 'skyway2023') {
      console.warn(`Unknown backend mode "${mode}"; using skyway2023`);
    }
    return (await import(
      /* webpackChunkName: "lib/backend/skyway2023/skyway-connection" */
      './skyway2023/skyway-connection')
    ).SkyWayConnection;
  }
}
