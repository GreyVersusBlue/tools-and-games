# Golden Hour — a beach walk

A quiet first-person walking simulator. Sunset over the water, slow waves,
dunes at your back, gulls overhead, a sailboat drifting the horizon, the
occasional dolphin — and every few minutes, a jet crossing the sky with a
contrail.

## Run it

Serve the folder over HTTP (ES modules won't load from `file://`):

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Or push the folder to a GitHub Pages repo as-is — no build step.

## Controls

- **Desktop:** click to lock the mouse. WASD / arrows to walk, mouse to look, Esc to release.
- **Touch:** drag to look; hold the bottom third of the screen to walk forward.
- Speaker icon (top right) toggles sound.

## Assets & audio

- three.js (r-current), Sky and Water addons — bundled locally in `libs/`.
- `assets/waternormals.jpg` — bundled (from the three.js examples repo).
- Sand texture: the app attempts to fetch Poly Haven's `aerial_beach_01`
  diffuse + normal maps at runtime from their CDN; if unreachable it falls
  back to a bundled procedural sand texture, so the scene never breaks offline.
- All audio (ocean, wind, gulls, footsteps, jet, splashes) is synthesized
  live with the Web Audio API — no external audio dependency. To use a real
  recording instead, see the note at the top of `js/audio.js`.

## Structure

```
index.html
css/style.css
js/main.js        scene, sky, lighting, loop
js/terrain.js     beach + dune heightfield, sand, grass
js/ocean.js       water shader, tide swash, foam line
js/wildlife.js    dolphin, gulls, sailboat, plane + contrail
js/controls.js    first-person stroll controls
js/audio.js       procedural soundscape
libs/             three.module.js, Sky.js, Water.js
assets/           waternormals.jpg
```
