# Faire Weekend — session notes

## What changed

**The report-phase save policy: a day is now final once the gates close.**

`Projects/Ren-Faire-Claude/js/main.js` — `State.saveState(state)` moved from the
bottom of `render()` to the top. It used to sit below the early return that the
`report`, `weekendEnd`, `victory` and `gameOver` phases take, so the game never
wrote a save while a report was on screen and reloading rewound to before the
gates opened. At the top, an early return cannot skip it. A comment there
explains why, with the numbers, so nobody moves it back for tidiness.

**The sentence someone can disagree with:** the old behaviour was not forgiving,
it was a free reroll, and closing it is worth more than the forgiveness was.
`runDay()` seeds off `Date.now()`, so the day you replay is not the day you just
played — it is a fresh roll. I measured it before deciding. 400 seeds against a
four-plot grounds with performers booked and a vendor seated:

| | min | median | max | spread |
| --- | ---: | ---: | ---: | ---: |
| `cashDelta` | −$301 | +$393 | +$1,265 | $1,566 |
| attendance | 551 | 604 | 672 | 121 |
| `reputationDelta` | 0 | +1 | +5 | 5 |

F5 was worth about three times the median day's profit. Rerolling for +5
reputation instead of +1 reaches the win condition's `minReputation: 70` in
roughly a quarter of the days it should take. The Stage 19 economy rework and
the Stage 16 win/loss conditions were both optional while that was true, and
nothing on screen told the player the lever existed — you found it by
accidentally reloading, which is the worst way to ship a mechanic.

Three things I did not expect going in:

- **"Persist the report" and "persist and lock the day" are the same option
  here.** v7 §9 offers them as a choice. `runDay()` already applies `cashDelta`,
  pushes to `history` and sets `phase` — the day is resolved the instant the
  button is clicked. The only reason it replayed is that the state never reached
  disk. Persisting it *is* locking it; there is no third state to write. Keeping
  them separate would mean building a replay button nobody asked for.
- **The old behaviour also punished.** A crash, a closed tab, or a phone locking
  its screen mid-report threw away a day the player had already earned. The
  forgiveness was symmetric with a loss, and only the reroll was deliberate.
- **Bankruptcy has never been able to end a run.** `gameOver` takes the same
  early return, so reloading past a folded faire put you back in the planning
  phase with the money you had before the day that ruined you. Stage 16 shipped
  a loss condition that a reload undid.

Risk of locking, measured rather than asserted: the worst of those 400 seeds is
−$301 against a `bankruptcyFloor` of −$6,000. One bad roll cannot ruin anybody.
Only sustained bad decisions can, which is what the floor is for.

**The three type families are vendored.** New folder
`Projects/Ren-Faire-Claude/assets/fonts/` — six woff2 files, **259,680 bytes,
253.6 KB**, `latin` subset only. `@font-face` block at the top of
`css/style.css`; the two `preconnect`s and the `fonts.googleapis.com` stylesheet
link are gone from `index.html`, replaced by a `preload` for the one face that
paints first (Barlow 600) and a comment saying not to put them back. The
existing `--font-display` / `--font-body` / `--font-ui` tokens are untouched —
the `@font-face` rules declare the plain family names, so nothing downstream
changed. `assets/fonts/README.md` carries the table, sources and OFL notices.

Weights were measured with `getComputedStyle` across every screen rather than
copied off the old link tag, and the old tag was wrong in both directions:

- **Grenze Gotisch 700 and Barlow Semi Condensed 500 were being fetched and
  never used.** Barlow 500 is gone.
- **Fraunces 700 was being used and never fetched.** A ledger `<td>` computes to
  700 in Fraunces; the hotlink only ever loaded 400 and 600, so the browser had
  been synthesising a faux bold since Stage 19. The variable file covers
  100–900, so that text now renders in the real cut. Vendoring made the page
  slightly better by accident, which is the usual reward for measuring.

Fraunces stays a variable font with its **optical-size axis**, which is what the
old URL asked for (`ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400`) — one
file per style, not nine static cuts. Fontsource's `wght`-only cut would save
66,548 bytes and I deliberately did not take it: vendoring should not quietly
change how the page renders. Both axes were confirmed live in a browser by
canvas metrics, not assumed. Grenze Gotisch is also variable (42,328 bytes
against 33,104 for static 400 + 500 — 9 KB for one file instead of two, and no
new download the next time a heading wants a weight). Barlow has no variable
cut on Google Fonts, so 400/600/700 are statics.

