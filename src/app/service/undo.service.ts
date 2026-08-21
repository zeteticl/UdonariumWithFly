import { Injectable } from '@angular/core';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';

/** Sync movable/rotable visuals while selected (self-UPDATE is ignored). */
export type UndoPoseVisualSync = (object: TabletopObject, pose: TransformPose) => void;

export interface UndoCommand {
  label: string;
  undo(): void;
  redo(): void;
}

export interface TransformPose {
  x: number;
  y: number;
  posZ: number;
  rotate?: number;
  /** Character pedestal tilt (top rotate-grab uses targetPropertyName `roll`). */
  roll?: number;
}

export type DeleteEntry =
  | { kind: 'graveyard'; id: string; fromLocation: string; fromTableIdentifier?: string }
  | { kind: 'destroy'; xml: string; parentId: string; liveId: string };

const MAX_STACK = 50;
const MERGE_WINDOW_MS = 300;

@Injectable({
  providedIn: 'root'
})
export class UndoService {
  private static _instance: UndoService;
  static get instance(): UndoService { return UndoService._instance; }

  private undoStack: UndoCommand[] = [];
  private redoStack: UndoCommand[] = [];
  private mergeKey: string | null = null;
  private mergeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Active pointer-drag transform gesture (before poses). */
  private pendingBefore: Map<string, TransformPose> | null = null;
  private poseVisualSync: UndoPoseVisualSync | null = null;

  constructor() {
    UndoService._instance = this;
  }

  /** Register directive visual sync (avoids circular import with MovableDirective). */
  setPoseVisualSync(sync: UndoPoseVisualSync) {
    this.poseVisualSync = sync;
  }

  syncPoseVisual(object: TabletopObject, pose: TransformPose) {
    this.poseVisualSync?.(object, pose);
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.clearMerge();
    this.pendingBefore = null;
  }

  push(cmd: UndoCommand) {
    if (Network.GuestMode() || !cmd) return;
    this.undoStack.push(cmd);
    while (this.undoStack.length > MAX_STACK) this.undoStack.shift();
    this.redoStack = [];
    this.clearMerge();
  }

