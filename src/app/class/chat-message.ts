import { ImageFile } from './core/file-storage/image-file';
import { ImageStorage } from './core/file-storage/image-storage';
import { SyncObject, SyncVar } from './core/synchronize-object/decorator';
import { ObjectNode } from './core/synchronize-object/object-node';
import { Network } from './core/system';
import { StringUtil } from './core/system/util/string-util';
import { Autolinker } from 'autolinker';
import { PeerCursor } from './peer-cursor';
import { formatDate } from '@angular/common';
import { resolveLocale, toIntlLocale, translate } from 'i18n';

export interface ChatMessageContext {
  identifier?: string;
  tabIdentifier?: string;
  originFrom?: string;
  from?: string;
  to?: string;
  name?: string;
  toName?: string;
  text?: string;
  timestamp?: number;
  tag?: string;
  dicebot?: string;
  imageIdentifier?: string;
  toImageIdentifier?: string;
  /** Space-separated ImageStorage identifiers for images attached to the message body. */
  attachedImageIdentifiers?: string;
  color?: string;
  toColor?: string;
  isInverseIcon?: number;
  isHollowIcon?: number;
  isBlackPaint?: number;
  imageFx?: string;
  aura?: number;
  characterIdentifier?: string;
  standIdentifier?: string;
  standName?: string;
  isUseStandImage?: boolean;
}

@SyncObject('chat')
export class ChatMessage extends ObjectNode implements ChatMessageContext {
  @SyncVar() originFrom: string;
  @SyncVar() from: string;
  @SyncVar() to: string;
  @SyncVar() name: string;
  @SyncVar() toName: string = '';
  @SyncVar() tag: string = ''; 
  @SyncVar() dicebot: string;
  @SyncVar() imageIdentifier: string;
  @SyncVar() toImageIdentifier: string = '';
  @SyncVar() attachedImageIdentifiers: string = '';
  @SyncVar() color: string;
  @SyncVar() toColor: string = '';
  @SyncVar() isInverseIcon: number;
  @SyncVar() isHollowIcon: number;
  @SyncVar() isBlackPaint: number;
  @SyncVar() imageFx: string = '';
  @SyncVar() aura: number = -1;
  @SyncVar() characterIdentifier: string;
  @SyncVar() standIdentifier: string;
  @SyncVar() standName: string;
  @SyncVar() isUseStandImage: boolean;
  @SyncVar() lastUpdate: number = 0

  get tabIdentifier(): string { return this.parent.identifier; }
  get text(): string { return <string>this.value; }
  set text(text: string) { this.value = (text == null) ? '' : text; }

  get timestamp(): number {
    let timestamp = this.getAttribute('timestamp');
    let num = timestamp ? +timestamp : 0;
    return Number.isNaN(num) ? 1 : num;
  }
  private _to: string;
  private _sendTo: string[] = [];
  get sendTo(): string[] {
    // 応急処置
    if (this.to === 'undefined') {
      if (this._to !== '') {
        this._to = '';
        this._sendTo = [];
      }
      return this._sendTo;
    }
    if (this._to !== this.to) {
      this._to = this.to;
      this._sendTo = this.to != null && 0 < this.to.trim().length ? this.to.trim().split(/\s+/) : [];
    }
    return this._sendTo;
  }

  get isEdited(): boolean {
    return this.lastUpdate > 0;
  }

  private _tag: string;
  private _tags: string[] = [];
  get tags(): string[] {
    if (this._tag !== this.tag) {
      this._tag = this.tag;
      this._tags = this.tag != null && 0 < this.tag.trim().length ? this.tag.trim().split(/\s+/) : [];
    }
    return this._tags;
  }

  get image(): ImageFile { return ImageStorage.instance.get(this.imageIdentifier); }
  get toImage(): ImageFile { return ImageStorage.instance.get(this.toImageIdentifier); }

  get attachedImages(): ImageFile[] {
    if (!this.attachedImageIdentifiers || !this.attachedImageIdentifiers.trim()) return [];
    const out: ImageFile[] = [];
    for (const id of this.attachedImageIdentifiers.trim().split(/\s+/)) {
      const image = ImageStorage.instance.get(id);
      if (image) out.push(image);
    }
    return out;
  }

