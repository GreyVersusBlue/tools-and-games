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

test('groupRows: edited groups and groups whose travel changed, the rest counted', () => {
  const compare = {
    groups: [
      { groupId: 'g1', edited: false, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 1 },
      { groupId: 'g2', edited: false, before: sideOf(100), after: sideOf(120), difference: 20, failedChange: 0 },
      { groupId: 'g3', edited: true, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 },
      { groupId: 'g4', edited: false, before: sideOf(100), after: sideOf(100), difference: 0, failedChange: 0 },
      { groupId: 'g5', edited: false, before: null, after: null, difference: null, failedChange: 0 },
    ],
  };
  const found = groupRows(project, compare);
  assert.deepEqual(found.rows.map((row) => row.groupId), ['g1', 'g2', 'g3'], 'in the comparison’s order');
  assert.equal(found.same, 2, 'a group the same, and one with no time either side, walk as before');
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
