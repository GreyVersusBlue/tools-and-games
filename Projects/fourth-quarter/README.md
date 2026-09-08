# The Fourth Quarter — 3D (Sprint 3D-2: The Day Phase)

A full day loop, first-person. **Days**: the room sits empty in daylight and
you manage at five glowing stations — stock back in the kitchen (through the
doorway behind the bar), the crew at the bar, tonight's theme at the corkboard,
a real estate desk for the venue ladder, and the front door to open up.
**Nights**: patrons, tickets, your servers, and you on the floor. **Close**:
box score, wages and rent come out of the till, tomorrow's ledger.

**Mobile is not supported, on purpose.** Movement is pointer lock plus WASD,
minigames are timed keypresses, and the on-screen controls hint names four
keyboard keys — none of that has a touch equivalent worth building without
redesigning the input model from scratch. This is a legitimate answer, not a
gap: a touch-controls version would be a different project.

The campaign persists (localStorage): cash, day counter, stock, payroll.
Fresh balance, no save compatibility with the 2D game (by design).

## The save

This is the site's reference integration of the shared save system,
`/assets/js/gvb-save.js` — see `assets/js/README.md`. **Export save** and **Import
save** put a campaign in a `.json` file and load it back, so it survives a cleared
browser or moves to another machine. Storage key is still `fq3d-save`, so a
campaign from any older build loads exactly as it did; those saves carry no version
stamp, and `repairCampaign()` in `js/campaign.js` fills in everything added since.

The bar appears in three places, and it is one component mounted three times
(`mountBar()` in `js/main.js`) rather than three bars that happen to look alike:

| Where | Why there |
|---|---|
| Start screen | Where you already are before a session |
| **Tonight** panel, at the door | Any day, any time, without playing a night — the last screen before a night that can go badly |
| Box score | The natural "done for tonight" beat, with the night already settled and written |

Every mount gets `export` and `import` and nothing else. **`reset` is deliberately
off all three:** the start screen's "New Game (wipe save)" already erases a
campaign, and the other two are screens a player passes through every single night,
where a campaign-eraser is a footgun you walk past a hundred times a playthrough.
The dev menu's "Reset all progress" covers the developer case.

Each button carries `data-gvb="export|import"`, which is how `play-games.mjs`
clicks one without depending on label text or button order.

Importing replaces the whole campaign, so `adoptCampaign()` tears down any night
meshes, rebuilds the room at the imported tier, closes whatever panel is open, and
restarts the day. Neither of the two new mounts can be reached with a night in
progress — the box score only exists after last call, and the Tonight panel only
during the day — so an import never has live floor state to discard.

## Run it

Any static host works — GitHub Pages included. Locally:

```
cd fourth-quarter-3d
python3 -m http.server 8000
# open http://localhost:8000
```

