import { Card } from './card';
import { CardStack } from './card-stack';
import { CharacterToken } from './character-token';
import { ClueLink } from './clue-link';
import { SyncObject } from './core/synchronize-object/decorator';
import { GameObject } from './core/synchronize-object/game-object';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml, ObjectSerializer } from './core/synchronize-object/object-serializer';
import { ObjectStore } from './core/synchronize-object/object-store';
import { DiceSymbol } from './dice-symbol';
import { GameCharacter } from './game-character';
import { GameTable } from './game-table';
import { GameTableMask } from './game-table-mask';
import { RangeArea } from './range';
import { AuraNameConfig } from './table-fx/aura-name-config';
import { CombatTracker } from './table-fx/combat-tracker';
import { SceneToolPermission } from './table-fx/scene-tool-permission';
import { TableSelecter } from './table-selecter';
import { TabletopObject } from './tabletop-object';
import { Terrain } from './terrain';
import { TextNote } from './text-note';

/** One top-level room child skipped during resilient load. */
export type RoomLoadSkip = { tag: string; syncId: string; reason: string };

/** Summary of the last {@link Room.parseInnerXml} call. */
export type RoomLoadReport = {
  loaded: number;
  skipped: RoomLoadSkip[];
};

/** One object skipped during resilient room save ({@link Room.innerXml}). */
export type RoomSaveSkip = { aliasName: string; identifier: string; reason: string };

/** Summary of the last {@link Room.innerXml} call. */
export type RoomSaveReport = {
  written: number;
  skipped: RoomSaveSkip[];
};

@SyncObject('room')
export class Room extends GameObject implements InnerXml {
  /** Last room XML load outcome (for diagnostics / UI). */
  static lastLoadReport: RoomLoadReport = { loaded: 0, skipped: [] };
  /** Set when the latest load skipped objects; cleared after UI/log consumption. */
  static pendingLoadUserNotice = false;
  /** Last room XML save outcome (for diagnostics / UI). */
  static lastSaveReport: RoomSaveReport = { written: 0, skipped: [] };

  // GameObject Lifecycle
  onStoreAdded() {
    super.onStoreAdded();
    ObjectStore.instance.remove(this); // 不登錄到 ObjectStore
  }

  innerXml(): string {
    let xml = '';
    let objects: GameObject[] = [];
    objects = objects.concat(ObjectStore.instance.getObjects(GameTable));
    objects = objects.concat(ObjectStore.instance.getObjects(GameCharacter));
    objects = objects.concat(ObjectStore.instance.getObjects(CharacterToken));
    objects = objects.concat(ObjectStore.instance.getObjects(RangeArea));
    objects = objects.concat(ObjectStore.instance.getObjects(TextNote));
    objects = objects.concat(ObjectStore.instance.getObjects(CardStack));
    objects = objects.concat(ObjectStore.instance.getObjects(Card).filter((obj) => { return obj.parent === null }));
    objects = objects.concat(ObjectStore.instance.getObjects(DiceSymbol));
    objects = objects.concat(ObjectStore.instance.getObjects(ClueLink));
    objects.push(AuraNameConfig.instance);
    objects.push(CombatTracker.instance);
    objects.push(SceneToolPermission.instance);
    objects.push(TableSelecter.instance);
    const report: RoomSaveReport = { written: 0, skipped: [] };
    for (let object of objects) {
      try {
        xml += object.toXml();
        report.written++;
      } catch (e) {
        const aliasName = object?.aliasName || '';
        const identifier = object?.identifier || '';
        report.skipped.push({
          aliasName,
          identifier,
          reason: String((e as Error)?.message || e),
        });
        console.warn('[Room] skip object during save (toXml failed)', aliasName, identifier, e);
      }
    }
    Room.lastSaveReport = report;
    if (report.skipped.length) {
      console.warn(
        `[Room] wrote ${report.written} object(s); skipped ${report.skipped.length}`,
        report.skipped
      );
    }
    return xml;
  }

