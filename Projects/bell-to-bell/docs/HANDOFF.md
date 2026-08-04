# HANDOFF — Bell to Bell

**Where we are:** T1–T7 built and playable — One Period, the lesson, Room Temp, the seating
chart, the classroom builder, a second period, and now the boss fight. Where we're going: T8
next, one ticket at a time.

Read `CLAUDE.md` first — it has the commands and the architecture rules.
Read `docs/BELL-TO-BELL-treatment.md` for anything about a system that isn't built yet.

---

## This session — T7, the Observation

The boss fight. Every period, an Admin Proximity Alert gives you a real nine-second warning;
then AP Reyes is in the room, a rubric window opens on the game clock, and you can perform the
rubric's look-fors while your actual class either keeps going or doesn't. She always visits —
same as the intercom PA does — no coin flip, so the slice never has to model whether today is
an observation day.

- **`data/observation.json`** (new) + **`src/systems/observation.js`** (new) — the alert copy,
  the arrival copy, five look-fors, and the one-exchange post-conference dialogue tree, all
  driven by a small phase machine on `state` (`idle → alert → active → done`). Four of the five
  look-fors are close to pure performance: post the objective (**O**), ask a higher-order
  question (**H**), give it student-led discourse (**G**) — one-shot keys, satisfied once,
  idempotent after. **Checks for understanding** reuses the existing **Q** action outright
  (it's the one look-for that's also just good teaching, so it costs nothing extra here —
  `lesson.check()` already charges for it). **Wait time** is performed by *holding* **F** for
  five real seconds and doing nothing else — the rubric rewards the appearance of patience, so
  the mechanic is: literally stand there. All are gated to the active window only; pressed
  early they just tell you nobody's watching yet.
- **The ambient cost is not performable.** While the window is open, Mastery drains continuously
  through `state.masteryPending` (never `state.mastery` directly — CLAUDE.md rule 7), regardless
  of whether you chase a single look-for. About a 5-point dent over the full 11 game-minutes,
  every time, win or lose the rubric. Satisfying look-fors adds real Fidelity on top. This is
  the mechanical shape of "you can stack a fake-great observation... Mastery down, Fidelity up"
  from the treatment: the cost of being watched and the reward for performing are two separate
  levers, not one.
- **The post-conference is its own screen** (`src/ui/conference.js`, `#conferenceScreen`), not
  a reuse of the intervention menu's `#menu` — that menu is deliberately ESC-skippable ("the
  period is still running"); this conversation is not skippable, since ESC is wired globally to
  close `#menu` and would otherwise strand the game with the period over and no report ever
  shown. One exchange, three responses (adapted directly from treatment §6.1): the affirming
  answer that costs a future follow-up, the honest answer that costs Fidelity now, and the
  hollow answer that costs nothing but Bandwidth "from the small death inside." `main.js`'s
  `endPeriod()` shows this before the report, only on a period she actually visited.
- Verified in a real browser (Playwright, headless Chromium — software-rendered, so the frame
  clock runs slower than wall time here; the test polls state instead of assuming durations):
  the alert banner counts down and hands off to her arrival, all four one-shot look-fors land
  on keypress, holding **F** the full five seconds (and *only* holding it — releasing early
  resets the clock) books "wait time," the rubric panel closes exactly when the window's game-
  time budget runs out regardless of score, the post-conference shows all three responses
  verbatim, and picking "honest" produces a report with the 5/5 rubric line and the honest
  quote.
- 24 new `tests/smoke.mjs` assertions (phase transitions on schedule, idempotent look-fors,
  the wait-hold's reset-on-release, the ambient drain going through `masteryPending`, all three
  conference options). `tests/balance.mjs` now runs the Observation unconditionally in every
  simulated period (she always visits) and adds a "plays the rubric" comparison run — see below.

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

**T7 — The Observation.** Admin Proximity Alert (real nine-second countdown) → she's in the
room → an eleven-game-minute rubric window (`src/systems/observation.js`). Five look-fors:
three one-shot performative keys (**O**bjective, **H**igher-order question, **G** for
discourse), one held key (**F**, five real seconds, wait time), and checks-for-understanding
riding the existing **Q**. An ambient Mastery cost runs the whole window regardless of what you
do with it; look-fors satisfied add real Fidelity. The post-conference (`src/ui/conference.js`,
its own screen, not the skippable intervention menu) is one exchange, three responses, straight
out of treatment §6.1.

**Audio.** HVAC bed, ambient murmur scaling with restlessness and ducking under Withitness,
chair scrapes on reactions, a chime on checks, the bell.

