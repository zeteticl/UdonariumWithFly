import { AfterViewInit, Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { IPeerContext, PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerSessionGrade } from '@udonarium/core/system/network/peer-session-state';
import { FileArchiver } from '@udonarium/core/file-storage/file-archiver';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoomAuth } from '@udonarium/room-auth';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { LobbyComponent } from 'component/lobby/lobby.component';
import { RolePasswordPromptComponent } from 'component/role-password-prompt/role-password-prompt.component';
import { RoomJoinComponent } from 'component/room-join/room-join.component';
import { RoomSettingComponent } from 'component/room-setting/room-setting.component';
import { AppConfig, AppConfigService } from 'service/app-config.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';
import { animate, style, transition, trigger } from '@angular/animations';
import { ChatMessageService } from 'service/chat-message.service';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { FolderBackupService } from 'service/folder-backup.service';
import { AppUpdateService } from 'service/app-update.service';
import { I18nService } from 'service/i18n.service';
import { RoomInviteService } from 'service/room-invite.service';
import { SaveDataService } from 'service/save-data.service';
import { AppLocale } from 'i18n';
import { GameCharacter } from '@udonarium/game-character';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { RoomInfo } from '@udonarium/core/system/network/room-info';
import { RoomJoinResult, RoomRole } from '@udonarium/room-auth';
import { SceneToolPermission } from '@udonarium/table-fx/scene-tool-permission';
import { appVersion } from '../../../environments/version';

import * as localForage from 'localforage';

@Component({
    selector: 'peer-menu',
    templateUrl: './peer-menu.component.html',
    styleUrls: ['../shared/settings-ui.css', './peer-menu.component.css'],
    animations: [
        trigger('fadeInOut', [
            transition('false => true', [
                animate('50ms ease-in-out', style({ opacity: 1.0 })),
                animate('900ms ease-in-out', style({ opacity: 0 }))
            ])
        ])
    ],
    standalone: false
})
export class PeerMenuComponent implements OnInit, OnDestroy, AfterViewInit {
  targetUserId: string = '';
  networkService = Network
  gameRoomService = ObjectStore.instance;

  isCopied = false;
  isRoomNameCopied = false;
  isPasswordCopied = false;
  isPasswordOpen = false;
  isRoomInfoCopied = false;
  inviteCopiedRole: RoomRole = null;
  isDownloadingZip = false;
  downloadZipPercent = 0;

  help: string = '';

  private _timeOutId: NodeJS.Timeout;
  private _timeOutId2: NodeJS.Timeout;
  private _timeOutId3: NodeJS.Timeout;
  private _timeOutId4: NodeJS.Timeout;
  private _timeOutIdInvite: NodeJS.Timeout;

