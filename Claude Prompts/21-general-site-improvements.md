# 21 — General Site Improvements

You own the shared infrastructure of greyversusblue.com: the board, the 404 page, the shared save
module, the dev tooling, and the handoff. **Twenty other Claude sessions are working on individual
projects in parallel and none of them may touch any of it** — instead each one writes what it needs
into a notes file, and applying those is your job.

**Read the sequencing section before you start.** Round 1 closed out nearly all of this prompt's
one-off site surgery — the gallery is gone, the offsite-measurement hole is closed, this file's own
fonts are vendored, the save module has been through one full round of reconciled fixes. What's left
for round 2 is smaller and mostly reactive: apply whatever the twenty project threads ask for this
time, pick up one contingent item if another thread makes it possible, and write the next handoff.

## Your boundary

You own these paths:

- `index.html` — the board. The single most contested file in the repo.
- `404.html`
- `newindex.html` — appeared at the repo root during round 1, committed directly by Devon rather than
  through any of the twenty-one prompts. It's linked from a new notice card in `index.html`. Treat it
  as yours by default since it's board-adjacent — see the live-problem note below.
- `assets/js/gvb-save.js` and `assets/js/gvb-save.test.mjs` — the shared save module
- `assets/js/README.md`
- `assets/fonts/**` — the site's own vendored fonts (index.html/404.html), new this round. See
  locked decision #43.
- `assets/previews/**`, `assets/og/**`, and their READMEs — generated artifacts
- `Tools/board-check/**` — **except `play-castle.mjs`, which belongs to prompt 05.** Castle Conundrum
  is its only consumer, so no other thread can conflict with it, and Castle work is unverifiable
  without being able to add beats.
- `CNAME` — still absent (Devon deleted it in an earlier session; the site is mirrored elsewhere now).
  Nothing hardcodes the old arrangement. Leave it absent unless Devon says otherwise.
- `gvb-site-handoff-v9.md` — **which you write this round.** v1 through v8 are history; read them,
  never edit them.
- `Claude Prompts/notes/**` — you read all twenty. You write none of them except your own.

**Everything else is read-only to you.** Every project under `Projects/`, `Pathfinder/` and `Tools/`
belongs to one of the other twenty prompts. If a project needs an internal fix, **it is not yours to
make** — note it in the handoff as backlog for that project's next session.

