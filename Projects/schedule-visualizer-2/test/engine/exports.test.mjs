// Every CSV and JSON export: the layouts, names written exactly as typed,
// the file names, and that the groups CSV and the template read straight
// back in through the importer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../../engine/csv.js';
import { EXPORT_KINDS, NOT_IN_BUILDING, PLANNING, buildExport, csvText, exportFileName, groupsHeader, groupsRows, templateRows, teachersRows, roomsRows, teacherGridRows, roomGridRows } from '../../engine/exports.js';
import { guessColumns, previewImport, applyGroupImport } from '../../engine/import-groups.js';
import { readProjectFile, readBuildingFile, readScheduleFile } from '../../engine/project-file.js';
import { teacherDay } from '../../engine/teacher-day.js';
import { school, emptyProject, clone, makeIds, assertValid, group, room, teacher } from './helpers.mjs';

const A = 'dsample00a';
const B = 'dsample00b';
const HOSTILE = ['The "Owls", <9A>', '七年级一班', 'Ms. O\'Fennimore & <b>co</b>', 'line\nbreak', '=1+1', '-dash', ' padded '];
const OPTIONS = { date: '2026-09-01' };

function row(rows, first) {
  const found = rows.find((candidate) => candidate[0] === first);
  assert.ok(found, 'no row starting ' + first);
  return found;
}

function sameAsA() {
  const project = school();
  project.dayTypes[1].own = false;
  project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
  for (const one of project.groups) delete one.days[B];
  assertValid(project);
  return project;
}

// ---------------------------------------------------------------- groups and the template

test('the groups header has the four group columns, then every period of every day type', () => {
  const header = groupsHeader(school());
  assert.deepEqual(header.slice(0, 5), ['Group', 'Grade', 'Head count', 'Colour', 'A Day Period 1']);
  assert.equal(header.length, 4 + 16);
  assert.equal(header[12], 'B Day Period 1');
});

test('with one day type the period columns carry no day type name', () => {
  const project = emptyProject();
  project.dayTypes = [project.dayTypes[0]];
  project.settings.periods = 3;
  project.dayTypes[0].bells = [null, null, null];
  assert.deepEqual(groupsHeader(project), ['Group', 'Grade', 'Head count', 'Colour', 'Period 1', 'Period 2', 'Period 3']);
});

test('the template matches the current periods and day types, for every period word', () => {
  for (const word of ['Period', 'Mod', 'Block', 'Hour']) {
    for (const periods of [1, 6, 16]) {
      const project = emptyProject();
      project.settings.periodWord = word;
      project.settings.periods = periods;
      const rows = templateRows(project);
      assert.equal(rows.length, 1, 'the header alone');
      assert.equal(rows[0].length, 4 + periods * project.dayTypes.length);
      // every column of it is understood when the filled-in file comes back
      const mapping = guessColumns(parse(csvText(rows)).rows[0], project);
      assert.deepEqual(mapping.map((item) => item.role), ['name', 'grade', 'headCount', 'colour'].concat(Array(periods * 2).fill('period')), word + ' ' + periods);
      assert.deepEqual(mapping.filter((item) => item.role === 'period').map((item) => [item.dayTypeId, item.period]), project.dayTypes.flatMap((dayType) => Array.from({ length: periods }, (unused, period) => [dayType.id, period])));
    }
  }
});

test('the template opens cleanly in a spreadsheet: a byte-order mark, CRLF, one line', () => {
  const text = buildExport(school(), 'groups-template', OPTIONS).text;
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(text.endsWith('B Day Period 8\r\n'));
  assert.equal(text.split('\r\n').length, 2);
});

test('the groups CSV has one row per group with room numbers as typed', () => {
  const rows = groupsRows(school());
  assert.equal(rows.length, 9);
  assert.deepEqual(row(rows, '6A'), ['6A', '6', '24', '#d1495b', '201', '103', '101', 'Cafeteria', '302', '303', '204', '203', '201', '204', 'Gym', 'Cafeteria', '102', 'Library', '301', '303']);
});

test('a slot in a room that is not in the building exports its text, and an empty head count is empty', () => {
  const project = school();
  group(project, '6A').days[A][0] = { room: null, roomText: 'Annex 4', label: '', teacherIds: [] };
  group(project, '6A').headCount = null;
  assert.deepEqual(row(groupsRows(project), '6A').slice(2, 5), ['', '#d1495b', 'Annex 4']);
});

