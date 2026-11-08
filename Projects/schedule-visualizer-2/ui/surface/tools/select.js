// Select (V). Click a room or other space to select it and see its
// properties; drag it to move it, with everything else selected. Shift-click
// adds or takes away one; a drag with Shift held, or one that starts on a
// corridor, draws a box and selects what it touches. A drag that starts on
// empty floor moves the map (DESIGN 5.1), and a click there selects nothing.
//
// Doors (spec 4.4): a click on an outer edge of the one selected room adds a
// door there, and a click on a door removes it. An edge that leads nowhere is
// refused, and the refusal says why. From the keyboard a door is added from
// the cell's menu.
//
// Cells (DESIGN 13.2, 13.3): the plan's selection holds spaces only, so a click
// on an elevator stop or a corridor cell puts that cell in the Properties tab
// (focusCells), a Shift-click adds or takes away one more, and a drag that
// touches no space but some of these cells puts them all there.
//
// From the keyboard: Enter selects what the cursor is on; Shift and the
// arrows move it when the cursor is on a space, and draw a box when it is not.

import { moveSpaces, addDoor, removeDoor } from '../../../engine/actions.js';
import { moveSpaces as tryMove, BuildingError, SIDE_WORDS } from '../../../engine/building.js';
import { cellKind } from '../../../engine/schema.js';
import { focusCells, cellFocus } from '../../building/inspector/cell-focus.js';
import { count, shiftWords, capital, replaced, nameOf } from './words.js';

// A finger can grab a selection from this far outside it (DESIGN 6).
export const HANDLE_MARGIN = 40;
// A click this near an outer edge of the selected room, as a part of a cell
// (and never under 6 px), is a click on the edge: a door.
export const DOOR_REACH = 0.22;

// The outer edge of `space` that the pointer is on, or null: { cell, side }.
export function edgeAt(ed, space, ev) {
  if (ev.source !== 'pointer' || !space || space.kind !== 'room') return null;
  const at = ed.view.toCell(ev.sx, ev.sy);
  const fx = at.x - ev.x;
  const fy = at.y - ev.y;
  const reach = Math.max(DOOR_REACH, 6 / ed.view.size);
  const width = ed.floor.width;
  const inside = new Set(space.cells);
  const sides = [
    { side: 'n', far: fy, outer: !inside.has(ev.index - width) },
    { side: 's', far: 1 - fy, outer: !inside.has(ev.index + width) },
    { side: 'w', far: fx, outer: ev.x === 0 || !inside.has(ev.index - 1) },
    { side: 'e', far: 1 - fx, outer: ev.x === width - 1 || !inside.has(ev.index + 1) },
  ].filter((each) => each.outer && each.far <= reach).sort((a, b) => a.far - b.far);
  return sides.length > 0 ? { cell: ev.index, side: sides[0].side } : null;
}

function toggleDoor(ed, space, edge) {
  const where = 'on the ' + SIDE_WORDS[edge.side] + ' edge of ' + nameOf(space);
  const has = space.doors.some((door) => door.cell === edge.cell && door.side === edge.side);
  if (has) ed.commit(removeDoor, { roomId: space.id, cell: edge.cell, side: edge.side }, { done: () => 'Removed the door ' + where + '.' });
  else ed.commit(addDoor, { roomId: space.id, cell: edge.cell, side: edge.side }, { done: () => 'Added a door ' + where + '.' });
}

// Whether Properties has something to say about this cell: a corridor cell (its
// step, its name, its exit) or an elevator stop.
function marked(ed, cell) {
  const kind = cellKind(ed.floor, cell, ed.project.building);
  return kind === 'corridor' || kind === 'elevator';
}

// The cells in Properties. focusCells shows the tab; the select([]) after it is
// what makes the tab read the new cells when it was showing others already.
function showCells(ed, cells) {
  focusCells(ed, ed.floor.id, cells);
  ed.select([]);
}

function cellsIn(ed, rect) {
  const width = ed.floor.width;
  const found = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (x < width && y < ed.floor.height && marked(ed, y * width + x) && !ed.spaceAt(y * width + x)) found.push(y * width + x);
    }
  }
  return found;
}

