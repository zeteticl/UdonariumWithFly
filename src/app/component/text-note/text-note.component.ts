import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Input, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TextNote } from '@udonarium/text-note';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { PeerCursor } from '@udonarium/peer-cursor';
@Component({
  selector: 'text-note',
  templateUrl: './text-note.component.html',
  styleUrls: ['./text-note.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TextNoteComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('textArea', { static: true }) textAreaElementRef: ElementRef;

  @Input() textNote: TextNote = null;
  @Input() is3D: boolean = false;

  get title(): string { return this.textNote.title; }
  get text(): string { this.calcFitHeightIfNeeded(); return this.textNote.text; }
  set text(text: string) { this.calcFitHeightIfNeeded(); this.textNote.text = text; }
  get fontSize(): number { this.calcFitHeightIfNeeded(); return this.textNote.fontSize; }
  get imageFile(): ImageFile { return this.textNote.imageFile; }
  get rotate(): number { return this.textNote.rotate; }
  set rotate(rotate: number) { this.textNote.rotate = rotate; }
  get height(): number { return this.adjustMinBounds(this.textNote.height); }
  get width(): number { return this.adjustMinBounds(this.textNote.width); }


  get GM(): string { return this.textNote.GM; }
  set GM(GM: string) { this.textNote.GM = GM; }
  get isMine(): boolean { return this.textNote.isMine; }
  get hasGM(): boolean { return this.textNote.hasGM; }
  get isDisabled(): boolean {
    if (this.textNote.location.name == 'common') return true
    else
      return this.textNote.isDisabled;
  }


  //STORE
  get location(): string { return this.textNote.location.name; }
  set location(location: string) { this.textNote.location.name = location; }


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

  get isUpright(): boolean { return this.textNote.isUpright; }
  set isUpright(isUpright: boolean) { this.textNote.isUpright = isUpright; }

  get isAltitudeIndicate(): boolean { return this.textNote.isAltitudeIndicate; }
  set isAltitudeIndicate(isAltitudeIndicate: boolean) { this.textNote.isAltitudeIndicate = isAltitudeIndicate; }

  get isLocked(): boolean { return this.textNote.isLocked; }
  set isLocked(isLocked: boolean) { this.textNote.isLocked = isLocked; }

  get isSelected(): boolean { return document.activeElement === this.textAreaElementRef.nativeElement; }

  private callbackOnMouseUp = (e) => this.onMouseUp(e);

  gridSize: number = 50;
  math = Math;

  private calcFitHeightTimer: NodeJS.Timer = null;

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  constructor(
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService
  ) { }

  viewRotateZ = 10;

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.textNote || !object) return;
        if (this.textNote === object || (object instanceof ObjectNode && this.textNote.contains(object))) {
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
      tabletopObject: this.textNote,
      transformCssOffset: 'translateZ(0.15px)',
      colideLayers: ['terrain']
    };
    this.rotableOption = {
      tabletopObject: this.textNote
    };
  }

  ngAfterViewInit() { }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: any) {
    if (this.isSelected) return;
    if (this.GuestMode()) return;
    e.preventDefault();
    this.textNote.toTopmost();

    // TODO:もっと良い方法考える
    if (e.button === 2) {
      EventSystem.trigger('DRAG_LOCKED_OBJECT', {});
      return;
    }

    this.addMouseEventListeners();
  }

  onMouseUp(e: any) {
    if (this.pointerDeviceService.isAllowedToOpenContextMenu) {
      let selection = window.getSelection();
      if (!selection.isCollapsed) selection.removeAllRanges();
      this.textAreaElementRef.nativeElement.focus();
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
    if (this.isSelected) return;
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    let position = this.pointerDeviceService.pointers[0];
    this.contextMenuService.open(position, [
      (this.isLocked
        ? {
          name: '☑ 固定', action: () => {
            this.isLocked = false;
            SoundEffect.play(PresetSound.unlock);
          }
        } : {
          name: '☐ 固定', action: () => {
            this.isLocked = true;
            SoundEffect.play(PresetSound.lock);
          }
        }),
      ContextMenuSeparator,
      (!this.isMine
        ? {
          name: 'GM圖層-只供自己看見', action: () => {
            this.GM = PeerCursor.myCursor.name;
            this.textNote.setLocation('table')
            SoundEffect.play(PresetSound.lock);
          }
        } : {
          name: '回到普通圖層', action: () => {
            this.GM = '';
            this.textNote.setLocation('table')
            SoundEffect.play(PresetSound.unlock);
          }
        }),
      ContextMenuSeparator,
      {
        name: '移動到共有倉庫', action: () => {
          this.textNote.setLocation('common')
        }
      },
      ContextMenuSeparator,
      (this.isUpright
        ? {
          name: '☑ 直立', action: () => {
            this.isUpright = false;
          }
        } : {
          name: '☐ 直立', action: () => {
            this.isUpright = true;
          }
        }),
      ContextMenuSeparator,
      (this.isAltitudeIndicate
        ? {
          name: '☑ 顯示高度', action: () => {
            this.isAltitudeIndicate = false;
          }
        } : {
          name: '☐ 顯示高度', action: () => {
            this.isAltitudeIndicate = true;
          }
        }),
      {
        name: '將高度設為0', action: () => {
          if (this.altitude != 0) {
            this.altitude = 0;
            SoundEffect.play(PresetSound.sweep);
          }
        },
        altitudeHande: this.textNote
      },
      ContextMenuSeparator,
      { name: 'メモを編集', action: () => { this.showDetail(this.textNote); } },
      (this.textNote.getUrls().length <= 0 ? null : {
        name: '打開參考網址', action: null,
        subActions: this.textNote.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => { this.modalService.open(OpenUrlComponent, { url: url, title: this.textNote.title, subTitle: urlElement.name }); },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? '網址無效' : null,
            materialIcon: 'open_in_new'
          };
        })
      }),
      (this.textNote.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: '製作副本', action: () => {
          let cloneObject = this.textNote.clone();
          cloneObject.isLocked = false;
          console.log('コピー', cloneObject);
          cloneObject.location.x += this.gridSize;
          cloneObject.location.y += this.gridSize;
          cloneObject.toTopmost();
          SoundEffect.play(PresetSound.cardPut);
        }
      },
      {
        name: '刪除', action: () => {
          this.textNote.destroy();
          SoundEffect.play(PresetSound.sweep);
        }
      },
    ], this.title);
  }

  onMove() {
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
  }

  calcFitHeightIfNeeded() {
    if (this.calcFitHeightTimer) return;
    this.ngZone.runOutsideAngular(() => {
      this.calcFitHeightTimer = setTimeout(() => {
        this.calcFitHeight();
        this.calcFitHeightTimer = null;
      }, 0);
    });
  }

  calcFitHeight() {
    let textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
    textArea.style.height = '0';
    if (textArea.scrollHeight > textArea.offsetHeight) {
      textArea.style.height = textArea.scrollHeight + 'px';
    }
  }

  private adjustMinBounds(value: number, min: number = 0): number {
    return value < min ? min : value;
  }

  private addMouseEventListeners() {
    document.body.addEventListener('mouseup', this.callbackOnMouseUp, false);
  }

  private removeMouseEventListeners() {
    document.body.removeEventListener('mouseup', this.callbackOnMouseUp, false);
  }
  GuestMode() {
    return Network.GuestMode();
  }

  public showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = '共有筆記設定';
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    let option: PanelOption = { title: title, left: coordinate.x - 350, top: coordinate.y - 200, width: 700, height: 400 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }
}
