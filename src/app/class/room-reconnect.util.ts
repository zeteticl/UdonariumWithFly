/** Last successful room open — used to rejoin after SkyWay fatal closes the peer. */
export type LastRoomSession = {
  userId: string;
  roomId: string;
  roomName: string;
  /** SkyWay channel password (mesh or legacy). */
  meshPassword: string;
};

/** Transient errors where auto-reopen is safe (not backend/auth config). */
export const RECOVERABLE_NETWORK_ERROR_TYPES = [
  'disconnected',
  'socket-error',
  'unavailable-id',
  /** SkyWay SDK: updateMemberTtl / restartIce / event lost after cable drop. */
  'internal',
  /** formatFatalError fallback when SDK name is missing. */
  'default',
] as const;

/**
 * Also try room reopen for these: a fresh Network.open() refreshes SkyWay token /
 * context. If reopen fails, the UI still shows the backend help modal.
 */
export const ROOM_REOPEN_NETWORK_ERROR_TYPES = [
  ...RECOVERABLE_NETWORK_ERROR_TYPES,
  'token-expired',
  'authentication',
  'server-error',
] as const;

export type RoomReopenResult = 'started' | 'busy' | 'no-session';

export function isRecoverableNetworkError(errorType: string): boolean {
  return (RECOVERABLE_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}

/** True when we should try reopenLastRoom (including token / transient backend errors). */
export function shouldAttemptRoomReopen(errorType: string): boolean {
  return (ROOM_REOPEN_NETWORK_ERROR_TYPES as readonly string[]).includes(errorType);
}
