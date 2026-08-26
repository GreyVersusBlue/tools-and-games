// The timetable: cohorts, teachers, sections and the packing that puts them in
// rooms. The point of the suite is the sentence the phase was written around —
// **it reports what it could not satisfy rather than quietly fudging it** — so
// most of what is asserted here is about a school that does not fit in its own
// building, which is the case a generator is easiest to be wrong about.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSampleSchool } from '../js/sample.js';
import { buildNav, teachingRooms } from '../js/navgraph.js';
import { buildingOccupancy, occupancyIndex } from '../js/occupancy.js';
import { normalizeSchedule } from '../js/schedule.js';
import {
  SUBJECTS, MAX_COHORTS, MAX_SECTIONS, BAND_GRADES,
  emptyTimetable, isEmptyTimetable, normalizeTimetable, periodsOf, timetableSummary,
  roomPool, poolIndex, buildTimetable, timetableIssues, bindRoom, bindTimetable, TEACHABLE, rollFor,
  parseCSV, importTimetableCSV, timetableCSV, timetablePlan, subjectEntry, gradeLabel,
} from '../js/timetable.js';

const SAMPLE = buildSampleSchool();
const NAV = buildNav(SAMPLE);
const OCC = buildingOccupancy(SAMPLE, { nav: NAV });
const POOL = roomPool(NAV, { occupancy: OCC });

// A pool with one of everything, for the packing tests that want a building
// that can actually satisfy a syllabus.
const fullPool = (n = 4) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `r0:s${i + 1}`, name: `Room ${101 + i}`, floor: 0, area: 900, use: 'classroom', capacity: 30, x: i * 40, z: 0 });
  }
  out.push({ id: 'r0:s90', name: 'Science Lab', floor: 0, area: 1200, use: 'lab', capacity: 24, x: 0, z: 60 });
  out.push({ id: 'r0:s91', name: 'Gymnasium', floor: 0, area: 5600, use: 'gym', capacity: 112, x: 100, z: 60 });
  out.push({ id: 'r0:s92', name: 'Band Room', floor: 0, area: 1400, use: 'stage', capacity: 93, x: 200, z: 60 });
  return out;
};

test('the subject table only ever wants a room kind the occupancy table knows', () => {
  const { GROUP_KEYS } = { GROUP_KEYS: OCC.byUse.map((u) => u.use) };
  for (const s of SUBJECTS) {
    assert.ok(s.key && s.label && s.wants, `${s.key}: incomplete`);
    // Not asserted against this building's uses — against the vocabulary
    // itself, which is what `classify` produces and what a room record's
    // `group` is allowed to be.
    assert.ok(typeof s.wants === 'string' && s.wants.length > 2);
    assert.equal(subjectEntry(s.key), s);
  }
  assert.equal(subjectEntry('nonsense'), null);
  assert.ok(GROUP_KEYS.length >= 0);
});

test('normalizeTimetable clamps, drops orphans and never throws', () => {
  assert.deepEqual(normalizeTimetable(undefined), emptyTimetable());
  assert.deepEqual(normalizeTimetable('nonsense'), emptyTimetable());
  assert.ok(isEmptyTimetable(normalizeTimetable(null)));

  const t = normalizeTimetable({
    cohorts: [{ id: 'c1', name: '9-1', grade: 9, size: 26 }, { id: 'c1', name: 'dupe' }, { name: 'no id' }],
    teachers: [{ id: 't1', name: 'Ms. Ashdown', subject: 'math' }, { id: 't2', subject: 'nonsense' }],
    sections: [
      { id: 's1', period: 1, cohort: 'c1', teacher: 't1', subject: 'math', room: 'r0:s1' },
      // A section naming a cohort the file doesn't contain: dropped, because
      // every reader downstream joins on that id.
      { id: 's2', period: 1, cohort: 'ghost', room: 'r0:s2' },
      { id: 's3', period: 999, cohort: 'c1', teacher: 'ghost', subject: 'nope' },
    ],
  });
  assert.equal(t.cohorts.length, 1, 'a duplicate id and an id-less cohort both dropped');
  assert.equal(t.teachers.length, 2);
  assert.equal(t.teachers[1].subject, null, 'an unknown subject reads as none');
  assert.equal(t.sections.length, 2, 'the orphan section is gone');
  assert.equal(t.sections[1].period, 12, 'a period past the end of the day is clamped into it');
  assert.equal(t.sections[1].teacher, null, 'a teacher the file does not list is no teacher');
  assert.equal(periodsOf(t), 12);
});

