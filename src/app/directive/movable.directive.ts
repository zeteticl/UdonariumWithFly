import {
  AfterViewInit,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output
} from '@angular/core';
import { EventSystem, Network } from '@udonarium/core/system';
import { GridType } from '@udonarium/game-table';
import { isHexGrid, snapToHexCell } from '@udonarium/hex-grid';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import {
  LAYER_PEER_ALIASES,
  LAYER_PEER_MOVABLE_Z_PX,
  stackTranslateZPx,
} from '@udonarium/tabletop-object-util';
import { BatchService } from 'service/batch.service';
import { CoordinateService } from 'service/coordinate.service';
import { TabletopService } from 'service/tabletop.service';
import { PointerCoordinate, PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { UndoService } from 'service/undo.service';

import { InputHandler } from './input-handler';
import { MovableSelectionSynchronizer } from './movable-selection-synchronizer';
import { poseDebug } from '@udonarium/table-fx/pose-debug';
import { folderBackupDebug } from 'service/folder-backup-debug';

type LayerName = string;

export interface MovableOption {
  readonly tabletopObject?: TabletopObject;
  readonly layerName?: string;
  readonly colideLayers?: string[];
  readonly transformCssOffset?: string;
}

@Directive({
    selector: '[appMovable]',
    standalone: false
})
export class MovableDirective implements AfterViewInit, OnChanges, OnDestroy {
  static readonly layerMap: Map<LayerName, Set<MovableDirective>> = new Map();
  private static poseFlushHooked = false;

  private _tabletopObject: TabletopObject;
  private _layerName: string = '';
  private _colideLayers: string[] = [];
  private _transformCssOffset: string = '';

  get tabletopObject(): TabletopObject { return this._tabletopObject; }
  get layerName(): string { return this._layerName; }
  get colideLayers(): string[] { return this._colideLayers; }
  get transformCssOffset(): string { return this._transformCssOffset; }

  @Input('movable.option') set option(option: MovableOption) {
    this.unregister();
    this.synchronizer.unregister();

    this._tabletopObject = option.tabletopObject ?? null;
    this._layerName = option.layerName ?? '';
    this._colideLayers = option.colideLayers ?? [];
    this._transformCssOffset = option.transformCssOffset ?? '';

    if (this._layerName.length < 1 && this._tabletopObject) this._layerName = this._tabletopObject.aliasName;

    this.register();
    this.synchronizer.register();
  }
  @Input('movable.disable') isDisable: boolean = false;
  @Input('movable.interact') isInteract: boolean = true;
  @Output('movable.onstart') onstart: EventEmitter<PointerEvent> = new EventEmitter();
  @Output('movable.ondragstart') ondragstart: EventEmitter<PointerEvent> = new EventEmitter();
  @Output('movable.ondrag') ondrag: EventEmitter<PointerEvent> = new EventEmitter();
  @Output('movable.ondragend') ondragend: EventEmitter<PointerEvent> = new EventEmitter();
  @Output('movable.onend') onend: EventEmitter<PointerEvent> = new EventEmitter();

  get nativeElement(): HTMLElement { return this.elementRef.nativeElement; }

  private _posX: number = 0;
  private _posY: number = 0;
  private _posZ: number = 0;

  get posX(): number { return this._posX; }
  set posX(posX: number) { this._posX = posX; this.setUpdateBatching(); }
  get posY(): number { return this._posY; }
  set posY(posY: number) { this._posY = posY; this.setUpdateBatching(); }
  get posZ(): number { return this._posZ; }
  set posZ(posZ: number) { this._posZ = posZ; this.setUpdateBatching(); }

  private pointerOffset2d: PointerCoordinate = { x: 0, y: 0, z: 0 };
  private pointerStart3d: PointerCoordinate = { x: 0, y: 0, z: 0 };

  get magnitude(): number { return this.input.magnitude; }
  get isPointerMoved(): boolean { return this.input.isPointerMoved; }

  private targetStartRect: DOMRect;

  height: number = -1;
  width: number = -1;
  private ratio: number = 1.0;

  private isUpdateBatching: boolean = false;
  private collidableElements: HTMLElement[] = [];
  private input: InputHandler = new InputHandler(this.nativeElement, false);

  private synchronizer: MovableSelectionSynchronizer = new MovableSelectionSynchronizer(this, this.selectionService, this.pointerDeviceService);
  get state(): SelectionState { return this.selectionService.state(this.tabletopObject); }
  set state(state: SelectionState) { this.selectionService.add(this.tabletopObject, state); }

  private get isGridSnap(): boolean { return TableSelecter.instance.gridSnap; }

  constructor(
    private ngZone: NgZone,
    private elementRef: ElementRef,
    private batchService: BatchService,
    private pointerDeviceService: PointerDeviceService,
    private coordinateService: CoordinateService,
    private tabletopService: TabletopService,
    private selectionService: TabletopSelectionService,
    _undoService: UndoService,
  ) { }

  ngAfterViewInit() {
    MovableDirective.ensurePoseFlushHook();
    this.batchService.add(() => {
      this.initialize();
      if (this.tabletopObject) {
        const before = { x: this._posX, y: this._posY, z: this._posZ };
        this.setPosition(this.tabletopObject);
        const data = this.tabletopObject.getPoseForView();
        if (before.x !== data.x || before.y !== data.y || before.z !== data.posZ) {
          poseDebug('movable ngAfterViewInit corrected', {
            id: this.tabletopObject.identifier,
            before: `${before.x | 0},${before.y | 0},${before.z | 0}`,
            after: `${data.x | 0},${data.y | 0},${data.posZ | 0}`,
          });
        }
      }
    }, this.onstart);
  }

  ngOnChanges(): void {
    this.dispose();

    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.tabletopObject?.identifier}`, event => {
        if ((event.isSendFromSelf && (this.input.isGrabbing || this.state !== SelectionState.NONE)) || !this.shouldTransition(this.tabletopObject)) return;
        this.batchService.add(() => {
          if (this.input.isGrabbing) {
            UndoService.instance?.discardTransformGesture();
            this.cancel();
          } else {
            this.setAnimatedTransition(true);
          }
          this.state = SelectionState.NONE;
          this.stopTransition();
          this.setPosition(this.tabletopObject);
        }, this);
      });

    if (this.isDisable && this.state !== SelectionState.NONE) this.state = SelectionState.NONE;
    this.setPosition(this.tabletopObject);
  }

  ngOnDestroy() {
    if (this.input.isGrabbing) this.cancel();
    this.unregister();
    this.dispose();
    this.synchronizer.destroy();
    this.input.destroy();
    this.batchService.remove(this);
    this.batchService.remove(this.onstart);
  }

  initialize() {
    this.synchronizer.initialize();
    this.input.initialize();
    this.input.onStart = this.onInputStart.bind(this);
    this.input.onMove = this.onInputMove.bind(this);
    this.input.onEnd = this.onInputEnd.bind(this);
    this.input.onContextMenu = this.onContextMenu.bind(this);

    this.findCollidableElements();
    // Repair PE after a prior drag may have stripped inline auto (masks/cards).
    this.setPointerEvents(true);
  }

  cancel() {
    this.input.cancel();
    this.setPointerEvents(true);
    this.setAnimatedTransition(true);
    this.setCollidableLayer(false);
    if (this.tabletopService.tableSelecter.viewTable) this.tabletopService.tableSelecter.viewTable.gridHeight = 0;
  }

  dispose() {
    EventSystem.unregister(this);
    this.batchService.remove(this);
  }

  onInputStart(e: MouseEvent | TouchEvent) {
    this.callSelectedEvent();
    if (this.collidableElements.length < 1) this.findCollidableElements(); // 偶爾會取得 collidableElements 失敗

    const isPrimaryClick = !(e instanceof MouseEvent) || (e.button === 0 && !e.ctrlKey && !e.shiftKey);

    // Click-to-select before disable/guest drag cancel, so a single click still selects.
    if (isPrimaryClick && !Network.GuestMode() && this.tabletopObject && this.state === SelectionState.NONE) {
      this.selectionService.clear();
      this.state = SelectionState.SELECTED;
    }

    if (Network.GuestMode() || this.isDisable || (e instanceof MouseEvent && (e.button !== 0 || e.ctrlKey || e.shiftKey))) {
      this.cancel();
      return;
    }

    this.onstart.emit(e as PointerEvent);

    this.setPointerEvents(false);
    this.setAnimatedTransition(false);
    this.setCollidableLayer(this.isInteract);

    this.width = this.nativeElement.clientWidth;
    this.height = this.nativeElement.clientHeight;

    let target3d = {
      x: this.posX + (this.width / 2),
      y: this.posY + (this.height / 2),
      z: this.posZ,
    };
    let target2d = this.coordinateService.convertToGlobal(target3d, this.coordinateService.tabletopOriginElement);

    this.setPointerEvents(true);

    this.pointerOffset2d.x = target2d.x - this.input.pointer.x;
    this.pointerOffset2d.y = target2d.y - this.input.pointer.y;
    this.pointerOffset2d.z = target2d.z - this.input.pointer.z;

    this.pointerStart3d.x = target3d.x;
    this.pointerStart3d.y = target3d.y;
    this.pointerStart3d.z = target3d.z;

    this.targetStartRect = this.nativeElement.getBoundingClientRect();

    //this.width = this.input.target.clientWidth;
    //this.height = this.input.target.clientHeight;
    this.ratio = 1.0;
    
    const viewTable = TableSelecter.instance.viewTable;
    viewTable.gridClipRect = null;
    viewTable.gridHeight = this.posZ + 0.5;
    //this.setUpdateTimer();

    this.synchronizer.prepareMove();
  }

  onInputMove(e: MouseEvent | TouchEvent) {
    if (this.input.isGrabbing && !this.pointerDeviceService.isDragging) {
      return this.cancel(); // todo
    }
    if (this.isDisable || !this.input.isGrabbing) return this.cancel();
    if (e.cancelable) e.preventDefault();

    if (!this.input.isDragging) this.setPointerEvents(false);

    let pointer2d = {
      x: this.input.pointer.x + (this.pointerOffset2d.x * this.ratio),
      y: this.input.pointer.y + (this.pointerOffset2d.y * this.ratio),
      z: 0,
    };

    pointer2d.x = Math.min(window.innerWidth - 0.1, Math.max(pointer2d.x, 0.1));
    pointer2d.y = Math.min(window.innerHeight - 0.1, Math.max(pointer2d.y, 0.1));

    // elementsFromPoint still lists PE-none peers (mask / character), unlike elementFromPoint.
    const hitStack = document.elementsFromPoint(pointer2d.x, pointer2d.y) as Element[];
    let element = (hitStack[0] as HTMLElement) || null;
    if (element == null) return;

    let pointer3d = this.coordinateService.calcTabletopLocalCoordinate(pointer2d, element);
    pointer3d.x -= this.width / 2;
    pointer3d.y -= this.height / 2;

    const nextZ = this.resolveDragPosZ(element, pointer3d.z, hitStack);
    if (this.posX === pointer3d.x && this.posY === pointer3d.y && this.posZ === nextZ) return;

    if (!this.input.isDragging) this.ondragstart.emit(e as PointerEvent);
    this.ondrag.emit(e as PointerEvent);

    let targetRect = this.nativeElement.getBoundingClientRect();
    let ratio = targetRect.width / this.targetStartRect.width;
    if (ratio < this.ratio) {
      this.ratio += (ratio - this.ratio) * 0.1;
    }

    //let tableSelecter = ObjectStore.instance.get<TableSelecter>('tableSelecter');
    const viewTable = TableSelecter.instance.viewTable;
    viewTable.gridClipRect = null;
    viewTable.gridHeight = this.posZ + 0.5;
    const nextX = pointer3d.x;
    const nextY = pointer3d.y;
    let delta = {
      x: nextX - this.posX,
      y: nextY - this.posY,
      z: nextZ - this.posZ,
    };

    this.posX = nextX;
    this.posY = nextY;
    this.posZ = nextZ;

    this.synchronizer.updateMove(delta);
  }

  onInputEnd(e: MouseEvent | TouchEvent) {
    if (this.isDisable) return this.cancel();
    if (this.input.isDragging) this.ondragend.emit(e as PointerEvent);

    let prev = {
      x: this.posX,
      y: this.posY,
      z: this.posZ,
    };

    if (this.shouldSnapToGrid(e)) this.snapToGrid();

    // After XY snap, re-sample analytic slope Z so feet stay on the ramp.
    MovableSelectionSynchronizer.syncTerrainFloor(this);

    let delta = {
      x: this.posX - prev.x,
      y: this.posY - prev.y,
      z: this.posZ - prev.z,
    };

    this.synchronizer.finishMove(delta);

    this.cancel();
    this.onend.emit(e as PointerEvent);
  }

  onContextMenu(e: MouseEvent | TouchEvent) {
    if (this.isDisable) return this.cancel();
    if (e.cancelable) e.preventDefault();

    if (this.shouldSnapToGrid(e)) this.snapToGrid();

    let needsDispatch = this.input.isGrabbing && e.isTrusted;
    this.cancel();

    if (needsDispatch) {
      // 以長按觸控開啟右鍵選單時，將事件傳播到適當的 DOM
      e.stopPropagation();
      let ev = new MouseEvent(e.type, e);
      this.ngZone.run(() => this.nativeElement.dispatchEvent(ev));
    }
  }

  private callSelectedEvent() {
    if (this.tabletopObject)
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: this.tabletopObject.identifier, className: this.tabletopObject.aliasName });
  }

  snapToGrid(gridSize?: number) {
    const table = TableSelecter.instance.viewTable;
    const type = table?.gridType ?? GridType.SQUARE;
    if (isHexGrid(type)) {
      const snapped = snapToHexCell(this.posX, this.posY, table?.gridSize || 50, type);
      this.posX = snapped.x;
      this.posY = snapped.y;
      return;
    }
    const interval = gridSize ?? (table?.gridSize ? table.gridSize / 2 : 25);
    this.posX = this.calcSnapNum(this.posX, interval);
    this.posY = this.calcSnapNum(this.posY, interval);
  }

  /** Shift held on drop bypasses grid snap (Foundry-style). */
  private shouldSnapToGrid(e: MouseEvent | TouchEvent): boolean {
    if (!this.isGridSnap || !this.input.isDragging) return false;
    if (e instanceof MouseEvent && e.shiftKey) return false;
    return true;
  }

  private calcSnapNum(num: number, interval: number): number {
    if (interval <= 0) return num;
    num = num < 0 ? num - interval / 2 : num + interval / 2;
    return num - (num % interval);
  }

  private setPosition(object: TabletopObject) {
    const pose = object.getPoseForView();
    this._posX = pose.x;
    this._posY = pose.y;
    this._posZ = pose.posZ;
    this.updateTransformCss();
  }

  /**
   * Sync visual pose from undo/redo without going through UPDATE_GAME_OBJECT.
   * Self-updates are ignored while selected, so undo must write directives directly.
   */
  applyExternalPose(x: number, y: number, posZ: number) {
    this._posX = x;
    this._posY = y;
    this._posZ = posZ;
    this.updateTransformCss();
  }

  static syncPoseFromUndo(object: TabletopObject, x: number, y: number, posZ: number) {
    if (!object) return;
    const apply = (movable: MovableDirective) => {
      if (movable.tabletopObject === object) {
        movable.applyExternalPose(x, y, posZ);
      }
    };
    const layer = MovableDirective.layerMap.get(object.aliasName);
    if (layer) {
      for (const movable of layer) apply(movable);
      return;
    }
    for (const set of MovableDirective.layerMap.values()) {
      for (const movable of set) apply(movable);
    }
  }

  private setUpdateBatching() {
    if (!this.isUpdateBatching && this.tabletopObject) {
      this.isUpdateBatching = true;
      // Pin the map id at queue time — resolveViewTableIdentifier() at flush can be a different map.
      const batchViewId = TabletopObject.resolveViewTableIdentifier();
      this.batchService.add(() => {
        if (this.tabletopObject.location.name === 'table' && batchViewId
          && this.tabletopObject.hasPlacement(batchViewId)) {
          this.tabletopObject.setPoseForTable(batchViewId, {
            x: this._posX,
            y: this._posY,
            posZ: this._posZ,
          }, true);
        } else {
          // Never invent a placement on another map — only refresh live location.
          this.tabletopObject.location.x = this._posX;
          this.tabletopObject.location.y = this._posY;
          this.tabletopObject.posZ = this._posZ;
        }
        this.isUpdateBatching = false;
      }, this);
    }
    this.updateTransformCss();
  }

  /** Write directive pose into tablePlacements for the given (or current) view. */
  flushPoseToTable(tableId?: string) {
    if (!this.tabletopObject || this.tabletopObject.location.name !== 'table') return;
    const viewId = tableId || TabletopObject.resolveViewTableIdentifier();
    if (!viewId) return;
    // Never invent a placement on another map — only refresh poses already on this map.
    if (!this.tabletopObject.hasPlacement(viewId)) return;
    this.batchService.remove(this);
    this.isUpdateBatching = false;
    this.tabletopObject.setPoseForTable(viewId, {
      x: this._posX,
      y: this._posY,
      posZ: this._posZ,
    }, true);
  }

  /** Force screen pose from the object's current-view placement (map switch). */
  syncPoseFromObject() {
    if (!this.tabletopObject) return;
    if (this.input.isGrabbing) {
      UndoService.instance?.discardTransformGesture();
      this.cancel();
    }
    this.state = SelectionState.NONE;
    this.setAnimatedTransition(false);
    this.stopTransition();
    this.batchService.remove(this);
    this.isUpdateBatching = false;
    this.setPosition(this.tabletopObject);
  }

  /** Flush every movable’s live pose before a map switch. */
  static flushAllPosesToTable(tableId?: string) {
    let n = 0;
    for (const set of MovableDirective.layerMap.values()) {
      for (const movable of set) {
        movable.flushPoseToTable(tableId);
        n++;
      }
    }
    poseDebug('flushAllPosesToTable', { tableId: tableId || '(view)', movableCount: n });
  }

  /** After hydrate: snap every movable to placements[view] (ignores selection). */
  static syncAllPosesFromObjects() {
    const viewId = TabletopObject.resolveViewTableIdentifier();
    let n = 0;
    let driftBefore = 0;
    let driftAfter = 0;
    const samples: Array<{
      id: string;
      screenBefore: string;
      data: string;
      screenAfter: string;
      visible: boolean;
      placements: string;
    }> = [];
    for (const set of MovableDirective.layerMap.values()) {
      for (const movable of set) {
        const obj = movable.tabletopObject;
        const screenBefore = { x: movable.posX, y: movable.posY, z: movable.posZ };
        const data = obj ? obj.getPoseForView() : null;
        if (obj && data
          && (screenBefore.x !== data.x || screenBefore.y !== data.y || screenBefore.z !== data.posZ)) {
          driftBefore++;
        }
        movable.syncPoseFromObject();
        n++;
        if (obj && data) {
          const screenAfter = { x: movable.posX, y: movable.posY, z: movable.posZ };
          if (screenAfter.x !== data.x || screenAfter.y !== data.y || screenAfter.z !== data.posZ) {
            driftAfter++;
          }
          if (samples.length < 8) {
            samples.push({
              id: obj.identifier,
              screenBefore: `${screenBefore.x | 0},${screenBefore.y | 0},${screenBefore.z | 0}`,
              data: `${data.x | 0},${data.y | 0},${data.posZ | 0}`,
              screenAfter: `${screenAfter.x | 0},${screenAfter.y | 0},${screenAfter.z | 0}`,
              visible: obj.isVisibleOnTable,
              placements: (obj.tablePlacements || '').slice(0, 120),
            });
          }
        }
      }
    }
    poseDebug('syncAllPosesFromObjects', {
      viewId: viewId || '(none)',
      movableCount: n,
      driftBefore,
      driftAfter,
      samples,
      layerKeys: Array.from(MovableDirective.layerMap.keys()),
    });
    // Also emit under FolderBackup filter during room-load diagnosis.
    if (driftBefore > 0 || driftAfter > 0 || n === 0) {
      folderBackupDebug('movable syncAllPoses', {
        viewId: viewId || '(none)',
        movableCount: n,
        driftBefore,
        driftAfter,
        samples: samples.map(s => `${s.id.slice(0, 8)}|${s.screenBefore}→${s.screenAfter}|data=${s.data}|vis=${s.visible}`),
      });
    }
  }

  /** Register map-switch / archive-load pose hooks (safe to call early). */
  static ensurePoseFlushHook() {
    if (MovableDirective.poseFlushHooked) {
      poseDebug('ensurePoseFlushHook already registered');
      return;
    }
    MovableDirective.poseFlushHooked = true;
    poseDebug('ensurePoseFlushHook REGISTERED');
    EventSystem.register(MovableDirective)
      .on('BEFORE_VIEW_TABLE_CHANGE', event => {
        const tableId: string = event.data?.tableId || '';
        poseDebug('event BEFORE_VIEW_TABLE_CHANGE', { tableId });
        MovableDirective.flushAllPosesToTable(tableId || undefined);
      })
      .on('AFTER_VIEW_TABLE_CHANGE', event => {
        poseDebug('event AFTER_VIEW_TABLE_CHANGE', { tableId: event.data?.tableId || '' });
        MovableDirective.syncAllPosesFromObjects();
      })
      .on('ARCHIVE_LOAD_COMPLETE', () => {
        const viewId = TabletopObject.resolveViewTableIdentifier();
        let movableCount = 0;
        for (const set of MovableDirective.layerMap.values()) movableCount += set.size;
        poseDebug('event ARCHIVE_LOAD_COMPLETE (Movable)', {
          viewId: viewId || '(none)',
          movableCount,
        });
        folderBackupDebug('movable ARCHIVE_LOAD_COMPLETE', {
          viewId: viewId || '(none)',
          movableCount,
        });
        if (viewId) TabletopObject.hydrateAllForView(viewId, true);
        MovableDirective.syncAllPosesFromObjects();
        setTimeout(() => {
          const id = TabletopObject.resolveViewTableIdentifier();
          let n = 0;
          for (const set of MovableDirective.layerMap.values()) n += set.size;
          poseDebug('ARCHIVE_LOAD_COMPLETE +0ms retry', { viewId: id || '(none)', movableCount: n });
          folderBackupDebug('movable ARCHIVE +0ms', { viewId: id || '(none)', movableCount: n });
          if (id) TabletopObject.hydrateAllForView(id, true);
          MovableDirective.syncAllPosesFromObjects();
        }, 0);
        setTimeout(() => {
          let n = 0;
          for (const set of MovableDirective.layerMap.values()) n += set.size;
          poseDebug('ARCHIVE_LOAD_COMPLETE +100ms retry', { movableCount: n });
          folderBackupDebug('movable ARCHIVE +100ms', { movableCount: n });
          MovableDirective.syncAllPosesFromObjects();
        }, 100);
      })
      .on('TABLETOP_LAYER_CHANGED', () => {
        // zindex SyncVar updates alone skip movable setPosition (shouldTransition).
        // Refresh micro translateZ lift without CSS transition (avoids a slide/flash).
        for (const set of MovableDirective.layerMap.values()) {
          for (const movable of set) movable.refreshLayerLiftCss();
        }
      });
  }

  /** Apply [ ] peer translateZ from current zindex without animating. */
  refreshLayerLiftCss() {
    if (!LAYER_PEER_ALIASES.has(this.layerName)) return;
    const prevTransition = this.nativeElement.style.transition;
    this.nativeElement.style.transition = '';
    this.updateTransformCss();
    this.nativeElement.style.transition = prevTransition;
  }

  private findCollidableElements() {
    this.collidableElements = [];
    if (getComputedStyle(this.nativeElement).pointerEvents !== 'none') {
      this.collidableElements = [this.nativeElement];
      return;
    }
    this.findNestedCollidableElements(this.nativeElement);
  }

  private findNestedCollidableElements(element: HTMLElement) {
    // TODO:不完全
    let children = element.children;
    for (let i = 0; i < children.length; i++) {
      let child = children[i]
      if (!(child instanceof HTMLElement)) continue;
      if (getComputedStyle(child).pointerEvents !== 'none') {
        this.collidableElements.push(child);
      }
    }
    if (this.collidableElements.length < 1) {
      for (let i = 0; i < children.length; i++) {
        let child = children[i]
        if (!(child instanceof HTMLElement)) continue;
        this.findNestedCollidableElements(child);
      }
    }
  }

  setPointerEvents(isEnable: boolean) {
    // Children with `pointer-events: auto` still receive hits when only the parent is none.
    // Force the whole subtree off while dragging so 3D faces cannot leak Z into posZ.
    this.nativeElement.classList.toggle('is-movable-pe-none', !isEnable);
    // Always set 'auto' when enabling — removeProperty() strips inline PE from masks/cards
    // (e.g. style="pointer-events: auto") and they stay unhittable under PE-none ancestors.
    const css = isEnable ? 'auto' : 'none';
    this.collidableElements.forEach(element => {
      element.style.pointerEvents = css;
    });
  }

  /**
   * Adopt picked Z only on true ride surfaces (terrain / notes / …).
   * Never climb when a non-ride peer (mask / character / other cards) occupies the
   * same screen point — even if PE-none let the pick punch through to terrain/table.
   * Climbing there floats the piece between a flat mask and a tall character while
   * zindex correctly stays below both.
   */
  private resolveDragPosZ(hit: HTMLElement, pickedZ: number, hitStack?: Element[]): number {
    const z = 0 < pickedZ ? pickedZ : 0;
    // Keep desk altitude under peers (honor existing zindex paint order).
    if (this.hitStackHasNonRidePeer(hitStack) || this.isHitOnNonRidePeer(hit)) {
      return z <= this.posZ + 0.01 ? z : this.posZ;
    }
    if (this.isHitOnColideLayer(hit)) return z;
    if (z <= this.posZ + 0.01) return z;
    return this.posZ;
  }

  /**
   * True only when the pick landed on a collidable movable (root or descendant).
   * Do NOT use hit.contains(root): #app-game-table contains every note/terrain and
   * would always match, letting any elevated convertLocalToLocal Z through.
   */
  private isHitOnColideLayer(hit: HTMLElement): boolean {
    if (!hit || !this.colideLayers?.length) return false;
    for (const layerName of this.colideLayers) {
      const layer = MovableDirective.layerMap.get(layerName);
      if (!layer) continue;
      for (const movable of layer) {
        if (movable === this) continue;
        if (layerName === 'character' && (this.tabletopObject?.isNotRide || !!TableSelecter.instance?.viewTable?.is2DMode)) continue;
        const root = movable.nativeElement;
        if (!root) continue;
        if (root === hit || root.contains(hit)) return true;
      }
    }
    return false;
  }

  /** True when elementFromPoint landed on another movable we must not climb. */
  private isHitOnNonRidePeer(hit: HTMLElement): boolean {
    if (!hit) return false;
    for (const [layerName, layer] of MovableDirective.layerMap) {
      if (this.colideLayers?.includes(layerName)) continue;
      for (const movable of layer) {
        if (movable === this) continue;
        const root = movable.nativeElement;
        if (!root) continue;
        if (root === hit || root.contains(hit)) return true;
      }
    }
    return false;
  }

  /**
   * elementsFromPoint includes PE-none nodes. If a mask/character/card is under the
   * cursor, dragging must not adopt elevated Z from terrain behind them.
   */
  private hitStackHasNonRidePeer(hitStack?: Element[]): boolean {
    if (!hitStack?.length) return false;
    for (const el of hitStack) {
      if (!(el instanceof HTMLElement)) continue;
      if (this.nativeElement === el || this.nativeElement.contains(el)) continue;
      if (this.isHitOnNonRidePeer(el)) return true;
    }
    return false;
  }

  setAnimatedTransition(isEnable: boolean, durationMs: number = 132) {
    this.nativeElement.style.transition = isEnable ? `transform ${Math.max(0, durationMs)}ms linear` : '';
  }

  private shouldTransition(object: TabletopObject): boolean {
    return object.location.x !== this.posX || object.location.y !== this.posY || object.posZ !== this.posZ;
  }

  stopTransition() {
    this.nativeElement.style.transform = window.getComputedStyle(this.nativeElement).transform;
  }

  private updateTransformCss() {
    let offset = this.transformCssOffset || '';
    // Shared [ ] peers: base lift + micro zindex step (3D paint without DOM reorder).
    if (LAYER_PEER_ALIASES.has(this.layerName)) {
      const raw = this.tabletopObject as TabletopObject & { zindex?: number };
      const zindex = typeof raw?.zindex === 'number' ? raw.zindex : 0;
      const lift = LAYER_PEER_MOVABLE_Z_PX + stackTranslateZPx(zindex);
      offset = offset.replace(/translateZ\([^)]*\)\s*/g, '');
      offset = `translateZ(${lift.toFixed(4)}px)`;
    }
    const css = `${offset} translate3d(${this.posX.toFixed(4)}px, ${this.posY.toFixed(4)}px, ${this.posZ.toFixed(4)}px)`;
    this.nativeElement.style.transform = css;
  }

  private setCollidableLayer(isCollidable: boolean) {
    // todo
    let isEnable = isCollidable;
    for (let layerName of MovableDirective.layerMap.keys()) {
      if (this.colideLayers.includes(layerName)) {
        //isEnable = this.input.isGrabbing ? isCollidable : true;
        if (layerName == 'character') {
          const canRide = !this.tabletopObject.isNotRide && !TableSelecter.instance?.viewTable?.is2DMode;
          isEnable = this.input.isGrabbing ? isCollidable && canRide : true;
        } else {
          isEnable = this.input.isGrabbing ? isCollidable : true;
        }
      } else {
        isEnable = !isCollidable;
      }
      MovableDirective.layerMap.get(layerName).forEach(movable => {
        if (movable === this || (movable.input?.isGrabbing)) return;
        movable.setPointerEvents(isEnable);
      });
    }
  }

  private register() {
    let layerSet = MovableDirective.layerMap.get(this.layerName) ?? new Set();
    layerSet.add(this);
    MovableDirective.layerMap.set(this.layerName, layerSet);
  }

  private unregister() {
    let layerSet = MovableDirective.layerMap.get(this.layerName);
    if (!layerSet) return;
    layerSet.delete(this);
    if (layerSet.size < 1) MovableDirective.layerMap.delete(this.layerName);
  }
}
