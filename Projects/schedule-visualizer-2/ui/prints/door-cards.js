// Door cards (spec 10.2): one card per room, to post by its door. Each says
// the school, "Evacuation route", the room and its floor, a map of every
// floor the way out passes through, cropped to the route with its start and
// exit marked, the numbered directions, the exit and the assembly point.
//
// render(project, derived, options) → { title, html }
//   options.roomIds  the rooms to print, by id (a selection, or one room).
//                    Ids that are not rooms of the building are passed over.
//   options.floorId  a floor's id: that floor's rooms. 'all' or left out:
//                    every room. roomIds, when given, wins over floorId.
//   and what every output takes (document.js). The paper and orientation are
//   the ones chosen in the preview sheet: unlike a door sign, a card is laid
//   out for either way up.
//
// The cards come in room order: floor by floor in the building's order, then
// by room number (sortRoomRows with no column, ui/prints/room-list.js). A
// sort the room list on screen was given is not followed, so a pile of cards
// is always in the same order.
//
// The way out is engine/evacuation.js's: evacuationRoutes() once for the
// building, then doorCard() for each room. Its steps are the card's steps
// (numbered, distances out), its floors are the maps in the order the route
// first reaches them, each drawn by planSvg() cropped to the card's box with
// the route over it. A floor the route leaves and comes back to is one map
// with both stretches on it.
//
// A card is one sheet when it can be. Directions too long for the room left
// under the maps go on to a second sheet (a .new-sheet inside the card's
// page, headed "continued"), and a third if they need it. Upright, the maps
// keep MAP_SHARE of the first sheet's room, or what they need when the
// sheet's width holds them to less; they give up to MAP_LEAST when that
// keeps every step on the one sheet. How much room a step takes is worked
// out from its words (linesOf), on the safe side, because a print document
// is a string and cannot measure itself.
//
// A room with no way out gets a card that says so, in the routing engine's
// own sentence. A first sheet comes before the cards whenever there is more
// than one card or any room has no way out: it says how many cards follow
// and for which rooms, lists the rooms with no way out with their
// sentences, and lists the pile in order so it can be checked.
//
// Every name is as typed: escaped through esc(), and set in a span with
// dir="auto" so a name in a right-to-left script reads in its own direction.

import { count } from '../components/words.js';
import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, doorCard } from '../../engine/evacuation.js';
import { roomRows, sortRoomRows } from './room-list.js';
import { planSvg } from './plan-svg.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';

export const id = 'door-cards';
export const name = 'Door cards';
export const CARD_WHAT = 'Evacuation route';
export const NO_ROUTE_SAYS = 'There is no route to post for this room. Give it a way out in the Building section, then print its card again.';
export const KEY_SAYS = 'The dark line is the way out: from the round mark at the door to the square mark at the exit.';

// Millimetres, measured against print.css's door-card block.
const HEADER_MM = 26;          // the frame's header: school, heading, date
const ROOM_LINE_MM = 10.5;     // a line of the room's name, 26 pt
const FLOOR_LINE_MM = 6.5;     // the floor's line under it
const ROOM_GAP_MM = 4;
const CAPTION_MM = 6;          // a map's floor name under it
const KEY_PT = 8.5;            // the line saying what the marks are
const KEY_GAP_MM = 2.5;
const MAP_GAP_MM = 4;
const STEP_PT = 11;
const STEP_GAP_MM = 1.6;
const NUMBER_MM = 8;           // the column the step numbers stand in
const EXIT_PT = 12;
const EXIT_PAD_MM = 7;         // the exit block's rule, padding and gap
const CONTINUED_MM = 14;       // the line at the top of a second sheet
const COLUMN_GAP_MM = 6;
const LINE_HEIGHT = 1.35;
const PT_MM = 25.4 / 72;
// The maps keep at least this share of the first sheet's room, and on a
// sheet turned on its side they take this share of the width.
export const MAP_SHARE = 0.42;
// ... but give up to this much of it so that every step fits on one sheet.
export const MAP_LEAST = 0.3;
const SIDE_SHARE = 0.58;
// A small route is not blown up past this many millimetres a cell.
const LARGEST_CELL_MM = 9;

// Lines a text takes at `pt` points in a column `width` mm wide, on the safe
// side: a character is counted at 0.52 of the size (Public Sans runs about
// 0.47 on these words; a wide one, East Asian or fullwidth, at 1.05), and a
// tenth more for the space lost where lines break between words.
export function linesOf(text, width, pt) {
  let ems = 0;
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    ems += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000) ? 1.05 : 0.52;
  }
  const perLine = width / (pt * PT_MM);
  return Math.max(1, Math.ceil((ems * 1.1) / perLine));
}

