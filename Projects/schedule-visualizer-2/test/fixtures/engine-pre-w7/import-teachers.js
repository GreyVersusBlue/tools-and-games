// Importing the teacher list from a CSV file (spec 5.3). The file is the one
// the teachers export writes (exports.js teachersRows): a header row, then a
// row for each teacher under
//
//   Teacher, Subject code, Subject, Rooms, Notes
//
// The columns are found by their headers, in any order and whatever the
// capitals; only the teacher's name is needed, and a column the file does
// not have changes nothing. There is no mapping step.
//
//   previewTeacherImport(project, rows)      → what each row would do
//   applyTeacherImport(project, rows, ids)   → { project, summary }
//
// `rows` is what csv.js `parse` returned, the header row first.
//
// The rules:
// - A row is matched to a teacher on the list by name, without regard to
//   capitals or surrounding spaces. A name that is not on the list is a new
//   teacher, with the name exactly as the file has it.
// - A subject is found by its code, else by its name, the same way. A subject
//   that is not on the list is left out and the row says so.
// - "Rooms" is room numbers separated by semicolons. Each is matched to the
//   building without regard to capitals or surrounding spaces; a number that
//   is not in the building is left out and the row says so.
// - Nothing is deleted. A teacher who is not in the file stays. An empty cell
//   changes nothing. The rooms in the file are added to the rooms a teacher
//   already has, never taken from them. A subject or notes in the file take
//   the place of what the teacher had.
// - A second row for a name already seen in the file is skipped.

import { nameKey, roomNumberKey, allRooms } from './schema.js';
import { ImportError } from './import-groups.js';

const HEADERS = {
  name: ['teacher', 'teachers', 'teacher name', 'name'],
  subjectCode: ['subject code', 'code'],
  subject: ['subject', 'subject name', 'department'],
  rooms: ['rooms', 'room', 'home room', 'home rooms'],
  notes: ['notes', 'note'],
};

