# Seating Chart Generator — session notes

## Student data

**Were there real student names in the file? No.** The only names in the 1,031-line
original were three examples in a `placeholder` attribute (Ada Lovelace, Marco Polo,
Mansa Musa) and the seed created three sections with empty rosters. There was no
hardcoded example class and nothing had to be removed. Every name in the tests and
screenshots is a historical figure.

One name change that is not a data change: the seeded sections were Honors,
Academic, Foundational. They are now Honors GT, Honors, Academic, because
Foundational is not a level any more (it folded into Academic). All three start
empty either way.

**What it now stores, and where.** One localStorage key, `seating-chart-v1`, in this
browser on this computer. It holds, for every section: the section name, the roster
(names), each student's private note and flag, every desk's coordinates, rotation
and pin, the seat assignments, plus which section is showing, the theme, the
fit-or-actual zoom, and whether the roster paste box should flip "Last, First".
Nothing else, and nothing anywhere else. The page now makes **zero network
requests** (the two font families were hotlinked from Google and are vendored, see
below), so a full roster of names can be on screen with no request leaving the
machine.

**Can a user clear all of it in one action? Yes.** "Erase saved data" in the
toolbar: a confirm dialog, then the key is deleted and the page comes back empty.
That is `mountSaveBar`'s reset button relabelled, so it still carries
`data-gvb="reset"`. Two things I had to fix to make the claim honest:

- The autosave timer that was already ticking when the button was pressed fired a
  second later and wrote the fresh empty state straight back under the same key.
  The names were gone either way, but "I erased it" should mean the key is gone.
  Erase now cancels the pending write.
- Erasing must not switch saving off for the rest of the session. Tested
  separately: add a desk after erasing and it saves again.

**Does the UI tell them the truth?** The privacy box used to say "everything you
enter stays in your browser. Nothing is uploaded anywhere," which was true and
also described a tool that saved nothing. It now names the key, says it is this
browser on this computer, says the notes are in there too, and points at both
Erase saved data and Save to file, with the line that on a shared classroom
machine one of those two is the habit worth having. If the browser is blocking
storage, that box is replaced at boot by a warning that charts will not survive a
reload and that Save to file is the way out.

**The notes field.** It already existed (a per-student pencil icon writing to
`student.note`), so this was about labelling rather than whether to add it. What I
did:

- The sidebar hint now says notes are stored with the chart in this browser **and
  inside any file you export**, that they never appear on the printed page, and to
  keep them short and practical, "front row, vision" rather than anything from a
  medical or IEP document.
- The prompt dialog repeats it in two lines instead of the old parenthetical.
- **Notes never print.** Neither does the gold flag outline. The flag means "this
  student needs a particular spot", which is the most sensitive thing on the
  screen, and a printed chart is exactly the document that gets left face-up on a
  desk. The printed sheet is names, positions, section, date, counts. There is an
  assertion for the flag outline being gone in print.

## What changed

