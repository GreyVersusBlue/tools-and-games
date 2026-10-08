// Cell and space operations on a building: place, paint, erase, move, copy,
// paste, doors, stairs connections, corridor names, exits, zones, resize, and
// the counts of spec 4.10.
//
// Every function here is pure and works on the Building object alone:
// (building, args, ids) → { building, … }. It copies only the branches it
// changes, and a call that changes nothing returns the building it was given.
// What cannot be done throws a BuildingError whose message says what was wrong
// and what to do. The matching actions in actions.js wrap these for the store:
// they turn a BuildingError into an ActionError and rewrite the slots of any
// room in `removedRooms`, which is the one thing this module cannot do,
// because the schedule is not part of the building.
//
// A change to cells can make other things invalid: a door that no longer
// faces a corridor, an exit that is no longer on the edge, a connection whose
// stairs are gone. Those are taken out in the same step and reported in
// `loss`, so nothing goes silently and validate() accepts every result.

import { RANGES, OTHER_KINDS, DOOR_SIDES, CONNECTION_DIRECTIONS, CELL_EMPTY, CELL_CORRIDOR, CELL_STAIRS, DEFAULT_OTHER_COLOUR } from './schema.js';
import { newRoom, newOtherSpace, neighbourCell, spaceOwners, cellKind, isEdgeCorridorCell, isWalkable, inRange, isHexColour, roomNumberKey, nextConnectionLabel } from './schema.js';

export class BuildingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BuildingError';
    this.code = code || 'refused';
  }
}

function refuse(message, code) {
  throw new BuildingError(message, code);
}

export const SIDE_WORDS = { n: 'north', e: 'east', s: 'south', w: 'west' };
export const OVER_MODES = ['replace', 'skip', 'refuse'];
export const CLIP_FORMAT = 'sv2-spaces';

const NO_IDS = new Set();
const NO_CELLS = new Set();
const NO_SWAPS = new Map();

// ---------------------------------------------------------------- finding things

function floorIndexOf(building, floorId) {
  const index = building.floors.findIndex((floor) => floor.id === floorId);
  if (index === -1) refuse('That floor is no longer in the building.', 'missing');
  return index;
}

// { floor, floorIndex, space } for a room or other space, or null.
export function findSpace(building, spaceId) {
  for (let floorIndex = 0; floorIndex < building.floors.length; floorIndex += 1) {
    const floor = building.floors[floorIndex];
    const space = floor.spaces.find((candidate) => candidate.id === spaceId);
    if (space) return { floor, floorIndex, space };
  }
  return null;
}

function needSpace(building, spaceId, kind) {
  const found = findSpace(building, spaceId);
  if (!found || (kind && found.space.kind !== kind)) refuse(kind === 'room' ? 'That room is no longer in the building.' : 'That space is no longer in the building.', 'missing');
  return found;
}

// How a space is named in a sentence. The number or label goes in as typed.
export function spaceName(space) {
  if (space.kind === 'room') return space.number.trim() === '' ? 'an unnumbered room' : 'Room ' + space.number;
  return space.label.trim() === '' ? 'an unlabelled space' : space.label;
}

function inGrid(floor, cell) {
  return Number.isInteger(cell) && cell >= 0 && cell < floor.width * floor.height;
}

function uniqueCells(floor, cells) {
  if (!Array.isArray(cells)) refuse('The cells are a list of cells.', 'bad-value');
  const seen = new Set();
  for (const cell of cells) {
    if (!inGrid(floor, cell)) refuse('Cell ' + cell + ' is not on ' + floor.name + '.', 'off-floor');
    seen.add(cell);
  }
  return Array.from(seen);
}

// The cells of a rectangle, row by row, clipped to the floor.
export function rectCells(floor, x, y, w, h) {
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1) refuse('A rectangle is a column, a row, a width and a height in whole cells.', 'bad-value');
  const cells = [];
  for (let row = Math.max(0, y); row < Math.min(floor.height, y + h); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(floor.width, x + w); column += 1) cells.push(row * floor.width + column);
  }
  return cells;
}

// The cells of a straight line from one cell to another, each sharing an edge
// with the one before, so a corridor painted along it can be walked.
export function lineCells(floor, from, to) {
  if (!inGrid(floor, from) || !inGrid(floor, to)) refuse('A line starts and ends on a cell of ' + floor.name + '.', 'off-floor');
  let x = from % floor.width;
  let y = Math.floor(from / floor.width);
  const dx = Math.abs((to % floor.width) - x);
  const dy = Math.abs(Math.floor(to / floor.width) - y);
  const sx = to % floor.width > x ? 1 : -1;
  const sy = Math.floor(to / floor.width) > y ? 1 : -1;
  const cells = [from];
  let ix = 0;
  let iy = 0;
  while (ix < dx || iy < dy) {
    if ((1 + 2 * ix) * dy < (1 + 2 * iy) * dx) {
      x += sx;
      ix += 1;
    } else {
      y += sy;
      iy += 1;
    }
    cells.push(y * floor.width + x);
  }
  return cells;
}

// args carries the cells one of three ways: { cells }, { rect: { x, y, w, h } }
// or { from, to } for a straight line.
function targetCells(floor, args) {
  let cells;
  if (args.rect) cells = rectCells(floor, args.rect.x, args.rect.y, args.rect.w, args.rect.h);
  else if (args.from !== undefined && args.to !== undefined) cells = lineCells(floor, args.from, args.to);
  else cells = uniqueCells(floor, args.cells);
  if (cells.length === 0) refuse('Pick at least one cell on ' + floor.name + '.', 'no-cells');
  return cells;
}

function overMode(value, fallback) {
  if (value === undefined) return fallback;
  if (!OVER_MODES.includes(value)) refuse('Placing over what is there is one of: ' + OVER_MODES.join(', ') + '.', 'bad-value');
  return value;
}

function sameItems(a, b) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// ---------------------------------------------------------------- loss

// What a change took out of the building besides what it was asked to change.
export function emptyLoss() {
  return { spaces: [], corridorCells: 0, stairsCells: 0, connections: [], exits: [], doors: [], corridorNames: [], zones: [] };
}

export function isLoss(loss) {
  return loss.spaces.length + loss.corridorCells + loss.stairsCells + loss.connections.length + loss.exits.length + loss.doors.length + loss.corridorNames.length + loss.zones.length > 0;
}

function addLoss(into, from) {
  into.corridorCells += from.corridorCells;
  into.stairsCells += from.stairsCells;
  for (const key of ['spaces', 'connections', 'exits', 'doors', 'corridorNames', 'zones']) into[key].push(...from[key]);
  return into;
}

function plural(count, one, many) {
  return count + ' ' + (count === 1 ? one : many);
}

