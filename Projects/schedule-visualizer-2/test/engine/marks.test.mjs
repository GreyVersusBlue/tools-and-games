// Marked periods and duties (ARCHITECTURE 17.5, 17.6): which mark applies,
// meetingSlots and runsOf with marks, who a duty covers, and a teacher's
// duties by weekday, date and subject. The clock and the zone are never read:
// dates are plain strings.

import test from 'node:test';
import assert from 'node:assert/strict';
import { markFor, schoolMarkFor, dutyTeachers, teacherDuties, dutiesByTeacher, hasMarks } from '../../engine/marks.js';
import { meetingSlots, runsOf } from '../../engine/runs.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { emptySlot } from '../../engine/schema.js';
import { school } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const C = 'dsample00c';
const HALLORAN = 'tsample001';
const BRIGHTWATER = 'tsample002';
const SCIENCE = 'ssample003';

let counter = 0;
const mark = (extra) => ({ id: 'm' + String(counter += 1).padStart(9, '0'), kind: 'lunch', label: '', period: 3, dayTypeIds: [], scope: 'school', grades: [], groupIds: [], ...extra });
const duty = (extra) => ({ id: 'u' + String(counter += 1).padStart(9, '0'), kind: 'duty', label: '', when: 'before', period: 0, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [], subjectIds: [], everyone: false, ...extra });

// A Day, B Day (its own), and C Day, the same as A Day.
function withMarks(marks, duties) {
  const project = school();
  project.dayTypes.push({ id: C, name: 'C Day', own: false, sameAs: A, short: '', bells: Array(8).fill(null) });
  project.marks = marks;
  if (duties) project.duties = duties;
  return project;
}

const kindFor = (project, group, day, period) => {
  const found = markFor(project, group, day, period);
  return found === null ? null : found.kind + (found.label ? ':' + found.label : '');
};

test('a project with no marks gives null everywhere and the very same array from meetingSlots', () => {
  const project = school();
  assert.equal(hasMarks(project), false);
  assert.equal(markFor(project, 'gsample06a', A, 3), null);
  assert.equal(schoolMarkFor(project, A, 3), null);
  assert.equal(meetingSlots(project, 'gsample06a', A), effectiveSchedule(project, 'gsample06a', A));
});

test('malformed lists and items read as none: the staff browser never runs repair', () => {
  const project = school();
  for (const junk of ['marks', 7, {}, [null, 5, 'x', { period: 'a' }, { kind: 'lunch', period: 3, scope: 'school' }]]) {
    project.marks = junk;
    const fresh = { ...project };
    assert.doesNotThrow(() => markFor(fresh, 'gsample06a', A, 3));
  }
  const odd = { ...project, marks: [{ kind: 'nap', period: 3 }, { kind: 'lunch', period: -1 }] };
  assert.equal(markFor(odd, 'gsample06a', A, 3), null);
});

test('a school mark applies to every group in its period and only that period', () => {
  const project = withMarks([mark({ kind: 'lunch', period: 3 })]);
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'lunch');
  assert.equal(kindFor(project, 'gsample08b', B, 3), 'lunch');
  assert.equal(kindFor(project, 'gsample06a', A, 2), null);
  assert.equal(kindFor(project, 'nobody0000', A, 3), null);
  assert.equal(kindFor(project, 'gsample06a', 'dnowhere00', 3), null);
});

test('No class wins outright: over a grade\'s Lunch, a group\'s Advisory, and a day-specific mark', () => {
  const project = withMarks([
    mark({ kind: 'lunch', scope: 'grades', grades: ['6'] }),
    mark({ kind: 'advisory', scope: 'groups', groupIds: ['gsample06a'], dayTypeIds: [A] }),
    mark({ kind: 'noclass', label: 'Assembly' }),
  ]);
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'noclass:Assembly');
  assert.equal(kindFor(project, 'gsample06b', B, 3), 'noclass:Assembly');
});

test('a mark naming day types beats an every-day mark of the same kind of scope', () => {
  const project = withMarks([mark({ kind: 'lunch', label: 'every' }), mark({ kind: 'activity', label: 'named', dayTypeIds: [A] })]);
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'activity:named');
  assert.equal(kindFor(project, 'gsample06a', B, 3), 'lunch:every', 'B Day is not named');
});

