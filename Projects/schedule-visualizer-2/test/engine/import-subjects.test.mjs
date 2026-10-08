// Importing the subject list from a CSV file (spec 5.2, 5.6): node test/engine/import-subjects.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSubjectImport, applySubjectImport, subjectColumns, subjectSummaryText, NEW_SUBJECT_COLOUR } from '../../engine/import-subjects.js';
import { ImportError } from '../../engine/import-groups.js';
import { parse, write } from '../../engine/csv.js';
import { buildExport, subjectsRows } from '../../engine/exports.js';
import { createStore } from '../../engine/store.js';
import * as actions from '../../engine/actions.js';
import { school, makeIds, tickingClock, assertValid } from './helpers.mjs';

const HOSTILE = '<img src=x onerror=alert(1)> "Arts" & Crafts, 美術 =SUM(A1)';

const HEADER = ['Code', 'Subject', 'Colour'];

function rowsOf(...lines) {
  return [HEADER, ...lines];
}

function subject(project, code) {
  const found = project.subjects.find((candidate) => candidate.code === code);
  if (!found) throw new Error('no subject ' + code);
  return found;
}

test('the columns are found by their headers, in any order and whatever the capitals', () => {
  assert.deepEqual(subjectColumns(HEADER), { code: 0, name: 1, colour: 2 });
  assert.deepEqual(subjectColumns(['COLOR', ' subject  name ', 'Subject_Code', 'Rooms']), { code: 2, name: 1, colour: 0 });
  assert.deepEqual(subjectColumns(['Department']), { code: -1, name: 0, colour: -1 });
  assert.deepEqual(subjectColumns(['Teacher']), { code: -1, name: -1, colour: -1 });
});

test('the subjects export is the list in its order, named with the school and the date', () => {
  const project = school();
  assert.deepEqual(subjectsRows(project), [HEADER].concat(project.subjects.map((each) => [each.code, each.name, each.colour])));
  const file = buildExport(project, 'subjects', { date: '2026-09-01' });
  assert.equal(file.fileName, 'Marrowby Middle School (sample) - subjects - 2026-09-01.csv');
  assert.equal(file.mime, 'text/csv');
  assert.equal(file.text.charCodeAt(0), 0xfeff, 'a byte-order mark');
  assert.ok(file.text.endsWith('\r\n'));
  assert.deepEqual(parse(file.text).rows, subjectsRows(project));
});

test('the file the subjects export writes reads back as every subject on the list with nothing to change', () => {
  const project = school();
  const rows = parse(buildExport(project, 'subjects', { date: '2026-09-01' }).text).rows;
  const preview = previewSubjectImport(project, rows);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.counts, { create: 0, update: 0, same: project.subjects.length, skip: 0 });
  const applied = applySubjectImport(project, rows, makeIds(5));
  assert.equal(applied.project, project, 'nothing changed, so the very same project comes back');
  assert.equal(subjectSummaryText(applied.summary), project.subjects.length + ' subjects left unchanged');
});

test('a code is matched without regard to capitals or surrounding spaces, and the subject keeps its id, its code and its place', () => {
  const project = school();
  const math = subject(project, 'MATH');
  const at = project.subjects.indexOf(math);
  const rows = rowsOf(['  math ', 'Maths', '#ABCDEF']);
  const preview = previewSubjectImport(project, rows);
  assert.deepEqual(preview.rows.map((line) => [line.row, line.status, line.subjectId, line.code, line.name, line.colour, line.changes]), [[2, 'update', math.id, 'MATH', 'Maths', '#abcdef', ['name', 'colour']]]);
  const after = applySubjectImport(project, rows, makeIds(5)).project;
  assert.equal(after.subjects.length, project.subjects.length, 'a code in other capitals does not make a second subject');
  assert.deepEqual(after.subjects[at], { id: math.id, code: 'MATH', name: 'Maths', colour: '#abcdef' });
  after.subjects.forEach((each, index) => {
    if (index !== at) assert.equal(each, project.subjects[index], 'a subject the file does not change is the same object');
  });
  assert.equal(after.teachers, project.teachers, 'the teachers who use it are untouched, and still name it by id');
  assert.equal(after.building, project.building);
  assertValid(after);
});

test('a code that is not on the list is a new subject at the end, in the file\'s order, exactly as typed', () => {
  const project = school();
  const rows = rowsOf(['DRAMA', 'Drama', '#26f'], ['', 'Robotics', ''], ['tech', '', '2A6F97']);
  const applied = applySubjectImport(project, rows, makeIds(5));
  const added = applied.project.subjects.slice(project.subjects.length);
  assert.deepEqual(added.map((each) => [each.code, each.name, each.colour]), [
    ['DRAMA', 'Drama', '#2266ff'],
    ['', 'Robotics', NEW_SUBJECT_COLOUR],
    ['tech', '', '#2a6f97'],
  ]);
  for (const each of added) assert.match(each.id, /^s[a-z0-9]{9}$/);
  assert.deepEqual(applied.project.subjects.slice(0, project.subjects.length), project.subjects, 'the subjects already here keep their order');
  assert.deepEqual(applied.summary.created, ['Drama', 'Robotics', 'tech']);
  assert.equal(subjectSummaryText(applied.summary), '3 subjects added');
  assertValid(applied.project);
});

