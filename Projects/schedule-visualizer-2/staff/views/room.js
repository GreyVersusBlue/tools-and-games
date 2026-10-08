// #/room/r…  Room
//
// Every room has a page, with or without a teacher: who is in it each period
// on each day type and when it is empty, its subject, capacity and features,
// and where it is on the map.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { floorMap, besideMap } from '../map.js';
import { wordsJoined, partsToNodes, countOf, linkToTeacher, linkToGroup, subjectChipOf, teachersOfSlot, dayKindsOf, dayCardsOf } from './teacher.js';

// Who is in a room in each period of a day type: one list per period of
// { group, label, teachers }, in the school's own order of groups. Two groups
// in one period are both there: a double-booking is shown as it is.
export function roomUse(school, roomId, dayTypeId) {
  const periods = school.bells(dayTypeId).map(() => []);
  for (const group of school.groups) {
    school.groupDay(group.id, dayTypeId).forEach((slot, period) => {
      if (!slot || slot.room !== roomId || !periods[period]) return;
      periods[period].push({ group, label: slot.label, teachers: teachersOfSlot(school, dayTypeId, group.id, period) });
    });
  }
  return periods;
}

// "On Floor 2. In use for 5 of 8 periods on A Day and 6 on B Day." Parts.
export function roomSummaryOf(school, room) {
  const floor = school.floorOfRoom(room.id);
  const parts = floor ? ['On ', { typed: floor.name }, '. '] : [];
  const days = school.dayTypes.map((dayType) => {
    const use = roomUse(school, room.id, dayType.id);
    return { name: dayType.name, used: use.filter((period) => period.length > 0).length, of: use.length };
  });
  if (days.every((day) => day.used === 0)) return parts.concat('Not used in this schedule.');
  if (days.every((day) => day.used === days[0].used)) return parts.concat('In use for ' + days[0].used + ' of ' + countOf(days[0].of, 'period', 'periods') + '.');
  parts.push('In use for ');
  days.forEach((day, at) => {
    if (at > 0) parts.push(at === days.length - 1 ? ' and ' : ', ');
    parts.push(at === 0 ? day.used + ' of ' + countOf(day.of, 'period', 'periods') : String(day.used), ' on ', { typed: day.name });
  });
  parts.push('.');
  return parts;
}

export const roomView = {
  id: 'room',
  flag: 'room',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.room(route.id);
    return found ? ctx.school.roomName(found, true) : 'Room';
  },
  render(ctx, route) {
    const school = ctx.school;
    const room = school.room(route.id);
    if (!room) return missingPage('room');
    const floor = school.floorOfRoom(room.id);
    const teachers = (room.teacherIds || []).map((id) => school.teacher(id)).filter(Boolean);
    const features = [];
    if (room.shared) features.push('Shared space');
    if (room.wing) features.push(h('span', null, 'Wing: ', typed(room.wing)));

    const fact = (term, value) => h('div', null, h('dt', null, term), h('dd', null, value));
    const header = h('section', { class: 'card', 'aria-label': 'About' },
      h('dl', { class: 'facts' },
        fact('Subject', subjectChipOf(school.subject(room.subjectId))),
        fact(teachers.length > 1 ? 'Teachers' : 'Teacher', teachers.length === 0 ? h('span', { class: 'muted' }, 'No teacher is based here') : wordsJoined(teachers.map((teacher) => linkToTeacher(school, teacher)))),
        fact('Capacity', typeof room.capacity === 'number' ? String(room.capacity) : h('span', { class: 'muted' }, 'Not given')),
        fact('Features', features.length === 0 ? h('span', { class: 'muted' }, 'None listed') : wordsJoined(features)),
        floor ? fact('Floor', school.has('map') ? h('a', { href: makeHash('map', floor.id) }, typed(floor.name)) : typed(floor.name)) : null));

    const uses = new Map(school.dayTypes.map((dayType) => [dayType.id, roomUse(school, room.id, dayType.id)]));
    const kinds = dayKindsOf(school, (dayType) => uses.get(dayType.id).map((period) => period.map((use) => [use.group.id, use.label, use.teachers.map((teacher) => teacher.id)])));
    const days = dayCardsOf(ctx, kinds, (dayType, period) => {
      const here = uses.get(dayType.id)[period];
      if (here.length === 0) return { what: h('span', { class: 'muted' }, 'Empty'), where: null };
      const who = [];
      for (const use of here) {
        for (const teacher of use.teachers) {
          if (!who.some((each) => each.id === teacher.id)) who.push(teacher);
        }
      }
      return {
        what: wordsJoined(here.map((use) => h('span', null, linkToGroup(school, use.group), use.label ? [' ', h('span', { class: 'muted' }, typed(use.label))] : null))),
        where: who.length === 0 ? h('span', { class: 'muted' }, 'No teacher') : wordsJoined(who.map((teacher) => linkToTeacher(school, teacher))),
      };
    });

    const map = floor && school.has('map') ? floorMap(ctx, {
      floorId: floor.id,
      label: 'Where ' + school.roomName(room) + ' is',
      marks: [{ roomId: room.id, ring: true }],
      says: (shown) => (shown.id === floor.id ? [typed(school.roomName(room, true)), ' is ringed.'] : [typed(school.roomName(room, true)), ' is on ', typed(floor.name), ', not on this floor.']),
    }) : null;

    return pageOf(typed(school.roomName(room, true)), partsToNodes(roomSummaryOf(school, room)),
      map ? besideMap([header, days], map, []) : [header, days]);
  },
};
