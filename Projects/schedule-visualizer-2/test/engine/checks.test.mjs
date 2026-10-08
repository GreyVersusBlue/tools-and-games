// The schedule checks of spec 5.7, and what findings.js gives them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule } from '../../engine/checks.js';
import { SEVERITIES, KIND_SEVERITY, FIXABLE_KINDS, severityOf, findingId, makeFinding, sortFindings, splitAccepted, countBySeverity, countWord, listWords, periodWord, roomName, formatDuration } from '../../engine/findings.js';
import { CHECK_KINDS } from '../../engine/schema.js';
import { acceptFinding, unacceptFinding } from '../../engine/actions.js';
import { SAMPLE_PROBLEMS } from '../../data/sample-school.js';
import { school, clone, ctx, assertValid, room, group, teacher, PINNED } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const HALLORAN = 'tsample001'; // based in 101
const BRIGHTWATER = 'tsample002'; // based in 102
const DUNMORE = 'tsample004'; // based in the Gym
const OYELARAN = 'tsample005'; // based in 201
const CASTELLANOS = 'tsample006'; // based in 202

const DOUBLE_ID = 'room-double:dsample00a:1:rsample203';
const CAFETERIA_NOTES = ['room-no-subject:rsamplecaf', 'room-no-teacher:rsamplecaf'];

const ids = (findings) => findings.map((finding) => finding.id);
const ofKind = (result, kind) => result.findings.filter((finding) => finding.kind === kind);
const byId = (result, id) => result.findings.find((finding) => finding.id === id);

function slot(project, groupName, dayTypeId, period) {
  return group(project, groupName).days[dayTypeId][period];
}

function emptySlot() {
  return { room: null, roomText: '', label: '', teacherIds: [] };
}

// The sample school with its double-booking taken out: 7C goes to Room 201,
// which is free in Period 2 on A Days.
function clean() {
  const project = school();
  slot(project, '7C', A, 1).room = 'rsample201';
  return project;
}

// A ninth group. `a` and `b` are room numbers by period, null for no room.
function addGroup(project, name, a, b, headCount) {
  const day = (numbers) => numbers.map((number) => (number === null ? emptySlot() : { ...emptySlot(), room: room(project, number).id }));
  const added = { id: 'gtest' + String(project.groups.length).padStart(5, '0'), name, grade: '9', headCount: headCount === undefined ? 20 : headCount, colour: '#999999', days: { [A]: day(a), [B]: day(b) } };
  project.groups.push(added);
  return added;
}

const NOWHERE = [null, null, null, null, null, null, null, null];

function alsoBasedIn(project, teacherName, number) {
  const who = teacher(project, teacherName);
  const where = room(project, number);
  who.roomIds.push(where.id);
  where.teacherIds.push(who.id);
}

function withEmptyBDay(project) {
  project.dayTypes[1] = { ...project.dayTypes[1], own: false, bells: project.dayTypes[1].bells.map(() => null) };
  project.groups = project.groups.map((g) => ({ ...g, days: { [A]: g.days[A] } }));
  return project;
}

// The walk figures a later unit gets from the routes and the crowd model.
const LONG_WALK = { dayTypeId: A, groupId: 'gsample08a', period: 5, total: 275, walking: 259, waiting: 16, late: true, arrived: true };

// One project that has every kind of finding in it.
function everything() {
  const project = school();
  slot(project, '6B', A, 2).teacherIds = [HALLORAN]; // teacher-double
  room(project, '101').capacity = 20; // over-capacity
  addGroup(project, '9Z', ['101', null, null, '101', '101', '101', '101', '101'], NOWHERE); // no-planning, consecutive, empty-period
  slot(project, '6A', A, 3).teacherIds = [DUNMORE]; // a walk for the coach, Gym to Cafeteria
  Object.assign(slot(project, '7A', A, 0), { room: null, roomText: '999' }); // room-missing
  alsoBasedIn(project, 'Mr. Larkspur', 'Library'); // teacher-multi-room
  for (const g of project.groups) {
    g.days[B] = g.days[B].map((s) => (s.room === 'rsample303' || s.room === 'rsamplecaf' ? emptySlot() : s)); // teacher-room-unused, room-unused
  }
  const walks = { groups: [LONG_WALK], teachers: [{ dayTypeId: A, teacherId: DUNMORE, period: 2, walking: 250, late: true }] };
  return { project, walks };
}

// ---------------------------------------------------------------- the sample school

test('the sample school: one problem, no warning until the walk figures are in, two notes about the Cafeteria', () => {
  const result = checkSchedule(school(), null);
  assert.deepEqual(ids(result.findings), [DOUBLE_ID].concat(CAFETERIA_NOTES));
  assert.deepEqual(countBySeverity(result.findings), { problem: 1, warning: 0, note: 2 });
  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.gone, []);
  const double = result.findings[0];
  assert.deepEqual(double.where, { dayTypeId: SAMPLE_PROBLEMS.roomDouble.dayTypeId, period: SAMPLE_PROBLEMS.roomDouble.period, groupIds: SAMPLE_PROBLEMS.roomDouble.groupIds, roomId: SAMPLE_PROBLEMS.roomDouble.roomId, teacherId: null });
});

