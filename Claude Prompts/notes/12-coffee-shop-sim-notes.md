# Corner & Kettle — session notes

Second session. Round one shipped fonts, save adoption, and the audit that found the flat
difficulty curve, the staff throughput ceiling, and the mid-shift reload exploit. This session
did the balance and behavior fixes the audit called for: tasks one through four are done, and
task five (station keyboard shortcuts) is done too since it was cheap enough to fit.

## What changed

**`Projects/coffee_shop_sim.html`.**

`spawnFactor()` and `patienceFactor()` (around line 650) now floor on `state.prestigeLevel` as
well as `state.day`, per the round-one sketch. Spawn floor: `max(0.30, 0.6 - 0.06*prestigeLevel)`.
Patience floor: `max(0.45, 0.75 - 0.06*prestigeLevel)` — same shape, same 0.06-per-level step as
spawn, so the two curves move together. At prestige 0 the numbers are exactly what round one
measured (day 30 plays like day 9). By prestige 5 both floors bottom out at their global minimums
and day 30 is measurably busier than a first playthrough's day 9:

| | day 1 | day 3 | day 5 | day 9 | day 30 |
| --- | --- | --- | --- | --- | --- |
| spawn factor, prestige 0 | 1.00 | 0.90 | 0.80 | 0.60 | 0.60 |
| spawn factor, prestige 1 | 1.00 | 0.90 | 0.80 | 0.60 | 0.54 |
| spawn factor, prestige 5 | 1.00 | 0.90 | 0.80 | 0.60 | 0.30 |
| patience factor, prestige 0 | 1.00 | 0.94 | 0.88 | 0.76 | 0.75 |
| patience factor, prestige 1 | 1.00 | 0.94 | 0.88 | 0.76 | 0.69 |
| patience factor, prestige 5 | 1.00 | 0.94 | 0.88 | 0.76 | 0.45 |

Days 1-9 are untouched at every prestige level — the day-based floor is still the binding one
there — and the only column that moves is day 30 and beyond, exactly where round one measured the
game going flat forever. Computed from the formula, not re-played by hand; round one's own table
was built the same way.

`runBaristaTick()` (line 1851) no longer calls `serveSlot()` when a ticket completes. It still
runs the fumble roll (a barista can still leave a wrong detail on the cup), still posts a toast,
and still releases the station — it just leaves the finished cup sitting in its slot instead of
clearing it. The claiming loop right above it got one added line too: a slot whose order is
already `orderIsComplete()` is now skipped when a barista looks for its next job, so a barista
doesn't immediately re-claim its own finished ticket and spam a second "finished" toast every tick
while it waits on a human to serve. Three Seniors now hand you finished cups instead of money;
serving is the player's job again.

Added keyboard shortcuts: digits 1-7 switch the seven station tabs, `S` serves the focused
station. One `keydown` listener, added right after `renderStationTabs()` (around line 1445),
skipped while the day-end modal is open or a text input has focus (there are none on this page
today, but the guard costs nothing and outlives that fact). The tab buttons and the Serve button
both got `title`/`aria-keyshortcuts` so the shortcut is discoverable, not just functional.

The day-advance logic that used to live only inside the day-end modal's button handler is now its
own function, `startNextDay()`, called from both the modal button and `init()` — see the save.js
entry below for why `init()` needs it too.

**`Projects/corner-and-kettle/js/save.js`.** `shiftElapsed` and `shiftRunning` are now persisted
(`freshSaveData`, `toSaveData`, `applyToState`, plus a clamp in `repairSave` bounding
`shiftElapsed` to `[0, catalog.shiftMs]` and coercing `shiftRunning` to a boolean defaulting
true). This is the fix for the mid-shift reload exploit round one measured: reloading no longer
restarts the clock at Dawn for free while keeping the day and the money — it resumes the shift
where it left off. Picked "persist the clock" over the prompt's other option ("bank the day on
reload") because it needed no new UI and no faked day-summary modal.

One edge case that persisting the clock opens by itself: `endShift()` sets `shiftRunning = false`
and saves before the modal's own button is ever clicked, so a reload in that narrow window would
previously have replayed `endShift()` a second time on the same day (`shiftElapsed` still at or
past `SHIFT_MS`) and double-charged wages — or worse, sat frozen with `shiftRunning: false` and no
modal DOM to click through, since day stats aren't persisted and can't be rebuilt. `init()` now
checks `!state.shiftRunning` right after a successful load and calls `startNextDay()` immediately
in that case. Verified this exact interleaving below.

