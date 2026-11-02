// The one rule for a teacher's day (ARCHITECTURE 6.4, spec 5.3): a slot
// counts for a teacher when it names them, or names nobody and its room is one
// they are based in.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { teacherDay, teacherDays, isFree, slotTeacherIds, entryRoomIds, entryPlaces, teacherMoves } from '../../engine/teacher-day.js';
import { school, clone, assertValid, room, group, teacher } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const HALLORAN = 'tsample001'; // based in 101
const BRIGHTWATER = 'tsample002'; // based in 102
const QUILLFEATHER = 'tsample003'; // based in 103
const OYELARAN = 'tsample005'; // based in 201
const CASTELLANOS = 'tsample006'; // based in 202

const planning = (period) => ({ period, groups: [], kind: 'planning', duties: [], marked: null });
// [group, room] for a room in the building; [group, null, '101'] for one that is not
const teaching = (period, ...pairs) => ({ period, groups: pairs.map(([groupId, roomId, roomText]) => ({ groupId, roomId, roomText: roomText === undefined ? '' : roomText })), kind: 'teaching', duties: [], marked: null });

function slot(project, groupName, dayTypeId, period) {
  return group(project, groupName).days[dayTypeId][period];
}

// Base a teacher in one more room, on both sides of the record.
function alsoBasedIn(project, teacherName, number) {
  const who = teacher(project, teacherName);
  const where = room(project, number);
  who.roomIds.push(where.id);
  where.teacherIds.push(who.id);
}

function withEmptyBDay() {
  const project = school();
  project.dayTypes[1] = { ...project.dayTypes[1], own: false, bells: project.dayTypes[1].bells.map(() => null) };
  project.groups = project.groups.map((g) => ({ ...g, days: { [A]: g.days[A] } }));
  return project;
}

test('a teacher\'s day is the groups scheduled into the room they are based in', () => {
  const project = school();
  assert.deepEqual(teacherDay(project, HALLORAN, A), [
    planning(0),
    teaching(1, ['gsample08b', 'rsample101']),
    teaching(2, ['gsample06a', 'rsample101']),
    planning(3), planning(4), planning(5), planning(6), planning(7),
  ]);
});

test('one entry per period, whatever the number of periods', () => {
  const project = school();
  assert.equal(teacherDay(project, HALLORAN, A).length, 8);
  project.settings.periods = 3;
  for (const g of project.groups) for (const d of [A, B]) g.days[d] = g.days[d].slice(0, 3);
  assert.deepEqual(teacherDay(project, HALLORAN, A).map((entry) => entry.period), [0, 1, 2]);
});

test('in the sample school every teacher\'s day is their room\'s day, on both day types', () => {
  const project = school();
  for (const dayTypeId of [A, B]) {
    for (const who of project.teachers) {
      const expected = [];
      for (let p = 0; p < 8; p += 1) {
        const here = project.groups.filter((g) => g.days[dayTypeId][p].room === who.roomIds[0]).map((g) => ({ groupId: g.id, roomId: who.roomIds[0], roomText: '' }));
        expected.push({ period: p, groups: here, kind: here.length > 0 ? 'teaching' : 'planning', duties: [], marked: null });
      }
      assert.deepEqual(teacherDay(project, who.id, dayTypeId), expected, who.name);
    }
  }
});

test('a period with no group is planning', () => {
  const project = school();
  for (const g of project.groups) for (const d of [A, B]) g.days[d] = g.days[d].map(() => ({ room: null, roomText: '', label: '', teacherIds: [] }));
  assert.deepEqual(teacherDay(project, HALLORAN, A), [0, 1, 2, 3, 4, 5, 6, 7].map(planning));
});

test('a slot that names a teacher counts for that teacher and not for the room\'s own', () => {
  const project = school();
  // 6B is in Room 103 (Dr. Quillfeather's) in Period 3; the slot names Ms. Halloran
  slot(project, '6B', A, 2).teacherIds = [HALLORAN];
  assertValid(project);
  assert.deepEqual(teacherDay(project, HALLORAN, A)[2], teaching(2, ['gsample06a', 'rsample101'], ['gsample06b', 'rsample103']));
  assert.deepEqual(teacherDay(project, QUILLFEATHER, A)[2], planning(2));
});

