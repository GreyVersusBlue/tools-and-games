// The evacuation poster on paper (spec 10.3; DESIGN 14.6 and 14.7 item 1;
// ARCHITECTURE 20.5, 20.9): a sheet to put up, with every way out drawn in its
// exit's colour and number. Never colour alone: each way carries its exit's
// number in a badge, so the poster reads on a black-and-white printer.
//
//   by 'floor' (the default)   one sheet a floor: every room's way out on that
//        floor, the key of the exits those rooms use, the stairs sentence for
//        a floor above the exits, the elevator line when the building has an
//        elevator, the refuge line when the floor has an area of refuge, and
//        "Find your room's number on the plan and follow its colour to the exit."
//   by 'corridor'              one sheet a named corridor: the corridor in an
//        accent band, "You are here" at its middle, the ways of the rooms
//        whose doors open onto it in colour and every other way faint, its
//        sentence ("Rooms on North Corridor go out by Door B (2), 9 rooms,
//        and Door A (1), 3 rooms.") and the key limited to the exits its
//        rooms use. A corridor with no name is not offered; with none named
//        the one sheet says to name them in Building.
//
// The routes are evacuationRoutes()'s, split a floor at a time by routes.js;
// nothing here searches. The building is printed as it is, never as a blocked
// trial in the Safety section has it.
//
// pages(project, derived, options) → [{ what, body }]
// render(project, derived, options) → { title, html }
//   options.by          'floor' (default) | 'corridor'
//   options.floorIds    the floors, by 'floor' (all when left out)
//   options.corridorIds the corridors, by 'corridor' (every named one when left out)
//   and what every output takes (document.js)
// Every name is escaped and set in a span with dir="auto".

import { ELEVATOR_KIND, REFUGE_DEFAULT_NAME, elevatorCars, nameOfRoom } from '../../engine/schema.js';
import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes } from '../../engine/evacuation.js';
import { exitNumbers, exitName, corridorRooms } from '../../engine/exit-load.js';
import { stairsName } from '../../engine/blocked.js';
import { count } from '../components/words.js';
import { labelOn } from '../colour.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';
import { planSvg, printExitColour, PLAN_INK, PLAN_PAPER } from './plan-svg.js';
import { waysOnFloor } from './routes.js';

export const id = 'evacuation-poster';
export const name = 'Evacuation poster';
// the preview opens on a landscape sheet (print-preview.js)
export const orientation = 'landscape';

export const FIND_YOUR_ROOM = 'Find your room’s number on the plan and follow its colour to the exit.';
export const NEVER_ELEVATOR = 'Never use an elevator in an evacuation.';
export const NO_CORRIDOR_NAMED = 'No corridor has a name yet. Name corridors in Building to make a poster for each.';
export const NO_EXIT = 'This building has no exit yet. Add one in Building.';

const HEADER_MM = 26;
const FOOT_MM = 6;
const PLAN_SHARE_WIDE = 0.62;
const PLAN_SHARE_TALL = 0.58;
const LETTER_SHORT_MM = printableBox({ size: 'letter', orientation: 'portrait' }).width;

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

function blank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

function or(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1];
}

// "X, 9 rooms, and Y, 3 rooms": each item has a comma in it, so the last is set off by one too.
function andList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

export function floorsFor(project, options) {
  const floors = project.building.floors;
  const asked = options && Array.isArray(options.floorIds) ? options.floorIds : null;
  if (!asked) return floors;
  const some = floors.filter((floor) => asked.includes(floor.id));
  return some.length > 0 ? some : floors;
}

// The named corridors the poster is asked for, each with its floor, in the building's order.
export function corridorsFor(project, options) {
  const asked = options && Array.isArray(options.corridorIds) ? options.corridorIds : null;
  const found = [];
  for (const floor of project.building.floors) {
    for (const corridor of floor.corridors || []) {
      if (blank(corridor.name)) continue;
      if (asked && !asked.includes(corridor.id)) continue;
      found.push({ corridor, floor });
    }
  }
  return found;
}

// The cell of `cells` nearest their centroid (a corridor's "You are here").
function middleCell(cells, width) {
  let sx = 0;
  let sy = 0;
  for (const cell of cells) {
    sx += cell % width;
    sy += Math.floor(cell / width);
  }
  const cx = sx / cells.length;
  const cy = sy / cells.length;
  let best = cells[0];
  let near = Infinity;
  for (const cell of cells) {
    const d = (cell % width - cx) ** 2 + (Math.floor(cell / width) - cy) ** 2;
    if (d < near || (d === near && cell < best)) {
      near = d;
      best = cell;
    }
  }
  return best;
}

function setup(project) {
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  const numbers = exitNumbers(project);
  const numbering = new Map();
  const exits = new Map();
  for (const floor of project.building.floors) {
    for (const exit of floor.exits || []) {
      const number = numbers.get(exit.id);
      numbering.set(exit.id, { number, colour: printExitColour(number - 1) });
      exits.set(exit.id, { exit, floor, number, colour: printExitColour(number - 1), name: exitName(project, exit.id) });
    }
  }
  return { graph, evacuation, numbers, numbering, exits };
}

