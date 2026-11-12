// "What if this exit or stairs is blocked?": a question about the building,
// never saved (ARCHITECTURE 20.1). Plain Node, no DOM, no clock, not a module
// the staff browser carries.
//
// A blocked set is { exits: [exitId], connections: [connectionId],
// cells: [{ floorId, cell }] }, every list sorted and without repeats; the
// cells are in floor display order, then by cell number, as leverRouteOptions
// has them.
//
// normaliseBlocked(project, blocked, previous?) → { blocked, dropped: [sentence] }
//   Drops an exit, connection or cell that is no longer there, an elevator
//   (never used in an evacuation, so blocking one changes nothing) and a cell
//   that is no longer walkable, with one sentence for each kind ("Stairs C is
//   gone, so it is no longer blocked."). `previous` is the project before the
//   change, so a gone exit or stairs can be named; without it they are
//   "A blocked exit" and "A blocked stairs".
// blockedFromScenario(project, scenario)
//   → { connections, cells, corridors: [{ floorId, name, cells }], words }
//   What an open scenario closes and an evacuation can be asked about: closed
//   stairs and closed corridors, through leverRouteOptions; never a one-way
//   lever, never an elevator. `words` is { parts, text }, "Stairs B, North
//   Corridor" ('' when the scenario closes nothing).
// blockedOptions(blocked) → { avoidExits, avoidConnections, shutCells }
//   for evacuationRoutes and stepFreeWaysOut.
// stairsName(project, connection) → "Stairs B, Floor 1 to Floor 2"
// blockedWords(project, blocked, options?) → { parts, text }
//   "Door B and Stairs A, Floor 1 to Floor 2 blocked"; parts are
//   { text, name } with name true for what a user typed. options.floors
//   false leaves the floors off the stairs ("Stairs A"). '' for nothing.
// blockedTrial(project, graph, blocked, options?) → {
//     blocked, dropped, before, after,    evacuationRoutes' results
//     rooms: [{ roomId, floorId, change, before: { exitId, seconds } | null,
//               after: … | null, delta, sentence }],   every room, building order
//     exits: [{ exitId, number, before: { rooms, people }, after: { rooms, people }, blocked }],
//     load: { before: exitLoad, after: exitLoad },
//     summary: { moved, otherExit, slower, lost, gained, slowestBefore, slowestAfter },
//     sentence }
//   options are evacuationRoutes' (cache, geometryVersion, avoidExits,
//   avoidConnections, avoidStairs, shutCells); the blocked set is merged into
//   them for `after`, and `before` is evacuationRoutes with the options as
//   given, so with a cache `before` is the pass already worked out.
//   `change` is 'same', 'slower' (same exit, a longer way), 'other-exit',
//   'lost', 'gained' (blocking cannot do this; kept so a case can pin that it
//   does not) or 'none' (no way before, none after). `delta` is after - before
//   seconds, or null when either is missing. A room's `sentence` is null,
//   except for a room with no way out in `after`: for one cut off by blocked
//   exits, "Its only way out, Door A (1), is blocked." or "Every exit it can
//   reach is blocked: Door A (1) and Door C (3)."; else noRoute's sentence.
//   `moved` counts rooms that go out another way ('other-exit' and 'slower').

import { isWalkable, ELEVATOR_KIND } from './schema.js';
import { evacuationRoutes, reachableExits, byExit, noRoute } from './evacuation.js';
import { exitLoad, exitNumbers, exitName } from './exit-load.js';
import { leverRouteOptions } from './scenario.js';
import { formatDuration } from './findings.js';

function floorsOf(project) {
  return project.building.floors;
}

function floorById(project, id) {
  return floorsOf(project).find((floor) => floor.id === id) || null;
}

function connectionById(project, id) {
  return (project.building.connections || []).find((connection) => connection && connection.id === id) || null;
}

function exitById(project, id) {
  for (const floor of floorsOf(project)) {
    const exit = (floor.exits || []).find((candidate) => candidate && candidate.id === id);
    if (exit) return { exit, floor };
  }
  return null;
}

function idsOf(value) {
  return Array.from(new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])).sort();
}

