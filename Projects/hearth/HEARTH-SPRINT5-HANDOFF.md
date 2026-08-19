# Hearth v2 — Sprint 5 handoff ("The watcher — that's the player")

Deliverable: `hearth.html` (single file, ~150 KB, zero deps, runs from `file://`). Sprint 5 is complete and runnable on top of Sprints 1–4. This is what you need to start Sprint 6 (sound as place) without re-reading everything. First sprint done in Claude Code rather than chat; it lives here now.

## Changelog (5 lines)

1. **Blessings.** Click grass: a sapling (as before). Hold grass ~520 ms: **a spring comes up** — a real pond is cut into the tiles, the terrain repaints, a `spot` called "the spring" is added, sometimes fish move into it. Click water: **a stone skips**, two to five hops with expanding rings and a quieter plink each bounce. Drag on water: **a gust** that shoves boats (and nudges gulls and scatters fish) along the drag. Click an islander at night: **they dream**, and about half of those dreams are pending consequences that resolve at daybreak. Click the fire: **a story**, one multi-line log entry composed from the island's own chronicle, with everyone walking in to hear it.
2. **Clouds, and rain on request.** A drifting cloud layer (pre-rendered sprites, count and speed by weather, wind direction fixed per island) casts soft shadows over the island. Click a shadow and **that one cloud rains, there** — local streaks, splash `fx`, fields under it grow at roughly twice rain speed for 16–26 s, then the cloud is spent for 60 s. This is also just good weather art: clear days now have two clouds crossing them.
3. **The Chronicle.** `addEvent(kind,label,story)` gained a third argument — a full sentence — and every event site now writes one. Those go to an uncapped `chron[]` (the 40-cap `events[]` is untouched, it still feeds the `{ev}` grammar slot). The panel groups by year, scrolls, and exports a `.txt` saga. The campfire story is composed from the same source, biased away from arrivals and trade so it retells the big things.
4. **Save/load in the address bar.** `pack()` → JSON → LZW with variable-width 9–16 bit codes → URL-safe base64, all in about 20 lines. Terrain regenerates from the seed, so the hash only carries what changed: people (history, relationships, pending dreams and all), houses, farms, trees, stumps, buildings, graves, springs, roads (RLE), the chronicle, the voyage, the clock and the weather. A day-20 island is ~5 KB of hash; a day-50 one ~7–10 KB. Paste the link, get the island back exactly.
5. **Time controls.** Pause / 1× / 3× / 10× as a segmented group, plus **morning** (which really simulates the night at speed rather than skipping it, so the fox still comes and the dreams still land). Keyboard: space, 1, 3, 0, `m`, `c`. Ten new grammar templates for springs, one-cloud rain, the story night and the morning after a dream.

**What I'd cut if it were too big:** the cloud layer (~35 lines of draw and step). The spring, the story and the dreams carry "you are a quiet spirit here"; clouds are the one blessing that is mostly weather.

## What I did, in order

