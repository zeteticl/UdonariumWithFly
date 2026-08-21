import { Injectable } from '@angular/core';

import { Network } from '@udonarium/core/system';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { RoomAuth, RoomRole } from '@udonarium/room-auth';
import { RoomConnectHelper } from '@udonarium/room-connect-helper';

export interface RoomInvitePayload {
  v: 1;
  id: string;
  /** Full encoded room name (includes role-auth blob). */
  n: string;
  r: RoomRole;
  /** Role password when the gate requires one. */
  p?: string;
}

export type RoomInviteJoinResult =
  | 'ok'
  | 'notFound'
  | 'joinDataTimeout'
  | 'joinNetworkTimeout'
  | 'badPassword'
  | 'roleUnavailable'
  | 'alreadyInRoom'
  | 'invalid';

@Injectable({ providedIn: 'root' })
export class RoomInviteService {
  private rolePasswords: Partial<Record<RoomRole, string>> = {};

  setRolePasswords(passwords: { gm?: string; user?: string; guest?: string }) {
    if (passwords.gm != null) this.rolePasswords.gm = passwords.gm;
    if (passwords.user != null) this.rolePasswords.user = passwords.user;
    if (passwords.guest != null) this.rolePasswords.guest = passwords.guest;
    for (const role of ['gm', 'user', 'guest'] as RoomRole[]) {
      if (passwords[role] != null) {
        RoomAuth.rememberSession(role, passwords[role] || '');
      }
    }
  }

  setRolePassword(role: RoomRole, password: string) {
    this.rolePasswords[role] = password || '';
    RoomAuth.rememberSession(role, password || '');
  }

  getRolePassword(role: RoomRole): string {
    return this.rolePasswords[role] || '';
  }

  clearRolePasswords() {
    this.rolePasswords = {};
  }

  buildInviteUrl(role: RoomRole, password?: string): string {
    const peer = Network.peer;
    if (!peer?.isRoom) throw new Error('Not in a room');
    const payload: RoomInvitePayload = {
      v: 1,
      id: peer.roomId,
      n: peer.roomName,
      r: role,
    };
    if (password) payload.p = password;
    const url = new URL(window.location.href);
    url.searchParams.set('invite', this.encodeToken(payload));
    return url.toString();
  }

  /** True when URL has an invite query (even if the token is truncated / corrupt). */
  hasInviteInLocation(): boolean {
    try {
      return new URLSearchParams(window.location.search).has('invite');
    } catch {
      return false;
    }
  }

  parseInviteFromLocation(): RoomInvitePayload | null {
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('invite');
      if (!token) return null;
      return this.decodeToken(token);
    } catch {
      return null;
    }
  }

  clearInviteFromLocation() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('invite')) return;
      url.searchParams.delete('invite');
      const next = url.pathname + url.search + url.hash;
      history.replaceState(null, '', next);
    } catch {
      /* ignore */
    }
  }

  async joinFromInvite(payload: RoomInvitePayload, options?: { retries?: number; retryDelayMs?: number }): Promise<RoomInviteJoinResult> {
    if (!payload || payload.v !== 1 || !payload.id || !payload.n || !payload.r) return 'invalid';
    if (payload.r !== 'gm' && payload.r !== 'user' && payload.r !== 'guest') return 'invalid';
    if (Network.peer?.isRoom) return 'alreadyInRoom';

    if (!RoomAuth.isRoleAvailable(payload.n, payload.r)) return 'roleUnavailable';

    if (RoomAuth.isRoleAuthRoom(payload.n)) {
      if (!RoomAuth.verify(payload.id, payload.n, payload.r, payload.p || '')) {
        return 'badPassword';
      }
    }

    const retries = options?.retries ?? 10;
    const delayMs = options?.retryDelayMs ?? 500;
    let room: IRoomInfo = null;

    for (let i = 0; i < retries; i++) {
      const rooms = await Network.listAllRooms(true);
      room = rooms.find(r => r.id === payload.id && r.name === payload.n) || null;
      if (room && room.peers.length > 0) break;
      room = null;
      if (i < retries - 1) await this.delay(delayMs);
    }

    if (!room) return 'notFound';

    let skywayPassword = '';
    if (RoomAuth.isRoleAuthRoom(payload.n)) {
      skywayPassword = RoomAuth.resolveMeshPassword(
        payload.id, payload.n, payload.r, payload.p || '');
    } else {
      skywayPassword = payload.p || '';
    }
    const targetPeers = room.filterByPassword(
      RoomAuth.isMeshLocked(payload.n) || RoomAuth.isRoleAuthRoom(payload.n) ? '' : skywayPassword);
    if (targetPeers.length < 1) return 'notFound';

    RoomAuth.applyIdentity(payload.r, payload.id);
    this.setRolePassword(payload.r, payload.p || '');
    RoomAuth.rememberSession(payload.r, payload.p || '', skywayPassword);
    const ok = await RoomConnectHelper.openAndConnect(room, skywayPassword, targetPeers);
    if (ok) return 'ok';
    const key = RoomConnectHelper.joinFailMessageKey(RoomConnectHelper.lastJoinFailReason);
    if (key === 'lobby.joinDataTimeout') return 'joinDataTimeout';
    if (key === 'lobby.joinNetworkTimeout') return 'joinNetworkTimeout';
    return 'notFound';
  }

  encodeToken(payload: RoomInvitePayload): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  decodeToken(token: string): RoomInvitePayload | null {
    try {
      let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const data = JSON.parse(json);
      if (!data || data.v !== 1) return null;
      return data as RoomInvitePayload;
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
