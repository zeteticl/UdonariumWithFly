import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { DataElement } from '@udonarium/data-element';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { stringifyCcfoliaClipboard } from '@udonarium/ccfolia-clipboard';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';

import { UUID } from '@udonarium/core/system/util/uuid';
import { CardStack } from '@udonarium/card-stack';
import { Card } from '@udonarium/card';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { GameCharacter } from '@udonarium/game-character';
import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { PointerDeviceService } from 'service/pointer-device.service';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { RangeArea } from '@udonarium/range';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { imageEffectFilter, imageEffectOpacity, imageEffectTransform } from '@udonarium/table-fx/image-effect';

@Component({
    selector: 'game-character-sheet',
    templateUrl: './game-character-sheet.component.html',
    styleUrls: ['../shared/settings-ui.css', './game-character-sheet.component.css'],
    animations: [
        trigger('switchImage', [
            transition(':increment, :decrement', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)' }),
                    style({ transform: 'scale3d(0, 1.2, 1.2)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('showcase', [
            transition(':increment, :decrement', [
                animate('200ms 200ms ease-in', keyframes([
                    style({ transform: 'scale3d(0, 1.0, 1.0)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ])
        ]),
        trigger('showcaseItem', [
            transition(':enter', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)' }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' })
                ]))
            ]),
            transition(':leave', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)' }),
                    style({ transform: 'scale3d(0, 0, 0)' })
                ]))
            ]),
        ]),
        trigger('bounceInOut', [
            transition('void => *', [
                animate('600ms ease', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
                    style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
            ])
        ]),
    ],
    standalone: false
})
export class GameCharacterSheetComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mainImage', { static: false }) mainImageElement: ElementRef;

  private _tabletopObject: TabletopObject = null;
  @Input()
  get tabletopObject(): TabletopObject { return this._tabletopObject; }
  set tabletopObject(value: TabletopObject) {
    this._tabletopObject = value;
    this.bindSheetGeometry();
  }
  isEdit: boolean = false;

  networkService = Network;
  MAX_IMAGE_ICON_COUNT = 8;

  isSaveing: boolean = false;
  progresPercent: number = 0;

  gridSize = 50;
  naturalWidth = 0;
  naturalHeight = 0;

  mainImageWidth = 0;
  mainImageHeight = 0;

  constructor(
    private saveDataService: SaveDataService,
    private panelService: PanelService,
    private modalService: ModalService,
    private pointerDeviceService: PointerDeviceService,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService
  ) { }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.tabletopObject && this.tabletopObject.identifier === event.data.identifier) {
          this.panelService.close();
        }
      })
      .on('UPDATE_GAME_OBJECT', -1000, event => {
        if (this.tabletopObject && this.tabletopObject.identifier === event.data.identifier) {
          this.updatePanelTitle();
        }
      })
      .on('LOCALE_CHANGED', () => this.updatePanelTitle());
  }

  ngAfterViewInit() {
    queueMicrotask(() => {
      const title = (this.tabletopObject instanceof Card && !this.tabletopObject.isFront)
        ? this.i18n.t('sheet.title.card', { name: this.i18n.t('sheet.cardBack') })
        : this.panelService.title;
      this.chatMessageService.sendOperationLog(this.i18n.t('sheet.logOpened', { title }));
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  /** Remember / restore detail-sheet size by object type (character, card, note, …). */
  private bindSheetGeometry() {
    if (!this._tabletopObject) return;
    const key = PanelService.sheetGeometryKey(this._tabletopObject.aliasName);
    this.panelService.geometryKey = key;
    const g = PanelService.getGeometry(key);
    if (g && g.width >= 100 && g.height >= 100) {
      this.panelService.width = g.width;
      this.panelService.height = g.height;
    }
  }

  toggleEditMode() {
    this.isEdit = this.isEdit ? false : true;
  }

  addDataElement() {
    if (this.tabletopObject.detailDataElement) {
      let title = DataElement.create(this.i18n.t('sheet.data.title'), '', {});
      let tag = DataElement.create(this.i18n.t('sheet.data.tag'), '', {});
      title.appendChild(tag);
      this.tabletopObject.detailDataElement.appendChild(title);
    }
  }

  get tabletopObjectName(): string {
    if (!this.tabletopObject?.commonDataElement) return '';
    let element = this.tabletopObject.commonDataElement.getFirstElementByName('name') || this.tabletopObject.commonDataElement.getFirstElementByName('title');
    return element ? <string>element.value : '';
  }

  get imageFile(): ImageFile {
    const tabletopObject = this.tabletopObject;
    if (!tabletopObject) return ImageFile.Empty;
    if (tabletopObject instanceof Card && this.isVisible) return tabletopObject.frontImage;
    return tabletopObject.imageFile;
  }

  get descriptionType(): string {
    if (!this.tabletopObject) return '';
    if (this.tabletopObject instanceof RangeArea && !this.tabletopObject.isApplyWidth) return 'range-not-width';
    return this.tabletopObject.aliasName;
  }

  get isAllowsChat(): boolean {
    if (!(this.tabletopObject instanceof GameCharacter) || !this.tabletopObject.isAllowsChat) return false;
    switch (this.tabletopObject.location.name) {
      case 'table':
      case PeerCursor.myCursor.peerId:
        return true;
      case 'graveyard':
        return false;
      default:
        for (const peer of Network.peers) {
          if (peer.isOpen && this.tabletopObject.location.name === peer.peerId) {
            return false;
          }
        }
        return true;
    }
  }

  async saveToXML() {
    if (!this.tabletopObject || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    //let element = this.tabletopObject.commonDataElement.getFirstElementByName('name') || this.tabletopObject.commonDataElement.getFirstElementByName('title');
    //let objectName: string = element ? <string>element.value : '';
    const objectName = ((this.tabletopObject instanceof Card && !this.tabletopObject.isFront) ? this.i18n.t('sheet.cardBack') : this.tabletopObjectName);

    await this.saveDataService.saveGameObjectAsync(this.tabletopObject, 'fly_xml_' + objectName, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  importXml() {
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  /** Export CCFOLIA Clipboard API JSON (download + system clipboard). */
  async exportCcfoliaJson() {
    if (!(this.tabletopObject instanceof GameCharacter)) return;
    const json = stringifyCcfoliaClipboard(this.tabletopObject);
    const safeName = (this.tabletopObjectName || 'character').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hktrpg_${safeName}_${this.formatExportTimestamp()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Download already succeeded; clipboard may be denied without focus/permission.
    }
  }

  /** `YYYY-MM-DD_HHmm` for export filenames. */
  private formatExportTimestamp(date: Date = new Date()): string {
    const pad = (n: number) => ('00' + n).slice(-2);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  setLocation(locationName: string) {
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.tabletopObject.identifier });
    if (locationName == 'graveyard') {
      SoundEffect.play(PresetSound.sweep);
    } else {
      SoundEffect.play(PresetSound.piecePut);
    }
    this.tabletopObject.setLocation(locationName);
  }

  openModal(name: string = '', isAllowedEmpty: boolean = false) {
    let currentImageIdentifires: string[] = [];
    if (name == 'shadowImageIdentifier') {
      const element = this.tabletopObject.imageElement;
      if (element && element.value != 'null' && element.currentValue) currentImageIdentifires = [element.currentValue + ''];
    } else {
      const elements = this.tabletopObject.imageDataElement.getElementsByName(name);
      if (elements && elements.length > 0) currentImageIdentifires = elements.map(element => element.value + '');
    }
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: isAllowedEmpty, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.tabletopObject || !this.tabletopObject.imageDataElement || !value) return;
      if (name == 'shadowImageIdentifier') {
        // 陰影以主圖的 currentValue 為準
        const element = this.tabletopObject.imageElement;
        if (element) {
          if (element.value != 'null') element.currentValue = value;
          // 清除過去處理留下的垃圾資料
          const garbages = this.tabletopObject.imageDataElement.getElementsByName('shadowImageIdentifier');
          for (const garbage of garbages) {
            this.tabletopObject.imageDataElement.removeChild(garbage);
          }
        }
      } else if (name === 'faceIcon') {
        // faceIcon 特殊處理（TODO：分離）
        let elements = this.tabletopObject.imageDataElement.getElementsByName(name);
        if (elements.length >= this.MAX_IMAGE_ICON_COUNT) {
          for (let i = this.MAX_IMAGE_ICON_COUNT; i < elements.length; i++) {
            this.deleteIcon(i);
          }
          elements[this.MAX_IMAGE_ICON_COUNT - 1].value = value;
        } else {
          this.tabletopObject.imageDataElement.appendChild(DataElement.create(name, value, { type: 'image' }, name + UUID.generateUuid()));
        }
        if (this.tabletopObject.currntIconIndex < 0) this.tabletopObject.currntIconIndex = 0;
      } else {
        let element = this.tabletopObject.imageDataElement.getFirstElementByName(name);
        if (element) {
          element.value = value;
        } else {
          return;
        }
      }
    });
    //EventSystem.trigger('UPDATE_GAME_OBJECT', this.tabletopObject);
  }

  openModalAddImage() {
    let currentImageIdentifires: string[] = [];
    const elements = this.tabletopObject.imageDataElement.getElementsByName('imageIdentifier');
    if (elements.length > 0) {
      currentImageIdentifires = elements.map(element => element.value + '');
    }
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.tabletopObject || !this.tabletopObject.imageDataElement || !value) return;
      let elements = this.tabletopObject.imageDataElement.getElementsByName('imageIdentifier');
      if (elements.length >= this.MAX_IMAGE_ICON_COUNT) {
        for (let i = this.MAX_IMAGE_ICON_COUNT; i < elements.length; i++) {
          this.deleteImage(i);
        }
        elements[this.MAX_IMAGE_ICON_COUNT - 1].value = value;
      } else {
        this.tabletopObject.imageDataElement.appendChild(DataElement.create('imageIdentifier', value, { type: 'image' }, name + UUID.generateUuid()));
      }
      if (this.tabletopObject.currntImageIndex < 0) this.tabletopObject.currntImageIndex = 0;
    });
  }

  openModalReplaceImage(isAllowedEmpty: boolean = false) {
    let currentImageIdentifires: string[] = [];
    const elements = this.tabletopObject.imageDataElement.getElementsByName('imageIdentifier');
    if (elements.length > 0) {
      currentImageIdentifires = elements.map(element => element.value + '');
    }
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: isAllowedEmpty, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.tabletopObject || !this.tabletopObject.imageDataElement || !value) return;
      if (value == 'null') {
        // 刪除
        if (this.tabletopObject.imageElement && this.tabletopObject.imageFiles.length == 1) {
          // 為相容性保留一個
          this.tabletopObject.imageElement.value = value;
          this.tabletopObject.imageElement.currentValue = value;
        } else {
          this.deleteImage(this.tabletopObject.currntImageIndex);
        }
      } else if (this.tabletopObject.imageElement) {
        this.tabletopObject.imageElement.value = value;
      }
    });
  }

  openModalChangeAllCardImages() {
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: false }).then(value => {
      if (!this.tabletopObject || !this.tabletopObject || !(this.tabletopObject instanceof CardStack) || !value) return;
      this.tabletopObject.cards.forEach(card => {
        let element = card.imageDataElement.getFirstElementByName('back');
        if (element) {
          element.value = value;
        } else {
          return;
        }
      });
    });
  }

  // TODO: 索引也應抽象化以通用化
  selectImage(index: number, name='imageIdentifier') {
    if (this.tabletopObject.currntImageIndex == index) return;
    this.tabletopObject.mutateAppearance(() => { this.tabletopObject.currntImageIndex = index; });
    SoundEffect.play(PresetSound.surprise);
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  selectIcon(index: number) {
    if (this.tabletopObject.currntIconIndex == index) return;
    this.tabletopObject.mutateAppearance(() => { this.tabletopObject.currntIconIndex = index; });
  }

  deleteImage(index: number=0, name='imageIdentifier') {
    if (!this.tabletopObject || !this.tabletopObject.imageDataElement) return;
    let elements = this.tabletopObject.imageDataElement.getElementsByName(name);
    // TODO: 索引也應抽象化以通用化
    if (elements && 0 < elements.length && index < elements.length) {
      if (this.tabletopObject.currntImageIndex > index) this.tabletopObject.currntImageIndex -= 1;
      this.tabletopObject.imageDataElement.removeChild(elements[index]);
      if (this.tabletopObject.currntImageIndex >= elements.length - 1) this.tabletopObject.currntImageIndex =  elements.length - 2;
      if (this.tabletopObject.currntImageIndex < 0) this.tabletopObject.currntImageIndex = 0;
    }
    //EventSystem.trigger('UPDATE_GAME_OBJECT', this.tabletopObject);
  }

  deleteIcon(index: number=0, imageIdentifier='') {
    if (!this.tabletopObject || !this.tabletopObject.imageDataElement) return;
    let elements = this.tabletopObject.imageDataElement.getElementsByName('faceIcon');
    //console.log(elements[index].value  + ' : ' + imageIdentifier);
    if (elements && 0 < elements.length && index < elements.length && (!imageIdentifier || elements[index].value === imageIdentifier)) {
      if (this.tabletopObject.currntIconIndex > index) this.tabletopObject.currntIconIndex -= 1;
      this.tabletopObject.imageDataElement.removeChild(elements[index]);
      if (this.tabletopObject.currntIconIndex >= elements.length - 1) this.tabletopObject.currntIconIndex =  elements.length - 2;
      if (this.tabletopObject.currntIconIndex < 0) this.tabletopObject.currntIconIndex = 0;
      //if (sound) SoundEffect.play(PresetSound.sweep);
    }
  }

  openMainImageModal() {
    if (this.tabletopObject instanceof CardStack) {
      return;
    } else if (this.tabletopObject instanceof Card) {
      this.openModal(this.tabletopObject.isVisible ? 'front' : 'back');
    } else if (this.tabletopObject instanceof DiceSymbol) {
      this.openModal(this.tabletopObject['face']);
    } else if (this.tabletopObject instanceof GameCharacter) {
      this.openModalReplaceImage(this.tabletopObject.imageFiles.length > 1 || 0 < this.tabletopObject.imageFile?.url?.length);
    } else {
      this.openModal('imageIdentifier', this.tabletopObject.imageFile && this.tabletopObject.imageFile.url.length > 0)
    }
  }

  showChatPalette() {
    if (!(this.tabletopObject instanceof GameCharacter)) return;
    const character = this.tabletopObject as GameCharacter;
    const tourId = PanelService.tourIdChatPalette(character.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = character;
  }

  showStandSetting() {
    if (!(this.tabletopObject instanceof GameCharacter)) return;
    const character = this.tabletopObject as GameCharacter;
    const tourId = PanelService.tourIdStandSetting(character.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = character;
  }

  onMainImageLoad() {
    if (!this.mainImageElement) return;
    this.mainImageWidth = this.mainImageElement.nativeElement.clientWidth;
    this.mainImageHeight = this.mainImageElement.nativeElement.clientHeight;
    this.naturalWidth = this.mainImageElement.nativeElement.naturalWidth;
    this.naturalHeight = this.mainImageElement.nativeElement.naturalHeight;
  }

  identify(index, obj){
    return obj.identifier;  
  }

  get imageAreaRreact(): {width: number, height: number, top: number, left: number, scale: number} {
    return this.calcImageAreaRect(this.mainImageWidth, this.mainImageHeight, 0);
  }

  private calcImageAreaRect(areaWidth: number, areaHeight: number, offset: number): {width: number, height: number, top: number, left: number, scale: number} {
    const rect = {width: 0, height: 0, top: offset, left: offset, scale: 1};
    if (this.naturalWidth == 0 || this.naturalHeight == 0) return rect;

    const viewWidth = areaWidth - offset * 2;
    const viewHeight = areaHeight - offset * 2;
    // 尚未使用 scale 時期的殘留
    if ((this.naturalHeight * viewWidth / this.naturalWidth) > viewHeight) {
      rect.width = this.naturalWidth * viewHeight / this.naturalHeight;
      rect.height = viewHeight;
      rect.left = offset + (viewWidth - rect.width) / 2;
    } else {
      rect.width = viewWidth;
      rect.height = this.naturalHeight * viewWidth / this.naturalWidth;
      rect.top = offset + (viewHeight - rect.height) / 2;
    } 

    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    if (card) {
      rect.scale = rect.width / (card.size * this.gridSize);
      rect.width = card.size * this.gridSize;
      rect.height = rect.width * this.naturalHeight / this.naturalWidth;
    }
    return rect;
  }

  get cardColor(): string {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? card.color : '#555555';
  }

  get cardFontSize(): number {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? card.fontsize + 9 : 18;
  }

  get cardText(): string {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? StringUtil.rubyToHtml(StringUtil.escapeHtml(card.text)) : '';
  }

  get cardTextShadowCss(): string {
    const shadow = StringUtil.textShadowColor(this.cardColor);
    return `${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px`;
  }

  get isVisible(): boolean {
    if (!this.tabletopObject) return false;
    if (PeerCursor.myCursor && PeerCursor.myCursor.isGMMode) return true;
    if (this.tabletopObject instanceof Card) return this.tabletopObject.isFront || this.tabletopObject.isHand;
    if (this.tabletopObject instanceof DiceSymbol) return this.tabletopObject['isVisible'];
    return true;
  }

  get isBlackPaint(): boolean {
    if (this.tabletopObject instanceof GameCharacter) return this.tabletopObject.isBlackPaint;
    if (this.tabletopObject instanceof DiceSymbol) return !this.isVisible;
    return false;
  }

  get sheetImageFilter(): string | null {
    if (this.tabletopObject instanceof GameCharacter) return imageEffectFilter(this.tabletopObject);
    if (this.isBlackPaint) return imageEffectFilter({ isBlackPaint: true });
    return null;
  }
  get sheetImageOpacity(): number | null {
    if (this.tabletopObject instanceof GameCharacter) return imageEffectOpacity(this.tabletopObject);
    return null;
  }
  get sheetImageTransform(): string | null {
    if (this.tabletopObject instanceof GameCharacter) return imageEffectTransform(this.tabletopObject);
    if (this.tabletopObject?.isInverse) return imageEffectTransform({ isInverse: true });
    return null;
  }

  get isNoLogging(): boolean {
    if (this.tabletopObject instanceof Card) return !this.tabletopObject.isFront;
    if (this.tabletopObject instanceof DiceSymbol) return this.tabletopObject.hasOwner;
    return false;
  }

  showCaseOffset(index: number): number {
    if (!this.tabletopObject) return 0;
    let len = this.tabletopObject.imageFiles.length;
    if (len <= 5) return 0; 
    return (50 - (160 / (len - 2))) * (this.tabletopObject.currntImageIndex <= index ? index-1 : index);
  }

  showIconOffset(index): number {
    if (!this.tabletopObject) return 0;
    let len = this.tabletopObject.faceIcons.length;
    if (len <= 5) return 0;
    return (50 - (200 / (len - 1))) * index + 2;
  }

  private updatePanelTitle() {
    if (!this.tabletopObject) return;
    const aliasToKey: Record<string, string> = {
      terrain: 'sheet.title.terrain',
      'card-stack': 'sheet.title.cardStack',
      'table-mask': 'sheet.title.tableMask',
      'text-note': 'sheet.title.textNote',
      'dice-symbol': 'sheet.title.diceSymbol',
      character: 'sheet.title.character',
      range: 'sheet.title.range'
    };
    if (this.tabletopObject.aliasName === 'card' && this.tabletopObject instanceof Card) {
      this.panelService.title = this.i18n.t('sheet.title.card', {
        name: this.tabletopObject.isFront ? this.tabletopObjectName : this.i18n.t('sheet.cardBack')
      });
      return;
    }
    const key = aliasToKey[this.tabletopObject.aliasName];
    if (key) this.panelService.title = this.i18n.t(key, { name: this.tabletopObjectName });
  }
}
