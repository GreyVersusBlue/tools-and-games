// Importing the subject list from a CSV file (spec 5.2, 5.6). The file is the
// one the subjects export writes (exports.js subjectsRows): a header row,
// then a row for each subject under
//
//   Code, Subject, Colour
//
// The columns are found by their headers, in any order and whatever the
// capitals; a file needs a code column or a name column, and a column it does
// not have changes nothing. There is no mapping step.
//
//   previewSubjectImport(project, rows)      → what each row would do
//   applySubjectImport(project, rows, ids)   → { project, summary }
//
// `rows` is what csv.js `parse` returned, the header row first.
//
// The rules:
// - A row is matched to a subject on the list by its code, without regard to
//   capitals or surrounding spaces. A row with no code is matched by its name
//   the same way, and the name on the list stays as it is. A row with neither
//   is skipped.
// - A code (or, with no code, a name) that is not on the list is a new
//   subject, added after the ones already here in the file's order, with the
//   code and name exactly as the file has them.
// - Nothing is deleted and nothing is reordered. A subject that is not in the
//   file stays. An empty cell changes nothing. A name or colour in the file
//   takes the place of what the subject had; a subject keeps its id, so the
//   rooms and teachers that use it still do.
// - A colour is "#2a6f97", "2A6F97" or "#26f". One that cannot be read is
//   left out and the row says so; a new subject with no colour gets
//   NEW_SUBJECT_COLOUR.
// - A second row for a subject already seen in the file is skipped.

import { nameKey } from './schema.js';
import { ImportError } from './import-groups.js';

// The colour of a new subject whose row gives none. It is the one a subject
// added by hand starts with (actions.addSubject).
export const NEW_SUBJECT_COLOUR = '#5a6b7b';