function sentenceList(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

// A loss as a phrase for a label or a question: "Room 101, 2 cells of Room
// 102, 3 corridor cells and stairs connection A". Empty when nothing was lost.
export function lossText(loss) {
  const parts = [];
  const gone = loss.spaces.filter((space) => space.removed);
  if (gone.length > 3) {
    const rooms = gone.filter((space) => space.kind === 'room').length;
    if (rooms > 0) parts.push(plural(rooms, 'room', 'rooms'));
    if (gone.length - rooms > 0) parts.push(plural(gone.length - rooms, 'other space', 'other spaces'));
  } else {
    for (const space of gone) parts.push(space.name);
  }
  for (const space of loss.spaces) if (!space.removed) parts.push(plural(space.cells, 'cell', 'cells') + ' of ' + space.name);
  if (loss.corridorCells > 0) parts.push(plural(loss.corridorCells, 'corridor cell', 'corridor cells'));
  if (loss.stairsCells > 0) parts.push(plural(loss.stairsCells, 'stairs cell', 'stairs cells'));
  for (const connection of loss.connections) parts.push('stairs connection ' + connection.label);
  for (const exit of loss.exits) parts.push(exit.doorName.trim() === '' ? 'an exit' : 'the exit ' + exit.doorName);
  if (loss.doors.length > 0) parts.push(plural(loss.doors.length, 'door', 'doors'));
  for (const corridor of loss.corridorNames) if (corridor.removed) parts.push('the corridor name ' + corridor.name);
  if (loss.zones.length > 0) parts.push(plural(loss.zones.length, 'exclusion zone', 'exclusion zones'));
  return sentenceList(parts);
}

// ---------------------------------------------------------------- the one edit

// After a floor's cells or spaces changed: take out every door, exit,
// corridor-name cell and connection the new shape no longer supports, and
// write each into `loss`.
function settle(building, index, floor, loss) {
  const spaces = [];
  for (const space of floor.spaces) {
    if (space.kind !== 'room' || space.doors.length === 0) {
      spaces.push(space);
      continue;
    }
    const own = new Set(space.cells);
    const doors = space.doors.filter((door) => {
      const across = neighbourCell(floor, door.cell, door.side);
      const ok = own.has(door.cell) && across !== -1 && !own.has(across) && isWalkable(floor.cells[across]);
      if (!ok) loss.doors.push({ roomId: space.id, name: spaceName(space), cell: door.cell, side: door.side });
      return ok;
    });
    spaces.push(doors.length === space.doors.length ? space : { ...space, doors });
  }
  let next = sameItems(spaces, floor.spaces) ? floor : { ...floor, spaces };

  const corridors = [];
  for (const corridor of next.corridors) {
    const cells = corridor.cells.filter((cell) => next.cells[cell] === CELL_CORRIDOR);
    if (cells.length === corridor.cells.length) {
      corridors.push(corridor);
      continue;
    }
    loss.corridorNames.push({ id: corridor.id, name: corridor.name, cells: corridor.cells.length - cells.length, removed: cells.length === 0 });
    if (cells.length > 0) corridors.push({ ...corridor, cells });
  }
  if (!sameItems(corridors, next.corridors)) next = { ...next, corridors };

  const exits = next.exits.filter((exit) => {
    const ok = isEdgeCorridorCell(next, exit.cell);
    if (!ok) loss.exits.push({ id: exit.id, doorName: exit.doorName, cell: exit.cell });
    return ok;
  });
  if (exits.length !== next.exits.length) next = { ...next, exits };

  const connections = building.connections.filter((connection) => {
    const ok = [connection.a, connection.b].every((end) => end.floorId !== next.id || next.cells[end.cell] === CELL_STAIRS);
    if (!ok) loss.connections.push({ id: connection.id, label: connection.label });
    return ok;
  });

  if (next === building.floors[index] && connections.length === building.connections.length) return building;
  const floors = next === building.floors[index] ? building.floors : building.floors.map((candidate, i) => (i === index ? next : candidate));
  return { ...building, floors, connections: connections.length === building.connections.length ? building.connections : connections };
}

// Change one floor. edit has any of:
//   take    Set of cells emptied: a walkable cell becomes empty, a space loses the cell
//   paint   Map of cell → character written after `take`
//   remove  Set of space ids taken out whole, reported as a loss
//   drop    Set of space ids taken out whole and not reported (they are moving)
//   swap    Map of space id → the space to put in its place; `take` leaves these alone
//   add     spaces to append
function editFloor(building, index, edit) {
  const floor = building.floors[index];
  const take = edit.take || NO_CELLS;
  const paint = edit.paint || NO_SWAPS;
  const remove = edit.remove || NO_IDS;
  const drop = edit.drop || NO_IDS;
  const swap = edit.swap || NO_SWAPS;
  const loss = emptyLoss();
  const removedRooms = [];

  let cells = floor.cells;
  if (take.size > 0 || paint.size > 0) {
    const characters = cells.split('');
    for (const cell of take) characters[cell] = CELL_EMPTY;
    for (const [cell, character] of paint) characters[cell] = character;
    cells = characters.join('');
    for (const cell of new Set([...take, ...paint.keys()])) {
      if (floor.cells[cell] === cells[cell]) continue;
      if (floor.cells[cell] === CELL_CORRIDOR) loss.corridorCells += 1;
      if (floor.cells[cell] === CELL_STAIRS) loss.stairsCells += 1;
    }
  }

  const spaces = [];
  const gone = (space, lost) => {
    loss.spaces.push({ id: space.id, kind: space.kind, name: spaceName(space), cells: lost, of: space.cells.length, removed: lost === space.cells.length });
    if (lost === space.cells.length && space.kind === 'room') removedRooms.push(space);
  };
  for (const space of floor.spaces) {
    if (drop.has(space.id)) continue;
    if (swap.has(space.id)) {
      spaces.push(swap.get(space.id));
      continue;
    }
    if (remove.has(space.id)) {
      gone(space, space.cells.length);
      continue;
    }
    const kept = take.size === 0 ? space.cells : space.cells.filter((cell) => !take.has(cell));
    if (kept.length === space.cells.length) {
      spaces.push(space);
      continue;
    }
    gone(space, space.cells.length - kept.length);
    if (kept.length > 0) spaces.push({ ...space, cells: kept });
  }
  if (edit.add) spaces.push(...edit.add);

  const unchanged = cells === floor.cells && sameItems(spaces, floor.spaces);
  const next = unchanged ? floor : { ...floor, cells, spaces: sameItems(spaces, floor.spaces) ? floor.spaces : spaces };
  return { building: settle(building, index, next, loss), loss, removedRooms };
}

// ---------------------------------------------------------------- place and paint

function needFreeNumber(building, number, exceptId) {
  if (typeof number !== 'string') refuse('A room number is text.', 'bad-value');
  if (number.trim() === '') return number;
  const key = roomNumberKey(number);
  for (const floor of building.floors) {
    for (const space of floor.spaces) {
      if (space.kind === 'room' && space.id !== exceptId && space.number.trim() !== '' && roomNumberKey(space.number) === key) {
        refuse('There is already a Room ' + space.number + ', on ' + floor.name + '. Room numbers are unique across the building, whatever the capitals or the spaces around them; type a different number.', 'duplicate-number');
      }
    }
  }
  return number;
}

function placeSpace(building, args, make) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const mode = overMode(args.over, 'replace');
  let cells = targetCells(floor, args);
  if (mode === 'skip') {
    cells = cells.filter((cell) => cellKind(floor, cell) === 'empty');
    if (cells.length === 0) refuse('There is no empty cell there on ' + floor.name + '. Draw somewhere empty, or erase what is there first.', 'occupied');
  }
  cells.sort((a, b) => a - b);
  const space = make(cells);
  const result = editFloor(building, index, { take: new Set(cells), add: [space] });
  if (mode === 'refuse' && isLoss(result.loss)) refuse('That would replace ' + lossText(result.loss) + ' on ' + floor.name + '. Draw somewhere empty, or erase or move what is there first.', 'occupied');
  return { building: result.building, floorId: floor.id, spaceId: space.id, cells, loss: result.loss, removedRooms: result.removedRooms };
}

