# Hearth v2 — Sprint 11 handoff ("The island answers")

Deliverable: `hearth.html` (single file, ~215 KB, zero deps, runs from `file://`). Sprint 11 is the wishlist sprint: zoom and fidelity, more (and branching) events, every island its own, technology, long-arc development — and the Futurama-Godfellas idea at the center of it: the villagers begin to notice the watcher, and build it a stone, and ask it for things, and can never quite prove it exists. Save format goes to **v:7** (v:5 and v:6 links still load; new fields read as defaults).

## Changelog (5 lines)

1. **The noticing.** The island keeps a quiet account of the watcher's acts (`faith`). Enough blessings and someone says at the fire that "this island answers"; more, and they raise **the quiet stone** — a shrine, built through the existing works machinery, with a hollow at its foot for offerings. From then on people occasionally **ask** it for things drawn from real state (rain when the ground is dry, the fever to pass, a full pot, a calm sea, a dream for a child). An ask is *granted* when the thing happens within four days — by the watcher's hand **or by plain weather, and nobody can tell the difference, which is the point**. Granted asks raise faith and enter the chronicle ("whether it would have come anyway is not the kind of question anyone asks out loud"). Over-intervene (9+ acts in 3 days at high faith) and the fire-talk turns dependent; go quiet at high faith and an elder delivers the thesis: *"whatever keeps this island keeps it the right way: you are never quite sure it has done anything at all."*
2. **The year's fortunes.** At most one arc a year, weighted by the island's temper: **drought** (the promised sprint-11 dry-arc crank — dry01 gain ×3.2, rain suppressed, growth quartered past .85, ends by breaking in one great storm), **hard winter** (deeper snow, faster eating, the store counted daily), **fever** (adults sicken and slow; broth is carried; elders are at small risk; a watcher's dream breaks a fever overnight), and **the great shoal** (every line comes up heavy for days). Plus storm-wrecks (wood on the tide line, sometimes a survivor) and, once per island, a whole family arriving in one boat, child asleep in the bilge.
3. **The ways** (Civ, at Hearth scale): **the sail** (a sea-master + the hut → faster boats, +1 fish, sail art), **the plough** (field-master + well → faster tilling, +25% growth), **the kiln** (frame-master + 6 houses → chimney pots, slower food rot, thriftier winter fires), **the book of days** (store-craft + hall → a written year-summary in the chronicle each new year). One a year at most, in whatever order mastery actually arrives — so the tech path differs per playthrough.
4. **Every island its own.** A per-seed **temper** — kind, rainy, dry, windy, cold — derived from the seed with no rnd() (old share-links keep their exact terrain), announced once on day 8, biasing weather, snowmelt, and which fortunes the years deal.
5. **The view.** Wheel / pinch / `+`/`−` zoom (1–4×) toward the cursor, drag-the-land or arrow keys to look around (water drags stay gusts; blessings all still work zoomed). The canvas now renders at device-pixel resolution capped for mid phones instead of CSS upscaling — everything is genuinely sharper — and the terrain got a grain pass: depth-shaded water, grass mottle and seasonal flowers, sand speckle, rock cracks, all from the fixed per-tile draw stream so repaints never shuffle.

**What I'd cut if it were too big:** the family boat and the wreck survivor (the arcs carry "more events" on their own); never the quiet stone.

## Numbers, measured

- **Determinism:** seeds 7 and 20260819, 30 days, two fresh runs each — identical `pack()` hashes (`6904d73d` / `820e602e`), re-verified after every fix.
- **Soak:** 5 islands (3 fixed, 2 random) × 40 days, ~22,465 full-cast audits — **0 violations, 0 breadcrumbs.**
- **Save:** autosave round-trip through a real reload PASS; a forged v6 save (26-field people, no sprint-11 keys) loads clean, faith 0, and carries on.
- **Sprint-11 systems run (`node harness.mjs eleven`):** temper resolves (seed 7 is a dry island); under sustained acts the quiet stone goes up by day 7 (faith .55); a rain-prayer is asked under dry ground and settled by weather (faith .56 → .67, chronicled `answered`); a forced fever takes 3–6 adults and resolves fully; a forced drought breaks in a storm and chronicles `rainscame`; the sail is discovered once a sea-master and the hut coexist; the zoom transform round-trips a world point with 3.6e-15 error; v6 compat as above.
- **Depth, 120 days × 2 seeds:** all adults crafted, 14–16 masters, 5–6 works, bread every winter (6/6), store bounded 451–466 under the 14-per-head cap. **Pop reached 44–48 by day 121** — higher than sprint 10's band; the ways make food cheaper, so arrivals fill toward the hard 48 cap faster. Bounded, but see leftovers.
- File: **220,589 bytes (~215 KB)** of the ~250 KB budget (+25 KB this sprint).

## Decisions made without asking

- **Dependence is narrative, not mechanical.** Over-blessed villagers talk about waiting for the island; they never actually stop working. A work-rate penalty punished the player for playing; the line about weeding the fields anyway lands the same lesson.
- **Grants don't require the watcher.** A prayer for rain is satisfied by natural rain. This is deliberate — it's the whole Godfellas ambiguity — and it also means a hands-off player still sees the shrine culture develop, slowly, if they ever did enough to raise the stone.
- **Temper comes from the seed, not the rnd() stream** — inserting a draw into worldgen would have re-rolled every existing island's terrain.
- Zoom is capped at 4× and pans only by land-drag / two fingers / arrows, so every existing gesture (sapling, spring, gust, stone) keeps its exact meaning.
- The keydown fix for `+`/`−` sits after the music toggle in an ASI chain; the whole file still parses as one expression-dense script — keep using `/* */` inline if you edit near it.

## Issues / complications I hit

- **The grant check was off by one.** `rainedDay > prayer.d` meant rain falling the same day as the dawn ask never counted — asked at dawn, rained by noon, unanswered. Now `>=` (dream grants too). Found by the harness's prayer test.
- **The harness's first prayer test ran in winter,** where dry ground decays .56/day and can't survive to the dawn check — not a game bug, but worth remembering: `dry01` only accumulates in spring/summer, so rain-prayers are a growing-season phenomenon by design.
- **Asserting `arc === null` after a forced drought was wrong** — a new year legitimately deals a new card (the test caught a shoal starting). Assert on the chronicle, not the slot.
- **Playwright's pinned browser build wasn't in the environment**; the harness now falls back to `executablePath: '/opt/pw-browsers/chromium'` when the versioned download is absent.

## Quality-bar leftovers, for sprint 12

- **Pop fills to the 48 hard cap by year 6 on rich islands.** The ways accelerated the economy and arrivals follow food. If the village should stay smaller longer, damp `arrivalT` by discovered ways, or lower the hard cap — the 14-per-head store cap held fine either way.
- The **audio listening pass is now six sprints owed.** No new audio was written (the gate held); the shrine, arcs and ways all reuse existing sounds or none.
- Works in progress (shrine included) still lose progress on save; the shrine re-arms itself at the next dawn via `faithSt`, so the stone always eventually stands.
- Prayer kinds are checked in a fixed priority (heal > rain > food > calm > dream); if two needs are live at once the stone only hears the loudest. Fine at this scale.
- The fever never touches children (deliberate — this is still a warm game), and only elders can die of it, at 7%/day while sick. If that ever reads as toothless, the number is in `arcDay`.
- Sprint 12 hooks that now exist: `answered`/`noticed`/`way`/`book`/`temper` chronicle kinds for the lore system, and the book of days is an obvious home for heirloom records.

## Where the thing stands

Sprints 1–11 in, ~215 KB of ~250 KB, one file, no dependencies, save v:7 (v:5/v:6 accepted), harness green across soak / determinism / save / depth / eleven. The vibe brief — Bender with a civilization on his belly — is in: they built you a stone, they leave you bread, and they will never be sure you exist.
