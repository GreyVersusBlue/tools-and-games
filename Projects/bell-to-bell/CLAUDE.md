# CLAUDE.md — working agreement for this repo

## What this is
`Bell to Bell`, a 3D browser game about teaching. Currently one vertical slice:
a single 47-minute class period. Read `docs/BELL-TO-BELL-treatment.md` for the full
design vision and `docs/HANDOFF.md` for current state and the backlog.

## Commands
```bash
python3 -m http.server 8000     # run it (ES modules need a server)
cd tests && node smoke.mjs      # headless logic checks — run before you claim done
cd tests && node balance.mjs    # whole-period sim — run after touching config or lesson data
node --check src/<file>.js      # syntax check a module
```
No build step, no package manager, no `node_modules`. three.js comes from the import
map in `index.html`. Keep it that way unless there is a real reason not to.

`src/persist.js` is the only thing that writes to `localStorage`, and it degrades to
an in-memory store if the browser refuses. Nothing else may reach for storage.

## Architecture rules
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

## Voice
Flavor text is deadpan, specific, and written for someone who has actually taught.
Match the register in `data/interventions.json` and the event cards in the treatment.
No exclamation points except from the sub and the intercom.

## Working style
Take one backlog ticket at a time and get it to a runnable state before starting the
next. Prefer iterative refinement over rewriting a system that works. When a change
touches both data and code, do the data shape first.
