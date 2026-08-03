# HANDOFF — Bell to Bell

**Where we are:** T1–T4 still built and playable (One Period, the lesson, Room Temp, the
seating chart). No new ticket landed this session — this was a bug session, not a build
session. Where we're going: same as before, T5 onward, one ticket at a time.

Read `CLAUDE.md` first — it has the commands and the architecture rules.
Read `docs/BELL-TO-BELL-treatment.md` for anything about a system that isn't built yet.

---

## This session — the dead start button

You reported a soft lock on the opening screen: clicking "Seating chart" did nothing.

**What I ruled out**, by building a headless harness (jsdom + a mocked `three.js`) that
replays the actual click without a real GPU:
- The seating chart logic itself — `tests/smoke.mjs` is still 143/143 green, no regressions.
- DOM wiring — every element ID `dom.js` expects exists in `index.html`.
- Data shape — `data/seating.json`'s furniture plan matches `data/room.json`'s fixture IDs.
- The click path itself — simulated end-to-end in the harness: `startBtn` click correctly
  hides the intro screen and renders all 19 seating-chart elements (4 furniture + 2 occluders
  + the edge SVG + 12 desks).

**Leading theory, not yet confirmed by you:** `main.js` uses top-level `await loadData()`,
which `fetch()`es `data/*.json`. If `index.html` is opened directly as a file instead of
served over HTTP, those fetches are blocked (CORS on `file://`), the `await` throws, and the
script dies *before it ever reaches the line that wires up `startBtn`'s click listener* —
which is at the very bottom of the file. Result: a permanently dead button with zero visible
error. This matches what you described exactly, and I reproduced that failure mode in the
harness to confirm the mechanism is real. CLAUDE.md already says "ES modules need a server"
for this reason — it's an easy thing to forget between sessions.

**What I actually fixed, independent of whether that theory is the whole story:** the entire
startup path in `main.js` (from `loadData()` through the final `requestAnimationFrame(frame)`)
is now wrapped in a try/catch. Any startup failure — that one, or anything else — now shows a
full-screen overlay with the real error and stack trace, plus a pointer toward the file://
gotcha, instead of failing silently. If this happens again, the screen itself will tell us
what broke.

**If the soft lock is still happening after this**, run it via
`python3 -m http.server 8000` and open `localhost:8000` (not the file directly), reload, and
send me whatever the new error overlay says — that's the actual next clue, not a guess.

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
- **Startup errors now surface on screen** instead of leaving the start button dead (this
  session, `main.js`)

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
  where you would have to walk. The current furniture produces no fully blind desk: the back
  right is visible only from the windows, the back left only from the door. That is honest,
  and it is the hook T5 hangs on.
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

**Audio.** HVAC bed, ambient murmur scaling with restlessness and ducking under Withitness,
chair scrapes on reactions, a chime on checks, the bell.

**Tests.** `tests/smoke.mjs` — 143 headless assertions over interventions, the lesson, the
reaction wiring, Room Temp, and the chart. `tests/balance.mjs` — five play styles through
whole periods, plus one style across three different charts. Both still green after this
session's changes; the error-handling wrap touches nothing either test exercises.

---

## Where the balance sits

Unchanged from before this session — nothing in the balance-relevant systems was touched.

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

---

## Known gaps in the slice

Unchanged from before this session:

1. **The lesson is 2,000 game-seconds against a 2,820-second period.** Still a live tuning
   call; settle before T6.
2. **Tell meshes are still placeholders.** Boxes and spheres.
3. **Mobile is still untested.**
4. **The comprehension aura is a torus over every head.** Fine at a glance, bad in a crowd.
5. **Whisper audio does not exist.**
6. **Beats and tells are hand-authored and never vary.**
7. **T4: the front row's advantage is small enough to hide.** Don't decide this without
   running `SPREAD=1 node balance.mjs`.
8. **T4: no desk in this room is fully blind**, so one of the three legend swatches never
   lights. Correct given the furniture; T5 is what makes it reachable.

---

## Backlog (suggested order) — unchanged

**T5 — Classroom builder.** *Highest value per hour of work.* Move the furniture; the
blind-spot polygons update live. `systems/sightlines.js` already classifies desks from named
viewpoints and the chart screen already draws the occluders in plan, so this is largely "make
the two grey rectangles draggable and re-run `classifySight`." Closes gap 8.

**T6 — Second period.** Same room, different roster, different Room Temp baseline, a different
lesson, starting comprehension carried from nothing. Inherits a real chart and real
discoveries. Settle gap 1 first.

**T7 — The Observation.** The boss fight. Admin Proximity Alert, nine-second window, rubric
look-fors, post-conference dialogue tree. Treatment §6.1.

**T8 — Whisper audio.** Gap 5. Directional, panned, radio-crackle fragments on WHISPER tells.

---

## Open questions — unchanged

- Tell and beat authoring vs. generation: keep authoring until after T6.
- Does the period need a fail state? Still no.
- Should Room Temp reveal direction at all? Still unchanged.
- Is suppression too strong? Watch whether players find "the barometer in the middle of the
  back row" and never move her again. If they do, the fix is probably a per-period limit on
  how much one kid can absorb, not a nerf to the effect.
- Subject choice reskins hazards. Not worth touching yet.
- Mobile. Still undecided.

## How to pick up in Claude Code

Point it at the repo root and give it a ticket, not the whole project:

> Read CLAUDE.md and docs/HANDOFF.md. Implement T5 (classroom builder). Run
> tests/smoke.mjs and tests/balance.mjs when you're done and tell me what you changed.

Don't open with "figure out what to do" — the backlog already decided, and an agent given an
open brief on a 40-file repo will refactor things that were working.
