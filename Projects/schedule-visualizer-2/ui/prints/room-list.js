// The room list on paper: every room of the building, or of one floor, with
// what the building editor's sortable list shows: number, floor, teacher,
// subject, capacity, shared.
//
// render(project, derived, options) → { title, html }
//   options.floorId  a floor's id, or 'all' (the default)
//   options.sort     { column, direction }: a column id of ROOM_COLUMNS and
//                    'ascending' or 'descending'. Left out, the rooms come
//                    floor by floor in the building's order, by number.
//   and what every output takes (document.js)

import { compareValues } from '../components/table.js';
import { count } from '../components/words.js';
import { esc, frame } from './document.js';

export const id = 'room-list';
export const name = 'Room list';

export const ROOM_COLUMNS = [
  { id: 'number', label: 'Room', value: (row) => row.number },
  { id: 'floor', label: 'Floor', value: (row) => row.floorIndex, shown: (row) => row.floor },
  { id: 'teacher', label: 'Teacher', value: (row) => row.teachers.join(', ') },
  { id: 'subject', label: 'Subject', value: (row) => row.subject },
  { id: 'capacity', label: 'Capacity', numeric: true, value: (row) => (row.capacity === null ? -1 : row.capacity), shown: (row) => (row.capacity === null ? '' : String(row.capacity)) },
  { id: 'shared', label: 'Shared', value: (row) => (row.shared ? 0 : 1), shown: (row) => (row.shared ? 'Shared' : '') },
];

// One row per room, in the building's own order. Every text is as typed.
export function roomRows(project, floorId) {
  const rows = [];
  project.building.floors.forEach((floor, floorIndex) => {
    if (floorId && floorId !== 'all' && floor.id !== floorId) return;
    for (const space of floor.spaces) {
      if (space.kind !== 'room') continue;
      const subject = space.subjectId ? project.subjects.find((candidate) => candidate.id === space.subjectId) : null;
      rows.push({
        id: space.id,
        number: typeof space.number === 'string' ? space.number : '',
        floor: floor.name,
        floorIndex,
        teachers: space.teacherIds.map((teacherId) => project.teachers.find((teacher) => teacher.id === teacherId)).filter(Boolean).map((teacher) => teacher.name),
        subject: subject ? subject.name : '',
        capacity: Number.isInteger(space.capacity) ? space.capacity : null,
        shared: space.shared === true,
      });
    }
  });
  return rows;
}

export function sortRoomRows(rows, sort) {
  const column = sort && ROOM_COLUMNS.find((candidate) => candidate.id === sort.column);
  const sign = sort && sort.direction === 'descending' ? -1 : 1;
  const byNumber = (a, b) => compareValues(a.number, b.number);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (column
      ? sign * compareValues(column.value(a.row), column.value(b.row)) || byNumber(a.row, b.row) || a.index - b.index
      : a.row.floorIndex - b.row.floorIndex || byNumber(a.row, b.row) || a.index - b.index))
    .map((entry) => entry.row);
}

export function render(project, derived, options) {
  const opts = options || {};
  const floors = project.building.floors;
  const one = opts.floorId && opts.floorId !== 'all' ? floors.find((floor) => floor.id === opts.floorId) : null;
  const rows = sortRoomRows(roomRows(project, one ? one.id : 'all'), opts.sort);
  const where = one ? 'on ' + one.name : floors.length === 1 ? 'in the building' : 'on ' + count(floors.length, 'floor');
  const lead = rows.length === 0
    ? 'There are no rooms ' + where + ' yet.'
    : (rows.length === 1 ? 'There is 1 room ' : 'There are ' + rows.length + ' rooms ') + where + '.';

  const body = ['<p class="doc-lead">' + esc(lead) + '</p>'];
  if (rows.length > 0) {
    body.push('<table class="doc-table doc-table--rooms">');
    body.push('<thead><tr>' + ROOM_COLUMNS.map((column) => '<th scope="col"' + (column.numeric ? ' class="is-number"' : '') + '>' + esc(column.label) + '</th>').join('') + '</tr></thead>');
    body.push('<tbody>');
    for (const row of rows) {
      body.push('<tr>' + ROOM_COLUMNS.map((column) => {
        const shown = column.shown ? column.shown(row) : String(column.value(row));
        if (column.id === 'number') {
          return row.number.trim() === ''
            ? '<th scope="row" class="is-missing">No number</th>'
            : '<th scope="row">' + esc(row.number) + '</th>';
        }
        return '<td' + (column.numeric ? ' class="is-number"' : '') + '>' + esc(shown) + '</td>';
      }).join('') + '</tr>');
    }
    body.push('</tbody></table>');
  }
  return frame(project, { output: id, what: one ? name + ': ' + one.name : name, pages: [{ body: body.join('\n') }], options: opts });
}