// What placing anything on these cells would replace. Nothing is changed.
export function describePlace(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const cells = targetCells(building.floors[index], args);
  const result = editFloor(building, index, { take: new Set(cells) });
  return { cells, loss: result.loss, removedRooms: result.removedRooms };
}

// A room on one cell, a rectangle, or the cells given. args: { floorId } with
// cells, rect or from/to; optionally id, number, and over: 'replace' (the
// default: whatever is under it goes, and `loss` says what), 'skip' (only the
// empty cells) or 'refuse'.
export function placeRoom(building, args, ids) {
  const number = args.number === undefined ? '' : needFreeNumber(building, args.number, null);
  return placeSpace(building, args, (cells) => ({ ...newRoom(args.id || ids('r'), cells), number }));
}

function needOtherKind(value) {
  if (!OTHER_KINDS.includes(value)) refuse('The kind of an other space is one of: ' + OTHER_KINDS.join(', ') + '.', 'bad-value');
  return value;
}

function needColour(value) {
  if (!isHexColour(value)) refuse('A colour is written #rrggbb, for example #9aa3ad.', 'bad-value');
  return value.toLowerCase();
}

function needText(value, what) {
  if (typeof value !== 'string') refuse(what + ' is text.', 'bad-value');
  return value;
}

// An other space. args as placeRoom, with label, otherKind and colour.
export function placeOtherSpace(building, args, ids) {
  const label = needText(args.label === undefined ? '' : args.label, 'A label');
  const otherKind = needOtherKind(args.otherKind === undefined ? 'other' : args.otherKind);
  const colour = needColour(args.colour === undefined ? DEFAULT_OTHER_COLOUR : args.colour);
  return placeSpace(building, args, (cells) => ({ ...newOtherSpace(args.id || ids('o'), cells), label, otherKind, colour }));
}

function paintCells(building, args, character) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const mode = overMode(args.over, 'replace');
  let cells = targetCells(floor, args).filter((cell) => floor.cells[cell] !== character);
  if (mode === 'skip') cells = cells.filter((cell) => cellKind(floor, cell) === 'empty');
  if (cells.length === 0) return { building, floorId: floor.id, cells, loss: emptyLoss(), removedRooms: [] };
  const result = editFloor(building, index, { take: new Set(cells), paint: new Map(cells.map((cell) => [cell, character])) });
  if (mode === 'refuse' && isLoss(result.loss)) refuse('That would replace ' + lossText(result.loss) + ' on ' + floor.name + '. Paint somewhere empty, or erase or move what is there first.', 'occupied');
  return { building: result.building, floorId: floor.id, cells, loss: result.loss, removedRooms: result.removedRooms };
}

// Corridor on the cells given, or along a straight line with { from, to }.
export function paintCorridor(building, args) {
  return paintCells(building, args, CELL_CORRIDOR);
}

export function placeStairs(building, args) {
  return paintCells(building, args, CELL_STAIRS);
}

// ---------------------------------------------------------------- erase and delete

function eraseEdit(floor, cells, whole) {
  const owners = spaceOwners(floor);
  const remove = new Set();
  const take = new Set();
  for (const cell of cells) {
    const owner = owners.get(cell);
    if (owner && whole) remove.add(owner.id);
    else if (owner || floor.cells[cell] !== CELL_EMPTY) take.add(cell);
  }
  return { remove, take };
}

// Erase cells. A corridor or stairs cell becomes empty. A cell of a room or
// other space takes the whole space with it, or with whole: false only that
// cell (the space goes when its last cell does).
export function erase(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const result = editFloor(building, index, eraseEdit(floor, targetCells(floor, args), args.whole !== false));
  return { building: result.building, floorId: floor.id, loss: result.loss, removedRooms: result.removedRooms };
}

// What erasing these cells would do, both ways. `ambiguous` is true when a
// space of more than one cell is touched on only some of them, which is when
// the interface asks "this cell, or the whole room?". Nothing is changed.
export function describeErase(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const cells = targetCells(floor, args);
  const owners = spaceOwners(floor);
  const hits = new Map();
  for (const cell of cells) {
    const owner = owners.get(cell);
    if (owner) hits.set(owner, (hits.get(owner) || 0) + 1);
  }
  const spaces = Array.from(hits, ([space, hit]) => ({ id: space.id, kind: space.kind, name: spaceName(space), cells: hit, of: space.cells.length }));
  const whole = editFloor(building, index, eraseEdit(floor, cells, true));
  const cellsOnly = editFloor(building, index, eraseEdit(floor, cells, false));
  return {
    ambiguous: spaces.some((space) => space.cells < space.of),
    spaces,
    whole: { loss: whole.loss, removedRooms: whole.removedRooms },
    cellsOnly: { loss: cellsOnly.loss, removedRooms: cellsOnly.removedRooms },
  };
}