test('the sample school with the walk figures: its long walk is the one warning', () => {
  const result = checkSchedule(school(), { groups: [LONG_WALK], teachers: [] });
  assert.deepEqual(countBySeverity(result.findings), { problem: 1, warning: 1, note: 2 });
  const walk = ofKind(result, 'group-walk')[0];
  assert.equal(walk.id, 'group-walk:dsample00a:5:gsample08a');
  assert.equal(walk.text, '8A needs 4 min 35 s to get from Gym to Room 303 after Period 6 on A Day, 16 s of it waiting in crowded corridors, and the passing time is 4 min.');
  assert.deepEqual(walk.where, { dayTypeId: A, period: SAMPLE_PROBLEMS.longWalk.fromPeriod, groupIds: [SAMPLE_PROBLEMS.longWalk.groupId], roomId: SAMPLE_PROBLEMS.longWalk.toRoomId, teacherId: null });
});

test('with the double-booking taken out the sample school has no problem and no warning', () => {
  const project = clean();
  assertValid(project);
  assert.deepEqual(ids(checkSchedule(project, null).findings), CAFETERIA_NOTES);
});

// ---------------------------------------------------------------- the board's named cases

test('an empty B Day: the findings are A Day\'s, each once, and the sentence names both day types', () => {
  // first with B Day as its own copy of A Day: everything about a day is found twice
  const copied = school();
  for (const g of copied.groups) g.days[B] = clone(g.days[A]);
  const twice = checkSchedule(copied, null).findings;
  assert.deepEqual(ids(twice).filter((id) => id.includes(':' + B + ':')), ['room-double:dsample00b:1:rsample203']);
  assert.equal(twice.length, 4);

  // then with B Day empty, which means "the same as A Day"
  const result = checkSchedule(withEmptyBDay(school()), null);
  assert.deepEqual(ids(result.findings), ids(twice).filter((id) => !id.includes(':' + B + ':')), 'identical to A Day\'s');
  assert.deepEqual(ids(result.findings), [DOUBLE_ID].concat(CAFETERIA_NOTES), 'and not doubled');
  assert.equal(new Set(ids(result.findings)).size, result.findings.length);
  assert.ok(result.findings.every((finding) => finding.where.dayTypeId !== B));
  assert.equal(result.findings[0].text, 'Room 203 has two groups in Period 2 on A Day and B Day: 6C and 7C. One of them needs another room or another period.');
  // an own B Day is named alone
  assert.match(byId(checkSchedule(school(), null), DOUBLE_ID).text, / on A Day: /);
});

test('a teacher in two rooms: one problem naming the teacher, both rooms and who is in each', () => {
  const project = clean();
  // 6B is in Room 103 in Period 3; the slot names Ms. Halloran, who has 6A in 101 then
  slot(project, '6B', A, 2).teacherIds = [HALLORAN];
  assertValid(project);
  const result = checkSchedule(project, null);
  assert.deepEqual(ids(result.findings.filter((finding) => finding.severity === 'problem')), ['teacher-double:dsample00a:2:tsample001']);
  const found = result.findings[0];
  assert.equal(found.text, 'Ms. Halloran is in two rooms in Period 3 on A Day: Room 101 with 6A and Room 103 with 6B. One of those groups needs another teacher or another period.');
  assert.deepEqual(found.where, { dayTypeId: A, period: 2, groupIds: ['gsample06a', 'gsample06b'], roomId: 'rsample101', teacherId: HALLORAN });
  assert.equal(found.fixable, true);
});

test('a teacher based in two rooms with a group in each: a problem, and a note, until the slot names the other teacher', () => {
  const project = clean();
  alsoBasedIn(project, 'Ms. Halloran', '102');
  assertValid(project);
  const result = checkSchedule(project, null);
  // on A Days 101 and 102 both have a group in Period 3; on B Days in Period 2
  assert.deepEqual(ids(ofKind(result, 'teacher-double')), ['teacher-double:dsample00a:2:tsample001', 'teacher-double:dsample00b:1:tsample001']);
  assert.deepEqual(ofKind(result, 'teacher-multi-room').map((f) => [f.id, f.text, f.severity]), [['teacher-multi-room:tsample001', 'Ms. Halloran is based in two rooms: Room 101 and Room 102.', 'note']]);
  slot(project, '7B', A, 2).teacherIds = [BRIGHTWATER];
  slot(project, '6B', B, 1).teacherIds = [BRIGHTWATER];
  assert.deepEqual(ofKind(checkSchedule(project, null), 'teacher-double'), []);
});

test('two groups in a shared space: no problem, and the teacher there is not in two rooms', () => {
  const project = clean();
  // the Gym has 6C in Period 2 on B Days; 6A joins them
  slot(project, '6A', B, 1).room = 'rsamplegym';
  assert.equal(room(project, 'Gym').shared, true);
  const result = checkSchedule(project, null);
  assert.deepEqual(result.findings.filter((finding) => finding.severity !== 'note'), []);
});

