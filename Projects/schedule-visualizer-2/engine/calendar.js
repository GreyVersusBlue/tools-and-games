// The calendar: which day type, and which bells, each date is (ARCHITECTURE
// 17.4). Dates are the school's own local dates written "YYYY-MM-DD", and the
// arithmetic on them is whole days counted from 1970-01-01 with no clock and
// no time zone: the engine reads no clock, so "today" is the caller's.
//
// The rule, in plain words for Help: the rotation moves on one step on every
// school day it decides. Days with no school, and weekdays that always have
// the same day type, do not move it. Setting a date to a day type in the
// rotation puts the rotation there, and the next school day follows on from
// it. "Next in the rotation" makes a date (a Saturday make-up day) take the
// next one. A snow day ("No school") pushes every later day back by one; set
// the day after it to keep the old order instead.
//
// Every function here reads an absent or unreadable calendar as none, and a
// dangling id as if it were not there, since the staff browser never runs
// repair.

import { calendarOf, bellSchedulesOf, CALENDAR_DAYS_MOST, DAY_ROTATION, DAY_CLOSED, BELLS_REGULAR, WEEKDAY_NAMES } from './schema.js';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- dates

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthLength(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// A real date written YYYY-MM-DD, from year 1000 to 9999: "2027-02-29" is
// not one, "2028-02-29" is.
export function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= monthLength(year, month);
}

