import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { stringifyCcfoliaClipboard } from '@udonarium/ccfolia-clipboard';
import { CharacterToken } from '@udonarium/character-token';
import { EventSystem, Network } from '@udonarium/core/system';
import { UUID } from '@udonarium/core/system/util/uuid';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';

import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
  selector: 'character-settings',
  templateUrl: './character-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', './character-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class CharacterSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() character: GameCharacter = null;
  /** When opened from a map Token, prefer that Token for FoW / cosmetics (plan: vision on Token). */
  @Input() token: CharacterToken = null;

  networkService = Network;
  MAX_IMAGE_ICON_COUNT = 8;
  isEdit = false;
  isSaveing = false;
  progresPercent = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private saveDataService: SaveDataService,
    private panelService: PanelService,
    private modalService: ModalService,
    private pointerDeviceService: PointerDeviceService,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  /**
   * Map Token used for per-token FoW / placement cosmetics.
   * Prefer the Token that opened this panel; else view major / any on current map.
   */
  get mapToken(): CharacterToken | null {
    if (!this.character) return null;
    if (this.token && this.token.characterId === this.character.identifier) return this.token;
    return CharacterToken.focusTokenForCharacter(this.character.identifier);
  }

  /** Host for vision / light / token cosmetics: Token when on map, else body (seed). */
  private get appearanceTarget(): GameCharacter | CharacterToken | null {
    return CharacterToken.appearanceHostFor(this.character, { preferredToken: this.token });
  }

  get visionRange(): number {
    return this.appearanceTarget?.visionRange ?? 6;
  }
  get brightLight(): number {
    return this.appearanceTarget?.brightLight ?? 0;
  }
  get dimLight(): number {
    return this.appearanceTarget?.dimLight ?? 0;
  }

  /** Persist vision / light radii onto the Token (or body seed when none on view). */
  syncLightPlacement() {
    const tok = this.mapToken;
    if (tok) {
      tok.syncAppearanceToCurrentViewPlacement();
      return;
    }
    this.character?.syncAppearanceToCurrentViewPlacement();
  }

  setVisionRange(n: number) {
    this.setTokenOrBodyNumber('visionRange', n);
  }
  setBrightLight(n: number) {
    this.setTokenOrBodyNumber('brightLight', n);
  }
  setDimLight(n: number) {
    this.setTokenOrBodyNumber('dimLight', n);
  }

  private setTokenOrBodyNumber(key: 'visionRange' | 'brightLight' | 'dimLight', n: number) {
    if (this.GuestMode()) return;
    const value = Number(n) || 0;
    const tok = this.mapToken;
    if (tok) {
      tok.mutateAppearance(() => { (tok as any)[key] = value; });
      // Keep body as seed for future inventory→map creates.
      if (this.character) {
        (this.character as any)[key] = value;
        this.character.update();
      }
      this.changeDetector.markForCheck();
      return;
    }
    if (this.character) {
      this.character.mutateAppearance(() => { (this.character as any)[key] = value; });
      this.changeDetector.markForCheck();
    }
  }

  /** Desktop cosmetics stored on the map Token when present. */
  setPlacementFlag(key: string, value: any) {
    if (this.GuestMode()) return;
    const tok = this.mapToken;
    if (tok) {
      tok.mutateAppearance(() => { (tok as any)[key] = value; });
      if (this.character && key in this.character) (this.character as any)[key] = value;
      this.changeDetector.markForCheck();
      return;
    }
    this.character?.mutateAppearance(() => { (this.character as any)[key] = value; });
    this.changeDetector.markForCheck();
  }

  placementFlag(key: string, fallback: any = false): any {
    const host = this.appearanceTarget as any;
    if (host && host[key] !== undefined) return host[key];
    return fallback;
  }

  get size(): number { return this.character?.size ?? 1; }
  set size(value: number) {
    this.character?.mutateAppearance(() => {
      const el = this.character?.commonDataElement?.getFirstElementByName('size');
      if (el) el.value = value;
    });
  }

  /** Map Token altitude when present; else sheet seed. */
  get altitude(): number {
    return this.appearanceTarget?.altitude ?? 0;
  }
  set altitude(value: number) {
    if (this.GuestMode()) return;
    const host = this.appearanceTarget;
    if (!host) return;
    host.altitude = value;
    // Keep body as seed for future inventory→map creates.
    if (this.character && host !== this.character) {
      this.character.altitude = value;
    }
    this.changeDetector.markForCheck();
  }

  /** Raw height field (image-relative when heightScale). */
  get heightRaw(): number {
    const el = this.character?.commonDataElement?.getFirstElementByName('height');
    const n = el ? +el.value : 0;
    return Number.isNaN(n) ? 0 : n;
  }
  set heightRaw(value: number) {
    this.character?.mutateAppearance(() => {
      const el = this.character?.commonDataElement?.getFirstElementByName('height');
      if (el) el.value = value;
    });
  }

  get heightScale(): boolean {
    const el = this.character?.commonDataElement?.getFirstElementByName('height');
    return !!(el && el.currentValue);
  }
  set heightScale(on: boolean) {
    this.character?.mutateAppearance(() => {
      const el = this.character?.commonDataElement?.getFirstElementByName('height');
      if (!el) return;
      el.currentValue = on ? 'height' : '';
    });
  }

  get detailSections(): DataElement[] {
    const children = this.character?.detailDataElement?.children;
    return children ? children as DataElement[] : [];
  }

  get isAllowsChat(): boolean {
    if (!this.character?.isAllowsChat) return false;
    switch (this.character.location.name) {
      case 'table':
      case PeerCursor.myCursor?.peerId:
        return true;
      case 'graveyard':
        return false;
      default:
        for (const peer of Network.peers) {
          if (peer.isOpen && this.character.location.name === peer.peerId) return false;
        }
        return true;
    }
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.character && event.data?.identifier === this.character.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const id = event.data?.identifier;
        if (!id) return;
        if (this.character && id === this.character.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
          return;
        }
        if (this.mapToken && id === this.mapToken.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_OBJECT_CHILDREN', event => {
        if (this.character && event.data?.identifier === this.character.identifier) this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.bindGeometry();
    this.refreshTitle();
    queueMicrotask(() => {
      if (!this.character) return;
      this.chatMessageService.sendOperationLog(this.i18n.t('sheet.logOpened', { title: this.panelService.title }));
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['character'] && this.character) {
      this.bindGeometry();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  toggleEditMode() { this.isEdit = !this.isEdit; }

  addDataElement() {
    if (!this.character?.detailDataElement || this.GuestMode()) return;
    const title = DataElement.create(this.i18n.t('sheet.data.title'), '', {});
    const tag = DataElement.create(this.i18n.t('sheet.data.tag'), '', {});
    title.appendChild(tag);
    this.character.detailDataElement.appendChild(title);
    this.changeDetector.markForCheck();
  }

  setLocation(locationName: string) {
    if (!this.character || this.GuestMode()) return;
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: this.character.identifier });
    SoundEffect.play(locationName === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
    this.character.setLocation(locationName);
    this.changeDetector.markForCheck();
  }

  openModalReplaceImage(isAllowedEmpty = false) {
    if (!this.character || this.GuestMode()) return;
    const elements = this.character.imageDataElement?.getElementsByName('imageIdentifier') || [];
    const currentImageIdentifires = elements.map(el => el.value + '');
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty, currentImageIdentifires }).then(value => {
      if (!this.character?.imageDataElement || !value) return;
      if (value === 'null') {
        if (this.character.imageElement && this.character.imageFiles.length === 1) {
          this.character.imageElement.value = value;
          this.character.imageElement.currentValue = value;
        } else {
          this.deleteImage(this.character.currntImageIndex);
        }
      } else if (this.character.imageElement) {
        this.character.imageElement.value = value;
      }
      this.changeDetector.markForCheck();
    });
  }

  openModalAddImage() {
    if (!this.character || this.GuestMode()) return;
    const elements = this.character.imageDataElement?.getElementsByName('imageIdentifier') || [];
    this.modalService.open<string>(FileSelecterComponent, {
      currentImageIdentifires: elements.map(el => el.value + '')
    }).then(value => {
      if (!this.character?.imageDataElement || !value) return;
      const els = this.character.imageDataElement.getElementsByName('imageIdentifier');
      if (els.length >= this.MAX_IMAGE_ICON_COUNT) {
        els[this.MAX_IMAGE_ICON_COUNT - 1].value = value;
      } else {
        this.character.imageDataElement.appendChild(
          DataElement.create('imageIdentifier', value, { type: 'image' }, 'imageIdentifier' + UUID.generateUuid())
        );
      }
      if (this.character.currntImageIndex < 0) this.character.currntImageIndex = 0;
      this.changeDetector.markForCheck();
    });
  }

  openModal(name: string, isAllowedEmpty = false) {
    if (!this.character || this.GuestMode()) return;
    let currentImageIdentifires: string[] = [];
    if (name === 'shadowImageIdentifier') {
      const element = this.character.imageElement;
      if (element && element.value !== 'null' && element.currentValue) currentImageIdentifires = [element.currentValue + ''];
    } else {
      const elements = this.character.imageDataElement?.getElementsByName(name) || [];
      currentImageIdentifires = elements.map(el => el.value + '');
    }
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty, currentImageIdentifires }).then(value => {
      if (!this.character?.imageDataElement || !value) return;
      if (name === 'shadowImageIdentifier') {
        const element = this.character.imageElement;
        if (element && element.value !== 'null') element.currentValue = value;
        const garbages = this.character.imageDataElement.getElementsByName('shadowImageIdentifier');
        for (const garbage of garbages) this.character.imageDataElement.removeChild(garbage);
      } else if (name === 'faceIcon') {
        const elements = this.character.imageDataElement.getElementsByName(name);
        if (elements.length >= this.MAX_IMAGE_ICON_COUNT) {
          elements[this.MAX_IMAGE_ICON_COUNT - 1].value = value;
        } else {
          this.character.imageDataElement.appendChild(
            DataElement.create(name, value, { type: 'image' }, name + UUID.generateUuid())
          );
        }
        if (this.character.currntIconIndex < 0) this.character.currntIconIndex = 0;
      } else {
        const element = this.character.imageDataElement.getFirstElementByName(name);
        if (element) element.value = value;
      }
      this.changeDetector.markForCheck();
    });
  }

  selectImage(index: number) {
    if (!this.character || this.character.currntImageIndex === index) return;
    this.character.mutateAppearance(() => { this.character.currntImageIndex = index; });
    SoundEffect.play(PresetSound.surprise);
    EventSystem.trigger('UPDATE_INVENTORY', null);
    this.changeDetector.markForCheck();
  }

  selectIcon(index: number) {
    if (!this.character || this.character.currntIconIndex === index) return;
    this.character.mutateAppearance(() => { this.character.currntIconIndex = index; });
    this.changeDetector.markForCheck();
  }

  deleteImage(index = 0) {
    if (!this.character?.imageDataElement) return;
    const elements = this.character.imageDataElement.getElementsByName('imageIdentifier');
    if (!elements?.length || index >= elements.length) return;
    if (this.character.currntImageIndex > index) this.character.currntImageIndex -= 1;
    this.character.imageDataElement.removeChild(elements[index]);
    if (this.character.currntImageIndex >= elements.length - 1) this.character.currntImageIndex = elements.length - 2;
    if (this.character.currntImageIndex < 0) this.character.currntImageIndex = 0;
    this.changeDetector.markForCheck();
  }

  deleteIcon(index = 0, imageIdentifier = '') {
    if (!this.character?.imageDataElement) return;
    const elements = this.character.imageDataElement.getElementsByName('faceIcon');
    if (!elements?.length || index >= elements.length) return;
    if (imageIdentifier && elements[index].value !== imageIdentifier) return;
    if (this.character.currntIconIndex > index) this.character.currntIconIndex -= 1;
    this.character.imageDataElement.removeChild(elements[index]);
    if (this.character.currntIconIndex >= elements.length - 1) this.character.currntIconIndex = elements.length - 2;
    if (this.character.currntIconIndex < 0) this.character.currntIconIndex = 0;
    this.changeDetector.markForCheck();
  }

  identify(_index: number, obj: { identifier: string }) { return obj.identifier; }

  async saveToXML() {
    if (!this.character || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.character, 'fly_xml_' + (this.character.name || 'character'), percent => {
      this.progresPercent = percent;
      this.changeDetector.markForCheck();
    });
    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
      this.changeDetector.markForCheck();
    }, 500);
  }

  importXml() {
    if (this.GuestMode()) return;
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  async exportCcfoliaJson() {
    if (!this.character || this.GuestMode()) return;
    const json = stringifyCcfoliaClipboard(this.character);
    const safeName = (this.character.name || 'character').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const d = new Date();
    const pad = (n: number) => ('00' + n).slice(-2);
    anchor.download = `hktrpg_${safeName}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    try { await navigator.clipboard.writeText(json); } catch { /* ignore */ }
  }

  showChatPalette() {
    if (!this.character || !this.isAllowsChat) return;
    const tourId = PanelService.tourIdChatPalette(this.character.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    const component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = this.character;
  }

  showStandSetting() {
    if (!this.character) return;
    const tourId = PanelService.tourIdStandSetting(this.character.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    const component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = this.character;
  }

  private bindGeometry() {
    if (!this.character) return;
    const key = PanelService.sheetGeometryKey(this.character.aliasName);
    this.panelService.geometryKey = key;
    const g = PanelService.getGeometry(key);
    // Width is user preference; height is fitted by appFitPanel.
    if (g && g.width >= 100) {
      this.panelService.width = g.width;
    }
  }

  private refreshTitle() {
    if (!this.character) return;
    let title = this.i18n.t('char.sheetTitle');
    if (this.character.name?.length) title += ' - ' + this.character.name;
    this.panelService.title = title;
  }
}
