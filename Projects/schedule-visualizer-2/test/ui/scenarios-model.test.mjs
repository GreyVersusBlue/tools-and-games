// The scenario lab's plain functions (SV2-68b), with no page: whether an
// added change cancelled itself, the signs and the better or worse marks of
// the Before / After / Difference table and of a group's row, which groups
// the table lists, and the words in the bar at the section's foot. The lab
// in a page is test/browser/scenario.mjs.
//
//   node test/ui/scenarios-model.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import { timeFigures, duration, cancelled, figureRows, groupRow, groupRows, barWords } from '../../ui/scenarios/model.js';

const MINUS = '−';
const NBSP = ' ';

const move = (groupId, period, roomId) => ({ kind: 'move', dayTypeId: 'd1', groupId, period, roomId });

test('cancelled: a change still in the list after adding is no cancel', () => {
  const change = move('g1', 2, 'r1');
  assert.equal(cancelled({ changes: [] }, { changes: [change] }, change), null);
  // equal field by field is enough: the stored change is its own copy
  assert.equal(cancelled({ changes: [] }, { changes: [{ ...change }] }, change), null);
});

test('cancelled: a change in neither list says how many earlier changes went with it', () => {
  const earlier = move('g1', 2, 'r1');
  const other = move('g2', 0, 'r3');
  const back = move('g1', 2, 'r9');
  assert.deepEqual(cancelled({ changes: [earlier, other] }, { changes: [other] }, back), { taken: 1 });
  assert.deepEqual(cancelled({ changes: [] }, { changes: [] }, back), { taken: 0 });
  // no scenario on either side reads as no changes
  assert.deepEqual(cancelled(null, null, back), { taken: 0 });
});

test('cancelled: a stored change with a field more is not the same change', () => {
  const change = move('g1', 2, 'r1');
  assert.deepEqual(cancelled({ changes: [] }, { changes: [{ ...change, extra: 1 }] }, change), { taken: 0 });
  // and one field different is not the same either
  assert.deepEqual(cancelled({ changes: [] }, { changes: [{ ...change, period: 3 }] }, change), { taken: 0 });
});

function figures(d) {
  const side = (n) => ({ before: 10, after: 10 + n, difference: n });
  return {
    figures: {
      walking: { before: 600, after: 600 + d.walking, difference: d.walking },
      crowding: { before: 90, after: 90 + d.crowding, difference: d.crowding },
      busiest: { before: { load: 30, unit: 'students', name: 'Hall' }, after: { load: 30 + d.busiest, unit: 'students', name: 'Hall' }, difference: d.busiest },
      late: side(d.late),
      failed: side(d.failed),
      findings: { problem: side(d.problem), warning: side(d.warning), note: side(d.note) },
    },
  };
}

test('figureRows: eight rows, signed differences, every figure better lower', () => {
  const rows = figureRows(figures({ walking: 75, crowding: -30, busiest: 0, late: 2, failed: -1, problem: 1, warning: 0, note: -3 }));
  assert.deepEqual(rows.map((row) => row.id), ['walking', 'crowding', 'busiest', 'late', 'failed', 'problem', 'warning', 'note']);
  const by = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(by.walking.before, '10' + NBSP + 'min');
  assert.equal(by.walking.after, '11' + NBSP + 'min' + NBSP + '15' + NBSP + 's');
  assert.equal(by.walking.difference, '+1' + NBSP + 'min' + NBSP + '15' + NBSP + 's');
  assert.equal(by.walking.worse, true, 'more walking is worse');
  assert.equal(by.crowding.difference, MINUS + '30' + NBSP + 's');
  assert.equal(by.crowding.worse, false, 'less crowding is better');
  assert.equal(by.busiest.label, 'Busiest load (students)');
  assert.equal(by.busiest.difference, 'no change');
  assert.equal(by.busiest.worse, null, 'no change is neither');
  assert.equal(by.late.difference, '+2');
  assert.equal(by.late.worse, true);
  assert.equal(by.failed.difference, MINUS + '1');
  assert.equal(by.failed.worse, false);
  assert.equal(by.problem.worse, true);
  assert.equal(by.warning.worse, null);
  assert.equal(by.note.difference, MINUS + '3');
  assert.equal(by.note.worse, false);
});

