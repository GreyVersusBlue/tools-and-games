// The checks with marks and duties (ARCHITECTURE 17.5, 17.6): duty-clash and
// duty-nobody, no-planning and consecutive when a duty or a mark takes a
// period, the empty-period note under a mark, and a project with neither
// keeping every finding it had. Dates are plain strings; no clock is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchedule, teachingRunEnd } from '../../engine/checks.js';
import { CHECK_KINDS } from '../../engine/schema.js';
import { KIND_SEVERITY, FIXABLE_KINDS } from '../../engine/findings.js';
import { teacherDay, isFree } from '../../engine/teacher-day.js';
import { school, group, assertValid } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const C = 'dsample00c';
const HALLORAN = 'tsample001'; // A Day: free | 8B | 6A | free x5
const BRIGHTWATER = 'tsample002'; // MATH; A Day: 8A | free | 7B | 7A | free | free | 6B | 7C
const PENNYWHISTLE = 'tsample009'; // A Day: free | free | 7A | 7B | free | 7C | 6C | 6B
const VANDERMEER = 'tsample007'; // A Day: 6B | 6C and 7C | 8A | 8B | free | free | 7A | 6A
const MATH = 'ssample001';

let counter = 0;
const mark = (extra) => ({ id: 'm' + String(counter += 1).padStart(9, '0'), kind: 'lunch', label: '', period: 3, dayTypeIds: [], scope: 'school', grades: [], groupIds: [], ...extra });
const duty = (extra) => ({ id: 'u' + String(counter += 1).padStart(9, '0'), kind: 'duty', label: '', when: 'before', period: 0, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [], subjectIds: [], everyone: false, ...extra });

const ids = (result) => result.findings.map((finding) => finding.id);
const ofKind = (result, kind) => result.findings.filter((finding) => finding.kind === kind);

function withLists(marks, duties) {
  const project = school();
  if (marks) project.marks = marks;
  if (duties) project.duties = duties;
  return project;
}

function withFollower(project) {
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
  return project;
}

function emptySlot() {
  return { room: null, roomText: '', label: '', teacherIds: [] };
}

// ---------------------------------------------------------------- no marks, no duties

test('a project with no marks and no duties keeps every finding it had, byte for byte', () => {
  const plain = checkSchedule(school(), null);
  assert.deepEqual(ids(plain), ['room-double:dsample00a:1:rsample203', 'room-no-subject:rsamplecaf', 'room-no-teacher:rsamplecaf']);
  const empty = withLists([], []);
  assertValid(empty);
  assert.deepEqual(checkSchedule(empty, null), plain);
  const junk = school();
  junk.marks = 'marks';
  junk.duties = [null, 5, { kind: 'duty' }];
  assert.deepEqual(checkSchedule(junk, null), plain, 'a malformed list reads as none: the staff browser never runs repair');
});

test('a project with no marks and no duties keeps the text of no-planning and consecutive', () => {
  const project = school();
  project.groups.push({ id: 'gtest00001', name: '9Z', grade: '9', headCount: 20, colour: '#999999', days: { [A]: school().groups[0].days[A].map((s) => ({ ...s, room: 'rsample101' })), [B]: school().groups[0].days[B] } });
  const result = checkSchedule(project, null);
  assert.equal(ofKind(result, 'no-planning').length, 1);
  assert.equal(ofKind(result, 'no-planning')[0].text, 'Ms. Halloran has no planning period on A Day: there is a group in every period.');
});

test('the two new kinds are in the table, with their severity, and neither is fixable', () => {
  assert.equal(CHECK_KINDS.includes('duty-clash'), true);
  assert.equal(CHECK_KINDS.includes('duty-nobody'), true);
  assert.equal(KIND_SEVERITY['duty-clash'], 'warning');
  assert.equal(KIND_SEVERITY['duty-nobody'], 'note');
  assert.equal(FIXABLE_KINDS.includes('duty-clash'), false);
  assert.equal(FIXABLE_KINDS.includes('duty-nobody'), false);
  assert.ok(CHECK_KINDS.indexOf('duty-clash') < CHECK_KINDS.indexOf('room-missing'), 'a warning, before the notes');
  assert.equal(CHECK_KINDS[CHECK_KINDS.length - 1], 'duty-nobody');
});

