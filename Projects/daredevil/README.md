# Daredevil

The game. Round 1 (session 9) made it completable for the first time and
added a save, vendored fonts and a test suite alongside the still-monolithic
`Projects/daredevil_r4.html`. Round 2 did the restructure round 1 deliberately
deferred: the engine and the story are now separate ES modules under `js/`,
and `index.html` here is the entry point. `Projects/daredevil_r4.html` is now
a redirect stub (matching locked decision #46's pattern) pointing here — see
the repo root's `HISTORY.md`, round 2, for the full account.

```
daredevil/
  index.html        entry point — head, CSS, body markup, one module script tag
  js/
    cast.js          the six characters: legal states, labels, start state — the schema the save and the routes read
    state.js         GS, STAT_LABELS, N/D/C/NF, and cast.js re-exported — see its own header for why
    scenes.js        the story, as data — SCENES, 244 KB (208 KB before Phase 1)
    engine.js        the runtime — screens, hubs, minigames, epilogue, boot
    save.js          the save format, on top of assets/js/gvb-save.js
  fonts/            7 woff2, 100.3 KB — see fonts/README.md
  test/
    drive-daredevil.mjs   how to get into the game and through it, written once
    smoke-save.mjs        110 assertions, plain Node, no browser: the save format and the cast table
    flags.mjs             7 assertions, plain Node: who writes each flag against who reads it
    smoke-page.mjs        the regression suite: real browser, plays to an ending three times
    transcript.mjs        plays a run and writes down every line of it
    transcripts/          output of the above; the record of what the game is
```

## Running things

```
node Projects/daredevil/test/smoke-save.mjs      # fast, no browser
node Projects/daredevil/test/flags.mjs           # fast, no browser
node Projects/daredevil/test/smoke-page.mjs      # the real one, ~25 minutes
node Projects/daredevil/test/transcript.mjs clean
node Projects/daredevil/test/transcript.mjs rough
node Projects/daredevil/test/transcript.mjs no_earl   # answers "Not interested" at the fair
node Projects/daredevil/test/transcript.mjs no_pete   # declines the Young Wannabe
node Projects/daredevil/test/transcript.mjs no_earl_solo   # "Not interested", then the other answer at every solo fork
node Projects/daredevil/test/transcript.mjs no_earl_crash  # "Not interested" and a crash at every stunt: the solo failure arms
node Projects/daredevil/test/verify-touch-375.mjs     # 375px, touch-emulated pointer input
```

Both browser scripts take `--headed` if you want to watch. Only run one at a
time: Chrome throttles a window that loses focus (v7 §6), and other threads in
this repo run their own headed suites.

## Why the suite plays the whole game

Daredevil shipped with four wiring bugs that between them made it impossible to
finish, and **not one of them throws or logs anything a player would see**:

- every hub gated its milestone button on a counter that could not reach zero
- `_minigame_stunt_m3` was named by four choices and answered by nothing
- Milestones 3, 4 and 5 read `res.outcome` off an object whose field is `res.result`
- two hub cards were gated on flags their own scenes never set

The only thing that catches that class of bug is playing to the end and checking
where you landed. So `smoke-page.mjs` does exactly that, three times — once
clean, once crashing at the county fair, once turning Earl Maddox down — and
fails on a dead end, a loop, or an ending it did not expect. After the three
runs it drives four endings straight from their outcome scene, which is how the
two Milestone 5 scenes a full run reaches only one of at a time get checked
without a fourth playthrough.

`flags.mjs` is the other half, and needs no browser. The same bug wears a
second face: a flag read by a guard and written by nothing, or written by a
scene and read by nothing. `pressAtFair` guarded five finished lines and could
only ever be `false`; `m5Decision` was written by all eight Milestone 5 choices
and read by nothing, so an entire ending's epilogue was dead. The audit counts
writers against readers and exits non-zero, and it lives outside the files it
scans on purpose (locked decision #262).

`transcript.mjs` is the exploratory half. It is what produced the description of
the game in `HISTORY.md`, round 1, and re-running it before
and after a refactor is the only reliable way to notice that a branch quietly
stopped existing.

## The one thing the game exposes for tests

`window.__dd` — `GS`, `SCENES`, the save slot, `goToScene`, and getters for the
live scene id and minigame. The inline script is a module, so nothing in it is
global any more; this is the deliberate door.

The stunt run's `tele` object also carries `w` (angular velocity). It is a debug
channel nothing in the game reads, and `autopilot()` cannot steer a landing
without it — a proportional loop on angle alone swings straight through the band.

Work the Crowd (round 2, `js/engine.js`'s `createCrowd()`) carries the same kind
of hook for the same reason: `mg.correctCall`, the id of the card that matches
the current crowd mood. It is a "choices" minigame, not a "pedals" one, so
there is no `tele` to read a phase off of — without `correctCall`, `autopilot()`
has nothing to click and the game self-resolves into FAIL on its own per-round
timeout every time.
