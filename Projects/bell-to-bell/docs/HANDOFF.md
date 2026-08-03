# HANDOFF — Bell to Bell

**Where we are:** T1–T8 built and playable (One Period, the lesson, Room Temp, the
seating chart, the classroom builder, a second period, whisper audio, the
Observation). Where we're going: a freshly drafted T9–T16, all still deepening the
same 47-minute slice — see the Backlog section for the list and suggested order.

Read `CLAUDE.md` first — it has the commands and the architecture rules.
Read `docs/BELL-TO-BELL-treatment.md` for anything about a system that isn't built yet.

---

## This session — T7

**T7 — The Observation.** The boss fight, built close to the treatment's own example
card (§9.2, "THE OBSERVATION YOU WERE NOT TOLD ABOUT") rather than invented fresh —
that card already specified the alert, the nine-second window, the four choices, and
the post-conference exchange almost verbatim.

- **`data/observation.json`** (and `data/period2/observation.json`, its own scripted
  moment for the second roster — Milo instead of Kayla, wait-time instead of
  engagement, a different scripted minute). Content-driven per CLAUDE.md: the alert
  copy, the four window actions with their effects and an optional `solo` flag, and
  the post-conference `prompts`/`followUps` tree all live in data, not code.
- **`src/systems/observation.js`** (new factory, `createObservation`) is a small state
  machine — `idle → window → conference → idle`. It fires once per period at a
  scripted `atMinute` (checked against `state.t`, the same pattern `systems/events.js`
  already uses), then runs a **real-time** countdown (`tick(state, dt)` uses the
  frame's actual `dt`, not the ×10 game clock — the treatment's "9 seconds" is meant
  to be 9 real seconds of reflexes, not 90 game-seconds of thinking time). Up to
  `maxPicks` (2) actions can be picked before time runs out; picking the `solo` one
  ("Do nothing. Teach the lesson.") ends the window immediately, matching the
  treatment's framing that it's a complete choice on its own, not one of two. Either
  way it flows into the post-conference dialogue — a linear prompt queue where a
  choice can enqueue a `followUp` prompt ("you now owe a follow-up"), which is as much
  "tree" as the treatment's own example actually shows.
- **UI-wise, nothing new was built.** The alert reuses the existing `#pa` banner
  (`dom.pa`/`paTitle`/`paTxt`) — the same element the scheduled intercom event already
  uses — and both the window and the conference reuse `openMenu`/`closeMenu`
  (`ui/menu.js`), which already had exactly the shape needed (header, body, a list of
  buttons, a callback). The one change there: `openMenu` now accepts an optional
  `spec.footer` so the observation can show "9 seconds. Pick 2." instead of the
  intervention menu's default "ESC to close" line, which would have been actively
  wrong here (see below).
- **Gating.** While the observation is active (`observation.active()`), E/Q/R/T are
  blocked (same mechanism as an open tell menu), a tell can't be clicked open on top
  of it, and ESC does nothing — you can't dismiss an unannounced observation by
  pressing Escape. Movement and Withitness are *not* blocked, matching how an open
  tell menu already doesn't block them either.
- **`main.js`**: `observation` joins the per-period `let` bindings (rebuilt in
  `startPeriod`, so period 2 gets a fresh one that can fire on its own schedule), and
  `observation.tick(state, dt)` runs every frame next to `events.tick(state)`.
- **Tests**: `tests/smoke.mjs` mocks `dom`/`openMenu`/`closeMenu` and injects a
  synchronous `schedule` (real code defaults to `setTimeout`, tests pass `fn => fn()`
  so the 900ms bridge-to-conference pause doesn't cost real wall-clock time in a
  headless run) — 13 new assertions covering the trigger timing, action effects,
  the solo-action short-circuit, `maxPicks`, the follow-up branch, and the return to
  idle. 163 assertions total, all green.

**Not verified in a real browser** — same limitation as last session: this sandbox
blocks the CDN `three.js` load (`cdn.jsdelivr.net`, 403 from the egress proxy), so
there was no way to click through the actual alert banner, watch the countdown, or
click through the conference in a live page. Worth a real pass —
`python3 -m http.server 8000`, teach until the scripted minute (30 in period 1, 12 in
period 2) — before trusting the feel of the countdown or the menu transitions beyond
what the headless state-machine tests cover.

---

## Built and working

**The room and the seeing**
- 3D classroom, first-person teacher, WASD + drag-look, collision against desks and furniture
- 12 students from `data/students.json`, each with a `tension`, an `aptitude` and a `steady`
- **Withitness**: thermal material swap, CSS overlay, sub-bass drone, heartbeat, rubric-box
  tell annotations
- **Line-of-sight blind spots**: raycast against occluders defined in `data/room.json`,
  draggable on the chart screen (T5)
- 6 tell types (PHONE, NOTE, WHISPER, COPYING, FALSE, QUIET) on an authored schedule
- **Intervention menu** driven entirely by `data/interventions.json`, with per-type overrides,
  proximity gating, coinflip outcomes, and escalation
