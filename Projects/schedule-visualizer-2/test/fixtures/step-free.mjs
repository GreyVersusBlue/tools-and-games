// Fixtures for the step-free model (ARCHITECTURE 19.2): the sample school with
// an elevator drawn the way W4 stores it, and a table of ways to break each
// new rule, from absent, malformed and contradictory data and from an older
// tool's file. validate.test.mjs checks each is found where `where` says;
// repair.test.mjs checks repair puts each right as `after` says. Every name
// here is invented.
//
// The sample's three floors have a 40 by 14 grid. Row 7 is corridor, row 8
// holds the stairs: cell 332 on Floors 1 and 2 (connection A) and cell 353 on
// Floors 2 and 3 (connection B). Cell 283 is the corridor cell Room 101's
// door faces, cell 281 and 282 are corridor beside it, cell 70 is in the gym.

import { school, clone } from '../engine/helpers.mjs';

export const F1 = 'fsample001';
export const F2 = 'fsample002';
export const F3 = 'fsample003';

export function paint(floor, cell, character) {
  floor.cells = floor.cells.slice(0, cell) + character + floor.cells.slice(cell + 1);
}

// The sample school with connection A made an elevator (staff only, car "A")
// and every other new field present and sound.
export function withElevator() {
  const project = school();
  const [f1, f2] = project.building.floors;
  const a = project.building.connections[0];
  a.kind = 'elevator';
  a.staffOnly = true;
  a.car = 'A';
  f1.lifts = [332];
  f2.lifts = [332];
  f1.notStepFree = [281, 282];
  f1.refuges = [{ id: 'asample001', cell: 283, name: 'Area of refuge' }];
  f1.spaces[0].doors[0].stepFree = false;
  f1.exits[1].stepFree = false;
  project.groups[0].stepFree = true;
  project.settings.elevatorWaitSeconds = 45;
  project.settings.elevatorSecondsPerFloor = 5;
  project.settings.elevatorPeoplePerTrip = 6;
  return project;
}

const floor = (project, n) => project.building.floors[n];
const conn = (project, label) => project.building.connections.find((connection) => connection.label === label);

// An elevator stop on a floor with no connection yet.
function addStop(project, n, cell) {
  const f = floor(project, n);
  paint(f, cell, 'S');
  f.lifts = (f.lifts || []).concat(cell);
}

function addConnection(project, label, a, b, extra) {
  project.building.connections.push({ id: 'csample0' + label.toLowerCase() + '0', label, a, b, direction: 'both', ...extra });
}

const at = (floorId, cell) => ({ floorId, cell });

