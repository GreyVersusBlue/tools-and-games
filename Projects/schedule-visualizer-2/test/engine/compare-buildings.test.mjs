// Comparing two buildings (engine/compare-buildings.js, ARCHITECTURE 21.3 and
// 21.10, SV2-114), in plain Node: node test/engine/compare-buildings.test.mjs
//
// The figures are compareResults' where the two files are one building; a
// wing added, a renamed corridor, two corridors of one name, groups on one
// side, no day type in common, hostile names, both result shapes, and the
// time it takes at the size the tool promises (spec 3.13). Nothing here reads
// a clock: the engine takes none, and the timing is measured by the test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBuildings, UNNAMED_SENTENCE } from '../../engine/compare-buildings.js';
import { compareResults, applyChanges, trimResult } from '../../engine/scenario.js';
import { createPipeline } from '../../engine/worker.js';
import { allRooms } from '../../engine/schema.js';
import { bigProject } from '../fixtures/big.mjs';
import { school, clone, assertValid, group } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const SLACK = 2; // as every timing file here: a CI runner is not this machine
const BUDGET_MS = 200;

const run = (project) => createPipeline().run(project);

// The sample school with a wing: a Floor 4 built from Floor 3's drawing, its
// corridor named "Wing Corridor", two rooms numbered 401 and 402, stairs E
// from Floor 3, and a group 8W scheduled into the wing all day on both days.
function withWing(base) {
  const project = clone(base || school());
  const three = project.building.floors.find((floor) => floor.id === 'fsample003');
  const four = clone(three);
  four.id = 'fwing00004';
  four.name = 'Floor 4';
  four.level = 4;
  four.image = null;
  const stairs = 5 + 8 * four.width;
  four.cells = four.cells.slice(0, stairs) + 'S' + four.cells.slice(stairs + 1);
  three.cells = three.cells.slice(0, stairs) + 'S' + three.cells.slice(stairs + 1);
  four.corridors = [{ id: 'kwing00001', name: 'Wing Corridor', cells: four.cells.split('').map((c, i) => (c === '#' ? i : -1)).filter((i) => i >= 0) }];
  four.spaces = four.spaces.slice(0, 2).map((space, index) => ({ ...space, id: 'rwing000' + (index + 1) + '0', number: '40' + (index + 1), wing: 'Wing', teacherIds: [], doors: space.doors.slice() }));
  four.exits = [];
  project.building.floors.push(four);
  project.building.connections.push({ id: 'cwing000e1', label: 'E', a: { floorId: 'fsample003', cell: stairs }, b: { floorId: 'fwing00004', cell: stairs }, direction: 'both' });
  const wingGroup = clone(group(project, '6A'));
  wingGroup.id = 'gwing00008';
  wingGroup.name = '8W';
  wingGroup.grade = '8';
  for (const dayTypeId of Object.keys(wingGroup.days)) {
    wingGroup.days[dayTypeId] = wingGroup.days[dayTypeId].map((slot, period) => ({ ...slot, room: period % 2 === 0 ? 'rwing00010' : 'rwing00020', teacherIds: [] }));
  }
  project.groups.push(wingGroup);
  return project;
}


// Stairs A (Floor 1 to 2) drawn as Elevator D: car letter D, label "Lift" (the
// name is the letter, as elevatorCars has it). Stairs B stays stairs.
function withElevator(base) {
  const project = clone(base || school());
  const connection = project.building.connections.find((candidate) => candidate.id === 'csample00a');
  connection.kind = 'elevator';
  connection.car = 'D';
  connection.label = 'Lift';
  connection.staffOnly = false;
  for (const end of [connection.a, connection.b]) {
    const floor = project.building.floors.find((candidate) => candidate.id === end.floorId);
    floor.lifts = [...(floor.lifts || []), end.cell];
  }
  return project;
}

// ... and the car gains a stop on Floor 3, a corridor cell turned into a stop.
function withNewStop(base) {
  const project = clone(base);
  const three = project.building.floors.find((floor) => floor.id === 'fsample003');
  const cell = three.corridors[1].cells[3];
  three.cells = three.cells.slice(0, cell) + 'S' + three.cells.slice(cell + 1);
  three.corridors[1].cells = three.corridors[1].cells.filter((c) => c !== cell);
  three.lifts = [cell];
  project.building.connections.push({ id: 'cext0000d2', label: 'D2', kind: 'elevator', car: 'D', staffOnly: false, a: { floorId: 'fsample002', cell: 332 }, b: { floorId: 'fsample003', cell }, direction: 'both' });
  return project;
}

const floorOf = (project, id) => project.building.floors.find((floor) => floor.id === id);
const everyPlace = (answer) => answer.places.busier.concat(answer.places.quieter, answer.places.changed);

// A finding of the sample school's double booking, copied and pointed at
// other ids, to hand to compareBuildings in a result of our own.
function withFindings(result, list) {
  const trimmed = trimResult(result);
  return { ...trimmed, findings: { ...trimmed.findings, findings: list } };
}

function corridor(project, name) {
  for (const floor of project.building.floors) for (const found of floor.corridors) if (found.name === name) return found;
  throw new Error('no corridor ' + name);
}

const plain = (view) => JSON.parse(JSON.stringify(view));

// compareResults' figures as the cross-building answer gives them: its busiest
// has no node or link indices, and the answer adds onlyBefore and onlyAfter.
function acrossBuildings(figures) {
  const copy = plain(figures);
  for (const side of ['before', 'after']) if (copy.busiest[side]) { delete copy.busiest[side].node; delete copy.busiest[side].link; }
  return copy;
}
function sameFigures(answer, want) {
  const got = plain(answer);
  delete got.onlyBefore;
  delete got.onlyAfter;
  assert.deepEqual(got, acrossBuildings(want));
}

// ---------------------------------------------------------------- the same building