test('a hostile timetable cannot be a denial of service', () => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const t = normalizeTimetable({
    cohorts: many(MAX_COHORTS * 3, (i) => ({ id: `c${i}`, size: 1e9 })),
    sections: many(MAX_SECTIONS * 2, (i) => ({ id: `s${i}`, cohort: 'c0', period: 1 })),
  });
  assert.equal(t.cohorts.length, MAX_COHORTS);
  assert.equal(t.sections.length, MAX_SECTIONS);
  assert.ok(t.cohorts[0].size <= 400, 'a cohort of a billion is clamped');
});

test('the room pool agrees with the occupancy the report printed', () => {
  const index = occupancyIndex(OCC);
  assert.ok(POOL.length > 0, 'the sample school has teaching rooms');
  // A subset of the graph's teaching rooms, not all of them: `teachingRooms`
  // filters by size and name and lets a 300 ft² Main Office through, and an
  // office is not somewhere a maths lesson goes.
  assert.ok(POOL.length <= teachingRooms(NAV).length);
  for (const r of POOL) {
    assert.ok(TEACHABLE.includes(r.use), `${r.name}: ${r.use} is not a teaching space`);
  }
  const unfiltered = roomPool(NAV, { occupancy: OCC, teachable: false });
  assert.equal(unfiltered.length, teachingRooms(NAV).length);
  for (const r of POOL) {
    const row = index.get(r.id);
    assert.ok(row, `${r.id} is not a room the analysis knows`);
    assert.equal(r.capacity, row.occ, `${r.name}: the pool and the report disagree`);
    assert.equal(r.use, row.use);
  }
});

test('cohorts add up to the roll, and are named for the band', () => {
  for (const [band, grades] of Object.entries(BAND_GRADES)) {
    for (const students of [37, 200, 613]) {
      const tt = buildTimetable(fullPool(30), { students, classSize: 25, band, periods: 6 });
      const total = tt.cohorts.reduce((n, c) => n + c.size, 0);
      assert.equal(total, students, `${band}/${students}: the roll went missing`);
      for (const c of tt.cohorts) {
        assert.ok(grades.includes(c.grade), `${c.name}: a grade this band does not have`);
        assert.ok(c.name.startsWith(gradeLabel(c.grade)));
      }
    }
  }
});

test('a generated timetable never double-books a room, a teacher or a cohort', () => {
  for (const seed of [1, 2, 7, 99]) {
    const pool = fullPool(6);
    const tt = buildTimetable(pool, { students: 300, classSize: 25, periods: 7, seed, teachers: 40 });
    const issues = timetableIssues(tt, pool);
    assert.equal(issues.roomClash.length, 0, `seed ${seed}: two sections in one room`);
    assert.equal(issues.teacherClash.length, 0, `seed ${seed}: a teacher in two places`);
    assert.equal(issues.cohortClash.length, 0, `seed ${seed}: a cohort in two places`);
  }
});

test('every cohort has somewhere to be in every period, or the packing says so', () => {
  const pool = fullPool(6);
  const tt = buildTimetable(pool, { students: 300, classSize: 25, periods: 7, seed: 4, teachers: 40 });
  const periods = periodsOf(tt);
  for (const c of tt.cohorts) {
    const mine = tt.sections.filter((s) => s.cohort === c.id);
    assert.equal(mine.length, periods, `${c.name}: a period with no section at all`);
  }
  const issues = timetableIssues(tt, pool);
  // Twelve cohorts and nine rooms: three of them have nowhere to go every
  // period, and the honest answer is to list them rather than to invent a room.
  assert.ok(issues.unplaced.length > 0, 'a school short of rooms should say so');
  for (const s of issues.unplaced) assert.equal(s.room, null);
});

test('the same seed is the same timetable, and a different one is not', () => {
  const pool = fullPool(8);
  const opts = { students: 250, classSize: 25, periods: 6, teachers: 30 };
  const a = buildTimetable(pool, { ...opts, seed: 5 });
  const b = buildTimetable(pool, { ...opts, seed: 5 });
  const c = buildTimetable(pool, { ...opts, seed: 6 });
  assert.deepEqual(a, b, 'a seeded timetable is not reproducible');
  assert.notDeepEqual(a.sections, c.sections);
});

test('a school teaches what it has rooms for, and does not report the rest as a mismatch', () => {
  // Nothing but classrooms: no lab, no gym, no stage. A packing that insisted
  // on the whole syllabus would file a finding per science lesson about a
  // building whose only fault is being a corridor of classrooms.
  const plain = fullPool(8).filter((r) => r.use === 'classroom');
  const tt = buildTimetable(plain, { students: 150, classSize: 25, periods: 6, seed: 2, teachers: 30 });
  const issues = timetableIssues(tt, plain);
  assert.equal(issues.mismatched.length, 0);
  const subjects = new Set(tt.sections.map((s) => s.subject));
  for (const key of subjects) assert.equal(subjectEntry(key).wants, 'classroom');
});