function cellsOf(project, value) {
  const order = new Map(floorsOf(project).map((floor, i) => [floor.id, i]));
  const seen = new Set();
  const found = [];
  for (const place of Array.isArray(value) ? value : []) {
    if (!place || typeof place.floorId !== 'string' || !Number.isInteger(place.cell)) continue;
    const key = place.floorId + ':' + place.cell;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ floorId: place.floorId, cell: place.cell });
  }
  const rank = (place) => (order.has(place.floorId) ? order.get(place.floorId) : Infinity);
  return found.sort((a, b) => rank(a) - rank(b) || (a.floorId < b.floorId ? -1 : a.floorId > b.floorId ? 1 : 0) || a.cell - b.cell);
}

// ---- words

export function stairsName(project, connection) {
  if (!connection) return 'Stairs';
  const label = typeof connection.label === 'string' ? connection.label : '';
  const base = label === '' ? 'Stairs' : 'Stairs ' + label;
  const a = floorById(project, connection.a && connection.a.floorId);
  const b = floorById(project, connection.b && connection.b.floorId);
  if (!a || !b) return base;
  if (a.id === b.id) return base + ', ' + a.name;
  const [low, high] = a.level <= b.level ? [a, b] : [b, a];
  return base + ', ' + low.name + ' to ' + high.name;
}

function stairsParts(project, connection, floors) {
  const label = connection && typeof connection.label === 'string' ? connection.label : '';
  const parts = [{ text: label === '' ? 'Stairs' : 'Stairs ', name: false }];
  if (label !== '') parts.push({ text: label, name: true });
  if (!connection || floors === false) return parts;
  const a = floorById(project, connection.a && connection.a.floorId);
  const b = floorById(project, connection.b && connection.b.floorId);
  if (!a || !b) return parts;
  if (a.id === b.id) return [...parts, { text: ', ', name: false }, { text: a.name, name: true }];
  const [low, high] = a.level <= b.level ? [a, b] : [b, a];
  return [...parts, { text: ', ', name: false }, { text: low.name, name: true }, { text: ' to ', name: false }, { text: high.name, name: true }];
}

function joined(items) {
  const parts = [];
  items.forEach((item, i) => {
    if (i > 0) parts.push({ text: i === items.length - 1 ? ' and ' : ', ', name: false });
    parts.push(...item);
  });
  return parts;
}

function textOf(parts) {
  return parts.map((part) => part.text).join('');
}

// Each blocked thing as parts: exits, then stairs, then corridors and cells.
function itemsOf(project, blocked, floors) {
  const items = [];
  for (const id of blocked.exits) {
    const found = exitById(project, id);
    if (!found) continue;
    items.push([{ text: exitName(project, id), name: true }]);
  }
  for (const id of blocked.connections) {
    const connection = connectionById(project, id);
    if (connection) items.push(stairsParts(project, connection, floors));
  }
  return items.concat(cellItems(project, blocked.cells));
}

// Blocked cells as the named corridors they make up whole, and the rest as a
// count of cells on a floor.
function cellItems(project, cells) {
  const items = [];
  for (const floor of floorsOf(project)) {
    const mine = new Set(cells.filter((place) => place.floorId === floor.id).map((place) => place.cell));
    if (mine.size === 0) continue;
    const left = new Set(mine);
    for (const corridor of floor.corridors || []) {
      const named = typeof corridor.name === 'string' && corridor.name.trim() !== '';
      const walked = (corridor.cells || []).filter((cell) => isWalkable(floor.cells[cell]));
      if (!named || walked.length === 0 || !walked.every((cell) => mine.has(cell))) continue;
      items.push([{ text: corridor.name, name: true }]);
      for (const cell of walked) left.delete(cell);
    }
    if (left.size > 0) items.push([{ text: left.size + (left.size === 1 ? ' corridor cell on ' : ' corridor cells on '), name: false }, { text: floor.name, name: true }]);
  }
  return items;
}

export function blockedWords(project, blocked, options) {
  const floors = !(options && options.floors === false);
  const items = itemsOf(project, normaliseBlocked(project, blocked).blocked, floors);
  if (items.length === 0) return { parts: [], text: '' };
  const parts = [...joined(items), { text: ' blocked', name: false }];
  return { parts, text: textOf(parts) };
}

// ---- the set itself

