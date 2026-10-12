// The same schedule read from the other two sides: one row per teacher, or
// one row per room, a column per period. These are for reading. A cell says
// which groups are there (and, for a teacher, in which room).
//
// A cell carries the findings of the groups in it, for that period of that
// day type: the same findings, by the same key, that the Groups grid marks
// its cells from (model.js `findings`), so the three tables mark the same
// places. A marked cell has the finding's shape, its sentence as a title for
// a pointer that rests on it, and can be reached without one: with the focus
// on it the sentence is drawn beside the cell (grid.css) and is the cell's
// description, from a line under the table that `aria-describedby` names.
// The focus is the keyboard's, or a click's, or a tap's: a finger has no
// title to rest on, so a tap on a mark is how a phone reads why it is there
// (DECISIONS 2026-10-12 10:58).
//
// The marks of a table are one Tab stop between them, however many there are:
// Tab goes to the mark last visited (the first, to begin with), and from
// there Right and Left go to the next and the last mark in reading order
// (the other way about where the page reads right to left, so the arrow
// still goes the way it points), Down and Up to the nearest mark in a row
// below or above, Home and End to the first and the last. A mark has a `data-key`, so the focus is put back
// on it when the tab is drawn again (ui/schedule/index.js).

import { h, uid } from '../../components/dom.js';
import { ownDayTypes, effectiveSchedule } from '../../../engine/day-types.js';
import { periodName } from '../../../engine/bells.js';
import { teacherDays } from '../../../engine/teacher-day.js';
import { allRooms, findRoom, resolveSlotRoom } from '../../../engine/schema.js';
import { roomName } from '../../../engine/findings.js';
import { collator, SEVERITY_WORDS } from '../common.js';
import { slotKeyOf } from './staged.js';
import { findingWords, worstFirst } from './words.js';

// The findings on the slots of these groups, each once, worst first.
function findingsOf(findings, groupIds, dayTypeId, period) {
  const found = new Map();
  for (const groupId of groupIds) {
    for (const finding of (findings && findings.get(slotKeyOf(groupId, dayTypeId, period))) || []) found.set(finding.id, finding);
  }
  return worstFirst(Array.from(found.values()));
}

// Which mark a key goes to from mark `from`: an index into `marks`, each
// { cell, r, c } in reading order; `from` itself when there is none that way;
// null for a key that is not one of these.
function markFor(marks, from, key, rtl) {
  const at = marks[from];
  const next = rtl ? 'ArrowLeft' : 'ArrowRight';
  const last = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === next) return Math.min(from + 1, marks.length - 1);
  if (key === last) return Math.max(from - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return marks.length - 1;
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null;
  const down = key === 'ArrowDown';
  let best = from;
  marks.forEach((mark, index) => {
    if (down ? mark.r <= at.r : mark.r >= at.r) return;
    const near = [Math.abs(mark.r - at.r), Math.abs(mark.c - at.c)];
    const held = best === from ? null : [Math.abs(marks[best].r - at.r), Math.abs(marks[best].c - at.c)];
    if (!held || near[0] < held[0] || (near[0] === held[0] && near[1] < held[1])) best = index;
  });
  return best;
}

// Put the sentence of the mark in focus where it can be read, inside the
// frame the table scrolls in: under the cell from its left edge, moved along
// when that would run past the frame's right; over the cell when there is no
// room under it; and when there is room neither way (a table of a row or
// two), against the frame's bottom, over part of the cell. A sentence taller
// than the frame (two findings with long names, in a table of one row) is
// made as wide as the frame lets it be, which makes it shorter; and if it is
// still the taller, the frame is given the height to hold it for as long as
// the mark has the focus. grid.css draws it (a ::after) and reads `--why-x`,
// `--why-y` and `--why-w`, from the cell's own corner.
function placeWhy(cell, frame) {
  cell.style.removeProperty('--why-x');
  cell.style.removeProperty('--why-y');
  cell.style.removeProperty('--why-w');
  frame.style.removeProperty('min-height');
  const drawn = getComputedStyle(cell, '::after');
  if (drawn.content === 'none') return;
  let height = parseFloat(drawn.height);
  if (height > frame.clientHeight) {
    cell.style.setProperty('--why-w', Math.max(0, frame.clientWidth - 2) + 'px');
    height = parseFloat(drawn.height);
    if (height > frame.clientHeight) frame.style.minHeight = Math.ceil(height + frame.offsetHeight - frame.clientHeight) + 'px';
  }
  const width = parseFloat(drawn.width);
  const at = cell.getBoundingClientRect();
  const around = frame.getBoundingClientRect();
  const left = around.left + frame.clientLeft;
  const top = around.top + frame.clientTop;
  const bottom = top + frame.clientHeight;
  const x = Math.max(left, Math.min(at.left + cell.clientLeft, left + frame.clientWidth - width));
  let y = at.bottom;
  if (y + height > bottom) y = at.top - height >= top ? at.top - height : Math.max(top, bottom - height);
  cell.style.setProperty('--why-x', Math.round(x - at.left - cell.clientLeft) + 'px');
  cell.style.setProperty('--why-y', Math.round(y - at.top - cell.clientTop) + 'px');
}

