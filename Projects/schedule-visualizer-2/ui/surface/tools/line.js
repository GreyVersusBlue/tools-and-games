// Line (L): a straight corridor for a long hall. Click where it starts, then
// where it ends; or drag from one to the other. Escape forgets the start.

import { paintCorridor } from '../../../engine/actions.js';
import { lineCells } from '../../../engine/building.js';
import { count, replaced, cellWords, capital } from './words.js';

const START = 'Line: click where a straight corridor starts, then where it ends.';
const END = 'Line: now click where the corridor ends. Esc forgets the start.';

function show(ed, from, to) {
  ed.setPreview({ kind: 'cells', cells: lineCells(ed.floor, from, to), as: 'corridor' });
}

function complete(ed, from, to) {
  ed.toolState.anchor = null;
  ed.endGesture();
  ed.setHint(START);
  ed.commit(paintCorridor, { floorId: ed.floor.id, from, to }, {
    done: (outcome) => 'Painted a straight corridor of ' + count(outcome.cells.length, 'cell') + replaced(outcome) + '.',
    same: 'That is corridor already.',
  });
}

export const tool = {
  id: 'line',
  key: 'l',
  label: 'Line',
  name: 'Line',
  group: 'more',
  icon: 'M4 16 16 4 M2.5 14.5h3v3h-3z M14.5 2.5h3v3h-3z',
  hint: START,
  cursor: 'crosshair',
  onDown(ed, ev) {
    const anchor = ed.toolState.anchor;
    ed.gesture = { from: ev.index };
    show(ed, anchor === null || anchor === undefined ? ev.index : anchor, ev.index);
  },
  onMove(ed, ev) {
    if (!ed.gesture) return;
    const anchor = ed.toolState.anchor;
    show(ed, anchor === null || anchor === undefined ? ed.gesture.from : anchor, ev.index);
  },
  onUp(ed, ev) {
    if (!ed.gesture) return;
    const anchor = ed.toolState.anchor;
    const from = ed.gesture.from;
    if (anchor !== null && anchor !== undefined) complete(ed, anchor, ev.index);
    else if (ev.index !== from) complete(ed, from, ev.index);
    else {
      // a click: the line starts here
      ed.gesture = null;
      ed.toolState.anchor = ev.index;
      ed.setPreview({ kind: 'anchor', cell: ev.index });
      ed.setHint(END);
      ed.say(capital('the line starts at ' + cellWords(ev) + '. Pick where it ends.'));
    }
  },
  // The pointer or the cursor moved with nothing pressed: the line follows.
  onHover(ed, ev) {
    const anchor = ed.toolState.anchor;
    if (anchor === null || anchor === undefined || !ev) return;
    show(ed, anchor, ev.index);
  },
  onCancel(ed) {
    ed.endGesture();
    const anchor = ed.toolState.anchor;
    if (anchor !== null && anchor !== undefined) ed.setPreview({ kind: 'anchor', cell: anchor });
  },
  // Escape, another tool, another floor: forget the start.
  onLeave(ed) {
    const had = ed.toolState.anchor !== null && ed.toolState.anchor !== undefined;
    ed.toolState.anchor = null;
    ed.endGesture();
    ed.setHint(START);
    return had;
  },
};
