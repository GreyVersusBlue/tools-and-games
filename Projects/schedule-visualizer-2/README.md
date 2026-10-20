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

## What each test file covers

One row for every file `test/run.mjs` runs. A case in
`test/ui/staff-pass.test.mjs` fails when a file it runs is missing here, or a
row names a file it does not run.

| File | What it covers |
| --- | --- |
| `test/engine/purity.test.mjs` | Nothing under `engine/` touches a page, storage, a timer, the clock or randomness |
| `test/engine/ids.test.mjs` | Ids: their form, their prefixes, the seeded source |
| `test/engine/schema.test.mjs` | The data model: defaults, ranges, a new project, how a room is named |
| `test/engine/validate.test.mjs` | Every rule `validate` holds a project to |
| `test/engine/migrate.test.mjs` | Older projects brought up to date, newer ones refused |
| `test/engine/repair.test.mjs` | What is put right on every load, and what is said about it |
| `test/engine/day-types.test.mjs` | A day type that is "the same as A Day", and its own copy |
| `test/engine/bells.test.mjs` | Period names, times, passing times, the bell schedule checks |
| `test/engine/actions.test.mjs` | Every action on a frozen project: what changes, what is shared, the undo label |
| `test/engine/history.test.mjs` | Undo and redo, 200 steps, quiet actions |
| `test/engine/store.test.mjs` | The store: apply, undo, subscribe, the three counters |
| `test/engine/sample-school.test.mjs` | Each claim the sample school's own comment makes |
| `test/engine/csv.test.mjs` | Reading and writing CSV: quotes, line breaks, byte-order marks |
| `test/engine/building.test.mjs` | The floor plan's geometry through its actions |
| `test/engine/graph.test.mjs` | The walkable graph, room entries, reachability |
| `test/engine/building-checks.test.mjs` | Each building check, found where it is, with its sentence |
| `test/engine/teacher-day.test.mjs` | The one rule for a teacher's day |
| `test/engine/checks.test.mjs` | The schedule checks of spec 5.7 |
| `test/engine/routing.test.mjs` | Routes: the quickest, the tie-breaks, the options, the named failures |
| `test/engine/directions.test.mjs` | A route in words, the reader's "squares", the plain no-stairs refusal |
| `test/engine/load.test.mjs` | What each group adds to the cells it crosses |
| `test/engine/places.test.mjs` | Stretches of corridor, their names, the hotspot ranking |
| `test/engine/crowd.test.mjs` | The crowd model, rule by rule |
| `test/engine/import-groups.test.mjs` | Groups from CSV: the column guess, the preview, a name clash |
| `test/engine/exports.test.mjs` | Every CSV and JSON export, and the file names |
| `test/engine/project-file.test.mjs` | The project, building and schedule files, written and read back |
| `test/engine/publish-data.test.mjs` | What a published file holds, key by key, and what it never holds |
| `test/engine/publish-crypto.test.mjs` | The lock on a published file: the key, the round trip, a wrong passcode |
| `test/publish/linker.test.mjs` | The linker rule, each form it refuses, and the assembled script |
| `test/publish/manifest.test.mjs` | `staff/manifest.js` against what the staff browser really loads |
| `test/publish/staff.test.mjs` | The staff browser's plain functions, and its tokens against the planner's |
| `test/publish/baseline.mjs` | The recorded baseline of what staff receive: data, locked data and code |
| `test/engine/presets.test.mjs` | The group colour presets, held equal in their two places |
| `test/engine/worker.test.mjs` | The derived pipeline and the client that asks it |
| `test/engine/runner.test.mjs` | The two rules `test/run.mjs` holds every suite to |
| `test/engine/import-teachers.test.mjs` | The teacher list from a CSV file |
| `test/engine/finding-ids.test.mjs` | One form for every finding's id |
| `test/engine/prints.test.mjs` | The print documents: the frame, the floor plan, the room list, the checks report |
| `test/engine/prints-batch.test.mjs` | Batch printing: every teacher's schedule and every door sign as one document |
| `test/engine/readers.test.mjs` | What readers will see of the problems that remain, sentence by sentence |
| `test/engine/prints-movement.test.mjs` | The movement view's tables, CSV files and print documents |
| `test/engine/grid-edits.test.mjs` | The grid editor's one action and the pure parts that feed it |
| `test/engine/import-subjects.test.mjs` | The subject list from a CSV file |
| `test/engine/scenario.test.mjs` | The scenario engine: apply, normalise, reconcile, the comparison, the difference map's numbers, compare with another file, the chip words |
| `test/engine/evacuation.test.mjs` | Evacuation: every room's way out, the exits' rooms and people, the rooms with no way out, the door card's data |
| `test/engine/scenario-actions.test.mjs` | The scenario lab's actions: start, rename, add and remove a change, discard, compare with another file, apply as one undo step |
| `test/engine/prints-door-cards.test.mjs` | Door cards: which rooms and in what order, the cropped maps of the way out, the steps and their second sheet, rooms with no way out, and the floor plan's crop and route options; no label cut at a map's edge |
| `test/engine/suggest.test.mjs` | Suggestions for a finding: the candidates, the two stages, the order, the sentence, at most five, "No small change clears this." |
| `test/engine/prints-congestion-scenario.test.mjs` | The congestion report's scenario section: before its comparison comes, the changes, the figures with their signs, new and resolved findings, places busier and quieter, a change that no longer applies, a failed or stale comparison, typed names, the same from Movement and from the lab |
| `test/engine/snapshots.test.mjs` | Snapshots and clearing with no browser: a snapshot's record and its name as typed, the limit and its refusal, the list's order, a stored project read back or refused, what the page's snapshots refuse before opening anything; the building, the schedule and a new project cleared and valid, each with the sentence saying what it removes and keeps; the import question's line about the snapshot |
| `test/engine/transfer.test.mjs` | Send to another device with no browser: the sample school through the envelope byte for byte, chunks in any order with their progress, every refusal (a wrong hash, a newer version, a foreign format, a duplicate, missing, out-of-range or wrong-sized chunk, a header that does not add up, bytes that are not text) in a sentence, the reply, and the connection codes: compressed, checked against typing mistakes, the wrong kind refused, carried through a QR code and read back |
| `test/engine/transfer-qr.test.mjs` | The QR code for Send to another device: the encoder against the standard's and a tutorial's published values, every version and level read back, the mask by the standard's score, error correction mending what it can, and codes read from camera-like frames (scaled, turned, tilted, unevenly lit, noisy, mirrored) |
| `test/engine/help.test.mjs` | Help covers what the planner has: every section in the rail (read from ui/app.js) with its purpose and first step, every shortcut the shell and each section's start() register, once and under a group Help explains, every word of spec 2 with the school's period word, and every setting the load, travel-time and late numbers are worked out from (found in the engines' source), its default read from the defaults and the project's own beside it |
| `test/ui/progress.test.mjs` | Getting started: which steps a project has done |
| `test/ui/helpers.test.mjs` | The interface's plain functions: the shortcut guard, fields, the picker, the table |
| `test/ui/building-inspector.test.mjs` | The building inspector's plain functions and the traced image's arithmetic |
| `test/ui/movement.test.mjs` | The movement view's plain functions: lanes, the choice, the legend |
| `test/ui/playback.test.mjs` | Playback's plain functions: what the device keeps, where a marker is |
| `test/ui/room-picker.test.mjs` | The room picker's rules and the Groups tab's addresses, with no browser |
| `test/ui/schedule-address.test.mjs` | The Groups tab's addresses, its one Tab stop and a phone's history of the list and a group, with no browser |
| `test/ui/staff-pass.test.mjs` | The Staff browser section's plain functions: failure sentences, the publish time, the sign's fit, this table |
| `test/ui/engine-client.test.mjs` | What the engine client remembers: an answer, never a run that failed |
| `test/ui/plan-map.test.mjs` | The plan map Movement, Scenarios and Safety mount: the stage's room and least, the keep on the stage, the floors shown, the name and frame it needs; Fit with no painted cell under the zoom buttons |
| `test/ui/scenario-lane.test.mjs` | The scenario and suggestion lanes: a second pipeline on the shared route cache, the worker's answers, what the client keeps and drops, the main thread giving the worker's answers |
| `test/ui/safety.test.mjs` | The Safety section's plain functions: OKLab, a way out in runs a floor, the first line, a room's line, the cursor's sentence, and the key's words past eight exits |
| `test/ui/exit-colours.test.mjs` | The exits' colours, the `--exit-n` tokens of `ui/safety/safety.css`: in both themes 3:1 on the corridor, the floor and the stairs, 40 degrees of hue from `--problem` and `--warning`, every pair apart in OKLab, the dark blocks equal; repeating past eight |
| `test/ui/renderer-labels.test.mjs` | The renderer's labels on a plan map's slot, on a context that records what is written: a door name never runs past the slot (slid along its edge, inside its dash on a halo, or left out); with `namesOver` the corridor names are written over the overlays on a halo |
| `test/ui/scenarios-model.test.mjs` | The scenario lab's plain functions: a change that cancelled itself, the signs and the better or worse marks of the figures and of a group's row, which groups the comparison lists, the bar's words |
| `test/ui/difference.test.mjs` | The difference map's plain functions: the five strengths against the largest change, both tints' contrast on the corridor in both themes, zero and exclusion zones left unpainted, every day type together, the transition chosen, the ten largest changes with ties, groups apart, the card's words with typed names |
| `test/ui/fix-kinds.test.mjs` | The kinds Fix… is on (FIXABLE_KINDS) and the kinds the suggestion engine works on, read through its candidates, are the same set |
| `test/ui/lab-fixes.test.mjs` | The M5 pass's lab and Fix dialog follow-ups with no browser (SV2-72d): `notYet` gone, README's fix.mjs row as Try it behaves |
| `test/a11y/contrast.mjs` | Token contrast, in Node |
| `test/browser/shell.mjs` | The shell: the rail, shortcuts, themes, toasts, dialogs |
| `test/browser/no-offsite.mjs` | Nothing the planner or a published file asks for leaves the origin |
| `test/browser/shell-lines.mjs` | What the shell owed the units after it |
| `test/browser/shell-owed.mjs` | What two more units owed the shell |
| `test/browser/m1-pass.mjs` | The first milestone's design and journey pass |
| `test/browser/draw-pointer.mjs` | Drawing a building with a mouse |
| `test/browser/draw-keyboard.mjs` | Drawing a building with the keyboard alone |
| `test/browser/draw-touch.mjs` | Drawing with a finger and with a pen |
| `test/browser/doors-stairs.mjs` | Doors, stairs connections, exits, corridor names, the cell's menu |
| `test/browser/inspector.mjs` | The building inspector's five tabs |
| `test/browser/search.mjs` | Finding rooms, teachers and groups from the top bar |
| `test/browser/storage.mjs` | Saving on the device, with a real IndexedDB |
| `test/browser/recovery.mjs` | Recovery points: taken, kept, restored |
| `test/browser/tabs.mjs` | Two tabs on one project |
| `test/browser/schedule.mjs` | The Schedule section: a group entered by keyboard, the checks |
| `test/browser/grid.mjs` | The Grid tab: typing, pasting, Apply and Discard |
| `test/browser/grid-pass.mjs` | The Grid tab after the walk-through of the schedule |
| `test/browser/m2-pass.mjs` | The schedule after the walk-through of it |
| `test/browser/import.mjs` | The Import tab |
| `test/browser/project-file.mjs` | The Project file card: export, import, building only, schedule only |
| `test/browser/worker.mjs` | The derived pipeline in a real worker |
| `test/browser/print.mjs` | The print preview sheet |
| `test/browser/staff-shell.mjs` | The staff browser's frame: unlock, search, addresses, notices, from a file on disk |
| `test/browser/staff-views-a.mjs` | The teacher, group, room, building map and staffing pages |
| `test/browser/staff-views-b.mjs` | Free right now, Where right now, Common planning, Coverage, the substitute plan, Directions |
| `test/browser/staff-outputs.mjs` | My schedule, notes, the lock-screen image, the door sign, every page on paper, batch sheets |
| `test/browser/publish.mjs` | The Staff browser section: the preview, the publish form, a file published and opened from disk, batch printing |
| `test/browser/m3-pass.mjs` | The movement view after the walk-through of it: the map first, the page that does not scroll, the toast above the dock |
| `test/browser/m4-pass.mjs` | The published file on a phone after the walk-through: M1 to M8 |
| `test/browser/movement.mjs` | The movement view: who, the day type, the transition, the lanes and the legend |
| `test/browser/hotspots.mjs` | The movement view's inspector: hotspots, travel time, summary, export |
| `test/browser/playback.mjs` | Playback: play, the scrubber, pace, the markers, the Late line |
| `test/browser/plan-map.mjs` | The plan map mounted through its module as Scenarios and Safety will: their stubs as they were, the toast clearance of two maps, the keep on the stage and the stage's least; no painted cell under the zoom buttons at Fit in all three sections at four sizes, a foot with no box, Enter as its own kind, a renderer read off the page, and the stage measured again when the zoom buttons change size |
| `test/browser/safety.mjs` | The Safety section: a room picked by pointer and by keyboard, every room coloured by exit with its key, the exits and the rooms with no way out, door cards for one room, the rooms ticked and every room through the preview, typed names as typed, the stage and toast rules at three sizes, the exits' colours the `--exit-n` tokens, a section drawn off the page in the page's colours |
| `test/browser/scenario.mjs` | The scenario lab: start and rename, each kind of change by pointer and by keyboard, a chip removed, a change that cancels itself, a change dropped when its room goes and back on Undo, the comparison as the scenario lane gives it and while it works, Apply as one step of undo, Discard asking, compare with a file and another building refused, the congestion report, the spec 18 journey, typed names as typed, the bar with touch at three sizes; SV2-68b's cases: no asking when nothing it is for changed, the focus after Apply, Discard and Undo, the lane's races and failure, a group deleted, a file's scenario edited, the slots not compared kept to their comparison, Undo of a rename in a focused field, Apply with nothing to apply, the picker after a rename |
| `test/browser/congestion-scenario.mjs` | The congestion report with a scenario open: its section once the comparison comes, the same text from Movement's button and from the preview opened as the lab opens it, and what it says while the comparison has not come and when it failed |
| `test/browser/difference.mjs` | The scenario lab's difference map: a corridor busier and one quieter painted (the overlay's state and one pixel a tint), the card by pointer, by a tap with touch and at the keyboard cursor, the transition and day type chosen in the comparison, the table of the ten largest changes, a change of theme, no answer, typed names as typed |
| `test/browser/fix.mjs` | Fix… and Try it: Fix… only on a finding the suggestion engine can work on, the dialog working then the suggestion lane's sentences, the switch for other teachers' rooms naming whose room, Try it starting a scenario or adding to the open one and opening Scenarios with the focus on the scenario's name field (`#scenario-name`) and the schedule unchanged, a refused Try it, "No small change clears this.", a failed and a stale answer, keyboard only, a phone with touch, the focus back on Escape and Close, typed names as typed |
| `test/browser/snapshots.mjs` | Snapshots and clearing in Chromium with a real IndexedDB: the Snapshots card empty, a snapshot taken by the keyboard with its name as typed, a blank name refused, restore (a recovery point first, one undo step), rename, export as a project file, delete asked first with the focus going on, a traced image kept while a snapshot names it and swept with the last one, the limit refused with nothing replaced, the three clears saying what they remove with a snapshot first and undone in one step, going on without a snapshot only after saying so, a project and a building file import each taking one, a read-only second tab, take, restore, rename, a clear and delete by finger at 390 by 844, axe on the Project section light and dark |
| `test/browser/transfer.mjs` | Send to another device between two pages of one Chromium, each in its own browser context, over WebRTC with no ICE server, the codes carried through the paste fields: the sample school sent by the keyboard at 1280 and by finger at 390 by 844 with progress on both sides, the receiver told what each project holds and asked, a snapshot and a recovery point before the replacement as one undo step, the sender told it was received and applied; Keep my project; a damaged part refused by the hash; codes refused with their sentences and one pasted outside the field; a read-only tab; the camera through the decoder on a canvas stream and through a BarcodeDetector, asked for only on Scan and stopped on Close; sendFrames' back-pressure; the statement after 20 s with no channel on both sides; axe on both dialogs light and dark |
| `test/browser/help.mjs` | Help opened on every section by the ? key and by the top bar's ? with a finger at 390 by 844: the section open now leads, every section, shortcut, gesture, word and number is there, Close gives the focus back; the title and Close in view while the body scrolls at 390 by 844 and 844 by 390 with touch; the parts' buttons; Show Getting started; axe light and dark |
| `test/a11y/axe.mjs` | The accessibility sweep of every screen, light and dark |
| `test/timing/routing.mjs` | Routing under its budget at the promised size |
| `test/timing/crowd.mjs` | The crowd model under its budget |
| `test/timing/pipeline.mjs` | The derived pipeline end to end under its budget |
| `test/timing/movement.mjs` | The movement view's main-thread work under its budget |
| `test/timing/playback.mjs` | One frame of playback under its budget |
| `test/timing/evacuation.mjs` | Every room's way out and door card under its budget |
| `test/timing/suggest.mjs` | Suggestions for one finding under their budget |
| `test/timing/scenario-lane.mjs` | The scenario lane, one change added and the first asking, under its budgets |
| `test/timing/difference-card.mjs` | The difference map's card, the first after an answer and a later one, under its budgets |
