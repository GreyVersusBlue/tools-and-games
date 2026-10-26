// The calendar CSV (ARCHITECTURE 17.9): the calendar written one row per
// date, and any subset of dates read back as the dated changes that differ,
// refused whole for a name the project does not have. The calendar is the
// fixture's: A and B Days in rotation from 31 August 2026 to 11 June 2027,
// Early Release bells on Wednesdays, a Saturday make-up day, an Assembly on
// C Day, Thanksgiving, a snow day and a re-sync.

import test from 'node:test';
import assert from 'node:assert/strict';

import { calendarRows, calendarCsv, readCalendarCsv, importedCalendar, calendarImportText, CalendarImportError, CALENDAR_HEADER, NO_SCHOOL, NEXT_IN_ROTATION, REGULAR_BELLS } from '../../engine/import-calendar.js';
import { buildExport } from '../../engine/exports.js';
import { dayOn, calendarDays } from '../../engine/calendar.js';
import { parse } from '../../engine/csv.js';
import { validate } from '../../engine/validate.js';
import { withEverything, A, B, C, ER, AS } from '../fixtures/day-types-calendar.mjs';
import { school, clone } from './helpers.mjs';

const csv = (lines) => lines.join('\r\n') + '\r\n';
const HEADER = CALENDAR_HEADER.join(',');

function refusal(code, pattern) {
  return (error) => {
    assert.ok(error instanceof CalendarImportError, 'a CalendarImportError, got ' + error);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  };
}

// The project with the changes in place, as an action would put them.
function applied(project, result) {
  const next = { ...project, calendar: result.calendar };
  assert.deepEqual(validate(next), []);
  return next;
}

// ---------------------------------------------------------------- writing

test('the calendar is written one row per date: date, weekday, day type, bells, note', () => {
  const project = withEverything();
  const rows = calendarRows(project);
  assert.deepEqual(rows[0], ['Date', 'Weekday', 'Day type', 'Bells', 'Note']);
  assert.equal(rows.length, 1 + 285, '31 August 2026 to 11 June 2027');
  const at = (date) => rows.find((row) => row[0] === date);
  // a table a reader can check against the fixture by eye
  assert.deepEqual([
    at('2026-08-31'),
    at('2026-09-01'),
    at('2026-09-02'),
    at('2026-09-05'),
    at('2026-10-03'),
    at('2026-10-14'),
    at('2026-11-26'),
    at('2027-01-12'),
    at('2027-01-13'),
    at('2027-06-11'),
  ], [
    ['2026-08-31', 'Monday', 'A Day', 'Regular', ''],
    ['2026-09-01', 'Tuesday', 'B Day', 'Regular', ''],
    ['2026-09-02', 'Wednesday', 'A Day', 'Early Release', ''],
    ['2026-09-05', 'Saturday', 'No school', '', ''],
    ['2026-10-03', 'Saturday', dayName(project, '2026-10-03'), 'Regular', 'Make-up day'],
    ['2026-10-14', 'Wednesday', 'C Day', 'Assembly', 'Assembly'],
    ['2026-11-26', 'Thursday', 'No school', '', 'Thanksgiving'],
    ['2027-01-12', 'Tuesday', 'No school', '', 'Snow day'],
    ['2027-01-13', 'Wednesday', 'B Day', 'Regular', ''],
    ['2027-06-11', 'Friday', dayName(project, '2027-06-11'), 'Regular', ''],
  ]);
});

function dayName(project, date) {
  return project.dayTypes.find((dayType) => dayType.id === dayOn(project, date).dayTypeId).name;
}

test('the calendar CSV opens cleanly in a spreadsheet, and is an export like the others', () => {
  const project = withEverything();
  const text = calendarCsv(project);
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(text.startsWith('﻿' + HEADER + '\r\n2026-08-31,Monday,A Day,Regular,\r\n'));
  assert.equal(text.split('\r\n').length, 287, 'the header, 285 dates and the last line ending');
  const exported = buildExport(project, 'calendar', { date: '2026-09-01' });
  assert.equal(exported.text, text);
  assert.equal(exported.fileName, 'Marrowby Middle School (sample) - calendar - 2026-09-01.csv');
  assert.equal(exported.mime, 'text/csv');
});

