# Golden Hour — a beach walk

A quiet first-person walking simulator, grown from one beach into 1.6 km of
coastline. Sunset over the water, slow waves, dunes at your back — and now the
sun goes all the way down. Stay long enough (or sit by the fire, where the hour
passes six times faster) and you get blue hour, the first stars, a rising moon,
bioluminescent surf, and a lighthouse sweeping the dark. A fresh visit always
opens at the same golden frame; the descent is never saved.

The coast has places now. West past the home beach the ground shoulders up into
a headland — a climbable east flank, a real cliff face, a lighthouse on top, a
tide-pool shelf at the base with a sea cave scooped into the rock (the audio
runs a synthesized-impulse reverb in there). Behind the beach a winding trail
threads the dune field, fenced, with a camp at its mouth. East, a ruined pier
walks out over the water to a collapsed span, and past it the shoreline bends
inland around a river mouth with reed beds and a wadeable channel.

It is inhabited. Sanderlings chase the swash edge exactly in time with the
water; gulls wheel, and come down for scattered crumbs; a dolphin breaches past
the break; pelicans skim the coast in a line; seals haul out below the headland
and pour into the sea if you come in fast; ghost crabs work the wrack line
after sundown; a heron stands at the river; cormorants dry their wings on the
pier's far stumps; anemones, starfish and darting shannies live in the pools.
At dusk, fireflies in the trail hollows and bats over the camp; at night, an
owl on the dead snag. Rarely — a bait ball offshore with terns hitting it, a
whale's spout on the horizon, moon jellies stranded glowing on the tide line, a
meteor shower on the right night.

There are things to do with your hands, none of them scored: skip flat stones
off the water, pick up and examine forty named shells, shape a sandcastle on
the damp sand and watch the swash decide about it, feed the gulls, sit by the
fire. H hides all the chrome for a clean look at the light.

What you find is remembered. A field journal (J) records species you have
honestly watched, shells you have examined, places you have reached — it
persists between visits (the one thing that does), with pencil-outline hints
whispering what is still out there.

## Run it

Serve the folder over HTTP (ES modules won't load from `file://`):

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Or push the folder to a GitHub Pages repo as-is — no build step.

## Controls

- **Desktop:** WASD to walk. Mouse to look (click to lock it, Esc to release), or
  **the arrow keys**, which look without needing pointer lock at all. E uses
  whatever the hint pill offers; J opens the journal; H is photo mode.
- **Touch:** drag to look; hold the bottom third of the screen to walk forward.
  The hint pill is tappable — on touch it *is* the verb, including the
  hold-and-release stone throw.
- Speaker icon toggles sound; the book icon opens the journal.

Nothing here needs aiming, so nothing here requires the mouse to be captured.

You can wade to about knee depth — the limit is a water depth, not a line on
the sand, so it breathes with the swash and hugs the shoreline curve (steeper
seabed off the headland stops you sooner). There are no colliders anywhere:
cliffs, the pier's broken end, and everything else tall are made solid by one
rule — a stride that would rise more than 0.9 m is refused.

## Assets & audio

- three.js (r-current), Sky and Water addons — bundled locally in `libs/`.
- `assets/waternormals.jpg` — bundled (from the three.js examples repo).
- Sand texture: Poly Haven's `aerial_beach_01` diffuse + normal maps, **bundled**
  in `assets/textures/` (370 KB, CC0 — see the README there). `terrain.js`
  paints a procedural canvas sand first and swaps these in when they decode, so
  the beach never breaks — deleting them just makes it look hand-mixed.
- Everything else visual is runtime canvas or geometry: the stars, Milky Way,
  moon, fire, shells, castle, contrail, detail textures — 0 asset bytes.
- All audio is synthesized live with the Web Audio API — ocean, wind, gulls,
  sanderling peeps, seal barks, pelican croak, curlew, owl, crickets, fire
  crackle, footsteps (sand and pier planking), skips, splashes, the cave's
  ConvolverNode reverb (its impulse response is generated noise). No files.
- Zero offsite requests at runtime, still.

## Structure

```
index.html
css/style.css
js/field.js       the pure world: heightfield, shoreline curve, regions,
                  walk limits, and the fixed layout of everything placed
js/main.js        scene, sky, the six-keyframe palette, the descent, loop
js/skynight.js    stars, Milky Way, moon, shooting stars
js/terrain.js     chunked sand, wet strips, grass, reeds, the river ribbon
js/props.js       groyne, driftwood, boulders, wrack, fence, pools, cave
js/pier.js        the ruined pier's piles, planking and stumps
js/lighthouse.js  the tower and its sweeping beam
js/ocean.js       water shader, tide swash, per-chunk foam strips
js/wildlife.js    the original quartet + the creature registry
js/creatures/     sanderlings, crabs, pelicans, seals, tidepool life,
                  fireflies/owl/bats, heron/cormorants
js/events.js      bait ball, whale spout, moon jellies, meteor shower
js/campfire.js    the camp, the fire, the crumb tin
js/interact.js    the one verb system (hint pill + E / tap)
js/stones.js      skipping stones
js/shells.js      the forty named finds
js/sandcastle.js  castles, and the sea's opinion of them
js/journal.js     the field journal (uses the site's shared gvb-save)
js/journal-core.js  its pure half: species, names, normalization
js/regions.js     arrival cards and journal places
js/controls.js    first-person stroll, wading, the step rule, sitting
js/audio.js       the whole synthesized soundscape
js/footprints.js  footprint ring buffer (glows teal at night)
libs/             three.module.js, Sky.js, Water.js
assets/           waternormals.jpg, textures/
test/smoke.mjs    node test/smoke.mjs — the world's arithmetic, no browser
```

`field.js` and `journal-core.js` import nothing, and that is the point of them:
everything else imports the bare specifier `three`, which only resolves through
`index.html`'s import map, so Node can't load any of it. The world's shape and
the journal's rules live in dependency-free files so the smoke suite can hold
them to their claims.

## Tests

```
node test/smoke.mjs
```

93 checks on the arithmetic: twelve golden heights hold the home beach
bit-identical to its pre-coast self, the shoreline curve never bends enough to
fold the foam, the cliff refuses a stride while its flank climbs, the pier deck
enters at beach level and stops at the gap, the river is carved but always
crossable, the cave backs into the cliff with a dry floor, every placement sits
where its purpose needs it, and the journal survives garbage, truncation and
another game's save file. It cannot see whether any of it renders — for that,
`npm run games golden-hour` in `Tools/board-check` drives the real page. The
game exposes a `?debug` hook (`window.__gh`) so a driver can scrub the sun to
night, teleport down the coast, aim the camera, and read the journal.
