# 16 — Final Grade Checker

You are working on the Final Grade Checker, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It implements Carroll County Public Schools' final-grade
calculation. **Correctness here affects real report cards**, which makes this the one tool in the
set where the arithmetic matters more than anything else you could improve. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/final_grade_checker.html` (834 lines, 41 KB)
- `Tools/final-grade-checker/` — no longer hypothetical, this folder exists now: `grade-math.mjs`
  (the arithmetic, 205 lines), `grade-math.test.mjs` (the test suite, 278 lines, 119 assertions),
  `libs/` (three vendored libraries plus a README), all owned by this prompt

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this same
repo right now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. |
| `Tools/creature_artwork_gallery.html` | **Gone.** Deleted by prompt 21 last round — it hotlinked 3,894 images from `2e.aonprd.com` and nothing ever measured it. Don't reference it; the board's notice count dropped from 23 to **22** as a result. |
| Every other file in `Tools/` | Prompts 17 through 20. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git
and GitHub Pages don't. If you rename anything, verify the rename landed in git and not only on
disk.

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`; your
edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the grading-rules section, which is the specification.
2. **`Claude Prompts/notes/16-final-grade-checker-notes.md`, the previous session's notes on this
   exact tool.** Read it before you touch anything. It found a live grading bug (see below) and
   verified it, and it left one task explicitly first for whoever comes next. `Claude
   Prompts/archive/` holds every earlier round's prompts and notes if you need older context.
3. **`gvb-site-handoff-v8.md`, all of it — and read the "Two things that matter more than
   anything below" section at the very top first.** This tool's finding is the first of the two
   things named there. §1, §5, §7, §9 and §10 also mention this tool directly.
4. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
   This is one, and it stays there.
5. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything. (Last round's session concluded it should not, on FERPA/shared-machine grounds — see
   "What is actually here" below and its own notes file's "Deliberately not done" section for the
   full argument.)

## The rules this tool implements — read before touching any arithmetic

Carroll County Public Schools uses a **dual-method final grade calculation**:

- Two figures get computed: a **quality-points** result and a **percentage-average** result.
- **The higher of the two is what gets reported.** Not an average of them, not the percentage
  one by default. The higher.
- The scale is **10-point**.
- **Rounding goes up at exactly .5.** An 89.5 is an A.

**All four of these were verified last round, and one was wrong.** The dual-method comparison and
the 10-point scale checked out. The "round up at exactly .5" rule did not: the old cutoff test was
`Math.round(n*10) >= 895`, which rounds the average to one decimal *before* comparing to the
boundary, so the real cutoff sat at x.45 rather than x.5 at all four letter boundaries — 80 of the
40,001 possible quarter-percentage averages landed a letter grade too high, twenty at each
boundary. That is now fixed and wired through `grade-math.mjs`, with 119 passing assertions. See
"What is actually here" below for what that means for anyone who used the tool before the fix, and
`gvb-site-handoff-v8.md`'s opening section for the full worked example.

**Do not re-litigate this from scratch.** The cases below are what the existing suite already
covers — use them to confirm the suite still passes before and after anything you change, not to
redo the audit:

- A student where the two methods disagree, and specifically where **quality points is the higher
  one**. Covered.
- Exactly 89.5, 79.5, 69.5, 59.5. Then 89.49 and 89.51, and the floating-point case where a
  computed 89.5 is sometimes 89.49999999999999. Covered.
- A marking period with a missing or exempt grade. Covered — and the paste importer had its own
  separate bug here, also fixed (see below).
- The boundary between a passing and failing final. Covered.

**What is not covered, and is this round's actual headline task:** the quality-point thresholds
themselves (3.5 = A, 2.5 = B, 1.5 = C, 0.5 = D) are inherited from the original code and verified
only for internal consistency, never against Carroll County's actual written policy. See task one
below.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** Currently true — the three `cdnjs.cloudflare.com` hotlinks that used
  to sit here are vendored now (see below). Keep it that way; don't reach for a CDN if you add
  anything.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
  In particular, do **not** create a shared `Tools/libs/` for the other tools that also use jsPDF.
  `Tools/image-to-pdf.html` is one of them; a duplicated copy beats a cross-tool coupling and a
  merge conflict.
- **Never change a storage key** (locked decision #36). You currently have none — see "Student
  data" below for why the previous session deliberately kept it that way.
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled
  locally instead"** (locked decision #44, `gvb-site-handoff-v8.md` §2). A page can report an
  empty `__blocked` and still hotlink something, because the font shim answers the request before
  the blocked-list check runs. Doesn't change anything here today since this file hotlinks
  nothing, but it's why `npm run tools` (see below) is a real check now and wasn't before.

## Student data: handle with care

This tool takes grades, and grades are student records covered by FERPA. Two hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint,
  ever. The tool is currently clean on this and must stay clean.
- **Do not put real student data in the repo.** Any sample or test fixture you create uses
  obviously fake names. If you find real names in the file already, say so in your notes as the
  first item and remove them.

If you add persistence, note that anything in `localStorage` sits on a shared classroom machine
until something clears it. A visible "clear all data" control is not optional for a tool like this,
and neither is being honest in the UI about what is stored.

## What is actually here

> **Read this paragraph before anything else in this section.** Last round's session found and
> fixed a live grading bug: the "round up at exactly .5" rule was miscoded so the real cutoff sat
> at x.45 rather than x.5 at every letter boundary, and the tool reported a letter grade too high
> for averages in the x.45–x.4999 band — including a D where the county's own rule says F, at the
> bottom boundary. **This was live for the tool's entire history before this fix.** It is fixed
> now, with 119 passing assertions. **But if this tool was used on any real report card before the
> fix landed, the correction moves some of those grades down.** That is not a code decision — it's
> Devon's to make (check old report cards? note it somewhere? nothing?) and it should not sit
> buried in a task list. See `gvb-site-handoff-v8.md`'s opening section, "Two things that matter
> more than anything below," where this finding is the first of the two.

834 lines, 41 KB, `Tools/final_grade_checker.html` — plus a folder now, `Tools/final-grade-checker/`,
holding the arithmetic (`grade-math.mjs`), its test suite (`grade-math.test.mjs`, 119 assertions),
and `libs/` (three vendored libraries, 1.22 MB total, plus a README). Title: "Final Grade Checker".
Tagged with the school stamp under Town Services. Still no `localStorage` — nothing is remembered
between visits, and that's deliberate (see "Student data" above and "Deliberately not done" in the
notes file: a live class roster of grades has no business surviving on a shared classroom machine).

