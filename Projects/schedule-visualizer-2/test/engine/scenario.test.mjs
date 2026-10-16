// The scenario engine (engine/scenario.js, ARCHITECTURE 6.6, SV2-60): apply,
// normalise, reconcile, the comparison, the difference map's numbers,
// "compare with another project file" and the chip words. Every case runs on
// the sample school, whose A Day has 6C and 7C both in Room 203 in Period 2
// and 8A's long walk from the Gym in Period 6 to Room 303 in Period 7.
// Nothing here reads a clock: the engine takes none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScenario, normalise, reconcile, compareResults, loadDifference, scenarioFromDiff, changeWords, changeSlots, editedGroupIds } from '../../engine/scenario.js';
import { createPipeline } from '../../engine/worker.js';
import { deleteGroup, deleteSpaces, revertToBase, setPeriods, setSlot, ActionError } from '../../engine/actions.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { school, clone, assertValid, room, group, teacher } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const G6A = 'gsample06a';
const G6B = 'gsample06b';
const G6C = 'gsample06c';
const G7C = 'gsample07c';
const G8A = 'gsample08a';

const move = (groupId, period, roomId, dayTypeId) => ({ kind: 'move', dayTypeId: dayTypeId || A, groupId, period, roomId });
const swapPeriods = (groupId, periodA, periodB, dayTypeId) => ({ kind: 'swapPeriods', dayTypeId: dayTypeId || A, groupId, periodA, periodB });
const swapRooms = (groupA, groupB, period, dayTypeId) => ({ kind: 'swapRooms', dayTypeId: dayTypeId || A, groupA, groupB, period });

function slot(project, groupId, dayTypeId, period) {
  return project.groups.find((candidate) => candidate.id === groupId).days[dayTypeId][period];
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function run(project) {
  return createPipeline().run(project);
}

// ---------------------------------------------------------------- 1. apply

test('applyScenario: a move puts the group in the room on its own day type, and keeps the label and named teachers', () => {
  const project = school();
  slot(project, G7C, A, 1).label = 'History';
  slot(project, G7C, A, 1).teacherIds = [teacher(project, 'Ms. Vandermeer').id];
  const after = applyScenario(project, { changes: [move(G7C, 1, 'rsample204')] });
  assert.deepEqual(slot(after, G7C, A, 1), { room: 'rsample204', roomText: '', label: 'History', teacherIds: [teacher(project, 'Ms. Vandermeer').id] });
  assert.equal(slot(after, G7C, B, 1), slot(project, G7C, B, 1), 'B Day is not touched');
  assert.equal(slot(project, G7C, A, 1).room, 'rsample203', 'the project handed in is not changed');
  assertValid(after);
});

test('applyScenario: a swap of periods trades whole slots; a swap of rooms trades the room and the kept number only', () => {
  const project = school();
  slot(project, G6A, A, 2).label = 'Algebra';
  slot(project, G6B, A, 2).room = null;
  slot(project, G6B, A, 2).roomText = 'Portable 2';
  const six = slot(project, G8A, A, 5);
  const seven = slot(project, G8A, A, 6);
  const after = applyScenario(project, { changes: [swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2)] });
  assert.deepEqual(slot(after, G8A, A, 5), seven);
  assert.deepEqual(slot(after, G8A, A, 6), six);
  assert.deepEqual(slot(after, G6A, A, 2), { room: null, roomText: 'Portable 2', label: 'Algebra', teacherIds: [] });
  assert.deepEqual(slot(after, G6B, A, 2), { room: 'rsample101', roomText: '', label: '', teacherIds: [] });
});

test('applyScenario: a change on a day type that is the same as A Day is refused in the schedule editor\'s words, and nothing changes', () => {
  const project = revertToBase(school(), { dayTypeId: B });
  const before = clone(project);
  deepFreeze(project);
  assert.throws(() => applyScenario(project, { changes: [move(G7C, 1, 'rsample204'), move(G6A, 1, 'rsample204', B)] }), (error) => {
    assert.ok(error instanceof ActionError);
    assert.equal(error.code, 'same-as-base');
    assert.equal(error.message, 'B Day is the same as A Day. Make it its own copy to change it.');
    return true;
  });
  assert.deepEqual(project, before);
  for (const change of [swapPeriods(G8A, 5, 6, B), swapRooms(G6A, G6B, 2, B)]) {
    assert.throws(() => applyScenario(project, { changes: [change] }), { code: 'same-as-base' }, change.kind);
  }
});