test('two groups in an unshared room: one problem naming both', () => {
  const result = checkSchedule(school(), null);
  const problems = ofKind(result, 'room-double');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, DOUBLE_ID);
  assert.equal(problems[0].severity, 'problem');
  assert.equal(problems[0].fixable, true);
  assert.equal(problems[0].text, 'Room 203 has two groups in Period 2 on A Day: 6C and 7C. One of them needs another room or another period.');
  assert.deepEqual(problems[0].where.groupIds, ['gsample06c', 'gsample07c']);
  // the very room, marked as a shared space, is no problem
  const shared = school();
  room(shared, '203').shared = true;
  assert.deepEqual(ofKind(checkSchedule(shared, null), 'room-double'), []);
});

test('three groups in an unshared room are still one problem', () => {
  const project = school();
  slot(project, '8B', A, 1).room = 'rsample203';
  const problems = ofKind(checkSchedule(project, null), 'room-double');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, DOUBLE_ID);
  assert.equal(problems[0].text, 'Room 203 has three groups in Period 2 on A Day: 6C, 7C and 8B. All but one of them need another room or another period.');
});

test('co-teaching in one room: no problem', () => {
  const project = clean();
  slot(project, '6A', A, 0).teacherIds = [OYELARAN, CASTELLANOS];
  assertValid(project);
  assert.deepEqual(ids(checkSchedule(project, null).findings), CAFETERIA_NOTES);
});

test('a teacher with no planning: a warning', () => {
  const project = clean();
  // Room 101 has a group in Periods 2 and 3 on A Days; 9Z takes the other six
  addGroup(project, '9Z', ['101', null, null, '101', '101', '101', '101', '101'], NOWHERE);
  assertValid(project);
  const found = ofKind(checkSchedule(project, null), 'no-planning');
  assert.deepEqual(found.map((f) => [f.id, f.severity, f.text]), [['no-planning:dsample00a:tsample001', 'warning', 'Ms. Halloran has no planning period on A Day: there is a group in every period.']]);
  assert.deepEqual(found[0].where, { dayTypeId: A, period: null, groupIds: [], roomId: null, teacherId: HALLORAN });
  // one free period is enough
  slot(project, '9Z', A, 7).room = null;
  assert.deepEqual(ofKind(checkSchedule(project, null), 'no-planning'), []);
});

test('five in a row with the limit at 4: a warning; four in a row, or a limit of 5: none', () => {
  const project = clean();
  // Room 101 has a group in Periods 2 and 3; 9Z adds 4, 5 and 6
  addGroup(project, '9Z', [null, null, null, '101', '101', '101', null, null], NOWHERE);
  assert.equal(project.settings.checks.consecutiveLimit, 4);
  const found = ofKind(checkSchedule(project, null), 'consecutive');
  assert.deepEqual(found.map((f) => [f.id, f.severity, f.text]), [['consecutive:dsample00a:1:tsample001', 'warning', 'Ms. Halloran teaches 5 periods in a row on A Day, Period 2 to Period 6. The limit set for this school is 4.']]);
  assert.deepEqual(found[0].where, { dayTypeId: A, period: 1, groupIds: ['gsample08b'], roomId: null, teacherId: HALLORAN });

  project.settings.checks.consecutiveLimit = 5;
  assert.deepEqual(ofKind(checkSchedule(project, null), 'consecutive'), []);
  project.settings.checks.consecutiveLimit = 4;
  slot(project, '9Z', A, 5).room = null;
  assert.deepEqual(ofKind(checkSchedule(project, null), 'consecutive'), [], 'four in a row is at the limit, not over it');
  project.settings.checks.consecutiveLimit = 3;
  const four = ofKind(checkSchedule(project, null), 'consecutive').find((f) => f.id === 'consecutive:dsample00a:1:tsample001');
  assert.equal(four.text, 'Ms. Halloran teaches 4 periods in a row on A Day, Period 2 to Period 5. The limit set for this school is 3.');
});

test('capacity exceeded: a warning for each period a group is larger than its room, with the school default for a blank head count', () => {
  const project = clean();
  room(project, '101').capacity = 20;
  const found = ofKind(checkSchedule(project, null), 'over-capacity');
  assert.deepEqual(ids(found), ['over-capacity:dsample00a:1:rsample101', 'over-capacity:dsample00a:2:rsample101', 'over-capacity:dsample00b:1:rsample101', 'over-capacity:dsample00b:6:rsample101', 'over-capacity:dsample00b:7:rsample101']);
  assert.ok(found.every((f) => f.severity === 'warning'));
  assert.equal(group(project, '8B').headCount, null);
  assert.equal(found[0].text, '8B has 25 students and Room 101 seats 20, in Period 2 on A Day. The group needs a larger room.');
  assert.equal(found[1].text, '6A has 24 students and Room 101 seats 20, in Period 3 on A Day. The group needs a larger room.');
  assert.deepEqual(found[1].where, { dayTypeId: A, period: 2, groupIds: ['gsample06a'], roomId: 'rsample101', teacherId: null });
  // a group exactly the size of the room fits; a room with no capacity is never too small
  room(project, '101').capacity = 25;
  assert.deepEqual(ids(ofKind(checkSchedule(project, null), 'over-capacity')), ['over-capacity:dsample00b:6:rsample101', 'over-capacity:dsample00b:7:rsample101']);
  room(project, '101').capacity = null;
  assert.deepEqual(ofKind(checkSchedule(project, null), 'over-capacity'), []);
});

