# Schedule Visualizer and Browser Generator — session notes

Round 3. The restructure round 2 unblocked is done: 863,737 bytes in one file is now a
124,566-byte shell plus one stylesheet and seven scripts. Published output came out
byte-identical to the pre-change baseline (before the two cosmetic additions). Both cosmetic
items from task four are done, one of them twice, because the first version provably did not
work and the measurement said so.

The restructure itself was drafted in a separate sandbox session and handed off as a bundle.
This session's job was to check that work against the real repo and real tooling before
landing it, not to redo it. One real bug turned up in that check, fixed below, and the three
board-check suites the sandbox could not run all ran clean once it was fixed. With the split
verified and landed, this session also went ahead and closed the `gvb:social` publish-drift
gap the drafting session had found and deliberately left (see "What changed" below) — Devon's
call, made explicitly this round, was to go ahead rather than defer it again.

## What is in the committed schedule data

Resolved, and left alone. `PUBLISHED_DATA` in `Tools/schedule-browser.html` is untouched: 34
teacher surnames, room assignments, and floor geometry, no student names. Devon's call two
rounds ago was to change nothing, and nothing here touched it. The hand patch this round
(the mobile scroll affordance and print CSS, see below) is two CSS rules and one markup
string, pulled programmatically out of `app/browser-template.js`, not retyped.

The file still carries its `gvb:social` block, and `smoke.mjs` still asserts that.

## The versioned-filename decision

Nothing to revisit. `TOOL_VERSION = 'v61'` is unchanged and now lives in `app/data-model.js`
line 92, moved verbatim with the rest of that range. It still renders in the header and in
the published footnote. Both real files keep their plain names, both old dated paths still
redirect.

## Coverage: what I actually read

Round 2 closed the simulation half. This round's drafting pass read the file a different way:
not what the code does, but what runs at load and in what order, since that is the whole risk
surface of a split with no build step.

Parsed with acorn and counted the top level: 353 function declarations, 1 class, 73 variable
declarations, 53 expression statements, 4 if statements. 130 non-declaration top-level
statements are the entire risk surface, since everything else is hoisted inside its own file
and reachable across files because classic scripts share one global lexical scope. About 40
`document.getElementById(...).addEventListener(...)` calls bind at parse time (first at old
line 5589, last at 9780); three bare init calls sit mid-file
(`initBellScheduleEditor`/`initSubjectsEditor`/`populateDeptDropdown`); `AppState.viz` and
`AppState.whatif` are plain assignments onto an object built earlier; and
`document.addEventListener('DOMContentLoaded', init)` plus six `window.fn = fn` exports round
out the list. This is why the seven script tags sit in the body, in source order, with no
`defer`.

Read the What-If Lab, 891 lines, 35 functions, previously unread. Sandbox model:
`AppState.whatif.overrides` keyed by group, never touching the real group objects.
`wiComputeMetrics` feeds `wiComputeDiff` feeds six renderers, plus
`serializeWhatIfForProject`/`applyWhatIfFromProject` bridging to the project file. It reuses
the congestion multiplier model from `computeTravelTimes` rather than reimplementing it, so
the shared helpers round 2 flagged are genuinely shared, not duplicated. It lives entirely in
`app/app-shell.js` and needed no changes.

Read both floor-plan SVG renderers, task five. **`.rcell` and `.geo-room` are not duplication
and cannot merge.** `brBuildFloorSVG` draws `BR_A_TPL`/`BR_C_TPL`, hardcoded absolute-pixel
room rectangles for East Middle's A and C wings, fenced behind a `typeof BR_WINGS` guard.
`brGeoFloorSVG` draws `BR_GEOM` as grid cells times a `px` scale, entirely data-driven, and is
what ships. Different coordinate systems, different data sources, different lifetimes. The
only available move is deleting the legacy renderer, which costs the live app its map for
anyone who has not drawn a blueprint yet, since that is exactly the fallback branch. Not worth
it. Task five is closed, not deferred.

### Module boundaries, for whoever picks up the next piece

Every boundary is a contiguous source range that lands on a blank line before a `/* ===`
divider. Load order is source order and the `<script src>` list encodes it.

