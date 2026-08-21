import { ImageFile } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { PdfStorage } from './core/file-storage/pdf-storage';
import { VideoStorage } from './core/file-storage/video-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { Network } from './core/system';
import { DataElement } from './data-element';
import { PeerCursor } from './peer-cursor';
import { TabletopObject } from './tabletop-object';
import { moveToBackmost, moveToTopmost, moveToTopmostInTier } from './tabletop-object-util';
import { a4HeightForWidth, PaperStyle } from './table-fx/push-pin.util';

export type TextNoteScope = 'room' | 'scene';
/** Display content for the note body. auto = pick video > pdf > image > text. */
export type TextNoteContentMode = 'auto' | 'text' | 'image' | 'video' | 'pdf';
export type TextNoteContentKind = 'text' | 'image' | 'video' | 'pdf';

@SyncObject('text-note')
export class TextNote extends TabletopObject {
  @SyncVar() rotate: number = 0;
  @SyncVar() zindex: number = 0;
  @SyncVar() password: string = '';
  @SyncVar() isUpright: boolean = true;
  @SyncVar() isLocked: boolean = false;
  @SyncVar() isWhiteOut: boolean = false;
  @SyncVar() isShowTitle: boolean = true;
  /** Title bar background (#rrggbb). Empty = legacy dark bar. */
  @SyncVar() titleBgColor: string = '#1e1e1e';
  /** Body text alignment: left | center | right | justify. */
  @SyncVar() textAlign: string = 'left';

  /** Clue-board paper look: none | a4 | sticky */
  @SyncVar() paperStyle: string = 'none';
  @SyncVar() pushPin: boolean = false;
  @SyncVar() pushPinAngle: number = 0;
  /** Legacy SyncVar (unused for art; kept for room XML compat). */
  @SyncVar() pushPinColor: string = 'red';
  /** Active oblique styles: 2 | 3 | 6 | 7. 0 = derive from identifier. */
  @SyncVar() pushPinStyle: number = 0;
  /** CSS left/top of `.push-pin` on the paper face (randomized). */
  @SyncVar() pushPinLeft: number = -4;
  @SyncVar() pushPinTop: number = -20;

  /** When true, width/height edits are blocked in the inventory editor. */
  @SyncVar() isSizeLocked: boolean = false;
  /**
   * Legacy room-XML flag only (kept in sync by setSelfOnly).
   * Do NOT use for render gating — same as GameCharacter: stealth is driven by owner id.
   */
  @SyncVar() isVisible: boolean = true;
  /** Self-only stealth owner (userId). Empty = public. Same role as GameCharacter.owner. */
  @SyncVar() visibleOwner: string = '';
  @SyncVar() isFlipped: boolean = false;
  /** room = across maps; scene = tablePlacements only. */
  @SyncVar() scope: TextNoteScope = 'scene';

  /** Prefer which media to show when multiple are attached. */
  @SyncVar() contentMode: TextNoteContentMode = 'auto';

  /** SHA identifier in PdfStorage; empty = no PDF. */
  @SyncVar() pdfIdentifier: string = '';
  /** 1-based page index (synced). */
  @SyncVar() pdfPage: number = 1;
  /** Cached page count after first render (0 = unknown). */
  @SyncVar() pdfPageCount: number = 0;

  /** SHA identifier in VideoStorage; empty = no uploaded video. */
  @SyncVar() videoIdentifier: string = '';
  /** Optional direct video URL (http/https mp4/webm). Used when videoIdentifier is empty. */
  @SyncVar() videoUrl: string = '';

  get width(): number { return this.getCommonValue('width', 1); }
  set width(width: number) {
    if (this.isSizeLocked) return;
    this.setCommonValue('width', width);
  }
  get height(): number { return this.getCommonValue('height', 1); }
  set height(height: number) {
    if (this.isSizeLocked) return;
    this.setCommonValue('height', height);
  }

  /** Visual paper look only — size stays free (width/height independent). */
  applyPaperStyle(style: PaperStyle | string) {
    this.mutateAppearance(() => {
      this.paperStyle = style || 'none';
      if (this.paperStyle === 'a4') {
        // Seed A4 proportion once when switching style; later resize stays free.
        const w = this.width > 0 ? this.width : 4;
        const widthEl = this.getElement('width', this.commonDataElement);
        const heightEl = this.getElement('height', this.commonDataElement);
        if (widthEl) widthEl.value = w;
        if (heightEl) heightEl.value = a4HeightForWidth(w);
      } else if (this.paperStyle === 'sticky') {
        const s = Math.min(this.width || 2, this.height || 2, 2.5) || 2;
        const widthEl = this.getElement('width', this.commonDataElement);
        const heightEl = this.getElement('height', this.commonDataElement);
        if (widthEl) widthEl.value = s;
        if (heightEl) heightEl.value = s;
      }
    });
  }
  get fontSize(): number { return this.getCommonValue('fontsize', 1); }
  set fontSize(fontSize: number) { this.setCommonValue('fontsize', fontSize); }
  get title(): string { return this.getCommonValue('title', ''); }
  set title(title: string) { this.setCommonValue('title', title); }
  get text(): string { return this.getCommonValue('text', ''); }
  set text(text: string) {
    this.setCommonValue('text', text);
    // Keep note-type currentValue aligned so XML clipboard / peers see the same body.
    const el = this.getElement('text', this.commonDataElement);
    if (el) el.currentValue = text;
  }
  get color(): string {
    return this.getCommonValue('color', '#444444');
  }
  set color(color: string) { this.setCommonValue('color', color); }

