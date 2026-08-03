# 16 — Final Grade Checker

You are working on the Final Grade Checker, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It implements Carroll County Public Schools' final-grade
calculation. **Correctness here affects real report cards.** Round 3 asked Devon directly and found
the grading bug was bigger than round 2 thought — see "Questions for Devon" below before anything
else. This prompt is self-contained.

## Questions for Devon

- **Does any real report card, at any point in this tool's history, need a second look?** Round 3's
  fix (see "The rules this tool implements" below) corrected a bug that was live since this tool's
  dual-method calculation first went live — not just for one round, the way round 2 assumed. Any
  student whose quality-points average landed on an `x.75` value (3.75, 2.75, 1.75, or 0.75 — one
  more A-quality quarter than B-quality, or B-quality than C-quality, and so on) and whose QP method
  was the one reported, got a letter one grade too high, for as long as this tool has existed until
  this round's fix. You told the previous round's version of this question that "a student should
  only get a letter grade if they earn the FULL quality point... it is rare... but does happen in
  edge cases" — that confirms the rule, but not whether any specific report card needs revisiting.
  If this tool graded anything real, that's the same kind of call round 1's percentage fix needed:
  check old report cards, note it somewhere, or say nothing needs checking.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/final_grade_checker.html` (866 lines)
- `Tools/final-grade-checker/` — `grade-math.mjs` (the arithmetic, 231 lines), `grade-math.test.mjs`
  (the test suite, **139 assertions**, 339 lines), `libs/` (vendored libraries plus a README —
  **xlsx is gone, see below**), all owned by this prompt

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this same
repo at the same time, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 22. |
| Every other file in `Tools/` | Prompts 17 through 20. `Tools/board-check/` is prompt 22's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git
and GitHub Pages don't.

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`; your
edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the grading-rules section, which is the specification.
2. **`Claude Prompts/notes/16-final-grade-checker-notes.md`** — round 3's session: the whole-point
   QP-threshold fix above (bigger than round 2's own fix), with five worked examples hand-verified
   against the live DOM and real CSV/PDF exports. Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/16-final-grade-checker-notes.md` — the .5-asymmetry fix
   (now superseded, see below), the CSV-instead-of-xlsx decision, the add-student-row button. Round
   1's are at `Claude Prompts/archive/round-1/notes/16-final-grade-checker-notes.md` — the original
   percentage-rounding bug and the paste-importer bug.
3. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58) and §8 (backlog state).
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
5. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything. Round 1 concluded it should not, on FERPA/shared-machine grounds — still the standing
   answer, not re-litigated this round.

## The rules this tool implements — read before touching any arithmetic

Carroll County Public Schools uses a **dual-method final grade calculation**:

- Two figures get computed: a **quality-points** result and a **percentage-average** result.
- **The higher of the two is what gets reported.**
- The scale is **10-point**.
- **The percentage average rounds up at exactly .5.** An 89.5 is an A.
- **Quality points must earn the FULL point — confirmed directly by Devon this round, and this is
  a bigger rule than "rounds differently from percentage."** The cutoffs are the integers
  themselves — 4, 3, 2, 1 — compared with `>=`. `qpToFinalLetter(3.99)` is B, not A. Only an exact
  `4.00` is an A. `QP_CUTOFFS` in `grade-math.mjs` is `[['A',4],['B',3],['C',2],['D',1]]`.

**Round 2's fix (thresholds at 3.5/2.5/1.5/0.5, compared with `>`) was still wrong** — it correctly
made quality points stop rounding up at the `.5` boundary, but kept the thresholds at the
midpoints instead of moving them to the whole numbers. Since a 4-quarter average of integers 0-4
only lands on multiples of 0.25, this mattered for exactly the `x.75` values (3.75, 2.75, 1.75,
0.75) — every one of those was one full letter too high under both round 1's and round 2's code.
`x.00`, `x.25`, and `x.50` averages happened to come out the same either way, which is why the bug
wasn't caught until this round asked Devon the threshold-spacing question directly.

**Do not re-litigate this from scratch.** It's fixed and covered by `grade-math.test.mjs`'s 139
assertions, including a dedicated group ("Quality points must earn the full point, not just clear
a midpoint") confirming `4.00` is the only input that produces an A, and that `3.99`/`3.75`/`2.75`/
`1.75`/`0.75` are each one full letter below where the pre-fix code placed them.

**What is still not settled, per "Questions for Devon" above:** whether any real report card,
across this tool's entire history, was graded while the bug was live.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.**
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). You currently have none — deliberate, see
  "Student data" below.
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled
  locally instead"** (locked decision #44).

## Student data: handle with care

This tool takes grades, and grades are student records covered by FERPA. Two hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint.
- **Do not put real student data in the repo.** Any sample or test fixture uses obviously fake
  names.

## What is actually here

**The grading bug turned out bigger than round 2 thought, found and fixed this round, asked and
confirmed directly by Devon.** See "The rules this tool implements" above for the full account.
The on-screen policy note and the PDF footer text both now read "must earn the **full** point... an
average of 3.99 is still a B, not an A" — replacing round 2's "does not round up at exactly .5"
language, which was true but incomplete.

**xlsx is gone. CSV replaces it, unchanged since round 2.** `Tools/final-grade-checker/libs/xlsx.full.min.js`
was deleted round 2; vendored total is still 402,489 bytes (393 KB), just jsPDF and jsPDF-AutoTable.

**An "+ Add Student Row" button exists, unchanged since round 2.**

**Letter-only quarters: asked Devon directly, never seen in practice.** Not building support for a
case that doesn't occur. Closed, round 2.

**Still no `localStorage`** — deliberate, unchanged from round 1.

**Still no screenshot — three rounds running now, identical failure each time verbatim**: "the
Browser pane is not displayed, so the page is not compositing frames." Tried again this round after
real user interaction (typed values, triggered exports) in case an idle pane was the cause — same
failure. This is no longer a flaky, environment-dependent gap to retry past.

## Your task

Round 3 closed both of the previous round's "Questions for Devon" items — the threshold-spacing
question got a bigger answer than expected (see above), and the report-card question is still open
but now scoped correctly (see the "Questions for Devon" block, above, which replaces round 2's
narrower version). What's left:

1. **The report-card question above** — not code, needs Devon's answer.
2. **Get an actual screenshot from a session where the browser pane actually composites.** Three
   identical failures in three rounds suggests a fourth attempt with the same approach won't close
   this — worth trying from a different environment rather than retrying the same method.
3. **The jsPDF-AutoTable column-width warning.** Real, reproducible (`console.warn`, "Of the table
   content, 162 units width could not fit page"), pre-existing, low value. The export still
   produces a correct, readable PDF regardless.
4. If your own pass turns up something new, add it here.

**Is this tool in a stable, finished state? No — not yet, and it's a "not yet" outside the code, not
inside it.** The arithmetic itself is done, correct per Devon's direct confirmation, and the most-
tested part of this codebase. What keeps this off `Stable/` is the open report-card question (only
Devon can answer it) and the three-rounds-running screenshot gap — neither is a code problem.

## Verification

- `node Tools/final-grade-checker/grade-math.test.mjs` → **139 passed, 0 failed**.
- Locked decision #34: the whole-point fix was verified by reverting `QP_CUTOFFS` to
  `[3.5,2.5,1.5,0.5]` and the comparison to `>`, confirming exactly 12 of 139 assertions fail
  (all of them dependent on the whole-point rule, nothing else) — do the same for anything new you
  add.
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed**, this tool's page included.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round
  as files are added elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- Export a real PDF and a real CSV in a browser and read the raw bytes back, the way every previous
  round did — "should work" is not verification for anything export-related on a tool that
  produces report-card documents.

## Output: your notes file

Write `Claude Prompts/notes/16-final-grade-checker-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v*.md` gets assembled from all twenty-two of them each round.

Use these headings:

```
# Final Grade Checker — session notes

## Is the arithmetic right
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly, with worked
examples.**

- **What changed** — files touched and why, with paths. Vendored library total in KB.
- **What I verified** — actual commands, actual output, actual worked examples. "Should work" is
  not verification.
- **Shared-file requests** — any `gvb-save.js` gap with the exact hook signature. Applicable
  blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
