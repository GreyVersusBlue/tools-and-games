# Corner & Kettle — session notes

Third session. Round two closed the difficulty floor, the reload exploit, auto-serving, and
keyboard shortcuts. This session did round two's own leftover list: fixed `drive-save.mjs`'s own
copy of the `waitForFunction` bug, and ran the day-10/day-20 scripted playthrough round two
deferred. The playthrough surfaced something bigger than the fumble-chance question it was sent to
answer: a pre-existing Serve-button gate that round two's own hand-off change puts in front of every
single order now, not just manually-built ones. Details below.

## What changed

**`Projects/corner-and-kettle/test/drive-save.mjs`.** All 9 instances of
`p.waitForFunction(fn, null, opts)` replaced with the shared `waitFor(page, fn, opts)` from
`Tools/board-check/drive.mjs` (new import added alongside the existing `harness.mjs` one). The
prompt's own grep found 8 (lines 93, 160, 166, 226, 265, 344, 424, 530) — there were 9. The ninth,
at what's now line 192-193, wraps its `null, { timeout }` onto a second line, which a single-line
`waitForFunction(.*null` grep pattern doesn't match. Found by reading the file directly rather than
trusting the count. Fixed anyway, same one-line swap, since the bug is in the shape of the call,
not in which line it sits on.

No other file in this project changed. Tasks two and three (below) were measurement, not code.

## What I verified

**Task one, the `waitForFunction` fix.** This session's environment came up as `win32`/Playwright
(`node -e "console.log(process.platform)"` → `win32`), not the Linux/`puppeteer-core` path prior
rounds' sessions ran under — so simply running the suite here proves nothing about the actual bug,
since Playwright's `waitForFunction(fn, arg, opts)` tolerates a literal `null` in the middle
position just fine. Reproduced the real failure directly instead: loaded `puppeteer-core` and a
real local Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) standalone, no harness,
and called both shapes against a live page:

```
BUGGY SHAPE threw as expected: Cannot read properties of null (reading 'polling')
FIXED SHAPE via waitFor(): resolved cleanly
```

That's locked decision #34 satisfied against the actual bug, not against this session's
accidentally-safe platform. Then ran both of this project's suites on the platform that's
actually here:

```
node Projects/corner-and-kettle/test/smoke-save.mjs     166 passed, 0 failed
node Projects/corner-and-kettle/test/drive-save.mjs      90 checks, 0 failed
node assets/js/gvb-save.test.mjs                         50 passed, 0 failed
```

Same counts as round two's baseline — the migration to `waitFor()` changed nothing observable here,
which is what a correct engine-branching fix should do on the branch that already worked.

