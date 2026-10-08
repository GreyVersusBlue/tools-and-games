// Importing groups from a CSV file: guessing what each column is, letting the
// user correct that, showing what would happen, and doing it. FORMATS.md
// ("The groups CSV") has the layout from the user's side.
//
// The steps, each a pure function:
//
//   guessColumns(header, project)          → mapping, one entry per column
//   checkMapping(project, mapping)         → sentences; empty means usable
//   previewImport(project, rows, mapping)  → what each row would do
//   applyGroupImport(project, rows, mapping, policy, ids) → { project, summary }
//
// `rows` is what csv.js `parse` returned, the header row first. A mapping
// entry is { column, header, role, period, dayTypeId, note }: `role` is one
// of ROLES; `period` (from 0) is set for a period column; `dayTypeId` is set
// when the column belongs to one day type whatever the row says. The page
// shows the mapping, lets the user change any entry, and passes it back.
//
// A column the guess does not understand is `ignore`. It is never taken for
// a period.
//
// Three layouts carry more than one day type:
// - wide: the period columns once per day type ("A Day Period 1" … "B Day
//   Period 1" …), or the same period headers repeated, the second run being
//   the second day type;
// - a day column: one row per group per day type, the day type named in a
//   column;
// - blocks: a row holding nothing but a day type's name starts that day
//   type's rows, and a repeat of the header row is passed over.
//
// A cell in a period column is a room number. It is matched to the building
// without regard to capitals or surrounding spaces; a number that is not in
// the building is kept as typed and the slot reads "not in the building".
// An empty cell is an empty period.
//
// mergeGroups is the part that changes the project. The schedule file's
// import (project-file.js) uses it too, so name clashes are handled by one
// rule: `policy` is { all, per, names }. `all` is 'skip', 'overwrite' or
// 'rename' for every clash; `per[key]` overrides it for one group, keyed by
// nameKey of the imported name; `names[key]` is the name to import under
// when the answer is 'rename' (otherwise " (2)", " (3)" is added).

import { RANGES, roomNumberKey, nameKey, inRange, emptySlot, emptyDay, allRooms, nextGroupColour } from './schema.js';
import { isId } from './ids.js';
import { periodName, periodLabel } from './bells.js';

export const ROLES = ['name', 'grade', 'headCount', 'colour', 'dayType', 'period', 'ignore'];
export const CLASH_POLICIES = ['skip', 'overwrite', 'rename'];

export class ImportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ImportError';
    this.code = code || 'refused';
  }
}

// ---------------------------------------------------------------- headers

const NAME_WORDS = ['group', 'group name', 'groups', 'name', 'section', 'class'];
const GRADE_WORDS = ['grade', 'grade level', 'year', 'year group'];
const HEAD_COUNT_WORDS = ['head count', 'headcount', 'students', 'number of students', 'size', 'enrollment', 'enrolment'];
const COLOUR_WORDS = ['colour', 'color'];
const DAY_TYPE_WORDS = ['day type', 'daytype', 'day'];

