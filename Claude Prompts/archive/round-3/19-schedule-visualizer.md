# 19 — Schedule Visualizer and Browser Generator

You are working on the Schedule Visualizer and Browser Generator, a classroom tool on
greyversusblue.com under the board's "Town Services" section. **At 863 KB it is by far the
largest hand-written file in the repo.** It is a generator: it produces the second file you
own. Round 2 read the entire ~4,400-line simulation half of the file for the first time
(pathfinding, congestion, playback) and fixed a 21 MB PDF export down to ~190 KB. **The
restructure is now unblocked — see task one.** This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/schedule-visualizer.html` (863,737 bytes) — the generator.
- `Tools/schedule-browser.html` (161,074 bytes) — its generated output.
- `Tools/schedule/` — `fonts/`, `libs/jspdf/`, `test/` (`smoke.mjs`, `publish.mjs`, the Northwind
  fixture). Any further folder you create under `Tools/` named for this tool is yours the same way.

**The two old dated/spaced paths still exist as tiny redirect stubs.** Leave them.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Other Claude sessions may be working on other projects in this same repo, and
this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Both `href`s are the plain, permanent names (locked decision #46). Prompt 22. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 20. `Tools/board-check/` is prompt 22's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own files: each `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). If your generator emits a `<head>` for the browser file, it must reproduce
those markers exactly, or `npm run social:check` will report drift on every regeneration.

## Questions for Devon

