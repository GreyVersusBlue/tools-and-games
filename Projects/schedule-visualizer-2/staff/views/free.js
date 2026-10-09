// #/free  Free right now
//
// Which teachers have no group, and which rooms are empty, in one period: the
// period it is by the reader's clock and the school's bells, or one chosen.
// While it shows "now" the page reads the clock again as time passes and is
// drawn again when the period changes. A period chosen by hand is kept in the
// address (?p=2&d=…), so the page can be shared and Back returns to it.
//
// A teacher is free when engine/teacher-day.js says the period is planning; a
// room is empty when no group's day puts a group in it. Rooms can be narrowed
// by seats, subject and wing (?seats=40&subject=…&wing=…).

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf } from '../page.js';
import { clockNow, dayTypeFor, momentOf, momentKey, momentWords, periodTimes, periodFor, watchClock, everyTeacherDay, dayTypePicker, periodPicker, viewLink, nowTabs, sectionHeading, shareRow, teacherDetail } from '../clock.js';

// The teachers with no group in a period, in the school's own order.
export function freeTeachers(school, dayTypeId, period) {
  const days = everyTeacherDay(school, dayTypeId);
  return school.teachers.filter((teacher) => {
    const entry = days.get(teacher.id)[period];
    return Boolean(entry) && entry.kind === 'planning';
  });
}

// The rooms no group is in during a period, in the building's own order.
export function emptyRooms(school, dayTypeId, period) {
  const used = new Set();
  for (const group of school.groups) {
    const slot = school.groupDay(group.id, dayTypeId)[period];
    if (slot && slot.room) used.add(slot.room);
  }
  return school.rooms.filter((room) => !used.has(room.id));
}

