import { animate, keyframes, style, transition, trigger } from '@angular/animations';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { CharacterToken } from '@udonarium/character-token';
import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { UUID } from '@udonarium/core/system/util/uuid';
import { DataElement } from '@udonarium/data-element';
import { SortOrder } from '@udonarium/data-summary-setting';
import { GameCharacter } from '@udonarium/game-character';
import { PeerCursor } from '@udonarium/peer-cursor';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TableSelecter } from '@udonarium/table-selecter';
import { TabletopObject } from '@udonarium/tabletop-object';

import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { ConfirmationComponent, ConfirmationType } from 'component/confirmation/confirmation.component';
import { CharacterSettingsComponent } from 'component/character-settings/character-settings.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator, contextMenuToggleCheck } from 'service/context-menu.service';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SelectionState, TabletopSelectionService } from 'service/tabletop-selection.service';
import { CharacterFxMenuService } from 'service/character-fx-menu.service';
import { I18nService } from 'service/i18n.service';
import { TabletopActionService } from 'service/tabletop-action.service';
import { hasStatus } from '@udonarium/table-fx/character-status';
import { buildMatrixRainColumns, imageEffectFilter, imageEffectOpacity, imageEffectTransform, MatrixRainColumn } from '@udonarium/table-fx/image-effect';

@Component({
    selector: 'game-object-inventory',
    templateUrl: './game-object-inventory.component.html',
    styleUrls: ['../shared/settings-ui.css', '../shared/image-effects.css', './game-object-inventory.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        trigger('SlideInOut', [
            transition('void => *', [
                animate('200ms ease', keyframes([
                    style({ transform: 'translateX(60px)', opacity: 0, offset: 0 }),
                    style({ transform: 'translateX(0px)', opacity: 1, offset: 1.0 })
                ]))
            ]),
            transition('* => void', [
                animate('200ms ease', keyframes([
                    style({ transform: 'translateX(0px)', opacity: 1, offset: 0 }),
                    style({ transform: 'translateX(60px)', opacity: 0, offset: 1.0 })
                ]))
            ]),
            /*
            transition(':increment', [
              animate('200ms ease', keyframes([
                style({ transform: 'translateY(-150px)', opacity: 0, offset: 0 }),
                style({ transform: 'translateY(0px)', opacity: 1, offset: 1.0 })
              ]))
            ]),
            transition(':decrement', [
              animate('200ms ease', keyframes([
                style({ transform: 'translateY(150px)', opacity: 0, offset: 0 }),
                style({ transform: 'translateY(0px)', opacity: 1, offset: 1.0 })
              ]))
            ]),
            */
        ])
    ],
    standalone: false
})
export class GameObjectInventoryComponent implements OnInit, OnDestroy {
  inventoryTypes: string[] = ['all', 'table', 'common', 'graveyard'];

  _selectTab: string = 'all';
  get selectTab(): string { return this._selectTab; };
  set selectTab(selectTab: string) {
    this._selectTab = selectTab;
    this.selectionService.clear();
  };
  selectedIdentifier: string = '';
  dropTargetTab: string = '';

  panelId;

  isEdit: boolean = false;

  stringUtil = StringUtil;
  private sortStopTimerId = null;

  get sortTag(): string { return this.inventoryService.sortTag; }
  set sortTag(sortTag: string) { this.inventoryService.sortTag = sortTag; }
  get sortOrder(): SortOrder { return this.inventoryService.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.inventoryService.sortOrder = sortOrder; }
  get dataTag(): string { return this.inventoryService.dataTag; }
  set dataTag(dataTag: string) { this.inventoryService.dataTag = dataTag; }
  get dataTags(): string[] { return this.inventoryService.dataTags; }

  get indicateAll(): boolean { return this.inventoryService.indicateAll; }
  set indicateAll(indicateAll: boolean) { this.inventoryService.indicateAll = indicateAll; }

  get sortOrderName(): string { return this.sortOrder === SortOrder.ASC ? this.i18n.t('inv.sortAsc') : this.i18n.t('inv.sortDesc'); }

  //get newLineStrings(): string { return this.inventoryService.newLineStrings; }

  get isGMMode(): boolean{ return PeerCursor.myCursor ? PeerCursor.myCursor.isGMMode : false; }

