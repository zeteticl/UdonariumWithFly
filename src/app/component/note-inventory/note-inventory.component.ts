import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';
import { TextNote } from '@udonarium/text-note';
import { NOTE_FILE_ACCEPT } from '@udonarium/note-file-kind';

import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { NoteSettingsComponent } from 'component/note-settings/note-settings.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { NoteImportService } from 'service/note-import.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

type NoteFilterId = 'all' | 'table' | 'other';

@Component({
  selector: 'note-inventory',
  templateUrl: './note-inventory.component.html',
  styleUrls: ['../shared/settings-ui.css', './note-inventory.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NoteInventoryComponent implements OnInit, OnDestroy {
  selectFilter: NoteFilterId = 'all';
  selectedIdentifier: string = '';
  expandedId: string = '';
  isDragOver = false;
  get isGM(): boolean { return !!PeerCursor.myCursor?.isGMMode; }

  readonly filters: { id: NoteFilterId, label: string }[] = [
    { id: 'all', label: '' },
    { id: 'table', label: '' },
    { id: 'other', label: '' },
  ];

  private textNoteCache = new TabletopCache<TextNote>(() => ObjectStore.instance.getObjects(TextNote));
  get textNotes(): TextNote[] { return this.textNoteCache.objects; }
  get selected(): TextNote {
    const obj = ObjectStore.instance.get(this.selectedIdentifier);
    return obj instanceof TextNote ? obj : null;
  }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private noteImport: NoteImportService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  ngOnInit() {
    Promise.resolve().then(() => this.refreshLabels());
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if ((object instanceof TabletopObject) || (object instanceof PeerCursor) || object instanceof ObjectNode) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('SELECT_GAME_TABLE', () => this.refresh())
      .on('UPDATE_INVENTORY', () => this.refresh())
      .on('UPDATE_GAME_OBJECT', () => this.refresh())
      .on('DISCONNECT_PEER', () => this.changeDetector.markForCheck())
      .on('LOCALE_CHANGED', () => {
        this.refreshLabels();
        this.changeDetector.markForCheck();
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: Event) {
    e.preventDefault();
  }

  refresh() {
    this.textNoteCache.refresh();
    this.changeDetector.markForCheck();
  }

  /** Hide other players' self-only notes (owner + GM can see — same as tokens). */
  private visibleNotes(notes: TextNote[]): TextNote[] {
    const gm = this.isGM;
    return (notes || []).filter(n => n?.canSeeSelfOnly || gm);
  }

  filteredNotes(): TextNote[] {
    const notes = this.visibleNotes(this.textNotes);
    switch (this.selectFilter) {
      case 'table':
        return notes.filter(n => n.location?.name === 'table');
      case 'other':
        return notes.filter(n => n.location?.name !== 'table');
      default:
        return notes;
    }
  }

  countByFilter(filterId: NoteFilterId): number {
    const notes = this.visibleNotes(this.textNotes);
    switch (filterId) {
      case 'table':
        return notes.filter(n => n.location?.name === 'table').length;
      case 'other':
        return notes.filter(n => n.location?.name !== 'table').length;
      default:
        return notes.length;
    }
  }

  settotable(gameObject: TextNote) {
    if (this.GuestMode()) return;
    gameObject.addToTable();
    this.refresh();
  }

  showgameObject(gameObject: TextNote) {
    return gameObject.title || this.i18n.t('note.untitled');
  }

  isittable(note: TextNote) {
    return note.isVisibleOnTable;
  }

  isOnOtherTable(note: TextNote): boolean {
    return note.location?.name === 'table' && !note.isVisibleOnTable;
  }

  selectNote(note: TextNote) {
    this.selectedIdentifier = note.identifier;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: note.identifier, className: note.aliasName });
  }

  toggleExpand(note: TextNote) {
    this.expandedId = this.expandedId === note.identifier ? '' : note.identifier;
  }

  onContextMenu(event: Event, gameObject: TextNote) {
    event.stopPropagation();
    event.preventDefault();

    if (this.GuestMode()) return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.selectNote(gameObject);

    const target = event.target as HTMLElement;
    let position;
    if (target && target.tagName === 'BUTTON') {
      const clientRect = target.getBoundingClientRect();
      position = {
        x: window.pageXOffset + clientRect.left + target.clientWidth,
        y: window.pageYOffset + clientRect.top
      };
    } else {
      position = this.pointerDeviceService.pointers[0];
    }

    const location = gameObject.location?.name || '';
    const onCurrentMap = gameObject.isVisibleOnTable;
    const onOtherMap = this.isOnOtherTable(gameObject);
    const actions: ContextMenuAction[] = [
      {
        name: this.i18n.t(onOtherMap ? 'inv.placeOnCurrentMap' : 'note.moveToTable'),
        action: () => {
          gameObject.addToTable();
          this.refresh();
        },
        disabled: onCurrentMap
      },
      {
        name: this.i18n.t('inv.moveToCurrentMapOnly'),
        action: () => {
          gameObject.moveToTableOnly();
          this.refresh();
        },
        disabled: !onOtherMap
      },
      {
        name: this.i18n.t('inv.removeFromCurrentMap'),
        action: () => {
          gameObject.removeFromTable();
          this.refresh();
        },
        disabled: !onCurrentMap
      },
      {
        name: this.i18n.t('note.moveToCommon'),
        action: () => {
          gameObject.setLocation('common');
          this.refresh();
        },
        disabled: location === 'common' || !location
      },
      {
        name: this.i18n.t('note.moveToPersonal'),
        action: () => {
          gameObject.setLocation(Network.peerId);
          this.refresh();
        },
        disabled: location === Network.peerId
      },
      {
        name: this.i18n.t('note.moveToGraveyard'),
        action: () => {
          gameObject.setLocation('graveyard');
          this.refresh();
        },
        disabled: location === 'graveyard'
      },
      ContextMenuSeparator,
      { name: this.i18n.t('note.edit'), action: () => { this.showDetail(gameObject); } },
      {
        name: this.i18n.t('note.showPlayers'),
        action: () => this.showToPlayers(gameObject),
        disabled: !this.isGM
      },
      {
        name: this.i18n.t('note.previewSelf'),
        action: () => this.previewSelf(gameObject)
      },
      {
        name: this.i18n.t('note.clone'),
        action: () => {
          const cloneObject = gameObject.clone();
          cloneObject.isLocked = false;
          SoundEffect.play(PresetSound.cardPut);
          this.refresh();
        }
      },
      ContextMenuSeparator,
      {
        name: this.i18n.t('note.delete'),
        action: () => {
          gameObject.destroy();
          SoundEffect.play(PresetSound.sweep);
          this.refresh();
        }
      },
    ];

    this.contextMenuService.open(position, actions, this.showgameObject(gameObject));
  }

  onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = true;
  }

  onDragLeave(e: DragEvent) {
    e.preventDefault();
    this.isDragOver = false;
  }

  async onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOver = false;
    if (this.GuestMode()) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    await this.noteImport.importFiles(files, { addToTable: true });
    this.refresh();
  }

  pickImport() {
    if (this.GuestMode()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = NOTE_FILE_ACCEPT;
    input.onchange = async () => {
      if (!input.files?.length) return;
      await this.noteImport.importFiles(input.files, { addToTable: true });
      this.refresh();
    };
    input.click();
  }

  private showToPlayers(note: TextNote) {
    if (!this.isGM || !note) return;
    const data = buildNoteHandoutPayload(note, this.i18n.t('note.untitled'));
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = note.title || this.i18n.t('note.untitled');
    }
    EventSystem.call('SHOW_NOTE_HANDOUT', data);
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private previewSelf(note: TextNote) {
    if (!note) return;
    const data = buildNoteHandoutPayload(note, this.i18n.t('note.untitled'));
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) {
      data.text = note.title || this.i18n.t('note.untitled');
    }
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private showDetail(gameObject: TextNote) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('note.detailTitle');
    if (gameObject.title.length) title += ' - ' + gameObject.title;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    const coordinate = this.pointerDeviceService.pointers[0];
    const option: PanelOption = {
      title: title, left: coordinate.x - 280, top: coordinate.y - 180, width: 420, height: 440,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    const component = this.panelService.open<NoteSettingsComponent>(NoteSettingsComponent, option);
    component.note = gameObject;
    component.embedded = false;
  }

  trackByGameObject(index: number, gameObject: TextNote) {
    return gameObject ? gameObject.identifier : index;
  }

  private refreshLabels() {
    this.panelService.title = this.i18n.t('note.title');
    this.filters[0].label = this.i18n.t('note.filter.all');
    this.filters[1].label = this.i18n.t('note.filter.table');
    this.filters[2].label = this.i18n.t('note.filter.other');
  }
}

class TabletopCache<T extends TabletopObject> {
  private needsRefresh: boolean = true;
  private _objects: T[] = [];

  get objects(): T[] {
    if (this.needsRefresh) {
      this._objects = this.refreshCollector() || [];
      this.needsRefresh = false;
    }
    return this._objects;
  }

  constructor(private refreshCollector: () => T[]) { }

  refresh() { this.needsRefresh = true; }
}
