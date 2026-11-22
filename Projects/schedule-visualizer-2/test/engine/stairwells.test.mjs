// Stairwells (SV2-128; ARCHITECTURE 22.4, 22.17): the actions of
// engine/stairwells.js, each one undo step with its label and its counters;
// every refusal in words; the middle stop taken out and the stops either side
// rejoined with the way the removed flights agreed on; one-way translated per
// flight; the in-session mend (splitWells, run from disconnect, delete floor,
// resize floor and painting over stairs); the letters every reader asks
// (stairsLetter); compare-buildings pairing flights with a stairwell; and
// routing unchanged for a chain made a well. Plain Node: seeded ids, a pinned
// clock, every project deep-frozen while an action runs on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { makeStairwell, stairwellThrough, addStairwellStop, removeStairwellStop, splitStairwell, setStairwellDirection, setStairwellLetter, joinStairwell } from '../../engine/stairwells.js';
import { stairwells, stairsLetter, newFloor, newRoom, newOtherSpace, nextConnectionLabel, ELEVATOR_KIND } from '../../engine/schema.js';
import { splitWells, splitCars, emptyLoss, renamedText, lossText } from '../../engine/building.js';
import { routingGraph, route, routeToExit } from '../../engine/routing.js';
import { buildGraph } from '../../engine/graph.js';
import { directions } from '../../engine/directions.js';
import { compareBuildings } from '../../engine/compare-buildings.js';
import { createPipeline } from '../../engine/worker.js';
import { copySpaces } from '../../engine/building.js';
import { school, ctx, clock, makeIds, assertValid, clone } from './helpers.mjs';

const { ActionError, GEOMETRY, BUILDING } = actions;
const CELL = 332;

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

const shared = ctx(21);

function run(act, project, payload) {
  const after = act(freeze(project), payload, shared);
  assertValid(after, 'the project is still valid after the action');
  return after;
}

