# gvb-site-handoff-v10.md

Handoff from **session 10** (site version now **11**) → whoever picks this up
next. Written for a fresh session with no memory of this one.

Read `gvb-site-handoff-v9.md` first if you have not. Everything in it still
holds unless contradicted below.

Same twenty-two-way parallel split `Claude Prompts/README.md` describes. All
twenty-one other threads had posted round-3 notes by the time this thread ran
— confirmed by reading all twenty-one notes files plus the two now living in
`Claude Prompts/Stable/` (01, 15) before touching anything shared. This is the
full pass: every shared-file request applied or explicitly refused, plus the
version bump and this file.

---

## Three things that matter more than anything below

1. **The Fourth Quarter's day-based-difficulty question, asked directly this
   round: spoilage.** Rent already scaled with venue tier (round 2); this
   round answered the other half Devon flagged in the prompt's own "Questions
   for Devon" block — the mechanic is spoilage, and it's built. Mark that
   block resolved.
2. **Final Grade Checker's threshold question got a bigger answer than its own
   prompt-file question expected.** The "Questions for Devon" block asked
   whether the four thresholds (3.5/2.5/1.5/0.5) were right. The real answer:
   they weren't even the right *shape* — the correct thresholds are
   4/3/2/1/0, not offset-by-.5 versions of themselves. **Still open:** whether
   any report card graded in the window between round 1 and this fix needs a
   second look, now a bigger window than the original prompt-file question
   implied (the whole `.75`-band was wrong, not just the `.5` boundary).
   Devon's call, not code.
3. **`Pathfinder/data/` is still open — the sixth time it's been raised now**,
   this round by Torchbearer and The Absalom Inheritance again (both via
   prompt 01's own centralized "Questions for Devon" block, the new
   convention — see below). Still not code. If a seventh thread raises it,
   that's worth asking about directly rather than carrying it forward again.

**A new convention started this round, worth knowing before you read any
project's notes**: prompt 23's refresh embeds a project's genuinely open
Devon-decisions directly in that project's own prompt file, near the top, as
a labeled "Questions for Devon" block — not just as prose in this handoff.
Check a project's own prompt file for that block before assuming its open
questions live only here. Four projects carry one this round (07, 10 and 11
jointly via 01's, 16, 19); see §9 for which are answered and which aren't.

---

## 0. What changed in one paragraph

**Two real, previously-undiagnosed bugs in shared tooling got fixed, not just
flagged, because this round happened to run on a fair environment (real
Chrome via Playwright, not the forced-software-rendering Linux sandbox v9
warned about).** Golden Hour's wading beat was walking the player *inland*
instead of toward the sea — traced to a missing re-aim after two prior
look-tests, and to `lookAt()` itself being a red herring fix once pointer lock
turns out to be released at that point in the test (§1). The Fourth Quarter's
Real Estate walk-to-station beat was failing for the reason locked decision
#35 already named — `walkTo()`'s `aimAt()` steering is a raw
`camera.rotation.set()` write, silently overwritten every frame by any game
that hand-rolls its own camera — so `walkTo()` gained a `steer:'lookAt'`
option that goes through the game's real mousemove handler instead (§2).
**A repo-wide `sync-social-tags.mjs` false-DRIFT, reported independently by
sixteen of twenty-one projects this round, is fixed at the root**: a Windows
checkout with `core.autocrlf=true` rewrites every LF this script ever wrote
back to CRLF, and the script compared against a hardcoded LF-built block —
so every page it had ever touched showed permanent drift after a fresh
checkout, forever, regardless of content (§3). **`check-integrity.mjs`'s
offsite-host sweep now covers `.js`/`.css`, not just `.html`** (§4), per
Schedule Visualizer's finding that its own 590 KB of application code got zero
coverage. **Orbital has a preview and OG card for the first time** (§5),
using a real winning flight plan that threads a wormhole and a blackhole, not
a placeholder screenshot. **The whole `npm run games` suite is clean for the
first time this handoff has ever reported**: 146 checks, 0 failed, confirmed
across three full, identical, independent runs (§6).

---

## 1. Golden Hour's wading beat: walking inland, not toward the sea — and why the first fix attempt didn't work either

Golden Hour's own round-3 session reproduced this on real hardware and handed
over the exact diagnosis: between the arrow-key turn beat and the wading beat
in `play-games.mjs`'s `'golden-hour'` suite, nothing re-aims the camera. By
the time the wading `KeyW` hold starts, facing is ~2.25 rad (a mouse-look to
1.2, plus a 900ms `ArrowLeft` hold adding ~1.05 more), and
`golden-hour-beach/js/controls.js`'s own movement formula (`dz = -cos(facing)`
for a straight `KeyW`) makes that heading walk toward the dunes, not the
water.

