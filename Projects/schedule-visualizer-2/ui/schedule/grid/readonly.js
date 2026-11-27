// The schedule read from the other two sides: one row per teacher, or one row
// per room, a slot per period. This file only works out what each slot says,
// as plain data; the sheet (sheet.js) draws it and, since SV2-155, edits it
// (across.js says how). A slot says which groups are there (and, for a
// teacher, in which room).
//
// A slot carries the findings of the groups in it, for that period of that
// day type: the same findings, by the same key, that the Groups rows mark
// their slots from (model.js `findings`), so the three orientations mark the
// same places.
//
// A day type that follows another has no classes of its own: its slots are
// the ones of the day type it copies (the effective day type), and the sheet
// greys them.

import { ownDayTypes, effectiveDayType } from '../../../engine/day-types.js';
import { teacherDays, isFree } from '../../../engine/teacher-day.js';
import { dutiesByTeacher, schoolMarkFor } from '../../../engine/marks.js';
import { meetingSlots } from '../../../engine/runs.js';
import { dutyNamed, sometimesWords, MARK_AS_NAMED } from '../../../engine/checks.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { collator } from '../common.js';
import { slotKeyOf } from './staged.js';
import { worstFirst } from './words.js';

// The findings on the slots of these groups, each once, worst first.
function findingsOf(findings, groupIds, dayTypeId, period) {
  const found = new Map();
  for (const groupId of groupIds) {
    for (const finding of (findings && findings.get(slotKeyOf(groupId, dayTypeId, period))) || []) found.set(finding.id, finding);
  }
  return worstFirst(Array.from(found.values()));
}

function groupNames(project, ids) {
  return ids.map((id) => (project.groups.find((group) => group.id === id) || { name: '' }).name);
}

// What the Teachers rows call a room: its number, or its own words.
export function roomNumber(project, roomId) {
  const room = roomId ? findRoom(project, roomId) : null;
  return room ? (room.number.trim() === '' ? roomName(room) : room.number) : 'a room not in the building';
}

// The rows of the day types asked for (ids; a follower's included) come back
// as { first, free, rows, extras }:
//   rows    [{ id, kind, name, free, cell(dayTypeId, period), extra(dayTypeId, which) }]
//           cell → { text, findings, duty, groupIds, groupNames, taught }
//           `taught` is a teacher's groups there as { groupId, roomId }; the
//           groups of a room's slot are in `groupIds`
//   extras  [{ id, label }] the columns after a day type's periods ('Before',
//           'After': a teacher's duties before and after school, DESIGN 11.5)
function effectiveIds(project, dayTypeIds) {
  const wanted = Array.isArray(dayTypeIds) ? dayTypeIds : ownDayTypes(project).map((dayType) => dayType.id);
  return new Set(wanted.map((id) => effectiveDayType(project, id).id));
}

// One row per teacher: "7-1 in 204". `findings` is the grid model's: slot key
// to the findings on that slot.
export function teacherRows(project, findings, dayTypeIds) {
  const need = effectiveIds(project, dayTypeIds);
  const days = new Map();
  const duties = new Map();
  for (const id of need) {
    days.set(id, teacherDays(project, id));
    duties.set(id, dutiesByTeacher(project, id));
  }
  // "Before" and "After" are columns when any teacher has such a duty
  const some = (when) => Array.from(need).some((id) => Array.from(duties.get(id).values()).some((mine) => mine[when].length > 0));
  const extras = [].concat(some('before') ? [{ id: 'before', label: 'Before' }] : [], some('after') ? [{ id: 'after', label: 'After' }] : []);
  // "Lunch duty", or "Bus duty (on Wednesdays)" for one that holds some days
  const dutyWords = (duty) => dutyNamed(duty) + (sometimesWords(duty) === '' ? '' : ' (' + sometimesWords(duty) + ')');
  const own = (dayTypeId) => effectiveDayType(project, dayTypeId).id;
  return {
    first: 'Teacher',
    free: 'Planning',
    extras,
    rows: project.teachers.map((teacher) => ({
      id: teacher.id,
      kind: 'teacher',
      name: teacher.name,
      free: 'Planning',
      cell: (dayTypeId, period) => {
        const id = own(dayTypeId);
        const entry = days.get(id).get(teacher.id)[period];
        const taught = entry.groups;
        const extra = entry.duties.map(dutyWords);
        const ids = taught.map((each) => each.groupId);
        const base = { groupIds: ids, groupNames: groupNames(project, ids), taught: taught.map((each) => ({ groupId: each.groupId, roomId: each.roomId })) };
        if (entry.kind === 'teaching') {
          return {
            ...base,
            text: taught.map((each) => groupNames(project, [each.groupId])[0] + ' in ' + roomNumber(project, each.roomId)).concat(extra).join(', '),
            findings: findingsOf(findings, ids, id, period),
            duty: false,
          };
        }
        if (isFree(entry)) return { ...base, text: extra.join(', '), findings: [], duty: extra.length > 0 };
        // an always duty takes the period, or else the school's mark does
        const always = entry.duties.filter((duty) => sometimesWords(duty) === '').map(dutyWords);
        const mark = schoolMarkFor(project, id, period);
        const taken = entry.marked === 'away' ? [MARK_AS_NAMED.away] : always.length > 0 ? always : [mark && mark.label !== '' ? mark.label : MARK_AS_NAMED[entry.marked]];
        return { ...base, text: taken.concat(entry.duties.filter((duty) => sometimesWords(duty) !== '').map(dutyWords)).join(', '), findings: [], duty: true };
      },
      extra: (dayTypeId, which) => {
        const mine = duties.get(own(dayTypeId)).get(teacher.id);
        return mine ? mine[which].map(dutyWords).join(', ') : '';
      },
    })),
  };
}

// One row per room: the groups in it.
export function roomRows(project, findings, dayTypeIds) {
  const need = effectiveIds(project, dayTypeIds);
  const rooms = allRooms(project).slice().sort((a, b) => collator.compare(a.number, b.number));
  const inRoom = new Map();
  for (const dayType of ownDayTypes(project)) {
    if (!need.has(dayType.id)) continue;
    for (const group of project.groups) {
      // a period marked No class does not meet: its room is not in use then
      meetingSlots(project, group.id, dayType.id).forEach((slot, period) => {
        const room = resolveSlotRoom(project, slot).room;
        if (!room) return;
        const key = room.id + '|' + dayType.id + '|' + period;
        if (!inRoom.has(key)) inRoom.set(key, []);
        inRoom.get(key).push(group);
      });
    }
  }
  return {
    first: 'Room',
    free: 'Empty',
    extras: [],
    rows: rooms.map((room) => ({
      id: room.id,
      kind: 'room',
      name: room.number.trim() === '' ? roomName(room, true) : room.number,
      free: 'Empty',
      cell: (dayTypeId, period) => {
        const id = effectiveDayType(project, dayTypeId).id;
        const groups = inRoom.get(room.id + '|' + id + '|' + period) || [];
        return {
          text: groups.map((group) => group.name).join(', '),
          findings: findingsOf(findings, groups.map((group) => group.id), id, period),
          duty: false,
          groupIds: groups.map((group) => group.id),
          groupNames: groups.map((group) => group.name),
          taught: [],
        };
      },
      extra: () => '',
    })),
  };
}
