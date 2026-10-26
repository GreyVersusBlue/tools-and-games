// #/now  Where right now
//
// Pick a group: the room it is in this period, and the teacher. Pick a
// teacher: the group and the room, or that the period is planning. The period
// is the one it is by the reader's clock and the school's bells, read again as
// time passes, or one chosen. The choice is kept in the address
// (?g=… or ?t=…, and ?p=2&d=…&b=… for a chosen period). The day type and
// bells are today's (staff/clock.js), as on Free right now.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, printGate } from '../page.js';
import { aroundRoom } from '../map.js';
import { clockNow, dayTypeFor, bellsIdFor, chosenDayType, chosenBells, todayOf, todayKey, todayLine, dayWords, momentOf, momentKey, momentWords, periodTimes, periodFor, watchClock, everyTeacherDay, dayTypePicker, bellsPicker, periodPicker, viewLink, nowTabs, entryWords } from '../clock.js';

// The teachers who have a group in a period, by the engine's rule.
function teachersOf(school, groupId, dayTypeId, period) {
  const days = everyTeacherDay(school, dayTypeId);
  return school.teachers.filter((teacher) => {
    const entry = days.get(teacher.id)[period];
    return Boolean(entry) && entry.groups.some((taught) => taught.groupId === groupId);
  });
}

function names(school, view, items, nameOf) {
  const pieces = [];
  items.forEach((item, index) => {
    if (index > 0) pieces.push(index === items.length - 1 ? ' and ' : ', ');
    pieces.push(viewLink(school, view, item.id, typed(nameOf(item))));
  });
  return pieces;
}

// Where a room is: in words, with the way to its floor on the map, and then
// the room and what is near it as a picture.
function whereRoom(ctx, room) {
  const school = ctx.school;
  const floor = school.floorOfRoom(room.id);
  if (!floor) return null;
  const near = aroundRoom(ctx, room);
  return [
    h('p', { dataset: { where: 'floor' } },
      typed(school.roomName(room, true)), ' is on ', typed(floor.name), room.wing ? [', ', typed(room.wing)] : null, '. ',
      school.has('map') ? h('a', { href: makeHash('map', floor.id) }, 'Show ', typed(floor.name), ' on the map') : null),
    near ? h('div', { dataset: { where: 'map' } }, near) : null,
  ];
}