// [name, mutate(project), where (a validate path), after(project, notes)]. `after`
// asserts what repair left, with node:assert passed in.
export const STEP_FREE_BREAKS = [
  // ---- settings
  ['an elevator wait of 301 seconds', (p) => { p.settings.elevatorWaitSeconds = 301; }, /^settings\.elevatorWaitSeconds$/, (p, a) => a.equal('elevatorWaitSeconds' in p.settings, false)],
  ['an elevator ride of 0 seconds a floor', (p) => { p.settings.elevatorSecondsPerFloor = 0; }, /^settings\.elevatorSecondsPerFloor$/, (p, a) => a.equal('elevatorSecondsPerFloor' in p.settings, false)],
  ['41 people to a trip', (p) => { p.settings.elevatorPeoplePerTrip = 41; }, /^settings\.elevatorPeoplePerTrip$/, (p, a) => a.equal('elevatorPeoplePerTrip' in p.settings, false)],
  ['an elevator wait that is text', (p) => { p.settings.elevatorWaitSeconds = 'soon'; }, /^settings\.elevatorWaitSeconds$/, (p, a) => a.equal('elevatorWaitSeconds' in p.settings, false)],
  ['an elevator wait of 1.5 seconds', (p) => { p.settings.elevatorWaitSeconds = 1.5; }, /^settings\.elevatorWaitSeconds$/, (p, a) => a.equal('elevatorWaitSeconds' in p.settings, false)],

  // ---- the group flag, the door and exit flags
  ['a group flag that is text', (p) => { p.groups[0].stepFree = 'yes'; }, /^groups\[0\]\.stepFree$/, (p, a) => a.equal('stepFree' in p.groups[0], false)],
  ['a door flag that is text', (p) => { floor(p, 0).spaces[1].doors[0].stepFree = 'no'; }, /^building\.floors\[0\]\.spaces\[1\]\.doors\[0\]\.stepFree$/, (p, a) => a.equal('stepFree' in floor(p, 0).spaces[1].doors[0], false)],
  ['an exit flag that is a number', (p) => { floor(p, 0).exits[0].stepFree = 3; }, /^building\.floors\[0\]\.exits\[0\]\.stepFree$/, (p, a) => a.equal('stepFree' in floor(p, 0).exits[0], false)],

  // ---- a connection's own fields
  ['a connection kind that is not elevator', (p) => { conn(p, 'A').kind = 'lift'; }, /^building\.connections\[0\]\.kind$/, (p, a) => a.equal('kind' in conn(p, 'A'), false)],
  ['staff only that is text', (p) => { conn(p, 'A').staffOnly = 'yes'; }, /^building\.connections\[0\]\.staffOnly$/, (p, a) => a.equal(conn(p, 'A').staffOnly, undefined)],
  ['an elevator letter that is empty', (p) => { conn(p, 'A').car = ' '; }, /^building\.connections\[0\]\.car$/, (p, a) => a.equal(conn(p, 'A').car, 'A', 'the connection\'s own label')],
  ['staff only on a stairs connection', (p) => { conn(p, 'B').staffOnly = true; }, /^building\.connections\[1\]\.staffOnly$/, (p, a) => a.equal('staffOnly' in conn(p, 'B'), false)],
  ['an elevator letter on a stairs connection', (p) => { conn(p, 'B').car = 'Q'; }, /^building\.connections\[1\]\.car$/, (p, a) => a.equal('car' in conn(p, 'B'), false)],
  ['a one-way elevator', (p) => { conn(p, 'A').direction = 'ab'; }, /^building\.connections\[0\]\.direction$/, (p, a) => a.equal(conn(p, 'A').direction, 'both')],
  ['an elevator joining two cells on one floor', (p) => { paint(floor(p, 0), 333, 'S'); conn(p, 'A').b = at(F1, 333); }, /^building\.connections\[0\]$/, (p, a) => {
    a.equal(conn(p, 'A').kind, undefined, 'it is a stairs connection now');
    a.equal('staffOnly' in conn(p, 'A') || 'car' in conn(p, 'A'), false);
    a.deepEqual(floor(p, 0).lifts, [], 'and its stop is no longer listed');
  }],

  // ---- contradictory: kinds, stops and cars
  ['a cell that carries an elevator and a stairs connection', (p) => { addConnection(p, 'D', at(F1, 332), at(F3, 353)); }, /^building\.connections$/, (p, a) => {
    a.equal(p.building.connections.some((connection) => connection.label === 'D'), false, 'the stairs one went');
    a.equal(conn(p, 'A').kind, 'elevator');
  }],
  ['an elevator with two stops on one floor', (p) => { addStop(p, 0, 333); addConnection(p, 'E', at(F2, 332), at(F1, 333), { kind: 'elevator', staffOnly: true, car: 'A' }); }, /^building\.connections\[2\]$/, (p, a) => {
    a.equal(p.building.connections.some((connection) => connection.label === 'E'), false, 'the later connection went');
    a.equal(conn(p, 'A').kind, 'elevator');
  }],
  ['unequal staff only across one elevator', (p) => { addStop(p, 2, 354); addConnection(p, 'F', at(F2, 332), at(F3, 354), { kind: 'elevator', car: 'A' }); }, /^building\.connections\[0\]\.staffOnly$/, (p, a) => {
    a.equal(conn(p, 'F').staffOnly, true, 'true wins');
    a.equal(conn(p, 'A').staffOnly, true);
  }],
  ['unequal letters across one elevator', (p) => { addStop(p, 2, 354); addConnection(p, 'F', at(F2, 332), at(F3, 354), { kind: 'elevator', staffOnly: true, car: 'Z' }); }, /^building\.connections\[0\]\.car$/, (p, a) => {
    a.equal(conn(p, 'F').car, 'A', 'the first connection\'s letter');
  }],
  ['an elevator connection with no letter, joined to one that has it', (p) => { addStop(p, 2, 354); addConnection(p, 'F', at(F2, 332), at(F3, 354), { kind: 'elevator', staffOnly: true }); }, null, (p, a) => {
    a.equal(conn(p, 'F').car, 'A');
  }],

  // ---- lifts
  ['a lift cell that is not stairs', (p) => { floor(p, 0).lifts.push(5); }, /^building\.floors\[0\]\.lifts\[1\]$/, (p, a) => a.deepEqual(floor(p, 0).lifts, [332])],
  ['a lift cell off the floor', (p) => { floor(p, 0).lifts.push(99999); }, /^building\.floors\[0\]\.lifts\[1\]$/, (p, a) => a.deepEqual(floor(p, 0).lifts, [332])],
  ['a lift cell listed twice', (p) => { floor(p, 0).lifts.push(332); }, /^building\.floors\[0\]\.lifts\[1\]$/, (p, a) => a.deepEqual(floor(p, 0).lifts, [332])],
  ['lifts that is not a list', (p) => { floor(p, 0).lifts = 'x'; }, /^building\.floors\[0\]\.lifts$/, (p, a) => a.equal('lifts' in floor(p, 0), false)],
  ['a lift cell an older tool joined as stairs', (p) => { delete conn(p, 'A').kind; delete conn(p, 'A').car; delete conn(p, 'A').staffOnly; }, /^building\.floors\[[01]\]\.lifts\[0\]$/, (p, a) => {
    a.deepEqual(floor(p, 0).lifts, []);
    a.deepEqual(floor(p, 1).lifts, []);
    a.equal(conn(p, 'A').kind, undefined, 'repair never sets a kind');
  }],
  ['stale lifts after an older resize', (p) => { floor(p, 2).lifts = [353, 700, 12]; }, /^building\.floors\[2\]\.lifts\[\d\]$/, (p, a) => {
    a.deepEqual(floor(p, 2).lifts, [], 'cell 353 carries stairs connection B, 700 is off the floor, 12 is empty');
  }],
  ['an unconnected stop with a door facing it', (p) => { addStop(p, 0, 283); }, /^building\.floors\[0\]\.spaces\[0\]\.doors\[0\]$/, (p, a) => {
    a.deepEqual(floor(p, 0).spaces[0].doors, [], 'the door went');
    a.ok(floor(p, 0).lifts.includes(283), 'repair never takes a stop off for a door');
  }],
  ['a door facing the end of an elevator connection (no lifts list)', (p) => { delete floor(p, 0).lifts; paint(floor(p, 0), 283, 'S'); paint(floor(p, 1), 333, 'S'); addConnection(p, 'G', at(F1, 283), at(F2, 333), { kind: 'elevator' }); }, /^building\.floors\[0\]\.spaces\[0\]\.doors\[0\]$/, (p, a) => {
    a.deepEqual(floor(p, 0).spaces[0].doors, []);
  }],
  ['a lift cell that is an exit', (p) => { paint(floor(p, 0), 319, 'S'); floor(p, 0).lifts.push(319); }, /^building\.floors\[0\]\.exits\[1\]\.cell$/, (p, a) => {
    a.equal(floor(p, 0).exits.length, 1, 'the exit went (an exit is on a corridor cell)');
  }],

  // ---- steps
  ['a step on a room cell', (p) => { floor(p, 0).notStepFree.push(70); }, /^building\.floors\[0\]\.notStepFree\[2\]$/, (p, a) => a.deepEqual(floor(p, 0).notStepFree, [281, 282])],
  ['a step listed twice', (p) => { floor(p, 0).notStepFree.push(281); }, /^building\.floors\[0\]\.notStepFree\[2\]$/, (p, a) => a.deepEqual(floor(p, 0).notStepFree, [281, 282])],
  ['a step on a stairs cell', (p) => { floor(p, 0).notStepFree.push(332); }, /^building\.floors\[0\]\.notStepFree\[2\]$/, (p, a) => a.deepEqual(floor(p, 0).notStepFree, [281, 282])],
  ['steps that are not a list', (p) => { floor(p, 0).notStepFree = 7; }, /^building\.floors\[0\]\.notStepFree$/, (p, a) => a.equal('notStepFree' in floor(p, 0), false)],

  // ---- refuges
  ['a refuge on a lift cell', (p) => { floor(p, 0).refuges.push({ id: 'asample002', cell: 332, name: 'By the lift' }); }, /^building\.floors\[0\]\.refuges\[1\]\.cell$/, (p, a) => a.equal(floor(p, 0).refuges.length, 1)],
  ['a refuge on a room cell', (p) => { floor(p, 0).refuges.push({ id: 'asample002', cell: 70, name: 'In the gym' }); }, /^building\.floors\[0\]\.refuges\[1\]\.cell$/, (p, a) => a.equal(floor(p, 0).refuges.length, 1)],
  ['two refuges on one cell', (p) => { floor(p, 0).refuges.push({ id: 'asample002', cell: 283, name: 'Again' }); }, /^building\.floors\[0\]\.refuges\[1\]\.cell$/, (p, a) => a.equal(floor(p, 0).refuges.length, 1)],
  ['two refuges named alike but for capitals', (p) => { floor(p, 0).refuges.push({ id: 'asample002', cell: 282, name: 'AREA OF REFUGE' }); }, /^building\.floors\[0\]\.refuges\[1\]\.name$/, (p, a) => a.deepEqual(floor(p, 0).refuges.map((refuge) => refuge.name), ['Area of refuge', 'AREA OF REFUGE (2)'])],
  ['a refuge with no name', (p) => { delete floor(p, 0).refuges[0].name; }, /^building\.floors\[0\]\.refuges\[0\]\.name$/, (p, a) => a.equal(floor(p, 0).refuges[0].name, 'Area of refuge')],
  ['a refuge with the id of a floor', (p) => { floor(p, 0).refuges[0].id = 'fsample003'; }, /^building\.floors\[0\]\.refuges\[0\]\.id$/, (p, a) => {
    a.match(floor(p, 0).refuges[0].id, /^a[a-z0-9]{9}$/);
  }],
  ['a refuge that is not an object', (p) => { floor(p, 0).refuges.push(4); }, /^building\.floors\[0\]\.refuges\[1\]$/, (p, a) => a.equal(floor(p, 0).refuges.length, 1)],
  ['refuges that are not a list', (p) => { floor(p, 0).refuges = {}; }, /^building\.floors\[0\]\.refuges$/, (p, a) => a.equal('refuges' in floor(p, 0), false)],
];

export function brokenElevator(entry) {
  const project = clone(withElevator());
  entry[1](project);
  return project;
}
