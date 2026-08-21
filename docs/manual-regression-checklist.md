# Manual regression checklist (maps / red string / save)

Use after risky changes to multi-map, ClueLink, or room save/load.

1. **Dual-map poses** — Place a token on 戰場地圖（3D）, note coords; switch to 線索版（2D）; switch back; token still at the same place on 3D.
2. **3D vs 2D red strings** — Strings on battle map stay on battle; clue-board strings stay on clue; each set hidden on the other map.
3. **Save ZIP → reload** — Save room ZIP, reload page, load ZIP; dual placements + both clue link sets intact.
4. **Save immediately after load** — Load ZIP, save again without edits, reload; strings/pieces still present (DELETE self-echo guard).
5. **Default room seed** — New empty room: `gameTable` + `gameTable_clue2d`, monster C on both, 2 battle links + 5 clue links.
6. **Join room** — Entering a mesh room must not push lobby sample tables over the host house (clearLocal + claim authority).
7. **GM preview map** — View another scene locally without changing room active for peers.
8. **Scene preset keep-tokens** — Apply with keep-tokens: visible characters re-stamp; extras prune.

Unit coverage: `npm run test:ci` (Karma). Optional E2E: `npm run e2e:smoke` (also in CI `playwright-smoke` job).
