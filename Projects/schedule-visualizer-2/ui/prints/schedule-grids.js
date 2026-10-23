// The schedule on paper (spec 5.6, 17): the groups, the teacher list, the
// teachers by period and the rooms by period. Each is the CSV file of the
// same name (engine/exports.js) set out for reading: the cells printed are
// the cells the file holds, from the same row builders, so the paper and the
// file never differ.
//
//   groups        a grid a day type: a row a group, a column a period, the
//                 room in each slot; grade, head count and colour under the
//                 group's name
//   teachers      the teacher list: name, subject code, subject, rooms, notes
//   teacher-grid  a grid a day type: a row a teacher, the groups taught and
//                 where, or Planning
//   room-grid     a grid a day type: a row a room, the groups in it; room
//                 numbers the schedule names that are not in the building
//                 come last, said so
//
// Each grid is a sheet of its own, under the print header, for each day type
// that is its own copy. A day type that is the same as the first has no grid
// of its own and the last sheet says so (the files leave its slots empty, or
// repeat the first day's, which is the same thing). A grid taller than the
// sheet runs on to the next with its head row repeated (print.css).
//
// A grid too wide for the sheet is split by periods, never turned: the
// orientation is the reader's choice in the preview, remembered for every
// print, and turning one document would overrule it; and a long day does not
// fit even turned (16 periods at a readable width need about 315 mm, wider
// than Tabloid on its side). So the periods are cut into as few parts as
// the sheet's width allows, of equal size give or take one, and each part is
// a sheet of its own headed with the periods it holds ("A Day, Period 1 to
// Period 5"); every part repeats the name column. periodParts() is that rule.
//
// The paper says what the Schedule screen says where the bare file cell does
// not (SV2-32l). The cells of the file are printed as they are, and the
// screen's words go beside them, never in their place:
//
//   - a room with no number reads "a room with no number" (engine/findings.js
//     roomName), in the groups grid, the teachers by period, the teacher
//     list's Rooms and the rooms by period's names, where the file has an
//     empty cell or an empty entry;
//   - a slot in a room that is not in the building says so under it, in the
//     groups grid and the teachers by period alike;
//   - a teacher's room that is no longer in the building is named as the
//     screen's teacher table names a room it cannot find, "a room not in the
//     building", never an empty entry;
//   - a cell with findings is marked as the screen's grids mark it: from the
//     same checks, by the same slot key (ui/schedule/grid/model.js), the
//     findings of the groups in the cell. On paper a mark is `is-marked` and
//     a numbered reference (P1, W1, N1, as the checks report's grid), and
//     under the table each reference is followed by the finding's words, as
//     the screen says them (ui/schedule/grid/words.js).
//
// render(project, derived, options) → { title, html }; options as document.js.
// `derived` is not read: everything here is the schedule as it stands, and
// the findings are the ones the Schedule screen's grids read, which have no
// walk figures in them.

import { groupsRows, teachersRows, teacherGridRows, roomGridRows, NOT_IN_BUILDING } from '../../engine/exports.js';
import { ownDayTypes, effectiveSchedule } from '../../engine/day-types.js';
import { bellsFor, periodName, formatTime } from '../../engine/bells.js';
import { teacherDays } from '../../engine/teacher-day.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';
import { sheetModel } from '../schedule/grid/model.js';
import { slotKeyOf } from '../schedule/grid/staged.js';
import { findingWords, worstFirst } from '../schedule/grid/words.js';
import { parse, toHex } from '../colour.js';
import { count, list, periodWords } from '../components/words.js';
import { esc, frame, paperOf, printableBox } from './document.js';

// The name column's width, as print.css gives it (.doc-grid th:first-child),
// and the least a period's column may have: about twelve characters of the
// grid's 8 pt, "7-1 · 204" with room to spare.
export const NAME_MM = 26;
export const PERIOD_MM = 18;

// The periods a sheet of this paper holds side by side, cut into parts.
//   periodParts(paper, periods) → [{ from, to }]: `to` is past the last
// One part when every period fits; else as few as fit, the first parts one
// period longer where the count does not divide.
export function periodParts(paper, periods) {
  const room = printableBox(paper).width - NAME_MM;
  const most = Math.max(1, Math.floor(room / PERIOD_MM));
  const parts = Math.max(1, Math.ceil(periods / most));
  const size = Math.floor(periods / parts);
  const longer = periods % parts;
  const out = [];
  let from = 0;
  for (let index = 0; index < parts; index += 1) {
    const to = from + size + (index < longer ? 1 : 0);
    out.push({ from, to });
    from = to;
  }
  return out;
}

