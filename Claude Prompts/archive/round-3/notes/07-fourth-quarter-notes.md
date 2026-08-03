# The Fourth Quarter — session notes

## What changed

### The open design question is closed: spoilage, not rent-creep or a losable lease

The prompt's "Questions for Devon" asked which shape the day-based difficulty
curve should take, with three options on the table (rent creeping with the
calendar, a lease that can be lost, spoilage) plus "leave it a sandbox."
Devon picked **spoilage**, asked directly before any code changed. This
session is that build.

### Food rots overnight; beer and soda don't

`js/campaign.js` imports `FOOD` from `engine.js` (already existed there —
`["wings","burger","nachos","fries"]`) and adds:

- `SPOILAGE_RATE = 0.15` — the fraction of on-hand *food* stock lost every
  closed night, settled or dark alike.
- `applySpoilage(c)` — for each food item, rots `Math.round(have * 0.15)`
  servings off the shelf and returns `{ byItem, value }` (servings lost per
  item, and their combined wholesale dollar value from `STOCK_COST`).

Beer and soda are deliberately exempt — kegs and cans don't need a walk-in
the way raw wings and ground beef do, which is the exact distinction the
project's own README roadmap had already drawn before this session touched
it ("spoilage ... would unlock a Commercial Walk-In-style upgrade"). That
upgrade, when it exists, is the right lever to cut this rate later — not a
reason to change the rate itself now.

Both settlement points call it:

- `settleNight(c, summary, rand)` — spoilage runs after `stats.lifetimeNet`
  updates and before `c.day++`, so it rots whatever the night actually left
  on the shelf, not what was there at open.
- `settleDarkNight(c, rand)` — a closed "moving in" night has no patrons, but
  the walk-in doesn't know that. Spoilage runs here too, same rate, same
  function.

Both now return a `spoilage: { byItem, value }` field in their result object.

### The box score and the dark-night tick both say so

`js/main.js`:

- `showBoxScore()` gets one new row in "The Floor" section: **Spoiled
  overnight** — serving count, styled `bad` when nonzero, with the wholesale
  dollar value in parentheses. It doesn't touch the Net line — spoilage is a
  sunk inventory loss (the stock was already paid for at order time), not a
  new cash transaction tonight.
- `closedNight()` (the dark-night settlement, no box score screen) adds a
  ticker line — `"N servings spoiled in the walk-in while the doors stayed
  shut."` — only when `spoiled > 0`, so a lease move doesn't go silent about
  the same mechanic just because there's no box score to show it in.

### The Stock panel says so up front, not just after the fact

`js/day.js`'s `stockPanel()` gained one hint line stating the rate (read live
off `C.SPOILAGE_RATE`, not a hardcoded "15%" that could drift from the real
number) and that beer/soda are exempt — so a player learns the mechanic by
reading the panel before their first order, not by being surprised at the
box score three nights later.

### README updated in two places

- The day's-decisions **Stock** bullet no longer says "no spoilage yet —
  that's a later sprint." It says what actually happens now.
- **Roadmap item 2** ("a difficulty curve tied to the calendar") is marked
  decided-and-partly-built: rent-by-tier (session 2) plus food spoilage
  (this session) answers the cost-curve half. What's still open, stated
  explicitly: there's still no fail state beyond a red HUD number and a
  warning — this is a cost curve, not a lease-can-be-lost mechanic. Also
  named `SPOILAGE_RATE` as the one number to retune if 15%/night feels wrong
  once it's actually been played for more than a scripted test.
- Roadmap item 3 now names a Commercial Walk-In upgrade as the future lever
  for cutting the rate, rather than listing spoilage itself as unbuilt.

## What I verified

- `node test/smoke-campaign.mjs` → **203 passed, 0 failed** (was 196). 7 new
  assertions: beer/soda never spoil; every food item loses stock overnight
  when nothing sold; the amount lost matches `SPOILAGE_RATE` of what was on
  the shelf; `settleNight` reports both the per-item breakdown and a
  wholesale dollar value; a dark night (no patrons) still rots the shelf
  (15% of 20 rounds to 3, asserted exactly); nothing spoils when the shelf is
  already empty; spoilage never takes stock negative.
