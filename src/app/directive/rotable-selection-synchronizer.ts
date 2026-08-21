import { GameCharacter } from '@udonarium/game-character';
import { TabletopObject } from '@udonarium/tabletop-object';
import { Terrain } from '@udonarium/terrain';
import {
  bakeGroupPartsOf,
  rotateBakeGroupBy,
} from '@udonarium/terrain-model/bake-group';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TransformPose, UndoService } from 'service/undo.service';

import { MovableDirective } from './movable.directive';
import { RotableDirective } from './rotable.directive';

export class RotableSelectionSynchronizer {
  private static readonly rotablesMap: Map<TabletopObject, Set<RotableDirective>> = new Map();

  private get selectedRotables(): Set<RotableDirective> {
    let selected: Set<RotableDirective> = new Set();
    for (let object of this.selection.objects) {
      RotableSelectionSynchronizer.rotablesMap.get(object)?.forEach(r => selected.add(r));
    }
    return selected;
  }

  private _isDestroyed: boolean = false;
  get isDestroyed(): boolean { return this._isDestroyed; }

  private undoTargets: Set<RotableDirective> = new Set();
  private bakeGroupRotateStart = 0;
  private bakeGroupParts: Terrain[] = [];
  private bakeGroupStartPoses = new Map<string, { x: number; y: number; posZ: number; rotate: number }>();

  constructor(
    private rotable: RotableDirective,
    private selection: TabletopSelectionService,
  ) { }

  initialize() {
    this.register();
  }

  destroy() {
    this.unregister();
    this._isDestroyed = true;
    this.rotable = null;
  }

  prepareRotate() {
    this.beginUndoCapture();
    this.absorbBakeGroupIntoSelection();
    this.bakeGroupParts = [];
    this.bakeGroupStartPoses.clear();
    this.bakeGroupRotateStart = this.rotable.rotate;

    const obj = this.rotable.tabletopObject;
    if (obj instanceof Terrain && obj.bakeGroupId && this.rotable.targetPropertyName === 'rotate') {
      this.bakeGroupParts = bakeGroupPartsOf(obj);
      for (const t of this.bakeGroupParts) {
        this.bakeGroupStartPoses.set(t.identifier, {
          x: t.location?.x ?? 0,
          y: t.location?.y ?? 0,
          posZ: t.posZ || 0,
          rotate: t.rotate || 0,
        });
        const set = RotableSelectionSynchronizer.rotablesMap.get(t);
        set?.forEach(r => {
          if (r.targetPropertyName === 'rotate') this.trackUndoTarget(r);
        });
        UndoService.instance?.rememberBeforePose(t.identifier, {
          x: t.location?.x ?? 0,
          y: t.location?.y ?? 0,
          posZ: t.posZ || 0,
          rotate: t.rotate || 0,
        });
      }
    }

    if (1 < this.selection.size && this.rotable.state !== SelectionState.NONE) {
      for (let rotable of this.selectedRotables) {
        if (rotable === this.rotable) continue;
        if (!rotable.isDisable) {
          rotable.setAnimatedTransition(false);
          this.trackUndoTarget(rotable);
        }
      }
    } else if (!this.bakeGroupParts.length) {
      this.selection.clear();
    }
  }

  updateRotate() {
    if (this.bakeGroupParts.length > 1 && this.rotable.targetPropertyName === 'rotate') {
      const delta = this.rotable.rotate - this.bakeGroupRotateStart;
      if (Math.abs(delta) < 1e-6) return;
      // Reset to start pose then apply absolute delta (avoids compounding).
      this.restoreBakeGroupStartPose();
      rotateBakeGroupBy(this.bakeGroupParts, delta);
      this.syncBakeGroupVisuals();
      return;
    }
    if (this.selection.size <= 1 || this.rotable.state === SelectionState.NONE) return;
    for (let rotable of this.selectedRotables) {
      if (rotable === this.rotable) continue;
      if (!rotable.isDisable
        && rotable.tabletopObject.aliasName === this.rotable.tabletopObject.aliasName
        && rotable.targetPropertyName === this.rotable.targetPropertyName) {
        rotable.rotate = this.rotable.rotate;
      }
    }
  }

  finishRotate() {
    if (this.bakeGroupParts.length > 1 && this.rotable.targetPropertyName === 'rotate') {
      const delta = this.rotable.rotate - this.bakeGroupRotateStart;
      this.restoreBakeGroupStartPose();
      rotateBakeGroupBy(this.bakeGroupParts, delta);
      this.syncBakeGroupVisuals();
      for (const t of this.bakeGroupParts) {
        const set = RotableSelectionSynchronizer.rotablesMap.get(t);
        set?.forEach(r => {
          if (r.targetPropertyName === 'rotate') r.setAnimatedTransition(true);
        });
      }
      this.commitUndoCapture();
      this.bakeGroupParts = [];
      this.bakeGroupStartPoses.clear();
      return;
    }
    if (1 < this.selection.size && this.rotable.state !== SelectionState.NONE) {
      for (let rotable of this.selectedRotables) {
        if (rotable === this.rotable) continue;
        if (!rotable.isDisable
          && rotable.tabletopObject.aliasName === this.rotable.tabletopObject.aliasName
          && rotable.targetPropertyName === this.rotable.targetPropertyName) {
          rotable.setAnimatedTransition(true);
          rotable.rotate = this.rotable.rotate;
        }
      }
    }
    this.bakeGroupParts = [];
    this.bakeGroupStartPoses.clear();
    this.commitUndoCapture();
  }