- **How should storage quota be handled for `gvb-save.js` adoption?** Still open, unchanged across
  two rounds: this tool has six or seven independent `localStorage` keys, `mountSaveBar` assumes a
  single slot, and the blueprint payload is the largest state anywhere on the site — it already has
  its own quota-accounting code today. Adopting the shared module needs this question answered
  directly rather than inheriting an assumption from a simpler adopter (every other adopter has one
  small save; this one doesn't). See task two below.

## What is already decided — don't reopen these

**The committed floor plan question is resolved.** Devon's call, made this round: **leave it as
is.** No student names, so no FERPA issue; the school-security question (34 real staff surnames,
rooms, and — combined with the floor plan — every teacher's planning-period block, at a public URL
with no login) was surfaced plainly and the answer was to change nothing. `PUBLISHED_DATA` is
untouched. Don't re-raise this as an open question.

**The versioned-filename decision, from round 1.** `TOOL_VERSION = 'v61'` still shows in the
header and the published footnote. Both real files keep their plain, permanent names; both old
dated paths still redirect. Nothing to revisit.

## Student and staff data: handle with care

- **Everything stays in the browser.** Both files make zero offsite requests.
- Any sample or fixture you create uses obviously fake names (the existing test fixture already
  does).
- `localStorage`: 29 hand-rolled call sites, six or seven independent keys, not adopted into
  `gvb-save.js` yet — see the Questions for Devon block above and task two.

## What is actually here

**The generator**: `Tools/schedule-visualizer.html`, 863,737 bytes (was 862,547 at round 1's
refresh — +1,190 bytes this round). **The output**: `Tools/schedule-browser.html`, 161,074 bytes
(+357).

**The full pathfinding/congestion/playback module is read now, for the first time.** Round 2 read
about 4,430 lines line-by-line: the A* pathfinding engine (with a teleport-aware admissible
heuristic for staircase pairs), segment resolution, path visualization and congestion colouring,
the top-3 hotspot pulse overlay, and — the biggest piece, previously completely unread — the
playback engine and travel-time estimator, including a real per-tile, quadrant-based hallway
traffic simulation with directional right-of-way rules. **This answers round 1's open question,
"is the movement real, and does the visualizer make it visible?": yes.** Not a toy heatmap — a
genuine traffic model.

**The PDF export is fixed: 21.4 MB → ~190 KB, same 11-room fixture.** `renderExportCanvas()` now
also returns the raw canvas; `exportVizAsPDF()` embeds a JPEG recompression (quality 0.82) instead
of an uncompressed PNG. Safe because the export canvas is always painted with an opaque background
first, so there's no alpha channel a JPEG could lose. `exportVizAsPNG()` is untouched, still
lossless.

**Accessibility: the mode switcher's three buttons now carry `role="tab"` and `aria-selected`**, in
both the live generator and the publish template — fixed in the generator function so every newly
published file gets it for free, plus a hand-patch to the already-committed `schedule-browser.html`
since it isn't regenerated automatically.

**`Tools/schedule/test/smoke.mjs`, 67 assertions** (was 42): the mode-switcher fix, the PDF-size
fix (driving the real `exportVizAsPDF()` button with real render data, asserting a `%PDF` header
and a 2 MB ceiling), and 17 new assertions covering the simulation half for the first time — A*
routing across a staircase pair, `resolveRoomPath`'s three documented outcomes, congestion/hotspot
data, travel-time annotation, and a full `PlaybackController` lifecycle.

**A guard-rail check found a real hardening gap, fixed in passing**: emptying
`AppState.blueprint.crossFloorPairs` before building the graph first **crashed the whole test
suite** with an uncaught `TypeError`, instead of failing the one assertion it should have. A test
that crashes instead of failing is worse than no test — a real regression could produce the same
crash and get misread as "the harness broke," not "the feature broke." Hardened before this round
ended.

**Still not done: the restructure itself.** 863 KB in one file is still the strongest restructure
case in the repo, and task four (the read) was its explicit precondition — now satisfied. Round 1's
two-session estimate for the restructure itself still looks right given the file's size.

**Still not done: the What-If Schedule Lab, ~890 lines, completely unread.** Shares some of the
same congestion/weighting helpers the newly-read module uses. Not part of round 2's task, but
belongs on the list before anyone restructures the file — a split has to know what depends on what.

**`localStorage`: still 29 call sites, still hand-rolled.** See Questions for Devon above.

## Your task

Round 2 closed the read (the precondition for the restructure) and the PDF-size fix. What's left:

1. **Restructure the file — now unblocked.** A generator with a template, an importer, a layout
   engine, a pathfinder, and a UI wants to be five files. The algorithmic core is now genuinely
   understood, not skimmed, per round 2's read. Two sessions still looks like the right estimate
   given the file's size and the fact only two test suites exist to catch a bad split.
2. **Read the What-If Schedule Lab** (~890 lines) before or during the restructure, since it shares
   helpers with the module round 2 just read.
3. **Adopt `gvb-save.js`, once the storage-quota question above is answered.** Keep every existing
   key exactly as it is (locked decision #36); put fill-ins in `repair`, not `migrate` (locked
   decision #37). A missing hook is a Shared-file request, not something to patch around.
4. **Cosmetic, quick:** a scroll-affordance shadow on the mobile map (nothing currently tells a
   phone user the map scrolls), and check the Building Map prints sensibly across a page break.
5. **`.rcell` vs. `.geo-room`** — two floor-plan SVG renderers that look like duplication but
   haven't been read deeply enough to be sure they can merge. Needs a deeper read of both, possibly
   as part of the restructure.

## Verification

- **Before changing anything, generate a browser file from the current generator and keep it**
  (`node Tools/schedule/test/publish.mjs baseline.html`). After any change, generate again and diff.
- **Open the generated output in a browser and use it**, every time.
- `node Tools/schedule/test/smoke.mjs` → **67 passed, 0 failed.**
- After any change touching fonts or jsPDF, grep both files for offsite hosts → zero hits, then
  **actually export a PDF**.
- `cd Tools/board-check && npm run social:check` → **17 notices, 17 already current** (dropped
  from 22 this round — a real, correct count, not a regression; the parse failure that blocked this
  check in round 2 is fixed now too).
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 3.5px.**
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed.**
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail — round 2's own crash-instead-of-fail finding (above) is exactly why this matters.

Scheduling note: `npm run games`, `npm run play`, `npm run previews`, and `npm run tools` open real
visible browser windows, and Chrome throttles a window that loses focus. Other threads may be
running them. Only one browser suite at a time.

## Output: your notes file

Write `Claude Prompts/notes/19-schedule-visualizer-notes.md`. Nobody else writes that file, so it
can never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-two of these.

Use these headings:

```
# Schedule Visualizer and Browser Generator — session notes

## What is in the committed schedule data
## The versioned-filename decision
## Coverage: what I actually read
## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

Note the three extra headings, which only this prompt asks for.

- **What is in the committed schedule data** — this is resolved (Devon: leave it). Say so plainly
  rather than re-opening it.
- **The versioned-filename decision** — already made; note here only if anything needed revisiting.
- **Coverage: what I actually read** — build on round 2's map (the full simulation module is now
  read) rather than restarting it. If you restructure, this is where the module boundaries you
  found should be recorded for whoever picks up the next piece.
- **What changed** — files touched and why, with paths. If you changed the generator's template,
  say so explicitly and whether you regenerated the output.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — anything needing a board or `gvb-save.js` edit, specific enough to
  apply blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
