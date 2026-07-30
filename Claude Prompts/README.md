# Claude Prompts

Twenty-one self-contained prompts, one per project. Each is written to be pasted
into its own Claude Code session with no other context, and each is scoped so that
**all twenty-one can run at the same time without touching the same file.**

Originally written after session 7 (site version 8). Round 1 (prompts 01–21, all twenty-one) has
since completed, prompt 22 refreshed all twenty-one against the round-1 result, and the site is now
at version 9 with `gvb-site-handoff-v8.md` as its current handoff. Read that file, not v7, for where
the site actually stands. See "Rounds so far" below for what round 1 shipped.

## The cycle

1. **Run 01–20** in twenty separate chats, in any order, as many at once as you like.
   Each writes one file into `notes/`.
2. **Run 21.** It applies every shared-file request from those twenty notes files, bumps
   the version line, and writes the next handoff. See "Run 21 last" below.
3. **Run 22.** It archives the whole folder into `archive/round-N/`, surveys the repo for
   ground truth, and rewrites the perishable parts of all twenty-one prompts so they
   describe the site as it now is.
4. **Round two (and beyond)**: back to step 1, but only for the prompts that still have work — prompt
   22's refresh marks a project clearly at the top of its own prompt if there's nothing outstanding,
   and lists the still-pending and droppable projects in its own notes file each round.

Prompt 22 is the piece that makes this repeatable. Without it, round two's threads get
told to vendor fonts that are already vendored and to expect counts that have moved.

## The files

