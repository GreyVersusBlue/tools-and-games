// The Grid's Teachers and Rooms rows as a model the sheet can draw and edit
// (ARCHITECTURE 23.8, 23.12; DESIGN 17.5 to 17.7), and the sentences that say
// what an edit did. The rules that turn an edited slot into the groups' own
// slot fields are engine/grid-across.js's; this file only asks them and words
// the answer. Nothing here touches the page.
//
// A slot of these rows is a group name, or several; a teacher's also says in
// which room. What is typed is group names (`groupsInText` reads them).
//
//   acrossModel(kind, project, after, findings, dayTypeIds, pending)
//   cellState(model, row, column)      what a slot shows
//   cellText(model, row, column)       what it is edited as: its group names
//   acrossOptions(model, row, column, typed)   the picker's list
//   teacherRooms(project, teacherId)   a teacher's rooms, for the In field
//   defaultRoom(model, row, column)    the room In starts at
//   cellsOf(model, r, c, block)        a pasted block as cells to edit
//   wordsFor(project, block, cells)    the sentence for an edit: segments
//   plain(segments)                    the same as text

import { ownDayTypes, effectiveDayType, isOwnCopy } from '../../../engine/day-types.js';
import { periodName } from '../../../engine/bells.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { acrossBlock, groupsInText } from '../../../engine/grid-across.js';
import { teacherRows, roomRows } from './readonly.js';

export const KINDS = { teachers: 'teacher', rooms: 'room' };

// ---------------------------------------------------------------- the model

// kind     'teachers' or 'rooms'
// project  the schedule as it stands; after: with the staged edits applied
// findings the Groups model's: slot key to findings
// dayTypeIds  the day types shown, a follower's included; all when left out
// pending  does the draft hold anything (then staged slots are told apart)
// returns { role, kind, project, after, columns, days, sections, rows, findings, state }
export function acrossModel(kind, project, after, findings, dayTypeIds, pending) {
  const built = kind === 'teachers' ? teacherRows(after, findings, dayTypeIds) : roomRows(after, findings, dayTypeIds);
  const before = pending ? new Map((kind === 'teachers' ? teacherRows(project, null, dayTypeIds) : roomRows(project, null, dayTypeIds)).rows.map((row) => [row.id, row])) : null;
  const asked = Array.isArray(dayTypeIds) ? new Set(dayTypeIds) : null;
  const shown = after.dayTypes.filter((dayType) => !asked || asked.has(dayType.id));
  const columns = [{ id: 'name', kind: 'name', label: built.first }];
  const days = [];
  for (const dayType of shown) {
    const effective = effectiveDayType(after, dayType.id);
    const follows = isOwnCopy(after, dayType.id) ? null : effective;
    days.push({ dayType, first: columns.length, count: after.settings.periods + built.extras.length, follows });
    for (let period = 0; period < after.settings.periods; period += 1) {
      columns.push({ id: dayType.id + ':' + period, kind: 'slot', dayTypeId: dayType.id, period, label: periodName(after.settings, period) + ', ' + dayType.name, short: periodName(after.settings, period), follows });
    }
    for (const extra of built.extras) columns.push({ id: dayType.id + ':' + extra.id, kind: 'extra', dayTypeId: dayType.id, which: extra.id, label: extra.label + ', ' + dayType.name, short: extra.label, follows });
  }
  const model = { role: kind, kind: KINDS[kind], project, after, columns, days, sections: [{ label: null, rows: built.rows }], rows: built.rows, findings, first: built.first, free: built.free, state: null };
  const seen = new Map();
  model.state = (row, column) => {
    const key = row.id + '|' + column.id;
    if (seen.has(key)) return seen.get(key);
    let state;
    if (column.kind === 'name') {
      state = { text: row.name, findings: [], duty: false, groupIds: [], groupNames: [], taught: [], staged: false, follower: false };
    } else if (column.kind === 'extra') {
      state = { text: row.extra(column.dayTypeId, column.which), findings: [], duty: true, groupIds: [], groupNames: [], taught: [], staged: false, follower: Boolean(column.follows) };
    } else {
      const cell = row.cell(column.dayTypeId, column.period);
      let staged = false;
      if (before && !column.follows) {
        const was = before.get(row.id);
        const there = was ? was.cell(column.dayTypeId, column.period) : null;
        staged = Boolean(there) && (there.text !== cell.text || there.groupIds.join('|') !== cell.groupIds.join('|'));
      }
      state = { ...cell, staged, follower: Boolean(column.follows) };
    }
    seen.set(key, state);
    return state;
  };
  return model;
}

