import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { GameTableMask } from '@udonarium/game-table-mask';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { ModalService } from 'service/modal.service';
import { CoordinateService } from 'service/coordinate.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatMessageService } from 'service/chat-message.service';

@Component({
  selector: 'game-table-mask',
  templateUrl: './game-table-mask.component.html',
  styleUrls: ['./game-table-mask.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GameTableMaskComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() gameTableMask: GameTableMask = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.gameTableMask.name; }
  get width(): number { return this.adjustMinBounds(this.gameTableMask.width); }
  get height(): number { return this.adjustMinBounds(this.gameTableMask.height); }
  get opacity(): number { return this.gameTableMask.opacity; }
  get imageFile(): ImageFile { return this.gameTableMask.imageFile; }
  get isLock(): boolean { return this.gameTableMask.isLock; }
  set isLock(isLock: boolean) { this.gameTableMask.isLock = isLock; }
  get GM(): string { return this.gameTableMask.GM; }
  set GM(GM: string) { this.gameTableMask.GM = GM; }
  get isMine(): boolean { return this.gameTableMask.isMine; }
  get hasGM(): boolean { return this.gameTableMask.hasGM; }
  get isDisabled(): boolean {
    return this.gameTableMask.isDisabled;
  }

  get blendType(): number { return this.gameTableMask.blendType; }
  set blendType(blendType: number) { this.gameTableMask.blendType = blendType; }

  get fontSize(): number { return this.gameTableMask.fontsize; }
  set fontSize(fontSize: number) { this.gameTableMask.fontsize = fontSize; }
  get text(): string { return this.gameTableMask.text; }
  set text(text: string) { this.gameTableMask.text = text; }
  get color(): string { return this.gameTableMask.color; }
  set color(color: string) { this.gameTableMask.color = color; }
  get bgcolor(): string { return this.gameTableMask.bgcolor; }
  set bgcolor(bgcolor: string) { this.gameTableMask.bgcolor = bgcolor; }

  get altitude(): number { return this.gameTableMask.altitude; }
  set altitude(altitude: number) { this.gameTableMask.altitude = altitude; }

  get isAltitudeIndicate(): boolean { return this.gameTableMask.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) { this.gameTableMask.isAltitudeIndicate = isAltitudeIndicate; }

  get gameTableMaskAltitude(): number {
    return +this.altitude.toFixed(1);
  }

  gridSize: number = 50;
  math = Math;
  viewRotateZ = 10;

  movableOption: MovableOption = {};

  private input: InputHandler = null;

  constructor(
    private ngZone: NgZone,
    private tabletopActionService: TabletopActionService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private coordinateService: CoordinateService,
    //private chatMessageService: ChatMessageService
  ) { }
  GuestMode() {
    return Network.GuestMode();
  }
  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.gameTableMask || !object) return;
        if (this.gameTableMask === object || (object instanceof ObjectNode && this.gameTableMask.contains(object) || (object instanceof PeerCursor && object.peerId === this.gameTableMask.GM))) {
          this.changeDetector.markForCheck();
        }
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', -1000, event => {
        this.changeDetector.markForCheck();
      })
      .on<object>('TABLE_VIEW_ROTATE', -1000, event => {
        this.ngZone.run(() => {
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      });
    this.movableOption = {
      tabletopObject: this.gameTableMask,
      transformCssOffset: 'translateZ(0.15px)',
      colideLayers: ['terrain']
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = this.onInputStart.bind(this);
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

    // TODO:もっと良い方法考える
    if (this.isLock) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', {});
    }
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    let menuPosition = this.pointerDeviceService.pointers[0];
    let objectPosition = this.coordinateService.calcTabletopLocalCoordinate();
    this.contextMenuService.open(menuPosition, [
      (this.isLock
        ? {
          name: '☑ 固定', action: () => {
            this.isLock = false;
            //this.chatMessageService.sendOperationLog(`${this.gameTableMask.name} の固定を解除した`);
            SoundEffect.play(PresetSound.unlock);
          }
        }
        : {
          name: '☐ 固定', action: () => {
            this.isLock = true;
            SoundEffect.play(PresetSound.lock);
          }
        }
      ), ContextMenuSeparator,
      (!this.isMine
        ? {
          name: '☑ GM圖層-只供自己看見', action: () => {
            this.GM = PeerCursor.myCursor.name;
            this.gameTableMask.setLocation('table')
            SoundEffect.play(PresetSound.lock);
          }
        } : {
          name: '☐ 回到普通圖層', action: () => {
            this.GM = '';
            this.gameTableMask.setLocation('table')
            SoundEffect.play(PresetSound.unlock);
          }
        }),
      {
        name: '圖片和顏色',
        subActions: [
          { name: `${this.blendType == 0 ? '◉' : '○'} 僅限圖片`, action: () => { this.blendType = 0; SoundEffect.play(PresetSound.cardDraw) } },
          { name: `${this.blendType == 1 ? '◉' : '○'} 與背景顏色進行疊加`, action: () => { this.blendType = 1; SoundEffect.play(PresetSound.cardDraw) } },
          { name: `${this.blendType == 2 ? '◉' : '○'} 與背景顏色進行混合`, action: () => { this.blendType = 2; SoundEffect.play(PresetSound.cardDraw) } },
          ContextMenuSeparator,
          { name: '重置顏色', action: () => { this.color = '#555555'; this.bgcolor = '#0a0a0a'; SoundEffect.play(PresetSound.cardDraw) } }
        ]
      },
      ContextMenuSeparator,
      (this.isAltitudeIndicate
        ? {
          name: '☑ 高度の表示', action: () => {
            this.isAltitudeIndicate = false;
          }
        } : {
          name: '☐ 高度の表示', action: () => {
            this.isAltitudeIndicate = true;
          }
        }),
      {
        name: '將高度設定為0', action: () => {
          if (this.altitude != 0) {
            this.altitude = 0;
            SoundEffect.play(PresetSound.sweep);
          }
        },
        altitudeHande: this.gameTableMask
      },
      ContextMenuSeparator,
      { name: '編輯地圖Mask', action: () => { this.showDetail(this.gameTableMask); } },
      (this.gameTableMask.getUrls().length <= 0 ? null : {
        name: '打開參考網址', action: null,
        subActions: this.gameTableMask.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.gameTableMask.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? '網址無效' : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.gameTableMask.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: '製作副本', action: () => {
          let cloneObject = this.gameTableMask.clone();
          //console.log('Copy', cloneObject);
          cloneObject.location.x += this.gridSize;
          cloneObject.location.y += this.gridSize;
          cloneObject.isLock = false;
          if (this.gameTableMask.parent) this.gameTableMask.parent.appendChild(cloneObject);
          SoundEffect.play(PresetSound.cardPut);
        }
      },
      {
        name: '刪除', action: () => {
          //this.chatMessageService.sendOperationLog(`${this.gameTableMask.name} を削除した`);
          this.gameTableMask.destroy();
          SoundEffect.play(PresetSound.sweep);
        }
      },
      ContextMenuSeparator,
      { name: '新增物件', action: null, subActions: this.tabletopActionService.makeDefaultContextMenuActions(objectPosition) }
    ], this.name);
  }

  onMove() {
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
  }

  private adjustMinBounds(value: number, min: number = 0): number {
    return value < min ? min : value;
  }

  public showDetail(gameObject: GameTableMask) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = '地圖Mask設置';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 200, top: coordinate.y - 150, width: 400, height: 560 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }
}