function refused(act, project, payload, code, pattern) {
  assert.throws(() => act(freeze(project), payload, ctx(3)), (error) => {
    assert.ok(error instanceof ActionError, 'an ActionError, not ' + error);
    assert.equal(error.code, code);
    assert.match(error.message, /\.$/, 'the message is a sentence');
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

// One store step: its label, the counters it moves, one undo step, and undo
// giving back the very project.
function step(project, act, payload, label, exact = true) {
  const start = freeze(project);
  const store = createStore({ project: start, clock, ids: makeIds(11) });
  const geometry = store.geometryVersion;
  const building = store.buildingVersion;
  store.apply(act, payload);
  assert.equal(store.history.past.length, 1, 'one undo step');
  assert.equal(store.undoLabel, label);
  assert.ok(store.geometryVersion > geometry, 'GEOMETRY moved');
  assert.ok(store.buildingVersion > building, 'BUILDING moved');
  if (exact) assert.deepEqual(act.bumps, [GEOMETRY, BUILDING]);
  else assert.ok(act.bumps.includes(GEOMETRY), 'an existing action: GEOMETRY, which moves the building counter too');
  assertValid(store.project, 'valid after ' + label);
  const after = store.project;
  const text = (store.undoOutcome || {}).text;
  store.undo();
  assert.deepEqual(store.project, start, 'undo gives back the project as it was');
  return { after, text };
}

// ---------------------------------------------------------------- the buildings

// n floors (fsample001…), a stairs cell at the same cell on each, and a plain
// flight between each two: ids cwell0001…, labels A, B, C…, from the lower end.
function chain(n, options) {
  const opts = options || {};
  const project = clone(school());
  const floors = project.building.floors;
  for (let i = floors.length; i < n; i += 1) floors.push(newFloor('fsample00' + (i + 1), 'Floor ' + (i + 1), i + 1, 40, 14));
  for (const floor of floors) floor.cells = floor.cells.slice(0, CELL) + 'S' + floor.cells.slice(CELL + 1);
  project.building.connections = [];
  for (let i = 0; i + 1 < n; i += 1) {
    const connection = { id: 'cwell000' + (i + 1) + 'x'.repeat(1), label: String.fromCharCode(65 + i), a: { floorId: floors[i].id, cell: CELL }, b: { floorId: floors[i + 1].id, cell: CELL }, direction: 'both' };
    connection.id = 'cwell' + String(i + 1).padStart(5, '0');
    if (opts.well) connection.well = opts.well;
    project.building.connections.push(connection);
  }
  return project;
}

const floorId = (n) => 'fsample00' + n;
const flight = (project, id) => project.building.connections.find((connection) => connection.id === id);
const letters = (project) => project.building.connections.map((connection) => stairsLetter(connection));
const wells = (project) => project.building.connections.map((connection) => connection.well);

// ---------------------------------------------------------------- make one

test('makeStairwell: the chain becomes one well, lettered by its lowest flight, in one undo step with its label and summary', () => {
  const { after, text } = step(chain(3), makeStairwell, { connectionId: 'cwell00002' }, 'Make one stairwell, Stairwell A');
  assert.deepEqual(wells(after), ['A', 'A']);
  assert.deepEqual(letters(after), ['A', 'A']);
  assert.deepEqual(after.building.connections.map((connection) => connection.label), ['A', 'B'], 'each flight keeps its own label underneath');
  assert.equal(text, 'Stairs A and B are now Stairwell A, on Floors 1, 2 and 3. It reads A on every floor; B is not shown any more.');
  const found = stairwells(after.building);
  assert.equal(found.length, 1);
  assert.equal(found[0].parts, 1);
  assert.deepEqual(found[0].stops.map((stop) => stop.floorId), [floorId(1), floorId(2), floorId(3)]);
});

test('makeStairwell: starting from any flight of the run gives the same well; a typed letter wins', () => {
  const fromTop = run(makeStairwell, chain(3), { connectionId: 'cwell00001' });
  assert.deepEqual(wells(fromTop), ['A', 'A']);
  const named = run(makeStairwell, chain(3), { connectionId: 'cwell00001', letter: ' East ' });
  assert.deepEqual(wells(named), ['East', 'East']);
});

test('makeStairwell: the lowest flight gives the letter even when the connections are listed in another order', () => {
  const project = chain(3);
  project.building.connections.reverse();
  const after = run(makeStairwell, project, { connectionId: 'cwell00001' });
  assert.deepEqual(wells(after), ['A', 'A']);
});

test('makeStairwell refuses two floors, a floor reached twice, an elevator, a stairwell already made, a letter in use and a long one', () => {
  refused(makeStairwell, school(), { connectionId: 'csample00a' }, 'two-floors', /only two floors; a stairwell is for three or more\.$/);
  // Floor 2 reached twice: the chain F1 - F2(332) - F1(340)
  const twice = chain(3);
  twice.building.floors[0].cells = twice.building.floors[0].cells.slice(0, 340) + 'S' + twice.building.floors[0].cells.slice(341);
  twice.building.connections = [twice.building.connections[0], { id: 'cwell00009', label: 'B', a: { floorId: floorId(2), cell: CELL }, b: { floorId: floorId(1), cell: 340 }, direction: 'both' }];
  refused(makeStairwell, twice, { connectionId: 'cwell00001' }, 'floor-twice', /^Stairs A and B would stop twice on Floor 1: at row 9, column 13 and row 9, column 21\. Remove one connection first\.$/);
  const lift = chain(3);
  lift.building.connections[1] = { ...lift.building.connections[1], kind: ELEVATOR_KIND, car: 'D', label: 'D' };
  refused(makeStairwell, lift, { connectionId: 'cwell00002' }, 'elevator');
  refused(makeStairwell, lift, { connectionId: 'cwell00001' }, 'two-floors');
  const made = run(makeStairwell, chain(3), { connectionId: 'cwell00001' });
  refused(makeStairwell, made, { connectionId: 'cwell00001' }, 'already-well', /already one stairwell, A\.$/);
  // a letter that is one of the run's own flights' labels is fine; another flight's is not
  assert.deepEqual(wells(run(makeStairwell, chain(3), { connectionId: 'cwell00001', letter: 'B' })), ['B', 'B']);
  const crowded = chain(3);
  crowded.building.connections.push({ id: 'cwell00008', label: 'Q', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' });
  for (const n of [1, 2]) crowded.building.floors[n - 1].cells = crowded.building.floors[n - 1].cells.slice(0, 60) + 'S' + crowded.building.floors[n - 1].cells.slice(61);
  refused(makeStairwell, crowded, { connectionId: 'cwell00001', letter: 'q' }, 'duplicate-label', /already a stairs connection Q/);
  refused(makeStairwell, chain(3), { connectionId: 'cwell00001', letter: '' }, 'no-name');
  refused(makeStairwell, chain(3), { connectionId: 'cwell00001', letter: 'x'.repeat(9) }, 'too-long');
  refused(makeStairwell, chain(3), { connectionId: 'nothing000' }, 'missing');
});

test('makeStairwell never takes an elevator into the run, even one that shares a stairs cell\'s floor', () => {
  const project = chain(3);
  const [a, b] = project.building.connections;
  project.building.floors[0].cells = project.building.floors[0].cells.slice(0, 60) + 'S' + project.building.floors[0].cells.slice(61);
  project.building.floors[1].cells = project.building.floors[1].cells.slice(0, 60) + 'S' + project.building.floors[1].cells.slice(61);
  project.building.connections.push({ id: 'cwell00007', label: 'D', kind: ELEVATOR_KIND, car: 'D', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' });
  const after = run(makeStairwell, project, { connectionId: a.id });
  assert.equal(after.building.connections.find((connection) => connection.id === 'cwell00007').well, undefined);
  assert.equal(flight(after, b.id).well, 'A');
});

// ---------------------------------------------------------------- through floors

test('stairwellThrough: one stairwell through three floors at the same cell; an empty cell becomes stairs, flights that exist are kept', () => {
  const project = clone(school());
  const before = project.building.floors[2].cells[CELL];
  assert.equal(before, '.', 'Floor 3 is empty at that cell');
  const { after, text } = step(project, stairwellThrough, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] }, 'Join Floors 1, 2 and 3 as one stairwell, Stairwell A');
  assert.equal(after.building.floors[2].cells[CELL], 'S', 'drawn as stairs on Floor 3');
  const found = stairwells(after.building);
  assert.equal(found.length, 1);
  assert.equal(found[0].letter, 'A', 'the letter of the stairs at the starting stop (DESIGN 16.7)');
  assert.equal(found[0].connectionIds.length, 2);
  assert.ok(found[0].connectionIds.includes('csample00a'), 'the flight that was there is kept');
  assert.equal(flight(after, 'csample00a').well, 'A');
  assert.equal(flight(after, 'csample00a').label, 'A', 'and keeps its own label');
  assert.equal(found[0].parts, 1);
  assert.equal(text, 'Stairwell A now runs through Floors 1, 2 and 3 at row 9, column 13 (1 flight made, 1 kept). Stairs were drawn on Floor 3.');
  assert.deepEqual(actions.scheduleOutcome(run(stairwellThrough, clone(school()), { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] })).renamed, [], 'no letter changes');
  // the new flight has its own label too, and every label is still its own
  assert.equal(new Set(after.building.connections.map((connection) => connection.label)).size, after.building.connections.length);
});

test('stairwellThrough: a cell that is already stairs on a floor is used as it is, and the floors may be given in any order', () => {
  const project = chain(4);
  project.building.connections = [];
  const after = run(stairwellThrough, project, { floorId: floorId(2), cell: CELL, floorIds: [floorId(4), floorId(1), floorId(3)] });
  const found = stairwells(after.building);
  assert.deepEqual(found[0].stops.map((stop) => stop.floorId), [1, 2, 3, 4].map(floorId));
  assert.equal(found[0].connectionIds.length, 3);
  assert.equal(found[0].letter, 'A');
  for (const connection of after.building.connections) {
    assert.equal(project.building.floors.find((floor) => floor.id === connection.a.floorId).level + 1, project.building.floors.find((floor) => floor.id === connection.b.floorId).level, 'flights join consecutive floors by level');
  }
});

// Floor n's cell is changed to `character`; with `space`, that cell is also a room or another space.
function drawn(project, n, cell, character, space) {
  const floor = project.building.floors[n - 1];
  floor.cells = floor.cells.slice(0, cell) + character + floor.cells.slice(cell + 1);
  if (space === 'room') floor.spaces.push({ ...newRoom('rwelltest1', [cell]), number: '777' });
  if (space === 'other') floor.spaces.push({ ...newOtherSpace('owelltest1', [cell]), label: 'Store' });
  if (space === 'lift') floor.lifts = [cell];
  return project;
}

test('stairwellThrough refuses a corridor, a room, another space or an elevator stop in the way, naming the floor and what is there', () => {
  const start = chain(3);
  start.building.connections = [];
  const payload = { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] };
  refused(stairwellThrough, drawn(clone(start), 2, CELL, '#'), payload, 'blocked', /^Floor 2 has a corridor at row 9, column 13, so the stairs cannot go there\. Leave Floor 2 out, or choose stairs at another place\.$/);
  refused(stairwellThrough, drawn(clone(start), 3, CELL, '.', 'room'), payload, 'blocked', /^Floor 3 has Room 777 at row 9, column 13/);
  refused(stairwellThrough, drawn(clone(start), 3, CELL, '.', 'other'), payload, 'blocked', /^Floor 3 has another space \(Store\) at row 9, column 13/);
  refused(stairwellThrough, drawn(clone(start), 2, CELL, 'S', 'lift'), payload, 'elevator', /^Floor 2 has an elevator stop at row 9, column 13/);
  const lifted = drawn(clone(start), 1, CELL, 'S', 'lift');
  refused(stairwellThrough, lifted, payload, 'elevator', /elevator stop on Floor 1, not stairs/);
});

test('stairwellThrough refuses two floors, a start that is not stairs, a flight already in a stairwell, a floor too small and a bad payload', () => {
  const start = chain(3);
  start.building.connections = [];
  refused(stairwellThrough, start, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2)] }, 'two-floors', /only two floors/);
  refused(stairwellThrough, start, { floorId: floorId(1), cell: CELL, floorIds: [floorId(1), floorId(2)] }, 'two-floors');
  refused(stairwellThrough, start, { floorId: floorId(1), cell: 0, floorIds: [floorId(2), floorId(3)] }, 'not-stairs', /not stairs/);
  refused(stairwellThrough, start, { floorId: floorId(1), cell: CELL, floorIds: 'x' }, 'bad-value');
  refused(stairwellThrough, start, { floorId: floorId(1), cell: 99999, floorIds: [floorId(2), floorId(3)] }, 'bad-value');
  refused(stairwellThrough, start, { floorId: 'fnowhere00', cell: CELL, floorIds: [] }, 'missing');
  refused(stairwellThrough, start, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), 'fnowhere00'] }, 'missing');
  const small = clone(start);
  small.building.floors[2] = { ...newFloor(floorId(3), 'Floor 3', 3, 10, 5) };
  refused(stairwellThrough, small, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] }, 'off-floor', /Floor 3 has no row 9, column 13: it is smaller than Floor 1/);
  const made = run(makeStairwell, chain(3), { connectionId: 'cwell00001' });
  refused(stairwellThrough, made, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] }, 'already-well', /already part of a stairwell\. Split Stairwell A first/);
});