test('a day type that is the same as the first exports empty cells, so reading the file back leaves it so', () => {
  const project = sameAsA();
  const rows = groupsRows(project);
  assert.deepEqual(row(rows, '6A').slice(12), Array(8).fill(''));
  const back = parse(csvText(rows)).rows;
  const result = applyGroupImport(project, back, guessColumns(back[0], project), { all: 'overwrite' }, makeIds(2));
  assert.equal(result.project, project);
});

test('the groups CSV read back into the project it came from matches every group and changes nothing', () => {
  const project = school();
  const back = parse(buildExport(project, 'groups', OPTIONS).text).rows;
  const preview = previewImport(project, back, guessColumns(back[0], project));
  assert.deepEqual(preview.counts, { create: 0, match: 8, skip: 0, slots: 128, unknownRooms: 0 });
  assert.equal(applyGroupImport(project, back, guessColumns(back[0], project), { all: 'overwrite' }, makeIds(2)).project, project);
});

test('the groups CSV read into a project with the same building and no groups rebuilds every day', () => {
  const project = school();
  const bare = { ...clone(project), groups: [] };
  const back = parse(buildExport(project, 'groups', OPTIONS).text).rows;
  const result = applyGroupImport(bare, back, guessColumns(back[0], bare), undefined, makeIds(2));
  const rooms = (one) => [one.name, one.grade, one.headCount, one.colour, one.days[A].map((slot) => slot.room), one.days[B].map((slot) => slot.room)];
  assert.deepEqual(result.project.groups.map(rooms), project.groups.map(rooms));
});

// ---------------------------------------------------------------- teachers and rooms

test('the teachers CSV lists each teacher with subject, rooms and notes', () => {
  const project = school();
  teacher(project, 'Ms. Halloran').notes = 'Part time, mornings';
  const rows = teachersRows(project);
  assert.deepEqual(rows[0], ['Teacher', 'Subject code', 'Subject', 'Rooms', 'Notes']);
  assert.equal(rows.length, 13);
  assert.deepEqual(row(rows, 'Ms. Halloran'), ['Ms. Halloran', 'MATH', 'Mathematics', '101', 'Part time, mornings']);
  assert.deepEqual(row(rows, 'Mme. Dufrêne').slice(0, 4), ['Mme. Dufrêne', 'LANG', 'World Languages', '204']);
});

test('a teacher with two rooms lists both, and one with no subject has empty subject cells', () => {
  const project = school();
  const halloran = teacher(project, 'Ms. Halloran');
  halloran.roomIds.push('rsample102');
  room(project, '102').teacherIds.push(halloran.id);
  halloran.subjectId = null;
  assertValid(project);
  assert.deepEqual(row(teachersRows(project), 'Ms. Halloran'), ['Ms. Halloran', '', '', '101; 102', '']);
});

test('the rooms CSV lists every room on every floor with its properties', () => {
  const rows = roomsRows(school());
  assert.deepEqual(rows[0], ['Room', 'Floor', 'Teachers', 'Subject code', 'Subject', 'Wing', 'Capacity', 'Shared space', 'Doors']);
  assert.equal(rows.length, 14);
  assert.deepEqual(row(rows, '101'), ['101', 'Floor 1', 'Ms. Halloran', 'MATH', 'Mathematics', 'West', '30', 'No', '1']);
  assert.deepEqual(row(rows, 'Cafeteria'), ['Cafeteria', 'Floor 1', '', '', '', '', '150', 'Yes', '2']);
  assert.equal(row(rows, '303')[1], 'Floor 3');
});

// ---------------------------------------------------------------- the grids

