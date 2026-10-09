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
// A period in which no slot counts is planning.
//
// Every screen, check, print and published file asks through here. This
// module is one of those a published file carries, so it keeps to the linker
// rule: one-line named imports, `export` only directly before a declaration.

import { findRoom, findById, roomNumberKey } from './schema.js';
import { effectiveSchedule, findDayType } from './day-types.js';

// The teachers a slot counts for, by the rule above. Ids as stored; the
// caller decides what to do with an id that names nobody.
export function slotTeacherIds(project, slot) {
  if (!slot) return [];
  if (Array.isArray(slot.teacherIds) && slot.teacherIds.length > 0) return slot.teacherIds;
  const room = slot.room ? findRoom(project, slot.room) : null;
  return room && Array.isArray(room.teacherIds) ? room.teacherIds : [];
}

// Every teacher's day on day type D in one pass: a Map of teacher id to one
// entry per period, { period, groups: [{ groupId, roomId, roomText }], kind },
// where kind is "teaching" or "planning". Groups are in the school's own
// order. When the slot's room is not in the building roomId is null and
// roomText is the number the slot kept; otherwise roomText is "". Null when D
// is not a day type of this project.
export function teacherDays(project, dayTypeId) {
  if (!findDayType(project, dayTypeId)) return null;
  const periods = project.settings.periods;
  const days = new Map();
  for (const teacher of project.teachers) {
    const day = [];
    for (let period = 0; period < periods; period += 1) day.push({ period, groups: [], kind: 'planning' });
    days.set(teacher.id, day);
  }
  for (const group of project.groups) {
    const schedule = effectiveSchedule(project, group.id, dayTypeId);
    for (let period = 0; period < periods; period += 1) {
      const slot = schedule[period];
      const teacherIds = slotTeacherIds(project, slot);
      if (teacherIds.length === 0) continue;
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
  return days;
}

// What is teacher T doing in each period on day type D? One entry per period
// as above. Null when the teacher or the day type does not exist.
export function teacherDay(project, teacherId, dayTypeId) {
  if (!findById(project.teachers, teacherId)) return null;
  const days = teacherDays(project, dayTypeId);
  return days ? days.get(teacherId) : null;
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
