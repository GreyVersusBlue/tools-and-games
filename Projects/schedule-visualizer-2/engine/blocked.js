// "What if this exit or stairs is blocked?": a question about the building,
// never saved (ARCHITECTURE 20.1). Plain Node, no DOM, no clock, not a module
// the staff browser carries.
//
// A blocked set is { exits: [exitId], connections: [connectionId],
// cells: [{ floorId, cell }] }, every list sorted and without repeats; the
// cells are in floor display order, then by cell number, as leverRouteOptions
// has them.
//
// normaliseBlocked(project, blocked, previous?) → { blocked, dropped: [sentence], droppedParts: [[part]] }
//   Drops an exit, connection or cell that is no longer there, an elevator
//   (never used in an evacuation, so blocking one changes nothing) and a cell
//   that is no longer walkable, with one sentence for each kind ("Stairs C is
//   gone, so it is no longer blocked."). `previous` is the project before the
//   change, so a gone exit or stairs can be named; without it they are
//   "A blocked exit" and "A blocked stairs". `droppedParts[i]` is dropped[i]
//   as [{ text, name }], name true for what a user typed.
// blockedFromScenario(project, scenario)
//   → { connections, cells, corridors: [{ floorId, name, cells }], words }
//   What an open scenario closes and an evacuation can be asked about, as the
//   building is now: closed stairs and closed corridors, through
//   leverRouteOptions; never a one-way lever, never an elevator. A cell that
//   is not walkable, not on a floor or out of range is left out (the rules of
//   normaliseBlocked), and a corridor left with no cell is left out of
//   `corridors` and `words`. `words` is { parts, text }, "Stairs B, North
//   Corridor" ('' when the scenario closes nothing).
// blockedOptions(blocked) → { avoidExits, avoidConnections, shutCells }
//   for evacuationRoutes and stepFreeWaysOut. A malformed id or cell is left out.
// stairsName(project, connection) → "Stairs B, Floor 1 to Floor 2"
// blockedWords(project, blocked, options?) → { parts, text }
//   "Door B and Stairs A, Floor 1 to Floor 2 blocked"; parts are
//   { text, name } with name true for what a user typed. options.floors
//   false leaves the floors off the stairs ("Stairs A"). '' for nothing.
// blockedTrial(project, graph, blocked, options?) → {
//     blocked, dropped, droppedParts, before, after,   evacuationRoutes' results
//     rooms: [{ roomId, floorId, change, before: { exitId, seconds } | null,
//               after: … | null, delta, sentence, sentenceParts }],   every room, building order
//     exits: [{ exitId, number, before: { rooms, people }, after: { rooms, people }, blocked }],
//     load: { before: exitLoad, after: exitLoad },
//     summary: { moved, otherExit, slower, lost, gained, slowestBefore, slowestAfter },
//                 (the slowest ways are over the rooms that have one before and after)
//     sentence, sentenceParts }
//   `sentenceParts` is each sentence as [{ text, name }] (null for a room's
//   when its sentence is), name true for what a user typed.
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
//   A caller's options.avoidExits count as blocked for the loads and for
//   exits[].blocked: load.before has them, load.after those and the set's.
//   load.after is worked out on load.before's basis, so the two compare.

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

// The walkable cells of one floor from a list, as integers, sorted, once.
function liveCells(project, floorId, cells) {
  const floor = floorById(project, floorId);
  if (!floor || !Array.isArray(cells)) return [];
  const live = new Set(cells.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < floor.width * floor.height && isWalkable(floor.cells[cell])));
  return Array.from(live).sort((a, b) => a - b);
}

const OURS = (text) => ({ text, name: false });
const TYPED = (text) => ({ text, name: true });

