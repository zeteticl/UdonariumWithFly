import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { ObjectStore } from './core/synchronize-object/object-store';
import { GameTable } from './game-table';
import { translate } from 'i18n';

/** One object’s SyncVar bag (+ optional altitude / explicit pose). */
export interface SceneObjectSnap {
  identifier: string;
  /** SyncObject alias when captured (e.g. character); used to skip tokens reliably. */
  aliasName?: string;
  syncData: Object;
  altitude?: number;
  /** Explicit pose — preferred over digging syncData.attributes (ObjectNode SyncAttrs). */
  x?: number;
  y?: number;
  posZ?: number;
  rotate?: number;
  locationName?: string;
}

export interface SceneTabletopSnap {
  version: 1;
  tableSync?: Object;
  tableChildren?: SceneObjectSnap[];
  pieces?: SceneObjectSnap[];
}

export function resolveScenePresetTable(preset: {
  tableIdentifier?: string;
  tabletopSnap?: SceneTabletopSnap | null;
}): GameTable | null {
  if (!preset) return null;
  if (preset.tableIdentifier) {
    const byId = ObjectStore.instance.get<GameTable>(preset.tableIdentifier);
    if (byId) return byId;
  }
  const tables = ObjectStore.instance.getObjects(GameTable);
  const name = readTableNameFromSnap(preset.tabletopSnap);
  if (name) {
    const matches = tables.filter(t => t.name === name);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return matches.find(t => t.selected) || matches[0];
  }
  if (tables.length === 1) return tables[0];
  return null;
}

function readTableNameFromSnap(snap: SceneTabletopSnap | null | undefined): string {
  if (!snap?.tableSync || typeof snap.tableSync !== 'object') return '';
  const sync = snap.tableSync as any;
  const name = sync?.attributes?.name ?? sync?.name;
  return typeof name === 'string' ? name : '';
}

@SyncObject('scene-preset')
export class ScenePreset extends ObjectNode {
  @SyncVar() title: string = '';
  @SyncVar() switchText: string = '';
  @SyncVar() tableIdentifier: string = '';
  @SyncVar() tracksJson: string = '';
  /** Epoch ms when the last full snapshot was written. */
  @SyncVar() savedAt: number = 0;
  /** JSON {@link SceneTabletopSnap}: table atmosphere, FX children, token/piece SyncVars. */
  @SyncVar() tabletopJson: string = '';
  /** JPEG data URL of the map at save time (no UI panels); used for list + hover preview. */
  @SyncVar() previewJpeg: string = '';

  get table(): GameTable {
    return resolveScenePresetTable(this);
  }

  get isValid(): boolean {
    return !!this.table;
  }

  get tableDisplayName(): string {
    const table = this.table;
    if (table) return table.name;
    return translate('scenePreset.tableDeleted');
  }

  get tabletopSnap(): SceneTabletopSnap | null {
    if (!this.tabletopJson) return null;
    try {
      const parsed = JSON.parse(this.tabletopJson);
      if (parsed && typeof parsed === 'object') return parsed as SceneTabletopSnap;
    } catch { /* ignore */ }
    return null;
  }

  get savedAtDisplay(): string {
    return this.savedAtCompact;
  }

  /** Compact local time: YYYY-M-D HH:mm */
  get savedAtCompact(): string {
    if (!this.savedAt) return '';
    try {
      const d = new Date(this.savedAt);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  }
}