test('co-teaching: a slot that names two teachers counts for both', () => {
  const project = school();
  slot(project, '6A', A, 0).teacherIds = [OYELARAN, CASTELLANOS];
  assertValid(project);
  assert.deepEqual(teacherDay(project, OYELARAN, A)[0], teaching(0, ['gsample06a', 'rsample201']));
  assert.deepEqual(teacherDay(project, CASTELLANOS, A)[0], teaching(0, ['gsample06a', 'rsample201']));
});

test('two teachers sharing a room both have its groups, until a slot names one of them', () => {
  const project = school();
  alsoBasedIn(project, 'Mr. Brightwater', '101');
  assertValid(project);
  assert.deepEqual(teacherDay(project, HALLORAN, A)[1], teaching(1, ['gsample08b', 'rsample101']));
  assert.deepEqual(teacherDay(project, BRIGHTWATER, A)[1], teaching(1, ['gsample08b', 'rsample101']));
  slot(project, '8B', A, 1).teacherIds = [HALLORAN];
  assert.deepEqual(teacherDay(project, HALLORAN, A)[1], teaching(1, ['gsample08b', 'rsample101']));
  assert.deepEqual(teacherDay(project, BRIGHTWATER, A)[1], planning(1));
});

test('a teacher in two rooms: based in both, a group in each in one period', () => {
  const project = school();
  alsoBasedIn(project, 'Ms. Halloran', '102');
  assertValid(project);
  // Period 3 on A Days: 6A is in 101 and 7B is in 102
  const entry = teacherDay(project, HALLORAN, A)[2];
  assert.deepEqual(entry, teaching(2, ['gsample06a', 'rsample101'], ['gsample07b', 'rsample102']));
  assert.deepEqual(entryRoomIds(entry), ['rsample101', 'rsample102']);
  // naming the other teacher of 102 on the slot puts it right
  slot(project, '7B', A, 2).teacherIds = [BRIGHTWATER];
  assert.deepEqual(teacherDay(project, HALLORAN, A)[2], teaching(2, ['gsample06a', 'rsample101']));
});

test('groups in one period are listed in the school\'s own order, each once', () => {
  const project = school();
  // the Gym in Period 2 on B Days has 6C; add 6A and name the coach twice over
  slot(project, '6A', B, 1).room = 'rsamplegym';
  slot(project, '6C', B, 1).teacherIds = ['tsample004', 'tsample004'];
  assert.deepEqual(teacherDay(project, 'tsample004', B)[1], teaching(1, ['gsample06a', 'rsamplegym'], ['gsample06c', 'rsamplegym']));
  project.groups.reverse();
  assert.deepEqual(teacherDay(project, 'tsample004', B)[1], teaching(1, ['gsample06c', 'rsamplegym'], ['gsample06a', 'rsamplegym']));
});

test('the empty B Day: a teacher\'s B Day is their A Day', () => {
  const project = withEmptyBDay();
  for (const who of project.teachers) {
    assert.deepEqual(teacherDay(project, who.id, B), teacherDay(project, who.id, A), who.name);
  }
  assert.equal(teacherDay(project, HALLORAN, B)[1].kind, 'teaching');
});

test('an own B Day is worked out from B Day\'s slots', () => {
  const project = school();
  assert.deepEqual(teacherDay(project, HALLORAN, B).filter((entry) => entry.kind === 'teaching'), [
    teaching(1, ['gsample07b', 'rsample101']),
    teaching(6, ['gsample07a', 'rsample101']),
    teaching(7, ['gsample08a', 'rsample101']),
  ]);
});

test('a slot whose room is not in the building counts only for a teacher it names, with no room', () => {
  const project = school();
  // 8B is in Room 101 in Period 2; the room goes, the slot keeps its number
  Object.assign(slot(project, '8B', A, 1), { room: null, roomText: '101' });
  assert.deepEqual(teacherDay(project, HALLORAN, A)[1], planning(1));
  slot(project, '8B', A, 1).teacherIds = [HALLORAN];
  const entry = teacherDay(project, HALLORAN, A)[1];
  assert.deepEqual(entry, teaching(1, ['gsample08b', null, '101']));
  assert.deepEqual(entryRoomIds(entry), []);
  // and the same for a room id that names nothing
  Object.assign(slot(project, '8B', A, 1), { room: 'rnowhere00', roomText: '101' });
  assert.deepEqual(teacherDay(project, HALLORAN, A)[1], teaching(1, ['gsample08b', null, '101']));
});

