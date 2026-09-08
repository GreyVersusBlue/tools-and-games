# ARCHIVE

The teaching tools are no longer maintained or improved on this repo. This
file is where their open work went, on 2026-09-08, in the wording it had in
`BACKLOG.md` when it was cut. Locked decision #206.

**Nothing here is open work.** `BACKLOG.md` is the entry point for what is
open; `HISTORY.md` is the record of what shipped. This is the third thing: the
plans for five tools that will not be built, kept whole so the reasoning is
not lost and so nobody re-derives it from scratch.

**The tools themselves are untouched and still live.** No file moved, no page
changed, no board card was pulled. `Tools/final_grade_checker.html`,
`Tools/image-to-pdf.html`, `Tools/Name Picker.html`,
`Tools/Seating Chart Generator.html`, `Tools/schedule-visualizer.html` and
`Tools/schedule-browser.html` all serve exactly as they did, with their
support folders, their vendored libraries and their test suites in place.

Run from a clean checkout of this branch on 2026-09-08, the four Node suites
that need no `puppeteer-core` all pass: `Tools/final-grade-checker/grade-math.test.mjs`
139/0, `Tools/name-picker/test/smoke.mjs` 213/0,
`Tools/seating-chart/test/smoke-seating.mjs` 153/0 and
`Tools/schedule/test/structure.mjs` 31/0. The browser-driven ones
(`Tools/name-picker/test/browser.mjs`, `Tools/seating-chart/test/drive-seating.mjs`,
`Tools/schedule/test/smoke.mjs`) need `puppeteer-core`, which this checkout does
not have, so their last recorded numbers stand rather than fresh ones. Image to
PDF has no Node suite at all — `Tools/image-to-pdf/` holds only vendored libs —
and never did. What ended is the *improving*, not the serving.

**Do not open work against anything in this file.** If a tool breaks in a way
that takes a page down, that is a site problem and belongs in `BACKLOG.md` as
one. Everything below is a wish, not a defect.

## What is not archived

`Tools/board-check/` is not a teaching tool and is not archived. It is the
site-wide check and regression suite — `npm run check`, `npm run social:check`,
`previews`, `promote`, `games` — that every session's definition of done runs
against. Its ranked rows stayed in `BACKLOG.md`, and every one of them is game
or site work that happens to land in that folder: Castle Conundrum's preview
promotion, Golden Hour's recapture and debug-hook beats, Blue Hour's
`games.mjs` entry and preview recipe, and the ownership manifest.

`Tools/prompt-builder.html` is not archived either, for a different reason: it
is owned by nothing, it hotlinks Google Fonts, and it is one of the two
standing `npm run check` failures on `main` today. A red integrity check is a
site problem, so it stays in `BACKLOG.md` under "The site itself".

---

## The ranked rows, at the ranks they held

Twenty-one rows, out of the 106 that were ranked. `BACKLOG.md` renumbered to 85
after the cut, so these rank numbers refer to the table as it stood before, and
resolve to nothing now.