// ---------------------------------------------------------------- duty-clash

test('duty-clash: a duty in a period the teacher teaches names the duty, the period, the day, the group and the room', () => {
  const lunch = duty({ kind: 'duty', label: 'Lunch duty', when: 'period', period: 1, teacherIds: [HALLORAN], dayTypeIds: [A] });
  const project = withLists(null, [lunch]);
  assertValid(project);
  const clashes = ofKind(checkSchedule(project, null), 'duty-clash');
  assert.deepEqual(clashes.map((finding) => [finding.id, finding.severity, finding.text, finding.fixable]), [[
    'duty-clash:' + A + ':1:' + HALLORAN + ':' + lunch.id,
    'warning',
    'Ms. Halloran has Lunch duty in Period 2 on A Day, but teaches 8B in Room 101 then. One of them needs to move.',
    false,
  ]]);
  assert.deepEqual(clashes[0].where, { dayTypeId: A, period: 1, groupIds: ['gsample08b'], roomId: 'rsample101', teacherId: HALLORAN });
  assert.deepEqual(clashes[0].about, [HALLORAN, 'gsample08b'].sort());
});

test('duty-clash: a duty in a free period is not a clash; neither is one before or after school', () => {
  const project = withLists(null, [
    duty({ when: 'period', period: 0, teacherIds: [HALLORAN] }),
    duty({ when: 'before', teacherIds: [HALLORAN, BRIGHTWATER] }),
    duty({ when: 'after', teacherIds: [HALLORAN, BRIGHTWATER] }),
  ]);
  assert.deepEqual(ofKind(checkSchedule(project, null), 'duty-clash'), []);
});

test('duty-clash: a duty for a subject clashes for the teachers of it who teach then, and only them', () => {
  const project = withLists(null, [duty({ label: 'Math team', when: 'period', period: 0, subjectIds: [MATH], dayTypeIds: [A] })]);
  const found = ofKind(checkSchedule(project, null), 'duty-clash');
  assert.deepEqual(found.map((finding) => finding.where.teacherId), [BRIGHTWATER], 'Ms. Halloran is free in Period 1');
  assert.match(found[0].text, /^Mr\. Brightwater has Math team in Period 1 on A Day, but teaches 8A in Room \d+ then\./);
});

test('duty-clash: two groups at once are both named, and a duty with no label is "a duty"', () => {
  const project = withLists(null, [duty({ kind: 'meeting', when: 'period', period: 1, teacherIds: [VANDERMEER], dayTypeIds: [A] })]);
  const found = ofKind(checkSchedule(project, null), 'duty-clash');
  assert.equal(found.length, 1);
  assert.match(found[0].text, /^Ms\. Vandermeer has a meeting in Period 2 on A Day, but teaches 6C in Room \d+ and 7C in Room \d+ then\./);
});

test('duty-clash: a duty that holds only on some days is still a clash, and says when', () => {
  const project = withLists(null, [duty({ label: 'Bus duty', when: 'period', period: 1, teacherIds: [HALLORAN], weekdays: [2, 0], dayTypeIds: [A] })]);
  const found = ofKind(checkSchedule(project, null), 'duty-clash');
  assert.equal(found.length, 1);
  assert.equal(found[0].text, 'Ms. Halloran has Bus duty in Period 2 on A Day (on Mondays and Wednesdays), but teaches 8B in Room 101 then. One of them needs to move.');
  const dated = withLists(null, [duty({ label: 'Bus duty', when: 'period', period: 1, teacherIds: [HALLORAN], from: '2026-12-01', to: '2026-12-18', dayTypeIds: [A] })]);
  assert.match(ofKind(checkSchedule(dated, null), 'duty-clash')[0].text, /on A Day \(from 1 December to 18 December\), but/);
});

