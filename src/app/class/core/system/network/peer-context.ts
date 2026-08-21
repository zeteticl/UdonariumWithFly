import base from 'base-x';
import lzbase62 from 'lzbase62';

import { CryptoUtil } from '../util/crypto-util';
import { MutablePeerSessionState, PeerSessionGrade, PeerSessionState } from './peer-session-state';
import { ROOM_AUTH_MARKER_V3, roomNameHasMeshLock } from '@udonarium/room-mesh-lock';

const Base62 = base('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
const roomIdPattern = /^(\w{6})(\w{3})(\w*)-(\w*)/i;
/** packRoomName flags: '2'=V3 display||blob, '0'=base62(utf8), '1'=lzbase62, bare=legacy lz. */
const V3_MARKER = ROOM_AUTH_MARKER_V3;

export interface IPeerContext {
  readonly peerId: string;
  readonly userId: string;
  readonly roomId: string;
  readonly roomName: string;
  readonly password: string;
  /** SkyWay channel key when omitted from peerId (V3 mesh lock). */
  readonly meshPassword: string;
  readonly digestUserId: string;
  readonly digestPassword: string;
  readonly isOpen: boolean;
  readonly isRoom: boolean;
  readonly hasPassword: boolean;
  readonly session: PeerSessionState;
  /** Password used for SkyWay channel hashing. */
  readonly channelPassword: string;
}

export class PeerContext implements IPeerContext {
  peerId: string = '';
  userId: string = '';
  roomId: string = '';
  roomName: string = '';
  password: string = '';
  /** Not embedded in peerId; used only for SkyWay channel name when mesh-locked. */
  meshPassword: string = '';
  digestUserId: string = '';
  digestPassword: string = '';
  isOpen: boolean = false;
  session: MutablePeerSessionState = { grade: PeerSessionGrade.UNSPECIFIED, ping: 0, health: 0, speed: 0, description: '' };

  get isRoom(): boolean { return 0 < this.roomId.length; }
  get hasPassword(): boolean { return 0 < this.password.length + this.digestPassword.length; }
  get channelPassword(): string { return this.meshPassword || this.password; }

  private constructor(peerId: string) {
    this.parse(peerId);
  }

  private parse(peerId: string) {
    try {
      this.peerId = peerId;
      let regArray = roomIdPattern.exec(peerId);
      let isRoom = regArray != null;
      if (isRoom) {
        this.digestUserId = regArray[1];
        this.roomId = regArray[2];
        this.roomName = unpackRoomName(regArray[3]);
        this.digestPassword = regArray[4];
        return;
      }
    } catch (e) {
      console.warn(e);
    }
    this.digestUserId = peerId;
    return;
  }

  verifyPassword(password: string): boolean {
    let digest = calcDigestPassword(this.digestUserId, this.roomId, this.roomName, password);
    let isCorrect = digest === this.digestPassword;
    return isCorrect && this.verifyRoomId(password);
  }

  private verifyRoomId(password: string): boolean {
    let checksumedRoomId = calcChecksumedRoomId(this.roomId, this.roomName, password);
    let isCorrect = checksumedRoomId === this.roomId;
    return isCorrect;
  }

  verifyPeer(peerId: string): boolean {
    let peer = PeerContext.parse(peerId);
    if (this.roomId != peer.roomId || this.roomName != peer.roomName || this.hasPassword != peer.hasPassword) {
      return false;
    }

    if (!this.hasPassword) {
      return true;
    }

    if (this.password.length < 1) {
      console.error('do not know password.');
      return false;
    }

    let isValid = peer.verifyPassword(this.password);
    return isValid;
  }

  static parse(peerId: string): PeerContext {
    return new PeerContext(peerId);
  }

  static create(userId: string): PeerContext
  static create(userId: string, roomId: string, roomName: string, password: string): PeerContext
  static create(...args: any[]): PeerContext {
    if (args.length <= 1) {
      return PeerContext._create.apply(this, args);
    } else {
      return PeerContext._createRoom.apply(this, args);
    }
  }

  private static _create(userId: string = ''): PeerContext {
    let digestUserId = calcDigestUserId(userId);
    let peer = new PeerContext(digestUserId);

    peer.userId = userId;
    return peer;
  }

  private static _createRoom(userId: string = '', roomId: string = '', roomName: string = '', password: string = ''): PeerContext {
    // V3 mesh lock: channel key stays in meshPassword; peerId omits digestPassword so
    // CJK display names + seals fit under SkyWay's ~64-char peerId limit.
    let peerIdPassword = password;
    let meshPassword = '';
    if (password && roomNameHasMeshLock(roomName)) {
      meshPassword = password;
      peerIdPassword = '';
    }

    let digestUserId = calcDigest(userId, 6);
    let checksumedRoomId = calcChecksumedRoomId(roomId, roomName, peerIdPassword);
    let digestPassword = calcDigestPassword(digestUserId, checksumedRoomId, roomName, peerIdPassword);
    let peerId = `${digestUserId}${checksumedRoomId}${packRoomName(roomName)}-${digestPassword}`;

    let peer = new PeerContext(peerId);
    peer.userId = userId;
    peer.password = peerIdPassword;
    peer.meshPassword = meshPassword;
    return peer;
  }

  static generateId(format: string = '********'): string {
    const h: string = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    let k: string = format;
    k = format.replace(/\*/g, c => h[Math.floor(Math.random() * (h.length))]);

    return k;
  }
}

function isV3RoomName(roomName: string): boolean {
  return !!roomName && roomName.indexOf(V3_MARKER) >= 0;
}

/**
 * V3 open-gate flag `*` is not \w and is rejected by the token backend / SkyWay peerId rules.
 * Map to `o` only inside the packed peerId blob (hex digests/seals never contain `o`).
 */
const V3_OPEN_GATE_PACKED = 'o';

/**
 * Pack roomName into peerId-safe \w chars.
 * V3: only Base62-encode the display name; keep ASCII auth blob raw (avoids 4/3 expansion).
 */
function packRoomName(roomName: string): string {
  if (isV3RoomName(roomName)) {
    const i = roomName.indexOf(V3_MARKER);
    const display = roomName.slice(0, i);
    const blob = roomName.slice(i + V3_MARKER.length).replace(/\*/g, V3_OPEN_GATE_PACKED);
    const dispB62 = Base62.encode(new TextEncoder().encode(display));
    if (dispB62.length > 99) {
      // Fallback: whole-string pack (will likely fail length check upstream).
      return '0' + Base62.encode(new TextEncoder().encode(roomName));
    }
    return '2' + String(dispB62.length).padStart(2, '0') + dispB62 + blob;
  }

  const utf8 = new TextEncoder().encode(roomName);
  const raw = '0' + Base62.encode(utf8);
  const compressed = '1' + lzbase62.compress(roomName);
  return raw.length < compressed.length ? raw : compressed;
}

function unpackRoomName(packed: string): string {
  if (!packed) return '';
  const flag = packed.charAt(0);
  if (flag === '2') {
    const len = parseInt(packed.slice(1, 3), 10);
    if (!Number.isFinite(len) || len < 0) return '';
    const dispB62 = packed.slice(3, 3 + len);
    const blob = packed.slice(3 + len).replace(/o/g, '*');
    const display = new TextDecoder().decode(Base62.decode(dispB62));
    return display + V3_MARKER + blob;
  }
  if (flag === '0') {
    const bytes = Base62.decode(packed.slice(1));
    return new TextDecoder().decode(bytes);
  }
  if (flag === '1') return lzbase62.decompress(packed.slice(1));
  // Legacy peerIds (no flag): lzbase62 only.
  return lzbase62.decompress(packed);
}

function calcDigestUserId(userId: string): string {
  if (userId == null) return '';
  return calcDigest(userId);
}

function calcDigestPassword(digestUserId: string, roomId: string, roomName: string, password: string): string {
  if (roomId == null || password == null) return '';
  return 0 < password.length ? calcDigest(digestUserId + roomId + roomName + password, 7) : '';
}

function calcChecksumedRoomId(roomId: string, roomName: string, password: string): string {
  if (password.length < 1) return roomId;
  let salt = roomId.slice(0, 2);
  return salt + calcDigest(salt + roomName + password, 1);
}

function calcDigest(str: string, truncateLength: number = -1): string {
  if (str == null) return '';
  let array = CryptoUtil.sha256(str);
  let base62 = Base62.encode(array);

  if (truncateLength < 0) truncateLength = base62.length;
  if (base62.length < truncateLength) truncateLength = base62.length;

  base62 = base62.slice(0, truncateLength);
  return base62;
}
