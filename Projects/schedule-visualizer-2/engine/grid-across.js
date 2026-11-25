// Editing the schedule from a room's side or a teacher's side (ARCHITECTURE
// 23.8, 23.12). The Grid's Rooms and Teachers rows show who is where; this
// module turns one edited cell of those rows into the slot fields that make
// it so. It only works the change out. The page stages the fields with
// stageSlot and applies them with applyGridEdits, so the whole edit is one
// staged step and one undo step.
//
//   roomCellEdit(project, { roomId, dayTypeId, period, groupIds })
//   teacherCellEdit(project, { teacherId, dayTypeId, period, groupIds, roomId? })
//   acrossBlock(project, cells)      a pasted or deleted block, cell by cell
//   groupsInText(project, text)      what a cell's typed text names
//
// Each returns
//   { slots, moved, cleared, taken, refused }
//   slots    [{ groupId, dayTypeId, period, fields }], fields as setSlot's slot
//            ({ room, roomText, teacherIds } of them): staged as they are
//   moved    [{ groupId, fromRoomId, fromText, droppedTeacherIds }] groups put
//            in another room than the one they had (fromRoomId null and
//            fromText the number typed for a room not in the building, or ''
//            for none); droppedTeacherIds are the teachers the slot named
//            that were taken off it because none of them is based in the new
//            room
//   cleared  [groupId] groups left with no room by the edit
//   taken    [{ groupId, roomId }] groups a teacher's cell gained
//   refused  null, or one sentence saying what was wrong and what to do; a
//            refused edit has no slots, moved, cleared or taken
//
// `project` is the project as the grid would have it with the draft applied
// (staged.js preview()'s), never the stored one. acrossBlock also returns
// `project`, the schedule after every cell, and `payload`, the slots as
// applyGridEdits takes them.
//
// This module is plain logic: no page, no storage, no clock.

import { nameKey, findRoom, allRooms, resolveSlotRoom } from './schema.js';
import { findDayType, isOwnCopy, effectiveDayType } from './day-types.js';
import { periodName, offPeriods, findBellSchedule } from './bells.js';
import { markFor } from './marks.js';
import { meetingSlots } from './runs.js';
import { teacherDays } from './teacher-day.js';
import { roomName } from './findings.js';

const NONE = Object.freeze([]);

function refusal(sentence) {
  return { slots: [], moved: [], cleared: [], taken: [], refused: sentence };
}

