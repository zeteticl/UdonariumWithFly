import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { SlopeDirection, Terrain, TerrainNeonType, TerrainViewState, TERRAIN_NEON_DEFAULT_COLOR, TERRAIN_SIZE_MIN } from '@udonarium/terrain';
import { TableSelecter } from '@udonarium/table-selecter';
import { TerrainSettingsComponent } from 'component/terrain-settings/terrain-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableDirective, MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ModalService } from 'service/modal.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { CoordinateService } from 'service/coordinate.service';
import { ImageService } from 'service/image.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TerrainBakeCropService, TERRAIN_BAKE_CROP_PREVIEW } from 'service/terrain-bake-crop.service';
import { emptyInsets, faceCropBackgroundStyle, parseBakeCropState } from '@udonarium/terrain-model/bake-crop';
import {
  assembleBakeGroupAt,
  bakeGroupBoundsPx,
  bakeGroupPartsOf,
  clearBakeGroup,
  formBakeGroup,
  scaleBakeGroupFrom,
  terrainsInBakeGroup,
  cornerDragScaleFactors,
} from '@udonarium/terrain-model/bake-group';
import { wallLeftCssTransform } from '@udonarium/terrain-wall-transform';

type FaceKey = 'floor' | 'underside' | 'wallTop' | 'wallBottom' | 'wallLeft' | 'wallRight';