| Rank | Item | Area | Size | Model | Detail |
| --- | --- | --- | --- | --- | --- |
| 28 | Phase 1 — The simulation half, in numbers | `Tools/schedule` | 2+ | Fable 5.1 | [WISHLIST.md Phase 1](Tools/schedule/WISHLIST.md#phase-1--the-simulation-half-in-numbers) |
| 29 | Phase 2 — The editor under the same harness | `Tools/schedule` | 1 | Opus 5 | [WISHLIST.md Phase 2](Tools/schedule/WISHLIST.md#phase-2--the-editor-under-the-same-harness) |
| 30 | Phase 3 — A published file the machine can rebuild | `Tools/schedule` | 1 | Opus 5 | [WISHLIST.md Phase 3](Tools/schedule/WISHLIST.md#phase-3--a-published-file-the-machine-can-rebuild) |
| 31 | Phase 4 — The storage answer | `Tools/schedule` | 1 | Fable 5.1 | [WISHLIST.md Phase 4](Tools/schedule/WISHLIST.md#phase-4--the-storage-answer) |
| 32 | Phase 5 — The seam at 14729 | `Tools/schedule` | ½ | Opus 5 | [WISHLIST.md Phase 5](Tools/schedule/WISHLIST.md#phase-5--the-seam-at-14729) |
| 33 | Phase 6 — One conflict engine, and the constraints nobody checks | `Tools/schedule` | 2+ | Fable 5.1 | [WISHLIST.md Phase 6](Tools/schedule/WISHLIST.md#phase-6--one-conflict-engine-and-the-constraints-nobody-checks) |
| 34 | Phase 7 — Scenarios you can name and compare | `Tools/schedule` | 1 | Opus 5 | [WISHLIST.md Phase 7](Tools/schedule/WISHLIST.md#phase-7--scenarios-you-can-name-and-compare) |
| 35 | Phase 8 — The tool a keyboard can drive | `Tools/schedule` | 1 | Opus 5 | [WISHLIST.md Phase 8](Tools/schedule/WISHLIST.md#phase-8--the-tool-a-keyboard-can-drive) |
| 45 | Decide whether any real report card needs a second look, after the `.75`-band bug | `Tools/final-grade-checker` | ¼ | — | [Final Grade Checker](#final-grade-checker) |
| 49 | The `Tools/Name Picker.html` → `name-picker.html` rename, plus `newindex.html`'s one link | `site` | ¼ | — | [Name Picker](#name-picker) |
| 60 | Configurable grading policies and a "why this grade" audit trail | `Tools/final-grade-checker` | 1 | — | [Final Grade Checker](#final-grade-checker) |
| 94 | Get an actual screenshot from a session where the browser pane composites | `Tools/final-grade-checker` | ¼ | — | [Final Grade Checker](#final-grade-checker) |
| 95 | The jsPDF-AutoTable column-width warning | `Tools/final-grade-checker` | ¼ | — | [Final Grade Checker](#final-grade-checker) |
| 96 | Verify the EXIF fix against a real sideways phone photo | `Tools/image-to-pdf` | ¼ | — | [Image to PDF](#image-to-pdf) |
| 97 | A real screenshot of the two-row mobile layout | `Tools/image-to-pdf` | ¼ | — | [Image to PDF](#image-to-pdf) |
| 98 | Settings persistence — plain `localStorage`, three primitives — only if a teacher asks | `Tools/image-to-pdf` | ¼ | — | [Image to PDF](#image-to-pdf) |
| 99 | The stale "twelve keys" comment in `np-store.js`; there are thirteen | `Tools/name-picker` | ¼ | — | [Name Picker](#name-picker) |
| 100 | Exercise multiple rosters under real use — neither browser suite has run more than one | `Tools/name-picker` | ½ | — | [Name Picker](#name-picker) |
| 101 | Mobile and accessibility re-verification, carried twice | `Tools/name-picker` | ¼ | — | [Name Picker](#name-picker) |
| 102 | Wire `leastPicked()` into a "who's due" display | `Tools/name-picker` | ¼ | — | [Name Picker](#name-picker) |
| 103 | An automated assertion for the print-all path's rotation fix | `Tools/seating-chart` | ¼ | — | [Seating Chart Generator](#seating-chart-generator) |

---

## The Schedule Visualizer's wishlist

`Tools/schedule/WISHLIST.md` is the one tool with a `WISHLIST.md`, and it is
627 lines: what the tool is, the architecture, the conventions a builder needs,
two questions, a 22-bullet standing backlog, and eight phases across two arcs.
It was left where it is rather than pasted in here, with an archived banner at
the top. Nothing in it is open.

- [Phase 1 — The simulation half, in numbers](Tools/schedule/WISHLIST.md#phase-1--the-simulation-half-in-numbers)
- [Phase 2 — The editor under the same harness](Tools/schedule/WISHLIST.md#phase-2--the-editor-under-the-same-harness)
- [Phase 3 — A published file the machine can rebuild](Tools/schedule/WISHLIST.md#phase-3--a-published-file-the-machine-can-rebuild)
- [Phase 4 — The storage answer](Tools/schedule/WISHLIST.md#phase-4--the-storage-answer)
- [Phase 5 — The seam at 14729](Tools/schedule/WISHLIST.md#phase-5--the-seam-at-14729)
- [Phase 6 — One conflict engine, and the constraints nobody checks](Tools/schedule/WISHLIST.md#phase-6--one-conflict-engine-and-the-constraints-nobody-checks)
- [Phase 7 — Scenarios you can name and compare](Tools/schedule/WISHLIST.md#phase-7--scenarios-you-can-name-and-compare)
- [Phase 8 — The tool a keyboard can drive](Tools/schedule/WISHLIST.md#phase-8--the-tool-a-keyboard-can-drive)

Its 22 standing-backlog bullets came out of `BACKLOG.md`'s open-item count with
it: 263 bullets across eleven wishlists became 241 across ten.

---

## The Tier 2 sections, verbatim

Four of the five tools had no wishlist, so everything they had lived in
`BACKLOG.md`'s Tier 2. It is reproduced below unedited, present tense and all.
Read "open", "outstanding" and "still there" as of 2026-09-08, not as of now.

## Final Grade Checker

`Tools/final_grade_checker.html`, `Tools/final-grade-checker/`.

**Is this tool in a stable, finished state? No — not yet, and it's a "not yet"
outside the code, not inside it.** The arithmetic is done, correct per Devon's
direct confirmation, and the most-tested part of this codebase: 139 assertions,
every QP-affected case hand-verified against a live DOM and a real exported
CSV/PDF, the fix verified load-bearing by reintroducing the old bug and
watching 12 assertions fail on cue.

1. **Decide what, if anything, needs checking on past report cards.** This is
   bigger than round 2's version of the question. Round 2 thought the risk
   window was one round, because it assumed the only bug was rounding at the
   `.5` boundary. It wasn't — the `.75` band was wrong too, and has been wrong
   since this tool's dual-method calculation first went live, not just for one
   round. Any student whose QP average landed on `x.75` (3.75, 2.75, 1.75 or
   0.75 — one more A-quality quarter than B-quality, or B-quality than
   C-quality, and so on) and whose QP method was the one reported, got a letter
   one grade too high, for the tool's entire history until the round-3 fix. Not
   a code decision — needs Devon's read on whether real report cards were
   involved and what to do about it if so. See Q4.
2. **Get an actual screenshot.** Three rounds in a row, identical failure each
   time ("the Browser pane is not displayed, so the page is not compositing
   frames"), including a round-3 attempt after real user interaction with the
   page. At this point it's worth trying from a session where the pane is
   actually displayed, rather than retrying the same approach a fourth time.
   This is a standing gap in the tool's verification history, not a one-off
   environment hiccup.
3. **The jsPDF-AutoTable column-width warning.** Real, reproducible
   (`console.warn`, "Of the table content, 162 units width could not fit
   page"), pre-existing across three rounds, low value. The export still
   produces a correct, readable PDF regardless.
4. **Configurable grading policies and a "why this grade" audit trail** would
   have surfaced the `.75`-band bug years earlier. Worth doing; not major.

Deliberately not done, and still the right call:

- **The jsPDF-AutoTable column-width warning.** Real, reproducible,
  pre-existing, outside every round's assigned scope. The export still produces
  a correct, readable PDF. Confirmed again in round 3 via the same raw-byte
  capture; still just a `console.warn`, not a defect in the output.
- **Checking specific old report cards for the `.75`-band bug.** Devon's answer
  confirmed the direction of the rule but didn't resolve whether any specific
  past report card needs re-checking, and that's not something the code can
  determine. Flagged rather than guessed at.
- **Building support for letter-only quarters.** Closed by round 2 — Devon
  confirmed directly: never seen in practice. Not re-litigated.

Two things stop this tool being filed as closed, and neither is in the code.
Item 1 above is a real open question, not a formality: whether any actual
report card was affected is something only Devon can answer. And there is no
screenshot, three rounds running, the same failure verbatim each time — that is
no longer a one-off environment hiccup to retry past, it is a standing gap in
this tool's verification history that a fourth identical attempt is unlikely to
close. Net: ship the code, it's right; don't file the tool as fully closed
until both get resolved by someone other than a repeat of the same approach.

Closed and not to be re-litigated: the QP-rounding direction question (round 3
revealed it needed a bigger fix than round 2's own answer); the exact QP
threshold numbers (Devon confirmed 4/3/2/1/0 directly, not 3.5/2.5/1.5/0.5);
support for letter-only quarters. There are no `gvb-save.js` requests here and
never will be — the standing FERPA-based decision is that this tool remembers
nothing.

## Image to PDF

`Tools/image-to-pdf.html`, `Tools/image-to-pdf/`.

**Nothing is outstanding as things stand.** Two purely environmental checks
remain, worth doing if the hardware ever allows it, not worth retrying with the
same approach a fourth time:

1. **Verify the EXIF fix against a real sideways phone photo**, from an
   environment with an actual camera or a real device to hand. Three rounds
   running without one — the fix is reasoned correctly from documented browser
   auto-rotation behavior (`Tools/image-to-pdf.html` lines ~899–902), but
   reasoning from spec isn't the standard of proof this tool otherwise holds
   itself to.
2. **A real screenshot of the two-row mobile layout**, from an environment
   where the browser pane actually composites a frame. Three identical failures
   suggest this sandbox specifically can't do it, not that retrying will
   eventually work.

   If a fourth round of flagging these two doesn't get them in front of a
   different environment, it's worth asking whether they are actually blockers
   this tool needs closed, or accepted-permanently-open items — the code has
   held up every other way it's been tested.
3. **Settings persistence, only if an actual teacher asks for it.** Still just
   a convenience, still not a gap in the tool's core job. Third round declining
   the same speculative feature. If built: plain `localStorage` for three
   primitive values, not `gvb-save.js`.

## Name Picker

`Tools/Name Picker.html`, `Tools/name-picker/`.

1. **The rename**, whenever a session owning the board wants to pick it up.
   Exact edit:

   - `Tools/Name Picker.html` → `Tools/name-picker.html` (the folder is already
     `Tools/name-picker/`, so this pairs it up)
   - the board card's `href="Tools/Name%20Picker.html"` →
     `href="Tools/name-picker.html"`, same commit as the rename, or the card
     404s in between.

   Raised three rounds running, and it became a structural deadlock rather than
   repeated caution: the board's Town Services section no longer links to this
   file directly — it links to `newindex.html`, which holds the real
   `href="Tools/Name%20Picker.html"`. Under the old boundary rules no single
   prompt owned both halves, and both sides declined to cross the line. **Under
   the ownership rule in `CLAUDE.md` that blocker is gone**: a single PR can now
   do the rename and the link together. Not urgent; the current path still
   resolves fine. See Q5.
2. **The stale "twelve keys" comment in `np-store.js`.** Its header comment
   says "All twelve"; the real count is thirteen, confirmed everywhere else.
   One line, low urgency, still there.
3. **The three levels / multiple rosters under real use.** `np_rosters` handles
   it structurally; no browser suite has exercised more than one roster at a
   time.
4. **Mobile and accessibility re-verification.** Round 1 checked 375×812 and
   `prefers-reduced-motion`; nothing has touched CSS or layout since, so
   nothing here could have regressed, but a fresh check is due at some point on
   general principle, not because anything points at a problem. Carried twice.
5. **`leastPicked()`** — written and tested, still unused. Fair rotation makes
   it mostly redundant and the Stats tab's own "Least Picked" sort covers the
   same need, but it's a two-line wiring job if anyone wants a "who's due"
   display.
6. **The rotation-persistence question** — still needs an answer to "is a
   reload the same period or the next one," not code. Nobody's asked yet. See
   Q51.

Deliberately not done, and worth knowing why:

- **Nobody has reproduced the engine-mismatch crash in a Linux environment.**
  Round 3's session only had Windows available. The fix is verified by
  construction and by matching every other project's identical fix that round,
  not by watching the crash happen and then not happen.
- **`leastPicked()` stays unwired.** Fair rotation makes it mostly redundant;
  the Stats tab's own "Least Picked" sort covers the same need. It is written
  and tested, so wiring it is two lines whenever somebody wants the display.
- **The rotation-persistence question stays a question.** Same call all three
  rounds made: it needs an answer to "is a reload the same period or the next
  one," not code, and nobody has asked a teacher yet.

No open bugs, no failing checks, no student-data gap.

## Seating Chart Generator

`Tools/Seating Chart Generator.html`, `Tools/seating-chart/`.

**Nothing outstanding from this project's own history.** Both items carried
into round 3 (the puppeteer-core test bug, rotated desk labels) are done, and
the Google Fonts item confirmed clean. This was the first refresh where this
project's own next-session list was genuinely empty of prior carryover.

1. **The print-all path's rotation fix has no automated assertion**, only a
   manual browser check. The existing print-all test's fixture never rotates a
   desk, and reworking it felt like more churn than the one-line fix (shared
   with the already-covered live-floor path) warranted.
2. If a future round adds a fifth layout preset or any other place a desk gets
   rendered, remember **the counter-rotation lives in two places**
   (`renderFloor()` and `buildSectionPrintHTML()`) — a new render path needs the
   same one-liner or it'll reintroduce the sideways-name bug in just that path.

Worth knowing rather than doing: the rotated-label fix does not touch desk
geometry. The solver's neighbour math (`neighborMap`, centre-to-centre
distance) was never actually coupled to a desk's rotated width/height — a
desk's centre doesn't move when it rotates around itself — so there was no
"swap width and height" project hiding under this after all.


---

## The questions that were open

Six of the 46 open questions in `BACKLOG.md` belonged to these tools. They are
not answered and will not be; they are here because each one carries the
measurement behind it, and that is worth more than the question.

| # | Question | Raised | Where |
| --- | --- | --- | --- |
| Q4 | **Does any real report card, at any point in this tool's history, need a second look?** The round-3 fix corrected a bug live since the dual-method calculation first went live — not one round, as round 2 assumed. Any student whose quality-points average landed on an `x.75` value and whose QP method was the one reported got a letter one grade too high, for as long as the tool has existed. Devon confirmed the rule ("a student should only get a letter grade if they earn the FULL quality point... it is rare... but does happen in edge cases") but not whether any specific report card needs revisiting. If this tool graded anything real, that's the same kind of call round 1's percentage fix needed: check old report cards, note it somewhere, or say nothing needs checking. | **5** | prompt 16's block, `gvb-site-handoff-v9.md` "Three things" (the narrower version), `gvb-site-handoff-v10.md` "Three things" and §11.2, the round-3 refresh notes, prompt 22's notes |
| Q5 | **Should the `Tools/Name Picker.html` → `name-picker.html` rename be authorized?** Three rounds running, and it became a structural deadlock rather than repeated caution: the board's Town Services section links to `newindex.html`, which holds the real `href="Tools/Name%20Picker.html"`, so the same-commit change a rename needs is one line in `newindex.html` plus the file rename itself — and under the old boundary rules no single prompt owned both halves. Both sides declined to cross the line twice each. **The ownership rule in `CLAUDE.md` removes the blocker**, so the question is now only whether the rename is wanted at all, or whether "leave it forever" is the actual answer so it stops recurring. | **6** | prompts 18 and 22 carrying the same question from both sides, `gvb-site-handoff-v10.md` §9 and §11.6, prompt 18's notes, prompt 22's notes |
| Q6 | **How should storage quota be handled for `gvb-save.js` adoption in the Schedule Visualizer?** Open three rounds; the answer has been "skip adoption" each time. Measured: 23 `localStorage` call sites remain in `app/` (13 `getItem`, 8 `setItem`, 2 `removeItem`) across seven key families plus five snapshot slots. **Every snapshot is a whole project** — `saveSnapshot` stores `serializeFullProject()`, blueprint included, so a browser with all five slots used holds six copies of the blueprint. **The save paths disagree about what a full disk means**: `saveSnapshot` is the only one that tells the user; `saveSchedules`, `saveVizPrefs` and `saveBlueprintToLocalStorage` `console.warn` and say nothing on screen — and the blueprint one leaves the autosave indicator stuck reading "Saving…", because `updateSaveIndicator()` is inside the `try`; `saveWhatIf` swallows it; **`saveSettings` and `saveLastSavedTime` have no `try`/`catch` at all** (`data-model.js:289` and `:308`) and throw out of their caller. So: (a) one slot holding the whole project — which collides with locked decision #36, since seven keys would become one — or seven slots, which needs `createSaveSlot` to grow a namespace and a shared budget? (b) When the disk is full, which write loses: the newest snapshot, the oldest, or the What-If sandbox? (c) Is IndexedDB spillover for the blueprint acceptable, when nothing else on the site uses it? | **4** | prompt 19's block, `Tools/schedule/WISHLIST.md` Phase 4, the round-3 refresh notes, `gvb-site-handoff-v10.md` §8 |
| Q37 | **Is there a copy of the real East Middle project file anywhere?** Three rounds have been unable to regenerate `Tools/schedule-browser.html` end to end because the real blueprint lives in whoever's browser last built it. Phase 3 works around it with no data at all, but a real project export would retire the caveat outright. | 3 | `Tools/schedule/WISHLIST.md`, prompt 19, the project's notes |
| Q50 | **Are Image to PDF's two environment-blocked checks blockers, or accepted-permanently-open?** The EXIF verification and the mobile screenshot are verified-by-reasoning-only across three straight sessions for the same environmental reason. The code has held up every other way it's been tested. | 3 | prompt 17, and its notes across three rounds |
| Q51 | **Name Picker's rotation persistence: is a reload the same period or the next one?** Not code. Nobody has asked a teacher yet. | 3 | prompt 18, and its notes across three rounds |
Two entries from the "Answered, kept here so they are not re-asked" list were
tool answers, and moved with them:

- **Are the 3.5/2.5/1.5/0.5 quality-point thresholds right?** Answered: **no** —
  they were not even the right *shape*. The correct thresholds are whole
  numbers, 4/3/2/1/0.
- **Should the committed schedule data stay?** Answered: **leave it as is.** No
  student names, so no FERPA issue; the school-security question (34 real staff
  surnames, rooms, and — combined with the floor plan — every teacher's
  planning-period block, at a public URL) was decided directly: change nothing.

One standing decision is worth repeating outside its section, because it
governs a live file rather than a plan: **the Final Grade Checker remembers
nothing, on a FERPA basis.** There are no `gvb-save.js` requests against it and
never will be. Archiving does not change that.

---

## The ownership rows

Lifted out of `BACKLOG.md`'s Ownership table. They described who could change
what while these tools were being worked. Nothing is being worked, so nothing
owns them; the paths are listed so it stays clear which files the archive
covers.

| Area | Owns | Shared paths it must not change silently |
| --- | --- | --- |
| Final Grade Checker | `Tools/final_grade_checker.html`, `Tools/final-grade-checker/` | the four shared |
| Image to PDF | `Tools/image-to-pdf.html`, `Tools/image-to-pdf/` | the four shared |
| Name Picker | `Tools/Name Picker.html`, `Tools/name-picker/` | the four shared, plus `newindex.html`'s link to it |
| Schedule Visualizer | `Tools/schedule-visualizer.html`, `Tools/schedule-browser.html` (old dated paths survive as redirect stubs), `Tools/schedule/` | the four shared |
| Seating Chart Generator | `Tools/Seating Chart Generator.html`, `Tools/seating-chart/` | the four shared |
Two per-project browser suites named in that table's follow-up paragraph came
with them: `Tools/name-picker/test/browser.mjs` and
`Tools/seating-chart/test/drive-seating.mjs`. Both still import
`Tools/board-check/harness.mjs` and `drive.mjs` read-only, and both still run.

---

## Where the sources disagreed

Two of the eight entries in `BACKLOG.md`'s "Where the sources disagree" were
about these tools. Both are moot now, and both are the same shape: a tool's own
notes ranked its question far higher than the consolidated table did.

- **Final Grade Checker.** `UPGRADE-PATHS.md` "Close behind" called it "worth
  doing; not major"; `gvb-site-handoff-v10.md` §11 ranked its report-card
  question **#2 site-wide**. It was ranked 45 and 60 at the cut.
- **The Schedule Visualizer's quota question.** Its wishlist made it Phase 4
  (rank 31); prompt 19 and the project's own round-3 notes both ranked it
  **#1** — "the largest remaining item and the only one that cannot start
  without Devon."

The list in `BACKLOG.md` renumbered from eight entries to six.
