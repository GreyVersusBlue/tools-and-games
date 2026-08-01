# Integer Foundry — session notes (round 2)

## What changed

### The difficulty curve

`Projects/integer-foundry/js/targets.js`, `rollTarget()`. This is the headline task,
and round 1 deliberately left it alone: "changing the ramp and clamping it in the
same session would have made the clamp impossible to attribute if the game started
feeling wrong." The clamp has shipped a full round on its own now, so this is the
follow-up.

**The problem, worked out precisely.** With only `+1` unlocked, building a value N
costs N-1 tiles — magnitude and effort are the same number. `x2` is 80 ingots, and
round 1's own numbers say most players buy it within a couple of orders. The instant
they do, `buildCosts`' BFS starts pricing values on a log2 curve instead of a linear
one: on the opening 8x6 floor, the most tiles anything can ever need once `x2` exists
is **14**, against a 46-cell budget. The old ramp (now the value ceiling) kept
climbing by 3 a roll regardless, so from roughly order 15 to 30 the number on the
sink kept growing while the line a player had to build to fill it did not — the flat
stretch round 1 flagged and correctly chose not to touch yet.

**The fix: ramp tile cost, not magnitude.** `rollTarget` now computes `maxCost` — the
largest tile cost present anywhere in `buildCosts`' result for the board's current
unlocks — and ramps a `costCeil` toward it using the exact same numbers the old ramp
used (`4 + 3*ordersFilled + jitter(0..7)`, one lower than before because cost starts
at 0 where value started at 1). A small band below `costCeil` (`round(maxCost/8)`,
minimum 1) keeps the draw from collapsing onto a single deterministic value once
`costCeil` saturates at `maxCost`. `maxCost` only ever *drops* as more ops are
bought — that is the lever a magnitude ramp never had, and it is exactly "what has
actually been unlocked/bought," the first candidate the prompt named.

Two properties fall out for free rather than needing separate handling:

- **Only `+1` unlocked, `maxCost` equals the board's own operator budget (46).**
  `costCeil` saturates there on the same order the old value ramp first exceeded
  47 — bit for bit the old curve, verified below.
- **`x2` unlocked, `maxCost` is 14.** The ramp saturates there within about 3 orders
  of `x2` existing, not 15. Measured: average tiles required climbs from 6.7 (order
  0) to 12.3 (order 3) and holds at ~12.3 out of a ceiling of 14 indefinitely —
  order 30, order 200, doesn't matter, because `maxCost` is a fact about the board
  and the unlocked ops, not about `ordersFilled`. The old generator's 300-value cap
  is now irrelevant to the felt difficulty once `x2` exists; the tile cost is what
  governs it, and that never depended on the 300 cap in the first place.

**Fillability is untouched.** `rollTarget` still only ever draws from
`plan.cost.keys()`, which is exactly the set `buildCosts` proved reachable within
budget and `HARD_CAP`. Nothing about the cost ramp changes what set of values is
eligible, only which subset within that set gets weighted toward. The
already-passing "20000 rolls, none unfillable" and "twelfth order is the first that
could be unfillable" checks needed no changes at all — see below.

I considered and rejected tying the ramp to a fixed number of orders after each
purchase (so a late `x2` buy would smooth in gradually too, not just an early one).
That needs a persisted "orders since this changed" field, which touches
`state.js`/repair/migration for a benefit that does not matter in practice: a late
`x2` purchase snapping `costFloor` to near `maxCost` immediately is not the failure
mode being fixed. Asking for close to the hardest thing a line can currently do is
the *point*; asking for nothing was the bug. Kept it simple.

### Nothing else touched

`js/state.js`, the HTML, the save shape, fonts, mobile sizing — none of it needed
edits for this. `SAVE_VERSION` stays 1: `rollTarget`'s output is still just an
integer in `sinks[i].target`, same as before, and `repairState`'s
`isReachable`/`nearestReachable` clamp on load works identically regardless of how
the number was chosen.

## What I verified

- `node Projects/integer-foundry/test/smoke-targets.mjs` → **94 checks, 0 failed**
  (was 90; see below for what changed in the suite itself).
- `node Projects/integer-foundry/test/browser.mjs` → **56 checks, 0 failed**, no
  changes needed to this file at all — every assertion in it either checks
  fillability (unaffected, see above) or runs at `ordersFilled: 0` where the ramp is
  intentionally unrestrictive on both the old and new curve.
- `cd Tools/board-check && npm run games` → **126 checks, 0 failed**, exactly the
  expected count. Integer Foundry's own beat in `play-games.mjs` writes
  `sinks[0].target = 3` directly into state rather than calling `rollTarget`, so it
  never exercised the curve change at all — nothing there needed touching, and
  round 1's shared-file request to stop seeding it is still exactly what it was.
- `node assets/js/gvb-save.test.mjs` → **50 passed, 0 failed**, unchanged, no module
  edits needed.
- `cd Tools/board-check && node check-collisions.mjs` → **0 collisions, tightest
  vertical gap 9.2px** (matches the expected count).
- **Locked decision #34**, reintroducing the bug on purpose: ran the exact pre-fix
  curve's math against the new fillability model — 2590 of 5000 rolls unfillable at
  30 orders filled, the new one 0 of 5000. Unchanged from round 1's own numbers,
  confirming the correctness fix this curve work sits on top of is still intact.
- New checks for the curve fix specifically, in `smoke-targets.mjs`'s "Rolling an
  order" group: `x2` alone caps this board's hardest tile count at 14 (well under
  the 46-cell budget); a fresh roll at order 0 with `x2` already owned is not yet
  demanding near that cap; it climbs by order 3; by order 30 (the stretch that used
  to be flat) rolls average over 70% of the cap; and the same holds at order 200,
  demonstrating the fix does not depend on `ordersFilled` catching up to the old
  300-cap math the way the broken version of this fix (see below) did.

