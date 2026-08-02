# 12 — Coffee Shop Sim (Corner & Kettle)

You are working on Corner & Kettle, a coffee shop management sim on greyversusblue.com. This
prompt is self-contained.

## Your boundary

You own these paths. Inside them, edit, add, delete and restructure freely:

- `Projects/coffee_shop_sim.html` (2,509 lines, 96.6 KB)
- `Projects/corner-and-kettle/` — `fonts/` (vendored, done), `js/save.js` (the save schema),
  `test/` (`smoke-save.mjs`, `drive-save.mjs`)
- Any new folder you create under `Projects/` **named for this game**

**Everything else in the repo is read-only to you.** Read whatever you like; change nothing
outside that list. Up to twenty other Claude sessions may be working on other projects in this
same repo, and this boundary is the only thing keeping that from becoming a merge fight.

Off-limits in particular:

| Path | Who owns it |
| --- | --- |
| `index.html` (the repo root one) | The board. Card title, description, `data-new`, `data-preview`, version line (locked decisions #9, #31). Prompt 21. |
| `assets/js/gvb-save.js` and its test | The shared save module. Prompt 21. |
| `assets/previews/corner-and-kettle.jpg`, `assets/og/corner-and-kettle.jpg` | Generated, and now exist — your round-one preview request was applied. Regenerating either is Prompt 21's, via `Tools/board-check/games.mjs` and `npm run previews`. |
| `Tools/board-check/**` | Shared dev tooling. Prompt 21. |
| `Projects/fourth-quarter/**`, `Projects/Closing Time/**` | Prompts 07 and 06. Both are close siblings on the same save-module integration you've now also done yourselves — worth reading if you touch the save schema again. |
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
2. **`Claude Prompts/notes/12-coffee-shop-sim-notes.md`** — your own round-one session. Fonts and
   save adoption are both done; what it leaves you is a measured difficulty-curve audit with exact
   numbers (spawn and patience factors floor at day 9-10 and never move again; a full playthrough
   is under half an hour, most of it watching). Read it in full before touching the game loop.
   `Claude Prompts/archive/` holds every earlier round if you need more history than that.
3. `gvb-site-handoff-v8.md` §4 (the shared save module, now eleven adopters — Corner & Kettle is
   named directly, and its own two requests are the fix described there), §9 locked decisions
   #43-50, in particular **#49** (the two `gvb-save.js` storage-construction gaps — this is your
   own contribution from last round, now fixed and locked) and **#44** (`page.__blocked` vs
   `page.__shimmed`, relevant if you ever touch fonts again). §10 item 2 names a small task that's
   yours — see task list below.
4. `assets/js/gvb-save.js` and `assets/js/README.md`.
5. `Projects/corner-and-kettle/js/save.js` — the save schema you already wrote, and its two test
   suites in `Projects/corner-and-kettle/test/`.

## House rules for every file in this repo

- **No build step.** Static files served by GitHub Pages from the repo root at
  `greyversusblue.com`. Plain ES modules, no bundler, no transpiler, no runtime npm dependency.
