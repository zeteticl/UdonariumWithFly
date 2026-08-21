import { Component, ElementRef, Input, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ChatPalette } from '@udonarium/chat-palette';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DiceBot } from '@udonarium/dice-bot';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatInputComponent } from 'component/chat-input/chat-input.component';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ChatMessageService } from 'service/chat-message.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'chat-palette',
    templateUrl: './chat-palette.component.html',
    styleUrls: ['./chat-palette.component.css'],
    standalone: false
})
export class ChatPaletteComponent implements OnInit, OnDestroy {
  @ViewChild('chatInput') chatInputComponent: ChatInputComponent;
  @ViewChild('chatPlette') chatPletteElementRef: ElementRef<HTMLSelectElement>;
  private _character: GameCharacter = null;
  @Input()
  get character(): GameCharacter { return this._character; }
  set character(value: GameCharacter) {
    this._character = value;
    if (value) {
      const gameType = value.chatPalette ? value.chatPalette.dicebot : '';
      if (0 < gameType.length) this._gameType = gameType;
      this.updatePanelTitle();
    }
  }

  get palette(): ChatPalette {
    // Find-only: do not auto-create on every template read (that broadcast empty
    // palettes and could win version races so peers never saw real edits).
    return this.character ? this.character.findChatPalette() : null;
  }
  
  paletteCache: string[] = [];
  paletteRenewInterval: boolean = true;
  paletteRenewIntervalId = setInterval(() => {
    this.paletteRenewInterval = true;
  }, 200);
  get filteredPaletteStrings(): string[] {
    if (!this.character || !this.character.chatPalette) return this.paletteCache;
    this.ngZone.run(() => {
      if (this.paletteRenewInterval) {
        this.paletteRenewInterval = false;
        this.paletteCache = this.character.chatPalette.getPalette().filter(text => this.filter(text));
      }
    });
    return this.paletteCache;
  }

  get color(): string {
    return this.chatInputComponent?.color || PeerCursor.CHAT_DEFAULT_COLOR;
  }

  private _gameType: string = '';
  get gameType(): string { return !this._gameType ? 'DiceBot' : this._gameType; };
  set gameType(gameType: string) {
    this._gameType = gameType;
    if (this.character?.chatPalette) this.character.chatPalette.dicebot = gameType;
  };

  get sendFrom(): string { return this.character ? this.character.identifier : ''; }
  set sendFrom(sendFrom: string) {
    this.onSelectedCharacter(sendFrom);
  }

  chatTabidentifier: string = '';
  text: string = '';
  sendTo: string = '';

  isEdit: boolean = false;
  editPalette: string = '';

  filterText: string = '';

  private doubleClickTimer: NodeJS.Timer = null;

  private selectedPaletteIndex = -1;

  get diceBotInfos() { return DiceBot.diceBotInfos }

  get chatTab(): ChatTab { return ObjectStore.instance.get<ChatTab>(this.chatTabidentifier); }
  get myPeer(): PeerCursor { return PeerCursor.myCursor; }
  get otherPeers(): PeerCursor[] { return [PeerCursor.myCursor, ...Network.peers.filter(peer => peer.isOpen).map(peer => PeerCursor.findByPeerId(peer.peerId))].filter(peerCursor => peerCursor); /* ObjectStore.instance.getObjects(PeerCursor); */ }

  constructor(
    public chatMessageService: ChatMessageService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private ngZone: NgZone,
    private i18n: I18nService
  ) { }