- **Hypervigilance** → false positive spawn → the granola bar
- **The curveball** (QUIET) at minute 21, unscored, different menu
- Scheduled intercom event, four meters, room-temp bands, four endings, end-of-period report
- **The Observation** (T7): a scripted Admin Proximity Alert, once per period
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
depends on a period's own data (room, chart, roster, lesson, Room Temp, tell schedule,
the observation) against a fresh `createState()`, while the renderer, camera,
materials, and the seating-screen UI stay session-level. A `PERIODS` list names each
period's data folder (`./data`, `./data/period2`); the report screen's "Next period"
button calls `startPeriod` on the next one directly. Starting comprehension is always
fresh (`createState()` every period) — nothing carries mastery forward. What *does*
carry forward: the room's furniture (T5, shared), and each period's own
chart/discoveries (namespaced, not shared with a different roster).

**T7 — The Observation.** `systems/observation.js` — see "This session" above.

**T8 — Whisper audio.** `audio.js` runs one persistent filtered-noise-plus-crackle
voice through a `StereoPannerNode`, silent by default. `main.js` finds the live
`WHISPER` tell each frame (if any — the schedule never runs two at once) and feeds it
a pan (camera yaw vs. the tell's world position) and a distance falloff
(`CFG.whisper.range`/`panSpan`), gated entirely on `state.withitness`. Room noise
otherwise; a directional, placeable murmur once you're scanning.

**Audio.** HVAC bed, ambient murmur scaling with restlessness and ducking under Withitness,
chair scrapes on reactions, a chime on checks, the bell, and the whisper voice (T8).

**Tests.** `tests/smoke.mjs` — 163 headless assertions over interventions, the lesson, the
reaction wiring, Room Temp, the chart (including T5's occluder-drag sightline recompute),
and the observation's state machine (T7). `tests/balance.mjs` — five play styles through
whole periods for *both* periods, plus one style across three different charts for period 1.

---

## Where the balance sits

Unchanged from last session — T7 doesn't touch the lesson/tell/chart loop
`tests/balance.mjs` simulates, the same way the scheduled intercom event isn't in that
harness either. Re-run `node balance.mjs` after touching `config.js` or any
`lesson.json`.

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

Period 2 tracks the same shape within a couple of points on every style — see the
previous handoff entry in git history for the exact numbers if you need them.

---

## Known gaps in the slice

1. **Period 1's lesson is still 2,000 game-seconds against a 2,820-second period**
   (period 2's is 2,150 + 670 filler = the full period). Settling period 1 to match
   is still a live tuning call, not done here.
2. **Tell meshes are still placeholders.** Boxes and spheres.
3. **Mobile is still untested.**
4. **The comprehension aura is a torus over every head.** Fine at a glance, bad in a crowd.
5. **Beats and tells are hand-authored and never vary**, now across two periods'
   worth of content instead of one.
6. **T4: the front row's advantage is small enough to hide.** Don't decide this without
   running `SPREAD=1 node balance.mjs`.
7. **T6 shares one whisper voice across the whole session.** Fine today because no
   authored schedule (period 1 or 2) ever runs two `WHISPER` tells at once.
8. **Old period meshes aren't explicitly disposed** when `startPeriod` tears one
   down (T6) — dropped from the scene graph, left to the garbage collector. Fine for
   two periods in one tab; would want a real cleanup pass if periods become open-ended.
9. **T7's post-conference feedback is static regardless of what you picked in the
   window.** The AP's opening line and the choices don't branch on which look-fors you
   satisfied — a real dialogue tree would probably want that. Shipped this way because
   the treatment's own example doesn't tie them together either, but it's the most
   obvious next depth pass on this ticket specifically, if it gets one.
10. **T7 fires exactly once per period, at a fixed scripted minute** — not randomized,
    not repeatable, no "unannounced vs. walkthrough vs. just the attendance thing"
    distinction the treatment's Admin Proximity Alert section describes as an upgrade
    path. That's meta-progression (§8), out of scope for a one-period slice.
11. **Nothing in this slice has been exercised in a real browser** across T5–T8 — the
    sandbox these last two sessions ran in blocks the CDN `three.js` load. Headless
    tests are green; a human should still click through it once.

---

## Backlog

T1–T8 (the last several handoffs' entire queue) are built. This next batch, T9–T16,
is drafted rather than committed to — sized and ordered, but check them against what
you actually want before handing one to an agent. All of them deepen the existing
47-minute slice; none require the day/year structure the treatment describes in §6/§8
(see "the big one" in Open Questions below — that's still a separate, unresolved
scope call, deliberately not folded into this list).

**T9 — Settle period 1's lesson length.** Closes gap 1. Period 1's authored beats
(2,000s) + filler (700s) still fall 120s short of the 2,820s period; period 2's
lesson was written to fill it exactly. Pure `data/lesson.json` + `src/config.js`
tuning, checked with `node balance.mjs` before/after. Smallest ticket here — good
first pick if you want a fast, low-risk one.

**T10 — Branch the post-conference on what you picked.** Closes gap 9. Right now
AP Reyes's post-conference in T7 opens with the same line and the same three choices
regardless of which look-fors you satisfied in the window (or whether you did nothing
at all). Give `data/observation.json`'s `conference.prompts` a way to pick a variant
opening line keyed off `picked` (e.g. a `when: { anyOf: [...] }` on a prompt, first
match wins, same shape as `data/events.json`'s `endings.when`), and have
`systems/observation.js` pass the window's `picked` list into prompt selection. Small,
touches code you just wrote for T7, no new UI.

**T11 — The Hallway Ear.** A new passive "other sense" from treatment §3.7, and a
nice thematic setup for T7: a different ambient audio signature through the closed
door for "a fight," "a spill," "an administrator," and "nothing, they're just like
that," playing a few real seconds *before* T7's Admin Proximity Alert fires — the
game rewarding you for noticing the sound before the banner tells you. Audio-only,
same procedural-synthesis approach as T8 (a new bed in `audio.js`, gated on nothing —
it's passive and always on, unlike Withitness-gated whisper audio). No visual
component. Needs one content decision: does it play for *every* scheduled event
(intercom included) or only ahead of the Observation? Recommend Observation-only for
v1 — the intercom already announces itself.

**T12 — Assignment Ghosting.** A Tier 3 reveal from treatment §3.3: a faint outline
on an empty desk where homework wasn't done, visible only in Withitness. Needs a
data-driven notion of "did this student do the assigned work" — simplest version:
a student whose comprehension is below some threshold when a beat ends "ghosts" until
the next check. Touches `world/students.js` (a new faint mesh/material swap, must
`registry.add()` per the architecture rule), `systems/lesson.js` (the actual
did-they-get-it signal), and `src/config.js` for the threshold.

**T13 — Rumor threads.** Tier 3, §3.3: glowing filaments between kids showing
information moving through the room, thickness = intensity, visible only in
Withitness and only "unlocked" behaviorally at high Rapport (no skill-tree exists in
this slice, so gate on `state.rapport` crossing a `CFG` threshold, not an unlock
flag). The richest new-content ticket in this batch — needs its own authored
schedule (a new `data/rumors.json`, shaped like `tells.json`'s schedule: who, who,
when, how long) and a new render pass in the 3D world, plan-view sightlines
untouched. Reads as a sibling to T4's volatility edges, not a reuse of them — a
rumor is something happening *now*, not something the chart remembers between
periods.

**T14 — Tell mesh art pass.** Closes gap 2. `systems/tells.js` → `buildMesh` still
draws every tell as a box or sphere except NOTE and COPYING, which get a line. Give
PHONE, WHISPER, FALSE, and QUIET their own distinct low-poly geometry so a glance at
the thermal view reads tell-type without opening the label. Pure 3D-asset work, no
new mechanics, no data changes — the natural "clean up placeholders" ticket once the
mechanical backlog (T9–T13) is closed enough that new visual noise stops arriving.

**T15 — Redesign the comprehension aura.** Closes gap 4. The torus-over-every-head
is "fine at a glance, bad in a crowd" per the existing gap note — worth a real
before-you-build decision, not just an agent's guess: a floor ring under the desk
instead of a head-height torus, a HUD side-list of names+colors, or something else
entirely. Flag this one for a quick design conversation before assigning it, unlike
the others.

**T16 — Mobile pass.** Closes gap 3, still "still undecided" in Open Questions below.
Touch controls (drag-look already exists for touch per `input.js`'s `touchstart`/
`touchmove` handlers — untested, not built from nothing), responsive HUD/menu
layout, and the seating chart's drag interaction on a touchscreen. Cross-cutting
enough to want its own dedicated session rather than slotting between the others.

---

## Open questions

- Tell and beat authoring vs. generation: keep authoring for now.
- Does the period need a fail state? Still no.
- Should Room Temp reveal direction at all? Still unchanged.
- Is suppression too strong? Watch whether players find "the barometer in the middle of the
  back row" and never move her again. If they do, the fix is probably a per-period limit on
  how much one kid can absorb, not a nerf to the effect.
- Subject choice reskins hazards. Not worth touching yet.
- Mobile. T16 is drafted; still an open question whether it's worth doing before the
  bigger scope question below.
- Whisper audio's "intelligible fragments" / live subtitles (treatment) vs. what got
  built (T8, a procedural, non-verbal crackle bed): real scope decision if literal
  transcribed dialogue matters later.
- **The big one:** T9–T16 all stay inside "One Period" and keep adding depth. Whether
  to start building the day/year structure the treatment describes around it instead
  (or after) is still a separate, unresolved scope call. Needs a person, not an
  agent's guess.

## How to pick up in Claude Code

Point it at the repo root and give it a ticket, not the whole project:

> Read CLAUDE.md and docs/HANDOFF.md. Implement T9 (settle period 1's lesson
> length). Run tests/smoke.mjs and tests/balance.mjs when you're done and tell me
> what you changed.

Don't open with "figure out what to do" — the backlog already decided, and an agent
given an open brief on a large repo will refactor things that were working.
