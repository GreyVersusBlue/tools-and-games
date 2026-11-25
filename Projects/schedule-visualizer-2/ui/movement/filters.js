// The movement view's two filters on where groups walk (ARCHITECTURE 23.7;
// spec 7.1): a destination room ("Going to") and a subject ("Rooms of
// subject"). No DOM: the picture, the hotspots, the tables and the export
// all read through these, so one rule decides what a filter keeps.
//
//   walkMatches(project, slotTo, { toRoomId, subjectId })
//       does the slot a walk ends in pass the filters?
//   filteredRoutes(project, run, groups, choice)
//       a routes object of the run with every walk that does not pass null
//   destinationWords(project, choice)
//       the filters in words, as parts ({ text, name? }, name marking what
//       was typed)
//
// The rule for one walk: its destination slot's room is `toRoomId` (when
// that is set), and that room's subject is `subjectId` (when that is set; ""
// is a room with none). A slot whose room number is not in the building
// matches no room and the "" subject only. A slot with no room at all
// matches neither filter. With neither filter set every slot passes.

import { resolveSlotRoom, nameOfRoom, findRoom, findById } from '../../engine/schema.js';
import { meetingSlots } from '../../engine/runs.js';
import { offPeriods } from '../../engine/bells.js';
import { walkTarget } from '../../engine/routing.js';

function subjectsOf(project) {
  return Array.isArray(project.subjects) ? project.subjects : [];
}

function roomFilter(filter) {
  return filter && typeof filter.toRoomId === 'string' && filter.toRoomId !== '' ? filter.toRoomId : null;
}

// null when no subject filter is set; "" or a subject id when one is
function subjectFilter(filter) {
  return filter && typeof filter.subjectId === 'string' ? filter.subjectId : null;
}

export function walkMatches(project, slotTo, filter) {
  const toRoomId = roomFilter(filter);
  const subjectId = subjectFilter(filter);
  if (toRoomId === null && subjectId === null) return true;
  const found = resolveSlotRoom(project, slotTo);
  if (!found.room) return toRoomId === null && subjectId === '' && found.missing;
  if (toRoomId !== null && found.room.id !== toRoomId) return false;
  if (subjectId !== null && (typeof found.room.subjectId === 'string' ? found.room.subjectId : '') !== subjectId) return false;
  return true;
}

// The period the walk out of `t` ends in, as routesForSchedule decides it:
// the next one, or past the periods that do not meet.
function destinationOf(off, periods, t) {
  const target = off.size === 0 ? null : walkTarget(off, periods, t);
  return target === null ? t + 1 : target;
}

// `run` is one entry of a routes result ({ dayTypeId, bellsId?, groups: [{
// groupId, routes }] }); `groups` are the entries of its groups to keep (the
// whole of run.groups when left out; the project's own group objects are read
// too, by id). The result is routesOfRun's shape, `{ days: [entry] }` or, for a
// bell schedule's run, `{ days: [], bells: [entry] }`, so loads() reads it. Every
// route object is the run's own; a walk that does not pass the filters is
// null, and so is one that is no walk (a group already in the room is not
// walking into it, and a period with no room, or one that does not meet, is
// not walked out of). With no filter set the entries are the run's own.
export function filteredRoutes(project, run, groups, choice) {
  const bellsId = typeof run.bellsId === 'string' ? run.bellsId : null;
  const wanted = Array.isArray(groups) ? groups : run.groups;
  const entries = [];
  for (const each of wanted) {
    const entry = Array.isArray(each.routes) ? each : run.groups.find((candidate) => candidate.groupId === (each.groupId !== undefined ? each.groupId : each.id));
    if (entry) entries.push(entry);
  }
  const filtered = roomFilter(choice) !== null || subjectFilter(choice) !== null;
  const kept = filtered ? [] : entries;
  if (filtered) {
    const off = offPeriods(project, bellsId);
    for (const entry of entries) {
      const slots = meetingSlots(project, entry.groupId, run.dayTypeId, bellsId);
      const routes = entry.routes.map((found, t) => {
        if (!found || found.same === true || (found.ok === false && found.reason === 'no-room') || !slots) return null;
        return walkMatches(project, slots[destinationOf(off, slots.length, t)], choice) ? found : null;
      });
      kept.push({ ...entry, routes });
    }
  }
  const mine = { ...run, groups: kept };
  return bellsId !== null ? { days: [], bells: [mine] } : { days: [mine] };
}

// The room as a sentence names it, as parts: "Room " and the number typed,
// or the number alone when it is a word ("Gym").
function roomParts(room) {
  const named = nameOfRoom(room, false);
  const number = typeof room.number === 'string' ? room.number : '';
  if (number.trim() === '') return [{ text: named }];
  return named === 'Room ' + number ? [{ text: 'Room ' }, { text: number, name: true }] : [{ text: number, name: true }];
}

// "into Room 204", "into Science rooms", "into rooms with no subject"; both
// together "into Room 204, if it is a Science room". Empty when no filter is
// set. An id the project no longer has is said so, never skipped.
export function destinationWords(project, choice) {
  const toRoomId = roomFilter(choice);
  const subjectId = subjectFilter(choice);
  if (toRoomId === null && subjectId === null) return [];
  const parts = [{ text: 'into ' }];
  if (toRoomId !== null) {
    const room = findRoom(project, toRoomId);
    parts.push(...(room ? roomParts(room) : [{ text: 'a room that is no longer in the building' }]));
    if (subjectId === null) return parts;
    parts.push({ text: ', if it is ' });
    if (subjectId === '') {
      parts.push({ text: 'a room with no subject' });
      return parts;
    }
    const subject = findById(subjectsOf(project), subjectId);
    parts.push(subject ? { text: 'a ' } : { text: 'a room of a subject that is no longer listed' });
    if (subject) parts.push({ text: subject.name, name: true }, { text: ' room' });
    return parts;
  }
  if (subjectId === '') {
    parts.push({ text: 'rooms with no subject' });
    return parts;
  }
  const subject = findById(subjectsOf(project), subjectId);
  if (subject) parts.push({ text: subject.name, name: true }, { text: ' rooms' });
  else parts.push({ text: 'rooms of a subject that is no longer listed' });
  return parts;
}
