import { I18nDictionary } from './types';

export const en_tutorial: I18nDictionary = {
  'tutorial.name': 'Tutorial',
  'tutorial.linkName': 'Notes:',
  'tutorial.welcome': `Welcome to HKTRPG Udon (based on Udonarium with Fly).
Discord: https://support.hktrpg.com
Patreon: https://www.patreon.com/HKTRPG
The map is 2.5D. Data is shared peer-to-peer; the server does not keep your tokens or images long-term.
★ Keep data with “Bind backup folder” (auto) or “Download ZIP” (manual); next time Load ZIP. Without a backup, everything vanishes.
Desktop Chrome recommended. This tutorial hides after your first chat message.
Full guide: https://wiki.hktrpg.com/TRPG/Udonarium烏冬教學`,
  'tutorial.view': `<View> Right-drag = pan
　　　　Middle-drag / Ctrl+right-drag = rotate
　　　　Wheel = zoom
　　　　WASD = move view (no selection)
　　　　Q/E = yaw view left/right (no selection)
　　　　Alt+wheel (no selection) = yaw ±3°
　　　　Alt+Shift+wheel (no selection) = pitch ±3°
　　　　Shift+wheel = pan left/right
　　　　Ctrl+wheel = pan up/down
　　　　Ctrl+Shift+D = toggle DEBUG pose (top-right view / selection pose; off by default)
<Objects> Left-drag = move
　　　　Drag rotate handle = turn
　　　　Right-click = menu
　　　　Double-click = details (character / card / deck / dice / terrain / note / mask / range…)
　　　　Character “Next image” = right-click “Switch to next image”
　　　　Flip cards / draw / roll dice = right-click menu
<Path move> After selecting a token: Ctrl+left-click = add waypoint (release Ctrl — path stays)
　　　　Left-click new position = final stop and go
　　　　Space = go with current waypoints
　　　　Right-click = undo last waypoint
　　　　Esc = cancel path
<Select> Left-click = select (highlight)
　　　　Shift+click = add/remove
　　　　Left-drag empty = box select
　　　　Shift+drag = additive box
　　　　Click empty / Esc = clear
<Hover preview> Pause on an object = preview card
　　　　Pin (top-left) = keep open (closes on delete/trash)
　　　　Unpinned leave = fade out ~0.5s
Drag images or music into the browser to import.`,
  'tutorial.keyboard': `<Keyboard (with selection)> WASD / arrows = move (diagonals OK)
　　　　Shift+WASD = face direction
　　　　Q/E = rotate ±45°
　　　　Shift+Q/E = ±15°
　　　　R = reset all angles (facing / tilt) to 0°
　　　　PageUp/PageDown = altitude ±1 (Shift = ±0.5)
　　　　F = flip card/coin or roll dice
　　　　L = lock/unlock
　　　　H = hide/reveal selected characters (GM only)
　　　　T = gather selected objects to mouse position
　　　　Delete = delete (characters go to trash)
　　　　Ctrl+C　Ctrl+X　Ctrl+V = copy / cut / paste (paste at cursor; text selection still copies text)
　　　　Ctrl+Shift+V = paste as temporary Token (only when clipboard has character/Token)
　　　　[ = send back
　　　　] = bring front
　　　　Alt+wheel = facing ±3°
　　　　Alt+Shift+wheel = roll ±3°
　　　　Ctrl+Shift+wheel = facing ±45°
　　　　Hold Shift on drop = temporary no grid snap
　　　　Esc = close menu/dialog → clear draft/selection (before closing panels) → close frontmost panel
<Keyboard (general)> C = close all desktop panels
　　　　Ctrl+Z = undo
　　　　Ctrl+Y　Ctrl+Shift+Z = redo
　　　　(move / rotate / delete / cut-paste / layer; scene create / delete / nudge)
　　　　Guest mode cannot use edit shortcuts; in text fields Ctrl+Z stays with the browser.`,
  'tutorial.chat': `<Chat> Switch channels above; toolbar (local, ON/OFF):
　　　　Music / SFX / notice / align left / list (bubbles) / compact toolbar
　　　　Compact = hide tabs & toolbar, keep input; restore with the bottom-right button
　　　　Window size & position = remembered (local); new chat windows reuse them
　　　　1–9 = switch Nth viewable chat tab (opens chat; no table selection required)
<Floating dialog> Speaking as a character pre-fills 「」; text inside appears above the token
　　　　Right-click / inventory = toggle “Show floating dialog”
　　　　Scenario text as character with 「」 also triggers it
<Dice> Pick a system in the input, then type BCDice commands
　　　　Beside character sheet numbers = Quick roll to the current chat channel
<Connection> GM can kick peers from the Connection panel
　　　　Every enabled role has a password = V3 mesh-lock
　　　　When a new build is ready = Connection shows a PWA update hint — confirm to reload
<Guest> Rooms can “allow guests”; guests are limited. Passwords still apply
<Notes> Menu → Note inventory: text／image／video／PDF; drag-import; self-only (like tokens); GM show-to-players; hover then Ctrl to preview
<Whispers> Not saved in ZIP; after a new connection ID, old whispers are gone
<Settings*> Optional “Auto-open chat when someone speaks (if closed)” (default off)
　　　　Cold start not in a room = lobby as a normal window
　　　　Settings / More = “Rearrange panels”; panel sizes & positions remembered (local)`,
  'tutorial.scene': `<Ping> Long-press empty map = marker
　　　　Shift+long-press = warning
<Map settings> Darkness / global brightness / weather (rain・thunderstorm・snow・fog・wind・sakura・maple・sandstorm・rainbow・aurora・burning) / enable vision
　　　　Grid = off / square / hex (vertical・horizontal); optional coordinates; local grid snap
　　　　Toolbox = quick weather and day/night
<Multi-map> Same object / note can sit on several tables (placements); pose kept when switching maps
　　　　Inventory “On table” = follows the viewed map; Shift multi-select / Select All then drag onto the table
　　　　Ctrl+drag a character = temporary copy (not sent to graveyard)
<Preset scenes> Thumbnail on save
　　　　Apply = restores poses & atmosphere
　　　　“Apply (keep tokens)” = atmosphere / BGM only
<Vision> When on, players only see around their vision character (GM unrestricted)
　　　　Picking a speaker in chat = temporary vision; closing that chat clears it
　　　　Persistent = right-click “My vision character”; set vision / bright / dim
　　　　Character tokens = always block light; masks・terrain block by default — right-click can disable light interaction
　　　　Status icons = stay on the nameplate (incl. Dead); Dead syncs both ways with combat Defeated
　　　　Image effects = right-click grayscale / sepia / Matrix rain / silhouette / flip / contrast…
　　　　Base rings = right-click “Ring”
<Terrain・3D> Drop STL／OBJ／glTF／FBX or ZIP = bake six-face textured terrain; L-shapes can Shift-multi-select into a bake group
　　　　Slope degrees, per-face textures, neon signs; settings can lock aspect ratio
<Map masks> Alt+double-click = configured actions (multi-select): chat/dice, music, cut-in, note handout, switch map, apply preset, appearance A/B, token FX
　　　　Token FX can auto-apply while standing (restore on leave); manual apply is not undone by leaving
<Scene tools> GM only (menu); select / light / wall / rect / ellipse / polygon / freehand / text
　　　　After select: WASD/arrows = move
　　　　Delete = remove
　　　　Ctrl+Z　Ctrl+Y = undo / redo
　　　　Wall・polygon: Enter/double-click = finish; Esc = cancel
<Combat> Open from menu; add selection / all on table, roll initiative, rounds
　　　　Character right-click = “Join combat”; turn announce appears when started`,
  'tutorial.card.ops': 'Controls',
  'tutorial.card.ops.hint': 'View · keyboard · chat · connection',
  'tutorial.card.scene': 'Scene',
  'tutorial.card.scene.hint': 'Map · multi-map · presets · combat',
  'tutorial.card.changelog': 'Changelog',
  'tutorial.card.changelog.hint': 'Version history',
  'tutorial.card.expand': 'Expand',
  'tutorial.card.collapse': 'Collapse',
  'changelog.v1132': `Re-localized from https://nanasunana.github.io/ private build with extra features.
Upgraded to 1.13.2`,
  'changelog.v1133b': `Upgraded to 1.13.3b
2021/05/11 Improved HTML & TXT export; added COIN
2021/05/13 Updated TOKEN bottom frame size
2021/05/27 Cut-in (YouTube); shadow changes with height`,
  'changelog.vF': `2021/08/17 Updated to F build / dependencies. Fixed character-sheet dice roll bug (thanks Toast Rabbit).`,
  'changelog.2026base': `2026 major update (hktrpg-main)
・Based on latest Udonarium with Fly (Angular 20, SkyWay 2023)
・Full UI localization (zh-TW / zh-CN / en / ja); branding aligned with HKTRPG
・Guest mode, compact chat, note inventory, quick sheet rolls
・Chat toolbar: music / SFX / notice / align left / list / compact
・BCDice 4.9.0`,
  'changelog.2026ops': `2026/08/03 Controls update
・Selection highlight; left-drag empty box select; Shift+click/drag multi-select; right-drag pan map
・Double-click opens details (flip / draw / roll via right-click)
・Keyboard (with selection): WASD move, Shift+WASD face, Q/E rotate, R reset all angles, PageUp/Down altitude, F flip, L lock, H hide (GM), T gather to mouse, Delete, Ctrl+C　Ctrl+X　Ctrl+V, Ctrl+Z/Y
・Chat: 1–9 switch viewable tab (opens chat; no selection required)
・C = close all panels; context menu shows shortcut hints (T) (L) etc.
・[ / ] layer order; hold Alt = outline table objects (under map masks: GM only); Alt+wheel (select = facing 3° / empty = yaw); Alt+Shift+wheel (select = roll / empty = pitch); Ctrl+Shift+wheel 45°
・Ctrl+Shift+D: DEBUG pose (view / selection pose); hover preview can be pinned
・Shift+wheel pan horizontal; Ctrl+wheel pan vertical
・Path move: select token → Ctrl+left waypoints (Ctrl can be released) → left-click destination or Space to go; right-click undoes last waypoint; Esc cancels
・“Next image” moved to right-click; shadow scales with size/height`,
  'changelog.2026scene': `2026/08/03 Scene・combat・vision
・Ping: long-press empty map; Shift+long-press warning
・Map: darkness / brightness / weather; optional vision (walls, point lights)
・Scene tools (GM): wall / light / draw; Enter finishes walls & polygons
・Chat speaker = temporary vision; only manual “My vision character” persists
・Combat: initiative, turn announce; status icons & base rings
・Map settings can download map; status icons wrap on nameplate`,
  'changelog.2026fx': `2026/08/03 Character FX・floating dialog
・Floating dialog: toggle in right-click / inventory; 「」 text shows above the token; character chat pre-fills 「」
・Image effects: grayscale / sepia / contrast / silhouette / flip; Matrix digital rain (digits & letters)
・New Dead status; syncs both ways with combat Defeated; status tip = name + level only
・Character context menu regrouped; menu offset so it does not cover the token
・Double-click token art opens details; combat “Add all on table” for everyone except guests
・Removed character “Interact with light” (tokens always occlude); masks / terrain still toggleable`,
  'changelog.2026chat': `2026/08/05 Chat・lobby・scenario
・Chat window remembers last size & position (local); new windows reuse geometry; shorter default height
・Settings*: “Auto-open chat when someone speaks (if closed)” (default off)
・Cold start opens Lobby as a normal window when not in a room (no overlay; skipped for invite join)
・Scenario text sent as character with 「」 triggers floating dialog`,
  'changelog.2026map': `2026/08/05–06 Multi-map・scene・room
・Multi-map placements: same object on several tables; pose kept on switch; notes supported
・Ctrl+drag character = temporary copy (not graveyard); inventory multi-select / Select All → drop
・Preset scenes: thumbnail preview, “Apply (keep tokens)”; inventory bound to viewed map
・All panel sizes/positions remembered (local); rearrange panels available
・GM can kick peers; V3 mesh-lock when every enabled role has a password
・Menu/load ZIP perms, 20MB audio cap, chat unread badge; Connection panel PWA update hint
・Mobile: chat toolbar & map HUD/toolbox mutual exclusivity; hover teaching tips desktop-only`,
  'changelog.2026audio': `2026/08/07 Jukebox・backup・windows
・Library multi-select (Ctrl/Shift), row drag to move/reorder; Delete removes selection
・Per-folder add-link / upload; OS file drops highlight the target folder (not always root)
・Folder play queue & shuffle/sequential preference; Load room hover → change / disconnect backup folder
・ZIP / folder backup can omit music (prompt + Settings*; smaller files when skipped)
・Esc: clear selection first when selected; otherwise dismiss menu/dialog/draft, then close the frontmost closable window`,
  'changelog.2026json': `2026/08/08 Character JSON
・JSON for easy import; character sheet “Download as JSON” (CCFOLIA; Ctrl+V on the table to paste)`,
  'changelog.2026note': `2026/08/08 Shared notes・map-mask actions
・Shared notes: text / image / video (≤50MB mp4・webm) / PDF (≤20MB); drag-import and switch content type
・Note inventory opens a dedicated settings panel (front/back, scope: this map / all maps, lock, flip, etc.)
・“Self only” matches token stealth (owner-bound); hidden from others’ table/inventory; ghosted for owner, visible to GM
・GM “Show to players” full-screen handout (optional targets); self-only notes are never room-broadcast
・Hover a table note, then press Ctrl to preview; PDF pages wrap first↔last
・Map-mask actions: Alt+double-click (multi-select): chat/dice, music, cut-in, note handout, switch map, apply preset, appearance A/B, token FX & altitude
・Token FX can auto-apply while standing on the mask (restore on leave); manual apply is not undone by leaving
・Characters/cards/dice/terrain/masks/notes use dedicated settings panels; denser settings UI
・Old rooms: hide flag without owner is not private; owner id may not match after reload (GM sees it — same as tokens); re-check “Self only”`,
  'changelog.2026ux': `2026/08/09–10 Mobile・weather SE・2D・backup
・Mobile nav／action sheets → icon grids with snap sizing; tighter chat, inventory, combat; HUD／context-menu cleanup
・Weather SE on a dedicated jukebox track (rain／thunder／snow／sandstorm…); toggles with weather
・Table **2D mode** (top-down camera + flat character／dice); dusk lighting; auto-fit table size to map art
・Default chat-tab labels localize locally (not SyncVar-written)
・Folder-backup／room join fixes; landing page copy refresh`,
  'changelog.2026sync': `2026/08/11 Multi-map pose・note flip・join
・Per-map placement view-state: rotation／appearance stay independent per map; peers on other maps no longer overwrite your local pose
・3D yarn anchor tweaks; default-map／connection fixes
・Room-join busy ends on first live peer (less stuck “connecting”)
・Note flip: back art when set; otherwise mirror the face (pins／handles stay upright); handouts follow the back
・Context-menu toggles use “☑／☐ + feature name” (current state)`,
  'changelog.2026menu': `2026/08/13 Menus・clipboard・import/export
・Context menus cleaned up: frequent actions on L1; Appearance/FX and Token settings nested; combat next to stealth; Move under Advanced copy; empty-map creates under Add object
・Map cosmetics/altitude live on the Token; sheet altitude edits also seed the character body
・Removed redundant Create copy (use Ctrl+C/V; characters still have Advanced copy for temp Token / numbering)
・Paste as temporary Token and Ctrl+Shift+V only when clipboard has a character/Token (no longer shown for dice etc.)
・Object panels use Import / Export (ZIP); characters also Download as JSON (CCFOLIA; copies to system clipboard)`,
  'changelog.2026terrain': `2026/08/17 Terrain・3D models
・Drop STL／OBJ／glTF／FBX (or a ZIP with models) = bake into six-face textured terrain
・L-shapes etc. become bake groups: Shift multi-select to form/clear; move・scale・export as a group
・Terrain slopes, per-face textures, neon sign glow; corner scale and aspect lock
・Small-token name tags stay on one line; ZIP load restores image tags and spoiler-hide`,
  'changelog.2026net': `2026/08/20–21 Connection・invites
・Keep the local tabletop until a live peer + map data arrives
・Hide unreachable ghost rooms from the list (do not kick players already in a room back to lobby)
・Auto remesh after disconnect; token／backend errors prefer reopening the room — no silent mid-game lobby drop
・Invite links: freeze UI for valid or corrupt tokens; damaged links show “invalid or damaged”
・Second-tab joins less often show blank TOKEN／images (settle + delayed remount)`,
  'changelog.links': `Site: https://z01.hktrpg.com
Guide: https://wiki.hktrpg.com/TRPG/Udonarium烏冬教學
Discord: https://support.hktrpg.com
Facebook: https://www.facebook.com/groups/HKTRPG
Wiki: https://www.hktrpg.com/
Original Udonarium: https://udonarium.app/
with Fly: https://nanasunana.github.io/
Support: https://www.patreon.com/HKTRPG`,
  'tutorial.systemFrom': 'System',
};
