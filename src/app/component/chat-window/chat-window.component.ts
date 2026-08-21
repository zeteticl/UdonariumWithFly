import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { AudioPlayer } from '@udonarium/core/file-storage/audio-player';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatLogOutputComponent } from 'component/chat-log-output/chat-log-output.component';
import { ChatTabSettingComponent } from 'component/chat-tab-setting/chat-tab-setting.component';
import { ChatTabComponent } from 'component/chat-tab/chat-tab.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { setSkipEmptyDialogQuotes } from '@udonarium/chat-balloon';

import * as localForage from 'localforage';

@Component({
    selector: 'chat-window',
    templateUrl: './chat-window.component.html',
    styleUrls: ['./chat-window.component.css'],
    standalone: false
})
export class ChatWindowComponent implements OnInit, OnDestroy, AfterViewInit {
  static activeChatTabIdentifier: string = '';
  /** Applied on next chat window open (palette tab double-click). */
  static pendingTabIdentifier: string = '';
  @ViewChild('chatTabComponemt', { static: false }) chatTabComponemt: ChatTabComponent;
  sendFrom: string = 'Guest';
  
  static readonly CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY = 'udonanaumu-chat-is-notice-on-local-storage';
  static readonly CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY = 'udonanaumu-chat-left-only-local-storage';
  static readonly CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY = 'udonanaumu-chat-auto-popup-local-storage';
  static readonly CHAT_SKIP_EMPTY_QUOTES_LOCAL_STORAGE_KEY = 'udonanaumu-chat-skip-empty-quotes-local-storage';
  /** Designed defaults: 700×530, bottom-left beside the main menu (not fixed 100,450). */
  static readonly DEFAULT_WIDTH = 700;
  static readonly DEFAULT_HEIGHT = 530;
  /** Fallback when viewport/menu not available yet (≈ menu width 100 + gap). */
  static readonly DEFAULT_LEFT = 108;
  /** Fallback only; prefer computeDefaultTop(). */
  static readonly DEFAULT_TOP = 450;
  static savedWidth = ChatWindowComponent.DEFAULT_WIDTH;
  static savedHeight = ChatWindowComponent.DEFAULT_HEIGHT;
  static savedLeft = ChatWindowComponent.DEFAULT_LEFT;
  static savedTop = ChatWindowComponent.DEFAULT_TOP;
  static geometryReady: Promise<void> = Promise.resolve();

  /** Default left: clear of desktop main menu (same inset as rearrange). */
  static computeDefaultLeft(): number {
    if (typeof window === 'undefined') return ChatWindowComponent.DEFAULT_LEFT;
    return PanelService.getDesktopMenuInsets(8, 8).left;
  }

  /** Default top: bottom-aligned within safe insets. */
  static computeDefaultTop(height: number = ChatWindowComponent.DEFAULT_HEIGHT): number {
    if (typeof window === 'undefined') return ChatWindowComponent.DEFAULT_TOP;
    const insets = PanelService.getDesktopMenuInsets(8, 8);
    return Math.max(insets.top, window.innerHeight - insets.bottom - height);
  }

  static applySavedGeometry(option: PanelOption): PanelOption {
    option.tourPanelId = option.tourPanelId || 'menu.chat';
    PanelService.applySavedGeometry(option, { includePosition: true });
    // Always fall back to chat defaults (never leave width/height unset for open()).
    option.width = option.width ?? ChatWindowComponent.DEFAULT_WIDTH;
    option.height = option.height ?? ChatWindowComponent.DEFAULT_HEIGHT;
    option.left = option.left ?? ChatWindowComponent.computeDefaultLeft();
    option.top = option.top ?? ChatWindowComponent.computeDefaultTop(option.height);
    ChatWindowComponent.savedWidth = option.width;
    ChatWindowComponent.savedHeight = option.height;
    ChatWindowComponent.savedLeft = option.left;
    ChatWindowComponent.savedTop = option.top;
    return option;
  }

  static saveGeometry(width: number, height: number, left?: number, top?: number) {
    PanelService.saveGeometry('menu.chat', width, height, left, top);
    const g = PanelService.getGeometry('menu.chat');
    if (g) {
      ChatWindowComponent.savedWidth = g.width;
      ChatWindowComponent.savedHeight = g.height;
      if (typeof g.left === 'number') ChatWindowComponent.savedLeft = g.left;
      if (typeof g.top === 'number') ChatWindowComponent.savedTop = g.top;
    }
  }