// "Period 1 to Period 5", "Block C", in the school's own word.
export function partWords(settings, part) {
  if (part.to - part.from === 1) return periodName(settings, part.from);
  return periodName(settings, part.from) + ' to ' + periodName(settings, part.to - 1);
}

// What the screen's teacher table calls a room it cannot find (readonly.js).
export const ROOM_GONE = 'a room not in the building';

// The words for a room the screen names by words rather than its number: a
// room with no number; '' for one that has a number.
function unnumbered(room) {
  return room && room.number.trim() === '' ? roomName(room) : '';
}

// ---------------------------------------------------------------- findings

// The findings the Schedule screen's grids mark, slot key to findings: the
// grid model's own map, so the paper and the screen mark the same slots.
function slotFindings(project) {
  return sheetModel(project, project, null).findings;
}

// The findings on the slots of these groups in one period, each once, worst
// first: what a cell of the screen's teacher and room tables carries.
function findingsOn(findings, groupIds, dayTypeId, period) {
  const found = new Map();
  for (const groupId of groupIds) {
    for (const finding of findings.get(slotKeyOf(groupId, dayTypeId, period)) || []) found.set(finding.id, finding);
  }
  return worstFirst(Array.from(found.values()));
}

const LETTER = { problem: 'P', warning: 'W', note: 'N' };

// The marks of one sheet. Each finding is given a reference the first time a
// cell of the sheet carries it, numbered by severity; notes() is a line for
// each under the table, worst first, in the words the screen gives it.
function sheetMarks() {
  const refs = new Map();
  const next = { problem: 0, warning: 0, note: 0 };
  const refOf = (finding) => {
    if (!refs.has(finding.id)) {
      next[finding.severity] += 1;
      refs.set(finding.id, { finding, ref: LETTER[finding.severity] + next[finding.severity] });
    }
    return refs.get(finding.id).ref;
  };
  const mark = (finding) => '<span class="mark mark--' + esc(finding.severity) + '">' + esc(refOf(finding)) + '</span>';
  return {
    // a cell: its classes, what is in it, and the findings it carries
    cell(classes, inside, found) {
      const all = classes.concat(found.length > 0 ? ['is-marked'] : []);
      return '<td' + (all.length > 0 ? ' class="' + all.join(' ') + '"' : '') + '>' + inside
        + (found.length > 0 ? '<span class="marks">' + found.map(mark).join('') + '</span>' : '') + '</td>';
    },
    notes() {
      if (refs.size === 0) return '';
      const lines = ['<p class="doc-meaning">' + esc('A numbered mark in a slot is a finding of the checks about it: P for a problem, W for a warning, N for a note.') + '</p>'];
      for (const finding of worstFirst(Array.from(refs.values(), (entry) => entry.finding))) {
        lines.push('<p class="doc-meaning doc-grid__finding">' + mark(finding) + ' ' + esc(findingWords([finding])) + '</p>');
      }
      return lines.join('\n');
    },
  };
}

// A square of a group's colour, drawn as a border so it prints whether or not
// backgrounds do; nothing when the colour is not one.
function swatch(colour) {
  if (!parse(colour)) return '';
  return '<span class="doc-swatch" style="display: inline-block; width: 0; height: 3mm; border-left: 3mm solid ' + esc(toHex(colour)) + '; outline: 0.2mm solid #1f2328; vertical-align: -0.5mm; margin-right: 1mm;"></span>';
}

// The head row of a grid: the name column, then each period of the part with
// its bell times under it.
function gridHead(project, dayTypeId, first, part) {
  const settings = project.settings;
  const bells = bellsFor(project, dayTypeId);
  const cells = ['<th scope="col">' + esc(first) + '</th>'];
  for (let period = part.from; period < part.to; period += 1) {
    const bell = bells[period];
    const times = bell && bell.start && bell.end ? formatTime(bell.start, settings.timeFormat, { suffix: false }) + '–' + formatTime(bell.end, settings.timeFormat, { suffix: false }) : '';
    cells.push('<th scope="col"><span class="doc-grid__period">' + esc(periodName(settings, period)) + '</span>' + (times === '' ? '' : '<span class="doc-grid__time">' + esc(times) + '</span>') + '</th>');
  }
  return '<thead><tr>' + cells.join('') + '</tr></thead>';
}