**One thing I could not verify clean, and it is not mine.** `cd Tools/board-check
&& npm run check` failed its integrity sweep on `newindex.html` (offsite font
hosts) — that file is not one of the six games and not anything I touched; it looks
like another session's in-progress work in the shared tree. Same story with `npm
run social:check`: it could only parse 17 of 22 notices out of `index.html`, "the
notice markup has changed shape" — `index.html` is explicitly off-limits to me
(owned by prompt 21), and this reads as a concurrent edit mid-flight, not a
regression from anything in my boundary. I ran `check-collisions.mjs` on its own
(above) to get a clean read on the part of `npm run check` that could plausibly
involve integer-foundry, and it's fine. Flagging both so whoever picks up prompt 21
next isn't surprised, not filing either as a request since I don't know what the
other session's edit is going to look like when it lands.

### What changed in `smoke-targets.mjs`

The "Rolling an order" group's old drift check compared `rollTarget`'s average
output against the old generator's formula and asserted they matched within 8% —
that assertion is now testing the wrong thing on purpose, because the whole point
of this session was to make the average *not* match the old generator once `x2` is
in play. I kept the two assertions that still describe an invariant ("no roll
exceeds the old ramp's value ceiling," "none below 2" — both still true on a
`+1`-only board, where cost and value are the same number) and replaced the drift
check with the five new assertions described above, which test what the curve is
actually supposed to do now. Net: +4 checks (one drift assertion out, five new ones
in), 90 → 94.

## Shared-file requests

None new. Round 1's request against `Tools/board-check/play-games.mjs` (remove the
`sinks[0].target = 3` seeding, build a line for whatever the sink actually asks for)
is still exactly as written and still the right call — this session's curve change
doesn't touch it either way, confirmed above. I did not re-paste that block here;
see last round's notes or `Projects/integer-foundry/test/browser.mjs`'s "Filling
whatever the sink asks for" group for the logic, unchanged.

## Deliberately not done

**Task two, the two conservative model gaps.** Session time went entirely to the
curve, which was the headline item and took real verification work to get right (my
first two attempts at the cost-ramp both had a real bug — see below). Both gaps are
still exactly what round 1 described: mergers/splitters excluded from the BFS
(safe direction, makes orders easier than they need to be on a board with `Merge x`
but not `x2`), and `opBudget` dividing the floor evenly by sinks placed (conservative,
ignores shared prefixes through a splitter). Neither is urgent for the reason round 1
gave — the game never hands out an unfillable order either way — and I'd add one
more reason to leave the first alone specifically: modeling a merge point correctly
means the reachability problem stops being a single shortest path and becomes a tree
where two BFS'd sub-chains feed one node, which is real complexity for a fix whose
entire value is "an order could occasionally be a little harder than it is now."
Not worth the risk of getting the tree-merge logic subtly wrong and reintroducing an
over-promise in the one system in this game that has to never over-promise.

**A "smoothing window" tied to time-since-purchase rather than `ordersFilled`.**
Covered above — decided against it, the persisted-state cost wasn't worth it for a
difference that only shows up on a *late* purchase, which isn't the failure mode.

**Two design attempts that didn't survive contact with the numbers, worth recording
so the next session doesn't re-walk them:**

1. Filtering the existing value-ceiling pool by `cost >= costFloor` where
   `costFloor` was a fraction of the *board's operator budget* (46) rather than of
   `maxCost`. This looked right until I actually computed it: once `x2` is
   unlocked, `buildCosts`' BFS exhausts every integer under the 300 cap by depth 14
   and never produces a cost higher than that, ever, regardless of budget. Any
   `costFloor` derived from the 46-cell budget eventually exceeds 14, the pool goes
   empty, and the fallback silently reverts to the exact unrestricted behavior the
   fix exists to remove. Caught this by actually printing `avgCost` at order 40 and
   getting 7.5 tiles when the design intended something near 14 — the number
   didn't lie, the model did.
2. An exact single-cost bucket (`cost === costCeil`, no band) tied to a 20-order
   ramp window. This fixes the averages but, on a board that never buys anything,
   collapses to *exactly one* deterministic value forever once `costCeil` saturates
   at the board's budget (47, always, no variance) — worse than the old system's
   texture even though it is correctly non-trivial. The band (`costFloor` a few
   ticks under `costCeil`) fixes this and is the version that shipped.

Recording both because "is this a good curve" is Devon's call as much as mine, and
the two failed attempts are exactly the kind of dead end worth not re-discovering.

## Next session

Ordered by value per effort.

1. **The two model gaps (task two above).** Mergers/splitters into the BFS is the
   bigger of the two and the one I'd think hardest about before touching — see the
   tree-vs-chain complexity note above. `opBudget`'s even split across sinks is the
   smaller, lower-risk one if only one gets picked up.
2. **Everything round 1 already listed and didn't get to this round:** adopting
   `gvb-save.js` in Closing Time, moving The Fourth Quarter's save bar off the start
   screen, vendoring fonts on the other fourteen pages, Castle Conundrum's blurry
   walls. None of these are Integer Foundry's to do, but they're still the highest
   standing value in the site-wide backlog as of last round and nothing this round
   changed that.
3. **Playtest the new curve for feel, not just the numbers.** I verified the tile
   cost climbs the way it's supposed to; I did not play the game with a stopwatch.
   If order-30-with-`x2` still feels too easy or too hard in practice, the two
   tunable constants are the ramp rate (`4 + ord*3 + jitter(0..7)`, in tile terms
   now) and the band width (`maxCost/8`) — both isolated to `rollTarget` in
   `js/targets.js`, nothing else needs to change to retune either one.