// Take rooms and other spaces out, on any floors. args: { spaceIds }.
export function deleteSpaces(building, args) {
  if (!Array.isArray(args.spaceIds) || args.spaceIds.length === 0) refuse('Pick at least one room or space to delete.', 'bad-value');
  const byFloor = new Map();
  for (const spaceId of args.spaceIds) {
    const found = needSpace(building, spaceId);
    if (!byFloor.has(found.floor.id)) byFloor.set(found.floor.id, new Set());
    byFloor.get(found.floor.id).add(spaceId);
  }
  let next = building;
  const loss = emptyLoss();
  const removedRooms = [];
  for (const [floorId, remove] of byFloor) {
    const result = editFloor(next, floorIndexOf(next, floorId), { remove });
    next = result.building;
    addLoss(loss, result.loss);
    removedRooms.push(...result.removedRooms);
  }
  return { building: next, loss, removedRooms };
}

// ---------------------------------------------------------------- move, copy, paste

function landsOn(loss) {
  return loss.spaces.length + loss.corridorCells + loss.stairsCells > 0;
}

// Move one or many spaces by (dx, dy) cells, and to another floor with
// toFloorId. Each keeps its id and every property, so every slot that names a
// moved room still names it. A door goes with its room and is kept wherever
// it still faces a corridor or stairs. args: { spaceIds, dx, dy, toFloorId,
// over }; over is 'refuse' (the default) or 'replace'.
export function moveSpaces(building, args) {
  if (!Array.isArray(args.spaceIds) || args.spaceIds.length === 0) refuse('Pick at least one room or space to move.', 'bad-value');
  const dx = args.dx === undefined ? 0 : args.dx;
  const dy = args.dy === undefined ? 0 : args.dy;
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) refuse('A move is a whole number of cells across and down.', 'bad-value');
  const mode = overMode(args.over, 'refuse');
  const found = Array.from(new Set(args.spaceIds), (spaceId) => needSpace(building, spaceId));
  const from = found[0].floor;
  if (found.some((entry) => entry.floor !== from)) refuse('Spaces move together only from one floor. Move each floor\'s spaces on their own.', 'bad-value');
  const toIndex = floorIndexOf(building, args.toFloorId === undefined ? from.id : args.toFloorId);
  const to = building.floors[toIndex];
  if (to === from && dx === 0 && dy === 0) return { building, floorId: to.id, loss: emptyLoss(), removedRooms: [], spaceIds: found.map((entry) => entry.space.id) };

  const shift = (space, cell) => {
    const x = (cell % from.width) + dx;
    const y = Math.floor(cell / from.width) + dy;
    if (x < 0 || y < 0 || x >= to.width || y >= to.height) refuse('That would put part of ' + spaceName(space) + ' off the edge of ' + to.name + '. Move it less far, or make the floor larger first.', 'off-floor');
    return y * to.width + x;
  };
  const moved = found.map(({ space }) => {
    const next = { ...space, cells: space.cells.map((cell) => shift(space, cell)) };
    if (space.kind === 'room') next.doors = space.doors.map((door) => ({ cell: shift(space, door.cell), side: door.side }));
    return next;
  });
  const take = new Set();
  for (const space of moved) for (const cell of space.cells) take.add(cell);

  let result;
  if (to === from) {
    result = editFloor(building, toIndex, { take, swap: new Map(moved.map((space) => [space.id, space])) });
  } else {
    const lifted = editFloor(building, found[0].floorIndex, { drop: new Set(moved.map((space) => space.id)) });
    result = editFloor(lifted.building, toIndex, { take, add: moved });
    addLoss(result.loss, lifted.loss);
  }
  if (mode !== 'replace' && landsOn(result.loss)) {
    const under = { ...emptyLoss(), spaces: result.loss.spaces, corridorCells: result.loss.corridorCells, stairsCells: result.loss.stairsCells };
    refuse('That would put ' + (moved.length === 1 ? spaceName(moved[0]) : plural(moved.length, 'space', 'spaces')) + ' on top of ' + lossText(under) + ' on ' + to.name + '. Move it somewhere empty, or erase what is there first.', 'occupied');
  }
  return { building: result.building, floorId: to.id, loss: result.loss, removedRooms: result.removedRooms, spaceIds: moved.map((space) => space.id) };
}

// A copy of some spaces as plain data, with cells as offsets from the top
// left of the box around them, to hand to pasteSpaces on any floor. A room's
// teachers are not copied: a teacher is based in the room that was copied,
// not in the copy.
export function copySpaces(building, args) {
  if (!Array.isArray(args.spaceIds) || args.spaceIds.length === 0) refuse('Pick at least one room or space to copy.', 'bad-value');
  const found = Array.from(new Set(args.spaceIds), (spaceId) => needSpace(building, spaceId));
  const floor = found[0].floor;
  if (found.some((entry) => entry.floor !== floor)) refuse('Spaces are copied together only from one floor.', 'bad-value');
  let left = floor.width;
  let top = floor.height;
  let right = 0;
  let bottom = 0;
  for (const { space } of found) {
    for (const cell of space.cells) {
      left = Math.min(left, cell % floor.width);
      right = Math.max(right, cell % floor.width);
      top = Math.min(top, Math.floor(cell / floor.width));
      bottom = Math.max(bottom, Math.floor(cell / floor.width));
    }
  }
  const offset = (cell) => [(cell % floor.width) - left, Math.floor(cell / floor.width) - top];
  const spaces = found.map(({ space }) => {
    const copy = { ...space, sourceId: space.id, cells: space.cells.map(offset) };
    delete copy.id;
    if (space.kind === 'room') {
      copy.teacherIds = [];
      copy.doors = space.doors.map((door) => ({ at: offset(door.cell), side: door.side }));
    }
    return copy;
  });
  return { format: CLIP_FORMAT, version: 1, width: right - left + 1, height: bottom - top + 1, spaces };
}

