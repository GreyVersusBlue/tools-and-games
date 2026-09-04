# The Fourth Quarter — Feature Wishlist

**Status: nothing is open and nothing is broken.** Three rounds shipped the
day phase, the venue ladder, the shared save system and spoilage, and the
project had run its own task list out by the time the prompt rounds ended.
Both suites are green as of this file — `node test/smoke-campaign.mjs` 203
passed, `node test/smoke-engine.mjs` 190 passed — and round 3's site-wide
`npm run games` reported 146 checks, 0 failed across three independent runs on
a real-Chrome environment, including this project's own 45-check Real Estate
beat. The first open phase is **Phase 1 — The room is a description**, named
model **Claude Fable 5.1**. What follows is nine phases across two arcs, the
conventions three rounds learned the hard way, and the backlog nobody has
claimed.

## What it is

A first-person sports-bar management sim at
`Projects/fourth-quarter/index.html`. No build step, no dependencies beyond a
vendored three.js (`libs/three.module.js`, r160, 1.27 MB), nothing to install.
It does need to be **served** — ES modules plus an import map, so `file://`
gets you nothing; `python3 -m http.server 8000` from the project folder is
enough.

The loop is a day and a night. By day the room sits empty in flat daylight and
you walk between six glowing rings — Stock, Crew, Theme, Upgrades, Real Estate
and the Door — press E, and manage in a DOM panel. By night eight sim hours run
at 45 real seconds an hour: patrons walk in, take a stool, order, wait
`PATIENCE` seconds and walk out if you blow it. Servers fetch and deliver; you
can beat them to it for a flat $2 boss tip, and you can work the stove or the
taps on a timing bar to finish a ticket early. Thursdays and Sundays the TVs
run a fake Mules broadcast that agrees with the engine's own result. At last
call a box score settles wages, rent, theme cost and upgrade upkeep, rots 15%
of the food on the shelf, and writes tomorrow's ledger.

