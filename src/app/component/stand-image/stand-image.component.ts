import { trigger, transition, animate, keyframes, style } from '@angular/animations';
import { ElementRef, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import { Component, Input, OnInit } from '@angular/core';
import { ImageFile, ImageState } from '@udonarium/core/file-storage/image-file';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { EventSystem } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { buildMatrixRainColumns, imageEffectFilter, imageEffectOpacity, imageEffectTransform, MatrixRainColumn } from '@udonarium/table-fx/image-effect';

@Component({
    selector: 'stand-image',
    templateUrl: './stand-image.component.html',
    styleUrls: ['./stand-image.component.css', '../shared/image-effects.css'],
    animations: [
        trigger('standInOut', [
            transition('void => *,:increment,:decrement', [
                animate('132ms cubic-bezier(.21,.97,.75,1.25)', keyframes([
                    style({ opacity: 0.6, transform: 'translateY(48px) scale(0.9)', offset: 0 }),
                    style({ opacity: 1.0, transform: 'translateY(0px) scale(1.0)', offset: 1.0 })
                ]))
            ]),
            transition('* => void,:increment,:decrement', [
                animate('132ms ease-out', keyframes([
                    style({ transform: 'translateY(0px) scale(1.0)', offset: 0 }),
                    style({ opacity: 0, transform: 'translateY(96px) scale(0.9)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('dialogShake', [
            transition(':increment', [
                animate('19ms ease', keyframes([
                    style({ transform: 'translateX(1px)' })
                ])),
                animate('19ms ease', keyframes([
                    style({ transform: 'translateX(-1px)' })
                ]))
            ])
        ]),
        trigger('fadeAndScaleInOut', [
            transition('void => *, true => false', [
                animate('200ms ease-in-out', keyframes([
                    style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }),
                    style({ transform: 'scale3d(0.9, 0.9, 0.9)', opacity: 0.9 }),
                ]))
            ]),
            transition('* => void, true => false', [
                animate('100ms ease-in-out', style({ transform: 'scale3d(0, 0, 0)', opacity: 0 }))
            ])
        ])
    ],
    standalone: false
})
export class StandImageComponent implements OnInit, OnDestroy {
  @Input() gameCharacter: GameCharacter;
  @Input() standElement: DataElement;
  @Input() color: string;
  @ViewChild('standImageElement', { static: false }) standImageElement: ElementRef;
  @ViewChild('dialogElement', { static: false }) dialogElement: ElementRef;

  static isShowStand = true;
  static isShowNameTag = true;
  static isCanBeGone = true;

  //private _imageFile: ImageFile = ImageFile.Empty;
  private _timeoutId;
  private _dialogTimeoutId;
  private _chatIntervalId;

  isFarewell = false;
  isGhostly = false;
  isBackyard = false;
  isVisible = false;
  isSecret = false;
  isImageLoaded = false; 

  private naturalWidth = 0;
  private naturalHeight = 0;

  isSpeaking = false;
  math = Math;

  private _speakingImageIdentifier: string;
  private _imageIdentifier: string;
  private _speakingImageUrl: string;
  private _imageUrl: string = ImageFile.Empty.url;

  constructor(
    private ngZone: NgZone
  ) { }

  onSpeaking(event: any) {
    // 配合角色對話泡泡顯示
    if (this.gameCharacter && this.gameCharacter.text && (this.isApplyDialog || this.isSpeakable || this.gameCharacter.isShowChatBubble)) {
      clearTimeout(this._timeoutId);
      this._timeoutId = setTimeout(() => {
        this.ngZone.run(() => {
          this.isVisible = false;
        });
      }, 12000);
    }
    // TODO: 表情（emote）時的圖片
    if (this.isSpeakable && !this.gameCharacter.isEmote) {
      clearTimeout(this._dialogTimeoutId);
      if (this.gameCharacter && this.gameCharacter.text) {
        if (!this.isSpeaking) this.refleshSpeakingImageUrl();
        this.isSpeaking = true;
      }
      this._dialogTimeoutId = setTimeout(() => {
        this.ngZone.run(() => {
          this.isSpeaking = false;
        });
      }, 300);
    }
  }

  get imageUrl(): string { return this._imageUrl; }
  get speakingImageUrl(): string { return this._speakingImageUrl ? this._speakingImageUrl : this._imageUrl; }

  get isShowStand(): boolean {
    return StandImageComponent.isShowStand;
  }

  get isShowNameTag(): boolean {
    return StandImageComponent.isShowNameTag && this.isShowName;
  }

  get isCanBeGone(): boolean {
    return StandImageComponent.isCanBeGone;
  }

  // TODO: 應共用化；暫定複製貼上兩次以內可接受
  set dialog(dialog) {
    if (!this.gameCharacter || (this.gameCharacter.isVisibleOnTable && !this.gameCharacter.isHideIn) || this.gameCharacter.location.name === 'graveyard') return;
    clearTimeout(this._dialogTimeoutId);
    let text = StringUtil.cr(dialog.text);
    const isEmote = StringUtil.isEmote(text);
    const rubys = [];
    const re = /[\|｜]([^\|｜\s]+?)《(.+?)》/g;
    let ary;
    let count = 0;
    let rubyLength = 0;

    if (!isEmote) {
      text = text.replace(/[。、]{3}/g, '…').replace(/[。、]{2}/g, '‥').replace(/(。|[\r\n]{2,})/g, "$1                            ").trimEnd(); // 在換行或句號後留時間的 dirty hack
      while ((ary = re.exec(text)) !== null) {
        let offset = ary.index - (count * 3);
        rubys.push({base: ary[1], ruby: ary[2], start: offset - rubyLength, end: offset + ary[1].length - rubyLength - 1});
        count++;
        rubyLength += ary[2].length;
      }
    }
 
    let speechDelay = 1000 / Array.from(text).length > 36 ? 1000 / Array.from(text).length : 36;
    if (speechDelay > 200) speechDelay = 200;
    this._dialogTimeoutId = setTimeout(() => {
      this.gameCharacter.dialog = null;
      this.gameCharacter.text = '';
      this.gameCharacter.isEmote = false; 
      //this.changeDetector.markForCheck();
    }, Array.from(text).length * speechDelay + 6000);

    this.gameCharacter.dialog = dialog;
    this.gameCharacter.isEmote = isEmote;
    count = 0;
    let countLength = 0;
    let rubyCount = 0;
    let tmpText = '';
    let carrentRuby = rubys.shift();
    let rubyText = '';
    let isOpenRuby = false;
    if (isEmote) {
      this.gameCharacter.text = text;
      //this.changeDetector.markForCheck();
    }  else {
      const charAry = Array.from(text.replace(/[\|｜]([^\|｜\s]+?)《.+?》/g, '$1'));
      this._chatIntervalId = setInterval(() => {
        let c = charAry[count];
        let isMulti = c.length > 1;
        if (c) {
            if (!isOpenRuby && carrentRuby && countLength >= carrentRuby.start) {
                tmpText += '<ruby>';
                isOpenRuby = true;
                rubyCount = 0;
            }
            tmpText += StringUtil.escapeHtml(c);
            if (isOpenRuby) {
                rubyCount += 1;
                let rt = carrentRuby.ruby;
                rubyText = '<rt>' + StringUtil.escapeHtml(Array.from(rt).slice(0, Math.ceil(Array.from(rt).length * (rubyCount / Array.from(carrentRuby.base).length))).join('')) + '</rt>'
            }
            if (isOpenRuby && carrentRuby && countLength >= carrentRuby.end - (isMulti ? 1 : 0)) {
                tmpText += (rubyText + '</ruby>');
                isOpenRuby = false;
                carrentRuby = rubys.shift(); 
            }
            countLength += c.length;
        }
        count += 1;
        this.gameCharacter.text = tmpText + (isOpenRuby ? (rubyText + '</ruby>') : '');
        //this.changeDetector.markForCheck();
        if (count >= charAry.length) {
          clearInterval(this._chatIntervalId);
        }
      }, speechDelay);
    }
  }

  get dialog() {
    if (!this.gameCharacter) return null;
    return this.gameCharacter.dialog;
  }

  get dialogText(): string {
    if (!this.gameCharacter || !this.gameCharacter.text) return '';
    return this.gameCharacter.text.replace(/[\r\n]{2,}/g, "\n\n").replace(/                            /g, '').trim();
    //const ary = this.gameCharacter.text.replace(/。/g, "。\n\n").split(/[\r\n]{2,}/g).filter(str => str.trim());
    //return ary.length > 0 ? ary.reverse()[0].trim() : '';
  }
  /*
  get standImage(): ImageFile {
    if (!this.standElement) return this._imageFile;
    let elm = null;
    if (this.isSpeaking) {
      elm = this.standElement.getFirstElementByName('speakingImageIdentifier');
    }
    if (!elm || !elm.value || elm.value == ImageFile.Empty.identifier) {
      elm = this.standElement.getFirstElementByName('imageIdentifier');
    }
    if (elm) {
      if (this._imageFile.identifier !== elm.value) { 
        let file: ImageFile = ImageStorage.instance.get(<string>elm.value);
        this._imageFile = file ? file : ImageFile.Empty;
      }
    }
    return this._imageFile;
  }
  */
  get isSpeakable(): boolean {
    if (!this.standElement) return false;
    let elm = this.standElement.getFirstElementByName('speakingImageIdentifier');
    return elm && elm.value && elm.value !== ImageFile.Empty.identifier;
  }

  get dialogFaceIcon(): ImageFile {
    if (!this.dialog || !this.dialog.faceIconIdentifier) return null;
    return ImageStorage.instance.get(<string>this.dialog.faceIconIdentifier);
  }

  get isUseFaceIcon(): ImageFile {
    return this.dialog && this.dialog.faceIconIdentifier;
  }
  
  get isRubied(): boolean {
    if (!this.gameCharacter || !this.gameCharacter.text) return false;
    return -1 < this.dialogText.indexOf('<ruby>');
  }

  ngOnInit(): void {
    EventSystem.register(this)
      .on('POPUP_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          this.ngZone.run(() => {
            this.dialog = event.data;
            //this.changeDetector.markForCheck();
          });
        }
      })
      .on('FAREWELL_CHAT_BALLOON', -1000, event => {
        if (this.gameCharacter && this.gameCharacter.identifier == event.data.characterIdentifier) {
          this.ngZone.run(() => {
            this.dialog = null;
            this.gameCharacter.text = '';
            this.gameCharacter.isEmote = false;
            //this.changeDetector.markForCheck();
          });
          clearTimeout(this._dialogTimeoutId);
          clearInterval(this._chatIntervalId);
        }
      });
    this.refleshImageUrls();
  }

  refleshImageUrls(force: boolean=false) {
    const imageElement = this.standElement.getFirstElementByName('imageIdentifier');
    if (force || !imageElement || this._imageIdentifier !== imageElement.value) {
      force = true;
      const revokeUrl = this._imageUrl;
      if (imageElement) {
        const iamgeFile: ImageFile = ImageStorage.instance.get(<string>imageElement.value);
        if (iamgeFile) {
          if (iamgeFile.state === ImageState.COMPLETE) {
            this._imageUrl = URL.createObjectURL(iamgeFile.blob);
          } else {
            this._imageUrl = iamgeFile.url;
          }
        } else {
          this._imageUrl = ImageFile.Empty.url;
        }
      } else {
        this._imageUrl = ImageFile.Empty.url;
      }
      URL.revokeObjectURL(revokeUrl);
      this._imageIdentifier = (imageElement && imageElement.value) ? imageElement.value.toString() : null;
    }
    this.refleshSpeakingImageUrl(force);
  }

  refleshSpeakingImageUrl(force: boolean=true) {
    const speakingImageElement = this.standElement.getFirstElementByName('speakingImageIdentifier');
    if (force || !speakingImageElement || this._speakingImageIdentifier !== speakingImageElement.value) {
      const revokeUrl = this._speakingImageUrl;
      if (speakingImageElement) {
        const iamgeFile: ImageFile = ImageStorage.instance.get(<string>speakingImageElement.value);
        if (iamgeFile) {
          if (iamgeFile.state === ImageState.COMPLETE) {
            this._speakingImageUrl = URL.createObjectURL(iamgeFile.blob);
          } else {
            this._speakingImageUrl = iamgeFile.url;
          }
        } else {
          this._speakingImageUrl = null;
        }
      } else {
        this._speakingImageUrl = null;
      }
      URL.revokeObjectURL(revokeUrl);
      this._speakingImageIdentifier = (speakingImageElement && speakingImageElement.value) ? speakingImageElement.value.toString() : null;
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this._timeoutId);
    clearInterval(this._chatIntervalId);
    URL.revokeObjectURL(this._speakingImageUrl);
    URL.revokeObjectURL(this._imageUrl);
  }

  get group(): string {
    if (!this.gameCharacter) return '';
    let elm = this.standElement.getFirstElementByName('name');
    return elm.currentValue && elm.currentValue.toString().length > 0 ? elm.currentValue.toString() : '';
  }

  get groupValue(): number {
    // 非安全用途雜湊，暫且如此
    let hash = 0;
    const str = this.group;
    for (let i = 0; i < str.length; i++) {
      let chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash;
  }

  get position(): number {
    if (!this.gameCharacter) return 0;
    let elm = this.standElement.getFirstElementByName('position');
    return elm && elm.currentValue ? +elm.value : (this.gameCharacter.standList?.position ?? 0);
  }

  get adjustY(): number {
    if (!this.gameCharacter) return 0;
    let elm = this.standElement.getFirstElementByName('height');
    const posYPercent = (elm && elm.currentValue) ? +elm.currentValue : 0;
    return this.imageHeight * posYPercent / 100;
  }

  get height(): number {
    if (!this.gameCharacter || !this.standElement) return 0;
    let elm = this.standElement.getFirstElementByName('height');
    if ((!elm || +elm.value == 0) && this.gameCharacter.standList) {
      return this.gameCharacter.standList.height;
    } 
    return elm ? +elm.value : 0;
  }

  get imageHeight(): number {
    return (this.height == 0) ?
      this.naturalHeight
    : document.documentElement.offsetHeight * this.height / 100;
  }

  get imageWidth(): number {
    return (this.imageHeight * this.naturalWidth / this.naturalHeight);
  }

  get dialogBoxCSSLeft(): number {
    return (this.imageWidth * (this.position > 50 ? 0.33 : 0.66) - this.imageWidth / 2 - 12)
     + (this.position * document.documentElement.clientWidth / 100) 
     - (this.position > 50 ? this.dialogBoxCSSMaxWidth : 0);
  }

  get dialogBoxCSSRight(): number {
    return document.documentElement.clientWidth - this.dialogBoxCSSLeft - this.dialogBoxCSSMaxWidth;
  }

  get dialogBoxCSSMaxWidth(): number {
    let screenRatio = this.imageWidth / document.documentElement.clientWidth;
    screenRatio = screenRatio / 2;
    if (screenRatio < 0.14) screenRatio = 0.14;  
    return (screenRatio * document.documentElement.clientWidth);
  }

  get dialogBoxCssBottom(): number {
    let ret = this.imageHeight * 0.66 + this.adjustY;
    if (ret < 48) ret = 48;
    if (this.dialogElement) {
      if (ret > document.documentElement.offsetHeight - this.dialogElement.nativeElement.clientHeight) ret = document.documentElement.offsetHeight - this.dialogElement.nativeElement.clientHeight;
    }
    return ret;
  }

  get emoteCssBottom(): number {
    let ret = this.imageHeight * 0.66 + (this.imageWidth / 4.5 > 16 ? this.imageWidth / 4.5 : 16);
    if (ret < 0) ret = 0;
    return ret;
  }

  get nameTagCSSMarginLeft(): number {
    let offset = (this.imageWidth / 2) - this.position * document.documentElement.clientWidth / 100;
    if (offset < 32) offset = 32;
    return (-this.imageWidth / 2) + offset;
  }

  get isApplyImageEffect(): boolean {
    if (!this.standElement || !this.gameCharacter) return false;
    let elm = this.standElement.getFirstElementByName('applyImageEffect');
    // 真偽判定有沒有更好的做法？
    if (elm && elm.value) {
      return true;
    }
    return false;
  }

  get standImageFilter(): string | null {
    return this.gameCharacter ? imageEffectFilter(this.gameCharacter) : null;
  }
  get standImageOpacity(): number | null {
    return this.gameCharacter ? imageEffectOpacity(this.gameCharacter) : null;
  }
  get standImageTransform(): string | null {
    return this.gameCharacter ? imageEffectTransform(this.gameCharacter) : null;
  }

  private _matrixRainCacheKey = '';
  private _matrixRainColumns: MatrixRainColumn[] = [];
  get showMatrixRain(): boolean {
    return !!(this.isApplyImageEffect && this.gameCharacter?.isMatrix);
  }
  get matrixRainColumns(): MatrixRainColumn[] {
    if (!this.showMatrixRain || !this.gameCharacter) return [];
    const w = this.imageWidth || 120;
    const count = Math.max(6, Math.min(18, Math.round(w / 14)));
    const key = `${this.gameCharacter.identifier}:stand:${count}`;
    if (key !== this._matrixRainCacheKey) {
      this._matrixRainCacheKey = key;
      this._matrixRainColumns = buildMatrixRainColumns(key, count, 22);
    }
    return this._matrixRainColumns;
  }
  trackByMatrixCol = (_: number, col: MatrixRainColumn) => `${col.duration}:${col.delay}:${col.text.length}`;

  get isApplyRoll(): boolean {
    if (!this.standElement || !this.gameCharacter) return false;
    let elm = this.standElement.getFirstElementByName('applyRoll');
    if (elm && elm.value) {
      return true;
    }
    return false;
  }

  get isApplyDialog(): boolean {
    if (!this.standElement || !this.gameCharacter) return false;
    let elm = this.standElement.getFirstElementByName('applyDialog');
    if (elm && elm.value) {
      return true;
    }
    return false;
  }

  private get isShowName(): boolean {
    if (!this.standElement || !this.gameCharacter) return false;
    let elm = this.standElement.getFirstElementByName('showName');
    if (elm && elm.value) {
      return true;
    }
    return false;
  }

  toGhostly() {
    this.ngZone.run(() => {
      this.isGhostly = true;
    });
  }

  toBackyard() {
    this.ngZone.run(() => {
      this.isBackyard = true;
    });
  }

  toFront() {
    this.ngZone.run(() => {
      this.isFarewell = false;
      this.isGhostly = false;
      this.isBackyard = false;
      this.isVisible = true;
    });
    clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(() => {
      this.ngZone.run(() => {
        this.isVisible = false;
      });
    }, 12000);
  }

  toFarewell() {
    this.ngZone.run(() => {
      this.isFarewell = true;
      this.isVisible = false;
    });
    //this.gameCharacter.text = '';
    clearTimeout(this._timeoutId);
    clearInterval(this._chatIntervalId);
  }

  onImageLoad() {
    this.naturalWidth = this.standImageElement.nativeElement.naturalWidth;
    this.naturalHeight = this.standImageElement.nativeElement.naturalHeight;
    this.isImageLoaded = true;
  }
}