  /**
   * Merge rapid repeats (WASD nudge / wheel rotate) into one stack entry.
   * `combine` receives previous command (same key) and the new one; return the merged command.
   */
  pushMerged(key: string, cmd: UndoCommand, combine: (prev: UndoCommand, next: UndoCommand) => UndoCommand) {
    if (Network.GuestMode() || !cmd) return;
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && this.mergeKey === key) {
      this.undoStack[this.undoStack.length - 1] = combine(last, cmd);
    } else {
      this.undoStack.push(cmd);
      while (this.undoStack.length > MAX_STACK) this.undoStack.shift();
    }
    this.redoStack = [];
    this.mergeKey = key;
    if (this.mergeTimer) clearTimeout(this.mergeTimer);
    this.mergeTimer = setTimeout(() => this.clearMerge(), MERGE_WINDOW_MS);
  }

  /** True while applying undo/redo (directives sync poses directly). */
  private _applying = false;
  get isApplying(): boolean { return this._applying; }

  undo(): boolean {
    if (Network.GuestMode() || this.undoStack.length < 1) return false;
    const cmd = this.undoStack.pop();
    this._applying = true;
    try {
      cmd.undo();
    } catch (e) {
      console.warn('[UndoService] undo failed', e);
      return false;
    } finally {
      this._applying = false;
    }
    this.redoStack.push(cmd);
    this.clearMerge();
    return true;
  }

  redo(): boolean {
    if (Network.GuestMode() || this.redoStack.length < 1) return false;
    const cmd = this.redoStack.pop();
    this._applying = true;
    try {
      cmd.redo();
    } catch (e) {
      console.warn('[UndoService] redo failed', e);
      return false;
    } finally {
      this._applying = false;
    }
    this.undoStack.push(cmd);
    this.clearMerge();
    return true;
  }

  // ---- Transform gesture (drag move / rotate) ----

  beginTransformGesture() {
    if (Network.GuestMode()) return;
    this.pendingBefore = new Map();
  }

  /** Record original pose once per id (first capture wins). */
  rememberBeforePose(id: string, pose: TransformPose) {
    if (!this.pendingBefore || this.pendingBefore.has(id)) return;
    this.pendingBefore.set(id, { ...pose });
  }

  discardTransformGesture() {
    this.pendingBefore = null;
  }

  commitTransformGesture(after: Map<string, TransformPose>, label = 'transform') {
    if (!this.pendingBefore) return;
    const before = this.pendingBefore;
    this.pendingBefore = null;
    if (before.size < 1 || after.size < 1) return;

    const ids = new Set<string>([...before.keys(), ...after.keys()]);
    let changed = false;
    const beforeSnap = new Map<string, TransformPose>();
    const afterSnap = new Map<string, TransformPose>();
    for (const id of ids) {
      const b = before.get(id) ?? after.get(id);
      const a = after.get(id) ?? before.get(id);
      if (!b || !a) continue;
      if (!posesEqual(b, a)) {
        changed = true;
        beforeSnap.set(id, b);
        afterSnap.set(id, a);
      }
    }
    if (!changed) return;

    this.push(makeTransformCommand(label, beforeSnap, afterSnap));
  }

  /** Immediate transform (nudge / face / wheel) with merge support. */
  recordTransform(label: string, before: Map<string, TransformPose>, after: Map<string, TransformPose>, mergeKey?: string) {
    if (before.size < 1) return;
    let changed = false;
    for (const [id, b] of before) {
      const a = after.get(id);
      if (!a || !posesEqual(b, a)) { changed = true; break; }
    }
    if (!changed) return;

    const cmd = makeTransformCommand(label, clonePoseMap(before), clonePoseMap(after));
    if (mergeKey) {
      this.pushMerged(mergeKey, cmd, (prev, next) => {
        // Keep earliest before from prev; take latest after from next.
        const prevAny = prev as TransformCommand;
        const nextAny = next as TransformCommand;
        if (!prevAny.__poses || !nextAny.__poses) return next;
        const mergedBefore = clonePoseMap(prevAny.__poses.before);
        const mergedAfter = clonePoseMap(nextAny.__poses.after);
        for (const [id, pose] of nextAny.__poses.before) {
          if (!mergedBefore.has(id)) mergedBefore.set(id, pose);
        }
        return makeTransformCommand(label, mergedBefore, mergedAfter);
      });
    } else {
      this.push(cmd);
    }
  }

  // ---- Create / delete ----

  recordCreated(objects: ObjectNode | ObjectNode[], label = 'create') {
    const list = Array.isArray(objects) ? objects : [objects];
    const entries = list.filter(o => !!o).map(o => ({
      xml: o.toXml(),
      parentId: o.parentId || TableSelecter.instance.viewTable?.identifier || '',
      liveId: o.identifier,
    }));
    if (entries.length < 1) return;

    this.push({
      label,
      undo: () => {
        for (const e of entries) {
          const obj = ObjectStore.instance.get(e.liveId);
          if (obj) obj.destroy();
        }
      },
      redo: () => {
        for (const e of entries) {
          const restored = restoreFromXml(e.xml, e.parentId);
          if (restored) e.liveId = restored.identifier;
        }
      },
    });
  }

  recordDeleted(entries: DeleteEntry[], label = 'delete') {
    if (entries.length < 1) return;
    // Mutable copies for id remap across undo/redo cycles.
    const state = entries.map(e => ({ ...e }));

    this.push({
      label,
      undo: () => {
        for (const e of state) {
          if (e.kind === 'graveyard') {
            const obj = ObjectStore.instance.get<GameCharacter>(e.id);
            if (obj) obj.setLocation(e.fromLocation, e.fromTableIdentifier);
          } else {
            const restored = restoreFromXml(e.xml, e.parentId);
            if (restored) e.liveId = restored.identifier;
          }
        }
      },
      redo: () => {
        for (const e of state) {
          if (e.kind === 'graveyard') {
            const obj = ObjectStore.instance.get<GameCharacter>(e.id);
            if (obj) {
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: obj.identifier });
              if (obj.location.name === 'table') obj.leaveCurrentTable('graveyard');
              else obj.setLocation('graveyard');
            }
          } else {
            const obj = ObjectStore.instance.get(e.liveId);
            if (obj) {
              e.xml = obj.toXml();
              e.parentId = (obj as ObjectNode).parentId || e.parentId;
              obj.destroy();
            }
          }
        }
      },
    });
  }

  recordLayerChange(
    before: Map<string, number>,
    after: Map<string, number>,
    beforeChildOrder: Map<string, string[]> = new Map(),
    afterChildOrder: Map<string, string[]> = new Map(),
    label = 'layer',
  ) {
    let changed = false;
    for (const [id, z] of before) {
      if (after.get(id) !== z) { changed = true; break; }
    }
    if (!changed) {
      for (const [id, z] of after) {
        if (before.get(id) !== z) { changed = true; break; }
      }
    }
    if (!changed) {
      for (const [parentId, order] of beforeChildOrder) {
        const other = afterChildOrder.get(parentId);
        if (!other || order.length !== other.length || order.some((id, i) => id !== other[i])) {
          changed = true;
          break;
        }
      }
    }
    if (!changed && before.size < 1 && beforeChildOrder.size < 1) return;
    if (!changed) return;

    const applyZ = (snap: Map<string, number>) => {
      for (const [id, zindex] of snap) {
        const obj = ObjectStore.instance.get(id) as any;
        if (obj && 'zindex' in obj) obj.zindex = zindex;
      }
    };
    const applyOrder = (snap: Map<string, string[]>) => {
      for (const [parentId, childIds] of snap) {
        const parent = ObjectStore.instance.get<ObjectNode>(parentId);
        if (!parent) continue;
        for (const childId of childIds) {
          const child = ObjectStore.instance.get<ObjectNode>(childId);
          if (child) parent.appendChild(child);
        }
      }
    };

    this.push({
      label,
      undo: () => { applyZ(before); applyOrder(beforeChildOrder); },
      redo: () => { applyZ(after); applyOrder(afterChildOrder); },
    });
  }

  private clearMerge() {
    this.mergeKey = null;
    if (this.mergeTimer) {
      clearTimeout(this.mergeTimer);
      this.mergeTimer = null;
    }
  }
}