// Put a copy down with its top left at (x, y) on a floor. Every pasted space
// is new, with a new id. A pasted room keeps its number only when no room in
// the building has it; otherwise it is unnumbered and the building checks
// list it. args: { floorId, clip, x, y, over }; over is 'refuse' (the default)
// or 'replace'.
export function pasteSpaces(building, args, ids) {
  const clip = args.clip;
  if (!clip || clip.format !== CLIP_FORMAT || !Array.isArray(clip.spaces) || clip.spaces.length === 0) refuse('There is nothing copied to paste. Select a room or space and copy it first.', 'bad-value');
  if (!Number.isInteger(args.x) || !Number.isInteger(args.y)) refuse('A paste goes at a column and a row in whole cells.', 'bad-value');
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const mode = overMode(args.over, 'refuse');
  const place = (offset) => {
    const x = args.x + offset[0];
    const y = args.y + offset[1];
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) refuse('The copy does not fit there: part of it would be off the edge of ' + floor.name + '. Paste it further in, or make the floor larger first.', 'off-floor');
    return y * floor.width + x;
  };
  const taken = new Set();
  for (const other of building.floors) for (const space of other.spaces) if (space.kind === 'room' && space.number.trim() !== '') taken.add(roomNumberKey(space.number));
  const add = clip.spaces.map((source) => {
    const cells = source.cells.map(place).sort((a, b) => a - b);
    if (source.kind === 'room') {
      const room = newRoom(ids('r'), cells);
      const free = source.number.trim() !== '' && !taken.has(roomNumberKey(source.number));
      if (free) taken.add(roomNumberKey(source.number));
      return { ...room, number: free ? source.number : '', subjectId: source.subjectId, wing: source.wing, capacity: source.capacity, shared: source.shared, doors: source.doors.map((door) => ({ cell: place(door.at), side: door.side })) };
    }
    return { ...newOtherSpace(ids('o'), cells), label: source.label, otherKind: source.otherKind, colour: source.colour };
  });
  const take = new Set();
  for (const space of add) for (const cell of space.cells) take.add(cell);
  const result = editFloor(building, index, { take, add });
  if (mode !== 'replace' && landsOn(result.loss)) {
    const under = { ...emptyLoss(), spaces: result.loss.spaces, corridorCells: result.loss.corridorCells, stairsCells: result.loss.stairsCells };
    refuse('The copy would land on top of ' + lossText(under) + ' on ' + floor.name + '. Paste it somewhere empty, or erase what is there first.', 'occupied');
  }
  // a pasted door that faces nothing here was never in this building: not a loss
  result.loss.doors = result.loss.doors.filter((door) => !add.some((space) => space.id === door.roomId));
  return { building: result.building, floorId: floor.id, loss: result.loss, removedRooms: result.removedRooms, spaceIds: add.map((space) => space.id) };
}

// ---------------------------------------------------------------- fields

function replaceSpace(building, found, next) {
  if (next === found.space) return building;
  const floors = building.floors.map((floor, index) => (index === found.floorIndex ? { ...floor, spaces: floor.spaces.map((space) => (space === found.space ? next : space)) } : floor));
  return { ...building, floors };
}

function withField(target, key, value) {
  return target[key] === value ? target : { ...target, [key]: value };
}

// A room's own fields. args: { roomId } and any of { number, subjectId, wing,
// capacity, shared }. Teachers go through actions.setRoomTeachers, which
// keeps the teacher's side in step; whether subjectId names a subject on the
// list is the action's check, since the list is not part of the building.
export function setRoomFields(building, args) {
  const found = needSpace(building, args.roomId, 'room');
  let room = found.space;
  if (args.number !== undefined) room = withField(room, 'number', needFreeNumber(building, args.number, room.id));
  if (args.subjectId !== undefined) {
    if (args.subjectId !== null && typeof args.subjectId !== 'string') refuse('A room\'s subject is one from the subject list, or none.', 'bad-value');
    room = withField(room, 'subjectId', args.subjectId);
  }
  if (args.wing !== undefined) room = withField(room, 'wing', needText(args.wing, 'A wing'));
  if (args.capacity !== undefined) {
    if (args.capacity !== null && !inRange(args.capacity, RANGES.capacity)) refuse('A capacity is a whole number from ' + RANGES.capacity[0] + ' to ' + RANGES.capacity[1] + ', or empty.', 'bad-value');
    room = withField(room, 'capacity', args.capacity);
  }
  if (args.shared !== undefined) {
    if (typeof args.shared !== 'boolean') refuse('Shared space is on or off.', 'bad-value');
    room = withField(room, 'shared', args.shared);
  }
  return { building: replaceSpace(building, found, room), floorId: found.floor.id };
}

// args: { spaceId } and any of { label, otherKind, colour }.
export function setOtherSpaceFields(building, args) {
  const found = needSpace(building, args.spaceId, 'other');
  let space = found.space;
  if (args.label !== undefined) space = withField(space, 'label', needText(args.label, 'A label'));
  if (args.otherKind !== undefined) space = withField(space, 'otherKind', needOtherKind(args.otherKind));
  if (args.colour !== undefined) space = withField(space, 'colour', needColour(args.colour));
  return { building: replaceSpace(building, found, space), floorId: found.floor.id };
}

// ---------------------------------------------------------------- doors

// Whether a door can go on this edge of this room. { ok, exists, reason }:
// `reason` is the sentence to show when it cannot, naming the side and what
// is there. Nothing is changed.
export function describeDoor(building, args) {
  const found = needSpace(building, args.roomId, 'room');
  const { floor, space } = found;
  if (!DOOR_SIDES.includes(args.side)) refuse('A door is on the north, east, south or west side of a cell.', 'bad-value');
  const side = SIDE_WORDS[args.side];
  const exists = space.doors.some((door) => door.cell === args.cell && door.side === args.side);
  const no = (reason, code) => ({ ok: false, exists, reason, code });
  if (!space.cells.includes(args.cell)) return no('That cell is not part of ' + spaceName(space) + '. A door goes on one of the room\'s own cells.', 'not-own-cell');
  const across = neighbourCell(floor, args.cell, args.side);
  if (across === -1) return no('The ' + side + ' side of that cell is the edge of the floor, so a door there would lead nowhere. Put the door on a side that faces a corridor or stairs.', 'leads-nowhere');
  if (isWalkable(floor.cells[across])) return { ok: true, exists, reason: '', code: '', leadsTo: cellKind(floor, across) };
  const owner = spaceOwners(floor).get(across);
  if (owner === space) return no('The ' + side + ' side of that cell is inside ' + spaceName(space) + '. A door goes on an outer edge of the room.', 'inner-edge');
  const there = owner ? spaceName(owner) : 'a wall';
  return no('The ' + side + ' side of that cell faces ' + there + ', so a door there would lead nowhere. Put the door on a side that faces a corridor or stairs.', 'leads-nowhere');
}

// args: { roomId, cell, side }. A door that is already there changes nothing.
export function addDoor(building, args) {
  const found = needSpace(building, args.roomId, 'room');
  const verdict = describeDoor(building, args);
  if (!verdict.ok) refuse(verdict.reason, verdict.code);
  if (verdict.exists) return { building, floorId: found.floor.id };
  const room = { ...found.space, doors: found.space.doors.concat([{ cell: args.cell, side: args.side }]) };
  return { building: replaceSpace(building, found, room), floorId: found.floor.id };
}

export function removeDoor(building, args) {
  const found = needSpace(building, args.roomId, 'room');
  const doors = found.space.doors.filter((door) => !(door.cell === args.cell && door.side === args.side));
  if (doors.length === found.space.doors.length) return { building, floorId: found.floor.id };
  return { building: replaceSpace(building, found, { ...found.space, doors }), floorId: found.floor.id };
}

