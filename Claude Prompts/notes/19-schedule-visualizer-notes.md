# Schedule Visualizer and Browser Generator — session notes

## What is in the committed schedule data

Unchanged from round 1's finding, and now decided. Devon's call, made this
session: **leave it as is.** No student names, so no FERPA issue; the
school-security question (34 real staff surnames, rooms, and, combined with
the floor plan, every teacher's planning-period block on both A and B days,
at a public URL with no login) was surfaced plainly and the answer was to
change nothing. `PUBLISHED_DATA` in `Tools/schedule-browser.html` is
untouched.

## The versioned-filename decision

Already made in round 1, nothing to revisit this session. `TOOL_VERSION =
'v61'` still shows in the header and the published footnote. Both real files
keep their plain, permanent names; both old dated paths still redirect.

## Coverage: what I actually read

Building on round 1's map, not restarting it. Round 1 read 13% of the file
(the data model, import/export, the whole Schedule Browser block) and never
opened the pathfinding/congestion/playback half at all. This round read that
whole half, current line numbers (they shifted slightly from round 1's
because of this session's own edits; re-located everything by function name
first):

**Read properly, line by line, the full simulation module (11534 to 15962,
about 4,430 lines):**

- The pathfinding engine (11534 onward): `buildLocalFloorGraph`,
  `buildFloorEdges`, `buildMultiFloorGraph`, the door-restricted adjacency
  logic for classrooms with explicit doors, the teleport-aware admissible A*
  heuristic (`buildHeuristic`, a small Bellman-Ford relaxation over the
  staircase-pair graph so a zero-cost teleport can't make A* inadmissible),
  the `astar` search itself with node reopening, and the `MinHeap`.
- Segment resolution (12021 onward): `resolveRoomPath`'s three outcomes
  (no-travel, a typed error, a routed path with metadata), `findGroupDayPath`
  chaining mods into segments, `computeCongestionMap`.
- Path visualization and congestion (12234 to 13522): `buildVizRenderData`
  (lane assignment, teleport/floor-transition splitting of sub-paths),
  `buildCongestionData` (student-weighted loads, hotspot sorting),
  `drawVizPaths` (adaptive lane width/spacing so many concurrent groups don't
  overflow a corridor, congestion-colored segments, contrast-halo endpoint
  dots).
- The top-3 hotspot pulse overlay (13523 to 14150): a separate transparent
  canvas animating expanding rings over the busiest cells, gated on a
  group-equivalent threshold so it doesn't fire for trivial congestion.
- The playback engine and travel-time estimator (14730 to 15962), the
  biggest piece and the one with no prior read at all:
  `PlaybackController` (open/close/play/pause, step navigation, real-time
  vs. fixed-cycle timing), `buildCollisionSimulation` (a real per-tile,
  quadrant-based hallway traffic simulation: each cell splits into 4
  quadrants, a group reserves the quadrants matching its heading, opposing
  traffic occupies disjoint quadrants and never blocks, same-direction
  followers need 50% leader clearance, crossing traffic needs 75%, and
  reservations are just-in-time so a group can pass ahead of one that hasn't
  arrived yet), `drawPlaybackFrame` (comet and trail rendering, staircase
  portal pulse/dwell-arc effects, per-frame live-occupant tracking for the
  hover tooltip), `updateTravelTimePanel`, and `computeTravelTimes` (base
  walk time plus a congestion-delay multiplier from student-weighted
  concurrent tile occupancy).

That is the answer to round 1's open question, "is the movement real, and
does the visualizer make it visible?": yes. This is not a toy heatmap. The
collision simulation alone is a genuine traffic model with directional
right-of-way rules, and it drives both the animated playback and the
travel-time panel's numbers.

**Skimmed, not read as prose, inside that same line range (~700 lines):**
the control-panel wiring between the algorithmic pieces (13650 to 14360, and
14420 to 14730: populating dropdowns, binding buttons, syncing DOM state to
`AppState.viz`). This is UI plumbing consistent with patterns already
understood elsewhere in the file, not novel logic.

**Also skimmed:** the Schedule Completeness Bar (14364 to 14417, small,
self-contained, reads already-computed render data).

**Still never opened (a real gap, distinct from this round's task):** the
What-If Schedule Lab, roughly 890 lines (currently 16720 to 17609). It reuses
some of the same congestion/weighting helpers this round just read
(`groupWeight`, the student-weighting model) but was not part of this
round's task and is not covered by any test. Also still unopened: onboarding
and help modals, the collapsible sidebar panels, full project export/import.

## What changed

**`Tools/schedule-visualizer.html`**, 862,547 to 863,737 bytes (+1,190):

- Accessibility: the Schedule Browser's mode switcher (`.mode[role=tablist]`
  with three buttons, `#br-mTeacher`/`#br-mGroup`/`#br-mMap`) now carries
  `role="tab"` and `aria-selected` on each button. Fixed in both markup
  copies that exist in this file: the live embedded app (`#app-browser`
  around line 17623) and the publish template (`brBuildPublishedMarkup`
  around line 18640). `brSetMode()` now sets `aria-selected` alongside the
  `on` class it already toggled. `brSetMode` is in `brPublishFnList()`, so
  every newly published file gets this for free; only the already-committed
  `schedule-browser.html` needed a hand patch, since it isn't regenerated.
- PDF export: `renderExportCanvas()` now also returns the raw canvas element
  (`canvas: off`), not only its PNG data URL. `exportVizAsPDF()` embeds a
  JPEG recompression of that same canvas
  (`PDF_EXPORT_JPEG_QUALITY = 0.82`) instead of the uncompressed PNG.
  `exportVizAsPNG()` is untouched and still uses the lossless PNG. Measured
  on the same 11-room, 4-group fixture render used to reproduce round 1's
  number: 21,363,645 bytes before, about 190,000 bytes after (varies a
  little run to run with JPEG encoding of anti-aliased edges, always well
  under 200 KB), roughly 110 times smaller. Safe because the export canvas
  is painted with an opaque background (`#eef2f7`, in `drawVizBlueprint`)
  before anything else draws, so there is no alpha channel a JPEG could
  lose.

**`Tools/schedule-browser.html`**, 160,717 to 161,074 bytes (+357):
hand-applied the same mode-switcher accessibility markup and `brSetMode`
patch. The PDF fix does not apply here: this file has no Visualize tab and
no `exportVizAsPDF` at all, only the generator does. `PUBLISHED_DATA` is
untouched.

**`Tools/schedule/test/smoke.mjs`**, 290 to 412 lines (+122): every fix
above got a regression test, and the pathfinding/congestion/playback module
got its first test coverage ever.

- 4 assertions: all three mode buttons carry `role="tab"`; `aria-selected`
  is true on the active tab, moves when the mode changes, and clears on the
  tab that lost it.
- 4 assertions driving the real `exportVizAsPDF()` button (not jsPDF in
  isolation) with real render data: produces a blob, the blob is
  `application/pdf`, starts with a `%PDF` header, and stays under a 2 MB
  ceiling (comfortably above what it actually produces, comfortably below
  the old 21.4 MB).
- 17 assertions covering the simulation half for the first time: A*
  routing across the fixture's staircase pair (group 7-1's own A-day route,
  106 to 201, crosses floors), `resolveRoomPath`'s three documented outcomes
  (no-travel, unknown-room error with the exact spec'd message, a routed
  path), `buildVizRenderData`/`buildCongestionData` producing real
  concurrency (6-1 and 6-2 share hallway cells) and a populated hotspot
  table, `computeTravelTimes` annotating a routed segment with a positive
  `travelSec`, and a full `PlaybackController` lifecycle (open, step,
  close) that exercises `buildCollisionSimulation` and `drawPlaybackFrame`
  with zero console/page errors.

