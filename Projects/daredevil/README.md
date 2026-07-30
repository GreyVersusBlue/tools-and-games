# Daredevil — supporting files

The game itself is still one file: **`Projects/daredevil_r4.html`**. This folder
holds the parts that could not live inside it — a save module Node can import,
vendored fonts, and a test suite.

```
daredevil/
  js/save.js        the save format, on top of assets/js/gvb-save.js
  fonts/            7 woff2, 100.3 KB — see fonts/README.md
  test/
    drive-daredevil.mjs   how to get into the game and through it, written once
    smoke-save.mjs        53 assertions, plain Node, no browser
    smoke-page.mjs        the regression suite: real browser, plays to an ending twice
    transcript.mjs        plays a run and writes down every line of it
    transcripts/          output of the above; the record of what the game is
```

## Running things

```
node Projects/daredevil/test/smoke-save.mjs      # fast, no browser
node Projects/daredevil/test/smoke-page.mjs      # the real one, ~15 minutes
node Projects/daredevil/test/transcript.mjs clean
node Projects/daredevil/test/transcript.mjs rough
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
where you landed. So `smoke-page.mjs` does exactly that, twice — once clean, once
crashing at the county fair — and fails on a dead end, a loop, or an ending it
did not expect.

`transcript.mjs` is the exploratory half. It is what produced the description of
the game in `Claude Prompts/notes/13-daredevil-notes.md`, and re-running it before
and after a refactor is the only reliable way to notice that a branch quietly
stopped existing.

## The one thing the game exposes for tests

`window.__dd` — `GS`, `SCENES`, the save slot, `goToScene`, and getters for the
live scene id and minigame. The inline script is a module, so nothing in it is
global any more; this is the deliberate door.

The stunt run's `tele` object also carries `w` (angular velocity). It is a debug
channel nothing in the game reads, and `autopilot()` cannot steer a landing
without it — a proportional loop on angle alone swings straight through the band.
