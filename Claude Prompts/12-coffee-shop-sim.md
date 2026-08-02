# 12 — Coffee Shop Sim (Corner & Kettle)

You are working on Corner & Kettle, a coffee shop management sim on greyversusblue.com. Round
2 closed five tasks in one session: the flat difficulty curve at high prestige, the mid-shift
reload exploit, baristas auto-serving instead of handing off, station keyboard shortcuts, and
its own stale test assertion. This prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/coffee_shop_sim.html` (2,562 lines)
- `Projects/corner-and-kettle/` — `fonts/` (vendored, done), `js/save.js` (the save schema),
  `test/` (`smoke-save.mjs`, `drive-save.mjs`)
- Any new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Other Claude sessions may be working on other projects in this
same repo, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/corner-and-kettle.jpg`, `assets/og/corner-and-kettle.jpg` | Generated. Prompt 21. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
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
2. **`Claude Prompts/notes/12-coffee-shop-sim-notes.md`** — round 2's session: prestige-based
   difficulty floors, the mid-shift reload fix, baristas no longer auto-serving, keyboard
   shortcuts, and the stale test assertion inverted. Round 1's notes are archived at
   `Claude Prompts/archive/round-1/notes/12-coffee-shop-sim-notes.md` — fonts, the original save
   adoption, the seven save bugs, and the difficulty audit that found what round 2 fixed.
3. `gvb-site-handoff-v9.md` §10 (locked decisions — #51-53 new) and §8 (backlog state).
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
- **A `page.waitForFunction(fn, null, opts)` call is Playwright's shape, not puppeteer-core's** —
  fixed this round in every shared `Tools/board-check` file, but **not in your own
  `test/drive-save.mjs`**, which has 8 separate instances of the identical pattern (confirmed by
  direct grep this refresh: lines 93, 160, 166, 226, 265, 344, 424, 530). That file is yours, not
  `Tools/board-check`'s, so prompt 21's fix didn't touch it — see task one.
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

**Both test suites pass clean, including the assertion that used to be a known gap.**
`smoke-save.mjs` → **166 passed, 0 failed** (confirmed fresh this refresh — the "blocked storage"
assertion that used to expect the *old*, buggy `load()` behavior is inverted and passing, not
outstanding). `drive-save.mjs` → **90 checks, 0 failed** (confirmed fresh this refresh, though see
task one — this suite's own `waitForFunction` calls are the puppeteer-incompatible shape and
haven't hit a run where that mattered yet in this environment, possibly by luck rather than by
being fixed).

**Preview and OG card both exist.**

## Your task

Round 2 closed five real tasks in one session. What's left:

1. **Fix `test/drive-save.mjs`'s own 8 instances of the `waitForFunction(fn, null, opts)` bug** —
   the same pattern that broke `npm run games` for every other project this round, in a file
   that's yours and that prompt 21's fix didn't reach. `Tools/board-check/drive.mjs` exports
   `waitFor(page, fn, opts)`, `wait(ms)`, and `textContent(page, sel)` as engine-aware
   replacements — import them (you already import other things from `harness.mjs`/`drive.mjs`
   presumably) and swap each `p.waitForFunction(fn, null, {timeout})` for `waitFor(p, fn,
   {timeout})`. Verify per locked decision #34 the same way every other project verified this fix.
2. **Re-measure the day-10 (and maybe day-20, prestige-1) full-playthrough numbers now that tasks
   one and four from the previous round have landed.** This is the actual answer to "did the
   balance work work," and it needs a scripted player, not a fast-forwarded clock — a human now has
   to click Serve on everything three baristas prep, where before it was hands-off. Compare against
   round 1's `offered 41 · served 45 · net $2,353 · 99% accuracy`.
3. **Check whether the barista fumble chance needs retuning** now that a human confirms every
   serve instead of the barista's own accuracy being the only check. Fold into item 2's
   measurement.
4. **Per-station-content keyboard shortcuts** (a milk type, a syrup), only if full keyboard play
   becomes a real goal — the station tabs and Serve already have shortcuts; picks inside a station
   don't yet, and would need a per-tab legend since contents change per tab.
5. **`npm run games` still doesn't cover this game** — unchanged from round 1, still prompt 21's
   file to touch if this game ever joins that suite.

## Verification

- `node Projects/corner-and-kettle/test/smoke-save.mjs` → **166 passed, 0 failed** (confirmed clean
  as of this refresh — not outstanding).
- `node Projects/corner-and-kettle/test/drive-save.mjs` → **90 checks, 0 failed**, but see task one
  above before trusting this stays true.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed.
- If you re-measure the playthrough table, put the new numbers next to round 1's old ones in your
  notes — a claim without a before/after isn't verification.
- `cd Tools/board-check && npm run check` → as of this refresh: **335 units checked, 0 broken, 0
  collisions, tightest vertical gap 3.5px.**
- `npm run social:check` → **17 notices, 17 already current** (dropped from 22 this round — a real,
  correct count, not a regression).
- Locked decision #34: for any new guard-rail, break the thing on purpose first and watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time. This game isn't in `npm run games`, so prefer your own two suites for
iteration.

## Output: your notes file

Write `Claude Prompts/notes/12-coffee-shop-sim-notes.md`. Nobody else writes that file, so it can
never conflict. It is the only record of this session that survives — the next handoff gets
assembled from all twenty-one of them.

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
