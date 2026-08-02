# Claude Prompts

Twenty-two self-contained prompts, one per project. Each is written to be pasted
into its own Claude Code session with no other context, and each is scoped so that
**all twenty-two can run at the same time without touching the same file.**

Originally written after session 7 (site version 8). Round 1 (prompts 01–21) and round 2
(prompts 01–21 again) have both completed. Prompt 23 has refreshed all twenty-two prompts
against round 2's result. The site is now at **version 10** with `gvb-site-handoff-v9.md` as
its current handoff. Read that file, not v8 or earlier, for where the site actually stands.
See "Rounds so far" below for what each round shipped.

## The `Stable/` folder, new this round

A project prompt with genuinely nothing outstanding moves to `Claude Prompts/Stable/`, keeping
its exact filename. This is **not** the same thing as `archive/round-N/`:

- **`Stable/`** holds a *live* prompt that's still correct and still gets re-surveyed by every
  future prompt-23 refresh. If a real change turns up later (a shared dependency shifts, Devon
  wants to expand scope, a regression appears), the file moves back to the live folder with a
  real task list again.
- **`archive/round-N/`** holds a *frozen snapshot* of a past round — never re-read as a live
  prompt, only consulted for history.

As of this refresh, `Claude Prompts/Stable/` holds **01 (Anathema Archive)** and **15 (The
Fracture Cycle)** — both verified to have nothing outstanding as of round 2, both explicitly
re-checked against the live repo rather than just trusting their own prior claim.

## Questions for Devon, tracked in-prompt

Some prompts now carry a **"Questions for Devon"** block near the top — a genuine open decision
(a design call, a policy fact, a scope choice) that only Devon can answer, phrased as a direct
question. This is the durable home for that kind of open item now, replacing the older pattern
of burying it in a task description or only mentioning it in the handoff. As of this refresh:

- **01** (Anathema Archive) — whether `Pathfinder/data/` is a published interface or private.
- **07** (The Fourth Quarter) — whether the night loop should have a day-based difficulty curve.
- **16** (Final Grade Checker) — whether any real report card graded in a specific window needs
  revisiting, and whether the QP threshold spacing matches the real written policy.
- **19** (Schedule Visualizer) — how storage quota should be handled for `gvb-save.js` adoption.

When Devon answers one, prompt 23's next refresh removes it from the block and records the
decision in the prompt's durable section (or as a new locked decision in the next handoff).

## The cycle

1. **Run 01–21** (skipping anything currently in `Stable/` unless Devon wants to reopen it) in
   separate chats, in any order, as many at once as you like. Each writes one file into `notes/`.
2. **Run 22.** It applies every shared-file request from those notes files, bumps the version
   line, and writes the next handoff. See "Run 22 last" below.
3. **Run 23.** It archives the whole folder into `archive/round-N/`, surveys the repo for
   ground truth, and rewrites the perishable parts of all twenty-two prompts — including moving
   projects into or out of `Stable/` and updating "Questions for Devon" blocks.
4. **Round N+1**: back to step 1.

Prompt 23 is the piece that makes this repeatable. Without it, the next round's threads get
told to vendor fonts that are already vendored and to expect counts that have moved.

## The files