  selectionState(tabletopObject: TabletopObject): SelectionState { return this.selectionService.state(tabletopObject); }
  checkSelected(tabletopObject: TabletopObject): boolean { return this.selectionState(tabletopObject) !== SelectionState.NONE; }
  checkMagnetic(tabletopObject: TabletopObject): boolean { return this.selectionState(tabletopObject) === SelectionState.MAGNETIC; }
  get newLineDataElement(): DataElement { return this.inventoryService.newLineDataElement; }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private inventoryService: GameObjectInventoryService,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private selectionService: TabletopSelectionService,
    private characterFxMenu: CharacterFxMenuService,
    private tabletopActionService: TabletopActionService,
    private i18n: I18nService,
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.refreshPanelTitle());
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', event => {
        if (ObjectStore.instance.get(event.data.identifier) instanceof TabletopObject) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        if (event.isSendFromSelf) this.changeDetector.markForCheck();
      })
      .on('UPDATE_INVENTORY', event => {
        if (event.isSendFromSelf || event.data) this.changeDetector.markForCheck();
      })
      .on('UPDATE_GAME_OBJECT', event => {
        if (ObjectStore.instance.get(event.data.identifier) instanceof GameCharacter) {
          this.changeDetector.markForCheck();
        }
      })
      .on('OPEN_NETWORK', event => {
        this.inventoryTypes = ['all', 'table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = 'all';
        }
      })
      .on('LOCALE_CHANGED', () => {
        this.refreshPanelTitle();
        this.changeDetector.markForCheck();
      })
      .on('INVENTORY_SELECT_ALL', () => {
        this.selectAllInCurrentTab();
      });
    this.inventoryTypes = ['all', 'table', 'common', Network.peerId, 'graveyard'];
    this.panelId = UUID.generateUuid();
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
    if (this.sortStopTimerId) clearTimeout(this.sortStopTimerId);
  }

  getTabTitle(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'all':
        return this.i18n.t('inv.tab.all');
      case 'table':
        return this.i18n.t('inv.tab.table');
      case Network.peerId:
        return this.i18n.t('inv.tab.personal');
      case 'graveyard':
        return this.i18n.t('inv.tab.graveyard');
      default:
        return this.i18n.t('inv.tab.common');
    }
  }

  getInventory(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'all':
        return this.inventoryService.allInventory;
      case 'table':
        return this.inventoryService.tableInventory;
      case Network.peerId:
        return this.inventoryService.privateInventory;
      case 'graveyard':
        return this.inventoryService.graveyardInventory;
      default:
        return this.inventoryService.commonInventory;
    }
  }

  getGameObjects(inventoryType: string): TabletopObject[] {
    return this.getInventory(inventoryType).tabletopObjects.filter((tabletopObject) => {
      if (inventoryType === 'all') return true;
      if (inventoryType !== 'table') return true;
      return this.indicateAll || tabletopObject.isInventoryIndicate;
    });
  }

  /** Body has Tokens on other maps but none on the current view. */
  isOnOtherTable(gameObject: TabletopObject): boolean {
    if (!(gameObject instanceof GameCharacter)) {
      return gameObject.location?.name === 'table' && !gameObject.isVisibleOnTable;
    }
    return CharacterToken.hasTokenOnlyOnOtherMaps(gameObject.identifier);
  }

  /** Body currently has a Token on the viewed map. */
  hasTokenOnView(gameObject: GameCharacter): boolean {
    return CharacterToken.tokensOnTable(gameObject.identifier).length > 0;
  }

  private placeBodyTokenOnView(gameObject: GameCharacter, temporary = false): CharacterToken {
    return CharacterToken.create(gameObject.identifier, undefined, { temporary });
  }

  getInventoryTags(gameObject: GameCharacter): DataElement[] {
    // Always resolve from allInventory: tableInventory only has the current map,
    // so other-map tokens in the All tab would otherwise get empty tags.
    return this.inventoryService.allInventory.dataElementMap.get(gameObject.identifier) || [];
  }

  /** Blank area: block browser menu (item menus call stopPropagation). */
  @HostListener('contextmenu', ['$event'])
  onHostContextMenu(e: Event) {
    e.preventDefault();
  }

  onContextMenu(event: Event, gameObject: GameCharacter) {
    event.stopPropagation();
    event.preventDefault();

    if (this.GuestMode()) return;
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.selectGameObject(gameObject);

    const target = <HTMLElement>event.target;
    let position;
    if (target && target.tagName === 'BUTTON') {
      const clientRect = target.getBoundingClientRect();
      position = {
        x: window.pageXOffset + clientRect.left + target.clientWidth,
        y: window.pageYOffset + clientRect.top
      };
    } else {
      position = this.pointerDeviceService.pointers[0];
    }

    let actions: ContextMenuAction[] = [];
    if (this.checkSelected(gameObject)) {
      let selectedCharacter = () => this.selectionService.objects.filter(object => object.aliasName === gameObject.aliasName) as GameCharacter[];
      let subActions: ContextMenuAction[] = [];
      if (this.selectTab != 'table') {
        subActions.push({
          name: this.i18n.t('char.moveAllToTable'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameCharacter.identifier });
              let isStealthMode = GameCharacter.isStealthMode;
              this.placeBodyTokenOnView(gameCharacter);
              this.selectionService.remove(gameCharacter);
              if (gameCharacter.isHideIn && gameCharacter.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
                this.modalService.open(ConfirmationComponent, {
                  title: this.i18n.t('char.stealthTitle'),
                  text: this.i18n.t('char.stealthText'),
                  help: this.i18n.t('char.stealthHelp'),
                  type: ConfirmationType.OK,
                  materialIcon: 'disabled_visible'
                });
              }
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab != 'common') {
        subActions.push({
          name: this.i18n.t('char.moveAllToCommon'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              this.moveCharacterToLocation(gameCharacter, 'common', { silent: true });
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab === 'all' || this.selectTab === 'table' || this.selectTab === 'common' || this.selectTab === 'graveyard') {
        subActions.push({
          name: this.i18n.t('char.moveAllToPersonal'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              this.moveCharacterToLocation(gameCharacter, Network.peerId, { silent: true });
            });
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      if (this.selectTab != 'graveyard') {
        subActions.push({
          name: this.i18n.t('char.moveAllToGraveyard'), action: () => {
            selectedCharacter().forEach(gameCharacter => {
              TabletopObject.disposeObject(gameCharacter, () => {
                this.moveCharacterToLocation(gameCharacter, 'graveyard', { silent: true });
              });
              this.selectionService.remove(gameCharacter);
            });
            SoundEffect.play(PresetSound.sweep);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        });
      }
      actions.push({
        name: this.i18n.t('char.selectedCharacters'),
        action: null,
        subActions: subActions
      });
      actions.push(ContextMenuSeparator);
    }

    const afterInv = () => EventSystem.trigger('UPDATE_INVENTORY', null);
    const imageCount = gameObject.imageFiles.length;
    const hasMultiImage = imageCount > 1;
    const hasFace = this.hasOverviewFaceIcon(gameObject);
    const fxHost = this.appearanceHost(gameObject);
    if (!hasFace && fxHost.isUseIconToOverviewImage) {
      fxHost.mutateAppearance(() => { fxHost.isUseIconToOverviewImage = false; });
    }
    const inGraveyard = gameObject.location.name === 'graveyard';
    const is2D = !!TableSelecter.instance?.viewTable?.is2DMode;
    const canEdit = gameObject.isVisible || this.isGMMode;

    this.tabletopActionService.ensureObjectSelected(gameObject);

    const advancedCopy: ContextMenuAction = {
      name: this.i18n.t('char.copyAdvanced'),
      action: null,
      disabled: !canEdit,
      subActions: [
        {
          name: this.i18n.t('char.createTemporaryCopy'),
          action: () => { this.createTemporaryCopy(gameObject); },
          disabled: !canEdit,
        },
        {
          name: this.i18n.t('char.cloneToken'),
          action: () => {
            const appearance = this.appearanceHost(gameObject);
            const pose = appearance.getPoseForView
              ? appearance.getPoseForView()
              : { x: gameObject.location.x, y: gameObject.location.y, posZ: gameObject.posZ };
            const names = ObjectStore.instance.getObjects(CharacterToken)
              .filter(t => t.characterId === gameObject.identifier)
              .map(t => t.displayNameOverride || gameObject.name);
            names.push(gameObject.name);
            const token = CharacterToken.create(gameObject.identifier, {
              x: (pose.x || 0) + 50,
              y: (pose.y || 0) + 50,
              posZ: pose.posZ || 0,
            }, { copyAppearanceFrom: appearance as any, major: false });
            if (GameCharacter.menuCloneAutoNumber) {
              token.displayNameOverride = GameCharacter.nextNumberedName(gameObject.name, names);
              token.update();
            }
            SoundEffect.play(PresetSound.piecePut);
            EventSystem.call('UPDATE_INVENTORY', true);
          },
          disabled: !canEdit,
        },
        {
          name: this.i18n.t('char.cloneCharacter'),
          action: () => {
            this.cloneCharacterBody(gameObject, GameCharacter.menuCloneAutoNumber);
            SoundEffect.play(PresetSound.piecePut);
          },
          disabled: !canEdit,
        },
        contextMenuToggleCheck({
          get: () => GameCharacter.menuCloneAutoNumber,
          set: (v) => { GameCharacter.menuCloneAutoNumber = v; },
          on: this.i18n.t('char.cloneAutoNumberOn'),
          off: this.i18n.t('char.cloneAutoNumberOff'),
        }),
      ],
    };

    const deleteAction: ContextMenuAction = inGraveyard ? {
      name: this.i18n.t('char.deleteForever'),
      action: () => {
        this.selectionService.remove(gameObject);
        this.deleteGameObject(gameObject);
        SoundEffect.play(PresetSound.sweep);
      }
    } : {
      name: gameObject.isTemporaryCopy
        ? this.i18n.t('char.deleteTemporaryCopy')
        : this.i18n.t('char.deleteToGraveyard'),
      action: () => {
        EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
        this.selectionService.remove(gameObject);
        if (gameObject.isTemporaryCopy) {
          this.deleteGameObject(gameObject);
        } else {
          this.moveCharacterToLocation(gameObject, 'graveyard', { silent: true });
        }
        SoundEffect.play(PresetSound.sweep);
        EventSystem.call('UPDATE_INVENTORY', true);
      }
    };

    const placement: (ContextMenuAction | null)[] = [
      (this.hasTokenOnView(gameObject) && canEdit) ? {
        name: this.i18n.t('char.findOnTable'),
        action: () => {
          const tok = CharacterToken.focusTokenForCharacter(gameObject.identifier);
          if (tok) {
            EventSystem.trigger('FOCUS_TABLETOP_OBJECT', {
              x: tok.location.x,
              y: tok.location.y,
              z: tok.posZ + (tok.altitude > 0 ? tok.altitude * 50 : 0),
            });
          }
        },
        default: true,
        disabled: !this.hasTokenOnView(gameObject),
        selfOnly: true
      } : null,
      (this.isOnOtherTable(gameObject) && canEdit) ? {
        name: this.i18n.t('inv.placeOnCurrentMap'),
        action: () => {
          this.placeBodyTokenOnView(gameObject);
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (this.isOnOtherTable(gameObject) && canEdit) ? {
        name: this.i18n.t('inv.moveToCurrentMapOnly'),
        action: () => {
          CharacterToken.removeTokensOnTable(gameObject.identifier);
          if (gameObject.location.name === 'table') gameObject.removeFromTable();
          this.placeBodyTokenOnView(gameObject);
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (this.hasTokenOnView(gameObject) && canEdit) ? {
        name: this.i18n.t('inv.removeFromCurrentMap'),
        action: () => {
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          CharacterToken.removeTokensOnTable(gameObject.identifier);
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
      (!this.hasTokenOnView(gameObject) && gameObject.location.name != 'graveyard' && canEdit) ? {
        name: this.i18n.t('char.moveToTable'),
        action: () => {
          let isStealthMode = GameCharacter.isStealthMode;
          EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
          this.placeBodyTokenOnView(gameObject);
          this.selectionService.remove(gameObject);
          if (gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
            this.modalService.open(ConfirmationComponent, {
              title: this.i18n.t('char.stealthTitle'),
              text: this.i18n.t('char.stealthText'),
              help: this.i18n.t('char.stealthHelp'),
              type: ConfirmationType.OK,
              materialIcon: 'disabled_visible'
            });
          }
          SoundEffect.play(PresetSound.piecePut);
          EventSystem.call('UPDATE_INVENTORY', true);
        }
      } : null,
    ];

    const identity: (ContextMenuAction | null)[] = [
      (() => {
        const stealthHost = this.appearanceHost(gameObject);
        const isHidden = !!stealthHost.owner || !!(stealthHost as GameCharacter).isHideIn;
        if (isHidden) {
          return {
            name: this.i18n.t('char.revealPosition'),
            action: () => {
              stealthHost.owner = '';
              SoundEffect.play(PresetSound.piecePut);
              EventSystem.trigger('UPDATE_INVENTORY', null);
            }
          };
        }
        return {
          name: this.i18n.t('char.selfOnlyStealth'),
          action: () => {
            const onTable = stealthHost instanceof CharacterToken
              ? stealthHost.isVisibleOnTable
              : gameObject.isVisibleOnTable;
            if (onTable && !GameCharacter.isStealthMode && !PeerCursor.myCursor.isGMMode) {
              this.modalService.open(ConfirmationComponent, {
                title: this.i18n.t('char.stealthTitle'),
                text: this.i18n.t('char.stealthText'),
                help: this.i18n.t('char.stealthHelp'),
                type: ConfirmationType.OK,
                materialIcon: 'disabled_visible'
              });
            }
            stealthHost.owner = Network.peer.userId;
            if (!gameObject.visionOwner) gameObject.visionOwner = Network.peer.userId;
            SoundEffect.play(PresetSound.sweep);
            EventSystem.call('UPDATE_INVENTORY', true);
          }
        };
      })(),
      this.characterFxMenu.makeMyTokenMenu(gameObject),
      this.characterFxMenu.makeCombatMenu(gameObject),
    ];

    const tokenSettings: ContextMenuAction = {
      name: this.i18n.t('char.tokenSettings'),
      action: null,
      subActions: [
        ...(is2D ? [] : [
          contextMenuToggleCheck({
            get: () => !fxHost.isNotRide,
            set: (v) => { fxHost.isNotRide = !v; },
            on: this.i18n.t('char.stackOn'),
            off: this.i18n.t('char.stackOff'),
            after: afterInv,
          }),
          contextMenuToggleCheck({
            get: () => fxHost.isAltitudeIndicate,
            set: (v) => { fxHost.mutateAppearance(() => { fxHost.isAltitudeIndicate = v; }); },
            on: this.i18n.t('char.altitudeOn'),
            off: this.i18n.t('char.altitudeOff'),
            after: afterInv,
          }),
        ]),
        contextMenuToggleCheck({
          get: () => fxHost.isDropShadow,
          set: (v) => { fxHost.mutateAppearance(() => { fxHost.isDropShadow = v; }); },
          on: this.i18n.t('char.shadowOn'),
          off: this.i18n.t('char.shadowOff'),
          after: afterInv,
        }),
        contextMenuToggleCheck({
          get: () => hasFace && fxHost.isUseIconToOverviewImage,
          set: (v) => {
            if (!this.hasOverviewFaceIcon(gameObject)) return;
            fxHost.mutateAppearance(() => { fxHost.isUseIconToOverviewImage = v; });
          },
          on: this.i18n.t('char.overviewFaceOn'),
          off: this.i18n.t('char.overviewFaceOff'),
          after: afterInv,
          disabled: !hasFace,
          error: hasFace ? null : this.i18n.t('char.overviewFaceRequired'),
        }),
        contextMenuToggleCheck({
          get: () => fxHost.isShowChatBubble,
          set: (v) => { fxHost.mutateAppearance(() => { fxHost.isShowChatBubble = v; }); },
          on: this.i18n.t('char.chatBubbleOn'),
          off: this.i18n.t('char.chatBubbleOff'),
          tip: this.i18n.t('char.chatBubbleTip'),
          after: afterInv,
        }),
        contextMenuToggleCheck({
          get: () => gameObject.isAllowsChat,
          set: (v) => { gameObject.isAllowsChat = v; },
          on: this.i18n.t('char.chatOn'),
          off: this.i18n.t('char.chatOff'),
          after: afterInv,
          disabled: inGraveyard,
        }),
      ],
    };

    const appearanceFx: ContextMenuAction = {
      name: this.i18n.t('char.appearanceFx'),
      action: null,
      ...(is2D ? {} : { altitudeHande: fxHost }),
      subActions: [
        this.characterFxMenu.makeImageEffectMenu(fxHost),
        this.characterFxMenu.makeAuraMenu(fxHost),
        this.characterFxMenu.makeRingMenu(fxHost),
        ...(is2D ? [
          this.characterFxMenu.makeTokenFrameMenu(fxHost),
          this.characterFxMenu.makePushPinMenu(fxHost),
        ] : []),
        this.characterFxMenu.makeClueLinkMenu(fxHost),
        this.characterFxMenu.makeStatusMenu(gameObject),
      ],
    };

    const locations = [
      { name: 'table', aliasKey: 'char.table' },
      { name: 'common', aliasKey: 'char.commonInventory' },
      { name: Network.peerId, aliasKey: 'char.personalInventory' },
      { name: 'graveyard', aliasKey: 'char.graveyard' }
    ];

    let menu = this.joinContextMenuGroups([
      [
        advancedCopy,
        {
          name: this.i18n.t('char.moveFrom', { from: this.i18n.t((locations.find((location) => { return location.name == gameObject.location.name }) || locations[1]).aliasKey) }),
          action: null,
          subActions: locations
            .filter((location, i) => { return !(gameObject.location.name == location.name || (i == 1 && !locations.map(loc => loc.name).includes(gameObject.location.name))) })
            .map((location) => ({
              name: this.i18n.t(location.aliasKey),
              action: () => {
                this.moveCharacterToLocation(gameObject, location.name);
              }
            })),
          disabled: !canEdit
        },
        deleteAction,
      ],
      placement,
      identity,
      [
        hasMultiImage ? {
          name: this.i18n.t('char.nextImage'),
          action: () => {
            const next = (gameObject.currntImageIndex + 1) % gameObject.imageFiles.length;
            gameObject.currntImageIndex = next;
            if (!gameObject.isHideIn && gameObject.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
        } : null,
        imageCount > 2 ? {
          name: this.i18n.t('char.imageSwitch'),
          action: null,
          subActions: gameObject.imageFiles.map((image, i) => ({
            name: `${gameObject.currntImageIndex == i ? '◉' : '○'}`,
            action: () => {
              gameObject.currntImageIndex = i;
              if (!gameObject.isHideIn && gameObject.isVisibleOnTable) SoundEffect.play(PresetSound.surprise);
              EventSystem.trigger('UPDATE_INVENTORY', null);
            },
            default: gameObject.currntImageIndex == i,
            icon: image,
            checkBox: 'radio' as const
          })),
        } : null,
      ],
      [
        { name: this.i18n.t('char.showDetail'), action: () => { this.showDetail(gameObject); } },
        { name: this.i18n.t('char.showChatPalette'), action: () => { this.showChatPalette(gameObject); }, disabled: !gameObject.isAllowsChat || inGraveyard },
        { name: this.i18n.t('char.standSetting'), action: () => { this.showStandSetting(gameObject); }, disabled: !gameObject.isAllowsChat || inGraveyard },
        ...gameObject.getUrls().map((urlElement) => {
          const url = urlElement.value.toString();
          return {
            name: urlElement.name ? urlElement.name : url,
            action: () => {
              if (StringUtil.sameOrigin(url)) {
                window.open(url.trim(), '_blank', 'noopener');
              } else {
                this.modalService.open(OpenUrlComponent, { url: url, title: gameObject.name, subTitle: urlElement.name });
              }
            },
            disabled: !StringUtil.validUrl(url),
            error: !StringUtil.validUrl(url) ? this.i18n.t('char.invalidUrl') : null,
            isOuterLink: StringUtil.validUrl(url) && !StringUtil.sameOrigin(url)
          };
        }),
      ],
      [appearanceFx, tokenSettings],
      [
        contextMenuToggleCheck({
          get: () => gameObject.isInventoryIndicate,
          set: (v) => { gameObject.isInventoryIndicate = v; },
          on: this.i18n.t('char.inventoryOn'),
          off: this.i18n.t('char.inventoryOff'),
          after: afterInv,
        }),
        this.characterFxMenu.makeVisionMenu(fxHost),
      ],
    ]);

    menu = this.tabletopActionService.withClipboardMenuPrefix(menu);
    actions = actions.concat(menu);
    this.contextMenuService.open(position, actions, gameObject.name);
  }

  /** Flatten menu groups with a single separator between non-empty groups. */
  private joinContextMenuGroups(groups: (ContextMenuAction | null)[][]): ContextMenuAction[] {
    const out: ContextMenuAction[] = [];
    for (const group of groups) {
      const items = group.filter((a): a is ContextMenuAction => !!a);
      if (!items.length) continue;
      if (out.length) out.push(ContextMenuSeparator);
      out.push(...items);
    }
    return out;
  }

  toggleEdit() {
    this.isEdit = !this.isEdit;
  }

  cleanInventory() {
    if (this.GuestMode()) return;
    let tabTitle = this.getTabTitle(this.selectTab);
    let gameObjects = this.getGameObjects(this.selectTab);
    this.modalService.open(ConfirmationComponent, {
      title: this.i18n.t('char.emptyGraveyardTitle'),
      text: this.i18n.t('char.emptyGraveyardText'),
      helpHtml: this.i18n.t('char.emptyGraveyardHelp', { tab: StringUtil.escapeHtml(tabTitle), count: gameObjects.length }),
      type: ConfirmationType.OK_CANCEL,
      materialIcon: 'delete_forever',
      action: () => {
        for (const gameObject of gameObjects) {
          this.deleteGameObject(gameObject);
        }
        SoundEffect.play(PresetSound.sweep);
      }
    });
  }

  private cloneCharacterBody(gameObject: GameCharacter, numbered = false) {
    if (this.GuestMode()) return;
    const appearance = this.appearanceHost(gameObject);
    const pose = appearance.getPoseForView
      ? appearance.getPoseForView()
      : { x: gameObject.location.x, y: gameObject.location.y, posZ: gameObject.posZ };
    GameCharacter.cloneCharacter(gameObject, {
      numbered,
      pose: {
        x: (pose.x || 0) + 50,
        y: (pose.y || 0) + 50,
        posZ: pose.posZ || 0,
      },
      copyAppearanceFrom: appearance as any,
    });
    EventSystem.call('UPDATE_INVENTORY', true);
  }

  private createTemporaryCopy(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const pose = gameObject.getPoseForView();
    GameCharacter.createTemporaryCopy(gameObject, {
      x: pose.x + 50,
      y: pose.y + 50,
      posZ: pose.posZ,
    });
    SoundEffect.play(PresetSound.piecePut);
    EventSystem.call('UPDATE_INVENTORY', true);
  }

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let title = this.i18n.t('char.sheetTitle');
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    const tourId = PanelService.tourIdObjectDetail(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId, { title })) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = {
      title: title, left: coordinate.x - 270, top: coordinate.y - 240, width: 540, height: 480,
      tourPanelId: tourId,
      geometryKey: PanelService.sheetGeometryKey(gameObject.aliasName),
    };
    let component = this.panelService.open<CharacterSettingsComponent>(CharacterSettingsComponent, option);
    component.character = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const tourId = PanelService.tourIdChatPalette(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350, tourPanelId: tourId };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  selectGameObject(gameObject: GameObject, e: Event=null) {
    if (this.GuestMode()) return;
    if (!(gameObject instanceof TabletopObject)) return;
    if (e && e instanceof MouseEvent && e.shiftKey) {
      SoundEffect.playLocal(PresetSound.selectionStart);
      // Seed primary highlight into the set so Shift-extend keeps the first pick.
      if (this.selectionService.size === 0 && this.selectedIdentifier) {
        const primary = ObjectStore.instance.get(this.selectedIdentifier);
        if (primary instanceof TabletopObject && primary !== gameObject) {
          this.selectionService.add(primary);
        }
      }
      if (this.checkSelected(gameObject)) {
        this.selectionService.remove(gameObject);
      } else {
        EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName, highlighting: true });
        this.selectionService.add(gameObject);
      }
    } else {
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName, highlighting: true });
      if (!this.checkSelected(gameObject)) {
        this.selectionService.clear();
        this.selectionService.add(gameObject);
      }
    }
  }

  private selectAllInCurrentTab() {
    if (this.GuestMode()) return;
    const objects = this.getGameObjects(this.selectTab);
    this.selectionService.clear();
    let first: GameCharacter = null;
    for (const obj of objects) {
      if (!(obj instanceof GameCharacter)) continue;
      if (!obj.isVisible && !this.isGMMode) continue;
      this.selectionService.add(obj);
      if (!first) first = obj;
    }
    if (first) {
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', {
        identifier: first.identifier,
        className: first.aliasName,
        highlighting: true,
      });
      this.selectedIdentifier = first.identifier;
      SoundEffect.playLocal(PresetSound.selectionStart);
    }
    this.changeDetector.markForCheck();
  }

  focusGameObject(gameObject: GameCharacter, e: Event) {
    if (!(e.target instanceof HTMLElement)) return;
    if (new Set(['input', 'button']).has(e.target.tagName.toLowerCase())) return;
    if (e instanceof MouseEvent && e.shiftKey) return;
    if (!gameObject.isVisibleOnTable || (!gameObject.isVisible && !this.isGMMode)) return;
    EventSystem.trigger('FOCUS_TABLETOP_OBJECT', { x: gameObject.location.x + gameObject.size * 50 / 2, y: gameObject.location.y + gameObject.size * 50 / 2, z: gameObject.posZ + (gameObject.altitude > 0 ? gameObject.altitude * 50 : 0) });
  }

  invImageFilter(gameObject: GameCharacter): string | null {
    const host = this.appearanceHost(gameObject);
    return imageEffectFilter({
      ...host,
      isDead: hasStatus(gameObject.statusesJson, 'dead'),
    });
  }
  invImageOpacity(gameObject: GameCharacter): number | null {
    return imageEffectOpacity(this.appearanceHost(gameObject));
  }
  invImageTransform(gameObject: GameCharacter): string | null {
    return imageEffectTransform(this.appearanceHost(gameObject));
  }

  private _invMatrixRain = new Map<string, MatrixRainColumn[]>();
  invMatrixRainColumns(gameObject: GameCharacter): MatrixRainColumn[] {
    const host = this.appearanceHost(gameObject);
    if (!host?.isMatrix) return [];
    const key = host.identifier;
    let cols = this._invMatrixRain.get(key);
    if (!cols) {
      cols = buildMatrixRainColumns(`inv:${key}`, 5, 10);
      this._invMatrixRain.set(key, cols);
    }
    return cols;
  }
  trackByMatrixCol = (_: number, col: MatrixRainColumn) => `${col.duration}:${col.delay}:${col.text.length}`;

  hasOverviewFaceIcon(gameObject: TabletopObject): boolean {
    return !!(gameObject?.faceIcon && 0 < gameObject.faceIcon.url.length);
  }

  overviewFaceIconTitle(gameObject: TabletopObject): string {
    if (!this.hasOverviewFaceIcon(gameObject)) return this.i18n.t('char.overviewFaceHintNeed');
    return this.i18n.t('char.overviewFaceHint');
  }

  /** Map Token cosmetics when present; otherwise the sheet (seed / off-map). */
  appearanceHost(gameObject: GameCharacter): GameCharacter | CharacterToken {
    return CharacterToken.appearanceHostFor(gameObject) || gameObject;
  }

  /** Stealth / hide-in for inventory row chrome (Token host after legacy migrate). */
  invIsHideIn(gameObject: GameCharacter): boolean {
    const host = this.appearanceHost(gameObject);
    return !!host.owner || !!(host as GameCharacter).isHideIn;
  }

  /** Owner tag only when an owner id exists (not merely hide-in / empty PeerCursor name). */
  invHasOwnerTag(gameObject: GameCharacter): boolean {
    const host = this.appearanceHost(gameObject);
    return !!(host?.owner && host.owner.length);
  }

  /** Owner label from appearance host; always a string for template .length safety. */
  invOwnerName(gameObject: GameCharacter): string {
    const host = this.appearanceHost(gameObject) as any;
    return host?.ownerName || '';
  }

  invOwnerColor(gameObject: GameCharacter): string {
    const host = this.appearanceHost(gameObject) as any;
    return host?.ownerColor || '#444444';
  }

  toggleOverviewFaceIcon(gameObject: GameCharacter) {
    const host = this.appearanceHost(gameObject);
    if (!this.hasOverviewFaceIcon(gameObject)) {
      host.mutateAppearance(() => { host.isUseIconToOverviewImage = false; });
      return;
    }
    host.mutateAppearance(() => {
      host.isUseIconToOverviewImage = !host.isUseIconToOverviewImage;
    });
  }

  /** Toggle a per-map SyncVar from the template (Angular templates cannot parse arrow blocks). */
  togglePlacementFlag(gameObject: GameCharacter, key: 'isShowChatBubble' | 'isDropShadow' | 'isAltitudeIndicate') {
    const host = this.appearanceHost(gameObject);
    host.mutateAppearance(() => { (host as any)[key] = !(host as any)[key]; });
  }

  toggleNotRide(gameObject: GameCharacter) {
    const host = this.appearanceHost(gameObject);
    host.isNotRide = !host.isNotRide;
  }

  /** Footprint fields (size/altitude/…) stay per-map via mutateAppearance. */
  writeInventoryDataElm(el: DataElement, value: any) {
    TabletopObject.writeDataElementValue(el, value);
  }

  /** Characters can be dragged to table / common / personal / graveyard. */
  canDragInventory(gameObject: GameCharacter): boolean {
    if (this.GuestMode() || !(gameObject instanceof GameCharacter)) return false;
    return gameObject.isVisible || this.isGMMode;
  }

  /** True after pointerdown on a bar/input — next dragstart must be cancelled. */
  private inventoryDragBlocked = false;

  /** Stop panel appDraggable from treating this as a window move. */
  onInventoryDragGestureStart(e: Event, gameObject: GameCharacter) {
    this.inventoryDragBlocked = this.isInventoryUiControl(e.target);
    if (!this.canDragInventory(gameObject) || this.inventoryDragBlocked) return;
    e.stopPropagation();
  }

  onInventoryDragStart(e: DragEvent, gameObject: GameCharacter) {
    // Range/HP bars and other controls must not start a token DnD.
    if (this.inventoryDragBlocked || this.isInventoryUiControl(e.target)) {
      this.inventoryDragBlocked = false;
      e.preventDefault();
      return;
    }
    if (!this.canDragInventory(gameObject) || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();

    // Dragging an unselected row: switch selection to that token only (do not drag prior picks).
    if (!this.checkSelected(gameObject)) {
      this.selectionService.clear();
      this.selectionService.add(gameObject);
      this.selectedIdentifier = gameObject.identifier;
      EventSystem.trigger('SELECT_TABLETOP_OBJECT', {
        identifier: gameObject.identifier,
        className: gameObject.aliasName,
        highlighting: true,
      });
      this.changeDetector.markForCheck();
    }

    const tempCopy = !!(e.ctrlKey || e.metaKey);
    const ids = this.inventoryDragIdentifiers(gameObject);
    const payload = ids.join(',');
    e.dataTransfer.setData(GameCharacter.INVENTORY_DRAG_MIME, payload);
    e.dataTransfer.setData('text/plain', `udonarium-character:${payload}`);
    if (tempCopy) {
      e.dataTransfer.setData(GameCharacter.INVENTORY_TEMP_COPY_MIME, '1');
      e.dataTransfer.effectAllowed = 'copy';
    } else {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  /** Multi-drag only when the dragged row is already in the selection set (≥2). */
  private inventoryDragIdentifiers(gameObject: GameCharacter): string[] {
    if (!this.checkSelected(gameObject)) return [gameObject.identifier];
    const selected = this.selectionService.objects
      .filter((o): o is GameCharacter => o instanceof GameCharacter && o.aliasName === gameObject.aliasName)
      .filter(ch => this.canDragInventory(ch))
      .map(ch => ch.identifier);
    if (selected.length < 2 || !selected.includes(gameObject.identifier)) {
      return [gameObject.identifier];
    }
    // Keep the dragged row first so drop offsets stay predictable.
    return [gameObject.identifier, ...selected.filter(id => id !== gameObject.identifier)];
  }

  onInventoryDragEnd() {
    this.inventoryDragBlocked = false;
    this.dropTargetTab = '';
    this.changeDetector.markForCheck();
  }

  /** Inputs / bars / buttons keep normal interaction; rest of the row can DnD the token. */
  private isInventoryUiControl(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'input, button, select, textarea, a, label, .resource-tag, .tag-value-box, .tag-value, .resource-value'
    );
  }

  onInventoryTabDragOver(e: DragEvent, inventoryType: string) {
    if (inventoryType === 'all') return;
    if (!this.readInventoryDragIds(e).length) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (this.dropTargetTab !== inventoryType) {
      this.dropTargetTab = inventoryType;
      this.changeDetector.markForCheck();
    }
  }

  onInventoryTabDragLeave(e: DragEvent, inventoryType: string) {
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as Node | null;
    if (related && current && current.contains(related)) return;
    if (this.dropTargetTab === inventoryType) {
      this.dropTargetTab = '';
      this.changeDetector.markForCheck();
    }
  }

  onInventoryTabDrop(e: DragEvent, inventoryType: string) {
    const ids = this.readInventoryDragIds(e);
    this.dropTargetTab = '';
    if (!ids.length || ids[0] === '__pending__') return;
    if (inventoryType === 'all') return;
    e.preventDefault();
    e.stopPropagation();
    if (this.GuestMode()) return;
    let moved = 0;
    for (const id of ids) {
      const ch = ObjectStore.instance.get(id);
      if (!(ch instanceof GameCharacter)) continue;
      if (!ch.isVisible && !this.isGMMode) continue;
      if (ch.location?.name === inventoryType) {
        // Same location name, but other-map tokens still need rebinding to the current view table.
        if (inventoryType === 'table' && this.isOnOtherTable(ch)) {
          // fall through → place on current map
        } else if (inventoryType !== 'table' && !ch.isInventoryForCurrentView()) {
          // fall through → rebind inventory to current map
        } else {
          continue;
        }
      }
      this.moveCharacterToLocation(ch, inventoryType, { silent: true });
      moved++;
    }
    if (moved > 0) {
      SoundEffect.play(inventoryType === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
      EventSystem.call('UPDATE_INVENTORY', true);
      if (this.selectTab !== inventoryType) this.selectTab = inventoryType;
    }
    this.changeDetector.markForCheck();
  }

  private moveCharacterToLocation(gameObject: GameCharacter, location: string, opts?: { silent?: boolean }) {
    const isStealthMode = GameCharacter.isStealthMode;
    EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
    if (location === 'table') {
      this.placeBodyTokenOnView(gameObject);
    } else if (location === 'graveyard') {
      // setLocation('graveyard') cascades Token destroy; clear view tokens first is redundant but safe.
      CharacterToken.destroyTokensForCharacter(gameObject.identifier);
      if (gameObject.location.name === 'table') {
        gameObject.leaveCurrentTable('graveyard');
      } else {
        const viewId = TabletopObject.resolveViewTableIdentifier() || '';
        gameObject.setLocation('graveyard', viewId || undefined);
      }
    } else if (this.hasTokenOnView(gameObject) || gameObject.location.name === 'table') {
      CharacterToken.removeTokensOnTable(gameObject.identifier);
      if (gameObject.location.name === 'table') {
        gameObject.leaveCurrentTable(location);
      } else {
        const viewId = TabletopObject.resolveViewTableIdentifier() || '';
        gameObject.setLocation(location, viewId || undefined);
      }
    } else {
      // Off-table → off-table (or rebind to current map's inventory).
      const viewId = TabletopObject.resolveViewTableIdentifier() || '';
      gameObject.setLocation(location, viewId || undefined);
    }
    this.selectionService.remove(gameObject);
    if (location === 'table' && gameObject.isHideIn && gameObject.isVisible && !isStealthMode && !PeerCursor.myCursor.isGMMode) {
      this.modalService.open(ConfirmationComponent, {
        title: this.i18n.t('char.stealthTitle'),
        text: this.i18n.t('char.stealthText'),
        help: this.i18n.t('char.stealthHelp'),
        type: ConfirmationType.OK,
        materialIcon: 'disabled_visible'
      });
    }
    if (!opts?.silent) {
      SoundEffect.play(location === 'graveyard' ? PresetSound.sweep : PresetSound.piecePut);
      EventSystem.call('UPDATE_INVENTORY', true);
    }
  }

  private readInventoryDragIds(e: DragEvent): string[] {
    if (!e.dataTransfer) return [];
    const typed = e.dataTransfer.getData(GameCharacter.INVENTORY_DRAG_MIME);
    if (typed) return this.parseInventoryDragPayload(typed);
    if (e.type === 'dragover') {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes(GameCharacter.INVENTORY_DRAG_MIME) || types.includes('text/plain')) {
        return ['__pending__'];
      }
      return [];
    }
    const plain = e.dataTransfer.getData('text/plain') || '';
    const m = /^udonarium-character:(.+)$/.exec(plain);
    return m ? this.parseInventoryDragPayload(m[1]) : [];
  }

  private parseInventoryDragPayload(payload: string): string[] {
    return payload.split(',').map(s => s.trim()).filter(Boolean);
  }

  private deleteGameObject(gameObject: GameObject) {
    if (this.GuestMode()) return;
    gameObject.destroy();
    this.changeDetector.markForCheck();
  }

  private showStandSetting(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    const tourId = PanelService.tourIdStandSetting(gameObject.identifier);
    if (PanelService.bringTourPanelToFront(tourId)) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 690, height: 540, tourPanelId: tourId };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = gameObject;
  }

  trackByGameObject(index: number, gameObject: GameObject) {
    return gameObject ? gameObject.identifier : index;
  }

  openUrl(url, title=null, subTitle=null) {
    if (StringUtil.sameOrigin(url)) {
      window.open(url.trim(), '_blank', 'noopener');
    } else {
      this.modalService.open(OpenUrlComponent, { url: url, title: title, subTitle: subTitle });
    }
    return false;
  }

  onInput() {
    this.inventoryService.sortStop = true;
    if (this.sortStopTimerId) clearTimeout(this.sortStopTimerId);
    this.sortStopTimerId = setTimeout(() => {
      this.inventoryService.sortStop = false;
    }, 666);
  }

  private refreshPanelTitle() {
    this.panelService.title = this.i18n.t('inv.title');
  }

  suggestWords(): string[] {
    return ['name', 'size'].concat([...new Set(this.inventoryService.dataTags)].filter(dataTag => dataTag != '/' && dataTag != '／').sort());
  }
}
