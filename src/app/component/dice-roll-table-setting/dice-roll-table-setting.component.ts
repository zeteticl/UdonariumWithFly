import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ObjectSerializer } from '@udonarium/core/synchronize-object/object-serializer';
import { ObjectStore } from '@udonarium/core/synchronize-object/object-store';
import { EventSystem, Network } from '@udonarium/core/system';
import { DiceRollTable } from '@udonarium/dice-roll-table';
import { DiceRollTableList } from '@udonarium/dice-roll-table-list';
import { TextViewComponent } from 'component/text-view/text-view.component';
import { ModalService } from 'service/modal.service';
import { PanelOption, PanelService } from 'service/panel.service';
import { PointerDeviceService } from 'service/pointer-device.service';
import { SaveDataService } from 'service/save-data.service';
import { I18nService } from 'service/i18n.service';

@Component({
    selector: 'dice-roll-table-setting',
    templateUrl: './dice-roll-table-setting.component.html',
    styleUrls: ['../shared/settings-ui.css', './dice-roll-table-setting.component.css'],
    standalone: false
})
export class DiceRollTableSettingComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('diceRollTableSelecter') diceRollTableSelecter: ElementRef<HTMLSelectElement>;

  selectedDiceRollTable: DiceRollTable = null;
  selectedDiceRollTableXml: string = '';

  get diceRollTableName(): string { return this.selectedDiceRollTable.name; }
  set diceRollTableName(name: string) { if (this.isEditable) this.selectedDiceRollTable.name = name; }

  get diceRollTableDice(): string { return this.selectedDiceRollTable.dice; }
  set diceRollTableDice(dice: string) { if (this.isEditable) this.selectedDiceRollTable.dice = dice; }

  get diceRollTableCommand(): string { return this.selectedDiceRollTable.command; }
  set diceRollTableCommand(command: string) { if (this.isEditable) this.selectedDiceRollTable.command = command; }

  get diceRollTableText(): string { return <string>this.selectedDiceRollTable.value; }
  set diceRollTableText(text: string) { if (this.isEditable) this.selectedDiceRollTable.value = text; }

  get diceRollTables(): DiceRollTable[] { return DiceRollTableList.instance.children as DiceRollTable[]; }
  get isEmpty(): boolean { return this.diceRollTables.length < 1 }
  get isDeleted(): boolean { return this.selectedDiceRollTable ? ObjectStore.instance.get(this.selectedDiceRollTable.identifier) == null : false; }
  get isEditable(): boolean { return !this.isEmpty && !this.isDeleted; }

  isSaveing: boolean = false;
  progresPercent: number = 0;

  constructor(
    private pointerDeviceService: PointerDeviceService,
    private modalService: ModalService,
    private panelService: PanelService,
    private saveDataService: SaveDataService,
    public i18n: I18nService
  ) { }

  GuestMode() {
    return Network.GuestMode();
  }


  ngOnInit() {
    Promise.resolve().then(() => this.updateTitle());
    EventSystem.register(this)
      .on('LOCALE_CHANGED', -1000, () => this.updateTitle())
      .on('DELETE_GAME_OBJECT', 1000, event => {
        if (!this.selectedDiceRollTable || event.data.identifier !== this.selectedDiceRollTable.identifier) return;
        let object = ObjectStore.instance.get(event.data.identifier);
        if (object !== null) {
          this.selectedDiceRollTableXml = object.toXml();
        }
      });
  }

  ngAfterViewInit() {
    //const diceRollTables = DiceRollTableList.instance.diceRollTables;
    if (this.diceRollTables.length > 0) {
      queueMicrotask(() => {
        this.onChangeDiceRollTable(this.diceRollTables[0].identifier);
        this.diceRollTableSelecter.nativeElement.selectedIndex = 0;
      });
    }
  }

  ngOnDestroy() {
    EventSystem.unregister(this);
  }

  private updateTitle() {
    this.modalService.title = this.panelService.title = this.i18n.t('diceTable.title');
  }

  onChangeDiceRollTable(identifier: string) {
    this.selectedDiceRollTable = ObjectStore.instance.get<DiceRollTable>(identifier);
    this.selectedDiceRollTableXml = '';
  }

  create(name?: string): DiceRollTable {
    if (this.GuestMode()) return;
    return DiceRollTableList.instance.addDiceRollTable(name ?? this.i18n.t('diceTable.defaultName'))
  }

  add() {
    const diceRollTable = this.create();
    queueMicrotask(() => {
      this.onChangeDiceRollTable(diceRollTable.identifier);
      this.diceRollTableSelecter.nativeElement.value = diceRollTable.identifier;
    })
  }
  
  async save() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable || this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    let fileName: string = 'fly_rollTable_' + this.selectedDiceRollTable.name;

    await this.saveDataService.saveGameObjectAsync(this.selectedDiceRollTable, fileName, percent => {
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

  async saveAll() {
    if (this.isSaveing) return;
    this.isSaveing = true;
    this.progresPercent = 0;

    await this.saveDataService.saveGameObjectAsync(DiceRollTableList.instance, 'fly_rollTable_All', percent => {
      this.progresPercent = percent;
    });

    setTimeout(() => {
      this.isSaveing = false;
      this.progresPercent = 0;
    }, 500);
  }

  delete() {
    if (this.GuestMode()) return;
    if (!this.isEmpty && this.selectedDiceRollTable) {
      this.selectedDiceRollTableXml = this.selectedDiceRollTable.toXml();
      this.selectedDiceRollTable.destroy();
    }
  }

  restore() {
    if (this.GuestMode()) return;
    if (this.selectedDiceRollTable && this.selectedDiceRollTableXml) {
      let restoreTable = <DiceRollTable>ObjectSerializer.instance.parseXml(this.selectedDiceRollTableXml);
      DiceRollTableList.instance.addDiceRollTable(restoreTable);
      this.selectedDiceRollTableXml = '';
      queueMicrotask(() => {
        const diceRollTables = this.diceRollTables;
        this.onChangeDiceRollTable(diceRollTables[diceRollTables.length - 1].identifier);
        this.diceRollTableSelecter.nativeElement.selectedIndex = diceRollTables.length - 1;
      });
    }
  }

  upTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable) return;
    let parentElement = this.selectedDiceRollTable.parent;
    let index: number = parentElement.children.indexOf(this.selectedDiceRollTable);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(this.selectedDiceRollTable, prevElement);
    }
  }

  downTabIndex() {
    if (this.GuestMode()) return;
    if (!this.selectedDiceRollTable) return;
    let parentElement = this.selectedDiceRollTable.parent;
    let index: number = parentElement.children.indexOf(this.selectedDiceRollTable);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, this.selectedDiceRollTable);
    }
  }

  helpDiceRollTable() {
    if (this.GuestMode()) return;
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 600, height: 600 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = this.i18n.t('diceTable.help');
    textView.text = this.i18n.t('diceTable.helpText');
  }
}