**The request's own suggested fix — call `lookAt()` before the wading
hold — does not work, and I want the reason on record so nobody re-tries it
blind.** `lookAt()` steers by dispatching a synthetic `mousemove`, which is
exactly right for a hand-rolled camera *while pointer lock is held*. But the
arrow-key beat immediately above the wading one calls
`document.exitPointerLock()` on purpose, to prove the keyboard-only path
works — and `controls.js`'s own mousemove handler is gated on it:
`if (document.pointerLockElement !== dom) return;`. With lock released,
`lookAt()`'s dispatched event is real but the game ignores it, silently. My
first commit of this fix called `lookAt(p, {facing:0, pitch:-0.05})` and
still measured eye height climbing (7.85 → 10.10) instead of settling —
looked like the facing value was wrong; it was actually that nothing turned
at all.

**Actual fix:** turn with the arrow keys instead, the same input path the
test just proved works, polling `camState().facing` toward 0 the way
`walkTo()` polls distance toward a target. `facing = 0` itself is correct —
verified directly against `controls.js`'s `dz = -cos(facing)` formula, not
guessed: at facing 0, `dz = -1`, straight toward the water.

```
ok    the wading beat re-aimed toward the sea before walking in  facing -0.030
ok    walking into the water settles at a wading depth rather than continuing to drop  eye y 1.24 -> 1.22
ok    and the walker never goes fully underwater  eye y 1.22
ok    footprints are left in the wet sand  11 instances
```

Confirmed twice, independently (facing landed at -0.030 and -0.006 on two
separate runs) — not a fluke.

## 2. The Fourth Quarter's Real Estate walk: locked decision #35, confirmed and finally fixed

`Tools/board-check/drive.mjs`'s `walkTo()` steers via `aimAt()`, which writes
`camera.rotation` directly. That composes fine with three.js's own
`PointerLockControls` (Castle Conundrum), but Aphelion, Golden Hour and The
Fourth Quarter all keep a private `yaw`/`pitch` and overwrite
`camera.rotation` from it every single frame — a raw write is gone within
~16ms. This was already locked decision #35; this round's fair-environment
re-run of The Fourth Quarter's Real Estate beat reconfirmed it live
("never got in range" on a 6-8m walk) rather than leaving it as a suspicion.

**Fix:** `walkTo()` takes a new `{ steer: 'lookAt', sens }` option. When set,
it computes the same absolute target-facing `aimAt()` would (identical
`atan2` formula) and drives the turn through `lookAt()`'s mousemove dispatch
instead of a raw rotation write — the path that actually survives a
hand-rolled camera's per-frame overwrite.

**This alone did not fix the beat, for a second, unrelated reason worth
recording.** The Fourth Quarter's dev-menu shortcut (opening the console with
Backquote, used earlier in the same test to grant cash) calls
`document.exitPointerLock()` (`main.js:310`), and closing the dev menu never
re-acquires it. `player.js`'s own mousemove handler is gated the same way
Golden Hour's is (`if (!this.locked) return;`), and `this.locked` is only
ever set by a click on the canvas. So `lookAt()`'s dispatched mousemove was,
again, being correctly ignored by a game that had lost pointer lock earlier
in the same test for an unrelated reason. Added `await p.click('canvas')`
immediately before the walk to re-acquire lock. With both fixes:

```
ok    walked to the Real Estate station  17 bursts, 1.12m off
ok    the Real Estate panel opened  Real Estate
...
45 checks, 0 failed
```

Confirmed twice, deterministic both times.

