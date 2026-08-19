# Hearth v2 — Sprint 8 handoff ("The short list")

Deliverable: `hearth.html` (single file, ~164 KB, zero deps, runs from `file://`). Sprint 8 is complete and runnable on top of Sprints 1–7 (built on the Sprint 7 branch; PR stacked accordingly). Like Sprint 7, this one was built from the previous handoff's leftover list — and then a soak test found two real bugs that became most of the sprint.

## Changelog (5 lines)

1. **Nothing walks into the sea, actually.** The deer fix from Sprint 7 turned out to be a third of the job. The soak test caught rabbits *sitting on the water*: the movement step was guarded, but the arrival snap (`x=tx`) and the hide-to-sit teleport were not, and both could land an animal on a water tile it could then never leave. All three species now share one `slide()` helper (step if it lands, slide along the shore if one axis does, refuse otherwise), every arrival snap checks the ground first, and a self-heal at the top of the wildlife loop sends anything stranded in the sea back home (a stranded fox just leaves). 96,751 wildlife checks across five islands after the fix: zero on water.
2. **A ghost-proof village.** A long soak once produced an islander whose position went `NaN` — they walk forever, never arrive, never work, and quietly starve the island. It never reproduced across 19 seeded islands (~700 sim-days), so the cause is still unknown. `step()` now heals any non-finite islander at the hearth and logs a `console.warn` naming their task, so the next sighting identifies its own cause; boats get the same guard so a corrupt boat can't re-poison its passenger every frame.
3. **The keeper child knows the store.** In winter or when the shallows are frozen, the tideline gives little (35% chance of one food), and a child who comes back empty-handed takes a careful measure from the granary instead — so a snowed-in lone child no longer starves beside a full store. Tested on a frozen island: 7 measures drawn, the child fed, the fire kept.
4. **The music button stops lying.** While the sound engine is off it renders at half opacity: still remembered, visibly not playing. It undims the moment sound comes on.
5. **The lullaby stays where it is** (a decision, not a change): it rides the sfx bus, so clicking a sleeping child hums even with music off. It is the watcher's act, not the music bed, and the music toggle should not silence the watcher.

**What I'd cut if it were too big:** the boat-side NaN guard — the person-side heal already contains the damage; the boat guard only closes a warn-spam loop.

## What I did, in order

- Extracted `slide(w,nx,ny)` at the top of `stepWild` and rewrote the deer, rabbit and fox movement to use it (the fox in two places: chasing and trotting; its deliberate walk-off-the-island `leave` state is exempt everywhere).
- Ran the soak, found rabbits on the water, and traced it to the unguarded arrival snaps and the rabbit's hide→sit teleport near `home`. Guarded all of them: an arrival whose target is water changes state where it stands; the sit teleport falls back to the home tile itself (which `freeSpot` guarantees is land). The rnd() call count is identical on both branches, so replays are unaffected.
- Added the wildlife self-heal (stranded → home, fox → gone) and the people/boat non-finite guards described above. All heals are deterministic — no `R()` involved — and the people guard also releases any claimed farm tile so a healed harvester doesn't leave a field locked.
- Made `tend` season-aware: `lean = winter || frozen`, lean tideline yields `R()<.35`, and an empty-handed return draws 1 from the granary with its own log line ("takes a careful measure from the store, the way the grown ones did, and puts the lid back").
- Music button honesty: `button.dim{opacity:.5}`, toggled by the sound handler and set at boot from the remembered sound pref.

## Numbers, measured

- Wildlife after the fix: **96,751 position checks across 5 islands (3 fixed seeds, 2 random), 0 on water, 0 person NaN.** Before the fix, one random island logged 1,589 on-water hits in a single 90k-step soak — all rabbits, all at their own arrival targets.
- NaN guard proven by injection: poisoned a live islander (`x=NaN, ty=NaN`), one step later they stood at the hearth, finite, `task='idle'`.
- Winter keeper on a frozen island with food 0 and store 12: **7 granary draws, 9 food gained**, tasks cycling tend → gohome → sleep correctly.
- Full regression from Sprint 7 all still green: sack (+10, once), storm window pixel gold (216,174,93) on an occupied house, 5 non-brave islanders fishing in plain rain, save round-trip with 23-field person tuples.
- File is **167.7 KB** of the ~250 KB budget.

## Issues / complications I hit

- **My own Sprint 7 test was too polite.** It checked deer every 50 steps on one healthy island and passed. The wider soak (every 25 steps, all species, more islands) is what exposed the rabbits. If you add movement code, soak it across several random seeds, not one.
- **The NaN islander is still an open case.** Observed once on a random island that had collapsed to one person by day 44; never reproduced since, including under forced starvation for 144 sim-days. The guard converts it from a permanent ghost into a one-frame blip with a breadcrumb. If a `hearth: non-finite position` warning ever appears in a console, the task name in it is the lead.
- **Determinism discipline again**: every guard added this sprint had to either use no randomness or make its `rnd()` calls unconditionally. Worth restating for any future fix: a branch that sometimes skips an `rnd()` call desynchronizes every saved island that crosses it.

## Victories

- The soak test paying for itself twice in one sprint: written to verify a cosmetic fix, it caught a five-sprint-old fauna bug and a once-in-700-days corruption on the same afternoon.
- A frozen island, one child, a full store: the log reads "finds little under the ice, and brings the little back" and then "takes a careful measure from the store" — a story nobody wrote, told by two guard branches.

## Where the thing stands

Sprints 1–8 in, ~168 KB of ~250 KB, one file, no dependencies, no build step.

Quality-bar leftovers, if there is ever a Sprint 9:
- The NaN cause is unfound; the breadcrumb is planted. If it fires, chase it.
- Islander walking (`walk()`) still ignores terrain entirely — people wade anywhere. It has never looked wrong (paths keep them sensible), but it is the same class of bug the animals had.
- The keeper child's granary draw has no floor: a long enough freeze with a small store still ends the island, silently. Arguably right; noting it.
- The audio remains verified by measurement, never by ear. Sprint 6's caveat is now two sprints old.