export function cellState(model, row, column) {
  return model.state(row, column);
}

// What a slot is edited as, and what a copy of it holds: its group names.
export function cellText(model, row, column) {
  return column.kind === 'slot' ? model.state(row, column).groupNames.join(', ') : '';
}

// ---------------------------------------------------------------- what to pick from

function roomWords(project, slot) {
  const found = resolveSlotRoom(project, slot);
  if (found.room) return found.room.number.trim() === '' ? roomName(found.room) : found.room.number;
  return found.text;
}

// The picker's list under a slot being edited: every group, by name and
// grade, with where each is now in that period ("7-1 · now in 204"), narrowed
// by what has been typed since the last comma or semicolon. A group's own name
// may hold a comma, so when the whole text so far matches a name that is what
// narrows it. Returns { options: [{ group, label }], from } where `from` is
// where in the typed text the piece being completed begins.
export function acrossOptions(model, row, column, typed, limit) {
  const text = String(typed);
  const groups = model.after.groups;
  const label = (group) => {
    const day = group.days[column.dayTypeId];
    const slot = day ? day[column.period] : null;
    const where = slot ? roomWords(model.after, slot) : '';
    return group.name + (group.grade.trim() === '' ? '' : ' · grade ' + group.grade.trim()) + ' · ' + (where === '' ? 'now has no room' : 'now in ' + where);
  };
  const narrow = (from) => {
    const wanted = text.slice(from).trim().toLowerCase();
    return groups.filter((group) => wanted === '' || group.name.toLowerCase().includes(wanted) || group.grade.trim().toLowerCase() === wanted);
  };
  const edge = Math.max(text.lastIndexOf(','), text.lastIndexOf(';')) + 1;
  let from = edge;
  let found = narrow(from);
  if (edge > 0 && found.length === 0 && narrow(0).length > 0) {
    from = 0;
    found = narrow(0);
  }
  return { options: found.slice(0, limit || 60).map((group) => ({ group, label: label(group) })), from };
}

// Does what was typed name something that is not a group (or name one twice)?
export function namesUnknown(model, text) {
  return Boolean(groupsInText(model.after, text).refused);
}

// A teacher's rooms, in the order the building lists them.
export function teacherRooms(project, teacherId) {
  return allRooms(project).filter((room) => room.teacherIds.includes(teacherId)).map((room) => ({ id: room.id, number: room.number.trim() === '' ? roomName(room) : room.number }));
}

// The room a group added to a teacher's slot goes in when the edit names none
// (the rule of engine/grid-across.js, restated here to start the In field at
// it): the room the teacher already uses that period for another group, else
// the first of the teacher's rooms; null when there is none.
export function defaultRoom(model, row, column) {
  const taught = model.state(row, column).taught;
  for (const each of taught) if (each.roomId !== null && findRoom(model.after, each.roomId)) return each.roomId;
  const mine = teacherRooms(model.after, row.id);
  return mine.length > 0 ? mine[0].id : null;
}

// ---------------------------------------------------------------- cells to edit

// One slot's edit as engine/grid-across.js takes it. `roomId` on a teacher's
// is the In field's, when there was one.
export function cellRequest(model, row, column, text, roomId) {
  const base = { kind: model.kind, dayTypeId: column.dayTypeId, period: column.period, text };
  return model.kind === 'teacher' ? { ...base, teacherId: row.id, ...(roomId ? { roomId } : {}) } : { ...base, roomId: row.id };
}