test('the same building gives compareResults\' figures, every difference 0', () => {
  const project = school();
  const result = run(project);
  const answer = compareBuildings(project, result, clone(project), run(clone(project)));
  const want = compareResults(result, result, { dayTypeId: A });
  sameFigures(answer.figures, want.figures);
  assert.equal(answer.matched.dayTypeName, 'A Day');
  assert.deepEqual(answer.matched.dayTypes, ['A Day', 'B Day']);
  assert.deepEqual(answer.rooms, { same: allRooms(project).length, added: [], removed: [] });
  assert.deepEqual(answer.groups.onlyBefore, []);
  assert.deepEqual(answer.groups.onlyAfter, []);
  assert.deepEqual(answer.places.busier, []);
  assert.deepEqual(answer.places.quieter, []);
  assert.deepEqual(answer.places.new, []);
  assert.deepEqual(answer.places.gone, []);
  assert.deepEqual(answer.places.ambiguous, []);
  assert.deepEqual(answer.findings.new, []);
  assert.deepEqual(answer.findings.resolved, []);
  assert.equal(answer.findings.unchanged.length, want.findings.unchanged.length);
});

test('two schedules of one building: figures, group rows and findings are compareResults\' by name', () => {
  const before = school();
  const after = applyChanges(before, { changes: [{ kind: 'move', dayTypeId: A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' }] });
  const resultBefore = run(before);
  const resultAfter = run(after);
  const answer = compareBuildings(before, resultBefore, after, resultAfter, { dayTypeName: 'a day' });
  const want = compareResults(resultBefore, resultAfter, { dayTypeId: A });
  sameFigures(answer.figures, want.figures);
  assert.ok(answer.findings.resolved.length + answer.findings.new.length > 0, 'the move changed something');
  const names = new Map(before.groups.map((g) => [g.id, g.name]));
  assert.deepEqual(answer.groups.rows.map((row) => row.name), want.groups.map((row) => names.get(row.groupId)));
  assert.deepEqual(answer.groups.rows.map((row) => row.difference), want.groups.map((row) => row.difference));
  assert.deepEqual(answer.findings.new.map((f) => f.id), want.findings.new.map((f) => f.id));
  assert.deepEqual(answer.findings.resolved.map((f) => f.id), want.findings.resolved.map((f) => f.id));
  assert.deepEqual(answer.findings.unchanged.map((f) => f.id), want.findings.unchanged.map((f) => f.id));
});

// ---------------------------------------------------------------- a wing added

test('a wing added: its rooms are added, its corridor and stairs are new, its group is only after', () => {
  const before = school();
  const after = withWing(before);
  assertValid(after, 'the fixture is a valid project');
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.rooms.added, ['401', '402']);
  assert.deepEqual(answer.rooms.removed, []);
  assert.equal(answer.rooms.same, allRooms(before).length);
  assert.deepEqual(answer.groups.onlyAfter, ['8W']);
  assert.deepEqual(answer.groups.onlyBefore, []);
  const fresh = answer.places.new.map((place) => place.kind + ':' + place.name);
  assert.ok(fresh.includes('corridor:Wing Corridor'), 'the corridor is new: ' + fresh);
  assert.ok(fresh.includes('stairs:E'), 'the stairs are new: ' + fresh);
  assert.deepEqual(answer.places.new.find((place) => place.name === 'Wing Corridor').floorNames, ['Floor 4']);
  assert.deepEqual(answer.places.gone, []);
  assert.ok(answer.figures.walking.after > answer.figures.walking.before, 'the wing group walks');
  assert.equal(answer.groups.rows.some((row) => row.name === '8W'), false, 'a group on one side is no row');
  assert.ok(answer.places.unnamed.after >= answer.places.unnamed.before);
});

test('a wing taken away reads the other way round', () => {
  const small = school();
  const big = withWing(small);
  const answer = compareBuildings(big, run(big), small, run(small));
  assert.deepEqual(answer.rooms.removed, ['401', '402']);
  assert.deepEqual(answer.rooms.added, []);
  assert.deepEqual(answer.groups.onlyBefore, ['8W']);
  assert.ok(answer.places.gone.some((place) => place.name === 'Wing Corridor'));
  assert.deepEqual(answer.places.new, []);
});

// ---------------------------------------------------------------- names of places

test('a renamed corridor is gone under its old name and new under its new one, never a change', () => {
  const before = school();
  const after = clone(before);
  corridor(after, 'Main Corridor').name = 'Central Corridor';
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.places.gone.map((place) => place.name), ['Main Corridor']);
  assert.deepEqual(answer.places.new.map((place) => place.name), ['Central Corridor']);
  assert.ok(answer.places.gone[0].load > 0, 'a gone place says how busy it was');
  for (const row of answer.places.busier.concat(answer.places.quieter)) assert.notEqual(row.name, 'Main Corridor');
});

test('a corridor name matches by floor too: the same name on another floor is another place', () => {
  const before = school();
  const after = clone(before);
  const floorTwo = after.building.floors.find((floor) => floor.id === 'fsample002');
  floorTwo.name = 'Second Floor';
  // a second corridor on the renamed floor: its set of names is no longer Floor 2's
  const upper = corridor(after, 'Upper Corridor');
  floorTwo.corridors.push({ id: 'kextra0001', name: 'Annex', cells: upper.cells.splice(Math.floor(upper.cells.length / 2)) });
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.ok(answer.places.gone.some((place) => place.name === 'Upper Corridor' && place.floorNames[0] === 'Floor 2'));
  assert.ok(answer.places.new.some((place) => place.name === 'Upper Corridor' && place.floorNames[0] === 'Second Floor'));
});

test('two corridors of one name on one floor are ambiguous, listed apart and matched with nothing', () => {
  const before = school();
  const after = clone(before);
  corridor(after, 'Front Hall').name = 'Main Corridor'; // both on Floor 1
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.places.ambiguous.map((place) => [place.name, place.before, place.after, place.floorNames]), [['Main Corridor', 1, 2, ['Floor 1']]]);
  const named = answer.places.busier.concat(answer.places.quieter, answer.places.new, answer.places.gone).map((place) => place.name);
  assert.equal(named.includes('Main Corridor'), false);
  // "Front Hall" had a name on the left and now has none that is its own
  assert.ok(answer.places.gone.some((place) => place.name === 'Front Hall'));
});

test('unnamed corridors are left out and the answer says so', () => {
  const before = school();
  const after = clone(before);
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.equal(answer.places.unnamed.sentence, UNNAMED_SENTENCE);
  assert.equal(UNNAMED_SENTENCE, 'Corridors without names cannot be matched between two buildings, so they are left out of this list.');
  assert.ok(answer.places.unnamed.before > 0 && answer.places.unnamed.after > 0);
  const named = answer.places.busier.concat(answer.places.quieter, answer.places.new, answer.places.gone).filter((place) => place.name === '');
  assert.deepEqual(named, []);
});

test('a place busier or quieter in B is matched by name; one transition can be asked for', () => {
  const before = school();
  const after = applyChanges(before, { changes: [{ kind: 'move', dayTypeId: A, groupId: 'gsample08a', period: 6, roomId: 'rsample101' }] });
  const whole = compareBuildings(before, run(before), after, run(after));
  const both = whole.places.busier.concat(whole.places.quieter);
  assert.ok(both.length > 0, 'a move changes a place');
  for (const row of both) assert.equal(row.difference, row.after - row.before);
  const one = compareBuildings(before, run(before), after, run(after), { transition: 5 });
  assert.equal(one.transition, 5);
  assert.ok(one.places.busier.length + one.places.quieter.length > 0);
  const past = compareBuildings(before, run(before), after, run(after), { transition: 99 });
  assert.equal(past.refused, 'transition', 'no such transition is a refusal, not a null');
  for (const list of [whole.places.busier, whole.places.quieter]) {
    for (let i = 1; i < list.length; i += 1) assert.ok(Math.abs(list[i - 1].difference) >= Math.abs(list[i].difference), 'biggest change first');
  }
});

// ---------------------------------------------------------------- groups

test('groups only on one side are listed by name; groups match without regard to case or spaces', () => {
  const before = school();
  const after = clone(before);
  after.groups = after.groups.filter((candidate) => candidate.name !== '8A');
  group(after, '7C').name = '  7c ';
  const added = clone(group(before, '6A'));
  added.id = 'gnewcomer0';
  added.name = 'Nine North';
  after.groups.push(added);
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.groups.onlyBefore, ['8A']);
  assert.deepEqual(answer.groups.onlyAfter, ['Nine North']);
  const row = answer.groups.rows.find((candidate) => candidate.name === '7C');
  assert.ok(row, '7C matched "  7c "');
  assert.equal(row.groupIdBefore, 'gsample07c');
  assert.equal(row.groupIdAfter, 'gsample07c');
  assert.equal(answer.groups.rows.some((candidate) => candidate.name === '8A'), false);
});

