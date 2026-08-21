import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Input,
  NgZone,
  OnChanges,
  OnDestroy
} from '@angular/core';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { MathUtil } from '@udonarium/core/system/util/math-util';
import { DiceSymbol } from '@udonarium/dice-symbol';
import { PeerCursor } from '@udonarium/peer-cursor';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopLoadSettle } from '@udonarium/tabletop-load-settle';
import { shouldIgnoreTabletopDoubleClick } from '@udonarium/tabletop-interact';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { DiceSettingsComponent } from 'component/dice-settings/dice-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { ObjectInteractGesture } from 'component/game-table/object-interact-gesture';
import { MovableOption } from 'directive/movable.directive';
import { RotableOption } from 'directive/rotable.directive';
import { ContextMenuAction, ContextMenuSeparator, ContextMenuService, contextMenuToggleCheck } from 'service/context-menu.service';
import { I18nService } from 'service/i18n.service';
import { ModalService } from 'service/modal.service';
import { ImageService } from 'service/image.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { ChatMessageService } from 'service/chat-message.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { TabletopActionService } from 'service/tabletop-action.service';

@Component({
    selector: 'dice-symbol',
    templateUrl: './dice-symbol.component.html',
    styleUrls: ['./dice-symbol.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('diceRoll', [
            transition('* => active', [
                animate('800ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) rotateZ(-0deg)', offset: 0 }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2) rotateZ(-360deg)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75) rotateZ(-520deg)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125) rotateZ(-630deg)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateZ(-720deg)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('coinFlip', [
            transition('* => active', [
                animate('800ms ease-out', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) translateY(0%) rotateX(60deg) rotateX(-0deg) rotateY(-0deg)', offset: 0 }),
                    style({ transform: 'scale3d(1.2, 1.2, 1.2)  translateY(-28%) rotateX(60deg) rotateX(-360deg) rotateY(-360deg)', offset: 0.5 }),
                    style({ transform: 'scale3d(0.75, 0.75, 0.75) translateY(-40%) rotateX(60deg) rotateX(-520deg) rotateY(-520deg)', offset: 0.75 }),
                    style({ transform: 'scale3d(1.125, 1.125, 1.125) translateY(-28%) rotateX(60deg) rotateX(-630deg) rotateY(-630deg)', offset: 0.875 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) translateY(0%) rotateX(60deg) rotateX(-720deg) rotateY(-720deg)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('diceRollNameTag', [
            transition('* => active', [
                animate('800ms ease', keyframes([
                    style({ transform: 'translateX(-50%) scale3d(0.8, 0.8, 0.8) rotateY(0deg)', offset: 0 }),
                    style({ transform: 'translateX(-50%) scale3d(1.2, 1.2, 1.2) rotateY(360deg)', offset: 0.5 }),
                    style({ transform: 'translateX(-50%) scale3d(0.75, 0.75, 0.75) rotateY(520deg)', offset: 0.75 }),
                    style({ transform: 'translateX(-50%) scale3d(1.125, 1.125, 1.125) rotateY(630deg)', offset: 0.875 }),
                    style({ transform: 'translateX(-50%) scale3d(1.0, 1.0, 1.0) rotateY(720deg)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('changeFace', [
            transition(':increment,:decrement', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) rotateZ(0deg)', offset: 0 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateZ(-360deg)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('changeFaceCoin', [
            transition(':increment,:decrement', [
                animate('200ms ease', keyframes([
                    style({ transform: 'scale3d(0.8, 0.8, 0.8) rotateX(0deg)', offset: 0 }),
                    style({ transform: 'scale3d(1.0, 1.0, 1.0) rotateX(-720deg)', offset: 1.0 })
                ]))
            ])
        ]),
        trigger('changeFaceNameTag', [
            transition(':increment,:decrement', [
                animate('200ms ease', keyframes([
                    style({ transform: 'translateX(-50%) scale3d(0.8, 0.8, 0.8) rotateY(0deg)', offset: 0 }),
                    style({ transform: 'translateX(-50%) scale3d(1.0, 1.0, 1.0) rotateY(360deg)', offset: 1.0 })
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
        ])
    ],
    standalone: false
})
export class DiceSymbolComponent implements OnChanges, AfterViewInit, OnDestroy {
  get skipEnterBounce(): boolean { return TabletopLoadSettle.skipEnterAnimation; }
  @Input() diceSymbol: DiceSymbol = null;
  @Input() is3D: boolean = false;

  get face(): string { return this.diceSymbol.face; }
  set face(face: string) { this.diceSymbol.mutateAppearance(() => { this.diceSymbol.face = face; }); }
  get owner(): string { return this.diceSymbol.owner; }
  set owner(owner: string) { this.diceSymbol.owner = owner; }
  get rotate(): number { return this.diceSymbol.rotate; }
  set rotate(rotate: number) { this.diceSymbol.mutateAppearance(() => { this.diceSymbol.rotate = rotate; }); }

  get name(): string { return this.diceSymbol.name; }
  set name(name: string) { this.diceSymbol.name = name; }
  get size(): number { return MathUtil.clampMin(this.diceSymbol.size); }
  get is2DMode(): boolean { return !!TableSelecter.instance?.viewTable?.is2DMode; }

  get faces(): string[] { return this.diceSymbol.faces; }
  get nothingFaces(): string[] { return this.diceSymbol.nothingFaces; }
  get imageFile(): ImageFile {
    return this.imageService.getEmptyOr(this.diceSymbol.imageFile);
  }
  get backFaceImageFile(): ImageFile {
    return this.imageService.getEmptyOr(this.diceSymbol.backFaceImageFile);
  }

  get isGMMode(): boolean { return this.diceSymbol.isGMMode; }

  get isMine(): boolean { return this.diceSymbol.isMine; }
  get hasOwner(): boolean { return this.diceSymbol.hasOwner; }
  get ownerName(): string { return this.diceSymbol.ownerName; }
  get ownerColor(): string { return this.diceSymbol.ownerColor; }
  get isVisible(): boolean { return this.diceSymbol.isVisible; }

  get isDropShadow(): boolean { return this.diceSymbol.isDropShadow; }
  set isDropShadow(isDropShadow: boolean) {
    this.diceSymbol.mutateAppearance(() => { this.diceSymbol.isDropShadow = isDropShadow; });
  }

  get isLock(): boolean { return this.diceSymbol.isLock; }
  set isLock(isLock: boolean) { this.diceSymbol.mutateAppearance(() => { this.diceSymbol.isLock = isLock; }); }

  get isCoin(): boolean { return this.diceSymbol.isCoin; }
  get selectionState(): SelectionState { return this.selectionService.state(this.diceSymbol); }
  get isSelected(): boolean { return this.selectionState !== SelectionState.NONE; }
  get isMagnetic(): boolean { return this.selectionState === SelectionState.MAGNETIC; }

  animeState: string = 'inactive';

  private iconHiddenTimer: NodeJS.Timeout = null;
  get isIconHidden(): boolean { return this.iconHiddenTimer != null };

  gridSize: number = 50;

  movableOption: MovableOption = {};
  rotableOption: RotableOption = {};

  private interactGesture: ObjectInteractGesture = null;

  viewRotateX = 50;
  viewRotateZ = 10;

  get nameTagRotate(): number {
    let x = (this.viewRotateX % 360) - 90;
    let z = (this.viewRotateZ + this.rotate) % 360;
    z = (z > 0 ? z : 360 + z);
    return (x > 0 ? x : 360 + x) * (this.isFlip ? 1 : -1);
  }

  get isFlip(): boolean {
    let z = (this.viewRotateZ + this.rotate) % 360;
    z = (z > 0 ? z : 360 + z);
    return 90 < z && z < 270;
  }

  constructor(
    private ngZone: NgZone,
    private panelService: PanelService,
    private contextMenuService: ContextMenuService,
    private elementRef: ElementRef<HTMLElement>,
    private changeDetector: ChangeDetectorRef,
    private pointerDeviceService: PointerDeviceService,
    private selectionService: TabletopSelectionService,
    private imageService: ImageService,
    private modalService: ModalService,
    private chatMessageService: ChatMessageService,
    private tabletopActionService: TabletopActionService,
    private i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnChanges(): void {
    EventSystem.register(this)
      .on('ROLL_DICE_SYMBOL', event => {
        if (event.data.identifier === this.diceSymbol.identifier) {
          this.ngZone.run(() => {
            this.animeState = 'inactive';
            this.changeDetector.markForCheck();
            queueMicrotask(() => { this.animeState = 'active'; this.changeDetector.markForCheck(); });
          });
        }
      })
      .on(`UPDATE_GAME_OBJECT/aliasName/${PeerCursor.aliasName}`, event => {
        let object = ObjectStore.instance.get<PeerCursor>(event.data.identifier);
        if (this.diceSymbol && object && object.userId === this.diceSymbol.owner) {
          this.changeDetector.markForCheck();
        }
      })
      .on('DICE_ALL_OPEN', event => {
        if (this.owner && !this.isLock) {
          this.owner = '';
          SoundEffect.play(PresetSound.unlock);
          this.chatMessageService.sendOperationLog(this.i18n.t('dice.revealLog', {
            name: this.diceDisplayName(),
            faceLabel: this.faceLabelOf(this.isCoin),
            face: this.face
          }));
        }
      })
      .on<object>('TABLE_VIEW_ROTATE', event => {
        this.ngZone.run(() => {
          this.viewRotateX = event.data['x'];
          this.viewRotateZ = event.data['z'];
          this.changeDetector.markForCheck();
        });
      })
      .on(`UPDATE_GAME_OBJECT/identifier/${this.diceSymbol?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_OBJECT_CHILDREN/identifier/${this.diceSymbol?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        const tableId = TableSelecter.instance?.viewTable?.identifier;
        if (tableId && event.data?.identifier === tableId) {
          this.changeDetector.markForCheck();
        }
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        this.changeDetector.markForCheck();
      })
      .on('UPDATE_FILE_RESOURE', event => {
        this.changeDetector.markForCheck();
      })
      .on('CHANGE_GM_MODE', event => {
        this.changeDetector.markForCheck();
      })
      .on(`UPDATE_SELECTION/identifier/${this.diceSymbol?.identifier}`, event => {
        this.changeDetector.markForCheck();
      })
      .on('DISCONNECT_PEER', event => {
        let cursor = PeerCursor.findByPeerId(event.data.peerId);
        if (!cursor || this.diceSymbol.owner === cursor.userId) this.changeDetector.markForCheck();
      });
    this.movableOption = {
      tabletopObject: this.diceSymbol,
      transformCssOffset: 'translateZ(1.0px)',
      colideLayers: ['terrain', 'text-note', 'character']
    };
    this.rotableOption = {
      tabletopObject: this.diceSymbol
    };
  }

  ngAfterViewInit() {
    this.ngZone.runOutsideAngular(() => {
      this.interactGesture = new ObjectInteractGesture(this.elementRef.nativeElement);
    });

    this.interactGesture.onstart = this.onInputStart.bind(this);
    this.interactGesture.oninteract = this.onDoubleClick.bind(this);
  }

  ngOnDestroy() {
    this.interactGesture.destroy();
    EventSystem.unregister(this);
  }

  @HostListener('dragstart', ['$event'])
  onDragstart(e: any) {
    e.stopPropagation();
    e.preventDefault();
  }

  animationShuffleDone(event: any) {
    this.animeState = 'inactive';
    this.changeDetector.markForCheck();
  }

  onInputStart(e: MouseEvent | TouchEvent) {
    this.ngZone.run(() => this.startIconHiddenTimer());
  }

  onDoubleClick(e?: Event) {
    if (shouldIgnoreTabletopDoubleClick(e)) return;
    e?.stopPropagation();
    this.showDetail(this.diceSymbol);
  }

  @HostListener('contextmenu', ['$event'])
  onContextMenu(e: Event) {
    e.stopPropagation();
    e.preventDefault();


    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;
    this.tabletopActionService.ensureObjectSelected(this.diceSymbol);
    let position = this.pointerDeviceService.pointers[0];

    let actions: ContextMenuAction[] = [];
    let title = this.name;

    if (this.isMultiSelectedDice()) {
      actions = this.makeSelectionContextMenu();
      title = this.i18n.t('dice.selectedCount', { count: this.selectedDiceSymbols().length });
    } else {
      actions = actions.concat(this.makeSelectionContextMenu());
      actions = actions.concat(this.makeContextMenu());
    }
    actions = this.tabletopActionService.withClipboardMenuPrefix(actions);

    this.contextMenuService.open(position, actions, title);
  }

  private selectedDiceSymbols(): DiceSymbol[] {
    return this.selectionService.objects.filter(
      object => object.aliasName === this.diceSymbol.aliasName
    ) as DiceSymbol[];
  }

  private isMultiSelectedDice(): boolean {
    return this.isSelected && this.selectedDiceSymbols().length > 1;
  }

  private makeSelectionContextMenu(): ContextMenuAction[] {
    if (this.selectionService.size <= 1) return [];

    let actions: ContextMenuAction[] = [];

    let objectPosition = {
      x: this.diceSymbol.location.x + (this.diceSymbol.size * this.gridSize) / 2,
      y: this.diceSymbol.location.y + (this.diceSymbol.size * this.gridSize) / 2,
      z: this.diceSymbol.posZ
    };
    actions.push({ name: this.i18n.t('dice.menu.1'), hotkey: 'T', action: () => this.selectionService.congregate(objectPosition) });

    if (this.isMultiSelectedDice()) {
      let selectedDiceSymbols = () => this.selectedDiceSymbols();
      const isContainCoin = selectedDiceSymbols().some(diceSymbol => diceSymbol.isCoin);
      const isContainDice = selectedDiceSymbols().some(diceSymbol => !diceSymbol.isCoin);
      const kinds = [isContainCoin ? this.i18n.t('dice.dynamic.1') : '', isContainDice ? this.i18n.t('dice.dynamic.2') : ''].filter(Boolean).join('／');
      const actionsLabel = [isContainCoin ? this.i18n.t('dice.dynamic.3') : '', isContainDice ? this.i18n.t('dice.dynamic.4') : ''].filter(Boolean).join('／');
      actions.push(
        {
          name: this.i18n.t('dice.selected', { kinds }), action: null, subActions: [
            {
              name: this.i18n.t('dice.allAction', { actions: actionsLabel }), action: () => {
                let needsSound = false;
                let isContainCoin = false;
                let isContainDice = false;
                const messages: string[] = [];
                selectedDiceSymbols().forEach(diceSymbol => {
                  if (diceSymbol.isVisible) {
                    needsSound = true;
                    isContainCoin = isContainCoin || diceSymbol.isCoin;
                    isContainDice = isContainDice || !diceSymbol.isCoin;
                    EventSystem.call('ROLL_DICE_SYMBOL', { identifier: diceSymbol.identifier });
                    let face = diceSymbol.diceRoll();
                    let message = this.i18n.t('dice.rolled', {
                      name: this.diceDisplayName(diceSymbol),
                      verb: diceSymbol.isCoin ? this.i18n.t('dice.verbCoin') : this.i18n.t('dice.verbDice')
                    });
                    if (diceSymbol.owner === '') message += ` → ${face}`;
                    messages.push(message);
                  }
                });
                if (messages.length) this.chatMessageService.sendOperationLog(messages.join(this.i18n.t('common.listSep')));
                if (needsSound) {
                  if (isContainCoin) SoundEffect.play(PresetSound.coinToss);
                  if (isContainDice) SoundEffect.play(PresetSound.diceRoll1);
                }
              }
            },
            {
              name: this.i18n.t('dice.menu.2'), action: () => {
                const messages: string[] = []; 
                selectedDiceSymbols().forEach(diceSymbol => {
                  if (diceSymbol.owner != '') {
                    messages.push(this.i18n.t('dice.revealLog', {
                      name: this.diceDisplayName(diceSymbol),
                      faceLabel: this.faceLabelOf(diceSymbol.isCoin),
                      face: diceSymbol.face
                    }));
                  }
                  diceSymbol.owner = '';
                });
                if (messages.length) this.chatMessageService.sendOperationLog(messages.join(this.i18n.t('common.listSep')));
                SoundEffect.play(PresetSound.unlock);
              },
              disabled: !selectedDiceSymbols().some(diceSymbol => diceSymbol.owner != '')
            },
            {
              name: this.i18n.t('dice.menu.3'), action: () => {
                const names: string[] = []; 
                selectedDiceSymbols().forEach(diceSymbol => {
                  if (diceSymbol.owner != Network.peer.userId) {
                    names.push(this.diceDisplayName(diceSymbol));
                  }
                  diceSymbol.owner = Network.peer.userId;
                });
                if (names.length) this.chatMessageService.sendOperationLog(this.i18n.t('dice.selfOnlyMany', { names: names.join(this.i18n.t('common.listSep')) }));
                SoundEffect.play(PresetSound.lock);
              },
              disabled: !selectedDiceSymbols().some(diceSymbol => diceSymbol.owner != Network.peer.userId)

            },
          ]
        },
        ContextMenuSeparator,
        {
          name: this.i18n.t('char.clearSelection'),
          action: () => this.selectionService.clear()
        },
      );
    }
    actions.push(ContextMenuSeparator);
    return actions;
  }

  private makeContextMenu(): ContextMenuAction[] {
    let actions: ContextMenuAction[] = [];

    //if (this.isVisible) {
      actions.push({
        name: this.isCoin ? this.i18n.t('dice.dynamic.5') : this.i18n.t('dice.dynamic.6'), action: () => {
          this.diceRoll();
        },
        disabled: !this.isVisible,
        default: this.isVisible,
        hotkey: 'F',
      });
    //}
    actions.push(ContextMenuSeparator);
    if (this.isMine || this.hasOwner) {
      actions.push({
        name: this.isCoin ? this.i18n.t('dice.dynamic.7') : this.i18n.t('dice.dynamic.8'), action: () => {
          this.owner = '';
          SoundEffect.play(PresetSound.unlock);
          const kind = this.isCoin ? this.i18n.t('dice.dynamic.1') : this.i18n.t('dice.dynamic.2');
          const name = this.diceSymbol.name == '' ? this.i18n.t('dice.unnamed', { kind }) : this.diceSymbol.name;
          const faceLabel = this.isCoin ? this.i18n.t('dice.dynamic.9') : this.i18n.t('dice.dynamic.11');
          this.chatMessageService.sendOperationLog(this.i18n.t('dice.revealLog', { name, faceLabel, face: this.face }));
        }
      });
    }
    if (!this.isMine) {
      actions.push({
        name: this.i18n.t('dice.menu.4'), action: () => {
          this.owner = Network.peer.userId;
          const kind = this.isCoin ? this.i18n.t('dice.dynamic.1') : this.i18n.t('dice.dynamic.2');
          const name = this.diceSymbol.name == '' ? this.i18n.t('dice.unnamed', { kind }) : this.diceSymbol.name;
          this.chatMessageService.sendOperationLog(this.i18n.t('dice.selfOnlyLog', { name }));
          SoundEffect.play(PresetSound.lock);
        }
      });
    }
    actions.push(contextMenuToggleCheck({
      get: () => this.isLock,
      set: (v) => {
        this.isLock = v;
        SoundEffect.play(v ? PresetSound.lock : PresetSound.unlock);
      },
      on: this.i18n.t('dice.menu.5'),
      off: this.i18n.t('dice.menu.6'),
      disabled: this.hasOwner && !this.isVisible,
      hotkey: 'L',
    }));
    if (this.isVisible) {
      let subActions: ContextMenuAction[] = [];
      let nothingFaces = this.nothingFaces;
      if (nothingFaces.length > 0) {
        nothingFaces.forEach(face => {
          subActions.push({
            name: `${this.face == face ? '◉' : '○'} ${face}　`, action: () => {
              SoundEffect.play(PresetSound.dicePut);
              this.face = face;
            },
            checkBox: 'radio'
          });
        });
        subActions.push(ContextMenuSeparator);
      }
      this.faces.forEach(face => {
        subActions.push({
          name: `${this.face == face ? '◉' : '○'} ${face}　`, action: () => {
            if (this.owner === '') SoundEffect.play(PresetSound.dicePut);
            if (this.owner === '' && this.face != face) {
              this.chatMessageService.sendOperationLog(this.i18n.t('dice.changeLog', {
                name: this.diceDisplayName(),
                faceLabel: this.faceLabelOf(this.isCoin),
                face
              }));
            }
            this.face = face;
          },
          checkBox: 'radio'
        });
      });
      actions.push({ name: this.isCoin ? this.i18n.t('dice.dynamic.9') : this.i18n.t('dice.dynamic.10'), action: null, subActions: subActions });
    }

    actions.push(ContextMenuSeparator);

    actions.push(contextMenuToggleCheck({
      get: () => this.isDropShadow,
      set: (v) => { this.isDropShadow = v; },
      on: this.i18n.t('dice.menu.7'),
      off: this.i18n.t('dice.menu.8'),
    }));

    actions.push(ContextMenuSeparator);
    actions.push({ name: this.i18n.t('dice.menu.9'), action: () => { this.showDetail(this.diceSymbol); } });
    if (this.diceSymbol.getUrls().length > 0) {
      actions.push({
        name: this.i18n.t('dice.menu.10'), action: null,
        subActions: this.diceSymbol.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: this.diceSymbol.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('common.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        }),
      });
      actions.push(ContextMenuSeparator);
    }
    actions.push({
      name: this.i18n.t('dice.menu.12'), action: () => {
        this.diceSymbol.destroy();
        SoundEffect.play(PresetSound.sweep);
      },
      hotkey: 'Del',
    });
    return actions;
  }

  onMove() {
    this.contextMenuService.close();
    SoundEffect.play(PresetSound.dicePick);
  }

  onMoved() {
    SoundEffect.play(PresetSound.dicePut);
  }

  diceRoll(): string {
    if (this.GuestMode()) return;
    EventSystem.call('ROLL_DICE_SYMBOL', { identifier: this.diceSymbol.identifier });
    //if (this.owner === '') {
      if (this.isCoin) {
        SoundEffect.play(PresetSound.coinToss);
      } else {
        SoundEffect.play(PresetSound.diceRoll1);
      }
    //}
    let face = this.diceSymbol.diceRoll();
    let message = this.i18n.t('dice.rolled', {
      name: this.diceDisplayName(),
      verb: this.isCoin ? this.i18n.t('dice.verbCoin') : this.i18n.t('dice.verbDice')
    });
    if (this.owner === '') message += ` → ${face}`;
    this.chatMessageService.sendOperationLog(message);
    return face;
  }

  private diceDisplayName(diceSymbol: DiceSymbol = this.diceSymbol): string {
    const kind = diceSymbol.isCoin ? this.i18n.t('dice.dynamic.1') : this.i18n.t('dice.dynamic.2');
    return diceSymbol.name == '' ? this.i18n.t('dice.unnamed', { kind }) : diceSymbol.name;
  }

  private faceLabelOf(isCoin: boolean): string {
    return isCoin ? this.i18n.t('dice.dynamic.9') : this.i18n.t('dice.dynamic.11');
  }

  showDetail(gameObject: DiceSymbol) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('dice.panelTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 210, top: coordinate.y - 180, width: 420, height: 400,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<DiceSettingsComponent>(DiceSettingsComponent, option);
    component.dice = gameObject;
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