  parseInnerXml(element: Element) {
    for (const object of Room.listTabletopObjects()) {
      try {
        if (!ObjectStore.instance.get(object.identifier)) continue;
        // Local-only: broadcasting DELETE here wipes an overlapping tab that still
        // holds the house (refresh ghost), and that tab may flush the empty store.
        object.destroyLocal();
      } catch (e) {
        console.warn('[Room] destroy before reload failed', object?.identifier, e);
      }
    }
    // Allow syncId reuse after destroy marks identifiers as deleted.
    ObjectStore.instance.clearDeleteHistory();
    // Drop stale session view so legacy ZIPs without TableSelecter use selected/first table.
    TableSelecter.instance.prepareForRoomReload();

    const report: RoomLoadReport = { loaded: 0, skipped: [] };
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      const syncId = child.getAttribute(ObjectSerializer.SYNC_ID_ATTR) || '';
      try {
        const obj = ObjectSerializer.instance.parseXml(child);
        if (obj) {
          report.loaded++;
        } else {
          report.skipped.push({
            tag: child.tagName || '',
            syncId,
            reason: 'parse returned null',
          });
        }
      } catch (e) {
        // Defense in depth — parseXml already traps; keep loading siblings.
        report.skipped.push({
          tag: child.tagName || '',
          syncId,
          reason: String((e as Error)?.message || e),
        });
        console.warn('[Room] skip corrupt top-level object', child.tagName, syncId, e);
      }
    }
    Room.lastLoadReport = report;
    Room.pendingLoadUserNotice = report.skipped.length > 0;
    if (report.skipped.length) {
      console.warn(
        `[Room] loaded ${report.loaded} object(s); skipped ${report.skipped.length}`,
        report.skipped
      );
    }

    // Post-steps are independent: one failure must not block the others.
    try {
      TabletopObject.repairOrphanedPieceBindings();
    } catch (e) {
      console.warn('[Room] repairOrphanedPieceBindings failed', e);
    }
    try {
      TableSelecter.instance.restoreAfterRoomLoad();
    } catch (e) {
      console.warn('[Room] restoreAfterRoomLoad failed', e);
    }
    try {
      // Fresh XML objects start at version ~0; shared default syncIds would otherwise lose
      // LWW to a joiner's aged lobby defaults (house looks replaced by sample tables).
      Room.claimLoadedRoomSyncAuthority();
    } catch (e) {
      console.warn('[Room] claimLoadedRoomSyncAuthority failed', e);
    }
  }

  /** After room load: make loaded objects win ObjectSynchronizer version merge. */
  static claimLoadedRoomSyncAuthority() {
    for (const object of Room.listSyncedRoomObjects()) {
      Room.claimTree(object);
    }
  }

  /**
   * Before mesh-joining a room: drop local tabletop samples so we pull the host's
   * house instead of pushing lobby defaults onto shared syncIds.
   */
  static clearLocalTabletopForJoin() {
    for (const object of Room.listTabletopObjects()) {
      if (!ObjectStore.instance.get(object.identifier)) continue;
      // Must cascade: ObjectStore.delete(parent) leaves DataElement children orphaned
      // (not in parent._children after recreate) and their high lobby versions win LWW.
      object.destroyLocal();
    }
    ObjectStore.instance.clearDeleteHistory();
    TableSelecter.instance.prepareForRoomReload();
    for (const object of Room.listRoomSingletons()) {
      object.yieldSyncAuthority();
    }
  }

  private static claimTree(object: GameObject) {
    try {
      object.claimSyncAuthority(true);
      if (object instanceof ObjectNode) {
        for (const child of object.children) {
          Room.claimTree(child);
        }
      }
    } catch (e) {
      console.warn('[Room] claimTree skip', object?.identifier, e);
    }
  }

  private static listTabletopObjects(): GameObject[] {
    let objects: GameObject[] = [];
    objects = objects.concat(ObjectStore.instance.getObjects(GameTable));
    objects = objects.concat(ObjectStore.instance.getObjects(GameTableMask));
    objects = objects.concat(ObjectStore.instance.getObjects(Terrain));
    objects = objects.concat(ObjectStore.instance.getObjects(GameCharacter));
    objects = objects.concat(ObjectStore.instance.getObjects(CharacterToken));
    objects = objects.concat(ObjectStore.instance.getObjects(RangeArea));
    objects = objects.concat(ObjectStore.instance.getObjects(TextNote));
    objects = objects.concat(ObjectStore.instance.getObjects(CardStack));
    objects = objects.concat(ObjectStore.instance.getObjects(Card));
    objects = objects.concat(ObjectStore.instance.getObjects(DiceSymbol));
    objects = objects.concat(ObjectStore.instance.getObjects(ClueLink));
    return objects;
  }

  private static listRoomSingletons(): GameObject[] {
    return [
      AuraNameConfig.instance,
      CombatTracker.instance,
      SceneToolPermission.instance,
      TableSelecter.instance,
    ];
  }

  private static listSyncedRoomObjects(): GameObject[] {
    return Room.listTabletopObjects().concat(Room.listRoomSingletons());
  }
}
