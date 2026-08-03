# Tools/schedule/app — why this folder exists and how to work in it

Written round 19, when `Tools/schedule-visualizer.html` was cut from 863,737 bytes into a
124,555-byte shell plus the eight files here.

The session notes for that round, `Claude Prompts/notes/19-schedule-visualizer-notes.md`, say
what changed and what was verified. This file says why the shape is what it is, what was
considered and rejected, what this shape is bad at, and what to do before you edit it. Read
this one first if you are about to move code between files.

## What is here

Seven classic scripts and one stylesheet. `schedule-visualizer.html` loads them with plain
`<script src>` tags in the body, at the exact positions the two inline `<script>` blocks used
to occupy.

```
visualizer.css        156,038   both old <style> blocks, head first then What-If
data-model.js          51,016   AppState, storage, blueprint model, undo/redo
layout-editor.js      115,806   the canvas grid editor
schedule-ui.js         95,358   settings, bell/subjects, schedules module, CSV, bulk editor
pathfinding.js         29,646   A*, multi-floor graph, congestion
viz-playback.js       163,843   path rendering, playback, travel time, PDF/PNG export
app-shell.js           70,637   modals, project I/O, snapshots, presentation, What-If, init()
browser-template.js    67,499   BR_CSS, every br* function, the publish codegen
```

## Why split at all

The file was the largest hand-written thing in the repo by a wide margin and had been the
strongest restructure case for three rounds. The concrete costs were editing friction and the
fact that no reader could hold it, not performance. Nothing about the single file was slow.

That matters for judging this change: the win is legibility, and legibility is worth exactly
nothing if the split introduced a behaviour change. Which is why byte-preservation was the
governing constraint rather than a nice-to-have.

## The constraints that decided the shape

### Byte-preservation, because the publish path stringifies its own source

`brPublishFnList().map(f => f.toString())` and the four `brDColor` / `brTDept` / `brDShort` /
`brOrderOf` `.toString()` calls put function source text directly into every published file.
Reindent anything in `browser-template.js` and the published bytes change.

That is not just untidy. The published-output diff against a baseline is the only regression
signal this tool has for a change of this size, and a cosmetic reformat would have filled it
with noise and hidden a real difference in the middle of it. So the cut was mechanical:
`_audit/split-r19.py` in the round 19 bundle copies whole line ranges and never touches a
character inside them.

**If you reformat any file here, you are changing published output.** That may be fine. Know
that you are doing it, and regenerate and diff.

### Load order is source order, and it is load-bearing

The generator runs 130 non-declaration top-level statements. About 40 of them are
`document.getElementById(...).addEventListener(...)` calls that bind at parse time, the first
at old line 5589 and the last at 9780. There are also three bare init calls partway through
the file, `AppState.viz = {...}`, `AppState.whatif = {...}`, and
`document.addEventListener('DOMContentLoaded', init)`.

So each file is a contiguous range of the original, and the `<script src>` order reproduces
the original order exactly. That is not a stylistic preference. It is the only way to be sure
those 130 statements still run in the sequence they ran in before, without auditing each one.

`structure.mjs` asserts the order.

### Every module is contiguous

The plan this round started from had one module spanning two disjoint ranges, 9266-11533 plus
15963-17610, merged to keep the count at six. Loading that as one file would have moved top-
level statements across the pathfinding and viz blocks. Some of those moves are probably
harmless. "Probably harmless" is not a thing you want to be relying on across 130 statements
with two test suites.

Seven contiguous files cost nothing and removed the question. If you add an eighth, keep it
contiguous too.

## Alternatives that were considered and rejected

**ES modules.** `type="module"` gives every file its own scope, and the 491 top-level names
here are shared through the global lexical scope of classic scripts. Converting means adding
`import` / `export` to roughly 490 declarations and every call site, in one change, with no
way to verify it short of the same two suites. It also makes the files unloadable over
`file://`, which matters because people do open these locally. Classic scripts were not a
compromise; they were the only option that let this be a pure move.

**A bundler.** Would solve the scope question and add a build step to a repo that has none, for
a tool whose defining property is that it makes zero offsite requests and needs nothing
installed to run. The cost is permanent, the benefit is one refactor.

**`<script defer>` in `<head>`.** Would work, since deferred scripts run after parsing. But
the two existing `defer` tags for jsPDF and `published-fonts.js` come earlier in the head, so
the modules would run after those instead of before them, and `window.jspdf` and
`window.BR_PUBLISHED_FONT_CSS` would exist at module-eval time when today they do not. Nothing
reads them at top level, so it is benign. It is also a gratuitous behaviour change inside a
refactor whose entire promise is that behaviour does not change. Body, no `defer`, same
positions.

**`lib/` for the folder name.** `libs/` one level up holds vendored jsPDF. Two paths differing
by one letter, in a repo where paths get typed by hand, is a trap someone will fall into.
`app/` for our code, `libs/` for vendored.

**Leaving the CSS inline.** Would have left the shell at 275,627 bytes, still the largest file
in the tool, and the restructure only half done. Moving it is one `<link>` tag, precedented by
the `fonts.css` link two lines above, and no JS risk: nothing in the tool reads
`document.styleSheets` or introspects a `<style>` element. Verified by grep before moving it.

**Moving `BR_CSS` into `visualizer.css`.** Cannot. `brBuildPublishedHTML()` inlines its text
into every published file, and a published file is emailed to staff with no folder next to it.
It stays a template literal in `browser-template.js`.

## What this shape is bad at

