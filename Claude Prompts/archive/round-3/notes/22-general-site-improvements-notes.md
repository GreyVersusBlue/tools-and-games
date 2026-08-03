# General Site Improvements — session notes

Full pass. All twenty-one other project notes files existed when this session
started (confirmed by listing `Claude Prompts/notes/` before touching
anything), so tasks one and two both ran without a partial-pass gate.

## What changed

**Task one, the two real bugs a fair environment finally let this round
prove.** Golden Hour's wading beat in `Tools/board-check/play-games.mjs` was
walking the player inland instead of toward the sea — two prior look-tests
(mouse-look, then an arrow-key turn) leave the camera facing an arbitrary
direction and nothing re-aimed afterward. My first fix attempt, calling
`lookAt()` before the wading hold, still failed (measured eye height
climbing, 7.85 → 10.10) — traced to the arrow-key test just above it calling
`document.exitPointerLock()` on purpose, and Golden Hour's own mousemove
handler gating on pointer lock, so `lookAt()`'s dispatched event was silently
ignored. Real fix: re-aim with the arrow keys instead, polling
`camState().facing` toward 0 the way `walkTo()` polls distance. Verified
`facing = 0` against `controls.js`'s own `dz = -cos(facing)` movement formula
directly, not guessed. Confirmed on two independent runs (facing landed at
-0.030 and -0.006).

**The Fourth Quarter's Real Estate walk (locked decision #35, confirmed and
finally fixed).** `drive.mjs`'s `walkTo()` steers via `aimAt()`, a raw
`camera.rotation.set()` write that The Fourth Quarter's own per-frame
yaw/pitch overwrite erases within ~16ms. Gave `walkTo()` a
`{steer:'lookAt', sens}` option that computes the same target angle through
`lookAt()`'s mousemove dispatch instead. This alone still didn't fix it — a
second, unrelated issue: the dev-menu shortcut used earlier in the same test
calls `exitPointerLock()`, never re-acquired, so `lookAt()` was again being
silently ignored. Added a canvas re-click before the walk. Both fixes
together: 45/45 checks pass, confirmed twice.

**`sync-social-tags.mjs`'s repo-wide false DRIFT, root-caused and fixed.**
Sixteen of twenty-one projects independently reported the same 5-page "out of
date" result this round. Root cause: `blockFor()` always joined its generated
block with `\n`; a Windows checkout with `core.autocrlf=true` rewrites every
LF this script has ever written back to `\r\n` at checkout, including the
block itself — so the comparison showed permanent drift on content that was
otherwise byte-identical. Fixed by matching the block's line ending to
whatever the target file already uses. `npm run social:check` → 18 notices,
18 current, 0 out of date (was 5). Verified per locked decision #34: forced
`Projects/daredevil/index.html` to all-CRLF by hand, confirmed the check
still passed, restored the file's real content.

**`check-integrity.mjs`'s offsite-host sweep extended to `.js`/`.css`**
(Schedule Visualizer's request — its own 590 KB/156 KB of app code had zero
coverage before this). `/libs/` joined the `SKIP` list for vendored bundles.
Found and fixed in passing: the existing `SKIP` list never actually matched
anything on this machine (backslash paths, mixed case vs. lowercase
patterns) — normalized the comparison, which fixes the pre-existing
three-package exclusion too, not just the new one. 488 units checked now
(was 362), 0 broken. Verified per locked decision #34: dropped a
`.src = "https://evil.example.com/..."` into a throwaway `.js` file, watched
it get named and removed, confirmed clean again.

