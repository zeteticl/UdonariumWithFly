import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { EventSystem } from '@udonarium/core/system';
import { PanelOption, PanelService } from 'service/panel.service';
import { DataElement } from '@udonarium/data-element';
import { GameCharacter } from '@udonarium/game-character';
import { ImageStorage } from '@udonarium/core/file-storage/image-storage';
import { ImageFile } from '@udonarium/core/file-storage/image-file';
import { StandElementComponent } from 'component/stand-element/stand-element.component';
import { UUID } from '@udonarium/core/system/util/uuid';
import { PointerDeviceService } from 'service/pointer-device.service';
import { TextViewComponent } from 'component/text-view/text-view.component';

@Component({
  selector: 'app-stand-setting',
  templateUrl: './stand-setting.component.html',
  styleUrls: ['./stand-setting.component.css']
})
export class StandSettingComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() character: GameCharacter = null;
　@ViewChildren(StandElementComponent) standElementComponents: QueryList<StandElementComponent>;

  panelId;

  private _intervalId;
  private isSpeaking = false;

  constructor(
    private panelService: PanelService,
    private pointerDeviceService: PointerDeviceService,
  ) { }

  get standElements(): DataElement[] {
    return this.character.standList.standElements;
  }

  get imageList(): ImageFile[] {
    if (!this.character) return [];
    let ret = [];
    let dupe = {};
    const tmp = this.character.imageDataElement.getElementsByName('imageIdentifier');
    const elements = tmp.concat(this.character.imageDataElement.getElementsByName('faceIcon'));
    for (let elm of elements) {
      if (dupe[elm.value]) continue;
      let file = this.imageElementToFile(elm);
      if (file) {
        dupe[elm.value] = true;
        ret.push(file);
      }
    }
    return ret;
  }

  get position(): number {
    if (!this.character || !this.character.standList) return 0;
    return this.character.standList.position;
  }

  set position(position: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.position = position;
  }

  get height(): number {
    if (!this.character || !this.character.standList) return 0;
    return this.character.standList.height;
  }

  set height(height: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.height = height;
  }

  get overviewIndex(): number {
    if (!this.character || !this.character.standList) return -1;
    return this.character.standList.overviewIndex;
  }

  set overviewIndex(overviewIndex: number) {
    if (!this.character || !this.character.standList) return;
    this.character.standList.overviewIndex = overviewIndex;
  }

  ngOnInit() {
    Promise.resolve().then(() => this.updatePanelTitle());
    EventSystem.register(this)
      .on('DELETE_GAME_OBJECT', -1000, event => {
        if (this.character && this.character.identifier === event.data.identifier) {
          this.panelService.close();
        }
      });
    this.panelId = UUID.generateUuid();
  }

  ngAfterViewInit() {
    this._intervalId = setInterval(() => {
      this.isSpeaking = !this.isSpeaking;
      this.standElementComponents.forEach(standElementComponent => {
        standElementComponent.isSpeaking = this.isSpeaking;
      });
    }, 3600);
  }

  ngOnDestroy() {
    clearInterval(this._intervalId)
    EventSystem.unregister(this);
  }

  updatePanelTitle() {
    this.panelService.title = this.character.name + ' 的Stand設定';
  }

  add() {
    this.character.standList.add(this.character.imageFile.identifier);
  }

  delele(standElement: DataElement, index: number) {
    if (!this.character || !this.character.standList || !window.confirm('您要刪除Stand設定嗎？')) return;
    let elm = this.character.standList.removeChild(standElement);
    if (elm) {
      if (this.character.standList.overviewIndex == index) {
        this.character.standList.overviewIndex = -1;
      } else if (this.character.standList.overviewIndex > index) {
        this.character.standList.overviewIndex -= 1;
      }
    }
  }

  upStandIndex(standElement: DataElement) {
    let parentElement = this.character.standList;
    let index: number = parentElement.children.indexOf(standElement);
    if (0 < index) {
      let prevElement = parentElement.children[index - 1];
      parentElement.insertBefore(standElement, prevElement);
      if (this.character.standList.overviewIndex == index) {
        this.character.standList.overviewIndex -= 1;
      } else if (this.character.standList.overviewIndex == index - 1) {
        this.character.standList.overviewIndex += 1;
      } 
    }
  }

  downStandIndex(standElement: DataElement) {
    let parentElement = this.character.standList;
    let index: number = parentElement.children.indexOf(standElement);
    if (index < parentElement.children.length - 1) {
      let nextElement = parentElement.children[index + 1];
      parentElement.insertBefore(nextElement, standElement);
      if (this.character.standList.overviewIndex == index) {
        this.character.standList.overviewIndex += 1;
      } else if (this.character.standList.overviewIndex == index + 1) {
        this.character.standList.overviewIndex -= 1;
      } 
    }
  }

  helpStandSeteing() {
    let coordinate = this.pointerDeviceService.pointers[0];
    let option: PanelOption = { left: coordinate.x, top: coordinate.y, width: 600, height: 590 };
    let textView = this.panelService.open(TextViewComponent, option);
    textView.title = '立繪設定說明';
    textView.text = 
`　您可以設置角色的立繪名稱，圖片的位置和高度（相對於屏幕的尺寸）以及在發送聊天時顯示立繪的條件。

如果為立繪設定名稱，它將顯示在聊天窗口和聊天面板列表中，並且可以選擇。同樣，如果您設定了標籤，則即使它們是相同的角色，也會為不同的標籤設定動畫顯示和fadeout。

可以單獨指定圖片的位置和高度，不選中各個位置指定，並且當高度設置為0時使用整個設置。垂直對齊（AdjY）相對於立繪圖片的高度（例如，-50％將圖片的下半部分隱藏在屏幕邊緣下方）。

條件「指定圖片」是發送聊天時的字符圖片或大頭照icon。同樣，作為特殊條件，如果聊天文本以「@退去」或「@farewell」結尾，則角色的立場將始終被fadeout。

從最高優先

1.按「@退去」，「@farewell」fadeout
2.在聊天窗口或聊天面板列表中選擇的名稱
3.「指定的圖片和聊天結束」
4.「指定圖片或聊天結束」
5.「聊天結束」
6.「指定圖片」

如果不滿足任何一個條件，則將使用「默認」條件；如果有多個具有相同優先級的條件，則將隨機選擇一個條件。

在聊天結束時判斷比賽時，不區分全型半型和Alpha的情況。
另外，當您通過「@移出」或「@farewell」fadeout時，或者如果您設置了以「@」開頭的條件（例如「@笑」），則與該字符發送時的條件相匹配的聊天內容文本末尾的@將被截斷。`;
  }

  private imageElementToFile(dataElm: DataElement): ImageFile {
    if (!dataElm) return null;
    return ImageStorage.instance.get(<string>dataElm.value);
  }
}
