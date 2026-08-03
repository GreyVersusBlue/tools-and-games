# HANDOFF — Bell to Bell

**Where we are:** T1–T6 built and playable — One Period, the lesson, Room Temp, the seating
chart, the classroom builder, and now a second period. Where we're going: T7 next, one ticket
at a time.

Read `CLAUDE.md` first — it has the commands and the architecture rules.
Read `docs/BELL-TO-BELL-treatment.md` for anything about a system that isn't built yet.

---

## This session — T6, a second period

4th period's report screen now hands off into 5th period: same room, a completely different
roster, a different (busier) tell schedule, and a different lesson — the day continues past
the bell instead of just ending. Also removed `HANDOFF-teacher-sim (1).md`, a stray duplicate
of this file that had gone stale since the commit that introduced it.

- **`data/period5.json`** (new) — 12 new students, a 9-entry tell schedule (one more than 4th's
  eight, on purpose — 5th reads busier), and a 5-beat lesson continuing the same unit (`U.S.
  HIST · UNIT 4 · DAY 3 OF 3` — the Missouri Compromise's actual collapse in 1854, picking up
  the "delay or solution?" question 4th period's last beat leaves open). Its own stabiliser
  (Anh, steady 0.84) sits beside its own live wire (Devontae) exactly the way Priya sits beside
  June — a fresh version of the same authored shape, for kids who have never met either of
  them. Its own `seatingCopy` overrides the chart screen's intro/sub/reset-button copy, because
  "back to the August chart" means nothing to a class that was never charted in August.
- **What carries over, what doesn't** (a real design fork, not a default): the **furniture**
  carries over because it's a fact about the room. The **physical desk arrangement** — whatever
  4th period's chart ended up as — carries over too, onto the new roster, because the desks
  themselves didn't move when the bell rang. **Discoveries** (volatility edges, stabilisers)
  do *not* — they're facts about specific kids, and 5th period has never met any of them. Nor
  does the **Rapport cost of rearranging** carry over: `main.js` keeps a `rapportBase` distinct
  from the desk arrangement itself, so a brand-new roster's first chart always reads as novel
  (free to rearrange) no matter how the desks happened to already be sitting.
- **`src/main.js`** — `periodFor(id, data)` is the one place that picks a roster/schedule/
  lesson/copy bundle for whichever period is active (`persist.load('period', 'p4')`). Six new
  persisted keys (`chart5`, `known5`, `rapportBase5`, plus `rapportBase` alongside the existing
  `chart`/`known`) keep 5th period's own history from ever touching 4th's. The whole handoff is
  a `persist.save(...)` sequence followed by `location.reload()` — the same mechanism "Run it
  again" already used, not a new in-place teardown/rebuild of the 3D scene.
- **`src/ui/report.js`** — the end-of-period button is now data-driven (`extra.restart`):
  "Next period — 5th" after 4th, "Run it again" after 5th (which resets `period` back to `p4`
  and leaves 4th's own persisted chart/discoveries untouched, since T6 never wrote to them).
- **Gap 1, settled:** the lesson intentionally does not fill the period — `filler` (a "sustained
  silent work" beat, already authored, already has copy for the moment) is the answer, not a
  bug. Both periods' authored beats sum to exactly 2,000 of the period's 2,820 seconds; 5th
  period was written to the same ratio on purpose, so the slice has one settled answer instead
  of two different guesses.
- Verified in a real browser (Playwright, headless Chromium, with `config.js`'s period length
  temporarily shortened for the test run only): played 4th period, swapped desks 0/11, dragged
  the cabinet, took the report screen's "Next period — 5th" button, and confirmed on the
  reloaded page that 5th period's chart opens with a completely different roster, desk 0 and
  11 swapped exactly as 4th left them, the cabinet in 4th's final position, and the cost line
  reading "They have never sat in this chart" even after rearranging several more seats.
- 20 new `tests/smoke.mjs` assertions (distinct roster, schedule shape, its own stabiliser/
  handoff/curveball, the physical-carryover-without-familiarity split) plus three new
  `tests/balance.mjs` runs against 5th period's content. All green — see below for numbers.

---

## Built and working

**The room and the seeing**
- 3D classroom, first-person teacher, WASD + drag-look, collision against desks and furniture
- 12 students from `data/students.json`, each with a `tension`, an `aptitude` and a `steady`
- **Withitness**: thermal material swap, CSS overlay, sub-bass drone, heartbeat, rubric-box
  tell annotations
- **Line-of-sight blind spots**: raycast against occluders defined in `data/room.json`
- 6 tell types (PHONE, NOTE, WHISPER, COPYING, FALSE, QUIET) on an authored schedule
- **Intervention menu** driven entirely by `data/interventions.json`, with per-type overrides,
  proximity gating, coinflip outcomes, and escalation
- **Hypervigilance** → false positive spawn → the granola bar
- **The curveball** (QUIET) at minute 21, unscored, different menu
- Scheduled intercom event, four meters, room-temp bands, four endings, end-of-period report
- **Startup errors surface on screen** instead of leaving the start button dead (`main.js`)

**T1 — Student reactions.** A pose/envelope tween in `src/world/students.js`, every pose data
(`data/reactions.json`): attack/hold/release, head yaw aimed at wherever the teacher actually
is, torso dip, idle suppression. Fires on interventions, escalation, tell born/gone, checks,
reteaches, beat changes and the intercom. Held postures make tells faintly readable *without*
Withitness — the treatment's Tier 1 / Tier 2 distinction existing in the world.

**T2 — The lesson.** Mastery is the **mean of twelve separate comprehension values**. Five
authored beats in `data/lesson.json`. **E** advances (rushing and belabouring both cost you),
**Q** checks (costs Bandwidth, reveals the comprehension aura, goes stale in about a minute),
**R** reteaches (expensive, gives back beat time, halved if you did not check first). A student
with an unresolved tell on them stops learning, weighted by the tell type's `attention`.
Per-student ceilings rise as the lesson covers ground and are scaled by aptitude.

**T3 — Room Temp.** **T** takes a cheap whole-room reading: a band, a line, and a quadrant.
Never names a kid. The HUD readout ages and then says so.

**T4 — The seating chart.** A plan of RM 214 before the bell; drag a name onto another name
to swap. The screen is `src/ui/seating.js`; all the thinking is in `src/systems/chart.js`,
which is pure and headless.

- **`seat` is who you are, `desk` is where you are.** They used to be the same index. The
  authored tell schedule, every test and every system still refer to people by `seat`; the
  chart writes `x` / `z` / `bodyZ` / `col` / `row` onto the student and everything downstream
  (tells, Room Temp quadrants, collision, reactions) reads that.
- **Sightlines.** `src/systems/sightlines.js` asks the raycast's question on paper — segment
  against rectangle — and shades every desk *clear / partial / blind* from the three places
  you actually stand (now named in `data/room.json` → `viewpoints`). Hovering a desk tells you
  where you would have to walk. The August layout produces no fully blind desk: the back right
  is visible only from the windows, the back left only from the door — T5 is what makes a fully
  blind desk reachable, by moving the furniture that's currently making it merely partial.
- **Reach.** Side by side 1.0, in front/behind 0.8, diagonal 0.55, threshold 0.5. A whisper
  needs a neighbour; a note does not. Separate a whisper pair and **they do not become saints**
  — the instigator does something quieter and easier to see (a `PHONE`, 85% of the life), which
  is the actual teacher move: you cannot remove the trouble, you can choose its shape and where
  it sits. A note passed one desk over becomes a handoff at 70% life, i.e. easier to miss.
- **Stabilisers.** New hidden `steady` per student. If the steadiest neighbour clears the
  threshold, the tell **never spawns**. Nothing appears, nothing is scored, no toast. You find
  out in the report. It costs the stabiliser: `steadyLoad` scales their comprehension gain down
  and the report names them and gives their number. The August chart already contains one —
  Priya sits directly in front of June, and June's 16-minute phone has never once happened.
- **The front row.** ×1.10 / ×1.00 / ×0.88 on delivery gain. Four seats.
- **"We JUST moved."** Two moved seats are free; past that it is Rapport, capped at −7. A chart
  they have never sat in is not a move.
- **Discovery.** Volatility edges and stabilisers are drawn only after you have watched them
  (`learnFrom` at the bell). Persisted with `src/persist.js` — the only `localStorage` in the
  project, degrading to memory if the browser refuses.

**T5 — The classroom builder.** The cabinet and the bookshelf drag on the same chart screen;
every desk's sight class reclassifies live as you move them (`chart.moveOccluder`). Clamped to
the room's own footprint (`room.bounds`) — no collision against desks or each other, that's
not what this ticket bought. The layout persists between periods the same way the seat chart
does. This is the whole mechanic from the treatment's §5 ("sightlines are the point"), just
without the money, the catalog, or the seasonal door-decorating contest — those are still
unbuilt content, not systems.

**T6 — Second period.** `data/period5.json` bundles a new roster, tell schedule and lesson;
`src/main.js`'s `periodFor()` is the single seam that picks which bundle is active. 4th
period's report hands off with a `persist.save(...)` + `location.reload()`, not a live
teardown/rebuild — the entire linear boot sequence in `main.js` already runs once per page
load, so a second period is a second load with different data selected, the same mechanism
"Run it again" always used. Room, tell *types* (the mechanical definitions, not the schedule),
interventions, reactions, events and seating *rules* are the same building and the same
rulebook regardless of period; only the roster, the tell schedule, and the lesson are
period-specific content.

**Audio.** HVAC bed, ambient murmur scaling with restlessness and ducking under Withitness,
chair scrapes on reactions, a chime on checks, the bell.

**Tests.** `tests/smoke.mjs` — 167 headless assertions over interventions, the lesson, the
reaction wiring, Room Temp, the chart, the classroom builder, and the second period.
`tests/balance.mjs` — five play styles through whole 4th-period runs, one style across three
4th-period charts, and three representative styles against 5th period's own content.

---

## Where the balance sits

4th period unchanged. 5th period is new this session — see "5th period" below.

```
ideal (never scans)         mastery 77  fidelity 84  bandwidth 19  restless 72  missed 7
the good teacher            mastery 80  fidelity 80  bandwidth  0  restless  0  missed 0
the hypervigilant           mastery 12  fidelity 57  bandwidth  0  restless  0  missed 0
the wanderer                mastery 55  fidelity 53  bandwidth 54  restless 14  missed 0
never checks, never looks   mastery 56  fidelity 70  bandwidth 55  restless 93  missed 7
```

```
the August chart        mastery 77  restless 72  missed 7
the pairs split up      mastery 79  restless 44  missed 6
the barometer up front  mastery 79  restless 49  missed 6
```

5th period, the same three representative styles run against `data/period5.json` — genuinely
busier (one more scheduled tell, restless runs hotter across the board) while still landing in
the same neighborhood on mastery, and still exactly one thing that quietly never happens:

```
5th: ideal (never scans)       mastery 76  fidelity 84  bandwidth 19  restless 79  missed 8
5th: the good teacher          mastery 81  fidelity 80  bandwidth  0  restless  0  missed 0
5th: never checks, never looks mastery 54  fidelity 70  bandwidth 55  restless 91  missed 8
```

---

## Known gaps in the slice

1. ~~The lesson is 2,000 game-seconds against a 2,820-second period~~ — **settled.** This is
   intentional: `filler` ("sustained silent work") is the designed answer to running out of
   lesson before the bell, not a bug to fix by stretching beats. Both periods' authored beats
   sum to exactly 2,000s on purpose, so there's one ratio for the slice, not two accidental
   ones. Revisit only if playtesting says the filler stretch actually feels bad, not because
   the number looks incomplete.
2. **Tell meshes are still placeholders.** Boxes and spheres.
3. **Mobile is still untested.**
4. **The comprehension aura is a torus over every head.** Fine at a glance, bad in a crowd.
5. **Whisper audio does not exist.**
6. **Beats and tells are hand-authored and never vary.**
7. **T4: the front row's advantage is small enough to hide.** Don't decide this without
   running `SPREAD=1 node balance.mjs`.
8. ~~T4: no desk in this room is fully blind~~ — **closed by T5.** The August default still
   doesn't produce one (that was never the bug), but you can now drag the furniture until it
   does, and the "blind" legend swatch lights up when you have.
9. **T5 doesn't check furniture against desks or against the other occluder.** You can drag
   the cabinet on top of a desk, or on top of the bookshelf. Nothing breaks — the sight math
   doesn't care — it just looks wrong. Not worth solving until it's visible in the 3D room too.
10. **T6 only ever goes forward, once.** There is no 6th period, and "Run it again" from 5th's
    report restarts the whole day at 4th (correctly leaving 4th's own persisted chart and
    discoveries untouched — T6 never writes to the `chart`/`known`/`rapportBase` keys, only to
    the `*5` ones). A real multi-period day would need a per-period save slot, not two hardcoded
    ones; not worth building until there's a third period to prove the pattern against.
11. **A page reload always lands back on 4th period**, even mid-5th-period. There's no
    persisted "which period was I actually in the middle of" — only "Run it again"/"Next
    period" set the `period` flag, so an accidental refresh during 5th period sends you back to
    4th's chart. Matches the existing "Run it again reloads everything" mental model; would
    need its own ticket to fix properly.

---

## Backlog (suggested order)

**T7 — The Observation.** *Next up.* The boss fight. Admin Proximity Alert, nine-second window,
rubric look-fors, post-conference dialogue tree. Treatment §6.1.

**T8 — Whisper audio.** Gap 5. Directional, panned, radio-crackle fragments on WHISPER tells.

---

## Open questions

- Tell and beat authoring vs. generation: keep authoring for now — T6 shipped a second
  authored roster/schedule/lesson rather than generating one, deliberately, to keep proving the
  authored shape works before automating it.
- Does the period need a fail state? Still no.
- Should Room Temp reveal direction at all? Still unchanged.
- Is suppression too strong? Watch whether players find "the barometer in the middle of the
  back row" and never move her again. If they do, the fix is probably a per-period limit on
  how much one kid can absorb, not a nerf to the effect. Now watch it across *two* rosters
  (Priya and Anh both), not just one.
- Subject choice reskins hazards. Not worth touching yet.
- Mobile. Still undecided.
- A third period would immediately demand solving known gaps 10 and 11 (hardcoded `*5` keys,
  no "which period am I mid-way through" persistence). Don't build that scaffolding until a
  third period is actually the next ticket.

## How to pick up in Claude Code

Point it at the repo root and give it a ticket, not the whole project:

> Read CLAUDE.md and docs/HANDOFF.md. Implement T7 (The Observation). Run
> tests/smoke.mjs and tests/balance.mjs when you're done and tell me what you changed.

Don't open with "figure out what to do" — the backlog already decided, and an agent given an
open brief on a 40-file repo will refactor things that were working.
