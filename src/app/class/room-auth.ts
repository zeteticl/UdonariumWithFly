import { CryptoUtil } from './core/system/util/crypto-util';
import { EventSystem, Network } from './core/system';
import { GuestSession } from './guest-session';
import { PeerCursor } from './peer-cursor';
import { roomNameHasMeshLock } from './room-mesh-lock';
import { translate } from 'i18n';

/** Join / create identity. */
export type RoomRole = 'gm' | 'user' | 'guest';

export type RoleGateMode = 'open' | 'password' | 'disabled';

export interface RoleGate {
  mode: RoleGateMode;
  digest: string;
}

export interface RoomAuthInfo {
  /** True when room uses GM/User/Guest password gates (new format). */
  isRoleAuth: boolean;
  /** True when V3 blob includes sealed mesh secret (network lock). */
  isMeshLocked: boolean;
  gm: RoleGate;
  user: RoleGate;
  guest: RoleGate;
}

export interface RoomJoinResult {
  role: RoomRole;
  password: string;
}

export interface RoomAuthEncodeResult {
  roomName: string;
  /** SkyWay / peer password; empty when mesh lock is inactive. */
  meshPassword: string;
}

/** Input for encoding a role gate (string = password; empty string = open). */
export type RoleAuthInput = string | {
  mode: RoleGateMode;
  password?: string;
};

const ROLES: RoomRole[] = ['gm', 'user', 'guest'];

/**
 * Role passwords are advertised as digests in the room name (like guest marker).
 *
 * When every enabled role is password-gated (V3), a deterministic mesh seed is sealed
 * under each role password and stretched into the SkyWay channel key so strangers
 * cannot join the channel without knowing a role password.
 *
 * Markers:
 * - \u2060A — legacy (7-hex digests)
 * - \u2060B — compact (3-hex digests)
 * - \u2060C — V3 (2-hex digests + optional sealed mesh)
 *
 * Gate flags in the blob:
 * - `*` — open (no password)
 * - `0` — disabled (role cannot join)
 * - `1` + digest — password required
 *
 * After gates (V3 mesh lock): sealHex(4) per password-gated role in gm/user/guest order
 * (legacy rooms may prefix seals with `M`).
 */
export class RoomAuth {
  static readonly AUTH_MARKER = '\u2060A';
  static readonly AUTH_MARKER_V2 = '\u2060B';
  static readonly AUTH_MARKER_V3 = '\u2060C';
  private static readonly DIGEST_LEN = 7;
  private static readonly DIGEST_LEN_V2 = 3;
  /** Short digests + compact seals keep 3-role CJK rooms under SkyWay peerId limit. */
  private static readonly DIGEST_LEN_V3 = 2;
  /**
   * Sealed mesh seed (channel-only, not in peerId). 2 bytes; stretchMeshSecret expands
   * to a 16-hex channel key.
   */
  private static readonly MESH_BYTES = 2;
  private static readonly SEAL_HEX_LEN = RoomAuth.MESH_BYTES * 2;

  /** In-session mesh password for the current room (after join / create). */
  private static sessionMeshPassword = '';
  private static sessionRolePasswords: Partial<Record<RoomRole, string>> = {};

  static encode(
    displayName: string,
    roomId: string,
    passwords: { gm?: RoleAuthInput; user?: RoleAuthInput; guest?: RoleAuthInput },
  ): RoomAuthEncodeResult {
    const clean = RoomAuth.sanitizeDisplayName(displayName || translate('room.defaultName'));
    const gates = {
      gm: RoomAuth.normalizeAuthInput(passwords.gm),
      user: RoomAuth.normalizeAuthInput(passwords.user),
      guest: RoomAuth.normalizeAuthInput(passwords.guest),
    };
    const meshLocked = RoomAuth.allEnabledPasswordGated(gates);
    const digestLen = RoomAuth.DIGEST_LEN_V3;
    let blob =
      RoomAuth.encodeGate(roomId, clean, 'gm', gates.gm, digestLen) +
      RoomAuth.encodeGate(roomId, clean, 'user', gates.user, digestLen) +
      RoomAuth.encodeGate(roomId, clean, 'guest', gates.guest, digestLen);

    let meshPassword = '';
    if (meshLocked) {
      // Deterministic seed: same room settings → same blob length (no random peerId jitter).
      const secret = RoomAuth.deriveMeshSeed(roomId, clean, gates);
      const secretHex = RoomAuth.bytesToHex(secret);
      // Seals follow gates directly (no 'M' marker — saves peerId budget).
      for (const role of ROLES) {
        if (gates[role].mode !== 'password') continue;
        const key = RoomAuth.meshKeyBytes(roomId, clean, role, gates[role].password);
        blob += RoomAuth.bytesToHex(RoomAuth.xorBytes(secret, key));
      }
      const roomName = clean + RoomAuth.AUTH_MARKER_V3 + blob;
      meshPassword = RoomAuth.stretchMeshSecret(secretHex, roomId, roomName);
      return { roomName, meshPassword };
    }

    return {
      roomName: clean + RoomAuth.AUTH_MARKER_V3 + blob,
      meshPassword,
    };
  }

