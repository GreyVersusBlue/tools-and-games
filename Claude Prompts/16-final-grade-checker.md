# 16 — Final Grade Checker

You are working on the Final Grade Checker, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It implements Carroll County Public Schools' final-grade
calculation. **Correctness here affects real report cards**, which makes this the one tool in the
set where the arithmetic matters more than anything else you could improve. This prompt is
self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/final_grade_checker.html` (808 lines, 38 KB)
- Any new folder you create under `Tools/` **named for this tool** — e.g.
  `Tools/final-grade-checker/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions are working on other projects in this same
repo right now, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (locked decisions #9, #31). Prompt 21. |
| `Tools/creature_artwork_gallery.html` | **Being deleted this round** by prompt 21. Not yours; don't reference it. |
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
2. `gvb-site-handoff-v7.md` §10 (locked decisions), §8 (backlog state).
3. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
   This is one, and it stays there.
4. `assets/js/gvb-save.js` and `assets/js/README.md`, if you conclude the tool should remember
   anything.

## The rules this tool implements — read before touching any arithmetic

Carroll County Public Schools uses a **dual-method final grade calculation**:

- Two figures get computed: a **quality-points** result and a **percentage-average** result.
- **The higher of the two is what gets reported.** Not an average of them, not the percentage
  one by default. The higher.
- The scale is **10-point**.
- **Rounding goes up at exactly .5.** An 89.5 is an A.

**Verify that the tool actually does all four of those things**, one at a time, against
hand-worked examples. This is the single highest-value task in this prompt, above every UI or
performance improvement, because a tool that quietly reports the lower of the two methods gives a
student a worse grade than the county's own rule says they earned. Build the test cases first,
then read the code, so you are checking behaviour rather than talking yourself into agreeing with
whatever is there.

Cases that separate a correct implementation from a plausible one:

- A student where the two methods disagree, and specifically where **quality points is the higher
  one**. If the tool always effectively reports the percentage average, only this case exposes it.
- Exactly 89.5, 79.5, 69.5, 59.5. Then 89.49 and 89.51. `Math.round` rounds .5 up for positive
  numbers, but floating-point arithmetic means a computed 89.5 is sometimes 89.49999999999999 —
  which rounds down and silently costs a letter grade. Check how the value is produced, not just
  how it is rounded.
- A marking period with a missing or exempt grade, which is where most grade calculators go wrong.
- Whatever the tool does at the boundary between a passing and failing final.

If you find a discrepancy, **that is the headline of your notes**, and it goes in with the worked
example that shows it.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** You have three — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
  In particular, do **not** create a shared `Tools/libs/` for the other tools that also use jsPDF.
  Two of them do, and two other threads are working on them in parallel right now. A duplicated
  copy beats a cross-tool coupling and a merge conflict.
- **Never change a storage key** (locked decision #36). You currently have none.
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).

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

808 lines, 38 KB, one file. Title: "Final Grade Checker". Tagged with the school stamp under Town
Services. No `localStorage` at all — nothing is remembered between visits.

**It pulls three libraries from `cdnjs.cloudflare.com`** at lines 167–169:

```
xlsx/0.18.5/xlsx.full.min.js
jspdf/2.5.1/jspdf.umd.min.js
jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js
```

That is three real offsite requests in production. v7 §5 claims the site makes zero offsite
requests site-wide — the claim is wrong, and the reason nobody caught it is that the browser
suites only ever drive the seven games, never the tools. Nothing measures this file.

**The practical consequence is worse than the privacy one:** a teacher on school wifi with cdnjs
blocked by a content filter gets a tool that silently cannot export. And `xlsx` 0.18.5 is being
loaded to read spreadsheets of student grades from a third-party CDN, which is exactly the request
you would least want to depend on a network path you don't control.

It hotlinks no Google Fonts, which puts it in a minority of pages in this repo.

## Your task

There is no handoff backlog for this tool. It has never been the subject of a session.

**Task one, the headline: verify the grade arithmetic against the four rules above.** Worked
examples, written down, including the cases listed. This comes first and it is not optional.

**Task two: vendor the three libraries.** Copy `xlsx.full.min.js`, `jspdf.umd.min.js` and
`jspdf.plugin.autotable.min.js` into a `libs/` folder you own, at the exact versions currently
requested, and point the script tags at local paths. Include a README naming each library, its
version, its licence and where it came from — the way
`Projects/golden-hour-beach/assets/textures/README.md` does for its textures.

Two things to get right:

- **Check whether all three are actually used.** `xlsx` full build is large, and a tool that reads
  `.xlsx` and writes PDF may only need one of the three on any given path. Vendoring an unused
  library is a worse outcome than the hotlink. Grep for the globals each one exposes before you
  copy it.
- **Measure and report the total** (locked decision #42, which exists because a size estimate that
  was wrong by 4× blocked a good decision for two sessions). `xlsx.full.min.js` is not small; get
  the real number rather than guessing, and if it turns out to be large, say so and say whether a
  lighter path exists — for example loading it only when the user actually picks a spreadsheet.

**Task three: audit and plan, then build what fits.** Write a prioritized plan into your notes.
Worth an opinion:

- **Does the tool explain its own answer?** For a dual-method calculation the most useful output is
  not one number, it is both numbers with the winner marked, so a teacher can defend the grade to a
  parent. If it only shows the final figure, showing the work is a small change with real value.
- **The three levels this is used for.** The course this tool serves runs Honors GT, Honors and
  Academic sections. If weighting differs by level, the tool needs to know that; if it doesn't,
  say so explicitly so the next session doesn't wonder.
- **Should it remember anything?** No `localStorage` means re-entering everything each time. If a
  roster or a set of weights is re-entered every marking period, persisting that is a real time
  saving — but read the student-data section above first, use `assets/js/gvb-save.js` rather than
  hand-rolling, keep whatever key you pick forever (locked decision #36), put fill-ins in `repair`
  rather than `migrate` (locked decision #37), and ship a visible clear-all control. A missing
  hook in the module is a Shared-file request, not an edit.
- **Print and PDF output.** This is a tool whose output gets printed. Check the print stylesheet
  and the actual PDF, not just the screen.
- **Mobile.** 375×812. Grade checking on a phone during a parent conference is a real scenario.
- **Accessibility.** Table semantics, label association on every input, contrast, and keyboard-only
  entry — a numeric-entry tool that needs a mouse is a slow tool.

## Verification

This tool has no test suite, and **the arithmetic is exactly what a Node test is for.** If you do
one thing beyond the audit, do this: pull the calculation into a form a Node script can import, and
write a suite of hand-worked cases including every boundary above. Put it in a folder you own and
make it exit non-zero on failure (locked decision #13). Locked decision #34: get each case failing
against a deliberately broken calculation first, so you know the test can fail.

- Work through the grading cases by hand and against the tool, and record both results side by side.
- After vendoring, load the page with the network panel open and confirm zero requests leave the
  site. Then grep the file for `cdnjs.cloudflare.com` → zero hits. Then **actually export a PDF and
  read a spreadsheet**, because a vendored library with a wrong path fails at the moment you use it,
  not at load.
- `cd Tools/board-check && npm run check` → 235 units, 0 broken, 0 collisions. Run it before you
  finish, especially if you renamed anything.
- `npm run social:check` → 23 notices, 23 already current. Drift on your page means you edited
  inside the `gvb:social` markers.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running them.
Only one at a time.

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