  private absorbBakeGroupIntoSelection() {
    const obj = this.rotable.tabletopObject;
    if (!(obj instanceof Terrain) || !obj.bakeGroupId) return;
    if (this.rotable.state === SelectionState.NONE) return;
    for (const sibling of bakeGroupPartsOf(obj)) {
      if (sibling === obj) continue;
      if (this.selection.state(sibling) === SelectionState.NONE) {
        this.selection.add(sibling, SelectionState.SELECTED);
      }
    }
  }

  private restoreBakeGroupStartPose() {
    for (const t of this.bakeGroupParts) {
      const pose = this.bakeGroupStartPoses.get(t.identifier);
      if (!pose) continue;
      t.location = { name: 'table', x: pose.x, y: pose.y };
      t.posZ = pose.posZ;
      t.rotate = pose.rotate;
    }
  }

  private syncBakeGroupVisuals() {
    for (const t of this.bakeGroupParts) {
      MovableDirective.syncPoseFromUndo(t, t.location.x, t.location.y, t.posZ || 0);
      RotableSelectionSynchronizer.syncRotateFromUndo(t, { rotate: t.rotate || 0 });
    }
  }

  /** Abort without committing (e.g. cancelled mid-drag). */
  abortUndoCapture() {
    this.undoTargets.clear();
    UndoService.instance?.discardTransformGesture();
  }