export function normaliseBlocked(project, blocked, previous) {
  const given = blocked || {};
  const dropped = [];
  const named = previous || project;
  const exits = [];
  for (const id of idsOf(given.exits)) {
    if (exitById(project, id)) exits.push(id);
    else {
      const was = exitById(named, id);
      dropped.push((was ? exitName(named, id) : 'A blocked exit') + ' is gone, so it is no longer blocked.');
    }
  }
  const connections = [];
  for (const id of idsOf(given.connections)) {
    const connection = connectionById(project, id);
    if (connection && connection.kind === ELEVATOR_KIND) {
      const label = typeof connection.label === 'string' ? connection.label.trim() : '';
      dropped.push((label === '' ? 'An elevator' : 'Elevator ' + label) + ' is never used in an evacuation, so it is not blocked.');
    } else if (connection) connections.push(id);
    else {
      const was = connectionById(named, id);
      dropped.push((was ? stairsName(named, was) : 'A blocked stairs') + ' is gone, so it is no longer blocked.');
    }
  }
  const cells = [];
  const lost = new Map();
  for (const place of cellsOf(project, given.cells)) {
    const floor = floorById(project, place.floorId);
    if (floor && place.cell >= 0 && place.cell < floor.width * floor.height && isWalkable(floor.cells[place.cell])) cells.push(place);
    else lost.set(place.floorId, (lost.get(place.floorId) || 0) + 1);
  }
  for (const [floorId, n] of lost) {
    const floor = floorById(project, floorId);
    const words = floor ? 'on ' + floor.name : 'on a floor that is gone';
    dropped.push(n + (n === 1 ? ' blocked corridor cell ' : ' blocked corridor cells ') + words + (n === 1 ? ' is' : ' are') + ' no longer a corridor, so ' + (n === 1 ? 'it is' : 'they are') + ' no longer blocked.');
  }
  return { blocked: { exits, connections, cells }, dropped };
}

export function blockedFromScenario(project, scenario) {
  const levers = leverRouteOptions(project, scenario);
  const cells = cellsOf(project, levers.shutCells);
  const connections = idsOf(levers.shutLinks);
  const list = Array.isArray(scenario) ? scenario : scenario && Array.isArray(scenario.levers) ? scenario.levers : [];
  const corridors = [];
  for (const lever of list) {
    if (!lever || lever.kind !== 'corridor' || !floorById(project, lever.floorId) || !Array.isArray(lever.cells)) continue;
    corridors.push({ floorId: lever.floorId, name: typeof lever.name === 'string' ? lever.name : '', cells: lever.cells.filter((cell) => Number.isInteger(cell)).sort((a, b) => a - b) });
  }
  const items = connections.map((id) => stairsParts(project, connectionById(project, id), false));
  for (const corridor of corridors) {
    const floor = floorById(project, corridor.floorId);
    const n = corridor.cells.length;
    items.push(corridor.name.trim() !== '' ? [{ text: corridor.name, name: true }] : [{ text: n + (n === 1 ? ' corridor cell on ' : ' corridor cells on '), name: false }, { text: floor.name, name: true }]);
  }
  const parts = joined(items);
  return { connections, cells, corridors, words: { parts, text: textOf(parts) } };
}

export function blockedOptions(blocked) {
  const given = blocked || {};
  return {
    avoidExits: idsOf(given.exits),
    avoidConnections: idsOf(given.connections),
    shutCells: Array.isArray(given.cells) ? given.cells.map((place) => ({ floorId: place.floorId, cell: place.cell })) : [],
  };
}

// ---- the trial

function union(a, b) {
  return Array.from(new Set([...(Array.isArray(a) ? a : Array.from(a || [])), ...b])).sort();
}

function wayOf(entry) {
  return entry.route.ok ? { exitId: entry.route.exitId, seconds: entry.route.seconds } : null;
}

function changeOf(before, after) {
  if (!before && !after) return 'none';
  if (before && !after) return 'lost';
  if (!before) return 'gained';
  if (before.exitId !== after.exitId) return 'other-exit';
  return after.seconds > before.seconds ? 'slower' : 'same';
}