// A sheet for each day type that is its own copy and each part of its
// periods, under the header "<what>: <day type>[, <part>]".
//   spec  { first: the name column's head, lead(dayType): the first sheet's
//           sentence, empty: the sentence for a day with no rows,
//           rows(dayType, part, marks): the body's rows as markup, each
//           marked cell through marks.cell (sheetMarks) }
// → frame()'s pages
function gridPages(project, name, spec, options) {
  const paper = paperOf(project, options);
  const parts = periodParts(paper, project.settings.periods);
  const own = ownDayTypes(project);
  const pages = [];
  for (const dayType of own) {
    parts.forEach((part, index) => {
      const what = name + ': ' + dayType.name + (parts.length > 1 ? ', ' + partWords(project.settings, part) : '');
      const body = [];
      if (index === 0 && spec.lead) body.push('<p class="doc-lead">' + esc(spec.lead(dayType)) + '</p>');
      if (parts.length > 1) body.push('<p class="doc-meaning">' + esc('Part ' + (index + 1) + ' of ' + parts.length + ': the ' + periodWords(project.settings).many + ' do not fit across one sheet, so each part is a sheet of its own.') + '</p>');
      const marks = sheetMarks();
      const rows = spec.rows(dayType, part, marks);
      if (rows.length === 0) {
        body.push('<p class="doc-none">' + esc(spec.empty) + '</p>');
      } else {
        body.push('<table class="doc-table doc-grid" data-day="' + esc(dayType.id) + '" data-from="' + part.from + '" data-to="' + part.to + '">');
        body.push(gridHead(project, dayType.id, spec.first, part));
        body.push('<tbody>', rows.join('\n'), '</tbody></table>');
        const notes = marks.notes();
        if (notes !== '') body.push(notes);
      }
      pages.push({ what, body: body.join('\n') });
    });
  }
  const followers = project.dayTypes.filter((dayType) => !own.includes(dayType));
  if (followers.length > 0 && pages.length > 0) {
    const names = list(followers.map((dayType) => dayType.name));
    pages[pages.length - 1].body += '\n<p class="doc-meaning">' + esc(names + (followers.length === 1 ? ' is' : ' are') + ' the same as ' + project.dayTypes[0].name + ' and ' + (followers.length === 1 ? 'has' : 'have') + ' no grid of ' + (followers.length === 1 ? 'its' : 'their') + ' own.') + '</p>';
  }
  return pages;
}

// The first column's cell: the name, or `blank` (a room's words) for a room
// without one, with what goes under it.
function nameCell(text, under, options) {
  const opts = options || {};
  const name = text.trim() === '' ? '<span class="is-missing">' + esc(opts.blank || '') + '</span>' : esc(text);
  return '<th scope="row">' + (opts.before || '') + '<span class="doc-grid__name">' + name + '</span>'
    + (under === '' ? '' : '<span class="doc-grid__time">' + esc(under) + '</span>') + '</th>';
}

// ---------------------------------------------------------------- groups

// Where the day type's slots are in a row of the groups file.
export function groupsColumns(project, dayTypeId) {
  const index = project.dayTypes.findIndex((dayType) => dayType.id === dayTypeId);
  const first = 4 + index * project.settings.periods;
  return { first, last: first + project.settings.periods };
}

// "Grade 7, head count 25": what the groups file holds beside the name.
export function groupDetails(row) {
  const parts = [];
  if (row[1] !== '') parts.push('Grade ' + row[1]);
  if (row[2] !== '') parts.push('head count ' + row[2]);
  const text = parts.join(', ');
  return text === '' ? '' : text.charAt(0).toUpperCase() + text.slice(1);
}