  static parse(roomName: string): RoomAuthInfo {
    const empty: RoomAuthInfo = {
      isRoleAuth: false,
      isMeshLocked: false,
      gm: { mode: 'open', digest: '' },
      user: { mode: 'open', digest: '' },
      guest: { mode: 'disabled', digest: '' },
    };
    const markerInfo = RoomAuth.detectMarker(roomName);
    if (!markerInfo) {
      if (GuestSession.isAllowGuestRoomName(roomName)) {
        empty.guest = { mode: 'open', digest: '' };
      }
      return empty;
    }
    const blob = roomName.slice(markerInfo.index + markerInfo.marker.length);
    let i = 0;
    const gm = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = gm.next;
    const user = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = user.next;
    const guest = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = guest.next;
    return {
      isRoleAuth: true,
      isMeshLocked: roomNameHasMeshLock(roomName),
      gm: gm.gate,
      user: user.gate,
      guest: guest.gate,
    };
  }

  /** True when room advertises a sealed mesh (network lock). */
  static isMeshLocked(roomName: string): boolean {
    return roomNameHasMeshLock(roomName);
  }

  /**
   * After role password verify (or open gate), recover SkyWay mesh password.
   * Returns '' when the room has no mesh lock.
   */
  static resolveMeshPassword(
    roomId: string,
    roomName: string,
    role: RoomRole,
    rolePassword: string,
  ): string {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth || !info.isMeshLocked) return '';
    if (info[role].mode === 'disabled') return '';

    const markerInfo = RoomAuth.detectMarker(roomName);
    if (!markerInfo || markerInfo.marker !== RoomAuth.AUTH_MARKER_V3) return '';

    const display = RoomAuth.displayRoomName(roomName);
    const blob = roomName.slice(markerInfo.index + markerInfo.marker.length);
    let i = 0;
    const gm = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = gm.next;
    const user = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = user.next;
    const guest = RoomAuth.readGate(blob, i, markerInfo.digestLen); i = guest.next;
    if (blob.charAt(i) === 'M') i += 1; // legacy marker

    const gates = { gm: gm.gate, user: user.gate, guest: guest.gate };
    let sealIndex = 0;
    let roleSealOffset = -1;
    for (const r of ROLES) {
      if (gates[r].mode !== 'password') continue;
      if (r === role) roleSealOffset = sealIndex;
      sealIndex++;
    }
    if (roleSealOffset < 0) return '';

    const sealStart = i + roleSealOffset * RoomAuth.SEAL_HEX_LEN;
    const sealHex = blob.slice(sealStart, sealStart + RoomAuth.SEAL_HEX_LEN);
    if (sealHex.length !== RoomAuth.SEAL_HEX_LEN || !/^[0-9a-f]+$/i.test(sealHex)) return '';

