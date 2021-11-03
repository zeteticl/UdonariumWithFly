import { animate, keyframes, state, style, transition, trigger } from '@angular/animations';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { Card } from '@udonarium/card';
import { CardStack } from '@udonarium/card-stack';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectNode } from '@udonarium/core/synchronize-object/object-node';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { CardStackListComponent } from 'component/card-stack-list/card-stack-list.component';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { InputHandler } from 'directive/input-handler';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuSeparator, ContextMenuService } from 'service/context-menu.service';
import { ImageService } from 'service/image.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { ModalService } from 'service/modal.service';
import { ChatMessageService } from 'service/chat-message.service';

@Component({
  selector: 'card-stack',
  templateUrl: './card-stack.component.html',
  styleUrls: ['./card-stack.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('shuffle', [
      state('active', style({ transform: '' })),
      transition('* => active', [
        animate('800ms ease', keyframes([
          style({ transform: 'scale3d(0, 0, 0) rotateZ(0deg)', offset: 0 }),
          style({ transform: 'scale3d(1.2, 1.2, 1.2) rotateZ(360deg)', offset: 0.5 }),
          style({ transform: 'scale3d(0.75, 0.75, 0.75) rotateZ(520deg)', offset: 0.75 }),
          style({ transform: 'scale3d(1.125, 1.125, 1.125) rotateZ(630deg)', offset: 0.875 }),
          style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateZ(720deg)', offset: 1.0 })
        ]))
      ]),
      transition('* => inverse', [
        animate('200ms ease', keyframes([
          style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 0 }),
          style({ transform: 'scale3d(0.6, 1.2, 1.2)', offset: 0.5 }),
          style({ transform: 'scale3d(0, 0.75, 0.75)', offset: 0.75 }),
          style({ transform: 'scale3d(0.5, 1.125, 1.125)', offset: 0.875 }),
          style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
        ]))
      ])
    ]),
    trigger('bounceInOut', [
      transition('void => *', [
        animate('600ms ease', keyframes([
          style({ transform: 'scale3d(0, 0, 0)', offset: 0 }),
          style({ transform: 'scale3d(1.5, 1.5, 1.5)', offset: 0.5 }),
          style({ transform: 'scale3d(0.75, 0.75, 0.75)', offset: 0.75 }),
          style({ transform: 'scale3d(1.125, 1.125, 1.125)', offset: 0.875 }),
          style({ transform: 'scale3d(1.0, 1.0, 1.0)', offset: 1.0 })
        ]))
      ]),
      transition('* => void', [
        animate(100, style({ transform: 'scale3d(0, 0, 0)' }))
      ])
    ]),
  ]
})
export class CardStackComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() cardStack: CardStack = null;
  @Input() is3D: boolean = false;

  get name(): string { return this.cardStack.name; }
  get rotate(): number { return this.cardStack.rotate; }
  set rotate(rotate: number) { this.cardStack.rotate = rotate; }
  get zindex(): number { return this.cardStack.zindex; }
  get isShowTotal(): boolean { return this.cardStack.isShowTotal; }
  get cards(): Card[] { return this.cardStack.cards; }
  get isEmpty(): boolean { return this.cardStack.isEmpty; }
  get size(): number {
    let card = this.cardStack.topCard;
    return (card ? card.size : 2);
  }

  get hasOwner(): boolean { return this.cardStack.hasOwner; }
  get ownerName(): string { return this.cardStack.ownerName; }
  get ownerColor(): string { return this.cardStack.ownerColor; }

  get topCard(): Card { return this.cardStack.topCard; }
  get imageFile(): ImageFile { return this.imageService.getSkeletonOr(this.cardStack.imageFile); }

  animeState: string = 'inactive';

  private iconHiddenTimer: NodeJS.Timer = null;
  get isIconHidden(): boolean { return this.iconHiddenTimer != null };

  gridSize: number = 50;

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  private doubleClickTimer: NodeJS.Timer = null;
  private doubleClickPoint = { x: 0, y: 0 };

  private input: InputHandler = null;

  constructor(
    private ngZone: NgZone,
    private contextMenuService: ContextMenuService,
    private panelService: PanelService,
    private elementRef: ElementRef<HTMLElement>,
    private changeDetector: ChangeDetectorRef,
    private imageService: ImageService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService
  ) { }
  GuestMode() {
    return Network.GuestMode();
  }
  ngOnInit() {
    EventSystem.register(this)
      .on('SHUFFLE_CARD_STACK', -1000, event => {
        if (event.data.identifier === this.cardStack.identifier) {
          this.animeState = 'active';
          this.changeDetector.markForCheck();
        }
      })
      .on('INVERSE_CARD_STACK', -1000, event => {
        if (event.data.identifier === this.cardStack.identifier) {
          this.animeState = 'inverse';
          this.changeDetector.markForCheck();
        }
      })
      .on('UPDATE_GAME_OBJECT', -1000, event => {
        let object = ObjectStore.instance.get(event.data.identifier);
        if (!this.cardStack || !object) return;
        if ((this.cardStack === object)
          || (object instanceof ObjectNode && this.cardStack.contains(object))
          || (object instanceof PeerCursor && object.userId === this.cardStack.owner)) {
          this.changeDetector.markForCheck();
        }
      })
      .on('CARD_STACK_DECREASED', event => {
        if (event.data.cardStackIdentifier === this.cardStack.identifier && this.cardStack) this.changeDetector.markForCheck();
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', -1000, event => {
        this.changeDetector.markForCheck();
      })
      .on('DISCONNECT_PEER', event => {
        let cursor = PeerCursor.findByPeerId(event.data.peerId);
        if (!cursor || this.cardStack.owner === cursor.userId) this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.cardStack,
      transformCssOffset: 'translateZ(0.15px)',
      colideLayers: ['terrain', 'text-note']
    };
    this.rotableOption = {
      tabletopObject: this.cardStack
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.input = new InputHandler(this.elementRef.nativeElement);
    });
    this.input.onStart = e => this.ngZone.run(() => this.onInputStart(e));
  }

  ngOnDestroy() {
    this.input.destroy();
    EventSystem.unregister(this);
  }

  animationShuffleStarted(event: any) {

  }

  animationShuffleDone(event: any) {
    this.animeState = 'inactive';
    this.changeDetector.markForCheck();
  }

  @HostListener('carddrop', ['$event'])
  onCardDrop(e) {
    if (this.GuestMode()) return;
    if (this.cardStack === e.detail || (e.detail instanceof Card === false && e.detail instanceof CardStack === false)) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    if (e.detail instanceof Card) {
      let card: Card = e.detail;
      let distance: number = (card.location.x - this.cardStack.location.x) ** 2 + (card.location.y - this.cardStack.location.y) ** 2 + (card.posZ - this.cardStack.posZ) ** 2;
      if (distance < 50 ** 2) {
        this.chatMessageService.sendOperationLog(`${card.isFront ? card.name : '伏せたカード'} を ${this.cardStack.name} に乗せた`);
        this.cardStack.putOnTop(card);
      }
    } else if (e.detail instanceof CardStack) {
      let cardStack: CardStack = e.detail;
      let distance: number = (cardStack.location.x - this.cardStack.location.x) ** 2 + (cardStack.location.y - this.cardStack.location.y) ** 2 + (cardStack.posZ - this.cardStack.posZ) ** 2;
      if (distance < 25 ** 2) {
        this.chatMessageService.sendOperationLog(`${cardStack.name} を全て ${this.cardStack.name} に乗せた`);
        this.concatStack(cardStack);
      }
    }
  }

  startDoubleClickTimer(e) {
    if (!this.doubleClickTimer) {
      this.stopDoubleClickTimer();
      this.doubleClickTimer = setTimeout(() => this.stopDoubleClickTimer(), e.touches ? 500 : 300);
      this.doubleClickPoint = this.input.pointer;
      return;
    }

    if (e.touches) {
      this.input.onEnd = this.onDoubleClick.bind(this);
    } else {
      this.onDoubleClick();
    }
  }

  stopDoubleClickTimer() {
    clearTimeout(this.doubleClickTimer);
    this.doubleClickTimer = null;
    this.input.onEnd = null;
  }

  onDoubleClick() {
    if (this.GuestMode()) return;
    this.stopDoubleClickTimer();
    let distance = (this.doubleClickPoint.x - this.input.pointer.x) ** 2 + (this.doubleClickPoint.y - this.input.pointer.y) ** 2;
    if (distance < 10 ** 2) {
      console.log('onDoubleClick !!!!');

      const card = this.drawCard();
      if (card) {
        SoundEffect.play(PresetSound.cardDraw);
        let text: string;
        if (card.isFront) {
          text = `${this.cardStack.name} から ${card.name} を引いた`
        } else {
          text = `${this.cardStack.name} から 1枚引いて伏せた`
        }
        this.chatMessageService.sendOperationLog(text);
      }
    }
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  onInputStart(e: MouseEvent | TouchEvent) {
    if (this.GuestMode()) return;
    this.startDoubleClickTimer(e);
    this.cardStack.toTopmost();
    this.startIconHiddenTimer();

    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: this.cardStack.identifier, className: 'GameCharacter' });
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    if (this.GuestMode()) return;
    e.stopPropagation();
    e.preventDefault();

    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    let position = this.pointerDeviceService.pointers[0];
    this.contextMenuService.open(position, [
      {
        name: '抽一張卡', action: () => {
          const card = this.drawCard();
          if (card) {
            SoundEffect.play(PresetSound.cardDraw);
            let text: string;
            if (card.isFront) {
              text = `從 ${this.cardStack.name} 中抽取了 ${card.name} `
            } else {
              text = `從 ${this.cardStack.name} 中抽了一張牌`
            }
            this.chatMessageService.sendOperationLog(text);
          }
        },
        default: this.cards.length > 0,
        disabled: this.cards.length == 0
      },
      {
        name: '抽卡', action: null,
        subActions: [2, 3, 4, 5, 10].map(n => {
          return {
            name: `${n}張`,
            action: () => {
              const cards: Card[] = [];
              for (let i = 0; i < n; i++) {
                const card = this.drawCard();
                if (card) {
                  cards.push(card);
                  if (i == 0 || i == 3 || i == 9) SoundEffect.play(PresetSound.cardDraw);
                }
              }
              if (cards.length > 0) {
                const frontCards = cards.filter(card => card.isFront);
                if (frontCards.length == 0) {
                  this.chatMessageService.sendOperationLog(`${this.cardStack.name} 中 ${cards.length}抽了一張並蓋起`);
                } else {
                  const counter = new Map();
                  for (const card of frontCards) {
                    let count = counter.get(card.name) || 0;
                    count += 1;
                    counter.set(card.name, count);
                  }
                  let text = `${this.cardStack.name} 從 ${[...counter.keys()].map(key => `${key} 中 ${counter.get(key)}張`).join('、')}`;
                  if (frontCards.length === cards.length) {
                    text += '被抽走'
                  } else {
                    text += `抽了${cards.length - frontCards.length}張`;
                  }
                  this.chatMessageService.sendOperationLog(text);
                }
              }
            }
          };
        }),
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      (this.cards.length == 0 || !this.cardStack.topCard.isFront ? {
        name: '打開牌面', action: () => {
          if (!this.cardStack.topCard) return;
          if (!this.cardStack.topCard.isFront) this.chatMessageService.sendOperationLog(`${this.cardStack.name} 牌面 ${this.cardStack.topCard.name} 公開`);
          this.cardStack.faceUp();
          SoundEffect.play(PresetSound.cardDraw);
        }, 
        disabled: this.cards.length == 0        
      } : {
        name: '覆蓋牌面', action: () => {
          this.cardStack.faceDown();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      }),
      ContextMenuSeparator,
      {
        name: '打開所有牌', action: () => {
          //if (!this.cardStack.topCard) return;
          //if (!this.cardStack.topCard.isFront) this.chatMessageService.sendOperationLog(`${this.cardStack.name} をすべて表にし、一番上の ${this.cardStack.topCard.name} を公開した`);
          this.cardStack.faceUpAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      {
        name: '覆蓋所有卡牌', action: () => {
          this.cardStack.faceDownAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      {
        name: '將所有卡牌放在正確的位置', action: () => {
          this.cardStack.uprightAll();
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      {
        name: '洗牌', action: () => {
          this.cardStack.shuffle();
          SoundEffect.play(PresetSound.cardShuffle);
          EventSystem.call('SHUFFLE_CARD_STACK', { identifier: this.cardStack.identifier });
        },
        disabled: this.cards.length == 0
      },
      { name: '查看卡牌清單', action: () => {
        this.showStackList(this.cardStack);
        this.chatMessageService.sendOperationLog(`${this.cardStack.name} 查看卡牌清單`);
      }, disabled: this.cards.length == 0 },
      ContextMenuSeparator,
      (this.isShowTotal
        ? { name: '☑ 顯示牌數', action: () => { this.cardStack.isShowTotal = false; } }
        : { name: '☐ 顯示牌數', action: () => { this.cardStack.isShowTotal = true; } }
      ),
      { name: '對齊卡片尺寸', action: () => { if (this.cardStack.topCard) this.cardStack.unifyCardsSize(this.cardStack.topCard.size); }, disabled: this.cards.length == 0 },
      ContextMenuSeparator,
      {
        name: '根據人數分發卡牌', action: () => {
          this.splitStack(Network.peerIds.length);
          SoundEffect.play(PresetSound.cardDraw);
        },
        disabled: this.cards.length == 0
      },
      {
        name: '打破牌堆', action: () => {
          this.breakStack();
          SoundEffect.play(PresetSound.cardShuffle);
        },
        disabled: this.cards.length == 0
      },
      {
        name: '翻轉整個牌堆', action: () => {
          this.cardStack.inverse();
          SoundEffect.play(PresetSound.cardDraw);
          SoundEffect.play(PresetSound.cardDraw);
          EventSystem.call('INVERSE_CARD_STACK', { identifier: this.cardStack.identifier });
        },
        disabled: this.cards.length == 0
      },
      ContextMenuSeparator,
      { name: '顯示詳細資料', action: () => { this.showDetail(this.cardStack); } },
      (this.cardStack.getUrls().length <= 0 ? null : {
        name: '開啓参考URL', action: null,
        subActions: this.cardStack.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.cardStack.name, subTitle: urlElement.name });
              } 
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? '網址無效' : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        })
      }),
      (this.cardStack.getUrls().length <= 0 ? null : ContextMenuSeparator),
      {
        name: '製作副本', action: () => {
          let cloneObject = this.cardStack.clone();
          cloneObject.location.x += this.gridSize;
          cloneObject.location.y += this.gridSize;
          cloneObject.owner = '';
          cloneObject.toTopmost();
          SoundEffect.play(PresetSound.cardPut);
        }
      },
      {
        name: '刪除牌堆', action: () => {
          this.cardStack.setLocation('graveyard');
          this.cardStack.destroy();
          SoundEffect.play(PresetSound.sweep);
        }
      },
    ], this.name);
  }

  onMove() {
    SoundEffect.play(PresetSound.cardPick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.cardPut);
    this.ngZone.run(() => this.dispatchCardDropEvent());
  }

  private drawCard(): Card {
    let card = this.cardStack.drawCard();
    if (card) {
      this.cardStack.update(); // todo
      card.location.x += 100 + (Math.random() * 50);
      card.location.y += 25 + (Math.random() * 50);
      card.setLocation(this.cardStack.location.name);
    }
    return card;
  }

  private breakStack() {
    let cards = this.cardStack.drawCardAll().reverse();
    for (let card of cards) {
      card.location.x += 25 - (Math.random() * 50);
      card.location.y += 25 - (Math.random() * 50);
      card.toTopmost();
      card.setLocation(this.cardStack.location.name);
    }
    this.cardStack.setLocation('graveyard');
    this.cardStack.destroy();
  }

  private splitStack(split: number) {
    if (this.GuestMode()) return;
    if (split < 2) return;
    let cardStacks: CardStack[] = [];
    for (let i = 0; i < split; i++) {
      let cardStack = CardStack.create(`${this.cardStack.name}_${('0' + (i+1).toString()).slice(-2)}`);
      cardStack.location.x = this.cardStack.location.x + 50 - (Math.random() * 100);
      cardStack.location.y = this.cardStack.location.y + 50 - (Math.random() * 100);
      cardStack.posZ = this.cardStack.posZ;
      cardStack.location.name = this.cardStack.location.name;
      cardStack.rotate = this.rotate;
      cardStack.toTopmost();
      cardStacks.push(cardStack);
    }

    let cards = this.cardStack.drawCardAll();
    this.cardStack.setLocation('graveyard');
    this.cardStack.destroy();

    let num = 0;
    let splitIndex = (cards.length / split) * (num + 1);
    for (let i = 0; i < cards.length; i++) {
      cardStacks[num].putOnBottom(cards[i]);
      if (splitIndex <= i + 1) {
        num++;
        splitIndex = (cards.length / split) * (num + 1);
      }
    }
  }

  private concatStack(topStack: CardStack, bottomStack: CardStack = this.cardStack) {
    if (this.GuestMode()) return;
    let newCardStack = CardStack.create(bottomStack.name);
    newCardStack.location.name = bottomStack.location.name;
    newCardStack.location.x = bottomStack.location.x;
    newCardStack.location.y = bottomStack.location.y;
    newCardStack.posZ = bottomStack.posZ;
    newCardStack.zindex = topStack.zindex;
    newCardStack.rotate = bottomStack.rotate;

    let bottomCards: Card[] = bottomStack.drawCardAll();
    let topCards: Card[] = topStack.drawCardAll();
    for (let card of topCards.concat(bottomCards)) newCardStack.putOnBottom(card);

    bottomStack.setLocation('');
    bottomStack.destroy();

    topStack.setLocation('');
    topStack.destroy();
  }

  private dispatchCardDropEvent() {
    let element: HTMLElement = this.elementRef.nativeElement;
    let parent = element.parentElement;
    let children = parent.children;
    let event = new CustomEvent('carddrop', { detail: this.cardStack, bubbles: true });
    for (let i = 0; i < children.length; i++) {
      children[i].dispatchEvent(event);
    }
  }

  private showDetail(gameObject: CardStack) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = '設定牌堆';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 300, top: coordinate.y - 300, width: 600, height: 600 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  private showStackList(gameObject: CardStack) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });

    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 200, top: coordinate.y - 300, width: 400, height: 600 };

    this.cardStack.owner = Network.peerContext.userId;
    let component = this.panelService.open<CardStackListComponent>(CardStackListComponent, option);
    component.cardStack = gameObject;
  }

  private startIconHiddenTimer() {
    clearTimeout(this.iconHiddenTimer);
    this.iconHiddenTimer = setTimeout(() => {
      this.iconHiddenTimer = null;
      this.changeDetector.markForCheck();
    }, 300);
    this.changeDetector.markForCheck();
  }
}
