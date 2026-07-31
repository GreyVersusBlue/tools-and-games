# Closing Time — session notes

## What changed

**The headline: the career ends at day 336.** `js/engine/calendar.js` exports
`CAREER_LENGTH_DAYS = 336`, matching `seasonOf`'s existing wrap point (four
84-day seasons). `endDay()` now checks `S.day >= CAREER_LENGTH_DAYS` before
incrementing; on the day it's true it calls `finishCareer()` instead of
advancing to a 337th day. `finishCareer()` freezes a scorecard onto
`S.scorecard` (day, volume, closings, referrals, final reputation, level,
title, cash), sets `S.careerEnded = true`, logs a milestone line, and saves.
`endDay()` is now a no-op once `S.careerEnded` is true, so a second click
changes nothing.

`js/state.js`: `makeCareer()` initializes `careerEnded: false, scorecard:
null`. `repairCareer()` normalizes both (`s.careerEnded = !!s.careerEnded`;
`scorecard` reset to `null` if it isn't an object) so a save from before the
ending existed loads cleanly instead of crashing on `S.careerEnded` being
`undefined` somewhere.

`js/ui.js`: `renderTopbar()` shows "Close out the year →" on day 336, "Career
complete" (disabled) once `S.careerEnded` is true, and a new `renderScorecard()`
opens a modal the first time `render()` runs after the career ends, showing
the frozen numbers. It's dismissible per page load (a module-level
`scorecardDismissed` flag) rather than per save, because `S.careerEnded`
never goes back to `false` and `render()` runs on every nav click — without
the flag, closing the modal once would just reopen it on the next screen
switch.

**Task two: the topbar collapses on mobile.** `index.html`'s topbar wraps six
stats into a `.statgrid` containing `.stat-primary` (Date, Slots, Cash — the
three checked mid-day) and `.stat-secondary` (Reputation, XP, Rate), plus a
`.stat-toggle` button. Above 620px `.stat-secondary` always shows and
`.stat-toggle` is hidden (`css/style.css`) — nothing changes there. Below
620px, `.stat-secondary` starts collapsed and the toggle shows; clicking it
flips a module-level `statsExpanded` flag in `ui.js` and re-renders just the
topbar. Measured at 375×812: topbar collapsed 241px, expanded 301px — a
player checking Date/Slots/Cash mid-day never pays for the other three.

