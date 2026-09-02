# Schedule Visualizer and Browser Generator — Feature Wishlist

**Status: three rounds are shipped, nothing is currently open, and
Phase 1 below is the first open phase, on Claude Fable 5.1.** Round 1
vendored the fonts and settled the versioned-filename question, round 2
read the simulation half and fixed the PDF size, round 3 cut
`Tools/schedule-visualizer.html` from 863,737 bytes to a 124,566-byte
shell plus `Tools/schedule/app/`, and closed the `gvb:social`
publish-drift gap. Last round's verdict: `structure.mjs` 31 passed / 0
failed, `smoke.mjs` 73 passed / 0 failed, `npm run tools` 18 checks / 0
failed, published output byte-identical to the pre-restructure baseline.
`structure.mjs` was re-run while writing this file and is still 31/31
across 491 top-level names; `smoke.mjs` needs `puppeteer-core`, which
this checkout does not have, so its 73 is last round's number rather
than a fresh one. One question has been open three rounds and blocks one
phase: how storage quota should be handled for `gvb-save.js` adoption.

## What it is

A classroom tool at `Tools/schedule-visualizer.html`, served from
greyversusblue.com under the board's "Town Services" section. A teacher
draws their school on a grid — classrooms with room numbers, teachers
and departments, hallways, staircases, multiple floors — types or
imports the master schedule, and the tool routes every student group's
day through the building. It answers what a paper timetable cannot:
which corridor cell carries the most bodies at 10:00, how long 7-1's
walk from 106 to 201 takes, and what happens to both if you move one
section.

Then it publishes. **Publish for Teachers** emits
`Tools/schedule-browser.html`: one standalone read-only file, every font
a data URI, zero offsite requests, no `localStorage` — a file you email
to staff and they open off the desktop. The committed copy is the real
East Middle one, 34 teacher surnames and a floor plan, and the suite
opens it from `file://` on every run.

It is eight files pretending to be one: no build step and no module
system, seven classic `<script src>` tags in the body plus one `<link>`,
loaded in source order, sharing one global lexical scope across 491
top-level names. That is argued out in `app/README.md`, the best
architecture document in this repo and the thing to read before moving a
line between files. What it is not is tested. `smoke.mjs` drives import →
publish → open, plus sixteen assertions added in round 3 across
pathfinding, congestion and playback — but those assert shapes (`> 0`,
`is a number`), never values. The blueprint editor's 3,092 lines,
undo/redo, the CSV importer and the whole What-If Lab have no assertion
of any kind. It is also not a scheduler: it reports what a schedule does
to a building and will not tell you what to change.

## The architecture that is there

Bottom-up, in load order. Every file is a contiguous range of the
original monolith and says so in its header comment.

- **`app/data-model.js`** (1,349 lines) — `AppState`, the storage keys,
  `serializeBlueprint` / `applyBlueprintData`, `roomRegistry` and
  `rebuildRoomRegistry`, staircase pairing, `runAction` /
  `undoBlueprint` / `redoBlueprint`, and the two pure helpers the whole
  simulation leans on: `groupWeight` (218) and `congestionDelayMult`
  (236, a four-piece curve capped at 0.8).
- **`app/layout-editor.js`** (3,092 lines) — the canvas grid editor:
  `applyTool` (897), `setActiveTool` (2714), all five right-panel
  editors, doorways, drag, zoom, context menu, and `isCellHeatExcluded`
  (2612), which pathfinding calls back into.
- **`app/schedule-ui.js`** (2,306 lines) — settings, bell and subjects
  editors, tabs, toasts, the schedules module, CSV bulk import, the bulk
  editor, and `computeScheduleConflicts` (594).
- **`app/pathfinding.js`** (713 lines) — `buildMultiFloorGraph`, `astar`
  with its own `MinHeap`, `resolveRoomPath`, `findGroupDayPath`,
  `computeCongestionMap`. **Zero `document.` references in the whole
  file**; its only outside names are `AppState`, `roomRegistry`,
  `getAllModLabels`, `groupWeight`, `getPairLabel` and
  `isCellHeatExcluded`. A pure module in a classic script's clothes,
  which is why Phase 1 exists.
