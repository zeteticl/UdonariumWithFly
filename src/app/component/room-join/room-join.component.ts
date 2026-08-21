import { Component, OnDestroy, OnInit } from '@angular/core';

import { IRoomInfo } from '@udonarium/core/system/network/room-info';
import { EventSystem } from '@udonarium/core/system';
import { RoomAuth, RoomJoinResult, RoomRole } from '@udonarium/room-auth';

import { ModalService } from 'service/modal.service';
import { I18nService } from 'service/i18n.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'room-join',
  templateUrl: './room-join.component.html',
  styleUrls: ['../shared/settings-ui.css', './room-join.component.css'],
  standalone: false
})
export class RoomJoinComponent implements OnInit, OnDestroy {
  room: IRoomInfo;
  role: RoomRole = 'user';
  password: string = '';
  help: string = '';
  /** When true, used from peer-menu「轉換身份」instead of lobby join. */
  switchMode = false;
  currentRole: RoomRole = null;
  roles: { id: RoomRole; label: string; hint: string }[] = [];

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private i18n: I18nService,
  ) {
    this.room = modalService.option.room;
    this.switchMode = !!modalService.option.switchMode;
    this.currentRole = modalService.option.currentRole || null;
  }

  get title(): string {
    if (!this.room) return '';
    return `${RoomAuth.displayRoomName(this.room.name)}/${this.room.id}`;
  }

  get roleLabel(): string {
    return this.i18n.t(`roomJoin.role.${this.role}.label`);
  }

  get submitLabel(): string {
    return this.i18n.t(this.switchMode ? 'roomJoin.confirmSwitch' : 'roomJoin.submit');
  }

  ngOnInit() {
    this.refreshRoles();
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => {
        this.refreshRoles();
        this.refreshTitle();
      });
    // Record current role as unlocked so GM→player/guest (and back) can skip passwords.
    if (this.switchMode && this.currentRole && this.room?.id) {
      RoomAuth.noteAttained(this.currentRole, this.room.id);
    }
    if (this.currentRole && this.isRoleAvailable(this.currentRole)) {
      this.role = this.currentRole;
      return;
    }
    const order: RoomRole[] = ['user', 'gm', 'guest'];
    const first = order.find(r => this.isRoleAvailable(r));
    if (first) this.role = first;
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  trackByRoleId(_: number, role: { id: RoomRole }): RoomRole {
    return role.id;
  }

  private refreshRoles() {
    this.roles = (['gm', 'user', 'guest'] as RoomRole[]).map(id => ({
      id,
      label: this.i18n.t(`roomJoin.role.${id}.label`),
      hint: this.i18n.t(`roomJoin.role.${id}.hint`),
    }));
  }

  private refreshTitle() {
    const head = this.i18n.t(this.switchMode ? 'roomJoin.switchRole' : 'roomJoin.selectRole');
    this.modalService.title = this.panelService.title = this.room
      ? this.i18n.t('roomJoin.titleWithRoom', { head, room: this.title })
      : head;
  }

  isRoleAvailable(role: RoomRole): boolean {
    if (!this.room) {
      return role === 'gm' || role === 'user';
    }
    return RoomAuth.isRoleAvailable(this.room.name, role);
  }

  needsPassword(): boolean {
    return this.needsPasswordFor(this.role);
  }

  needsPasswordFor(role: RoomRole): boolean {
    if (!this.room) return false;
    // Legacy / non-role-auth: no per-role password gate.
    if (!RoomAuth.isRoleAuthRoom(this.room.name)) return false;
    // Downgrade (or same rank) from current identity never needs a password.
    if (this.switchMode && this.currentRole
      && RoomAuth.roleRank(this.currentRole) >= RoomAuth.roleRank(role)) {
      return false;
    }
    if (RoomAuth.canBypassPassword(role, this.room.id)) {
      // Mesh-locked rooms still need the role password in-session to unseal the channel key.
      if (!this.switchMode
        && RoomAuth.isMeshLocked(this.room.name)
        && RoomAuth.roleNeedsPassword(this.room.name, role)
        && !RoomAuth.getSessionRolePassword(role)) {
        return true;
      }
      return false;
    }
    return RoomAuth.roleNeedsPassword(this.room.name, role);
  }

  /** Role has a password gate, but current/unlocked rank skips it. */
  isPasswordBypassed(role: RoomRole): boolean {
    if (!this.room || !this.isRoleAvailable(role)) return false;
    if (!RoomAuth.isRoleAuthRoom(this.room.name)) return false;
    if (!RoomAuth.roleNeedsPassword(this.room.name, role)) return false;
    return !this.needsPasswordFor(role);
  }

  /** Open gate (no password configured) — not the same as bypass. */
  isRoleOpen(role: RoomRole): boolean {
    if (!this.room || !this.isRoleAvailable(role)) return false;
    if (this.needsPasswordFor(role) || this.isPasswordBypassed(role)) return false;
    if (!RoomAuth.isRoleAuthRoom(this.room.name)) return true;
    return !RoomAuth.roleNeedsPassword(this.room.name, role);
  }

  onRoleChange() {
    this.password = '';
    this.help = '';
  }

  submit() {
    if (!this.isRoleAvailable(this.role)) {
      this.help = this.i18n.t('roomJoin.errorRoleUnavailable');
      return;
    }
    if (this.switchMode && this.currentRole && this.role === this.currentRole) {
      this.help = this.i18n.t('roomJoin.errorAlreadyRole');
      return;
    }
    if (this.room && RoomAuth.isRoleAuthRoom(this.room.name)) {
      const roomId = this.room.id;
      // Ensure current identity is recorded before evaluating bypass.
      if (this.switchMode && this.currentRole) {
        RoomAuth.noteAttained(this.currentRole, roomId);
      }
      const bypass = RoomAuth.canBypassPassword(this.role, roomId)
        || (this.switchMode && !!this.currentRole
          && RoomAuth.roleRank(this.currentRole) >= RoomAuth.roleRank(this.role));
      if (this.needsPassword()) {
        if (!RoomAuth.verify(roomId, this.room.name, this.role, this.password)) {
          this.help = this.i18n.t('roomJoin.errorWrongPassword');
          return;
        }
      } else if (!bypass && !RoomAuth.verify(roomId, this.room.name, this.role, '')) {
        this.help = this.i18n.t('roomJoin.errorSwitchFailed');
        return;
      }
    }
    const result: RoomJoinResult = { role: this.role, password: this.password || '' };
    this.modalService.resolve(result);
  }

  cancel() {
    this.modalService.resolve(null);
  }
}
