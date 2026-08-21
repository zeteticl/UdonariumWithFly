# Udonarium 乌冬 @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium（ユドナリウム）](https://github.com/TK11235/udonarium) 是在 Web 浏览器中运行的桌游／TRPG 在线跑团支援工具。

本项目是以 [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly) 为基底的 [HKTRPG](https://www.hktrpg.com/) 改造版：多语言界面（默认繁体中文），并加入光照、战斗追踪、键盘操控等 VTT 向工具；同时保留 With Fly 的高度、立绘（Stand）、Cut-in、聊天文字颜色等扩展。

<p align="center">
  <img src="docs/images/2d.jpg" alt="2D 线索板" width="32%">
  <img src="docs/images/music.jpg" alt="多轨 BGM" width="32%">
  <img src="docs/images/save.jpg" alt="文件夹全自动备份" width="32%">
</p>

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## 立即试用

- **本站（乌冬 @ HKTRPG）**：https://z01.hktrpg.com/
- 本家试用：https://udonarium.app/
- With Fly 试用：https://nanasunana.github.io/

推荐浏览器：桌面版 Google Chrome（需 HTTPS）。

## 功能

- **在线跑团**
  - 房间、多桌面管理
  - 桌面遮罩、立体地形
  - 棋子、卡片、共用备忘
  - 聊天与指令板（Chat Palette）
  - 骰子机器人（[BCDice](https://github.com/bcdice/bcdice-js)）
  - 图片共用、BGM（ZIP 含已上传的音频）、ZIP 存档、本地文件夹全自动备份（File System Access API）

- **浏览器间通信**
  - 以 WebRTC（[SkyWay](https://skyway.ntt.com/)）连接；连接后处理尽量在浏览器完成

- **轻量实时**
  - 操作实时同步给其他参加者

## 本项目追加（相对于 With Fly／本家）

| 功能 | 说明 |
|------|------|
| 多语言界面 | 运行时切换 繁中／简中／English／日本語（菜单；会记住） |
| 引导教学 | 首次进入的分步遮罩导览（房间与存档、左侧菜单含预设场面／剧本文字、桌面手势、快捷键）；欢迎页可选语言；可随时跳过；可在设定中重播 |
| 悬停教学提示 | 悬停菜单／聊天控件显示教学 BOX；设定中可开关；引导进行中会暂时关闭 |
| HKTRPG 品牌 | 标题、favicon、OG、落地页 |
| 角色权限房间 | GM／User／Guest 各自开放／密码／停用 |
| 角色邀请链接 | 可复制各角色深链接；需要时再输入密码 |
| 访客模式 | 访客 UI 受限（无法存档、菜单受限）；仍支持旧版「允许访客」 |
| 精简模式（ClarifyMode） | 聊天工具栏精简显示切换 |
| 笔记仓库 | 按桌面／共用／私人／坟场整理；文字／图片／视频／PDF、handout、仅自己可见（同 Token） |
| 地图遮罩动作 | Alt＋双击触发（可多选）：聊天／骰子、音乐、Cut-in、笔记出示、切地图、套用场面、外观 A/B、Token 效果 |
| 快速掷骰 | 角色卡字段一键送到聊天给 BCDice 结算 |
| 键盘操控棋子 | 选取后 WASD／方向键移动；Shift+WASD 面向；Delete；Ctrl+C/X/V；Ctrl+Shift+V 暂存 Token（仅角色）；Ctrl+Z 撤销／Ctrl+Y（或 Ctrl+Shift+Z）重做；`[`/`]` 图层；Alt(+Shift)／Ctrl+Shift+滚轮旋转；Ctrl+Shift+D 开关 DEBUG pose；Shift 放下不吸附 |
| 物件导入／导出 | 设置面板「导入」「导出」ZIP；角色另有「下载为 JSON」（CCFOLIA；Ctrl+V 可粘贴） |
| 右键菜单整理 | 常用项一级；外观／特效与 TOKEN 设置分层；空白地图「新增物件」收合；与复制粘贴重复的创建副本已移除 |
| 浮动预览钉选 | Hover Token 显示预览；钉选可固定；移开约 0.5 秒淡出；删除／回收后关闭 |
| 撤销／重做 | 本机堆叠：移动／旋转／删除／剪切粘贴／图层／路径移动；场景工具创建／删除／微移。访客不可用；输入框内不拦截（由浏览器处理文字撤销） |
| 路径移动 | 选取单个 Token → Ctrl+左键设路点（放开 Ctrl 仍保留）→ 左键点终点或 Space 开始移动；右键取消最后路点；Esc 取消路径 |
| 选取体验 | 点选／框选；Shift+点／拖曳多选；双击详情；选取高亮 |
| Ping | 长按地图标记；Shift+长按警告 |
| 桌面光照与视野 | 黑暗／FoW、灯光、墙、视野距离；可宣告视野角色 |
| 场景工具 | GM 灯光／墙／绘图／文字；可选开放玩家工具权限 |
| 菜单可见权限 | GM 可隐藏玩家菜单；**默认开**图片／音乐／工具箱／仓库／笔记；**默认关**地图／预设场面／剧本文字；连接／聊天／战斗／设定／切断始终可见 |
| 读取房间数据权限 | 读取 ZIP／从文件夹载入房间**默认仅 GM**（可开放给玩家） |
| 战斗追踪 | 先攻、回合、宣告、结束回合、击败跳过 |
| 玩家认领角色 | 「作为我的角色」：默认发言、视野、他人不可移动 |
| 天气 | 雨／雪／樱花／枫叶／极光等（桌面设定）；可开关天气效果音（独立曲库轨） |
| 2D 模式 | 俯视相机＋角色／骰子平面绘制；笔记在 2D 地图固定平放 |
| 图片特效 | 灰度、怀旧、对比、翻转、剪影、Matrix…（棋子／立绘／聊天图标／角色卡） |
| 状态／光环／环／死亡 | 状态图标、光环、环特效；死亡与战斗击败同步 |
| 重新加载存档提示 | F5／Ctrl+R 可先下载 ZIP；已绑定文件夹时会先 flush 再重新加载（访客跳过） |
| 本地文件夹全自动备份 | File System Access API：绑定一次后按房间自动覆盖 ZIP；连接面板可绑定／保存／读取／删除（见下方） |
| 多轨 BGM／环境音 | 最多 4 轨并行；每档最大 **20MB**；房间曲目音量；本机环境音音量；试听不广播 |
| 预设场面 | 保存／一键还原当前地图上的 token 位置、桌面气氛（黑暗、天气、灯光、墙、遮罩等）与多轨 BGM（可附切场文字）；聊天窗口可多开 |
| 角色资源 HUD | 认领角色的 numberResource ±／拖曳（设定中开关） |
| 剧本文字 | GM／玩家预写长文／选取片段一键送当前聊天分页（发言名可选标题、角色或玩家；角色＋「」会触发浮动对话） |
| 群组私聊分页 | 成员制私人聊天 tab（客户端过滤，与密语同级） |
| 聊天窗口记忆 | 记住最后调整的大小与位置（本机）；新开套用同一几何；默认高度较矮 |
| 发言自动开聊天 | 设定\* 可选「无聊天窗口时有人发言则自动打开」（默认关） |
| 聊天未读标记 | 未开聊天窗口时，菜单聊天 icon 显示未读数量 |
| 视点重置／清空窗口 | 所有人可用（设定／更多／右键）；不依赖工具箱菜单权限 |
| 开站显示大厅 | 尚未进房时自动开启大厅（邀请链接进房则跳过） |
| 多地图 placement | 同一物件可放在多张地图；切图保留姿态；各图旋转／外观独立（跨玩家不互盖）；笔记亦支持 |
| 暂存复本 | Ctrl＋拖曳角色产生临时 token（不进回收区） |
| 仓库多选放置 | Shift 多选／全选后拖放到桌面 |
| 场面预览／保留棋子 | 预设场面缩图；「套用（保留棋子）」保留目前姿态；仓库依目前地图绑定 |
| 面板几何记忆 | 各面板记住大小／位置（本机）；可重排面板 |
| GM 踢出 | 连线面板可将参加者踢出房间 |
| V3 网络锁 | 启用中的角色皆设密码时，SkyWay 频道使用 mesh-lock |
| PWA 更新提示 | 连线面板显示有新版本可重新加载 |
| 手机 UX | 图标格导览／动作表、吸附尺寸；聊天工具栏与地图 HUD／工具箱互斥；悬停教学提示仅桌面 |
| 角色 JSON | JSON 方便导入／导出，兼容 CCFOLIA 格式（桌面 Ctrl＋V；角色详情导出） |
| 笔记翻面 | 有背面图显示背面；无则镜像正面（图钉保持正向）；handout 跟随 |

继承自 With Fly：高度、聊天文字颜色、立绘（Stand）、Cut-in、骰子机器人表、SkyWay 2023（`@skyway-sdk`）等。本 fork 使用自建 backend（请勿指向 WithFly 公开 Workers）。

- 完整使用教学（繁体中文）：[Udonarium 乌冬教学（百科）](https://wiki.hktrpg.com/TRPG/Udonarium烏冬教學)（repo：[`docs/hktrpg-tutorial.zh-TW.md`](docs/hktrpg-tutorial.zh-TW.md)）
- 功能验收清单：[`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

### 本地文件夹全自动备份（Folder Backup）

房间状态仍以 P2P 实时同步为主；空房从大厅消失后，需靠本地 ZIP／文件夹备份延续。Chrome／Edge（HTTPS）可通过 **File System Access API** 绑定本地文件夹一次，之后全自动写入多房间存档。

**入口（连接面板，非访客）**

- **绑定／重新授权**文件夹（尚未绑定或权限失效时）
- **保存房间**：立即写入当前房间
- **读取房间**：列出文件夹内备份；可删除；未进房可先建房再加载
- 状态行会提示「房间变更会自动保存到此文件夹」

工具箱菜单也有完整「文件夹备份」子菜单；空白处右键精简菜单不含 ZIP／备份项。既有「下载／读取 ZIP」仍可用。

**自动保存规则**

| 规则 | 说明 |
|------|------|
| Debounce 5 秒 | 桌面变更后等待 5 秒再写入 |
| 最短间隔 30 秒 | 游玩中两次成功写入至少间隔 30 秒 |
| 一房一档 | 文件名 `{roomId}.zip` + `{roomId}.meta.json`（显示名、保存时间、加入开关）；同 roomId 覆盖 |
| 角色密码 | 不以明文写入文件夹；以本机浏览器密钥＋每次随机 salt／IV（PBKDF2→AES-GCM）加密后存于 meta 的 `secrets`。换浏览器／设备需重填密码（下次保存会加密写入） |
| 立即写出 | 「保存房间」、退出／换房、切换为访客、登出、F5／Ctrl+R、SW 更新重新加载前会 flush |
| 访客 | 不可绑定、自动写、手动保存或从文件夹加载 |
| 浏览器 | 需支持 `showDirectoryPicker` 的安全上下文（建议桌面 Chrome／Edge）；刷新后可能需再授权一次 |
| 进房不自动加载 | 即使本地有同 roomId 备份，也不会在加入线上房间时覆盖 peer 桌面；加载一律手动 |

**还原语义**：从文件夹「恢复房间」会沿用备份的 `roomId`（与名称／开关／可解密时的密码），之后自动备份覆盖同一文件。若在已连接的不同 roomId 房间加载，则会以当前房间 ID 另存（fork）。加载进已连接房间会覆盖桌面并同步给其他参加者。

## 本地开发

需要 Node.js、npm，以及自建的 [udonarium-backend](https://github.com/TK11235/udonarium-backend)（SkyWay Auth Token）。  
**请勿**把本地／HKTRPG 站点指向 WithFly 公开 Workers（仅允许 `nanasunana.github.io` Origin）。

详见：

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — 本地 backend、CORS、proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — 正式环境 Workers＋前端
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — 同步 upstream WithFly

```bash
npm i
# 编辑 src/assets/config.yaml（gitignored），设定 backend.url
# 建议：Angular proxy → 本地 :8787，见 proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

正式构建：

```bash
ng build
```

产物在 `dist/`。部署前请将 `backend.url` 设为你的 Workers URL，并让 `ACCESS_CONTROL_ALLOW_ORIGIN` 等于站点 Origin（例如 `https://z01.hktrpg.com`）。

### BCDice-API（可选）

在 `config.yaml` 设定 `dice.url` 后可改走 BCDice-API；默认 API 版本为 2（成功／失败着色需要 v2）。

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API 端点
  api: 2
```

## 上游项目

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — Udonarium 本家  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly（高度、立绘、Cut-in 等）

本家开发与贡献说明请见上游 README。Issue／PR 请开到对应上游或本 fork（HKTRPG 相关）。

聊天平台掷骰、角色卡等 HKTRPG Bot 功能请见：[HKTRPG 使用教程](https://bothelp.hktrpg.com/guide)。

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Udonarium、Udonarium with Fly 与第三方素材（图片／音效）之授权与署名，请一并遵守各原始项目与 `src/assets/**/copyright.txt`、`license.txt`。