test('stairwellThrough: a letter no label, well or elevator uses', () => {
  const project = chain(3);
  project.building.connections = [{ id: 'cwell00008', label: 'A', well: 'B', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' }];
  for (const n of [1, 2]) project.building.floors[n - 1].cells = project.building.floors[n - 1].cells.slice(0, 60) + 'S' + project.building.floors[n - 1].cells.slice(61);
  // the first letter unused over labels (A) and wells (B) is C
  const after = run(stairwellThrough, project, { floorId: floorId(2), cell: CELL, floorIds: [floorId(1), floorId(3)] });
  const made = stairwells(after.building).find((well) => well.letter !== 'B');
  assert.equal(made.letter, 'C');
  assert.equal(made.connectionIds.length, 2);
  assert.equal(nextConnectionLabel(project.building.connections), 'C');
});

// Stairs C joins Floor 1 and Floor 2 at CELL; Stairs A and B are elsewhere, so
// the first unused letter would be D. (The W7 walk-through: the well became F.)
function stairsC() {
  const project = chain(3);
  project.building.connections = [
    { id: 'cwell00011', label: 'A', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' },
    { id: 'cwell00012', label: 'B', a: { floorId: floorId(2), cell: 61 }, b: { floorId: floorId(3), cell: 61 }, direction: 'both' },
    { id: 'cwell00013', label: 'C', a: { floorId: floorId(1), cell: CELL }, b: { floorId: floorId(2), cell: CELL }, direction: 'both' },
  ];
  for (const n of [1, 2, 3]) {
    const floor = project.building.floors[n - 1];
    floor.cells = floor.cells.slice(0, 60) + 'SS' + floor.cells.slice(62);
  }
  return project;
}

test('stairwellThrough from Stairs C keeps the letter C: "Join Floors 1 to 3 as Stairwell C", no letter changes (DESIGN 16.7, 16.12 item 2)', () => {
  const project = stairsC();
  assert.equal(nextConnectionLabel(project.building.connections), 'D');
  const { after, text } = step(project, stairwellThrough, { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] }, 'Join Floors 1, 2 and 3 as one stairwell, Stairwell C');
  const made = stairwells(after.building).find((well) => well.stops.length === 3);
  assert.equal(made.letter, 'C');
  assert.equal(flight(after, 'cwell00013').label, 'C', 'the kept flight keeps its label');
  const added = after.building.connections.find((connection) => !project.building.connections.some((old) => old.id === connection.id));
  assert.equal(added.label, 'D', 'the new flight takes a label of its own, not C again');
  assert.equal(new Set(after.building.connections.map((connection) => connection.label)).size, after.building.connections.length);
  assert.deepEqual(actions.scheduleOutcome(run(stairwellThrough, stairsC(), { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] })).renamed, []);
  assert.equal(text, 'Stairwell C now runs through Floors 1, 2 and 3 at row 9, column 13 (1 flight made, 1 kept).');
  // the same from the top: Floor 3 has no flight, the kept one is lower down
  const fromTop = run(stairwellThrough, project, { floorId: floorId(3), cell: CELL, floorIds: [floorId(1), floorId(2)] });
  assert.equal(scheduleLetter(fromTop), 'C');
});

const scheduleLetter = (project) => actions.scheduleOutcome(project).letter;

test('stairwellThrough: when the starting stairs\' letter is another well\'s, the well takes a free letter and says which letter goes', () => {
  const project = stairsC();
  // an older planner left Stairwell C elsewhere beside the plain Stairs C
  project.building.connections[0] = { ...project.building.connections[0], label: 'X', well: 'C' };
  const after = stairwellThrough(freeze(project), { floorId: floorId(1), cell: CELL, floorIds: [floorId(2), floorId(3)] }, shared);
  const outcome = actions.scheduleOutcome(after);
  assert.equal(outcome.letter, 'A', 'the first letter no label or well uses');
  assert.deepEqual(outcome.renamed, ['C'], 'Stairs C stops being shown');
  assert.match(outcome.text, / It reads A on every floor; C is not shown any more\.$/);
  assert.equal(flight(after, 'cwell00013').well, 'A');
});

// ---------------------------------------------------------------- add and remove a stop

test('addStairwellStop: one flight from the nearest stop by level, carrying the well and its way', () => {
  const project = chain(4);
  project.building.connections = project.building.connections.filter((connection) => connection.id !== 'cwell00003');
  const made = run(makeStairwell, project, { connectionId: 'cwell00001' });
  const upOnly = run(setStairwellDirection, made, { well: 'A', direction: 'up' });
  const { after, text } = step(upOnly, addStairwellStop, { well: 'a', floorId: floorId(4), cell: CELL }, 'Add Floor 4 to Stairwell a');
  const added = after.building.connections.filter((connection) => !upOnly.building.connections.includes(connection) && !upOnly.building.connections.some((old) => old.id === connection.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].well, 'A');
  assert.deepEqual([added[0].a.floorId, added[0].b.floorId], [floorId(3), floorId(4)], 'from the nearest stop (Floor 3)');
  assert.equal(added[0].direction, 'ab', 'up on the new flight, as on the others');
  assert.equal(stairwells(after.building)[0].stops.length, 4);
  assert.equal(text, 'Stairwell A now stops on Floor 4 as well, reached from Floor 3.');
  assert.equal(new Set(after.building.connections.map((connection) => connection.label)).size, 3, 'its own label is a fresh one');
});

test('addStairwellStop refuses a floor the well already serves, a cell that is not stairs, an elevator stop, a well in parts and a missing well or floor', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  refused(addStairwellStop, made, { well: 'A', floorId: floorId(2), cell: 100 }, 'floor-twice', /already stops on Floor 2/);
  const wide = clone(chain(4));
  wide.building.connections = wide.building.connections.slice(0, 2);
  const two = run(makeStairwell, wide, { connectionId: 'cwell00001' });
  refused(addStairwellStop, two, { well: 'A', floorId: floorId(4), cell: 100 }, 'not-stairs', /not stairs/);
  refused(addStairwellStop, drawn(clone(two), 4, 100, 'S', 'lift'), { well: 'A', floorId: floorId(4), cell: 100 }, 'elevator');
  refused(addStairwellStop, two, { well: 'Z', floorId: floorId(4), cell: CELL }, 'missing', /no Stairwell Z/);
  refused(addStairwellStop, two, { well: 'A', floorId: 'fnowhere00', cell: CELL }, 'missing');
  refused(addStairwellStop, two, { well: 'A', floorId: floorId(4), cell: -1 }, 'bad-value');
  refused(addStairwellStop, two, { well: '', floorId: floorId(4), cell: CELL }, 'bad-value');
  const parts = clone(made);
  parts.building.connections = parts.building.connections.filter((connection) => connection.id !== 'cwell00002');
  refused(addStairwellStop, parts, { well: 'A', floorId: floorId(3), cell: CELL }, 'well-parts', /in 2 parts/);
});

