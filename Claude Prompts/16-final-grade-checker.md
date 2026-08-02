# 16 — Final Grade Checker

You are working on the Final Grade Checker, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It implements Carroll County Public Schools' final-grade
calculation. **Correctness here affects real report cards.** Round 2 asked Devon directly and
found a second real grading bug, on top of round 1's — see "Questions for Devon" below before
anything else. This prompt is self-contained.

## Questions for Devon

- **Does any report card graded between round 1's session and round 2's need a second look?**
  Round 2 fixed a real bug: quality points do **not** round up at .5 (only the percentage average
  does) — confirmed by asking you directly, since it's nowhere in writing online. Round 1's fix
  made both methods round the same way, which was still wrong, just in a smaller and more specific
  way. Any student whose QP average landed exactly on 3.5/2.5/1.5/0.5 and whose QP method was the
  one reported got a letter one grade too high, for the one round this tool was live with the
  smaller bug still in it. The window is short — one round, not the tool's entire history — but if
  this tool graded anything real in that window, it's the same kind of call round 1's percentage
  fix needed: check old report cards, note it somewhere, or nothing.
- **Are the exact quality-point threshold numbers (3.5/2.5/1.5/0.5) right?** The *direction* of
  rounding is now confirmed directly by you. The *spacing* of the four thresholds — each exactly
  1.0 apart — is still inherited from the original code, never checked against the actual written
  CCPS Policy Book (which lives in the Superintendent's and each Principal's office, not online).
  If that document ever surfaces, worth a five-minute check against these four numbers specifically.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/final_grade_checker.html` (866 lines)
- `Tools/final-grade-checker/` — `grade-math.mjs` (the arithmetic), `grade-math.test.mjs` (the test
  suite, **130 assertions**), `libs/` (vendored libraries plus a README — **xlsx is gone, see
  below**), all owned by this prompt

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
2. **`Claude Prompts/notes/16-final-grade-checker-notes.md`** — round 2's session: the QP-rounding
   fix above, the CSV-instead-of-xlsx decision, the add-student-row button. Round 1's notes are
   archived at `Claude Prompts/archive/round-1/notes/16-final-grade-checker-notes.md` — the
   original percentage-rounding bug and the paste-importer bug.
3. `gvb-site-handoff-v9.md` §10 (locked decisions #51-53) and §8 (backlog state).
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
- **Quality points do NOT round up at .5 — this is asymmetric with the percentage side, confirmed
  directly by Devon this round.** `qpToFinalLetter(3.50)` is B, not A. `qpToFinalLetter(0.50)` is
  F, not D — the pass/fail line.

**Do not re-litigate either of these from scratch.** Both are now fixed and covered by
`grade-math.test.mjs`'s 130 assertions, including a dedicated group for the QP asymmetry with the
real A,A,D,D tie case (both methods land on C once QP stops rounding up — the marquee "QP wins"
example was replaced with a set that isn't sitting on a boundary).

**What is still not covered, per "Questions for Devon" above:** the exact QP threshold spacing.

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

**A second real grading bug was found this round, asked and confirmed directly by Devon.**
Quality points do not round up at .5; only the percentage average does. `qpToFinalLetter`'s
comparison changed from `>=` to `>`. This broke the two worked examples that were the centerpiece
of the last two rounds of documentation (both used A,A,D,D, which is exactly on the 2.5 boundary,
and both methods now genuinely tie at C rather than QP "winning") — replaced with a set that isn't
on a boundary (90/90/70/60, quality points 2.75 → B, percentage 77.50 → C, a real win). See
"Questions for Devon" above for what this means for anything graded in the window before the fix.

**xlsx is gone. CSV replaces it.** `Tools/final-grade-checker/libs/xlsx.full.min.js` (861 KB, 67%
of the vendored total) is deleted. Its cell styling was already confirmed dead on write (SheetJS
Community drops `cell.s`), so it was buying a file extension, not an appearance. The new CSV
export is a `Blob` + `URL.createObjectURL`, no library, with a UTF-8 BOM and proper quoting.
Vendored total dropped from 1.22 MB to 402,489 bytes.

**An "+ Add Student Row" button exists.** `MANUAL_COUNT` (was a constant, 5) is now `manualCount`
(a variable). Appends one card without touching filled-in ones, focuses the new name field, hides
itself in import mode.

**Letter-only quarters: asked Devon directly, never seen in practice.** Not building support for a
case that doesn't occur.

**Still no `localStorage`** — deliberate, unchanged from round 1.

**Still no screenshot** — two rounds running. The browser pane measured correctly (CSSOM, geometry,
raw export bytes) but never composited a frame in either session.

## Your task

Round 2 closed four of the previous round's five items (the QP-rounding question, letter-only
quarters, CSV vs xlsx, the add-row button). What's left:

1. **Get an actual screenshot.** Two rounds in a row where the numbers checked out (375×812
   geometry, print preview CSSOM, raw export bytes) but nobody actually looked at a rendered frame.
   If your session's browser pane composites, this is a five-minute task that closes a
   two-round-old gap.
2. **The jsPDF-AutoTable column-width warning.** Real, reproducible (`console.warn`, "Of the table
   content, 162 units width could not fit page"), pre-existing, outside both previous rounds' five
   assigned tasks. The export still produces a correct, readable PDF regardless.
3. **The two "Questions for Devon" items above** — neither is code; both need Devon's answer
   before this tool's own backlog can close further.
4. If your own pass turns up something new, add it here.

## Verification

- `node Tools/final-grade-checker/grade-math.test.mjs` → **130 passed, 0 failed**.
- Locked decision #34: the QP-rounding fix was verified by reverting `>` to `>=` and confirming 12
  of 130 assertions fail correctly — do the same for anything new you add.
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed**, this tool's page included.
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
- Export a real PDF and a real CSV in a browser and read the raw bytes back, the way both previous
  rounds did — "should work" is not verification for anything export-related on a tool that
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