const HEADERS = {
  code: ['code', 'subject code'],
  name: ['subject', 'subject name', 'name', 'department'],
  colour: ['colour', 'color'],
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

// A colour cell, read as the groups CSV reads one.
function readColour(text) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return {};
  let match = trimmed.match(/^#?([0-9a-f]{6})$/);
  if (match) return { value: '#' + match[1] };
  match = trimmed.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (match) return { value: '#' + match[1] + match[1] + match[2] + match[2] + match[3] + match[3] };
  return { warning: 'The colour "' + text + '" is not written #rrggbb, so it was left out.' };
}

// Which column is which: { code, name, colour }, each a column index or -1.
// The first column with a header of that meaning wins.
export function subjectColumns(header) {
  const columns = { code: -1, name: -1, colour: -1 };
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
//   problems  what makes the file unusable; when not empty, nothing else is filled in
//   columns   subjectColumns(rows[0])
//   rows      [{ row, status, code, name, colour, key, subjectId, reason, changes,
//             warnings }]; row counts from 1 in the file (the header is 1);
//             status is 'create', 'update' (the subject is on the list and
//             something would change), 'same' (on the list, nothing to
//             change), 'skip' (with `reason`) or 'heading'. code, name and
//             colour are what the subject would have afterwards; changes
//             lists which of 'name' and 'colour' differ.
//   counts    { create, update, same, skip }
export function previewSubjectImport(project, rows) {
  const result = { problems: [], columns: subjectColumns(Array.isArray(rows) ? rows[0] : null), rows: [], counts: { create: 0, update: 0, same: 0, skip: 0 } };
  if (!Array.isArray(rows) || rows.length === 0) {
    result.problems.push('The file has no rows. Choose a CSV file with a header row and one row for each subject.');
    return result;
  }
  const columns = result.columns;
  if (columns.code === -1 && columns.name === -1) {
    result.problems.push('No column is headed "Code" or "Subject", so the tool cannot tell which column holds the subjects. Head the code column "Code" and the name column "Subject", and choose the file again.');
    return result;
  }
  const cell = (row, index) => (index >= 0 && index < row.length ? String(row[index]) : '');

  const header = rows[0];
  const byCode = new Map();
  const byName = new Map();
  for (const subject of project.subjects) {
    if (!isBlank(subject.code) && !byCode.has(nameKey(subject.code))) byCode.set(nameKey(subject.code), subject);
    if (!isBlank(subject.name) && !byName.has(nameKey(subject.name))) byName.set(nameKey(subject.name), subject);
  }
  const seen = new Map();

  for (let r = 1; r < rows.length; r += 1) {
    const row = Array.isArray(rows[r]) ? rows[r] : [];
    if (row.every(isBlank)) continue;
    const codeText = cell(row, columns.code);
    const nameText = cell(row, columns.name);
    const line = { row: r + 1, status: 'skip', code: codeText, name: nameText, colour: '', key: '', subjectId: null, reason: '', changes: [], warnings: [] };
    result.rows.push(line);

    if (row.length === header.length && row.every((value, i) => value === header[i])) {
      line.status = 'heading';
      line.reason = 'The header row again.';
      continue;
    }
    if (isBlank(codeText) && isBlank(nameText)) {
      line.reason = 'This row has no subject code and no subject name.';
      continue;
    }
    // by code when the row has one, else by name
    const coded = !isBlank(codeText);
    line.key = (coded ? 'code:' : 'name:') + nameKey(coded ? codeText : nameText);
    const existing = (coded ? byCode.get(nameKey(codeText)) : byName.get(nameKey(nameText))) || null;
    const seenKey = existing ? 'id:' + existing.id : line.key;
    if (seen.has(seenKey)) {
      line.reason = 'This subject is already on row ' + seen.get(seenKey) + ' of the file.';
      continue;
    }
    seen.set(seenKey, line.row);

    const colour = readColour(cell(row, columns.colour));
    if (colour.warning) line.warnings.push(colour.warning);

    if (!existing) {
      line.status = 'create';
      line.colour = colour.value || NEW_SUBJECT_COLOUR;
      continue;
    }
    line.subjectId = existing.id;
    line.code = existing.code;
    // a row found by its name keeps the name as the list has it
    line.name = !coded || isBlank(nameText) ? existing.name : nameText;
    line.colour = colour.value || existing.colour;
    if (line.name !== existing.name) line.changes.push('name');
    if (line.colour !== existing.colour.toLowerCase()) line.changes.push('colour');
    else line.colour = existing.colour;
    line.status = line.changes.length > 0 ? 'update' : 'same';
  }

  for (const line of result.rows) if (line.status in result.counts) result.counts[line.status] += 1;
  return result;
}

function called(line) {
  return isBlank(line.name) ? line.code : line.name;
}

// The whole import. Refuses with an ImportError when the file cannot be
// used; otherwise { project, summary } with summary { created, updated,
// unchanged (each a list of names, or codes where there is no name),
// rowsSkipped, coloursLeftOut }. When nothing would change, `project` is the
// project it was given.
export function applySubjectImport(project, rows, ids) {
  const preview = previewSubjectImport(project, rows);
  if (preview.problems.length > 0) throw new ImportError(preview.problems[0], 'bad-file');
  const summary = { created: [], updated: [], unchanged: [], rowsSkipped: preview.counts.skip, coloursLeftOut: preview.rows.filter((line) => line.warnings.length > 0).length };

  const updates = new Map();
  const created = [];
  for (const line of preview.rows) {
    if (line.status === 'same') summary.unchanged.push(called(line));
    if (line.status === 'update') {
      updates.set(line.subjectId, line);
      summary.updated.push(called(line));
    }
    if (line.status === 'create') {
      created.push({ id: ids('s'), code: line.code, name: line.name, colour: line.colour });
      summary.created.push(called(line));
    }
  }
  if (updates.size === 0 && created.length === 0) return { project, summary };

  const subjects = project.subjects.map((subject) => {
    const line = updates.get(subject.id);
    return line ? { ...subject, name: line.name, colour: line.colour } : subject;
  }).concat(created);
  return { project: { ...project, subjects }, summary };
}

// "3 subjects added, 1 subject updated, 2 subjects left unchanged", for the
// undo label and the toast.
export function subjectSummaryText(summary) {
  const parts = [];
  const subjects = (n) => plural(n, 'subject', 'subjects');
  if (summary.created.length > 0) parts.push(subjects(summary.created.length) + ' added');
  if (summary.updated.length > 0) parts.push(subjects(summary.updated.length) + ' updated');
  if (summary.unchanged.length > 0) parts.push(subjects(summary.unchanged.length) + ' left unchanged');
  return parts.length === 0 ? 'nothing to import' : parts.join(', ');
}
