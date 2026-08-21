import { animate, state, style, transition, trigger } from '@angular/animations';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { EventSystem, Network } from '@udonarium/core/system';
import { I18nService } from 'service/i18n.service';
import { DataElement } from '@udonarium/data-element';
import { TabletopObject } from '@udonarium/tabletop-object';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { GameCharacter } from '@udonarium/game-character';
import { CharacterToken } from '@udonarium/character-token';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { noteMarkdownToHtml } from '@udonarium/note-markdown';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { ModalService } from 'service/modal.service';
import { Card, CardState } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { RangeArea } from '@udonarium/range';
import { imageEffectFilter, imageEffectOpacity, imageEffectTransform } from '@udonarium/table-fx/image-effect';

@Component({
    selector: 'overview-panel',
    templateUrl: './overview-panel.component.html',
    styleUrls: ['./overview-panel.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('fadeInOut', [
            state('in', style({ opacity: 1 })),
            state('out', style({ opacity: 0 })),
            transition('void => in', [
                style({ opacity: 0 }),
                animate('150ms ease-out')
            ]),
            transition('in => out', [
                animate('300ms ease-in')
            ])
        ])
    ],
    standalone: false
})
export class OverviewPanelComponent implements OnChanges, AfterViewInit, OnDestroy {
  @ViewChild('draggablePanel', { static: true }) draggablePanel: ElementRef<HTMLElement>;
  @ViewChild('cardImage', { static: false }) cardImageElement: ElementRef;
  @ViewChild('fullCardImage', { static: false }) fullCardImageElement: ElementRef<HTMLElement>;
  @ViewChild('textArea', { static: false }) textAreaElementRef: ElementRef;

  @Input() tabletopObject: TabletopObject = null;

  @Input() left: number = 0;
  @Input() top: number = 0;

  @Input() cardState: CardState = null;

  /** Sheet body for character / character-token overview. */
  get overviewCharacterBody(): GameCharacter | null {
    if (!this.tabletopObject) return null;
    if (this.tabletopObject instanceof GameCharacter) return this.tabletopObject;
    if (this.tabletopObject instanceof CharacterToken) return this.tabletopObject.character;
    return null;
  }

  /** Appearance host (Token preferred for FX / aura / overview-face flag). */
  private get overviewAppearance(): GameCharacter | CharacterToken | null {
    if (this.tabletopObject instanceof CharacterToken) return this.tabletopObject;
    if (this.tabletopObject instanceof GameCharacter) {
      return CharacterToken.appearanceHostFor(this.tabletopObject) || this.tabletopObject;
    }
    return this.overviewCharacterBody;
  }

  /** When true, tooltip stays until unpinned (or object deleted). */
  isPinned = false;
  /** Set by TooltipDirective to sync pin state. */
  onPinnedChange: ((pinned: boolean) => void) | null = null;

  /** Angular animation state for enter / leave. */
  fadeState: 'in' | 'out' = 'in';
  private fadeOutPromise: Promise<void> | null = null;

  /** Fade out then resolve (for dynamic destroy — leave animation alone is skipped). */
  beginFadeOut(durationMs = 300): Promise<void> {
    if (this.fadeOutPromise) return this.fadeOutPromise;
    this.fadeState = 'out';
    this.changeDetector.markForCheck();
    this.fadeOutPromise = new Promise(resolve => setTimeout(resolve, durationMs));
    return this.fadeOutPromise;
  }

  readonly CardStateFront = CardState.FRONT;
  readonly CardStateBack = CardState.BACK;

  gridSize = 50;
  naturalWidth = 0;
  naturalHeight = 0;

  stringUtil = StringUtil;

  private _imageFile: ImageFile = ImageFile.Empty;

