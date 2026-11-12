// The lockdown map on paper (spec 10.3; DESIGN 14.6 and 14.7 item 6;
// ARCHITECTURE 20.5, 20.9): one sheet a floor, the plan with a reference grid
// over it, and beside it (under it on an upright sheet) the index.
//
//   the plan      planSvg with `refGrid` and `exitMarks`, rooms' numbers only
//                 (`teachers: false`: no surname under a number), landscape
//                 by default
//   Rooms         every room with a number, and every other space with a
//                 label, in natural order, each with the grid square its
//                 label is in: "204 · C3". The square is the one planSvg's
//                 `labelCells` names, so the index says what was drawn. A room
//                 with no number and no label is left out and counted
//   Exits         every exit of the building, numbered as everywhere
//                 (exit-load.js), "1 · Door A · Floor 1"
//   Stairs and elevators   those that touch this floor, by letter, with their
//                 floors
//   the footer    three plain lines (DESIGN 14.6): places only
//
// A lockdown map names places, never people: no teacher, no group, no head
// count is read here, and none is on the sheet. The model holds no address,
// no north, no shut-offs and no keyed entry, and the footer does not pretend
// it does.
//
// pages(project, derived, options) → [{ what, body }]
// render(project, derived, options) → { title, html }
//   options.floorIds   the floors to print, in the building's order; every
//                      floor when left out or when none of them is in the building
//   and what every output takes (document.js)
// Every name is escaped and set in a span with dir="auto". Nothing is worked
// out here that an engine module can say: the numbers and door names are
// exit-load.js's, the stairs words blocked.js's.

import { ELEVATOR_KIND, elevatorCars, nameOfRoom } from '../../engine/schema.js';
import { exitNumbers, exitName } from '../../engine/exit-load.js';
import { stairsName } from '../../engine/blocked.js';
import { count, list } from '../components/words.js';
import { esc, frame, mm, paperOf, printableBox } from './document.js';
import { fitPlan, sheetScale, wrapped } from './evacuation-poster.js';
import { labelOn } from '../colour.js';
import { planSvg, gridSquare, printExitColour, PLAN_INK, PLAN_PAPER } from './plan-svg.js';

export const id = 'lockdown-map';
export const name = 'Lockdown map';
// the preview opens on a landscape sheet (print-preview.js)
export const orientation = 'landscape';

// What the sheet spends besides the plan, in millimetres: the header (school,
// 18 pt headline, rule) and the footer lines under the plan and index (the
// footer's type grows with the sheet, so its height does too).
const HEADER_MM = 23;
const GAP_MM = 6;
const MM_PER_PT = 25.4 / 72;
const BASE_PT = 8;

export const FOOTER_LINES = [
  'Rooms, exits, stairs and elevators only: no staff or student lists.',
  'Not every exit opens from outside.',
  'Room labels print as typed in Building.',
];

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function typed(value) {
  return '<span dir="auto">' + esc(value) + '</span>';
}

// The floors asked for, in the building's order; all of them when none is.
export function floorsFor(project, options) {
  const floors = project.building.floors;
  const asked = options && Array.isArray(options.floorIds) ? options.floorIds : null;
  if (!asked) return floors;
  const some = floors.filter((floor) => asked.includes(floor.id));
  return some.length > 0 ? some : floors;
}

function blank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