// ---------------------------------------------------------------- day types

test('day types are matched by name, and the one asked for is the one compared', () => {
  const before = school();
  const after = clone(before);
  after.dayTypes.find((dayType) => dayType.id === B).name = '  b  DAY ';
  const answer = compareBuildings(before, run(before), after, run(after), { dayTypeName: 'B Day' });
  assert.equal(answer.matched.dayTypeName, 'B Day');
  assert.equal(answer.matched.dayTypeIdA, B);
  assert.equal(answer.matched.dayTypeIdB, B);
  assert.deepEqual(answer.matched.dayTypes, ['A Day', 'B Day']);
  const own = compareBuildings(before, run(before), after, run(after));
  assert.equal(own.matched.dayTypeName, 'A Day', 'the first of A\'s that B has');
});

test('each side\'s own day type id is used when the two files give a day type different ids', () => {
  const before = school();
  const after = clone(before);
  const map = { [A]: 'dother000a', [B]: 'dother000b' };
  after.dayTypes.forEach((dayType) => { if (map[dayType.id]) dayType.id = map[dayType.id]; });
  for (const g of after.groups) {
    for (const [from, to] of Object.entries(map)) {
      if (g.days[from]) { g.days[to] = g.days[from]; delete g.days[from]; }
    }
  }
  assertValid(after, 'the renamed ids are valid');
  const answer = compareBuildings(before, run(before), after, run(after), { dayTypeName: 'B Day' });
  assert.equal(answer.matched.dayTypeIdB, 'dother000b');
  const same = compareBuildings(before, run(before), before, run(before), { dayTypeName: 'B Day' });
  // the busiest place names its own side's day type id; every number is the same
  const without = (figures) => ({ ...plain(figures), busiest: { ...plain(figures).busiest, after: { ...plain(figures).busiest.after, dayTypeId: null }, before: { ...plain(figures).busiest.before, dayTypeId: null } } });
  assert.deepEqual(without(answer.figures), without(same.figures));
});

test('no matched day type is a refusal with a sentence and nothing else', () => {
  const before = school();
  const after = clone(before);
  after.dayTypes.find((dayType) => dayType.id === A).name = 'Red Day';
  after.dayTypes.find((dayType) => dayType.id === B).name = 'Blue Day';
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(Object.keys(answer).sort(), ['refused', 'sentence']);
  assert.equal(answer.refused, 'no-day-type');
  assert.match(answer.sentence, /no day type with the same name/);
});

test('a day type asked for that only one side has is refused, naming the ones both have', () => {
  const before = school();
  const after = clone(before);
  after.dayTypes.find((dayType) => dayType.id === A).name = 'Red Day';
  const answer = compareBuildings(before, run(before), after, run(after), { dayTypeName: 'A Day' });
  assert.equal(answer.refused, 'no-day-type');
  assert.match(answer.sentence, /A Day/);
  assert.match(answer.sentence, /B Day/);
  const fine = compareBuildings(before, run(before), after, run(after));
  assert.equal(fine.matched.dayTypeName, 'B Day', 'without a choice, the first that matches');
});

// ---------------------------------------------------------------- hostile names

