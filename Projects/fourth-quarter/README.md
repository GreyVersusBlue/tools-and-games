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
Games land on **Thursdays and Sundays** — bigger crowds, heavier beer share.
Kickoff at 7, final at 11 — the TVs run a fake broadcast that agrees with the
engine's result, and Mules fans bounce when they win.

## The day's decisions

- **Stock** — buy servings per item at wholesale; the night eats the shelves.
  86'd items get ordered around; fully bare shelves send patrons back out the
  door. Unsold stock carries over (no spoilage yet — that's a later sprint).
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
- Rent is **$110/night at the Corner Tap, rising $50/rung up the ladder**
  ($160 / $210 / $260). Wages, rent, upgrade upkeep, and theme costs settle at
  close. The physical room doesn't grow with the tier — see Files below — so
  the ladder's payoff is the bigger crowd (`buzzMult`), not more seats.

## Files

- `js/engine.js` — pure night sim (arrivals, tickets, prep, tips, mood, game
  beats, stock consumption, promo pricing, cook/bartender prep-speed
  multipliers, the player's stove/tap minigame hooks). No three.js.
- `js/campaign.js` — the books between nights: cash, calendar, stock orders,
  payroll + roles, promos, upgrades, settlement, persistence. Also pure — the
  save slot takes any localStorage-shaped object, and the smoke test passes a stub.
  `repairCampaign()` is the load-time fill-in, and the note above it is the
  write-up of the session-8 audit: every field the game does arithmetic on, what
  an old save missing it actually did, and why a `typeof` check wasn't enough.
- `js/day.js` — day-phase controller: station rings + management panels
  (Stock, Crew, Theme, Upgrades, Real Estate, Door). The door's panel becomes
  the dark-night settlement instead of "Open the Doors" whenever a venue move
  is still settling in (`c.darkNightsLeft > 0`).
- Tests: `node test/smoke-engine.mjs` and `node test/smoke-campaign.mjs`.
- `js/world.js` — Corner Tap geometry: main room + back-of-house kitchen
  (doorway east of the bar, pass-through window where food lands), seats,
  colliders + walkable-bounds union, TVs, neon sign, day/night light rigs,
  stove/tap minigame stations, upgrade crates. One physical room at every
  venue tier — `buildWorld()` clears and rebuilds `seats`/`colliders` on
  every call, since a signed lease, a dev warp, or "New Game" all call it
  again on the same page load.
- `js/patrons.js` — patron + server NPC state machines (bartenders stick to
  drink tickets).
- `js/player.js` — pointer-lock movement, collision, pick-up/deliver, and the
  stove/tap timing-bar minigame.
- `js/materials.js` — the texture registry (below).
- `js/main.js` — loop, HUD, overlays, broadcast theater.

## Textures

`js/materials.js` references the exact Poly Haven 2K filenames as downloaded —
no renaming needed. Drop each asset's files into its `textures/<key>/` folder:

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
to all three material slots automatically. `USE_TEXTURES` is now `true`; any
missing file just falls back to that surface's placeholder color.

## Roadmap (next sprints)

1. **Distinct rooms per venue tier.** The ladder is reachable now (Real
   Estate station, session 2) but every tier is the same 30-seat room —
   upgrade tiering and a real seat cap can hook back in once this exists.
2. **A difficulty curve tied to the calendar.** Rent now scales with venue
   tier (session 2), which makes the ladder a tradeoff instead of a pure
   reward, but nothing yet reads `c.day` for cost — day 40 is exactly as
   easy as day 4 within a tier, and there's still no fail state.
3. **Full campaign port** — league standings, regulars, rival bar,
   distributors, spoilage (which would unlock a Commercial Walk-In-style
   upgrade), events as floor moments, re-balanced for the 3D serving loop.
