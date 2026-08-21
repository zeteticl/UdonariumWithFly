# Udonarium 烏冬 @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium（ユドナリウム）](https://github.com/TK11235/udonarium) 是在 Web 瀏覽器中運作的桌遊／TRPG 線上團務支援工具。

本專案是以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 為基底的 [HKTRPG](https://www.hktrpg.com/) 改造版：多語介面（預設繁體中文），並加入光照、戰鬥追蹤、鍵盤操控等 VTT 向工具；同時保留 With Fly 的高度、立繪（Stand）、Cut-in、聊天文字顏色等擴充。

<p align="center">
  <img src="docs/images/2d.jpg" alt="2D 線索版" width="32%">
  <img src="docs/images/music.jpg" alt="多軌 BGM" width="32%">
  <img src="docs/images/save.jpg" alt="資料夾全自動備份" width="32%">
</p>

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## 立即試用

- **本站（烏冬 @ HKTRPG）**：https://z01.hktrpg.com/
- 本家試用：https://udonarium.app/
- With Fly 試用：https://nanasunana.github.io/

推薦瀏覽器：桌面版 Google Chrome（需 HTTPS）。

## 功能

- **線上團務**
  - 房間、多桌面管理
  - 桌面遮罩、立體地形
  - 棋子、卡片、共用備忘
  - 聊天與指令板（Chat Palette）
  - 骰子機器人（[BCDice](https://github.com/bcdice/bcdice-js)）
  - 圖片共用、BGM（ZIP 含已上傳的音訊）、ZIP 存檔、本機資料夾全自動備份（File System Access API）

- **瀏覽器間通訊**
  - 以 WebRTC（[SkyWay](https://skyway.ntt.com/)）連接；連線後處理盡量在瀏覽器完成

- **輕量即時**
  - 操作即時同步給其他參加者

## 本專案追加（相對於 With Fly／本家）

| 功能 | 說明 |
|------|------|
| 多語介面 | 執行時切換 繁中／简中／English／日本語（選單；會記住） |
| 引導教學 | 首次進入的分步遮罩導覽（房間與存檔、左側選單含預設場面／劇本文字、桌面手勢、快捷鍵）；歡迎頁可選語言；可隨時略過；可在設定中重播 |
| 滑過教學提示 | 滑過選單／聊天控件顯示教學 BOX；設定中可開關；引導進行中會暫時關閉 |
| HKTRPG 品牌 | 標題、favicon、OG、落地頁 |
| 角色權限房間 | GM／User／Guest 各自開放／密碼／停用 |
| 角色邀請連結 | 可複製各角色深連結；需要時再輸入密碼 |
| 訪客模式 | 訪客 UI 受限（無法存檔、選單受限）；仍支援舊版「允許訪客」 |
| 精簡模式（ClarifyMode） | 聊天工具列精簡顯示切換 |
| 筆記倉庫 | 依桌面／共用／私人／墳場整理；文字／圖片／影片／PDF、handout、僅自己可見（同 Token） |
| 地圖遮罩動作 | Alt＋雙擊觸發（可複選）：聊天／骰子、音樂、Cut-in、筆記出示、切地圖、套用場面、外觀 A/B、Token 效果 |
| 快速擲骰 | 角色卡欄位一鍵送到聊天給 BCDice 結算 |
| 鍵盤操控棋子 | 選取後 WASD／方向鍵移動；Shift+WASD 面向；Delete；Ctrl+C/X/V；Ctrl+Shift+V 暫存 Token（僅角色）；Ctrl+Z 復原／Ctrl+Y（或 Ctrl+Shift+Z）重做；`[`/`]` 圖層；Alt(+Shift)／Ctrl+Shift+滾輪旋轉；Ctrl+Shift+D 開關 DEBUG pose；Shift 放下不吸附 |
| 物件匯入／匯出 | 設定面板「匯入」「匯出」ZIP；角色另有「下載為 JSON」（CCFOLIA；Ctrl+V 可貼上） |
| 右鍵選單整理 | 常按項一級；外觀／特效與 TOKEN 設定分層；空白地圖「新增物件」收合；與複製貼上重複的建立副本已移除 |
| 浮動預覽釘選 | Hover Token 顯示預覽；釘選可固定；移開約 0.5 秒淡出；刪除／回收後關閉 |
| 復原／重做 | 本機堆疊：移動／旋轉／刪除／剪下貼上／圖層／路徑移動；場景工具建立／刪除／微移。訪客不可用；輸入框內不攔截（由瀏覽器處理文字復原） |
| 路徑移動 | 選取單一 Token → Ctrl+左鍵設路點（放開 Ctrl 仍保留）→ 左鍵點終點或 Space 開始移動；右鍵取消最後路點；Esc 取消路徑 |
| 選取體驗 | 點選／框選；Shift+點／拖曳多選；雙擊詳情；選取高亮 |
| Ping | 長按地圖標記；Shift+長按警告 |
| 桌面光照與視野 | 黑暗／FoW、燈光、牆、視野距離；可宣告視野角色 |
| 場景工具 | GM 燈光／牆／繪圖／文字；可選開放玩家工具權限 |
| 選單可見權限 | GM 可隱藏玩家選單；**預設開**圖片／音樂／工具箱／倉庫／筆記；**預設關**地圖／預設場面／劇本文字；連線／聊天／戰鬥／設定／切斷永遠可見 |
| 讀取房間資料權限 | 讀取 ZIP／從資料夾載入房間**預設僅 GM**（可開放給玩家） |
| 戰鬥追蹤 | 先攻、回合、宣告、結束回合、擊敗跳過 |
| 玩家認領角色 | 「作為我的角色」：預設發言、視野、他人不可移動 |
| 天氣 | 雨／雪／櫻花／楓葉／極光等（桌面設定）；可開關天氣效果音（獨立曲庫軌） |
| 2D 模式 | 俯視相機＋角色／骰子平面繪製；筆記在 2D 地圖固定平放 |
| 圖片特效 | 灰階、懷舊、對比、翻轉、剪影、Matrix…（棋子／立繪／聊天圖示／角色卡） |
| 狀態／光環／環／死亡 | 狀態圖示、光環、環特效；死亡與戰鬥擊敗同步 |
| 重新整理存檔提示 | F5／Ctrl+R 可先下載 ZIP；已綁定資料夾時會先 flush 再重新整理（訪客略過） |
| 本機資料夾全自動備份 | File System Access API：綁定一次後依房間自動覆寫 ZIP；連線面板可綁定／儲存／讀取／刪除（見下方） |
| 多軌 BGM／環境音 | 最多 4 軌並行；每檔最大 **20MB**；房間曲目音量；本機環境音音量；試聽不廣播 |
| 預設場面 | 儲存／一鍵還原目前地圖上的 token 位置、桌面氣氛（黑暗、天氣、燈光、牆、遮罩等）與多軌 BGM（可附切場文字）；聊天視窗可多開 |
| 角色資源 HUD | 認領角色的 numberResource ±／拖曳（設定中開關） |
| 劇本文字 | GM／玩家預寫長文／選取片段一鍵送目前聊天分頁（發言名可選標題、角色或玩家；角色＋「」會觸發浮動對話） |
| 群組私聊分頁 | 成員制私人聊天 tab（客戶端過濾，與密語同級） |
| 聊天視窗記憶 | 記住最後調整的大小與位置（本機）；新開套用同一幾何；預設高度較矮 |
| 發言自動開聊天 | 設定\* 可選「無聊天視窗時有人發言則自動開啟」（預設關） |
| 聊天未讀標記 | 未開聊天視窗時，選單聊天 icon 顯示未讀數量 |
| 視點重置／清空視窗 | 所有人可用（設定／更多／右鍵）；不依賴工具箱選單權限 |
| 開站顯示大廳 | 尚未進房時以一般視窗自動開啟大廳（不蓋黑幕；邀請連結進房則略過） |
| 多地圖 placement | 同一物件可放在多張地圖；切圖保留姿態；各圖旋轉／外觀獨立（跨玩家不互蓋）；筆記亦支援 |
| 暫存複本 | Ctrl＋拖曳角色產生臨時 token（不進回收區） |
| 倉庫多選放置 | Shift 多選／全選後拖放到桌面 |
| 場面預覽／保留棋子 | 預設場面縮圖；「套用（保留棋子）」保留目前姿態；倉庫依目前地圖綁定 |
| 面板幾何記憶 | 各面板記住大小／位置（本機）；可重排面板 |
| GM 踢出 | 連線面板可將參加者踢出房間 |
| V3 網路鎖 | 啟用中的角色皆設密碼時，SkyWay 頻道使用 mesh-lock |
| PWA 更新提示 | 連線面板顯示有新版本可重新載入 |
| 曲庫資料夾匯入 | 各資料夾可加連結／上傳；OS 拖檔高亮目標資料夾；多選拖曳與 Delete 刪除 |
| 備份可略過音樂 | ZIP／資料夾備份可選不含音樂檔（彈窗＋個人設定＊）；自動備份套用預設 |
| Esc 關閉視窗 | Esc 先關選單／對話框與取消選取，再關最前可關視窗 |
| 手機 UX | 圖示格導覽／動作表、吸附尺寸；聊天工具列與地圖 HUD／工具箱互斥；滑過教學提示僅桌面 |
| 角色 JSON | JSON 方便匯入／匯出，兼容 CCFOLIA 格式（桌面 Ctrl＋V；角色詳情匯出） |
| 筆記翻面 | 有背面圖顯示背面；無則鏡像正面（針腳保持正向）；handout 跟隨 |

繼承自 With Fly：高度、聊天文字顏色、立繪（Stand）、Cut-in、骰子機器人表、SkyWay 2023（`@skyway-sdk`）等。本 fork 使用自架 backend（請勿指向 WithFly 公開 Workers）。

- 完整使用教學：[Udonarium 烏冬教學（百科）](https://wiki.hktrpg.com/TRPG/Udonarium烏冬教學)（repo：[`docs/hktrpg-tutorial.zh-TW.md`](docs/hktrpg-tutorial.zh-TW.md)）
- 功能驗收清單：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

### 本機資料夾全自動備份（Folder Backup）

房間狀態仍以 P2P 即時同步為主；空房從大廳消失後，需靠本機 ZIP／資料夾備份延續。Chrome／Edge（HTTPS）可透過 **File System Access API** 綁定本機資料夾一次，之後全自動寫入多房間存檔。

**入口（連線面板，非訪客）**

- **綁定／重新授權**資料夾（尚未綁定或權限失效時）；綁定時可選是否含音樂
- **儲存房間**：立即寫入目前房間
- **讀取房間**：列出資料夾內備份；可刪除；未進房可先建房再載入；hover 可**更改資料夾**／**斷開資料夾**
- 狀態列會提示「房間變更會自動儲存到此資料夾」；是否含音樂亦可在**個人設定***調整

工具箱選單也有完整「資料夾備份」子選單；空白處右鍵精簡選單不含 ZIP／備份項。既有「下載／讀取 ZIP」仍可用（下載前會詢問是否含音樂）。

**自動儲存規則**

| 規則 | 說明 |
|------|------|
| Debounce 5 秒 | 桌面變更後等待 5 秒再寫入 |
| 最短間隔 30 秒 | 遊玩中兩次成功寫入至少間隔 30 秒 |
| 一房一檔 | 檔名 `{roomId}.zip` + `{roomId}.meta.json`（顯示名、儲存時間、加入開關）；同 roomId 覆寫 |
| 角色密碼 | 不以明文寫入資料夾；以本機瀏覽器金鑰＋每次隨機 salt／IV（PBKDF2→AES-GCM）加密後存於 meta 的 `secrets`。換瀏覽器／裝置需重填密碼（下一次儲存會加密寫入） |
| 立即寫出 | 「儲存房間」、退出／換房、切換為訪客、登出、F5／Ctrl+R、SW 更新重新載入前會 flush |
| 訪客 | 不可綁定、自動寫、手動儲存或從資料夾載入 |
| 音樂檔 | 可略過（檔案較大）；綁定資料夾／ZIP／個人設定＊可選；略過時仍保存曲庫結構 |
| 瀏覽器 | 需支援 `showDirectoryPicker` 的安全情境（建議桌面 Chrome／Edge）；重新整理後可能需再授權一次 |
| 進房不自動載入 | 即使本機有同 roomId 備份，也不會在加入線上房間時覆寫 peer 桌面；載入一律手動 |

**還原語意**：從資料夾「恢復房間」會沿用備份的 `roomId`（與名稱／開關／可解密時的密碼），之後自動備份覆寫同一檔。若在已連線的不同 roomId 房間載入，則會以目前房間 ID 另存（fork）。載入進已連線房間會覆寫桌面並同步給其他參加者。

## 本機開發

需要 Node.js、npm，以及自架的 [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）。  
**請勿**把本機／HKTRPG 站點指向 WithFly 公開 Workers（僅允許 `nanasunana.github.io` Origin）。

詳見：

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — 本機 backend、CORS、proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — 正式環境 Workers＋前端
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — 同步 upstream WithFly

```bash
npm i
# 編輯 src/assets/config.yaml（gitignored），設定 backend.url
# 建議：Angular proxy → 本機 :8787，見 proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

正式建置：

```bash
ng build
```

產物在 `dist/`。部署前請將 `backend.url` 設為你的 Workers URL，並讓 `ACCESS_CONTROL_ALLOW_ORIGIN` 等於站點 Origin（例如 `https://z01.hktrpg.com`）。

### BCDice-API（可選）

在 `config.yaml` 設定 `dice.url` 後可改走 BCDice-API；預設 API 版本為 2（成功／失敗著色需要 v2）。

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API 端點
  api: 2
```

## 上游專案

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（高度、立繪、Cut-in 等）

本家開發與貢獻說明請見上游 README。Issue／PR 請開到對應上游或本 fork（HKTRPG 相關）。

聊天平台擲骰、角色卡等 HKTRPG Bot 功能請見：[HKTRPG 使用教學](https://bothelp.hktrpg.com/guide)。

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 與第三方素材（圖片／音效）之授權與署名，請一併遵守各原始專案與 `src/assets/**/copyright.txt`、`license.txt`。