  private interval: NodeJS.Timeout = null;
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }

  get myPeerName(): string {
    if (!PeerCursor.myCursor) return null;
    return PeerCursor.myCursor.name;
  }
  set myPeerName(name: string) {
    if (!PeerCursor.myCursor) return;
    // Never auto-fill while editing. Default name is only assigned once at
    // createMyCursor() when no saved nickname exists (first visit).
    PeerCursor.myCursor.name = name ?? '';
    const trimmed = PeerCursor.myCursor.name.trim();
    if (!trimmed) {
      localForage.removeItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    } else {
      localForage.setItem(PeerCursor.CHAT_MY_NAME_LOCAL_STORAGE_KEY, PeerCursor.myCursor.name).catch(e => console.log(e));
    }
  }

  get myPeerColor(): string {
    if (!PeerCursor.myCursor) return PeerCursor.CHAT_DEFAULT_COLOR;
    return PeerCursor.myCursor.color;
  }
  set myPeerColor(color: string) {
    if (color && PeerCursor.myCursor) {
      color = color.trim().toLowerCase();
      if (!/^\#[0-9a-f]{6}$/.test(color)) return; 
      PeerCursor.myCursor.color = (color == PeerCursor.CHAT_TRANSPARENT_COLOR) ? PeerCursor.CHAT_DEFAULT_COLOR : color;
      if (PeerCursor.myCursor.color === PeerCursor.CHAT_DEFAULT_COLOR) {
        localForage.removeItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY).catch(e => console.log(e));
      } else {
        localForage.setItem(PeerCursor.CHAT_MY_COLOR_LOCAL_STORAGE_KEY, PeerCursor.myCursor.color).catch(e => console.log(e));
      }
    }
  }

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }
  set isGMMode(isGMMode: boolean) { if (PeerCursor.myCursor) PeerCursor.myCursor.isGMMode = isGMMode; }

  get isGMHold(): boolean { return PeerCursor.isGMHold; }

  get displayRoomName(): string {
    return RoomAuth.displayRoomName(this.networkService.peer.roomName || '');
  }
  get displayRoomLabel(): string {
    return this.displayRoomName + '/' + this.networkService.peer.roomId;
  }
  get isRoleAuthRoom(): boolean {
    return RoomAuth.isRoleAuthRoom(this.networkService.peer.roomName || '');
  }
  get isGuest(): boolean { return GuestSession.isGuest; }

  get currentRole(): RoomRole {
    if (this.isGuest) return 'guest';
    if (this.isGMMode || this.isGMHold) return 'gm';
    return 'user';
  }

  get currentRoleLabel(): string {
    switch (this.currentRole) {
      case 'gm': return this.i18n.t('peer.role.gm');
      case 'guest': return this.i18n.t('peer.role.guest');
      default: return this.i18n.t('peer.role.user');
    }
  }

  get maskedPassword(): string { return '●●●●●●●●' }
  get config(): AppConfig { return AppConfigService.appConfig; }
  get canUsePrivateSession(): boolean { return this.config.backend.mode == 'skyway'; }
  /** Build stamp: commit time in local TZ, short SHA, branch. */
  get appVersionDisplay(): string {
    const d = new Date(appVersion.committedAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = Number.isNaN(d.getTime())
      ? appVersion.committedAt
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${date} ${appVersion.sha} ${appVersion.branch}`;
  }
  get canLoadZip(): boolean { return SceneToolPermission.instance.canLoadZip(); }
  get canLoadRoom(): boolean { return SceneToolPermission.instance.canLoadRoom(); }

  constructor(
    private ngZone: NgZone,
    private modalService: ModalService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    private roomInvite: RoomInviteService,
    public appConfigService: AppConfigService,
    public i18n: I18nService,
    public folderBackup: FolderBackupService,
    public appUpdate: AppUpdateService,
    private saveDataService: SaveDataService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  onLocaleChange(locale: AppLocale) {
    this.i18n.setLocale(locale);
    this.refreshPanelTitle();
  }

  async confirmApplyUpdate(e?: Event) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!this.appUpdate.isUpdateReady) return;
    const result = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('update.title'),
      text: this.i18n.t('update.text'),
      // update.help contains HTML; Confirmation uses helpHtml + safe pipe.
      helpHtml: this.i18n.t('update.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'system_update',
      okLabel: this.i18n.t('update.restart'),
    });
    if (result === false || result == null) return;
    if (this.folderBackup.isReady) {
      await this.folderBackup.flush({ timeoutMs: 60000 });
    }
    document.location.reload();
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('peer.title');
  }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.refreshPanelTitle();
      this.panelService.isAbleFullScreenButton = false;
    });
  }

  ngAfterViewInit() {
    EventSystem.register(this)
      .on('OPEN_NETWORK', event => {
        this.ngZone.run(() => this.syncPeerHealthPoll());
      })
      .on('CONNECT_PEER', () => this.ngZone.run(() => this.syncPeerHealthPoll()))
      .on('DISCONNECT_PEER', () => this.ngZone.run(() => this.syncPeerHealthPoll()))
      .on('LOCALE_CHANGED', () => this.ngZone.run(() => this.refreshPanelTitle()))
      .on('APP_UPDATE_READY', () => this.ngZone.run(() => this.syncPeerHealthPoll()));
    this.syncPeerHealthPoll();
  }

  /** Peer health/ping stats need a 1s CD tick only while peers are present. */
  private syncPeerHealthPoll() {
    const need = (this.networkService.peers?.length || 0) > 0;
    if (need) {
      if (this.interval) return;
      this.ngZone.runOutsideAngular(() => {
        this.interval = setInterval(() => {
          this.ngZone.run(() => { });
        }, 1000);
      });
    } else if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  ngOnDestroy() {
    clearTimeout(this._timeOutId);
    clearTimeout(this._timeOutId2);
    clearTimeout(this._timeOutId3);
    clearTimeout(this._timeOutId4);
    clearTimeout(this._timeOutIdInvite);
    EventSystem.unregister(this);
    if (this.interval) clearInterval(this.interval);
  }

  isInviteRoleAvailable(role: RoomRole): boolean {
    if (!this.isRoleAuthRoom) return false;
    return RoomAuth.isRoleAvailable(this.networkService.peer.roomName || '', role);
  }

  async copyInvite(role: RoomRole) {
    if (!navigator.clipboard || !this.networkService.peer.isRoom || !this.isRoleAuthRoom) return;
    if (!this.isInviteRoleAvailable(role)) return;

    const roomId = this.networkService.peer.roomId;
    const roomName = this.networkService.peer.roomName || '';
    let password = '';

    if (RoomAuth.roleNeedsPassword(roomName, role)) {
      password = this.roomInvite.getRolePassword(role);
      if (!password) {
        const entered = await this.modalService.open<string>(RolePasswordPromptComponent, {
          roomId,
          roomName,
          role,
          width: 420,
          height: 280,
        });
        if (entered == null) return;
        password = entered;
        this.roomInvite.setRolePassword(role, password);
      }

      const confirmed = await this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('peer.confirm.copyInvite.title'),
        text: this.i18n.t('peer.confirm.copyInvite.text', { role: this.roleLabel(role) }),
        helpHtml: this.i18n.t('peer.confirm.copyInvite.help') + '<br>' + this.i18n.t('peer.confirm.passwordShareHelp'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'link',
      });
      if (!confirmed) return;
    }

    try {
      const url = this.roomInvite.buildInviteUrl(role, password || undefined);
      await navigator.clipboard.writeText(url);
      this.inviteCopiedRole = role;
      clearTimeout(this._timeOutIdInvite);
      this._timeOutIdInvite = setTimeout(() => {
        this.inviteCopiedRole = null;
      }, 1000);
    } catch (e) {
      console.warn('copyInvite failed', e);
    }
  }

  changeIcon() {
    let currentImageIdentifires: string[] = [];
    if (this.myPeer && this.myPeer.imageIdentifier) currentImageIdentifires = [this.myPeer.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.myPeer || !value) return;
      this.myPeer.imageIdentifier = value;
      let file: ImageFile = ImageStorage.instance.get(value);
      if (file) {
        if (file.state === ImageState.COMPLETE) {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, file.blob).catch(e => console.log(e));
        } else if (value === 'none_icon') {
          localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY).catch(e => console.log(e));
        } else {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, value).catch(e => console.log(e));
        }
      }
    });
  }

  connectPeer() {
    let targetUserId = this.targetUserId;
    this.targetUserId = '';
    if (targetUserId.length < 1) return;
    this.help = '';
    let peer = PeerContext.create(targetUserId);
    if (peer.isRoom) return;
    ObjectStore.instance.clearDeleteHistory();
    Network.connect(peer);
    if (PeerCursor.isGMHold || this.isGMMode) {
      const wasGM = this.isGMMode;
      PeerCursor.isGMHold = false;
      this.isGMMode = false;
      if (wasGM) {
        this.chatMessageService.sendOperationLog(this.i18n.t('peer.leaveGm'));
        EventSystem.trigger('CHANGE_GM_MODE', null);
      }
    }
  }

  showLobby() {
    PanelService.closePanelsByTourId('menu.lobby');
    this.panelService.open(LobbyComponent, LobbyComponent.centeredPanelOption({
      title: this.i18n.t('lobby.title'),
    }));
  }

  showCreateRoom() {
    this.modalService.open(RoomSettingComponent, { width: 690, height: 600, left: 0, top: 80 });
  }

  editRoomPasswords() {
    if (!this.isGMMode || !this.isRoleAuthRoom || !this.networkService.peer.isRoom) return;
    this.modalService.open(RoomSettingComponent, {
      editMode: true,
      width: 690,
      height: 600,
      left: 0,
      top: 80,
    });
  }

  loadZip() {
    if (this.GuestMode() || !this.networkService.peer.isRoom || !this.canLoadZip) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'application/xml,text/xml,application/zip';
    input.onchange = (event: Event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files?.length) FileArchiver.instance.load(files);
      input.value = '';
    };
    input.click();
  }

  bindFolderBackup() {
    if (this.GuestMode()) return;
    void this.folderBackup.ensureBound();
  }

  async saveFolderBackup() {
    if (this.GuestMode() || !this.networkService.peer?.isRoom) return;
    if (!(await this.folderBackup.ensureBound())) return;
    await this.folderBackup.flush({ timeoutMs: 60000 });
  }

  loadFolderBackup() {
    if (this.GuestMode() || !this.folderBackup.canLoadFromFolder || !this.canLoadRoom) return;
    void this.folderBackup.openLoadUi();
  }

  async downloadZip() {
    if (this.GuestMode() || !this.networkService.peer?.isRoom || this.isDownloadingZip) return;
    const includeAudio = await this.saveDataService.askIncludeAudio('zip');
    if (includeAudio == null) return;
    this.isDownloadingZip = true;
    this.downloadZipPercent = 0;
    const roomName = 0 < this.networkService.peer.roomName.length
      ? this.networkService.peer.roomName
      : 'HKTRPG';
    try {
      await this.saveDataService.saveRoomAsync(roomName, percent => {
        this.downloadZipPercent = percent;
      }, includeAudio);
    } finally {
      setTimeout(() => {
        this.isDownloadingZip = false;
        this.downloadZipPercent = 0;
      }, 500);
    }
  }

  stringFromSessionGrade(grade: PeerSessionGrade): string {
    return PeerSessionGrade[grade] ?? PeerSessionGrade[PeerSessionGrade.UNSPECIFIED];
  }

  candidateLabel(description: string): string {
    if (!description) return this.i18n.t('peer.candidate.unknown');
    const key = `peer.candidate.${description}`;
    const label = this.i18n.t(key);
    return label === key ? description : label;
  }

  findUserId(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.userId : '';
  }

  findPeerName(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.name : '';
  }

  findPeerColor(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.color : '';
  }

  findPeerImageUrl(peerId: string) {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.image.url : '';
  }

  findPeerIsGMMode(peerId: string): boolean {
    const peerCursor = PeerCursor.findByPeerId(peerId);
    return peerCursor ? peerCursor.isGMMode : false;
  }

  kickPeer(peer: IPeerContext) {
    if (!this.isGMMode || !peer?.peerId || peer.peerId === this.networkService.peerId) return;
    const name = this.findPeerName(peer.peerId) || peer.userId || peer.peerId;
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('peer.kick.confirmTitle'),
      text: this.i18n.t('peer.kick.confirmText', { name }),
      help: this.i18n.t('peer.kick.confirmHelp'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'person_remove',
      action: () => {
        EventSystem.call('KICK_PEER', {
          byPeerId: this.networkService.peerId,
          byName: this.myPeerName || this.networkService.peer.userId || '',
        }, peer.peerId);
        // Allow the kick message to flush before tearing down the link.
        setTimeout(() => {
          this.networkService.disconnect(peer);
        }, 250);
        this.chatMessageService.sendOperationLog(this.i18n.t('peer.kick.log', { name }));
      },
    });
  }

  copyPeerId() {
    if (navigator.clipboard && this.canUsePrivateSession) {
      navigator.clipboard.writeText(this.networkService.peer.userId);
      this.isCopied = true;
      clearTimeout(this._timeOutId);
      this._timeOutId = setTimeout(() => {
        this.isCopied = false;
      }, 1000);
    }
  }

  copyRoomName() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(this.displayRoomLabel);
      this.isRoomNameCopied = true;
      clearTimeout(this._timeOutId2);
      this._timeOutId2 = setTimeout(() => {
        this.isRoomNameCopied = false;
      }, 1000);
    }
  }

  copyPassword() {
    if (navigator.clipboard) {
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('peer.confirm.copyPassword.title'),
        text: this.i18n.t('peer.confirm.copyPassword.text'),
        helpHtml: this.i18n.t('peer.confirm.passwordShareHelp'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'content_copy',
        action: () => {
          navigator.clipboard.writeText(this.networkService.peer.password);
          this.isPasswordCopied = true;
          clearTimeout(this._timeOutId3);
          this._timeOutId3 = setTimeout(() => {
            this.isPasswordCopied = false;
          }, 1000);
        }
      });
      this.isPasswordOpen = false;
    }
  }

  copyRoomInfo() {
    if (navigator.clipboard) {
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('peer.confirm.copyRoomInfo.title'),
        text: this.i18n.t('peer.confirm.copyRoomInfo.text'),
        helpHtml: this.i18n.t('peer.confirm.passwordShareHelp'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'content_copy',
        action: () => {
          navigator.clipboard.writeText(this.i18n.t('peer.clipboardRoomInfo', {
            room: this.networkService.peer.roomName + '/' + this.networkService.peer.roomId,
            password: this.networkService.peer.password,
          }));
          this.isRoomInfoCopied = true;
          clearTimeout(this._timeOutId4);
          this._timeOutId4 = setTimeout(() => {
            this.isRoomInfoCopied = false;
          }, 1000);
        }
      });
      this.isPasswordOpen = false;
    }
  }

  isAbleClipboardCopy(): boolean {
    return navigator.clipboard ? true : false;
  }

  onPasswordOpen($event: Event) {
    if (this.isPasswordOpen) {
      this.isPasswordOpen = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('peer.confirm.showPassword.title'),
        text: this.i18n.t('peer.confirm.showPassword.text'),
        helpHtml: this.i18n.t('peer.confirm.showPassword.help') + '<br>' + this.i18n.t('peer.confirm.passwordShareHelp'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.isPasswordOpen = true;
          (<HTMLInputElement>$event.target).checked = true;
          //this.changeDetector.markForCheck();
        }
      });
    }
  }

  async switchIdentity() {
    const peer = this.networkService.peer;
    const room = peer.isRoom
      ? new RoomInfo(peer.roomId, peer.roomName, [peer as any])
      : new RoomInfo('local', RoomAuth.encode(this.i18n.t('peer.localRoom'), 'local', { gm: '', user: '', guest: '' }).roomName, []);

    const result = await this.modalService.open<RoomJoinResult>(RoomJoinComponent, {
      room,
      switchMode: true,
      currentRole: this.currentRole,
      width: 420,
      height: 380,
    });
    if (!result) return;

    const label = result.role === 'gm'
      ? this.i18n.t('peer.role.gm')
      : (result.role === 'guest' ? this.i18n.t('peer.role.guest') : this.i18n.t('peer.role.user'));
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('peer.confirm.switchIdentity.title'),
      text: this.i18n.t('peer.confirm.switchIdentity.text', { role: label }),
      helpHtml: result.role === 'gm'
        ? this.i18n.t('peer.confirm.switchIdentity.helpGm')
        : (result.role === 'guest'
          ? this.i18n.t('peer.confirm.switchIdentity.helpGuest')
          : this.i18n.t('peer.confirm.switchIdentity.helpUser')),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'swap_horiz',
      action: () => {
        void (async () => {
          const prev = this.currentRole;
          if (result.role === 'guest' && prev !== 'guest') {
            await this.folderBackup.flush({ timeoutMs: 60000 });
          }
          RoomAuth.applyIdentity(result.role, peer.roomId || Network.peer?.roomId || '');
          this.roomInvite.setRolePassword(result.role, result.password || '');
          RoomAuth.rememberSession(
            result.role,
            result.password || RoomAuth.getSessionRolePassword(result.role),
            RoomAuth.getSessionMeshPassword() || Network.peer?.password || undefined,
          );
          // Clear legacy hold state.
          PeerCursor.isGMHold = false;
          this.chatMessageService.sendOperationLog(this.i18n.t('peer.roleSwitchLog', {
            from: this.roleLabel(prev),
            to: label
          }));
          EventSystem.trigger('CHANGE_GM_MODE', null);
          if (prev === 'gm' && result.role !== 'gm' && GameCharacter.isStealthMode) {
            this.modalService.open(ConfirmationComponent, {
              title: this.i18n.t('peer.confirm.stealth.title'),
              text: this.i18n.t('peer.confirm.stealth.text'),
              help: this.i18n.t('peer.confirm.stealth.help'),
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
        })();
      }
    });
  }

  private roleLabel(role: RoomRole): string {
    switch (role) {
      case 'gm': return this.i18n.t('peer.role.gm');
      case 'guest': return this.i18n.t('peer.role.guest');
      default: return this.i18n.t('peer.role.user');
    }
  }

  healthIcon(helth) {
    if (helth >= 0.99) return 'sentiment_very_satisfied';
    if (helth > 0.97) return 'sentiment_dissatisfied';
    if (helth > 0.95) return 'mood_bad';
    return 'sentiment_very_dissatisfied';
  }

  healthClass(helth) {
    if (helth >= 0.99) return 'health-blue';
    if (helth > 0.97) return 'health-green';
    if (helth > 0.95) return 'health-yellow';
    return 'health-red';
  }
}