test('removeStairwellStop: the middle stop out, the stops either side rejoined with the way both flights agreed on', () => {
  const project = chain(4);
  // up only on both: the first drawn from its lower end, the second from its upper end
  project.building.connections[0].direction = 'ab';
  project.building.connections[1] = { ...project.building.connections[1], a: project.building.connections[1].b, b: project.building.connections[1].a, direction: 'ba' };
  const made = run(makeStairwell, project, { connectionId: 'cwell00001' });
  const { after, text } = step(made, removeStairwellStop, { well: 'A', floorId: floorId(2) }, 'Remove Floor 2 from Stairwell A');
  const found = stairwells(after.building)[0];
  assert.deepEqual(found.stops.map((stop) => stop.floorId), [1, 3, 4].map(floorId));
  assert.equal(found.parts, 1, 'the well is whole: Floor 1 and Floor 3 are joined');
  const joined = after.building.connections.find((connection) => [connection.a.floorId, connection.b.floorId].includes(floorId(1)));
  assert.deepEqual([joined.a.floorId, joined.b.floorId].sort(), [floorId(1), floorId(3)]);
  assert.equal(joined.well, 'A');
  assert.equal(joined.direction, joined.a.floorId === floorId(1) ? 'ab' : 'ba', 'up only still');
  assert.equal(after.building.floors[1].cells[CELL], 'S', 'the stairs cell stays');
  assert.equal(joined.label, 'A', 'SV2-142: the joining flight takes the lowest removed flight\'s label, so no letter is used up');
  assert.equal(text, 'Floor 2 is out of Stairwell A: Floor 1 and Floor 3 are joined directly by one flight that is still Stairwell A (no new letter), and the stairs on Floor 2 stay, connected to nothing, so Checks will warn about them until you connect or remove them.');
  // joined with both ways when the flights did not agree
  const disagreeing = clone(made);
  disagreeing.building.connections.find((connection) => connection.id === 'cwell00002').direction = 'both';
  const both = run(removeStairwellStop, disagreeing, { well: 'A', floorId: floorId(2) });
  assert.equal(both.building.connections.find((connection) => [connection.a.floorId, connection.b.floorId].includes(floorId(1))).direction, 'both');
});

test('removeStairwellStop: an end stop just goes, its flight with it', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const top = run(removeStairwellStop, made, { well: 'A', floorId: floorId(4) });
  assert.deepEqual(stairwells(top.building)[0].stops.map((stop) => stop.floorId), [1, 2, 3].map(floorId));
  assert.equal(top.building.connections.length, 2);
  const bottom = run(removeStairwellStop, made, { well: 'A', floorId: floorId(1) });
  assert.deepEqual(stairwells(bottom.building)[0].stops.map((stop) => stop.floorId), [2, 3, 4].map(floorId));
});

test('SV2-142b: removing a stop of a well lettered apart from its flights reuses the lower removed flight\'s label, and no new letter is used', () => {
  // Stairwell East over flights A, B, C: Floor 3 out joins Floor 2 and Floor 4 with B's label
  const east = run(makeStairwell, chain(4), { connectionId: 'cwell00001', letter: 'East' });
  const { after, text } = step(east, removeStairwellStop, { well: 'East', floorId: floorId(3) }, 'Remove Floor 3 from Stairwell East');
  const joined = after.building.connections.find((connection) => [connection.a.floorId, connection.b.floorId].sort().join() === [floorId(2), floorId(4)].join());
  assert.equal(joined.label, 'B', 'the lower removed flight (Floor 2 to 3) gives its label');
  assert.equal(stairsLetter(joined), 'East');
  assert.deepEqual(letters(after), ['East', 'East']);
  assert.equal(text, 'Floor 3 is out of Stairwell East: Floor 2 and Floor 4 are joined directly by one flight that is still Stairwell East (no new letter), and the stairs on Floor 3 stay, connected to nothing, so Checks will warn about them until you connect or remove them.');
  // plain letters too: the label is B, not the well's A, and not a fresh D
  const plain = run(removeStairwellStop, run(makeStairwell, chain(4), { connectionId: 'cwell00001' }), { well: 'A', floorId: floorId(3) });
  assert.deepEqual(plain.building.connections.map((connection) => connection.label).sort(), ['A', 'B']);
});

test('SV2-142b: in wells of 4, 5 and 6 floors every middle stop, the top and the bottom come out whole, with labels only from the flights that were there', () => {
  for (const n of [4, 5, 6]) {
    const made = run(makeStairwell, chain(n), { connectionId: 'cwell00001' });
    const labels = new Set(made.building.connections.map((connection) => connection.label));
    for (let k = 1; k <= n; k += 1) {
      const after = run(removeStairwellStop, made, { well: 'A', floorId: floorId(k) });
      const found = stairwells(after.building);
      const at = n + ' floors, Floor ' + k + ' out';
      assert.equal(found.length, 1, at + ': one well');
      assert.equal(found[0].parts, 1, at + ': whole');
      assert.deepEqual(found[0].stops.map((stop) => stop.floorId), Array.from({ length: n }, (_, i) => floorId(i + 1)).filter((id) => id !== floorId(k)), at + ': the other stops');
      assert.equal(after.building.connections.length, n - 2, at + ': one flight fewer');
      assert.deepEqual(letters(after), Array(n - 2).fill('A'), at + ': every flight reads A');
      assert.ok(after.building.connections.every((connection) => labels.has(connection.label)), at + ': no new label');
      if (k > 1 && k < n) {
        const joined = after.building.connections.find((connection) => [connection.a.floorId, connection.b.floorId].sort().join() === [floorId(k - 1), floorId(k + 1)].join());
        assert.equal(joined.label, String.fromCharCode(65 + k - 2), at + ': the flight from Floor ' + (k - 1) + ' gives its label');
      }
    }
  }
});

test('removeStairwellStop refuses a well of two stops, a floor it does not stop on and a missing well or floor', () => {
  const two = clone(chain(3));
  two.building.connections = two.building.connections.slice(0, 1);
  const wellOfTwo = { ...two };
  wellOfTwo.building = { ...two.building, connections: [{ ...two.building.connections[0], well: 'A' }] };
  refused(removeStairwellStop, wellOfTwo, { well: 'A', floorId: floorId(1) }, 'two-stops', /only two stops.*Remove connection/);
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const three = run(removeStairwellStop, made, { well: 'A', floorId: floorId(4) });
  refused(removeStairwellStop, three, { well: 'A', floorId: floorId(4) }, 'missing', /does not stop on Floor 4/);
  refused(removeStairwellStop, three, { well: 'Q', floorId: floorId(2) }, 'missing');
  refused(removeStairwellStop, three, { well: 'A', floorId: 'fnowhere00' }, 'missing');
});

test('the middle stop removed rejoins with its way: down only stays down only', () => {
  const four = run(setStairwellDirection, run(makeStairwell, chain(4), { connectionId: 'cwell00001' }), { well: 'A', direction: 'down' });
  const after = run(removeStairwellStop, four, { well: 'A', floorId: floorId(3) });
  const joined = after.building.connections.find((connection) => connection.id !== 'cwell00001' && [connection.a.floorId, connection.b.floorId].includes(floorId(4)));
  assert.deepEqual([joined.a.floorId, joined.b.floorId].sort(), [floorId(2), floorId(4)]);
  assert.equal(joined.direction, joined.a.floorId === floorId(4) ? 'ab' : 'ba', 'down: from the higher end');
});