function withNumber(info) {
  return info.name + ' (' + info.number + ')';
}

// The stairs the rooms of `entries` take first, as "down Stairs A to Door A (1)".
function stairsSentence(project, entries, floor, ctx) {
  const level = new Map(project.building.floors.map((each) => [each.id, each.level]));
  const seen = new Map();
  for (const entry of entries) {
    const route = entry.route;
    if (!route.ok || !Array.isArray(route.connections) || route.connections.length === 0) continue;
    const connection = project.building.connections.find((each) => each.id === route.connections[0]);
    const info = ctx.exits.get(route.exitId);
    if (!connection || !info) continue;
    const other = connection.a.floorId === floor.id ? connection.b : connection.a;
    const to = level.get(other.floorId);
    const from = floor.level;
    const way = to > from ? 'up ' : to < from ? 'down ' : '';
    const shared = project.building.connections.filter((each) => each.kind !== ELEVATOR_KIND && each.label === connection.label).length > 1;
    const stairs = shared ? stairsName(project, connection) : connection.label ? 'Stairs ' + connection.label : 'Stairs';
    const key = way + stairs + '\u0000' + route.exitId;
    if (!seen.has(key)) seen.set(key, { way, stairs, info });
  }
  if (seen.size === 0) return '';
  const parts = Array.from(seen.values()).sort((a, b) => a.info.number - b.info.number || (a.stairs < b.stairs ? -1 : 1));
  return 'Rooms on this floor go ' + or(parts.map((part) => part.way + part.stairs + ' to ' + withNumber(part.info))) + '.';
}

// The area-of-refuge line for a floor.
function refugeSentence(project, floor) {
  const refuges = floor.refuges || [];
  if (refuges.length === 0) return '';
  const names = refuges.map((refuge) => {
    const words = blank(refuge.name) ? REFUGE_DEFAULT_NAME : refuge.name;
    // the stairs beside it, when one is within two cells
    const near = project.building.connections.filter((connection) => connection.kind !== ELEVATOR_KIND && connection.label && [connection.a, connection.b].some((end) => end.floorId === floor.id && cellsApart(floor.width, end.cell, refuge.cell) <= 2));
    return words + (near.length > 0 ? ' by Stairs ' + near[0].label : '');
  });
  return 'If you cannot use the stairs, wait at ' + or(names) + ' and tell a member of staff.';
}

function cellsApart(width, a, b) {
  return Math.max(Math.abs((a % width) - (b % width)), Math.abs(Math.floor(a / width) - Math.floor(b / width)));
}

function keyCard(info, rooms, where) {
  const ink = labelOn(info.colour, PLAN_INK, PLAN_PAPER);
  const assembly = blank(info.exit.assembly) ? 'Assembly point not set' : 'Assembly: ' + info.exit.assembly;
  return '<li class="poster__exit" data-exit="' + esc(info.exit.id) + '">'
    + '<span class="poster__badge" style="background: ' + esc(info.colour) + '; color: ' + esc(ink) + ';">' + info.number + '</span>'
    + '<span class="poster__bar" style="background: ' + esc(info.colour) + ';"></span>'
    + '<span class="poster__exit-text"><span class="poster__door">' + typed(info.name) + '</span> · ' + typed(info.floor.name) + ' · ' + typed(assembly) + (rooms === null ? '' : ' · ' + esc(count(rooms, 'room') + ' ' + where)) + '</span>'
    + '</li>';
}

function layout(project, opts) {
  const paper = paperOf(project, opts);
  const box = printableBox(paper);
  const wide = paper.orientation === 'landscape';
  const scale = Math.max(1, Math.min(box.width, box.height) / LETTER_SHORT_MM);
  const room = {
    width: wide ? box.width * PLAN_SHARE_WIDE : box.width,
    height: wide ? box.height - HEADER_MM - FOOT_MM : (box.height - HEADER_MM - FOOT_MM) * PLAN_SHARE_TALL,
  };
  return { wide, scale, room };
}

