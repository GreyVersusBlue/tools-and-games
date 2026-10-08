// Select (V). Click a room or other space to select it and see its
// properties; drag it to move it, with everything else selected. Shift-click
// adds or takes away one; a drag with Shift held, or one that starts on a
// corridor, draws a box and selects what it touches. A drag that starts on
// empty floor moves the map (DESIGN 5.1), and a click there selects nothing.
//
// From the keyboard: Enter selects what the cursor is on; Shift and the
// arrows move it when the cursor is on a space, and draw a box when it is not.

import { moveSpaces } from '../../../engine/actions.js';
import { moveSpaces as tryMove, BuildingError } from '../../../engine/building.js';
import { cellKind } from '../../../engine/schema.js';
import { count, shiftWords, capital, replaced, nameOf } from './words.js';

// A finger can grab a selection from this far outside it (DESIGN 6).
export const HANDLE_MARGIN = 40;

function names(ed, ids) {
  if (ids.length !== 1) return count(ids.length, 'space');
  return nameOf(ed.floor.spaces.find((each) => each.id === ids[0]));
}

function boxOf(gesture, ev) {
  const x = Math.min(gesture.x, ev.x);
  const y = Math.min(gesture.y, ev.y);
  return { x, y, w: Math.abs(ev.x - gesture.x) + 1, h: Math.abs(ev.y - gesture.y) + 1 };
}

function inBox(ed, rect) {
  const width = ed.floor.width;
  return ed.floor.spaces.filter((space) => space.cells.some((cell) => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
  })).map((space) => space.id);
}

function blocked(ed, ids, dx, dy) {
  try {
    tryMove(ed.project.building, { spaceIds: ids, dx, dy });
    return false;
  } catch (error) {
    if (error instanceof BuildingError) return true;
    throw error;
  }
}

export const tool = {
  id: 'select',
  key: 'v',
  label: 'Select',
  name: 'Select',
  group: 'main',
  icon: 'M5 3v13l3.5-3.5 2.5 5 2-1-2.5-5H15z',
  hint: 'Select: click a room to select it, drag it to move it. Shift and a drag selects several. A drag on empty floor moves the map.',
  cursor: 'default',
  onDown(ed, ev) {
    const keyboard = ev.source === 'keyboard';
    const space = ed.spaceAt(ev.index);
    if (ev.shift && !keyboard) {
      ed.gesture = { mode: 'box', x: ev.x, y: ev.y, add: true, hit: space ? space.id : null, moved: false };
      return undefined;
    }
    const grabbed = space || (ev.pointerType === 'touch' && ed.nearSelection(ev.sx, ev.sy, HANDLE_MARGIN) ? 'selection' : null);
    if (grabbed) {
      if (space && !ed.selection.includes(space.id)) {
        ed.select([space.id]);
        ed.say('Selected ' + nameOf(space) + '.');
      }
      ed.gesture = { mode: 'move', x: ev.x, y: ev.y, ids: ed.selection.slice(), dx: 0, dy: 0 };
      return undefined;
    }
    if (keyboard && !ev.shift) {
      if (ed.selection.length > 0) ed.say('Nothing is selected.');
      ed.select([]);
      return false;
    }
    if (!keyboard && cellKind(ed.floor, ev.index) === 'empty') return 'pan';
    ed.gesture = { mode: 'box', x: ev.x, y: ev.y, add: false, hit: null, moved: false };
    return undefined;
  },
  onMove(ed, ev) {
    const gesture = ed.gesture;
    if (!gesture) return;
    if (gesture.mode === 'move') {
      gesture.dx = ev.x - gesture.x;
      gesture.dy = ev.y - gesture.y;
      if (gesture.dx === 0 && gesture.dy === 0) ed.setPreview(null);
      else ed.setPreview({ kind: 'move', ids: gesture.ids, dx: gesture.dx, dy: gesture.dy, blocked: blocked(ed, gesture.ids, gesture.dx, gesture.dy) });
      ed.pending('Move ' + names(ed, gesture.ids) + (gesture.dx === 0 && gesture.dy === 0 ? '' : ' ' + shiftWords(gesture.dx, gesture.dy)));
      return;
    }
    if (ev.x !== gesture.x || ev.y !== gesture.y) gesture.moved = true;
    if (gesture.moved) ed.setPreview({ kind: 'rect', rect: boxOf(gesture, ev), as: 'box' });
  },
  onUp(ed, ev) {
    const gesture = ed.gesture;
    if (!gesture) return;
    ed.endGesture();
    if (gesture.mode === 'move') {
      const dx = ev.x - gesture.x;
      const dy = ev.y - gesture.y;
      if (dx === 0 && dy === 0) return;
      ed.commit(moveSpaces, { spaceIds: gesture.ids, dx, dy }, {
        done: (outcome) => 'Moved ' + names(ed, gesture.ids) + ' ' + shiftWords(dx, dy) + replaced(outcome).replace(', replaced ', ', which took away ') + '.',
      });
      return;
    }
    if (!gesture.moved) {
      // a click with Shift: one more, or one fewer
      if (gesture.hit) {
        const had = ed.selection.includes(gesture.hit);
        ed.select(had ? ed.selection.filter((id) => id !== gesture.hit) : ed.selection.concat([gesture.hit]));
        ed.say(capital(count(ed.selection.length, 'space')) + ' selected.');
      } else if (!gesture.add) {
        ed.select([]);
      }
      return;
    }
    const found = inBox(ed, boxOf(gesture, ev));
    const next = gesture.add ? Array.from(new Set(ed.selection.concat(found))) : found;
    ed.select(next);
    ed.say(next.length === 0 ? 'Nothing is selected.' : capital(count(next.length, 'space')) + ' selected.');
  },
  // A click on empty floor (the drag that never moved): nothing is selected.
  onTap(ed) {
    if (ed.selection.length === 0) return;
    ed.select([]);
    ed.say('Nothing is selected.');
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