// ---------------------------------------------------------------- split, way, letter, join

test('splitStairwell: every flight shows its own letter again, in one undo step', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const { after, text } = step(made, splitStairwell, { well: 'A' }, 'Split Stairwell A into separate stairs');
  assert.deepEqual(wells(after), [undefined, undefined, undefined]);
  assert.deepEqual(letters(after), ['A', 'B', 'C']);
  assert.equal(text, 'Stairs A, B and C are separate again.');
  assert.equal(stairwells(after.building).length, 0);
  refused(splitStairwell, after, { well: 'A' }, 'missing');
});

test('setStairwellDirection: up only is up on every flight, whichever end the flight was drawn from', () => {
  const project = chain(4);
  project.building.connections[1] = { ...project.building.connections[1], a: project.building.connections[1].b, b: project.building.connections[1].a };
  const made = run(makeStairwell, project, { connectionId: 'cwell00001' });
  const { after, text } = step(made, setStairwellDirection, { well: 'A', direction: 'up' }, 'Set the way of Stairwell A to up only');
  assert.equal(flight(after, 'cwell00001').direction, 'ab');
  assert.equal(flight(after, 'cwell00002').direction, 'ba', 'drawn from the upper end, so the way up is from its b end');
  assert.equal(flight(after, 'cwell00003').direction, 'ab');
  assert.equal(text, 'Stairwell A runs up only. Applied to 3 flights.');
  // routing agrees: from Floor 1 up the stairs, never down
  const down = run(setStairwellDirection, made, { well: 'A', direction: 'down' });
  assert.equal(flight(down, 'cwell00002').direction, 'ab');
  assert.equal(flight(down, 'cwell00001').direction, 'ba');
  const both = run(setStairwellDirection, down, { well: 'A', direction: 'both' });
  assert.deepEqual(both.building.connections.map((connection) => connection.direction), ['both', 'both', 'both']);
  // the way set again changes nothing
  assert.equal(setStairwellDirection(freeze(after), { well: 'A', direction: 'up' }, ctx()), after);
  refused(setStairwellDirection, made, { well: 'A', direction: 'ab' }, 'bad-value', /both ways, up only or down only/);
  refused(setStairwellDirection, made, { well: 'Z', direction: 'up' }, 'missing');
});

test('setStairwellLetter: the letter on every flight, under the clash rule of every label', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const other = clone(made);
  other.building.connections.push({ id: 'cother0001', label: 'Q', a: { floorId: floorId(1), cell: 100 }, b: { floorId: floorId(2), cell: 100 }, direction: 'both' });
  const { after } = step(made, setStairwellLetter, { well: 'A', letter: ' North ' }, 'Rename Stairwell A to North');
  assert.deepEqual(wells(after), ['North', 'North', 'North']);
  assert.deepEqual(after.building.connections.map((connection) => connection.label), ['A', 'B', 'C'], 'the flights\' own labels stay');
  // a letter of its own flights' labels is allowed (the well is those flights)
  assert.deepEqual(wells(run(setStairwellLetter, made, { well: 'A', letter: 'b' })), ['b', 'b', 'b']);
  refused(setStairwellLetter, other, { well: 'A', letter: 'q' }, 'duplicate-label', /already a stairs connection Q/);
  const two = clone(other);
  two.building.connections.push({ id: 'cother0002', label: 'R', well: 'East', a: { floorId: floorId(1), cell: 120 }, b: { floorId: floorId(2), cell: 120 }, direction: 'both' });
  refused(setStairwellLetter, two, { well: 'A', letter: ' EAST' }, 'duplicate-label', /Stairwell East already uses that letter/);
  refused(setStairwellLetter, made, { well: 'A', letter: '   ' }, 'no-name');
  refused(setStairwellLetter, made, { well: 'A', letter: 'abcdefghi' }, 'too-long');
  assert.equal(run(setStairwellLetter, made, { well: 'A', letter: 'abcdefgh' }).building.connections[0].well, 'abcdefgh');
  assert.equal(run(setStairwellLetter, made, { well: 'A', letter: 'A' }), made, 'the same letter changes nothing');
  const lift = clone(made);
  lift.building.connections.push({ id: 'clift00001', label: 'L', kind: ELEVATOR_KIND, car: 'Lift', a: { floorId: floorId(1), cell: 100 }, b: { floorId: floorId(2), cell: 100 }, direction: 'both' });
  lift.building.floors[0].cells = lift.building.floors[0].cells.slice(0, 100) + 'S' + lift.building.floors[0].cells.slice(101);
  lift.building.floors[1].cells = lift.building.floors[1].cells.slice(0, 100) + 'S' + lift.building.floors[1].cells.slice(101);
  refused(setStairwellLetter, lift, { well: 'A', letter: 'lift' }, 'duplicate-label', /Elevator Lift already uses that letter/);
  // letters are text, shown as typed
  assert.equal(run(setStairwellLetter, made, { well: 'A', letter: '<b>"' }).building.connections[0].well, '<b>"');
});

test('joinStairwell: a well in parts gets one flight between the closest stops of consecutive parts, with its way', () => {
  const made = run(setStairwellDirection, run(makeStairwell, chain(5), { connectionId: 'cwell00001' }), { well: 'A', direction: 'up' });
  const torn = clone(made);
  torn.building.connections = torn.building.connections.filter((connection) => connection.id !== 'cwell00002');
  assert.equal(stairwells(torn.building)[0].parts, 2, 'an older planner left it in two parts');
  const { after, text } = step(torn, joinStairwell, { well: 'A' }, 'Join the parts of Stairwell A');
  assert.equal(stairwells(after.building)[0].parts, 1);
  const added = after.building.connections.find((connection) => !torn.building.connections.some((old) => old.id === connection.id));
  assert.deepEqual([added.a.floorId, added.b.floorId].sort(), [floorId(2), floorId(3)], 'the closest stops by level');
  assert.equal(added.well, 'A');
  assert.equal(added.direction, added.a.floorId === floorId(2) ? 'ab' : 'ba');
  assert.equal(text, 'Stairwell A is joined: Floor 2 to Floor 3 now has a flight between them.');
  refused(joinStairwell, after, { well: 'A' }, 'nothing-to-do');
  refused(joinStairwell, after, { well: 'Zed' }, 'missing');
});

test('joinStairwell joins three parts in two flights', () => {
  const made = run(makeStairwell, chain(7), { connectionId: 'cwell00001' });
  const torn = clone(made);
  torn.building.connections = torn.building.connections.filter((connection) => connection.id !== 'cwell00002' && connection.id !== 'cwell00004');
  assert.equal(stairwells(torn.building)[0].parts, 3);
  const after = run(joinStairwell, torn, { well: 'A' });
  assert.equal(stairwells(after.building)[0].parts, 1);
  assert.equal(after.building.connections.length, 6 - 2 + 2);
});

