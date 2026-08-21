import { IPeerContext } from './peer-context';
import { IRoomInfo } from './room-info';

export class ConnectionCallback {
  onOpen: (peer: IPeerContext) => void;
  onClose: (peer: IPeerContext) => void;
  onConnect: (peer: IPeerContext) => void;
  onDisconnect: (peer: IPeerContext) => void;
  onData: (peer: IPeerContext, data: any) => void;
  onError: (peer: IPeerContext, errorType: string, errorMessage: string, errorObject: any) => void;
}

export interface Connection {
  readonly peerId: string;
  readonly peerIds: string[];
  readonly peer: IPeerContext;
  readonly peers: IPeerContext[];
  readonly callback: ConnectionCallback;
  readonly bandwidthUsage: number;
  /** Sticky high-water mark; survives brief queue windows so UI can poll reliably. */
  readonly bandwidthPeak: number;
  clearBandwidthPeak(): void;

  configure(config: any)
  open(userId?: string)
  open(userId: string, roomId: string, roomName: string, password: string)
  close(): void | Promise<void>
  connect(peer: IPeerContext): boolean
  disconnect(peer: IPeerContext): boolean
  disconnectAll()
  send(data: any, sendTo?: string)
  listAllPeers(force?: boolean): Promise<string[]>
  listAllRooms(force?: boolean): Promise<IRoomInfo[]>
  /** PeerIds currently in the SkyWay room channel (empty if not in a room). */
  listRoomMemberPeerIds(): string[]
}
