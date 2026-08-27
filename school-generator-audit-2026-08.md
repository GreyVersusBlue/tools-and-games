# School Generator — audit, August 2026

Scope: `Projects/school-generator` (50,320 lines of app JavaScript across 82
modules, plus 21,717 lines of tests across 75 suites). Vendored three.js
excluded. Read at branch `claude/school-generator-audit-2kqpgd`.

**All twelve drawing tools work.** The suite is green, the printed sheets are
pixel-identical to their baselines, and the app boots without a console error.
What follows is the markup pass.

| | |
|---|---|
| Unit suite | 1,622 pass / 0 fail (21.1 s) |
| Visual baselines | 8 / 8, zero pixels moved |
| Tools driven in a browser | 12 / 12 responded |
| Boot errors | 0 page, 0 console |

---

## What was actually run

**The suite.** `node --test 'test/*.test.mjs'` — 75 files, 1,622 assertions,
21.1 s, nothing failed and nothing was skipped. Note that `node --test test/`
(the directory form) errors out with `MODULE_NOT_FOUND` on Node 22; the glob is
the invocation that works, and it isn't written down anywhere.

**The pictures.** `test/visual/run.mjs` against the committed baselines — all
eight captures identical, zero pixels moved.

**The tools.** No harness existed for this, so one was built for the audit: a
headless Chromium loads the real page, projects world feet through the live
edit camera to get screen coordinates, and drives each tool with real mouse
events, then reads `window.app.state` before and after. Every tool was
exercised against the sample school and again against fresh geometry. The runs
were under a software rasterizer, so timings are pessimistic — the state
changes are not.

## The twelve tools

| Tool | Gesture driven | State change | What it said |
|---|---|---|---|
| Floor `1` | brush drag | +1 room, +6 verts | (new room baked) |
| Floor `1` | rectangle drag | +1 room, +4 verts | Floor — 32 × 24 ft, 768 ft² |
| Wall `2` | two clicks | `floor.walls` 0 → 1 | Solid wall — 28 ft (1 free-standing) |
| Door `3` | click on a ring segment | opening re-cut in place | Single door — 3.5 ft, cut into a 28.0 ft wall |
| Room `4` | click inside a room | name + colour applied | AUDIT-ROOM — 672 ft² |
| Erase `5` | rectangle drag | +1 ring (hole cut) | Erased — 20 × 8 ft, 160 ft² |
| Polygon `6` | 4 corners, closed on the first | +1 room, +4 verts | POLY-ROOM — 384 ft², 4 corners |
| Shape `7` | select, then drag a corner | vertex [24,28] → [18,22] | AUDIT-ROOM — 828 ft² |
| Furniture `8` | click on clear floor | props 99 → 100 | Student Desk placed — snapped to grid |
| Stairs `9` | click to place a run | links 3 → 4 | Stair — 21 risers at 6.9 in, 19.3 ft of run |
| Layout `0` | click to stamp | props 99 → 120 | Standard Classroom placed — 21 props |
| Site `-` | click a region | selection (16 regions held) | North walk — 1,280 ft² |
| Overlay `=` | drag with no image loaded | none, correctly | Load an image first — the Overlay panel has the button |

Undo and redo round-trip exactly: five undos took the design from 43,759 to
40,958 serialized bytes and five redos put it back to 43,759, byte for byte.
The stair readout checks out arithmetically too — 21 risers at 6.9 in is
12.07 ft, which is the 12 ft floor-to-floor height.

---

## The redline

Ranked by consequence, not by effort.

### 01 — Nothing runs the tests before a deploy

The repository has three workflows: two Firebase deploys and one CI job scoped
to `Numina/**`. Nothing anywhere runs the School Generator's suite. A commit
that breaks all 1,622 assertions merges to `main` and deploys to production
without a red mark — the deploy action doesn't execute a line of JavaScript, it
copies files.

This is the highest-leverage gap in the project precisely *because* the suite
is so good. Twenty-one thousand lines of tests that no gate consults are a
safety net rolled up in the corner.

