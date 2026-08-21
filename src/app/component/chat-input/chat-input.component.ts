import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, ViewChild } from '@angular/core';
import { ChatMessage } from '@udonarium/chat-message';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { IMAGE_SOURCE_MAX_BYTES } from '@udonarium/core/file-storage/image-normalize';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerContext } from '@udonarium/core/system/network/peer-context';
import { ResettableTimeout } from '@udonarium/core/system/util/resettable-timeout';
import { DiceBot } from '@udonarium/dice-bot';
import { popupCharacterChatBalloon } from '@udonarium/chat-balloon';
import { CharacterToken } from '@udonarium/character-token';
import { GameCharacter } from '@udonarium/game-character';
import { GuestSession } from '@udonarium/guest-session';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { FileSelecterComponent } from 'component/file-selecter/file-selecter.component';
import { BatchService } from 'service/batch.service';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';

import { ContextMenuSeparator, ContextMenuService, ContextMenuAction, contextMenuToggleCheck } from 'service/context-menu.service';
import { CharacterSettingsComponent } from 'component/character-settings/character-settings.component';
import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';

import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';

import { PeerMenuComponent } from 'component/peer-menu/peer-menu.component';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ChatTab } from '@udonarium/chat-tab';
import { CutInList } from '@udonarium/cut-in-list';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { DataElement } from '@udonarium/data-element';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { anyImageEffect, clearImageEffects, imageEffectFilter, imageEffectOpacity, imageEffectTransform, packImageFx } from '@udonarium/table-fx/image-effect';

import * as localForage from 'localforage';

interface StandGroup {
  name: string,
  stands: string[]
}