test('the teacher grid has one row per teacher per day type, from the one rule for a teacher\'s day', () => {
  const project = school();
  const rows = teacherGridRows(project);
  assert.deepEqual(rows[0], ['Teacher', 'Day type', 'Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5', 'Period 6', 'Period 7', 'Period 8']);
  assert.equal(rows.length, 1 + 12 * 2);
  const halloran = rows.find((candidate) => candidate[0] === 'Ms. Halloran' && candidate[1] === 'A Day');
  assert.deepEqual(halloran.slice(2, 5), [PLANNING, '8B · 101', '6A · 101']);
  // every cell agrees with teacherDay about teaching or planning
  for (const line of rows.slice(1)) {
    const who = teacher(project, line[0]);
    const dayType = project.dayTypes.find((candidate) => candidate.name === line[1]);
    teacherDay(project, who.id, dayType.id).forEach((entry, period) => {
      assert.equal(line[2 + period] === PLANNING, entry.kind === 'planning', line[0] + ' ' + line[1] + ' period ' + period);
    });
  }
});

test('the teacher grid shows a teacher named on a slot, two groups at once, and a room that is not in the building', () => {
  const project = school();
  const halloran = teacher(project, 'Ms. Halloran');
  group(project, '6A').days[A][0] = { room: null, roomText: 'Annex 4', label: '', teacherIds: [halloran.id] };
  group(project, '6B').days[A][0].teacherIds = [halloran.id];
  assertValid(project);
  const line = teacherGridRows(project, A).find((candidate) => candidate[0] === 'Ms. Halloran');
  assert.equal(line[2], '6A · Annex 4; 6B · 203');
});

test('the room grid lists the groups in each room, a double-booking as it is', () => {
  const rows = roomGridRows(school(), A);
  assert.deepEqual(rows[0].slice(0, 4), ['Room', 'Floor', 'Day type', 'Period 1']);
  assert.equal(rows.length, 14);
  assert.deepEqual(row(rows, '203').slice(0, 5), ['203', 'Floor 2', 'A Day', '6B', '6C; 7C']);
  assert.equal(row(rows, 'Cafeteria')[3 + 3], '6A; 6B; 6C');
});

test('the room grid ends with the room numbers that are not in the building', () => {
  const project = school();
  group(project, '6A').days[A][0] = { room: null, roomText: 'Annex 4', label: '', teacherIds: [] };
  group(project, '7A').days[A][0] = { room: null, roomText: 'Annex 4', label: '', teacherIds: [] };
  const rows = roomGridRows(project, A);
  assert.deepEqual(rows[rows.length - 1].slice(0, 4), ['Annex 4', NOT_IN_BUILDING, 'A Day', '6A; 7A']);
});

test('a day type that is the same as the first reads the same in both grids', () => {
  const project = sameAsA();
  const strip = (rows, at) => rows.slice(1).map((line) => line.slice(0, at).concat(line.slice(at + 1)));
  assert.deepEqual(strip(teacherGridRows(project, B), 1), strip(teacherGridRows(project, A), 1));
  assert.deepEqual(strip(roomGridRows(project, B), 2), strip(roomGridRows(project, A), 2));
  assert.equal(teacherGridRows(project).length, 25, 'both day types when none is chosen');
});

// ---------------------------------------------------------------- text is data

test('hostile names come out of every CSV export exactly as typed', () => {
  const project = school();
  project.groups.slice(0, HOSTILE.length).forEach((one, index) => { one.name = HOSTILE[index]; });
  project.teachers.slice(0, HOSTILE.length).forEach((one, index) => { one.name = HOSTILE[index]; });
  project.building.floors[0].name = HOSTILE[0];
  room(project, '101').number = HOSTILE[2];
  room(project, '102').wing = HOSTILE[3];
  project.dayTypes[1].name = '<i>B</i>, "Day"';
  assertValid(project);
  const cells = (kind) => parse(buildExport(project, kind, OPTIONS).text).rows.flat();
  for (const name of HOSTILE) {
    assert.ok(cells('groups').includes(name), 'groups: ' + name);
    assert.ok(cells('teachers').includes(name), 'teachers: ' + name);
    assert.ok(cells('teacher-grid').includes(name), 'teacher grid: ' + name);
  }
  assert.ok(cells('rooms').includes(HOSTILE[0]) && cells('rooms').includes(HOSTILE[2]) && cells('rooms').includes(HOSTILE[3]));
  assert.ok(cells('room-grid').includes(HOSTILE[2]) && cells('room-grid').includes('<i>B</i>, "Day"'));
  assert.ok(cells('groups').includes('<i>B</i>, "Day" Period 1'));
  // parse(write(rows)) gives back the very rows
  for (const rows of [groupsRows(project), teachersRows(project), roomsRows(project), teacherGridRows(project), roomGridRows(project)]) {
    assert.deepEqual(parse(csvText(rows)).rows, rows);
  }
});

