// #/calendar?m=2026-11  Calendar
//
// The school's calendar as published, one month at a time (DESIGN 11.8):
// "Calendar as published on 3 December.", the month as squares with the
// previous and next month beside it, today ringed, and under it the month as
// a list, which is the text alternative and a phone's main reading: every
// school day with its day type and bells, and every date with no school that
// a reader would otherwise expect school on, with its note. Every date's day
// is engine/calendar.js's answer (through ctx.school), with the reader's own
// "Not right?" answer laid over it as every other page has it. On paper: the
// month and its list.
//
// Shown only when the file has a calendar; an address for it in a copy with
// none says so. Drawn again when today changes while it is open.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, printWhen } from '../page.js';
import { todayOf, todayKey, todayLine, readDayOn, answerFor, nowTabs, hasCalendar, localDate, watchClock } from '../clock.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// How many day types take a tint of their own; past these the short name
// alone tells them apart (it always does: the tint is never the only mark).
export const CALENDAR_TINTS = 8;
// The longest first word of a note a square with no school shows instead of
// "No" (the list under the month always has the whole note).
export const CLOSED_WORD_MOST = 5;

// The first day of the reader's week, 0 Monday to 6 Sunday: the locale's,
// where the browser can say, else Sunday.
export function weekStartOf(locale) {
  try {
    const found = new Intl.Locale(locale || navigator.language || 'en-US');
    const info = typeof found.getWeekInfo === 'function' ? found.getWeekInfo() : found.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return (info.firstDay + 6) % 7;
  } catch (error) {
    // no week information here
  }
  return 6;
}

// "2026-11" → the month's first date, "2026-11-01"; null for anything else.
function monthStart(text) {
  return typeof text === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(text) ? text + '-01' : null;
}

function monthOf(date) {
  return date.slice(0, 7);
}

function monthWords(month) {
  return MONTHS[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4);
}

// The month after (or with -1 before) "2026-11".
function stepMonth(month, by) {
  let year = Number(month.slice(0, 4));
  let index = Number(month.slice(5, 7)) - 1 + by;
  year += Math.floor(index / 12);
  index = ((index % 12) + 12) % 12;
  return String(year).padStart(4, '0') + '-' + String(index + 1).padStart(2, '0');
}

// The days of the calendar by date, with today's answer laid over as the
// reader has it: { date → { school, dayTypeId, bellsId, label, why, changed } }.
function daysByDate(ctx) {
  const school = ctx.school;
  const answers = readDayOn(ctx);
  const byDate = new Map();
  for (const day of school.calendarDays()) {
    const own = answers.follow !== null && answers.follow.date <= day.date ? school.dayOn(day.date, answers.follow) : day;
    byDate.set(day.date, own);
  }
  // the answer given last for a date settles that date
  for (const answer of [answers.follow, answers.just]) {
    if (answer !== null && byDate.has(answer.date) && answerFor(answers, answer.date) === answer) {
      byDate.set(answer.date, { ...byDate.get(answer.date), school: true, dayTypeId: answer.dayTypeId, bellsId: answer.bellsId });
    }
  }
  return byDate;
}

// The one place the month is said in. It is on the page before its words
// change (a live region put on the page already holding words is not
// announced), and the same one serves every month: the page is drawn again
// for each, and a region drawn with it would be new each time.
const SAID_FOR_MS = 10000;
let saidTimer = 0;

function monthStatus() {
  let region = document.querySelector('[data-says="month"]');
  if (!region) {
    region = h('span', { class: 'visually-hidden', role: 'status', dataset: { says: 'month' } });
    document.body.appendChild(region);
  }
  return region;
}

function sayMonth(region, words) {
  globalThis.clearTimeout(saidTimer);
  region.textContent = words;
  // said once, then not left to be read as part of some other page
  saidTimer = globalThis.setTimeout(() => {
    region.textContent = '';
  }, SAID_FOR_MS);
}

// Was this page reached by pressing Previous or Next month on the calendar
// page it replaces? That page says so on its own step control when it is
// pressed (an unmodified click that nothing stopped), which is gone with the
// page: nothing is remembered once it has been left, so a click that went
// nowhere, or opened elsewhere, leads no later visit to take the focus.
function reachedByStep(month) {
  const from = document.querySelector('.cal__nav[data-to]');
  return from && from.dataset.to === month ? from.dataset.pressed : null;
}

function pressedStep(event, by, to) {
  if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const nav = event.currentTarget.closest('.cal__nav');
  if (!nav) return;
  nav.dataset.pressed = by < 0 ? 'previous' : 'next';
  nav.dataset.to = to;
}