**The three `cdnjs.cloudflare.com` hotlinks are gone.** `grep -c cdnjs.cloudflare.com
Tools/final_grade_checker.html` returns 0. The page now imports `grade-math.mjs` as a real ES
module and lazy-loads the vendored libraries only when Export PDF or Export Excel is actually
clicked — a page visit that exports nothing pulls 0 KB of library. One real cost of the module
split: the page now needs to be served, not opened by double-clicking off disk (`type="module"`
gives a blank page under `file://`). Fine on the live site and under a local server; a real loss
for anyone who kept a local copy.

**The paste importer had a separate, independent bug, also fixed:** it used to throw away empty
columns when splitting a row, so a student missing one quarter had every later column read one
position to the left — meaning the "system average" column (documented as ignored) could get
silently read as a real quarter grade, producing a confident, wrong final grade with zero
warnings. Now a missing quarter is correctly detected as missing and the tool refuses to produce a
final grade rather than guess.

It hotlinks no Google Fonts, which puts it in a minority of pages in this repo.

## Your task

This tool has a real handoff backlog now, from the session that found and fixed the grading bug
above. Its own notes file (`Claude Prompts/notes/16-final-grade-checker-notes.md`, "Next session")
orders it by value per effort — this list follows that order, minus the one item prompt 21 already
applied.

**Task one, the headline: check the quality-point thresholds against the actual written CCPS
policy document.** The tool currently uses 3.5 = A, 2.5 = B, 1.5 = C, 0.5 = D on the quality-point
average. That number is inherited from the original code and has only ever been verified for
internal consistency — never against the real policy. Every other piece of arithmetic in this tool
is now verified against something concrete; this is the one number that isn't. Ten minutes with the
actual document. This is the last unchecked assumption in a tool that sets report card grades, and
it's genuinely the highest-value thing left here — higher than anything below.

**Task two: find out whether letter-only quarters happen in practice.** If a quarter ever arrives
as a bare letter grade with no percentage in brackets (just "B", no "(84.00)"), the importer's
`parseGradeToken` returns null and the student loses their entire final grade — even though the
quality-points method only needs the letter and could still answer. Worth ten minutes to check
whether this case actually occurs before spending more than that building for it.

**Task three: decide CSV instead of xlsx.** `xlsx.full.min.js` is 861 KB, 67% of the vendored
total, and it's used for exactly one thing: writing the export file. The Excel cell styling it
would justify is already dead (SheetJS Community drops `cell.s` on write — checked, not assumed),
so a CSV export would be visually identical at zero library cost. This is a product call about
removing a button a teacher may rely on, not a bug — the numbers are in
`Tools/final-grade-checker/libs/README.md` so the decision takes about a minute once you're looking
at it.

**Task four: look at the page with real eyes.** 375×812 and print preview were both verified last
round through computed styles and the CSSOM, correctly, but never actually screenshotted — that
session's browser pane wasn't compositing frames. Take the screenshot; confirm what the numbers
already said.

**Task five: more than five manual rows.** `MANUAL_COUNT` is hardcoded at 5, and a real section is
closer to 28 students. Right now the way to enter a whole class by hand is to paste, which not
every source supports. An "add row" button is a small addition with real value for anyone who
doesn't have a TAC export handy.

**Not a task — already done.** The previous round's shared-file request to sweep every Tools page
for offsite requests, console errors, and a non-empty title was applied by prompt 21: it's now
`Tools/board-check/tools.mjs`, wired to `npm run tools` (18 checks, 0 failed, this tool's page
among them), and it's the check that would have caught this tool's old cdnjs hotlinks on day one.
Don't re-request it.

## Output: your notes file

Write `Claude Prompts/notes/16-final-grade-checker-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives —
`gvb-site-handoff-v8.md` gets assembled from all twenty-one of them.

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
examples.** Whether the dual-method calculation reports the higher of the two, whether .5 rounds up
reliably given how the number is produced, and what happens with a missing grade. If it is right,
say so and show the cases. If it isn't, that is the most important thing in this whole batch of
twenty-one sessions.

- **What changed** — files touched and why, with paths. Vendored library total in KB, per library.
- **What I verified** — actual commands, actual output, actual worked examples. Include exporting a
  PDF and reading a spreadsheet after vendoring. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you restructured, any `gvb-save.js` gap with the
  exact hook signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
