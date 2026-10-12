// The same schedule read from the other two sides: one row per teacher, or
// one row per room, a column per period. These are for reading. A cell says
// which groups are there (and, for a teacher, in which room).
//
// A cell carries the findings of the groups in it, for that period of that
// day type: the same findings, by the same key, that the Groups grid marks
// its cells from (model.js `findings`), so the three tables mark the same
// places. A marked cell has the finding's shape, its sentence as a title for
// a pointer, and is a Tab stop so the sentence can be reached without one:
// in focus the sentence is drawn under the cell (grid.css) and is the cell's
// description, from a line under the table that `aria-describedby` names.

import { h, uid } from '../../components/dom.js';
import { ownDayTypes, effectiveSchedule } from '../../../engine/day-types.js';
import { periodName } from '../../../engine/bells.js';
import { teacherDays } from '../../../engine/teacher-day.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { collator, SEVERITY_WORDS } from '../common.js';
import { slotKeyOf } from './staged.js';

const SEVERITIES = ['problem', 'warning', 'note'];

function sentence(finding) {
  return SEVERITY_WORDS[finding.severity].one.replace(/^./, (first) => first.toUpperCase()) + ': ' + finding.text;
}

// The findings on the slots of these groups, each once, worst first.
function findingsOf(findings, groupIds, dayTypeId, period) {
  const found = new Map();
  for (const groupId of groupIds) {
    for (const finding of (findings && findings.get(slotKeyOf(groupId, dayTypeId, period))) || []) found.set(finding.id, finding);
  }
  return Array.from(found.values()).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

// rows: [{ name, free, cell(dayTypeId, period) → { text, findings } }]
function shell(project, caption, first, rows) {
  const days = ownDayTypes(project);
  const periods = project.settings.periods;
  // one line for each finding, however many cells it is on
  const lines = new Map();
  const lineFor = (finding) => {
    if (!lines.has(finding.id)) lines.set(finding.id, h('p', { id: uid('grid-why') }, sentence(finding)));
    return lines.get(finding.id).id;
  };
  const cellOf = (row, dayTypeId, period) => {
    const { text, findings } = row.cell(dayTypeId, period);
    const cell = h('td', { class: 'grd-cell grd-cell--read' + (text === '' ? ' is-free' : '') }, text === '' ? h('span', { class: 'vh' }, row.free) : text);
    if (findings.length === 0) return cell;
    const worst = findings[0].severity;
    const words = findings.map(sentence).join(' ');
    cell.classList.add('is-marked');
    cell.dataset.severity = worst;
    cell.dataset.why = words;
    cell.title = words;
    cell.tabIndex = 0;
    cell.setAttribute('aria-describedby', findings.map(lineFor).join(' '));
    cell.append(
      h('span', { class: 'grd-cell__mark sch-mark--' + worst, 'aria-hidden': 'true' }, SEVERITY_WORDS[worst].glyph),
      h('span', { class: 'vh' }, ' (' + SEVERITY_WORDS[worst].one + ')'));
    return cell;
  };
  const table = h('table', { class: 'grd-table grd-table--read' },
    h('caption', { class: 'vh' }, caption),
    h('thead', null,
      h('tr', null,
        h('th', { scope: 'col', rowspan: '2', class: 'grd-head grd-head--name' }, first),
        days.map((dayType) => h('th', { scope: 'colgroup', colspan: String(periods), class: 'grd-head grd-head--day' }, dayType.name))),
      h('tr', null, days.map(() => Array.from({ length: periods }, (unused, period) => h('th', {
        scope: 'col',
        class: 'grd-head grd-head--period' + (period === 0 ? ' grd-head--first' : ''),
      }, periodName(project.settings, period)))))),
    h('tbody', null, rows.map((row) => h('tr', { class: 'grd-row' },
      h('th', { scope: 'row', class: 'grd-cell grd-cell--name' }, h('span', { class: 'grd-cell__text' }, row.name)),
      days.map((dayType) => Array.from({ length: periods }, (unused, period) => cellOf(row, dayType.id, period)))))));
  // a region that scrolls sideways has to be reachable by keyboard
  return h('div', { class: 'grd-scroll', tabindex: '0', role: 'region', 'aria-label': caption }, table, h('div', { class: 'vh grd-why' }, Array.from(lines.values())));
}

function groupNames(project, ids) {
  return ids.map((id) => (project.groups.find((group) => group.id === id) || { name: '' }).name);
}

// One row per teacher: "7-1 in 204". `findings` is the grid model's: slot key
// to the findings on that slot.
export function teacherTable(project, findings) {
  const days = new Map(ownDayTypes(project).map((dayType) => [dayType.id, teacherDays(project, dayType.id)]));
  const numberOf = (roomId) => {
    const room = roomId ? findRoom(project, roomId) : null;
    return room ? (room.number.trim() === '' ? roomName(room) : room.number) : 'a room not in the building';
  };
  return shell(project, 'Every teacher, one row each. For reading.', 'Teacher', project.teachers.map((teacher) => ({
    name: teacher.name,
    free: 'Planning',
    cell: (dayTypeId, period) => {
      const taught = days.get(dayTypeId).get(teacher.id)[period].groups;
      return {
        text: taught.map((each) => groupNames(project, [each.groupId])[0] + ' in ' + numberOf(each.roomId)).join(', '),
        findings: findingsOf(findings, taught.map((each) => each.groupId), dayTypeId, period),
      };
    },
  })));
}

// One row per room: the groups in it.
export function roomTable(project, findings) {
  const rooms = allRooms(project).slice().sort((a, b) => collator.compare(a.number, b.number));
  const inRoom = new Map();
  for (const dayType of ownDayTypes(project)) {
    for (const group of project.groups) {
      effectiveSchedule(project, group.id, dayType.id).forEach((slot, period) => {
        const room = resolveSlotRoom(project, slot).room;
        if (!room) return;
        const key = room.id + '|' + dayType.id + '|' + period;
        if (!inRoom.has(key)) inRoom.set(key, []);
        inRoom.get(key).push(group);
      });
    }
  }
  return shell(project, 'Every room, one row each. For reading.', 'Room', rooms.map((room) => ({
    name: room.number.trim() === '' ? roomName(room, true) : room.number,
    free: 'Empty',
    cell: (dayTypeId, period) => {
      const groups = inRoom.get(room.id + '|' + dayTypeId + '|' + period) || [];
      return {
        text: groups.map((group) => group.name).join(', '),
        findings: findingsOf(findings, groups.map((group) => group.id), dayTypeId, period),
      };
    },
  })));
}
