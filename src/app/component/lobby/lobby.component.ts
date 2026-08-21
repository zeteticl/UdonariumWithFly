import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth, RoomJoinResult } from '@udonarium/room-auth';
import { RoomConnectHelper } from '@udonarium/room-connect-helper';

import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { PasswordCheckComponent } from 'component/password-check/password-check.component';
import { RoomJoinComponent } from 'component/room-join/room-join.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import { ModalService } from 'service/modal.service';
import { FolderBackupService } from 'service/folder-backup.service';
import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { RoomInviteService } from 'service/room-invite.service';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { ConnectionBusyService } from 'service/connection-busy.service';

@Component({
  selector: 'lobby',
  templateUrl: './lobby.component.html',
  styleUrls: ['../shared/settings-ui.css', './lobby.component.css'],
  standalone: false
})
export class LobbyComponent implements OnInit, OnDestroy {
  rooms: IRoomInfo[] = [];

  isReloading: boolean = false;

  help: string;

  static readonly DEFAULT_WIDTH = 690;
  static readonly DEFAULT_HEIGHT = 400;

  /** Auto-refresh while lobby is open (faster when empty). */
  private static readonly AUTO_REFRESH_MS = 10000;
  private static readonly AUTO_REFRESH_EMPTY_MS = 3000;

