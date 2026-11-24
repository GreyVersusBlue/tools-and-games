// The one rule for a teacher's day. Teachers are not entered period by
// period: their day is worked out from where the groups are.
//
// A slot counts for teacher T when the slot names T, or when the slot names
// nobody and its room lists T among the teachers based there. So a slot that
// names a teacher takes the group away from the room's other teachers: that
// is how two teachers sharing a room, or one teacher with two rooms, are told
// apart. A slot that names several teachers is co-teaching, and counts for
// each of them.
//
// A period in which no slot counts is planning. A slot the group does not meet
// in (a No class mark, or a bell schedule's off period) and a slot under a
// Lunch mark do not count either (marks.js, runs.js). Planning is "free" only
// when nothing else takes it: an entry's `marked` says what does, and
// isFree(entry) is the one rule for it (ARCHITECTURE 17.6).
//
// Every screen, check, print and published file asks through here. This
// module is one of those a published file carries, so it keeps to the linker
// rule: one-line named imports, `export` only directly before a declaration.

import { findRoom, findById, roomNumberKey, WEEKDAY_NAMES } from './schema.js';
import { findDayType } from './day-types.js';
import { offPeriods, periodLabel, periodNumberName, periodWordForms } from './bells.js';
import { meetingSlots } from './runs.js';
import { markFor, schoolMarkFor, dutiesByTeacher, dutyIsSometimes, awayFor, awayEntry } from './marks.js';

// The teachers a slot counts for, by the rule above. Ids as stored; the
// caller decides what to do with an id that names nobody.
export function slotTeacherIds(project, slot) {
  if (!slot) return [];
  if (Array.isArray(slot.teacherIds) && slot.teacherIds.length > 0) return slot.teacherIds;
  const room = slot.room ? findRoom(project, slot.room) : null;
  return room && Array.isArray(room.teacherIds) ? room.teacherIds : [];
}

// Every teacher's day on day type D in one pass: a Map of teacher id to one
// entry per period, { period, groups: [{ groupId, roomId, roomText }], kind,
// duties, marked }, where kind is "teaching" or "planning". Groups are in the
// school's own order. When the slot's room is not in the building roomId is
// null and roomText is the number the slot kept; otherwise roomText is "".
// `duties` is every duty the teacher has in the period, always or sometimes.
// `marked` is set only on planning entries, to what takes the period, in this
// order: a period nobody meets in, a school "noclass" mark or an off period of
// `options.bellsId` ("noclass": a teacher "away" in a period that does not
// exist for anyone reads as that period, "No class"); an "away" when the
// teacher is not in school then (`teacher.away`, awayFor); an always duty's
// kind ("duty", "meeting", "lunch"); another school mark's kind ("lunch",
// "advisory", "activity"); else null. A duty that holds only on some days
// counts as always only when `options.date` is given and matches.
// `options.bellsId` is a bell schedule whose off periods do not meet. Null
// when D is not a day type of this project.
export function teacherDays(project, dayTypeId, options) {
  if (!findDayType(project, dayTypeId)) return null;
  const date = options && typeof options.date === 'string' ? options.date : null;
  const bellsId = options && typeof options.bellsId === 'string' ? options.bellsId : null;
  const periods = project.settings.periods;
  const duties = dutiesByTeacher(project, dayTypeId, date);
  const days = new Map();
  for (const teacher of project.teachers) {
    const day = [];
    const mine = duties.get(teacher.id);
    for (let period = 0; period < periods; period += 1) day.push({ period, groups: [], kind: 'planning', duties: mine ? mine.byPeriod[period] : [], marked: null });
    days.set(teacher.id, day);
  }
  for (const group of project.groups) {
    const schedule = meetingSlots(project, group.id, dayTypeId, bellsId);
    for (let period = 0; period < periods; period += 1) {
      const slot = schedule[period];
      const teacherIds = slotTeacherIds(project, slot);
      if (teacherIds.length === 0) continue;
      const mark = markFor(project, group.id, dayTypeId, period);
      if (mark && mark.kind === 'lunch') continue;
      const roomId = slot.room && findRoom(project, slot.room) ? slot.room : null;
      const roomText = roomId === null && typeof slot.roomText === 'string' ? slot.roomText : '';
      for (const teacherId of teacherIds) {
        const day = days.get(teacherId);
        if (!day) continue;
        const entry = day[period];
        if (entry.groups.some((taught) => taught.groupId === group.id)) continue;
        entry.groups.push({ groupId: group.id, roomId, roomText });
        entry.kind = 'teaching';
      }
    }
  }
  const off = offPeriods(project, bellsId);
  const schoolMarks = [];
  for (let period = 0; period < periods; period += 1) {
    const mark = off.has(period) ? { kind: 'noclass' } : schoolMarkFor(project, dayTypeId, period);
    schoolMarks.push(mark ? mark.kind : null);
  }
  const teachersById = new Map(project.teachers.map((teacher) => [teacher.id, teacher]));
  for (const [teacherId, day] of days) {
    const teacher = teachersById.get(teacherId);
    const hasAway = Boolean(teacher) && Array.isArray(teacher.away) && teacher.away.length > 0;
    for (const entry of day) {
      if (entry.kind !== 'planning') continue;
      if (schoolMarks[entry.period] === 'noclass') {
        entry.marked = 'noclass';
        continue;
      }
      if (hasAway && awayFor(teacher, dayTypeId, entry.period, { project, date, bellsId })) {
        entry.marked = 'away';
        continue;
      }
      const always = entry.duties.find((duty) => !dutyIsSometimes(duty) || date !== null);
      entry.marked = always ? always.kind : schoolMarks[entry.period];
    }
  }
  return days;
}

