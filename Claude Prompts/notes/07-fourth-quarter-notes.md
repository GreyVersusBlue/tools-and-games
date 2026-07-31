# The Fourth Quarter — session notes

## What changed

### The venue ladder has a door into the game

`js/day.js` gained a fifth station, Real Estate, at (6.7, 0, -0.8) — open
ground east of the room, clear of every table and the bar. Its panel
(`realEstatePanel()`) shows the next rung (name, cost, description, the draw
bump from `buzzMult`, the new rent, the dark-night count) and a Sign the Lease
button that calls `C.moveVenue()`, then `cb.onMove()` — `rebuildVenue()` in
`main.js`, wired since round 1 and never called until now. Three states:
top of the ladder (nowhere to climb), a move in progress (redirects to the
door panel), and the normal case.

The door ring's panel now branches on `c.darkNightsLeft`. Zero, and it's the
same "Open the Doors" panel as always — unchanged HTML, unchanged behavior.
Above zero, `doorPanel()` returns `darkNightPanel()` instead: no forecast, no
crew list, just the day, which venue is moving in, the countdown, and a
"Push Through the Night" button wired to `cb.closedNight()` — also wired
since round 1, also never called until now. One click = one closed night,
same unit as `settleDarkNight()`. The save bar mounts in both panels' footers
the same way it already did in the old one.

`moveVenue()`/`canMoveVenue()`/`nextVenue()`/`settleDarkNight()` themselves
are untouched — round 1's Node suite already covered the whole ladder. This
was a UI and flow problem, exactly as the prompt said: a ring on the floor
and a panel, nothing in the economics.

### The seat count: honest now instead of fake

Two separate things were wrong here, not one.

**The tiers' `seats` numbers never gated anything**, because `buildWorld()`
ignores the venue argument `main.js` passes it and always builds the same
30-seat Corner Tap room. `VENUES[].seats` (30/44/60/80) fed `NightEngine`'s
cap directly, so at every tier above the Corner Tap the engine thought it had
more room than the floor actually had. I didn't build four floor plans — that's
a real 3D-modeling task and out of scope for what was left of this session —
I did the other option the prompt named: `main.js`'s `beginNight()` now reads
`seats: seats.length` (the actual room, imported from `world.js`) instead of
`C.venueDef(campaign).seats`, so the engine's cap can never again say something
the room doesn't back up. `VENUES[].seats` is now 30 at every tier, with a
comment saying why, instead of four numbers that looked like content and
weren't.

**`buildWorld()` never cleared `seats`/`colliders` between calls, and the
ladder going live means it now runs on every real playthrough.** Both are
module-level arrays in `world.js`, appended to by `addSeat()`/`blockCollider()`
inside `buildWorld()`, and nothing ever reset them. `main.js`'s
`rebuildVenue()` calls `buildWorld()` again on a signed lease, a dev-menu
warp, or "New Game" — all three already existed before this session, so this
bug predates the ladder — and every call silently appended another room's
worth of seats and colliders on top of the last, all sitting at the exact
same coordinates since the room never changes shape. Invisible in a browser
(the old stool meshes leave with the group they belonged to) until
`freeSeat()` or the collision check is working a list several rooms deep.
Fixed with three lines at the top of `buildWorld()`:
`seats.length = 0; colliders.length = 0; seatId = 0;`. Reintroduced the bug
and watched it fail per locked decision #34 — see below — before trusting
the fix.

### Rent scales with the venue tier

Task three's finding: nothing reads `c.day` for difficulty, rent was a flat
$110 everywhere, and the venue ladder had no downside — a same-night A/B last
session found the flagship paying 86% more net than the Corner Tap on
identical bills. `campaign.js`'s `VENUES` now carries a `rent` field per tier
(110 / 160 / 210 / 260, $50 up each rung) and a new `rent(c)` accessor reads
the campaign's current venue. `settleNight()` and `settleDarkNight()` both
call it instead of the flat `RENT` constant. `RENT` itself is unchanged and
still exported — it's the Corner Tap's own number now, not a sitewide flat
rate.

**This is a decision, written down, not the whole difficulty-curve question.**
It does what the prompt asked for the cheapest: the ladder now costs more to
run at the top, so climbing it is a tradeoff again instead of a pure
upgrade. It does **not** touch the other half of task three — nothing reads
`c.day` for anything, so day 40 within one tier is still exactly as easy as
day 4, and there's still no fail state. See Deliberately not done.