function headerKey(text) {
  return String(text).trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

function letterIndex(letters) {
  return letters.length === 1 ? letters.charCodeAt(0) - 97 : -1;
}

// "period 3", "per. 3", "p3", "mod 3", "block c", "3rd hour", "hour 3", "3":
// the period's index from 0, or -1 when the text is not a period header. A
// bare letter is a period only in a school that letters its periods.
function periodIndex(text, settings) {
  for (let index = 0; index < RANGES.periods[1]; index += 1) {
    if (text === periodName(settings, index).toLowerCase()) return index;
  }
  let match = text.match(/^(?:period|per|pd|p|mod|hour|hr|block|blk)\.? ?(\d{1,2})(?:st|nd|rd|th)?$/);
  if (!match) match = text.match(/^(\d{1,2})(?:st|nd|rd|th)? ?(?:period|mod|hour|block)?$/);
  if (match) {
    const number = Number(match[1]);
    return number >= 1 ? number - 1 : -1;
  }
  match = text.match(/^(?:block|blk) ?([a-z])$/);
  if (match) return letterIndex(match[1]);
  if (settings.periodWord === 'Block' && /^[a-z]$/.test(text)) return letterIndex(text);
  return -1;
}

// A period header may name its day type: "A Day Period 1", "Period 1 B Day",
// "Period 1 (B Day)", "B Day: Period 1". Returns { dayTypeId, rest }.
function splitDayType(text, project) {
  const dayTypes = project.dayTypes.slice().sort((a, b) => b.name.length - a.name.length);
  for (const dayType of dayTypes) {
    const name = headerKey(dayType.name);
    if (name === '') continue;
    if (text.startsWith(name) && /^[\s:,-]/.test(text.slice(name.length))) return { dayTypeId: dayType.id, rest: text.slice(name.length).replace(/^[\s:,-]+/, '') };
    if (text.endsWith(name) && /[\s:,-]$/.test(text.slice(0, -name.length))) return { dayTypeId: dayType.id, rest: text.slice(0, -name.length).replace(/[\s:,-]+$/, '') };
    if (text.endsWith('(' + name + ')')) return { dayTypeId: dayType.id, rest: text.slice(0, -name.length - 2).trim() };
  }
  return { dayTypeId: null, rest: text };
}

function entry(column, header, role, period, dayTypeId, note) {
  return { column, header, role, period: period === undefined ? null : period, dayTypeId: dayTypeId === undefined ? null : dayTypeId, note: note || '' };
}

// The first guess at what each column is. `header` is the file's first row.
export function guessColumns(header, project) {
  const settings = project.settings;
  const cells = Array.isArray(header) ? header : [];
  const taken = new Set();
  const once = (column, text, role) => {
    if (taken.has(role)) return entry(column, text, 'ignore', null, null, 'Another column is already the ' + roleWords(role) + '.');
    taken.add(role);
    return entry(column, text, role);
  };

  const mapping = cells.map((cell, column) => {
    const text = String(cell);
    const key = headerKey(text);
    if (NAME_WORDS.includes(key)) return once(column, text, 'name');
    if (GRADE_WORDS.includes(key)) return once(column, text, 'grade');
    if (HEAD_COUNT_WORDS.includes(key)) return once(column, text, 'headCount');
    if (COLOUR_WORDS.includes(key)) return once(column, text, 'colour');
    if (DAY_TYPE_WORDS.includes(key)) return once(column, text, 'dayType');
    let split = { dayTypeId: null, rest: key };
    let period = periodIndex(key, settings);
    if (period === -1) {
      split = splitDayType(key, project);
      period = split.dayTypeId === null ? -1 : periodIndex(split.rest, settings);
    }
    if (period === -1) return entry(column, text, 'ignore');
    if (period >= settings.periods) return entry(column, text, 'ignore', null, null, 'The school day has ' + settings.periods + ' periods, so this column is past the end of it.');
    return entry(column, text, 'period', period, split.dayTypeId);
  });

  // Period columns that name no day type. With a day column each row says
  // which day type it is. Without one, the first run of period headers is the
  // first day type, a second run the second, and so on.
  const hasDayColumn = mapping.some((item) => item.role === 'dayType');
  const seen = new Map();
  for (const item of mapping) {
    if (item.role !== 'period') continue;
    const key = (item.dayTypeId || '') + ':' + item.period;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (item.dayTypeId !== null || hasDayColumn) {
      if (count > 0) Object.assign(item, { role: 'ignore', period: null, dayTypeId: null, note: 'An earlier column is already this period.' });
      continue;
    }
    if (count === 0) continue;
    const dayType = project.dayTypes[count];
    if (dayType) item.dayTypeId = dayType.id;
    else Object.assign(item, { role: 'ignore', period: null, note: 'There are more runs of period columns than day types.' });
  }
  // A repeated run means the first run is the first day type, said outright.
  const repeated = mapping.some((item) => item.role === 'period' && item.dayTypeId !== null);
  if (repeated && !hasDayColumn) {
    for (const item of mapping) if (item.role === 'period' && item.dayTypeId === null) item.dayTypeId = project.dayTypes[0].id;
  }
  return mapping;
}

function roleWords(role) {
  if (role === 'name') return 'group name';
  if (role === 'headCount') return 'head count';
  if (role === 'dayType') return 'day type';
  return role;
}

// What is wrong with a mapping, as sentences. Nothing is imported until this
// is empty.
export function checkMapping(project, mapping) {
  const problems = [];
  if (!Array.isArray(mapping)) return ['The column mapping is a list with one entry for each column.'];
  const count = (role) => mapping.filter((item) => item && item.role === role).length;
  if (count('name') === 0) problems.push('No column is set as the group name. Pick the column that holds each group\'s name.');
  for (const role of ['name', 'grade', 'headCount', 'colour', 'dayType']) {
    if (count(role) > 1) problems.push('Two columns are set as the ' + roleWords(role) + '. Set one of them to "ignore".');
  }
  const hasDayColumn = count('dayType') > 0;
  const seen = new Set();
  for (const item of mapping) {
    if (!item || !ROLES.includes(item.role)) {
      problems.push('A column has no role. Each column is one of: ' + ROLES.join(', ') + '.');
      continue;
    }
    if (item.role !== 'period') continue;
    const what = 'Column "' + item.header + '"';
    if (!Number.isInteger(item.period) || item.period < 0 || item.period >= project.settings.periods) {
      problems.push(what + ' is set as a period that is not in the school day. The day has ' + project.settings.periods + '.');
      continue;
    }
    if (item.dayTypeId !== null && !project.dayTypes.some((dayType) => dayType.id === item.dayTypeId)) {
      problems.push(what + ' is set to a day type that is not in the project.');
      continue;
    }
    const key = (item.dayTypeId === null ? '' : item.dayTypeId) + ':' + item.period;
    if (seen.has(key)) problems.push(what + ' is set as ' + periodName(project.settings, item.period) + ', and so is an earlier column' + (item.dayTypeId === null && !hasDayColumn ? '. Give one of them its day type.' : '.'));
    seen.add(key);
  }
  return problems;
}

// ---------------------------------------------------------------- cells

function isBlank(text) {
  return String(text === undefined || text === null ? '' : text).trim() === '';
}

// A head count cell: { value } or { warning }. An empty cell is no head count.
function readHeadCount(text) {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  if (/^\d+$/.test(trimmed) && inRange(Number(trimmed), RANGES.headCount)) return { value: Number(trimmed) };
  return { warning: 'The head count "' + text + '" is not a whole number from ' + RANGES.headCount[0] + ' to ' + RANGES.headCount[1] + ', so it was left out.' };
}

// A colour cell: "#2a6f97", "2A6F97" or "#26f".
function readColour(text) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return {};
  let match = trimmed.match(/^#?([0-9a-f]{6})$/);
  if (match) return { value: '#' + match[1] };
  match = trimmed.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (match) return { value: '#' + match[1] + match[1] + match[2] + match[2] + match[3] + match[3] };
  return { warning: 'The colour "' + text + '" is not written #rrggbb, so it was left out.' };
}

function roomLookup(project) {
  const byNumber = new Map();
  for (const room of allRooms(project)) {
    const key = roomNumberKey(room.number);
    if (key !== '' && !byNumber.has(key)) byNumber.set(key, room);
  }
  return byNumber;
}

function dayTypeByName(project, text) {
  const key = nameKey(text);
  return project.dayTypes.find((dayType) => nameKey(dayType.name) === key) || null;
}

function isOwn(project, dayTypeId) {
  const index = project.dayTypes.findIndex((dayType) => dayType.id === dayTypeId);
  return index === 0 || (index > 0 && project.dayTypes[index].own === true);
}

// ---------------------------------------------------------------- preview

// What importing these rows with this mapping would do, row by row, before
// anything changes. The result:
//
//   problems      what is wrong with the mapping; when not empty, nothing else is filled in
//   rows          [{ row, status, name, key, groupId, dayTypeId, reason, cells, warnings }]
//                 row counts from 1 in the file's rows (the header is 1);
//                 status is 'create', 'match' (a group of that name exists),
//                 'skip' (with `reason`) or 'heading'; cells are
//                 { column, dayTypeId, period, text, roomId, unknown }
//   groups        one per imported name, the rows merged: { key, name, existing,
//                 rows, fields, days } with days[dayTypeId][period] = { room, roomText }
//   unknownRooms  [{ text, count, rows }] room numbers that are not in the building
//   makesOwn      day types now "same as the first" that would become their own copy
//   counts        { create, match, skip, slots, unknownRooms }
export function previewImport(project, rows, mapping) {
  const result = { problems: checkMapping(project, mapping), rows: [], groups: [], unknownRooms: [], makesOwn: [], counts: { create: 0, match: 0, skip: 0, slots: 0, unknownRooms: 0 } };
  if (result.problems.length > 0) return result;
  if (!Array.isArray(rows) || rows.length === 0) {
    result.problems.push('The file has no rows. Choose a CSV file with a header row and one row for each group.');
    return result;
  }

  const column = (role) => {
    const item = mapping.find((candidate) => candidate.role === role);
    return item ? item.column : -1;
  };
  const nameColumn = column('name');
  const gradeColumn = column('grade');
  const headCountColumn = column('headCount');
  const colourColumn = column('colour');
  const dayColumn = column('dayType');
  const periodColumns = mapping.filter((item) => item.role === 'period');
  const cell = (row, index) => (index >= 0 && index < row.length ? String(row[index]) : '');

  const base = project.dayTypes[0];
  const byNumber = roomLookup(project);
  const existingByKey = new Map(project.groups.map((group) => [nameKey(group.name), group]));
  const groups = new Map();
  const unknown = new Map();
  const makesOwn = new Set();
  const header = rows[0];
  let blockDay = null;

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const filled = row.filter((value) => !isBlank(value));
    if (filled.length === 0) continue;
    const line = { row: r + 1, status: 'skip', name: cell(row, nameColumn), key: '', groupId: null, dayTypeId: null, reason: '', cells: [], warnings: [] };
    result.rows.push(line);

    if (row.length === header.length && row.every((value, i) => value === header[i])) {
      line.status = 'heading';
      line.reason = 'The header row again.';
      continue;
    }
    if (filled.length === 1) {
      const named = dayTypeByName(project, filled[0]);
      if (named) {
        blockDay = named.id;
        line.status = 'heading';
        line.dayTypeId = named.id;
        line.reason = 'The rows below are ' + named.name + '.';
        continue;
      }
    }
    if (isBlank(line.name)) {
      line.reason = 'This row has no group name.';
      continue;
    }
    line.key = nameKey(line.name);

    let rowDay = blockDay;
    if (dayColumn !== -1 && !isBlank(cell(row, dayColumn))) {
      const named = dayTypeByName(project, cell(row, dayColumn));
      if (!named) {
        line.reason = 'The day type "' + cell(row, dayColumn) + '" is not in this project. The day types are: ' + project.dayTypes.map((dayType) => dayType.name).join(', ') + '.';
        continue;
      }
      rowDay = named.id;
    }
    line.dayTypeId = rowDay;

    // the row's slots, by day type
    const days = new Map();
    for (const item of periodColumns) {
      const dayTypeId = item.dayTypeId || rowDay || base.id;
      const text = cell(row, item.column);
      const key = roomNumberKey(text);
      const room = key === '' ? null : byNumber.get(key) || null;
      const one = { column: item.column, dayTypeId, period: item.period, text, roomId: room ? room.id : null, unknown: key !== '' && !room };
      line.cells.push(one);
      if (!days.has(dayTypeId)) days.set(dayTypeId, []);
      days.get(dayTypeId).push(one);
    }
    // A day type that is the same as the first is only touched by a row that
    // has something to say about it.
    for (const [dayTypeId, cells] of Array.from(days)) {
      if (!isOwn(project, dayTypeId) && cells.every((one) => roomNumberKey(one.text) === '')) days.delete(dayTypeId);
    }

    let group = groups.get(line.key);
    if (group) {
      const again = Array.from(days.keys()).find((dayTypeId) => group.days[dayTypeId] !== undefined);
      if (again !== undefined || days.size === 0) {
        const dayType = project.dayTypes.find((candidate) => candidate.id === again);
        line.reason = 'Row ' + group.rows[0] + ' already gave ' + group.name + (dayType ? ' its ' + dayType.name : '') + '. This row was left out.';
        line.cells = [];
        continue;
      }
    } else {
      const existing = existingByKey.get(line.key) || null;
      group = { key: line.key, name: line.name, existing: existing ? { id: existing.id, name: existing.name } : null, rows: [], fields: {}, days: {} };
      groups.set(line.key, group);
      if (gradeColumn !== -1) group.fields.grade = cell(row, gradeColumn);
      if (headCountColumn !== -1) {
        const read = readHeadCount(cell(row, headCountColumn));
        if (read.warning) line.warnings.push(read.warning);
        else group.fields.headCount = read.value;
      }
      if (colourColumn !== -1) {
        const read = readColour(cell(row, colourColumn));
        if (read.warning) line.warnings.push(read.warning);
        else if (read.value) group.fields.colour = read.value;
      }
    }
    group.rows.push(line.row);
    line.status = group.existing ? 'match' : 'create';
    line.groupId = group.existing ? group.existing.id : null;

    for (const [dayTypeId, cells] of days) {
      if (!isOwn(project, dayTypeId)) makesOwn.add(dayTypeId);
      const day = {};
      for (const one of cells) {
        day[one.period] = one.roomId ? { room: one.roomId, roomText: '' } : { room: null, roomText: roomNumberKey(one.text) === '' ? '' : one.text };
        if (roomNumberKey(one.text) !== '') result.counts.slots += 1;
        if (!one.unknown) continue;
        const key = roomNumberKey(one.text);
        if (!unknown.has(key)) unknown.set(key, { text: one.text, count: 0, rows: [] });
        const record = unknown.get(key);
        record.count += 1;
        if (!record.rows.includes(line.row)) record.rows.push(line.row);
      }
      group.days[dayTypeId] = day;
    }
  }

  result.groups = Array.from(groups.values());
  result.unknownRooms = Array.from(unknown.values());
  result.makesOwn = project.dayTypes.filter((dayType) => makesOwn.has(dayType.id)).map((dayType) => dayType.id);
  result.counts.create = result.groups.filter((group) => !group.existing).length;
  result.counts.match = result.groups.filter((group) => group.existing).length;
  result.counts.skip = result.rows.filter((line) => line.status === 'skip').length;
  result.counts.unknownRooms = result.unknownRooms.length;
  return result;
}

