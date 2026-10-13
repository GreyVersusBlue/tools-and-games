// "Now", for every page that asks: which period it is by the reader's own
// clock and the school's bells, which day type the reader said today is, and
// the two pickers that go with them. The pages that show "right now" ask to be
// told when the answer changes; the clock is read again every 30 seconds and
// whenever the page comes back into view, since a sleeping phone stops timers.
//
// No rule about the school is written here. A bell time is engine/bells.js's
// and a teacher's day is engine/teacher-day.js's, both asked through the
// school of model.js.
//
// A published file has no calendar, so the day type is chosen by hand and
// kept on the device under sv2staff:<schoolId>:day.
//
// For the tests: a page that has `globalThis.sv2StaffClock = { now, every }`
// takes the time from now() (a Date, or milliseconds, or an ISO string) and
// reads it again every `every` milliseconds. Nothing else is changed by it.

import { h, typed } from './dom.js';
import { makeHash } from './router.js';

export const CLOCK_EVERY_MS = 30000;
export const DAY_TYPE_KEY = 'day';

function hook() {
  const given = globalThis.sv2StaffClock;
  return given && typeof given === 'object' ? given : null;
}

// The time, as a Date.
export function clockNow(ctx) {
  const given = hook();
  if (given && typeof given.now === 'function') {
    const value = given.now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return ctx.now();
}

function clockEvery() {
  const given = hook();
  return given && Number.isFinite(given.every) && given.every > 0 ? given.every : CLOCK_EVERY_MS;
}

// The day type the reader chose, or the school's first.
export function chosenDayType(ctx) {
  const kept = ctx.store.get(DAY_TYPE_KEY);
  const found = kept ? ctx.school.dayTypes.find((dayType) => dayType.id === kept) : null;
  return found || ctx.school.dayTypes[0];
}

export function rememberDayType(ctx, dayTypeId) {
  if (ctx.school.dayTypes.some((dayType) => dayType.id === dayTypeId)) ctx.store.set(DAY_TYPE_KEY, dayTypeId);
}

// The day type an address names with ?d=…, else the reader's own.
export function dayTypeFor(ctx, route) {
  const named = route.query.d ? ctx.school.dayTypes.find((dayType) => dayType.id === route.query.d) : null;
  return named || chosenDayType(ctx);
}

// "9:44 AM to 10:32 AM", or '' when the period has no bell times.
export function periodTimes(school, dayTypeId, period) {
  const bell = school.bells(dayTypeId)[period];
  if (!bell || !bell.start || !bell.end) return '';
  return school.time(bell.start) + ' to ' + school.time(bell.end);
}

// Where a moment falls in a day type's bells:
//
//   { state, period, next, shown, minutes }
//
//   state   'in'       inside period `period`
//           'passing'  between two periods; `next` is the one about to start
//           'before'   before the first bell; `next` is the first period
//           'after'    after the last bell
//           'unknown'  the day type has no bell times
//   shown   the period a page shows when nobody chose one: the period it is,
//           the one about to start, or the first of the day
export function momentOf(school, dayTypeId, date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const timed = [];
  school.bells(dayTypeId).forEach((bell, period) => {
    const start = bell ? school.parseTime(bell.start) : null;
    const end = bell ? school.parseTime(bell.end) : null;
    if (start !== null && end !== null && end > start) timed.push({ period, start, end });
  });
  timed.sort((a, b) => a.start - b.start);
  const first = timed.length > 0 ? timed[0].period : 0;
  if (timed.length === 0) return { state: 'unknown', period: null, next: null, shown: 0, minutes };
  for (const bell of timed) {
    if (minutes >= bell.start && minutes < bell.end) return { state: 'in', period: bell.period, next: null, shown: bell.period, minutes };
  }
  const coming = timed.find((bell) => bell.start > minutes);
  if (!coming) return { state: 'after', period: null, next: null, shown: first, minutes };
  if (coming === timed[0]) return { state: 'before', period: null, next: coming.period, shown: coming.period, minutes };
  return { state: 'passing', period: null, next: coming.period, shown: coming.period, minutes };
}

// What makes two moments the same answer: a page is drawn again only when
// this changes.
export function momentKey(dayTypeId, moment) {
  return [dayTypeId, moment.state, moment.period, moment.next].join(':');
}

// The moment in words, as pieces for a sentence: "It is Period 3 on A Day,
// 9:44 AM to 10:32 AM."
export function momentWords(school, dayType, moment) {
  const day = typed(dayType.name);
  const start = (period) => {
    const bell = school.bells(dayType.id)[period];
    return bell && bell.start ? school.time(bell.start) : '';
  };
  if (moment.state === 'in') return ['It is ', school.periodName(moment.period), ' on ', day, ', ', periodTimes(school, dayType.id, moment.period), '.'];
  if (moment.state === 'passing') return ['It is passing time on ', day, '. ', school.periodName(moment.next), ' starts at ', start(moment.next), '.'];
  if (moment.state === 'before') return ['The day has not started on ', day, '. ', school.periodName(moment.next), ' starts at ', start(moment.next), '.'];
  if (moment.state === 'after') return ['The last bell on ', day, ' has gone.'];
  return [day, ' has no bell times in this schedule, so the current ', school.data.settings.periodWord.toLowerCase(), ' is not known.'];
}

// One watcher at a time: the page on screen. `tick()` is called every 30
// seconds and when the page comes back into view, for as long as `node` is on
// the page; a watcher whose node has gone stops itself.
let watching = null;

function stopWatching() {
  if (!watching) return;
  globalThis.clearInterval(watching.timer);
  document.removeEventListener('visibilitychange', watching.seen);
  watching = null;
}

export function watchClock(node, tick) {
  stopWatching();
  const mine = { timer: 0, seen: null };
  const run = () => {
    if (watching !== mine) return;
    if (!node.isConnected) {
      stopWatching();
      return;
    }
    tick();
  };
  mine.seen = () => {
    if (!document.hidden) run();
  };
  // the node is put on the page after render() returns, so the first look is
  // a whole interval away
  mine.timer = globalThis.setInterval(run, clockEvery());
  document.addEventListener('visibilitychange', mine.seen);
  watching = mine;
}

// Every teacher's day on a day type, worked out once per school and day type:
// a Map of teacher id to the day engine/teacher-day.js gives.
const days = new WeakMap();

export function everyTeacherDay(school, dayTypeId) {
  if (!days.has(school)) days.set(school, new Map());
  const kept = days.get(school);
  if (!kept.has(dayTypeId)) {
    const made = new Map();
    for (const teacher of school.teachers) made.set(teacher.id, school.teacherDay(teacher.id, dayTypeId) || []);
    kept.set(dayTypeId, made);
  }
  return kept.get(dayTypeId);
}

let serial = 0;

// "Day type": one button a day type, the chosen one marked. Choosing one keeps
// it on the device and calls onChoose(dayType). A school with one day type
// has nothing to choose and gets no picker.
export function dayTypePicker(ctx, chosenId, onChoose) {
  const school = ctx.school;
  if (school.dayTypes.length < 2) return null;
  serial += 1;
  const group = 'day-type-' + serial;
  return h('fieldset', { class: 'pick', dataset: { pick: 'day' } },
    h('legend', { class: 'field__label' }, 'Day type'),
    h('div', { class: 'pick__items' }, school.dayTypes.map((dayType) => {
      const input = h('input', { class: 'pick__input', type: 'radio', name: group, value: dayType.id, checked: dayType.id === chosenId });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        rememberDayType(ctx, dayType.id);
        onChoose(dayType);
      });
      return h('label', { class: 'pick__item' }, input, h('span', { class: 'pick__name' }, typed(dayType.name)));
    })));
}