export function normaliseBlocked(project, blocked, previous) {
  const given = blocked && typeof blocked === 'object' ? blocked : {};
  const dropped = [];
  const named = previous || project;
  const exits = [];
  for (const id of idsOf(given.exits)) {
    if (exitById(project, id)) exits.push(id);
    else {
      const was = exitById(named, id);
      dropped.push(was ? [TYPED(exitName(named, id)), OURS(' is gone, so it is no longer blocked.')] : [OURS('A blocked exit is gone, so it is no longer blocked.')]);
    }
  }
  const connections = [];
  for (const id of idsOf(given.connections)) {
    const connection = connectionById(project, id);
    if (connection && connection.kind === ELEVATOR_KIND) {
      const label = typeof connection.label === 'string' ? connection.label.trim() : '';
      dropped.push(label === '' ? [OURS('An elevator is never used in an evacuation, so it is not blocked.')] : [OURS('Elevator '), TYPED(label), OURS(' is never used in an evacuation, so it is not blocked.')]);
    } else if (connection) connections.push(id);
    else {
      const was = connectionById(named, id);
      dropped.push([...(was ? stairsParts(named, was, true) : [OURS('A blocked stairs')]), OURS(' is gone, so it is no longer blocked.')]);
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
    const head = n + (n === 1 ? ' blocked corridor cell ' : ' blocked corridor cells ');
    const tail = (n === 1 ? ' is' : ' are') + ' no longer a corridor, so ' + (n === 1 ? 'it is' : 'they are') + ' no longer blocked.';
    dropped.push(floor ? [OURS(head + 'on '), TYPED(floor.name), OURS(tail)] : [OURS(head + 'on a floor that is gone' + tail)]);
  }
  return { blocked: { exits, connections, cells }, dropped: dropped.map(textOf), droppedParts: dropped };
}

export function blockedFromScenario(project, scenario) {
  const levers = leverRouteOptions(project, scenario);
  const connections = idsOf(levers.shutLinks);
  // only what is still a corridor now: the lever may name cells since erased
  const cells = normaliseBlocked(project, { cells: levers.shutCells }).blocked.cells;
  const list = Array.isArray(scenario) ? scenario : scenario && Array.isArray(scenario.levers) ? scenario.levers : [];
  const corridors = [];
  for (const lever of list) {
    if (!lever || lever.kind !== 'corridor' || !floorById(project, lever.floorId)) continue;
    const live = liveCells(project, lever.floorId, lever.cells);
    if (live.length === 0) continue;
    corridors.push({ floorId: lever.floorId, name: typeof lever.name === 'string' ? lever.name : '', cells: live });
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
  const given = blocked && typeof blocked === 'object' ? blocked : {};
  return {
    avoidExits: idsOf(given.exits),
    avoidConnections: idsOf(given.connections),
    shutCells: Array.isArray(given.cells) ? given.cells.filter((place) => place && typeof place.floorId === 'string' && Number.isInteger(place.cell)).map((place) => ({ floorId: place.floorId, cell: place.cell })) : [],
  };
}

// ---- the trial

function union(a, b) {
  const first = Array.isArray(a) ? a : a instanceof Set ? Array.from(a) : [];
  return Array.from(new Set([...first, ...b].filter((id) => typeof id === 'string'))).sort();
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

// The slowest way out among the rooms that have one before and after, so a
// room that is lost does not make the slowest way look quicker.
function slowest(rooms, key) {
  let found = null;
  for (const room of rooms) if (room.before && room.after && (found === null || room[key].seconds > found)) found = room[key].seconds;
  return found;
}

function trialSentence(project, blocked, summary, nothing) {
  const items = itemsOf(project, blocked, true);
  if (items.length === 0 || nothing) return [OURS('Nothing changes: every room goes out the way it did.')];
  const clauses = [];
  if (summary.moved > 0) clauses.push([summary.moved, 'room', 'rooms', summary.moved === 1 ? 'goes out another way' : 'go out another way']);
  if (summary.lost > 0) clauses.push([summary.lost, 'room', 'rooms', summary.lost === 1 ? 'has no way out' : 'have no way out']);
  if (summary.gained > 0) clauses.push([summary.gained, 'room', 'rooms', summary.gained === 1 ? 'has a way out now' : 'have a way out now']);
  const said = clauses.map((clause, i) => (i === 0 ? count(clause[0], clause[1], clause[2]) : String(clause[0])) + ' ' + clause[3]);
  if (summary.slowestAfter !== null && summary.slowestBefore !== null && summary.slowestAfter !== summary.slowestBefore) {
    said.push('the slowest way out takes ' + formatDuration(summary.slowestAfter) + ' (was ' + formatDuration(summary.slowestBefore) + ')');
  }
  const body = said.length <= 2 ? said.join(' and ') : said.slice(0, -1).join(', ') + ', and ' + said[said.length - 1];
  return [OURS('If '), ...joined(items), OURS((items.length === 1 ? ' is' : ' are') + ' blocked: ' + body + '.')];
}

// A sentence of the engine's own (noRoute's) as parts: what a user typed in it
// (this room's number and label, every floor's and corridor's name) is marked.
function sentenceAsParts(project, room, text) {
  const typed = [];
  const add = (value) => {
    if (typeof value === 'string' && value.trim() !== '') typed.push(value);
  };
  if (room) {
    add(room.number);
    add(room.label);
  }
  for (const floor of floorsOf(project)) {
    add(floor.name);
    for (const corridor of floor.corridors || []) if (corridor) add(corridor.name);
  }
  const parts = [];
  let at = 0;
  while (at < text.length) {
    let best = null;
    for (const name of typed) {
      const found = text.indexOf(name, at);
      if (found >= 0 && (best === null || found < best.at || (found === best.at && name.length > best.name.length))) best = { at: found, name };
    }
    if (!best) break;
    if (best.at > at) parts.push(OURS(text.slice(at, best.at)));
    parts.push(TYPED(best.name));
    at = best.at + best.name.length;
  }
  if (at < text.length) parts.push(OURS(text.slice(at)));
  return parts;
}

export function blockedTrial(project, graph, blocked, options) {
  const opts = options && typeof options === 'object' ? options : {};
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
    const names = reachable.map((id) => [TYPED(exitName(project, id)), OURS(' (' + numbers.get(id) + ')')]);
    if (names.length === 1) return [OURS('Its only way out, '), ...names[0], OURS(', is blocked.')];
    return [OURS('Every exit it can reach is blocked: '), ...joined(names), OURS('.')];
  };
  const spaces = new Map();
  for (const floor of floorsOf(project)) for (const space of floor.spaces || []) if (space) spaces.set(space.id, space);
  const rooms = before.rooms.map((entry, i) => {
    const was = wayOf(entry);
    const now = wayOf(after.rooms[i]);
    const change = changeOf(was, now);
    let sentenceParts = null;
    if (!now && (change === 'none' || change === 'lost')) {
      sentenceParts = cutWords(entry.roomId) || sentenceAsParts(project, spaces.get(entry.roomId), failed.get(entry.roomId) || '');
    }
    const sentence = sentenceParts ? textOf(sentenceParts) : null;
    return { roomId: entry.roomId, floorId: entry.floorId, change, before: was, after: now, delta: was && now ? now.seconds - was.seconds : null, sentence, sentenceParts };
  });
  const beforeRows = byExit(project, before);
  const afterRows = byExit(project, after);
  const was = figures(beforeRows);
  const now = figures(afterRows);
  // an exit the caller already avoids is blocked for the loads, as the set's are
  const callerExits = union(opts.avoidExits, []);
  const allBlocked = new Set(union(callerExits, set.exits));
  const exits = beforeRows.map((row) => ({ exitId: row.exitId, number: numbers.get(row.exitId), before: was.get(row.exitId), after: now.get(row.exitId), blocked: allBlocked.has(row.exitId) }));
  const loadBefore = exitLoad(project, beforeRows, { blockedExits: callerExits });
  const load = { before: loadBefore, after: exitLoad(project, afterRows, { blockedExits: Array.from(allBlocked), basis: loadBefore.basis }) };
  const tally = (change) => rooms.filter((room) => room.change === change).length;
  const summary = { moved: tally('other-exit') + tally('slower'), otherExit: tally('other-exit'), slower: tally('slower'), lost: tally('lost'), gained: tally('gained'), slowestBefore: slowest(rooms, 'before'), slowestAfter: slowest(rooms, 'after') };
  const nothing = rooms.every((room) => room.change === 'same' || room.change === 'none');
  const sentenceParts = trialSentence(project, set, summary, nothing);
  return { blocked: set, dropped: checked.dropped, droppedParts: checked.droppedParts, before, after, rooms, exits, load, summary, sentence: textOf(sentenceParts), sentenceParts };
}
