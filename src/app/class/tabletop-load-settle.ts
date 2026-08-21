import { EventSystem } from './core/system';

/**
 * Tabletop load / join settle gate — animation + remount ownership only.
 *
 * Does NOT touch Network.open, joinInProgress, or reopenLastRoomOrLobby.
 * Connection races stay in RoomConnectHelper; this only prevents enter-bounce
 * scale(0) stalls and coordinates a single identity remount vs archive sync.
 *
 * Dual-path contract:
 * - ZIP/folder: restore → ROOM_PIECES (one remount); ARCHIVE_LOAD_COMPLETE sync-only;
 *   gate stays up until afterArchiveSettle (archivePending).
 * - Mesh join: restore → ROOM_PIECES once; no delayed second ROOM_PIECES;
 *   gate releases after noteIdentityRemountDone.
 */
export class TabletopLoadSettle {
  private static busyFlag = false;
  private static archivePending = false;
  private static endTimer: ReturnType<typeof setTimeout> | null = null;

  /** True while room pieces should skip enter animations. */
  static get busy(): boolean {
    return TabletopLoadSettle.busyFlag;
  }

  static get skipEnterAnimation(): boolean {
    return TabletopLoadSettle.busyFlag;
  }

  static begin(opts?: { expectArchive?: boolean }) {
    TabletopLoadSettle.busyFlag = true;
    if (opts?.expectArchive) TabletopLoadSettle.archivePending = true;
    TabletopLoadSettle.clearEndTimer();
  }

  /** Call when FileArchiver knows this batch includes a room ZIP. */
  static markExpectArchive() {
    TabletopLoadSettle.archivePending = true;
    TabletopLoadSettle.busyFlag = true;
    TabletopLoadSettle.clearEndTimer();
  }

  /**
   * After the single identity remount (ROOM_PIECES_REPLACED).
   * If a ZIP archive settle will follow, keep the gate until afterArchiveSettle.
   */
  static noteIdentityRemountDone(releaseMs = 220) {
    if (TabletopLoadSettle.archivePending) return;
    TabletopLoadSettle.scheduleRelease(releaseMs);
  }

  /** After ARCHIVE_LOAD_COMPLETE sync pipeline (no remount). */
  static afterArchiveSettle(releaseMs = 220) {
    TabletopLoadSettle.archivePending = false;
    TabletopLoadSettle.scheduleRelease(releaseMs);
  }

  /** Map-switch short suppress without expecting archive. */
  static suppressBriefly(ms = 100) {
    TabletopLoadSettle.busyFlag = true;
    TabletopLoadSettle.scheduleRelease(ms);
  }

  static forceRelease() {
    TabletopLoadSettle.release();
  }

  private static scheduleRelease(ms: number) {
    TabletopLoadSettle.clearEndTimer();
    TabletopLoadSettle.endTimer = setTimeout(() => TabletopLoadSettle.release(), ms);
  }

  private static clearEndTimer() {
    if (TabletopLoadSettle.endTimer != null) {
      clearTimeout(TabletopLoadSettle.endTimer);
      TabletopLoadSettle.endTimer = null;
    }
  }

  private static release() {
    TabletopLoadSettle.clearEndTimer();
    const wasBusy = TabletopLoadSettle.busyFlag;
    TabletopLoadSettle.busyFlag = false;
    TabletopLoadSettle.archivePending = false;
    if (wasBusy) {
      try {
        EventSystem.trigger('TABLETOP_LOAD_SETTLE_DONE', null);
      } catch (e) {
        console.warn('TABLETOP_LOAD_SETTLE_DONE failed', e);
      }
    }
  }
}