// What is teacher T doing in each period on day type D? One entry per period
// as above; `options` as above. Null when the teacher or the day type does
// not exist.
export function teacherDay(project, teacherId, dayTypeId, options) {
  if (!findById(project.teachers, teacherId)) return null;
  const days = teacherDays(project, dayTypeId, options);
  return days ? days.get(teacherId) : null;
}

// The periods of an away entry in words: a run joined with "to" by number
// ("Periods 7 to 8", "Blocks E to H"), a lone one by its number name ("Period 7"),
// separate ones listed.
function awayPeriods(settings, periods) {
  const forms = periodWordForms(settings);
  const sorted = Array.from(new Set(periods)).sort((a, b) => a - b);
  const runs = [];
  for (const period of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[1] === period - 1) last[1] = period;
    else runs.push([period, period]);
  }
  const words = runs.map(([from, to]) => {
    if (from === to) return periodNumberName(settings, from);
    // "1st to 3rd Hour": the word follows an ordinal range, as it does in speech
    if (forms.count === 'ordinal') return periodLabel(settings, from) + ' to ' + periodNumberName(settings, to);
    return forms.many + ' ' + periodLabel(settings, from) + ' to ' + periodLabel(settings, to);
  });
  return words.length <= 1 ? words.join('') : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

// An away entry in words (ARCHITECTURE 22.10): "Not in school", then the
// periods ("in Periods 7 to 8"), the weekdays ("on Fridays") and the day
// types ("on B Day", DESIGN 16.12 item 4; after weekdays "on Fridays (B Day)"),
// whichever the entry names. `dayTypes` is the
// project's list. The entry is read as awayFor reads it (awayEntry), so an
// entry that holds nowhere is worded nowhere: '' for it. Day type names are
// given as typed.
export function awayWords(settings, entry, dayTypes) {
  const read = awayEntry(entry, dayTypes);
  if (read === null) return '';
  const parts = ['Not in school'];
  if (read.periods.length > 0) parts.push('in ' + awayPeriods(settings, read.periods));
  if (read.weekdays.length > 0) {
    const names = read.weekdays.map((day) => WEEKDAY_NAMES[day] + 's');
    parts.push('on ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]));
  }
  const nameOf = new Map((Array.isArray(dayTypes) ? dayTypes : []).filter((dayType) => dayType && typeof dayType.id === 'string' && typeof dayType.name === 'string').map((dayType) => [dayType.id, dayType.name]));
  const named = read.dayTypeIds.filter((id) => nameOf.has(id)).map((id) => nameOf.get(id));
  const days = named.length === 1 ? named[0] : named.slice(0, -1).join(', ') + ' or ' + named[named.length - 1];
  // weekdays and day types together: "on Fridays (B Day)", never "on Fridays on B Day" (SV2-142b)
  if (named.length > 0) parts.push(read.weekdays.length > 0 ? '(' + days + ')' : 'on ' + days);
  return parts.join(' ');
}

// Is the teacher free in this entry? Planning, and nothing else takes the
// period. The one rule for "free"; every screen and check asks it.
export function isFree(entry) {
  return Boolean(entry) && entry.kind === 'planning' && !entry.marked;
}

// The rooms a teacher is in during one period of their day, each once, in the
// order met. A slot whose room is not in the building adds nothing.
export function entryRoomIds(entry) {
  const roomIds = [];
  for (const taught of entry.groups) {
    if (taught.roomId !== null && !roomIds.includes(taught.roomId)) roomIds.push(taught.roomId);
  }
  return roomIds;
}

// The places a teacher is in during one period, in the order met: each room
// in the building once, and each room that is not in the building once, told
// apart by the number its slots kept (compared the way room numbers are, so
// "204" and " 204" are one place). Each is { roomId, roomText, groupIds };
// roomId is null for a room that is not in the building. A slot with no room
// and no number is nowhere, and adds nothing. Two or more places in one
// period is what "a teacher in two rooms" means.
export function entryPlaces(entry) {
  const places = new Map();
  for (const taught of entry.groups) {
    const text = typeof taught.roomText === 'string' ? taught.roomText : '';
    if (taught.roomId === null && roomNumberKey(text) === '') continue;
    const key = taught.roomId === null ? 'text:' + roomNumberKey(text) : 'room:' + taught.roomId;
    if (!places.has(key)) places.set(key, { roomId: taught.roomId, roomText: taught.roomId === null ? text : '', groupIds: [] });
    places.get(key).groupIds.push(taught.groupId);
  }
  return Array.from(places.values());
}

// The walks in a teacher's day: from one period straight into the next, when
// the teacher has a group in both, is in exactly one room in each, and the
// two rooms differ. `day` is what teacherDay() gave. Each walk is
// { period, fromRoomId, toRoomId }, `period` being the one walked out of.
// A walk across a planning period is not one: there is a whole period for it.
export function teacherMoves(day) {
  const moves = [];
  for (let period = 0; period < day.length - 1; period += 1) {
    const from = entryRoomIds(day[period]);
    const to = entryRoomIds(day[period + 1]);
    if (from.length !== 1 || to.length !== 1 || from[0] === to[0]) continue;
    moves.push({ period, fromRoomId: from[0], toRoomId: to[0] });
  }
  return moves;
}
