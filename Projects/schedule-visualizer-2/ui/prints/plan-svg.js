// One floor of the building as an inline SVG, drawn from the model: corridors,
// stairs with their connection letters, rooms and other spaces in their
// colours with an outline and gaps for doors, room numbers, exits with their
// door names, and corridor names.
//
// It is drawn for paper. The colours are the light theme's, whatever the
// screen shows; the picture is cropped to what is drawn; and nothing of the
// editor is in it, because nothing here ever sees the editor: no selection,
// no hovered cell, no keyboard cursor, no tool preview.
//
// The traced image is under the plan only when it is asked for and its bytes
// are handed in; this module reads no storage. It lies where the screen has
// it (tracePlacement of ui/building/trace.js: the same box, turn and
// opacity), on a white backing, under everything drawn, and is cut off at the
// edge of the picture like anything else: the picture is still cropped to
// the cells that are drawn.
//
//   planSvg(project, floor, options) → { svg, drawn, traced, width, height, rooms, exits, letters, elevators? }
//     options.traceImage    true to draw the floor's traced image. Off by default.
//     options.traceImages   { [imageId]: 'data:image/…' }: the bytes, as data
//                           URLs. An image with no entry here, one that is
//                           hidden (visible: false) or missing, and an entry
//                           that is not a data URL of an image are not drawn.
//     options.crop          { x, y, width, height } in cells: draw only this
//                           window of the floor (a door card's box), clamped
//                           to the floor. The picture is the window, edge to
//                           edge, with no room added round it; width and
//                           height are the window's, so a caller scales it to
//                           the space it has. What lies wholly outside is
//                           left out; a room the edge cuts is drawn whole and
//                           cut by the picture's edge, but a label (a room's
//                           number or a surname, an other space's label, a
//                           corridor's name, a stairs letter, a door name)
//                           that the edge would cut is left out, never
//                           printed in part ("Cafete" for Cafeteria; SV2-72c).
//                           rooms, exits and letters count what is in the
//                           window.
//                           The options for the safety prints never grow a
//                           window (SV2-108b). A `marker` whose cell is
//                           outside it is not drawn and adds nothing to what
//                           the picture holds; one inside keeps its dot, and
//                           its pill is put where the window holds it whole
//                           (above, below, then either side) or left out.
//                           With `exitMarks` or `refGrid`, a door name and a
//                           mark follow the rule above: left out where the
//                           edge would cut them, never made room for, so the
//                           window stays the one asked for. (The reference grid's letters and numbers
//                           still stand in a band outside it, as without a
//                           window; width and height then count the band.)
//     options.route         { cells, start, exit }: the way out, drawn over the
//                           plan as a line through the cells in walking order
//                           (a jump between cells that do not touch, as at a
//                           floor's second visit or a same-floor stairs, starts
//                           the line again), from `start` (the room cell it
//                           leaves by: a round mark) to `exit` (the exit's
//                           cell: a square mark). Cells are indexes into this
//                           floor; start and exit may be null (the route only
//                           passes through, or ends on another floor).
//                           Anything that is not a cell of the floor is left
//                           out. With a window too, when `exit` is an exit
//                           with a door name, the window grows past its edge
//                           (past the floor's, where the name is drawn) to
//                           hold the whole name; width and height grow with
//                           it, and may then be fractions of a cell.
//                           With neither option the picture is byte for byte
//                           what it was before they existed.
//     options.routes        [{ cells, start, exit, joins, colour, number, faint }]: many ways
//                           out at once (a poster, SV2-108), drawn where `route`
//                           is drawn, in the order given, later over earlier (the
//                           caller puts the faint ones first). cells, start and
//                           exit are as for `route`. Each is a line in `colour`
//                           (a #rrggbb; else the colour `number` takes from
//                           PRINT_EXIT_COLOURS; else the plan's ink), or, when
//                           `faint`, in the plan's ink at 30 %, with a round
//                           mark where a non-faint one leaves its room. The
//                           route's `number` is in a small round badge at the
//                           exit and at each cell in `joins` (the cells where a
//                           connection is taken and where it comes out: what
//                           waysOnFloor gives), never where a way only crosses a
//                           stairs landing; with no `joins` a badge is at the first
//                           cell of each run of stairs cells, as before. A route is
//                           never told by colour alone; two routes with the same
//                           number meet at one badge, side by side in number order. Giving `routes`, like
//                           giving `route`, draws the plain stair marks (no
//                           one-way chevrons) and puts corridor names on a halo.
//     options.refGrid       true, or { maxCols, maxRows, sizes }: a reference
//                           grid over what is drawn, built here so a caller's
//                           index uses what was drawn. The size is the smallest
//                           of `sizes` (4, 5, 6, 8, 10, 12, 15, 20, 25 cells) that
//                           gives at most maxCols columns and maxRows rows (12 and
//                           12): thin lines every `size` cells from the top left
//                           of what is drawn, column letters A, B, … over and
//                           under, row numbers 1, 2, … at the left and right, in
//                           a band added outside everything else, door names
//                           included; width and height say so. The result then
//                           has `grid` { x0, y0, size, cols, rows } in cells of the
//                           floor and `labelCells`, a Map from each drawn space's
//                           id to the cell its label is centred on (the cell a
//                           half-way point falls in, below and right).
//     options.highlightCells [cell, …]: these cells in the accent at 25 %, over the
//                           corridor and under everything else (a poster's corridor)
//     options.exitMarks     [{ exitId, number, colour }]: a filled circle with the
//                           exit's number beside its door name (the name moves out
//                           to make room); an exit not listed is drawn as it was.
//                           `colour` (a #rrggbb) left out is printExitColour(number
//                           - 1), as for `routes`. A mark whose number is not a
//                           positive whole number is not drawn at all: no empty
//                           circle, no "0".
//     options.teachers      false to leave out the teacher's surname under a room's
//                           number (a lockdown map shows places, never people).
//                           Left out: the surname is drawn as it always was.
//     options.marker        { cell, label }: a filled mark on the cell with its
//                           words ("You are here") in a pill beside it, over
//                           everything; the picture grows to hold the pill. The
//                           pill is above the dot (below it on the top row of
//                           what is drawn), or, when that would cover a corridor's
//                           name or a route's number badge, on the first of the
//                           other sides that does not: below, above, right, left.
//                           The dot is kept off every corridor name too: a marker
//                           under one moves to the nearest cell of the same
//                           corridor clear of every name and badge.
//     options.place         { x, y, width, height }: where the picture lies
//                           inside a larger SVG (the floor plan's PNG,
//                           SV2-32c), written on its root. Left out, the root
//                           has no position or size of its own.
//     options.xml           true for a picture that stands alone as XML: each
//                           character XML cannot hold is written as U+FFFD
//                           (escXml, SV2-32k). A print, which is HTML, keeps
//                           every name as typed.
//     svg      the markup, or '' when nothing is drawn on the floor
//     traced   whether the traced image is in the picture
//     width, height   of the cropped picture, in cells (for fitting it to a page)
//     rooms, exits, letters   what the caption under the plan counts
//     elevators   [{ letter, staffOnly, connected }] for the stops drawn; absent when there are none
//     grid, labelCells, unlabelled   only with options.refGrid (above). labelCells
//                           holds only the spaces whose label is drawn (a room with
//                           no number, an other space with no label, and a label a
//                           window cuts off, are not in it); `unlabelled` is the
//                           ids of the drawn spaces that are not, in drawing order.
//                           A floor with nothing drawn has grid null, an empty
//                           labelCells and unlabelled [].
//   With none of routes, refGrid, highlightCells, exitMarks and marker the picture
//   is byte for byte what it was before they existed (a case pins every sample
//   floor, with and without `route` and `crop`).
//   gridSquare(grid, width, cell) → 'C3' | null    the square a cell is in
//   columnLetters(index) → 'A' … 'Z', 'AA' …
//   PRINT_EXIT_COLOURS, printExitColour(index)

import { mix, labelOn, parse, ROOM_STRENGTH, OTHER_STRENGTH } from '../colour.js';
import { CELL_CORRIDOR, CELL_STAIRS, CELL_EMPTY, ELEVATOR_KIND, elevatorCars, spaceOwners } from '../../engine/schema.js';
import { pendingElevatorLetter } from '../components/words.js';
import { esc, escXml } from './document.js';
import { tracePlacement } from '../building/trace.js';

// The light theme's ink and room-default (tokens.css), and white paper. They
// are written out because a data colour has to be mixed and measured here, as
// numbers; test/engine/prints.test.mjs holds them to tokens.css.
export const PLAN_INK = '#1f2328';
export const PLAN_PAPER = '#ffffff';
export const PLAN_ROOM_DEFAULT = '#e9e4d9';
// The light theme's --warning and --accent: a step's bars and an area of
// refuge, written into the markup as attributes so print.css needs no rule.
const PLAN_WARNING = '#925d00';
const PLAN_ACCENT = '#0f6e66';

