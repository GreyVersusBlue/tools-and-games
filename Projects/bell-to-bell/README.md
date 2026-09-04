# Bell to Bell

A 3D browser game about being a classroom teacher. This repo currently contains
**Slice 001 — "One Period"**: a 47-minute class period, one room, twelve students,
and the mechanic the whole game is built around — followed, if you take the report
screen's offer, by 5th, 6th and 7th: same room, a different twelve students each
time, on one Bandwidth pool that does not refill until tomorrow. Then tomorrow: the
same four classes walk back in with what they walked out with, minus a night, five
days to a Friday Report. The 7th period's twelve were not written by anyone; they
come out of a seed the report screen prints and the start screen takes back.

## Withitness

*Kounin (1970): "the teacher's awareness of student behavior in all areas of the
classroom at all times."* A real term from teacher prep that happens to describe
Predator vision. Hold SHIFT.

Three things make it a game rather than a cheat button:

1. It drains **Bandwidth**.
2. The lesson does not pause. **Mastery ticks down while you're in it**, because you
   are standing at the front of the room staring at nothing.
3. Overuse raises **Hypervigilance**, which does not disable the ability — it makes it
   generate confident **false positives**. You cross the room. It is a granola bar.

Furniture casts real blind spots. Every reveal runs a line-of-sight raycast against
the storage cabinet and the bookshelf, so some tells can only be seen from somewhere
else in the room. Layout is a sensor problem, not decoration.

## The seating chart

Before the bell you get a paper plan of the room and you can drag names onto other
names. It shades every desk by what you can see from the places you actually stand,
and it tells you nothing else that you have not already watched happen in here.

Where people sit decides four things:

- **Reach.** A whisper needs a neighbour. Separate the pair and they do not become
  saints — the one who started it does something quieter, on their own, in a seat
  where you can find it. A note does not need a neighbour, and one passed a single
  desk over is a handoff you will miss.
- **Who calms whom.** Park the steadiest kid next to the noise and the noise never
  happens. Nothing spawns; there is nothing to see. You find out in the report, along
  with what it cost the kid you used as furniture.
- **The front row.** It learns fastest. There are four seats in it.
- **Line of sight.** You built the blind spot yourself, with a cabinet, years ago.

Volatility edges and stabilisers are drawn on the chart only after you have watched
them happen, and they persist between periods. Change more than a couple of seats
from yesterday's chart and you pay for it in Rapport.

## The lesson

Mastery is not a bar you fill. It is the mean of what twelve people understand, and each
of them has their own number, their own ceiling, and their own rate of getting there.

- **E** advances the lesson a beat. Move on too early and half of them were still writing.
  Sit on a beat too long and you are filling, not teaching.
- **Q** checks for understanding. It costs Bandwidth and it buys you the truth: the
  comprehension aura, green through red, visible only inside Withitness. It goes stale in
  about a minute, so you are always deciding whether you have time to know.
- **R** reteaches. Expensive, gives back beat time, lifts the people at the bottom. Do it
  without checking first and you will reteach the part they already had.

The two halves of the game meet here: **a kid with a phone under the desk is not learning
anything.** That is what the phone actually costs you, and it is why the seeing matters.

## Room Temp

**T** takes one cheap reading of the whole room — a band, a line, and roughly which quadrant
the heat is in. It never names a kid; that is what the expensive ability is for. The readout
is a snapshot, not a live feed, so it ages and then tells you it has aged.

## The Observation

Every period, on no notice: an Admin Proximity Alert gives you nine real seconds, then AP Reyes
is in the room with a clipboard and a rubric. For the next eleven minutes, five look-fors are
worth performing — post the objective (**O**), ask a bigger question (**H**), let them talk to
each other (**G**), hold still and call it wait time (**F**, five seconds) — and one of them,
checking for understanding, you were probably already doing. Being watched costs you something
the whole time regardless of what you do about it; performing the rubric costs something else
and pays out in Fidelity. Afterward, one exchange, three ways to answer it, and the "correct"
one is usually not the cheap one.

## The semester

Every class keeps a record between days: each student's comprehension (twelve
numbers, never one), the Rapport they left with, and admin's running opinion of you,
which is what Fidelity turns into once it is carried. Overnight, what you taught above
where they walked in fades by a fraction and what a bad period took from under it
comes partway back; the weekend costs more than a night. Fidelity drifts back toward
the district mean unless something keeps moving it, and if admin's opinion stays under
a line for enough days running, the calendar answers: a quick check-in, then a second
observation the same week, then a growth plan. None of it is a punishment. Friday
closes with five days of meters and three lines about what changed.

## The class nobody wrote

7th period is generated. One six-digit seed makes the roster; the seed plus the day
makes the tell schedule, so the same kids do something different on Tuesday. Every
promise the hand-written rosters kept without saying so is a rule now (a stabiliser,
a kid at the edge, an aptitude spread, no two names alike on the chart, pair tells on
kids who can reach each other), and a period is accepted only after two crude
teachers have played it headlessly and landed inside the band the authored periods
set. Type a seed into the start screen and you get that class again.

## Running it

ES modules need a server — opening `index.html` from the filesystem will not work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Deploys to GitHub Pages as-is. three.js is vendored in `libs/` and resolved by
the import map in `index.html`, so the page makes no offsite requests; there is
no build step and no `node_modules`.

```bash
cd tests && node smoke.mjs     # headless assertions
cd tests && node balance.mjs   # six styles through whole periods, three charts, the day, a 50-seed generator soak, and a week
cd tests && node assets.mjs    # the asset manifest: referenced, cataloged, unreferenced, and the budget
```

## Layout

