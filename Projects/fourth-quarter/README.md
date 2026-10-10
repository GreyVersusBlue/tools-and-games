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
campaign from any older build loads exactly as it did; the oldest carry no version
stamp, and `repairCampaign()` in `js/campaign.js` fills in everything added since.
The save is at version 3: `migrateCampaign()` signs a file from before the supply
houses with County Line, which charges what the game always charged, and gives
a file from before the rota no rota, which is the crew working every night as
it always did.

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
  loop alike (`setMuted()`/`isMuted()` in `js/audio.js`). How loud each
  sound is against the others is "The mix", below.
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
  spoil. Stockpiling food against a slow night now has a real cost. (That is
  an undated shelf, which every campaign starts with; see **The shelf**.)
- **The rota** (in the Crew panel) — off until you post it, and it does not
  come back down. With no rota everyone on the payroll works every night,
  draws the wage every night, and never tires, improves or leaves on their
  own. Post it and a night off is a wage you keep, the payroll holds five
  (three work a night, the rest are on call), and a staffer who works a shift
  fresh earns a skill level every six shifts per level they hold, with $20 a
  night more. Against that, a shift is 12 of fatigue and only a night off
  takes 30 back, so five on and two off holds: at 60 they work a skill level
  down, at 85 two, and a burnt-out staffer calls out about one night in
  three. Morale under 25 is a roll to quit every night, 15%, or 30% with the
  End Zone's buzz at 50 or over, which gets 3 busier for it.
- **The shelf** (in the Stock panel, under the supply houses) — undated
  until you date it, and dating it is one way. Undated, food rots 15% of
  what is left at every close and drink never goes off, as it always did.
  **Dated**, that rule stops and each delivery keeps whole until its date:
  wings 3 nights, burgers 4, nachos 5, fries 7 and beer 14, the day it came
  in counted, soda for ever. The oldest sells first. At the close of a lot's
  last night all that is left of it goes at once. A night is closed under one
  rule or the other, never both. What is on the shelf when you date it is
  dated that day. The **Commercial Walk-In** ($1,000, $18 a night, open or
  dark, dated shelves only) adds 2 nights to food, the food already there
  included, and nothing to a keg. On a dated shelf the Health Inspector reads
  the dates: one plate on its last night is the fine.
- **The supply house** (in the Stock panel) — who the truck belongs to.
  **County Line** is list price with no strings. **Cask & Carton** is 10%
  under list for $110 a week, billed Mondays whether the doors opened or not,
  and $25 on any order under $120. **Gold Standard** is 12% over list, and
  every plate of food sells for 8% more. The two accounts also give bulk
  breaks by the line (food at 25, 50 and 100 servings, beer and soda at 75,
  150 and 300, for 4, 6 and 10% off) and 1% off for every $1,000 of stock
  bought, to 5%; switching houses forfeits it. A **par** on a line is what
  you want on the shelf at open, and Fill to Par tops the cart up to it.
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
- `js/supply.js` — the three supply houses, pure and import-free: what an
  order costs at each (`quote()`), the weekly fee, bulk breaks, loyalty, the
  par sheet and the repair for `c.dist` and `c.pars`. campaign.js owns the
  record and the cash.
- `js/staff.js` — the crew as people, pure and import-free: who is on shift
  tonight (`tonight()`), what a night does to fatigue, morale and the count
  toward a level (`after()`), who calls out, and the repair for `c.crew`.
  campaign.js owns the record, the payroll and the cash; `shiftCrew()` there
  is what the night engine and the floor are handed.
- `js/events.js` — the night's moments, pure. All 21 of the 2D build's
  event cards with their `when`/`cd`/`weight` shape, a picker over the
  save's cooldowns and a nightly budget, and resolution as data: a choice
  returns `{ fx, line, cls }` and the engine spends `fx` (cash, mood, crowd,
  stock, rep, loyalty, buzz, the supply account's standing, a night flag, a
  raise, a walkout, a wager).
  `js/moments.js` is the floor's half: a person who walks in from the door
  or a lit prop at the card's stand-point, answered with E.