**Fix.** A workflow modelled on the existing `numina-ci.yml`, triggered on
`Projects/school-generator/**`, running `node --test 'test/*.test.mjs'`.
Roughly twenty lines and no new dependencies. The visual harness can join it in
the same job — the runner already has Chromium available.

### 02 — When boot fails, the app looks fine and does nothing

Two reproducible cases, both ending the same way. Disable WebGL and
`initRender` throws at `render.js:518`; `window.app` is never created. Open
`index.html` from disk and the ES modules are refused by CORS before any of
them run. In both cases the full chrome paints — toolbar, floor list, layer
switches — and the status line reads *"Floor — click / drag to lay floor
tiles."* Every control is inert. Nothing says why, or that anything is wrong.

```
$ chromium, WebGL context suppressed
CONSOLE   THREE.WebGLRenderer: Error creating WebGL context.
PAGEERROR Error: Error creating WebGL context.
hasApp    false
status    "Floor — click / drag to lay floor tiles"
visible   "School Generator  New Save Load Designs Generate Export
           Share Session FX Sky Sound Life Report Walk Through
           Floor 1 Wall 2 Door 3 Room 4 Erase 5 Polygon 6 …"
```

Who hits this: anyone whose GPU is on a driver blocklist, anyone with hardware
acceleration off, anyone behind a policy that disables WebGL — and anyone who
downloads the repo as a zip and double-clicks the file. That last one also
makes the WISHLIST's opening promise untrue: *"Open the file and it works … no
server required"* (WISHLIST, line 16) has not been true since browsers began
enforcing module CORS.

Related and unhandled: there is no `webglcontextlost` listener anywhere, so a
GPU reset — a laptop waking from sleep, a phone under memory pressure — leaves
a frozen canvas with the same total silence and no path back.

**Fix.** Wrap the boot in a `try/catch` and add a `window.onerror` that
replaces the chrome with one honest sentence naming the cause and the remedy.
Add a `webglcontextlost` handler that says the view was lost and offers a
reload. Then correct the WISHLIST line so the next builder isn't debugging a
promise the platform withdrew.

### 03 — Every hand-drawn room is called "Room 101"

The room-name field is seeded with the literal string `'Room 101'`
(`editor.js:93`, `index.html:1550`) and never advances. Draw three rooms with
the floor brush and you get three rooms all named Room 101 — reproduced twice,
on the sample school and on fresh ground:

```
after three floor rectangles
Room 101 | Room 102 | Room 103 | Stair Hall | Main Hall |
Office | Room 105 | Room 106 | Learning Commons |
Room 101 | Room 101
```

The generator gets this right — `Room ${(storey + 1) * 100 + room.seq}` at
`generate.js:1952` — so it only bites plans drawn by hand, which is to say the
ones a person sat down and made.

It costs more than tidiness. `bindRoom` (`timetable.js:577`) resolves an
imported timetable's room token by exact name using `list.find`, so a duplicate
binds to whichever room comes first and reports success. The room-*number*
branch four lines below refuses exactly this ambiguity
(`numbered.length === 1`); the name branch doesn't. Downstream, the printed
sheet labels them identically and the egress and occupancy tables list the same
name twice.

**Fix.** Seed the field from the next free number on the current storey rather
than from a constant — the parsing half already exists as `roomNumber` in
`timetable.js:567`. Worth guarding the exact-name branch of `bindRoom` the same
way its number branch already is, so an ambiguous name reports unbound instead
of guessing.

### 04 — The tool layer is the one layer with no tests

The codebase's central habit is "one pure module per question, one thin tool on
top of it, one `node --test` suite per module," and it holds almost everywhere.
The exception is everything the pointer touches.

```
no suite, and not imported by any suite
  editor.js         1,476      main.js         6,919
  polyedit.js         635      render.js       6,112
  propedit.js         478      walkthrough.js    752
  stairedit.js        406      walk-main.js    1,121
  siteedit.js         366      audio.js          901
  templateedit.js     251
  overlayedit.js      255      total  19,672 lines — 39% of the app
```

