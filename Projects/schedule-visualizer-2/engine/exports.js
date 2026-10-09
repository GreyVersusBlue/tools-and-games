// Every CSV and JSON export, as text. FORMATS.md has each layout.
//
//   buildExport(project, kind, options) → { fileName, mime, text }
//
// `kind` is one of EXPORT_KINDS. The page turns the result into a download
// and does nothing else to it. options: { date, guard, images, dayTypeId }.
//
// The CSV exports are tables: a `…Rows(project)` function returns the rows
// (a list of lists of cells) and `csvText` writes them. They start with a
// byte-order mark and end lines with CRLF, which is what a spreadsheet opens
// cleanly whatever script the names are in.
//
// All text is data. A name is written exactly as typed, so a file read back
// gives the same names. `guard: true` puts a single quote in front of any
// cell a spreadsheet would run as a formula (one starting = + - or @); it is
// off unless asked for, because it changes such a name.

import { write } from './csv.js';
import { allRooms, floorOfRoom, resolveSlotRoom } from './schema.js';
import { periodName } from './bells.js';
import { effectiveSchedule } from './day-types.js';
import { teacherDays } from './teacher-day.js';
import { writeProjectFile, writeBuildingFile, writeScheduleFile } from './project-file.js';

export const EXPORT_KINDS = ['groups', 'groups-template', 'teachers', 'rooms', 'teacher-grid', 'room-grid', 'schedule', 'building', 'project', 'subjects'];

export const NOT_IN_BUILDING = 'not in the building';
export const PLANNING = 'Planning';
const LIST_SEPARATOR = '; ';
const TOOL_NAME = 'Schedule Visualizer 2';

export function csvText(rows, options) {
  return write(rows, { eol: '\r\n', bom: true, guard: Boolean(options && options.guard) });
}

// ---------------------------------------------------------------- groups

// The header of the groups CSV, and of the template: the four group columns,
// then every period of every day type. With one day type the period columns
// are "Period 1"; with more they are "A Day Period 1".
export function groupsHeader(project) {
  const header = ['Group', 'Grade', 'Head count', 'Colour'];
  const many = project.dayTypes.length > 1;
  for (const dayType of project.dayTypes) {
    for (let period = 0; period < project.settings.periods; period += 1) {
      header.push((many ? dayType.name + ' ' : '') + periodName(project.settings, period));
    }
  }
  return header;
}

// The template is the header alone: fill in a row for each group.
export function templateRows(project) {
  return [groupsHeader(project)];
}

function slotText(project, slot) {
  const resolved = resolveSlotRoom(project, slot);
  return resolved.text;
}