test('figureRows: no busiest place on either side reads as a dash', () => {
  const compare = figures({ walking: 0, crowding: 0, busiest: 0, late: 0, failed: 0, problem: 0, warning: 0, note: 0 });
  compare.figures.busiest = { before: null, after: null, difference: 0 };
  const busiest = figureRows(compare).find((row) => row.id === 'busiest');
  assert.equal(busiest.label, 'Busiest load (students)');
  assert.deepEqual([busiest.before, busiest.after], ['—', '—']);
});

const project = { groups: [{ id: 'g1', name: '<b>7A</b>' }, { id: 'g2', name: '7B' }] };
const sideOf = (total) => ({ walking: total, waiting: 0, total, late: 0, walks: 4, failed: 0 });

test('groupRow: a time change is signed, longer is worse and shorter better', () => {
  const longer = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(100), after: sideOf(130), difference: 30, failedChange: 0 });
  assert.equal(longer.name, '<b>7A</b>', 'the name as typed');
  assert.equal(longer.typed, true);
  assert.equal(longer.change, '+30' + NBSP + 's');
  assert.equal(longer.worse, true);
  const shorter = groupRow(project, { groupId: 'g2', edited: false, before: sideOf(130), after: sideOf(100), difference: -30, failedChange: 0 });
  assert.equal(shorter.change, MINUS + '30' + NBSP + 's');
  assert.equal(shorter.worse, false);
  const same = groupRow(project, { groupId: 'g2', edited: true, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 });
  assert.equal(same.change, 'no change');
  assert.equal(same.worse, null);
});

test('groupRow: walks with no way through are worded by that, whatever the time says', () => {
  const more = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(100), after: sideOf(60), difference: null, failedChange: 2 });
  assert.equal(more.change, '2 walks more with no way through');
  assert.equal(more.worse, true, 'more walks with no way through is worse, though the time went down');
  const fewer = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(60), after: sideOf(100), difference: null, failedChange: -1 });
  assert.equal(fewer.change, '1 walk fewer with no way through');
  assert.equal(fewer.worse, false);
  const unknown = groupRow(project, { groupId: 'g1', edited: true, before: null, after: sideOf(60), difference: null, failedChange: 0 });
  assert.equal(unknown.change, '—');
  assert.equal(unknown.before, '—');
  assert.equal(unknown.worse, null);
});

test('groupRow: a group no longer in the project is named so, and not as typed text', () => {
  const row = groupRow(project, { groupId: 'gone', edited: true, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 });
  assert.equal(row.name, 'A group no longer in the project');
  assert.equal(row.typed, false);
});

// SV2-72d2 item 5: the list is of the groups whose printed change is a
// change. An edited group whose times stay reads "no change" and is counted
// with the others that walk as before (this case listed g3 until then).
test('groupRows: the groups whose travel changes as printed, the rest counted, an edited group that stays the same among them', () => {
  const compare = {
    groups: [
      { groupId: 'g1', edited: false, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 1 },
      { groupId: 'g2', edited: false, before: sideOf(100), after: sideOf(120), difference: 20, failedChange: 0 },
      { groupId: 'g3', edited: true, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 },
      { groupId: 'g4', edited: false, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 },
      { groupId: 'g5', edited: false, before: null, after: null, difference: null, failedChange: 0 },
      { groupId: 'g6', edited: true, before: null, after: sideOf(60), difference: null, failedChange: 0 },
    ],
  };
  const found = groupRows(project, compare);
  assert.deepEqual(found.rows.map((row) => row.groupId), ['g1', 'g2', 'g6'], 'in the comparison’s order; an edited group with no time on a side is still listed');
  assert.equal(found.same, 3, 'an edited group the same, a group the same, and one with no time either side, walk as before');
});

test('SV2-72d2 5: a group whose seconds moved but whose printed change is "no change" is not listed, and is counted as walking as before', () => {
  const compare = {
    groups: [
      { groupId: 'g1', edited: false, before: sideOf(9228), after: sideOf(9240), difference: 12, failedChange: 0 },
      { groupId: 'g2', edited: true, before: sideOf(9228), after: sideOf(9240), difference: 12, failedChange: 0 },
      { groupId: 'g3', edited: false, before: sideOf(3500), after: sideOf(3700), difference: 200, failedChange: 0 },
    ],
  };
  const found = groupRows(project, compare);
  assert.deepEqual(found.rows.map((row) => [row.groupId, row.change]), [['g3', '+4' + NBSP + 'min']]);
  assert.equal(found.rows.some((row) => row.change === 'no change'), false, 'no row says it did not change');
  assert.equal(found.same, 2, '12 s over two and a half hours walks as before, edited or not');
});