The blocker is structural rather than neglect: every one of those files opens
with `import * as THREE from 'three'`, so none of them can be loaded in Node at
all. The six `*edit.js` modules are 2,391 lines of genuine decision-making —
which segment did the click land on, does this prop snap to the wall or the
lattice, is this loop closed — interleaved with the THREE meshes that draw the
handles. Today the only way to answer "does the polygon tool close a loop
correctly" is a browser harness written from scratch.

**Fix.** Two independent routes, and they compose. Split each `*edit.js` into a
pure half that decides and a THREE half that draws, and the pure halves join
the existing suite unchanged. Separately, commit a browser smoke harness beside
`test/visual/` that drives all twelve tools and asserts the state delta — the
same shape as the visual runner, and optional in the same way, so a machine
without Chromium loses the tools pass and not the suite.

### 05 — 3.5 MB of JavaScript across 99 requests before the first frame

Measured on a cold load: 100 responses, 3,616 KB, of which 3,449 KB is
JavaScript. There is not one dynamic `import()` anywhere in the project —
`main.js` statically imports 61 modules and they pull the rest, so everything
the tool can do is downloaded, parsed and evaluated before the sample school
appears.

About 512 KB of that is behind a button nobody has pressed yet: the printable
sheet, glTF import and export, timetables, egress, the report, cost and rates,
utilisation, the collaboration stack, phasing, the hunt, the haunt, the crowd,
the headset. Each already has a distinct entry point.

**Fix.** Change the static import to an `await import()` at the button that
needs it. It is mechanical, costs no architecture, and needs no build step —
which is the whole point of the project's no-build stance. Worth pairing with
an explicit `Cache-Control` for `Projects/school-generator/js/**` in
`firebase.json`: fonts and Numina's index both get one, these 82 modules fall
through to the default and revalidate on every return visit.

---

## Smaller marks

- **Selecting a prop by clicking it is the only selection that says nothing.**
  Shift-click and marquee both report "*N props selected*"; the plain click
  returns at `propedit.js:281` having dropped the undo and updated nothing
  visible in the status line. Verified: clicking a desk produced no state
  change and no message.
- **`isAxisRun` is exported and called from nowhere** (`snapgrid.js:115`). Dead
  since the wall drag became a two-click gesture in Phase 25 — either wire it
  into the wall readout it was written for, or delete it.
- **The one invocation of the suite that works isn't written down.**
  `node --test test/` fails with `MODULE_NOT_FOUND` on Node 22;
  `node --test 'test/*.test.mjs'` is the form that runs. Worth a line in the
  WISHLIST, and it becomes moot the moment finding 01 lands.
- **There is no README for the project.** `WISHLIST.md` is 46 KB and carries
  the architecture, the conventions and the backlog admirably, but a newcomer
  has no short door in — and `server/`, the smaller half, has one.
- **`main.js` (6,919 lines) and `render.js` (6,112 lines) are the two files
  that resist the codebase's own rule.** Together they're a quarter of the app.
  Not urgent and not a bug, but they are where the "one module per question"
  discipline stops, and they're also the two files most likely to be edited by
  two people at once.

---

## What holds up

Worth saying plainly, because an audit that only lists faults misreports the
thing. The pure-module-plus-suite discipline is real and it works — 1,622
assertions across 75 files, every one green on the first run with no flakes and
no skips. There is not one `TODO`, `FIXME` or stray `console.log` in 50,320
lines. Autosave degrades in three deliberate tiers when `localStorage` fills,
each with its own sentence for the user. Undo round-trips byte-exactly. The
conventions section of the WISHLIST is the best kind of documentation — every
entry is a mistake someone made once, written down so nobody makes it twice.

The five findings above are all, in their way, the same observation: the parts
of this project that were built with a test suite beside them are in excellent
shape, and the parts that could not have one — the boot path, the tool layer,
the deploy gate — are where every problem is.

---

