// "Every date as a list" (DESIGN 11.4), the year's text alternative: a table
// of date, weekday, day type or "No school", bells, why and note. It is made
// only while it is open: a two-year calendar is 731 rows. Once made it is
// patched, not made again: only the rows whose words changed are written.

import { h } from '../../components/dom.js';
import { calendarDays, dateWords } from '../../../engine/calendar.js';
import { dayTypeWords, bellsWords, whyWords, WEEKDAY_NAMES } from './model.js';

// the words of a row's six cells
function wordsOf(project, day) {
  return [dateWords(day.date), WEEKDAY_NAMES[day.weekday], dayTypeWords(project, day), bellsWords(project, day), whyWords(project, day), day.label];
}

// what a row says, as one string: cells, closed or not, today or not
function signOf(words, day, today) {
  return JSON.stringify([words, day.school, day.date === today]);
}

const signs = new WeakMap();

function rowOf(project, day, today) {
  const words = wordsOf(project, day);
  const row = h('tr', { class: day.school ? null : 'is-closed', 'aria-current': day.date === today ? 'date' : null, data: { date: day.date } },
    h('th', { scope: 'row' }, words[0]),
    ...words.slice(1).map((word) => h('td', null, word)));
  signs.set(row, signOf(words, day, today));
  return row;
}

export function dateTable(project, today) {
  return h('table', { class: 'cal-list__table', data: { part: 'list' } },
    h('thead', null, h('tr', null, ['Date', 'Weekday', 'Day type', 'Bells', 'Why', 'Note'].map((name) => h('th', { scope: 'col' }, name)))),
    h('tbody', null, calendarDays(project).map((day) => rowOf(project, day, today))));
}

// The table brought up to the project, writing only the rows that changed.
// False when it is not the same dates (a new range): the caller makes it again.
export function patchTable(table, project, today) {
  const days = calendarDays(project);
  const rows = table.tBodies[0].rows;
  if (rows.length !== days.length) return false;
  for (let i = 0; i < days.length; i += 1) if (rows[i].dataset.date !== days[i].date) return false;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    const row = rows[i];
    const words = wordsOf(project, day);
    const sign = signOf(words, day, today);
    if (signs.get(row) === sign) continue;
    signs.set(row, sign);
    if (day.school) row.removeAttribute('class');
    else row.className = 'is-closed';
    if (day.date === today) row.setAttribute('aria-current', 'date');
    else row.removeAttribute('aria-current');
    const cells = row.cells;
    for (let c = 0; c < words.length; c += 1) if (cells[c].textContent !== words[c]) cells[c].textContent = words[c];
  }
  return true;
}
