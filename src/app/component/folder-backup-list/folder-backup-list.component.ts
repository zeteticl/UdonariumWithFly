import { Component, OnDestroy, OnInit } from '@angular/core';
import { EventSystem, Network } from '@udonarium/core/system';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import {
  FolderBackupService,
  RoomBackupAuthStatus,
  RoomBackupInfo,
  RoomBackupSelection,
  RoomBackupSlot,
} from 'service/folder-backup.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'app-folder-backup-list',
  templateUrl: './folder-backup-list.component.html',
  styleUrls: ['./folder-backup-list.component.css'],
  standalone: false
})
export class FolderBackupListComponent implements OnInit, OnDestroy {
  backups: RoomBackupInfo[] = [];
  deletingRoomId = '';
  expandedRoomId = '';
  thumbPreviewSrc = '';
  thumbPreviewX = 0;
  thumbPreviewY = 0;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private i18n: I18nService,
    private folderBackup: FolderBackupService
  ) {
    this.backups = Array.isArray(this.modalService.option?.backups)
      ? this.modalService.option.backups
      : [];
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshTitle());
    EventSystem.register(this).on('LOCALE_CHANGED', () => this.refreshTitle());
    if (!this.backups.length) {
      void this.reloadList();
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.hideThumbPreview();
    for (const room of this.backups) {
      this.revokeRoomUrls(room);
    }
  }

  get currentRoomId(): string {
    return Network.peer?.isRoom ? (Network.peer.roomId || '') : '';
  }

  toggleRoom(room: RoomBackupInfo) {
    this.expandedRoomId = this.expandedRoomId === room.roomId ? '' : room.roomId;
  }

  selectSlot(room: RoomBackupInfo, slot: RoomBackupSlot) {
    const selection: RoomBackupSelection = { room, slot };
    this.modalService.resolve(selection);
  }

  cancel() {
    this.modalService.resolve(null);
  }

  async deleteBackup(room: RoomBackupInfo) {
    if (this.deletingRoomId) return;
    const ok = await this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('folderBackup.deleteConfirm.title'),
      text: this.i18n.t('folderBackup.deleteConfirm.text', {
        name: room.displayName || room.roomId,
      }),
      help: this.i18n.t('folderBackup.deleteConfirm.help'),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete',
    });
    if (ok !== true) return;

    this.deletingRoomId = room.roomId;
    try {
      const deleted = await this.folderBackup.deleteRoomBackup(room);
      if (deleted) {
        this.revokeRoomUrls(room);
        this.backups = this.backups.filter(item => item.roomId !== room.roomId);
        if (this.expandedRoomId === room.roomId) this.expandedRoomId = '';
      }
    } finally {
      this.deletingRoomId = '';
    }
  }

  formatSavedAt(savedAt: string): string {
    if (!savedAt) return '-';
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) return savedAt;
    return date.toLocaleString();
  }

  slotLabel(slot: RoomBackupSlot): string {
    switch (slot.kind) {
      case 'latest':
        return this.i18n.t('folderBackup.slot.latest');
      case 'recent':
        return this.formatSavedAt(slot.savedAt);
      case 'snap_1d':
        return this.i18n.t('folderBackup.slot.snap1d');
      case 'snap_7d':
        return this.i18n.t('folderBackup.slot.snap7d');
      case 'snap_30d':
        return this.i18n.t('folderBackup.slot.snap30d');
      case 'legacy_zip':
        return this.i18n.t('folderBackup.slot.legacy');
      default:
        return slot.id;
    }
  }

  slotGroup(slot: RoomBackupSlot): 'latest' | 'recent' | 'calendar' | 'legacy' {
    if (slot.kind === 'latest') return 'latest';
    if (slot.kind === 'recent') return 'recent';
    if (slot.kind === 'legacy_zip') return 'legacy';
    return 'calendar';
  }

  isGroupStart(room: RoomBackupInfo, index: number): boolean {
    if (index <= 0) return true;
    const cur = room.slots[index];
    const prev = room.slots[index - 1];
    return this.slotGroup(cur) !== this.slotGroup(prev);
  }

  authStatusLabel(status: RoomBackupAuthStatus): string {
    switch (status) {
      case 'ready': return this.i18n.t('folderBackup.authStatus.ready');
      case 'legacy': return this.i18n.t('folderBackup.authStatus.legacy');
      case 'undecryptable': return this.i18n.t('folderBackup.authStatus.undecryptable');
      default: return this.i18n.t('folderBackup.authStatus.missing');
    }
  }

  showThumbPreview(event: MouseEvent, src?: string) {
    if (!src) {
      this.hideThumbPreview();
      return;
    }
    this.thumbPreviewSrc = src;
    this.moveThumbPreview(event);
  }

  moveThumbPreview(event: MouseEvent) {
    if (!this.thumbPreviewSrc) return;
    this.thumbPreviewX = event.clientX + 16;
    this.thumbPreviewY = event.clientY + 16;
  }

  hideThumbPreview() {
    this.thumbPreviewSrc = '';
  }

  private async reloadList() {
    this.backups = await this.folderBackup.listRoomBackups();
  }

  private refreshTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('menu.folderBackup.loadRoom');
  }

  private revokeRoomUrls(room: RoomBackupInfo) {
    if (room.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(room.previewUrl);
    for (const slot of room.slots || []) {
      if (slot.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(slot.previewUrl);
    }
  }
}
