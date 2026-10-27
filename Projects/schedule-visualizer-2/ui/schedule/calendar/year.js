// The year (DESIGN 11.4): the calendar's months in a wrapping grid, each a
// `table role="grid"` named by its month's heading, a date a square.
//
//   const year = createYear({ open(from, to, cell), status(text) });
//   year.element
//   year.update(project, today)   draw the dates again; the squares are kept
//   year.cellOf(date)             a date's square, for the focus to come back to
//   year.selection()              { from, to }, the run chosen
//   year.focusDate(date)          put the roving stop on a date and focus it
//
// One Tab stop for the whole year. Arrows move a day or a week in date order,
// across the edge of a month (not in screen order); Page Up and Page Down a
// month, keeping the day; Home and End the ends of the week. With Shift the
// arrows, Home and End stretch a run of dates (aria-selected); a click with
// Shift stretches it too. Enter, Space, a click or a tap opens the date
// dialog on the run. The squares are made once for a range and kept, so a
// change does not take the square that has the focus from under it.

import { h, uid } from '../../components/dom.js';
import { addDays, daysBetween, weekdayOf, isCalendarDate } from '../../../engine/calendar.js';
import { calendarDays } from '../../../engine/calendar.js';
import { calendarOf } from '../../../engine/schema.js';
import { monthsOf, firstDayOf, dateName, dayTypeWords, shortOfDay, shortOfBells, tintOf, closedWord, runWords, WEEKDAY_NAMES } from './model.js';

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CALENDAR_KEYS = [
  { id: 'calendar-arrows', does: 'Move a day, or a week, through the calendar in date order', shown: 'Arrows' },
  { id: 'calendar-month', does: 'Move a month, keeping the day', shown: 'Page Up, Page Down' },
  { id: 'calendar-week-ends', does: 'Go to the start or the end of the week', shown: 'Home, End' },
  { id: 'calendar-run', does: 'Choose a run of dates', shown: 'Shift+Arrows' },
  { id: 'calendar-open', does: 'Change the date, or the run chosen', shown: 'Enter, Space' },
];

