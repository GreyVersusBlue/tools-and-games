# Blue Hour — a mountain trail

A first-person walking piece: 860 metres of switchback trail climbing a
fog-bound mountainside at blue hour, through woods crammed with trees and
wildlife, to a fire lookout that is not empty. The deliberate sibling of
`Projects/golden-hour-beach/` — blue hour is the cold dusk that follows
golden hour, and this is the walk you take after that one.

Golden Hour is a place you want to be. This is not. The trail only goes up,
the weather only gets worse the higher you get, and the one thing waiting at
the top is watching you arrive.

Open `index.html` over any static server. Click to begin; WASD walks, mouse
or arrow keys look, Esc releases the pointer. On touch: drag to look, hold
the bottom of the screen to walk. Sound on — everything you hear is
synthesized live, including the music: a drone in D minor that surfaces out
of the wind half a minute in, thickens with the fog, sours with the
altitude, and every couple of minutes lets a lonely horn phrase fall back
down to the root.

## What's out there

- A trail benched into the hillside, packed dirt blended into forest floor
  in the ground shader, marked by 14 blazed posts.
- ~3,800 trees in two tiers: instanced conifers in three silhouettes (one
  in ten dead standing), birches near the trail, silhouette cards where the
  fog has already flattened everything anyway. Everything with a crown
  answers the wind in the vertex shader. Eight kinds of undergrowth along
  the corridor as billboarded cutouts — ferns, shrubs, bracken, thistle,
  dead grass, saplings, deadfall sprouts, mossy rocks — and all of it moves.
- A creek with a footbridge and a waterfall just upstream of it.
- Seven cairns hidden off-trail (a quiet counter keeps score), a ranger
  cabin with one lit window, deer that freeze and stare before they bolt,
  perch-hopping birds, crows over the canopy, a squirrel, an owl, one fox,
  and an elk you will only ever hear.
- The weather breathes: fog density ebbs and swells on two slow overlapping
  cycles, from ~45 m visibility to ~100 m and back. Light shafts break
  through in the clear phases; fireflies come out in the thick ones. Dust
  drifts in the clear air, spray comes off the waterfall, and high enough
  up you can see your own breath.
- The climb does not get you out. Above ~50 m the fog closes rather than
  parts — the summit is the thickest air on the mountain, the light goes out
  of it, the birds stop, the wind comes up, and the woods stop pretending.
- And the woods are not honest. Branches break where nothing is. Your
  footsteps sometimes take a half-second too long to stop. The birds go
  quiet all at once. Things stand between the trees at the edge of the fog
  and are not there when you look again. Nothing here can hurt you, which
  is not the same as nothing being here.
- There is somebody in the fire lookout. It is the only structure up there,
  the only thing on the mountain that implies other people, and it has
  someone standing at the rail facing whichever way you go. Look away and
  look back and it has not gone — this is the one thing here that doesn't
  deny itself. Walk to the foot of the tower and it is no longer at the
  rail. Nothing follows you back down.

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

A note on the ending, because the code carries the scar: this piece used to
break out above the fog into bright air over a cloud sea. That never worked —
the mountain is a ramp with no peak in it, so the cloud plane sat inside the
hillside and was reachable by 2 of 30 test rays — and it was the wrong promise
anyway for a walk about being somewhere you'd rather not be. The altitude blend
now runs the other way. See `Claude Prompts/notes/24-blue-hour-notes.md`.

The rest: `terrain.js` (ground + undergrowth), `forest.js` (tree tiers),
`props.js` (built things), `creek.js` (water + spray), `atmosphere.js`
(mist, shafts, fireflies, motes, breath), `wildlife.js` (everything that is
really there), `dread.js` (everything that is not), `audio.js` (the
soundscape and the music), `controls.js` (walking), `main.js` (the
breathing fog and the loop).