// ---------------------------------------------------------------- stairs connections

function needEnd(building, end) {
  if (!end || typeof end.floorId !== 'string' || !Number.isInteger(end.cell)) refuse('An end of a connection is a floor and a cell.', 'bad-value');
  const floor = building.floors[floorIndexOf(building, end.floorId)];
  if (!inGrid(floor, end.cell) || floor.cells[end.cell] !== CELL_STAIRS) refuse('A connection joins two stairs cells, and that cell on ' + floor.name + ' is not stairs. Click a stairs cell.', 'not-stairs');
  return floor;
}

function sameEnd(a, b) {
  return a.floorId === b.floorId && a.cell === b.cell;
}

// Whether two stairs cells can be connected. `sameFloor` is the unusual case
// the interface asks about first. Refuses what connectStairs would refuse.
export function describeConnect(building, args) {
  const floorA = needEnd(building, args.a);
  const floorB = needEnd(building, args.b);
  if (sameEnd(args.a, args.b)) refuse('A connection joins two different stairs cells. Click the stairs at the other end.', 'same-cell');
  const already = building.connections.find((connection) => (sameEnd(connection.a, args.a) && sameEnd(connection.b, args.b)) || (sameEnd(connection.a, args.b) && sameEnd(connection.b, args.a)));
  if (already) refuse('Those two stairs are already connected, as ' + already.label + '.', 'already-connected');
  return { sameFloor: floorA === floorB, fromFloor: floorA.name, toFloor: floorB.name, label: nextConnectionLabel(building.connections) };
}

// Connect two stairs cells. args: { a: { floorId, cell }, b: { floorId, cell } }
// and optionally id. The letter is the first one no connection uses, and it
// never changes afterwards. A same-floor connection is allowed and flagged.
export function connectStairs(building, args, ids) {
  const verdict = describeConnect(building, args);
  const connection = {
    id: args.id || ids('c'),
    label: verdict.label,
    a: { floorId: args.a.floorId, cell: args.a.cell },
    b: { floorId: args.b.floorId, cell: args.b.cell },
    direction: 'both',
  };
  return { building: { ...building, connections: building.connections.concat([connection]) }, connectionId: connection.id, label: connection.label, sameFloor: verdict.sameFloor, fromFloor: verdict.fromFloor, toFloor: verdict.toFloor };
}

function needConnection(building, connectionId) {
  const connection = building.connections.find((candidate) => candidate.id === connectionId);
  if (!connection) refuse('That connection is no longer in the building.', 'missing');
  return connection;
}

export function disconnectStairs(building, args) {
  const connection = needConnection(building, args.connectionId);
  return { building: { ...building, connections: building.connections.filter((candidate) => candidate !== connection) }, label: connection.label, floorId: connection.a.floorId };
}

// A connection's name and direction. args: { connectionId } and any of
// { label, direction }.
export function setConnection(building, args) {
  const connection = needConnection(building, args.connectionId);
  let next = connection;
  if (args.label !== undefined) {
    if (typeof args.label !== 'string' || args.label.trim() === '') refuse('A connection has a letter or a name. Type one.', 'no-name');
    next = withField(next, 'label', args.label);
  }
  if (args.direction !== undefined) {
    if (!CONNECTION_DIRECTIONS.includes(args.direction)) refuse('A connection\'s direction is one of: ' + CONNECTION_DIRECTIONS.join(', ') + '.', 'bad-value');
    next = withField(next, 'direction', args.direction);
  }
  if (next === connection) return { building, floorId: connection.a.floorId };
  return { building: { ...building, connections: building.connections.map((candidate) => (candidate === connection ? next : candidate)) }, floorId: connection.a.floorId };
}

// ---------------------------------------------------------------- corridor names

function replaceFloor(building, index, next) {
  if (next === building.floors[index]) return building;
  return { ...building, floors: building.floors.map((floor, i) => (i === index ? next : floor)) };
}

// Name a run of corridor cells in one go. args: { floorId, cells, name } and
// optionally id. A cell has one name, so the cells leave any name they had;
// a name left with no cells goes. An empty name takes the name off the
// cells. Cells that are not corridor are left out.
export function nameCorridor(building, args, ids) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const name = needText(args.name, 'A corridor name');
  const cells = targetCells(floor, args).filter((cell) => floor.cells[cell] === CELL_CORRIDOR).sort((a, b) => a - b);
  if (cells.length === 0) refuse('None of those cells is a corridor cell. Select corridor cells to name them.', 'not-corridor');
  const chosen = new Set(cells);
  const target = name === '' ? null : floor.corridors.find((corridor) => corridor.name === name) || null;
  const corridors = [];
  let corridorId = target ? target.id : null;
  for (const corridor of floor.corridors) {
    if (corridor === target) {
      const merged = Array.from(new Set(corridor.cells.concat(cells))).sort((a, b) => a - b);
      corridors.push(merged.length === corridor.cells.length ? corridor : { ...corridor, cells: merged });
      continue;
    }
    const kept = corridor.cells.filter((cell) => !chosen.has(cell));
    if (kept.length === corridor.cells.length) corridors.push(corridor);
    else if (kept.length > 0) corridors.push({ ...corridor, cells: kept });
  }
  if (name !== '' && !target) {
    corridorId = args.id || ids('k');
    corridors.push({ id: corridorId, name, cells });
  }
  if (sameItems(corridors, floor.corridors)) return { building, floorId: floor.id, corridorId };
  return { building: replaceFloor(building, index, { ...floor, corridors }), floorId: floor.id, corridorId };
}

function needCorridor(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const corridor = building.floors[index].corridors.find((candidate) => candidate.id === args.corridorId);
  if (!corridor) refuse('That corridor name is no longer on the floor.', 'missing');
  return { index, floor: building.floors[index], corridor };
}

// args: { floorId, corridorId, name }.
export function renameCorridor(building, args) {
  const { index, floor, corridor } = needCorridor(building, args);
  if (typeof args.name !== 'string' || args.name === '') refuse('A corridor name is text. To take the name off, remove it instead.', 'no-name');
  if (corridor.name === args.name) return { building, floorId: floor.id, was: corridor.name };
  return { building: replaceFloor(building, index, { ...floor, corridors: floor.corridors.map((candidate) => (candidate === corridor ? { ...corridor, name: args.name } : candidate)) }), floorId: floor.id, was: corridor.name };
}

export function removeCorridorName(building, args) {
  const { index, floor, corridor } = needCorridor(building, args);
  return { building: replaceFloor(building, index, { ...floor, corridors: floor.corridors.filter((candidate) => candidate !== corridor) }), floorId: floor.id, was: corridor.name };
}

