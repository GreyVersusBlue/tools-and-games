# The Fourth Quarter — Feature Wishlist

**Status: nothing is open and nothing is broken.** Three rounds shipped the
day phase, the venue ladder, the shared save system and spoilage; Phase 5 put
the suites in CI; Phase 1 made the room a description (`js/layout.js`, pure,
with `test/smoke-layout.mjs`); Phase 2's first increment authored the other
three rooms — 30, 44, 58 and 76 seats up the ladder, every one validated
before a mesh exists; **Phase 3 gave everything that walks a nav grid and a
planner**, so no patron and no server walks through a four-top any more;
**Phase 2's second increment made a room more than one rectangle**, and
Midtown now has a back room off its east wall that a patron has to find a
doorway to get into. Four suites are green as of this file —
`node test/smoke-campaign.mjs` 216 passed, `node test/smoke-engine.mjs` 190
passed, `node test/smoke-layout.mjs` 140 passed, `node test/smoke-nav.mjs` 103
passed — and the hand-run `node tools/browser-check.mjs` 105 passed in real
Chromium on real Chrome. Round 3's site-wide `npm run games` reported 146
checks, 0 failed across three independent runs on a real-Chrome environment,
including this project's own 45-check Real Estate beat. The first open phase
is still **Phase 2 — Four rooms, one ladder**, named model **Claude Opus 5**,
a 2+ row with two increments shipped: what is left is the flagship's
mezzanine, which is the one piece of it that needs a floor at a height other
than zero and so needs everything that walks to grow a y. What follows is
nine phases across two arcs, the conventions three rounds learned the hard
way, and the backlog nobody has claimed.

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
- **`js/layout.js` (794)** — a room as data, pure, zero imports. One
  description per venue tier (`LAYOUTS`: the Corner Tap, the Fieldhouse,
  Midtown, the flagship): room, kitchen, doorways with their corridor band,
  windows, bar, tables, fit-out blocks by `kind` (prep, stove, crate), TV
  mounts by wall, pendants, and every stand-point including the camera spawn,
  the idle-server line and the cook line. Derives `seatsFor()`,
  `collidersFor()` as plain `{min,max}` boxes, `inBounds()`, `walkable()`,
  `tvMount()`, `cookSpot()`, `crewHome()`, `unreachable()` (a flood fill from
  the door on a 0.25 m grid) and `validate()` — the walkability invariant
  plus reachability, station spacing and wall-mounted TVs. It also holds the
  **nav grid and the planner**: the same 0.25 m lattice with every collider
  inflated by `WALKER_R` (0.25 m), A* over eight neighbours with no corner
  cutting, a string-pull that collapses a clear run to its two endpoints, and
  `pathBetween()` / `pathToward()` / `reachableSeats()` / `navProblems()` on
  top. **`test/smoke-layout.mjs` (103 assertions)** compares the Corner Tap's
  derivation against `test/fixtures/corner-tap.json`, dumped from the old
  `world.js` in Chromium before this file existed, and pins every room on the
  ladder; **`test/smoke-nav.mjs` (89 assertions)** holds the planner.
- **`js/world.js` (405)** — the room in meshes, built from a description.
  `buildWorld(scene, venueId)` adopts `layoutFor(venueId)`: refills the
  exported `seats[]`/`colliders[]` (`THREE.Box3` at the boundary), aims the
  exported stand-point `Vector3`s, then draws walls, bar, tables, every
  fit-out block by kind, the TVs where `tvMount()` says, the pendants, and
  two light rigs whose shadow cameras cover the floor. Floor, ceiling and wall
  UVs are scaled by room size so one shared texture keeps one texel density
  across four rooms. `inBounds()` delegates to layout.js. The neon, door
  frame, corkboard and kitchen shelf are derived from the description's door,
  promo and kitchen rather than authored.
- **`js/materials.js` (95)** — nine texture sets keyed by surface, ARM maps
  wired to three material slots each, a 404 falling back to a placeholder
  colour.
- **`js/patrons.js` (350)** — `Patron`/`Server` state machines, the meshes,
  and `Route`: a queue of waypoints from the nav grid, replanned when the
  target moves 0.6 m, walked leg by leg with `stepToward()`.
  **`js/player.js` (215)** — hand-rolled pointer-lock camera, collision,
  pick-up/deliver, the timing bar. **`js/day.js` (348)** — six station rings and
  every management panel. **`js/main.js` (477)** — loop, HUD, box score,
  broadcast theatre, the save bar mounted three times, `rebuildVenue()`.
  **`js/dev.js` (120)** and **`js/audio.js` (141)** — the backquote cheat menu;
  twelve one-shots and three loops with a mute toggle.