test('duty-clash: a duty on B Day clashes on B Day only; one on every day on both, each its own finding', () => {
  const onB = withLists(null, [duty({ when: 'period', period: 1, teacherIds: [BRIGHTWATER], dayTypeIds: [B] })]);
  const foundB = ofKind(checkSchedule(onB, null), 'duty-clash');
  assert.deepEqual(foundB.map((finding) => finding.where.dayTypeId), [B]);
  for (const finding of foundB) assert.match(finding.text, /on B Day/);
  const every = withLists(null, [duty({ when: 'period', period: 2, everyone: true })]);
  const days = ofKind(checkSchedule(every, null), 'duty-clash').map((finding) => finding.where.dayTypeId);
  assert.ok(days.includes(A) && days.includes(B));
});

test('duty-clash: a day type the same as A Day is named in the one sentence when the duty holds on both, alone when only it is named', () => {
  const everyDay = withFollower(withLists(null, [duty({ label: 'Hall', when: 'period', period: 1, teacherIds: [HALLORAN] })]));
  const both = ofKind(checkSchedule(everyDay, null), 'duty-clash').filter((finding) => finding.where.dayTypeId === A);
  assert.equal(both.length, 1);
  assert.match(both[0].text, /in Period 2 on A Day and C Day, but/);
  const onlyC = withFollower(withLists(null, [duty({ label: 'Hall', when: 'period', period: 1, teacherIds: [HALLORAN], dayTypeIds: [C] })]));
  const alone = ofKind(checkSchedule(onlyC, null), 'duty-clash');
  assert.equal(alone.length, 1);
  assert.match(alone[0].text, /in Period 2 on C Day, but/);
  assert.equal(alone[0].where.dayTypeId, C);
});

test('duty-clash: switched off, it reports nothing; the other checks carry on', () => {
  const project = withLists(null, [duty({ when: 'period', period: 1, teacherIds: [HALLORAN] }), duty({ when: 'after' })]);
  project.settings.checks.off = ['duty-clash'];
  const result = checkSchedule(project, null);
  assert.deepEqual(ofKind(result, 'duty-clash'), []);
  assert.equal(ofKind(result, 'duty-nobody').length, 1);
});

// ---------------------------------------------------------------- duty-nobody

test('duty-nobody: a duty with nobody on it is a note naming it, and when', () => {
  const bus = duty({ label: 'Bus duty', when: 'after' });
  const project = withLists(null, [bus]);
  assertValid(project);
  const found = ofKind(checkSchedule(project, null), 'duty-nobody');
  assert.deepEqual(found.map((finding) => [finding.id, finding.severity, finding.text, finding.fixable, finding.about]), [['duty-nobody:' + bus.id, 'note', 'Bus duty after school has nobody on it.', false, []]]);
  assert.deepEqual(found[0].where, { dayTypeId: null, period: null, groupIds: [], roomId: null, teacherId: null });
});

test('duty-nobody: every shape of "nobody", and the words for when and which days', () => {
  const none = duty({ kind: 'meeting', when: 'before' });
  const subject = duty({ label: 'Hall', when: 'period', period: 4, subjectIds: ['ssample999'], dayTypeIds: [A, B], weekdays: [2] });
  const project = withLists(null, [none, subject]);
  const texts = ofKind(checkSchedule(project, null), 'duty-nobody').map((finding) => finding.text).sort();
  assert.deepEqual(texts, ['Hall in Period 5 on A Day and B Day (on Wednesdays) has nobody on it.', 'Meeting before school has nobody on it.']);
});

test('duty-nobody: a duty with someone on it, or for everyone, is not reported; deleting the teacher reports it', () => {
  const project = withLists(null, [duty({ teacherIds: [HALLORAN] }), duty({ everyone: true }), duty({ subjectIds: [MATH] })]);
  assert.deepEqual(ofKind(checkSchedule(project, null), 'duty-nobody'), []);
  const gone = withLists(null, [duty({ label: 'Gate', when: 'after', teacherIds: ['tnobody001'] })]);
  assert.deepEqual(ofKind(checkSchedule(gone, null), 'duty-nobody').map((finding) => finding.text), ['Gate after school has nobody on it.']);
});