// The eight exit colours of the light theme (--exit-1 to --exit-8 in
// ui/safety/safety.css, written out as PLAN_INK is); an exit past the eighth
// takes the colour of the one eight before it, as the screen's exitColours
// does. test/ui/exit-colours.test.mjs holds the list to the stylesheet.
export const PRINT_EXIT_COLOURS = ['#255ebc', '#005700', '#661f75', '#1b8dae', '#876fe4', '#768b09', '#48423f', '#c34e97'];

// The colour of the exit at `index` (0 for the first), repeating past eight.
export function printExitColour(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return PRINT_EXIT_COLOURS[i % PRINT_EXIT_COLOURS.length];
}

// The plan's look on paper, for a picture that stands alone and so cannot
// read print.css (a PNG drawn from the SVG, SV2-32c): print.css's rules for
// .print-doc .plan and its parts, with the light theme's tokens written in.
// test/engine/prints.test.mjs holds the two to the same declarations, but
// for .plan's display, width and height: those lay the plan out on a sheet,
// and on a nested <svg> they would undo the x, y, width and height it is
// placed by.
export const PLAN_FONT = '"Barlow Semi Condensed", "Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const PLAN_STYLE = [
  ['.plan', 'font-family: ' + PLAN_FONT],
  ['.plan text', 'text-anchor: middle; dominant-baseline: central'],
  ['.plan__corridor', 'fill: #ffffff'],
  ['.plan__stairs', 'fill: #d9ece9'],
  ['.plan__wall', 'fill: none; stroke: #857f73; stroke-width: 0.6; stroke-linecap: square'],
  ['.plan__chevron', 'fill: none; stroke: #1f2328; stroke-width: 1.2'],
  ['.plan__letter', 'fill: #1f2328; font-weight: 600'],
  ['.plan__outline', 'fill: none; stroke: #1f2328; stroke-width: 1; stroke-linecap: square'],
  ['.plan__space--other .plan__outline', 'stroke: #857f73; stroke-width: 0.7'],
  ['.plan__space--unnumbered .plan__outline', 'stroke-dasharray: 3 2.5'],
  ['.plan__number', 'font-weight: 600'],
  ['.plan__label', 'font-weight: 500'],
  ['.plan__teacher', 'font-weight: 500'],
  ['.plan__corridor-name', 'fill: #515761; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase'],
  ['.plan__exit', 'fill: none; stroke: #0f6e66; stroke-width: 3.2'],
  ['.plan__exit-name', 'fill: #0f6e66; font-weight: 600'],
  ['.plan .plan__exit-name--w', 'text-anchor: end'],
  ['.plan .plan__exit-name--e', 'text-anchor: start'],
  ['.plan__route-band', 'fill: none; stroke: #ffffff; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round'],
  ['.plan__route', 'fill: none; stroke: #1f2328; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round'],
  ['.plan__start', 'fill: #1f2328; stroke: #ffffff; stroke-width: 2'],
  ['.plan__end', 'fill: #0f6e66; stroke: #ffffff; stroke-width: 2'],
  ['.plan__highlight', 'fill: #0f6e66; fill-opacity: 0.25'],
  ['.plan__grid-lines', 'fill: none; stroke: #857f73; stroke-width: 0.5; stroke-dasharray: 4 3'],
  ['.plan__grid-label', 'fill: #515761; font-weight: 500'],
  ['.plan__way-band', 'fill: none; stroke: #ffffff; stroke-width: 7.4; stroke-linecap: round; stroke-linejoin: round'],
  ['.plan__way-line', 'fill: none; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round'],
  ['.plan__way-start', 'stroke: #ffffff; stroke-width: 1.4'],
  ['.plan__badge', 'fill: #ffffff; stroke-width: 2'],
  ['.plan__badge-number', 'fill: #1f2328; font-weight: 700'],
  ['.plan__mark', 'stroke: #ffffff; stroke-width: 1.2'],
  ['.plan__mark-number', 'font-weight: 700'],
  ['.plan__marker', 'fill: #1f2328; stroke: #ffffff; stroke-width: 2'],
  ['.plan__marker-pill', 'fill: #ffffff; stroke: #1f2328; stroke-width: 0.8'],
  ['.plan__marker-label', 'fill: #1f2328; font-weight: 700'],
];

// PLAN_STYLE as the text of a <style>.
export function planStyleText() {
  return PLAN_STYLE.map(([selector, rules]) => selector + ' { ' + rules + '; }').join('\n');
}

// One cell is this many units of the picture.
const U = 20;
const SIDES = ['n', 'e', 's', 'w'];
// Labels, in units. A number that cannot be this small and still fit is
// printed at the smallest size anyway: on a floor drawn whole a label is
// never left out. In a window (options.crop, a door card's map) a label the
// window's edge would cut is left out instead, judged at the widths fit()
// sizes it by (textEms), so a label that fits its window stays.
const NUMBER_MAX = 15;
const NUMBER_MIN = 4;
const LABEL_MAX = 8;
const NAME_MAX = 7;
const NAME_MIN = 3.6;
// How wide a character runs, as a share of its size: the plan's condensed
// face's Latin about 0.5; a script the face does not have, which the browser
// sets in another face, 0.75; a wide character (CJK, Hangul, fullwidth forms,
// an emoji or another wide symbol) a whole em; a joiner or a variation
// selector nothing.
const CHARACTER = 0.5;
const OTHER_SCRIPT = 0.75;
const WIDE = 1;
// A corridor's name is set in capitals 0.08em apart: 1.15 of that.
const SPACED = 1.15;

// a character that takes a whole em: East Asian wide, or an emoji or a wide symbol
export function isWide(code) {
  return (code >= 0x1100 && code <= 0x115f) || (code >= 0x2600 && code <= 0x27bf) || (code >= 0x2b00 && code <= 0x2bff)
    || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f000 && code <= 0x1faff) || code >= 0x20000;
}
const zeroWidth = (code) => code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0x0300 && code <= 0x036f);

// A label's width in ems, at the widths above: what fit() sizes it by and
// what a window judges it by.
export function textEms(value) {
  let total = 0;
  for (const character of String(value)) {
    const code = character.codePointAt(0);
    total += zeroWidth(code) ? 0 : code < 0x0250 ? CHARACTER : isWide(code) ? WIDE : OTHER_SCRIPT;
  }
  return total;
}

function n(value) {
  return String(Math.round(value * 100) / 100);
}

// The cells of a set as one path: a rectangle per run along a row.
function cellsPath(cells, width) {
  const sorted = cells.slice().sort((a, b) => a - b);
  const parts = [];
  let start = null;
  let last = null;
  const close = () => {
    if (start === null) return;
    const x = start % width;
    const y = Math.floor(start / width);
    parts.push('M' + x * U + ' ' + y * U + 'h' + (last - start + 1) * U + 'v' + U + 'h-' + (last - start + 1) * U + 'z');
  };
  for (const cell of sorted) {
    if (last !== null && cell === last + 1 && cell % width !== 0) {
      last = cell;
      continue;
    }
    close();
    start = cell;
    last = cell;
  }
  close();
  return parts.join('');
}