test('capacity in a shared space counts the groups there together; in a double-booked room each alone', () => {
  const project = school();
  // Room 203 seats 30 and has 6C (23) and 7C (22): a double-booking, not a capacity warning
  assert.deepEqual(ofKind(checkSchedule(project, null), 'over-capacity'), []);
  // the Library has 7A (27) in Period 3 on A Days; 6A (24) joins them, and it seats 40
  slot(project, '6A', A, 2).room = 'rsamplelib';
  room(project, 'Library').capacity = 40;
  const found = ofKind(checkSchedule(project, null), 'over-capacity');
  assert.deepEqual(ids(found), ['over-capacity:dsample00a:2:rsamplelib']);
  assert.equal(found[0].text, 'Library seats 40 and has 51 students in Period 3 on A Day: 6A (24) and 7A (27). One of them needs a larger room or another period.');
  assert.deepEqual(found[0].where.groupIds, ['gsample06a', 'gsample07a']);
  room(project, 'Library').capacity = 51;
  assert.deepEqual(ofKind(checkSchedule(project, null), 'over-capacity'), []);
});

test('a slot with roomText: a warning that the room is not in the building, and not an empty period', () => {
  const project = clean();
  Object.assign(slot(project, '6A', A, 0), { room: null, roomText: '999' });
  assertValid(project);
  const result = checkSchedule(project, null);
  assert.deepEqual(ofKind(result, 'room-missing').map((f) => [f.id, f.severity, f.fixable, f.text]), [['room-missing:dsample00a:0:gsample06a', 'warning', false, '6A is scheduled into "999" in Period 1 on A Day, and that room is not in the building. Pick a room that is in the building, or draw this one.']]);
  assert.deepEqual(ofKind(result, 'room-missing')[0].where, { dayTypeId: A, period: 0, groupIds: ['gsample06a'], roomId: null, teacherId: null });
  assert.deepEqual(ofKind(result, 'empty-period'), []);
  // a slot left holding the id of a room that has gone reads the same way
  Object.assign(slot(project, '6A', A, 0), { room: 'rnowhere00', roomText: '' });
  assert.equal(ofKind(checkSchedule(project, null), 'room-missing')[0].text, '6A is scheduled into a room in Period 1 on A Day, and that room is not in the building. Pick a room that is in the building, or draw this one.');
});

test('text with a hostile group name: every name a user typed is in the sentence exactly as typed', () => {
  const hostile = '<img src=x onerror="alert(1)"> & \'7C\' </script>';
  const project = school();
  group(project, '6C').name = hostile;
  group(project, '7C').name = '七年级 C组';
  room(project, '203').number = '<b>203</b>';
  project.dayTypes[0].name = 'A "Day" <i>';
  assertValid(project);
  const double = byId(checkSchedule(project, null), DOUBLE_ID);
  assert.equal(double.text, '<b>203</b> has two groups in Period 2 on A "Day" <i>: ' + hostile + ' and 七年级 C组. One of them needs another room or another period.');

  const withTeacher = clean();
  const who = teacher(withTeacher, 'Ms. Halloran');
  who.name = 'السيدة <script>هالوران</script>';
  slot(withTeacher, '6B', A, 2).teacherIds = [who.id];
  assert.ok(ofKind(checkSchedule(withTeacher, null), 'teacher-double')[0].text.startsWith('السيدة <script>هالوران</script> is in two rooms'));
});

// ---------------------------------------------------------------- the school's own words

test('the school\'s period word and day type names are the ones in the sentence', () => {
  const project = school();
  project.dayTypes[0].name = 'Blue';
  project.settings.periodWord = 'Block';
  assert.equal(byId(checkSchedule(project, null), DOUBLE_ID).text, 'Room 203 has two groups in Block B on Blue: 6C and 7C. One of them needs another room or another block.');
  project.settings.periodWord = 'Hour';
  assert.equal(byId(checkSchedule(project, null), DOUBLE_ID).text, 'Room 203 has two groups in 2nd Hour on Blue: 6C and 7C. One of them needs another room or another hour.');
  project.settings.periodWord = 'Mod';
  addGroup(project, '9Z', [null, null, null, '101', '101', '101', null, null], NOWHERE);
  assert.equal(ofKind(checkSchedule(project, null), 'consecutive')[0].text, 'Ms. Halloran teaches 5 mods in a row on Blue, Mod 2 to Mod 6. The limit set for this school is 4.');
});

test('severities are "problem", "warning" and "note", and no sentence says error, issue or conflict', () => {
  const { project, walks } = everything();
  const result = checkSchedule(project, walks);
  for (const finding of result.findings) {
    assert.ok(SEVERITIES.includes(finding.severity), finding.id);
    assert.doesNotMatch(finding.text, /\b(error|issue|conflict)/i, finding.text);
    assert.match(finding.text, /^[A-Z0-9].*\.$/s, finding.text);
  }
});

// ---------------------------------------------------------------- the notes

