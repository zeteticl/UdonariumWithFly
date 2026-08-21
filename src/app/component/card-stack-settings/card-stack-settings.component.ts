import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { CardStack } from '@udonarium/card-stack';
import { EventSystem, Network } from '@udonarium/core/system';

import { CardStackListComponent } from 'component/card-stack-list/card-stack-list.component';
import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';

@Component({
  selector: 'card-stack-settings',
  templateUrl: './card-stack-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', '../shared/object-settings.css', './card-stack-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class CardStackSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() cardStack: CardStack = null;

  isSaveing = false;
  progresPercent = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private saveDataService: SaveDataService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  get stackName(): string { return this.cardStack?.name ?? ''; }
  set stackName(value: string) {
    if (!this.cardStack || this.GuestMode()) return;
    const el = this.cardStack.commonDataElement?.getFirstElementByName('name');
    if (el) el.value = value;
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.cardStack && event.data?.identifier === this.cardStack.identifier) this.panelService.close();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.cardStack && event.data?.identifier === this.cardStack.identifier) {
          this.refreshTitle();
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_OBJECT_CHILDREN', event => {
        if (this.cardStack && event.data?.identifier === this.cardStack.identifier) this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshTitle());
    this.cardStack?.complement();
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['cardStack'] && this.cardStack) {
      this.cardStack.complement();
      this.refreshTitle();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  changeAllBackImages() {
    if (!this.cardStack || this.GuestMode()) return;
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: false }).then(value => {
      if (!this.cardStack || !value) return;
      this.cardStack.cards.forEach(card => {
        const element = card.imageDataElement?.getFirstElementByName('back');
        if (element) element.value = value;
      });
      this.changeDetector.markForCheck();
    });
  }

  openStackList() {
    if (!this.cardStack || this.GuestMode()) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = {
      title: this.i18n.t('cardList.panelTitle'),
      left: coordinate.x - 200,
      top: coordinate.y - 300,
      width: 400,
      height: 520
    };
    const component = this.panelService.open<CardStackListComponent>(CardStackListComponent, option);
    component.cardStack = this.cardStack;
  }

  async saveToXML() {
    if (!this.cardStack || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;
    await this.saveDataService.saveGameObjectAsync(this.cardStack, 'fly_xml_' + (this.cardStack.name || 'stack'), percent => {
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
    if (!this.cardStack) return;
    let title = this.i18n.t('stack.panelTitle');
    if (this.cardStack.name?.length) title += ' - ' + this.cardStack.name;
    this.panelService.title = title;
  }
}
