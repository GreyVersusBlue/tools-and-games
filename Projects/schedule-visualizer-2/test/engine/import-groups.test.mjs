// Importing groups from CSV: the column guess, the mapping check, the
// preview, the three answers to a name clash, and the one action it all ends
// in. The CSV text goes through SV2-34's engine/csv.js unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, write } from '../../engine/csv.js';
import { guessColumns, checkMapping, previewImport, applyGroupImport, mergeGroups, summaryText, ImportError, ROLES, CLASH_POLICIES } from '../../engine/import-groups.js';
import { groupsRows, templateRows, csvText } from '../../engine/exports.js';
import * as actions from '../../engine/actions.js';
import { createStore } from '../../engine/store.js';
import { school, emptyProject, clone, makeIds, tickingClock, assertValid, group, room } from './helpers.mjs';

// The CSV fixtures for this suite live with the other format fixtures:
// csv.test.mjs holds test/fixtures/csv/ to exactly its own files.
const CSV_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'formats');
const fixture = (name) => parse(readFileSync(path.join(CSV_DIR, name), 'utf8')).rows;

const A = 'dsample00a';
const B = 'dsample00b';

const roles = (mapping) => mapping.map((item) => item.role);
const brief = (mapping) => mapping.map((item) => (item.role === 'period' ? 'p' + item.period + (item.dayTypeId ? '@' + item.dayTypeId : '') : item.role));

// The sample school with B Day made the same as A Day.
function sameAsA() {
  const project = school();
  project.dayTypes[1].own = false;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  for (const one of project.groups) delete one.days[B];
  assertValid(project);
  return project;
}

function importRows(project, rows, policy, mapping) {
  return applyGroupImport(project, rows, mapping || guessColumns(rows[0], project), policy, makeIds(11));
}

// ---------------------------------------------------------------- the guess

test('the guess finds the name, grade, colour, head count, day type and periods', () => {
  const header = ['Group', 'Grade', 'Colour', 'Head count', 'Day type', 'Period 1', 'Period 2', 'Period 8'];
  assert.deepEqual(brief(guessColumns(header, school())), ['name', 'grade', 'colour', 'headCount', 'dayType', 'p0', 'p1', 'p7']);
});

test('the guess reads other spellings of the same headers', () => {
  const header = [' group name ', 'YEAR', 'Color', 'Students', 'Day', 'P1', 'per. 2', '3rd period', '4'];
  assert.deepEqual(brief(guessColumns(header, school())), ['name', 'grade', 'colour', 'headCount', 'dayType', 'p0', 'p1', 'p2', 'p3']);
});

test('a column the guess does not understand is ignored and never taken for a period', () => {
  const header = ['Group', 'Advisor', 'Room', 'Notes', 'Lunch', 'Period notes', 'Phone 2', 'Bus 14', 'Period 1'];
  const mapping = guessColumns(header, school());
  assert.deepEqual(roles(mapping), ['name', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'ignore', 'period']);
  assert.equal(mapping.filter((item) => item.role === 'period').length, 1);
});

test('every role the guess gives is one of ROLES', () => {
  for (const item of guessColumns(['Group', 'x', 'Period 1', 'Day', 'Grade', 'Colour', 'Size'], school())) assert.ok(ROLES.includes(item.role), item.role);
});

test('the guess reads each of the four period words in the school\'s own form', () => {
  for (const [word, headers] of [['Period', ['Period 1', 'Period 2']], ['Mod', ['Mod 1', 'Mod 2']], ['Block', ['Block A', 'Block B']], ['Hour', ['1st Hour', '2nd Hour']]]) {
    const project = school();
    project.settings.periodWord = word;
    assert.deepEqual(brief(guessColumns(['Group'].concat(headers), project)), ['name', 'p0', 'p1'], word);
  }
});