**Pattern worth naming for whoever adds the next `walkTo({steer:'lookAt'})`
call site**: check pointer-lock state before assuming a steering fix is
broken. Both of this round's headline bugs looked at first like a wrong
target angle or a wrong steering function, and were actually "the game's own
mousemove handler is gated on pointer lock, and something upstream in the
same test released it." Worth a one-line note in `drive.mjs` itself — added.

## 3. `sync-social-tags.mjs`'s repo-wide false DRIFT: root-caused and fixed

Sixteen of twenty-one project threads this round independently reported the
same `npm run social:check` result: 18 notices, 5 "out of date"
(`Projects/daredevil/index.html`, `Projects/torchbearer.html`,
`Projects/fourth-quarter/index.html`, `Projects/Ren-Faire-Claude/index.html`,
`newindex.html`), 1 "had no block" (`Projects/orbital/index.html`, expected —
no preview existed yet). Daredevil's own session went furthest and confirmed
its `og:url` content was already correct, yet the check still failed it — and
correctly declined to guess why, since both `index.html` and
`sync-social-tags.mjs` are outside a project thread's boundary.

**Root cause, confirmed directly**: `blockFor()` always joined the generated
`gvb:social` block with a bare `\n`. On a Windows checkout with
`core.autocrlf=true` (the setting on the machine most of this round's threads
ran on, per a historical refresh's own note that flagged this exact
possibility and was never acted on), every LF this script has ever written
gets rewritten to CRLF the moment the file is checked out again — the block
itself, not just the surrounding file. The next `--check` run then compares
an LF-built block against a CRLF file and reports drift on content that is
byte-for-byte identical except for line endings.

**Fix**: `blockFor()` takes an `eol` parameter; the call site detects
`\r\n` in the file it's about to touch and matches it. This makes both the
comparison and the actual write agree with whatever git's checkout behavior
already did to the file, instead of fighting it every time. Verified per
locked decision #34: converted `Projects/daredevil/index.html` entirely to
CRLF by hand (simulating what a fresh Windows checkout does), confirmed
`--check` still reported it current, then restored the file's real content
(the one substantive line Daredevil's own round-3 session changed — its
`--cream-faint` contrast fix — untouched by any of this).

