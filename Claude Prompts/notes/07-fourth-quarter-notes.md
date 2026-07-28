# The Fourth Quarter — session notes

## What changed

### The save bar is reachable mid-campaign, in two new places

v7 §9 left this open and guessed the box score. The box score is right, and it is
not enough on its own, so the bar went to both screens that qualify.

`Projects/fourth-quarter/index.html` gained `#boxSaveBar` inside the box score
card, under Tomorrow's Ledger. `Projects/fourth-quarter/js/day.js`'s `doorPanel()`
gained `#doorSaveBar` in the Tonight panel's footer, under Open the Doors.
`Projects/fourth-quarter/js/main.js` mounts all three (start screen included)
through one `mountBar()` function rather than three `mountSaveBar()` call sites,
so there is one export affordance in this game shown in three places, not three
bars that happen to look alike. `css/style.css` has one selector list covering all
three for the same reason.

**Why the box score alone would not have finished the job.** It is reachable once
per night, and a night is eight sim hours at 45 real seconds each: six minutes at
1×. The complaint in v7 §9 is "exporting a campaign mid-week", and mid-week means
during the day. With only the box score, a player who wanted a backup while
planning still had to choose between reloading the page (which is the thing being
fixed) and playing a full night. The Tonight panel closes that: it is the one day
panel that summarises the whole campaign instead of one desk's worth of it, and it
is the last screen before a night that can go badly. Between the two, no point in a
campaign is more than one screen away from an export.

**`buttons: ["export", "import"]` on all three, and `reset` on none of them.** The
start screen keeps the two it had for the reason v7 §1 gives. The other two are
screens a player passes through every single night, which makes them a worse home
for a campaign-eraser than the start screen, not a better one: "Start over" next to
Tomorrow's Ledger is a button you walk past a hundred times a playthrough and
misclick once. The dev menu's "Reset all progress" covers the developer case.
Every button still carries `data-gvb="export|import"`.

**Import mid-campaign, which was the actual design question.** It turns out not to
be a question at either new mount, and that is why these two and not others.
Neither can be reached with a night in progress: the box score only exists after
`lastCall`, by which time `showBoxScore()` has already run `settleNight()` and
`save()`, and the Tonight panel only exists in the day phase. So an import never
has live floor state to discard. `adoptCampaign()` already handled everything else
(tear down night meshes, rebuild the room at the imported tier, restart the day,
and `enterDay()` hides `#boxOverlay` on its way through). One thing it did not
handle: an import from the Tonight panel left that panel open on top of the new
campaign, still showing the old one's forecast and wage bill. `mountBar()`'s
`setState` now closes an open panel first.

Verified in a real browser, including the case where the panel is left open. See
below.

### The box score card can scroll

`#boxOverlay .card` got `max-height:92vh; overflow-y:auto`. Its row count already
varied before I touched it (the Theme and Upgrade-upkeep rows only appear when they
cost something, the Game section only on a Thursday or Sunday), nothing scrolled
it, and I was adding 40px. Measured at 1320×800: card 557px in a 800px viewport,
save bar bottom at 650px, so it fits with room. On a short window it now scrolls
instead of putting Tomorrow's Ledger below the fold.

### Dev menu: "Skip to last call"

`js/dev.js` and `js/main.js`. The box score was the most expensive screen in the
game to look at, which is a bad property for a screen that now hosts a save bar.
Six minutes at 1×, and the 2× button does not help, because **the speed buttons
cannot be clicked while pointer lock is active**: they are DOM buttons and the
canvas owns the mouse. I found that driving the page. `[data-speed="2"]` clicked
cleanly, no error thrown, and `speedOn` stayed at 1 for the whole night.

The button pushes `engine.t` to just under eight hours and lets the next
`engine.update()` do the rest, so it runs the real closing path (hour rolls past 8,
`lastCall` fires, `showBoxScore()` is scheduled) rather than faking a box score. It
reports "No night running" instead of doing nothing when there is no night.

### The legacy-save audit, done on purpose

