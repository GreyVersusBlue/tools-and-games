# Blue Hour — a mountain trail

A first-person walking piece: 860 metres of switchback trail climbing a
fog-bound mountainside at blue hour, through woods crammed with trees and
wildlife, to a lookout above the cloud line. The deliberate sibling of
`Projects/golden-hour-beach/` — blue hour is the cold dusk that follows
golden hour, and this is the walk you take after that one.

Open `index.html` over any static server. Click to begin; WASD walks, mouse
or arrow keys look, Esc releases the pointer. On touch: drag to look, hold
the bottom of the screen to walk. Sound on — everything you hear is
synthesized live.

## What's out there

- A trail benched into the hillside, packed dirt blended into forest floor
  in the ground shader, marked by 14 blazed posts.
- ~3,800 trees in two tiers: instanced conifers (with vertex-shader wind)
  and birches near the trail, silhouette cards where the fog has already
  flattened everything anyway. Ferns, shrubs and dead grass along the
  corridor as billboarded cutouts.
- A creek with a footbridge and a waterfall just upstream of it.
- Seven cairns hidden off-trail (a quiet counter keeps score), a ranger
  cabin with one lit window, deer that freeze and stare before they bolt,
  perch-hopping birds, crows over the canopy, a squirrel, an owl, one fox,
  and an elk you will only ever hear.
- The weather breathes: fog density ebbs and swells on two slow overlapping
  cycles, from ~45 m visibility to ~100 m and back. Light shafts break
  through in the clear phases; fireflies come out in the thick ones.
- Above ~50 m elevation the trail climbs out of the fog entirely — the
  summit bench and fire lookout sit in thin bright air over a cloud sea.
- And the woods are not honest. Branches break where nothing is. Your
  footsteps sometimes take a half-second too long to stop. The birds go
  quiet all at once. Things stand between the trees at the edge of the fog
  and are not there when you look again. Nothing here can hurt you, which
  is not the same as nothing being here.

## Architecture

Same shape as Golden Hour: no build step, ES modules resolved through an
import map, three.js vendored in `libs/`, zero offsite requests, every
texture drawn into a canvas at load, every sound synthesized in Web Audio.

`js/field.js` imports nothing — it is the mountain as arithmetic
(heightfield, trail curve, creek, and the seeded deterministic layout of
everything standing on it), and `test/smoke.mjs` checks it under bare Node:

```
node test/smoke.mjs
```

`test/browser.mjs` is the other half: it serves the site, boots the real page in
real Chromium through `?debug`, and checks the things arithmetic can't see —
draw budget, the fog cycle, the climb, the cairn counter, every dread beat, and
a genuine walk up the trail. It needs `playwright-core` and a Chromium on disk,
neither of which the piece itself depends on:

```
npm i playwright-core
node test/browser.mjs            # CHROME=/path/to/chrome to override the binary
```

Adding `?debug` to the URL exposes `window.__bh` — the fog clock, the walker,
the dread scheduler and the renderer's draw counts. Nothing in the piece opens
those doors itself.

**Known, and the next thing to fix:** the summit doesn't pay off yet. The cloud
sea sits at y 46 while the top of the mountain is a plateau averaging ~60 m, so
it's buried inside the hill, and with no fog left up there to lift it the ground
reads nearly black. `test/browser.mjs` prints both measurements rather than
asserting them, since the fix is a decision about the mountain rather than a
tuning nudge. See `Claude Prompts/notes/24-blue-hour-notes.md`.

The rest: `terrain.js` (ground + undergrowth), `forest.js` (tree tiers),
`props.js` (built things), `creek.js` (water), `atmosphere.js` (mist,
shafts, fireflies, cloud sea), `wildlife.js` (everything that is really
there), `dread.js` (everything that is not), `audio.js` (the soundscape),
`controls.js` (walking), `main.js` (the breathing fog and the loop).