test('SV2-72d2 4: a group\'s Before and After are to the grain of its change: 3500 s to 3700 s reads 58 min, 1 h 2 min, +4 min', () => {
  const row = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(3500), after: sideOf(3700), difference: 200, failedChange: 0 });
  assert.deepEqual([row.before, row.after, row.change], ['58' + NBSP + 'min', '1' + NBSP + 'h' + NBSP + '2' + NBSP + 'min', '+4' + NBSP + 'min'], 'never "58 min 20 s" beside a change to the minute');
  assert.equal(row.worse, true);
  // under an hour on both sides the cells stay to the second
  const short = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(100), after: sideOf(130), difference: 30, failedChange: 0 });
  assert.deepEqual([short.before, short.after, short.change], ['1' + NBSP + 'min' + NBSP + '40' + NBSP + 's', '2' + NBSP + 'min' + NBSP + '10' + NBSP + 's', '+30' + NBSP + 's']);
  // a row worded by its walks with no way through keeps each side's own time
  const failed = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(3500), after: sideOf(60), difference: null, failedChange: 1 });
  assert.deepEqual([failed.before, failed.after], ['58' + NBSP + 'min' + NBSP + '20' + NBSP + 's', '1' + NBSP + 'min']);
});

test('barWords: what is staged, with what is skipped', () => {
  assert.equal(barWords(null), '');
  assert.equal(barWords({ kept: [], dropped: [] }), 'Not applied yet: no changes');
  assert.equal(barWords({ kept: [{}], dropped: [] }), 'Not applied yet: 1 change');
  assert.equal(barWords({ kept: [{}, {}, {}], dropped: [{}, {}] }), 'Not applied yet: 3 changes, 2 skipped');
});

// SV2-72d item 3 (W3): an hour or more reads in hours and minutes, and a
// time's three cells agree, as the congestion report's do.
test('SV2-72d: durations from an hour read in hours and minutes, with no plain space inside a figure', () => {
  assert.equal(duration(45), '45' + NBSP + 's');
  assert.equal(duration(478), '7' + NBSP + 'min' + NBSP + '58' + NBSP + 's');
  assert.equal(duration(3599), '59' + NBSP + 'min' + NBSP + '59' + NBSP + 's');
  assert.equal(duration(3600), '1' + NBSP + 'h');
  assert.equal(duration(9228), '2' + NBSP + 'h' + NBSP + '34' + NBSP + 'min', '153 min 48 s');
  assert.equal(duration(3629), '1' + NBSP + 'h', 'to the nearest minute');
  assert.equal(duration(3631), '1' + NBSP + 'h' + NBSP + '1' + NBSP + 'min');
  for (const seconds of [0, 59, 61, 3600, 9228, 86399]) assert.ok(!duration(seconds).includes(' '), seconds + ' has no breaking space');
});

test('SV2-72d: timeFigures: the difference is that of the two times as printed, to the minute once either reads in hours', () => {
  assert.deepEqual(timeFigures(9228, 9276), { before: '2' + NBSP + 'h' + NBSP + '34' + NBSP + 'min', after: '2' + NBSP + 'h' + NBSP + '35' + NBSP + 'min', difference: '+1' + NBSP + 'min', n: 60 });
  assert.equal(timeFigures(9228, 9240).difference, 'no change', '12 seconds over two and a half hours prints the same, so no change');
  assert.deepEqual(timeFigures(3500, 3700), { before: '58' + NBSP + 'min', after: '1' + NBSP + 'h' + NBSP + '2' + NBSP + 'min', difference: '+4' + NBSP + 'min', n: 240 }, '58 min 20 s beside 1 h 1 min 40 s: all three to the minute, 58 to 62');
  assert.deepEqual(timeFigures(100.4, 101.6), { before: '1' + NBSP + 'min' + NBSP + '40' + NBSP + 's', after: '1' + NBSP + 'min' + NBSP + '42' + NBSP + 's', difference: '+2' + NBSP + 's', n: 2 });
  assert.equal(timeFigures(4000, 300).difference, MINUS + '1' + NBSP + 'h' + NBSP + '2' + NBSP + 'min', '67 min to 5 min');
  const row = groupRow(project, { groupId: 'g1', edited: true, before: sideOf(9228), after: sideOf(9240), difference: 12, failedChange: 0 });
  assert.deepEqual([row.change, row.worse], ['no change', null], 'a group\'s row agrees with its printed times');
});

