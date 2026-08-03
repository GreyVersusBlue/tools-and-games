# 12 — Coffee Shop Sim (Corner & Kettle)

You are working on Corner & Kettle, a coffee shop management sim on greyversusblue.com. Round 3
fixed `test/drive-save.mjs`'s own `waitForFunction` engine-mismatch bug (9 instances, not the 8 a
grep first found — one was a multi-line call the pattern missed) and found a real design question
worth Devon's attention — see "Questions for Devon." This prompt is self-contained.

## Questions for Devon

- **Should the Serve button require full completion, now that baristas — not the player — are the
  main path to a finished cup?** Round 3 measured a patient server (waits for every order to fully
  complete before serving) at 100% accuracy and $309 net on a representative day, against an eager
  server (serves as soon as `cupMatchesEnough()` allows) at 46% accuracy, falling reputation, and
  $77 net on an otherwise-identical day. Right now the accuracy/reputation hit from serving early is
  the only thing discouraging it — is that the intended consequence, or should the gate itself
  tighten to `orderIsComplete()`-level strictness, or should there be a UI cue ("still missing: X")
  instead of a hard gate? Any of the three is a real answer; leaving it as-is is also a legitimate
  answer if the accuracy hit is doing its job.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/coffee_shop_sim.html` (2,542 lines)
- `Projects/corner-and-kettle/` — `fonts/` (vendored, done), `js/save.js` (the save schema),
  `test/` (`smoke-save.mjs`, `drive-save.mjs`)
- Any new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this
same repo, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 22. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 22. |
| `assets/previews/corner-and-kettle.jpg`, `assets/og/corner-and-kettle.jpg` | Generated. Prompt 22. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 22. |
| `Projects/fourth-quarter/**`, `Projects/Closing Time/**` | Prompts 07 and 06. Close siblings on the same save-module integration. |
| `gvb-site-handoff-v*.md` | History. Read them. Never edit them. |
| Every other project | Not yours. |

**If you need a shared file changed, do not change it.** Write the exact edit into the
"Shared-file requests" section of your notes file, specific enough that someone can apply it
without reading your session.

One exception inside your own file: the `<head>` has a generated block between
`<!-- gvb:social:start -->` and `<!-- gvb:social:end -->`. **Do not hand-edit inside those
markers** (locked decision #31). Regenerated from the board's notice by `npm run social`; your
edit will be silently overwritten. A wrong description is a board request.

## Required reading

1. This whole file.
2. **`Claude Prompts/notes/12-coffee-shop-sim-notes.md`** — round 3's session: fixed
   `test/drive-save.mjs`'s own `waitForFunction` bug (see below) and measured the Serve-button
   early-enable gate (see "Questions for Devon"). Round 2's notes are archived at
   `Claude Prompts/archive/round-2/notes/12-coffee-shop-sim-notes.md` — prestige-based difficulty
   floors, the mid-shift reload fix, baristas no longer auto-serving, keyboard shortcuts, and the
   stale test assertion inverted. Round 1's are at
   `Claude Prompts/archive/round-1/notes/12-coffee-shop-sim-notes.md` — fonts, the original save
   adoption, the seven save bugs, and the difficulty audit that found what round 2 fixed.
3. `gvb-site-handoff-v10.md` §10 (locked decisions, through #58) and §8 (backlog state).
4. `assets/js/gvb-save.js` and `assets/js/README.md`.
5. `Projects/corner-and-kettle/js/save.js` and its two test suites.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.**
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). Yours is `cornerKettleSave_v1`.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). Absolute `import()` paths need `pathToFileURL`.
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).
- **`page.__blocked` is "offsite and refused"; `page.__shimmed` is "offsite and fulfilled locally
  instead"** (locked decision #44).
- **`gvb-save.js`'s storage-construction gaps are fixed, and `mountSaveBar` takes `filename`/`labels`
  overrides** (locked decisions #47-49). Your own round-1 requests, both applied and confirmed
  fixed this round.
- **A `page.waitForFunction(fn, null, opts)` call is Playwright's shape, not puppeteer-core's**
  (locked decision #52) — fixed in every shared `Tools/board-check` file since round 2, and, as of
  this round, in this project's own `test/drive-save.mjs` too (9 instances, not the 8 a plain grep
  found — one was a multi-line call the simple pattern missed). Verified against a real reproduction
  on `puppeteer-core`, not just a re-run. If you add a new call in this file, use `drive.mjs`'s
  `waitFor`/`wait`/`textContent` helpers, not a bare Playwright-shaped call.
- **A real-time or timing-based assertion failing under this environment's Linux/software-rendered
  Chromium is inconclusive, not confirmed** (locked decision #53). This game is 2D DOM, not
  three.js, so less exposed, but worth knowing if `drive-save.mjs` behaves inconsistently.

## What is actually here

`Projects/coffee_shop_sim.html`, one file, one URL. The save schema (360 lines) lives separately
for testability.

**Fonts are vendored, zero offsite requests.**

**Persistence runs through `assets/js/gvb-save.js`**, via `Projects/corner-and-kettle/js/save.js`.
Storage key `cornerKettleSave_v1`, unchanged.

**Difficulty now floors on prestige level, not just day.** `spawnFactor()`/`patienceFactor()`
(around line 650) floor on `state.prestigeLevel` as well as `state.day` — spawn floor
`max(0.30, 0.6 - 0.06*prestigeLevel)`, patience floor the same shape. Days 1-9 are untouched at
every prestige level; only day 30-and-beyond moves, and only once prestige is actually earned. At
prestige 0 the numbers match round 1's measured table exactly (day 30 plays like day 9); by
prestige 5 day 30 is measurably busier than a first playthrough's day 9.

**Baristas hand off instead of auto-serving.** `runBaristaTick()` no longer calls `serveSlot()` on
completion — it still fumbles, tosts, and releases the station, but the finished cup sits in its
slot until a human clicks Serve. The claiming loop skips a slot whose order is already complete, so
a barista doesn't immediately re-claim its own finished ticket.

**The mid-shift reload exploit is closed.** `shiftElapsed`/`shiftRunning` are now persisted
(`Projects/corner-and-kettle/js/save.js`), so a reload resumes the shift where it left off instead
of restarting the clock at Dawn for free. One edge case this opened by itself is also handled:
reloading in the narrow window after `endShift()` sets `shiftRunning: false` but before the day-end
modal's button is clicked now calls `startNextDay()` immediately on load, rather than replaying
`endShift()` and double-charging wages.

**Keyboard shortcuts exist.** Digits 1-7 switch station tabs, `S` serves the focused station, both
discoverable via `title`/`aria-keyshortcuts`.

**Both test suites pass clean.** `smoke-save.mjs` → **166 passed, 0 failed**. `drive-save.mjs` →
**90 checks, 0 failed**, and as of this round its own `waitForFunction` calls are genuinely fixed
(9 instances), not just untested-and-lucky.

**The Serve-button early-enable gate was measured this round, not tuned by feel** — see "Questions
for Devon." Patient serving: 100% accuracy, $309 net. Eager serving (as soon as
`cupMatchesEnough()` allows): 46% accuracy, falling reputation, $77 net. Real difference, not
noise, on an otherwise-identical day.

**Preview and OG card both exist.**

## Your task

Round 3 fixed the `drive-save.mjs` engine bug and raised the Serve-gate question. What's left:

1. **Once Devon answers the Serve-gate question, build whichever shape was chosen** (tighter gate,
   a UI cue, or confirm leave-as-is) — see "Questions for Devon" above.
2. **Re-measure the day-10 (and maybe day-20, prestige-1) full-playthrough numbers**, factoring in
   both the hand-off change (round 2) and whatever the Serve-gate question above resolves to. This
   is the actual answer to "did the balance work work," and it needs a scripted player, not a
   fast-forwarded clock. Compare against round 1's `offered 41 · served 45 · net $2,353 · 99%
   accuracy`.
3. **Check whether the barista fumble chance needs retuning** now that a human confirms every
   serve instead of the barista's own accuracy being the only check. Fold into item 2's
   measurement.
4. **Per-station-content keyboard shortcuts** (a milk type, a syrup), only if full keyboard play
   becomes a real goal — the station tabs and Serve already have shortcuts; picks inside a station
   don't yet, and would need a per-tab legend since contents change per tab.
5. **`npm run games` still doesn't cover this game** — unchanged since round 1, still prompt 22's
   file to touch if this game ever joins that suite.

## Verification

- `node Projects/corner-and-kettle/test/smoke-save.mjs` → **166 passed, 0 failed**.
- `node Projects/corner-and-kettle/test/drive-save.mjs` → **90 checks, 0 failed**, engine-mismatch
  bug fixed as of this round.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed.
- If you re-measure the playthrough table, put the new numbers next to round 1's old ones in your
  notes — a claim without a before/after isn't verification.
- `cd Tools/board-check && npm run check` → as of this refresh: **559 units checked, 0 broken, 0
  collisions, tightest vertical gap 9.1px.** (The unit count moves every round as files are added
  elsewhere in the repo; 0 broken is what matters.)
- `npm run social:check` → **18 notices, 18 already current** (Orbital's card joined this round).
- Locked decision #34: for any new guard-rail, break the thing on purpose first and watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time. This game isn't in `npm run games`, so prefer your own two suites for
iteration.

## Output: your notes file

Write `Claude Prompts/notes/12-coffee-shop-sim-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-two of them.

Use these headings:

```
# Corner & Kettle — session notes

## What changed
## What I verified
## Shared-file requests
## Deliberately not done
## Next session
```

- **What changed** — files touched and why, in prose, with paths. If you re-measured the
  difficulty table, put the new numbers here next to the old ones.
- **What I verified** — actual commands, actual output. Include a before/after on any balance
  change. "Should feel better" is not verification.
- **Shared-file requests** — any `gvb-save.js` gap with the exact hook signature. Applicable
  blind. Empty is fine; keep the heading.
- **Deliberately not done** — something you looked at, understood, and chose to leave, with the
  reason.
- **Next session** — ordered by value per effort.

## Writing style

Devon writes the handoffs himself and they have a voice: direct, specific, no em dashes, no
rule-of-three padding, no corporate throat-clearing. Numbers over adjectives. When something was
wrong, say what was wrong and what the evidence was. Match that. Do not write "comprehensive" or
"robust" anywhere.
