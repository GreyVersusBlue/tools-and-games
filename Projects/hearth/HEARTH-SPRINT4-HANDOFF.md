# Hearth v2 — Sprint 4 handoff ("Wildlife and the wider world")

Deliverable: `hearth.html` (single file, ~118 KB, zero deps, runs from `file://`). Sprint 4 is complete and runnable on top of Sprints 1–3. This doc is what you need to start Sprint 5 (the watcher: blessings, chronicle, save/load, time controls) without re-reading everything.

## Changelog (5 lines)

1. **Wildlife**: deer (1–5, homed to forest trees, graze/move, flee at 8 tiles from anyone within 3.2 or a woodcutter within 5.5, lie down at night, fewer in winter), rabbits (up to 5, homed near fields, hop/sit, flee from people and the fox, hide and reappear, relocate after being scared 3× so they don't live in permanent hiding, white in snow), a fox (comes down out of the trees at night in any season but winter, trots avoiding houses, chases rabbits within 5 tiles and sometimes gets one, leaves at dawn), gulls (3–7 circling drifting centres on the shore/hut, follow the fishing boat, thin out in fog/storm/night), fish shadows (9 schools in the shallows plus two in a stream, drift, scatter from a fisher's feet, hidden under ice), fireflies (summer dusk over the grass, drawn `lighter`, fade out at full night), geese (autumn only, once a day at dawn or dusk, a V of 7–11 crossing the whole sky), and a whale (deep water only, every 140–420 s of daylight outside winter: back rolls up and down, a spout of `fx` for two seconds, sometimes a fluke).
2. **The far island**: a silhouette on the top edge over open water, sited away from the hearth; hazy blue by day, dark at dusk/night, gone in fog. Once per game (day ≥16, pop ≥8, 9%/day) one restless/brave/homesick islander with no partner or children announces at breakfast that they are going, walks to the landing, rows out (five people go down and watch), and is removed from `people`. Brave ones come back 75% of the time (2–4 days later, with one of four things found); homesick 30%; otherwise ~50%. If they stay, a line lands on day 4, friends get a history entry, and a **single flickering light appears on the far island at night** for the rest of the game.
3. **Ruins**: 55% of islands get a broken stone circle (7–9 stones, radius ~2.6) or an old wall (8–11 stones, straight, some fallen) on grass 9–26 tiles out. `freeSpot` keeps a 3.6-tile margin; on day 2 an islander names it (`the ring the giants left`, `the wall the sea people built`, …) and the legend goes into `events` so the `{ev}` grammar slot retells it; after that 40% of house plots try `freeSpotNear(ruin,…)` first, and the first such house logs "in the lee of the old stones". Ruin is a favourite spot.
4. ~38 new grammar templates (deer/gulls/rabbits/fox/fireflies/geese/whale/fish/far island/away/stayed/ruin) with new ctx flags and a `{voy}` slot; whyText for the voyager; bespoke event lines for the fox, deer bolting from the axe, geese, whale.
5. Quality-bar leftovers: bell muffled in storm (×.3), rain (×.6), fog (×.75); snow caps on graves, hut, well, mill roof and the ruin stones.

**What I'd cut if it were too big:** the fox and its rabbit-hunting (~14 lines) — the rabbits still flee from people and the fireflies/geese/whale carry the "world is alive" feeling on their own.

## What I did, in order

- New state: `wild[]` (`{k:'deer'|'rabbit'|'fox',x,y,tx,ty,st,t,chk,home,f}`), `gulls[]`, `fishSh[]`, `flies[]`, `geese` (one object or null), `geeseDay`, `whale`, `whaleT`, `whaleDay`, `deep[]` (open-water tiles ≥6 from any land, for the whale), `farIsle {x,w,h,lit}`, `voyage {name,st,p,day,back,n}`, `ruin {kind,x,y,st[],legend,built}`, `ruinSeen`. All reset in `newWorld`.
- World gen order: stream → shore → hill → **ruin** (before spots, so it becomes a spot) → **farIsle + deep** → landings → lighthouse → people → `spawnWildlife()` after the first log line.
- `stepWild(dt)` runs right after `stepBoats(dt)`; it holds all animal state machines and the gulls/fish/fireflies/geese/whale timers. Animals check threats on a 0.3 s `chk` timer, not per frame.
- Voyage is a four-state machine: `decided` (newDay picks) → `going` (step, at morning, `task:'voyage'` walk to `landings[0]`) → `away` (`spawnBoat('away',…)`, person removed from `people` on boat exit; `boatArrive` handles `away`/`return`) → `back` or `stayed` (newDay). The person object survives in `voyage.p`, so their history and relationships persist and `byName` shows them as "(gone)" meanwhile.
- People loop: `boat` still `continue`s; `voyage` skips the storm/night overrides but runs its own `case`; trader wave selection excludes both.
- Render order: terrain → tide → sparkle → **fish shadows** → farms/stumps → `ents` (adds ruin stones, wild, whale) → `fx` → **gulls, geese** → rain/snow → sky tints/fog → **far island** → dark overlay → glows (**far-island light**) → **fireflies** (lighter) → lighthouse → stars.

