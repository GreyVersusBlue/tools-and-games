// Eraser (E): click or drag over what to remove. A corridor or stairs cell
// goes. A room or other space that the drag covered only part of is asked
// about first: the whole of it, or only those cells (spec 4.3). The whole is
// the first answer. Whatever the answer, it is one action.

import { eraseCells, describeErase } from '../../../engine/actions.js';
import { lineCells, lossText } from '../../../engine/building.js';
import { cellKind } from '../../../engine/schema.js';
import { h } from '../../components/dom.js';
import { count, capital } from './words.js';

function extend(ed, ev) {
  const gesture = ed.gesture;
  if (!gesture) return;
  if (ev.index !== gesture.last) {
    for (const cell of lineCells(ed.floor, gesture.last, ev.index)) gesture.cells.add(cell);
    gesture.last = ev.index;
  }
  ed.setPreview({ kind: 'cells', cells: Array.from(gesture.cells), as: 'erase' });
  ed.pending('Eraser: ' + count(gesture.cells.size, 'cell'));
}

// What is scheduled into the rooms an erase would take, as a sentence, or ''.
function scheduled(part) {
  if (part.slots === 0) return '';
  const rooms = part.removedRooms.length === 1 ? 'it' : 'them';
  return count(part.groups, 'group') + (part.groups === 1 ? ' is' : ' are') + ' scheduled into ' + rooms + ' for ' + count(part.slots, 'period') + '. Those periods will say the room is not in the building until you change them.';
}

async function ask(ed, described) {
  const partial = described.spaces.filter((space) => space.cells < space.of);
  const one = partial.length === 1 ? partial[0] : null;
  const hit = partial.reduce((sum, space) => sum + space.cells, 0);
  const these = hit === 1 ? 'this cell' : 'these ' + hit + ' cells';
  const title = one ? 'Erase all of ' + one.name + ', or only ' + these + '?' : 'Erase all of these ' + partial.length + ' spaces, or only the cells you went over?';
  const body = [one ? capital(one.name) + ' covers ' + count(one.of, 'cell') + '.' : 'The eraser went over part of ' + partial.map((space) => space.name).join(', ') + '.'];
  const warn = scheduled(described.whole);
  if (warn !== '') body.push(warn);
  const dialog = ed.ctx.openDialog({
    id: 'erase-dialog',
    title,
    body: body.map((line) => h('p', null, line)),
    opener: ed.canvas,
    buttons: [
      { label: one ? 'Erase all of ' + one.name : 'Erase all of them', value: 'whole', kind: 'danger' },
      { label: 'Erase only ' + these, value: 'cells' },
      { label: 'Erase nothing', value: null },
    ],
  });
  return dialog.closed;
}

export const tool = {
  id: 'eraser',
  key: 'e',
  label: 'Eraser',
  name: 'Eraser',
  group: 'main',
  icon: 'M8.5 16 4 11.5 11.5 4l5 5-7 7z M8 16h9 M7.5 8l5 5',
  hint: 'Eraser: click or drag over what to remove. Part of a room asks whether to take the whole room.',
  cursor: 'crosshair',
  onDown(ed, ev) {
    ed.gesture = { cells: new Set([ev.index]), last: ev.index };
    extend(ed, ev);
  },
  onMove: extend,
  async onUp(ed, ev) {
    if (!ed.gesture) return;
    extend(ed, ev);
    const cells = Array.from(ed.gesture.cells);
    const floor = ed.floor;
    ed.endGesture();
    if (!cells.some((cell) => cellKind(floor, cell) !== 'empty')) {
      ed.say('Nothing to erase there.');
      return;
    }
    const payload = { floorId: floor.id, cells };
    const described = ed.attempt(() => describeErase(ed.project, payload));
    if (!described) return;
    let whole = true;
    if (described.ambiguous) {
      // keep the cells marked while the question is open
      ed.setPreview({ kind: 'cells', cells, as: 'erase' });
      const answer = await ask(ed, described);
      ed.setPreview(null);
      if (answer === null) {
        ed.say('Erased nothing.');
        return;
      }
      whole = answer === 'whole';
    }
    const part = whole ? described.whole : described.cellsOnly;
    const warn = scheduled(part);
    ed.commit(eraseCells, { ...payload, whole }, {
      done: (outcome) => 'Erased ' + (lossText(outcome.loss) || count(cells.length, 'cell')) + '.',
      same: 'Nothing to erase there.',
      toast: warn === '' ? null : (outcome) => 'Erased ' + lossText(outcome.loss) + '. ' + capital(warn),
    });
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