function count(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function figures(rows) {
  return new Map(rows.map((row) => [row.exitId, { rooms: row.rooms, people: row.people }]));
}

function slowest(rooms, key) {
  let found = null;
  for (const room of rooms) if (room[key] && (found === null || room[key].seconds > found)) found = room[key].seconds;
  return found;
}

function trialSentence(project, blocked, summary, nothing) {
  const items = itemsOf(project, blocked, true);
  if (items.length === 0 || nothing) return 'Nothing changes: every room goes out the way it did.';
  const clauses = [];
  if (summary.moved > 0) clauses.push([summary.moved, 'room', 'rooms', summary.moved === 1 ? 'goes out another way' : 'go out another way']);
  if (summary.lost > 0) clauses.push([summary.lost, 'room', 'rooms', summary.lost === 1 ? 'has no way out' : 'have no way out']);
  if (summary.gained > 0) clauses.push([summary.gained, 'room', 'rooms', summary.gained === 1 ? 'has a way out now' : 'have a way out now']);
  const said = clauses.map((clause, i) => (i === 0 ? count(clause[0], clause[1], clause[2]) : String(clause[0])) + ' ' + clause[3]);
  if (summary.slowestAfter !== null && summary.slowestBefore !== null && summary.slowestAfter !== summary.slowestBefore) {
    said.push('the slowest way out takes ' + formatDuration(summary.slowestAfter) + ' (was ' + formatDuration(summary.slowestBefore) + ')');
  }
  const body = said.length <= 2 ? said.join(' and ') : said.slice(0, -1).join(', ') + ', and ' + said[said.length - 1];
  const head = 'If ' + textOf(joined(items)) + (items.length === 1 ? ' is' : ' are') + ' blocked: ';
  return head + body + '.';
}

export function blockedTrial(project, graph, blocked, options) {
  const opts = options || {};
  const checked = normaliseBlocked(project, blocked);
  const set = checked.blocked;
  const asked = blockedOptions(set);
  const merged = { ...opts, avoidExits: union(opts.avoidExits, asked.avoidExits), avoidConnections: union(opts.avoidConnections, asked.avoidConnections) };
  const cells = [...(Array.isArray(opts.shutCells) ? opts.shutCells : []), ...asked.shutCells];
  if (cells.length > 0) merged.shutCells = cells;
  else delete merged.shutCells;
  if (merged.avoidExits.length === 0) delete merged.avoidExits;
  if (merged.avoidConnections.length === 0) delete merged.avoidConnections;
  const before = evacuationRoutes(project, graph, opts);
  const after = evacuationRoutes(project, graph, merged);
  const failed = new Map(noRoute(project, after).map((row) => [row.roomId, row.sentence]));
  const exitsBlocked = new Set(set.exits);
  // the exits a cut-off room could reach with no exit blocked: the options of
  // the trial without its blocked exits
  const open = { ...merged };
  if (opts.avoidExits) open.avoidExits = opts.avoidExits;
  else delete open.avoidExits;
  const numbers = exitNumbers(project);
  const cutWords = (roomId) => {
    if (exitsBlocked.size === 0) return null;
    const reachable = reachableExits(project, graph, roomId, open);
    if (reachable.length === 0 || !reachable.every((id) => exitsBlocked.has(id))) return null;
    const names = reachable.map((id) => exitName(project, id) + ' (' + numbers.get(id) + ')');
    return names.length === 1 ? 'Its only way out, ' + names[0] + ', is blocked.' : 'Every exit it can reach is blocked: ' + names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + '.';
  };
  const rooms = before.rooms.map((entry, i) => {
    const was = wayOf(entry);
    const now = wayOf(after.rooms[i]);
    const change = changeOf(was, now);
    const sentence = now ? null : change === 'none' || change === 'lost' ? cutWords(entry.roomId) || failed.get(entry.roomId) || '' : null;
    return { roomId: entry.roomId, floorId: entry.floorId, change, before: was, after: now, delta: was && now ? now.seconds - was.seconds : null, sentence };
  });
  const beforeRows = byExit(project, before);
  const afterRows = byExit(project, after);
  const was = figures(beforeRows);
  const now = figures(afterRows);
  const exits = beforeRows.map((row) => ({ exitId: row.exitId, number: numbers.get(row.exitId), before: was.get(row.exitId), after: now.get(row.exitId), blocked: exitsBlocked.has(row.exitId) }));
  const load = { before: exitLoad(project, beforeRows), after: exitLoad(project, afterRows, { blockedExits: set.exits }) };
  const tally = (change) => rooms.filter((room) => room.change === change).length;
  const summary = { moved: tally('other-exit') + tally('slower'), otherExit: tally('other-exit'), slower: tally('slower'), lost: tally('lost'), gained: tally('gained'), slowestBefore: slowest(rooms, 'before'), slowestAfter: slowest(rooms, 'after') };
  const nothing = rooms.every((room) => room.change === 'same' || room.change === 'none');
  return { blocked: set, dropped: checked.dropped, before, after, rooms, exits, load, summary, sentence: trialSentence(project, set, summary, nothing) };
}