**Method.** Unit suite via `node --test 'test/*.test.mjs'` on Node 22.22.2.
Visual regression via `test/visual/run.mjs` against committed baselines. Tool
verification via a purpose-built Playwright harness driving real pointer events
at world coordinates projected through the live edit camera, reading
`window.app.state` before and after each gesture; browser runs used a software
rasterizer, so timings are pessimistic and state changes are not.

**Not covered.** The walkthrough, VR and audio paths were exercised only as far
as boot — they are not in the tool matrix above.

---

# Resolution

All five findings and all five smaller marks were addressed in the same pass
that produced this report. What changed, in the order the findings are ranked
above.

**01 — CI.** `.github/workflows/school-generator-ci.yml` runs on every pull
request touching `Projects/school-generator/**` and on merges to `main`. Two
jobs: the unit suite on bare Node, and the two browser passes (visual
baselines, tool smoke) on a pinned Playwright. Failing captures upload as an
artifact.

**02 — Boot failure.** `js/bootcheck.js` holds the four ways the tool can fail
to start and the words for each; `index.html` carries an inline classic-script
guard that paints them over the chrome, and `test/bootcheck.test.mjs` fails if
the guard's copy of the two sentences it must hard-code ever drifts from the
module — the same drift alarm `theme.test.mjs` already holds over the `:root`
block. `main.js` probes WebGL before `initRender` so the message is specific,
and `render.js` now waits out a lost context and says so if it never comes
back. All five paths were verified in a browser: no WebGL, `file://`, a module
that throws while evaluating, a module that 404s, and — the one that must stay
quiet — an error hours into a healthy session.

**03 — Room naming.** `nextRoomName` in `shapes.js` reads the whole building
and answers with a number nobody has used, per storey, filling gaps. The panel
follows it as rooms appear and gets out of the way the moment somebody types a
name of their own. Separately, `bindRoom` now refuses an ambiguous *name* the
way it always refused an ambiguous number: two rooms called the same thing
bind to neither, rather than to whichever came first.

**04 — The tool layer.** `test/tools/run.mjs` drives all twelve tools with real
pointer events on the real page and asserts the state delta, on the same
optional-tooling terms as `test/visual/`. It carries a regression check for
each of the two behavioural fixes above, and an `assertClear` guard so a
gesture that would land on a floating panel fails loudly instead of passing
quietly. This does not make the tool layer *unit*-testable — that still wants
each `*edit.js` split into a pure half and a THREE half — but it does mean a
tool that stops working now fails a check.

**05 — Load weight.** Partly. `js/lazy.js` is the mechanism and `generate.js`
— at 108 KB the largest deferrable module — now arrives when somebody presses
Go: measured 3,616 KB → 3,531 KB and one request fewer. The rest of the 512 KB
turned out to be pinned eager by the import graph rather than by the lack of a
mechanism: `blueprint.js` by the minimap's per-frame calls, eight more modules
by `save-load.js` normalizing their records, `report.js` and its tail by
`main.js`'s synchronous panel renderers, and the collab stack by ~50 call sites
including one at module top level. Each is a real change in untested UI code,
so the map of what pins what is now in the WISHLIST backlog for a pass that can
sit behind the new tool harness. The caching half is blocked on the same thing
it was before — `libs/` is 1.3 MB and carries no version in its path, so it
cannot be cached hard without renaming the directory.

**The smaller marks.** Selecting a prop by clicking it now names the piece
instead of saying nothing. `isAxisRun` is wired into `runLabel`, which no
longer rounds a near-miss into a right angle — a run a hair off square prints
`90.0°` rather than the `90°` that means something different. The suite's
working invocation is documented in the new `README.md` and in the WISHLIST's
conventions. `main.js` and `render.js` were left alone: the finding said not
urgent and not a bug, and splitting them without the tool harness underneath
would have been the least safe change in the set.

**Verification.** 1,655 unit assertions pass (up from 1,622 — the new suites
cover `bootcheck`, `lazy`, room numbering and binding ambiguity), all 8 visual
baselines are unchanged at zero pixels moved, and the tool harness's seventeen
checks are green across all twelve tools. `walk-template.html` was regenerated, which its own
staleness check in the suite duly demanded after `render.js` changed.
