// The menu of a cell of the plan (spec 4.3, DESIGN 5.1): what can be done
// there, by right-click, long-press, the Menu key or Shift+F10. It is how a
// door is added without a pointer ("Add a door on the north edge"), how
// stairs are connected, and how a cell changes type without changing tool.
//
// Every entry is one action, made through the editor (one undo entry, a
// sentence said, a refusal shown as it is).

import { h } from '../components/dom.js';
import { openMenu } from '../components/menu.js';
import { count } from '../components/words.js';
import { paintCorridor, placeStairs, placeRoom, placeOtherSpace, eraseCells, deleteSpaces, describeSpaceDelete, addDoor, removeDoor, disconnectStairs, nameCorridor, removeCorridorName, markExit, unmarkExit, setZone, removeZone } from '../../engine/actions.js';
import { describeCell, SIDE_WORDS } from '../../engine/building.js';
import { DOOR_SIDES, CELL_CORRIDOR, neighbourCell } from '../../engine/schema.js';
import { roomName } from '../../engine/findings.js';

function spaceWords(space) {
  if (space.kind === 'room') return roomName(space);
  return space.label.trim() === '' ? 'this other space' : space.label;
}

// Delete one room or other space, saying what was scheduled into it.
export function deleteSpace(ed, spaceId) {
  const space = ed.floor.spaces.find((each) => each.id === spaceId);
  if (!space) return null;
  const described = ed.attempt(() => describeSpaceDelete(ed.project, { spaceIds: [spaceId] }));
  if (!described) return null;
  const name = spaceWords(space);
  const warn = described.slots === 0 ? '' : ' ' + count(described.groups, 'group') + (described.groups === 1 ? ' is' : ' are') + ' scheduled there for ' + count(described.slots, 'period') + '. Those periods now say the room is not in the building.';
  return ed.commit(deleteSpaces, { spaceIds: [spaceId] }, { done: () => 'Deleted ' + name + '.', toast: () => 'Deleted ' + name + '.' + warn });
}

// Ask for one line of text in the tool's own dialog. Resolves with the text,
// or null when the question was called off.
// askText(ctx, { id, title, label, value, action, keep, body, opener })
export function askText(ctx, options) {
  const input = h('input', { class: 'field__input', id: 'ask-text', type: 'text', autocomplete: 'off', spellcheck: 'false' });
  input.value = options.value || '';
  const dialog = ctx.openDialog({
    id: options.id,
    title: options.title,
    opener: options.opener,
    body: [
      options.body ? h('p', null, options.body) : null,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'ask-text' }, options.label), input),
    ],
    buttons: [
      { label: options.action, value: 'yes', kind: 'primary' },
      { label: options.keep, value: null },
    ],
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      dialog.close('yes');
    }
  });
  input.focus();
  input.select();
  return dialog.closed.then((answer) => (answer === 'yes' ? input.value : null));
}

// The straight run of corridor cells through `cell`: along the longer of the
// two ways it can be followed. What "name this corridor" names from one cell.
export function corridorRun(floor, cell) {
  const walk = (a, b) => {
    const cells = [cell];
    for (const side of [a, b]) {
      for (let next = neighbourCell(floor, cell, side); next !== -1 && floor.cells[next] === CELL_CORRIDOR; next = neighbourCell(floor, next, side)) cells.push(next);
    }
    return cells.sort((x, y) => x - y);
  };
  const across = walk('w', 'e');
  const down = walk('n', 's');
  return down.length > across.length ? down : across;
}

// Name the corridor cells given, asking for the name first. One action.
export async function nameCells(ed, cells, opener) {
  const floor = ed.floor;
  const had = floor.corridors.filter((corridor) => corridor.cells.some((cell) => cells.includes(cell)));
  const name = await askText(ed.ctx, {
    id: 'corridor-name-dialog',
    title: 'What is this corridor called?',
    body: 'The name goes on ' + count(cells.length, 'corridor cell') + ' and is drawn along them. Leave it empty to take a name off.',
    label: 'Corridor name',
    value: had.length === 1 ? had[0].name : '',
    action: 'Name the corridor',
    keep: 'Leave it as it is',
    opener: opener || ed.canvas,
  });
  if (name === null) {
    ed.say('The corridor was left as it is.');
    return null;
  }
  return ed.commit(nameCorridor, { floorId: floor.id, cells, name }, {
    done: () => (name === '' ? 'Took the name off ' + count(cells.length, 'corridor cell') + '.' : 'Named ' + count(cells.length, 'corridor cell') + ' ' + name + '.'),
    same: name === '' ? 'Those cells have no name to take off.' : 'Those cells are called ' + name + ' already.',
  });
}

function zonesAt(ed, cell) {
  const x = cell % ed.floor.width;
  const y = Math.floor(cell / ed.floor.width);
  return ed.project.building.zones.filter((zone) => zone.floorId === ed.floor.id && x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h);
}