test('applyScenario: no scenario is the project itself; left out, the project\'s own scenario is applied', () => {
  const project = school();
  assert.equal(applyScenario(project, null), project);
  assert.equal(applyScenario(project, { name: '', changes: [], compared: null }), project);
  project.scenario = { name: 'Try 204', changes: [move(G7C, 1, 'rsample204')], compared: null };
  const after = applyScenario(project);
  assert.equal(slot(after, G7C, A, 1).room, 'rsample204');
  assert.equal(after.scenario, project.scenario, 'the scenario is left as it was: clearing it is the action\'s job');
});

test('applyScenario: a room or group that is gone is refused, never half applied', () => {
  const project = deepFreeze(school());
  assert.throws(() => applyScenario(project, { changes: [move(G7C, 1, 'rsample204'), move(G7C, 2, 'rgone00000')] }), { code: 'missing' });
  assert.throws(() => applyScenario(project, { changes: [swapRooms(G6A, 'ggone00000', 2)] }), { code: 'missing' });
  assert.throws(() => applyScenario(project, { changes: [move(G7C, 8, 'rsample204')] }), { code: 'bad-value' });
});

// ---------------------------------------------------------------- 2. normalise

test('normalise: move 7C to 204 and back leaves nothing', () => {
  const project = school();
  assert.deepEqual(normalise(project, [move(G7C, 1, 'rsample204'), move(G7C, 1, 'rsample203')]), []);
});

test('normalise: one change per slot, the later replacing the earlier whole', () => {
  const project = school();
  const first = move(G7C, 1, 'rsample204');
  const second = move(G7C, 1, 'rsamplelib');
  const other = move(G6C, 1, 'rsample202');
  assert.deepEqual(normalise(project, [first, other, second]), [other, second]);
  // a swap that touches the moved slot replaces the move, and frees the move's slot
  const swap = swapPeriods(G7C, 1, 2);
  assert.deepEqual(normalise(project, [first, swap]), [swap]);
  const rooms = swapRooms(G6C, G6A, 1);
  assert.deepEqual(normalise(project, [first, other, rooms]), [first, rooms], 'a swap of rooms touches both groups\' slots');
});

test('normalise: changes that leave the schedule as it is are removed, and a list with nothing to remove comes back as it was', () => {
  const project = school();
  // 6C and 7C are both in Room 203 in Period 2: trading their rooms changes nothing
  assert.deepEqual(normalise(project, [swapRooms(G6C, G7C, 1), swapRooms(G6A, G6A, 2), swapPeriods(G8A, 4, 4), move(G6A, 0, slot(project, G6A, A, 0).room)]), []);
  // every group is in the Cafeteria for lunch in Period 4 on A Day: so is a swap of two lunch slots
  assert.deepEqual(normalise(project, [swapRooms(G6A, G6B, 3)]), []);
  const list = [move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6)];
  assert.equal(normalise(project, list), list);
});

test('normalise: what it keeps can be applied in any order with the same result', () => {
  const project = school();
  const kept = normalise(project, [move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2), move(G8A, 5, 'rsample101')]);
  assert.equal(kept.length, 3);
  assert.deepEqual(applyScenario(project, { changes: kept.slice().reverse() }), applyScenario(project, { changes: kept }));
});

test('changeSlots and editedGroupIds name the slots and groups a change touches', () => {
  assert.deepEqual(changeSlots(swapRooms(G6A, G6B, 2)), [{ dayTypeId: A, groupId: G6A, period: 2 }, { dayTypeId: A, groupId: G6B, period: 2 }]);
  assert.deepEqual(changeSlots(swapPeriods(G8A, 5, 6)), [{ dayTypeId: A, groupId: G8A, period: 5 }, { dayTypeId: A, groupId: G8A, period: 6 }]);
  assert.deepEqual(editedGroupIds([move(G7C, 1, 'rsample204'), swapRooms(G6A, G7C, 2)]), [G7C, G6A]);
  assert.deepEqual(editedGroupIds({ changes: [swapPeriods(G8A, 5, 6)] }), [G8A]);
});

// ---------------------------------------------------------------- 3. reconcile

