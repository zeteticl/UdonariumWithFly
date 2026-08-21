/**
 * V3 roomName mesh-lock detection shared by PeerContext (peerId packing)
 * and RoomAuth (role gates). Keep one implementation to avoid drift.
 */
export const ROOM_AUTH_MARKER_V3 = '\u2060C';

const DIGEST_LEN = 2;
const SEAL_HEX_LEN = 4;

/** True when V3 blob includes sealed mesh secret after role gates. */
export function roomNameHasMeshLock(roomName: string): boolean {
  if (!roomName) return false;
  const i = roomName.indexOf(ROOM_AUTH_MARKER_V3);
  if (i < 0) return false;
  const blob = roomName.slice(i + ROOM_AUTH_MARKER_V3.length);
  let pos = 0;
  let passwordCount = 0;
  for (let g = 0; g < 3; g++) {
    if (pos >= blob.length) return false;
    const f = blob.charAt(pos);
    if (f === '*' || f === '0') {
      pos += 1;
      continue;
    }
    if (f === '1') {
      pos += 1 + DIGEST_LEN;
      passwordCount++;
      continue;
    }
    return false;
  }
  let sealStart = pos;
  if (blob.charAt(sealStart) === 'M') sealStart++; // legacy V3 marker
  const leftover = blob.length - sealStart;
  return passwordCount > 0 && leftover === passwordCount * SEAL_HEX_LEN;
}
