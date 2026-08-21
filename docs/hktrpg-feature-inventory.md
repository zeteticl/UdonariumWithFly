# HKTRPG Feature Inventory (port source: `withfly220820`)

Behavior checklist for porting onto `hktrpg-main` (latest WithFly). Source of truth for acceptance.

| Feature | User-visible behavior | Primary sources on `withfly220820` | Acceptance |
|---------|----------------------|--------------------------------------|------------|
| Quick roll on sheet | Send button on character sheet fields posts `value name` (or `current/value name`) to chat so BCDice can resolve | `src/app/component/game-data-element/game-data-element.component.{ts,html}` | Click send → message appears on active chat tab |
| Note inventory | Panel「筆記倉庫」lists notes by table / common / private / graveyard | `src/app/component/note-inventory/*`, wiring in `app.module.ts`, `app.component.{ts,html}` | Open panel; create/move notes; sync to other peers |
| ClarifyMode | Toggle simplified chat presentation | `chat-window.component.*`, `chat-input.component.*` | Toggle changes chat UI as in old build |
| Guest mode | Room option「允許訪客」; guests join with restricted UI (no save, limited menus) | `guest-session.ts`, lobby/room-setting, `Network.GuestMode()`, menu/movable/rotable/tabletop-action gates | Host enables allow-guest; lobby shows 訪客; guest UI restricted; password rooms still need password (skyway2023) |
| HKTRPG / CHT | HKTRPG favicon/OG/title; landing page; high-traffic UI Traditional Chinese | root `index.html` (landing), `src/index.html`, selected UI strings | First paint + main flows show HKTRPG + zh-Hant |
| Keyboard token controls | Click to select; WASD move; Shift+WASD face; Delete; C/X/V (paste at cursor); [ ] layer; Alt(+Shift)/Ctrl+Shift+wheel rotate (±3° / ±45°); Shift on drop skips snap; Esc: menu/modal → clear draft/selection (before panels) → close frontmost panel; Ctrl+Shift+D toggles DEBUG pose | `tabletop-keyboard.service.ts`, `table-mouse-gesture.ts`, `movable.directive.ts`, rotable synchronizer, `game-table.component.*` | Select → keys/wheel; Esc clears selection before closing windows; DEBUG shows view/selection pose; text selection still copies text; paste follows pointer |
| Character JSON | JSON for easy import/export; CCFOLIA-compatible. Ctrl+V on table pastes OS clipboard character JSON; sheet exports `hktrpg_{name}_{datetime}.json` | `ccfolia-clipboard.ts`, `tabletop-keyboard.service.ts`, `game-character-sheet.component.*` | Paste CCFOLIA JSON → token; Export JSON from sheet → re-paste works |
| Hover overview pin | Hover token shows overview; pin keeps it open; unpin / leave fades out (~0.5s); closes when object leaves table | `tooltip.directive.ts`, `overview-panel.component.*` | Pin survives leave; delete/graveyard closes that panel |
| Undo / redo | Ctrl+Z undo; Ctrl+Y / Ctrl+Shift+Z redo. Covers move/rotate/delete/cut-paste/layer/path-move and scene create/delete/nudge. Local per-peer stack; guests blocked; ignored in INPUT/TEXTAREA | `undo.service.ts`, `tabletop-keyboard.service.ts`, movable/rotable synchronizers, `scene-tool.service.ts`, `token-path-move.service.ts` | Move token → Ctrl+Z restores; Ctrl+Y redoes; chat input Ctrl+Z still edits text |
| Guided tour | First-run overlay: rooms & save, menus (incl. preset scenes / scenario text), table gestures, shortcuts; welcome language picker; skip/replay from Settings | `guided-tour.service.ts`, `guided-tour-steps.ts`, `guided-tour.component.*`, i18n `*-tip.ts` | Fresh profile shows welcome → complete/skip; Settings replay includes new menu steps |
| Hover teaching tips | Hover menu/chat controls for tip boxes; Settings toggle; suppressed during tour | `teaching-tip.service.ts`, `teaching-tip.directive.ts`, `teaching-tip.component.*` | Hover Connection shows tip; disable in Settings stops tips |
| Path move | One token: Ctrl+left waypoints → left-click destination or Space to go; right-click undoes last; Esc cancels; recorded in undo | `token-path-move.service.ts`, `tabletop-keyboard.service.ts`, game-table HUD | Draft waypoints → Space moves; Esc clears; Ctrl+Z undoes path move |
| ZIP includes audio | Room ZIP can pack uploaded BGM / audio blobs; optional skip via prompt / Settings* (`udonarium.save.includeAudio`) | `save-data.service.ts` | Upload music → Download ZIP (include) → reload restores audio; exclude → smaller ZIP without blobs |
| Multi-track BGM | Up to 4 concurrent room tracks + local ambience; audition is local-only; **max 20MB per audio file**; per-folder import / OS drop target; library multi-select + Delete | `Jukebox.ts`, `jukebox.component.*`, `audio-library.ts`, `file-archiver.ts` | Play multiple tracks; drop files onto a folder; Ctrl/Shift select → Delete |
| Preset scenes | Save / apply tabletop poses, atmosphere, multi-track BGM (+ optional switch text); included in guided tour | `scene-preset*.ts`, `scene-preset.component.*`, `guided-tour-steps.ts` | Save scene → move tokens → Apply restores poses; tour step opens panel |
| Scenario text | Draft narration; send full / selection to active chat tab; character speaker with 「」 triggers floating dialog; included in guided tour | `scenario-text*.ts`, `scenario-text.component.*`, `chat-balloon.ts` | Create item → Send / Send selection appears in chat; character + 「」 shows bubble |
| Multiple chat windows | Opening Chat from the menu does not close existing chat panels; remembers last size/position (local); shorter default height | `app.component.ts` `open()`, `chat-window.component.ts` geometry | Open Chat twice → two panels; resize → reopen keeps size |
| Auto-open chat | Settings (default off): if no chat window is open and someone else speaks, open chat | `ChatWindowComponent.isAutoPopup`, `MESSAGE_NORTIFICATION` in `app.component.ts` | Enable setting → close chat → peer speaks → chat opens |
| Chat unread badge | Menu chat icon shows unread count pill when chat panel is closed | `app.component.{ts,html,css}`, `ChatTabList.unreadLength` | Close chat → peer speaks → red count on chat menu icon |
| Menu visibility perms | GM toggles which menus players see; defaults on: images/music/toolbox/inventory/notes; off: table/scene preset/scenario text; connection/chat/combat/settings/disconnect always on | `scene-tool-permission.ts`, `permission-setting.component.*`, `app.component` `canShowMenu` | Uncheck table as GM → player loses table menu; right-click map settings gated the same |
| Load ZIP／room GM-only | In-room load ZIP / folder restore default GM-only; GM can enable for players | `scene-tool-permission.ts` `canLoadZip`/`canLoadRoom`, peer-menu / toolbox / lobby | Player sees disabled load until GM enables |
| Always-on view helpers | View reset + close-all-panels available to everyone (Settings / More / right-click); not gated by toolbox menu | `app.component.ts` `buildAlwaysAvailableViewActions` | Hide toolbox menu → still reset view from Settings |
| Music max 20MB | Uploaded audio capped at 20 MB per file | `file-archiver.ts` `maxAudioeSize`, i18n `jukebox.maxFileSize` | Reject >20MB; UI shows “20MB” |
| Lobby on start | Cold start (not in a room / no invite) auto-opens Lobby as a normal panel (no modal overlay) | `app.component.ts` `openLobbyIfNeeded` | Fresh load shows lobby panel; map stays clickable |
| Room XML `syncId` | Persist sync identifiers across ZIP／folder reload so piece↔table bindings survive UUID regen | `object-serializer.ts`, `room.ts`, `tabletop-object.ts` | Save room → reload → tokens stay on correct table; presets rebind |
| Multi-map placements | Objects / notes can sit on several tables via `tablePlacements`; pose kept on map switch | `tabletop-object.ts`, inventory / game-table | Place on map A → switch to B → object absent; switch back → pose restored |
| Temporary token copy | Ctrl+drag character creates temp copy that does not enter graveyard | `game-character.ts` `createTemporaryCopy`, movable | Ctrl+drag → temp token; delete does not go to trash listing |
| Inventory multi-place | Shift multi-select / Select All, drag multiple onto table | `game-object-inventory.component.*` | Select several → drop on table places all |
| Preset preview / keep tokens | Scene preset JPEG thumbnail; Apply (keep tokens) preserves current poses; inventory bound to viewed map | `scene-preset-preview.ts`, `scene-preset*.ts` | Save shows thumb; Apply keep-tokens leaves current tokens |
| Panel geometry memory | Unified localForage store for all panel sizes/positions; rearrange action | `panel.service.ts`, `ui-panel.component.*` | Resize connection → reopen keeps size |
| GM kick | Connection panel kick with confirm; kicked peer notified and reloads | `peer-menu.component.*`, `KICK_PEER` | GM kicks → peer sees notice → reload |
| V3 mesh-lock | When every enabled role is password-gated, SkyWay channel uses sealed mesh password | `room-auth.ts`, `peer-context.ts` | All roles password → join still works; channel key not in peerId |
| PWA update hint | Service worker update ready → Connection panel icon / confirm reload | `app-update.service.ts`, `peer-menu` | Deploy new build → icon appears → reload applies |
| Optional music in backup | Bind folder / ZIP prompts; Settings* toggle; auto folder backup uses preference | `save-data.service.ts`, `folder-backup.service.ts`, settings menu | Exclude music → ZIP/meta without audio blobs; library XML still saved |
| Weather SE | Local weather loop on dedicated jukebox track; toggles with table weather | `weather-se.service.ts`, `weather-loop-player.ts`, `Jukebox.ts` | Enable rain → hear SE; switch weather changes loop; mute weather SE stops audio |
| 2D table mode | Top-down camera + flat character/dice; notes stay flat | `game-table.component.*`, table settings `mode2d` | Enable 2D → tokens flat; disable → 2.5D restored |
| Per-map appearance | Dual-map peers: rotation/FX SyncVars reprojected to local viewed map | `table-placement-view-state.ts`, `tabletop-object.ts`, `tabletop.service.ts` | A on map1 rotates token → B on map2 pose unchanged |
| Note flip | Back art when set; else CSS mirror of face; pins upright; handout follows | `text-note.ts`, `text-note.component.*`, `note-handout` | Flip with/without back art; handout shows back when flipped |
| Save-room folder flyout | Hover Load room → Change folder / Disconnect folder | `peer-menu.component.*` | Hover load shows flyout; change rebinds; disconnect unbinds |
| Esc close frontmost | Esc: context menu → modal → clear drafts/selection (priority over panels) → frontmost closable panel | `tabletop-keyboard.service.ts`, `panel.service.ts` `closeFrontmostPanel`, `ModalService.dismissTop` | Box-select tokens with a panel open → Esc clears selection first; Esc again closes the panel |
| Mobile HUD / tips | Icon-grid nav/sheets + snap sizing; map HUD／toolbox exclusivity; hover tips desktop-only | `app.component`, context-menu, teaching-tip / overview | Mobile: toolbox collapses HUD; no sticky hover tips; sheets snap |

## Port decisions

- **Guest**: do **not** encode `isAllowGuest` / `isGuest` into peerId. Use sync room state + local guest flag.
- **CHT**: title/favicon/landing + high-frequency UI first; not full i18n of every WithFly string.
- **Quick roll**: old `sendLogMessage` passed broken `value.gameType` etc.; reimplement against current `ChatMessageService.sendMessage` using active chat tab + current speaker.

## Sync after port

See `docs/hktrpg-sync.md` (added in final step).