test('reconcile: a deleted group drops its change with a sentence, and keeps the rest', () => {
  const kept = move(G7C, 1, 'rsample204');
  const scenario = deepFreeze({ name: 'Try', changes: [move(G6A, 1, 'rsample202'), kept, swapRooms(G6A, G6B, 2)], compared: null });
  const project = deleteGroup(school(), { id: G6A });
  const { changes, dropped } = reconcile(project, scenario);
  assert.deepEqual(changes, [kept]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), [
    'a group no longer in the project · A Day · Period 2: ? → 202: its group is no longer in the project.',
    'a group no longer in the project ↔ 6B · A Day · Period 3: ? ↔ 103: one of its groups is no longer in the project.',
  ]);
  assert.equal(dropped[0].change, scenario.changes[0]);
});

test('reconcile: a deleted room drops a move into it; a slot left in the deleted room still applies', () => {
  const project = deleteSpaces(school(), { spaceIds: ['rsample204'] });
  assert.equal(slot(project, G6A, A, 6).roomText, '204', 'the slot keeps the number');
  const { changes, dropped } = reconcile(project, { changes: [move(G7C, 1, 'rsample204'), move(G6A, 6, 'rsample202')] });
  assert.deepEqual(changes, [move(G6A, 6, 'rsample202')]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), ['7C · A Day · Period 2: 203 → a room no longer in the building: the room it moves to is no longer in the building.']);
});

test('reconcile: a day type made the same as A Day again drops its changes', () => {
  const project = revertToBase(school(), { dayTypeId: B });
  const { changes, dropped } = reconcile(project, { changes: [move(G7C, 1, 'rsample204', B), move(G7C, 1, 'rsample204')] });
  assert.deepEqual(changes, [move(G7C, 1, 'rsample204')]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), ['7C · B Day · Period 2: ? → 204: B Day is the same as A Day again, so it has no schedule of its own to change.']);
});

test('reconcile: a shortened day drops a change in a period that is gone', () => {
  const project = setPeriods(school(), { periods: 6 });
  const { changes, dropped } = reconcile(project, { changes: [swapPeriods(G8A, 5, 6), move(G7C, 1, 'rsample204'), move(G6A, 7, 'rsample202')] });
  assert.deepEqual(changes, [move(G7C, 1, 'rsample204')]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), [
    '8A · A Day · Period 6 ↔ Period 7: Gym ↔ ?: Period 7 is no longer in the school day, which has 6.',
    '6A · A Day · Period 8: ? → 202: Period 8 is no longer in the school day, which has 6.',
  ]);
});