// ---------------------------------------------------------------- merge

function copySlot(slot) {
  return { room: slot.room, roomText: slot.roomText, label: slot.label, teacherIds: slot.teacherIds.slice() };
}

function slotHasRoom(slot) {
  return slot !== undefined && slot !== null && (slot.room !== null || slot.roomText !== '');
}

// The slot a group ends up with. An incoming slot that says nothing about the
// label or the teachers (a CSV cell) keeps the label, and keeps the teachers
// named for the slot only while the room stays the same.
function mergeSlot(existing, incoming) {
  const before = existing || emptySlot();
  const sameRoom = before.room === incoming.room && before.roomText === incoming.roomText;
  const next = {
    room: incoming.room,
    roomText: incoming.roomText,
    label: incoming.label === undefined ? before.label : incoming.label,
    teacherIds: incoming.teacherIds === undefined ? (sameRoom ? before.teacherIds : []) : incoming.teacherIds.slice(),
  };
  if (existing && sameRoom && next.label === existing.label && next.teacherIds.length === existing.teacherIds.length && next.teacherIds.every((id, i) => id === existing.teacherIds[i])) return existing;
  return next;
}

function decide(policy, key) {
  const per = policy && policy.per && Object.prototype.hasOwnProperty.call(policy.per, key) ? policy.per[key] : undefined;
  const chosen = per === undefined ? (policy && policy.all !== undefined ? policy.all : 'skip') : per;
  if (!CLASH_POLICIES.includes(chosen)) throw new ImportError('A name clash is answered with one of: ' + CLASH_POLICIES.join(', ') + '.', 'bad-policy');
  return chosen;
}