**Orbital's preview and OG card**, first time. `games.mjs`'s new `open()`
seeds one save key (`orbital_progress_v2: {"deepspace#10":1}`) so the sector
grid's "unlock the next level once the previous one has a progress record"
rule lets cell 21 (deepspace#11, "Deep Field") load without playing through
20 levels first. `capture-previews.mjs`'s new recipe reads the level's live
`start`/`view.s` off the page's own script-scope bindings (not `window` —
these are classic-script `let`s, but `page.evaluate` shares that same
lexical scope) and drags a real winning aim vector, asserting
`plan.outcome === 'WIN'` before screenshotting rather than trusting whatever
frame lands. Looked at the actual PNG (a real curving flight plan grazing a
wormhole and a blackhole) before promoting — 6.0 KB / 32.0 KB, both well
under budget. Promoted only Orbital's `chosen.json` entry, deliberately:
Castle Conundrum's own chosen candidate is sitting in the same file from this
round's fair-environment recapture, un-reviewed, and that review is prompt
05's own task two, not mine — scoped the promote run to avoid deciding for
them. `index.html`'s Orbital card gained `data-preview`; `npm run social`
re-run for its `og:url`.

**Task two — version bumped 10 → 11, `gvb-site-handoff-v10.md` written.**

## What I verified

Full commands and output are in `gvb-site-handoff-v10.md`'s "Verified this
session" section. Headline numbers:

```
cd Tools/board-check && npm run check
  488 units checked, 0 broken; 0 collisions, tightest gap 9.1px

npm run social:check
  18 notices, 18 already current, 0 out of date, 0 failed

node assets/js/gvb-save.test.mjs
  50 passed, 0 failed (module untouched this round)

npm run tools
  18 checks, 0 failed

npm run games
  146 checks, 0 failed — confirmed on three full independent runs,
  the first time this handoff has ever reported a fully clean pass

npm run previews orbital
  reached gameplay, plan.outcome === 'WIN' asserted, promoted

node Projects/corner-and-kettle/test/drive-save.mjs
  90 passed, 0 failed

node Tools/seating-chart/test/drive-seating.mjs
  111 passed, 0 failed
```

**Locked decision #34**, twice: reintroduced an offsite `.src=` assignment in
a throwaway `.js` file, watched `check-integrity.mjs` name it, removed it,
watched it pass; force-converted `Projects/daredevil/index.html` to CRLF,
watched `sync-social-tags.mjs --check` still report it current, restored the
file's real content.

**Corner & Kettle's and Seating Chart's expected-failing tests, checked
directly rather than trusted secondhand.** v8 and v9 both carried this
forward as unconfirmed; Coffee Shop Sim's own round-3 notes said it was
actually already fixed. Ran both projects' own suites myself: 90/0 and
111/0, no expected-failing test visible in either. Closing this out of the
backlog for real, not carrying it forward a further round on an unverified
claim either way.

## Requests applied, and requests refused

Every request from every one of the twenty-one other notes files (plus the
two in `Claude Prompts/Stable/`), and what happened to it.

**01 Anathema Archive (Stable/)** — no request; its own centralized
"Questions for Devon" block (`Pathfinder/data/`) still open, raised again by
10 and 11 below.

**02 Pathfinder Campaigns, 03 Pathfinder Characters, 04 Aphelion (partial —
see below), 05 Castle Conundrum (partial — see below), 06 Closing Time, 09
Faire Weekend, 11 The Absalom Inheritance, 12 Coffee Shop Sim / Corner &
Kettle, 14 Integer Foundry, 15 The Fracture Cycle, 17 Image to PDF, 20
Seating Chart Generator** — no shared-file request this round, confirmed
against each project's own notes rather than assumed.

**04 Aphelion** — one blocked, not-yet-actionable item: a `play-games.mjs`
`#signal` assertion is ready to write but needs an airlock-entry beat that
doesn't exist yet in Aphelion's own game code. Not applied — building that
beat blind risks getting the actual gameplay wrong; left for Aphelion's own
next session. Assertion body preserved in the handoff for whoever adds it.

**05 Castle Conundrum** — recapture already done by this round's
fair-environment refresh before this session started; the chosen candidate
sits in `candidates/chosen.json`, unpromoted. Deliberately left unpromoted —
reviewing whether it's the *right* frame is prompt 05's own call, not mine to
make by running `npm run promote` against the whole file. Scoped my own
`npm run promote` invocation to exclude it.

