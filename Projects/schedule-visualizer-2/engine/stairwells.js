// Stairwells: one letter over the stairs flights of three or more floors
// (ARCHITECTURE 22.2, 22.4, 22.17; spec 4.5's wish).
//
// A stairwell is not an object of its own. It is the stairs connections that
// share a `well` letter, as an elevator is the connections that share a `car`,
// so routing, load, evacuation and step-free read every flight as the plain
// connection it is, and a project saved by an older planner opens as plain
// flights. `stairwells(building)` (schema.js) derives the wells; this module
// holds the actions that change them. Each is an `action` with its label and
// its counters (GEOMETRY and BUILDING) and so one undo step; each refuses in
// words that say what was wrong and what to do; each reports what it did in a
// sentence the caller shows (`reporting`, read back with `scheduleOutcome`).
//
//   makeStairwell        the flights that run on from one flight become one well
//   stairwellThrough     one stairwell from one stairs cell through chosen floors
//   addStairwellStop     a well gains a stop on one more floor
//   removeStairwellStop  a well loses one stop, the stops either side rejoined
//   splitStairwell       the flights show their own letters again
//   setStairwellDirection  one way for every flight, `up`/`down` per flight
//   setStairwellLetter   the well's letter, with the clash rule of every label
//   joinStairwell        the parts of a well that came apart, one flight between
//
// The in-session mend (a well left in two parts by a disconnect, a deleted or
// resized floor or a repaint) is `splitWells` in building.js, run from
// `splitCars` beside the elevator mend. `joinStairwell` is the fix the
// building check `stairwell-split` offers for a file edited elsewhere.

import { action, ActionError, GEOMETRY, BUILDING, reporting, scheduleOutcome } from './actions.js';
import { splitWells, renamedText, emptyLoss } from './building.js';
import { stairwells, stairsLetter, nextConnectionLabel, nameKey, cellKind, isLiftCell, textLength, WELL_MOST, ELEVATOR_KIND, CELL_STAIRS } from './schema.js';

function refuse(message, code) {
  throw new ActionError(message, code);
}

// ---------------------------------------------------------------- reading

const isStairs = (connection) => Boolean(connection) && connection.kind !== ELEVATOR_KIND;
const hasWell = (connection) => typeof connection.well === 'string' && connection.well.trim() !== '';
const sameEnd = (x, y) => x.floorId === y.floorId && x.cell === y.cell;
const endKey = (end) => end.floorId + ':' + end.cell;

function floorById(building, floorId) {
  return building.floors.find((floor) => floor.id === floorId) || null;
}

function levelOf(building, floorId) {
  const at = building.floors.findIndex((floor) => floor.id === floorId);
  if (at === -1) return { level: Infinity, index: Infinity };
  return { level: Number.isInteger(building.floors[at].level) ? building.floors[at].level : at, index: at };
}

// Negative when end x is lower in the building than end y.
function lowerFirst(building, x, y) {
  const [p, q] = [levelOf(building, x.floorId), levelOf(building, y.floorId)];
  return p.level - q.level || p.index - q.index || x.cell - y.cell;
}

function floorName(building, floorId) {
  const floor = floorById(building, floorId);
  return floor ? floor.name : '';
}

