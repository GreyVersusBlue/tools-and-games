# Hearth v2 — Sprint 13 handoff ("Where the stories stand")

Deliverable: `Projects/hearth/` (`index.html` + `css/` + `js/`, ~234 KB total, zero deps, runs from `file://`; `hearth.html` is still the redirect stub for old links). Sprint 13 closes the three quality-bar leftovers sprint 12 named — and the big one first: **grown stories now influence behavior**. The lore stopped being only narrative: a story that has grown at the fire puts a name on the ground, someone walks out to stand in it, and the named place joins the island's geography for good. Save format goes to **v:9** (v:5–v:8 links still load; the new field reads as empty).

## Changelog (5 lines)

1. **The ground under the stories.** Six of the big story kinds now know where they happened (`LORE_PLACE`): the landing, the coming back, the day the rain broke, the great shoal, the one who stayed on the far island, the finding in the old stones. The morning after a fire night, if a grown story has a place that has never been walked, someone — a child first, then the dreamy, then whoever is youngest — is up and out at first light to stand in it with both feet, and by evening the ground has the name the fire gave it: *where the boat first came in*, *where they stood in the rain*, *the shore that faces the far island*. The naming is chronicled (`place` — and place stories can themselves grow in the telling), the walker's history records it, and the named place becomes a favorite-spot candidate, so a child born years later can grow up loving *where the fish came in* without knowing they were told to.
2. **The walk keeps happening.** Named ground stays warm: after later fire nights someone sometimes walks a named place again (a `pilgrim` task with its own card text and log line — "matching the ground to the telling, and the ground holds still for it"), and four new flavor templates keep the places in daily circulation (the long way round that nobody decides to take; the elder who was there when the ground stopped being ordinary).
3. **Every island makes its own things.** The made-thing table is per-seed now (from the seed alone, no rnd() — old links keep their exact streams): three variants per craft, so one island's mastery leaves *the whalebone knife* and another's *the driftwood knife*, *the cradle*, *the honest cup*. Seed 7 happens to land on all five sprint-12 classics, which feels less like a coincidence than it is.
4. **The shelf has art.** When something waits in the hall (`things` with no holder), a plank now shows between the hall's windows with up to three small somethings on it — bone-white, gold, and glass-blue — and it empties again when a returner takes theirs back.
5. **Save v:9** packs only the list of named kinds (`lp`); the spots re-derive from the rebuilt world at load, so no coordinates are stored. Both version gates were bumped this time (the sprint-12 handoff's warning about the two `o.v>=5` gates was taken literally, and grep confirms there are exactly two).

**What I'd cut if it were too big:** the repeat walks and the flavor templates (the naming carries the feature); never the first walk at first light.

## Numbers, measured

- **Determinism:** seeds 7 and 20260819, 30 days, two fresh runs each — identical `pack()` hashes (`b14d17f0` / `134cf91b`), re-verified after every change.
- **Soak:** 5 islands (3 fixed, 2 random) × 40 days, ~22,465 full-cast audits — **0 violations, 0 breadcrumbs.**
- **Save:** autosave round-trip through a real reload PASS; a forged v8 save (no `lp` key) loads clean with no lore and no error; the sprint-11/12 v6/v7 forgeries still load.
- **Sprint-13 systems (`node harness.mjs thirteen`):** the landing story grows after 4 forced fire nights and the ground is named the next morning, chronicled, with the walk in the walker's history; the named place survives pack/unpack (v9 carries `lp:[landing]`, the spot re-derives); the hall shelf draws with a thing waiting on it; made things are stable within a seed and differ across seeds (7 vs 20260819 differ on three of five crafts).
- **Depth, 120 days × 2 seeds:** pop 39 / 49, store bounded 396–523, ways 2 each, 2–3 things in circulation, 1–2 stories grown — and **both islands, unforced, had named *where the boat first came in* by day 121.** (The landing is retold at every fire, so the landing beach is always the first ground to take a name; the rest arrive on decade-old islands, like the heirlooms do.) The depth pair's actual made things (jar, knife) happened to land on the same variants on both seeds — the 1-in-3 coincidence the thirteen-mode test is immune to, since it compares the whole table (three of five crafts differ).
- **Audio untouched:** no sound added, no gain moved — but the listening pass was re-run anyway (it is one command): all thirteen one-shots still in 0.07–0.19, sfx bus 0.72 in storm vs 0.95 clear, storm bed 0.19.
- Files: **239,847 bytes (~234 KB)** of the ~250 KB budget (+6.7 KB this sprint).

## Decisions made without asking

- **The name comes from the walk, not the growth.** A story can grow at the fire and the ground stays ordinary until somebody actually stands in it the next morning. Stories are told at night; places are made in daylight, on foot. (It also means the naming is guaranteed to have a person attached, for the chronicle.)
- **Children first.** The walker order is child (five or older) → dreamy adult → youngest adult, elders never drafted for a first naming. This is the sprint-12 leftover verbatim: *a child who demands the long version* now walks to the landing beach.
- **Places pack as kinds, not coordinates.** `lp:['landing']` plus a re-run of `LORE_PLACE.at()` against the rebuilt world beats storing positions that worldgen already knows. If a future sprint moves `landings[0]`, old saves will quietly move the name with it, which is what a story would do anyway.
- **`walkP` (the queued morning errand) is deliberately not saved** — a reload across midnight loses one walk, the same way it already loses everyone's in-progress tasks. The naming retries at the next fire night.
- **Seed 7 keeps the classic names.** The per-seed pick is `(seed>>>(ci*2+1))%3`, and small seeds land on variant 0 — the sprint-12 originals — for all five crafts. Left that way on purpose: the reference island stays the reference island.

## Issues / complications I hit

- **Midnight is not morning.** `newDay()` fires when the clock crosses midnight, so launching the walk from there would have sent a child out in the dark and had the night-check march them straight home. The fix is the voyage pattern: `newDay` only queues `walkP`, and `step()` launches it once `dayFrac()` clears dawn (and not into a storm).
- **The `place` chronicle entries feed back into the fire.** They have full `st` text, so they enter the story rotation and can grow (`GROW.place` exists) — which means a naming can eventually be retold as having always been named. That is a feature, and it is also why the harness asserts on `kind==='place'` counts rather than on story text.
- **Spots are rebuilt from scratch at load,** so lore spots had to be re-derived in `unpack` (after farms/buildings restore, since `at()` reads them). Forgetting the order would have put *where they stood in the rain* at the hearth on every load; the round-trip test in `thirteen` mode is there to catch exactly that regression.
- The person-card `whyText` needed a `pilgrim` case or the walker would have claimed to be "between tasks" while marching across the island with intent.

## Quality-bar leftovers, for sprint 14

- **Only six story kinds have ground.** `fever`, `hardwinter`, `way`, and `heir` grow in the telling but have nowhere to stand — some genuinely have no place (a fever happens everywhere), but *the year the sail came* could plausibly name the water off the landing.
- **Named places have no art.** They exist in spot labels, walks, and the chronicle, but the ground itself draws nothing — a worn patch, a small cairn after enough walks, would be the same trick as the shelf.
- The rich-island cap overshoot (pop 49 via births) is still pre-existing and still mild; the `popCap()+1` allowance in the birth rule remains the number if it ever grates.
- The repeat-walk rate (25% per fire night, one walker) is a guess that read well in the log; if the walks feel too rare on old islands, that constant is in `newDay`.
- The listening pass stays one command (`node harness.mjs twelve`) — **run it whenever a sound is added or a gain touched.** Nothing was touched this sprint; it was run anyway and the table still reads clean.

## Where the thing stands

Sprints 1–13 in, ~234 KB of ~250 KB, zero dependencies, save v:9 (v:5–v:8 accepted), harness green across soak / determinism / save / depth / eleven / twelve / thirteen. The island now keeps places as well as people and things: the story grows at the fire, a child walks out at first light to stand where it happens, and the ground has a name by evening — and years later somebody who wasn't born yet loves *where the boat first came in* best of anywhere on the island.
