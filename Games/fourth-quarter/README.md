# The Fourth Quarter — 3D (Sprint 3D-2: The Day Phase)

A full day loop, first-person. **Days**: the room sits empty in daylight and
you manage at four glowing stations — stock back in the kitchen (through the
doorway behind the bar), the crew at the bar, tonight's theme at the corkboard,
and the front door to open up.
**Nights**: patrons, tickets, your servers, and you on the floor. **Close**:
box score, wages and rent come out of the till, tomorrow's ledger.

The campaign persists (localStorage): cash, day counter, stock, payroll.
Fresh balance, no save compatibility with the 2D game (by design).

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
- **E** at the glowing **KITCHEN** or **BAR PICK-UP** counters: take the oldest
  ready order. A red marker appears over its customer.
- **E** next to the marked customer: hand it over. Boss service = +$2 flat tip,
  small room-mood bump, better tips the faster the order lands.
- **E** in a glowing ring by day: open that station's panel. **Esc** closes it.
- **1× / 2×** in the score bug set the night sim clock (movement stays real-time).

One night = 8 sim hours (5 PM → 1 AM), 45 real seconds per hour at 1×.
Games land on **Thursdays and Sundays** — bigger crowds, heavier beer share.
Kickoff at 7, final at 11 — the TVs run a fake broadcast that agrees with the
engine's result, and Mules fans bounce when they win.

## The day's decisions

- **Stock** — buy servings per item at wholesale; the night eats the shelves.
  86'd items get ordered around; fully bare shelves send patrons back out the
  door. Unsold stock carries over (no spoilage yet — that's a later sprint).
- **Crew** — up to 3 servers; each has a speed (ticket-clearing pace) and a
  nightly wage. Applicants reroll every morning.
- **Theme** — Wing Night (crowd up, wings 40% off), Happy Hour (crowd up a
  little, drinks 25% off before 7), Watch Party ($50, big draw — game nights
  only, dead money otherwise).
- Rent is **$110/night**, always. Wages, rent, and theme costs settle at close.

## Files

- `js/engine.js` — pure night sim (arrivals, tickets, prep, tips, mood, game
  beats, stock consumption, promo pricing). No three.js.
- `js/campaign.js` — the books between nights: cash, calendar, stock orders,
  payroll, promos, settlement, persistence. Also pure.
- `js/day.js` — day-phase controller: station rings + management panels.
- Tests: `node test/smoke-engine.mjs` and `node test/smoke-campaign.mjs`
  (~250 checks combined).
- `js/world.js` — Corner Tap geometry: main room + back-of-house kitchen
  (doorway east of the bar, pass-through window where food lands), seats,
  colliders + walkable-bounds union, TVs, neon sign, day/night light rigs.
- `js/patrons.js` — patron + server NPC state machines.
- `js/player.js` — pointer-lock movement, collision, pick-up/deliver.
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

1. **Venue ladder** — distinct rooms per tier, upgrades as visible props
   (POS terminal on the bar, craft tap wall, kitchen line through the pass).
2. **Full campaign port** — league standings, regulars, rival bar,
   distributors, spoilage, events as floor moments, re-balanced for the 3D
   serving loop.
