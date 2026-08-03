# HANDOFF — Bell to Bell

**Where we are:** T1–T6 and T8 built and playable (One Period, the lesson, Room Temp,
the seating chart, the classroom builder, a second period, whisper audio). Where
we're going: T7 — The Observation — next.

Read `CLAUDE.md` first — it has the commands and the architecture rules.
Read `docs/BELL-TO-BELL-treatment.md` for anything about a system that isn't built yet.

---

## This session — T5, T6, T8

Three backlog tickets, in the order the previous handoff suggested, skipping only
T7 (bigger, more narrative work — left for its own session).

**T5 — Classroom builder.** The cabinet and bookshelf on the pre-bell seating chart
are draggable now. `systems/chart.js` keeps the occluder rectangles mutable and
re-runs `classifySight` on every desk as you drag (`moveOccluder`); `ui/seating.js`
does the drag with a delta-based pointer handler and a `patch()` that repositions
elements in place instead of rebuilding the plan mid-drag, which would drop pointer
capture on the thing you're holding. The layout you land on isn't just a preview —
`beginPeriod()` in `main.js` moves the real 3D occluder meshes to match, so the
raycast and collision the rest of the period uses are the ones you actually built.
It persists (`localStorage` key `occluders`) because it's the room, not the roster.
Closes gap 8 from last time: park a occluder on a desk's own sightline and it goes
fully blind, from all three viewpoints, which the August layout alone never produces.

**T6 — Second period.** `main.js` is restructured around `startPeriod(index)`, driven
by a `PERIODS` list (`./data`, `./data/period2`). The report screen has a "Next
period" button that calls it directly — no reload. New content lives in
`data/period2/`: a new twelve-kid roster, a new lesson (Reconstruction's three
amendments, sized to actually fill the period — see the balance note below), and a
different Room Temp baseline (a rowdier, post-lunch fifth period). `tells.json`,
`interventions.json`, `reactions.json`, and `seating.json` are mechanic definitions,
not period-specific content, so period 2 just has its own copies of those, unchanged.
Chart and discovery persistence are namespaced per period (`chart:period2`,
`known:period2`) — a volatility edge you learned about one roster's kids has no
business being drawn on a different roster's chart just because it landed on the
same seat number. Furniture position (T5) stays a single un-namespaced key, since
that's genuinely shared physical state between periods in the same room.

**T8 — Whisper audio.** Gap 5, closed, in the register the rest of the audio in this
project already uses: everything in `audio.js` is procedurally synthesized, nothing
is a sample, so whisper audio is a filtered-noise bed (bandpass around 1050 Hz for a
voice-ish formant, a `tanh` wave-shaper for radio crackle, a slow LFO riding on the
gain so it stutters instead of droning) run through a `StereoPannerNode`. `main.js`
finds the room's one live `WHISPER` tell each frame, computes its pan from the
camera's yaw and its distance-based falloff (`CFG.whisper.range`,
`CFG.whisper.panSpan`), and it's silent unless you're in Withitness — the whole point
is that it's not audible normally. One deliberate scope call: the treatment's
"intelligible fragments... transcribed live in subtitles" implies actual words. This
does not do that — there's no voice synthesis or recorded dialogue in this project,
procedural or otherwise, so what you get is an impressionistic, placeable murmur, not
transcribable speech. If literal subtitles matter later, that's new scope, not a bug
in this ticket.

All three: `tests/smoke.mjs` (150 assertions, was 143) and `tests/balance.mjs` (now
runs both periods) are green. **Not verified in an actual browser this session** — the
sandbox this work happened in blocks the CDN `three.js` loads from
(`cdn.jsdelivr.net`, 403 from the egress proxy), so there was no way to click through
the real WebGL game here. Worth doing a real pass — `python3 -m http.server 8000` —
before trusting the drag interaction or the period-2 transition beyond what the
headless tests cover.

---

## Built and working

**The room and the seeing**
- 3D classroom, first-person teacher, WASD + drag-look, collision against desks and furniture
- 12 students from `data/students.json`, each with a `tension`, an `aptitude` and a `steady`
- **Withitness**: thermal material swap, CSS overlay, sub-bass drone, heartbeat, rubric-box
  tell annotations
- **Line-of-sight blind spots**: raycast against occluders defined in `data/room.json`,
  and now draggable on the chart screen (T5) — see below
- 6 tell types (PHONE, NOTE, WHISPER, COPYING, FALSE, QUIET) on an authored schedule
- **Intervention menu** driven entirely by `data/interventions.json`, with per-type overrides,
  proximity gating, coinflip outcomes, and escalation
- **Hypervigilance** → false positive spawn → the granola bar
- **The curveball** (QUIET) at minute 21, unscored, different menu
- Scheduled intercom event, four meters, room-temp bands, four endings, end-of-period report
- Startup errors surface on screen instead of leaving the start button dead (`main.js`)

