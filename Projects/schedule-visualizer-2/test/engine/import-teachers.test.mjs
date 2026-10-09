// Importing the teacher list from a CSV file (spec 5.3): node test/engine/import-teachers.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTeacherImport, applyTeacherImport, teacherColumns, teacherSummaryText } from '../../engine/import-teachers.js';
import { ImportError } from '../../engine/import-groups.js';
import { parse, write } from '../../engine/csv.js';
import { teachersRows } from '../../engine/exports.js';
import { createStore } from '../../engine/store.js';
import * as actions from '../../engine/actions.js';
import { school, makeIds, tickingClock, teacher, room, assertValid } from './helpers.mjs';

const HOSTILE = '<img src=x onerror=alert(1)> "Dr." O\'Brien-Ñandú, 王老师 =SUM(A1)';

const HEADER = ['Teacher', 'Subject code', 'Subject', 'Rooms', 'Notes'];

function rowsOf(...lines) {
  return [HEADER, ...lines];
}

test('the columns are found by their headers, in any order and whatever the capitals', () => {
  assert.deepEqual(teacherColumns(HEADER), { name: 0, subjectCode: 1, subject: 2, rooms: 3, notes: 4 });
  assert.deepEqual(teacherColumns(['NOTES', ' home  rooms ', 'Teacher_Name', 'Extension']), { name: 2, subjectCode: -1, subject: -1, rooms: 1, notes: 0 });
  assert.deepEqual(teacherColumns(['Staff']), { name: -1, subjectCode: -1, subject: -1, rooms: -1, notes: -1 });
});

test('the file the teachers export writes reads back as every teacher on the list with nothing to change', () => {
  const project = school();
  const rows = parse(write(teachersRows(project))).rows;
  const preview = previewTeacherImport(project, rows);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.counts, { create: 0, update: 0, same: 12, skip: 0, unknownRooms: 0 });
  const applied = applyTeacherImport(project, rows, makeIds(5));
  assert.equal(applied.project, project, 'nothing changed, so the very same project comes back');
  assert.equal(teacherSummaryText(applied.summary), '12 teachers left unchanged');
});

test('a name is matched without regard to capitals or surrounding spaces, and keeps the teacher\'s id and name', () => {
  const project = school();
  const preview = previewTeacherImport(project, rowsOf(['  MS. HALLORAN ', '', '', '', 'Mornings only']));
  assert.deepEqual(preview.rows.map((line) => [line.row, line.status, line.teacherId, line.name, line.changes]), [[2, 'update', 'tsample001', 'Ms. Halloran', ['notes']]]);
  const after = applyTeacherImport(project, rowsOf(['  MS. HALLORAN ', '', '', '', 'Mornings only']), makeIds(5)).project;
  assert.equal(after.teachers.length, 12, 'renaming by capitals does not make a second teacher');
  assert.deepEqual(after.teachers[0], { ...project.teachers[0], notes: 'Mornings only' });
  assert.equal(after.teachers[1], project.teachers[1], 'a teacher the file does not change is the same object');
  assert.equal(after.building, project.building);
});

test('a new name is a new teacher, with the subject found by code or by name and the rooms by number', () => {
  const project = school();
  const rows = rowsOf(['Mx. Oakhollow', 'sci', '', ' 102 ; GYM', 'Part time'], ['Mr. Thistlewood', '', 'physical education', '', ''], ['Ms. Fennimore', 'Mathematics', '', '', '']);
  const applied = applyTeacherImport(project, rows, makeIds(5));
  const added = applied.project.teachers.slice(12);
  assert.deepEqual(added.map((one) => [one.name, one.subjectId, one.roomIds, one.notes]), [
    ['Mx. Oakhollow', 'ssample003', ['rsample102', 'rsamplegym'], 'Part time'],
    ['Mr. Thistlewood', 'ssample008', [], ''],
    ['Ms. Fennimore', 'ssample001', [], ''],
  ]);
  for (const one of added) assert.match(one.id, /^t[a-z0-9]{9}$/);
  assert.deepEqual(room(applied.project, '102').teacherIds, ['tsample002', added[0].id], 'the room lists the new teacher after the one it had');
  assert.ok(room(applied.project, 'Gym').teacherIds.includes(added[0].id));
  assert.equal(applied.project.building.floors[2], project.building.floors[2], 'a floor with no room in the file is the same object');
  assert.deepEqual(applied.summary.created, ['Mx. Oakhollow', 'Mr. Thistlewood', 'Ms. Fennimore']);
  assert.equal(teacherSummaryText(applied.summary), '3 teachers added');
  assertValid(applied.project);
});

test('nothing is deleted: a teacher not in the file stays, an empty cell changes nothing, and rooms are added, never taken away', () => {
  const project = school();
  const halloran = teacher(project, 'Ms. Halloran');
  const applied = applyTeacherImport(project, rowsOf(['Ms. Halloran', '', '', '103', '']), makeIds(5));
  const after = teacher(applied.project, 'Ms. Halloran');
  assert.equal(applied.project.teachers.length, 12);
  assert.deepEqual(after.roomIds, ['rsample101', 'rsample103'], 'Room 101 is kept and Room 103 added');
  assert.equal(after.subjectId, halloran.subjectId, 'an empty subject cell does not clear the subject');
  assert.equal(after.notes, halloran.notes);
  assert.deepEqual(room(applied.project, '103').teacherIds, ['tsample003', 'tsample001']);
  assert.equal(teacherSummaryText(applied.summary), '1 teacher updated');
  assertValid(applied.project);
});