What it is not: a campaign. The 2D original next door
(`Projects/The-Fourth-Quarter.html`, 1,956 lines — **deliberately kept live as
the board's archive card and not yours to touch, merge or clean up**, locked
decision #2) has ten sprints of systems this build has never had: a 14-week
MAFA season with playoffs and an off-season, eight named teams, regulars with
loyalty, a rival bar with a buzz number, three distributors, ads, reputation,
and 21 mid-night event cards with real choices. The 3D build has the *floor*
the 2D build never had and roughly a third of its books. It also has no way to
lose: cash goes red and stays red. The venue ladder is the sharpest version of
that gap — four tiers, one-way leases at $0 / $5,500 / $15,000 / $34,000, each
with more `buzzMult` and more rent, and every one the same 30-seat room,
because `buildWorld()` takes a venue argument and ignores it. Round 2 made that
honest rather than fixing it (`VENUES[].seats` is 30 four times over with a
comment saying why). Honest is not built.

## The architecture that is there

- **`js/engine.js` (275)** — the night sim. Arrivals accrued into a
  `spawnDebt` against `HOUR_W`, tickets through `prep → ready → carried →
  done`, prep multipliers, promo pricing, stock consumption, mood, the Mules
  game beats. `update(dt)` returns events and knows nothing about who draws
  them. Zero imports.
- **`js/campaign.js` (482)** — the books between nights: stock, `VENUES`,
  `UPGRADES`, `PROMOS`, `ROLES`, payroll, `settleNight()`,
  `settleDarkNight()`, `applySpoilage()`, `repairCampaign()`, the save slot.
  Imports `MENU`/`FOOD` from engine.js and `createSaveSlot` from
  `../../../assets/js/gvb-save.js`, nothing else. Also pure — the tests hand it
  a plain object as storage.
- **`test/smoke-campaign.mjs` (458 lines, 203 assertions)** and
  **`test/smoke-engine.mjs` (155 lines, 190 assertions)** — Node only, no
  runner, no dependency: a `pass`/`fail` counter and an `ok()`.
- **`js/world.js` (363)** — the Corner Tap in metres. Main room x∈[-8,8]
  z∈[-5.5,5.5], a kitchen behind the north wall through `DOORWAY` x∈[2.1,3.7],
  a pass-through `WINDOW`, six stools and six four-tops, three TVs, two light
  rigs. Exports `seats[]`, `colliders[]`, `inBounds()` and named stand-points.
- **`js/materials.js` (95)** — nine texture sets keyed by surface, ARM maps
  wired to three material slots each, a 404 falling back to a placeholder
  colour.
- **`js/patrons.js` (258)** — `Patron`/`Server` state machines and the meshes.
  **`js/player.js` (215)** — hand-rolled pointer-lock camera, collision,
  pick-up/deliver, the timing bar. **`js/day.js` (348)** — six station rings and
  every management panel. **`js/main.js` (477)** — loop, HUD, box score,
  broadcast theatre, the save bar mounted three times, `rebuildVenue()`.
  **`js/dev.js` (120)** and **`js/audio.js` (141)** — the backquote cheat menu;
  twelve one-shots and three loops with a mute toggle.

The load-bearing habit is **pure module plus its suite**: two files hold every
number the game decides, they import no three.js, and 393 assertions sit on
them. Everything visual is downstream and untested.

Where it breaks down is `world.js`: 363 lines of literal coordinates with no
data behind them and no test of any kind. `day.js` keeps its own copy of the
station coordinates. And nothing that walks consults the colliders —
`stepToward()` moves a mesh along the straight line to its target, every patron
and every server uses it, so they already walk through the four-tops today. In
one open 16×11 m room that reads as a stylisation. It stops reading that way
the moment there is a wall between the door and the stool.

## Conventions a new builder must know

- **A new pure module ships with its suite in the same phase.** No exceptions.
  `node test/smoke-engine.mjs` and `node test/smoke-campaign.mjs`, run from
  inside `Projects/fourth-quarter`, are the whole test story — no runner, no
  `package.json`, no dependency. Add assertions to those files or add a third
  `smoke-*.mjs` in the same shape.
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision
  #34). Round 3 set `SPOILAGE_RATE` to `0`, watched exactly three of seven new
  assertions fail, restored it, watched 203 pass. Do that, and write down which
  assertions failed.
- **Anything that decides a number goes in `engine.js` or `campaign.js`.** Both
  import cleanly under plain Node. The moment a rule needs `document` or
  `THREE` it is in the wrong file — pass the answer down as an event or a
  return value, the way `update(dt)` already does.
- **Never change the storage key** (locked decision #36). It is `fq3d-save`,
  and saves written by builds with no version stamp at all still load.
- **`migrate` is for version drift; `repair` is for every load** (locked
  decision #37). New fields get their default in `repairCampaign()`, never in a
  migration; collections are normalised before the loops that iterate them.
  The comments in that function are the session-8 audit's write-up of what each
  missing field actually did.
- **Nothing here touches `localStorage` directly, including `main.js`.**
  `campaignSlot()` owns it through `../../../assets/js/gvb-save.js` — imported
  relatively, because the tests resolve the same specifier under Node.
  `gvb-save.js` is not yours to edit; a missing hook goes in the notes file as
  an exact signature.
- **Staff are matched by name.** `hire()` and `fire()` take a name string, and
  `repairCampaign()` numbers unnamed staff `Staffer 1`, `Staffer 2` rather than
  inventing names, precisely so two of them can never collide.
- **`?? default` is not enough for a number that arrives from arithmetic.**
  Every numeric option in `NightEngine`'s constructor goes through `fin()`: a
  NaN `crowdTarget` makes `spawnDebt` NaN, makes `while (spawnDebt >= 1)` never
  true, and plays a silent eight-hour night with nobody in it. Use
  `fin()`/`num()`, and mean it where a floor of 0 is meaningful (`foodMult: 0`
  is "no cook on shift", not "unset").
- **Direct `camera.rotation` writes do not work here** (locked decision #35).
  `player.js` keeps its own `yaw`/`pitch` and rewrites `camera.rotation` every
  frame, so a raw write is gone within ~16 ms. Use `lookAt`, and script this
  page from `Tools/board-check` with `walkTo({ steer: 'lookAt', sens })`
  (locked decisions #55, #56), never the default `aimAt()`.
- **Before deciding a steering fix is broken, check whether pointer lock is
  held** (locked decision #56). `player.js`'s mousemove handler is gated on
  `this.locked`, which only a canvas click ever sets — and `dev.js`'s `open()`
  and `day.js`'s `interact()` both call `document.exitPointerLock()` and never
  re-acquire it. A dispatched mousemove after either is correctly ignored,
  silently. `await p.click('canvas')` first.
- **`buildWorld()` clears `seats` and `colliders` at the top, every call.** A
  signed lease, a dev warp and "New Game" all call it again on the same page
  load; without the reset each rebuild stacked another room's worth of seats
  and collision boxes at the same coordinates. Any new module-level array in
  `world.js` inherits that obligation.
- **`day.rebuildStations()` is the hook a new floor plan has to notice.**
  `rebuildVenue()` has always called it; it reads as a no-op today only because
  every tier is the same metres.
- **The 3D layer owns occupancy; the engine owns the cap.** `beginNight()`
  passes `seats: seats.length` from world.js, never `VENUES[].seats`, so the
  arrival gate cannot drift from the room a player can see.
- **Zero offsite requests, no build step, one vendored three.js per project**
  (locked decisions #17, #18, #19). A texture pipeline or a loader addon is a
  checked-in artifact produced offline, never a runtime fetch.
- **Assert against the DOM for what just happened, against the save only for
  what a reload has to survive** (#39); a real-time assertion failing under a
  software-rendered Linux Chromium is inconclusive (#53).

## Questions for Devon

The prompt file's own block is closed — spoilage answered it. These are what
the phases below would need answered.

1. **Should the ladder be physically bigger?** Four tiers, $0 to $34,000, one
   30-seat room, and `buildWorld()` ignores the venue it is handed. Phases 1-3
   are the largest single piece of work in this file. Round 2's honest-30-seats
   fix means nothing currently lies, so this is a want, not a fix.
2. **Should there be a way to lose?** Cash goes negative, turns red, and
   nothing else happens. Options that fit what exists: a bankruptcy threshold,
   a lease that can be lost (a downgrade rather than a game over), a bank that
   stops lending. Round 3 declined to invent one unprompted and was right to.
3. **How much of the 2D campaign is actually wanted?** 21 event cards, a
   14-week season with a 4-team bracket, regulars, a rival, three distributors.
   All of it ports; none of it is small; a 3D floor game with a full back
   office is a different game. Phases 6-9 assume "most of it, in that order."
4. **Is 66 MB of texture on first paint acceptable?** 27 JPEGs, 69,218,191
   bytes, all 27 loaded by the first room. Uncompressed in GPU memory that is
   roughly 600 MB with mipmaps (2048² × 4 × 27 × 1.33 — arithmetic, not a
   measurement). Phase 4 cuts it by an order of magnitude at some visible cost.
5. **Has `SPOILAGE_RATE = 0.15` actually been played yet?** One number in
   `campaign.js`, tune by feel; no assertion depends on the exact value except
   one asserting 15% of 20 rounds to 3.

## The standing backlog

Open and unclaimed. Pull from here for a phase, and add here rather than
starting a new list.

**The room**
- `buildWorld(scene, venue)` takes a venue and ignores it; `world.js` has no
  data layer and no test of any kind.
- Every NPC walks a straight line (`stepToward`), consulting neither
  `colliders` nor `inBounds`. Patrons already clip the four-tops.
- `PASS_FOOD`, `PASS_DRINK`, `STOVE_STATION`, `TAP_STATION`,
  `UPGRADES_STATION` and every station-ring position in `day.js` are literal
  coordinates in two different files.
- Nothing is ever occluded: three TVs, five pendants and a key light render
  every frame regardless of where you stand. `velLook` in `patrons.js` is
  written by `stepToward()` and read by nothing.

**Assets**
- 27 2k JPEGs, 66 MiB, no 1k variants, no KTX2/basis, no resolution tier. The
  largest single file is `painted_plaster_wall_nor_gl_2k.jpg` at 3.86 MB — a
  normal map, the one map where JPEG chroma subsampling does the most damage.
- `audio/sfx/events/crowd-groan.mp3` is the last non-OGG file after round 2's
  conversion.
- No loading screen: the room paints untextured and fills in as 27 files land.

**The books**
- No league, season, standings, playoffs or off-season. `gameNight` is
  `weekday() in ["Thu","Sun"]` and the result is a coin flip weighted 0.55.
- No regulars, rival bar, reputation, ads, distributors, bulk pricing or par
  levels.
- Spoilage is a flat 15% of the shelf; the 2D build tracks per-lot shelf life
  in days and lets a Commercial Walk-In add two. The 3D `UPGRADES` table has
  five entries and no walk-in.
- No fail state of any kind.
- `settleNight()` and `settleDarkNight()` duplicate the wages/rent/upkeep
  arithmetic.

**The night**
- No mid-night events. The 2D build has 21 with real choices.
- The Mules game is one home team and an anonymous opponent; the 2D build has
  eight named teams and a fixture list.
- A patron's whole personality is a shirt colour and a Mules-fan flag, and a
  Mules win has no cheer sound (`audio.js` says so) — just the whistle sting.

**Tooling**
- No CI workflow. `school-generator-ci.yml` is the only per-project job in
  `.github/workflows`; both suites already `process.exit(fail ? 1 : 0)`, so
  nothing stands between them and a runner but the YAML.
- `dev.js` cannot force a weekday, a crowd size, or a scripted night — every
  headed test walks the calendar with `+1 day`.

## Arc one — the room the ladder promises

Three rounds built a business you play in one room. Arc one stops there being
one room: a floor plan becomes data, four tiers become four real plans, the
people on the floor learn that a wall is a thing, and it ends on the two chores
that make the rest safe to ship. The phases are **ranked by impact and the
order is the recommendation**; 1 and 2 are a pair, and 3 is what makes 2
playable rather than embarrassing.

**Model convention for this project: run a phase on Claude Opus 5 unless it is
a new pure model layer with invariants that fail silently, or a refactor of
untested entangled code** — those run on Claude Fable 5.1, and each phase says
which and why in one clause. A phase is *finished* only when its branch has
become a pull request, that pull request has merged to main with CI green, and
the closing report names the **next open phase's number and its named model**.

## Phase 1 — The room is a description

**`buildWorld(scene, campaign.venue)` has taken a venue argument since session
one, and the function signature is `buildWorld(scene)`.**

Everything about the Corner Tap is a literal inside 363 lines of untested
scene-building, so nothing can ask that file a question — which is why `day.js`
keeps its own copy of the station coordinates. This phase separates describing
a room from building one, and puts the derived facts behind a pure module.

- [ ] **`js/layout.js`, pure, with `test/smoke-layout.mjs`.** A room is data:
  `{ id, room, kitchen, doorways[], windows[], bar, tables[], stools[],
  stations }`. The module derives `seatsFor()`, `collidersFor()` as plain
  `{min,max}` boxes with no `THREE.Box3`, `inBounds(desc, x, z, r)` and the
  named stand-points. No three.js import anywhere in it.
- [ ] **The Corner Tap becomes the first description.** Transcribe today's
  numbers exactly, `DOORWAY` x∈[2.1,3.7] and the corridor band included: the
  derived seat list must be the same 30 positions in the same order as today's
  `addSeat()` calls, and `inBounds()` must agree with the current function
  across a grid of samples in room, corridor and kitchen.
- [ ] **`world.js` builds from a description**, converting the derived boxes to
  `THREE.Box3` at the boundary; `seats`/`colliders` stay the exported
  module-level arrays, reset at the top. **`day.js` reads its station positions
  from the same description**, not from its own `THREE.Vector3` literals, and
  `rebuildStations()` starts doing something.
- [ ] **A walkability invariant, asserted.** Every seat's `approach` and every
  station stand-point is inside `inBounds()` and outside every collider, for
  every description in the table — the assertion that makes phase 2 authorable
  instead of a guessing game.
- [ ] **Reintroduce the bug.** Put a table on a stool's approach point and
  watch the invariant fail; move the doorway a metre east and watch the
  corridor test fail.

*Leans on:* `world.js`, `day.js`, `patrons.js`'s `freeSeat`. *Save:* none — a
description is derived from `c.venue`, which already exists and is already
repaired. *Model:* **Claude Fable 5.1** — a new pure geometry layer extracted
from 363 lines with zero coverage, where a wrong number is a stool you cannot
reach and nothing says so.

## Phase 2 — Four rooms, one ladder

**Thirty-four thousand dollars buys you the same six four-tops.**

The ladder is real — a Real Estate desk, a cash gate, one-way leases, dark
nights, rent that scales — and the payoff is a bigger multiplier on a number.
With phase 1's format in hand this is authoring: four descriptions, each with
the fit-out its `VENUES` blurb already promises. The Fieldhouse's second stove,
Midtown's three-tap wall and the flagship's three stoves are all written down
and none of them exist.

- [ ] **Four descriptions.** Corner Tap as-is; the Fieldhouse wider with a
  second stove and 40-odd seats; Midtown with a real draft wall and a second
  room off the main floor; the flagship with a mezzanine's worth of tables, a
  proper kitchen and 70+ seats.
- [ ] **`VENUES[].seats` becomes derived, or goes away.** It has been a
  cosmetic 30 four times since round 2's audit. `beginNight()` keeps reading
  `seats.length` off the built room either way.
- [ ] **Stations, lights and TVs follow the room.** Six rings per description,
  `rebuildStations()` actually moving them, a per-room camera spawn instead of
  `(0, 1.62, 3.4)` hard-coded twice in `main.js`, and the night rig's five
  pendants and three TV mounts moved out of literals into the description.
- [ ] **The upgrade table gets its tier gates back.** The 2D build gates
  Premium Screens and the Craft Tap Wall behind venue tier; the 3D `UPGRADES`
  has no `tier` field at all. Add it, gate `buyUpgrade()`, say so in the panel.
- [ ] **The suite pins every room.** Phase 1's invariant across all four, plus:
  seat count is monotonic up the ladder, every room has a reachable door and
  kitchen, and no two stations sit within interaction range (1.6 m).

*Leans on:* phase 1's `layout.js`, `campaign.js`'s `VENUES`, `day.js`.
*Save:* none — `c.venue` already selects the room. *Model:* **Claude Opus 5** —
content authoring and wiring on a spine phase 1 already tested.

## Phase 3 — Feet that find the door

**Patrons walk through the tables today, and in one open room nobody notices.**

`stepToward()` moves a mesh along the straight line to its target and consults
nothing. There are colliders; the player collides with them; no NPC ever has.
Phase 2's rooms put a wall between the door and half the seats, at which point
every patron walks into masonry and stops forever.

- [ ] **A nav grid in `layout.js`.** Rasterise the walkable area at ~0.25 m,
  mark cells blocked by colliders inflated by the walker radius, expose
  `pathBetween(desc, from, to)`. A grid, not a hand-cut mesh: the rooms are
  rectilinear and a grid is testable. String-pull the result so nobody walks a
  staircase, and assert that a straight shot across an empty room collapses to
  exactly two points.
- [ ] **`Patron` and `Server` follow a path.** Both keep `stepToward` for the
  leg between waypoints; a target becomes a queue, recomputed when the target
  moves (a server chasing a patron who has not sat down yet).
- [ ] **A failed path is a real answer.** No route to a seat means that seat is
  not offered by `freeSeat()`; no route to the door means the patron leaves by
  the nearest reachable exit. Nothing may silently freeze on the floor.
- [ ] **The pathological cases, in the suite.** A path into a walled-off region
  returns null; a path from inside a collider returns a route out; every seat
  in every phase-2 room is reachable from the door and both pass points; two
  hundred random pairs per room all terminate.
- [ ] **Reintroduce the bug.** Delete the collider inflation and watch a patron
  clip a table corner; block the doorway and watch the "no route" assertions
  fire.

*Leans on:* phase 1's `layout.js`, `patrons.js`, `world.js`'s colliders.
*Save:* none. *Model:* **Claude Fable 5.1** — pathing over derived geometry,
where the failure mode is an NPC quietly standing in a wall all night.

## Phase 4 — The texture diet

**A first visit downloads 66 megabytes of JPEG to look at a bar.**

`textures/` is 27 files and 69,218,191 bytes, all nine sets used by
`buildWorld()`, so all 27 land on the first room whether you play a night or
not. Frame rate is fine and measured (round 1, real headed Chrome, 1320×800:
median 6.9-7.0 ms, p95 21.1 ms at 29 patrons) — this is a *load* and
GPU-memory cost, and neither has ever been measured. The constraint shaping the
whole phase: zero offsite requests, no build step, so every byte is a file
checked in here and produced offline.

- [ ] **A resolution tier chosen at load.** `materials.js` gains
  `textures/<key>/1k/` beside the 2k files and picks a tier from a cheap
  heuristic (device pixel ratio, `renderer.capabilities.maxTextureSize`, a URL
  override for testing). The 404 fallback stays exactly as it is.
- [ ] **Generate the 1k set offline and check it in**, documented in the README
  with the exact command, the way the Poly Haven filenames are documented now.
- [ ] **Stop shipping normal maps as JPEG where it shows.** The largest single
  file is a 3.86 MB normal map. Either re-encode smaller at higher quality, or
  evaluate a vendored KTX2Loader plus the basis transcoder in `libs/addons/` —
  Castle Conundrum and the school generator both vendor `libs/addons/` subtrees,
  so the shape is established. Measure both before choosing.
- [ ] **A loading state.** The room paints untextured and fills in over several
  seconds; make the `TextureLoader` calls a counted set with a progress line on
  the start overlay.
- [ ] **Measure it and say so.** Bytes before and after, first-paint to
  fully-textured on a throttled connection, and mesh/triangle counts by round
  1's method — `requestAnimationFrame` plus a `window.__scene` traverse.
  **Do not** hook `WebGLRenderer.prototype.render`: r160 assigns it as an own
  property on the instance and the prototype patch never fires.

*Leans on:* `materials.js`, `index.html`'s start overlay, the README's texture
table. *Save:* none — a chosen tier is a per-device fact, not campaign state.
*Model:* **Claude Opus 5** — asset conversion and a load-time heuristic, both
verifiable by looking.

## Phase 5 — The suite runs on every pull request

**393 assertions that run when somebody remembers to run them.**

`.github/workflows/` has one per-project job and it belongs to the school
generator. This project's tests are the cheapest CI in the repo — no browser,
no dependency, two `node` invocations, and both already
`process.exit(fail ? 1 : 0)`, so the only missing piece is the YAML. "Merged
with CI green" is currently a promise nothing checks.

- [ ] **`.github/workflows/fourth-quarter-ci.yml`.** Node 22, path-filtered on
  `Projects/fourth-quarter/**` and the workflow file, on pull requests and
  pushes to main, with a `concurrency` group — the shape
  `school-generator-ci.yml` already uses. Both suites as two named steps, so a
  failure names which one.
- [ ] **A third step that runs the new module's suite**, if phases 1, 3, 6 or 8
  landed first — this file assumes `smoke-layout.mjs` and friends, and a glob
  over `test/*.mjs` is the version that does not need editing again.
- [ ] **Reintroduce the bug.** Break one assertion locally, confirm a non-zero
  exit and a red job, restore. Confirm the path filter actually fires by
  touching a file under it in the phase's own PR.

*Leans on:* `test/*.mjs`, `.github/workflows/school-generator-ci.yml` as the
worked example. *Save:* none. *Model:* **Claude Opus 5** — test wiring around
an existing pattern.

## Arc two — the season

Arc one builds the place; arc two builds the reason to keep opening it. A MAFA
season the bar lives inside, regulars who notice whether you stocked their
usual, a rival across town, nights that interrupt you with a decision, and
finally a way to lose the whole thing. The 2D original is the reference for all
four — 1,956 lines of working, balanced systems — which makes this porting with
judgement rather than design from scratch. **Read it; do not copy it.** Its
numbers were balanced for a click-through night, and this game has a floor you
walk. Same terms as arc one: **Claude Opus 5 unless the phase is a new pure
model layer with silent failure modes or a save shape everything downstream
inherits**, every phase names its model, and finished means merged with CI
green and a closing report naming the next phase and its model.

## Phase 6 — The league has a season

**"Game night" is `weekday() in ["Thu","Sun"]` and the result is a coin flip.**

The TVs run a fake broadcast, the Mules win 55% of the time, and nothing
remembers. The 2D build runs 14 weeks across eight named teams, seeds a
four-team bracket, plays semifinals Thursday and Sunday, crowns a champion,
goes dark for an off-season and starts again with rent and wages nudged up.
That is the biggest source of "why is tonight different from last Tuesday"
available for free, and it is the spine the next three phases hang off.

- [ ] **`js/league.js`, pure, with `test/smoke-league.mjs`.** Eight teams, a
  fixture list, standings, `seasonPhase()` (regular / playoffs / off-season),
  `advance()` on each settled night, and a result generator taking the same
  seeded `rnd` the engine uses.
- [ ] **A season in the save, additive.** `c.league` written by
  `newCampaign()`, defaulted in `repairCampaign()` — a campaign saved on day 40
  before this existed loads into a season at the right week rather than being
  rejected. The key does not change (locked decision #36).
- [ ] **The calendar reads the fixture list.** `isGameNight()` asks the league
  whether the Mules play tonight rather than checking the weekday, and
  `forecast()` accounts for the opponent — a rivalry game and a meaningless
  week-13 fixture are not the same crowd.
- [ ] **The broadcast agrees with the league.** `drawBroadcast()` already draws
  two team names; give it the real ones, put standings on a screen between
  periods, and add a standings panel at the corkboard — the 2D build's League
  tab is the screen that makes a season feel like one.
- [ ] **The suite pins the shape.** A full season lands exactly 14 regular
  weeks then a bracket then a champion; every team plays the same number of
  games; the off-season is finite; two campaigns seeded the same produce the
  same season and different seeds do not.

*Leans on:* `campaign.js`'s calendar, `engine.js`'s game beats, `world.js`'s
`drawBroadcast`. *Save:* additive `league` record, defaulted in
`repairCampaign()`. *Model:* **Claude Fable 5.1** — a new pure model layer plus
a save shape every later phase reads, where a wrong bracket stays silent for
fourteen in-game weeks.

## Phase 7 — Regulars, and the bar across town

**Nobody who walks in has ever been here before.**

A patron is a shirt colour, a Mules-fan flag and up to three rounds. The 2D
build earns you named regulars with a usual, a team, and a loyalty number that
drops when you 86 their order — and puts a rival bar across town whose buzz
drifts against your reputation and drags your crowd when it wins. Together they
make a good night an investment and a bad one a consequence.

- [ ] **Regulars in `campaign.js`, ported not copied.** A cap that grows with
  the tier, `regularShows()` weighted by loyalty and by whether their team is
  on tonight, loyalty moving on service rate, stock-outs and walkouts.
- [ ] **A regular is a person on the floor.** The half the 2D build cannot do:
  a named patron mesh, a nameplate, their usual pre-filled on the ticket, and a
  first-round-free interaction at the bar. This is where the port earns its
  keep.
- [ ] **Reputation, one number, honest about what it does.** It drives
  applicant quality, crowd multiplier and regular retention — all three have
  hooks in the 2D source. Show it in the score bug beside cash.
- [ ] **The rival bar.** Buzz drifting nightly against `rep`, crowd drag when
  it outruns you, and one line in the day ticker about what they did last
  night. No rival panel — it is a pressure, not a screen. Both records land
  additively in the save, defaulted in `repairCampaign()`.
- [ ] **The suite covers the drift.** Loyalty and buzz never leave 0-100; a
  stocked-out usual costs loyalty exactly once per night; a regular at zero
  loyalty stops showing and can be re-earned; crowd drag is bounded so a bad
  streak cannot zero the forecast.

*Leans on:* phase 6's league (a regular's team plays in it), `campaign.js`,
`patrons.js`. *Save:* additive `regulars` array and `rival` record.
*Model:* **Claude Opus 5** — a port from a working, balanced reference onto an
established save pattern, with a suite around it.

## Phase 8 — The night has moments

**Eight sim hours, and the only thing that ever interrupts you is a ticket.**

The 2D build has 21 event cards with conditions, cooldowns and weights: the tap
line blows, a screen dies with the game on, the health inspector walks in
during the rush, the rival owner offers you $500 to give up the title fight.
In a click-through night they are a dialog. Here they can be a person walking
through the door and standing in front of you, which is the whole argument for
the 3D build existing.

- [ ] **`js/events.js`, pure, with its suite.** The table ported with its
  `when`/`cd`/`weight` shape intact, a picker respecting cooldowns and
  conditions, and resolution returning effects as data — never touching the DOM
  or the scene.
- [ ] **Effects the engine already understands.** Cash, mood, crowd, stock,
  rep, loyalty, and a small set of night flags (`tapBroken`, `tvBroken`) that
  `engine.js` reads when pricing and prepping. Anything an event wants that the
  engine cannot express is a new engine field with its own assertions, not a
  special case in the handler.
- [ ] **A moment on the floor, not a modal.** The event arrives as a marked NPC
  or a lit prop you walk up to and press E on; the choices are the panel you
  already have. The sim keeps running while you decide — the cost of the
  interruption, and the part a paused 2D dialog cannot charge you. Cooldowns
  survive the night in an additive `eventCd` record, so the health inspector
  cannot show up three nights running.
- [ ] **The suite pins the picker.** Nothing fires on cooldown or with a false
  `when`; weights hold over 10,000 seeded draws; every choice's effects apply
  exactly once; an unresolved event at last call resolves to its first option
  rather than blocking the close.

*Leans on:* phases 6 and 7 (half the conditions reference the season, the rival
and the regulars), `engine.js`, `day.js`'s panel. *Save:* additive `eventCd`
map. *Model:* **Claude Opus 5** — a content table and floor wiring over an
event pipeline that already exists.

## Phase 9 — A night you can lose

**The cash number turns red and then stays red, forever, and you keep
playing.**

Spoilage answered "why is day 40 harder than day 4." Nothing answered "and then
what." `settleNight()` will happily take cash to negative ten thousand and roll
tomorrow's applicants. This is the still-open half of README roadmap item 2,
and it is deliberately last: it needs the season to have stakes, the rival to
apply pressure, and the events to be able to sink you.

- [ ] **A loss condition, once Devon has picked one** (Questions, 2). The shape
  that fits what exists: cash below a threshold at settlement for N consecutive
  nights, with the landlord's warning arriving before the eviction and both in
  the ticker.
- [ ] **A recovery arc, not just a game over.** Losing the lease drops you a
  rung rather than ending the run. The ladder is one-way up today —
  `moveVenue()` walks `VENUE_ORDER` forward and refuses at the flagship, and
  the only other writer of `c.venue` is the dev menu's warp. A downgrade
  through the same function, with its own dark nights and settlement, keeps a
  bad week from being a wasted playthrough.
- [ ] **The books stop pretending.** Fold `settleNight()` and
  `settleDarkNight()`'s duplicated wages/rent/upkeep arithmetic into one
  `billsFor(c)` both call, so the loss check reads a number that cannot drift
  between the two paths.
- [ ] **A real ending screen.** The box score already has the shape; a run
  summary (nights survived, best night, lifetime net, tier reached) belongs on
  it, and `c.stats` already carries three of the four. A `strikes` count and a
  `failed` flag land additively, defaulted in `repairCampaign()`, so an old
  save loads at zero strikes rather than being judged for forty nights played
  under different rules.
- [ ] **Reintroduce the bug.** Set the threshold above starting cash and watch
  a fresh campaign fail on night one; set the strike count to zero and watch
  the warning fire without the eviction.

*Leans on:* `campaign.js`'s settlement, `main.js`'s box score, phases 6-8 for
the pressure that makes it reachable. *Save:* additive `strikes`/`failed`
fields; no key change, no migration. *Model:* **Claude Opus 5** — the loss
condition is one branch over numbers `settleNight()` already computes and the
save append follows `repairCampaign()`'s pattern; the hard part is Devon's
decision, not the code.

## What this leaves for a later arc

- **Distributors, bulk pricing and par levels.** The 2D build's sprint 9 —
  three supply houses that cut both ways, threshold discounts, loyalty spend.
  Real depth, entirely in a panel, and the Stock panel is already the busiest
  screen in the game.
- **Staff as a simulated system.** Hire, schedule, skill growth, fatigue,
  poaching by the rival. Today a staffer is a role, a skill and a wage, and the
  floor NPCs derived from them do not tire, improve or quit. Phase 7's rival
  makes poaching possible; the rest is a later arc.
- **Per-lot shelf life.** The 2D build tracks stock as dated lots with a shelf
  life the Commercial Walk-In extends by two days; the 3D build rots a flat
  15%. The lot model is better and it changes every stock read in the game.
- **A performance pass.** Deliberately not phased: round 1 measured this in
  real headed Chrome (median 6.9-7.0 ms empty and at 29 patrons, p95 7.4 and
  21.1 ms, 24.6k triangles at peak) and the prompt file says not to re-measure.
  Phase 2's bigger rooms are the thing that could change that answer — measure
  then, by round 1's method, and only if a hitch shows up in play.
- **Mobile.** Documented unsupported on purpose, in the README, and that
  paragraph is a decision rather than a gap. Pointer lock plus WASD plus a
  timing bar is not a touch game; a touch version is a different project.
