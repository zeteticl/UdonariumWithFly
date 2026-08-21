# VTT music / audio player features — research notes

Sources are primary (official docs, marketplace package pages, first-party GitHub READMEs).  
Date gathered: 2026-08-14. Audience: UdonariumWithFly jukebox roadmap.

## Executive summary

Browser VTTs converge on a small “must-have” set: **multi-channel layering** (BGM + ambience + one-shots), **per-client volume**, **playlists with loop/shuffle**, **fade on start/stop**, and **scene-linked music**. Advanced “cinematic” polish (equal-power crossfade, intro→loop→outro, soundscape generators, wall muffling filters) mostly lives in Foundry modules or dedicated sound apps (e.g. Syrinscape), not in every core product.

For a Udonarium-like peer browser table, the highest ROI next steps are **track fade / BGM crossfade**, **seek + pause + progress**, **soundboard / one-shot pad**, and **soft scene-preset handoff** — not full Foundry-style spatial audio (expensive, needs walls + listener tokens).

## Feature landscape by product

### Foundry VTT (core)

Official playlist docs: [Playlists](https://foundryvtt.com/article/playlists/)

| Capability | Notes | Source |
|---|---|---|
| Playlist directory + folders | Organize playlists like other docs | [Playlists](https://foundryvtt.com/article/playlists/) |
| Playback modes | Sequential, shuffle, simultaneous, soundboard-only | same |
| Fade duration (ms) | Playlist + per-track fade; values combine | same |
| Per-track volume / repeat | Repeat exists; **native loop is not seamless** (gap between loops) | same |
| Currently playing UI | Progress, volume, pause/stop, repeat toggle; volume change is **room-wide** | same |
| Client global volumes | Separate Playlists / Ambient / Interface sliders | same |
| Direct URL or world files | flac, mp3, wav, ogg, webm, opus | same |
| Preload sound | Reduce start latency for large files | same |
| Ambient Sounds | Radius emitters on the scene; audible near tokens; optional wall constraint | [Ambient Sounds](https://foundryvtt.com/article/ambient-sound/) |
| Wall-aware sound | Walls can block or allow sound | [Walls](https://foundryvtt.com/article/walls/) |
| Ambient FX filters | Low-pass / high-pass / reverb as **base** or **muffled-through-wall** effects (v12+) | [Release 12.324](https://foundryvtt.com/releases/12.324) |

### Foundry modules (cinematic audio)

| Module | Highlights | Source |
|---|---|---|
| The Sound of Silence | Equal-power crossfade, silence gaps, intro→loop→outro, soundscape mode (chance / polyphony / pan), fade curves, volume normalize | [Package page](https://foundryvtt.com/packages/the-sound-of-silence), [GitHub README](https://github.com/GnollStack/The-Sound-of-Silence) |
| Syrinscape Controller / SyrinControl | Browse moods & one-shots in-browser, macros, playlists from Syrinscape library (API token); optional ambient hooks | [syrinscape-control](https://foundryvtt.com/packages/syrinscape-control), [SyrinControl](https://foundryvtt.com/packages/fvtt-syrin-control/), [Syrinscape 3rd-party](https://syrinscape.com/3rd-party-app-integration/) |

### Roll20 Jukebox

Official help: [Jukebox](https://help.roll20.net/hc/en-us/articles/360039178714-Jukebox); product post: [Bring Your Own Beat](https://bloghub.roll20.net/posts/shiny-new-bring-your-own-beat-features-are-here/)

| Capability | Notes | Source |
|---|---|---|
| Upload + partner libraries | My Audio uploads; Tabletop Audio / Incompetech / BattleBards catalogs | [Jukebox help](https://help.roll20.net/hc/en-us/articles/360039178714-Jukebox) |
| Multi-track / multi-channel | Play ambient + soundtrack together; channel / simulplay controls | help + BYOB post |
| Loop, volume, fade in/out | Per-track | BYOB post |
| Playlists | Create/reorder/export; manage outside a game | BYOB post |
| Scrub / waveform progress | Seek; players sync to scrub position | BYOB post |
| Tags / search | Custom searchable tags on uploads | BYOB post |
| Upload size | ~20 MB (common browser VTT limit) | help center / community; aligns with our cap |

### Cross-cutting patterns (what “good” looks like)

1. **Layers, not one speaker** — BGM + ambience + SFX/one-shots with separate client volumes ([Foundry global volumes](https://foundryvtt.com/article/playlists/), [Roll20 multi-channel](https://bloghub.roll20.net/posts/shiny-new-bring-your-own-beat-features-are-here/)).
2. **Soft transitions** — fade and (in modules) true crossfade; hard cuts feel amateur ([Foundry fade](https://foundryvtt.com/article/playlists/), [SoS crossfade](https://github.com/GnollStack/The-Sound-of-Silence)).
3. **Transport** — pause, progress, scrub, now-playing ([Foundry currently playing](https://foundryvtt.com/article/playlists/), [Roll20 scrub](https://bloghub.roll20.net/posts/shiny-new-bring-your-own-beat-features-are-here/)).
4. **Scene / mood binding** — music follows the table state (Foundry playlists + ambient; Syrinscape moods; our scene presets already snapshot tracks).
5. **Soundboard** — one-shot triggers without stealing the BGM channel ([Foundry soundboard-only mode](https://foundryvtt.com/article/playlists/), Syrinscape one-shots).
6. **Spatial FX are niche for peer browsers** — powerful in Foundry ([ambient + muffling](https://foundryvtt.com/releases/12.324)) but require walls, listener tokens, and continuous sync; low fit for Udonarium’s model.

### Licensing / hosting constraints (browser)

- **Direct file URLs or uploaded blobs** work; streaming page URLs (YouTube/Spotify pages) generally do not as BGM without a licensed embed path ([Foundry audio source](https://foundryvtt.com/article/playlists/), Roll20 My Audio model).
- **CORS** blocks `MediaElementSource` / Web Audio graph for many remote hosts — need element-direct fallback or same-origin/blob (already true in our `AudioPlayer`).
- **File size** ~10–20 MB per track is the practical browser/upload norm (Roll20 / our 20 MB).
- **Third-party catalogs** (Syrinscape, BattleBards, etc.) need API tokens or partner deals — not a free core feature.

## Fit vs UdonariumWithFly (current)

Already strong relative to peers:

- Multi-track room BGM + ambient channels + local volume bus
- Folder library, queues (sequential/shuffle), Music HUD
- Weather SE with configurable loop crossfade
- Scene-preset BGM snapshot; mask / cut-in music hooks
- Direct URL + upload; guest lock

Clear gaps vs Foundry/Roll20 baseline:

- No seek / pause / progress UI
- No fade-in/out or crossfade on **room track** play/stop/switch
- No ducking under voice / cut-in / SE
- No dedicated soundboard pad (one-shots share SFX or burn a track)
- Scene apply can hard-cut music (`skipBgm` only)
- No tags/search beyond folder structure
- No spatial ambient emitters (intentional for now)

## Recommendations for our jukebox (ranked)

| Rank | Feature | Why | Effort (rough) |
|---:|---|---|---|
| 1 | **Fade in/out on track play/stop** (room-synced seconds, like weather overlap) | Matches Foundry core expectations; biggest polish per line of code | S–M |
| 2 | **Crossfade when switching BGM** on the same track slot | Avoids hard cuts during scene changes / playlist advances; SoS’s #1 selling point | M |
| 3 | **Pause + progress + scrub** (at least on HUD / now-playing) | Roll20/Foundry baseline transport; GM control without restarting loops | M |
| 4 | **Soft scene-preset handoff** (crossfade into preset BGM instead of hard replace) | We already snapshot tracks; missing only transition | S–M |
| 5 | **Soundboard / one-shot pad** (grid of library clips → SFX channel, no loop) | Foundry soundboard + Syrinscape one-shot pattern; combat stingers without stealing BGM | M |
| 6 | **Ducking** (temporarily lower BGM when cut-in / notice / optional SE plays) | Keeps voice/cinematics intelligible; common request, rare as core | M |
| 7 | **Tags + search** on library | Roll20 BYOB; large libraries become usable mid-session | M |
| 8 | **Intro → loop → outro** segments (optional per track) | High cinematic value (boss music); complex; port later from SoS pattern | L |
| — | Spatial ambient + wall muffling / EQ | High cost, needs FoW/walls listener model; defer unless map audio is a product goal | XL |
| — | Syrinscape / partner streaming | Product/legal dependency; optional integration later | L + ops |

### Suggested first vertical slice

Ship **(1) + (2) + (4)** together as “music transitions”: one room-synced `trackFadeSec` (default ~2–3s for BGM; weather keeps its own overlap), apply on play/stop/switch and on scene-preset apply when BGM changes. Then add transport (3) on Music HUD.

### Secondary candidates (from cross-check)

Code inventory confirmed the gaps above (no seek/pause, no BGM fade/crossfade/duck, HUD = 3/5 slots, no streaming). Extra ideas ranked lower than the table:

| Candidate | Note vs current product |
|---|---|
| Dedicated “mood” mixer presets | Largely covered by **scene presets** + weather SE; soft handoff (#4) is the missing piece |
| Stronger GM preview vs broadcast UX | **Audition** already exists; polish labels / defaults rather than a new channel |
| Library export/import (JSON/CSV pack) | Useful for machine switches; room ZIP already carries `fly_jukebox.xml` + optional audio blobs |
| Weather/table autoplay beyond today’s hook | Weather SE already auto-follows `weatherType`; extend only if more layers need table triggers |

## Source index

- https://foundryvtt.com/article/playlists/
- https://foundryvtt.com/article/ambient-sound/
- https://foundryvtt.com/article/walls/
- https://foundryvtt.com/releases/12.324
- https://foundryvtt.com/packages/the-sound-of-silence
- https://github.com/GnollStack/The-Sound-of-Silence
- https://foundryvtt.com/packages/syrinscape-control
- https://foundryvtt.com/packages/fvtt-syrin-control/
- https://syrinscape.com/3rd-party-app-integration/
- https://help.roll20.net/hc/en-us/articles/360039178714-Jukebox
- https://bloghub.roll20.net/posts/shiny-new-bring-your-own-beat-features-are-here/
