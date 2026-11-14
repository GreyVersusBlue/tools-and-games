# Hearth, arc three: the island seen, the island at work, the island that stays up

**Status: a design, written 2026-11-13. Nothing in this file is built.** It plans
the arc after Phases 1 to 8 in `WISHLIST.md`: Part A makes the island look and
sound like what it already simulates, Part B makes four systems that exist on
paper visible, Part C puts one island on the site's own server so it lives
around the clock. Each part is cut into increments of about two hours for one
worker. The increments are the plan; the prose around them is the reasoning a
worker needs so as not to guess.

Read `WISHLIST.md` first ("What it is", "The architecture that is there",
"Conventions a new builder must know"). This file assumes it and does not
repeat it.

Contents: 1 what is there today, 2 rules for every increment, 3 Part A,
4 Part B, 5 Part C, 6 what not to do, 7 questions for Devon, 8 totals and what
can run side by side.

---

## 1. What is there today, measured and looked at

Counted on 2026-11-13: ten classic scripts and one sprite sheet, 375,407 bytes
with the stylesheet and markup. `node unit.mjs` passes 55 of 55 in Node;
`tools/blender/validate.mjs` passes 375. Save version 17. `test/hashes.json`
pins seed 7 at `703079:38447` and seed 20260819 at `bf0395b6:35543`, forty days,
on Chromium 1194.

**What the screen shows.** Seed 7 was run headless to days 128, 133 and 138 and
captured at noon, dusk and night, clear, rain, fog and snow, whole island and
zoomed 3.2 on the village.

- *Summer noon, whole island.* The island fills about 60% of the view on flat
  dark blue water with a hard stair-step coast, every step one 8 px tile. The
  middle of the island is a grey plateau with white specks that reads as a car
  park, not a hill; `elev[]` holds real height and nothing draws it. Trees are
  one two-circle shape in two greens. The village is a small cluster in the
  south-east.
- *Summer noon, village.* The best view the game has. The Blender houses in
  three roof colours, the mill, the market stones and the field rows are
  clear. People are 3 by 8 px: a shirt colour, a hair pixel and one skin colour
  for everybody (`#f1cfa5` in `draw()`), although the portrait on the card has
  five skin tones. Nobody is tellable from anybody else without clicking.
- *Rain.* Thin streaks over the picture and nothing else. The water, the roofs
  and the ground do not know it is raining.
- *Autumn fog.* The tree colours are good (three autumn families). The fog is a
  white wash at the edges.
- *Winter dusk, snow lying.* The weakest picture. Three grey and blue overlays
  stack (winter tint, the dark, the dusk gold) over white ground, the snow
  frames turn each house into a pale block with a door, and uncovered tiles
  show through as a green checker. Contrast is gone.
- *Winter night.* The strongest mood. A flat `rgba(12,16,48)` wash at 72%, a
  warm additive circle per house and at the fire, stars on the water. Every
  house is lit all night whether anyone is awake. The warm circles add light on
  top of the wash, so they bleach what they touch instead of showing it.