// A block of text laid on the slots with its corner at row r, column c: the
// slots that are slots (the name and the duties are not edited here), in
// reading order. { cells, skipped, runOff } where `skipped` counts the places
// the block fell on a column that is not a slot and `runOff` the rows and
// columns past the table's end that were left out.
export function cellsOf(model, r, c, block) {
  const cells = [];
  let skipped = 0;
  let runOff = 0;
  block.forEach((texts, dr) => {
    const row = model.rows[r + dr];
    texts.forEach((text, dc) => {
      const column = model.columns[c + dc];
      if (!row || !column) {
        runOff += 1;
        return;
      }
      if (column.kind !== 'slot') {
        skipped += 1;
        return;
      }
      cells.push(cellRequest(model, row, column, text));
    });
  });
  return { cells, skipped, runOff };
}

// Work an edit out against the schedule as the staged edits leave it.
export function runAcross(project, cells) {
  return acrossBlock(project, cells, {});
}

// ---------------------------------------------------------------- the sentences

// A sentence is a list of segments: plain strings, and { name } for anything
// the user typed (a group, a teacher, a room, a day type), which the page
// draws as it was typed and never as markup.
const named = (text) => ({ name: text });

export function plain(segments) {
  return segments.map((part) => (typeof part === 'string' ? part : part.name)).join('');
}

function inPeriod(project, dayTypeId, period) {
  const many = ownDayTypes(project).length > 1;
  const day = project.dayTypes.find((dayType) => dayType.id === dayTypeId);
  return [' in ', named(periodName(project.settings, period)), ...(many && day ? [' on ', named(day.name)] : [])];
}

// What an edit did, in words: a loss first (DESIGN 17.7 item 1), then what
// moved. `project` is the schedule before the edit and `block` what
// runAcross returned for `cells`. A single teacher's slot says what the
// teacher took, and what leaving it cost the groups taken out. Several
// sentences past `limit` end "and 3 more." A refusal, or an edit that
// changed nothing, has no sentence here (null).
export function wordsFor(project, block, cells, limit) {
  if (block.refused || block.slots.length === 0) return null;
  const only = cells.length === 1 ? cells[0] : null;
  const teacher = only && only.kind === 'teacher' ? project.teachers.find((each) => each.id === only.teacherId) : null;
  const lost = [];
  const moved = [];
  const groupOf = (id) => project.groups.find((group) => group.id === id);
  for (const slot of block.slots) {
    const group = groupOf(slot.groupId);
    const was = roomWords(project, group.days[slot.dayTypeId][slot.period]);
    const after = block.project.groups.find((each) => each.id === slot.groupId);
    const now = roomWords(block.project, after.days[slot.dayTypeId][slot.period]);
    const when = inPeriod(project, slot.dayTypeId, slot.period);
    const takes = Boolean(teacher) && block.taken.some((each) => each.groupId === slot.groupId);
    if (now === was && !takes) continue;
    if (now === '') {
      if (teacher) lost.push([named(group.name), ' has no room', ...when, ' now (it was in ', named(was), ' with ', named(teacher.name), ').']);
      else lost.push([named(group.name), ' now has no room', ...when, ' (was ', named(was), ').']);
    } else if (takes) {
      moved.push([named(teacher.name), ' takes ', named(group.name), ...when, ', in ', named(now), ...(was === '' || was === now ? ['.'] : [' (it was in ', named(was), ').'])]);
    } else if (was === '') {
      moved.push([named(group.name), ' goes into ', named(now), ...when, ' (it had no room).']);
    } else {
      moved.push([named(group.name), ' moves from ', named(was), ' to ', named(now), ...when, '.']);
    }
  }
  const all = lost.concat(moved);
  if (all.length === 0) return null;
  const cap = limit || 3;
  const shown = all.slice(0, cap);
  const out = [];
  shown.forEach((sentence, index) => out.push(...(index === 0 ? [] : [' ']), ...sentence));
  if (all.length > cap) out.push(' And ' + (all.length - cap) + ' more.');
  return out;
}