function lineMm(pt) {
  return pt * PT_MM * LINE_HEIGHT;
}

function keyMm(width) {
  return linesOf(KEY_SAYS, width, KEY_PT) * KEY_PT * PT_MM * 1.4 + KEY_GAP_MM;
}

function stepMm(step, width) {
  return linesOf(step.n + '. ' + step.text, width - NUMBER_MM, STEP_PT) * lineMm(STEP_PT) + STEP_GAP_MM;
}

// The rooms these cards are for, in room order, and the words for them.
export function roomsFor(project, options) {
  const opts = options || {};
  const floors = project.building.floors;
  if (Array.isArray(opts.roomIds)) {
    const wanted = new Set(opts.roomIds);
    return { rows: sortRoomRows(roomRows(project, 'all')).filter((row) => wanted.has(row.id)), where: 'chosen', floor: null };
  }
  const floor = opts.floorId && opts.floorId !== 'all' ? floors.find((candidate) => candidate.id === opts.floorId) : null;
  return { rows: sortRoomRows(roomRows(project, floor ? floor.id : 'all')), where: floor ? 'floor' : 'building', floor };
}

// Every card's data, in print order: [{ row, card }].
export function cardsFor(project, options) {
  const { rows } = roomsFor(project, options);
  if (rows.length === 0) return [];
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  const routes = new Map(evacuation.rooms.map((entry) => [entry.roomId, entry.route]));
  return rows.map((row) => ({ row, card: doorCard(project, graph, routes.get(row.id), { avoidConnections: evacuation.asked.avoidConnections }) }));
}

function typed(value, cls) {
  return '<span' + (cls ? ' class="' + cls + '"' : '') + ' dir="auto">' + esc(value) + '</span>';
}

// A step's words, with what a user typed set apart.
function stepWords(step) {
  const parts = Array.isArray(step.parts) && step.parts.length > 0 ? step.parts : [{ text: step.text, name: false }];
  return parts.map((part) => (part.name ? typed(part.text) : esc(part.text))).join('');
}

function stepsList(steps) {
  if (steps.length === 0) return '';
  return '<ul class="card__steps">' + steps.map((step) => '<li class="card__step" data-n="' + step.n + '"><span class="card__n">' + step.n + '.</span> <span class="card__words">' + stepWords(step) + '</span></li>').join('') + '</ul>';
}

function exitName(exit) {
  return typeof exit.doorName === 'string' && exit.doorName.trim() !== '' ? exit.doorName : null;
}

function exitBlock(card) {
  const exit = card.exit;
  const door = exitName(exit);
  const line = door === null
    ? '<p class="card__exit-line"><span class="card__label">Exit</span> The exit on ' + typed(exit.floorName) + '</p>'
    : '<p class="card__exit-line"><span class="card__label">Exit</span> ' + typed(door) + ', ' + typed(exit.floorName) + '</p>';
  const assembly = typeof exit.assembly === 'string' && exit.assembly.trim() !== ''
    ? '<p class="card__assembly"><span class="card__label">Assembly point</span> ' + typed(exit.assembly) + '</p>'
    : '<p class="card__assembly card__assembly--none"><span class="card__label">Assembly point</span> None is set for this exit.</p>';
  return '<div class="card__exit">' + line + assembly + '</div>';
}

function exitMm(card, width) {
  const exit = card.exit;
  const door = exitName(exit);
  const first = linesOf('Exit ' + (door === null ? 'The exit on ' : door + ', ') + exit.floorName, width, EXIT_PT);
  const second = linesOf('Assembly point ' + (typeof exit.assembly === 'string' && exit.assembly.trim() !== '' ? exit.assembly : 'None is set for this exit.'), width, EXIT_PT);
  return (first + second) * lineMm(EXIT_PT) + EXIT_PAD_MM;
}

function roomBlock(card, row) {
  const floorName = card.floor ? card.floor.name : row.floor;
  return '<div class="card__room"><p class="card__name">' + typed(card.name) + '</p><p class="card__floor">' + typed(floorName) + '</p></div>';
}

function roomMm(card, row, width) {
  const floorName = card.floor ? card.floor.name : row.floor;
  return linesOf(card.name, width, 26) * ROOM_LINE_MM + linesOf(floorName, width, 13) * FLOOR_LINE_MM + ROOM_GAP_MM;
}