  get index(): number { return this.minorIndex + this.timestamp; }
  get isDirect(): boolean { return 0 < this.sendTo.length || -1 < this.tags.indexOf('direct') ? true : false; }
  get isSendFromSelf(): boolean { return this.from === Network.peer.userId || this.originFrom === Network.peer.userId || -1 < this.tags.indexOf('mine'); }
  get isSendToMe(): boolean { return (-1 < this.sendTo.indexOf(Network.peer.userId)); }
  get isRelatedToMe(): boolean { return (this.isSendToMe || this.isSendFromSelf || this.isGMMode); }
  get isDisplayable(): boolean {
    const tab: any = this.parent;
    if (tab && tab.isPrivate && typeof tab.canView === 'function' && !tab.canView()) return false;
    return this.isDirect ? this.isRelatedToMe : true;
  }
  get isSystem(): boolean { return -1 < this.tags.indexOf('system') ? true : false; }
  get isDicebot(): boolean { return this.isSystem && this.from.indexOf('Dice') >= 0 && !/^C\(.+\) →/i.test(this.text); }
  get isCalculate(): boolean { return this.isSystem && this.from.indexOf('Dice') >= 0 && /^C\(.+\) →/i.test(this.text); }
  get isSecret(): boolean { return -1 < this.tags.indexOf('secret') ? true : false; }
  get isEmptyDice(): boolean { return !this.isDicebot || -1 < this.tags.indexOf('empty'); }
  get isSpecialColor(): boolean { return this.isDirect || this.isSecret || this.isSystem || this.isOperationLog || this.isDicebot || this.isCalculate; }
  get isEditable(): boolean { return !this.isSystem && !this.isOperationLog && this.from === Network.peer.userId }
  get isFaceIcon(): boolean { return !this.isSystem && (!this.characterIdentifier || this.tags.indexOf('noface') < 0); }
  get isOperationLog(): boolean { return -1 < this.tags.indexOf('opelog') ? true : false; }

  get isSuccess(): boolean { return this.isDicebot && -1 < this.tags.indexOf('success'); }
  get isFailure(): boolean { return this.isDicebot && -1 < this.tags.indexOf('failure'); }
  get isCritical(): boolean { return this.isDicebot && -1 < this.tags.indexOf('critical'); }
  get isFumble(): boolean { return this.isDicebot && -1 < this.tags.indexOf('fumble'); }

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  // for now
  private get locale(): string {
    return toIntlLocale(resolveLocale());
  }
  
  complement(): void {
    const color = this.getAttribute('messColor');
    if (color) {
      if (/^\#[a-fA-F0-9]{6}$/.test(color)) {
        this.setAttribute('color', color);
      }
      this.removeAttribute('messColor');
    }
  };