| File | Was lines | Bytes | Holds |
| --- | --- | --- | --- |
| `app/data-model.js` | 4825-6160 | 51,016 | AppState, storage keys, settings, room registry, blueprint persistence, JSON import/export, staircase pairing, undo/redo |
| `app/layout-editor.js` | 6161-9239 | 115,806 | canvas setup and rendering, tool placement, all five right-panel editors, doorways, event binding, drag overlays, zoom, palette, context menu, tile stats |
| `app/schedule-ui.js` | 9240-11532 | 95,358 | settings panel bindings, bell and subjects editors, tabs, toasts, the whole schedules module, CSV bulk import, bulk editor |
| `app/pathfinding.js` | 11533-12232 | 29,646 | A*, multi-floor graph, congestion map |
| `app/viz-playback.js` | 12233-15962 | 163,843 | path visualization, congestion colouring, hotspot overlay, playback engine, travel-time estimator, PDF and PNG export |
| `app/app-shell.js` | 15963-17609 | 70,637 | onboarding, full project export/import, sidebar, snapshots, presentation mode, room search, What-If Lab, `init()` |
| `app/browser-template.js` | 17670-18789 | 67,499 (before this round's cosmetic additions, see below) | `BR_CSS`, every `br*` function, the publish codegen |

Two boundaries differ from the plan the prompt proposed. `data-model` ends at 6160 rather than
5964, so staircase pairing and undo/redo stay with the blueprint model instead of landing in
the canvas editor. `schedule-ui` starts at 9240 rather than 9266, because 9266 cuts inside the
settings-panel DOM bindings. The plan also had one file spanning two disjoint ranges
(9266-11533 plus 15963-17610); seven contiguous files instead of six removes that whole class
of question.

`viz-playback.js` at 163,843 bytes is now the largest file in the tool, and the next split if
anyone wants one: path rendering and the playback engine separate cleanly at old line 14729.

## What changed

### The restructure

- `Tools/schedule-visualizer.html`, 863,737 to 124,566 bytes. Both `<style>` blocks and both
  inline `<script>` blocks are gone, replaced by one `<link>` and seven `<script src>` tags,
  in the body, at the exact positions the two inline blocks used to occupy: no `defer`, no
  `async`, no `type=`, since about 40 listeners bind at parse time. Markup, the `gvb:social`
  block, and the rest of the head are otherwise untouched.
- `Tools/schedule/app/visualizer.css`, new, 156,038 bytes. The head `<style>` followed by the
  What-If panel `<style>`, in that order, so the cascade sees what it saw before.
- `Tools/schedule/app/*.js`, seven new files, ranges in the table above, each carrying a
  header comment naming its old line range and stating that load order is source order.
- `Tools/schedule/app/README.md`, new. Why the split has this shape, what was rejected and
  why (ES modules, a bundler, `<script defer>`, a `lib/` folder name, moving `BR_CSS` out of
  `browser-template.js`), what this shape is bad at, and the editing rules. Read that file
  before moving code between the new ones; it is not duplicated in the summary here.

**Yes, the generator's template changed, and yes the output was regenerated.** The `br*`
functions and `BR_CSS` moved into `app/browser-template.js`. The cut was byte-preserving with
no reindentation: `brPublishFnList().map(f => f.toString())` and four more `.toString()` calls
put function source text straight into every published file, so a reformat would have changed
published bytes for a cosmetic reason and destroyed the only regression signal a change this
size has. The cut itself was mechanical: a small Python script walks the original file by line
range and copies each range verbatim into its new home. **I re-ran that script against the
live, unmodified `Tools/schedule-visualizer.html` before touching anything, and it reproduced
every one of the seven library files and the shell byte-for-byte** against what the drafting
session delivered. Only `browser-template.js` differed, by exactly the cosmetic CSS/markup
this round added afterward (below) — confirming the mechanical split really is what it claims
to be, independent of trusting the drafting session's own account of it.

Folder name is `app/`, not `lib/`, because `libs/` one level up holds vendored jsPDF and two
paths differing by one letter, in a repo where paths get typed by hand, is a trap.

### A real bug, found while landing this: an HTML comment that looked like a script tag

`check-integrity.mjs`'s inline-script regex (`Tools/board-check/check-integrity.mjs`) matches
any `<script...>` not followed by `src=` before the next `>`, then treats everything up to the
next `</script>` as that tag's body and tries to parse it as JS. The shell's own new comment
explaining the script-tag block read:

```html
<!-- The generator, in load order. Plain <script src>, in the body, at the ...
```

`<script src>` has no `=`, so the regex's negative lookahead for `src=` failed to find one,
matched the comment text as an unclosed script tag, and swallowed everything up to the real
`</script>` many lines later — six `<script src="...">` tags, comments, and all — as one
"inline script," which obviously does not parse. `npm run check` reported it as
`FAIL Tools\schedule-visualizer.html`, one broken unit.

Not a bug in the split itself: the browser never cares what an HTML comment says. But it is a
real false positive in a required site-wide check, caused by prose that happened to describe
its own mechanism using the literal syntax it was describing. Fixed by rewording the comment
("Plain script tags with a src=" instead of "Plain `<script src>`") so it no longer contains an
unescaped `<script` with no `src=` before the closing `>`. Reran `npm run check`: 0 broken.
Reran `structure.mjs` and `smoke.mjs` after the wording change to confirm a comment edit
changed nothing else: both still fully green.

Worth flagging on its own, in the spirit of locked decision #34: this is the second round
running that a guard-rail check has been fooled by something adjacent to what it actually
checks (round 2 found the crash-instead-of-fail gap in `smoke.mjs`'s own suite; the drafting
session separately found and fixed a version of this exact problem in its own new offsite-host
check, documented below). Static regex checks over source text are cheap and worth having, but
each one has a blind spot shaped like "text that looks like the thing being checked, in a
context that isn't."

### New guard: `Tools/schedule/test/structure.mjs`, 31 assertions

`smoke.mjs` drives one path through the tool and cannot see the failure modes a split
introduces; it would report them as roughly forty broken assertions with no hint at the cause.
`structure.mjs` has no dependencies (`node:vm` is the parser) and checks: the seven files
exist, the `<script src>` list matches source order, no tag carries `defer`/`async`/`type=`,
no `<style>` is left in the shell, `visualizer.css` is linked once and after `fonts.css`, each
file parses, the six generator modules parse as one concatenated unit, no top-level name is
declared in two files (491 names), and no `app/` file references an offsite host.

The concatenation check is the important one: two files each declaring `const AppState` parse
fine alone and throw the moment a browser loads both, which is exactly what happens across
sibling classic scripts. It caught a real `BR_CSS` template-literal syntax error mid-round,
before `publish.mjs` got to it.

### The `gvb:social` publish-drift gap, closed this round

Flagged by the drafting session as deliberately left for a later round (see the last handoff's
"Deliberately not done"); Devon's call this round, made explicitly, was to go ahead and close
it now instead of deferring again.

The gap: `brBuildPublishedHTML()` builds its `<head>` from scratch and never emitted a
`gvb:social` block at all. `Tools/schedule-browser.html` carries that block hand-added, with
the correct `og:url` and an EMS-specific description. A full regeneration of that file from the
generator would silently wipe it — live drift risk, not hypothetical, and the reason every
cosmetic change to `BR_CSS` across rounds 2 and 3 has been a hand patch instead of a real
regeneration.

`brBuildPublishedHTML()` now takes an optional `socialBlock` argument
(`app/browser-template.js`), emitted verbatim between `</title>` and `<style>` — the same
position the block already occupies in every committed page on the site — when supplied, and
omitted entirely otherwise. `brPublish()`, the live download button, still calls it with no
argument: a teacher's own copy has no canonical `greyversusblue.com` URL to claim and should
not get one baked in. Nothing about the no-argument path changed, so every existing assertion
and the published-output diff stayed exactly where they were before this fix.

That argument is the whole mechanism; something still has to supply the block. Real
regeneration of the repo's own copy needs the real blueprint and real schedule data, which live
in whoever's browser last built them, not in this repo, so this round could not and did not
actually regenerate `Tools/schedule-browser.html` end to end. What it added instead is
`Tools/schedule/test/splice-social-block.mjs`, new: given a fresh file the live Publish button
already produced (no block, as above) and the currently committed `schedule-browser.html`, it
extracts that file's exact `gvb:social:start`...`gvb:social:end` span and inserts it into the
fresh file at the same `</title>`/`<style>` seam. That turns "hand-patch the diff and hope
nothing else moved" into "run this script," for whenever someone with the real data next
regenerates the committed copy for real.

Three new `smoke.mjs` assertions prove the mechanism without needing real data: calling
`brBuildPublishedHTML()` with no argument still emits no markers; calling it with a sample
block emits that block verbatim in the right position; and `spliceSocialBlock()` run against
the actual committed file's real block, then run a second time against its own output, throws
instead of duplicating the block. Broke each of the three on purpose (locked decision #34):
reverting the `socialBlock` insertion in `browser-template.js` failed the second and third
assertions correctly; removing the duplicate-block guard in `splice-social-block.mjs` failed
the fourth correctly. Restored both, reran, clean.

`Tools/schedule-browser.html` itself did not need to change for this fix — its own block was
never touched or at risk this round, only the mechanism that would otherwise wipe it on a
future real regeneration.

### Task four: mobile scroll affordance

Done, on the second attempt, and the first attempt is worth keeping written down because it
looked correct and was not.

The standard pure-CSS answer is four background layers on the scroller (two cover patches
attached `local`, two shadows attached `scroll`), so each shadow uncovers only when there is
more map that way. Built it, measured it on a 375px phone, and the shadows did not appear.
Painting all four layers in solid opaque colours and screenshotting located them exactly right
— and underneath the map's own opaque SVG background, which covers both gutters the entire
time the box is scrolled. Anything that has to sit on top of scrolled content cannot be the
scroller's own background, and no amount of tuning the gradients fixes that.

Shipped instead: a `.mapshell` wrapper around `.mapscroll` with a 26px `::after` gradient on
the trailing edge, `pointer-events:none`, shown only under 900px (exactly where `.geoplan`
gets its `min-width` and the box starts scrolling). What it gives up: it stays lit at the far
right end, where the four-layer version would have covered it. Not worth JS or a scroll-driven
animation for a hint.

**I re-verified this live in a browser against the actual repo files, not just against the
drafting session's account of it.** At 375px, `.mapscroll` scrolls 568px over a 323px box and
the overlay computes `display:block`; at 1280px the same box is 968px over 968px (nothing to
scroll) and the overlay computes `display:none`. Both numbers match what the notes below
originally claimed, independently reproduced.

### Task four: Building Map across a page break

A real bug, not just cosmetic. `.mapscroll` is `overflow-x:auto` and print clips overflow
rather than paginating sideways, so on any window narrow enough to scroll, whatever was off to
the right was simply absent from the paper, and the floor tabs printed as dead grey buttons.

Print now drops the scroller, takes `min-width` off `.geoplan`/`.floorplan` and lets the SVG
scale to the sheet, hides the floor tabs/day chips/overlay, clears overflow on `.tscroll` and
`min-width` on `.gtable`, and sets `break-inside:avoid` on the map, legend, and mini-map
blocks. Rendered the PDF: whole floor, heading and legend on the same page. If a future floor
plan is portrait and taller than a sheet, `break-inside:avoid` on `.mapscroll` is the rule to
loosen.

### `Tools/schedule-browser.html`, hand-patched

Not regenerated automatically, same as round 2's aria fix. The same two CSS blocks and one
markup change, pulled programmatically out of `app/browser-template.js` rather than retyped,
so the two copies cannot drift. 161,074 to 164,349 bytes. Data untouched, `gvb:social` block
intact — checked directly, both markers present in both files.

### `Tools/schedule/test/smoke.mjs`, one hardening fix

A missing font file used to kill the whole run instead of failing an assertion:
`document.fonts.load()` rejects with `NetworkError` on a 404, `Promise.all` rejects, and
`page.evaluate` throws uncaught. Same shape as round 2's `crossFloorPairs` finding, found the
same way, by running the suite somewhere missing something. Each load now settles with
`.catch(() => null)` and the FontFaceSet check reports normally. Broken on purpose by removing
a font file: 3 named failures instead of a crash. Restored: 67 passed.

## What I verified

This session's job was landing, not drafting, so everything below was re-run against the real
repo and real `Tools/board-check` rather than trusted from a handoff.

**Before touching anything:** generated a baseline from the unmodified, still-863,737-byte
generator (`node Tools/schedule/test/publish.mjs`, 147,076 bytes) and ran `smoke.mjs` against
it: 67 passed, 0 failed. Confirms the starting point really was clean before any of this
landed.

**Reproduced the mechanical split independently.** Ran the drafting session's split script
against a fresh copy of the same unmodified file. Every output byte-for-byte matched what had
been handed off — shell, `visualizer.css`, and all six generator modules — except
`browser-template.js`, which differed by exactly this round's two cosmetic CSS blocks and one
markup change, nothing else. That is the strongest evidence available that the split is what
it claims to be.

```
node Tools/schedule/test/structure.mjs   -> 31 passed, 0 failed
node Tools/schedule/test/smoke.mjs       -> 67 passed, 0 failed (before the gvb:social fix)
node Tools/schedule/test/publish.mjs, diff vs. baseline -> four insert hunks, no deletions,
    147,076 -> 150,351 (chars)/147,119 -> 150,394 (bytes); the two CSS blocks in BR_CSS and
    the .mapshell markup wrapper, nothing else moved
```

After adding the `socialBlock` argument and `splice-social-block.mjs` (below): `smoke.mjs` ->
**73 passed, 0 failed** (3 assertions for the argument itself, 3 for the splice script), and
`structure.mjs` stayed at 31 passed, since neither change touched the generator's module
boundaries.

**The three board-check suites, run for real this time** (the drafting session's sandbox did
not have `Tools/board-check` available):

- `npm run social:check` — 18 notices, 12 already current, 1 with no block, 5 out of date.
  The five out-of-date pages are `Projects/daredevil`, `torchbearer.html`,
  `Projects/fourth-quarter`, `Projects/Ren-Faire-Claude`, `Projects/orbital`, and
  `newindex.html` — none of them this tool's files, and all consistent with other threads'
  work in progress elsewhere in this same repo checkout. Neither `Tools/schedule-visualizer.html`
  nor `Tools/schedule-browser.html` appears in the drift list.
- `npm run check` — **found the false-positive bug above on the first run** (1 broken unit,
  `Tools/schedule-visualizer.html`). After the comment reword: 360 units checked, 0 broken
  (the prompt's expected 335 has drifted upward as other threads have added files this round,
  same as round 2 noted for its own count). `check-collisions.mjs`: 0 collisions across nine
  widths, tightest vertical gap 9.1px.
- `npm run tools` — 18 checks, 0 failed. Both `Tools/schedule-browser.html` and
  `Tools/schedule-visualizer.html` report a real title, no offsite requests refused, no page
  or console errors.

**Opened the actual generator in a real browser and used it**, served over a local static HTTP
server (not `file://`):

- Applied the Northwind fixture via `applyFullProject` (11 rooms, 4 groups): zero console
  errors, all five tabs populate.
- Visualize tab, "All Groups": empty-state hidden, canvas renders real paths — exercises
  `pathfinding.js` and `viz-playback.js` together across the file boundary.
- What-If tab: room-override dropdowns populate per group/day, "Apply Scenario" and "Reset"
  wired up, zero console errors — exercises `app-shell.js` calling into helpers defined in
  `viz-playback.js` two files earlier, the one cross-file dependency the architecture notes
  flag as its least obvious.
- Drew a new classroom tile directly on a live blueprint via `setActiveTool`/`applyTool`
  (`layout-editor.js`), confirmed the tile count changed in `data-model.js`'s own
  `getTileCounts()`. Then placed a staircase through `runAction`, undid it, redid it, and
  watched the count go 2 -> 3 -> 2 -> 3 exactly — undo/redo history (`data-model.js`) and
  canvas placement (`layout-editor.js`) interoperate correctly across the split.
- Called `brBuildPublishedHTML()` live and opened the actual output it produced (150,351
  bytes) in a browser: correct title, mode tabs work, Building Map renders. At 375px the
  `.mapshell` overlay is `display:block` with the box scrolling 568 over 323; at 1280px it is
  `display:none` with nothing to scroll (968 over 968) — both numbers matching the affordance
  claims above, reproduced independently rather than taken on trust.
- Zero console errors or warnings across the entire session.

**Locked decision #34, every new guard broken on purpose first** (the drafting session's own
account, not independently re-broken this round, since the guards themselves were unchanged by
the one fix here):

| Break | Result |
| --- | --- |
| `const AppState = {};` at the top of `app/pathfinding.js` | 2 failed: concatenation parse, duplicate declaration |
| swap the `data-model` and `layout-editor` script tags | 1 failed: load order |
| add `defer` to one script tag | 1 failed: no defer/async/type |
| `const CDN = "https://cdn.jsdelivr.net/..."` in `app/viz-playback.js` | 1 failed: offsite |
| `@import url("https://fonts.googleapis.com/...")` in `visualizer.css` | 1 failed: offsite |
| delete `fraunces-latin-600-normal.woff2` | 3 failed, suite completes |

The offsite check passed the CDN break the first time it was tried: its context filter only
flagged a URL next to `src`/`href`/`url`/`fetch`/`import`, and a bare `const CDN = "https://..."`
walked straight through. Fixed by stripping comments and re-broken to confirm. Worth restating:
the first version of that guard was useless, and only writing the break test found it — the
same lesson this round's own comment-parsing bug teaches from a different angle.

**Two more, broken independently this round, for the two guards this round's own fix added:**

| Break | Result |
| --- | --- |
| revert the `socialBlock` insertion in `app/browser-template.js` back to emitting nothing | 2 failed correctly: the with-argument assertion and the between-`</title>`-and-`<style>` assertion |
| remove the duplicate-block guard in `splice-social-block.mjs` | 1 failed correctly: splicing a second time no longer throws |

Both restored, both suites rerun clean afterward.

## Shared-file requests

**1. `Tools/board-check/check-integrity.mjs`: extend the offsite-host grep past `.html`.**

That grep walks `.html` only. As of this round the Schedule Visualizer's code is 590 KB of
`.js` and 156 KB of `.css` under `Tools/schedule/app/`, none of it in that walk. The edit:
wherever the walk filters for `.html`, include `.js` and `.css`, skipping `node_modules`,
`Tools/board-check/three-*`, and `Tools/*/libs/` so vendored code does not trip it
(`Tools/schedule/libs/jspdf/jspdf.umd.min.js` would otherwise report). `structure.mjs` covers
`Tools/schedule/app/` already, so this is not urgent for this tool specifically. It is urgent
for the next tool that splits a `.js` file out and has no equivalent guard of its own.

**2. `gvb-save.js` storage quota, still open, third round.**

Unchanged and still blocking task three. Seven independent `localStorage` key families across
23 call sites in the generator: `stviz_settings`, `stviz_settings_time`, `stviz_viz_prefs`,
`stviz_blueprint`, `stviz_schedules`, `stviz_onboarded`, `stviz_whatif`, plus N snapshot slots
through `snapshotKey(i)`. `mountSaveBar` assumes one slot. The blueprint payload is the largest
state on the site and already has its own quota accounting in `app/data-model.js`. (The count
was 29 in round 2's prompt and is 23 counting the generator directly; not worth chasing the
gap, the number will keep moving.)

Devon's answer this round: **skip adoption for now** rather than answer the quota question
yet. So this stays open into round 4 rather than resolving. Locked decisions #36 (keys stay
exactly as they are) and #37 (fill-ins go in `repair`, not `migrate`) still constrain whatever
the eventual answer is; neither decides it.