**Tasks two and three, the day-10/day-20 scripted playthrough.** Round one's number came from a
human clicking "accept" while baristas auto-served. Round two removed the auto-serve, so this
needed an actual scripted player clicking Serve — a fast-forwarded clock doesn't exercise
`runBaristaTick()`'s real cadence or the hand-off itself, and this project's `gameLoop()` advances
on real `requestAnimationFrame` deltas, not simulated time, so "fast" here means real wall-clock
seconds, not a warped clock. Wrote two throwaway scripts (ad hoc, not committed, same shared-harness
pattern as `drive-save.mjs` and round two's exploit check), each driving one full real 136-second
shift with three trained Senior baristas (spec: none, so all-purpose) and three stations, day and
`prestigeLevel` set directly via the debug hook, `nextCustomerId` before/after for "offered,"
`dayStats` for everything else:

Run 1 — **patient**: served the moment `orderIsComplete()` was true, day 10 / prestige 0 (round
one's exact conditions):

```
offered 41 · served 41 (26 drinks, 15 food) · gross $519 · wages $210 · net $309
avg accuracy 100% · best streak 41 · reputation 50 → 66.4
```

Run 2 — same script, day 20 / prestige 1 (past the day-based floor, prestige floor now the binding
one):

```
offered 46 · served 46 (38 drinks, 8 food) · gross $662 · wages $210 · net $452
avg accuracy 100% · best streak 46 · reputation 50 → 68.4
```

Throughput and accuracy compare cleanly against round one's `offered 41 · served 45 · 99%
accuracy`: the shop still clears everything offered with a human in the loop, and accuracy is
slightly *better* than round one's hands-off number, because a stalled/fumbled slot gets reclaimed
and re-fixed by a free barista before a "patient" server ever sees it (see below). **The dollar
figures are not comparable to round one's `$2,353`** and I'm not presenting them as if they were:
my setup started from zero shop upgrades, zero loyalty tiers, and no established regulars, to
isolate the two variables this measurement was actually testing (throughput under manual serve, and
the prestige floor). Round one's `$2,353` day assumed "everything a player would plausibly own by
[day 10]" — different equipment/loyalty/tip multipliers, not a different serve mechanic. Comparing
my $309 to their $2,353 would blame a modeling choice on a game balance change that isn't there.

Run 3 — **eager**: this is task three's actual answer, and it isn't about the fumble chance. Same
day 10 / prestige 0 setup, but instead of waiting for full completion, the script clicked the real
`.servebtn` DOM element the instant `disabled` came off — exactly what an eager human would see and
could click, read from the live DOM rather than reimplemented, since the gate function
(`cupMatchesEnough()`, line 1392) isn't on the debug hook and re-deriving it risks drifting from the
real one:

```
offered 43 · served 43 (35 drinks, 8 food) · gross $287 · wages $210 · net $77
avg accuracy 46% · worst miss: Americano at 25% · best streak 1 · reputation 50 → 19.2
```

That's a losing day. Reputation actively fell. Best streak never got past 1. Traced why:
`cupMatchesEnough()` only checks that a base drink exists and, if the recipe needs one, that some
milk is poured — not that it's the *right* milk, not syrup, not toppings, not shot count. A barista
fills those in one property per tick the same way the ticket lists them, so for most of a barista's
prep time the Serve button is already lit while the cup is still wrong. This isn't new — it's the
same button a human has always had for manually-built drinks — but round one's auto-serving
baristas never touched it (they called `serveSlot()` themselves only after their own internal
`orderIsComplete()` check), so it was reachable only when a player chose to build a drink by hand
and choose to serve it early. Round two's hand-off means every barista-prepped order now sits behind
that same loose gate for a human to hit, all day, every order.

**The fumble chance itself is fine and does not need retuning.** Effective mistake chance for a
trained Senior is 4% × 0.7 (`trained`) = 2.8% per completion (`mistakeReduceFactor()`, line 753).
The claiming loop skips a slot only while `orderIsComplete()` is true (round two's note), so a
fumble — which breaks exactly one field — flips that check back to false and the same or another
free barista reclaims and re-fixes it before a *patient* server ever sees the wrong cup. That's why
runs 1 and 2 both landed at 100%, not because fumbles never happened, but because the mechanic
self-heals ahead of a careful human. The 46% in run 3 has nothing to do with fumbles at all — it's
every order getting served under-built because the button doesn't wait for one.

**Existing suites, re-confirmed clean.**
```
cd Tools/board-check && npm run check         360 units checked, 0 broken, 0 collisions, tightest gap 9.1px
cd Tools/board-check && npm run social:check   18 notices, 12 current, 6 out of sync — none of them this project
```
Both numbers moved from round two's own baseline (335/17) — other prompts' sessions landed work in
between, not mine, and neither run flags anything under `Projects/coffee_shop_sim.html` or
`Projects/corner-and-kettle/`. Also re-checked `gvb-site-handoff-v9.md` §8's line that this
project's "blocked storage" inversion "wasn't independently confirmed inverted this round" — it
was, in round two's own notes (section 9, the assertion inverted and passing), and this session's
own fresh `smoke-save.mjs` run above confirms it's still passing. That backlog line is stale; not my
file to edit, flagging it here so the next handoff can close it.

## Shared-file requests

None. `gvb-save.js`'s two previously-reported gaps (unguarded `getItem`, unguarded `typeof
localStorage`) are still fixed on disk — re-checked this session, not just carried forward.

## Deliberately not done

**Changing `cupMatchesEnough()`'s gate.** Found and measured (see above), not changed. Whether a
player being able to serve a half-built drink for partial credit is an intentional speed/accuracy
tradeoff or an oversight is a game-feel call, not a bug with one correct fix — it predates this
round and previously only mattered for manually-built drinks. Left it for Devon's steer rather than
unilaterally tightening it; see Next session.

**Per-station-content keyboard shortcuts.** Same call as round two: the station tabs and Serve
already have shortcuts, picks inside a station don't, and it's a bigger keyboard map that needs a
per-tab legend since contents change per tab. Nothing this session found makes that more urgent —
if anything, the eager-serve finding argues for slowing a player down, not adding more ways to move
fast.

**`npm run games` still doesn't cover this game.** Confirmed again: `Tools/board-check/play-games.mjs`
has no reference to `coffee_shop_sim` or `corner-and-kettle`. Unchanged from rounds one and two,
still prompt 22's file.

## Next session

1. **Decide what to do about the Serve button's early-enable gate** (`cupMatchesEnough()`, line
   1392, `Projects/coffee_shop_sim.html`). This session's numbers: a patient server gets 100%
   accuracy and a $309 net day; an eager one who clicks Serve the instant it's enabled gets 46%
   accuracy, reputation actively falling, a $77 day. Nothing forces the eager behavior, but nothing
   in the UI discourages it either — the ticket still shows what's missing, but the button doesn't
   care. Options, not a recommendation: tighten the gate closer to `orderIsComplete()` now that
   baristas are the main path to a finished cup and the "serve early on purpose" tradeoff mattered
   more when building drinks by hand was the only way to reach Serve at all; or leave it and add a
   clearer visual cue ("still missing: syrup, whip") so the tradeoff is legible instead of a trap;
   or leave it exactly as is, since the accuracy hit and reputation drop already are the
   consequence, working as intended. This is the actual highest-value open question this project
   has right now.
2. **Per-station-content keyboard shortcuts**, only if full keyboard play becomes a real goal (see
   Deliberately not done — unchanged reasoning from round two).
3. **`npm run games` still doesn't cover this game** — unchanged from rounds one and two, still
   prompt 22's file if this game ever joins that suite.
4. **The stale `gvb-site-handoff-v9.md` §8 line** about this project's "blocked storage" assertion
   not being confirmed inverted — it was, twice now (round two's notes, this session's fresh run).
   Not this project's file to fix; flagging so whoever writes v10 can drop the line.

## Is this project stable right now?

Yes, as far as this session can confirm. Both owned test suites pass clean (166/166, 90/90), the
shared save-module suite passes clean (50/50), the shared integrity/collision check finds nothing
under this project's paths, and the social-tag check doesn't list this project among the pages out
of sync. Nothing in this session's own testing turned up a broken guard rail, a failing assertion,
or a regression — the one open item (#1 above) is a design/balance question with real numbers
attached, not a bug. There is no known outstanding defect in `Projects/coffee_shop_sim.html` or
`Projects/corner-and-kettle/` as of this session.
