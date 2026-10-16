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
//                    A floor id that is no floor of the building, and
//                    roomIds that are not a list, print one sheet saying
//                    there is nothing to print, never every room.
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
// the route over it (the window grown where the exit's door name lies past
// it). A floor the route leaves and comes back to is one map with both
// stretches on it. The maps are at one scale, in whichever arrangement makes
// the cells largest (mapLayout): one row, one stack, or cut in route order
// into rows or columns.
//
// A card is one sheet when it can be. Directions too long for the room left
// under the maps go on to a second sheet (a .new-sheet inside the card's
// page, headed "continued"), and a third if they need it. Upright, the steps
// that fit on the first sheet are counted first (the maps keep at least
// MAP_LEAST of the room while that keeps every step on the one sheet, else
// MAP_SHARE) and the maps then take all the height the steps leave; when
// every step is on the one sheet they stand in two columns if that lets the
// maps be larger. On a sheet turned on its side the steps' column widens, up
// to half the width, when that keeps every step on the one sheet. The last
// card keeps room for the closing line after it (FOOT_MM). How much room a
// step takes is worked out from its words (linesOf), on the safe side,
// because a print document is a string and cannot measure itself; cardFit()
// gives every number.
//
// A room with no way out gets a card that says so, in the routing engine's
// own sentence, and one more (ELEVATOR_SAYS) when an elevator would be its
// only way out. A first sheet comes before the cards whenever there is more
// than one card or any room has no way out: it says how many cards follow
// and for which rooms, lists the rooms with no way out with their
// sentences, and lists the pile in order so it can be checked.
//
// Every name is as typed: escaped through esc(), and set in a span with
// dir="auto" so a name in a right-to-left script reads in its own direction.
// The routing engine's sentences, which have names in them, are set the same
// way.

import { count } from '../components/words.js';
import { routingGraph } from '../../engine/routing.js';
import { evacuationRoutes, doorCard } from '../../engine/evacuation.js';
import { roomRows, sortRoomRows } from './room-list.js';
import { planSvg } from './plan-svg.js';
import { esc, frame, mm, paperOf, printableBox, schoolName } from './document.js';

export const id = 'door-cards';
export const name = 'Door cards';
export const CARD_WHAT = 'Evacuation route';
export const NO_ROUTE_SAYS = 'There is no route to post for this room. Give it a way out in the Building section, then print its card again.';
export const KEY_SAYS = 'The dark line is the way out: from the round mark at the door to the square mark at the exit.';
export const ELEVATOR_SAYS = 'The only way out from this room is by elevator, and an elevator is not used in an evacuation.';
export const NOTHING_SAYS = 'The floor asked for is not in the building, so there is nothing to print.';

// Millimetres, measured against print.css's door-card block.
// the frame's header with the school's name on one line (Chromium measures
// 19.5 mm: a 9 pt line, the 18 pt heading, the rule and the gap under it),
// and each further line of a long name
const HEADER_MM = 20.5;
const SCHOOL_LINE_MM = 4.5;
const ROOM_LINE_MM = 10.2;     // a line of the room's name, 26 pt at 1.1
const FLOOR_LINE_MM = 6.1;     // the floor's line under it, 13 pt at 1.3
const ROOM_GAP_MM = 4;
const CAPTION_MM = 6;          // a map's floor name under it
const KEY_PT = 8.5;            // the line saying what the marks are
const KEY_GAP_MM = 2.5;
const MAP_GAP_MM = 4;
const STEP_PT = 11;
const STEP_GAP_MM = 1.6;
const NUMBER_MM = 8;           // the column the step numbers stand in
const EXIT_PT = 12;
const EXIT_PAD_MM = 6.5;       // the exit block's gap, padding and rule
const CONTINUED_MM = 14;       // the line at the top of a second sheet
// the closing line after the last sheet (.doc-foot: 6 mm over, 2 mm padding,
// its rule, a line of 8 pt), on the safe side
export const FOOT_MM = 12.5;
const COLUMN_GAP_MM = 6;
const LINE_HEIGHT = 1.35;
const PT_MM = 25.4 / 72;
// Upright, the maps keep at least this share of the first sheet's room when
// the steps run on to a second sheet anyway.
export const MAP_SHARE = 0.42;
// ... but give up to this much of it so that every step fits on one sheet.
export const MAP_LEAST = 0.3;
// On a sheet turned on its side the maps take this share of the width,
const SIDE_SHARE = 0.58;
// ... and give up to this share of it so that every step fits on one sheet.
const SIDE_LEAST = 0.5;
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

