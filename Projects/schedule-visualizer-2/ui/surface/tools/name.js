// Name (N): give a run of corridor cells a name in one action (spec 4.3).
// Drag along the corridor, then type the name; a click names the straight
// run of corridor through that cell. The name is drawn along the cells.
// An empty name takes a name off.

import { lineCells } from '../../../engine/building.js';
import { CELL_CORRIDOR } from '../../../engine/schema.js';
import { nameCells, corridorRun } from '../../building/menu.js';
import { count } from './words.js';

function extend(ed, ev) {
  const gesture = ed.gesture;
  if (!gesture) return;
  if (ev.index !== gesture.last) {
    for (const cell of lineCells(ed.floor, gesture.last, ev.index)) gesture.cells.add(cell);
    gesture.last = ev.index;
  }
  const cells = Array.from(gesture.cells).filter((cell) => ed.floor.cells[cell] === CELL_CORRIDOR);
  ed.setPreview({ kind: 'cells', cells, as: 'corridor' });
  ed.pending('Name: ' + count(cells.length, 'corridor cell'));
}

export const tool = {
  id: 'name',
  key: 'n',
  label: 'Name',
  name: 'Name',
  group: 'more',
  icon: 'M3 7h14v6H3z M6 10h8',
  hint: 'Name: drag along a corridor, then type its name. A click names the whole straight run through that cell.',
  cursor: 'crosshair',
  onDown(ed, ev) {
    ed.gesture = { cells: new Set([ev.index]), last: ev.index, first: ev.index };
    extend(ed, ev);
  },
  onMove: extend,
  async onUp(ed, ev) {
    if (!ed.gesture) return;
    extend(ed, ev);
    const gesture = ed.gesture;
    const floor = ed.floor;
    ed.endGesture();
    let cells = Array.from(gesture.cells).filter((cell) => floor.cells[cell] === CELL_CORRIDOR);
    // a click: the whole straight run through the cell
    if (gesture.cells.size === 1 && cells.length === 1) cells = corridorRun(floor, gesture.first);
    if (cells.length === 0) {
      ed.say('There is no corridor there to name. Drag along corridor cells.');
      return;
    }
    // the cells stay marked while the name is asked for
    ed.setPreview({ kind: 'cells', cells, as: 'corridor' });
    try {
      await nameCells(ed, cells);
    } finally {
      ed.setPreview(null);
    }
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