    const key = RoomAuth.meshKeyBytes(roomId, display, role, rolePassword || '');
    const secret = RoomAuth.xorBytes(RoomAuth.hexToBytes(sealHex), key);
    const secretHex = RoomAuth.bytesToHex(secret);
    return RoomAuth.stretchMeshSecret(secretHex, roomId, roomName);
  }

  static rememberSession(role: RoomRole, rolePassword: string, meshPassword?: string | null) {
    RoomAuth.sessionRolePasswords[role] = rolePassword || '';
    if (meshPassword != null) RoomAuth.sessionMeshPassword = meshPassword;
  }

  static getSessionMeshPassword(): string {
    return RoomAuth.sessionMeshPassword;
  }

  static getSessionRolePassword(role: RoomRole): string {
    return RoomAuth.sessionRolePasswords[role] || '';
  }

  static clearSessionSecrets() {
    RoomAuth.sessionMeshPassword = '';
    RoomAuth.sessionRolePasswords = {};
  }

  static displayRoomName(roomName: string): string {
    if (!roomName) return roomName;
    let name = roomName;
    const markerInfo = RoomAuth.detectMarker(name);
    if (markerInfo) name = name.slice(0, markerInfo.index);
    return GuestSession.displayRoomName(name);
  }

  static isRoleAuthRoom(roomName: string): boolean {
    return !!RoomAuth.detectMarker(roomName);
  }

  static isRoleAvailable(roomName: string, role: RoomRole): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) {
      if (role === 'guest') return GuestSession.isAllowGuestRoomName(roomName);
      if (role === 'user' || role === 'gm') return true;
      return false;
    }
    return info[role].mode !== 'disabled';
  }

  static roleNeedsPassword(roomName: string, role: RoomRole): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    return info[role].mode === 'password';
  }

  static verify(roomId: string, roomName: string, role: RoomRole, password: string): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    const gate = info[role];
    if (gate.mode === 'disabled') return false;
    if (gate.mode === 'open') return true;
    const display = RoomAuth.displayRoomName(roomName);
    const markerInfo = RoomAuth.detectMarker(roomName);
    const digestLen = markerInfo ? markerInfo.digestLen : RoomAuth.DIGEST_LEN_V3;
    return RoomAuth.calcDigest(roomId, display, role, password || '', digestLen) === gate.digest;
  }

  static hasAnyRolePassword(roomName: string): boolean {
    const info = RoomAuth.parse(roomName);
    if (!info.isRoleAuth) return false;
    return [info.gm, info.user, info.guest].some(g => g.mode === 'password');
  }

  /** Highest role unlocked in the current room this session (gm > user > guest). */
  private static attainedRoomId = '';
  private static attainedRank = 0;
  private static readonly ATTAINED_STORAGE_PREFIX = 'udonarium.roomAuth.attained.';

  static roleRank(role: RoomRole): number {
    switch (role) {
      case 'gm': return 3;
      case 'user': return 2;
      case 'guest': return 1;
      default: return 0;
    }
  }

  /**
   * Roles at or below the highest unlocked rank need no password
   * (e.g. was player → guest free, then guest → player free; GM still needs unlock to go GM).
   */
  static canBypassPassword(target: RoomRole, roomId?: string): boolean {
    const id = RoomAuth.resolveRoomId(roomId);
    if (!id) return false;
    RoomAuth.ensureAttainedLoaded(id);
    if (RoomAuth.attainedRoomId !== id) return false;
    return RoomAuth.attainedRank >= RoomAuth.roleRank(target);
  }

  static noteAttained(role: RoomRole, roomId?: string) {
    const id = RoomAuth.resolveRoomId(roomId);
    if (!id) return;
    RoomAuth.ensureAttainedLoaded(id);
    const rank = RoomAuth.roleRank(role);
    if (rank > RoomAuth.attainedRank) {
      RoomAuth.attainedRank = rank;
      RoomAuth.persistAttained(id, rank);
    }
  }

  static clearAttained() {
    if (RoomAuth.attainedRoomId) {
      try {
        sessionStorage.removeItem(RoomAuth.ATTAINED_STORAGE_PREFIX + RoomAuth.attainedRoomId);
      } catch { /* ignore */ }
    }
    RoomAuth.attainedRoomId = '';
    RoomAuth.attainedRank = 0;
    RoomAuth.clearSessionSecrets();
  }

  static applyIdentity(role: RoomRole, roomId?: string) {
    GuestSession.isGuest = role === 'guest';
    RoomAuth.noteAttained(role, roomId);
    if (!PeerCursor.myCursor) return;
    const wasGM = PeerCursor.myCursor.isGMMode;
    PeerCursor.isGMHold = false;
    PeerCursor.myCursor.isGMMode = role === 'gm';
    if (wasGM !== PeerCursor.myCursor.isGMMode) {
      EventSystem.trigger('CHANGE_GM_MODE', null);
    }
  }

  private static resolveRoomId(roomId?: string): string {
    return (roomId || Network.peer?.roomId || '').trim();
  }

  private static ensureAttainedLoaded(roomId: string) {
    if (RoomAuth.attainedRoomId === roomId) return;
    let rank = 0;
    try {
      const raw = sessionStorage.getItem(RoomAuth.ATTAINED_STORAGE_PREFIX + roomId);
      const parsed = raw ? parseInt(raw, 10) : 0;
      if (Number.isFinite(parsed) && parsed > 0) rank = parsed;
    } catch { /* ignore */ }
    RoomAuth.attainedRoomId = roomId;
    RoomAuth.attainedRank = rank;
  }

  private static persistAttained(roomId: string, rank: number) {
    try {
      sessionStorage.setItem(RoomAuth.ATTAINED_STORAGE_PREFIX + roomId, String(rank));
    } catch { /* ignore */ }
  }

  private static detectMarker(roomName: string): { marker: string; digestLen: number; index: number } | null {
    if (!roomName) return null;
    const idxV3 = roomName.indexOf(RoomAuth.AUTH_MARKER_V3);
    const idxV2 = roomName.indexOf(RoomAuth.AUTH_MARKER_V2);
    const idxV1 = roomName.indexOf(RoomAuth.AUTH_MARKER);
    const candidates: { marker: string; digestLen: number; index: number }[] = [];
    if (idxV3 >= 0) candidates.push({ marker: RoomAuth.AUTH_MARKER_V3, digestLen: RoomAuth.DIGEST_LEN_V3, index: idxV3 });
    if (idxV2 >= 0) candidates.push({ marker: RoomAuth.AUTH_MARKER_V2, digestLen: RoomAuth.DIGEST_LEN_V2, index: idxV2 });
    if (idxV1 >= 0) candidates.push({ marker: RoomAuth.AUTH_MARKER, digestLen: RoomAuth.DIGEST_LEN, index: idxV1 });
    if (candidates.length < 1) return null;
    candidates.sort((a, b) => a.index - b.index);
    return candidates[0];
  }

  private static sanitizeDisplayName(name: string): string {
    return name
      .split(RoomAuth.AUTH_MARKER_V3).join('')
      .split(RoomAuth.AUTH_MARKER_V2).join('')
      .split(RoomAuth.AUTH_MARKER).join('')
      .split(GuestSession.ALLOW_GUEST_MARKER).join('')
      .trim() || translate('room.defaultName');
  }

  private static allEnabledPasswordGated(
    gates: Record<RoomRole, { mode: RoleGateMode; password: string }>,
  ): boolean {
    let enabled = 0;
    for (const role of ROLES) {
      if (gates[role].mode === 'disabled') continue;
      enabled++;
      if (gates[role].mode !== 'password' || !gates[role].password) return false;
    }
    return enabled > 0;
  }

  private static encodeGate(
    roomId: string,
    display: string,
    role: RoomRole,
    gate: { mode: RoleGateMode; password: string },
    digestLen: number,
  ): string {
    if (gate.mode === 'disabled') return '0';
    if (gate.mode === 'open' || !gate.password) return '*';
    return '1' + RoomAuth.calcDigest(roomId, display, role, gate.password, digestLen);
  }

  private static normalizeAuthInput(input?: RoleAuthInput): { mode: RoleGateMode; password: string } {
    if (input == null || typeof input === 'string') {
      const password = typeof input === 'string' ? input : '';
      return { mode: password ? 'password' : 'open', password };
    }
    if (input.mode === 'disabled') return { mode: 'disabled', password: '' };
    const password = input.password || '';
    if (!password || input.mode === 'open') return { mode: 'open', password: '' };
    return { mode: 'password', password };
  }

  private static readGate(blob: string, start: number, digestLen: number): { gate: RoleGate; next: number } {
    if (start >= blob.length) return { gate: { mode: 'disabled', digest: '' }, next: start };
    const flag = blob.charAt(start);
    if (flag === '*') return { gate: { mode: 'open', digest: '' }, next: start + 1 };
    if (flag === '0') return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
    if (flag === '1') {
      const digest = blob.slice(start + 1, start + 1 + digestLen);
      return { gate: { mode: 'password', digest }, next: start + 1 + digestLen };
    }
    return { gate: { mode: 'disabled', digest: '' }, next: start + 1 };
  }

  private static calcDigest(roomId: string, displayName: string, role: RoomRole, password: string, digestLen: number): string {
    return CryptoUtil.sha256Hex(`${role}\n${roomId}\n${displayName}\n${password}`).slice(0, digestLen);
  }

  private static meshKeyBytes(roomId: string, displayName: string, role: RoomRole, password: string): Uint8Array {
    const hex = CryptoUtil.sha256Hex(`mesh\n${role}\n${roomId}\n${displayName}\n${password}`);
    return RoomAuth.hexToBytes(hex.slice(0, RoomAuth.SEAL_HEX_LEN));
  }

  private static deriveMeshSeed(
    roomId: string,
    display: string,
    gates: Record<RoomRole, { mode: RoleGateMode; password: string }>,
  ): Uint8Array {
    const lines = ROLES.map(role => {
      const g = gates[role];
      if (g.mode === 'password') return `${role}:p:${g.password}`;
      return `${role}:${g.mode}`;
    });
    const hex = CryptoUtil.sha256Hex(`mesh-seed\n${roomId}\n${display}\n${lines.join('\n')}`);
    return RoomAuth.hexToBytes(hex.slice(0, RoomAuth.SEAL_HEX_LEN));
  }

  /** Stretch short sealed seed into a channel password string. */
  static stretchMeshSecret(secretHex: string, roomId: string, roomName: string): string {
    if (!secretHex) return '';
    return CryptoUtil.sha256Hex(`udon-mesh\n${roomId}\n${roomName}\n${secretHex}`).slice(0, 16);
  }

  private static xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const n = Math.min(a.length, b.length);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i];
    return out;
  }

  private static bytesToHex(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
  }

  private static hexToBytes(hex: string): Uint8Array {
    const len = Math.floor(hex.length / 2);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
}
