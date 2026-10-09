// #/teacher/t…  Teacher
//
// Name, subject and room; a sentence about the day; the day period by period
// for each day type (one card when the day types are the same, side by side
// when they differ); a small map with the teacher's room ringed; the groups
// taught; and the other teachers who share those groups.
//
// The pieces the group and room pages are made of as well are here too: the
// day cards, the links, the subject chip, and who teaches a group in a period.
// Every answer comes from ctx.school (staff/model.js), which asks the engine.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { floorMap, besideMap } from '../map.js';

// ---- words

// ['a', 'b', 'c'] → 'a', ', ', 'b', ' and ', 'c'. Items are text or nodes.
export function wordsJoined(items) {
  const out = [];
  items.forEach((item, at) => {
    if (at > 0) out.push(at === items.length - 1 ? ' and ' : ', ');
    out.push(item);
  });
  return out;
}

// A sentence is built as parts: plain words, and { typed } for a name somebody
// typed. On the page each typed part goes in its own <bdi>.
export function partsToText(parts) {
  return parts.map((part) => (typeof part === 'string' ? part : part.typed)).join('');
}

export function partsToNodes(parts) {
  return parts.map((part) => (typeof part === 'string' ? part : typed(part.typed)));
}

export function countOf(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

// ---- links. A view the publisher left out is named in plain text instead.

export function linkToTeacher(school, teacher) {
  return school.has('teacher') ? h('a', { href: makeHash('teacher', teacher.id) }, typed(teacher.name)) : typed(teacher.name);
}

export function linkToGroup(school, group) {
  return school.has('group') ? h('a', { href: makeHash('group', group.id) }, typed(group.name)) : typed(group.name);
}

export function linkToRoom(school, room, start) {
  const name = school.roomName(room, start);
  return school.has('room') ? h('a', { href: makeHash('room', room.id) }, typed(name)) : typed(name);
}

// A subject's mark: a dot in its colour and its name. No subject says so.
export function subjectChipOf(subject) {
  if (!subject) return h('span', { class: 'muted' }, 'No subject');
  const colour = /^#[0-9a-f]{6}$/i.test(subject.colour) ? subject.colour : null;
  return h('span', { class: 'chip', style: colour ? '--chip: ' + colour : null }, typed(subject.name));
}

// A titled part of a page holding a list of links.
export function listPart(label, items) {
  return h('section', { class: 'part', 'aria-label': label },
    h('h2', { class: 'part__title' }, label),
    h('ul', { class: 'list' }, items));
}

// ---- the school's days, worked out once per copy of the schedule

const indexes = new WeakMap();

function indexOf(school) {
  if (!indexes.has(school)) indexes.set(school, { days: new Map(), groups: null });
  return indexes.get(school);
}

// Every teacher's day on one day type: a Map of teacher id to the engine's
// entries.
export function teacherDaysOn(school, dayTypeId) {
  const index = indexOf(school);
  if (!index.days.has(dayTypeId)) {
    index.days.set(dayTypeId, new Map(school.teachers.map((teacher) => [teacher.id, school.teacherDay(teacher.id, dayTypeId) || []])));
  }
  return index.days.get(dayTypeId);
}

// The groups each teacher has on any day type: a Map of teacher id to a Set.
function groupsTaught(school) {
  const index = indexOf(school);
  if (index.groups === null) {
    index.groups = new Map(school.teachers.map((teacher) => [teacher.id, new Set()]));
    for (const dayType of school.dayTypes) {
      for (const [teacherId, day] of teacherDaysOn(school, dayType.id)) {
        for (const entry of day) {
          for (const taught of entry.groups) index.groups.get(teacherId).add(taught.groupId);
        }
      }
    }
  }
  return index.groups;
}

// Who has this group in this period, by the engine's rule for a teacher's day.
export function teachersOfSlot(school, dayTypeId, groupId, period) {
  const days = teacherDaysOn(school, dayTypeId);
  return school.teachers.filter((teacher) => {
    const entry = days.get(teacher.id)[period];
    return Boolean(entry) && entry.groups.some((taught) => taught.groupId === groupId);
  });
}

// The day types put together where they are the same: [{ dayTypes, first }].
// Two are the same when their bells are and `describe(dayType)` gives the same
// answer for both, so a day type that follows A Day always joins it.
export function dayKindsOf(school, describe) {
  const kinds = [];
  const byKey = new Map();
  for (const dayType of school.dayTypes) {
    const bells = school.bells(dayType.id).map((bell) => [bell.start, bell.end]);
    const key = JSON.stringify([bells, describe(dayType)]);
    if (!byKey.has(key)) {
      byKey.set(key, { dayTypes: [], first: dayType });
      kinds.push(byKey.get(key));
    }
    byKey.get(key).dayTypes.push(dayType);
  }
  return kinds;
}

function minutesOf(bellTime) {
  const match = /^(\d\d):(\d\d)$/.exec(bellTime || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// The period the clock is in on this kind of day, or -1. It is only known
// when the day is: every day type is the same, or the reader has said which
// day type today is (kept on the device under `day`).
export function nowPeriodOf(ctx, kinds, kind) {
  const chosen = ctx.store ? ctx.store.get('day') : null;
  if (kinds.length !== 1 && !kind.dayTypes.some((dayType) => dayType.id === chosen)) return -1;
  const now = ctx.now();
  const minute = now.getHours() * 60 + now.getMinutes();
  return ctx.school.bells(kind.first.id).findIndex((bell) => {
    const start = minutesOf(bell.start);
    const end = minutesOf(bell.end);
    return start !== null && end !== null && minute >= start && minute < end;
  });
}

// The names of a kind of day: "A Day", or "A Day and B Day" when they are the
// same.
export function kindName(kind) {
  return wordsJoined(kind.dayTypes.map((dayType) => typed(dayType.name)));
}

// The day as cards, one per kind of day. `rowOf(dayType, period)` gives
// { what, where } for a row: text or nodes.
export function dayCardsOf(ctx, kinds, rowOf) {
  const school = ctx.school;
  const cards = kinds.map((kind) => {
    const bells = school.bells(kind.first.id);
    const current = nowPeriodOf(ctx, kinds, kind);
    const rows = bells.map((bell, period) => {
      const row = rowOf(kind.first, period);
      return h('li', { class: period === current ? 'row row--now' : 'row', dataset: { period: String(period) } },
        h('span', { class: 'row__when' },
          h('span', { class: 'row__period' }, school.periodName(period)),
          bell.start && bell.end ? h('span', { class: 'row__time' }, school.time(bell.start) + ' to ' + school.time(bell.end)) : null,
          period === current ? h('span', { class: 'row__mark' }, 'Now') : null),
        h('span', { class: 'row__what' }, row.what),
        h('span', { class: 'row__where' }, row.where));
    });
    return h('section', { class: 'card day', dataset: { days: kind.dayTypes.map((dayType) => dayType.id).join(' ') } },
      h('h2', { class: 'card__title' }, kindName(kind)),
      h('ol', { class: 'rows' }, rows));
  });
  return h('div', { class: 'days', dataset: { count: String(cards.length) } }, cards);
}

// Where a slot is, as a room page's link, or the words kept for a room that
// is not in the building.
export function slotWhere(school, slot) {
  const room = slot && slot.room ? school.room(slot.room) : null;
  if (room) return linkToRoom(school, room, true);
  const text = slot && typeof slot.roomText === 'string' ? slot.roomText : '';
  return text === '' ? h('span', { class: 'muted' }, 'No room') : h('span', null, typed(text), ' · not in the building');
}

// ---- the teacher's own sentence

// "Teaches 5 classes. Planning is Block B on A Day and Block D on B Day."
// Parts, for partsToNodes() and partsToText().
export function teacherSummaryOf(school, teacherId) {
  const days = school.dayTypes.map((dayType) => {
    const day = school.teacherDay(teacherId, dayType.id) || [];
    return { name: dayType.name, classes: day.filter((entry) => entry.kind === 'teaching').length, planning: day.filter((entry) => entry.kind === 'planning').map((entry) => entry.period) };
  });
  if (days.length === 0 || days.every((day) => day.classes === 0)) return ['Has no classes in this schedule.'];
  const parts = [];
  const each = (say, joiner) => {
    days.forEach((day, at) => {
      if (at > 0) parts.push(joiner || (at === days.length - 1 ? ' and ' : ', '));
      parts.push(say(day, at), ' on ', { typed: day.name });
    });
  };

  if (days.every((day) => day.classes === days[0].classes)) parts.push('Teaches ' + countOf(days[0].classes, 'class', 'classes'));
  else {
    parts.push('Teaches ');
    each((day, at) => (at === 0 ? countOf(day.classes, 'class', 'classes') : String(day.classes)));
  }
  parts.push('. ');

  const same = days.every((day) => day.planning.join() === days[0].planning.join());
  const names = (day) => wordsJoined(day.planning.map((period) => school.periodName(period))).join('');
  if (days.some((day) => day.planning.length > 3)) {
    // a long list of periods is counted instead of named
    if (days.every((day) => day.planning.length === days[0].planning.length)) parts.push('Has ' + countOf(days[0].planning.length, 'planning period', 'planning periods'));
    else {
      parts.push('Has ');
      each((day, at) => (at === 0 ? countOf(day.planning.length, 'planning period', 'planning periods') : String(day.planning.length)));
    }
  } else if (same) {
    parts.push(days[0].planning.length === 0 ? 'Has no planning period' : 'Planning is ' + names(days[0]));
  } else {
    parts.push('Planning is ');
    each((day) => (day.planning.length === 0 ? 'none' : names(day)), days.some((day) => day.planning.length > 1) ? '; ' : null);
  }
  parts.push('.');
  return parts;
}

// The teachers who have any of this teacher's groups, with the groups shared:
// [{ teacher, groups }] in the school's own order.
export function sharersOf(school, teacherId) {
  const taught = groupsTaught(school);
  const mine = taught.get(teacherId) || new Set();
  const out = [];
  for (const other of school.teachers) {
    if (other.id === teacherId) continue;
    const shared = school.groups.filter((group) => mine.has(group.id) && taught.get(other.id).has(group.id));
    if (shared.length > 0) out.push({ teacher: other, groups: shared });
  }
  return out;
}

export const teacherView = {
  id: 'teacher',
  flag: 'teacher',
  nav: 'search',
  title(ctx, route) {
    const found = ctx.school.teacher(route.id);
    return found ? found.name : 'Teacher';
  },
  render(ctx, route) {
    const school = ctx.school;
    const teacher = school.teacher(route.id);
    if (!teacher) return missingPage('teacher');
    const rooms = (teacher.roomIds || []).map((id) => school.room(id)).filter(Boolean);

    const header = h('section', { class: 'card', 'aria-label': 'About' },
      h('dl', { class: 'facts' },
        h('div', null, h('dt', null, 'Subject'), h('dd', null, subjectChipOf(school.subject(teacher.subjectId)))),
        h('div', null, h('dt', null, rooms.length > 1 ? 'Rooms' : 'Room'),
          h('dd', null, rooms.length === 0 ? h('span', { class: 'muted' }, 'No room of their own') : wordsJoined(rooms.map((room) => {
            const floor = school.floorOfRoom(room.id);
            return h('span', null, linkToRoom(school, room, true), floor ? [' · ', typed(floor.name)] : null);
          }))))));

    const slotOf = (dayType, taught, period) => school.groupDay(taught.groupId, dayType.id)[period];
    const kinds = dayKindsOf(school, (dayType) => (school.teacherDay(teacher.id, dayType.id) || []).map((entry) => entry.groups.map((taught) => {
      const slot = slotOf(dayType, taught, entry.period);
      return [taught.groupId, taught.roomId, slot.label, slot.roomText];
    })));
    const days = dayCardsOf(ctx, kinds, (dayType, period) => {
      const entry = school.teacherDay(teacher.id, dayType.id)[period];
      if (entry.kind === 'planning') return { what: h('span', { class: 'muted' }, 'Planning'), where: null };
      const what = [];
      const where = [];
      const seen = new Set();
      for (const taught of entry.groups) {
        const group = school.group(taught.groupId);
        const slot = slotOf(dayType, taught, period);
        what.push(h('span', null, linkToGroup(school, group), slot.label ? [' ', h('span', { class: 'muted' }, typed(slot.label))] : null));
        const key = taught.roomId || 'text:' + slot.roomText;
        if (!seen.has(key)) where.push(slotWhere(school, slot));
        seen.add(key);
      }
      return { what: wordsJoined(what), where: wordsJoined(where) };
    });

    const map = rooms.length > 0 && school.has('map') ? floorMap(ctx, {
      floorId: school.floorOfRoom(rooms[0].id).id,
      label: 'Where ' + teacher.name + ' is',
      marks: rooms.map((room) => ({ roomId: room.id, ring: true })),
      says: (floor) => {
        const here = rooms.filter((room) => school.floorOfRoom(room.id).id === floor.id);
        if (here.length === 0) return [typed(teacher.name), ' has no room on ', typed(floor.name), '.'];
        return [...wordsJoined(here.map((room) => linkToRoom(school, room, true))), here.length === 1 ? ' is ringed.' : ' are ringed.'];
      },
    }) : null;

    const taught = groupsTaught(school).get(teacher.id);
    const groups = school.groups.filter((group) => taught.has(group.id));
    const sharers = sharersOf(school, teacher.id);
    const more = [
      school.has('coverage') ? h('a', { class: 'btn', href: makeHash('coverage', teacher.id) }, 'Coverage') : null,
      school.has('sub') ? h('a', { class: 'btn', href: makeHash('sub', teacher.id) }, 'Substitute plan') : null,
    ].filter(Boolean);

    const after = [
      groups.length > 0 ? listPart('Groups taught', groups.map((group) => h('li', null,
        h(school.has('group') ? 'a' : 'span', { class: 'list__link', href: school.has('group') ? makeHash('group', group.id) : null },
          h('span', { class: 'list__name' }, typed(group.name)),
          group.grade ? h('span', { class: 'list__detail' }, 'Grade ', typed(group.grade)) : null)))) : null,
      sharers.length > 0 ? listPart('Teachers who share these groups', sharers.map((sharer) => h('li', null,
        h('a', { class: 'list__link', href: makeHash('teacher', sharer.teacher.id) },
          h('span', { class: 'list__name' }, typed(sharer.teacher.name)),
          h('span', { class: 'list__detail' }, 'Shares ', wordsJoined(sharer.groups.map((group) => typed(group.name)))))))) : null,
      more.length > 0 ? h('p', { class: 'actions' }, more) : null,
    ];
    return pageOf(typed(teacher.name), partsToNodes(teacherSummaryOf(school, teacher.id)),
      map ? besideMap([header, days], map, after) : [header, days, after]);
  },
};