| # | Prompt | Owns |
| --- | --- | --- |
| 01 | `Stable/01-anathema-archive.md` | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py`, `Pathfinder/tests/`. **In `Stable/`** — nothing outstanding as of round 2. |
| 02 | `02-pathfinder-campaigns.md` | `Pathfinder/campaigns.html`, `Pathfinder/campaigns-assets/` |
| 03 | `03-pathfinder-characters.md` | `Pathfinder/characters.html`, `Pathfinder/characters-assets/` |
| 04 | `04-aphelion.md` | `Projects/aphelion/` |
| 05 | `05-castle-conundrum.md` | `Projects/Castle Conundrum/`, `Tools/board-check/play-castle.mjs` |
| 06 | `06-closing-time.md` | `Projects/Closing Time/` |
| 07 | `07-fourth-quarter.md` | `Projects/fourth-quarter/` |
| 08 | `08-golden-hour.md` | `Projects/golden-hour-beach/` |
| 09 | `09-faire-weekend.md` | `Projects/Ren-Faire-Claude/` |
| 10 | `10-torchbearer.md` | `Projects/torchbearer.html`, `Projects/torchbearer/` |
| 11 | `11-absalom-inheritance.md` | `Projects/absalom_inheritance.html` (shell, URL unchanged), `Projects/absalom-inheritance/` (the real logic, restructured round 1) |
| 12 | `12-coffee-shop-sim.md` | `Projects/coffee_shop_sim.html`, `Projects/corner-and-kettle/` |
| 13 | `13-daredevil.md` | `Projects/daredevil/` (the real game, restructured round 2 from the old single-file `Projects/daredevil_r4.html`, now a redirect stub) |
| 14 | `14-integer-foundry.md` | `Projects/integer-foundry.html`, `Projects/integer-foundry/` |
| 15 | `Stable/15-fracture-cycle.md` | `Projects/the-fracture-cycle.html`, `Projects/the-fracture-cycle/`. **In `Stable/`** — nothing outstanding for two rounds running. |
| 16 | `16-final-grade-checker.md` | `Tools/final_grade_checker.html`, `Tools/final-grade-checker/` |
| 17 | `17-image-to-pdf.md` | `Tools/image-to-pdf.html`, `Tools/image-to-pdf/` |
| 18 | `18-name-picker.md` | `Tools/Name Picker.html`, `Tools/name-picker/` |
| 19 | `19-schedule-visualizer.md` | `Tools/schedule-visualizer.html`, `Tools/schedule-browser.html` (both renamed in round 1; old dated/spaced paths survive as redirect stubs), `Tools/schedule/` |
| 20 | `20-seating-chart-generator.md` | `Tools/Seating Chart Generator.html`, `Tools/seating-chart/` |
| 21 | `21-orbital.md` | `Projects/orbital/` — merged directly to `main` outside the normal process (PR #6); this is its first prompt, first round |
| 22 | `22-general-site-improvements.md` | `index.html`, `404.html`, `newindex.html` (see locked decision #51), `assets/` (including `assets/fonts/`), `Tools/board-check/` (except `play-castle.mjs` and any project's own test folder), `CNAME`, the handoff files |
| 23 | `23-refresh-prompts.md` | `Claude Prompts/**` only. Not a project — it refreshes the other twenty-two between rounds. Read-only everywhere else in the repo. |

## How the parallel safety works

Every prompt names the paths it owns and declares the rest of the repo read-only.
The four genuinely shared things — `index.html`, `assets/js/gvb-save.js`,
`Tools/board-check/**`, and the generated `assets/previews` + `assets/og` — belong to
prompt 22 and nobody else.

When a project thread needs one of those changed, it does not change it. It writes
the exact edit into a **Shared-file requests** section of its own notes file, and
prompt 22 applies them all in one pass at the end.

Two refinements worth knowing:

- **`Tools/board-check/play-castle.mjs` belongs to prompt 05**, not 22. Castle
  Conundrum is its only consumer, so no other thread can conflict with it, and
  Castle work is unverifiable without being able to add beats to it.
- **A project owns its own test suite**, including a browser-driven one that imports
  `Tools/board-check/harness.mjs`/`drive.mjs` read-only
  (`Projects/fourth-quarter/test/`, `Tools/name-picker/test/browser.mjs`,
  `Tools/seating-chart/test/drive-seating.mjs`, `Projects/integer-foundry/test/browser.mjs`, and
  others). Those are per-project files even though they drive a browser the same way prompt 22's
  own tooling does — **this matters concretely as of round 2**: a `puppeteer-core` compatibility
  bug (see below) was fixed across every file prompt 22 owns, but the identical bug still exists
  in at least three project-owned test files, because they're outside prompt 22's boundary. Each
  is now its own project's task one.

## Run 22 last

As of round 2, prompt 22 ran twice — a first pass that correctly stopped after only nine of
twenty project threads had posted notes, and a full pass once all twenty existed. The full pass
fixed a live site-wide breakage (`newindex.html`'s offsite font hotlinks, `sync-social-tags.mjs`'s
stale notice-count floor — both introduced by a direct commit outside the prompt process, neither
caused by any of the twenty threads), fixed a `puppeteer-core` incompatibility that had broken
`npm run games` for every game all round, applied every shared-file request, and wrote the next
handoff. **Prompt 22's own file will stop rather than write a handoff from a partial set of notes
files** — this is by design, not a bug, and it happened exactly this way in round 2.

**The board is at 17 notices, not 22.** Devon consolidated six standalone Tools notices (Name
Picker, Seating Chart Generator, Schedule Browser, Schedule Visualizer, Final Grade Checker,
Image → PDF) into one "School Tools" card this round — a real, correct drop, not a regression.
`sync-social-tags.mjs`'s hard-fail floor was lowered from 20 to 15 to match (same two-notice
buffer, relative to the new count).

## Running the shared browser suites in parallel — don't

`npm run games`, `npm run play`, and `npm run previews` all open **real, visible
browser windows**, and v7 §6 is about how Chrome throttles a window that loses
focus. Two of these running at once will steal focus from each other and produce
frame-motion and walk failures that look exactly like bugs. Any thread may run
them, but only one thread at a time. Prefer your project's own Node suite for
iteration and save the browser suites for the end.

**A second, separate limitation found in round 2, worth knowing on top of the above**: this
environment's forced Linux/software-rendered Chromium runs three.js real-time movement far
slower and less consistently than the games' own physics assume (locked decision #53) — even
with no focus-throttling in play. Treat a real-time movement or physics assertion failing here as
inconclusive, not confirmed, and re-verify from a machine with real GPU compositing (Windows,
per earlier locked decisions) before trusting either a pass or a fail.

## Notes files

Each thread writes exactly one file into `Claude Prompts/notes/`, named after its
prompt. Nobody else writes that file, so it never conflicts. Those twenty-two files
are what each round's handoff (`gvb-site-handoff-v9.md` as of round 2) gets assembled from.
Round 1's versions are preserved under `Claude Prompts/archive/round-1/notes/`, and round 2's
under `Claude Prompts/archive/round-2/notes/`, since each new round's threads overwrite these
same filenames.

## Two facts these prompts were originally written on — both now fixed

This section was true when these prompts were first written (session 7, site version 8) and is
kept here as history rather than deleted. Both are now fixed, in round 1, and re-confirmed clean
in round 2:

1. **v7 §5 claimed the site made zero offsite requests site-wide. It did not**, and the suite
   couldn't see it. **Fixed in round 1** (`page.__shimmed`, `check-integrity.mjs`'s static
   source sweep — locked decision #44). As of round 2's refresh, a fresh repo-wide grep confirms
   genuinely zero live offsite requests remain anywhere in the site — including `newindex.html`,
   which briefly reintroduced a hotlink mid-round-2 via a direct commit and was fixed by prompt 22
   (locked decision #51).
2. **The regression suites only drove the seven games.** **Fixed in round 1** — the Bestiary
   Gallery (3,894 offsite requests, the site's largest by three orders of magnitude) is deleted,
   and `npm run tools` sweeps all six Tools pages.

## Rounds so far

- **Round 1** (prompts 01–21; site started at version 8, ended at version 9).
  Covered every project for the first time. Headline finds: Daredevil had never been completable
  by anyone due to 5 wiring bugs (fixed); The Absalom Inheritance was completely unwinnable, 0
  wins in 2000 runs (fixed, 59.3%); Final Grade Checker had a live grading bug (fixed); `gvb-save.js`
  went from one adopter to eleven. Full summary: `Claude Prompts/archive/round-1/README.md`.
- **Round 2** (prompts 01–21 again; site started at version 9, ended at version 10). Every one of
  the twenty project threads shipped real work — see `Claude Prompts/archive/round-2/README.md`
  for a one-line summary per project. Headline finds: a second real grading bug in Final Grade
  Checker (quality points don't round at .5 the way percentages do); a stall bug in The Absalom
  Inheritance's new second area that only a few thousand seeded balance runs would have caught;
  Daredevil's restructure into a real module layout, finally safe now that a full regression
  suite existed to prove nothing broke; a repo-wide `puppeteer-core` incompatibility that broke
  `npm run games` for every game, found independently by three threads and fixed once; a live
  site-wide breakage introduced by a direct commit outside the prompt process, found and fixed.
  Three long-standing recurring questions were resolved by Devon this round: the Pathfinder
  Campaigns/Characters merge (harmonize, don't share), the committed schedule data (leave it), and
  the Final Grade Checker's rounding rule (percentage rounds at .5, quality points don't). Two
  projects (01, 15) moved to `Claude Prompts/Stable/` with nothing outstanding. This refresh also
  re-ran the whole suite on a fair (real Chrome/Playwright) environment rather than the Linux
  sandbox the round itself used, which resolved several things round 2 had correctly left as
  "needs a fair environment to know for sure" — see `Claude Prompts/notes/23-refresh-prompts-notes.md`
  for the full account, including two real (non-environment) bugs found in shared test tooling.
  Full summary: `Claude Prompts/archive/round-2/README.md`.
- **Orbital joined the rotation, and the whole numbering shifted to make room for it.** `Projects/orbital/`
  merged directly to `main` (PR #6) mid-refresh, after this refresh's own survey had already run.
  Devon's call: give it a real prompt rather than a stopgap. It's now `21-orbital.md` — first round,
  no notes file yet. General Site Improvements moved from 21 to 22, and the refresh prompt moved
  from 22 to 23 to make room. Every prompt's boundary-table references to these two files are
  current as of this renumbering; if you see a stale "Prompt 21" meaning General Site Improvements
  or "prompt 22" meaning the refresh process anywhere outside `archive/` or a notes file, that's a
  miss worth fixing. Board notice count is 18 now, not 17, from Orbital's own new card.