// "Period": "Now" and then every period with its times. `value` is '' for
// now, or a period's index. onChoose('' | index).
export function periodPicker(school, dayTypeId, value, onChoose) {
  serial += 1;
  const id = 'period-' + serial;
  const options = [h('option', { value: '', selected: value === '' }, 'Now')];
  for (let period = 0; period < school.data.settings.periods; period += 1) {
    const times = periodTimes(school, dayTypeId, period);
    options.push(h('option', { value: String(period), selected: value === period }, school.periodName(period) + (times ? ', ' + times : '')));
  }
  const select = h('select', { class: 'field__input', id, dataset: { pick: 'period' } }, options);
  select.addEventListener('change', () => onChoose(select.value === '' ? '' : Number(select.value)));
  return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, school.data.settings.periodWord), select);
}

// The period an address names with ?p=…: '' for now, or an index that exists.
export function periodFor(school, route) {
  const text = route.query.p;
  if (text === undefined || text === '' || !/^\d+$/.test(text)) return '';
  const period = Number(text);
  return period < school.data.settings.periods ? period : '';
}

// "A Day", "A Day and B Day", "A Day, B Day and C Day", each name as typed.
export function dayTypeNames(dayTypes) {
  const pieces = [];
  dayTypes.forEach((dayType, index) => {
    if (index > 0) pieces.push(index === dayTypes.length - 1 ? ' and ' : ', ');
    pieces.push(typed(dayType.name));
  });
  return pieces;
}