test('a group with an empty period: a note for the period; with no room all day, one note for the day', () => {
  const project = clean();
  addGroup(project, '9Z', ['301', null, null, null, null, null, null, null], NOWHERE);
  group(project, '9Z').days[A][0].room = null;
  group(project, '9Z').days[A][7] = { ...emptySlot(), room: 'rsample301' };
  slot(project, '6A', A, 4).room = null;
  const found = ofKind(checkSchedule(project, null), 'empty-period');
  assert.deepEqual(found.map((f) => [f.id, f.severity, f.text]), [
    ['empty-period:dsample00a:0:' + group(project, '9Z').id, 'note', '9Z has no room in Period 1 on A Day.'],
    ['empty-period:dsample00a:1:' + group(project, '9Z').id, 'note', '9Z has no room in Period 2 on A Day.'],
    ['empty-period:dsample00a:2:' + group(project, '9Z').id, 'note', '9Z has no room in Period 3 on A Day.'],
    ['empty-period:dsample00a:3:' + group(project, '9Z').id, 'note', '9Z has no room in Period 4 on A Day.'],
    ['empty-period:dsample00a:4:gsample06a', 'note', '6A has no room in Period 5 on A Day.'],
    ['empty-period:dsample00a:4:' + group(project, '9Z').id, 'note', '9Z has no room in Period 5 on A Day.'],
    ['empty-period:dsample00a:5:' + group(project, '9Z').id, 'note', '9Z has no room in Period 6 on A Day.'],
    ['empty-period:dsample00a:6:' + group(project, '9Z').id, 'note', '9Z has no room in Period 7 on A Day.'],
    ['empty-period:dsample00b:' + group(project, '9Z').id, 'note', '9Z has no room in any period on B Day.'],
  ]);
  assert.deepEqual(found[8].where, { dayTypeId: B, period: null, groupIds: [group(project, '9Z').id], roomId: null, teacherId: null });
  assert.equal(found[0].fixable, false);
});

test('a room with no group all day: one note, about the teacher based there when there is one', () => {
  const project = clean();
  for (const g of project.groups) g.days[B] = g.days[B].map((s) => (s.room === 'rsample303' || s.room === 'rsamplecaf' ? emptySlot() : s));
  const result = checkSchedule(project, null);
  assert.deepEqual(ofKind(result, 'teacher-room-unused').map((f) => [f.id, f.severity, f.text]), [['teacher-room-unused:dsample00b:tsample012:rsample303', 'note', 'Room 303, where Ms. O\'Fennimore is based, has no group in any period on B Day.']]);
  assert.deepEqual(ofKind(result, 'teacher-room-unused')[0].where, { dayTypeId: B, period: null, groupIds: [], roomId: 'rsample303', teacherId: 'tsample012' });
  assert.deepEqual(ofKind(result, 'room-unused').map((f) => [f.id, f.severity, f.text]), [['room-unused:dsample00b:rsamplecaf', 'note', 'Cafeteria has no group in any period on B Day.']]);
  // a room with no number cannot be scheduled, so it is the building checks' to report
  room(project, 'Cafeteria').number = '';
  const after = checkSchedule(project, null);
  assert.deepEqual(ofKind(after, 'room-unused'), []);
  assert.deepEqual(ofKind(after, 'room-no-subject'), []);
});

test('a room with no subject, and a scheduled room with no teacher: one note each a room', () => {
  const result = checkSchedule(school(), null);
  assert.deepEqual(ofKind(result, 'room-no-subject').map((f) => [f.id, f.severity, f.text, f.where.roomId]), [['room-no-subject:rsamplecaf', 'note', 'Cafeteria has no subject.', 'rsamplecaf']]);
  const noTeacher = ofKind(result, 'room-no-teacher');
  assert.deepEqual(noTeacher.map((f) => [f.id, f.severity, f.text]), [['room-no-teacher:rsamplecaf', 'note', 'Cafeteria has groups scheduled into it and no teacher, starting with 6A, 6B and 6C in Period 4 on A Day.']]);
  assert.deepEqual(noTeacher[0].where, { dayTypeId: A, period: 3, groupIds: ['gsample06a', 'gsample06b', 'gsample06c'], roomId: 'rsamplecaf', teacherId: null });

  // a subject that is no longer on the list reads as no subject
  const project = school();
  room(project, '101').subjectId = 'snothing00';
  assert.deepEqual(ids(ofKind(checkSchedule(project, null), 'room-no-subject')), ['room-no-subject:rsample101', 'room-no-subject:rsamplecaf']);

  // naming a teacher on every lunch slot clears the teacher note; one slot left out keeps it
  const named = school();
  for (const g of named.groups) for (const d of [A, B]) for (const s of g.days[d]) if (s.room === 'rsamplecaf') s.teacherIds = [DUNMORE];
  assert.deepEqual(ofKind(checkSchedule(named, null), 'room-no-teacher'), []);
  slot(named, '7B', B, 4).teacherIds = [];
  assert.equal(ofKind(checkSchedule(named, null), 'room-no-teacher')[0].text, 'Cafeteria has groups scheduled into it and no teacher, starting with 7B in Period 5 on B Day.');
});

// ---------------------------------------------------------------- the two walk-time checks

test('the walk-time checks say nothing until they are handed figures', () => {
  const { project } = everything();
  for (const nothing of [null, undefined, {}, { groups: [], teachers: [] }]) {
    const result = checkSchedule(project, nothing);
    assert.deepEqual(ofKind(result, 'group-walk'), []);
    assert.deepEqual(ofKind(result, 'teacher-walk'), []);
  }
});

