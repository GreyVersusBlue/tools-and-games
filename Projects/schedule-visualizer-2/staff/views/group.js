// #/group/g…  Group
//
// Name and grade (never a head count: a published file has none); a table of
// who teaches the group, with subject, teacher, room and the periods on each
// day type; the group's day in order; and a map of where the group goes, each
// room badged with its period and time, for each day type.

import { h, typed } from '../dom.js';
import { pageOf, missingPage } from '../page.js';
import { floorMap, besideMap } from '../map.js';
import { wordsJoined, partsToNodes, countOf, linkToTeacher, linkToRoom, subjectChipOf, teachersOfSlot, dayKindsOf, dayCardsOf, kindName, slotWhere } from './teacher.js';

const isEmpty = (slot) => !slot || (!slot.room && !slot.roomText && !slot.label);

// "Period 3" → "3", "Block C" → "C", "3rd Hour" → "3rd". The page asks the
// school for this now (school.periodLabel, the engine's own); this copy is
// here only until the case in test/browser/staff-views-a.mjs that imports it
// asks the school too.
export function shortPeriod(name) {
  return String(name).replace(/^(Period|Mod|Block)\s+/, '').replace(/\s+Hour$/, '');
}

// Who teaches the group: one row for each teacher in each room, in the order
// the day meets them, with the periods on each kind of day.
// [{ teacher, room, text, label, periods: [[period, …] per kind] }]
export function groupTeaching(school, groupId, kinds) {
  const rows = [];
  const byKey = new Map();
  kinds.forEach((kind, at) => {
    const day = school.groupDay(groupId, kind.first.id);
    day.forEach((slot, period) => {
      if (isEmpty(slot)) return;
      const room = slot.room ? school.room(slot.room) : null;
      const teachers = teachersOfSlot(school, kind.first.id, groupId, period);
      for (const teacher of teachers.length > 0 ? teachers : [null]) {
        const key = JSON.stringify([teacher ? teacher.id : '', room ? room.id : slot.roomText, teacher || room ? '' : slot.label]);
        if (!byKey.has(key)) {
          byKey.set(key, { teacher, room, text: room ? '' : slot.roomText, label: slot.label, periods: kinds.map(() => []) });
          rows.push(byKey.get(key));
        }
        byKey.get(key).periods[at].push(period);
      }
    });
  });
  return rows;
}

// "Grade 6. Taught by 7 teachers in 8 rooms." Parts, as teacherSummaryOf().
export function groupSummaryOf(school, group, rows) {
  const parts = [];
  if (group.grade) parts.push('Grade ', { typed: group.grade }, '. ');
  const teachers = new Set(rows.filter((row) => row.teacher).map((row) => row.teacher.id)).size;
  const rooms = new Set(rows.filter((row) => row.room).map((row) => row.room.id)).size;
  if (rows.length === 0) parts.push('Has nothing scheduled in this copy.');
  else parts.push('Taught by ' + countOf(teachers, 'teacher', 'teachers') + ' in ' + countOf(rooms, 'room', 'rooms') + '.');
  return parts;
}

function teachingTable(school, kinds, rows) {
  const subjectOf = (row) => {
    const subject = school.subject(row.teacher ? row.teacher.subjectId : null) || school.subject(row.room ? row.room.subjectId : null);
    if (subject) return subjectChipOf(subject);
    return row.label ? typed(row.label) : h('span', { class: 'muted' }, 'No subject');
  };
  return h('div', { class: 'scroll', role: 'region', tabindex: '0', 'aria-label': 'The table of who teaches this group' },
    h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Subject'),
        h('th', { scope: 'col' }, 'Teacher'),
        h('th', { scope: 'col' }, 'Room'),
        kinds.map((kind) => h('th', { scope: 'col' }, kindName(kind))))),
      h('tbody', null, rows.map((row) => h('tr', null,
        h('td', null, subjectOf(row)),
        h('td', null, row.teacher ? linkToTeacher(school, row.teacher) : h('span', { class: 'muted' }, 'No teacher')),
        h('td', null, row.room ? linkToRoom(school, row.room, true) : slotWhere(school, { room: null, roomText: row.text })),
        row.periods.map((periods) => h('td', null, periods.length === 0 ? h('span', { class: 'muted' }, 'None') : periods.map((period) => school.periodName(period)).join(', '))))))));
}

// The rooms a kind of day takes the group to, with their periods:
// [{ room, periods }] in the order met.
function visits(school, groupId, kind) {
  const out = [];
  school.groupDay(groupId, kind.first.id).forEach((slot, period) => {
    const room = slot && slot.room ? school.room(slot.room) : null;
    if (!room) return;
    let visit = out.find((each) => each.room.id === room.id);
    if (!visit) {
      visit = { room, periods: [] };
      out.push(visit);
    }
    visit.periods.push(period);
  });
  return out;
}