// SV2-36 item 4
test('entryPlaces: a room that is not in the building is a place of its own, told apart by the number its slots kept', () => {
  const project = school();
  // Period 3 on A Days: Ms. Halloran has 6A in 101. Name her on 6B and 6C too,
  // whose rooms have gone and left their numbers behind
  Object.assign(slot(project, '6B', A, 2), { room: null, roomText: '999', teacherIds: [HALLORAN] });
  Object.assign(slot(project, '6C', A, 2), { room: 'rnowhere00', roomText: ' 999', teacherIds: [HALLORAN] });
  const entry = teacherDay(project, HALLORAN, A)[2];
  assert.deepEqual(entryPlaces(entry), [
    { roomId: 'rsample101', roomText: '', groupIds: ['gsample06a'] },
    { roomId: null, roomText: '999', groupIds: ['gsample06b', 'gsample06c'] },
  ], '"999" and " 999" are one place, as two room numbers that differ only by a space are one number');
  assert.deepEqual(entryRoomIds(entry), ['rsample101'], 'entryRoomIds still gives the rooms in the building only');
  // another number is another place
  slot(project, '6C', A, 2).roomText = '998';
  assert.deepEqual(entryPlaces(teacherDay(project, HALLORAN, A)[2]).map((place) => [place.roomId, place.roomText]), [['rsample101', ''], [null, '999'], [null, '998']]);
  // a slot with no room and no number is nowhere: a teacher named on it is teaching, in no place
  Object.assign(slot(project, '6C', A, 2), { room: null, roomText: '' });
  const nowhere = teacherDay(project, HALLORAN, A)[2];
  assert.equal(nowhere.groups.length, 3);
  assert.deepEqual(entryPlaces(nowhere).map((place) => place.groupIds), [['gsample06a'], ['gsample06b']]);
  assert.deepEqual(entryPlaces({ period: 0, groups: [], kind: 'planning' }), []);
});

test('a teacher or a day type that does not exist gives null, and a slot naming nobody known is passed over', () => {
  const project = school();
  assert.equal(teacherDay(project, 'tnobody000', A), null);
  assert.equal(teacherDay(project, HALLORAN, 'dnowhere00'), null);
  assert.equal(teacherDays(project, 'dnowhere00'), null);
  slot(project, '8B', A, 1).teacherIds = ['tnobody000'];
  const days = teacherDays(project, A);
  assert.deepEqual([...days.keys()], project.teachers.map((t) => t.id));
  assert.deepEqual(days.get(HALLORAN)[1], planning(1));
});

test('slotTeacherIds: the slot\'s own teachers, else the room\'s, else nobody', () => {
  const project = school();
  assert.deepEqual(slotTeacherIds(project, slot(project, '8B', A, 1)), [HALLORAN]);
  assert.deepEqual(slotTeacherIds(project, { room: 'rsample101', roomText: '', label: '', teacherIds: [OYELARAN] }), [OYELARAN]);
  assert.deepEqual(slotTeacherIds(project, { room: 'rsamplecaf', roomText: '', label: '', teacherIds: [] }), []);
  assert.deepEqual(slotTeacherIds(project, { room: null, roomText: '', label: '', teacherIds: [] }), []);
  assert.deepEqual(slotTeacherIds(project, undefined), []);
});

test('teacherMoves: a walk is two periods running, one room each, two different rooms', () => {
  const project = school();
  // Ms. Halloran has 6A in 101 in Period 3; name her on 6A's lunch in Period 4
  slot(project, '6A', A, 3).teacherIds = [HALLORAN];
  assert.deepEqual(teacherMoves(teacherDay(project, HALLORAN, A)), [{ period: 2, fromRoomId: 'rsample101', toRoomId: 'rsamplecaf' }]);
  // staying in one room is no walk: Periods 2 and 3 are both in 101
  assert.equal(teacherMoves(teacherDay(project, HALLORAN, A)).some((move) => move.period === 1), false);
  // a planning period between two rooms is no walk either
  slot(project, '6A', A, 3).teacherIds = [];
  slot(project, '6A', A, 4).teacherIds = [HALLORAN];
  assert.deepEqual(teacherMoves(teacherDay(project, HALLORAN, A)), []);
  // and a period spent in two rooms has no single place to walk from
  alsoBasedIn(project, 'Ms. Halloran', '102');
  slot(project, '6A', A, 4).teacherIds = [];
  const day = teacherDay(project, HALLORAN, A);
  assert.equal(entryRoomIds(day[2]).length, 2);
  assert.equal(teacherMoves(day).some((move) => move.period === 1 || move.period === 2), false);
});