function countOf(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function roomDetail(school, room) {
  const pieces = [];
  const add = (piece) => {
    if (pieces.length > 0) pieces.push(' · ');
    pieces.push(piece);
  };
  const floor = school.floorOfRoom(room.id);
  if (floor) add(typed(floor.name));
  if (typeof room.capacity === 'number') add(countOf(room.capacity, 'seat', 'seats'));
  const subject = school.subject(room.subjectId);
  if (subject) add(typed(subject.name));
  if (room.wing) add(typed(room.wing));
  return pieces;
}

export const freeView = {
  id: 'free',
  flag: 'free',
  nav: 'now',
  title(ctx, route) {
    return 'Free right now';
  },
  render(ctx, route) {
    const school = ctx.school;
    const state = {
      dayType: dayTypeFor(ctx, route),
      period: periodFor(school, route),
      seats: /^\d+$/.test(route.query.seats || '') ? Number(route.query.seats) : 0,
      subject: school.subject(route.query.subject) ? route.query.subject : '',
      wing: route.query.wing || '',
    };
    let lastKey = '';

    const says = h('p', { class: 'lede', role: 'status' });
    const pickers = h('div', { class: 'controls' });
    const teachersOut = h('section', { 'aria-label': 'Teachers free' });
    const roomsOut = h('section', { class: 'stack', 'aria-label': 'Rooms empty' });
    const roomList = h('div', { dataset: { out: 'rooms' } });

    const shownPeriod = (moment) => (state.period === '' ? moment.shown : state.period);

    const address = () => {
      const chosen = state.period !== '';
      ctx.replace(makeHash('free', '', {
        p: chosen ? String(state.period) : '',
        d: chosen ? state.dayType.id : '',
        seats: state.seats > 0 ? state.seats : '',
        subject: state.subject,
        wing: state.wing,
      }));
    };

    const drawRooms = (period) => {
      const empty = emptyRooms(school, state.dayType.id, period);
      const unknown = state.seats > 0 ? empty.filter((room) => typeof room.capacity !== 'number').length : 0;
      const shown = empty.filter((room) => (state.seats === 0 || (typeof room.capacity === 'number' && room.capacity >= state.seats))
        && (state.subject === '' || room.subjectId === state.subject)
        && (state.wing === '' || room.wing === state.wing));
      const narrowed = state.seats > 0 || state.subject !== '' || state.wing !== '';
      roomList.replaceChildren(...[
        sectionHeading(narrowed ? 'Rooms empty that match' : 'Rooms empty', shown.length),
        shown.length === 0
          ? h('p', { class: 'muted' }, narrowed ? 'No empty room matches. Ask for less above.' : 'Every room has a group in it.')
          : h('ul', { class: 'list', dataset: { list: 'rooms' } }, shown.map((room) => h('li', null,
            viewLink(school, 'room', room.id, [
              h('span', { class: 'list__name' }, typed(school.roomName(room, true))),
              h('span', { class: 'list__detail' }, roomDetail(school, room)),
            ], 'list__link')))),
        unknown > 0 ? h('p', { class: 'muted' }, countOf(unknown, 'empty room has', 'empty rooms have') + ' no number of seats in this schedule and ' + (unknown === 1 ? 'is' : 'are') + ' left out.') : null,
      ].filter(Boolean));
      return empty.length;
    };

    const draw = () => {
      const moment = momentOf(school, state.dayType.id, clockNow(ctx));
      lastKey = momentKey(state.dayType.id, moment);
      const period = shownPeriod(moment);
      const times = periodTimes(school, state.dayType.id, period);
      const free = freeTeachers(school, state.dayType.id, period);

      teachersOut.replaceChildren(
        sectionHeading('Teachers free', free.length),
        free.length === 0
          ? h('p', { class: 'muted' }, 'Every teacher has a group.')
          : h('ul', { class: 'list', dataset: { list: 'teachers' } }, free.map((teacher) => h('li', null,
            viewLink(school, 'teacher', teacher.id, [
              h('span', { class: 'list__name' }, typed(teacher.name)),
              h('span', { class: 'list__detail' }, teacherDetail(school, teacher)),
            ], 'list__link')))));
      const rooms = drawRooms(period);

      const counts = countOf(free.length, 'teacher', 'teachers') + ' and ' + countOf(rooms, 'room', 'rooms') + ' are free.';
      const named = [school.periodName(period), times ? ', ' + times : ''];
      let sentence;
      if (state.period !== '') sentence = [named, ' on ', typed(state.dayType.name), ': ', counts];
      else if (moment.state === 'in') sentence = [momentWords(school, state.dayType, moment), ' ', counts];
      else sentence = [momentWords(school, state.dayType, moment), ' Showing ', named, ': ', counts];
      says.replaceChildren(h('span', null, sentence));
      says.dataset.period = String(period);
      says.dataset.moment = state.period === '' ? moment.state : 'chosen';
    };

    // The pickers are made again only when the day type changes (the periods'
    // times are the day type's), so choosing a period never moves focus.
    const drawPickers = (focus) => {
      pickers.replaceChildren(...[
        dayTypePicker(ctx, state.dayType.id, (dayType) => {
          state.dayType = dayType;
          address();
          drawPickers(true);
          draw();
        }),
        periodPicker(school, state.dayType.id, state.period, (value) => {
          state.period = value;
          address();
          draw();
        }),
      ].filter(Boolean));
      const checked = focus ? pickers.querySelector('input:checked') : null;
      if (checked) checked.focus();
    };

    // The room filters are made once, so a field keeps its focus while typing.
    const subjects = school.subjects.filter((subject) => school.rooms.some((room) => room.subjectId === subject.id));
    const wings = Array.from(new Set(school.rooms.map((room) => room.wing).filter(Boolean)));
    const seats = h('input', { class: 'field__input', id: 'free-seats', type: 'number', inputmode: 'numeric', min: '1', max: '999', step: '1', value: state.seats > 0 ? String(state.seats) : null });
    const subject = h('select', { class: 'field__input', id: 'free-subject' },
      h('option', { value: '' }, 'Any subject'),
      subjects.map((item) => h('option', { value: item.id, selected: item.id === state.subject }, item.name)));
    const wing = h('select', { class: 'field__input', id: 'free-wing' },
      h('option', { value: '' }, 'Any wing'),
      wings.map((name) => h('option', { value: name, selected: name === state.wing }, name)));
    const again = () => {
      state.seats = /^\d+$/.test(seats.value) ? Number(seats.value) : 0;
      state.subject = subject.value;
      state.wing = wing.value;
      address();
      drawRooms(shownPeriod(momentOf(school, state.dayType.id, clockNow(ctx))));
    };
    seats.addEventListener('input', again);
    subject.addEventListener('change', again);
    wing.addEventListener('change', again);
    roomsOut.replaceChildren(
      h('div', { class: 'controls controls--row' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'free-seats' }, 'Seats, at least'), seats),
        subjects.length > 0 ? h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'free-subject' }, 'Subject'), subject) : null,
        wings.length > 0 ? h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'free-wing' }, 'Wing'), wing) : null),
      roomList);

    drawPickers(false);
    draw();
    const page = pageOf('Free right now', null, says, nowTabs(school, 'free'), pickers, teachersOut, roomsOut, shareRow(() => 'Free right now · ' + school.name));
    watchClock(page, () => {
      if (state.period !== '') return;
      if (momentKey(state.dayType.id, momentOf(school, state.dayType.id, clockNow(ctx))) !== lastKey) draw();
    });
    return page;
  },
};
