// The scenario engine (engine/scenario.js, ARCHITECTURE 6.6, SV2-60): apply,
// normalise, reconcile, the comparison, the difference map's numbers,
// "compare with another project file" and the chip words. Every case runs on
// the sample school, whose A Day has 6C and 7C both in Room 203 in Period 2
// and 8A's long walk from the Gym in Period 6 to Room 303 in Period 7.
// Nothing here reads a clock: the engine takes none.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as scenarioModule from '../../engine/scenario.js';
import { applyChanges, normalise, reconcile, compareResults, loadDifference, scenarioFromDiff, changeWords, changeSlots, editedGroupIds, trimResult } from '../../engine/scenario.js';
import { createPipeline } from '../../engine/worker.js';
import { deleteGroup, deleteSpaces, revertToBase, setPeriods, setSlot, ActionError } from '../../engine/actions.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { allRooms } from '../../engine/schema.js';
import { seededRandom } from '../../engine/ids.js';
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

test('applyChanges: a move puts the group in the room on its own day type, and keeps the label and named teachers', () => {
  const project = school();
  slot(project, G7C, A, 1).label = 'History';
  slot(project, G7C, A, 1).teacherIds = [teacher(project, 'Ms. Vandermeer').id];
  const after = applyChanges(project, { changes: [move(G7C, 1, 'rsample204')] });
  assert.deepEqual(slot(after, G7C, A, 1), { room: 'rsample204', roomText: '', label: 'History', teacherIds: [teacher(project, 'Ms. Vandermeer').id] });
  assert.equal(slot(after, G7C, B, 1), slot(project, G7C, B, 1), 'B Day is not touched');
  assert.equal(slot(project, G7C, A, 1).room, 'rsample203', 'the project handed in is not changed');
  assertValid(after);
});

test('applyChanges: a swap of periods trades whole slots; a swap of rooms trades the room and the kept number only', () => {
  const project = school();
  slot(project, G6A, A, 2).label = 'Algebra';
  slot(project, G6B, A, 2).room = null;
  slot(project, G6B, A, 2).roomText = 'Portable 2';
  const six = slot(project, G8A, A, 5);
  const seven = slot(project, G8A, A, 6);
  const after = applyChanges(project, { changes: [swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2)] });
  assert.deepEqual(slot(after, G8A, A, 5), seven);
  assert.deepEqual(slot(after, G8A, A, 6), six);
  assert.deepEqual(slot(after, G6A, A, 2), { room: null, roomText: 'Portable 2', label: 'Algebra', teacherIds: [] });
  assert.deepEqual(slot(after, G6B, A, 2), { room: 'rsample101', roomText: '', label: '', teacherIds: [] });
});

test('applyChanges: a change on a day type that is the same as A Day is refused in the schedule editor\'s words, and nothing changes', () => {
  const project = revertToBase(school(), { dayTypeId: B });
  const before = clone(project);
  deepFreeze(project);
  assert.throws(() => applyChanges(project, { changes: [move(G7C, 1, 'rsample204'), move(G6A, 1, 'rsample204', B)] }), (error) => {
    assert.ok(error instanceof ActionError);
    assert.equal(error.code, 'same-as-base');
    assert.equal(error.message, 'B Day is the same as A Day. Make it its own copy to change it.');
    return true;
  });
  assert.deepEqual(project, before);
  for (const change of [swapPeriods(G8A, 5, 6, B), swapRooms(G6A, G6B, 2, B)]) {
    assert.throws(() => applyChanges(project, { changes: [change] }), { code: 'same-as-base' }, change.kind);
  }
});

test('applyChanges: no scenario is the project itself; left out, the project\'s own scenario is applied', () => {
  const project = school();
  assert.equal(applyChanges(project, null), project);
  assert.equal(applyChanges(project, { name: '', changes: [], compared: null }), project);
  project.scenario = { name: 'Try 204', changes: [move(G7C, 1, 'rsample204')], compared: null };
  const after = applyChanges(project);
  assert.equal(slot(after, G7C, A, 1).room, 'rsample204');
  assert.equal(after.scenario, project.scenario, 'the scenario is left as it was: clearing it is the action\'s job');
});

test('applyChanges is the pure function; applyScenario is left for the undoable action', () => {
  assert.equal(typeof scenarioModule.applyChanges, 'function');
  assert.equal('applyScenario' in scenarioModule, false);
  const project = school();
  const list = [move(G7C, 1, 'rsample204')];
  assert.deepEqual(applyChanges(project, list), applyChanges(project, { changes: list }), 'a list or a scenario');
});

