import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostBinding, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { ChatTab } from '@udonarium/chat-tab';
import { EventSystem } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TabletopObject } from '@udonarium/tabletop-object';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { ChatMessageService } from 'service/chat-message.service';
import { ModalService } from 'service/modal.service';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'game-data-element, [game-data-element]',
    templateUrl: './game-data-element.component.html',
    styleUrls: ['./game-data-element.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class GameDataElementComponent implements OnInit, OnDestroy {
  @Input() tabletopObject: TabletopObject = null;
  @Input() gameDataElement: DataElement = null;
  @Input() isEdit: boolean = false;
  @Input() isTagLocked: boolean = false;
  @Input() isValueLocked: boolean = false;
  @Input() isHideText: boolean = false;
  @Input() isNoLogging: boolean = false;
  @Input() descriptionType: string;
  /** Compact single-line value controls (character settings sheet). */
  @Input() dense: boolean = false;

  @HostBinding('class.dense') get denseClass(): boolean { return this.dense; }

  stringUtil = StringUtil;

  private _name: string = '';
  get name(): string { return this._name; }
  set name(name: string) { this._name = name; this.setUpdateTimer(); }

  private _value: number | string = 0;
  get value(): number | string { return this._value; }
  set value(value: number | string) { this._value = value; this.setUpdateTimer(); }

  private _currentValue: number | string = 0;
  get currentValue(): number | string { return this._currentValue == null ? '' : this._currentValue; }
  set currentValue(currentValue: number | string) { this._currentValue = currentValue; this.setUpdateTimer(); }

  get abilityScore(): number { return this.gameDataElement.calcAbilityScore(); }

  get isTabletopObjectName() {
    return this.isTagLocked && (this.gameDataElement.name === 'name');
  }

  get tabletopObjectName() {
    let element = this.tabletopObject.commonDataElement.getFirstElementByName('name') || this.tabletopObject.commonDataElement.getFirstElementByName('title');
    return element ? <string>element.value : '';
  }

  get checkValue(): string {
    if (this.currentValue == null) return '';
    let ary = this.currentValue.toString().split(/[|｜]/, 2);
    if (ary.length <= 1) return (this.value == null || this.value == '') ? '' : this.currentValue.toString();
    let ret = (this.value == null || this.value == '') ? ary[1] : ary[0];
    if (this.tabletopObject instanceof GameCharacter && this.tabletopObject.chatPalette) {
      ret = this.tabletopObject.chatPalette.evaluate(ret, this.tabletopObject.rootDataElement);
    }
    return ret;
  }

  get isCommonValue(): boolean {
    if (this.gameDataElement) {
      return this.isTagLocked && (this.gameDataElement.name === 'size'
        || this.gameDataElement.name === 'width'
        || this.gameDataElement.name === 'height'
        || this.gameDataElement.name === 'depth'
        || this.gameDataElement.name === 'length'
        || this.gameDataElement.name === 'fontsize'
        || this.gameDataElement.name === 'opacity'
        || this.gameDataElement.name === 'altitude'
        || this.gameDataElement.name === 'color');
    }
    return false;
  }

  get isNotApplicable(): boolean {
    return this.isCommonValue && this.descriptionType === 'range-not-width' && this.gameDataElement.name === 'width';
  }

  get colorSampleTextShadowCss(): string {
    const shadow = StringUtil.textShadowColor(this.value.toString());
    return `${shadow} -1px -1px 0px, 
      ${shadow} 0px -1px 0px, 
      ${shadow} 1px -1px 0px, 
      ${shadow} -1px 0px 0px, 
      ${shadow} 1px 0px 0px,
      ${shadow} -1px 1px 0px,
      ${shadow} 0px 1px 0px,
      ${shadow} 1px 1px 0px`;
  }

  get identifier(): string {
    return this.gameDataElement.identifier;
  }

  private updateTimer: NodeJS.Timeout = null;

  constructor(
    private changeDetector: ChangeDetectorRef,
    private chatMessageService: ChatMessageService,
    private modalService: ModalService,
    private i18n: I18nService
  ) { }

  ngOnInit() {
    if (this.gameDataElement) this.setValues(this.gameDataElement);
  }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    EventSystem.register(this)
      .on('UPDATE_GAME_OBJECT', event => {
        let isDetectChange = false;
        if (this.gameDataElement && event.data.identifier === this.gameDataElement.identifier) {
          this.setValues(this.gameDataElement);
          isDetectChange = true;
        } else if (this.tabletopObject && this.tabletopObject.contains(this.gameDataElement)) {
          isDetectChange = true;
        }
        if (isDetectChange) this.changeDetector.markForCheck();
      })
      .on(`UPDATE_GAME_OBJECT/identifier/${this.gameDataElement?.identifier}`, event => {
        this.setValues(this.gameDataElement);
        this.changeDetector.markForCheck();
      })
      .on('DELETE_GAME_OBJECT', event => {
        if (this.gameDataElement && this.gameDataElement.identifier === event.data.identifier) {
          this.changeDetector.markForCheck();
        }
      })
      .on('LOCALE_CHANGED', () => this.changeDetector.markForCheck());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  addElement() {
    this.gameDataElement.appendChild(DataElement.create(this.i18n.t('sheet.data.tag'), '', {}));
  }

  deleteElement() {
    this.gameDataElement.destroy();
  }

  upElement() {
    let parentElement = this.gameDataElement.parent;
    let index: number = parentElement.children.indexOf(this.gameDataElement);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.gameDataElement, prevElement);
    }
  }

  downElement() {
    let parentElement = this.gameDataElement.parent;
    let index: number = parentElement.children.indexOf(this.gameDataElement);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.gameDataElement);
    }
  }

  setElementType(type: string) {
    this.gameDataElement.setAttribute('type', type);
  }

  isNum(n: any): boolean {
    return isFinite(n);
  }

  openUrl(url) {
    if (StringUtil.sameOrigin(url)) {
      window.open(url.trim(), '_blank', 'noopener');
    } else {
      this.modalService.open(OpenUrlComponent, { url: url, title: this.tabletopObjectName, subTitle: this.name });
    } 
  }

  /** Send field value (or current/max) + name to the first chat tab for quick dice/commands. */
  sendLogMessage() {
    const chatTabs = this.chatMessageService.chatTabs;
    if (!chatTabs || chatTabs.length < 1) return;

    const chatTab: ChatTab = chatTabs[0];
    let payload = `${this.value ?? ''}`;
    if (this.currentValue !== '' && this.currentValue != null) {
      payload = `${this.currentValue}/${this.value}`;
    }
    let text = `${payload} ${this.name}`.trim();
    if (!text) return;

    const sendFrom = (this.tabletopObject instanceof GameCharacter)
      ? this.tabletopObject.identifier
      : PeerCursor.myCursor.identifier;
    let gameType = this.chatMessageService.gameType || 'DiceBot';

    // Same {} / ｛｝ ability TAG expansion as chat palette (e.g. 2d6+{敏捷} in 戰鬥特技).
    if (this.tabletopObject instanceof GameCharacter && this.tabletopObject.chatPalette) {
      const palette = this.tabletopObject.chatPalette;
      text = palette.evaluate(text, this.tabletopObject.rootDataElement);
      if (palette.dicebot) gameType = palette.dicebot;
    }

    this.chatMessageService.sendMessage(chatTab, text, gameType, sendFrom);
  }

  private setValues(object: DataElement) {
    this._name = object.name;
    this._currentValue = object.currentValue;
    this._value = object.value;
  }

  private setUpdateTimer() {
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      const needsAppearance = !!(this.tabletopObject && this.isAppearancePlacementField(this.gameDataElement.name));
      // Seed other maps from pre-edit live before mutating footprint DataElements.
      if (needsAppearance) this.tabletopObject.ensureAppearanceBackfilled();
      if (this.gameDataElement.name !== this.name) this.gameDataElement.name = this.name;
      if (this.gameDataElement.currentValue !== this.currentValue) this.gameDataElement.currentValue = this.currentValue;
      if (this.gameDataElement.value !== this.value) this.gameDataElement.value = this.value;
      // Per-map appearance (size/height/altitude) must not stay only on shared DataElements.
      if (needsAppearance) {
        this.tabletopObject.syncAppearanceToCurrentViewPlacement();
      }
      this.updateTimer = null;
    }, 66);
  }

  private isAppearancePlacementField(name: string): boolean {
    return TabletopObject.isPlacementFootprintName(name);
  }
}