// The items for one cell. deps: { connect, inspector }.
export function menuItems(ed, deps, cell) {
  const floor = ed.floor;
  const at = describeCell(ed.project.building, floor.id, cell);
  if (!at) return [];
  const floorId = floor.id;
  const one = { floorId, cells: [cell] };
  const rect = { floorId, rect: { x: at.x, y: at.y, w: 1, h: 1 } };
  const items = [];
  const place = {
    corridor: { label: 'Make this a corridor cell', run: () => ed.commit(paintCorridor, one, { done: () => 'Made the cell a corridor cell.' }) },
    stairs: { label: 'Make this a stairs cell', run: () => ed.commit(placeStairs, one, { done: () => 'Made the cell a stairs cell. Not connected yet.' }) },
    room: { label: 'Place a room here', run: () => {
      const outcome = ed.commit(placeRoom, rect, { done: () => 'Placed a room, 1 by 1. Type its number.' });
      if (outcome) ed.placedRoom(outcome.spaceId, { pointerType: 'mouse' });
    } },
    other: { label: 'Place an other space here', run: () => {
      const outcome = ed.commit(placeOtherSpace, rect, { done: () => 'Placed an other space, 1 by 1.' });
      if (outcome) ed.select([outcome.spaceId]);
    } },
  };
  const eraseCell = { label: 'Erase this cell', danger: true, run: () => ed.commit(eraseCells, one, { done: () => 'Erased the cell.' }) };

  if (at.kind === 'room' || at.kind === 'other') {
    const space = at.space;
    const name = spaceWords(space);
    items.push({ label: 'Edit ' + name, run: () => {
      ed.select([space.id]);
      if (space.kind === 'room') deps.inspector().focusNumber();
      else deps.inspector().showTab('properties');
    } });
    if (space.kind === 'room') {
      items.push('separator');
      for (const side of DOOR_SIDES) {
        const has = space.doors.some((door) => door.cell === cell && door.side === side);
        items.push(has
          ? { label: 'Remove the door on the ' + SIDE_WORDS[side] + ' edge', run: () => ed.commit(removeDoor, { roomId: space.id, cell, side }, { done: () => 'Removed the door on the ' + SIDE_WORDS[side] + ' edge of ' + name + '.' }) }
          : { label: 'Add a door on the ' + SIDE_WORDS[side] + ' edge', run: () => ed.commit(addDoor, { roomId: space.id, cell, side }, { done: () => 'Added a door on the ' + SIDE_WORDS[side] + ' edge of ' + name + '.', same: 'There is a door there already.' }) });
      }
    }
    items.push('separator');
    items.push({ label: 'Delete ' + name, danger: true, run: () => deleteSpace(ed, space.id) });
  } else if (at.kind === 'corridor') {
    if (at.exit) {
      items.push({ label: 'Edit the exit' + (at.exit.doorName.trim() === '' ? '' : ' ' + at.exit.doorName), run: () => deps.inspector().focusExit(at.exit.id) });
      items.push({ label: 'Take the exit mark off', run: () => ed.commit(unmarkExit, { floorId, exitId: at.exit.id }, { done: () => 'Took the exit mark off. The corridor cell stays.' }) });
    } else {
      items.push({ label: 'Mark as an exit', run: () => {
        const outcome = ed.commit(markExit, { floorId, cell }, { done: () => 'Marked an exit. Type its door name.' });
        if (outcome) deps.inspector().focusExit(outcome.exitId);
      } });
    }
    const named = floor.corridors.find((corridor) => corridor.cells.includes(cell));
    items.push({ label: named ? 'Rename the corridor ' + named.name + '…' : 'Name this corridor…', run: () => nameCells(ed, named ? named.cells : corridorRun(floor, cell)) });
    if (named) items.push({ label: 'Take the name ' + named.name + ' off', run: () => ed.commit(removeCorridorName, { floorId, corridorId: named.id }, { done: () => 'Took the name ' + named.name + ' off the corridor.' }) });
    items.push('separator', place.stairs, place.room, place.other, 'separator', eraseCell);
  } else if (at.kind === 'stairs') {
    items.push({ label: 'Connect these stairs…', run: () => deps.connect().start({ floorId, cell }) });
    for (const connection of at.connections) {
      items.push({ label: 'Disconnect stairs ' + connection.label, run: () => ed.commit(disconnectStairs, { connectionId: connection.id }, { done: () => 'Disconnected stairs ' + connection.label + '.' }) });
    }
    items.push('separator', place.corridor, place.room, place.other, 'separator', eraseCell);
  } else {
    items.push(place.corridor, place.stairs, place.room, place.other);
  }

  for (const zone of zonesAt(ed, cell)) {
    const what = zone.label.trim() === '' ? 'the left-out area here' : 'the left-out area ' + zone.label;
    items.push('separator');
    items.push({ label: 'Label ' + what + '…', run: async () => {
      const label = await askText(ed.ctx, { id: 'zone-label-dialog', title: 'What is this left-out area?', label: 'Label', value: zone.label, action: 'Keep the label', keep: 'Leave it as it is', opener: ed.canvas });
      if (label !== null) ed.commit(setZone, { zoneId: zone.id, label }, { done: () => (label === '' ? 'Took the label off the area.' : 'Labelled the area ' + label + '.'), same: 'That is its label already.' });
    } });
    items.push({ label: 'Put ' + what + ' back in the colour scale', run: () => ed.commit(removeZone, { zoneId: zone.id }, { done: () => 'The area is back in the colour scale.' }) });
  }
  return items;
}

// buildingMenu(ed, deps) -> (ev) => {}: what index.js sets ed.menu to.
//   ev is the pointer's event, or the keyboard cursor's (no clientX there).
export function buildingMenu(ed, deps) {
  return (ev) => {
    const items = menuItems(ed, deps, ev.index);
    if (items.length === 0) return;
    let anchor;
    if (typeof ev.clientX === 'number') anchor = { x: ev.clientX, y: ev.clientY };
    else {
      const box = ed.canvas.getBoundingClientRect();
      anchor = { x: box.left + ev.sx, y: box.top + ev.sy };
    }
    const at = describeCell(ed.project.building, ed.floor.id, ev.index);
    const what = at.kind === 'room' || at.kind === 'other' ? spaceWords(at.space) : at.kind === 'empty' ? 'this empty cell' : 'this ' + at.kind + ' cell';
    openMenu({ items, anchor, opener: ed.canvas, label: 'What can be done with ' + what });
  };
}