  get imageUrl(): string {
    if (!this.tabletopObject) return '';
    const body = this.overviewCharacterBody;
    if (this.isUseIcon && body?.faceIcon) {
      return body.faceIcon.url;
    }
    if (body && body.standList && body.standList.overviewIndex > -1) {
      const standElement = body.standList.standElements[body.standList.overviewIndex];
      if (!standElement) return '';
      try {
        const element = standElement.getFirstElementByName('imageIdentifier')
        if (!element) return '';
        if (this._imageFile.identifier != element.value) {
          const file: ImageFile = ImageStorage.instance.get(<string>element.value);
          this._imageFile = file ? file : ImageFile.Empty;
        }
      } catch(e) {
        console.log(e);
      }
      return this._imageFile.url;
    }
    if (this.tabletopObject instanceof Card) { 
      if (this.cardState !== null) {
        if (this.cardState === this.CardStateFront) return this.tabletopObject.frontImage ? this.tabletopObject.frontImage.url : '';
        if (this.cardState === this.CardStateBack) return this.tabletopObject.backImage ? this.tabletopObject.backImage.url : '';
      }
      if (this.tabletopObject.isGMMode) return this.tabletopObject.frontImage ? this.tabletopObject.frontImage.url : '';
    }
    if (this.tabletopObject instanceof CharacterToken) {
      return body?.imageFile?.url || this.tabletopObject.imageFile?.url || '';
    }
    return this.tabletopObject.imageFile ? this.tabletopObject.imageFile.url : '';
  }
  get hasImage(): boolean { return 0 < this.imageUrl.length; }
  get isUseIcon(): boolean {
    const body = this.overviewCharacterBody;
    const host = this.overviewAppearance;
    // Flag is per-map cosmetics on the Token; faceIcon image stays on the sheet.
    return !!(
      body &&
      host &&
      host.isUseIconToOverviewImage &&
      body.faceIcon &&
      0 < body.faceIcon.url?.length
    );
  }

  get roll(): number {
    const body = this.overviewCharacterBody;
    if (body) {
      if (body.standList && body.standList.overviewIndex > -1) {
        const standElement = body.standList.standElements[body.standList.overviewIndex];
        if (!standElement) return 0;
        try {
          const element = standElement.getFirstElementByName('applyRoll');
          return (element && element.value) ? body.roll : 0;
        } catch(e) {
          console.log(e);
        }
      }
      return body.roll;
    }
    return 0;
  }

  get applyImageEffect(): boolean {
    const body = this.overviewCharacterBody;
    if (body) {
      if (body.standList && body.standList.overviewIndex > -1) {
        const standElement = body.standList.standElements[body.standList.overviewIndex];
        if (!standElement) return false;
        try {
          const element = standElement.getFirstElementByName('applyImageEffect');
          return (element && element.value) ? true : false;
        } catch(e) {
          console.log(e);
        }
      }
      return true;
    }
    return false;
  }

  get isInverse(): boolean {
    const host = this.overviewAppearance;
    if (host instanceof GameCharacter || host instanceof CharacterToken) {
      return this.applyImageEffect ? !!host.isInverse : false;
    }
    return false;
  }

  get isHollow(): boolean {
    const host = this.overviewAppearance;
    if (host instanceof GameCharacter || host instanceof CharacterToken) {
      return this.applyImageEffect ? !!host.isHollow : false;
    }
    return false;
  }

  get isBlackPaint(): boolean {
    const host = this.overviewAppearance;
    if (host instanceof GameCharacter || host instanceof CharacterToken) {
      return this.applyImageEffect ? !!host.isBlackPaint : false;
    }
    return false;
  }

  get charOverviewFilter(): string | null {
    const host = this.overviewAppearance;
    if (!host || !this.applyImageEffect) return null;
    return imageEffectFilter(host);
  }
  get charOverviewOpacity(): number | null {
    const host = this.overviewAppearance;
    if (!host || !this.applyImageEffect) return null;
    return imageEffectOpacity(host);
  }
  get charOverviewTransform(): string | null {
    const host = this.overviewAppearance;
    if (!host || !this.applyImageEffect) return null;
    return imageEffectTransform(host);
  }

  followImageFilter(ch: GameCharacter | CharacterToken): string | null { return imageEffectFilter(ch); }
  followImageOpacity(ch: GameCharacter | CharacterToken): number | null { return imageEffectOpacity(ch); }
  followImageTransform(ch: GameCharacter | CharacterToken): string | null { return imageEffectTransform(ch); }

  get aura(): number {
    const host = this.overviewAppearance;
    if (host instanceof GameCharacter || host instanceof CharacterToken) {
      return this.applyImageEffect ? (host.aura ?? -1) : -1;
    }
    return -1;
  }

  get inventoryDataElms(): DataElement[] {
    const body = this.overviewCharacterBody;
    if (!body) return [];
    return this.getInventoryTags(body);
  }
  get dataElms(): DataElement[] {
    const body = this.overviewCharacterBody;
    if (body?.detailDataElement) return body.detailDataElement.children as DataElement[];
    return this.tabletopObject && this.tabletopObject.detailDataElement ? this.tabletopObject.detailDataElement.children as DataElement[] : [];
  }
  get hasDataElms(): boolean { return 0 < this.dataElms.length || 0 < this.inventoryDataElms.length; }

  //get newLineStrings(): string { return this.inventoryService.newLineStrings; }
  get newLineDataElement(): DataElement { return this.inventoryService.newLineDataElement; }
  get isPointerDragging(): boolean { return this.pointerDeviceService.isDragging || this.pointerDeviceService.isTablePickGesture; }