  get hasPdf(): boolean { return !!(this.pdfIdentifier && this.pdfIdentifier.length); }
  get hasVideoFile(): boolean { return !!(this.videoIdentifier && this.videoIdentifier.length); }
  get hasVideoUrl(): boolean { return !!(this.videoUrl && this.videoUrl.trim().length); }
  get hasVideo(): boolean { return this.hasVideoFile || this.hasVideoUrl; }
  get hasImage(): boolean {
    const front = this.frontImage;
    return !!(front && front.url);
  }

  /** Resolved body content for rendering. */
  get contentKind(): TextNoteContentKind {
    const mode = this.contentMode || 'auto';
    if (mode === 'text') return 'text';
    if (mode === 'image' && this.hasImage) return 'image';
    if (mode === 'video' && this.hasVideo) return 'video';
    if (mode === 'pdf' && this.hasPdf) return 'pdf';
    // auto / fallback
    if (this.hasVideo) return 'video';
    if (this.hasPdf) return 'pdf';
    if (this.hasImage && !(this.text || '').trim()) return 'image';
    return 'text';
  }

  get isPdfContent(): boolean { return this.contentKind === 'pdf'; }
  get isVideoContent(): boolean { return this.contentKind === 'video'; }
  get isImageContent(): boolean { return this.contentKind === 'image'; }
  get isTextContent(): boolean { return this.contentKind === 'text'; }

  get frontImage(): ImageFile {
    return this.getImageFile('front') || this.getImageFile('imageIdentifier') || ImageFile.Empty;
  }

  get backImage(): ImageFile {
    return this.getImageFile('back') || ImageFile.Empty;
  }

  /** True when a dedicated back-face image is set. */
  get hasBackImage(): boolean {
    return !!(this.backImage && this.backImage.url);
  }

  override get imageFile(): ImageFile {
    // Flipped + back art → show back. Flipped without back → keep front (CSS 180°).
    if (this.isFlipped && this.hasBackImage) return this.backImage;
    const front = this.frontImage;
    if (front && front.url) return front;
    return super.imageFile;
  }

  get displayImageUrl(): string {
    const file = this.imageFile;
    return file && file.url ? file.url : '';
  }

  get pdfUrl(): string {
    if (!this.pdfIdentifier) return '';
    return PdfStorage.instance.get(this.pdfIdentifier)?.url || '';
  }

  get resolvedVideoUrl(): string {
    if (this.videoIdentifier) {
      const file = VideoStorage.instance.get(this.videoIdentifier);
      if (file?.url) return file.url;
    }
    return (this.videoUrl || '').trim();
  }

  /** Like GameCharacter.isHideIn — stealth when an owner is set. */
  get isSelfOnly(): boolean {
    return !!this.visibleOwner;
  }

  /**
   * Like GameCharacter.isVisible:
   * public, or self-only and local Network.peer.userId owns it.
   * GM sees via template (`canSeeSelfOnly || isGMMode`), not here.
   */
  get canSeeSelfOnly(): boolean {
    return !this.visibleOwner || Network.peer.userId === this.visibleOwner;
  }

  /** Same toggle as character stealth: owner = Network.peer.userId. */
  setSelfOnly(selfOnly: boolean) {
    if (selfOnly) {
      // Match game-character.component: assign owner only (no intermediate hide flag).
      this.visibleOwner = Network.peer.userId;
      this.isVisible = false; // legacy XML only
    } else {
      this.visibleOwner = '';
      this.isVisible = true;
    }
  }

  override get isVisibleOnTable(): boolean {
    if (this.location.name !== 'table') return false;
    if (this.scope === 'room') return true;
    return super.isVisibleOnTable;
  }

  /** Soft cue for self-only notes (owner / GM view). */
  get isGhosted(): boolean {
    return this.isSelfOnly && (this.canSeeSelfOnly || !!PeerCursor.myCursor?.isGMMode);
  }