**T1 — Student reactions.** A pose/envelope tween in `src/world/students.js`, every pose data
(`data/reactions.json`): attack/hold/release, head yaw aimed at wherever the teacher actually
is, torso dip, idle suppression. Fires on interventions, escalation, tell born/gone, checks,
reteaches, beat changes and the intercom. Held postures make tells faintly readable *without*
Withitness — the treatment's Tier 1 / Tier 2 distinction existing in the world.

**T2 — The lesson.** Mastery is the **mean of twelve separate comprehension values**. Five
authored beats per lesson (`data/lesson.json`, one per period). **E** advances (rushing and
belabouring both cost you), **Q** checks (costs Bandwidth, reveals the comprehension aura,
goes stale in about a minute), **R** reteaches (expensive, gives back beat time, halved if you
did not check first). A student with an unresolved tell on them stops learning, weighted by
the tell type's `attention`. Per-student ceilings rise as the lesson covers ground and are
scaled by aptitude.

**T3 — Room Temp.** **T** takes a cheap whole-room reading: a band, a line, and a quadrant.
Never names a kid. The HUD readout ages and then says so. Bands are per-period data
(`data/*/events.json` → `roomTemp`), so a rowdier period can run a hotter baseline (T6).

**T4 — The seating chart.** A plan of RM 214 before the bell; drag a name onto another name
to swap. The screen is `src/ui/seating.js`; all the thinking is in `src/systems/chart.js`,
which is pure and headless.

- **`seat` is who you are, `desk` is where you are.** They used to be the same index. The
  authored tell schedule, every test and every system still refer to people by `seat`; the
  chart writes `x` / `z` / `bodyZ` / `col` / `row` onto the student and everything downstream
  (tells, Room Temp quadrants, collision, reactions) reads that.
- **Sightlines.** `src/systems/sightlines.js` asks the raycast's question on paper — segment
  against rectangle — and shades every desk *clear / partial / blind* from the three places
  you actually stand (`data/room.json` → `viewpoints`). Hovering a desk tells you where you
  would have to walk.
- **Reach.** Side by side 1.0, in front/behind 0.8, diagonal 0.55, threshold 0.5. A whisper
  needs a neighbour; a note does not. Separate a whisper pair and **they do not become saints**
  — the instigator does something quieter and easier to see (a `PHONE`, 85% of the life), which
  is the actual teacher move: you cannot remove the trouble, you can choose its shape and where
  it sits. A note passed one desk over becomes a handoff at 70% life, i.e. easier to miss.
- **Stabilisers.** Hidden `steady` per student. If the steadiest neighbour clears the
  threshold, the tell **never spawns**. Nothing appears, nothing is scored, no toast. You find
  out in the report. It costs the stabiliser: `steadyLoad` scales their comprehension gain
  down and the report names them and gives their number.
- **The front row.** ×1.10 / ×1.00 / ×0.88 on delivery gain. Four seats.
- **"We JUST moved."** Two moved seats are free; past that it is Rapport, capped at −7. A chart
  they have never sat in is not a move.
- **Discovery.** Volatility edges and stabilisers are drawn only after you have watched them
  (`learnFrom` at the bell). Persisted with `src/persist.js` — the only `localStorage` in the
  project, degrading to memory if the browser refuses. Namespaced per period since T6.

**T5 — Classroom builder.** Drag the cabinet and bookshelf on the chart plan
(`ui/seating.js`); every desk's `clear`/`partial`/`blind` shading recomputes live
(`chart.js` → `moveOccluder`, `sightlines.js` → `classifySight`, unchanged). Confirming
the chart moves the real 3D furniture to match (`main.js` → `beginPeriod()`), so it's
not a paper-only preview — the raycast and collision for the rest of the period reflect
whatever you built. Persists across periods (`localStorage` key `occluders`) because
the room is shared physical state, unlike the roster-specific chart and discoveries.

**T6 — Second period.** `main.js`'s `startPeriod(index)` rebuilds everything that
depends on a period's own data (room, chart, roster, lesson, Room Temp, tell schedule)
against a fresh `createState()`, while the renderer, camera, materials, and the
seating-screen UI stay session-level. A `PERIODS` list names each period's data
folder (`./data`, `./data/period2`); the report screen's "Next period" button calls
`startPeriod` on the next one directly. Starting comprehension is always fresh
(`createState()` every period) — nothing carries mastery forward. What *does* carry
forward: the room's furniture (T5, shared), and each period's own chart/discoveries
(namespaced, not shared with a different roster).

