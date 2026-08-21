/** Folder auto-backup layout (v2): shared media + per-room state directories. */

export const FOLDER_BACKUP_FORMAT_VERSION = 2;

export const MEDIA_DIR = 'media';
export const ROOMS_DIR = 'rooms';
export const LATEST_DIR = 'latest';
export const RECENT_DIR = 'recent';
export const PREVIEW_FILE = 'preview.jpg';
export const MANIFEST_FILE = 'manifest.json';
export const STATE_ZIP_FILE = 'state.zip';
export const ROOM_META_FILE = 'room.meta.json';

export const RECENT_SLOT_COUNT = 4;
export const RECENT_INTERVAL_MS = 15 * 60 * 1000;
export const SNAP_1D_MS = 24 * 60 * 60 * 1000;
export const SNAP_7D_MS = 7 * SNAP_1D_MS;
export const SNAP_30D_MS = 30 * SNAP_1D_MS;

export const SNAP_DIRS = ['snap_1d', 'snap_7d', 'snap_30d'] as const;
export type SnapDir = (typeof SNAP_DIRS)[number];

/** State / config files written into each slot directory (not media blobs). */
export const STATE_FILE_NAMES = new Set([
  'fly_data.xml',
  'fly_chat.xml',
  'fly_rollTable.xml',
  'fly_cutIn.xml',
  'summary.xml',
  'fly_auraNames.xml',
  'fly_combat.xml',
  'fly_scenePerm.xml',
  'fly_scenePreset.xml',
  'fly_scenarioText.xml',
  'fly_audioLibrary.xml',
  'fly_jukebox.xml',
  'fly_imageTag.xml',
  'fly_audioUrls.json',
]);

export type FolderBackupSlotKind = 'latest' | 'recent' | 'snap_1d' | 'snap_7d' | 'snap_30d' | 'legacy_zip';

export interface FolderBackupManifest {
  formatVersion: number;
  savedAt: string;
  files: Record<string, string>;
  media: { hash: string; name: string; kind?: string }[];
  stateFingerprint?: string;
  stateZip?: string;
}

export interface FolderBackupRoomMetaV2 {
  formatVersion: number;
  roomId: string;
  displayName: string;
  savedAt: string;
  /** First successful v2 save — retention intervals count from this. */
  firstSavedAt?: string;
  includeAudio?: boolean;
  allowUser?: boolean;
  allowGuest?: boolean;
  secrets?: {
    v: 1;
    salt: string;
    iv: string;
    data: string;
  };
  /** @deprecated legacy */
  gmPassword?: string;
  userPassword?: string;
  guestPassword?: string;
  slots?: {
    latest?: string;
    recent?: string[];
    snap_1d?: string;
    snap_7d?: string;
    snap_30d?: string;
    recentIndex?: number;
  };
}

/** Media blob names: content-hash filename used in room ZIPs. */
export function isMediaFileName(name: string): boolean {
  if (!name || STATE_FILE_NAMES.has(name)) return false;
  if (name === MANIFEST_FILE || name === PREVIEW_FILE) return false;
  return /^[a-f0-9]{64}\.[A-Za-z0-9]+$/i.test(name);
}

export function mediaHashFromName(name: string): string {
  const i = name.indexOf('.');
  return i > 0 ? name.slice(0, i).toLowerCase() : name.toLowerCase();
}

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Aggregate fingerprint used to skip rewriting state.zip when room XML is unchanged.
 * Input: per-file name → content hash (same map written into manifest.files).
 */
export async function computeStateFingerprint(
  fileFingerprints: Record<string, string>
): Promise<string> {
  const parts = Object.keys(fileFingerprints)
    .sort()
    .map(name => `${name}:${fileFingerprints[name]}`);
  return sha256Hex(parts.join('|'));
}

/** True when previous manifest fingerprint matches current state (skip state.zip write). */
export function shouldSkipStateZipWrite(
  stateFingerprint: string,
  previousStateFingerprint: string | undefined | null
): boolean {
  return !!stateFingerprint && stateFingerprint === (previousStateFingerprint || '');
}

export function dataUrlToJpegBlob(dataUrl: string): Blob | null {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(header)?.[1] || 'image/jpeg';
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
