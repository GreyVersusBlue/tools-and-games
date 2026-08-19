# Hearth v2 — Sprint 10 handoff ("What the hands learn")

Deliverable: `hearth.html` (single file, ~195 KB, zero deps, runs from `file://`). Sprint 10 is the first depth sprint of the roadmap: people deepen instead of the island merely filling, the buildings start doing their jobs, and progression stops terminating. Save format goes to **v:6** (v:5 links still load; the new fields read as defaults and the island carries on).

## Changelog (5 lines)

1. **Crafts.** Five — field, wood, sea, frame, store — mapped onto the work that already existed. Adults drift into whichever craft they actually do (15% per completed cycle while uncrafted); each completed cycle in your craft adds 0.012 toward mastery at 1.0; craft work runs up to 1.35× faster and is preferred proportionally. Milestone lines at .33/.66/1.0 per craft ("{A} brings the boat in on a line nobody else can see."), a chronicle entry and a card epithet at mastery ("who reads the water"). Children 5+ shadow working adults (the old "follows {B} around asking why" line is now the apprenticeship system: at fourteen they take up their most-followed adult's craft at 0.1). A new `calling` dream lets the watcher unsettle someone's work overnight.
2. **The buildings work now.** The **mill** takes 60% of non-autumn harvests up the hill as visible carries (farm → hopper → store, +2 meal each, capped at 14 per head so the store cannot run away) and gives one **bread day** each winter at dusk — granary −6, hunger eased, the whole village at the fire. The **well** answers dry spells: a rainless spring/summer accumulator halves growth past 0.7 and sends water-carriers well→field (+.15 growth a trip) — plumbing sprint 11's droughts will crank. The **trader** now reads the stock (short store → generous meal; wood surplus → a fair timber deal; else small goods) and the best store-craft islander "does the talking," their skill worth ±15%.
3. **The works.** Once 6+ buildings stand, ~one small ambition a year: orchard (3 protected fruit trees, autumn windfalls), drying racks (+1 boat fish), a swing in the old tree, a stone ring for the fire, a **second boat** (two out at once), beehives (summer honey), a bench at the lighthouse, and the **ruin restored in three stages over three years** — ending in "the old house," with found objects (a bone comb, a child's wooden horse) entering the chronicle for sprint 12's lore to harvest. `nextBuild()`'s dead end is gone.
4. **The returner.** Once a year, in a kind season, someone who left in hunger may row back: "A boat comes in that nobody sent for." Their old relationships reactivate on both sides (an ex-partnership softens to friendship). Leaving is no longer final.
5. **A worldgen bug the works exposed, fixed:** some islands site the lighthouse on a rock islet no one can walk to. Under sprint 9's terrain rules the builder could never arrive — `bldgTgt` ate 30 wood and hung forever, silently blocking every works roll (and, it turns out, explains why one 400-day sprint-9 soak never built its lighthouse). Worldgen now flood-fills reachability from the hearth (streams count as wadeable): unreachable landings are dropped, an unreachable lighthouse site means no lighthouse on that island. Deterministic, no `rnd()`.

**What I'd cut if it were too big:** the works' pixel art (racks/hives/bench/ring/swing are ~1.5 KB of draw code and the prose carries them); never the crafts.

## Numbers, measured

- **Depth run, 120 days × 2 seeds:** all adults crafted (field/wood/sea/frame/store roughly 8-17/4-8/9-17/2-3/1-2), 12–14 masters, 6–8 works built per island including full ruin restoration + 2 found objects on one seed, 6 bread days each (one per winter, every winter), store bounded at 430–530 under the 14-per-head cap (it was 1,403 before the cap — the mill was printing grain).
- **Returner, force-tested:** starve until someone leaves → years of plenty → "Belbel, who left in a hungry season, came back when the seasons turned kind, and was given bread before any questions." Relationships verified mirrored on both sides after the fix below.
- **Determinism:** seeds 7 and 20260819, 30 days, two fresh runs each — identical `pack()` hashes, re-verified after every fix.
- **Soak:** 5 islands × 40 days, ~22,500 full-cast audits — 0 violations, 0 breadcrumbs.
- **v5 compatibility:** a forged v5 save (23-field tuples, no works keys) loads under v6; people arrive craftless and drift into crafts within days.
- Births damp from .025 to .01 past 28 people — the richer economy was filling the cap by day 121; the village stays a village.
- File: **~195 KB** of the ~250 KB budget (+21 KB this sprint — the estimate said 18–20; the works' draw code is the overage).

## Issues / complications I hit

- **The mill printed grain.** +2 to the granary per carry with no ceiling reached 1,403 meal by day 121. Carries now only run while the store holds under 14 per person. If sprint 11 adds hard winters, that cap is the number to tune.
- **Frame-craft never developed** when it only gained at build *finishes* (a handful per game). Builders now also gain once per ~9 work-seconds at the frame.
- **The lighthouse-islet hang** (changelog 5) was found because seed 7 built exactly one work in five years when probability said six — worth remembering that "suspiciously quiet" is a bug signature in its own right.
- The returner initially came back with an empty `rels` list while everyone else still listed them — one-way memory. Now mirrored, with `partner` downgraded to `friend` on both sides.
- **Kids shadowing reads low in tests (0–2)** because a child must be 5+ and islands are only ~7 years old by day 121; the apprenticeship arc pays out on decade-old islands. Nothing to fix; noting so the next sprint doesn't "fix" it.

## Victories

- The soak's day-by-day pop/store lines made every balance problem visible within minutes of writing the feature — the harness is now load-bearing for design, not just correctness.
- The ruin's three-year restoration ends with a found object going "on the shelf in the hall, and everyone has held it once" — sprint 12's heirlooms and lore already have somewhere to stand.
- Bread day at dusk in the deep of winter, with the whole village drifting to the fire, is the best-feeling scene the sim has produced unprompted.

## Where the thing stands

Sprints 1–10 in, ~195 KB of ~250 KB, one file, no dependencies, save v:6 (v:5 accepted), harness green across soak/determinism/save/depth.

**Still owed: the audio listening pass** (now five sprints). No new audio was written this sprint, per the gate.

Quality-bar leftovers, if there is ever a Sprint 11 (the roadmap says there is):
- The dry-spell accumulator (`dry01`) is deliberately mild — sprint 11's dry arc should crank it (and the well line at dawn is already written for it).
- Works lose in-progress state on save/load (same as houses always have); a paid-but-unbuilt work resumes from zero. Fine at 4 wood; revisit if works get dearer.
- The second boat has no second beached-boat art when both boats are in (only when one is out); nobody will notice, noting it anyway.
- The bread-day `gather` shows the story-night "why" text on the card. One line in `whyText` if it grates.
- Trade outcomes no longer use the old three-way roll, so `{ev}` trade flavor references the new lines — read a few trade days on a long island to make sure the prose still lands.