  private autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void this.reload(true);
    } else {
      this.stopAutoRefresh();
    }
  };

  /** Panel options for a centered normal window (not a modal). */
  static centeredPanelOption(extra: PanelOption = {}): PanelOption {
    const width = extra.width ?? LobbyComponent.DEFAULT_WIDTH;
    const height = extra.height ?? LobbyComponent.DEFAULT_HEIGHT;
    return {
      ...extra,
      width,
      height,
      left: extra.left ?? Math.max(0, Math.round((window.innerWidth - width) / 2)),
      top: extra.top ?? Math.max(0, Math.round((window.innerHeight - height) / 2)),
      tourPanelId: extra.tourPanelId ?? 'menu.lobby',
    };
  }

  get currentRoom(): string { return Network.peer.roomId };
  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }
  get canShowLoadRoom(): boolean {
    return this.folderBackup.isSupported && !Network.GuestMode();
  }

  /** Bound → load room; needAuth/error → reauth; unbound → bind folder. */
  get folderBackupActionLabelKey(): string {
    if (this.folderBackup.isReady) return 'menu.folderBackup.loadRoom';
    if (this.folderBackup.status === 'needAuth' || this.folderBackup.hasError) {
      return 'menu.folderBackup.reauth';
    }
    return 'menu.folderBackup.bind';
  }

  get canLoadRoom(): boolean { return SceneToolPermission.instance.canLoadRoom(); }

  /** Load-room action is blocked for players unless permission allows (bind/reauth still OK). */
  get isFolderLoadDisabled(): boolean {
    if (this.folderBackup.status === 'writing') return true;
    return this.folderBackup.isReady && !this.canLoadRoom;
  }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
    public folderBackup: FolderBackupService,
    private roomInvite: RoomInviteService,
    private ngZone: NgZone,
    public connectionBusy: ConnectionBusyService,
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.changeTitle());
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => {
        this.changeTitle();
      })
      .on('CONNECT_PEER', event => {
        this.changeTitle();
      })
      .on('LOCALE_CHANGED', () => {
        this.changeTitle();
        this.refreshHelp();
      });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.help = this.i18n.t('lobby.helpInitial');
    this.reload();
  }

  private changeTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('lobby.title');
    if (Network.peer.roomName.length) {
      const name = RoomAuth.displayRoomName(Network.peer.roomName);
      this.modalService.title = this.panelService.title = this.i18n.t('lobby.titleRoom', { name, id: Network.peer.roomId });
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.stopAutoRefresh();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    EventSystem.unregister(this);
  }

  async reload(silent = false) {
    if (this.isReloading) {
      this.scheduleAutoRefresh();
      return;
    }
    this.isReloading = true;
    if (!silent || this.rooms.length < 1) {
      this.help = this.i18n.t('lobby.helpSearching');
    }
    // Manual / empty: force Find. Silent auto-refresh with rooms: use cache TTL.
    const force = !silent || this.rooms.length < 1;
    // SkyWay awaits may resume outside NgZone; apply results inside so the table updates.
    let rooms = await Network.listAllRooms(force);
    if (rooms.length < 1 && !silent) {
      await new Promise<void>(resolve => setTimeout(resolve, 600));
      rooms = await Network.listAllRooms(true);
    }
    if (this.destroyed) return;
    this.ngZone.run(() => {
      this.rooms = RoomConnectHelper.filterLobbyRooms(rooms);
      this.help = this.i18n.t('lobby.helpEmpty');
      this.isReloading = false;
      this.scheduleAutoRefresh();
    });
  }

  private scheduleAutoRefresh() {
    this.stopAutoRefresh();
    if (this.destroyed || this.isConnected) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const delay = this.rooms.length < 1
      ? LobbyComponent.AUTO_REFRESH_EMPTY_MS
      : LobbyComponent.AUTO_REFRESH_MS;
    this.autoRefreshTimer = setTimeout(() => {
      void this.reload(true);
    }, delay);
  }

  private stopAutoRefresh() {
    if (this.autoRefreshTimer != null) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  displayRoomName(room: IRoomInfo): string {
    return RoomAuth.displayRoomName(room.name);
  }

  isRoleAuthRoom(room: IRoomInfo): boolean {
    return RoomAuth.isRoleAuthRoom(room.name);
  }

  roomHasLock(room: IRoomInfo): boolean {
    if (RoomAuth.isRoleAuthRoom(room.name)) return RoomAuth.hasAnyRolePassword(room.name);
    return room.hasPassword;
  }

  isAllowGuest(room: IRoomInfo): boolean {
    if (RoomAuth.isRoleAuthRoom(room.name)) {
      return RoomAuth.isRoleAvailable(room.name, 'guest');
    }
    return GuestSession.isAllowGuestRoomName(room.name);
  }

  async connect(room: IRoomInfo, asGuest: boolean = false) {
    if (this.connectionBusy.busy) return;
    if (RoomAuth.isRoleAuthRoom(room.name)) {
      await this.connectWithRole(room);
      return;
    }
    await this.connectLegacy(room, asGuest);
  }

  private async connectWithRole(room: IRoomInfo) {
    const result = await this.modalService.open<RoomJoinResult>(RoomJoinComponent, {
      room,
      width: 420,
      height: 360,
    });
    if (!result) return;

    const meshPassword = RoomAuth.resolveMeshPassword(
      room.id, room.name, result.role, result.password || RoomAuth.getSessionRolePassword(result.role));
    // Mesh is channel-only; peerIds have empty password digests.
    const targetPeers = room.filterByPassword('');
    if (targetPeers.length < 1) return;

    const rolePw = result.password || RoomAuth.getSessionRolePassword(result.role);
    RoomAuth.applyIdentity(result.role, room.id);
    RoomAuth.rememberSession(result.role, rolePw, meshPassword);
    this.roomInvite.setRolePassword(result.role, rolePw);
    await this.openAndConnect(room, meshPassword, targetPeers);
  }

  private async connectLegacy(room: IRoomInfo, asGuest: boolean) {
    let password = '';
    const allowGuest = this.isAllowGuest(room);

    if (room.hasPassword) {
      password = await this.modalService.open<string>(PasswordCheckComponent, { peers: room.peers, title: `${this.displayRoomName(room)}/${room.id}` });
      if (password == null) password = '';
    }

    let targetPeers = room.filterByPassword(password);
    if (targetPeers.length < 1) return;

    GuestSession.isGuest = !!(allowGuest && asGuest);
    if (PeerCursor.myCursor) {
      PeerCursor.isGMHold = false;
      PeerCursor.myCursor.isGMMode = false;
    }
    await this.openAndConnect(room, password, targetPeers);
  }

  private async openAndConnect(room: IRoomInfo, password: string, targetPeers: any[]) {
    const connected = await RoomConnectHelper.openAndConnect(room, password, targetPeers);
    if (connected) {
      this.dismissLobby();
      return;
    }
    if (this.destroyed) return;
    const failKey = RoomConnectHelper.joinFailMessageKey(RoomConnectHelper.lastJoinFailReason);
    this.help = this.i18n.t(`${failKey}.help`);
    const popup = this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t(`${failKey}.title`),
      text: this.i18n.t(`${failKey}.text`),
      help: this.i18n.t(`${failKey}.help`),
      type: ConfirmationType.OK,
      materialIcon: 'link_off',
    });
    void this.reload(true);
    await popup;
    if (!this.destroyed) this.help = this.i18n.t(`${failKey}.help`);
  }

  async showRoomSetting() {
    if (this.connectionBusy.busy) return;
    let isCreate = await this.modalService.open(RoomSettingComponent, { width: 690, height: 600, left: 0, top: 80 });
    if (isCreate) this.dismissLobby();
    this.help = this.i18n.t('lobby.helpInitial');
  }

  /** Bind folder if needed, then open the room-backup picker. */
  async loadFolderBackup() {
    if (!this.canShowLoadRoom) return;
    if (this.folderBackup.isReady && !this.canLoadRoom) return;
    if (!(await this.folderBackup.ensureBound())) return;
    if (!this.canLoadRoom) return;
    await this.folderBackup.openLoadUi();
    if (Network.peer?.isRoom) this.dismissLobby();
  }

  /** Close whether lobby was opened as a panel or (legacy) modal. */
  private dismissLobby() {
    this.modalService.resolve();
    this.panelService.close();
  }

  private refreshHelp() {
    if (this.isReloading) {
      this.help = this.i18n.t('lobby.helpSearching');
    } else if (this.rooms.length < 1) {
      this.help = this.i18n.t('lobby.helpEmpty');
    } else {
      this.help = this.i18n.t('lobby.helpInitial');
    }
  }
}