test('a day-specific mark beats a narrower every-day one: day types decide before scope', () => {
  const project = withMarks([mark({ kind: 'lunch', label: 'group', scope: 'groups', groupIds: ['gsample06a'] }), mark({ kind: 'activity', label: 'school, named', dayTypeIds: [A] })]);
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'activity:school, named');
});

test('groups beat grades beat the school', () => {
  const project = withMarks([
    mark({ kind: 'lunch', label: 'school' }),
    mark({ kind: 'advisory', label: 'grade', scope: 'grades', grades: ['7'] }),
    mark({ kind: 'activity', label: 'group', scope: 'groups', groupIds: ['gsample07a'] }),
  ]);
  assert.equal(kindFor(project, 'gsample07a', A, 3), 'activity:group');
  assert.equal(kindFor(project, 'gsample07b', A, 3), 'advisory:grade');
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'lunch:school');
});

test('the earlier in the list wins a tie', () => {
  const project = withMarks([mark({ kind: 'lunch', label: 'first' }), mark({ kind: 'advisory', label: 'second' })]);
  assert.equal(kindFor(project, 'gsample06a', A, 3), 'lunch:first');
  const swapped = withMarks([project.marks[1], project.marks[0]]);
  assert.equal(kindFor(swapped, 'gsample06a', A, 3), 'advisory:second');
});

test('grades are matched ignoring case and spaces', () => {
  const project = withMarks([mark({ kind: 'lunch', scope: 'grades', grades: [' 6 ', 'Eighth Grade'] })]);
  project.groups = project.groups.map((g) => (g.id === 'gsample08a' ? { ...g, grade: 'eighth  GRADE' } : g));
  const fresh = { ...project };
  assert.equal(kindFor(fresh, 'gsample06a', A, 3), 'lunch');
  assert.equal(kindFor(fresh, 'gsample08a', A, 3), 'lunch');
  assert.equal(kindFor(fresh, 'gsample07a', A, 3), null);
});

test('a group with no grade is never matched by a grades mark, not even one naming ""', () => {
  const project = withMarks([mark({ scope: 'grades', grades: [''] })]);
  project.groups = project.groups.map((g) => ({ ...g, grade: '' }));
  assert.equal(markFor({ ...project }, 'gsample06a', A, 3), null);
});

test('a mark naming an own day type reaches the day types the same as it; a mark naming the follower reaches it alone', () => {
  const named = withMarks([mark({ dayTypeIds: [A] })]);
  assert.equal(kindFor(named, 'gsample06a', C, 3), 'lunch', 'C Day is the same as A Day');
  assert.equal(kindFor(named, 'gsample06a', B, 3), null);
  const follower = withMarks([mark({ dayTypeIds: [C] })]);
  assert.equal(kindFor(follower, 'gsample06a', C, 3), 'lunch');
  assert.equal(kindFor(follower, 'gsample06a', A, 3), null, 'the own day type it follows is not touched');
});

test('schoolMarkFor looks only at school-scope marks', () => {
  const project = withMarks([mark({ kind: 'noclass', scope: 'groups', groupIds: ['gsample06a'] }), mark({ kind: 'advisory' }), mark({ kind: 'lunch', label: 'named', dayTypeIds: [A] })]);
  assert.equal(schoolMarkFor(project, A, 3).label, 'named');
  assert.equal(schoolMarkFor(project, B, 3).kind, 'advisory');
  assert.equal(schoolMarkFor(project, A, 4), null);
});

test('a mark past the period count is ignored by the rules', () => {
  const project = withMarks([mark({ period: 40 })]);
  assert.equal(meetingSlots(project, 'gsample06a', A), effectiveSchedule(project, 'gsample06a', A));
  assert.equal(markFor(project, 'gsample06a', A, 7), null);
});

test('the index is built once per project: a repeated lookup does not read the list again', () => {
  const project = withMarks([mark()]);
  let reads = 0;
  const watched = new Proxy(project.marks, { get(target, key, receiver) { if (key === 'forEach') reads += 1; return Reflect.get(target, key, receiver); } });
  const counted = { ...project, marks: watched };
  for (let i = 0; i < 50; i += 1) markFor(counted, 'gsample06a', A, 3);
  assert.equal(reads, 1);
});

// ---------------------------------------------------------------- meetingSlots and runsOf