// ---- pieces the pages built on this module share

// A link to a teacher's, a group's or a room's page; plain text where the
// publisher left that view out of the file.
export function viewLink(school, view, id, children, className) {
  if (!school.has(view)) return h('span', { class: className || null }, children);
  return h('a', { class: className || null, href: makeHash(view, id) }, children);
}

// "Where right now" and "Free right now" are the two pages behind the bar's
// Now: each carries the pair, with its own marked.
export function nowTabs(school, current) {
  if (!school.has('now') || !school.has('free')) return null;
  const tab = (view, name) => h('a', { class: 'tab', href: makeHash(view), 'aria-current': view === current ? 'page' : null }, name);
  return h('nav', { class: 'tabs', 'aria-label': 'Now' }, tab('now', 'Where right now'), tab('free', 'Free right now'));
}

// A heading inside a page, with a count when there is one: "Teachers free (5)".
export function sectionHeading(text, count) {
  return h('h2', { class: 'results__heading' }, text, typeof count === 'number' ? ' (' + count + ')' : null);
}

// A teacher's subject and rooms, for the small line under a name:
// "Science · Room 103".
export function teacherDetail(school, teacher) {
  const pieces = [];
  const subject = school.subject(teacher.subjectId);
  if (subject) pieces.push(typed(subject.name));
  const rooms = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean);
  if (rooms.length > 0) {
    if (pieces.length > 0) pieces.push(' · ');
    rooms.forEach((room, index) => pieces.push(index > 0 ? ', ' : null, typed(school.roomName(room, true))));
  }
  return pieces;
}

// What a teacher has in one period of their day, as pieces: "6A in Room 103",
// "6C and 7C in Room 203", or "Planning".
export function entryWords(school, entry) {
  if (!entry || entry.kind !== 'teaching') return ['Planning'];
  const pieces = [];
  const roomIds = [];
  entry.groups.forEach((taught, index) => {
    const group = school.group(taught.groupId);
    if (index > 0) pieces.push(index === entry.groups.length - 1 ? ' and ' : ', ');
    pieces.push(viewLink(school, 'group', taught.groupId, typed(group ? group.name : 'a group')));
    if (taught.roomId !== null && !roomIds.includes(taught.roomId)) roomIds.push(taught.roomId);
  });
  if (roomIds.length === 0) return pieces.concat(' in a room that is not in the building');
  pieces.push(' in ');
  roomIds.forEach((roomId, index) => {
    if (index > 0) pieces.push(index === roomIds.length - 1 ? ' and ' : ', ');
    pieces.push(viewLink(school, 'room', roomId, typed(school.roomName(school.room(roomId)))));
  });
  return pieces;
}