export const nowView = {
  id: 'now',
  flag: 'now',
  nav: 'now',
  title(ctx, route) {
    return 'Where right now';
  },
  render(ctx, route) {
    const school = ctx.school;
    const state = {
      dayType: dayTypeFor(ctx, route),
      bellsId: bellsIdFor(ctx, route),
      period: periodFor(school, route),
      group: school.group(route.query.g) ? route.query.g : '',
      teacher: !school.group(route.query.g) && school.teacher(route.query.t) ? route.query.t : '',
    };
    let lastKey = '';
    let lastToday = '';

    const says = h('p', { class: 'lede', role: 'status' });
    const todayOut = h('div', { dataset: { part: 'today' } });
    const pickers = h('div', { class: 'controls' });
    const momentNow = () => momentOf(school, state.dayType.id, clockNow(ctx), state.bellsId);
    const settle = () => {
      if (state.period !== '') return;
      state.dayType = chosenDayType(ctx);
      state.bellsId = chosenBells(ctx);
    };
    const out = h('div', { class: 'card', dataset: { out: 'where' } });

    const address = () => {
      const chosen = state.period !== '';
      ctx.replace(makeHash('now', '', {
        g: state.group,
        t: state.teacher,
        p: chosen ? String(state.period) : '',
        d: chosen ? state.dayType.id : '',
        b: chosen && state.bellsId ? state.bellsId : '',
      }));
    };

    const groupCard = (period, when) => {
      const group = school.group(state.group);
      const slot = school.groupDay(group.id, state.dayType.id)[period];
      const room = slot && slot.room ? school.room(slot.room) : null;
      const who = teachersOf(school, group.id, state.dayType.id, period);
      const name = viewLink(school, 'group', group.id, typed(group.name));
      let sentence;
      if (room) sentence = [name, ' is in ', viewLink(school, 'room', room.id, typed(school.roomName(room))), who.length > 0 ? [' with ', names(school, 'teacher', who, (teacher) => teacher.name)] : null, when, '.'];
      else if (slot && slot.roomText) sentence = [name, ' is in ', typed(slot.roomText), ', which is not in the building', when, '.'];
      else sentence = [name, ' has no room', when, '.'];
      return [
        h('p', { class: 'card__title', dataset: { where: 'sentence' } }, sentence),
        slot && slot.label ? h('p', { class: 'muted' }, typed(slot.label)) : null,
        room ? whereRoom(ctx, room) : null,
      ];
    };

    const teacherCard = (period, when) => {
      const teacher = school.teacher(state.teacher);
      const entry = everyTeacherDay(school, state.dayType.id).get(teacher.id)[period];
      const name = viewLink(school, 'teacher', teacher.id, typed(teacher.name));
      const based = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean);
      if (entry && entry.kind === 'teaching') {
        const rooms = entry.groups.map((taught) => taught.roomId).filter((id, index, all) => id !== null && all.indexOf(id) === index).map((id) => school.room(id));
        return [
          h('p', { class: 'card__title', dataset: { where: 'sentence' } }, name, ' has ', entryWords(school, entry), when, '.'),
          rooms.map((room) => whereRoom(ctx, room)),
        ];
      }
      return [
        h('p', { class: 'card__title', dataset: { where: 'sentence' } }, name, ' has no group', when, ': it is planning.'),
        based.length > 0 ? h('p', null, 'Based in ', names(school, 'room', based, (room) => school.roomName(room)), '.') : null,
        based.map((room) => whereRoom(ctx, room)),
      ];
    };

    const gate = printGate();
    const draw = () => {
      gate.set(Boolean(state.group || state.teacher));
      const today = todayOf(ctx);
      const moment = momentNow();
      lastKey = momentKey(state.dayType.id, moment, state.bellsId);
      lastToday = todayKey(today);
      const period = state.period === '' ? moment.shown : state.period;
      const times = periodTimes(school, state.dayType.id, period, state.bellsId);
      const named = [school.periodName(period), times ? ', ' + times : ''];
      const closed = state.period === '' && today.known && !today.school;
      const live = state.period === '' && !closed && moment.state === 'in';
      // "right now" is said only when it is: otherwise the period is named
      const when = live ? ' right now' : [' in ', school.periodName(period)];
      const day = dayWords(school, state.dayType, state.bellsId);
      const bell = school.bells(state.dayType.id, state.bellsId)[period];
      const off = Boolean(bell && bell.off === true);

      let sentence;
      if (off) sentence = [school.periodName(period), ' does not meet on ', day, '.'];
      else if (state.period !== '' || closed) sentence = [closed ? 'Showing ' : null, named, ' on ', day, '.'];
      else if (moment.state === 'in') sentence = momentWords(school, state.dayType, moment, state.bellsId);
      else sentence = [momentWords(school, state.dayType, moment, state.bellsId), ' Showing ', named, '.'];
      says.replaceChildren(h('span', null, sentence));
      says.dataset.period = String(period);
      says.dataset.moment = off ? 'off' : state.period === '' ? (closed ? 'closed' : moment.state) : 'chosen';

      let body;
      if (off) body = [h('p', { class: 'muted' }, 'Nobody has a class in this ', school.data.settings.periodWord.toLowerCase(), '.')];
      else if (state.group) body = groupCard(period, when);
      else if (state.teacher) body = teacherCard(period, when);
      else body = [h('p', { class: 'muted' }, 'Choose a group or a teacher above.')];
      out.replaceChildren(...body.flat(Infinity).filter(Boolean));
    };

    const who = h('select', { class: 'field__input', id: 'now-who' },
      h('option', { value: '' }, 'Choose…'),
      school.groups.length > 0 ? h('optgroup', { label: 'Groups' }, school.groups.map((group) => h('option', { value: 'g:' + group.id, selected: group.id === state.group }, group.name))) : null,
      school.teachers.length > 0 ? h('optgroup', { label: 'Teachers' }, school.teachers.map((teacher) => h('option', { value: 't:' + teacher.id, selected: teacher.id === state.teacher }, teacher.name))) : null);
    who.addEventListener('change', () => {
      state.group = who.value.startsWith('g:') ? who.value.slice(2) : '';
      state.teacher = who.value.startsWith('t:') ? who.value.slice(2) : '';
      address();
      draw();
    });

    const drawPickers = (focus) => {
      const today = todayOf(ctx);
      const asking = state.period !== '' || !today.known || !today.school;
      todayOut.replaceChildren(...[todayLine(ctx, () => {
        settle();
        address();
        drawPickers(null);
        draw();
      })].filter(Boolean));
      pickers.replaceChildren(...[
        asking ? dayTypePicker(ctx, state.dayType.id, (dayType) => {
          state.dayType = dayType;
          address();
          drawPickers('day');
          draw();
        }) : null,
        asking ? bellsPicker(ctx, state.bellsId, (bellsId) => {
          state.bellsId = bellsId;
          address();
          drawPickers('bells');
          draw();
        }) : null,
        periodPicker(school, state.dayType.id, state.period, (value) => {
          const was = state.period;
          state.period = value;
          settle();
          address();
          if ((was === '') !== (value === '')) drawPickers('period');
          draw();
        }, state.bellsId),
      ].filter(Boolean));
      let target = null;
      if (focus === 'day') target = pickers.querySelector('[data-pick="day"] input:checked');
      if (focus === 'bells') target = pickers.querySelector('[data-pick="bells"] input:checked');
      if (focus === 'period') target = pickers.querySelector('[data-pick="period"]');
      if (target) target.focus();
    };

    drawPickers(null);
    draw();
    const page = gate.on(pageOf('Where right now', null, says, nowTabs(school, 'now'), todayOut,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'now-who' }, 'Group or teacher'), who),
      out, pickers));
    watchClock(page, () => {
      if (todayKey(todayOf(ctx)) !== lastToday) {
        settle();
        drawPickers(null);
        draw();
        return;
      }
      if (state.period !== '') return;
      if (momentKey(state.dayType.id, momentNow(), state.bellsId) !== lastKey) draw();
    });
    return page;
  },
};