test('hostile names stay text: returned exactly as typed, never interpreted', () => {
  const nasty = ['<img src=x onerror=alert(1)>', '"; DROP TABLE groups; --', 'Ünï · 学校 🏫', '__proto__', 'constructor', '<b>Hall</b> & "co"'];
  const before = school();
  const after = clone(before);
  corridor(after, 'Main Corridor').name = nasty[0];
  corridor(after, 'Upper Corridor').name = nasty[3];
  group(after, '6A').name = nasty[1];
  group(after, '6B').name = nasty[2];
  group(after, '6C').name = nasty[4];
  group(after, '7C').name = nasty[5];
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.groups.onlyBefore.slice().sort(), ['6A', '6B', '6C', '7C']);
  assert.deepEqual(answer.groups.onlyAfter.slice().sort(), [nasty[1], nasty[2], nasty[4], nasty[5]].sort());
  assert.deepEqual(answer.places.new.map((place) => place.name).sort(), [nasty[0], nasty[3]].sort());
  assert.deepEqual(answer.places.gone.map((place) => place.name).sort(), ['Main Corridor', 'Upper Corridor']);
  // the answer is data: it survives a round trip through JSON as it was
  assert.deepEqual(JSON.parse(JSON.stringify(answer.places.new)), answer.places.new);
  // and a hostile name on both sides is matched like any other
  const both = clone(before);
  corridor(both, 'Main Corridor').name = nasty[0];
  const twice = clone(both);
  const same = compareBuildings(both, run(both), twice, run(twice));
  assert.deepEqual(same.places.new.concat(same.places.gone, same.places.ambiguous), []);
  // names that are Object.prototype's keys do not break the matching
  const proto = clone(before);
  corridor(proto, 'Main Corridor').name = '__proto__';
  group(proto, '6A').name = 'toString';
  const protoAfter = clone(proto);
  const protoAnswer = compareBuildings(proto, run(proto), protoAfter, run(protoAfter));
  assert.deepEqual(protoAnswer.places.new.concat(protoAnswer.places.gone), []);
  assert.deepEqual(protoAnswer.groups.onlyBefore.concat(protoAnswer.groups.onlyAfter), []);
});

// ---------------------------------------------------------------- results

test('a trimResult answer and a full pipeline result are both accepted, and give the same answer', () => {
  const before = school();
  const after = withWing(before);
  const fullBefore = run(before);
  const fullAfter = run(after);
  const full = compareBuildings(before, fullBefore, after, fullAfter);
  const trimmed = compareBuildings(before, trimResult(fullBefore), after, trimResult(fullAfter));
  const mixed = compareBuildings(before, fullBefore, after, trimResult(fullAfter));
  assert.deepEqual(plain(trimmed), plain(full));
  assert.deepEqual(plain(mixed), plain(full));
});

test('a missing project or result is a TypeError; nothing else throws', () => {
  const project = school();
  const result = run(project);
  assert.throws(() => compareBuildings(project, null, project, result), TypeError);
  assert.throws(() => compareBuildings(project, result, project, undefined), TypeError);
  assert.throws(() => compareBuildings(null, result, project, result), TypeError);
  assert.throws(() => compareBuildings(project, result, {}, result), TypeError);
  assert.throws(() => compareBuildings(project, { loads: [] }, project, result), TypeError, 'a result with neither routes nor failedWalks');
});

test('the inputs are not changed', () => {
  const before = school();
  const after = withWing(before);
  const resultBefore = trimResult(run(before));
  const resultAfter = trimResult(run(after));
  const snapshot = JSON.stringify([before, after, resultBefore.findings, resultAfter.findings, resultBefore.failedWalks]);
  compareBuildings(before, resultBefore, after, resultAfter);
  assert.equal(JSON.stringify([before, after, resultBefore.findings, resultAfter.findings, resultBefore.failedWalks]), snapshot);
});

// ---------------------------------------------------------------- findings

test('findings are matched by names, not ids: the same problem in a project with other ids is unchanged', () => {
  const before = school();
  const after = clone(before);
  // another id for the room and the two groups of the sample's double booking
  const swap = (from, to) => JSON.parse(JSON.stringify(after).split(from).join(to));
  const renamed = swap('rsample203', 'rother0203');
  renamed.groups = renamed.groups.map((g) => (g.id === 'gsample06c' ? { ...g, id: 'gother006c' } : g));
  const text = JSON.stringify(renamed).split('gsample06c').join('gother006c');
  const other = JSON.parse(text);
  assertValid(other, 'the project with other ids is valid');
  const answer = compareBuildings(before, run(before), other, run(other));
  assert.deepEqual(answer.findings.new, []);
  assert.deepEqual(answer.findings.resolved, []);
  assert.ok(answer.findings.unchanged.some((finding) => finding.kind === 'room-double'));
});

