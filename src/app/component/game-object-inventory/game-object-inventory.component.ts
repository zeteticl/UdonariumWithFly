import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { GameObject } from '@udonarium/core/synchronize-object/game-object';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { StringUtil } from '@udonarium/core/system/util/string-util';
import { DataElement } from '@udonarium/data-element';
import { SortOrder } from '@udonarium/data-summary-setting';
import { GameCharacter } from '@udonarium/game-character';
import { PresetSound, SoundEffect } from '@udonarium/sound-effect';
import { TabletopObject } from '@udonarium/tabletop-object';

import { ChatPaletteComponent } from 'component/chat-palette/chat-palette.component';
import { GameCharacterSheetComponent } from 'component/game-character-sheet/game-character-sheet.component';
import { OpenUrlComponent } from 'component/open-url/open-url.component';
import { StandSettingComponent } from 'component/stand-setting/stand-setting.component';
import { ContextMenuAction, ContextMenuService, ContextMenuSeparator } from 'service/context-menu.service';
import { GameObjectInventoryService } from 'service/game-object-inventory.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { DiceBot } from '@udonarium/dice-bot';

@Component({
  selector: 'game-object-inventory',
  templateUrl: './game-object-inventory.component.html',
  styleUrls: ['./game-object-inventory.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GameObjectInventoryComponent implements OnInit, AfterViewInit, OnDestroy {
  inventoryTypes: string[] = ['table', 'common', 'graveyard'];

  selectTab: string = 'table';
  selectedIdentifier: string = '';

  isEdit: boolean = false;

  get sortTag(): string { return this.inventoryService.sortTag; }
  set sortTag(sortTag: string) { this.inventoryService.sortTag = sortTag; }
  get sortOrder(): SortOrder { return this.inventoryService.sortOrder; }
  set sortOrder(sortOrder: SortOrder) { this.inventoryService.sortOrder = sortOrder; }
  get dataTag(): string { return this.inventoryService.dataTag; }
  set dataTag(dataTag: string) { this.inventoryService.dataTag = dataTag; }
  get dataTags(): string[] { return this.inventoryService.dataTags; }

  get indicateAll(): boolean { return this.inventoryService.indicateAll; }
  set indicateAll(indicateAll: boolean) { this.inventoryService.indicateAll = indicateAll; }

  get diceBotInfos() { return DiceBot.diceBotInfos }
  get gameType(): string { return this.inventoryService.gameType; }
  set gameType(gameType: string) { this.inventoryService.gameType = gameType; }


  get sortOrderName(): string { return this.sortOrder === SortOrder.ASC ? '昇順' : '降順'; }

  get newLineString(): string { return this.inventoryService.newLineString; }

  constructor(
    private changeDetector: ChangeDetectorRef,
    private panelService: PanelService,
    private inventoryService: GameObjectInventoryService,
    private contextMenuService: ContextMenuService,
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService
  ) { }
  GuestMode() {
    return Network.GuestMode();
  }
  ngOnInit() {
    Promise.resolve().then(() => this.panelService.title = '倉庫');
    EventSystem.register(this)
      .on('SELECT_TABLETOP_OBJECT', -1000, event => {
        if (ObjectStore.instance.get(event.data.identifier) instanceof TabletopObject) {
          this.selectedIdentifier = event.data.identifier;
          this.changeDetector.markForCheck();
        }
      })
      .on('SYNCHRONIZE_FILE_LIST', event => {
        if (event.isSendFromSelf) this.changeDetector.markForCheck();
      })
      .on('UPDATE_INVENTORY', event => {
        if (event.isSendFromSelf) this.changeDetector.markForCheck();
      })
      .on('OPEN_NETWORK', event => {
        this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
        if (!this.inventoryTypes.includes(this.selectTab)) {
          this.selectTab = Network.peerId;
        }
      });
    this.inventoryTypes = ['table', 'common', Network.peerId, 'graveyard'];
  }

  ngAfterViewInit() {
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  getTabTitle(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
      case 'table':
        return '桌面';
      case Network.peerId:
        return '個人';
      case 'graveyard':
        return '墓場';
      default:
        return '共有';
    }
  }

  getInventory(inventoryType: string) {
    if (this.GuestMode()) return;
    switch (inventoryType) {
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
    return this.getInventory(inventoryType).tabletopObjects.filter((tabletopObject) => { return inventoryType != 'table' || this.indicateAll || tabletopObject.isInventoryIndicate });
  }

  getInventoryTags(gameObject: GameCharacter): DataElement[] {
    return this.getInventory(gameObject.location.name).dataElementMap.get(gameObject.identifier);
  }

  onContextMenu(e: Event, gameObject: GameCharacter) {
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.getAttribute('type') !== 'range') return;
    e.stopPropagation();
    e.preventDefault();
    if (this.GuestMode()) return;
    if (!this.pointerDeviceService.isAllowedToOpenContextMenu) return;

    this.selectGameObject(gameObject);

    let position = this.pointerDeviceService.pointers[0];

    let actions: ContextMenuAction[] = [];
    if (gameObject.imageFiles.length > 1) {
      actions.push({
        name: '圖片切換',
        action: null,
        subActions: gameObject.imageFiles.map((image, i) => {
          return {
            name: `${gameObject.currntImageIndex == i ? '◉' : '○'}`,
            action: () => {
              gameObject.currntImageIndex = i;
              SoundEffect.play(PresetSound.surprise);
              EventSystem.trigger('UPDATE_INVENTORY', null);
            },
            default: gameObject.currntImageIndex == i,
            icon: image
          };
        }),
      });
      actions.push(ContextMenuSeparator);
    }
    actions.push((gameObject.isUseIconToOverviewImage
      ? {
        name: '☑ 使用大頭照icon', action: () => {
          gameObject.isUseIconToOverviewImage = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : {
        name: '☐ 使用大頭照icon', action: () => {
          gameObject.isUseIconToOverviewImage = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      }));
    actions.push(
      (gameObject.isDropShadow
      ? {
        name: '☑ 陰影顯示', action: () => {
          gameObject.isDropShadow = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : {
        name: '☐ 陰影顯示', action: () => {
          gameObject.isDropShadow = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      })
    );
    actions.push({ name: '圖片效果', action: null,  
    subActions: [
      (gameObject.isInverse
        ? {
          name: '☑ 反轉', action: () => {
            gameObject.isInverse = false;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        } : {
          name: '☐ 反轉', action: () => {
            gameObject.isInverse = true;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        }),
      (gameObject.isHollow
        ? {
          name: '☑ 模糊', action: () => {
            gameObject.isHollow = false;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        } : {
          name: '☐ 模糊', action: () => {
            gameObject.isHollow = true;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        }),
      (gameObject.isBlackPaint
        ? {
          name: '☑ 塗成黑色', action: () => {
            gameObject.isBlackPaint = false;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        } : {
          name: '☐ 塗成黑色', action: () => {
            gameObject.isBlackPaint = true;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          }
        }),
        { name: '光環', action: null, subActions: [ { name: `${gameObject.aura == -1 ? '◉' : '○'} 無`, action: () => { gameObject.aura = -1; EventSystem.trigger('UPDATE_INVENTORY', null) } }, ContextMenuSeparator].concat(['黑色','藍色','綠色','青色','紅色','粉紅色','黃色','白色'].map((color, i) => {  
          return { name: `${gameObject.aura == i ? '◉' : '○'} ${color}`, action: () => { gameObject.aura = i; EventSystem.trigger('UPDATE_INVENTORY', null) } };
        })) },
        ContextMenuSeparator,
        {
          name: '重置', action: () => {
            gameObject.isInverse = false;
            gameObject.isHollow = false;
            gameObject.isBlackPaint = false;
            gameObject.aura = -1;
            EventSystem.trigger('UPDATE_INVENTORY', null);
          },
          disabled: !gameObject.isInverse && !gameObject.isHollow && !gameObject.isBlackPaint && gameObject.aura == -1
        }
      ]
    });
    actions.push(ContextMenuSeparator);
    actions.push((!gameObject.isNotRide
      ? {
        name: '☑ 乗上其他角色', action: () => {
          gameObject.isNotRide = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : {
        name: '☐ 乗上其他角色', action: () => {
          gameObject.isNotRide = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      }));
    actions.push(
      (gameObject.isAltitudeIndicate
      ? {
        name: '☑ 顯示高度', action: () => {
          gameObject.isAltitudeIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : {
        name: '☐ 顯示高度', action: () => {
          gameObject.isAltitudeIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      })
    );
    actions.push(
    {
      name: '將高度設為0', action: () => {
        if (gameObject.altitude != 0) {
          gameObject.altitude = 0;
          if (gameObject.location.name === 'table') SoundEffect.play(PresetSound.sweep);
        }
      },
      altitudeHande: gameObject
    });
    actions.push(ContextMenuSeparator);
    actions.push({ name: '顯示詳情', action: () => { this.showDetail(gameObject); } });
    //if (gameObject.location.name !== 'graveyard') {
    actions.push({ name: '顯示聊天面板', action: () => { this.showChatPalette(gameObject) }, disabled: gameObject.location.name === 'graveyard' });
    //}
    actions.push({ name: 'Stand設定', action: () => { this.showStandSetting(gameObject) } });
    actions.push(ContextMenuSeparator);
    actions.push({
      name: '打開參考網址', action: null,
      subActions: gameObject.getUrls().map((urlElement) => {
        const url = urlElement.value.toString();
        return {
          name: urlElement.name ? urlElement.name : url,
          action: () => { this.modalService.open(OpenUrlComponent, { url: url, title: gameObject.name, subTitle: urlElement.name }); },
          disabled: !StringUtil.validUrl(url),
          error: !StringUtil.validUrl(url) ? '網址無效' : null,
          materialIcon: 'open_in_new'
        };
      }),
      disabled: gameObject.getUrls().length <= 0
    });
    actions.push(ContextMenuSeparator);
    actions.push(gameObject.isInventoryIndicate
      ? {
        name: '☑ 在倉庫中顯示', action: () => {
          gameObject.isInventoryIndicate = false;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      } : {
        name: '☐ 在倉庫中顯示', action: () => {
          gameObject.isInventoryIndicate = true;
          EventSystem.trigger('UPDATE_INVENTORY', null);
        }
      });
    let locations = [
      { name: 'table', alias: '桌面' },
      { name: 'common', alias: '共用倉庫' },
      { name: Network.peerId, alias: '個人倉庫' },
      { name: 'graveyard', alias: '墓場' }
    ];
    actions.push({
      name: `${(locations.find((location) => { return location.name == gameObject.location.name }) || locations[1]).alias}移動`,
      action: null,
      subActions: locations
        .filter((location, i) => { return !(gameObject.location.name == location.name || (i == 1 && !locations.map(loc => loc.name).includes(gameObject.location.name))) })
        .map((location) => {
          return {
            name: `${location.alias}`,
            action: () => {
              EventSystem.call('FAREWELL_STAND_IMAGE', { characterIdentifier: gameObject.identifier });
              gameObject.setLocation(location.name);
              if (location.name == 'graveyard') {
                SoundEffect.play(PresetSound.sweep);
              } else {
                SoundEffect.play(PresetSound.piecePut);
              }
            }
          }
        })
    });
    /*
    for (let location of locations) {
      if (gameObject.location.name === location.name) continue;
      actions.push({
        name: location.alias, action: () => {
          gameObject.setLocation(location.name);
          SoundEffect.play(PresetSound.piecePut);
        }
      });
    }
    */
    actions.push(ContextMenuSeparator);
    actions.push({
      name: '製作副本', action: () => {
        this.cloneGameObject(gameObject);
        SoundEffect.play(PresetSound.piecePut);
      }
    });
    if (gameObject.location.name === 'graveyard') {
      actions.push({
        name: '刪除', action: () => {
          this.deleteGameObject(gameObject);
          SoundEffect.play(PresetSound.sweep);
        }
      });
    }
    this.contextMenuService.open(position, actions, gameObject.name);
  }

  onChangeGameType(gameType: string) {
    console.log('onChangeGameType ready');
    DiceBot.getHelpMessage(this.gameType).then(help => {
      console.log('onChangeGameType done\n' + help + gameType);
    });
  }


  toggleEdit() {
    this.isEdit = !this.isEdit;
  }

  cleanInventory() {
    if (this.GuestMode()) return;
    let tabTitle = this.getTabTitle(this.selectTab);
    let gameObjects = this.getGameObjects(this.selectTab);
    if (!confirm(`${tabTitle}存在${gameObjects.length}個物件，要永久刪除嗎？`)) return;
    for (const gameObject of gameObjects) {
      this.deleteGameObject(gameObject);
    }
    SoundEffect.play(PresetSound.sweep);
  }

  private cloneGameObject(gameObject: TabletopObject) {
    if (this.GuestMode()) return;
    gameObject.clone();
  }

  private showDetail(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
    let coordinate = this.pointerDeviceService.pointers[0];
    let title = '角色卡';
    if (gameObject.name.length) title += ' - ' + gameObject.name;
    let option: PanelOption = { title: title, left: coordinate.x - 800, top: coordinate.y - 300, width: 800, height: 600 };
    let component = this.panelService.open<GameCharacterSheetComponent>(GameCharacterSheetComponent, option);
    component.tabletopObject = gameObject;
  }

  private showChatPalette(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 620, height: 350 };
    let component = this.panelService.open<ChatPaletteComponent>(ChatPaletteComponent, option);
    component.character = gameObject;
  }

  selectGameObject(gameObject: GameObject) {
    if (this.GuestMode()) return;
    let aliasName: string = gameObject.aliasName;
    EventSystem.trigger('SELECT_TABLETOP_OBJECT', { identifier: gameObject.identifier, className: gameObject.aliasName });
  }

  private deleteGameObject(gameObject: GameObject) {
    if (this.GuestMode()) return;
    gameObject.destroy();
    this.changeDetector.markForCheck();
  }

  private showStandSetting(gameObject: GameCharacter) {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 400, top: coordinate.y - 175, width: 730, height: 572 };
    let component = this.panelService.open<StandSettingComponent>(StandSettingComponent, option);
    component.character = gameObject;
  }

  trackByGameObject(index: number, gameObject: GameObject) {
    return gameObject ? gameObject.identifier : index;
  }
}