// "Floors 1, 2 and 3" for floors named "Floor 1"…; else the names as typed.
function sentenceList(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

function floorsWords(names) {
  const numbered = names.map((name) => /^Floor (\S+)$/.exec(name));
  if (names.length > 1 && numbered.every(Boolean)) return 'Floors ' + sentenceList(numbered.map((match) => match[1]));
  return sentenceList(names);
}

function cellWords(floor, cell) {
  return 'row ' + (Math.floor(cell / floor.width) + 1) + ', column ' + ((cell % floor.width) + 1);
}

// The well a payload names (by letter, nameKey), whole or in parts.
function needWell(building, letter) {
  if (typeof letter !== 'string' || letter.trim() === '') refuse('Name a stairwell by its letter.', 'bad-value');
  const found = stairwells(building).find((well) => nameKey(well.letter) === nameKey(letter));
  if (!found) refuse('There is no Stairwell ' + letter.trim() + ' in the building any more.', 'missing');
  return found;
}

function flightsOfWell(building, well) {
  const ids = new Set(well.connectionIds);
  return building.connections.filter((connection) => ids.has(connection.id));
}

function needFlight(building, connectionId) {
  const found = typeof connectionId === 'string' ? building.connections.find((connection) => connection.id === connectionId) : null;
  if (!found) refuse('That connection is no longer in the building.', 'missing');
  return found;
}

// Which way a flight runs, as the building sees it: 'up', 'down' or 'both'
// (its `direction` is from its a end or from its b end). A same-level flight
// has no up or down; it reads as its own direction word.
function wayOfFlight(building, flight) {
  if (flight.direction !== 'ab' && flight.direction !== 'ba') return 'both';
  const [a, b] = [levelOf(building, flight.a.floorId), levelOf(building, flight.b.floorId)];
  if (a.level === b.level) return flight.direction;
  const lowToHigh = a.level < b.level ? 'ab' : 'ba';
  return flight.direction === lowToHigh ? 'up' : 'down';
}

// The `direction` a flight writes to run `way` ('up', 'down' or 'both').
function directionForWay(building, flight, way) {
  if (way === 'both') return 'both';
  const [a, b] = [levelOf(building, flight.a.floorId), levelOf(building, flight.b.floorId)];
  const lowToHigh = a.level < b.level ? 'ab' : 'ba';
  const highToLow = lowToHigh === 'ab' ? 'ba' : 'ab';
  return way === 'up' ? lowToHigh : highToLow;
}

// What a set of flights agree on: their way when they all run one way, else
// 'both'.
function sharedWay(building, flights) {
  if (flights.length === 0) return 'both';
  const ways = new Set(flights.map((flight) => wayOfFlight(building, flight)));
  return ways.size === 1 && !ways.has('ab') && !ways.has('ba') ? Array.from(ways)[0] : 'both';
}

// Every label, well letter and car letter in use, as nextConnectionLabel reads them.
function lettersInUse(building) {
  return building.connections.flatMap((connection) => [{ label: connection.label, well: connection.well }, { label: connection.car === undefined ? '' : connection.car }]);
}

function freshId(building, ctx) {
  const taken = new Set(building.connections.map((connection) => connection.id));
  let id = ctx.ids('c');
  for (let tries = 0; taken.has(id) && tries < 20; tries += 1) id = ctx.ids('c');
  return id;
}

// A letter the school typed for a stairwell: 1 to WELL_MOST characters,
// trimmed, and not used as any other flight's label, any other well's letter,
// or an elevator's letter (compared as names are, nameKey). `own` is the set of
// connection ids the letter may match (the flights of the well itself).
function needLetter(building, value, own) {
  if (typeof value !== 'string' || value.trim() === '') refuse('A stairwell has a letter or a name. Type one.', 'no-name');
  const letter = value.trim();
  if (textLength(letter) > WELL_MOST) refuse('A stairwell\'s letter or name is at most ' + WELL_MOST + ' characters, and this one has ' + textLength(letter) + '. Shorten it.', 'too-long');
  for (const connection of building.connections) {
    if (own.has(connection.id)) continue;
    if (connection.kind === ELEVATOR_KIND && [connection.label, connection.car].some((word) => typeof word === 'string' && nameKey(word) === nameKey(letter))) {
      refuse('Elevator ' + (connection.car || connection.label) + ' already uses that letter. Each has its own letter or name; type a different one.', 'duplicate-label');
    }
    if (hasWell(connection) && nameKey(connection.well) === nameKey(letter)) refuse('Stairwell ' + connection.well.trim() + ' already uses that letter. Each has its own letter or name; type a different one.', 'duplicate-label');
    if (!hasWell(connection) && typeof connection.label === 'string' && nameKey(connection.label) === nameKey(letter)) {
      refuse('There is already a stairs connection ' + connection.label + '. Each has its own letter or name; type a different one.', 'duplicate-label');
    }
  }
  return letter;
}

function withConnections(project, connections, cells) {
  const building = { ...project.building, connections };
  return { ...project, building: cells ? { ...building, floors: cells } : building };
}

function report(project, next, text, floorId, extra) {
  return reporting(project, next, { text, floorId, ...extra });
}

// The renaming `splitWells` did, when taking a stop out left a well in two.
function mended(building) {
  const loss = emptyLoss();
  const next = splitWells(building, loss);
  return { building: next, text: renamedText(loss) };
}

const focusOn = (before, payload, after) => {
  const outcome = after && typeof after === 'object' ? reportedFloor(after) : null;
  return { section: 'building', floorId: outcome || payload.floorId || null };
};

function reportedFloor(project) {
  const outcome = scheduleOutcome(project);
  return outcome && typeof outcome.floorId === 'string' ? outcome.floorId : null;
}

// ---------------------------------------------------------------- make one

// The stairs flights that run on from `start` through shared cells, never
// through an elevator, in building order.
function runFrom(building, start) {
  const flights = building.connections.filter(isStairs);
  const run = new Set([start.id]);
  const cells = new Set([endKey(start.a), endKey(start.b)]);
  for (let grown = true; grown;) {
    grown = false;
    for (const flight of flights) {
      if (run.has(flight.id)) continue;
      if (!cells.has(endKey(flight.a)) && !cells.has(endKey(flight.b))) continue;
      run.add(flight.id);
      cells.add(endKey(flight.a));
      cells.add(endKey(flight.b));
      grown = true;
    }
  }
  return flights.filter((flight) => run.has(flight.id));
}

// The stops of a set of flights: one per cell, lowest first. A floor with two
// stops is the "floor reached twice" refusal's business.
function stopsOf(building, flights) {
  const seen = new Map();
  for (const flight of flights) for (const end of [flight.a, flight.b]) if (!seen.has(endKey(end))) seen.set(endKey(end), { floorId: end.floorId, cell: end.cell });
  return Array.from(seen.values()).sort((x, y) => lowerFirst(building, x, y));
}

function refuseTwice(building, flights, stops, names) {
  for (const stop of stops) {
    const same = stops.filter((other) => other.floorId === stop.floorId);
    if (same.length < 2) continue;
    const floor = floorById(building, stop.floorId);
    const where = same.map((other) => cellWords(floor, other.cell));
    refuse(names + ' would stop twice on ' + floor.name + ': at ' + where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] + '. Remove one connection first.', 'floor-twice');
  }
}

