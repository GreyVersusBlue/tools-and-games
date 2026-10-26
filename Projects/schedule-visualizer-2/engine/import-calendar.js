// The calendar CSV (ARCHITECTURE 17.9; FORMATS.md "The calendar CSV"): the
// calendar written out one row per date, and a list of dates read back in.
//
//   calendarRows(project)           → rows, the header first: one per date of the range
//   calendarCsv(project, options)   → the text of those rows
//   readCalendarCsv(project, text)  → { changes, calendar, rows, counts, movedFrom }
//   importedCalendar(project, changes) → the calendar with the changes in place
//
// The columns are Date, Weekday, Day type, Bells and Note. What the tool
// writes is the calendar as it works out, date by date (calendar.js `dayOn`),
// so a spreadsheet shows every school day's day type and bells. What it reads
// is any subset of dates, in the same columns, of which only Date is needed:
// a district's list of holidays is enough. A row becomes a dated change only
// where it differs from what the calendar already gives that date; a row that
// agrees changes nothing, so the file the tool wrote reads back to no change.
//
// Reading takes nothing on trust and changes nothing: a file with a date that
// is not one, or a name this project does not have, is refused whole with a
// CalendarImportError saying what and where (spec 3.7). Putting the result in
// place, as one undo step stamped with the store's clock, is an action's job.

import { parse, write } from './csv.js';
import { calendarOf, bellSchedulesOf, spacelessKey, textLength, DAY_ROTATION, DAY_CLOSED, BELLS_REGULAR, WEEKDAY_NAMES, DATE_LABEL_MOST } from './schema.js';
import { calendarDays, isCalendarDate, dateWords } from './calendar.js';

export const CALENDAR_HEADER = ['Date', 'Weekday', 'Day type', 'Bells', 'Note'];

// The words a cell may hold besides a name. They are compared without regard
// to capitals or spaces, and are taken before any name that reads the same.
export const NO_SCHOOL = 'No school';
export const NEXT_IN_ROTATION = 'Next in the rotation';
export const REGULAR_BELLS = 'Regular';

const NO_SCHOOL_KEY = spacelessKey(NO_SCHOOL);
const ROTATION_KEY = spacelessKey(NEXT_IN_ROTATION);
const REGULAR_KEYS = [spacelessKey(REGULAR_BELLS), spacelessKey('Regular bells')];

// Headers a reader may meet, compared without regard to capitals or spaces.
const COLUMN_WORDS = {
  date: ['date'],
  weekday: ['weekday', 'day of the week', 'dayoftheweek'],
  day: ['day type', 'daytype', 'day'],
  bells: ['bells', 'bell schedule', 'bellschedule', 'bell'],
  note: ['note', 'notes', 'label', 'event', 'holiday', 'description'],
};

export class CalendarImportError extends Error {
  constructor(message, code, names) {
    super(message);
    this.name = 'CalendarImportError';
    this.code = code || 'refused';
    // for 'unknown-names': { dayTypes: [text], bells: [text] }, as typed;
    // for 'unclear-names': { dayTypes: [text] }
    this.names = names || null;
  }
}

function schedulesOf(project) {
  return bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
}

// ---------------------------------------------------------------- writing

// One row per date of the calendar's range, the header first: the date, its
// weekday, its day type's name or "No school", its bells ("Regular" or the
// bell schedule's name; empty on a day with no school) and its note. Names are
// written exactly as typed. With no calendar, the header alone.
export function calendarRows(project) {
  const rows = [CALENDAR_HEADER.slice()];
  const dayNames = new Map(project.dayTypes.map((dayType) => [dayType.id, dayType.name]));
  const bellNames = new Map(schedulesOf(project).map((schedule) => [schedule.id, schedule.name]));
  for (const day of calendarDays(project)) {
    const bells = !day.school ? '' : day.bellsId === null ? REGULAR_BELLS : bellNames.get(day.bellsId);
    rows.push([day.date, WEEKDAY_NAMES[day.weekday], day.school ? dayNames.get(day.dayTypeId) : NO_SCHOOL, bells, day.label]);
  }
  return rows;
}

