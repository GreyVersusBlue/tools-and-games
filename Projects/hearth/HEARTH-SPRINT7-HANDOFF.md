# Hearth v2 — Sprint 7 handoff ("The quality pass")

Deliverable: `hearth.html` (single file, ~162 KB, zero deps, runs from `file://`). Sprint 7 is complete and runnable on top of Sprints 1–6. There was no Sprint 7 in the original prompt; this one is built entirely from the "quality-bar leftovers" list at the end of the Sprint 6 handoff, and it closes that list.

## Changelog (5 lines)

1. **The village is home during a storm.** Sheltering islanders used to vanish and the island looked abandoned in its most dramatic weather. Now any house someone is waiting out the storm in shows a lit window (the same warm `#f5c463` the windows use at night), and its chimney leaks smoke that the wind tears sideways. Nothing new moves; the place just visibly holds its people.
2. **Deer stop at the water.** A fleeing deer used to sprint dead straight across a narrow neck of sea. Movement now checks the ground each frame: blocked diagonals slide along the shore, and a deer with nowhere left to run stands at the water's edge, which is what deer do. The beached boat at the fishing hut also stopped being two smeared rectangles: it is a proper little hull now — light gunwale, dark keel, an oar leaning against it — drawn on whichever side faces away from the village.
3. **A lone child keeps the fire.** A village that collapsed to one child used to freeze forever, the child playing beside a dead hearth. Now a child with nobody grown left walks the tideline for food and carries it back to the fire, gets a history line ("was left to keep the fire alone, and kept it"), and — because the gathering keeps food above the arrivals threshold — the smoke eventually draws a boat in and the village restarts. The moment an adult steps ashore, the child goes back to being a child.
4. **The first hard year is survivable.** Two changes from the leftover list, both small: light rain no longer stops anyone fishing (only storms are gated on brave, and the "first went fishing in a storm" history line now fires only in actual storms), and once per island, if the store hits zero inside year one, the boat they came in turns out to hold one more sack (+10 food, logged, chronicled). It fires once, ever, and is saved in the share link.
5. **The music has its own switch.** A `music on/off` button beside the sound toggle (hotkey `n`), remembered in `localStorage` like the sound toggle. It only gates the music bus; waves, wind, birds and the axe are untouched.

**What I'd cut if it were too big:** the storm chimney smoke — the lit window already does the emotional work; the smoke is garnish.

## What I did, in order

- Deer movement (`stepWild`): the straight-line step now tests `landAt(nx,ny)` before applying; failing that it tries each axis alone (running along the shore), and failing both it drops to `graze` for a second or two. Endpoint checks were already there; this closes the path between them.
- Shelter visibility: `draw()` builds an `occSet` of houses with a `p.inside && p.shelterH` occupant (a Set, built once per frame, ~50 ops) and the window colour test became `L<.5 || occSet.has(h)`. The smoke is in the existing chimney-smoke block in `step()`, gated on `storm`, using `wind` for direction — it runs in the sim, so it uses `R()` and stays deterministic.
- The lone child: new task `tend`, entered from `idle` when `!people.some(q=>q!==p&&!isKid(q))`. It ping-pongs shore ↔ fire on `dwell` timers, +1 food per round trip, with a once-per-day log line and a once-ever event (flag `p.keeper`, persisted). First line of the `tend` case checks for a grown-up and bails back to `idle`, so recovery is automatic. Night and storms interrupt it the same way they interrupt everything else.
- Rain: three `rain` gates became `storm` gates (job selection, the mid-task abort in `fish`, the `fishRain` history). The rain catch bonus (4 fish) now applies to everyone, which matches the lore the card already claimed ("the fish bite better").
- The sack: checked right before the `starving` computation — `food<=0 && granary<=0 && people.length>1 && !sackUsed && dayCount<=YEAR`. New global `sackUsed`, reset in `newWorld`, saved as `sk` in the pack (no version bump: old links simply read it as false).
- Music toggle: `musOn` global, `(!night&&!storm&&musOn)` in `audioTick`'s want computation, button + pref wiring copied from the sound toggle. The click handler also ramps `musG` down immediately so the pad doesn't linger seven seconds after the click.
- Save format: person tuples grew from 22 to 23 fields (`keeper` at index 22). Old saves load fine (undefined → falsy); new saves in old code ignore the extra field.

## Numbers, measured

- 100,000 steps (37 sim days) with a deer-position assertion every 50 steps: **10,000 checks, 0 deer on water** (previous code failed this within a day or two on islands with a narrow neck).
- Window pixel during a daytime storm, through the storm's dark overlay: occupied house **(217,174,92)** (the gold, dimmed), empty house **(52,49,59)**. Same frame.
- The lone child gathered **14 food** in ~5 sim minutes — slower than any adult, which is right, but comfortably above the `food > people×2` arrivals gate for a village of one.
- Sack: fires on day 1 if you force the store to zero, exactly once, `sackUsed` true in the pack and back out of `lzDec`.
- File is **165.6 KB** of the ~250 KB budget. No new allocations in the draw loop beyond one Set per frame.

## Issues / complications I hit

- **`setWx('thunder')` is a short fuse.** Storm `wxT` is 30–50 sim-seconds, so a test that steps 40+ seconds after setting it is quietly testing rain. Two of my first storm probes "failed" this way. If you script weather tests, re-assert the weather inside the loop or keep the window under 20 s.
- **The sim/draw split still holds, and matters here.** The occupancy Set had to be built in `draw()` without touching `R()`, and the storm smoke had to be in `step()` *with* `R()`. Get those backwards and either the render changes the world or saves stop replaying identically.
- **The keeper condition is "no grown-ups", not "one person".** Two orphaned children both tend, which reads fine in the log (they take turns at the tideline). I decided that was better than electing one keeper and leaving the other inert.
- **Old share links.** `o.sk` and tuple index 22 are simply absent in pre-Sprint-7 links, so a loaded old island could in principle get a second sack if it is still in year one. Accepted: the window is tiny and the failure mode is a warm log line.
- **Still unverified by ear**: the Sprint 6 caveat stands — all audio here is graph-verified, not listened to. The music toggle at least means a listener who disagrees with the pad can now act on it.

## Victories

- Skip to a storm and the village glows from inside: five gold windows and smoke going sideways, on an island that a sprint ago looked evacuated.
- The whole lone-child arc ran unscripted in one test: adults removed, the child tended, food held, a stranger rowed in, and the child went back to playing. The log read like it was designed, and none of it was.
- A deer chased to a headland now stands at the edge looking at the water, which is more alive than anything it did while it could walk on the sea.

## Where the thing stands

The original six sprints plus the Sprint 6 leftover list are all in. The file is ~166 KB of ~250 KB, one file, no dependencies, no build step.

Quality-bar leftovers, if there is ever a Sprint 8:
- The tend loop ignores the granary; a keeper child on a snowed-in island in deep winter still walks a tideline that realistically gives nothing.
- Rabbits and the fox still path by endpoint only; they stay near grass in practice, but the deer fix could be generalised in ~3 lines each.
- The music toggle gates the bus but the lullaby rides the sfx bus by design; clicking a sleeping child with music off still hums, which I think is correct but someone may disagree.
- The `music on` button shows even when sound is off, which is honest (it remembers) but could read as a lie.