function renderGroups(project, derived, options) {
  const opts = options || {};
  const words = periodWords(project.settings);
  const table = groupsRows(project).slice(1);
  const findings = slotFindings(project);
  const pages = project.groups.length === 0 ? [] : gridPages(project, groupsOutput.name, {
    first: 'Group',
    lead: (dayType) => 'The room each group is in, each ' + words.one + ' of ' + dayType.name + '. ' + count(project.groups.length, 'group') + '.',
    empty: '',
    rows: (dayType, part, marks) => {
      const { first } = groupsColumns(project, dayType.id);
      return table.map((row, index) => {
        const group = project.groups[index];
        const day = effectiveSchedule(project, group.id, dayType.id);
        const cells = [];
        for (let period = part.from; period < part.to; period += 1) {
          const text = row[first + period];
          const resolved = resolveSlotRoom(project, day[period]);
          const missing = text !== '' && resolved.missing;
          const words = unnumbered(resolved.room);
          cells.push(marks.cell([], (text === '' ? '' : '<span class="doc-grid__slot">' + esc(text) + '</span>')
            + (missing ? '<span class="doc-grid__time doc-grid__missing">' + esc(NOT_IN_BUILDING) + '</span>' : '')
            + (words === '' ? '' : '<span class="doc-grid__time doc-grid__missing">' + esc(words) + '</span>'),
          findingsOn(findings, [group.id], dayType.id, period)));
        }
        return '<tr data-group="' + esc(group.id) + '">' + nameCell(row[0], groupDetails(row), { before: swatch(row[3]) }) + cells.join('') + '</tr>';
      });
    },
  }, opts);
  if (pages.length === 0) pages.push({ body: '<p class="doc-lead">There are no groups yet.</p>' });
  return frame(project, { output: groupsOutput.id, what: groupsOutput.name, pages, options: opts });
}

// ---------------------------------------------------------------- teachers

export const TEACHER_COLUMNS = ['Teacher', 'Subject code', 'Subject', 'Rooms', 'Notes'];

// A teacher's rooms as the file lists them, each by its number; one with no
// number, or no longer in the building, by the screen's words for it, where
// the file has an empty entry.
function roomsCell(project, teacher) {
  return teacher.roomIds.map((id) => {
    const room = findRoom(project, id);
    if (room && room.number.trim() !== '') return esc(room.number);
    return '<span class="is-missing">' + esc(room ? roomName(room) : ROOM_GONE) + '</span>';
  }).join(esc('; '));
}

function renderTeachers(project, derived, options) {
  const opts = options || {};
  const table = teachersRows(project);
  const rows = table.slice(1);
  const body = ['<p class="doc-lead">' + esc(rows.length === 0 ? 'There are no teachers yet.' : 'This project has ' + count(rows.length, 'teacher') + '.') + '</p>'];
  if (rows.length > 0) {
    body.push('<table class="doc-table doc-table--teachers">');
    body.push('<thead><tr>' + table[0].map((label) => '<th scope="col">' + esc(label) + '</th>').join('') + '</tr></thead>');
    body.push('<tbody>');
    rows.forEach((row, index) => {
      const cells = row.slice(1).map((cell) => '<td>' + esc(cell) + '</td>');
      cells[2] = '<td>' + roomsCell(project, project.teachers[index]) + '</td>';
      body.push('<tr><th scope="row">' + esc(row[0]) + '</th>' + cells.join('') + '</tr>');
    });
    body.push('</tbody></table>');
  }
  return frame(project, { output: teachersOutput.id, what: teachersOutput.name, pages: [{ body: body.join('\n') }], options: opts });
}

// ---------------------------------------------------------------- the teachers by period

// The rows of the file for one day type, without the day type's column: the
// teacher, then a cell a period.
export function teacherGridTable(project, dayTypeId) {
  return teacherGridRows(project, dayTypeId).slice(1).map((row) => [row[0]].concat(row.slice(2)));
}

// What the file's "7-1 · 204" does not say of the rooms a teacher's groups
// are in, a line each under the cell: a room with no number (the file has
// the group alone), and a room that is not in the building, as the groups
// grid says it. With more than one group in the cell, each line names its
// group.
function taughtNotes(project, dayTypeId, period, taught) {
  return taught.map((each) => {
    const resolved = resolveSlotRoom(project, effectiveSchedule(project, each.groupId, dayTypeId)[period]);
    const words = resolved.missing ? NOT_IN_BUILDING : unnumbered(resolved.room);
    if (words === '') return '';
    const group = project.groups.find((candidate) => candidate.id === each.groupId);
    return '<span class="doc-grid__time doc-grid__missing">' + esc((taught.length > 1 && group ? group.name + ': ' : '') + words) + '</span>';
  }).join('');
}

