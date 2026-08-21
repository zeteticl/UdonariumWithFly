import { Component, OnDestroy, OnInit } from '@angular/core';

import { ChatTab } from '@udonarium/chat-tab';
import { ChatTabList } from '@udonarium/chat-tab-list';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { PeerCursor } from '@udonarium/peer-cursor';
import { ChatLogOutputComponent } from 'component/chat-log-output/chat-log-output.component';

import { ChatMessageService } from 'service/chat-message.service';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'app-chat-tab-setting',
    templateUrl: './chat-tab-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './chat-tab-setting.component.css'],
    standalone: false
})
export class ChatTabSettingComponent implements OnInit, OnDestroy {
  selectedTab: ChatTab = null;
  selectedTabXml: string = '';

  get tabName(): string { return this.selectedTab.name; }
  set tabName(tabName: string) { if (this.isEditable) this.selectedTab.name = tabName; }

  get isUseStandImage(): boolean { return this.selectedTab.isUseStandImage; }
  set isUseStandImage(isUseStandImage: boolean) { if (this.isEditable) this.selectedTab.isUseStandImage = isUseStandImage; }

  get recieveOperationLogLevel(): number { return this.selectedTab.recieveOperationLogLevel; }
  set recieveOperationLogLevel(recieveOperationLogLevel: number) { if (this.isEditable) this.selectedTab.recieveOperationLogLevel = recieveOperationLogLevel; }

  get isPrivate(): boolean { return !!this.selectedTab?.isPrivate; }
  set isPrivate(v: boolean) {
    if (!this.isEditable || this.GuestMode()) return;
    this.selectedTab.isPrivate = !!v;
    if (v && !this.selectedTab.creatorUserId) {
      this.selectedTab.creatorUserId = Network.peer?.userId || '';
    }
  }

  get peerCandidates(): PeerCursor[] {
    return ObjectStore.instance.getObjects(PeerCursor).filter(p => !!p.userId);
  }

  isMemberChecked(userId: string): boolean {
    return !!this.selectedTab && this.selectedTab.isMember(userId);
  }

  toggleMember(userId: string, checked: boolean) {
    if (!this.isEditable || this.GuestMode() || !this.selectedTab) return;
    const set = new Set(this.selectedTab.memberIds);
    if (checked) set.add(userId); else set.delete(userId);
    this.selectedTab.setMembers(Array.from(set));
  }

  get chatTabs(): ChatTab[] { return this.chatMessageService.chatTabs; }
  /** Local display label — edit field still uses synced `tabName`. */
  tabLabel(tab: ChatTab): string {
    if (!tab || tab.name === '') return this.i18n.t('chatTab.untitled');
    return ChatTabList.localizedName(tab);
  }
  get isEmpty(): boolean { return this.chatMessageService.chatTabs.length < 1 }
  get isDeleted(): boolean { return this.selectedTab ? ObjectStore.instance.get(this.selectedTab.identifier) == null : false; }
  get isEditable(): boolean { return !this.isEmpty && !this.isDeleted; }

  get roomName():string {
    let roomName = Network.peer && 0 < Network.peer.roomName.length
      ? Network.peer.roomName
      : this.i18n.t('room.dataFallback');
    return roomName;
  }
  
  isSaveing: boolean = false;
  progresPercent: number = 0;

  constructor(
    private modalService: ModalService,
    private panelService: PanelService,
    private chatMessageService: ChatMessageService,
    private saveDataService: SaveDataService,
    private pointerDeviceService: PointerDeviceService,
    private i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => { this.refreshPanelTitle(); this.panelService.isAbleFullScreenButton = false });
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', 2000, event => {
        if (!this.selectedTab || event.data.identifier !== this.selectedTab.identifier) return;
        let object = ObjectStore.instance.get(event.data.identifier);
        if (object !== null) {
          this.selectedTabXml = object.toXml();
        }
      })
      .on('LOCALE_CHANGED', () => this.refreshPanelTitle());
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  onChangeSelectTab(identifier: string) {
    this.selectedTab = ObjectStore.instance.get<ChatTab>(identifier);
    this.selectedTabXml = '';
  }

  create() {
    if (this.GuestMode()) return;
    const tab = ChatTabList.instance.addChatTab(this.i18n.t('chatTab.defaultName'));
    tab.creatorUserId = Network.peer?.userId || '';
  }

  createPrivate() {
    if (this.GuestMode()) return;
    const tab = ChatTabList.instance.addChatTab(this.i18n.t('chatTab.privateDefaultName'));
    tab.isPrivate = true;
    tab.creatorUserId = Network.peer?.userId || '';
    tab.setMembers([tab.creatorUserId].filter(Boolean));
    this.selectedTab = tab;
  }

  async save() {
    if (this.GuestMode()) return;
    if (!this.selectedTab || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    let fileName: string = 'fly_chat_' + this.selectedTab.name;

    await this.saveDataService.saveGameObjectAsync(this.selectedTab, fileName, percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  importXml() {
    if (this.GuestMode()) return;
    this.saveDataService.pickAndLoadXmlOrZip();
  }

  delete() {
    if (this.GuestMode()) return;
    if (!this.isEmpty && this.selectedTab) {
      this.selectedTabXml = this.selectedTab.toXml();
      this.selectedTab.destroy();
    }
  }

  restore() {
    if (this.GuestMode()) return;
    if (this.selectedTab && this.selectedTabXml) {
      let restoreTable = <ChatTab>ObjectSerializer.instance.parseXml(this.selectedTabXml);
      ChatTabList.instance.addChatTab(restoreTable);
      this.selectedTabXml = '';
    }
  }

  upTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedTab) return;
    let parentElement = this.selectedTab.parent;
    let index: number = parentElement.children.indexOf(this.selectedTab);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.selectedTab, prevElement);
    }
  }

  downTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedTab) return;
    let parentElement = this.selectedTab.parent;
    let index: number = parentElement.children.indexOf(this.selectedTab);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.selectedTab);
    }
  }

  showLogOutput() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x - 250, top: coordinate.y - 175, width: 540, height: 300 };
    let component = this.panelService.open<ChatLogOutputComponent>(ChatLogOutputComponent, option);
    component.selectedTabs = [this.selectedTab];
    component.selectTabsApplay();
  }

  private refreshPanelTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('chatTab.title');
  }
}
