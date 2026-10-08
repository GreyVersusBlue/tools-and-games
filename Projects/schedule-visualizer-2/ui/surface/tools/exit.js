// Exit (X): click a corridor cell on the building's edge to mark it as an
// exit (spec 4.6); click an exit to take the mark off. A cell that cannot be
// an exit is refused with the reason. A new exit's door name takes the focus
// in the Exits tab, unless a finger marked it.

import { markExit, unmarkExit } from '../../../engine/actions.js';
import { cellWords } from './words.js';

export const tool = {
  id: 'exit',
  key: 'x',
  label: 'Exit',
  name: 'Exit',
  group: 'more',
  icon: 'M4 3h8v14H4z M10 10h7 M14.5 7.5 17 10l-2.5 2.5',
  hint: 'Exit: click a corridor cell on the building\'s edge to mark an exit. Click an exit to take the mark off.',
  cursor: 'crosshair',
  onDown(ed, ev) {
    ed.gesture = { index: ev.index };
    ed.setPreview({ kind: 'cells', cells: [ev.index], as: 'corridor' });
  },
  onMove() {},
  onUp(ed, ev) {
    if (!ed.gesture) return;
    const cell = ed.gesture.index;
    ed.endGesture();
    // the press and the release are on one cell, or it is not a click
    if (ev.index !== cell) return;
    const floor = ed.floor;
    const had = floor.exits.find((exit) => exit.cell === cell);
    if (had) {
      const name = had.doorName.trim() === '' ? 'the exit' : 'the exit ' + had.doorName;
      ed.commit(unmarkExit, { floorId: floor.id, exitId: had.id }, { done: () => 'Took the mark off ' + name + ' at ' + cellWords(ev) + '.', toast: () => 'Took the mark off ' + name + '.' });
      return;
    }
    const outcome = ed.commit(markExit, { floorId: floor.id, cell }, { done: () => 'Marked an exit at ' + cellWords(ev) + '. Type its door name.' });
    if (outcome) ed.markedExit(outcome.exitId, ev);
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