// As every CSV the tool writes: a byte-order mark, CRLF, and `guard` only
// when asked for (exports.js says why).
export function calendarCsv(project, options) {
  return write(calendarRows(project), { eol: '\r\n', bom: true, guard: Boolean(options && options.guard) });
}

// ---------------------------------------------------------------- reading

function headerKey(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Which column plays each part. A role's words are in order of preference,
// so "Day type" is taken before a column headed "Day" wherever they stand.
function columnsOf(header) {
  const columns = {};
  const keys = header.map(headerKey);
  const claimed = new Set();
  for (const [role, words] of Object.entries(COLUMN_WORDS)) {
    for (const word of words) {
      const index = keys.findIndex((key, i) => key === word && !claimed.has(i));
      if (index !== -1) {
        columns[role] = index;
        claimed.add(index);
        break;
      }
    }
  }
  return columns;
}

// Monday … Sunday, and Mon … Sun, whatever the capitals.
const WEEKDAY_KEYS = new Set(WEEKDAY_NAMES.flatMap((name) => [name.toLowerCase(), name.slice(0, 3).toLowerCase()]));

// A column headed "Day" whose every entry is a weekday's name is the
// weekday, not the day type (a list written Date, Day, Note).
function weekdaysOnly(rows, index) {
  const cells = rows.map((row) => (index < row.length ? row[index].trim() : '')).filter((cell) => cell !== '');
  return cells.length > 0 && cells.every((cell) => WEEKDAY_KEYS.has(cell.toLowerCase()));
}

function quoted(texts) {
  return texts.map((text) => '"' + text + '"').join(', ');
}

// "A Day", "a day" or "ADay"
function orWords(texts) {
  const all = texts.map((text) => '"' + text + '"');
  return all.length === 1 ? all[0] : all.slice(0, -1).join(', ') + ' or ' + all[all.length - 1];
}

function rowsWords(rows) {
  return (rows.length === 1 ? 'row ' : 'rows ') + rows.join(', ');
}

// Does the row's day statement say what the calendar already gives?
function sameDay(given, day) {
  if (day === DAY_CLOSED) return !given.school;
  if (day === DAY_ROTATION) return given.school && given.why === 'rotation';
  return given.school && given.dayTypeId === day;
}

function sameBells(given, bells) {
  return given.bellsId === (bells === BELLS_REGULAR ? null : bells);
}

// A dated change that says nothing its weekday does not leave to it.
function saysNothing(entry) {
  return entry.day === null && entry.bells === null && entry.label === '';
}

// The calendar with `changes` (dated changes, as readCalendarCsv gives them)
// in place of the dates' own: one per date, in date order; a change that
// says nothing takes the date's own change away. Nothing else moves.
export function importedCalendar(project, changes) {
  const calendar = calendarOf(project);
  const byDate = new Map(calendar.dates.map((entry) => [entry.date, entry]));
  for (const change of changes) {
    if (saysNothing(change)) byDate.delete(change.date);
    else byDate.set(change.date, { date: change.date, day: change.day, bells: change.bells, label: change.label });
  }
  return { ...calendar, dates: Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

function entryOf(day) {
  return { school: day.school, dayTypeId: day.dayTypeId, bellsId: day.bellsId, label: day.label };
}

// Read a calendar CSV against `project`'s calendar. The rules:
// - The first row is the header. Date is needed; Day type, Bells and Note
//   are read when there; Weekday and any other column are passed over.
// - A date is written YYYY-MM-DD, each on one row. A blank row is passed over.
// - Day type: a day type's name, "No school" or "Next in the rotation". Blank,
//   with a note, is no school (a list of holidays); blank with no note leaves
//   the day as the calendar has it.
// - Bells: "Regular" or a bell schedule's name. Blank leaves them as they are.
// - Note: up to 60 characters, kept exactly as typed. With a Note column, a
//   blank note takes a date's note away.
// - A date outside the calendar's range is passed over and counted.
// - A row becomes a dated change only where it differs from what the
//   calendar gives the date. A date with a change of its own keeps what the
//   row does not change; one without gets a change whose day is null (as the
//   weekday says) when only its bells or note differ.
//
// Refused whole: no calendar, a file with no header or no Date column, one
// with nothing to read (no Day type, Note or Bells column and not one other), a row
// that is not as above, and any name the project does not have (every one is
// named, with its rows).
//
// Returns { changes, calendar, rows, counts, movedFrom }: `changes` are the
// dated changes to write, in date order (one that says nothing takes the
// date's change away); `calendar` is the calendar with them in place
// (importedCalendar); `rows` are [{ row, date, status, before, after }] with
// status 'change', 'same' or 'outside' and before and after as
// { school, dayTypeId, bellsId, label }; `counts` are { rows, changes, same,
// outside }; `movedFrom` is the first date the file does not name whose day
// type or bells move, or null.
export function readCalendarCsv(project, text) {
  const calendar = calendarOf(project);
  const days = calendarDays(project);
  if (calendar === null || days.length === 0) throw new CalendarImportError('There is no calendar to import dates into. Make the calendar first, then import the dates.', 'no-calendar');
  if (typeof text !== 'string') throw new CalendarImportError('This file could not be read. Choose a CSV file of dates.', 'not-csv');
  const rows = parse(text).rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length === 0) throw new CalendarImportError('This file is empty. A calendar CSV has a header row (Date, Weekday, Day type, Bells, Note) and a row for each date.', 'empty');
  const columns = columnsOf(rows[0]);
  if (columns.date === undefined) throw new CalendarImportError('The first row is the header, and it has no Date column. The columns are ' + CALENDAR_HEADER.join(', ') + '; only Date is needed.', 'no-date-column');
  const passed = new Set();
  if (columns.day !== undefined && headerKey(rows[0][columns.day]) === 'day' && weekdaysOnly(rows.slice(1), columns.day)) {
    passed.add(columns.day);
    delete columns.day;
  }
  // No Day type and no Note column: a list of dates and one other column
  // (Date, Name) is a list of notes; with nothing else, nothing is read.
  if (columns.day === undefined && columns.note === undefined) {
    for (const role of ['date', 'weekday', 'bells']) if (columns[role] !== undefined) passed.add(columns[role]);
    const others = rows[0].map((cell, index) => index).filter((index) => !passed.has(index) && rows[0][index].trim() !== '');
    if (others.length === 1) columns.note = others[0];
    else if (columns.bells === undefined) throw new CalendarImportError('This file has no Day type or Note column, so there is nothing to read.', 'nothing-to-read');
  }

  // A day type's name is matched as written first, then whatever the
  // capitals and spaces. Older projects may have two day types whose names
  // differ only so (17.1): a name that is written as neither, but reads as
  // both, is not guessed at.
  const dayByKey = new Map();
  for (const dayType of project.dayTypes) {
    const key = spacelessKey(dayType.name);
    if (!dayByKey.has(key)) dayByKey.set(key, []);
    dayByKey.get(key).push(dayType);
  }
  const unclearDays = new Map();
  const bellsByKey = new Map();
  for (const schedule of schedulesOf(project)) if (!bellsByKey.has(spacelessKey(schedule.name))) bellsByKey.set(spacelessKey(schedule.name), schedule.id);

  const problems = [];
  const unknownDays = new Map();
  const unknownBells = new Map();
  const note = (map, textValue, row) => {
    if (!map.has(textValue)) map.set(textValue, []);
    map.get(textValue).push(row);
  };
  const cell = (row, role) => (columns[role] === undefined || columns[role] >= row.length ? undefined : row[columns[role]]);
  const seen = new Map();
  const read = [];
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const date = (cell(row, 'date') || '').trim();
    if (!isCalendarDate(date)) {
      problems.push('Row ' + line + ': "' + date + '" is not a date written YYYY-MM-DD, such as 2026-11-26.');
      return;
    }
    if (seen.has(date)) {
      problems.push('Row ' + line + ': ' + date + ' is already on row ' + seen.get(date) + '. Each date is on one row.');
      return;
    }
    seen.set(date, line);
    const dayText = (cell(row, 'day') || '').trim();
    const bellsText = (cell(row, 'bells') || '').trim();
    const label = cell(row, 'note');
    if (label !== undefined && textLength(label) > DATE_LABEL_MOST) problems.push('Row ' + line + ': the note is ' + textLength(label) + ' characters, and a note is at most ' + DATE_LABEL_MOST + '.');
    let day;
    if (dayText === '') day = label !== undefined && label.trim() !== '' ? DAY_CLOSED : undefined;
    else if (spacelessKey(dayText) === NO_SCHOOL_KEY) day = DAY_CLOSED;
    else if (spacelessKey(dayText) === ROTATION_KEY) day = DAY_ROTATION;
    else if (dayByKey.has(spacelessKey(dayText))) {
      const sharing = dayByKey.get(spacelessKey(dayText));
      const exact = sharing.filter((dayType) => dayType.name.trim() === dayText);
      if (exact.length === 1 || sharing.length === 1) day = (exact.length === 1 ? exact : sharing)[0].id;
      // two day types written the same: the one the date has already, if either
      else if (exact.length > 1) day = { among: exact.map((dayType) => dayType.id), text: dayText };
      else note(unclearDays, dayText, line);
    } else note(unknownDays, dayText, line);
    let bells;
    if (bellsText === '' || day === DAY_CLOSED) bells = undefined;
    else if (REGULAR_KEYS.includes(spacelessKey(bellsText))) bells = BELLS_REGULAR;
    else if (bellsByKey.has(spacelessKey(bellsText))) bells = bellsByKey.get(spacelessKey(bellsText));
    else note(unknownBells, bellsText, line);
    read.push({ line, date, day, bells, label });
  });

  if (unknownDays.size > 0 || unknownBells.size > 0) {
    const parts = [];
    const describe = (map) => Array.from(map, ([name, lines]) => '"' + name + '" (' + rowsWords(lines) + ')').join(', ');
    if (unknownDays.size > 0) parts.push((unknownDays.size === 1 ? 'a day type' : 'day types') + ' this project does not have: ' + describe(unknownDays));
    if (unknownBells.size > 0) parts.push((unknownBells.size === 1 ? 'a bell schedule' : 'bell schedules') + ' this project does not have: ' + describe(unknownBells));
    throw new CalendarImportError('This file cannot be imported, and nothing was changed. It names ' + parts.join('; and ') + '. Add ' + (unknownDays.size + unknownBells.size === 1 ? 'it' : 'them') + ' on the Day tab, or change the file to use ' + quoted(project.dayTypes.map((dayType) => dayType.name).concat(schedulesOf(project).map((schedule) => schedule.name), [NO_SCHOOL, NEXT_IN_ROTATION, REGULAR_BELLS])) + ', and import it again.', 'unknown-names', { dayTypes: Array.from(unknownDays.keys()), bells: Array.from(unknownBells.keys()) });
  }
  if (unclearDays.size > 0) {
    const describe = Array.from(unclearDays, ([name, lines]) => '"' + name + '" (' + rowsWords(lines) + ') could be ' + orWords(dayByKey.get(spacelessKey(name)).map((dayType) => dayType.name))).join('; ');
    throw new CalendarImportError('This file cannot be imported, and nothing was changed. Some day types\' names differ only in capitals or spaces, and the file does not say which it means: ' + describe + '. Write the name exactly as the Day tab has it, or rename one of the day types, and import it again.', 'unclear-names', { dayTypes: Array.from(unclearDays.keys()) });
  }
  if (problems.length > 0) {
    throw new CalendarImportError('This file cannot be imported, and nothing was changed. ' + problems.length + (problems.length === 1 ? ' row is' : ' rows are') + ' not as the calendar CSV is written. The first: ' + problems[0], 'invalid');
  }

  // what each date becomes
  const own = new Map(calendar.dates.map((entry) => [entry.date, entry]));
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const index = new Map(days.map((day, i) => [day.date, i]));
  const offsetOf = (date) => index.get(date);
  const changes = [];
  const lines = [];
  for (const item of read) {
    if (item.date < first || item.date > last) {
      lines.push({ row: item.line, date: item.date, status: 'outside', before: null, after: null });
      continue;
    }
    const given = days[offsetOf(item.date)];
    const had = own.get(item.date);
    if (item.day !== null && typeof item.day === 'object') item.day = given.school && item.day.among.includes(given.dayTypeId) ? given.dayTypeId : unwritable(item);
    const entry = had ? { date: item.date, day: had.day, bells: had.bells, label: had.label } : { date: item.date, day: null, bells: null, label: '' };
    const dayMoves = item.day !== undefined && !sameDay(given, item.day);
    if (dayMoves) entry.day = item.day;
    // bells say nothing on a date with no school
    const closed = dayMoves ? item.day === DAY_CLOSED : !given.school;
    if (item.bells !== undefined && !closed && !sameBells(given, item.bells)) entry.bells = item.bells;
    if (item.label !== undefined && item.label !== given.label) entry.label = item.label;
    const unchanged = had ? entry.day === had.day && entry.bells === had.bells && entry.label === had.label : saysNothing(entry);
    if (unchanged) {
      lines.push({ row: item.line, date: item.date, status: 'same', before: entryOf(given), after: entryOf(given) });
      continue;
    }
    changes.push(entry);
    lines.push({ row: item.line, date: item.date, status: 'change', before: entryOf(given), after: null });
  }
  changes.sort((a, b) => (a.date < b.date ? -1 : 1));

  const next = changes.length === 0 ? calendar : importedCalendar(project, changes);
  const afterDays = changes.length === 0 ? days : calendarDays({ ...project, calendar: next });
  for (const line of lines) if (line.status === 'change') line.after = entryOf(afterDays[offsetOf(line.date)]);
  const named = new Set(read.map((item) => item.date));
  const moved = afterDays.find((day, i) => !named.has(day.date) && (day.dayTypeId !== days[i].dayTypeId || day.bellsId !== days[i].bellsId));
  return {
    changes,
    calendar: next,
    rows: lines,
    counts: {
      rows: lines.length,
      changes: changes.length,
      same: lines.filter((line) => line.status === 'same').length,
      outside: lines.filter((line) => line.status === 'outside').length,
    },
    movedFrom: moved ? moved.date : null,
  };
}

