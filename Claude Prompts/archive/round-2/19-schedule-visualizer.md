# 19 — Schedule Visualizer and Browser Generator

You are working on the Schedule Visualizer and Browser Generator, a classroom tool on
greyversusblue.com under the board's "Town Services" section. **At 18,777 lines and 862 KB it is by
far the largest hand-written file in the repo** — more than twice the next biggest — and it is a
generator: it produces the second file you own. It also handles school schedule data, so the
data-handling section below is not boilerplate. This prompt is self-contained.

**Round 1 already ran on this project.** It renamed both files, versioned the tool properly, vendored
its fonts and jsPDF, fixed a broken mobile map, and surfaced a real, still-unresolved question about
the committed schedule data. Read its notes before you do anything else — see Required reading.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Tools/schedule-visualizer.html` (18,777 lines, 862 KB) — the generator. Renamed this round from
  `Tools/Schedule Visualizer and Browser Generator v60.html`.
- `Tools/schedule-browser.html` (636 lines, 157 KB) — **its generated output**. Renamed this round
  from `Tools/Schedule Browser as of 260715.html`.
- `Tools/schedule/` — already exists, created last round: `fonts/` (11 vendored woff2 files plus
  `fonts.css` and a generated `published-fonts.js`), `libs/jspdf/` (vendored jsPDF 2.5.1), and `test/`
  (`smoke.mjs`, `publish.mjs`, the Northwind fixture). Any further folder you create under `Tools/`
  named for this tool is yours the same way.

**The two old paths still exist**, as tiny redirect stubs: `Tools/Schedule Visualizer and Browser
Generator v60.html` (2,576 bytes) and `Tools/Schedule Browser as of 260715.html` (2,628 bytes), each a
`<meta http-equiv="refresh">` plus a visible link. They exist so nothing already bookmarked, emailed,
or posted to Schoology under the old name 404s. Leave them; they are not leftovers to clean up.

You own both real files because they are one system: the second is the first's output, and changing
the generator's template without regenerating the output leaves the site serving a stale page. No
other thread touches either.

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing outside
that list. Up to twenty other Claude sessions may be working on other projects in this same repo, and
this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Carries a card for each of your two files. Both `href`s are now the plain, permanent names — `Tools/schedule-visualizer.html` and `Tools/schedule-browser.html` — with no version or date in the URL (locked decision #46). A version bump or a republish is no longer a board edit. Prompt 21. |
| Every other file in `Tools/` | Prompts 16, 17, 18, 20. `Tools/board-check/` is prompt 21's. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't. Your two real filenames are now lowercase, hyphenated, and space-free, so the board
`href`s no longer need `%20` encoding. The two old stub paths still have spaces and still get
URL-encoded — that is fine, they are redirects, not the canonical link.

**If you need a shared file changed, do not change it.** Write the exact edit into the "Shared-file
requests" section of your notes file, specific enough that someone can apply it without reading your
session.

One exception inside your own files: each `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those markers**
(locked decision #31). They are regenerated from the board's notices by `npm run social`, and your edit
will be silently overwritten. Both real files carry the block, confirmed by grep. **This is still a
real trap for you specifically:** if your generator emits a `<head>` for the browser file, it must
reproduce those markers and their contents exactly, or `npm run social:check` will report drift on
every regeneration.

## Required reading

1. This whole file.
2. **`Claude Prompts/notes/19-schedule-visualizer-notes.md`** — round 1's session notes for this exact
   project. It has a line-by-line coverage map of what was and wasn't read in the 18,777-line file, the
   full reasoning behind the rename, and the exact wording of the committed-data flag. Read it before
   touching anything. `Claude Prompts/archive/` holds earlier rounds' prompts and notes if you need
   more history than that.
3. **`gvb-site-handoff-v8.md`**, all of it. Specifically: the top section ("Two things that matter more
   than anything below"), which discusses this project by name and is where the committed-schedule-data
   flag lives at full prominence — that flag is still open. §7 (backlog state) lists it as "Flagged, not
   decided — Devon's call." §9's locked decision **#46** is this project's own contribution: "a tool's
   own version lives in the page, not the filename," written up from exactly what round 1 did here.
4. `gvb-site-handoff-v6.md` §3 — how favicons and OG tags are generated into every page's head from
   `index.html`'s notices, and locked decisions #31 and #32. You are the only tool that *also* generates
   HTML, so you are the only one that can fight with `sync-social-tags.mjs`.
5. Locked decision #3 in `gvb-site-handoff-v1.md` §3: "Town Services means schoolhouse tools."
6. `assets/js/gvb-save.js` and `assets/js/README.md` — not adopted yet, but still the target for task
   six below.

## The versioned-filename decision — already made

Round 1 decided this. Both files are renamed, both old paths redirect, and it is now locked decision
#46 in `gvb-site-handoff-v8.md` §9: *"A tool's own version lives in the page, not the filename... the
board `href`s are the plain, permanent names... the old dated paths stay as tiny redirect stubs so
nothing already linked or bookmarked 404s."*

What that looks like on disk: `TOOL_VERSION = 'v61'` is a constant near the top of the generator's
script, shown in the header next to the school name, and stamped into the footnote of every file the
tool publishes — *"Published July 15, 2026 from the School Layout Visualizer v61."* A version bump and
a republish are no longer board edits.

Round 1 also reconciled three different names for one tool while it was in there — the `<title>` said
"Movement Visualizer," the old filename said "Schedule Visualizer and Browser Generator," the board
card said "School Layout Visualizer." The board's name won; seven strings changed, including the PNG
and PDF export filenames.

Nothing left to decide here. If you rename anything further, remember every rename is still a board
`href` change and needs a Shared-file request.

## Student and staff data: handle with care

This tool handles school schedules. Depending on what it ingests, that can include staff assignments
and student placements, and student schedules are education records under FERPA.

Hard rules:

- **Everything stays in the browser.** No network calls, no analytics, no third-party endpoint, ever.
  Both files now make zero offsite requests — confirmed fresh, zero hits grepping both for `cdnjs`,
  `googleapis`, and `gstatic`. Keep it that way.
- **Do not put real schedule data in the repo... except it already is, and that is the open question.**
  `Tools/schedule-browser.html` is a data file committed to a public GitHub repository served at a
  public domain. Round 1 opened it and confirmed: **no student names**, so no FERPA disclosure. What it
  does contain — 34 real staff surnames, rooms, departments, and, combined with a full floor-plan SVG,
  each teacher's planning-period block on both A and B days — is a **school-security question, not a
  privacy one**, and it is still open. See the top of "What is actually here" below; do not resolve it
  yourself.
- Any sample or fixture you create uses obviously fake names. The existing test fixture
  (`Tools/schedule/test/fixture-northwind.mjs`) already does this — a fake two-floor school, 11 rooms,
  4 groups.

If you touch persistence: it is currently 29 hand-rolled `localStorage` call sites across six or seven
independent keys, none of it adopted into `gvb-save.js` yet. Anything in `localStorage` sits on a shared
machine until cleared; a visible clear-all control and one honest sentence about what is stored are both
required if you add to it.

## What is actually here

**Unresolved and flagged at the top on purpose — the committed floor plan.** `PUBLISHED_DATA`, an 18.5
KB JSON literal, sits in both `Tools/schedule-browser.html` and (as the generator's own state)
`Tools/schedule-visualizer.html`. It contains 34 real East Middle School teacher surnames, their rooms,
departments, sections, which colleagues they share students with, and — combined with the 50×30 floor
plan grid also in the file — **which block is each teacher's planning period, on both A and B days**.
No student names. Individually, a surname and a room number are the kind of thing on a door or in a
staff directory. Together with the floor plan, they say where a named adult is *not*, at each of four
times of day, on a public URL with no login. `gvb-site-handoff-v8.md`'s own top section calls this "a
school-security question rather than a privacy one" and lays out three options, none of them taken:
leave it as is; stop committing the file and hand it out as an email attachment instead (the tool
already names downloads `Schedule_Browser_EMS_<date>.html`, so this costs nothing to switch to); or take
the page down. **This is Devon's call, not a code task, and nothing about it has changed since round 1
flagged it.** Do not decide it for him — see task one.

**The generator:** `Tools/schedule-visualizer.html`, 18,777 lines, 862,547 bytes. Its `<title>`, old
filename, and board-card name are reconciled to "School Layout Visualizer" (see above). `TOOL_VERSION =
'v61'` is shown in the header and stamped into every published footnote.

**The output:** `Tools/schedule-browser.html`, 636 lines, 160,717 bytes. `PUBLISHED_DATA` is
byte-identical to the pre-rename file — only the head, footnote wording, and one CSS rule changed.

**Offsite requests: zero, in both files, confirmed fresh.** Round 1 vendored jsPDF 2.5.1 (364,463
bytes, byte-for-byte the cdnjs original, MIT licence, in `Tools/schedule/libs/jspdf/`) and eleven woff2
font files (163,380 bytes total: DM Sans 400/500/600/700, DM Mono 400/500, Fraunces 600, Public Sans
400/500/600/700, under `Tools/schedule/fonts/`). `npm run tools` reports both pages with "no offsite
requests refused." Worth knowing why this mattered: the old Google Fonts hotlink pulled DM Sans 300 and
Fraunces 300/300-italic, weights the file never actually renders (all nineteen Fraunces rules set 600
explicitly) — wasted bytes on every load — and it never requested Public Sans at all, despite the
Schedule Browser's own stylesheet setting it everywhere, so the published file silently rendered in a
system-font fallback for its entire life until this round fixed it.

**The mobile map is fixed.** The floor-plan SVG carried `style="width:100%"` and shrank to fit a 375px
phone, drawing room numbers about 4px tall. It now renders at native 1,316px with real horizontal
scroll below 900px — checking a room assignment on a phone is the main thing anyone does with a
published file, and that was the wrong end of the trade to lose.

**A test suite exists now.** `Tools/schedule/test/smoke.mjs`, 42 assertions, exits non-zero on failure.
Ran it fresh: **42 passed, 0 failed.** It covers one path end to end — boot the generator, import a
fixture, publish, open the result from `file://` with no server, use it as a teacher would (pick a
teacher, read the day, switch views, check the building map). It does **not** cover the simulation half
(below).

**Coverage is honest and still partial — do not assume the tool is understood.** Round 1 read about
13% of the file's 18,777 lines in real depth (roughly 2,400 lines: the data model, both import/export
paths, the whole Schedule Browser block), skimmed another ~2,700 (the stylesheet, the schedules/bulk
editor module), and **never opened the remaining ~73%, roughly 13,700 lines**: the pathfinding engine,
the congestion heatmap, the top-3 hotspot overlay, path visualization, the playback engine, and the
travel-time estimator. That is the actual "movement" half of what "Movement Visualizer" /
"School Layout Visualizer" refers to — a tool about bodies moving through a building at passing time,
not a timetable grid, and it sits behind a button nobody outside the generator's own machine ever
presses. The Schedule Browser (the published half everyone else sees) is fully understood; the
simulation is not. The exact line ranges are in the notes file's coverage table — re-locate them by
function name rather than trusting the old line numbers, since the file has shifted slightly since the
rename.

**`localStorage`: 29 call sites, still hand-rolled, not adopted into `gvb-save.js`.** Six or seven
independent keys: `stviz_settings`, `stviz_blueprint`, `stviz_schedules`, `stviz_viz_prefs`,
`stviz_onboarded`, `stviz_whatif`, plus a numbered snapshot series with its own quota accounting. This
was deliberately not attempted last round — see task six.

**The PDF export still produces an oversized file.** `exportVizAsPDF()` embeds a full-resolution,
uncompressed PNG. A fake school with 11 rooms produces a 21.4 MB PDF — not broken, but not something
anyone emails. Understood, not fixed; picking a compression strategy (JPEG at quality, lower export DPI,
or vector output) is a design decision, not a bug fix. See task three.

**A real, current gap on the file staff actually open:** the Schedule Browser's mode switcher has
`role="tablist"` on its container, but the three buttons themselves have no `role="tab"` and no
`aria-selected` — the selected state is conveyed by a CSS class only. See task two.

## Your task

Round 1 happened. The backlog below is what it left, ordered by value per effort — this is not a cold
start.

**Task one: the committed floor plan is Devon's decision, not yours.** If you are a Claude session
running this prompt, do not remove or alter `PUBLISHED_DATA` on your own judgement, and do not treat
"leave it" as the default just because no one has acted yet. Surface the question plainly (it is
already written out above and in the notes file) and let the decision get made explicitly. This is the
only item in this prompt with someone else's name on it.

**Task two: add `role="tab"` and `aria-selected` to the Schedule Browser's three mode-switcher
buttons.** The container's `role="tablist"` is already correct; the buttons aren't finished. Small,
concrete, and `smoke.mjs` is already in place to catch a mistake — extend it with an assertion for the
new attributes rather than trusting it by eye.

**Task three: fix the PDF export size.** Pick one of JPEG-at-quality, a lower export DPI, or vector
output instead of a raster, implement it, and report the new file size against the same 11-room fixture
so the before/after is comparable. Say which trade-off you picked and why; there is no single correct
answer here.

**Task four: read the simulation half, and only then extend the test suite to cover it.** This is the
prerequisite for everything after it — the pathfinding engine, the multi-floor graph, congestion
colouring, the hotspot overlay, and the playback/travel-time engine, roughly 4,400 lines never opened
last round. Do not restructure any of this before you have actually read it as prose, not skimmed it.
A full session, honestly.

**Task five (do not start before task four): restructure the file.** 862 KB in one file is still the
strongest restructure case in the repo. A generator with a template, an importer, a layout engine, a
pathfinder, and a UI wants to be five files. It stayed a single file last round specifically because
13% read depth is not enough to split safely, and that has not changed until task four happens.

**Task six (a session of its own, not urgent): adopt `gvb-save.js` for all 29 call sites.** The tool has
six or seven independent storage keys, not one; `mountSaveBar` assumes a single slot; the blueprint
payload is the largest state on the site and already has its own quota-accounting code. Answer the
storage-quota question directly rather than inheriting an assumption from a simpler adopter. Keep every
existing key exactly as it is (locked decision #36); put fill-ins in `repair` rather than `migrate`
(locked decision #37), since `repair` runs on every accepted load and `migrate` only on version drift. A
missing hook is a Shared-file request, not something you patch around.

**Cosmetic, quick, do whenever convenient:** a scroll-affordance hint on the now-scrollable mobile map
(a shadow at the scroll edge is the standard fix — nothing currently tells a phone user the map
scrolls), and check the Building Map prints sensibly across a page break.

**Noted but not tasked — a judgement call, not a bug:** `.rcell` and `.geo-room` are two separate
floor-plan SVG renderers (the Building Map and the smaller "Where to find you" plan on a teacher's own
page) that look like duplication but weren't read deeply enough last round to be sure they can merge.
Leave them unless task four's deeper read settles it. Italic font faces were deliberately not vendored —
no italic was ever requested by the old hotlink either, and shipping real italics now would be a visual
design change, not dependency cleanup.

## Verification

There is now a real regression baseline where there was none. Use it.

- **Before changing anything, generate a browser file from the current generator and keep it** (
  `node Tools/schedule/test/publish.mjs baseline.html`). After any change, generate again and diff. A
  generator whose template silently drops a column gives you no error at all.
- **Open the generated output in a browser and use it**, every time. A generated file that parses is
  not a generated file that works.
- `node Tools/schedule/test/smoke.mjs` → **42 passed, 0 failed.** Confirmed fresh. If you extend
  coverage for tasks two or four, this is the file to add assertions to.
- After any change touching fonts or jsPDF, grep both files for `cdnjs.cloudflare.com`,
  `fonts.googleapis.com`, `fonts.gstatic.com` → zero hits each, confirmed fresh. Then **actually export
  a PDF**, because a vendored library with a wrong path fails at the moment of use, not at load.
- `cd Tools/board-check && npm run social:check` → expect **22 notices, 22 already current** (not 23 —
  the Bestiary Gallery is gone). As of this refresh, running it surfaced an unrelated parsing failure —
  `only parsed 17 notices out of index.html — the notice markup has changed shape` — which is
  `index.html`'s own markup drifting, not anything in your two files. That is outside your boundary; if
  you hit the same error, do not chase it into `index.html`. Confirm your own files independently
  instead: grep both for `gvb:social:start` — both currently carry the block.
- `cd Tools/board-check && npm run check` → as of this refresh, **331 units checked**; the one broken
  unit is `newindex.html`, an unrelated file outside your boundary with its own offsite-font references
  — not yours to fix, and not evidence you broke anything. **0 collisions across nine widths, tightest
  vertical gap 9.2px.** If your own run reports a broken unit under `Tools/schedule-visualizer.html` or
  `Tools/schedule-browser.html`, that one is real and yours.
- `cd Tools/board-check && npm run tools` → **18 checks, 0 failed.** This is the suite that actually
  opens both your pages (`play-games.mjs` never does) — confirmed fresh, both pages pass with
  "no offsite requests refused" and "no page or console errors."
- Locked decision #34: for every guard-rail you add, break the thing on purpose first and watch it
  fail. Round 1's font-fallback assertions passed against a 404'd stylesheet the first time they were
  written, because `document.fonts.check()` returns true for any family with no `@font-face` at all —
  worth remembering if you write new font or asset assertions.

Scheduling note: `npm run games`, `npm run play`, `npm run previews`, and `npm run tools` open real
visible browser windows, and Chrome throttles a window that loses focus. Other threads may be running
them. Only one browser suite at a time.

## Output: your notes file

Write `Claude Prompts/notes/19-schedule-visualizer-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — the next handoff gets assembled
from all twenty-one of these.

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

- **What is in the committed schedule data** — carry forward round 1's answer if nothing changed, or
  say plainly what Devon decided if task one got resolved this session.
- **The versioned-filename decision** — already made; note here only if anything about it needed
  revisiting.
- **Coverage: what I actually read** — of 18,777 lines, what you read, skimmed, and never opened. Build
  on round 1's map rather than restarting it; be honest about what is still unread.
- **What changed** — files touched and why, with paths. **If you changed the generator's template, say
  so explicitly** and say whether you regenerated the output.
- **What I verified** — actual commands, actual output. "Should work" is not verification.
- **Shared-file requests** — anything needing a board or `gvb-save.js` edit, specific enough to apply
  blind.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was wrong,
say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or "robust"
anywhere.
