# Refresh — round 3 notes

## Where the notes and the repository disagreed

- **The Fourth Quarter (07).** Its own round-3 notes describe the Real Estate walk-to-station
  beat as still blocked on a shared-tooling fix ("not something I can apply inside my boundary")
  and its prompt file's own "Questions for Devon" block (the difficulty-curve question) still read
  as open. Both were stale by the time this refresh ran: the difficulty question was answered
  directly this same round (spoilage, built — confirmed in `campaign.js`/`day.js`), and prompt
  22's `walkTo({steer:'lookAt'})` fix landed in `Tools/board-check/drive.mjs`/`play-games.mjs`
  *after* 07's own notes were written, confirmed present by direct code read. Neither is a false
  claim by the 07 session — both were true when written — but a thread reading only 07's own
  prompt/notes without cross-checking the shared-tooling files or the handoff would have re-flagged
  both as open. Fixed in the refresh.
- **Pathfinder Campaigns and Characters (02, 03).** Both sessions' own notes framed this round as
  "the third clean round running" or similar, implying three rounds of nothing-to-do. Checked
  against round 1 and round 2's actual archived notes: both of those rounds did real, substantive
  work (font vendoring, ARIA/contrast fixes round 1; the `[shared]`-marker guardrail and a real
  `</style>`-truncation bug fix round 2). Round 3 is genuinely the *first* clean, edit-free round
  for both pages, not the third. Corrected in both prompts, with a "Questions for Devon" block
  added asking whether one clean round (Anathema Archive's bar) or two (Fracture Cycle's bar) is
  the actual threshold for `Stable/`, since the notes' framing doesn't resolve that on its own.
- **Schedule Visualizer (19).** Its own round-3 notes list `check-integrity.mjs`'s `.js`/`.css`
  sweep extension as a still-open "Shared-file requests" item. It was already done — confirmed
  directly by reading `check-integrity.mjs` (the sweep exists, with a comment citing this
  project's own finding) and by running `npm run check` (559 units, up from the notes' own 360).
  Applied by another thread (prompt 22) within the same round, after 19's notes were written.
  Corrected in the prompt; no longer listed as open.
- **Aphelion (04).** Notes cited "10 assertions" for this project's own block in
  `Tools/board-check/play-games.mjs`; direct count is 9, matching the prompt file's own
  longstanding figure. Also cited that block as living at lines 541-602; it's currently at
  569-629 (a ~28-line shift from other threads editing earlier parts of the same shared file after
  Aphelion's own notes were written). Both are minor and don't change the substance (no EVA/airlock
  cycling exists in that block either way) — noted here for completeness, not worth a prompt-file
  correction beyond what's already accurate.
- **Final Grade Checker (16).** Notes estimated `grade-math.mjs` at "217 to 224 lines" and
  `grade-math.test.mjs` at "303 to 335 lines"; actual counts are 231 and 339 respectively. The
  assertion count (139) and the substance (whole-point QP thresholds) are correct — only the line
  estimates were off. Corrected in the prompt.
- **Name Picker (18).** Prompt's own boundary section claimed 2,070 lines; actual is 2,052 (a
  pre-existing staleness the round-3 session's own zero-net-change diff didn't cause). Separately,
  `np-store.js`'s own header comment says "the Name Picker's twelve storage keys," but the real,
  correct count — confirmed by the `KEYS` array and stated correctly everywhere else (README,
  prompt, notes) — is thirteen. Both corrected/flagged in the prompt; the header-comment fix itself
  is a one-line task-list item, not something this refresh could fix (out of boundary).