test('a lab subject takes the lab when there is one', () => {
  const pool = fullPool(4);
  const tt = buildTimetable(pool, { students: 100, classSize: 25, periods: 7, seed: 3, teachers: 30 });
  const science = tt.sections.filter((s) => subjectEntry(s.subject).wants === 'lab');
  assert.ok(science.length > 0, 'a building with a lab should teach science in it');
  for (const s of science) {
    if (!s.room) continue;
    assert.equal(poolIndex(pool).get(s.room).use, 'lab', 'science somewhere that is not a lab');
  }
});

test('a class bigger than the room is a finding, not a rounding', () => {
  const tiny = [{ id: 'r0:s1', name: 'Seminar', floor: 0, area: 200, use: 'classroom', capacity: 10, x: 0, z: 0 }];
  const tt = buildTimetable(tiny, { students: 30, classSize: 30, periods: 2, seed: 1 });
  const issues = timetableIssues(tt, tiny);
  assert.ok(issues.over.length > 0);
  assert.equal(issues.over[0].room.capacity, 10);
  assert.equal(issues.over[0].size, 30);
});

test('a staff establishment too small for the day leaves sections unstaffed', () => {
  const pool = fullPool(8);
  const plenty = buildTimetable(pool, { students: 250, classSize: 25, periods: 6, seed: 8, teachers: 200 });
  const thin = buildTimetable(pool, { students: 250, classSize: 25, periods: 6, seed: 8, teachers: 3 });
  assert.equal(timetableIssues(plenty, pool).unstaffed.length, 0);
  assert.ok(timetableIssues(thin, pool).unstaffed.length > 0);
  assert.ok(thin.teachers.length <= 3);
  // ...and it is still never a teacher in two rooms at once.
  assert.equal(timetableIssues(thin, pool).teacherClash.length, 0);
});

// ---------- binding ----------

test('a room binds by id first, then by name, then by room number', () => {
  const pool = fullPool(3);
  assert.equal(bindRoom(pool, 'r0:s1').id, 'r0:s1', 'an id is an id');
  assert.equal(bindRoom(pool, 'Science Lab').id, 'r0:s90');
  assert.equal(bindRoom(pool, '  science lab  ').id, 'r0:s90', 'case and space do not matter');
  assert.equal(bindRoom(pool, '102').id, 'r0:s2', 'a bare room number finds "Room 102"');
  assert.equal(bindRoom(pool, 'Room 404'), null);
  assert.equal(bindRoom(pool, ''), null);
  assert.equal(bindRoom(pool, null), null);
});

test('a binding survives a rename, which is the whole point of the id', () => {
  const pool = fullPool(3);
  const tt = buildTimetable(pool, { students: 60, classSize: 25, periods: 4, seed: 1, teachers: 20 });
  const before = tt.sections.map((s) => s.room);
  const renamed = pool.map((r) => ({ ...r, name: r.name ? `${r.name} (renamed)` : r.name }));
  const { timetable, lost } = bindTimetable(tt, renamed);
  assert.equal(lost, 0, 'a rename lost a section');
  assert.deepEqual(timetable.sections.map((s) => s.room), before);
});

test('a redrawn building rebinds by name, and a demolished room does not', () => {
  const pool = fullPool(3);
  const tt = buildTimetable(pool, { students: 60, classSize: 25, periods: 4, seed: 1, teachers: 20 });
  // Same names, new ids — a building generated again from the same brief.
  const redrawn = pool.map((r, i) => ({ ...r, id: `r0:s${500 + i}` }));
  const again = bindTimetable(tt, redrawn);
  assert.equal(again.lost, 0);
  for (const s of again.timetable.sections) {
    if (s.room) assert.ok(s.room.startsWith('r0:s5'), 'a section kept an id that no longer exists');
  }
  // ...and with the rooms gone entirely, the sections stay, unplaced, with the
  // names they were bound by — so a later rebinding can still find them.
  const gone = bindTimetable(tt, []);
  assert.ok(gone.lost > 0);
  assert.equal(gone.timetable.sections.length, tt.sections.length);
  assert.ok(gone.timetable.sections.some((s) => s.roomName));
});

// ---------- the spreadsheet ----------