### The five uncompressed WAVs are OGG now

`audio/sfx/events/patron-storm-out.wav` (3.7 MB), `stinger-kickoff.wav`
(3.6 MB), `stinger-final-whistle.wav` (477 KB), and
`audio/sfx/qte/qte-sizzle-loop.wav` (3.3 MB), `qte-pour-loop.wav` (2.1 MB) —
converted to OGG Vorbis at `-q:a 5 -ar 44100`, matching the sample rate of
every other file in `audio/` (bitrates land 79-181 kbps, in the same range as
the existing OGGs: `order-ding.ogg` 144 kbps, `bar-bed-crowded-pub-loop.ogg`
179 kbps). `audio/` is 2.3 MB now, down from 14.2 MB. `js/audio.js`'s `SFX`
and `LOOPS` maps point at the new filenames; the WAVs are deleted, not kept
alongside.

The size wasn't the only problem, so I also did the other half of the
prompt's suggestion: `audio.js` gained `preload(...keys)`, which builds (but
doesn't play) the `Audio`/loop element for a list of keys, and
`main.js`'s `beginNight()` calls it with all five formerly-WAV keys at the
top of the night — before the storm-out clip's first real trigger (a patron
giving up, mid-night) has to be the moment the browser first fetches it.

### The mute toggle has a UI control

`setMuted()`/`isMuted()`/`setMasterVolume()` were exported from `audio.js`
since some earlier session with zero callers. `index.html`'s score bug gained
one button (`#muteBtn`, next to the 1×/2× speed buttons) that calls
`audio.setMuted(!audio.isMuted())` and swaps its own icon (🔊/🔇). No changes
to `audio.js`'s API — it already did everything this needed.

### Two smaller items from round 1's notes

Wrote the mobile-not-supported paragraph into the README (pointer lock +
WASD + a keyboard-only controls hint is not a touch game, and that's the
honest answer). Left the frame-time numbers alone — they're already recorded
and nothing this session touched rendering.

## What I verified

- `node test/smoke-campaign.mjs` → **196 passed, 0 failed** (was 189). 7 new
  assertions: rent scales strictly up the ladder and moves with `devWarpVenue`,
  the Corner Tap's own rent still equals the `RENT` constant, every tier's
  `seats` field is the same 30. 2 existing assertions fixed to expect the
  Fieldhouse's own rent instead of the old flat `RENT` at the point in the
  file where `c` is parked at that tier.
- `node test/smoke-engine.mjs` → **190 passed, 0 failed** (unchanged —
  `engine.js` itself wasn't touched; the seat cap fix is entirely in
  `main.js`/`world.js`, upstream of what this suite drives).
- **Locked decision #34, both changes verified against the bug they fix.**
  Reverted the `rent: 160` back to `110` on the Fieldhouse: 2 red
  (`rent strictly increases up the ladder`, `Fieldhouse's rent is more than
  the Corner Tap's`), rest green. Restored, both green again. Separately,
  commented out the three `seats.length = 0; colliders.length = 0; seatId = 0;`
  lines in `world.js` and reran my own browser script (below): seats/colliders
  grew by 30/11 on every rebuild (30→60→90→120 across three dev-menu warps,
  and 60 again after a "New Game" that should have reset it to 30) — the exact
  failure mode the fix exists for. Restored, all green.
- **`npm run games` could not run — root cause found, unrelated to this
  project's code.** `page.waitForFunction(fn, null, { timeout })` — the
  pattern used by every headed-suite script in `Tools/board-check/`
  (`drive.mjs`, `games.mjs`, `capture-previews.mjs`, `play-castle.mjs`, and
  nine call sites in `play-games.mjs` itself) — throws
  `Cannot read properties of null (reading 'polling')` under the
  `puppeteer-core` version `npm install` resolves in this environment
  (24.43.1, against `"^24.0.0"` in `package.json` with no committed
  `package-lock.json`, which is itself gitignored). Reproduces on a blank
  `data:` URL page with nothing loaded — confirmed with a five-line repro
  before touching this project's code at all, and confirmed again in both
  headed and headless mode. `puppeteer-core`'s `Realm.waitForFunction`
  defaults `options` to `{}` only when the caller omits the argument or
  passes `undefined`; an explicit `null` (which is what every one of those
  call sites passes) skips the default, and `WaitTask`'s constructor then
  does `options.polling` directly. This is a Shared-file request, not
  something I fixed — `Tools/board-check/**` isn't mine — see below.