test('the day comes out the same from a published model as from the project it was cut from', () => {
  const project = school();
  slot(project, '6A', A, 0).teacherIds = [OYELARAN, CASTELLANOS];
  const published = clone(project);
  published.format = 'sv2-published';
  for (const key of ['accepted', 'scenario', 'onboarding', 'created', 'modified']) delete published[key];
  delete published.building.zones;
  for (const g of published.groups) delete g.headCount;
  for (const dayTypeId of [A, B]) {
    for (const who of project.teachers) assert.deepEqual(teacherDay(published, who.id, dayTypeId), teacherDay(project, who.id, dayTypeId), who.name);
  }
});

test('teacherDay does not change the project', () => {
  const project = school();
  const before = clone(project);
  teacherDay(project, HALLORAN, A);
  teacherDays(project, B);
  assert.deepEqual(project, before);
});

// teacher-day.js is one of the modules a published file carries, joined by a
// linker that reads only simple forms (ARCHITECTURE 8).
test('teacher-day.js keeps to the linker rule', () => {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'teacher-day.js');
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*\/\//.test(line));
  let imports = 0;
  let exports = 0;
  for (const line of lines) {
    if (/^\s*import\b/.test(line)) {
      imports += 1;
      assert.match(line, /^import \{ [A-Za-z0-9_$, ]+ \} from '\.\/[a-z0-9-]+\.js';$/, line);
    }
    if (/^\s*export\b/.test(line)) {
      exports += 1;
      assert.match(line, /^export (async function|function|const|let|class) /, line);
    }
  }
  assert.equal(imports, 5);
  assert.ok(exports >= 6, 'the six functions are exported');
  const code = lines.join('\n');
  assert.doesNotMatch(code, /\bimport\s*\(/);
  assert.doesNotMatch(code, /import\.meta/);
  assert.doesNotMatch(code, /<\/script/i);
});

// ---------------------------------------------------------------- marks and duties (SV2-83)

const FIRST = 'u000000001';
const duty = (extra) => ({ id: FIRST, kind: 'duty', label: '', when: 'period', period: 0, start: '', end: '', dayTypeIds: [], weekdays: [], from: '', to: '', roomId: null, place: '', teacherIds: [HALLORAN], subjectIds: [], everyone: false, ...extra });
const mark = (extra) => ({ id: 'm000000001', kind: 'lunch', label: '', period: 0, dayTypeIds: [], scope: 'school', grades: [], groupIds: [], ...extra });

test('a school mark colours a teacher\'s empty period, each kind its own word', () => {
  for (const kind of ['lunch', 'advisory', 'activity', 'noclass']) {
    const project = school();
    project.marks = [mark({ kind, period: 0 })];
    const entry = teacherDay(project, HALLORAN, A)[0];
    assert.equal(entry.marked, kind);
    assert.equal(entry.kind, 'planning', 'the kind stays planning for callers that know two');
    assert.equal(isFree(entry), false, kind);
  }
});

test('marked is set only on planning entries: a teaching entry\'s is null whatever the school mark', () => {
  const project = school();
  project.marks = [mark({ kind: 'advisory', period: 1 })];
  const entry = teacherDay(project, HALLORAN, A)[1];
  assert.equal(entry.kind, 'teaching');
  assert.equal(entry.marked, null);
  assert.equal(isFree(entry), false, 'teaching is not free');
});

test('a Lunch mark for the group the teacher teaches takes the lesson away: the teacher is not teaching, and is free', () => {
  const project = school();
  project.marks = [mark({ kind: 'lunch', period: 1, scope: 'groups', groupIds: ['gsample08b'] })];
  const entry = teacherDay(project, HALLORAN, A)[1];
  assert.equal(entry.kind, 'planning');
  assert.deepEqual(entry.groups, []);
  assert.equal(entry.marked, null, 'a group\'s lunch is not the teacher\'s');
  assert.equal(isFree(entry), true);
});

