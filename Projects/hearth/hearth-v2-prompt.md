# Hearth v2 — "The Long Island" — build prompt

You are continuing **Hearth**, a single-file HTML living-island simulation (attached as `hearth.html`). It currently has: procedural island terrain, a village of named settlers with a small job state machine (chop / till / harvest / build), day–night cycle, rain, arrivals by sea, a narrative event log, synthesized ambient audio, and two click interactions. Keep it a **single self-contained HTML file with zero external dependencies** that runs from GitHub Pages or `file://`. Keep it running smoothly on a phone.

Take it from "a nice toy" to "a place people leave open all afternoon and tell stories about." Ship it in **runnable sprints** — every sprint ends with a file that opens and works. Do not ask me to choose between options; make the call, note it, move on.

---

## Sprint 1 — Islanders who feel like people

- Each islander gets a **persistent character**: name, age that advances with the years, two trait words drawn from a list (patient, restless, gossipy, gentle, proud, dreamy, stubborn, brave, homesick, funny), a favorite spot on the island, and 1–3 relationships (friend, rival, partner, parent/child).
- Traits change behavior visibly: restless islanders wander to the far shore; proud ones refuse to farm; gossipy ones generate more log lines; brave ones fish in storms.
- **Life events**: partnerships form (they build a shared house), children are born and grow up over several in-game years, elders die of old age and get a marked grave on a hill the village visits. Names get passed down.
- **Click an islander** to open a small card: portrait (procedurally drawn pixel face — hair, skin, eyes, hat, all from a seeded palette), traits, relationships, "what they're doing and why," and their personal history (born day 14, built the mill, lost a friend in the storm of year 3).
- Log lines should be **generated from state**, not a fixed list: `[name] and [friend] sit by the fire; [name] is telling the story of the [event] again.` Build a small template grammar with slots for traits, weather, season, and recent events so the same day never reads the same twice.

## Sprint 2 — Seasons, weather, and the shape of a year

- A year is four seasons of ~5 days each. **Spring** greens the trees and blossoms them pink; **summer** is long days and gold light; **autumn** turns the canopy red/orange and drops leaves; **winter** brings snow that accumulates on roofs and ground, freezes the shallows, and shortens the day.
- Weather system with fronts: clear, overcast, rain, thunderstorm (lightning flashes that light the whole island for a frame, thunder in the audio delayed by distance), fog that rolls across the water, snow. Storms damage crops and can knock down a tree; islanders shelter indoors.
- Food matters seasonally: crops don't grow in winter, so the village must **store** a granary's worth in autumn or go hungry (hunger slows work, and if severe, an islander leaves by boat — logged sadly).
- Tides: the sand ring visibly widens and narrows over the day.

## Sprint 3 — A village that becomes a town

- New buildings, each unlocked by conditions and each with a visible function: **fishing hut** (boats go out on the water, come back with fish), **mill** with a turning sail, **well**, **smokehouse**, **chapel/meeting hall** with a bell that rings at dawn, **lighthouse** on the rockiest coast that sweeps a beam at night, **bridge** across a stream if the island generates one, **market square** where islanders gather at midday.
- Roads: dirt paths appear where islanders walk most often (heat-map → path tiles), then get cobbled once the village is big enough.
- The village **names itself** on day 10 from a generated name table and the log starts using it.
- Boats: arrivals now visibly row in from the horizon; a trading boat comes once per season and the islanders wave from the shore.

## Sprint 4 — Wildlife and the wider world

- Deer in the forest that flee from woodcutters, gulls that circle the shore, rabbits, a fox at night, fish shadows under the water, fireflies in summer twilight, migrating geese as a V across the sky in autumn, an occasional whale spout far out.
- A distant second island on the horizon that is only ever a silhouette. Once per game, one islander sails to it and does or doesn't come back.
- Ruins: some islands generate a broken stone circle or old wall; islanders build near it and the log invents a legend about it.

## Sprint 5 — The watcher (that's the player)

- The player is a **quiet spirit of the island**, never named as such. Interactions should feel like small blessings, not commands:
  - Click grass: sapling. Long-press grass: a spring/small pond forms.
  - Click water: skipped stone. Drag on water: a gust that pushes boats.
  - Click an islander at night: they dream (a one-line dream in the log; dreams sometimes come true — a lost tool is found, a rival becomes a friend).
  - Click the campfire: everyone comes to it and a story is told (a multi-line log entry composed from the village's own history).
  - Click a cloud: it rains there.
- A tiny "**Chronicle**" panel: a scrollable history of the island by year, generated from real events, readable like a saga. Export as a `.txt`.
- **Save/load**: the whole world serializes to a compact string in the URL hash, so a specific island and its people can be shared as a link and reopened later exactly as left.
- Time controls: pause, 1×, 3×, 10×, and "**skip to morning**".

## Sprint 6 — Sound as place

- Expand the synthesized soundscape (still no audio files): waves whose volume follows distance from the shore under the cursor, wind that rises with weather, an axe *thock* per chop, hammering during builds, the mill creak, the chapel bell, thunder with distance delay, gentle procedural music that shifts key by season and drops out at night, a lullaby if you click a sleeping child.
- Everything ducks under rain. Respect `prefers-reduced-motion` and remember the sound toggle.

## Quality bar (every sprint)

- 60 fps on a mid-range phone at the current world size; batch draws, cache static layers, don't allocate in the loop.
- Pixel art must stay coherent: one palette, one light direction, one outline rule.
- Copy in the log is warm, specific, and never repeats within a day. No exclamation points.
- No dependencies, no build step, no external fonts or images. One file. Under ~250 KB.
- Keyboard-reachable controls, visible focus, sensible on portrait phones (HUD collapses to icons).

## Deliverable per sprint

The full updated `hearth.html`, plus a 5-line changelog and one sentence on what you'd cut if it were too big. Start with Sprint 1 now.
