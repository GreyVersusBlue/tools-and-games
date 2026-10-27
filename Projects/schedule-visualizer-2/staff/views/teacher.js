// #/teacher/t…  Teacher
//
// Name, subject and room; a sentence about the day; the day period by period
// for each day type (one card when the day types are the same, side by side
// when they differ); a small map with the teacher's room ringed; the groups
// taught; and the other teachers who share those groups. On the reader's own
// page the day cards carry the reader's notes (staff/notes.js), and under
// every teacher's day are the things to take away (staff/outputs.js).
//
// The pieces the group and room pages are made of as well are here too: the
// day cards, the links, the subject chip, and who teaches a group in a period.
// Every answer comes from ctx.school (staff/model.js), which asks the engine.

import { h, typed } from '../dom.js';
import { makeHash } from '../router.js';
import { pageOf, missingPage } from '../page.js';
import { floorMap, besideMap } from '../map.js';
import { everyTeacherDay, clockNow, momentOf, todayOf, todayKey, todayLine, watchClock } from '../clock.js';
import { isMe, noteFields } from '../notes.js';
import { teacherOutputs } from '../outputs.js';

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
  if (!indexes.has(school)) indexes.set(school, { groups: null });
  return indexes.get(school);
}

// The groups each teacher has on any day type: a Map of teacher id to a Set.
function groupsTaught(school) {
  const index = indexOf(school);
  if (index.groups === null) {
    index.groups = new Map(school.teachers.map((teacher) => [teacher.id, new Set()]));
    for (const dayType of school.dayTypes) {
      for (const [teacherId, day] of everyTeacherDay(school, dayType.id)) {
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
  const days = everyTeacherDay(school, dayTypeId);
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

// The kind of day the clock is read against, and under which bells, or null
// where "now" is not known:
//
//   today settled by the calendar or the reader   that day type, today's bells
//   a date with no school                        nothing: no period is now,
//                                                whatever was chosen by hand
//   otherwise                                    the kind every day type is,
//                                                or the one the reader chose
//                                                (kept under `day`), with the
//                                                bells chosen beside it
//                                                (kept under `bells`)
export function liveKindOf(ctx, kinds) {
  const today = todayOf(ctx);
  if (today.known && !today.school) return null;
  if (today.known) {
    const kind = today.dayType === null ? null : kinds.find((each) => each.dayTypes.some((dayType) => dayType.id === today.dayType.id)) || null;
    return kind === null ? null : { kind, bellsId: today.bellsId };
  }
  const kind = kinds.length === 1 ? kinds[0] : today.by === 'hand' ? kinds.find((each) => each.dayTypes.some((dayType) => dayType.id === today.dayType.id)) || null : null;
  return kind === null ? null : { kind, bellsId: today.bellsId };
}

// The names of a kind of day: "A Day", or "A Day and B Day" when they are the
// same.
export function kindName(kind) {
  return wordsJoined(kind.dayTypes.map((dayType) => typed(dayType.name)));
}

// From this many cards on, only the first is open and the others are
// disclosures, each headed by its day names (DESIGN 11.8).
export const DAY_CARDS_OPEN_MOST = 3;

// The day as cards, one per kind of day. `rowOf(dayType, period)` gives
// { what, where } for a row: text or nodes.
//
// When the calendar (or the reader) says which day today is, the line saying
// so stands over the cards and today's card comes first, tagged "Today", with
// the current period marked. When today rings other bells than the day
// type's regular ones (an early release), today's card is a card of its own,
// with today's times and the periods that do not meet said so, and the day
// type's own card keeps its regular times further on; that card is for the
// screen, and paper has the regular cards only. The cards are drawn again
// when today changes while the page is open (past midnight, or a phone woken
// the next morning), and the current period moves as time passes.
export function dayCardsOf(ctx, kinds, rowOf) {
  const school = ctx.school;
  const today = todayOf(ctx);
  const settled = today.known && today.school && today.dayType !== null;
  const live = liveKindOf(ctx, kinds);
  const todayKind = settled && live !== null ? live.kind : null;
  // a card of its own for the bells in force, whoever said so
  const ownCard = live !== null && live.bellsId !== null;
  const ordered = todayKind !== null && !ownCard ? [todayKind].concat(kinds.filter((kind) => kind !== todayKind)) : kinds;

  const cardOf = (kind, bellsId, isToday, open) => {
    const own = bellsId !== null;
    const bells = school.bells(kind.first.id, bellsId);
    const schedule = bellsId ? school.bellSchedule(bellsId) : null;
    const rows = bells.map((bell, period) => {
      const off = bell.off === true;
      const row = off ? { what: h('span', { class: 'muted' }, 'No class'), where: null } : rowOf(kind.first, period);
      return h('li', { class: 'row', dataset: off ? { period: String(period), off: 'true' } : { period: String(period) } },
        h('span', { class: 'row__when' },
          h('span', { class: 'row__period' }, school.periodName(period)),
          bell.start && bell.end ? h('span', { class: 'row__time' }, school.time(bell.start) + ' to ' + school.time(bell.end)) : null),
        h('span', { class: 'row__what' }, row.what),
        h('span', { class: 'row__where' }, row.where));
    });
    const title = [
      h('h2', { class: 'card__title' }, kindName(kind)),
      isToday ? h('span', { class: 'day__tag' }, kind.dayTypes.length > 1 ? ['Today: ', typed(today.dayType.name)] : 'Today') : null,
      schedule ? h('p', { class: 'day__bells' }, typed(schedule.name), ' bells') : null,
    ];
    // (dom.js writes a dataset's value as it is, so what a card is not is left off)
    const dataset = { days: kind.dayTypes.map((dayType) => dayType.id).join(' ') };
    if (isToday) dataset.today = 'true';
    if (bellsId) dataset.bells = bellsId;
    if (own) dataset.own = 'true';
    const attrs = { class: 'card day' + (own ? ' no-print' : ''), dataset };
    const list = h('ol', { class: 'rows' }, rows);
    if (open) return h('section', attrs, h('div', { class: 'day__head' }, title), list);
    return h('details', attrs, h('summary', { class: 'day__head' }, title), list);
  };

  const cards = [];
  if (ownCard) cards.push(cardOf(live.kind, live.bellsId, settled, true));
  for (const kind of ordered) cards.push(cardOf(kind, null, !ownCard && kind === todayKind, true));
  if (cards.length > DAY_CARDS_OPEN_MOST) {
    for (let at = 1; at < cards.length; at += 1) {
      const kind = ownCard ? ordered[at - 1] : ordered[at];
      cards[at] = cardOf(kind, null, false, false);
    }
  }
  const days = h('div', { class: 'days', dataset: { count: String(cards.length), paper: String(kinds.length) } }, cards);

  // the current period, on the card of the kind of day it is and under the
  // bells it rings
  const liveDays = live === null ? null : live.kind.dayTypes.map((dayType) => dayType.id).join(' ');
  const mark = () => {
    const now = clockNow(ctx);
    for (const card of days.querySelectorAll('.day')) {
      let current = -1;
      if (live !== null && card.dataset.days === liveDays && (card.dataset.bells || null) === live.bellsId) {
        const moment = momentOf(school, live.kind.first.id, now, live.bellsId);
        current = moment.state === 'in' ? moment.period : -1;
      }
      for (const row of card.querySelectorAll('.row')) {
        const here = Number(row.dataset.period) === current;
        row.classList.toggle('row--now', here);
        const was = row.querySelector('.row__mark');
        if (here && !was) row.querySelector('.row__when').appendChild(h('span', { class: 'row__mark' }, 'Now'));
        if (!here && was) was.remove();
      }
    }
  };
  mark();

  const line = todayLine(ctx, () => ctx.redraw());
  const box = h('div', { class: 'daybox' }, line, days);
  const key = todayKey(today);
  watchClock(box, () => {
    if (todayKey(todayOf(ctx)) !== key) ctx.redraw();
    else mark();
  });
  return box;
}

// Every disclosure of the day cards is open on paper, and back as it was after.
if (typeof globalThis.addEventListener === 'function') {
  let opened = [];
  globalThis.addEventListener('beforeprint', () => {
    opened = Array.from(document.querySelectorAll('details.day:not([open])'));
    for (const details of opened) details.open = true;
  });
  globalThis.addEventListener('afterprint', () => {
    for (const details of opened) details.open = false;
    opened = [];
  });
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

// A teacher's page. `heading` is for the reader's own ("My schedule"): the
// name then starts the sentence under it. Left out, the heading is the name.
export function teacherPageOf(ctx, teacher, heading) {
  const school = ctx.school;
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
    teacherOutputs(ctx, teacher, kinds),
  ];
  const notes = isMe(ctx, teacher.id) ? noteFields(ctx, days) : null;
  const summary = partsToNodes(teacherSummaryOf(school, teacher.id));
  return pageOf(heading || typed(teacher.name), heading ? [typed(teacher.name), '. ', summary] : summary,
    map ? besideMap([header, days, notes], map, after) : [header, days, notes, after]);
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
    const teacher = ctx.school.teacher(route.id);
    return teacher ? teacherPageOf(ctx, teacher, null) : missingPage('teacher');
  },
};