- **`Tools/Seating Chart Generator.html`** (1,031 to 1,261 lines). Same path, same
  URL, no board request. Now an ES-module page.
  - **Persistence through `assets/js/gvb-save.js`.** Storage key
    **`seating-chart-v1`**, schema **version 1**, game slug `seating-chart`. The
    trailing `v1` is part of the key name and does not move when the schema
    version does (locked decision #36). Autosave coalesces at 1,200 ms and flushes
    on tab hide, which the module does for free. Every mutation funnels through one
    `touch()`, so there is no path that changes a chart without saving it.
  - **`defaults` is a factory** (`freshState`), not a literal. Every section and
    every desk carries a generated id, so a shared literal would hand two resets
    the same ids. Same gap The Fourth Quarter found with its three random job
    applicants, for a different reason.
  - **Fill-ins are in `repair`, not `migrate`** (locked decision #37).
    `repairState` drops a section that is not an object, a student with no name, a
    keep-apart pair pointing at a deleted student, a pair that is somehow both
    apart and together, a seat assignment for a desk or student that no longer
    exists, and the same student seated at two desks. It repoints an `active` id
    that goes nowhere, clamps a desk back inside the room, and turns junk
    coordinates into numbers.
  - **The bug class it is written against**, in this tool's terms: a desk that
    comes back with `undefined` in a numeric field. `Math.hypot` gives NaN,
    `NaN <= 142` is false, so the desk reads as having no neighbours, and a desk
    with no neighbours silently satisfies every keep-apart rule. Auto-assign would
    report "All seating rules met" while sitting two students who must be
    separated elbow to elbow. No error, no crash, a constraint engine that quietly
    stopped constraining. That is the missing `speed` from v7 §2 wearing different
    clothes, and there is a test that a repaired desk still has neighbours.
  - **Save bar in the toolbar, not behind anything** (v7 §9's still-open item, not
    repeated here). `buttons: ["export", "import", "reset"]`, relabelled after
    mounting to "Save to file", "Open file", "Erase saved data" because the
    module's game-save wording does not fit a teacher's charts. `data-gvb`
    attributes untouched, so the driver clicks them by attribute.
  - **Files saved by the previous build still open.** The old "Save file" button
    wrote the bare state with no envelope and no version stamp. `normalize()`
    reads that as version 0 and `repair` fills in everything added since. Tested
    with a hand-written old-format file, including a desk from before rotation
    existed getting `rot: 0` rather than `undefined`.
  - **Print, rewritten.** `@page { size: letter landscape }`, a header (section
    name, seated-of-total, desk count, date, and a count of anyone with no desk),
    and a `beforeprint` pass that trims the page to the desks that exist and scales
    that box to the sheet, up to 1.5x as well as down. Before this, Chrome's print
    dialog opened portrait and sliced the right-hand column of desks off the page.
  - **Keyboard path.** Each desk now has one focusable seat button with an
    `aria-label` ("Seat 4 of 32, Ada Lovelace, flagged"), and every desk action is
    on a key: Enter picks a student up and puts them down (swapping if the target
    is occupied), Escape cancels, R rotates, P pins, Delete removes the desk,
    arrows nudge it one grid step (Shift for three). The three hover buttons are
    `tabindex="-1"` so 32 desks are 32 tab stops instead of 128. Pool chips are
    real buttons now, the pair selects and the toolbar number boxes have labels,
    and the status line is an `aria-live` region.
  - **Fit-to-window zoom.** The floor is 1,280 by 900 and used to overflow
    sideways on anything smaller. It now scales to the stage by default with an
    "Actual size" toggle. Pointer deltas are divided by that scale, which is the
    one thing that quietly breaks if you add a transform and forget.
  - **Roster paste that survives a spreadsheet.** `parseRoster` handles a plain
    column, a paste with an id column and other junk columns, hand-typed numbering
    ("1. ", "2) "), wrapping quotes, and an optional "Last, First" flip (a
    checkbox, remembered in the save). Duplicates inside the paste and against the
    existing roster are skipped and counted back at the teacher.
  - **Solver fix: more students than desks.** The old `autoAssign` bailed out of
    the constraint solver entirely when the desks ran out (`tryOnce` returned null
    every attempt) and fell through to a random fill that ignored every keep-apart
    and put-together rule. So the case of 28 students in a 24-desk room, which is
    a real classroom, silently turned the rules off. It now seats as many as the
    room holds, keeps the rules while doing it, leaves the rest in the pool, and
    says so in the status line. Scoring prefers more students seated over fewer
    broken rules, on the grounds that a chart that seats everyone with one broken
    rule beats a spotless chart that seats 24.
  - **Fonts vendored**, hotlinks deleted, `@font-face` pointing at the local files.
  - **A boot warning.** A module page that cannot load its modules renders a blank
    floor and says nothing. If boot has not happened 2.5 s in, a banner explains
    that the page needs to be opened from the site rather than from a file on disk.
- **`Tools/seating-chart/seating.mjs`** (new, 476 lines). The save slot, the state
  shape, `validateState`, `repairState`, the seat solver, the constraint checker,
  the cold-call picker, the roster parser and the layout maths. No DOM, so Node
  runs it as-is. Imports gvb-save by relative path (`../../assets/js/gvb-save.js`).
- **`Tools/seating-chart/test/smoke-seating.mjs`** (new). 123 assertions, no
  browser. Exits 1 on failure.
- **`Tools/seating-chart/test/drive-seating.mjs`** (new). 81 checks in a real
  headless browser, borrowing `serve()`, `launch()` and `prepPage()` from
  `Tools/board-check/harness.mjs`. Exits 1 on failure. Headless on purpose so it
  does not fight `npm run games` for the screen (v7 §6).
- **`Tools/seating-chart/fonts/`** (new). **143 KB total (146,400 bytes)** in three
  files: `fraunces-latin.woff2` 67,304, `spline-sans-latin.woff2` 57,984,
  `spline-sans-latin-ext.woff2` 21,112. Both families are variable fonts, so one
  file per subset covers every weight and Fraunces keeps its optical-size axis.
  Plus both OFL licence texts and a README.
- **`Tools/seating-chart/README.md`**, **`fonts/README.md`**, **`.gitignore`**
  (`shots/`, same as board-check ignores its own).

## What I verified

Measured before and after with the same chart: 28 students, a 6x5 grid with two
corner desks removed, a pod of four added, so 32 desks and four seats that stay
empty.

**The print, which was the second-biggest thing wrong here.** Baseline, printing
the unmodified page at Letter landscape, was fine. Baseline at Letter **portrait**,
which is what Chrome's dialog opens on, cut the right-hand column in half:
"Zheng He", "Fatima al-Fihri", "Nellie Bly" and "Harriet Tubman" all lost their
right edge to the page boundary, and two thirds of the sheet below the desks was
blank. After: `@page` makes it landscape without anyone touching a setting (the
driver reads the PDF's MediaBox and asserts it comes out 792x612pt rather than
612x792), the trimmed box is 979pt wide at most, the desks are 1.18x bigger
because the trim lets them scale up, and the header reads
"Honors GT / 28 seated of 28 / 32 desks / July 28, 2026". One page.

```
node Tools/seating-chart/test/smoke-seating.mjs   →  123 passed, 0 failed
node Tools/seating-chart/test/drive-seating.mjs   →   81 checks, 0 failed
node assets/js/gvb-save.test.mjs                  →   39 passed, 0 failed (untouched)
cd Tools/board-check && npm run check             →  298 units checked, 0 broken
                                                     0 collisions, tightest gap 7.1px
cd Tools/board-check && npm run social:check      →  23 notices, 23 already current
grep -c fonts.googleapis.com on the page          →  0
```

`npm run check` counts 298 units rather than the 235 in the prompt because other
sessions have been adding files to the same repo all round; 0 broken is the number
that matters.

What the browser driver actually does, since "should work" is not verification:

- Builds the chart above by clicking real buttons, then waits out the autosave and
  reads `localStorage` directly: three sections, 28 students, 28 seats, `__v: 1`.
- **Reloads the page.** 32 desks and all 28 students come back in the same seats,
  and the status line says "Reloaded 3 sections and 28 students from this browser."
- **Two sections at once.** Builds a second chart (four students, 2x2 grid) in
  Honors, switches back, finds the first room and its 28 seats untouched, and
  confirms both sections are in one save side by side.
- **Exports to a file** through the real download event: the name matches
  `seating-chart-save-YYYY-MM-DD.json`, the envelope carries `format: "gvb-save"`
  and `game: "seating-chart"`, and the state carries the whole roster.
- **Erases saved data**, confirms the key is gone and the page is empty, then
  **imports the file back** through a real file picker: 32 desks, 28 students, all
  seated, and the imported chart is written to storage too.
- **Feeds it a deliberately corrupt file** (a valid envelope wrapped round
  `"sections": "Honors"`). The chart on screen is left alone and the status line
  says the file is not a valid save. Then puts a truncated blob into
  `localStorage`, reloads, and confirms the page boots to a fresh empty state
  rather than white-screening.
- **Storage blocked**, simulated the way Chrome actually does it: reading the
  `localStorage` property throws SecurityError, injected before any page script
  runs. The page still boots, still has its sections, the privacy box is replaced
  by the warning, and building a chart still works inside the session.
- **Drag with the floor scaled**: a 120,60 pointer drag moves the desk 120,60 on
  screen, not 145,72.
- **Keyboard only**: Enter picks a student up and Enter on another desk swaps them,
  R rotates, P pins, ArrowRight moves the desk exactly one 22px grid step, and all
  32 seats are focusable and labelled.
- **375x812**: nothing spills sideways (horizontal overflow 0), the room scales to
  0.26, the whole chart is there, and the chart is 682px down the page rather than
  the 4,700px it was before the sidebar got a height cap.
- Zero page errors, zero failed requests and zero offsite requests across the
  whole run.

Per locked decision #34, each guard-rail was broken on purpose first and watched
to fail:

| Broken | Result |
| --- | --- |
| `validateState` returns `true` | 9 failures, including three "corrupt blob loads as null" checks now loading a state |
| `repair` stops pruning `assign` | the "drops seats for missing desks and students" check fails, keeping `d3: "ghost"` |
| `num()` stops replacing junk with a number | junk coordinates survive and the "a repaired desk still has neighbours" check fails |
| the solver's keep-apart filter | 5 of 10 seeded single-pass rooms break a rule (see below) |
| the drag's `/ scale` | the drag moves 26,-10 for a 120,60 drag, and three keyboard checks fail with it |
| `@page { size: letter landscape }` | the PDF comes out 612x792pt |

The keep-apart sabotage is worth a note on decision #40. My first version of that
test passed with the filter removed, because the solver picks the best of 800
random passes and scoring alone found a legal arrangement. The test now runs
`attempts: 1` against a row of ten adjacent desks across ten fixed seeds, so it
pins the per-candidate filter rather than the retry loop. Seeded, not retried.

## Shared-file requests

**1. `assets/js/gvb-save.js` line 66: the private-mode guard throws.**

```js
const store = storage || (typeof localStorage !== "undefined" ? defaultStorage() : null);
```

In a browser configured to block site data, reading the `localStorage` property
throws SecurityError, and `typeof localStorage` performs that read. So
`createSaveSlot()` throws before `defaultStorage()`'s try/catch can catch
anything, and a page that adopted the module dies on boot in exactly the
configuration the memory fallback exists for. Verified in Node by defining a
throwing getter: `defaultStorage()` survives and returns the memory stub;
`createSaveSlot({game:"x"})` throws `SecurityError`.

Replace with:

```js
let store = storage;
if (!store) {
  try { store = typeof localStorage !== "undefined" ? defaultStorage() : null; }
  catch (e) { store = defaultStorage(); }   // property access itself threw
}
```

`defaultStorage()` is already safe to call unconditionally, so
`try { store = storage || defaultStorage(); } catch (e) { store = null; }` works
too. The Seating Chart Generator works around it by passing
`storage: defaultStorage()` explicitly, which short-circuits the ternary. Any
other adopter that leaves `storage` out is exposed. There is a test for the gap in
`Tools/seating-chart/test/smoke-seating.mjs` (it asserts the throw, so it will
fail loudly and want inverting when the fix lands).

**2. `assets/js/gvb-save.js`, `mountSaveBar`: no way to set button labels.**
"Export save" / "Import save" / "Start over" are written for a game. This tool
wants "Save to file" / "Open file" / "Erase saved data", and it gets them by
querying `[data-gvb="..."]` after mounting and overwriting `textContent` and
`title`, which is fine but means the labels live away from the mount call.
Suggested signature, backwards compatible:

```js
mountSaveBar(container, slot, {
  buttons: ["export", "import", "reset"],
  labels: { export: ["Save to file", "Download all sections as one .json file"] },
  //        kind:    [label,          title]
});
```

**3. `Tools/board-check/harness.mjs`: `page.__blocked` cannot see a font
hotlink.** `prepPage()` fulfills `fonts.googleapis.com/css` from the bundled
`@fontsource` packages before the blocked-list check runs, which is why v7 §5
could claim zero offsite requests site-wide while fifteen pages hotlinked two
font families. Suggestion: push the fulfilled URL onto a new `page.__shimmed`
array in both the Playwright and Puppeteer branches, next to the existing
`blocked.push`, so a caller can assert on it. Four pages still reference
`fonts.googleapis.com` as of tonight (`index.html`, `404.html`,
`Projects/daredevil_r4.html`, `Projects/Ren-Faire-Claude/index.html`), so the
inventory is worth being able to measure rather than grep for.

## Deliberately not done

- **Did not split the page.** It is 1,261 lines now and one file, at the same path,
  so `/Tools/Seating%20Chart%20Generator.html` still resolves and the board needs
  nothing. The pure logic moved to `seating-chart/seating.mjs` because a Node test
  cannot drive a `<script>` block, not as a restructuring.
- **Room-layout presets** (horseshoe, lab benches, U-shape). The tool can already
  express them: desks are free coordinates, "+ Pod of 4" exists, and dragging
  works. What is missing is a one-click preset, which is cosmetic next to
  persistence, and adding four presets would have cost the print work.
- **Row-aware constraints.** "Front row for a vision IEP" is still a flag plus
  placing that student by hand, not a rule the solver enforces. A "must sit in the
  front row" rule needs the room to have rows, and inferring rows from y
  coordinates is a guess that is wrong for exactly the horseshoe and pod layouts
  the flag matters most in. The honest version of this feature is a room model,
  which is a session, not an afternoon.
- **Rotated desks clip long names.** A desk turned 90 degrees keeps its 106x70 box,
  so "Katsushika Hokusai" renders sideways into two clipped lines. Visible in
  `Tools/seating-chart/shots/chart-print.pdf` from an earlier run of the driver.
  Pre-existing and cosmetic; swapping width and height on a quarter turn also
  changes what counts as a neighbour, so it is not a one-line fix.
- **Printing every section at once.** One section per print, which is what a
  teacher printing one class wants, but the sub folder case ("here are all three
  of my classes") means three trips through Ctrl+P.
- **Fraunces latin-ext and vietnamese subsets**, measured at 59,388 and 19,700
  bytes and dropped: Fraunces only renders the page heading and the printed
  section title, never a student name. The reasoning is in
  `Tools/seating-chart/fonts/README.md` so it does not become folklore (decision
  #42, and this is the second time measuring first changed the answer).
- **Did not edit `gvb-save.js`**, despite the bug in request 1 above. Six projects
  read that file.

## Next session

1. **Apply shared-file request 1.** Two lines in `gvb-save.js`, and it is the
   difference between the module's headline safety feature working and taking the
   page down. Invert the assertion in `smoke-seating.mjs` when it lands.
2. **Row-aware constraints, on top of a room model.** Give the room named zones
   (front row, by the door, back corner) that a desk can belong to, then let a
   flagged student require one. This is the feature that turns the flag from a
   reminder into a rule, and it is the last big gap between this tool and how a
   teacher actually thinks about a chart.
3. **Layout presets** using that same room model: horseshoe, pods, double rows,
   lab benches. Cheap once zones exist, and the thing that stops a teacher with a
   non-rectangular room from giving up in the first thirty seconds.
4. **Print all sections**, one page each, in one job.
5. **The four pages still hotlinking Google Fonts.** The pattern here is copyable:
   one variable woff2 per subset, a weight range in `@font-face`, `unicode-range`
   copied from the css2 response, a README naming source, licence and bytes. The
   board and 404 are prompt 21's; `daredevil_r4.html` and Ren-Faire are their
   owners'.
6. **Rotated desk labels**, if anyone actually rotates desks. Worth ten minutes of
   watching whether that control gets used at all before spending an hour on the
   geometry.
