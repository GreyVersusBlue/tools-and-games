// The grid as rows, columns and cells of text, worked out from the schedule as
// it stands and the schedule as it would be once the staged edits are applied.
// Nothing here touches the page. Typing, pasting, filling down and clearing
// all go through readCell, so a room number, a head count or a name is read
// one way whichever of them brought it.

import { ownDayTypes } from '../../../engine/day-types.js';
import { periodName } from '../../../engine/bells.js';
import { allRooms, resolveSlotRoom, roomNumberKey, nameKey, isHexColour, emptySlot, nextGroupColour, RANGES } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { checkSchedule } from '../../../engine/checks.js';
import { slotKeyOf } from './staged.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const FIELD_COLUMNS = [
  { id: 'name', kind: 'field', field: 'name', label: 'Group' },
  { id: 'grade', kind: 'field', field: 'grade', label: 'Grade' },
  { id: 'headCount', kind: 'field', field: 'headCount', label: 'Head count' },
  { id: 'colour', kind: 'field', field: 'colour', label: 'Colour' },
];

export function gradeLabel(grade) {
  return grade.trim() === '' ? 'No grade' : 'Grade ' + grade;
}

// sheetModel(project, after, draft)
//   project  the schedule as it stands
//   after    the schedule with the staged edits applied (staged.js preview)
// returns {
//   project, after,
//   columns   the four fields, one column per period of each day type that is
//             its own copy, and the column of row buttons
//   days      [{ dayType, first, count }] for the header over the periods
//   sections  [{ grade, label, rows }], grades in order, "No grade" last
//   rows      every row in the order shown: { id, group, original, removed, added }
//   rooms     room number, as compared, to room
//   findings  "group|dayType|period" to the findings on that slot
// }
export function sheetModel(project, after, draft) {
  const columns = FIELD_COLUMNS.slice();
  const days = [];
  for (const dayType of ownDayTypes(after)) {
    days.push({ dayType, first: columns.length, count: after.settings.periods });
    for (let period = 0; period < after.settings.periods; period += 1) {
      columns.push({ id: dayType.id + ':' + period, kind: 'slot', dayTypeId: dayType.id, period, label: dayType.name + ', ' + periodName(after.settings, period), short: periodName(after.settings, period) });
    }
  }
  columns.push({ id: 'do', kind: 'actions', label: 'Remove' });

  const now = new Map(after.groups.map((group) => [group.id, group]));
  const was = new Map(project.groups.map((group) => [group.id, group]));
  const listed = [];
  for (const group of project.groups) {
    if (now.has(group.id)) listed.push({ id: group.id, group: now.get(group.id), original: group, removed: false, added: false });
    else listed.push({ id: group.id, group, original: group, removed: true, added: false });
  }
  for (const group of after.groups) {
    if (!was.has(group.id)) listed.push({ id: group.id, group, original: null, removed: false, added: true });
  }

  const byGrade = new Map();
  for (const row of listed) {
    const key = nameKey(row.group.grade);
    if (!byGrade.has(key)) byGrade.set(key, { grade: row.group.grade.trim(), label: gradeLabel(row.group.grade), rows: [] });
    byGrade.get(key).rows.push(row);
  }
  const sections = Array.from(byGrade.values()).sort((a, b) => (a.grade === '') - (b.grade === '') || collator.compare(a.grade, b.grade));
  const rows = sections.flatMap((section) => section.rows);

  const rooms = new Map();
  for (const room of allRooms(after)) {
    const key = roomNumberKey(room.number);
    if (key !== '' && !rooms.has(key)) rooms.set(key, room);
  }

  const findings = new Map();
  for (const finding of checkSchedule(after, null).findings) {
    const where = finding.where;
    if (where.dayTypeId === null || where.period === null) continue;
    for (const groupId of where.groupIds) {
      const key = slotKeyOf(groupId, where.dayTypeId, where.period);
      if (!findings.has(key)) findings.set(key, []);
      findings.get(key).push(finding);
    }
  }

  return { project, after, draft, columns, days, sections, rows, rooms, findings };
}

function slotOf(row, column) {
  const day = row.group.days[column.dayTypeId];
  return (day && day[column.period]) || emptySlot();
}

// What a cell shows: { text, unknown, staged, findings }. `unknown` is a room
// that is not in the building, shown as it was typed. `staged` is a cell the
// edits waiting to be applied would change.
export function cellState(model, row, column) {
  if (column.kind === 'actions') return { text: '', unknown: false, staged: false, findings: [] };
  if (column.kind === 'field') {
    const value = row.group[column.field];
    const staged = !row.removed && (row.added || row.original[column.field] !== value);
    return { text: value === null ? '' : String(value), unknown: false, staged, findings: [] };
  }
  const slot = slotOf(row, column);
  const resolved = resolveSlotRoom(model.after, slot);
  const text = resolved.room ? (resolved.room.number.trim() === '' ? roomName(resolved.room) : resolved.room.number) : resolved.text;
  const key = slotKeyOf(row.id, column.dayTypeId, column.period);
  const before = row.original && row.original.days[column.dayTypeId] ? row.original.days[column.dayTypeId][column.period] : null;
  const staged = !row.removed && (row.added ? model.draft.slots.has(key) : before !== slot);
  return { text, unknown: resolved.missing, staged, findings: row.removed ? [] : model.findings.get(key) || [] };
}

