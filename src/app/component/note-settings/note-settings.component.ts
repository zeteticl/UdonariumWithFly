import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';

import { EventSystem, Network } from '@udonarium/core/system';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { PdfStorage } from '@udonarium/core/file-storage/pdf-storage';
import { VideoStorage } from '@udonarium/core/file-storage/video-storage';
import { classifyNoteFile, NOTE_FILE_ACCEPT } from '@udonarium/note-file-kind';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableSelecter } from '@udonarium/table-selecter';
import { TextNote, TextNoteContentMode, TextNoteScope } from '@udonarium/text-note';

import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { buildNoteHandoutPayload } from 'component/note-handout/note-handout.component';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { NoteImportService } from 'service/note-import.service';
import { PanelService } from 'service/panel.service';

@Component({
  selector: 'note-settings',
  templateUrl: './note-settings.component.html',
  styleUrls: ['../shared/settings-ui.css', './note-settings.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class NoteSettingsComponent implements OnInit, OnChanges, OnDestroy {
  @Input() note: TextNote = null;
  /** When false, hide compact chrome suited for embedding in inventory. */
  @Input() embedded = false;

  readonly modes: { id: TextNoteContentMode; icon: string; labelKey: string }[] = [
    { id: 'auto', icon: 'auto_awesome', labelKey: 'note.modeAuto' },
    { id: 'text', icon: 'notes', labelKey: 'note.kind.text' },
    { id: 'image', icon: 'image', labelKey: 'note.kind.image' },
    { id: 'video', icon: 'movie', labelKey: 'note.kind.video' },
    { id: 'pdf', icon: 'picture_as_pdf', labelKey: 'note.kind.pdf' },
  ];

  get isGM(): boolean { return !!PeerCursor.myCursor?.isGMMode; }
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }
  get editMode(): TextNoteContentMode {
    if (!this.note) return 'text';
    return this.note.contentMode === 'auto' ? this.note.contentKind : this.note.contentMode;
  }
  get selfOnly(): boolean { return !!this.note?.isSelfOnly; }
  isDragOver = false;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private modalService: ModalService,
    private panelService: PanelService,
    private noteImport: NoteImportService,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        if (this.note && event.data?.identifier === this.note.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_OBJECT_CHILDREN', event => {
        if (this.note && event.data?.identifier === this.note.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_FILE_RESOURE', () => this.changeDetector.markForCheck())
      .on('UPDATE_PDF_RESOURE', () => this.changeDetector.markForCheck())
      .on('UPDATE_VIDEO_RESOURE', () => this.changeDetector.markForCheck())
      .on('SELECT_GAME_TABLE', () => this.changeDetector.markForCheck());
    this.refreshTitle();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['note']) this.refreshTitle();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  setContentMode(mode: TextNoteContentMode) {
    if (!this.note || this.GuestMode()) return;
    this.note.contentMode = mode;
    this.changeDetector.markForCheck();
  }

  setScope(scope: TextNoteScope) {
    if (!this.note || this.GuestMode()) return;
    this.note.scope = scope;
    if (scope === 'scene') {
      const viewId = TableSelecter.instance.viewTableIdentifier;
      if (viewId && !this.note.hasPlacement(viewId) && this.note.location.name === 'table') {
        this.note.addToTable(viewId);
      }
    }
    this.changeDetector.markForCheck();
  }

  setSelfOnly(selfOnly: boolean) {
    if (!this.note || this.GuestMode()) return;
    this.note.setSelfOnly(!!selfOnly);
    this.changeDetector.markForCheck();
  }

  setFlipped(flipped: boolean) {
    if (!this.note || this.GuestMode()) return;
    this.note.mutateAppearance(() => { this.note.isFlipped = !!flipped; });
    this.changeDetector.markForCheck();
  }

  setTitleBgColor(color: string) {
    if (!this.note || this.GuestMode()) return;
    this.note.mutateAppearance(() => { this.note.titleBgColor = color; });
    this.changeDetector.markForCheck();
  }

  setTextAlign(align: string) {
    if (!this.note || this.GuestMode()) return;
    this.note.mutateAppearance(() => { this.note.textAlign = align; });
    this.changeDetector.markForCheck();
  }

  onDragOver(e: DragEvent) {
    if (this.GuestMode()) return;
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
    if (this.GuestMode() || !this.note) return;
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    // Replace current note media from first supported file; also create extras as new notes.
    const [first, ...rest] = Array.from(files);
    await this.applyFileToNote(first);
    if (rest.length) await this.noteImport.importFiles(rest, { addToTable: true });
    this.changeDetector.markForCheck();
  }

  pickImportFile() {
    if (this.GuestMode() || !this.note) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = NOTE_FILE_ACCEPT;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      await this.applyFileToNote(file);
      this.changeDetector.markForCheck();
    };
    input.click();
  }

  private async applyFileToNote(file: File) {
    if (!this.note || !file) return;
    const kind = classifyNoteFile(file);
    if (!kind) return;
    try {
      if (kind === 'pdf') {
        const pdf = await PdfStorage.instance.addAsync(file);
        this.note.setPdf(pdf.identifier);
        return;
      }
      if (kind === 'video') {
        const video = await VideoStorage.instance.addAsync(file);
        this.note.setVideo(video.identifier);
        return;
      }
      if (kind === 'image') {
        const image = await ImageStorage.instance.addAsync(file);
        this.note.setFrontImage(image.identifier);
        this.note.contentMode = 'image';
        return;
      }
      const text = await file.text();
      this.note.text = text.slice(0, 20000);
      this.note.contentMode = 'text';
    } catch (err) {
      console.warn('note file apply failed', err);
    }
  }

  openFrontImage() {
    if (!this.note || this.GuestMode()) return;
    const current = this.note.frontImage?.identifier || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (value == null) return;
      this.note.setFrontImage(value);
      if (this.note.contentMode === 'auto' || this.note.contentMode === 'text') {
        this.note.contentMode = 'image';
      }
      this.changeDetector.markForCheck();
    });
  }

  openBackImage() {
    if (!this.note || this.GuestMode()) return;
    const current = this.note.backImage?.identifier || '';
    this.modalService.open<string>(FileSelecterComponent, {
      isAllowedEmpty: true,
      currentImageIdentifires: current ? [current] : []
    }).then(value => {
      if (value == null) return;
      this.note.setBackImage(value);
      this.changeDetector.markForCheck();
    });
  }

  attachPdf() {
    if (!this.note || this.GuestMode()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const pdf = await PdfStorage.instance.addAsync(file);
        this.note.setPdf(pdf.identifier);
        this.changeDetector.markForCheck();
      } catch (err) {
        console.warn('PDF attach failed', err);
      }
    };
    input.click();
  }

  clearPdf() {
    if (!this.note || this.GuestMode()) return;
    this.note.clearPdf();
    this.changeDetector.markForCheck();
  }

  attachVideo() {
    if (!this.note || this.GuestMode()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const video = await VideoStorage.instance.addAsync(file);
        this.note.setVideo(video.identifier);
        this.changeDetector.markForCheck();
      } catch (err) {
        console.warn('Video attach failed', err);
      }
    };
    input.click();
  }

  onVideoUrlChange(event: Event) {
    if (!this.note || this.GuestMode()) return;
    const value = (event.target as HTMLInputElement)?.value || '';
    this.note.setVideoUrl(value);
    this.changeDetector.markForCheck();
  }

  clearVideo() {
    if (!this.note || this.GuestMode()) return;
    this.note.clearVideo();
    this.changeDetector.markForCheck();
  }

  previewSelf() {
    if (!this.note) return;
    const data = buildNoteHandoutPayload(this.note, this.i18n.t('note.untitled'));
    data.preview = false;
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) return;
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  showToPlayers() {
    if (!this.note) return;
    if (!this.isGM) return;
    const data = buildNoteHandoutPayload(this.note, this.i18n.t('note.untitled'));
    if (!data.imageUrl && !data.pdfIdentifier && !data.videoUrl && !data.videoIdentifier && !data.text) return;
    EventSystem.call('SHOW_NOTE_HANDOUT', data);
    EventSystem.trigger('SHOW_NOTE_HANDOUT', data);
  }

  private refreshTitle() {
    if (this.embedded || !this.note) return;
    let title = this.i18n.t('note.detailTitle');
    if (this.note.title?.length) title += ' - ' + this.note.title;
    this.panelService.title = title;
  }
}