**Task three: the Ledger got a real filter**, not a fold. `js/ui.js`'s
`renderLog()` now shows a `<select>` with Everything / Money only /
Reputation only / one option per client ("<name> only"), backed by a new
module-level `ledgerFilter`. `logPanel(n, filter)` takes the filter and
narrows `S.log` before slicing. Money/Reputation filtering needed a new field
on log entries: `state.js`'s `log(text, cls, kind)` now takes an optional
third argument, and `addRep`/`addCash` pass `"rep"`/`"money"`. This is
deliberately separate from `cls` (which only drives log-row color and is
heavily overloaded — both money losses and reputation losses use `cls:
"bad"`, so `cls` alone can't distinguish the two categories). The
per-client option filters by `it.text.includes(name)` — a substring match
against the roster, not a stored client id on every log line, since adding a
recId to every one of the ~50 call sites across `deals.js`/`seller.js`/
`clients.js` was a much bigger change than the task asked for. Verified it
against Sal DiMeo and Deb-referred clients in a real browser: filtering
narrowed the row count in every case I tried, never widened it.

**Task four: content removed from `data/` while a save references it.**
`repairCareer()` in `state.js` now purges, not just backfills: after filling
in missing `listingsState`/`market.nb`/`knowledge` entries for content added
since a save was written, it deletes any entry in those three maps whose id
no longer exists in `DB.listings`/`DB.neighborhoods`. Without this,
`calendar.js`'s daily loop — `for (const id in S.listingsState) { ...
DB.listings[id].address ... }` on a price cut or an off-market roll — throws
the moment it reaches an orphaned id. Same family as the two bugs last
round's adoption fixed (a save missing an entry for content added since),
opposite direction (a save holding an entry for content that's gone).
**Not handled, on purpose:** a deal or player listing still actively
under contract on content that gets deleted mid-session. That's a much
rarer, much stranger case (deleting a listing a real save is mid-contract on)
and fixing it would mean guarding `deals.js`'s and `seller.js`'s own
`DB.listings[id]`/`DB.neighborhoods[id]` reads throughout, not just the
calendar loop. Documented in the README instead of silently patched.

`tools/smoke.mjs`: grew from 76 to 100 assertions. New coverage: the career
ending (reaching day 336, the scorecard's fields, the no-op on a second
`endDay()`, a legacy save already past day 336 ending on its next click), the
content-removal purge (both a direct `repairCareer()` check and a full
save/load round trip through `careerSlot`), and a legacy save missing
`careerEnded`/`scorecard` entirely repairing to `false`/`null`.

`README.md`: persistence section now mentions the reverse-direction purge
and the day-336 ending; "Design notes for future expansion" gained a
paragraph on the removal fix and its one deliberately-unhandled edge case.

## What I verified

- `node "tools/smoke.mjs"` from inside `Projects/Closing Time` →
  **`SMOKE OK: 100 passed`** (was 76). Every new number above is an actual
  assertion in that file, not a description.
- **Locked decision #34, both new guard-rails broken on purpose and watched
  to fail before being trusted:**

  | What I broke | Misses |
  | --- | --- |
  | the three orphan-purge lines in `repairCareer()` deleted | 5 of 100, including the two purge checks and the reload-and-advance check |
  | the day-336 check in `endDay()` deleted (`S.day++` unconditional) | 5 of 100, all in the career-ending block |

  Both restored, back to 100 passed.
- `cd Tools/board-check && npm install && node play-games.mjs closing-time`
  **could not complete** — see "A shared-tooling bug I found, not caused" below.
  In its place I wrote a standalone Puppeteer script against the same
  `harness.mjs` this suite uses (not committed; it isn't a project file, it's
  how I drove a real browser) and ran 17 checks against a live page, 0
  failed:
  - Six desk screens in the nav, MLS populated, a fresh visit shows the
    start screen.
  - At 375×812: the stat-toggle is visible, Rep/XP/Rate start hidden,
    clicking the toggle shows them and grows the topbar (241px → 301px),
    clicking again collapses it. At 1280×900 the toggle is hidden and the
    secondary stats show without a click — the collapse is mobile-only.
  - The Ledger filter's options are Everything/Money/Reputation (plus
    per-client); switching to Money narrowed the row count.
  - A save seeded directly into `localStorage` at day 336 (minimal fields;
    `repairCareer()` filled the rest) resumes into the desk, the End Day
    button reads "Close out the year →", clicking it opens a modal titled
    "Year one, closed" showing the seeded closings (6) and reputation (62),
    the button becomes disabled and reads "Career complete," and switching
    screens afterward does not reopen the dismissed modal.
- `cd Tools/board-check && npm install && node check-collisions.mjs` →
  **0 collisions, tightest vertical gap 3.5px.** (`check-integrity.mjs`
  failed on `newindex.html`, a file I never touched — see below — so I ran
  collisions on its own rather than let `&&` skip it.)
- `cd Tools/board-check && node tools.mjs` → **18 checks, 0 failed.** Doesn't
  touch this game directly but confirms the sweep is still live.
- Grep `Projects/Closing Time/index.html` for `fonts.googleapis.com` /
  `fonts.gstatic.com` → **0**, still true.
- `git status` before writing this file showed only the five files this
  session touched inside `Projects/Closing Time/` — nothing stray staged
  from the `npm install` in `Tools/board-check` (its `node_modules` and
  `package-lock.json` are both gitignored there, confirmed).

### A shared-tooling bug I found, not caused

`npm run games` — the suite that matters most, per every past round's own
notes — is currently broken for **every game on the board**, not just this
one. `node play-games.mjs fourth-quarter` aborts on the very first thing it
does (0 checks logged) with `Cannot read properties of null (reading
'polling')`. `node play-games.mjs closing-time` gets 18 checks in (every
desk-screen and save-resume check passes) and aborts at the same message on
the export-flow check.

The cause, traced with a standalone script against the same `harness.mjs`:
`drive.mjs`'s `waitForProbe()` and four call sites in `play-games.mjs`
itself (the export-flow checks for `closing-time`, `torchbearer` — I didn't
check every game's line, only the ones I found — and others) all call
`page.waitForFunction(fn, null, { timeout })`. JavaScript default parameters
only substitute for `undefined`, not `null`, so passing `null` explicitly
means Puppeteer's own `options = {}` default never kicks in — `options`
stays `null`, and the currently-installed `puppeteer-core@24.43.1` (there's
no committed `package-lock.json` in `Tools/board-check`; both it and
`node_modules` are gitignored, so every session's `npm install` gets
whatever's newest on the registry that day) destructures it directly and
throws. `fourth-quarter` aborts before its own suite code even runs because
`enter()` calls `waitForProbe()` for every three.js game (it, Aphelion,
Golden Hour, Castle Conundrum) before the per-game checks start.

I did not fix this. `Tools/board-check/**` (except `play-castle.mjs`) is
prompt 21's, not mine, and `drive.mjs`/`play-games.mjs` aren't files I'm
allowed to edit. It's in Shared-file requests below with the exact lines.

## Shared-file requests

### `Tools/board-check/play-games.mjs` and `drive.mjs` — `npm run games` is currently broken for every game

Not a request for a new beat — a bug report on the harness itself, found
while trying to verify this session's own work. Change `null` to `{}` (or
just omit the argument) at every `page.waitForFunction(fn, null, {
timeout })` call:

- `drive.mjs:58` — `waitForProbe()`, hit by every three.js game (Aphelion,
  Golden Hour, Castle Conundrum, this project) before their own suite code
  runs at all.
- `play-games.mjs:264, 643, 749, 797` — export-flow checks for at least
  `closing-time` and whichever games those other three lines belong to. I
  didn't audit the whole file for the same pattern; a `grep -n
  "waitForFunction(.*null"` across both files would find every instance in
  one pass.

Root cause: JS default parameters only substitute for `undefined`, not
`null`, so `waitForFunction(fn, null, opts)` never gets Puppeteer's own
`options = {}` default — it stays `null`, and `puppeteer-core@24.43.1`
throws destructuring it. Confirmed with a standalone script against this
repo's own `harness.mjs`: the identical call with `{}` in place of `null`
works; with `null` it reproduces `Cannot read properties of null (reading
'polling')` on both engines' code paths (this is `puppeteer-core`-specific;
I didn't check whether Playwright's `chromium.launch()` tolerates it — the
Linux code path is the one every session actually runs).

Second, smaller finding: `Tools/board-check/.gitignore` excludes both
`node_modules/` and `package-lock.json`. That means every session's `npm
install` resolves against whatever's newest on the registry that day, with
no way to reproduce a previously-working install. This exact bug is a
demonstration of the cost: `waitForFunction(fn, null, ...)` may have worked
fine against whatever `puppeteer-core` version some earlier round installed,
and broke silently on drift with no commit to point at. Worth considering
committing `package-lock.json` (keeping `node_modules/` ignored) so a
version bump is a visible, reviewable diff instead of invisible drift.

### `check-integrity.mjs` — `newindex.html` fails the integrity sweep

`cd Tools/board-check && node check-integrity.mjs` reports:

```
FAIL newindex.html
     references offsite host(s): fonts.googleapis.com, fonts.gstatic.com
```

I didn't touch `newindex.html` (`git diff --stat -- newindex.html` against
this session's start is empty) and it isn't in my boundary. Flagging it
because it's the reason `npm run check` (the combined `check-integrity.mjs
&& check-collisions.mjs` script) reports 1 broken instead of 0 right now —
I ran `check-collisions.mjs` on its own to confirm my own project's layout
is still clean (0 collisions), but the combined command will keep failing
on this file regardless of anything in `Projects/Closing Time/`.

### `sync-social-tags.mjs` — currently can't parse `index.html`

`node sync-social-tags.mjs --check` reports:

```
only parsed 17 notices out of index.html — the notice markup has changed
shape, fix the regexes rather than shipping a partial sweep
```

Same situation: I never touched the repo root `index.html`, this predates
anything in this session, and it's prompt 21's file to fix. Flagging it
because it means I could not get a real "22 of 22 current" number this
round — the tool refuses to ship a partial sweep, which is the right call,
but it means this check is currently unusable for anyone until index.html's
notice markup and the regex agree again.

## Deliberately not done

- **Folding the Ledger into Desk instead of filtering it.** The prompt
  offered either. A filter (Money / Reputation / per-client) is a smaller,
  reversible change than repurposing the tab slot for something else, and
  "something with actual state in it" wasn't specified, so inventing a new
  screen felt like scope past what was asked. If a future round wants the
  tab slot back for something specific, the filter work isn't wasted — it
  moves into whatever Desk's "show more" becomes.
- **A `recId` on every log entry, for an exact per-client filter.** The
  current filter matches on the client's display name appearing in the log
  text, which is how almost every client-related log line is already
  written. A name that happens to be a substring of an unrelated log line
  would be a false positive; I didn't hit one in play, and content authors
  already avoid short or generic client names for readability. Threading a
  `recId` through every `log()` call in `deals.js`, `seller.js` and
  `clients.js` (roughly fifty call sites) to make it exact was a much bigger
  change than a Ledger filter should cost.
- **Guarding `deals.js`/`seller.js`'s own `DB.listings[id]` /
  `DB.neighborhoods[id]` reads against deleted content.** Covered above,
  under task four. An active deal or player listing on content that gets
  deleted mid-session is a narrower, stranger case than the daily aging
  loop, and fixing it means auditing every read site in both engine files,
  not one function.
- **A `migrate` hook for the new fields.** `careerEnded`/`scorecard` go
  through `repair`, the same as every other gap this project's adoption
  has ever filled, on purpose (locked decision #37 again: fill-ins belong
  in `repair`, not `migrate`, and adding an identity `migrate` here would
  blur that for no reason — there's still exactly one version of this save
  shape).

## Next session

Ordered by value per effort.

1. **`npm run games` is broken for every game on the board, not just this
   one.** Detailed above with exact lines. Whoever owns `Tools/board-check`
   should fix the four-plus `null`-argument call sites before any project
   thread trusts a green `npm run games` result this round — right now a
   pass is impossible to get, so a silent skip of that check is not the
   same as it actually passing.
2. **`newindex.html` and `sync-social-tags.mjs`'s regex** are both failing
   independently of anything in this project. Neither is mine to fix, but
   both block the combined `npm run check` / `npm run social:check` numbers
   the handoff usually quotes.
3. **The per-client Ledger filter is name-substring, not id-exact.** Noted
   above under "Deliberately not done." Worth revisiting if a future round
   adds two clients whose names collide as substrings, or wants the filter
   to survive a client being renamed mid-career (it currently wouldn't,
   since past log lines keep the old name).
4. **The one-time career-ending flow has no "what's next" beyond dismiss.**
   The scorecard modal's only action is "Keep browsing the desk." A second
   career at the same brokerage, or a proper end-of-run history across
   multiple careers, is out of scope for what was asked this round but
   would be the natural next step if the ending sticks.