- **Verified the actual feature in headless Chrome instead, since the shared
  suite couldn't run.** Two throwaway scripts in the scratchpad, reusing
  `harness.mjs`'s `serve`/`launch`/`prepPage` (imported, not edited) but with
  every `waitForFunction` call written as `(fn, { timeout })` or with a
  hand-rolled poll loop instead of the broken `(fn, null, {...})` shape.
  28 checks total, 0 failed:
  - Walking to the Real Estate station and pressing E opens the panel;
    it names the Fieldhouse and its $5,500 cost; Sign the Lease is present
    and enabled once cash covers it.
  - Signing the lease: campaign moves to `fieldhouse`, `darkNightsLeft`
    becomes 1, exactly $5,500 leaves the till, the panel closes itself
    before the world rebuilds, and `world.js`'s `seats` array is still
    exactly 30 afterward (the leak-fix check, live).
  - The door ring during the dark night opens a panel titled "Tonight"
    describing the move in progress, with no "Open the Doors" button and a
    "Push Through the Night" button in its place.
  - Pushing through: `darkNightsLeft` clears to 0, the day advances by
    exactly one with zero patrons, cash drops (rent + wages + upkeep, no
    revenue), and the door ring's panel reverts to the normal one.
  - Warped through all three moves via the dev menu on one page load (the
    same repeated-`buildWorld()` path a lease, a warp, or "New Game" all take)
    — seats stayed at exactly 30 after every one of the three rebuilds, and
    again after a subsequent "New Game" wipe.
  - Opened a real night at the flagship tier (no dark nights pending after a
    dev warp) and confirmed the clock actually started (`#hHour` left "DAY").
  - The mute button toggles its own icon on click.
  - No audio-related request or console errors from the five new `.ogg`
    files.
  Screenshots of the Real Estate panel and the dark-night door panel are in
  the scratchpad; both render correctly against the existing panel CSS with
  zero new classes.
- `npm run check` → **325 units, 1 broken** (`newindex.html`, offsite
  Google Fonts hotlinks) and `npm run check-collisions` (run separately,
  since `check` chains them with `&&` and the integrity failure stops it) →
  **0 collisions, tightest gap 3.5px.** Neither result involves anything I
  touched — `newindex.html` isn't in my boundary and I never opened it. Not
  fixed, flagged below.
