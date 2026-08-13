# 24 — Blue Hour

## Session 6 — the walk down

Every design decision in this piece faces downhill and nobody had ever walked
that way. This session did: the bench to the trailhead in one go, 860 m, and
then it spent the rest of itself on what the descent turned up. No new verbs,
no new persistence, no new systems — none was granted and none was taken. Four
commits, both suites green at each.

**smoke 93 → 104. browser 72 → 95.**

### The walk itself

A scratch harness (not part of the suite) boots the real page at 480×300, puts
the walker at the bench and holds W with pure-pursuit steering four metres down
the centerline, pausing eight world-seconds every hundred the way a walker
pauses. It logged every world-second and every event.

**23 real minutes, 470 world-seconds, arrived at (0.5, 145.4) standing on the
trail. Never more than 1.6 m off the centerline, never on any surface but trail
and bridge, zero page errors, 840 recorded footsteps.** Six beats fired
naturally on the way down — howl at t 0.86, snap at 0.73, bear at 0.56, snap at
0.34, silence at 0.15, snap at 0.03 — 70, 63, 79, 99, 86 and 61 world-seconds
apart. Frames captured at every tenth of the trail and looked at.

The walk answers the three questions it was sent to ask:

- **Does the director still spend beats sensibly when the yaw histogram
  inverts?** Yes, and better than sensibly: it spends FEWER of them. `intensity`
  reads trail progress and altitude and both fall away behind a descending
  walker, so the cooldown the scheduler sets at the summit (33–62 s) cannot
  overlap the one it sets at the trailhead (65–118 s) — hard bounds, not
  overlapping distributions. The gaps the real walk heard climb through exactly
  that band. The mountain runs out of things to say to you as you leave, which
  is the right shape and nobody had designed it on purpose.
- **Do the fog cycle and the altitude blend hand the woods back gracefully?**
  Yes, with a number: **the largest change in fog density in any world-second of
  the whole descent was 0.0006, and it happened inside the 46→62 m band.** The
  fog cycle on its own does 0.0004/s. The summit letting go is gentler than the
  weather the piece breathes anyway. (One artifact worth knowing: the first
  sample after a teleport shows a 0.02 jump, because `altT` reads `controls.pos.y`
  and that is a frame behind. It settles in one frame and never happens in play.)
- **Do the descending beats still read when the WALKER is descending?** Partly,
  and the exceptions are geometry rather than faults — see the next two sections.

### Everything descends, including the walker — what that does to three beats

**The shape.** Its head-downhill flip is real and never inverts, but staged from
a downhill facing the *read* collapses: 0.02–0.28 typically, against 0.99 on the
legs where the trail crosses the slope. The head axis lies across the line of
sight, so with downhill running away from the camera there is no profile left to
point with. The old check demanded > 0.05 and was only ever staged from a
climbing facing; it would have failed on the descent, and did, at 0.017.
`bearInfo()` now hands out the head's world direction after the flip and the way
downhill, so the suite can check the SIGN instead of an absolute value that
would read fine with no flip at all. Verified by removing the flip: 3 of 8
stagings turn to face up the mountain.

**The phantom steps.** Their downhill pan is **exactly zero** — not nearly.
`downhillAt` returns the reverse of the trail tangent, so a walker facing along
the trail has downhill dead ahead or dead behind. In closed form, with
yaw = atan2(−dx, −dz), pan = (−dx)(−dz) − (−dz)(−dx) = 0, and the about-face
only flips both signs. Measured: −7e-17 descending, −2e-17 climbing. The beat's
descent is carried entirely by the falling pitch. That is now a browser check —
as a tripwire, not an endorsement: it fails the day anyone points `downhillAt`
at the terrain's fall line, which is the decision (prompt task 11).

**The eyes.** Unchanged in kind: staged 16–26 m out, and the walker closes on
them either way. What changed is what happens when they go — see the doctrine
break below.

### The causeway: the descent sees what the climb hides

At t 0.8 the walk came back with a frame of the trail as a raised earth levee
with the treetops below it on both sides. Measured against the heightfield, 5 m
out past the 4.5 m blend shoulder:

| t | 0.30 | 0.40 | 0.50 | 0.60 | 0.70 | 0.80 | 0.90 | 1.00 |
|---|---|---|---|---|---|---|---|---|
| proud of both shoulders | −4.2 | −1.2 | **2.5** | 4.9 | 6.7 | 8.2 | **10.9** | 6.0 |

The bottom half is a proper bench cut into the hillside (negative = shoulders
above the trail). From **t 0.49** up it is a causeway. The prompt file had this
as "the last stretch rides a ~5 m berm, invisible now"; it is neither only the
last stretch nor invisible. `mountainH` is a ramp in z alone while `trailYof` is
analytic in arc length, and the switchbacks make arc length outrun z.

The "invisible" half is settled by a matched pair of frames from the same spot
at t 0.8: **looking up the trail is an ordinary forest path** with the near trees
crowding both sides and the flanks below the sightline; **looking down it is a
levee** with the crowns of full-height conifers level with your boots. Six
sessions of climbing is why nobody saw it.

Not fixed, deliberately — it moves the heightfield and rebaselines a dozen
pinned expectations, which is Devon's call for the same reason the missing peak
was (session 2). `smoke.mjs` holds 10.9 m as a **ceiling**, and the three ways
out are written up as prompt task 10, with the note that whoever takes it should
walk down afterwards rather than up.

### The doctrine break: a sting that only fired if you ran the experiment

Counting stings for the figure's promise is what caught this. `dread.js` fired a
`lowSting` when the shape went, guarded by `_bearSeen && _bearLife > 0` — seen,
and not timed out. Both surviving ways out of that `gone` are the experiment:
looked away and looked back, or walked out to where it stood. So the sting fired
**if and only if the player ran the test, and never when they didn't.** The eyes
had the same sound on closing to 15 m, which is the player going to look.

Gone Home doctrine, rule 3, is written against that precise sound: *"there is
nothing — and no sting, no cue, no sound of it having left. The scheduler must
never reward or punish investigation. Unfalsifiable means the game doesn't even
confirm the question was asked."* The doctrine postdates this code (session 3;
the stings are session 1) and it wins every tie. Both sounds are deleted. The
lookout's single notice stays — that is noticing, not investigating.

The descent is what exposed it: coming down you close on a shape staged 45–65 m
ahead at a full 2 m/s, with no grade slowing you, and the sting lands every
time. Climbing, it is occasional.

