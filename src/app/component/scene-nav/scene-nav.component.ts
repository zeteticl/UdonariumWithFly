import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameTable } from '@udonarium/game-table';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenePresetList } from '@udonarium/scene-preset-list';
import { TableSelecter } from '@udonarium/table-selecter';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { GameTableSettingComponent } from 'component/game-table-setting/game-table-setting.component';
import { I18nService } from 'service/i18n.service';
import { MobileLayoutService } from 'service/mobile-layout.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'scene-nav',
  templateUrl: './scene-nav.component.html',
  styleUrls: ['./scene-nav.component.css'],
  standalone: false,
})
export class SceneNavComponent implements OnInit, OnDestroy {
  collapsed = false;
  /** Table id whose hover flyout is open. */
  openMenuId: string = '';
  private menuLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private i18n: I18nService,
    private ngZone: NgZone,
    private panelService: PanelService,
    private mobileLayout: MobileLayoutService,
    private modalService: ModalService,
  ) {}

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        // Table / selecter / peer presence (viewed scene + color) — skip piece moves.
        const id = event.data?.identifier;
        if (id === 'TableSelecter') {
          this.refresh();
          return;
        }
        if (typeof id !== 'string') return;
        const obj = ObjectStore.instance.get(id);
        if (obj instanceof GameTable || obj instanceof PeerCursor) {
          this.refresh();
        }
      })
      .on('SELECT_GAME_TABLE', () => this.refresh())
      .on('DELETE_GAME_OBJECT', () => this.refresh())
      .on('CONNECT_PEER', event => {
        if (!event.isSendFromSelf) return;
        this.ngZone.runOutsideAngular(() => {
          setTimeout(() => {
            TableSelecter.instance.ensureActiveOrFirst();
            this.ngZone.run(() => this.refresh());
          }, 400);
        });
      });
  }

  ngOnDestroy() {
    this.clearMenuLeaveTimer();
    EventSystem.unregister(this);
  }

  private refresh() {
    this.changeDetector.detectChanges();
  }

  private clearMenuLeaveTimer() {
    if (this.menuLeaveTimer != null) {
      clearTimeout(this.menuLeaveTimer);
      this.menuLeaveTimer = null;
    }
  }

  get tables(): GameTable[] {
    return ObjectStore.instance.getObjects<GameTable>(GameTable)
      .filter(t => t.showInNavigation);
  }

  get selecter(): TableSelecter {
    return TableSelecter.instance;
  }

  get isGM(): boolean {
    return !!PeerCursor.myCursor?.isGMMode && !Network.GuestMode();
  }

  isGuest(): boolean {
    return Network.GuestMode();
  }

  /** Room-wide active scene (Foundry Active). */
  isActive(table: GameTable): boolean {
    return this.selecter.activeTableIdentifier === table.identifier;
  }

  /** Local canvas scene (Foundry Viewed). */
  isViewed(table: GameTable): boolean {
    return this.selecter.viewedTableIdentifier === table.identifier;
  }

  canView(table: GameTable): boolean {
    return this.isGM || !!table.playerCanView;
  }

  chipTitle(table: GameTable): string {
    const name = (table.name || '').trim() || this.i18n.t('table.unnamed');
    if (this.isActive(table) && this.isViewed(table)) {
      return `${name} — ${this.i18n.t('table.activeHint')}`;
    }
    if (this.isActive(table)) return `${name} — ${this.i18n.t('table.activeHint')}`;
    if (this.isViewed(table)) return `${name} — ${this.i18n.t('table.viewingHint')}`;
    return name;
  }

  /** Peers currently viewing this map (color dots under the chip). */
  peersOn(table: GameTable): PeerCursor[] {
    return ObjectStore.instance.getObjects<PeerCursor>(PeerCursor)
      .filter(p => !!p.viewedSceneIdentifier && p.viewedSceneIdentifier === table.identifier);
  }

  peerDotTitle(peer: PeerCursor): string {
    return (peer.name || '').trim() || peer.userId || peer.peerId || '';
  }

  onChipEnter(table: GameTable) {
    if (!this.canView(table) && !this.isGM) return;
    this.clearMenuLeaveTimer();
    this.openMenuId = table.identifier;
  }

  onChipLeave(event: MouseEvent, table: GameTable) {
    const wrap = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget as Node | null;
    // Moving into chip / presence / bridge / menu (all inside wrap) is not a leave.
    if (wrap && related && wrap.contains(related)) return;
    this.clearMenuLeaveTimer();
    this.menuLeaveTimer = setTimeout(() => {
      this.menuLeaveTimer = null;
      if (this.openMenuId === table.identifier) {
        this.openMenuId = '';
        this.changeDetector.markForCheck();
      }
    }, 450);
  }

  isMenuOpen(table: GameTable): boolean {
    return this.openMenuId === table.identifier;
  }

  /** Left-click tag: View locally (does not pull others). */
  onChipClick(table: GameTable, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canView(table)) return;
    this.selecter.viewTableLocal(table.identifier);
  }

  /** GM: Activate room scene (set active + pull everyone, including self). */
  viewTable(table: GameTable, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM || !table) return;
    this.selecter.activateTable(table.identifier);
    this.openMenuId = '';
  }

  /** Activate + pull everyone to this scene (GM). Same as 啟用. */
  summonAll(table: GameTable, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM) return;
    this.selecter.activateTable(table.identifier);
    this.openMenuId = '';
  }

  /** Hide this map from the scene HUD (GM). Re-enable via map settings. */
  hideFromHud(table: GameTable, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM || !table) return;
    table.showInNavigation = false;
    this.openMenuId = '';
  }

  /** Save the currently viewed map as a scene preset (GM only). */
  async saveCurrentScene(table: GameTable, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isGM || !table || !this.isViewed(table)) return;
    this.openMenuId = '';
    const defaultTitle = (table.name || '').trim() || this.i18n.t('scenePreset.defaultTitle');
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

  openMapSettings(table: GameTable, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.isGuest()) return;
    // Edit-only: do not change viewed/active canvas.
    GameTableSettingComponent.pendingEditTableId = table.identifier;
    PanelService.closePanelsByTourId('menu.table');
    let option = {
      width: 620,
      height: 520,
      left: 100,
      title: this.i18n.t('table.title'),
      tourPanelId: 'menu.table',
      mobileReplace: true,
      mobileSheet: 'half' as const,
    };
    option = this.mobileLayout.adaptPanelOption(option);
    this.panelService.open(GameTableSettingComponent, option);
    this.openMenuId = '';
  }
}