  static loadGeometryFromStorage(): Promise<void> {
    ChatWindowComponent.geometryReady = PanelService.geometryReady.then(() => {
      const g = PanelService.getGeometry('menu.chat');
      if (g) {
        ChatWindowComponent.savedWidth = g.width;
        ChatWindowComponent.savedHeight = g.height;
        if (typeof g.left === 'number') ChatWindowComponent.savedLeft = g.left;
        if (typeof g.top === 'number') ChatWindowComponent.savedTop = g.top;
      }
    });
    return ChatWindowComponent.geometryReady;
  }

  /** Reset in-memory chat geometry to defaults (after PanelService.clearSavedGeometry). */
  static resetSavedGeometryToDefaults() {
    ChatWindowComponent.savedWidth = ChatWindowComponent.DEFAULT_WIDTH;
    ChatWindowComponent.savedHeight = ChatWindowComponent.DEFAULT_HEIGHT;
    ChatWindowComponent.savedLeft = ChatWindowComponent.computeDefaultLeft();
    ChatWindowComponent.savedTop = ChatWindowComponent.computeDefaultTop(ChatWindowComponent.DEFAULT_HEIGHT);
  }

  /** Default ON: play notice when someone chats. Synced with AudioPlayer.isNoticeMute. */
  static isNoticeOn = true;
  static setChatNotice(isNoticeOn: boolean) {
    const on = !!isNoticeOn;
    localForage.setItem(ChatWindowComponent.CHAT_IS_NOTICE_ON_LOCAL_STORAGE_KEY, on).catch(e => console.log(e));
    ChatWindowComponent.isNoticeOn = on;
    AudioPlayer.isNoticeMute = !on;
    if (!on) {
      localForage.setItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(AudioPlayer.NOTICE_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
  }
  get isNoticeOn(): boolean {
    return ChatWindowComponent.isNoticeOn;
  }
  set isNoticeOn(isNoticeOn: boolean) {
    ChatWindowComponent.setChatNotice(isNoticeOn);
  }

  /** Default ON: all messages align left (local). */
  static isLeftOnly = true;
  static setChatLeftOnly(isLeftOnly: boolean) {
    localForage.setItem(ChatWindowComponent.CHAT_IS_LEFT_ONLY_LOCAL_STORAGE_KEY, !!isLeftOnly).catch(e => console.log(e));
    ChatWindowComponent.isLeftOnly = !!isLeftOnly;
  }
  get isLeftOnly(): boolean {
    return ChatWindowComponent.isLeftOnly;
  }
  set isLeftOnly(isLeftOnly: boolean) {
    ChatWindowComponent.setChatLeftOnly(isLeftOnly);
  }

  /** Default OFF: auto-open chat when someone speaks and no chat window is open. */
  static isAutoPopup = false;
  static setChatAutoPopup(isAutoPopup: boolean) {
    if (isAutoPopup) {
      localForage.setItem(ChatWindowComponent.CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(ChatWindowComponent.CHAT_AUTO_POPUP_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
    ChatWindowComponent.isAutoPopup = !!isAutoPopup;
  }
  get isAutoPopup(): boolean {
    return ChatWindowComponent.isAutoPopup;
  }
  set isAutoPopup(isAutoPopup: boolean) {
    ChatWindowComponent.setChatAutoPopup(isAutoPopup);
  }

  /** Default ON: hide empty 「」 in chat display (WWWWWW「」 → WWWWWW). */
  static skipEmptyDialogQuotes = true;
  static setSkipEmptyDialogQuotes(skip: boolean) {
    localForage.setItem(ChatWindowComponent.CHAT_SKIP_EMPTY_QUOTES_LOCAL_STORAGE_KEY, !!skip).catch(e => console.log(e));
    ChatWindowComponent.skipEmptyDialogQuotes = !!skip;
    setSkipEmptyDialogQuotes(!!skip);
  }
  get skipEmptyDialogQuotes(): boolean {
    return ChatWindowComponent.skipEmptyDialogQuotes;
  }
  set skipEmptyDialogQuotes(skip: boolean) {
    ChatWindowComponent.setSkipEmptyDialogQuotes(skip);
  }

  /** Mobile: toolbar action icons collapsed behind tune toggle (session only). */
  toolbarActionsOpen = false;

  toggleToolbarActions() {
    this.toolbarActionsOpen = !this.toolbarActionsOpen;
    queueMicrotask(() => {
      this.pinComposerToPanel();
      if (this.isAutoScroll) this.scrollToBottom(true);
    });
  }

  /** Default ON = normal chat bubbles. OFF = compact list. */
  private _isCompact = false;
  get isCompact(): boolean {
    return this._isCompact;
  }
  set isCompact(isCompact: boolean) {
    this._isCompact = isCompact;
    this.chatTabComponemt?.onScroll();
  }
  get isCompactOff(): boolean {
    return !this._isCompact;
  }
  toggleCompact() {
    this.isCompact = !this._isCompact;
  }

  /** Default ON = full toolbar. OFF = clarify (精簡). */
  public static ClarifyMode: boolean = false;
  ClarifyModeActive(): boolean {
    return ChatWindowComponent.ClarifyMode;
  }
  get isClarifyOff(): boolean {
    return !ChatWindowComponent.ClarifyMode;
  }
  toggleClarifyMode() {
    ChatWindowComponent.ClarifyMode = !ChatWindowComponent.ClarifyMode;
  }

  /** Default ON = BGM/ambient audible. OFF = mute music channels. */
  get isMusicOn(): boolean {
    return !AudioPlayer.isMute;
  }

  toggleMusic() {
    const muted = !AudioPlayer.isMute;
    this.setMute(AudioPlayer.MAIN_IS_MUTE_LOCAL_STORAGE_KEY, 'isMute', muted);
    // Ambient jukebox tracks count as "music" for the chat toolbar.
    AudioPlayer.isAmbientMute = muted;
    if (muted) {
      localForage.setItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(AudioPlayer.AMBIENT_IS_MUTE_LOCAL_STORAGE_KEY).catch(e => console.log(e));
    }
  }

  /** Default ON = SE audible. OFF = mute sound effects (token move, dice, cards, …). */
  get isSoundEffectOn(): boolean {
    return !AudioPlayer.isSoundEffectMute;
  }

  toggleSoundEffect() {
    this.setMute(AudioPlayer.SOUND_EFFECT_IS_MUTE_LOCAL_STORAGE_KEY, 'isSoundEffectMute', !AudioPlayer.isSoundEffectMute);
  }

  private setMute(
    storageKey: string,
    prop: 'isMute' | 'isSoundEffectMute',
    muted: boolean,
  ) {
    AudioPlayer[prop] = muted;
    if (muted) {
      localForage.setItem(storageKey, true).catch(e => console.log(e));
    } else {
      localForage.removeItem(storageKey).catch(e => console.log(e));
    }
    EventSystem.trigger('CHANGE_JUKEBOX_VOLUME', null);
  }

  get gameType(): string { return !this.chatMessageService.gameType ? 'DiceBot' : this.chatMessageService.gameType; }
  set gameType(gameType: string) { this.chatMessageService.gameType = gameType; }

  private _chatTabidentifier: string = '';
  get chatTabs(): ChatTab[] {
    return this.chatMessageService.chatTabs.filter(tab => tab.canView());
  }

  get chatTabidentifier(): string { return this._chatTabidentifier; }
  set chatTabidentifier(chatTabidentifier: string) {
    let hasChanged: boolean = this._chatTabidentifier !== chatTabidentifier;
    this._chatTabidentifier = chatTabidentifier;
    ChatWindowComponent.activeChatTabIdentifier = chatTabidentifier || '';
    this.updatePanelTitle();
    if (hasChanged) {
      this.scheduleScrollToBottom(true);
    }
  }

  get chatTab(): ChatTab { return ObjectStore.instance.get<ChatTab>(this.chatTabidentifier); }
  isAutoScroll: boolean = true;
  scrollToBottomTimer: NodeJS.Timeout | null = null;

  constructor(
    public chatMessageService: ChatMessageService,
    private i18n: I18nService,
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
    private changeDetector: ChangeDetectorRef,
    private elementRef: ElementRef<HTMLElement>,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    const preferred = GameCharacter.preferredChatCharacter();
    this.sendFrom = preferred?.identifier || PeerCursor.myCursor?.identifier || '';
    const pending = ChatWindowComponent.pendingTabIdentifier;
    ChatWindowComponent.pendingTabIdentifier = '';
    if (pending && this.chatTabs.some(t => t.identifier === pending)) {
      this._chatTabidentifier = pending;
    } else {
      this._chatTabidentifier = 0 < this.chatTabs.length ? this.chatTabs[0].identifier : '';
    }
    ChatWindowComponent.activeChatTabIdentifier = this._chatTabidentifier;

    EventSystem.register(this)
      .on('MESSAGE_ADDED', event => {
        if (event.data.tabIdentifier !== this.chatTabidentifier) return;
        // Always follow new messages on the active tab (mobile + desktop).
        this.isAutoScroll = true;
        if (this.chatTab) this.chatTab.markForRead();
        this.scrollToBottom(true);
        // Virtual list needs a second pass after DOM height updates.
        setTimeout(() => this.scrollToBottom(true), 50);
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.chatTabidentifier === event.data.identifier || !this.chatTab) {
          this.selectMainChatTab();
        }
      })
      .on('UPDATE_GAME_OBJECT', event => {
        // After room sync / ZIP load replaces ChatTabList, reselect main if current tab is gone.
        if (!this.chatTab || !this.chatTab.canView()) this.selectMainChatTab();
      })
      .on('CHANGE_JUKEBOX_VOLUME', event => {
        this.changeDetector.markForCheck();
      })
      .on('LOCALE_CHANGED', () => {
        this.updatePanelTitle();
        this.changeDetector.markForCheck();
      })
      .on('SELECT_CHAT_TAB', event => {
        const id = event.data?.tabIdentifier as string | undefined;
        if (!id || !this.chatTabs.some(t => t.identifier === id)) return;
        this.chatTabidentifier = id;
        this.changeDetector.markForCheck();
      });
    Promise.resolve().then(() => this.updatePanelTitle());
  }

  ngAfterViewInit() {
    this.bindScrollTracking();
    this.bindPanelResizePin();
    this.scheduleScrollToBottom(true);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.unbindScrollTracking();
    this.unbindPanelResizePin();
    if (this.openScrollRetryTimers.length) {
      this.openScrollRetryTimers.forEach(t => clearTimeout(t));
      this.openScrollRetryTimers = [];
    }
    EventSystem.trigger('CHAT_PANEL_CHANGED', null);
  }

  private scrollTrackBound = false;
  private onPanelScroll = () => this.checkAutoScroll();
  private openScrollRetryTimers: ReturnType<typeof setTimeout>[] = [];
  private panelResizeObserver: ResizeObserver | null = null;

  private bindScrollTracking() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || this.scrollTrackBound) return;
    panel.addEventListener('scroll', this.onPanelScroll, { passive: true });
    this.scrollTrackBound = true;
  }

  private unbindScrollTracking() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || !this.scrollTrackBound) return;
    panel.removeEventListener('scroll', this.onPanelScroll);
    this.scrollTrackBound = false;
  }

