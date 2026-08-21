import { I18nDictionary } from './types';

export const zhTW_sheet: I18nDictionary = {
  'sheet.toggleEdit': '切換編輯', 'sheet.changeFrontImage': '變更正面圖片', 'sheet.changeBackImage': '變更背面圖片',
  'sheet.changeAllBackImages': '變更全部卡片的背面圖片', 'sheet.changeFloorImage': '變更地板圖片', 'sheet.changeWallImage': '變更牆壁圖片',
  'sheet.changeDiceImage': '變更骰子點數圖片', 'sheet.imageReplaceDelete': '圖片置換/刪除', 'sheet.imageSet': '圖片設定',
  'sheet.faceIconAdd': '大頭貼 icon新增', 'sheet.faceIconSet': '大頭貼 icon設定', 'sheet.changeImage': '變更圖片',
  'sheet.createCopy': '建立副本', 'sheet.cloneCharacter': '複製角色', 'sheet.download': '匯出', 'sheet.import': '匯入', 'sheet.exportCcfoliaJson': '下載為 JSON', 'sheet.location.table': '桌面', 'sheet.location.common': '公用倉庫',
  'sheet.location.personal': '個人倉庫', 'sheet.location.graveyard': '回收區', 'sheet.changeShadow': '變更圖片陰影',
  'sheet.deleteFaceIcon': '刪除大頭貼', 'sheet.switchImageSettings': '切換圖片設定', 'sheet.showChatPalette': '顯示聊天面板',
  'sheet.standSettings': '立繪設定', 'sheet.addItem': '新增項目', 'sheet.data.title': '標題', 'sheet.data.tag': '標籤',
  'sheet.cardBack': '卡片（背面）', 'sheet.title.terrain': '地形設定 - {{name}}', 'sheet.title.card': '卡片設定 - {{name}}',
  'sheet.title.cardStack': '牌堆設定 - {{name}}', 'sheet.title.tableMask': '地圖遮罩設定 - {{name}}',
  'sheet.title.textNote': '共用筆記設定 - {{name}}', 'sheet.title.diceSymbol': '骰子符號設定 - {{name}}',
  'sheet.title.character': '角色卡 - {{name}}', 'sheet.title.range': '射程／範圍設定 - {{name}}', 'sheet.logOpened': '{{title}} 已開啟',
  'sheet.data.type.normal': '一般', 'sheet.data.type.number': '數值', 'sheet.data.type.resource': '資源',
  'sheet.data.type.ability': '能力值', 'sheet.data.type.check': '勾選', 'sheet.data.type.note': '筆記', 'sheet.data.type.url': '參考網址',
  'sheet.data.heightImage': '0=依圖片', 'sheet.data.none': '無', 'sheet.data.cardBack': '卡片（背面）',
  'palette.unnamedTab': '(未命名標籤)', 'palette.editing': '聊天面板編輯中', 'palette.placeholder': '聊天面板',
  'palette.edit': '編輯聊天面板', 'palette.confirm': '確認聊天面板', 'palette.title': '{{name}} 的聊天面板',
  'palette.helpTitle': '聊天記法與聊天面板的使用方法',
  'palette.help': `　參數操作指令、骰子機器人指令不區分全形與半形；骰子機器人指令與參數名稱亦不區分英文字母大小寫。若要併用，請以空白分隔，依序書寫參數操作指令、骰子機器人指令、聊天訊息，各段皆可省略。

　可將聊天內容預先準備在聊天面板。每一行寫一則內容：單擊可呼叫到聊天欄，雙擊則傳送。

・參數操作指令
　以角色傳送聊天時，可在開頭依序書寫 : 、參數名、操作（增加 + 、減少 -、代入 =）、操作內容，即可從聊天操作角色參數。操作內容若寫入骰子機器人指令，可用擲骰結果進行操作（操作資源、數值、能力值時，最後需回傳一個數字）。
　若操作使用 > ，可將骰子機器人指令（不實際擲骰）直接代入參數（目前 name、size、height、altitude 無法操作）。亦可用 : 分隔書寫多個操作；參數操作指令不會顯示在聊天中。

參數操作指令範例）
　:HP+2d6:MP-4　 以 2d6 回復 HP，並消耗 4 點 MP。
　:浸食率+1D10　 登場！

資源操作會套用最大值：指令操作不會超過最大值；若已超過最大值則不會再增加。

　核取方塊在操作為 + 時不論內容皆會開啟，為 - 時則關閉。代入空字串、0、off、☐（空核取方塊）（ = 或 > ）時為關閉，其餘代入為開啟；若代入回傳成功/失敗的擲骰結果（ = ），成功為開啟、失敗為關閉。

・骰子機器人指令
　從聊天傳送骰子機器人指令即可擲骰或查表。實際指令請參照各遊戲系統的骰子機器人說明。亦可透過骰子機器人表功能擴充指令。

・參數參照
　以 { 與 } 包住參數名時，從聊天面板選取或傳送聊天時會替換為參數內容。參數名開頭加上 $ 可參照套用前述參數操作指令後的值。
　此外參照 $數值 可取得參數操作的實際變化量（僅資源、數值、能力值，並考慮擲骰結果與最大值截斷）。數值從 1 開始：1 為參數操作指令的第一個結果，2 為第二個結果…。

參數參照範例）
　:HP-2d6　2d6+{筋力}+2　 HP{$1}、筋力+2 判定（目前 HP {$HP}）

・附加的值
　在聊天面板任一列以 //名稱=值 的形式書寫，即可像參數一樣從聊天訊息參照（無法用指令操作）。

附加的值範例）
　//現在天氣=雨

只要聊天面板任一列有如上範例，該角色傳送的指令或聊天訊息中的 {現在天氣} 就會替換為 雨。

・換行、空白
　聊天訊息中寫入 \\n 會在該處換行（n 為小寫，\\n 本身不顯示）。聊天面板一列只能寫一則傳送內容且無法直接換行，因此可用此方式換行。
　寫入 \\s （半形 s）為半形空白，\\ｓ （全形 ｓ）為全形空白（此為區分全半形的例外）。指令中不能寫空白時可改用此寫法。例外：骰子機器人指令 CHOICE 以空白分隔時可寫空白，但該情況下不能再寫聊天訊息（空白分隔的最後一段也會被視為 CHOICE 指令的一部分）。

・注音（假名）
　要加注音的文字，開頭加 | （豎線），結尾以 《 與 》 包住注音內容。

注音範例）
　接招吧！｜約定的勝利之劍《Excalibur》！

・浮動式對話框
　以角色傳送聊天時，「 與 」包住的內容會以浮動式對話框顯示在 Token 上方。`,
  'stand.sortNameList': '聊天輸入時排序名稱', 'stand.heightGlobal': '高度（0=維持原圖片）: ', 'stand.keepOriginalImage': '維持原圖片',
  'stand.common': '共通設定', 'stand.list': '立繪清單', 'stand.listEmpty': '尚未新增立繪設定',
  'stand.noOverview': '總覽不使用立繪圖片', 'stand.add': '新增立繪設定', 'stand.restore': '還原剛刪除的立繪設定',
  'stand.title': '{{name}} 的立繪設定', 'stand.deleteTitle': '刪除立繪設定', 'stand.deleteText': '要刪除立繪設定嗎？',
  'stand.helpTitle': '立繪設定說明', 'stand.changeImage': '變更圖片', 'stand.namePlaceholder': '名稱', 'stand.condition': '條件: ',
  'stand.condition.default': '預設', 'stand.condition.image': '指定圖片', 'stand.condition.postfix': '聊天末尾',
  'stand.condition.postfixOrImage': '聊天末尾 或 指定圖片', 'stand.condition.postfixAndImage': '聊天末尾 且 指定圖片',
  'stand.condition.selectedOnly': '僅在選擇時', 'stand.showName': '名稱標籤', 'stand.applyImageEffect': '反映圖片效果',
  'stand.applyRoll': '反映旋轉', 'stand.speakingImage': '口型同步圖片（APNG 等）', 'stand.test': '測試（僅本人看見）',
  'stand.positionSpecialize': '位置個別指定: ', 'stand.heightIndividual': '高度（0=未指定）: ', 'stand.unspecified': '未指定',
  'stand.postfixPlaceholder': '每行一個，開頭加上 @ 時會在符合時從文字中截掉\r\n@憤怒\r\n@必殺技', 'stand.noCharacterImages': '尚未設定角色圖片、臉部 IC',
  'stand.testMessage': '這是測試，只有你看得到。調整立繪設定時，可從選單的「個人設定」關閉「立繪淡出並自動退場」，會較容易微調。',
  'stand.help': `　可設定角色立繪的名稱、位置與圖片高度（皆為相對畫面尺寸）、以及發送聊天時顯示立繪的條件。

　若為立繪設定名稱，會顯示在聊天視窗、聊天面板的清單中並可選擇。另外若設定了標籤，即使是相同角色，不同標籤也會播放登場、退場動畫。

　圖片的位置與高度也可個別指定；位置未勾選個別指定、高度為 0 時會使用整體設定。垂直位置調整（AdjY）是相對立繪圖片高度的指定（例如設為 -50% 時，圖片下半部會藏到畫面下緣之外）。

　條件的「指定圖片」是發送聊天時的角色圖片或臉部 IC。另外作為特殊條件，當聊天文字末尾為「@退場」或「@farewell」時，一律會讓該角色的立繪退場。

　優先順序由高到低為：

　　1. 以「@退場」、「@farewell」退場
　　2. 在聊天視窗、聊天面板清單中選擇的名稱
　　3. 「指定圖片 且 聊天末尾」
　　4. 「指定圖片 或 聊天末尾」
　　5. 「聊天末尾」
　　6. 「指定圖片」

　若都不符合則使用「預設」；相同優先順序有多個條件時，會隨機選擇其中一個。

　判定聊天末尾是否符合時，不區分全形半形、英文字母大小寫。另外為了與其他使用 BCDice 的線上團工具相容，判定時會將兩側有空白的「 ＞ 」與「 → 」視為相同。
　此外，以「@退場」、「@farewell」退場時，或設定了如「@笑」這類以「@」開頭的條件時，（無論立繪是否啟用、條件是否符合）以該角色發送時，符合條件的聊天文字末尾的 @ 之後都會被截掉。`,
  'sheet.sendToChat': '傳送到聊天',
  'sheet.placeholder.value': '數值',
  'sheet.placeholder.opacity': '不透明度',
  'sheet.placeholder.number': '數字',
  'sheet.placeholder.note': '筆記',
  'sheet.placeholder.option': '選項',
  'stand.tagLabel': 'Tag: ',
  'stand.tagPlaceholder': 'Tag',
  'stand.adjY': 'AdjY: ',
  'stand.posLabel': 'Pos: ',
  'sheet.modifier.div2': '÷2',
  'sheet.modifier.div3': '÷3 SRS,LHZ',
  'sheet.modifier.div4': '÷4',
  'sheet.modifier.div5': '÷5',
  'sheet.modifier.div6': '÷6 SW',
  'sheet.modifier.div10': '÷10',
  'sheet.modifier.dnd3e': 'D&D 3e～',
  'sheet.data.heightScale': '× 尺寸',
};