`repairCampaign()` in `js/campaign.js`, rewritten around a `num(v, fallback)`
helper that takes only finite numbers. The rule the audit produced, written above
the function: every field this game does arithmetic on gets a finite fallback, and
every field it calls a method on gets a type check. `validate` only guards `day`,
`stock` and `staff`, so everything else was arriving unexamined.

Method: load a save missing exactly one field, then run the arithmetic that reads
it. Seven findings, worst first.

| Field | What an old save actually did |
| --- | --- |
| `day` below 1 or fractional | `weekday()` indexes `DAYS[(day-1) % 7]`, so day 0 is `DAYS[-1]` and day 2.5 is `DAYS[1.5]`, both `undefined`. `BASE_CROWD[undefined]` is `undefined`, `forecast()` is NaN, and `NightEngine`'s `crowdTarget ?? 46` keeps the NaN because `??` only catches null and undefined. **Measured: 0 arrivals across a full eight-hour night, nothing thrown, nothing logged.** |
| `cash` missing | Two bugs. `placeOrder()` gates on `cost > c.cash` and every comparison against `undefined` is false, so the distributor handed over 100,000 beers for free. Then the till went NaN and stayed NaN. |
| `wage` on a staffer | `wageBill()` feeds `settleNight()`, so one missing wage put NaN into `cash` and `stats.lifetimeNet` permanently. Applicants need it too: `hire()` moves one onto the payroll unchanged. |
| `stats` present but incomplete | The old check was `if (!c.stats)`, so `{ nights: 3 }` (a save from before `bestNight` and `lifetimeNet` existed) went straight through and both became NaN on the first close. |
| `name` on a staffer | `beginNight()` does `s.name.split(" ")[0]` for every floor role. The only hard throw in the audit. A nameless staffer is also unfireable, since `fire()` matches on name. |
| `skill` non-numeric | The old check was `if (!p.skill)`, which only catches falsy, so `"high"` survived into `roleMult()` and made prep speed NaN for that whole side of the ticket. |
| `upgrades` not an array | The old check was `if (!c.upgrades)`, so an object there made `owned()` throw on `.includes` from the first frame. |

Also tightened, less dramatic: `applicants` non-array (was refusing the whole save,
now loads empty), stock values, `darkNightsLeft`, unknown `venue` and `promoTonight`.

Two things worth carrying forward. **`JSON.stringify` writes NaN and Infinity as
`null`**, so any number that went bad in memory before a save comes back looking
like an absent field, which is why `num()` treats null as missing. And **`typeof
NaN` is `"number"`**, so the `typeof p.speed !== "number"` check from last session
would wave through a live NaN. It cannot get one through a save file, but the slot
runs `repair` on the campaign the game already holds, so it can get one in memory.

`js/engine.js` got the same treatment on the constructor: `fin()` plus finite
guards on `crowdTarget`, `hourLenSec`, `seats`, `foodMult`, `drinkMult` and
`beerMult`. Second line of defence, because the engine should never quietly play an
empty night whatever the caller hands it. `foodMult` floors at 0 rather than 1,
because 0 is meaningful there: no cook on shift, kitchen's closed.

One refactor fell out: `wageForSkill(skill, jitter)` now backs both
`rollApplicants()` and the repair's wage fill, so the two cannot drift. Identical
arithmetic to what `rollApplicants` had inline.

### README

`Projects/fourth-quarter/README.md`: the save section now has the three-mount
table and says why `reset` is off everywhere, the controls section documents the
dev menu and the pointer-lock trap on the speed buttons, and the file list points
at `repairCampaign()`'s note as the audit write-up.

## What I verified

Baseline before I started: 137 and 179, matching v7.

- `node test/smoke-campaign.mjs` → **189 passed, 0 failed** (was 137). 52 new
  assertions, one or more per audit finding.
- `node test/smoke-engine.mjs` → **190 passed, 0 failed** (was 179). 11 new,
  covering the engine's finite guards and the empty-night case end to end.