// rows: [{ id, name, free, cell(dayTypeId, period) → { text, findings } }]
function shell(project, caption, first, rows) {
  const days = ownDayTypes(project);
  const periods = project.settings.periods;
  // one line for each finding, however many cells it is on
  const lines = new Map();
  const lineFor = (finding) => {
    if (!lines.has(finding.id)) lines.set(finding.id, h('p', { id: uid('grid-why') }, findingWords([finding])));
    return lines.get(finding.id).id;
  };
  const marks = [];
  const cellOf = (row, r, dayTypeId, c, period) => {
    const { text, findings } = row.cell(dayTypeId, period);
    const cell = h('td', { class: 'grd-cell grd-cell--read' + (text === '' ? ' is-free' : '') }, text === '' ? h('span', { class: 'vh' }, row.free) : text);
    if (findings.length === 0) return cell;
    const worst = findings[0].severity;
    const words = findingWords(findings);
    cell.classList.add('is-marked');
    cell.dataset.severity = worst;
    cell.dataset.why = words;
    cell.title = words;
    // the first mark is the table's Tab stop until another is visited
    cell.tabIndex = marks.length === 0 ? 0 : -1;
    cell.dataset.key = 'grid-read:' + row.id + ':' + dayTypeId + ':' + period;
    marks.push({ cell, r, c });
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
    h('tbody', null, rows.map((row, r) => h('tr', { class: 'grd-row' },
      h('th', { scope: 'row', class: 'grd-cell grd-cell--name' }, h('span', { class: 'grd-cell__text' }, row.name)),
      days.map((dayType, d) => Array.from({ length: periods }, (unused, period) => cellOf(row, r, dayType.id, d * periods + period, period)))))));
  const markOf = (node) => marks.findIndex((mark) => mark.cell === node);
  // a region that scrolls sideways has to be reachable by keyboard
  const frame = h('div', { class: 'grd-scroll', tabindex: '0', role: 'region', 'aria-label': caption }, table, h('div', { class: 'vh grd-why' }, Array.from(lines.values())));
  // the mark that has the focus, or null
  const inFocus = () => {
    const at = markOf(document.activeElement);
    return at === -1 ? null : marks[at].cell;
  };
  // the Tab stop goes with the focus, however the focus got there
  table.addEventListener('focusin', (event) => {
    if (markOf(event.target) === -1) return;
    for (const mark of marks) mark.cell.tabIndex = mark.cell === event.target ? 0 : -1;
    placeWhy(event.target, frame);
  });
  table.addEventListener('focusout', () => frame.style.removeProperty('min-height'));
  // A click or a tap on a mark gives it the focus, and with it the sentence.
  // (A browser does that itself for most pointers; not every one does for a
  // finger on a cell that is not a control.)
  table.addEventListener('click', (event) => {
    const cell = event.target.closest ? event.target.closest('.is-marked') : null;
    if (cell && markOf(cell) !== -1 && document.activeElement !== cell) cell.focus();
  });
  // The sentence is placed by measurement, so it is placed again when what
  // was measured moves: the frame scrolled, or changed size with the window.
  const again = () => {
    const cell = inFocus();
    if (cell) placeWhy(cell, frame);
  };
  frame.addEventListener('scroll', again, { passive: true });
  if (typeof ResizeObserver === 'function') {
    let width = null;
    new ResizeObserver(() => {
      // its own change of height (made to hold a tall sentence) is not news
      if (frame.clientWidth === width) return;
      width = frame.clientWidth;
      again();
    }).observe(frame);
  }
  table.addEventListener('keydown', (event) => {
    const from = markOf(event.target);
    if (from === -1 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const to = markFor(marks, from, event.key, getComputedStyle(table).direction === 'rtl');
    if (to === null) return;
    event.preventDefault();
    marks[to].cell.focus();
  });
  return frame;
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
    id: teacher.id,
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
    id: room.id,
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
