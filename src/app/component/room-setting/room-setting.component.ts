import { Component, OnDestroy, OnInit } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { PeerCursor } from '@udonarium/peer-cursor';
import { RoleAuthInput, RoomAuth } from '@udonarium/room-auth';
import { RoomConnectHelper } from '@udonarium/room-connect-helper';

import { ModalService } from 'service/modal.service';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';
import { RoomInviteService } from 'service/room-invite.service';
import { ConnectionBusyService } from 'service/connection-busy.service';

@Component({
    selector: 'room-setting',
    templateUrl: './room-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './room-setting.component.css'],
    standalone: false
})
export class RoomSettingComponent implements OnInit, OnDestroy {
  /** When true, edit data of the current role-auth room (GM only). */
  editMode = false;
  /** When set, reopen this roomId instead of minting a new one (folder backup resume). */
  preferredRoomId = '';
  /** Auth restore state for resume hints. */
  preferredAuthStatus: 'ready' | 'legacy' | 'missing' | 'undecryptable' | '' = '';
  roomName: string;
  gmPassword: string = '';
  userPassword: string = '';
  guestPassword: string = '';
  /** Allow player (user) role to join. */
  allowUser = true;
  /** Allow guest role to join. Off by default for new rooms. */
  allowGuest = false;
  isSaving = false;
  help: string = '';
  /** Permission panel is collapsed until the user opens it. */
  showPermissions = false;

  get peerId(): string { return Network.peerId; }
  get isConnected(): boolean { return 0 < Network.peerIds.length; }
  get isResume(): boolean { return !this.editMode && !!this.preferredRoomId; }

