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
// Every name is escaped and set in a span with dir="auto"; inside a sentence it is
// isolated with U+2068 and U+2069.

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

const FOOT_MM = 6;
const GAP_MM = 6;
const LETTER_SHORT_MM = printableBox({ size: 'letter', orientation: 'portrait' }).width;
// The sheet's headline is 28 pt on Letter and grows with the sheet like the
// poster's text (DESIGN 14.6); print.css sets it from the paper (the page's
// own header is document.js's, so the rule keys on data-paper).
export const HEADLINE_PT = 28;
const MM_PER_PT = 25.4 / 72;
const POSTER_PT = 11;
const FSI = '\u2068';
const PDI = '\u2069';

// The words' scale for a sheet: 1 up to Letter, then the short side's ratio.
export function sheetScale(box) {
  return Math.max(1, Math.min(box.width, box.height) / LETTER_SHORT_MM);
}

// What the header takes, in millimetres: the school line, the headline (one
// or more lines of `pt` points, `heading` characters wide) and the rule.
export function headerMm(box, scale, heading, pt) {
  const size = pt * scale * MM_PER_PT;
  const across = Math.max(40, box.width - 30 * scale);
  const lines = Math.max(1, Math.ceil(heading.length * 0.54 * size / across));
  return 4.45 + lines * size * 1.15 + 8 + 1.5;
}

// How many lines `chars` characters take in a column `width` mm wide at
// `size` mm type (an average character is 0.56 em; the estimate errs long).
export function wrapped(chars, width, size) {
  return Math.max(1, Math.ceil(chars * 0.56 * size / Math.max(1, width)));
}

// The largest plan that fits (DESIGN 14.6): the plan is scaled until the
// width or the height of the room left runs out, keeping its shape. Two
// arrangements: the index or text in a column beside the plan (landscape
// only), or under it with the plan across the whole width. `beside(width)`
// and `under(width)` say how tall the text is in a column that wide; the
// arrangement with the larger plan wins, and beside keeps ties within 5 %.
//   spec { wide, width, height (the room under the header, over the footer),
//          aspect: plan width / plan height, beside, under, gap }
// returns { layout: 'beside' | 'under', plan: { width, height }, side, freeW, freeH }
export function fitPlan(spec) {
  const { width, height, aspect, gap } = spec;
  const best = (freeW, freeH) => {
    const w = Math.min(freeW, freeH * aspect);
    return { width: w, height: w / aspect };
  };
  const stacked = Math.max(height * 0.25, height - gap - spec.under(width));
  const down = { layout: 'under', side: 0, freeW: width, freeH: stacked, plan: best(width, stacked) };
  if (!spec.wide) return down;
  let across = null;
  for (let share = 0.2; share <= 0.5001; share += 0.02) {
    const side = width * share;
    if (spec.beside(side) > height) continue;
    const freeW = width - side - gap;
    const plan = best(freeW, height);
    if (across === null || plan.width >= across.plan.width * 0.999) across = { layout: 'beside', side, freeW, freeH: height, plan };
  }
  if (across === null) return down;
  return down.plan.width * down.plan.height > across.plan.width * across.plan.height * 1.05 ? down : across;
}

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

function blank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

// A typed name inside a sentence, isolated from the words round it: the
// first-strong isolate (U+2068) and its pop (U+2069) hold a right-to-left
// name, or a bidi override that is never closed, in its own run, so it cannot
// reorder the sentence or the "(1)" after it. The two characters, not a <bdi>
// element: the pinned tag list of a print has no <bdi>.
function iso(value) {
  return FSI + esc(value) + PDI;
}

// The items are markup already (each name through iso()); the words between
// them are plain text, escaped here.
function or(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1];
}

// "X, 9 rooms, and Y, 3 rooms": each item has a comma in it, so the last is set off by one too.
function andList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