(Modules + import map need http://, not file://.)

## Controls

- **WASD** move · **mouse** look (click to grab the cursor) · **Shift** hustle
- **E** at the glowing **STOVE** (in the kitchen) or **TAPS** (west end of the
  bar): if there's an order cooking/pouring, starts a timing-bar minigame — hit
  **E** again with the marker in the green zone to finish it instantly (and
  tag it for a small tip bonus); miss and it still shaves time off. Walking
  away cancels it for free.
- **E** at the glowing **KITCHEN** or **BAR PICK-UP** counters: take the oldest
  ready order. A red marker appears over its customer.
- **E** next to the marked customer: hand it over. Boss service = +$2 flat tip,
  small room-mood bump, better tips the faster the order lands.
- **E** next to a regular (the one with a name over their head) with nothing in
  hand: their first round on the house. Once a night, first round only.
- **E** in a glowing ring by day: open that station's panel. **Esc** closes it.
- **1× / 2×** in the score bug set the night sim clock (movement stays real-time).
  They are DOM buttons, so pointer lock has to be released (Esc) before one is
  clickable — worth knowing if you ever drive this page from a script.
- The 🔊 next to the speed buttons mutes everything — one-shots and the bar-bed
  loop alike (`setMuted()`/`isMuted()` in `js/audio.js`).
- **`** (backquote) opens the dev menu from any phase. "Skip to last call" ends a
  running night immediately through the normal closing path, which is the only
  quick way to reach the box score: a night is eight sim hours at 45 real seconds
  each, six minutes at 1×.

One night = 8 sim hours (5 PM → 1 AM), 45 real seconds per hour at 1×.
The bar lives inside a **MAFA season** (`js/league.js`): eight named teams, a
14-week double round-robin, a four-team bracket over two more weeks, a
champion, then two dark weeks and a fresh schedule. The Mules play once a
week on a night that rotates Thursday, Sunday, Sunday, Monday; the other
three games of the week are on the screens for a smaller draw. A Mules night
is a bigger crowd and a heavier beer share, a rivalry night (the Sharks) or a
bracket night bigger still, and a game the Mules are already eliminated from
is a smaller one. Kickoff at 7, final at 11 — the TVs run a broadcast with
the real opponent on it and the standings up at halftime, the result is
rolled at the league's odds and written into the standings at settlement,
and Mules fans bounce when they win. The corkboard's Theme panel carries the
table and this week's fixtures.

## The day's decisions

- **Stock** — buy servings per item at wholesale; the night eats the shelves.
  86'd items get ordered around; fully bare shelves send patrons back out the
  door. Food (wings, burgers, nachos, fries) rots 15% of whatever's left every
  closed night — a settled night or a dark night alike. Beer and soda don't
  spoil. Stockpiling food against a slow night now has a real cost.
- **Crew** — up to 3 staff, each a **cook**, **server**, or **bartender** with
  a skill (1–5) driving wage and effectiveness. Cooks/bartenders push prep
  speed on their side of the ticket (no cook on shift = kitchen's closed, no
  food sells at all); servers are the walking NPCs who fetch and deliver.
  Applicants reroll every morning.
- **Upgrades** — 5 permanent, both-edged installs at the crate station: POS
  System, Staff Training, Craft Tap Wall, Premium Screens, Rush Expediting.
  Each helps (faster feet, faster prep, pricier beer, bigger draw) and costs
  nightly upkeep, charged forever once bought.
- **Theme** — Wing Night (crowd up, wings 40% off), Happy Hour (crowd up a
  little, drinks 25% off before 7), Watch Party ($50, big draw — game nights
  only, dead money otherwise).
- **Real Estate** — a one-way lease up the venue ladder: The Corner Tap →
  Fieldhouse ($5,500) → Midtown Draft Hall ($15,000) → The Fourth Quarter
  ($34,000). Cash up front, then 1-2 closed nights (rent/wages/upkeep still
  due, no patrons) before the doors reopen. Each rung lifts the crowd forecast
  and the nightly rent alike — see below.
- **Regulars, your name, and the bar across town.** Named regulars have a
  usual, a MAFA team and a loyalty number; who walks in on a given night is a
  pure function of the day, so the corkboard's forecast and the door agree.
  Reputation (0-100, opens at 50) drives the crowd multiplier, applicant skill
  and how well regulars stick. The End Zone across town has a buzz (10-95)
  that drags your crowd when it outruns your name — one line in the morning
  ticker, no panel. 86 a regular's usual, run an ugly floor, or go dark for a
  move and they drift; at zero they stop coming, and a great busy night can
  win them back. On the floor a regular is a person: they come through the
  door during hours 1-3 with a nameplate, take a stool at the bar, order the
  usual (and say so, once, if it is 86'd), and **E** next to them puts their
  first round on the house — $0 on the ticket, the tip on the shelf price,
  four loyalty at close.
- Rent is **$110/night at the Corner Tap, rising $50/rung up the ladder**
  ($160 / $210 / $260). Wages, rent, upgrade upkeep, and theme costs settle at
  close. Each rung is a bigger room too — 30, 44, 58 and 76 seats, more
  stoves and more taps — so the ladder's payoff is the crowd (`buzzMult`) and
  the stools to seat it. Two upgrades (Premium Screens, the Craft Tap Wall)
  need the Fieldhouse or bigger; the Upgrades panel says so.

## Files

- `js/engine.js` — pure night sim (arrivals, tickets, prep, tips, mood, game
  beats, stock consumption, promo pricing, cook/bartender prep-speed
  multipliers, the player's stove/tap minigame hooks). No three.js.
- `js/league.js` — the MAFA season, pure. The calendar is the schedule:
  season, week, phase and tonight's games are functions of the day number,
  and the save (`c.league`) carries only results, seeds, champions and the
  generator state. `syncLeague()` holds the one invariant (everything dated
  before today is played, nothing from today on), which is also how a save
  from before the league existed loads into the right week.
- `js/regulars.js` — the people who come back and the rival bar, pure. Who is
  in tonight is `dayRoll(id, day)`, one generator step off a hash of the
  regular's id and the campaign's day, so the answer is the same every time it
  is asked and nothing about it is stored. Also owns the reputation and buzz
  arithmetic, the loyalty drift, and the repair for all three fields.
- `js/campaign.js` — the books between nights: cash, calendar, stock orders,
  payroll + roles, promos, upgrades, settlement, persistence. Also pure — the
  save slot takes any localStorage-shaped object, and the smoke test passes a stub.
  `tonight()`, `isGameNight()`, `forecast()` and `mulesWinProb()` ask
  league.js; `settleNight()` hands the engine's result back to it.
  `repairCampaign()` is the load-time fill-in, and the note above it is the
  write-up of the session-8 audit: every field the game does arithmetic on, what
  an old save missing it actually did, and why a `typeof` check wasn't enough.
- `js/day.js` — day-phase controller: station rings + management panels
  (Stock, Crew, Theme, Upgrades, Real Estate, Door). The door's panel becomes
  the dark-night settlement instead of "Open the Doors" whenever a venue move
  is still settling in (`c.darkNightsLeft > 0`).
- Tests: `node test/smoke-engine.mjs`, `node test/smoke-campaign.mjs`,
  `node test/smoke-league.mjs`, `node test/smoke-regulars.mjs`,
  `node test/smoke-layout.mjs`, `node test/smoke-nav.mjs` and
  `node test/smoke-textures.mjs` (CI runs every
  `test/*.mjs`).
  `node tools/browser-check.mjs` boots the page in Chromium and is run by
  hand; it needs `playwright-core`. `node tools/measure-load.mjs` is the
  texture load measurement (below), and `node tools/make-textures.mjs` is
  the 1k generator.
- `js/layout.js` — the room as data, pure. One description per venue tier:
  room, kitchen, doorways, windows, bar, tables, fit-out blocks by kind, TV
  mounts, pendants, stand-points (the camera spawn, the idle-server line and
  the cook line included). Derives seats, colliders as plain boxes,
  `inBounds()`, a flood fill from the door, and `validate()` — every stool
  reachable, every doorway joining the rooms, no two stations within reach of
  each other. `test/fixtures/corner-tap.json` is what the old hand-built
  `world.js` produced, dumped from Chromium, and the suite holds the Corner
  Tap's derivation to it; the other three rooms are held to the invariant.
  It also holds the nav grid everything that walks plans on: the same 0.25 m
  cells with colliders inflated by the walker's 0.25 m radius, A* with no
  corner cutting, a string-pull, and `pathBetween()` / `pathToward()` /
  `reachableSeats()`. `validate()` carries `navProblems()`, so a room where a
  0.25 m body cannot reach a stool is refused at authoring time.
- `js/world.js` — the room in meshes, built from a `layout.js` description:
  main room + back-of-house kitchen (doorway east of the bar, pass-through
  window where food lands), TVs, neon sign, day/night light rigs, stove/tap
  minigame stations, upgrade crates. `buildWorld(scene, venueId)` refills
  `seats`/`colliders` and re-aims the stand-points on every call, since a
  signed lease, a dev warp, or "New Game" all call it again on the same page
  load.
- `js/patrons.js` — patron + server NPC state machines (bartenders stick to
  drink tickets), and `Route`, the waypoint queue both walk: planned off
  `layout.js`'s nav grid, replanned when the target moves 0.6 m, each leg
  walked with `stepToward()`. `freeSeat()` never offers a stool with no route
  to it — `world.js` hangs `reachable` on every seat when it adopts a room.
- `js/player.js` — pointer-lock movement, collision, pick-up/deliver, and the
  stove/tap timing-bar minigame.
- `js/textures.js` — the texture registry and the resolution tier, pure (below).
- `js/materials.js` — the loader: one counted `LoadingManager`, the tier
  chosen once, a 404 keeping that slot's placeholder colour.
- `js/main.js` — loop, HUD, overlays, broadcast theater.

## Textures

`js/textures.js` holds the registry (`MATS`) and references the exact Poly
Haven 2K filenames as downloaded — no renaming needed. Drop each asset's files
into its `textures/<key>/` folder:

| Folder | Asset | Files |
|---|---|---|
| `floorWood`   | wood_floor_deck | diff / nor_gl / **arm** |
| `wallPlaster` | painted_plaster_wall | diff / nor_gl / **arm** |
| `wallBrick`   | red_brick_plaster_patch_02 | diff / nor_gl / rough |
| `barTop`      | dark_wooden_planks | diff / nor_gl / **arm** |
| `tableTop`    | wood_table_001 | diff / nor_gl / rough |
| `ceiling`     | concrete_wall_008 | diff / nor_gl / **arm** |
| `kitchenTile` | wood_planks | diff / nor_gl / **arm** |
| `leather`     | brown_leather | **albedo** / nor_gl / rough |
| `metal`       | brushed_concrete | diff / nor_gl / rough |

**arm** files pack AO/roughness/metalness into one image (R/G/B) and get wired
to all three material slots automatically. `USE_TEXTURES` is `true`; any
missing file just falls back to that surface's placeholder color.

### Two tiers

The 2K originals are 27 files and 69,218,191 bytes. **Nobody downloads them by
default.** Each surface has a 1k copy beside it —
`textures/<key>/1k/<slug>_<map>_1k.jpg`, Poly Haven's own 1K filename, so a
hand-downloaded 1K set drops into the same place — and the set of 27 is
5,076,840 bytes, 13.6× lighter. `pickTier()` in `js/textures.js` chooses once
per page load, before the first `mat()` call:

- `?tex=1k` or `?tex=2k` on the URL wins outright.
- `navigator.connection.saveData` forces 1k.
- 2k only when it would show and the GPU can hold it: device pixel ratio ≥ 2,
  `renderer.capabilities.maxTextureSize` ≥ 8192, and a backing store at least
  2560 device pixels wide (a Retina laptop, a 4K desktop). A phone at dpr 3
  with a 1170 px backing store gets 1k.
- Everything else gets 1k.

The rule is pure and pinned in `test/smoke-textures.mjs`, which also fails
when any of the 54 files the registry names is missing on disk.

**Regenerate the 1k set** after changing a 2K original (the output is checked
in; nothing runs at page load, and the page never fetches a file this did not
write):

```
cd Projects/fourth-quarter
npm i --no-save playwright-core sharp     # node_modules/ is ignored; no package.json is created
node tools/make-textures.mjs              # --force to rewrite files that are up to date
```

1024×1024, Lanczos-3, mozjpeg. Normal maps are written with 4:4:4 chroma at
q88, everything else 4:2:0 at q85 — a normal map's tangent is its R and G
channels, and 4:2:0 stores those at half resolution; the numbers that chose
this are in the script's header comment.

### The loading line, and measuring it

Every texture load goes through one `THREE.LoadingManager`, and the start
overlay's last line reads `Loading textures 12 / 27 at 1k…` until it reads
`Textures 27 / 27 at 1k — ready.` (or `— 2 missing, painted flat.`).
`window.__fq.textures` is the same status for scripts.

`node tools/measure-load.mjs` (needs `playwright-core`, see above; `--mbps`
sets the throttle, default 20; `--tiers 1k,2k`) boots the page once per tier
with the network throttled through CDP and prints bytes on the wire, first
`requestAnimationFrame`, time to the manager's `onLoad`, and mesh / triangle
counts from a `window.__fq.scene` traverse. It exits non-zero when a tier does
not finish, a file 404s, or 1k is not at least 5× lighter than 2k. Measured
2026-09-07 (headless Chromium, swiftshader, 1280×800 at dpr 1, 40 ms latency):

| throttle | tier | textures on the wire | first rAF | fully textured | meshes | triangles |
| --- | --- | --- | --- | --- | --- | --- |
| 20 Mbps | 1k | 4.85 MB | 0.11 s | 5.02 s | 158 | 9,878 |
| 20 Mbps | 2k | 66.02 MB | 0.10 s | 30.86 s | 158 | 9,878 |
| 5 Mbps | 1k | 4.85 MB | 0.13 s | 11.72 s | 158 | 9,878 |
| 5 Mbps | 2k | 66.02 MB | 0.12 s | 114.50 s | 158 | 9,878 |

On a 5 Mbps line the 2k room takes 114.5 s to finish; the 1k room, 11.7 s.

## Roadmap (next sprints)

1. **Distinct rooms per venue tier — shipped, one rectangle each.** Four
   rooms, four seat counts, tier-gated upgrades. Still open: Midtown's second
   room and the flagship's mezzanine, which wait on NPC pathing (wishlist
   Phase 3).
2. **A difficulty curve tied to the calendar — decided and partly built.**
   Rent scales with venue tier (session 2); food spoilage (session 3, see
   above) answers the other half by making hoarding food a real cost. Still
   open: there's no fail state beyond a red HUD number and a warning — this
   session's spoilage is a cost curve, not a lease-can-be-lost mechanic.
   `SPOILAGE_RATE` in `js/campaign.js` is the one number to tune if 15%/night
   feels wrong once it's been played.
3. **Full campaign port — the league is in (wishlist Phase 6), and the
   regulars are (Phase 7, both increments: the books and the floor).**
   Still to port: distributors, a Commercial Walk-In upgrade to
   cut the spoilage rate, events as floor moments, and a season that nudges
   rent and wages, re-balanced for the 3D serving loop.