// ---------------------------------------------------------------- exits

// Whether a cell can be an exit: { ok, exists, reason }.
export function describeExit(building, args) {
  const floor = building.floors[floorIndexOf(building, args.floorId)];
  if (!inGrid(floor, args.cell)) refuse('Cell ' + args.cell + ' is not on ' + floor.name + '.', 'off-floor');
  const exists = floor.exits.some((exit) => exit.cell === args.cell);
  if (floor.cells[args.cell] !== CELL_CORRIDOR) return { ok: false, exists, code: 'not-corridor', reason: 'An exit is on a corridor cell, and that cell is ' + { stairs: 'stairs', room: 'part of a room', other: 'part of another space', empty: 'empty' }[cellKind(floor, args.cell)] + '. Paint a corridor to the building\'s edge and mark its last cell.' };
  if (!isEdgeCorridorCell(floor, args.cell)) return { ok: false, exists, code: 'not-edge', reason: 'That corridor cell is in the middle of the building: every side of it is a room, a space or more corridor. An exit is on a corridor cell at the building\'s edge, with an empty cell or the edge of the floor beside it.' };
  return { ok: true, exists, code: '', reason: '' };
}

// Mark an edge corridor cell as an exit. args: { floorId, cell } and
// optionally doorName, assembly, id. A cell that is already an exit is left
// as it is.
export function markExit(building, args, ids) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const verdict = describeExit(building, args);
  if (!verdict.ok) refuse(verdict.reason, verdict.code);
  if (verdict.exists) return { building, floorId: floor.id, exitId: floor.exits.find((exit) => exit.cell === args.cell).id };
  const exit = {
    id: args.id || ids('x'),
    cell: args.cell,
    doorName: needText(args.doorName === undefined ? '' : args.doorName, 'A door name'),
    assembly: needText(args.assembly === undefined ? '' : args.assembly, 'An assembly point'),
  };
  return { building: replaceFloor(building, index, { ...floor, exits: floor.exits.concat([exit]) }), floorId: floor.id, exitId: exit.id };
}

function needExit(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const exit = building.floors[index].exits.find((candidate) => (args.exitId !== undefined ? candidate.id === args.exitId : candidate.cell === args.cell));
  if (!exit) refuse('That exit is no longer on the floor.', 'missing');
  return { index, floor: building.floors[index], exit };
}

// args: { floorId, exitId } and any of { doorName, assembly }.
export function setExit(building, args) {
  const { index, floor, exit } = needExit(building, args);
  let next = exit;
  if (args.doorName !== undefined) next = withField(next, 'doorName', needText(args.doorName, 'A door name'));
  if (args.assembly !== undefined) next = withField(next, 'assembly', needText(args.assembly, 'An assembly point'));
  if (next === exit) return { building, floorId: floor.id };
  return { building: replaceFloor(building, index, { ...floor, exits: floor.exits.map((candidate) => (candidate === exit ? next : candidate)) }), floorId: floor.id };
}

// args: { floorId } and exitId or cell.
export function unmarkExit(building, args) {
  const { index, floor, exit } = needExit(building, args);
  return { building: replaceFloor(building, index, { ...floor, exits: floor.exits.filter((candidate) => candidate !== exit) }), floorId: floor.id, doorName: exit.doorName };
}

// ---------------------------------------------------------------- exclusion zones

function needZoneRect(floor, x, y, w, h) {
  const whole = [x, y, w, h].every(Number.isInteger);
  if (!whole || w < 1 || h < 1 || x < 0 || y < 0 || x + w > floor.width || y + h > floor.height) refuse('An exclusion zone is a rectangle of whole cells inside ' + floor.name + '. Draw it on the floor.', 'bad-value');
}

// args: { floorId, x, y, w, h } and optionally label, id.
export function addZone(building, args, ids) {
  const floor = building.floors[floorIndexOf(building, args.floorId)];
  needZoneRect(floor, args.x, args.y, args.w, args.h);
  const zone = { id: args.id || ids('z'), floorId: floor.id, label: needText(args.label === undefined ? '' : args.label, 'A zone label'), x: args.x, y: args.y, w: args.w, h: args.h };
  return { building: { ...building, zones: building.zones.concat([zone]) }, zoneId: zone.id, floorId: floor.id };
}

function needZone(building, zoneId) {
  const zone = building.zones.find((candidate) => candidate.id === zoneId);
  if (!zone) refuse('That exclusion zone is no longer in the building.', 'missing');
  return zone;
}

// args: { zoneId } and any of { label, x, y, w, h }.
export function setZone(building, args) {
  const zone = needZone(building, args.zoneId);
  let next = zone;
  if (args.label !== undefined) next = withField(next, 'label', needText(args.label, 'A zone label'));
  for (const key of ['x', 'y', 'w', 'h']) if (args[key] !== undefined) next = withField(next, key, args[key]);
  if (next === zone) return { building, floorId: zone.floorId };
  needZoneRect(building.floors[floorIndexOf(building, zone.floorId)], next.x, next.y, next.w, next.h);
  return { building: { ...building, zones: building.zones.map((candidate) => (candidate === zone ? next : candidate)) }, floorId: zone.floorId };
}

export function removeZone(building, args) {
  const zone = needZone(building, args.zoneId);
  return { building: { ...building, zones: building.zones.filter((candidate) => candidate !== zone) }, floorId: zone.floorId, label: zone.label };
}

// ---------------------------------------------------------------- resize