- **`app/viz-playback.js`** (3,743 lines, the largest) — path rendering,
  congestion colouring, the hotspot table, `PlaybackController` (2523),
  `computeTravelTimes` (3644), PDF and PNG export. The seam the notes
  name — old line 14729 — is line 2510 here, the `ROUND 30 — PLAYBACK
  ENGINE` divider.
- **`app/app-shell.js`** (1,660 lines) — onboarding,
  `serializeFullProject` / `applyFullProject`, the five snapshot slots,
  presentation mode, the 891-line What-If Lab (`wiComputeMetrics` 930,
  `wiComputeDiff` 1076), and `init()`.
- **`app/browser-template.js`** (1,195 lines) — `BR_CSS`, every `br*`
  function, the publish codegen. Loaded from its own `<script src>`
  further down the shell (line 2119, not with the other six at
  2053-2058), where it sat inline.
- **`app/visualizer.css`** (2,788 lines) — the head `<style>` then the
  What-If panel's, in that order, so the cascade sees what it saw. One
  `prefers-reduced-motion` block, at line 2690, on the join.

The load-bearing habits: **byte-preservation**, because the publish path
stringifies its own source through `Function.prototype.toString`;
**contiguity**, so the 130 top-level statements and ~40 parse-time
listeners keep their order; and **data-not-code in the published file**,
where everything a Schedule Browser knows arrives as one
`PUBLISHED_DATA` literal (18,412 characters in the committed copy).

Where it breaks down: nothing here is a pure module with a suite.
`pathfinding.js` earns one and does not have one. `congestionDelayMult`
is four lines of arithmetic that every travel number depends on and
nothing checks it. And one rule — two groups in one room in one block —
is implemented twice, in `computeScheduleConflicts` (schedule-ui.js:594,
keyed `${idx}-${room}`) and in `wiComputeMetrics`'s Pass 5
(app-shell.js:1044, keyed `idx+'|'+room`).

## Conventions a new builder must know

Read `Tools/schedule/app/README.md` first. These are the short form.

- **Run `node Tools/schedule/test/structure.mjs` before anything else.**
  No dependencies, about a second, 31 assertions, and the only check
  that catches what the split can break. A duplicate top-level `const`
  across two files is a load-time SyntaxError that `smoke.mjs` reports
  as forty unrelated failures.
- **Load order is source order and the `<script src>` list is the
  contract.** No `defer`, no `async`, no `type=`: about forty
  `getElementById(...).addEventListener(...)` calls bind at parse time,
  and some reorderings still pass smoke.
- **Function bodies are free; top-level statements are not.** If what
  you are moving sits at column 0 and is not `function` / `const` /
  `let` / `var` / `class`, work out where it lands relative to what it
  touches. There are 130 of them.
- **Do not reformat `browser-template.js`.** `brPublishFnList().map(f =>
  f.toString())` and four more `.toString()` calls put function source
  into every published file, so a cosmetic reindent changes published
  bytes and fills the only regression signal this tool has with noise.
- **Generate before, generate after, diff.** `node
  Tools/schedule/test/publish.mjs out.html` boots the generator headless,
  applies the Northwind fixture and runs the real Publish path. The
  fixture's `savedAt` is fixed; the footnote's publish date is today's,
  so expect one line of diff for free.
- **Adding an eighth generator file is four edits:** the contiguous
  range, the `<script src>` tag in position, the name in
  `structure.mjs`'s `GENERATOR` array, and a header comment naming the
  old line range.