function freeName(used, name) {
  for (let n = 2; ; n += 1) {
    const candidate = name + ' (' + n + ')';
    if (!used.has(nameKey(candidate))) return candidate;
  }
}

// Put incoming groups into a project. `incoming` is a list of
// { key, name, id, fields, days }: `fields` holds any of grade, headCount and
// colour; `days[dayTypeId]` is a list or an object by period of
// { room, roomText, label, teacherIds }, where a missing period or a missing
// label or teacherIds leaves what is there. Every dayTypeId is a day type of
// `project`. A day type that is the same as the first becomes its own copy
// when a group that is not skipped has a room in it.
//
// Returns { project, summary }. When nothing changes, `project` is the one
// that was passed in.
export function mergeGroups(project, incoming, policy, ids) {
  const summary = { created: [], overwritten: [], skipped: [], renamed: [], madeOwn: [], unchanged: [] };
  const periods = project.settings.periods;
  const base = project.dayTypes[0];
  const existingByKey = new Map(project.groups.map((group) => [nameKey(group.name), group]));
  const usedNames = new Set(existingByKey.keys());
  for (const item of incoming) usedNames.add(nameKey(item.name));

  // what happens to each incoming group
  const plan = [];
  for (const item of incoming) {
    const existing = existingByKey.get(nameKey(item.name)) || null;
    if (!existing) {
      plan.push({ item, op: 'create', name: item.name });
      continue;
    }
    const answer = decide(policy, item.key === undefined ? nameKey(item.name) : item.key);
    if (answer === 'skip') {
      summary.skipped.push(item.name);
    } else if (answer === 'overwrite') {
      plan.push({ item, op: 'overwrite', existing });
    } else {
      const key = item.key === undefined ? nameKey(item.name) : item.key;
      const asked = policy && policy.names ? policy.names[key] : undefined;
      let name;
      if (asked === undefined) {
        name = freeName(usedNames, item.name);
      } else {
        if (typeof asked !== 'string' || asked.trim() === '') throw new ImportError('The new name for "' + item.name + '" is empty. Type a name, or choose skip or overwrite.', 'no-name');
        if (usedNames.has(nameKey(asked))) throw new ImportError('There is already a group called "' + asked + '". Type a different name for the imported "' + item.name + '".', 'duplicate-name');
        name = asked;
      }
      usedNames.add(nameKey(name));
      summary.renamed.push({ from: item.name, to: name });
      plan.push({ item, op: 'create', name });
    }
  }

  const daysOf = (item) => {
    const days = {};
    for (const dayTypeId of Object.keys(item.days || {})) {
      if (!project.dayTypes.some((dayType) => dayType.id === dayTypeId)) continue;
      const source = item.days[dayTypeId];
      const slots = [];
      for (let period = 0; period < periods; period += 1) {
        const slot = source[period];
        slots.push(slot === undefined || slot === null ? undefined : slot);
      }
      if (!isOwn(project, dayTypeId) && !slots.some(slotHasRoom)) continue;
      days[dayTypeId] = slots;
    }
    return days;
  };
  for (const step of plan) step.days = daysOf(step.item);

  // day types that become their own copy
  const toOwn = project.dayTypes.filter((dayType, index) => index > 0 && !dayType.own && plan.some((step) => step.days[dayType.id] !== undefined));
  let next = project;
  if (toOwn.length > 0) {
    const becoming = new Set(toOwn.map((dayType) => dayType.id));
    next = {
      ...project,
      dayTypes: project.dayTypes.map((dayType) => (becoming.has(dayType.id) ? { ...dayType, own: true, bells: base.bells.map((bell) => (bell === null ? null : { ...bell })) } : dayType)),
      groups: project.groups.map((group) => {
        const days = { ...group.days };
        for (const dayType of toOwn) days[dayType.id] = group.days[base.id].map(copySlot);
        return { ...group, days };
      }),
    };
    summary.madeOwn = toOwn.map((dayType) => dayType.name);
  }
  const ownIds = next.dayTypes.filter((dayType, index) => index === 0 || dayType.own).map((dayType) => dayType.id);
  const becameOwn = new Set(toOwn.map((dayType) => dayType.id));

  const taken = new Set(next.groups.map((group) => group.id));
  let groups = next.groups;
  for (const step of plan) {
    const item = step.item;
    const fields = item.fields || {};
    if (step.op === 'overwrite') {
      const index = groups.findIndex((group) => group.id === step.existing.id);
      const current = groups[index];
      let days = current.days;
      for (const dayTypeId of Object.keys(step.days)) {
        const before = current.days[dayTypeId] || emptyDay(periods);
        let changed = false;
        const day = before.map((slot, period) => {
          const incomingSlot = step.days[dayTypeId][period];
          if (incomingSlot === undefined) return slot;
          const merged = mergeSlot(slot, incomingSlot);
          if (merged !== slot) changed = true;
          return merged;
        });
        if (changed) days = { ...days, [dayTypeId]: day };
      }
      const updated = {
        ...current,
        grade: fields.grade === undefined ? current.grade : fields.grade,
        headCount: fields.headCount === undefined ? current.headCount : fields.headCount,
        colour: fields.colour === undefined ? current.colour : fields.colour,
        days,
      };
      if (updated.grade === current.grade && updated.headCount === current.headCount && updated.colour === current.colour && days === current.days) {
        summary.unchanged.push(current.name);
        continue;
      }
      groups = groups.slice();
      groups[index] = updated;
      summary.overwritten.push(current.name);
      continue;
    }
    let id = item.id;
    if (!isId(id, 'g') || taken.has(id)) id = ids('g');
    taken.add(id);
    const days = {};
    for (const dayTypeId of ownIds) {
      const given = step.days[dayTypeId];
      if (given) days[dayTypeId] = given.map((slot) => mergeSlot(null, slot === undefined ? emptySlot() : slot));
    }
    for (const dayTypeId of ownIds) {
      if (days[dayTypeId]) continue;
      days[dayTypeId] = becameOwn.has(dayTypeId) && days[base.id] ? days[base.id].map(copySlot) : emptyDay(periods);
    }
    const group = {
      id,
      name: step.name,
      grade: fields.grade === undefined ? '' : fields.grade,
      headCount: fields.headCount === undefined ? null : fields.headCount,
      colour: fields.colour === undefined ? nextGroupColour(groups) : fields.colour,
      days,
    };
    groups = groups.concat([group]);
    summary.created.push(step.name);
  }

  if (groups === next.groups) {
    // nothing was created or changed, so no day type has a reason to change
    summary.madeOwn = [];
    return { project, summary };
  }
  return { project: { ...next, groups }, summary };
}

