# Golden Hour — a beach walk

A quiet first-person walking simulator. Sunset over the water, slow waves,
dunes at your back, gulls overhead, a sailboat drifting the horizon, the
occasional dolphin — and every few minutes, a jet crossing the sky with a
contrail.

There is a groyne wading out into the water at the west end and a cluster of
boulders standing in the shallows at the east, driftwood between them, and a
wrack line of shells and weed along the tide mark. Those are there because a
piece tagged `Explore` has to reward walking, and before session 8 this was 280
metres by 106 metres of empty sand — you could walk west for seventy seconds and
arrive at a view identical to the one you left.

The sun moves. It drifts from 5.6° above the horizon down to 1.1° over eight
minutes of walking and then stops. It stops on purpose: a sun that goes all the
way down turns this into a dark beach, which is a different and worse piece. The
clock only runs while someone is actually walking, so a tab left on the title
card doesn't burn the whole descent.

## Run it

Serve the folder over HTTP (ES modules won't load from `file://`):

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Or push the folder to a GitHub Pages repo as-is — no build step.

## Controls

- **Desktop:** WASD to walk. Mouse to look (click to lock it, Esc to release), or
  **the arrow keys**, which look without needing pointer lock at all.
- **Touch:** drag to look; hold the bottom third of the screen to walk forward.
  Works on a phone — 375×812 portrait was checked, and it is the best-suited
  thing on the site for one.
- Speaker icon (top right) toggles sound.

Nothing here needs aiming, so nothing here requires the mouse to be captured.
Pointer lock ends on Esc and on anything that takes focus off the page; when that
happens a hint appears at the bottom of the screen saying so, because the previous
behaviour was for mouse-look to stop working silently.

You can wade into the water up to about knee depth — the limit is a water depth,
not a fixed line on the sand, so it moves in and out with the tide (see
`field.js`'s `wadeLimitZ`). Past that, the wash sound rises the same way it does
on a big swash. Walking on the wet strip near the tideline leaves footprints that
fade out after about a minute.

## Assets & audio

- three.js (r-current), Sky and Water addons — bundled locally in `libs/`.
- `assets/waternormals.jpg` — bundled (from the three.js examples repo).
- Sand texture: Poly Haven's `aerial_beach_01` diffuse + normal maps, **bundled**
  in `assets/textures/` (370 KB, CC0 — see the README there). These were hotlinked
  from Poly Haven's CDN until session 7, which made this the only page on the site
  that touched another host while someone was looking at it. `terrain.js` still
  paints a procedural canvas sand first and swaps these in when they decode, so
  the beach never breaks — deleting them just makes it look hand-mixed.
- All audio (ocean, wind, gulls, footsteps, jet, splashes) is synthesized
  live with the Web Audio API — no external audio dependency. To use a real
  recording instead, see the note at the top of `js/audio.js`.
- The sand's tiling is broken up by a second, low-frequency canvas texture
  multiplied into the diffuse in `terrain.js` (`onBeforeCompile`), tiled at a
  different repeat than the photographed sand. Runtime canvas, 0 bytes on disk.
  The footprint ovals in `footprints.js` are geometry, not a texture — same
  reason, 0 bytes.
- Dune grass is camera-facing quads (`terrain.js`'s `buildGrass`), billboarded
  around each blade's own root in a vertex shader — no per-frame JS, one draw
  call, same as the `LineSegments` it replaced. Geometry only, 0 bytes.

## Structure

```
index.html
css/style.css
js/field.js       heightfield + the fixed layout of everything on the sand
js/main.js        scene, sky, the moving sun, lighting, loop
js/terrain.js     sand mesh, wet strip, dune grass
js/props.js       groyne, driftwood, boulders, wrack line
js/ocean.js       water shader, tide swash, foam line
js/wildlife.js    dolphin, gulls, sailboat, plane + contrail
js/controls.js    first-person stroll controls, wading limit
js/audio.js       procedural soundscape
js/footprints.js  footprint ring buffer, dropped from audio's footstep hook
libs/             three.module.js, Sky.js, Water.js
assets/           waternormals.jpg, textures/
test/smoke.mjs    node test/smoke.mjs — heightfield + layout, no browser
```

`field.js` imports nothing, and that is the point of it: everything else in `js/`
imports the bare specifier `three`, which only resolves through `index.html`'s
import map, so Node can't load any of it. Putting the heightfield and the prop
layout in a dependency-free file is what makes them checkable.

## Tests

```
node test/smoke.mjs
```

38 checks on the arithmetic: the ground has no cliffs in it, every prop is inside
the walkable bounds, the groyne's tops descend to the waterline, the boulders
break the surface, the driftwood touches the sand, and the wading limit tracks
the tide and stays well inside the old fallback wall. It cannot see whether any
of it is wired up or renders — for that, `npm run games golden-hour` in
`Tools/board-check` drives the real page in a real browser.