**This is the one change here a listener could notice, and it is a deletion, so
it is one line each to put back.** Considered and rejected: moving the sting to
the timeout path instead — that just inverts the correlation, and a careful
player could still read "silence means I caused it".

### The ghost of a whole walk — the record had no descent in it

The prompt asked whose gait the phantom borrows from a round-trip record. The
answer turned out to be upstream of the question.

Measured against the real heightfield with controls.js's arithmetic and
audio.js's cadence, cross-checked against the live engine (the walk recorded 840
steps; the simulation said 839): **the climb is 975 recorded footsteps and the
descent 839, so a whole visit is ~1,814 — twice `ghost.js`'s 900-step cap.** The
cap was a hard stop. Every walker who went up and came back down saved a memory
that ended at t 0.917 of the CLIMB and contained no descending step at all. The
beat it feeds has been descending by authorship since session 4 and had never
once had a descending step to borrow.

Also measured, and contrary to the prompt's premise: **descending gaits are not
faster.** `_stepPhase += dt * 2.05` is speed-independent, so both halves record
0.50 s gaps. What differs is metres per step — 0.88 up, 1.02 down — which is
what makes the climb denser in t and therefore the nearest-t winner, along with
being recorded first and settling the ties. So the two gaits differ only through
pauses, which are exactly the human part.

Two fixes, both inside `ghost.js`, both pure, `v:1` untouched:

1. **The cap became a sampling budget.** At 900 the record thins by half in
   place and the sampling rate halves with it. A whole round trip lands at ~453
   steps, 5.3 KB, spanning t 0.001–0.999 with 209 taken on the way down. Every
   surviving gap is still one that was genuinely walked — nothing is averaged, a
   pause is kept or dropped but never smeared.
2. **`rhythmNear` asks the descending pass first**, falling back to the whole
   record when there isn't one. A walker who climbed and never came back down
   lends the climb they were on, which is the older behaviour exactly and also
   the right fiction: that one is still up there.

Verified by reintroducing each bug: the old hard cap fails exactly three of the
new smoke checks, and a direction-blind `rhythmNear` fails exactly one — and
fails it by answering 0.62, 0.41, 0.62, 0.41 across four altitudes, which is the
incoherence in one line.

### The flake class, met again in a new dress

Session 5's rule is never trust one measurement taken under swiftshader. This
session's instance: the walk checks measured DISTANCE against an fps-scaled
floor, and a hitch inside the six-second hold made a perfectly good descent read
0.2 m against a 0.3 m floor. Hardened by changing what is measured rather than
the threshold — the walker's **speed in the walker's own clock**, since
`weatherT` advances by exactly the clamped dt the walker moves on, so
distance ÷ world-seconds is metres per second whatever the renderer is doing. A
hold that draws fewer than two frames retries instead of reporting a walker who
cannot walk. Both the climb and the descent checks read that way now (1.41 m/s
up at the trailhead, 1.56 m/s down at mid-trail — not comparable to each other,
different grades and partial frames at both ends, so no race is claimed).

### What I verified (session 6)

- `node test/smoke.mjs` — **104 checks, 0 failed** at every commit (was 93).
  New: the way back down (a downhill step never rises so the descent is never
  slowed; an uphill one always does, the footbridge deck excepted as the only
  level ground on the mountain; the causeway ceiling; the bottom half still
  benched) and four more on the ghost of a whole walk.
- `node test/browser.mjs` — **95 checks, 0 failed** at every commit (was 72).
  New groups: the walk down (seamless handback, a real descending W-hold, the
  scheduler thinning out, the shape's sign, the phantom's zero pan), nothing
  follows you back down (six), the woods never admit the experiment (six).