test('a bare letter is a period only in a school that letters its periods', () => {
  const lettered = school();
  lettered.settings.periodWord = 'Block';
  assert.deepEqual(brief(guessColumns(['Group', 'A', 'B'], lettered)), ['name', 'p0', 'p1']);
  assert.deepEqual(brief(guessColumns(['Group', 'A', 'B'], school())), ['name', 'ignore', 'ignore']);
});

test('a period past the end of the school day is ignored, with the reason', () => {
  const mapping = guessColumns(['Group', 'Period 8', 'Period 9'], school());
  assert.deepEqual(brief(mapping), ['name', 'p7', 'ignore']);
  assert.match(mapping[2].note, /8 periods/);
});

test('a period header that names its day type belongs to that day type', () => {
  const header = ['Group', 'A Day Period 1', 'B Day Period 1', 'Period 2 (B Day)', 'b day: p3', 'Period 4 A Day'];
  assert.deepEqual(brief(guessColumns(header, school())), ['name', 'p0@' + A, 'p0@' + B, 'p1@' + B, 'p2@' + B, 'p3@' + A]);
});

test('a second run of the same period headers is the second day type, and a third run is ignored', () => {
  const mapping = guessColumns(['Group', 'P1', 'P2', 'P1', 'P2', 'P1'], school());
  assert.deepEqual(brief(mapping), ['name', 'p0@' + A, 'p1@' + A, 'p0@' + B, 'p1@' + B, 'ignore']);
  assert.match(mapping[5].note, /more runs of period columns than day types/);
});

test('with a day column the period columns carry no day type of their own', () => {
  const mapping = guessColumns(['Name', 'Day', '1', '2', '1'], school());
  assert.deepEqual(brief(mapping), ['name', 'dayType', 'p0', 'p1', 'ignore']);
});

test('a second name column is ignored and says why', () => {
  const mapping = guessColumns(['Group', 'Name', 'Period 1'], school());
  assert.deepEqual(roles(mapping), ['name', 'ignore', 'period']);
  assert.match(mapping[1].note, /already the group name/);
});

// ---------------------------------------------------------------- the mapping check

test('a mapping with no name column cannot be used, and the check says what to do', () => {
  const problems = checkMapping(school(), guessColumns(['Team', 'Period 1'], school()));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /No column is set as the group name/);
});

test('the check finds two name columns, a period twice, and a period that is not in the day', () => {
  const project = school();
  const mapping = guessColumns(['Group', 'Other', 'Period 1', 'Extra', 'Late'], project);
  mapping[1].role = 'name';
  Object.assign(mapping[3], { role: 'period', period: 0, dayTypeId: null });
  Object.assign(mapping[4], { role: 'period', period: 8, dayTypeId: null });
  const problems = checkMapping(project, mapping);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /Two columns are set as the group name/);
  assert.match(problems[1], /"Extra" is set as Period 1, and so is an earlier column/);
  assert.match(problems[2], /"Late" is set as a period that is not in the school day/);
});

test('a mapping the user corrected by hand is used as corrected', () => {
  const project = school();
  const rows = [['Team', 'Rm first', 'Period 2'], ['9Z', '101', '102']];
  const mapping = guessColumns(rows[0], project);
  assert.deepEqual(roles(mapping), ['ignore', 'ignore', 'period']);
  assert.equal(previewImport(project, rows, mapping).problems.length, 1);
  mapping[0].role = 'name';
  Object.assign(mapping[1], { role: 'period', period: 0 });
  const result = importRows(project, rows, undefined, mapping);
  assert.deepEqual(group(result.project, '9Z').days[A].slice(0, 2).map((slot) => slot.room), ['rsample101', 'rsample102']);
});

// ---------------------------------------------------------------- the preview