// Resize a floor from any edge without clearing it. args: { floorId } and any
// of { left, right, top, bottom }: cells added at that edge, or taken away
// when negative. Everything drawn keeps its place relative to the building.
// What falls outside the new size is cut, and `loss` lists it: spaces removed
// or cut, corridor and stairs cells, connections, exits, doors, corridor
// names, zones. Run describeResize first and ask.
export function resizeFloor(building, args) {
  const index = floorIndexOf(building, args.floorId);
  const floor = building.floors[index];
  const edges = ['left', 'right', 'top', 'bottom'].map((edge) => (args[edge] === undefined ? 0 : args[edge]));
  if (!edges.every(Number.isInteger)) refuse('A floor is resized by a whole number of cells at each edge.', 'bad-value');
  const [left, right, top, bottom] = edges;
  const width = floor.width + left + right;
  const height = floor.height + top + bottom;
  const empty = { building, floorId: floor.id, width, height, loss: emptyLoss(), removedRooms: [] };
  if (edges.every((edge) => edge === 0)) return empty;
  if (!inRange(width, RANGES.floorSize) || !inRange(height, RANGES.floorSize)) refuse('A floor is from ' + RANGES.floorSize[0] + ' to ' + RANGES.floorSize[1] + ' cells each way, and that would make ' + floor.name + ' ' + width + ' by ' + height + '. Pick a size in that range.', 'bad-size');

  // where an old cell goes, or -1 when it is cut
  const move = (cell) => {
    const x = (cell % floor.width) + left;
    const y = Math.floor(cell / floor.width) + top;
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x;
  };
  const loss = emptyLoss();
  const removedRooms = [];

  const characters = new Array(width * height).fill(CELL_EMPTY);
  for (let cell = 0; cell < floor.cells.length; cell += 1) {
    const character = floor.cells[cell];
    if (character === CELL_EMPTY) continue;
    const to = move(cell);
    if (to !== -1) characters[to] = character;
    else if (character === CELL_CORRIDOR) loss.corridorCells += 1;
    else loss.stairsCells += 1;
  }

  const spaces = [];
  for (const space of floor.spaces) {
    const cells = space.cells.map(move).filter((cell) => cell !== -1);
    const lost = space.cells.length - cells.length;
    if (lost > 0) loss.spaces.push({ id: space.id, kind: space.kind, name: spaceName(space), cells: lost, of: space.cells.length, removed: cells.length === 0 });
    if (cells.length === 0) {
      if (space.kind === 'room') removedRooms.push(space);
      continue;
    }
    const next = { ...space, cells };
    if (space.kind === 'room') {
      next.doors = [];
      for (const door of space.doors) {
        const cell = move(door.cell);
        if (cell !== -1) next.doors.push({ cell, side: door.side });
        else loss.doors.push({ roomId: space.id, name: spaceName(space), cell: door.cell, side: door.side });
      }
    }
    spaces.push(next);
  }

  const corridors = [];
  for (const corridor of floor.corridors) {
    const cells = corridor.cells.map(move).filter((cell) => cell !== -1);
    if (cells.length < corridor.cells.length) loss.corridorNames.push({ id: corridor.id, name: corridor.name, cells: corridor.cells.length - cells.length, removed: cells.length === 0 });
    if (cells.length > 0) corridors.push({ ...corridor, cells });
  }

  const exits = [];
  for (const exit of floor.exits) {
    const cell = move(exit.cell);
    if (cell !== -1) exits.push({ ...exit, cell });
    else loss.exits.push({ id: exit.id, doorName: exit.doorName, cell: exit.cell });
  }

  const connections = [];
  for (const connection of building.connections) {
    const ends = [connection.a, connection.b].map((end) => (end.floorId === floor.id ? { floorId: end.floorId, cell: move(end.cell) } : end));
    if (ends.some((end) => end.cell === -1)) loss.connections.push({ id: connection.id, label: connection.label });
    else connections.push(connection.a.floorId === floor.id || connection.b.floorId === floor.id ? { ...connection, a: ends[0], b: ends[1] } : connection);
  }

  const zones = [];
  for (const zone of building.zones) {
    if (zone.floorId !== floor.id) {
      zones.push(zone);
      continue;
    }
    const x0 = Math.max(0, zone.x + left);
    const y0 = Math.max(0, zone.y + top);
    const x1 = Math.min(width, zone.x + left + zone.w);
    const y1 = Math.min(height, zone.y + top + zone.h);
    if (x1 <= x0 || y1 <= y0) loss.zones.push({ id: zone.id, label: zone.label });
    else zones.push({ ...zone, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  // the traced image stays under the same part of the plan
  const image = floor.image && (left !== 0 || top !== 0) ? { ...floor.image, x: floor.image.x + left, y: floor.image.y + top } : floor.image;
  const resized = { ...floor, width, height, cells: characters.join(''), spaces, corridors, exits, image };
  const floors = building.floors.map((candidate, i) => (i === index ? resized : candidate));
  const next = settle({ ...building, floors, connections, zones }, index, resized, loss);
  return { building: next, floorId: floor.id, width, height, loss, removedRooms };
}

// What a resize would cut, before it happens. Nothing is changed. Refuses a
// size out of range the way resizeFloor does.
export function describeResize(building, args) {
  const result = resizeFloor(building, args);
  return { width: result.width, height: result.height, loss: result.loss, removedRooms: result.removedRooms, losesData: isLoss(result.loss) };
}

// ---------------------------------------------------------------- counts

function countCharacter(text, character) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) if (text[i] === character) count += 1;
  return count;
}

// The live counts of spec 4.10, for the whole building and per floor.
// `unconnectedStairs` counts stairs cells that no connection names.
export function counts(building) {
  const connected = new Set();
  for (const connection of building.connections) for (const end of [connection.a, connection.b]) connected.add(end.floorId + ':' + end.cell);
  const total = { floors: building.floors.length, rooms: 0, numberedRooms: 0, otherSpaces: 0, corridorCells: 0, stairsCells: 0, unconnectedStairs: 0, connections: building.connections.length, exits: 0, zones: building.zones.length, byFloor: {} };
  for (const floor of building.floors) {
    const rooms = floor.spaces.filter((space) => space.kind === 'room');
    const own = {
      rooms: rooms.length,
      numberedRooms: rooms.filter((room) => room.number.trim() !== '').length,
      otherSpaces: floor.spaces.length - rooms.length,
      corridorCells: countCharacter(floor.cells, CELL_CORRIDOR),
      stairsCells: countCharacter(floor.cells, CELL_STAIRS),
      unconnectedStairs: 0,
      exits: floor.exits.length,
    };
    for (let cell = floor.cells.indexOf(CELL_STAIRS); cell !== -1; cell = floor.cells.indexOf(CELL_STAIRS, cell + 1)) {
      if (!connected.has(floor.id + ':' + cell)) own.unconnectedStairs += 1;
    }
    total.byFloor[floor.id] = own;
    for (const key of Object.keys(own)) total[key] += own[key];
  }
  return total;
}

// What is at one cell, for the status line: its column and row (from 0), what
// kind of cell it is, and the space, corridor name, exit and connections there.
export function describeCell(building, floorId, cell) {
  const floor = building.floors[floorIndexOf(building, floorId)];
  if (!inGrid(floor, cell)) return null;
  const corridor = floor.corridors.find((candidate) => candidate.cells.includes(cell)) || null;
  return {
    x: cell % floor.width,
    y: Math.floor(cell / floor.width),
    kind: cellKind(floor, cell),
    space: spaceOwners(floor).get(cell) || null,
    corridorName: corridor ? corridor.name : '',
    exit: floor.exits.find((exit) => exit.cell === cell) || null,
    connections: building.connections.filter((connection) => (connection.a.floorId === floorId && connection.a.cell === cell) || (connection.b.floorId === floorId && connection.b.cell === cell)),
  };
}