  private beginUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) return;
    undo.beginTransformGesture();
    this.undoTargets.clear();
    this.trackUndoTarget(this.rotable);
  }

  private trackUndoTarget(rotable: RotableDirective) {
    if (!rotable?.tabletopObject) return;
    const prop = rotable.targetPropertyName;
    // Facing (`rotate`) and character tilt (`roll` — top grab) both need undo.
    if (prop !== 'rotate' && prop !== 'roll') return;
    this.undoTargets.add(rotable);
    UndoService.instance?.rememberBeforePose(
      rotable.tabletopObject.identifier,
      poseFromRotable(rotable),
    );
  }

  private commitUndoCapture() {
    const undo = UndoService.instance;
    if (!undo) {
      this.undoTargets.clear();
      return;
    }
    const after = new Map<string, TransformPose>();
    for (const rotable of this.undoTargets) {
      if (!rotable?.tabletopObject) continue;
      after.set(rotable.tabletopObject.identifier, poseFromRotable(rotable));
    }
    for (const t of this.bakeGroupParts) {
      after.set(t.identifier, {
        x: t.location?.x ?? 0,
        y: t.location?.y ?? 0,
        posZ: t.posZ || 0,
        rotate: t.rotate || 0,
      });
    }
    const label = this.rotable?.targetPropertyName === 'roll' ? 'roll' : 'rotate';
    this.undoTargets.clear();
    undo.commitTransformGesture(after, label);
  }

  register() {
    let rotableSet = RotableSelectionSynchronizer.rotablesMap.get(this.rotable.tabletopObject) ?? new Set();
    rotableSet.add(this.rotable);
    RotableSelectionSynchronizer.rotablesMap.set(this.rotable.tabletopObject, rotableSet);
  }

  unregister() {
    let objectSet = RotableSelectionSynchronizer.rotablesMap.get(this.rotable.tabletopObject);
    if (!objectSet) return;
    objectSet.delete(this.rotable);
    if (objectSet.size < 1) RotableSelectionSynchronizer.rotablesMap.delete(this.rotable.tabletopObject);
  }

  static syncRotateFromUndo(object: TabletopObject, pose: { rotate?: number; roll?: number } | number) {
    if (!object) return;
    const rotables = RotableSelectionSynchronizer.rotablesMap.get(object);
    if (!rotables) return;
    const rotate = typeof pose === 'number' ? pose : pose.rotate;
    const roll = typeof pose === 'number' ? undefined : pose.roll;
    for (const rotable of rotables) {
      if (rotable.targetPropertyName === 'rotate' && rotate != null) {
        rotable.applyExternalRotate(rotate);
      }
      if (rotable.targetPropertyName === 'roll' && roll != null) {
        rotable.applyExternalRotate(roll);
      }
    }
  }

  static rotateBy(targets: TabletopObject[], delta: number): boolean {
    if (delta === 0) return false;
    // Keep unbounded angles (no % 360). Wrapping while CSS transition is on
    // interpolates the long way and looks like a sudden ~180°+ spin.
    return RotableSelectionSynchronizer.applyAngle(targets, 'rotate', current => current + delta);
  }

  /** Tilt / roll (top grab on characters). No-ops for objects without `roll`. */
  static rollBy(targets: TabletopObject[], delta: number): boolean {
    if (delta === 0) return false;
    return RotableSelectionSynchronizer.applyAngle(targets, 'roll', current => current + delta);
  }

  static face(targets: TabletopObject[], angle: number): boolean {
    return RotableSelectionSynchronizer.applyAngle(targets, 'rotate', () => angle);
  }

  /** Reset facing (`rotate`) and character tilt (`roll`) to 0° in one undo step. */
  static resetAngles(targets: TabletopObject[]): boolean {
    const before = new Map<string, TransformPose>();
    for (const object of targets) {
      if (!('rotate' in object) && !('roll' in object)) continue;
      if ((object as any).isLocked || (object as any).isLock) continue;
      if (object instanceof GameCharacter && object.isLockedByPlayerOwner) continue;
      const pose = poseFromObjectAngles(object);
      const rotate = pose.rotate ?? 0;
      const roll = pose.roll ?? 0;
      if (rotate === 0 && roll === 0) continue;
      before.set(object.identifier, pose);
    }
    if (before.size < 1) return false;

    let reset = false;
    for (const object of targets) {
      if (!before.has(object.identifier)) continue;
      const rotables = RotableSelectionSynchronizer.rotablesMap.get(object);

      const applyProp = (property: 'rotate' | 'roll') => {
        if (!(property in object)) return;
        if (rotables == null || rotables.size < 1) {
          (object as any)[property] = 0;
          reset = true;
          return;
        }
        let hit = false;
        for (const rotable of rotables) {
          if (rotable.isDisable) continue;
          if (rotable.targetPropertyName !== property) continue;
          rotable.setAnimatedTransition(false);
          rotable.stopTransition(0);
          rotable.rotate = 0;
          hit = true;
          reset = true;
        }
        if (!hit) {
          (object as any)[property] = 0;
          reset = true;
        }
      };

      applyProp('rotate');
      applyProp('roll');
    }

    if (reset) {
      const after = new Map<string, TransformPose>();
      for (const id of before.keys()) {
        const object = targets.find(t => t.identifier === id);
        if (object) after.set(id, poseFromObjectAngles(object));
      }
      UndoService.instance?.recordTransform('reset', before, after, 'reset');
    }
    return reset;
  }

  private static applyAngle(
    targets: TabletopObject[],
    property: 'rotate' | 'roll',
    nextAngle: (current: number) => number,
  ): boolean {
    const before = new Map<string, TransformPose>();
    for (const object of targets) {
      if (!(property in object)) continue;
      if ((object as any).isLocked || (object as any).isLock) continue;
      if (object instanceof GameCharacter && object.isLockedByPlayerOwner) continue;
      before.set(object.identifier, poseFromObjectAngles(object));
    }

    let rotated = false;
    for (let object of targets) {
      if (!(property in object)) continue;
      if ((object as any).isLocked || (object as any).isLock) continue;
      if (object instanceof GameCharacter && object.isLockedByPlayerOwner) continue;

      let rotables = RotableSelectionSynchronizer.rotablesMap.get(object);
      if (rotables == null || rotables.size < 1) {
        (object as any)[property] = nextAngle(+(object as any)[property] || 0);
        rotated = true;
        continue;
      }
      let hit = false;
      for (let rotable of rotables) {
        if (rotable.isDisable) continue;
        if (rotable.targetPropertyName !== property) continue;
        // Instant update — animated rotateZ(350→5) spins almost a full turn.
        rotable.setAnimatedTransition(false);
        rotable.stopTransition(rotable.rotate);
        rotable.rotate = nextAngle(rotable.rotate);
        hit = true;
        rotated = true;
      }
      // Object has rotables but none for this property (e.g. roll on non-character): set data directly.
      if (!hit && property in object) {
        (object as any)[property] = nextAngle(+(object as any)[property] || 0);
        rotated = true;
      }
    }

    if (rotated) {
      const after = new Map<string, TransformPose>();
      for (const id of before.keys()) {
        const object = targets.find(t => t.identifier === id);
        if (object) after.set(id, poseFromObjectAngles(object));
      }
      UndoService.instance?.recordTransform(property, before, after, property);
    }
    return rotated;
  }
}

function poseFromRotable(rotable: RotableDirective): TransformPose {
  const object = rotable.tabletopObject;
  const pose: TransformPose = {
    x: object?.location.x ?? 0,
    y: object?.location.y ?? 0,
    posZ: object?.posZ ?? 0,
  };
  if (object && 'rotate' in object) {
    pose.rotate = rotable.targetPropertyName === 'rotate'
      ? rotable.rotate
      : (+(object as any).rotate || 0);
  }
  if (object && 'roll' in object) {
    pose.roll = rotable.targetPropertyName === 'roll'
      ? rotable.rotate
      : (+(object as any).roll || 0);
  }
  return pose;
}

function poseFromObjectAngles(object: TabletopObject): TransformPose {
  const pose: TransformPose = {
    x: object.location.x,
    y: object.location.y,
    posZ: object.posZ,
  };
  if ('rotate' in object) pose.rotate = +(object as any).rotate || 0;
  if ('roll' in object) pose.roll = +(object as any).roll || 0;
  return pose;
}
