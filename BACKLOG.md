# BACKLOG

The single entry point for open work on greyversusblue.com. Two tiers: a
ranked index you scan, and the ideas underneath it that have no other home.

**`ARCHIVE.md` is the third file.** `HISTORY.md` records what shipped; this
file ranks what is open; `ARCHIVE.md` holds work that will not be done. The
five teaching tools went there on 2026-09-08 (#206). Do not move anything back
without Devon saying so.

## How this repo is worked

**The standing instruction is: "work the next batch of ranked items in `BACKLOG.md`, open a
PR, merge to `main`."** It runs unattended — Devon is not reviewing these rounds (2026-09-05)
— so three rules follow, and they override any older wording in this file.

**The prompt a session is started with** (#382, kept here so it and these rules cannot drift
apart; edit both together):

```
Work the next batch of ranked items in BACKLOG.md. Claim your rows on main first
(#283). Size the batch by the table in "How this repo is worked" — it has two axes
now, Size and how many areas the batch spans.

Prefer rows whose Model column matches the model this session is running. Take a
mismatched row anyway rather than skipping down the list, and say in the PR body
which rows you took and which model you actually worked under.
Match by #638: Fable 5.1 and Opus 5 rows run on Opus 5.5, Sonnet 5 rows on Sonnet 5.

If a row needs hardware this machine does not have — a real GPU, a phone, a pair of
ears — move it to Parked with its context and take the next row, so the batch still
lands real work. Do not write a report about it instead. A row whose Gate is
`blender` is the exception (#642): if `blender --version` fails here, leave it
where it is, unclaimed, and take the next row.

One PR for the whole batch. Merge to main when CI is green, then update BACKLOG.md's
header, ranks and Claimed column, and write your decisions into HISTORY.md, before
you finish. A merged PR is not the end of the session.

Break any guard-rail you added on purpose once, from a green baseline, and say which
assertion failed and what it said (#34).

End your last message with a handoff prompt for the next session, in one fenced
block, as CLAUDE.md's definition of done item 7 describes (#600).
```

**1. Never stop to ask.** If a row needs a judgement call, make it: decide, ship, and record
the call and its reasoning in `HISTORY.md` as a locked decision, so it can be reversed
cheaply. That is what the "Questions for Devon" section below already says to do with an
*answered* question; the change is that a session may answer one itself rather than wait. A
question there **no longer blocks its work.** Devon still intends to work through that list
himself, so do not pre-answer questions you did not need — only the one actually standing in
front of the row you are on, and then write down what you decided and why.

**2. Do not park work on a person.** A row only a human at a real device or a live deployment
can do does not belong in the ranked table. Move it to a parked list with its context intact
and renumber; parking is not the same as verifying, and the note should say which it is.

**3. Size the batch by the Size column and by how many areas it spans** (#382,
2026-09-13). The second axis is the new one. Four ¼ rows across four projects is four
contexts, four suites and four closeouts; two ½ rows inside one project is one of each. The
cost that scales with a batch is the closeout, not the code.

| Size | Same area | Spanning areas |
|---|---|---|
| ¼ | up to **6** | **4** |
| ½ | **3** | **2** |
| 2+ | **that row is the whole batch** | never pair it with anything |

**Why the same-area column is bigger.** CI is the bottleneck, not the model: Site CI runs in
about 60 s and only Daredevil's suite is slow at 11.5 min, so rows-per-PR is nearly free. The
measured work in a nominal one-session batch is about 800 lines — PR #284 took four ¼ rows and
inserted 839, PR #282 took two ½ rows and inserted 771 — against single PRs in this repo that
merged green at 1,264 (#278), 1,570 (#280) and 4,608 (#236, nine hand-written files). Capacity
is not what the old caps were protecting. What the record actually shows going wrong is
closeout: two line-of-sight checks that passed while doing nothing, Absalom's stride sweep
passing against a deliberately inverted planner, two sessions building Daredevil Phase 4 in
full, and PR #284 itself merging with three of its own shipped rows still in the ranked table
(#381). So the cap rises where the closeout is shared and holds where it is not.

**Whatever the batch, it merges to `main` as one PR** — every row in the batch, in a single
pull request, never one PR per row (changed 2026-09-12; before that a session sometimes opened
a separate PR per row in the same batch).

**A 2+ row will not finish in one session, and that is expected.** Do one increment, ship it,
and **leave the row in place** with its Item text rewritten to say what is done and what is
left. Do not delete a 2+ row until it is actually finished. Stalling on one and swallowing one
whole are both worse than an honest increment. Do not mix sizes to fill a quota: a 2+ row will
absorb whatever time the others leave and finish neither well.

**Respect the Model column when you batch.** Where an item's own source names a model it is
carried across unchanged; every ranked row's model was assigned in Tier 1 on 2026-09-13
(#380), because no ranked row's source named one. Rows naming different models are still one
batch if the sizes allow, but say in the PR body which rows you took and under which model you
actually worked. Under #638 a row naming Fable 5.1 or Opus 5 runs on Opus 5.5 and
a row naming Sonnet 5 runs on Sonnet 5; the cell keeps its name.

**Update `BACKLOG.md` as soon as your one PR merges — never leave it for a later session.**
This is the rule most likely to be dropped as batches grow. Its casualty is on record in the
sibling repo (`GreyVersusBlue/AI_Tools`): a session batched two phases, saved both backlog
rewrites for the end, and its first PR merged with the row still in the ranked table — the
next session spent about an hour rebuilding something that already existed.

**4. Blender rows rank first, and a session that cannot run Blender skips them in place**
(#642, #644, 2026-09-25). Devon made Blender-made assets the top priority. Blender runs only on
his local Windows machine, headless, as `blender -b -P script.py`, and never in a cloud
container. So a row whose `Gate` reads `blender` is not parked under rule 2: it stays ranked,
and a session without `blender` on PATH takes the next row down. Check with `blender --version`
before claiming. The GLTFLoader and wiring rows between them carry no gate and are cloud work
(#645).

The two things that are still not a session's call, because they change what the work *is*
rather than how it is built: **re-ranking the list wholesale**, and **overruling the Ownership
table** in Tier 2. The one exception so far is #642, which Devon made himself: every Blender
row ranks above every other row.

## Where things stand — start here

**The site is at version 16** (`index.html:584`, and `landing.html:849,870`).
**The last batch of ranked work that shipped** is **The Fourth Quarter's
GLTFLoader, r160 with BufferGeometryUtils and a loader test (PR #422)**:
rank 12, a ¼ naming Opus 5.5, worked under Opus 5.5 (#638), claimed in
PR #421. Its row is gone and the rows below it moved up one. That is the
line to update when your batch merges; a PR that only changes these files
is not a batch and does not belong in it.
**57 ranked items remain**, and **every one of them names a model.**

**Blender rows lead the list, and they need Devon's machine** (#642,
2026-09-25, Devon's instruction and his re-rank). Ranks 1 to 44 are
Blender-made assets: a pipeline per project, then its GLTFLoader where it has
none, then its packs, then the rows that wire each pack into the game, with
the site's dioramas last. **Blender runs only on Devon's local Windows machine,
headless (`blender -b -P script.py`), never in a cloud container.** The table's
`Gate` column says which rows need it (#644): **29 rows read `blender`**, and a
session without `blender` on PATH skips each of them where it stands and takes
the next row, without parking it. The other 15 in the block (every
GLTFLoader row and every wiring row) are cloud work, because they read
committed files (#645); a wiring row is taken only once the pack row above it
has merged. The plan every Blender row shares is
[Blender assets: the common plan](#blender-assets-the-common-plan).

**On Devon's machine, take rank 1** (Golden Hour's pipeline, a ½ naming Opus
5.5, gate `blender`); ranks 2 and 4 are Blender-gated too, rank 3 waits on
rank 2, and the new rank 5 (Blue Hour's animal pack) is Blender-gated as
well, with the new rank 6 waiting on it. **In a cloud session, take rank 15
alone** (Aphelion's GLTFLoader at r160, a ¼ with no gate and no
dependency), which is the first row with no gate that does not wait on an
unmerged row. The old
ranks 1 to 7, now 45 to 51, still want a real GPU, a real phone or a person
listening for an hour, and their `Gate` cell says which.

The ranks in this header are the new ones. What shipped, and what it means
for the next session:

**Signal City is on the board's checks and has a preview** (#649, #650,
PR #413). `npm run games signal-city` plays First Light with a real `2` key
and reads the Signal line at 20 s; the cleared count waits for the first
car, which leaves the map 20.9 to 48.3 s in, never by 20 s. The preview is
Rush Hour at dusk mid-surge, captured on Windows, and Rush Hour's dusk is a
`light` field on the level now (#585 folded in). **Worth carrying
forward**: a row's number for a DOM beat is worth checking against the sim
before the recipe is written, since "cleared at 20 s" could not pass on any
seed.

**Endless starts on the district's third day, and the hand holds on five
seeds** (#648, PR #409). R1's hand in `--endless` first misses on about the
same day as no input (11, 12, 10, 11, 6, 10 against 11, 12, 11, 11, 2, 10):
choosing phases box by box does not raise a district's capacity, and the
target climbs to it. Day one is three boxes and 36 now; an event a day ships
off, because a surge box-blocked the hand on day 4. `test/endless.mjs`
holds N = 0 on five seeds of six over the first six days, and Site CI's
Signal City entry takes 14 minutes (`timeout: 30`). **Worth carrying
forward**: a scratch copy of a project for a break needs the shared
`assets/js/gvb-save.js` beside it, or the break dies of
`ERR_MODULE_NOT_FOUND`; and a rule's seed count is worth checking against
the lever it is meant to reject, since four of six passed the events.

**Rush Hour is Signal City's one hard level** (#641, PR #405): one
collision ends the run there. R1's hand collides on School Run, Main Street
and Two Blocks and runs Rush Hour clean on six seeds, and Rush Hour's one
crash (the corridor's left arrow into a through car still in the box) is
gone at 2.5 s of all-red. **Worth carrying forward**: the long calibration
runs die with the session that started them, so write each to a file and
check the file, not the task.

**Signal City's second star is the lesson on the four levels with a
default** (#639, #640, PR #403): Rush Hour the ambulance on its corridor,
Main Street no split, Two Blocks (now shipped on one clock) the platoon
through the second box, School Run no walk call over 40 s. `test/stars.mjs`
fails any starred level that no input three-stars. **Worth carrying
forward**: a hold restarts a rule's clock, so a cap checked only at the
clock's end caps nothing; and the reference hand three-stars School Run on
0 of 6, which R3 has to face before it picks School Run for hard mode.

**Signal City's calibration tool plays every level with no input and with a
reference hand** (#636, #637, PR #399). `node tools/calibrate.mjs all
--baseline --hand` prints both tables and the hand against no input;
`--hand=phases` and the like play only the parts named. The hand beats no
input on five levels and not on Two Blocks (the shipped offset is already
the best), Rush Hour, Main Street or Free Play, where the corridor and the
held procession cost the board. That is R2's evidence. **Worth carrying
forward**: a queue-greedy hand that counts cars starves a lone left (Four
Ways locked 4 of 6); weigh the queue by its waiting. And the sim runs 5 to
17 s a level in a cloud container, so the full two tables are about 25
minutes, not one.

**Above the fog line the silence stills the wind and the snap is a stone**
(#635, PR #397). Birdsong already ended at altT 0.6, so the silence beat was
spending itself on nothing up there; `field.js` owns the band (`summitAir`)
and the threshold (`STILL_AIR`, `summitKind`) now, and the birds and both
beats read it. **Worth carrying forward**: a detail string that formats a
value the break removes takes the whole suite down with a TypeError before
the count prints; format defensively so the line fails instead. And a break
that makes one kind fire everywhere can leave the state another line reads
already changed (the wind was still before the bench read it), so name the
collateral line as well as the target.

**The owl hunts, fireflies drift to the fire, and Blue Hour's phantom steps
lean toward the valley** (#633, #634, PR #395). Rank 5's "if night proves
popular" was read as a priority gate, not a question for Devon, because
building it changes nothing about what the page is; #628 still governs
conditions that do. Both Golden Hour movers are pure clocks in
`js/creatures/nightpaths.js` and the `?debug` hook has `owlHunt(p)` and
`owl()`. Blue Hour's `downhillAt` is `fallLine` in `field.js`, which also moved
the eyes' drift and the shape's head-flip; session 6's tripwire now fails if
the pan goes back to zero. **Worth carrying forward**: pgrep for a script name
matches the shell loop waiting on it, so `until ! pgrep -f browser.mjs` never
ends; wait on a line in the log instead. Running breaks in a `git worktree`
copy keeps the branch clean and lets two browser suites run at once under
separate `xvfb-run -a` displays, at the cost of real-time beats wobbling
further (#53).

**Golden Hour's `?debug` hook has twelve beats in `play-games.mjs`, Blue Hour
is on the board, and both previews are new drafts** (#630 to #632, PR #392).
This container has no display, so every headed run went through `xvfb-run`,
and `Tools/board-check/README.md` now says how and what each kind of result
means there. Scrub-and-read beats are trustworthy under it; six to eight of
Golden Hour's real-time beats fail from run to run, as on `main`, and are #53's
to settle on a real GPU. `assets/previews/{golden-hour,blue-hour}.jpg` and
their og cards are SwiftShader captures, promoted as drafts; the real-hardware
pass (rank 1) recaptures them. **Worth carrying forward**: engaging pointer
lock under Xvfb can throw the camera about 1.45 rad of yaw and 0.88 of pitch,
which sent the first Blue Hour capture into the sky and a thrown stone up the
beach; put the view back yourself after the lock engages. A guard-rail's floor
wants a break that removes part of the thing, not all of it: Blue Hour's `> 10`
meshes stayed green with the scene's direct meshes dropped.

**Aphelion's touch/gamepad row went to Q40, not to a build** (#629, PR #389).
Whether Aphelion ever runs on a tablet or phone is Devon's decision, the same
shape as Q39 (#628). Round 1's arrow-key look had already closed the one gap
the audit found, so no smaller honest piece was left. `Projects/aphelion/test/
desktop-input.mjs` (9, in Site CI) fails on a touch or non-lock pointer event,
a gamepad read, a coarse-pointer query, `touch-action`, device orientation, a
second vendored lib, a file named for the scheme or a changed viewport. **Worth
carrying forward**: 28 breaks from green, one per spelling (listener, `on*`
property, a name in an array, inline `<script>`, CSS, a new file); and break
the check's own walk too, since losing `index.html` first crashed the suite
after its assertion printed instead of reporting.

**Pathfinder's living-sheet row went to Q39, not to a build** (#628, PR #386).
Whether `characters.html` becomes an editable character sheet is Devon's
decision, and no test can see a decision. So nothing was built, the row was
retired to Q39, and `Pathfinder/tests/showcase.test.mjs` (10, in Site CI)
fails when either Pathfinder page gains browser storage, `gvb-save.js`, an
editable field or a script from a file. **Worth carrying forward**: #626 fits
a condition that shows up in the code, and #628 fits one only a person can
settle. Break a regex guard-rail with each spelling the feature could take:
the first static-import pattern only matched at a line start, and a
`gvb-save.js` import on the `<script>` line walked past it.

**Pathfinder's conditional rows are checks now, and the dossier template is
built** (#626, #627, PR #383). Neither condition held: the Anathema page had
not changed since its suite, and the chronicle views agreed on all 44 rows.
So `anathema.test.mjs` (33 to 37) lists the page's 47 input entry points and
fails on a new one, and `tests/chronicle.test.mjs` (15, in Site CI) fails
when the By Character and Chronological views drift. `characters.html` has a
commented-out dossier `<template>`, held to the nine dossiers by
`tests/dossier-template.test.mjs` (10, in Site CI). **Worth carrying
forward**: a conditional row whose condition does not hold ships the check
that fails when it does, not the feature (#626); and commit before you break
a guard-rail, since `git checkout` to restore the page also restores away
your uncommitted work.

**Bell to Bell's props weigh 1.1 MB of mesh, not 3.8, and the asset pipeline
row is retired** (#624, #625, PR #380). The recipe `bell-to-bell-props`
rewrote the eleven props and the picture frame, a `.gltf` and a `.bin` each,
as twelve meshopt `.glb` files that name the same loose JPEGs by the same
relative paths, so the texture recipe and its `--check` keep reading files.
Referenced bytes 16.2 MB to 13.4 MB; across the three increments Bell to Bell
went from 62.1 MB referenced to 13.4. `tests/props.mjs` (100, in Site CI)
holds each prop, loaded raw through the game's own loader, to its original's
per-material vertex and UV bounds, images and texture slots. **Worth carrying
forward**: GLTFLoader loads a prop with a missing JPEG untextured rather than
failing, so the check that catches it is the filled-slots one; `node
assets.mjs` had never run its report on Windows until this PR; and a `git
worktree` under the long scratchpad path pushes deep asset files past 260
characters, which a local server answers with 404s.

**Bell to Bell's textures weigh 8.9 MB, not 31.1, and Fourth Quarter's 2k
tier 23.0 MB, not 69.2** (#621 to #623, PR #377). Two texture recipes in
`asset-pipeline.mjs`, reading the Poly Haven downloads from git with sharp
0.35.4: Bell to Bell's six hand-sized props at 512 as `*_512.jpg`, every
other map re-encoded at q88 at its size, one set and no tier picker (#621);
Fourth Quarter's 2k re-encoded, its 1k the same recipe byte for byte, and
`tools/make-textures.mjs` retired (#622). Bell to Bell's referenced bytes
38.4 MB to 16.2 MB. `--check` holds each committed texture to its RMSE
against the original and against the recipe's own encode, and CI holds each
file's width to the tier its name claims (#623). Before/after renders differ
by 0.40 to 1.20 RMSE per pixel. **Worth carrying forward**: a packed arm map
is data, not colour, and 4:2:0 put the clipboard's metalness at 13.0 RMSE at
512; and an absolute error ceiling let q60 through where a slack against
the recipe's own encode catches q80.

**Bell to Bell's students weigh 1.6 MB, not 25.3** (#619, #620, PR #371).
`Tools/board-check/asset-pipeline.mjs` is the site's one offline asset
pipeline, dev-only, reading its originals from git at a named commit, and
exiting 1 on any output not smaller raw than its source gzipped. Its first
recipe rewrote the eight outfits as meshopt `.glb` with the Idle clip only;
the 24.8 KB decoder is vendored in the project's own `libs/`. Referenced
bytes 62.1 MB to 38.4 MB. `tests/characters.mjs` (59, in Site CI) holds
each student to 1 mm of the original through the game's own loader; worst
drift 0.3 mm. The same PR fixed two races in Integer Foundry's browser
suite that had failed Site CI on main and on the PR. **Worth carrying
forward**: `poseIdle()` ends in the rest pose whatever clip it samples (a
pre-existing Bell to Bell bug, in its WISHLIST.md), which a per-pose check
cannot see, so the suite samples the clip separately. And in r160
`getVertexPosition` already skins a SkinnedMesh; skinning it again passes
on originals and reads 1.1 m wrong on quantized files.

**Signal City has a sandbox, and M9 is done** (#614 to #618, PR #373).
Free Play's card has a district row: one box, which is Free Play itself
and runs as it always did, or a generated grid of 2 to 12 boxes on a city
the player rerolls, with Free Play's drivers, five minutes and two
ambulances, no target, nothing saved. The ambulances move to the first
box that spawns on their leg, and a banner names the box. **Worth carrying
forward**: a check that asks the helper under test whether the helper was
right stays green when the helper breaks; ask the World instead. And pick
the fixture that exercises the rule: the suite's first city put the
ambulance on box 1's own leg, where a banner hard-wired to Box 1 passed.
The priority corridor is one box's (WISHLIST.md known gaps): not a row yet.

**Signal City has endless** (#608 to #613, PR #367). A card after the
levels, open on a star from Two Blocks. Day n of a city is
`dayLevel(seed, n)`: n boxes (12 at most), demand 10% up a day, 180 s, a
target of 20 plus 8 a day with no cap. A lock or a missed target ends
the run; collisions cost points. Every old box keeps its rules and timing
overnight. The best is `endless` in the save through `repair`,
`signal_city_v1` unchanged. **Worth carrying forward**: the first target
design (a share of each city's own demand) died on the calibration, since
a district clears a flat 50 to 130 cars a day whatever its traffic and at
21 days' traffic nothing locks. Calibrate before writing the rule a number
feeds. `test/endless.mjs` is new (39) and in Site CI; browser 209. The
merge renumbered the decisions: this PR had #607 to #612 until Blue Hour
took #607 while it was open.

**Blue Hour has a peak** (#607, PR #366). The profile held 65 m flat past
the trail's end and the ridge noise put a ridge 40 m from the trail's end
at 71.3 m and the ground 20 m behind the tower at 70.5 m: the walk ended in
a dip. `summitCap` in `field.js` is a ceiling centred on the tower, gentle
along the spur the last leg climbs and steep across it and behind,
smooth-minned into `mountainH` so it only removes ground, and faded out
below z -50. Nothing within 100 m out-tops the trail's end now, and the far
side falls to 54.4 m 40 m past the tower. No trail height, bench or tower
moved. `test/smoke.mjs` 107 → **109**; `test/browser.mjs` holds the summit's
luminance at all four facings now, 95/95. **Worth carrying forward**: a
round cone was ruled out by arithmetic before it was tried (the last leg
drops 1.4 m in 34 m), and one number in the new test comment was written
before its break and was wrong. Write the comment after the break.

**Signal City has a grid** (#601 to #606, PR #362). `growCells(seed,
count)` grows a 4 by 3 district a box at a time, one lane everywhere, Ts
facing out and rings at 0.2, and the first n boxes of a seed never change
as n grows. `network.cells` joins neighbours north-south as well as
east-west. Two box-one bugs went with it: the crossing cache (#602) and
the tourist's wrong turn (#603). No card yet: the debug hook runs it, and
every existing level hashes as before. `test/grid.mjs` is new and in
Site CI.

**Signal City has a roundabout** (#594 to #599, PR #358). A ring node
(`roundabout: true`): one lane, anticlockwise on the screen, splitter
islands and yield lines, every entry yielding to the ring and the node's
controller dark with every command refused. The shop sells it at 6 after
Rush Hour for First Light, the Stem and Free Play, each scored on its own
`ring` calibration, and the owned item's button switches it off for the
session. Nothing new is stored. Every signalled level hashes the same as
before it on seed 3.

**Signal City has a campaign** (#588 to #593, PR #355). The eight starred
levels run in pack order, each shut until the one before it has a star; a
save from before M8 keeps every level it has played. Stars buy protected
turns (3), extra phases (4) and sensors (5) into `save.unlocks`. The stars
to spend are worked out from the save, and `signal_city_v1` did not change.
Bought phases go after the level's own and nothing but a press or a rule
that names one ever runs them, so owning one changes nothing until it is
used: Rush Hour with all three bought runs the same 65 cleared and 24
changes. `test/campaign.mjs` is new and in Site CI.

**Signal City shows what is changing what** (#577 to #587, PR #352). Every
change of signal names its cause on the Signal line (you, a rule and why it
fired, the plan, the offset, the corridor, the outage, flash mode), read from
a new read-only `Controller.cause`; a 60 s strip colours each run by it; lanes
that may go are washed green; phase cards draw their movements; the panel is
tabs opening on each level's lesson. The board has pavement, rooftops, trees,
brake lamps and indicators (read-only `Car.braking`, `Car.indicator`), dusk
on Rush Hour and night in the outage, on a ground canvas under the board that
is drawn once per camera. **Frames got cheaper**: 22 ms against 27 on Rush
Hour at 115 s. A cached layer on the same canvas had cost 54, because the blit
and a full-board tint are 16 ms together under a software Chromium (#584).
**Read before M8**: #579 (nothing about the panel is saved) and #585 (dusk is
a level-id set in render.js; move it to the level data if the campaign wants a
time of day per level).

**Orbital has a committed browser layer, and it is in CI** (#528 to #530).
`Projects/orbital/test/browser.mjs`, 48 checks in 41 s, borrowing
`Tools/board-check/harness.mjs`: the sector grid's render, both of
`buildGrid()`'s unlock clauses, the star display, one live flight from the aim
to the save, reset, and the wipe confirm answered both ways. **The number worth
carrying forward is 6** (#528): Orbital's rAF loop runs at 6 to 7 frames a
second under a software-rendered Chromium, against 51 on a page that draws
nothing, because the canvas draw is the bottleneck and not the compositor. A
shot costs about ten wall-clock seconds per sim-second there, so the suite flies
one, and the shortest winning one rather than what `findWinningShot` returns for
First Light (634 frames, 105 s). Locked decision #53 does not reach the file
because nothing in it is timed. **Two things a later session should read before
adding a beat**: a section that throws now costs its own checks and no others
(#529), after the first deliberate break lost twelve unrelated ones to an abort;
and the plan-vs-flight assertion has to be the clock and not the endpoint
(#530), because launching at 0.9x `MAXSPEED` still wins on an empty field and
the break ran green from 46/46. Rank 17's rotate-to-play gate is still a real
device's job and is untouched.

**A sink says what an order costs** (#531, #532). The tile-cost row was a design
question and the arithmetic answered it: on the opening board the order and its
cost are the same number (the floor reaches 47 and 47 costs 46 fabricators), and
buying `×2` takes them apart completely — all 201 three-digit orders cost 7 to
14 tiles, 100 is a shorter line than 47, and 231 is twelve. Every sink cell
carries the count under the order now, `12 tiles` at 48 px and `12t` below it,
with the sink's mark shrunk so three rows fit a 36 px phone cell. The cost line
is not just a tooltip because a tooltip is nothing on a touchscreen.
`test/smoke-targets.mjs` 104 → **109**; `test/browser.mjs` 57 → **68**.
**The racy `place()` the last session left open is fixed** (#532): it reads the
cell back and places again, which is the half of #353's race that `click()`'s
throw-retry never covered. Nothing is open against that file now.

**Blue Hour's trail sits on the hillside** (#523 to #527). The hill's climb
was a ramp in z and the trail's height is analytic in arc length, so above
t 0.5 the bench stood proud of the hill on both sides, 10.9 m at t 0.90; the
hill's climb is the trail's own height profile read by z now, and the worst
spot on the whole trail is **2.1 m** above both shoulders, from the noise. The
trail itself did not move, so nothing keyed to `altT` or the grade changed.
**The hill holds flat past the summit** (#524), chosen by measuring the bench
frame at four facings under three heightfields rather than by taste: the
ramp's own summit read 9.1/255 with the walker's back to the tower, which the
suite had never looked at. Merrit's page moved 30 cm (#525). `test/smoke.mjs`
104 → **107**. The browser suite's steam beat frames its box off a new
`__bh.project` door and reads it before the burst as well as after (#527),
because aimed at the cab it read the glass sheen at 80/255 with no steam
drawn at all. **Worth carrying forward** (#526): the first draft of the
profile assertion's comment claimed it proved the systematic term gone, and
putting the ramp back left it green — the profile was still right and merely
unused. The mean-over-the-top-half claim is what catches that, and the
comment says so now.

**Golden Hour's tide is a real axis** (#516 to #522). The sea had one vertical
axis, a 9.5 s slap of 0.32 m, and a waterline that sat between z = -7.9 and
z = -3.6 for the whole visit; it swings from **-9.7 to -0.4** now, 9.3 m
against 4.3. Everything downstream already read a water *level* rather than a
position, so the change is one slow term in `field.js` and one line each in
eight other files. **The tide does not stop when the sun does** (#516): the
descent holds at `SUN_TOTAL` because a palette has a bottom, the sea has no
bottom, and the tide is the moon's. **t = 0 is mid-tide falling**, so a fresh
visit opens on the shipped frame to the millimetre and what the walker gets for
staying is the ebb; low water is the sunset frame, high water five minutes into
the held night, a cycle is 40 minutes of walking or under seven at the fire.
Nothing is saved, because the tide is a function of the same clock as the sun.
**The range, 0.36 m, was set by the beach's furniture and not by taste** (#517)
— it wets the wrack line and leaves the nearest flat stone 0.80 m of dry sand —
and three assertions hold those margins rather than the number. **Two things
worth carrying forward.** `waterLineZ` is now the one solver for the water's
edge and it changes slope at the shoreline (#518); three call sites had each
hand-rolled it with the dry-beach slope, wrong by 3.0 m at low water, and
checking the answer against `groundHeight` rather than against a second copy of
the slope is what found it. And the first version of the pool rule (#520) was
strictly right and measurably wrong: asking whether the sea's edge had passed a
pool's *seaward* rim left **36% of the cycle, 14.3 minutes**, with not one pool
on the shelf holding water, which reads as an empty shelf rather than as a high
tide. `test/smoke.mjs` 93 → **117**. A pre-existing bug came out with it
(#521): the wet-sand strip and the foam line both read `groundHeight`, which
returns the pier's planking, so both had been painted across the deck for as
long as the pier has existed.

**Closing Time has a commercial tier** (#508 to #515). It opens at Broker-Track,
which is the rung level 4 was always named for, and a building is not a bigger
house: `js/engine/commercial.js` owns a model that shares nothing with the
residential one but the screens it draws on. **Value is NOI over a cap rate and
the ask is not an input** (#508) — the commercial branch of `trueValue()` reads
neither `listing.price` nor `condition`, so 401 Clocktower Sq asks $640,000
against a modeled $446,886 and the board says so. Problems come off in dollars
rather than through `condition` (#509), and the headline rate moves a building
through the cap rate where it does not move a house at all (#510): 150 bp takes
9.5% off 212 Ferry St. **The marquee decision is that the commercial financing
milestone is arithmetic, not a die** (#511): 1.20x coverage on a 70% loan over
25 years, and that branch touches `rand()` zero times, which two assertions on
`S.seed` hold. Four buildings and three investors are new content.
`tools/smoke.mjs` 270 → **359**; the `closing-time` section of
`play-games.mjs` 38 → **53**, green under Xvfb here. **Worth carrying
forward**: the ladder gate had three doors and only intake was gated — the
Monday free-lead perk and `rollReferral()` both picked out of `S.clientQueue`
without reading `levelInfo().tiers` (#514), which cost nothing until a tier
existed that a Rookie Agent must not be handed. And the first version of "moving
the ask does not move the building" moved `S.listingsState[id].price`, which no
branch of `trueValue` has ever read, so it would have passed with the whole
dispatch deleted (#34).

**Closing Time files a finished year in a hall** (#503 to #507). A career
that closes at day 336 leaves its frozen scorecard under `closingTime.hall`,
once, on a `careerId` the career now carries, and "New career" wipes the desk
and not the wall. The career key is a member of a `createNamespace` now, the
first adopter of one (#504): prefix `closingTime.`, member `save.v1`, the same
string byte for byte, so no save changed. A seventh desk screen, Hall, lists
the years newest first with the best on each count marked, and has its own
export and import; an import merges by id and never replaces (#506). An
abandoned year is not filed (#503): the hall is a hall of years, not of
attempts. A career that finished before the hall existed is filed the first
time it loads, under an id derived from its bytes rather than rolled, because
repair runs on every load and a rolled id would file it once per visit (#505).
`tools/smoke.mjs` 193 → 270; the `closing-time` section of `play-games.mjs`
27 → 38 checks, green under Xvfb here. **Worth carrying forward** (#507):
the first dedupe assertion stayed green with the enrol-side check deleted,
because `repairHall()` also drops a duplicated id on load. Two guards over one
absence: the assertion reads the stored bytes now, which is what a reload has
to survive (#39), and fails on the enrol check alone.

**`gvb-save.js` has a second tier and a namespace** (#494 to #502).
Additive: no key and no byte a v1 slot writes changed, the 54 v1 assertions
pass on the v2 module unchanged, and all thirteen adopters' suites are green
against it. `slot.usage()` and `slot.lastError` say how big a save is and why a
write failed, in UTF-16 code units, against a 5 MiB ceiling measured at exactly
5,242,880 in headless Chromium; `createNamespace()` is the prefix scheme every
multi-key adopter hand-rolled, with one bundle file that names what it skipped
and what it refused; `createAsyncSaveSlot()` is the same slot over IndexedDB,
same key and same bytes, and a save in localStorage moves up on first load,
verbatim, once (#499, which is #59's shape). A 12 M-character save writes in
61 ms there and is refused by localStorage. **Nothing adopted it at the time**
(#501, on purpose and written down in `assets/js/README.md`); Closing Time's
hall took the namespace one batch later (#504), and the next feature anywhere
that needs more than 5 MiB takes the tier rather than a third prefix scheme.
`gvb-save.test.mjs` 54 → 150; a new
`gvb-save.browser.mjs` (47, real Chromium) is in the `site-ci.yml` matrix.
**Worth carrying forward**: the first slot-name assertion was green with the
slot-name check deleted, because the other member's own `validate` refused
the file first (#34). When two guards can refuse the same input, test against
a member that has only the one.

**Castle Conundrum moved to its own repository** (2026-09-15, #491 to #492).
`Projects/Castle Conundrum/` and `Tools/board-check/play-castle.mjs` are
deleted here; the project, its history, its seven phase plans and its 102
locked decisions are in
[`GreyVersusBlue/castle-conundrum`](https://github.com/GreyVersusBlue/castle-conundrum),
with its own CI. **Nothing about it is open in this file any more.** What
stayed is the board card in `index.html` and `landing.html`, and
`assets/previews/castle-conundrum.jpg` and `assets/og/castle-conundrum.jpg`.
The card points at <https://greyversusblue.github.io/castle-conundrum/> (#493),
which makes it offsite to every check here. `HISTORY.md`'s last three sections
are the record; the ranked table below never had a Castle row to delete,
because all seven phases had already shipped.

**Closing Time's multi-offer fields resolve** (#406 to #410).
`js/engine/escalation.js` is new and is the only place a clause becomes a price.
**An escalation clause resolves against the highest *submitted* price in the
field, never against another clause's escalated result** (#406) — escalating
against results is a mutual recursion whose only termination is both caps, which
is a pair of numbers neither buyer agreed to face. A clause is `{cap, increment}`
now (#407); `clauseOf()` still reads the old bare number and `repairCareer()`
rewrites it on load, so no old career reads differently. **Highest and best is
one call per listing and it can empty the room** (#408): over 400 seeded fields
the top number moves a median **+2.38%**, 16.6% of offers withdraw, and the read
is field size — a two-offer field empties **2.5%** of the time and can go 5%
backwards, a five-offer field **never**. The clause pays *before* the field it
beats is cleared off the table (#409), and on the buyer side it costs the same
information it buys: `agentRespond()` counters at a cap it can read (#410).
`tools/smoke.mjs` 150 → **193**. **The one thing to carry forward**: the first
version of the deadline guard-rail guarded nothing — an offer expires at
`day + 2` and the call holds it for exactly two days, so a same-day field cannot
tell the two rules apart and the deliberate break ran green. Age a field before
you test a deadline.

The batch before that:
**Orbital has an editor, and a level is a link** (#396 to #400). `#e=<code>` is
a level being built, `#l=<code>` is one to play, and the draft lives in the
address bar rather than in a second save key — the only storage Orbital has is
still `orbital_progress_v2`, so #36 is untouched. `js/levelcode.js` is the
codec: `o1$name$sub$start$goal$bodies`, one letter per body type, 73 to 151
characters for the 22 shipped levels. **The four delimiters `$ ; , @` are
frozen, and they were picked against RFC 3986's fragment grammar rather than by
eye** — `|` was the first choice, Chrome keeps it verbatim, and the grammar
does not allow it, so a client that linkifies the URL is entitled to
percent-encode it and hand the next reader a different string.
`test/levelcode.mjs` holds every level to that character set, so the next
delimiter cannot be chosen by looking at it. **The solvability search lives in
`physics.js` now**, not in a test file, so the editor's Check button and CI run
one implementation at one budget. **A shared level carries no `key`** — it
records no stars and unlocks nothing, so somebody else's level cannot write
into this browser's campaign. What no Node suite could see, and what one pass
in a real browser found: Escape reaching two key handlers at once, the rail
hiding the launch point of every draft, and a link pasted into an already-open
tab doing nothing at all.

**Two rows are 2+: rank 44 (the dioramas) and rank 54 (The Fracture
Cycle's fourth prong).** Of the thirteen rows ranked before #642 (now 45 to
57), five are ¼ (47, 48, 49, 50 and 55) and **all five want hardware nothing
here has**, as do three of the halves (45, 46, 51); the Parked section below the
table says why they were left ranked anyway. Recounted off the table on
2026-09-25, when 47 Blender rows went in above the thirteen. Signal City's row
retired on 2026-09-24 when M9 shipped (PR #373), the shared asset pipeline's
the same day when its increment 3 did (PR #380), and Pathfinder's three
conditional rows the same day again (PR #383). The living-sheet row left the
same day for Q39 rather than for `HISTORY.md` (#628): nothing was built, and
the question it waited on is Devon's. Aphelion's touch/gamepad row left the
same way the same day, for Q40 (#629).

**The model split is 43 Opus 5.5, 4 Opus 5, 6 Fable 5.1, 4 Sonnet 5.** Counted
off the table rather than decremented, which is how the 15/14/9 drift was
caught and how this paragraph's own drift was caught twice on 2026-09-24:
43 + 4 + 6 + 4 is 57, and the table has 57 rows. By size it is 26 ¼, 25 ½,
4 ones and 2 of the 2+, which is the same 57 (recounted 2026-09-25). By gate
it is 29 `blender`, 2 `GPU`, 3 `phone`, 1 `GPU, phone`, 2 `ears` and 20 with
none. The Blender rows name Opus 5.5 directly, since they were written after
#638, except rank 44, whose increments are variants of a style rank 43 fixes
and name Sonnet 5.
The rubric is in Tier 1's preamble, and it is a reading of each row, not a
quota — take the model the row names and say in the PR body which one you
actually worked under. The split counts the names; under #638 the Opus 5.5,
Opus 5 and Fable rows run on Opus 5.5 and the Sonnet rows on Sonnet 5.

**`Projects/corner-and-kettle` has no open phase** apart from its three
Blender rows (39 to 41). Arc one (Phases 1 to 4) and
arc two (5 to 9) have both shipped. What is left is its wishlist's "What this
leaves for a later arc" list — candidates, not a ranked arc, and the largest of
them (reshaping the five recipes that are another recipe's requirement list,
#365) is a balance change with a sweep behind it. Nothing from it is in the
ranked table, and putting one there is a judgement call a session may make.

**`npm run check` and `npm run social:check` now run on every pull request**,
in `.github/workflows/site-ci.yml`, graded by `Tools/board-check/ci-check.mjs`
against `Tools/board-check/known-failures.json` (#351, #352). **Both are green
on their own as of 2026-09-13, and that list is now empty in all three
sections** (#354 to #358): prompt-builder's fonts are vendored and all six
social-tag entries are cleared. **A PR that adds a failure goes red. So does a
PR that fixes one and leaves its line in the list.** Delete the line in the
same PR as the fix. An empty list is the goal state — the next entry to land
there should have to argue for itself.

**Every `.html` in the repo now has a named owner** (#355).
`Tools/board-check/ownership.json` is the machine-readable half of the
Ownership table at the bottom of this file, and `check-integrity.mjs` fails any
page no area claims. A new page needs a line there before it can ship. The two
files are meant to agree; change both.

**Twelve areas that had no workflow now run in CI**, as a matrix in
`site-ci.yml`; a new project's suite goes there, or in its own workflow calling
`.github/workflows/suite.yml`. Not in CI, on purpose (#353): Blue Hour's
`browser.mjs` (real-time movement, #53); Absalom's `browser.mjs` (its own fixed
Chromium path); two browser suites that only speak Playwright while the
harness is Puppeteer on Linux, both belonging to archived tools; and anything
under `npm run games`/`play`/`previews`. Integer Foundry's was the third of
those and is in the matrix now — its failure was a click race, not a missing
method, and every click in it retries a re-query. **It had a second failure mode
nobody had seen, and it was not a race** (#387): the fill-the-order beat put its
sink one column off the board on an order of exactly 8, which the game rolls
about one run in eleven and weighted low, so it had never come up. Fixed
2026-09-14, and then the geometry behind it was moved out of the browser suite
entirely (#388): it is `Projects/integer-foundry/test/order-line.mjs` now, and
`test/smoke-targets.mjs` checks it against every order the opening board can
roll, read out of `rollTarget`'s injectable RNG rather than written down. A
browser run still tests one order size; the arithmetic no longer depends on
which. If that beat goes red again it is the clicking or the timing, not the
plan. **A different beat in that file flaked on 2026-09-14, and it is worth
knowing before you spend an hour on it**: `and the far column takes a tap —
cell empty`, in the `Mobile, 375x812` section, went red on a pull request whose
whole diff was three markdown files, and passed on one re-run with nothing
changed. Same class as #387 and the same answer, the clicking rather than the
plan, but it is the mobile beat and not the fill-the-order one, and it has now
been seen once.

**`Pathfinder/data/` is a published interface** (#350, Devon). Any project may
read it; `Pathfinder/data/README.md` is the contract.

**What Phase 7 built**, kept here because the shop's arc is the repo's longest
and the next person to open it will not have read it. The full record is
`Projects/corner-and-kettle/WISHLIST.md` and `HISTORY.md` ("Phase 7 — A
reopening worth doing", #360 to #366). In short: a reopening is a trade now.
Beans (`state.meta.beans`) are earned at every reopening from
days survived and reputation at close and spent on `META_UPGRADES`, a permanent
tree; `SHOP_LAYOUTS` is the starting configuration, picked at the reopening;
four recipes are gated on prestige level rather than money, and
`sim.recipeAvailable(id)` derives the whole menu rather than storing it (#361);
every price the chalkboard prints is `sim.canBuy().cost`, discount included
(#363); and `sim.reopenPreview()` plus `#reopenOverlay` replaced the
`window.confirm`. `smoke-sim.mjs` 220 → 318, `smoke-save.mjs` 183 → 230, and
`balance.mjs` has a third banded batch (`BAND.loop`, both edges floored at 1.0)
that costs it 63 s → 88 s.

**What Phases 8 and 9 built** (#367 to #373). The station panel is playable on
the keyboard: ten letters `q` to `p`, **read off the buttons after they render**
rather than written down anywhere, printed as a legend under the station tabs
on the same pass, so an unlock cannot leave the legend stale. `[` and `]` move
the focused station with a wrap. `drive-save.mjs` 135 → 156. And
`Tools/board-check/play-games.mjs` has a `corner-and-kettle` section at last —
the registry entry in `games.mjs` had existed since Phase 4 with nothing
reading it. **A full `npm run games` reports 9 failures that are not this
work's** (#373): seven in Golden Hour, one aborted Integer Foundry run, one in
The Fourth Quarter, all reproducing on `main`. Golden Hour's are the class #53
calls inconclusive under a software-rendered Chromium, and `npm run games` is
outside CI on purpose (#353) — so nothing there went red, and none of it is
fixed.

Two findings **Phase 7** left behind, both in the wishlist's later-arc list:
**five recipes were already another recipe's requirement list** (Cappuccino is
Latte's; Affogato and Doppio are Americano's — #365, named in an assertion
rather than reshaped), and **the Legacy tree is measurably indistinguishable
from wasting the beans** at one pair of hands, because a shopper's income is
the door and the door is the prestige level's spawn floor.

---

# Tier 1 — the ranked index

One line per item, for scanning. `Area` is the folder the work lands in.
`Size` is ¼, ½, 1 or 2+ sessions. `Model` is what the item's own source names,
and where the source names nothing it is **assigned here** (#380, 2026-09-13) —
every row carried `—` before that, because none of the forty came from a
wishlist. A row whose source does name a model still carries that name
unchanged; a wishlist phase is not re-decided in this table. The three
readings, in the same terms the project wishlists already use:

- **Claude Sonnet 5** — the work is bounded and an oracle already exists: a
  code block written out below, an assertion body already drafted, a documented
  expected value, a second view to diff against. A mistake is loud and
  immediate.
- **Claude Opus 5** — the default. Real design or engineering judgement against
  a live codebase, with a suite or a visible result underneath it to catch a
  wrong answer.
- **Claude Fable 5.1** — a wrong answer is silent. A pure model layer with
  invariants nothing on screen reveals, a save schema every later adopter
  inherits, authored content whose coherence no assertion can hold, or a change
  with no safety net under it at all.

These are the names a row carries, not the model a session runs on: under #638
(2026-09-24) Fable 5.1 and Opus 5 rows run on Opus 5.5 and Sonnet 5 rows on
Sonnet 5. The Blender rows (#642) were written after #638 and name **Opus 5.5**
itself, which runs on Opus 5.5.

`Gate` (#644) is what the session's machine needs before it can take the row:
`blender` on PATH, a real `GPU`, a real `phone`, or a person's `ears`. Blank
means a cloud container can do it. A `blender` row is skipped in place by a
session that does not have it; see rule 4 above.

Seven rows read Fable, which at 7 of the 13 rows ranked before #642 is a heavier share than any single
project's wishlist carries, and the reason is what this list is: the leftovers
of ten projects are disproportionately save layers, pure models, and atmosphere
nothing in CI can look at. (It said "fifteen" from #380 until 2026-09-16, when a
recount off the table found the number had been left behind by four batches of
shipped rows. Count it; do not decrement it.)

`Claimed` is blank until a session writes its branch name in, and is cleared
after that branch merges. **A claim counts only once it is on `main`** (#283):
write it, open a one-line PR, merge it, then start. On 2026-09-11 two
sessions each wrote their branch into this row on their own branch, neither
could see the other's, and both built Daredevil Phase 4 in full — #220 merged
and #222 was closed unmerged an hour of suites later.

| Rank | Item | Area | Size | Model | Gate | Claimed | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Golden Hour's Blender pipeline: `tools/blender/` with `common.py`, `validate.mjs`, the style sheet, and the Blender version pinned | `Projects/golden-hour-beach` | ½ | Opus 5.5 | blender |  | [Golden Hour: Blender assets](#golden-hour-blender-assets) B1 |
| 2 | Golden Hour's animal pack: its ten animals as `.glb`, with clips on the ones that move by themselves | `Projects/golden-hour-beach` | 1 | Opus 5.5 | blender |  | [Golden Hour: Blender assets](#golden-hour-blender-assets) B3 |
| 3 | Wire Golden Hour's animal pack in, once rank 2 has merged: the models replace the sphere-and-cone builders and the movement code stays | `Projects/golden-hour-beach` | ½ | Opus 5.5 |  |  | [Golden Hour: Blender assets](#golden-hour-blender-assets) B4 |
| 4 | Blue Hour's Blender pipeline: its own copy of Golden Hour's (#643) and its own style sheet | `Projects/blue-hour-trail` | ¼ | Opus 5.5 | blender |  | [Blue Hour: Blender assets](#blue-hour-blender-assets) B1 |
| 5 | Blue Hour's animal pack: deer, fox, owl, crow, squirrel and small bird, with clips; the bear and the elk stay as they are (#646) | `Projects/blue-hour-trail` | 1 | Opus 5.5 | blender |  | [Blue Hour: Blender assets](#blue-hour-blender-assets) B3 |
| 6 | Wire Blue Hour's animal pack in, once rank 5 has merged | `Projects/blue-hour-trail` | ½ | Opus 5.5 |  |  | [Blue Hour: Blender assets](#blue-hour-blender-assets) B4 |
| 7 | Golden Hour's beach prop pack: driftwood, groyne, rocks, wrack, fence, pier, cave dressing, four shells, a skimming stone, the sandcastle | `Projects/golden-hour-beach` | ½ | Opus 5.5 | blender |  | [Golden Hour: Blender assets](#golden-hour-blender-assets) B5 |
| 8 | Wire Golden Hour's prop pack in, once rank 7 has merged | `Projects/golden-hour-beach` | ¼ | Opus 5.5 |  |  | [Golden Hour: Blender assets](#golden-hour-blender-assets) B6 |
| 9 | Blue Hour's trail prop pack: markers, cairn stones, bridge, bench, fire tower, cabin, radio, headlamp, mushrooms | `Projects/blue-hour-trail` | ½ | Opus 5.5 | blender |  | [Blue Hour: Blender assets](#blue-hour-blender-assets) B5 |
| 10 | Wire Blue Hour's prop pack in, once rank 9 has merged | `Projects/blue-hour-trail` | ¼ | Opus 5.5 |  |  | [Blue Hour: Blender assets](#blue-hour-blender-assets) B6 |
| 11 | The Fourth Quarter's Blender pipeline, its own copy (#643) | `Projects/fourth-quarter` | ¼ | Opus 5.5 | blender |  | `Projects/fourth-quarter/WISHLIST.md` B1 |
| 12 | The Fourth Quarter's bar pack: the fixtures and furniture `js/world.js` builds from boxes, not the walls its layout builds (#646) | `Projects/fourth-quarter` | ½ | Opus 5.5 | blender |  | `Projects/fourth-quarter/WISHLIST.md` B3 |
| 13 | Wire the bar pack in, once rank 12 has merged | `Projects/fourth-quarter` | ½ | Opus 5.5 |  |  | `Projects/fourth-quarter/WISHLIST.md` B4 |
| 14 | Aphelion's Blender pipeline, its own copy (#643) | `Projects/aphelion` | ¼ | Opus 5.5 | blender |  | [Aphelion: Blender assets](#aphelion-blender-assets) B1 |
| 15 | Aphelion's GLTFLoader at r160, and its loader test | `Projects/aphelion` | ¼ | Opus 5.5 |  |  | [Aphelion: Blender assets](#aphelion-blender-assets) B2 |
| 16 | Aphelion's ship pack: the interior props and the hull that `src/ship.js` builds from primitives | `Projects/aphelion` | ½ | Opus 5.5 | blender |  | [Aphelion: Blender assets](#aphelion-blender-assets) B3 |
| 17 | Wire the ship pack in, once rank 16 has merged | `Projects/aphelion` | ¼ | Opus 5.5 |  |  | [Aphelion: Blender assets](#aphelion-blender-assets) B4 |
| 18 | Bell to Bell's Blender pipeline, writing the `.gltf` its meshopt recipe expects | `Projects/bell-to-bell` | ¼ | Opus 5.5 | blender |  | `Projects/bell-to-bell/WISHLIST.md` B1 |
| 19 | Bell to Bell's classroom pack: what `src/world/` still builds from boxes and `data/assets.json` does not name | `Projects/bell-to-bell` | ½ | Opus 5.5 | blender |  | `Projects/bell-to-bell/WISHLIST.md` B2 |
| 20 | Wire the classroom pack in, once rank 19 has merged: the recipe, `data/assets.json`, the registry, a `BASELINE` each | `Projects/bell-to-bell` | ¼ | Opus 5.5 |  |  | `Projects/bell-to-bell/WISHLIST.md` B3 |
| 21 | School Generator's Blender pipeline, writing only what `js/gltf.js` reads | `Projects/school-generator` | ¼ | Opus 5.5 | blender |  | `Projects/school-generator/WISHLIST.md` B1 |
| 22 | School Generator's built-in model pack: catalog props as vertex-coloured `.glb` in `assets/models/` | `Projects/school-generator` | ½ | Opus 5.5 | blender |  | `Projects/school-generator/WISHLIST.md` B2 |
| 23 | Wire the model pack in, once rank 22 has merged: catalog rows that point at a file, and the precache | `Projects/school-generator` | ¼ | Opus 5.5 |  |  | `Projects/school-generator/WISHLIST.md` B3 |
| 24 | Signal City's sprite pipeline, the first 2D one: `common.py` renders a sprite sheet and its atlas instead of exporting a `.glb` | `Projects/signal-city` | ½ | Opus 5.5 | blender |  | `Projects/signal-city/WISHLIST.md` B1 |
| 25 | Signal City's car sheet: the ten archetypes, top-down, in `sprites.js`'s metres | `Projects/signal-city` | ½ | Opus 5.5 | blender |  | `Projects/signal-city/WISHLIST.md` B2 |
| 26 | Wire the car sheet in, once rank 25 has merged: `spriteFor` draws a frame and `sprites.html` shows both | `Projects/signal-city` | ¼ | Opus 5.5 |  |  | `Projects/signal-city/WISHLIST.md` B3 |
| 27 | The Absalom Inheritance's sprite pipeline: Signal City's renderer with a 2:1 isometric camera | `Projects/absalom-inheritance` | ¼ | Opus 5.5 | blender |  | `Projects/absalom-inheritance/WISHLIST.md` B1 |
| 28 | Absalom's tile sheet: floor, wall, door, pillar, gate, stairs and treasure, as `js/render.js` shades them | `Projects/absalom-inheritance` | ½ | Opus 5.5 | blender |  | `Projects/absalom-inheritance/WISHLIST.md` B2 |
| 29 | Absalom's figure sheet: the heirs, the foes and the boss, recoloured from each pack's palette | `Projects/absalom-inheritance` | ½ | Opus 5.5 | blender |  | `Projects/absalom-inheritance/WISHLIST.md` B3 |
| 30 | Wire Absalom's two sheets in, once ranks 28 and 29 have merged | `Projects/absalom-inheritance` | ½ | Opus 5.5 |  |  | `Projects/absalom-inheritance/WISHLIST.md` B4 |
| 31 | Faire Weekend's sprite pipeline, top-down, in the plat's ink | `Projects/Ren-Faire-Claude` | ¼ | Opus 5.5 | blender |  | `Projects/Ren-Faire-Claude/WISHLIST.md` B1 |
| 32 | Faire Weekend's marker sheet: one drawing per plot kind, where a glyph stands on the plat today | `Projects/Ren-Faire-Claude` | ½ | Opus 5.5 | blender |  | `Projects/Ren-Faire-Claude/WISHLIST.md` B2 |
| 33 | Wire the marker sheet in, once rank 32 has merged | `Projects/Ren-Faire-Claude` | ¼ | Opus 5.5 |  |  | `Projects/Ren-Faire-Claude/WISHLIST.md` B3 |
| 34 | Hearth's sprite pipeline, at the map's tile size | `Projects/hearth` | ¼ | Opus 5.5 | blender |  | `Projects/hearth/WISHLIST.md` B1 |
| 35 | Hearth's building sheet: every kind in `BLD`; the faces stay procedural (#646) | `Projects/hearth` | ½ | Opus 5.5 | blender |  | `Projects/hearth/WISHLIST.md` B2 |
| 36 | Wire the building sheet in, once rank 35 has merged | `Projects/hearth` | ¼ | Opus 5.5 |  |  | `Projects/hearth/WISHLIST.md` B3 |
| 37 | Corner & Kettle's sprite pipeline | `Projects/corner-and-kettle` | ¼ | Opus 5.5 | blender |  | `Projects/corner-and-kettle/WISHLIST.md` B1 |
| 38 | Corner & Kettle's cup and food sheet: what `cupSvg` and the order icons draw today | `Projects/corner-and-kettle` | ½ | Opus 5.5 | blender |  | `Projects/corner-and-kettle/WISHLIST.md` B2 |
| 39 | Wire the cup and food sheet in, once rank 38 has merged | `Projects/corner-and-kettle` | ¼ | Opus 5.5 |  |  | `Projects/corner-and-kettle/WISHLIST.md` B3 |
| 40 | Orbital's sprite pipeline | `Projects/orbital` | ¼ | Opus 5.5 | blender |  | [Orbital: Blender assets](#orbital-blender-assets) B1 |
| 41 | Orbital's body sheet: planet, star, rock, repulsor, black hole, wormhole and booster | `Projects/orbital` | ½ | Opus 5.5 | blender |  | [Orbital: Blender assets](#orbital-blender-assets) B2 |
| 42 | Wire the body sheet in, once rank 41 has merged, with the glow drawn over it | `Projects/orbital` | ¼ | Opus 5.5 |  |  | [Orbital: Blender assets](#orbital-blender-assets) B3 |
| 43 | The site's diorama pipeline: `Tools/board-check/blender/`, one camera, one light rig and one plinth for every board card | `site` | ½ | Opus 5.5 | blender |  | [The site itself: Blender dioramas](#the-site-itself-blender-dioramas) D1 |
| 44 | A diorama for every board card, rendered into `candidates/` and promoted: four cards an increment | `site` | 2+ | Sonnet 5 | blender |  | [The site itself: Blender dioramas](#the-site-itself-blender-dioramas) D2 |
| 45 | A real-hardware pass: every atmospheric piece's numbers are software rasterization, and touch has never had a thumb on it | `site` | ½ | Opus 5 | GPU, phone |  | [The site itself](#the-site-itself) |
| 46 | A real hour on the beach with ears on: event pacing, sanderling flush distance, cricket density, night palette banding | `Projects/golden-hour-beach` | ½ | Fable 5.1 | ears |  | [Golden Hour](#golden-hour) |
| 47 | A real low-end-GPU run — the world is 10x bigger and every number is software rasterization | `Projects/golden-hour-beach` | ¼ | Sonnet 5 | GPU |  | [Golden Hour](#golden-hour) |
| 48 | A touch playtest on a real phone — the pill-as-throw-control needs a thumb on glass | `Projects/golden-hour-beach` | ¼ | Opus 5 | phone |  | [Golden Hour](#golden-hour) |
| 49 | A real GPU run: the mist banks' fill cost, the headlamp at decay 1, the lamp's feet-pool at real pixel density | `Projects/blue-hour-trail` | ¼ | Sonnet 5 | GPU |  | [Blue Hour](#blue-hour) |
| 50 | A touch playtest on real glass — hold-the-bottom-third-to-walk has never had a thumb on it | `Projects/blue-hour-trail` | ¼ | Opus 5 | phone |  | [Blue Hour](#blue-hour) |
| 51 | An hour on the trail with ears on: dread cooldowns, fog periods, drone gains, the new stingers | `Projects/blue-hour-trail` | ½ | Fable 5.1 | ears |  | [Blue Hour](#blue-hour) |
| 52 | Beats that change in kind above the fog line: the silence and the snap done (#635), the shape and the eyes left | `Projects/blue-hour-trail` | 1 | Fable 5.1 |  |  | [Blue Hour](#blue-hour) |
| 53 | The two conservative model gaps, as one coupled piece of work | `Projects/integer-foundry` | 1 | Fable 5.1 |  |  | [Integer Foundry](#integer-foundry) |
| 54 | A 4th prong or deeper side content, only if Devon expands scope | `Projects/the-fracture-cycle` | 2+ | Fable 5.1 |  |  | [The Fracture Cycle](#the-fracture-cycle) |
| 55 | Verify the rotate-to-play gate on a real device or real touch emulation | `Projects/orbital` | ¼ | Sonnet 5 | phone |  | [Orbital](#orbital) |
| 56 | Revisit `gvb-save.js` adoption for save-bar UI consistency | `Projects/orbital` | ½ | Fable 5.1 |  |  | [Orbital](#orbital) |
| 57 | Signal City R6: the priority corridor follows the vehicle across boxes | `Projects/signal-city` | ½ | Opus 5 |  |  | [Signal City](#signal-city), `WISHLIST.md` R6 |

## Parked — needs a person at a real device

Rule 2 above: a row only a human at a real device or a live deployment can do
does not belong in the ranked table. **Parked is not verified**, and each note
says which it is. Nothing here is done; it is waiting on hardware, not on a
decision.

**Castle Conundrum's board preview and og card are Devon's now.** The row that
was parked here — recapture, look, promote — went with the project on 2026-09-15
(#491) and is rank 5 in
[`GreyVersusBlue/castle-conundrum`](https://github.com/GreyVersusBlue/castle-conundrum)'s
`BACKLOG.md`, behind the GPU run that produces the frames. The two images stay
in `assets/previews/` and `assets/og/`, `promote-previews.mjs` still knows the
slug, and `candidates/chosen.json` still names a candidate, so a capture taken
in the other repo can still be dropped into `candidates/` and promoted from
here. What it is waiting on has not changed and is not this repo's: a machine
with real GPU compositing.


## Blender assets: the common plan

Ranks 1 to 44 (#642 to #647). This section is what every Blender row shares;
each project's own plan (its `WISHLIST.md` "Blender assets" section, or a
subsection of its section below) adds its style sheet and its list.

**Where it runs.** Blender runs on Devon's Windows machine only, headless:
`blender -b -P tools/blender/<script>.py -- <args>`, from the project's folder.
Before claiming a `blender` row, `blender --version` has to print a version.
The Windows installer does not put Blender on PATH, so add the folder it
installed into (the one holding `blender.exe`) to PATH first. A session
without it takes the next row (rule 4). Node 22 and `git` are the only other
tools a Blender row needs. No Python package is installed: the scripts use what
ships inside Blender.

**The files, per project, never shared** (#643):

- `tools/blender/common.py`. Its header pins the Blender version the pipeline
  row ran under, as `REQUIRED = (major, minor)`, and the script exits 1 with
  both versions named if `bpy.app.version` differs. It is the only place a
  project's export settings live.
  - **3D projects:** glTF binary (`.glb`), metres (unit scale 1.0), +Y up,
    transforms applied, no Draco (#619 chose meshopt, and only Bell to Bell
    has the decoder). Every asset's origin sits at the centre of its base, so
    `y = 0` is the ground it stands on. Bell to Bell and School Generator
    differ, and their plans say how.
  - **2D projects:** a sprite-sheet renderer in place of the export settings:
    an orthographic camera at the game's projection, a transparent film, a
    fixed frame size, the frames packed into one PNG with a JSON atlas beside
    it (`{ "<frame>": { "x", "y", "w", "h", "ax", "ay" } }`, the anchor in
    frame pixels).
  - **Both:** a seeded RNG (`random.Random(seed)`, passed down, never the
    module-level `random`, and no noise texture left on its default seed), a
    scene built from a factory reset so nothing on Devon's machine leaks in,
    and a fixed-camera contact sheet of the whole pack written to
    `tools/blender/out/`, which a `.gitignore` there keeps out of git (#645).
- `tools/blender/<pack>.py`, one per pack. It builds every item in the pack
  from code, calls `common.py` to export or render, and writes into the
  folder the game loads from.
- `tools/blender/budget.json`, the style sheet as data: every item's file,
  class, and the class's triangle, byte, bounds and texture caps.
- `tools/blender/validate.mjs`, Node with no dependency. It reads every file
  `budget.json` names and exits 1 (#13) on a triangle count, a byte count, a
  bounds box (the base more than 1 cm off `y = 0`, or an extent over the
  class's), a texture over the cap (from the PNG or JPEG header of each
  embedded image) or an extension the project's loader lacks. For a sheet:
  its size and bytes, every frame inside the sheet, every anchor inside its
  frame, no empty frame. It joins the project's CI (the Site CI matrix, or the
  project's own workflow), since it needs no Blender (#645).

**The done line for a pipeline row.** One sample asset exported (or one frame
rendered) and validated; a second run leaves `git status --porcelain` empty;
the validator broken on purpose once from green (#34), for instance a budget
set under the sample's real triangle count, and the PR body names the line
that failed and what it printed; the style sheet written into the plan and
into `budget.json`. **If a rerun is not byte-stable** (a renderer's noise, an
exporter's timestamp), say so, pick the setting that makes it stable
(Workbench, or Cycles with a fixed seed and sample count and the denoiser
off), and only if none does, record a decision and give the validator a
tolerance instead.

**The style sheet a pipeline row decides first**, written into its plan:

1. **Scale.** Measure the bounding box of what each asset replaces, as the
   game builds it now, and hold the asset to it within 10%. Movement code,
   perches, collision and camera heights were all tuned against those boxes.
2. **Palette.** Lift the hex values from the materials the game uses now, so
   a replaced thing keeps its colour under the game's own lights. A new colour
   is a decision.
3. **Triangle budget per class.** The plan names the classes and their caps;
   `budget.json` holds them.
4. **Texture cap.** The default is none: vertex colour and flat materials,
   which is what every one of these games draws today. A texture needs a
   reason and a size cap in pixels.

**Clips** are named for what the game calls them (`idle`, `walk`, `swim`,
`fly`), loop, and are sampled at 30 fps. Anything in a flock or an instanced
group (sanderlings, bats, small birds) stays a static mesh that the game's
existing procedural motion moves, because one skinned mixer per bird is the
wrong cost for a flock.

**A pack replaces what the game already shows** (#646). **A wiring row** loads
the pack before the scene builds, swaps the model in where the primitive
builder was, keeps every movement, audio and `?debug` behaviour as it was,
and fails loud when a file is missing: a suite line, not a silent fallback to
the old shapes. It runs the project's suites and, where the game has a
`play-games.mjs` section, `npm run games <slug>` from `Tools/board-check`
under `xvfb-run` in the cloud (real-time beats there are #53's to settle).

## Anathema Archive

`Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json
data.py`, `Pathfinder/tests/`.

Round 1 did the open-ended audit (data loading, manifest integrity,
search/filter/keyboard access, mobile layout — all in good shape). Round 2
built the test suite, swept `renderNpc`, and fixed the stale comment. **Nothing
is currently outstanding for this project's own feature work.**

If a future round finds something real:

1. **Extend `Pathfinder/tests/anathema.test.mjs`** rather than starting a
   second suite, if this page gets more interaction logic. **The suite says
   when that happens now** (#626, 2026-09-24): its static section lists all 47
   ways the page takes input in `SURFACE` and fails on a new one. That failure
   is this item coming true; it is not a ranked row until then. 41 of the 47
   are listed with `''`, driven by nothing (the encounter builder, the
   filters, deep search, bookmark import/export, keyboard navigation). The
   `waitFor`/`clickCat`/`clickLevelChip` helpers and the `freshPage()` pattern
   (fresh headless page per scenario, cheap since boot only fetches
   `manifest.json` until a category is picked) should cover new
   state-machine-shaped features without much new plumbing. Two things worth
   knowing if you do: (a) `page.evaluate(fn, arg)` re-parses `fn`'s source in
   the browser, so it can't close over this file's Node-side variables — pass
   anything from here through the single `arg` parameter, or bake a literal
   directly into the function source; (b) the page's top-level `const`/`let`
   bindings (`S`, `openDetail`, etc.) ARE reachable from `page.evaluate` by
   bare name, since Puppeteer/Playwright's `evaluate` shares the page's global
   lexical environment (same mechanism that lets DevTools console see them) —
   just don't route through `window.S`, since top-level `const` never becomes a
   `window` property.
2. **`Pathfinder/data/` is published** (#350, Devon, 2026-09-13; Q1 struck).
   Other projects may read it. Before a change that renames, moves or drops a
   file or field, search the repo for `Pathfinder/data` and run each
   reader's suite. `Pathfinder/data/README.md` is the contract.

Deliberately not done, and still the right call:

- **The `renderNpc` data-sweep script isn't committed.** It was a one-off
  read-only analysis (load every npc shard, check for AC/HP/Speed/Perception
  duplication in prose) to answer a specific question, not a reusable check —
  there's no ongoing invariant here to guard, since the answer was "this bug
  class doesn't structurally apply to this renderer." If a future session wants
  to re-run something like it, the approach was: for each creature with
  non-empty `system.details.publicNotes`, regex the structured field's value
  against the prose with a word boundary (`\bac\s*48\b` etc.) and hand-check
  any hit — the false-positive rate is real, so hand-checking hits matters more
  than the regex itself.
- **Not adding a `package.json` under `Pathfinder/tests/`.** The suite imports
  `playwright-core`/`puppeteer-core`/`@sparticuz/chromium` indirectly through
  `Tools/board-check/harness.mjs`; Node resolves those bare specifiers relative
  to `harness.mjs`'s own location, not relative to the importing file. No
  dependency of its own to declare, so no manifest to add.
- **Not re-litigating the `gvb-save.js` decision or the file-split question**
  from round 1's notes. Both are still current per that session's reasoning and
  nothing found since changes either call.

## Pathfinder Campaigns

`Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/`.

**Nothing urgent stands out on this page's own rendering or content.** Round
1's pass (card chrome, ember animation, foil-sweep title, contrast) plus round
2's `[shared]` markers still stand as the page's last real content/rendering
review. Round 3 made zero edits and found zero findings.

1. **If the generator gets used and the Chronological tab drifts out of sync
   with the By-Character view**, build the merge/sort step the generator's own
   README documents as a known gap: the Chronological tab is the same
   per-character scenarios, re-sorted by scenario number across each org. The
   generator already reads the same per-character JSON that could derive this
   automatically — not worth building ahead of an actual sync problem. Checked
   again in round 3; still in sync. **The check is a suite now**:
   `tests/chronicle.test.mjs`, in Site CI (#626, 2026-09-24), fails on a row
   in one view and not the other, on the Chronological order, and on a
   miscounted summary. When it fails on a real edit, build the step; its
   `order()` is the sort the step needs. Building it speculatively is exactly the
   scope creep the "keep it a small script, not a live editor" reasoning was
   written to avoid.
2. **The merge with `characters.html` is answered and closed** — "harmonize,
   don't share", round 2, locked decision #17 stays in force for this pair.
   Don't re-litigate it.

## Pathfinder Characters

`Pathfinder/characters.html`, `Pathfinder/characters-assets/`.

**Nothing urgent on this page itself.** Fonts vendored, heading order fixed,
contrast fixed, now cross-checked against its twin and confirmed to still
match. The merge question — this project's own headline item across two rounds
— is answered; don't re-litigate it.

1. **The commented-out `<template>` dossier block is built** (#627,
   2026-09-24), just above `</div>` at the end of `.muster`, with notes on each
   part. `tests/dossier-template.test.mjs`, in Site CI, fails when a real
   dossier uses a class or a section heading the template does not show. If
   you add a new part to a dossier, add it to the template in the same edit.
2. **In-browser editing via `gvb-save.js` is Q39, not a rank** (#628,
   2026-09-24). Only Devon can decide this page becomes a living character
   sheet, and he has not. `tests/showcase.test.mjs`, in Site CI, fails on the
   first line of that feature on this page or `campaigns.html`: browser
   storage, `gvb-save.js`, an editable field, a script from a file. If Devon
   answers Q39 yes, record it, then narrow that check to the page that is
   still a showcase.
3. **Drift between this file and `campaigns.html` is a test now**, not a pass
   somebody has to remember to do: `tests/shared-chrome.test.mjs`, in CI
   (2026-09-13, #378, PR #284). There was none to find. If you add a `[shared]`
   block to the pair, add it to that file's `BLOCKS` list — it counts the
   markers and fails on one it has not been told about.

Still not touching the font-file-naming mismatch between this page's fontsource
convention and `campaigns.html`'s short form. Same bytes, cosmetic only, not
worth the churn.

## Aphelion

`Projects/aphelion/`.

Round 1 vendored the fonts, adopted `gvb-save.js`, and ran a full
fun/performance/audio/accessibility audit. Round 2 built the EVA distance
readout that audit flagged as optional. Round 3 (2026-09-14, #383 and #384)
built the airlock-entry beat and landed the `#signal` assertion round 2 had
drafted and could not place. **`npm run games aphelion` is 11 checks → 21, all
green**, and no game code changed — the beat drives `setEVA` through the inner
hatch the way a player does, asserts the readout is silent inside first, then
`SALVAGE 13m · 25m · 38m` outside, nearest-first, then quiet again on the way
back in. The blocker that had carried this across three rounds was not Aphelion
at all: `camState` could not read a heading of ±π, so the walk aft was
unsteerable (#383).

**Nothing urgent is left on the core game, and nothing is ranked.**

1. **Touch/gamepad input is Q40, not a rank** (#629, 2026-09-24). It was
   ranked "only if Aphelion ever needs to run on a tablet or phone", four
   rounds carried it with no reason to build it, and whether there is one is
   Devon's to say. Round 1's arrow-key look already covers a desktop player
   whose browser denies pointer lock, so no smaller piece of the row was left
   that would not answer Q40 for him. `test/desktop-input.mjs`, in Site CI,
   fails on the first line of the feature: a touch or non-lock pointer event,
   a gamepad read, a coarse-pointer or hover query, `touch-action`, device
   orientation, a second file in `libs/`, a file named for touch or a
   gamepad, or a viewport other than the plain responsive one. If Devon
   answers Q40 yes, record it, then delete the rule the scheme needs in the
   same edit.

Two full audit rounds (fun, data-driven extension points, audio, performance,
accessibility) plus a re-check found nothing else worth touching. Inventing a
change to have something to report would be worse than reporting none.

### Aphelion: Blender assets

Ranks 14 to 17. The common plan is
[Blender assets: the common plan](#blender-assets-the-common-plan). three is
r160 here.

**B1. The pipeline (rank 14, ¼, gate `blender`).** Aphelion's own copy
(#643). The palette is the `M` table at the top of `src/ship.js` (wall, trim,
panel, metal, bed, blanket, soil, leaf, glass, hullExt, sat), with its
emissive panel values kept: `panelLow` and `panelOk` are the power state, and a
model's panel material must still take them. Starting budgets: interior prop
1,500 triangles, hull shell 6,000, satellite and EVA points of interest 2,000.
No textures. The validator joins Site CI's Aphelion entry.

**B2. The GLTFLoader (rank 15, ¼, no gate).** Copy
`Projects/bell-to-bell/libs/addons/loaders/GLTFLoader.js` and
`libs/addons/utils/BufferGeometryUtils.js`, and check both byte for byte
against three@0.160.0's own after `npm install` in `Tools/board-check` puts it
in `three-0.160.0/` (#19); take npm's if they differ. **`test/desktop-input.mjs`
fails on this row by design**: `libs/ holds Three.js and nothing else` is its
guard against a vendored touch or gamepad library (#629). Widen that one line
to the three files by name, keep the loader files out of the scan the way
`libs/three.module.js` is kept out, and break it by adding a fourth file to
`libs/`. Q40 is untouched: nothing here is an input scheme.

**B3. The ship pack (rank 16, ½, gate `blender`).** What `src/ship.js` builds
from its twelve primitive calls: the interior props and interactables, the
exterior shell, the satellite and the EVA points of interest. The starfield
stays procedural.

**B4. Wiring the ship (rank 17, ¼, no gate, after rank 16).** Every
interactable keeps its position and its prompt; the power state still dims
the panels. Run `node test/smoke-state.mjs`, `node test/desktop-input.mjs` and
`npm run games aphelion` from `Tools/board-check`.

## Closing Time

`Projects/Closing Time/`.

**Round 3 closed both items round 2 left open** (the name-substring Ledger
filter, the career-ending dead end). **`npm run games closing-time` runs clean
now** — 27 checks, 0 failed, four consecutive runs (2026-09-13, #377, PR #284),
and still 27/0 after round 4.

**Round 5 (2026-09-14, #406 to #410) shipped multi-offer escalation wars**, in a
new `js/engine/escalation.js`. A clause is `{cap, increment}` and **resolves
against the highest submitted price in the field, never against another clause's
escalated result** (#406) — the alternative is a mutual recursion that terminates
at both caps. Highest and best is one call per listing, two days, and each agent
raises, stands pat or walks by `negotiationStyle`; over 400 seeded fields the top
number moves a median +2.38%, and a two-offer field empties entirely 2.5% of the
time against a five-offer field's 0%. `tools/smoke.mjs` 150 → 193. **If you touch
the offer deadline, age the field first**: an offer expires at `day + 2` and the
call holds it two days, so a same-day field cannot tell the old rule from the new
one, and the first deliberate break of that guard-rail ran green.

**Round 4 (2026-09-14, #385 and #386) shipped per-client financing**, in a new
`js/engine/financing.js`. A buyer is `cash`, `conventional`, `fha` or `va`, and
it moves the NPC listing agent's accept floor, the soonest the deal can close,
whether an appraisal and a financing milestone are scheduled at all, the
fall-through roll, and whether the appraiser reviews condition as well as value.
Measured on `ls_0001`, ask $168,000: cash is taken to $144,750, conventional to
$150,000, FHA stops at $155,000. `tools/smoke.mjs` 127 → 150. The type derives
from a hash of the client id rather than `rand()`, because `repairCareer`
backfills it and repair runs on every load (#386).

**Round 6 (2026-09-16, #503 to #507) shipped the hall of past careers**, the
multi-career history three rounds of notes had raised. A finished year is filed
under `closingTime.hall` on the career's `careerId`, once, and survives "New
career"; the career key is member `save.v1` of a `createNamespace` at the key it
always had. A seventh desk screen, Hall, with its own export and an import that
merges by id. Finished years only: an abandoned career leaves no row.
`tools/smoke.mjs` 193 → 270, the browser section 27 → 38.

**Round 7 (2026-09-16, #508 to #515) shipped the commercial tier**, in a new
`js/engine/commercial.js`, and with it **the README's "next layers" list is
finished**. It opens at Broker-Track, which is what level 4 was always named
for. Value is NOI over a cap rate and the ask is not an input to it (#508);
deferred capital comes off in dollars rather than through `condition` (#509);
the headline rate moves a building through the cap rate where it does not move
a house at all (#510), 150 bp for 9.5% on 212 Ferry St. **The commercial
financing milestone is arithmetic, not a die** (#511): 1.20x coverage on a 70%
loan over 25 years, and that branch touches `rand()` zero times. Four buildings,
three investors, 2% a side, 200 XP. `tools/smoke.mjs` 270 → 270 + 89 = **359**.
**Nothing about the tier is open.** What it deliberately did not do is the
seller side (#515) — representing the seller of a building wants a rent roll,
an offering memorandum and a broker's opinion of value where `seller.js` has
staging tiers, photo tiers and weekend open houses. It is a row for whoever
wants it, sized on its own, and it is **not in the ranked table**: putting it
there is a judgement call a session may make.

From the README's own "Design notes for future expansion", which was this
project's only plan and is being retired from that file:

- **The priority-tested slice** — the buyer loop, seller loop, open houses,
  events, brokerages, market drift, referrals, and career ladder — is all live.
  Per-client financing shipped in round 4, multi-offer escalation wars in
  round 5, the hall of past careers in round 6 and the commercial tier in
  round 7. **No next layer from that list is open.** The suite holding all of
  it is at 359 assertions.
- **The unhandled edge case.** `repairCareer()` makes adding and removing
  content from a live career safe — it backfills and drops `listingsState`,
  `market.nb` and `knowledge` entries against what's actually in `data/`. But
  **a deal or listing still actively under contract on deleted content is a
  separate, unhandled edge case: don't delete a listing a save might be
  mid-contract on.**

Two conventions that stay in the README rather than moving here: anything new
added to `S` belongs in `repairCareer()` the same day it's added, especially if
arithmetic touches it; and `log(text, cls, kind, recId)`'s fourth argument tags
a line as belonging to one client, which is what the Ledger's per-client filter
matches on. A handful of `log()` calls are deliberately left without a `recId`
— the weekly rate announcement, the Monday-begins line, brokerage
recruitment/decline — because they aren't about one specific client, and no
per-client filter should ever match them.

## Golden Hour

`Projects/golden-hour-beach/`.

The last big session grew the world 10x on one decision — the shoreline is a
curve, `shorelineZ(x)`, and everything works in shore distance `s = z -
shorelineZ(x)` — and Devon overrode two locked decisions to allow it: the sun
sets now (six keyframes, not two), and there is a save, narrowly (`journal.js`
persists discoveries only; sun position and player position are pointedly
absent from the schema). Source grew from about 1,900 to about 5,600
hand-written lines across 27 modules, with zero new asset bytes and zero
offsite requests.

**The tide shipped on 2026-09-16** (#516 to #522, PR #331), so the item that
used to head this list is gone from it. The waterline swings 9.3 m against the
4.3 m the swash alone ever moved it, on a 2,400 s cycle of walking seconds that
does not stop when the sun does; `test/smoke.mjs` 93 → 117. Two things it left
behind are below: the intertidal structure that would give the ebb something to
uncover (item 7), and the surf's missing distance term, which belongs to the
ears-on row rather than to a session guessing at a gain curve (item 1).

What's left:

1. **A real hour on the beach, ears on, tuning pass:** event pacing (bait ball
   every 10 to 18 min, whale about 20, both guesses until someone sits through
   them), sanderling flush distance, cricket density, night palette banding on
   a real monitor. **And the surf's distance term, which the tide made
   overdue:** `audio.js`'s wash gain reads the swash and the walker's wade
   depth and has never read distance at all, so the sea sounds the same from
   the dune line as from the waterline, and now the waterline moves 9.3 m.
   Deliberately not guessed at in the tide's own PR — a gain curve tuned
   without ears is the thing this row exists to stop.
   **And the night's two new movers** (#633): the owl's 80 to 140 s between
   hunts and the fireflies' two-minute drift to the fire are as unwatched as
   the bait ball's interval was.
2. **The still-open real low-end-GPU run from the last backlog, now genuinely
   urgent:** the world is 10x bigger and the proxy numbers are software
   rasterization, not a weak real GPU. Confirmed the qualitative direction
   (water stays the dominant relative cost); the actual absolute numbers on a
   weak integrated GPU are still unmeasured. `renderer.info` at the widest home
   view reads 157 draw calls and 316k triangles, against a 300-call budget.
3. **Preview recapture and board card refresh. Closed 2026-09-24** (#630,
   PR #392). The card names the night, the tide, the lighthouse, the stones
   and the journal on `index.html` and `landing.html`, and the new frame has
   the lighthouse in it. The frame is a SwiftShader draft; the real-hardware
   pass recaptures it with `npm run previews golden-hour` and
   `npm run promote golden-hour`.
4. **Touch playtest on a real phone:** the pill-as-throw-control needs a thumb
   on glass, not a mouse pretending.
5. **The owl hunts and the fireflies drift toward the fire. Closed 2026-09-24**
   (#633, PR #395). The condition, "if night proves popular", sets the
   row's priority, not what the page is, so the batch naming it was the ask.
   Both movers are clocks in `js/creatures/nightpaths.js`: the fourteen flies
   nearest the camp leave the hollows one or two at a time from nightT 0.2 and
   are all round the fire, 3 to 6.5 m out, by 0.60; the owl swoops 12 to 20 m
   from its snag every 80 to 140 s of night, drops into the grass for 1.2 s and
   climbs back to the nearer snag. The timings are guesses a person should
   hear and watch, and belong to item 1's ears-on hour.
6. **`play-games.mjs` beats off the `__gh` hook. Closed 2026-09-24** (#631,
   PR #392). Twelve beats after the real-time ones: the hook shut without
   `?debug`, stars at `setSunT(1560)`, the headland's card and journal page,
   the foam line from `setTideT(600)` to `(1800)`, the stone's pill cycle, and
   a reload that keeps the journal and resets the sun. Each was broken once
   from green. Footprint-counting on the wet band was not added: it is a
   real-time walk, and #53 makes it a maybe.
7. **A bar and a runnel, or any structure at all in the intertidal zone.** This
   is what the tide leaves for a later increment and it is the obvious next
   one: the sea's edge crosses 9.3 m of seabed that is a plain 0.10 ramp, so a
   falling tide currently uncovers more flat sand rather than uncovering
   anything. A bar you can walk out to at low water and have to come back off
   is the thing every real beach does with a tide. It is not free: `wadeLimitZ`
   is a closed-form solve on a constant slope and a non-monotone seabed makes
   it a march, and the runnel behind the bar has to stay under knee depth or
   the bar is content nobody can reach.

Deliberately not done, and still the right call:

- The original quartet (dolphin, gulls, boat, jet) was not migrated into
  `js/creatures/`. It is tuned, tested, and lives fine where it is; a mechanical
  move risks regressions for zero player-visible gain. The registry pattern is
  established for everything new.
- The curlew is not a journal species. Not everything should be collectable.
- No chunk LOD swapping. Measured first: 157 calls and 316k triangles at the
  worst view is nothing, and frustum culling already drops distant chunks.
- No estuary-specific soundscape bus beyond the curlew timer. The reeds and
  distance already quiet the surf; a dedicated layer can wait for ears-on
  tuning.
- The whale has no fluke. Two sprites and restraint.
- **Wildlife retuning is closed**, not carried forward: round 3 watched it for
  real and found no case for changing anything.

### Golden Hour: Blender assets

Ranks 1 to 3, 7 and 8. The common plan is
[Blender assets: the common plan](#blender-assets-the-common-plan); this is
what is Golden Hour's own. three is r185 here (`libs/three.core.js`), split
into `three.module.js` and `three.core.js`, and nothing in the project can
load a model yet.

**B1. The pipeline (rank 1, ½, gate `blender`).** `tools/blender/` as the
common plan lays it out, with the gull as the sample asset (`makeGull()` in
`js/wildlife.js`, the simplest builder, five in the sky). The validator joins
Site CI's Golden Hour entry beside `node test/smoke.mjs`. The style sheet to
decide and write here, with these as the starting point:

| Class | Members | Triangles | Bytes | Clips |
| --- | --- | --- | --- | --- |
| animal, large | seal, dolphin, heron, pelican | 3,000 | 250 KB | yes |
| animal, small | gull, cormorant, owl, crab | 1,500 | 150 KB | where it moves alone |
| flock | sanderling, bat | 300 | 20 KB | none (#646's flock rule) |
| prop, large | groyne, pier section, cave dressing, a fence run | 4,000 | 200 KB | none |
| prop | driftwood, rocks, wrack, tide-pool stones, sandcastle | 1,200 | 80 KB | none |
| scatter | cockle, whelk, sand dollar, sea glass, skimming stone | 150 | 10 KB | none |

Scale is each builder's box as the game makes it now, within 10%. The palette
comes off the materials in `js/wildlife.js`, `js/creatures/*.js`,
`js/props.js`, `js/pier.js`, `js/shells.js`, `js/stones.js` and
`js/sandcastle.js`. Texture cap: none. `sand dollar` has a canvas texture today
(`sandDollarMaterialTop`), and the style sheet says whether it becomes vertex
colour or stays the one texture, at 128 px.

**B2. Golden Hour's GLTFLoader. Shipped 2026-09-25, PR #416** (#651).
GLTFLoader, BufferGeometryUtils and SkeletonUtils vendored unmodified from
three@0.185.0 into `libs/addons/`: r185's loader imports two utils, not one.
`test/gltf-loader.mjs`, 15 checks, in Site CI. It loads the gull once the
animal pack (now rank 2) merges.

**B3. The animal pack (rank 2, 1, gate `blender`).** The ten animals Golden
Hour builds now: dolphin, gull, crab, heron, cormorant, owl, bat, pelican,
sanderling, seal. Not the fireflies (points of light) or the tide-pool life,
which stay procedural. A clip goes on an animal whose builder moves a part
today (a wing, a flipper, a leg); read each `update` before deciding, and name
the clip for what the code does. Deliver the `.glb` files under
`assets/models/animals/`, the contact sheet, and the validator green on all
ten.

**B4. Wiring the animals (rank 3, ½, no gate, after rank 2).** Load the ten
before `js/main.js` calls `buildWildlife(scene, audio)`, which builds every
creature; swap the
mesh where each builder made one; drive clips with one `AnimationMixer` per
animal, stepped in the existing `update`; keep every path, perch, flush
distance and sound where it is. The owl's hunt (`nightpaths.js`) and the
`?debug` hooks `owl()` and `owlHunt(p)` must still answer. Run
`node test/smoke.mjs`, the loader test, and `npm run games golden-hour` from
`Tools/board-check` under `xvfb-run` (its real-time beats are #53's).

**B5. The beach prop pack (rank 7, ½, gate `blender`).** Fourteen items:
driftwood, groyne, rocks, wrack, fence, tide-pool stones, cave dressing, a
pier section, cockle, whelk, sand dollar, sea glass, a skimming stone and the
sandcastle. `roughen(geo, amount, seed)` gives today's pieces their variation
from a seed; the pack does the same with its own seed per variant, and the
style sheet says how many variants a scatter class gets.

**B6. Wiring the props (rank 8, ¼, no gate, after rank 7).** Shells, stones
and sandcastles are picked up or built through `js/interact.js`, so their pick
radius and their "throw a stone" path must not move. The pier is
walked on, and its deck is `field.js`'s (`PIER`, `onPier`, `pierDeckY`), not the
mesh's, so the new deck has to sit on those numbers.

## Blue Hour

`Projects/blue-hour-trail/`. Six sessions, no prompt in the numbered system, no
`WISHLIST.md`.

1. **The direction question — settled, session 4.** One reading verb, one
   memory, one findable tool, granted by Devon explicitly and narrowly.
   Anything further in the verbs/persistence/collection direction needs a new
   grant, and Golden Hour parity remains the odd one out. The live choice now
   is: keep pushing into `dread.js`, or write "no save, no verbs, no
   collection" into the record as a locked decision.
2. **Beats in kind above the fog line. First increment shipped 2026-09-24**
   (#635). The rule: above the fog line a beat changes kind by passing from
   the woods to the mountain. Past `STILL_AIR` (0.6 of `summitAir`, where the
   birdsong already ended) the silence stills the wind and lets go with one
   gust, and the snap is a stone rolling from the uphill ear to the valley
   one. The transmission and the figure in the lookout were already
   altitude-only. **Left**: the two visual beats, the shape and the eyes,
   which are still the same animal everywhere. One candidate that obeys the
   doctrine is a pale light low in the trees below, going away downhill, for
   the eyes' summit kind: the only other sign of a person on the mountain,
   leaving. It wants pixel checks, which under Xvfb are drafts (#630). The
   phantom steps, the howl and the radio stay as they are; the steps already
   borrow the previous walk's gait and the radio is the cabin's.
3. **A real GPU run.** Every number on this project is still swiftshader —
   1.0–1.8 fps — now including the headlamp's SpotLight cost and the newly-alive
   mist/breath fill rate, which makes this MORE urgent than before, not less:
   two full-screen-capable transparent systems that had never actually drawn
   are drawing now. Nobody has measured the actual frame rate of this piece
   anywhere. Three specific things to look at now that the session-5 retunes
   landed: the mist banks' fill cost (30 large transparent quads, more of them
   near the camera than before), the headlamp at decay 1 (cheaper than it looks
   — one SpotLight either way), and whether the lamp's feet-pool and 12 m reach
   still read right at a real frame rate and real pixel density. The geometry
   numbers are honest and comfortable — 35 draw calls, 280k triangles against a
   budget of 300 — but this piece leans hard on large transparent billboards in
   fog, which is fill-rate cost software rasterization reports very differently.
4. **A touch playtest on real glass.** The hold-the-bottom-third-to-walk scheme
   has never had a thumb on it — and the logbook's hold-the-chip-to-read and
   the headlamp button have joined it untested.
5. **An hour on the trail with ears on.** The dread cooldowns (55–100 s, first
   beat at 70 s) and the fog periods (211 s and 337 s) are unheard guesses; the
   drone gains, the new radio/transmission stingers, the headlamp partial and
   the descending phantom curve are too. They want a real walk, not a scrub. If
   Devon plays a build and leaves listening notes, tune the constants from
   them; session 4 left every level as authored.
6. **The causeway — closed 2026-09-16** (#523 to #527, Q44 struck). The first
   of the three ways out: the hill's climb is `hillProfile(z)`, the trail's own
   height read by z, and the trail sits on the hillside everywhere by
   construction. Worst spot 2.1 m above both shoulders, from the noise, against
   10.9 m; the trail itself did not move a millimetre, so nothing keyed to
   `altT` or the grade changed. `smoke.mjs` 104 → 107 and the record says which
   of the three new claims catches what.
7. **The peak — closed 2026-09-24** (#607, PR #366). `summitCap` is a
   ceiling centred on the tower, gentle along the approach spur and steep
   across it and behind; nothing within 100 m out-tops the trail's end, and
   the browser suite holds all four facings at the bench above 18. What
   follows is the item as it stood. `hillProfile` holds the summit's
   65.0 m flat from the trail's end to the map edge (#524): a shoulder, chosen
   because a slope still climbing behind the tower put the arrival frame's
   lower half at 14.6/255 and the flat one reads 20.0. The ~5 m berm the last
   stretch used to ride went with the causeway; what is left is the shape of
   the summit itself, invisible under the weather session 2 added and real
   again the instant anyone lifts the fog up there. Whoever takes it: the
   browser suite reads the lower-half luminance at the bench and holds it
   above 18, and only at the facing the walker arrives with — the other three
   facings read 18.3 to 27.4 now and nothing holds them.
8. **The phantom's downhill pan. Closed 2026-09-24** (#634, PR #395).
   `downhillAt` is the hillside's fall line now (`fallLine` in `field.js`),
   not the reverse of the trail tangent, so the steps lean toward the valley
   side, where the leg below you is: median 0.95 of the way sideways across
   the trail, pan 0.53 on the browser suite's real stop. The eyes' drift and
   the shape's head-flip moved with it, deliberately. Session 6's tripwire in
   `test/browser.mjs` is turned round: it fails if the pan goes back to zero or
   leans uphill, and `smoke.mjs` holds the fall line itself.
9. **Registered in `games.mjs`. Closed 2026-09-24** (#631, PR #392). No
   `saveKey`, on purpose. `play-games.mjs blue-hour` is 4 checks (the hook shut,
   at least 100 meshes and instanced sets of the 112, no errors, nothing
   offsite) and does not walk; the climb stays `test/browser.mjs`'s.
10. **Capture recipe and preview. Closed 2026-09-24** (#630, #632, PR #392).
    The trail corridor with the footbridge ahead, `assets/previews/blue-hour.jpg`
    and `assets/og/blue-hour.jpg`, on the board card and the landing row. The
    recipe boots with `?debug` for one call, `face(yawAlongTrail(0), 0)`,
    because Xvfb's pointer-lock warp had thrown the camera into the sky. The
    frame is a SwiftShader draft. **Absolute timing under software GL is still
    worthless here**: the browser suite sees about 1.7 fps and `main.js` clamps
    `dt` to 0.1 s, so any walk distance read from this piece must be scaled.

Deliberately not done, and still the right call:

- **The summit was not rebuilt.** Documented with numbers instead. Every fix
  moves the heightfield or the world layout, and `smoke.mjs` pins expectations
  that would move with it.
- **The `dread.js` split is the only change to a piece file.** A refactor of
  dread's scheduler into a registry (Golden Hour's creature pattern) was
  considered and dropped — it is tuned, it is tested, and a mechanical move
  risks regressions for zero player-visible gain.
- **No LOD or culling work.** Measured first: 35 draw calls and 280k triangles
  against a budget of 300. There is nothing to optimise, and the instancing is
  already doing it.
- **The chip timing is real seconds now** (session 5) — it ticked 1/60 per
  frame, which meant minutes on a slow tab and 2.4 s at 144 Hz. If any future
  UI element grows a timer, tick it by `dt`, not by frame.
- **The logbook proofread is done** (session 5). All ten pages read through the
  overlay in trail order. If the texts ever change again, walk them again — the
  source order is not the mountain's order.

### Blue Hour: Blender assets

Ranks 4 to 6, 9 and 10. The common plan is
[Blender assets: the common plan](#blender-assets-the-common-plan). three is
r185 here, as in Golden Hour, and nothing in the project loads a model yet.

**B1. The pipeline (rank 4, ¼, gate `blender`).** Blue Hour's own copy of
Golden Hour's `tools/blender/` (#643), its header naming the Golden Hour
commit it was copied from, and a style sheet of its own: the palette comes off
`js/wildlife.js`, `js/props.js` and `js/forest.js`, lit for dusk and fog, and
it has to read at the distances the fog allows. The sample asset is the crow.
The validator joins Site CI's Blue Hour entry beside `node test/smoke.mjs`.
Starting budgets: deer 3,000 triangles; fox and owl 1,500; crow and squirrel
800; small bird 300, static (seven fly as a flock); tower, cabin and bridge
4,000; bench and markers 1,200; cairn stones, mushrooms, radio and headlamp
300. No textures.

**B2. Blue Hour's GLTFLoader. Shipped 2026-09-25, PR #419.**
GLTFLoader, BufferGeometryUtils and SkeletonUtils vendored unmodified from
three@0.185.0 into `libs/addons/`, byte for byte against Golden Hour's copies,
which are separately vendored under #17 and #18 (both utils per #651).
`test/gltf-loader.mjs`, port 8162, 15 checks, in Site CI. It loads the animal
pack once rank 5 merges.

**B3. The animal pack (rank 5, 1, gate `blender`).** Deer, fox, owl, crow,
squirrel and small bird, the six `js/wildlife.js` builds. **The bear stays the
silhouette plane the dread beat puts up in `js/dread.js`, and the elk stays a
bugle in `audio.js`** (#646): not seeing either one clearly is the point.
Clips where the code moves a part now; the small birds are static.

**B4. Wiring the animals (rank 6, ½, no gate, after rank 5).** As Golden
Hour's B4. `test/browser.mjs` is outside CI on purpose (#353), so run it under
`xvfb-run` and name what it printed; its `> 10` meshes floor counts a loaded
model's meshes too, so check the count still means what its comment says.

**B5. The trail prop pack (rank 9, ½, gate `blender`).** The nine
`js/props.js` builds: trail markers, cairn stones, the bridge, the bench, the
fire tower, the cabin, the radio, the headlamp, the mushrooms. The bootprints
are a texture and stay one. The trees are not in this pack: `js/forest.js`
instances conifers and birches with their own silhouette texture, and a tree
pack would be its own row.

**B6. Wiring the props (rank 10, ¼, no gate, after rank 9).** The radio and
the headlamp are things the walker finds; their positions and what finding
them does stay exactly as they are.

## Integer Foundry

`Projects/integer-foundry.html`, `Projects/integer-foundry/`.

**`test/browser.mjs` passes on Linux now and is in CI** (2026-09-13, PR #278).
It was a race, not a missing method: Puppeteer's `page.click` resolves the
element, then scrolls and measures it before pressing, and the factory line
re-renders `#grid` in that gap. Every click goes through the same
re-query-and-retry helper `Pathfinder/tests/anathema.test.mjs` uses. Five
consecutive runs 56/0 fixed, against three runs aborting at 38, 50 and 17
checks reverted. In `site-ci.yml` with `install: Tools/board-check`.

**`test/browser.mjs`'s racy assertion is fixed** (2026-09-16, PR #335, #532).
It was the other half of #278's race: the click lands, on a node the grid
re-rendered under it, and places nothing, so both clicks return cleanly and the
cell reads `cell empty`. `place()` reads the class back now and places again if
the tile is not there, up to five times; it cannot double-place, because the
only route to a retry is a cell that verifiably does not carry the tool yet. A
new beat arms a one-shot capture listener on `#grid` to swallow a click on
purpose, which is the only way to see the retry work, since the CI failure it
exists for cannot be scheduled. Nothing is open against this file.

The other item still on the table is deliberately parked, not forgotten:

1. **The two conservative model gaps, if Devon or a future session wants them
   despite the coupling argument.** Both are safe-direction (make orders easier
   than they need to be, never harder), so neither is urgent: mergers/splitters
   are left out of the BFS entirely (a board with `Merge x` but not `x2` gets
   orders capped at 47 on a floor that could reach roughly 529); `opBudget`
   divides the floor evenly across sinks placed, ignoring shared prefixes
   through a splitter.

   Round 3 looked at these longer than "not urgent" alone would justify,
   because the prompt flagged `opBudget`'s fix as the smaller, lower-risk one
   of the two, worth picking up on its own. That isn't true, and it is worth
   writing down why so nobody picks it up in isolation expecting a small
   change: `targets.js`'s whole design commits to one invariant on purpose —
   "the answer does not depend on the layout currently on the floor... so an
   order stays fillable after the player tears their line down." `opBudget`
   currently assumes zero sharing between sinks specifically *because* assuming
   sharing would mean reasoning about whether a splitter is actually placed and
   where, which is layout information the rest of the model is built to ignore.
   You cannot correctly credit a sink for "a splitter could share this prefix"
   without first knowing how much a splitter actually saves, and that number
   does not exist anywhere in this codebase yet — mergers and splitters are
   outside `buildCosts` entirely. So `opBudget`'s fix and the BFS-tree fix
   aren't two independent gaps of different sizes; they're one gap. Any
   standalone `opBudget` change would have to guess at a sharing bonus without
   proving it, which is exactly the kind of guess that turns "conservative" into
   "wrong" in the one system here that has to never over-promise. **If this
   gets picked up, it should be picked up as one piece of work, not the smaller
   half of two** — model mergers/splitters as a tree in `buildCosts` first,
   then `opBudget` can credit actual proven sharing instead of guessing at it.
2. **The tile-cost hint. Shipped 2026-09-16, PR #335** (#531). The question was
   whether a three-digit `NEEDS` needs a cost beside it; the arithmetic says yes
   and says why. On the opening board the order and its cost are the same
   quantity — the floor reaches 47 and 47 costs 46 fabricators — and buying `×2`
   decouples them completely: all 201 three-digit orders cost 7 to 14 tiles, 100
   is a shorter line than 47, and 231 is twelve. Every sink cell carries the
   count under the order now, `12 tiles` at 48 px and `12t` below it, with the
   sink's mark shrunk so three rows fit a 36 px phone cell; the `title` tooltip
   still carries the recipe and is still nothing at all on a touchscreen, which
   is why this went on the tile. `test/smoke-targets.mjs` 104 → 109 holds both
   halves of the range, `test/browser.mjs` 57 → 68. Nothing is open against it.

## The Fracture Cycle

`Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/`.

**Two rounds running with nothing outstanding.** The one real bug (the
unreachable ending) is fixed, the save question is answered and implemented,
the fonts are vendored, the accessibility issues are fixed, and the test suite
passes. Don't invent busywork for a 799-line game with every ending reachable,
a working save, no offsite requests, and no known accessibility or mobile
issues.

The list below is only for if Devon deliberately decides to expand scope —
none of it is an obvious next step:

1. **A 4th prong, or deeper side content.** The three existing prongs and the
   side-hub detour are each a complete beginning/middle/payoff shape, not
   truncated. Adding more would be new content Devon chooses to commission, not
   a gap being filled. If you do this, replay every existing path afterward —
   a narrative game that silently loses a branch gives no error, the choice
   just isn't there.
2. **Re-verify the branch map after any future edit.** If a later round touches
   the story logic at all, rerun `node Projects/the-fracture-cycle/test/smoke.mjs`
   and replay by hand.

Deliberately not done, twice, and still valid: no restructuring (still one
file, still small enough to hold in one read); no mid-story save (the
ending-tracker design was the actual answer to what this game's replay loop
wants, not a placeholder for a "real" save); no `reset` button on the save bar
(still avoiding two adjacent erase-like controls with different scopes —
"Begin the Cycle Anew" already exists).

## Orbital

`Projects/orbital/`. Merged directly to `main` outside the normal process
(PR #6); one round of real work since.

1. **A committed browser-driven test layer. Shipped 2026-09-16, PR #335**
   (#528 to #530). `test/browser.mjs`, 48 checks in 41 s, in `site-ci.yml` with
   `install: Tools/board-check`: the sector grid's render, both of
   `buildGrid()`'s unlock clauses, the star display, one live flight from the
   aim to the save, reset, and the wipe confirm answered both ways. Nothing is
   open against it. Three things a session adding a beat should know, all in the
   file's own header: the page draws at 6 to 7 frames a second under this
   harness and a live flight costs ten wall-clock seconds per sim-second, so
   flying more than one shot is the expensive choice; a section that throws
   costs only its own checks (#529); and an assertion that the live flight
   matches the drawn plan has to read the clock, because the endpoint moves
   0.098 px under a 10% speed error and `won` alone does not move at all (#530).
2. **Verify the rotate-to-play gate on a real device or real touch emulation.**
   Round 1 could only prove the surrounding logic is sound (the gate is
   correctly keyed to pointer type, not viewport width) — this environment's
   browser reports a fine pointer even at a 375×812 viewport, so
   `matchMedia("(pointer:coarse)")` never flips true here regardless of window
   size. Needs different hardware to actually see it trigger.
3. **Revisit `gvb-save.js` adoption**, only if Devon wants save-bar UI
   consistency with the other adopters. Round 1 looked at it seriously and
   decided against: the current hand-rolled save (`orbital_progress_v2`, one
   key, already migrating its own `v1` predecessor) has no bug `repair` would
   fix, and the migration was proved to round-trip clean. Adopting would mainly
   buy the shared save-bar UI and export/import-to-file — a real but different
   kind of value.
4. **A level editor with URL sharing. Shipped 2026-09-14, PR #296** (#396 to
   #400). `js/editor.js` is the rail, `js/levelcode.js` is the codec, and the
   draft lives in the address bar rather than in a save key. Nothing is open
   against it; what a session would want next is the committed browser layer,
   which is item 1 above and already ranked.
5. **A level generator off the solver. Shipped 2026-09-14, PR #299** (#401 to
   #405). `js/generator.js` proposes from a tier and a seed, `validate` and a
   1,200-launch census judge, and the sector map rolls one at Easy, Medium or
   Hard. Nothing is open against it. Two things a later session might want,
   neither ranked: the census could feed the editor's Check (`Winnable, and
   2.4% of launches win`) for one more stepped call, and the tier bands are a
   first reading of 18 seeds against the 22 shipped levels, so a session that
   rolls fifty and finds a pattern (one type overrepresented, a tier that reads
   no harder than the one below) has the numbers to move a band and the fixture
   in `test/generator.mjs` to say what it moved.

One correction worth carrying, since the file that carried it is deleted:
**the live level count is 22, not the 21 an earlier survey recorded**, and
pack-02 holds 12 levels, not the "11 levels" its own description claimed. All
22 are the fixture `test/levelcode.mjs` runs its round trips against.

If a fresh preview/OG pass happens and the promoted "Deep Field" frame doesn't
look right in practice, `js/game.js`'s `computePlan()` and the `aim`/`plan`
globals are the fastest way to try another vector interactively from the
console before committing a `games.mjs` recipe. The candidate that shipped:
`deepspace#11`, an aim drag of world-space vector `(dx: 200, dy: -350)` from
`start` (120, 540), which grazes the blackhole at ~75px and the first wormhole
at ~42px and resolves `plan.outcome === "WIN"`.

### Orbital: Blender assets

Ranks 40 to 42. The common plan is
[Blender assets: the common plan](#blender-assets-the-common-plan). Orbital
draws on a 2D canvas (`js/render.js`), every body a radial-gradient
`glowCircle` in a colour from its `COLOR` table.

**B1. The pipeline (rank 40, ¼, gate `blender`).** Orbital's own copy of
Signal City's sprite renderer (#643): a camera straight down, a transparent
film, one frame per body type at a size the style sheet sets from the largest
radius a level draws at. The palette is `COLOR`. The glow stays the game's to
draw, so a frame is the body and nothing around it.

**B2. The body sheet (rank 41, ½, gate `blender`).** Planet, star, rock,
repulsor, black hole, wormhole and booster: the seven entries in `COLOR`.

**B3. Wiring the sheet (rank 42, ¼, no gate, after rank 41).** `render.js`
draws the frame scaled to the body's radius and the existing glow over it.
`test/browser.mjs` flies a real shot on fixed DT; it must still resolve.

## Signal City

A traffic-signal programming game, asked for by Devon on 2026-09-21: the
player never drives, only programs the lights, and has to keep a city grid
moving without gridlock or collisions. Top-down canvas, ES modules, no build,
zero offsite requests, a Node suite per module. Folder `Projects/signal-city/`;
its `WISHLIST.md` carries the milestone plan in full. The ranked row was a 2+,
one increment a session; it retired with M9 on 2026-09-24.

**Milestones 0 to 4 shipped in PR #338 (2026-09-21, #534 to #543),
milestone 5 in PR #340 (2026-09-21, #544 to #553), milestone 6 in PR #342
(2026-09-21, #554 to #562), M7's green wave in PR #344 (2026-09-21, #563
to #566), M7's first three events in PR #346 (2026-09-21, #567 to #570)
and the rest of M7 in PR #348 (2026-09-22, #571 to #576)**: items 1 to
13 below are done (M8 in PRs #355 and #358), and M9 in PRs #362, #367 and #373 (the grid, endless, the sandbox): 919 checks across nine suites, all in Site CI. **Milestones 0 to 9 are done and the ranked row is retired.** What comes
next is the **Roadmap** in `Projects/signal-city/WISHLIST.md` (2026-09-24):
R1 to R14 in build order, all runnable in a cloud container, then H1 to H4,
which need a real device, ears or a person. It absorbs the items that were
open here (the `games.mjs` recipe and preview capture are R5, the trucker's
sweep is R11, the one-box priority corridor is R6). R1 (¼) shipped in PR #399
(#636, #637): the calibration tool's `--baseline` and `--hand`, which
measured the move each level teaches costing the board. R2 (½) shipped in PR #403 (#639, #640): the lesson decides a star on the
four levels with a default, and `test/stars.mjs` holds it (952 checks
across ten suites). R3 (¼) shipped in PR #405 (#641): Rush Hour ships
hard, the one level R1's hand runs clean (959 checks). R4 (½) shipped in PR
#409 (#648): endless starts on day 3's district, and the hand lasts as long
as no input on five seeds of six (962 checks). R5 (¼) shipped in PR #413
(#649, #650): a board-check recipe, the Rush Hour preview and the card
copy, and Rush Hour's dusk is a level field. R6 (½) is rank 57.

1. **M0 scaffold**: folder, board card, `ownership.json`, Site CI matrix entry.
2. **M1 signal model** (`js/signals.js`): movements, a conflict matrix derived
   from geometry, phases, green/yellow/all-red transitions, manual and timed
   modes, flashing states, and the rule list that later triggers phases
   automatically.
3. **M1b sprites** (`js/sprites.js`, `sprites.html`): the eight archetype
   silhouettes drawn procedurally, four glossy colour variants each, cached to
   offscreen canvases, with a gallery page that exports a sheet.
4. **M2 network and physics** (`js/network.js`, `js/cars.js`, `js/sim.js`):
   lanes as arc-length polylines, turn arcs with swept width, IDM-style
   following with reaction delay, dilemma-zone stop rule, collisions, a
   Poisson spawner, fixed-dt determinism.
5. **M3 archetypes**: the eight stat rows and their tick-level faults; the
   emergency priority request.
6. **M4 scoring and level 1**: throughput, safety and satisfaction meters,
   stars (survive / average wait / zero collisions), a 4-way manual level,
   `signal_city_v1` save through `gvb-save.js`.
7. **M5 mechanics and the panel**: the yellow and all-red sliders, protected
   lefts from a bay on "Four Ways", flashing red (a four-way stop, first come
   first served) and flashing yellow as a mode, the rule panel with `queue`
   rows asleep until M6, "Stem" (the T where the all-red is the lesson), and
   the driver fault the all-red exists for (`greenTrust`).
8. **M6 pedestrians, sensors, the corridor, levels 4 and 5**: a walk as a
   flag on a through phase, call buttons per leg with serve-within-`pedWait`,
   walkers on the zebra who hold the box for turning cars, live induction
   loops with a queue rule's `after` and a jump that resumes the cycle, two
   boxes on one street with a controller each and the handoff through
   `newApproach()`, "Crossing" and "Two Blocks" (the east box 16 s behind,
   the offset a number in the level).
9. **M7, first increment: the green wave**: the offset slider on Two
   Blocks through `Controller.setOffset`, a running plan re-aligned by
   cutting or stretching the greens to come (never below the minimum
   green, never past twice the plan, the shorter way round the cycle),
   every change through yellow and all-red; the platoon visualiser in
   `js/wave.js`, a time-space diagram of both boxes' through heads with a
   line from every green start to where it lands at the other box, and
   the cars as dots. The diagram shows the shipped level's wave runs one
   way at a time (#565).
10. **M7, second increment: three events and Rush Hour**: a level's
    `events` list of `{ kind, at, for }` moments (`World.active`,
    `activeEvent`); the surge scaling every leg's demand on top of
    `demandCurve`; the outage that darkens every box and refuses every
    command that needs power until it ends, then returns each box through
    an all-red to the phase it was in; the ambulance with `within` seconds
    to leave the map, late past that (five honks' worth and 50 points);
    the corridor widened to the vehicle's whole entry leg and held until
    it is through the box plus 6 s (60 s cap); the panel's event line and
    the board's banners; "Rush Hour" (the surge at 60 s for 100 at 1.7,
    the outage at 110 s for 30, the ambulance from W at 185 s with 40 s).
11. **M7, the rest: four events, levels 7 and 8**: the motorcade and the
    funeral procession as platoons of scripted spawns with archetypes of
    their own, split when the light holds a member at its line while
    another is through (five honks' worth and 50 points), the motorcade
    taking the corridor; the hand on the green (`holdGreen`, the green
    phase pressed again); the lane closure as a zipper, traffic still
    arriving in the closed lane and merging out before the taper, the car
    behind in the open lane yielding, cones drawn; the school zone as a
    window of `speedScale` and four times the calls under flashing
    beacons; three zebra rules the new boards forced (#575); "School Run"
    and "Main Street"; `calibrate.mjs --hold`.
12. **UI clarity and visual pass** (Devon, 2026-09-23, PR #352, #577 to
    #587): both increments shipped; see WISHLIST.md's "What shipped".
13. **M8, first increment: the campaign and the shop** (PR #355, #588
    to #593): the eight starred levels in order, each opened by a star
    on the one before; stars bought into `save.unlocks` with no new
    field; protected turns, extra phases and sensors, folded into a copy
    of the level by `js/campaign.js`, the bought phases appended where
    `next` never goes. **Second increment** (PR #358, #594 to #599): the
    roundabout node, sold at 6 after Rush Hour for the three boards it
    converts, with its own calibration and a session switch. M8 is done.
    **M9**: the grid (PR #362, #601 to #606), endless (PR #367, #608
    to #613) and the sandbox, Free Play grown into a district (PR #373,
    #614 to #618). M9 is done.

## Tools/board-check

The site-wide check and regression suite. Owns `check-integrity.mjs`,
`check-collisions.mjs`, `play-games.mjs`, `tools.mjs`, `capture-previews.mjs`,
`promote-previews.mjs`, `sync-social-tags.mjs`, `games.mjs`, `drive.mjs`,
`harness.mjs`; each project owns its own test folder even where it imports
`harness.mjs`/`drive.mjs` read-only. Castle Conundrum's `play-castle.mjs` was
the one file-level exception and left with that project on 2026-09-15 (#491),
taking `npm run play` with it.

Everything open against this folder is filed under the project that needs it:
Golden Hour's preview recapture and debug-hook beats (ranks 4 and 6) and Blue
Hour's `games.mjs` entry and preview recipe (8 and 9). Those four numbers were
read off the table rather than decremented with the rest, which is how the drift
the line before this one carried was caught twice running — and on 2026-09-16 it
caught it twice more, once when the four had been left reading 17, 19, 21 and 22
through a batch that renumbered them, and again the same day when they read 12,
14, 16 and 17 for the same reason. Castle Conundrum's
preview promotion was rank 1, was parked, and left with the project (#491);
what is still here is the card and the two images, which are Devon's.
**Corner & Kettle's Phase 9 shipped on 2026-09-13 and is no longer open** —
`play-games.mjs` has a `corner-and-kettle` section now (#371, #372), and the note that used to stand here, that the file held no reference to
it, is out of date. The ownership manifest shipped the same day and is
`Tools/board-check/ownership.json` (#355).

Two things about this folder that are decided, not open:

- **`npm run games` and `npm run previews` open real, visible
  browser windows, and only one may run at a time.** Two will steal focus from
  each other and produce frame-motion and walk failures that look exactly like
  bugs. Prefer a project's own Node suite for iteration and save the browser
  suites for the end.

## The site itself

`index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/`, `CNAME`,
`.github/`.

Five things came up in more than one survey and belong to no single project.
Three of them are closed.

1. **CI ran almost nothing, and the failures it inherited are cleared. Closed
   by PR #276 then PR #278** (#351 to #358): `site-ci.yml` runs board-check and
   twelve uncovered suites on every PR, `suite.yml` is the template the simple
   per-project workflows call, and `known-failures.json` is now empty in all
   three sections. The social-tag cleanup went four ways: Blue Hour and School
   Generator gave up their hand-written icon/og tags (and their bespoke
   favicons, which is the generator's stated design, #358); Bell to Bell and
   Hearth got the block they never had, both on the `guild-board.png` fallback;
   the offsite `aspermylessonplan.com` notice was a bug in the script, not a
   page (#357); and Numina keeps its own tags, exempt but verified, because it
   is an Eleventy site whose committed build output would drop any block
   injected into it (#357).
2. **Asset weight. Closed by PRs #371, #377 and #380** (#619 to #625). The
   row's ~335 MB was stale by the time anyone measured it: Bell to Bell stood
   at 77 MB and Fourth Quarter at 76. `Tools/board-check/asset-pipeline.mjs` is
   the pipeline: dev-only, recipes read their originals from git at a named
   commit, packages installed `--no-save` from the versions in its header, and
   every output's raw size must beat its source's gzipped size or it exits 1.
   Four recipes: Bell to Bell's eight outfits (25.3 to 1.6 MB of meshopt
   `.glb`, `tests/characters.mjs`), its 64 textures (31.1 to 8.9 MB, the six
   hand-sized props at 512, one set), its eleven props and picture frame (3.8
   to 1.1 MB of meshopt `.glb` naming the same loose JPEGs,
   `tests/props.mjs`), and Fourth Quarter's two texture tiers (2k 69.2 to
   23.0 MB, 1k byte for byte). Bell to Bell's referenced bytes went from 62.1
   MB to 13.4. `--check` holds every texture to its error against the
   original. Still **not measurable here**: whether the host gzips `.gltf`
   and `.glb`. The host is Cloudflare Pages, whose proxy 403s this sandbox,
   so every number above is raw bytes and gzip-6 bytes side by side; a
   `curl -sI -H 'Accept-Encoding: gzip'` from a real machine settles it.
   Castle Conundrum was the third game and is doing its own version of this in
   its own repo (#491). Not touched: Bell to Bell's four paintings (1.78 MB).
3. **`gvb-save.js` v2. Closed by PR #325** (#494 to #502): `slot.usage()` and
   `slot.lastError` for quota accounting, `createNamespace()` for many keys under
   one prefix with one bundle file, and `createAsyncSaveSlot()` for the IndexedDB
   tier, same key and same bytes, with a read-time promotion from localStorage.
   The Schedule Visualizer that first wanted it is archived (#206); Hearth's and
   Bell to Bell's saves are the standing candidates, and nothing has adopted it
   yet on purpose (#501). `assets/js/README.md`, "v2".
4. **Real hardware.** The atmospheric pieces' performance numbers are all
   software rasterization (The Fourth Quarter is the exception: its round-1
   frame times were real Chrome). Touch input has "never had a thumb on it" in
   three separate notes files. **And two previews are drafts** (#630): Golden
   Hour's and Blue Hour's were captured under Xvfb and SwiftShader on
   2026-09-24. Recapture both (`npm run previews golden-hour`, then
   `blue-hour`), look, and `npm run promote golden-hour blue-hour`; the same
   run is the one that can settle Golden Hour's real-time `play-games` beats.
5. **Ownership. Closed by PR #278** (#354, #355). `Tools/prompt-builder.html`
   was owned by no prompt and hotlinked Google Fonts, and the second was
   downstream of the first: no area owned the page, so no area's round ever
   looked at it. The fonts are vendored into `Tools/prompt-builder/fonts/`, and
   `Tools/board-check/ownership.json` now names an owner for every `.html` in
   the repo, with `check-integrity.mjs` failing any page that has none. On its
   first run it caught one nobody knew about: `Projects/The-Fourth-Quarter.html`,
   the original flat build, linked from the board at `index.html:508`.
   (`Tools/prompt-builder.html` used to have company in the sweep:
   `Projects/school-generator/tools/walk-shell.html` carried an HTML comment
   inside its module script, `SyntaxError: HTML comments are not allowed in
   modules`, at line 290, from Phase 27 until September 2026. Decision #261
   made the marker a JavaScript comment.)

One more, from Hearth's own wishlist rather than a site survey, recorded here
because it is a board question: **Hearth is on the homepage (`index.html:492`,
tagged Sim, `data-new`) with no `assets/previews/hearth.jpg`.** Phase 8
decided against a `Tools/board-check/games.mjs` entry (#84, Q14 answered): the
board's suite runs headed on a desk and would be a shallower copy of the
harness's `save` mode, which `hearth-ci.yml` now runs on every PR. The
330×200 capture is still wanted and is not a desk job (Hearth is a 2D canvas).
The social block is no longer waiting on it: Hearth has one as of PR #278,
pointing at the board's own `guild-board.png`. Promoting a real capture would
write `assets/og/hearth.jpg` and the block would pick it up on the next
`npm run social`.

### The site itself: Blender dioramas

Ranks 43 and 44, last in the Blender block (#642). One consistent diorama per
board card, so the board's previews and share cards read as a set.
Castle Conundrum is out of scope: its card and images stay as they are (#491).

**D1. The pipeline (rank 43, ½, gate `blender`).** The site's own copy of
`common.py` in `Tools/board-check/blender/` (#643; the site's area, #43 and
#51). One plinth, one camera, one light rig, one background, for every card.
It renders 2640 by 1600 (the 33:20 `promote-previews.mjs` crops from) into
`Tools/board-check/candidates/`, which is untracked; `candidates/chosen.json`
names the frame and `npm run promote <name>` writes
`assets/previews/<name>.jpg` and `assets/og/<name>.jpg`. `school-generator` has
a card and a preview but is not in the script's `KNOWN` set; add it. The
style sheet here is the plinth's size, the camera's angle and focal length,
and the light. A diorama uses the game's own Blender assets where it has them
(the `.glb` files, or the scene a sheet was rendered from) and is built for
the card where it does not.

**D2. The dioramas (rank 44, 2+, Sonnet 5, gate `blender`).** Four cards an
increment, the 3D games first: Golden Hour, Blue Hour, The Fourth Quarter,
Aphelion, then School Generator, Faire Weekend, The Absalom Inheritance,
Corner & Kettle, Orbital, Closing Time, Integer Foundry, Daredevil, The
Fracture Cycle and Torchbearer. Each increment rewrites this row to say which
cards are done. `npm run check` and `npm run social:check` stay green.

---

## Questions for Devon

Every open decision from every source, deduplicated by question, with how many
times and where it was raised. Six of these are cross-project and have been
asked repeatedly; the rest belong to one project each. A question here **no
longer blocks its work** (see rule 1 at the top of this file); a question
answered — by Devon, or by the session standing in front of it — should be
recorded as a locked decision in `HISTORY.md` and struck from this list.

**Struck so far: Q18**, "should Torchbearer be the site's PF2e rules engine, or
only its own?", answered by locked #133 while shipping Absalom Phase 1. The
answer is #17's: read the other engine and write your own, share the vocabulary
and not the code. Torchbearer has no open questions left.

**Struck: Q22**, "should the ladder be physically bigger?", answered yes by
locked #185 while shipping Fourth Quarter Phase 2's first increment: 30, 44,
58 and 76 seats up the ladder, one rectangle each until NPCs can path.

**Struck: Q28**, "should winning end the run?", answered by locked #241 and
#242 while shipping Faire Weekend Phase 4: no. The second track is renown,
and closing the season is the player's call, from the victory screen or the
weekend-end desk at Weekend 6 or later, with or without the win. Q27 gained
its other edge in the same phase, below, and is still Devon's.

**Struck: Q23**, "should there be a way to lose?", answered by locked #219 and
#220 while shipping Fourth Quarter Phase 9. Of the three options that question
listed, the losable lease is the one the rest of the game already supports: a
bankruptcy threshold is *how* the lease is lost, and a bank that stops lending
is a screen nothing else in this build has. Three consecutive nights closing
below $0 takes the room; losing it drops you a rung rather than ending the
run, and only an eviction from the Corner Tap — where there is no rung below —
ends one. The Fourth Quarter has three open questions left, none of them
blocking anything ranked.

**Struck: Q44**, "Blue Hour's causeway: which of the three ways out?",
answered by locked #523 while shipping the causeway: the first. The hill's
climb follows the trail's arc-length height, read by z, and the trail itself
does not move. Re-anchoring `trailYof` would have moved every altitude term in
the piece with it; widening the bench would have kept the drop and argued with
the blaze posts. Blue Hour has two open questions left, Q45 and Q46 (the
phantom's pan), neither blocking anything ranked.

**Struck: Q36**, "is a character builder welcome?", answered yes by locked
#304 while shipping Numina Phase 3's first increment, on the one condition
that the builder refuses to invent a number (#305). The full answer is in the
answered list at the foot of this section. **Q32, the attribute cost curve, is
not answered by it and was deliberately not pre-answered** — the module leaves
those purchases unpriced instead, so the question is still Devon's and still
open. **Q33, whether the Excellencies chapter should be ported at all, was
answered by Phases 5 and 6 and is struck** — locked #318, and the full answer is
in the answered list at the foot of this section. Numina has three open
questions left (Q32, Q34 and Q35), none of them blocking anything ranked.

**Struck: Q38**, "does `characters.html` get a commented-out `<template>`
dossier block?", answered yes by locked #627 while shipping it on 2026-09-24,
and struck from the table on the same day by the session that retired Q39's
ranked row (#628). Q39 is still Devon's.

**Struck: Q1**, "is `Pathfinder/data/**` a published interface other projects
may read?", answered **yes** by Devon on 2026-09-13, locked #350: it is public
reference data copied into the site, and any project may read it.

**The `Where` column names files that no longer exist.** The prompts, the
notes files and the ten handoffs were deleted in this consolidation; they are
cited by name so a raise count can be checked, and `git log` is where they
live. Nothing in that column is a link to follow.

### Asked more than once, across layers

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| ~~Q1~~ | ~~**Is `Pathfinder/data/**` a published interface other projects may read, or private to the Pathfinder pages?**~~ Struck — answered by Devon, #350: published; any project may read it, `Pathfinder/data/README.md` is the contract. 24 JSON files of PF2e rules data sit there. The Absalom Inheritance reads none of it and hand-writes three stat blocks and seven commands into `content/vault.json` instead; Torchbearer would build its own monster and treasure tables if the answer is private. Both considered depending on it and both correctly stopped rather than assume. `UPGRADE-PATHS.md` calls it the highest-leverage *decision* on the site. | **6** | prompt 01's block (the central tracker), prompts 10 and 11 raising it into that block, `Projects/torchbearer/WISHLIST.md`, `Projects/absalom-inheritance/WISHLIST.md`, `UPGRADE-PATHS.md` "Close behind", `gvb-site-handoff-v10.md` "Three things" and §11.4 |

### Bell to Bell

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q7 | **Should the authored three become seeds too?** Phase 2 answered "authoring or generation" by shipping both: 4th, 5th and 6th are authored and the 7th is drawn from a seed. Converting an authored period is one JSON edit each, and its kids' names and notes would go. Nothing depends on the answer. | 2, reframed after PR #106 | `Projects/bell-to-bell/WISHLIST.md` |
| Q8 | **Does the period need a fail state?** Answered "still no" three times. Confirming it lets Phase 3 stop designing around the possibility. | 2 | wishlist, `docs/HANDOFF.md` |
| Q9 | **Is suppression too strong?** Measured: in every 4th-period balance run exactly one scheduled tell never happens (Priya in front of June); splitting the pairs makes that "2 never happened, 2 found another way" and drops restless from 72 to 44. The handoff's own fix, if it is too strong, is a per-period cap on how much one kid absorbs, not a nerf to the effect — and now watch it across *two* rosters (Priya and Anh both), not just one. | 2 | wishlist, `docs/HANDOFF.md` |
| Q10 | **Is the Observation's ambient Mastery cost calibrated?** `CFG.observation.masteryDrainPerSec` is 0.008 — ~5 points over the window, by design math and not by playtest. In the table it costs the good teacher nothing visible (79 either way) and buys 10 Fidelity if performed. | 2 | wishlist, `docs/HANDOFF.md` |
| Q11 | **Mobile.** Undecided, and the answer determines whether Phase 8 exists. `input.js` has `touchstart`/`touchmove` look and no way to walk or to press E, Q, R, T, O, H, G or F. | 2 | wishlist, `docs/HANDOFF.md` |
| Q12 | **An announced Observation variant?** Treatment §6.1 has both announced and surprise; only unannounced is built. The handoff calls the surprise one funnier and rates this low; Phase 4 assumes yes. | 2 | wishlist, `docs/HANDOFF.md` |
| Q13 | **Should Room Temp reveal direction at all?** "Still unchanged." Room Temp names bands and quadrants only; naming is what the Withitness mode is for. | 1 | `docs/HANDOFF.md` only |

### Hearth

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q16 | **Does the name-recycling quirk stay a feature?** Songs live on names (`songs[].kn` is a list of strings) and the ancestor-naming rule can hand a newborn a dead knower's name, so that child "knows" every song the ancestor knew and can resurrect a lost one. Rare; reads as poetry; fixing it means packing knower identity beyond names. Keep, or pay for identity? | 2 | wishlist, sprint 16 handoff |

### The Absalom Inheritance

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q20 | **Is the split between builds the design, or a tuning debt?** Round 3 called the asymmetry deliberate at 53.6% / 79.8%. Phase 1 narrowed it to **64.5% / 79.8%** without meaning to — Shield Block is worth about eleven points to the Wizard and Reactive Strike is worth nothing measurable to the Fighter — and Phase 2's two condition sources moved it again, to **65.3% / 79.3%**, so the gap is 14 points rather than 26 and the question is live rather than settled. Neither phase was aimed at it; both narrowed it, which is itself an argument that the 26 points were tuning debt. If the two builds are meant to be comparable challenges, `balance.mjs` needs a band per build rather than one shared 45–90% window; if they are an easy mode and a hard mode, the picker should say so, since a player choosing Kessa Vane cannot tell. **Measured again after Phase 6 (PR #164): 79.5% / 69.3%, a gap of 10.2 points**, and the thing that moved it was content rather than a build — the undercroft's boon pays Vesper 5.2 points and Kessa 1.4, against a fight that costs them 4.5 and 6.3. That is the first evidence in this question's history that the gap is content-shaped rather than kit-shaped, and it argues for the per-build band. **Measured again after Phase 7 (PR #166), and the question changed shape: there are four builds now — 79.1% / 74.4% / 69.3% / 68.0% — so "the split between builds" is a spread of 11.1 points across four rather than a gap between two, and the two new ones landed in the middle of it on their second tuning pass.** A per-build band is a bigger ask at four than it was at two; a single 45–90% window that all four sit comfortably inside is also now evidence that the window is doing less work than it looks like. Still unanswered, and still Devon's. | 2 | `Projects/absalom-inheritance/WISHLIST.md`, PRs #151, #153, #164 and #166 |
| Q21 | **Does the adventure grow, or does the engine deepen?** Twelve to sixteen minutes, two rooms, four fights. Arc one deepens the engine on the rooms that exist; arc two spends the same effort on more rooms. A taste question, not a technical one. | 1 | wishlist |

### The Fourth Quarter

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q24 | **How much of the 2D campaign is actually wanted?** 21 event cards, a 14-week season with a 4-team bracket, regulars, a rival, three distributors. All of it ports; none of it is small; a 3D floor game with a full back office is a different game. Phases 6–9 assumed "most of it, in that order" and all four have now shipped — the league, the regulars and the rival, the event cards, and a losable lease. What is left unported is the distributors (and the two event cards about them), staff as a simulated system, and per-lot shelf life; none of it is ranked. | 2 | wishlist, README roadmap |
| Q25 | **Is 66 MB of texture on first paint acceptable?** 27 JPEGs, 69,218,191 bytes, all 27 loaded by the first room. Uncompressed in GPU memory that is roughly 600 MB with mipmaps (2048² × 4 × 27 × 1.33 — arithmetic, not a measurement). Phase 4 cuts it by an order of magnitude at some visible cost. | 1 | wishlist |
| Q26 | **Has `SPOILAGE_RATE = 0.15` actually been played yet?** One number in `campaign.js`, tune by feel; no assertion depends on the exact value except one asserting 15% of 20 rounds to 3. | 3 | wishlist, prompt 07, README roadmap |

### Faire Weekend

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q27 | **Are the four economy numbers right?** `perGuestCost: 5`, `upkeepRate: 0.07`, `bankruptcyFloor: -6000` and `winCondition`'s three thresholds have been flagged "most likely to need adjusting after real play" for four rounds running, and no round could answer it because nobody has played a full season. The `SIGNIFICANCE:` tests prove they are not degenerate, not that weekend 6 is a satisfying place to arrive. **Partly answered by Phase 1 increment 2:** `perGuestCost` stays at 5, ruled rather than assumed — it was tried as the counterweight for the walk-based stall economy and SIGNIFICANCE 3 refused it, because a per-head cost scales with the crowd whether or not anything is being sold and at $11 a head "charge the maximum" becomes correct again on a faire with no stalls (#228). `wristbandCut` moved instead, 0.28 → 0.12. `upkeepRate`, `bankruptcyFloor` and the three `winCondition` thresholds are still unanswered, and increment 2 added a check that pins one edge of the last one: a built-out faire cannot bank $25,000 in two weekends. **Phase 4 pinned the other edge, and it is the one that matters:** a scripted manager playing from a real start banked $28,000 to $104,000 by Weekend 6 across six seeds and a dozen builds and never took reputation past 63 from 50, because satisfaction sits in the 60s once the crowd outgrows the stages and attendance grows with the reputation the bar wants. The cash bar is trivial; the reputation bar is out of reach for any manager the suite could write. `minCash` and `minReputation` are the two to look at together. **Phase 7 moved the reputation half, and this is evidence rather than an answer:** the same scripted manager, staffing the grounds the morning after the first day anybody was turned away, finishes season one at reputation 74 — up from the 69-72 the same script reached before the crew existed, on a fixture that seeds reputation at 70. The bar may be reachable now. Nobody has played it. | **5** | `Projects/Ren-Faire-Claude/WISHLIST.md`, prompt 09, the project's notes, `HANDOFF.md` backlog |
| ~~Q28~~ | ~~**Should winning end the run?**~~ Struck — answered by #241 and #242 (Faire Weekend Phase 4): no; renown is the second track and closing the season is the player's call. | 1 | wishlist |
| ~~Q29~~ | ~~**Is the 1080px breakpoint a touch device?**~~ Struck — answered by #249 (Faire Weekend Phase 5): a width is not a pointer. The 38px cell is gone at every width and the touch sizes (48px cell, 44px buttons, slider and `<select>`s) hang off `(pointer: coarse)`. Measured on a fine pointer and left there: slider 275×16, `<select>`s 175×31, 190×32 and 134×32. | 2 | wishlist, the project's notes |
| ~~Q30~~ | ~~**Does the fixed `fit-content(710px)` board column bother you?**~~ Struck — answered by #246 and #247 (Faire Weekend Phase 5): `main.js` sets `--cols` on `#board` and the column is a `calc()` off it, 710 → 525px on the Home Grounds. The "~54px of empty mat" was 187px of the map's brown gap colour, not mat. | 3 | wishlist, prompt 09, the project's notes |

### Daredevil

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q31 | **Is the six-way Earl response at the fair the shape it should be?** Open since round 1. Only option 5, "I need to talk to someone first," reaches `m1_ruthie` and sets `rels.ruthie = 'solid'`, so five of six answers lock Ruthie out of all four hubs and the epilogue for the whole game. Option 5 is also the only one that never sets `rels.earl`, so a Ruthie run carries Earl as `'unknown'` to the ending screen, where the epilogue prints "Earl Maddox. The relationship is still being decided." after a run in which he backed every show. | 3 | `Projects/daredevil/WISHLIST.md`, the project's notes (twice, rounds 2 and 3) |

### Numina

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q32 | **What is the attribute cost curve?** `skills/attributes-vitality.md` gives "Cost to Increase: *Cost of next attribute*" for Prowess, Insight, Fortitude and Vitality — circular, and the escalating numbers appear nowhere in `src/` or `source-material/markdown/`. Are they in the PDF's chart and the conversion dropped it, or genuinely unpublished? **This no longer blocks the builder:** `build-rules.js` leaves those purchases in `cp.unpriced` and flips `cp.exact` false (#305), so a build that raises an attribute comes back with a floor rather than a total. An answer here turns that floor into a number. | 1 | `Numina/WISHLIST.md` |
| Q34 | **Do the eight nations with a blank `capital` have one?** Kindaria, Merrigor, Mists of Eltiel, Myos Islands, the Principalities of the Reach, Rues, T'barris and the Vale of Scyllina are `capital: ""`; five are `demonym: ""` (the Five Duchies' entry says outright that it has none). If the book does not name them, the infobox should collapse rather than render a flag chip over one "See also" row. | 2 | wishlist, audit A4 |
| Q35 | **Is the custom-domain move happening, and when — and does `numinalarp.com` serve HTTPS?** The README calls it a one-line `PATH_PREFIX` change and `site.json`'s `origin` feeds every absolute URL, but `test/smoke.mjs` hardcodes both `PREFIX` and `ORIGIN`, and `test/a11y/packet.mjs` hardcodes the prefix too (Phase 7). **The HTTPS half now needs one person and one page load, and nothing else.** Batch 1 could not verify it from its sandbox, and neither could Phase 5, which was refused at the environment's network egress before a request left the box — that says nothing about the host. The links stay `http://` until somebody can load it, because an `http://` link to a host that redirects still works and a `https://` link to a host that does not serve it fails outright (locked #319); the reasoning is a `websiteSchemeNote` key in `site.json` now rather than a checklist line. | 3 | wishlist, audit D4, Numina Phase 5 |

### The projects with no wishlist

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q39 | **Should `characters.html` adopt `gvb-save.js` for in-browser editing?** Only if the page's role should shift from showcase to living character sheet. Not requested in three rounds. Its ranked row was retired here on 2026-09-24 (#628); `Pathfinder/tests/showcase.test.mjs` fails on the first line of the feature, so a yes means narrowing that check. | 4 | prompt 03, and its notes in rounds 2 and 3; rank 2 on 2026-09-24 |
| Q40 | **Does Aphelion ever need to run on a tablet or phone?** Four rounds re-derived "no evidence yet" from scratch rather than asking. The answer decides whether a touch/gamepad input scheme gets built. Nothing in the game reads a touch or a gamepad today, so on a phone without a keyboard it can be looked at and not played. Its ranked row was retired here on 2026-09-24 (#629); `Projects/aphelion/test/desktop-input.mjs` fails on the first line of the feature, so a yes means deleting the rule it trips. | 4 | prompt 04, and its notes in rounds 2 and 3; rank 2 on 2026-09-24 |
| Q42 | **Is Closing Time's multi-career history worth the save-shape work?** Whether the career ending is more than a one-time wall, and whether players actually hit it repeatedly. Three rounds of notes have said the same. | 3 | prompt 06's notes across three rounds |
| Q43 | **If Golden Hour's night proves popular, should the owl hunt?** One swoop over the dunes, no kill shown; and the fireflies drifting toward the fire when it burns. | 1 | the project's notes |
| Q45 | **Blue Hour's direction: keep pushing into `dread.js`, or lock "no save, no verbs, no collection" as a decision?** The ending pass committed hard to dread over collection, so Golden Hour parity is now the odd option out and shouldn't be adopted without asking. | 2 | prompt 24, the notes' sessions 2 and 4 |
| Q46 | **Blue Hour's phantom pan: accept 0.000, or point `downhillAt` at the fall line?** The second changes the eyes' drift and the shape's head-flip too, since all three read the same function — an argument for doing it deliberately or not at all. | 1 | prompt 24, session 6 |
| Q47 | **Should Integer Foundry's tile-cost hint be more prominent once `×2` lets a sink ask for a three-digit number?** The tooltip already explains the cheap recipe. A design question, not a bug. | 2 | prompt 14, the project's notes |
| Q48 | **Do Integer Foundry's two model gaps get built despite the coupling argument?** Two rounds have looked hard and declined; the third added a real argument for why they are one piece of work, not two. This is the one thing that would pull the project back off the shelf. | 2 | prompt 14, the project's notes |
| Q49 | **Does The Fracture Cycle get a 4th prong or deeper side content?** Not a gap being filled — new content Devon chooses to commission. Two rounds have said the same. | 2 | prompt 15, the project's notes |
| Q52 | **Does Orbital adopt `gvb-save.js` for save-bar UI consistency?** Not needed for correctness — round 1 proved the existing migration round-trips clean. Purely a question of whether UI consistency with the other eleven adopters is wanted. | 2 | prompt 21, the project's notes |

### Answered, kept here so they are not re-asked

- **Four Castle Conundrum questions were answered here and moved with the
  project on 2026-09-15** (#491): whether the fourth bell forces the accusation
  (was Q55, #490), whether the riddle survives as the muniment room's word-lock
  (was Q56, #447), twelve NPCs from three bodies or a fourth model (was Q53,
  #419), and ranks 1 to 7 for the seven phases (was Q58, #420). Their answers
  and their reasoning are in
  [`GreyVersusBlue/castle-conundrum`](https://github.com/GreyVersusBlue/castle-conundrum)'s
  `HISTORY.md`. The two that stayed open, Q54 and Q57, went with them and are
  that repo's to answer.

- **Should the Serve button require full order completion?** (was Q2)
  Answered by the session that shipped Corner & Kettle Phase 3, 2026-09-12:
  **no — it stays loose and says what the click costs**, locked decision #341.
  A short cup reads `Serve 3/5` in a warning style and names what is missing;
  an empty cup is disabled and names what it needs. Partial credit is priced on
  purpose (`price * (0.35 + 0.65 * ratio)`), and on the same seeds the hard
  gate's numbers are exactly the patient player's ($1,927 a day, 1.000) against
  $1,457 and 0.719 for a player who ignores the cue, so the difference is now
  printed on the button. Reversible in one line: `serveReadiness()`'s
  `canServe` becomes "nothing missing".

- **Should the Excellencies chapter be ported at all?** (was Q33) Answered by
  the session that shipped Numina Phases 5 and 6, 2026-09-12: **it was never
  withheld, it was never converted, and it is ported now** — locked decision
  #318. The chapter runs pages 60 to 75 of `rules-2026-v3.51.pdf`, printed in
  full, 30 Excellencies and 239 skills in exactly the five-column tables the
  rest of the rulebook uses. Nothing about it reads as held back; what was
  missing was a `source-material/markdown/` file, which is a gap in the
  conversion rather than a decision by staff. `skills.json` went 189 skills to
  428. The hidden Excellencies table is a separate and still-hidden thing and
  was not touched. Reversible: delete one markdown file and re-run the
  extractor.

- **Is a character builder welcome?** (was Q36) Answered by the session that
  shipped Numina Phase 3's first increment, 2026-09-12: **yes, on the
  condition that it refuses to invent a number** — locked decision #304.
  Every verdict `build-rules.js` returns carries `unofficial: true`, and the
  in-game unlocks, the hidden-Excellency approvals and the third Expression's
  email come back in `verdict.provisional` beside the bill rather than as fine
  print under it. A cost the book does not publish goes in `cp.unpriced` with
  the book's own words, never a guess (#305). Reversible cheaply: the caveats
  are data, and removing the page leaves `skills.json` where it was. **Q32 is
  a different question and is still open** — it was not pre-answered, because
  the module does not need it to be.
- **What should "Not interested" to Earl actually do?** Answered by the
  session that shipped Daredevil Phase 1's first increment, 2026-09-10:
  **(B), the self-financed middle game** — locked decision #265. `_chapter_m2`
  routes `rels.earl === 'absent'` to `m2_solo_entry`, nothing sets Earl back,
  and Free Roam 2 opens on the debt. Reversible by rerouting one arm. Was Q3.
- **Does the engine (Torchbearer) grow past level 3?** Answered by the
  session that opened Phase 6, 2026-09-06: **yes, to 10** — locked decision
  #111. The level is a field on the build, `MAX_LEVEL` is 10, and guide §13's
  "correct-feeling PF2e at level 3" is rewritten when the level-up flow
  ships, not before. Was Q19.
- **Should `campaigns.html` and `characters.html`'s shared CSS and fonts be
  merged?** Answered round 2: **harmonize, don't share.** `[shared]` drift-guard
  comments mark every byte-identical rule; locked decision #17 stays in force
  for this pair. Raised independently three times before it was settled.
- **Is one clean verification round enough to call a project done?** Answered by
  Devon, 2026-08-03: **yes**, matching the precedent already set.
- **Should The Fourth Quarter's night loop have a day-based difficulty curve?**
  Answered: **spoilage**, built in round 3. Rent already scaled with venue tier.
- **Should Hearth join the board's regression suite?** (was Q14) Answered by
  Hearth Phase 8, locked decision #84: **no.** `npm run games` is a headed
  desk run and an entry there would be a shallower copy of the harness's
  `save` mode, which CI now runs on every PR. The preview is parked with the
  social-tag cleanup.
- **Does Hearth get a CI workflow, and in what shape?** (was Q15) Answered by
  Hearth Phase 8, locked decision #83: **`hearth-ci.yml`, two jobs.** A PR
  gate of `determinism` + `save` + a twelve-day `soak` + `pinned`, and a
  nightly matrix of the other fifteen modes that never runs on a PR.
- **Does the population cap overshoot actually grate?** (was Q17) Answered by
  Hearth Phase 7, locked decision #82: **kept, and named.** The cap counts
  beds and a boat has to find one; a baby is born into its parents' house. The
  one is `BIRTH_OVER` in `Projects/hearth/js/core.js` with the reason beside it.

---

## Ownership

Which paths each area owns, and which shared paths it may not change alone.
Lifted from the retired prompt system's boundary table, which is the only place
this was ever written down. **The "shared, do not touch alone" column is now a
"say so in your PR" column, not a queue**: make the edit in your own branch, in
the same commit as the project change, and call it out in the PR body.

**`Tools/board-check/ownership.json` is the machine-readable half of this
table** (#355), and `check-integrity.mjs` fails any `.html` no area claims. The
two are meant to agree: change both, or the next page to arrive is owned by
whichever one you updated. The manifest carries two areas this table did not —
**Prompt Builder** and **Archived teaching tools** — and both are in the table
now.

| Area | Owns | Shared paths it must not change silently |
| --- | --- | --- |
| Anathema Archive | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py`, `Pathfinder/tests/` | `index.html`, `assets/js/gvb-save.js`, `Tools/board-check/**`, `assets/previews` + `assets/og` |
| Pathfinder Campaigns | `Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/` | as above |
| Pathfinder Characters | `Pathfinder/characters.html`, `Pathfinder/characters-assets/` | as above |
| Aphelion | `Projects/aphelion/` | as above |
| Closing Time | `Projects/Closing Time/` | the four shared |
| The Fourth Quarter | `Projects/fourth-quarter/`, **`Projects/The-Fourth-Quarter.html`** (the original flat build, board-linked at `index.html:508`, owned by nobody until #355 caught it), `.github/workflows/fourth-quarter-ci.yml` | the four shared |
| Golden Hour | `Projects/golden-hour-beach/` | the four shared |
| Faire Weekend | `Projects/Ren-Faire-Claude/` | the four shared |
| Torchbearer | `Projects/torchbearer.html`, `Projects/torchbearer/`, `.github/workflows/torchbearer-ci.yml` | the four shared |
| The Absalom Inheritance | `Projects/absalom_inheritance.html` (shell, URL unchanged), `Projects/absalom-inheritance/`, `.github/workflows/absalom-ci.yml` | the four shared |
| Corner & Kettle | `Projects/coffee_shop_sim.html`, `Projects/corner-and-kettle/` | the four shared |
| Daredevil | `Projects/daredevil/` (`Projects/daredevil_r4.html` is a redirect stub) | the four shared |
| Integer Foundry | `Projects/integer-foundry.html`, `Projects/integer-foundry/` | the four shared |
| The Fracture Cycle | `Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/` | the four shared |
| Orbital | `Projects/orbital/` | the four shared |
| Blue Hour | `Projects/blue-hour-trail/` | the four shared |
| Signal City | `Projects/signal-city/` | the four shared |
| Hearth | `Projects/hearth/`, `.github/workflows/hearth-ci.yml` | the four shared |
| Bell to Bell | `Projects/bell-to-bell/` — and its own `CLAUDE.md` governs inside it | the four shared |
| School Generator | `Projects/school-generator/`, `.github/workflows/school-generator-ci.yml` | the four shared |
| Numina | `Numina/` — **but see the constraint below** | the four shared |
| Prompt Builder | `Tools/prompt-builder.html`, `Tools/prompt-builder/` | the four shared |
| Archived teaching tools | the five #206 closed and their folders: `Tools/Name Picker.html` + `name-picker/`, `Tools/Seating Chart Generator.html` + `seating-chart/`, `Tools/final_grade_checker.html` + `final-grade-checker/`, `Tools/image-to-pdf.html` + `image-to-pdf/`, `Tools/schedule-visualizer.html` / `schedule-browser.html` / `schedule/` and the two dated Schedule pages | **no work opens against these** (#206) |
| The site | `index.html`, `404.html`, `newindex.html`, `landing.html`, `assets/` (including `assets/fonts/`), `Tools/board-check/` (except `play-castle.mjs` and any project's own test folder), `CNAME` | — |

**A project owns its own test suite**, including a browser-driven one that
imports `Tools/board-check/harness.mjs`/`drive.mjs` read-only —
`Projects/fourth-quarter/test/`, `Projects/integer-foundry/test/browser.mjs`
and others. Those are per-project
files even though they drive a browser the same way the shared tooling does.

**`Numina/test/smoke.mjs:180` enumerates Numina's allowed top-level files.**
`README.md`, `CONTENT-GUIDE.md`, `WISHLIST.md`, `package.json`,
`package-lock.json`, `.gitignore`, `eleventy.config.mjs`, `src`, `test`,
`tools`, `source-material`, `node_modules`, `.cache`, `discord-logs` and the
generated set — and nothing else. **Do not add a new top-level file under
`Numina/`**; `npm test` there fails if you do.