test('reconcile: a change the real schedule now already has is dropped, and comes back when the schedule does', () => {
  const real = school();
  const scenario = deepFreeze({ name: '', changes: [move(G7C, 1, 'rsample204')], compared: null });
  const changed = setSlot(real, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample204' } });
  assert.deepEqual(reconcile(changed, scenario).dropped.map((entry) => entry.sentence), ['7C · A Day · Period 2: 204 → 204: the schedule already has this.']);
  assert.deepEqual(reconcile(real, scenario), { changes: scenario.changes, dropped: [] }, 'a view, never a write: undoing the change brings it back');
});

test('reconcile: of two changes on one slot the earlier is dropped, so what is kept shares no slot', () => {
  const project = school();
  const { changes, dropped } = reconcile(project, { changes: [move(G7C, 1, 'rsample204'), swapPeriods(G7C, 1, 2)] });
  assert.deepEqual(changes, [swapPeriods(G7C, 1, 2)]);
  assert.match(dropped[0].sentence, /: a later change to the same period replaces it\.$/);
  assert.deepEqual(reconcile(project, null), { changes: [], dropped: [] });
});

// ---------------------------------------------------------------- 4. compare

test('compareResults: an empty scenario changes no figure, and every finding is unchanged', () => {
  const project = school();
  const result = run(project);
  const same = compareResults(result, run(applyScenario(project, { changes: [] })));
  for (const key of ['walking', 'crowding', 'late', 'failed']) assert.equal(same.figures[key].difference, 0, key);
  assert.equal(same.figures.busiest.difference, 0);
  assert.deepEqual(same.findings.new, []);
  assert.deepEqual(same.findings.resolved, []);
  assert.equal(same.findings.unchanged.length, result.findings.findings.length);
  assert.deepEqual(same.places, { covers: 'building', busier: [], quieter: [], elsewhere: 0 });
});

test('compareResults: walking is the crowd model\'s walking, never a route\'s seconds', () => {
  const project = school();
  const result = run(project);
  const compared = compareResults(result, result);
  const crowdWalking = result.walks.groups.reduce((sum, walk) => sum + walk.walking, 0);
  let routeSeconds = 0;
  for (const day of result.routes.days) for (const entry of day.groups) for (const found of entry.routes) if (found.ok && !found.same) routeSeconds += found.seconds;
  assert.notEqual(crowdWalking, routeSeconds, 'the sample school\'s routes and the crowd\'s walking differ (8A\'s long walk: 259 against 261)');
  assert.equal(compared.figures.walking.before, crowdWalking);
  assert.equal(compared.figures.crowding.before, result.walks.groups.reduce((sum, walk) => sum + walk.waiting, 0));
});

test('compareResults: moving 7C out of Room 203 resolves the double-booking by id; findings counted by severity', () => {
  const project = school();
  // Room 201 is free in Period 2 on A Day
  const changes = [move(G7C, 1, 'rsample201')];
  const compared = compareResults(run(project), run(applyScenario(project, { changes })), { changes });
  const doubled = 'room-double:' + A + ':1:' + SAMPLE_PROBLEMS.roomDouble.roomId;
  assert.deepEqual(compared.findings.resolved.map((finding) => finding.id), [doubled]);
  assert.deepEqual(compared.findings.new, []);
  assert.deepEqual(compared.figures.findings.problem, { before: 1, after: 0, difference: -1 });
  assert.deepEqual(compared.figures.findings.warning, { before: 1, after: 1, difference: 0 });
  assert.deepEqual(compared.figures.findings.note, { before: 2, after: 2, difference: 0 });
  assert.ok(compared.findings.unchanged.every((finding) => finding.id !== doubled));
});

test('compareResults: late is isLate with the school\'s margin', () => {
  const project = school();
  const swap = [swapPeriods(G8A, 5, 6)];
  const plain = compareResults(run(project), run(applyScenario(project, { changes: swap })));
  assert.equal(plain.figures.late.before, 1, '8A\'s long walk, 261 s against 240');
  project.settings.checks.passingMarginSeconds = 30;
  const margin = compareResults(run(project), run(applyScenario(project, { changes: swap })));
  assert.equal(margin.figures.late.before, 0, '261 s is not late against 240 s and a 30 s margin');
});

test('compareResults: the per-group change is biggest first, with the edited groups marked', () => {
  const project = school();
  const changes = [swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2)];
  const compared = compareResults(run(project), run(applyScenario(project, { changes })), { changes });
  const sizes = compared.groups.map((row) => Math.abs(row.difference));
  assert.deepEqual(sizes, sizes.slice().sort((a, b) => b - a));
  assert.deepEqual(compared.groups.filter((row) => row.edited).map((row) => row.groupId).sort(), [G6A, G6B, G8A]);
  const first = compared.groups[0];
  assert.equal(first.groupId, G8A);
  assert.equal(first.difference, first.after.total - first.before.total);
  assert.equal(compared.groups.length, project.groups.length);
});

test('compareResults: the places that change most, ranked over the building or over the floors shown', () => {
  const project = school();
  const changes = [swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2)];
  const before = run(project);
  const after = run(applyScenario(project, { changes }));
  const all = compareResults(before, after, { changes });
  assert.equal(all.places.covers, 'building');
  assert.ok(all.places.busier.length > 0 && all.places.quieter.length > 0);
  assert.ok(all.places.busier.every((row) => row.difference > 0 && row.after - row.before === row.difference));
  assert.ok(all.places.quieter.every((row) => row.difference < 0));
  const sizes = all.places.busier.map((row) => row.difference);
  assert.deepEqual(sizes, sizes.slice().sort((a, b) => b - a));
  const third = compareResults(before, after, { changes, floorIds: ['fsample003'] });
  assert.equal(third.places.covers, 'floors');
  const rows = third.places.busier.concat(third.places.quieter);
  assert.ok(rows.length > 0 && rows.every((row) => (row.place.floorIds || [row.place.floorId]).includes('fsample003')));
  assert.equal(rows.length + third.places.elsewhere, all.places.busier.length + all.places.quieter.length);
  assert.ok(third.places.elsewhere > 0);
  assert.equal(compareResults(before, after, { limit: 1 }).places.busier.length, 1);
});