function locale() {
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

export function createYear(hooks) {
  const element = h('div', { class: 'cal-year', data: { part: 'year' } });
  let built = '';
  let cells = new Map();
  let range = null;
  let firstDay = 6;
  let cursor = null;
  let anchor = null;
  let project = null;
  let today = '';

  function clamp(date) {
    if (!range) return date;
    if (date < range.start) return range.start;
    if (date > range.end) return range.end;
    return date;
  }

  function run() {
    if (cursor === null) return null;
    const a = anchor === null ? cursor : anchor;
    return a <= cursor ? { from: a, to: cursor } : { from: cursor, to: a };
  }

  function build(calendar) {
    firstDay = firstDayOf(locale());
    const order = Array.from({ length: 7 }, (unused, i) => (firstDay + i) % 7);
    cells = new Map();
    const months = monthsOf(calendar.start, calendar.end, firstDay).map((month) => {
      const headingId = uid('cal-month');
      const table = h('table', { class: 'cal-month__grid', role: 'grid', 'aria-labelledby': headingId, 'aria-multiselectable': 'true' },
        h('thead', null, h('tr', { role: 'row' }, order.map((weekday) => h('th', { scope: 'col', role: 'columnheader' }, h('abbr', { title: WEEKDAY_NAMES[weekday] }, SHORT_DAYS[weekday]))))),
        h('tbody', null, month.weeks.map((week) => h('tr', { role: 'row' }, week.map((date) => {
          if (date === null) return h('td', { role: 'presentation', class: 'cal-blank' });
          // the name is the hidden sentence inside; what is drawn is hidden from it
          const cell = h('td', { role: 'gridcell', class: 'cal-day', tabindex: '-1', data: { date, key: 'cal:' + date } },
            h('span', { class: 'vh cal-day__name' }),
            h('span', { class: 'cal-day__n', 'aria-hidden': 'true' }, String(Number(date.slice(8, 10)))),
            h('span', { class: 'cal-day__t', 'aria-hidden': 'true' }),
            h('span', { class: 'cal-day__b', 'aria-hidden': 'true' }));
          cells.set(date, cell);
          return cell;
        })))));
      return h('section', { class: 'cal-month', data: { month: month.key } }, h('h2', { class: 'cal-month__name', id: headingId }, month.name), table);
    });
    element.replaceChildren(...months);
  }

  function paint() {
    const days = calendarDays(project);
    const byDate = new Map(days.map((day) => [day.date, day]));
    const chosen = run();
    for (const [date, cell] of cells) {
      const day = byDate.get(date) || null;
      const t = cell.children[2];
      const b = cell.children[3];
      cell.className = 'cal-day';
      cell.style.removeProperty('--tint');
      if (!day) {
        cell.classList.add('is-out');
        cell.setAttribute('aria-disabled', 'true');
        cell.removeAttribute('aria-selected');
        t.textContent = '';
        b.textContent = '';
      } else {
        cell.removeAttribute('aria-disabled');
        if (day.school) {
          const short = shortOfDay(project, day.dayTypeId);
          t.textContent = short;
          t.classList.toggle('is-long', short.length >= 3);
          b.textContent = day.bellsId === null ? '' : shortOfBells(project, day.bellsId);
          const tint = tintOf(project, day.dayTypeId);
          if (tint) cell.style.setProperty('--tint', tint);
          cell.classList.add('is-school');
          cell.dataset.day = day.dayTypeId;
        } else {
          t.textContent = closedWord(day);
          t.classList.toggle('is-long', t.textContent.length >= 3);
          b.textContent = '';
          cell.classList.add('is-closed');
          delete cell.dataset.day;
        }
        if (day.changed) cell.classList.add('is-changed');
        const selected = chosen !== null && date >= chosen.from && date <= chosen.to;
        cell.setAttribute('aria-selected', String(selected));
        cell.dataset.type = dayTypeWords(project, day);
      }
      if (date === today) cell.setAttribute('aria-current', 'date');
      else cell.removeAttribute('aria-current');
      const name = dateName(project, date, today);
      if (cell.firstChild.textContent !== name) cell.firstChild.textContent = name;
      cell.tabIndex = date === cursor ? 0 : -1;
    }
    const selected = chosen && chosen.from !== chosen.to ? daysBetween(chosen.from, chosen.to) + 1 : 0;
    hooks.status(selected > 1 ? selected + ' dates selected, ' + runWords(chosen.from, chosen.to) : '');
  }

  // Put the cursor (and with `stretch`, the end of the run) on a date.
  function moveTo(date, stretch) {
    const next = clamp(date);
    if (!cells.has(next)) return;
    if (stretch) {
      if (anchor === null) anchor = cursor;
    } else {
      anchor = null;
    }
    cursor = next;
    paint();
    cells.get(cursor).focus();
  }

  function monthStep(date, months) {
    let year = Number(date.slice(0, 4));
    let month = Number(date.slice(5, 7)) + months;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(Number(date.slice(8, 10)), length);
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  element.addEventListener('keydown', (event) => {
    const cell = event.target.closest ? event.target.closest('.cal-day') : null;
    if (!cell || event.ctrlKey || event.metaKey || event.altKey) return;
    const date = cell.dataset.date;
    let next = null;
    const back = (weekdayOf(date) - firstDay + 7) % 7;
    if (event.key === 'ArrowRight') next = addDays(date, 1);
    else if (event.key === 'ArrowLeft') next = addDays(date, -1);
    else if (event.key === 'ArrowDown') next = addDays(date, 7);
    else if (event.key === 'ArrowUp') next = addDays(date, -7);
    else if (event.key === 'PageDown') next = monthStep(date, 1);
    else if (event.key === 'PageUp') next = monthStep(date, -1);
    else if (event.key === 'Home') next = addDays(date, -back);
    else if (event.key === 'End') next = addDays(date, 6 - back);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (cell.getAttribute('aria-disabled') === 'true') return;
      if (cursor !== date) moveTo(date, false);
      const chosen = run();
      hooks.open(chosen.from, chosen.to, cells.get(cursor));
      return;
    } else return;
    event.preventDefault();
    const stretch = event.shiftKey;
    moveTo(next, stretch);
  });

  // A press with Shift stretches the run from the date last focused; the
  // focus it gives the square must not move the anchor first.
  let stretching = false;
  element.addEventListener('mousedown', (event) => {
    stretching = event.shiftKey && cursor !== null;
  }, true);

  element.addEventListener('click', (event) => {
    stretching = false;
    const cell = event.target.closest ? event.target.closest('.cal-day') : null;
    if (!cell || cell.getAttribute('aria-disabled') === 'true') return;
    moveTo(cell.dataset.date, event.shiftKey && cursor !== null);
    const chosen = run();
    hooks.open(chosen.from, chosen.to, cells.get(cursor));
  });

  // The roving stop follows a square that takes the focus some other way.
  element.addEventListener('focusin', (event) => {
    const cell = event.target.closest ? event.target.closest('.cal-day') : null;
    if (!cell || cell.dataset.date === cursor || cell.getAttribute('aria-disabled') === 'true') return;
    if (stretching) return;
    cursor = cell.dataset.date;
    anchor = null;
    paint();
  });

  return {
    element,
    update(next, nextToday) {
      project = next;
      today = nextToday;
      const calendar = calendarOf(project);
      const days = calendarDays(project);
      if (!calendar || days.length === 0) {
        element.replaceChildren();
        built = '';
        return;
      }
      range = { start: days[0].date, end: days[days.length - 1].date };
      const key = range.start + '/' + range.end + '/' + firstDayOf(locale());
      if (key !== built) {
        build(calendar);
        built = key;
      }
      if (cursor === null || !isCalendarDate(cursor) || cursor < range.start || cursor > range.end) {
        cursor = today >= range.start && today <= range.end ? today : range.start;
        anchor = null;
      }
      if (anchor !== null && (anchor < range.start || anchor > range.end)) anchor = null;
      paint();
    },
    cellOf: (date) => cells.get(date) || null,
    selection: run,
    // a run chosen elsewhere (the dialog's Through): the squares say so
    choose(from, to) {
      if (!cells.has(from)) return;
      anchor = from;
      cursor = cells.has(to) ? to : from;
      paint();
    },
    focusDate(date) {
      if (!cells.has(date)) return;
      cursor = date;
      anchor = null;
      paint();
      cells.get(date).focus();
    },
  };
}