**Result**: `npm run social:check` → 18 notices, 18 current, 0 out of date,
0 failed. Ran `npm run social` for real afterward (safe now — the fix means
it won't just reintroduce the same drift next checkout), plus once more after
Orbital's preview landed (§5) to pick up its new OG image.

## 4. `check-integrity.mjs`'s offsite-host sweep now covers `.js`/`.css`

Schedule Visualizer's finding: the sweep only ever walked `.html`. As of this
round Schedule Visualizer's own code is 590 KB of `.js` and 156 KB of `.css`
under `Tools/schedule/app/`, none of it covered. Extended the same pattern
(a resource-shaped regex, not a bare URL grep) to `.js`/`.mjs`/`.css`: CSS
`url(https://...)` for stylesheets, plus a new `.src =` / `.href =` /
`fetch(` / `import(` pattern for scripts — actual code that makes a request,
not a URL-shaped string sitting in a comment. `/libs/` joined the `SKIP` list
so a vendored bundle (`Tools/schedule/libs/jspdf/jspdf.umd.min.js` was the
example given) doesn't false-positive on its own license header.

**Found and fixed in passing**: the existing `SKIP` list (`node_modules`,
`/tools/board-check/three-`) never actually matched anything on this
machine — `path.join` returns backslashes on Windows and the list's own
patterns are lowercase forward-slash, so the three-package exclusion has
been silently inert this whole time. Normalized the comparison
(lowercase, forward-slash) so both the pre-existing entry and the new
`/libs/` one actually work. Verified per locked decision #34: dropped a
`.src = "https://evil.example.com/x.png"` into a throwaway `.js` file inside
`Tools/board-check/`, confirmed the sweep named it and the host, removed the
file, confirmed 0 broken again. 488 units checked now (was 362 in Daredevil's
own round-3 run before this), 0 broken.

## 5. Orbital: a preview and OG card, verified as a real winning shot

Orbital's own round-3 session tested a specific aim drag live and handed over
the exact recipe: load `deepspace#11` ("Deep Field," the last Deep Space
level), drag from the level's own `start` position by world-space
`(dx:200, dy:-350)`, and screenshot before releasing so the dotted flight
plan is visible.

**One prerequisite the request didn't need to spell out, since it was
authoring the request from inside a live session that already had progress
saved**: `buildGrid()`'s own unlock rule only checks the *immediately
preceding* level's key (`progress[prevKey] != null`), not the whole chain, so
a fresh save only ever unlocks level 0. `games.mjs`'s new `open()` seeds one
key (`orbital_progress_v2: {"deepspace#10": 1}`) before the first load,
reloads, then dismisses the intro, opens the sector map, and clicks grid cell
21 (0-based — ten `basics` levels then Deep Field is the 12th of Deep Space).

`capture-previews.mjs`'s new recipe reads `probe.x/y` (the level's actual
start, live, rather than hardcoding the notes' `(120, 540)`) and `view.s`/
`ox`/`oy` directly off the page's own top-level bindings — these are
classic-script `let`s, not `window` properties, but Playwright's
`page.evaluate` shares that same script-realm lexical scope, so a bare
`view.s` reference resolves exactly the way the DevTools console would.
Dispatches a real `pointerdown` then `pointermove` (not `pointerup` — firing
would replace the aim view with the flight itself) and asserts
`plan.outcome === 'WIN'` before screenshotting, so a future physics or level
change that breaks this specific shot fails loudly instead of silently
screenshotting a miss.

```
ok    played into gameplay  Deep Field, aim drawn, plan outcome WIN
ok    intro overlays gone  #introScrim
ok    frame is moving
ok    no console errors
```

Looked at the actual PNG before promoting, per the tool's own instruction —
a real curving dotted line grazing a wormhole and a blackhole en route to the
goal planet, exactly what the request described, not a random frame. Promoted
(preview 6.0 KB, OG card 32.0 KB, both comfortably under the 60/300 KB
ceilings). **Promoted only Orbital's entry from `candidates/chosen.json`,
deliberately** — Castle Conundrum's own chosen frame is sitting in the same
file from this round's fair-environment recapture, un-reviewed; that review
is prompt 05's own task two, not mine, so I scoped the promote run to just
`{"orbital": ...}`, then restored the file with both entries present rather
than run `npm run promote` against the whole file and silently decide
Castle Conundrum's frame for them.

`index.html`'s Orbital card gained `data-preview="assets/previews/orbital.jpg"`.
`npm run social` re-run afterward for its `og:url`/`og:image`.

## 6. `npm run games`: 146 checks, 0 failed, confirmed on three full independent runs

Three full runs after the fixes in §1/§2 landed: **146 checks, 0 failed**,
identical tallies every time, including Golden Hour's wading beat and The
Fourth Quarter's Real Estate walk specifically (the two beats §1/§2 fixed).
This is the first time this handoff has ever reported a fully clean
`npm run games` — v9 reported 8 failures, the historical fair-environment
refresh reported 3. The third run (direct `node play-games.mjs`, not through
the `npm run` wrapper) ran markedly slower than the first two — consistent
with this environment's own documented behavior of deprioritizing a real
Chrome window that has lost focus (the scheduling note in this prompt's own
house rules) — but finished with the same 146/0 tally, not a flake.

## 7. Corner & Kettle's and Seating Chart's expected-failing tests: confirmed done, not still open

v8 and v9 both carried this forward as unconfirmed. Coffee Shop Sim's own
round-3 notes flagged it directly: the inversion has actually landed, the
handoff text calling it open was stale. Ran both projects' own suites myself
rather than trust either claim secondhand:

```
node Projects/corner-and-kettle/test/drive-save.mjs   → 90 passed, 0 failed
node Tools/seating-chart/test/drive-seating.mjs       → 111 passed, 0 failed
```

Neither shows an expected-failing test anywhere in its output. **Closing this
out of the backlog for real** — it's been carried forward inaccurately for
at least one round; verify against actual test output next time, not against
what an earlier handoff draft claimed (the exact mistake v9 warned about
regarding this same item).

---

## 8. Backlog state

| Item | State |
| --- | --- |
| Golden Hour's wading re-aim | **Done.** See §1 |
| The Fourth Quarter's `walkTo()`/`aimAt()` bug (locked decision #35) | **Done.** See §2 |
| `sync-social-tags.mjs` repo-wide false DRIFT | **Done, root-caused.** See §3 |
| `check-integrity.mjs`'s `.js`/`.css` coverage | **Done.** See §4 |
| Orbital preview/OG | **Done.** See §5 |
| `npm run games` clean run | **Done, 146/146 confirmed on three full independent runs — see §6** |
| Corner & Kettle / Seating Chart inverted-test confirmation | **Done — confirmed by direct test run, was stale in the backlog.** See §7 |
| `waitForFunction`-class bugs outside `Tools/board-check/**` | **Status per each project's own round-3 notes — not independently re-verified this round; see each project's notes** |
| Castle Conundrum preview recapture | **Candidate captured and chosen (this round's fair-environment refresh), not yet promoted — prompt 05's own task two, deliberately not acted on here.** See §5 |
| Final Grade Checker's QP/threshold question | **Bigger than previously known — see "Three things" above.** Still open (report-card revisit), Devon's call |
| The Fourth Quarter's difficulty-curve question | **Answered: spoilage, built.** See "Three things" above |
| `Pathfinder/data/` as a shared interface | **Still open — sixth raise.** See "Three things" above |
| Schedule Visualizer's `gvb-save.js` storage-quota question | **Still open — Devon said skip adoption again this round, third round running** |
| Name Picker's rename (`Tools/Name Picker.html` → `name-picker.html` + href) | **Still not done — see §9, a boundary call, not a refusal on the merits** |
| Aphelion's `#signal` regression assertion | **Still blocked — needs an airlock-entry beat in Aphelion's own game first, not actionable from this side. See §9** |
| Everything else in each of the twenty-one projects' own "Next session" sections | **Unchanged by this thread — see each project's own notes file** |

## 9. Things I found and deliberately did not fix

**Name Picker's rename request, a third time.** `Tools/Name Picker.html` is
project 18's own file, not `Tools/board-check/**` — even though the request
explicitly frames it as "whoever owns `index.html`" doing both the rename and
the href update in one commit (to avoid a broken-link window), the file
itself sits outside this prompt's boundary the same way every other
project's own files do. Renaming it would mean editing a file that belongs
to prompt 18 without prompt 18's own session doing it. Left as a standing
suggestion for a third round rather than crossing that line unprompted — the
request itself has been low-urgency and repeat-declined by Name Picker's own
session twice now, which is its own signal that this isn't costing anyone
anything by staying open.

**Aphelion's blocked regression assertion.** The request is real and the
assertion body is ready to drop in, but it's gated on an airlock-entry beat
that doesn't exist yet in Aphelion's own game code — building that beat
blind, from outside the project, risks getting the actual gameplay wrong.
Left for Aphelion's own next session to build the prerequisite, at which
point the ready-made assertion (given verbatim in Aphelion's own notes) is a
five-minute add.

**Castle Conundrum's preview promotion.** The candidate is sitting in
`candidates/`, chosen, dated this round's fair-environment refresh — but
whether it's the *right* frame is a call for prompt 05's own session, which
has been asking for this recapture across two rounds and should be the one
to look at what actually got captured before it ships. Scoped this round's
`npm run promote` run to exclude it (see §5) rather than decide for them.

**`waitForFunction`-class bugs in project-owned test files.** v9 tracked
three (`play-castle.mjs`, `Projects/integer-foundry/test/browser.mjs`, plus
whatever the historical refresh found). This round's project notes suggest
several of these have been independently re-found and fixed by their own
projects' sessions (05, 12, 14, 18, 20 per this round's notes) — not
independently re-verified from this side; take each project's own "What I
verified" as authoritative rather than this line.

## 10. Locked decisions

Everything through #53 (v1 §3 through v9 §10, cited there) still stands.
Added:

54. **`play-games.mjs`'s Golden Hour wading beat needs an explicit re-aim
    before its `KeyW` hold — arrow keys, not `lookAt()`.** Two prior
    look-tests leave the camera facing an arbitrary direction and nothing
    re-aims after; `lookAt()` silently no-ops once pointer lock is released
    (which the arrow-key test above it releases on purpose), so the fix
    polls `camState().facing` toward 0 using the same arrow keys a
    keyboard-only player would use. See §1.
55. **`drive.mjs`'s `walkTo()` takes a `{steer:'lookAt', sens}` option for
    games that hand-roll their own camera control** (Aphelion, Golden Hour,
    The Fourth Quarter) instead of `aimAt()`'s raw `camera.rotation.set()`
    write, which those games' own per-frame yaw/pitch overwrite erases
    within ~16ms. Formalizes locked decision #35 into working code rather
    than leaving it as a documented-but-unresolved warning. See §2.
56. **Before assuming a `lookAt()`/`turnBy()` steering fix is wrong, check
    whether pointer lock is actually held at that point in the test.** Every
    one of these hand-rolled-camera games gates its mousemove handler on
    `document.pointerLockElement`/a `this.locked` flag, and anything
    upstream in the same test that calls `exitPointerLock()` (proving a
    keyboard-only path, or opening a dev menu) silently disables the next
    `lookAt()` call rather than erroring. See §1, §2.
57. **`sync-social-tags.mjs`'s generated block must match the target file's
    own line-ending convention, not hardcode `\n`.** A Windows checkout with
    `core.autocrlf=true` rewrites every previously-written LF block back to
    CRLF, so a hardcoded-LF comparison shows permanent false drift on any
    page the script has ever touched. See §3.
58. **`check-integrity.mjs`'s offsite-host sweep covers `.js`/`.mjs`/`.css`,
    not just `.html`.** `/libs/` joined its `SKIP` list for vendored
    bundles. See §4. (Also: `SKIP`'s own matching is now
    case/separator-normalized — it silently matched nothing on Windows
    before this round.)

## 11. Suggested next session

Roughly in order of value per effort:

1. **Decide what "Not interested" should actually do in Daredevil**, per that
   project's own round-3 finding — the biggest single discovery this round,
   not this thread's file, flagged here because it's genuinely
   handoff-worthy: the milestone spine (M2 through M4) proceeds almost
   unchanged regardless of that choice, despite three optional evening cards
   correctly disappearing. See Daredevil's own notes for the full account.
2. **Whether Final Grade Checker's window needs a real report-card check**,
   now that the threshold bug is known to be bigger than first measured (see
   "Three things"). Devon's call, not code.
3. **Castle Conundrum's chosen preview candidate** needs prompt 05's own
   look-and-decide, now that the fair-environment recapture exists.
4. **`Pathfinder/data/`**, raised a sixth time. Cheaper to decide than to
   keep carrying forward.
5. **Aphelion's airlock-entry beat**, once it exists, unlocks a ready-made
   regression assertion (see §9).
6. **Name Picker's rename**, if a session more comfortable crossing that
   specific boundary line wants to just do it — three rounds of low-urgency
   deferral is a real signal this isn't costing much either way.
7. Everything else in each of the twenty-one projects' own notes files under
   their own "Next session" — unchanged by this thread, carried forward
   there rather than duplicated here.

---

## Verified this session

- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed** (module
  untouched this round)
- `cd Tools/board-check && npm run check` → **488 units checked, 0 broken**
  (up from 362 — the new `.js`/`.css` sweep, see §4); **0 collisions across
  nine widths, tightest gap 9.1px**
- `npm run social:check` → **18 notices, 18 already current, 0 out of date,
  0 failed** (was 5 out of date before §3's fix)
- `npm run tools` → **18 checks, 0 failed**
- `npm run games` → **146 checks, 0 failed**, confirmed on three full,
  independent runs — see §6
- `npm run previews orbital` → reached gameplay, `plan.outcome === 'WIN'`
  asserted, 0 failed; promoted (preview 6.0 KB, OG 32.0 KB)
- `node Projects/corner-and-kettle/test/drive-save.mjs` → **90 passed, 0
  failed**
- `node Tools/seating-chart/test/drive-seating.mjs` → **111 passed, 0
  failed**
- Locked decision #34, twice: reintroduced an offsite `.src=` assignment in a
  throwaway `.js` file, watched `check-integrity.mjs` fail naming it, removed
  it, watched it pass; converted `Projects/daredevil/index.html` to CRLF by
  hand, watched `sync-social-tags.mjs --check` still report it current,
  restored the file's real (LF) content.
- Golden Hour's and The Fourth Quarter's fixes each confirmed by two
  independent full-suite runs, not a single pass.
