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
import { labelOn } from '../colour.js';
import { planSvg, gridSquare, printExitColour, PLAN_INK, PLAN_PAPER } from './plan-svg.js';

export const id = 'lockdown-map';
export const name = 'Lockdown map';
// the preview opens on a landscape sheet (print-preview.js)
export const orientation = 'landscape';

// What the sheet spends besides the plan, in millimetres: the header (school,
// headline, rule) and the footer lines under the plan and index.
const HEADER_MM = 26;
const FOOT_MM = 16;
// The plan's share of the sheet's width (landscape) or height (upright).
const PLAN_SHARE_WIDE = 0.64;
const PLAN_SHARE_TALL = 0.6;
const GAP_MM = 6;

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

// The rows of the index for one floor: [{ text, square, sort }], and how many
// rooms are left out because nothing names them.
function indexOf(floor, plan) {
  const rows = [];
  let left = 0;
  for (const space of floor.spaces) {
    const cell = plan.labelCells ? plan.labelCells.get(space.id) : null;
    const square = gridSquare(plan.grid, floor.width, cell);
    if (space.kind === 'room') {
      if (blank(space.number)) {
        left += 1;
        continue;
      }
      rows.push({ text: String(space.number), sort: nameOfRoom(space, true), square, other: false });
    } else if (!blank(space.label)) {
      rows.push({ text: String(space.label), sort: String(space.label), square, other: true });
    }
  }
  // the rooms by number, then the other spaces by label
  rows.sort((a, b) => Number(a.other) - Number(b.other) || collator.compare(a.sort, b.sort));
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
      const where = stops.length > 1 ? 'Floors ' + list(stops) : 'Floor ' + (stops[0] || '');
      return { sort: car.label || '', text: 'Elevator' + (car.label ? ' ' + car.label : '') + ' · ' + where + (car.staffOnly ? ' · staff only' : '') };
    });
  cars.sort((a, b) => collator.compare(a.sort, b.sort));
  return stairs.concat(cars);
}

function footer() {
  return '<div class="lockdown__foot">' + FOOTER_LINES.map((line) => '<p>' + esc(line) + '</p>').join('') + '</div>';
}

export function pages(project, derived, options) {
  const opts = options || {};
  const box = printableBox(paperOf(project, opts));
  const wide = paperOf(project, opts).orientation === 'landscape';
  const numbers = exitNumbers(project);
  const exits = exitRows(project);
  const scale = Math.max(1, Math.min(box.width, box.height) / printableBox({ size: 'letter', orientation: 'portrait' }).width);
  const room = {
    width: wide ? box.width * PLAN_SHARE_WIDE : box.width,
    height: wide ? box.height - HEADER_MM - FOOT_MM : (box.height - HEADER_MM - FOOT_MM) * PLAN_SHARE_TALL,
  };
  return floorsFor(project, opts).map((floor) => {
    const what = name + ' · ' + floor.name;
    const marks = (floor.exits || []).map((exit) => ({ exitId: exit.id, number: numbers.get(exit.id), colour: printExitColour(numbers.get(exit.id) - 1) }));
    const plan = planSvg(project, floor, { refGrid: true, exitMarks: marks, teachers: false });
    if (!plan.drawn) {
      return { what, body: '<p class="doc-lead">' + esc('Nothing is drawn on ' + floor.name + ' yet.') + '</p>' + footer() };
    }
    const cell = Math.min(room.width / plan.width, room.height / plan.height);
    const figure = '<figure class="lockdown__plan">'
      + '<div class="lockdown__picture" style="width: ' + mm(plan.width * cell) + '; height: ' + mm(plan.height * cell) + ';">' + plan.svg + '</div>'
      + '</figure>';

    const index = indexOf(floor, plan);
    const lines = index.rows.length;
    const dense = lines > 40 ? (lines > 80 ? 3 : 2) : 0;
    const columns = lines > 24 ? (dense === 3 ? 4 : dense === 2 ? 3 : 2) : 1;
    const rooms = ['<section class="lockdown__block" data-block="rooms"><h2>Rooms</h2>'];
    if (lines === 0) rooms.push('<p class="lockdown__none">' + esc('No rooms or labelled spaces on this floor.') + '</p>');
    else {
      rooms.push('<ul class="lockdown__rooms" style="column-count: ' + columns + ';">');
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

    const ways = liftRows(project, floor);
    const stairsList = ['<section class="lockdown__block" data-block="stairs"><h2>Stairs and elevators</h2>'];
    if (ways.length === 0) stairsList.push('<p class="lockdown__none">' + esc('No stairs or elevators on this floor.') + '</p>');
    else stairsList.push('<ul class="lockdown__list">' + ways.map((way) => '<li>' + typed(way.text) + '</li>').join('') + '</ul>');
    stairsList.push('</section>');

    const side = '<div class="lockdown__index" style="font-size: ' + (dense === 3 ? '6' : dense === 2 ? '6.5' : '8') + 'pt;">' + rooms.join('') + exitList.join('') + stairsList.join('') + '</div>';
    const body = '<div class="lockdown lockdown--' + (wide ? 'wide' : 'tall') + '" style="--lockdown-gap: ' + mm(GAP_MM) + '; --lockdown-scale: ' + Math.round(scale * 100) / 100 + ';" data-floor="' + esc(floor.id) + '">'
      + '<div class="lockdown__main">' + figure + side + '</div>'
      + footer()
      + '</div>';
    return { what, body };
  });
}

export function render(project, derived, options) {
  return frame(project, { output: id, what: name, pages: pages(project, derived, options), options: options || {} });
}
