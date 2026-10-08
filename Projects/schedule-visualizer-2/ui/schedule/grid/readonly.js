// The same schedule read from the other two sides: one row per teacher, or
// one row per room, a column per period. These are for reading. A cell says
// which groups are there (and, for a teacher, in which room).

import { h } from '../../components/dom.js';
import { ownDayTypes, effectiveSchedule } from '../../../engine/day-types.js';
import { periodName } from '../../../engine/bells.js';
import { teacherDays } from '../../../engine/teacher-day.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { collator } from '../common.js';

function shell(project, caption, first, rows) {
  const days = ownDayTypes(project);
  const periods = project.settings.periods;
  const table = h('table', { class: 'grd-table grd-table--read' },
    h('caption', { class: 'vh' }, caption),
    h('thead', null,
      h('tr', null,
        h('th', { scope: 'col', rowspan: '2', class: 'grd-head grd-head--name' }, first),
        days.map((dayType) => h('th', { scope: 'colgroup', colspan: String(periods), class: 'grd-head grd-head--day' }, dayType.name))),
      h('tr', null, days.map(() => Array.from({ length: periods }, (unused, period) => h('th', {
        scope: 'col',
        class: 'grd-head grd-head--period' + (period === 0 ? ' grd-head--first' : ''),
      }, periodName(project.settings, period)))))),
    h('tbody', null, rows.map((row) => h('tr', { class: 'grd-row' },
      h('th', { scope: 'row', class: 'grd-cell grd-cell--name' }, h('span', { class: 'grd-cell__text' }, row.name)),
      days.map((dayType) => Array.from({ length: periods }, (unused, period) => {
        const text = row.cell(dayType.id, period);
        return h('td', { class: 'grd-cell grd-cell--read' + (text === '' ? ' is-free' : '') }, text === '' ? h('span', { class: 'vh' }, row.free) : text);
      }))))));
  // a region that scrolls sideways has to be reachable by keyboard
  return h('div', { class: 'grd-scroll', tabindex: '0', role: 'region', 'aria-label': caption }, table);
}

function groupNames(project, ids) {
  return ids.map((id) => (project.groups.find((group) => group.id === id) || { name: '' }).name);
}

// One row per teacher: "7-1 in 204".
export function teacherTable(project) {
  const days = new Map(ownDayTypes(project).map((dayType) => [dayType.id, teacherDays(project, dayType.id)]));
  const numberOf = (roomId) => {
    const room = roomId ? findRoom(project, roomId) : null;
    return room ? (room.number.trim() === '' ? roomName(room) : room.number) : 'a room not in the building';
  };
  return shell(project, 'Every teacher, one row each. For reading.', 'Teacher', project.teachers.map((teacher) => ({
    name: teacher.name,
    free: 'Planning',
    cell: (dayTypeId, period) => days.get(dayTypeId).get(teacher.id)[period].groups
      .map((taught) => groupNames(project, [taught.groupId])[0] + ' in ' + numberOf(taught.roomId)).join(', '),
  })));
}

// One row per room: the groups in it.
export function roomTable(project) {
  const rooms = allRooms(project).slice().sort((a, b) => collator.compare(a.number, b.number));
  const inRoom = new Map();
  for (const dayType of ownDayTypes(project)) {
    for (const group of project.groups) {
      effectiveSchedule(project, group.id, dayType.id).forEach((slot, period) => {
        const room = resolveSlotRoom(project, slot).room;
        if (!room) return;
        const key = room.id + '|' + dayType.id + '|' + period;
        if (!inRoom.has(key)) inRoom.set(key, []);
        inRoom.get(key).push(group.name);
      });
    }
  }
  return shell(project, 'Every room, one row each. For reading.', 'Room', rooms.map((room) => ({
    name: room.number.trim() === '' ? roomName(room, true) : room.number,
    free: 'Empty',
    cell: (dayTypeId, period) => (inRoom.get(room.id + '|' + dayTypeId + '|' + period) || []).join(', '),
  })));
}