- New state: `springs[] {x,y,r,ph}`, `clouds[] {x,y,s,i,r,rt,ph}`, `cloudSp[]` (three pre-rendered shadow canvases), `gusts[]`, `skips[]`, `chron[]`, `wind` (±1, per island), `paused`, `storyDay`, `dreamAny`. All reset in `newWorld`, which now also calls `mkCloudSprites()` and seeds two clouds.
- The whole Sprint 5 block sits between the wildlife section and the weather section: clouds, `makeSpring`, `skipStone`, `gustAt`, `DREAMS`/`dreamOf`/`wakeDreams`, `tellStory`. `stepClouds/stepSkips/stepGusts` run alongside `stepWild` in `step()`; `wakeDreams()` is the first thing `newDay()` does.
- Pointer handling was rewritten around a `press` object: down records the tile and starts a 520 ms long-press timer on grass, move cancels it past 1.1 tiles, up resolves in priority order — gust (started on water, dragged > 2.2 tiles) → islander (and a dream if it's night) → the fire (within 2.3 tiles of `center`) → a cloud's shadow → sapling → skipped stone.
- Dreams that come true: `mend` (a rival relation flips to friend both ways and gets a chronicle line), `tool` (+6 wood), `settle` (the `homesick` trait is replaced), `visit` (sets `p.mourn`, reusing the existing grave-visit task), `far` (weights them heavily in the voyage draw), `fish` (their next catch is `n*3+3`), `grow` (a half-grown tree appears). The rest are pure flavour.
- `gather` is a new task: it walks to the fire, dwells 24–44 s, and is exempt from the nightfall override so a story told at midnight actually happens.
- Render order gained: springs (ripples, right after the water sparkle) → … → `fx` (now draws expanding rings when `f.rg`) → skipped stones → **cloud shadows and their local rain** → gulls → the rest as before.

## Tuning numbers that matter

- Clouds: count `{clear:2,overcast:6,rain:7,thunder:8,snow:5,fog:0}`, drift `.32–1.5` tiles/s × wind, sprite 112×64 px scaled `.65–1.5`, shadow alpha `.75×light` (`1.15×` while raining), clickable core is 34%/32% of the sprite. Rain 16–26 s, then 60 s spent.
- Spring: radius 1.3–2.1 tiles, needs 4+ free grass tiles, refuses within 3.5 of the hearth or near houses, buildings and graves. Long press 520 ms, cancelled by 1.1 tiles of drift.
- Gust: impulse 3.2 tiles/s on boats within 9 tiles, decaying `.12^dt`, and only applied if the next position is still water.
- Dreams: one per person per night; 50% leave a pending consequence; all of them resolve (or quietly don't) at daybreak.
- Story: at most one a day; 5 events spread evenly across the chronicle, preferring anything that isn't an arrival or a trade.
- Save: LZW ratio ≈ .55 of raw JSON. Day 20 ≈ 5 KB, day 50 ≈ 7–10 KB of hash.
- Observed (live in Chromium, ~10 islands): 70-day runs with no errors; `step` ≈ .039 ms, `draw` ≈ 1.1–1.3 ms at 880×560. Six seeds run to day 41 all reached pop 20–23, 11–14 houses, 5–8 buildings.

## Issues / complications I hit

- **The compressor was silently wrong.** The encoder seeded single characters into the LZW dictionary that the decoder never adds, so every dictionary index past 256 was off by one and the round trip threw `URI malformed`. Fixed by only adding `wc` when `w` is non-empty. Then fixed-width 16-bit codes turned out to make the payload *bigger* than the raw JSON; variable-width 9→16 bit codes cut it to 55%. The decoder widens on `n+1===(1<<bits)` — one entry earlier than the encoder — because at the moment it reads a code it is always one dictionary entry behind.
- **Cloud clicks versus grass clicks.** Cloud shadows cover a lot of ground, so they take priority over planting. That's deliberate (there are only 2 clouds on a clear day and a spent cloud stops responding for a minute), but it's the one interaction that could annoy someone who just wants a tree.
- **Rendering proof.** The cloud shadow is subtle enough that a screenshot at half scale doesn't prove it, so I verified it by sampling the canvas: under a cloud RGB (59,90,50) versus (90,138,59) in the open, and 4437 of 7168 pixels change when the rain layer is toggled on.
- **A hard-luck island.** One page load produced a village that never got going: storms most days early on, three people gone by day 8, no farms, wood untouched at its starting 12. It's not new — storms send everyone indoors, and hunger drives people off, and with `food` low no arrivals ever come. It recovered on its own by day 51, but the first 40 days of a storm-heavy island can look broken. Worth a balance pass some sprint: maybe let people work through light rain, or give the granary a floor.
- **What is still unverified live**: a real long press on a touchscreen (I drove synthetic pointer events), and the `.txt` download from `file://` (it runs without error; the preview sandbox blocks the actual save).

## Victories

- The story at the fire is the best thing in the game now. Everyone walks in, and you get seven lines that are specifically *your* island's: the four who landed, the naming, a storm, a death, whoever rowed for the far island. It reads like something remembered rather than something logged.
- Springs change the map permanently and the islanders notice: they drink from it, argue about whether it was always there, and a child floats a leaf on it.
- Dreams are the only blessing that changes people rather than the world, and "made it up with X, and could not say why" landing in two people's histories the next morning is quietly the strongest thing in the sprint.
- The link genuinely works. Save a day-50 island, wipe it, paste the link, and you get the same 15 people with the same histories, houses, graves and half-built lighthouse.

## Sprint 6 pointers (things already wired for you)

- Audio hooks that exist and are already gated on `audioOn`: `bell(n)` (already muffled by storm/rain/fog), `chirp()`, `plink(v)` (now takes a volume — the skipped stone uses .15 then ~.05 a hop), `thunder(d)` with distance delay, and the `windG`/`rainG`/`crickG` gain nodes in `audioTick`.
- Places that want a sound and don't have one yet: `case 'chop'` (the axe, every `p.work>4`), `build` progress (hammering), the mill (its `wind`-driven rotation speed is already computed in the draw), `makeSpring`, `gustAt`, `rainOn` (rain that is only in one place — pan it), and `tellStory` (a hush).
- "Waves whose volume follows distance from the shore under the cursor" needs a pointermove hook; `press`/`toWorld` already exist, and `nearestShore(x,y)` is there.
- `prefers-reduced-motion` is currently honoured only in CSS for the log animation. If sound gets a persistent toggle, `localStorage` is untouched so far — nothing else in the file uses it.
- Quality-bar leftovers still open: sheltering islanders vanish entirely (a lit window during a storm would fix the feeling); the beached-boat pixel at the hut is crude; deer don't avoid water when fleeing across a narrow neck; a lone surviving child has no behaviour but `play`.
- `__hearth` now also exposes `chron, springs, clouds, skips, seed`, and `tellStory, dreamOf, wakeDreams, makeSpring, skipStone, gustAt, rainOn, cloudAt, addCloud, skipToMorning, pack, unpack, lzEnc, lzDec, saveHash, loadHash, renderChron, exportChron, showChron`. Driving the real input path in a test means dispatching `PointerEvent`s at `#c` — that works, including the long press.
