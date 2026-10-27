// What the Calendar tab and the calendar print say (DESIGN 11.4), worked out
// from the engine's walk (engine/calendar.js). Pure: no DOM, no clock. Every
// date's day type, bells and why are the engine's `calendarDays`; this file
// only puts them into words and lays them out in months.
//
//   todayOf(now)                         the device's own date of a Date, "YYYY-MM-DD"
//   dayEntry(project, date)              the walk's entry for a date, or null outside the calendar
//   dateName(project, date, today, entry?) a date's whole sentence, for a screen reader
//   dayTypeWords / bellsWords / whyWords the parts of a date, as the list and the print show them
//   monthsOf(start, end, firstDay)       the months of a range as weeks of seven
//   breaksOf(project)                    the dated "No school" runs, as breaks
//   summaryWords(project, today)         the panel's first sentence
//   runWords(from, to)                   "21 to 25 December"
//   changeWords(project, dates, change)  the date dialog's Apply button
//   movedWords(project, before, date)    the toast's second sentence

import { calendarDays, dayOn, dateWords, datesFrom, daysBetween, weekdayOf, isCalendarDate, MONTH_NAMES } from '../../../engine/calendar.js';
import { dayShort, bellsShort } from '../../../engine/day-types.js';
import { calendarOf, bellSchedulesOf, DAY_ROTATION, DAY_CLOSED, BELLS_REGULAR, WEEKDAY_NAMES } from '../../../engine/schema.js';
import { presetFor } from '../../colour.js';

export const NO_SCHOOL = 'No school';
export const NEXT_IN_ROTATION = 'Next in the rotation';
export const AS_CALENDAR_SAYS = 'As the calendar says';
export const AS_WEEKDAY_SAYS = 'As the weekday says';
export const REGULAR = 'Regular';