export function cellText(model, row, column) {
  return cellState(model, row, column).text;
}

// The names in use, by group id, for telling whether a typed name is free.
export function namesOf(model) {
  return new Map(model.rows.filter((row) => !row.removed).map((row) => [row.id, row.group.name]));
}

// Text typed or pasted into a cell, read as what the cell holds:
//   { ok: true, op }      op is { op: 'field', groupId, field, value } or
//                         { op: 'slot', groupId, dayTypeId, period, fields }
//   { ok: false, why }    a sentence saying what was wrong and what to type
// `names` is namesOf(model), kept up to date by the caller when one paste
// names several groups.
export function readCell(model, row, column, typed, names) {
  const text = String(typed).replace(/\s+/g, ' ');
  if (column.kind === 'actions') return { ok: false, why: 'That column holds a button, not text.' };
  if (row.removed) return { ok: false, why: row.group.name + ' is marked to be removed. Put it back to change it.' };
  if (column.kind === 'slot') {
    const wanted = text.trim();
    const room = wanted === '' ? null : model.rooms.get(roomNumberKey(wanted)) || null;
    return { ok: true, op: { op: 'slot', groupId: row.id, dayTypeId: column.dayTypeId, period: column.period, fields: { room: room ? room.id : null, roomText: room ? '' : wanted } } };
  }
  const field = (value) => ({ ok: true, op: { op: 'field', groupId: row.id, field: column.field, value } });
  if (column.field === 'name') {
    if (text.trim() === '') return { ok: false, why: 'A group needs a name. Type one.' };
    const taken = Array.from(names || namesOf(model)).find(([id, name]) => id !== row.id && nameKey(name) === nameKey(text));
    if (taken) return { ok: false, why: 'There is already a group called "' + taken[1] + '". Group names are unique, whatever the capitals; type a different name.' };
    return field(text);
  }
  if (column.field === 'grade') return field(text.trim());
  if (column.field === 'headCount') {
    const wanted = text.trim();
    if (wanted === '') return field(null);
    const n = /^\d+$/.test(wanted) ? Number(wanted) : NaN;
    if (!(n >= RANGES.headCount[0] && n <= RANGES.headCount[1])) return { ok: false, why: 'A head count is a whole number from ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + ', or empty to use the school default.' };
    return field(n);
  }
  const colour = text.trim().toLowerCase();
  if (!isHexColour(colour)) return { ok: false, why: 'A colour is written #rrggbb, for example #2a6f97.' };
  return field(colour);
}

function freeName(names, base) {
  const taken = new Set(Array.from(names.values(), nameKey));
  if (!taken.has(nameKey(base))) return base;
  let n = 2;
  while (taken.has(nameKey(base + ' ' + n))) n += 1;
  return base + ' ' + n;
}

// A group that is not in the schedule yet, ready to be staged.
export function newGroup(model, ids, names, colours, grade) {
  const group = { id: ids('g'), name: freeName(names, 'New group'), grade: grade || '', headCount: null, colour: nextGroupColour(colours) };
  names.set(group.id, group.name);
  colours.push(group);
  return group;
}

// A block of cells pasted with its top left corner on a cell.
// planPaste(model, r, c, block, ids)
//   r, c    the row and column of that corner (indexes into rows and columns)
//   block   rows of cells of text (tsv.js)
// returns { ops, cells, added, refused, clipped }
//   ops      what to stage, in order: { op: 'add', group }, then fields and slots
//   cells    how many cells were taken
//   added    how many groups the paste adds: rows that run past the last
//            group become new groups, in the last grade on the sheet
//   refused  a sentence for each cell that was not taken
//   clipped  how many columns of the block ran past the last column
export function planPaste(model, r, c, block, ids) {
  const names = namesOf(model);
  const colours = model.rows.filter((row) => !row.removed).map((row) => row.group);
  const last = model.rows[model.rows.length - 1];
  const plan = { ops: [], cells: 0, added: 0, refused: [], clipped: 0 };
  const width = Math.max(0, ...block.map((cells) => cells.length));
  const room = model.columns.length - 1 - c;
  plan.clipped = Math.max(0, width - room);
  block.forEach((cells, dr) => {
    let row = model.rows[r + dr];
    if (!row) {
      if (cells.every((cell) => cell.trim() === '')) return;
      const group = newGroup(model, ids, names, colours, last ? last.group.grade : '');
      plan.ops.push({ op: 'add', group });
      plan.added += 1;
      row = { id: group.id, group, original: null, removed: false, added: true };
    }
    cells.forEach((cell, dc) => {
      const column = model.columns[c + dc];
      if (!column || column.kind === 'actions') return;
      // an empty cell over a new group's name leaves the name it was given
      if (row.added && column.field === 'name' && cell.trim() === '' && !model.rows.includes(row)) return;
      // an empty cell over a colour leaves the colour: a group always has one
      if (column.field === 'colour' && cell.trim() === '') return;
      const read = readCell(model, row, column, cell, names);
      if (!read.ok) {
        plan.refused.push(read.why);
        return;
      }
      if (read.op.field === 'name') names.set(row.id, read.op.value);
      plan.ops.push(read.op);
      plan.cells += 1;
    });
  });
  return plan;
}