- **Locked decision #34, all 14 guards.** I put each bug back one at a time,
  reverting the guard to exactly what it replaced (`if (!c.stats)`,
  `if (!p.skill)`, `?? 46`, and so on), ran the owning suite, and confirmed it went
  red before restoring. Script in the scratchpad. First pass: **12 red, 2 stayed
  green.** The two were `speed` and `darkNightsLeft`, and the reason is worth
  keeping: my assertions used `null` and a string, both of which the old `typeof`
  check already caught, so they proved nothing. I added the assertions that
  distinguish them (a literal NaN through `repairCampaign()` directly, and a
  negative and fractional countdown). Second pass: **14 red, 0 untested.**
- **Save bars in real headed Chrome, 21 checks, 0 failed.** Own script, same
  harness `play-games.mjs` uses, at 1320×800. Covers: all three bars mount
  `export,import` and nothing else; re-opening the Tonight panel rebuilds its bar
  rather than stacking a second pair; exporting mid-day writes an envelope matching
  the campaign as it stands with no reload; the dev skip reaches the box score;
  exporting there writes the settled night; importing at the box score restores an
  older campaign, hides the overlay and lands in the day phase; importing from the
  Tonight panel closes the panel; the doors still open afterwards; the bar is
  inside the viewport; `page.__blocked` empty. Screenshots of both new bars in the
  scratchpad.
