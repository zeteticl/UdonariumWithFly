import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CutInList } from '@udonarium/cut-in-list';
import { CutIn } from '@udonarium/cut-in';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { PointerDeviceService } from 'service/pointer-device.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { SaveDataService } from 'service/save-data.service';
import { EventSystem, Network } from '@udonarium/core/system';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageTag } from '@udonarium/image-tag';
import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { CutInService } from 'service/cut-in.service';
import { PeerCursor } from '@udonarium/peer-cursor';
import { AudioFile } from '@udonarium/core/file-storage/audio-file';
import { AudioStorage } from '@udonarium/core/file-storage/audio-storage';
import { UUID } from '@udonarium/core/system/util/uuid';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { CutInComponent } from 'component/cut-in/cut-in.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';


@Component({
    selector: 'app-cut-in-setting',
    templateUrl: './cut-in-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './cut-in-setting.component.css'],
    standalone: false
})
export class CutInSettingComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('cutInSelecter') cutInSelecter: ElementRef<HTMLSelectElement>;
  readonly minSize: number = 0;
  readonly maxSize: number = 100;

  panelId: string;

  isShowHideImages = false;
  selectedCutIn: CutIn;
  selectedCutInXml: string = '';

  get cutIns(): CutIn[] { return CutInList.instance.cutIns; }

  get cutInName(): string { return this.selectedCutIn.name; }
  set cutInName(cutInName: string) { if (this.isEditable) this.selectedCutIn.name = cutInName; }

  get cutInTag(): string { return this.selectedCutIn.tag; }
  set cutInTag(cutInTag: string) { if (this.isEditable) this.selectedCutIn.tag = cutInTag; }

  get cutInDuration(): number { return this.selectedCutIn.duration; }
  set cutInDuration(cutInDuration: number) { if (this.isEditable) this.selectedCutIn.duration = cutInDuration; }

  get cutInCond(): string { return this.selectedCutIn.value + ''; }
  set cutInCond(cutInCond: string) { if (this.isEditable) this.selectedCutIn.value = cutInCond; }

  get cutInIsPreventOutBounds(): boolean { return this.selectedCutIn.isPreventOutBounds; }
  set cutInIsPreventOutBounds(isPreventOutBounds: boolean) { if (this.isEditable) this.selectedCutIn.isPreventOutBounds = isPreventOutBounds; }

  get cutInWidth(): number { return this.selectedCutIn.width; }
  set cutInWidth(cutInWidth: number) { if (this.isEditable) this.selectedCutIn.width = cutInWidth; }

  get cutInHeight(): number { return this.selectedCutIn.height; }
  set cutInHeight(cutInHeight: number) { if (this.isEditable) this.selectedCutIn.height = cutInHeight; }

  get objectFitType(): number { return this.selectedCutIn.objectFitType; }
  set objectFitType(objectFitType: number) { if (this.isEditable) this.selectedCutIn.objectFitType = objectFitType; }

  get cutInPosX(): number { return this.selectedCutIn.posX; }
  set cutInPosX(cutInPosX: number) { if (this.isEditable) this.selectedCutIn.posX = cutInPosX; }

  get cutInPosY(): number { return this.selectedCutIn.posY; }
  set cutInPosY(cutInPosY: number) { if (this.isEditable) this.selectedCutIn.posY = cutInPosY; }

  get cutInZIndex(): number { return this.selectedCutIn.zIndex; }
  set cutInZIndex(cutInZIndex: number) { if (this.isEditable) this.selectedCutIn.zIndex = cutInZIndex; }

  get cutInIsFrontOfStand(): boolean { return this.selectedCutIn.isFrontOfStand; }
  set cutInIsFrontOfStand(isFrontOfStand: boolean) { if (this.isEditable) this.selectedCutIn.isFrontOfStand = isFrontOfStand; }

  get cutInAudioIdentifier(): string { return this.selectedCutIn.audioIdentifier; }
  set cutInAudioIdentifier(audioIdentifier: string) { if (this.isEditable) this.selectedCutIn.audioIdentifier = audioIdentifier; }
  
  get cutInAudioFileName(): string { return this.selectedCutIn?.audioFileName || ''; }
  set cutInAudioFileName(audioFileName: string) { if (this.isEditable) this.selectedCutIn.audioFileName = audioFileName; }

  //get cutInSEIsLoop(): boolean { return this.selectedCutIn.endedAction == 2; }
  //set cutInSEIsLoop(isLoop: boolean) { if (this.isEditable) this.selectedCutIn.endedAction = 2; }

  get cutInMediaEndedActionType(): number { return this.selectedCutIn.endedActionType; }
  set cutInMediaEndedActionType(cutInMediaEndedActionType: number) { if (this.isEditable) this.selectedCutIn.endedActionType = cutInMediaEndedActionType; }

  get cutInType(): number { return this.selectedCutIn.animationType; }
  set cutInType(cutInType: number) { if (this.isEditable) this.selectedCutIn.animationType = cutInType; }

  get borderStyle(): number { return this.selectedCutIn.borderStyle; }
  set borderStyle(borderStyle: number) { if (this.isEditable) this.selectedCutIn.borderStyle = borderStyle; }

  get isEmpty(): boolean { return this.cutIns.length < 1; }
  get isDeleted(): boolean { return this.selectedCutIn ? ObjectStore.instance.get(this.selectedCutIn.identifier) == null : false; }
  get isEditable(): boolean { return !this.isEmpty && !this.isDeleted; }

  get cutInIsVideo(): boolean { return this.selectedCutIn.isVideoCutIn; }
  set cutInIsVideo(isVideo: boolean) { if (this.isEditable) this.selectedCutIn.isVideoCutIn = isVideo; }

  get cutInVideoURL(): string { return this.selectedCutIn.videoUrl; }
  set cutInVideoURL(videoUrl: string) { if (this.isEditable) this.selectedCutIn.videoUrl = videoUrl; }

  get cutInisSoundOnly(): boolean { return this.selectedCutIn.isSoundOnly; }
  set cutInisSoundOnly(isSoundOnly: boolean) { if (this.isEditable)  this.selectedCutIn.isSoundOnly = isSoundOnly; }

  get cutInVideoId(): string {
    if (!this.selectedCutIn) return '';
    return this.selectedCutIn.videoId;
  }

  get cutInPlayListId(): string {
    if (!this.cutInVideoId) return '';
    return this.selectedCutIn.playListId;
  }

  get cutInImage(): ImageFile {
    if (!this.selectedCutIn) return ImageFile.Empty;
    let file = ImageStorage.instance.get(this.selectedCutIn.imageIdentifier);
    return file ? file : ImageFile.Empty;
  }
  
  get cutInImageUrl(): string {
    if (!this.selectedCutIn) return ImageFile.Empty.url;
    return (!this.selectedCutIn.videoId || this.cutInisSoundOnly) ? this.cutInImage.url : `https://img.youtube.com/vi/${this.selectedCutIn.videoId}/hqdefault.jpg`;
  }

  get isPlaying(): boolean {
    if (!this.selectedCutIn) return false;
    return CutInService.nowShowingIdentifiers().includes(this.selectedCutIn.identifier);
  }
  
  get isValidAudio(): boolean {
    if (!this.selectedCutIn) return true;
    return this.selectedCutIn.isValidAudio;
  }
  
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }
  get otherPeers(): PeerCursor[] { return [PeerCursor.myCursor, ...Network.peers.filter(peer => peer.isOpen).map(peer => PeerCursor.findByPeerId(peer.peerId))].filter(peerCursor => peerCursor); /* ObjectStore.instance.getObjects(PeerCursor); */ }

  get myColor(): string {
    if (PeerCursor.myCursor
      && PeerCursor.myCursor.color
      && PeerCursor.myCursor.color != PeerCursor.CHAT_TRANSPARENT_COLOR) {
      return PeerCursor.myCursor.color;
    }
    return PeerCursor.CHAT_DEFAULT_COLOR;
  }

  get sendToColor(): string {
    let object = ObjectStore.instance.get(this.sendTo);
    if (object instanceof PeerCursor) {
      return object.color;
    }
    return PeerCursor.CHAT_DEFAULT_COLOR;
  }

  get audios(): AudioFile[] { return AudioStorage.instance.audios.filter(audio => !audio.isHidden); }

  sendTo: string = '';
  isSaveing: boolean = false;
  progresPercent: number = 0;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    private chatMessageService: ChatMessageService,
    public i18n: I18nService
  ) { }

  ngOnInit(): void {
    Promise.resolve().then(() => this.updateTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', -1000, () => this.updateTitle())
      .on('SYNCHRONIZE_AUDIO_LIST', -1000, event => {
        this.onAudioFileChange();
      });
    this.panelId = UUID.generateUuid();
  }

  ngAfterViewInit() {
    queueMicrotask(() => {
      if (this.cutIns.length > 0) {
        this.onChangeCutIn(this.cutIns[0].identifier);
        this.cutInSelecter.nativeElement.selectedIndex = 0;
      }
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private updateTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('cutin.title');
  }

  onChangeCutIn(identifier: string) {
    this.selectedCutIn = ObjectStore.instance.get<CutIn>(identifier);
    this.selectedCutInXml = '';
  }

  create(name: string = 'CutIn'): CutIn {
    return CutInList.instance.addCutIn(name)
  }

  add() {
    const cutIn = this.create();
    cutIn.imageIdentifier = 'stand_no_image';
    queueMicrotask(() => {
      this.onChangeCutIn(cutIn.identifier);
      this.cutInSelecter.nativeElement.value = cutIn.identifier;
    })
  }
  
  async save() {
    if (!this.selectedCutIn || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    let fileName: string = 'fly_cutIn_' + this.selectedCutIn.name;

    await this.saveDataService.saveGameObjectAsync(this.selectedCutIn, fileName, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  importXml() {
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  delete() {
    if (!this.selectedCutIn) return;
    EventSystem.call('STOP_CUT_IN', { 
      identifier: this.selectedCutIn.identifier
    });
    if (!this.isEmpty) {
      this.selectedCutInXml = this.selectedCutIn.toXml();
      this.selectedCutIn.destroy();
    }
  }

  restore() {
    if (this.selectedCutIn && this.selectedCutInXml) {
      let restoreCutIn = <CutIn>ObjectSerializer.instance.parseXml(this.selectedCutInXml);
      CutInList.instance.addCutIn(restoreCutIn);
      this.selectedCutInXml = '';
      queueMicrotask(() => {
        const cutIns = this.cutIns;
        this.onChangeCutIn(cutIns[cutIns.length - 1].identifier);
        this.cutInSelecter.nativeElement.selectedIndex = cutIns.length - 1;
      });
    }
  }

  getHidden(image: ImageFile): boolean {
    const imageTag = ImageTag.get(image.identifier);
    return imageTag ? imageTag.hide : false;
  }

  upTabIndex() {
    if (!this.selectedCutIn) return;
    let parentElement = this.selectedCutIn.parent;
    let index: number = parentElement.children.indexOf(this.selectedCutIn);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.selectedCutIn, prevElement);
    }
  }

  downTabIndex() {
    if (!this.selectedCutIn) return;
    let parentElement = this.selectedCutIn.parent;
    let index: number = parentElement.children.indexOf(this.selectedCutIn);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.selectedCutIn);
    }
  }

  openModal() {
    if (this.isDeleted) return;
    let currentImageIdentifires: string[] = [];
    if (this.selectedCutIn && this.selectedCutIn.imageIdentifier) currentImageIdentifires = [this.selectedCutIn.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!this.selectedCutIn || !value) return;
      this.selectedCutIn.imageIdentifier = value;
    });
  }

  onShowHiddenImages($event: Event) {
    if (this.isShowHideImages) {
      this.isShowHideImages = false;
    } else {
      $event.preventDefault();
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('cutin.showHiddenTitle'), 
        text: this.i18n.t('cutin.showHiddenText'),
        help: this.i18n.t('cutin.showHiddenHelp'),
        type: ConfirmationType.OK_CANCEL,
        materialIcon: 'visibility',
        action: () => {
          this.chatMessageService.sendOperationLog(this.i18n.t('cutin.showHiddenLog'));
          this.isShowHideImages = true;
          (<HTMLInputElement>$event.target).checked = true;
          this.changeDetector.markForCheck();
        }
      });
    }
  }

  playCutIn() {
    const cutIn = this.selectedCutIn;
    if (!cutIn) return;
    const sendObj = {
      identifier: cutIn.identifier,
      secret: this.sendTo ? true : false,
      sender: PeerCursor.myCursor.peerId
    };
    if (sendObj.secret) {
      const targetPeer = ObjectStore.instance.get<PeerCursor>(this.sendTo);
      if (targetPeer) {
        if (targetPeer.peerId != PeerCursor.myCursor.peerId) EventSystem.call('PLAY_CUT_IN', sendObj, targetPeer.peerId);
        EventSystem.call('PLAY_CUT_IN', sendObj, PeerCursor.myCursor.peerId);
      }
    } else {
      EventSystem.call('PLAY_CUT_IN', sendObj);
      this.chatMessageService.sendOperationLog(this.i18n.t('cutin.playedLog', { name: cutIn.name == '' ? this.i18n.t('cutin.unnamed') : cutIn.name }));
    }
  }

  stopCutIn() {
    if (!this.selectedCutIn) return;
    const sendObj = {
      identifier: this.selectedCutIn.identifier,
      secret: this.sendTo ? true : false,
      sender: PeerCursor.myCursor.peerId
    };
    if (sendObj.secret) {
      const targetPeer = ObjectStore.instance.get<PeerCursor>(this.sendTo);
      if (targetPeer) {
        if (targetPeer.peerId != PeerCursor.myCursor.peerId) EventSystem.call('STOP_CUT_IN', sendObj, targetPeer.peerId);
        EventSystem.call('STOP_CUT_IN', sendObj, PeerCursor.myCursor.peerId);
      }
    } else {
      EventSystem.call('STOP_CUT_IN', sendObj);
    }
  }

  testCutIn() {
    if (!this.selectedCutIn) return;
    queueMicrotask(() => {
      EventSystem.trigger('PLAY_CUT_IN', { 
        identifier: this.selectedCutIn.identifier, 
        test: true
      });
    });
  }

  onAudioFileChange(identifier: string='') {
    if (!identifier && this.selectedCutIn) identifier = this.selectedCutIn.audioIdentifier;
    if (identifier == '') {
      this.cutInAudioFileName = '';
      return;
    }
    const audio = AudioStorage.instance.get(identifier);
    this.cutInAudioFileName = audio ? audio.name : '';
  }

  openYouTubeTerms() {
    this.modalService.open(OpenUrlComponent, { url: 'https://www.youtube.com/terms', title: this.i18n.t('cutin.youtubeTerms') });
    return false;
  }

  helpCutIn() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 620, height: 600 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = this.i18n.t('cutin.help');
    textView.text = this.i18n.t('cutin.helpText', { minSize: CutInComponent.MIN_SIZE });
  }
}