const TWO_FLOORS = 'These stairs join only two floors; a stairwell is for three or more.';

// payload: { connectionId, letter? }. The flights that run on from that one
// through shared cells become one stairwell. Its letter is `letter` when one is
// typed (the clash rule of every label applies), else the label of the flight
// whose lower end is lowest. Refused: a run of fewer than three floors, a floor
// the run reaches twice, a flight already in a stairwell. Elevators are never
// in a run.
export const makeStairwell = action(
  { label: (before, payload, after) => 'Make one stairwell' + (reportedLetter(after) === '' ? '' : ', Stairwell ' + reportedLetter(after)), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload) => {
    const building = project.building;
    const start = needFlight(building, payload.connectionId);
    if (!isStairs(start)) refuse('An elevator is not part of a stairwell: its stops are one elevator already. Choose a stairs connection.', 'elevator');
    const run = runFrom(building, start);
    const wells = new Set(run.filter(hasWell).map((flight) => flight.well.trim()));
    if (wells.size > 0) refuse(run.filter(hasWell).length === run.length ? 'These stairs are already one stairwell, ' + Array.from(wells)[0] + '.' : 'Some of these stairs are already part of Stairwell ' + Array.from(wells)[0] + '. Split it first, or add the other floors to it.', 'already-well');
    if (run.length < 2) refuse(TWO_FLOORS, 'two-floors');
    const stops = stopsOf(building, run);
    const names = 'Stairs ' + sentenceList(run.map((flight) => stairsLetter(flight)));
    refuseTwice(building, run, stops, names);
    const lowest = run.slice().sort((x, y) => Math.min(...[x.a, x.b].map((end) => levelOf(building, end.floorId).level)) - Math.min(...[y.a, y.b].map((end) => levelOf(building, end.floorId).level)))[0];
    const own = new Set(run.map((flight) => flight.id));
    const letter = needLetter(building, payload.letter === undefined ? lowest.label : payload.letter, own);
    const connections = building.connections.map((connection) => (own.has(connection.id) ? { ...connection, well: letter } : connection));
    const floors = stops.map((stop) => floorName(building, stop.floorId));
    const changed = run.map((flight) => stairsLetter(flight)).filter((word) => nameKey(word) !== nameKey(letter));
    const text = names + ' are now Stairwell ' + letter + ', on ' + floorsWords(floors) + '.' + (changed.length > 0 ? ' It reads ' + letter + ' on every floor; ' + sentenceList(changed) + (changed.length === 1 ? ' is' : ' are') + ' not shown any more.' : '');
    return report(project, withConnections(project, connections), text, stops[0].floorId, { letter, flights: run.length, stops: stops.length, floors });
  },
);