`latin` only: every character the game can render was checked against the Google
subset ranges and nothing needs `latin-ext` or `vietnamese`. The arrows and
ornaments (`→ ↔ ★ ⛲ ✕ ➔ ✨`) sit outside every subset these families publish, so
they fell back to a system font under the hotlink too. Nothing changed there.

**`tests/smoke.mjs` — 684 → 737 checks.** Two new sections, both mine:

- **Section 1h** boots `main.js` against a shared in-memory storage, plays a real
  day, and asserts the save says `report` while a report is on screen and
  carries the attendance the ticket stub shows. Then it boots a *second* JSDOM
  against the same storage — which is what a reload is — and asserts it comes
  back to the same report, same cash, no Open the Gates button, no duplicated
  day in history. Weekend-end gets the same play-then-reload treatment, and a
  separate block drives a bankrupt report through to `gameOver`, then checks
  Start a New Faire persists so a reload can't resurrect a folded run.
- **Section 21** greps `index.html` for `fonts.googleapis.com` and
  `fonts.gstatic.com`, asserts every `href`/`src` it would actually fetch is
  relative, resolves all six `@font-face` srcs to real files, totals their bytes
  against the documented 259,680, and checks Barlow ships 400/600/700 and not
  the unused 500. `page.__blocked` is **not** the check for this — see below.

Also removed six now-dead `.replace(/<link[^>]*fonts\.g[^>]*>/g, '')` calls from
the DOM boot tests; there is no hotlink left to strip.

**Docs.** `README.md` gained the new save policy under the `js/main.js` bullet,
the Section 1h test description, and the corrected check count (it said 675 in
two places; it was 684 before this session and is 737 now).
`HANDOFF.md` gained a Stage 21 status section with both measurement tables.

## What I verified

- `node tests/smoke.mjs` → **737 passed, 0 failed** (was 684). Exit code 0.
- **Locked decision #34, the guard-rail reintroduction.** Put `saveState()` back
  at the bottom of `render()` and reran: **697 passed, 12 failed, exit code 1**,
  naming every symptom — the save saying `plan` while a report is up, the reload
  landing on the planning desk, the gates re-openable, `gameOver` not reaching
  disk. First attempt at this *crashed* on a null `lastResult` at the fourth
  assertion and hid the other twenty, so the reads downstream of it are guarded
  now; a guard-rail that explodes reports less than one that counts. Restored
  and re-verified green.
- **The by-hand reload test, in a real browser, on all four phases.** Served the
  repo at `localhost:47681` and drove it:
  - **report** — opened the gates on day 1. Screen said 91 attendance, net
    −$1,199; save said `phase: "report"`, `cash: 4001`, `lastResult.attendance:
    91`, `history: 1`. Reloaded: same report, same 91, same $4,001, no Open the
    Gates button, one Next Day button, tabs hidden. Before the change the same
    sequence came back `phase: "plan"`, `cash: 5200`, `history: 0`.
  - **weekendEnd** — played out Friday/Saturday/Sunday, landed on "Weekend 1 —
    Gates Closed for the Season" at $1,614 with 3 results in history. Reloaded:
    same summary, same $1,614, "Begin Weekend 2 →" still there.
  - **gameOver** — preloaded a report already past `bankruptcyFloor` (−$6,912
    against a −$6,000 floor), clicked through: "The Faire Folds", save
    `phase: "gameOver"`. Reloaded: still folded, "Start a New Faire →" present,
    so nobody is stuck. Clicking it wrote `phase: "plan", day: 1, cash: 5200,
    bankrupt: false` to disk.
  - **victory** — preloaded a `victory` save. Reloaded: "✨ A Legendary Faire ✨",
    `victoryAchieved: true`. Acknowledged it, landed on the Weekend 6 summary,
    save `phase: "weekendEnd"` with `victoryAchieved` still true, so the
    milestone cannot refire.