test('duty-nobody: a duty in a period the school no longer has is inert and not reported', () => {
  const project = withLists(null, [duty({ when: 'period', period: 12 })]);
  assert.deepEqual(ofKind(checkSchedule(project, null), 'duty-nobody'), []);
});

// ---------------------------------------------------------------- no-planning

test('no-planning: an always duty in the only free periods takes them, and the sentence says which', () => {
  // Mr. Brightwater is free in Periods 2, 5 and 6 on A Day
  const project = withLists(null, [
    duty({ label: 'Bus duty', when: 'period', period: 1, teacherIds: [BRIGHTWATER] }),
    duty({ label: 'Hall', when: 'period', period: 4, teacherIds: [BRIGHTWATER] }),
    duty({ label: 'Gate', when: 'period', period: 5, teacherIds: [BRIGHTWATER] }),
  ]);
  const found = ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === BRIGHTWATER && finding.where.dayTypeId === A);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'no-planning:' + A + ':' + BRIGHTWATER);
  assert.equal(found[0].text, 'Mr. Brightwater has no planning period on A Day: Period 2 is Bus duty, Period 5 is Hall and Period 6 is Gate, and there is a group in every other period.');
});

test('no-planning: a duty that holds only on some days does not take the period', () => {
  const project = withLists(null, [
    duty({ when: 'period', period: 1, teacherIds: [BRIGHTWATER], weekdays: [2] }),
    duty({ when: 'period', period: 4, teacherIds: [BRIGHTWATER] }),
    duty({ when: 'period', period: 5, teacherIds: [BRIGHTWATER] }),
  ]);
  assert.deepEqual(ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === BRIGHTWATER), []);
});

const LARKSPUR = 'tsample011'; // A Day: a group in every period but two, when he is free

test('no-planning: the words of a duty are lower-case mid-sentence, a typed label stays as typed', () => {
  const project = withLists(null, [duty({ when: 'period', period: 3, teacherIds: [LARKSPUR] }), duty({ kind: 'lunch', when: 'period', period: 6, teacherIds: [LARKSPUR] })]);
  const found = ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === LARKSPUR && finding.where.dayTypeId === A);
  assert.equal(found.length, 1);
  assert.match(found[0].text, /: Period 4 is a duty and Period 7 is their own lunch, and there is a group in every other period\.$/);
  const typed = withLists(null, [duty({ label: 'Hall Watch', when: 'period', period: 3, teacherIds: [LARKSPUR] }), duty({ when: 'period', period: 6, teacherIds: [LARKSPUR] })]);
  const again = ofKind(checkSchedule(typed, null), 'no-planning').filter((finding) => finding.where.teacherId === LARKSPUR && finding.where.dayTypeId === A);
  assert.match(again[0].text, /: Period 4 is Hall Watch and Period 7 is a duty,/);
});

test('no-planning and consecutive: a day type a duty names directly is checked on its own, as for a mark', () => {
  const two = (dayTypeIds) => {
    const project = withFollower(withLists(null, [duty({ when: 'period', period: 3, teacherIds: [LARKSPUR], dayTypeIds }), duty({ when: 'period', period: 6, teacherIds: [LARKSPUR], dayTypeIds })]));
    assertValid(project);
    return ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === LARKSPUR).map((finding) => [finding.where.dayTypeId, finding.text.replace(/: .*/, '')]);
  };
  assert.deepEqual(two([A]), [[A, 'Mr. Larkspur has no planning period on A Day and C Day']], 'named on A alone, C Day is the same as A Day and follows it');
  assert.deepEqual(two([C]), [[C, 'Mr. Larkspur has no planning period on C Day']], 'named on the follower alone, it gets its own check and A gets none');
  assert.deepEqual(two([]), [[A, 'Mr. Larkspur has no planning period on A Day and C Day']], 'named on none, the two are one check as before');
});