## What I verified

Actual commands, actual output.

**Generate, diff, generate.** Baseline from the pre-change generator, then
the same fixture after every change:

```
node Tools/schedule/test/publish.mjs baseline-pre.html
  fixture applied: 11 rooms, 4 groups
  wrote baseline-pre.html, 146718 bytes

node Tools/schedule/test/publish.mjs baseline-post.html
  fixture applied: 11 rooms, 4 groups
  wrote baseline-post.html, 147076 bytes
```

The diff is exactly the mode-switcher markup (role/aria-selected on all
three buttons), the three new `aria-selected` lines inside `brSetMode`, and
the footnote's publish date (today vs. the earlier run). Nothing else moved.
The PDF export change does not appear in this diff because `exportVizAsPDF`
is a generator-only function, never part of `brPublishFnList()` or the
published output.

**`node Tools/schedule/test/smoke.mjs` -> 67 passed, 0 failed.** Was 42 at
the start of this session.

**Locked decision #34, broke things on purpose and watched them fail, three
times:**

| Break | Result |
| --- | --- |
| Removed the `aria-selected` sync lines from `brSetMode` | 2 of the 4 new tab-state assertions failed correctly |
| Reverted `exportVizAsPDF` to embed the uncompressed PNG again | the size-ceiling assertion failed correctly, reporting the old 21,363,645 bytes |
| Emptied `AppState.blueprint.crossFloorPairs` before building the graph | first attempt: the test **crashed the whole suite** with an uncaught `TypeError`, because it read `.staircasePairsUsed` off an error-shaped result without checking. Hardened the test to read defensively; re-broke the same thing and got 3 clean `FAIL` lines instead of a crash. |