// The header's height: the school's name is set in capitals, spaced out, so
// a character is counted at about 1.3 times a lower-case one.
function headerMm(project, width) {
  return HEADER_MM + (linesOf(schoolName(project), width, 9 * 1.3) - 1) * SCHOOL_LINE_MM;
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
// A choice that names nothing in the building (a floor id that is no floor,
// roomIds that are not a list) prints nothing, never every room.
export function roomsFor(project, options) {
  const opts = options || {};
  const floors = project.building.floors;
  const given = (value) => value !== undefined && value !== null && value !== '';
  if (given(opts.roomIds)) {
    const wanted = new Set(Array.isArray(opts.roomIds) ? opts.roomIds : []);
    return { rows: sortRoomRows(roomRows(project, 'all')).filter((row) => wanted.has(row.id)), where: 'chosen', floor: null };
  }
  if (!given(opts.floorId) || opts.floorId === 'all') return { rows: sortRoomRows(roomRows(project, 'all')), where: 'building', floor: null };
  const floor = floors.find((candidate) => candidate.id === opts.floorId);
  if (!floor) return { rows: [], where: 'unknown', floor: null };
  return { rows: sortRoomRows(roomRows(project, floor.id)), where: 'floor', floor };
}

// Every card's data, in print order: [{ row, card, onlyByElevator }].
export function cardsFor(project, options) {
  const { rows } = roomsFor(project, options);
  if (rows.length === 0) return [];
  const graph = routingGraph(project);
  const evacuation = evacuationRoutes(project, graph);
  const entries = new Map(evacuation.rooms.map((entry) => [entry.roomId, entry]));
  return rows.map((row) => {
    const entry = entries.get(row.id);
    return { row, card: doorCard(project, graph, entry.route, { avoidConnections: evacuation.asked.avoidConnections }), onlyByElevator: entry.onlyByElevator === true };
  });
}

function typed(value, cls) {
  return '<span' + (cls ? ' class="' + cls + '"' : '') + ' dir="auto">' + esc(value) + '</span>';
}

// A step's words, with what a user typed set apart.
function stepWords(step) {
  const parts = Array.isArray(step.parts) && step.parts.length > 0 ? step.parts : [{ text: step.text, name: false }];
  return parts.map((part) => (part.name ? typed(part.text) : esc(part.text))).join('');
}

function stepsList(steps, columns) {
  if (steps.length === 0) return '';
  return '<ul class="card__steps' + (columns === 2 ? ' card__steps--two' : '') + '">' + steps.map((step) => '<li class="card__step" data-n="' + step.n + '"><span class="card__n">' + step.n + '.</span> <span class="card__words">' + stepWords(step) + '</span></li>').join('') + '</ul>';
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

// Every way to cut k maps, in route order, into groups that follow one
// another: all 2^(k-1) of them up to eight maps, and past that groups of an
// even size.
function groupings(k) {
  const out = [];
  if (k <= 8) {
    for (let mask = 0; mask < 2 ** (k - 1); mask += 1) {
      const groups = [[0]];
      for (let i = 1; i < k; i += 1) {
        if (mask & (1 << (i - 1))) groups.push([i]);
        else groups[groups.length - 1].push(i);
      }
      out.push(groups);
    }
  } else {
    for (let size = k; size >= 1; size -= 1) {
      const groups = [];
      for (let i = 0; i < k; i += size) groups.push(Array.from({ length: Math.min(size, k - i) }, (_, j) => i + j));
      out.push(groups);
    }
  }
  // one row, then one stack, then the rest: a tie keeps the plainer
  out.sort((a, b) => (a.length === 1 ? -1 : b.length === 1 ? 1 : a.length === k ? -1 : b.length === k ? 1 : 0));
  return out;
}

// The cell a grouping allows, read as rows (each group a row, the rows one
// above another) or as columns (each group a column, side by side), and how
// tall the maps then stand, captions and gaps in.
function fitRows(boxes, groups, width, height) {
  const wide = Math.min(...groups.map((group) => (width - (group.length - 1) * MAP_GAP_MM) / group.reduce((sum, i) => sum + boxes[i].width, 0)));
  const tall = groups.reduce((sum, group) => sum + Math.max(...group.map((i) => boxes[i].height)), 0);
  const fixed = groups.length * CAPTION_MM + (groups.length - 1) * MAP_GAP_MM;
  return { cell: Math.min(wide, (height - fixed) / tall), height: (cell) => tall * cell + fixed };
}

function fitColumns(boxes, groups, width, height) {
  const wide = groups.reduce((sum, group) => sum + Math.max(...group.map((i) => boxes[i].width)), 0);
  const column = (group) => ({ tall: group.reduce((sum, i) => sum + boxes[i].height, 0), fixed: group.length * CAPTION_MM + (group.length - 1) * MAP_GAP_MM });
  const columns = groups.map(column);
  return {
    cell: Math.min((width - (groups.length - 1) * MAP_GAP_MM) / wide, ...columns.map((c) => (height - c.fixed) / c.tall)),
    height: (cell) => Math.max(...columns.map((c) => c.tall * cell + c.fixed)),
  };
}

// The maps laid out in a region `width` by `height` mm, every floor at the
// same scale so a map is honest about how far is far: whichever arrangement
// lets the cells be largest, of one row, one stack, and the maps cut in route
// order into rows under one another or columns side by side.
//   → { across, cell, height, kind: 'row' | 'stack' | 'rows' | 'columns', groups }
export function mapLayout(boxes, width, height) {
  const k = boxes.length;
  let best = null;
  for (const groups of groupings(k)) {
    const tries = groups.length === 1 || groups.length === k ? [['rows', fitRows]] : [['rows', fitRows], ['columns', fitColumns]];
    for (const [reading, fit] of tries) {
      const found = fit(boxes, groups, width, height);
      if (best === null || found.cell > best.found.cell + 1e-9) best = { groups, reading, found };
    }
  }
  const { groups, reading, found } = best;
  const kind = groups.length === 1 ? 'row' : groups.length === k ? 'stack' : reading;
  const cell = Math.max(0.1, Math.min(found.cell, LARGEST_CELL_MM));
  return { across: kind === 'row', cell, height: found.height(cell), kind, groups };
}

// Each floor's map, cropped to its box with the route over it. Its width and
// height are in cells, the box's or, where the exit's name needed the window
// to grow, a little more.
function plansOf(project, card) {
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  return card.floors.map((held) => planSvg(project, floors.get(held.floorId), { crop: held.box, route: { cells: held.cells, start: held.start, exit: held.exit } }));
}

function mapsMarkup(card, plans, layout) {
  const figures = card.floors.map((held, i) => '<figure class="card__map" data-floor="' + esc(held.floorId) + '">'
    + '<div class="card__plan" style="width: ' + mm(plans[i].width * layout.cell) + '; height: ' + mm(plans[i].height * layout.cell) + ';">' + plans[i].svg + '</div>'
    + '<figcaption class="card__map-name">' + mapCaption(held) + '</figcaption>'
    + '</figure>');
  const inside = layout.kind === 'row' || layout.kind === 'stack'
    ? figures.join('')
    : layout.groups.map((group) => '<div class="card__maps-group">' + group.map((i) => figures[i]).join('') + '</div>').join('');
  return '<div class="card__maps card__maps--' + layout.kind + '">' + inside + '</div>'
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

// How tall the steps stand in two columns side by side, `width` mm each:
// the browser balances them, so the taller of the two at the best cut.
export function twoColumnsMm(steps, width) {
  const heights = steps.map((step) => stepMm(step, width));
  const total = heights.reduce((sum, h) => sum + h, 0);
  let best = total;
  let first = 0;
  for (const h of heights) {
    first += h;
    best = Math.min(best, Math.max(first, total - first));
  }
  return best;
}

// How a card is laid out, worked out from the sizes in print.css: every
// number the layout comes from, so a test can read them.
//   options.last   this card is the document's last: its sheets keep room
//                  for the closing line a browser with no page margin boxes
//                  prints after it (frame() in document.js). It is kept
//                  whether or not the browser has them, which a print
//                  document cannot know.
//   → { side, header, room, foot, key, exit, later, share, columns, steps, sheets,
//       firstSteps, region, layout, plans }
export function cardFit(project, row, card, paper, options) {
  const box = printableBox(paper);
  const side = paper.orientation === 'landscape';
  const foot = options && options.last ? FOOT_MM : 0;
  const plans = plansOf(project, card);
  const boxes = plans.map((plan) => ({ width: plan.width, height: plan.height }));
  const header = headerMm(project, box.width);
  const room = box.height - header - roomMm(card, row, box.width) - foot;
  const later = box.height - CONTINUED_MM - exitMm(card, box.width) - foot;
  if (side) {
    // the maps on the left take the whole height; the steps on the right,
    // in a column made wider, a few points of the width at a time, when that
    // keeps every step on the one sheet
    let fit = null;
    for (let share = SIDE_SHARE; share >= SIDE_LEAST - 1e-9; share -= 0.02) {
      const stepsWidth = (box.width - COLUMN_GAP_MM) * (1 - share);
      const mapsWidth = (box.width - COLUMN_GAP_MM) * share;
      const exit = exitMm(card, stepsWidth);
      const key = keyMm(mapsWidth);
      const sheets = sheetsOfSteps(card.steps, room - exit, later, { first: stepsWidth, later: box.width });
      const region = { width: mapsWidth, height: room - key };
      const tried = { side, header, room, foot, key, exit, later, plans, share: Math.round(share * 100) / 100, columns: 1, steps: stepsWidth, sheets, firstSteps: sheets[0].reduce((sum, step) => sum + stepMm(step, stepsWidth), 0), region };
      if (fit === null) fit = tried;
      if (sheets.length === 1) { fit = tried; break; }
    }
    return { ...fit, layout: mapLayout(boxes, fit.region.width, fit.region.height) };
  }
  const stepsWidth = box.width;
  const exit = exitMm(card, stepsWidth);
  const mapsWidth = box.width;
  const key = keyMm(mapsWidth);
  const out = { side, header, room, foot, key, exit, later, plans, share: 1 };
  // upright, the maps keep a share of the room, or less when they are as
  // large as the sheet's width lets them be in less
  const keeps = (share) => Math.min(room * share, mapLayout(boxes, box.width, room * share).height);
  const roomFor = (share) => room - keeps(share) - key - MAP_GAP_MM - exit;
  const all = card.steps.reduce((sum, step) => sum + stepMm(step, stepsWidth), 0);
  const firstRoom = all <= roomFor(MAP_LEAST) ? roomFor(MAP_LEAST) : roomFor(MAP_SHARE);
  const sheets = sheetsOfSteps(card.steps, firstRoom, later, { first: stepsWidth, later: box.width });
  const firstSteps = sheets[0].reduce((sum, step) => sum + stepMm(step, stepsWidth), 0);
  // the maps take the height the first sheet's steps leave
  const region = { width: mapsWidth, height: room - key - MAP_GAP_MM - exit - firstSteps };
  const one = { ...out, columns: 1, steps: stepsWidth, sheets, firstSteps, region, layout: mapLayout(boxes, region.width, region.height) };
  if (sheets.length > 1 || card.steps.length < 2) return one;
  // every step on the one sheet: in two columns, when that lets the maps be larger
  const half = (box.width - COLUMN_GAP_MM) / 2;
  const twoSteps = twoColumnsMm(card.steps, half);
  const twoRegion = { width: mapsWidth, height: room - key - MAP_GAP_MM - exit - twoSteps };
  const two = mapLayout(boxes, twoRegion.width, twoRegion.height);
  if (two.cell <= one.layout.cell + 1e-9) return one;
  return { ...out, columns: 2, steps: half, sheets, firstSteps: twoSteps, region: twoRegion, layout: two };
}

// One card's page body.
function cardBody(project, row, card, paper, entry, last) {
  const head = roomBlock(card, row);
  const open = '<div class="card" data-card="' + esc(row.id) + '" data-route="' + (card.ok ? 'ok' : card.stale ? 'stale' : 'none') + '">';
  if (!card.ok) {
    const lift = entry && entry.onlyByElevator ? '<p class="card__lift">' + esc(ELEVATOR_SAYS) + '</p>' : '';
    return open + head + '<p class="card__none">' + typed(card.sentence) + '</p>' + lift + '<p class="doc-meaning">' + esc(NO_ROUTE_SAYS) + '</p></div>';
  }
  const fit = cardFit(project, row, card, paper, { last });
  const { sheets } = fit;
  const split = fit.side && fit.share !== SIDE_SHARE ? ' style="grid-template-columns: ' + Math.round(fit.share * 100) + 'fr ' + Math.round((1 - fit.share) * 100) + 'fr;"' : '';
  const out = [open, head, '<div class="card__body card__body--' + (fit.side ? 'side' : 'up') + '"' + split + '>',
    '<div class="card__where">' + mapsMarkup(card, fit.plans, fit.layout) + '</div>',
    '<div class="card__directions">' + stepsList(sheets[0], fit.columns) + exitBlock(card) + '</div>',
    '</div>'];
  const floorName = card.floor ? card.floor.name : row.floor;
  sheets.slice(1).forEach((sheet, index) => {
    const end = index === sheets.length - 2;
    out.push('<div class="card__more new-sheet" data-sheet="' + (index + 2) + '">'
      + '<p class="card__continued">' + typed(card.name) + ' · ' + typed(floorName) + ' · ' + esc(CARD_WHAT + ', continued') + '</p>'
      + stepsList(sheet, 1) + (end ? exitBlock(card) : '') + '</div>');
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
    out.push('<ul class="card-cover__missing">' + missing.map(({ row, card, onlyByElevator }) => '<li data-room="' + esc(row.id) + '">' + typed(card.sentence) + (onlyByElevator ? ' ' + esc(ELEVATOR_SAYS) : '') + '</li>').join('') + '</ul>');
  }
  out.push('<h2>In this pile</h2>');
  out.push('<ul class="card-cover__list">' + cards.map(({ row, card, onlyByElevator }) => {
    const floorName = card.floor ? card.floor.name : row.floor;
    const to = !card.ok ? (onlyByElevator ? 'no way out but by elevator' : 'no way out') : exitName(card.exit) === null ? 'to the exit on ' + typed(card.exit.floorName) : 'to ' + typed(exitName(card.exit));
    return '<li data-room="' + esc(row.id) + '">' + typed(card.name) + ', ' + typed(floorName) + ' <span class="card-cover__to">' + to + '</span></li>';
  }).join('') + '</ul>');
  return out.join('\n');
}

function emptyWords(rooms) {
  if (rooms.where === 'unknown') return NOTHING_SAYS;
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
  cards.forEach((entry, i) => pages.push({ what: CARD_WHAT, body: cardBody(project, entry.row, entry.card, paper, entry, i === cards.length - 1) }));
  return frame(project, { output: id, what: name, pages, options: opts });
}
