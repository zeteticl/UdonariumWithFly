import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { FilterType, GameTable, GridType, WeatherType } from '@udonarium/game-table';
import { fitGameTableSizeToImage } from '@udonarium/game-table-fit';
import { GameCharacter } from '@udonarium/game-character';
import { ImageTag } from '@udonarium/image-tag';
import { RangeArea } from '@udonarium/range';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { ChatMessageService } from 'service/chat-message.service';
import { ImageService } from 'service/image.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { WeatherSeService } from 'service/weather-se.service';

@Component({
    selector: 'game-table-setting',
    templateUrl: './game-table-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './game-table-setting.component.css'],
    standalone: false
})
export class GameTableSettingComponent implements OnInit, OnDestroy {
  /** Open settings focused on this table without switching the canvas view. */
  static pendingEditTableId: string = null;

  minSize: number = 1;
  maxSize: number = 100;

  isShowHideImages = false;

  get tableBackgroundImage(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.imageIdentifier : null);
  }

  get tableDistanceviewImage(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.backgroundImageIdentifier : null);
  }
  get tableDistanceviewImage2(): ImageFile {
    return this.imageService.getEmptyOr(this.selectedTable ? this.selectedTable.backgroundImageIdentifier2 : null);
  }

  get tableName(): string { return this.selectedTable.name; }
  set tableName(tableName: string) { if (this.isEditable) this.selectedTable.name = tableName; }

  get tableWidth(): number { return this.selectedTable.width; }
  set tableWidth(tableWidth: number) { if (this.isEditable) this.selectedTable.width = tableWidth; }

  get tableHeight(): number { return this.selectedTable.height; }
  set tableHeight(tableHeight: number) { if (this.isEditable) this.selectedTable.height = tableHeight; }

  get tableGridColor(): string { return this.selectedTable.gridColor; }
  set tableGridColor(tableGridColor: string) { if (this.isEditable) this.selectedTable.gridColor = tableGridColor; }

  get tableGridShow(): boolean { return this.tableSelecter.gridShow; }
  set tableGridShow(tableGridShow: boolean) {
    this.tableSelecter.gridShow = tableGridShow;
    if (tableGridShow) this.tableSelecter.viewTable.gridClipRect = null;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tableSelecter.toContext()); // 僅對自己發送事件以觸發格線更新
  }

  get tableGridSnap(): boolean { return this.tableSelecter.gridSnap; }
  set tableGridSnap(tableGridSnap: boolean) {
    this.tableSelecter.gridSnap = tableGridSnap;
  }

  get tableGridType(): GridType { return this.selectedTable.gridType; }
  set tableGridType(gridType: GridType) { if (this.isEditable) this.selectedTable.gridType = Number(gridType); }

  get tableGridNumberShow(): boolean { return this.selectedTable.isShowNumber; }
  set tableGridNumberShow(isShowNumber: boolean) {
    this.selectedTable.isShowNumber = isShowNumber;
    EventSystem.trigger('UPDATE_GAME_OBJECT', this.tableSelecter.toContext()); // 僅對自己發送事件以觸發格線更新
  }

  get tableDistanceviewFilter(): FilterType { return this.selectedTable.backgroundFilterType; }
  set tableDistanceviewFilter(filterType: FilterType) { if (this.isEditable) this.selectedTable.backgroundFilterType = filterType; }

  get tableDarkness(): number { return this.selectedTable?.darkness ?? 0; }
  set tableDarkness(v: number) { if (this.isEditable && this.canControlDayNight) this.selectedTable.darkness = Number(v); }
  get tableGlobalIllumination(): number { return this.selectedTable?.globalIllumination ?? 1; }
  set tableGlobalIllumination(v: number) { if (this.isEditable) this.selectedTable.globalIllumination = Number(v); }
  get tableGlobalIlluminationEnabled(): boolean { return this.selectedTable?.globalIlluminationEnabled !== false; }
  set tableGlobalIlluminationEnabled(v: boolean) {
    if (this.isEditable) this.selectedTable.globalIlluminationEnabled = !!v;
  }
  get tableGlobalIlluminationThresholdEnabled(): boolean {
    return (this.selectedTable?.globalIlluminationThreshold ?? -1) >= 0;
  }
  set tableGlobalIlluminationThresholdEnabled(v: boolean) {
    if (!this.isEditable || !this.selectedTable) return;
    if (v) {
      const cur = this.selectedTable.globalIlluminationThreshold;
      this.selectedTable.globalIlluminationThreshold = cur >= 0 ? cur : 0.75;
    } else {
      this.selectedTable.globalIlluminationThreshold = -1;
    }
  }
  get tableGlobalIlluminationThreshold(): number {
    const t = this.selectedTable?.globalIlluminationThreshold ?? -1;
    return t < 0 ? 0.75 : t;
  }
  set tableGlobalIlluminationThreshold(v: number) {
    if (!this.isEditable || !this.selectedTable) return;
    if ((this.selectedTable.globalIlluminationThreshold ?? -1) < 0) return;
    this.selectedTable.globalIlluminationThreshold = Math.max(0, Math.min(1, Number(v)));
  }
  get tableWeatherType(): WeatherType { return this.selectedTable?.weatherType || 'none'; }
  set tableWeatherType(v: WeatherType) { if (this.isEditable && this.canControlWeather) this.selectedTable.weatherType = v; }
  get tableWeatherIntensity(): number { return this.selectedTable?.weatherIntensity ?? 0.5; }
  set tableWeatherIntensity(v: number) { if (this.isEditable && this.canControlWeather) this.selectedTable.weatherIntensity = Number(v); }
  get tableVisionEnabled(): boolean { return !!this.selectedTable?.visionEnabled; }
  set tableVisionEnabled(v: boolean) { if (this.isEditable) this.selectedTable.visionEnabled = !!v; }
  get tableIs2DMode(): boolean { return !!this.selectedTable?.is2DMode; }
  set tableIs2DMode(v: boolean) { if (this.isEditable) this.selectedTable.is2DMode = !!v; }

  transitionDay() {
    if (!this.isEditable || !this.canControlDayNight) return;
    this.animateDarkness(0);
  }
  transitionDusk() {
    if (!this.isEditable || !this.canControlDayNight) return;
    this.animateDarkness(0.4);
  }
  transitionNight() {
    if (!this.isEditable || !this.canControlDayNight) return;
    this.animateDarkness(0.85);
  }
  private animateDarkness(target: number) {
    const table = this.selectedTable;
    if (!table) return;
    table.backgroundFilterType = target >= 0.5 ? FilterType.BLACK : FilterType.NONE;
    const start = table.darkness;
    const t0 = performance.now();
    const dur = 800;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      table.darkness = start + (target - start) * p;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  get tableSelecter(): TableSelecter { return TableSelecter.instance; }

  selectedTable: GameTable = null;
  selectedTableXml: string = '';

  get isEmpty(): boolean { return this.tableSelecter ? (this.tableSelecter.viewTable ? false : true) : true; }
  get isDeleted(): boolean {
    if (!this.selectedTable) return true;
    return ObjectStore.instance.get<GameTable>(this.selectedTable.identifier) == null;
  }
  get isEditable(): boolean {
    return !this.isEmpty && !this.isDeleted;
  }

  get canControlWeather(): boolean {
    return SceneToolPermission.instance.canControlWeather();
  }

  get canControlDayNight(): boolean {
    return SceneToolPermission.instance.canControlDayNight();
  }

  get weatherSeEnabled(): boolean {
    return this.weatherSe.isEnabled;
  }
  set weatherSeEnabled(v: boolean) {
    this.weatherSe.setEnabled(!!v);
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private imageService: ImageService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    private i18n: I18nService,
    private weatherSe: WeatherSeService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    const pending = GameTableSettingComponent.pendingEditTableId;
    GameTableSettingComponent.pendingEditTableId = null;
    if (pending) {
      const table = ObjectStore.instance.get<GameTable>(pending);
      this.selectedTable = table || this.tableSelecter.viewTable;
    } else {
      this.selectedTable = this.tableSelecter.viewTable;
    }
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', 2000, event => {
        if (!this.selectedTable || event.data.identifier !== this.selectedTable.identifier) return;
        let object = ObjectStore.instance.get(event.data.identifier);
        if (object !== null) {
          this.selectedTableXml = object.toXml();
        }
      })
      .on('SELECT_GAME_TABLE', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('table.title');
  }

  selectGameTable(identifier: string) {
    if (this.GuestMode()) return;
    // Select for editing only — does not change room active / viewed canvas.
    this.selectedTable = ObjectStore.instance.get<GameTable>(identifier);
    this.selectedTableXml = '';
  }

  viewSelectedTable() {
    if (this.GuestMode() || !this.selectedTable || !this.canActivate) return;
    // 啟用 = room Activate (same privilege as summon).
    this.tableSelecter.activateTable(this.selectedTable.identifier);
  }

  activateSelectedTable() {
    if (this.GuestMode() || !this.selectedTable || !this.canActivate) return;
    this.tableSelecter.activateTable(this.selectedTable.identifier);
  }

  get isViewingSelected(): boolean {
    return !!this.selectedTable && this.tableSelecter.viewedTableIdentifier === this.selectedTable.identifier;
  }

  get isActiveSelected(): boolean {
    return !!this.selectedTable && this.tableSelecter.viewTableIdentifier === this.selectedTable.identifier;
  }

  get canActivate(): boolean {
    return !!PeerCursor.myCursor?.isGMMode && !this.GuestMode();
  }

  get tableShowInNavigation(): boolean { return this.selectedTable?.showInNavigation ?? true; }
  set tableShowInNavigation(v: boolean) { if (this.isEditable && this.canActivate) this.selectedTable.showInNavigation = !!v; }

  get tablePlayerCanView(): boolean { return this.selectedTable?.playerCanView ?? true; }
  set tablePlayerCanView(v: boolean) { if (this.isEditable && this.canActivate) this.selectedTable.playerCanView = !!v; }

  getGameTables(): GameTable[] {
    return ObjectStore.instance.getObjects(GameTable);
  }

  createGameTable() {
    if (this.GuestMode()) return;
    let gameTable = new GameTable();
    gameTable.name = this.i18n.t('table.defaultName');
    gameTable.imageIdentifier = 'testTableBackgroundImage_image';
    gameTable.initialize();
    // Edit-only: do not Activate / switch room canvas — stay on current viewed map.
    this.selectGameTable(gameTable.identifier);
  }

  toggleSelectedInHud() {
    if (!this.isEditable || !this.canActivate || !this.selectedTable) return;
    this.selectedTable.showInNavigation = !this.selectedTable.showInNavigation;
  }

  async delete() {
    if (this.GuestMode()) return;
    if (this.isEmpty || !this.selectedTable) return;
    if (this.getGameTables().length <= 1) return;
    const name = (this.selectedTable.name || '').trim() || this.i18n.t('table.unnamed');
    const result = await this.modalService.open<boolean>(ConfirmationComponent, {
      title: this.i18n.t('table.deleteConfirm.title'),
      text: this.i18n.t('table.deleteConfirm.text', { name }),
      help: this.i18n.t('table.deleteConfirm.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete',
      okLabel: this.i18n.t('table.delete'),
    });
    if (result !== true) return;
    this.selectedTableXml = this.selectedTable.toXml();
    this.selectedTable.destroy();
  }

  confirm() {
    this.panelService.close();
  }

  async saveAsScene() {
    if (this.GuestMode() || !this.canActivate) return;
    const defaultTitle = this.selectedTable?.name || this.i18n.t('scenePreset.defaultTitle');
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
    await ScenePresetList.instance.createFromCurrentAsync(title);
  }

  cloneGameTable() {
    if (this.GuestMode()) return;
    if (!this.selectedTable || this.isDeleted) return;

    const source = this.selectedTable;
    const sourceId = source.identifier;
    const clone = source.clone();
    clone.selected = false;
    clone.name = source.name + this.i18n.t('table.cloneSuffix');

    const pieceTypes = [GameCharacter, Card, CardStack, DiceSymbol, TextNote, RangeArea];
    for (const type of pieceTypes) {
      for (const obj of ObjectStore.instance.getObjects(type as any) as TabletopObject[]) {
        if (obj.location.name !== 'table') continue;
        if (obj.parentIsAssigned && !obj.parentIsDestroyed) continue;
        // Room-scope notes stay shared across all tables.
        if (obj instanceof TextNote && obj.scope === 'room') continue;
        if (!obj.hasPlacement(sourceId) && obj.tableIdentifier !== sourceId) {
          if (obj.tableIdentifier || obj.tablePlacements) continue;
          if (TabletopObject.resolveViewTableIdentifier() !== sourceId) continue;
        }
        // Same SyncObject on both maps (shared HP / palette / claim).
        const pose = obj.getPoseForTable(sourceId) || {
          x: obj.location.x,
          y: obj.location.y,
          posZ: obj.posZ,
        };
        obj.setPoseForTable(clone.identifier, { ...pose }, false);
      }
    }

    this.selectGameTable(clone.identifier);
  }

  restore() {
    if (this.GuestMode()) return;
    if (this.selectedTable && this.selectedTableXml) {
      let restoreTable = ObjectSerializer.instance.parseXml(this.selectedTableXml);
      this.selectGameTable(restoreTable.identifier);
      this.selectedTableXml = '';
    }
  }

  getHidden(image: ImageFile): boolean {
    const imageTag = ImageTag.get(image.identifier);
    return imageTag ? imageTag.hide : false;
  }
  
  openBgImageModal() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.imageIdentifier) currentImageIdentifires = [this.selectedTable.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(async value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.imageIdentifier = value;
      const image = ImageStorage.instance.get(value);
      if (image) await fitGameTableSizeToImage(this.selectedTable, image, { min: this.minSize, max: this.maxSize });
      this.changeDetector.markForCheck();
    });
  }

  openDistanceViewImageModal() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.backgroundImageIdentifier) currentImageIdentifires = [this.selectedTable.backgroundImageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: true, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.backgroundImageIdentifier = value;
    });
  }

  openDistanceViewImageModal2() {
    if (this.GuestMode()) return;
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedTable && this.selectedTable.backgroundImageIdentifier2) currentImageIdentifires = [this.selectedTable.backgroundImageIdentifier2];
    this.modalService.open<string>(FileSelecterComponent, { isAllowedEmpty: true, currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedTable || !value) return;
      this.selectedTable.backgroundImageIdentifier2 = value;
    });
  }

  onShowHiddenImages($event: Event) {
    if (this.isShowHideImages) {
      this.isShowHideImages = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('table.confirmShowHidden.title'),
        text: this.i18n.t('table.confirmShowHidden.text'),
        help: this.i18n.t('table.confirmShowHidden.help'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.chatMessageService.sendOperationLog(this.i18n.t('table.operationShowHidden'));
          this.isShowHideImages = true;
          (<HTMLInputElement>$event.target).checked = true;
          this.changeDetector.markForCheck();
        } 
      });
    }
  }
}