test('with no calendar the file is the header alone', () => {
  assert.deepEqual(calendarRows(school()), [CALENDAR_HEADER]);
});

test('names are written exactly as typed, and read back to the same days', () => {
  const project = withEverything();
  project.dayTypes[2].name = 'Día "C", <b>';
  project.bellSchedules[1].name = '集会, =SUM(A1)';
  project.calendar.dates[2].label = 'Thanksgiving, "observed"';
  const text = calendarCsv(project);
  const row = parse(text).rows.find((cells) => cells[0] === '2026-10-14');
  assert.deepEqual(row, ['2026-10-14', 'Wednesday', 'Día "C", <b>', '集会, =SUM(A1)', 'Assembly']);
  assert.ok(text.includes('"Thanksgiving, ""observed"""'));
  const read = readCalendarCsv(project, text);
  assert.equal(read.counts.changes, 0);
});

// ---------------------------------------------------------------- reading

test('the file the tool wrote reads back to no change at all', () => {
  const project = withEverything();
  const read = readCalendarCsv(project, calendarCsv(project));
  assert.deepEqual(read.changes, []);
  assert.equal(read.calendar, project.calendar, 'the very same calendar');
  assert.deepEqual(read.counts, { rows: 285, changes: 0, same: 285, outside: 0 });
  assert.equal(read.movedFrom, null);
  assert.equal(calendarImportText(project, read), '285 dates are as the calendar has them');
});

test('a district\'s list of holidays, a date and a note, is enough: each becomes No school', () => {
  const project = withEverything();
  const text = csv(['Date,Holiday', '2026-12-21,Winter break', '2026-12-22,Winter break', '2026-11-26,Thanksgiving', '2026-12-26,Winter break']);
  const read = readCalendarCsv(project, text);
  assert.deepEqual(read.changes, [
    { date: '2026-12-21', day: 'closed', bells: null, label: 'Winter break' },
    { date: '2026-12-22', day: 'closed', bells: null, label: 'Winter break' },
    { date: '2026-12-26', day: null, bells: null, label: 'Winter break' },
  ], 'Thanksgiving is already so; a Saturday is already no school, as its weekday says, and takes the note');
  assert.deepEqual(read.counts, { rows: 4, changes: 3, same: 1, outside: 0 });
  assert.equal(read.movedFrom, null, 'two school days fewer: an A, B rotation comes round the same');
  assert.equal(readCalendarCsv(project, csv(['Date,Note', '2026-12-21,Winter break'])).movedFrom, '2026-12-22', 'one fewer moves every later day');
  const row = read.rows.find((line) => line.date === '2026-12-21');
  assert.deepEqual([row.row, row.status, row.before.school, row.after.school, row.after.label], [2, 'change', true, false, 'Winter break']);
  const next = applied(project, read);
  assert.equal(dayOn(next, '2026-12-21').school, false);
  assert.equal(dayOn(next, '2026-12-23').dayTypeId, dayOn(project, '2026-12-21').dayTypeId);
});

test('Next in the rotation, a day type, and No school, whatever the capitals and spaces', () => {
  const project = withEverything();
  const text = csv([HEADER, '2026-09-12,Saturday,next in the ROTATION,,Make-up day', '2026-09-14,Monday,b day,,', '2026-09-15,Tuesday,NO SCHOOL,,Teacher training']);
  const read = readCalendarCsv(project, text);
  assert.deepEqual(read.changes, [
    { date: '2026-09-12', day: 'rotation', bells: null, label: 'Make-up day' },
    { date: '2026-09-14', day: B, bells: null, label: '' },
    { date: '2026-09-15', day: 'closed', bells: null, label: 'Teacher training' },
  ]);
  const next = applied(project, read);
  assert.equal(dayOn(next, '2026-09-12').why, 'rotation');
  assert.deepEqual([dayOn(next, '2026-09-14').dayTypeId, dayOn(next, '2026-09-14').why], [B, 'date']);
});