test('a subject or a room that is not in the project is left out, and the row says so', () => {
  const project = school();
  const preview = previewTeacherImport(project, rowsOf(['Mx. Oakhollow', 'DRAMA', 'Drama', '102; 999; Annex 4', ''], ['Mr. Thistlewood', '', '', '999', '']));
  assert.equal(preview.rows[0].subjectId, null);
  assert.deepEqual(preview.rows[0].roomIds, ['rsample102']);
  assert.deepEqual(preview.rows[0].warnings, [
    'The subject "DRAMA" is not on the subject list, so it was left out. Add the subject first, or pick it for the teacher afterwards.',
    'Room "999" is not in the building, so it was left out.',
    'Room "Annex 4" is not in the building, so it was left out.',
  ]);
  assert.deepEqual(preview.unknownRooms, [{ text: '999', count: 2, rows: [2, 3] }, { text: 'Annex 4', count: 1, rows: [2] }]);
  assert.deepEqual(preview.counts, { create: 2, update: 0, same: 0, skip: 0, unknownRooms: 2 });
  const applied = applyTeacherImport(project, rowsOf(['Mx. Oakhollow', 'DRAMA', 'Drama', '102; 999; Annex 4', '']), makeIds(5));
  assert.deepEqual([applied.summary.unknownRooms, applied.summary.unknownSubjects], [['999', 'Annex 4'], 1]);
  assertValid(applied.project);
});

test('a hostile name is stored exactly as the file has it, through the CSV and back', () => {
  const project = school();
  const text = write([HEADER, [HOSTILE, 'MATH', '', '101', '<b>notes</b> & "quotes"\nsecond line']]);
  const applied = applyTeacherImport(project, parse(text).rows, makeIds(5));
  const added = applied.project.teachers[12];
  assert.equal(added.name, HOSTILE);
  assert.equal(added.notes, '<b>notes</b> & "quotes"\nsecond line');
  assert.deepEqual(applied.summary.created, [HOSTILE]);
  assertValid(applied.project);
  // and a second import of the same file finds that teacher, not a new one
  const again = previewTeacherImport(applied.project, parse(text).rows);
  assert.deepEqual(again.rows.map((line) => [line.status, line.teacherId]), [['same', added.id]]);
});

test('rows that cannot be used are skipped with the reason: no name, a name twice, the header again; blank rows are passed over', () => {
  const project = school();
  const preview = previewTeacherImport(project, rowsOf(['', 'MATH', '', '', ''], ['Mx. Oakhollow', '', '', '', ''], ['', '', '', '', ''], [' mx. oakhollow', 'SCI', '', '', ''], HEADER.slice()));
  assert.deepEqual(preview.rows.map((line) => [line.row, line.status, line.reason]), [
    [2, 'skip', 'This row has no teacher name.'],
    [3, 'create', ''],
    [5, 'skip', 'This teacher is already on row 3 of the file.'],
    [6, 'heading', 'The header row again.'],
  ]);
  assert.deepEqual(preview.counts, { create: 1, update: 0, same: 0, skip: 2, unknownRooms: 0 });
});

test('a file with no rows, or no column headed Teacher, is refused whole and nothing changes', () => {
  const project = school();
  assert.match(previewTeacherImport(project, []).problems[0], /no rows/);
  assert.match(previewTeacherImport(project, [['Staff', 'Rooms'], ['Ms. Halloran', '101']]).problems[0], /No column is headed "Teacher"/);
  assert.throws(() => applyTeacherImport(project, [['Staff'], ['Mx. Oakhollow']], makeIds(5)), (error) => error instanceof ImportError && error.code === 'bad-file');
  assert.throws(() => actions.importTeachers(project, { rows: [['Staff'], ['Mx. Oakhollow']] }, { ids: makeIds(5) }), (error) => error instanceof actions.ActionError && error.code === 'bad-file' && /Teacher/.test(error.message));
});

test('the preview changes nothing', () => {
  const project = school();
  const before = JSON.stringify(project);
  previewTeacherImport(project, rowsOf(['Mx. Oakhollow', 'SCI', '', '102', 'x'], ['Ms. Halloran', 'SCI', '', '103', 'y']));
  assert.equal(JSON.stringify(project), before);
});

test('importTeachers is one action and one undo entry, and undo puts everything back', () => {
  const project = school();
  const store = createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const rows = rowsOf(['Mx. Oakhollow', 'SCI', '', '102', ''], ['Ms. Halloran', '', '', '', 'Mornings only'], ['Mr. Brightwater', '', '', '', '']);
  const after = store.apply(actions.importTeachers, { rows });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import teachers: 1 teacher added, 1 teacher updated, 1 teacher left unchanged');
  assert.deepEqual(store.undoOutcome.created, ['Mx. Oakhollow']);
  assert.equal(after.teachers.length, 13);
  assert.deepEqual([store.buildingVersion, store.scheduleVersion, store.geometryVersion], [1, 1, 0], 'no route is thrown away');
  assertValid(after);
  store.undo();
  assert.deepEqual(store.project.teachers, project.teachers);
  assert.equal(store.project.building, project.building);
  // a file that changes nothing is not an undo entry
  store.apply(actions.importTeachers, { rows: rowsOf(['Mr. Brightwater', '', '', '', '']) });
  assert.equal(store.history.past.length, 0);
});