// SV2-135b: two parts that meet at one level (gap 0) cannot be one well. The sample's A (Floor 1 to 2 at column 13)
// and B (Floor 2 to 3 at column 34) given one letter, as a file edited elsewhere might: both stop on Floor 2.
test('joinStairwell refuses parts that both stop on one floor, and the check offers no Join for them', async () => {
  const { buildingChecks } = await import('../../engine/building-checks.js');
  const torn = clone(school());
  for (const connection of torn.building.connections) if (connection.id === 'csample00a' || connection.id === 'csample00b') connection.well = 'A';
  const well = stairwells(torn.building).find((each) => each.letter === 'A');
  assert.equal(well.parts, 2);
  refused(joinStairwell, torn, { well: 'A' }, 'floor-twice', /^Stairwell A stops twice on Floor 2: at row 9, column 13 and row 9, column 34\. A stairwell stops once on each floor, so its parts cannot be joined; split the stairwell, or remove one of those connections\.$/);
  const [finding] = buildingChecks(torn).filter((each) => each.kind === 'stairwell-split');
  assert.equal(finding.fixable, false, 'no Join the parts for a join that would be refused');
  assert.equal(finding.text, 'Stairwell A is in 2 parts: Floor 1 to Floor 2, and Floor 2 to Floor 3. Its parts both stop on Floor 2, at different stairs, so they cannot be joined; split the stairwell.');
  // split, the two flights are plain stairs again and nothing is said
  assert.deepEqual(buildingChecks(run(splitStairwell, torn, { well: 'A' })).filter((each) => each.kind === 'stairwell-split'), []);
});

// ---------------------------------------------------------------- the in-session mend

test('disconnecting a middle flight splits the well: the upper part takes a fresh letter and the summary says so', () => {
  const made = run(makeStairwell, chain(5), { connectionId: 'cwell00001' });
  const { after } = step(made, actions.disconnectStairs, { connectionId: 'cwell00002' }, 'Disconnect stairs A. Stairwell A was in two parts (Floor 1 to Floor 2, Floor 3 to Floor 5); the upper part is now Stairwell B.', false);
  assert.deepEqual(wells(after), ['A', 'B', 'B']);
  assert.equal(stairwells(after.building).length, 2);
  assert.ok(stairwells(after.building).every((well) => well.parts === 1), 'no letter is in two places');
  assert.equal(new Set(letters(after)).size, 2);
});

test('a well left whole by a disconnect is not renamed; a plain flight is disconnected as before', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const after = run(actions.disconnectStairs, made, { connectionId: 'cwell00003' });
  assert.deepEqual(wells(after), ['A', 'A']);
  const outcome = actions.buildingOutcome(after);
  assert.equal(renamedText(outcome.loss), '');
  const plain = run(actions.disconnectStairs, chain(3), { connectionId: 'cwell00001' });
  assert.equal(plain.building.connections.length, 1);
});

test('deleting a floor in the middle of a five-floor well splits it, and the summary is in the label', () => {
  const made = run(makeStairwell, chain(5), { connectionId: 'cwell00001' });
  const { after } = step(made, actions.deleteFloor, { id: floorId(3) }, 'Delete Floor 3. Stairwell A was in two parts (Floor 1 to Floor 2, Floor 4 to Floor 5); the upper part is now Stairwell B.', false);
  assert.deepEqual(wells(after), ['A', 'B']);
  assert.deepEqual(after.building.floors.map((floor) => floor.id), [1, 2, 4, 5].map(floorId));
});

test('resizing a floor so its stairs are cut splits the well', () => {
  const made = run(makeStairwell, chain(5), { connectionId: 'cwell00001' });
  const cut = actions.resizeFloor;
  const after = run(cut, made, { floorId: floorId(3), right: -28 });
  assert.deepEqual(wells(after), ['A', 'B']);
  const outcome = actions.buildingOutcome(after);
  assert.equal(renamedText(outcome.loss), 'Stairwell A was in two parts (Floor 1 to Floor 2, Floor 4 to Floor 5); the upper part is now Stairwell B.');
});

test('erasing or painting over the middle stairs splits the well, and the label of the step says what became of it', () => {
  const made = run(makeStairwell, chain(5), { connectionId: 'cwell00001' });
  const said = 'Stairwell A was in two parts (Floor 1 to Floor 2, Floor 4 to Floor 5); the upper part is now Stairwell B.';
  for (const [act, payload] of [[actions.eraseCells, { floorId: floorId(3), cells: [CELL] }], [actions.paintCorridor, { floorId: floorId(3), cells: [CELL], over: 'replace' }], [actions.placeLift, { floorId: floorId(3), cells: [CELL], over: 'replace' }]]) {
    const start = freeze(made);
    const store = createStore({ project: start, clock, ids: makeIds(12) });
    store.apply(act, payload);
    assert.equal(store.history.past.length, 1, 'one undo step');
    assert.ok(store.undoLabel.endsWith(said), store.undoLabel);
    assert.deepEqual(wells(store.project), ['A', 'B'], 'only the flights not touching Floor 3 are left, and no letter is in two places');
    assertValid(store.project);
    store.undo();
    assert.deepEqual(store.project, start);
  }
});

test('splitWells: three parts name every fresh letter; a building with none comes back as it was', () => {
  const made = run(makeStairwell, chain(7), { connectionId: 'cwell00001' });
  const torn = clone(made);
  torn.building.connections = torn.building.connections.filter((connection) => connection.id !== 'cwell00002' && connection.id !== 'cwell00004');
  const loss = emptyLoss();
  const mended = splitWells(freeze(torn).building, loss);
  assert.equal(new Set(mended.connections.map((connection) => connection.well)).size, 3);
  assert.equal(mended.connections[0].well, 'A', 'the lowest part keeps the letter');
  assert.equal(mended.connections[1].well, mended.connections[1].well.toUpperCase());
  assert.equal(nextConnectionLabel(torn.building.connections), mended.connections[1].well, 'the first fresh letter is the first free one, as nextConnectionLabel gives it');
  assert.equal(renamedText(loss), 'Stairwell A was in 3 parts (Floor 1 to Floor 2, Floor 3 to Floor 4, Floor 5 to Floor 7); the upper parts are now Stairwell ' + mended.connections[1].well + ' and Stairwell ' + mended.connections[2].well + '.');
  assert.equal(splitWells(made.building, emptyLoss()), made.building);
  assert.equal(splitCars(made.building, emptyLoss()), made.building);
});

test('a lost stairwell flight reads as one phrase in what a change would take out', () => {
  const loss = emptyLoss();
  loss.connections.push({ id: 'x', label: 'A', well: 'A' }, { id: 'y', label: 'B', well: 'A' }, { id: 'z', label: 'Q' });
  assert.equal(lossText(loss), '2 flights of Stairwell A and stairs connection Q');
  const one = emptyLoss();
  one.connections.push({ id: 'x', label: 'A', well: 'A' });
  assert.equal(lossText(one), 'a flight of stairwell A');
  // what describing an erase says: the stairs under a stairwell
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const erase = actions.describeErase(made, { floorId: floorId(2), cells: [CELL] });
  assert.match(lossText(erase.whole.loss), /2 flights of Stairwell A/);
});

// ---------------------------------------------------------------- pasteSpaces