- **Guard-rails verified by reintroducing the bug they guard** (locked decision
  #34), five of them: the old hard cap in `ghost.js` (fails 3 smoke checks), a
  direction-blind `rhythmNear` (fails 1), `altT` as a switch instead of a ramp
  (fails only the seam check, 0.0217 against a 0.003 bound), the shape's flip
  removed (3 of 8 stagings face up the mountain), and both investigation stings
  put back (the silence checks fail, one sting each).
- **Screenshots, looked at**: every tenth of the trail on the live descent at
  480×300; and at 1320×800, matched down/up pairs at t 0.9, 0.8, 0.7, 0.5 and
  0.3 (the causeway pair is the t 0.8 one), the shape staged while descending,
  the foot of the tower with the rail empty, and 10 / 20 / 45 m below the tower
  looking back with the figure at the rail again.
- Draw budget unchanged and re-measured in passing: 37 calls / 290k tris,
  identical in thick fog and clear.

### Shared-file requests — FOURTH SESSION CARRYING THIS FLAG

**The piece is STILL not on the board.** Checked again this session, by hand:
root `index.html` has no Blue Hour card and no `#g-peak` seal (0 matches for
either), `Tools/board-check/games.mjs` has no `blue-hour` entry (0 matches),
`Tools/board-check/capture-previews.mjs` has no recipe (0 matches),
`assets/previews/blue-hour.jpg` does not exist, and `Claude Prompts/notes/README.md`
still stops at 23.

That is sessions 2, 4, 5 and now 6 asking for the same four mechanical paste-ins.
**Blue Hour shipped in PR #8 and has been live and unreachable from the board for
six sessions.** The exact blocks are written out verbatim in the session-2
section below and have not changed; the one amendment (session 4) still stands —
no `saveKey`, because `blue-hour-last-walk` is not a save and must not be wired
into the shared save/reset tooling. Prompt 22 runs last and applies these;
nothing else will. **Please apply requests 1–4.**

### Deliberately not done

- **No GPU/touch/ears passes** (prompt tasks 3–5, and task 9's list) — they need
  Devon's hardware and Devon's ears, not this environment's swiftshader and
  silence. Not simulated, not guessed at.
- **Music levels untouched.** No listening notes from Devon again this session,
  so every gain stays exactly as authored — the session-3 condition, still
  binding, and still the reason nothing here was tuned by ear. The one audio
  change is a deletion made on doctrine grounds, not a level.
- **The summit geometry stays settled** — no peak, the fog closes. The causeway
  is measured and flagged, not fixed, for the same reason.
- **The mist, breath and lamp constants session 5 tuned are untouched.** They
  had their eyes-on pass; nothing this session measured them to be wrong.
- **No board-card or shared-file edits** — re-flagged above, loudly, for the
  fourth time.

## Session 5 — first light: the truth pass

No new verbs, no new persistence, no new systems — the amendments gave no such grant
and none was taken. This session's job was TRUTH: see the things session 4 made
renderable but nobody had ever looked at, read the writing the way a player reads it,
and walk the seams between the new systems. Four commits, each leaving both suites
green.

### First light on the mist and the breath (`js/atmosphere.js`)

Session 4 fixed the winding trap; this session was the first time anyone LOOKED. The
verdict on the blind-authored constants, measured with A/B drawing-buffer diffs
(mesh shown vs hidden, same framing):

- **In the woods the mist did not exist.** From the trail, the 26 banks touched under
  1% of the frame — placed 8–38 m off-trail, occluded by trees and the benched berm,
  fogged toward the exact colour they had to stand out against, at opacity ≤0.16.
- **The one bank that ever read on screen read as a perfect radial-gradient disc**
  hanging over the tower — a sprite, in exactly the way the prompt feared.
- **The breath was a screen wash, not vapour**: a 0.28 m quad spawned 0.35 m from the
  eye covers two thirds of the frame and reads as a bloom artifact.

The retune, all in `atmosphere.js`: a banked texture (a horizontal band of nine
overlapping lobes — nothing on screen can resolve into one circle) replaces the
radial disc; 30 banks of which 18 hug the trail corridor low enough to walk through,
6 stand deep for layers, and 6 pool deliberately at the waterfall and in the cabin
hollow; a near-camera fade in the vertex stage (`smoothstep(2,7,toCamLen)`) melts a
bank the walker enters instead of white-washing the frame or popping at the plane
crossing; opacity 0.14 + fogT·0.12 + altT·0.09 (was 0.07/0.09/0.07). The breath is a
hand-span puff at arm's length now (0.18 × 0.19 m at 0.55 m, grow ×1.1/s, was
0.28 m at 0.35 m growing ×1.6/s). Screenshots taken at trail, cabin hollow and
summit in clear, mid and thick weather — and looked at, which is the entire point.

### Pixels as proof, for the whole billboard family (`test/browser.mjs`, 70 → 72)

The steam's session-4 pixel check generalized: new group "no billboard in this piece
goes dark silently". Bank placement is random per load and every root drifts ±7 m in
the shader, so the check MOVES a bank (`__bh.mistReroot` — root, size, phase pinned)
in front of a known camera instead of hoping one is in frame, then reads the drawing
buffer with the mesh shown and hidden and demands the difference (measured margin
+8.2, threshold 2.5; breath via `__bh.breathBurst` staged ages, margin +7.3). Both
guards verified by reintroducing the winding bug they guard (locked decision #34):
`FrontSide` on the mist fails exactly the mist check, `FrontSide` on the breath fails
exactly the breath check, everything else stays green. New debug doors, none opened
by the piece itself: `mist`, `mistShow`, `mistReroot`, `breath`, `breathShow`,
`breathBurst`.

**Draw budget re-measured against HEAD in a worktree, same procedure both sides:
24–27 calls / ~282–286k tris, unchanged by this session** (same mesh count; one
canvas texture swapped). The swiftshader numbers still cannot see fill rate, and two
fill-heavy systems that never drew before are drawing now — the real-GPU run (prompt
task 3) got MORE urgent again, not less. Noted in the prompt file's task list.

### The read-aloud proofread (prompt task 6 — done)

All ten pages read in place through the overlay, in the order the trail gives them
(Hollis → Vann → Ruiz → Kessler June → Merrit → Kessler July → Doyle → Kessler
July 30/Aug 14 → Okafor → Marsh). The writing survives its own reading: Kessler's
"it is a bear, working the smell of the larder" written down twice is the piece's
thesis in one line; Okafor leaves the ring in the catwalk paint without a remark;
Marsh's log just ends. One clunk fixed in `field.js`: Doyle's "The tradition is you
build it going down, done —" stumbled aloud on the dangling "done"; it reads "on the
way down, when you are done" now. Every grant-1 rule reheld by ear: no entry confirms
danger or safety, none mentions the figure, Kessler ends calmer and unruled, Marsh's
absence stays unspoken.

### The seams, staged and judged (four questions each)

- **Headlamp + the figure**: cannot break, structurally — everything dread owns
  (figure, bear, eyes) is `MeshBasicMaterial`, unlit; the cone spends itself on the
  world and the world dims around the watcher. Opacity cap held at 0.46 with the lamp
  burning; the fog-dimming actually makes the figure HARDER to see lit, which is the
  right direction. Holds.
- **Headlamp + summit fog**: no volumetrics, so the cone cannot punch a dishonest
  hole in the fog — but the first look at the lamp on the walker's own feet came back
  a featureless blown-white disc. Inverse-square decay put 16× the reach's light on
  the near ground; no intensity satisfies both ends. **Fixed: decay 1 / intensity 4.5**
  (was 2 / 34) holds the same 12 m reach and returns the feet their texture.
  Screenshotted at the feet, up the trail, and on the summit ground.
- **Transmission + silence adjacent**: coexist in either order — carrier opens,
  self-static answers at echoGain 0.5, birdsSilent holds, duck stays at 0.15. The
  echo is the walker's own signal, so nothing reads as an answer. In natural play the
  cooldown keeps them ≥55 s apart anyway. Holds.
- **Cairn chip + headlamp chip**: they share the DOM element, last-writer-wins — but
  the nearest cairn stands 28.8 m from the lamp against a 4 m and a 1.6 m found
  radius, so the collision cannot be staged by walking; at 2 m/s the first chip is
  10 s gone before the second could fire. Holds, by geometry. (Found while staging
  this: the chip timer ticked 1/60 per FRAME, not per second — minutes of chip on a
  slow tab, 2.4 s on a 144 Hz display. Ticks `dt` now.)
- **Ghost at the trailhead, barely-recorded walk**: a 40-step record clustered on the
  first switchback replays its own 0.93 s gait verbatim at the trailhead, and high on
  the mountain — where the record has nothing within a tenth of the trail —
  `rhythmNear` returns null and the phantom falls back to the scheduler's invention,
  exactly the designed boundary ("a rhythm borrowed from nowhere is an invention, and
  inventions are the scheduler's job"). Holds.

### The flake class, met in person

The draw-cost-equality check failed once mid-session: 24 calls became 45 between its
thick sample and its clear one because wildlife crossed the frustum — nothing to do
with fog. Hardened per the suite's own rule (never trust one swiftshader timing):
the pair now retries into a quiet window, up to four attempts; fog-dependent
submission would differ on every attempt and still fail. Green twice since.

### What I verified (session 5)

- `node test/smoke.mjs` — **93 checks, 0 failed** at every commit.
- `node test/browser.mjs` — **72 checks, 0 failed** at every commit (70 → 72; the
  two pixel-truth checks). Guard-rails verified by bug-reintroduction, both
  directions (mist FrontSide → only the mist check fails; breath FrontSide → only
  the breath check fails).
- Screenshots, looked at, this session: trail/cabin/summit × clear/mid/thick before
  AND after the mist retune; a staged bank at 15 m (the bank-not-disc proof); inside
  a bank (no white-wash); breath against hillside and sky; the Doyle page in the
  overlay after the edit; the lamp at the feet, up the trail, and on the summit
  ground at three tunings.
- Draw budget vs HEAD, same procedure: 24–27 calls / ~282–286k tris both sides.

### Shared-file requests — THIRD SESSION CARRYING THIS FLAG

**The piece is still not on the board.** Root `index.html` has no Blue Hour card, no
`#g-peak` seal, `Tools/board-check/games.mjs` has no `blue-hour` entry, the previews
recipe does not exist, and `Claude Prompts/notes/README.md` still stops at 23. Every
block needed is written out verbatim in the session-2 section below, amended once in
session 4 (no `saveKey` — `blue-hour-last-walk` is not a save and must not be wired
into shared save/reset tooling). Blue Hour shipped in PR #8 and has been live and
unreachable from the board for five sessions. Prompt 22 runs last and applies these;
nothing else will. Please apply requests 1–4.

### Deliberately not done

- **No GPU/touch/ears passes** (prompt tasks 3–5) — they need Devon's hardware and
  Devon's ears, not this environment's swiftshader and silence. Task 9 in the prompt
  file now lists what the GPU run should specifically look at after this session.
- **Music levels untouched** — no listening notes from Devon again this session, so
  every gain stays exactly as authored (session-3 condition, still binding).
- **The summit geometry** stays settled: no peak, fog closes. Nothing here leaned
  on it.
- **No board-card or shared-file edits** — re-flagged above, loudly.

## Session 4 — the logbook, the three grants, and the mist that was never there

The full-hog session. Devon granted the three items the feasibility ladder had fenced off
behind an explicit yes, and the whole near-term ladder shipped with them. **All three
grants are recorded as amendments at the top of `Claude Prompts/24-blue-hour.md`** — that
section is now the authority on the piece's one verb, the named cairns, and the one thing
localStorage is allowed to hold. Read it before "fixing" any of them.

**Grant 1 — the logbook** (`js/logbook.js`, texts and placements in `field.js`). Ten
weathered pages, one verb: hold E over a page (hold the chip, on touch) and it comes up in
a quiet DOM overlay; release puts it down. No inventory, no counter, nothing remembers
what has been read. The writing was the heart of the session: eight keepers — Hollis,
Vann, Merrit, Ruiz, Kessler, Okafor, Doyle, Marsh — drifting administrative-to-personal
across the log. Kessler is the circling-the-tower arc, and the later entries go CALMER
("I noticed I had stopped counting the circuits… the way you stop counting stairs in a
house you live in"), never ruled madness or peace. Okafor repaints a catwalk rail "worn
through in a ring, the way a path wears" and moves on. Doyle states the cairn tradition
in-fiction, one page from their own cairn. Marsh — the eighth — rations the good tea,
gets carrier and no voices on the radio check, and is in no great hurry to be anywhere
but the window. Marsh has no cairn. Nothing says so.

**Grant 2 — the cairns get names.** `KEEPERS` in `field.js`, `cairn.keeper` per cairn,
chip reads "Merrit's cairn — 3 of 7". Seven for eight, countable, never counted out loud.
smoke pins the whole shape: eight named, seven cairned, exactly one uncairned, that one
present in the log.

**Grant 3 — the ghost** (`js/ghost.js`). One project-local key, `blue-hour-last-walk`:
the previous visit's footstep rhythm and route timing, clocked in world seconds
(`weatherT`, so a slow tab doesn't corrupt the gait), saved on pagehide only when the
walk was ≥40 steps. Next visit, the phantom-steps beat replays that rhythm near wherever
the walker stands — your own steps, from last time, descending. Never surfaced, no UI.
`gvb-save.js` untouched, deliberately.

**The ladder, all eight.** (1) Everything descends: `phantomStepPlan` (pure, in
`audio.js`) makes every phantom step lower and duller than the last, panned downhill;
the bear silhouette's head points down the mountain (scale.x flip against the trail
direction); the eyes drift downhill at 6 cm/s. (2) Attention director v0: 24-bucket
yaw-dwell histogram, ~45 s memory; visual beats land on the less-watched side and a
treeline stared down both arcs never fires — declined beats cost no cooldown and don't
set `_lastBeat`. (3) Dead radio at the cabin: prop on the sill, rare squelch-and-carrier
beat panned at the cabin, nothing in it. (4) Bootprints on the last switchback: 72
prints, deterministic, ascending only, t 0.90–0.965, fog-gated in `props.js` — come and
go with the weather. (5) Tea steam at the cab glass (plus the cab's window band, which
it never had): CPU-billboarded emitter at the bench-facing pane, always on. (6) The
headlamp: cabin step, F toggles, real SpotLight, and fill/ambient/key/fog-colour all
drop while it burns; director places eyes just past the cone's edge; never required.
(7) Beats change in KIND above the fog line: the `transmission`, gated on altitude alone
(candidates door proves no fogT reaches it from below), opens a carrier at the tower and
answers with your own delayed static 4 s later. (8) Music second pass: new stingers duck
the drone like the others; a barely-there D5 partial while the headlamp burns. No
listening notes from Devon this session, so every gain stays exactly as authored.

### The real find: the mist and the breath had never rendered

Chasing the invisible tea steam turned up the cause: the shared billboard basis
`bladeRight = vec3(-camDir.z, 0, camDir.x)` winds quads clockwise as seen from the
camera (triangle normal = −toCam), so under default `FrontSide` the mesh backface-culls
— silently. No page error, no shader warning, no pixels. **The mist banks (session 1)
and the breath vapour (session 3) had never drawn a single frame.** The undergrowth
shares the basis and only ever survived by declaring `DoubleSide`. The session-3 claim
that zero page errors was "the canary for the five new onBeforeCompile materials" was
wrong in exactly the way locked decision #34 warns about: the canary cannot see a culled
mesh. Fix: mist and breath declare `DoubleSide` (comment at the mist material tells the
story); the steam winds correctly on the CPU; and `browser.mjs` now reads the drawing
buffer and asserts actual steam pixels against the cab face. The trap is written into
the prompt file so a third billboard doesn't fall in.

### What I verified (session 4)

- `node test/smoke.mjs` — **93 checks, 0 failed** (was 52). New groups: the keepers
  (roster/cairn-gap pinning), the logbook (placement, reachability, doctrine words —
  no entry mentions the figure, no game-voice), the bootprints (count, ascent,
  on-trail, toe direction), the phantom descent (400 plans held monotone), the ghost
  (round-trip, corrupt-record degradation, gait filtering, save threshold, key name).
- `node test/browser.mjs` — **70 checks, 0 failed** (was 32). New groups: the logbook
  overlay (open under held E, close on release, chip lifecycle), cairn naming, the
  descending family (bear head downhill at three standoffs, phantom via the real
  just-stopped path), the director (real dwell accrual, five forced eyes all off-gaze,
  both-arcs-stared refusal), the small wrongnesses (radio, fog-gated prints, steam
  geometry AND steam pixels), the transmission gates (unreachable below at fogT 1.0,
  present above at fogT 0.0), the headlamp (inert before found, pickup, burn, ambient
  drop measured, cone-edge bias, D5 partial), the ghost (seeded record loads, phantom
  replays its 0.77 s rhythm verbatim, recording live, short-walk refusal).
- Screenshots, looked at: page prop on the trail (pale, missable, right), the overlay
  (quiet, serif, world dimmed behind), the cab with window band + steam wisp from the
  bench, headlamp off/on on the same framing (world darkens, cone honest), trail view
  with mist alive for the first time.
- Draw budget: the piece added ~6 draw calls across pages/prints/radio/lamp/windows/
  steam against a budget of 300; weather-equality untouched (nothing new toggles
  visibility with fog).
- Not verified, unchanged: real GPU, real glass, real ears (prompt tasks 3–5). The
  mist/breath fix makes the GPU run MORE urgent — two fill-heavy systems that never
  drew before are drawing now.

### Shared-file requests

**Everything from session 2 is still pending and still needed — the piece is STILL not
on the board.** Re-flagging all four, unchanged: (1) the board card in root
`index.html` (+ `#g-peak` seal), (2) the `Tools/board-check/games.mjs` entry, (3) the
preview recipe + `npm run previews blue-hour` + `npm run promote`, (4) the notes
README expected-names list. The exact blocks to paste are in the session-2 section
below. One amendment to request 2: the piece still has no `saveKey` and that is still
correct — `blue-hour-last-walk` is not a save and must not be wired into the shared
save/reset tooling (see grant 3 in the prompt file).

### Deliberately not done

- **No GPU/touch/ears passes** — environment can't provide them; see prompt tasks 3–5.
- **Music levels untouched** beyond the new D5 partial and stinger ducks — ladder item
  8 conditioned tuning on listening notes, and there were none.
- **The summit geometry** stays as session 2 left it (no peak, fog closes) — nothing in
  this session leaned on it.
- **No board-card or shared-file edits** — requests re-flagged above instead.

## Session 3 — the mountain gets a voice, and the piece gets a north star

Two halves this session: a high-fidelity pass Devon asked for (with adaptive music as its
centerpiece), and a direction conversation that ended with the dream version and its governing
doctrine written into the prompt file.

**Music.** The genuinely absent layer. A `_startMusic()` bus inside `Soundscape` —
`drone/motifs → _musicDuck → _musicBus (35 s fade-in) → master → fog filter`, so mute and the
fog muffle apply for free and nothing slams on the first click. Eight drone oscillators in D
aeolian: detuned pairs on D2/A2 that throb at a tenth of a hertz, D3 and F3 for body and the
spoken minor 3rd, and the two altitude voices — E♭2 beating at ~4.4 Hz against the root above
the fog line, A♭2 (the tritone) only near the summit, ×1.6 while the lookout figure watches
(`watched: dread.lookoutWatching`, the one new field in `audio.update`'s state). The filter
never sits still (0.03 Hz LFO) and the bed breathes (0.05 Hz). Motifs are a pure exported
`motifPhrase(rand, altT)` — 3–5 notes, biased downhill, always ending on D3 or A2, E♭3
replacing E3 above the fog line — synthesized as detuned-saw horn pairs with a bandpass-noise
bow on top, sent down the wolfHowl-style feedback-delay valley. Every loud stinger calls
`_duckMusic()` (the `lowSting` one is load-bearing: a 45 Hz sine under a D2/E♭2 drone is mud,
not dread); `birdsSilent` holds the duck down for the beat's whole duration. Brief for the
emotion, from Devon: *foreboding woe, not haunted house*. Tuning knobs are all single
constants: motif interval (70–140 s), drone floor (0.045), tritone gain (0.018).

**Fidelity pass**, all inside the zero-asset rules: plant atlas 4 → 8 cells at 512×256
(bracken, thistle, deadfall sprout, mossy rock tuft; staples double-weighted), undergrowth
tops sway (aCorner.y-scaled, roots planted); conifers split into three seeded variants — full
spruce / slender fir / dead spire at `seed % 10` = 6/3/1, the dead ones grey and stiff (wind
×0.4) — sharing one live material and one dead (+2 draw calls); birch canopies answer the
wind; far-tier atlas 2 → 4 cells (slender spire, dead snag) with per-tree HSL jitter baked as
vertex colours around the old flat 0x37444c; 150 recycled spray droplets at the waterfall
base; 140 dust motes in a camera-following wrap box, opacity leaning on (1−fogT); breath
vapour above altT 0.6 — six round-robin billboard quads, age does everything in the shader.
Nothing new ever toggles `.visible`, which is what the draw-cost-equality assertion demands.

### What I verified (session 3)

- `node test/smoke.mjs` — **52 checks, 0 failed** (was 47). New group holds the motif engine
  to the scale across 400 seeded phrases per register: 3–5 notes, every phrase falls home to
  D3 or A2, no E natural above the fog line, and the flat second actually gets used up there.
- `node test/browser.mjs` — **32 checks, 0 failed, twice consecutively** (one earlier run
  dropped a single check under swiftshader at 1.4 fps — timing flake, not reproducible).
  Zero page errors across all shader work, which is the canary for the five new
  `onBeforeCompile` materials.
- **Draw budget: 36 calls, 290k triangles, identical in thick and clear** — was 35/280k. The
  music costs zero calls; the whole visual pass costs +5 (conifer split +2, spray +1, motes
  +1, breath +1) against the 300 budget.
- Not verified, still: real GPU, real glass, real ears. The music has never been *heard* —
  the browser suite proves it constructs and ducks without error, not that it lands. Items
  3–5 of the prompt's task list all still stand, and the drone gains especially are
  unheard guesses in the same class as the dread cooldowns.

### The north star

Devon asked for the no-ceiling version — full engine, what does this become — and then set
the doctrine: the player must believe they COULD be in danger the whole runtime while never
being in any, Gone Home's discipline exactly. Both are now in the prompt file ("The north
star", session 3): the relief-keeper story, seven cairns / eight keepers, the ending at the
rail, the asynchronous-multiplayer truth of the dread — and the six rules that apply at THIS
scale now (never show teeth, never show a safe room; plausible not supernatural; refuse to
acknowledge the experiment; the body may fear, the game may not agree; metadata discipline;
fear planted in-fiction, never confirmed). Plus a feasibility ladder of HTML-replicable
pieces: descending-biased phantom steps, the gaze-aware director v0, a dead radio, bootprints
on the last switchback, tea steam in the cab — and the ones that need Devon's explicit yes
first because they add verbs or persistence (logbook pages, own-ghost replay, the headlamp).
The direction question from session 2 is settled by it: dread, not collection.

## Session 2 — the walk ends in the fog

Devon set the thesis this session, and it reframed the open item rather than answering it:
*this is not a place we want to be, and we want to get out — but the fog hides something.*
Under that reading the summit defect stopped being a rendering bug and became a design one. The
piece had been building toward a scenic reward at the top of a climb that is supposed to feel
like somewhere you are trying to leave.

**The altitude blend inverted.** `altT` drove seven things and every one of them was relief:
fog thinning to 0.006, light coming up, exposure opening, mist and shafts and fireflies fading
out, a cloud sea appearing. All of it now runs the other way. The summit is the thickest air on
the mountain (density 0.055, worse than THICK's 0.046), the light goes out of it, and the mist
gets *heavier* with altitude instead of clearing. Shafts and fireflies still fade — no light
gets through up there to make a shaft of, and fireflies belong to the woods — and losing them
is part of arriving.

One term rises: ambient. Without it the near ground renders black, which is an unlit frame
rather than atmosphere. That single exception is the entire fix for the old 6–14/255 problem —
and it is worth being precise about why, because it was nearly free: **the summit read black
because `altT` was dropping the fog to 0.006.** Restore thick fog and the fog itself lifts the
ground again, exactly as it does on the trail below. No alpine shader, no treeline, no
heightfield work. Measured after: **24.3/255**, better than the trail's 22.

**The cloud sea and the distant peaks are deleted.** `buildSummitPayoff()` is gone from
`atmosphere.js`, replaced by a comment explaining what was there and why both its geometry and
its intent were wrong. The mountain still has no peak — see "Deliberately not done".

**`dread.js`'s altitude rule flipped.** It read `deepWoods = pos.y < 48` and suppressed the
silence, shape and eyes beats above the fog line, on the stated principle that "above the fog
line the mountain is honest". That made the summit a refuge. Now a `highT` ramp over the same
46→62 m band main.js uses *satisfies* those gates instead of blocking them, feeds `intensity`,
and shortens the cooldown by up to 30%. High on the mountain the weather no longer has to
cooperate for the woods to lie to you.

**Somebody is in the fire lookout.** The tower was already built and placed and had nothing to
do with anything. It is the only structure at the top and the only thing on the mountain that
implies other people — someone built it, someone was meant to sit in it. There is now a figure
at the platform rail that turns to keep facing the walker wherever they go.

It is the piece's one exception to its own vanishing rule: the shape in the trees is gone when
you look back, and this is not. It buys that exception three ways — capped at half opacity so
it never resolves, fogged like everything else, and **gone from the rail entirely once the
walker reaches the foot of the tower**. Walking up to a thing for a better look and having it
step out of view is worse than either finding it or finding nothing, and it keeps the rule that
a monster you can see clearly is just a prop. It never moves from the platform, never comes
down, and nothing follows the walker back down the mountain.

Placement took three attempts and the reason is arithmetic, recorded so nobody repeats it: the
cab is 2.6 m across, the platform 3.4, so the walkway around the cab is **40 cm**. A 0.78 m
figure anywhere on the near rail is half-behind a near-black cab from the approach — the first
two placements came back as an invisible smudge and then a sliver. It stands at the side rail
now, out past the cab's half-width plus half a body, where fog is the background instead of the
tower.

### What I verified (session 2)

- `node test/smoke.mjs` — **47 checks, 0 failed** (was 46). New: the tower sits inside the
  figure's readable band from the bench (10.0 m, band 6.5–70). That check exists because the
  geometry nearly defeated the feature — an earlier band of 11–95 m would have hidden the
  figure at the exact spot the walk ends.
- `node test/browser.mjs` — **32 checks, 0 failed** (was 25), zero page errors. The two OPEN
  FINDING notes are now assertions: the fog closes at the top (density 0.055 at altT 1.00) and
  the summit is legible (24.3/255, floor 18). Five new checks cover the figure: on the platform
  not the ground, visible from the bench, never over half opacity, **survives a look-away and
  look-back**, and gone at the foot of the tower.
- Luminance is now read in-page off the drawing buffer inside a `requestAnimationFrame` rather
  than by decoding a PNG, so the suite needs no image decoder. The renderer runs without
  `preserveDrawingBuffer`, so sampling outside that frame returns an empty buffer.
- Eyes on, four standoff distances (40, 22, 12, 8 m): at 22 m the tower is a shape in fog and
  the figure is deniable; at 12 m it is unmistakable once noticed. Draw calls at the summit
  30, triangles 280k — the figure costs one call.

---

First notes file for this piece. Blue Hour landed in one commit (`4049d32`, PR #8) with no
notes file behind it, which is why nothing downstream knows it exists: it is not on the board,
it has no preview, it is not in `Tools/board-check/games.mjs`, and it has never been opened in
a browser by anything other than a person. This session did not add world; it built the
machinery that makes the piece visible, testable and safe to change, and it found one real
defect on the way. The expansion direction is deliberately still open — see **Next session**.

## What changed

**A debug hook, `?debug` → `window.__bh`** (`js/main.js`). Same bargain Golden Hour struck in
its session, for the same reason: a regression suite cannot walk 860 m in real time, cannot
wait out a 337-second fog period to see the thick phase, and cannot stand in the woods for the
~70 s before dread's first beat and then hope the coin lands on the beat it wanted. The doors
in are `setWeatherT`/`getWeatherT`/`fogT`/`altT` (the fog cycle is this piece's sun, and
scrubbing it is how you see both phases in one run), `teleport`/`face`/`pos`/`surface`,
`cairns`/`layout`, `trail`/`yawAlongTrail`, `fireDread`, `dread`, and `info`. Nothing in the
piece itself opens any of them.

`yawAlongTrail` exists because of a bug I wrote and then had to diagnose: the trailhead sits at
z 145 with `BOUNDS.maxZ` at 150, so a test that guesses "face +z and hold W" walks into the
edge of the world 5 m later and reports a movement bug that isn't there. Handing tests the
centerline is cheaper than every future session rediscovering that.

**`dread.js` split `tryFire` into `tryFire` + `runBeat`.** Choosing a beat and staging one were
one function, so a beat could only be reached by satisfying its fog/elevation gate and then
winning a weighted random draw. `runBeat(beat, camera, controls)` now owns the staging, and
`state.force(beat, camera, controls)` is the only caller that bypasses the gates. `_lastBeat`
moved into `runBeat`, so a forced beat still can't repeat on the next natural fire — the
"never the same beat twice running" rule holds across both paths. No behaviour change in play;
the scheduler is still the only thing that fires beats.

**A browser half of the test suite, `test/browser.mjs`.** Serves the site root over a throwaway
http server (so the import map and `libs/` resolve exactly as they do in play), boots the real
page in real Chromium through `?debug`, and asserts across seven groups. It needs
`playwright-core` and a Chromium on disk, neither of which is a dependency of the piece — the
piece still has none, and still makes zero offsite requests. `CHROME=/path/to/chrome` overrides
the binary. `test/shots/` is gitignored.

Absolute timing under software GL is worthless, so the suite measures its own frame rate and
scales the one timing assertion by it rather than hard-coding a distance. Under swiftshader it
sees **1.7 fps**, and `main.js` clamps `dt` to 0.1 s, so the world genuinely runs in slow
motion at roughly a tenth speed. That clamp is correct — it stops a stalled tab from teleporting
the walker — but it means any future session reading a walk distance here must scale it.

## What I verified

- `node test/smoke.mjs` — **46 checks, 0 failed**, unchanged before and after the `dread.js`
  split.
- `node test/browser.mjs` — **25 checks, 0 failed**, real Chromium, zero page errors from boot
  to teardown. Groups: boots (trailhead position, surface underfoot, hook present), draw
  budget, the fog cycle, the climb, the cairns, every dread beat, the walk.
- **Draw budget: 35 calls, 280k triangles** at 1320×800 in the woods; **19 calls** at the
  summit. Golden Hour's stated budget was 300 calls and it measured 157. Blue Hour has more
  than twice Golden Hour's trees and uses a fifth of its draw calls, because the forest is
  instanced.
- **The weather does not change the draw cost** — 35 calls and 280k triangles are identical in
  the thickest fog and the clearest, which is worth knowing and is not what I assumed going in.
  The fog is mood and depth-precision headroom; it is *not* a culling strategy. Nothing is
  hidden by it that wasn't already being submitted. This is fine at the current budget and it
  is the number to watch if the forest ever grows.
- **The fog cycle reaches both ends** — 0.00 to 1.00 across a 1400 s scrub, so neither extreme
  is theoretical.
- **The climb works**: the bench stands at y 63.4, `altT` saturates at 1.0, the summit view
  costs 19 draw calls.
- **All seven cairns** are reachable, counted, and the seventh flips the chip to "all seven
  cairns".
- **Every dread beat** — snap, phantom, silence, howl, bear, eyes — stages without a page
  error; the shape comes up active with a 40 s life, and `birdsSilent` flips on cue.
- A 6 s W-hold up the trail covers ground, gains elevation, and leaves the walker still on the
  trail rather than lost in the woods.

### The one real defect: the summit payoff does not render

The README promises the climb ends in "thin bright air over a cloud sea". It does not. Two
independent causes, both measured:

1. **The cloud sea is inside the mountain.** `atmosphere.js` puts it at y = 46, a ring of
   radius 40–200 around the trail end at (-5, -100). The terrain there is a broad plateau, not
   a peak — sampling `groundHeight` every 5° around that ring gives a mean of ~60 m at every
   radius from 40 out to 200. At r = 40 **100% of the ring is underground**; at r = 200, 60%
   still is. From the bench at y 63.4 the plane is below the ground you are standing on in
   nearly every direction, so the reveal it fades in can essentially never be seen. The
   `summit.sea.material.opacity = altT * 0.9` line is doing its job on an object nobody can
   look at.

2. **Above the fog line nothing lifts the ground colour any more.** The fog was doing all the
   work of making the ground legible, and the forest floor has no alpine or high-elevation
   treatment in the ground shader. Lower-half mean luminance of the frame at the bench is
   **6–14 / 255 depending on facing**, against **22 / 255** on the trail below — and the trail
   is already deliberately dim. Turning a full circle at the summit, every direction is a black
   hillside under a pale sky.

Captures are in `Projects/blue-hour-trail/test/shots/` (gitignored; re-shoot with
`node test/browser.mjs` and the four-way summit script in the session scratch). `browser.mjs`
prints both measurements as `note` lines under an **OPEN FINDING** group rather than asserting
them — the fix is a world-design decision, not a tuning nudge, and a permanently red suite is
just a to-do list nobody can run. Turn them into assertions the moment the summit is rebuilt.

I did not fix it this session on purpose. Every available fix changes the mountain — either the
heightfield grows a real peak with ground that falls away (and `smoke.mjs` pins twelve trail
and terrain expectations that would move with it), or the cloud sea drops and the plateau gets
carved. That is Devon's call, not a cleanup.

## Shared-file requests

Three, all mechanical. None of this can be done from inside the project directory.

**1. `index.html` — put Blue Hour on the board.** It has been shipped and unreachable since
PR #8. Insert immediately after the Golden Hour `<a class="notice">` block (currently ending at
the `#g-sun` seal, around line 457), so the two hours sit together:

```html
  <a class="notice" data-tags="Explore" data-new data-preview="assets/previews/blue-hour.jpg" href="Projects/blue-hour-trail/">
    <span class="pin" aria-hidden="true"></span>
    <div class="eyebrow">QUEST POSTED</div>
    <h3>Blue Hour</h3>
    <p class="desc">Climb a fog-bound mountain trail at dusk — and try not to look too closely between the trees.</p>
    <div class="reward">REWARD: <b>THE VIEW ABOVE THE CLOUD LINE</b> · WALKING SIM</div>
    <span class="seal" aria-hidden="true"><svg class="glyph"><use href="#g-peak"/></svg></span>
  </a>
```

That references a seal that does not exist yet. Add it to the `<defs>` block, after the
`g-orbit` symbol on line 352, in the same stroke-only idiom as its neighbours — a ridge line
with the fog lying across it:

```html
  <symbol id="g-peak" viewBox="0 0 24 24"><path d="M2.5 17 9 6.5l4.2 6.8L16 9l5.5 8z"/><path d="M3.5 20.2c1.4-1.1 2.8-1.1 4.2 0s2.8 1.1 4.2 0 2.8-1.1 4.2 0 2.8 1.1 4.2 0"/></symbol>
```

If a new symbol is unwelcome, `#g-star` is the best existing fallback and the card works
unchanged with it. Do not use `#g-sun` — that one is Golden Hour's, and the pair should not
share a seal.

**2. `Tools/board-check/games.mjs` — register the piece** so the integrity, collision and
preview passes stop skipping it. It boots exactly like Golden Hour (click `#overlay`, never the
canvas — while the overlay is up it covers `#scene` and a canvas click never lands):

```js
  // ---- Blue Hour: the deliberate sibling of Golden Hour, and it boots the same
  // way — click the overlay, not the canvas.
  'blue-hour': {
    title: 'Blue Hour',
    url: '/Projects/blue-hour-trail/',
    vw: 1320, vh: 800, dsf: 1,
    three: '/Projects/blue-hour-trail/libs/three.module.js',
    intro: ['#overlay'],
    async open(p, { probe } = {}) {
      await p.waitForSelector('#scene');
      if (probe) await probe();
      await p.click('#overlay');
      await p.waitForSelector('#overlay.hidden', attached);
      await wait(1200);
    },
  },
```

There is no `saveKey`: the piece has no save, on purpose.

**3. `Tools/board-check/capture-previews.mjs` — a recipe, then `npm run previews blue-hour`
and `npm run promote`** to produce `assets/previews/blue-hour.jpg`, which request 1 points at.

> **Amended, session 2.** This request originally said to shoot the trail *because* the summit
> captured as a black hillside. That is fixed — the summit now reads at 24.3/255 and the fire
> lookout in fog is the strongest single frame in the piece. Either shot is defensible now. The
> trail recipe below still works and is the safer capture (it needs no teleport and no debug
> hook); a summit shot would need `__bh.teleport(bench)` and a facing, and would give away the
> figure on the board card, which is an argument against it. Shooting the trail on purpose
> rather than by necessity.

```js
  // ---- Blue Hour: stay in the woods. The trail corridor with the footbridge
  // ahead is the piece's best single frame; the summit is under repair (see
  // notes/24-blue-hour-notes.md) and shoots near-black.
  'blue-hour': {
    async play(p, { shot }) {
      await p.keyboard.down('KeyW'); await wait(4000); await p.keyboard.up('KeyW');
      await wait(1500);                 // let the mist layer drift
      await shot('trail');
      const c = await camState(p);
      return `walking at ${c.pos.join(', ')}, yaw ${c.yaw}`;
    },
  },
```

The `?debug` hook is available to any of these if a deterministic frame is wanted:
`__bh.setWeatherT(t)` pins the weather, `__bh.teleport(x, z)` and `__bh.yawAlongTrail(i)` place
and aim the walker, `__bh.info()` reads the draw counts.

**4. `Claude Prompts/notes/README.md` — add this file to the expected-names list.** The list
stops at 23. Add to the right-hand column:

```
24-blue-hour-notes.md
```

Blue Hour now has a prompt file of its own at `Claude Prompts/24-blue-hour.md`, written this
session; it did not have one before, which is the root cause of everything in requests 1–3.

## Deliberately not done

- **The summit was not rebuilt.** Documented above with numbers instead. Every fix moves the
  heightfield or the world layout, and `smoke.mjs` pins expectations that would move with it.
- **No save, no journal, no interaction verbs, no photo mode.** Golden Hour has all four; Blue
  Hour has none, and this session did not close that gap because whether it *should* close is
  the open question, not a backlog item. Devon's call this session was explicitly "plumbing
  first, then plan".
- **The `dread.js` split is the only change to a piece file.** `state.force` is additive and
  unreferenced in play; the gates, cooldowns and weights are untouched. A refactor of dread's
  scheduler into a registry (Golden Hour's creature pattern) was considered and dropped — it is
  tuned, it is tested, and a mechanical move risks regressions for zero player-visible gain.
- **No LOD or culling work.** Measured first: 35 draw calls and 280k triangles against a budget
  of 300 calls. There is nothing to optimise, and the instancing is already doing it.
- **No `saveKey` in the board-check request.** Adding one would imply a save the piece does not
  have.

## Next session

1. **Settled, session 2** — the walk ends in the fog and there is someone in the lookout. What
   is left of it: the mountain still has no peak (`mountainH` is a ramp in `z`) and the last
   stretch of trail still rides a ~5 m berm. Both are invisible under the new weather and both
   become real again the instant anyone lifts the fog at the summit. Written into the prompt
   file so a future session can't rediscover them the hard way.
2. **The direction question, narrowed.** The ending pass committed hard to dread over
   collection, so Golden Hour parity is now the odd option out and shouldn't be adopted without
   asking. The live choice is: keep pushing into `dread.js`, or write "no save, no verbs, no
   collection" into the prompt as a locked decision. Related and more interesting: the beats
   are still the same five everywhere on the mountain — only their *rate* changes with
   altitude. Something should change in kind up there. The figure is one answer and currently
   the only one.
3. **A real GPU run.** Everything here is swiftshader at 1.0–1.8 fps. The geometry numbers are
   honest and comfortable, but this piece leans hard on large transparent billboards in fog —
   ferns, silhouette cards, mist, shafts — which is fill-rate cost that software rasterization
   reports very differently from a real GPU. Nobody has measured the actual frame rate of this
   piece anywhere.
4. **A touch playtest on real glass.** The controls have a hold-the-bottom-third-to-walk scheme
   that has never had a thumb on it.
5. **Ears on for an hour.** The dread scheduler's cooldowns (55–100 s, first beat at 70 s) and
   the fog periods (211 s and 337 s) are all unheard guesses. They want a real walk, not a
   scrub.