function sameList(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// A room as the Rooms rows name it: its number, or its own words when it has none.
function numberOf(room) {
  return room.number.trim() === '' ? roomName(room) : room.number;
}

function groupOf(project, groupId) {
  return project.groups.find((group) => group.id === groupId) || null;
}

// ---------------------------------------------------------------- typing

// The groups a cell's typed text names: { groupIds, refused }. The whole text
// is tried as one group's name first (a group named "Art, 2nd" matches
// whole), then the text is split on commas and semicolons and each piece
// matched; a run of pieces that together spell a group's name ("Art, 2nd" in
// "7-1, Art, 2nd") is taken as that group, the longest run first. Names are
// matched by nameKey (case and the spaces at the ends do not count). A piece
// that matches no group is refused; two pieces matching one group are refused.
// Nothing typed names nobody: { groupIds: [] }.
export function groupsInText(project, text) {
  const typed = typeof text === 'string' ? text : '';
  if (typed.trim() === '') return { groupIds: [], refused: null };
  const byKey = new Map();
  for (const group of project.groups) if (!byKey.has(nameKey(group.name))) byKey.set(nameKey(group.name), group);
  const whole = byKey.get(nameKey(typed));
  if (whole) return { groupIds: [whole.id], refused: null };
  // the pieces, each with where it starts and ends in the text
  const pieces = [];
  const edges = /[,;]/g;
  let from = 0;
  for (let edge = edges.exec(typed); ; edge = edges.exec(typed)) {
    const to = edge ? edge.index : typed.length;
    if (typed.slice(from, to).trim() !== '') pieces.push({ from, to });
    if (!edge) break;
    from = to + 1;
  }
  const found = [];
  let at = 0;
  while (at < pieces.length) {
    let end = pieces.length - 1;
    let match = null;
    for (; end >= at; end -= 1) {
      match = byKey.get(nameKey(typed.slice(pieces[at].from, pieces[end].to)));
      if (match) break;
    }
    if (!match) return { groupIds: [], refused: 'No class is called ' + typed.slice(pieces[at].from, pieces[at].to).trim() + '. Add it in the Groups rows first.' };
    const said = typed.slice(pieces[at].from, pieces[end].to).trim();
    const again = found.find((each) => each.group === match);
    if (again) return { groupIds: [], refused: again.said + ' and ' + said + ' are the same group. Name it once.' };
    found.push({ group: match, said });
    at = end + 1;
  }
  return { groupIds: found.map((each) => each.group.id), refused: null };
}

// ---------------------------------------------------------------- what a cell may be

// Why a group does not meet in a period, in a word or two ("No class"), or
// null when it does. The one rule is runs.js meetingSlots': a No class mark
// takes the period, or the bell schedule turns it off.
function whyNotMeeting(project, groupId, dayTypeId, period, bellsId) {
  const mark = markFor(project, groupId, dayTypeId, period);
  if (mark && mark.kind === 'noclass') return typeof mark.label === 'string' && mark.label.trim() !== '' ? mark.label : 'No class';
  if (offPeriods(project, bellsId).has(period)) {
    const schedule = findBellSchedule(project, bellsId);
    return 'off in ' + (schedule && typeof schedule.name === 'string' && schedule.name.trim() !== '' ? schedule.name : 'this bell schedule');
  }
  return null;
}

// The refusal for a cell that cannot be edited at all, or null: a day type
// that is gone or follows another, a period the day does not have.
function cellRefusal(project, dayTypeId, period) {
  const dayType = findDayType(project, dayTypeId);
  if (!dayType) return 'That day type is no longer in the project.';
  if (!isOwnCopy(project, dayTypeId)) return dayType.name + ' is the same as ' + effectiveDayType(project, dayTypeId).name + '. Make it its own copy to change it.';
  if (!Number.isInteger(period) || period < 0 || period >= project.settings.periods) return 'That period is not in the school day. The day has ' + project.settings.periods + '.';
  return null;
}

// The refusal for a group named in a cell that does not meet then, or null.
function meetingRefusal(project, groupId, dayTypeId, period, bellsId) {
  const group = groupOf(project, groupId);
  if (!group) return 'That group is no longer in the schedule.';
  const why = whyNotMeeting(project, groupId, dayTypeId, period, bellsId);
  if (why === null) return null;
  return group.name + ' does not meet in ' + periodName(project.settings, period) + ' on ' + findDayType(project, dayTypeId).name + ' (' + why + ').';
}

function slotOf(project, groupId, dayTypeId, period) {
  return groupOf(project, groupId).days[dayTypeId][period];
}

function unique(list) {
  return Array.from(new Set(Array.isArray(list) ? list : NONE));
}

// ---------------------------------------------------------------- a room's cell

// What typing groupIds into room R's cell for a period does. The groups named
// are put in R; a named group's own label stays; a named group whose slot
// named teachers, none of them based in R, loses them (R's teachers take it).
// The groups that were in R and are not named lose their room. A room that is
// not shared that gets two groups keeps both: a double-booking is a finding,
// never a refusal (spec 5.7).
export function roomCellEdit(project, edit, options) {
  const { roomId, dayTypeId, period } = edit;
  const bellsId = options && options.bellsId ? options.bellsId : null;
  const sentence = cellRefusal(project, dayTypeId, period);
  if (sentence) return refusal(sentence);
  const room = findRoom(project, roomId);
  if (!room) return refusal('That room is no longer in the building. Pick another room.');
  const named = unique(edit.groupIds);
  for (const groupId of named) {
    const why = meetingRefusal(project, groupId, dayTypeId, period, bellsId);
    if (why) return refusal(why);
  }
  const out = { slots: [], moved: [], cleared: [], taken: [], refused: null };
  const inRoom = [];
  for (const group of project.groups) {
    const slot = meetingSlots(project, group.id, dayTypeId, bellsId)[period];
    const there = resolveSlotRoom(project, slot).room;
    if (there && there.id === roomId) inRoom.push(group.id);
  }
  for (const groupId of named) {
    if (inRoom.includes(groupId)) continue;
    const slot = slotOf(project, groupId, dayTypeId, period);
    const fields = { room: roomId, roomText: '' };
    const from = resolveSlotRoom(project, slot);
    const dropped = [];
    if (slot.teacherIds.length > 0 && !slot.teacherIds.some((id) => room.teacherIds.includes(id))) {
      fields.teacherIds = [];
      dropped.push(...slot.teacherIds);
    }
    out.slots.push({ groupId, dayTypeId, period, fields });
    out.moved.push({ groupId, fromRoomId: from.room ? from.room.id : null, fromText: from.room ? '' : from.text, droppedTeacherIds: dropped });
  }
  for (const groupId of inRoom) {
    if (named.includes(groupId)) continue;
    out.slots.push({ groupId, dayTypeId, period, fields: { room: null, roomText: '' } });
    out.cleared.push(groupId);
  }
  return out;
}

// ---------------------------------------------------------------- a teacher's cell

// The room a teacher's new group goes in when the edit names none, in order:
// the room the teacher already uses that period for another group, else the
// teacher's only room, else the first of their rooms. Null when they have no
// room at all.
function defaultRoom(project, teacherId, using, mine) {
  for (const taught of using) if (taught.roomId !== null && findRoom(project, taught.roomId)) return taught.roomId;
  return mine.length > 0 ? mine[0] : null;
}

// What typing groupIds into teacher T's cell for a period does. Each group
// added gets the room (edit.roomId; by default the room T already uses that
// period, else T's only room, else the first of T's rooms) and names T: with
// `teacherIds: []` when that room's teachers are exactly T (the room's
// teachers count for it anyway), else `[T]`. A group already in that room
// that names other teachers keeps them and gains T (co-teaching); one that
// names nobody, so counts for the room's teachers, keeps them too. A group
// taken out of the cell: when its slot names several teachers, T is taken
// out of them; when it names T alone, or counts for T through the room, the
// slot is cleared (`room: null`) and `cleared` says so. Another teacher's
// own slot is never changed.
export function teacherCellEdit(project, edit, options) {
  const { teacherId, dayTypeId, period } = edit;
  const bellsId = options && options.bellsId ? options.bellsId : null;
  const sentence = cellRefusal(project, dayTypeId, period);
  if (sentence) return refusal(sentence);
  const teacher = project.teachers.find((each) => each.id === teacherId);
  if (!teacher) return refusal('That teacher is no longer in the project.');
  const named = unique(edit.groupIds);
  const day = teacherDays(project, dayTypeId, { bellsId }).get(teacherId)[period];
  const now = day.groups.map((taught) => taught.groupId);
  const added = named.filter((groupId) => !now.includes(groupId));
  for (const groupId of added) {
    const why = meetingRefusal(project, groupId, dayTypeId, period, bellsId);
    if (why) return refusal(why);
  }
  const mine = allRooms(project).filter((room) => room.teacherIds.includes(teacherId)).map((room) => room.id);
  let target = null;
  if (added.length > 0) {
    if (edit.roomId !== undefined && edit.roomId !== null) {
      target = findRoom(project, edit.roomId) ? edit.roomId : null;
      if (target === null) return refusal('That room is no longer in the building. Pick another room.');
    } else {
      // the groups that stay in the cell are what "already uses that period" means
      target = defaultRoom(project, teacherId, day.groups.filter((taught) => named.includes(taught.groupId)), mine);
      if (target === null) return refusal(teacher.name + ' has no room. Add one for ' + teacher.name + ' in Teachers, or type the class into the Rooms rows.');
    }
  }
  const out = { slots: [], moved: [], cleared: [], taken: [], refused: null };
  for (const groupId of added) {
    const slot = slotOf(project, groupId, dayTypeId, period);
    const room = findRoom(project, target);
    const from = resolveSlotRoom(project, slot);
    const inTarget = slot.room === target;
    let teacherIds;
    let dropped = [];
    if (inTarget) {
      // already in that room: the teachers it has stay, and this one is added
      const have = slot.teacherIds.length > 0 ? slot.teacherIds : room.teacherIds;
      teacherIds = have.includes(teacherId) ? slot.teacherIds : have.concat(teacherId);
    } else {
      teacherIds = sameList(room.teacherIds, [teacherId]) ? [] : [teacherId];
      dropped = slot.teacherIds.filter((id) => id !== teacherId);
    }
    const fields = { room: target, roomText: '' };
    if (!sameList(teacherIds, slot.teacherIds)) fields.teacherIds = teacherIds;
    out.slots.push({ groupId, dayTypeId, period, fields });
    out.taken.push({ groupId, roomId: target });
    if (!inTarget) out.moved.push({ groupId, fromRoomId: from.room ? from.room.id : null, fromText: from.room ? '' : from.text, droppedTeacherIds: dropped });
  }
  for (const groupId of now) {
    if (named.includes(groupId)) continue;
    const slot = slotOf(project, groupId, dayTypeId, period);
    if (slot.teacherIds.length > 1 && slot.teacherIds.includes(teacherId)) {
      out.slots.push({ groupId, dayTypeId, period, fields: { teacherIds: slot.teacherIds.filter((id) => id !== teacherId) } });
      continue;
    }
    out.slots.push({ groupId, dayTypeId, period, fields: { room: null, roomText: '', teacherIds: [] } });
    out.cleared.push(groupId);
  }
  return out;
}

// ---------------------------------------------------------------- a block of cells

// The project with slot fields laid on, as setSlot lays them: a room named
// clears the kept room text unless the fields give one.
function laid(project, slots) {
  const touched = new Map();
  for (const { groupId, dayTypeId, period, fields } of slots) {
    const group = touched.get(groupId) || groupOf(project, groupId);
    const day = group.days[dayTypeId].slice();
    const slot = { ...day[period], ...fields };
    if (fields.room !== undefined && fields.roomText === undefined) slot.roomText = '';
    day[period] = slot;
    touched.set(groupId, { ...group, days: { ...group.days, [dayTypeId]: day } });
  }
  if (touched.size === 0) return project;
  return { ...project, groups: project.groups.map((group) => touched.get(group.id) || group) };
}

// Several cells, each worked out against the project the cells before it
// left, in the order given (reading order: row by row, left to right). A cell
// is { kind: 'room', roomId, ... } or { kind: 'teacher', teacherId, roomId?, ... },
// each with dayTypeId, period, and either `groupIds` or `text` (names, as
// groupsInText reads them). Returns the cells' edits together: { slots, moved,
// cleared, taken, refused, project, payload }. `slots` has one entry for each
// slot touched, its fields being what every cell that touched it left; `moved`
// is each group once, from where it began; `cleared` the groups that end
// with no room that began with one; `project` the schedule after every
// cell; `payload` `{ slots }` as applyGridEdits takes it, so the block is one
// history entry.
//
// The block is refused whole when any cell is, and when it puts one group in
// two rooms in one period (two Rooms cells naming it, or two Teachers cells
// that give it different rooms): "7-1 is in two rooms in Period 2 in what you
// pasted: 204 and 112." Two Teachers cells that name one group in one room
// are co-teaching, and kept.
export function acrossBlock(project, cells, options) {
  let working = project;
  const where = new Map();
  const finals = new Map();
  const began = new Map();
  const taken = [];
  for (const cell of cells) {
    let groupIds = cell.groupIds;
    if (!Array.isArray(groupIds)) {
      const read = groupsInText(working, cell.text);
      if (read.refused) return { ...refusal(read.refused), project, payload: { slots: [] } };
      groupIds = read.groupIds;
    }
    const edit = { ...cell, groupIds };
    const result = cell.kind === 'teacher' ? teacherCellEdit(working, edit, options) : roomCellEdit(working, edit, options);
    if (result.refused) return { ...refusal(result.refused), project, payload: { slots: [] } };
    // which room each group is given in each period, by this block's cells
    const given = cell.kind === 'teacher' ? result.taken : groupIds.map((groupId) => ({ groupId, roomId: cell.roomId }));
    for (const { groupId, roomId } of given) {
      const key = groupId + '|' + cell.dayTypeId + '|' + cell.period;
      if (where.has(key) && where.get(key) !== roomId) {
        const group = groupOf(project, groupId);
        const names = [where.get(key), roomId].map((id) => numberOf(findRoom(project, id)));
        return { ...refusal(group.name + ' is in two rooms in ' + periodName(project.settings, cell.period) + ' in what you pasted: ' + names[0] + ' and ' + names[1] + '.'), project, payload: { slots: [] } };
      }
      where.set(key, roomId);
    }
    for (const slot of result.slots) {
      const key = slot.groupId + '|' + slot.dayTypeId + '|' + slot.period;
      if (!began.has(key)) began.set(key, slotOf(working, slot.groupId, slot.dayTypeId, slot.period));
      finals.set(key, { ...slot, fields: { ...(finals.has(key) ? finals.get(key).fields : {}), ...slot.fields } });
    }
    taken.push(...result.taken);
    working = laid(working, result.slots);
  }
  const slots = Array.from(finals.values());
  const cleared = [];
  const moved = [];
  for (const key of finals.keys()) {
    const [groupId, dayTypeId, periodText] = key.split('|');
    const start = began.get(key);
    const end = slotOf(working, groupId, dayTypeId, Number(periodText));
    if (end.room === null && end.roomText === '' && (start.room !== null || start.roomText !== '')) cleared.push(groupId);
    if (end.room === null || end.room === start.room) continue;
    const from = resolveSlotRoom(project, start);
    moved.push({ groupId, fromRoomId: from.room ? from.room.id : null, fromText: from.room ? '' : from.text, droppedTeacherIds: start.teacherIds.filter((id) => !end.teacherIds.includes(id)) });
  }
  return { slots, moved, cleared, taken, refused: null, project: working, payload: { slots: slots.map(({ groupId, dayTypeId, period, fields }) => ({ groupId, dayTypeId, period, slot: fields })) } };
}