test('the preview reports creates, matches and unknown rooms row by row', () => {
  const project = school();
  const rows = fixture('groups-import.csv');
  const mapping = guessColumns(rows[0], project);
  assert.deepEqual(roles(mapping).filter((role) => role === 'ignore').length, 2, 'Advisor and Notes');
  const preview = previewImport(project, rows, mapping);
  assert.deepEqual(preview.problems, []);
  assert.deepEqual(preview.rows.map((line) => [line.row, line.status]), [[2, 'match'], [3, 'create'], [4, 'create'], [5, 'skip'], [6, 'create'], [7, 'skip']]);
  assert.deepEqual(preview.counts, { create: 3, match: 1, skip: 2, slots: 14, unknownRooms: 2 });
  assert.equal(preview.rows[0].groupId, 'gsample06a');
  assert.equal(preview.rows[1].name, 'The "Owls", <9A>');
  assert.equal(preview.rows[2].name, '七年级一班');
  assert.match(preview.rows[3].reason, /no group name/);
  assert.match(preview.rows[5].reason, /Row 6 already gave 8C its A Day/);
  // unknown rooms, each with the rows that name it
  assert.deepEqual(preview.unknownRooms, [{ text: '999', count: 1, rows: [3] }, { text: 'Annex 4', count: 1, rows: [4] }]);
  const owls = preview.rows[1].cells.find((cell) => cell.period === 2);
  assert.deepEqual([owls.text, owls.roomId, owls.unknown], ['999', null, true]);
  // a number matches whatever its capitals and spaces
  assert.deepEqual(preview.rows[2].cells.slice(0, 2).map((cell) => cell.roomId), ['rsamplegym', 'rsample103']);
  // a head count and a colour that cannot be read are warnings, not refusals
  assert.equal(preview.rows[2].warnings.length, 2);
  assert.match(preview.rows[2].warnings[0], /head count "twenty"/);
  assert.match(preview.rows[2].warnings[1], /colour "teal"/);
  assert.deepEqual(preview.groups[1].fields, { grade: '9', headCount: 31, colour: '#00aaff' });
});

test('the preview changes nothing', () => {
  const project = school();
  const before = clone(project);
  const rows = fixture('groups-import.csv');
  previewImport(project, rows, guessColumns(rows[0], project));
  assert.deepEqual(project, before);
});

test('a file with a day column gives each group one row per day type', () => {
  const project = school();
  const rows = fixture('groups-day-column.csv');
  const preview = previewImport(project, rows, guessColumns(rows[0], project));
  assert.deepEqual(preview.rows.map((line) => [line.status, line.dayTypeId]), [['create', A], ['create', B], ['create', null], ['skip', null]]);
  assert.match(preview.rows[3].reason, /day type "C Day" is not in this project. The day types are: A Day, B Day\./);
  const result = importRows(project, rows);
  const added = group(result.project, '9A');
  assert.deepEqual(added.days[A].slice(0, 2).map((slot) => slot.room), ['rsample101', 'rsample102']);
  assert.deepEqual(added.days[B].slice(0, 2).map((slot) => slot.room), ['rsample103', 'rsample201']);
  assert.equal(group(result.project, '9B').days[A][0].room, 'rsample202', 'no day type named: the first one');
  assertValid(result.project);
});

test('a file in blocks, a day type\'s name on a line of its own, fills each day type', () => {
  const project = school();
  const rows = fixture('groups-blocks.csv');
  const preview = previewImport(project, rows, guessColumns(rows[0], project));
  assert.deepEqual(preview.rows.map((line) => line.status), ['heading', 'create', 'create', 'heading', 'heading', 'create']);
  const result = importRows(project, rows);
  assert.deepEqual(group(result.project, '9A').days[A].slice(0, 2).map((slot) => slot.room), ['rsample101', 'rsample102']);
  assert.deepEqual(group(result.project, '9A').days[B].slice(0, 2).map((slot) => slot.room), ['rsample201', 'rsample202']);
  assert.deepEqual(result.summary.created, ['9A', '9B']);
});

test('a file with only a header imports nothing and says so', () => {
  const project = school();
  const result = importRows(project, [['Group', 'Period 1']]);
  assert.equal(result.project, project);
  assert.equal(summaryText(result.summary), 'nothing to import');
  assert.match(previewImport(project, [], guessColumns(['Group'], project)).problems[0], /no rows/);
});

