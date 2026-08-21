import { I18nDictionary } from './types';
import { zhTW_sheet } from './zh-TW-sheet';

export const ja_sheet: I18nDictionary = {
  ...zhTW_sheet,
  'sheet.toggleEdit': '編集切替', 'sheet.changeFrontImage': '表面画像を変更', 'sheet.changeBackImage': '裏面画像を変更', 'sheet.changeAllBackImages': 'すべてのカード裏面画像を変更', 'sheet.changeFloorImage': '床画像を変更', 'sheet.changeWallImage': '壁画像を変更', 'sheet.changeDiceImage': 'ダイス目画像を変更', 'sheet.imageReplaceDelete': '画像を置換/削除', 'sheet.imageSet': '画像を設定', 'sheet.faceIconAdd': '顔アイコンを追加', 'sheet.faceIconSet': '顔アイコンを設定', 'sheet.changeImage': '画像を変更', 'sheet.createCopy': '複製を作成', 'sheet.cloneCharacter': 'キャラクターを複製', 'sheet.download': '書き出し', 'sheet.import': '読込', 'sheet.exportCcfoliaJson': 'JSONでダウンロード', 'sheet.location.table': 'テーブル', 'sheet.location.common': '共有保管庫', 'sheet.location.personal': '個人保管庫', 'sheet.location.graveyard': 'ごみ箱', 'sheet.changeShadow': '画像の影を変更', 'sheet.deleteFaceIcon': '顔アイコンを削除', 'sheet.showChatPalette': 'チャットパレットを表示', 'sheet.standSettings': '立ち絵設定', 'sheet.addItem': '項目を追加', 'sheet.data.title': 'タイトル', 'sheet.data.tag': 'タグ', 'sheet.cardBack': 'カード（裏面）', 'sheet.title.terrain': '地形設定 - {{name}}', 'sheet.title.card': 'カード設定 - {{name}}', 'sheet.title.cardStack': '山札設定 - {{name}}', 'sheet.title.tableMask': 'マップマスク設定 - {{name}}', 'sheet.title.textNote': '共有メモ設定 - {{name}}', 'sheet.title.diceSymbol': 'ダイスシンボル設定 - {{name}}', 'sheet.title.character': 'キャラクターシート - {{name}}', 'sheet.title.range': '射程／範囲設定 - {{name}}', 'sheet.logOpened': '{{title}} を開きました', 'sheet.data.type.normal': '通常', 'sheet.data.type.number': '数値', 'sheet.data.type.resource': 'リソース', 'sheet.data.type.ability': '能力値', 'sheet.data.type.check': 'チェック', 'sheet.data.type.note': 'メモ', 'sheet.data.type.url': '参照URL', 'sheet.data.heightImage': '0=画像に合わせる', 'sheet.data.none': 'なし',
  'palette.unnamedTab': '（無題タブ）', 'palette.editing': 'チャットパレット編集中', 'palette.placeholder': 'チャットパレット', 'palette.edit': 'チャットパレットを編集', 'palette.confirm': 'チャットパレットを確定', 'palette.title': '{{name}} のチャットパレット', 'palette.helpTitle': 'チャット記法とチャットパレットの使い方',
  'palette.help': `　パラメータ操作指令とダイスボット指令は全角半角・英字の大文字小文字を区別しません。併用する場合は空白で区切り、パラメータ操作、ダイスボット指令、チャット本文の順に書きます（いずれも省略可）。

　チャット内容はチャットパレットにあらかじめ用意できます。1行に1件を書き、クリックで入力欄へ、ダブルクリックで送信します。

・パラメータ操作指令
　キャラクターで送信する際、先頭に :、パラメータ名、操作（増加 +、減少 -、代入 =）、内容を書けばパラメータを操作できます。内容にダイスボット指令を書くと、出目で操作できます（リソース／数値／能力値は最終的に数字を返す必要があります）。
　> を使うとダイスボット指令を（実際には振らずに）そのまま代入できます（現状 name / size / height / altitude は操作不可）。: で複数操作を区切れます。操作指令はチャットには表示されません。

パラメータ操作の例）
　:HP+2d6:MP-4　 2d6 で HP を回復し、MP を 4 消費。
　:浸食率+1D10　 登場！

リソース操作は最大値を超えて増えません。すでに最大を超えている場合はさらに増えません。

　チェックボックスは操作が + なら内容に関係なく ON、- なら OFF です。空文字・0・off・☐（空チェック）を = または > で代入すると OFF、それ以外は ON。成功／失敗を返すダイス結果を = で代入すると、成功で ON・失敗で OFF です。

・ダイスボット指令
　ダイスボット指令を送信するとダイスロールや表参照ができます。利用可能な指令は各ゲームシステムの説明を参照してください。ダイスボット表機能でも指令を拡張できます。

・パラメータ参照
　パラメータ名を { と } で囲むと、パレット選択時や送信時にその内容へ置き換わります。名前の先頭に $ を付けると、前述の操作後の値を参照できます。
　さらに $1、$2… で各操作の実際の変化量を参照できます（リソース／数値／能力値のみ。出目と最大値の切り捨ても考慮）。

パラメータ参照の例）
　:HP-2d6　2d6+{筋力}+2　 HP{$1}、筋力+2 判定（現在 HP {$HP}）

・追加の値
　パレットのいずれかの行に //名前=値 と書くと、パラメータと同様にチャットから参照できます（指令では操作できません）。

追加の値の例）
　//現在天気=雨

上記があるキャラクターでは、送信文中の {現在天気} が 雨 に置き換わります。

・改行・空白
　チャット本文に \n を書くとその位置で改行します（\n 自体は表示されません）。パレットは1行1件のため、改行したいときに使います。
　\s（半角 s）は半角空白、\ｓ（全角 ｓ）は全角空白です。指令中に空白を書けない場合の代替です。例外：CHOICE を空白区切りで書く場合は空白を使えますが、その場合チャット本文は書けません。

・ルビ（振り仮名）
　振り仮名を付けたい文字の前に |（縦線）、振り仮名を 《 と 》 で囲みます。

ルビの例）
　くらえ！｜約束された勝利の剣《Excalibur》！

・フローティング台詞
　キャラクターで送信する際、「 と 」で囲んだ内容はトークン上のフローティング台詞で表示されます。`,
  'stand.sortNameList': 'チャット入力時に名前を並べ替える', 'stand.heightGlobal': '高さ（0=元画像を維持）: ', 'stand.keepOriginalImage': '元画像を維持', 'stand.common': '共通設定', 'stand.list': '立ち絵一覧', 'stand.listEmpty': '立ち絵設定がありません', 'stand.noOverview': '一覧で立ち絵を使用しない', 'stand.add': '立ち絵設定を追加', 'stand.restore': '削除した立ち絵設定を復元', 'stand.title': '{{name}} の立ち絵設定', 'stand.deleteTitle': '立ち絵設定を削除', 'stand.deleteText': '立ち絵設定を削除しますか？', 'stand.helpTitle': '立ち絵設定の説明', 'stand.changeImage': '画像を変更', 'stand.condition': '条件: ', 'stand.condition.default': 'デフォルト', 'stand.condition.image': '指定画像', 'stand.condition.postfix': 'チャット末尾', 'stand.condition.postfixOrImage': 'チャット末尾 または 指定画像', 'stand.condition.postfixAndImage': 'チャット末尾 かつ 指定画像', 'stand.condition.selectedOnly': '選択時のみ', 'stand.showName': '名前タグ', 'stand.applyImageEffect': '画像効果を反映', 'stand.applyRoll': '回転を反映', 'stand.speakingImage': '口パク同期画像（APNG等）', 'stand.test': 'テスト（自分だけに表示）', 'stand.positionSpecialize': '位置を個別指定: ', 'stand.heightIndividual': '高さ（0=未指定）: ', 'stand.unspecified': '未指定', 'stand.postfixPlaceholder': '1行に1つ。先頭の @ は一致時に本文から削除されます\r\n@怒り\r\n@必殺技', 'stand.noCharacterImages': 'キャラクター画像・顔アイコンが未設定です', 'stand.testMessage': 'これは自分だけに見えるテストです。立ち絵を調整するときは、個人設定で「立ち絵をフェードアウトして自動退場」をオフにすると微調整しやすくなります。',
  'stand.help': `　キャラクター立ち絵の名前・位置・画像高さ（いずれも画面サイズ相対）、およびチャット送信時に表示する条件を設定できます。

　立ち絵設定名はチャットウィンドウとチャットパレットの一覧に表示され、選択できます。タグを設定すると、同一キャラでもタグごとに登場／退場アニメが再生されます。

　位置と高さは個別指定も可能です。個別位置を指定せず、高さが 0 の場合は全体設定を使います。縦位置調整（AdjY）は立ち絵画像の高さ相対です（例: -50% で下半分が画面下端の外へ隠れます）。

　条件の「指定画像」は、送信時のキャラクター画像または顔アイコンです。特殊条件として、チャット末尾が「@退場」または「@farewell」のときは必ず立ち絵を退場させます。

　優先順位（高い順）:
　　1. 「@退場」「@farewell」による退場
　　2. チャット／パレットで選択した名前
　　3. 「指定画像 かつ チャット末尾」
　　4. 「指定画像 または チャット末尾」
　　5. 「チャット末尾」
　　6. 「指定画像」
　どれにも当てはまらない場合は「デフォルト」。同順位が複数あるときはランダムに1つ選ばれます。

　チャット末尾の判定では全角半角・英字の大文字小文字を区別しません。他の BCDice 対応ツールとの互換のため、両側に空白がある「 ＞ 」と「 → 」は同一とみなします。
　また「@退場」「@farewell」や「@笑」のように @ で始まる条件では、一致した末尾の @ 以降が本文から取り除かれます（立ち絵の有効／条件一致に関わらず）。`,
  'sheet.switchImageSettings': '画像設定を切替',
  'sheet.data.cardBack': 'カード（裏面）',
  'stand.namePlaceholder': '名前',
  'sheet.sendToChat': 'チャットに送る',
  'sheet.placeholder.value': '値',
  'sheet.placeholder.opacity': '不透明度',
  'sheet.placeholder.number': '数値',
  'sheet.placeholder.note': 'メモ',
  'sheet.placeholder.option': 'オプション',
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
  'sheet.data.heightScale': '× サイズ',
};
