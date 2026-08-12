# Golden Hour — session notes

## What changed

The big one. Devon asked for the piece to grow into somewhere worth hours, with
more wildlife, more to see, more to do, and confirmed four directions that
override two locked decisions. Both overrides are recorded here on purpose.

**Override 1: the sun sets now.** The old decision said full night breaks the
palette. The palette got rebuilt instead: the two frozen keyframes in main.js
became six (5.6, 1.1, 0, -3, -7, -12 degrees), same single-writer
setSunElevation, same guarantee fog can never drift from light. The original
480 s opening act is untouched and the sun still resets to 5.6 on every fresh
visit, which was the part of the old decision worth keeping. Full night arrives
after about 26 minutes of walking time, or about a quarter of that sitting at
the campfire, where time runs 6x. Night holds; it does not loop. The Sky shader
goes black almost immediately below the horizon, so the shader's sun descends
on a slowed power curve (-12 true reads as -3.6) while the lighting uses the
true elevation. Screenshot-verified at every stop; the linear version of that
remap read as a sunset that never ends and no remap read as a black frame.

**Override 2: there is a save, narrowly.** journal.js adopts the shared
gvb-save module for discoveries only: species honestly watched (about 2 s near
screen centre), shells examined, places reached. Sun position and player
position are pointedly absent from the schema. The notebook (J) renders found
entries in ink and unfound ones as pencil-outline hints.

New files: js/skynight.js (3,000 seeded stars, canvas Milky Way, canvas moon
with its own arc, pooled meteors), js/campfire.js, js/interact.js (one verb
system: hint pill plus E, tap on touch), js/stones.js (skipping), js/shells.js
(40 fixed finds, 4 procedural kinds, 11 names), js/journal.js and
js/journal-core.js (pure), js/regions.js, js/lighthouse.js, js/pier.js,
js/events.js (bait ball, whale spout, moon jellies, meteor shower),
js/sandcastle.js, and eight creature modules under js/creatures/.