That third row is worth flagging on its own: a test that crashes instead of
failing is worse than no test, because a real regression could produce the
same crash and get read as "the harness broke," not "the feature broke."
Fixed before this round ended.

**A PDF actually comes out, exact numbers reproduced.** Same 11-room, 4-group
fixture, same "all groups" render mode round 1 used to get 21.4 MB:

```
before (PNG embed):  21363645 bytes, %PDF-1.3
after  (JPEG embed):   190954 bytes, %PDF-1.3   (varies ~180-192 KB run to run)
```

**Greps, both files, zero each:**

```
                                     cdnjs  googleapis  gstatic
Tools/schedule-visualizer.html         0        0          0
Tools/schedule-browser.html            0        0          0
```

**`cd Tools/board-check && npm run social:check`**: hit the same unrelated
`index.html` parsing failure the prompt warned about ("only parsed 17
notices out of index.html"). Confirmed independently instead, per the
prompt's own instruction: grepped both files for `gvb:social:start`, both
still carry the block.

**`cd Tools/board-check && npm run check`**: `check-integrity.mjs` fails on
`newindex.html` (offsite Google Fonts references), an unrelated file outside
this boundary, exactly as the prompt anticipated. 345 units checked, 1
broken (not 331, other threads have added files since the prompt was
written; still only the one broken unit, and it isn't mine).
`check-collisions.mjs` doesn't run automatically after an `&&` failure, so
ran it directly: 0 collisions across nine widths, tightest vertical gap
9.2px, matching the prompt's own expectation exactly.

**`cd Tools/board-check && npm run tools`**: 18 checks, 0 failed. Both
`Tools/schedule-browser.html` and `Tools/schedule-visualizer.html` report a
real title, no offsite requests refused, no page or console errors.

## Shared-file requests

None this round. Nothing here touches `index.html`, and no new
`gvb-save.js` hook is needed (task six, adoption, wasn't attempted this
session, see below).

## Deliberately not done

**The 862 KB restructure (task five).** Task four (reading the simulation
half) is done this session, which was the explicit precondition. The
algorithmic core (pathfinding, congestion, collision simulation, playback)
is now genuinely understood, not skimmed. Still didn't attempt the actual
split: this is a single file with no build step, so a bad split fails
silently until a person opens it, and round 1 estimated two sessions for the
restructure itself once the read was done. That estimate still looks right.
Left for its own session, with the module map above as its starting brief.

**`gvb-save.js` adoption (task six).** Unchanged reasoning from round 1: six
or seven independent storage keys, `mountSaveBar` assumes one slot, the
blueprint payload is the largest state on the site and already does its own
quota accounting. Still a session of its own, and it still wants the
storage-quota question answered directly rather than inherited.

**The What-If Schedule Lab, ~890 lines, still completely unread.** Not part
of this round's task, but it shares congestion/weighting helpers with the
module just read, so it belongs on the list before anyone restructures the
file: a split has to know what depends on what.

**Everything round 1 left alone and this round didn't touch:** `.rcell`
versus `.geo-room` (two floor-plan renderers, still not read deeply enough
to be sure they can merge), unvendored italic font faces (a design decision,
not a dependency gap), the Building Map's behavior across a print page
break (still not tested), and the scroll-affordance shadow on the mobile
map (still cosmetic, still quick, still not done).

## Next session

Value per effort, highest first.

1. **Restructure the file** (task five). Now unblocked. Two sessions still
   looks like the right estimate given the file's size and the fact that
   only two test suites exist to catch a bad split.
2. **Read the What-If Schedule Lab** (~890 lines) before or during the
   restructure, since it touches the same helpers the newly-read module
   uses.
3. **`gvb-save.js` adoption** (task six). Still its own session.
4. **Cosmetic, quick:** the mobile map's scroll-affordance shadow, and
   checking the Building Map across a print page break.
5. **`.rcell` vs. `.geo-room`:** still an open question, needs a deeper read
   of both renderers before merging either way.
