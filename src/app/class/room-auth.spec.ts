import { PeerContext } from './core/system/network/peer-context';
import { RoomAuth } from './room-auth';

describe('RoomAuth V3 mesh lock', () => {
  const roomId = 'Ab1';
  const display = '普通房間7685';
  const passwords = { gm: 'abc', user: 'def', guest: 'ghi' };

  it('encodes mesh lock when all enabled roles have passwords', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    expect(RoomAuth.isRoleAuthRoom(roomName)).toBeTrue();
    expect(RoomAuth.isMeshLocked(roomName)).toBeTrue();
    expect(RoomAuth.displayRoomName(roomName)).toBe(display);
    expect(meshPassword.length).toBeGreaterThan(0);
  });

  it('roundtrips mesh password for each role', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    for (const role of ['gm', 'user', 'guest'] as const) {
      expect(RoomAuth.verify(roomId, roomName, role, passwords[role])).toBeTrue();
      expect(RoomAuth.resolveMeshPassword(roomId, roomName, role, passwords[role])).toBe(meshPassword);
    }
    expect(RoomAuth.resolveMeshPassword(roomId, roomName, 'user', 'wrong')).not.toBe(meshPassword);
  });

  it('keeps peerId within SkyWay length for typical CJK + 3 passwords', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    const peer = PeerContext.create('testUserId01', roomId, roomName, meshPassword);
    expect(peer.peerId.length).toBeLessThanOrEqual(64);
    expect(peer.roomName).toBe(roomName);
    expect(peer.meshPassword).toBe(meshPassword);
    expect(peer.channelPassword).toBe(meshPassword);
    expect(peer.password).toBe('');
  });

  it('does not mesh-lock when any enabled role is open', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, {
      gm: 'abc',
      user: '',
      guest: { mode: 'disabled' },
    });
    expect(RoomAuth.isMeshLocked(roomName)).toBeFalse();
    expect(meshPassword).toBe('');
  });

  it('is deterministic for the same inputs', () => {
    const a = RoomAuth.encode(display, roomId, passwords);
    const b = RoomAuth.encode(display, roomId, passwords);
    expect(a.roomName).toBe(b.roomName);
    expect(a.meshPassword).toBe(b.meshPassword);
  });

  it('isMeshLocked agrees with PeerContext mesh packing for sealed V3 rooms', () => {
    const { roomName, meshPassword } = RoomAuth.encode(display, roomId, passwords);
    expect(RoomAuth.isMeshLocked(roomName)).toBeTrue();
    const peer = PeerContext.create('testUserId01', roomId, roomName, meshPassword);
    expect(peer.meshPassword).toBe(meshPassword);
    expect(peer.digestPassword.length).toBe(0);
  });
});

/**
 * Repro: lobby opens RoomJoin with a RoomInfo snapshot; host rekeys passwords
 * while the modal is open; joiner types the *new* password.
 * RoomJoin/lobby still verify + resolveMesh against the stale room.name.
 */
describe('RoomAuth join after host rekey (stale roomName snapshot)', () => {
  const roomId = 'Ab1';
  const display = '改密測試房';

  it('new password fails verify against pre-rekey roomName (wrong-password UI)', () => {
    const before = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-old',
      guest: { mode: 'disabled' },
    });
    const after = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-new',
      guest: { mode: 'disabled' },
    });
    expect(before.roomName).not.toBe(after.roomName);

    // What RoomJoinComponent.submit does today: verify(staleRoom.name, typedNewPw)
    expect(RoomAuth.verify(roomId, before.roomName, 'user', 'user-new')).toBeFalse();
    expect(RoomAuth.verify(roomId, after.roomName, 'user', 'user-new')).toBeTrue();
  });

  it('new password + stale roomName yields wrong mesh key (connect fails even if verify bypassed)', () => {
    const before = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-old',
      guest: { mode: 'disabled' },
    });
    const after = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-new',
      guest: { mode: 'disabled' },
    });
    expect(RoomAuth.isMeshLocked(before.roomName)).toBeTrue();
    expect(RoomAuth.isMeshLocked(after.roomName)).toBeTrue();

    const staleMesh = RoomAuth.resolveMeshPassword(roomId, before.roomName, 'user', 'user-new');
    const freshMesh = RoomAuth.resolveMeshPassword(roomId, after.roomName, 'user', 'user-new');
    expect(freshMesh).toBe(after.meshPassword);
    expect(staleMesh).not.toBe(freshMesh);
  });

  it('old password still verifies on stale snapshot but cannot reach post-rekey mesh', () => {
    const before = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-old',
      guest: { mode: 'disabled' },
    });
    const after = RoomAuth.encode(display, roomId, {
      gm: 'gm-old',
      user: 'user-new',
      guest: { mode: 'disabled' },
    });

    expect(RoomAuth.verify(roomId, before.roomName, 'user', 'user-old')).toBeTrue();
    const meshFromStale = RoomAuth.resolveMeshPassword(roomId, before.roomName, 'user', 'user-old');
    expect(meshFromStale).toBe(before.meshPassword);
    expect(meshFromStale).not.toBe(after.meshPassword);
  });
});