test('the formula guard is off unless asked for, and then marks only cells a spreadsheet would run', () => {
  const project = school();
  project.groups[0].name = '=1+1';
  const plain = parse(buildExport(project, 'groups', OPTIONS).text).rows;
  assert.equal(plain[1][0], '=1+1');
  const guarded = parse(buildExport(project, 'groups', { ...OPTIONS, guard: true }).text).rows;
  assert.equal(guarded[1][0], '\'=1+1');
  assert.equal(guarded[2][0], '6B');
});

test('every CSV export starts with a byte-order mark and ends each line with CRLF', () => {
  for (const kind of EXPORT_KINDS.filter((name) => buildExport(school(), name, OPTIONS).mime === 'text/csv')) {
    const text = buildExport(school(), kind, OPTIONS).text;
    assert.equal(text.charCodeAt(0), 0xfeff, kind);
    assert.ok(text.endsWith('\r\n'), kind);
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, kind);
  }
});

// ---------------------------------------------------------------- buildExport

test('every export is named with the school, what it is and the date', () => {
  const names = EXPORT_KINDS.map((kind) => buildExport(school(), kind, OPTIONS).fileName);
  assert.deepEqual(names, [
    'Marrowby Middle School (sample) - groups - 2026-09-01.csv',
    'Marrowby Middle School (sample) - groups template - 2026-09-01.csv',
    'Marrowby Middle School (sample) - teachers - 2026-09-01.csv',
    'Marrowby Middle School (sample) - rooms - 2026-09-01.csv',
    'Marrowby Middle School (sample) - teachers by period - 2026-09-01.csv',
    'Marrowby Middle School (sample) - rooms by period - 2026-09-01.csv',
    'Marrowby Middle School (sample) - schedule - 2026-09-01.json',
    'Marrowby Middle School (sample) - building - 2026-09-01.json',
    'Marrowby Middle School (sample) - project - 2026-09-01.json',
    'Marrowby Middle School (sample) - subjects - 2026-09-01.csv',
  ]);
});

test('a file name uses the tool\'s name for a school with none, and leaves out what a file system refuses', () => {
  const project = school();
  project.settings.schoolName = '';
  assert.equal(exportFileName(project, 'groups', 'csv', '2026-09-01'), 'Schedule Visualizer 2 - groups - 2026-09-01.csv');
  project.settings.schoolName = ' St. <Mary\'s>: "North/South" | 東校? * . ';
  assert.equal(exportFileName(project, 'project', 'json', '2026-09-01'), 'St. Mary\'s North South 東校 - project - 2026-09-01.json');
  assert.equal(project.settings.schoolName, ' St. <Mary\'s>: "North/South" | 東校? * . ', 'the name itself is untouched');
  assert.equal(exportFileName(project, 'project', 'json'), 'St. Mary\'s North South 東校 - project.json');
});

test('a file name takes the day from a Date', () => {
  // noon UTC is the same day in every zone from UTC-12 to UTC+11
  assert.equal(exportFileName(school(), 'rooms', 'csv', new Date('2026-09-01T12:00:00Z')), 'Marrowby Middle School (sample) - rooms - 2026-09-01.csv');
});

test('the three JSON exports are the files the readers read', () => {
  const project = school();
  assert.deepEqual(readProjectFile(buildExport(project, 'project', OPTIONS).text).project, project);
  assert.equal(readBuildingFile(buildExport(project, 'building', OPTIONS).text).summary.rooms, 13);
  assert.equal(readScheduleFile(buildExport(project, 'schedule', OPTIONS).text).summary.groups, 8);
  assert.equal(buildExport(project, 'project', OPTIONS).mime, 'application/json');
});

test('an export of a kind that does not exist is refused', () => {
  assert.throws(() => buildExport(school(), 'pdf', OPTIONS), TypeError);
});

test('no export changes the project', () => {
  const project = school();
  const before = clone(project);
  for (const kind of EXPORT_KINDS) buildExport(project, kind, OPTIONS);
  assert.deepEqual(project, before);
});