  private bindPanelResizePin() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || typeof ResizeObserver === 'undefined' || this.panelResizeObserver) return;
    this.panelResizeObserver = new ResizeObserver(() => {
      this.pinComposerToPanel();
      if (this.isAutoScroll) this.scrollToBottom(true);
    });
    this.panelResizeObserver.observe(panel);
  }

  private unbindPanelResizePin() {
    this.panelResizeObserver?.disconnect();
    this.panelResizeObserver = null;
  }

  /**
   * Match host min-height to the sheet scrollport so short logs still pin the composer
   * to the bottom on open / tab switch / snap resize (CSS % height is unreliable early).
   * Mobile only — never stretch desktop panels.
   */
  private pinComposerToPanel() {
    const panel = this.panelService.scrollablePanel;
    const host = this.elementRef?.nativeElement;
    if (!panel || !host) return;
    if (!document.documentElement.classList.contains('udon-mobile-layout')) {
      host.style.minHeight = '';
      return;
    }
    const h = Math.round(panel.clientHeight);
    if (h <= 0) return;
    host.style.minHeight = `${h}px`;
  }

  /** Avoid browser scrolling the focused tab control into mid-sheet (composer leaves bottom). */
  preventTabFocusScroll(event: Event) {
    event.preventDefault();
  }

  /** Open / tab change / new message — retry until virtual list paints. */
  scheduleScrollToBottom(force: boolean = true) {
    if (this.openScrollRetryTimers.length) {
      this.openScrollRetryTimers.forEach(t => clearTimeout(t));
      this.openScrollRetryTimers = [];
    }
    this.pinComposerToPanel();
    this.scrollToBottom(force);
    queueMicrotask(() => this.scrollToBottom(force));
    // Include post flyInOut (~100ms) and virtual-list settle.
    for (const delay of [50, 120, 200, 350, 550]) {
      const t = setTimeout(() => this.scrollToBottom(force), delay);
      this.openScrollRetryTimers.push(t);
    }
  }

  // @TODO 做法應再斟酌
  scrollToBottom(isForce: boolean = false) {
    if (isForce) this.isAutoScroll = true;
    if (!this.isAutoScroll) return;
    const panel = this.panelService.scrollablePanel;
    if (!panel) return;
    this.pinComposerToPanel();
    let event = new CustomEvent('scrolltobottom', {});
    panel.dispatchEvent(event);
    if (this.scrollToBottomTimer != null) return;
    this.scrollToBottomTimer = setTimeout(() => {
      if (this.chatTab) this.chatTab.markForRead();
      this.scrollToBottomTimer = null;
      const el = this.panelService.scrollablePanel;
      if (!el) return;
      this.pinComposerToPanel();
      // Hold follow through layout settle; checkAutoScroll only after final scroll.
      this.isAutoScroll = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => {
        if (!this.panelService.scrollablePanel) return;
        this.pinComposerToPanel();
        this.isAutoScroll = true;
        this.panelService.scrollablePanel.scrollTop = this.panelService.scrollablePanel.scrollHeight;
        this.checkAutoScroll();
      });
    }, 0);
  }

  // @TODO
  checkAutoScroll() {
    if (!this.panelService.scrollablePanel) return;
    let top = this.panelService.scrollablePanel.scrollHeight - this.panelService.scrollablePanel.clientHeight;
    if (top - 150 <= this.panelService.scrollablePanel.scrollTop) {
      this.isAutoScroll = true;
    } else {
      this.isAutoScroll = false;
    }
  }

  /** Local display label — does not write SyncVar. */
  tabLabel(tab: ChatTab): string {
    if (!tab || tab.name === '') return this.i18n.t('chat.unnamedTab');
    return ChatTabList.localizedName(tab);
  }

  updatePanelTitle() {
    if (this.chatTab && this.chatTab.name !== '') {
      this.panelService.title = this.i18n.t('chat.titleWithTab', { tabName: ChatTabList.localizedName(this.chatTab) });
    } else {
      this.panelService.title = this.i18n.t('chat.title');
    }
  }

  /** Jump to the first visible chat tab when the current selection is gone. */
  private selectMainChatTab() {
    const tabs = this.chatTabs;
    const nextId = tabs.length > 0 ? tabs[0].identifier : '';
    if (this._chatTabidentifier === nextId) {
      this.updatePanelTitle();
      return;
    }
    this.chatTabidentifier = nextId;
  }

  onSelectedTab(identifier: string) {
    this.updatePanelTitle();
  }

  showTabSetting() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 520, height: 360, geometryKey: 'chat.tabSetting' };
    let component = this.panelService.open<ChatTabSettingComponent>(ChatTabSettingComponent, option);
    component.selectedTab = this.chatTab;
  }

  showLogOutput() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 540, height: 300, geometryKey: 'chat.logOutput' };
    let component = this.panelService.open<ChatLogOutputComponent>(ChatLogOutputComponent, option);
    component.selectedTabs = this.chatTab ? [this.chatTab] : [];
    component.selectTabsApplay();
  }

  sendChat(value: { text: string, gameType: string, sendFrom: string, sendTo: string,
    color?: string, isInverse?:boolean, isHollow?: boolean, isBlackPaint?: boolean, imageFx?: string, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName?: string, isUseStandImage?: boolean, attachedImageIdentifiers?: string[] }) {
    if (this.chatTab) {
      this.chatMessageService.sendMessage(
        this.chatTab,
        value.text,
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
    }
  }

  trackByChatTab(index: number, chatTab: ChatTab) {
    return chatTab.identifier;
  }

  privateTabMemberNames(tab: ChatTab): string[] {
    if (!tab?.isPrivate) return [];
    const ids = new Set(tab.memberIds);
    if (tab.creatorUserId) ids.add(tab.creatorUserId);
    const names: string[] = [];
    for (const id of ids) {
      const peer = PeerCursor.findByUserId(id);
      const name = (peer?.name || '').trim();
      names.push(name || id);
    }
    return names;
  }
}