## Tuning numbers that matter

- Deer flee speed 7 tiles/s, walk 1.3 (0.6 at night); rabbits hop 2.2, flee 6; fox trot 2.4, chase 5.5, catch radius .4; fox spawn `.02/s` at night; deer/rabbit respawn `.008/.012 /s`.
- Gull target counts: storm 1, fog 2, night 2, day 5, fish boat out 7. Fireflies cap 36, spawn 20/s in the window, decay ×6 once the window closes.
- Geese window: dawn `e0+.02..+.10` or dusk `e1-.12..-.02`, chance `.08/s` — reliably once a day in autumn unless it's raining/foggy/storming.
- Whale: `whaleT` 140–420 s, needs deep water, day, no fog/storm/ice, not winter; visible 5–8 s; log line 40%.
- Voyage: trigger day ≥16, pop ≥8, `.09/day`; return odds brave .75 / homesick .30 / restless .45 / else .55; away 2–4 days; "stayed" declared on day 4.
- Observed (headless, 8 seeds, 60–200 days): every seed voyaged between day 21 and 60 (both outcomes seen), geese every autumn, whale ~1–2% of daylight frames, fox present ~12% of frames, no errors. `draw()` ≈ 4 ms in headless Chromium at 880×560 (was ~3.7 in Sprint 3); `step` ≈ .02 ms.

## Issues / complications I hit

- **The voyager never left.** First cut `continue`d the people loop for `task==='voyage'` alongside `boat`, so its `case` never ran. Fixed by only skipping the storm/night overrides.
- **Rabbits lived in hiding.** Homes near fields put them under people's feet forever (flee → hide → reappear → flee). Fixed with the scare counter and relocation to a 9–24 ring.
- **Ruin lines before the ruin was "found."** Templates and near-ruin houses fired on day 1; both now gate on `ruinSeen`.
- **The far island read as a smudge.** Made it taller and higher-contrast; it's still deliberately subtle at noon.
- **Harness log capture**: `MutationObserver` doesn't fire inside a synchronous step loop — poll `#log` children instead (`harness.py`).
- **No real browser here.** Unverified live: firefly flicker cadence, gull wing flap, whale spout against a real frame rate, the muffled bell. First thing in Sprint 5: open it, wait for a summer dusk, and watch the fireflies come up over the grass.

## Victories

- The fox is a tiny story: it comes at dark, the rabbits vanish, one scream in the log, and it's gone by dawn.
- The voyage sequence produces the best log run in the game so far: "not up for discussion" → five islanders on the shore → three days of "both look out to the far island and neither says the name" → either the boat coming back with a stone in each pocket, or a light on the far island every clear night after.
- Ruins change the shape of a village: houses cluster in the lee of the wall, and elders argue about giants.

## Test harness (worth keeping)

`harness.py <seeds…>` (Playwright/Chromium, `DAYS=` env; steps 2800×.05 s per day, draws every 56 steps, polls the log for wildlife/world lines, reports wild/gulls/fish/ruin/farIsle/voyage/timing/errors). `vis2.py <seed>` renders summer noon/dusk/night, geese, whale, late noon/night PNGs. `__hearth` now also exposes `wild, gulls, flies, geese, whale, farIsle, voyage, ruin, fishSh, events` and setters `setWhaleT`, `setGeeseDay`.

## Sprint 5 pointers (things already wired for you)

- Blessings: the click handler is at the bottom (`pointerdown`); `plink()`, `fx`, `mkTree`, `spawnBoat` are ready. A long-press pond = set tiles to WATER at elev .19 like the stream, then `paintTerrain()`; boats have `b.tx/ty` for a gust. Dreams: `p.hist` + `flavor`-style templates; "dreams come true" can flip a `rival` rel via `relate`. Campfire story: `events[]` is the whole raw material — compose from `events` in order with `V()`, and use `say(…,true)` for multi-line.
- Chronicle: `events` is capped at 40 — lift the cap or keep a second uncapped `chron[]` pushed from `addEvent`, grouped by `y`. Everything user-visible already goes through `say`, so a `.txt` export can just be the accumulated log if you keep a string buffer there.
- Save/load: state to serialize is listed at the top of the script (`let tiles,…`, sprint 2/3/4 `let` lines) plus `seed`; terrain regenerates from `seed`, so store people/houses/farms/bldg/road/graves/events/voyage/ruin.built/farIsle.lit and the clock. `wild`/`gulls`/`flies` can just be respawned via `spawnWildlife()`.
- Time controls: `speed` and `time` are already the knobs; "skip to morning" = `setTime((day+edges()[0]+.03)*dayLen)` and let `newDay` fire naturally.
- Quality bar leftovers still open: sheltering islanders vanish; the beached-boat pixel at the hut is crude; deer don't avoid the water when fleeing across a narrow neck (they retarget six times, then go anyway).