  plainText(): string {
    if (this.isSecret && !this.isSendFromSelf) return translate('chat.secretDice');
    let text = StringUtil.rubyToText(this.text);
    if (this.isDicebot) text = text.replace(/###(.+?)###/g, '*$1').replace(/\~\~\~(.+?)\~\~\~/g, '~$1');
    return text;
  }

  logFragment(logForamt: number, tabName: string=null, dateFormat='HH:mm', imageDict?: {}): string {
    if (logForamt == 0) {
      return this.logFragmentText(tabName, dateFormat);
    } else {
      return this.logFragmentHtml(tabName, dateFormat, imageDict);
    }
  }

  logFragmentText(tabName: string=null, dateFormat='HH:mm'): string {
    tabName = (!tabName || tabName.trim() == '') ? '' : `[${ tabName }] `;
    const dateStr = (dateFormat == '') ? '' : formatDate(new Date(this.timestamp), dateFormat, this.locale) + translate('common.colon');
    const lastUpdateStr = !this.isEdited ? '' : 
      (dateFormat == '') ? translate('chat.editedParen') : translate('chat.editedParenWithTime', { time: formatDate(new Date(this.lastUpdate), dateFormat, this.locale) });
    let text = StringUtil.rubyToText(this.text);
    if (this.isDicebot) text = text.replace(/###(.+?)###/g, '*$1').replace(/\~\~\~(.+?)\~\~\~/g, '~$1');
    const attachedCount = this.attachedImages.length;
    if (attachedCount > 0 && !(this.isSecret && !this.isSendFromSelf)) {
      text += (text ? ' ' : '') + translate('chat.attachedImageCount', { count: attachedCount });
    }
    if (text.lastIndexOf('\n') == text.length - 1 && !lastUpdateStr) {
      // Adjust the last line
      text += "\n";
    }
    return `${ tabName }${ dateStr }${ this.name }${ this.toColor ? (' ➡ ' + this.toName) : '' }：${ (this.isSecret && !this.isSendFromSelf) ? translate('chat.secretDice') : text + lastUpdateStr }`
  }

  logFragmentHtml(tabName: string=null, dateFormat='HH:mm', imageDict?: {}): string {
    const isWithImage = !!imageDict;
    const color = StringUtil.escapeHtml(this.color ? this.color : PeerCursor.CHAT_DEFAULT_COLOR);
    const colorStyle = ` style="color: ${ color }"`;

    const toColor = this.toColor ? StringUtil.escapeHtml(this.toColor) : '';
    const toColorStyle = this.toColor ? ` style="color: ${ toColor }"`: '';

    const growClass = (this.isDirect || this.isSecret) ? ' class="grow"' : '';

    const tabNameHtml = (tabName == null || tabName.trim() == '') ? '' : `<span class="tab-name">${ StringUtil.escapeHtml(tabName) }</span> `;
    const date = new Date(this.timestamp);
    const dateHtml = (dateFormat == '') ? '' : `<time datetime="${ date.toISOString() }">${ StringUtil.escapeHtml(formatDate(date, dateFormat, this.locale)) }</time>`;
    const toImageTag = (isWithImage && this.toImageIdentifier && imageDict[this.toImageIdentifier]) ? `<img class="to-icon" src="${ StringUtil.escapeHtml(imageDict[this.toImageIdentifier]) }">` : ''
    const nameHtml = `<span${growClass}${colorStyle}>${StringUtil.escapeHtml(this.name)}</span>` 
      + (this.toColor ? ` ➡ ${toImageTag}<span${growClass}${toColorStyle}>${StringUtil.escapeHtml(this.toName)}</span>` : '');

    let messageClassNames = ['message'];
    if (this.isDirect || this.isSecret) messageClassNames.push('direct-message');
    if (this.isSystem) messageClassNames.push('system-message');
    if (this.isDicebot || this.isCalculate) messageClassNames.push('dicebot-message');
    if (this.isOperationLog) messageClassNames.push('operation-log');
    if (isWithImage && this.isFaceIcon) messageClassNames.push('face-icon-msessage');

    let messageTextClassNames = ['msg-text'];
    if (!this.isSecret || this.isSendFromSelf) {
      if (this.isSuccess) messageTextClassNames.push('is-success');
      if (this.isFailure) messageTextClassNames.push('is-failure');
      if (this.isCritical) messageTextClassNames.push('is-critical');
      if (this.isFumble) messageTextClassNames.push('is-fumble');
    }

    let textAutoLinkedHtml: string;
    if (this.isSecret && !this.isSendFromSelf) {
      textAutoLinkedHtml = `<s>${translate('chat.secretDice')}</s>`;
    } else {
      let tmpStr = this.isOperationLog ? StringUtil.escapeHtml(this.text) : StringUtil.rubyToHtml(StringUtil.escapeHtml(this.text));
      textAutoLinkedHtml = tmpStr.split("\n").map(line => {
        const headerMatch = line.match(/^(#+ )([\s\S]*)$/);
        let prefix = '';
        let content = '';
        if (headerMatch) {
          prefix = headerMatch[1];
          content = headerMatch[2];
        } else {
          content = line;
        }
        return prefix + Autolinker.link(content, {
          urls: {schemeMatches: true, wwwMatches: true, tldMatches: false}, 
          truncate: {length: 96, location: 'end'}, 
          decodePercentEncoding: false, 
          stripPrefix: false, 
          stripTrailingSlash: false, 
          email: false, 
          phone: false,
          className: 'outer-link',
          replaceFn : function(m) {
            return m.getType() == 'url' && StringUtil.validUrl(m.getAnchorHref());
          }
        });
      }).join("\n");
      if (this.isDicebot) textAutoLinkedHtml = ChatMessage.decorationDiceResult(textAutoLinkedHtml);
    }

    let attachedImagesHtml = '';
    if (!(this.isSecret && !this.isSendFromSelf) && this.attachedImageIdentifiers && imageDict) {
      const parts: string[] = [];
      for (const id of this.attachedImageIdentifiers.trim().split(/\s+/)) {
        const src = imageDict[id];
        if (!src) continue;
        parts.push(`<a class="msg-attached-link" href="${StringUtil.escapeHtml(src)}" target="_blank" rel="noopener noreferrer"><img class="msg-attached" src="${StringUtil.escapeHtml(src)}" alt=""></a>`);
      }
      if (parts.length) attachedImagesHtml = `<div class="msg-attached-list">${parts.join('')}</div>`;
    }

    let lastUpdateHtml = '';
    if (this.isEdited) {
      if (dateFormat == '') {
        lastUpdateHtml = `<span class="is-edited">${translate('chat.edited')}</span>`;
      } else {
        const lastUpdate = new Date(this.lastUpdate);
        lastUpdateHtml = `<span class="is-edited"><b>${translate('chat.edited')}</b> <time datetime="${ lastUpdate.toISOString() }">${ StringUtil.escapeHtml(formatDate(lastUpdate, dateFormat, this.locale)) }</time></span>`;
      }
    }
    
    if (textAutoLinkedHtml.lastIndexOf('\n') == textAutoLinkedHtml.length - 1 && !lastUpdateHtml) {
      // Adjust the last line
      textAutoLinkedHtml += "\n";
    }
    if (isWithImage) {
      const iconContainerClassList = ['msg-icon'];
      const auraClassList = ['aura'];
      if (this.isInverseIcon == 1) iconContainerClassList.push('inverse');
      if (this.isHollowIcon == 1) iconContainerClassList.push('hollow');
      if (this.imageFx) {
        for (const tag of this.imageFx.split(/\s+/)) {
          if (tag === 'flip-vertical') iconContainerClassList.push('flip-vertical');
          else if (tag === 'grayscale' || tag === 'sepia' || tag === 'matrix' || tag === 'white-paint' || tag === 'contrast') {
            // applied on img
          }
        }
      }
      if (0 <= this.aura && this.aura <= 7) {
        auraClassList.push(['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'yellow', 'white'][this.aura]);
      }
      const imgClasses = ['icon'];
      if (this.isBlackPaint == 1) imgClasses.push('black-paint');
      if (this.imageFx) {
        for (const tag of this.imageFx.split(/\s+/)) {
          if (tag === 'white-paint') imgClasses.push('white-paint');
          else if (tag === 'grayscale') imgClasses.push('grayscale');
          else if (tag === 'sepia') imgClasses.push('sepia');
          else if (tag === 'matrix') imgClasses.push('matrix');
          else if (tag === 'contrast') imgClasses.push('contrast-fx');
        }
      }
      const imageIconHtml = (this.imageIdentifier && imageDict[this.imageIdentifier]) ? `<img class="${imgClasses.join(' ')}" src="${ StringUtil.escapeHtml(imageDict[this.imageIdentifier]) }">` : '<span class="icon-space"></span>';
      return `<div class="${ messageClassNames.join(' ') }" style="border-left-color: ${ color }">
  <div class="msg-header">${ tabNameHtml }${ tabNameHtml == '' ? '' : '<br>' }${ dateHtml }</div>
  <div class="${ iconContainerClassList.join(' ') }">
    <span class="${ auraClassList.join(' ') }">
      ${imageIconHtml}
    </span>
  </div>
  <div class="msg-body">
    <div><span class="msg-name">${ nameHtml }</span></div>
    <div class="${ messageTextClassNames.join(' ') }"><span${ this.isSpecialColor ? '' : colorStyle }>${ textAutoLinkedHtml }</span>${ attachedImagesHtml }${ lastUpdateHtml }</div>
  </div>
</div>`
    } else {
      return `<div class="${ messageClassNames.join(' ') }" style="border-left-color: ${ color }">
<div class="msg-header">${ tabNameHtml }${ dateHtml }：<span class="msg-name">${ nameHtml }</span>：</div>
<div class="${ messageTextClassNames.join(' ') }"><span${ this.isSpecialColor ? '' : colorStyle }>${ textAutoLinkedHtml }</span>${ attachedImagesHtml }${ lastUpdateHtml }</div>
</div>`;
    }
  }

  static logCss(images?): string {
    const imageCSS = (!images ? '' : `\n
.msg-header, msg-icon, .msg-body {
  display: inline-box;
}
.msg-header::first-line, .msg-name {
  font-size: 116%;
}
.msg-header {
   white-space: nowrap;
}
.msg-icon {
  vertical-align: top;
  padding: 2px 3px;
  overflow: hidden;
  flex-shrink: 0;
}
img.icon {
  width: 4.6em;
  height: 4.6em;
  vertical-align: bottom;
  object-fit: cover;
  object-position: 50% 0%;
}
.face-icon-msessage img.icon {
  border-radius: 0.5rem;
}
.to-icon {
  width: 1.2em;
  height: 1.2em;
  vertical-align: top;
  margin-right: 2px;
  margin-top: 2px;
  object-fit: cover;
  object-position: 50% 0%;
  border-radius: 0.25rem;
  filter: drop-shadow(1px  0px 0px #fff)
      drop-shadow( 0px  1px 0px #fff)
      drop-shadow(-1px  0px 0px #fff)
      drop-shadow( 0px -1px 0px #fff);
}
span.icon-space {
  display: inline-block;
  width: 4.6em;
  height: 4.6em;
  vertical-align: bottom;
}
.inverse {
  transform: scaleX(-1);
}
.flip-vertical {
  transform: scaleY(-1);
}
.inverse.flip-vertical {
  transform: scale(-1, -1);
}
.hollow {
  opacity: 0.6;
  filter: blur(1px);
}
.black-paint {
  filter: brightness(0);
}
.white-paint {
  filter: brightness(0) invert(1);
}
.grayscale {
  filter: grayscale(1);
}
.sepia {
  filter: sepia(1);
}
.matrix {
  filter: grayscale(1) contrast(1.4) brightness(0.72) sepia(1) hue-rotate(85deg) saturate(5.5);
}
.contrast-fx {
  filter: contrast(1.7) brightness(1.15);
}
.aura.black {
  filter: drop-shadow(0 -0.2rem 0.2rem black);
}
.aura.blue {
  filter: drop-shadow(0 -0.2rem 0.2rem #00f);
}
.aura.green {
  filter: drop-shadow(0 -0.2rem 0.2rem #3f3);
}
.aura.cyan {
  filter: drop-shadow(0 -0.2rem 0.2rem #3ff);
}
.aura.red {
  filter: drop-shadow(0 -0.2rem 0.2rem #f00);
}
.aura.magenta {
  filter: drop-shadow(0 -0.2rem 0.2rem #f0f);
}
.aura.yellow {
  filter: drop-shadow(0 -0.2rem 0.2rem #ff3);
}
.aura.white {
  filter: drop-shadow(0 -0.2rem 0.3rem #999) drop-shadow(0 -0.2rem 0.2rem #fff);
}`);
    return `body {
  color: #444;
  background-color: #FFF;
}
hr {
  margin: 2px 0px;
  border: 1px dotted #aaa;
}
.message {
  display: flex;
  width: 100%;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  word-break: break-word;
  border-left: 4px solid transparent;
  margin-top: 1px;
  contain: layout;
}
.is-chrome .message {
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
.direct-message {
  background-color: #555;
  color: #CCC;
}
.dicebot-message .msg-text {
  color: #11F;
}
.direct-message.dicebot-message .msg-text {
  color: #CCF;
}
.dicebot-message .msg-text.is-success {
  color: #17f;
}
.dicebot-message .msg-text.is-failure {
  color: #F05;
}
.direct-message.dicebot-message .msg-text.is-success {
  color: #adF;
}
.direct-message.dicebot-message .msg-text.is-failure {
  color: #F66;
}
.operation-log {
  color: #666;
  background-color: #CCCCCCAA;
}
.dicebot-message .msg-name,
.dicebot-message .msg-text,
.operation-log .msg-name,
.operation-log .msg-text {
  font-style: oblique;
}
.tab-name {
  display: inline-block;
}
.tab-name::before {
  content: '[';
}
.tab-name::after {
  content: ']';
}
.msg-header {
  white-space: nowrap;
  border-left: 1px solid #FFF;
  padding-left: 2px;
  flex-shrink: 0;
}
.msg-name {
  font-weight: bolder;
}
.msg-text {
  white-space: pre-wrap;
  width: 100%
}
.msg-attached-list {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.msg-attached-link {
  display: inline-block;
  line-height: 0;
}
img.msg-attached {
  max-width: min(320px, 100%);
  max-height: 240px;
  object-fit: contain;
  vertical-align: bottom;
  border-radius: 4px;
}
.is-edited {
  margin-left: 2px;
  font-size: 8px;
}
.is-edited::before {
  content: '(';
}
.is-edited::after {
  content: ')';
}
a[target=_blank] {
  text-decoration: none;
  word-break: break-all;
}
a[target=_blank]:hover {
  text-decoration: underline;
}
a.outer-link::after {
  margin-right: 2px;
  margin-left: 2px;
  font-family: 'Material Icons';
  content: '\\e89e';
  font-weight: bolder;
  text-decoration: none;
  display: inline-block;
  font-size: smaller;
  vertical-align: 25%;
}
.direct-message a[href] {
  color: #CCF;
}
.direct-message a[href]:visited {
  color: #99D;
}
ruby {
  ruby-align: space-between;
}
s.drop-dice .dropped {
  color: #999;
}
.grow {
  text-shadow: 
       1px  0px 1px #fff,
       0px  1px 1px #fff,
      -1px  0px 1px #fff,
       0px -1px 1px #fff; 
}${ imageCSS }`;
  }

  static decorationDiceResult(diceBotMessage: string) :string {
    return diceBotMessage
      .replace(/###(.+?)###/g, '<b class="special-dice">$1</b>')
      .replace(/\~\~\~(.+?)\~\~\~/g, '<s class="drop-dice"><span class="dropped">$1</span></s>')
  }
}
