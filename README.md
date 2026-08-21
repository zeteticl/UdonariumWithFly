# Udonarium (Udon) @ HKTRPG

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

---

[Udonarium](https://github.com/TK11235/udonarium) is a browser-based tool that supports online board-game / TRPG sessions.

This project is an [HKTRPG](https://www.hktrpg.com/) fork of [Udonarium with Fly](https://github.com/NanasuNANA/UdonariumWithFly): multi-language UI (default Traditional Chinese), plus VTT-oriented tools (lighting, combat, keyboard controls, etc.), while keeping With Fly extensions such as altitude, standees (Stand), Cut-in, and chat text colors.

<p align="center">
  <img src="docs/images/2d.jpg" alt="2D clue board" width="32%">
  <img src="docs/images/music.jpg" alt="Multi-track BGM" width="32%">
  <img src="docs/images/save.jpg" alt="Fully automatic folder backup" width="32%">
</p>

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/TK11235/udonarium/blob/master/LICENSE)

## Try it now

- **This site (Udon @ HKTRPG)**: https://z01.hktrpg.com/
- Original demo: https://udonarium.app/
- With Fly demo: https://nanasunana.github.io/

Recommended browser: desktop Google Chrome (HTTPS required).

## Features

- **Online sessions**
  - Rooms and multiple tabletops
  - Table masks and 3D terrain
  - Tokens, cards, shared notes
  - Chat and Chat Palette
  - Dice bot ([BCDice](https://github.com/bcdice/bcdice-js))
  - Shared images, BGM (ZIP saves include uploaded audio), ZIP save data, fully automatic local folder backup (File System Access API)

- **Browser-to-browser networking**
  - WebRTC via [SkyWay](https://skyway.ntt.com/); work after connect stays mostly in the browser

- **Lightweight realtime**
  - Actions sync live to other participants

## Additions in this fork (vs With Fly / original)

| Feature | Description |
|---------|-------------|
| Multi-language UI | Switch 繁中 / 简中 / English / 日本語 at runtime (menu; persisted) |
| Guided tour | First-run overlay walkthrough (rooms & save, menus including preset scenes / scenario text, table gestures, shortcuts); welcome language picker; skip anytime; replay from Settings |
| Hover teaching tips | Hover menu / chat controls for tip boxes; toggle in Settings; suppressed during the tour |
| HKTRPG branding | Title, favicon, OG tags, landing page |
| Role-based rooms | Per-role GM / User / Guest gates (open / password / disabled) |
| Role invite links | Copy deep links for each role; join with password prompt when needed |
| Guest mode | Restricted guest UI (no save, limited menus); legacy “allow guest” still supported |
| Clarify mode | Compact chat toolbar toggle |
| Note inventory | Table / shared / private / trash; text／image／video／PDF, handout, self-only (like tokens) |
| Map-mask actions | Alt+double-click (multi-select): chat/dice, music, cut-in, note handout, switch map, apply preset, appearance A/B, token FX |
| Quick roll | Send character-sheet fields to chat for BCDice in one click |
| Keyboard token controls | Select → WASD/arrows move; Shift+WASD face; Delete; Ctrl+C/X/V; Ctrl+Shift+V temp Token (characters only); Ctrl+Z undo / Ctrl+Y (or Ctrl+Shift+Z) redo; `[`/`]` layer; Alt(+Shift)/Ctrl+Shift+wheel rotate; Ctrl+Shift+D toggles DEBUG pose; Shift drop skips snap |
| Object import／export | Settings panels: Import / Export ZIP; characters also Download as JSON (CCFOLIA; Ctrl+V paste) |
| Context-menu cleanup | Frequent actions on L1; Appearance/FX and Token settings nested; empty-map Add object; redundant Create copy removed |
| Hover overview pin | Hover token shows preview; pin keeps it open; fades out ~0.5s after leave; closes on delete/trash |
| Undo / redo | Local stack: move / rotate / delete / cut-paste / layer / path move; scene create / delete / nudge. Guests blocked; ignored in text fields (browser handles text undo) |
| Path move | Select one token → Ctrl+left waypoints (draft stays after release) → left-click destination or Space to go; right-click undoes last waypoint; Esc cancels |
| Selection UX | Click / box select; Shift+click/drag multi-select; double-click details; selection highlight |
| Ping | Long-press map for a marker; Shift+long-press for a warning |
| Table lighting & vision | Darkness / FoW, lights, walls, vision ranges; claim vision character |
| Scene tools | GM light / wall / draw / text tools; optional per-tool player permissions |
| Menu visibility perms | GM can hide player menus; **default on**: images / music / toolbox / inventory / notes; **default off**: table / scene preset / scenario text; connection / chat / combat / settings / disconnect always visible |
| Load room data perms | Load ZIP / folder restore **GM-only by default** (can enable for players) |
| Combat tracker | Initiative, rounds/turns, announce, end turn, defeated skip |
| Player token claim | “My character”: default chat speaker, vision, others can’t move it |
| Weather | Rain / snow / sakura / maple / aurora / etc. on table settings; optional weather SE (dedicated jukebox track) |
| 2D mode | Top-down camera + flat character/dice; notes stay flat on 2D maps |
| Image FX | Grayscale, sepia, contrast, flip, silhouette, Matrix, … on tokens / stands / chat icons / sheets |
| Status / aura / ring / dead | Token status icons, auras, ring FX; dead synced with combat defeated |
| Reload save prompt | F5 / Ctrl+R offers ZIP download; with a bound folder, flushes backup before reload (skipped for guests) |
| Fully automatic local folder backup | File System Access API: bind a folder once, then auto-overwrite per-room ZIPs; Connection panel can bind / save / load / delete (see below) |
| Multi-track BGM / ambience | Up to 4 tracks; **max 20MB per file**; room track volume; local ambience volume; audition is local-only |
| Preset scenes | Save / one-click restore token poses, table atmosphere (darkness, weather, lights, walls, masks, …), and multi-track BGM (optional switch chat text); chat windows can open multiple copies |
| Character resource HUD | ± / drag numberResource for claimed PCs (toggle in Settings) |
| Scenario text | Draft narration and send full text or a selection to the active chat tab (speaker: title / character / player; character + 「」 triggers floating dialog) |
| Group whisper tabs | Member-based private chat tabs (client-side filter, same class as whispers) |
| Chat window memory | Remembers last size & position (local); new windows reuse geometry; shorter default height |
| Auto-open chat | Settings*: open chat when someone speaks if no chat window is open (default off) |
| Chat unread badge | Unread count on the menu chat icon while no chat panel is open |
| View reset / close panels | Available to everyone (Settings / More / right-click); not gated by toolbox menu permission |
| Lobby on start | Cold start opens Lobby when not in a room (skipped for invite join) |
| Multi-map placements | Same object can sit on several tables; pose kept when switching maps; rotation/appearance independent per map (peers don’t overwrite); notes supported |
| Temporary token copy | Ctrl+drag a character for a temp copy (not sent to graveyard) |
| Inventory multi-place | Shift multi-select / Select All, then drag onto the table |
| Preset scene preview / keep tokens | Thumbnail preview; “Apply (keep tokens)” keeps current poses; inventory bound to viewed map |
| Panel geometry memory | All panels remember size/position (local); rearrange panels available |
| GM kick | GM can kick a peer from the Connection panel |
| V3 mesh-lock | When every enabled role has a password, SkyWay channel uses sealed mesh lock |
| PWA update hint | Connection panel shows when a new version is ready to reload |
| Mobile UX | Icon-grid nav/action sheets with snap sizing; chat toolbar & map HUD/toolbox exclusivity; hover teaching tips desktop-only |
| Character JSON | JSON for easy import/export; CCFOLIA-compatible (Ctrl+V on table; export from character sheet) |
| Note flip | Back art when set; otherwise mirror the face (pins stay upright); handouts follow |

Inherited from With Fly: altitude, chat text color, standees (Stand), Cut-in, dice-bot tables, SkyWay 2023 (`@skyway-sdk`), etc. This fork uses a self-hosted backend (do not point at public WithFly Workers).

- Full user guide (Traditional Chinese): [Udonarium guide (wiki)](https://wiki.hktrpg.com/TRPG/Udonarium烏冬教學) (repo: [`docs/hktrpg-tutorial.zh-TW.md`](docs/hktrpg-tutorial.zh-TW.md))
- Feature checklist: [`docs/hktrpg-feature-inventory.md`](docs/hktrpg-feature-inventory.md)

### Fully automatic local folder backup

Room state is still live P2P sync; empty rooms disappear from the lobby, so continuity needs a local ZIP or folder backup. On Chrome / Edge (HTTPS), bind a folder once via the **File System Access API** — after that, multi-room saves write fully automatically.

**Entry points (Connection panel, non-guest)**

- **Bind / re-authorize** a folder (when unbound or permission expired)
- **Save room**: write the current room immediately
- **Load room**: list backups in the folder; delete supported; if not in a room, create a room first then load
- Status text notes that room changes are saved to the folder automatically

The toolbox menu also has a full “Folder backup” submenu; the empty-table right-click compact menu omits ZIP / backup items. Classic Download / Load ZIP remain available.

**Auto-store rules**

| Rule | Behavior |
|------|----------|
| Debounce 5s | After a change, wait 5 seconds before writing |
| Min interval 30s | While playing, at least 30 seconds between successful writes |
| One file per room | `{roomId}.zip` + `{roomId}.meta.json` (display name, savedAt, join toggles); same `roomId` overwrites |
| Role passwords | Never stored plaintext in the folder; encrypted with a browser-local key + per-write salt/IV (PBKDF2→AES-GCM) into meta `secrets`. Other browsers/devices require re-entering passwords (next save encrypts them) |
| Immediate flush | “Save room”, leave / switch room, switch to Guest, logout, F5 / Ctrl+R, and SW update reload flush first |
| Guests | Cannot bind, auto-write, manual save, or load from folder |
| Browser | Needs `showDirectoryPicker` in a secure context (desktop Chrome / Edge recommended); may need re-authorization after reload |
| No auto-load on join | A local backup with the same `roomId` never overwrites a live peer tabletop on join; load is always manual |

**Restore semantics**: “Resume room” from the folder reuses the backup `roomId` (plus name/toggles/decryptable passwords) so auto-backup overwrites the same files. Loading into a live room with a different `roomId` forks under the current ID. Loading into a connected room replaces the tabletop and syncs to other participants.

## Local development

Requires Node.js, npm, and a self-hosted [udonarium-backend](https://github.com/TK11235/udonarium-backend) (SkyWay Auth Token).  
**Do not** point local / HKTRPG sites at the public WithFly Workers (only `nanasunana.github.io` Origin is allowed).

See:

- [`docs/hktrpg-backend.md`](docs/hktrpg-backend.md) — local backend, CORS, proxy
- [`docs/hktrpg-deploy.md`](docs/hktrpg-deploy.md) — production Workers + frontend
- [`docs/hktrpg-sync.md`](docs/hktrpg-sync.md) — sync upstream WithFly

```bash
npm i
# Edit src/assets/config.yaml (gitignored); set backend.url
# Recommended: Angular proxy → local :8787; see proxy.conf.js
npx ng serve --ssl --host 127.0.0.1 --port 4200 --proxy-config proxy.conf.js
```

Production build:

```bash
ng build
```

Output is in `dist/`. Before deploy, set `backend.url` to your Workers URL and `ACCESS_CONTROL_ALLOW_ORIGIN` to your site Origin (e.g. `https://z01.hktrpg.com`).

### BCDice-API (optional)

Set `dice.url` in `config.yaml` to use BCDice-API; default API version is 2 (success/failure coloring needs v2).

```yaml
backend:
  mode: skyway2023
  url: https://{your-backend-hostname}/
dice:
  url: # BCDice-API endpoint
  api: 2
```

## Upstream

1. [TK11235/udonarium](https://github.com/TK11235/udonarium) — original Udonarium  
2. [NanasuNANA/UdonariumWithFly](https://github.com/NanasuNANA/UdonariumWithFly) — With Fly (altitude, standees, Cut-in, etc.)

See upstream READMEs for original development / contribution notes. Open Issues / PRs on the matching upstream or this fork (HKTRPG-related).

For HKTRPG Bot (chat-platform dice, character sheets, etc.): [HKTRPG guide](https://bothelp.hktrpg.com/guide).

## License

[MIT License](https://github.com/TK11235/udonarium/blob/master/LICENSE)

Respect the licenses and attribution of Udonarium, Udonarium with Fly, and third-party assets (images / audio), including each original project and `src/assets/**/copyright.txt`, `license.txt`.