**Tests.** `tests/smoke.mjs` — 191 headless assertions over interventions, the lesson, the
reaction wiring, Room Temp, the chart, the classroom builder, the second period, and the
Observation. `tests/balance.mjs` — five play styles through whole 4th-period runs (now with
the Observation's ambient cost baked in, since she always visits), one style across three
4th-period charts, three representative styles against 5th period's own content, and a
rubric-vs-no-rubric comparison run.

---

## Where the balance sits

Every number below moved from last session — the Observation's ambient Mastery cost now runs
in every simulated period (she always visits), which is why mastery reads a few points lower
across the board and fidelity a few points *higher* (checking for understanding is also a
look-for, and every style here checks at least occasionally). That's the correct direction: an
observation happened, you paid for it whether you played to it or not.

```
ideal (never scans)        mastery 74  fidelity 87  bandwidth 18  restless 72  missed 7  obs 1/5
the good teacher           mastery 79  fidelity 82  bandwidth  0  restless  0  missed 0  obs 1/5
the good teacher, rubric   mastery 79  fidelity 92  bandwidth  0  restless  0  missed 0  obs 5/5
the hypervigilant          mastery  8  fidelity 57  bandwidth  0  restless  0  missed 0  obs 0/5
the wanderer               mastery 50  fidelity 56  bandwidth 53  restless 14  missed 0  obs 1/5
never checks, never looks  mastery 51  fidelity 70  bandwidth 55  restless 93  missed 7  obs 0/5
```

"the good teacher, rubric" is the same teacher, same everything, except she also plays to the
rubric the instant AP Reyes walks in: identical mastery (the ambient cost doesn't care whether
you performed), ten points more Fidelity (the rubric actually rewarding the show). That's the
whole mechanic in one row.

```
the August chart        mastery 74  restless 72  missed 7  obs 1/5
the pairs split up      mastery 75  restless 44  missed 6  obs 1/5
the barometer up front  mastery 75  restless 49  missed 6  obs 1/5
```

5th period, the same three representative styles run against `data/period5.json` — genuinely
busier (one more scheduled tell, restless runs hotter across the board) while still landing in
the same neighborhood on mastery, and still exactly one thing that quietly never happens:

```
5th: ideal (never scans)       mastery 73  fidelity 87  bandwidth 18  restless 79  missed 8  obs 1/5
5th: the good teacher          mastery 78  fidelity 82  bandwidth  0  restless  0  missed 0  obs 1/5
5th: never checks, never looks mastery 49  fidelity 70  bandwidth 55  restless 91  missed 8  obs 0/5
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
12. **The Observation always fires at the same authored minute, every period, for everyone.**
    Not randomized, not announced-vs-unannounced (treatment §6.1 has both; only unannounced is
    built). Matches the project's own authoring-over-generation stance — see open questions —
    and both periods happening to schedule it the same way is a deliberate simplification, not
    a discovered coincidence.
13. **The post-conference is one exchange, not a tree.** Treatment §6.1 shows one exchange as
    its example; a deeper multi-turn conversation is real future scope, not a cut corner — this
    ticket shipped the shape (a screen that isn't skippable, three real responses, effects that
    apply), not the depth.
14. **Tell meshes, mobile, whisper audio, generated content — all still open, all still gaps
    2/3/5/6 above.** T7 didn't touch any of them.

---

## Backlog (suggested order)

**T8 — Whisper audio.** *Next up.* Gap 5. Directional, panned, radio-crackle fragments on
WHISPER tells.

---

## Open questions

- Tell and beat authoring vs. generation: keep authoring for now — T6 shipped a second
  authored roster/schedule/lesson rather than generating one, and T7 shipped one authored
  observation rather than a randomized one, both deliberately, to keep proving the authored
  shape works before automating it.
- Does the period need a fail state? Still no.
- Should Room Temp reveal direction at all? Still unchanged.
- Is suppression too strong? Watch whether players find "the barometer in the middle of the
  back row" and never move her again. If they do, the fix is probably a per-period limit on
  how much one kid can absorb, not a nerf to the effect. Now watch it across *two* rosters
  (Priya and Anh both), not just one.
- Is the Observation's ambient Mastery cost calibrated right? It's ~5 points over the full
  window by design math, not by playtesting. Watch whether it reads as "a real cost" or "not
  even worth noticing" once someone other than the person who wrote the constant plays it.
- Should there be an announced (scheduled, not surprise) variant of the Observation, per
  treatment §6.1? Not built. Low priority — the Admin Proximity Alert version is the funnier one.
- Subject choice reskins hazards. Not worth touching yet.
- Mobile. Still undecided.
- A third period would immediately demand solving known gaps 10 and 11 (hardcoded `*5` keys,
  no "which period am I mid-way through" persistence). Don't build that scaffolding until a
  third period is actually the next ticket.

## How to pick up in Claude Code

Point it at the repo root and give it a ticket, not the whole project:

> Read CLAUDE.md and docs/HANDOFF.md. Implement T8 (whisper audio). Run
> tests/smoke.mjs and tests/balance.mjs when you're done and tell me what you changed.

Don't open with "figure out what to do" — the backlog already decided, and an agent given an
open brief on a 40-file repo will refactor things that were working.