function reportedLetter(project) {
  const outcome = project && typeof project === 'object' ? scheduleOutcome(project) : null;
  return outcome && typeof outcome.letter === 'string' ? outcome.letter : '';
}

// ---------------------------------------------------------------- through floors

// payload: { floorId, cell, floorIds }. From the stairs cell, one stairwell
// through the chosen floors (and this one) at the same row and column on each.
// A cell that is stairs or empty will do (an empty one becomes stairs, said in
// the summary); a corridor, a room, another space or an elevator stop there
// refuses, naming the floor and what is there. Flights join consecutive floors
// by level: a flight that already joins those two cells is kept and given the
// well; a missing one is made. The letter is the first no label or well uses.
export const stairwellThrough = action(
  { label: (before, payload, after) => 'Join ' + floorsWords(throughNames(before, payload)) + ' as one stairwell' + (reportedLetter(after) === '' ? '' : ', Stairwell ' + reportedLetter(after)), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload, ctx) => {
    const building = project.building;
    const origin = floorById(building, payload.floorId);
    if (!origin) refuse('That floor is no longer in the building.', 'missing');
    if (!Number.isInteger(payload.cell) || payload.cell < 0 || payload.cell >= origin.width * origin.height) refuse('A stairwell starts at a cell of the floor.', 'bad-value');
    if (!Array.isArray(payload.floorIds) || payload.floorIds.some((id) => typeof id !== 'string')) refuse('Choose the floors the stairwell runs through.', 'bad-value');
    if (cellKind(origin, payload.cell, building) === 'elevator') refuse('That is an elevator stop on ' + origin.name + ', not stairs. An elevator is one elevator already; choose a stairs cell.', 'elevator');
    if (origin.cells[payload.cell] !== CELL_STAIRS) refuse('A stairwell starts at a stairs cell, and that cell on ' + origin.name + ' is not stairs. Choose a stairs cell.', 'not-stairs');
    const chosen = Array.from(new Set([origin.id, ...payload.floorIds]));
    const floors = chosen.map((id) => {
      const floor = floorById(building, id);
      if (!floor) refuse('One of those floors is no longer in the building.', 'missing');
      return floor;
    }).sort((x, y) => lowerFirst(building, { floorId: x.id, cell: 0 }, { floorId: y.id, cell: 0 }));
    if (floors.length < 3) refuse(TWO_FLOORS, 'two-floors');
    const x = payload.cell % origin.width;
    const y = Math.floor(payload.cell / origin.width);
    const stops = floors.map((floor) => {
      if (x >= floor.width || y >= floor.height) refuse(floor.name + ' has no ' + cellWords(origin, payload.cell) + ': it is smaller than ' + origin.name + '. The stairs must be at the same row and column on every floor; leave ' + floor.name + ' out, or make it larger first.', 'off-floor');
      return { floor, cell: y * floor.width + x };
    });
    const made = [];
    for (const stop of stops) {
      const kind = cellKind(stop.floor, stop.cell, building);
      if (kind === 'stairs') continue;
      if (kind === 'elevator') refuse(stop.floor.name + ' has an elevator stop at ' + cellWords(stop.floor, stop.cell) + ', which a stairwell cannot use. Leave ' + stop.floor.name + ' out, or choose a stairs cell at another place.', 'elevator');
      if (kind === 'empty') {
        made.push(stop);
        continue;
      }
      const what = kind === 'corridor' ? 'a corridor' : kind === 'room' ? roomWords(stop.floor, stop.cell) : 'another space' + otherWords(stop.floor, stop.cell);
      refuse(stop.floor.name + ' has ' + what + ' at ' + cellWords(stop.floor, stop.cell) + ', so the stairs cannot go there. Leave ' + stop.floor.name + ' out, or choose stairs at another place.', 'blocked');
    }
    // the stairs flights between the chosen cells that are there already
    const joined = (p, q) => building.connections.find((connection) => isStairs(connection) && ((sameEnd(connection.a, p) && sameEnd(connection.b, q)) || (sameEnd(connection.a, q) && sameEnd(connection.b, p))));
    const ends = stops.map((stop) => ({ floorId: stop.floor.id, cell: stop.cell }));
    const kept = new Map();
    for (let i = 0; i + 1 < ends.length; i += 1) {
      const have = joined(ends[i], ends[i + 1]);
      if (!have) continue;
      if (hasWell(have)) refuse('Stairs ' + stairsLetter(have) + ' between ' + floorName(building, ends[i].floorId) + ' and ' + floorName(building, ends[i + 1].floorId) + ' is already part of a stairwell. Split Stairwell ' + have.well.trim() + ' first, or leave one of those floors out.', 'already-well');
      kept.set(i, have);
    }
    const pool = lettersInUse(building);
    const letter = nextConnectionLabel(pool);
    // a new flight's own label is the first free one after the well's letter, so
    // each flight shows its own letter again when the stairwell is split
    const used = pool.concat([{ label: letter }]);
    let connections = building.connections;
    const taken = new Set(connections.map((connection) => connection.id));
    const ids = (kind) => {
      let id = ctx.ids(kind);
      for (let tries = 0; taken.has(id) && tries < 20; tries += 1) id = ctx.ids(kind);
      taken.add(id);
      return id;
    };
    const keptIds = new Set(Array.from(kept.values(), (flight) => flight.id));
    connections = connections.map((connection) => (keptIds.has(connection.id) ? { ...connection, well: letter } : connection));
    const added = [];
    for (let i = 0; i + 1 < ends.length; i += 1) {
      if (kept.has(i)) continue;
      const label = added.length === 0 ? letter : nextConnectionLabel(used);
      used.push({ label });
      added.push({ id: ids('c'), label, well: letter, a: ends[i], b: ends[i + 1], direction: 'both' });
    }
    connections = connections.concat(added);
    const changed = made.length > 0 ? building.floors.map((floor) => {
      const stop = made.find((entry) => entry.floor.id === floor.id);
      return stop ? { ...floor, cells: floor.cells.slice(0, stop.cell) + CELL_STAIRS + floor.cells.slice(stop.cell + 1) } : floor;
    }) : null;
    const names = floors.map((floor) => floor.name);
    const text = 'Stairwell ' + letter + ' now runs through ' + floorsWords(names) + ' at ' + cellWords(origin, payload.cell) + ' (' + (added.length === 1 ? '1 flight made' : added.length + ' flights made') + (kept.size > 0 ? ', ' + (kept.size === 1 ? '1 kept' : kept.size + ' kept') : '') + ')' + (made.length > 0 ? '. Stairs were drawn on ' + sentenceList(made.map((stop) => stop.floor.name)) + '.' : '.');
    return report(project, withConnections(project, connections, changed), text, origin.id, { letter, flights: ends.length - 1, made: made.map((stop) => ({ floorId: stop.floor.id, cell: stop.cell })), floors: names });
  },
);

