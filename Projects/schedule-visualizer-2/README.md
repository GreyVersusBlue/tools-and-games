# Schedule Visualizer 2

A planning tool for a school building. One person draws the building once and
enters where each group of students is in each period. The tool then answers
the questions that are otherwise guesswork: where the crowds form between
classes, which groups cannot reach their next class in the passing time, what
happens to the hallways if a class moves, whether any room or teacher is
double-booked, how each room gets out in an emergency, and where a teacher is
right now.

It has two faces. **The planner** is for the one or two people who build the
schedule. **The staff browser** is a read-only lookup published from the
planner for the whole staff, used mostly on a phone in a hallway.

Everything is stored on the device and in files the user exports. There is no
account, no analytics and no request to any other site. The tool knows groups
of students (a name and a head count), never individual students. All sample
and test data is invented.

## What is here so far

This folder is being built in units. The planner opens, saves, undoes, and has
its Building section: the floor plan can be drawn by pointer, by keyboard and
by touch. The schedule's rules, the routing, the crowd model and the checks
are built and tested and wait for their screens.

| Path | What it is |
|---|---|
| `index.html` | The planner |
| `engine/schema.js` | The data model: constants, ranges, defaults, `newProject(ids, clock)`, how a room is named |
| `engine/ids.js` | Ids, from a random source that is passed in |
| `engine/validate.js` | `validate(project)` gives a list of findings `{ path, message }` |
| `engine/migrate.js` | Brings an older project up to the current version; refuses a newer one |
| `engine/repair.js` | Runs on every load; turns any object into a valid project and says what it changed |
| `engine/actions.js` | Every change as a pure function `(project, payload, ctx) → project` |
| `engine/history.js` | Undo and redo, 200 steps |
| `engine/store.js` | Holds the current project; `apply`, `undo`, `redo`, `subscribe`, `derived` |
| `engine/day-types.js` | The one rule for a day type that is "the same as A Day" |
| `engine/bells.js` | Period names, time formatting, passing times, bell schedule checks |
| `engine/building.js` | The floor plan's geometry: place, erase, move, resize, doors, stairs, exits, zones |
| `engine/graph.js` | The walkable graph of a building, and the cells each room is entered through |
| `engine/building-checks.js` | What is wrong or unfinished in the building, as findings |
| `engine/routing.js`, `engine/directions.js` | The route between two rooms, and the same route in words |
| `engine/load.js`, `engine/places.js` | How many cross each corridor cell, and what each stretch of corridor is called |
| `engine/crowd.js` | The crowd model: how long each walk takes with everybody else in the corridor |
| `engine/teacher-day.js` | The one rule for what a teacher is doing in each period |
| `engine/checks.js` | The schedule checks: double-bookings, walks that do not fit, and the rest |
| `engine/findings.js` | What every check shares: severities, how a finding's id is built, the words of a sentence |
| `engine/csv.js` | Reading and writing CSV: quotes, line breaks inside quotes, byte-order marks, any line ending |
| `engine/import-groups.js`, `engine/import-teachers.js` | Groups and teachers from a CSV file |
| `engine/exports.js`, `engine/project-file.js` | Every export, and the project, building and schedule files |
| `engine/worker.js` | Everything derived from the project, worked out in a worker |
| `engine/publish-defaults.js` | The staff passcode a new project starts with, in a module the published file never carries |
| `storage/` | The project on this device: autosave, recovery points, a second tab |
| `ui/` | The planner's shell, its sections and the drawing surface |
| `data/sample-school.js` | Marrowby Middle School, an invented school with a problem and a warning to find |
| `data/subjects-starter.js` | The subject list a new project starts with |
| `FORMATS.md` | Every file format the tool reads or writes |
| `test/` | The tests |

Everything under `engine/` is pure: no page, no storage, no timers, no clock
and no randomness of its own. Time and ids are passed in, so the same input
always gives the same output. A test fails if that stops being true.

## How to open it

Serve the repository root with any static file server and open
`/Projects/schedule-visualizer-2/`. There is no build step and nothing to
install. The page loads plain ES modules straight from this folder, and asks
for nothing outside it.

The engine can also be used from Node 22 or newer:

```js
import { createStore } from './engine/store.js';
import { createIds, seededRandom } from './engine/ids.js';
import { addGroup, setSlot } from './engine/actions.js';
import { sampleSchool } from './data/sample-school.js';

const store = createStore({
  project: sampleSchool(),
  clock: () => new Date(),
  ids: createIds(seededRandom(1)),
});
store.apply(addGroup, { name: '8C', grade: '8' });
store.undo(); // { label: 'Add group 8C', focus: { … } }
```

## How to run the tests

From this folder, with Node 22 or newer:

```
node test/run.mjs            every suite
node test/run.mjs --node     the plain-Node suites: nothing to install
node test/run.mjs --timing   the budgets at the size the tool promises
node test/run.mjs --browser  the journeys in Chromium, and the axe sweep
node test/engine/repair.test.mjs     one file
```

The browser suites use the site's harness, so `Tools/board-check` has to be
installed (`npm install` there). On a machine shared with other browser jobs,
run them one at a time.

`test/run.mjs` runs each test file in its own process with `TZ=UTC`, keeps
going after a failure, prints one line per file and exits non-zero if any
failed. The files are listed inside it by hand; a test file on disk that is
not on the list is a failure, and so is a file that runs and reports no test.

No test reads the machine's clock or time zone. The clock is pinned at
`2026-09-01T12:00:00Z` and ids come from a seeded source.