test('no-planning: a school mark takes the free period of a teacher with nothing then, and its words are in the sentence', () => {
  // Ms. Vandermeer is free in Periods 5 and 6 on A Day
  const project = withLists([mark({ kind: 'lunch', period: 4 }), mark({ kind: 'advisory', label: 'Homeroom', period: 5 })], null);
  const found = ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === VANDERMEER);
  assert.deepEqual(found.map((finding) => [finding.where.dayTypeId, finding.text]), [[A, 'Ms. Vandermeer has no planning period on A Day: Period 5 is lunch and Period 6 is advisory, and there is a group in every other period.']]);
  assert.equal(isFree(teacherDay(project, VANDERMEER, A)[4]), false);
});

test('no-planning: a mark for one group only takes nobody\'s period, and one free period is enough', () => {
  const project = withLists([mark({ kind: 'lunch', period: 4, scope: 'groups', groupIds: ['gsample06a'] })], [duty({ when: 'period', period: 4, teacherIds: [VANDERMEER] })]);
  assert.deepEqual(ofKind(checkSchedule(project, null), 'no-planning').filter((finding) => finding.where.teacherId === VANDERMEER), [], 'Period 6 is still free');
});

test('no-planning: a teacher with no class at all is not told they have no planning', () => {
  const project = withLists(null, [duty({ everyone: true, when: 'period', period: 0 })]);
  project.groups = [];
  assert.deepEqual(ofKind(checkSchedule(project, null), 'no-planning'), []);
});

// ---------------------------------------------------------------- consecutive

function limited(limit, marks, duties) {
  const project = withLists(marks, duties);
  project.settings.checks.consecutiveLimit = limit;
  return project;
}

const runsOf = (result, teacherId) => ofKind(result, 'consecutive').filter((finding) => finding.where.teacherId === teacherId && finding.where.dayTypeId === A).map((finding) => finding.text);