**`Tools/` is capitalized on purpose** (locked decision #14). Windows hides case differences; git and
GitHub Pages don't.

## Sequencing — read this before you start

**Do now, independent of everyone else:**

- Read every notes file that exists so far, and skim `gvb-site-handoff-v8.md` if you haven't already
  (it's this file's own prior output — you wrote it last round, but read it fresh anyway; you're not
  the same session that wrote it).
- If prompt 10 (Torchbearer) has, this round, committed a real playthrough save under
  `Projects/torchbearer/test/*.torchsave.json` — its own round-1 notes file
  (`Claude Prompts/notes/10-torchbearer-notes.md`) already has both the exact `games.mjs` recipe and
  the exact `play-games.mjs` beats written out, verified by hand against a real browser last round.
  If the fixture exists, this is transcription: add the recipe, run `npm run previews torchbearer`,
  promote it, add the beats. If it doesn't exist yet, leave this for a later round — don't build a
  save file blind, a broken committed fixture is worse than no preview (this is why it was deferred
  twice already).

**Do only after the other twenty threads have finished and their notes files exist:**

- Task one: apply every shared-file request.
- Task two: bump the version line and write `gvb-site-handoff-v9.md`.

If you are running before the others are done, do the Torchbearer check above, then stop and say
clearly in your notes that tasks one and two are outstanding and need a second pass. **Do not write
`gvb-site-handoff-v9.md` from an incomplete set of notes files** — a handoff that claims to summarise
twenty-one sessions but saw six is worse than no handoff, because the next session will trust it.

## A live problem found while refreshing this prompt, not caused by any round-1 session

**`npm run check` and `npm run social:check` are both broken right now, and it's neither of the
twenty projects nor anything round 1 did.** Devon committed directly to the repo while round 1 was
finishing — a new `newindex.html` (554 lines, hotlinks `fonts.googleapis.com`/`fonts.gstatic.com`,
apparently a board redesign in progress) and a change to `index.html` that added
`<a class="notice" href="newindex.html">` and altered the notice markup enough that
`sync-social-tags.mjs` can now only parse 17 notices instead of 22 ("the notice markup has changed
shape, fix the regexes rather than shipping a partial sweep" — it correctly refuses to run a partial
sweep rather than silently mismanaging six pages' `<head>` tags). `npm run check` reports **1
broken** (`newindex.html` references offsite hosts). This is real, current, and squarely in your
boundary (`index.html`, and by extension whatever `newindex.html` is turning into) — put it at the
top of task one below rather than treating the "22 notices, 0 broken" baseline elsewhere in this
prompt as still true without checking. The fresh numbers quoted throughout this file were accurate
at the time this round's refresh ran; this landed afterward.

## Two things to surface prominently in the handoff, not resolve in code

These came out of round 1 and are **Devon's decisions, not code**, and neither touches a file you
own. Your job is to make sure they don't quietly disappear — repeat them near the top of
`gvb-site-handoff-v9.md` exactly as `gvb-site-handoff-v8.md` did, updated only if Devon has actually
decided one of them by the time you write it.

1. **The Final Grade Checker's arithmetic correction (prompt 16, round 1).** A live grading bug — the
   "round up at .5" rule was actually rounding at .45 at every letter boundary — was found and fixed
   last round. If this tool was used on any real report card before that fix landed, some grades in
   the x.45–x.4999 band at a boundary were reported a letter too high. Nobody has said whether that
   needs to go anywhere else. Not your call, not your file.
2. **The committed schedule data (prompt 19, round 1).** `Tools/schedule-browser.html` (published, no
   login) carries real EMS teacher surnames, rooms, and — combined with the floor-plan SVG — which
   block is each teacher's planning period. A school-security question, not a FERPA one. Three
   options were laid out last round (leave it / stop committing it and hand it out as an email
   attachment instead / take the page down). Nothing has changed. Not your call, not your file.

## Required reading

1. This whole file.
2. `Claude Prompts/README.md` — how the twenty-one-way split works and which prompt owns what.
3. **Your own notes file from last round, `Claude Prompts/notes/21-general-site-improvements-notes.md`.**
   It records exactly what round 1 applied and refused, request by request. The archived copies under
   `Claude Prompts/archive/round-1/` hold everything from before that, if you need to trace something
   further back.
4. `gvb-site-handoff-v8.md`, all of it, then §9's locked-decision list (43–50) plus the earlier lists
   it cites: v1 §3, v2 §8, v3 §6, v4 §5, v5 §6, v6 §9, v7's numbered list (36–42). **You are the
   thread most likely to break one of those fifty decisions**, because you own the files they are
   mostly about.
5. `Tools/board-check/README.md`, then `harness.mjs`, `sync-social-tags.mjs`, `check-integrity.mjs`,
   `capture-previews.mjs`, `games.mjs`, `tools.mjs` (new this round — the Tools-page sweep).
6. `assets/js/gvb-save.js` and its test, in full. It went from one adopter to eleven last round and
   picked up five real fixes in the process (§4 of the v8 handoff). Read the adopter table before you
   touch it again.
7. Every `Claude Prompts/notes/*.md` file that exists when you start.

## House rules

- **No build step.** Static files served by GitHub Pages from the repo root at `greyversusblue.com`.
  Plain ES modules, no bundler, no runtime npm dependency. `Tools/board-check` is dev-only and
  gitignores its own dependencies (locked decision #12).
- **The ledger rail is generated from the DOM, never hand-authored** (locked decision #6). Adding or
  removing a card with `data-tags="Sim"` updates the chip counts automatically. Don't hard-code counts.
- **Seal glyphs are per project; ribbon tags are per genre** (locked decision #5). Two different axes
  on purpose. Don't collapse them.
- **`404.html` links are root-absolute** (locked decision #8). Relative links break it on subpaths.
- **`#quest-board .notice { padding-top: 2.15rem }` is load-bearing** (locked decision #10). It is the
  reserved band the corner ornaments live in; removing it reintroduces the overlaps, and
  `check-collisions.mjs` will catch that.
- **Never hand-edit inside the `gvb:social` markers in any page** (locked decision #31). Reword the
  notice in `index.html` and run `npm run social`.
- **The favicon is one shared inline SVG data-URI on every page** (locked decision #32). Leave it alone.
- **A check that only prints is a check that gets ignored** (locked decision #13). Every checker exits
  non-zero. Keep that.
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34). This has caught a
  worthless check twice already in this repo's history — most recently the offsite-measurement fix
  last round, which was verified by adding a font hotlink back and watching the new check fail.
- **Measure before deciding an asset is too heavy** (locked decision #42).
- **Windows is the dev machine** (v7 §7, v6 §5). Absolute `import()` paths need `pathToFileURL`.
- **The site's own fonts (`index.html`, `404.html`) live in shared `assets/fonts/`, not duplicated per
  page** (locked decision #43). This is a deliberate, narrow exception to #17 (each project vendors its
  own copy) — it applies only to the two files that are the site itself, not to any project. Don't
  extend it to a project's request for a shared font folder; that's still #17's territory.
- **`page.__blocked` means "offsite and refused"; `page.__shimmed` means "offsite and fulfilled locally
  instead"** (locked decision #44). A page can report empty `__blocked` and still hotlink Google
  Fonts, because `harness.mjs`'s font shim answers the request before the blocked-list check ever
  sees it. `check-integrity.mjs`'s static source sweep — grepping every `.html` in the repo for
  offsite hosts in tags and CSS `url()`s — is the check that actually scales past what a browser
  suite happens to drive, and it's why the site is at genuinely zero live offsite requests right now
  (confirmed by a fresh repo-wide grep as of this round — the only hits left are historical comments
  saying "this used to hotlink X", not live tags).
- **Faire Weekend: a day is final once the gates close** (locked decision #45). Applies if you ever
  touch anything that reads `Projects/Ren-Faire-Claude/js/main.js`'s save timing — you don't own that
  file, but the principle (persisting a result and locking it against replay are the same action) is
  worth knowing if a similar report-phase question comes up elsewhere.
- **A tool's own version lives in the page, not the filename** (locked decision #46). Schedule Browser
  and Schedule Visualizer both got this treatment last round; if another Tools page ever grows a
  dated or versioned filename, the fix is the same shape and it's a project-owned change, not yours.
- **`gvb-save.js`'s `fresh`/`reset` forward arguments to a `defaults` factory, and `clear()` erases
  without invoking one** (locked decision #47).
- **`gvb-save.js`'s `mountSaveBar` takes `filename` and `labels` overrides, and its import handler
  calls `setState` before writing to storage, vetoable by returning `false`** (locked decision #48).
- **Two storage-construction gaps in `gvb-save.js` are fixed: the construction-time `typeof
  localStorage` throw is guarded, and `load()`'s `getItem` call is wrapped** (locked decision #49).
  Both were the exact scenario the memory fallback exists to survive.
- **`repair` also covers content drift, not just schema drift** (locked decision #50). A data-driven
  project whose save holds one entry per content file will meet saves written before some of that
  content existed. This generalises past the one project (Closing Time) that surfaced it.

## Task one: apply every Shared-file request (after the other twenty finish)

Read all twenty notes files. Each has a **Shared-file requests** section written to be applied
without reading that session. What to expect, based on what round 1 taught about this step:

- **Board card rewordings and `href` changes**, especially from any thread that restructured a
  single-file project into a folder. Round 1 had three of these (Torchbearer, The Absalom
  Inheritance both kept their URLs on purpose; Schedule Visualizer/Browser renamed with redirect
  stubs). Read whether a restructure happened before assuming a board edit is needed — several
  threads found ways to restructure *without* touching the URL, specifically to avoid handing you a
  cross-thread dependency.
- **Requests for new `gvb-save.js` hooks.** Round 1 had five genuine gaps surface from four
  different adopters, no two identical, reconciled into one pass rather than four bolted-on
  workarounds (see locked decisions #47–#50). If round 2 threads ask for more, the same rule
  applies: **reconcile before you implement.** If two threads independently ask for the same shape of
  thing, that's a real gap in the module worth designing once. If only one thread needs it and it's
  narrow, it's still probably fine to add — the module has taken eleven adopters' worth of real
  requests now and stayed small.
- **Regression-suite changes to `play-games.mjs` or `games.mjs`.** Any project whose save timing,
  save-bar location, or reload behaviour changed will need its beats updated to match — round 1's
  Faire Weekend and Fourth Quarter threads both needed small adaptations beyond their own literal
  request text, because the suggested beat sketch didn't quite match what shipped. Expect the same
  this round: apply the spirit of the request, adapt where the actual code doesn't match the sketch,
  and say so in your notes.
- **New preview/OG requests.** As of this round, only Torchbearer lacks a preview/OG pair (see the
  sequencing section above). Everyone else from round 1 has one. A round-2 thread that made a
  first-session-scale change to how a game looks (the way Castle Conundrum and Golden Hour did last
  round) may ask for a recapture — treat that the same as a fresh preview request.
- **`Pathfinder/data/` as a shared interface or not.** If two or more threads raise this again (it's
  been raised independently twice now, by Torchbearer and The Absalom Inheritance, both times
  correctly treated as Devon's call, not code), it's worth surfacing prominently in the handoff again
  rather than letting it go quiet a third time. Still not yours to resolve.

When you touch `gvb-save.js`, `node assets/js/gvb-save.test.mjs` must still pass — currently
**50 passed, 0 failed**, up from 39 last round — and it should grow again if you add anything. Every
project that imports it must still work; you cannot verify that without running their suites, so run
them. Round 1's adopter list, all confirmed clean at the end of that round: The Fourth Quarter,
Aphelion, Torchbearer, The Absalom Inheritance, Daredevil, Integer Foundry, The Fracture Cycle, Name
Picker, Closing Time, Corner & Kettle, Seating Chart Generator. The last two each carry **one test
written on purpose to assert the old, pre-fix behaviour** — both projects' own round-2 task lists
have "invert that one assertion" as an explicit item, so check whether they did it before assuming
it's still an expected failure.

## Task two: version line and handoff (after task one)

- **Bump the version line** in `index.html` from `version 9` to `version 10`
  (`<p class="board-note version">`). Locked decision #9: bump it by one every session.
- **Write `gvb-site-handoff-v9.md`**, assembled from all twenty-one notes files plus your own work.
  Follow the shape of v8: a one-paragraph summary, numbered sections for the things worth reading, a
  backlog-state table, a "things I found and deliberately did not fix" section, a locked-decisions
  section that carries the previous fifty forward and numbers new ones from 51, a suggested-next-
  session list ordered by value per effort, and a "Verified this session" list of actual commands and
  actual counts.

Things that should end up in it, if the round bears them out:

- The two Devon-decision items from the top of this file, repeated near the top of the handoff, not
  buried in a table — unless Devon has actually resolved one by the time you write it, in which case
  say what was decided and drop it from "still open."
- Whatever happened with Torchbearer's preview this round (landed, or still waiting on a fixture).
- Any new locked decisions from 51 onward — candidates: whatever shape a second round's worth of
  `gvb-save.js` requests takes, whatever any restructure decided about a board `href`, whatever came
  of the `Pathfinder/data/` question if Devon weighed in.
- If the Pathfinder Campaigns/Characters merge recommendation (raised independently by both prompts
  02 and 03 in round 1, and reconfirmed by prompt 22's refresh) is something Devon wants to schedule,
  it needs a session with **both** files in scope at once — neither prompt should attempt it solo,
  and it isn't really "General Site Improvements" territory either, since neither file is yours. Worth
  a mention in the handoff as a standing suggestion, not a task you pick up yourself.

## Verification

- `cd Tools/board-check && npm run check` → currently **327–329 units, 0 broken, 0 collisions across
  nine widths, tightest vertical gap 9.2px** (it moves a little run to run as other threads add and
  remove files in parallel; 0 broken is the number that matters, not the exact unit count).
- `npm run social:check` → currently **22 notices, 22 already current, 0 out of date, 0 failed**.
- `node assets/js/gvb-save.test.mjs` → currently **50 passed, 0 failed**.
- `npm run tools` → currently **18 checks, 0 failed** (sweeps all six Tools pages: offsite requests,
  console errors, non-empty title).
- `npm run games` → currently **126 checks, 0 failed**. `npm run play` → **29 beats** (Castle
  Conundrum, owned by prompt 05).
- `npm run previews` → confirm whichever games you touched still reach gameplay, 0 failed.
- Every project suite whose files you touched through a shared-file request. As of this round that
  potentially includes all eleven `gvb-save.js` adopters listed in task one — run each project's own
  Node suite, not just `gvb-save.test.mjs`.
- **Confirm zero live offsite requests, repo-wide**, as a final check before writing the handoff:
  `grep -rl "fonts.googleapis.com\|fonts.gstatic.com\|cdnjs.cloudflare.com\|cdn.jsdelivr.net" --include=*.html . | grep -v node_modules`
  should return only files where the only hits are inside HTML comments describing history, not live
  tags. That was true as of the start of this round; confirm it's still true at the end.
- **Locked decision #34**, on anything you touch in `gvb-save.js` or `check-integrity.mjs`: break it
  on purpose, watch it fail, fix it, watch it pass.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window nobody is looking at (v7 §6). Other threads may be running
these suites; only one at a time. If a frame-motion assertion fails once and passes on retry, that is
what happened, not a regression.

## Output: your notes file

Write `Claude Prompts/notes/21-general-site-improvements-notes.md` **as well as**
`gvb-site-handoff-v9.md`. The notes file records what you did; the handoff records what the whole
batch did.

Use these headings:

```
# General Site Improvements — session notes

## What changed
## What I verified
## Requests applied, and requests refused
## Deliberately not done
## Next session
```

**List every request from every notes file and say what happened to it.** A request you declined is
fine and often correct, but a request that silently vanished leaves a project thread believing
something shipped that didn't. If you refuse one, say so and say why, so it lands in that project's
next-session backlog instead of being lost.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Sections are allowed to be opinionated and to say
"I looked at this and left it, here's why". Match that — **you are writing the next one, so this
matters more for you than for anyone else in the batch.** Do not write "comprehensive" or "robust"
anywhere.
