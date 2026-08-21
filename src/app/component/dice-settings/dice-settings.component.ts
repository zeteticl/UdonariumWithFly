import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { PeerCursor } from '@udonarium/peer-cursor';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
  selector: 'dice-settings',
  templateUrl: './dice-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './dice-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class DiceSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() dice: DiceSymbol = null;

  isSaveing = false;
  progresPercent = 0;

  facePreviewSrc = '';
  facePreviewLabel = '';
  facePreviewX = 0;
  facePreviewY = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  get isVisible(): boolean {
    if (!this.dice) return false;
    if (PeerCursor.myCursor?.isGMMode) return true;
    return this.dice.isVisible;
  }

  get faces(): string[] { return this.dice?.faces ?? []; }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.dice && event.data?.identifier === this.dice.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.dice && event.data?.identifier === this.dice.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['dice'] && this.dice) this.refreshTitle();
  }

  ngOnDestroy() {
    this.hideFacePreview();
    EventSystem.unregister(this);
  }

  faceImage(face: string): ImageFile {
    const id = this.dice?.imageDataElement?.getFirstElementByName(face)?.value + '';
    return id ? (ImageStorage.instance.get(id) || ImageFile.Empty) : ImageFile.Empty;
  }

  showFacePreview(e: MouseEvent, face: string) {
    const url = this.faceImage(face)?.url || '';
    if (!url) {
      this.hideFacePreview();
      return;
    }
    this.facePreviewSrc = url;
    this.facePreviewLabel = face;
    this.placeFacePreview(e.clientX, e.clientY);
    this.changeDetector.markForCheck();
  }

  moveFacePreview(e: MouseEvent) {
    if (!this.facePreviewSrc) return;
    this.placeFacePreview(e.clientX, e.clientY);
  }

  hideFacePreview() {
    if (!this.facePreviewSrc && !this.facePreviewLabel) return;
    this.facePreviewSrc = '';
    this.facePreviewLabel = '';
    this.changeDetector.markForCheck();
  }

  openFaceImage(face: string) {
    if (!this.dice || this.GuestMode() || !this.isVisible) return;
    this.hideFacePreview();
    this.dice.mutateAppearance(() => { this.dice.face = face; });
    const current = this.dice.imageDataElement?.getFirstElementByName(face)?.value + '' || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current && current !== 'null' ? [current] : []
    }).then(value => {
      if (!this.dice || value == null) return;
      const el = this.dice.imageDataElement?.getFirstElementByName(face);
      if (el) el.value = value;
      this.dice.mutateAppearance(() => { this.dice.face = face; });
      this.changeDetector.markForCheck();
    });
  }

  private placeFacePreview(clientX: number, clientY: number) {
    const pad = 12;
    const w = 220;
    const h = 220;
    let x = clientX + pad;
    let y = clientY + pad;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (x + w > vw - 8) x = Math.max(8, clientX - w - pad);
    if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
    this.facePreviewX = x;
    this.facePreviewY = y;
  }

  async saveToXML() {
    if (!this.dice || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.dice, 'fly_xml_' + (this.dice.name || 'dice'), percent => {
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

  private refreshTitle() {
    if (!this.dice) return;
    let title = this.i18n.t('dice.panelTitle');
    if (this.dice.name?.length) title += ' - ' + this.dice.name;
    this.panelService.title = title;
  }
}
