import { ChatMessage, ChatMessageContext } from './chat-message';
import { ImageFile } from './core/file-storage/image-file';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { InnerXml, ObjectSerializer } from './core/synchronize-object/object-serializer';
import { EventSystem, Network } from './core/system';
import { StringUtil } from './core/system/util/string-util';
import { PeerCursor } from './peer-cursor';
import { translate } from 'i18n';

@SyncObject('chat-tab')
export class ChatTab extends ObjectNode implements InnerXml {
  @SyncVar() name: string = translate('chatTab.defaultName');
  @SyncVar() isUseStandImage: boolean = true;
  @SyncVar() recieveOperationLogLevel: number = 0;
  @SyncVar() isPrivate: boolean = false;
  @SyncVar() memberUserIds: string = '';
  @SyncVar() creatorUserId: string = '';
  get chatMessages(): ChatMessage[] { return <ChatMessage[]>this.children; }

  private _unreadLength: number = 0;
  get unreadLength(): number { return this._unreadLength; }
  get hasUnread(): boolean { return 0 < this.unreadLength; }

  get memberIds(): string[] {
    return (this.memberUserIds || '').trim().split(/\s+/).filter(id => !!id);
  }

  setMembers(userIds: string[]) {
    this.memberUserIds = Array.from(new Set(userIds.filter(id => !!id))).join(' ');
  }

  isMember(userId: string = Network.peer?.userId): boolean {
    if (!userId) return false;
    if (this.creatorUserId && this.creatorUserId === userId) return true;
    return this.memberIds.includes(userId);
  }

  canView(userId: string = Network.peer?.userId, isGM: boolean = !!PeerCursor.myCursor?.isGMMode): boolean {
    if (!this.isPrivate) return true;
    if (isGM) return true;
    return this.isMember(userId);
  }

  get latestTimeStamp(): number {
    let lastIndex = this.chatMessages.length - 1;
    return lastIndex < 0 ? 0 : this.chatMessages[lastIndex].timestamp;
  }

  // ObjectNode Lifecycle
  onChildAdded(child: ObjectNode) {
    super.onChildAdded(child);
    if (child.parent === this && child instanceof ChatMessage && child.isDisplayable) {
      this._unreadLength++;
      EventSystem.trigger('MESSAGE_ADDED', { tabIdentifier: this.identifier, messageIdentifier: child.identifier });
      if (!child.isSendFromSelf && !child.isOperationLog && !child.isSystem) {
        EventSystem.trigger('MESSAGE_NORTIFICATION', { tabIdentifier: this.identifier, messageIdentifier: child.identifier, isDirect: child.isDirect });
      }
    }
  }

  addMessage(message: ChatMessageContext): ChatMessage {
    message.tabIdentifier = this.identifier;

    let chat = new ChatMessage();
    for (let key in message) {
      if (key === 'identifier') continue;
      if (key === 'tabIdentifier') continue;
      if (key === 'text') {
        chat.value = message[key];
        continue;
      }
      if (message[key] == null || message[key] === '') continue;
      chat.setAttribute(key, message[key]);
    }
    chat.initialize();
    EventSystem.trigger('SEND_MESSAGE', { tabIdentifier: this.identifier, messageIdentifier: chat.identifier });
    this.appendChild(chat);
    return chat;
  }

  markForRead() {
    this._unreadLength = 0;
  }

  innerXml(): string {
    let xml = '';
    for (let child of this.children) {
      if (child instanceof ChatMessage && !child.isDisplayable) continue;
      xml += ObjectSerializer.instance.toXml(child);
    }
    return xml;
  };

  parseInnerXml(element: Element) {
    return super.parseInnerXml(element);
  };

  log(logFormat, dateFormat,  isWriteOerationLog=true, imageDict?: {}): string {
    const logBody = this.chatMessages
    .filter(chatMessage => chatMessage.isDisplayable && (isWriteOerationLog || !chatMessage.isOperationLog))
    .sort((a, b) => a.index - b.index)
    .map(chatMessage => chatMessage.logFragment(logFormat, null, dateFormat, imageDict))
    .join("\n");

    return logFormat == 0 
      ? logBody
      : `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<title>${ StringUtil.escapeHtml(translate('chatLog.htmlTitle', { name: this.name == '' ? translate('chat.unnamedTab') : this.name, images: imageDict ? translate('chatLog.withImages') : '' })) }</title>
<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
<script>
  if (window.chrome) {
    document.documentElement.classList.add('is-chrome');
  }
</script>
<style>
${ ChatMessage.logCss(imageDict) }
</style>
</head>
<body>
${ logBody }
</body>
</html>`
  }
}