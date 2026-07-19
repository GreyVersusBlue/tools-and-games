# Aphelion

*A quiet life, far from anywhere.*

A cozy, browser-based 3D life-sim about a lone astronaut keeping a small, aging ship — and themselves — running. No fail states, no timers, no enemies. Just gauges to check, a plant to water, a logbook to fill, and a lot of very patient stars.

Built with Three.js as a static site. No build step, no backend.

## Running it

**Locally:** the game fetches JSON data files, so it needs to be served over HTTP (opening `index.html` directly via `file://` won't work in most browsers).

```bash
# from the repo root — any static server works:
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

**GitHub Pages:** push the repo, enable Pages on the main branch (root), done. Everything is relative-pathed.

## Controls

| Key | Action |
|---|---|
| Click | Board / capture mouse |
| WASD + mouse | Move & look |
| E | Interact (repairs are multi-step — keep pressing E) |
| Tab | Open/close logbook |
| Space / Shift | Rise / descend (EVA only) |

## The loop

- **Systems** — power, O₂, and hull drift down slowly. Below ~55% you get a soft chime and a CERES note; lights dim as power drops. Nothing can fail permanently. Walk to a panel and press E through the repair steps to bring it back to 100%.
- **Hydroponics** — water the tray (E), keep it above ~30% and the crop advances a stage each night. Four stages, then harvest.
- **Sleep** — the bed in quarters ends the day, grows the plant, unlocks new log entries.
- **EVA** — cycle the airlock at the aft of the ship to drift outside. A derelict relay satellite is out there; look at it and press E to scan it for parts, a curio for the shelf, and a recovered-signal logbook entry. The hatch on the ship's stern takes you back in.
- **Logbook** — Tab. Entries unlock by day; discoveries unlock by scanning.

Progress saves to `localStorage` automatically (on sleep, on repairs, and every 30 seconds). To wipe a save, clear site data or run `localStorage.removeItem('aphelion-save-v1')` in the console.

## Repo structure

```
index.html          entry point, HUD/logbook DOM, import map (Three.js via CDN)
src/
  main.js           game loop, interactions, day cycle, EVA transitions
  ship.js           all 3D construction: interior, props, exterior, stars, POIs
  controls.js       first-person + EVA movement, collision
  state.js          game state + localStorage save/load
  ui.js             HUD, prompts, CERES toasts, logbook, fades
  audio.js          procedural WebAudio (hum, chimes, clicks) — no audio files
data/
  rooms.json        hull bounds, room list, partition/doorway layout
  systems.json      ship systems: decay rates, panel positions, repair steps
  logs.json         log entries (unlock by day) + discovery texts
  poi.json          EVA points of interest
assets/             (empty for now — models/textures/audio go here later)
```

## Extending it

The data files are the extension points — most additions need no code changes:

- **New ship system:** add an entry to `data/systems.json` (id, decay rate, panel position, repair steps, CERES lines) and a matching gauge in `index.html`'s HUD.
- **New log entries:** append to `data/logs.json` with an `unlockDay`.
- **New EVA discoveries:** add to `data/poi.json` (position, scan time, yields, optional `discoveryId` pointing at a `discoveries` entry in `logs.json`).
- **New rooms:** extend the hull bounds and room list in `data/rooms.json`; the partition/doorway collision is data-driven.

Bigger swings (more plants, crafting with salvaged parts, weather-like ambient events, a second POI type) slot into `main.js`'s interaction switch and the sim loop.