test('compareResults: the busiest place before and after, and two different buildings refused', () => {
  const project = school();
  const result = run(project);
  const compared = compareResults(result, result);
  const busiest = compared.figures.busiest.before;
  assert.equal(busiest.load, Math.max(...result.loads.map((load) => load.max.busiest)));
  assert.equal(busiest.name, 'Main Corridor, by Door B');
  assert.equal(busiest.unit, 'students');
  const other = school();
  other.building.floors[2].corridors = [];
  assert.throws(() => compareResults(result, run(other)), TypeError);
});

// ---------------------------------------------------------------- 5. difference

test('loadDifference: Int32 deltas per node and link, whole day or one transition, and the largest change', () => {
  const project = school();
  const changes = [swapPeriods(G8A, 5, 6)];
  const before = run(project).loads[0];
  const after = run(applyScenario(project, { changes })).loads[0];
  const day = loadDifference(before, after);
  assert.ok(day.cells instanceof Int32Array && day.connections instanceof Int32Array);
  assert.equal(day.cells.length, before.cells.busiest.length);
  for (let i = 0; i < day.cells.length; i += 1) assert.equal(day.cells[i], after.cells.busiest[i] - before.cells.busiest[i]);
  assert.ok(day.largest > 0);
  assert.equal(day.largest, Math.max(...day.cells.map(Math.abs), ...day.connections.map(Math.abs)));
  const one = loadDifference(before, after, { transition: 4 });
  for (let i = 0; i < one.cells.length; i += 1) assert.equal(one.cells[i], after.cells.byTransition[4][i] - before.cells.byTransition[4][i]);
  const untouched = loadDifference(before, after, { transition: 0 });
  assert.equal(untouched.largest, 0, 'nothing changes out of Period 1');
  const total = loadDifference(before, after, { measure: 'total' });
  for (let i = 0; i < total.cells.length; i += 1) assert.equal(total.cells[i], after.cells.total[i] - before.cells.total[i]);
});

test('loadDifference: the largest change leaves the exclusion zones out', () => {
  const project = school();
  project.building.zones = project.building.floors.map((floor, i) => ({ id: 'zscen0000' + i, floorId: floor.id, label: '', x: 0, y: 0, w: floor.width, h: floor.height }));
  const changes = [swapPeriods(G8A, 5, 6)];
  const before = run(project).loads[0];
  const after = run(applyScenario(project, { changes })).loads[0];
  const difference = loadDifference(before, after);
  assert.ok(difference.cells.some((value) => value !== 0), 'the cells still change');
  assert.equal(difference.largest, 0);
  assert.equal(difference.excluded, after.excluded);
});

// ---------------------------------------------------------------- 6. compare with a file

function proposal() {
  const other = school();
  other.id = 'pother0001';
  // the same rooms, typed with other cases and spaces
  room(other, 'Gym').number = 'GYM';
  room(other, '204').number = ' 2 04 ';
  group(other, '7C').name = '7c';
  slot(other, G7C, A, 1).room = 'rsample204';
  slot(other, G6A, B, 3).room = 'rsamplegym';
  other.groups = other.groups.filter((candidate) => candidate.id !== G6B);
  other.groups.push({ ...clone(group(other, '6A')), id: 'gsample09a', name: '9A' });
  return other;
}

test('scenarioFromDiff: every slot whose room differs is a move, rooms by number and groups by name, whatever the case', () => {
  const project = school();
  const { scenario, skipped } = scenarioFromDiff(project, proposal(), { fileName: 'next-year.json' });
  assert.deepEqual(scenario.changes, [move(G7C, 1, 'rsample204'), move(G6A, 3, 'rsamplegym', B)]);
  assert.deepEqual(scenario.compared, { fileName: 'next-year.json', addedGroups: ['9A'], removedGroups: ['6B'] });
  assert.equal(scenario.name, 'Compared with next-year.json');
  assert.deepEqual(skipped, []);
  assertValid({ ...project, scenario });
});

test('scenarioFromDiff: a different building is refused with the count of rooms that differ', () => {
  const other = proposal();
  room(other, '303').number = '304';
  assert.throws(() => scenarioFromDiff(school(), other), (error) => {
    assert.ok(error instanceof ActionError);
    assert.equal(error.code, 'different-building');
    assert.equal(error.message, 'This file describes a different building: 2 rooms differ by number. Compare a file of the same building.');
    return true;
  });
  const fewer = proposal();
  fewer.building.floors[2].spaces = fewer.building.floors[2].spaces.filter((space) => space.id !== 'rsample301');
  assert.throws(() => scenarioFromDiff(school(), fewer), { message: /: 1 room differs by number\./ });
});