// One sheet. `corridor` is { corridor, floor } for a corridor's sheet.
function sheet(project, floor, ctx, view, corridor) {
  const entries = ctx.evacuation.rooms;
  const onFloor = entries.filter((entry) => entry.floorId === floor.id);
  const rooms = corridor ? new Set(corridorRooms(project, ctx.graph, corridor.id)) : null;
  const mine = rooms ? onFloor.filter((entry) => rooms.has(entry.roomId)) : onFloor;
  const marks = (floor.exits || []).map((exit) => ({ exitId: exit.id, number: ctx.numbers.get(exit.id), colour: printExitColour(ctx.numbers.get(exit.id) - 1) }));
  const options = {
    routes: waysOnFloor(entries, floor.id, { numbering: ctx.numbering, faint: rooms ? (entry) => !rooms.has(entry.roomId) : undefined }),
    exitMarks: marks,
  };
  if (corridor && corridor.cells.length > 0) {
    options.highlightCells = corridor.cells.slice();
    options.marker = { cell: middleCell(corridor.cells, floor.width), label: 'You are here' };
  }
  const plan = planSvg(project, floor, options);
  if (!plan.drawn) return '<p class="doc-lead">' + esc('Nothing is drawn on ' + floor.name + ' yet.') + '</p>';
  const cell = Math.min(view.room.width / plan.width, view.room.height / plan.height);
  const figure = '<figure class="poster__plan"><div class="poster__picture" style="width: ' + mm(plan.width * cell) + '; height: ' + mm(plan.height * cell) + ';">' + plan.svg + '</div></figure>';

  // the exits these rooms use, in number order, with how many of the rooms use each
  const used = new Map();
  for (const entry of mine) {
    if (!entry.route.ok || !ctx.exits.has(entry.route.exitId)) continue;
    used.set(entry.route.exitId, (used.get(entry.route.exitId) || 0) + 1);
  }
  const keyed = Array.from(used.keys()).map((exitId) => ctx.exits.get(exitId)).sort((a, b) => a.number - b.number);
  const text = [];
  const where = corridor ? 'on this corridor' : 'on this floor';
  if (keyed.length > 0) {
    text.push('<ul class="poster__key">' + keyed.map((info) => keyCard(info, used.get(info.exit.id), where)).join('') + '</ul>');
  } else if (ctx.exits.size === 0) {
    text.push('<p class="poster__line" data-line="no-exit">' + esc(NO_EXIT) + '</p>');
  } else {
    text.push('<p class="poster__line" data-line="no-way">' + esc(mine.length === 0 ? (corridor ? 'No rooms open onto this corridor.' : 'There are no rooms on ' + floor.name + '.') : 'No room here has a way out to show.') + '</p>');
  }

  if (corridor) {
    if (keyed.length > 0) {
      const byCount = keyed.slice().sort((a, b) => used.get(b.exit.id) - used.get(a.exit.id) || a.number - b.number);
      text.push('<p class="poster__line" data-line="corridor">' + esc('Rooms on ') + typed(corridor.name) + esc(' go out by ' + andList(byCount.map((info) => withNumber(info) + ', ' + count(used.get(info.exit.id), 'room'))) + '.') + '</p>');
    }
  } else {
    const stairs = stairsSentence(project, mine, floor, ctx);
    if (stairs !== '') text.push('<p class="poster__line" data-line="stairs">' + typed(stairs) + '</p>');
  }
  if (elevatorCars(project.building).length > 0) text.push('<p class="poster__line poster__line--bold" data-line="elevator">' + esc(NEVER_ELEVATOR) + '</p>');
  const refuge = refugeSentence(project, floor);
  if (refuge !== '' && !corridor) text.push('<p class="poster__line" data-line="refuge">' + typed(refuge) + '</p>');
  if (!corridor) text.push('<p class="poster__line" data-line="find">' + esc(FIND_YOUR_ROOM) + '</p>');
  const lost = mine.filter((entry) => !entry.route.ok);
  if (lost.length > 0) {
    const rooms2 = new Map();
    for (const space of floor.spaces) if (space.kind === 'room') rooms2.set(space.id, space);
    text.push('<p class="poster__line poster__line--warn" data-line="no-route">' + lost.map((entry) => typed(nameOfRoom(rooms2.get(entry.roomId), true))).join(', ') + esc(lost.length === 1 ? ' has no way out and is not on this poster.' : ' have no way out and are not on this poster.') + '</p>');
  }

  return '<div class="poster poster--' + (view.wide ? 'wide' : 'tall') + '" style="--poster-scale: ' + Math.round(view.scale * 100) / 100 + ';" data-floor="' + esc(floor.id) + '"' + (corridor ? ' data-corridor="' + esc(corridor.id) + '"' : '') + '>'
    + figure + '<div class="poster__text">' + text.join('') + '</div></div>';
}

export function pages(project, derived, options) {
  const opts = options || {};
  const view = layout(project, opts);
  const ctx = setup(project);
  if (opts.by === 'corridor') {
    const wanted = corridorsFor(project, opts);
    if (wanted.length === 0) {
      return [{ what: 'Evacuation · Corridors', body: '<p class="doc-lead" data-line="no-corridor">' + esc(NO_CORRIDOR_NAMED) + '</p>' }];
    }
    return wanted.map(({ corridor, floor }) => ({ what: 'Evacuation · ' + corridor.name + ', ' + floor.name, body: sheet(project, floor, ctx, view, corridor) }));
  }
  return floorsFor(project, opts).map((floor) => ({ what: 'Evacuation routes · ' + floor.name, body: sheet(project, floor, ctx, view, null) }));
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