Worth being straight about, because the notes file is about what improved.

**Two files can now silently disagree about a name.** In one file, a duplicate top-level
`function foo` is a redeclaration you would probably notice. Across two files it is legal,
silently resolved by load order, and is exactly how a bad split loses a function.
`structure.mjs` checks this across all 491 names, which is the mitigation, not the absence of
the problem.

**A duplicate `const` is now a load-time SyntaxError with a terrible failure mode.** The
browser refuses the second script and roughly forty smoke assertions fail at once with no
indication of the cause. `structure.mjs` parses the six generator modules as one concatenated
unit specifically to catch this in one second with one message, before anything opens a
browser. Run it first.

**The offsite guarantee moved out from under `check-integrity.mjs`.** That check greps every
`.html` in the repo, and 590 KB of this tool's code is now `.js`. `structure.mjs` covers this
folder. The next tool that splits out a `.js` file will have no equivalent. There is a
shared-file request in the round 19 notes to extend the repo-wide grep to `.js` and `.css`;
until that lands, this hole is tool-shaped and will grow.

**Eight files is eight chances to edit the wrong one.** The old file had one search. Grep
across `Tools/schedule/app/` rather than opening files.

## Rules for editing

1. **Run `node Tools/schedule/test/structure.mjs` first.** No dependencies, about a second,
   and it is the check specific to this architecture.
2. **Do not add `defer`, `async` or `type=` to any tag.** `structure.mjs` fails if you do. If
   you have a reason, understand the parse-time listener binding first.
3. **Do not reorder the `<script src>` list.** Same.
4. **Moving code between files means moving top-level statements.** Function bodies are free,
   since they run at call time. The 130 top-level statements are not. If what you are moving
   sits at column 0 and is not a `function` / `const` / `let` / `var` / `class`, work out where
   it lands relative to what it touches.
5. **Adding a file:** contiguous range, add the `<script src>` tag in the right position, and
   add the name to the `GENERATOR` array in `structure.mjs` so the concatenation and duplicate-
   name checks cover it.
6. **Touching `browser-template.js` changes published output.** Generate before, generate
   after, diff. `node Tools/schedule/test/publish.mjs out.html`.
7. **`Tools/schedule-browser.html` is not regenerated automatically.** A change to `BR_CSS` or
   to a published `br*` function has to be hand-applied there too, or the committed copy
   drifts. Round 2 did this for the aria fix and round 19 did it for the map changes. Pull the
   replacement text out of `browser-template.js` programmatically rather than retyping it.
8. **Never hand-edit between the `gvb:social` markers** in the shell's `<head>`. Locked
   decision #31.

## Considerations for future iterations

**`viz-playback.js` at 163,843 bytes is the largest file left,** and the obvious next split.
The seam is at old line 14729, where path rendering ends and the playback engine plus travel-
time estimator begin. That is roughly a 100 KB / 64 KB cut. This is cheaper now than round 19's
split was: `structure.mjs` already exists, and adding the new name to its `GENERATOR` array
brings the concatenation and duplicate-name checks along for free.

**`visualizer.css` at 156,038 bytes is second largest** and has an obvious internal seam. The
What-If Lab's rules, the last 7,755 bytes, were a separate `<style>` block until this round and
are cleanly separable again. Splitting the rest would mean deciding boundaries in a stylesheet
that has never had any, which is a bigger job than it looks.

**The What-If Lab shares congestion helpers with `viz-playback.js`.** It lives in
`app-shell.js` and calls into functions defined two files earlier. That works because
everything is one global scope, and it is the single most obvious dependency that a future
move to modules would have to make explicit. If anyone ever does attempt modules, start by
mapping that edge.

**Do not let file count grow without a reason.** Eight files for 863 KB is roughly 100 KB
each, which is a size a person can hold. Twenty files of 40 KB would be worse, not better:
more places to look, more cross-file references, and the same total. Split when a file stops
being holdable, not on a schedule.

**What would force a build step.** Nothing currently in view. The things that would are
TypeScript, a framework, or wanting real module scope. If any of those come up, the right time
to argue about it is before, not during. The current setup's value is that a browser, a text
editor and `node` are the entire toolchain.

**The storage question outranks all of this.** `gvb-save.js` adoption has been open three
rounds and is blocked on one decision about quota across seven `localStorage` key families.
No amount of further splitting substitutes for answering it.

## How round 19 verified this, in case you are doing something similar

Recorded because the method transferred better than any individual finding.

1. Generate the baseline output **before touching anything**, and confirm the existing suite
   passes, so you know the harness is real rather than assumed.
2. Make the change mechanical and scriptable, so it can be reproduced and audited rather than
   trusted.
3. Diff the output byte for byte. Byte-identical is a much stronger claim than "the tests
   pass", and for a pure move it is achievable.
4. Write the guard for the failure mode the change introduces, not for the code it touched.
5. Break the guard on purpose before believing it. Round 19's offsite check **passed** its own
   break test the first time: the context filter only flagged URLs sitting next to `src`,
   `href`, `url`, `fetch` or `import`, so a bare `const CDN = "https://..."` walked straight
   through. Nothing but writing the break test would have found that. Locked decision #34
   exists for this reason and it paid out immediately.
6. When a measurement disagrees with the mechanism you think is running, instrument the
   mechanism rather than tuning the numbers. The map scroll affordance looked like it needed a
   stronger gradient. Painting the four background layers in solid colours showed they were in
   exactly the right places and underneath an SVG that covered them, which no amount of tuning
   would have fixed.