- `npm run social:check` → refused to run: **"only parsed 17 notices out of
  index.html — the notice markup has changed shape."** `index.html` at the
  repo root is explicitly not mine to edit (locked decisions #9/#31, Prompt
  21's file). Not fixed, flagged below.

## Shared-file requests

**`Tools/board-check`'s `waitForFunction` calls are broken against the
`puppeteer-core` version this environment actually installs, and it isn't
a fourth-quarter-specific problem — every headed suite on the board is
affected.** Exact fix, either of:

1. Change every `page.waitForFunction(fn, null, { ... })` (and the two
   argument-less `null` forms, `drive.mjs:58` and `games.mjs:165`) to
   `page.waitForFunction(fn, { ... })` — dropping the literal `null` lets
   `Realm.waitForFunction`'s own `options = {}` default apply. Call sites:
   `drive.mjs:58`; `play-games.mjs:68, 112, 125, 156, 264, 531, 643, 749, 781,
   797`; `capture-previews.mjs:261, 332`; `games.mjs:165, 217`;
   `play-castle.mjs:386`.
2. And/or pin `puppeteer-core` to a version whose `WaitTask` tolerates a
   literal `null` again, and commit `package-lock.json` (currently
   gitignored in `Tools/board-check/.gitignore`) so the resolved version
   stops floating on every fresh `npm install`.

I'd do (1) regardless of (2) — relying on exact patch-version behavior of an
unpinned dependency is how this broke silently in the first place. Reproduced
with a 15-line script against a blank `data:` page; happy to hand that over
if it helps whoever picks this up.

**A Real Estate suite for `play-games.mjs`, since the existing one never
reaches the venue ladder.** Beats I already draft-verified in my own runner
(exact selectors, exact assertions):

1. After the dev-menu cash bump, teleport isn't available to a real script —
   walk there instead: from spawn, that's roughly forward-and-right to
   `(6.7, -0.8)` in world space (east side of the room, past the last table).
   Simplest reliable approach: use the dev menu's cash, then drive the
   camera the same way `lookAt()`/movement already works elsewhere in
   `drive.mjs`, holding `KeyD`/`KeyW` for a measured duration. (My own
   verification script teleported `window.__cam.position` directly, which
   isn't available to a script that doesn't already have scene-probe access
   wired the way I had it — `play-games.mjs` does have `attachSceneProbe`
   via `t.probe()`, so this is very doable, just needs the walk timed once
   by hand the way Daredevil's Continue-count was.)
2. At the Real Estate panel: assert `#panelTitle` is `Real Estate`,
   `[data-signlease="1"]` exists, and its `disabled` state matches whether
   `savedState(p, 'fourth-quarter').cash >= 5500`.
3. Click it; assert `savedState(p, 'fourth-quarter').venue === 'fieldhouse'`
   and `.darkNightsLeft === 1`, and that `#panelOverlay` is `none` (it closes
   itself — rebuilding the world under an open panel was the wrong call).
4. Press `KeyE` at the door ring (same spawn-adjacent position the existing
   suite already uses): assert `#panelTitle === 'Tonight'`,
   `[data-opendoors="1"]` is **absent**, `[data-closednight="1"]` is present.
5. Click it; assert `darkNightsLeft === 0` and `day` advanced by exactly 1
   with cash lower than before (rent+wages+upkeep, no revenue — there's no
   "took in $0" line to assert against directly, just the cash delta).
6. Press `KeyE` again; assert the panel is back to the normal one
   (`[data-opendoors="1"]` present) and `[data-opendoors="1"]` still opens a
   real night (`#hHour` leaves `DAY`).

No `gvb-save.js` gap. The lease/dark-night flow doesn't touch save/load at
all beyond the existing `cb.save()` calls already in `main.js`.

## Deliberately not done

**Distinct floor plans per venue tier.** The other of the two options the
prompt offered for the seat-count problem. Building four rooms — more tables,
a second stove, a wider bar — is real 3D layout work (collider placement,
station repositioning, lighting), not a small lever, and it's the thing that
would make `seats` numbers meaningful again instead of retired. I took the
cheaper, honest fix (derive the engine's cap from the one room that exists)
and left this as the real next step if the ladder's tiers are ever supposed
to feel physically different, not just better-drawing.

**The day-based difficulty curve.** Rent now scales with tier, which answers
the half of task three that was cheap and available. It does not answer the
other half: nothing in this game reads `c.day` for cost, so within a single
tier day 40 is exactly as easy as day 4, and there is still no fail state
beyond a red HUD number and a door-panel warning. A real fix here needs a
design decision I don't think is mine to make solo — rent creeping with the
calendar, a lease that can be lost, spoilage, something — not a mechanical
one-line change. Flagging it explicitly rather than re-closing task three as
if rent-by-tier were the whole answer.

**`Tools/board-check`'s broken `waitForFunction` calls.** Found the exact
line and the exact one-character-class fix (a literal `null` where the
callee's default only fires on `undefined`), and did not touch it —
`Tools/board-check/**` isn't mine. See Shared-file requests.

**`newindex.html`'s font hotlinks and `index.html`'s social-notice markup
drift.** Both surfaced by `npm run check`/`npm run social:check`, neither
inside my boundary, neither touched.

## Next session

Ordered by value per effort.

1. **Fix `Tools/board-check`'s `waitForFunction` calls.** One-line change,
   eleven call sites, and it's the only thing standing between every future
   session and a working `npm run games`. See Shared-file requests for the
   exact list and the two-part fix (drop the `null`s; pin+lock
   `puppeteer-core` so it can't silently drift again).
2. **Apply the Real Estate beats to `play-games.mjs`** once (1) is fixed —
   drafted above, needs the walk-to-the-station timing measured once by hand
   the way Daredevil's Continue count was.
3. **Distinct floor plans per venue tier**, if the ladder is ever meant to
   feel physically bigger rather than just draw better. Not urgent — the
   honest-30-seats fix this session means nothing is currently lying about
   what the tiers do.
4. **The day-based difficulty curve**, properly — a design call, not a code
   task. Rent-by-tier (this session) is a partial answer; day 40 vs. day 4
   within one tier is still untouched.
5. Everything still open from round 1's notes that this session didn't
   touch: the WAV conversion and the mute toggle are both done now (tasks
   four and five), so this list is shorter than it was.
