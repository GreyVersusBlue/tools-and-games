// "Every date as a list" (DESIGN 11.4), the year's text alternative: a table
// of date, weekday, day type or "No school", bells, why and note. It is made
// only while it is open: a two-year calendar is 731 rows.

import { h } from '../../components/dom.js';
import { calendarDays, dateWords } from '../../../engine/calendar.js';
import { dayTypeWords, bellsWords, whyWords, WEEKDAY_NAMES } from './model.js';

export function dateTable(project, today) {
  return h('table', { class: 'cal-list__table', data: { part: 'list' } },
    h('thead', null, h('tr', null, ['Date', 'Weekday', 'Day type', 'Bells', 'Why', 'Note'].map((name) => h('th', { scope: 'col' }, name)))),
    h('tbody', null, calendarDays(project).map((day) => h('tr', { class: day.school ? null : 'is-closed', 'aria-current': day.date === today ? 'date' : null, data: { date: day.date } },
      h('th', { scope: 'row' }, dateWords(day.date)),
      h('td', null, WEEKDAY_NAMES[day.weekday]),
      h('td', null, dayTypeWords(project, day)),
      h('td', null, bellsWords(project, day)),
      h('td', null, whyWords(project, day)),
      h('td', null, day.label)))));
}