// the words of a piece of markup, for counting how much room it takes
function plain(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, '?').replace(/[\u2068\u2069]/g, '');
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
  const named = [];
  for (const floor of project.building.floors) {
    for (const corridor of floor.corridors || []) {
      if (!blank(corridor.name)) named.push({ corridor, floor });
    }
  }
  // ids that match no named corridor ask for every named one, as floorsFor does for floors
  const some = asked ? named.filter(({ corridor }) => asked.includes(corridor.id)) : named;
  return some.length > 0 ? some : named;
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
  return iso(info.name) + ' (' + info.number + ')';
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
  return 'Rooms on this floor go ' + or(parts.map((part) => part.way + iso(part.stairs) + ' to ' + withNumber(part.info))) + '.';
}

// The area-of-refuge line for a floor.
function refugeSentence(project, floor) {
  const refuges = floor.refuges || [];
  if (refuges.length === 0) return '';
  const names = refuges.map((refuge) => {
    const words = blank(refuge.name) ? REFUGE_DEFAULT_NAME : refuge.name;
    // the stairs beside it, when one is within two cells: the nearest, then by label, then by id
    const near = [];
    for (const connection of project.building.connections) {
      if (connection.kind === ELEVATOR_KIND || blank(connection.label)) continue;
      const apart = Math.min(...[connection.a, connection.b].filter((end) => end.floorId === floor.id).map((end) => cellsApart(floor.width, end.cell, refuge.cell)));
      if (apart <= 2) near.push({ apart, connection });
    }
    near.sort((a, b) => a.apart - b.apart || compare(a.connection.label, b.connection.label) || compare(a.connection.id, b.connection.id));
    return iso(words) + (near.length > 0 ? ' by ' + iso(stairsName(project, near[0].connection)) : '');
  });
  return 'If you cannot use the stairs, wait at ' + or(names) + ' and tell a member of staff.';
}

function compare(a, b) {
  const x = String(a === undefined ? '' : a);
  const y = String(b === undefined ? '' : b);
  return x < y ? -1 : x > y ? 1 : 0;
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
  return { wide: paper.orientation === 'landscape', scale: sheetScale(box), box };
}

// How tall the poster's text is in a column `width` mm wide, `cols` cards
// across: the key's cards, then the lines (each estimated, never counted from
// a browser, so the layout is the same everywhere).
function textHeight(text, view, width, cols) {
  const size = POSTER_PT * view.scale * MM_PER_PT;
  const line = size * 1.3;
  let total = 0;
  if (text.cards.length > 0) {
    const across = (width - (cols - 1) * GAP_MM) / cols;
    const words = Math.max(10, across - size * 1.8 - 1.6 - 4);
    const heights = text.cards.map((card) => Math.max(wrapped(card, words, size) * line, size * 1.45) + 2);
    for (let i = 0; i < heights.length; i += cols) total += Math.max(...heights.slice(i, i + cols));
    total += 3;
  }
  for (const item of text.lines) total += wrapped(item.chars * (item.bold ? 1.12 : 1), width, size) * line + 2.5;
  return total;
}

// the number of cards across that gives the shortest text, in a column that wide
function cardsAcross(text, view, width) {
  let best = 1;
  let low = textHeight(text, view, width, 1);
  for (let cols = 2; cols <= Math.min(3, text.cards.length); cols++) {
    if ((width - (cols - 1) * GAP_MM) / cols < 70 * view.scale) break;
    const tall = textHeight(text, view, width, cols);
    if (tall < low - 0.5) {
      low = tall;
      best = cols;
    }
  }
  return best;
}