// ---------------------------------------------------------------- SV2-92: the levers

import {
  scenarioView, applySummary, applyButtonWords, firstLine, heldNotes, leverCancelled, leverCancelledSentence,
  bellSets, bellLever, bellPassingWords, lengthenPassing, insteadOf,
} from '../../ui/scenarios/model.js';
import { school } from '../engine/helpers.mjs';

const DAY_A = 'dsample00a';

function open(levers, changes) {
  const project = school();
  project.scenario = { name: 'Levers', changes: changes || [], compared: null, levers };
  return project;
}

const bellLeverOf = (start, end) => ({ kind: 'bell', dayTypeId: DAY_A, period: 2, start, end });
const capacity = { kind: 'capacity', roomId: 'rsample204', capacity: 12 };
const headCount = { kind: 'headCount', groupId: 'gsample07a', headCount: 31 };
const grade7 = { kind: 'release', who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null };
const closed = { kind: 'way', connectionId: 'csample00b', way: 'closed' };
const oneWay = { kind: 'way', connectionId: 'csample00a', way: 'ab' };

test('SV2-92 chips: a lever is a chip with its own index and the engine\'s sentence; a closure is marked a trial only', () => {
  const project = open([bellLeverOf('09:46', '10:32'), capacity, closed]);
  const view = scenarioView(project);
  assert.deepEqual(view.levers.map((each) => [each.index, each.lever.kind, each.trial]), [[0, 'bell', false], [1, 'capacity', false], [2, 'way', true]]);
  assert.equal(view.levers[0].words.text, 'A Day, Period 3: 9:46 AM to 10:32 AM (was 9:44 AM to 10:32 AM)');
  assert.equal(view.levers[1].words.text, 'Room 204 seats 12 (was 30)'.replace('30', String(school().building.floors.flatMap((f) => f.spaces).find((s) => s.id === 'rsample204').capacity)));
  assert.equal(view.total, 3);
  assert.equal(view.kept.length, 0, 'the changes list is the changes only');
});

test('SV2-92 chips: a lever a later one replaces keeps the later one\'s index, and a lever that no longer applies is listed as dropped with its index', () => {
  const project = open([{ ...capacity, capacity: 10 }, headCount, capacity]);
  const view = scenarioView(project);
  assert.deepEqual(view.levers.map((each) => each.index), [1, 2], 'the earlier capacity for the room is replaced');
  assert.equal(view.droppedLevers.length, 1);
  assert.equal(view.droppedLevers[0].index, 0);
  assert.match(view.droppedLevers[0].sentence, /a later lever of the same kind for the same thing replaces it\.$/);
  const gone = open([{ kind: 'capacity', roomId: 'rnowhere', capacity: 9 }]);
  assert.equal(scenarioView(gone).droppedLevers.length, 1);
  assert.equal(scenarioView(gone).total, 0);
  assert.equal(scenarioView(gone).droppedTotal, 1);
});

test('SV2-92 chips: a trial staggered dismissal that replaces a real one says what it replaces', () => {
  const project = open([{ ...grade7, seconds: 180 }]);
  project.release = [{ id: 'lreal', who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null }];
  assert.equal(insteadOf(project, project.scenario.levers[0]), '2 min');
  assert.equal(scenarioView(project).levers[0].instead, '2 min');
  assert.equal(insteadOf(project, { ...grade7, who: { grade: '8' } }), null, 'another grade replaces nothing');
  assert.equal(insteadOf(project, { ...grade7, after: [1] }), null, 'other periods replace nothing');
  assert.equal(insteadOf(project, capacity), null);
  project.release = [{ id: 'lreal', who: { groups: ['gsample07a'] }, seconds: 0, after: null, dayTypeIds: null }];
  assert.equal(insteadOf(project, { kind: 'release', who: { groups: ['gsample07a'] }, seconds: 60, after: null, dayTypeIds: null }), 'on the bell');
});