test('a row that differs only in bells or note is a change whose day is null: as the weekday says', () => {
  const project = withEverything();
  const name = (date) => dayName(project, date);
  const read = readCalendarCsv(project, csv([HEADER, '2026-09-08,Tuesday,' + name('2026-09-08') + ',Assembly,', '2026-09-09,Wednesday,' + name('2026-09-09') + ',Regular,Picture day', '2026-09-10,Thursday,,,']));
  assert.deepEqual(read.changes, [
    { date: '2026-09-08', day: null, bells: AS, label: '' },
    { date: '2026-09-09', day: null, bells: 'regular', label: 'Picture day' },
  ], 'a blank day type with no note says nothing about the day');
  const next = applied(project, read);
  assert.deepEqual(calendarDays(next).map((day) => day.dayTypeId), calendarDays(project).map((day) => day.dayTypeId), 'no day type moves');
  assert.equal(read.movedFrom, null);
});

test('a date with a change of its own keeps what the row does not change', () => {
  const project = withEverything();
  const read = readCalendarCsv(project, csv(['Date,Day type,Bells,Note', '2026-10-14,C Day,,Whole-school assembly']));
  assert.deepEqual(read.changes, [{ date: '2026-10-14', day: C, bells: AS, label: 'Whole-school assembly' }]);
});

test('a blank note in a Note column takes a date\'s note away, and a change left saying nothing is taken away', () => {
  const project = withEverything();
  project.calendar.dates.push({ date: '2027-02-01', day: null, bells: null, label: 'Report cards' });
  assert.deepEqual(validate(project), []);
  const read = readCalendarCsv(project, csv([HEADER, '2027-02-01,Monday,,,']));
  assert.deepEqual(read.changes, [{ date: '2027-02-01', day: null, bells: null, label: '' }]);
  assert.equal(read.calendar.dates.some((entry) => entry.date === '2027-02-01'), false);
  applied(project, read);
});

test('a row setting a rotation day to the other day type puts the rotation there', () => {
  const project = withEverything();
  assert.equal(dayOn(project, '2026-09-03').dayTypeId, B);
  const read = readCalendarCsv(project, csv(['Date,Day type', '2026-09-03,A Day']));
  assert.deepEqual(read.changes, [{ date: '2026-09-03', day: A, bells: null, label: '' }]);
  assert.equal(read.movedFrom, '2026-09-04');
  assert.equal(dayOn(applied(project, read), '2026-09-04').dayTypeId, B, 'the next school day follows on from it');
});

test('bells on a row with no school say nothing', () => {
  const project = withEverything();
  const read = readCalendarCsv(project, csv([HEADER, '2026-09-05,Saturday,,Early Release,', '2026-11-26,Thursday,No school,Assembly,Thanksgiving']));
  assert.deepEqual(read.changes, []);
});

test('a date outside the calendar is passed over and counted', () => {
  const project = withEverything();
  const read = readCalendarCsv(project, csv(['Date,Note', '2026-08-30,Before', '2027-06-14,After', '2026-12-21,Winter break']));
  assert.deepEqual(read.counts, { rows: 3, changes: 1, same: 0, outside: 2 });
  assert.deepEqual(read.rows.filter((line) => line.status === 'outside').map((line) => line.date), ['2026-08-30', '2027-06-14']);
  assert.equal(calendarImportText(project, read), '1 date changes; 2 dates are outside the calendar, which runs from 31 August 2026 to 11 June 2027');
});

test('unknown day-type and bell-schedule names refuse the whole import, naming each with its rows', () => {
  const project = withEverything();
  const before = clone(project);
  const text = csv([HEADER, '2026-09-08,Tuesday,E Day,,', '2026-09-09,Wednesday,A Day,Testing,', '2026-09-10,Thursday,E Day,Regular,', '2026-12-21,Monday,,,Winter break']);
  assert.throws(() => readCalendarCsv(project, text), (error) => {
    refusal('unknown-names', /names a day type this project does not have: "E Day" \(rows 2, 4\); and a bell schedule this project does not have: "Testing" \(row 3\)\./)(error);
    assert.match(error.message, /nothing was changed/);
    assert.deepEqual(error.names, { dayTypes: ['E Day'], bells: ['Testing'] });
    return true;
  });
  assert.deepEqual(project, before, 'nothing it was given changed');
});