test('parseCSV handles quotes, embedded commas and blank lines', () => {
  const rows = parseCSV('a,b,c\r\n"one, two",three,""\n\n"say ""hi""",x,y\n');
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['one, two', 'three', '']);
  assert.deepEqual(rows[2], ['say "hi"', 'x', 'y']);
  assert.equal(rows.length, 3, 'a blank line is not a row');
});

test('the Tools/ schedule template imports, binds and reports what it could not', () => {
  const pool = fullPool(3);
  const csv = [
    'Name,Grade,Color,Students,Block 1,Block 2,Block 3,Block 4',
    '6-1,6,#2563eb,24,101,Science Lab,r0:s3,Room 404',
    '6-2,6,#c2520f,,102,103,,Gymnasium',
    ',,,,,,,',
  ].join('\n');
  const read = importTimetableCSV(csv, pool, { classSize: 25 });
  assert.equal(read.error, null);
  assert.equal(read.rowCount, 2, 'the blank row is not a group');
  assert.equal(read.periods, 4);
  assert.deepEqual(read.periodLabels, ['Block 1', 'Block 2', 'Block 3', 'Block 4']);

  const tt = read.timetable;
  assert.equal(tt.cohorts[0].size, 24, 'the headcount column is read');
  assert.equal(tt.cohorts[1].size, 25, '...and a blank one falls back to the class size');
  assert.equal(tt.cohorts[0].grade, 6);

  const first = tt.sections.filter((s) => s.cohort === tt.cohorts[0].id);
  assert.equal(first.length, 4);
  assert.equal(first[0].room, 'r0:s1', 'a bare room number bound');
  assert.equal(first[1].room, 'r0:s90', 'a name bound');
  assert.equal(first[2].room, 'r0:s3', 'an id bound');
  assert.equal(first[3].room, null, 'a room this building does not have stayed unbound');
  assert.equal(first[3].roomName, 'Room 404', '...and kept what it was asked for');

  assert.equal(read.unbound.length, 1);
  assert.equal(read.unbound[0].token, 'Room 404');
  assert.equal(read.unbound[0].cohort, '6-1');

  // A blank cell is a free period, not an error and not a section.
  const second = tt.sections.filter((s) => s.cohort === tt.cohorts[1].id);
  assert.equal(second.length, 3);
  assert.deepEqual(second.map((s) => s.period), [1, 2, 4]);
});

test('an import with no header, no name column or no periods says which', () => {
  const pool = fullPool(2);
  assert.match(importTimetableCSV('', pool).error, /header/i);
  assert.match(importTimetableCSV('Name\n6-1', pool).error, /period/i);
  assert.match(importTimetableCSV('Group size,P1\n24,101', pool).error, /Name/);
});

test('a timetable round-trips through its own CSV', () => {
  const pool = fullPool(4);
  const tt = buildTimetable(pool, { students: 120, classSize: 25, periods: 5, seed: 11, teachers: 30 });
  const csv = timetableCSV(tt, pool);
  const back = importTimetableCSV(csv, pool, { classSize: 25 }).timetable;
  assert.equal(back.cohorts.length, tt.cohorts.length);
  const roomsOf = (t) => t.cohorts.map((c) => t.sections
    .filter((s) => s.cohort === c.id).sort((a, b) => a.period - b.period).map((s) => s.room));
  assert.deepEqual(roomsOf(back), roomsOf(tt), 'the school day changed on the way through a spreadsheet');
  for (const c of back.cohorts) {
    const was = tt.cohorts.find((x) => x.name === c.name);
    assert.equal(c.size, was.size);
    assert.equal(c.grade, was.grade);
  }
});

// ---------- the plan the crowd walks ----------

test('a plan is a room per period, index 0 is homeroom, and a gap is where you were', () => {
  const pool = fullPool(4);
  const sched = normalizeSchedule({ periods: 6 });
  const tt = normalizeTimetable({
    cohorts: [{ id: 'c1', name: '9-1', size: 24 }],
    sections: [
      { id: 's1', period: 2, cohort: 'c1', room: 'r0:s2' },
      { id: 's4', period: 4, cohort: 'c1', room: 'r0:s90' },
    ],
  });
  const plan = timetablePlan(tt, sched);
  assert.equal(plan.periods, 6);
  const c = plan.cohorts[0];
  assert.equal(c.rooms.length, 7, 'one slot per period plus homeroom');
  assert.equal(c.rooms[0], 'r0:s2', 'homeroom is where the day starts');
  assert.equal(c.rooms[1], 'r0:s2', 'a period before the first section is spent there');
  assert.equal(c.rooms[3], 'r0:s2', 'a free period is spent where you were');
  assert.equal(c.rooms[4], 'r0:s90');
  assert.equal(c.rooms[6], 'r0:s90', '...and so is the rest of the day');
  assert.ok(c.rooms.every((r) => r !== null), 'a null goal is a person standing in a corridor');
});