- **Fonts, in a browser.** `document.fonts.ready` then `document.fonts.check()`
  → all six faces `loaded`, all seven weight/style combinations true. Canvas
  metrics differ from the generic fallback for every one (e.g. Barlow 400 14px
  renders 189px wide against 227.5px for `sans-serif`), so the vendored glyphs
  are actually driving layout rather than silently falling back. Fraunces'
  `wght` axis is live (400 and 700 measure differently) and so is `opsz`
  (width-per-px 16.743 at 14px against 16.600 at 22px — the axis I paid 66 KB
  for is doing work).
- **Network log after vendoring:** 13 requests, all same-origin, six of them the
  woff2 files at 200. Zero to `fonts.googleapis.com` or `fonts.gstatic.com`.
  `grep index.html for fonts.googleapis.com` → the only hit is the comment
  telling you not to put it back, which the suite strips before checking.
- `cd Tools/board-check && npm run games` → **94 checks, 0 failed.** Faire
  Weekend's 13 beats all pass unchanged, including "no offsite requests" and
  "the grounds came back after a reload" (4 plots, day 1 → 5, weekend 1 → 2,
  276 through the gate on the first day). Nothing in `play-games.mjs` needed to
  change for the suite to stay green — see the request below for what *should*
  change now that it can.
- `npm run check` → **249 units checked, 0 broken; 0 collisions across nine
  widths, tightest vertical gap 7.1px.** (v7 recorded 235 units; other threads
  have added pages and my six font files count too.)
- `npm run social:check` → **23 notices, 23 already current, 0 out of date.**
- **Save size, since it now gets written more often.** 90 simulated days →
  89.8 KB, about 1 KB per day of `history`. Against a ~5 MB localStorage budget
  that is roughly 5,000 days. Not a problem, and not new — `history` already
  grew this way. Measured rather than worried about.

## Shared-file requests

**1. `Tools/board-check/play-games.mjs` — replace the history-reading workaround
in the `faire-weekend` block.** The comment at lines 251–254 is now wrong. It
reads:

> Read the gate off history rather than off lastResult mid-report: render()
> returns early for the report/victory/gameOver/weekendEnd phases and only calls
> saveState() on the planning path, so a report is never on disk while it's on
> screen.

That is no longer true. **Nothing currently fails** — the suite is green as-is,
because the loop always clicks through to a planning phase before reading — so
this is a tightening, not a fix. Applicable blind.

Delete the four comment lines and keep `const gate = after.history[0]?.attendance;`
as it stands (it is reading a completed run, which is still the right source).
Then add these beats after the existing reload assertion at line 262, inside the
same `'faire-weekend'` block. They need `savedState`, `wait` and `t`, all
already in scope:

```js
    // Stage 21: a report is now on disk while it is on screen, so the suite can
    // assert the thing the old comment was working around. Open one more day
    // and read the save mid-report, without clicking Next Day first.
    const gates = await p.$('[data-action="openGates"]');
    if (gates) {
      await gates.click();
      await wait(450);
      const midReport = await savedState(p, 'faire-weekend');
      t.ok(midReport.phase === 'report',
        'the save says "report" while a report is on screen', midReport.phase);
      t.ok(Number.isFinite(midReport.lastResult?.attendance),
        'and it carries the day it is showing',
        `${midReport.lastResult?.attendance} through the gate`);

      // The screen and the save agree — locked decision #39 still applies, so
      // the gate figure is read off the DOM and compared to the save, not
      // trusted from the save alone.
      const onScreen = await p.$eval('.ticket-stub',
        el => el.textContent.replace(/[^0-9]/g, ' ').trim().split(/\s+/).map(Number));
      t.ok(onScreen.includes(midReport.lastResult.attendance),
        'the attendance on the ticket stub is the attendance in the save');

      // And the day is final: reloading comes back to the same report rather
      // than rewinding to before the gates opened.
      const cashAtReport = midReport.cash;
      await p.reload({ waitUntil: 'load' });
      await GAMES['faire-weekend'].open(p);
      const afterReload = await savedState(p, 'faire-weekend');
      t.ok(afterReload.cash === cashAtReport,
        'reloading on a report keeps the day rather than replaying it',
        `$${cashAtReport} -> $${afterReload.cash}`);
      t.ok(!(await p.$('[data-action="openGates"]')),
        'and the gates cannot be opened twice on the same day');
    }
```