test('a group\'s walk: only a figure marked late is a finding, and the check does no arithmetic of its own', () => {
  const project = clean();
  const onTime = { ...LONG_WALK, total: 9999, late: false };
  assert.deepEqual(ofKind(checkSchedule(project, { groups: [onTime], teachers: [] }), 'group-walk'), []);
  const quick = { ...LONG_WALK, total: 10, walking: 10, waiting: 0, late: true };
  assert.equal(ofKind(checkSchedule(project, { groups: [quick], teachers: [] }), 'group-walk')[0].text, '8A needs 10 s to get from Gym to Room 303 after Period 6 on A Day, and the passing time is 4 min.');
});

test('a group that did not arrive says so, and the margin is in the sentence when the school has one', () => {
  const project = clean();
  project.settings.checks.passingMarginSeconds = 30;
  const stopped = { ...LONG_WALK, total: 720, waiting: 461, arrived: false };
  const found = ofKind(checkSchedule(project, { groups: [stopped, LONG_WALK], teachers: [] }), 'group-walk');
  assert.equal(found.length, 1, 'two figures for one walk are one finding');
  assert.equal(found[0].text, '8A did not arrive at Room 303 from Gym after Period 6 on A Day: it was still on the way after 12 min, and the passing time is 4 min plus a margin of 30 s.');
  assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].fixable, true);
});

test('the passing time in the sentence is the one from the bells', () => {
  const project = clean();
  project.dayTypes[0].bells[6] = { start: '13:11', end: '14:00' };
  assert.match(ofKind(checkSchedule(project, { groups: [LONG_WALK], teachers: [] }), 'group-walk')[0].text, /the passing time is 3 min\.$/);
});

test('a teacher\'s walk: a warning naming both rooms, from the teacher\'s own day', () => {
  const project = clean();
  // the coach has 7C in the Gym in Period 3, and is named on 6A's lunch in Period 4
  slot(project, '6A', A, 3).teacherIds = [DUNMORE];
  const walks = { groups: [], teachers: [{ dayTypeId: A, teacherId: DUNMORE, period: 2, walking: 250, late: true }] };
  const found = ofKind(checkSchedule(project, walks), 'teacher-walk');
  assert.deepEqual(found.map((f) => [f.id, f.severity, f.fixable, f.text]), [['teacher-walk:dsample00a:2:tsample004', 'warning', true, 'Coach Dunmore needs 4 min 10 s to walk from Gym to Cafeteria after Period 3 on A Day, before any crowding, and the passing time is 4 min.']]);
  assert.deepEqual(found[0].where, { dayTypeId: A, period: 2, groupIds: ['gsample06a'], roomId: 'rsamplecaf', teacherId: DUNMORE });
  walks.teachers[0].late = false;
  assert.deepEqual(ofKind(checkSchedule(project, walks), 'teacher-walk'), []);
});

test('figures that are out of date are passed over', () => {
  const project = clean();
  const stale = {
    groups: [
      { ...LONG_WALK, groupId: 'gnobody000' },
      { ...LONG_WALK, dayTypeId: 'dnowhere00' },
      { ...LONG_WALK, period: 7 },
      { ...LONG_WALK, period: -1 },
      { ...LONG_WALK, period: 1.5 },
      { ...LONG_WALK, total: Number.NaN },
      null,
    ],
    teachers: [
      { dayTypeId: A, teacherId: 'tnobody000', period: 2, walking: 250, late: true },
      { dayTypeId: A, teacherId: DUNMORE, period: 4, walking: 250, late: true }, // the coach stays in the Gym then
      { dayTypeId: A, teacherId: HALLORAN, period: 5, walking: 250, late: true }, // planning on both sides
    ],
  };
  assert.deepEqual(ids(checkSchedule(project, stale).findings), CAFETERIA_NOTES);
  // a group that stays in one room, or has no room to walk to, has no walk
  slot(project, '8A', A, 6).room = 'rsamplegym';
  assert.deepEqual(ofKind(checkSchedule(project, { groups: [LONG_WALK] }), 'group-walk'), []);
  slot(project, '8A', A, 6).room = null;
  assert.deepEqual(ofKind(checkSchedule(project, { groups: [LONG_WALK] }), 'group-walk'), []);
  // figures for a day type that is the same as A Day are passed over: A Day's cover it
  const followed = withEmptyBDay(school());
  assert.deepEqual(ids(ofKind(checkSchedule(followed, { groups: [{ ...LONG_WALK, dayTypeId: B }, LONG_WALK] }), 'group-walk')), ['group-walk:dsample00a:5:gsample08a']);
});

// ---------------------------------------------------------------- settings and acceptance

test('a check that is switched off reports nothing, and the others carry on', () => {
  const { project, walks } = everything();
  const all = checkSchedule(project, walks).findings;
  project.settings.checks.off = ['room-double', 'room-no-subject'];
  assertValid(project);
  const some = checkSchedule(project, walks).findings;
  assert.deepEqual(ids(some), ids(all).filter((id) => !id.startsWith('room-double:') && !id.startsWith('room-no-subject:')));
  assert.ok(some.length < all.length);
  project.settings.checks.off = CHECK_KINDS.slice();
  assert.deepEqual(checkSchedule(project, walks), { findings: [], accepted: [], gone: [] });
});