- **Zero offsite requests.** Already true for this page — see below.
- **Each project vendors its own copy; nothing is shared across projects** (locked decision #17).
- **Never change a storage key** (locked decision #36). Yours is `cornerKettleSave_v1`. It keeps
  that name.
- **`migrate` is for version drift; `repair` is for every load** (locked decision #37).
- **Windows is the dev machine** (v7 §7). An absolute `import()` path needs `pathToFileURL` — a
  bare `C:\...` is read by Node as URL scheme `c:` and refused. Don't lean on shell brace
  expansion either (v6 §5).
- **A check that only prints is a check that gets ignored** (locked decision #13).
- **Verify a guard-rail by reintroducing the bug it guards** (locked decision #34).
- **Assert against the DOM for anything that just happened, and against the save only for what a
  reload has to survive** (locked decision #39).
- **`page.__blocked` is "offsite and refused"; `page.__shimmed` is "offsite and fulfilled locally
  instead"** (locked decision #44). Not currently relevant — you have zero offsite requests — but
  if you ever add a font or an asset, check `__shimmed` too, not just `__blocked`.
- **`gvb-save.js`'s `mountSaveBar` now also takes `filename` and `labels` overrides, and `fresh`/
  `reset` forward arguments to a `defaults` factory; there's also a bare `clear()`** (locked
  decisions #47, #48). None of this is required for you, but `clear()` in particular is worth
  knowing about if the mid-shift reload policy decision below ends up wanting "erase the day
  without building a fresh one first."

## What is actually here

`Projects/coffee_shop_sim.html`, 2,509 lines, 96.6 KB. One file, one URL, unchanged from round
one — the save schema (360 lines) lives separately for testability, nothing else moved.

**Fonts are vendored, zero offsite requests.** Seven `@font-face` faces (Kalam, Quicksand, Space
Mono; 400/600/700 as actually used, 121.6 KB total) live in `Projects/corner-and-kettle/fonts/`.
`grep -c fonts.googleapis.com Projects/coffee_shop_sim.html` → 0.

**Persistence runs through `assets/js/gvb-save.js`**, via `Projects/corner-and-kettle/js/save.js`
(imported relatively, so the page is `<script type="module">` now). Storage key
`cornerKettleSave_v1`, unchanged. Adopting the module found and fixed seven ways a save could
silently break the game — all in `presets[].cup`, `regulars[name]`, `loyaltyLevel`, and
`stationCount`, one level deeper than the top-level scalars the old loader already guarded — plus
one non-loading bug (`doPrestige()` left `state.regulars` stale, making a regular permanently
unservable after prestige; regulars now re-roll on prestige). Full detail and exact line numbers
are in the round-one notes file.

**The save bar is mounted on the chalkboard**, reachable any time during a shift, with
`buttons: ["export", "import"]` (no reset — the game ships its own "New Game").

**Two accessibility fixes are in**: the toast feed is `role="status" aria-live="polite"`, and
queue customers are real `<button>`s with order-specific `aria-label`s instead of bare
onclick-divs.

**Two test suites exist**: `Projects/corner-and-kettle/test/smoke-save.mjs` (Node, drives the save
schema directly) and `Projects/corner-and-kettle/test/drive-save.mjs` (browser-driven, drives the
page for real). As of this refresh, `smoke-save.mjs` reports **161 passed, 1 failed** — the one
failure is expected, not a regression: it asserts the *old* buggy behavior of `load()`'s unguarded
`getItem` call, which was fixed site-wide this round (locked decision #49) exactly as this
project's own shared-file request specified. See the task list. `drive-save.mjs` reports **90
checks, 0 failed**. `node assets/js/gvb-save.test.mjs` reports **50 passed, 0 failed**.

**Preview and OG card both exist** — `assets/previews/corner-and-kettle.jpg` and
`assets/og/corner-and-kettle.jpg`, applied by prompt 21 last round using `games.mjs`'s existing
`open()` recipe, which already reaches a filled espresso cup, a waiting customer, and the day/
currency HUD.

**There is a measured, unfixed difficulty problem.** Both the spawn-rate and patience-decay
curves floor at day 9-10 and never change again — day 30 plays identically to day 9. Worse, staff
throughput outgrows demand entirely: three trained Seniors clear about 74 orders a shift against a
demand cap of 43, which measures out to 99% accuracy with no human input needed. Every purchasable
thing in the game (about $14,150 worth) is affordable in 12-13 days at measured late-game income
(~$2,350/day), so a full playthrough is under half an hour of wall clock, most of it watching. See
the round-one notes file for the full table and the exact numbers. Nothing about this is fixed yet
— it's data, not a task done.

**`npm run games` does not drive this game.** It has its own driver, `drive-save.mjs`, because
adding a seventh entry to `games.mjs` is prompt 21's file to touch, not yours. If Corner & Kettle
ever joins that suite, `drive-save.mjs`'s opening beats and `games.mjs`'s `enter()` should collapse
into one rather than keeping two ways to reach the same first frame (locked decision #38).

## Your task

Round one shipped fonts, save adoption, the seven save bugs, two accessibility fixes, and the
preview/OG card. All of that is done — do not re-do it. What's left is balance work plus one
one-line test cleanup.

**Task one: make prestige move the difficulty floors, not just the tip rate.** This is the
highest-value, lowest-cost thing on the list — two lines, no new content, no new UI, using state
(`state.prestigeLevel`) that's already saved and already read elsewhere. Right now prestige only
grants +5% tips, which is invisible. The sketch from the round-one audit:

```js
function spawnFactor(){
  const floor = Math.max(0.30, 0.6 - 0.06*state.prestigeLevel);
  return Math.max(0.25, Math.max(floor, 1 - (state.day-1)*0.05) * shopSpawnFactorMult());
}
```

Same shape for `patienceFactor()`. Measure before and after — the round-one notes have the day-1/
day-3/day-5/day-9/day-30 table already built, so a second table after this change is a direct
comparison, not a fresh measurement from scratch.

**Task two: invert the one expected-failing assertion in your own `smoke-save.mjs`.** One line.
`Projects/corner-and-kettle/test/smoke-save.mjs`, in section 9 ("blocked storage"), around line
375-387:

```js
  const hostileSlot = createCornerKettleSlot(CATALOG, { storage: hostile, rng: () => 0.5 });
  eq(hostileSlot.save({ day: 1 }), false, "a throwing setItem is already caught");
  let threw = false;
  try { hostileSlot.load(); } catch (e) { threw = true; }
  eq(threw, true, "a throwing getItem is NOT caught — known gvb-save gap, see notes");
```

`gvb-save.js`'s `load()` now wraps its `getItem` call in try/catch (locked decision #49, fixed in
response to this project's own request). `threw` should now come back `false`, and `load()` should
return `null` rather than propagating. Update the assertion and its message to say so. This is
`gvb-site-handoff-v8.md` §10 item 2, named there as a task specifically for this prompt. A stale
"known gap" test is worse than no test — it will keep failing every run and training you to ignore
red output.

**Task three: decide the mid-shift reload policy.** Measured, real, unfixed: `shiftElapsed` is
never saved, so reloading mid-shift restarts the clock at Dawn while keeping the day and the
money. Wages are only deducted in `endShift()`, so this is currently unlimited free shifts and
free labor, two clicks, no cost. Pick one of: persist `shiftElapsed` so a reload resumes where it
left off, or bank the day's results on reload the way Faire Weekend now does (locked decision
#45 — "a day is final once the gates close" is the same shape of problem, already decided there).
Either is fine. Leaving it undecided again is not.

**Task four: stop baristas auto-serving.** `runBaristaTick()` currently calls `serveSlot()` itself
the moment a ticket completes. If a trained barista instead left the finished cup for a human to
hand over, three Seniors become a throughput multiplier instead of a full replacement, and the 99%
hands-off accuracy number goes back to being the player's problem. Do this after task one, so the
new numbers get measured against the fixed curve, not the old flat one.

**Task five, lower priority: keyboard shortcuts for the stations.** The queue cards are already
keyboard-reachable (round one). The stations themselves still have no shortcuts — digits for the
tabs and a key for Serve would finish what round one started, but it's cheaper and less
consequential than tasks one through four.

If time allows beyond this: re-run the full playthrough measurement after tasks one and four land,
and put fresh numbers in your notes so the next session isn't measuring against stale ones.

## Verification

- `node Projects/corner-and-kettle/test/smoke-save.mjs` → 162 passed, 0 failed, once task two
  lands (161/1 before it — the 1 is the stale assertion, not a real bug).
- `node Projects/corner-and-kettle/test/drive-save.mjs` → 90 checks, 0 failed.
- `node assets/js/gvb-save.test.mjs` → 50 passed, 0 failed.
- If you change the difficulty curve, re-measure the day 1/3/5/9/30 table by hand or in the suite
  and put the new numbers next to the old ones in your notes — a claim without a before/after
  isn't verification.
- `cd Tools/board-check && npm run check` → 329 units checked, 0 broken, 0 collisions, tightest
  vertical gap 9.2px.
- `npm run social:check` → 22 notices, 22 already current. Drift on your page means you edited
  inside the `gvb:social` markers.
- Locked decision #34: for any new guard-rail, break the thing on purpose first and watch it fail.

Scheduling note: `npm run games`, `npm run play` and `npm run previews` open real visible browser
windows, and Chrome throttles a window that loses focus (v7 §6). Other threads may be running
them. Only one at a time. This game isn't in `npm run games` (see above), so prefer your own two
suites for iteration.

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