@Component({
    selector: 'terrain',
    templateUrl: './terrain.component.html',
    styleUrls: ['./terrain.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TerrainComponent implements OnChanges, OnDestroy, AfterViewInit, AfterViewChecked {
  @Input() terrain: Terrain = null;
  @Input() is3D: boolean = false;
  @ViewChild('scaleGrabLT') scaleGrabLTRef: ElementRef<HTMLElement>;
  @ViewChild('scaleGrabRB') scaleGrabRBRef: ElementRef<HTMLElement>;
  @ViewChild(MovableDirective) private movableDir: MovableDirective;

  get name(): string { return this.terrain.name; }
  get mode(): TerrainViewState { return this.terrain.mode; }
  set mode(mode: TerrainViewState) { this.terrain.mutateAppearance(() => { this.terrain.mode = mode; }); }

  get isLocked(): boolean { return this.terrain.isLocked; }
  set isLocked(isLocked: boolean) { this.terrain.mutateAppearance(() => { this.terrain.isLocked = isLocked; }); }
  get hasWall(): boolean { return this.terrain.hasWall; }
  get hasFloor(): boolean { return this.terrain.hasFloor; }

  get height(): number { return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(this.terrain.height)); }
  get width(): number { return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(this.terrain.width)); }
  get depth(): number { return Math.max(TERRAIN_SIZE_MIN, MathUtil.clampMin(this.terrain.depth)); }
  get altitude(): number { return this.terrain.altitude; }
  set altitude(altitude: number) { this.terrain.altitude = altitude; }

  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }

  get isDropShadow(): boolean { return this.terrain.isDropShadow; }
  set isDropShadow(isDropShadow: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isDropShadow = isDropShadow; });
  }
  get isSurfaceShading(): boolean { return this.terrain.isSurfaceShading; }
  set isSurfaceShading(isSurfaceShading: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isSurfaceShading = isSurfaceShading; });
  }

  get isInteract(): boolean { return this.terrain.isInteract; }
  set isInteract(isInteract: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isInteract = isInteract; });
  }

  get isSlope(): boolean { return this.terrain.isSlope; }
  set isSlope(isSlope: boolean) {
    this.terrain.mutateAppearance(() => {
      this.terrain.isSlope = isSlope;
      if (!isSlope) this.terrain.slopeDirection = SlopeDirection.NONE;
    });
  }

  get slopeDirection(): number {
    if (!this.terrain.isSlope) return SlopeDirection.NONE;
    if (this.terrain.isSlope && this.terrain.slopeDirection === SlopeDirection.NONE) return SlopeDirection.BOTTOM;
    return this.terrain.slopeDirection;
  }
  set slopeDirection(slopeDirection: number) {
    this.terrain.mutateAppearance(() => {
      this.terrain.isSlope = (slopeDirection != SlopeDirection.NONE);
      this.terrain.slopeDirection = slopeDirection;
    });
  }
  
  get isAltitudeIndicate(): boolean { return this.terrain.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) {
    this.terrain.mutateAppearance(() => { this.terrain.isAltitudeIndicate = isAltitudeIndicate; });
  }

  get mirrorWallTop(): boolean { return this.terrain.mirrorWallTop !== false; }
  get mirrorWallLeft(): boolean { return this.terrain.mirrorWallLeft !== false; }

  get neonType(): number { return this.terrain?.neonType || TerrainNeonType.NONE; }
  get neonColorCss(): string {
    const c = (this.terrain?.neonColor || '').trim();
    return c || TERRAIN_NEON_DEFAULT_COLOR;
  }
  get neonStyle(): { [key: string]: string } | null {
    if (this.neonType === TerrainNeonType.NONE) return null;
    return { '--neon-color': this.neonColorCss };
  }
  get neonWallClass(): string {
    if (this.neonType === TerrainNeonType.NONE || this.terrain?.neonOnWalls === false) return '';
    return this.neonTypeClass;
  }
  get neonFloorClass(): string {
    if (this.neonType === TerrainNeonType.NONE || !this.terrain?.neonOnFloor) return '';
    return this.neonTypeClass;
  }
  private get neonTypeClass(): string {
    switch (this.neonType) {
      case TerrainNeonType.SOFT: return 'neon neon-soft';
      case TerrainNeonType.TUBE: return 'neon neon-tube';
      case TerrainNeonType.EDGE: return 'neon neon-edge';
      case TerrainNeonType.FLICKER: return 'neon neon-flicker';
      case TerrainNeonType.PULSE: return 'neon neon-pulse';
      case TerrainNeonType.STROBE: return 'neon neon-strobe';
      default: return '';
    }
  }

  get isVisibleFloor(): boolean { return 0 < this.width * this.depth; }
  get isVisibleWallTopBottom(): boolean { return 0 < this.width * this.height; }
  get isVisibleWallLeftRight(): boolean { return 0 < this.depth * this.height; }

  get selectionState(): SelectionState { return this.selectionService.state(this.terrain); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  gridSize: number = 50;

  get isWallExist(): boolean {
    if (!this.hasWall) return false;
    const img = this.terrain.faceImage('wallBottom');
    return !!(img && !img.isEmpty && img.url);
  }

  get terreinAltitude(): number {
    let ret = this.altitude;
    if (this.altitude < 0 || (!this.isSlope && !this.isWallExist)) ret += this.height;
    return ret;
  }

  get isVisibleUnderside(): boolean {
    if (!this.hasFloor || this.isSlope || !this.isVisibleFloor) return false;
    // Skip paper-thin ground tiles; show for boxes / elevated signs.
    if (Math.abs(this.altitude) < 0.01 && this.height < 0.5) return false;
    return this.undersideImageUrl.length > 0;
  }

  /** Invisible hit pad so thin signs remain selectable. */
  get hitPadScaleX(): number {
    const px = this.width * this.gridSize;
    return px < 28 ? 28 / px : 1;
  }
  get hitPadScaleY(): number {
    const px = this.depth * this.gridSize;
    return px < 28 ? 28 / px : 1;
  }
  get needsHitPad(): boolean {
    return this.hitPadScaleX > 1.01 || this.hitPadScaleY > 1.01;
  }

  private _faceCache = new Map<string, { id: string; state: number; url: string }>();

  private faceUrl(face: FaceKey | 'wall'): string {
    // Prefer bake-crop sources whenever present so CSS insets match live preview
    // (display bitmaps must stay uncropped; otherwise save double-crops).
    const state = parseBakeCropState(this.terrain?.bakeCropJson);
    const srcId = face === 'wall' ? state?.sources?.wallBottom : state?.sources?.[face];
    const srcFile = srcId ? ImageStorage.instance.get(srcId) : null;
    const raw = srcFile
      ? this.imageService.getSkeletonOr(srcFile)
      : (face === 'wall'
        ? this.imageService.getSkeletonOr(this.terrain.wallImage)
        : this.imageService.getSkeletonOr(this.terrain.faceImage(face)));
    const key = srcId ? `${face}:src:${srcId}` : face;
    const prev = this._faceCache.get(key);
    if (prev && prev.id === raw.identifier && prev.state === raw.state) return prev.url;

    let revokeUrl = prev?.url && prev.url.startsWith('blob:') ? prev.url : '';
    let url = raw.url || '';
    if (raw.state === ImageState.THUMBNAIL || raw.state === ImageState.COMPLETE) {
      if (raw.blob) url = URL.createObjectURL(raw.blob);
    }
    this._faceCache.set(key, { id: raw.identifier, state: raw.state, url });
    if (revokeUrl && revokeUrl !== url) queueMicrotask(() => URL.revokeObjectURL(revokeUrl));
    return url;
  }

  get floorImageUrl(): string { return this.faceUrl('floor'); }
  get undersideImageUrl(): string { return this.faceUrl('underside'); }
  get wallTopImageUrl(): string { return this.faceUrl('wallTop'); }
  get wallBottomImageUrl(): string { return this.faceUrl('wallBottom'); }
  get wallLeftImageUrl(): string { return this.faceUrl('wallLeft'); }
  get wallRightImageUrl(): string { return this.faceUrl('wallRight'); }
  get wallLeftTransform(): string { return wallLeftCssTransform(this.mirrorWallLeft); }

  cropBgSize(face: FaceKey): string {
    return this.faceCropStyle(face)['background-size'];
  }

  cropBgPos(face: FaceKey): string {
    return this.faceCropStyle(face)['background-position'];
  }

  private faceCropStyle(face: FaceKey) {
    const live = this.bakeCrop.livePreviewFor(this.terrain?.identifier);
    if (live) return faceCropBackgroundStyle(live[face] || emptyInsets());
    // Apply stored auto-insets so sky/padding is clipped without re-baking
    // (fixes white band under the roof + mismatched wall scales).
    const stored = parseBakeCropState(this.terrain?.bakeCropJson);
    const insets = stored?.faces?.[face];
    if (insets && !this.insetsAreEmpty(insets)) {
      return faceCropBackgroundStyle(insets);
    }
    return { 'background-size': '100% 100%', 'background-position': '0% 0%', 'background-repeat': 'no-repeat' };
  }

  private insetsAreEmpty(insets: { west?: number; east?: number; north?: number; south?: number }): boolean {
    return (insets.west || 0) + (insets.east || 0) + (insets.north || 0) + (insets.south || 0) < 1e-6;
  }

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  math = Math;
  slopeDirectionState = SlopeDirection;

  private input: InputHandler = null;
  private scaleInputs: InputHandler[] = [];
  private scaleBoundEls: Array<HTMLElement | null> = [null, null];
  private scaleCorner: 'lt' | 'rb' = 'rb';
  private scaleStartTable = { x: 0, y: 0 };
  private scaleStartBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, cx: 0, cy: 0 };
  private scaleStartSnapshots: Array<{
    terrain: Terrain;
    x: number;
    y: number;
    w: number;
    d: number;
    h: number;
  }> = [];

  constructor(
    private ngZone: NgZone,
    private imageService: ImageService,
    private tabletopActionService: TabletopActionService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private selectionService: TabletopSelectionService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private coordinateService: CoordinateService,
    private i18n: I18nService,
    private bakeCrop: TerrainBakeCropService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  viewRotateZ = 10;

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on(`UPDATE_SELECTION/identifier/${this.terrain?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(TERRAIN_BAKE_CROP_PREVIEW, event => {
        if (event.data?.identifier === this.terrain?.identifier) this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.terrain,
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.terrain
    };
    queueMicrotask(() => this.bindScaleGrabs());
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
    queueMicrotask(() => this.bindScaleGrabs());
  }

  ngAfterViewChecked() {
    this.bindScaleGrabs();
  }

  ngOnDestroy() {
    this.input?.destroy();
    this.destroyScaleInputs();
    EventSystem.unregister(this);
    for (const entry of this._faceCache.values()) {
      if (entry.url?.startsWith('blob:')) URL.revokeObjectURL(entry.url);
    }
    this._faceCache.clear();
  }

  private destroyScaleInputs() {
    for (const h of this.scaleInputs) h.destroy();
    this.scaleInputs = [];
    this.scaleBoundEls = [null, null];
  }

  private bindScaleGrabs() {
    if (this.isLocked || this.GuestMode()) {
      this.destroyScaleInputs();
      return;
    }
    const els: Array<{ el: HTMLElement | null; corner: 'lt' | 'rb' }> = [
      { el: this.scaleGrabLTRef?.nativeElement || null, corner: 'lt' },
      { el: this.scaleGrabRBRef?.nativeElement || null, corner: 'rb' },
    ];
    if (!els[0].el && !els[1].el) {
      this.destroyScaleInputs();
      return;
    }
    if (
      this.scaleInputs.length === 2
      && this.scaleBoundEls[0] === els[0].el
      && this.scaleBoundEls[1] === els[1].el
    ) {
      return;
    }
    this.destroyScaleInputs();
    this.ngZone.runOutsideAngular(() => {
      for (let i = 0; i < els.length; i++) {
        const { el, corner } = els[i];
        if (!el) continue;
        const handler = new InputHandler(el);
        handler.onStart = (ev) => this.onScaleStart(ev, corner);
        handler.onMove = (ev) => this.onScaleMove(ev);
        handler.onEnd = () => this.onScaleEnd();
        this.scaleInputs.push(handler);
        this.scaleBoundEls[i] = el;
      }
    });
  }

  private onScaleStart(ev: MouseEvent | TouchEvent, corner: 'lt' | 'rb') {
    ev?.stopPropagation?.();
    if (ev?.cancelable) ev.preventDefault();
    if (this.GuestMode() || this.isLocked || !this.terrain) {
      this.scaleInputs.forEach(h => h.cancel());
      return;
    }
    // Stop parent movable so corner drag scales instead of moving the piece.
    this.input?.cancel();
    this.movableDir?.cancel();
    this.scaleCorner = corner;
    this.scaleStartTable = this.tablePointer();
    const parts = bakeGroupPartsOf(this.terrain);
    this.scaleStartBounds = bakeGroupBoundsPx(parts);
    this.scaleStartSnapshots = parts.map(t => ({
      terrain: t,
      x: t.location?.x ?? 0,
      y: t.location?.y ?? 0,
      w: Math.max(TERRAIN_SIZE_MIN, t.width || 1),
      d: Math.max(TERRAIN_SIZE_MIN, t.depth || 1),
      h: Math.max(0, t.height || 0),
    }));
  }

  private tablePointer(): { x: number; y: number } {
    const p = this.pointerDeviceService.pointers[0] || { x: 0, y: 0 };
    const table = this.coordinateService.calcTabletopLocalCoordinate(
      { x: p.x, y: p.y, z: 0 },
      this.coordinateService.tabletopOriginElement
    );
    return { x: table.x, y: table.y };
  }

  private onScaleMove(ev?: MouseEvent | TouchEvent) {
    if (this.GuestMode() || this.isLocked || !this.scaleStartSnapshots.length) return;
    const freeAspect = !!(ev && 'shiftKey' in ev && (ev as MouseEvent).shiftKey);
    const cur = this.tablePointer();
    const dx = cur.x - this.scaleStartTable.x;
    const dy = cur.y - this.scaleStartTable.y;
    const b = this.scaleStartBounds;
    const w0 = Math.max(1, b.maxX - b.minX);
    const d0 = Math.max(1, b.maxY - b.minY);

    let scaleX: number;
    let scaleY: number;
    let anchor: { x: number; y: number };
    if (this.scaleCorner === 'rb') {
      anchor = { x: b.minX, y: b.minY };
    } else {
      anchor = { x: b.maxX, y: b.maxY };
    }

    // Single terrain: free width/depth (classic resize). Bake groups: uniform.
    ({ scaleX, scaleY } = cornerDragScaleFactors({
      freeAspect,
      partCount: this.scaleStartSnapshots.length,
      corner: this.scaleCorner,
      w0,
      d0,
      dx,
      dy,
      anchor,
      start: this.scaleStartTable,
      cur,
      bounds: b,
    }));

    this.ngZone.run(() => {
      for (const s of this.scaleStartSnapshots) {
        s.terrain.mutateAppearance(() => {
          s.terrain.width = s.w;
          s.terrain.depth = s.d;
          s.terrain.height = s.h;
        });
        s.terrain.location = { name: 'table', x: s.x, y: s.y };
      }
      const parts = this.scaleStartSnapshots.map(s => s.terrain);
      scaleBakeGroupFrom(parts, anchor, scaleX, scaleY, { freeAspect });
      for (const t of parts) {
        MovableDirective.syncPoseFromUndo(t, t.location.x, t.location.y, t.posZ || 0);
      }
      this.changeDetector.markForCheck();
    });
  }

  private onScaleEnd() {
    this.scaleStartSnapshots = [];
    this.changeDetector.markForCheck();
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.input.cancel();

    // TODO: 想更好的做法
    if (this.isLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();


    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.tabletopActionService.ensureObjectSelected(this.terrain);
    let menuPosition = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedTerrains()) {
      menuActions = this.makeSelectionContextMenu();
      title = this.i18n.t('terrain.selectedCount', { count: this.selectedTerrains().length });
    } else {
      menuActions = menuActions.concat(this.makeSelectionContextMenu());
      menuActions = menuActions.concat(this.makeContextMenu());
    }
    menuActions = this.tabletopActionService.withClipboardMenuPrefix(menuActions);

    this.contextMenuService.open(menuPosition, menuActions, title);
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.blockPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.blockPut);
  }

  get floorModCss() {
    return this.terrain?.floorModCss || '';
  }

  get slopeDegrees(): number {
    return this.terrain?.slopeDegrees || 0;
  }

  get floorBrightness() {
    return this.terrain?.floorBrightness ?? 1.0;
  }

  /** Floor filter; neon class owns filter when glowing. */
  get floorFilterCss(): string {
    if (this.neonFloorClass) return null;
    return `brightness(${this.floorBrightness}) sharpen(1)`;
  }

  private selectedTerrains(): Terrain[] {
    return this.selectionService.objects.filter(
      object => object.aliasName === this.terrain.aliasName
    ) as Terrain[];
  }

  private isMultiSelectedTerrains(): boolean {
    return this.isSelected && this.selectedTerrains().length > 1;
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let actions: ContextMenuAction[] = [];

    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    const congregateLabel = this.selectionHasBakeGroup()
      ? this.i18n.t('terrain.menu.25')
      : this.i18n.t('terrain.menu.1');
    actions.push({
      name: congregateLabel,
      hotkey: 'T',
      action: () => this.selectionService.congregate(objectPosition),
    });

    if (this.isMultiSelectedTerrains()) {
      let selectedGameTableMasks = () => this.selectedTerrains();
      actions.push(
        {
          name: this.i18n.t('terrain.menu.27'),
          action: () => {
            formBakeGroup(selectedGameTableMasks());
          },
        },
        {
          name: this.i18n.t('terrain.menu.2'), action: null, subActions: [
            {
              name: this.i18n.t('terrain.menu.3'), action: () => {
                selectedGameTableMasks().forEach(terrain => {
                  terrain.mutateAppearance(() => { terrain.isLocked = true; });
                });
                SoundEffect.play(PresetSound.lock);
              }
            },
          ]
        },
        ContextMenuSeparator,
        {
          name: this.i18n.t('char.clearSelection'),
          action: () => this.selectionService.clear()
        },
      );
    }
    actions.push(ContextMenuSeparator);
    return actions;
  }

  private selectionHasBakeGroup(): boolean {
    return this.selectedTerrains().some(t => !!t.bakeGroupId);
  }

  private makeContextMenu(): ContextMenuAction[] {
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    let actions: ContextMenuAction[] = [
      contextMenuToggleCheck({
        get: () => this.isLocked,
        set: (v) => {
          this.isLocked = v;
          SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
        },
        on: this.i18n.t('terrain.menu.5'),
        off: this.i18n.t('terrain.menu.6'),
        hotkey: 'L',
      }),
      ...(this.terrain?.bakeGroupId ? [
        {
          name: this.i18n.t('terrain.menu.25'),
          action: () => {
            const parts = terrainsInBakeGroup(this.terrain.bakeGroupId);
            assembleBakeGroupAt(parts, objectPosition);
          },
        },
        {
          name: this.i18n.t('terrain.menu.26'),
          action: () => {
            clearBakeGroup(terrainsInBakeGroup(this.terrain.bakeGroupId));
            this.selectionService.clear();
          },
        },
        ContextMenuSeparator,
      ] : []),
      (this.isLocked ? null : { name: this.i18n.t('terrain.overlapOrder', { flatOnly: this.height === 0 ? '' : this.i18n.t('terrain.dynamic.1') }), action: null, subActions: [
        {
          name: this.i18n.t('terrain.menu.7'), action: () => {
            if (!this.isLocked) {
              const parent = this.terrain.parent;
              if (parent) parent.appendChild(this.terrain);
            }
          },
          disabled: this.isLocked
        },
        {
          name: this.i18n.t('terrain.menu.8'), action: () => {
            if (!this.isLocked) {
              const parent = this.terrain.parent;
              if (parent) parent.prependChild(this.terrain);
            }
          },
          disabled: this.isLocked
        }],
        disabled: this.isLocked || this.height != 0
      }),
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.9'), action: null, subActions: [
        {
          name: `${ this.slopeDirection == SlopeDirection.NONE ? '◉' : '○' } ${this.i18n.t('terrain.slope.none')}`, action: () => {
            this.slopeDirection = SlopeDirection.NONE;
          },
          checkBox: 'radio'
        },
        ContextMenuSeparator,
        {
          name: `${ this.slopeDirection == SlopeDirection.TOP ? '◉' : '○' } ${this.i18n.t('terrain.slope.top')}`, action: () => {
            this.slopeDirection = SlopeDirection.TOP;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.BOTTOM ? '◉' : '○' } ${this.i18n.t('terrain.slope.bottom')}`, action: () => {
            this.slopeDirection = SlopeDirection.BOTTOM;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.LEFT ? '◉' : '○' } ${this.i18n.t('terrain.slope.left')}`, action: () => {
            this.slopeDirection = SlopeDirection.LEFT;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.slopeDirection == SlopeDirection.RIGHT ? '◉' : '○' } ${this.i18n.t('terrain.slope.right')}`, action: () => {
            this.slopeDirection = SlopeDirection.RIGHT;
          },
          checkBox: 'radio'
        }
      ]},
      { name: this.i18n.t('terrain.menu.10'), action: null, subActions: [
        {
          name: `${ this.hasWall && this.isSurfaceShading ? '◉' : '○' } ${this.i18n.t('terrain.wall.normal')}`, action: () => {
            this.mode = TerrainViewState.ALL;
            this.isSurfaceShading = true;
          },
          checkBox: 'radio'
        },
        {
          name: `${ this.hasWall && !this.isSurfaceShading ? '◉' : '○' } ${this.i18n.t('terrain.wall.noShade')}`, action: () => {
            this.mode = TerrainViewState.ALL;
            this.isSurfaceShading = false;
          },
          checkBox: 'radio'
        },
        {
          name: `${ !this.hasWall ? '◉' : '○' } ${this.i18n.t('terrain.wall.hidden')}`, action: () => {
            this.mode = TerrainViewState.FLOOR;
            if (this.depth * this.width === 0) {
              this.terrain.width = this.width <= 0 ? 1 : this.width;
              this.terrain.depth = this.depth <= 0 ? 1 : this.depth;
            }
          },
          checkBox: 'radio'
        },
      ]},
      ContextMenuSeparator,
      /*
      (this.isInteract
        ? {
          name: this.i18n.t('terrain.menu.11'), action: () => {
            this.isInteract = false;
            SoundEffect.play(PresetSound.unlock);
          },
                checkBox: 'check'
        } : {
          name: this.i18n.t('terrain.menu.12'), action: () => {
            this.isInteract = true;
            SoundEffect.play(PresetSound.lock);
          },
                checkBox: 'check'
        }),
      ContextMenuSeparator,
      */
      contextMenuToggleCheck({
        get: () => !!this.terrain.affectsLight,
        set: (v) => {
          this.terrain.mutateAppearance(() => { this.terrain.affectsLight = v; });
        },
        on: this.i18n.t('terrain.menu.13'),
        off: this.i18n.t('terrain.menu.14'),
      }),
      contextMenuToggleCheck({
        get: () => this.isDropShadow,
        set: (v) => { this.isDropShadow = v; },
        on: this.i18n.t('terrain.menu.15'),
        off: this.i18n.t('terrain.menu.16'),
      }),
      ...(this.is2DMode ? [] : [
        contextMenuToggleCheck({
          get: () => this.isAltitudeIndicate,
          set: (v) => { this.isAltitudeIndicate = v; },
          on: this.i18n.t('terrain.menu.17'),
          off: this.i18n.t('terrain.menu.18'),
        }),
        {
          name: this.i18n.t('terrain.menu.19'), action: () => {
            if (this.altitude != 0) {
              this.altitude = 0;
              SoundEffect.play(PresetSound.sweep);
            }
          },
          altitudeHande: this.terrain
        },
      ]),
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.20'), action: () => { this.showDetail(this.terrain); } },
      (this.bakeCrop.hasSources(this.terrain) ? {
        name: this.i18n.t('terrain.settings.cropPreview'),
        action: () => { void this.bakeCrop.openEdit(this.terrain); },
        disabled: this.GuestMode(),
      } : null),
      (this.terrain.getUrls().length <= 0 ? null : {
        name: this.i18n.t('terrain.menu.21'), action: null,
        subActions: this.terrain.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.terrain.name, subTitle: urlElement.name });
              } 
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.terrain.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: this.i18n.t('terrain.menu.23'), action: () => {
          this.terrain.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      },
      ContextMenuSeparator,
      { name: this.i18n.t('terrain.menu.24'), action: null, subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition) }
    ];

    return actions;
  }

  onDoubleClick(e: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e.stopPropagation();
    this.showDetail(this.terrain);
  }

  private showDetail(gameObject: Terrain) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('terrain.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 210, top: coordinate.y - 180, width: 420, height: 400,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<TerrainSettingsComponent>(TerrainSettingsComponent, option);
    component.terrain = gameObject;
  }
}