The world grew 10x on one decision: the shoreline is a curve, shorelineZ(x),
and everything works in shore distance s = z - shorelineZ(x). Inside the
original beach the heightfield reduces bit-identically to the old formula and
twelve golden heights in smoke.mjs hold it there. field.js gained shorelineZ,
seabedSlope, regionAt, regionWeights, walkLimits, trailX, riverX, PIER,
onPier, pierDeckY, CAVE, and the region features: the headland (18 m, cliff
face west, climbable flank east, pool shelf at the base, cave scooped in),
the dune trail, the estuary notch, the river channel, the pier deck (the deck
IS ground inside its rectangle, that is the whole mechanism). terrain.js is 54
static 100 m chunks at three densities with analytic normals (per-chunk
computeVertexNormals draws a lighting seam at every border; the heightfield
gradient is identical from both sides). ocean.js runs 16 per-chunk foam strips,
only those within 260 m of the camera re-deforming. controls.js replaced the
rectangle clamp with walkLimits plus two rules: a stride rising over 0.9 m is
refused (that one line is every cliff and wall in the piece), and a move whose
destination column would yank z is refused (that is the pier's edges).

Wildlife: the original quartet stays in wildlife.js untouched; everything new
is a registry entity with { group, home, update(dt, ctx) }, skipped when its
home is 300 m beyond its radius from the walker. Gulls land for crumbs (the
first real state machine). Sanderlings are driven off ctx.swashLevel, the same
number the water breathes on. Audio grew peep, croak, bark, squabble, curlew
(deliberately not in the journal; a cry with no bird attached is the point),
crickets, owl, fire crackle, plink, thud, wood footsteps with a hollow thump,
a cave ConvolverNode fed 1.4 s of generated decaying noise, and a master
lowpass that closes as a wade nears knee depth. Zero audio files, zero new
asset bytes anywhere, zero offsite requests.

Byte counts: no assets added. Source grew from about 1,900 to about 5,600
hand-written lines across 27 modules.

## What I verified

- node test/smoke.mjs: 93 checks, 0 failed (was 38). New groups: golden
  heights (worst drift 0.0e+0), the coast (curvature cap 0.364 m/m worst,
  cliff steepest 1.27 m/m, flank 0.47), pools and trail, river/pier/cave,
  stones, shells, journal round-trips including a wrong-game save refused.
- Six standalone playwright-core runs against real Chromium (software GL, so
  locked decision #53 applies to every timing number): the full sun scrub
  screenshotted at 6 stops with zero page errors; seated/standing time ratio
  6.3x (absolute rates are sandbox-compressed); all 12 verb assertions (pick
  up, wind up, throw, examine, name shown, set back, crumbs, sit); journal
  survives reload while sunT resets to 0.9; all seven place cards; a 50 s
  W-hold down the pier stopping at exactly z = -18.0; the step rule stalling
  a 9 s cliff walk at z = -32.6 while the flank walk reached -3.5; sanderling,
  seal, starfish, shanny, owl, bat, heron, cormorant, whale and jelly all
  recorded through the sighting system; bait ball and whale forced through the
  debug hook; photo mode hiding and restoring chrome.
- renderer.info at the widest home view: 157 draw calls, 316k triangles
  (was about 30 calls before the expansion; budget was 300).
- One real bug found by a test that then had to be fixed itself: an async
  waitForFunction returns a Promise, which is truthy, so three assertions
  passed vacuously. Rewritten to Node-side polling of a new __gh.journal()
  hook. The vacuous version had hidden a real defect (pool sightings tracked
  pool one's starfish while you crouched at pool three).

## Shared-file requests

1. Claude Prompts/08-golden-hour.md: the "sun never sets" framing and the
   "keep not having a save" paragraph are both overridden by Devon this
   session, in the narrow forms above (opening frame still resets; only
   discoveries persist). The prompt text should say so.
2. assets/js/gvb-save.js line 32, the "Adopted by" comment: add Golden Hour.
3. Tools/board-check/play-games.mjs, when its owner next touches it, can lean
   on the new debug hook (?debug exposes window.__gh: setSunT which also syncs
   the moon, teleport, face, pos, journal, events, info). Suggested beats:
   scrub to 1560 and assert star opacity plus a journal DOM entry; teleport to
   the headland and assert the place card; throw a stone and assert the hint
   cycle; reload and assert the journal survived while sunT reset. All
   assertions can go against the DOM or __gh.journal(), per locked decision
   #39's split.

## Deliberately not done

- The original quartet (dolphin, gulls, boat, jet) was not migrated into
  js/creatures/. It is tuned, tested, and lives fine where it is; a mechanical
  move risks regressions for zero player-visible gain. The registry pattern is
  established for everything new.
- The curlew is not a journal species. Not everything should be collectable.
- No chunk LOD swapping. Measured first: 157 calls and 316k triangles at the
  worst view is nothing, and frustum culling already drops distant chunks.
- No estuary-specific soundscape bus beyond the curlew timer. The reeds and
  distance already quiet the surf; a dedicated layer can wait for ears-on
  tuning.
- The whale has no fluke. Two sprites and restraint.

## Next session

1. A real hour on the beach, ears on, tuning pass: event pacing (bait ball
   every 10 to 18 min, whale about 20, both guesses until someone sits through
   them), sanderling flush distance, cricket density, night palette banding on
   a real monitor.
2. The still-open real low-end-GPU run from the last backlog, now genuinely
   urgent: the world is 10x bigger and the proxy numbers above are software
   rasterization, not a weak real GPU.
3. Preview recapture (npm run previews) and a board card refresh for the
   description: it undersells the piece by about six features now. Board text
   is prompt 22's file.
4. Touch playtest on a real phone: the pill-as-throw-control needs a thumb on
   glass, not a mouse pretending.
5. If night proves popular: the owl could hunt (one swoop over the dunes, no
   kill shown), and the fireflies could drift toward the fire when it burns.