@Component({
    selector: 'chat-input',
    templateUrl: './chat-input.component.html',
    styleUrls: ['./chat-input.component.css'],
    standalone: false
})
export class ChatInputComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('textArea', { static: true }) textAreaElementRef: ElementRef<HTMLTextAreaElement>;

  /** Character whose vision was auto-linked from the chat send-from selector. */
  private visionLinkedCharacterId = '';

  @Input() onlyCharacters: boolean = false;
  @Input() chatTabidentifier: string = '';
  /**
   * Mobile chat-window: when false, hide dicebot (follows the tune panel).
   * null = always show (palette / unbound).
   */
  @Input() mobileExtrasOpen: boolean | null = null;

  /** Collapse dicebot only under mobile layout when extras panel is closed. */
  get isDiceBotCollapsed(): boolean {
    if (this.mobileExtrasOpen !== false) return false;
    return typeof document !== 'undefined'
      && document.documentElement.classList.contains('udon-mobile-layout');
  }
  get isUseStandImageOnChatTab(): boolean {
    const chatTab = <ChatTab>ObjectStore.instance.get(this.chatTabidentifier);
    return chatTab && chatTab.isUseStandImage;
  }

  ClarifyMode(): boolean {
    return ChatWindowComponent.ClarifyMode;
  }

  @Input('gameType') _gameType: string = '';
  @Output() gameTypeChange = new EventEmitter<string>();
  get gameType(): string { return this._gameType };
  set gameType(gameType: string) { this._gameType = gameType; this.gameTypeChange.emit(gameType); }

  @Input('sendFrom') _sendFrom: string = this.myPeer ? this.myPeer.identifier : '';
  @Output() sendFromChange = new EventEmitter<string>();
  get sendFrom(): string { return this._sendFrom };
  set sendFrom(sendFrom: string) {
    this._sendFrom = sendFrom;
    this.sendFromChange.emit(sendFrom);
    this.syncChatCharacterVision(sendFrom);
  }

  @Input('sendTo') _sendTo: string = '';
  @Output() sendToChange = new EventEmitter<string>();
  get sendTo(): string { return this._sendTo };
  set sendTo(sendTo: string) { this._sendTo = sendTo; this.sendToChange.emit(sendTo); }

  @Input('text') _text: string = '';
  @Output() textChange = new EventEmitter<string>();
  get text(): string { return this._text };
  set text(text: string) {
    this._text = text;
    this.textChange.emit(text);
    if (text != null && this.isFilterTextUpdate) this.filterText = text;
  }

  isFilterTextUpdate = false;
  @Input('filterText') _filterText: string = '';
  @Output() filterTextChange = new EventEmitter<string>();
  get filterText(): string { return this._filterText };
  set filterText(filterText: string) { this._filterText = filterText; this.filterTextChange.emit(filterText); }

  @Output() moveToPalette = new EventEmitter<string>();

  @Output() chat = new EventEmitter<{ 
    text: string, gameType: string, sendFrom: string, sendTo: string,
    color?: string, 
    isInverse?:boolean, 
    isHollow?: boolean, 
    isBlackPaint?: boolean,
    imageFx?: string,
    aura?: number, 
    isUseFaceIcon?: boolean, 
    characterIdentifier?: string, 
    standIdentifier?: string, 
    standName?: string,
    isUseStandImage?: boolean,
    attachedImageIdentifiers?: string[] }>();

  /** Pending chat attachments (not yet sent). */
  pendingAttachedImages: ImageFile[] = [];
  isDragOverAttach = false;
  isAttachingImages = false;
  private static readonly MAX_CHAT_IMAGE_BYTES = IMAGE_SOURCE_MAX_BYTES;
  private static readonly MAX_PENDING_ATTACHMENTS = 8;

  get isDirect(): boolean { return this.sendTo != null && this.sendTo.length ? true : false }
  gameHelp: string|string[] = '';

  isUseFaceIcon: boolean = true;
  isUseStandImage: boolean = true;
  isUseChatBalloon: boolean = true;
  
  static history: string[] = new Array();
  private currentHistoryIndex: number = -1;
  private static MAX_HISTORY_NUM = 1000;
  private tmpText;

  get character(): GameCharacter {
    let object = ObjectStore.instance.get(this.sendFrom);
    if (object instanceof GameCharacter) {
      return object;
    }
    return null;
  }

  /** Map Token cosmetics when the speaker is on the table; else sheet seed. */
  get appearanceHost(): GameCharacter | CharacterToken | null {
    return CharacterToken.appearanceHostFor(this.character);
  }

  get isGMMode(): boolean { return !!PeerCursor.myCursor?.isGMMode; }

  get isMyClaimedCharacter(): boolean {
    const ch = this.character;
    const userId = Network.peer?.userId;
    return !!ch && !!userId && ch.playerOwner === userId;
  }

  get isCharacterClaimedByOther(): boolean {
    const ch = this.character;
    const userId = Network.peer?.userId;
    return !!ch && !!ch.playerOwner && ch.playerOwner !== userId;
  }

  get myCharacterButtonLabel(): string {
    if (this.isMyClaimedCharacter) return this.i18n.t('chat.myCharacter');
    if (this.isCharacterClaimedByOther) return this.i18n.t('chat.claimedBy', { name: this.character.playerOwnerName });
    return this.i18n.t('chat.claimCharacter');
  }

  get myCharacterButtonTitle(): string {
    if (this.isMyClaimedCharacter) return this.i18n.t('chat.myCharacterTitle.claimed');
    if (this.isCharacterClaimedByOther) return this.i18n.t('chat.myCharacterTitle.taken', { name: this.character.playerOwnerName });
    return this.i18n.t('chat.myCharacterTitle.claim');
  }

  toggleMyCharacter() {
    const ch = this.character;
    if (!ch || GuestSession.isGuest) return;
    if (this.isCharacterClaimedByOther && !this.isGMMode) return;
    GameCharacter.setAsMyToken(ch, !this.isMyClaimedCharacter);
    EventSystem.trigger('UPDATE_INVENTORY', null);
  }

  get hasStand(): boolean {
    if (!this.character || !this.character.standList) return false;
    return this.character.standList.standElements.length > 0;
  }

  get standPosition(): number {
    return this.character?.standList?.position ?? 0;
  }
  set standPosition(position: number) {
    if (this.character?.standList) this.character.standList.position = position;
  }

  get standNameList(): string[] {
    if (!this.hasStand) return [];
    let ret: string[] = [];
    for (let standElement of this.character.standList.standElements) {
      let nameElement = standElement.getFirstElementByName('name');
      if (nameElement && nameElement.value != null && nameElement.value.toString().trim() != '' && ret.indexOf(nameElement.value.toString()) < 0) {
        ret.push(nameElement.value.toString());
      }
    }
    return this.character.standList.isSortNameList ? ret.sort() : ret;
  }
  standName: string = '';

  get standListNoGroup(): [] {
    return [];
  }

  // 未使用
  get standListWithGroup(): StandGroup[] {
    if (!this.hasStand) return [];
    let ret = {};
    const nameElements = this.character.standList.standElements.map((standElement) => standElement.getFirstElementByName('name')).filter(e => e);
    nameElements.sort((a, b) => a.currentValue === b.currentValue ? 0 : a.currentValue > b.currentValue ? -1 : 1);
    for (const nameElement of nameElements) {
      if (nameElement && nameElement.value) {
        const groupName = (nameElement.currentValue && nameElement.currentValue.toString().length > 0) ? nameElement.currentValue.toString() : '';
        if (groupName) {
          if (!ret[groupName]) ret[groupName] = [];
          if (ret[groupName].indexOf(nameElement.value.toString()) < 0) ret[groupName].push(nameElement.value.toString());
        }
      }
    }
    return Object.keys(ret).sort().map((group) => { return { name: group, stands: ret[group].sort() } }).filter(e => e.stands.length > 0);
  }

  get imageFile(): ImageFile {
    let object = ObjectStore.instance.get(this.sendFrom);
    let image: ImageFile = null;
    if (object instanceof GameCharacter) {
      image = object.imageFile;
    } else if (object instanceof PeerCursor) {
      image = object.image;
    }
    return image ? image : ImageFile.Empty;
  }

  get paletteColor(): string {
    if (this.character 
      && this.character.chatPalette 
      && this.character.chatPalette.paletteColor) {
      return this.character.chatPalette.paletteColor;
    }
    return PeerCursor.CHAT_TRANSPARENT_COLOR; 
  }

  set paletteColor(color: string) {
    if (!this.character) return;
    // Do not create an empty palette just to set color (sync race).
    const palette = this.character.findChatPalette();
    if (!palette) return;
    palette.color = color ? color : PeerCursor.CHAT_TRANSPARENT_COLOR;
  }

  get myColor(): string {
    if (PeerCursor.myCursor
      && PeerCursor.myCursor.color
      && PeerCursor.myCursor.color != PeerCursor.CHAT_TRANSPARENT_COLOR) {
      return PeerCursor.myCursor.color;
    }
    return PeerCursor.CHAT_DEFAULT_COLOR;
  }

  get color(): string {
    if (this.paletteColor && this.paletteColor != PeerCursor.CHAT_TRANSPARENT_COLOR) {
      return this.paletteColor;
    } 
    return this.myColor;
  }

  get sendToColor(): string {
    let object = ObjectStore.instance.get(this.sendTo);
    if (object instanceof PeerCursor) {
      return object.color;
    }
    return PeerCursor.CHAT_DEFAULT_COLOR;
  }

  private shouldUpdateCharacterList: boolean = true;
  private _gameCharacters: GameCharacter[] = [];
  get gameCharacters(): GameCharacter[] {
    if (this.shouldUpdateCharacterList) {
      this.shouldUpdateCharacterList = false;
      this._gameCharacters = ObjectStore.instance
        .getObjects<GameCharacter>(GameCharacter)
        .filter(character =>
          !character.isTemporaryCopy
          && (this.allowsChat(character) || (this.character && this.character.identifier === character.identifier))
        );
    }
    return this._gameCharacters;
  }

  private writingEventInterval: NodeJS.Timeout = null;
  private previousWritingLength: number = 0;

  //writingPeers: Map<string, NodeJS.Timer> = new Map();
  writingPeers: Map<string, ResettableTimeout> = new Map();
  writingPeerNameAndColors: { name: string, color: string, imageUrl: string }[] = [];
  //writingPeerNames: string[] = [];

  get diceBotInfos() { return DiceBot.diceBotInfos }
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }
  get otherPeers(): PeerCursor[] { return [PeerCursor.myCursor, ...Network.peers.filter(peer => peer.isOpen).map(peer => PeerCursor.findByPeerId(peer.peerId))].filter(peerCursor => peerCursor); /** ObjectStore.instance.getObjects(PeerCursor); **/ }

  get diceBotInfosIndexed() { return DiceBot.diceBotInfosIndexed }

  get isAllowsChat(): boolean {
    return !this.character || this.allowsChat(this.character);
  }

  get charImageFilter(): string | null {
    const host = this.appearanceHost;
    return host ? imageEffectFilter(host) : null;
  }
  get charImageOpacity(): number | null {
    const host = this.appearanceHost;
    return host ? imageEffectOpacity(host) : null;
  }
  get charImageTransform(): string | null {
    const host = this.appearanceHost;
    return host ? imageEffectTransform(host) : null;
  }

  constructor(
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    public chatMessageService: ChatMessageService,
    private batchService: BatchService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private contextMenuService: ContextMenuService,
    private characterFxMenu: CharacterFxMenuService,
    private modalService: ModalService,
    private i18n: I18nService,
  ) { }

  ngOnInit(): void {
    EventSystem.register(this)
      .on('MESSAGE_ADDED', event => {
        if (event.data.tabIdentifier !== this.chatTabidentifier) return;
        let message = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (!message) return;
        let peerCursor = ObjectStore.instance.getObjects<PeerCursor>(PeerCursor).find(obj => obj.userId === message.from);
        let sendFrom = peerCursor ? peerCursor.peerId : '?';
        if (this.writingPeers.has(sendFrom)) {
          this.writingPeers.get(sendFrom).stop();
          this.writingPeers.delete(sendFrom);
          this.updateWritingPeerNameAndColors();
        }
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${GameCharacter.aliasName}`, event => {
        this.shouldUpdateCharacterList = true;
        /*
        if (event.data.identifier !== this.sendFrom) return;
        let gameCharacter = ObjectStore.instance.get<GameCharacter>(event.data.identifier);
        if (gameCharacter && !this.allowsChat(gameCharacter)) {
          if (0 < this.gameCharacters.length && this.onlyCharacters) {
            this.sendFrom = this.gameCharacters[0].identifier;
          } else {
            this.sendFrom = this.myPeer.identifier;
          }
        }
        */
      }).on('DELETE_GAME_OBJECT', event => {
        // this.onlyCharacters 為真時，前提是面板會關閉
        if (!this.onlyCharacters && this.sendFrom === event.data.identifier) {
          this.sendFrom = this.myPeer.identifier;
          this.onChangeSendFromList();
        }
      })
      .on('DISCONNECT_PEER', event => {
        let object = ObjectStore.instance.get(this.sendTo);
        if (object instanceof PeerCursor && object.peerId === event.data.peerId) {
          this.sendTo = '';
        }
      })
      .on<string>('WRITING_A_MESSAGE', event => {
        if (event.isSendFromSelf || event.data !== this.chatTabidentifier) return;
        if (!this.writingPeers.has(event.sendFrom)) {
          this.writingPeers.set(event.sendFrom, new ResettableTimeout(() => {
            this.writingPeers.delete(event.sendFrom);
            //this.updateWritingPeerNames();
            this.updateWritingPeerNameAndColors();
            this.ngZone.run(() => { });
          }, 2000));
        }
        this.writingPeers.get(event.sendFrom).reset();
        //this.updateWritingPeerNames();
        this.updateWritingPeerNameAndColors();
        //this.batchService.add(() => this.ngZone.run(() => { }), this);
        this.batchService.requireChangeDetection();
      });
    this.syncChatCharacterVision(this.sendFrom);
    this.ensureCharacterDialogQuotes();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['_sendFrom'] && !changes['_sendFrom'].firstChange) {
      this.syncChatCharacterVision(this._sendFrom);
      this.ensureCharacterDialogQuotes();
    }
  }

  ngOnDestroy() {
    this.clearChatCharacterVision();
    EventSystem.unregister(this);
    this.batchService.remove(this);
  }

  /**
   * Chat "self" character auto-links as a local vision source (not synced visionOwner).
   * Closing this window or switching send-from releases only this window's auto link;
   * manually checked「作為我的視野角色」is untouched.
   */
  private syncChatCharacterVision(sendFromId: string) {
    const userId = Network.peer?.userId;
    if (!userId) return;

    if (this.visionLinkedCharacterId && this.visionLinkedCharacterId !== sendFromId) {
      GameCharacter.releaseAutoVision(this.visionLinkedCharacterId, userId);
      this.visionLinkedCharacterId = '';
    }

    if (this.visionLinkedCharacterId === sendFromId) return;

    const obj = ObjectStore.instance.get(sendFromId);
    if (obj instanceof GameCharacter) {
      GameCharacter.claimAutoVision(obj.identifier, userId);
      this.visionLinkedCharacterId = obj.identifier;
    }
  }

  private clearChatCharacterVision() {
    const userId = Network.peer?.userId;
    if (!userId || !this.visionLinkedCharacterId) return;
    GameCharacter.releaseAutoVision(this.visionLinkedCharacterId, userId);
    this.visionLinkedCharacterId = '';
  }

  private updateWritingPeerNameAndColors() {
    this.writingPeerNameAndColors = Array.from(this.writingPeers.keys()).map(peerId => {
      let peer = PeerCursor.findByPeerId(peerId);
      return {
        name: (peer ? peer.name : ''),
        color: (peer ? peer.color : PeerCursor.CHAT_TRANSPARENT_COLOR),
        imageUrl: (peer ? peer.image.url : ''),
      };
    });
  }
  
  //private updateWritingPeerNames() {
  //  this.writingPeerNames = Array.from(this.writingPeers.keys()).map(peerId => {
  //    let peer = PeerCursor.findByPeerId(peerId);
  //    return peer ? peer.name : '';
  //  });
  //}

  onInput() {
    if (this.writingEventInterval === null && this.previousWritingLength <= this.text.length) {
      let sendTo: string = null;
      if (this.isDirect) {
        let object = ObjectStore.instance.get(this.sendTo);
        if (object instanceof PeerCursor) {
          let peer = PeerContext.parse(object.peerId);
          if (peer) sendTo = peer.peerId;
        }
      }
      EventSystem.call('WRITING_A_MESSAGE', this.chatTabidentifier, sendTo);
      this.writingEventInterval = setTimeout(() => {
        this.writingEventInterval = null;
      }, 200);
    }
    this.previousWritingLength = this.text.length;
    this.calcFitHeight();
  }

  moveHistory(event: Partial<KeyboardEvent>, direction: number) {
    if (event) event.preventDefault();
    if (this.currentHistoryIndex < 0) this.tmpText = this.text;

    if (direction < 0 && this.currentHistoryIndex < 0) {
      this.currentHistoryIndex = -1;
    } else if (direction > 0 && this.currentHistoryIndex >= ChatInputComponent.history.length - 1) {
      this.currentHistoryIndex = ChatInputComponent.history.length - 1;
      return;
    } else {
      this.currentHistoryIndex = this.currentHistoryIndex + direction;
    }

    let histText: string;
    if (this.currentHistoryIndex < 0) {
      this.currentHistoryIndex = -1;
      histText = (this.tmpText && this.tmpText.length) ? this.tmpText : '';
    } else {
      histText = ChatInputComponent.history[this.currentHistoryIndex];
    }

    this.text = histText;
    this.previousWritingLength = this.text.length;
    let textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
    textArea.value = histText;
    this.calcFitHeight();
  }

  moveTo(e: Event) {
    if (!this.textAreaElementRef) return;
    if (this.textAreaElementRef.nativeElement.selectionStart != this.textAreaElementRef.nativeElement.selectionEnd) return;
    if (this.textAreaElementRef.nativeElement.selectionStart === this.textAreaElementRef.nativeElement.value.length) {
      this.moveToPalette.emit(this.text);
      e.preventDefault();
    }
  }

  focusInput() {
    if (!this.textAreaElementRef) return;
    this.textAreaElementRef.nativeElement.focus();
  } 

  onChangeSendFromList() {
    this.standName = '';
    this.shouldUpdateCharacterList = true;
    this.syncChatCharacterVision(this.sendFrom);
    this.ensureCharacterDialogQuotes();
  }

  /** When speaking as a character token, keep empty dialog quotes 「」 ready for chat balloons. */
  private ensureCharacterDialogQuotes() {
    const textArea = this.textAreaElementRef?.nativeElement;
    const blankOrEmptyQuotes = !this.text.trim() || this.text === '「」';

    if (this.character) {
      if (!blankOrEmptyQuotes) return;
      this.text = '「」';
      this.previousWritingLength = this.text.length;
      if (textArea) {
        textArea.value = this.text;
        textArea.setSelectionRange(1, 1);
        this.calcFitHeight();
      }
      return;
    }

    if (this.text === '「」') {
      this.text = '';
      this.previousWritingLength = 0;
      if (textArea) {
        textArea.value = '';
        this.calcFitHeight();
      }
    }
  }

  sendChat(event: Partial<KeyboardEvent>) {
    if (event) event.preventDefault();
    //if (!this.text.length) return;
    if (event && event.keyCode !== 13) return;
    if (!this.isAllowsChat) return;
    if (this.isAttachingImages) return;
    if (!this.sendFrom.length) this.sendFrom = this.myPeer.identifier;

    const attachedImageIdentifiers = this.pendingAttachedImages.map(img => img.identifier);
    if (!StringUtil.cr(this.text).trim() && attachedImageIdentifiers.length === 0) return;
    
    let text = this.text;
    let targetCharacter = this.character;
    const gameType = this.gameType;
    const sendFrom = this.sendFrom;
    const sendTo = this.sendTo;
    const color = this.color;
    const isUseFaceIcon = this.isUseFaceIcon;
    const standName = this.standName;
    const isUseStandImage = this.isUseStandImage;
    const isUseStandImageOnChatTab = this.isUseStandImageOnChatTab;

    if (this.text != '') {
      ChatInputComponent.history = ChatInputComponent.history.filter(string => string !== this.text);
      ChatInputComponent.history.unshift(this.text);
      if (ChatInputComponent.history.length >= ChatInputComponent.MAX_HISTORY_NUM) {
        ChatInputComponent.history.pop();
      }
      this.currentHistoryIndex = -1;
      this.tmpText = null;
    }

    this.text = '';
    this.pendingAttachedImages = [];
    this.previousWritingLength = this.text.length;
    const textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
    if (textArea) textArea.value = '';
    this.calcFitHeight();
    this.ensureCharacterDialogQuotes();
    EventSystem.trigger('MESSAGE_EDITING_START', null);

    (async () => {  
      let matchMostLongText = '';
      let standIdentifier = null;
      const delayRefs: string[] = [];
      // 狀態操作
      if (text != '' && /^[\\￥]+[:：]/.test(text)) {
        // 對整個指令跳脫
        text = text.replace(/[\\￥]([:：])/, '$1');
      } else if (text != '' && StringUtil.toHalfWidth(text).startsWith(':')) {
        if (!targetCharacter) {
          this.chatMessageService.sendOperationLog(this.i18n.t('chat.op.notCharacter'));
        } else if (targetCharacter.chatPalette) {
          const commandsInfo = StringUtil.parseCommands(targetCharacter.chatPalette.evaluate(text.substring(1), targetCharacter.rootDataElement));
          text = commandsInfo.endString;
          if (commandsInfo.commands.length) {
            //await (async () => {
              const charLabel = targetCharacter.name == '' ? this.i18n.t('chat.op.unnamedCharacter') : targetCharacter.name;
              const loggingTexts: string[] = [this.i18n.t('chat.op.commandOf', { name: charLabel, cmd: commandsInfo.commandString })];
              let isDiceRoll = false;
              for (let i = 0; i < commandsInfo.commands.length; i++) {
                let rollResult = null;
                // 僅狀態操作
                  try {
                  const command = commandsInfo.commands[i];
                  if (command.isIncomplete) throw this.i18n.t('chat.op.incomplete', { name: command.targetName });

                  const targetName = targetCharacter.chatPalette.evaluate(command.targetName, targetCharacter.rootDataElement, delayRefs);
                  const operator = StringUtil.toHalfWidth(command.operator);
                  const operateValue = targetCharacter.chatPalette.evaluate(command.value, targetCharacter.rootDataElement, delayRefs);
                  let oldValue: string;
                  let target: DataElement;
                  let delayRef: string;
                  let isOperateNumber = false;
                  let isOperateMaxValue = false;

                  if (target = targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName)) {
                    if (target.isNumberResource || target.isSimpleNumber || target.isAbilityScore) isOperateNumber = true;
                  } else if (
                    target = targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /^最大/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /^Max[\:\_\-\s]*/i)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /^初期/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /初期値$/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /最大値$/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /\.max$/i)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /^基本/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /^原/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /\^$/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /基本値$/)
                    || targetCharacter.detailDataElement.getFirstElementByNameUnsensitive(targetName, /原点$/)
                  ) {
                    if (target.isNumberResource || target.isAbilityScore) {
                      isOperateNumber = true;
                      isOperateMaxValue = true;
                    } else {
                      target = null;
                    }
                  }
                  
                  if (!target) {
                    const missing = StringUtil.cr(targetName).trim() == '' ? this.i18n.t('chat.op.unnamedVar') : StringUtil.cr(targetName).trim();
                    throw this.i18n.t('chat.op.notFound', { name: missing });
                  }

                  oldValue = target.loggingValue;
                  let value = null;
                  if (command.isEscapeRoll || operator === '>') {
                    value = operateValue;
                  } else {
                    const testHalfWidthText = StringUtil.toHalfWidth(operateValue.replace(/[―ー—‐]/g, '-')).trim();
                    //const rollText = StringUtil.toHalfWidth(operateValue.replace(/[ⅮÐ]/g, 'D').replace(/×/g, '*').replace(/÷/g, '/').replace(/[―ー—‐]/g, '-')).trim();
                    if (StringUtil.cr(testHalfWidthText) == '') {
                      value = '';
                    } else {
                      if (/^[\+\-]?\d+$/.test(testHalfWidthText)) {
                        value = parseInt(testHalfWidthText);
                      } else if (/^[\d\+\-\*\/\(\)]+$/.test(testHalfWidthText.replace(/[ⅮÐ]/g, 'D').replace(/×/g, '*').replace(/÷/g, '/'))) {
                        rollResult = await DiceBot.rollCommandAsync(`C(${testHalfWidthText.replace(/[ⅮÐ]/g, 'D').replace(/×/g, '*').replace(/÷/g, '/')})`, gameType ? gameType : 'DiceBot');
                      } else if (/^[cＣｃ][hＨｈ][oＯｏ][iＩｉ][cＣｃ][eＥｅ]/i.test(operateValue) || /^[a-zA-Z0-9!-/:-@¥[-`{-~\}]+$/.test(testHalfWidthText.replace(/[ⅮÐ]/g, 'D').replace(/×/g, '*').replace(/÷/g, '/'))
                        || DiceRollTableList.instance.diceRollTables.some(diceRollTable => diceRollTable.command != null && (new RegExp('^' + StringUtil.toHalfWidth(diceRollTable.command.replace(/[―ー—‐]/g, '-')).toUpperCase().trim() + '([=+\\-]\\d*)?$')).test(testHalfWidthText.toUpperCase()))) {
                        rollResult = await DiceBot.rollCommandAsync(operateValue, gameType ? gameType : 'DiceBot');
                      } else {
                        value = operateValue;
                      }
                      if (rollResult) {
                        //console.log(rollResult.result)
                        let match = null;
                        if (isOperateNumber && rollResult.result.length > 0 && (match = rollResult.result.match(/\s＞\s(?:成功数|計算結果)?(\-?\d+)$/))) {
                          value = match[1];
                        } else if (target.isCheckProperty && (rollResult.isSuccess || rollResult.isFailure)) {
                          value = rollResult.isSuccess ? '1' : '0';
                        } else if (rollResult.result.length > 0) {
                          value = rollResult.isDiceRollTable ? rollResult.result.split(/\s＞\s/).slice(1).join('') : rollResult.result.split(/\s＞\s/).slice(-1)[0];
                        }
                      } else if (!isOperateNumber) {
                        value = operateValue;
                      }
                    }
                  }
                  //console.log(value)
                  if (value == null 
                    || (rollResult && rollResult.isDiceRollTable && rollResult.isFailure) 
                    || (isOperateNumber && value !== '' && isNaN(value))) {
                    const varName = target.name == '' ? this.i18n.t('chat.op.unnamedVar') : target.name;
                    throw this.i18n.t('chat.op.errorOp', { name: varName, detail: command.operator + command.value });
                  } else if (target.isUrl && !StringUtil.validUrl(StringUtil.cr(value))) {
                    const varName = target.name == '' ? this.i18n.t('chat.op.unnamedVar') : target.name;
                    throw this.i18n.t('chat.op.badUrl', { name: varName, value: command.value });
                  }
                  //console.log(value)
                  if (operator === '>') {
                    if (isOperateNumber) {
                      if (value != '') {
                        if (target.isNumberResource && !isOperateMaxValue) {
                          const dValue: number = parseInt(target.currentValue + '');
                          target.currentValue = parseInt(value);
                          delayRef = (parseInt(value) - dValue).toString();
                        } else {
                          const dValue = target.value == null ? 0 : parseInt(target.value + '');
                          target.value = parseInt(value);
                          delayRef = (parseInt(value) - dValue).toString();
                        }
                      } else {
                        delayRef = '0';
                      }
                    } else if (target.isCheckProperty) {
                      target.value = (value == '' || parseInt(value) == 0 || StringUtil.toHalfWidth(value).toLowerCase() === 'off' || StringUtil.toHalfWidth(value).toLowerCase() === '☐') ? '' : target.name;
                    } else if (target.isNote || target.isUrl) {
                      target.value = StringUtil.cr(value);
                    } else {
                      target.value = StringUtil.cr(value).replace(/(:?\r\n|\r|\n)/g, ' ');
                    }
                  } else if (target.isNumberResource && !isOperateMaxValue) {
                    if (value != null && value.toString() != '') {
                      //console.log(value)
                      const dValue: number = parseInt(target.currentValue + '');
                      const result: number = parseInt((target.currentValue && operator !== '=') ? target.currentValue.toString() : '0') + (parseInt(value) * (operator === '-' ? -1 : 1));
                      if (result <= parseInt(target.currentValue + '')) {
                        target.currentValue = result;
                      } else if (result > parseInt(target.value + '') && parseInt(target.currentValue + '') < parseInt(target.value + '') && parseInt(target.value + '') != 0) {
                        target.currentValue = target.value;
                      } else if (result <= parseInt(target.value + '') || parseInt(target.value + '') == 0) {
                        target.currentValue = result;
                      }
                      delayRef = (parseInt(target.currentValue + '') - dValue).toString();
                    } else {
                      delayRef = '0';
                    }
                  } else if (isOperateNumber) {
                    const dValue: number = target.currentValue == null ? 0 : parseInt(target.value.toString());
                    if (value != null && value.toString() != '') target.value = parseInt(target.value && operator !== '=' ? target.value + '' : '0') + (parseInt(value) * (operator === '-' ? -1 : 1));
                    delayRef = (parseInt(target.value + '') - dValue).toString();
                  } else if (target.isCheckProperty) {
                    //if (operator == '=') {
                    switch (operator) {
                    case '=':
                      target.value = (value === '' || parseInt(value) === 0 || StringUtil.toHalfWidth(value).toLowerCase() === 'off' || StringUtil.toHalfWidth(value).toLowerCase() === '☐') ? '' : target.name;
                      break;
                    case '+':
                      target.value = target.name;
                      break;
                    case '-':
                      target.value = '';
                      break;
                    }
                  } else if (operator === '=') {
                    if (target.isNote || target.isUrl) {
                      target.value = (isNaN(value) || value === '' || target.isUrl) ? StringUtil.cr(value) : parseInt(value);
                    } else {
                      target.value = (isNaN(value) || value === '') ? StringUtil.cr(value).replace(/(:?\r\n|\r|\n)/g, ' ') : parseInt(value);
                    }
                  } else {
                    const varName = target.name === '' ? this.i18n.t('chat.op.unnamedVar') : target.name;
                    throw this.i18n.t('chat.op.errorOp', { name: varName, detail: command.operator + command.value });
                  }
                  const newValue = target.loggingValue;
                  const varLabel = target.name === '' ? this.i18n.t('chat.op.unnamedVar') : target.name;
                  const noChange = this.i18n.t('chat.op.noChange');
                  let loggingText = this.i18n.t('chat.op.action', { name: varLabel });
                  if (isOperateNumber) {
                    loggingText += ` ${oldValue} → ${oldValue === newValue ? noChange : newValue}`;
                  } else if (target.isCheckProperty) {
                    loggingText += `${oldValue === newValue ? ' ' + noChange : newValue}`
                  } else {
                    loggingText += ` "${oldValue}" → ${oldValue === newValue ? noChange : '"' + newValue + '"'}`;
                  }
                  if (rollResult) {
                    if (rollResult.isDiceRollTable) {
                      loggingText += ` (${rollResult.tableName}：${rollResult.isEmptyDice ? '' : '🎲'}${rollResult.result.split(/\s＞\s/)[0]})`;
                    } else {
                      loggingText += ` (${ rollResult.result.split(/\s＞\s/g).map((str, j) => (j == 0 ? (rollResult.isEmptyDice ? this.i18n.t('chat.op.calcResult') : '🎲' + gameType + this.i18n.t('common.colon') + str.replace(/^c?\(/i, '').replace(/\)$/, '')) : str)).join(' → ') })`;
                    }
                    if (!rollResult.isEmptyDice) isDiceRoll = true;
                  }
                  //console.log(delayRef)
                  loggingTexts.push(loggingText);
                  delayRefs.push(delayRef != null ? delayRef : '');
                  //console.log(delayRefs)
                } catch (error) {
                  // 偷懶寫法，應改為例外設計
                  if (error instanceof Error) throw error;
                  loggingTexts.push(error);
                  delayRefs.push('');
                  continue;
                }
              }
              if (loggingTexts.length) this.chatMessageService.sendOperationLog(loggingTexts.join("\n"));
              if (isDiceRoll) {
                if (Math.random() < 0.5) {
                  SoundEffect.play(PresetSound.diceRoll1);
                } else {
                  SoundEffect.play(PresetSound.diceRoll2);
                }
              }
            //})();
          }
        }
      }
      if (targetCharacter?.chatPalette) {
        text = targetCharacter.chatPalette.evaluate(text, targetCharacter.rootDataElement, delayRefs);
      }
      if (targetCharacter) {
        // 立繪（stand）
        // 曾考慮空字串也觸發立繪較方便，但送出訊息後再按 Enter 易誤觸，故僅在有指定時觸發
        if (StringUtil.cr(text).trim() || standName) {
          // 立繪
          if (targetCharacter.standList) {
            let imageIdentifier = null;
            if (isUseFaceIcon && targetCharacter.faceIcon) {
              imageIdentifier = targetCharacter.faceIcon.identifier;
            } else {
              imageIdentifier = targetCharacter.imageFile ? targetCharacter.imageFile.identifier : null;
            }
            const standInfo = targetCharacter.standList.matchStandInfo(text, imageIdentifier, standName);
            if (isUseStandImage && isUseStandImageOnChatTab) {
              if (standInfo.farewell) {
                this.farewellStand(targetCharacter);
              } else if (standInfo.standElementIdentifier) {
                standIdentifier = standInfo.standElementIdentifier;
                const sendObj = {
                  characterIdentifier: targetCharacter.identifier, 
                  standIdentifier: standInfo.standElementIdentifier, 
                  color: targetCharacter.chatPalette ? targetCharacter.chatPalette.color : PeerCursor.CHAT_DEFAULT_COLOR,
                  secret: sendTo ? true : false
                };
                if (sendObj.secret) {
                  const targetPeer = ObjectStore.instance.get<PeerCursor>(sendTo);
                  if (targetPeer) {
                    if (targetPeer.peerId != PeerCursor.myCursor.peerId) EventSystem.call('POPUP_STAND_IMAGE', sendObj, targetPeer.peerId);
                    EventSystem.call('POPUP_STAND_IMAGE', sendObj, PeerCursor.myCursor.peerId);
                  }
                } else {
                  EventSystem.call('POPUP_STAND_IMAGE', sendObj);
                }
              }
            }
            matchMostLongText = standInfo.matchMostLongText;
          }
        }
      }
      // 過場動畫（cut-in）
      const cutInInfo = CutInList.instance.matchCutInInfo(text);
      if (isUseStandImageOnChatTab && cutInInfo) {
        for (const identifier of cutInInfo.identifiers) {
          const sendObj = {
            identifier: identifier, 
            secret: sendTo ? true : false,
            sender: PeerCursor.myCursor.peerId
          };
          if (sendObj.secret) {
            const targetPeer = ObjectStore.instance.get<PeerCursor>(sendTo);
            if (targetPeer) {
              if (targetPeer.peerId != PeerCursor.myCursor.peerId) EventSystem.call('PLAY_CUT_IN', sendObj, targetPeer.peerId);
              EventSystem.call('PLAY_CUT_IN', sendObj, PeerCursor.myCursor.peerId);
            }
          } else {
            EventSystem.call('PLAY_CUT_IN', sendObj);
          }
        }
        if (cutInInfo.names && cutInInfo.names.length && !sendTo) {
          const counter = new Map();
          for (const name of cutInInfo.names) {
            let count = counter.get(name) || 0;
            count += 1;
            counter.set(name == '' ? this.i18n.t('chat.op.unnamedCutin') : name, count);
          }
          const text = `${[...counter.keys()].map(key => counter.get(key) > 1 ? `${key}×${counter.get(key)}` : key).join(this.i18n.t('common.listSep'))}`;
          this.chatMessageService.sendOperationLog(this.i18n.t('chat.op.cutinStarted', { text }));
        }
      }
      // 裁切
      if (matchMostLongText.length < cutInInfo.matchMostLongText.length) matchMostLongText = cutInInfo.matchMostLongText;
      text = text.slice(0, text.length - matchMostLongText.length);
      // 💭
      if (this.isUseChatBalloon && isUseStandImageOnChatTab && targetCharacter && StringUtil.cr(text).trim()) {
        popupCharacterChatBalloon(targetCharacter, text, {
          color,
          faceIconIdentifier: (isUseFaceIcon && targetCharacter.faceIcon) ? targetCharacter.faceIcon.identifier : null,
          sendTo: sendTo || undefined,
        });
      }

      if (PeerCursor.isGMHold && !sendTo && !PeerCursor.myCursor.isGMMode && /GM(?:モード)?にな(?:ります|る)/i.test(StringUtil.toHalfWidth(text))) {
        PeerCursor.myCursor.isGMMode = true;
        this.chatMessageService.sendOperationLog(this.i18n.t('peer.enterGm'));
        EventSystem.trigger('CHANGE_GM_MODE', null);
      }

      if (StringUtil.cr(text).trim() || attachedImageIdentifiers.length > 0) {
        this.chat.emit({
          text: text,
          gameType: gameType,
          sendFrom: sendFrom,
          sendTo: sendTo,
          color: color, 
          isInverse: targetCharacter ? targetCharacter.isInverse : false,
          isHollow: targetCharacter? targetCharacter.isHollow : false,
          isBlackPaint: targetCharacter ? targetCharacter.isBlackPaint : false,
          imageFx: targetCharacter ? packImageFx(targetCharacter) : '',
          aura: targetCharacter ? targetCharacter.aura : -1,
          isUseFaceIcon: isUseFaceIcon,
          characterIdentifier: targetCharacter ? targetCharacter.identifier : null,
          standIdentifier: standIdentifier,
          standName: standName,
          isUseStandImage: (isUseStandImage && isUseStandImageOnChatTab),
          attachedImageIdentifiers
        });
      }
    })();
  }

  async onPaste(e: ClipboardEvent) {
    if (!this.isAllowsChat || !e.clipboardData) return;
    const files = this.imageFilesFromDataTransfer(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    await this.attachImageFiles(files);
  }

  onDragOverAttach(e: DragEvent) {
    if (!this.isAllowsChat || !this.hasImageInDataTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    this.isDragOverAttach = true;
  }

  onDragLeaveAttach(e: DragEvent) {
    e.preventDefault();
    this.isDragOverAttach = false;
  }

  async onDropAttach(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.isDragOverAttach = false;
    if (!this.isAllowsChat || !e.dataTransfer) return;
    const files = this.imageFilesFromDataTransfer(e.dataTransfer);
    if (!files.length) return;
    await this.attachImageFiles(files);
  }

  removePendingAttachment(identifier: string) {
    this.pendingAttachedImages = this.pendingAttachedImages.filter(img => img.identifier !== identifier);
  }

  private hasImageInDataTransfer(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        if (dt.items[i].kind === 'file' && (dt.items[i].type || '').startsWith('image/')) return true;
      }
    }
    if (dt.files) {
      for (let i = 0; i < dt.files.length; i++) {
        if ((dt.files[i].type || '').startsWith('image/')) return true;
      }
    }
    return false;
  }

  private imageFilesFromDataTransfer(dt: DataTransfer): File[] {
    const out: File[] = [];
    const seen = new Set<string>();
    if (dt.items) {
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind !== 'file' || !(item.type || '').startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(file);
      }
    }
    if (!out.length && dt.files) {
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        if ((file.type || '').startsWith('image/')) out.push(file);
      }
    }
    return out;
  }

  private async attachImageFiles(files: File[]) {
    if (!files.length) return;
    this.isAttachingImages = true;
    try {
      for (const file of files) {
        if (this.pendingAttachedImages.length >= ChatInputComponent.MAX_PENDING_ATTACHMENTS) {
          console.warn(this.i18n.t('chat.attachLimit', { count: ChatInputComponent.MAX_PENDING_ATTACHMENTS }));
          break;
        }
        if (file.size > ChatInputComponent.MAX_CHAT_IMAGE_BYTES) {
          console.warn(this.i18n.t('file.maxSize'), file.name);
          continue;
        }
        try {
          const image = await ImageStorage.instance.addAsync(file);
          if (!this.pendingAttachedImages.some(img => img.identifier === image.identifier)) {
            this.pendingAttachedImages = [...this.pendingAttachedImages, image];
          }
        } catch (err) {
          console.warn('chat image attach failed', err);
        }
      }
    } finally {
      this.isAttachingImages = false;
      this.ngZone.run(() => this.changeDetector.markForCheck());
    }
  }

  calcFitHeight() {
    let textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
    textArea.style.height = '';
    if (textArea.scrollHeight >= textArea.offsetHeight) {
      let next = textArea.scrollHeight;
      if (this.ClarifyMode()) {
        const maxPx = parseFloat(getComputedStyle(textArea).maxHeight);
        if (Number.isFinite(maxPx) && maxPx > 0) next = Math.min(next, maxPx);
      }
      textArea.style.height = next + 'px';
    }
  }

  loadDiceBot(gameType: string) {
    console.log('onChangeGameType ready');
    DiceBot.getHelpMessage(gameType).then(help => {
      console.log('onChangeGameType done\n' + help);
    });
  }

  showDicebotHelp() {
    DiceBot.getHelpMessage(this.gameType).then(help => {
      this.gameHelp = help;

      let gameName = this.i18n.t('chat.diceBotHelpTitle', { game: this.i18n.t('chat.diceBotGeneric') });
      for (let diceBotInfo of DiceBot.diceBotInfos) {
        if (diceBotInfo.id === this.gameType) {
          gameName = this.i18n.t('chat.diceBotHelpTitle', { game: diceBotInfo.game });
        }
      }

      let coordinate = this.pointerDeviceService.pointers[0];
      let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 600, height: 500 };
      let textView = this.panelService.open(TextViewComponent, option);
      textView.title = gameName;
      textView.text = this.gameHelp;
    });
  }

  /** Left-click avatar: cycle face (character) or open peer icon picker (player). */
  onImageboxClick(e: Event) {
    e.stopPropagation();
    e.preventDefault();
    if (!this.isAllowsChat) return;

    if (!this.character) {
      this.changePeerIcon();
      return;
    }

    if (this.isUseFaceIcon && this.character.faceIcons?.length > 1) {
      const next = (this.character.currntIconIndex + 1) % this.character.faceIcons.length;
      this.character.currntIconIndex = next;
      return;
    }

    if ((!this.isUseFaceIcon || !this.character.faceIcon) && this.character.imageFiles?.length > 1) {
      const next = (this.character.currntImageIndex + 1) % this.character.imageFiles.length;
      this.character.currntImageIndex = next;
      if (!this.character.isHideIn && this.character.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
      EventSystem.trigger('UPDATE_INVENTORY', null);
    }
  }

  /** Same persistence path as PeerMenuComponent.changeIcon. */
  private changePeerIcon() {
    const myPeer = this.myPeer;
    if (!myPeer) return;
    let currentImageIdentifires: string[] = [];
    if (myPeer.imageIdentifier) currentImageIdentifires = [myPeer.imageIdentifier];
    this.modalService.open<string>(FileSelecterComponent, { currentImageIdentifires: currentImageIdentifires }).then(value => {
      if (!myPeer || !value) return;
      myPeer.imageIdentifier = value;
      const file: ImageFile = ImageStorage.instance.get(value);
      if (file) {
        if (file.state === ImageState.COMPLETE) {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, file.blob).catch(err => console.log(err));
        } else if (value === 'none_icon') {
          localForage.removeItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY).catch(err => console.log(err));
        } else {
          localForage.setItem(PeerCursor.CHAT_MY_ICON_LOCAL_STORAGE_KEY, value).catch(err => console.log(err));
        }
      }
    });
  }

  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu || !this.isAllowsChat) return;

    let position = this.pointerDeviceService.pointers[0];
    if (!this.character) {
      this.contextMenuService.open(
        position, 
        [
          { name: this.i18n.t('chat.ctx.connection'), action: () => {
            this.panelService.open(PeerMenuComponent, {
              width: 520, height: 450, top: position.y - 100, left: position.x - 100,
              tourPanelId: 'menu.connection',
              mobileSheet: 'half',
            });
          } }
        ],
        PeerCursor.myCursor.name, 
        null,
        PeerCursor.myCursor.color,
        true
      );
      return;
    }
    
    let contextMenuActions: ContextMenuAction[] = [
      { name: this.i18n.t('chat.ctx.quote'),
        action: () => {
          let textArea: HTMLTextAreaElement = this.textAreaElementRef.nativeElement;
          let text = this.text.trim();
          if (text.slice(0, 1) != '「') text = '「' + text;
          if (text.slice(-1) != '」') text = text + '」';
          this.text = text;
          textArea.value = this.text;
          textArea.selectionStart = this.text.length - 1;
          textArea.selectionEnd = this.text.length - 1;
          textArea.focus();
        }
      }
    ];
    if (this.character) {
      if (!this.isUseFaceIcon || !this.character.faceIcon) {
        if (this.character.imageFiles.length > 1) {
          contextMenuActions.push(ContextMenuSeparator);
          contextMenuActions.push({
            name: this.i18n.t('chat.ctx.imageSwitch'),
            action: null,
            subActions: this.character.imageFiles.map((image, i) => {
              return { 
                name: `${this.character.currntImageIndex == i ? '◉' : '○'}`, 
                action: () => { 
                  this.character.currntImageIndex = i;
                  if (!this.character.isHideIn && this.character.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
                  EventSystem.trigger('UPDATE_INVENTORY', null);
                }, 
                default: this.character.currntImageIndex == i,
                icon: image,
                checkBox: 'radio'
              };
            })
          });
        }
        contextMenuActions.push(ContextMenuSeparator);
        const fxHost = this.appearanceHost || this.character;
        const fxSubs = this.characterFxMenu.makeImageEffectMenu(fxHost).subActions || [];
        const fxWithoutReset = fxSubs.slice(0, -1);
        contextMenuActions.push({
          name: this.i18n.t('chat.ctx.imageEffect'),
          action: null,
          subActions: [
            ...fxWithoutReset,
            { name: this.i18n.t('chat.ctx.aura'), action: null, subActions: [{ name: `${fxHost.aura == -1 ? '◉' : '○'} ${this.i18n.t('chat.ctx.auraNone')}`, action: () => { fxHost.mutateAppearance(() => { fxHost.aura = -1; }); EventSystem.trigger('UPDATE_INVENTORY', null) }, checkBox: 'radio' }, ContextMenuSeparator].concat(['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'yellow', 'white'].map((color, i) => {
              const sampleColors = ['#000', '#00f', '#0f0', '#0ff', '#f00', '#f0f', '#ff0', '#fff'];
              return { name: `${fxHost.aura == i ? '◉' : '○'} ${this.i18n.t(`chat.aura.${color}`)}`, action: () => { fxHost.mutateAppearance(() => { fxHost.aura = i; }); EventSystem.trigger('UPDATE_INVENTORY', null) }, colorSample: true, sampleColor: sampleColors[i], checkBox: 'radio' };
            })) },
            ContextMenuSeparator,
            {
              name: this.i18n.t('chat.ctx.reset'),
              action: () => {
                fxHost.mutateAppearance(() => {
                  clearImageEffects(fxHost);
                  fxHost.aura = -1;
                });
                EventSystem.trigger('UPDATE_INVENTORY', null);
              },
              disabled: !anyImageEffect(fxHost) && fxHost.aura == -1
            }
          ]
        });
      } else {
        //if (this.character.faceIcons.length > 1) {
          contextMenuActions.push(ContextMenuSeparator);
          contextMenuActions.push({
            name: this.i18n.t('chat.ctx.changeFace'),
            action: null,
            subActions: this.character.faceIcons.map((faceIconImage, i) => {
              return { 
                name: `${this.character.currntIconIndex == i ? '◉' : '○'}`, 
                action: () => { 
                  if (this.character.currntIconIndex != i) {
                    this.character.currntIconIndex = i;
                  }
                }, 
                default: this.character.currntIconIndex == i,
                icon: faceIconImage,
                checkBox: 'radio'
              };
            }),
            disabled: this.character.faceIcons.length <= 1
          });
        //}
      }
      contextMenuActions.push(ContextMenuSeparator);
      contextMenuActions.push({ name: this.i18n.t('chat.ctx.showDetail'), action: () => { this.showDetail(this.character); } });
      if (!this.onlyCharacters) {
        contextMenuActions.push({ name: this.i18n.t('chat.ctx.showPalette'), action: () => { this.showChatPalette(this.character) } });
      }
      contextMenuActions.push({ name: this.i18n.t('chat.ctx.standSetting'), action: () => { this.showStandSetting(this.character) } });
    }
    this.contextMenuService.open(position, contextMenuActions, this.character.name);
  }

  farewellStand(targetCharacter: GameCharacter=null) {
    if (!targetCharacter) targetCharacter = this.character;
    if (this.character) {
      const sendObj = {
        characterIdentifier: this.character.identifier
      };
      if (this.sendTo) {
        const targetPeer = ObjectStore.instance.get<PeerCursor>(this.sendTo);
        if (targetPeer) {
          if (targetPeer.peerId != PeerCursor.myCursor.peerId) EventSystem.call('FAREWELL_STAND_IMAGE', sendObj, targetPeer.peerId);
          EventSystem.call('FAREWELL_STAND_IMAGE', sendObj, PeerCursor.myCursor.peerId);
        }
      } else {
        EventSystem.call('FAREWELL_STAND_IMAGE', sendObj);
      }
    }
  }

  private showDetail(gameObject: GameCharacter) {
    let title = this.i18n.t('chat.characterSheet');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 270, top: coordinate.y - 240, width: 540, height: 480,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CharacterSettingsComponent>(CharacterSettingsComponent, option);
    component.character = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    const tourId = PanelService.tourIdChatPalette(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  private showStandSetting(gameObject: GameCharacter) {
    const tourId = PanelService.tourIdStandSetting(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = gameObject;
  }

  private allowsChat(gameCharacter: GameCharacter): boolean {
    if (!gameCharacter.isAllowsChat) return false;
    switch (gameCharacter.location.name) {
      case 'table':
      case this.myPeer.peerId:
        return true;
      case 'graveyard':
        return false;
      default:
        for (const peer of Network.peers) {
          if (peer.isOpen && gameCharacter.location.name === peer.peerId) {
            return false;
          }
        }
        return true;
    }
  }
}
