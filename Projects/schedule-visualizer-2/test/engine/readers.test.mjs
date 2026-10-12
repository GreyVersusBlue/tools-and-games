// What readers will see of the problems still in the schedule
// (ui/staff/readers.js), in plain Node:
//   node test/engine/readers.test.mjs
//
// readerSentences is driven with the engine's own findings (checkSchedule and
// buildingChecks on the sample school and on changes to it) and with findings
// made by hand, so each sentence is read against the finding it is for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { readerSentences, readerSummary, READER_KINDS, NO_SENTENCE, NOTHING_REMAINS } from '../../ui/staff/readers.js';
import { checkSchedule } from '../../engine/checks.js';
import { buildingChecks } from '../../engine/building-checks.js';
import { KIND_SEVERITY, makeFinding } from '../../engine/findings.js';
import { school, room, group } from './helpers.mjs';

const DAY = (project) => project.dayTypes[0].id;

// What the engine client answers with, worked out here on the main thread.
function resultsOf(project) {
  return { findings: checkSchedule(project, null), buildingFindings: buildingChecks(project) };
}

function sentences(project) {
  return readerSentences(project, resultsOf(project));
}

const texts = (read) => read.lines.map((line) => line.text);

// Put a group into a room for one period of the first day type.
function place(project, groupName, period, roomId, roomText) {
  group(project, groupName).days[DAY(project)][period] = { room: roomId, roomText: roomText || '', label: '', teacherIds: [] };
}

test('the sample school: one sentence, for the room with two groups, and nothing accepted or switched off', () => {
  const read = sentences(school());
  assert.deepEqual(texts(read), ['Room 203 has two groups in Period 2 on A Day: both will be shown.']);
  assert.deepEqual(read.lines.map((line) => [line.id, line.kind]), [['room-double:dsample00a:1:rsample203', 'room-double']]);
  assert.equal(read.accepted, 0);
  assert.equal(read.off, 0);
});

test('three groups in one room: "all three will be shown"', () => {
  const project = school();
  place(project, '8A', 1, room(project, '203').id);
  assert.deepEqual(texts(sentences(project)).filter((text) => text.startsWith('Room 203')), ['Room 203 has three groups in Period 2 on A Day: all three will be shown.']);
});

test('a teacher in two places in one period: every room will be shown', () => {
  const project = school();
  const teacher = project.teachers[0];
  const finding = makeFinding('teacher-double', [DAY(project), 2, teacher.id], teacher.name + ' is in two rooms. Move one.', { dayTypeId: DAY(project), period: 2, teacherId: teacher.id });
  const read = readerSentences(project, { findings: { findings: [finding], accepted: [] }, buildingFindings: [] });
  assert.deepEqual(texts(read), [teacher.name + ' is in more than one room in Period 3 on A Day: every room will be shown.']);
  // and from the engine itself: the same teacher named on two groups' slots in two rooms
  const made = school();
  const one = room(made, '101');
  const two = room(made, '102');
  place(made, '6A', 6, one.id);
  place(made, '6B', 6, two.id);
  group(made, '6A').days[DAY(made)][6].teacherIds = [teacher.id];
  group(made, '6B').days[DAY(made)][6].teacherIds = [teacher.id];
  const engine = sentences(made);
  assert.ok(texts(engine).includes(teacher.name + ' is in more than one room in Period 7 on A Day: every room will be shown.'), texts(engine).join(' | '));
});

test('a room that is not in the building: shown as typed, marked', () => {
  const project = school();
  place(project, '6A', 0, null, 'Annex 9');
  const read = sentences(project);
  assert.ok(texts(read).includes('6A has a room that is not in the building in Period 1 on A Day: it will be shown as typed, marked "not in the building".'), texts(read).join(' | '));
  assert.equal(read.lines.find((line) => line.kind === 'room-missing').id, 'room-missing:dsample00a:0:' + group(project, '6A').id);
});

test('a teacher based in two rooms, or three: the rooms are shown on the teacher\'s page', () => {
  const project = school();
  const teacher = project.teachers[0];
  teacher.roomIds = [room(project, '101').id, room(project, '102').id];
  const two = sentences(project);
  assert.ok(texts(two).includes(teacher.name + ' is based in two rooms: both are shown on the teacher\'s page.'), texts(two).join(' | '));
  assert.equal(two.lines.find((line) => line.kind === 'teacher-multi-room').id, 'teacher-multi-room:' + teacher.id);
  teacher.roomIds.push(room(project, '103').id);
  assert.ok(texts(sentences(project)).includes(teacher.name + ' is based in three rooms: all three are shown on the teacher\'s page.'));
});

test('a problem in the building: the engine\'s sentence, and that the map follows the building as drawn', () => {
  const project = school();
  const finding = makeFindingLike('room-no-corridor', 'problem', 'Room 105 does not open onto a corridor.');
  const read = readerSentences(project, { findings: checkSchedule(project, null), buildingFindings: [finding, makeFindingLike('room-no-number', 'warning', 'One room has no number.')] });
  assert.deepEqual(texts(read), [
    'Room 203 has two groups in Period 2 on A Day: both will be shown.',
    'Room 105 does not open onto a corridor. The map and the directions follow the building as it is drawn.',
  ], 'the schedule first, then the building; a building warning is not a line');
});