The load-bearing habit is **pure module plus its suite**: three files hold
every number the game decides, they import no three.js, and 598 assertions sit
on them. Everything visual is downstream, and `tools/browser-check.mjs` is the
one hand-run check that looks at it — 89 assertions, four of which step a
patron to every fourth stool in every room at a fixed dt and measure how far
inside the furniture it ever got.

Where it still breaks down: `freeSeat()` picks uniformly at random among the
stools with a route, so the room fills in no particular order, and a server
picks the oldest ready ticket regardless of how far it has to carry it.

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
- **Anything that decides a number goes in `engine.js`, `campaign.js` or
  `layout.js`.** All three import cleanly under plain Node. The moment a rule needs `document` or
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
- Every floor rectangle is at `y = 0`. `annexes` gave a room more than one of
  them and Midtown has its back room, but an annex carries a ceiling height
  and no floor height, so the flagship's mezzanine still cannot be authored.
  What it needs is on Phase 2's list; the short version is that `Route`,
  `stepToward()`, the nav grid's cells, `seatsFor()`, the camera and
  `player.js`'s ground plane are all two-dimensional, and a mezzanine is the
  thing that makes them not.
- The doorway band's overhang is a flat 0.5 m either side of the shared wall
  (`DOOR_REACH` in `layout.js`), which covers every walker radius the game
  uses and would stop covering one at 0.5 m. It is a constant because no
  caller passes a radius that large; if one ever does, derive it from `r`
  rather than raising the number.
- Midtown's shadow cameras now span 32.15 m of x against the hall's 26 m,
  because the box covers every rectangle and the back room is 6 m of it plus
  9.5 m of dead ground beside the kitchen. At the same 1024² map that is
  3.1 cm per texel where it was 2.5. Nothing looks wrong; a per-rectangle
  shadow pass or a tighter box that skips dead ground is the fix if it ever
  does.
- Two bodies never see each other. `Route` plans against the furniture and
  nothing else, so two patrons walking opposite ways down the same lane pass
  through one another, and a server delivering to a seated patron stops
  0.75 m short of a body it cannot feel. Local avoidance is its own phase.
- The nav grid is rebuilt from scratch per room and memoised per
  `(description, radius)` pair, and `navProblems()` runs inside `validate()`,
  which makes `smoke-layout.mjs` do the work twice. Nothing is slow enough to
  care yet: the flagship's grid is 113×95 = 10,735 cells and costs 1.2 ms to
  build, a typical plan is 0.45 ms, the worst plan measured (flagship, corner
  to corner) is 3.9 ms, `reachableSeats()` on a cold grid is 12 ms once per
  venue build, and `smoke-nav.mjs` runs in 0.74 s. A server chasing a walking
  patron replans about 2.6 times a second, which is the only thing here that
  happens every night rather than once.
- The Corner Tap's five probe points in `tools/browser-check.mjs` are the
  Corner Tap's; the other rooms are checked for seats, colliders, stand-points,
  spawn, rings and a stepped walk to every fourth stool, but not for
  `inBounds()` at named coordinates.
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

## Phase 1 — The room is a description — **SHIPPED**

**`buildWorld(scene, campaign.venue)` had taken a venue argument since session
one, and the function signature was `buildWorld(scene)`.**

Everything about the Corner Tap was a literal inside 363 lines of untested
scene-building, so nothing could ask that file a question — which is why
`day.js` kept its own copy of the station coordinates. This phase separated
describing a room from building one, and put the derived facts behind a pure
module.

- [x] **`js/layout.js`, pure, with `test/smoke-layout.mjs`.** A room is data:
  `{ id, room, kitchen, wallT, doorways[], windows[], bar, tables[], fitout[],
  stations }`. The module derives `seatsFor()`, `collidersFor()` as plain
  `{min,max}` boxes with no `THREE.Box3`, `inBounds(desc, x, z, r)`,
  `walkable()`, `standPointsFor()` and `validate()`. No three.js import
  anywhere in it. 55 assertions.