  get resumeAuthHintKey(): string {
    switch (this.preferredAuthStatus) {
      case 'ready': return 'room.resumeAuth.ready';
      case 'legacy': return 'room.resumeAuth.legacy';
      case 'undecryptable': return 'room.resumeAuth.undecryptable';
      case 'missing': return 'room.resumeAuth.missing';
      default: return '';
    }
  }
  validateLength: boolean = false;
  /** Pending Network.open for createRoom; cleared on settle / destroy. */
  private createRoomKey: { createRoom: true } | null = null;
  private createRoomTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
    private roomInvite: RoomInviteService,
    public connectionBusy: ConnectionBusyService,
  ) {
    this.editMode = !!modalService.option?.editMode;
    const preferred = String(modalService.option?.preferredRoomId || '').trim();
    if (/^[A-Za-z0-9_-]{1,32}$/.test(preferred)) {
      this.preferredRoomId = preferred;
    }
    const status = String(modalService.option?.preferredAuthStatus || '');
    if (status === 'ready' || status === 'legacy' || status === 'missing' || status === 'undecryptable') {
      this.preferredAuthStatus = status;
    }
  }

  ngOnInit() {
    if (this.editMode && Network.peer?.isRoom) {
      this.roomName = RoomAuth.displayRoomName(Network.peer.roomName || '');
      const info = RoomAuth.parse(Network.peer.roomName || '');
      this.allowUser = info.user.mode !== 'disabled';
      this.allowGuest = info.guest.mode !== 'disabled';
      this.gmPassword = this.roomInvite.getRolePassword('gm');
      this.userPassword = this.allowUser ? this.roomInvite.getRolePassword('user') : '';
      this.guestPassword = this.allowGuest ? this.roomInvite.getRolePassword('guest') : '';
    } else {
      const preferredName = String(this.modalService.option?.preferredRoomName || '').trim();
      this.roomName = preferredName || this.makeDefaultRoomName();
      this.allowUser = true;
      this.allowGuest = false;
      this.applyPreferredAuth(this.modalService.option?.preferredAuth);
    }
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
    this.recalcPeerId();
  }

  private applyPreferredAuth(auth: any) {
    if (!auth || typeof auth !== 'object') return;
    if (typeof auth.allowUser === 'boolean') this.allowUser = auth.allowUser;
    if (typeof auth.allowGuest === 'boolean') this.allowGuest = auth.allowGuest;
    if (typeof auth.gmPassword === 'string') this.gmPassword = auth.gmPassword.slice(0, 12);
    if (typeof auth.userPassword === 'string') {
      this.userPassword = this.allowUser ? auth.userPassword.slice(0, 12) : '';
    }
    if (typeof auth.guestPassword === 'string') {
      this.guestPassword = this.allowGuest ? auth.guestPassword.slice(0, 12) : '';
    }
  }

  /** Default display name: localized base + random 0000–9999. */
  private makeDefaultRoomName(): string {
    const n = Math.floor(Math.random() * 10000);
    const suffix = ('0000' + n).slice(-4);
    return this.i18n.t('room.defaultName') + suffix;
  }

  ngOnDestroy() {
    this.abortCreateRoom();
    EventSystem.unregister(this);
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t(
      this.editMode ? 'room.editTitle' : (this.isResume ? 'room.resumeTitle' : 'room.title')
    );
  }

  get canSubmit(): boolean {
    if (!this.roomName?.trim() || this.roomName.trim().length > 16) return false;
    if (!this.validateLength) return false;
    if ((this.gmPassword?.length ?? 0) > 12) return false;
    if (this.allowUser && (this.userPassword?.length ?? 0) > 12) return false;
    if (this.allowGuest && (this.guestPassword?.length ?? 0) > 12) return false;
    return true;
  }

  onAllowUserChange() {
    if (!this.allowUser) this.userPassword = '';
    this.recalcPeerId();
  }

  onAllowGuestChange() {
    if (!this.allowGuest) this.guestPassword = '';
    this.recalcPeerId();
  }

  private buildRoleAuthInputs(): { gm: RoleAuthInput; user: RoleAuthInput; guest: RoleAuthInput } {
    return {
      gm: this.gmPassword,
      user: this.allowUser
        ? this.userPassword
        : { mode: 'disabled' },
      guest: this.allowGuest
        ? this.guestPassword
        : { mode: 'disabled' },
    };
  }

  private resolveCreateRoomId(): string {
    if (this.editMode && Network.peer?.isRoom) return Network.peer.roomId;
    if (this.preferredRoomId) return this.preferredRoomId;
    return PeerContext.generateId('***');
  }

  recalcPeerId() {
    const roomId = this.resolveCreateRoomId();
    const { roomName, meshPassword } = RoomAuth.encode(this.roomName, roomId, this.buildRoleAuthInputs());
    const userId = Network.peer.userId;
    const peer = PeerContext.create(userId, roomId, roomName, meshPassword);
    this.validateLength = peer.peerId.length <= 64;
  }

  onPrimaryAction() {
    if (!this.canSubmit) return;
    if (this.editMode) {
      void this.saveRoomPasswords();
      return;
    }
    if (!this.connectionBusy.busy) this.createRoom();
  }

  createRoom() {
    const suppressBusy = !!this.modalService.option?.suppressConnectionBusy;
    if (this.createRoomKey) return;
    // Allow create while parent (folder backup) already holds the busy overlay.
    if (this.connectionBusy.busy && !suppressBusy) return;
    const userId = Network.peer.userId;
    const roomId = this.resolveCreateRoomId();
    const roles = this.buildRoleAuthInputs();
    const { roomName: encodedName, meshPassword } = RoomAuth.encode(this.roomName, roomId, roles);

    if (!suppressBusy) this.connectionBusy.show('peer.creatingRoom');
    const afterCreate = this.modalService.option?.afterCreate;
    this.createRoomKey = { createRoom: true };
    this.createRoomTimer = setTimeout(() => this.abortCreateRoom(), 30000);
    EventSystem.register(this.createRoomKey)
      .on('OPEN_NETWORK', () => {
        this.clearCreateRoomWait();
        PeerCursor.myCursor.peerId = Network.peerId;
        RoomAuth.applyIdentity('gm', roomId);
        RoomAuth.rememberSession('gm', this.gmPassword, meshPassword);
        this.roomInvite.setRolePasswords({
          gm: this.gmPassword,
          user: this.allowUser ? this.userPassword : '',
          guest: this.allowGuest ? this.guestPassword : '',
        });
        if (!suppressBusy) this.connectionBusy.hide();
        this.modalService.resolve(true);
        if (typeof afterCreate === 'function') afterCreate();
      })
      .on('NETWORK_ERROR', () => this.abortCreateRoom());

    Network.open(userId, roomId, encodedName, meshPassword);
  }

  private clearCreateRoomWait() {
    if (this.createRoomTimer != null) {
      clearTimeout(this.createRoomTimer);
      this.createRoomTimer = null;
    }
    if (this.createRoomKey) {
      EventSystem.unregister(this.createRoomKey);
      this.createRoomKey = null;
    }
  }

  /** Drop pending create wait and clear busy overlay (timeout / error / destroy). */
  private abortCreateRoom() {
    if (!this.createRoomKey) return;
    this.clearCreateRoomWait();
    this.connectionBusy.hide();
  }

  async saveRoomPasswords() {
    if (!this.editMode || !Network.peer?.isRoom || this.isSaving) return;
    if (!this.validateLength) return;

    this.isSaving = true;
    this.help = '';
    const roomId = Network.peer.roomId;
    const roles = this.buildRoleAuthInputs();
    const { roomName: encodedName, meshPassword } = RoomAuth.encode(this.roomName, roomId, roles);

    this.roomInvite.setRolePasswords({
      gm: this.gmPassword,
      user: this.allowUser ? this.userPassword : '',
      guest: this.allowGuest ? this.guestPassword : '',
    });
    RoomAuth.rememberSession('gm', this.gmPassword, meshPassword);

    try {
      if (Network.peers.length > 0) {
        EventSystem.call('ROOM_REKEY', { roomId, roomName: encodedName });
        await new Promise(r => setTimeout(r, 150));
      }
      await RoomConnectHelper.rekeyRoom(roomId, encodedName, meshPassword);
      RoomAuth.applyIdentity('gm', roomId);
      RoomAuth.noteAttained('gm', roomId);
      this.modalService.resolve(true);
    } catch (e) {
      console.warn('saveRoomPasswords failed', e);
      this.help = this.i18n.t('room.editError');
      this.isSaving = false;
    }
  }

  cancel() {
    this.modalService.resolve(null);
  }
}