// "YYYY-MM-DD" of a Date in the device's own zone: what the school means by today.
export function todayOf(now) {
  const date = now instanceof Date ? now : new Date(now);
  return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// The walk's entry for `date`, or null when the calendar does not cover it.
export function dayEntry(project, date) {
  const days = calendarDays(project);
  if (days.length === 0 || !isCalendarDate(date)) return null;
  const offset = daysBetween(days[0].date, date);
  return offset >= 0 && offset < days.length ? days[offset] : null;
}

function dayTypeOf(project, id) {
  return project.dayTypes.find((dayType) => dayType.id === id) || null;
}

function scheduleOf(project, id) {
  return bellSchedulesOf(project).find((schedule) => schedule && schedule.id === id) || null;
}

// A day type's tint: the data palette in the day types' order (DESIGN 11.4).
// The short name always says the same, so colour is never alone.
export function tintOf(project, dayTypeId) {
  const index = project.dayTypes.findIndex((dayType) => dayType.id === dayTypeId);
  return index === -1 ? null : presetFor(index);
}

export function shortOfDay(project, dayTypeId) {
  const dayType = dayTypeOf(project, dayTypeId);
  return dayType ? dayShort(dayType, project.dayTypes) : '';
}

export function shortOfBells(project, bellsId) {
  const schedule = scheduleOf(project, bellsId);
  return schedule ? bellsShort(schedule, bellSchedulesOf(project)) : '';
}

// "B Day", or "No school".
export function dayTypeWords(project, entry) {
  if (!entry.school) return NO_SCHOOL;
  const dayType = dayTypeOf(project, entry.dayTypeId);
  return dayType ? dayType.name : '';
}

// "Early Release", "Regular", or '' on a day with no school.
export function bellsWords(project, entry) {
  if (!entry.school) return '';
  const schedule = entry.bellsId === null ? null : scheduleOf(project, entry.bellsId);
  return schedule ? schedule.name : REGULAR;
}

// "Wednesdays" from 2 (Wednesday).
function weekdays(weekday) {
  return WEEKDAY_NAMES[weekday] + 's';
}

// Why a date is what it is, in a few words: "rotation", "changed by hand",
// "Wednesdays are always C Day", "Saturdays have no school". A change of
// bells or a note only (its day null) leaves the day to the weekday, so its
// why is the weekday's, and "changed by hand" follows it.
export function whyWords(project, entry) {
  const calendar = calendarOf(project);
  const rule = calendar && Array.isArray(calendar.weekdays) ? calendar.weekdays[entry.weekday] : null;
  let why;
  if (entry.why === 'date') why = 'changed by hand';
  else if (entry.why === 'rotation') why = 'rotation';
  else if (entry.school) why = weekdays(entry.weekday) + ' are always ' + dayTypeWords(project, entry);
  else why = weekdays(entry.weekday) + ' have no school';
  if (entry.why !== 'date' && entry.changed) why += '; changed by hand';
  // the weekday's own bells, when they are not the regular ones and no change set them
  if (entry.school && rule && rule.bells && entry.bellsId === rule.bells && !(entry.changed && hasOwnBells(calendar, entry.date))) {
    const schedule = scheduleOf(project, rule.bells);
    if (schedule) why += '; ' + weekdays(entry.weekday) + ' have ' + schedule.name + ' bells';
  }
  return why;
}

function ownChange(calendar, date) {
  return calendar && Array.isArray(calendar.dates) ? calendar.dates.find((each) => each && each.date === date) || null : null;
}

function hasOwnBells(calendar, date) {
  const change = ownChange(calendar, date);
  return Boolean(change) && change.bells !== null;
}

// The dated change a date has of its own, or null.
export function changeOn(project, date) {
  return ownChange(calendarOf(project), date);
}

// A date's whole sentence, the name of its square (DESIGN 11.4): "Thursday
// 26 November 2026: no school, Thanksgiving. Changed by hand." A school day
// says its day type and any bells but the regular ones: "Wednesday 2
// September 2026: B Day with Early Release bells." Today says so last.
export function dateName(project, date, today, known) {
  const head = dateWords(date, { weekday: true });
  // the year, which has the walk's entry in hand, hands it over
  const entry = known === undefined ? dayEntry(project, date) : known;
  if (!entry) return head + ': not in the calendar.';
  let body;
  if (!entry.school) {
    body = 'no school' + (entry.label === '' ? '' : ', ' + entry.label);
  } else {
    body = dayTypeWords(project, entry) + (entry.bellsId === null ? '' : ' with ' + bellsWords(project, entry) + ' bells') + (entry.label === '' ? '' : ', ' + entry.label);
  }
  return head + ': ' + body + '.' + (entry.changed ? ' Changed by hand.' : '') + (date === today ? ' Today.' : '');
}

// The word a no-school square carries: "No", or the note's first word.
export function closedWord(entry) {
  const first = entry.label.trim().split(/\s+/)[0];
  return first ? first : 'No';
}

// The months from `start`'s to `end`'s, each { year, month (1 to 12), name,
// weeks: [[date | null] × 7] }, a week starting on `firstDay` (0 Monday to
// 6 Sunday). Dates outside start..end are in their month's weeks: the caller
// says they are not in the calendar.
export function monthsOf(start, end, firstDay) {
  const months = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const lastYear = Number(end.slice(0, 4));
  const lastMonth = Number(end.slice(5, 7));
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const first = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-01';
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dates = datesFrom(first, first.slice(0, 8) + String(length).padStart(2, '0'));
    const lead = (weekdayOf(first) - firstDay + 7) % 7;
    const cells = new Array(lead).fill(null).concat(dates);
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    months.push({ year, month, key: first.slice(0, 7), name: MONTH_NAMES[month - 1] + ' ' + year, weeks });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

// The weekday a week starts on, 0 Monday to 6 Sunday, from a locale's week
// information (Intl.Locale's weekInfo, or getWeekInfo where that is the
// name), else Sunday (DESIGN 11.4).
export function firstDayOf(locale) {
  try {
    const info = new Intl.Locale(locale);
    const week = typeof info.getWeekInfo === 'function' ? info.getWeekInfo() : info.weekInfo;
    if (week && Number.isInteger(week.firstDay) && week.firstDay >= 1 && week.firstDay <= 7) return week.firstDay - 1;
  } catch (error) {
    // no such locale, or no week information: Sunday
  }
  return 6;
}

// The calendar's breaks: runs of dates closed by a change of their own with
// the same note, where the dates between two of a run are not school days
// (a weekend inside a break keeps it one break). [{ from, to, label, dates,
// schoolDays }], in date order.
export function breaksOf(project) {
  const calendar = calendarOf(project);
  if (!calendar || !Array.isArray(calendar.dates)) return [];
  const days = calendarDays(project);
  if (days.length === 0) return [];
  const start = days[0].date;
  const at = (date) => {
    const offset = daysBetween(start, date);
    return offset >= 0 && offset < days.length ? days[offset] : null;
  };
  const closed = calendar.dates.filter((each) => each && each.day === DAY_CLOSED && at(each.date) !== null);
  const breaks = [];
  for (const change of closed) {
    const last = breaks[breaks.length - 1];
    const label = typeof change.label === 'string' ? change.label : '';
    const between = last ? datesFrom(last.to, change.date).slice(1, -1) : [];
    if (last && last.label === label && between.every((date) => !at(date).school)) {
      last.to = change.date;
      last.dates.push(change.date);
    } else {
      breaks.push({ from: change.date, to: change.date, label, dates: [change.date] });
    }
  }
  for (const each of breaks) each.schoolDays = each.dates.length;
  return breaks;
}

// "21 to 25 December", "30 November to 2 December", "28 December 2026 to
// 1 January 2027", or one date: "26 November".
export function runWords(from, to) {
  if (from === to) return dateWords(from, { year: false });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  if (sameMonth) return Number(from.slice(8, 10)) + ' to ' + dateWords(to, { year: false });
  if (sameYear) return dateWords(from, { year: false }) + ' to ' + dateWords(to, { year: false });
  return dateWords(from) + ' to ' + dateWords(to);
}

function count(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// The panel's first sentence: "182 school days from 31 August 2026 to 11
// June 2027. Today is a B Day with Early Release bells."
export function summaryWords(project, today) {
  const calendar = calendarOf(project);
  const days = calendarDays(project);
  if (!calendar || days.length === 0) return '';
  const school = days.filter((day) => day.school).length;
  const head = count(school, 'school day', 'school days') + ' from ' + dateWords(calendar.start) + ' to ' + dateWords(calendar.end) + '.';
  const on = dayOn(project, today);
  if (!on.known) return head + ' Today, ' + dateWords(today) + ', is not in the calendar.';
  if (!on.school) return head + ' There is no school today' + (on.label === '' ? '.' : ': ' + on.label + '.');
  const name = dayTypeWords(project, on);
  const article = /^[aeiou]/i.test(name) && !/^(?:one|uni|use|eu)/i.test(name) ? 'an' : 'a';
  return head + ' Today is ' + article + ' ' + name + (on.bellsId === null ? '' : ' with ' + bellsWords(project, on) + ' bells') + '.';
}

// The school days among `dates`, and those closed by a change of their own.
function closable(project, dates) {
  return dates.filter((date) => {
    const entry = dayEntry(project, date);
    if (!entry) return false;
    const own = changeOn(project, date);
    return entry.school || (own !== null && own.day === DAY_CLOSED);
  });
}

// The words of the date dialog's Apply button, naming the change as the
// undo step will: "Set 8 school days to No school", "Set 26 November to B
// Day", "Change 3 dates in the calendar". `change` is what setCalendarDates
// is given: { day, bells, label }, any left out.
export function changeWords(project, dates, change) {
  const closing = change.day === DAY_CLOSED;
  const counted = closing ? closable(project, dates) : dates;
  const words = counted.length === 1 ? dateWords(counted[0], { year: false }) : closing ? count(counted.length, 'school day', 'school days') : count(counted.length, 'date', 'dates');
  if (change.day === null) return 'Set ' + words + ' as the calendar says';
  if (closing) return counted.length === 0 ? 'No school days to close' : 'Set ' + words + ' to ' + NO_SCHOOL;
  if (change.day === DAY_ROTATION) return 'Set ' + words + ' to ' + NEXT_IN_ROTATION;
  if (change.day !== undefined) {
    const dayType = dayTypeOf(project, change.day);
    return 'Set ' + words + ' to ' + (dayType ? dayType.name : '');
  }
  if (change.bells !== undefined) {
    // bells alone are written on school days only, as closing is
    const school = dates.filter((date) => (dayEntry(project, date) || {}).school === true);
    if (school.length === 0) return 'No school days to change';
    const on = school.length === 1 ? dateWords(school[0], { year: false }) : count(school.length, 'school day', 'school days');
    return 'Set ' + on + ' to ' + bellsChoice(project, change.bells);
  }
  return 'Change ' + words + ' in the calendar';
}

// "Early Release bells", "regular bells", "the weekday’s bells".
function bellsChoice(project, bells) {
  if (bells === null) return 'the weekday’s bells';
  if (bells === BELLS_REGULAR) return 'Regular bells';
  const schedule = scheduleOf(project, bells);
  return (schedule ? schedule.name : '') + ' bells';
}

// The toast's first sentence for a change made: "No school on 26
// November.", "26 November is a B Day.", "Changed 3 dates."
export function doneWords(project, dates, change) {
  const run = runWords(dates[0], dates[dates.length - 1]);
  if (change.day === null) return run + (dates.length === 1 ? ' is' : ' are') + ' as the calendar says.';
  if (change.day === DAY_CLOSED) return 'No school on ' + run + '.';
  if (change.day === DAY_ROTATION) return run + ' ' + (dates.length === 1 ? 'takes' : 'take') + ' the next day in the rotation.';
  if (change.day !== undefined) {
    const dayType = dayTypeOf(project, change.day);
    return run + (dates.length === 1 ? ' is ' : ' are ') + (dayType ? dayType.name : '') + '.';
  }
  if (change.bells !== undefined) {
    const bells = change.bells === null ? 'the weekday’s bells' : change.bells === BELLS_REGULAR ? 'regular bells' : (scheduleOf(project, change.bells) || { name: '' }).name + ' bells';
    return run + (dates.length === 1 ? ' has ' : ' have ') + bells + '.';
  }
  return 'Changed the note on ' + run + '.';
}

// The toast's second sentence when later dates moved: "The rotation moves
// back a day from 27 November." `before` is the project before the change,
// `after` the one after, `from` the first later date that moved
// (setCalendarDates' movedFrom), `dates` the dates changed.
export function movedWords(before, after, dates, change, from) {
  if (!from) return '';
  const at = dateWords(from, { year: false });
  const was = new Set(dates);
  // how many rotation days the change took out of the rotation, or put in
  const taken = dates.filter((date) => {
    const entry = dayEntry(before, date);
    const now = dayEntry(after, date);
    return entry && now && was.has(date) && entry.why === 'rotation' && !now.school;
  }).length;
  if (change.day === DAY_CLOSED && taken > 0) return 'The rotation moves back ' + (taken === 1 ? 'a day' : taken + ' days') + ' from ' + at + '.';
  if (change.day === DAY_ROTATION) return 'The rotation moves on from ' + at + '.';
  return 'Later dates follow on from it, from ' + at + '.';
}

// For the weekday rules: what each says, in words.
export function ruleWords(project, rule) {
  if (!rule || rule.day === DAY_ROTATION) return 'In the rotation';
  if (rule.day === DAY_CLOSED) return NO_SCHOOL;
  const dayType = dayTypeOf(project, rule.day);
  return dayType ? 'Always ' + dayType.name : 'In the rotation';
}

export { WEEKDAY_NAMES, MONTH_NAMES };