test('meetingSlots empties a No class slot, keeps the others, and leaves the group\'s own day alone', () => {
  const project = withMarks([mark({ kind: 'noclass', period: 1, scope: 'groups', groupIds: ['gsample08b'] })]);
  const day = effectiveSchedule(project, 'gsample08b', A);
  assert.notDeepEqual(day[1], emptySlot());
  const meeting = meetingSlots(project, 'gsample08b', A);
  assert.deepEqual(meeting[1], emptySlot());
  assert.equal(meeting[2], day[2]);
  assert.notEqual(meeting, day);
  assert.deepEqual(effectiveSchedule(project, 'gsample08b', A)[1], day[1]);
  assert.equal(meetingSlots(project, 'gsample06a', A), effectiveSchedule(project, 'gsample06a', A), 'a group the mark does not take keeps the very array');
});

test('meetingSlots keeps a Lunch slot with a room and one without; Advisory and Activity change nothing', () => {
  for (const kind of ['lunch', 'advisory', 'activity']) {
    const project = withMarks([mark({ kind, period: 1 })]);
    assert.equal(meetingSlots(project, 'gsample08b', A), effectiveSchedule(project, 'gsample08b', A), kind);
  }
});

test('meetingSlots applies marks and a bell schedule\'s off periods together', () => {
  const project = withMarks([mark({ kind: 'noclass', period: 1 })]);
  project.bellSchedules = [{ id: 'bsample0er', name: 'Early Release', short: '', bells: project.dayTypes[0].bells.slice(), off: [2] }];
  const meeting = meetingSlots(project, 'gsample08b', A, 'bsample0er');
  assert.deepEqual([meeting[1], meeting[2]], [emptySlot(), emptySlot()]);
  const regular = meetingSlots(project, 'gsample08b', A);
  assert.deepEqual(regular[1], emptySlot());
  assert.notDeepEqual(regular[2], emptySlot());
});

test('runsOf adds a day type that is the same as another only when a mark names it', () => {
  assert.deepEqual(runsOf(withMarks([mark()])).map((run) => run.dayTypeId), [A, B]);
  const named = withMarks([mark({ dayTypeIds: [C] })]);
  assert.deepEqual(runsOf(named), [{ dayTypeId: A, bellsId: null }, { dayTypeId: B, bellsId: null }, { dayTypeId: C, bellsId: null }]);
  named.bellSchedules = [{ id: 'bsample0er', name: 'Early Release', short: '', bells: named.dayTypes[0].bells.slice(), off: [] }];
  assert.deepEqual(runsOf(named).map((run) => run.dayTypeId + '/' + run.bellsId), [A + '/null', B + '/null', C + '/null', A + '/bsample0er', B + '/bsample0er', C + '/bsample0er']);
  const bell = withMarks([mark({ dayTypeIds: [A] })]);
  assert.equal(runsOf(bell).length, 2, 'a mark naming an own day type adds nothing');
});

// ---------------------------------------------------------------- duties

test('dutyTeachers: named teachers, the teachers of named subjects, or everyone; ids that name nobody are not there', () => {
  const project = withMarks([], []);
  assert.deepEqual(dutyTeachers(project, duty({ teacherIds: [BRIGHTWATER, 'tnowhere00', HALLORAN] })), [HALLORAN, BRIGHTWATER], 'in the teachers\' own order');
  assert.deepEqual(dutyTeachers(project, duty({ subjectIds: [SCIENCE] })), ['tsample003', 'tsample010']);
  assert.deepEqual(dutyTeachers(project, duty({ teacherIds: ['tsample003'], subjectIds: [SCIENCE] })), ['tsample003', 'tsample010'], 'the union, each once');
  assert.equal(dutyTeachers(project, duty({ everyone: true })).length, project.teachers.length);
  assert.deepEqual(dutyTeachers(project, duty({})), []);
  assert.deepEqual(dutyTeachers(project, null), []);
});

test('a new hire in a named subject is covered without editing the duty', () => {
  const project = withMarks([], [duty({ subjectIds: [SCIENCE] })]);
  const hired = { ...project, teachers: project.teachers.concat([{ ...project.teachers[2], id: 'tsample099', name: 'Ms. Newhire', roomIds: [] }]) };
  assert.ok(dutyTeachers(hired, hired.duties[0]).includes('tsample099'));
});