- `js/campaign.js` — the books between nights: cash, calendar, stock orders,
  payroll + roles, promos, upgrades, settlement, persistence. Also pure — the
  save slot takes any localStorage-shaped object, and the smoke test passes a stub.
  `tonight()`, `isGameNight()`, `forecast()` and `mulesWinProb()` ask
  league.js; `settleNight()` hands the engine's result back to it.
  `repairCampaign()` is the load-time fill-in, and the note above it is the
  write-up of the session-8 audit: every field the game does arithmetic on, what
  an old save missing it actually did, and why a `typeof` check wasn't enough.
  `billsFor()` is the one place a night's wages, rent and upkeep are summed,
  and both settlements spend it; `applyLease()` is the landlord's count and
  `evictLease()` the demotion, both run once per settled night, open doors or
  dark.
- `js/day.js` — day-phase controller: station rings + management panels
  (Stock, Crew, Theme, Upgrades, Real Estate, Door). The door's panel becomes
  the dark-night settlement instead of "Open the Doors" whenever a venue move
  is still settling in (`c.darkNightsLeft > 0`), and the run summary once a
  run has failed (`c.failed`).
- Tests: `node test/smoke-engine.mjs`, `node test/smoke-campaign.mjs`,
  `node test/smoke-league.mjs`, `node test/smoke-regulars.mjs`,
  `node test/smoke-events.mjs`, `node test/smoke-layout.mjs`,
  `node test/smoke-nav.mjs`, `node test/smoke-textures.mjs`,
  `node test/smoke-settle.mjs`, `node test/smoke-crowd.mjs`,
  `node test/smoke-supply.mjs`, `node test/smoke-staff.mjs`,
  `node test/smoke-shelf.mjs`, `node test/smoke-season.mjs`,
  `node test/smoke-mix.mjs` (the mix, below) and
  `node test/gltf-loader.mjs` (CI runs every `test/*.mjs`).
  `test/crowd-floor.mjs` is the busy floor `smoke-crowd.mjs` runs and is not
  a suite; `test/fixtures/season.mjs` is the bot that plays a seeded season
  for `smoke-supply.mjs`, `smoke-staff.mjs`, `smoke-shelf.mjs` and `smoke-season.mjs` and is not one either. `smoke-crowd.mjs` takes about 20 s; the rest are under two. The last one drives
  Chromium through `Tools/board-check/harness.mjs`, so it needs `npm ci` in
  that folder first; CI does that for the whole job.
  `node tools/browser-check.mjs` boots the page in Chromium and is run by
  hand; it needs `playwright-core`. `node tools/measure-load.mjs` is the
  texture load measurement (below). Both texture tiers are written by
  `Tools/board-check/asset-pipeline.mjs` (below).
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
- `js/walk.js` — how a body crosses the room, pure so Node runs it: `Route`,
  the waypoint queue every walker follows (planned off `layout.js`'s nav
  grid, replanned when the target moves 0.6 m, each leg walked with
  `stepToward()`), `settleY()`, which brings a body's feet to the floor at a
  walk, and `separate()`, the once-a-frame rule that keeps two bodies out of
  each other. Its header states the rule whole.
- `js/patrons.js` — patron + server NPC state machines (bartenders stick to
  drink tickets), walking `walk.js`'s `Route` in tonight's room. `freeSeat()` never offers a stool with no route
  to it — `world.js` hangs `reachable` on every seat when it adopts a room.
- `js/player.js` — pointer-lock movement, collision, pick-up/deliver, and the
  stove/tap timing-bar minigame.
- `js/textures.js` — the texture registry and the resolution tier, pure (below).
- `js/materials.js` — the loader: one counted `LoadingManager`, the tier
  chosen once, a 404 keeping that slot's placeholder colour.
- `js/main.js` — loop, HUD, overlays, broadcast theater.
- `libs/three.module.js` — three.js r160, the only entry in `index.html`'s
  import map. `libs/addons/loaders/GLTFLoader.js` and
  `libs/addons/utils/BufferGeometryUtils.js` are three@0.160.0's own files,
  unmodified (byte for byte against `Tools/board-check/three-0.160.0/`), there
  for the Blender bar pack (WISHLIST.md, Blender assets). r160's loader imports
  that one util and `three`, so the map needs nothing new.
  `test/gltf-loader.mjs` proves it loads a hand-built GLB, a triangle strip
  included, in a real browser. Nothing in the game imports it yet.