test('applyChanges: a room or group that is gone is refused, never half applied', () => {
  const project = deepFreeze(school());
  assert.throws(() => applyChanges(project, { changes: [move(G7C, 1, 'rsample204'), move(G7C, 2, 'rgone00000')] }), { code: 'missing' });
  assert.throws(() => applyChanges(project, { changes: [swapRooms(G6A, 'ggone00000', 2)] }), { code: 'missing' });
  assert.throws(() => applyChanges(project, { changes: [move(G7C, 8, 'rsample204')] }), { code: 'bad-value' });
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

test('normalise: a change added that leaves the schedule as it is is removed, and a list with nothing to remove comes back as it was', () => {
  const project = school();
  // 6C and 7C are both in Room 203 in Period 2: trading their rooms changes nothing
  for (const change of [swapRooms(G6C, G7C, 1), swapRooms(G6A, G6A, 2), swapPeriods(G8A, 4, 4), move(G6A, 0, slot(project, G6A, A, 0).room)]) {
    assert.deepEqual(normalise(project, [change]), [], change.kind);
  }
  // every group is in the Cafeteria for lunch in Period 4 on A Day: so is a swap of two lunch slots
  assert.deepEqual(normalise(project, [swapRooms(G6A, G6B, 3)]), []);
  const list = [move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6)];
  assert.equal(normalise(project, list), list);
});

test('normalise: only the change being added goes for changing nothing; an older one the schedule caught up with stays', () => {
  const real = school();
  const scenario = [move(G7C, 1, 'rsample204')];
  // the real schedule then puts 7C in 204, and an unrelated change is added
  const changed = setSlot(real, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample204' } });
  const unrelated = swapPeriods(G8A, 5, 6);
  const added = normalise(changed, scenario.concat([unrelated]));
  assert.deepEqual(added, [move(G7C, 1, 'rsample204'), unrelated], 'the 7C move is kept');
  assert.deepEqual(reconcile(changed, added).changes, [unrelated], 'and left out of what applies while the schedule has it');
  // the real edit is undone
  assert.equal(reconcile(real, added).changes.length, 2);
  // `added` names the change being added; null removes nothing for changing nothing
  const noOps = [move(G6A, 0, slot(real, G6A, A, 0).room), swapPeriods(G8A, 4, 4)];
  assert.deepEqual(normalise(real, noOps, { added: 0 }), [noOps[1]]);
  assert.equal(normalise(real, noOps, { added: null }), noOps);
  assert.deepEqual(normalise(real, [move(G7C, 1, 'rsample204'), move(G7C, 1, 'rsample203')], { added: null }), [move(G7C, 1, 'rsample203')], 'one change per slot holds all the same');
  assert.throws(() => normalise(real, noOps, { added: '1' }), TypeError);
});

test('normalise: what it keeps can be applied in any order with the same result', () => {
  const project = school();
  const kept = normalise(project, [move(G7C, 1, 'rsample204'), swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2), move(G8A, 5, 'rsample101')]);
  assert.equal(kept.length, 3);
  assert.deepEqual(applyChanges(project, { changes: kept.slice().reverse() }), applyChanges(project, { changes: kept }));
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

test('reconcile: the most basic reason comes first, before a later change on the same slot', () => {
  const project = deleteGroup(school(), { id: G6A });
  const { changes, dropped } = reconcile(project, [swapRooms(G6A, G6B, 2), move(G6B, 2, 'rsample202')]);
  assert.deepEqual(changes, [move(G6B, 2, 'rsample202')]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), ['a group no longer in the project ↔ 6B · A Day · Period 3: ? ↔ 103: one of its groups is no longer in the project.']);
  const same = revertToBase(school(), { dayTypeId: B });
  assert.match(reconcile(same, [move(G7C, 1, 'rsample204', B), move(G7C, 1, 'rsample202', B)]).dropped[0].sentence, /B Day is the same as A Day again/);
});

test('reconcile: a change replaced only by a later one that can no longer apply applies again', () => {
  const project = setPeriods(school(), { periods: 7 });
  const earlier = move(G7C, 1, 'rsample204');
  const { changes, dropped } = reconcile(project, [earlier, swapPeriods(G7C, 1, 7)]);
  assert.deepEqual(changes, [earlier]);
  assert.deepEqual(dropped.map((entry) => entry.sentence), ['7C · A Day · Period 2 ↔ Period 8: 203 ↔ ?: Period 8 is no longer in the school day, which has 7.']);
  // on the full day the swap stands, and replaces the move
  assert.deepEqual(reconcile(school(), [earlier, swapPeriods(G7C, 1, 7)]).changes, [swapPeriods(G7C, 1, 7)]);
});

test('reconcile: a later change the schedule already has still replaces the earlier one', () => {
  const real = school();
  const changed = setSlot(real, { groupId: G7C, dayTypeId: A, period: 1, slot: { room: 'rsample202' } });
  const { changes, dropped } = reconcile(changed, [move(G7C, 1, 'rsample204'), move(G7C, 1, 'rsample202')]);
  assert.deepEqual(changes, [], 'the slot is as the user last asked: 7C is not sent to 204');
  assert.deepEqual(dropped.map((entry) => entry.sentence.replace(/^.*: /, '')), ['a later change to the same period replaces it.', 'the schedule already has this.']);
});

// ---------------------------------------------------------------- 4. compare

test('compareResults: an empty scenario changes no figure, and every finding is unchanged', () => {
  const project = school();
  const result = run(project);
  const same = compareResults(result, run(applyChanges(project, { changes: [] })));
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
  const compared = compareResults(run(project), run(applyChanges(project, { changes })), { changes });
  const doubled = 'room-double:' + A + ':1:' + SAMPLE_PROBLEMS.roomDouble.roomId;
  assert.deepEqual(compared.findings.resolved.map((finding) => finding.id), [doubled]);
  assert.deepEqual(compared.findings.new, []);
  assert.deepEqual(compared.figures.findings.problem, { before: 1, after: 0, difference: -1 });
  assert.deepEqual(compared.figures.findings.warning, { before: 1, after: 1, difference: 0 });
  assert.deepEqual(compared.figures.findings.note, { before: 2, after: 2, difference: 0 });
  assert.ok(compared.findings.unchanged.every((finding) => finding.id !== doubled));
});

test('compareResults: a finding is told by its id, so one whose sentence names other groups now is unchanged', () => {
  const project = school();
  // 7C leaves Room 203 and 8A comes in: still two groups there, the same finding with other names
  const changes = [move(G7C, 1, 'rsample201'), move(G8A, 1, 'rsample203')];
  const compared = compareResults(run(project), run(applyChanges(project, { changes })), { changes });
  const doubled = 'room-double:' + A + ':1:' + SAMPLE_PROBLEMS.roomDouble.roomId;
  const kept = compared.findings.unchanged.find((finding) => finding.id === doubled);
  assert.ok(kept, 'the double-booking is unchanged');
  assert.match(kept.text, /6C and 8A/, 'and carries the sentence as it is after the scenario');
  assert.ok(!compared.findings.new.some((finding) => finding.id === doubled) && !compared.findings.resolved.some((finding) => finding.id === doubled));
});

test('compareResults: late is isLate with the school\'s margin', () => {
  const project = school();
  const swap = [swapPeriods(G8A, 5, 6)];
  const plain = compareResults(run(project), run(applyChanges(project, { changes: swap })));
  assert.equal(plain.figures.late.before, 1, '8A\'s long walk, 261 s against 240');
  project.settings.checks.passingMarginSeconds = 30;
  const margin = compareResults(run(project), run(applyChanges(project, { changes: swap })));
  assert.equal(margin.figures.late.before, 0, '261 s is not late against 240 s and a 30 s margin');
});

test('compareResults: the per-group change is biggest first, with the edited groups marked', () => {
  const project = school();
  const changes = [swapPeriods(G8A, 5, 6), swapRooms(G6A, G6B, 2)];
  const compared = compareResults(run(project), run(applyChanges(project, { changes })), { changes });
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
  const after = run(applyChanges(project, { changes }));
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

// Room 204 shut off: no door, and moved to a corner of its floor away from
// every corridor, so a walk into or out of it has no way through.
function shutOff204() {
  const project = school();
  const shut = project.building.floors[1].spaces.find((space) => space.id === 'rsample204');
  shut.cells = [0];
  shut.doors = [];
  return project;
}

test('compareResults: a walk that fails after the scenario is never time saved, and its group comes first', () => {
  const project = shutOff204();
  const G7A = 'gsample07a';
  // 8A into the shut room in Period 3; 7A to Room 303 in Period 6, a long way that adds 252 s
  const changes = [move(G8A, 2, 'rsample204'), move(G7A, 5, 'rsample303')];
  const compared = compareResults(run(project), run(applyChanges(project, changes)), { changes });
  assert.deepEqual(compared.figures.failed, { before: 20, after: 22, difference: 2 });
  const [first, second] = compared.groups;
  assert.equal(first.groupId, G8A, 'more failed walks after: first, ahead of any time change');
  assert.equal(first.failedChange, 2);
  assert.deepEqual([first.before.failed, first.after.failed], [1, 3]);
  assert.ok(first.after.total < first.before.total, 'the two walks that now fail are missing from the total');
  assert.equal(first.difference, null, 'so no time change is given, and none reads as time saved');
  assert.equal(second.groupId, G7A);
  assert.equal(second.difference, 252);
  assert.equal(second.failedChange, 0);
  // the other way round, the walks that work again come before any time change too
  const back = compareResults(run(applyChanges(project, changes)), run(project), { changes });
  assert.deepEqual([back.groups[0].groupId, back.groups[0].failedChange, back.groups[0].difference], [G8A, -2, null]);
  assert.equal(back.groups[1].groupId, G7A);
});

test('compareResults reads only places, loads, walks, findings and the failed walks: no crowd, no routes', () => {
  const project = shutOff204();
  const changes = [move(G8A, 2, 'rsample204'), swapPeriods(G8A, 5, 6)];
  const before = run(project);
  const after = run(applyChanges(project, changes));
  const full = compareResults(before, after, { changes, transition: 4 });
  const trimmed = [trimResult(before), trimResult(after)];
  assert.deepEqual(Object.keys(trimmed[0]).sort(), ['failedWalks', 'findings', 'loads', 'places', 'walks']);
  assert.equal(trimmed[0].walks, before.walks, 'the result\'s own parts, not copies');
  assert.equal(trimResult(trimmed[0]), trimmed[0]);
  const lean = [before, after].map((result) => {
    const copy = { ...result, failedWalks: trimResult(result).failedWalks };
    delete copy.crowd;
    delete copy.routes;
    return copy;
  });
  assert.deepEqual(compareResults(lean[0], lean[1], { changes, transition: 4 }), full);
  assert.deepEqual(compareResults(trimmed[0], trimmed[1], { changes, transition: 4 }), full);
  assert.ok(full.figures.failed.difference > 0 && full.figures.walking.difference !== 0, 'the comparison has something in it to lose');
  // a result with its routes gone and no failed walks would read as one where nothing fails
  const bare = { ...before };
  delete bare.routes;
  assert.throws(() => compareResults(bare, after), TypeError);
});

// ---------------------------------------------------------------- 5. difference

test('loadDifference: Int32 deltas per node and link, whole day or one transition, and the largest change', () => {
  const project = school();
  const changes = [swapPeriods(G8A, 5, 6)];
  const before = run(project).loads[0];
  const after = run(applyChanges(project, { changes })).loads[0];
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

test('loadDifference: two day types\' loads are refused', () => {
  const result = run(school());
  assert.equal(result.loads.length, 2);
  assert.throws(() => loadDifference(result.loads[0], result.loads[1]), { name: 'TypeError', message: 'loadDifference needs two loads() results of one day type.' });
});

test('loadDifference: the largest change leaves the exclusion zones out', () => {
  const project = school();
  project.building.zones = project.building.floors.map((floor, i) => ({ id: 'zscen0000' + i, floorId: floor.id, label: '', x: 0, y: 0, w: floor.width, h: floor.height }));
  const changes = [swapPeriods(G8A, 5, 6)];
  const before = run(project).loads[0];
  const after = run(applyChanges(project, { changes })).loads[0];
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
    assert.equal(error.message, 'This file describes a different building: 1 room is missing and 1 is added.', 'a renumbered room is counted once on each side');
    return true;
  });
  const fewer = proposal();
  fewer.building.floors[2].spaces = fewer.building.floors[2].spaces.filter((space) => space.id !== 'rsample301');
  assert.throws(() => scenarioFromDiff(school(), fewer), { message: 'This file describes a different building: 1 room is missing.' });
  assert.throws(() => scenarioFromDiff(fewer, school()), { message: 'This file describes a different building: 1 room is added.' });
  const two = proposal();
  room(two, '303').number = '304';
  room(two, '301').number = '305';
  assert.throws(() => scenarioFromDiff(school(), two), { message: 'This file describes a different building: 2 rooms are missing and 2 are added.' });
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

// C Day its own copy of B Day's classes, D Day the same as C Day (not the base)
const C = 'dsample00c';
const D = 'dsample00d';
function withCAndD(project, dOwn) {
  const blank = project.dayTypes[0].bells.map(() => null);
  project.dayTypes.push({ id: C, name: 'C Day', own: true, sameAs: null, short: '', bells: project.dayTypes[1].bells.map((bell) => (bell ? { ...bell } : null)) });
  project.dayTypes.push({ id: D, name: 'D Day', own: dOwn, sameAs: dOwn ? null : C, short: '', bells: dOwn ? project.dayTypes[1].bells.map((bell) => (bell ? { ...bell } : null)) : blank });
  for (const one of project.groups) {
    one.days[C] = clone(one.days[B]);
    if (dOwn) one.days[D] = clone(one.days[B]);
  }
  return project;
}

test('scenarioFromDiff and reconcile: a day type the same as C Day says it is the same as C Day, not the base', () => {
  const mine = withCAndD(school(), false);
  const file = withCAndD(school(), true);
  slot(file, G6A, D, 3).room = 'rsamplegym';
  const { skipped } = scenarioFromDiff(mine, file);
  const onD = skipped.filter((entry) => entry.dayTypeName === 'D Day');
  assert.ok(onD.length > 0, 'the file\'s D Day differs');
  for (const entry of onD) assert.ok(entry.sentence.endsWith('D Day is the same as C Day here, so it has no schedule of its own to change.'), entry.sentence);
  const dropped = reconcile(mine, [move(G7C, 1, 'rsample204', D)]).dropped;
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].sentence, /D Day is the same as C Day again, so it has no schedule of its own to change\.$/);
});

test('scenarioFromDiff: rooms whose numbers read alike in one building are told apart by the engine\'s own key', () => {
  const project = school();
  room(project, '201').number = 'B12';
  room(project, '202').number = 'B 12';
  const other = clone(project);
  // 6A is in "B12" in Period 1 on A Day: the file has it in "B 12", and 8A in "B12"
  assert.equal(slot(project, G6A, A, 0).room, 'rsample201');
  slot(other, G6A, A, 0).room = 'rsample202';
  slot(other, G8A, A, 0).room = 'rsample201';
  const { scenario, skipped } = scenarioFromDiff(project, other);
  assert.deepEqual(scenario.changes, [move(G6A, 0, 'rsample202'), move(G8A, 0, 'rsample201')]);
  assert.deepEqual(skipped, []);
});

test('scenarioFromDiff: rooms that cannot be told apart are listed with their own sentence, never guessed', () => {
  const project = school();
  room(project, '201').number = 'B12';
  room(project, '202').number = 'b12';
  const other = clone(project);
  slot(other, G8A, A, 0).room = 'rsample201';
  const { scenario, skipped } = scenarioFromDiff(project, other);
  assert.deepEqual(scenario.changes, []);
  // every slot in either room is one that cannot be said, 8A's among them
  assert.ok(skipped.some((entry) => entry.sentence === '8A · A Day · Period 1: two rooms in this building have numbers that read alike: B12 and b12.'));
  assert.ok(skipped.length > 1 && skipped.every((entry) => entry.reason === 'alike'));
  // a room with no number has a sentence of its own
  room(project, 'B12').number = '';
  room(other, 'B12').number = '';
  const unnumbered = scenarioFromDiff(project, other).skipped;
  assert.ok(unnumbered.every((entry) => entry.reason === 'no-number'));
  assert.ok(unnumbered.some((entry) => entry.sentence === '8A · A Day · Period 1: the file has a room with no number there, which cannot be matched.'));
});

test('scenarioFromDiff: full-width digits are the same number', () => {
  const other = proposal();
  room(other, ' 2 04 ').number = '２０４';
  assert.deepEqual(scenarioFromDiff(school(), other).scenario.changes, [move(G7C, 1, 'rsample204'), move(G6A, 3, 'rsamplegym', B)]);
});

test('scenarioFromDiff: periods beyond the shorter day and day types in only one file are listed', () => {
  const other = setPeriods(proposal(), { periods: 6 });
  other.dayTypes[1].name = 'C Day';
  const { scenario, skipped } = scenarioFromDiff(school(), other);
  assert.deepEqual(scenario.changes, [move(G7C, 1, 'rsample204')]);
  assert.deepEqual(skipped.map((entry) => [entry.reason, entry.groupName, entry.dayTypeName, entry.period, entry.sentence]), [
    ['day-type', null, 'B Day', null, 'B Day: the file has no day type of this name, so it is not compared.'],
    ['day-type', null, 'C Day', null, 'C Day: only the file has this day type, so it is not compared.'],
    ['period', null, null, 6, 'Period 7: the file\'s day has 6 periods, so it is not compared.'],
    ['period', null, null, 7, 'Period 8: the file\'s day has 6 periods, so it is not compared.'],
  ]);
  const longer = scenarioFromDiff(setPeriods(school(), { periods: 7 }), proposal()).skipped;
  assert.deepEqual(longer.map((entry) => entry.sentence), ['Period 8 of the file: this project\'s day has 7 periods, so it is not compared.']);
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

// ---------------------------------------------------------------- 8. property

// Random change lists, from a seeded generator, against the sample school
// and three variants of it (B Day the same as A Day, 6B deleted, a day of 5
// periods). A small pool of groups and periods, so changes collide often;
// on the variants a change may name a period past the day or a room that is
// gone. Built the way the lab builds a scenario, one change added at a time.
function propertyCases() {
  const random = seededRandom(60);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const base = school();
  const groups = base.groups.slice(0, 5).map((candidate) => candidate.id);
  const rooms = allRooms(base).map((candidate) => candidate.id);
  const days = base.dayTypes.map((dayType) => dayType.id);
  const periods = base.settings.periods;
  const projects = [base, revertToBase(school(), { dayTypeId: B }), deleteGroup(school(), { id: G6B }), setPeriods(school(), { periods: 5 })];
  const changeFor = (wild) => {
    const dayTypeId = pick(days);
    const period = () => Math.floor(random() * (wild ? periods + 2 : periods));
    const kind = random();
    if (kind < 0.4) return move(pick(groups), period(), wild && random() < 0.1 ? 'rgone00000' : pick(rooms), dayTypeId);
    if (kind < 0.7) return swapPeriods(pick(groups), period(), period(), dayTypeId);
    return swapRooms(pick(groups), pick(groups), period(), dayTypeId);
  };
  const cases = [];
  for (let trial = 0; trial < 1200; trial += 1) {
    const which = trial % projects.length;
    const length = 1 + Math.floor(random() * 8);
    cases.push({ project: projects[which], clean: which === 0, list: Array.from({ length }, () => changeFor(which !== 0)) });
  }
  return cases;
}

function sharesNoSlot(changes) {
  const seen = new Set();
  for (const change of changes) {
    // a swap of a period with itself names one slot twice
    const own = new Set(changeSlots(change).map((slot) => slot.dayTypeId + '|' + slot.groupId + '|' + slot.period));
    for (const key of own) if (seen.has(key)) return false;
    for (const key of own) seen.add(key);
  }
  return true;
}

function shuffled(list, random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('property: a scenario built one change at a time keeps one change per slot, and normalising it again changes nothing', () => {
  for (const { project, list } of propertyCases()) {
    let built = [];
    for (const change of list) built = normalise(project, built.concat([change]));
    assert.ok(sharesNoSlot(built), JSON.stringify(list));
    assert.equal(normalise(project, built, { added: null }), built, JSON.stringify(list));
    assert.ok(sharesNoSlot(normalise(project, list, { added: null })), JSON.stringify(list));
  }
});

test('property: what reconcile keeps shares no slot, applies without a refusal, in any order, and every change of it does something', () => {
  const random = seededRandom(61);
  for (const { project, list } of propertyCases()) {
    let built = [];
    for (const change of list) built = normalise(project, built.concat([change]));
    for (const changes of [list, built]) {
      const kept = reconcile(project, changes);
      assert.ok(sharesNoSlot(kept.changes), JSON.stringify(changes));
      assert.equal(kept.changes.length + kept.dropped.length, changes.length);
      assert.ok(kept.dropped.every((entry) => entry.sentence.endsWith('.')));
      const applied = applyChanges(project, kept.changes);
      assert.deepEqual(applyChanges(project, shuffled(kept.changes, random)), applied, JSON.stringify(changes));
      for (const change of kept.changes) assert.notDeepEqual(applyChanges(project, [change]), project, JSON.stringify(change));
    }
  }
});

test('property: on the sample school as it is, reconcile keeps exactly the scenario built one change at a time', () => {
  for (const { project, list, clean } of propertyCases()) {
    if (!clean) continue;
    let built = [];
    for (const change of list) built = normalise(project, built.concat([change]));
    assert.deepEqual(reconcile(project, built), { changes: built, dropped: [] }, JSON.stringify(list));
    assert.deepEqual(reconcile(project, list).changes, built, JSON.stringify(list));
  }
});
