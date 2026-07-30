# Integer Foundry

The game is still one page: `Projects/integer-foundry.html`. The URL has not
changed and nothing on the board needs touching.

What lives here is the part of it that is worth testing without a browser, plus
the fonts it used to hotlink.

```
integer-foundry/
  fonts/          six woff2 + three OFL licences + README (114 KB)
  js/targets.js   reachable-range arithmetic and the order generator
  js/state.js     state shape, validate, repair, the gvb-save slot
  test/           two suites and one capture script
```

## Why anything moved out of the HTML at all

Two reasons, and neither is tidiness.

`targets.js` exists because the sink used to be able to ask for a number the
board could not produce, and fixing that means the generator has to know what a
board can build. That calculation is a shortest-path search over the integers —
pure arithmetic, no DOM — and a game whose whole engine is an IIFE inside one HTML
file cannot test arithmetic without launching a browser.

`state.js` exists for the same reason applied to the loader. `repair` and
`validate` are the parts of a save system that earn their keep, and they earn it
against blobs you would never produce by playing.

The page imports both. It does **not** re-implement the tile arithmetic: the `op`
functions in `TILE_DEFS` come from `targets.js`, so the solver that promises an
order is fillable and the simulator that carries the packet cannot disagree.

## Running the tests

```
node Projects/integer-foundry/test/smoke-targets.mjs
node Projects/integer-foundry/test/browser.mjs
```

Both exit non-zero on failure. `smoke-targets.mjs` is plain Node — 90 checks over
the reachable-range maths, the order generator, `repair`, and the slot.
`browser.mjs` drives the real page through `Tools/board-check`'s harness — 56
checks over the vendored fonts, the save bar, autosave latency, export/import,
an unfillable order being caught on load, building a line to whatever the sink
asks for, a save from the pre-`gvb-save` build, and the grid at 375x812.

`npm run games integer-foundry` in `Tools/board-check` still owns "the production
line works". Nothing here duplicates it.

`capture-legacy-save.mjs` wrote `test/fixtures/legacy-save-v0.json` off the build
that existed before session 8. Do not regenerate that file — being written by the
old code is the entire point of it.
