// #/door/r…  Door sign
//
// A card for a classroom door: the room's number large, the teacher, the
// subject, and, when the box is ticked (?day=1), who is in the room each
// period. What is on screen is the sheet as it prints, drawn as paper
// whatever the theme; on paper the sheet is all there is (staff/print.css).
// Who is in the room is the room page's own answer (roomUse).

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage, printButton } from '../page.js';
import { wordsJoined, dayKindsOf, kindName } from './teacher.js';
import { roomUse } from './room.js';

// The number is set at 120 pt when it is as short as a number is. A longer
// one ("Cafeteria") is set smaller by this much, so it stays on one line.
export function signFit(text) {
  const length = Array.from(String(text)).length;
  return Math.max(0.3, Math.min(1, 7 / Math.max(1, length)));
}

function dayOf(school, room) {
  const uses = new Map(school.dayTypes.map((dayType) => [dayType.id, roomUse(school, room.id, dayType.id)]));
  const kinds = dayKindsOf(school, (dayType) => uses.get(dayType.id).map((period) => period.map((use) => [use.group.id, use.label, use.teachers.map((teacher) => teacher.id)])));
  return h('div', { class: 'sign__day', dataset: { sign: 'day', count: String(kinds.length) } }, kinds.map((kind) => {
    const bells = school.bells(kind.first.id);
    return h('section', { class: 'sign__kind' },
      h('h2', { class: 'sign__kindname' }, kindName(kind)),
      h('table', { class: 'sign__table' },
        h('tbody', null, uses.get(kind.first.id).map((here, period) => {
          const bell = bells[period];
          const who = [];
          for (const use of here) {
            for (const teacher of use.teachers) {
              if (!who.some((each) => each.id === teacher.id)) who.push(teacher);
            }
          }
          return h('tr', null,
            h('th', { scope: 'row' }, school.periodName(period)),
            h('td', null, bell && bell.start && bell.end ? school.time(bell.start) + ' to ' + school.time(bell.end) : ''),
            h('td', null, here.length === 0 ? 'Empty' : wordsJoined(here.map((use) => typed(use.group.name)))),
            h('td', null, wordsJoined(who.map((teacher) => typed(teacher.name)))));
        }))));
  }));
}

export const doorView = {
  id: 'door',
  flag: 'room',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.room(route.id);
    return found ? 'Door sign: ' + ctx.school.roomName(found, true) : 'Door sign';
  },
  render(ctx, route) {
    const school = ctx.school;
    const room = school.room(route.id);
    if (!room) return missingPage('room');
    const name = school.roomName(room, true);
    const numbered = room.number.trim() !== '';
    // "Room 204" is the word and the number; "Gym" is the number alone
    const worded = numbered && name === 'Room ' + room.number;
    const teachers = (room.teacherIds || []).map((id) => school.teacher(id)).filter(Boolean);
    const subject = school.subject(room.subjectId) || (teachers.length > 0 ? school.subject(teachers[0].subjectId) : null);
    const big = numbered ? room.number : 'Room';

    const day = h('div', { dataset: { sign: 'slot' } });
    const box = h('input', { class: 'check__input', id: 'door-day', type: 'checkbox', checked: route.query.day === '1' });
    const draw = () => day.replaceChildren(...(box.checked ? [dayOf(school, room)] : []));
    box.addEventListener('change', () => {
      ctx.replace(makeHash('door', room.id, { day: box.checked ? '1' : '' }));
      draw();
    });
    draw();

    const sheet = h('div', { class: 'sheet', 'data-theme': 'light', dataset: { sheet: 'door' } },
      h('section', { class: 'sign', 'aria-label': 'The sign' },
        worded ? h('p', { class: 'sign__word' }, 'Room') : null,
        h('p', { class: 'sign__number', style: '--sign-fit: ' + signFit(big), dataset: { sign: 'number' } }, numbered ? typed(big) : big),
        teachers.length > 0 ? h('p', { class: 'sign__teacher', dataset: { sign: 'teacher' } }, wordsJoined(teachers.map((teacher) => typed(teacher.name)))) : null,
        subject ? h('p', { class: 'sign__subject', dataset: { sign: 'subject' } }, typed(subject.name)) : null,
        day,
        h('p', { class: 'sign__school', dataset: { sign: 'school' } }, typed(school.name))));

    return pageOf(['Door sign: ', typed(name)], 'This is the sign as it prints: one sheet for the door.',
      h('div', { class: 'controls no-print' },
        h('label', { class: 'check', for: 'door-day' }, box, h('span', null, 'Show the room\'s day on the sign')),
        h('p', { class: 'actions' },
          printButton('Print the sign', true),
          school.has('room') ? h('a', { class: 'btn', href: makeHash('room', room.id) }, h('span', null, 'Back to ', typed(name))) : null)),
      sheet);
  },
};
