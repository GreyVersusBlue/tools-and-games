# Faire Weekend

A browser-based renaissance faire management sim, modeled loosely on the
Maryland Renaissance Festival. Run the office, contract performers and
vendors backstage, build out the grounds, schedule the day, open the gates,
and see how you did.

No build step. Static files only — open `index.html` directly or serve the
folder (e.g. `npx serve .`) and it runs. Hosted the same way as this
account's other GitHub Pages projects.

## Files

- `index.html` — shell + font links
- `css/style.css` — all styling (parchment/forest/wine/gold design system)
- `js/data.js` — content: the grounds grid/terrain legend, buildable structure types (stage/food/vendor/demo) with terrain cost/capacity modifiers, performers, vendors, ad/marketing campaigns, performer contract types (day rate vs. Weekend Package), events, config. No logic.
- `js/engine.js` — pure simulation math (RNG, scheduling validation, terrain/adjacency lookup, build-cost quoting, campaign lookup, contract-aware performer cost, day simulation). No DOM.
- `js/state.js` — the game-state object and the actions that change it (immutable-style: every action returns a new state). Also owns localStorage save/load and performer contract commitments.
- `js/ui.js` — state \u2192 HTML string rendering. No event listeners.
- `js/main.js` — the only file that touches `document`. Owns the mutable "current state" reference, wires DOM events, re-renders after every action.
- `tests/smoke.mjs` — jsdom-based smoke test suite (`npm test`)
- `HANDOFF.md` — status, what's next, and retro notes for whoever (or whatever model) picks this up next

## Running the tests

```
npm install
npm test
```

177 checks: pure engine/state logic (RNG determinism, terrain/grid data
integrity, buildable-structure catalog integrity, terrain-driven cost/
capacity quoting, stage-adjacency effects on sightline/traffic, scheduling
conflicts, day-simulation invariants, attendance responding sensibly to
price and popularity, ad-campaign catalog integrity, campaign launch/
cooldown/attendance-boost behavior, contract-type catalog integrity,
Weekend Package discount/commitment/cancellation-fee behavior, a 50-day
fuzz run with no throws/NaNs), plus a DOM boot check covering
tab-switching and the full build-placement flow (pick a structure kind,
tap an open cell, confirm cash and the map both update).