- [x] **The Corner Tap became the first description.** Today's numbers
  transcribed exactly, `DOORWAY` x∈[2.1,3.7] and the corridor band z∈(-6,-4.8)
  included. The check is not a re-implementation: before `layout.js` existed,
  the old `world.js` was booted in Chromium and its 30 seats, 11 `Box3`
  colliders, nine stand-points and `inBounds()` on a 0.25 m grid (69×73 =
  5,037 samples) were dumped to `test/fixtures/corner-tap.json`. The suite
  compares the derivation to that file: same seats in the same order, every
  box edge within 1e-6 (the rotated crate's AABB included), zero grid samples
  differing. After the rewrite the same dump from the new `world.js` diffed
  against the fixture at zero.
- [x] **`world.js` builds from a description.** `adoptLayout(desc)` refills
  `seats`/`colliders` (converting to `THREE.Box3` at the boundary) and re-aims
  the exported stand-point `Vector3`s; `buildWorld(scene, venueId)` calls it
  first and draws the rest from the same object. `addSeat()` and
  `blockCollider()` are gone. **`day.js` reads its six ring positions from
  `currentLayout().stations`**, and `rebuildStations()` re-reads them.
- [x] **A walkability invariant, asserted.** `validate(desc)`: every seat's
  approach and every stand-point inside `inBounds()` and outside every
  collider, the door inside the room and the exit outside it, each doorway's
  centre line walkable from the room into the kitchen 5 cm at a time, and each
  doorway within the kitchen's span. Asserted for every description in
  `LAYOUTS`.
- [x] **Reintroduced the bug**, five ways, each failing at the assertion whose
  comment claims it: a table on stool 1's approach — `cornerTap validates:
  seat 1 (bar) approach (-5.6, -2.4) is not walkable` (and the tap station,
  which the same table covers); the doorway a metre east — 16 corridor samples
  disagree with the fixture; `blockBox` ignoring rotation — crate2's two edges;
  tables before stools — 30 seats out of order; the corridor band dropped from
  `inBounds` — 8 samples and every description's doorway "does not join the
  room to the kitchen".
- [x] **`tools/browser-check.mjs`**, hand-run, 25 checks in real Chromium: the
  page's `seats`, `colliders`, stand-points and `inBounds()` are the derived
  ones on boot, after "New Game (wipe save)" and after a dev warp, with no
  page error. It caught the phase's one real bug: the first `day.js` draft
  keyed the door and real-estate stations as `ring: "doorRing"` and the
  constructor then assigned the torus mesh to `st.ring`, so the first rebuild
  threw `Cannot read properties of undefined (reading 'x')` with all 448 Node
  assertions green.

*Leaned on:* `world.js`, `day.js`. *Save:* none. *Model:* **Claude Fable 5.1**.
*Left as literals in `world.js`:* TV, pendant, corkboard, neon and kitchen
shelf positions, relative to `ROOM` — none has a collider or a stand-point.

## Phase 2 — Four rooms, one ladder

**Thirty-four thousand dollars buys you the same six four-tops.**

The ladder is real — a Real Estate desk, a cash gate, one-way leases, dark
nights, rent that scales — and the payoff is a bigger multiplier on a number.
With phase 1's format in hand this is authoring: four descriptions, each with
the fit-out its `VENUES` blurb already promises. The Fieldhouse's second stove,
Midtown's three-tap wall and the flagship's three stoves are all written down
and none of them exist.

**Increments 1 and 2 shipped (PRs #170 and this one).** What they did, and
what is left:

- [x] **Three of the four descriptions.** `FIELDHOUSE` (20×13 m, 8 stools,
  9 four-tops, 2 stoves, 4 taps, 44 seats), `MIDTOWN` (24×15 m, 10 stools,
  12 four-tops, 2 preps and 2 stoves, a 6-tap draft wall, 58 seats) and
  `FLAGSHIP` (28×18 m, 12 stools, 16 four-tops, 3 preps and 3 stoves, 8
  taps, 76 seats), each the same plan as the Corner Tap — bar west, kitchen
  east behind the north wall, door mid-south — so no wall stands between the
  door and a stool before Phase 3 gives NPCs a path.
- [x] **Midtown's second room (increment 2).** A description holds more than
  one floor rectangle now: `annexes` is a list of them, each with its own
  ceiling height and the hall wall it opens through, and `areasOf()` is what
  `inBounds()`, `unreachable()`, `navGrid()` and the shadow cameras read
  instead of naming the hall and the kitchen by hand (#194). The doorway band
  through the shared wall is derived, not authored (#195), the wall is drawn
  from `wallSegments()` as spans and a header rather than one plane, and the
  north wall stays the kitchen's (#196). Midtown's back room is 6×8 m under a
  3.2 m ceiling off the east wall, with three four-tops **moved** into it
  rather than added, so the ladder is still 30 / 44 / 58 / 76 (#197).
- [ ] **The flagship's mezzanine.** This is the increment left, and it is not
  more of the same: an annex is a rectangle at floor `y = 0`, and a mezzanine
  is one that is not. Everything that walks is two-dimensional — `Route`,
  `stepToward()`, the nav grid's cells, `seatsFor()`, the camera and
  `player.js`'s ground plane all assume `y = 0`, and `world.js` draws every
  stool, table and collider from the floor up. So the work is a `floorY` on an
  area and a stair or ramp rectangle that interpolates between two of them; a
  `floorYAt(desc, x, z)`; a nav grid that refuses a step between two cells
  more than a stride's rise apart, so a body walks up the stair and not off
  the edge; and `Patron`, `Server` and the player reading their y off the
  floor under them. Do not ship a flat rectangle called a mezzanine.
- [x] **`VENUES[].seats` is derived.** `seatsFor(LAYOUTS[id]).length`, so the
  Real Estate card and `beginNight()`'s cap read the same list. 30, 44, 58,
  76, asserted monotonic in both suites.
- [x] **Stations, lights and TVs follow the room.** Six rings per description
  (Phase 1), `rebuildStations()` moving them (asserted in Chromium for every
  rung), `stations.spawn` replacing the camera literal, `stations.crewHome`
  and `stations.cooks` replacing `main.js`'s idle-server spread and cook line
  (the old cook line put a cook inside the Fieldhouse's prep counter), TVs as
  `{ wall, at, y }` derived through `tvMount()`, pendants as a list. The
  neon, door frame, corkboard and kitchen shelf derive from the door, promo
  station and kitchen. Every fit-out block carries a `kind`, so a room's
  stove count is its description's and nothing in `world.js`.
- [x] **The upgrade table has its tier gates back.** `UPGRADES[].tier` (the
  2D build's: Premium Screens and the Craft Tap Wall need the Fieldhouse),
  `upgradeGate(c, id)` names the room, `buyUpgrade()` refuses with it, and the
  panel disables the button and says which room. The gate is on buying, not
  owning (#187).
- [x] **The suite pins every room.** Phase 1's invariant across all four,
  plus a flood fill from the door on a 0.25 m grid that reports every seat
  approach, station, idle-server spot and cook spot it cannot reach; seat
  count, stoves, taps and floor area monotonic up the ladder; no two
  proximity stations within 1.6 m; every TV on a wall that exists, within its
  span, below the ceiling; every pendant inside the room. *Reintroduced the
  bug:* a crate across each room's doorway leaves every kitchen point walkable
  and unreachable, and only the sweep sees it (six problems, `station stove
  cannot be reached from the door` first); a flagship table walled in on four
  sides has four unreachable seats; the sweep deleted from `validate()` fails
  those five assertions and nothing else; the spacing check deleted fails the
  one assertion that names it; the gate deleted from `buyUpgrade()` fails four
  in `smoke-campaign.mjs`, the first reading `the gate refuses the sale by
  name (undefined)`. One break that did *not* fail is on record: a Fieldhouse
  table at (2.9, −5.0) looked like a doorway block and was not — its box
  stops 1 cm short of the corridor mouth — and the suite was right to pass.
- [x] **`tools/browser-check.mjs`** grew to 58 checks: after the flagship
  warp it warps to the Fieldhouse, Midtown and back to the Corner Tap, and at
  every rung asserts the seats, colliders and stand-points are the derived
  ones, the camera sits on `stations.spawn` at 1.62 m, and the six rings sit
  on their stations. `main.js` exposes `window.__fq = { camera, day, player }`
  for it and nothing else reads it.

- [x] **The suite pins the second rectangle too (increment 2).**
  `smoke-layout.mjs` 103 → 140 and `smoke-nav.mjs` 89 → 103: the hall's east
  wall as three spans with the header in the middle, the back room's ceiling
  under the hall's, twelve stools behind a doorway that every route from the
  door crosses inside the gap, and a crate in that gap taking exactly those
  twelve out of the offer and nothing else. `tools/browser-check.mjs` 89 → 105
  measures what `world.js` actually built: the annex floor and its own
  ceiling, every east-wall span half a thickness outside the room, the Corner
  Tap's east wall still the single plane it always was, pendants hanging off
  the ceiling they are under, both shadow cameras reaching the far wall, and a
  server carrying a ticket from the pass through the doorway to the back
  room's furthest stool at 0.000 m of penetration.

*Leans on:* phase 1's `layout.js`, `campaign.js`'s `VENUES`, `day.js`.
*Save:* none — `c.venue` already selects the room. *Model:* **Claude Opus 5**
named; increment 1 worked under Claude Fable 5.1, increment 2 under Claude
Opus 5.

## Phase 3 — Feet that find the door — **SHIPPED**

**Patrons walked through the tables, and in one open room nobody noticed.**

`stepToward()` moved a mesh along the straight line to its target and consulted
nothing. There were colliders; the player collided with them; no NPC ever had.
Phase 2's rooms were kept to one rectangle each for exactly this reason.

- [x] **A nav grid in `layout.js`.** `navGrid(desc, r)` rasterises the floor on
  `unreachable()`'s 0.25 m lattice with every collider inflated by `WALKER_R`
  (0.25 m — a patron mesh is a 0.2 m cylinder), memoised per description and
  radius. A* over eight neighbours, a diagonal refused unless both its
  orthogonals are open, then a string-pull that drops every waypoint the walker
  can already see past: a straight shot across open floor comes back as exactly
  its two endpoints, asserted. `pathBetween(desc, from, to)` is the wishlist's
  name for it; `pathToward()` is the same planner with the honest answer.
- [x] **`Patron` and `Server` follow a path.** `Route` in `patrons.js` holds
  the queue, `aim()` replans when the target has moved 0.6 m (a server chasing
  a patron who has not sat down yet), and `step()` walks each leg with
  `stepToward()`, spilling what is left of a step into the next leg so a corner
  does not cost a frame. Both classes face their current waypoint rather than
  their target.
- [x] **A failed path is a real answer.** `world.js` hangs `reachable` on every
  seat from `reachableSeats(desc)`, and `freeSeat()` refuses to offer a false.
  `pathToward()` never returns nothing: when the floor does not join the two
  points it reports `complete: false` and a route to the nearest point it does
  reach, so a patron with no route to the door leaves by the nearest exit
  instead of standing on the floor all night. A patron whose stool goes
  unreachable mid-walk hands the stool back and leaves (`strand()`).
- [x] **The pathological cases, in the suite.** `test/smoke-nav.mjs`, 89
  assertions: a path into a walled-off region is null; a path from inside a
  table's box is a leg out and then a route; every stool in every room has a
  route from the door and from both passes; the flood and the planner agree on
  every stool; 200 seeded random pairs per room all return a finite route from
  the point asked for, and no middle leg of any of them is inside the
  furniture. `navProblems(desc)` is folded into `validate()`, so a new floor
  plan is authored against the walker and not only against the geometry.
- [x] **Reintroduce the bug.** Five breaks, each caught by the assertion whose
  comment claims it, from a green baseline of 598 Node assertions: the collider
  inflation deleted (12 fail, the route shaves a four-top by 0.088 m); the
  diagonal corner rule deleted (3 fail, the random-pair clearance in three
  rooms); the string-pull deleted (2 fail, the straight shot comes back as 11
  points); `complete` forced true (5 fail, every "no route" assertion); the nav
  check dropped from `validate()` (1 fail). In the browser, `Patron` put back
  on `stepToward()` fails the four walk checks at 0.66–0.74 m of penetration —
  a body through the middle of a table.

*Leans on:* phase 1's `layout.js`, `patrons.js`, `world.js`'s colliders.
*Save:* none. *Model:* **Claude Fable 5.1** named; worked under Claude Opus 5.

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

## Phase 5 — The suite runs on every pull request — **SHIPPED**

**393 assertions that run when somebody remembers to run them.**

`.github/workflows/` has one per-project job and it belongs to the school
generator. This project's tests are the cheapest CI in the repo — no browser,
no dependency, two `node` invocations, and both already
`process.exit(fail ? 1 : 0)`, so the only missing piece is the YAML. "Merged
with CI green" is currently a promise nothing checks.

- [x] **`.github/workflows/fourth-quarter-ci.yml`.** Node 22, path-filtered
  on `Projects/fourth-quarter/**` and the workflow file, on pull requests and
  pushes to main, one `concurrency` group. `smoke-engine` and `smoke-campaign`
  are two named steps, so a failure names which one.
- [x] **A third step that runs whatever else is in `test/*.mjs`**, one process
  per file, skipping the two above; a suite a later phase adds runs from its
  first commit and fails the job naming the file.
- [x] **Reintroduce the bug.** `ok` in `smoke-engine.mjs` made to fail every
  assertion: exit 1. Restored, and the loop over the other files exited 0. The
  path filter fires on this phase's own PR because this file changed in it.

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