- **Seating Chart Generator (20).** An earlier prompt draft cited `test/drive-seating.mjs` at 108
  checks; a fresh run (and the round-3 session's own count) shows 111. Corrected.

## Fresh numbers

| Check | Previous figure | Current figure |
| --- | --- | --- |
| `npm run check` (units / broken) | 335 units, 0 broken | 559 units, 0 broken (moves every round as files are added; 0 broken is what matters) |
| `npm run check` (collision gap) | 3.5px | 9.1px |
| `npm run social:check` | 17 notices, 17 current | 18 notices, 18 current (Orbital's card joined) |
| `node assets/js/gvb-save.test.mjs` | 50 passed | 50 passed (unchanged) |
| `npm run tools` | 18 checks | 18 checks (unchanged) |
| `npm run games` (fair environment) | 137 checks, 3 failed | 146 checks, 0 failed (three independent runs, identical — first fully clean pass ever reported) |
| Site version / current handoff | version 10 / v9 | version 11 / v10 |
| Pathfinder Campaigns / Characters | 751 / 730 lines | unchanged, zero edits either round-3 session |
| Aphelion `index.html` | 213 lines (prompt's stale claim) | 214 lines |
| Castle Conundrum `npm run play` | 32 beats | 34 beats, 0 failed (independently re-run this refresh) |
| Closing Time `tools/smoke.mjs` | 100 passed | 105 passed |
| The Fourth Quarter `smoke-campaign.mjs` | 196 passed | 203 passed |
| Golden Hour `test/smoke.mjs` | 38 checks | 38 checks (unchanged; round 3 touched dune grass, not the wading math) |
| Faire Weekend `tests/smoke.mjs` | 783 passed | 801 passed |
| Torchbearer `torchbearer.html` | 3,280 lines (stale) | 3,268 lines |
| The Absalom Inheritance `test/smoke.mjs` / balance | 281 passed / Wizard 53.6% only | 308 passed / Wizard 53.6%, Fighter 79.8% |
| Coffee Shop Sim `coffee_shop_sim.html` | 2,562 lines (stale) | 2,542 lines |
| Daredevil test suites | 53/53, 44/44 | unchanged counts, new coverage (touch-emulation, two more relationship sweeps) |
| Integer Foundry `test/browser.mjs` | aborting on engine-mismatch bug | 56 checks, 0 failed |
| Final Grade Checker `grade-math.test.mjs` | 130 passed | 139 passed |
| Image to PDF | no code changes | unchanged, re-verified fresh |
| Name Picker `test/browser.mjs` | aborting on engine-mismatch bug | 44 checks, 0 failed |
| Schedule Visualizer/Browser | 863,737 / 161,074 bytes | 124,566 / 164,349 bytes (restructured into `Tools/schedule/app/`, ~594 KB `.js` + 156 KB `.css`) |
| Schedule Visualizer `smoke.mjs` | 67 passed | 73 passed, plus new `structure.mjs` (31 passed) |
| Seating Chart `smoke-seating.mjs` / `drive-seating.mjs` | 153 / 108 (stale) | 153 / 111 |
| Orbital | no test suite, no preview/OG, 21 levels claimed | `test/physics.mjs` (22 levels, all winnable), preview/OG live, 22 levels confirmed (pack-02 has 12, not 11) |

## What I changed in each prompt

- **02, 03 (Pathfinder Campaigns/Characters)** — added a "Questions for Devon" block on the
  one-clean-round-vs-two question (see disagreements above); refreshed handoff citations and
  repo-wide counts.
- **04 (Aphelion)** — refreshed line count, handoff citations, added locked decisions #55/#56
  relevance (this project is one of the three `walkTo({steer:'lookAt'})` was built for), updated
  `npm run games` figure to the clean 146/146 result.
- **05 (Castle Conundrum)** — rewrote "What is actually here" and the task list from scratch: all
  four of this round's tasks (wall-embedded furniture, preview promotion, engine-mismatch fix, gate
  pivot fix) are closed, independently re-verified this refresh (`npm run play` → 34/34). Added two
  new project-specific rules (rotated-piece bounding boxes, furniture-vs-wall clearance checks).
  Replaced the two remaining tasks with the genuinely cosmetic items round 3's own notes left open.
- **06 (Closing Time)** — both of round 2's open items (exact `recId` filter, career-ending
  "what's next") closed this round; refreshed counts and flagged the previously-empty `js/ui/`
  folder as a placeholder, not a stale reference.
- **07 (The Fourth Quarter)** — removed the stale "Questions for Devon" block (answered: spoilage),
  documented the spoilage mechanic, corrected the walkTo/steer fix's status (landed after this
  project's own notes were written — see disagreements), rewrote the task list.
- **08 (Golden Hour)** — documented the dune-grass fix, corrected the wading-beat fix's status
  (it's `play-games.mjs`'s fix, landed this round, not this project's own code), dropped the
  low-end-GPU and wildlife-tuning items' framing to reflect what's actually left.
- **09 (Faire Weekend)** — documented the mobile-tap-target fix and the `cancelMove` wiring gap
  found even after the audit was called closed; updated the layout-review backlog item's age from
  three to four rounds.
- **10 (Torchbearer)** — documented all three feature items shipped (edge-outwit, Feint, reload)
  and the `mountSaveBar` cleanup; rewrote the task list down to the one genuinely blocked item
  (`mobility`) plus a small comment fix.
- **11 (The Absalom Inheritance)** — documented the character-creation pick screen and the second
  build (Fighter); promoted Reactions (Shield Block, AoO) to the new task one.
- **12 (Coffee Shop Sim)** — documented the `drive-save.mjs` engine-mismatch fix; added a
  "Questions for Devon" block on the Serve-button early-enable gate, the real design question this
  round's measurement surfaced.
- **13 (Daredevil)** — documented all four closed items (gzip, absent-relationship sweep, touch
  verification, contrast) and added the Earl/"Not interested" finding as this project's — and the
  site's — headline "Questions for Devon" item.
- **14 (Integer Foundry)** — moved to `Stable/`. Documented the engine-mismatch fix and the
  coupled-not-two-separate-gaps argument for the remaining model-gap backlog item.
- **16 (Final Grade Checker)** — the biggest single content rewrite this round: replaced the
  entire "rules this tool implements" section (thresholds are whole numbers 4/3/2/1/0, not
  `.5`-offset midpoints), rewrote the "Questions for Devon" block to reflect the larger-than-expected
  historical window, corrected stale line counts.
- **17 (Image to PDF)** — moved to `Stable/`. No code changes this round; documented the
  re-verification and the two environment-blocked (not code) items keeping it off a fully-closed
  state.
- **18 (Name Picker)** — documented the engine-mismatch fix; added a "Questions for Devon" block
  (mirrored in 22) on the rename now targeting `newindex.html`; flagged the stale "twelve keys"
  comment in `np-store.js`.
- **19 (Schedule Visualizer)** — the second-biggest rewrite: documented the full restructure
  (863,737 → 124,566-byte shell plus seven `app/` files), the What-If Lab and `.rcell`/`.geo-room`
  reads (both closed, not restructure candidates), and the `gvb:social` publish-drift mechanism.
- **20 (Seating Chart Generator)** — documented the rotated-label fix and all three Playwright-only
  bugs (one previously unflagged); this is the first refresh with nothing carried over from this
  project's own work.
- **21 (Orbital)** — full fresh rewrite now that it has a real notes file: documented the physics
  test suite, the reset-confirmation fix, the preview/OG, and corrected the level count (22, not 21;
  pack-02 has 12, not 11).
- **22 (General Site Improvements)** — replaced all of round 2's now-historical narrative sections
  with round 3's: the cross-cutting bug class (closed), the two fair-environment bug fixes, the
  CRLF false-DRIFT root cause and fix, the `.js`/`.css` sweep extension. Added a "Questions for
  Devon" block on the Name Picker rename (mirrored in 18). Added locked decisions #54-58 to house
  rules. Bumped every internal version reference (v10→v11 handoff, version 11→12 line).
- **23 (this file)** — not rewritten, per its own rule, except for the commit-and-push addition
  Devon explicitly requested (see below).

## Stable/active moves

- **14 (Integer Foundry) → `Stable/`.** Verified: `test/browser.mjs` fixed and passing (56/56),
  the difficulty curve played for feel with no issues found, the one shared-file request this
  project ever had already applied, and the two remaining model gaps argued (convincingly, on a
  second round of scrutiny) to be one coupled, deliberately-parked piece of work rather than
  incomplete work. Re-verified test counts myself before moving.
- **17 (Image to PDF) → `Stable/`.** Verified: the tool's own round-3 session explicitly assessed
  itself as stable, re-ran the rotation-fix verification fresh (not just trusted round 2's proof),
  and confirmed the two remaining items (EXIF-vs-real-photo, a real screenshot) are environmental
  gaps identical across three straight sessions, not code defects. `npm run tools` 18/18 confirmed.
- **01, 15 — stayed in `Stable/`, re-verified.** Neither ran this round (correctly skipped). Both
  re-checked directly against the live repo: test suites clean (33/0 and 26/0), no git history on
  their owned paths since their respective Stable dates, storage keys and offsite-request counts
  unchanged. No move.
- **No project moved out of `Stable/`** — nothing surfaced that reopens 01 or 15.

## Questions raised for Devon

- **02, 03 (Pathfinder Campaigns/Characters) — added.** Whether one clean round or two is the
  actual bar for `Stable/`, now that both pages have had their first genuinely clean round. New
  this refresh, not previously asked this way.
- **07 (The Fourth Quarter) — removed, answered.** The difficulty-curve question was answered
  directly this round (spoilage, built) — recorded in the prompt's durable section, removed from
  the block.
- **12 (Coffee Shop Sim) — added.** Whether the Serve button should require full order completion,
  given a measured real difference between patient and eager serving. New this refresh, raised by
  this round's own session.
- **13 (Daredevil) — added.** What "Not interested" to Earl should actually do, given the milestone
  spine proceeds almost unchanged regardless. New this refresh; this round's own session flagged it
  as the biggest open item on the site, and it's now in the durable location for it.
- **16 (Final Grade Checker) — rewritten, not just carried forward.** The old question ("are the
  3.5/2.5/1.5/0.5 thresholds right") is answered (no — whole numbers, 4/3/2/1/0) and removed. The
  remaining question (does any real report card need a second look) is restated with the larger,
  correct scope — the bug window is the tool's entire history, not one round.
- **18 (Name Picker), 22 (General Site Improvements) — added, mirrored.** The rename deadlock now
  targets `newindex.html` (22's file), not `index.html`; both prompts carry the same question so
  whichever session picks it up first can resolve both at once.
- **19 (Schedule Visualizer) — unchanged, still open.** Storage-quota question for `gvb-save.js`
  adoption, third round running with the same "skip it" answer from Devon.
- **01 (Anathema Archive) — unchanged, still open, count updated.** `Pathfinder/data/` raised a
  sixth time this round (Torchbearer, The Absalom Inheritance again).

## Projects that are done

- **14 (Integer Foundry)** and **17 (Image to PDF)** — moved to `Stable/` this round, see above.
- **01 (Anathema Archive)** and **15 (The Fracture Cycle)** — already in `Stable/`, re-confirmed.

## Projects that never ran

None. All twenty-one project prompts (02-21) plus prompt 22 posted round-3 notes. 01 and 15 were
correctly skipped per the `Stable/` convention, not left idle by omission.

## Found but not fixed

- **Torchbearer (10):** a stale comment in `loadSave`'s "Content Missing" branch, describing
  save-order behavior the `mountSaveBar` cleanup changed. Written into prompt 10's task list.
- **Name Picker (18):** `np-store.js`'s own header comment says "twelve" storage keys; the real
  count is thirteen, confirmed everywhere else. Written into prompt 18's task list.
- **Final Grade Checker (16):** the jsPDF-AutoTable column-width `console.warn` — real,
  reproducible, low value, pre-existing across three rounds. Left in prompt 16's task list at its
  existing low priority.
- **Aphelion (04):** a stale assertion-count claim (10 vs. actual 9) and a stale line-number
  citation (541-602 vs. actual 569-629) in this project's own round-3 notes, caused by another
  thread editing earlier parts of the same shared file afterward. Not worth a prompt-file
  correction beyond noting it here — the prompt's own figures were already accurate.
- **Schedule Visualizer (19):** none found beyond the restructure's own bugs, all fixed this round
  (the `check-integrity.mjs` false-positive on an HTML comment, the `BR_CSS` template-literal
  syntax error caught by the new `structure.mjs`).

## Commit and push

Ran as Step six, added to prompt 23 this refresh per Devon's explicit request (see below). `git
status` before staging showed the full round's accumulated work: all twenty-one projects' own
changes, prompt 22's shared-file pass (including the untracked `gvb-site-handoff-v10.md`), and
this session's own `Claude Prompts/**` refresh. Nothing unfamiliar or unaccounted-for by a notes
file turned up. Staged and committed the whole tree; see the commit that follows this notes file
in `git log` for the message and hash, and the top-level conversation for confirmation the push
landed.

## Next round

Roughly in order of value per effort:

1. **Daredevil's Earl/"Not interested" question** — the single biggest open item on the site,
   Devon's call, not code.
2. **Final Grade Checker's report-card-revisit question** — now a bigger window than previously
   known, Devon's call.
3. **Coffee Shop Sim's Serve-gate question** — a real, measured design decision.
4. **The Name Picker rename deadlock** — cheap to resolve either direction, three rounds running.
5. **The Pathfinder Campaigns/Characters Stable-timing question** — cheap, resolves two prompts at
   once.
6. **`Pathfinder/data/`** — raised six times now, cheaper to decide than to keep carrying forward.
7. Every project's own "Next session" section for its regular backlog — unchanged by this refresh,
   carried forward there rather than duplicated here.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