**T8 — Whisper audio.** `audio.js` runs one persistent filtered-noise-plus-crackle
voice through a `StereoPannerNode`, silent by default. `main.js` finds the live
`WHISPER` tell each frame (if any — the schedule never runs two at once) and feeds it
a pan (camera yaw vs. the tell's world position) and a distance falloff
(`CFG.whisper.range`/`panSpan`), gated entirely on `state.withitness`. Room noise
otherwise; a directional, placeable murmur once you're scanning.

**Audio.** HVAC bed, ambient murmur scaling with restlessness and ducking under Withitness,
chair scrapes on reactions, a chime on checks, the bell, and now the whisper voice (T8).

**Tests.** `tests/smoke.mjs` — 150 headless assertions over interventions, the lesson, the
reaction wiring, Room Temp, the chart, and T5's occluder-drag sightline recompute.
`tests/balance.mjs` — five play styles through whole periods for *both* periods, plus one
style across three different charts for period 1.

---

## Where the balance sits

Period 1 unchanged from before T5/T6/T8 — nothing in the balance-relevant systems
was touched by any of the three tickets.

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

Period 2 (new this session — its lesson was authored to fill the full period, unlike
period 1's, see gap 1 below):

```
ideal (never scans)         mastery 78  fidelity 84  bandwidth 19  restless 72  missed 7
the good teacher             mastery 79  fidelity 79  bandwidth  0  restless  0  missed 0
the hypervigilant            mastery 13  fidelity 57  bandwidth  0  restless  0  missed 0
the wanderer                  mastery 53  fidelity 53  bandwidth 54  restless 14  missed 0
never checks, never looks    mastery 56  fidelity 70  bandwidth 55  restless 93  missed 7
```

Close enough to period 1's numbers across every style that the new lesson/roster
aren't accidentally easier or harder — that was the point of running the harness
against both.

---

## Known gaps in the slice

1. **Period 1's lesson is still 2,000 game-seconds against a 2,820-second period**
   (period 2's is 2,150 + 670 filler = the full period, deliberately, this session).
   Settling period 1 to match is still a live tuning call, not done here.
2. **Tell meshes are still placeholders.** Boxes and spheres.
3. **Mobile is still untested.**
4. **The comprehension aura is a torus over every head.** Fine at a glance, bad in a crowd.
5. ~~Whisper audio does not exist.~~ Closed this session (T8) — see above. It's an
   impressionistic crackle/murmur, not transcribable speech; the treatment's "subtitles"
   idea is unaddressed and would be new scope (voice synthesis or recorded dialogue),
   not a fix to this ticket.
6. **Beats and tells are hand-authored and never vary**, now across two periods'
   worth of content instead of one.
7. **T4: the front row's advantage is small enough to hide.** Don't decide this without
   running `SPREAD=1 node balance.mjs`.
8. ~~T4: no desk in this room is fully blind.~~ T5 makes it reachable — wall one off
   from every viewpoint and it goes blind — but the August layout itself, un-dragged,
   still doesn't produce one by default. That's still correct given the authored
   furniture; nothing forces a player to ever create one.
9. **T6 shares one whisper voice across the whole session.** Fine today because no
   authored schedule (period 1 or 2) ever runs two `WHISPER` tells at once. If a
   future period's schedule did, they'd share the one voice rather than layer, which
   would read as one whisper jumping position, not two.
10. **Old period meshes aren't explicitly disposed** when `startPeriod` tears one
    down (T6) — they're dropped from the scene graph and left to the garbage
    collector, not `geometry.dispose()`'d. Fine for two periods in one tab; would
    want a real cleanup pass if periods become open-ended.
11. **T5/T6/T8 were not exercised in a real browser this session** — the sandbox
    blocked the CDN `three.js` load, so verification was headless-tests-only. See
    "This session" above.

---

## Backlog (suggested order)

**T7 — The Observation.** *Next up.* The boss fight. Admin Proximity Alert, nine-second
window, rubric look-fors, post-conference dialogue tree. Treatment §6.1. Bigger and more
narrative/content-heavy than T5/T6/T8 — probably wants its own session, and likely some
up-front decisions about the dialogue tree's shape before diving into code.

Nothing else is queued past T7 in the treatment's suggested order; re-read
`docs/BELL-TO-BELL-treatment.md` §6 once T7 lands to decide what's next.

---

## Open questions

- Tell and beat authoring vs. generation: keep authoring for now — period 2 was
  hand-authored the same way period 1 was.
- Does the period need a fail state? Still no.
- Should Room Temp reveal direction at all? Still unchanged.
- Is suppression too strong? Watch whether players find "the barometer in the middle of the
  back row" and never move her again. If they do, the fix is probably a per-period limit on
  how much one kid can absorb, not a nerf to the effect.
- Subject choice reskins hazards. Not worth touching yet.
- Mobile. Still undecided.
- **Whisper audio's "intelligible fragments" / live subtitles** (treatment) vs. what got
  built (a procedural, non-verbal crackle bed): is literal transcribed dialogue actually
  wanted later, and if so, is that recorded voice lines or synthesized speech? Either is
  a real scope decision, not a follow-up to T8 as shipped.

## How to pick up in Claude Code

Point it at the repo root and give it a ticket, not the whole project:

> Read CLAUDE.md and docs/HANDOFF.md. Implement T7 (The Observation). Run
> tests/smoke.mjs and tests/balance.mjs when you're done and tell me what you changed.

Don't open with "figure out what to do" — the backlog already decided, and an agent given an
open brief on a large repo will refactor things that were working.