  setFrontImage(imageIdentifier: string) {
    let element = this.getElement('front', this.imageDataElement);
    if (!element && this.imageDataElement) {
      element = this.getElement('imageIdentifier', this.imageDataElement);
    }
    if (!element && this.imageDataElement) {
      element = DataElement.create('front', '', { type: 'image' }, 'front_' + this.identifier);
      this.imageDataElement.appendChild(element);
    }
    if (element) element.value = imageIdentifier || '';
    const legacy = this.getElement('imageIdentifier', this.imageDataElement);
    if (legacy && legacy !== element) legacy.value = imageIdentifier || '';
    if (!imageIdentifier && this.contentMode === 'image') this.contentMode = 'auto';
  }

  setBackImage(imageIdentifier: string) {
    let element = this.getElement('back', this.imageDataElement);
    if (!element && this.imageDataElement) {
      element = DataElement.create('back', '', { type: 'image' }, 'back_' + this.identifier);
      this.imageDataElement.appendChild(element);
    }
    if (element) element.value = imageIdentifier || '';
  }

  setPdf(pdfIdentifier: string) {
    this.pdfIdentifier = pdfIdentifier || '';
    this.pdfPage = 1;
    this.pdfPageCount = 0;
    if (pdfIdentifier) this.contentMode = 'pdf';
  }

  clearPdf() {
    this.setPdf('');
    if (this.contentMode === 'pdf') this.contentMode = 'auto';
  }

  setVideo(videoIdentifier: string) {
    this.videoIdentifier = videoIdentifier || '';
    if (videoIdentifier) {
      this.videoUrl = '';
      this.contentMode = 'video';
    }
  }

  setVideoUrl(url: string) {
    this.videoUrl = (url || '').trim();
    if (this.videoUrl) {
      this.videoIdentifier = '';
      this.contentMode = 'video';
    } else if (this.contentMode === 'video' && !this.hasVideoFile) {
      this.contentMode = 'auto';
    }
  }

  clearVideo() {
    this.videoIdentifier = '';
    this.videoUrl = '';
    if (this.contentMode === 'video') this.contentMode = 'auto';
  }

  nextPdfPage() {
    if (!this.hasPdf) return;
    const max = this.pdfPageCount > 0 ? this.pdfPageCount : 0;
    if (max <= 0) return;
    // Wrap: last → first
    this.pdfPage = this.pdfPage >= max ? 1 : this.pdfPage + 1;
  }

  prevPdfPage() {
    if (!this.hasPdf) return;
    const max = this.pdfPageCount > 0 ? this.pdfPageCount : 0;
    if (max <= 0) return;
    // Wrap: first → last
    this.pdfPage = this.pdfPage <= 1 ? max : this.pdfPage - 1;
  }

  toTopmost() {
    moveToTopmost(this);
  }

  raiseInTier() {
    moveToTopmostInTier(this);
  }

  toBackmost() {
    moveToBackmost(this);
  }

  complement(): void {
    let element = this.getElement('color', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('color', "#555555", { type: 'color' }, 'color_' + this.identifier));
    }
    element = this.getElement('altitude', this.commonDataElement);
    if (!element && this.commonDataElement) {
      this.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + this.identifier));
    }
    if (this.imageDataElement && !this.getElement('front', this.imageDataElement)) {
      const legacy = this.getElement('imageIdentifier', this.imageDataElement);
      const value = legacy ? String(legacy.value || '') : '';
      this.imageDataElement.appendChild(
        DataElement.create('front', value, { type: 'image' }, 'front_' + this.identifier)
      );
    }
    if (this.imageDataElement && !this.getElement('back', this.imageDataElement)) {
      this.imageDataElement.appendChild(
        DataElement.create('back', '', { type: 'image' }, 'back_' + this.identifier)
      );
    }
  }

  static create(title: string, text: string, fontSize: number = 16, width: number = 1, height: number = 1, identifier?: string): TextNote {
    let object: TextNote = identifier ? new TextNote(identifier) : new TextNote();

    object.createDataElements();
    object.commonDataElement.appendChild(DataElement.create('width', width, {}, 'width_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('height', height, {}, 'height_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('fontsize', fontSize, {}, 'fontsize_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('title', title, {}, 'title_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('text', text, { type: 'note', currentValue: text }, 'text_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('color', "#444444", { type: 'color' }, 'ccolor_' + object.identifier));
    object.commonDataElement.appendChild(DataElement.create('altitude', 0, {}, 'altitude_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('front', '', { type: 'image' }, 'front_' + object.identifier));
    object.imageDataElement.appendChild(DataElement.create('back', '', { type: 'image' }, 'back_' + object.identifier));
    object.initialize();

    return object;
  }

  static resolveHandoutImageUrl(note: TextNote): string {
    if (!note) return '';
    const file = note.imageFile;
    if (file?.url) return file.url;
    const id = note.frontImage?.identifier;
    if (!id) return '';
    return ImageStorage.instance.get(id)?.url || '';
  }
}