**07 The Fourth Quarter** — the `walkTo()`/`aimAt()` fix (see "What
changed"), applied and verified twice. Its own prompt-file "Questions for
Devon" (day-based difficulty) was already answered inside its own round-3
session (spoilage, built) — nothing left for this thread.

**08 Golden Hour** — the wading re-aim fix (see "What changed"), applied and
verified twice, first attempt corrected after it didn't actually work.

**10 Torchbearer** — the `sync-social-tags.mjs` drift, applied (root-caused
and fixed, see "What changed"; not just re-run). The `.claude/launch.json`
`autoPort` change (made with Devon's live sign-off mid-session, not routed
through this thread) — confirmed present, nothing further needed.
`Pathfinder/data/` repeated, still open, see prompt 01's block.

**11 The Absalom Inheritance** — `Pathfinder/data/` repeated alongside
Torchbearer, still open.

**13 Daredevil** — the social-tag drift it flagged is the same repo-wide bug
fixed this round (see "What changed"); no longer drifted.

**16 Final Grade Checker** — no shared-file request. Its own "Questions for
Devon" answer (thresholds are 4/3/2/1/0, not 3.5/2.5/1.5/0.5) is bigger than
the prompt file's own version of the question — recorded in the handoff, not
a code task for this thread.

**18 Name Picker** — the rename request (`Tools/Name Picker.html` →
`name-picker.html` + matching `index.html` href), a third round now. Not
applied: the file itself is outside this prompt's boundary (project 18's
own), even though the request frames it as "whoever owns `index.html`"
territory. Left as a standing suggestion rather than crossing that line
unprompted — see "Deliberately not done."

**19 Schedule Visualizer** — two requests. `check-integrity.mjs`'s
`.js`/`.css` coverage: applied (see "What changed"). `gvb-save.js` storage
quota: still an open question, not a request — Devon said skip adoption
again this round, third round running.

**21 Orbital** — the preview/OG capture recipe and follow-up `npm run
social` run: both applied (see "What changed").

**23 Refresh Prompts** — historical notes, not a live request this round;
its own findings (the Windows-checkout theory for the social-tags drift,
the walkTo/aimAt bug) both independently reconfirmed and fixed this round
rather than just re-flagged.

## Deliberately not done

**Name Picker's rename, a third time.** See "Requests applied" above —
`Tools/Name Picker.html` belongs to prompt 18, not `Tools/board-check/**`,
even packaged as a same-commit rename+href-update. Low urgency (repeat-
declined twice by Name Picker's own session too), so leaving it open costs
little.

**Aphelion's blocked regression assertion.** Ready to add once the
prerequisite beat exists in Aphelion's own game code; not mine to build
blind.

**Castle Conundrum's preview promotion.** Candidate captured and chosen this
round (before this session started), deliberately left for prompt 05's own
review rather than decided here.

## Next session

Ordered by value per effort:

1. **Decide what Daredevil's "Not interested" response to Earl should
   actually do** — that project's own round-3 finding, the single biggest
   discovery of this round across any project. Not this thread's file; see
   Daredevil's own notes and this round's handoff for the full account.
2. **Castle Conundrum's chosen preview candidate needs prompt 05's own
   look-and-decide**, now that a fair-environment recapture exists.
3. **Final Grade Checker's report-card-revisit question**, now bigger in
   scope than previously known. Devon's call, not code.
4. **`Pathfinder/data/`**, raised a sixth time. Cheaper to decide than carry
   forward again.
5. **Aphelion's airlock-entry beat**, once built, unlocks a ready-made
   regression assertion.
6. **Name Picker's rename**, if a session more comfortable crossing that
   specific file-boundary line wants to just do it.
7. Everything else in each of the twenty-one projects' own "Next session"
   sections — unchanged by this thread, carried forward in the handoff's
   backlog table rather than duplicated here.