test('one project can hold every kind of finding, and each kind is the severity spec 5.7 gives it', () => {
  const { project, walks } = everything();
  const result = checkSchedule(project, walks);
  const kinds = new Set(result.findings.map((finding) => finding.kind));
  assert.deepEqual(CHECK_KINDS.filter((kind) => !kinds.has(kind)), []);
  const expected = {
    'room-double': 'problem', 'teacher-double': 'problem',
    'over-capacity': 'warning', 'no-planning': 'warning', 'consecutive': 'warning', 'teacher-walk': 'warning', 'group-walk': 'warning', 'room-missing': 'warning',
    'empty-period': 'note', 'teacher-multi-room': 'note', 'teacher-room-unused': 'note', 'room-unused': 'note', 'room-no-subject': 'note', 'room-no-teacher': 'note',
  };
  assert.deepEqual(Object.keys(expected), CHECK_KINDS, 'the kinds, in the order of the table');
  assert.deepEqual(KIND_SEVERITY, expected);
  for (const finding of result.findings) {
    assert.equal(finding.severity, expected[finding.kind], finding.id);
    assert.equal(finding.fixable, FIXABLE_KINDS.includes(finding.kind), finding.id);
    assert.ok(finding.id.startsWith(finding.kind + ':'), finding.id);
    assert.deepEqual(Object.keys(finding), ['id', 'kind', 'severity', 'text', 'where', 'fixable']);
    assert.deepEqual(Object.keys(finding.where), ['dayTypeId', 'period', 'groupIds', 'roomId', 'teacherId']);
    assert.ok(Array.isArray(finding.where.groupIds));
  }
  assert.equal(new Set(ids(result.findings)).size, result.findings.length, 'no id twice');
});

test('findings are listed problems first, then warnings, then notes, in the order of the table', () => {
  const { project, walks } = everything();
  const result = checkSchedule(project, walks);
  const rank = result.findings.map((finding) => SEVERITIES.indexOf(finding.severity) * 100 + CHECK_KINDS.indexOf(finding.kind));
  assert.deepEqual(rank, rank.slice().sort((a, b) => a - b));
  assert.equal(result.findings[0].severity, 'problem');
  assert.equal(result.findings[result.findings.length - 1].severity, 'note');
});

test('an accepted finding is returned apart, with its reason, and leaves the counts', () => {
  const store = { project: school() };
  store.project = acceptFinding(store.project, { findingId: DOUBLE_ID, reason: 'Two half groups, one teacher' }, ctx());
  assertValid(store.project);
  const result = checkSchedule(store.project, null);
  assert.deepEqual(ids(result.findings), CAFETERIA_NOTES);
  assert.deepEqual(countBySeverity(result.findings), { problem: 0, warning: 0, note: 2 });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].id, DOUBLE_ID);
  assert.equal(result.accepted[0].text, 'Room 203 has two groups in Period 2 on A Day: 6C and 7C. One of them needs another room or another period.');
  assert.deepEqual(result.accepted[0].accepted, { reason: 'Two half groups, one teacher', at: PINNED });
  assert.deepEqual(result.gone, []);

  store.project = unacceptFinding(store.project, { findingId: DOUBLE_ID }, ctx());
  const back = checkSchedule(store.project, null);
  assert.deepEqual(ids(back.findings), [DOUBLE_ID].concat(CAFETERIA_NOTES));
  assert.deepEqual(back.accepted, []);
});

test('an accepted finding stays accepted through renames and reordering, and is listed as gone once it is put right', () => {
  let project = acceptFinding(school(), { findingId: DOUBLE_ID, reason: 'Known' }, ctx());
  project = clone(project);
  group(project, '6C').name = 'Sixth C';
  room(project, '203').number = '2-03';
  project.dayTypes[0].name = 'Blue';
  project.groups.reverse();
  const result = checkSchedule(project, null);
  assert.deepEqual(ids(result.accepted), [DOUBLE_ID]);
  assert.equal(result.accepted[0].text, 'Room 2-03 has two groups in Period 2 on Blue: 7C and Sixth C. One of them needs another room or another period.');

  slot(project, '7C', A, 1).room = 'rsample201';
  const after = checkSchedule(project, null);
  assert.deepEqual(after.accepted, []);
  assert.deepEqual(after.gone, [{ findingId: DOUBLE_ID, reason: 'Known', at: PINNED }]);
  assert.equal(project.accepted.length, 1, 'the record is still in the project');
});

test('ids and order do not depend on the order groups, teachers, rooms and subjects are stored in', () => {
  const { project, walks } = everything();
  const before = checkSchedule(project, walks).findings;
  const shuffled = clone(project);
  shuffled.groups.reverse();
  shuffled.teachers.reverse();
  shuffled.subjects.reverse();
  shuffled.building.floors.reverse();
  for (const floor of shuffled.building.floors) floor.spaces.reverse();
  walks.groups.reverse();
  const after = checkSchedule(shuffled, walks).findings;
  assert.deepEqual(ids(after), ids(before));
  assert.deepEqual(after.map((f) => [f.where.dayTypeId, f.where.period, f.where.roomId, f.where.teacherId]), before.map((f) => [f.where.dayTypeId, f.where.period, f.where.roomId, f.where.teacherId]));
});