function headerKey(text) {
  return String(text === undefined || text === null ? '' : text).trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function isBlank(text) {
  return String(text === undefined || text === null ? '' : text).trim() === '';
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

// Which column is which: { name, subjectCode, subject, rooms, notes }, each a
// column index or -1. The first column with a header of that meaning wins.
export function teacherColumns(header) {
  const columns = { name: -1, subjectCode: -1, subject: -1, rooms: -1, notes: -1 };
  if (!Array.isArray(header)) return columns;
  header.forEach((text, index) => {
    const key = headerKey(text);
    for (const role of Object.keys(HEADERS)) {
      if (columns[role] === -1 && HEADERS[role].includes(key)) {
        columns[role] = index;
        return;
      }
    }
  });
  return columns;
}

// What importing these rows would do, row by row, before anything changes:
//
//   problems      what makes the file unusable; when not empty, nothing else is filled in
//   columns       teacherColumns(rows[0])
//   rows          [{ row, status, name, key, teacherId, reason, subjectId, roomIds,
//                 notes, changes, warnings }]; row counts from 1 in the file
//                 (the header is 1); status is 'create', 'update' (a teacher of
//                 that name is on the list and something would change), 'same'
//                 (on the list, nothing to change), 'skip' (with `reason`) or
//                 'heading'. subjectId, roomIds and notes are what the teacher
//                 would have afterwards; changes lists which of 'subject',
//                 'rooms', 'notes' differ.
//   unknownRooms  [{ text, count, rows }] room numbers that are not in the building
//   counts        { create, update, same, skip, unknownRooms }
export function previewTeacherImport(project, rows) {
  const result = { problems: [], columns: teacherColumns(Array.isArray(rows) ? rows[0] : null), rows: [], unknownRooms: [], counts: { create: 0, update: 0, same: 0, skip: 0, unknownRooms: 0 } };
  if (!Array.isArray(rows) || rows.length === 0) {
    result.problems.push('The file has no rows. Choose a CSV file with a header row and one row for each teacher.');
    return result;
  }
  const columns = result.columns;
  if (columns.name === -1) {
    result.problems.push('No column is headed "Teacher", so the tool cannot tell which column holds the names. Head the name column "Teacher" and choose the file again.');
    return result;
  }
  const cell = (row, index) => (index >= 0 && index < row.length ? String(row[index]) : '');

  const header = rows[0];
  const byName = new Map(project.teachers.map((teacher) => [nameKey(teacher.name), teacher]));
  const byCode = new Map();
  const bySubjectName = new Map();
  for (const subject of project.subjects) {
    if (!isBlank(subject.code) && !byCode.has(nameKey(subject.code))) byCode.set(nameKey(subject.code), subject);
    if (!isBlank(subject.name) && !bySubjectName.has(nameKey(subject.name))) bySubjectName.set(nameKey(subject.name), subject);
  }
  const byNumber = new Map();
  for (const room of allRooms(project)) {
    const key = roomNumberKey(room.number);
    if (key !== '' && !byNumber.has(key)) byNumber.set(key, room);
  }
  const seen = new Map();
  const unknown = new Map();

  for (let r = 1; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    if (row.every(isBlank)) continue;
    const line = { row: r + 1, status: 'skip', name: cell(row, columns.name), key: '', teacherId: null, reason: '', subjectId: null, roomIds: [], notes: '', changes: [], warnings: [] };
    result.rows.push(line);

    if (row.length === header.length && row.every((value, i) => value === header[i])) {
      line.status = 'heading';
      line.reason = 'The header row again.';
      continue;
    }
    if (isBlank(line.name)) {
      line.reason = 'This row has no teacher name.';
      continue;
    }
    line.key = nameKey(line.name);
    if (seen.has(line.key)) {
      line.reason = 'This teacher is already on row ' + seen.get(line.key) + ' of the file.';
      continue;
    }
    seen.set(line.key, line.row);

    const existing = byName.get(line.key) || null;
    line.teacherId = existing ? existing.id : null;
    if (existing) line.name = existing.name;

    // subject: the code first, then the name
    let subject = null;
    const codeText = cell(row, columns.subjectCode);
    const subjectText = cell(row, columns.subject);
    if (!isBlank(codeText)) subject = byCode.get(nameKey(codeText)) || bySubjectName.get(nameKey(codeText)) || null;
    if (!subject && !isBlank(subjectText)) subject = bySubjectName.get(nameKey(subjectText)) || byCode.get(nameKey(subjectText)) || null;
    if (!subject && (!isBlank(codeText) || !isBlank(subjectText))) {
      line.warnings.push('The subject "' + (isBlank(codeText) ? subjectText : codeText) + '" is not on the subject list, so it was left out. Add the subject first, or pick it for the teacher afterwards.');
    }
    line.subjectId = subject ? subject.id : existing ? existing.subjectId : null;

    // rooms: added to what the teacher has
    const roomIds = existing ? existing.roomIds.slice() : [];
    for (const part of cell(row, columns.rooms).split(';')) {
      const key = roomNumberKey(part);
      if (key === '') continue;
      const room = byNumber.get(key);
      if (!room) {
        const text = part.trim();
        line.warnings.push('Room "' + text + '" is not in the building, so it was left out.');
        if (!unknown.has(key)) unknown.set(key, { text, count: 0, rows: [] });
        unknown.get(key).count += 1;
        unknown.get(key).rows.push(line.row);
        continue;
      }
      if (!roomIds.includes(room.id)) roomIds.push(room.id);
    }
    line.roomIds = existing && roomIds.length === existing.roomIds.length ? existing.roomIds : roomIds;

    const notesText = cell(row, columns.notes);
    line.notes = isBlank(notesText) ? (existing ? existing.notes : '') : notesText;

    if (!existing) {
      line.status = 'create';
      continue;
    }
    if (line.subjectId !== existing.subjectId) line.changes.push('subject');
    if (line.roomIds.length !== existing.roomIds.length) line.changes.push('rooms');
    if (line.notes !== existing.notes) line.changes.push('notes');
    line.status = line.changes.length > 0 ? 'update' : 'same';
  }

  result.unknownRooms = Array.from(unknown.values());
  for (const line of result.rows) if (line.status in result.counts) result.counts[line.status] += 1;
  result.counts.unknownRooms = result.unknownRooms.length;
  return result;
}

// The whole import. Refuses with an ImportError when the file cannot be
// used; otherwise { project, summary } with summary { created, updated,
// unchanged (names), rowsSkipped, unknownRooms (as typed), unknownSubjects }.
// When nothing would change, `project` is the project it was given.
export function applyTeacherImport(project, rows, ids) {
  const preview = previewTeacherImport(project, rows);
  if (preview.problems.length > 0) throw new ImportError(preview.problems[0], 'bad-file');
  const summary = { created: [], updated: [], unchanged: [], rowsSkipped: preview.counts.skip, unknownRooms: preview.unknownRooms.map((record) => record.text), unknownSubjects: preview.rows.filter((line) => line.warnings.some((warning) => warning.startsWith('The subject '))).length };

  const updates = new Map();
  const created = [];
  for (const line of preview.rows) {
    if (line.status === 'same') summary.unchanged.push(line.name);
    if (line.status === 'update') {
      updates.set(line.teacherId, line);
      summary.updated.push(line.name);
    }
    if (line.status === 'create') {
      created.push({ id: ids('t'), name: line.name, subjectId: line.subjectId, roomIds: line.roomIds, notes: line.notes });
      summary.created.push(line.name);
    }
  }
  if (updates.size === 0 && created.length === 0) return { project, summary };

  const teachers = project.teachers.map((teacher) => {
    const line = updates.get(teacher.id);
    return line ? { ...teacher, subjectId: line.subjectId, roomIds: line.roomIds, notes: line.notes } : teacher;
  }).concat(created);

  // a teacher's rooms and a room's teachers say the same thing: each room a
  // teacher gained lists the teacher, after the teachers it already had
  const had = new Map(project.teachers.map((teacher) => [teacher.id, teacher.roomIds]));
  const gained = new Map();
  for (const teacher of teachers) {
    for (const roomId of teacher.roomIds) {
      if (had.has(teacher.id) && had.get(teacher.id).includes(roomId)) continue;
      if (!gained.has(roomId)) gained.set(roomId, []);
      gained.get(roomId).push(teacher.id);
    }
  }
  if (gained.size === 0) return { project: { ...project, teachers }, summary };
  const floors = project.building.floors.map((floor) => {
    if (!floor.spaces.some((space) => gained.has(space.id))) return floor;
    return { ...floor, spaces: floor.spaces.map((space) => (gained.has(space.id) ? { ...space, teacherIds: space.teacherIds.concat(gained.get(space.id)) } : space)) };
  });
  return { project: { ...project, teachers, building: { ...project.building, floors } }, summary };
}

// "3 teachers added, 1 teacher updated, 2 teachers left unchanged", for the
// undo label and the toast.
export function teacherSummaryText(summary) {
  const parts = [];
  const teachers = (n) => plural(n, 'teacher', 'teachers');
  if (summary.created.length > 0) parts.push(teachers(summary.created.length) + ' added');
  if (summary.updated.length > 0) parts.push(teachers(summary.updated.length) + ' updated');
  if (summary.unchanged.length > 0) parts.push(teachers(summary.unchanged.length) + ' left unchanged');
  return parts.length === 0 ? 'nothing to import' : parts.join(', ');
}