function groupMap(ctx, group, kinds, at) {
  const school = ctx.school;
  const kind = kinds[at];
  const seen = visits(school, group.id, kind);
  if (seen.length === 0) return null;
  const bells = school.bells(kind.first.id);
  const timeOf = (period) => (bells[period].start ? school.time(bells[period].start) : '');
  const shorts = (visit) => visit.periods.map((period) => school.periodLabel(period)).join(', ');
  const box = h('div', { class: 'part', dataset: { kind: String(at) } });
  const tabs = kinds.length > 1 ? h('div', { class: 'tabs' }, kinds.map((each, index) => h('button', {
    class: 'tab',
    type: 'button',
    'aria-current': index === at ? 'true' : null,
    dataset: { kind: String(index) },
    onclick: () => {
      const next = groupMap(ctx, group, kinds, index);
      if (!next) return;
      box.replaceWith(next);
      next.querySelector('.tab[aria-current]').focus();
    },
  }, kindName(each)))) : null;
  box.append(...[
    h('h2', { class: 'part__title' }, 'Where ', typed(group.name), ' goes'),
    tabs,
    floorMap(ctx, {
      floorId: school.floorOfRoom(seen[0].room.id).id,
      label: 'Where ' + group.name + ' goes',
      marks: seen.map((visit) => ({ roomId: visit.room.id, ring: false, short: shorts(visit), badge: (shorts(visit) + ' ' + timeOf(visit.periods[0])).trim() })),
      says: (floor) => {
        const here = seen.filter((visit) => school.floorOfRoom(visit.room.id).id === floor.id);
        if (here.length === 0) return ['Nothing of this day is on ', typed(floor.name), '.'];
        return ['On ', typed(floor.name), ': ', ...wordsJoined(here.map((visit) => h('span', null,
          linkToRoom(school, visit.room, true), ' (', visit.periods.map((period) => school.periodName(period) + (timeOf(period) ? ' at ' + timeOf(period) : '')).join(', '), ')'))), '.'];
      },
    }),
  ].filter(Boolean));
  return box;
}

export const groupView = {
  id: 'group',
  flag: 'group',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.group(route.id);
    return found ? found.name : 'Group';
  },
  render(ctx, route) {
    const school = ctx.school;
    const group = school.group(route.id);
    if (!group) return missingPage('group');

    const kinds = dayKindsOf(school, (dayType) => school.groupDay(group.id, dayType.id).map((slot, period) => [slot.room, slot.roomText, slot.label, teachersOfSlot(school, dayType.id, group.id, period).map((teacher) => teacher.id)]));
    const rows = groupTeaching(school, group.id, kinds);

    const header = h('section', { class: 'card', 'aria-label': 'About' },
      h('dl', { class: 'facts' },
        h('div', null, h('dt', null, 'Group'), h('dd', null, h('span', { class: 'chip', style: /^#[0-9a-f]{6}$/i.test(group.colour) ? '--chip: ' + group.colour : null }, typed(group.name)))),
        h('div', null, h('dt', null, 'Grade'), h('dd', null, group.grade ? typed(group.grade) : h('span', { class: 'muted' }, 'Not given')))));

    const teaching = rows.length > 0 ? h('section', { class: 'part', 'aria-label': 'Who teaches this group' },
      h('h2', { class: 'part__title' }, 'Who teaches ', typed(group.name)),
      teachingTable(school, kinds, rows)) : null;

    const days = dayCardsOf(ctx, kinds, (dayType, period) => {
      const slot = school.groupDay(group.id, dayType.id)[period];
      if (isEmpty(slot)) return { what: h('span', { class: 'muted' }, 'Nothing scheduled'), where: null };
      const teachers = teachersOfSlot(school, dayType.id, group.id, period).map((teacher) => linkToTeacher(school, teacher));
      const what = wordsJoined(teachers);
      if (slot.label) what.push(teachers.length > 0 ? ' ' : '', h('span', { class: teachers.length > 0 ? 'muted' : null }, typed(slot.label)));
      if (what.length === 0) what.push(h('span', { class: 'muted' }, 'No teacher'));
      return { what, where: slotWhere(school, slot) };
    });

    const map = school.has('map') ? groupMap(ctx, group, kinds, 0) : null;
    return pageOf(typed(group.name), partsToNodes(groupSummaryOf(school, group, rows)),
      map ? besideMap([header, teaching, days], map, []) : [header, teaching, days]);
  },
};