test('SV2-92 words: the first line and the bar count changes and levers together, and the skipped ones of both', () => {
  const project = open([capacity, { kind: 'capacity', roomId: 'rnowhere', capacity: 9 }], [{ kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' }]);
  const view = scenarioView(project);
  assert.equal(barWords(view), 'Not applied yet: 2 changes, 1 skipped');
  assert.equal(firstLine(project, view).map((part) => part.text).join(''), 'Trying Levers: 2 changes, not applied; 1 change no longer applies. The real schedule is untouched until you apply.');
});

test('SV2-92 Apply: a line per kind, the closures left out in a band of their own, and the button says "n of m"', () => {
  const project = open([bellLeverOf('09:46', '10:32'), grade7, capacity, headCount, oneWay, closed, { kind: 'corridor', floorId: project0Floor(), cells: corridorCells(), name: 'North Corridor' }],
    [{ kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: 1, roomId: 'rsample204' }]);
  const summary = applySummary(project, scenarioView(project));
  assert.equal(summary.writes, 6, 'one change, a bell, a staggered dismissal, a capacity, a head count and a way that is written');
  assert.equal(summary.total, 8, 'the closed stairs and the closed corridor are counted but not written');
  assert.deepEqual(summary.kinds, ['Bell times: 1 change.', 'Staggered dismissal: 1 rule.', 'Room capacities: 1 change.', 'Head counts: 1 change.', 'Stairs A becomes up only.']);
  assert.match(summary.trial.text, /^Closing Stairs B and North Corridor is a trial: Apply leaves the building as it is\.$/);
  assert.equal(applyButtonWords(summary), 'Apply 6 of 8 changes');
});

function project0Floor() {
  return school().building.floors[0].id;
}

// two cells of the first floor that are corridor
function corridorCells() {
  const cells = school().building.floors[0].cells;
  const found = [];
  for (let i = 0; i < cells.length && found.length < 2; i += 1) if (cells[i] === '#') found.push(i);
  return found;
}

test('SV2-92 Apply: with no closure the button is "Apply n changes" as before, and with nothing it closes the scenario', () => {
  const one = open([capacity]);
  assert.equal(applyButtonWords(applySummary(one, scenarioView(one))), 'Apply 1 change');
  const two = open([capacity, headCount]);
  assert.equal(applyButtonWords(applySummary(two, scenarioView(two))), 'Apply 2 changes');
  const none = open([]);
  assert.equal(applyButtonWords(applySummary(none, scenarioView(none))), 'Close the scenario: no change of it applies');
  assert.equal(applySummary(none, scenarioView(none)).trial, null);
  const only = open([closed]);
  assert.equal(applyButtonWords(applySummary(only, scenarioView(only))), 'Apply 0 of 1 changes');
});

test('SV2-92 Apply: a dropped lever is skipped in the summary with the changes that were dropped', () => {
  const project = open([{ kind: 'headCount', groupId: 'gnowhere', headCount: 9 }]);
  const summary = applySummary(project, scenarioView(project));
  assert.equal(summary.skipped.length, 1);
  assert.match(summary.skipped[0], /no longer in the project/);
});

test('SV2-92 late rows: a group held back by a trial dismissal and late is named with the delay; one held as before is not', () => {
  const project = open([grade7]);
  const notes = heldNotes(project);
  assert.deepEqual(Array.from(notes.keys()).sort(), ['gsample07a', 'gsample07b', 'gsample07c']);
  assert.equal(notes.get('gsample07a'), 'leaves 2 min after the bell');
  const mixed = open([{ ...grade7, after: [1] }, { kind: 'release', who: { groups: ['gsample07a'] }, seconds: 45, after: [3], dayTypeIds: null }]);
  assert.equal(heldNotes(mixed).get('gsample07a'), 'leaves up to 2 min after the bell');
  const real = open([grade7]);
  real.release = [{ id: 'lreal', who: { grade: '7' }, seconds: 120, after: null, dayTypeIds: null }];
  assert.equal(heldNotes(real).size, 0, 'the real schedule already holds them as long');
  assert.equal(heldNotes(school()).size, 0, 'no scenario, no note');
  const late = (held) => groupRow(open([grade7]), { groupId: 'gsample07a', edited: true, before: { total: 100, late: 0 }, after: { total: 220, late: 2 }, difference: 120, failedChange: 0 }, held);
  assert.equal(late(notes).held, 'leaves 2 min after the bell');
  assert.equal(groupRow(open([grade7]), { groupId: 'gsample07a', edited: true, before: { total: 100, late: 0 }, after: { total: 220, late: 0 }, difference: 120, failedChange: 0 }, notes).held, null, 'not late: nothing to explain');
});

test('SV2-92 Bell times: the sets are each own day type\'s bells and each bell schedule, and the lever is one or the other', () => {
  const project = school();
  project.bellSchedules = [{ id: 'bearly', name: 'Early Release', off: [], bells: project.dayTypes[0].bells.map((bell) => ({ ...bell })) }];
  assert.deepEqual(bellSets(project).map((each) => each.value), ['d:dsample00a', 'd:dsample00b', 'b:bearly']);
  assert.deepEqual(bellLever(project, { setId: 'd:dsample00a', period: 2, start: '09:46', end: '10:32' }), { lever: { kind: 'bell', dayTypeId: DAY_A, period: 2, start: '09:46', end: '10:32' } });
  assert.deepEqual(bellLever(project, { setId: 'b:bearly', period: 2, start: '09:46', end: '10:32' }), { lever: { kind: 'bell', bellsId: 'bearly', period: 2, start: '09:46', end: '10:32' } });
  assert.match(bellLever(project, { setId: 'd:dsample00a', period: 2, start: '', end: '10:32' }).why, /Enter both times/);
  assert.match(bellLever(project, { setId: 'd:dsample00a', period: 2, start: '10:40', end: '10:32' }).why, /ends after it starts/);
  assert.match(bellLever(project, { setId: 'd:gone', period: 2, start: '09:46', end: '10:32' }).why, /no day type or bell schedule/);
});

test('SV2-92 Bell times: the passing time it would make, and the Lengthen passing row keeps the end and says so', () => {
  const project = school();
  const set = bellSets(project)[0];
  assert.equal(bellPassingWords(project, set, 2, null), 'Passing before Period 3: 4 min (was 4 min)');
  assert.equal(bellPassingWords(project, set, 2, bellLeverOf('09:46', '10:32')), 'Passing before Period 3: 6 min (was 4 min)');
  assert.equal(bellPassingWords(project, set, 0, null), 'Nothing is passed into Period 1: it is the first of the day.');
  const made = lengthenPassing(project, set, 2, { start: '', end: '' }, 2);
  assert.deepEqual([made.start, made.end], ['09:46', '10:32']);
  assert.equal(made.sentence, 'Period 3 then runs 9:46 AM to 10:32 AM, was 9:44 AM to 10:32 AM');
  // from the times the form holds now, so two presses add up
  assert.equal(lengthenPassing(project, set, 2, { start: '09:46', end: '10:32' }, 5).start, '09:51');
  assert.match(lengthenPassing(project, set, 2, { start: '10:30', end: '10:32' }, 5).why, /would start after it ends/);
  assert.match(lengthenPassing(project, set, 0, { start: '08:00', end: '08:48' }, 1).why, /no passing time before Period 1/);
});

test('SV2-92 adding: a lever that is in the list now is no cancel; one that is not says how many earlier levers went with it', () => {
  assert.equal(leverCancelled({ levers: [] }, { levers: [{ ...capacity }] }, capacity), null);
  assert.deepEqual(leverCancelled({ levers: [capacity, headCount] }, { levers: [headCount] }, { ...capacity, capacity: 30 }), { taken: 1 });
  assert.deepEqual(leverCancelled({ levers: [] }, { levers: [] }, capacity), { taken: 0 });
  assert.equal(leverCancelledSentence('Room 204 seats 30 (was 30)', 0), 'That puts the schedule back as it is: Room 204 seats 30 (was 30). Nothing is added.');
  assert.equal(leverCancelledSentence('x', 2), 'That puts the schedule back as it is: x. Nothing is added, and 2 earlier changes to the same thing are taken out.');
});