// One sheet. `corridor` is { corridor, floor } for a corridor's sheet; `what`
// is its headline.
function sheet(project, floor, ctx, view, corridor, what) {
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

  // the exits these rooms use, in number order, with how many of the rooms use each
  const used = new Map();
  for (const entry of mine) {
    if (!entry.route.ok || !ctx.exits.has(entry.route.exitId)) continue;
    used.set(entry.route.exitId, (used.get(entry.route.exitId) || 0) + 1);
  }
  const keyed = Array.from(used.keys()).map((exitId) => ctx.exits.get(exitId)).sort((a, b) => a.number - b.number);
  const where = corridor ? 'on this corridor' : 'on this floor';
  const lost = mine.filter((entry) => !entry.route.ok);
  const cards = keyed.map((info) => keyCard(info, used.get(info.exit.id), where));
  const lines = [];
  const say = (name, html, extra) => lines.push({ html: '<p class="poster__line' + (extra ? ' poster__line--' + extra : '') + '" data-line="' + name + '">' + html + '</p>', chars: plain(html).length, bold: extra === 'bold' || extra === 'warn' });
  if (keyed.length === 0) {
    if (ctx.exits.size === 0) say('no-exit', esc(NO_EXIT));
    // every room on the floor has no way out: the list of them below says so, once
    else if (mine.length === 0) say('no-way', esc(corridor ? 'No rooms open onto this corridor.' : 'There are no rooms on ' + floor.name + '.'));
    else if (lost.length < mine.length) say('no-way', esc('No room here has a way out to show.'));
  }

  if (corridor) {
    if (keyed.length > 0) {
      const byCount = keyed.slice().sort((a, b) => used.get(b.exit.id) - used.get(a.exit.id) || a.number - b.number);
      say('corridor', esc('Rooms on ') + typed(corridor.name) + esc(' go out by ') + andList(byCount.map((info) => withNumber(info) + esc(', ' + count(used.get(info.exit.id), 'room')))) + '.');
    }
  } else {
    const stairs = stairsSentence(project, mine, floor, ctx);
    if (stairs !== '') say('stairs', stairs);
  }
  if (elevatorCars(project.building).length > 0) say('elevator', esc(NEVER_ELEVATOR), 'bold');
  const refuge = refugeSentence(project, floor);
  if (refuge !== '' && !corridor) say('refuge', refuge);
  if (!corridor) say('find', esc(FIND_YOUR_ROOM));
  if (lost.length > 0) {
    const named = new Map();
    for (const space of floor.spaces) if (space.kind === 'room') named.set(space.id, space);
    say('no-route', lost.map((entry) => typed(nameOfRoom(named.get(entry.roomId), true))).join(', ') + esc(lost.length === 1 ? ' has no way out and is not on this poster.' : ' have no way out and are not on this poster.'), 'warn');
  }
  const text = { cards: cards.map((card) => plain(card).length), lines };

  // the largest plan the room left allows
  const head = headerMm(view.box, view.scale, what, HEADLINE_PT);
  const height = view.box.height - head - FOOT_MM;
  const fit = fitPlan({
    wide: view.wide,
    width: view.box.width,
    height,
    aspect: plan.width / plan.height,
    gap: GAP_MM,
    beside: (width) => textHeight(text, view, width, 1),
    under: (width) => textHeight(text, view, width, cardsAcross(text, view, width)),
  });
  const cols = fit.layout === 'under' ? cardsAcross(text, view, view.box.width) : 1;
  const figure = '<figure class="poster__plan"><div class="poster__picture" style="width: ' + mm(fit.plan.width) + '; height: ' + mm(fit.plan.height) + ';">' + plan.svg + '</div></figure>';
  const list = cards.length > 0 ? '<ul class="poster__key">' + cards.join('') + '</ul>' : '';

  return '<div class="poster poster--' + (view.wide ? 'wide' : 'tall') + ' poster--' + fit.layout + '" style="--poster-scale: ' + Math.round(view.scale * 100) / 100 + '; --poster-cols: ' + cols
    + '; --poster-free-w: ' + mm(fit.freeW) + '; --poster-free-h: ' + mm(fit.freeH) + ';" data-layout="' + fit.layout + '" data-floor="' + esc(floor.id) + '"' + (corridor ? ' data-corridor="' + esc(corridor.id) + '"' : '') + '>'
    + figure + '<div class="poster__text">' + list + lines.map((item) => item.html).join('') + '</div></div>';
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
    return wanted.map(({ corridor, floor }) => {
      const what = 'Evacuation · ' + corridor.name + ', ' + floor.name;
      return { what, body: sheet(project, floor, ctx, view, corridor, what) };
    });
  }
  return floorsFor(project, opts).map((floor) => {
    const what = 'Evacuation routes · ' + floor.name;
    return { what, body: sheet(project, floor, ctx, view, null, what) };
  });
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