interface TransformCommand extends UndoCommand {
  __poses?: { before: Map<string, TransformPose>; after: Map<string, TransformPose> };
}

function makeTransformCommand(
  label: string,
  before: Map<string, TransformPose>,
  after: Map<string, TransformPose>,
): TransformCommand {
  const cmd: TransformCommand = {
    label,
    __poses: { before, after },
    undo: () => applyPoseMap(before),
    redo: () => applyPoseMap(after),
  };
  return cmd;
}

export function captureObjectPose(object: TabletopObject, rotate?: number): TransformPose {
  const pose: TransformPose = {
    x: object.location.x,
    y: object.location.y,
    posZ: object.posZ,
  };
  if (rotate != null) {
    pose.rotate = rotate;
  } else if ('rotate' in object) {
    pose.rotate = +(object as any).rotate || 0;
  }
  if ('roll' in object) {
    pose.roll = +(object as any).roll || 0;
  }
  return pose;
}

export function capturePoseMap(objects: Iterable<TabletopObject>): Map<string, TransformPose> {
  const map = new Map<string, TransformPose>();
  for (const object of objects) {
    if (!object) continue;
    map.set(object.identifier, captureObjectPose(object));
  }
  return map;
}

function applyPoseMap(poses: Map<string, TransformPose>) {
  const undo = UndoService.instance;
  for (const [id, pose] of poses) {
    const obj = ObjectStore.instance.get<TabletopObject>(id);
    if (!obj) continue;
    obj.location.x = pose.x;
    obj.location.y = pose.y;
    obj.posZ = pose.posZ;
    if (pose.rotate != null && 'rotate' in obj) {
      (obj as any).rotate = pose.rotate;
    }
    if (pose.roll != null && 'roll' in obj) {
      (obj as any).roll = pose.roll;
    }
    // Movable/Rotable ignore self-UPDATE while selected — sync visuals directly.
    undo?.syncPoseVisual(obj, pose);
    obj.update();
  }
}

function posesEqual(a: TransformPose, b: TransformPose): boolean {
  return a.x === b.x && a.y === b.y && a.posZ === b.posZ
    && (a.rotate == null || b.rotate == null || a.rotate === b.rotate)
    && (a.roll == null || b.roll == null || a.roll === b.roll);
}

function clonePoseMap(src: Map<string, TransformPose>): Map<string, TransformPose> {
  const map = new Map<string, TransformPose>();
  for (const [id, pose] of src) map.set(id, { ...pose });
  return map;
}

function restoreFromXml(xml: string, parentId: string): ObjectNode | null {
  const object = ObjectSerializer.instance.parseXml(xml);
  if (!(object instanceof ObjectNode)) return null;
  const parent = (parentId && ObjectStore.instance.get<ObjectNode>(parentId))
    || TableSelecter.instance.viewTable;
  if (parent) {
    parent.appendChild(object);
    // Scene FX (lights/walls/drawings) refresh off table context updates.
    const table = TableSelecter.instance.viewTable;
    if (table && parent.identifier === table.identifier) {
      EventSystem.trigger('UPDATE_GAME_OBJECT', table.toContext());
    }
  } else {
    object.update();
  }
  return object;
}
