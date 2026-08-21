/* 
Porting from Udonarium Lily
Copyright (c) 2020 entyu

MIT License
https://opensource.org/licenses/mit-license.php
*/
import {
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
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { LAYER_PEER_MOVABLE_Z_PX, layerPeerMovableTransform } from '@udonarium/tabletop-object-util';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { RangeSettingsComponent } from 'component/range-settings/range-settings.component';

import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { CoordinateService } from 'service/coordinate.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopActionService } from 'service/tabletop-action.service';

import { TabletopService } from 'service/tabletop.service';
import { GameCharacter } from '@udonarium/game-character';
import { RangeArea, RangeFollowTarget } from '@udonarium/range';
import { RangeRender, RangeRenderSetting, ClipAreaCorn, ClipAreaLine, ClipAreaSquare, ClipAreaDiamond} from './range-render'; // 注意：會存取其他元件資料夾來繪製格線
import { TableSelecter } from '@udonarium/table-selecter';
import { GameTable } from '@udonarium/game-table';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { ModalService } from 'service/modal.service';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';

@Component({
    selector: 'range',
    templateUrl: './range.component.html',
    styleUrls: ['./range.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RangeComponent implements OnChanges, OnDestroy, AfterViewInit {
  @Input() range: RangeArea = null;
  @Input() is3D: boolean = false;
//  @Input() rotateDeg : string = ''

  @ViewChild('gridCanvas', { static: true }) gridCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('rangeCanvas', { static: true }) rangeCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('centerPunch', { static: true }) centerPunch: ElementRef<HTMLCanvasElement>;
  @ViewChild('rotate') rotate: ElementRef<HTMLElement>;
  
  public get clipPathText() {
    let text = '';
    switch (this.range.type) {
      case 'LINE':
        text = this.clipLine;
        break;
      case 'CIRCLE':
        text = this.clipCircle;
        break;
      case 'SQUARE':
        text = this.clipSquare;
        break;
      case 'DIAMOND':
        text = this.clipDiamond;
        break;
      case 'CORN':
      default:
        text = this.clipCorn;
        break;
    }
    return text;
  }

  public get gripPathText() {
    let text = '';
    switch (this.range.type) {
      case 'LINE':
        text = this.gripLine;
        break;
      case 'CIRCLE':
        text = this.gripCircle;
        break;
      case 'SQUARE':
        text = this.gripSquare;
        break;
      case 'DIAMOND':
        text = this.gripDiamond;
        break;
      case 'CORN':
      default:
        text = this.gripCorn;
        break;
    }
    return text;
  }

  public get clipCircle() {
    let clipSize = ( this.rangeLength + 1.5 ) * this.gridSize;
    let circle = 'circle(' + clipSize + 'px)';
    return circle;
  }

  public get gripCircle() {
    return 'circle(' + ((this.rangeLength > 1 ? this.rangeLength : 1) * this.gridSize) + 'px)';
  }

  public get clipCorn() {
    return this.clipCornPath(this.clipAreaCorn);
  }
  public get gripCorn() {
    return this.clipCornPath(this.gripAreaCorn);
  }
  private clipCornPath(clipAreaCorn: ClipAreaCorn) {
    let clipCorn = 'polygon(' + clipAreaCorn.clip01x + 'px ' + clipAreaCorn.clip01y + 'px, ';
    clipCorn += clipAreaCorn.clip02x + 'px ' + clipAreaCorn.clip02y + 'px, ';
    clipCorn += clipAreaCorn.clip03x + 'px ' + clipAreaCorn.clip03y + 'px, ';
    clipCorn += clipAreaCorn.clip04x + 'px ' + clipAreaCorn.clip04y + 'px, ';
    clipCorn += clipAreaCorn.clip05x + 'px ' + clipAreaCorn.clip05y + 'px, ';
    clipCorn += clipAreaCorn.clip06x + 'px ' + clipAreaCorn.clip06y + 'px, ';
    clipCorn += clipAreaCorn.clip07x + 'px ' + clipAreaCorn.clip07y + 'px, ';
    clipCorn += clipAreaCorn.clip08x + 'px ' + clipAreaCorn.clip08y + 'px, ';
    clipCorn += clipAreaCorn.clip09x + 'px ' + clipAreaCorn.clip09y + 'px)';
    // return this.sanitizer.bypassSecurityTrustStyle(this._polygon);
    // console.log( 'clipCorn:' + clipCorn);
    return clipCorn;
  }

  public get clipLine() {
    return this.clipLinePath(this.clipAreaLine);
  }
  public get gripLine() {
    return this.clipLinePath(this.gripAreaLine);
  }
  private clipLinePath(clipAreaLine: ClipAreaLine) {
    let clipLine = 'polygon(' + clipAreaLine.clip01x + 'px ' + clipAreaLine.clip01y + 'px, ';
    clipLine += clipAreaLine.clip02x + 'px ' + clipAreaLine.clip02y + 'px, ';
    clipLine += clipAreaLine.clip03x + 'px ' + clipAreaLine.clip03y + 'px, ';
    clipLine += clipAreaLine.clip04x + 'px ' + clipAreaLine.clip04y + 'px)';
    return clipLine;
  }

  public get clipSquare() {
    return this.clipSquarePath(this.clipAreaSquare);
  }
  public get gripSquare() {
    return this.clipSquarePath(this.gripAreaSquare);
  }
  private clipSquarePath(clipAreaSquare: ClipAreaSquare) {
    let clipSquare = 'polygon(' + clipAreaSquare.clip01x + 'px ' + clipAreaSquare.clip01y + 'px, ';
    clipSquare += clipAreaSquare.clip02x + 'px ' + clipAreaSquare.clip02y + 'px, ';
    clipSquare += clipAreaSquare.clip03x + 'px ' + clipAreaSquare.clip03y + 'px, ';
    clipSquare += clipAreaSquare.clip04x + 'px ' + clipAreaSquare.clip04y + 'px)';
    return clipSquare;
  }

  public get clipDiamond() {
    return this.clipDiamondPath(this.clipAreaDiamond);
  }
  public get gripDiamond() {
    return this.clipDiamondPath(this.gripAreaDiamond);
  }
  private clipDiamondPath(clipAreaDiamond: ClipAreaDiamond) {
    let clipDiamond = 'polygon(' + clipAreaDiamond.clip01x + 'px ' + clipAreaDiamond.clip01y + 'px, ';
    clipDiamond += clipAreaDiamond.clip02x + 'px ' + clipAreaDiamond.clip02y + 'px, ';
    clipDiamond += clipAreaDiamond.clip03x + 'px ' + clipAreaDiamond.clip03y + 'px, ';
    clipDiamond += clipAreaDiamond.clip04x + 'px ' + clipAreaDiamond.clip04y + 'px)';
    return clipDiamond;
  }

  get gripLength() {
    return this.rangeLength > 1 ? this.rangeLength : 1;
  }

  get gripWidth() {
    if ((this.range.type == 'CIRCLE') || (this.range.type == 'SQUARE') || (this.range.type == 'DIAMOND')) {
      return this.gripLength;
    }
    return (this.range.width > this.gripLength) ? this.range.width : this.gripLength;
  }

  private clipAreaCorn: ClipAreaCorn = {
    clip01x: 0, // 根本始點
    clip01y: 0,
    clip02x: 100,
    clip02y: 0,
    clip03x: 100,
    clip03y: 100,
    clip04x: 0,
    clip04y: 100,
    clip05x: 0, // 先端部
    clip05y: 0,
    clip06x: 0, // 折返
    clip06y: 0,
    clip07x: 0,
    clip07y: 0,
    clip08x: 0,
    clip08y: 0,
    clip09x: 0,
    clip09y: 0,
  }
  private gripAreaCorn: ClipAreaCorn = {
    clip01x: 0, // 根本始點
    clip01y: 0,
    clip02x: 100,
    clip02y: 0,
    clip03x: 100,
    clip03y: 100,
    clip04x: 0,
    clip04y: 100,
    clip05x: 0, // 先端部
    clip05y: 0,
    clip06x: 0, // 折返
    clip06y: 0,
    clip07x: 0,
    clip07y: 0,
    clip08x: 0,
    clip08y: 0,
    clip09x: 0,
    clip09y: 0,
  }

  private clipAreaLine: ClipAreaLine = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }
  private gripAreaLine: ClipAreaLine = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }

  private clipAreaSquare: ClipAreaSquare = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }
  private gripAreaSquare: ClipAreaSquare = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }

  private clipAreaDiamond: ClipAreaDiamond = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }
  private gripAreaDiamond: ClipAreaDiamond = {
    clip01x: 0, // 左下
    clip01y: 0,
    clip02x: 0, // 左上
    clip02y: -50,
    clip03x: 100, // 右上
    clip03y: -50,
    clip04x: 100, // 右下
    clip04y: 0,
  }

  get tableSelecter(): TableSelecter { return this.tabletopService.tableSelecter; }
  get currentTable(): GameTable { return this.tabletopService.currentTable; }
  get is2DMode(): boolean { return !!this.currentTable?.is2DMode || !!this.tableSelecter?.viewTable?.is2DMode; }

  get name(): string { return this.range.name; }
  get width(): number { return this.adjustMinBounds(this.range.width); }
  get length(): number { return this.adjustMinBounds(this.range.length); }
  get opacity(): number { return this.range.opacity; }
  get imageFile(): ImageFile { return this.range.imageFile; }
  get isLocked(): boolean { return this.range.isLocked; }
  set isLocked(isLock: boolean) { this.range.mutateAppearance(() => { this.range.isLocked = isLock; }); }

  get selectionState(): SelectionState { return this.selectionService.state(this.range); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  get areaQuadrantSize(): number { 
    let w = this.width < 1 ? 1 : this.width;
    let l = this.rangeLength < 1 ? 1 : this.rangeLength;
    return Math.ceil( Math.sqrt(w * w + l * l) ) +1 ; 
  }

  get rotateDeg(): number { 
    let data2 = '0.0';
    if(!this.rotate){ return 0;}
    if(!this.rotate.nativeElement){ return 0;}
    if(!this.rotate.nativeElement.style){ return 0;}
    if(!this.rotate.nativeElement.style.transform){ return 0;}

    let data = this.rotate.nativeElement.style.transform;
    data2 = data.replace(/[^0-9\.\-]/g, '');
    if(!data2) data2 = '0.0';
    return parseFloat(data2);
  }

  get altitude(): number { return this.range.altitude; }
  set altitude(altitude: number) { this.range.altitude = altitude; }

  get elevation(): number {
    return +((this.range.posZ + (this.altitude * this.gridSize)) / this.gridSize).toFixed(1);
  }

  get isAltitudeIndicate(): boolean { return this.range.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) {
    this.range.mutateAppearance(() => { this.range.isAltitudeIndicate = isAltitudeIndicate; });
  }

  get textShadowCss(): string {
    let shadow = StringUtil.textShadowColor(this.range.rangeColor, '#f5f5f5');
    return `${shadow} 0px 0px 3px`;
  }

  get followingCharactor(): RangeFollowTarget { return this.range.followingCharactor; }
  set followingCharactor(followingCharactor: RangeFollowTarget) { this.range.followingCharactor = followingCharactor; }

  get isFollowed(): boolean {
    return this.followingCharactor 
      && this.followingCharactor.location.x <= this.range.location.x && this.range.location.x <= (this.followingCharactor.location.x + this.followingCharactor.size * this.gridSize)
      && this.followingCharactor.location.y <= this.range.location.y && this.range.location.y <= (this.followingCharactor.location.y + this.followingCharactor.size * this.gridSize)
      && (this.followingCharactor.altitude + this.followingCharactor.posZ - 0.5) <= (this.range.altitude + this.range.posZ) && (this.range.altitude + this.range.posZ) <= (this.followingCharactor.altitude + this.followingCharactor.posZ + 0.5)
  }

  get dockableCharacters(): RangeFollowTarget[] {
    let ary: RangeFollowTarget[] = this.tabletopService.characterTokens.filter(character => {
      if (!character.isVisibleOnTable || character.isHideIn) return false;
      return [
        {x: 0, y: 0},
        {x: character.size * this.gridSize, y: 0},
        {x: 0, y: character.size * this.gridSize},
        {x: character.size * this.gridSize, y: character.size * this.gridSize}
      ].some(point => {
        return (this.range.location.x - this.rangeLength * this.gridSize) <= character.location.x + point.x && character.location.x + point.x <= (this.range.location.x + this.rangeLength * this.gridSize)
        && (this.range.location.y - this.rangeLength * this.gridSize) <= character.location.y  + point.y && character.location.y + point.y <= (this.range.location.y + this.rangeLength * this.gridSize);
      });
    });
    if (this.followingCharactor && !ary.some(character => character === this.followingCharactor)) ary.push(this.followingCharactor);
    return ary.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }
  
  get rangeLength() {
    let length = (this.length < 1 ? 1 : this.length);
    if (this.followingCharactor && this.range.isExpandByFollowing) length += this.followingCharactor.size / 2;
    return length;
  }

  get rotateHandlesLeftPos(): number[] {
    let ret: number[] = [];
    for (let i = 1; i < Math.ceil((this.rangeLength) / 6); i++) {
      ret.push(this.rangeLength * i / Math.ceil((this.rangeLength) / 6));
    }
    ret.push(this.rangeLength);
    //console.log(ret)
    return ret;
  }

  gridSize: number = 50;
  
  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};
  
  viewRotateZ = 10;
  isMoving = false;
  math = Math;

  private input: InputHandler = null;

  get isInverse(): boolean {
    const rotate = Math.abs(this.viewRotateZ + this.rotateDeg) % 360;
    return 90 < rotate && rotate < 270
  }
  
  constructor(
    private ngZone: NgZone,
    private tabletopActionService: TabletopActionService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private coordinateService: CoordinateService,
    private selectionService: TabletopSelectionService,
    private tabletopService: TabletopService,
    private modalService: ModalService,
    private i18n: I18nService
  ) { }

  ngOnChanges() {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        //this.setRange();
        if (!this.range || !object) return;
        let markForCheck = false;
        if (this.range === object || ((object instanceof ObjectNode && this.range.contains(object)))) {
          this.ngZone.run(() => {
            //if (this.range.followingCharctor) this.range.following();
            this.setRange();
          });
          markForCheck = true;
        }
        if (this.followingCharactor) {
          if (object.identifier === this.followingCharactor.identifier) {
            //console.log('追従動作');
            this.ngZone.run(() => {
              this.range.following();
              this.setRange();
            });
            markForCheck = true;
          } else if (object instanceof ObjectNode && this.followingCharactor instanceof GameCharacter) {
            if (this.followingCharactor.contains(object)) {
              this.ngZone.run(() => {
                this.range.following();
                this.setRange();
              });
              markForCheck = true;
            }
          }
        }
        if (markForCheck) this.changeDetector.markForCheck();
      })
      .on(`UPDATE_SELECTION/identifier/${this.range?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', -1000, event => {
        this.changeDetector.markForCheck();
      }).on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      });
    this.movableOption = {
      tabletopObject: this.range,
      transformCssOffset: layerPeerMovableTransform(),
      colideLayers: ['terrain', 'text-note']
    };
    this.rotableOption = {
      tabletopObject: this.range
    };
    this.setRange();
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
    this.setRange();
    queueMicrotask(() =>{
      this.changeDetector.markForCheck();
    });
  }

  ngOnDestroy() {
    this.input.destroy();
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: any) {
    this.input.cancel();
    this.range.toTopmost();
    // TODO: 想更好的做法
    if (this.isLocked) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', {});
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    this.tabletopActionService.ensureObjectSelected(this.range);
    let menuPosition = this.pointerDeviceService.pointers[0];
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();

    let menuArray = [];
    menuArray.push(...this.tabletopActionService.makeClipboardMenuActions());
    if (menuArray.length) menuArray.push(ContextMenuSeparator);

    if (this.selectionService.objects.length) {
      menuArray.push({ name: this.i18n.t('range.menu.1'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) });
      menuArray.push(ContextMenuSeparator);
    }

    menuArray.push(contextMenuToggleCheck({
      get: () => this.isLocked,
      set: (v) => {
        this.isLocked = v;
        SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
      },
      on: this.i18n.t('range.menu.2'),
      off: this.i18n.t('range.menu.3'),
      hotkey: 'L',
    }));
    menuArray.push(
      {
        name: this.i18n.t('range.menu.4'), action: null, 
        subActions: [
          { name: `${this.range.fillType == 0 ? '◉' : '○'} ${this.i18n.t('range.dynamic.1')}`, action: () => { this.range.fillType = 0; }, checkBox: 'radio' },
          ContextMenuSeparator,
          { name: `${this.range.fillType == 1 ? '◉' : '○'} ${this.i18n.t('range.dynamic.2')}`, action: () => { this.range.fillType = 1; }, checkBox: 'radio' },
          { name: `${this.range.fillType == 2 ? '◉' : '○'} ${this.i18n.t('range.dynamic.3')}`, action: () => { this.range.fillType = 2; }, checkBox: 'radio' },
          { name: `${this.range.fillType == 3 ? '◉' : '○'} ${this.i18n.t('range.dynamic.4')}`, action: () => { this.range.fillType = 3; }, checkBox: 'radio' },
          { name: `${this.range.fillType == 4 ? '◉' : '○'} ${this.i18n.t('range.dynamic.5')}`, action: () => { this.range.fillType = 4; }, checkBox: 'radio' },
        ]
      }
    );
    menuArray.push(ContextMenuSeparator);

    if (this.range.type == 'CIRCLE' || this.range.type == 'SQUARE' || this.range.type == 'DIAMOND') {
      let menu: ContextMenuAction[] = this.dockableCharacters.length <= 0
        ? this.followingCharactor ? [] : [{ name: this.i18n.t('range.menu.5'), action: null, disabled: true, center: true }] 
        : this.dockableCharacters.map(character => {
          return {
            name: `${this.followingCharactor && this.followingCharactor.identifier === character.identifier ? '◉' : '○'} ${character.name}`,
            action: () => {
              this.followingCharactor = character;
              this.ngZone.run(() => {
                this.range.following();
                //this.setRange();
              });
              SoundEffect.play(PresetSound.lock);
            },
            checkBox: 'radio'
          };
        });
      //if (this.followingCharactor) {
        if (menu.length != 0) menu.push(ContextMenuSeparator);
        menu.push({
            name: this.i18n.t('range.menu.6'), action: () => {
              SoundEffect.play(PresetSound.unlock);
              this.followingCharactor = null;
            },
            disabled: !this.followingCharactor
          });
      //}
      menuArray.push({
          name: this.i18n.t('range.menu.7'), action: null, 
          subActions: menu
        });
      menuArray.push(contextMenuToggleCheck({
        get: () => this.range.isExpandByFollowing,
        set: (v) => { this.range.isExpandByFollowing = v; },
        on: this.i18n.t('range.menu.8'),
        off: this.i18n.t('range.menu.9'),
      }));
      if (!this.is2DMode) {
        menuArray.push(contextMenuToggleCheck({
          get: () => this.range.isFollowAltitude,
          set: (v) => {
            this.range.isFollowAltitude = v;
            if (v && this.followingCharactor) this.range.following();
          },
          on: this.i18n.t('range.menu.10'),
          off: this.i18n.t('range.menu.11'),
        }));
      }
    } else {
      menuArray.push(contextMenuToggleCheck({
        get: () => this.range.subDivisionSnapPolygonal,
        set: (v) => { this.range.subDivisionSnapPolygonal = v; },
        on: this.i18n.t('range.menu.12'),
        off: this.i18n.t('range.menu.13'),
      }));
    }
    menuArray.push(ContextMenuSeparator);
    menuArray.push(
      {
        name: this.i18n.t('range.menu.14'), action: null,
        subActions: [
          contextMenuToggleCheck({
            get: () => this.range.offSetX,
            set: (v) => { this.range.offSetX = v; },
            on: this.i18n.t('range.menu.15'),
            off: this.i18n.t('range.menu.16'),
          }),
          contextMenuToggleCheck({
            get: () => this.range.offSetY,
            set: (v) => { this.range.offSetY = v; },
            on: this.i18n.t('range.menu.25'),
            off: this.i18n.t('range.menu.26'),
          }),
        ],
        disabled: this.range.fillType == 0
      }
    );
    if (!this.is2DMode) {
      menuArray.push(contextMenuToggleCheck({
        get: () => this.isAltitudeIndicate,
        set: (v) => { this.isAltitudeIndicate = v; },
        on: this.i18n.t('range.menu.17'),
        off: this.i18n.t('range.menu.18'),
      }));
      menuArray.push({
        name: this.i18n.t('range.menu.19'), action: () => {
          if (this.altitude != 0) {
            this.altitude = 0;
            SoundEffect.play(PresetSound.sweep);
          }
        },
        altitudeHande: this.range
      });
    }
    menuArray.push(ContextMenuSeparator);
    menuArray.push(
      { name: this.i18n.t('range.menu.20'), action: () => { this.showDetail(this.range); } }
    );
    if (this.range.getUrls().length > 0) {
      menuArray.push(
        {
          name: this.i18n.t('range.menu.21'), action: null,
          subActions: this.range.getUrls().map((urlElement) => {
            const url = urlElement.value.toString();
            return {
              name: urlElement.name ? urlElement.name : url,
              action: () => {
                if (StringUtil.sameOrigin(url)) {
                  window.open(url.trim(), '_blank', 'noopener');
                } else {
                  this.modalService.open(OpenUrlComponent, { url: url, title: this.range.name, subTitle: urlElement.name });
                } 
              },
              disabled: !StringUtil.validUrl(url),
              error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
              isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
            };
          })
        }
      );
      menuArray.push(ContextMenuSeparator);
    }
    menuArray.push(
      {
        name: this.i18n.t('range.menu.23'), action: () => {
          this.range.destroy();
          SoundEffect.play(PresetSound.sweep);
        },
        hotkey: 'Del',
      }
    );
    menuArray.push( ContextMenuSeparator );
    menuArray.push(
      { name: this.i18n.t('range.menu.24'), action: null, subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition) }
    );

    this.contextMenuService.open(menuPosition, menuArray, this.name);
  }

/*
  dockingWindowOpen() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 350, height: 200 };
    option.title = this.i18n.t('range.followTitle');
    let component = this.panelService.open<RangeDockingCharacterComponent>(RangeDockingCharacterComponent, option);
    component.tabletopObject = <RangeArea>this.range;
  }
*/

  onMove() {
    this.isMoving = true;
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    this.isMoving = false;
    SoundEffect.play(PresetSound.cardPut);
  }

  private adjustMinBounds(value: number, min: number = 0): number {
    return value < min ? min : value;
  }

  onDoubleClick(e: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e.stopPropagation();
    this.showDetail(this.range);
  }

  private showDetail(gameObject: RangeArea) {
    let title = this.i18n.t('range.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 210, top: coordinate.y - 180, width: 420, height: 400,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<RangeSettingsComponent>(RangeSettingsComponent, option);
    component.range = gameObject;
  }

  private setRange() {
    let render = new RangeRender(this.gridCanvas.nativeElement,this.rangeCanvas.nativeElement, this.centerPunch.nativeElement);

//    this.width, this.length, this.gridSize, this.currentTable.gridType, this.currentTable.gridColor

    let setting: RangeRenderSetting = {
      areaWidth: this.areaQuadrantSize * 2,
      areaHeight: this.areaQuadrantSize * 2,
      range: this.rangeLength,
      width: this.width < 0.1 ? 0.1 : this.width,
      centerX: this.range.location.x,
      centerY: this.range.location.y,
      gridSize: this.gridSize,
      type: this.range.type,
      gridColor: this.range.gridColor,
      rangeColor: this.range.rangeColor,
      fanDegree: 0.0,
      degree: this.rotateDeg,
      offSetX: this.range.offSetX,
      offSetY: this.range.offSetY,
      //fillOutLine: this.range.fillOutLine,
      gridType: this.currentTable.gridType,
      isDocking: this.followingCharactor ? true : false,
      fillType: this.range.fillType
    };
    //console.log('this.range.location.x-y:' + this.range.location.x + ' ' + this.range.location.y);

    switch (this.range.type) {
      case 'LINE':
        this.clipAreaLine = render.renderLine(setting);
        this.gripAreaLine = RangeRender.gripAreaPathLine(setting);
        break;
      case 'CIRCLE':
        render.renderCircle(setting);
        break;
      case 'SQUARE':
        this.clipAreaSquare = render.renderSquare(setting);
        this.gripAreaSquare = RangeRender.gripAreaPathSquare(setting);
        break;
      case 'DIAMOND':
        this.clipAreaDiamond = render.renderDiamond(setting);
        this.gripAreaDiamond = RangeRender.gripAreaPathDiamond(setting);
        break;
      case 'CORN':
      default:
        this.clipAreaCorn = render.renderCorn(setting);
        this.gripAreaCorn = RangeRender.gripAreaPathCorn(setting);
        break;
    }

    let opacity: number = this.range.opacity;
    this.gridCanvas.nativeElement.style.opacity = opacity + '';

  }

}
