# Hearth v2 — Sprint 14 handoff ("The walking of the bounds")

Deliverable: `Projects/hearth/` (`index.html` + `css/` + `js/`, ~240 KB total, zero deps, runs from `file://`). Sprint 14 takes sprint 13's named ground and gives it weight: the walks leave **stones** that pile into cairns you can see, two more story kinds get ground to stand on, and — the centerpiece — the island invents its own annual rite: **the walking of the bounds**, an elder leading the children round every named place, oldest story first. Save format goes to **v:10** (v:5–v:9 links still load; new fields read as empty).

## Changelog (5 lines)

1. **The walking of the bounds.** Once a year, in spring, when the island has at least two named places, an elder to lead and a child to be shown, the elder calls the children away from their games and walks the named places in order, oldest story first, putting a stone down at each. Each walker carries their own copy of the route, so the procession strings out by walking speed, which is how processions go. The first walking is chronicled (`bounds` — "It had never been done before. It was immediately old."), the story of it can grow at the fire like any other, the leader and the children get history entries, and the person card knows what a bounds-walker is doing and why.
2. **The stones pile up.** Every walk to a named place — a first naming, a morning-after repeat, a bounds stop — counts (`loreN`), and the ground shows it: worn grass at one walk, loose stones at two, a stacked pile at four, a proper little cairn at seven, with snow on top in winter. Three new flavor lines keep the piles in circulation (everyone touches the top stone in passing; a child counts them and reports the number, "which is the number of times anyone has bothered").
3. **Two more kinds of ground.** `bread` can now name **the mill path**, and `way` can name **where the new way was tried first** — the shore by the hut if the grown story is the sail's, the first field if it is the plough's. The kiln and the book of days deliberately get no ground: some stories happen everywhere, and the handoff rule that at() must stay rnd()-free and read live world state held without strain.
4. **Save v:10** adds the walk counts (`ln`, packed as kind/count pairs) and the bounds year (`by`); named-place spots now carry their kind so the counts can find them. v:9 saves load with the places named and the piles starting fresh, which reads as the island having tidied its cairns, and is accepted.
5. Depth-run behavior is organic end to end: on seed 7 the landing gets named, walked again by children on story mornings, and the counts climb without any forcing — the harness's `fourteen` mode only exists to compress years of spring into one test day.

**What I'd cut if it were too big:** the cairn's upper tiers and the flavor lines (one worn patch carries the idea); never the first walking of the bounds.

## Numbers, measured

- **Determinism:** seeds 7 and 20260819, 30 days, two fresh runs each — identical `pack()` hashes (`c79469a3` / `1ca805d0`), re-verified after every change.
- **Soak:** 5 islands (3 fixed, 2 random) × 40 days, ~22,465 full-cast audits — **0 violations, 0 breadcrumbs.**
- **Save:** autosave round-trip through a real reload PASS; a forged v9 save (no `ln`/`by`) loads clean — places named, counts empty; the v6/v7/v8 forgeries in the older modes still load.
- **Sprint-14 systems (`node harness.mjs fourteen`):** two named places after 4 fire nights (walks already counted: rainscame ×2, landing ×1); a forced bounds walk launches, chronicles, and leaves one stone at each place (counts 2/1 → 3/2), with leader and child history entries; cairns draw at every tier (1/2/4/7/12) without error; pack v10 carries `ln` and `by` and the counts survive unpack; v9 compat as above.
- **Depth, 120 days × 2 seeds:** pop 39 / 49, store bounded 405–523, all sprint-12/13 stats holding — and seed 7 named **the mill path** unforced (the bread story grew and the new ground kind caught it), alongside *where the boat first came in* on both islands. **No bounds walked by day 121**, correctly: the rite needs two named places, a living elder, and a child of five in the same spring — the same shape as sprint 10's apprenticeship note and sprint 12's heirlooms, it pays out on decade-old islands. Nothing to fix.
- **Audio untouched;** no gain moved, nothing owed to the listening pass this sprint.
- Files: **245,809 bytes (~240 KB)** of the ~250 KB budget (+6 KB this sprint). **The budget is getting close** — see leftovers.