// The outline of a space as straight pieces, with its door edges apart, and
// where its label goes: the middle of a rectangle, or the widest row of any
// other shape.
function shapeOf(space, width) {
  const inside = new Set(space.cells);
  const doors = new Set((space.doors || []).map((door) => door.cell + ':' + door.side));
  const stepDoors = new Set((space.doors || []).filter((door) => door.stepFree === false).map((door) => door.cell + ':' + door.side));
  const cells = space.cells.slice().sort((a, b) => a - b);
  const edges = [];
  const doorEdges = [];
  const stepEdges = [];
  const rows = new Map();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    const run = rows.get(y);
    if (run && run.x1 === x) run.x1 = x + 1;
    else if (!run) rows.set(y, { y, x0: x, x1: x + 1 }); // a row in two parts is labelled on its first
    const open = {
      n: !inside.has(cell - width),
      s: !inside.has(cell + width),
      w: x === 0 || !inside.has(cell - 1),
      e: x === width - 1 || !inside.has(cell + 1),
    };
    for (const side of SIDES) {
      if (!open[side]) continue;
      // [x, y, x, y] in cells
      const piece = side === 'n' ? [x, y, x + 1, y] : side === 's' ? [x, y + 1, x + 1, y + 1] : side === 'w' ? [x, y, x, y + 1] : [x + 1, y, x + 1, y + 1];
      if (doors.has(cell + ':' + side)) {
        doorEdges.push(piece);
        if (stepDoors.has(cell + ':' + side)) stepEdges.push(piece);
      } else edges.push(piece);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  let anchor;
  if (cells.length === w * h) {
    anchor = { x: x0 + w / 2, y: y0 + h / 2, w, h };
  } else {
    const middle = (y0 + y1) / 2;
    let best = null;
    for (const run of rows.values()) {
      const wider = best === null ? 1 : run.x1 - run.x0 - (best.x1 - best.x0);
      if (wider > 0 || (wider === 0 && Math.abs(run.y - middle) < Math.abs(best.y - middle))) best = run;
    }
    anchor = { x: (best.x0 + best.x1) / 2, y: best.y + 0.5, w: best.x1 - best.x0, h: 1 };
  }
  return { edges, doorEdges, stepEdges, anchor };
}

// Two short parallel bars along a piece [ax, ay, bx, by] in cells, a little
// to each side of it, from a seventh in to a seventh from the far end: a step
// (DESIGN 13.3), as attributes on a path so no stylesheet has to know it.
function stepBarsMarkup(pieces, width) {
  const parts = [];
  for (const [ax, ay, bx, by] of pieces) {
    const horizontal = ay === by;
    const from = 0.15;
    const to = 0.85;
    for (const off of [-0.12, 0.12]) {
      const x0 = ax + (bx - ax) * from + (horizontal ? 0 : off);
      const x1 = ax + (bx - ax) * to + (horizontal ? 0 : off);
      const y0 = ay + (by - ay) * from + (horizontal ? off : 0);
      const y1 = ay + (by - ay) * to + (horizontal ? off : 0);
      parts.push('M' + n(x0 * U) + ' ' + n(y0 * U) + 'L' + n(x1 * U) + ' ' + n(y1 * U));
    }
  }
  return '<path class="plan__steps" fill="none" stroke="' + PLAN_WARNING + '" stroke-width="' + width + '" stroke-linecap="butt" d="' + parts.join('') + '"/>';
}

function linesPath(pieces) {
  return pieces.map((p) => 'M' + n(p[0] * U) + ' ' + n(p[1] * U) + 'L' + n(p[2] * U) + ' ' + n(p[3] * U)).join('');
}

// A door is a gap: its edge keeps a fifth at each end.
function doorStubs(doorEdges) {
  const stubs = [];
  for (const [ax, ay, bx, by] of doorEdges) {
    const dx = (bx - ax) / 5;
    const dy = (by - ay) / 5;
    stubs.push([ax, ay, ax + dx, ay + dy], [bx - dx, by - dy, bx, by]);
  }
  return stubs;
}

// The size a label `ems` wide (textEms) can be and still fit `room` units.
function fit(ems, room, max) {
  if (!(ems > 0)) return max;
  return Math.min(max, room / ems);
}

function fillFor(colour, strength, fallback) {
  return parse(colour) ? mix(colour, PLAN_PAPER, strength) : fallback;
}

function surname(name) {
  const words = String(name).trim().split(/\s+/);
  return words[words.length - 1];
}

// A label, its words escaped by `write`: esc for a print, which is HTML, and
// escXml for the stand-alone picture (options.xml).
function textWith(write) {
  return (x, y, size, cls, value, more) => '<text class="' + cls + '" x="' + n(x) + '" y="' + n(y) + '" font-size="' + n(size) + '"' + (more || '') + '>' + write(value) + '</text>';
}

// The data URL to draw for a floor's traced image, or null: asked for, shown
// on screen, on this device, and handed in as an image's bytes. Anything but
// a data URL would be an address the printed document went and fetched.
export function traceSource(floor, options) {
  const opts = options || {};
  const image = floor.image;
  if (opts.traceImage !== true || !image || image.visible !== true || image.missing === true) return null;
  const given = opts.traceImages;
  if (!given || typeof given !== 'object' || !Object.prototype.hasOwnProperty.call(given, image.imageId)) return null;
  const url = given[image.imageId];
  return typeof url === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(url) ? url : null;
}

// The traced image as markup: a white box where it lies, and the image over
// it at its opacity, both turned about the image's middle.
function traceMarkup(image, url) {
  const place = tracePlacement(image);
  const box = ' x="' + n(place.x * U) + '" y="' + n(place.y * U) + '" width="' + n(place.w * U) + '" height="' + n(place.h * U) + '"';
  return '<g class="plan__trace" transform="rotate(' + n(place.rotation) + ' ' + n(place.cx * U) + ' ' + n(place.cy * U) + ')">'
    + '<rect class="plan__trace-backing"' + box + ' fill="' + PLAN_PAPER + '"/>'
    + '<image class="plan__trace-image"' + box + ' opacity="' + n(place.opacity) + '" preserveAspectRatio="none" href="' + esc(url) + '"/>'
    + '</g>';
}

// The window asked for, as whole cells inside the floor, or null.
function cropOf(floor, asked) {
  if (!asked || typeof asked !== 'object') return null;
  const values = [asked.x, asked.y, asked.width, asked.height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const x = Math.max(0, Math.floor(asked.x));
  const y = Math.max(0, Math.floor(asked.y));
  const right = Math.min(floor.width, Math.ceil(asked.x + asked.width));
  const bottom = Math.min(floor.height, Math.ceil(asked.y + asked.height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

// Where the route's exit's door name is drawn, in units, on the safe side,
// for the window to grow round it: a character at 0.62 of the size in the
// plan's face (it runs about 0.5), 0.75 in a script the face does not have
// and the browser sets in another, 1.05 when wide (isWide: an emoji too),
// and the height of a line set round its centre with room over and under (a
// fallback face's box runs to 0.8 of the size). One unit of margin round it,
// so the name never touches the picture's edge. Whether a window keeps a
// label is judged by labelBox, at the widths fit() uses.
function ems(name) {
  let total = 0;
  for (const character of String(name)) {
    const code = character.codePointAt(0);
    total += zeroWidth(code) ? 0 : code < 0x0250 ? 0.62 : isWide(code) ? 1.05 : 0.75;
  }
  return total;
}

function exitNameBox(name, side, x, y, at, gap) {
  const size = 7.5;
  const wide = ems(name) * size;
  const half = size * 0.85;
  let box;
  if (side === 'n' || side === 's') {
    const cx = (x + 0.5) * U;
    const cy = at + (side === 'n' ? -gap - 3 : gap + 4);
    box = { left: cx - wide / 2, right: cx + wide / 2, top: cy - half, bottom: cy + half };
  } else {
    const cy = (y + 0.5) * U;
    const from = at + (side === 'w' ? -gap : gap);
    box = { left: side === 'w' ? from - wide : from, right: side === 'w' ? from : from + wide, top: cy - half, bottom: cy + half };
  }
  return { left: box.left - 1, right: box.right + 1, top: box.top - 1, bottom: box.bottom + 1 };
}

// A label's box, in units, set round (x, y) as print.css sets every label
// of the plan (text-anchor middle, dominant-baseline central): textEms wide
// times `scale` (SPACED for a corridor's name), the widths fit() sized it by,
// so a label fit() made to fit its room fits its window too (the sample's
// Bathrooms on Room 202's and Room 302's cards were left out at 0.62 a
// character, SV2-72c2); half a size over and under the middle; turned a
// quarter for a name that runs down. A door name drawn beside its dash
// (`side` 'w' or 'e') runs away from (x, y).
function labelBox(value, x, y, size, scale, down, side) {
  const wide = textEms(value) * (scale || 1) * size;
  const half = wide / 2;
  const tall = size * 0.5;
  if (side === 'w') return { left: x - wide, right: x, top: y - tall, bottom: y + tall };
  if (side === 'e') return { left: x, right: x + wide, top: y - tall, bottom: y + tall };
  return down ? { left: x - tall, right: x + tall, top: y - half, bottom: y + half } : { left: x - half, right: x + half, top: y - tall, bottom: y + tall };
}

// A route's cells as the plan draws them: the pieces of its path (a jump
// between cells that do not touch starts the line again), its start and its
// exit, each a cell of the floor or null, and a cell's centre.
function wayParts(floor, route) {
  const size = floor.width * floor.height;
  const isCell = (cell) => Number.isInteger(cell) && cell >= 0 && cell < size;
  const centre = (cell) => [((cell % floor.width) + 0.5) * U, (Math.floor(cell / floor.width) + 0.5) * U];
  const cells = (Array.isArray(route.cells) ? route.cells : []).filter(isCell);
  const start = isCell(route.start) ? route.start : null;
  const exit = isCell(route.exit) ? route.exit : null;
  const pieces = [];
  let last = null;
  for (const cell of start === null ? cells : [start].concat(cells)) {
    const [x, y] = centre(cell);
    const touching = last !== null && (last === start || Math.abs((last % floor.width) - (cell % floor.width)) + Math.abs(Math.floor(last / floor.width) - Math.floor(cell / floor.width)) <= 1);
    pieces.push((touching ? 'L' : 'M') + n(x) + ' ' + n(y));
    last = cell;
  }
  return { cells, start, exit, pieces, centre };
}

// The way out as markup: a pale band under a dark line, the round mark where
// it leaves the room and the square mark at the exit.
function routeMarkup(floor, route) {
  const { start, exit, pieces, centre } = wayParts(floor, route);
  const out = [];
  if (pieces.length > 1) {
    const d = pieces.join('');
    out.push('<path class="plan__route-band" d="' + d + '"/>');
    out.push('<path class="plan__route" d="' + d + '"/>');
  }
  if (start !== null) {
    const [x, y] = centre(start);
    const r = U * 0.34;
    out.push('<path class="plan__start" d="M' + n(x - r) + ' ' + n(y) + 'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(r * 2) + ' 0a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-r * 2) + ' 0z"/>');
  }
  if (exit !== null) {
    const [x, y] = centre(exit);
    const r = U * 0.32;
    out.push('<path class="plan__end" d="M' + n(x - r) + ' ' + n(y - r) + 'h' + n(r * 2) + 'v' + n(r * 2) + 'h' + n(-r * 2) + 'z"/>');
  }
  return out.length === 0 ? '' : '<g class="plan__way">' + out.join('') + '</g>';
}

const HEX = /^#[0-9a-fA-F]{6}$/;

// A colour that is safe to write into an attribute: a #rrggbb, else `fallback`.
function hexOr(value, fallback) {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}

// A number as its words: a whole number as it is, anything else as the text
// it is (escaped where it is written).
function numberWords(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : typeof value === 'string' ? value : '';
}

const BADGE_R = U * 0.3;

// A round badge's markup: a paper disc with a ring in the route's colour and
// the number in the plan's ink, the number's size fitted to the disc.
function badgeMarkup(text, x, y, colour, words, faint) {
  const size = fit(textEms(words), BADGE_R * 2 - 1.8, 8.5);
  return '<circle class="plan__badge" cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(BADGE_R) + '" stroke="' + colour + '"' + (faint ? ' stroke-opacity="0.45"' : '') + '/>'
    + text(x, y, size, 'plan__badge-number', words, faint ? ' fill-opacity="0.6"' : '');
}

// Many ways out as markup (options.routes): each a pale band under a line in
// its exit's colour, the faint ones a thin grey line alone; then the round
// mark where a coloured one leaves its room; then the badges, over every line.
function waysMarkup(floor, routes, text, avoid) {
  const lines = [];
  const starts = [];
  const badges = new Map();
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue;
    const { cells, start, exit, pieces, centre } = wayParts(floor, route);
    const faint = route.faint === true;
    const words = numberWords(route.number);
    const numeric = typeof route.number === 'number' && Number.isInteger(route.number) && route.number >= 1;
    const colour = faint ? PLAN_INK : hexOr(route.colour, numeric ? printExitColour(route.number - 1) : PLAN_INK);
    if (pieces.length > 1) {
      const d = pieces.join('');
      if (!faint) lines.push('<path class="plan__way-band" d="' + d + '"/>');
      lines.push('<path class="plan__way-line" stroke="' + colour + '"' + (faint ? ' stroke-opacity="0.3"' : '') + ' d="' + d + '"/>');
    }
    if (start !== null && !faint) {
      const [x, y] = centre(start);
      starts.push('<circle class="plan__way-start" cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(U * 0.2) + '" fill="' + colour + '"/>');
    }
    if (words === '') continue;
    // a badge at the exit and at each cell where a connection is taken or comes
    // out (`joins`); a way that gives none has one at the first cell of each
    // stretch of stairs cells
    const stops = [];
    if (exit !== null) stops.push(exit);
    if (Array.isArray(route.joins)) {
      for (const cell of route.joins) if (Number.isInteger(cell) && cell >= 0 && cell < floor.width * floor.height) stops.push(cell);
    } else {
      let inStairs = false;
      for (const cell of start === null ? cells : [start].concat(cells)) {
        const onStairs = floor.cells[cell] === CELL_STAIRS;
        if (onStairs && !inStairs) stops.push(cell);
        inStairs = onStairs;
      }
    }
    for (const cell of stops) badges.set(cell + ':' + words, { cell, words, colour, faint });
  }
  // badges on one cell sit side by side, in number order, so none hides another
  const byCell = new Map();
  for (const badge of badges.values()) byCell.set(badge.cell, (byCell.get(badge.cell) || []).concat(badge));
  const drawn = [];
  for (const [cell, list] of byCell) {
    // by number, 2 before 10; words that are not numbers after, as typed
    const whole = (words) => /^\d+$/.test(words);
    list.sort((a, b) => (whole(a.words) && whole(b.words) ? Number(a.words) - Number(b.words) : whole(a.words) !== whole(b.words) ? (whole(a.words) ? -1 : 1) : a.words < b.words ? -1 : a.words > b.words ? 1 : 0));
    const cx = ((cell % floor.width) + 0.5) * U;
    const cy = (Math.floor(cell / floor.width) + 0.5) * U;
    list.forEach((badge, i) => drawn.push({ ...badge, x: cx + (i - (list.length - 1) / 2) * (BADGE_R * 2 + 1), y: cy }));
  }
  if (avoid) for (const b of drawn) avoid.push({ left: b.x - BADGE_R - 1, right: b.x + BADGE_R + 1, top: b.y - BADGE_R - 1, bottom: b.y + BADGE_R + 1 });
  const parts = lines.concat(starts, drawn.filter((b) => b.faint).map((b) => badgeMarkup(text, b.x, b.y, b.colour, b.words, true)), drawn.filter((b) => !b.faint).map((b) => badgeMarkup(text, b.x, b.y, b.colour, b.words, false)));
  return parts.length === 0 ? '' : '<g class="plan__ways">' + parts.join('') + '</g>';
}

// ---- the reference grid

const GRID_SIZES = [4, 5, 6, 8, 10, 12, 15, 20, 25];

// 'A' … 'Z', then 'AA', 'AB', …
export function columnLetters(index) {
  let i = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

// The grid over a box of cells: the smallest size of `sizes` that makes at
// most maxCols columns and maxRows rows, else the largest.
function gridOver(asked, x0, y0, w, h) {
  const given = asked && typeof asked === 'object' ? asked : {};
  const limit = (value) => (Number.isInteger(value) && value >= 1 ? value : 12);
  const maxCols = limit(given.maxCols);
  const maxRows = limit(given.maxRows);
  const sizes = Array.isArray(given.sizes) && given.sizes.length > 0 && given.sizes.every((each) => Number.isInteger(each) && each >= 1) ? given.sizes.slice().sort((a, b) => a - b) : GRID_SIZES;
  const size = sizes.find((each) => Math.ceil(w / each) <= maxCols && Math.ceil(h / each) <= maxRows) || sizes[sizes.length - 1];
  return { x0, y0, size, cols: Math.ceil(w / size), rows: Math.ceil(h / size) };
}

// The square a cell of a floor `width` cells wide is in ('C3': column letter,
// row number), or null for a cell outside the grid.
export function gridSquare(grid, width, cell) {
  if (!grid || !Number.isInteger(cell) || cell < 0 || !(width > 0)) return null;
  const col = Math.floor(((cell % width) - grid.x0) / grid.size);
  const row = Math.floor((Math.floor(cell / width) - grid.y0) / grid.size);
  return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? null : columnLetters(col) + (row + 1);
}

// An elevator stop (DESIGN 13.2) as markup: two solid triangles, up over down,
// the car's letter in a pill under them and, for a staff-only car, a key
// beside the letter. [{ markup, box }]; the box is what a window keeps or
// cuts. Shapes carry their own attributes, as the steps do.
function liftMarkup(lift, x, y, text) {
  const cx = x + U / 2;
  const cy = y + U * 0.32;
  const reach = U * 0.14;
  const triangles = '<path class="plan__lift" fill="' + PLAN_INK + '" d="M' + n(cx) + ' ' + n(cy - reach * 1.5) + 'L' + n(cx + reach) + ' ' + n(cy - reach * 0.2) + 'L' + n(cx - reach) + ' ' + n(cy - reach * 0.2) + 'zM' + n(cx) + ' ' + n(cy + reach * 1.5) + 'L' + n(cx + reach) + ' ' + n(cy + reach * 0.2) + 'L' + n(cx - reach) + ' ' + n(cy + reach * 0.2) + 'z"/>';
  const notch = lift.staffOnly ? 1 : 0;
  const size = fit(textEms(lift.letter) + notch * 0.9, U - 6, 7);
  const wide = textEms(lift.letter) * size;
  const key = notch * size * 0.9;
  const pillW = Math.min(U - 2, wide + size * 0.7 + key);
  const pillH = size + 2;
  const px = cx - pillW / 2;
  const py = y + U * 0.72 - pillH / 2;
  const pill = '<rect class="plan__pill" x="' + n(px) + '" y="' + n(py) + '" width="' + n(pillW) + '" height="' + n(pillH) + '" rx="' + n(pillH / 2) + '" fill="' + PLAN_PAPER + '" stroke="' + PLAN_INK + '" stroke-width="0.7"/>';
  const letterX = px + (pillW - key) / 2 + size * 0.1;
  const letter = text(letterX, py + pillH / 2, size, 'plan__letter', lift.letter);
  const pieces = [{ markup: triangles, box: { left: cx - reach, right: cx + reach, top: cy - reach * 1.5, bottom: cy + reach * 1.5 } }, { markup: pill, box: { left: px, right: px + pillW, top: py, bottom: py + pillH } }, { markup: letter, box: labelBox(lift.letter, letterX, py + pillH / 2, size) }];
  if (lift.staffOnly) {
    const kx = px + pillW - key / 2 - size * 0.1;
    const ky = py + pillH / 2;
    const ring = Math.max(0.7, size * 0.16);
    pieces.push({ markup: '<path class="plan__key" fill="none" stroke="' + PLAN_INK + '" stroke-width="0.6" d="M' + n(kx - size * 0.2 + ring) + ' ' + n(ky) + 'a' + n(ring) + ' ' + n(ring) + ' 0 1 0 ' + n(-ring * 2) + ' 0a' + n(ring) + ' ' + n(ring) + ' 0 1 0 ' + n(ring * 2) + ' 0L' + n(kx + size * 0.32) + ' ' + n(ky) + 'M' + n(kx + size * 0.22) + ' ' + n(ky) + 'L' + n(kx + size * 0.22) + ' ' + n(ky + size * 0.22) + '"/>', box: { left: kx - size * 0.2 - ring, right: kx + size * 0.32, top: ky - ring, bottom: ky + size * 0.22 } });
  }
  return pieces;
}

export function planSvg(project, floor, options) {
  const write = options && options.xml === true ? escXml : esc;
  const text = textWith(write);
  const width = floor.width;
  const height = floor.height;
  const owners = spaceOwners(floor);
  const corridor = [];
  const stairs = [];
  for (let cell = 0; cell < width * height; cell += 1) {
    if (floor.cells[cell] === CELL_CORRIDOR) corridor.push(cell);
    else if (floor.cells[cell] === CELL_STAIRS) stairs.push(cell);
  }
  const crop = cropOf(floor, options && options.crop);
  const opts = options || {};
  const manyWays = Array.isArray(opts.routes) ? opts.routes : null;
  const cellsOf = (list) => (Array.isArray(list) ? list.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < width * height) : []);
  const marks = new Map();
  for (const mark of Array.isArray(opts.exitMarks) ? opts.exitMarks : []) {
    // a number that is not a positive whole number has no mark (never an empty circle or a "0")
    if (mark && typeof mark === 'object' && typeof mark.exitId === 'string' && Number.isInteger(mark.number) && mark.number >= 1 && !marks.has(mark.exitId)) marks.set(mark.exitId, mark);
  }
  const gridAsked = opts.refGrid === true || (opts.refGrid && typeof opts.refGrid === 'object');
  const inCrop = (cell) => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    return x >= crop.x && x < crop.x + crop.width && y >= crop.y && y < crop.y + crop.height;
  };
  // in a window, a marker outside it is not drawn and holds nothing
  const marker = opts.marker && typeof opts.marker === 'object' && Number.isInteger(opts.marker.cell) && opts.marker.cell >= 0 && opts.marker.cell < width * height && (!crop || inCrop(opts.marker.cell)) ? opts.marker : null;

  // what is drawn, and its box
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  const take = (cell) => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  corridor.forEach(take);
  stairs.forEach(take);
  for (const space of floor.spaces) space.cells.forEach(take);
  if (x1 === -1) {
    const nothing = { svg: '', drawn: false, traced: false, width: 0, height: 0, rooms: 0, exits: 0, letters: [] };
    if (gridAsked) {
      nothing.grid = null;
      nothing.labelCells = new Map();
      nothing.unlabelled = [];
    }
    return nothing;
  }
  // in a window, only what is in it (the walls still look at the whole floor)
  const shownCorridor = crop ? corridor.filter(inCrop) : corridor;
  const shownStairs = crop ? stairs.filter(inCrop) : stairs;
  const shown = (cells) => !crop || cells.some(inCrop);

  const walkable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && (floor.cells[y * width + x] === CELL_CORRIDOR || floor.cells[y * width + x] === CELL_STAIRS);
  const outside = (x, y) => x < 0 || y < 0 || x >= width || y >= height || (floor.cells[y * width + x] === CELL_EMPTY && !owners.has(y * width + x));

  const out = [];
  // a label: as it is with no window; in a window, kept with its box until
  // the window is known, and left out if the window would cut it
  const put = (markup, box) => out.push(crop ? { markup, box } : markup);

  // the traced image, under everything
  const traceUrl = traceSource(floor, options);
  if (traceUrl !== null) out.push(traceMarkup(floor.image, traceUrl));

  // corridors and stairs, then the line where a walkable cell meets anything else
  if (shownCorridor.length > 0) out.push('<path class="plan__corridor" d="' + cellsPath(shownCorridor, width) + '"/>');
  if (shownStairs.length > 0) out.push('<path class="plan__stairs" d="' + cellsPath(shownStairs, width) + '"/>');
  // a band over the corridor the caller names, under everything drawn after it
  const band = Array.from(new Set(cellsOf(opts.highlightCells))).filter((cell) => cell % width >= x0 && cell % width <= x1 && Math.floor(cell / width) >= y0 && Math.floor(cell / width) <= y1 && (!crop || inCrop(cell)));
  if (band.length > 0) out.push('<path class="plan__highlight" d="' + cellsPath(band, width) + '"/>');
  const walls = [];
  for (const cell of shownCorridor.concat(shownStairs)) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (!walkable(x, y - 1)) walls.push([x, y, x + 1, y]);
    if (!walkable(x, y + 1)) walls.push([x, y + 1, x + 1, y + 1]);
    if (!walkable(x - 1, y)) walls.push([x, y, x, y + 1]);
    if (!walkable(x + 1, y)) walls.push([x + 1, y, x + 1, y + 1]);
  }
  if (walls.length > 0) out.push('<path class="plan__wall" d="' + linesPath(walls) + '"/>');
  // a step in a corridor: two short bars across the cell
  const stepCells = (floor.notStepFree || []).filter((cell) => floor.cells[cell] === CELL_CORRIDOR && shown([cell]));
  if (stepCells.length > 0) {
    const bars = [];
    for (const cell of stepCells) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      for (const at of [0.36, 0.64]) bars.push([x + 0.2, y + at, x + 0.8, y + at]);
    }
    out.push('<path class="plan__steps" fill="none" stroke="' + PLAN_WARNING + '" stroke-width="1.6" stroke-linecap="butt" d="' + linesPath(bars) + '"/>');
  }

  // stairs: a chevron and the letters of the connections that land there. A
  // one-way connection's letter has a second, bolder chevron beside it, 'up'
  // or 'down' between floors and, on one floor, 'down' at the end it is
  // walked from and 'up' at the end it comes out at, as the planner's screen
  // draws it (ARCHITECTURE 18.4). A route map (a door card) keeps the plain
  // stair mark: evacuation ignores one-way.
  const showWays = !(options && options.route && typeof options.route === 'object') && manyWays === null;
  const levelOf = (id) => {
    const found = project.building.floors.find((each) => each.id === id);
    return found ? found.level : 0;
  };
  const lettersAt = new Map();
  // the elevator stops of this floor: cell -> { letter, staffOnly }. A stop not
  // yet connected shows the letter the next elevator will take.
  const liftAt = new Map();
  const elevators = [];
  for (const car of elevatorCars(project.building)) {
    const stop = car.stops.find((each) => each.floorId === floor.id);
    if (!stop) continue;
    liftAt.set(stop.cell, { letter: car.label === '' ? pendingElevatorLetter(project.building) : car.label, staffOnly: car.staffOnly, connected: car.connectionIds.length > 0 });
  }
  for (const connection of project.building.connections) {
    // an elevator's stops carry the car's letter and their own glyph, below
    if (connection.kind === ELEVATOR_KIND) continue;
    [connection.a, connection.b].forEach((end, index) => {
      if (end.floorId !== floor.id) return;
      if (!lettersAt.has(end.cell)) lettersAt.set(end.cell, []);
      const here = lettersAt.get(end.cell);
      if (here.some((entry) => entry.label === connection.label)) return;
      let way = null;
      if (showWays && (connection.direction === 'ab' || connection.direction === 'ba')) {
        const from = connection.direction === 'ab' ? connection.a : connection.b;
        const to = connection.direction === 'ab' ? connection.b : connection.a;
        const rise = levelOf(to.floorId) - levelOf(from.floorId);
        way = rise > 0 ? 'up' : rise < 0 ? 'down' : (index === 0) === (connection.direction === 'ab') ? 'down' : 'up';
      }
      here.push({ label: connection.label, way });
    });
  }
  const letters = [];
  for (const cell of shownStairs) {
    const x = (cell % width) * U;
    const y = Math.floor(cell / width) * U;
    const lift = liftAt.get(cell);
    if (lift) {
      if (!elevators.some((each) => each.letter === lift.letter && each.staffOnly === lift.staffOnly && each.connected === lift.connected)) elevators.push({ letter: lift.letter, staffOnly: lift.staffOnly, connected: lift.connected });
      liftMarkup(lift, x, y, text).forEach((piece) => put(piece.markup, piece.box));
      continue;
    }
    const entries = lettersAt.get(cell) || [];
    for (const entry of entries) if (!letters.includes(entry.label)) letters.push(entry.label);
    const label = entries.map((entry) => entry.label).join(' ');
    const cy = y + (label === '' ? U * 0.5 : U * 0.3);
    out.push('<path class="plan__chevron" d="M' + n(x + U * 0.3) + ' ' + n(cy + U * 0.1) + 'L' + n(x + U * 0.5) + ' ' + n(cy - U * 0.1) + 'L' + n(x + U * 0.7) + ' ' + n(cy + U * 0.1) + '"/>');
    if (label === '') continue;
    if (!entries.some((entry) => entry.way)) {
      const size = fit(textEms(label), U - 2, 8);
      put(text(x + U / 2, y + U * 0.72, size, 'plan__letter', label), labelBox(label, x + U / 2, y + U * 0.72, size));
      continue;
    }
    // each letter with its own chevron, the row centred in the cell
    const mark = (entry) => (entry.way ? 0.5 : 0);
    const ems = entries.reduce((sum, entry, i) => sum + textEms(entry.label) + mark(entry) + (i > 0 ? 0.3 : 0), 0);
    const size = fit(ems, U - 2, 8);
    let at = x + U / 2 - (ems * size) / 2;
    const cyText = y + U * 0.72;
    entries.forEach((entry, i) => {
      if (i > 0) at += 0.3 * size;
      const wide = textEms(entry.label) * size;
      put(text(at + wide / 2, cyText, size, 'plan__letter', entry.label), labelBox(entry.label, at + wide / 2, cyText, size));
      at += wide;
      if (entry.way) {
        const mx = at + 0.25 * size;
        const reach = 0.17 * size;
        const tip = entry.way === 'up' ? -reach : reach;
        put('<path class="plan__chevron plan__oneway" style="stroke-width:' + n(Math.max(1.5, size * 0.16)) + ';stroke-linecap:round;stroke-linejoin:round" d="M' + n(mx - reach) + ' ' + n(cyText - tip / 2) + 'L' + n(mx) + ' ' + n(cyText + tip / 2) + 'L' + n(mx + reach) + ' ' + n(cyText - tip / 2) + '"/>', { left: mx - reach, right: mx + reach, top: cyText - reach, bottom: cyText + reach });
        at += mark(entry) * size;
      }
    });
  }

  // other spaces, then rooms: the fill, the outline with its door gaps, the label
  let rooms = 0;
  // each drawn space's label cell and the box of its label, or null for none
  const labelled = [];
  const spaces = floor.spaces.filter((space) => space.kind !== 'room').concat(floor.spaces.filter((space) => space.kind === 'room')).filter((space) => shown(space.cells));
  for (const space of spaces) {
    const isRoom = space.kind === 'room';
    const shape = shapeOf(space, width);
    const labelCell = Math.floor(shape.anchor.y) * width + Math.floor(shape.anchor.x);
    let labelBoxOf = null;
    let fill;
    if (isRoom) {
      rooms += 1;
      const subject = space.subjectId ? project.subjects.find((candidate) => candidate.id === space.subjectId) : null;
      fill = subject ? fillFor(subject.colour, ROOM_STRENGTH, PLAN_ROOM_DEFAULT) : PLAN_ROOM_DEFAULT;
    } else {
      fill = fillFor(space.colour, OTHER_STRENGTH, PLAN_ROOM_DEFAULT);
    }
    const ink = labelOn(fill, PLAN_INK, PLAN_PAPER);
    const numbered = !isRoom || (typeof space.number === 'string' && space.number.trim() !== '');
    out.push('<g class="plan__space plan__space--' + (isRoom ? 'room' : 'other') + (numbered ? '' : ' plan__space--unnumbered') + '">');
    out.push('<path class="plan__fill" fill="' + fill + '" d="' + cellsPath(space.cells, width) + '"/>');
    out.push('<path class="plan__outline" d="' + linesPath(shape.edges.concat(doorStubs(shape.doorEdges))) + '"/>');
    if (shape.stepEdges.length > 0) out.push(stepBarsMarkup(shape.stepEdges, 1.4));
    const words = isRoom ? space.number : space.label;
    const cx = shape.anchor.x * U;
    const cy = shape.anchor.y * U;
    const room = shape.anchor.w * U - 3;
    const mainTeacher = isRoom && space.teacherIds.length > 0 ? project.teachers.find((teacher) => teacher.id === space.teacherIds[0]) : null;
    const under = mainTeacher && opts.teachers !== false ? surname(mainTeacher.name) : '';
    const underSize = fit(textEms(under), room, NAME_MAX);
    const twoLines = under !== '' && shape.anchor.h >= 2 && underSize >= NAME_MIN && typeof words === 'string' && words.trim() !== '';
    if (typeof words === 'string' && words.trim() !== '') {
      // a number is as large as its room lets it be: at most 45% of the room's height (30% over a surname)
      const tall = shape.anchor.h * U * (twoLines ? 0.3 : 0.45);
      const size = Math.max(NUMBER_MIN, fit(textEms(words), room, Math.min(isRoom ? NUMBER_MAX : LABEL_MAX, tall)));
      const y = cy - (twoLines ? underSize * 0.6 : 0);
      labelBoxOf = labelBox(words, cx, y, size);
      put(text(cx, y, size, isRoom ? 'plan__number' : 'plan__label', words, ' fill="' + ink + '"'), labelBoxOf);
      if (twoLines) {
        const below = cy + size * 0.5 + underSize * 0.2;
        put(text(cx, below, underSize, 'plan__teacher', under, ' fill="' + ink + '"'), labelBox(under, cx, below, underSize));
      }
    }
    out.push('</g>');
    labelled.push({ id: space.id, cell: labelCell, box: labelBoxOf });
  }

  // the reference grid's lines, over the rooms and under every label that follows
  let grid = null;
  if (gridAsked) {
    const gx = crop ? crop.x : x0;
    const gy = crop ? crop.y : y0;
    const gw = crop ? crop.width : x1 - x0 + 1;
    const gh = crop ? crop.height : y1 - y0 + 1;
    grid = gridOver(opts.refGrid, gx, gy, gw, gh);
    const lines = [];
    for (let k = 0; k <= grid.cols; k += 1) {
      const at = Math.min(gx + k * grid.size, gx + gw);
      lines.push('M' + n(at * U) + ' ' + n(gy * U) + 'L' + n(at * U) + ' ' + n((gy + gh) * U));
    }
    for (let k = 0; k <= grid.rows; k += 1) {
      const at = Math.min(gy + k * grid.size, gy + gh);
      lines.push('M' + n(gx * U) + ' ' + n(at * U) + 'L' + n((gx + gw) * U) + ' ' + n(at * U));
    }
    out.push('<path class="plan__grid-lines" aria-hidden="true" d="' + lines.join('') + '"/>');
  }

  // corridor names, along the way the named cells run
  const routed = Boolean(options && options.route && typeof options.route === 'object') || manyWays !== null;
  const namesOver = [];
  // the boxes of the corridor names, which the marker's pill keeps clear of
  const nameAvoid = [];
  for (const named of floor.corridors) {
    if (typeof named.name !== 'string' || named.name.trim() === '' || named.cells.length === 0 || !shown(named.cells)) continue;
    let ax = Infinity;
    let ay = Infinity;
    let bx = -1;
    let by = -1;
    for (const cell of named.cells) {
      ax = Math.min(ax, cell % width);
      bx = Math.max(bx, cell % width);
      ay = Math.min(ay, Math.floor(cell / width));
      by = Math.max(by, Math.floor(cell / width));
    }
    const across = bx - ax >= by - ay;
    const cx = ((ax + bx + 1) / 2) * U;
    const cy = ((ay + by + 1) / 2) * U;
    const run = (across ? bx - ax + 1 : by - ay + 1) * U - 4;
    const size = Math.max(NAME_MIN, fit(textEms(named.name.toUpperCase()) * SPACED, run, NAME_MAX));
    // with a route the names go over it, on a halo of paper (SV2-72c: the
    // way out along MAIN CORRIDOR left "RIDOR" of it on Room 303's card)
    const markup = text(cx, cy, size, 'plan__corridor-name', named.name, (across ? '' : ' transform="rotate(-90 ' + n(cx) + ' ' + n(cy) + ')"') + (routed ? ' stroke="' + PLAN_PAPER + '" stroke-width="2.4" paint-order="stroke"' : ''));
    const box = labelBox(named.name.toUpperCase(), cx, cy, size, SPACED, !across);
    nameAvoid.push({ left: box.left - 1, right: box.right + 1, top: box.top - 1, bottom: box.bottom + 1 });
    if (routed) namesOver.push(crop ? { markup, box } : markup);
    else put(markup, box);
  }

  // exits: a thick dash on the edge that leads outside, the door name beyond it
  let exits = 0;
  let named = false;
  // in a window with a route, the box of the route's exit's name (it lies
  // outside the floor, so the window grows to hold it)
  const routeExit = options && options.route && typeof options.route === 'object' && Number.isInteger(options.route.exit) ? options.route.exit : null;
  let nameBox = null;
  const gap0 = 4;
  // boxes, in units, the picture must hold (door names and marks, the marker's words)
  const reach = [];
  for (const exit of floor.exits) {
    const x = exit.cell % width;
    const y = Math.floor(exit.cell / width);
    const side = outside(x, y - 1) ? 'n' : outside(x, y + 1) ? 's' : outside(x - 1, y) ? 'w' : outside(x + 1, y) ? 'e' : null;
    if (!side || !shown([exit.cell])) continue;
    exits += 1;
    const across = side === 'n' || side === 's';
    const at = (side === 'n' ? y : side === 's' ? y + 1 : side === 'w' ? x : x + 1) * U;
    out.push(across
      ? '<path class="plan__exit" d="M' + n((x + 0.15) * U) + ' ' + at + 'L' + n((x + 0.85) * U) + ' ' + at + '"/>'
      : '<path class="plan__exit" d="M' + at + ' ' + n((y + 0.15) * U) + 'L' + at + ' ' + n((y + 0.85) * U) + '"/>');
    if (exit.stepFree === false) {
      // steps outside the door: two thin bars beside the dash
      const piece = across ? [x + 0.2, at / U, x + 0.8, at / U] : [at / U, y + 0.2, at / U, y + 0.8];
      const bars = [];
      for (const off of [-0.2, 0.2]) bars.push(across ? [piece[0], piece[1] + off, piece[2], piece[3] + off] : [piece[0] + off, piece[1], piece[2] + off, piece[3]]);
      out.push('<path class="plan__steps" fill="none" stroke="' + PLAN_WARNING + '" stroke-width="1" stroke-linecap="butt" d="' + linesPath(bars) + '"/>');
    }
    const mark = marks.get(exit.id) || null;
    const hasName = typeof exit.doorName === 'string' && exit.doorName.trim() !== '';
    // an exit with a number: a filled circle beside the door name. On a north or
    // south edge it is left of the name (the name stays centred on the door); on
    // an east or west edge it is next to the dash and the name moves out past it.
    const markR = 5.2;
    const markGap = mark === null ? 0 : markR * 2 + 2;
    if (hasName) {
      named = true;
      const gap = 4;
      const nameGap = across ? gap : gap + markGap;
      const markup = across
        ? text((x + 0.5) * U, at + (side === 'n' ? -gap - 3 : gap + 4), 7.5, 'plan__exit-name', exit.doorName)
        : text(at + (side === 'w' ? -nameGap : nameGap), (y + 0.5) * U, 7.5, 'plan__exit-name plan__exit-name--' + side, exit.doorName);
      // the route's exit's name is always whole: the window grows to hold it, on the safe side
      if (crop && routeExit === exit.cell) nameBox = exitNameBox(exit.doorName, side, x, y, at, nameGap);
      const box = across
        ? labelBox(exit.doorName, (x + 0.5) * U, at + (side === 'n' ? -gap - 3 : gap + 4), 7.5)
        : labelBox(exit.doorName, at + (side === 'w' ? -nameGap : nameGap), (y + 0.5) * U, 7.5, 1, false, side);
      put(markup, box);
      // with marks or a grid the picture must hold every name whole, whatever its length
      // (not in a window: there the edge cuts a name, and the window stays as asked)
      if (!crop && (marks.size > 0 || gridAsked)) reach.push(exitNameBox(exit.doorName, side, x, y, at, nameGap));
    }
    if (mark !== null) {
      const colour = hexOr(mark.colour, printExitColour(mark.number - 1));
      const words = numberWords(mark.number);
      let mx;
      let my;
      if (across) {
        const nameWide = hasName ? textEms(exit.doorName) * 7.5 : 0;
        mx = (x + 0.5) * U - (hasName ? nameWide / 2 + markR + 2 : 0);
        my = at + (side === 'n' ? -gap0 - 3 : gap0 + 4);
      } else {
        mx = at + (side === 'w' ? -(gap0 + markR) : gap0 + markR);
        my = (y + 0.5) * U;
      }
      const size = fit(textEms(words), markR * 2 - 1.4, 7);
      const ink = labelOn(colour, PLAN_INK, PLAN_PAPER);
      put('<circle class="plan__mark" cx="' + n(mx) + '" cy="' + n(my) + '" r="' + n(markR) + '" fill="' + colour + '"/>' + text(mx, my, size, 'plan__mark-number', words, ' fill="' + ink + '"'), { left: mx - markR, right: mx + markR, top: my - markR, bottom: my + markR });
      if (!crop) reach.push({ left: mx - markR - 1, right: mx + markR + 1, top: my - markR - 1, bottom: my + markR + 1 });
    }
  }

  // areas of refuge: a rounded square in the accent with a seated figure, the name beside it
  for (const refuge of floor.refuges || []) {
    if (!shown([refuge.cell])) continue;
    const rx = (refuge.cell % width) * U;
    const ry = Math.floor(refuge.cell / width) * U;
    out.push('<path class="plan__refuge" fill="none" stroke="' + PLAN_ACCENT + '" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" d="M' + n(rx + 3.2) + ' ' + n(ry + 1.6) + 'h' + n(U - 6.4) + 'a1.6 1.6 0 0 1 1.6 1.6v' + n(U - 6.4) + 'a1.6 1.6 0 0 1 -1.6 1.6h' + n(-(U - 6.4)) + 'a1.6 1.6 0 0 1 -1.6 -1.6v' + n(-(U - 6.4)) + 'a1.6 1.6 0 0 1 1.6 -1.6z'
      + 'M' + n(rx + U * 0.42 + 1.1) + ' ' + n(ry + U * 0.27) + 'a1.1 1.1 0 1 0 -2.2 0a1.1 1.1 0 1 0 2.2 0M' + n(rx + U * 0.42) + ' ' + n(ry + U * 0.4) + 'L' + n(rx + U * 0.42) + ' ' + n(ry + U * 0.58) + 'L' + n(rx + U * 0.64) + ' ' + n(ry + U * 0.58) + 'L' + n(rx + U * 0.64) + ' ' + n(ry + U * 0.76) + '"/>');
    if (typeof refuge.name === 'string' && refuge.name.trim() !== '') {
      named = true;
      const tx = rx + U + 2;
      const ty = ry + U / 2;
      put(text(tx, ty, 6, 'plan__exit-name plan__exit-name--e', refuge.name), labelBox(refuge.name, tx, ty, 6, 1, false, 'e'));
    }
  }

  // the way out, over everything
  if (options && options.route && typeof options.route === 'object') {
    const way = routeMarkup(floor, options.route);
    if (way !== '') out.push(way);
  }
  if (manyWays !== null) {
    const ways = waysMarkup(floor, manyWays, text, nameAvoid);
    if (ways !== '') out.push(ways);
  }
  out.push(...namesOver);

  // "You are here": a filled mark on its cell with its words in a pill. The pill
  // is above the dot (below it on the top row of what is drawn); when that would
  // cover a corridor's name or a route's badge it goes on the first other side
  // that does not (below, above, right, left), and in a window on one the window
  // holds whole. Nothing here grows a window.
  if (marker !== null) {
    const r = U * 0.38;
    const words = typeof marker.label === 'string' ? marker.label : '';
    const size = 10;
    const wide = textEms(words) * size + 8;
    const tall = size + 6;
    const hits = (b, o) => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top;
    const clear = (b) => !nameAvoid.some((o) => hits(b, o));
    const inside = (b) => !crop || (b.left >= crop.x * U && b.right <= (crop.x + crop.width) * U && b.top >= crop.y * U && b.bottom <= (crop.y + crop.height) * U);
    // where the dot and the pill of a marker on one cell would lie, and whether
    // the dot and one side of pill are clear of every name and badge
    const placeAt = (cell) => {
      const mx = ((cell % width) + 0.5) * U;
      const my = (Math.floor(cell / width) + 0.5) * U;
      const box = { left: mx - r, right: mx + r, top: my - r, bottom: my + r };
      const pillBox = (left, top) => ({ left, right: left + wide, top, bottom: top + tall });
      const above = Math.floor(cell / width) > (crop ? crop.y : y0);
      const sides = [pillBox(mx - wide / 2, my - r - 3 - tall), pillBox(mx - wide / 2, my + r + 3), pillBox(mx + r + 3, my - tall / 2), pillBox(mx - r - 3 - wide, my - tall / 2)];
      const [up, down, right, left] = sides;
      const order = above ? [up, down, right, left] : [down, right, left, up];
      const dotClear = clear(box);
      const pillClear = order.find((o) => clear(o) && inside(o)) || null;
      return { cell, mx, my, box, order, dotClear, pillClear };
    };
    // SV2-112b: the dot never sits on a corridor's name. Where the cell lies
    // under one, the marker moves to the nearest cell of the same corridor with
    // the dot and a pill side both clear (else the nearest with the dot clear).
    let spot = placeAt(marker.cell);
    if (!spot.dotClear) {
      const corridor = floor.corridors.find((c) => Array.isArray(c.cells) && c.cells.includes(marker.cell));
      if (corridor) {
        const near = (cell) => Math.hypot((cell % width) - (marker.cell % width), Math.floor(cell / width) - Math.floor(marker.cell / width));
        const options = corridor.cells.filter((cell) => cell !== marker.cell && Number.isInteger(cell) && cell >= 0 && cell < width * height && (!crop || inCrop(cell)) && shown([cell])).sort((p, q) => near(p) - near(q) || p - q).map(placeAt);
        const better = options.find((o) => o.dotClear && (words.trim() === '' || o.pillClear)) || (spot.dotClear ? null : options.find((o) => o.dotClear));
        if (better) spot = better;
      }
    }
    const { mx, my, box, order } = spot;
    const dot = '<circle class="plan__marker" cx="' + n(mx) + '" cy="' + n(my) + '" r="' + n(r) + '"/>';
    if (words.trim() === '') {
      put('<g class="plan__you">' + dot + '</g>', box);
      if (!crop) reach.push({ left: box.left - 1, right: box.right + 1, top: box.top - 1, bottom: box.bottom + 1 });
    } else {
      const pill = order.find((b) => clear(b) && inside(b)) || order.find(inside) || order[0];
      const pieces = '<rect class="plan__marker-pill" x="' + n(pill.left) + '" y="' + n(pill.top) + '" width="' + n(wide) + '" height="' + n(tall) + '" rx="' + n(tall / 2) + '"/>'
        + text(pill.left + wide / 2, pill.top + tall / 2, size, 'plan__marker-label', words);
      if (crop) {
        // the dot is in the window; the pill stays only if the window holds it whole
        put('<g class="plan__you">' + dot + '</g>', box);
        put('<g class="plan__you">' + pieces + '</g>', pill);
      } else {
        out.push('<g class="plan__you">' + dot + pieces + '</g>');
        box.left = Math.min(box.left, pill.left);
        box.right = Math.max(box.right, pill.right);
        box.top = Math.min(box.top, pill.top);
        box.bottom = Math.max(box.bottom, pill.bottom);
        reach.push({ left: box.left - 1, right: box.right + 1, top: box.top - 1, bottom: box.bottom + 1 });
      }
    }
  }

  // cropped to what is drawn, with room around it for the door names; or to
  // the window asked for, edge to edge
  const pad = named ? 1 : 0.25;
  let vx = crop ? crop.x * U : (x0 - pad) * U;
  let vy = crop ? crop.y * U : (y0 - pad) * U;
  let vw = crop ? crop.width * U : (x1 - x0 + 1 + pad * 2) * U;
  let vh = crop ? crop.height * U : (y1 - y0 + 1 + pad * 2) * U;
  if (nameBox !== null) {
    // the window grows past its edge, the floor's too, by what the name needs
    const left = Math.min(vx, nameBox.left);
    const top = Math.min(vy, nameBox.top);
    vw = Math.max(vx + vw, nameBox.right) - left;
    vh = Math.max(vy + vh, nameBox.bottom) - top;
    vx = left;
    vy = top;
  }
  // the picture holds each door name and mark, and the marker's words, whole
  for (const box of reach) {
    const left = Math.min(vx, box.left);
    const top = Math.min(vy, box.top);
    vw = Math.max(vx + vw, box.right) - left;
    vh = Math.max(vy + vh, box.bottom) - top;
    vx = left;
    vy = top;
  }
  // the window a label is judged against: everything but the grid's band, which
  // holds the grid's own letters and so never makes room for a cut label
  const held = { x: vx, y: vy, w: vw, h: vh };
  // the reference grid's labels in a band outside all of it
  const labelling = [];
  if (grid !== null) {
    const gx = crop ? crop.x : x0;
    const gy = crop ? crop.y : y0;
    const gw = crop ? crop.width : x1 - x0 + 1;
    const gh = crop ? crop.height : y1 - y0 + 1;
    const longest = Math.max(vw, vh);
    const size = Math.max(9, longest * 0.011);
    const thick = size * 1.7;
    vx -= thick;
    vy -= thick;
    vw += thick * 2;
    vh += thick * 2;
    const label = (x, y, words) => labelling.push(text(x, y, size, 'plan__grid-label', words));
    for (let k = 0; k < grid.cols; k += 1) {
      const mid = (gx + k * grid.size + Math.min(grid.size, gx + gw - (gx + k * grid.size)) / 2) * U;
      label(mid, vy + thick / 2, columnLetters(k));
      label(mid, vy + vh - thick / 2, columnLetters(k));
    }
    for (let k = 0; k < grid.rows; k += 1) {
      const mid = (gy + k * grid.size + Math.min(grid.size, gy + gh - (gy + k * grid.size)) / 2) * U;
      label(vx + thick / 2, mid, String(k + 1));
      label(vx + vw - thick / 2, mid, String(k + 1));
    }
    out.push('<g class="plan__grid-labels" aria-hidden="true">' + labelling.join('') + '</g>');
  }
  // in a window, each label the window would cut is left out
  const whole = (box) => box.left >= held.x - 1e-9 && box.top >= held.y - 1e-9 && box.right <= held.x + held.w + 1e-9 && box.bottom <= held.y + held.h + 1e-9;
  const markup = crop ? out.filter((each) => typeof each === 'string' || whole(each.box)).map((each) => (typeof each === 'string' ? each : each.markup)) : out;
  const place = options && options.place && typeof options.place === 'object' ? options.place : null;
  const at = place ? ' x="' + n(place.x) + '" y="' + n(place.y) + '" width="' + n(place.width) + '" height="' + n(place.height) + '"' : '';
  const svg = '<svg class="plan" xmlns="http://www.w3.org/2000/svg"' + at + ' viewBox="' + [vx, vy, vw, vh].map(n).join(' ') + '" role="img" aria-label="' + write('Floor plan of ' + floor.name) + '">\n'
    + markup.join('\n') + '\n</svg>';
  const labelCells = new Map();
  const unlabelled = [];
  for (const each of labelled) {
    if (each.box !== null && (!crop || whole(each.box))) labelCells.set(each.id, each.cell);
    else unlabelled.push(each.id);
  }
  const picture = { svg, drawn: true, traced: traceUrl !== null, width: vw / U, height: vh / U, rooms, exits, letters };
  // named only where a stop is drawn, so a building without one returns what it always did
  if (elevators.length > 0) picture.elevators = elevators;
  if (grid !== null) {
    picture.grid = grid;
    picture.labelCells = labelCells;
    picture.unlabelled = unlabelled;
  }
  return picture;
}