## Deliberately not done

**Actually regenerating `Tools/schedule-browser.html` end to end.** The `gvb:social` drift gap
itself is closed this round (see "What changed"), but closing the gap and proving the
committed file can survive a real regeneration are two different claims. The second one needs
the real blueprint and real schedule data, which live in whoever's browser last built them, not
in this repo, so this round could not run that regeneration for real. What exists now is the
mechanism (`socialBlock` argument) and the splice script that makes running it safe whenever
someone with the real data does. Not a gap in this round's work, just a boundary on what this
round's evidence can claim.

**`.rcell` vs `.geo-room`.** Read both, they do not merge. Task five closed, not deferred.

**Splitting `viz-playback.js` further.** 163,843 bytes, the largest file left, with a visible
seam (path rendering vs. the playback engine at old line 14729). Two splits in one round with
only two-and-a-bit test suites to catch a bad one is more than the evidence supports this
round.

**Adopting `gvb-save.js`.** Devon's call this round: skip it rather than force an answer to
the quota question. See shared-file request 2.

## Next session

Ordered by value per effort.

1. **Get an answer on the storage-quota question,** then adopt `gvb-save.js`. Three rounds
   open now (Devon's call this round was to skip adoption again rather than answer it). Largest
   remaining item and the only one that cannot start without Devon.
2. **Actually regenerate `Tools/schedule-browser.html` from the generator, for real,** once
   whoever has the live blueprint is doing other work on it anyway. Load the real data, hit
   Publish, run it through `node Tools/schedule/test/splice-social-block.mjs`, diff the result
   against the currently-committed file, and confirm only intended content moved. Would retire
   the "hand-patched, not regenerated" caveat that's followed this file across three rounds.
3. **Shared-file request 1,** the integrity grep. Small, and it stops being about this tool
   the moment a second tool splits a `.js` file out the same way.
4. **Split `viz-playback.js`** at the old line 14729 seam, if 163 KB still bothers anyone.
   `structure.mjs` makes this cheaper than this round's split was: add the file to the
   `GENERATOR` list and the concatenation/duplicate-name checks come along for free.