- **Every storage key stays exactly as it is** (locked decision #36) —
  including that snapshots are `STVIZ_SNAPSHOT_0..4` in caps while
  everything else is `stviz_*` in lower. Fill-ins go in `repair`, never
  `migrate` (#37).
- **Never hand-edit between the `gvb:social` markers** (#31).
  `brBuildPublishedHTML()` takes an optional `socialBlock` and emits it
  verbatim; the live Publish button passes nothing on purpose, so a
  teacher's own download never carries a greyversusblue.com URL.
- **`Tools/schedule-browser.html` is not regenerated automatically.**
  Three rounds have hand-patched it. Pull the replacement text out of
  `browser-template.js` programmatically rather than retyping it.
- **Break every guard on purpose before believing it** (#34). Round 19's
  offsite check passed its first break test: the filter only flagged
  URLs next to `src`/`href`/`url`/`fetch`/`import`, so a bare `const CDN
  = "https://..."` walked straight through.
- **Zero offsite requests, both files, forever.** Fonts are vendored
  woff2 under `schedule/fonts/`, jsPDF 2.5.1 under `schedule/libs/`, and
  `check-integrity.mjs` now sweeps `.js`/`.mjs`/`.css` too (#58 — this
  project's own round-2 request, applied; do not re-file it).
- **Every fixture name is invented and stays that way.** The committed
  browser file is public. The East Middle data in `PUBLISHED_DATA` is
  Devon's decided exception and is not reopened.
- **`Tools/board-check/` is another thread's.** `publish.mjs` and
  `smoke.mjs` import its `harness.mjs` read-only. Anything it needs is a
  Shared-file request in the notes, not an edit.

## Questions for Devon

**How should storage quota be handled for `gvb-save.js` adoption?** Open
three rounds; the answer has been "skip adoption" each time. The
measured facts, so it can be answered rather than deferred a fourth
time:

- 23 `localStorage` call sites remain in `app/` — 13 `getItem`, 8
  `setItem`, 2 `removeItem` — across seven key families
  (`stviz_settings`, `stviz_settings_time`, `stviz_viz_prefs`,
  `stviz_blueprint`, `stviz_schedules`, `stviz_onboarded`,
  `stviz_whatif`) plus five snapshot slots.
- **Every snapshot is a whole project.** `saveSnapshot` stores
  `serializeFullProject()`, blueprint included, so a browser with all
  five slots used holds six copies of the blueprint.
- **The save paths disagree about what a full disk means.**
  `saveSnapshot` is the only one that tells the user: it names
  `QuotaExceededError` / code 22 / `NS_ERROR_DOM_QUOTA_REACHED` and
  toasts "browser storage is full". `saveSchedules`, `saveVizPrefs` and
  `saveBlueprintToLocalStorage` `console.warn` and say nothing on
  screen — and the blueprint one leaves the autosave indicator stuck
  reading "Saving…", because `updateSaveIndicator()` is inside the
  `try`. `saveWhatIf` swallows it with `/* quota — non-fatal */`.
  **`saveSettings` and `saveLastSavedTime` have no `try`/`catch` at
  all** (data-model.js:289 and :308) and throw out of their caller.
- The only size accounting anywhere is `listSnapshots`'s `raw.length *
  2` per slot, printed against a hardcoded "~5 MB".
- `createSaveSlot` is one key; `save()` returns `false` on quota with no
  way to learn how much room there was. `mountSaveBar`'s three buttons
  act on one state.

So: (a) one slot holding the whole project — which collides with locked
decision #36, since seven keys would become one — or seven slots, which
needs `createSaveSlot` to grow a namespace and a shared budget? (b) When
the disk is full, which write loses: the newest snapshot, the oldest, or
the What-If sandbox? (c) Is IndexedDB spillover for the blueprint
acceptable, when nothing else on the site uses it? Any answer that
changes `assets/js/gvb-save.js` is a Shared-file request to prompt 22.

**Is there a copy of the real East Middle project file anywhere?** Three
rounds have been unable to regenerate `Tools/schedule-browser.html` end
to end because the real blueprint lives in whoever's browser last built
it. Phase 3 works around it with no data at all, but a real project
export would retire the caveat outright.

## The standing backlog

Open and unclaimed. Add here rather than starting a new list.

**Storage**
- `gvb-save.js` adoption, blocked on the question above.
- `saveSettings` / `saveLastSavedTime` throw on a full disk.
- The blueprint autosave indicator sticks on "Saving…" when a write
  fails.
- Nothing reports total `localStorage` use except the snapshot footer,
  which counts only snapshots.

**Tests**
- The blueprint editor, undo/redo, doorways, staircase pairing, the CSV
  importer and the What-If Lab have no assertions.
- Round 3's sixteen simulation assertions test shapes, not values. No
  number in this tool is pinned.
- `Tools/schedule/README.md` still says "42 assertions" and that the
  pathfinding engine has no tests. Both were true before round 3.
- Nothing but `structure.mjs` runs without `puppeteer-core`.

**The publish path**
- The committed browser has been hand-patched three rounds and never
  regenerated for real.
- `brBuildPublishedHTML()` calls `brLoadFromVisualizer()` itself, so
  there is no way to publish from a given data object.
- Nothing checks that the committed `PUBLISHED_DATA` still parses or
  still matches the template that would emit it today.

**Architecture**
- `viz-playback.js`, 3,743 lines, splits cleanly at line 2510.
- `visualizer.css`, 2,788 lines; the What-If block at the end separates
  cleanly, the rest has never had boundaries.
- The What-If Lab sits in `app-shell.js` and calls congestion helpers
  defined two files earlier — the edge a module conversion would have to
  map first.

**Scheduling and analysis**
- Room double-booking is implemented twice, with two key encodings.
- Teacher double-booking is never checked. Room capacity does not exist:
  a `roomRegistry` record carries `roomNumber`, `teacherName`,
  `teacherDept`, `wing`, `excludeFromConflict`, `floorId` and
  `cellCoordinates`, while groups carry `size`.
- `formatTransitionWindow` (data-model.js:271) prints the passing window
  as a string; nothing compares a segment's `travelSec` to it, so "this
  class cannot physically make it" is unanswerable.
- The What-If Lab holds one unnamed scenario for one day, with no way to
  keep two and compare them.
- A blueprint has no diff, and undo dies with the tab.

**Accessibility**
- `#bp-canvas` has no `tabindex`, `role` or label. Tool shortcuts, undo,
  redo and Delete are bound (layout-editor.js:2791) but selection is
  click-only, so a keyboard user can pick a tool and never place it.
- The published file carries twelve `transition`/`animation`
  declarations and no `prefers-reduced-motion` rule at all.
- The generator's one such block kills CSS transitions and does nothing
  about the six `requestAnimationFrame` loops in `viz-playback.js`,
  which are what actually moves.

## Arc one — the evidence the file does not have

Three rounds went into making this tool legible: the restructure, the
architecture document, `structure.mjs`, the byte-for-byte reproduction
of the split. All of it is about the code, none of it about whether the
numbers the tool prints are right. Arc one closes that — a headless
harness that pins real values, the editor under the same harness, a
published file a machine can rebuild, the storage answer, and then, with
a net finally under it, the split everyone has been deferring. **Ranked
by impact, and the order is the recommendation.**

The model convention here: most phases run on **Claude Opus 5**. **Claude
Fable 5.1** is named only where a wrong answer would be silent — a test
harness designed against 590 KB of global-scope code with no module
boundaries, a save schema every later round inherits, a rules engine
whose output nobody can eyeball — and each phase says why in one clause.
A phase is *finished* only when its branch has become a pull request,
that pull request has merged to main with CI green, and the closing
report names the **next open phase's number and its named model**.

## Phase 1 — The simulation half, in numbers

**Sixteen assertions say the congestion map is nonzero; not one says
what it should be.**

`pathfinding.js` has zero `document.` references and four external
function dependencies, so the A* graph, the multi-floor crossing, the
congestion tally and the travel-time estimator can all run in `node:vm`
with a stub `window`, the Northwind fixture as `AppState`, and four
small stubs — no browser, no `puppeteer-core`, in the second
`structure.mjs` already takes. The fixture was built for this: a
corridor along row 4 from col 1 to col 14, staircases at col 0 and col
15, rooms at known cells, one cross-floor pair at
`floor_0(0,4)↔floor_1(0,4)`. Every distance in it is hand-countable.

- [ ] **`test/sim.mjs`, a vm sandbox.** `data-model.js`,
  `pathfinding.js` and `computeTravelTimes` in one `vm` context with a
  stub `window`, `fixtureProject()` applied, `rebuildRoomRegistry()`
  called. A stub that gets reached and should not have been fails by
  name.
- [ ] **Pin the paths.** `resolveRoomPath('101','102')` and
  `('106','201')` assert exact cell counts and exact
  `staircasePairsUsed`, hand-counted, with the count written in a
  comment beside each.
- [ ] **Pin `congestionDelayMult`.** Four segments, both endpoints of
  each, the 0.8 ceiling, zero and negative. Four lines of arithmetic
  that every travel number depends on.
- [ ] **Pin `computeTravelTimes`.** At `tileWalkTime: 3`,
  `staircaseTime: 8`, `defaultGroupSize: 25`, one named segment's
  `travelSec` and `delaySec` are exact integers and the weights come
  from the fixture's sizes (24, 27, 22, 25), not the default.
- [ ] **Pin `computeCongestionMap`.** The exact peak cell key and
  weighted load for 6-1 and 6-2 sharing 101/102/103 on the A day, plus a
  heat-exclude zone proving an excluded cell leaves the tally.
- [ ] **Break each one** (#34): flip a comparison in `astar`'s heap,
  move the 0.8 cap to 0.9, swap `othersWeight` for a flat count. Each
  fails on its own line and nothing else.
- [ ] **Retire the stale claims** in `Tools/schedule/README.md` — the
  assertion count and the "What is not covered" paragraph.

*Leans on:* `pathfinding.js`, `data-model.js`, `computeTravelTimes`,
`test/fixture-northwind.mjs`. *Save:* none, unless the heat-exclude case
needs a fixture field — then regenerate `fixture-northwind.json`.
*Model:* **Claude Fable 5.1** — designing a sandbox and a set of exact
numbers against 590 KB of global-scope code is where a plausible wrong
assertion does the most damage.

## Phase 2 — The editor under the same harness

**Three thousand lines of blueprint editor, one hand-driven browser
session in round 3, zero assertions.**

Round 3 drove `setActiveTool` / `applyTool` / `runAction` live and
watched the staircase count go 2 → 3 → 2 → 3 through undo and redo. That
was real evidence and it exists only in a notes file. `layout-editor.js`
touches the DOM 152 times, so this half needs the browser harness
`publish.mjs` already provides rather than Phase 1's vm — but the
assertions are the same kind: exact counts, exact serialized output.

- [ ] **Drive the tools.** Place a classroom, a hallway, a staircase and
  a heat-exclude zone through `applyTool`; assert `getTileCounts()`
  exactly after each and that `roomRegistry` picks up the new room.
- [ ] **Pin undo/redo.** A `runAction` sequence, undo to empty, redo to
  full, with `serializeBlueprint()` byte-identical across the round
  trip.
- [ ] **Pin the two-cell room.** The fixture's `room_108` is the
  `isGroupAnchorOn` path: place another multi-cell room, assert only the
  anchor registers, erase the anchor, assert the orphan is not a phantom
  room.
- [ ] **Pin staircase pairing.** Pair two staircases across floors,
  assert `crossFloorPairs`, re-run Phase 1's 106→201 route, assert it
  uses the new pair.
- [ ] **Round-trip the project.** `serializeFullProject()` →
  `applyFullProject()` → `serializeFullProject()` equal on everything
  but `savedAt`.
- [ ] **The CSV importer.** One good file, one with an unknown room, one
  with a duplicate group name: assert the reported counts and that a
  rejected row leaves state untouched.

*Leans on:* `layout-editor.js`, `data-model.js`, `app-shell.js`,
`test/publish.mjs`'s page harness. *Save:* none. *Model:* **Claude Opus
5** — test wiring around a harness Phase 1 and `publish.mjs` already
establish.

## Phase 3 — A published file the machine can rebuild

**The committed browser has been hand-patched three rounds because
regenerating it needs data nobody in this repo has.**

`brBuildPublishedHTML()` calls `brLoadFromVisualizer()` first, which
reads live `AppState`. The three functions under that —
`brDeriveScheduleData(settings, blueprint, groups)`, `brSnapshotBell`
and `brBuildGeometrySnapshot` — touch no DOM at all, and the committed
file already carries its own answer: an 18,412-character
`PUBLISHED_DATA` literal, 34 teachers, one floor. Give the builder a
data seam and the committed file becomes reproducible from itself, with
no real school data leaving anybody's browser.

- [ ] **A data seam.** `brBuildPublishedHTML(socialBlock, data)`: when
  `data` is given, skip `brLoadFromVisualizer()` and use it verbatim.
  The no-argument path is unchanged, which the published diff proves.
- [ ] **`test/rebuild-committed.mjs`.** Parse `PUBLISHED_DATA` out of
  `Tools/schedule-browser.html`, rebuild through the seam, run
  `splice-social-block.mjs`, diff against the committed bytes, and name
  the hunks rather than returning a pass/fail bit.
- [ ] **Accept two moving lines only** — the footnote's publish date.
  Anything else is drift and the script says so.
- [ ] **Bring the committed file back to zero.** Whatever the first run
  shows is three rounds of hand-patch drift; apply the regenerated
  output with `PUBLISHED_DATA` and the `gvb:social` block byte-identical.
- [ ] **Wire it into the suite,** and add the same parse to
  `smoke.mjs`'s "committed site copy" section so a corrupt
  `PUBLISHED_DATA` fails there too.
- [ ] **Break it:** change one character of `BR_CSS` without patching
  the committed file, and watch the rebuild name that hunk.

*Leans on:* `browser-template.js`, `test/splice-social-block.mjs`,
`test/publish.mjs`. *Save:* none — `PUBLISHED_DATA`'s shape is
unchanged, which is the point. *Model:* **Claude Opus 5** — a seam and a
differ around a pattern the tool already has.

## Phase 4 — The storage answer

**Six copies of the blueprint, five different opinions about what a full
disk means, and two writes that just throw.**

The item that has outranked everything for three rounds, and it cannot
start until the question above is answered. What it looks like when it
is: keep all twelve keys exactly where they are (#36), put every fill-in
in `repair` (#37), and give `gvb-save.js` the one thing no other adopter
has needed — more than one slot, with a budget shared between them.

- [ ] **Shared-file request first.** Write the exact `createSaveSlot`
  extension into the notes for prompt 22: a slot group with a namespace,
  `bytes()` accounting per slot, and a `save()` that returns why it
  failed rather than `false`. Specific enough to apply blind.
- [ ] **One slot per key family,** seven of them, each with its own
  `validate` and `repair`, each keeping its existing key string; the
  snapshots stay a family of five behind their existing prefix.
- [ ] **One quota policy, written down once** — which write loses, what
  the user is told, what the indicator shows — used by every path,
  including the two that have no `try` today.
- [ ] **Fix the stuck indicator.** `updateSaveIndicator()` moves out of
  the `try` in `saveBlueprintToLocalStorage`, and a failed write shows a
  failed state instead of "Saving…".
- [ ] **A real usage readout.** The snapshot footer's `raw.length * 2`
  becomes a total across all twelve keys, so the number a user sees is
  the number that matters.
- [ ] **Decide the module question.** `gvb-save.js` is an ES module and
  this page is seven classic scripts by deliberate decision; a
  `type="module"` bootstrap runs before `DOMContentLoaded` so `init()`
  still sees it, but it does not load over `file://`. Pick, and record
  it in `app/README.md` beside the existing ES-module rejection.
- [ ] **Fill a real quota to prove it** (#34): write junk until the
  browser refuses, then exercise all eight `setItem` paths and confirm
  each fails the way the policy says.

*Leans on:* `data-model.js`, `app-shell.js`, `schedule-ui.js`,
`assets/js/gvb-save.js` (read-only; the extension is a request). *Save:*
every key gets a version and a `repair`, with keys and payload shapes
unchanged so an existing browser loads clean. *Model:* **Claude Fable
5.1** — a save schema and a quota policy that everything downstream
inherits, across twelve keys that must keep working for people
mid-project.

## Phase 5 — The seam at 14729

**The largest file in the tool is 3,743 lines and everybody agrees where
it should be cut.**

Path rendering ends and the playback engine begins at line 2510, the
`ROUND 30` divider. The notes named it, `app/README.md` named it, and
both rounds since declined it for the same honest reason: two splits in
one round with two-and-a-bit suites is more than the evidence supports.
After Phases 1 and 2 the evidence supports it.

- [ ] **Cut mechanically, by line range** — a script that copies
  characters and never retypes them, the way round 19 did.
- [ ] **`app/viz-render.js` and `app/viz-playback.js`,** roughly 100 KB
  and 64 KB, each with a header comment naming its old range.
- [ ] **Four edits, not one:** the `<script src>` tag in position, the
  name in `structure.mjs`'s `GENERATOR` array, the header comments, and
  the table in `app/README.md`.
- [ ] **Prove it is a pure move:** published output byte-identical to
  the baseline, `structure.mjs` at 32-plus, Phase 1's numbers unchanged
  to the digit.
- [ ] **Then look at `visualizer.css`.** Split the What-If block, which
  is obvious, or write down why the rest's boundaries are not.

*Leans on:* `viz-playback.js`, `structure.mjs`, `publish.mjs`'s differ.
*Save:* none. *Model:* **Claude Opus 5** — a mechanical move with a
guard that already exists and a differ that proves it.

## Arc two — the questions a schedule actually raises

Arc one is about trusting the tool; arc two is about what a person does
once they do. It builds for the assistant principal who has to move one
section in August and wants to know what breaks, and for the teacher who
opens the published file on a school laptop with a keyboard and no
mouse. Same terms as arc one: **ranked by impact, the order is the
recommendation**, Fable only where a wrong answer would be silent, and a
phase is finished when its pull request has merged with CI green and its
closing report names the next open phase and its model. Nothing here
needs a server or a build step.

## Phase 6 — One conflict engine, and the constraints nobody checks

**The tool knows two groups cannot share room 104 and has no idea
whether either of them can get there in time.**

Room double-booking is implemented twice — `computeScheduleConflicts` in
`schedule-ui.js` and Pass 5 of `wiComputeMetrics` in `app-shell.js` —
with the same `excludeFromConflict` logic and two different key
encodings. Everything else a real timetable breaks on is absent: a
teacher in two rooms at once, a class of 27 in a room that holds 24, and
a nine-minute passing period against an eleven-minute walk.
`formatTransitionWindow` already prints that window; nothing subtracts.

- [ ] **`conflicts.js`, pure, with its suite,** loaded before
  `schedule-ui.js`. One function over `(groups, roomRegistry, settings,
  day)` returning typed findings; both existing call sites become
  callers and neither keeps a copy.
- [ ] **Teacher double-booking.** `roomRegistry` already carries
  `teacherName`; a teacher owning two rooms booked in one block is a
  finding today and is silently invisible.
- [ ] **Room capacity.** An additive `capacity` on the classroom tile
  and its right-panel editor; a group whose `size` exceeds it warns, and
  a room with none set does not.
- [ ] **Passing-time feasibility.** `formatTransitionWindow` grows a
  sibling returning seconds; a segment whose `travelSec + delaySec`
  exceeds the window is a finding naming both numbers. The fixture's A
  day has back-to-back blocks — a zero-second window — which is the test
  case for free.
- [ ] **"What breaks if I move this section."** Given a group, a block
  and a candidate room, return the findings that appear and the ones
  that clear, reusing the congestion model rather than reimplementing
  it; surfaced beside the room dropdown in the Schedules tab.
- [ ] **Pin every rule numerically** against a deliberately broken
  variant of Northwind — the committed fixture is conflict-free by
  construction, so the variant is the one that earns its keep.

*Leans on:* `schedule-ui.js`, `app-shell.js`, `data-model.js`,
`pathfinding.js`, Phase 1's harness. *Save:* additive — `capacity` on a
classroom tile, validated in `validateBlueprintData`, absent meaning
unknown. *Model:* **Claude Fable 5.1** — a rules engine whose findings
nobody can eyeball, replacing two live implementations without changing
what either reports today.

## Phase 7 — Scenarios you can name and compare

**The What-If Lab holds one unnamed idea, for one day, and forgets it
the moment you try the next one.**

`AppState.whatif` is `{ day, overrides, selectedGroupId,
transitionFilter }`, and `wiComputeDiff` compares one scenario against
the baseline. What a planner actually does — hold three arrangements
side by side and pick one — has no home. The metrics half already works:
`wiComputeMetrics` returns per-group travel, congestion, peak, conflicts
and routing errors for any override set handed to it.

- [ ] **Named scenarios.** A list beside the lab, each an override set
  with a name and a timestamp; switching is `wiComputeDiff` against a
  different set, which the existing code already supports.
- [ ] **Both days at once.** A scenario belongs to a day today; a block
  schedule needs one that spans A and B.
- [ ] **Scenario against scenario,** not only against the baseline —
  `wiComputeDiff` takes two override sets instead of one.
- [ ] **A comparison table:** every scenario a row of total travel,
  total delay, peak load, conflict count and routing errors — the
  columns `wiRenderCards` already computes.
- [ ] **Persist and export.** Scenarios join `serializeFullProject` as
  an additive record and ride Phase 4's slot for `stviz_whatif`; an
  older project file loads with one unnamed scenario.
- [ ] **Assert the diff numerically** with two override sets whose
  effect on the fixture is hand-computed, including one that resolves a
  conflict and creates another.

*Leans on:* the What-If Lab in `app-shell.js`, Phase 4's storage, Phase
6's conflict engine. *Save:* additive `scenarios` array; absent means
the single legacy scenario and `repair` fills it. *Model:* **Claude Opus
5** — UI and an additive record over a metrics layer that already
returns everything needed.

## Phase 8 — The tool a keyboard can drive

**You can pick a tool with the `1` key and there is no way to say where
it goes.**

`layout-editor.js` binds tool shortcuts, undo, redo and Delete on
`document`, and `#bp-canvas` has no `tabindex`, no `role` and no label,
so selection is mouse-only and the shortcuts are half a feature. The
published file — the copy most people open — has twelve
`transition`/`animation` declarations and no `prefers-reduced-motion`
rule at all; the generator has one, at `visualizer.css` line 2690, and
it does nothing about the six `requestAnimationFrame` loops in
`viz-playback.js`, which are what actually moves.

- [ ] **A cursor on the grid.** `#bp-canvas` becomes focusable and
  labelled; arrow keys move a highlighted cell, Enter applies the active
  tool, Escape clears — through `applyTool` and `runAction` so undo
  covers it identically.
- [ ] **Announce what happened.** One `aria-live` region for the toasts
  that already exist, so a placement, an undo and a failed save are
  audible.
- [ ] **`prefers-reduced-motion` in `BR_CSS`,** giving the published
  file the rule the generator has. This changes published bytes:
  baseline first, diff after, then hand-patch or let Phase 3 regenerate.
- [ ] **Honour it in the playback engine.** `PlaybackController` checks
  the query and steps rather than animates; the comet trail and the
  pulse canvas hold still.
- [ ] **Focus order and visible focus** through the five tabs, the
  right-panel editors and the modals — they carry `role="tab"` and
  `aria-controls` already and have never been walked with a keyboard.
- [ ] **Drive it in the harness:** tab to the canvas, place a tile with
  arrow keys and Enter, assert `getTileCounts()` changed, and assert
  reduced-motion playback advances with no `requestAnimationFrame` loop.

*Leans on:* `layout-editor.js`, `visualizer.css`, `BR_CSS` in
`browser-template.js`, `viz-playback.js`. *Save:* none. *Model:*
**Claude Opus 5** — surface work, CSS and event wiring around existing
state.

## What this leaves for a later arc

- **ES modules.** Rejected with reasons in `app/README.md` and the
  reasons hold; the What-If Lab's call into `viz-playback.js` is the
  first edge anyone attempting it has to map.
- **A real scheduler.** Everything above reports and none of it
  proposes. A solver that assigns rooms under constraints is a different
  tool, and Phase 6 is its prerequisite either way.
- **Multi-week and lunch sittings.** The model is one day of N blocks,
  A/B; cafeteria capacity across sittings is the first thing that does
  not fit in it.
- **A blueprint history.** Undo is one session, nothing survives a
  reload, and "what changed since Tuesday" has no answer.
- **`visualizer.css`'s interior boundaries,** 2,788 lines that have
  never had any.
- **Anything requiring a build step.** Nothing in view needs one, and
  the tool's defining property is that a browser, a text editor and
  `node` are the whole toolchain.