test('consecutive: with no duty or mark the runs are as they were', () => {
  assert.deepEqual(runsOf(checkSchedule(limited(2), null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 3 periods in a row on A Day, Period 6 to Period 8. The limit set for this school is 2.']);
});

test('consecutive: a duty between two classes neither adds to the run nor ends it', () => {
  // Mr. Pennywhistle teaches Periods 3, 4, 6, 7 and 8; Period 5 is free
  const project = limited(2, null, [duty({ label: 'Hall', when: 'period', period: 4, teacherIds: [PENNYWHISTLE] })]);
  assert.deepEqual(runsOf(checkSchedule(project, null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 5 periods in a row on A Day, Period 3 to Period 8. The limit set for this school is 2.']);
  const meeting = limited(2, null, [duty({ kind: 'meeting', when: 'period', period: 4, teacherIds: [PENNYWHISTLE] })]);
  assert.deepEqual(runsOf(checkSchedule(meeting, null), PENNYWHISTLE).length, 1);
});

test('consecutive: their own lunch, a school Lunch mark and a No class period end a run', () => {
  const own = limited(2, null, [duty({ kind: 'lunch', when: 'period', period: 4, teacherIds: [PENNYWHISTLE] })]);
  assert.deepEqual(runsOf(checkSchedule(own, null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 3 periods in a row on A Day, Period 6 to Period 8. The limit set for this school is 2.']);
  const school1 = limited(2, [mark({ kind: 'lunch', period: 6 })], null);
  const text = runsOf(checkSchedule(school1, null), PENNYWHISTLE);
  assert.deepEqual(text, [], 'Period 7 is lunch: Periods 6 and 8 are runs of one, and 3 and 4 a run of two');
  const noclass = limited(1, [mark({ kind: 'noclass', period: 6 })], null);
  assert.ok(runsOf(checkSchedule(noclass, null), PENNYWHISTLE).every((line) => !/Period 6 to Period 8/.test(line)));
});

test('consecutive: a duty that holds only on some days is not in the run, and the run still ends at a free period', () => {
  const project = limited(2, null, [duty({ when: 'period', period: 4, teacherIds: [PENNYWHISTLE], weekdays: [1] })]);
  assert.deepEqual(runsOf(checkSchedule(project, null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 3 periods in a row on A Day, Period 6 to Period 8. The limit set for this school is 2.']);
});

test('consecutive: teachingRunEnd is the same rule for the checks and for suggest', () => {
  const t = (marked) => ({ kind: 'teaching', marked: null, groups: [], duties: [] });
  const gap = (marked) => ({ kind: 'planning', marked, groups: [], duties: [] });
  assert.equal(teachingRunEnd([t(), t(), gap(null), t()], 0), 1);
  assert.equal(teachingRunEnd([t(), gap('duty'), t(), gap('duty')], 0), 2, 'a trailing duty is not in the run');
  assert.equal(teachingRunEnd([t(), gap('meeting'), gap('duty'), t()], 0), 3);
  assert.equal(teachingRunEnd([t(), gap('lunch'), t()], 0), 0);
  assert.equal(teachingRunEnd([t(), gap('noclass'), t()], 0), 0);
  assert.equal(teachingRunEnd([t(), gap('advisory'), t()], 0), 0);
});

test('consecutive: a school Lunch or No class in a slot ends the run whatever else the teacher has there', () => {
  // Mr. Pennywhistle teaches 3, 4, 6, 7, 8 on A Day; Period 5 is free
  const own = duty({ label: 'Hall', when: 'period', period: 4, teacherIds: [PENNYWHISTLE] });
  assert.deepEqual(runsOf(checkSchedule(limited(2, null, [own]), null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 5 periods in a row on A Day, Period 3 to Period 8. The limit set for this school is 2.']);
  for (const kind of ['lunch', 'noclass']) {
    const project = limited(2, [mark({ kind, period: 4 })], [own]);
    assert.deepEqual(runsOf(checkSchedule(project, null), PENNYWHISTLE), ['Mr. Pennywhistle teaches 3 periods in a row on A Day, Period 6 to Period 8. The limit set for this school is 2.'], kind + ' ends the run though an always duty is there');
  }
  const advisory = limited(2, [mark({ kind: 'advisory', period: 4 })], [own]);
  assert.equal(runsOf(checkSchedule(advisory, null), PENNYWHISTLE).length, 1, 'an Advisory under the duty does not end it: the duty outranks it');
  assert.match(runsOf(checkSchedule(advisory, null), PENNYWHISTLE)[0], /5 periods in a row/);
});

test('consecutive: teachingRunEnd reads the school marks it is given, not the entry\'s marked', () => {
  const t = () => ({ kind: 'teaching', marked: null, groups: [], duties: [] });
  const gap = (marked) => ({ kind: 'planning', marked, groups: [], duties: [] });
  const day = [t(), gap('duty'), t()];
  assert.equal(teachingRunEnd(day, 0), 2);
  assert.equal(teachingRunEnd(day, 0, [null, null, null]), 2);
  assert.equal(teachingRunEnd(day, 0, [null, 'advisory', null]), 2);
  assert.equal(teachingRunEnd(day, 0, [null, 'lunch', null]), 0);
  assert.equal(teachingRunEnd(day, 0, [null, 'noclass', null]), 0);
});

// ---------------------------------------------------------------- empty-period

function withBareGroup(project, rooms) {
  const day = (numbers) => numbers.map((number) => (number === null ? emptySlot() : { ...emptySlot(), room: group(project, '6A').days[A][0].room }));
  project.groups.push({ id: 'gtest00001', name: '9Z', grade: '9', headCount: 20, colour: '#999999', days: { [A]: day(rooms), [B]: day(rooms) } });
  return project;
}
const FULL = ['x', 'x', 'x', null, 'x', 'x', 'x', 'x'];
const empties = (project) => ofKind(checkSchedule(project, null), 'empty-period').map((finding) => finding.id.replace(/^empty-period:/, '')).filter((id) => /gtest00001/.test(id));

test('empty-period: a group with no room in Period 4 gets the note; a mark on that slot, of any kind, stops it', () => {
  assert.deepEqual(empties(withBareGroup(school(), FULL)), [A + ':3:gtest00001', B + ':3:gtest00001']);
  for (const kind of ['lunch', 'advisory', 'activity', 'noclass']) {
    assert.deepEqual(empties(withBareGroup(withLists([mark({ kind, period: 3 })], null), FULL)), [], kind);
  }
});

test('empty-period: only a mark that reaches the group and the day type stops the note', () => {
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 3, scope: 'groups', groupIds: ['gsample06a'] })], null), FULL)), [A + ':3:gtest00001', B + ':3:gtest00001']);
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 3, scope: 'grades', grades: ' 9 ' })], null), FULL)), [A + ':3:gtest00001', B + ':3:gtest00001'], 'grades is a list: " 9 " as a string is not one');
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 3, scope: 'grades', grades: [' 9'] })], null), FULL)), []);
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 3, dayTypeIds: [A] })], null), FULL)), [B + ':3:gtest00001']);
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 2 })], null), FULL)), [A + ':3:gtest00001', B + ':3:gtest00001'], 'another period');
});