**`Projects/corner-and-kettle/test/smoke-save.mjs`.** One assertion in section 9 ("blocked
storage") inverted: `gvb-save.js`'s `load()` now catches a throwing `getItem` (locked decision
#49 — confirmed already fixed on disk this round), so `hostileSlot.load()` no longer throws.
Comment above it updated to say so instead of pointing at a gap that's now closed.

## What I verified

```
node Projects/corner-and-kettle/test/smoke-save.mjs     166 passed, 0 failed
node Projects/corner-and-kettle/test/drive-save.mjs      90 checks, 0 failed
node assets/js/gvb-save.test.mjs                         50 passed, 0 failed
```

166, not the 162 the round-one notes projected for "once task two lands." The extra 4 aren't new
assertions I wrote: section 5's legacy-load test, line 228, loops
`for (const [k,v] of Object.entries(s))` and asserts every field is neither `undefined` nor
`NaN`. Adding `shiftElapsed`/`shiftRunning` to the schema means that loop now also checks both of
those on a save that predates them, for free, and both pass — repair fills them in correctly from
a save that has neither.

**The reload exploit, closed, by hand and in a scratch script** (not added to the repo — ad hoc,
run once, throwaway, reused the shared harness the same way `drive-save.mjs` does). Before, per
round one: day 5, $1,000, 132.6s into a 136s shift, reload, day 5, $1,000, 0.06s — free shift,
free labor. After, using the debug hook to fast-forward the clock and reloading for real in a
headless Chrome:

- Set `shiftElapsed` to 90000ms mid-shift, saved, reloaded: came back at ~90020ms and still
  running, not reset to 0.
- Hired one Junior (wage 35), fast-forwarded to 100ms before shift end, let `endShift()` fire on
  its own (day still 1, wages deducted once — $60 to $25 for the hire's already-accrued costs plus
  wage), then reloaded without clicking "Start Next Shift": landed on day 2 by itself, money
  identical before and after the reload ($25, no second deduction), new day running with a clean
  clock instead of frozen mid-modal.

**Barista hand-off, same script.** Hired a Senior, queued a drip order, waited for the barista to
reach `orderIsComplete()`: the cup was still sitting in its station afterward, not cleared, and no
barista had re-claimed it (`targetSlot` null on every barista). Clicked Serve by hand — that's
what actually paid out ($60 to $98).

**Keyboard shortcuts, same script.** Pressed `2`, `stationTab` became `milk`; pressed `1`, back to
`base`. Built a real drink (espresso shot, steamed oat milk) and pressed `S`: money went from $60
to $116, same as clicking Serve would have.

**Existing suites, and two failures that aren't this project.**
```
cd Tools/board-check && npm run check         340 units checked, 1 broken
cd Tools/board-check && npm run social:check  only parsed 17 of 22 notices, refused to sweep partial
grep -c fonts.googleapis.com Projects/coffee_shop_sim.html    0
```
The one break in `npm run check` is `newindex.html` — repo root, last committed 2026-07-30,
offsite Google Fonts hit. That's a prompt-21 path, not mine, and I didn't touch it.
`social:check`'s parse failure is against `index.html`'s own notice markup, same boundary. My own
page: zero offsite font hits, and `check-integrity.mjs`'s output has no findings under
`Projects/coffee_shop_sim.html` or `Projects/corner-and-kettle/`.

## Shared-file requests

None. Both `gvb-save.js` gaps this project asked for last round — the unguarded `getItem`, the
unguarded `typeof localStorage` probe — are already fixed on disk. Read the file this session
before writing task two's test fix; both matches are exactly the edits sketched in round one's
notes.

## Deliberately not done

**Task five, past the two shortcuts asked for.** The prompt's ask (digits for the tabs, a key for
Serve) is done. Didn't add shortcuts for picks inside a station — a milk type, a syrup — because
that's a bigger keyboard map than what was asked for, and station contents change per tab, so it
would need a per-tab shortcut legend rather than one flat list. Worth its own session if full
keyboard play becomes the actual goal.

**Re-measuring the day-10 full-playthrough numbers (offered/served/net/accuracy) after tasks one
and four.** The prompt's "if time allows" item, and it's the one thing on the list that actually
needs a scripted player rather than a fast-forwarded clock — task four in particular changes the
shape of a full day (a human now has to click Serve on everything three baristas prep, where
before it was hands-off), so round one's "99% accuracy, hands off" line doesn't just go stale, it
stops describing what happens with nobody at the keyboard at all. That's more than this session
has left in it and is better scoped as its own task than rushed here.

**Splitting the file further.** Same call as round one, same reasoning: nothing this session
touched needed the engine separated from the UI to become testable.

## Next session

1. **Re-measure the day-10 (and maybe day-20, prestige-1) full-playthrough numbers now that tasks
   one and four have landed.** This is the actual answer to "did the balance work work," and it
   needs a scripted player, not a fast-forwarded clock. Compare against round one's
   `offered 41 · served 45 · net $2,353 · 99% accuracy`.
2. **Check whether the barista fumble chance needs retuning** now that a human confirms every
   serve instead of the barista's own accuracy being the only check. Fold into (1)'s measurement.
3. **Per-station-content keyboard shortcuts**, only if full keyboard play becomes a real goal (see
   Deliberately not done).
4. **`npm run games` still doesn't cover this game** — unchanged from round one, still prompt 21's
   file to touch if this game ever joins that suite.