// Two day types are written exactly as the row writes, and the date is
// neither: there is no saying which.
function unwritable(item) {
  throw new CalendarImportError('This file cannot be imported, and nothing was changed. Row ' + item.line + ' names "' + item.day.text + '", and two day types are written so. Rename one of them on the Day tab, and import it again.', 'unclear-names', { dayTypes: [item.day.text] });
}

// "12 dates change; 3 are as the calendar has them; 2 are outside it, from
// 31 August 2026 to 11 June 2027", for the preview and the undo label.
export function calendarImportText(project, result) {
  const dates = (n) => n + (n === 1 ? ' date' : ' dates');
  const parts = [];
  if (result.counts.changes > 0) parts.push(dates(result.counts.changes) + (result.counts.changes === 1 ? ' changes' : ' change'));
  if (result.counts.same > 0) parts.push(dates(result.counts.same) + (result.counts.same === 1 ? ' is' : ' are') + ' as the calendar has ' + (result.counts.same === 1 ? 'it' : 'them'));
  if (result.counts.outside > 0) {
    const calendar = calendarOf(project);
    parts.push(dates(result.counts.outside) + (result.counts.outside === 1 ? ' is' : ' are') + ' outside the calendar, which runs from ' + dateWords(calendar.start) + ' to ' + dateWords(calendar.end));
  }
  return parts.length === 0 ? 'no dates to import' : parts.join('; ');
}