test('scenarioFromDiff: what a move cannot say is listed, not guessed', () => {
  const other = proposal();
  slot(other, G8A, A, 0).room = null;
  slot(other, G8A, A, 1).room = null;
  slot(other, G8A, A, 1).roomText = 'Portable 2';
  const { scenario, skipped } = scenarioFromDiff(school(), other);
  assert.deepEqual(scenario.changes.filter((change) => change.groupId === G8A), []);
  assert.deepEqual(skipped.map((entry) => entry.sentence), [
    '8A · A Day · Period 1: the file has no room there.',
    '8A · A Day · Period 2: the file has Portable 2 there, which is not in the building.',
  ]);
  const followed = revertToBase(school(), { dayTypeId: B });
  const sameAs = scenarioFromDiff(followed, proposal());
  assert.deepEqual(sameAs.scenario.changes, [move(G7C, 1, 'rsample204')]);
  // B Day follows A Day here and is its own copy in the file: its slots that differ are listed
  assert.ok(sameAs.skipped.some((entry) => entry.groupName === '6A' && entry.dayTypeName === 'B Day' && entry.period === 3));
  assert.ok(sameAs.skipped.every((entry) => entry.sentence.endsWith('B Day is the same as A Day here, so it has no schedule of its own to change.')));
});

// ---------------------------------------------------------------- 7. words

test('changeWords: the chip text of each kind, as parts, with typed names kept apart', () => {
  const project = school();
  assert.equal(changeWords(project, move(G6C, 1, 'rsample202')).text, '6C · A Day · Period 2: 203 → 202, taught by Mr. Castellanos instead of Ms. Vandermeer');
  assert.equal(changeWords(project, swapPeriods(G8A, 5, 6)).text, '8A · A Day · Period 6 ↔ Period 7: Gym ↔ 303');
  assert.equal(changeWords(project, swapRooms(G6A, G6B, 2)).text, '6A ↔ 6B · A Day · Period 3: 101 ↔ 103, 6A taught by Dr. Quillfeather instead of Ms. Halloran, 6B taught by Ms. Halloran instead of Dr. Quillfeather');
  assert.equal(changeWords(project, move(G6C, 1, 'rsamplecaf')).text, '6C · A Day · Period 2: 203 → Cafeteria, no longer taught by Ms. Vandermeer');
  const words = changeWords(project, move(G6C, 1, 'rsample202'));
  assert.deepEqual(words.parts.filter((part) => part.name).map((part) => part.text), ['6C', 'A Day', '203', '202', 'Mr. Castellanos', 'Ms. Vandermeer']);
  assert.deepEqual(words.teachers, [{ groupId: G6C, from: ['tsample007'], to: ['tsample006'] }]);
});

test('changeWords: a move that keeps the teachers says nothing of them; one day type is not named; the school\'s period word', () => {
  const project = school();
  slot(project, G6C, A, 1).teacherIds = ['tsample007'];
  assert.equal(changeWords(project, move(G6C, 1, 'rsample202')).text, '6C · A Day · Period 2: 203 → 202');
  assert.deepEqual(changeWords(project, move(G6C, 1, 'rsample202')).teachers, []);
  project.dayTypes = project.dayTypes.slice(0, 1);
  project.settings.periodWord = 'Block';
  assert.equal(changeWords(project, swapPeriods(G8A, 5, 6)).text, '8A · Block F ↔ Block G: Gym ↔ 303');
});

test('changeWords: names are text, never markup, and a room or slot with nothing to show says so', () => {
  const project = school();
  group(project, '6C').name = '<b>"6C"</b> & co';
  room(project, '202').number = '';
  slot(project, G6C, A, 1).room = null;
  const words = changeWords(project, move(G6C, 1, 'rsample202'));
  assert.equal(words.text, '<b>"6C"</b> & co · A Day · Period 2: no room → a room with no number, taught by Mr. Castellanos');
  assert.deepEqual(words.parts[0], { text: '<b>"6C"</b> & co', name: true });
  assert.equal(changeWords(project, move(G6C, 1, 'rgone00000')).text, '<b>"6C"</b> & co · A Day · Period 2: no room → a room no longer in the building');
});
