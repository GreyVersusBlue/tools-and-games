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
//   planSvg(project, floor, options) → { svg, drawn, traced, width, height, rooms, exits, letters }
//     options.traceImage    true to draw the floor's traced image. Off by default.
//     options.traceImages   { [imageId]: 'data:image/…' }: the bytes, as data
//                           URLs. An image with no entry here, one that is
//                           hidden (visible: false) or missing, and an entry
//                           that is not a data URL of an image are not drawn.
//     svg      the markup, or '' when nothing is drawn on the floor
//     traced   whether the traced image is in the picture
//     width, height   of the cropped picture, in cells (for fitting it to a page)
//     rooms, exits, letters   what the caption under the plan counts

import { mix, labelOn, parse, ROOM_STRENGTH, OTHER_STRENGTH } from '../colour.js';
import { CELL_CORRIDOR, CELL_STAIRS, CELL_EMPTY, spaceOwners } from '../../engine/schema.js';
import { esc } from './document.js';
import { tracePlacement } from '../building/trace.js';

// The light theme's ink and room-default (tokens.css), and white paper. They
// are written out because a data colour has to be mixed and measured here, as
// numbers; test/engine/prints.test.mjs holds them to tokens.css.
export const PLAN_INK = '#1f2328';
export const PLAN_PAPER = '#ffffff';
export const PLAN_ROOM_DEFAULT = '#e9e4d9';

// One cell is this many units of the picture.
const U = 20;
const SIDES = ['n', 'e', 's', 'w'];
// Labels, in units. A number that cannot be this small and still fit is
// printed at the smallest size anyway: on paper a label is never left out.
const NUMBER_MAX = 15;
const NUMBER_MIN = 4;
const LABEL_MAX = 8;
const NAME_MAX = 7;
const NAME_MIN = 3.6;
// How wide a character of the condensed face runs, as a share of its size.
const CHARACTER = 0.5;

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
  const cells = space.cells.slice().sort((a, b) => a - b);
  const edges = [];
  const doorEdges = [];
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
      if (doors.has(cell + ':' + side)) doorEdges.push(piece);
      else edges.push(piece);
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
  return { edges, doorEdges, anchor };
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

// The size a label of `length` characters can be and still fit `room` units.
function fit(length, room, max) {
  if (length === 0) return max;
  return Math.min(max, room / (length * CHARACTER));
}

function fillFor(colour, strength, fallback) {
  return parse(colour) ? mix(colour, PLAN_PAPER, strength) : fallback;
}

function surname(name) {
  const words = String(name).trim().split(/\s+/);
  return words[words.length - 1];
}