test('a row that is not as the format says refuses the whole import, naming the row', () => {
  const project = withEverything();
  assert.throws(() => readCalendarCsv(project, csv(['Date,Note', '2026-12-21,Winter break', '12/22/2026,Winter break'])), refusal('invalid', /Row 3: "12\/22\/2026" is not a date written YYYY-MM-DD/));
  assert.throws(() => readCalendarCsv(project, csv(['Date,Note', '2027-02-29,Leap'])), refusal('invalid', /Row 2: "2027-02-29" is not a date/));
  assert.throws(() => readCalendarCsv(project, csv(['Date,Note', '2026-12-21,Winter break', '2026-12-21,Again'])), refusal('invalid', /Row 3: 2026-12-21 is already on row 2/));
  assert.throws(() => readCalendarCsv(project, csv(['Date,Note', '2026-12-21,' + 'W'.repeat(61)])), refusal('invalid', /the note is 61 characters, and a note is at most 60/));
  assert.throws(() => readCalendarCsv(project, csv(['When,Note', '2026-12-21,Winter break'])), refusal('no-date-column', /has no Date column/));
  assert.throws(() => readCalendarCsv(project, '﻿\r\n\r\n'), refusal('empty'));
  assert.throws(() => readCalendarCsv(project, null), refusal('not-csv'));
  assert.throws(() => readCalendarCsv(school(), csv(['Date,Note', '2026-12-21,Winter break'])), refusal('no-calendar', /Make the calendar first/));
});

test('a blank row is passed over, and a note of 60 characters in any script is kept as typed', () => {
  const project = withEverything();
  const note = '冬'.repeat(60);
  const read = readCalendarCsv(project, csv(['Date,Note', ',', '2026-12-21,' + note]));
  assert.deepEqual(read.changes, [{ date: '2026-12-21', day: 'closed', bells: null, label: note }]);
});

test('importedCalendar puts changes in date order and leaves everything else alone', () => {
  const project = withEverything();
  const calendar = importedCalendar(project, [{ date: '2027-05-31', day: 'closed', bells: null, label: 'Memorial Day' }, { date: '2026-09-07', day: 'closed', bells: null, label: 'Labor Day' }]);
  assert.deepEqual(calendar.dates.map((entry) => entry.date), ['2026-09-07', '2026-10-03', '2026-10-14', '2026-11-26', '2027-01-12', '2027-01-13', '2027-05-31']);
  assert.equal(calendar.weekdays, project.calendar.weekdays);
  assert.equal(calendar.rotation, project.calendar.rotation);
  assert.equal(calendar.changedAt, project.calendar.changedAt, 'the action stamps it, not the reader');
});

test('the words the file uses are the planner\'s', () => {
  assert.deepEqual([NO_SCHOOL, NEXT_IN_ROTATION, REGULAR_BELLS], ['No school', 'Next in the rotation', 'Regular']);
  assert.equal(ER, 'bsample0er');
});

// ---------------------------------------------------------------- SV2-77b: the review's cases

// An older project may hold two day types whose names differ only in
// capitals or spaces (17.1: the rule lives in the actions, not validate).
function withSharedNames(name) {
  const project = withEverything();
  project.dayTypes[3].name = name;
  project.calendar.weekdays[4] = { day: project.dayTypes[3].id, bells: null };
  assert.deepEqual(validate(project), []);
  return project;
}

test('two day types whose names share a key: the name as written is matched first, so the tool\'s own file reads back to no change', () => {
  for (const name of ['ADay', 'A Day']) {
    const project = withSharedNames(name);
    const read = readCalendarCsv(project, calendarCsv(project));
    assert.deepEqual(read.changes, [], name + ': no Friday is turned into A Day (the review found 41)');
    assert.equal(read.counts.same, 285);
  }
  const project = withSharedNames('ADay');
  assert.deepEqual(readCalendarCsv(project, csv(['Date,Day type', '2026-09-03,ADay'])).changes, [{ date: '2026-09-03', day: project.dayTypes[3].id, bells: null, label: '' }]);
  assert.deepEqual(readCalendarCsv(project, csv(['Date,Day type', '2026-09-03,A Day'])).changes, [{ date: '2026-09-03', day: A, bells: null, label: '' }]);
});