## The mix

Devon listened on 2026-10-07 and said "Sound levels are a bit all over the
place, crowd is loud." This is what was measured about that and what was
changed (#942). **Nobody has listened to the new mix.** It was set by
arithmetic on a machine with no speakers, and it wants Devon's ears before
any of it is called right.

No file was re-encoded. `js/audio.js` has a trim per sound (`TRIM`) and one
function, `gainFor()`, that sets every element's volume: the trim, times the
master volume (0.8, unchanged), times the call site's own number, which is 1
everywhere but the staff's cash register at 0.7. An `<audio>` element can only
turn a file down, so the mix is anchored on the quiet files.

How it was measured: `tools/measure-audio.mjs` decodes each file (GStreamer
here; `ffmpeg` if it is on the PATH) and `tools/loudness.mjs` reads it by
ITU-R BS.1770, K-weighted and gated. A one-shot is judged by its loudest
400 ms and a loop by its programme loudness (marked I), both in LUFS, and a
mono file is counted on both speakers. "Heard before" and "Now" are the file's
figure plus the gain. The measurements are committed as `audio/levels.json`
with each file's SHA-256, because CI has no decoder.

| Sound | Role | Fires | File | File, LUFS | Peak, dBFS | Gain before | Heard before | Gain now | Now, LUFS | Change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `orderDing` | cue | every order, and each event card | `sfx/order-ding.ogg` | -13.0 | -0.8 | 0.8 | -14.9 | 0.224 | -26.0 | -11.1 dB |
| `ticketReady` | cue | every ticket the kitchen finishes | `sfx/ticket-ready-bell.ogg` | -19.6 | -0.9 | 0.8 | -21.5 | 0.48 | -26.0 | -4.4 dB |
| `cashRegister` | cue | every sale | `cash-register.ogg` | -11.9 | -1.4 | 0.8 | -13.8 | 0.2 | -25.9 | -12.0 dB |
| `cashRegister` × 0.7 | cue, staff | every sale, by staff | `cash-register.ogg` | -11.9 | -1.4 | 0.56 | -16.9 | 0.14 | -29.0 | -12.0 dB |
| `uiClick` | ui | buttons, mostly by day | `sfx/ui/ui-click.ogg` | -26.6 | -1.4 | 0.8 | -28.6 | 0.68 | -30.0 | -1.4 dB |
| `uiOpen` | ui | a panel opened | `sfx/ui/ui-station-open.ogg` | -11.2 | -0.9 | 0.8 | -13.1 | 0.112 | -30.2 | -17.1 dB |
| `uiClose` | ui | a panel closed | `sfx/ui/ui-station-close.ogg` | -11.2 | -1.0 | 0.8 | -13.1 | 0.112 | -30.2 | -17.1 dB |
| `qteHit` | cue | a QTE landed | `sfx/qte/qte-hit-perfect.ogg` | -9.0 | -1.0 | 0.8 | -10.9 | 0.144 | -25.8 | -14.9 dB |
| `qteMiss` | cue | a QTE missed | `sfx/qte/qte-miss.ogg` | -19.0 | -1.3 | 0.8 | -21.0 | 0.448 | -26.0 | -5.0 dB |
| `crowdGroan` | crowd | once, on a loss, with the whistle | `sfx/events/crowd-groan.mp3` | -19.8 | -11.1 | 0.8 | -21.8 | 0.2 | -33.8 | -12.0 dB |
| `stormOut` | crowd | every walkout, 13 s each, several at once on a bad night | `sfx/events/patron-storm-out.ogg` | -21.1 | -11.4 | 0.8 | -23.0 | 0.176 | -36.2 | -13.2 dB |
| `stingerKickoff` | cue | once a night | `sfx/events/stinger-kickoff.ogg` | -23.6 | -1.0 | 0.8 | -25.5 | 0.68 | -26.9 | -1.4 dB |
| `stingerFinal` | cue | once a night | `sfx/events/stinger-final-whistle.ogg` | -4.0 | -3.9 | 0.8 | -6.0 | 0.08 | -26.0 | -20.0 dB |
| `barBed` | bed | the whole night | `ambience/bar-bed-crowded-pub-loop.ogg` | -26.0 I | -1.5 | 0.28 | -37.1 | 0.064 | -49.9 | -12.8 dB |
| `sizzle` | work | while searing | `sfx/qte/qte-sizzle-loop.ogg` | -39.1 I | -4.5 | 0.44 | -46.2 | 0.48 | -45.5 | +0.8 dB |
| `pour` | work | while pouring | `sfx/qte/qte-pour-loop.ogg` | -36.6 I | -8.4 | 0.44 | -43.7 | 0.48 | -42.9 | +0.8 dB |

What the table says about 2026-10-07:

- **The one-shots sat 22.6 dB apart as played** (the final whistle at -6.0,
  the UI click at -28.6) and the seven gameplay cues 19.6 dB apart. The cues
  are now within 1.1 dB of each other at -26, the three UI sounds within 0.2
  at -30, and a panel opening is no longer as loud as the register.
- **The crowd is three sounds and each is down 12 to 13 dB**: the bed 12.8
  (0.35 to a trim of 0.08), the groan 12.0, a walkout 13.2. Why that number:
  to level the cues the order ding had to come down 11.1 dB and the register
  12.0, so a crowd brought down by less than 12 would have ended louder
  against them than it was when Devon called it loud. At 12 to 13 it has not
  gained on either, and it is 7 to 9 dB lower against the ticket bell and a
  missed QTE.
- **The bed was 9.1 dB over the sizzle it plays under and is now 4.4 dB
  under it** (7.0 under the pour). Its loudest 400 ms was level with the UI
  click and is now 11.2 dB under the quietest UI sound and 5.2 under a single
  walkout.
- **A walkout is a 13-second clip**, not a door slam, and nothing stops three
  from sounding at once. Three were -18.2 LUFS, louder than the ticket bell,
  a missed QTE and the kickoff sting; three are now -31.4, 5 dB under a cue.
- **Headroom.** The files peak within 1.5 dB of full scale, so sample peaks
  are what limit the level. For what the code fires on one tick over the
  loops (kickoff mid-sear is the worst) the peaks summed to +1.7 dBFS and now
  sum to -0.5. For the loudest pile worth calling plausible (bed, sear,
  kickoff, three walkouts, a ding, a bell and a sale) the loudest 400 ms sum
  to -19.6 LUFS where they were -10.0; the bound on its sample peaks is +5.6
  dBFS where it was +12.0. That bound is over full scale and is left there on
  purpose: it needs nine one-sample peaks on the same sample, and taking it
  under 0 would cost every sound another 6 dB.

What a gain cannot fix, left as it is: `stinger-kickoff.ogg` peaks at -1.0
dBFS over a body of -23.6 LUFS, so it is the file that sets the ceiling and
it plays at 0.85; `ui-click.ogg` is 10 ms long. The loud cues (the ding, the
register, a landed QTE, a panel) are 11 to 17 dB quieter at the same knob
than they were, which is the price of levelling to the quiet files: turn the
speakers up. There is still no volume slider, only
the mute, and the mute is not saved (it never was).

`test/smoke-mix.mjs` (111) recomputes the table from `levels.json`, from
`gainFor()` and from the call sites it reads out of `js/`, and fails when a
role leaves its band, when a file's hash is not the measured one, or when a
call site passes a volume it does not know about. After replacing or adding a
sound, run `node tools/measure-audio.mjs` where a decoder is, then
`node test/smoke-mix.mjs --table` for this table.

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

The 2K set is 27 files and 22,965,335 bytes, Poly Haven's 2K downloads
(69,218,191 bytes) re-encoded at q88 by the asset pipeline (#622). **Nobody
downloads it by default.** Each surface has a 1k copy beside it —
`textures/<key>/1k/<slug>_<map>_1k.jpg`, Poly Haven's own 1K filename, so a
hand-downloaded 1K set drops into the same place — and the set of 27 is
5,076,840 bytes, 4.5× lighter. `pickTier()` in `js/textures.js` chooses once
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

**Both tiers are generated** by the recipe `fourth-quarter-textures` in
`Tools/board-check/asset-pipeline.mjs`, which reads the 2K downloads out of git
at a named commit (#619), so re-running it never re-encodes its own output. The
output is checked in; nothing runs at page load. `tools/make-textures.mjs` was
the 1k generator until 2026-09-24; it read the 2k files off disk, which stopped
being safe the day they were re-encoded, and the recipe reproduced its 27
files byte for byte (#622).

```
cd Tools/board-check
npm i --no-save sharp@0.35.4
node asset-pipeline.mjs fourth-quarter-textures           # write both tiers
node asset-pipeline.mjs fourth-quarter-textures --check   # measure what is committed
```

2048 kept at its size and 1024×1024 by Lanczos-3, mozjpeg. Normal maps are
4:4:4 at q88 in both tiers; everything else is 4:2:0, q88 at 2k and q85 at 1k.
A normal map's tangent is its R and G channels, and 4:2:0 stores those at half
resolution; the numbers that chose this are in the pipeline's header. `--check`
decodes every committed file and exits 1 if its worst channel's RMSE against
the original, resized to the file's own size, is over 9 (the worst today is the
leather's 1k roughness at 8.34), or if a file is not the size its tier names.
`test/smoke-textures.mjs` pins the sizes too, from the JPEG header, where CI
runs it.

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
not finish, a file 404s, or 1k is not at least 4× lighter than 2k (5× until
the 2k set was re-encoded). Measured 2026-09-24 (headless Chromium,
swiftshader, 1280×800 at dpr 1, 40 ms latency); the 2k rows in brackets are
2026-09-07's, from Poly Haven's downloads:

| throttle | tier | textures on the wire | first rAF | fully textured | meshes | triangles |
| --- | --- | --- | --- | --- | --- | --- |
| 20 Mbps | 1k | 4.85 MB | 0.14 s | 6.33 s | 158 | 9,878 |
| 20 Mbps | 2k | 21.91 MB (66.02) | 0.11 s | 13.45 s (30.86) | 158 | 9,878 |
| 5 Mbps | 1k | 4.85 MB | 0.12 s | 12.00 s | 158 | 9,878 |
| 5 Mbps | 2k | 21.91 MB (66.02) | 0.13 s | 41.21 s (114.50) | 158 | 9,878 |

On a 5 Mbps line the 2k room takes 41.2 s to finish, down from 114.5; the 1k
room, 12.0 s. The 1k rows moved by a second against 2026-09-07's with the same
bytes, which is this sandbox's timing, not the files.

## Roadmap (next sprints)

1. **Distinct rooms per venue tier — shipped, one rectangle each.** Four
   rooms, four seat counts, tier-gated upgrades. Still open: Midtown's second
   room and the flagship's mezzanine, which wait on NPC pathing (wishlist
   Phase 3).
2. **A difficulty curve tied to the calendar, and a night you can lose —
   shipped (wishlist Phase 9).** Rent scales with venue tier (session 2);
   food spoilage (session 3, see above) makes hoarding food a real cost; and
   the lease can now be lost. A night whose books close below $0 is a missed
   night, three in a row and the landlord takes the room — with the warning
   on the Tonight panel, in the ticker and on the box score before the
   eviction. Losing the lease **drops you a rung rather than ending the run**:
   the smaller room's move-in nights come due, gear it has no wall for comes
   off with its upkeep, the regulars over its cap stop coming, and the debt is
   written off against the seized deposit. Only an eviction from the Corner
   Tap ends a run, because there is nowhere below it; the box score then
   carries the run summary. `LEASE_FLOOR`, `LEASE_STRIKES` and
   `RECOVERY_CASH` in `js/campaign.js` are the three numbers, and
   `SPOILAGE_RATE` is still the one to tune if 15%/night feels wrong once it
   has been played.
3. **Full campaign port — the league is in (wishlist Phase 6), the
   regulars are (Phase 7, both increments: the books and the floor), and
   the event cards are moments on the floor (Phase 8), and the three
   supply houses with their two cards are in the Stock panel (2026-10-06),
   and the crew has a rota (the same day; designed here, since the 2D build
   has no staff system to port), and the shelf can be dated, with the
   Commercial Walk-In (the same day again, #909), and a season moves rent
   and wages for a bar that signs season terms in the Real Estate panel
   (the same day, #911). The back office is all in.**
   Each of the four is off until the player turns it on; none has been
   played by a person, so their numbers are the 2D build's and not yet
   re-balanced for the 3D serving loop.