function mapCaption(floor) {
  const what = floor.start !== null && floor.exit !== null ? 'start and exit' : floor.start !== null ? 'start' : floor.exit !== null ? 'exit' : 'on the way';
  return typed(floor.name) + ' · ' + what;
}

// The maps laid out in a region `width` by `height` mm: in a row, or one
// above another, whichever lets the cells be larger. Every floor is drawn at
// the same scale, so a map is honest about how far is far.
export function mapLayout(boxes, width, height) {
  const k = boxes.length;
  const wide = boxes.reduce((sum, box) => sum + box.width, 0);
  const tallest = Math.max(...boxes.map((box) => box.height));
  const widest = Math.max(...boxes.map((box) => box.width));
  const high = boxes.reduce((sum, box) => sum + box.height, 0);
  const row = Math.min((width - (k - 1) * MAP_GAP_MM) / wide, (height - CAPTION_MM) / tallest);
  const stack = Math.min(width / widest, (height - k * CAPTION_MM - (k - 1) * MAP_GAP_MM) / high);
  const across = row >= stack;
  const cell = Math.max(0.1, Math.min(across ? row : stack, LARGEST_CELL_MM));
  // how tall the maps are at that size, captions and gaps in
  const tall = across ? tallest * cell + CAPTION_MM : high * cell + k * CAPTION_MM + (k - 1) * MAP_GAP_MM;
  return { across, cell, height: tall };
}

function mapsMarkup(project, card, region) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  const layout = mapLayout(card.floors.map((floor) => floor.box), region.width, region.height);
  const figures = card.floors.map((held) => {
    const plan = planSvg(project, floors.get(held.floorId), { crop: held.box, route: { cells: held.cells, start: held.start, exit: held.exit } });
    return '<figure class="card__map" data-floor="' + esc(held.floorId) + '">'
      + '<div class="card__plan" style="width: ' + mm(plan.width * layout.cell) + '; height: ' + mm(plan.height * layout.cell) + ';">' + plan.svg + '</div>'
      + '<figcaption class="card__map-name">' + mapCaption(held) + '</figcaption>'
      + '</figure>';
  });
  return '<div class="card__maps card__maps--' + (layout.across ? 'row' : 'stack') + '">' + figures.join('') + '</div>'
    + '<p class="card__key">' + esc(KEY_SAYS) + '</p>';
}

// The steps cut into sheets: those that fit beside or under the maps, then
// as many more sheets as the rest need. Every sheet takes at least one step.
export function sheetsOfSteps(steps, first, later, widths) {
  const sheets = [];
  let i = 0;
  let room = first;
  let width = widths.first;
  while (i < steps.length) {
    const sheet = [];
    let used = 0;
    while (i < steps.length) {
      const need = stepMm(steps[i], width);
      if (sheet.length > 0 && used + need > room) break;
      sheet.push(steps[i]);
      used += need;
      i += 1;
    }
    sheets.push(sheet);
    room = later;
    width = widths.later;
  }
  return sheets.length === 0 ? [[]] : sheets;
}