test('a problem that is cleared is resolved and one that appears is new', () => {
  const before = school();
  const after = applyChanges(before, { changes: [{ kind: 'move', dayTypeId: A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' }] });
  const answer = compareBuildings(before, run(before), after, run(after));
  // 7C moved from Room 203 to Room 204, where another group already is: the
  // double booking in 203 is resolved and a different one, in 204, is new
  assert.deepEqual(answer.findings.resolved.map((finding) => finding.id), ['room-double:dsample00a:1:rsample203']);
  assert.deepEqual(answer.findings.new.map((finding) => finding.id), ['room-double:dsample00a:1:rsample204']);
  const back = compareBuildings(after, run(after), before, run(before));
  assert.deepEqual(back.findings.new.map((finding) => finding.id), ['room-double:dsample00a:1:rsample203']);
  assert.deepEqual(back.findings.resolved.map((finding) => finding.id), ['room-double:dsample00a:1:rsample204']);
});

// ---------------------------------------------------------------- SV2-114b: the review's fixes

test('an elevator is named by its car letter and keeps its row when it gains a stop in a new wing', () => {
  const before = withElevator(school());
  assertValid(before, 'the elevator fixture is valid');
  const after = withNewStop(before);
  assertValid(after, 'so is the one with the new stop');
  const answer = compareBuildings(before, run(before), after, run(after));
  const rows = everyPlace(answer).filter((row) => row.kind === 'elevator');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'D', 'the car letter, not the connection\'s label "Lift"');
  assert.deepEqual(rows[0].floorsBefore, ['Floor 1', 'Floor 2']);
  assert.deepEqual(rows[0].floorsAfter, ['Floor 1', 'Floor 2', 'Floor 3']);
  assert.equal(rows[0].floorsChanged, true);
  assert.ok(rows[0].difference !== 0, 'busier or quieter, not gone plus new');
  const named = answer.places.new.concat(answer.places.gone).map((place) => place.kind + ':' + place.name);
  assert.deepEqual(named.filter((entry) => entry.startsWith('elevator')), []);
  // the stairs beside it keep their own rows and are matched as before
  assert.ok(everyPlace(answer).some((row) => row.kind === 'stairs' && row.name === 'B'));
  assert.equal(answer.places.gone.concat(answer.places.new).some((place) => place.kind === 'stairs'), false);
  // with no label and no letter, the place's own name is the elevator's
  const letterless = clone(before);
  const lift = letterless.building.connections.find((candidate) => candidate.kind === 'elevator');
  delete lift.car;
  const labelled = compareBuildings(letterless, run(letterless), letterless, run(letterless));
  assert.deepEqual(labelled.places.new.concat(labelled.places.gone, labelled.places.ambiguous), []);
});

test('a stairs matched one to one by label keeps its row when its floor is renamed; the same label on two floors does not', () => {
  const before = withElevator(school());
  const renamed = withNewStop(before);
  floorOf(renamed, 'fsample003').name = 'Top Floor';
  const stairs = compareBuildings(before, run(before), renamed, run(renamed));
  const named = stairs.places.new.concat(stairs.places.gone).filter((place) => place.kind === 'stairs');
  assert.equal(named.some((place) => place.name === 'B'), false, 'stairs B is not gone and new');
  const bRows = everyPlace(stairs).filter((row) => row.kind === 'stairs' && row.name === 'B');
  assert.equal(bRows.length, 1);
  assert.deepEqual(bRows[0].floorsBefore, ['Floor 2', 'Floor 3']);
  assert.deepEqual(bRows[0].floorsAfter, ['Floor 2', 'Top Floor']);
  assert.equal(bRows[0].floorsChanged, true);

  // two stairs labelled X, on two floors: each is matched by its label and floors
  const twice = school();
  for (const connection of twice.building.connections) connection.label = 'X';
  const same = compareBuildings(twice, run(twice), twice, run(twice));
  assert.deepEqual(same.places.new.concat(same.places.gone, same.places.ambiguous), []);
  // one floor renamed: X is no longer one to one, so it is not guessed at
  const apart = clone(twice);
  floorOf(apart, 'fsample003').name = 'Top Floor';
  const guess = compareBuildings(twice, run(twice), apart, run(apart));
  assert.deepEqual(guess.places.gone.filter((place) => place.kind === 'stairs').map((place) => place.floorNames), [['Floor 2', 'Floor 3']]);
  assert.deepEqual(guess.places.new.filter((place) => place.kind === 'stairs').map((place) => place.floorNames), [['Floor 2', 'Top Floor']]);
  assert.equal(everyPlace(guess).some((row) => row.kind === 'stairs'), false, 'the stairs of Floors 1 and 2 did not change');
  // two X before and one after: the one after is not matched with either by label
  const fewer = clone(apart);
  fewer.building.connections = fewer.building.connections.filter((connection) => connection.id !== 'csample00a');
  const lost = compareBuildings(twice, run(twice), fewer, run(fewer));
  assert.deepEqual(lost.places.gone.filter((place) => place.kind === 'stairs').map((place) => place.floorNames).sort(), [['Floor 1', 'Floor 2'], ['Floor 2', 'Floor 3']]);
  assert.deepEqual(lost.places.new.filter((place) => place.kind === 'stairs').map((place) => place.floorNames), [['Floor 2', 'Top Floor']]);
});

test('a renamed floor whose corridor names all match is matched through, with renamedFloor on the row', () => {
  const before = withElevator(school());
  const after = withNewStop(before);
  floorOf(after, 'fsample003').name = 'Top Floor';
  const answer = compareBuildings(before, run(before), after, run(after));
  const top = everyPlace(answer).find((row) => row.name === 'Top Corridor');
  assert.ok(top, 'Top Corridor is matched through its floor\'s new name');
  assert.deepEqual(top.renamedFloor, { before: 'Floor 3', after: 'Top Floor' });
  assert.deepEqual(top.floorNames, ['Floor 3']);
  const names = answer.places.new.concat(answer.places.gone).map((place) => place.name);
  assert.equal(names.includes('Top Corridor') || names.includes('Music Wing'), false);
  // one corridor name different: the floor's set no longer matches, so nothing is matched through
  const changed = clone(after);
  corridor(changed, 'Music Wing').name = 'Band Room Hall';
  const apart = compareBuildings(before, run(before), changed, run(changed));
  assert.ok(apart.places.gone.some((place) => place.name === 'Top Corridor'));
  assert.ok(apart.places.new.some((place) => place.name === 'Top Corridor'));
  // two floors that could be it: not guessed
  const twin = clone(before);
  const copy = clone(floorOf(twin, 'fsample003'));
  copy.id = 'ftwin00004';
  copy.name = 'Top Floor Two';
  copy.level = 4;
  copy.corridors = copy.corridors.map((c, i) => ({ ...c, id: 'ktwin0000' + i }));
  copy.spaces = [];
  copy.exits = [];
  const bothFloors = clone(twin);
  floorOf(bothFloors, 'fsample003').name = 'Top Floor One';
  bothFloors.building.floors.push(copy);
  const split = compareBuildings(twin, run(twin), bothFloors, run(bothFloors));
  assert.equal(everyPlace(split).some((row) => row.renamedFloor), false);
  assert.equal(split.places.new.filter((place) => place.name === 'Top Corridor').length, 2, 'neither Top Corridor is taken for the old one');
  assert.equal(split.places.gone.filter((place) => place.name === 'Top Corridor').length, 1);
});

test('different units: busiest and every place row say so and carry no difference', () => {
  const before = school();
  for (const g of before.groups) g.headCount = null;
  const after = clone(before);
  group(after, '6A').headCount = 30;
  assert.equal(run(before).loads[0].unit, 'groups');
  assert.equal(run(after).loads[0].unit, 'students');
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.equal(answer.unitsDiffer.before, 'groups');
  assert.equal(answer.unitsDiffer.after, 'students');
  assert.equal(typeof answer.unitsDiffer.sentence, 'string');
  assert.match(answer.unitsDiffer.sentence, /groups/);
  assert.equal(answer.figures.busiest.unitsDiffer, true);
  assert.equal(answer.figures.busiest.difference, null);
  assert.ok(answer.figures.busiest.before && answer.figures.busiest.after);
  assert.deepEqual(answer.places.busier.concat(answer.places.quieter), []);
  assert.ok(answer.places.changed.length > 0, 'the matched places are listed unranked');
  for (const row of answer.places.changed) {
    assert.equal(row.unitsDiffer, true);
    assert.equal(row.difference, null);
    assert.equal(typeof row.before, 'number');
    assert.equal(typeof row.after, 'number');
  }
  assert.equal(answer.places.changedTotal >= answer.places.changed.length, true);
  // one unit on both sides says nothing of the kind
  const same = compareBuildings(before, run(before), clone(before), run(before));
  assert.equal(same.unitsDiffer, null);
  assert.equal(same.figures.busiest.unitsDiffer, undefined);
  assert.equal(typeof same.figures.busiest.difference, 'number');
});

test('the busiest place has no node or link index across two buildings, and a group row has no order', () => {
  const before = school();
  const after = withWing(before);
  const answer = compareBuildings(before, run(before), after, run(after));
  for (const side of [answer.figures.busiest.before, answer.figures.busiest.after]) {
    assert.ok(side && side.load > 0);
    assert.equal('node' in side, false);
    assert.equal('link' in side, false);
    assert.equal(typeof side.name, 'string');
  }
  assert.ok(answer.groups.rows.length > 0);
  for (const row of answer.groups.rows) assert.equal('order' in row, false);
  for (const row of everyPlace(answer)) assert.equal('order' in row, false);
});

test('a day type name twice on one side keeps the first; one with no load on a side is listed unworked', () => {
  const before = school();
  const after = clone(before);
  after.dayTypes.find((dayType) => dayType.id === B).name = ' a  DAY';
  const dup = compareBuildings(before, run(before), after, run(after));
  assert.equal(dup.matched.dayTypeIdB, A, 'the first of the two');
  assert.deepEqual(dup.matched.duplicateDayTypes, { before: [], after: ['A Day'] });
  assert.deepEqual(dup.matched.dayTypes, ['A Day']);
  const mirror = compareBuildings(after, run(after), before, run(before));
  assert.deepEqual(mirror.matched.duplicateDayTypes, { before: ['A Day'], after: [] });
  assert.deepEqual(compareBuildings(before, run(before), clone(before), run(before)).matched.duplicateDayTypes, { before: [], after: [] });
  // B Day has no load on the after side
  const fullAfter = trimResult(run(before));
  const noLoad = { ...fullAfter, loads: fullAfter.loads.filter((load) => load.dayTypeId !== B) };
  const answer = compareBuildings(before, run(before), clone(before), noLoad);
  assert.deepEqual(answer.matched.dayTypes, ['A Day']);
  assert.deepEqual(answer.matched.unworked, ['B Day']);
  assert.deepEqual(compareBuildings(before, run(before), clone(before), run(before)).matched.unworked, []);
  const asked = compareBuildings(before, run(before), clone(before), noLoad, { dayTypeName: 'B Day' });
  assert.equal(asked.refused, 'no-day-type');
});

test('the refusal says three different things: on neither side, on one side only, on no matched day type', () => {
  const before = school();
  const after = clone(before);
  const ask = (name) => compareBuildings(before, run(before), after, run(after), name === undefined ? {} : { dayTypeName: name });
  const neither = ask('Holiday');
  assert.equal(neither.refused, 'no-day-type');
  assert.match(neither.sentence, /^Neither of these projects has a day type named Holiday/);
  after.dayTypes.find((dayType) => dayType.id === A).name = 'Red Day';
  const one = ask('A Day');
  assert.match(one.sentence, /^Only one of these projects has a day type named A Day/);
  after.dayTypes.find((dayType) => dayType.id === B).name = 'Blue Day';
  const none = ask();
  assert.match(none.sentence, /^These two projects have no day type with the same name/);
  assert.equal(new Set([neither.sentence, one.sentence, none.sentence]).size, 3);
  const noneAsked = ask('A Day');
  assert.match(noneAsked.sentence, /^Only one of these projects/);
  assert.match(noneAsked.sentence, /no day type with the same name/);
  const nothing = ask('Holiday');
  assert.match(nothing.sentence, /^Neither/);
});

test('groups with one name are one row, counted; groups with a blank name are never matched', () => {
  const before = school();
  const after = clone(before);
  group(after, '7C').name = '8A';
  group(before, '6A').name = '';
  group(after, '6A').name = '   ';
  group(before, '6B').name = '';
  const answer = compareBuildings(before, run(before), after, run(after));
  const row = answer.groups.rows.find((candidate) => candidate.name === '8A');
  assert.equal(row.mergedBefore, 1);
  assert.equal(row.mergedAfter, 2);
  assert.equal(answer.groups.rows.find((candidate) => candidate.name === '7C'), undefined, '7C is now an 8A');
  assert.deepEqual(answer.groups.onlyBefore.filter((name) => name === '(no name)'), ['(no name)']);
  assert.deepEqual(answer.groups.onlyAfter.filter((name) => name === '(no name)'), ['(no name)']);
  assert.equal(answer.groups.noNameBefore, 2);
  assert.equal(answer.groups.noNameAfter, 1);
  assert.equal(answer.groups.rows.some((candidate) => candidate.name.trim() === ''), false);
  assert.equal(answer.groups.onlyBefore.includes('7C'), true);
  assert.ok(answer.figures.onlyBefore.groups >= 3, 'the two blank ones and 7C');
  assert.ok(answer.figures.onlyAfter.groups >= 1);
  // the merged row's walking is the sum of its groups
  const solo = compareBuildings(school(), run(school()), school(), run(school()));
  const one = solo.groups.rows.find((candidate) => candidate.name === '8A');
  const seven = solo.groups.rows.find((candidate) => candidate.name === '7C');
  assert.equal(row.after.total, one.after.total + seven.after.total);
});

test('figures of the groups nobody matches explain a new wing\'s added walking', () => {
  const before = school();
  const after = withWing(before);
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.equal(answer.figures.onlyAfter.groups, 1);
  assert.ok(answer.figures.onlyAfter.walking > 0);
  assert.ok(answer.figures.onlyAfter.walks > 0);
  assert.deepEqual(Object.keys(answer.figures.onlyBefore).sort(), ['failed', 'groups', 'late', 'waiting', 'walking', 'walks']);
  assert.deepEqual(answer.figures.onlyBefore, { groups: 0, walks: 0, walking: 0, waiting: 0, late: 0, failed: 0 });
  const matchedWalking = answer.groups.rows.reduce((total, row) => total + (row.after ? row.after.walking : 0) - (row.before ? row.before.walking : 0), 0);
  assert.equal(answer.figures.walking.difference, matchedWalking + answer.figures.onlyAfter.walking - answer.figures.onlyBefore.walking);
});

test('findings that share a key are paired in order only when they are about names; unnumbered rooms and no names are not paired by order', () => {
  const before = school();
  const after = clone(before);
  const base = run(before);
  const real = trimResult(base).findings.findings.find((finding) => finding.kind === 'room-double');
  const named = (id, groupIds, text) => ({ ...real, id, text: text || real.text, about: groupIds, where: { ...real.where, groupIds, roomId: null } });
  const one = [named('f1', ['gsample06c'])];
  const two = [named('f1', ['gsample06c']), named('f2', ['gsample06c'])];
  const asked = (a, b) => compareBuildings(before, withFindings(run(before), a), after, withFindings(run(after), b));
  const grown = asked(one, two);
  assert.deepEqual(grown.findings.unchanged.map((f) => f.id), ['f1']);
  assert.deepEqual(grown.findings.new.map((f) => f.id), ['f2']);
  assert.deepEqual(grown.findings.resolved, []);
  const same = asked(two, two);
  assert.deepEqual(same.findings.unchanged.map((f) => f.id), ['f1', 'f2']);
  // no names at all: not paired by order, even though the lists are alike
  const bare = (id) => ({ ...real, id, text: 'The building has a note.', about: [], where: { ...real.where, groupIds: [], roomId: null, teacherId: null } });
  const unpaired = asked([bare('b1'), bare('b2')], [bare('b3'), bare('b4')]);
  assert.deepEqual(unpaired.findings.unchanged, []);
  assert.deepEqual(unpaired.findings.new.map((f) => f.id), ['b3', 'b4']);
  assert.deepEqual(unpaired.findings.resolved.map((f) => f.id), ['b1', 'b2']);
});

test('a finding about an unnumbered room is matched by its floor and text, and only when that is unique', () => {
  const before = school();
  for (const floor of before.building.floors) for (const space of floor.spaces) if (space.id === 'rsample203') space.number = '';
  const after = clone(before);
  const resultOf = (project) => run(project);
  const about = (answer) => answer.findings.unchanged.concat(answer.findings.new, answer.findings.resolved).filter((finding) => finding.where.roomId === 'rsample203');
  const same = compareBuildings(before, resultOf(before), after, resultOf(after));
  assert.ok(about(same).length > 0, 'the double booking in the unnumbered room is a finding');
  assert.equal(same.findings.new.concat(same.findings.resolved).filter((finding) => finding.where.roomId === 'rsample203').length, 0, 'unchanged by floor and text');
  // its text changes (a group renamed): the same problem is resolved and new, never paired
  const renamed = clone(after);
  group(renamed, '6C').name = '6Ceta';
  const moved = compareBuildings(before, resultOf(before), renamed, resultOf(renamed));
  assert.ok(about({ findings: { unchanged: [], new: moved.findings.new, resolved: [] } }).length > 0 || moved.findings.new.length > 0);
  assert.equal(moved.findings.unchanged.filter((finding) => finding.where.roomId === 'rsample203').length, 0);
  // two the same on one side: not paired at all
  const base = trimResult(resultOf(before));
  const real = base.findings.findings.find((finding) => finding.where.roomId === 'rsample203');
  const doubled = withFindings(resultOf(before), [real, { ...real, id: 'dup' }]);
  const pair = compareBuildings(before, doubled, after, withFindings(resultOf(after), [real]));
  assert.deepEqual(pair.findings.unchanged, []);
  assert.deepEqual(pair.findings.new.map((f) => f.id), [real.id]);
  assert.deepEqual(pair.findings.resolved.map((f) => f.id), [real.id, 'dup']);
});

test('room keys in findings are the loose ones rooms.same uses: "B 12" and "b12" are one room', () => {
  const before = school();
  const after = clone(before);
  const spaceOf = (project) => project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === 'rsample203');
  spaceOf(before).number = 'B 12';
  spaceOf(after).number = ' b12';
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.equal(answer.rooms.removed.length, 0);
  assert.equal(answer.rooms.added.length, 0);
  assert.deepEqual(answer.findings.new, []);
  assert.deepEqual(answer.findings.resolved, []);
  assert.ok(answer.findings.unchanged.some((finding) => finding.kind === 'room-double'));
});

test('a result that is not the project\'s throws a TypeError; a trimmed result with no loads has a refusal of its own', () => {
  const before = school();
  const after = clone(before);
  const map = { [A]: 'dother000a', [B]: 'dother000b' };
  after.dayTypes.forEach((dayType) => { if (map[dayType.id]) dayType.id = map[dayType.id]; });
  for (const g of after.groups) {
    for (const [from, to] of Object.entries(map)) {
      if (g.days[from]) { g.days[to] = g.days[from]; delete g.days[from]; }
    }
  }
  assert.throws(() => compareBuildings(before, run(before), after, run(before)), TypeError, 'before\'s result given for after');
  assert.throws(() => compareBuildings(after, run(before), before, run(before)), TypeError);
  const trimmed = trimResult(run(before));
  const none = compareBuildings(before, { ...trimmed, loads: [] }, clone(before), run(before));
  assert.equal(none.refused, 'no-loads');
  assert.match(none.sentence, /no loads/);
  assert.match(none.sentence, /before/);
  assert.doesNotMatch(none.sentence, /day type/);
  const gone = compareBuildings(before, run(before), clone(before), { ...trimmed, loads: undefined });
  assert.equal(gone.refused, 'no-loads');
  assert.match(gone.sentence, /after/);
});

test('names with a bar or a NUL in them cannot be mistaken for the parts of a key', () => {
  const before = school();
  const after = clone(before);
  // Floor "F|x" with a corridor "y" is not Floor "F" with a corridor "x|y"
  floorOf(before, 'fsample002').name = 'F|x';
  corridor(before, 'Upper Corridor').name = 'y';
  floorOf(after, 'fsample002').name = 'F';
  corridor(after, 'Upper Corridor').name = 'x|y';
  const answer = compareBuildings(before, run(before), after, run(after));
  assert.deepEqual(answer.places.gone.filter((place) => place.kind === 'corridor').map((place) => place.name), ['y']);
  assert.deepEqual(answer.places.new.filter((place) => place.kind === 'corridor').map((place) => place.name), ['x|y']);
  assert.equal(everyPlace(answer).some((row) => row.name === 'y' || row.name === 'x|y'), false);
  // the same with stairs labels, and with NUL
  const stairsA = clone(school());
  const stairsB = clone(stairsA);
  stairsA.building.connections[0].label = 'a|Floor 1';
  stairsB.building.connections[0].label = 'a';
  floorOf(stairsB, 'fsample001').name = 'Floor 1|Floor 2';
  floorOf(stairsB, 'fsample002').name = 'x';
  const stair = compareBuildings(stairsA, run(stairsA), stairsB, run(stairsB));
  assert.equal(stair.places.new.concat(stair.places.gone).filter((place) => place.kind === 'stairs' && place.name.startsWith('a')).length >= 2, true);
  const nul = clone(school());
  group(nul, '6A').name = 'x\u0000y';
  group(nul, '6B').name = 'x';
  const nulAfter = clone(nul);
  nulAfter.groups.find((candidate) => candidate.id === 'gsample06b').name = 'x\u0000';
  const gotNul = compareBuildings(nul, run(nul), nulAfter, run(nulAfter));
  assert.deepEqual(gotNul.groups.onlyBefore, ['x']);
  assert.deepEqual(gotNul.groups.onlyAfter, ['x\u0000']);
  // findings: groups "x" and "y" are not one group "x\u0000g:y"
  const real = trimResult(run(before)).findings.findings.find((finding) => finding.kind === 'room-double');
  const projectA = clone(school());
  const projectB = clone(school());
  group(projectA, '6A').name = 'x';
  group(projectA, '6B').name = 'y';
  group(projectB, '6A').name = 'x\u0000g:y';
  const make = (project, groupIds) => withFindings(run(project), [{ ...real, id: 'k1', about: groupIds, where: { ...real.where, groupIds, roomId: null } }]);
  const collide = compareBuildings(projectA, make(projectA, ['gsample06a', 'gsample06b']), projectB, make(projectB, ['gsample06a']));
  assert.deepEqual(collide.findings.unchanged, []);
  assert.equal(collide.findings.new.length, 1);
  assert.equal(collide.findings.resolved.length, 1);
});

test('limit caps the lists, and the totals say how many there were', () => {
  const before = school();
  const after = applyChanges(before, { changes: [{ kind: 'move', dayTypeId: A, groupId: 'gsample08a', period: 6, roomId: 'rsample101' }] });
  const whole = compareBuildings(before, run(before), after, run(after), { limit: 100 });
  assert.equal(whole.places.busierTotal, whole.places.busier.length);
  assert.equal(whole.places.quieterTotal, whole.places.quieter.length);
  assert.ok(whole.places.busierTotal + whole.places.quieterTotal >= 3, 'the move changes several places');
  const capped = compareBuildings(before, run(before), after, run(after), { limit: 1 });
  assert.ok(capped.places.busier.length <= 1 && capped.places.quieter.length <= 1);
  assert.equal(capped.places.busierTotal, whole.places.busierTotal);
  assert.equal(capped.places.quieterTotal, whole.places.quieterTotal);
  assert.equal(capped.places.busierTotal > capped.places.busier.length || capped.places.quieterTotal > capped.places.quieter.length, true);
  const none = compareBuildings(before, run(before), after, run(after), { limit: 0 });
  assert.deepEqual(none.places.busier.concat(none.places.quieter), []);
  assert.equal(none.places.busierTotal, whole.places.busierTotal);
  assert.equal(whole.places.changedTotal, 0);
});

test('a transition that is not one of the day\'s is refused with a sentence, never echoed as null', () => {
  const before = school();
  const after = clone(before);
  for (const transition of [-1, 1.5, 99, '3', NaN]) {
    const answer = compareBuildings(before, run(before), after, run(after), { transition });
    assert.equal(answer.refused, 'transition', String(transition));
    assert.deepEqual(Object.keys(answer).sort(), ['refused', 'sentence']);
    assert.match(answer.sentence, /passing times/);
  }
  assert.equal(compareBuildings(before, run(before), after, run(after), { transition: 0 }).transition, 0);
  assert.equal(compareBuildings(before, run(before), after, run(after), { transition: null }).transition, null);
  assert.equal(compareBuildings(before, run(before), after, run(after), {}).transition, null);
});


// ---------------------------------------------------------------- timing

test('timing: two buildings at the size of spec 3.13 are compared in under 200 ms (fails at twice that)', () => {
  const one = bigProject({ seed: 1 });
  const two = bigProject({ seed: 2 });
  const a = trimResult(run(one));
  const b = trimResult(run(two));
  const times = [];
  let answer = null;
  for (let i = 0; i < 5; i += 1) {
    const started = process.hrtime.bigint();
    answer = compareBuildings(one, a, two, b);
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  times.sort((x, y) => x - y);
  const median = times[2];
  console.log('# compareBuildings on the 3.13 fixture pair: median ' + median.toFixed(1) + ' ms, worst ' + times[4].toFixed(1) + ' ms (budget ' + BUDGET_MS + ', fails at ' + BUDGET_MS * SLACK + ')');
  assert.ok(answer.refused === undefined, 'the fixture pair has a day type in common');
  assert.ok(answer.rooms.same > 0);
  assert.ok(times[4] <= BUDGET_MS * SLACK, 'compareBuildings took ' + times[4].toFixed(1) + ' ms, over ' + BUDGET_MS * SLACK);
});