  ngOnInit() {
    Promise.resolve().then(() => this.updatePanelTitle());
    this.chatTabidentifier = this.chatMessageService.chatTabs ? this.chatMessageService.chatTabs[0].identifier : '';
    if (this.character?.chatPalette) {
      this.gameType = this.character.chatPalette.dicebot || '';
    }
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', event => {
        if (this.character && this.character.identifier === event.data.identifier) {
          this.panelService.close();
        }
        if (this.chatTabidentifier === event.data.identifier) {
          this.chatTabidentifier = this.chatMessageService.chatTabs ? this.chatMessageService.chatTabs[0].identifier : '';
        }
      })
      .on('LOCALE_CHANGED', () => this.updatePanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    clearInterval(this.paletteRenewIntervalId);
    // Persist in-progress edits when the panel closes (confirm path).
    if (this.isEdit) this.toggleEditMode();
  }

  updatePanelTitle() {
    if (!this.character) return;
    this.panelService.title = this.i18n.t('palette.title', { name: this.character.name });
  }

  /** Local display label — does not write SyncVar. */
  tabLabel(tab: ChatTab): string {
    if (!tab || tab.name === '') return this.i18n.t('palette.unnamedTab');
    return ChatTabList.localizedName(tab);
  }

  /** Double-click a chat tab: open / bring chat window forward and show that tab. */
  showChatTab(tabIdentifier: string, e?: Event) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!tabIdentifier) return;
    this.chatTabidentifier = tabIdentifier;
    EventSystem.trigger('SHOW_CHAT', { tabIdentifier });
  }

  onSelectedCharacter(identifier: string) {
    if (this.isEdit) this.toggleEditMode();
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      this.character = object;
      let gameType = this.character.chatPalette ? this.character.chatPalette.dicebot : '';
      if (0 < gameType.length) this.gameType = gameType;
    }
    this.updatePanelTitle();
  }

  clickPalette(line: string) {
    if (!this.chatPletteElementRef?.nativeElement || !this.chatInputComponent || !this.character || !this.palette) return;
    const evaluatedLine = this.palette.evaluate(line, this.character.rootDataElement);
    if (this.doubleClickTimer && this.selectedPaletteIndex === this.chatPletteElementRef.nativeElement.selectedIndex) {
      clearTimeout(this.doubleClickTimer);
      this.doubleClickTimer = null;
      this.chatInputComponent.sendChat(null);
    } else {
      this.selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
      this.text = evaluatedLine;
      let textArea: HTMLTextAreaElement = this.chatInputComponent.textAreaElementRef?.nativeElement;
      if (textArea) {
        textArea.value = this.text;
      }
      this.doubleClickTimer = setTimeout(() => { this.doubleClickTimer = null }, 400);
    }
  }

  moveToInput(e: Event) {
    if (!this.chatPletteElementRef?.nativeElement || !this.chatInputComponent) return;
    const selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
    if (selectedPaletteIndex <= 0) {
      this.text = this._tempText;
      const textArea = this.chatInputComponent.textAreaElementRef?.nativeElement;
      if (textArea) {
        textArea.value = this._tempText;
        textArea.focus();
      }
      e.preventDefault();
    }
  }

  arrowPalette() {
    if (!this.chatPletteElementRef?.nativeElement || !this.chatInputComponent || !this.character || !this.palette) return;
    this.selectedPaletteIndex = this.chatPletteElementRef.nativeElement.selectedIndex;
    if (this.selectedPaletteIndex >= 0 && this.chatPletteElementRef.nativeElement.options[this.selectedPaletteIndex]) {
      this.ngZone.run(() => {
        this.text = this.palette.evaluate(this.chatPletteElementRef.nativeElement.options[this.selectedPaletteIndex].value, this.character.rootDataElement);
        let textArea: HTMLTextAreaElement = this.chatInputComponent.textAreaElementRef?.nativeElement;
        if (textArea) {
          textArea.value = this.text;
        }
      });
    }
  }

  enterPalette(line: string, e: Event=null) {
    if (!this.chatPletteElementRef?.nativeElement || !this.chatInputComponent || !this.character || !this.palette) return;
    this.text = this.palette.evaluate(line, this.character.rootDataElement);
    //this.chatInputComponent.sendChat(null);
    this.chatInputComponent.focusInput();
    //this.chatPletteElementRef.nativeElement.selectedIndex = -1;
    //this.filterText = '';
    if (e) e.preventDefault();
  }

  private _tempText: string;
  moveToPalette(tempText: string) {
    this._tempText = tempText;
    if (!this.chatPletteElementRef?.nativeElement) return;
    if (this.chatPletteElementRef.nativeElement.options.length <= 0) return;
    if (this.chatPletteElementRef.nativeElement.selectedIndex <= 0) this.chatPletteElementRef.nativeElement.options[0].selected = true;
    this.chatPletteElementRef.nativeElement.focus();
  }

  sendChat(value: { text: string, gameType: string, sendFrom: string, sendTo: string,
    color?: string, isInverse?:boolean, isHollow?: boolean, isBlackPaint?: boolean, imageFx?: string, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName?: string, isUseStandImage?: boolean, attachedImageIdentifiers?: string[] }) {
    if (!this.chatTab || !this.character || !this.palette) return;
    let text = this.palette.evaluate(value.text, this.character.rootDataElement);
    this.chatMessageService.sendMessage(
      this.chatTab,
      text,
      value.gameType,
      value.sendFrom,
      value.sendTo,
      value.color,
      value.isInverse,
      value.isHollow,
      value.isBlackPaint,
      value.aura,
      value.isUseFaceIcon,
      value.characterIdentifier,
      value.standIdentifier,
      value.standName,
      value.isUseStandImage,
      value.imageFx,
      value.attachedImageIdentifiers
    );
    this.filterText = '';
  }

  resetPletteSelect() {
    if (!this.chatPletteElementRef?.nativeElement) return;
    this.chatPletteElementRef.nativeElement.selectedIndex = -1;
  }

  toggleEditMode() {
    if (!this.character) return;
    this.isEdit = this.isEdit ? false : true;
    if (this.isEdit) {
      const existing = this.character.findChatPalette();
      this.editPalette = existing ? (existing.value + '') : '';
    } else {
      // Create-with-content if missing so the first sync is not an empty palette.
      const palette = this.character.ensureChatPalette(this.editPalette);
      palette.setPalette(this.editPalette);
    }
  }

  filter(value: string): boolean {
    if (this.filterText == null || this.filterText.trim() == '') return true;
    const nomarizeFilterText = StringUtil.toHalfWidth(this.filterText.replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    const nomarizeValue = StringUtil.toHalfWidth(value.replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    if (nomarizeValue.indexOf(nomarizeFilterText) >= 0) return true;
    if (!this.palette || !this.character) return false;
    const nomarizeEvaluateValue = StringUtil.toHalfWidth(!/[{｛]/.test(value) ? value : this.palette.evaluate(value, this.character.rootDataElement).replace(/[―ー—‐]/g, '-').replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60))).replace(/[\r\n\s]+/, ' ').toUpperCase().trim();
    return nomarizeEvaluateValue.indexOf(nomarizeFilterText) >= 0;
  }

  helpChatPallet() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 560, height: 560, geometryKey: 'palette.help' };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = this.i18n.t('palette.helpTitle');
    textView.shadowing = '💭';
    textView.text = [this.i18n.t('palette.help')];
  }
}