// One card's page body.
function cardBody(project, row, card, paper) {
  const box = printableBox(paper);
  const side = paper.orientation === 'landscape';
  const head = roomBlock(card, row);
  const open = '<div class="card" data-card="' + esc(row.id) + '" data-route="' + (card.ok ? 'ok' : card.stale ? 'stale' : 'none') + '">';
  if (!card.ok) {
    return open + head + '<p class="card__none">' + esc(card.sentence) + '</p><p class="doc-meaning">' + esc(NO_ROUTE_SAYS) + '</p></div>';
  }
  const room = box.height - HEADER_MM - roomMm(card, row, box.width);
  const stepsWidth = side ? (box.width - COLUMN_GAP_MM) * (1 - SIDE_SHARE) : box.width;
  const exitFirst = exitMm(card, stepsWidth);
  // upright, the maps keep a share of the room, or less when they are as
  // large as the sheet's width lets them be in less
  const boxes = card.floors.map((floor) => floor.box);
  const keeps = (share) => Math.min(room * share, mapLayout(boxes, box.width, room * share).height);
  const mapsWidth = side ? (box.width - COLUMN_GAP_MM) * SIDE_SHARE : box.width;
  const key = keyMm(mapsWidth);
  // the steps' room on the first sheet: beside the maps, or under what the maps keep
  const roomFor = (share) => (side ? room - exitFirst : room - keeps(share) - key - MAP_GAP_MM - exitFirst);
  const all = card.steps.reduce((sum, step) => sum + stepMm(step, stepsWidth), 0);
  const firstRoom = !side && all <= roomFor(MAP_LEAST) ? roomFor(MAP_LEAST) : roomFor(MAP_SHARE);
  const later = box.height - CONTINUED_MM - exitMm(card, box.width);
  const sheets = sheetsOfSteps(card.steps, firstRoom, later, { first: stepsWidth, later: box.width });
  const firstSteps = sheets[0].reduce((sum, step) => sum + stepMm(step, stepsWidth), 0);
  // the maps take what the first sheet's steps leave
  const region = { width: mapsWidth, height: side ? room - key : room - key - MAP_GAP_MM - exitFirst - firstSteps };
  const out = [open, head, '<div class="card__body card__body--' + (side ? 'side' : 'up') + '">',
    '<div class="card__where">' + mapsMarkup(project, card, region) + '</div>',
    '<div class="card__directions">' + stepsList(sheets[0]) + exitBlock(card) + '</div>',
    '</div>'];
  const floorName = card.floor ? card.floor.name : row.floor;
  sheets.slice(1).forEach((sheet, index) => {
    const last = index === sheets.length - 2;
    out.push('<div class="card__more new-sheet" data-sheet="' + (index + 2) + '">'
      + '<p class="card__continued">' + typed(card.name) + ' · ' + typed(floorName) + ' · ' + esc(CARD_WHAT + ', continued') + '</p>'
      + stepsList(sheet) + (last ? exitBlock(card) : '') + '</div>');
  });
  out.push('</div>');
  return out.join('');
}

function whereWords(rooms) {
  if (rooms.where === 'chosen') return 'one for each room chosen';
  if (rooms.where === 'floor') return 'one for each room on ' + rooms.floor.name;
  return 'one for each room in the building';
}

// The first sheet: what follows, the rooms with no way out, the pile in order.
function coverBody(rooms, cards) {
  const missing = cards.filter(({ card }) => !card.ok);
  const out = ['<p class="doc-lead">' + esc(count(cards.length, 'door card') + ', ' + whereWords(rooms) + ', in room order. Each is one sheet, or more where its directions are long.') + '</p>'];
  if (missing.length === 0) {
    out.push('<p class="card-cover__all">' + esc(cards.length === 1 ? 'This room has a way out.' : 'Every one of these rooms has a way out.') + '</p>');
  } else {
    out.push('<h2>' + esc(missing.length === 1 ? 'A room with no way out' : count(missing.length, 'room') + ' with no way out') + '</h2>');
    out.push('<p>' + esc(missing.length === 1 ? 'It gets a card that says so.' : 'Each gets a card that says so.') + '</p>');
    out.push('<ul class="card-cover__missing">' + missing.map(({ row, card }) => '<li data-room="' + esc(row.id) + '">' + esc(card.sentence) + '</li>').join('') + '</ul>');
  }
  out.push('<h2>In this pile</h2>');
  out.push('<ul class="card-cover__list">' + cards.map(({ row, card }) => {
    const floorName = card.floor ? card.floor.name : row.floor;
    const to = !card.ok ? 'no way out' : exitName(card.exit) === null ? 'to the exit on ' + typed(card.exit.floorName) : 'to ' + typed(exitName(card.exit));
    return '<li data-room="' + esc(row.id) + '">' + typed(card.name) + ', ' + typed(floorName) + ' <span class="card-cover__to">' + to + '</span></li>';
  }).join('') + '</ul>');
  return out.join('\n');
}

function emptyWords(rooms) {
  if (rooms.where === 'chosen') return 'None of the rooms chosen is in the building.';
  if (rooms.where === 'floor') return 'There are no rooms on ' + rooms.floor.name + ' yet.';
  return 'There are no rooms in the building yet.';
}

export function render(project, derived, options) {
  const opts = options || {};
  const paper = paperOf(project, opts);
  const rooms = roomsFor(project, opts);
  const cards = cardsFor(project, opts);
  if (cards.length === 0) {
    return frame(project, { output: id, what: name, pages: [{ body: '<p class="doc-lead">' + esc(emptyWords(rooms)) + '</p>' }], options: opts });
  }
  const pages = [];
  if (cards.length > 1 || cards.some(({ card }) => !card.ok)) pages.push({ what: name, body: coverBody(rooms, cards) });
  for (const { row, card } of cards) pages.push({ what: CARD_WHAT, body: cardBody(project, row, card, paper) });
  return frame(project, { output: id, what: name, pages, options: opts });
}
