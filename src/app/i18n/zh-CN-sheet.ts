import { I18nDictionary } from './types';
import { zhTW_sheet } from './zh-TW-sheet';

export const zhCN_sheet: I18nDictionary = {
  ...zhTW_sheet,
  'sheet.toggleEdit': '切换编辑', 'sheet.changeFrontImage': '更改正面图片', 'sheet.changeBackImage': '更改背面图片', 'sheet.changeAllBackImages': '更改全部卡片的背面图片', 'sheet.changeFloorImage': '更改地板图片', 'sheet.changeWallImage': '更改墙壁图片', 'sheet.changeDiceImage': '更改骰子点数图片', 'sheet.imageReplaceDelete': '替换/删除图片', 'sheet.imageSet': '设置图片', 'sheet.faceIconAdd': '新增头像', 'sheet.faceIconSet': '设置头像', 'sheet.changeImage': '更改图片', 'sheet.createCopy': '创建副本', 'sheet.cloneCharacter': '复制角色', 'sheet.download': '导出', 'sheet.import': '导入', 'sheet.exportCcfoliaJson': '下载为 JSON', 'sheet.location.table': '桌面', 'sheet.location.common': '公用仓库', 'sheet.location.personal': '个人仓库', 'sheet.location.graveyard': '回收区', 'sheet.changeShadow': '更改图片阴影', 'sheet.deleteFaceIcon': '删除头像', 'sheet.showChatPalette': '显示聊天面板', 'sheet.standSettings': '立绘设置', 'sheet.addItem': '新增项目', 'sheet.data.title': '标题', 'sheet.data.tag': '标签', 'sheet.cardBack': '卡片（背面）', 'sheet.title.terrain': '地形设置 - {{name}}', 'sheet.title.card': '卡片设置 - {{name}}', 'sheet.title.cardStack': '牌堆设置 - {{name}}', 'sheet.title.tableMask': '地图遮罩设置 - {{name}}', 'sheet.title.textNote': '共用笔记设置 - {{name}}', 'sheet.title.diceSymbol': '骰子符号设置 - {{name}}', 'sheet.title.character': '角色卡 - {{name}}', 'sheet.title.range': '射程／范围设置 - {{name}}', 'sheet.logOpened': '{{title}} 已开启', 'sheet.data.type.normal': '一般', 'sheet.data.type.number': '数值', 'sheet.data.type.resource': '资源', 'sheet.data.type.ability': '能力值', 'sheet.data.type.check': '勾选', 'sheet.data.type.note': '笔记', 'sheet.data.type.url': '参考网址', 'sheet.data.heightImage': '0=依图片', 'sheet.data.none': '无',
  'palette.unnamedTab': '(未命名标签)', 'palette.editing': '正在编辑聊天面板', 'palette.placeholder': '聊天面板', 'palette.edit': '编辑聊天面板', 'palette.confirm': '确认聊天面板', 'palette.title': '{{name}} 的聊天面板', 'palette.helpTitle': '聊天记法与聊天面板的使用方法',
  'palette.help': `　参数操作指令、骰子机器人指令不区分全角与半角；骰子机器人指令与参数名称亦不区分英文字母大小写。若要并用，请以空格分隔，依序书写参数操作指令、骰子机器人指令、聊天消息，各段皆可省略。

　可将聊天内容预先准备在聊天面板。每一行写一则内容：单击可填入聊天栏，双击则发送。

・参数操作指令
　以角色发送聊天时，可在开头依序书写 : 、参数名、操作（增加 + 、减少 -、代入 =）、操作内容，即可从聊天操作角色参数。操作内容若写入骰子机器人指令，可用掷骰结果进行操作（操作资源、数值、能力值时，最后需返回一个数字）。
　若操作使用 > ，可将骰子机器人指令（不实际掷骰）直接代入参数（目前 name、size、height、altitude 无法操作）。亦可用 : 分隔书写多个操作；参数操作指令不会显示在聊天中。

参数操作指令示例）
　:HP+2d6:MP-4　 以 2d6 回复 HP，并消耗 4 点 MP。
　:浸食率+1D10　 出场！

资源操作会应用最大值：指令操作不会超过最大值；若已超过最大值则不会再增加。

　复选框在操作为 + 时不论内容皆会开启，为 - 时则关闭。代入空字串、0、off、☐（空复选框）（ = 或 > ）时为关闭，其余代入为开启；若代入返回成功/失败的掷骰结果（ = ），成功为开启、失败为关闭。

・骰子机器人指令
　从聊天发送骰子机器人指令即可掷骰或查表。实际指令请引用各游戏系统的骰子机器人说明。亦可通过骰子机器人表功能扩充指令。

・参数引用
　以 { 与 } 包住参数名时，从聊天面板选取或发送聊天时会替换为参数内容。参数名开头加上 $ 可引用应用前述参数操作指令后的值。
　此外引用 $数值 可获取参数操作的实际变化量（仅资源、数值、能力值，并考虑掷骰结果与最大值截断）。数值从 1 开始：1 为参数操作指令的第一个结果，2 为第二个结果…。

参数引用示例）
　:HP-2d6　2d6+{筋力}+2　 HP{$1}、筋力+2 判定（目前 HP {$HP}）

・附加的值
　在聊天面板任一列以 //名称=值 的形式书写，即可像参数一样从聊天消息引用（无法用指令操作）。

附加的值示例）
　//现在天气=雨

只要聊天面板任一列有如上示例，该角色发送的指令或聊天消息中的 {现在天气} 就会替换为 雨。

・换行、空白
　聊天消息中写入 \\n 会在该处换行（n 为小写，\\n 本身不显示）。聊天面板一列只能写一则发送内容且无法直接换行，因此可用此方式换行。
　写入 \\s （半角 s）为半角空白，\\ｓ （全角 ｓ）为全角空白（此为区分全半角的例外）。指令中不能写空白时可改用此写法。例外：骰子机器人指令 CHOICE 以空格分隔时可写空白，但该情况下不能再写聊天消息（空格分隔的最后一段也会被视为 CHOICE 指令的一部分）。

・注音（假名）
　要加注音的文字，开头加 | （竖线），结尾以 《 与 》 包住注音内容。

注音示例）
　接招吧！｜约定的胜利之剑《Excalibur》！

・浮动式对话框
　以角色发送聊天时，「 与 」包住的内容会以浮动式对话框显示在 Token 上方。`,
  'stand.sortNameList': '聊天输入时排序名称', 'stand.heightGlobal': '高度（0=保持原图片）: ', 'stand.keepOriginalImage': '保持原图片', 'stand.common': '共通设置', 'stand.list': '立绘列表', 'stand.listEmpty': '尚未新增立绘设置', 'stand.noOverview': '总览不使用立绘图片', 'stand.add': '新增立绘设置', 'stand.restore': '还原刚删除的立绘设置', 'stand.title': '{{name}} 的立绘设置', 'stand.deleteTitle': '删除立绘设置', 'stand.deleteText': '要删除立绘设置吗？', 'stand.helpTitle': '立绘设置说明', 'stand.changeImage': '更改图片', 'stand.condition': '条件: ', 'stand.condition.default': '默认', 'stand.condition.image': '指定图片', 'stand.condition.postfix': '聊天末尾', 'stand.condition.postfixOrImage': '聊天末尾 或 指定图片', 'stand.condition.postfixAndImage': '聊天末尾 且 指定图片', 'stand.condition.selectedOnly': '仅在选择时', 'stand.showName': '名称标签', 'stand.applyImageEffect': '应用图片效果', 'stand.applyRoll': '应用旋转', 'stand.speakingImage': '口型同步图片（APNG 等）', 'stand.test': '测试（仅自己可见）', 'stand.positionSpecialize': '位置单独指定: ', 'stand.heightIndividual': '高度（0=未指定）: ', 'stand.unspecified': '未指定', 'stand.postfixPlaceholder': '每行一个，开头加上 @ 时会在符合时从文字中截掉\r\n@愤怒\r\n@必杀技', 'stand.noCharacterImages': '尚未设置角色图片、头像', 'stand.testMessage': '这是测试，只有你看得到。调整立绘设置时，可从菜单的“个人设置”关闭“立绘淡出并自动退场”，会更容易微调。',
  'stand.help': `　可设置角色立绘的名称、位置与图片高度（皆为相对画面尺寸）、以及发送聊天时显示立绘的条件。

　若为立绘设置名称，会显示在聊天窗口、聊天面板的列表中并可选择。另外若设置了标签，即使是相同角色，不同标签也会播放出场、退场动画。

　图片的位置与高度也可单独指定；位置未勾选单独指定、高度为 0 时会使用整体设置。垂直位置调整（AdjY）是相对立绘图片高度的指定（例如设为 -50% 时，图片下半部会藏到画面下缘之外）。

　条件的「指定图片」是发送聊天时的角色图片或头像。另外作为特殊条件，当聊天文字末尾为「@退场」或「@farewell」时，一律会让该角色的立绘退场。

　优先顺序由高到低为：

　　1. 以「@退场」、「@farewell」退场
　　2. 在聊天窗口、聊天面板列表中选择的名称
　　3. 「指定图片 且 聊天末尾」
　　4. 「指定图片 或 聊天末尾」
　　5. 「聊天末尾」
　　6. 「指定图片」

　若都不符合则使用「默认」；相同优先顺序有多个条件时，会随机选择其中一个。

　判定聊天末尾是否符合时，不区分全角半角、英文字母大小写。另外为了与其他使用 BCDice 的线上团工具兼容，判定时会将两侧有空白的「 ＞ 」与「 → 」视为相同。
　此外，以「@退场」、「@farewell」退场时，或设置了如「@笑」这类以「@」开头的条件时，（无论立绘是否启用、条件是否符合）以该角色发送时，符合条件的聊天文字末尾的 @ 之后都会被截掉。`,
  'sheet.switchImageSettings': '切换图片设置',
  'sheet.data.cardBack': '卡片（背面）',
  'stand.namePlaceholder': '名称',
  'sheet.sendToChat': '发送到聊天',
  'sheet.placeholder.value': '数值',
  'sheet.placeholder.opacity': '不透明度',
  'sheet.placeholder.number': '数字',
  'sheet.placeholder.note': '笔记',
  'sheet.placeholder.option': '选项',
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
