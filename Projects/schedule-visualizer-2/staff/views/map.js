// #/map/f…  Building map
//
// One floor at a time, with floor tabs. Rooms are coloured by subject, with a
// legend, and carry their numbers; a tap on a room opens its page. Beside the
// picture is the same floor in words: every room as a link, then the other
// spaces. Everything the picture shows is in that list.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { floorMap, besideMap } from '../map.js';
import { countOf, subjectChipOf, listPart } from './teacher.js';

// A floor's rooms in the order a person looks them up: by number, numbers
// counted as numbers, then the rooms with none.
export function roomsInOrder(floor) {
  const rooms = floor.spaces.filter((space) => space.kind === 'room');
  return rooms.sort((a, b) => {
    const blank = (a.number.trim() === '') - (b.number.trim() === '');
    return blank !== 0 ? blank : a.number.localeCompare(b.number, 'en', { numeric: true, sensitivity: 'base' });
  });
}

// The subjects a floor's rooms have, in the school's own order, and whether
// any room has none.
export function floorLegend(school, floor) {
  const rooms = floor.spaces.filter((space) => space.kind === 'room');
  return {
    subjects: school.subjects.filter((subject) => rooms.some((room) => room.subjectId === subject.id)),
    none: rooms.some((room) => !school.subject(room.subjectId)),
  };
}

export const mapView = {
  id: 'map',
  flag: 'map',
  nav: 'map',
  title(ctx, route) {
    const found = ctx.school.floor(route.id) || ctx.school.floors[0];
    return found ? 'Building map: ' + found.name : 'Building map';
  },
  render(ctx, route) {
    const school = ctx.school;
    const floor = route.id ? school.floor(route.id) : school.floors[0];
    if (!floor) return missingPage('floor');
    const rooms = roomsInOrder(floor);
    const others = floor.spaces.filter((space) => space.kind !== 'room');
    const names = school.data.publish.teacherNamesOnMap !== false;
    const legend = floorLegend(school, floor);

    const map = floorMap(ctx, {
      floorId: floor.id,
      label: 'Building map',
      floorHref: (each) => makeHash('map', each.id),
    });
    const key = h('ul', { class: 'legend', 'aria-label': 'Subject colours on this floor' },
      legend.subjects.map((subject) => h('li', null, subjectChipOf(subject))),
      legend.none ? h('li', null, h('span', { class: 'chip chip--none' }, 'No subject')) : null);

    const detail = (room) => {
      const said = [];
      const subject = school.subject(room.subjectId);
      if (subject) said.push(typed(subject.name));
      if (names) {
        for (const id of room.teacherIds || []) {
          const teacher = school.teacher(id);
          if (teacher) said.push(typed(teacher.name));
        }
      }
      return said.length > 0 ? h('span', { class: 'list__detail' }, said.map((each, at) => (at > 0 ? [' · ', each] : each))) : null;
    };
    const tag = school.has('room') ? 'a' : 'span';
    const list = rooms.length > 0 ? listPart('Rooms on this floor', rooms.map((room) => h('li', null,
      h(tag, { class: 'list__link', href: school.has('room') ? makeHash('room', room.id) : null, dataset: { room: room.id } },
        h('span', { class: 'list__name' }, typed(school.roomName(room, true))),
        detail(room))))) : h('p', { class: 'muted' }, 'No rooms are drawn on this floor.');
    const rest = others.length > 0 ? h('section', { class: 'part', 'aria-label': 'Other spaces on this floor' },
      h('h2', { class: 'part__title' }, 'Other spaces on this floor'),
      h('ul', { class: 'plain' }, others.map((space) => h('li', null, space.label ? typed(space.label) : h('span', { class: 'muted' }, 'A space with no name'))))) : null;

    const lede = [typed(floor.name), ' has ' + countOf(rooms.length, 'room', 'rooms') + '. ', school.has('room') ? 'Tap a room for its page.' : 'The rooms are listed below.'];
    return pageOf(['Building map: ', typed(floor.name)], lede, besideMap([], h('div', { class: 'part' }, map, key), [list, rest]));
  },
};