function renderTeacherGrid(project, derived, options) {
  const opts = options || {};
  const words = periodWords(project.settings);
  const what = 'Teachers by ' + words.one;
  const findings = slotFindings(project);
  const pages = project.teachers.length === 0 ? [] : gridPages(project, what, {
    first: 'Teacher',
    lead: (dayType) => 'Each teacher\'s ' + words.many + ' on ' + dayType.name + ': the groups they have, and the room, or Planning.',
    empty: '',
    rows: (dayType, part, marks) => {
      const days = teacherDays(project, dayType.id);
      return teacherGridTable(project, dayType.id).map((row, index) => {
        const teacher = project.teachers[index];
        const day = days.get(teacher.id);
        const cells = [];
        for (let period = part.from; period < part.to; period += 1) {
          const planning = day[period].kind !== 'teaching';
          const taught = planning ? [] : day[period].groups;
          cells.push(planning
            ? marks.cell(['is-planning'], '<span class="doc-grid__planning">' + esc(row[1 + period]) + '</span>', [])
            : marks.cell(['is-teaching'], '<span class="doc-grid__slot">' + esc(row[1 + period]) + '</span>' + taughtNotes(project, dayType.id, period, taught),
              findingsOn(findings, taught.map((each) => each.groupId), dayType.id, period)));
        }
        return '<tr data-teacher="' + esc(teacher.id) + '">' + nameCell(row[0], '') + cells.join('') + '</tr>';
      });
    },
  }, opts);
  if (pages.length === 0) pages.push({ what, body: '<p class="doc-lead">There are no teachers yet.</p>' });
  return frame(project, { output: teacherGridOutput.id, what, pages, options: opts });
}

// ---------------------------------------------------------------- the rooms by period

// As teacherGridTable: the room, its floor (or "not in the building"), then
// a cell a period.
export function roomGridTable(project, dayTypeId) {
  return roomGridRows(project, dayTypeId).slice(1).map((row) => [row[0], row[1]].concat(row.slice(3)));
}

// The groups in each room each period of a day type, by group id, keyed as
// the file's rows are: a room of the building by its id, a room number that
// is not in the building by AWAY and the number as the file prints it. The
// file's rows come in allRooms order first, then the others.
const AWAY = '\u0000';
function roomCellGroups(project, dayTypeId) {
  const periods = project.settings.periods;
  const out = new Map();
  for (const group of project.groups) {
    effectiveSchedule(project, group.id, dayTypeId).forEach((slot, period) => {
      const resolved = resolveSlotRoom(project, slot);
      const key = resolved.room ? resolved.room.id : resolved.missing ? AWAY + resolved.text : null;
      if (key === null || period >= periods) return;
      if (!out.has(key)) out.set(key, Array.from({ length: periods }, () => []));
      out.get(key)[period].push(group.id);
    });
  }
  return out;
}

function renderRoomGrid(project, derived, options) {
  const opts = options || {};
  const words = periodWords(project.settings);
  const what = 'Rooms by ' + words.one;
  const findings = slotFindings(project);
  const rooms = allRooms(project);
  const pages = gridPages(project, what, {
    first: 'Room',
    lead: (dayType) => 'The groups in each room, each ' + words.one + ' of ' + dayType.name + '. Room numbers the schedule names that are not in the building come last.',
    empty: 'There are no rooms yet, and no group is scheduled into a room.',
    rows: (dayType, part, marks) => {
      const inCell = roomCellGroups(project, dayType.id);
      return roomGridTable(project, dayType.id).map((row, index) => {
        const room = index < rooms.length ? rooms[index] : null;
        const groupIds = inCell.get(room ? room.id : AWAY + row[0]);
        const away = row[1] === NOT_IN_BUILDING;
        const cells = [];
        for (let period = part.from; period < part.to; period += 1) {
          cells.push(marks.cell([], row[2 + period] === '' ? '' : '<span class="doc-grid__slot">' + esc(row[2 + period]) + '</span>',
            groupIds ? findingsOn(findings, groupIds[period], dayType.id, period) : []));
        }
        return '<tr' + (away ? ' class="is-away"' : '') + '>' + nameCell(row[0], row[1], { blank: room ? roomName(room, true) : '' }) + cells.join('') + '</tr>';
      });
    },
  }, opts);
  return frame(project, { output: roomGridOutput.id, what, pages, options: opts });
}

// ---------------------------------------------------------------- the outputs

export const groupsOutput = { id: 'groups', name: 'Groups', render: renderGroups };
export const teachersOutput = { id: 'teachers', name: 'Teachers', render: renderTeachers };
// The names are the preview's title; each document says the school's own word for a period.
export const teacherGridOutput = { id: 'teacher-grid', name: 'Teachers by period', render: renderTeacherGrid };
export const roomGridOutput = { id: 'room-grid', name: 'Rooms by period', render: renderRoomGrid };

export const GRIDS = [groupsOutput, teachersOutput, teacherGridOutput, roomGridOutput];

