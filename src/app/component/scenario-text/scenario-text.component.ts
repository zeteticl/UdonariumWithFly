import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';

import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { popupCharacterChatBalloon } from '@udonarium/chat-balloon';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ScenarioText, SCENARIO_TEXT_MAX_BYTES } from '@udonarium/scenario-text';
import { ScenarioTextList } from '@udonarium/scenario-text-list';
import { ChatWindowComponent } from 'component/chat-window/chat-window.component';
import { ChatMessageService } from 'service/chat-message.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { PanelService } from 'service/panel.service';

export type ScenarioSenderMode = 'title' | 'character' | 'player';

@Component({
  selector: 'app-scenario-text',
  templateUrl: './scenario-text.component.html',
  styleUrls: ['../shared/settings-ui.css', './scenario-text.component.css'],
  standalone: false
})
export class ScenarioTextComponent implements OnInit, OnDestroy {
  selected: ScenarioText = null;
  readonly maxBytes = SCENARIO_TEXT_MAX_BYTES;
  readonly radioName = `scenario-sender-${Math.random().toString(36).slice(2, 8)}`;
  private lazyUpdateTimer: NodeJS.Timeout = null;
  private shouldUpdateCharacterList = true;
  private _gameCharacters: GameCharacter[] = [];
  private static persistedSenderMode: ScenarioSenderMode = 'title';
  private static persistedCharacterId = '';

  get list(): ScenarioTextList { return ScenarioTextList.instance; }
  get items(): ScenarioText[] { return this.list.items; }

  get senderMode(): ScenarioSenderMode { return ScenarioTextComponent.persistedSenderMode; }
  set senderMode(mode: ScenarioSenderMode) {
    ScenarioTextComponent.persistedSenderMode = mode;
    if (mode === 'character') this.shouldUpdateCharacterList = true;
  }

  get senderCharacterId(): string { return ScenarioTextComponent.persistedCharacterId; }
  set senderCharacterId(id: string) { ScenarioTextComponent.persistedCharacterId = id || ''; }

  get gameCharacters(): GameCharacter[] {
    if (this.shouldUpdateCharacterList) {
      this.shouldUpdateCharacterList = false;
      this._gameCharacters = ObjectStore.instance
        .getObjects<GameCharacter>(GameCharacter)
        .filter(character => !character.isTemporaryCopy && this.allowsChat(character));
      this.ensureCharacterSelection();
    }
    return this._gameCharacters;
  }

  constructor(
    private panelService: PanelService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService,
    private ngZone: NgZone,
    private i18n: I18nService
  ) { }

  GuestMode() { return Network.GuestMode(); }

  ngOnInit() {
    Promise.resolve().then(() => {
      this.modalService.title = this.panelService.title = this.i18n.t('scenarioText.title');
    });
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', () => this.lazyUpdate())
      .on('DELETE_GAME_OBJECT', () => this.lazyUpdate())
      .on('LOCALE_CHANGED', () => {
        this.modalService.title = this.panelService.title = this.i18n.t('scenarioText.title');
      });
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  create() {
    if (this.GuestMode()) return;
    this.selected = this.list.addItem();
  }

  select(item: ScenarioText) { this.selected = item; }

  remove(item: ScenarioText) {
    if (this.GuestMode() || !item) return;
    if (this.selected === item) this.selected = null;
    item.destroy();
  }

  send(item: ScenarioText) {
    if (this.GuestMode() || !item) return;
    this.postToActiveTab(item, item.body);
  }

  sendSelection(textarea: HTMLTextAreaElement) {
    if (this.GuestMode() || !this.selected || !textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const picked = (textarea.value || '').substring(start, end);
    this.postToActiveTab(this.selected, picked);
  }

  characterOptionLabel(character: GameCharacter): string {
    return (character?.name || '').trim() || this.i18n.t('chat.unnamedCharacter');
  }

  private postToActiveTab(item: ScenarioText, text: string) {
    if (!item || !(text || '').trim()) return;
    const tab = this.resolveTab();
    if (!tab) return;
    const body = StringUtil.cr(text);

    if (this.senderMode === 'title') {
      const title = (item.title || '').trim() || this.i18n.t('scenarioText.untitled');
      tab.addMessage({
        from: Network.peer.userId,
        name: title,
        imageIdentifier: PeerCursor.myCursor?.imageIdentifier || '',
        timestamp: Date.now(),
        tag: '',
        text: body,
        color: PeerCursor.myCursor?.color || '',
      });
      return;
    }

    if (this.senderMode === 'character') {
      const character = this.resolveSelectedCharacter();
      if (character) {
        const color = character.chatPalette?.color;
        this.chatMessageService.sendMessage(tab, body, '', character.identifier, null, color);
        if (tab.isUseStandImage) {
          popupCharacterChatBalloon(character, body, {
            color,
            faceIconIdentifier: character.faceIcon?.identifier || '',
          });
        }
        return;
      }
    }

    const peer = PeerCursor.myCursor;
    if (!peer) return;
    this.chatMessageService.sendMessage(tab, body, '', peer.identifier, null, peer.color);
  }

  private resolveSelectedCharacter(): GameCharacter {
    this.shouldUpdateCharacterList = true;
    const chars = this.gameCharacters;
    if (!chars.length) return null;
    const selected = ObjectStore.instance.get(this.senderCharacterId);
    if (selected instanceof GameCharacter && chars.some(c => c.identifier === selected.identifier)) {
      return selected;
    }
    return chars[0];
  }

  private ensureCharacterSelection() {
    const chars = this._gameCharacters;
    if (!chars.length) {
      this.senderCharacterId = '';
      return;
    }
    if (chars.some(c => c.identifier === this.senderCharacterId)) return;
    const preferred = GameCharacter.preferredChatCharacter();
    if (preferred && chars.some(c => c.identifier === preferred.identifier)) {
      this.senderCharacterId = preferred.identifier;
      return;
    }
    this.senderCharacterId = chars[0].identifier;
  }

  private allowsChat(gameCharacter: GameCharacter): boolean {
    if (!gameCharacter?.isAllowsChat) return false;
    const peerId = PeerCursor.myCursor?.peerId;
    switch (gameCharacter.location.name) {
      case 'table':
      case peerId:
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

  private resolveTab() {
    const id = ChatWindowComponent.activeChatTabIdentifier;
    if (id) {
      const tab = ObjectStore.instance.get(id);
      if (tab) return tab as any;
    }
    return this.chatMessageService.chatTabs[0];
  }

  private lazyUpdate() {
    if (this.lazyUpdateTimer) return;
    this.lazyUpdateTimer = setTimeout(() => {
      this.lazyUpdateTimer = null;
      this.shouldUpdateCharacterList = true;
      this.ngZone.run(() => { /* refresh list / selection */ });
    }, 80);
  }
}
