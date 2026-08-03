# 19 — Schedule Visualizer and Browser Generator

You are working on the Schedule Visualizer and Browser Generator, a classroom tool on
greyversusblue.com under the board's "Town Services" section. **Round 3 did the restructure round
2 unblocked**: `Tools/schedule-visualizer.html` is a shell now, not an 863 KB monolith — the real
logic lives in `Tools/schedule/app/`, seven files (~594 KB of `.js`, 156 KB of `.css`). This prompt
is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/schedule-visualizer.html` (124,566 bytes) — the generator, now a shell.
- `Tools/schedule-browser.html` (164,349 bytes) — its generated output.
- `Tools/schedule/app/` — the real logic, seven files split out of the shell this round:
  `data-model.js`, `layout-editor.js`, `schedule-ui.js`, `pathfinding.js`, `viz-playback.js`,
  `app-shell.js`, `browser-template.js`, plus `visualizer.css` and a `README.md` explaining the
  split's shape and editing rules — **read that README before moving code between these files.**
- `Tools/schedule/` — `fonts/`, `libs/jspdf/`, `test/` (`smoke.mjs`, `structure.mjs`, new this
  round, `splice-social-block.mjs`, new this round, `publish.mjs`, the Northwind fixture). Any
  further folder you create under `Tools/` named for this tool is yours the same way.

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

## Required reading

1. This whole file.
2. **`Claude Prompts/notes/19-schedule-visualizer-notes.md`** — round 3's session: the restructure
   itself (drafted in a separate sandbox session, checked against the real repo and tooling before
   landing), the What-If Lab read (task two, closed — it's genuinely shared with the newly-read
   simulation module, not duplicated), the `.rcell`/`.geo-room` read (task five, closed — different
   coordinate systems and data sources, not mergeable duplication), both cosmetic task-four items,
   and the `gvb:social` publish-drift gap closed with Devon's explicit go-ahead this round. Round
   2's notes are archived at `Claude Prompts/archive/round-2/notes/19-schedule-visualizer-notes.md`
   — the full simulation-module read and the PDF-size fix. Round 1's are at
   `Claude Prompts/archive/round-1/notes/19-schedule-visualizer-notes.md`.
3. **`Tools/schedule/app/README.md`, new this round** — why the split has this shape, what was
   rejected and why, what this shape is bad at, and the editing rules. Read before moving code
   between the new files.
4. `gvb-site-handoff-v10.md` §4 (`check-integrity.mjs`'s new `.js`/`.css` sweep, this project's own
   round-2 request, applied — confirm it's no longer an open Shared-file request) and §10 (locked
   decisions, through #58).

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

**The restructure is done.** `Tools/schedule-visualizer.html` is 124,566 bytes now (was 863,737) —
both `<style>` blocks and both inline `<script>` blocks are gone, replaced by one `<link>` and
seven `<script src>` tags in the body, in source order, with no `defer`/`async` (about 40 listeners
bind at parse time, so load order has to match the original). The real logic lives in
`Tools/schedule/app/`: `data-model.js` (51 KB — AppState, storage keys, blueprint persistence,
staircase pairing, undo/redo), `layout-editor.js` (116 KB — canvas, tool placement, all five
right-panel editors), `schedule-ui.js` (95 KB — settings, bell/subjects editors, CSV bulk import),
`pathfinding.js` (30 KB — A*, multi-floor graph, congestion map), `viz-playback.js` (164 KB, now
the largest file — path visualization, playback engine, travel-time estimator, PDF/PNG export),
`app-shell.js` (71 KB — onboarding, project export/import, the What-If Lab, `init()`),
`browser-template.js` (68 KB — the publish codegen), plus `visualizer.css` (156 KB). The cut was
mechanical (a script copying verbatim line ranges, not retyping), and this session independently
re-ran that script against the live file and confirmed every one of the seven files reproduces
byte-for-byte. Published output is byte-identical to the pre-restructure baseline.

**The What-If Lab is read now, and it's genuinely shared, not duplicated.** 891 lines, 35
functions, lives entirely in `app-shell.js`. It reuses the same congestion-multiplier model
`computeTravelTimes` uses rather than reimplementing it — confirms the shared helpers round 2
flagged really are shared. No changes needed.

**`.rcell` vs. `.geo-room` are not duplication and cannot merge — read, closed.** Different
coordinate systems (hardcoded absolute-pixel wing layouts vs. data-driven grid cells times a
scale), different data sources, different lifetimes. The only available move is deleting the
legacy renderer, which costs the live app its map for anyone who hasn't drawn a blueprint yet.
Not worth it.

**A repo-wide false-positive bug found and fixed while landing the restructure**:
`check-integrity.mjs`'s inline-script regex matched an HTML comment that described `<script src>`
syntax in prose, because the comment text itself contained an unescaped `<script` with no `src=`
before the next `>`. Reworded the comment; `npm run check` back to 0 broken. Not a bug in the
split, a blind spot in a static regex check — worth knowing if you ever write a comment describing
script-tag syntax anywhere in this project.

**A new guard exists: `Tools/schedule/test/structure.mjs`, 31 assertions.** Checks the seven files
exist, load order matches the `<script src>` list, no tag carries `defer`/`async`/`type=`, no
`<style>` is left in the shell, all seven files parse as one concatenated unit with no duplicate
top-level name (491 names checked), and no `app/` file references an offsite host. Caught a real
`BR_CSS` template-literal syntax error mid-round before `publish.mjs` got to it.

**The `gvb:social` publish-drift gap is closed, with Devon's explicit go-ahead this round** (a
prior session had deliberately left it for later). `brBuildPublishedHTML()` now takes an optional
`socialBlock` argument, emitted verbatim when supplied and omitted otherwise — the live Publish
button still calls it with no argument, so a teacher's own downloaded copy never gets a
`greyversusblue.com` URL baked in. `Tools/schedule/test/splice-social-block.mjs`, new, mechanizes
inserting the committed file's real block into a freshly generated one, for whenever someone with
real blueprint data next regenerates `Tools/schedule-browser.html` for real.

**Both cosmetic task-four items from round 2 are done.** A mobile scroll-affordance gradient on
`.mapscroll` (a first, more "correct-looking" four-layer CSS approach measurably didn't work —
worth reading the notes if you ever revisit this) and the Building Map now paginates sensibly
across a print page break.

**`check-integrity.mjs`'s offsite sweep now covers `.js`/`.css`, not just `.html`** (this project's
own round-2 request, applied by prompt 22 this round) — confirm this is reflected as done, not
still open, in Shared-file requests.

**`localStorage`: still 29 call sites, still hand-rolled.** See "Questions for Devon" above — third
round running with the same open question, Devon has said skip adoption each time so far.

## Your task

**The restructure, the What-If Lab read, and the `.rcell`/`.geo-room` read are all closed.** What's
left:

1. **Adopt `gvb-save.js`, once the storage-quota question above is answered.** Keep every existing
   key exactly as it is (locked decision #36); put fill-ins in `repair`, not `migrate` (locked
   decision #37). A missing hook is a Shared-file request, not something to patch around.
2. **`viz-playback.js` at 164 KB is now the largest file in the tool** — the notes name a clean
   further split (path rendering vs. the playback engine, at the old file's line 14729) if anyone
   wants one. Optional, not urgent.
3. **The actual end-to-end regeneration of `Tools/schedule-browser.html`** — deliberately not done
   this round, since it needs real blueprint/schedule data that lives in whoever's browser last
   built it, not in this repo. `splice-social-block.mjs` is ready for whenever that happens.
4. If your own pass turns up something new, add it here.

## Verification

- **Before changing anything, generate a browser file from the current generator and keep it**
  (`node Tools/schedule/test/publish.mjs baseline.html`). After any change, generate again and diff.
- **Open the generated output in a browser and use it**, every time.
- `node Tools/schedule/test/smoke.mjs` → **73 passed, 0 failed.**
- `node Tools/schedule/test/structure.mjs` → **31 passed, 0 failed.**
- After any change touching fonts or jsPDF, grep both files for offsite hosts → zero hits, then
  **actually export a PDF**.
- `cd Tools/board-check && npm run social:check` → **18 notices, 18 already current** (Orbital's
  card joined this round).
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken; 0
  collisions across nine widths, tightest vertical gap 9.1px.** (The unit count moves every round as
  files are added elsewhere in the repo; 0 broken is what matters.)
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