// The rows of the index for one floor: [{ text, square, rank, sort }], and how
// many rooms are left out because nothing names them. In order: rooms whose
// number has a digit in it, in natural order (101, 102, 103, B12); then the
// rooms named in words (a number such as Cafeteria, or no number but a label),
// by that name; then the other spaces by label.
function indexOf(floor, plan) {
  const rows = [];
  let left = 0;
  for (const space of floor.spaces) {
    const cell = plan.labelCells ? plan.labelCells.get(space.id) : null;
    const square = gridSquare(plan.grid, floor.width, cell);
    if (space.kind === 'room') {
      const text = !blank(space.number) ? String(space.number) : !blank(space.label) ? String(space.label) : null;
      if (text === null) {
        left += 1;
        continue;
      }
      rows.push({ text, square, rank: !blank(space.number) && /\d/.test(text) ? 0 : 1 });
    } else if (!blank(space.label)) {
      rows.push({ text: String(space.label), square, rank: 2 });
    }
  }
  rows.sort((a, b) => a.rank - b.rank || collator.compare(a.text, b.text) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return { rows, left };
}

// The exits of the building, numbered, with their floors.
function exitRows(project) {
  const numbers = exitNumbers(project);
  const rows = [];
  for (const floor of project.building.floors) {
    for (const exit of floor.exits || []) {
      const number = numbers.get(exit.id);
      const named = typeof exit.doorName === 'string' && exit.doorName.trim() !== '';
      rows.push({ number, colour: printExitColour(number - 1), name: exitName(project, exit.id), floor: floor.name, named, floorId: floor.id, exit });
    }
  }
  return rows;
}

// The stairs and elevators that touch this floor, one line each.
function liftRows(project, floor) {
  const touches = (connection) => (connection.a && connection.a.floorId === floor.id) || (connection.b && connection.b.floorId === floor.id);
  const stairs = project.building.connections
    .filter((connection) => connection.kind !== ELEVATOR_KIND && touches(connection))
    .map((connection) => ({ sort: connection.label || '', text: stairsName(project, connection) }));
  stairs.sort((a, b) => collator.compare(a.sort, b.sort));
  const floorName = new Map(project.building.floors.map((each) => [each.id, each.name]));
  const cars = elevatorCars(project.building)
    .filter((car) => car.stops.some((stop) => stop.floorId === floor.id))
    .map((car) => {
      const stops = car.stops.map((stop) => floorName.get(stop.floorId)).filter((each) => each !== undefined);
      // the floor names are the floors' own ("Floor 1"), so no word "Floors" before them
      const where = list(stops);
      return { sort: car.label || '', text: 'Elevator' + (car.label ? ' ' + car.label : '') + ' · ' + where + (car.staffOnly ? ' · staff only' : '') };
    });
  cars.sort((a, b) => collator.compare(a.sort, b.sort));
  return stairs.concat(cars);
}

function footer() {
  return '<div class="lockdown__foot">' + FOOTER_LINES.map((line) => '<p>' + esc(line) + '</p>').join('') + '</div>';
}

// ---- how tall the index is, for fitting the plan to what is left
//
// Estimated from the words, in millimetres, never measured in a browser, so a
// sheet is laid out the same everywhere. `size` is the type in mm.

// a block of items (each a number of characters) in `cols` columns `width` wide
function itemsHeight(chars, width, size, cols) {
  const across = (width - (cols - 1) * size) / cols;
  const heights = chars.map((each) => wrapped(each, across, size) * size * 1.25 + 0.4);
  return heights.reduce((sum, each) => sum + each, 0) / cols + (heights.length > 0 ? size * 1.25 : 0);
}

function blockHeight(chars, width, size, cols) {
  return size * 1.25 * 1.25 + 1 + itemsHeight(chars, width, size, cols) + 3;
}

// The index's figures for a floor: how many characters each line has.
function measures(rows, left, exits, ways) {
  const rooms = rows.map((row) => row.text.length + (row.square ? 5 : 0));
  if (rows.length === 0) rooms.push(40);
  if (left > 0) rooms.push(40);
  const exitLines = exits.length === 0 ? [50] : exits.map((exit) => 4 + exit.name.length + 3 + exit.floor.length);
  const stairLines = ways.length === 0 ? [30] : ways.map((way) => way.text.length);
  return { rooms, exits: exitLines, stairs: stairLines };
}

// The index in a column `width` wide beside the plan, the blocks one over the next.
function besideIndex(m, width, size, scale) {
  let best = null;
  for (let cols = 1; cols <= 4; cols++) {
    if (cols > 1 && (width - (cols - 1) * size) / cols < 24 * scale) break;
    const height = blockHeight(m.rooms, width, size, cols) + blockHeight(m.exits, width, size, 1) + blockHeight(m.stairs, width, size, 1);
    if (best === null || height < best.height - 0.5) best = { height, cols };
  }
  return best;
}

// The index under the plan, the three blocks side by side across `width`.
function underIndex(m, width, size, scale) {
  let best = null;
  for (let cols = 1; cols <= 4; cols++) {
    const weights = [cols * 30, 55, 55];
    const room = width - 2 * GAP_MM;
    const total = weights[0] + weights[1] + weights[2];
    const widths = weights.map((weight) => (room * weight) / total);
    if (cols > 1 && (widths[0] - (cols - 1) * size) / cols < 24 * scale) break;
    const height = Math.max(blockHeight(m.rooms, widths[0], size, cols), blockHeight(m.exits, widths[1], size, 1), blockHeight(m.stairs, widths[2], size, 1));
    if (best === null || height < best.height - 0.5) best = { height, cols, weights };
  }
  return best;
}

export function pages(project, derived, options) {
  const opts = options || {};
  const box = printableBox(paperOf(project, opts));
  const wide = paperOf(project, opts).orientation === 'landscape';
  const numbers = exitNumbers(project);
  const exits = exitRows(project);
  const scale = sheetScale(box);
  // the footer's three lines grow with the sheet, so what is left does too
  const foot = 3 * BASE_PT * scale * MM_PER_PT * 1.4 + 4;
  return floorsFor(project, opts).map((floor) => {
    const what = name + ' · ' + floor.name;
    const marks = (floor.exits || []).map((exit) => ({ exitId: exit.id, number: numbers.get(exit.id), colour: printExitColour(numbers.get(exit.id) - 1) }));
    const plan = planSvg(project, floor, { refGrid: true, exitMarks: marks, teachers: false });
    if (!plan.drawn) {
      return { what, body: '<p class="doc-lead">' + esc('Nothing is drawn on ' + floor.name + ' yet.') + '</p>' + footer() };
    }
    const index = indexOf(floor, plan);
    const ways = liftRows(project, floor);
    const lines = index.rows.length;
    // a long list takes smaller type and more columns, never under 7 pt
    const dense = lines > 40 ? (lines > 80 ? 3 : 2) : 0;
    const points = dense === 3 ? 7 : dense === 2 ? 7.5 : BASE_PT;
    const size = points * scale * MM_PER_PT;
    const m = measures(index.rows, index.left, exits, ways);

    // the largest plan the room left allows
    const fit = fitPlan({
      wide,
      width: box.width,
      height: box.height - HEADER_MM - foot,
      aspect: plan.width / plan.height,
      gap: GAP_MM,
      beside: (width) => besideIndex(m, width, size, scale).height,
      under: (width) => underIndex(m, width, size, scale).height,
    });
    const set = fit.layout === 'under' ? underIndex(m, box.width, size, scale) : besideIndex(m, fit.side, size, scale);
    const figure = '<figure class="lockdown__plan">'
      + '<div class="lockdown__picture" style="width: ' + mm(fit.plan.width) + '; height: ' + mm(fit.plan.height) + ';">' + plan.svg + '</div>'
      + '</figure>';

    const rooms = ['<section class="lockdown__block" data-block="rooms"><h2>Rooms</h2>'];
    if (lines === 0) rooms.push('<p class="lockdown__none">' + esc('No rooms or labelled spaces on this floor.') + '</p>');
    else {
      rooms.push('<ul class="lockdown__rooms">');
      for (const row of index.rows) {
        rooms.push('<li>' + typed(row.text) + (row.square ? ' <span class="lockdown__sq">· ' + esc(row.square) + '</span>' : '') + '</li>');
      }
      rooms.push('</ul>');
    }
    if (index.left > 0) rooms.push('<p class="lockdown__none" data-line="unnumbered">' + esc(count(index.left, 'room') + ' with no number ' + (index.left === 1 ? 'is' : 'are') + ' not listed.') + '</p>');
    rooms.push('</section>');

    const exitList = ['<section class="lockdown__block" data-block="exits"><h2>Exits</h2>'];
    if (exits.length === 0) exitList.push('<p class="lockdown__none" data-line="no-exit">' + esc('The building has no exit yet. Add one in Building.') + '</p>');
    else {
      exitList.push('<ul class="lockdown__list">');
      for (const exit of exits) {
        exitList.push('<li data-exit="' + esc(exit.exit.id) + '"><span class="lockdown__badge" style="background: ' + esc(exit.colour) + '; color: ' + esc(labelOn(exit.colour, PLAN_INK, PLAN_PAPER)) + ';">' + exit.number + '</span> ' + typed(exit.name) + ' <span class="lockdown__sq">· ' + typed(exit.floor) + '</span></li>');
      }
      exitList.push('</ul>');
    }
    exitList.push('</section>');

    const stairsList = ['<section class="lockdown__block" data-block="stairs"><h2>Stairs and elevators</h2>'];
    if (ways.length === 0) stairsList.push('<p class="lockdown__none">' + esc('No stairs or elevators on this floor.') + '</p>');
    else stairsList.push('<ul class="lockdown__list">' + ways.map((way) => '<li>' + typed(way.text) + '</li>').join('') + '</ul>');
    stairsList.push('</section>');

    const columns = fit.layout === 'under' ? '--lockdown-cols: ' + set.weights.map((weight) => weight + 'fr').join(' ') + '; ' : '';
    const side = '<div class="lockdown__index">' + rooms.join('') + exitList.join('') + stairsList.join('') + '</div>';
    const body = '<div class="lockdown lockdown--' + (wide ? 'wide' : 'tall') + ' lockdown--' + fit.layout + '" style="--lockdown-gap: ' + mm(GAP_MM) + '; --lockdown-scale: ' + Math.round(scale * 100) / 100 + '; --lockdown-fs: ' + points + 'pt; --lockdown-rooms: ' + set.cols + '; ' + columns
      + '--lockdown-free-w: ' + mm(fit.freeW) + '; --lockdown-free-h: ' + mm(fit.freeH) + ';" data-layout="' + fit.layout + '" data-floor="' + esc(floor.id) + '">'
      + '<div class="lockdown__main">' + figure + side + '</div>'
      + footer()
      + '</div>';
    return { what, body };
  });
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