- `npm run check` → **250 units, 0 broken; 0 collisions across nine widths.**
  (250, not v7's 235, because other threads have added pages this session.)
- `npm run social:check` → **23 notices, 23 already current.**
- `npm run games` → **94 checks, 0 failed.** Every existing fourth-quarter beat
  still passes untouched, which is the point: the start-screen bar is exactly what
  it was, `#saveBar` is still `export,import`, and the two new mounts are additive.
  Worth knowing for scheduling: port 8126 was held by another thread's run for the
  first 3.5 minutes and the suite dies with `EADDRINUSE` rather than waiting, so I
  queued behind it. v7's "only one at a time" is a hard requirement, not advice.
- Four full nights driven in headed Chrome for the audit half of task three: one
  at the flagship for frame time (Next session item 7), and a Corner Tap versus
  flagship A/B on the same Thursday (item 2). The A/B is there because I had
  written down that the flagship was probably a worse night than the Corner Tap,
  and it is not. Numbers in item 2, along with why they should be seeded before
  anyone leans on the digits.

## Shared-file requests

**`Tools/board-check/play-games.mjs`, the `fourth-quarter` suite.** The existing
beats all still pass, because the start-screen bar is untouched and `#saveBar` is
still `export,import`. What is untested is both new mounts. Suggested beats, in the
order they fit the existing script, all of them draft-verified in my own runner:

1. After `#startBtn` and the dev-menu warp, before opening the doors, press `KeyE`
   at the door ring and wait for `#panelOverlay [data-opendoors]`. Assert
   `#doorSaveBar button` is exactly two buttons with `dataset.gvb` reading
   `export,import`. Then click `#panelClose`, press `KeyE` again, and assert it is
   still exactly two: the bar is mounted on every render of that panel, and the
   thing that would break is duplication.
2. With the `URL.createObjectURL` hook already installed, click
   `#doorSaveBar [data-gvb="export"]` and assert the envelope's `state.day` and
   `state.cash` equal the current `savedState()`. This is the beat that proves the
   feature: an export mid-campaign with no reload in it.
3. `#devOverlay [data-skipclose="1"]` is new and is the cheap way to a box score.
   Open the doors, press Backquote, click it, then
   `waitForFunction(() => boxOverlay.style.display === 'flex')`. Budget 20s. Without
   it, reaching the box score costs six real minutes, because the 1×/2× buttons are
   not clickable under pointer lock.
4. At the box score, assert `#boxSaveBar button` is `export,import`, and assert
   **no** `[data-gvb="reset"]` at either new mount.
5. The import beat worth having, using the existing `setFiles()` helper: export at
   the box score, click `#nextDayBtn`, use the dev menu to move the campaign on
   (`[data-cash]`, `[data-day="7"]`), get back to a box score via `[data-skipclose]`,
   then `setFiles(exported, () => page.click('#boxSaveBar [data-gvb="import"]'))`.
   Assert the day came back, `#boxOverlay` display is `none`, and `#hHour` reads
   `DAY`. That last pair is the actual risk in this change: an import that leaves a
   box score sitting on a campaign it no longer describes.
6. Same shape for the Tonight panel, asserting `#panelOverlay` display is `none`
   afterwards.

No `gvb-save.js` gap found. `mountSaveBar` already does everything three mounts
need, `buttons` already covers the reset question, and `data-gvb` already makes the
new bars clickable without label matching. Nothing to add to the module, and I did
not touch it.

## Deliberately not done

**No fourth mount, and no pause menu.** The obvious "reachable anywhere" answer is
Esc opening a menu, and it does not work here: in pointer lock, Chrome consumes the
first Esc to release the lock and it cannot be prevented, so an Esc menu is either
a two-press affordance or a fight with the browser. The four other day panels
(Stock, Crew, Theme, Upgrades) are task-specific desks, and a save bar in each is
four more copies of one control, not more reach. Three mounts covers the day and
the close, which is the whole loop.

**The venue ladder has no player-facing UI at all, and I left it that way.** This
is not a save-bar issue, it is the biggest thing I found and it is too big for what
was left of this session. `moveVenue()`, `canMoveVenue()`, `nextVenue()` and
`settleDarkNight()` are all written, tested (the Node suite covers the whole ladder)
and unreachable: there is no Real Estate station in `day.js`, and `main.js` passes
`onMove: rebuildVenue` and `closedNight` into `DayPhase`, which never calls either.
The only way a player reaches the Fieldhouse is the dev menu's warp, which is free
and skips the dark nights. So the cash gates ($5,500 / $15,000 / $34,000), the
one-way lease, and the dark-night settlement are all dead content in the shipped
game. Details and a plan in Next session.

**Nothing done about the 12.9 MB of WAV.** Measured, not fixed: see Next session.
It is a conversion job plus a listen, and doing it badly is worse than not doing it.

**`buildWorld()`'s unused venue argument left alone.** `main.js` calls
`buildWorld(scene, campaign.venue)` and the function signature is
`buildWorld(scene)`. `day.js`'s `rebuildStations()` comment already documents this
and says the moment a tier gets its own floor plan is when it matters. Deleting the
argument would remove the marker; wiring it up is the venue-ladder job below.

## Next session

Ordered by value per effort.

1. **Give the venue ladder a door into the game.** A Real Estate station in
   `day.js` calling `C.moveVenue()` through the `onMove` callback that is already
   wired, plus the dark-night settlement through `closedNight`, which is also
   already wired. The economics, the tests and both main.js callbacks exist; what is
   missing is a ring on the floor and a panel. This is the cheapest large win on the
   board: it turns four tiers of written content on.
2. **Then fix the seat count, which is a live bug the moment item 1 ships.**
   `buildWorld()` ignores the venue argument `main.js` passes it and builds the
   same room every time, so ROOM/KITCHEN/DOOR are identical metres at all four
   tiers. The only differences are `seats` (30/44/60/80) and `buzzMult`
   (1.00–1.50). **The room has exactly 30 physical seats**: 6 bar stools plus 6
   tables of 4, in a fixed `seats` array built once at module load in `world.js`.
   That matches the Corner Tap's cap exactly and nothing above it.

   `NightEngine` gates arrivals on `inBar < this.seats`, so at the flagship it will
   admit up to 80. `Patron`'s constructor calls `freeSeat()`, and
   `js/patrons.js:89` reads
   `if (!this.seat) { this.state = "leaving"; engine.walkout(this.id); }`. So a
   patron who arrives once 30 are seated is an instant walkout: `walkouts++`,
   `mood -= 0.03`, `serviceRate` drops.

   **I assumed that made the flagship a bad deal, ran the A/B, and it does not.**
   Same Thursday game night, same starting two-person crew, same full shelves, only
   the tier different:

   | tier | forecast | peak in room | served | walkouts | service | net |
   | --- | --- | --- | --- | --- | --- | --- |
   | Corner Tap | 51 | 23 | 44 | 24 | 65% | +$85 |
   | flagship | 77 | 29 | 54 | 36 | 60% | +$158 |

   The ladder pays: 86% more net for the top tier, because rent and wages are flat
   and the extra crowd converts. Service degrades but does not collapse. So the
   $34,000 is not wasted, and the thing to fix is narrower than I first wrote:
   **the `seats` numbers on the tiers are inert.** Peak occupancy is 23 and 29
   against 30 physical seats, so 44, 60 and 80 never gate anything and never will.
   Every bit of a tier's value comes from `buzzMult`. Either build real rooms per
   tier so the caps mean something, or derive `VENUES[].seats` from
   `world.seats.length` and drop the pretence.

   Caveat on all six numbers: `engine.js`'s `seed()` is never called in the game, so
   these are single unseeded runs and they move. An earlier flagship night on the
   same setup came out 42 walkouts, 51%, +$56. Treat the direction as real and the
   digits as approximate, or seed the run.
3. **The night loop has no difficulty curve, and it is one line to confirm.**
   Nothing reads `c.day` except `weekday()` and the HUD. Rent is a flat $110 at
   every tier and every day. Wages are your own roster, upgrade upkeep is opt-in,
   and crowd goes up with tier. So cost is fixed and revenue only grows: day 40 is
   strictly easier than day 4, and there is no fail state anywhere (negative cash
   turns the HUD red and the door panel warns, and nothing else happens). Decide
   whether that is intended (a sandbox) or whether rent should scale with the tier,
   which is the smallest lever that would make the ladder a decision instead of a
   reward.
4. **Convert the WAVs.** `audio/` is 14.2 MB, and 12.9 MB of that is five
   uncompressed WAVs: `patron-storm-out.wav` 3.7 MB, `stinger-kickoff.wav` 3.6 MB,
   `qte-sizzle-loop.wav` 3.3 MB, `qte-pour-loop.wav` 2.1 MB,
   `stinger-final-whistle.wav` 477 KB. The other ten files are OGG or MP3 and come
   to 1.4 MB together. The size is not the real problem: `playSfx()` builds the
   `Audio` element on first play, so the 3.7 MB storm-out downloads **the first time
   a patron gives up**, mid-night, and the clone is asked to play before it has
   buffered. Same for the kickoff stinger two sim hours into a game night. Convert
   to OGG at the same settings as the ones that are already OGG, and consider
   warming the cache on `beginNight()`.
5. **There is no way to turn the sound down.** `setMuted()`, `isMuted()` and
   `setMasterVolume()` are exported from `audio.js` and have no callers anywhere.
   The bar bed is a 1.2 MB loop that starts on Open the Doors at 0.35. A mute toggle
   in the score bug is small and the API is already there.
6. **Mobile: write down that it is not supported.** Pointer lock plus WASD plus a
   `#controls-hint` that names four keyboard controls is not a touch game, and the
   honest answer is a note in the README and on the board card rather than a
   touch-controls project. Worth one paragraph so nobody re-opens it.
7. **Frame time is not a problem, and here are the numbers so nobody has to
   wonder again.** Measured in real headed Chrome at 1320×800, flagship tier,
   Thursday game night, sampling a full eight-hour night in 6-second windows.

   | | empty room | peak (29 patrons, 9 PM) |
   | --- | --- | --- |
   | median frame | 6.9 ms (145 fps) | 7.0 ms (143 fps) |
   | p95 frame | 7.4 ms | 21.1 ms |
   | worst frame | 8.4 ms | 48.7 ms |
   | visible meshes | 157 | 353 |
   | triangles | 9.2k | 24.6k |

   Median does not move at all. The number that moves is p95, 7.4 ms to 21.8 ms,
   so the busiest hour has occasional 20–50 ms frames rather than a lower steady
   rate. 24.6k triangles is nothing; if that hitch is ever worth chasing it will be
   per-patron `update()` work or material count, not geometry. Roughly 5 meshes and
   500 triangles per patron, so even a genuine 80-patron room lands near 550 meshes
   and 35k triangles.

   A measuring note for whoever does this next: **do not hook
   `WebGLRenderer.prototype.render`.** In three r160 the renderer assigns
   `this.render = function ...` as an own property on the instance, so the
   prototype patch never fires and you get zero frames. This is v5 §4's warning and
   I walked into it anyway. `requestAnimationFrame` for frame time and a
   `window.__scene` traverse for mesh and triangle counts both work.