- `node test/smoke-engine.mjs` → **190 passed, 0 failed** (unchanged —
  spoilage is entirely a `campaign.js` concept; `engine.js` wasn't touched).
- **Locked decision #34, verified by reintroducing the bug.** Set
  `SPOILAGE_RATE` to `0`, reran the suite: the 3 new assertions that depend on
  food actually rotting failed exactly as expected (`every food item loses
  stock overnight`, `settleNight reports what spoiled`, `a dark night still
  rots the shelf`), the other 200 stayed green. Restored to `0.15`, reran:
  203 passed again.
- **A real headed-Chrome playthrough, not just Node.** This session's
  environment is Windows (win32), which means `Tools/board-check/harness.mjs`
  drives real Chrome via `playwright-core`, not the Linux/software-rendered
  `puppeteer-core` branch locked decision #53 warns about — so real-time
  movement here is the fair case, not the inconclusive one. Wrote a
  throwaway script in the scratchpad (imports `harness.mjs`/`drive.mjs`/
  `games.mjs` from `Tools/board-check` by absolute path, doesn't edit them),
  reusing the same helpers `play-games.mjs` does:
  - Loaded the game for real, filled stock to 500 via the dev menu, walked a
    real path through the kitchen doorway to the Stock station (a straight
    line hits the wall east of the doorway gap — had to route through a
    waypoint at the doorway itself, same geometry `world.js`'s `DOORWAY`
    describes), pressed E, and confirmed the Stock panel's hint text matches
    both new sentences.
  - Walked back out, to the door ring, opened a night, used the dev menu's
    "Skip to last call," and confirmed the box score's new "Spoiled
    overnight" row reads **"300 servings (~$802.50 wholesale)"** — exactly
    15% of 500 × 4 food items (300), and exactly that many servings' worth of
    `STOCK_COST` (75 × (3.2+3.8+2.5+1.2) = $802.50). Screenshot taken;
    matches the panel CSS with zero new classes, same as every other row in
    that table.
  - Confirmed via the save (`localStorage['fq3d-save']`) that beer and soda
    stayed at their filled 500, untouched.
  - 10/10 checks passed. Note for whoever needs the script: it required a
    ~1.8s wait before re-requesting pointer lock after an interact-triggered
    exit, or Chrome's re-lock hardening fires `pointerlockerror` on every
    retry — a shorter wait (200ms, my first attempt) failed consistently.
    Didn't dig into whether that threshold is exactly 1.25s or specific to
    two unlocks happening close together; just noting the number that worked.
- **Did not run `npm run games fourth-quarter`.** Port 8126 was already
  bound when I tried — another thread is genuinely running the shared suite
  right now, and the prompt's own scheduling note says only one at a time.
  Didn't force it. See Next session.

## Shared-file requests

None this session. Nothing here touches `gvb-save.js` or any file outside
this project's own boundary.

## Deliberately not done

**Rent creeping with the calendar, and a losable lease** — the other two
options "Questions for Devon" put on the table. Devon picked spoilage
directly; these aren't half-built anywhere, just not the chosen shape.

**A fail state.** Spoilage is a cost curve — hoarding food now has a real,
compounding downside — not a loss condition. There is still no way to
actually lose the game beyond watching the cash number stay red. If Devon
wants a real fail state later (game over, forced venue downgrade, something),
that is a separate, bigger design question from the one this session
answered, and I didn't invent one on my own initiative.

**Distinct floor plans per venue tier.** Unchanged from round 2 — still real
3D layout work (collider placement, station repositioning, lighting), still
not urgent since nothing currently lies about what the tiers do.

**The Real Estate suite's walk-to-station bug in `Tools/board-check/drive.mjs`.**
Still not my file. Still blocked on `walkTo()`'s `aimAt()` doing a raw
`camera.rotation.set(...)` write that this project's hand-rolled
yaw/pitch-driven camera stomps every frame (locked decision #35's exact
warning). My own scratch script sidesteps this by using `turnBy()`/real
mousemove dispatch instead of `aimAt()` — that's the fix `walkTo()` itself
needs, not something I can apply inside my boundary.

## Next session

Ordered by value per effort.

1. **Re-run `npm run games fourth-quarter` (or the full suite) once nothing
   else is using port 8126.** I independently confirmed this session's
   environment supports real GPU-composited movement (headed Chrome via
   `playwright-core`, not the Linux/swiftshader branch) — worth checking
   whether the Real Estate suite that v9's handoff flagged as
   "added, unverifiable in this environment" actually passes here now. I
   didn't get to run it myself; another thread had the port.
2. **Watch how `SPOILAGE_RATE = 0.15` actually feels once played for real,
   not just scripted.** The number was chosen to be meaningful without being
   punishing (roughly 3-5 servings a night on a modest order), but a scripted
   test can't tell you if it's fun. One number to tune in `campaign.js` if
   it's off.
3. **Distinct floor plans per venue tier**, if the ladder is ever meant to
   feel physically bigger. Still not urgent, still the same size of task as
   every prior round said.
4. **A real fail state**, if Devon wants one — separate design question from
   this session's. Options in the same spirit as this one: a lease that can
   actually be lost, a bankruptcy/game-over threshold, something else.
5. **Fix `drive.mjs`'s `walkTo()`/`aimAt()` for hand-rolled camera controls**
   (uses `turnBy()`-style real mousemove instead of a raw rotation write) —
   `Tools/board-check`'s file, flagged again since it's still open, not
   re-investigated this round beyond confirming the workaround still works.