function cellsSaid(ed, cells) {
  if (cells.length !== 1) return capital(count(cells.length, 'cell')) + ' selected.';
  return (cellKind(ed.floor, cells[0], ed.project.building) === 'elevator' ? 'Elevator stop' : 'Corridor cell') + ' selected.';
}

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
      // an edge of the room that is already the one selected: a door, if the click ends where it began
      const edge = space && ed.selection.length === 1 && ed.selection[0] === space.id ? edgeAt(ed, space, ev) : null;
      if (space && !ed.selection.includes(space.id)) {
        ed.select([space.id]);
        ed.say('Selected ' + nameOf(space) + '.');
      }
      ed.gesture = { mode: 'move', x: ev.x, y: ev.y, ids: ed.selection.slice(), dx: 0, dy: 0, edge, spaceId: space ? space.id : null };
      return undefined;
    }
    if (keyboard && !ev.shift) {
      if (marked(ed, ev.index)) {
        showCells(ed, [ev.index]);
        ed.say(cellsSaid(ed, [ev.index]));
        return false;
      }
      cellFocus(ed).clear();
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
      if (dx === 0 && dy === 0) {
        const room = gesture.edge ? ed.floor.spaces.find((each) => each.id === gesture.spaceId) : null;
        if (room) toggleDoor(ed, room, gesture.edge);
        return;
      }
      ed.commit(moveSpaces, { spaceIds: gesture.ids, dx, dy }, {
        done: (outcome) => 'Moved ' + names(ed, gesture.ids) + ' ' + shiftWords(dx, dy) + replaced(outcome).replace(', replaced ', ', which took away ') + '.',
      });
      return;
    }
    if (!gesture.moved) {
      const cell = gesture.y * ed.floor.width + gesture.x;
      // a click with Shift: one more, or one fewer
      if (gesture.hit) {
        const had = ed.selection.includes(gesture.hit);
        ed.select(had ? ed.selection.filter((id) => id !== gesture.hit) : ed.selection.concat([gesture.hit]));
        ed.say(capital(count(ed.selection.length, 'space')) + ' selected.');
      } else if (marked(ed, cell) && gesture.add && ed.selection.length > 0) {
        // Shift on a stop or a corridor cell leaves the spaces selected: the
        // tab can be about spaces or about cells, not both
        ed.say('Spaces are selected. Click the cell without Shift to see its Properties.');
      } else if (marked(ed, cell)) {
        // a corridor cell or an elevator stop: its Properties; with Shift, one more or one fewer
        const held = cellFocus(ed).get();
        const kept = gesture.add && held && held.floorId === ed.floor.id ? held.cells : [];
        const next = gesture.add && kept.includes(cell) ? kept.filter((each) => each !== cell) : kept.concat([cell]);
        if (next.length === 0) {
          cellFocus(ed).clear();
          ed.select([]);
          ed.say('Nothing is selected.');
        } else {
          showCells(ed, next);
          ed.say(cellsSaid(ed, next));
        }
      } else if (!gesture.add) {
        cellFocus(ed).clear();
        ed.select([]);
      }
      return;
    }
    const rect = boxOf(gesture, ev);
    const found = inBox(ed, rect);
    const cells = found.length === 0 || !gesture.add ? cellsIn(ed, rect) : [];
    // a Shift-drag that finds nothing adds nothing: what was selected stays
    if (gesture.add && found.length === 0 && (cells.length === 0 || ed.selection.length > 0)) {
      ed.say(cells.length === 0 ? 'Nothing found in the box.' : 'Spaces are selected. Drag without Shift to see the cells\' Properties.');
      return;
    }
    if (found.length === 0 && cells.length > 0) {
      const held = cellFocus(ed).get();
      const kept = gesture.add && held && held.floorId === ed.floor.id ? held.cells : [];
      const next = Array.from(new Set(kept.concat(cells)));
      showCells(ed, next);
      ed.say(cellsSaid(ed, next));
      return;
    }
    const next = gesture.add ? Array.from(new Set(ed.selection.concat(found))) : found;
    cellFocus(ed).clear();
    ed.select(next);
    ed.say(next.length === 0 ? 'Nothing is selected.' : capital(count(next.length, 'space')) + ' selected.');
  },
  // A click on empty floor (the drag that never moved): nothing is selected.
  onTap(ed) {
    if (ed.selection.length === 0 && !cellFocus(ed).get()) return;
    cellFocus(ed).clear();
    ed.select([]);
    ed.say('Nothing is selected.');
  },
  onCancel(ed) {
    ed.endGesture();
  },
};