// The whole CSV import: preview, then merge. Refuses with an ImportError when
// the mapping cannot be used.
export function applyGroupImport(project, rows, mapping, policy, ids) {
  const preview = previewImport(project, rows, mapping);
  if (preview.problems.length > 0) throw new ImportError(preview.problems[0], 'bad-mapping');
  const incoming = preview.groups.map((group) => ({ key: group.key, name: group.name, fields: group.fields, days: group.days }));
  const merged = mergeGroups(project, incoming, policy, ids);
  merged.summary.rowsSkipped = preview.counts.skip;
  merged.summary.unknownRooms = preview.unknownRooms.map((record) => record.text);
  return merged;
}

// "3 groups added, 1 replaced, 2 left as they were", for the undo label and
// the toast.
export function summaryText(summary) {
  const parts = [];
  const groups = (n) => n + (n === 1 ? ' group' : ' groups');
  if (summary.created.length > 0) parts.push(groups(summary.created.length) + ' added');
  if (summary.overwritten.length > 0) parts.push(groups(summary.overwritten.length) + ' replaced');
  const left = summary.skipped.length + summary.unchanged.length;
  if (left > 0) parts.push(groups(left) + ' left as ' + (left === 1 ? 'it was' : 'they were'));
  return parts.length === 0 ? 'nothing to import' : parts.join(', ');
}