## Decisions made without asking

- **Only the leader leaves stones.** A five-person procession that dropped five stones per place would grow a cairn in two springs; a rite should take a generation. Solo story-walks also leave one, so a much-walked place still outpaces a merely-listed one.
- **The rite needs an audience.** No children old enough to be shown (or no elder to do the showing) means no walking that year — the bounds is a transmission mechanism, not a parade. An elder whose children are all grown walks alone only in the launch line's imagination ("alone, which is not how it is supposed to go" fires only if the children list comes up empty after launch conditions were met).
- **`boundsP` and each walker's route are transient**, like `walkP` and every other in-progress task: a reload mid-procession dissolves it, and `boundsYr` (saved) stops it re-running the same spring.
- **The walk counts are capped by nothing.** A fifty-year island's landing cairn is drawn the same at 7 walks and 70; the number is still kept, because a child counting stones deserves a true answer.
- The harness discovered the rite's one timing rule the honest way (see below), and the fix went in the test, not the game.

## Issues / complications I hit

- **`runDay` ends at midnight, and a bounds launched into the night just walks home.** The first `fourteen` run launched `boundsOut()` straight after a `runDay` — chronicle and histories were written, but the night-check converted every walker to `gohome` before the first stop. The game itself only launches after dawn (`boundsP` is dawn-gated in `step()`, same as `walkP`), so the fix belonged in the harness: `skipToMorning()` first — and then **re-pause**, because `skipToMorning` unpauses the RAF loop and would have taken step-ownership away from the harness.
- **The second forced walker was in the fishing boat.** Mutating "the last adult" into a child failed silently when that adult was out past the shallows; the child-history assertion caught it. The test now mutates only people who are free by the same rules `boundsOut` uses.
- `way`'s ground depends on *which* way's story grew, and `at()` takes no arguments by design; it reads the grown `way` entry back out of the chronicle and matches on the way's name in the label. Fragile if the way lines are ever reworded — noted here so a future sprint greps for `includes('the sail')` before touching them.
- The thirteen-mode round-trip test asserted `v === 9` and failed the moment the version bumped; it now asserts `v >= 9`. Version-pinned asserts in older modes are a trap each new sprint should grep for (`rt.v !==`).

## Quality-bar leftovers, for sprint 15

- **~10 KB of budget left.** The next sprint should either be a small one, or start by paying down bytes (the flavor grammar and the handoff-adjacent comments are the compressible mass) before adding anything.
- **The bounds walks in naming order,** which is chronicle order, which is *almost* oldest-first but not route-optimal; an elder may cross the island twice. Watching it, this reads as ceremony rather than inefficiency. If it ever grates, sort stops by angle around the hearth.
- The cairn tiers (1/2/4/7) and the bounds chance (60% per eligible spring day) are felt numbers, not measured ones.
- `way` ground only exists for the sail and the plough; if the kiln or the book ever deserve ground, the label-matching in `LORE_PLACE.way.at()` is where it goes.
- The rich-island cap overshoot (pop 49 via births) is still pre-existing and still mild; `popCap()+1` in the birth rule remains the number.
- The listening pass stays one command (`node harness.mjs twelve`) — run it whenever a sound is added or a gain touched. Nothing was touched this sprint.

## Where the thing stands

Sprints 1–14 in, ~240 KB of ~250 KB, zero dependencies, save v:10 (v:5–v:9 accepted), harness green across soak / determinism / save / depth / eleven / twelve / thirteen / fourteen. The loop the last three sprints were building is closed: a thing happens, the fire grows it into a story, the story names the ground, the walks pile stones on it, and once a year an elder leads the children round the whole of it, oldest story first — so the island now teaches itself to its own children without the watcher lifting a finger, which is, of course, the point of the stone at the foot of the quiet stone.