test('teacherDuties: before, by period and after; the periods are the school day\'s', () => {
  const project = withMarks([], [
    duty({ id: 'ubefore001', when: 'before', teacherIds: [HALLORAN] }),
    duty({ id: 'uperiod001', when: 'period', period: 3, teacherIds: [HALLORAN] }),
    duty({ id: 'uafter0001', when: 'after', everyone: true }),
    duty({ id: 'upast00001', when: 'period', period: 40, teacherIds: [HALLORAN] }),
    duty({ id: 'uother0001', when: 'before', teacherIds: [BRIGHTWATER] }),
  ]);
  const mine = teacherDuties(project, HALLORAN, A);
  assert.deepEqual(mine.before.map((d) => d.id), ['ubefore001']);
  assert.equal(mine.byPeriod.length, 8);
  assert.deepEqual(mine.byPeriod[3].map((d) => d.id), ['uperiod001']);
  assert.deepEqual(mine.after.map((d) => d.id), ['uafter0001']);
  assert.equal(mine.byPeriod.flat().length, 1, 'the duty past the end is ignored');
  assert.equal(teacherDuties(project, 'tnowhere00', A), null);
  assert.equal(teacherDuties(project, HALLORAN, 'dnowhere00'), null);
  assert.deepEqual(teacherDuties(project, 'tsample012', A).before, []);
});

test('teacherDuties by day type: named, through "same as", and every day', () => {
  const project = withMarks([], [duty({ id: 'ua00000001', dayTypeIds: [A], everyone: true }), duty({ id: 'ub00000001', dayTypeIds: [B], everyone: true }), duty({ id: 'ue00000001', everyone: true })]);
  assert.deepEqual(teacherDuties(project, HALLORAN, A).before.map((d) => d.id), ['ua00000001', 'ue00000001']);
  assert.deepEqual(teacherDuties(project, HALLORAN, B).before.map((d) => d.id), ['ub00000001', 'ue00000001']);
  assert.deepEqual(teacherDuties(project, HALLORAN, C).before.map((d) => d.id), ['ua00000001', 'ue00000001'], 'C Day is the same as A Day');
});

test('weekdays and dates: without a date a sometimes duty is listed; with one it holds only when it matches', () => {
  const wed = duty({ id: 'uwed000001', weekdays: [2], teacherIds: [HALLORAN] });
  const dec = duty({ id: 'udec000001', from: '2026-12-01', to: '2026-12-18', teacherIds: [HALLORAN] });
  const both = duty({ id: 'uboth00001', weekdays: [2], from: '2026-12-01', to: '2026-12-18', teacherIds: [HALLORAN] });
  const project = withMarks([], [wed, dec, both]);
  const ids = (options) => teacherDuties(project, HALLORAN, A, options).before.map((d) => d.id);
  assert.deepEqual(ids(), ['uwed000001', 'udec000001', 'uboth00001']);
  // 2026-12-02 is a Wednesday, 2026-12-03 a Thursday, 2026-11-25 a Wednesday, 2026-12-23 a Wednesday
  assert.deepEqual(ids({ date: '2026-12-02' }), ['uwed000001', 'udec000001', 'uboth00001']);
  assert.deepEqual(ids({ date: '2026-12-03' }), ['udec000001']);
  assert.deepEqual(ids({ date: '2026-11-25' }), ['uwed000001']);
  assert.deepEqual(ids({ date: '2026-12-23' }), ['uwed000001']);
  assert.deepEqual(ids({ date: '2026-12-18' }), ['udec000001'], 'the last date is included');
  assert.deepEqual(ids({ date: '2026-12-01' }), ['udec000001'], 'the first date is included; it is a Tuesday');
  assert.deepEqual(ids({ date: 'not a date' }), [], 'a date that cannot be read matches no sometimes duty');
});

test('a duty with no weekdays and no dates holds on any date and with no date', () => {
  const project = withMarks([], [duty({ id: 'ualways001', teacherIds: [HALLORAN] })]);
  assert.equal(teacherDuties(project, HALLORAN, A, { date: '2030-01-01' }).before.length, 1);
  assert.equal(teacherDuties(project, HALLORAN, A).before.length, 1);
});

test('dutiesByTeacher answers for every teacher in one pass and null for a day type that does not exist', () => {
  const project = withMarks([], [duty({ everyone: true })]);
  assert.equal(dutiesByTeacher(project, A).size, project.teachers.length);
  assert.equal(dutiesByTeacher(project, 'dnowhere00'), null);
  assert.equal(dutiesByTeacher(school(), A).size, 0);
});