export const calendarView = {
  id: 'calendar',
  flag: 'calendar',
  nav: 'now',
  title() {
    return 'Calendar';
  },
  render(ctx, route) {
    const school = ctx.school;
    if (!hasCalendar(school)) {
      return printWhen(pageOf('Calendar', 'This copy of the schedule has no calendar. Which day type each day is comes from the office.', nowTabs(school, 'calendar')), false);
    }
    const calendar = school.calendar;
    const today = todayOf(ctx);
    const first = monthOf(calendar.start);
    const last = monthOf(calendar.end);
    const asked = monthStart(route.query.m) ? route.query.m : null;
    let month = asked && asked >= first && asked <= last ? asked : monthOf(today.date);
    if (month < first) month = first;
    if (month > last) month = last;

    const days = daysByDate(ctx);
    const dayTypes = new Map(school.dayTypes.map((dayType, at) => [dayType.id, { dayType, at }]));
    const dayNameOf = (id) => (dayTypes.has(id) ? dayTypes.get(id).dayType.name : '');
    const scheduleOf = (id) => (id ? school.bellSchedule(id) : null);

    // ---- the squares
    const start = month + '-01';
    const length = school.daysBetween(start, stepMonth(month, 1) + '-01');
    const weekStart = weekStartOf();
    const lead = (school.weekdayOf(start) - weekStart + 7) % 7;
    const order = Array.from({ length: 7 }, (unused, at) => (weekStart + at) % 7);
    const cells = [];
    for (let at = 0; at < lead; at += 1) cells.push(null);
    for (let at = 0; at < length; at += 1) cells.push(school.addDays(start, at));
    while (cells.length % 7 !== 0) cells.push(null);

    const cellOf = (date) => {
      if (date === null) return h('td', { class: 'cal__blank' });
      const day = days.get(date) || null;
      const number = String(Number(date.slice(8, 10)));
      const isToday = date === today.date;
      if (!day) return h('td', { class: 'cal__date cal__date--out', 'aria-current': isToday ? 'date' : null }, h('span', { class: 'cal__num' }, number));
      if (!day.school) {
        // the note's first word when it fits a square ("Snow"), else "No"
        const first = day.label ? day.label.trim().split(/\s+/u)[0] : '';
        const word = first !== '' && Array.from(first).length <= CLOSED_WORD_MOST ? first : 'No';
        return h('td', { class: 'cal__date cal__date--closed', 'aria-current': isToday ? 'date' : null, dataset: { date } },
          h('span', { class: 'cal__num' }, number),
          h('span', { class: 'cal__day' }, typed(word || 'No')));
      }
      const known = dayTypes.get(day.dayTypeId);
      const short = known ? school.dayShort(known.dayType) : '';
      const schedule = scheduleOf(day.bellsId);
      return h('td', { class: 'cal__date', 'aria-current': isToday ? 'date' : null, dataset: known && known.at < CALENDAR_TINTS ? { date, tint: String(known.at + 1) } : { date } },
        h('span', { class: 'cal__num' }, number),
        h('span', { class: 'cal__day' + (Array.from(short).length > 2 ? ' cal__day--long' : '') }, typed(short)),
        schedule ? h('span', { class: 'cal__bells' }, typed(school.bellsShort(schedule))) : null);
    };
    const rows = [];
    for (let at = 0; at < cells.length; at += 7) rows.push(h('tr', null, cells.slice(at, at + 7).map(cellOf)));
    const grid = h('table', { class: 'cal', 'aria-hidden': 'true', dataset: { month } },
      h('thead', null, h('tr', null, order.map((weekday) => h('th', { scope: 'col' }, h('abbr', { title: WEEKDAYS[weekday] }, WEEKDAYS[weekday].slice(0, 3)))))),
      h('tbody', null, rows));

    // ---- the key: the day types and bell schedules this month shows
    const shownDays = new Set();
    const shownBells = new Set();
    let closed = false;
    for (const date of cells) {
      const day = date ? days.get(date) : null;
      if (!day) continue;
      if (!day.school) closed = true;
      else {
        shownDays.add(day.dayTypeId);
        if (day.bellsId) shownBells.add(day.bellsId);
      }
    }
    const keyItems = school.dayTypes.filter((dayType) => shownDays.has(dayType.id)).map((dayType) => h('li', { class: 'cal__key', dataset: dayTypes.get(dayType.id).at < CALENDAR_TINTS ? { tint: String(dayTypes.get(dayType.id).at + 1) } : {} },
      h('span', { class: 'cal__keymark' }, typed(school.dayShort(dayType))), ' ', typed(dayType.name)))
      .concat(school.bellSchedules.filter((schedule) => shownBells.has(schedule.id)).map((schedule) => h('li', { class: 'cal__key' },
        h('span', { class: 'cal__keymark cal__keymark--bells' }, typed(school.bellsShort(schedule))), ' ', typed(schedule.name), ' bells')))
      .concat(closed ? [h('li', { class: 'cal__key cal__key--closed' }, h('span', { class: 'cal__keymark' }, 'No'), ' No school')] : []);

    // ---- the month as a list: what a reader reads
    const items = [];
    for (let at = 0; at < length; at += 1) {
      const date = school.addDays(start, at);
      const day = days.get(date);
      if (!day) continue;
      // a weekend with nothing to say is left out: no school is what it always is
      if (!day.school && day.why === 'weekday' && !day.changed && !day.label) continue;
      const words = [h('span', { class: 'cal__when' }, school.dateWords(date, { weekday: true, year: false })), ': '];
      if (day.school) {
        const schedule = scheduleOf(day.bellsId);
        words.push(typed(dayNameOf(day.dayTypeId)), schedule ? [', ', typed(schedule.name), ' bells'] : null, day.label ? [' · ', typed(day.label)] : null);
      } else {
        words.push('No school', day.label ? [', ', typed(day.label)] : null);
      }
      items.push(h('li', { class: 'cal__item' + (date === today.date ? ' cal__item--today' : '') + (day.school ? '' : ' cal__item--closed'), 'aria-current': date === today.date ? 'date' : null, dataset: { date } },
        words, date === today.date ? h('span', { class: 'cal__tag' }, ' Today') : null));
    }

    const step = (by, name) => {
      const to = stepMonth(month, by);
      const inside = to >= first && to <= last;
      return inside
        ? h('a', { class: 'btn cal__step', href: makeHash('calendar', '', { m: to }), dataset: { step: by < 0 ? 'previous' : 'next' }, onclick: (event) => pressedStep(event, by, to) }, name, h('span', { class: 'visually-hidden' }, ': ' + monthWords(to)))
        : h('span', { class: 'btn cal__step', 'aria-disabled': 'true', dataset: { step: by < 0 ? 'previous' : 'next' } }, name);
    };
    const heading = h('h2', { class: 'cal__month', id: 'cal-month' }, monthWords(month));
    const nav = h('div', { class: 'cal__nav no-print' }, step(-1, 'Previous month'), step(1, 'Next month'));
    // Previous or Next drew the page again: the focus stays on the control
    // that was pressed (the other one where the month is the first or last
    // there is) and the new month is said once the page is on screen
    const says = monthStatus();
    const used = reachedByStep(month);
    if (used === null) {
      globalThis.clearTimeout(saidTimer);
      says.textContent = '';
    } else {
      Promise.resolve().then(() => {
        const control = nav.querySelector('a[data-step=' + used + ']') || nav.querySelector('a[data-step]');
        if (control && control.isConnected) control.focus({ preventScroll: true });
        sayMonth(says, monthWords(month));
      });
    }

    // the day the file was made, in the reader's zone, in the calendar's own words
    const made = Date.parse(school.data.publishedAt);
    const madeOn = Number.isFinite(made) ? localDate(new Date(made)) : null;
    const lede = ['Calendar as published on ', madeOn ? school.dateWords(madeOn, { year: madeOn.slice(0, 4) !== today.date.slice(0, 4) }) : 'an unknown date', '. It covers ', school.dateWords(calendar.start), ' to ', school.dateWords(calendar.end), '.'];
    const page = pageOf('Calendar', lede,
      nowTabs(school, 'calendar'),
      todayLine(ctx, () => ctx.redraw()),
      h('section', { class: 'card cal__card', 'aria-labelledby': 'cal-month' },
        h('div', { class: 'cal__top' }, heading, nav),
        grid,
        keyItems.length > 0 ? h('ul', { class: 'cal__keys', 'aria-label': 'Key' }, keyItems) : null),
      h('section', { class: 'part', 'aria-label': 'Every date of ' + monthWords(month) },
        h('h2', { class: 'part__title' }, 'Every date of ', monthWords(month)),
        items.length > 0 ? h('ul', { class: 'list plain cal__list' }, items) : h('p', { class: 'muted' }, 'No school days this month.')));
    // past midnight, or woken the next morning: today's ring and line move
    const key = todayKey(today);
    watchClock(page, () => {
      if (todayKey(todayOf(ctx)) !== key) ctx.redraw();
    });
    return page;
  },
};