test('pasteSpaces carries featureIds the building still lists, each once, in the copy\'s order', () => {
  const project = clone(school());
  project.building.features = [{ id: 'hfeature01', name: 'Lab' }, { id: 'hfeature02', name: 'Sink' }];
  const source = project.building.floors[0].spaces.find((space) => space.kind === 'room');
  source.featureIds = ['hfeature02', 'hfeature01', 'hgone00000'];
  assertValid(project);
  const clip = copySpaces(project.building, { spaceIds: [source.id] });
  assert.deepEqual(clip.spaces[0].featureIds, ['hfeature02', 'hfeature01', 'hgone00000'], 'the copy carries them');
  clip.spaces[0].featureIds.push('hfeature02');
  const after = run(actions.pasteSpaces, project, { floorId: floorId(1), clip, x: 30, y: 8, over: 'replace' });
  const outcome = actions.buildingOutcome(after);
  const pasted = after.building.floors[0].spaces.find((space) => space.id === outcome.spaceIds[0]);
  assert.deepEqual(pasted.featureIds, ['hfeature02', 'hfeature01'], 'once each, in the copy\'s order, the dangling one dropped');
  // a room with none carries no field
  const plain = project.building.floors[0].spaces.filter((space) => space.kind === 'room' && space.id !== source.id)[0];
  const blank = run(actions.pasteSpaces, project, { floorId: floorId(1), clip: copySpaces(project.building, { spaceIds: [plain.id] }), x: 30, y: 8, over: 'replace' });
  const blankRoom = blank.building.floors[0].spaces.find((space) => space.id === actions.buildingOutcome(blank).spaceIds[0]);
  assert.equal('featureIds' in blankRoom, false);
  // a feature deleted from the list between copy and paste is dropped
  const gone = clone(project);
  gone.building.features = [gone.building.features[1]];
  const later = run(actions.pasteSpaces, gone, { floorId: floorId(1), clip, x: 30, y: 8, over: 'replace' });
  const laterRoom = later.building.floors[0].spaces.find((space) => space.id === actions.buildingOutcome(later).spaceIds[0]);
  assert.deepEqual(laterRoom.featureIds, ['hfeature02']);
});

// ---------------------------------------------------------------- readers of the letter

test('every engine reader of list A asks stairsLetter: the graph, places, blocked words and the evacuation route say the well\'s letter', async () => {
  const made = run(makeStairwell, chain(3), { connectionId: 'cwell00001' });
  const second = made.building.connections[1];
  assert.equal(second.label, 'B', 'the flight\'s own label underneath');
  const { stairsName } = await import('../../engine/blocked.js');
  assert.equal(stairsName(made, second), 'Stairs A, Floor 2 to Floor 3');
  const graph = buildGraph(made);
  assert.deepEqual(graph.links.map((link) => link.label), ['A', 'A']);
  const { createPipeline } = await import('../../engine/worker.js');
  const places = createPipeline().run(made).places || null;
  const lines = JSON.stringify(places);
  if (places) assert.equal(/Stairs B/.test(lines), false, 'no place is called Stairs B');
  const plainStairs = stairsName(chain(3), chain(3).building.connections[1]);
  assert.equal(plainStairs, 'Stairs B, Floor 2 to Floor 3');
});

test('the words of the actions say the well\'s letter: disconnect and setConnection name the stairs by it, and setConnection will not take a well\'s letter', () => {
  const made = run(makeStairwell, chain(4), { connectionId: 'cwell00001' });
  const start = freeze(made);
  const store = createStore({ project: start, clock, ids: makeIds(14) });
  store.apply(actions.setConnection, { connectionId: 'cwell00002', direction: 'ab' });
  assert.equal(store.undoLabel, 'Change stairs connection A', 'the flight whose label is B reads A');
  refused(actions.setConnection, chain(3).building ? { ...made, building: { ...made.building, connections: made.building.connections.map((c) => (c.id === 'cwell00001' ? { ...c, well: undefined } : c)) } } : made, { connectionId: 'cwell00001', label: 'a' }, 'duplicate-label');
});

test('nextConnectionLabel at every caller reads well letters: a plain flight never takes a well\'s letter', () => {
  const lettered = run(setStairwellLetter, run(makeStairwell, chain(3), { connectionId: 'cwell00001' }), { well: 'A', letter: 'C' });
  const extra = clone(lettered);
  for (const n of [1, 2]) extra.building.floors[n - 1].cells = extra.building.floors[n - 1].cells.slice(0, 60) + 'S' + extra.building.floors[n - 1].cells.slice(61);
  // labels are A and B, the well is C: the next plain flight is D
  const joined = run(actions.connectStairs, extra, { a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 } });
  assert.equal(joined.building.connections[2].label, 'D');
  assert.equal(nextConnectionLabel(lettered.building.connections), 'D');
});

// ---------------------------------------------------------------- compare-buildings

test('compare-buildings pairs plain stairs A and B with a stairwell A over the same floors and says "now one stairwell"', () => {
  const before = chain(3);
  const after = run(makeStairwell, before, { connectionId: 'cwell00001' });
  const answer = compareBuildings(before, createPipeline().run(before), after, createPipeline().run(after));
  const stairs = (list) => list.filter((place) => place.kind === 'stairs');
  assert.deepEqual(stairs(answer.places.gone), [], 'no stairs is gone');
  assert.deepEqual(stairs(answer.places.new), [], 'no stairs is new');
  assert.deepEqual(answer.places.stairwells, [{ kind: 'now', letter: 'A', names: ['A', 'B'], sentence: 'Stairs A and B are now one stairwell, A.' }]);
  assert.equal(stairs(answer.places.ambiguous).length, 0);
  // and the other way: a stairwell that came apart
  const back = compareBuildings(after, createPipeline().run(after), before, createPipeline().run(before));
  assert.deepEqual(back.places.stairwells, [{ kind: 'no-longer', letter: 'A', names: ['A', 'B'], sentence: 'Stairwell A is no longer one stairwell: it is now stairs A and B.' }]);
  assert.deepEqual(stairs(back.places.gone).concat(stairs(back.places.new)), []);
  // two plain flights unchanged say nothing
  assert.deepEqual(compareBuildings(before, createPipeline().run(before), before, createPipeline().run(before)).places.stairwells, []);
});

test('compare-buildings shows a changed load on a stairs that became a stairwell as one row, with the sentence', () => {
  const before = chain(3);
  const after = run(makeStairwell, before, { connectionId: 'cwell00001' });
  // fewer groups on the other side so that the stairs' loads differ
  const quieter = clone(after);
  quieter.groups = quieter.groups.slice(0, 1);
  const answer = compareBuildings(before, createPipeline().run(before), quieter, createPipeline().run(quieter));
  const rows = answer.places.busier.concat(answer.places.quieter, answer.places.changed).filter((row) => row.kind === 'stairs');
  assert.ok(rows.length >= 1, 'the stairs have rows');
  const paired = rows.find((row) => row.stairwell);
  assert.ok(paired, 'the flight that took the well\'s letter is paired with B by its floors');
  assert.equal(paired.stairwell, 'now one stairwell');
  assert.equal(paired.name, 'B');
  assert.equal(paired.nameAfter, 'A');
  assert.equal(answer.places.new.concat(answer.places.gone).filter((place) => place.kind === 'stairs').length, 0);
});

// ---------------------------------------------------------------- routing

// every route between two rooms and to the exit, under the three plans, with
// the stairs' letters taken out (a well changes only what a flight is called)
function digest(project) {
  const graph = routingGraph(project);
  const ids = Array.from(graph.rooms.keys()).sort();
  const canonical = (value) => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).filter((key) => key !== 'label' && key !== 'rides').sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value === undefined ? null : value);
  };
  const hash = createHash('sha256');
  let count = 0;
  for (const options of [{}, { avoidStairs: true }, { undirected: true }]) {
    for (const from of ids) {
      for (const to of ids) {
        hash.update(canonical(route(graph, from, to, options)) + '\n');
        count += 1;
      }
      hash.update(canonical(routeToExit(graph, from, options)) + '\n');
      count += 1;
    }
  }
  return { count, sha: hash.digest('hex') };
}