test('a No class mark for the group empties the lesson on the day types it names, and B Day, the same as A Day, is its own case', () => {
  const project = school();
  project.dayTypes[1] = { ...project.dayTypes[1], own: false, sameAs: null };
  project.marks = [mark({ kind: 'noclass', period: 1, scope: 'groups', groupIds: ['gsample08b'], dayTypeIds: [A] })];
  assert.equal(teacherDay(project, HALLORAN, A)[1].kind, 'planning', 'A Day');
  assert.equal(teacherDay(project, HALLORAN, B)[1].kind, 'planning', 'B Day is the same as A Day, which the mark names');
  // the marks are indexed once per project object, so a changed project is a new object
  const named = { ...project, marks: [{ ...project.marks[0], dayTypeIds: [B] }] };
  assert.equal(teacherDay(named, HALLORAN, A)[1].kind, 'teaching', 'a mark naming B reaches B alone');
  assert.equal(teacherDay(named, HALLORAN, B)[1].kind, 'planning');
});

test('an always duty marks a free period with its kind, before a school mark', () => {
  const project = school();
  project.duties = [duty({ kind: 'meeting', period: 0 })];
  project.marks = [mark({ kind: 'lunch', period: 0 })];
  const entry = teacherDay(project, HALLORAN, A)[0];
  assert.equal(entry.marked, 'meeting');
  assert.deepEqual(entry.duties.map((d) => d.id), [FIRST]);
  assert.equal(isFree(entry), false);
});

test('a duty in a period the teacher teaches is listed and never marks it', () => {
  const project = school();
  project.duties = [duty({ period: 1 })];
  const entry = teacherDay(project, HALLORAN, A)[1];
  assert.equal(entry.kind, 'teaching');
  assert.equal(entry.marked, null);
  assert.equal(entry.duties.length, 1);
});

test('a duty that holds on some days is listed without a date and does not take the period from free', () => {
  const project = school();
  project.duties = [duty({ weekdays: [2], period: 0 })];
  const entry = teacherDay(project, HALLORAN, A)[0];
  assert.equal(entry.duties.length, 1, 'listed');
  assert.equal(entry.marked, null);
  assert.equal(isFree(entry), true);
});

test('given a date, a sometimes duty holds fully when it matches and is left out when not', () => {
  const project = school();
  project.duties = [duty({ weekdays: [2], period: 0, from: '2026-12-01', to: '2026-12-18' })];
  const wednesday = teacherDay(project, HALLORAN, A, { date: '2026-12-02' })[0];
  assert.equal(wednesday.marked, 'duty');
  assert.equal(wednesday.duties.length, 1);
  const thursday = teacherDay(project, HALLORAN, A, { date: '2026-12-03' })[0];
  assert.equal(thursday.marked, null);
  assert.deepEqual(thursday.duties, []);
  const after = teacherDay(project, HALLORAN, A, { date: '2026-12-23' })[0];
  assert.deepEqual(after.duties, []);
});

test('a bell schedule\'s off period is No class in a teacher\'s empty period', () => {
  const project = school();
  project.bellSchedules = [{ id: 'bsample001', name: 'Testing', short: '', bells: project.dayTypes[0].bells.map(() => null), off: [0] }];
  assert.equal(teacherDay(project, HALLORAN, A, { bellsId: 'bsample001' })[0].marked, 'noclass');
  assert.equal(teacherDay(project, HALLORAN, A)[0].marked, null, 'regular bells are untouched');
});

test('with no marks and no duties the entries are the same as before, apart from the two empty fields', () => {
  const project = school();
  const day = teacherDay(project, HALLORAN, A);
  for (const entry of day) {
    assert.deepEqual(entry.duties, []);
    assert.equal(entry.marked, null);
  }
});

test('isFree: planning and not marked; an entry from an older shape (no marked) reads as free', () => {
  assert.equal(isFree({ period: 0, groups: [], kind: 'planning' }), true);
  assert.equal(isFree({ period: 0, groups: [], kind: 'planning', duties: [], marked: 'lunch' }), false);
  assert.equal(isFree({ period: 0, groups: [{}], kind: 'teaching', duties: [], marked: null }), false);
  assert.equal(isFree(undefined), false);
});
