# Claude Prompts

Twenty-one self-contained prompts, one per project. Each is written to be pasted
into its own Claude Code session with no other context, and each is scoped so that
**all twenty-one can run at the same time without touching the same file.**

Written after session 7 (site version 8). Read `gvb-site-handoff-v7.md` for where
the site stood when these were written.

## The cycle

1. **Run 01–20** in twenty separate chats, in any order, as many at once as you like.
   Each writes one file into `notes/`.
2. **Run 21.** It applies every shared-file request from those twenty notes files, bumps
   the version line, and writes the next handoff. See "Run 21 last" below.
3. **Run 22.** It archives the whole folder into `archive/round-N/`, surveys the repo for
   ground truth, and rewrites the perishable parts of all twenty-one prompts so they
   describe the site as it now is.
4. **Round two**: back to step 1, but only for the prompts 22 says still have work.

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
| 10 | `10-torchbearer.md` | `Projects/torchbearer.html`, `Projects/Torchbearer files/` |
| 11 | `11-absalom-inheritance.md` | `Projects/absalom_inheritance.html` |
| 12 | `12-coffee-shop-sim.md` | `Projects/coffee_shop_sim.html` |
| 13 | `13-daredevil.md` | `Projects/daredevil_r4.html` |
| 14 | `14-integer-foundry.md` | `Projects/integer-foundry.html` |
| 15 | `15-fracture-cycle.md` | `Projects/the-fracture-cycle.html` |
| 16 | `16-final-grade-checker.md` | `Tools/final_grade_checker.html` |
| 17 | `17-image-to-pdf.md` | `Tools/image-to-pdf.html` |
| 18 | `18-name-picker.md` | `Tools/Name Picker.html` |
| 19 | `19-schedule-visualizer.md` | `Tools/Schedule Visualizer and Browser Generator v60.html`, `Tools/Schedule Browser as of 260715.html` |
| 20 | `20-seating-chart-generator.md` | `Tools/Seating Chart Generator.html` |
| 21 | `21-general-site-improvements.md` | `index.html`, `404.html`, `assets/`, `Tools/board-check/` (except `play-castle.mjs`), `CNAME`, the handoff files |
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

Prompt 21 has four tasks it can do immediately and two that need every other thread's notes file to
exist first: applying the shared-file requests, and writing `gvb-site-handoff-v8.md`. It says so
internally and will stop rather than write a handoff from a partial set. Start it whenever, but expect
it to need a second pass at the end.

One consequence to know about: **prompt 21 deletes the Bestiary Gallery, which drops the board from 23
notices to 22.** Every other prompt tells its thread to expect `npm run social:check` to report "23
notices, 23 already current", which is correct until that deletion lands and stale afterwards.
`sync-social-tags.mjs` hard-fails below 20 notices, so 22 is safe — but if you run prompt 21 first, the
other twenty will see 22 and may read it as a regression.

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
are what `gvb-site-handoff-v8.md` gets assembled from.

## Two facts these prompts were written on, which the handoff gets wrong

v7 §5 claims the site makes **zero offsite requests site-wide**. It does not, and
the suite cannot see it:

1. **`prepPage()` in `harness.mjs` fulfills Google Fonts requests locally** from its
   bundled `@fontsource` packages before the blocked-list check runs. Font hotlinks
   are therefore structurally invisible to `page.__blocked`. Fifteen pages still
   hotlink `fonts.googleapis.com`, including four of the seven games the regression
   suite drives, plus `index.html` and `404.html` themselves.
2. **The suites only drive the seven games.** `Tools/creature_artwork_gallery.html`
   makes 3,894 requests to `2e.aonprd.com`; three tools pull jsPDF, autotable, and
   xlsx from `cdnjs.cloudflare.com`. None of it is measured.

Vendoring the fonts is a per-project task, so it is a task in each affected
prompt. Closing the measurement hole is prompt 21's.