function throughNames(project, payload) {
  const building = project.building;
  const ids = new Set([payload.floorId, ...(Array.isArray(payload.floorIds) ? payload.floorIds : [])]);
  return building.floors.filter((floor) => ids.has(floor.id)).sort((x, y) => lowerFirst(building, { floorId: x.id, cell: 0 }, { floorId: y.id, cell: 0 })).map((floor) => floor.name);
}

function roomWords(floor, cell) {
  const room = floor.spaces.find((space) => space.kind === 'room' && space.cells.includes(cell));
  return room ? (room.number.trim() === '' ? 'an unnumbered room' : 'Room ' + room.number) : 'a room';
}

function otherWords(floor, cell) {
  const space = floor.spaces.find((each) => each.kind === 'other' && each.cells.includes(cell));
  return space && space.label.trim() !== '' ? ' (' + space.label.trim() + ')' : '';
}

// ---------------------------------------------------------------- add and remove a stop

// payload: { well, floorId, cell }. The stairwell stops on one more floor: one
// flight from the nearest stop by level (the lower one on a tie), carrying the
// well and its way. The cell must be stairs, not an elevator stop. Refused when
// the well already stops on that floor, or is in parts (join them first).
export const addStairwellStop = action(
  { label: (before, payload) => 'Add ' + floorName(before.building, payload.floorId) + ' to Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : ''), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload, ctx) => {
    const building = project.building;
    const well = needWell(building, payload.well);
    const floor = floorById(building, payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    if (!Number.isInteger(payload.cell) || payload.cell < 0 || payload.cell >= floor.width * floor.height) refuse('A stop is a cell of the floor.', 'bad-value');
    if (well.parts > 1) refuse('Stairwell ' + well.letter + ' is in ' + well.parts + ' parts that share no stairs. Join the parts first, then add a floor.', 'well-parts');
    if (well.stops.some((stop) => stop.floorId === floor.id)) refuse('Stairwell ' + well.letter + ' already stops on ' + floor.name + '. A stairwell stops once on each floor; choose a floor it does not serve, or remove that stop first.', 'floor-twice');
    if (floor.cells[payload.cell] !== CELL_STAIRS) refuse('A stairwell stop is a stairs cell, and that cell on ' + floor.name + ' is not stairs. Click a stairs cell.', 'not-stairs');
    if (isLiftCell(building, floor.id, payload.cell)) refuse('That is an elevator stop on ' + floor.name + '. An elevator is one elevator already; click a stairs cell.', 'elevator');
    const here = { floorId: floor.id, cell: payload.cell };
    const level = levelOf(building, floor.id).level;
    // the nearest stop by level; on a tie the lower one
    const nearest = well.stops.slice().sort((p, q) => Math.abs(levelOf(building, p.floorId).level - level) - Math.abs(levelOf(building, q.floorId).level - level) || lowerFirst(building, p, q))[0];
    const flights = flightsOfWell(building, well);
    const way = sharedWay(building, flights);
    const flight = { id: freshId(building, ctx), label: nextConnectionLabel(lettersInUse(building)), well: well.letter, a: { floorId: nearest.floorId, cell: nearest.cell }, b: here, direction: 'both' };
    flight.direction = directionForWay(building, flight, way);
    const text = 'Stairwell ' + well.letter + ' now stops on ' + floor.name + ' as well, reached from ' + floorName(building, nearest.floorId) + '.';
    return report(project, withConnections(project, building.connections.concat([flight])), text, floor.id, { letter: well.letter, floorId: floor.id });
  },
);

// payload: { well, floorId }. Takes the stop on that floor out of the
// stairwell: the flights touching it go and, when it lay between two others,
// one flight joins the stop below and the stop above, carrying the well and
// the way the removed flights agreed on (both when they did not). The stairs
// cell stays (an unconnected stair is a building check). Refused on a stairwell
// of two stops (disconnect the flight), on a floor it does not stop on, and on
// one in parts.
export const removeStairwellStop = action(
  { label: (before, payload) => 'Remove ' + floorName(before.building, payload.floorId) + ' from Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : ''), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload, ctx) => {
    const building = project.building;
    const well = needWell(building, payload.well);
    const floor = floorById(building, payload.floorId);
    if (!floor) refuse('That floor is no longer in the building.', 'missing');
    const stop = well.stops.find((candidate) => candidate.floorId === floor.id);
    if (!stop) refuse('Stairwell ' + well.letter + ' does not stop on ' + floor.name + '.', 'missing');
    if (well.stops.length <= 2) refuse('Stairwell ' + well.letter + ' has only two stops, so there is no stop to take out. To remove it, disconnect the stairs (Remove connection).', 'two-stops');
    const flights = flightsOfWell(building, well);
    const touching = flights.filter((flight) => sameEnd(flight.a, stop) || sameEnd(flight.b, stop));
    const below = well.stops.filter((other) => lowerFirst(building, other, stop) < 0);
    const above = well.stops.filter((other) => lowerFirst(building, other, stop) > 0);
    const gone = new Set(touching.map((flight) => flight.id));
    let connections = building.connections.filter((connection) => !gone.has(connection.id));
    let text = floor.name + ' is out of Stairwell ' + well.letter + '; its stairs stay, not connected.';
    if (below.length > 0 && above.length > 0) {
      const low = below[below.length - 1];
      const high = above[0];
      const already = connections.some((connection) => isStairs(connection) && ((sameEnd(connection.a, low) && sameEnd(connection.b, high)) || (sameEnd(connection.a, high) && sameEnd(connection.b, low))));
      if (!already) {
        const way = sharedWay(building, touching);
        const joinedFlight = { id: freshId(building, ctx), label: nextConnectionLabel(lettersInUse(building)), well: well.letter, a: { floorId: low.floorId, cell: low.cell }, b: { floorId: high.floorId, cell: high.cell }, direction: 'both' };
        joinedFlight.direction = directionForWay(building, joinedFlight, way);
        connections = connections.concat([joinedFlight]);
        text = floor.name + ' is out of Stairwell ' + well.letter + ': ' + floorName(building, low.floorId) + ' and ' + floorName(building, high.floorId) + ' are joined directly, and the stairs on ' + floor.name + ' stay, not connected.';
      }
    }
    const next = { ...building, connections };
    const healed = mended(next);
    if (healed.text !== '') text += ' ' + healed.text;
    return report(project, withConnections(project, healed.building.connections), text, floor.id, { letter: well.letter, floorId: floor.id });
  },
);

// ---------------------------------------------------------------- split, way, letter, join

// payload: { well }. Every flight shows its own letter again.
export const splitStairwell = action(
  { label: (before, payload) => 'Split Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : '') + ' into separate stairs', bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload) => {
    const building = project.building;
    const well = needWell(building, payload.well);
    const ids = new Set(well.connectionIds);
    const connections = building.connections.map((connection) => {
      if (!ids.has(connection.id)) return connection;
      const { well: dropped, ...rest } = connection;
      return rest;
    });
    const flights = flightsOfWell(building, well);
    const labels = flights.map((flight) => flight.label);
    const first = floorById(building, well.stops[0].floorId);
    return report(project, withConnections(project, connections), 'Stairs ' + sentenceList(labels) + ' are separate again.', first ? first.id : null, { letter: well.letter, flights: labels.length });
  },
);

// payload: { well, direction }, direction 'both', 'up' or 'down'. Every flight
// at once, written as 'ab' or 'ba' per flight so that "up only" means up on
// every flight, whichever end the flight was drawn from.
export const setStairwellDirection = action(
  { label: (before, payload) => 'Set the way of Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : '') + ' to ' + (payload.direction === 'up' ? 'up only' : payload.direction === 'down' ? 'down only' : 'both ways'), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload) => {
    const building = project.building;
    if (!['both', 'up', 'down'].includes(payload.direction)) refuse('A stairwell\'s way is both ways, up only or down only.', 'bad-value');
    const well = needWell(building, payload.well);
    const ids = new Set(well.connectionIds);
    let changed = 0;
    const connections = building.connections.map((connection) => {
      if (!ids.has(connection.id)) return connection;
      const direction = directionForWay(building, connection, payload.direction);
      if (connection.direction === direction) return connection;
      changed += 1;
      return { ...connection, direction };
    });
    const word = payload.direction === 'both' ? 'both ways' : payload.direction + ' only';
    const first = floorById(building, well.stops[0].floorId);
    const text = 'Stairwell ' + well.letter + ' runs ' + word + '. Applied to ' + (well.connectionIds.length === 1 ? '1 flight' : well.connectionIds.length + ' flights') + '.';
    if (changed === 0) return report(project, project, text, first ? first.id : null, { letter: well.letter });
    return report(project, withConnections(project, connections), text, first ? first.id : null, { letter: well.letter, flights: well.connectionIds.length });
  },
);

// payload: { well, letter }. The stairwell's letter, on every flight of it.
// The clash rule is every label's: no other flight's label, well's letter or
// elevator's letter, whatever the capitals, and 1 to WELL_MOST characters.
export const setStairwellLetter = action(
  { label: (before, payload) => 'Rename Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : '') + ' to ' + (typeof payload.letter === 'string' ? payload.letter.trim() : ''), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload) => {
    const building = project.building;
    const well = needWell(building, payload.well);
    const ids = new Set(well.connectionIds);
    const letter = needLetter(building, payload.letter, ids);
    const first = floorById(building, well.stops[0].floorId);
    if (letter === well.letter) return report(project, project, 'Stairwell ' + well.letter + ' keeps its letter.', first ? first.id : null, { letter });
    const connections = building.connections.map((connection) => (ids.has(connection.id) ? { ...connection, well: letter } : connection));
    return report(project, withConnections(project, connections), 'Stairwell ' + well.letter + ' is now Stairwell ' + letter + ' on every floor.', first ? first.id : null, { letter, was: well.letter });
  },
);

// payload: { well }. The fix of the building check `stairwell-split`: a
// stairwell in parts gets one flight between the closest stops of consecutive
// parts by level, carrying the well and its way. A whole stairwell is refused.
export const joinStairwell = action(
  { label: (before, payload) => 'Join the parts of Stairwell ' + (typeof payload.well === 'string' ? payload.well.trim() : ''), bumps: [GEOMETRY, BUILDING], focus: focusOn },
  (project, payload, ctx) => {
    const building = project.building;
    const well = needWell(building, payload.well);
    if (well.parts < 2) refuse('Stairwell ' + well.letter + ' is in one piece already; there is nothing to join.', 'nothing-to-do');
    const flights = flightsOfWell(building, well);
    // the parts: flights that share a stop
    const parent = new Map();
    const find = (k) => {
      let root = k;
      while (parent.get(root) !== root) root = parent.get(root);
      parent.set(k, root);
      return root;
    };
    for (const flight of flights) {
      for (const end of [flight.a, flight.b]) if (!parent.has(endKey(end))) parent.set(endKey(end), endKey(end));
      const x = find(endKey(flight.a));
      const y = find(endKey(flight.b));
      if (x !== y) parent.set(y, x);
    }
    const byRoot = new Map();
    for (const stop of well.stops) {
      const root = find(endKey(stop));
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(stop);
    }
    // each part by its lowest stop; each stop list is already lowest first
    const parts = Array.from(byRoot.values()).sort((x, y) => lowerFirst(building, x[0], y[0]));
    const way = sharedWay(building, flights);
    let connections = building.connections;
    const added = [];
    const snapshot = { ...building, connections };
    for (let i = 0; i + 1 < parts.length; i += 1) {
      const lower = parts[i];
      const upper = parts[i + 1];
      // the closest pair by level between the two parts
      let best = null;
      for (const p of lower) {
        for (const q of upper) {
          const gap = Math.abs(levelOf(building, q.floorId).level - levelOf(building, p.floorId).level);
          if (best === null || gap < best.gap) best = { p, q, gap };
        }
      }
      const flight = { id: freshId(snapshot, ctx), label: nextConnectionLabel(lettersInUse({ ...building, connections })), well: well.letter, a: { floorId: best.p.floorId, cell: best.p.cell }, b: { floorId: best.q.floorId, cell: best.q.cell }, direction: 'both' };
      flight.direction = directionForWay(building, flight, way);
      connections = connections.concat([flight]);
      snapshot.connections = connections;
      added.push(flight);
    }
    const text = 'Stairwell ' + well.letter + ' is joined: ' + added.map((flight) => floorName(building, flight.a.floorId) + ' to ' + floorName(building, flight.b.floorId)).join(' and ') + ' now ' + (added.length === 1 ? 'has a flight' : 'have flights') + ' between them.';
    return report(project, withConnections(project, connections), text, added[0].a.floorId, { letter: well.letter, flights: added.length });
  },
);