test('a row with no code is matched by its name; a row with a code is never matched by name', () => {
  const project = school();
  const math = subject(project, 'MATH');
  const byName = previewSubjectImport(project, rowsOf(['', ' ' + math.name.toUpperCase() + ' ', '#111111']));
  assert.deepEqual(byName.rows.map((line) => [line.status, line.subjectId, line.name, line.changes]), [['update', math.id, math.name, ['colour']]]);
  const coded = previewSubjectImport(project, rowsOf(['M2', math.name, '']));
  assert.deepEqual(coded.rows.map((line) => [line.status, line.subjectId]), [['create', null]], 'a new code is a new subject even under a name already here');
});

test('nothing is deleted: a subject not in the file stays, and an empty cell changes nothing', () => {
  const project = school();
  const math = subject(project, 'MATH');
  const applied = applySubjectImport(project, rowsOf(['MATH', '', '']), makeIds(5));
  assert.equal(applied.project, project);
  assert.deepEqual(applied.summary.unchanged, [math.name]);
  const named = applySubjectImport(project, rowsOf(['MATH', 'Maths', '']), makeIds(5)).project;
  assert.equal(named.subjects.length, project.subjects.length);
  assert.equal(subject(named, 'MATH').colour, math.colour, 'an empty colour cell leaves the colour');
});

test('a colour that cannot be read is left out, and the row says so', () => {
  const project = school();
  const math = subject(project, 'MATH');
  const rows = rowsOf(['MATH', '', 'teal'], ['DRAMA', 'Drama', 'rgb(1,2,3)']);
  const preview = previewSubjectImport(project, rows);
  assert.deepEqual(preview.rows.map((line) => [line.status, line.colour, line.warnings]), [
    ['same', math.colour, ['The colour "teal" is not written #rrggbb, so it was left out.']],
    ['create', NEW_SUBJECT_COLOUR, ['The colour "rgb(1,2,3)" is not written #rrggbb, so it was left out.']],
  ]);
  const applied = applySubjectImport(project, rows, makeIds(5));
  assert.equal(applied.summary.coloursLeftOut, 2);
  assertValid(applied.project);
});

test('a hostile name is stored exactly as the file has it, through the CSV and back', () => {
  const project = school();
  const text = write([HEADER, ['<b>', HOSTILE, '#123456']]);
  const applied = applySubjectImport(project, parse(text).rows, makeIds(5));
  const added = applied.project.subjects[project.subjects.length];
  assert.deepEqual([added.code, added.name, added.colour], ['<b>', HOSTILE, '#123456']);
  assert.deepEqual(applied.summary.created, [HOSTILE]);
  assertValid(applied.project);
  // out through the export and in again: the same subject, not a new one
  const again = previewSubjectImport(applied.project, parse(buildExport(applied.project, 'subjects', {}).text).rows);
  assert.deepEqual(again.rows[again.rows.length - 1].status, 'same');
  assert.equal(again.rows[again.rows.length - 1].subjectId, added.id);
  assert.equal(again.counts.create, 0);
});

test('rows that cannot be used are skipped with the reason: no code and no name, a subject twice, the header again; blank rows are passed over', () => {
  const project = school();
  const math = subject(project, 'MATH');
  const preview = previewSubjectImport(project, rowsOf(['', '', '#112233'], ['DRAMA', 'Drama', ''], ['', '', ''], [' drama', 'Theatre', ''], ['MATH', '', ''], ['', math.name, ''], HEADER.slice()));
  assert.deepEqual(preview.rows.map((line) => [line.row, line.status, line.reason]), [
    [2, 'skip', 'This row has no subject code and no subject name.'],
    [3, 'create', ''],
    [5, 'skip', 'This subject is already on row 3 of the file.'],
    [6, 'same', ''],
    [7, 'skip', 'This subject is already on row 6 of the file.'],
    [8, 'heading', 'The header row again.'],
  ]);
  assert.deepEqual(preview.counts, { create: 1, update: 0, same: 1, skip: 3 });
});

test('a file with no rows, or with neither a Code nor a Subject column, is refused whole and nothing changes', () => {
  const project = school();
  assert.match(previewSubjectImport(project, []).problems[0], /no rows/);
  assert.match(previewSubjectImport(project, [['Teacher', 'Rooms'], ['Ms. Halloran', '101']]).problems[0], /No column is headed "Code" or "Subject"/);
  assert.throws(() => applySubjectImport(project, [['Teacher'], ['Drama']], makeIds(5)), (error) => error instanceof ImportError && error.code === 'bad-file');
  assert.throws(() => actions.importSubjects(project, { rows: [['Teacher'], ['Drama']] }, { ids: makeIds(5) }), (error) => error instanceof actions.ActionError && error.code === 'bad-file' && /Subject/.test(error.message));
});

test('the preview changes nothing', () => {
  const project = school();
  const before = JSON.stringify(project);
  previewSubjectImport(project, rowsOf(['DRAMA', 'Drama', '#123456'], ['MATH', 'Maths', '#654321']));
  assert.equal(JSON.stringify(project), before);
});

test('importSubjects is one action and one undo entry, and undo puts everything back', () => {
  const project = school();
  const store = createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const rows = rowsOf(['DRAMA', 'Drama', '#123456'], ['MATH', 'Maths', ''], ['SCI', '', '']);
  const after = store.apply(actions.importSubjects, { rows });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import subjects: 1 subject added, 1 subject updated, 1 subject left unchanged');
  assert.equal(after.subjects.length, project.subjects.length + 1);
  assert.equal(subject(after, 'MATH').name, 'Maths');
  assertValid(after);
  // a file that changes nothing makes no entry
  store.apply(actions.importSubjects, { rows: rowsOf(['SCI', '', '']) });
  assert.equal(store.history.past.length, 1);
  store.undo();
  assert.deepEqual(store.project.subjects, project.subjects);
  assert.equal(store.history.past.length, 0);
});