// ---------------------------------------------------------------- the import

test('a room number that is not in the building is kept as typed and the project stays valid', () => {
  const rows = fixture('groups-import.csv');
  const result = importRows(school(), rows);
  assertValid(result.project);
  assert.deepEqual(group(result.project, 'The "Owls", <9A>').days[A][2], { room: null, roomText: '999', label: '', teacherIds: [] });
  assert.deepEqual(group(result.project, '七年级一班').days[A][2], { room: null, roomText: 'Annex 4', label: '', teacherIds: [] });
  assert.deepEqual(result.summary.unknownRooms, ['999', 'Annex 4']);
  assert.equal(result.summary.rowsSkipped, 2);
});

test('a new group takes the file\'s grade, head count and colour, and the next preset when it gives none', () => {
  const project = school();
  const result = importRows(project, fixture('groups-import.csv'));
  const owls = group(result.project, 'The "Owls", <9A>');
  assert.deepEqual([owls.grade, owls.headCount, owls.colour], ['9', 31, '#00aaff']);
  const other = group(result.project, '七年级一班');
  assert.deepEqual([other.grade, other.headCount], ['7', null]);
  assert.match(other.colour, /^#[0-9a-f]{6}$/);
  assert.ok(!project.groups.some((one) => one.colour === other.colour), 'a preset no group had');
  assert.match(owls.id, /^g[a-z0-9]{9}$/);
});

test('with no answer given, a group whose name is already here is skipped', () => {
  const project = school();
  const result = importRows(project, fixture('groups-import.csv'));
  assert.deepEqual(result.summary.skipped, ['6A']);
  assert.equal(group(result.project, '6A'), group(project, '6A'), 'the very same object');
  assert.deepEqual(result.summary.created, ['The "Owls", <9A>', '七年级一班', '8C']);
});

test('overwrite keeps the group\'s identity and replaces what the file gives', () => {
  const project = school();
  const before = group(project, '6A');
  before.days[A][0].label = 'Homeroom';
  before.days[A][0].teacherIds = ['tsample005'];
  before.days[A][1].teacherIds = ['tsample003'];
  assertValid(project);
  const rows = [['Group', 'Grade', 'Students', 'Period 1', 'Period 2'], ['6a', 'Sixth', '30', '201', 'Library']];
  const result = importRows(project, rows, { all: 'overwrite' });
  const after = group(result.project, '6A');
  assert.equal(after.id, 'gsample06a');
  assert.equal(after.name, '6A', 'the name here is kept as it was typed here');
  assert.deepEqual([after.grade, after.headCount, after.colour], ['Sixth', 30, before.colour]);
  // the room did not change: the slot is the same object, label and teacher kept
  assert.equal(after.days[A][0], before.days[A][0]);
  // the room changed: the teacher named for the old room goes
  assert.deepEqual(after.days[A][1], { room: 'rsamplelib', roomText: '', label: '', teacherIds: [] });
  // periods the file has no column for, and the other day type, are untouched
  assert.equal(after.days[A][2], before.days[A][2]);
  assert.equal(after.days[B], before.days[B]);
  assert.deepEqual(result.summary.overwritten, ['6A']);
  assertValid(result.project);
});

test('an empty cell in a mapped period column empties that period on overwrite', () => {
  const result = importRows(school(), [['Group', 'Period 1'], ['6A', '']], { all: 'overwrite' });
  assert.deepEqual(group(result.project, '6A').days[A][0], { room: null, roomText: '', label: '', teacherIds: [] });
});

test('rename imports under a new name: " (2)", then " (3)", or the name asked for', () => {
  const project = school();
  project.groups[1].name = '6A (2)';
  const rows = [['Group', 'Period 1'], ['6A', '101']];
  const numbered = importRows(project, rows, { all: 'rename' });
  assert.deepEqual(numbered.summary.renamed, [{ from: '6A', to: '6A (3)' }]);
  assert.equal(group(numbered.project, '6A (3)').days[A][0].room, 'rsample101');
  assert.equal(numbered.project.groups.length, project.groups.length + 1);
  const asked = importRows(project, rows, { all: 'rename', names: { '6a': 'Sixth, new' } });
  assert.equal(group(asked.project, 'Sixth, new').days[A][0].room, 'rsample101');
  assertValid(asked.project);
});

test('rename to a name that is taken, or to nothing, is refused and says what to do', () => {
  const rows = [['Group', 'Period 1'], ['6A', '101']];
  assert.throws(() => importRows(school(), rows, { all: 'rename', names: { '6a': '7a' } }), (error) => error instanceof ImportError && error.code === 'duplicate-name' && /already a group called "7a"/.test(error.message));
  assert.throws(() => importRows(school(), rows, { all: 'rename', names: { '6a': '  ' } }), (error) => error instanceof ImportError && error.code === 'no-name');
});

test('the answer can be given once for all and changed for one group', () => {
  const rows = [['Group', 'Grade'], ['6A', 'x'], ['6B', 'x'], ['6C', 'x']];
  const result = importRows(school(), rows, { all: 'overwrite', per: { '6b': 'skip', '6c': 'rename' } });
  assert.deepEqual([result.summary.overwritten, result.summary.skipped, result.summary.renamed], [['6A'], ['6B'], [{ from: '6C', to: '6C (2)' }]]);
  assert.equal(group(result.project, '6B').grade, '6');
  assert.equal(summaryText(result.summary), '1 group added, 1 group replaced, 1 group left as it was');
});

test('an answer that is not skip, overwrite or rename is refused', () => {
  assert.deepEqual(CLASH_POLICIES, ['skip', 'overwrite', 'rename']);
  assert.throws(() => importRows(school(), [['Group'], ['6A']], { all: 'merge' }), (error) => error instanceof ImportError && error.code === 'bad-policy');
});

test('an overwrite that changes nothing gives back the project it was given', () => {
  const project = school();
  const rows = parse(csvText(groupsRows(project))).rows;
  const result = importRows(project, rows, { all: 'overwrite' });
  assert.equal(result.project, project);
  assert.equal(result.summary.unchanged.length, project.groups.length);
});

test('rooms for a day type that is the same as the first make it its own copy, for every group', () => {
  const project = sameAsA();
  const rows = [['Group', 'A Day Period 1', 'B Day Period 1'], ['6A', '201', 'Gym'], ['9N', '101', '102']];
  const preview = previewImport(project, rows, guessColumns(rows[0], project));
  assert.deepEqual(preview.makesOwn, [B]);
  const result = importRows(project, rows, { all: 'overwrite' });
  assert.equal(result.project.dayTypes[1].own, true);
  assert.deepEqual(result.project.dayTypes[1].bells, project.dayTypes[0].bells, 'the bells start as the first day type\'s');
  assert.deepEqual(result.summary.madeOwn, ['B Day']);
  assert.equal(group(result.project, '6A').days[B][0].room, 'rsamplegym');
  assert.equal(group(result.project, '9N').days[B][0].room, 'rsample102');
  // a group the file does not name gets a copy of its own first day
  assert.deepEqual(group(result.project, '7A').days[B], group(project, '7A').days[A]);
  assertValid(result.project);
});

test('empty cells for a day type that is the same as the first leave it the same', () => {
  const project = sameAsA();
  const rows = parse(csvText(templateRows(project))).rows.concat([['9N', '9', '', '', '101'].concat(Array(15).fill(''))]);
  const preview = previewImport(project, rows, guessColumns(rows[0], project));
  assert.deepEqual(preview.makesOwn, []);
  const result = importRows(project, rows);
  assert.equal(result.project.dayTypes[1].own, false);
  assert.deepEqual(Object.keys(group(result.project, '9N').days), [A]);
  assertValid(result.project);
});

test('a skipped group does not make a day type its own copy', () => {
  const project = sameAsA();
  const result = importRows(project, [['Group', 'B Day Period 1'], ['6A', 'Gym']], { all: 'skip' });
  assert.equal(result.project, project);
  assert.deepEqual(result.summary.madeOwn, []);
});

test('an import leaves the building and every untouched group the very same objects', () => {
  const project = school();
  const result = importRows(project, [['Group', 'Period 1'], ['9N', '101']]);
  assert.equal(result.project.building, project.building);
  assert.equal(result.project.teachers, project.teachers);
  project.groups.forEach((one, index) => assert.equal(result.project.groups[index], one));
});

test('a name with quotes and a name in a non-Latin script survive the CSV unchanged, there and back', () => {
  const names = ['The "Owls", <9A>', '七年级一班', 'Ünïcödé — класс №7', '=SUM(A1)', ' padded '];
  const rows = [['Group', 'Period 1']].concat(names.map((name) => [name, '101']));
  const text = write(rows);
  const result = importRows(emptyProject(), parse(text).rows);
  assert.deepEqual(result.project.groups.map((one) => one.name), names);
  assertValid(result.project);
  // and out again through the export
  const back = parse(csvText(groupsRows(result.project))).rows.slice(1).map((row) => row[0]);
  assert.deepEqual(back, names);
});

test('mergeGroups ignores a day type the project does not have', () => {
  const project = school();
  const incoming = [{ name: '9N', fields: {}, days: { dnowhere00: [{ room: 'rsample101', roomText: '' }] } }];
  const result = mergeGroups(project, incoming, undefined, makeIds(4));
  assert.deepEqual(Object.keys(group(result.project, '9N').days), [A, B]);
  assertValid(result.project);
});

// ---------------------------------------------------------------- the action

test('importGroups is one action and one undo entry, and undo puts everything back', () => {
  const project = school();
  const store = createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const rows = fixture('groups-import.csv');
  const after = store.apply(actions.importGroups, { rows, mapping: guessColumns(rows[0], project), policy: { all: 'overwrite' } });
  assert.equal(store.history.past.length, 1);
  assert.equal(store.undoLabel, 'Import groups: 3 groups added, 1 group replaced');
  assert.equal(after.groups.length, project.groups.length + 3);
  const direct = actions.importGroups(project, { rows, mapping: guessColumns(rows[0], project), policy: { all: 'overwrite' } }, { ids: makeIds(5) });
  assert.deepEqual(actions.importOutcome(direct).created, ['The "Owls", <9A>', '七年级一班', '8C']);
  assert.equal(actions.importOutcome(project), null);
  assert.equal(store.scheduleVersion, 1);
  assert.equal(store.geometryVersion, 0);
  assertValid(after);
  store.undo();
  assert.deepEqual(store.project.groups, project.groups);
  assert.equal(store.project.groups[0], project.groups[0]);
});

test('importGroups with a mapping that cannot be used is refused and changes nothing', () => {
  const project = school();
  const store = createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const rows = [['Team', 'Period 1'], ['9N', '101']];
  assert.throws(() => store.apply(actions.importGroups, { rows, mapping: guessColumns(rows[0], project) }), (error) => error instanceof actions.ActionError && error.code === 'bad-mapping' && /No column is set as the group name/.test(error.message));
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
});

test('importGroups that changes nothing makes no undo entry', () => {
  const project = school();
  const store = createStore({ project, clock: tickingClock(), ids: makeIds(3) });
  const rows = [['Group', 'Period 1'], ['6A', '101']];
  store.apply(actions.importGroups, { rows, mapping: guessColumns(rows[0], project) });
  assert.equal(store.project, project);
  assert.equal(store.history.past.length, 0);
});

test('the room helper finds what the fixtures rely on', () => {
  assert.equal(room(school(), 'Gym').id, 'rsamplegym');
});