**2. `Tools/board-check/harness.mjs` — `prepPage()` hides font hotlinks from
`page.__blocked`, and nothing says so.** Not a code request; a comment request.
`prepPage()` fulfills Google Fonts requests locally from the bundled
`@fontsource` packages *before* the blocked-list check runs, so a hotlinked font
never reaches `page.__blocked`. That is why v7 §5 could claim zero offsite
requests site-wide while this game was still calling out on every load, and why
`npm run games` reported "no offsite requests" for Faire Weekend the whole time.
The behaviour is right — a preview capture should not be at the mercy of a CDN —
but it is a blind spot with no warning label. Suggested comment at the fulfil
site:

```js
// NOTE: fulfilling these locally means a Google Fonts hotlink never reaches
// page.__blocked, so the "no offsite requests" assertion CANNOT see one. If you
// are checking whether a project still hotlinks type, grep its index.html for
// fonts.googleapis.com. Faire Weekend hid here for two sessions (v7 §5 claimed
// the site made zero offsite requests; it did not).
```

**3. No `gvb-save.js` gap.** I mapped the whole adoption (below) against the
module's API and did not find a missing hook, so there is nothing to request.
`repair` already has exactly the shape this game's `loadState` needs, `defaults`
as a factory covers `createInitialState`, and `mountSaveBar`'s `buttons` option
covers not putting a second eraser next to `#resetBtn`. Saying so explicitly so
the next session doesn't re-derive it.

**4. No board change.** Card title, description, `data-new`, `data-preview` and
the version line are all still correct for this game. The preview and OG images
do not need regenerating — nothing about the game's *appearance* changed except
the type rendering from disk instead of a CDN, which looks identical.

## Deliberately not done

**Fraunces' `wght`-only cut, which would have saved 66,548 bytes.** Fontsource
ships Fraunces in six axis subsets. I took `standard` (opsz + wght, 67,304
normal / 81,520 italic) over `wght`-only (36,620 / 45,656). The optical-size
axis is what the old hotlink requested, and dropping it would change how the
page renders while claiming to be a like-for-like vendoring. Measured Fraunces
sizes on screen run 13.76px to 22.4px, so the axis does modest work rather than
none, and 253.6 KB total is cheap against Golden Hour's 370 KB of sand. Noted in
`assets/fonts/README.md` in case a future session wants the bytes back.

**Adopting `gvb-save.js` this session.** It is the right call and I scoped it
fully (see below), but it is a second persistence change on top of the one I
just made, and stacking them would have meant shipping the report-phase policy
without the by-hand reload test being about the policy alone. Next session, with
the policy already settled and covered.

**The `weekendDay` cosmetic-only finding.** I found it, confirmed it, and left
it — it is a design change, not a bug fix, and it is the largest item on the
list below rather than something to slip in.

**Mobile tap targets.** 375×812 renders correctly with no horizontal overflow,
which is better than I expected, so there is nothing broken to fix. Every tap
target is undersized and that needs a real design pass, not a quick patch. See
below for the measurements.

**Touching `Tools/board-check/**` or the root `index.html`.** Both are prompt
21's. Everything I wanted changed there is a request above.

## Next session

Ordered by value per effort.