```
index.html            shell, HUD markup, import map
libs/                 vendored three.js r160 and the three addons src/ imports
styles/main.css       all styling
data/                 ← content lives here, not in code
  room.json           fixtures, occluders, screens, lights, spawn, teaching zone
  students.json       seat grid + roster (name, shirt, tension, aptitude, steady)
  tells.json          tell types (+ posture, attention) and the authored schedule
  interventions.json  the intervention menu: options, effects, toasts, overrides
  events.json         scheduled events, room-temp bands, endings, report copy
  lesson.json         the beats, what goes on the board, and the lesson's copy
  reactions.json      pose definitions: what a body does and for how long
  seating.json        chart screen copy, the seating rules table, report lines
  periods.json        the school day in order: one row per period, pointing at its content
  period5.json        5th period: its own roster, tell schedule, lesson and chart copy
  period6.json        6th period: the same, for the class that lost Monday
  period7.json        7th period: chart copy only; its kids and schedule are generated
  generation.json     the generator: name pool, distributions, schedule mix, and the bands a period must land in
  admin.json          the week: day names, the escalation ladder, the Friday Report's copy
  observation.json    the Observation: alert/arrival copy, look-fors, the post-conference tree
src/
  config.js           every tuning constant
  state.js            game state + effect application
  loader.js           fetches data/, including whatever periods.json points at
  periods.js          reads the day out of periods.json; periodFor() is a lookup, or a generation
  persist.js          the chart, what you learned, the seed and the semester, between periods; the slot scheme
  input.js            keys, look, movement, collision
  audio.js            drone, heartbeat, bell
  world/materials.js  palette + thermal twins + swap registry
  world/room.js       builds the room from room.json
  world/board.js      canvas-texture whiteboard and objective board
  world/students.js   bodies, the reaction tween, comprehension auras
  systems/chart.js    the seating chart: desks, reach, suppression, discovery
  systems/sightlines.js  line of sight in plan view, for the chart screen
  systems/tells.js    tell lifecycle, meshes, line of sight
  systems/withitness.js  the mode toggle and its costs
  systems/lesson.js   beats, comprehension, checks, reteach  ← owns Mastery
  systems/roomtemp.js the cheap whole-room reading
  systems/meters.js   per-frame meter math, teaching zone
  systems/interventions.js  menu construction + outcome resolution
  systems/events.js   scheduled interruptions
  systems/observation.js  the alert, the rubric window, the look-fors
  systems/rng.js      seeded randomness; the generator never touches Math.random
  systems/roster.js   twelve kids out of a seed, and the promises a roster keeps
  systems/scheduler.js  a tell schedule out of a roster, and the promises it keeps
  systems/simulate.js the period, headless: what balance.mjs and the band check both run
  systems/generate.js roster + schedule + the band check + the reroll
  systems/semester.js the record: what a class walks in with, and what a night does to it
  ui/                 dom refs, hud, labels, menu, toast, report, seating, conference, week
  main.js             wiring and the frame loop
tests/smoke.mjs       headless assertions
tests/balance.mjs     full-period simulation across play styles, the generator soak, a week
```

## Adding content without touching code

Most of what this game needs next is content, and content is data:

- **A new tell type** — add an entry to `data/tells.json` → `types`, then schedule it
  in `schedule`. Give it an `anchor` of `seat` or `pair`. If it needs a custom mesh,
  that's the one code change (`src/systems/tells.js` → `buildMesh`).
- **A seating rule** — `data/seating.json` → `rules`: how close counts as adjacent,
  how steady a neighbour has to be to absorb something, what a separated pair does
  instead. The numbers that balance against the rest of the game are in
  `src/config.js` → `seating`.
- **A new intervention** — add it to `data/interventions.json` → `options` and include
  its key in `defaultOptions` or a `byType` list.
- **A new lesson beat** — add an entry to `data/lesson.json` → `beats`: a label, the line
  you say, what goes on the whiteboard, how long it should take, and how fast it lands.
- **A whole new period** — write `data/period8.json` with a `roster`, a `schedule`, a
  `lesson` and a `seatingCopy` (copy `period6.json` and start editing), then add a row
  to `data/periods.json` pointing at it and set the period before it to hand off to it.
  That is the entire job: no `.js` file is involved, `src/loader.js` fetches whatever
  the new row names, and both test suites pick the period up on their own. Or leave
  the roster and schedule out, give the row `"generate": true`, and the class is drawn
  from a seed instead (`period7.json` is that: chart copy and nothing else).
- **A new name, a new note, a different mix of tells** — `data/generation.json`. The
  name pool, the notes a generated kid can carry, how many of each tell type a period
  gets, how long each lives, and the bands a generated period has to land inside.
- **A new rung on admin's ladder** — `data/admin.json` → `escalation.ladder`: the line
  Fidelity has to be under, for how many days running, what it costs at the bell, the
  PA that fires, and the line the Friday Report says about it.
- **A new reaction** — add a pose to `data/reactions.json`, then name it in an intervention's
  `reaction` field or a tell type's `posture` field.
- **Retuning difficulty** — `src/config.js`. Nothing else. Then run `tests/balance.mjs`.
- **New flavor text** — `data/events.json` and the `toast` blocks in
  `data/interventions.json`.
- **A new post-conference response** — add an entry to `data/observation.json` →
  `conference.options`: the line, the blurb, its effects, and what she does with it.
  A one-shot look-for (as opposed to the held wait-time key) needs a matching key in
  `src/config.js` → `keys` and a dispatch line in `main.js`'s action loop.

## Design docs

`docs/BELL-TO-BELL-treatment.md` is the full creative treatment (subjects, classroom
builder, bureaucracy, multi-year arc). `WISHLIST.md` is the working state, open
questions, and the backlog.
