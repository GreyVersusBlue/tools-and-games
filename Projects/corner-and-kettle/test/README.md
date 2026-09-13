# Corner & Kettle tests

Three suites. All exit non-zero on any failure (locked decision #13).

```
node Projects/corner-and-kettle/test/smoke-sim.mjs     114 assertions, no browser, seeded
node Projects/corner-and-kettle/test/smoke-save.mjs    166 assertions, no browser
node Projects/corner-and-kettle/test/drive-save.mjs     90 checks, real browser
```

## `smoke-sim.mjs`

Drives `../js/sim.js` with `makeRng(seed)` and `advance(dtMs)`, so a
136-second shift runs in milliseconds and runs the same way twice. Ten sections:
the rng; a fixed seed's fixed order sequence; every recipe built by the barista
against the ticket and the scorer; the scoring curve; `advance(136000)` once
against 8,160 frames; the timers that used to be separate; baristas on the
clock; a whole day played by a one-line autopilot; prestige; and a source check
that the page has no dice or clock of its own. Phase 2's `balance.mjs` builds on
the autopilot here.

## `smoke-save.mjs`

Drives `../js/save.js` directly under plain Node. No DOM, no dependencies.
Covers the schema: what `validate` refuses, what `migrate` reshapes, what
`repair` fills in and clamps, and the serialize/deserialize pair.

Section 10 exists because of locked decision #34 — every guard-rail in `repair`
is asserted twice, once as "the repaired value is right" and once as "here is
the arithmetic that goes wrong without it". Disable a line in `repairSave` and
the failures name the bug rather than a number.

## `drive-save.mjs`

Real Chromium, real clicks, via `Tools/board-check/harness.mjs` (read-only —
same launch flags, so `requestAnimationFrame` keeps running in a window nobody
is looking at, v7 §6). Without those flags the Base and Milk progress bars never
fire their callbacks and the shift clock never advances, which reads exactly like
a broken game.

Thirteen sections: the module script actually running, the seven vendored faces,
building and serving a drink, the day loop through to the day-end modal, the
save round trip, export, a cleared browser restored from the file, four corrupt
files refused, a save written by the old hand-rolled writer, a hand-edited save
that used to freeze the game, New Game, and 375×812.

The Node suite is blind to all of that. It would pass with a `<script>` tag that
never parsed.

### Two things that cost a run here

**The chalkboard slides in from off-screen.** New Game and the save bar sit
outside the viewport until `#chalkToggle` is clicked. Playwright still calls them
"visible" and then times out trying to click, which reads as a missing button.
Open the panel first.

**Assertions on regulars cannot be exact key matches.** `init()` rebuilds the
queue with three random orders and each has a 1-in-8 chance of minting a new
named regular, so `Object.keys(regulars) === 'Nora'` is a coin flip in a
suit. Assert `includes`, and key a regular that must be *absent* on a name the
generator never rolls (locked decision #40).

### Artifacts

Exports and the deliberately-corrupt fixtures are written to
`<tmpdir>/corner-and-kettle-test/`, outside the repo on purpose: `npm run check`
parses every `.json` in the tree, and a corrupt fixture in here reads as a broken
unit and fails a clean repo.