1. **Adopt `gvb-save.js`. It is fully scoped and this game is the best remaining
   candidate.** Everything below is checked against the current module, not
   guessed:
   - Keep `key: 'renn-faire-sim-save-v1'` (locked #36). Existing saves carry no
     `__v`, so `normalize()` reads them as version 0.
   - `game: 'faire-weekend'`, `version: 1`.
   - `validate: s => s && typeof s.cash === 'number' && typeof s.day === 'number'`
     — lift the existing check out of `loadState` unchanged.
   - **Everything else in `loadState` goes in `repair`, and `migrate` stays a
     no-op.** The season/`vendorContracts`/`nextPlotId`/`bankrupt`/
     `victoryAchieved` fill-ins, the plot `status`/`w`/`h`/`assignedVendorId`
     backfills and the auto-seat pass all have to run on every accepted load
     whatever the version says. That is locked decision #37 exactly.
   - `defaults: createInitialState` **as a factory**, not a literal — nothing in
     it is randomised, but the factory avoids a deep-copy round trip and makes
     `slot.reset()` usable as-is.
   - Import it **relatively** (`../../../assets/js/gvb-save.js`). `state.js` is
     imported under plain Node by `tests/smoke.mjs`, and Node cannot resolve a
     leading slash. Same trap v7 §1 documented for `campaign.js`.
   - **Mount the save bar in `#footer`, and this closes v7 §9's other open item
     as a side effect.** The Fourth Quarter's bar is stranded on its start
     screen; Faire Weekend has no start screen, and `#footer` is visible in
     every phase including mid-report. Mount `buttons: ['export', 'import']` and
     leave `#resetBtn` alone — mounting gvb's "Start over" beside "Reset
     progress" would be two erasers side by side, which is the same call FQ
     made and the reason the `buttons` option exists.
   - `mountSaveBar`'s `setState` handler must also clear `ui.pendingBuild`,
     `ui.pendingMove` and reset `ui.activeTab` — an import replaces the grounds,
     and a pending placement against the old ones is meaningless.

2. **Give the weekend a shape. Friday, Saturday and Sunday are currently the
   same day three times.** `weekendDay` is set, incremented and displayed, and
   it never reaches the simulation: the only reads outside `state.js`'s own
   bookkeeping are `ui.js:22` (the HUD label) and `ui.js:799` (the game-over
   flavour line). `simulateDay` touches `state.day` once, to stamp it on the
   result. So the game is called Faire Weekend, it names the days, and the days
   are mechanically identical. A per-`weekendDay` attendance multiplier — a real
   faire's Saturday is its big day and Sunday is quieter — turns scheduling into
   an actual decision (spend the expensive act on Saturday, not Friday) for
   about one table in `data.js` and one term in the attendance formula. It also
   gives the Weekend Package contract, which currently just costs 15% less, a
   reason to exist beyond the discount. Add it to the Section 1g
   `SIGNIFICANCE:` class, which is precisely the test class that would have
   caught this: nothing ever asked whether the weekend had a shape.

3. **Drive the wiring nothing has ever clicked.** The 737 assertions are
   engine-level and the DOM tests cover the build flow well, but I mapped every
   `data-action` in `main.js` against both suites and **ten player-facing
   actions have never been clicked in a browser by anything**: `contract`,
   `release`, `hireVendor`'s let-go path, `launchCampaign`, `autoFillStalls`,
   `unassignVendor`, `demolishPlot`, `selectMove`/`moveTo`, `deletePlanningPlot`
   and `renamePlot`. That means the entire Backstage tab and the entire
   Marketing section — Stage 4, Stage 5, Stage 7, Stage 10 — have no
   browser-level coverage at all.

   Worse, and this is the sharp end: **no `change` or `input` event is ever
   dispatched by either suite.** The ticket-price slider, the schedule
   `<select>`s and the vendor-assignment `<select>`s all run through
   `main.js`'s single `$('#app').addEventListener('change', ...)` handler, on a
   completely different event path from every click both suites fire. A
   delegation bug there would be invisible to 737 assertions and 94 checks
   alike. The ticket price is the decision Stage 19 built an entire elasticity
   curve for and nothing has ever moved the slider. This is the
   `day.rebuildStations` shape of risk — 122 passing assertions while New Game
   threw on the first click — and `contract` or the price slider is where it
   would land here.

4. **Mobile: it lays out, but you can't comfortably play it.** At 375×812 there
   is **no horizontal overflow** and the layout reflows properly (`--cell` drops
   to 30px), which is more than I expected. What is wrong is touch: **38 plot
   markers at 26px, buttons at 27–28px, tabs at 40px** — every interactive
   element is under the 44px minimum, and the plot markers are the primary
   interaction. There is also a squeeze at the widest grounds tier: from Weekend
   4 the map is 14 columns and the plat sheet's `overflow-x: auto` means the
   eastern four columns need a horizontal scroll inside the map panel to reach.
   They *are* reachable — I checked, having first assumed they were clipped —
   but there is no affordance saying so. A pinch/pan map or a zoom control plus
   larger hit areas is a real design pass, not a media-query tweak.

5. **Layout/spacing/density review, the item Stage 20 explicitly owed.** Stage
   20's contrast audit was arithmetic-only and said so: "a computed audit is not
   a substitute for looking at the page." I had a browser this session and spent
   it on the two assigned tasks, so the debt stands. Everything is in place to
   pay it now — the server, the game, and `shots/games/` for before-and-afters.

6. **`live: false` on the preview recipe is still correct** (locked #29). The
   game genuinely has still frames while being played. Left alone, and nothing
   should be animated to satisfy a motion check.