| # | Prompt | Owns |
| --- | --- | --- |
| 01 | `01-anathema-archive.md` | `Pathfinder/Anathema_Archive.html`, `Pathfinder/data/`, `Pathfinder/fetch json data.py` |
| 02 | `02-pathfinder-campaigns.md` | `Pathfinder/campaigns.html` |
| 03 | `03-pathfinder-characters.md` | `Pathfinder/characters.html` |
| 04 | `04-aphelion.md` | `Projects/aphelion/` |
| 05 | `05-castle-conundrum.md` | `Projects/Castle Conundrum/`, `Tools/board-check/play-castle.mjs` |
| 06 | `06-closing-time.md` | `Projects/Closing Time/` |
| 07 | `07-fourth-quarter.md` | `Projects/fourth-quarter/` |
| 08 | `08-golden-hour.md` | `Projects/golden-hour-beach/` |
| 09 | `09-faire-weekend.md` | `Projects/Ren-Faire-Claude/` |
| 10 | `10-torchbearer.md` | `Projects/torchbearer.html`, `Projects/torchbearer/` (renamed from `Projects/Torchbearer files/` in round 1) |
| 11 | `11-absalom-inheritance.md` | `Projects/absalom_inheritance.html` |
| 12 | `12-coffee-shop-sim.md` | `Projects/coffee_shop_sim.html` |
| 13 | `13-daredevil.md` | `Projects/daredevil_r4.html` |
| 14 | `14-integer-foundry.md` | `Projects/integer-foundry.html` |
| 15 | `15-fracture-cycle.md` | `Projects/the-fracture-cycle.html` |
| 16 | `16-final-grade-checker.md` | `Tools/final_grade_checker.html` |
| 17 | `17-image-to-pdf.md` | `Tools/image-to-pdf.html` |
| 18 | `18-name-picker.md` | `Tools/Name Picker.html` |
| 19 | `19-schedule-visualizer.md` | `Tools/schedule-visualizer.html`, `Tools/schedule-browser.html` (renamed in round 1 from `Tools/Schedule Visualizer and Browser Generator v60.html` / `Tools/Schedule Browser as of 260715.html`; the old paths survive as tiny redirect stubs) |
| 20 | `20-seating-chart-generator.md` | `Tools/Seating Chart Generator.html` |
| 21 | `21-general-site-improvements.md` | `index.html`, `404.html`, `assets/` (including `assets/fonts/`, new in round 1 — see locked decision #43), `Tools/board-check/` (except `play-castle.mjs`), `CNAME`, the handoff files |
| 22 | `22-refresh-prompts.md` | `Claude Prompts/**` only. Not a project — it refreshes the other twenty-one between rounds. Read-only everywhere else in the repo. |

## How the parallel safety works

Every prompt names the paths it owns and declares the rest of the repo read-only.
The four genuinely shared things — `index.html`, `assets/js/gvb-save.js`,
`Tools/board-check/**`, and the generated `assets/previews` + `assets/og` — belong to
prompt 21 and nobody else.

When a project thread needs one of those changed, it does not change it. It writes
the exact edit into a **Shared-file requests** section of its own notes file, and
prompt 21 applies them all in one pass at the end.

Two refinements worth knowing:

- **`Tools/board-check/play-castle.mjs` belongs to prompt 05**, not 21. Castle
  Conundrum is its only consumer, so no other thread can conflict with it, and
  Castle work is unverifiable without being able to add beats to it.
- **A project owns its own test suite** (`Projects/fourth-quarter/test/`,
  `Projects/Closing Time/tools/smoke.mjs`, `Projects/Ren-Faire-Claude/tests/`).
  Those are per-project files that happen to be Node scripts.

## Run 21 last

As of round 2, prompt 21's own one-off site surgery (the four "do now" tasks from round 1) is done —
the Bestiary Gallery is gone, the offsite-measurement hole is closed, `index.html`/`404.html`'s own
fonts are vendored, the 404 page and board were reviewed. What's left is the two tasks that need every
other thread's notes file to exist first: applying the shared-file requests, and writing the next
handoff. Prompt 21's own file says so internally and will stop rather than write a handoff from a
partial set. Start it whenever, but expect it to need a second pass at the end.

**The board is at 22 notices, not 23**, since round 1's Bestiary Gallery deletion. This is settled now
— every current prompt already says 22, and `npm run social:check` should confirm 22 of 22 current at
the start of any new round. `sync-social-tags.mjs` hard-fails below 20 notices, so 22 is comfortably
safe as a floor.

## Running the shared browser suites in parallel — don't

`npm run games`, `npm run play`, and `npm run previews` all open **real, visible
browser windows**, and v7 §6 is about how Chrome throttles a window that loses
focus. Two of these running at once will steal focus from each other and produce
frame-motion and walk failures that look exactly like bugs. Any thread may run
them, but only one thread at a time. Prefer your project's own Node suite for
iteration and save the browser suites for the end.

## Notes files

Each thread writes exactly one file into `Claude Prompts/notes/`, named after its
prompt. Nobody else writes that file, so it never conflicts. Those twenty-one files
are what each round's handoff (`gvb-site-handoff-v8.md` as of round 1) gets assembled from.
Round 1's versions of all twenty-one are preserved under `Claude Prompts/archive/round-1/notes/`,
since round 2's threads overwrite these same filenames.

## Two facts these prompts were originally written on — both now fixed

This section was true when these prompts were first written (session 7, site version 8) and is kept
here as history rather than deleted, per the site's own house rule about correcting rather than
erasing a wrong claim. Both are now fixed, in round 1:

1. **v7 §5 claimed the site made zero offsite requests site-wide. It did not**, and the suite
   couldn't see it: `prepPage()` in `harness.mjs` fulfills Google Fonts requests locally from bundled
   `@fontsource` packages before the blocked-list check runs, so a font hotlink never reached
   `page.__blocked`. **Fixed in round 1**: `harness.mjs` now also records every URL it fulfilled this
   way in `page.__shimmed`, kept separate from `page.__blocked` (locked decision #44), and
   `check-integrity.mjs` gained a static source sweep — a grep across every `.html` in the repo for
   offsite hosts in tags and CSS `url()`s — that catches this without needing a browser at all. As of
   the round-2 refresh, a fresh repo-wide grep confirms genuinely zero live offsite requests remain
   anywhere in the site (the only hits are historical comments saying what used to be hotlinked).
2. **The regression suites only drove the seven games.** `Tools/creature_artwork_gallery.html` made
   3,894 requests to `2e.aonprd.com` — the site's largest offsite dependency by three orders of
   magnitude — and no suite ever opened it or any Tools/Pathfinder page. **Fixed in round 1**: the
   Bestiary Gallery is deleted entirely (board dropped from 23 to 22 notices), and a new
   `Tools/board-check/tools.mjs` (`npm run tools`) sweeps all six Tools pages for offsite requests,
   console errors, and a real title — 18 checks, 0 failed.

## Rounds so far

- **Round 1** (prompts 01–21, all twenty-one; site started at version 8, ended at version 9). Covered
  every project in the repo for the first time. Headline finds: Daredevil had never been completable
  by anyone, ever, due to 5 independent wiring bugs (now fixed); The Absalom Inheritance was
  completely unwinnable, 0 wins in 2000 simulated runs (now 59.3%); Final Grade Checker had a live
  grading-arithmetic bug that reported some real students a letter grade too high (now fixed — see
  the Devon-decision note in prompt 21 about whether this needs to go anywhere else); `gvb-save.js`
  went from one adopter to eleven and picked up five reconciled fixes; the site's offsite-request
  measurement hole (above) closed; a possible school-security exposure in committed schedule data was
  found and flagged, not resolved (Devon's call). Full summary: `Claude Prompts/archive/round-1/README.md`.
- **Round 2**: in progress. See each prompt's own task list — prompt 22's refresh marks a project
  clearly at the top of its own file if there's nothing outstanding from round 1 (The Fracture Cycle
  is the first one flagged this way).
