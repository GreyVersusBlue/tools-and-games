# CLAUDE.md — working agreement for this repo

## What this is
`Bell to Bell`, a 3D browser game about teaching. Currently one vertical slice:
a 47-minute class period, run four times a day (4th hands off into 5th into 6th
into 7th, same room, different kids, one Bandwidth pool), five days a week. The
7th period's twelve kids are generated from a seed; the other three are authored.
The semester record carries each class's comprehension, Rapport and Fidelity
across nights, and admin escalates on sustained low Fidelity. Read
`docs/BELL-TO-BELL-treatment.md` for the full design vision and `WISHLIST.md` for
current state and the backlog.

## Commands
```bash
python3 -m http.server 8000     # run it (ES modules need a server)
cd tests && node smoke.mjs      # headless logic checks — run before you claim done
cd tests && node balance.mjs    # whole-period sim, the 50-seed generator soak (asserts), and a week
cd tests && SOAK=500 node balance.mjs   # more seeds through the generator
cd tests && node assets.mjs     # what Assets/ weighs, and what of it the game opens
node --check src/<file>.js      # syntax check a module
```
No build step, no package manager, no `node_modules`. three.js is vendored in
`libs/` and `index.html`'s import map points at it — the project makes zero
offsite requests and Phase 6 is where that became true. Adding a `three/addons/`
import means vendoring the file beside the others; `smoke.mjs` fails if you do
not.

`src/persist.js` is the only thing that writes to `localStorage`, and it degrades to
an in-memory store if the browser refuses. Nothing else may reach for storage.
Period-scoped keys go through `slot(periodId, key)` and day-scoped ones through
`dayKey(key)`; nothing writes a key name by hand. The six flat pre-slot keys
migrate on read, once, and `migrateLegacyKeys` is never to be rewritten. The
semester record is the global `semester` key, versioned from day one and run
through `semester.repair` on every load; a generated period's seed is the slot key
`seed`. `furniture` and `period` stay global.

## Architecture rules
- **A period is a row in `data/periods.json`, not a branch in a `.js` file.**
  Presentation fields are literal; `roster`, `schedule`, `lesson`, `seatGrid` and
  `seatingCopy` are pointers of the form `file.path.into.that.file`, and
  `src/loader.js` fetches whatever files the rows name. Adding a period must stay
  a JSON edit. If it ever needs a JavaScript one, the seam has moved.
- **A generated period is still a row.** `"generate": true` and no roster or
  schedule pointer; the kids and their schedule come from `src/systems/generate.js`
  off the slot's seed and the day, against `data/generation.json`. The generator
  never touches `Math.random` (everything draws from `systems/rng.js`), the roster
  is a function of the seed alone, and a schedule is accepted only after
  `systems/simulate.js` has played it through the banded styles. A band miss
  re-rolls the schedule and never the roster.
- **The semester record is pure.** `systems/semester.js` takes a finished period
  and hands back what the next one opens with; `main.js` never does date
  arithmetic, never decays a number, and never decides what admin does.
- **Content goes in `data/`, logic goes in `src/`.** If you are about to hardcode a
  student name, a piece of flavor text, a meter delta, or a tell schedule inside a
  `.js` file, stop and put it in JSON instead. The test: could a teacher with no
  JavaScript add a new random event by editing one file? It should stay yes.
- **Tuning constants go in `src/config.js`.** Not inline.
- **Systems are factories** (`createTellSystem`, `createWithitness`, ...) that take
  their dependencies as an argument object and return functions. No module-level
  mutable state, no singletons except `src/ui/dom.js`.
- **Anything added to the 3D scene must be registered** with the material registry
  (`registry.add(mesh)`) or it will not swap into thermal view during Withitness.
  The exception is what the *vision* draws rather than what the room contains —
  the note's route line, the copying thread, the comprehension aura. Those are
  inferences, not objects: they live in a tell group's `vision` bucket or are
  unregistered on purpose, with the comment saying so.
