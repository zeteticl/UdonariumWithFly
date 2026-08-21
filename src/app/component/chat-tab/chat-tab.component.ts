import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import { ChatMessageService } from 'service/chat-message.service';
import { ChatMessage, ChatMessageContext } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem } from '@udonarium/core/system';
import { ResettableTimeout } from '@udonarium/core/system/util/resettable-timeout';
import { setZeroTimeout } from '@udonarium/core/system/util/zero-timeout';

import { PanelService } from 'service/panel.service';
import { I18nService } from 'service/i18n.service';
import {
  TutorialLineView,
  TutorialSeg,
  buildTutorialLineView,
  isBulletLine,
  linkifyPlainText,
  tokenizeTutorialLine,
  expandPackedActionLines,
} from '@udonarium/tutorial-format';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { ModalService } from 'service/modal.service';

type ScrollPosition = { top: number, bottom: number, clientHeight: number, scrollHeight: number, };
type TutorialCardId = 'ops' | 'scene' | 'changelog';

interface TutorialBlock {
  titleSegs: TutorialSeg[];
  lines: TutorialLineView[];
}

interface TutorialHelpCard {
  id: TutorialCardId;
  title: string;
  hint: string;
  icon: string;
  blocks: TutorialBlock[];
}

const TUTORIAL_CARD_META: Record<TutorialCardId, { icon: string; hintKey: string }> = {
  ops: { icon: 'touch_app', hintKey: 'tutorial.card.ops.hint' },
  scene: { icon: 'map', hintKey: 'tutorial.card.scene.hint' },
  changelog: { icon: 'history', hintKey: 'tutorial.card.changelog.hint' },
};

const ua = window.navigator.userAgent.toLowerCase();
const isiOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1 || ua.indexOf('macintosh') > -1 && 'ontouchend' in document;