test('checkSchedule does not change the project, and gives the same answer twice', () => {
  const { project, walks } = everything();
  const before = clone(project);
  const first = checkSchedule(project, walks);
  const second = checkSchedule(project, walks);
  assert.deepEqual(project, before);
  assert.deepEqual(second, first);
});

// ---------------------------------------------------------------- findings.js

test('findingId joins the kind and the ids in the order given', () => {
  assert.equal(findingId('room-double', 'dabc', 3, 'rxyz'), 'room-double:dabc:3:rxyz');
  assert.equal(findingId('teacher-multi-room', 'tabc'), 'teacher-multi-room:tabc');
  assert.equal(severityOf('room-double'), 'problem');
  assert.equal(severityOf('nothing'), null);
});

test('makeFinding fills every key of where', () => {
  assert.deepEqual(makeFinding('room-unused', ['dabc', 'rxyz'], 'Room 9 has no group.', { dayTypeId: 'dabc', roomId: 'rxyz' }), {
    id: 'room-unused:dabc:rxyz', kind: 'room-unused', severity: 'note', text: 'Room 9 has no group.',
    where: { dayTypeId: 'dabc', period: null, groupIds: [], roomId: 'rxyz', teacherId: null }, fixable: false,
  });
});

test('sortFindings: severity, then kind, then day type, then period, then id', () => {
  const project = school();
  const make = (kind, parts, where) => makeFinding(kind, parts, 'x.', where);
  const sorted = [
    make('room-no-subject', ['rb'], { roomId: 'rb' }),
    make('room-double', [B, 0, 'ra'], { dayTypeId: B, period: 0 }),
    make('over-capacity', [A, 0, 'ra'], { dayTypeId: A, period: 0 }),
    make('room-double', [A, 5, 'ra'], { dayTypeId: A, period: 5 }),
    make('room-double', [A, 2, 'rb'], { dayTypeId: A, period: 2 }),
    make('room-double', [A, 2, 'ra'], { dayTypeId: A, period: 2 }),
    make('teacher-double', [A, 0, 'ta'], { dayTypeId: A, period: 0 }),
    make('room-no-subject', ['ra'], { roomId: 'ra' }),
  ];
  assert.deepEqual(ids(sortFindings(sorted, project)), [
    'room-double:dsample00a:2:ra', 'room-double:dsample00a:2:rb', 'room-double:dsample00a:5:ra', 'room-double:dsample00b:0:ra',
    'teacher-double:dsample00a:0:ta', 'over-capacity:dsample00a:0:ra', 'room-no-subject:ra', 'room-no-subject:rb',
  ]);
  assert.equal(sorted[0].id, 'room-no-subject:rb', 'the list handed in is left as it was');
});

test('splitAccepted and countBySeverity', () => {
  const findings = [makeFinding('room-double', ['d', 0, 'r'], 'x.'), makeFinding('room-unused', ['d', 'r'], 'x.'), makeFinding('consecutive', ['d', 0, 't'], 'x.')];
  const split = splitAccepted(findings, [{ findingId: 'room-unused:d:r', reason: 'Store room', at: PINNED }, { findingId: 'no-planning:d:t', reason: 'Part time', at: PINNED }]);
  assert.deepEqual(ids(split.findings), ['room-double:d:0:r', 'consecutive:d:0:t']);
  assert.deepEqual(split.accepted.map((f) => [f.id, f.accepted.reason]), [['room-unused:d:r', 'Store room']]);
  assert.deepEqual(split.gone, [{ findingId: 'no-planning:d:t', reason: 'Part time', at: PINNED }]);
  assert.deepEqual(countBySeverity(findings), { problem: 1, warning: 1, note: 1 });
  assert.deepEqual(countBySeverity([]), { problem: 0, warning: 0, note: 0 });
  assert.deepEqual(splitAccepted(findings, undefined).findings, findings);
});

test('the words: counts, lists, the period word, room names and lengths of time', () => {
  assert.deepEqual([2, 3, 10, 11].map(countWord), ['two', 'three', 'ten', '11']);
  assert.deepEqual([[], ['a'], ['a', 'b'], ['a', 'b', 'c']].map(listWords), ['', 'a', 'a and b', 'a, b and c']);
  assert.equal(periodWord({ periodWord: 'Block' }, false), 'block');
  assert.equal(periodWord({ periodWord: 'Hour' }, true), 'hours');
  assert.equal(roomName({ number: '204' }, true), 'Room 204');
  assert.equal(roomName({ number: 'B12' }, false), 'Room B12');
  assert.equal(roomName({ number: 'Gym' }, true), 'Gym');
  assert.equal(roomName({ number: ' <i>Lab</i> ' }, false), ' <i>Lab</i> ');
  assert.equal(roomName({ number: '' }, true), 'A room with no number');
  assert.equal(roomName({ number: '  ' }, false), 'a room with no number');
  assert.deepEqual([0, 45, 60, 240, 275, 720, 259.6].map(formatDuration), ['0 s', '45 s', '1 min', '4 min', '4 min 35 s', '12 min', '4 min 20 s']);
});