// One row per group. A cell is the room's number. A day type that is the
// same as the first has empty cells, so reading the file back leaves it so.
export function groupsRows(project) {
  const rows = [groupsHeader(project)];
  for (const group of project.groups) {
    const row = [group.name, group.grade, group.headCount === null ? '' : String(group.headCount), group.colour];
    project.dayTypes.forEach((dayType, index) => {
      const day = index === 0 || dayType.own ? group.days[dayType.id] : null;
      for (let period = 0; period < project.settings.periods; period += 1) row.push(day && day[period] ? slotText(project, day[period]) : '');
    });
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- teachers and rooms

function subjectOf(project, subjectId) {
  return project.subjects.find((subject) => subject.id === subjectId) || { code: '', name: '' };
}

export function teachersRows(project) {
  const rows = [['Teacher', 'Subject code', 'Subject', 'Rooms', 'Notes']];
  const numbers = new Map(allRooms(project).map((room) => [room.id, room.number]));
  for (const teacher of project.teachers) {
    const subject = subjectOf(project, teacher.subjectId);
    rows.push([teacher.name, subject.code, subject.name, teacher.roomIds.map((id) => numbers.get(id) || '').join(LIST_SEPARATOR), teacher.notes]);
  }
  return rows;
}

export function roomsRows(project) {
  const rows = [['Room', 'Floor', 'Teachers', 'Subject code', 'Subject', 'Wing', 'Capacity', 'Shared space', 'Doors']];
  const names = new Map(project.teachers.map((teacher) => [teacher.id, teacher.name]));
  for (const floor of project.building.floors) {
    for (const space of floor.spaces) {
      if (space.kind !== 'room') continue;
      const subject = subjectOf(project, space.subjectId);
      rows.push([
        space.number,
        floor.name,
        space.teacherIds.map((id) => names.get(id) || '').join(LIST_SEPARATOR),
        subject.code,
        subject.name,
        space.wing,
        space.capacity === null ? '' : String(space.capacity),
        space.shared ? 'Yes' : 'No',
        String(space.doors.length),
      ]);
    }
  }
  return rows;
}

// The subject list, in its order. import-subjects.js reads this file back.
export function subjectsRows(project) {
  const rows = [['Code', 'Subject', 'Colour']];
  for (const subject of project.subjects) rows.push([subject.code, subject.name, subject.colour]);
  return rows;
}

// ---------------------------------------------------------------- the grids

function gridHeader(project, first) {
  const header = first.concat(['Day type']);
  for (let period = 0; period < project.settings.periods; period += 1) header.push(periodName(project.settings, period));
  return header;
}

function chosenDayTypes(project, dayTypeId) {
  if (dayTypeId === undefined || dayTypeId === null) return project.dayTypes;
  return project.dayTypes.filter((dayType) => dayType.id === dayTypeId);
}

// Teachers down, periods across, one row per teacher per day type. A cell is
// "7-1 · 204" for each group taught, or "Planning". The day is the one rule
// in teacher-day.js; a day type that is the same as the first reads the same.
export function teacherGridRows(project, dayTypeId) {
  const rows = [gridHeader(project, ['Teacher'])];
  for (const dayType of chosenDayTypes(project, dayTypeId)) {
    const days = teacherDays(project, dayType.id);
    for (const teacher of project.teachers) {
      const row = [teacher.name, dayType.name];
      for (const entry of days.get(teacher.id)) {
        if (entry.kind !== 'teaching') {
          row.push(PLANNING);
          continue;
        }
        row.push(entry.groups.map((taught) => {
          const group = project.groups.find((candidate) => candidate.id === taught.groupId);
          const slot = effectiveSchedule(project, taught.groupId, dayType.id)[entry.period];
          const where = slotText(project, slot);
          return where === '' ? group.name : group.name + ' · ' + where;
        }).join(LIST_SEPARATOR));
      }
      rows.push(row);
    }
  }
  return rows;
}

// Rooms down, periods across, one row per room per day type. A cell lists
// the groups in the room. Room numbers that groups are scheduled into and
// that are not in the building come last, marked so in the Floor column.
export function roomGridRows(project, dayTypeId) {
  const rows = [gridHeader(project, ['Room', 'Floor'])];
  const periods = project.settings.periods;
  for (const dayType of chosenDayTypes(project, dayTypeId)) {
    const inRoom = new Map();
    const elsewhere = new Map();
    for (const group of project.groups) {
      const day = effectiveSchedule(project, group.id, dayType.id);
      for (let period = 0; period < periods; period += 1) {
        const resolved = resolveSlotRoom(project, day[period]);
        let cells;
        if (resolved.room) {
          if (!inRoom.has(resolved.room.id)) inRoom.set(resolved.room.id, Array.from({ length: periods }, () => []));
          cells = inRoom.get(resolved.room.id);
        } else if (resolved.missing) {
          if (!elsewhere.has(resolved.text)) elsewhere.set(resolved.text, Array.from({ length: periods }, () => []));
          cells = elsewhere.get(resolved.text);
        } else {
          continue;
        }
        cells[period].push(group.name);
      }
    }
    const line = (first, cells) => first.concat([dayType.name], Array.from({ length: periods }, (unused, period) => (cells ? cells[period].join(LIST_SEPARATOR) : '')));
    for (const room of allRooms(project)) rows.push(line([room.number, floorOfRoom(project, room.id).name], inRoom.get(room.id)));
    for (const [text, cells] of elsewhere) rows.push(line([text, NOT_IN_BUILDING], cells));
  }
  return rows;
}

// ---------------------------------------------------------------- file names

// "Marrowby Middle School - groups - 2026-09-01.csv". `date` is a Date (its
// local day is used) or "YYYY-MM-DD". Characters a file system refuses are
// left out of the school's name; the name inside the file is untouched.
export function exportFileName(project, what, extension, date) {
  let day = '';
  if (typeof date === 'string') day = date;
  else if (date instanceof Date) day = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const school = String(project.settings.schoolName).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80).trim();
  return [school === '' ? TOOL_NAME : school, what, day].filter((part) => part !== '').join(' - ') + '.' + extension;
}

const CSV = 'text/csv';
const JSON_TYPE = 'application/json';

const BUILDERS = {
  groups: { what: 'groups', extension: 'csv', mime: CSV, text: (project, options) => csvText(groupsRows(project), options) },
  'groups-template': { what: 'groups template', extension: 'csv', mime: CSV, text: (project, options) => csvText(templateRows(project), options) },
  teachers: { what: 'teachers', extension: 'csv', mime: CSV, text: (project, options) => csvText(teachersRows(project), options) },
  subjects: { what: 'subjects', extension: 'csv', mime: CSV, text: (project, options) => csvText(subjectsRows(project), options) },
  rooms: { what: 'rooms', extension: 'csv', mime: CSV, text: (project, options) => csvText(roomsRows(project), options) },
  'teacher-grid': { what: 'teachers by period', extension: 'csv', mime: CSV, text: (project, options) => csvText(teacherGridRows(project, options.dayTypeId), options) },
  'room-grid': { what: 'rooms by period', extension: 'csv', mime: CSV, text: (project, options) => csvText(roomGridRows(project, options.dayTypeId), options) },
  schedule: { what: 'schedule', extension: 'json', mime: JSON_TYPE, text: (project) => writeScheduleFile(project) },
  building: { what: 'building', extension: 'json', mime: JSON_TYPE, text: (project, options) => writeBuildingFile(project, { images: options.images }) },
  project: { what: 'project', extension: 'json', mime: JSON_TYPE, text: (project, options) => writeProjectFile(project, { images: options.images }) },
};

export function buildExport(project, kind, options) {
  const builder = BUILDERS[kind];
  if (!builder) throw new TypeError('An export is one of: ' + EXPORT_KINDS.join(', ') + '.');
  const opts = options || {};
  return { fileName: exportFileName(project, builder.what, builder.extension, opts.date), mime: builder.mime, text: builder.text(project, opts) };
}
