import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { ScenePreset } from '@udonarium/scene-preset';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TableSelecter } from '@udonarium/table-selecter';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'app-scene-preset',
  templateUrl: './scene-preset.component.html',
  styleUrls: ['../shared/settings-ui.css', './scene-preset.component.css'],
  standalone: false
})
export class ScenePresetComponent implements OnInit, OnDestroy {
  selected: ScenePreset = null;
  skipBgm = false;
  skipText = false;
  /** Fixed-position hover zoom for list thumbs (immediate, no delay). */
  thumbPreviewSrc = '';
  thumbPreviewX = 0;
  thumbPreviewY = 0;
  private lazyUpdateTimer: NodeJS.Timeout = null;

  get list(): ScenePresetList { return ScenePresetList.instance; }
  get presets(): ScenePreset[] { return this.list.presets; }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService,
    private ngZone: NgZone,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  /** One meta line: table (if ≠ title) · saved time. */
  metaLine(preset: ScenePreset): string {
    const title = (preset.title || '').trim();
    const table = (preset.tableDisplayName || '').trim();
    const parts: string[] = [];
    if (table && table !== title) parts.push(table);
    if (preset.savedAt) parts.push(this.i18n.t('scenePreset.savedAt', { time: preset.savedAtCompact }));
    return parts.join(' · ');
  }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.modalService.title = this.panelService.title = this.i18n.t('scenePreset.title');
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyNgZoneUpdate())
      .on('LOCALE_CHANGED', () => {
        this.modalService.title = this.panelService.title = this.i18n.t('scenePreset.title');
      });
  }

  ngOnDestroy() {
    this.hideThumbPreview();
    EventSystem.unregister(this);
  }

  create() {
    if (this.GuestMode()) return;
    void this.saveCurrentScene();
  }

  overwrite(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    void this.confirmOverwrite(preset);
  }

  private async confirmOverwrite(preset: ScenePreset) {
    const title = preset.title?.trim() || this.i18n.t('scenePreset.untitled');
    const result = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('scenePreset.overwrite'),
      text: this.i18n.t('scenePreset.overwriteConfirmText', { title }),
      help: this.i18n.t('scenePreset.overwriteConfirmHelp'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'save',
      okLabel: this.i18n.t('scenePreset.overwriteOk'),
    });
    if (result === false || result == null) return;
    await this.list.writeSnapshot(preset);
  }

  rebind(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const table = TableSelecter.instance.viewTable;
    if (table) preset.tableIdentifier = table.identifier;
  }

  apply(preset: ScenePreset, keepTokens = false) {
    if (this.GuestMode() || !preset || !preset.isValid) return;
    const chatTab = this.resolveActiveChatTab();
    this.list.applyPreset(preset, {
      skipBgm: this.skipBgm,
      skipText: this.skipText,
      skipTokens: keepTokens,
      chatTab
    });
  }

  private async saveCurrentScene() {
    const defaultTitle = TableSelecter.instance.viewTable?.name
      || this.i18n.t('scenePreset.defaultTitle');
    const result = await this.modalService.open<string | boolean>(ConfirmationComponent, {
      title: this.i18n.t('scenePreset.saveAsScene'),
      text: this.i18n.t('scenePreset.saveConfirmText'),
      help: this.i18n.t('scenePreset.saveConfirmHelp'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'theaters',
      okLabel: this.i18n.t('scenePreset.saveAsScene'),
      inputLabel: this.i18n.t('scenePreset.fieldTitle'),
      inputValue: defaultTitle,
      inputPlaceholder: this.i18n.t('scenePreset.defaultTitle'),
    });
    if (result === false || result == null) return;
    const title = (typeof result === 'string' ? result.trim() : '') || defaultTitle;
    this.selected = await this.list.createFromCurrentAsync(title);
  }

  remove(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    if (this.selected === preset) this.selected = null;
    preset.destroy();
  }

  select(preset: ScenePreset) {
    this.selected = preset;
  }

  showThumbPreview(e: MouseEvent, preset: ScenePreset) {
    if (!preset?.previewJpeg) {
      this.hideThumbPreview();
      return;
    }
    this.thumbPreviewSrc = preset.previewJpeg;
    this.placeThumbPreview(e.clientX, e.clientY);
  }

  moveThumbPreview(e: MouseEvent) {
    if (!this.thumbPreviewSrc) return;
    this.placeThumbPreview(e.clientX, e.clientY);
  }

  hideThumbPreview() {
    this.thumbPreviewSrc = '';
  }

  private placeThumbPreview(clientX: number, clientY: number) {
    const pad = 12;
    const w = 360;
    const h = 270;
    let x = clientX + pad;
    let y = clientY + pad;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (x + w > vw - 8) x = Math.max(8, clientX - w - pad);
    if (y + h > vh - 8) y = Math.max(8, vh - h - 8);
    this.thumbPreviewX = x;
    this.thumbPreviewY = y;
  }

  moveUp(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const parent = preset.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(preset);
    if (idx <= 0) return;
    parent.insertBefore(preset, parent.children[idx - 1]);
  }

  moveDown(preset: ScenePreset) {
    if (this.GuestMode() || !preset) return;
    const parent = preset.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(preset);
    if (idx < 0 || idx >= parent.children.length - 1) return;
    parent.insertBefore(parent.children[idx + 1], preset);
  }

  private resolveActiveChatTab() {
    const id = ChatWindowComponent.activeChatTabIdentifier;
    if (id) {
      const tab = ObjectStore.instance.get(id);
      if (tab) return tab as any;
    }
    return this.chatMessageService.chatTabs[0];
  }

  private lazyNgZoneUpdate() {
    if (this.lazyUpdateTimer !== null) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.ngZone.run(() => { });
    }, 100);
  }
}
