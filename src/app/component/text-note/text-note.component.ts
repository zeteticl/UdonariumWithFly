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
  ViewChild
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { renderPdfPage } from '@udonarium/core/file-storage/pdf-render';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { rbCornerResizeSize, rotateTableDeltaToLocal } from '@udonarium/tabletop-corner-resize';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { noteMarkdownToHtml } from '@udonarium/note-markdown';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';
import { LAYER_PEER_MOVABLE_Z_PX, layerPeerMovableTransform } from '@udonarium/tabletop-object-util';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { NoteSettingsComponent } from 'component/note-settings/note-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableDirective, MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { PAPER_STYLES, pushPinAssetUrl } from '@udonarium/table-fx/push-pin.util';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { CoordinateService } from 'service/coordinate.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopActionService } from 'service/tabletop-action.service';

@Component({
  selector: 'text-note',
  templateUrl: './text-note.component.html',
  styleUrls: ['./text-note.component.css', '../shared/clue-board.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class TextNoteComponent implements OnChanges, OnDestroy, AfterViewInit, AfterViewChecked {
  @ViewChild('textArea') textAreaElementRef: ElementRef<HTMLTextAreaElement>;
  @ViewChild('pdfCanvas') pdfCanvasRef: ElementRef<HTMLCanvasElement>;
  @ViewChild('resizeGrab') resizeGrabRef: ElementRef<HTMLElement>;
  @ViewChild(MovableDirective) private movableDir: MovableDirective;

  @Input() textNote: TextNote = null;
  @Input() is3D: boolean = false;

  get title(): string { return this.textNote.title; }
  get text(): string { this.calcFitHeightIfNeeded(); return this.textNote.text; }
  set text(text: string) { this.calcFitHeightIfNeeded(); this.textNote.text = text; }
  get color(): string { return this.textNote.color; }
  set color(color: string) { this.textNote.color = color; }

  get textShadowCss(): string {
    const shadow = StringUtil.textShadowColor(this.color, '#f2f2f2', '#000000');
    return `${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px, ${shadow} 0px 0px 0.5px`;
  }

  get fontSize(): number { this.calcFitHeightIfNeeded(); return this.textNote.fontSize; }
  get textAlign(): string {
    const a = this.textNote?.textAlign || 'left';
    return (a === 'center' || a === 'right' || a === 'justify') ? a : 'left';
  }
  set textAlign(v: string) {
    if (!this.textNote) return;
    this.textNote.mutateAppearance(() => {
      this.textNote.textAlign = (v === 'center' || v === 'right' || v === 'justify') ? v : 'left';
    });
  }
  get imageFile(): ImageFile { return this.textNote.imageFile; }
  get isFlipped(): boolean { return !!this.textNote?.isFlipped; }
  get hasBackImage(): boolean { return !!this.textNote?.hasBackImage; }
  /** Flipped with no back art: keep front content and spin the face 180°. */
  get isContentFlipped(): boolean { return this.isFlipped && !this.hasBackImage; }
  /** Flipped with back art: replace face media with the back image. */
  get showBackFace(): boolean { return this.isFlipped && this.hasBackImage; }
  get rotate(): number { return this.textNote.rotate; }
  set rotate(rotate: number) { this.textNote.mutateAppearance(() => { this.textNote.rotate = rotate; }); }
  get zindex(): number { return this.textNote.zindex; }
  get height(): number { return MathUtil.clampMin(this.textNote.height); }
  get width(): number { return MathUtil.clampMin(this.textNote.width); }
  get altitude(): number { return this.textNote.altitude; }
  set altitude(altitude: number) { this.textNote.altitude = altitude; }

  get textNoteAltitude(): number {
    let ret = this.altitude;
    if (this.isUpright && this.altitude < 0) {
      if (-this.height <= this.altitude) return 0;
      ret += this.height;
    }
    return +ret.toFixed(1);
  }

  /** Room 2D mode: notes lie flat on the board (no billboard upright). */
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }
  /** 2D corkboard only — see template note on note-flat-hit (breaks 3D card compositing). */
  get useFlatHitPlate(): boolean { return this.is2DMode; }
  get isUpright(): boolean { return this.is2DMode ? false : this.textNote.isUpright; }
  set isUpright(isUpright: boolean) {
    if (this.is2DMode) return; // 2D boards always render flat; keep stored preference for 3D maps
    this.textNote.mutateAppearance(() => { this.textNote.isUpright = isUpright; });
  }
  get isAltitudeIndicate(): boolean { return this.textNote.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) {
    this.textNote.mutateAppearance(() => { this.textNote.isAltitudeIndicate = isAltitudeIndicate; });
  }
  get isLocked(): boolean { return this.textNote.isLocked; }
  set isLocked(isLocked: boolean) {
    this.textNote.mutateAppearance(() => { this.textNote.isLocked = isLocked; });
  }
  get isShowTitle(): boolean { return this.textNote.isShowTitle; }
  set isShowTitle(isShowTitle: boolean) {
    this.textNote.mutateAppearance(() => { this.textNote.isShowTitle = isShowTitle; });
  }
  get titleBgColor(): string {
    const c = this.textNote.titleBgColor || '#1e1e1e';
    return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#1e1e1e';
  }
  /** Contrast text on the title bar. */
  get titleFgColor(): string {
    return StringUtil.textShadowColor(this.titleBgColor, '#f2f2f2', '#222222');
  }
  get isWhiteOut(): boolean { return this.textNote.isWhiteOut; }
  set isWhiteOut(isWhiteOut: boolean) {
    this.textNote.mutateAppearance(() => { this.textNote.isWhiteOut = isWhiteOut; });
  }
  get isGhosted(): boolean { return !!this.textNote?.isGhosted; }
  get contentKind() { return this.textNote?.contentKind || 'text'; }
  get isPdfContent(): boolean { return this.contentKind === 'pdf'; }
  get isVideoContent(): boolean { return this.contentKind === 'video'; }
  get isImageContent(): boolean { return this.contentKind === 'image'; }
  get isTextContent(): boolean { return this.contentKind === 'text'; }
  get videoSrc(): string { return this.textNote?.resolvedVideoUrl || ''; }
  /** Paper chrome is clue-board only. */
  get paperStyle(): string {
    if (!this.is2DMode) return 'none';
    return this.textNote?.paperStyle || 'none';
  }
  get pushPin(): boolean { return !!this.textNote?.pushPin && this.is2DMode; }
  get pushPinAngle(): number { return this.textNote?.pushPinAngle || 0; }
  get pushPinLeft(): number {
    return typeof this.textNote?.pushPinLeft === 'number' ? this.textNote.pushPinLeft : -4;
  }
  get pushPinTop(): number {
    return typeof this.textNote?.pushPinTop === 'number' ? this.textNote.pushPinTop : -20;
  }
  get pushPinColor(): string { return this.textNote?.pushPinColor || 'red'; }
  get pushPinSrc(): string {
    return pushPinAssetUrl(
      this.pushPinColor,
      this.pushPinAngle,
      this.textNote?.pushPinStyle,
      this.textNote?.identifier,
    );
  }

  get isEditorSelected(): boolean {
    return !!this.textAreaElementRef?.nativeElement && document.activeElement === this.textAreaElementRef.nativeElement;
  }
  get isActive(): boolean { return this.isEditorSelected; }
  get selectionState(): SelectionState { return this.selectionService.state(this.textNote); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }
  get rubiedText(): string { return noteMarkdownToHtml(this.text); }


  private callbackOnMouseUp = (e) => this.onMouseUp(e);
  gridSize = 50;
  math = Math;
  private calcFitHeightTimer: NodeJS.Timeout = null;
  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  viewRotateZ = 10;
  private input: InputHandler = null;
  private resizeInput: InputHandler = null;
  private resizeBoundEl: HTMLElement = null;
  private dragStarted = false;
  private needsPdfRender = false;
  private lastPdfKey = '';
  private pdfRenderSeq = 0;
  /** Once per pdf id: grow paper height to the rendered page (+ title/nav) so the billboard bottom matches. */
  private pdfHeightFittedKey = '';
  private selfPreviewOpen = false;
  private isHovering = false;
  /** Last known MouseEvent.buttons — ignore Ctrl-press while drag-rotating the table. */
  private pointerButtons = 0;
  private resizeStartW = 1;
  /** True if this note was already selected when the current pointer-down began. */
  private selectedOnPointerDown = false;
  private resizeStartH = 1;
  private resizeStartTable = { x: 0, y: 0 };

  get isInverse(): boolean {
    const rotate = Math.abs(this.viewRotateZ + this.rotate) % 360;
    return 90 < rotate && rotate < 270;
  }

  constructor(
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private tabletopActionService: TabletopActionService,
    private characterFxMenu: CharacterFxMenuService,
    private coordinateService: CoordinateService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on(`UPDATE_GAME_OBJECT/identifier/${this.textNote?.identifier}`, () => {
        this.queuePdfRender();
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.textNote?.identifier}`, () => this.changeDetector.markForCheck())
      .on('SYNCHRONIZE_FILE_LIST', () => { this.queuePdfRender(); this.changeDetector.markForCheck(); })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('UPDATE_PDF_RESOURE', () => { this.queuePdfRender(); this.changeDetector.markForCheck(); })
      .on('UPDATE_VIDEO_RESOURE', () => this.changeDetector.markForCheck())
      .on('SYNCHRONIZE_VIDEO_LIST', () => this.changeDetector.markForCheck())
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on(`UPDATE_SELECTION/identifier/${this.textNote?.identifier}`, () => this.changeDetector.markForCheck())
      .on('SELECT_GAME_TABLE', () => this.changeDetector.markForCheck());
    this.movableOption = {
      tabletopObject: this.textNote,
      transformCssOffset: layerPeerMovableTransform(),
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.textNote,
      grabbingSelecter: '.rotate-grab',
    };
    this.queuePdfRender();
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
    this.bindResizeHandle();
  }

  ngAfterViewChecked() {
    if (this.needsPdfRender && this.isPdfContent && this.pdfCanvasRef?.nativeElement) {
      this.needsPdfRender = false;
      this.renderPdf();
    }
    this.bindResizeHandle();
  }

  ngOnDestroy() {
    this.closeSelfPreview();
    EventSystem.unregister(this);
    this.input?.destroy();
    this.resizeInput?.destroy();
    this.resizeInput = null;
  }

  private bindResizeHandle() {
    const el = this.resizeGrabRef?.nativeElement || null;
    if (!el) {
      this.resizeInput?.destroy();
      this.resizeInput = null;
      this.resizeBoundEl = null;
      return;
    }
    if (this.resizeBoundEl === el && this.resizeInput) return;
    this.resizeInput?.destroy();
    this.resizeBoundEl = el;
    this.ngZone.runOutsideAngular(() => {
      this.resizeInput = new InputHandler(el);
      this.resizeInput.onStart = (ev) => this.onResizeStart(ev);
      this.resizeInput.onMove = (ev) => this.onResizeMove(ev);
      this.resizeInput.onEnd = () => this.onResizeEnd();
    });
  }

  /** PDF / image / video keep page aspect; text notes stay free-form. */
  get keepsResizeAspect(): boolean {
    return this.isPdfContent || this.isImageContent || this.isVideoContent;
  }

  get resizeHintKey(): string {
    return this.keepsResizeAspect ? 'note.resizeHintAspect' : 'note.resizeHint';
  }

  private onResizeStart(ev: MouseEvent | TouchEvent) {
    ev?.stopPropagation?.();
    if (ev?.cancelable) ev.preventDefault();
    if (this.GuestMode() || this.isLocked || this.textNote?.isSizeLocked) {
      this.resizeInput?.cancel();
      return;
    }
    // Same as terrain: stop parent movable so corner drag scales instead of moving.
    this.input?.cancel();
    this.movableDir?.cancel();
    // Always map via tabletop origin — targetElement under the grab is 3D-transformed
    // and flips deltas once the pointer leaves the handle (looks like "both ways shrink").
    this.resizeStartTable = this.tablePointer();
    this.resizeStartW = this.width;
    this.resizeStartH = this.height;
  }

  private tablePointer(): { x: number; y: number } {
    const p = this.pointerDeviceService.pointers[0] || { x: 0, y: 0 };
    const table = this.coordinateService.calcTabletopLocalCoordinate(
      { x: p.x, y: p.y, z: 0 },
      this.coordinateService.tabletopOriginElement
    );
    return { x: table.x, y: table.y };
  }

  private onResizeMove(ev?: MouseEvent | TouchEvent) {
    if (this.GuestMode() || this.isLocked || this.textNote?.isSizeLocked) return;
    const cur = this.tablePointer();
    const dx = cur.x - this.resizeStartTable.x;
    const dy = cur.y - this.resizeStartTable.y;
    const { localDx, localDy } = rotateTableDeltaToLocal(dx, dy, this.rotate || 0);
    const freeAspect = !!(ev && 'shiftKey' in ev && (ev as MouseEvent).shiftKey);
    const { width: w, height: h } = rbCornerResizeSize({
      startW: this.resizeStartW,
      startH: this.resizeStartH,
      localDxPx: localDx,
      // Match terrain table +Y → depth/height; do not invert for upright (that made
      // horizontal drags pick a shrinking height axis under aspect lock).
      localDyPx: localDy,
      gridSize: this.gridSize,
      lockAspect: this.keepsResizeAspect && !freeAspect,
    });
    this.ngZone.run(() => {
      this.textNote.width = w;
      this.textNote.height = h;
      this.changeDetector.markForCheck();
    });
  }

  private onResizeEnd() {
    this.changeDetector.markForCheck();
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.dragStarted = false;
    this.input.cancel();
    if (this.isLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
    }
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter(e: MouseEvent) {
    this.isHovering = true;
    this.pointerButtons = e.buttons;
    // Preview opens only when Ctrl is pressed while already hovering (not Ctrl+sweep).
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(e: MouseEvent) {
    this.isHovering = true;
    this.pointerButtons = e.buttons;
  }

  @HostListener('mouseleave')
  onMouseLeave() {
    this.isHovering = false;
    // Keep Ctrl preview until Ctrl is released (mouse leave alone does not close).
  }

  @HostListener('window:mouseup', ['$event'])
  onWindowMouseUp(e: MouseEvent) {
    this.pointerButtons = e.buttons;
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    if (e.repeat) return;
    this.tryOpenSelfPreviewFromCtrl();
  }

  @HostListener('window:keyup', ['$event'])
  onWindowKeyUp(e: KeyboardEvent) {
    if (e.key !== 'Control' && e.key !== 'Meta') return;
    this.closeSelfPreview();
  }

  @HostListener('window:blur')
  onWindowBlur() {
    this.pointerButtons = 0;
    this.closeSelfPreview();
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: any) {
    this.pointerButtons = e?.buttons ?? this.pointerButtons;
    this.selectedOnPointerDown = this.isSelected;
    if (this.GuestMode()) return;
    if (e.ctrlKey || e.metaKey) return;
    if (this.isActive || this.isLocked) return;
    e.preventDefault();
    this.textNote.raiseInTier();
    if (e.button === 2) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', { srcEvent: e });
      return;
    }
    this.addMouseEventListeners();
  }

  onMouseUp(e: any) {
    // Do not autofocus the textarea on select — that steals [ ] / WASD / etc.
    // Enter edit via activate() (click the note text) or explicit focus.
    if (this.isEditorSelected && this.pointerDeviceService.isAllowedToOpenContextMenu && this.isTextContent) {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }
    this.removeMouseEventListeners();
    e.preventDefault();
  }

  onRotateMouseDown(e: any) {
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    this.removeMouseEventListeners();
    if (this.GuestMode()) return;
    if (this.isActive) return;
    e.stopPropagation();
    e.preventDefault();
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    this.tabletopActionService.ensureObjectSelected(this.textNote);
    const position = this.pointerDeviceService.pointers[0];
    let menuActions: ContextMenuAction[] = [];
    menuActions = menuActions.concat(this.makeSelectionContextMenu());
    menuActions = menuActions.concat(this.makeContextMenu());
    menuActions = this.tabletopActionService.withClipboardMenuPrefix(menuActions);
    this.contextMenuService.open(position, menuActions, this.title);
  }

  onMove() {
    this.dragStarted = true;
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
  }

  prevPdfPage(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    this.textNote.prevPdfPage();
    this.queuePdfRender();
  }

  nextPdfPage(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    this.textNote.nextPdfPage();
    this.queuePdfRender();
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];
    const objectPosition = { x: this.textNote.location.x, y: this.textNote.location.y, z: this.textNote.posZ };
    return [
      { name: this.i18n.t('textNote.menu.1'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) },
      ContextMenuSeparator,
    ];
  }

  private makeContextMenu(): ContextMenuAction[] {
    const objectPosition = {
      x: this.textNote.location.x + (this.width * this.gridSize) / 2,
      y: this.textNote.location.y + (this.height * this.gridSize) / 2,
      z: this.textNote.posZ
    };

    const after = () => this.changeDetector.markForCheck();
    const actions: ContextMenuAction[] = [
      // Toggles: ☑/☐ + feature name (current state), never the opposite action.
      contextMenuToggleCheck({
        get: () => this.isLocked,
        set: (v) => {
          this.isLocked = v;
          SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
        },
        on: this.i18n.t('textNote.menu.2'),
        off: this.i18n.t('textNote.menu.3'),
        after,
        hotkey: 'L',
      }),
      contextMenuToggleCheck({
        get: () => this.textNote.isSelfOnly,
        set: (v) => { this.textNote.setSelfOnly(v); },
        label: this.i18n.t('note.selfOnly'),
        after,
      }),
      contextMenuToggleCheck({
        get: () => this.textNote.isFlipped,
        set: (v) => { this.textNote.mutateAppearance(() => { this.textNote.isFlipped = v; }); },
        label: this.i18n.t('note.flipped'),
        tip: this.i18n.t('note.flipTip'),
        after,
      }),
      ...(this.is2DMode ? [
        {
          name: this.i18n.t('fx.paperStyle'),
          action: null,
          subActions: PAPER_STYLES.map(id => ({
            name: `${this.paperStyle === id ? '◉' : '○'} ${this.i18n.t(`fx.paperStyle.${id}`)}`,
            action: () => {
              this.textNote.applyPaperStyle(id);
              this.changeDetector.markForCheck();
            },
            nameUpdate: () => `${this.paperStyle === id ? '◉' : '○'} ${this.i18n.t(`fx.paperStyle.${id}`)}`,
            checkBox: 'radio' as const,
          })),
        },
        this.characterFxMenu.makePushPinMenu(this.textNote),
      ] : []),
      this.characterFxMenu.makeClueLinkMenu(this.textNote),
      ContextMenuSeparator,
      contextMenuToggleCheck({
        get: () => this.isUpright,
        set: (v) => { this.isUpright = v; },
        on: this.i18n.t('textNote.menu.4'),
        off: this.i18n.t('textNote.menu.5'),
        after,
        disabled: this.is2DMode,
        tip: this.is2DMode ? this.i18n.t('note.upright2dLocked') : undefined,
      }),
      contextMenuToggleCheck({
        get: () => this.isShowTitle,
        set: (v) => { this.isShowTitle = v; },
        on: this.i18n.t('textNote.menu.6'),
        off: this.i18n.t('textNote.menu.7'),
        after,
      }),
      contextMenuToggleCheck({
        get: () => this.isWhiteOut,
        set: (v) => { this.isWhiteOut = v; },
        on: this.i18n.t('textNote.menu.8'),
        off: this.i18n.t('textNote.menu.9'),
        after,
      }),
      ...(this.isTextContent ? [{
        name: this.i18n.t('note.fieldAlign'),
        action: null,
        subActions: (['left', 'center', 'right', 'justify'] as const).map(id => ({
          name: `${this.textAlign === id ? '◉' : '○'} ${this.i18n.t(`note.align.${id}`)}`,
          action: () => { this.textAlign = id; this.changeDetector.markForCheck(); },
          nameUpdate: () => `${this.textAlign === id ? '◉' : '○'} ${this.i18n.t(`note.align.${id}`)}`,
          checkBox: 'radio' as const,
        })),
      }] : []),
      ContextMenuSeparator,
      ...(this.is2DMode ? [] : [
        contextMenuToggleCheck({
          get: () => this.isAltitudeIndicate,
          set: (v) => { this.isAltitudeIndicate = v; },
          on: this.i18n.t('textNote.menu.10'),
          off: this.i18n.t('textNote.menu.11'),
          after,
        }),
        {
          name: this.i18n.t('textNote.menu.12'),
          action: () => {
            if (this.altitude != 0) {
              this.altitude = 0;
              SoundEffect.play(PresetSound.sweep);
              this.changeDetector.markForCheck();
            }
          },
          altitudeHande: this.textNote
        },
        ContextMenuSeparator,
      ]),
      {
        name: this.i18n.t('note.moveTo'),
        action: null,
        subActions: [
          {
            name: this.i18n.t('inv.placeOnCurrentMap'),
            action: () => { this.textNote.addToTable(); SoundEffect.play(PresetSound.cardPut); },
            disabled: this.textNote.isVisibleOnTable
          },
          {
            name: this.i18n.t('inv.moveToCurrentMapOnly'),
            action: () => { this.textNote.moveToTableOnly(); SoundEffect.play(PresetSound.cardPut); },
            disabled: !(this.textNote.location?.name === 'table' && !this.textNote.isVisibleOnTable)
          },
          {
            name: this.i18n.t('inv.removeFromCurrentMap'),
            action: () => {
              this.textNote.removeFromTable();
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            },
            disabled: !this.textNote.isVisibleOnTable
          },
          ContextMenuSeparator,
          {
            name: this.i18n.t('note.moveToCommon'),
            action: () => {
              this.textNote.setLocation('common');
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            }
          },
          {
            name: this.i18n.t('note.moveToPersonal'),
            action: () => {
              this.textNote.setLocation(Network.peerId);
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.cardPut);
            }
          },
          {
            name: this.i18n.t('note.moveToGraveyard'),
            action: () => {
              this.textNote.setLocation('graveyard');
              this.selectionService.remove(this.textNote);
              SoundEffect.play(PresetSound.sweep);
            }
          },
        ]
      },
      ContextMenuSeparator,
      { name: this.i18n.t('textNote.menu.13'), action: () => { this.showDetail(this.textNote); } },
    ];

    if (PeerCursor.myCursor?.isGMMode) {
      actions.push({
        name: this.i18n.t('note.showPlayers'),
        action: () => this.showHandoutToAll()
      });
      const peers = ObjectStore.instance.getObjects<PeerCursor>(PeerCursor)
        .filter(p => p.peerId && p.peerId !== PeerCursor.myCursor?.peerId);
      if (peers.length) {
        actions.push({
          name: this.i18n.t('note.showPlayersPick'),
          action: null,
          subActions: peers.map(peer => ({
            name: peer.name || peer.peerId,
            action: () => this.showHandoutToPeer(peer.peerId)
          }))
        });
      }
    }

    actions.push(
      (this.textNote.getUrls().length <= 0 ? null : {
        name: this.i18n.t('textNote.menu.14'), action: null,
        subActions: this.textNote.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.textNote.title, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.textNote.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: this.i18n.t('textNote.menu.16'), action: () => {
          this.textNote.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('textNote.menu.17'),
        action: null,
        subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition)
      },
    );

    return actions.filter(a => a != null);
  }

  calcFitHeightIfNeeded() {
    if (this.calcFitHeightTimer || !this.isTextContent) return;
    this.ngZone.runOutsideAngular(() => {
      this.calcFitHeightTimer = setTimeout(() => {
        this.calcFitHeight();
        this.calcFitHeightTimer = null;
      }, 0);
    });
  }

  calcFitHeight() {
    const textArea = this.textAreaElementRef?.nativeElement;
    if (!textArea) return;
    textArea.style.height = '0';
    if (textArea.scrollHeight > textArea.offsetHeight) {
      textArea.style.height = textArea.scrollHeight + 'px';
    }
  }

  lastNewLineAdjust(str: string): string {
    if (str == null) return '';
    return (!this.isSelected && str.lastIndexOf('\n') == str.length - 1) ? str + '\n' : str;
  }

  private addMouseEventListeners() {
    document.body.addEventListener('mouseup', this.callbackOnMouseUp, false);
  }

  private removeMouseEventListeners() {
    document.body.removeEventListener('mouseup', this.callbackOnMouseUp, false);
  }

  onDoubleClick(e: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e.stopPropagation();
    this.showDetail(this.textNote);
  }

  private showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('note.detailTitle');
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = {
      title: title, left: coordinate.x - 280, top: coordinate.y - 180, width: 420, height: 440,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    const component = this.panelService.open<NoteSettingsComponent>(NoteSettingsComponent, option);
    component.note = gameObject;
    component.embedded = false;
  }

  activate() {
    // First click only selects (so [ ] / WASD work). Second click on an
    // already-selected note enters text edit.
    if (!this.selectedOnPointerDown) return;
    if (!this.isLocked && this.isTextContent) this.textAreaElementRef?.nativeElement?.focus();
  }

  private handoutPayload() {
    return buildNoteHandoutPayload(this.textNote, this.i18n.t('note.untitled'));
  }

  private showHandoutToAll() {
    const data = this.handoutPayload();
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    EventSystem.call('SHOW_NOTE_HANDOUT', data);
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private showHandoutToPeer(peerId: string) {
    const data = this.handoutPayload();
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    if (!peerId) return;
    EventSystem.call('SHOW_NOTE_HANDOUT', data, peerId);
    if (peerId === PeerCursor.myCursor?.peerId) EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  /** Hover the note first, then press Ctrl/Meta to open; stays until Ctrl release. */
  private tryOpenSelfPreviewFromCtrl() {
    if (!this.isHovering) return;
    // Ctrl+right-drag rotates the view — ignore Ctrl while any button is held.
    if (this.pointerButtons !== 0 || this.pointerDeviceService.isDragging) return;
    this.openSelfPreview();
  }

  private openSelfPreview() {
    if (!this.textNote) return;
    const data = this.handoutPayload();
    data.preview = true;
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = this.textNote.title || this.i18n.t('note.untitled');
    }
    if (this.selfPreviewOpen) return;
    this.selfPreviewOpen = true;
    this.ngZone.run(() => EventSystem.trigger('SHOW_NOTE_HANDOUT', data));
  }

  private closeSelfPreview() {
    if (!this.selfPreviewOpen) return;
    this.selfPreviewOpen = false;
    EventSystem.trigger('HIDE_NOTE_HANDOUT', { noteIdentifier: this.textNote?.identifier });
  }

  private queuePdfRender() {
    if (!this.isPdfContent) return;
    // ":hi" = sharp tabletop render tier (forces one re-render after quality bump).
    const key = `${this.textNote.pdfIdentifier}:${this.textNote.pdfPage}:hi`;
    if (key !== this.lastPdfKey) this.needsPdfRender = true;
  }

  private async renderPdf() {
    const canvas = this.pdfCanvasRef?.nativeElement;
    const pdf = PdfStorage.instance.get(this.textNote.pdfIdentifier);
    if (!canvas || !pdf?.url) return;
    const seq = ++this.pdfRenderSeq;
    const wantPage = this.textNote.pdfPage;
    const id = this.textNote.pdfIdentifier;
    try {
      // Display width on the table is small (e.g. 4×50=200); render much sharper so text stays
      // readable in 3D view — CSS then scales the bitmap down into the paper box.
      const displayW = Math.max(120, this.width * this.gridSize);
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const maxW = Math.min(1600, Math.round(displayW * Math.max(3, dpr * 2.5)));
      const result = await renderPdfPage(canvas, pdf.url, wantPage, id, maxW);
      // Ignore stale / superseded renders (rapid page flips).
      if (!result || seq !== this.pdfRenderSeq || this.textNote.pdfIdentifier !== id) return;
      this.lastPdfKey = `${this.textNote.pdfIdentifier}:${result.page}:hi`;
      if (this.textNote.pdfPageCount !== result.pageCount) this.textNote.pdfPageCount = result.pageCount;
      if (this.textNote.pdfPage !== result.page) this.textNote.pdfPage = result.page;
      this.fitPaperToPdfCanvas(canvas);
      this.changeDetector.markForCheck();
    } catch (err) {
      if (seq === this.pdfRenderSeq) console.warn('text-note PDF render failed', err);
    }
  }

  /**
   * One-time paper fit for PDF notes:
   * - Grow width to a mid-zoom readable size (old imports were ~4 grids / unreadable far away).
   * - Grow height to the page aspect so the canvas does not sink past the table origin.
   */
  private fitPaperToPdfCanvas(canvas: HTMLCanvasElement) {
    const id = this.textNote?.pdfIdentifier || '';
    if (!id || this.pdfHeightFittedKey === id) return;
    if (!canvas.width || !canvas.height) return;
    this.pdfHeightFittedKey = id;
    if (this.textNote.isSizeLocked) return;

    /** ~500px — readable without camera glued to the note; user can still shrink after. */
    const minReadableWidth = 10;
    let sizeChanged = false;
    // Old PDF imports used ~4×5; bump those once so mid-zoom text is usable.
    // Notes the user already sized (≥5) are left alone.
    if (this.width <= 4.5) {
      this.textNote.width = minReadableWidth;
      sizeChanged = true;
    }

    const titlePx = (this.isShowTitle && (this.title || '').length) ? 28 : 0;
    const navPx = 36;
    const pagePx = (canvas.height / Math.max(1, canvas.width)) * (this.width * this.gridSize);
    const need = Math.max(1, Math.round(((pagePx + titlePx + navPx) / this.gridSize) * 2) / 2);
    if (need > this.height + 0.05) {
      this.textNote.height = need;
      sizeChanged = true;
    }

    // Re-render at the new display width so sharpness matches the larger paper.
    if (sizeChanged) {
      this.lastPdfKey = '';
      this.needsPdfRender = true;
    }
  }
}