  get pointerEventsStyle(): any { return { 'is-pointer-events-auto': !this.isPointerDragging, 'pointer-events-none': this.isPointerDragging }; }

  isOpenImageView: boolean = false;

  checkValue(dataElm): string {
    if (!dataElm || dataElm.currentValue == null) return '';
    let ary = dataElm.currentValue.toString().split(/[|｜]/, 2);
    if (ary.length <= 1) return (dataElm.value == null || dataElm.value == '') ? '' : dataElm.currentValue.toString();
    let ret = (dataElm.value == null || dataElm.value == '') ? ary[1] : ary[0];
    if (this.tabletopObject instanceof GameCharacter && this.tabletopObject.chatPalette) {
      ret = this.tabletopObject.chatPalette.evaluate(ret, this.tabletopObject.rootDataElement);
    }
    return ret;
  }

  constructor(
    private inventoryService: GameObjectInventoryService,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    public i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }

  togglePin(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.isPinned = !this.isPinned;
    this.onPinnedChange?.(this.isPinned);
    this.changeDetector.markForCheck();
  }

  ngOnChanges(): void {
    EventSystem.unregister(this);
    const ids = new Set<string>();
    if (this.tabletopObject?.identifier) ids.add(this.tabletopObject.identifier);
    // CharacterToken overview reads the body sheet — watch body updates too (esp. temporary copies).
    const body = this.overviewCharacterBody;
    if (body?.identifier) ids.add(body.identifier);
    const reg = EventSystem.register(this);
    for (const id of ids) {
      reg
        .on(`UPDATE_GAME_OBJECT/identifier/${id}`, () => {
          this.changeDetector.markForCheck();
        })
        .on(`UPDATE_OBJECT_CHILDREN/identifier/${id}`, () => {
          this.changeDetector.markForCheck();
        });
    }
    reg
      .on('SYNCHRONIZE_FILE_LIST', () => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', () => {
        this.changeDetector.markForCheck();
      });
  }

  ngAfterViewInit() {
    this.initPanelPosition();
    setTimeout(() => {
      this.adjustPositionRoot();
    }, 16);
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  @HostListener('document:draggingstate', ['$event'])
  onChangeDragging(e: Event) {
    this.changeDetector.markForCheck();
  }

  private initPanelPosition() {
    let panel: HTMLElement = this.draggablePanel.nativeElement;
    let outerWidth = panel.offsetWidth;
    let outerHeight = panel.offsetHeight;

    let offsetLeft = this.left + 100;
    let offsetTop = this.top - outerHeight - 50;

    let isCollideLeft = false;
    let isCollideTop = false;

    if (window.innerWidth < offsetLeft + outerWidth) {
      offsetLeft = window.innerWidth - outerWidth;
      isCollideLeft = true;
    }

    if (offsetTop <= 0) {
      offsetTop = 0;
      isCollideTop = true;
    }

    if (isCollideLeft) {
      offsetLeft = this.left - outerWidth - 100;
    }

    if (offsetLeft < 0) offsetLeft = 0;
    if (offsetTop < 0) offsetTop = 0;

    panel.style.left = offsetLeft + 'px';
    panel.style.top = offsetTop + 'px';
  }

  private adjustPositionRoot() {
    let panel: HTMLElement = this.draggablePanel.nativeElement;

    let panelBox = panel.getBoundingClientRect();

    let diffLeft = 0;
    let diffTop = 0;

    if (window.innerWidth < panelBox.right + diffLeft) {
      diffLeft += window.innerWidth - (panelBox.right + diffLeft);
    }
    if (panelBox.left + diffLeft < 0) {
      diffLeft += 0 - (panelBox.left + diffLeft);
    }

    if (window.innerHeight < panelBox.bottom + diffTop) {
      diffTop += window.innerHeight - (panelBox.bottom + diffTop);
    }
    if (panelBox.top + diffTop < 0) {
      diffTop += 0 - (panelBox.top + diffTop);
    }

    panel.style.left = panel.offsetLeft + diffLeft + 'px';
    panel.style.top = panel.offsetTop + diffTop + 'px';
  }

  chanageImageView(isOpen: boolean) {
    this.isOpenImageView = isOpen;
  }

  openUrl(url, title=null, subTitle=null) {
    if (StringUtil.sameOrigin(url)) {
      window.open(url.trim(), '_blank', 'noopener');
    } else {
      this.modalService.open(OpenUrlComponent, { url: url, title: title, subTitle: subTitle });
    }
    return false; 
  }
  private getInventoryTags(gameObject: TabletopObject): DataElement[] {
    const cached = this.inventoryService.tableInventory.dataElementMap.get(gameObject.identifier);
    if (cached) return cached;
    // Temporary bodies are excluded from inventory maps — build the same summary tags locally.
    return this.inventoryService.summaryElementsFor(gameObject);
  }

  onCardImageLoad() {
    if (!this.cardImageElement) return;
    this.naturalWidth = this.cardImageElement.nativeElement.naturalWidth;
    this.naturalHeight = this.cardImageElement.nativeElement.naturalHeight;
  }
  onFullCardImageLoad() {
    if (!this.cardImageElement) return;
    this.naturalWidth = this.cardImageElement.nativeElement.naturalWidth;
    this.naturalHeight = this.cardImageElement.nativeElement.naturalHeight;
  }

  get imageAreaRect(): {width: number, height: number, top: number, left: number, scale: number} {
    return this.calcImageAreaRect(250, 330, 8);
  }

  get fullImageAreaRect(): {width: number, height: number, top: number, left: number, scale: number} {
    return this.calcImageAreaRect(document.documentElement.clientWidth, document.documentElement.offsetHeight, 16);
  }

  private calcImageAreaRect(areaWidth: number, areaHeight: number, offset: number): {width: number, height: number, top: number, left: number, scale: number} {
    const rect = {width: 0, height: 0, top: offset, left: offset, scale: 1};
    if (this.naturalWidth == 0 || this.naturalHeight == 0) return rect;

    const viewWidth = areaWidth - offset * 2;
    const viewHeight = areaHeight - offset * 2;
    // 尚未使用 scale 時期的殘留
    if ((this.naturalHeight * viewWidth / this.naturalWidth) > viewHeight) {
      rect.width = this.naturalWidth * viewHeight / this.naturalHeight;
      rect.height = viewHeight;
      rect.left = offset + (viewWidth - rect.width) / 2;
    } else {
      rect.width = viewWidth;
      rect.height = this.naturalHeight * viewWidth / this.naturalWidth;
      rect.top = offset + (viewHeight - rect.height) / 2;
    } 

    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    if (card) {
      rect.scale = rect.width / (card.size * this.gridSize);
      rect.width = card.size * this.gridSize;
      rect.height = rect.width * this.naturalHeight / this.naturalWidth;
    }
    return rect;
  }

  get cardColor(): string {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? card.color : '#555555';
  }

  get cardFontSize(): number {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? card.fontsize + 9 : 18;
  }

  get cardText(): string {
    let card = null;
    if (this.tabletopObject instanceof CardStack) {
      card = this.tabletopObject.topCard;
    } else if (this.tabletopObject instanceof Card) {
      card = this.tabletopObject;
    }
    return card ? StringUtil.rubyToHtml(StringUtil.escapeHtml(card.text)) : '';
  }

  get cardTextShadowCss(): string {
    const shadow = StringUtil.textShadowColor(this.cardColor);
    return `${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px, 
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px,
    ${shadow} 0px 0px 2px`;
  }

  get rangeElms(): DataElement[] {
    let ret = []
    if (!this.tabletopObject || !(this.tabletopObject instanceof RangeArea) || !this.tabletopObject.commonDataElement) return ret;
    if (this.tabletopObject.commonDataElement.getFirstElementByName('length')) ret.push(this.tabletopObject.commonDataElement.getFirstElementByName('length'));
    if ((this.tabletopObject.type === 'CORN' || this.tabletopObject.type === 'LINE') && this.tabletopObject.commonDataElement.getFirstElementByName('width')) ret.push(this.tabletopObject.commonDataElement.getFirstElementByName('width'));
    if (this.tabletopObject.commonDataElement.getFirstElementByName('opacity')) ret.push(this.tabletopObject.commonDataElement.getFirstElementByName('opacity'));
    return ret;
  }

  get isNoLogging(): boolean {
    if (this.tabletopObject instanceof Card) return !this.tabletopObject.isFront;
    if (this.tabletopObject instanceof DiceSymbol) return this.tabletopObject.hasOwner;
    return false;
  }

  get isSelected(): boolean { return this.textAreaElementRef && document.activeElement === this.textAreaElementRef.nativeElement; }

  adjustedRubiedNote(text, isRubied=true) {
    if (!text) return '';
    let ret = noteMarkdownToHtml(text, { ruby: isRubied });
    return (ret.lastIndexOf('\n') == ret.length - 1) ? ret + '\n' : ret;
  }

  textAreaActivate() {
    if (this.textAreaElementRef && this.textAreaElementRef.nativeElement) this.textAreaElementRef.nativeElement.focus();
  }

  /** Footprint DataElements (size/altitude/length/…) stay per-map. */
  writeOverviewDataElm(el: DataElement, value: any) {
    TabletopObject.writeDataElementValue(el, value);
  }
}