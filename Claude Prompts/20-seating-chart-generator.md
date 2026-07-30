# 20 — Seating Chart Generator

You are working on the Seating Chart Generator, a classroom tool on greyversusblue.com under the
board's "Town Services" section. It builds classroom seating charts. Round 1 gave it a full session:
persistence through the shared save module, a rewritten print stylesheet, full keyboard operation,
fit-to-window zoom, a roster paste parser that survives a real spreadsheet, and two real solver bugs
fixed. It also handles student names, so the data-handling section below is not boilerplate — read it
even though round 1 checked and found nothing to remove. This prompt is self-contained, but it is not a
from-scratch brief any more: read the notes file below before you do anything else.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/Seating Chart Generator.html` (1,261 lines, 56.6 KB / 57,951 bytes)
- `Tools/seating-chart/` — created round 1, now populated: `seating.mjs` (pure logic, no DOM, 476
  lines), `test/smoke-seating.mjs` (444 lines), `test/drive-seating.mjs` (447 lines), `fonts/`
  (vendored Fraunces + Spline Sans, 143 KB), `README.md`, `fonts/README.md`, `.gitignore`, `shots/`

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions can be working on other projects in this same repo, and
this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, and the version line (currently "version 9"; locked decisions #9, #31). Prompt 21. |
| `Tools/creature_artwork_gallery.html` | The Bestiary Gallery. Deleted — it no longer exists. Notice count is 22, not 23. Nothing to reference here any more. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 19. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't. Your filename contains spaces, which the board URL-encodes as
`Tools/Seating%20Chart%20Generator.html`. If you rename it, verify the rename landed in git and not
only on disk, and the board `href` becomes a Shared-file request.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). Regenerated from the board's notice by `npm run social`; your edit will be
silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file, including the student-data section.
2. **`Claude Prompts/notes/20-seating-chart-generator-notes.md`** — round 1's session notes for this
   exact project, and your primary source for what already happened here. Read it before the module
   docs below. `Claude Prompts/archive/` holds every earlier round if you need history past that.
3. `assets/js/gvb-save.js` and `assets/js/README.md`. All of it — this project already adopted the
   module (storage key `seating-chart-v1`), so read this as "here is what you're building on," not
   "here is what you're about to adopt."
4. `gvb-site-handoff-v8.md` §4 (the module's five gaps found this round, two of them this project's
   own: the construction-time `typeof localStorage` throw, and `mountSaveBar`'s `labels` option) and
   §9 locked decisions #44, #47, #48, #49 — #44, #48 and #49 are this project's own contributions.
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."

## Student data: this is the part that matters

**A seating chart is a list of student names mapped to physical positions in a room.** That is an
education record under FERPA, and it is also the kind of document that gets printed and left on a
desk.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint, ever.
  The page is clean on this: fonts are vendored (round 1), so it makes zero network requests of any
  kind.
- **Do not put real student names in the repo.** Any sample roster, fixture or screenshot uses
  obviously fake names. Round 1 checked the original file and found none — only three historical-figure
  placeholders (Ada Lovelace, Marco Polo, Mansa Musa) in a `placeholder` attribute, and three seeded
  sections with empty rosters. **Check again anyway before you touch anything** — a past session
  coming back clean doesn't relax this rule for the next one.
- **A visible "clear all data" control exists.** "Erase saved data" in the toolbar (`data-gvb="reset"`)
  with a confirm dialog. If you touch storage further, the same standard applies: the UI has to keep
  saying in one honest sentence what is stored and where.

There is a specific tension worth thinking about rather than ignoring, and round 1 already resolved it
for the current feature set. Seating charts often encode *why* a student sits somewhere — front row for
a vision IEP, apart from a particular classmate, near the door — and a per-student notes field went in
as a legitimate feature. Notes are labelled clearly (in the sidebar hint and the add/edit dialog) as
staying in the browser and in exported files, told to stay short and practical rather than clinical, and
**they never print**, nor does the flag outline — the gold flag means "this student needs a particular
spot," which is the most sensitive thing on the screen, and a printed chart is exactly the document that
gets left face-up on a desk. If you add anything this sensitive, hold it to the same bar: clear
labelling, easy export, storage that clears in one action, rather than storing more.

## What is actually here

1,261 lines, 56.6 KB (57,951 bytes), one file, an ES-module page. Title: "Seating Chart Generator."
Tagged with the school stamp under Town Services. Round 1 took it from a from-scratch prototype with no
persistence to a page with a full save/print/keyboard/accessibility pass — below is what's actually on
disk now, not what the tool used to be.

**Persistence, through `assets/js/gvb-save.js`.** Storage key **`seating-chart-v1`** (locked decision
#36, unchanged), schema version 1. `defaults` is a factory (`freshState`), since every section and every
desk needs a freshly generated id. Fill-ins live in `repair`, not `migrate` (locked decision #37) — it
drops a section that isn't an object, a student with no name, a keep-apart pair pointing at a deleted
student, a seat assignment for a desk or student that no longer exists, clamps desks back inside the
room, and turns junk coordinates into numbers. Autosave coalesces at 1,200 ms and flushes on tab-hide,
for free from the module. The save bar lives in the toolbar, not behind a start screen, relabelled to
"Save to file" / "Open file" / "Erase saved data" via a manual `[data-gvb]` query after mounting — the
module's `mountSaveBar` now supports a `labels` option natively (locked decision #48, this project's own
request, applied), so that manual relabel is a workaround that could now be simplified. Low priority.
Also newly available in the module and not yet used here: `fresh(...args)`/`reset(...args)` forwarding
arguments to a `defaults` factory, and a standalone `clear()`.

**The solver's silent-failure bug is fixed.** A desk with `undefined` in a numeric field used to make
`Math.hypot` return NaN, and `NaN <= 142` is false, so the desk read as having no neighbours — meaning it
silently satisfied *every* keep-apart rule. Auto-assign would report "All seating rules met" while
seating two students who must be separated elbow to elbow. Fixed in `repair`/`num()`; there is a test
that a repaired desk still has neighbours.

**The more-students-than-desks bug is fixed.** The old solver bailed out of the constraint search
entirely once desks ran out and fell through to a random fill that ignored every rule — a real classroom
case (28 students, 24 desks). It now seats as many as the room holds while keeping the rules, leaves the
rest in the pool, and says so in the status line.

**Print is rewritten.** `@page { size: letter landscape }` forces landscape regardless of what Chrome's
print dialog defaults to (portrait, which used to slice off the right-hand column of desks), plus a real
header (section name, seated-of-total, desk count, date, count of anyone with no desk) and a
`beforeprint` pass that scales the trimmed layout up to 1.5x.

**Full keyboard operation.** Every desk is one focusable seat button with a descriptive `aria-label`;
Enter picks up/swaps a student, Escape cancels, R rotates, P pins, Delete removes the desk, arrows nudge
it one grid step (Shift for three).

**Fit-to-window zoom.** The 1,280x900 floor no longer overflows sideways on anything smaller; it scales
to the stage by default with an "Actual size" toggle.

**Roster paste survives a real spreadsheet paste** — an id column, other junk columns, hand-typed
numbering, wrapping quotes, and an optional "Last, First" flip.

**Two test suites, both in `Tools/seating-chart/test/`.** `smoke-seating.mjs`, pure logic, no browser,
**123 assertions** — as of this refresh, **122 passed, 1 failed**, and that one failure is expected, not
a regression (see task one below). `drive-seating.mjs`, browser-driven, **81 checks, 0 failed**.

**Fonts vendored, hotlinks deleted.** Fraunces (variable, with its `opsz` axis) and Spline Sans, 143 KB
total across three woff2 files in `Tools/seating-chart/fonts/`. Zero network requests, confirmed by grep
and by `Tools/board-check`'s static offsite sweep (locked decision #44) — this page reports clean on
both.

**No handoff backlog carried forward from before round 1** — this was the tool's first session ever.
What it deliberately left undone is folded into the task list below.

## Your task

Round 1 (`Claude Prompts/notes/20-seating-chart-generator-notes.md`) did the headline work: adopted
`gvb-save.js`, rewrote print, added full keyboard operation and fit-to-window zoom, rewrote the roster
paste parser, and fixed two real solver bugs. What's left is one small loose end, then real feature
work.

**Task one: invert one assertion in your own test file.** `Tools/seating-chart/test/smoke-seating.mjs`
has one assertion —
`'createSaveSlot without an explicit storage throws in this configuration (gvb-save gap)'` — written on
purpose to assert the *old*, buggy behavior of `gvb-save.js`'s construction-time `typeof localStorage`
guard. That guard is now fixed (locked decision #49, `gvb-site-handoff-v8.md` §4 — this project's own
shared-file request, applied). Right now `node Tools/seating-chart/test/smoke-seating.mjs` gives **122
passed, 1 failed**, and that one failure is this assertion, exactly as the round-1 notes predicted ("it
will fail loudly and want inverting when the fix lands"). Flip it to assert that `createSeatingSlot()`
now succeeds without an explicit `storage` argument and returns a working slot, or delete it and write a
positive assertion in its place. This is your own file; nobody else can touch it.

**Task two, the headline remaining feature: row-aware constraints, on top of a room model.** "Front row
for a vision IEP" is currently a flag plus manual placement, not a rule the solver enforces. Give the
room named zones (front row, by the door, back corner) that a desk can belong to, then let a flagged
student require one. Per the round-1 notes, this is deliberately not a quick fix — inferring rows from y
coordinates is a guess that breaks for exactly the horseshoe and pod layouts the flag matters most in,
so the honest version needs a real room model first. Budget a session, not an afternoon.

**Task three: layout presets** (horseshoe, pods, double rows, lab benches), built on the same room model
once it exists. Desks are already free coordinates and dragging already works; what's missing is the
one-click preset. Cheap once task two lands — don't build it first, or you'll be redoing a preset built
against zones that don't exist yet.

**Task four: print all sections in one job**, one page each. Currently one section per print job, which
is right for a single class but means three trips through Ctrl+P for a teacher with three sections.

**Smaller, if there's time: rotated desk labels.** A desk turned 90 degrees keeps its box dimensions, so
a long name clips into two sideways lines. Pre-existing, cosmetic, and swapping width/height on a
quarter-turn also changes what counts as a neighbour for the solver, so it isn't a one-line fix. Worth
ten minutes watching whether the rotate control gets used at all before spending an hour on the
geometry.

## Verification

- `node Tools/seating-chart/test/smoke-seating.mjs` → 123 assertions total. As of this refresh: **122
  passed, 1 failed** — that failure is task one above (the deliberate old-behavior assertion), not a new
  bug. It should read 123/0 the moment task one lands.
- `node Tools/seating-chart/test/drive-seating.mjs` → 81 checks, 0 failed.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed (the shared module; you shouldn't need to
  touch it).
- `cd Tools/board-check && npm run tools` → 18 checks, 0 failed, and this page is one of the six it
  covers.
- `cd Tools/board-check && npm run check` → the site-wide unit count moves every round (331 as of this
  writing) — run it yourself for the current number. This page itself has 0 offsite references either
  way. As of this writing the one broken entry on the board is `newindex.html`, an unrelated
  in-progress page (not one of the twenty numbered projects) hotlinking Google Fonts directly — if you
  see a broken entry, check whose page it is before assuming it's yours.
- `npm run social:check` → as of this writing this command fails outright ("only parsed 17 notices out
  of index.html — the notice markup has changed shape"), a board-level tool problem unrelated to this
  project. Not yours to fix; if it's still broken when you read this, that belongs in prompt 21's or a
  future round's notes, not here.
- Locked decision #34 still applies to anything new you add: break the thing on purpose first and watch
  it fail. A save test that passes against a tool with no save is not a test.
- Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
  windows, and Chrome throttles a window that loses focus. This page isn't part of `npm run games` (that
  only drives the seven games), but the one-suite-at-a-time rule still applies if another thread is
  running one alongside you.

## Output: your notes file

Write `Claude Prompts/notes/20-seating-chart-generator-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-one of them. (This overwrites round 1's notes file; the archived copy under
`Claude Prompts/archive/` is where that version lives on.)

Use these headings:

```
# Seating Chart Generator — session notes

## Student data
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the extra first heading, which only this prompt asks for. **Answer it directly:** whether any real
student names were in the file, what the tool stores and where, whether a user can clear all of it in
one action, whether the UI tells them the truth about it, and — if you touched the notes field —
what you did to keep it clearly labelled.

- **What changed** — files touched and why, with paths. **Name every storage key explicitly** if you
  touch storage; it's permanent and the next session needs to know it. Vendored font total in KB, if you
  touch fonts.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — a board `href` if you renamed, any `gvb-save.js` gap with the exact hook
  signature. Applicable blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was wrong,
say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or "robust"
anywhere.
