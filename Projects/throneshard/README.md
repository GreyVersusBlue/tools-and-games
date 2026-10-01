# Throneshard

Two thrones, three lanes, 14 heroes. A 5v5 MOBA against bots in three.js: Sunward vs Duskward, towers, barracks and
a Throneshard crystal at the heart of each base, creep waves, neutral camps, Grimmaw and the Sigil of Second Dawn,
14 heroes with 4 abilities each, items with recipes/shop/courier, fog of war, day/night and a full HUD.

## Play
No build step: serve the repo root statically (for example `python3 -m http.server`) and open
`Projects/throneshard/index.html`.

## Controls (genre-standard defaults)
| Action | Key |
|---|---|
| Move / attack / follow (right-click a low-HP ally creep to deny); hold to keep moving | Right-click |
| Attack-move | A + left-click |
| Stop / Hold | S / H |
| Abilities | Q W E R (Alt/Ctrl + key = level up; or click the "+" buttons) |
| Items | Z X C V B N, T = Homeward Scroll |
| Select hero / center camera | F1 / Space (hold to follow), Y = camera lock |
| Shop / Scoreboard / Pause / Menu | F4 / hold Tab / F9 / F10 |
| Camera | edge-pan, arrow keys, middle-drag, wheel zoom, click minimap |
| Ping | Alt + click |

Runes spawn in the river (power, every 2 min from 2:00) and jungle (bounty, every 2 min) — right-click to pick up.
Wards are bought in the shop (Consumables) and placed with the item key. Talents: tree button left of the ability bar
(levels 10/15/20/25). Buyback from the death screen. Ascendant Scepter upgrades every ultimate (see ability tooltips).

Settings (graphics quality, audio, edge pan, tutorial tips) are in the main menu / F10; the **Controls & Hotkeys** tab
rebinds every hotkey and picks the cast mode (Normal / Quick Cast / Quick Cast on key release).
Use **Low** graphics quality if the frame rate drops on weaker GPUs.

## Structure
See `ARCHITECTURE.md`. `src/core` (engine/rules), `src/world` (terrain, water, foliage, fog, pathfinding, post-fx),
`src/models` (characters/structures/animation), `src/gameplay` (heroes, abilities, items), `src/vfx`, `src/ai`
(structures, creeps, neutrals, bots), `src/ui`, `src/input` (controls/camera), `src/audio`.

## Tests (CI)
`node test/data.mjs` (every hero, ability, talent, build, item recipe, model file and storage key resolves) and
`node test/browser.mjs` (boots the page under `Tools/board-check`'s harness, plays a whole bot match with a fixed step
and rendering stubbed, and checks the end screen). Both run in `.github/workflows/site-ci.yml`.

## Dev tools (headless, uses the real GPU via Vulkan)
These use Playwright, which is not vendored: `cd tools && npm i --no-save --no-package-lock playwright` once (`node_modules/` is gitignored).
`node tools/scripts/playtest.mjs <url> <hero> <minutes>` — drives the real UI, simulates a match, screenshots to /tmp/play_*.png
`node tools/scripts/controls_test.mjs <url>` (hold-to-move, quick cast, rebinding), `tools/scripts/audio_test.mjs`, `tools/scripts/ux_shots.mjs <url> <outDir>` (UI screenshots at 3 resolutions)
`node tools/scripts/profile.mjs`, `tools/scripts/botstats.mjs`, `tools/scripts/ai_sim.mjs` — perf / bot behaviour / full bot matches.
`node tools/scripts/lh_test.mjs` / `match_stats.mjs` (bot last hits, match length, levels, Grimmaw; `DIFF_OVERRIDE` patches difficulty profiles for A/B runs), `bot_modes.mjs` (time in each bot mode), `shadow_motion.mjs` (shadow-map frame sequence), `vfx_capture.mjs` (every ability and rune effect).
`node tools/scripts/ws2_perf.mjs <url> [low|medium|high|ultra]` — extended profile (world sub-timings, main/shadow draw calls).
Structures are rebuilt with `tools/blender/structures/build.sh` (Blender 5 + gltf-transform).
Characters (heroes, creeps, neutrals, Grimmaw, summons) are rebuilt with `tools/blender/characters/build.sh`
(Quaternius CC0 packs fetched by `tools/blender/characters/fetch_sources.mjs`); preview them with `node tools/scripts/model_gallery.mjs <url>`.

Third-party assets are CC0/CC-BY (KayKit, Kenney, Quaternius-style packs, three.js examples, ambientCG, Poly Haven,
OpenGameArt); see the CREDITS.txt files under `assets/`. For local, non-commercial use.