test('routing is unchanged when a chain is made a well: every route of the sample\'s rooms, under three plans, is the same walk', () => {
  const plain = chain(3);
  const made = run(makeStairwell, plain, { connectionId: 'cwell00001' });
  const a = digest(plain);
  const b = digest(made);
  assert.ok(a.count > 100, 'the cases cover the sample\'s routes (' + a.count + ')');
  assert.equal(b.sha, a.sha);
  // and a split back, and one-way set on both: the plain flights agree with the well
  const split = run(splitStairwell, made, { well: 'A' });
  assert.equal(digest(split).sha, a.sha);
  const oneWayPlain = clone(plain);
  for (const connection of oneWayPlain.building.connections) connection.direction = 'ab';
  assert.equal(digest(run(setStairwellDirection, made, { well: 'A', direction: 'up' })).sha, digest(oneWayPlain).sha);
});

test('directions say "Take stairs A up to Floor 3" once for a walk up a whole stairwell', () => {
  const made = run(makeStairwell, chain(3), { connectionId: 'cwell00001' });
  const rooms = made.building.floors.flatMap((floor) => floor.spaces.filter((space) => space.kind === 'room').map((space) => ({ floor, space })));
  const low = rooms.find((entry) => entry.floor.id === floorId(1));
  const high = rooms.find((entry) => entry.floor.id === floorId(3));
  const found = route(routingGraph(made), low.space.id, high.space.id);
  assert.equal(found.failure || null, null);
  const text = directions(made, found).text;
  assert.match(text, /[Ss]tairs A/);
  assert.equal(/[Ss]tairs B/.test(text), false, text);
});

// ---------------------------------------------------------------- review fixes (SV2-128b)

// Wells A (flights A, B) on Floors 1 to 3 and C (flights C, D) on Floors 1 to 3 at another column.
function twoWells() {
  const project = chain(3);
  const other = [4, 5];
  for (const n of [1, 2, 3]) project.building.floors[n - 1].cells = project.building.floors[n - 1].cells.slice(0, 60) + 'S' + project.building.floors[n - 1].cells.slice(61);
  project.building.connections.push({ id: 'cwell00011', label: 'C', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' }, { id: 'cwell00012', label: 'D', a: { floorId: floorId(2), cell: 60 }, b: { floorId: floorId(3), cell: 60 }, direction: 'both' });
  assert.equal(other.length, 2);
  const a = run(makeStairwell, project, { connectionId: 'cwell00001' });
  return run(makeStairwell, a, { connectionId: 'cwell00011' });
}

test('setStairwellLetter and makeStairwell refuse a letter that is the label of a flight inside another well', () => {
  const both = twoWells();
  assert.deepEqual(wells(both), ['A', 'A', 'C', 'C']);
  refused(setStairwellLetter, both, { well: 'A', letter: 'D' }, 'duplicate-label', /already a stairs connection D\./);
  refused(setStairwellLetter, both, { well: 'A', letter: 'c' }, 'duplicate-label', /Stairwell C already uses/);
  const project = chain(3);
  for (const n of [1, 2, 3]) project.building.floors[n - 1].cells = project.building.floors[n - 1].cells.slice(0, 60) + 'S' + project.building.floors[n - 1].cells.slice(61);
  project.building.connections.push({ id: 'cwell00011', label: 'C', a: { floorId: floorId(1), cell: 60 }, b: { floorId: floorId(2), cell: 60 }, direction: 'both' }, { id: 'cwell00012', label: 'D', a: { floorId: floorId(2), cell: 60 }, b: { floorId: floorId(3), cell: 60 }, direction: 'both' });
  const made = run(makeStairwell, project, { connectionId: 'cwell00011' });
  refused(makeStairwell, made, { connectionId: 'cwell00001', letter: 'D' }, 'duplicate-label', /already a stairs connection D\./);
  assert.deepEqual(wells(run(makeStairwell, made, { connectionId: 'cwell00001', letter: 'A' })).slice(0, 2), ['A', 'A']);
});

test('removeStairwellStop: a plain flight that already joins the stops either side takes the well, so no stop is lost', () => {
  const project = chain(4);
  project.building.connections.push({ id: 'cwell00009', label: 'Z', a: { floorId: floorId(1), cell: CELL }, b: { floorId: floorId(3), cell: CELL }, direction: 'both' });
  const made = clone(run(makeStairwell, project, { connectionId: 'cwell00001' }));
  assert.equal(made.building.connections.find((connection) => connection.id === 'cwell00009').well, 'A', 'the run takes Z in too');
  delete made.building.connections.find((connection) => connection.id === 'cwell00009').well;
  const { after, text } = step(made, removeStairwellStop, { well: 'A', floorId: floorId(2) }, 'Remove Floor 2 from Stairwell A');
  assert.equal(flight(after, 'cwell00009').well, 'A');
  assert.deepEqual(stairwells(after.building)[0].stops.map((stop) => stop.floorId), [1, 3, 4].map(floorId), 'Floor 1 is still a stop');
  assert.equal(stairwells(after.building)[0].parts, 1);
  assert.equal(text, 'Floor 2 is out of Stairwell A: stairs Z already joined Floor 1 and Floor 3, so that flight is now part of Stairwell A (no new flight, no new letter), and the stairs on Floor 2 stay, connected to nothing, so Checks will warn about them until you connect or remove them.', 'SV2-142b: worded as the joining flight\'s toast is');
  // a way the removed flights agreed on is written on it
  const down = run(setStairwellDirection, made, { well: 'A', direction: 'down' });
  delete flight(down, 'cwell00009').well;
  const gone = run(removeStairwellStop, down, { well: 'A', floorId: floorId(2) });
  assert.equal(flight(gone, 'cwell00009').direction, 'ba', 'down only, from the higher end');
});

test('stairwellThrough refuses a chosen cell that is already a stop of another well', () => {
  const project = chain(4);
  for (const id of ['cwell00001', 'cwell00002']) flight(project, id).well = 'A';
  refused(stairwellThrough, project, { floorId: floorId(1), cell: CELL, floorIds: [floorId(3), floorId(4)] }, 'already-well', /^Floor 1, row 9, column 13 is already a stop of Stairwell A\.$/);
});

test('directionForWay keeps the direction of a flight between two floors at the same level', () => {
  const project = chain(4);
  project.building.floors[2] = { ...project.building.floors[2], level: project.building.floors[1].level };
  const made = clone(run(makeStairwell, chain(4), { connectionId: 'cwell00001' }));
  made.building.floors[2] = { ...made.building.floors[2], level: made.building.floors[1].level };
  made.building.connections[1] = { ...made.building.connections[1], direction: 'ab' };
  const up = run(setStairwellDirection, made, { well: 'A', direction: 'up' });
  assert.equal(up.building.connections[1].direction, 'ab', 'a same-level flight keeps its own way');
  const both = clone(made);
  both.building.connections[1] = { ...both.building.connections[1], direction: 'both' };
  assert.equal(run(setStairwellDirection, both, { well: 'A', direction: 'down' }).building.connections[1].direction, 'both');
});

test('removeStairwellStop refuses a well in parts', () => {
  const made = run(makeStairwell, chain(5), { connectionId: 'cwell00001' });
  const parts = clone(made);
  parts.building.connections = parts.building.connections.filter((connection) => connection.id !== 'cwell00002');
  assert.equal(stairwells(parts.building)[0].parts, 2);
  refused(removeStairwellStop, parts, { well: 'A', floorId: floorId(1) }, 'well-parts', /is in 2 parts that share no stairs\. Join the parts first, then remove a stop\.$/);
});