@Component({
    selector: 'chat-tab',
    templateUrl: './chat-tab.component.html',
    styleUrls: ['./chat-tab.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChatTabComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges, AfterViewChecked {
  @Input() compact: boolean = false;
  @Input() leftOnly: boolean = false;

  tutorialWelcome = '';
  tutorialWelcomeTitle = '';
  tutorialWelcomeSegs: TutorialSeg[] = [];
  tutorialCards: TutorialHelpCard[] = [];
  cardExpandLabel = '';
  cardCollapseLabel = '';
  private openTutorialCards = new Set<TutorialCardId>();

  private topTimestamp = 0;
  private botomTimestamp = 0;

  private needUpdate = true;

  @ViewChild('logContainer', { static: true }) logContainerRef: ElementRef<HTMLDivElement>;
  @ViewChild('messageContainer', { static: true }) messageContainerRef: ElementRef<HTMLDivElement>;

  private topElm: HTMLElement = null;
  private bottomElm: HTMLElement = null;
  private topElmBox: DOMRect = null;
  private bottomElmBox: DOMRect = null;

  private topIndex = 0;
  private bottomIndex = 0;

  //private minMessageHeight: number = 26;
  /** Floor for index stepping — keep ≤ real height so the virtual window over-renders. */
  private get minMessageHeight(): number {
    return this.compact ? 26 : 40;
  }

  /** Per-message height estimate for spacers / minHeight (op logs grow with wraps). */
  private estimateMessageHeight(chatMessage: ChatMessage): number {
    if (!chatMessage?.isDisplayable) return 0;
    if (!chatMessage.isOperationLog) {
      return this.compact ? 26 : 61;
    }
    // Stacked compact: title row + body lines (explicit newlines and soft wraps).
    const text = String(chatMessage.text || '');
    const parts = text.length ? text.split(/\n/) : [''];
    let bodyLines = 0;
    for (const part of parts) {
      bodyLines += Math.max(1, Math.ceil(Math.max(part.length, 1) / 36));
    }
    return 10 + 18 + bodyLines * 18;
  }

  private preScrollTop = 0;
  private scrollSpeed = 0;

  private _chatMessages: ChatMessage[] = [];
  get chatMessages(): ChatMessage[] {
    if (!this.chatTab) return [];
    if (this.needUpdate) {
      this.needUpdate = false;
      let chatMessages = this.chatTab ? this.chatTab.chatMessages : [];
      this.adjustIndex();

      this._chatMessages = chatMessages.slice(this.topIndex, this.bottomIndex + 1);
      this.topTimestamp = 0 < this._chatMessages.length ? this._chatMessages[0].timestamp : 0;
      this.botomTimestamp = 0 < this._chatMessages.length ? this._chatMessages[this._chatMessages.length - 1].timestamp : 0;
    }
    return this._chatMessages;
  }

  get minScrollHeight(): number {
    if (!this.chatTab) return 0;
    return this.chatTab.chatMessages.reduce(
      (height, chatMessage) => height + this.estimateMessageHeight(chatMessage), 0);
  }

  get topSpace(): number { return this.minScrollHeight - this.bottomSpace; }

  get bottomSpace(): number {
    if (!this.chatTab || this.chatMessages.length < 1) return 0;
    const messages = this.chatTab.chatMessages;
    let space = 0;
    for (let i = this.bottomIndex + 1; i < messages.length; i++) {
      space += this.estimateMessageHeight(messages[i]);
    }
    return space;
  }

  get isEmpty(): boolean { return this.chatTab.chatMessages.every(chatMessage => !chatMessage.isDisplayable); }

  get showSampleMessages(): boolean {
    return this.isEmpty;
  }

  private scrollEventShortTimer: ResettableTimeout = null;
  private scrollEventLongTimer: ResettableTimeout = null;
  private addMessageEventTimer: NodeJS.Timeout = null;

  private callbackOnScroll: any = () => this.onScroll();
  private callbackOnScrollToBottom: any = () => this.resetMessages();

  @Input() chatTab: ChatTab;
  @Output() onAddMessage: EventEmitter<null> = new EventEmitter();

  constructor(
    private chatMessageService: ChatMessageService,
    private ngZone: NgZone,
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private i18n: I18nService,
    private modalService: ModalService,
  ) {
    this.rebuildSampleMessages();
  }

  ngOnInit() {
    EventSystem.register(this)
      .on('LOCALE_CHANGED', () => {
        this.ngZone.run(() => {
          this.rebuildSampleMessages();
          this.changeDetector.markForCheck();
        });
      })
      .on('MESSAGE_ADDED', event => {
        let message = ObjectStore.instance.get<ChatMessage>(event.data.messageIdentifier);
        if (!message || !this.chatTab.contains(message)) return;

        if (this.topTimestamp <= message.timestamp) {
          this.changeDetector.markForCheck();
          this.needUpdate = true;
          this.onMessageInit();
        }
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${ChatMessage.aliasName}`, event => {
        let message = ObjectStore.instance.get<ChatMessage>(event.data.identifier);
        if (message
          && this.topTimestamp <= message.timestamp && message.timestamp <= this.botomTimestamp
          && this.chatTab.contains(message)) {
          this.changeDetector.markForCheck();
        }
      });
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.scrollEventShortTimer = new ResettableTimeout(() => this.lazyScrollUpdate(), 33);
      this.scrollEventLongTimer = new ResettableTimeout(() => this.lazyScrollUpdate(false), 66);
      this.onScroll();
      this.bindScrollListeners();
    });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    this.unbindScrollListeners();
    this.scrollEventShortTimer?.clear();
    this.scrollEventLongTimer?.clear();
    if (this.addMessageEventTimer) clearTimeout(this.addMessageEventTimer);
    this.addMessageEventTimer = null;
  }

  private scrollListenersBound = false;
  private scrollBindRetries = 0;

  private bindScrollListeners() {
    const panel = this.panelService.scrollablePanel;
    if (panel && !this.scrollListenersBound) {
      panel.addEventListener('scroll', this.callbackOnScroll, false);
      panel.addEventListener('scrolltobottom', this.callbackOnScrollToBottom, false);
      this.scrollListenersBound = true;
      return;
    }
    if (!panel && this.scrollBindRetries < 10) {
      this.scrollBindRetries++;
      queueMicrotask(() => this.bindScrollListeners());
    }
  }

  private unbindScrollListeners() {
    const panel = this.panelService.scrollablePanel;
    if (!panel || !this.scrollListenersBound) return;
    panel.removeEventListener('scroll', this.callbackOnScroll, false);
    panel.removeEventListener('scrolltobottom', this.callbackOnScrollToBottom, false);
    this.scrollListenersBound = false;
  }

  ngOnChanges() {
    Promise.resolve().then(() => this.resetMessages());
  }

  ngAfterViewChecked() {
    if (!this.topElm || !this.bottomElm) return;
    this.ngZone.runOutsideAngular(() => {
      Promise.resolve().then(() => this.adjustScrollPosition());
    });
  }

  onMessageInit() {
    if (this.addMessageEventTimer != null) return;
    this.ngZone.runOutsideAngular(() => {
      this.addMessageEventTimer = setTimeout(() => {
        this.addMessageEventTimer = null;
        this.ngZone.run(() => this.onAddMessage.emit());
      }, 0);
    });
  }

  resetMessages() {
    let lastIndex = this.chatTab.chatMessages.length - 1;
    const panelHeight = this.panelService.scrollablePanel?.clientHeight ?? 300;
    this.topIndex = lastIndex - Math.floor(panelHeight / this.minMessageHeight);
    this.bottomIndex = lastIndex;
    this.needUpdate = true;
    this.preScrollTop = -1;
    this.scrollSpeed = 0;
    this.topElm = this.bottomElm = null;
    this.adjustIndex();
    this.changeDetector.markForCheck();
  }

  trackByChatMessage(index: number, message: ChatMessage) {
    return message.identifier;
  }

  checkAnimated(message: ChatMessage): boolean {
    //console.log(this.chatMessageService.getTime())
    return !(message.timestamp + 1000 >= this.chatMessageService.getTime());
  }

  private adjustIndex() {
    let chatMessages = this.chatTab ? this.chatTab.chatMessages : [];
    let lastIndex = 0 < chatMessages.length ? chatMessages.length - 1 : 0;

    if (this.topIndex < 0) {
      this.topIndex = 0;
    }
    if (lastIndex < this.bottomIndex) {
      this.bottomIndex = lastIndex;
    }

    if (this.topIndex < 0) this.topIndex = 0;
    if (this.bottomIndex < 0) this.bottomIndex = 0;
    if (lastIndex < this.topIndex) this.topIndex = lastIndex;
    if (lastIndex < this.bottomIndex) this.bottomIndex = lastIndex;
  }

  private getScrollPosition(): ScrollPosition {
    const panel = this.panelService.scrollablePanel;
    if (!panel) return { top: 0, bottom: 0, clientHeight: 0, scrollHeight: 0 };
    let top = panel.scrollTop;
    let clientHeight = panel.clientHeight;
    let scrollHeight = panel.scrollHeight;
    if (top < 0) top = 0;
    if (scrollHeight - clientHeight < top)
      top = scrollHeight - clientHeight;
    let bottom = top + clientHeight;
    return { top, bottom, clientHeight, scrollHeight };
  }

  private adjustScrollPosition() {
    if (!this.topElm || !this.bottomElm) return;

    let hasTopElm = this.logContainerRef.nativeElement.contains(this.topElm);
    let hasBotomElm = this.logContainerRef.nativeElement.contains(this.bottomElm);

    let { hasTopBlank, hasBotomBlank } = this.checkBlank(hasTopElm, hasBotomElm);

    this.topElm = this.bottomElm = null;

    if (hasTopBlank || hasBotomBlank || (!hasTopElm && !hasBotomElm)) {
      setZeroTimeout(() => this.lazyScrollUpdate());
    }
  }

  private checkBlank(hasTopElm: boolean, hasBotomElm: boolean) {
    let hasTopBlank = !hasTopElm;
    let hasBotomBlank = !hasBotomElm;

    if (!hasTopElm && !hasBotomElm) return { hasTopBlank, hasBotomBlank };

    let elm: HTMLElement = null;
    let prevBox: DOMRect = null;
    let currentBox: DOMRect = null;
    let diff: number = 0;
    if (hasBotomElm) {
      elm = this.bottomElm;
      prevBox = this.bottomElmBox;
    } else if (hasTopElm) {
      elm = this.topElm;
      prevBox = this.topElmBox;
    }
    currentBox = elm.getBoundingClientRect();
    diff = prevBox.top - currentBox.top - this.scrollSpeed;
    if ((!hasTopBlank || !hasBotomBlank) && 0.5 ** 2 < diff ** 2) {
      const panel = this.panelService.scrollablePanel;
      if (panel) panel.scrollTop -= diff;
    }

    let logBox: DOMRect = this.logContainerRef.nativeElement.getBoundingClientRect();
    let messageBox: DOMRect = this.messageContainerRef.nativeElement.getBoundingClientRect();

    let messageBoxTop = messageBox.top - logBox.top;
    let messageBoxBottom = messageBoxTop + messageBox.height;

    let scrollPosition = this.getScrollPosition();

    hasTopBlank = scrollPosition.top < messageBoxTop;
    hasBotomBlank = messageBoxBottom < scrollPosition.bottom && scrollPosition.bottom < scrollPosition.scrollHeight;

    return { hasTopBlank, hasBotomBlank };
  }

  private markForReadIfNeeded() {
    if (!this.chatTab.hasUnread) return;

    let scrollPosition = this.getScrollPosition();
    if (scrollPosition.scrollHeight <= scrollPosition.bottom + 100) {
      setZeroTimeout(() => {
        this.chatTab.markForRead();
        this.changeDetector.markForCheck();
        this.ngZone.run(() => { });
      });
    }
  }

  onScroll() {
    this.scrollEventShortTimer.reset();
    if (!this.scrollEventLongTimer.isActive) {
      this.scrollEventLongTimer.reset();
    }
  }

  private lazyScrollUpdate(isNormalUpdate: boolean = true) {
    this.scrollEventShortTimer.stop();
    this.scrollEventLongTimer.stop();

    let chatMessageElements = this.messageContainerRef.nativeElement.querySelectorAll<HTMLElement>('chat-message');

    let messageBoxTop = this.messageContainerRef.nativeElement.offsetTop;
    let messageBoxBottom = messageBoxTop + this.messageContainerRef.nativeElement.clientHeight;

    let preTopIndex = this.topIndex;
    let preBottomIndex = this.bottomIndex;

    let scrollPosition = this.getScrollPosition();
    this.scrollSpeed = scrollPosition.top - this.preScrollTop;
    this.preScrollTop = scrollPosition.top;

    let hasTopBlank = scrollPosition.top < messageBoxTop;
    let hasBotomBlank = messageBoxBottom < scrollPosition.bottom && scrollPosition.bottom < scrollPosition.scrollHeight;

    if (!isNormalUpdate) {
      this.scrollEventShortTimer.reset();
    }

    if (!isNormalUpdate && !hasTopBlank && !hasBotomBlank) {
      return;
    }

    let scrollWideTop = scrollPosition.top - (!isNormalUpdate && hasTopBlank ? 100 : 1200);
    let scrollWideBottom = scrollPosition.bottom + (!isNormalUpdate && hasBotomBlank ? 100 : 1200);

    this.markForReadIfNeeded();
    this.calcItemIndexRange(messageBoxTop, messageBoxBottom, scrollWideTop, scrollWideBottom, scrollPosition, chatMessageElements);

    let isChangedIndex = this.topIndex != preTopIndex || this.bottomIndex != preBottomIndex;
    if (!isChangedIndex) return;

    this.needUpdate = true;

    this.topElm = chatMessageElements[0];
    this.bottomElm = chatMessageElements[chatMessageElements.length - 1];
    this.topElmBox = this.topElm.getBoundingClientRect();
    this.bottomElmBox = this.bottomElm.getBoundingClientRect();

    setZeroTimeout(() => {
      let scrollPosition = this.getScrollPosition();
      this.scrollSpeed = scrollPosition.top - this.preScrollTop;
      this.preScrollTop = scrollPosition.top;
      this.changeDetector.markForCheck();
      this.ngZone.run(() => { });
    });
  }

  private calcElementMaxHeight(chatMessageElements: NodeListOf<HTMLElement>): number {
    let maxHeight = this.minMessageHeight;
    for (let i = chatMessageElements.length - 1; 0 <= i; i--) {
      let height = chatMessageElements[i].clientHeight;
      if (maxHeight < height) maxHeight = height;
    }
    return maxHeight;
  }

  private calcItemIndexRange(messageBoxTop: number, messageBoxBottom: number, scrollWideTop: number, scrollWideBottom: number, scrollPosition: ScrollPosition, chatMessageElements: NodeListOf<HTMLElement>) {
    if (scrollWideTop >= messageBoxBottom || messageBoxTop >= scrollWideBottom) {
      let lastIndex = this.chatTab.chatMessages.length - 1;
      let scrollBottomHeight = scrollPosition.scrollHeight - scrollPosition.top - scrollPosition.clientHeight;

      this.bottomIndex = lastIndex - Math.floor(scrollBottomHeight / this.minMessageHeight);
      this.topIndex = this.bottomIndex - Math.floor(scrollPosition.clientHeight / this.minMessageHeight);

      this.bottomIndex += 1;
      this.topIndex -= 1;
    } else {
      let maxHeight = this.calcElementMaxHeight(chatMessageElements);
      if (scrollWideTop < messageBoxTop) {
        this.topIndex -= Math.floor((messageBoxTop - scrollWideTop) / maxHeight) + 1;
      } else if (scrollWideTop > messageBoxTop) {
        if (!isiOS) this.topIndex += Math.floor((scrollWideTop - messageBoxTop) / maxHeight);
      }

      if (messageBoxBottom > scrollWideBottom) {
        if (!isiOS) this.bottomIndex -= Math.floor((messageBoxBottom - scrollWideBottom) / maxHeight);
      } else if (messageBoxBottom < scrollWideBottom) {
        this.bottomIndex += Math.floor((scrollWideBottom - messageBoxBottom) / maxHeight) + 1;
      }
    }
    this.adjustIndex();
  }

  private rebuildSampleMessages() {
    const t = (key: string) => this.i18n.t(key);
    this.tutorialWelcome = t('tutorial.welcome');
    this.tutorialWelcomeTitle = t('tutorial.name');
    this.tutorialWelcomeSegs = linkifyPlainText(this.tutorialWelcome);
    this.cardExpandLabel = t('tutorial.card.expand');
    this.cardCollapseLabel = t('tutorial.card.collapse');
    this.tutorialCards = [
      this.buildTutorialCard('ops', [
        t('tutorial.view'),
        t('tutorial.keyboard'),
        t('tutorial.chat'),
      ]),
      this.buildTutorialCard('scene', [t('tutorial.scene')]),
      this.buildTutorialCard('changelog', [
        t('changelog.v1132'),
        t('changelog.v1133b'),
        t('changelog.vF'),
        t('changelog.2026base'),
        t('changelog.2026ops'),
        t('changelog.2026scene'),
        t('changelog.2026fx'),
        t('changelog.2026chat'),
        t('changelog.2026map'),
        t('changelog.2026audio'),
        t('changelog.2026json'),
        t('changelog.2026note'),
        t('changelog.2026ux'),
        t('changelog.2026sync'),
        t('changelog.2026menu'),
        t('changelog.2026terrain'),
        t('changelog.2026net'),
        t('changelog.links'),
      ], true),
    ];
  }

  private buildTutorialCard(id: TutorialCardId, texts: string[], changelogStyle = false): TutorialHelpCard {
    const t = (key: string) => this.i18n.t(key);
    const meta = TUTORIAL_CARD_META[id];
    const blocks: TutorialBlock[] = [];
    for (const text of texts) {
      if (changelogStyle) {
        blocks.push(...this.parseChangelogBlocks(text));
      } else {
        blocks.push(...this.parseMarkedBlocks(text));
      }
    }
    return {
      id,
      title: t(`tutorial.card.${id}`),
      hint: t(meta.hintKey),
      icon: meta.icon,
      blocks,
    };
  }

  /** Split ＜Title＞… sections into titled blocks. */
  private parseMarkedBlocks(text: string): TutorialBlock[] {
    const normalized = (text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const parts = normalized.split(/(?=＜[^＞\n]+＞|<[^>\n]+>)/);
    const blocks: TutorialBlock[] = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^[＜<]([^＞>]+)[＞>]\s*([\s\S]*)$/);
      if (match) {
        blocks.push(this.toBlock(match[1].trim(), match[2]));
      } else {
        blocks.push(this.toBlock('', trimmed));
      }
    }
    return blocks;
  }

  /** First line = title; remaining lines = body (changelog entries). */
  private parseChangelogBlocks(text: string): TutorialBlock[] {
    const normalized = (text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const nl = normalized.indexOf('\n');
    if (nl < 0) {
      return [this.toBlock(normalized, '')];
    }
    return [this.toBlock(normalized.slice(0, nl).trim(), normalized.slice(nl + 1))];
  }

  private toBlock(title: string, body: string): TutorialBlock {
    const rawLines = this.splitContentLines(body);
    return {
      titleSegs: title ? tokenizeTutorialLine(title) : [],
      lines: rawLines.map(line => buildTutorialLineView(line, isBulletLine(line))),
    };
  }

  private splitContentLines(text: string): string[] {
    return (text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(line => line.replace(/^[　\s]+/, '').trimEnd())
      .filter(line => line.length > 0)
      .flatMap(line => expandPackedActionLines(line));
  }

  isCardOpen(id: TutorialCardId): boolean {
    return this.openTutorialCards.has(id);
  }

  toggleTutorialCard(id: TutorialCardId) {
    if (this.openTutorialCards.has(id)) {
      this.openTutorialCards.delete(id);
    } else {
      this.openTutorialCards.add(id);
    }
    this.changeDetector.markForCheck();
  }

  onTutorialLinkClick(event: MouseEvent, href: string) {
    event.stopPropagation();
    if (!href || !StringUtil.validUrl(href)) {
      event.preventDefault();
      return;
    }
    if (!StringUtil.sameOrigin(href)) {
      event.preventDefault();
      this.modalService.open(OpenUrlComponent, { url: href });
    }
  }
}