- **A module under `src/` imports three from `./three.js`, never as `'three'`.**
  The bare specifier only resolves against the import map, so a file that uses
  it cannot be loaded by a test. That is why `systems/tells.js` went its whole
  life unexecuted.
- **`src/ui/` never imports from `src/systems/`.** UI takes data in and calls back out.
- Keep `main.js` as wiring and the frame loop. Logic belongs in a system.

## Design constraints that are not up for renegotiation
These are locked. Do not "improve" them without asking.
1. Withitness costs Bandwidth **and** drains Mastery while active — looking is not free.
2. Hypervigilance produces false positives; it never disables the ability.
3. Furniture casts real line-of-sight blind spots. Do not replace the raycast with a
   distance check.
4. Proximity is free, boring, and the most effective intervention. Do not buff it.
5. The curveball tell (`QUIET`) is never scored. No "Empathy +3". It changes the menu
   options quietly and awards nothing.
6. Kids are never the joke. Bureaucracy is sincere, not villainous.
7. Mastery is the mean of twelve comprehension values, not a bar. Nothing writes
   `state.mastery` directly — effects that claim to cost Mastery go through
   `state.masteryPending` and the lesson system spends them across the room.
8. Room Temp never names a kid. It reads bands and quadrants. Naming is what the
   expensive ability is for.
9. **A student's identity and a student's position are different things.** `seat` is
   who they are (their index in the roster, and what every schedule and test refers
   to); `desk` is where the chart put them. Nothing may go back to assuming they are
   the same number.
10. **Suppression is silent.** When a steady neighbour absorbs something, no tell
    spawns, nothing appears, and no toast fires. The player finds out in the report or
    not at all. Do not add an in-period tell for it.
11. **The curveball is never suppressed and never separated.** `QUIET` is flagged
    `suppressible: false` in `data/tells.json` and no seating arrangement may remove it.
12. The seating chart labels nothing you have not watched happen. Volatility edges and
    stabilisers are drawn from what the last period taught you (`learnFrom`), never
    from the roster data that defines them.
13. **Bandwidth is the one meter that crosses the bell within a day.** It is a fact
    about how much day you have already taught: it carries in `dayKey('bandwidth')`,
    the hallway gives back `CFG.day.passingPeriodRecovery`, no more, and only a new
    day fills it. Mastery, Fidelity, Rapport and Restlessness are facts about
    walking into a room, so at every bell they reset to what *that class* walked out
    with last time, minus a night (`systems/semester.js`), or to `CFG.start` on a
    class's first day. Restlessness never carries. Do not add a second within-day
    carried meter without saying why the treatment's line stops applying to it.
14. **The record stores twelve values, never a Mastery scalar.** Constraint 7 holds
    across nights the way it holds across a period: the class entry in the semester
    record carries `comp[]` by seat and a baseline to relax toward, and the only
    `mastery` number anywhere in the record is the day line the Friday Report reads.
15. **A tell is an object in the room, and the vision is what tells you what it
    is.** Treatment §3.3's Tier 1 / Tier 2 split. The phone, the note and the
    angled paper are physical: dark, small, low, and drawn whether or not SHIFT
    is held. What Withitness adds is the thermal swap and the inference — the
    route line, the thread, the annotation. Do not move an object into the
    vision bucket to make it easier to see, and do not make an inference
    permanent to make it easier to find.
16. **The roster is the seed alone.** Same seed, same twelve kids, on Tuesday and in
    week six. The tell schedule is the seed plus the day. A class the band check
    cannot fit is a loud error, not a quiet easy period, and nothing re-rolls the
    roster to make the numbers land.

## Voice
Flavor text is deadpan, specific, and written for someone who has actually taught.
Match the register in `data/interventions.json` and the event cards in the treatment.
No exclamation points except from the sub and the intercom.

## Working style
Take one backlog ticket at a time and get it to a runnable state before starting the
next. Prefer iterative refinement over rewriting a system that works. When a change
touches both data and code, do the data shape first.
