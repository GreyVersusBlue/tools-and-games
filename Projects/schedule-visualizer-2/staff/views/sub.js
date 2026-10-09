// #/sub/t…  Substitute plan
//
// One page to print for a substitute: the absent teacher's day with rooms,
// groups and times, a date line, who could cover each period, where the room
// is, the teacher's notes, and a line saying to check it against the office.
// The page is a single column so it prints as it reads; the pickers and
// buttons are left off the paper.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { dayText } from '../dates.js';
import { aroundRoom } from '../map.js';
import { clockNow, dayTypeFor, periodTimes, everyTeacherDay, dayTypePicker, viewLink, sectionHeading, teacherDetail, entryWords } from '../clock.js';
import { coverageFor, teacherChooser } from './coverage.js';

export const SUB_CANDIDATES = 3;
export const SUB_CHECK_SENTENCE = 'Check this plan with the office before the day starts.';

// The reader's own day, as a date field wants it: "2026-09-01".
function localDay(date) {
  const two = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate());
}

export const subView = {
  id: 'sub',
  flag: 'sub',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? 'Substitute plan: ' + found.name : 'Substitute plan';
  },
  render(ctx, route) {
    const school = ctx.school;
    const absent = route.id ? school.teacher(route.id) : null;
    if (route.id && !absent) return missingPage('teacher');
    if (!absent) return teacherChooser(ctx, 'sub', 'Substitute plan', 'One page to print for a substitute.');

    let dayType = dayTypeFor(ctx, route);
    const now = clockNow(ctx);
    const says = h('p', { class: 'lede' });
    const out = h('div', { class: 'stack', dataset: { out: 'sub' } });
    const based = (absent.roomIds || []).map((id) => school.room(id)).filter(Boolean);

    const date = h('input', { class: 'field__input', id: 'sub-date', type: 'date', value: /^\d{4}-\d{2}-\d{2}$/.test(route.query.date || '') ? route.query.date : localDay(now) });
    const address = () => ctx.replace(makeHash('sub', absent.id, { d: route.query.d ? dayType.id : '', date: date.value !== localDay(now) ? date.value : '' }));
    date.addEventListener('change', address);

    const draw = () => {
      const day = everyTeacherDay(school, dayType.id).get(absent.id);
      const cover = coverageFor(school, absent.id, dayType.id);
      const taught = cover.length;
      says.replaceChildren(typed(absent.name), '\'s day on ', typed(dayType.name), ': ',
        taught === 0 ? 'no group to teach.' : taught + ' of ' + day.length + ' ' + school.data.settings.periodWord.toLowerCase() + 's with a group.');

      out.replaceChildren(...[
        h('section', { class: 'card', dataset: { sub: 'day' } },
          h('h2', { class: 'card__title' }, 'The day: ', typed(dayType.name)),
          h('p', { class: 'muted' }, teacherDetail(school, absent)),
          h('div', { class: 'rows' }, day.map((entry) => h('div', { class: 'row row--plan', dataset: { period: String(entry.period) } },
            h('span', { class: 'row__when' }, school.periodName(entry.period), h('br'), periodTimes(school, dayType.id, entry.period)),
            h('span', { class: entry.kind === 'teaching' ? 'row__what' : 'row__what muted' }, entryWords(school, entry)))))),

        h('section', { class: 'card', dataset: { sub: 'cover' } },
          sectionHeading('Who could cover'),
          taught === 0
            ? h('p', { class: 'muted' }, 'Nothing needs covering.')
            : h('ul', { class: 'plain' }, cover.map((item) => h('li', { dataset: { period: String(item.period) } },
              h('strong', null, school.periodName(item.period), ': '),
              item.candidates.length === 0 ? 'nobody is free.' : item.candidates.slice(0, SUB_CANDIDATES).map((candidate, index) => [
                index > 0 ? ', ' : null,
                viewLink(school, 'teacher', candidate.teacher.id, typed(candidate.teacher.name)),
                candidate.sameSubject ? ' (same subject)' : null,
              ]),
              item.candidates.length > SUB_CANDIDATES ? ', and ' + (item.candidates.length - SUB_CANDIDATES) + ' more' : null))),
          school.has('coverage') ? h('p', { class: 'no-print' }, h('a', { href: makeHash('coverage', absent.id, { d: dayType.id }) }, 'Everyone who is free, period by period')) : null),

        h('section', { class: 'card', dataset: { sub: 'room' } },
          sectionHeading(based.length > 1 ? 'Where the rooms are' : 'Where the room is'),
          based.length === 0
            ? h('p', { class: 'muted' }, 'This teacher has no room of their own in this schedule. The day above names the room for each period.')
            : based.map((room) => {
              const floor = school.floorOfRoom(room.id);
              return [h('p', null, viewLink(school, 'room', room.id, typed(school.roomName(room, true))), ' is on ', typed(floor ? floor.name : 'no floor'), room.wing ? [', ', typed(room.wing)] : null, '. ',
                floor && school.has('map') ? h('a', { class: 'no-print', href: makeHash('map', floor.id) }, 'Show ', typed(floor.name), ' on the map') : null),
              aroundRoom(ctx, room)];
            })),

        h('section', { class: 'card', dataset: { sub: 'notes' } },
          sectionHeading('Notes from the teacher'),
          typeof absent.notes === 'string' && absent.notes.trim() !== ''
            ? h('p', { class: 'notes' }, typed(absent.notes))
            : h('p', { class: 'muted' }, 'No notes were left in this schedule.')),

        h('p', { class: 'reminder', dataset: { sub: 'check' } }, h('strong', null, SUB_CHECK_SENTENCE), ' This schedule was published on ' + dayText(school.data.publishedAt, now) + ' and may have changed since.'),
      ]);
    };

    const picker = dayTypePicker(ctx, dayType.id, (next) => {
      dayType = next;
      address();
      draw();
    });
    draw();
    return pageOf(['Substitute plan: ', typed(absent.name)], null, says,
      h('div', { class: 'controls' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'sub-date' }, 'Date'), date),
        h('div', { class: 'no-print' }, picker)),
      out,
      h('p', { class: 'actions no-print' },
        h('button', { class: 'btn btn--primary', type: 'button', dataset: { sub: 'print', print: 'page' }, onclick: () => globalThis.print() }, 'Print this page')));
  },
};
