import { Injectable } from '@angular/core';

import { ChatMessage, ChatMessageContext } from '@udonarium/chat-message';
import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { Network } from '@udonarium/core/system';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { I18nService } from './i18n.service';

const HOURS = 60 * 60 * 1000;

@Injectable()
export class ChatMessageService {
  private intervalTimer: NodeJS.Timeout = null;
  private timeOffset: number = Date.now();
  private performanceOffset: number = performance.now();

  private ntpApiUrls: string[] = [
    'https://worldtimeapi.org/api/ip',
  ];

  gameType: string = '';

  constructor(private i18n: I18nService) { }

  GuestMode() {
    return Network.GuestMode();
  }


  get chatTabs(): ChatTab[] {
    return ChatTabList.instance.chatTabs;
  }

  calibrateTimeOffset() {
    if (this.intervalTimer != null) {
      return;
    }
    let index = Math.floor(Math.random() * this.ntpApiUrls.length);
    let ntpApiUrl = this.ntpApiUrls[index];
    let sendTime = performance.now();
    fetch(ntpApiUrl)
      .then(response => {
        if (response.ok) return response.json();
        throw new Error('Network response was not ok.');
      })
      .then(jsonObj => {
        let endTime = performance.now();
        let latency = (endTime - sendTime) / 2;
        let timeobj = jsonObj;
        let st: number = new Date(timeobj.utc_datetime).getTime();
        let fixedTime = st + latency;
        this.timeOffset = fixedTime;
        this.performanceOffset = endTime;
        this.setIntervalTimer();
      })
      .catch(() => {
        // NTP is best-effort (often blocked); retry later without console noise.
        this.setIntervalTimer();
      });
    this.setIntervalTimer();
  }

  private setIntervalTimer() {
    if (this.intervalTimer != null) clearTimeout(this.intervalTimer);
    this.intervalTimer = setTimeout(() => {
      this.intervalTimer = null;
      this.calibrateTimeOffset();
    }, 6 * HOURS);
  }

  getTime(): number {
    return Math.floor(this.timeOffset + (performance.now() - this.performanceOffset));
  }

  sendMessage(chatTab: ChatTab, text: string, gameType: string, sendFrom: string, sendTo?: string, color? :string, isInverseIcon? :boolean, isHollowIcon? :boolean, isBlackPaint? :boolean, aura?: number, isUseFaceIcon?: boolean, characterIdentifier?: string, standIdentifier?: string, standName? :string, isUseStandImage?: boolean, imageFx?: string, attachedImageIdentifiers?: string | string[]): ChatMessage {
    // TODO: 再整理一下
    let effective = !(isUseFaceIcon && this.findFaceIconIdentifier(sendFrom));
    const attached = Array.isArray(attachedImageIdentifiers)
      ? attachedImageIdentifiers.filter(id => !!id).join(' ')
      : (attachedImageIdentifiers || '').trim();
    let chatMessage: ChatMessageContext = {
      from: Network.peer.userId,
      to: ChatMessageService.findId(sendTo),
      //to: this.findId(sendTo),
      name: this.makeSpeakerDisplayName(sendFrom),
      toName: sendTo ? this.findObjectName(sendTo) : '',
      imageIdentifier: this.findImageIdentifier(sendFrom, isUseFaceIcon),
      toImageIdentifier: sendTo ? this.findImageIdentifier(sendTo) : '',
      attachedImageIdentifiers: attached,
      timestamp: this.calcTimeStamp(chatTab),
      tag: effective ? `${gameType} noface` : gameType,
      text: StringUtil.cr(text),
      color: color,
      toColor: sendTo ? this.findObjectColor(sendTo) : '',
      isInverseIcon: effective && isInverseIcon ? 1 : 0,
      isHollowIcon: effective && isHollowIcon ? 1 : 0,
      isBlackPaint: effective && isBlackPaint ? 1 : 0,
      imageFx: effective && imageFx ? imageFx : '',
      aura: effective ? aura : -1,
      characterIdentifier: characterIdentifier,
      standIdentifier: standIdentifier,
      standName: standName,
      isUseStandImage: isUseStandImage
    };

    return chatTab.addMessage(chatMessage);
  }

  sendOperationLog(text: string, logLevel: number=1) {
    for (const chatTab of this.chatTabs) {
      if (chatTab.recieveOperationLogLevel < logLevel) continue;
      let chatMessage: ChatMessageContext = {
        from: Network.peer.userId,
        //to: ChatMessageService.findId(PeerCursor.myCursor.userId),
        //to: this.findId(sendTo),
        name: PeerCursor.myCursor.name,
        imageIdentifier: PeerCursor.myCursor.imageIdentifier,
        timestamp: this.calcTimeStamp(chatTab),
        tag: 'opelog',
        //text: StringUtil.cr(text),
        text: text,
        color: PeerCursor.myCursor.color
      };

      chatTab.addMessage(chatMessage);
    }
  }

  static findId(identifier: string): string {
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      return object.identifier;
    } else if (object instanceof PeerCursor) {
      return object.userId;
    }
    return null;
  }

  private findObjectName(identifier: string): string {
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      return object.name && object.name.length ? object.name : this.i18n.t('chat.unnamedCharacter');
    } else if (object instanceof PeerCursor) {
      return object.name && object.name.length ? object.name : this.i18n.t('chat.unnamedPlayer');
    }
    return identifier;
  }

  private findObjectColor(identifier: string): string {
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      return object.chatPalette?.color ?? null;
    } else if (object instanceof PeerCursor) {
      return object.color;
    }
    return null;
  }

  /** Character name with player nick, e.g. `愛麗絲 (小明)`. */
  private makeSpeakerDisplayName(sendFrom: string): string {
    let name = this.findObjectName(sendFrom);
    if (this.GuestMode()) name += this.i18n.t('chat.guestSuffix');
    const object = ObjectStore.instance.get(sendFrom);
    if (object instanceof GameCharacter) {
      const nick = PeerCursor.myCursor?.name?.trim();
      if (nick) name += ` (${nick})`;
    }
    return name;
  }

  private makeMessageName(sendFrom: string, sendTo?: string): string {
    let sendFromName = this.makeSpeakerDisplayName(sendFrom);
    if (sendTo == null || sendTo.length < 1) return sendFromName;

    let sendToName = this.findObjectName(sendTo);
    return sendFromName + ' ➡ ' + sendToName;
  }

  private findImageIdentifier(identifier: string, isUseFaceIcon: boolean = false): string {
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter) {
      if (isUseFaceIcon && object.faceIcon && 0 < object.faceIcon.url.length) return object.faceIcon.identifier;
      return object.imageFile ? object.imageFile.identifier : '';
    } else if (object instanceof PeerCursor) {
      return object.imageIdentifier;
    }
    return identifier;
  }

  private findFaceIconIdentifier(identifier: string): string {
    let object = ObjectStore.instance.get(identifier);
    if (object instanceof GameCharacter && object.faceIcon && 0 < object.faceIcon.url.length) {
      return object.faceIcon.identifier;
    }
    return '';
  }

  private calcTimeStamp(chatTab: ChatTab): number {
    let now = this.getTime();
    let latest = chatTab.latestTimeStamp;
    return now <= latest ? latest + 1 : now;
  }
}