**What the simulation knows and the screen does not.** `wood`, `food` and
`granary` are numbers in the HUD and nowhere on the ground. The trader already
moves stock (`life.js`, the `b.kind==='trade'` branch: meal for timber, scaled
by the store-keeper's craft) and sometimes a thing (`farTrade`), and the map
shows people waving. The `carry` and `water` tasks walk real routes with
nothing in anyone's hands. `dry01`, `tide()`, `wind`, `ill`, `want` and `feud`
all change behaviour and none changes a pixel beyond a HUD word. So the
WISHLIST line "No trade" is stale; the true line is "the trade is invisible".

**What Node can do.** `test/load.mjs` runs the real scripts in a `vm` context.
Measured here on Node 22: 62 MB resident after loading and `newWorld(7)`, about
0.3 ms a step (the stub page costs more than the browser's 0.02 ms), so one
island day of 2,800 steps is about 0.9 s of one core. A day-21 save is 28,194
bytes of JSON and 15,094 characters through `lzEnc`. `sagaHTML()` runs in Node
unchanged. `lzEnc` needs `btoa`, which a `vm` context does not have; whoever
calls it from Node passes `btoa` and `atob` in.

**Two facts Part C stands on, both tested here.** (1) A save taken at
`dayFrac()` 0.02 and unpacked three ways (in place, in a fresh context, and in
a context that had been running a different island) gives byte-identical
`pack()` output one island day later. So `unpack()` resets everything that
matters, and "reload at a fixed moment" is a well-defined operation two
machines can both do. (2) At `dayFrac()` 0.02 every person is in task `sleep`
and there are no boats; after an `unpack()` they are idle and are asleep again
within 20 steps. So a reload at that moment costs nothing the eye can see.

---

## 2. Rules for every increment

These apply to all three parts. An increment that breaks one is not done.

**Setup.** Work in `Projects/hearth/`. Tests run from `Projects/hearth/test`.
`node unit.mjs` needs no install. The browser suites use the pinned Playwright
1.56.1 and its Chromium 1194; on the shared build machine the browser is
already installed in its own folder and the worker brief gives its
`PLAYWRIGHT_BROWSERS_PATH`. Never run `playwright install` there, and run one
browser job at a time.

**The gate every increment runs before it is handed back** (about two minutes):

```
node ../tools/blender/validate.mjs
node unit.mjs
node harness.mjs determinism
node harness.mjs save
node harness.mjs soak --days 12 --seeds 7,20260819 --random 0
node harness.mjs pinned
node harness.mjs sheet
node look.mjs            (exists after increment A0)
```

Increments name any further modes they owe. Anything touching `audio.js` owes
`node harness.mjs twelve`. Anything touching `step()`, `newDay()` or
`tellStory()` owes `decade` and `strain`.

**The stream.** `R()` is the simulation's random stream. Drawing and sound may
not call it and may not write anything the simulation reads. An increment that
says "Stream: none" must leave `node harness.mjs pinned` green without
`--write`. An increment that moves the stream says why in its own text here,
runs `pinned --write` on Chromium 1194 only, and commits the new
`hashes.json` in the same change. Three increments in this arc are allowed to
move it: C2, B3 and B4. They run one after another, never side by side.

**The save.** No increment in this arc bumps `SAVE_V` as designed. If a worker
finds one must, the cost is the four lines the WISHLIST names (slot or key in
`pack()`, a `LADDER` hop with `up` and `down`, the version in the harness
fixtures, `SAVE_V`), plus a repair rule if a loaded value can be inconsistent.
No storage key changes, ever. Adding a new key under `hearth.` is allowed and
two increments do (C4, C5).

**New script files.** Increment A0 adds three near-empty scripts and wires
them, so later increments fill files and never touch the load order:
`js/look.js` (sky, light, shadow, weather), `js/folk.js` (people on the map),
`js/goods.js` (stock and carried things). They load after `js/render.js` and
before `js/audio.js`. Every list of scripts must agree: `index.html`,
`test/load.mjs` (`ORDER`), and from C4 on `live.html`. `/* */` comments only.
No `"use strict"`. No top-level name declared in two files (A0 adds the check).

**New presentation code reads, it does not write.** A function in `look.js`,
`folk.js` or `goods.js` may read any simulation state. The only things it may
assign are its own top-level variables and underscore fields on objects
(`p._px` is the precedent). It derives every "random" detail from a local
`mulberry(...)` seeded off `seed`, `p.seed` or an index, never from `R()` and
never from `Math.random()`.

**Every guard is broken once on purpose** from a green baseline, and the
worker reports which assertion failed and its message. Each increment below
names its break.

**Numbers in pixel and sound assertions are starting values.** A worker may
move one when the picture is right and the number is wrong, and says which
and why. A worker may not delete the assertion or widen it until it cannot
fail; the break has to still turn it red.

**Each increment ends with** the gate green, its named extra modes green, its
break watched, and a short note of anything it measured. Backlog and history
bookkeeping belongs to whoever runs the batch, not to the increment.

---

## 3. Part A: looks

### 3.1 The look target

Hearth is watched from a gull's height. The target is **a hand-tinted model of
a northern island under real light**: the pixels stay the size they are, one
map pixel to one art pixel, and the picture changes because the light, the
ground and the weather change. It should not look like any existing game. It
gets there by three rules of its own.

1. **Light is a colour you multiply by, not a veil you look through.** Night is
   deep indigo, never grey and never black. A lit window does not glow on top
   of the dark; it lets you see the true colours of the snow outside it.
2. **The ground has a shape.** Height shades the land from the north-west. The
   coast has a lip of wet sand and a line of foam. Rock is strata, not specks.
3. **Everything that the simulation counts is somewhere you can point at.**
   Wood is a pile. Grain is sacks. Weather lands on things. A song has singers.

**Palette.** The existing terrain, roof and people colours stay; they are the
island's and the building sheet is validated against them. The arc adds a
*light* palette, which is the multiply colour for the whole scene by hour, and
a small set of *weather* colours.

| Hour | When (`f` is `dayFrac()`, `e` is `edges()`) | Multiply colour |
| --- | --- | --- |
| night | `f < e[0]-.06` or `f > e[1]+.06` | `#34406e` |
| first light | `e[0]-.04` | `#5a5f8a` |
| dawn | `e[0]+.02` | `#f0b292` |
| morning | `e[0]+.10` | `#fff0dc` |
| noon | `.5` | `#ffffff` |
| afternoon | `e[1]-.16` | `#fff3d6` |
| golden | `e[1]-.06` | `#ffc98a` |
| dusk | `e[1]-.005` | `#d98a7a` |
| blue hour | `e[1]+.04` | `#5c6296` |

Linear in RGB between neighbours. Season tints it: winter times `#f4f8ff`,
summer times `#fffaf0`. Weather pulls it toward its own grey: overcast 35% of
the way to the colour's own luma and times 0.92, rain times 0.84, storm times
0.72, snow falling times 0.95. A clear night with snow lying is `#46548a`,
because snow gives moonlight back.

Warm light is `#ffd69a` at a window, `#ffb45a` at the fire, `#fff2b0` at the
lighthouse lamp. Snow in shadow is the multiply doing its work on `#eef2f4`,
which lands near `#8f9cc4` at dusk: lilac, which is the colour snow is at dusk.
Wet ground is the terrain times `#c9d2dc`. Foam is `#dcecf4`. Smoke is
`#cfc8be` by day and `#6a6f8e` at night.

**What a screenshot at dusk in winter should show.** Snow lilac-blue where the
low sun does not reach and peach on the roof slopes that face west. Long blue
shadows from every tree and house, pointing east, three times the height of
the thing that casts them. Bare trees, dark, each with a white cap. Amber
windows in the houses where somebody is already home, and dark windows in
the ones whose people are still out; each lit window laying a small warm patch
on the snow in which the snow is its real cream colour. A column of smoke from
every house with somebody home, leaning the way the wind blows. The fire at the centre the
brightest thing on the island, with people at it who are tellable apart: an
elder with white hair and a stick, children half height, two skin tones at
least. One or two small moving lights on the paths, which are people walking
home with a lantern. The sea darker than the land, nearly black to the east,
with a band of rose on the western water. The far island a cut-out against the
last light, with one lamp if anyone from here lives there.

**Sound.** The synth stays; nothing is recorded and no audio file is added.
What changes is that sound follows the place the watcher is looking at and the
state the island is in: rain sounds different over roofs, leaves and water;
the fire can be heard near it; birds differ by season; the fire-night song
sounds sung. Section 3.4 has the increments.

### 3.2 How it stays fast on a weak laptop

Today `draw()` is 2.7 ms median on a 700-day island on the build machine and
the `debt` mode fails at 40 ms. The budget for this arc: **`draw()` median at
or under 6 ms, 95th percentile at or under 12 ms, on seed 7 day 138 with 41
people, on the build machine's software-rendered Chromium**, measured by
`look.mjs` in every scene and asserted. A weak laptop with a GPU does better
than that machine does without one.

The techniques, which every Part A increment follows:

- **Paint once, blit many.** Anything that changes less often than once a
  second goes on the cached terrain layer or its own cached canvas, keyed the
  way `paintedKey` is. Relief, coast, litter, lying snow, wet ground: all
  cached.
- **One light map.** A single 880 by 560 canvas is filled with the hour's
  colour, lights are stamped into it from pre-rendered sprites with
  `lighter`, and it goes over the scene once with `multiply`. That replaces
  about 22 `createRadialGradient` calls a night frame and four full-screen
  fills.
- **No gradients, no `filter`, no `getImageData` in the frame.** Sprites are
  built at load into small canvases.
- **Counted particles.** Each effect has a cap and a halved cap under `RM`
  (reduced motion), as rain and snow do now.
- **Three quality tiers, chosen by measurement.** A moving average of frame
  time picks `lookQ`: 2 is everything; 1 drops shadows and water splashes and
  halves the light map's resolution; 0 is today's cost (hour colour and
  lights only). It steps down after 2 s over 20 ms a frame and up after 10 s
  under 10 ms. The picture stays recognisably the same at every tier.
- **Nothing new at the generational speed.** At `FAST` the frame already
  paints one time in four; new effects that only make sense in real time
  (splashes, footfalls, lanterns) skip themselves when `speed>=FAST`.

### 3.3 Increments: the picture

#### A0. The look rig, and three empty rooms

- **Changes.** New `test/serve.mjs`: a static file server on `node:http`
  serving `Projects/hearth/` on a free localhost port, 30 lines, no
  dependency. New `test/look.mjs`: opens `index.html` over that server (so the
  canvas is not tainted and `getImageData` works), pauses the loop the way
  `harness.mjs` does (click `#b-pause`), and builds eight scenes on seed 7 by
  stepping to a day and then forcing hour and weather through
  `window.__hearth` (`setTime`, `setWx`, `setSnow`, then 40 steps and
  `draw()`). The scenes: S1 summer noon clear (day 128, `f` .5); S2 summer
  dusk clear (`f` .85); S3 summer noon rain; S4 autumn morning fog (day 133,
  `f` .3, 600 more steps so the fog settles); S5 winter noon snowing, snow
  depth .8 (day 138); S6 winter dusk clear, snow .8 (`f` .72); S7 winter
  evening clear, snow .8 (`f` .80, when about a third of the windows are
  still lit); S8 spring dawn (day 143, `f` .22). Each at
  zoom 1 and at zoom 3.2 centred on the mean house position (`setZoom`).
  Viewport 880 by 560 at device scale 1, HUD and log hidden by an injected
  style, so one world pixel is one canvas pixel at zoom 1. For each scene it
  times 30 `draw()` calls and prints median and 95th percentile; with
  `--out <dir>` it writes the 16 pictures as PNG (default: a temp folder;
  never inside the repo, where every file is a public URL). Two assertions
  from day one: (1) *drawing is off the stream*: two pages on seed 7 run five
  days, one calling `draw()` after every 10 steps on top of the page's own frames
  and one not, and their pack hashes are equal; (2) the timing budget of 3.2, starting at the looser
  current ceiling (median 12 ms) until A14 tightens it. Exits non-zero on
  either. Then: create `js/look.js`, `js/folk.js`, `js/goods.js`, each a
  two-line header comment, and add them to `index.html` after `render.js` and
  to `ORDER` in `test/load.mjs`. Add unit section 19: read every script in
  `ORDER` as text, collect names declared at column 0 by `let`, `const`,
  `function` (split `let a,b=1,c` on top-level commas), fail on any name seen
  in two files. Add `node look.mjs` to the `gate` job in
  `.github/workflows/hearth-ci.yml` after `sheet`.
- **Seen.** Nothing. The game is byte-for-byte the same to a player.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. Break 1: add `R();` as the first statement of
  `draw()`; `look.mjs` must fail on "drawing is off the stream". Break 2:
  declare `let seed` at the top of `look.js`; unit section 19 must fail naming
  `seed` (and the page must not be what catches it).
- **Devon's eye.** Nothing yet. The 16 pictures this writes are the "before"
  set; keep them.
- **Needs.** Nothing.

#### A1. A clock for what is only seen

- **Changes.** `render.js` gets `let animT=0`. `main.js` `frame(dt,run)` adds
  `if(run)animT+=dt` before the steps (real seconds, frozen when paused). In
  `draw()`, every cosmetic phase that reads `time` reads `animT` instead:
  water glints (`wt`), spring rings, fish shadows, the summer shimmer, boat
  bob, mill sails, flame flicker, work bob, the wave arm, talk and song pips,
  cloud rain streaks, gulls, geese wings, rain, snowfall, fog drift, the
  lighthouse beam, star twinkle, firefly blink, the aurora's sway. What stays
  on `time`: anything through `dayFrac()`, `light()`, `edges()`, `tide()`;
  `rbUntil>time`; footprint ages (`pr.t0`); and the children's ring, whose
  phase is simulation (#79). `whale` and `shoots` are simulation objects and
  are untouched.
- **Seen.** At 1x, nothing changes. At 3x and 10x the rain, the flames and the
  sails stop running at 3 and 10 times speed. This is also what lets a slowly
  stepped island (Part C) still shimmer.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `decade --years 2` for the fast-path hash. New in
  `look.mjs`: add `animT` to `window.__hearth` with a getter and a setter;
  in S1, with `time` unchanged, draw with `animT` at 0 and at 3 and assert
  that a water region differs between the two pictures while a rock-only
  region is identical; then, with the loop paused, call `frame(.5,false)`
  and assert `animT` did not move. Break: put `time*2` back for the water
  glints; "water differs" fails.
- **Devon's eye.** Does 10x look calmer or just slower? One look.
- **Needs.** A0.

#### A2. The hour is a colour: sky table and light map

- **Changes.** In `look.js`: `SKY` (the table in 3.1), `skyAt(f,season,wx,snowLying)`
  returning `[r,g,b]`, pure; `lightMap()` which fills an 880 by 560 canvas
  with that colour, stamps lights with `lighter`, and returns the canvas;
  light sprites built once (a radial falloff drawn pixel by pixel into small
  canvases at radius 8, 18, 28 and 46, in the three warm colours). In
  `draw()`: delete the summer tint, the winter tint, the overcast grey, the
  dark wash, the gold wash and the additive glow block; after the weather
  particles and before the fog, draw the light map over the world with
  `globalCompositeOperation='multiply'`. Lights stamped: the fire (46, and a
  second small additive core so it still reads as the brightest thing), each
  house window pair when lit (18), the hall when lit (28), the lighthouse lamp
  (18) and its two beams as cones, the far island's lamp (8), fireflies (a 3 px
  green), lightning (the whole map set to white times `flash`). The aurora
  and stars stay additive after the multiply. **A house is lit** when the light is below .5, somebody whose `home` it is
  is there (asleep, or within 2 tiles), and the hour is before that house's
  own lights-out, which is a fixed function of the house's index between
  `e[1]+.04` and `e[1]+.16`; and again from `e[0]-.05` until the light
  passes .5; or whenever someone is sheltering in it. The hall is lit when
  the light is below .5 and `storyDay===dayCount` or anyone is `abed` in it.
  The window rectangles in `draw()` follow the same rule. So windows come on
  as people get home, go out house by house through the evening, and the
  small hours belong to the fire, the lighthouse and the stars.
  Someone outdoors and walking when the light
  is below .35 (`gohome`, `nurse`, `visit`, `voyage`) gets an 8 px light at
  their position: a lantern.
- **Seen.** Dusk is rose, night is indigo, noon is clean. Windows come on as people get home and
  go dark one house at a time. Lit snow looks like snow. People
  walking home at night carry a light.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. Unit section 20, on `skyAt` in Node: clear summer noon
  is `[255,255,255]` within 6; clear winter night has blue greater than red by
  at least 40; dusk has red greater than blue; walking `f` from 0 to 1 in
  steps of .002 for four seasons and six weathers, no channel moves more than
  10 between neighbours (no pop). `look.mjs`: S7 mean luminance between 40 and
  95 of 255 at zoom 1; in S7 the pixel 3 px below a lit window is at least 60
  brighter than a pixel 24 px away on the same snow; in S6 mean red exceeds
  mean blue over the land; S1 mean luminance within 4% of the A0 baseline
  (noon must not have changed). Break: swap the dusk and noon rows of `SKY`;
  the unit "dusk has red greater than blue" and the pop check both fail. Read
  which.
- **Devon's eye.** Is night too dark to watch on a laptop in a lit room? Is
  the dusk rose or orange? Two looks at S6 and S7.
- **Needs.** A1.

#### A3. The ground has a shape

- **Changes.** `core.js` `paintTerrain()` only. Keep the seven fixed `rr()`
  draws per tile exactly as they are, so nothing already painted shuffles; all
  new variation comes from a second local stream, `mulberry(seed^0x7e44a1)`,
  drawn a fixed number of times per tile. Add: (1) *relief*: for each land
  tile, slope = `elev` to the north-west minus `elev` to the south-east;
  lighten by up to 14% on rising ground and darken by up to 18% on falling,
  as a translucent fill over the tile. (2) *Rock as strata*: replace the white
  specks with two or three darker horizontal bands per rock tile following
  `elev` contours (band where `floor(elev*40)` changes between this tile and
  the one south), and snow on rock only where `elev>.7`. (3) *Coast*: a 2 px
  wet-sand lip (`#b39f78`) on sand edges that touch water, a 1 px foam line
  (`#dcecf4`) on the water side, and three depth tones by `elev` instead of
  two. (4) *Soft borders*: where grass meets sand or rock, stipple 6 to 10
  pixels of each colour into the other along the shared edge so the step
  stops reading as a tile.
- **Seen.** The island has a hill. The coast looks like a shore.
- **Save.** None. **Stream.** None: `paintTerrain` has its own streams and the
  simulation never reads the picture.
- **Checks.** The gate (`pinned` proves the stream). `look.mjs`: on seed 7,
  the mean luminance of land tiles whose north-west neighbour is lower exceeds
  that of tiles whose north-west neighbour is higher by at least 6; a
  repaint with the same key is pixel-identical (call `paintTerrain()` twice,
  compare); paint time under 60 ms. Break: negate the slope; the relief
  assertion fails.
- **Devon's eye.** Does the plateau read as high ground? Does the stipple look
  like grass in sand or like noise?
- **Needs.** A0. Independent of A1 and A2.

#### A4. Seasons on the land

- **Changes.** `core.js` `paintTerrain()` and the tree block in `draw()`.
  Ground: autumn leaf litter (3 to 5 pixels in the tree's own autumn colour on
  the tiles around each tree with `t.s>.5`); spring flower drifts where they
  already speckle, tripled near water; summer grass yellowing by `dry01`
  (quantise to four levels and add the level to `paintedKey`); lying snow
  that fills by exposure instead of by coin flip (cover a tile when
  `snowD*1.2 > .35 + (.3 if the tile is under a tree) - elev*.4`), which ends
  the checker; shore ice as a pale rim when `frozen`. Trees: three silhouettes
  chosen by `t.a` (round, tall, wide) instead of one; in winter a bare
  branched shape in `#3a2a1c` with the snow cap, not a green ball; a 1 px sway
  of the canopy on `animT` scaled by the weather's wind table; in autumn's
  last two days up to 40 falling-leaf pixels (20 under `RM`).
- **Seen.** Winter is white land with dark trees. A dry summer looks dry. The
  wind is in the trees.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: in S5 at least 90% of grass tiles outside
  the village are snow-coloured and no 2 by 2 block alternates snow and
  grass (the checker test); S1 with `setDry(.9)` has a land hue shifted toward
  yellow against `setDry(0)` and the two paints have different `paintedKey`.
  Break: remove `dry01` from `paintedKey`; the dry assertion fails because the
  ground never repaints.
- **Devon's eye.** The winter trees. The amount of litter.
- **Needs.** A3 (same function).

#### A5. The sun casts shadows

- **Changes.** `look.js`: `sunAt()` gives direction (-1 when the sun is east,
  +1 west, from where `f` sits between the edges), length (0.4 at noon up to
  3.0 at the edges, capped) and strength (0 at night, under fog, and when
  overcast, rain or snow; .28 clear). `draw()` calls `drawShadows()` after the
  terrain and before `ents`: trees get an ellipse offset along the direction;
  buildings get their own frame's silhouette (a black copy of each frame's
  alpha, built once per frame name) drawn sheared along the ground with
  `setTransform`; people get a 3 by 1 offset; clouds already have none and
  keep none. Skipped when `lookQ<2`.
- **Seen.** Morning and evening have direction. Noon is flat and bright.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: at `f` = `e[0]+.08` the strip 6 px west of
  a chosen house's foot is darker than the strip 6 px east by at least 12, and
  at `f` = `e[1]-.08` the reverse; in S3 (rain) the two strips are within 4.
  Break: fix the direction at +1; the morning assertion fails.
- **Devon's eye.** Shadow darkness and length at dusk.
- **Needs.** A2.

#### A6. Weather that lands: rain and storm

- **Changes.** `look.js`. Rain on water: up to 60 ring splashes (2 to 4 px,
  three frames) at positions from a local stream reseeded every 0.25 s of
  `animT`, only on water tiles in view. Rain on land: the terrain layer
  multiplied by the wet colour, eased in over 20 s of `animT` when `rain`
  starts and out over 90 s after it stops (a presentation variable `wetA`);
  up to 30 puddle glints on road tiles. Streaks slant with `wind` and with
  storm. In a storm, three or four pale gust lines cross the water. Lightning
  goes through the light map (A2) so a flash shows the island's colours for a
  frame instead of a white sheet. Roofs: a 1 px bright line along each roof's
  top edge while it rains.
- **Seen.** You can tell it is raining with the streaks turned off. The ground
  stays dark for a while after.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: in S3 the count of foam-coloured pixels on
  water is at least 40 more than in S1; land luminance in S3 is 8% or more
  below S1 after `wetA` is forced to 1 (expose a setter); with weather set
  back to clear and `animT` advanced 100 s, land luminance returns within 2%.
  Break: gate the splashes on `!rain`; the first assertion fails.
- **Devon's eye.** Splash density. Whether wet ground reads as wet or as dusk.
- **Needs.** A2.

#### A7. Weather that lands: fog, snow, cold

- **Changes.** `look.js` and the fog and snow blocks in `draw()`. Fog: two
  drifting layers stay, and the light map is desaturated toward its luma by
  `fogA*.6`, lights get 1.5 times their radius under fog (bloom), and things
  far from the camera centre fade first (a radial alpha on the fog layer
  centred on the view). Snowfall: two depths of flake with different fall
  speeds and a sideways drift by `wind`. Roof snow builds with `snowD` (it
  does) and now leaves: when `snowD` is falling and below .3, a few white
  pixels slide off each roof's south edge. Smoke: every house with somebody home, in
  winter or after dark outside summer, and the smokehouse in any season,
  sends up a column of 5 to 8 puffs bent by `wind`, tall
  and thin in still cold air, torn in a storm (the existing torn-smoke rule
  for sheltering houses folds into this). Breath: a 1 px pale puff beside
  anyone working outdoors when the season is winter.
- **Seen.** Fog has depth. A cold evening has a smoke column over every house
  with someone home.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: in S6 the count of smoke-coloured pixels in
  the 20 px above houses with somebody home is at least 4 each and zero above
  a house whose people have been moved away for the test; in S4 the colour saturation at the view's corners is lower than at its
  centre. Break: draw smoke for every house; the "zero above" assertion fails.
- **Devon's eye.** Smoke amount. Fog bloom.
- **Needs.** A2, and A6 for the shared weather plumbing.

#### A8. People you can tell apart

- **Changes.** `render.js`: split `drawFace` so its choices come from a pure
  `faceSpec(p)` (skin index, eye, hair style, hat kind, beard, grey) that
  consumes the per-person `mulberry(p.seed)` draws in exactly the order
  `drawFace` does now; `drawFace` calls it. Move the per-person block out of
  `draw()` into `folk.js` as `drawFolk(p)`, called from the same `ents` entry.
  The figure stays 3 px wide and 8 tall for an adult (a wider person would
  dwarf a 16 px house), and gains: skin from `SKIN[spec.skin]` (two tones:
  face and a darker pixel); hair from `p.hair`, grey over 52 as on the card;
  the hat or headband the portrait has, as a 3 by 1 row in the same colour;
  a beard pixel; two-frame legs while moving (1 px alternating on `animT`);
  facing from the sign of `tx-x`; elders one pixel shorter with a stick pixel
  ahead of them; a 1 px dark outline under and behind when snow is lying so
  pale shirts do not vanish; task poses kept (sleep, chop, fish, wave).
- **Seen.** The crowd at the fire is a crowd of different people. Someone you
  clicked can be found again by their hat.
- **Save.** None. **Stream.** None: `mulberry(p.seed)` is local, as it is now.
- **Checks.** The gate. Unit section 21: call `drawFace(ctx,p)` with a
  recording `ctx` (an object whose `fillRect`, `clearRect` and `fillStyle`
  setter append to a list) for the first 12 people of seeds 7 and 42 at day 1
  and compare an FNV hash of the list against values recorded **before** the
  refactor (record them as the first step of the increment, from unmodified
  code); faces are pixel-identical (#646). Assert `faceSpec` is equal on two
  calls. `look.mjs`: in S1 zoomed, the set of distinct colours within the
  people's bounding boxes has at least three skin-tone values across 40
  people on seed 7. Break: drop one `rr()` call from `faceSpec`; the recorded
  hash fails.
- **Devon's eye.** Do the figures still look like Hearth's? Is the outline on
  snow too heavy?
- **Needs.** A1.

#### A9. Who is who, and who is singing

- **Changes.** `folk.js`, `css/hearth.css`, one `div#tags` in `index.html`
  (position absolute over the stage, pointer-events none). Name tags: the
  selected person always; at zoom 2 or more, anyone within 3 tiles of the
  pointer (`cur`); at most 6, positioned from world coordinates each frame.
  Ties: while someone is selected, 1 px lines from them to partner (warm),
  children and parents (pale), friends (green), rival or the one they are not
  speaking to (red, dashed), drawn only to people outdoors. Singing: replace
  the 1 px note pip with a three-frame rising note in a colour that is a
  function of the song (`hue = (sg.ci*47)%360`), over each person who knows a
  song that is not lost, at a fire night while the story is being told, and
  now and then at work as before. The teller at a fire night stands one pixel
  taller with an arm that moves. Someone sick and still up is drawn a shade
  paler; someone `abed` is not drawn outdoors (as now).
- **Seen.** Hover the village and it has names. Click a person and their
  family is drawn on the map. At the fire you can see which three people carry
  the tune.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: select a person with a living partner
  (through `showCard`), assert a `#tags` child holds their name and sits
  within 12 px of their projected position; force `storyDay=dayCount` with a
  song whose `kn` holds two living names gathered at the fire and assert
  note-coloured pixels above exactly those two. Break: test `sg.lost` the
  wrong way round; the singing assertion fails.
- **Devon's eye.** Tag font and size. Whether tie lines are too much.
- **Needs.** A8.

#### A10. Buildings through the year

- **Changes.** `tools/blender/buildings.py`, `budget.json`, `spec.mjs`,
  `validate.mjs`, the sheet and atlas, and the building entries in `draw()`.
  New frames for the house (per roof colour), hall and hut: an *autumn dress*
  (a woodpile against the west wall, two leaf pixels on the roof) and a
  *spring dress* (a flower box under one window). Snow frames split in two
  weights, `-snow1` (ridge and eaves) and `-snow2` (the whole roof), so
  settling snow reads as building up; `draw()` picks by `cap` (under .5 the
  first, otherwise the second, each still at its alpha). Icicle pixels on
  `-snow2`. `roofFrame()` gains the season. `spec.mjs` reads colours from
  `look.js`, `folk.js` and `goods.js` as well as `render.js`. Rerun the
  renderer twice and confirm the second run is byte-identical, then the
  validator. Sheet budget stays 16 KiB and 256 px a side; the current sheet is
  3.7 KB.
- **Seen.** A house in October has its wood in. Snow arrives on roofs in two
  steps.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `validate.mjs` grows a rule per new frame family
  (every roof has all three dresses; a snow frame is only snow); `harness.mjs
  sheet`. Break: delete one dress frame from the atlas; `validate.mjs` fails
  naming it and `sheet` fails because a missing frame throws.
- **Devon's eye.** The woodpile and the flower box at 1:1.
- **Needs.** A2 (it rewrites the same house block). Needs Blender on the
  build machine, as the first sheet did.

### 3.4 Increments: the sound

Every one of these owes `node harness.mjs twelve`. The standing numbers: one-
shots between 0.07 and 0.19 on the master analyser, a clear-sky floor near
0.057. A new sound gets a row in that mode's table and sits inside the band.
Sound uses `Math.random`, never `R()`.

#### A11. Rain, fire and sea that know where you are looking

- **Changes.** `audio.js`. The single rain bed becomes three filtered-noise
  layers crossfaded by what is under `cur`: over water a bright hiss with
  sparse low plops, over the village a patter through a resonant band near
  1.8 kHz (roofs), over trees a soft low-passed wash. The sum stays at the
  current rain level so the duck numbers hold. Fire: a crackle (short
  band-passed clicks at random intervals) audible within 10 tiles of the
  hearth when the fire is lit, louder at a fire night. Sea: the wave gain
  follows `tide()` (fuller at high water). Wind: a thin whistle layer in
  winter and in storms.
- **Seen (heard).** Pan the view from the shore to the village in the rain and
  the rain changes.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `twelve`, with three new rows: fire crackle near the
  hearth is above the floor by at least 1.3 times and silent at 30 tiles; the
  rain total with `cur` over water, village and trees is within 10% each of
  the old rain level; the storm duck band is unchanged. Break: leave the fire
  crackle unplaced (no distance falloff); the "silent at 30 tiles" row fails.
- **Devon's ear.** The roof patter. The crackle's rate.
- **Needs.** Nothing in Part A. Touches only `audio.js` and the `twelve` mode.

#### A12. The island's own voices

- **Changes.** `audio.js`. Birds by season: spring two-note calls, summer a
  dry insect buzz by day, autumn a goose call when `geese` is in the air,
  winter one low caw now and then. Night: an owl (two soft notes) on clear
  nights outside winter; frogs near a spring at dusk in spring and summer.
  The market: a low murmur (band-passed noise with a slow formant sweep)
  between `f` .45 and .56 within 8 tiles of the market when at least three
  people are in task `market`. A dawn motif: at first light each day, three
  to five notes derived from the seed alone by the same walk `songDegrees`
  uses (`songDegrees(-1)` with its own constant), on the music bus, so every
  island has a signature and two devices on one link agree.
- **Seen (heard).** Each season sounds like itself with the screen off.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `twelve`: each new voice measured in the band; the
  motif on seed 7 twice gives identical degrees and seed 8 different ones (the
  phase 1 pattern); the goose call is silent when `geese` is null. Break: draw
  the motif's first note from `Math.random()`; the two-run assertion fails.
- **Devon's ear.** Whether the insect buzz is tiring. The motif.
- **Needs.** A11 (same file).

#### A13. A song that sounds sung, and is seen sung

- **Changes.** `audio.js`, `folk.js`. `songTune` voices go through two band-
  pass filters at vowel formants (about 700 and 1,100 Hz, a different pair
  per voice) with a slow vibrato, so the fire-night song is a small choir and
  not five beeps; a child's voice is an octave up; a short feedback delay
  (180 ms, gain .25) on the song only, for the hill. `songTune` records what
  it scheduled in a presentation variable (`singNow`: start time, beat,
  degrees, the names singing); `folk.js` pulses each singer's note on the
  beat while it sounds.
- **Seen.** The notes over the singers move in time with what you hear.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `twelve`: the tune's peak stays within 0.09 to 0.12
  (it is 0.103); a lost song is still measured silent; two runs still give the
  same degrees. `look.mjs`: with `singNow` set by a forced `songTune`, the
  note pixels over a singer differ between `animT` at a beat and half a beat
  later. Break: let a lost song schedule its notes; the measured-silence row
  fails.
- **Devon's ear.** Does it sound like people? This is the one to listen to
  with headphones.
- **Needs.** A9 and A12.

#### A14. Tiers, reduced motion, budgets, and the preview

- **Changes.** `look.js`: the `lookQ` tier logic of 3.2 and a check of every
  Part A effect against it and against `RM`. `look.mjs`: the timing budget
  tightened to median 6 ms and 95th percentile 12 ms across all 16 scenes,
  and a run with `lookQ` forced to 0 asserting median at or under the A0
  baseline plus 1 ms. A phone-width pass (390 by 844 viewport): tags do not
  overlap the HUD, nothing new is under the log. Then recapture the board
  preview with `Tools/board-check/capture-hearth.mjs` and promote it. **This
  touches shared files** (`assets/previews/hearth.jpg`,
  `assets/og/hearth.jpg`); say so in the change.
- **Seen.** The same picture on a slow machine, minus shadows and splashes.
  A new card image on the board.
- **Save.** None. **Stream.** None.
- **Checks.** The gate; `debt`; `cd Tools/board-check && npm run check && npm
  run social:check`. Break: force `lookQ=2` in the tier-0 run; the tier-0
  timing assertion fails.
- **Devon's eye.** The new preview image. Tier 0 against tier 2 side by side.
- **Needs.** All of A2 to A10.

---

## 4. Part B: systems you can see

### 4.1 What is worth doing, and what is not

Four things were on the list. Three are worth doing now and cheap, because the
simulation already does the work and only the showing is missing. One is not.

| Thing | Verdict | Why |
| --- | --- | --- |
| Stock is a number | **Do, first** (B1) | Zero simulation change. Wood, grain and fish become objects whose size is the number. Everything else in Part B stands on it. |
| Nobody carries anything | **Do** (B2) | Mostly zero simulation change: the routes exist, the hands are empty. |
| The trader trades nothing you can see | **Do** (B3) | The trade already happens. Four people hauling timber down and sacks up turns a HUD delta into an event. Moves the stream. |
| Grown stories change where people walk, not what they want | **Do, small** (B4) | A table and four thresholds. It is the only way the island's memory feeds back into its work, and it costs nothing to islands with no grown story (#74). |
| The far island is a name and a seed | **Show it** (B5); **do not simulate it in this arc** | See 4.2. |

Left for later, on purpose: the recited names on the hill being chronicled,
ground for the other 16 story kinds, and the watcher's own history. None is
"exists on paper and shows nothing"; they are new content.

### 4.2 A second island that really simulates: later, and here is the seam

Not in this arc, for the offline game. Three reasons.

1. **One page holds one world.** Every piece of state is a top-level `let` in
   one global scope. Two worlds in one page means either extracting the rules
   into modules (the WISHLIST's "pure modules", a rewrite of `sim.js` and
   `life.js`) or swapping worlds through `pack()` and `unpack()`, which drops
   every task in progress and restarts the random stream at each swap.
2. **The save doubles.** A link already carries up to 200 KB. Two islands in
   one link, or two storage entries that must agree, is a save-format project
   with its own migration.
3. **Two coupled streams need an ordering rule** for every boat that crosses,
   and the determinism harness would have to hold two islands to each other.

Part C changes the cost. On the server, a second world is a second `vm`
context: no refactor, no shared state, about 100 MB. And Part C's eras
(increment C7) already make the far island real without running two worlds:
when the public island's era ends, the next public island is founded at
`farSeed(seed)`, the old island's far island, by people who sailed from the
old one, and the old island becomes the lamp on the new one's horizon. The
involution does the rest.

So the answer is: **this arc shows the far island (B5) and makes it the next
island in time (C7). A neighbour that simulates at the same time is the first
item of the arc after this one, on the server first**, and section 5.6 keeps
the seam for it: `farReturn`'s four cargoes (news, a thing, a tune, a
passenger) are already the whole interface between two islands.

### 4.3 Increments

#### B1. Stock you can point at

- **Changes.** `goods.js`: `drawStock()` adds `ents` entries, called from
  `draw()` on one line. A woodpile beside the hearth, on the side away from
  the first house: logs in rows, `min(24, ceil(wood/4))` of them, so `wood`
  12 is three logs and 96 is a full stack, with a snow line in winter. Sacks
  against the hall's south wall, or beside the fire when there is no hall:
  `min(16, ceil(granary/25))`. Fish drying on the racks when `hasW('racks')`,
  or on a line by the hut: `min(8, ceil(food/20))`. Each count eases toward
  its target by one object per 0.4 s of `animT`, so a harvest is seen
  arriving. Positions are pure functions of `center` and the building, tested
  against `freeSpot`-style occupancy only by reading (`at()`, `road`); if the
  spot is water or a building, mirror to the other side.
- **Seen.** The store is a thing in the village. A short winter (`want`) looks
  like a short row of sacks.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: with `setWood(0)` and `setWood(96)` the
  log-coloured pixel count in the pile's box goes from 0 to at least 60 after
  `animT` advances 12 s; same for `setGranary`. Unit section 22: the pile and
  sack positions for seeds 7, 42 and 20260819 at day 1 are on land and not
  inside any building footprint. Break: read `food` where `wood` belongs; the
  wood assertion fails.
- **Devon's eye.** Where the pile sits. Whether 24 logs is the right top.
- **Needs.** A0.

#### B2. Hands that are full

- **Changes.** `goods.js`: `carryOf(p)`, a pure function of task and state,
  returning an item or null; `folk.js` draws the item (2 to 3 px) on the
  person. The table: `carry` with `carrySt` 0 a grain basket, 1 a meal sack;
  `water` with `waterSt` 0 empty buckets, 1 full (a blue pixel each); `chop`
  the axe (exists); `harvest` a sheaf once `p.work>1`; `build` a plank on the
  way, a hammer at the site; `fish` the rod (exists); stepping off a boat for
  30 s, a string of fish; `nurse` a bowl; `bounds` leader a staff; `tend` a
  stick of firewood; `gather` for the teller, nothing; anyone holding a thing
  from `things[]` (`thingsOf(p.name)`) gets one bright pixel at the belt in
  the shelf colour for that thing's index. **Putting down:** when `carryOf`
  goes from an item to null because the task changed to `chat`, `market`,
  `shelter` or `wave`, the item is drawn on the ground where they stood (an
  underscore field on the person) until their task changes again. That is
  presentation; the simulation does not know.
- **Seen.** You can tell what someone is doing without clicking. Buckets go
  out empty and come back full. A basket stands in the path while two people
  talk.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. Unit section 23: `carryOf` for a scripted person in
  each of the twelve task states returns the table's item; with an heirloom
  in `things` held by them, the belt pixel is reported. `look.mjs`: force one
  person into `water` with `waterSt` 1 and assert a blue pixel within their
  box. Break: swap the two `waterSt` rows; the unit row fails.
- **Devon's eye.** Whether 2 px items read at zoom 1 or only zoomed. The
  set-down.
- **Needs.** A8, B1.

#### B3. The trade, enacted

- **Changes.** `life.js` (the `b.kind==='trade'&&b.st==='in'` branch),
  `sim.js` (a `haul` case), `render.js` (`whyText`), `goods.js` (`carryOf`),
  `core.js` (`CRAFT_TASK.haul=4`). The numbers the trade moves stay exactly
  as they are and stay applied the moment the boat lands: this increment adds
  no economy. After the wavers are chosen, the first `min(4,n)` adults among
  them become haulers, on every trade (all three branches leave meal). A
  hauler walks to the woodpile (B1's position), then to the landing, carrying
  a length of timber only if timber was paid (the first two branches), waits there until the boat's wait is under 20, then walks to the
  store carrying a sack, then goes idle. `p.haulSt` 0 to 3; not saved, like
  every task in progress; a hauler interrupted by a storm, by night or by a
  reload drops the errand and the stock is already right. The first time a
  person hauls they get one life line ("carried the timber down to the
  trader's boat"). While the boat waits, `goods.js` draws the cargo: timber
  stacked on the sand growing as haulers arrive, sacks in the boat shrinking
  as they leave. `whyText` gets its case. If `farTrade` brought a thing, the
  talker carries it up (B2's belt pixel is already there).
- **Seen.** Once a season a boat comes in, four people walk timber down to it
  and walk meal back, and the woodpile and the sacks change as they do.
- **Save.** None: the errand is a task in progress and those are not saved.
- **Stream.** **Moves.** Haulers stand in different places from wavers, so
  every later nearest-person choice differs from the first trade on (day 3 on
  most islands). Re-pin with `pinned --write` and say so. No new `R()` call is
  needed: reuse the draws the wave already makes.
- **Checks.** The gate, then `decade`, `strain`, `wider`, `saga`, `sixteen`
  (a stream move puts observational checks red; read #66, #67 and #71 before
  believing one). Unit section 24, on a scripted island with a landing, a
  hall, `wood` 40 and eight adults: call the arrival; at least one person has
  task `haul`; stepping 1,200 times, every hauler reaches `haulSt` 3 and
  returns to `idle`; `wood` and `granary` equal the values the old branch
  gives for the same inputs (the economy did not move); with `storm` true the
  haulers go idle within 60 steps and nobody is left in `haul`. Break: skip
  the assignment; "at least one person has task `haul`" fails. Second break:
  move the stock change into `haulSt` 3; the economy assertion fails.
- **Devon's eye.** Is four haulers a procession or a queue?
- **Needs.** C2 first if C2 is going to happen (both move the stream and C2
  touches every distance call in these files), B1, B2.

#### B4. Stories that pull

- **Changes.** `core.js`: a table beside `GROW` and `LORE_PLACE`,
  `GROW_PULL`, story kind to `{job, w}`: `shoal` to fish .15; `rainscame` and
  `drought` to water .15; `hardwinter` and `want` to harvest .15; `fever` and
  `ill` to nurse .15; `stayed`, `voyage` and `farname` to wander .08. A
  function `pullOf(job)`: the sum of `w` over chronicle entries that have
  grown (`e.gr`) and whose kind maps to that job, capped at .3. It is derived
  from `chron` the way `yearName()` is: recomputed in `newDay()` and at the
  end of `unpack()` into a transient object, never saved. `sim.js`, the idle
  chooser: add `pullOf('fish')` to the fishing threshold, `pullOf('water')`
  to the watering `R()<.3`, `pullOf('harvest')` to `keen`'s `.45`,
  `pullOf('nurse')` to the nursing chance, `pullOf('wander')` to the
  restless detour. **No new `R()` call**: each existing roll is stored in a
  local first, so the code can tell a roll the pull turned from one it did
  not. When the pull turned it, the person gets one life line the first time
  ("took to the water after the story of the fish was told again", one line
  per job, in a small table) and the island gets one chronicle entry per
  story kind, ever ("the summer the story started sending people to the
  boats"), found by reading the chronicle, not by a new saved flag (#37, the
  TG-48 precedent). `render.js` `whyText`: when the task's job has a pull
  above zero, the reason names the story's label.
- **Seen.** Years after the summer the fish came in, the card of someone
  fishing says they are down there because of that story, and more of the
  village is at the shore than the food count alone would send.
- **Save.** None; derived. Old saves get the pull the moment they load,
  because their chronicle already says what grew.
- **Stream.** No draw is added or removed. An island with no grown story of a
  mapped kind takes every branch it took before, so the forty-day pinned
  hashes are expected **not** to move (stories need three tellings to grow).
  Run `pinned` without `--write` and expect green; if it is red, a grown
  story exists by day 40 on that seed and the re-pin is legitimate, with that
  sentence in the change. `decade` islands will differ from before.
- **Checks.** The gate, `decade`, `strain`, `saga`. Unit section 25: `pullOf`
  is 0 with no grown entries; .15 with one grown `shoal`; .3 with three
  (capped); unaffected by an ungrown `shoal`. Then the turn itself: on a
  scripted island with food short, replace `R` with a function returning a
  value just above the unpulled fishing threshold; without a grown `shoal`
  the idle adult does not fish, with it they do, and they have the life line
  and the island has exactly one new chronicle entry after two such turns.
  Break: read `e.st` where `e.gr` belongs; "unaffected by an ungrown shoal"
  fails.
- **Devon's eye.** The five sentences. Nothing on the map.
- **Needs.** B3 (the stream lane is serial).

#### B5. The far island, seen

- **Changes.** `look.js` and the far-island block in `draw()`. The silhouette
  keeps its shape. It gains: one lamp per person known to be there
  (`gone.filter(g=>g.far).length`, plus one if `farIsle.lit`), up to six,
  placed along the outline from `mulberry(farRec.s)`, each stamped into the
  light map (A2) and blinking out late at night one by one; by day, a thread
  of smoke per lamp; for two days after any crossing in `farRec.cr`, a 3 px
  sail between the horizon and the landing, on the side the boat went;
  weather of its own, in that it fades behind rain and fog more than the near
  shore does. When the island does not know the name yet (`!farRec.kn`),
  none of this shows: it is a shape and nothing else, as now.
- **Seen.** Somebody leaves for the far island and that night there is one
  more light over there.
- **Save.** None. **Stream.** None.
- **Checks.** The gate. `look.mjs`: in S7 with `gone` holding two far entries
  and the name known, warm pixels in the silhouette's box number at least 2
  and at most 6; with the name unknown, zero. Break: count every entry of
  `gone` regardless of `far`; a test island with two near departures and no
  far ones shows lights and the "zero" assertion fails.
- **Devon's eye.** Whether the lamps are visible at zoom 1.
- **Needs.** A2.

---

## 5. Part C: the server

### 5.1 What it is

**One public island that lives on the site's own server around the clock.** A
visitor opens `Projects/hearth/live.html` and sees the island as it is this
minute: the same people as yesterday, a little older, with the chronicle of
everything that happened while nobody was looking. Optionally, later, a
gallery of islands visitors chose to keep.

The offline game does not change. `index.html` opened from a disk or from the
site behaves exactly as it does today, shares no state with the public island,
and makes no request. The server is an extra.

### 5.2 How it works, in one page

**The server is the game.** A small Node program loads the real scripts with
`test/load.mjs` and calls the real `step(.05)`. There is no second
implementation of anything. Its state is the real save: `pack()` through
`lzEnc`, the same string a share link carries.

**Island time is a function of the wall clock.** The server keeps an anchor
(`at` a wall-clock millisecond, `step` a global step number, `stepMs` real
milliseconds per step). The step the island should be on now is
`step + floor((now - at) / stepMs)`. After a restart the server loads its last
snapshot and steps until it is there. Catching up one real day of downtime at
the default pace is about a minute of one core.

**Epochs.** Once an island day, at `dayFrac()` 0.02 (the small hours, everyone
asleep, no boats; section 1), the server packs the island, writes the snapshot
as an immutable file, and unpacks its own snapshot. So the server's island is
at every epoch exactly the island anybody would get by loading that file.
Epoch 0 is the founding, at global step 0. Epoch k for k of 1 or more is at
global step `2240 + 2800*(k-1)`, because `newWorld` starts the clock at
`dayLen*.22`.

**A visitor's browser runs the same island.** It fetches the current epoch's
snapshot, unpacks it, steps forward to now (at most one island day, a few
thousand steps, well under a second), and then steps at the server's pace
with the same fixed `dt`. At the next epoch it fetches the next snapshot and
unpacks that. It never sends anything.

**That is only honest if the browser and the server compute the same island.**
Today they do not: V8 in Node and V8 in Chromium differ in `Math.sin`,
`Math.cos` and `Math.pow`, which is why CI pins a browser, and two engines
call a random comparator inside `sort()` a different number of times.
Increment C2 fixes that at the root with arithmetic that is the same on every
engine. With it, what a visitor watches between epochs is what the record will
say happened. Without it the page would still work (it snaps to the server's
snapshot each island day), but the story told at tonight's fire could differ
between the visitor's screen and the chronicle. So C2 comes before launch.

**The read path is static files.** The server writes into a folder that the
existing web server serves. No port is opened, no proxy is configured, and
nothing accepts input from the public until the optional increments C8 and C9.

**Pace and lifetime (Devon's call; question 1).** The default is one island
day per 20 real minutes: 72 island days a real day, a year in under seven
hours, a generation in about a week. At that pace villagers move at about a
ninth of the offline speed, which is why A1's presentation clock matters: the
water, smoke, rain and firelight still move in real time. The chronicle and
the graves grow without bound by design (#815), so a public island cannot live
forever: at about 290 save bytes an island day, 90 real days is about 1.9 MB
of save, 1 MB compressed, which is the most a visitor should be asked to
download. So the default **era** is 90 real days. Then the island is archived
whole and the next one is founded on its far island by people who sailed from
it (C7). Both numbers are configuration, and C6 measures before either is
fixed.

### 5.3 What is published, and where

Served at `/hearth-live/` on the site (same origin as the game, so the
zero-offsite-requests rule holds):

| File | Written | Holds |
| --- | --- | --- |
| `live.json` | every epoch and at start | `{v, era, epoch, clock:{at,step,stepMs}, epochSteps:2800, dt:.05, saveV, seed, name, day, people, code}` and nothing large |
| `epoch/<era>-<n>.json` | once, at its epoch | `{era, n, step, hash, save, events:[]}`; `save` is the `lzEnc` string, `hash` is the harness's FNV `hash:length` of the JSON |
| `saga.html`, `chronicle.txt` | every epoch | `sagaHTML()` and the text export, from the server's island |
| `health.json` | every minute | `{now, step, behind, lastEpochAt, rssMB, codeRejected}` |
| `eras.json`, `eras/<era>/final.json`, `eras/<era>/saga.html` | at an era's end | the archive |

Kept: every epoch file for the last 48 hours, then one a real day (the first
after midnight UTC) until the era ends, then only the final. At the default
pace that is under 100 MB an era at the very end and far less on average.

`live.json` is fetched with a cache-busting query. Epoch files never change
and can be cached forever.

### 5.4 What Devon runs

One extra container. No published port for the core. An example compose file
ships as `Projects/hearth/server/compose.example.yml`; the essentials:

```yaml
services:
  hearth-live:
    image: node:22-alpine
    restart: unless-stopped
    user: "1000:1000"
    read_only: true
    working_dir: /app/Projects/hearth
    command: ["node", "--max-old-space-size=192", "server/live.mjs"]
    environment:
      HEARTH_DATA: /data            # private state: anchor, snapshots, logs
      HEARTH_PUBLIC: /public        # what the web server serves at /hearth-live/
      HEARTH_SEED: "7"              # the first island; question 5
      HEARTH_DAY_SECONDS: "1200"    # real seconds per island day; question 1
      HEARTH_ERA_DAYS: "90"         # real days per era; question 1
    volumes:
      - <the served checkout of this repo>:/app:ro
      - <state>/hearth-live/data:/data
      - <state>/hearth-live/public:/public
    mem_limit: 384m
    cpus: 0.5
```

and one more read-only mount on the existing web container, so the folder is
served with no change to its configuration:

```yaml
      - <state>/hearth-live/public:/usr/share/nginx/html/hearth-live:ro
```

(or, instead of the mount, one `location /hearth-live/ { alias ...; }` block;
either works). The repo must never grow a folder called `hearth-live` at its
root, or the mount would hide it.

- **Start:** `docker compose up -d hearth-live`. On first start with an empty
  data folder it founds the island at `HEARTH_SEED` and writes epoch 0.
- **Restart and crash:** `restart: unless-stopped`. On start it reads the
  newest epoch file in `/data`, unpacks it, and steps to the present. A step
  that throws is caught: the server keeps the last good epoch, backs off, and
  says so in `health.json`; the page shows the last good island.
- **New game code:** nothing to run. The server mounts the same checkout the
  site is served from. At each epoch it hashes the script files; when the
  hash has changed and is the same on two reads 30 s apart, it loads the new
  code in a fresh context, unpacks the snapshot there, steps 200 steps as a
  smoke test, and adopts it. A save version bump goes through `migrate` at
  that unpack. If the smoke test throws it keeps the old code and reports
  `codeRejected`. So a nightly merge reaches the public island within one
  island day, and a bad merge does not stop it.
- **State and backup:** all state is plain files under `/data`, written to a
  temp name and renamed. Backing up is copying that folder; a nightly archive
  of it is a few megabytes. Restoring is putting the folder back and starting
  the container. C6 includes doing that once as a drill.
- **Cost:** steady state is 2.3 steps a second at about 0.3 ms each, under
  0.1% of one core, plus a pack and compress each epoch (tens of
  milliseconds, growing to a few hundred near an era's end). Memory measured
  at 62 MB after load and 235 MB after 56,000 steps with the default heap;
  the heap flag and the container limit hold it under 384 MB, and C6 measures
  the long run.
- **No accounts, no personal data.** The core stores nothing about visitors
  and receives nothing from them. The page keeps one number in the visitor's
  own browser (the last island day they saw).

### 5.5 Increments: the core

#### C1. A save cannot carry markup

- **Changes.** `save.js` `unpack()`: a repair on every load (#37), before
  anything is built from the object: walk every string in the save and remove
  the characters `<`, `>`, `&`, `"` and backtick, and cut any string over 400
  characters to 400. The log writes names and chronicle text through
  `innerHTML`, and a save is about to become something the server accepts and
  republishes, so a save is untrusted input from now on. The game's own
  bold names are added at display time and are not in the save, so nothing
  the game writes is lost; confirm by running the round-trip.
- **Seen.** Nothing.
- **Save.** No version bump. A repair rule: strings are plain text on every
  load. **Stream.** None.
- **Checks.** The gate, `migrate`, `saga`. Unit section 26: a current save
  with one person's name, the village name, one chronicle label and one life
  line each carrying `<b onmouseover=x>`: after `unpack` no string anywhere
  in `pack()` contains `<`; the existing byte-identical `pack -> unpack ->
  pack` check still passes on a clean save; a 100-day save from seed 7
  contains none of the five characters before repair (so the repair is a
  no-op on real islands; if it is not, list what it found and stop). Break:
  skip the walk for `o.ch`; the chronicle-label case fails.
- **Devon's eye.** Nothing.
- **Needs.** Nothing. Small; can share a worker session with C2's first step.

#### C2. One arithmetic for every engine

- **Changes.** `core.js`, directly under `mulberry`: `hyp(dx,dy)` as
  `Math.sqrt(dx*dx+dy*dy)`; `dsin(x)` and `dcos(x)` by range reduction to a
  quarter turn and a fixed polynomial, using only `+ - * /`, `Math.floor` and
  `Math.round` (accuracy to about 1e-9 is plenty; identical bits on every
  engine is the point, and those operations are exact by the language
  standard); `shuf(a)`, a Fisher-Yates shuffle drawing from `R()`. Then, in
  `core.js`, `life.js`, `watcher.js`, `sim.js`, `flavor.js`, `save.js` and
  `main.js`: every `Math.hypot` becomes `hyp`, every `Math.sin` and
  `Math.cos` becomes `dsin` and `dcos`, the two `Math.pow` or `**` sites in
  `life.js` (near lines 156 and 599) become multiplication or `Math.sqrt` if
  the exponent allows and otherwise a `dpow` built the same way, the one
  `Math.exp` in `main.js` (zoom) may stay because it is the view, and the two
  `sort(()=>R()-.5)` (one in `life.js`, one in `sim.js`) become `shuf`.
  `render.js`, `audio.js` and the three Part A files are not touched: they
  are not simulation. Counted today: 10 `sin`, 7 `cos`, 2 `pow`, about 80
  `hypot` across those files.
- **Seen.** Nothing on any one machine. Two different browsers opening one
  `#s=` link now grow the same island when stepped the same.
- **Save.** None.
- **Stream.** **Moves, once, for everybody.** Every island's future changes
  (its present does not: a saved island loads exactly as it was). This is the
  arc's one deliberate re-pin for its own sake. Re-pin with `pinned --write`
  on Chromium 1194.
- **Checks.** The gate, then every deep mode once (`decade`, `strain`,
  `saga`, `wider`, `migrate`, `leftovers`, `debt`, `eleven` to `sixteen`,
  `nan`), expecting some observational reds per #66 and #71. New
  `test/portable.mjs`, Node only: runs seeds 7 and 20260819 for the pinned
  forty days through `load.mjs` and compares the FNV `hash:length` with
  `hashes.json`. **Node and the pinned Chromium now agree, and that is the
  guard.** It joins the CI gate (about 70 s). Unit section 27: read the seven
  files as text and fail on any `Math.sin`, `Math.cos`, `Math.tan`,
  `Math.pow`, `Math.hypot`, `Math.atan`, `Math.exp`, `Math.log`, `**` or
  `sort(()=>R()` outside an allowlist of one (`Math.exp` in `main.js`); and
  `dsin`, `dcos` against `Math.sin`, `Math.cos` at 1,000 points to within
  1e-8. Break: put one `Math.sin` back in `light()`; unit 27 fails on the
  scan. Second break, the one that matters: revert `tide()` alone to
  `Math.sin` with the scan's allowlist widened to hide it; `portable.mjs`
  must fail (if it passes, Node and Chromium happened to agree on that input
  range, which is information: say so and try `dcos` in the boats).
- **If Node and Chromium still differ after all of the above:** do not hunt
  for more than the increment's time. Ship the arithmetic (it is still right),
  leave `portable.mjs` out of the gate, and record the first island day and
  the first `pack()` key that differ (`portable.mjs --bisect` prints both by
  comparing day by day against a per-day hash list written from the browser).
  Part C still works in its weaker form and a follow-up increment takes the
  lead.
- **Devon's eye.** Nothing.
- **Needs.** Nothing. First in the stream lane, before B3 and B4.

#### C3. The island as a program

- **Changes.** New `server/world.mjs`: wraps `loadHearth()` from
  `test/load.mjs` (one loader for tests and server, #816), passes `btoa` and
  `atob` into the context, and offers `found(seed)`, `load(saveString)`,
  `stepTo(globalStep)`, `snapshot()` (pack, FNV hash, `lzEnc`), `reload()`
  (unpack own snapshot; fresh context when the code hash changed), `saga()`,
  `summary()`. Stepping is in batches of at most 2,800 inside
  `vm.runInContext` with a 20 s timeout. New `server/live.mjs`: reads the
  environment of 5.4, owns the anchor and the epoch arithmetic of 5.2, runs a
  one-second tick that steps to the present and handles an epoch when one is
  crossed (snapshot, write `epoch/…json` then `live.json`, reload, retention),
  writes `health.json` each minute, catches and backs off on a throw, and on
  start resumes from the newest epoch file. All writes are temp-then-rename.
  The clock is injected (`now()` passed in) so tests can run it fast. No HTTP,
  no dependency, Node 22.
- **Seen.** Nothing yet; files appear in a folder.
- **Save.** None; it uses the format as it is. **Stream.** None.
- **Checks.** The gate. New `test/server.mjs`, Node only, with a fake clock
  and a temp folder: (1) found seed 7, advance the clock three island days,
  expect epochs 0 to 3 on disk with strictly increasing `step` equal to
  `0, 2240, 5040, 7840`; (2) *restart is invisible*: run A straight through
  five island days; run B, kill it after two (drop the object), start a new
  one on the same folder, advance to five; the two epoch-5 hashes are equal;
  (3) *catch-up*: start, jump the clock 30 island days, expect it to arrive
  with every intermediate epoch file written and the same epoch-30 hash as a
  run that ticked every second; (4) a step that throws (inject a script that
  throws on day 2) leaves epoch 1 as the newest file, `health.json` reporting
  it, and the process alive; (5) retention keeps what 5.3 says after 60 fake
  hours; (6) every epoch file's `save` goes through `lzDec`, `JSON.parse` and
  `canLoad`. Break: skip `reload()` at the epoch; check (2) fails, because the
  straight run and the restarted run are no longer the same island.
- **Devon's eye.** Nothing.
- **Needs.** C2 (so its hashes mean something in a browser); C1.

#### C4. The page that follows it

- **Changes.** New `live.html`: `index.html`'s markup with every id kept
  (the scripts bind handlers to them at load), `class="live"` on `body`, a
  first script `js/live-flag.js` (`var HEARTH_LIVE=1;`) and a last script
  `js/live.js`. `css/hearth.css`: under `body.live` hide the speed buttons,
  `morning`, `keep`, `new island` and the hint, and show a status line.
  Four guarded seams in existing files, each inert when the flag is absent:
  `core.js` `const LIVE=typeof HEARTH_LIVE!=='undefined'`; `life.js`
  `autoSave()` returns at once when `LIVE` (a visitor's own island lives in
  the same `hearth.auto` key and must not be overwritten); `main.js` boot
  uses `newWorld(1)` and skips the hash and the autosave when `LIVE`; `main.js`
  `loop()` hands the frame to `liveFrame(now)` when `LIVE`; and in `endPress`
  and `pointermove`, when `LIVE`, a click only opens a card (no blessing, no
  `R()`). `js/live.js`: fetch `/hearth-live/live.json`; take the clock offset
  from the response's `Date` header; if `saveV` is above `SAVE_V` say "the
  island has changed, reload"; fetch the epoch file, `unpack`, step to the
  present at up to 600 steps a frame, then each frame step however many steps
  the wall clock says are due with `dt` .05, call `audioTick` with real
  seconds and `draw()`. At an epoch boundary: hash its own `pack()`, hold,
  fetch the next epoch file (retry every 2 s, up to 90 s, then show "the
  island is catching its breath"), compare hashes and count a mismatch in
  `console.info`, unpack the server's. When the tab was hidden and returns,
  step to the present, or refetch if more than one epoch passed. When the
  fetch fails at boot (opened from a disk, or the mirror without a server):
  one quiet line saying where the public island lives, and a link to
  `index.html`. Status line: village, year and its name, day, people.
- **Seen.** Open `live.html` on the site: the public island, alive, at its
  real hour, with everyone's real history on their cards and the whole
  chronicle in the panel.
- **Save.** None. No new storage key in this increment.
- **Stream.** None for the offline game: `pinned` green proves the seams are
  inert.
- **Checks.** The gate (which proves `index.html` is unchanged in behaviour).
  Unit section 28: `live.html` has every `id` `index.html` has and the same
  script list plus the two; with `HEARTH_LIVE` defined in the context
  (give `loadHearth` an option that sets it before the scripts run),
  `autoSave()` leaves the store untouched. New `test/live.mjs`, browser: start
  `serve.mjs` with a route for `/hearth-live/` onto a temp folder, run
  `server/live.mjs` in process with a clock at 60 times speed, open
  `live.html`; assert (1) across three epoch boundaries the page's own hash
  equals the server's (lockstep, the whole point); (2) `hearth.auto`, set to a
  sentinel before the visit, is unchanged after; (3) a click on water adds no
  skipped stone; (4) with the server stopped the page shows the breath line
  and resumes when it is back; (5) opened with the route removed, the page
  shows the offline line and throws nothing. Add `server.mjs` and `live.mjs`
  to CI (gate and gate, about a minute together). Break: step with the
  frame's own `dt` instead of .05; assertion (1) fails at the first boundary.
- **Devon's eye.** How the island feels at a ninth of the speed. This is the
  look that decides question 1; `HEARTH_DAY_SECONDS` can be tried at 300, 600
  and 1,200 on a test folder before anything is public.
- **Needs.** C3, A1 (the presentation clock, so a slow island still moves).

#### C5. The record, and coming back to it

- **Changes.** `server/live.mjs`: write `saga.html` and `chronicle.txt` each
  epoch. `js/live.js`: a new storage key `hearth.liveSeen` holding
  `era:day` of the last visit; on open, when it is older, a panel "while you
  were away" listing the chronicle entries since then (at most 40, newest
  last, with year names), read from the snapshot; a link to the saga; "take a
  copy", which opens `index.html#<the epoch's save string>` as the visitor's
  own island to do with as they like (hidden when the string is over 1.5
  million characters, with a line saying the island has grown too long to fit
  in a link and the saga is the way to keep it); "yesterday at speed", which
  fetches the epoch file from 72 epochs back (or the oldest kept), unpacks it
  locally and runs it at 10x or `FAST` with a banner saying this is a look
  back, then returns to the present by refetching. `index.html` gains one HUD
  link, "the public island", shown only when the page was served over http or
  https.
- **Seen.** Come back the next day: thirty-odd lines of what happened, then
  the island as it is. Or watch yesterday go by in two minutes.
- **Save.** None. One new storage key, `hearth.liveSeen`; no existing key
  changes. **Stream.** None.
- **Checks.** The gate; `test/live.mjs` grows: with `hearth.liveSeen` set
  three island days back, the panel lists exactly the chronicle entries whose
  day is later, in order; "take a copy" yields a hash that `loadHash` accepts
  at the right day; after "yesterday at speed" the page's hash at the next
  boundary equals the server's again. `saga` mode unchanged. Break: compare
  days with `>=`; the panel shows one entry too many and the count assertion
  fails.
- **Devon's eye.** The wording of the panel. Whether the HUD link belongs.
- **Needs.** C4.

#### C6. Running it for real: the package and the long run

- **Changes.** New `server/compose.example.yml` (5.4) and `server/README.md`:
  what to run, the two mounts, what each environment value does, where state
  lives, the restart behaviour, the backup command and the restore drill, how
  to read `health.json`, how to change the pace. New `test/longrun.mjs`, Node
  only, not in the gate: runs one island for `--days` island days (default
  6,480, one default era; about 100 minutes) and prints every 500 days the
  step cost per day, the save size raw and compressed, resident memory, and
  the unpack time; fails if step cost per day at the end is over three times
  its value at day 500, if the compressed save passes 1.5 million characters,
  or if memory passes 384 MB. A short form (`--days 800`) joins the nightly
  deep job. Then the drill on the real machine's test folder: start, wait two
  epochs, stop, copy the data folder away, wipe it, restore, start, confirm
  the next epoch's hash matches a straight run.
- **Seen.** Nothing by a visitor. Devon gets one page that says exactly what
  to do.
- **Save.** None. **Stream.** None.
- **Checks.** `longrun.mjs` itself; `server.mjs`. Break: make `STUMP_MAX` 1e9
  as phase 2 did; the short long-run fails on save size.
- **Devon's eye.** The README, read as the person who has to follow it at
  night.
- **Needs.** C3. The numbers it prints decide `HEARTH_ERA_DAYS`.

#### C7. Eras: the island ends, and its far island begins

- **Changes.** New `server/era.mjs`, called by `live.mjs` when the era's real
  days are up, at an epoch. It: writes the final snapshot and the saga to
  `eras/<era>/`, appends `{era, seed, name, founded, ended, years, people,
  graves}` to `eras.json`; picks up to four founders from the old island (the
  people in `gone` with `far` set, newest first, then living adults with
  `dreamFar` or the trait `brave` or `restless`, by name order; no random
  draw); founds the new island with `found(farSeed(oldSeed))`; renames the
  new island's first settlers to the founders' names (updating `names`, each
  person's `seed` as `hash(name)^seed`, every mention of the old name in
  other people's `rels`, `partner` and `parents`, and adding the life line "came over
  the water from <old village>"); sets the new island's far record to the old
  village's name with the name known (`farRec.n`, `farRec.kn=1`) and its lamp
  lit; adds one founding chronicle entry; starts a new clock anchor and era
  number. Everything it sets is a field `pack()` already carries. `live.js`
  shows "the island before this one" with links from `eras.json`: its saga,
  and its final island as a copy.
- **Seen.** One day the public island is new: four names you knew, a first
  fire, and on the horizon the lights of the place they left, which you can
  still open and read.
- **Save.** None. **Stream.** None (it uses no draw of its own; the new island
  runs its own seed's stream).
- **Checks.** `test/server.mjs` grows: run an era of four island days with
  the fake clock, cross it; `eras.json` has one row; the new island's seed is
  `farSeed` of the old and `farSeed` of the new is the old (#64); every
  founder name is in the new island and was in the old; the new island's
  `pack -> unpack -> pack` is byte-identical; its far record names the old
  village; the page test opens the new era and the archive link loads. Break:
  found the new island at a fresh random seed; the involution assertion
  fails.
- **Devon's eye.** Whether an ending every 90 days is a loss or a rhythm
  (question 1).
- **Needs.** C5, C6.

### 5.6 Optional increments, each needing a yes from Devon first

These accept input from the public. They add one internal port (8787, on the
container network only, never published on the host) and one proxy block on
the web server:

```nginx
limit_req_zone $http_cf_connecting_ip zone=hearth:1m rate=6r/m;
location /hearth-api/ {
  limit_req zone=hearth burst=6 nodelay;
  client_max_body_size 512k;
  proxy_pass http://hearth-live:8787/;
}
```

#### C8. Many watchers (optional; question 2)

- **Changes.** `server/api.mjs` on `node:http`: `POST /bless` with
  `{kind, x, y}`. Allowed kinds: `sapling`, `stone`, `story`, `lullaby`. Not
  allowed: springs (they change the map for good), rain, gusts, dreams.
  Limits: one blessing per address per 10 real minutes; 12 accepted per
  island day in total, at most 4 of them saplings; coordinates must be on the
  map and on the right kind of tile, checked against the server's island;
  bodies over 200 bytes refused; everything else gets a 429 or 400 and no
  detail. An accepted blessing is scheduled at a global step 90 real seconds
  ahead and appended to the current epoch's `events` list, which is also
  written to `events.json`; the server applies it at that step by calling the
  game's own function (`mkTree` and the sapling line, `skipStone`,
  `tellStory`, `lullaby`). `live.js` polls `events.json` every 20 s, applies
  each event at its step by the same calls, and refetches the epoch if it
  learns of an event too late. The page turns clicks back on for those four.
  Addresses are held in memory for the rate limit only and never written to
  disk.
- **Seen.** Someone somewhere plants a tree and it appears on everybody's
  island. The island's quiet account of its watcher (`faith`, `acts`) now has
  many watchers in it.
- **Save.** None. **Stream.** The public island's own, by design; no pinned
  island moves.
- **Checks.** `test/server.mjs`: the limits, one by one, each refused with
  the right status; an accepted sapling is in the island at the scheduled
  step and in `events`; a restart mid-epoch replays the events and reaches
  the same hash. `test/live.mjs`: two pages and the server agree on the hash
  at the boundary after a blessing. Break: apply the event on receipt instead
  of at its step; the two-page hash assertion fails.
- **Devon's eye.** Whether a shared island should be touchable at all.
- **Needs.** C5, and a yes.

#### C9. A gallery: keeping an island (optional; question 3)

- **Changes.** `server/api.mjs`: `POST /keep` with a save string (the same
  string as a share link) and an optional caption of up to 60 plain
  characters. The server does not trust it and does not store it as sent. It
  refuses over 400,000 characters; decodes it in a throwaway context with a
  5 s timeout; requires `canLoad`; runs `unpack` (C1 strips markup; the
  ladder migrates), steps one island day auditing for non-finite positions,
  and stores **its own re-pack** of the result under a random id in
  `/data/gallery/pending/`. Limits: 3 submissions per address per real day,
  20 pending in total, 300 kept in total, after which the oldest unpinned
  goes. **Nothing is public until approved.** `GET /admin?token=…` (a secret
  from the environment; not linked from anywhere) lists pending islands with
  village name, year, people, the caption and a link that opens each as a
  local copy; `POST /admin/approve` and `/admin/reject` move or delete. On
  approval the entry is written to `/public/gallery/<id>.json` and
  `gallery.json`. The offline game's chronicle panel gains "offer this island
  to the gallery", shown only over http or https, with one sentence saying a
  person looks at it first.
- **Seen.** Nothing public yet (C10 is the page). Devon sees a queue.
- **Save.** None. **Stream.** None.
- **Checks.** `test/server.mjs`: a good save lands in pending as a re-pack
  whose `pack -> unpack -> pack` is identical; a save over the size, a save
  that is not a save, a save that throws in `unpack`, a save with a `<` in a
  name (stored stripped), a fourth submission from one address, a
  twenty-first pending: each handled as specified; approval without the token
  refused; nothing under `/public/gallery/` before approval. Break: store the
  bytes as sent; the "stored stripped" case fails.
- **Devon's eye.** Whether he wants to approve things. If not, do not build
  this.
- **Needs.** C1, C3, and a yes. No accounts: a caption and an island, nothing
  about the person.

#### C10. The gallery page (optional)

- **Changes.** New `gallery.html` and `js/gallery.js`: reads
  `/hearth-live/gallery/gallery.json`, shows a card per kept island (village,
  year and its name, people, stones on the hill, caption, a small picture
  drawn by loading the save into the game's own `draw()` on a hidden canvas
  at zoom 1), newest first, 24 to a page; a card opens the island as a local
  copy. Past eras of the public island (C7) are listed at the top.
- **Seen.** A wall of islands other people grew.
- **Save.** None. **Stream.** None.
- **Checks.** A page test in `test/live.mjs`: three fixture entries render
  three cards with the right names; a card's link loads at the right day; an
  empty gallery shows one line and no error.
- **Devon's eye.** The page.
- **Needs.** C9.

#### C11. A neighbour that simulates (not in this arc; the seam only)

Written down so nobody builds it by accident and so the next arc starts with
the design. A second `vm` context on the server runs the far island at the
same pace. A crossing is a message at an epoch: when island A's boat leaves
for the far island it appears in B's next epoch as an arrival, and what B
sends back is one of `farReturn`'s four cargoes chosen from B's real state
(a real name for news, a real thing from B's `things`, a real song, a real
person). Epoch-aligned messages keep both islands replayable. The page gains
a second address. Cost: one more context, about 100 MB. It waits until the
public island has run an era.

---

## 6. What not to do

Traps this project has already paid for. Each has a reference.

- **Do not let drawing or sound touch `R()`,** or write anything the
  simulation reads. A0's "drawing is off the stream" check exists for this.
- **Do not let the simulation read presentation state** (`lookQ`, `animT`,
  `wetA`, tags, `hearth.liveSeen`, anything in `localStorage`). Sprint 16
  learned it with `hintsDone`.
- **Do not change a storage key.** `hearth.auto`, `hearth.snd`, `hearth.mus`,
  `hearth.hints` stay. The live page must never write `hearth.auto` (C4).
- **Do not reorder scripts, add `"use strict"`, or declare one top-level name
  in two files.** Do not use `//` comments on dense lines; sprint 12 commented
  out an `if` that way.
- **Do not pin a version with `===` in a check.** Write `>=`. Grep `rt.v !==`
  and `o.v !==` on any version move.
- **Do not test by scraping the log.** It keeps nine lines. Assert on state
  that lasts.
- **Do not believe a red check after a stream move until you have read #66,
  #67 and #71.** It is a question. And do not "fix" one by relaxing it:
  re-point it at the state the decision was made from.
- **Do not write a check that re-implements what it checks, or one that
  computes its bound from the constant under test.** Phase 3 shipped two that
  passed while broken. Watch each fail, and watch *which* assertion fails.
- **Do not add an `R()` call outside the condition that makes it matter**
  (#74). B4 is designed around this.
- **Do not trim the chronicle** (#815). The public island's answer to growth
  is eras, not deletion.
- **Do not redraw the faces** (#646); A8 changes how their choices are read,
  not one pixel of them, and has a check that says so.
- **Do not add a colour to a sprite frame that no script uses** without
  telling `budget.json`; the validator will fail, correctly.
- **Do not add a sound without a row in `twelve`,** and pin the sky clear
  before measuring; rain goes to the master bus.
- **Do not install a browser on the shared build machine,** and do not run two
  browser jobs at once.
- **Do not compare Node against `hashes.json` before C2,** and do not bump the
  pinned browser to make a hash agree.
- **Do not commit pictures, logs or server state.** Every file in the repo is
  a public URL. `look.mjs` writes outside the repo; the server writes outside
  the repo.
- **Do not publish a port, add a dependency, or add a build step for the
  server.** `node:http`, `node:fs`, `node:vm` and the game's own scripts.
- **Do not store what a visitor sent.** Store what the game made of it (C9).
- **Do not claim anything is live.** A merge reaches the site on the site's
  own schedule.

---

## 7. Questions that are Devon's to answer

Each has a default. A worker proceeds on the default; an answer changes
configuration or drops an increment, never a design already built.

1. **How fast does the public island live, and does it end?** Default: one
   island day per 20 real minutes, and an era of 90 real days after which the
   next island is founded on the old one's far island. Faster (5 or 10
   minutes a day) looks livelier and shortens the era to weeks; slower (an
   hour a day) lets one island last a year and is nearly still to watch. C4
   lets him look at three paces before choosing. `HEARTH_DAY_SECONDS` and
   `HEARTH_ERA_DAYS`.
   **Answered by Devon, 2026-11-13: "I think a 90 day era is good."** The era
   is settled at 90 real days. He did not speak to the pace, so 20 minutes a
   day stays the default until he has looked at C4.
2. **May visitors touch the public island?** Default: no at launch; it is
   watched, not played. C8 is designed and waits for a yes.
   **Answered by Devon, 2026-11-13, asked whether anything on the site should
   accept input from the public: "No at launch, we can consider it later."**
   C8 is not built in this arc.
3. **Is a gallery wanted, given that a person has to approve each island?**
   Default: not built until he says yes. Unmoderated public text on his own
   domain is not offered as an option.
   **Covered by the same answer as question 2: "No at launch, we can consider
   it later."** C9 and C10 are not built in this arc.
4. **How is the web container set up on the admin side?** The plan needs one
   extra container and one extra read-only mount (5.4). Default: the mount
   under the web root. If the web server is configured some other way, the
   `alias` block does the same job. This is the one thing the plan cannot see
   from the repo.
5. **Which island is the public one?** Default: seed 7, Fenstrand, the island
   on the board's card, known to stay healthy for 35 island years in
   `decade`.
6. **Is one re-pin for portable arithmetic acceptable (C2)?** Every existing
   island keeps its state and gets a different future. Default: yes, because
   it is what makes the public record true and it also makes one link grow
   the same island in every browser.
   **Answered by Devon, 2026-11-13: "yes".** C2 goes ahead.
7. **Does the art stay at one map pixel to one art pixel?** Default: yes. The
   alternative is redrawing everything at double size, which is a different
   arc and would discard the building sheet.
8. **Does sound stay synthesised, with no audio files?** Default: yes.
9. **Is a link to the public island wanted in the offline HUD and on the
   board?** Default: in Hearth's own HUD only (C5), and the board card is
   left alone.
10. **Lanterns at night and houses going dark as people sleep (A2):** these
    change how many lights the island shows at night, which is the picture on
    the board's card. Default: do it; the card is recaptured in A14.

---

## 8. Totals, order, and what can run side by side

**Totals.** Part A: 15 increments (A0 to A14). Part B: 5 (B1 to B5). Part C: 7
for the core (C1 to C7), plus 3 optional (C8 to C10) and one written down but
not planned (C11). 27 without the optional ones, and 27 is the arc: Devon's
answers of 2026-11-13 (section 7) leave C8 to C10 for later.

**Order within a lane is the order written.** Lanes touch different files and
can run at the same time, one worker each:

| Lane | Increments, in order | Files it owns |
| --- | --- | --- |
| Rig | A0 | `test/serve.mjs`, `test/look.mjs`, the three empty scripts, `index.html`, `test/load.mjs`, CI |
| Light | A1, A2, A5, A6, A7, B5, A14 | `js/look.js`, the sky and weather parts of `draw()`, `main.js` `frame()` |
| Ground | A3, A4 | `core.js` `paintTerrain()`, the tree block of `draw()` |
| People | A8, A9, B2 | `js/folk.js`, `drawFace`, `#tags` |
| Sheet | A10 | `tools/blender/`, `assets/sprites/`, the building block of `draw()` |
| Sound | A11, A12, A13 | `js/audio.js`, the `twelve` mode |
| Goods | B1 | `js/goods.js` |
| Stream | C1, C2, B3, B4 | `core.js`, `life.js`, `sim.js`, `watcher.js`, `save.js`, `test/hashes.json` |
| Server | C3, C4, C5, C6, C7 | `server/`, `live.html`, `js/live*.js`, `test/server.mjs`, `test/live.mjs` |

**Everything waits for A0.** After it, Light, Ground, Sound, Goods, Stream and
Server can all start. People starts after A1. Sheet starts after A2.

**Where lanes meet, and who goes first.** `render.js` `draw()` is edited by
Light, Ground, People and Sheet, in different blocks; each keeps to its block
and merges are small. A10 follows A2 because both rewrite the house block. A13
needs A9 and A12. B2 needs A8 and B1. B3 needs B1 and B2 and sits in the
Stream lane after C2. C3 needs C2. C4 needs A1 and C3. `test/unit.mjs` gains
sections 19 to 28, one per increment as numbered above; take the number given
here so two workers do not both write section 19. `hearth-ci.yml` is touched
by A0, C2, C4 and C6; one at a time.

**Only one lane may move the pinned hashes at a time,** and it is always the
Stream lane. If any other increment finds `pinned` red, it has a bug.

**A sensible first week:** A0 alone; then A1, A3, A11, B1, C1 with C2 side by
side; then A2, A4, A8, A12, B3, C3.

---

## Appendix: increment A0 for the worker who starts tomorrow

Everything needed is in section 2 and the A0 entry. The parts most likely to
be guessed at, stated outright:

- The page is driven through `window.__hearth` (defined at the bottom of
  `js/main.js`). The calls A0 needs all exist: `newWorld(seed)`, `step(dt)`,
  `draw()`, `setTime(t)`, `setWx(name)`, `setSnow(depth)`, `setZoom(z,x,y)`,
  `houses`, `dayCount`, `pack()`, `sheet` (wait for `sheet.ready`).
- A day is 140 sim-seconds: `dayLen` is 140, `dt` is .05, 2,800 steps. To set
  an hour: `setTime((Math.floor(time/140)+f)*140)`. Step to a day with a loop
  on `dayCount`.
- Weather names are `clear`, `overcast`, `rain`, `thunder`, `fog`, `snow`.
- Seasons are five days each, year 20: day 128 is summer, 133 autumn, 138
  winter, 143 spring.
- From `page.evaluate`, a top-level `function` in the game's scripts is a
  global and can be called by name (`showCard`, `paintTerrain`); top-level
  `let` and `const` state is not reachable except through `__hearth`. When a
  later increment needs one more value, add a getter (or a setter) to
  `window.__hearth` in `js/main.js`; that is what it is for.
- Pause the page's own loop by clicking `#b-pause` when its text is not `▶`,
  as `openIsland` in `harness.mjs` does; otherwise real frames step the
  island between your calls.
- The pack hash is FNV-1a over `JSON.stringify(pack())`, printed as
  `hex:length`; copy `packHash` from `harness.mjs` so the numbers compare.
- `harness.mjs` cannot be imported (it runs on import), so `look.mjs` carries
  its own 25 lines of page-opening code. That duplication is accepted.
- Launch Chromium with `--autoplay-policy=no-user-gesture-required`, as the
  harness does.
- The three new scripts go in `index.html` on the three lines after
  `<script src="js/render.js"></script>`, and in `ORDER` in `test/load.mjs`
  after `'js/render.js'`. Each file starts with the two-line header the other
  scripts have and nothing else.
- Unit sections run in the order written in `test/unit.mjs`; add section 19
  at the end. It reads files as text with `node:fs`; it does not need
  `loadHearth()`.
- Done means: the gate green including the new `node look.mjs`, both breaks
  watched and reported with their messages, the 16 "before" pictures written
  somewhere outside the repo and their location reported, and the timing
  table pasted into the hand-back.