// Days from 1970-01-01 to `date` (negative before it), or NaN when `date` is
// not a calendar date. The civil-calendar arithmetic of H. Hinnant's
// days_from_civil, in whole numbers.
export function dayNumber(date) {
  if (!isCalendarDate(date)) return NaN;
  let year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

// The date `number` days after 1970-01-01: dayNumber's reverse.
export function dateOfNumber(number) {
  const z = number + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

// `date` moved on by `days` (back, when negative).
export function addDays(date, days) {
  return dateOfNumber(dayNumber(date) + days);
}

// How many days from `from` to `to`: 0 for the same date, negative when `to`
// is earlier.
export function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

// The weekday of `date`, 0 Monday to 6 Sunday. 1970-01-01 was a Thursday.
export function weekdayOf(date) {
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

// Every date from `from` to `to`, both included; none when `to` is earlier.
export function datesFrom(from, to) {
  const first = dayNumber(from);
  const last = dayNumber(to);
  const dates = [];
  for (let n = first; n <= last; n += 1) dates.push(dateOfNumber(n));
  return dates;
}

// "26 November 2026", or with `options.weekday` "Thursday 26 November 2026";
// `options.year` false leaves the year out.
export function dateWords(date, options) {
  if (!isCalendarDate(date)) return '';
  const opts = options || {};
  const words = Number(date.slice(8, 10)) + ' ' + MONTH_NAMES[Number(date.slice(5, 7)) - 1] + (opts.year === false ? '' : ' ' + date.slice(0, 4));
  return opts.weekday ? WEEKDAY_NAMES[weekdayOf(date)] + ' ' + words : words;
}

// ---------------------------------------------------------------- the rule

// The calendar's first and last dates, when it has a range the rule can walk:
// both real, the first not after the last, at most CALENDAR_DAYS_MOST dates.
function rangeOf(calendar) {
  if (!calendar || !isCalendarDate(calendar.start) || !isCalendarDate(calendar.end)) return null;
  const count = daysBetween(calendar.start, calendar.end) + 1;
  if (count < 1 || count > CALENDAR_DAYS_MOST) return null;
  return { start: calendar.start, end: calendar.end, count };
}

const dayCache = new WeakMap();

// The walk of 17.4, once per calendar, day types and bell schedules.
function walk(project, calendar, range) {
  const dayTypes = project.dayTypes;
  const schedules = bellSchedulesOf(project);
  const cached = dayCache.get(calendar);
  if (cached && cached.dayTypes === dayTypes && cached.schedules === schedules) return cached.days;

  const known = new Set(dayTypes.map((dayType) => dayType.id));
  const knownBells = new Set(schedules.filter((schedule) => schedule && typeof schedule.id === 'string').map((schedule) => schedule.id));
  const dayOf = (value) => (value === DAY_ROTATION || value === DAY_CLOSED || known.has(value) ? value : null);
  const bellsOf = (value) => (typeof value === 'string' && knownBells.has(value) ? value : null);

  let rotation = Array.isArray(calendar.rotation) ? calendar.rotation.filter((id) => known.has(id)) : [];
  if (rotation.length === 0) rotation = [dayTypes[0].id];
  const weekdays = WEEKDAY_NAMES.map((name, index) => {
    const rule = Array.isArray(calendar.weekdays) ? calendar.weekdays[index] : null;
    const isRule = rule !== null && typeof rule === 'object';
    return { day: (isRule && dayOf(rule.day)) || DAY_ROTATION, bells: isRule ? bellsOf(rule.bells) : null };
  });
  // one dated change per date, the last of any two; one naming a day type
  // that is gone is not there (repair removes it, and then keeps the last)
  const dated = new Map();
  if (Array.isArray(calendar.dates)) {
    for (const entry of calendar.dates) {
      if (!entry || typeof entry !== 'object' || !isCalendarDate(entry.date)) continue;
      const day = dayOf(entry.day);
      if (day === null) continue;
      dated.set(entry.date, { day, bells: entry.bells === BELLS_REGULAR ? BELLS_REGULAR : bellsOf(entry.bells), label: typeof entry.label === 'string' ? entry.label : '' });
    }
  }

  const days = [];
  let p = 0;
  const first = dayNumber(range.start);
  for (let n = 0; n < range.count; n += 1) {
    const date = dateOfNumber(first + n);
    const weekday = (((first + n + 3) % 7) + 7) % 7;
    const rule = weekdays[weekday];
    const change = dated.get(date) || null;
    const day = change ? change.day : rule.day;
    let dayTypeId = null;
    let why;
    if (day === DAY_CLOSED) {
      why = change ? 'date' : 'weekday';
    } else if (day === DAY_ROTATION) {
      dayTypeId = rotation[p];
      p = (p + 1) % rotation.length;
      why = 'rotation';
    } else if (change) {
      dayTypeId = day;
      // a day type in the rotation puts the rotation there: its first place
      // at or after p, wrapping
      for (let step = 0; step < rotation.length; step += 1) {
        const at = (p + step) % rotation.length;
        if (rotation[at] === day) {
          p = (at + 1) % rotation.length;
          break;
        }
      }
      why = 'date';
    } else {
      // a weekday that always has this day type never moves the rotation
      dayTypeId = day;
      why = 'weekday';
    }
    const school = dayTypeId !== null;
    let bellsId = null;
    if (school) {
      if (change && change.bells !== null) bellsId = change.bells === BELLS_REGULAR ? null : change.bells;
      else bellsId = rule.bells;
    }
    days.push({ date, weekday, known: true, school, dayTypeId, bellsId, why, label: change ? change.label : '', changed: change !== null });
  }
  dayCache.set(calendar, { dayTypes, schedules, days });
  return days;
}

// Every date of the calendar, first to last: { date, weekday, known: true,
// school, dayTypeId, bellsId, why, label, changed }. `why` is 'rotation',
// 'date' (a dated change decided the day) or 'weekday'; `changed` is true
// when the date has a change of its own (a "rotation" one too). Memoised on
// the calendar, the day types and the bell schedules, so ask freely. Empty
// with no calendar, or one whose range cannot be walked.
export function calendarDays(project) {
  const calendar = calendarOf(project);
  const range = rangeOf(calendar);
  return range ? walk(project, calendar, range) : [];
}

// What day type and bells is `date`? { known: false, why: 'none' } with no
// calendar, { known: false, why: 'outside' } for a date it does not cover
// (or that is not a date), else { known: true, school, dayTypeId | null,
// bellsId | null, why, label, changed }. bellsId null means the day type's
// regular bells.
export function dayOn(project, date) {
  const calendar = calendarOf(project);
  const range = rangeOf(calendar);
  if (!range) return { known: false, why: 'none' };
  if (!isCalendarDate(date)) return { known: false, why: 'outside' };
  const offset = daysBetween(range.start, date);
  if (offset < 0 || offset >= range.count) return { known: false, why: 'outside' };
  const entry = walk(project, calendar, range)[offset];
  return { known: true, school: entry.school, dayTypeId: entry.dayTypeId, bellsId: entry.bellsId, why: entry.why, label: entry.label, changed: entry.changed };
}

// The counts for the calendar's panel: { days, schoolDays, closed, dayTypes:
// [{ dayTypeId, count }] in the project's order, bells: [{ bellsId, count }]
// with null (regular bells) first and then each bell schedule }. Every
// count but `days` and `closed` is of school days. All zero with no calendar.
export function calendarCounts(project) {
  const days = calendarDays(project);
  const byDay = new Map(project.dayTypes.map((dayType) => [dayType.id, 0]));
  const schedules = bellSchedulesOf(project).filter((schedule) => schedule && typeof schedule.id === 'string');
  const byBells = new Map([[null, 0]].concat(schedules.map((schedule) => [schedule.id, 0])));
  let schoolDays = 0;
  for (const day of days) {
    if (!day.school) continue;
    schoolDays += 1;
    byDay.set(day.dayTypeId, byDay.get(day.dayTypeId) + 1);
    byBells.set(day.bellsId, byBells.get(day.bellsId) + 1);
  }
  return {
    days: days.length,
    schoolDays,
    closed: days.length - schoolDays,
    dayTypes: Array.from(byDay, ([dayTypeId, count]) => ({ dayTypeId, count })),
    bells: Array.from(byBells, ([bellsId, count]) => ({ bellsId, count })),
  };
}