test('the plan carries teachers as well, following their own sections', () => {
  const pool = fullPool(4);
  const tt = buildTimetable(pool, { students: 100, classSize: 25, periods: 5, seed: 6, teachers: 30 });
  const plan = timetablePlan(tt, normalizeSchedule({ periods: 5 }));
  assert.ok(plan.teachers.length > 0);
  for (const t of plan.teachers) {
    assert.equal(t.rooms.length, 6);
    assert.ok(t.rooms.every((r) => r !== null));
  }
  // A teacher's period-p room is the room of a section the timetable gave them.
  const byId = new Map(tt.teachers.map((t) => [t.id, t]));
  for (const s of tt.sections) {
    if (!s.teacher || !s.room) continue;
    const row = plan.teachers.find((t) => t.id === s.teacher);
    if (s.period <= 5) assert.equal(row.rooms[s.period], s.room);
    assert.ok(byId.has(s.teacher));
  }
});

test('the sample school takes a timetable and the summary describes it', () => {
  const tt = buildTimetable(POOL, { students: 200, classSize: 25, periods: 6, band: 'middle', seed: 3, teachers: 20 });
  const sum = timetableSummary(tt);
  assert.equal(sum.students, 200);
  assert.equal(sum.periods, 6);
  assert.equal(sum.source, 'generated');
  assert.ok(sum.rooms > 0 && sum.rooms <= POOL.length);
  assert.equal(sum.sections, sum.cohorts * 6);
});

// ---------- the file ----------

test('a timetable is an append to v11: it round-trips, and a design without one writes no key', async () => {
  const { serialize, deserialize, SAVE_VERSION } = await import('../js/save-load.js');
  const state = buildSampleSchool();
  // Nothing added: the same bytes out as a build that predates this phase.
  assert.doesNotMatch(serialize(state), /timetable/);

  const tt = buildTimetable(POOL, { students: 200, classSize: 25, periods: 6, seed: 3, teachers: 20 });
  state.timetable = tt;
  const text = serialize(state);
  assert.match(text, /"timetable"/);
  assert.equal(JSON.parse(text).version, SAVE_VERSION, 'a timetable is not a version bump');

  const back = deserialize(text);
  assert.deepEqual(back.timetable, tt);

  // A file from a newer build with a timetable full of nonsense in it is a
  // design with no school day, never a design that will not open.
  const hostile = JSON.parse(text);
  hostile.timetable = { cohorts: 'not a list', sections: 42 };
  assert.equal(deserialize(JSON.stringify(hostile)).timetable, undefined);
});

test('the sections a file carries name rooms the file itself contains', async () => {
  const { serialize, deserialize } = await import('../js/save-load.js');
  const state = buildSampleSchool();
  state.timetable = buildTimetable(POOL, { students: 150, classSize: 25, periods: 5, seed: 2, teachers: 20 });
  const back = deserialize(serialize(state));
  const pool = roomPool(buildNav(back), { occupancy: buildingOccupancy(back, { nav: buildNav(back) }) });
  const ids = new Set(pool.map((r) => r.id));
  for (const s of back.timetable.sections) {
    if (s.room) assert.ok(ids.has(s.room), `${s.id} names ${s.room}, which is not in the file`);
  }
  assert.equal(timetableIssues(back.timetable, pool).missing.length, 0);
});

test('a roll is what a building can teach, not what it is allowed to hold', () => {
  const roll = rollFor(POOL, { classSize: 25, utilization: 0.85 });
  assert.equal(roll.rooms, POOL.length);
  assert.equal(roll.students, Math.round(POOL.length * 25 * 0.85));
  assert.match(roll.rule, /teaching rooms/);
  // The occupant load of the same rooms is the other number, and it is bigger:
  // a 900 ft² classroom is *allowed* forty-five people at 20 ft² each and is
  // *taught* twenty-five.
  const load = POOL.reduce((n, r) => n + r.capacity, 0);
  assert.ok(load > roll.students, 'the two numbers stopped disagreeing, which means one is wrong');
  assert.equal(rollFor([], {}).students, 0);
  assert.equal(rollFor(null, {}).students, 0);
  assert.equal(rollFor(POOL, { utilization: 5 }).utilization, 1, 'a room cannot be used twice at once');
});