function text(x, y, size, cls, value, more) {
  return '<text class="' + cls + '" x="' + n(x) + '" y="' + n(y) + '" font-size="' + n(size) + '"' + (more || '') + '>' + esc(value) + '</text>';
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

export function planSvg(project, floor, options) {
  const width = floor.width;
  const height = floor.height;
  const owners = spaceOwners(floor);
  const corridor = [];
  const stairs = [];
  for (let cell = 0; cell < width * height; cell += 1) {
    if (floor.cells[cell] === CELL_CORRIDOR) corridor.push(cell);
    else if (floor.cells[cell] === CELL_STAIRS) stairs.push(cell);
  }

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
  if (x1 === -1) return { svg: '', drawn: false, traced: false, width: 0, height: 0, rooms: 0, exits: 0, letters: [] };

  const walkable = (x, y) => x >= 0 && y >= 0 && x < width && y < height && (floor.cells[y * width + x] === CELL_CORRIDOR || floor.cells[y * width + x] === CELL_STAIRS);
  const outside = (x, y) => x < 0 || y < 0 || x >= width || y >= height || (floor.cells[y * width + x] === CELL_EMPTY && !owners.has(y * width + x));

  const out = [];

  // the traced image, under everything
  const traceUrl = traceSource(floor, options);
  if (traceUrl !== null) out.push(traceMarkup(floor.image, traceUrl));

  // corridors and stairs, then the line where a walkable cell meets anything else
  if (corridor.length > 0) out.push('<path class="plan__corridor" d="' + cellsPath(corridor, width) + '"/>');
  if (stairs.length > 0) out.push('<path class="plan__stairs" d="' + cellsPath(stairs, width) + '"/>');
  const walls = [];
  for (const cell of corridor.concat(stairs)) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (!walkable(x, y - 1)) walls.push([x, y, x + 1, y]);
    if (!walkable(x, y + 1)) walls.push([x, y + 1, x + 1, y + 1]);
    if (!walkable(x - 1, y)) walls.push([x, y, x, y + 1]);
    if (!walkable(x + 1, y)) walls.push([x + 1, y, x + 1, y + 1]);
  }
  if (walls.length > 0) out.push('<path class="plan__wall" d="' + linesPath(walls) + '"/>');

  // stairs: a chevron and the letters of the connections that land there
  const lettersAt = new Map();
  for (const connection of project.building.connections) {
    for (const end of [connection.a, connection.b]) {
      if (end.floorId !== floor.id) continue;
      if (!lettersAt.has(end.cell)) lettersAt.set(end.cell, []);
      if (!lettersAt.get(end.cell).includes(connection.label)) lettersAt.get(end.cell).push(connection.label);
    }
  }
  const letters = [];
  for (const cell of stairs) {
    const x = (cell % width) * U;
    const y = Math.floor(cell / width) * U;
    const here = lettersAt.get(cell) || [];
    for (const letter of here) if (!letters.includes(letter)) letters.push(letter);
    const label = here.join(' ');
    const cy = y + (label === '' ? U * 0.5 : U * 0.3);
    out.push('<path class="plan__chevron" d="M' + n(x + U * 0.3) + ' ' + n(cy + U * 0.1) + 'L' + n(x + U * 0.5) + ' ' + n(cy - U * 0.1) + 'L' + n(x + U * 0.7) + ' ' + n(cy + U * 0.1) + '"/>');
    if (label !== '') out.push(text(x + U / 2, y + U * 0.72, fit(label.length, U - 2, 8), 'plan__letter', label));
  }

  // other spaces, then rooms: the fill, the outline with its door gaps, the label
  let rooms = 0;
  const spaces = floor.spaces.filter((space) => space.kind !== 'room').concat(floor.spaces.filter((space) => space.kind === 'room'));
  for (const space of spaces) {
    const isRoom = space.kind === 'room';
    const shape = shapeOf(space, width);
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
    const label = isRoom ? space.number : space.label;
    const cx = shape.anchor.x * U;
    const cy = shape.anchor.y * U;
    const room = shape.anchor.w * U - 3;
    const mainTeacher = isRoom && space.teacherIds.length > 0 ? project.teachers.find((teacher) => teacher.id === space.teacherIds[0]) : null;
    const under = mainTeacher ? surname(mainTeacher.name) : '';
    const underSize = fit(under.length, room, NAME_MAX);
    const twoLines = under !== '' && shape.anchor.h >= 2 && underSize >= NAME_MIN && typeof label === 'string' && label.trim() !== '';
    if (typeof label === 'string' && label.trim() !== '') {
      // a number is as large as its room lets it be: at most 45% of the room's height (30% over a surname)
      const tall = shape.anchor.h * U * (twoLines ? 0.3 : 0.45);
      const size = Math.max(NUMBER_MIN, fit(label.length, room, Math.min(isRoom ? NUMBER_MAX : LABEL_MAX, tall)));
      out.push(text(cx, cy - (twoLines ? underSize * 0.6 : 0), size, isRoom ? 'plan__number' : 'plan__label', label, ' fill="' + ink + '"'));
      if (twoLines) out.push(text(cx, cy + size * 0.5 + underSize * 0.2, underSize, 'plan__teacher', under, ' fill="' + ink + '"'));
    }
    out.push('</g>');
  }

  // corridor names, along the way the named cells run
  for (const named of floor.corridors) {
    if (typeof named.name !== 'string' || named.name.trim() === '' || named.cells.length === 0) continue;
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
    const size = Math.max(NAME_MIN, fit(named.name.length * 1.15, run, NAME_MAX));
    out.push(text(cx, cy, size, 'plan__corridor-name', named.name, across ? '' : ' transform="rotate(-90 ' + n(cx) + ' ' + n(cy) + ')"'));
  }

  // exits: a thick dash on the edge that leads outside, the door name beyond it
  let exits = 0;
  let named = false;
  for (const exit of floor.exits) {
    const x = exit.cell % width;
    const y = Math.floor(exit.cell / width);
    const side = outside(x, y - 1) ? 'n' : outside(x, y + 1) ? 's' : outside(x - 1, y) ? 'w' : outside(x + 1, y) ? 'e' : null;
    if (!side) continue;
    exits += 1;
    const across = side === 'n' || side === 's';
    const at = (side === 'n' ? y : side === 's' ? y + 1 : side === 'w' ? x : x + 1) * U;
    out.push(across
      ? '<path class="plan__exit" d="M' + n((x + 0.15) * U) + ' ' + at + 'L' + n((x + 0.85) * U) + ' ' + at + '"/>'
      : '<path class="plan__exit" d="M' + at + ' ' + n((y + 0.15) * U) + 'L' + at + ' ' + n((y + 0.85) * U) + '"/>');
    if (typeof exit.doorName === 'string' && exit.doorName.trim() !== '') {
      named = true;
      const gap = 4;
      if (across) out.push(text((x + 0.5) * U, at + (side === 'n' ? -gap - 3 : gap + 4), 7.5, 'plan__exit-name', exit.doorName));
      else out.push(text(at + (side === 'w' ? -gap : gap), (y + 0.5) * U, 7.5, 'plan__exit-name plan__exit-name--' + side, exit.doorName));
    }
  }

  // cropped to what is drawn, with room around it for the door names
  const pad = named ? 1 : 0.25;
  const vx = (x0 - pad) * U;
  const vy = (y0 - pad) * U;
  const vw = (x1 - x0 + 1 + pad * 2) * U;
  const vh = (y1 - y0 + 1 + pad * 2) * U;
  const svg = '<svg class="plan" xmlns="http://www.w3.org/2000/svg" viewBox="' + [vx, vy, vw, vh].map(n).join(' ') + '" role="img" aria-label="' + esc('Floor plan of ' + floor.name) + '">\n'
    + out.join('\n') + '\n</svg>';
  return { svg, drawn: true, traced: traceUrl !== null, width: vw / U, height: vh / U, rooms, exits, letters };
}