function makeFindingLike(kind, severity, text) {
  return { id: kind + ':x', kind, severity, text, where: { dayTypeId: null, period: null, groupIds: [], roomId: null, teacherId: null }, fixable: false, about: [] };
}

test('a finding that names a room, a teacher or a group the project no longer has says nothing', () => {
  const project = school();
  const day = DAY(project);
  const gone = [
    makeFinding('room-double', [day, 1, 'rgone000001'], 'x', { dayTypeId: day, period: 1, roomId: 'rgone000001', groupIds: [project.groups[0].id, project.groups[1].id] }),
    makeFinding('teacher-double', [day, 1, 'tgone000001'], 'x', { dayTypeId: day, period: 1, teacherId: 'tgone000001' }),
    makeFinding('room-missing', [day, 1, 'ggone000001'], 'x', { dayTypeId: day, period: 1, groupIds: ['ggone000001'] }),
    makeFinding('teacher-multi-room', ['tgone000001'], 'x', { teacherId: 'tgone000001' }),
  ];
  assert.deepEqual(readerSentences(project, { findings: { findings: gone, accepted: [] }, buildingFindings: [] }).lines, []);
});

test('a check that is switched off was not looked at: its problem is not a line, and the count says so', () => {
  const project = school();
  project.settings.checks.off = ['room-double'];
  const read = sentences(project);
  assert.deepEqual(texts(read), [], 'the room with two groups was not looked for');
  assert.equal(read.off, 1);
  // a check whose findings readers never see is not counted, nor is a name that is no check
  project.settings.checks.off = ['room-double', 'over-capacity', 'teacher-double', 'not-a-check', 'teacher-double'];
  assert.equal(sentences(project).off, 2);
});

test('accepted problems are counted apart, and only the ones a reader meets', () => {
  const project = school();
  project.accepted = [{ findingId: 'room-double:dsample00a:1:rsample203', reason: 'Team taught', at: '2026-09-01T12:00:00.000Z', about: [group(project, '6C').id, group(project, '7C').id].sort() }];
  const read = sentences(project);
  assert.deepEqual(texts(read), []);
  assert.equal(read.accepted, 1);
  // an accepted note nobody reading the file would see is not counted
  const note = makeFinding('room-no-subject', ['r1'], 'x', { roomId: 'r1' });
  const multi = makeFinding('teacher-multi-room', [project.teachers[0].id], 'x', { teacherId: project.teachers[0].id });
  assert.equal(readerSentences(project, { findings: { findings: [], accepted: [note, multi] }, buildingFindings: [] }).accepted, 1);
});

test('every kind the checks call a problem has a sentence of its own', () => {
  const problems = Object.keys(KIND_SEVERITY).filter((kind) => KIND_SEVERITY[kind] === 'problem');
  assert.ok(problems.length >= 2);
  for (const kind of problems) assert.ok(READER_KINDS.includes(kind), kind + ' is a problem with no sentence for readers in ui/staff/readers.js');
  for (const kind of READER_KINDS) assert.ok(kind in KIND_SEVERITY, kind + ' has a sentence and is not a kind the checks make');
});

test('a problem of a kind with no sentence is never the planner\'s own advice', () => {
  const project = school();
  const advice = 'Two things overlap. Move one of them to another period.';
  const finding = { ...makeFinding('room-double', ['x'], advice, {}), kind: 'made-up-kind', id: 'made-up-kind:x' };
  const read = readerSentences(project, { findings: { findings: [finding], accepted: [] }, buildingFindings: [] });
  assert.deepEqual(read.lines, [{ id: 'made-up-kind:x', kind: 'made-up-kind', text: NO_SENTENCE }]);
  assert.ok(!NO_SENTENCE.includes('Move'));
});

test('the summary: nothing left, what was accepted, what was switched off', () => {
  assert.equal(readerSummary({ lines: [], accepted: 0, off: 0 }), NOTHING_REMAINS);
  assert.equal(readerSummary({ lines: [{}], accepted: 0, off: 0 }), '');
  assert.equal(readerSummary({ lines: [], accepted: 1, off: 0 }), NOTHING_REMAINS + ' One problem you accepted is published as it is.');
  assert.equal(readerSummary({ lines: [{}], accepted: 1, off: 0 }), 'One problem you accepted is published as it is too.');
  assert.equal(readerSummary({ lines: [{}], accepted: 3, off: 0 }), '3 problems you accepted are published as they are too.');
  assert.equal(readerSummary({ lines: [], accepted: 0, off: 1 }), NOTHING_REMAINS + ' One check is switched off and was not looked at.');
  assert.equal(readerSummary({ lines: [{}], accepted: 2, off: 2 }), '2 problems you accepted are published as they are too. 2 checks are switched off and were not looked at.');
  // straight from a project
  const project = school();
  project.settings.checks.off = ['room-double'];
  assert.equal(readerSummary(sentences(project)), 'The checks found no problem that readers will see. One check is switched off and was not looked at.');
});

test('with no results yet there is nothing to say, and nothing throws', () => {
  assert.deepEqual(readerSentences(school(), null), { lines: [], accepted: 0, off: 0 });
  assert.deepEqual(readerSentences(school(), {}), { lines: [], accepted: 0, off: 0 });
});