test('two day types whose names share a key: a name written as neither is refused whole, naming both', () => {
  const project = withSharedNames('ADay');
  assert.throws(() => readCalendarCsv(project, csv(['Date,Day type', '2026-09-03,a day', '2026-09-04,B Day', '2026-09-08,A DAY'])), (error) => {
    refusal('unclear-names', /"a day" \(row 2\) could be "A Day" or "ADay"; "A DAY" \(row 4\) could be "A Day" or "ADay"\./)(error);
    assert.match(error.message, /nothing was changed/);
    assert.deepEqual(error.names, { dayTypes: ['a day', 'A DAY'] });
    return true;
  });
  // two written exactly alike, on a date that is neither
  const same = withSharedNames('A Day');
  assert.throws(() => readCalendarCsv(same, csv(['Date,Day type', '2026-09-05,A Day'])), refusal('unclear-names', /Row 2 names "A Day", and two day types are written so/));
});

test('a "Day type" column is taken before one headed "Day", and a "Day" column of weekdays is the weekday', () => {
  const project = withEverything();
  assert.equal(dayOn(project, '2026-12-02').dayTypeId, A);
  const both = readCalendarCsv(project, csv(['Date,Day,Day type,Note', '2026-12-02,Wednesday,B Day,']));
  assert.deepEqual(both.changes, [{ date: '2026-12-02', day: B, bells: null, label: '' }], 'not refused for a day type called "Wednesday"');
  const after = readCalendarCsv(project, csv(['Date,Day type,Day,Note', '2026-12-02,B Day,Wed,']));
  assert.deepEqual(after.changes, both.changes, 'wherever the columns stand');
  const weekdays = readCalendarCsv(project, csv(['Date,Day,Note', '2026-12-21,Monday,Winter break', '2026-12-22,tue,Winter break']));
  assert.deepEqual(weekdays.changes.map((change) => [change.date, change.day]), [['2026-12-21', 'closed'], ['2026-12-22', 'closed']]);
  const days = readCalendarCsv(project, csv(['Date,Day', '2026-12-02,B Day', '2026-12-03,Thursday']).replace('Thursday', ''));
  assert.deepEqual(days.changes, [{ date: '2026-12-02', day: B, bells: null, label: '' }], 'a "Day" column of day types is the day type');
});

test('with no Day type or Note column, the one other column is the note; with none, the file is refused', () => {
  const project = withEverything();
  for (const [header, row] of [['Date,Name', '2026-12-21,Winter break'], ['Date,Holiday Name', '2026-12-21,Winter break'], ['Weekday,Date,Holiday Name', 'Monday,2026-12-21,Winter break'], ['Date,Day,Name', '2026-12-21,Monday,Winter break']]) {
    assert.deepEqual(readCalendarCsv(project, csv([header, row])).changes, [{ date: '2026-12-21', day: 'closed', bells: null, label: 'Winter break' }], header);
  }
  const nothing = /^This file has no Day type or Note column, so there is nothing to read\.$/;
  assert.throws(() => readCalendarCsv(project, csv(['Date', '2026-12-21'])), refusal('nothing-to-read', nothing));
  assert.throws(() => readCalendarCsv(project, csv(['Date,Weekday', '2026-12-21,Monday'])), refusal('nothing-to-read', nothing));
  assert.throws(() => readCalendarCsv(project, csv(['Date,Name,Place', '2026-12-21,Winter break,Everywhere'])), refusal('nothing-to-read', nothing), 'two others: which is the note is not guessed');
  // a Bells column is something to read
  assert.deepEqual(readCalendarCsv(project, csv(['Date,Bells', '2026-12-01,Assembly'])).changes, [{ date: '2026-12-01', day: null, bells: AS, label: '' }]);
});