test('empty-period: a No class period that held a room is not reported either', () => {
  const project = withBareGroup(withLists([mark({ kind: 'noclass', period: 2, scope: 'groups', groupIds: ['gtest00001'] })], null), ['x', 'x', 'x', 'x', 'x', 'x', 'x', 'x']);
  assert.deepEqual(empties(project), []);
});

test('empty-period: a group with no room all day still gets its one note when a lunch mark covers some of the day', () => {
  const none = [null, null, null, null, null, null, null, null];
  assert.deepEqual(empties(withBareGroup(school(), none)), [A + ':gtest00001', B + ':gtest00001']);
  assert.deepEqual(empties(withBareGroup(withLists([mark({ kind: 'lunch', period: 3 })], null), none)), [A + ':gtest00001', B + ':gtest00001']);
  const allMarked = withLists(Array.from({ length: 8 }, (unused, period) => mark({ kind: 'activity', period })), null);
  assert.deepEqual(empties(withBareGroup(allMarked, none)), [], 'every slot has a mark: there is nothing to report');
});

test('a day type the same as A Day that a mark names is checked on its own', () => {
  const plain = withFollower(withBareGroup(school(), FULL));
  const together = ofKind(checkSchedule(plain, null), 'empty-period').find((finding) => finding.id === 'empty-period:' + A + ':3:gtest00001');
  assert.equal(together.text, '9Z has no room in Period 4 on A Day and C Day.');
  const named = withFollower(withBareGroup(withLists([mark({ kind: 'lunch', period: 3, dayTypeIds: [C] })], null), FULL));
  const apart = ofKind(checkSchedule(named, null), 'empty-period').filter((finding) => /gtest00001/.test(finding.id));
  assert.deepEqual(apart.map((finding) => [finding.id, finding.text]), [
    ['empty-period:' + A + ':3:gtest00001', '9Z has no room in Period 4 on A Day.'],
    ['empty-period:' + B + ':3:gtest00001', '9Z has no room in Period 4 on B Day.'],
  ], 'C Day has the lunch mark, so no note for it; A Day is no longer said to include it');
});

// ---------------------------------------------------------------- finding ids

test('a project with bell schedules and a calendar, no marks and no duties: every finding id is what it was (named case, walk across included)', async () => {
  const { createPipeline } = await import('../../engine/worker.js');
  const { withEverything } = await import('../fixtures/day-types-calendar.mjs');
  const project = withEverything();
  const before = createPipeline().run(project).findings.findings.map((finding) => finding.id + '|' + finding.text);
  assert.ok(before.length > 0);
  const lists = { ...project, marks: [], duties: [] };
  assert.deepEqual(createPipeline().run(lists).findings.findings.map((finding) => finding.id + '|' + finding.text), before);
  assert.ok(before.some((line) => /^[a-z-]+:[a-z0-9]+:\d+:/.test(line)), 'the ids keep their form: kind, day type, period, who');
  assert.ok(before.every((line) => !/^duty-/.test(line)), 'no duty finding without a duty');
});
