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

function corridor(project, name) {
  for (const floor of project.building.floors) for (const found of floor.corridors) if (found.name === name) return found;
  throw new Error('no corridor ' + name);
}

const plain = (view) => JSON.parse(JSON.stringify(view));

// ---------------------------------------------------------------- the same building

test('the same building gives compareResults\' figures, every difference 0', () => {
  const project = school();
  const result = run(project);
  const answer = compareBuildings(project, result, clone(project), run(clone(project)));
  const want = compareResults(result, result, { dayTypeId: A });
  assert.deepEqual(plain(answer.figures), plain(want.figures));
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
  assert.deepEqual(plain(answer.figures), plain(want.figures));
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
  corridor(after, 'Upper Corridor'); // Floor 2
  const floorTwo = after.building.floors.find((floor) => floor.id === 'fsample002');
  floorTwo.name = 'Second Floor';
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
  assert.deepEqual(past.places.busier.concat(past.places.quieter), [], 'no such transition, no place changes');
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
