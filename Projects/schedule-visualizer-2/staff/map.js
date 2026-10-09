// The staff browser's floor plan: a small picture of one floor for a phone.
// Rooms are blocks in their subject's colour with their numbers, corridors are
// the corridor colour, stairs carry their letter, and a room a page is about
// is ringed. Above it are the floor tabs and the zoom buttons. It is not the
// planner's drawing surface and shares no code with it: a published file
// carries this and nothing of the editor.
//
//   floorMap(ctx, { floorId, marks, says, floorHref, label, route, around })
//
//   marks       [{ roomId, ring, badge, short }]: rooms to ring, and what to
//               write on them (`badge` when it fits the room, else `short`)
//   says        (floor) => text or nodes: the line under the picture that says
//               in words what is marked on that floor
//   floorHref   (floor) => an address: the tabs are links (the map page);
//               without it they are buttons and the floor changes in place
//   route       a route the engine found (school.route): its line is drawn on
//               each floor it crosses, a dot where it starts and a ring where
//               it ends
//   around      a room id: the picture is that room and what is near it on
//               its own floor (MAP_REACH cells each way), with no floor tabs
//
// One finger on the picture still scrolls the page (touch-action: pan-y, in
// staff.css) and a pinch is the browser's own. A drag sideways moves a
// zoomed-in floor. A tap picks the nearest room within 22 px; when a second
// room is nearly as near, a short list asks which. The words beside or under
// the picture are its alternative: nothing is on the canvas alone.

import { h, typed } from './dom.js';
import { makeHash } from './router.js';

export const MAP_TAP_RADIUS = 22;
// Two rooms are "close" when the second is within the radius and less than
// this much farther from the tap than the first.
export const MAP_TAP_SLACK = 11;
export const MAP_ZOOMS = [1, 1.5, 2, 3];
// A small building is not blown up to fill a wide window.
export const MAP_MAX_CELL = 26;
// How far "around a room" reaches from the room's own cells, in cells.
export const MAP_REACH = 7;

const ROOM_STRENGTH = 0.7; // DESIGN 3: a subject colour on the plan
const OTHER_STRENGTH = 0.6;
const DRAG_SLOP = 6;

// ---- colour. contrast(), mix(), readable(), labelColour() and labelOn() are
// copied from ui/colour.js, which a published file does not carry (it is not
// on staff/manifest.js). test/browser/staff-views-a.mjs holds the two copies
// together. Colours here are "#rrggbb" or "#rgb"; anything else is null.

function parseHex(colour) {
  const match = typeof colour === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim()) : null;
  if (!match) return null;
  const digits = match[1].length === 3 ? Array.from(match[1], (d) => d + d).join('') : match[1];
  return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
}

function toHex(c) {
  return '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function luminance(colour) {
  const c = parseHex(colour);
  const linear = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// `colour` laid over `surface` at `strength` (0 is all surface, 1 all colour).
export function mapMix(colour, surface, strength) {
  const c = parseHex(colour);
  const s = parseHex(surface);
  const t = Math.min(1, Math.max(0, strength));
  return toHex({ r: s.r + (c.r - s.r) * t, g: s.g + (c.g - s.g) * t, b: s.b + (c.b - s.b) * t });
}

const MIDPOINT = Math.sqrt(1.05 * 0.05) - 0.05;

function readable(colour, surface, min) {
  if (contrast(colour, surface) >= min) return toHex(parseHex(colour));
  const end = luminance(surface) < MIDPOINT ? '#ffffff' : '#000000';
  for (let step = 1; step < 100; step += 1) {
    const candidate = mapMix(end, colour, step / 100);
    if (contrast(candidate, surface) >= min) return candidate;
  }
  return end;
}

// The colour for small text on `fill`: whichever of ink and paper stands out
// more, strengthened until it reaches 4.5:1.
export function mapLabelOn(fill, ink, paper) {
  const chosen = contrast(fill, paper) > contrast(fill, ink) ? paper : ink;
  return readable(chosen, fill, 4.5);
}

// ---- where things are. No DOM from here to the picture.

// The part of a floor with something drawn on it, in cells, with one empty
// cell around it. A floor with nothing on it is the whole floor.
export function floorExtentOf(floor) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  const see = (cell) => {
    const x = cell % floor.width;
    const y = Math.floor(cell / floor.width);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (let cell = 0; cell < floor.cells.length; cell += 1) {
    if (floor.cells[cell] !== '.') see(cell);
  }
  for (const space of floor.spaces) {
    for (const cell of space.cells) see(cell);
  }
  if (x1 === -1) return { x: 0, y: 0, w: floor.width, h: floor.height };
  return { x: x0 - 1, y: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 };
}

// The part of a floor around one room: the room's own cells and `reach` cells
// each way, never beyond what is drawn on the floor. Null when the room is not
// on this floor.
export function aroundExtentOf(floor, roomId, reach) {
  const room = floor.spaces.find((space) => space.id === roomId);
  if (!room || room.cells.length === 0) return null;
  const whole = floorExtentOf(floor);
  const xs = room.cells.map((cell) => cell % floor.width);
  const ys = room.cells.map((cell) => Math.floor(cell / floor.width));
  const far = Number.isFinite(reach) ? reach : MAP_REACH;
  const x0 = Math.max(whole.x, Math.min(...xs) - far);
  const y0 = Math.max(whole.y, Math.min(...ys) - far);
  const x1 = Math.min(whole.x + whole.w, Math.max(...xs) + 1 + far);
  const y1 = Math.min(whole.y + whole.h, Math.max(...ys) + 1 + far);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The part of a route that is on one floor, as lines of cells in the order
// walked: [{ cells, starts, ends }]. `starts` marks the line that leaves the
// first room and `ends` the one that reaches the last; a route that comes back
// to a floor has a line for each visit. The room cells at the two ends are
// part of the line, so it is seen to leave one door and reach the other.
export function routeOnFloor(found, floorId) {
  if (!found || !found.ok || found.same) return [];
  const lines = [];
  let last = null;
  found.cells.forEach((step, index) => {
    if (step.floorId !== floorId) {
      last = null;
      return;
    }
    if (last === null) {
      last = { cells: [], starts: false, ends: false };
      if (index === 0 && found.from && found.from.floorId === floorId) {
        last.cells.push(found.from.cell);
        last.starts = true;
      }
      lines.push(last);
    }
    last.cells.push(step.cell);
    if (index === found.cells.length - 1 && found.to && found.to.floorId === floorId) {
      last.cells.push(found.to.cell);
      last.ends = true;
    }
  });
  return lines;
}

// A space's cells as rows of touching cells, in cells.
function runsOf(floor, cells) {
  const runs = [];
  for (const cell of cells.slice().sort((a, b) => a - b)) {
    const x = cell % floor.width;
    const y = Math.floor(cell / floor.width);
    const last = runs[runs.length - 1];
    if (last && last.y === y && last.x + last.w === x) last.w += 1;
    else runs.push({ x, y, w: 1 });
  }
  return runs;
}

// Where everything on a floor falls in a picture `width` px wide: the size of
// a cell, the picture's height, how far a zoomed floor can be moved sideways,
// and each space's rectangles and bounding box in px. `part` is the piece of
// the floor to show (aroundExtentOf); left out, it is everything drawn.
export function planOf(floor, width, zoom, pan, part) {
  const extent = part || floorExtentOf(floor);
  const fit = Math.min(MAP_MAX_CELL, width / extent.w);
  const cell = fit * zoom;
  const wide = extent.w * cell;
  const maxPan = Math.max(0, wide - width);
  const at = Math.min(maxPan, Math.max(0, pan || 0));
  const ox = wide <= width ? (width - wide) / 2 : -at;
  const px = (x) => ox + (x - extent.x) * cell;
  const py = (y) => (y - extent.y) * cell;
  const shapes = floor.spaces.map((space) => {
    const rects = runsOf(floor, space.cells).map((run) => ({ x: px(run.x), y: py(run.y), w: run.w * cell, h: cell }));
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    return { id: space.id, kind: space.kind, rects, box: { x: left, y: top, w: right - left, h: bottom - top } };
  });
  return { extent, cell, width, height: extent.h * cell, pan: at, maxPan, ox, px, py, shapes };
}

function distanceTo(rects, x, y) {
  let best = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

// What a tap at (x, y) means: { pick: a room id or null, choices: [room ids] }.
// The nearest room within 22 px is picked. When another room is within 22 px
// too and under 11 px farther away than the nearest, nothing is picked and
// `choices` holds them, nearest first, for the reader to choose from.
export function roomsAtTap(shapes, x, y) {
  const near = [];
  for (const shape of shapes) {
    if (shape.kind !== 'room') continue;
    const distance = distanceTo(shape.rects, x, y);
    if (distance <= MAP_TAP_RADIUS) near.push({ id: shape.id, distance });
  }
  near.sort((a, b) => a.distance - b.distance);
  if (near.length === 0) return { pick: null, choices: [] };
  const close = near.filter((room) => room.distance - near[0].distance < MAP_TAP_SLACK);
  if (close.length === 1) return { pick: near[0].id, choices: [] };
  return { pick: null, choices: close.map((room) => room.id) };
}

// ---- the picture

function themeOf(element) {
  const style = getComputedStyle(element);
  const read = (name, fallback) => {
    const value = style.getPropertyValue(name).trim();
    return parseHex(value) ? value : fallback;
  };
  return {
    paper: read('--paper', '#f6f3ec'),
    ink: read('--ink', '#1f2328'),
    line: read('--line', '#d8d3c8'),
    edge: read('--line-strong', '#857f73'),
    accent: read('--accent', '#0f6e66'),
    accentInk: read('--accent-ink', '#ffffff'),
    grid: read('--grid', '#e8e3d8'),
    corridor: read('--corridor', '#ffffff'),
    stairs: read('--stairs', '#d9ece9'),
    roomDefault: read('--room-default', '#e9e4d9'),
    font: style.getPropertyValue('--font-plan').trim() || 'sans-serif',
  };
}

// The last word of a name, for the line under a room's number.
function surnameOf(name) {
  const words = String(name).trim().split(/\s+/);
  return words[words.length - 1];
}

// A route's lines on the floor shown: a pale edge under the accent so the line
// reads on a corridor and across a room alike.
function paintRoute(g, floor, plan, theme, lines) {
  const cell = plan.cell;
  const at = (index) => [plan.px(index % floor.width) + cell / 2, plan.py(Math.floor(index / floor.width)) + cell / 2];
  const wide = Math.max(3, Math.min(7, cell * 0.3));
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const [colour, width] of [[theme.paper, wide + 3], [theme.accent, wide]]) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    for (const line of lines) {
      g.beginPath();
      line.cells.forEach((index, step) => {
        const [x, y] = at(index);
        if (step === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      if (line.cells.length === 1) g.lineTo(...at(line.cells[0]));
      g.stroke();
    }
  }
  const dot = Math.max(5, wide * 1.2);
  for (const line of lines) {
    if (line.starts) {
      const [x, y] = at(line.cells[0]);
      g.fillStyle = theme.paper;
      g.beginPath();
      g.arc(x, y, dot + 1.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = theme.accent;
      g.beginPath();
      g.arc(x, y, dot, 0, Math.PI * 2);
      g.fill();
    }
    if (line.ends) {
      const [x, y] = at(line.cells[line.cells.length - 1]);
      g.fillStyle = theme.accent;
      g.beginPath();
      g.arc(x, y, dot + 1.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = theme.paper;
      g.beginPath();
      g.arc(x, y, dot - 2, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function paint(canvas, school, floor, plan, theme, marks, lines) {
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(plan.width * ratio));
  canvas.height = Math.max(1, Math.round(plan.height * ratio));
  canvas.style.height = plan.height + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = theme.grid;
  g.fillRect(0, 0, plan.width, plan.height);
  const cell = plan.cell;
  const font = (size) => '600 ' + size + 'px ' + theme.font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // corridors and stairs, then a hairline where one meets something else
  const walkable = (x, y) => x >= 0 && y >= 0 && x < floor.width && y < floor.height && floor.cells[y * floor.width + x] !== '.';
  const letters = new Map();
  for (const link of school.data.building.connections) {
    for (const end of [link.a, link.b]) {
      if (end.floorId === floor.id && !letters.has(end.cell)) letters.set(end.cell, link.label);
    }
  }
  for (let index = 0; index < floor.cells.length; index += 1) {
    const kind = floor.cells[index];
    if (kind === '.') continue;
    const x = index % floor.width;
    const y = Math.floor(index / floor.width);
    g.fillStyle = kind === 'S' ? theme.stairs : theme.corridor;
    g.fillRect(plan.px(x), plan.py(y), cell + 0.5, cell + 0.5);
  }
  g.strokeStyle = theme.line;
  g.lineWidth = 1;
  g.beginPath();
  for (let index = 0; index < floor.cells.length; index += 1) {
    if (floor.cells[index] === '.') continue;
    const x = index % floor.width;
    const y = Math.floor(index / floor.width);
    const left = plan.px(x);
    const top = plan.py(y);
    if (!walkable(x, y - 1)) { g.moveTo(left, top); g.lineTo(left + cell, top); }
    if (!walkable(x, y + 1)) { g.moveTo(left, top + cell); g.lineTo(left + cell, top + cell); }
    if (!walkable(x - 1, y)) { g.moveTo(left, top); g.lineTo(left, top + cell); }
    if (!walkable(x + 1, y)) { g.moveTo(left + cell, top); g.lineTo(left + cell, top + cell); }
  }
  g.stroke();
  if (cell >= 10) {
    g.font = font(Math.min(14, Math.round(cell * 0.8)));
    g.fillStyle = mapLabelOn(theme.stairs, theme.ink, theme.paper);
    for (const [index, letter] of letters) {
      if (floor.cells[index] !== 'S') continue;
      g.fillText(letter, plan.px(index % floor.width) + cell / 2, plan.py(Math.floor(index / floor.width)) + cell / 2 + 0.5);
    }
  }

  // exits: a thick dash in the accent on the outside edge
  g.strokeStyle = theme.accent;
  g.lineWidth = Math.max(3, cell / 4);
  g.beginPath();
  for (const exit of floor.exits || []) {
    const x = exit.cell % floor.width;
    const y = Math.floor(exit.cell / floor.width);
    const left = plan.px(x);
    const top = plan.py(y);
    const open = (ax, ay) => ax < 0 || ay < 0 || ax >= floor.width || ay >= floor.height || (floor.cells[ay * floor.width + ax] === '.' && !floor.spaces.some((space) => space.cells.includes(ay * floor.width + ax)));
    if (open(x, y + 1)) { g.moveTo(left, top + cell); g.lineTo(left + cell, top + cell); }
    else if (open(x + 1, y)) { g.moveTo(left + cell, top); g.lineTo(left + cell, top + cell); }
    else if (open(x - 1, y)) { g.moveTo(left, top); g.lineTo(left, top + cell); }
    else if (open(x, y - 1)) { g.moveTo(left, top); g.lineTo(left + cell, top); }
  }
  g.stroke();

  // rooms and other spaces
  const names = school.data.publish.teacherNamesOnMap !== false;
  floor.spaces.forEach((space, at) => {
    const shape = plan.shapes[at];
    const subject = space.kind === 'room' ? school.subject(space.subjectId) : null;
    let fill = theme.roomDefault;
    if (space.kind === 'room' && subject && parseHex(subject.colour)) fill = mapMix(subject.colour, theme.paper, ROOM_STRENGTH);
    if (space.kind !== 'room') fill = parseHex(space.colour) ? mapMix(space.colour, theme.paper, OTHER_STRENGTH) : theme.roomDefault;
    g.fillStyle = fill;
    for (const r of shape.rects) g.fillRect(r.x, r.y, r.w + 0.5, r.h + 0.5);
    const own = new Set(space.cells);
    g.strokeStyle = theme.edge;
    g.lineWidth = 1;
    g.beginPath();
    for (const index of space.cells) {
      const x = index % floor.width;
      const y = Math.floor(index / floor.width);
      const left = plan.px(x);
      const top = plan.py(y);
      if (y === 0 || !own.has(index - floor.width)) { g.moveTo(left, top); g.lineTo(left + cell, top); }
      if (y === floor.height - 1 || !own.has(index + floor.width)) { g.moveTo(left, top + cell); g.lineTo(left + cell, top + cell); }
      if (x === 0 || !own.has(index - 1)) { g.moveTo(left, top); g.lineTo(left, top + cell); }
      if (x === floor.width - 1 || !own.has(index + 1)) { g.moveTo(left + cell, top); g.lineTo(left + cell, top + cell); }
    }
    g.stroke();

    const box = shape.box;
    const mark = space.kind === 'room' ? marks.get(space.id) : null;
    const text = space.kind === 'room' ? (space.number.trim() === '' ? '?' : space.number) : space.label;
    const ink = mapLabelOn(fill, theme.ink, theme.paper);
    const top = space.kind === 'room' ? Math.min(16, Math.round(cell * 1.6)) : Math.min(12, Math.round(cell * 1.2));
    let drawn = 0;
    let middle = box.y + box.h / 2 + (mark && mark.short && box.h >= 36 ? 7 : 0);
    for (let size = top; size >= 8 && text !== ''; size -= 1) {
      g.font = font(size);
      if (g.measureText(text).width > box.w - 4 || size > box.h - 2) continue;
      const teacher = space.kind === 'room' && names && space.teacherIds.length > 0 ? school.teacher(space.teacherIds[0]) : null;
      const under = teacher ? surnameOf(teacher.name) : '';
      const small = Math.max(8, size - 4);
      g.font = font(small);
      const room = under !== '' && g.measureText(under).width <= box.w - 4 && box.h >= size + small + 8 + (mark && mark.short ? 14 : 0);
      g.fillStyle = ink;
      if (room) {
        g.fillText(under, box.x + box.w / 2, middle + size / 2 + 1);
        middle -= small / 2;
      }
      g.font = font(size);
      g.fillText(text, box.x + box.w / 2, middle + 0.5);
      drawn = size;
      break;
    }
    canvas.dataset['label' + space.id] = String(drawn);

    if (mark && mark.ring) {
      g.lineJoin = 'round';
      g.strokeStyle = theme.paper;
      g.lineWidth = 6;
      g.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
      g.strokeStyle = theme.accent;
      g.lineWidth = 3;
      g.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
    }
    if (mark && mark.short) {
      g.font = font(11);
      const long = mark.badge && g.measureText(mark.badge).width + 10 <= box.w + 6 ? mark.badge : mark.short;
      const wide = Math.max(16, g.measureText(long).width + 10);
      const bx = box.x + box.w / 2 - wide / 2;
      const by = box.y + 2;
      g.fillStyle = theme.accent;
      g.beginPath();
      g.roundRect(bx, by, wide, 16, 3);
      g.fill();
      g.fillStyle = theme.accentInk;
      g.fillText(long, box.x + box.w / 2, by + 8.5);
    }
  });

  if (lines.length > 0) paintRoute(g, floor, plan, theme, lines);
}

// ---- the frame: tabs, zoom, the picture, the line under it, the short list

export function floorMap(ctx, options) {
  const school = ctx.school;
  const opts = options || {};
  const marks = new Map((opts.marks || []).map((mark) => [mark.roomId, mark]));
  const near = opts.around ? school.floorOfRoom(opts.around) : null;
  const state = { floor: near || school.floor(opts.floorId) || school.floors[0], zoom: 0, pan: 0, plan: null };
  if (!state.floor) return h('p', { class: 'muted' }, 'This schedule has no floor plan.');

  const canvas = h('canvas', { class: 'map__plan', role: 'img' });
  const pulse = h('span', { class: 'map__pulse', hidden: true });
  const frame = h('div', { class: 'map' }, canvas, pulse);
  const says = h('p', { class: 'map__says muted' });
  const which = h('div', { class: 'map__which', role: 'group', 'aria-label': 'Which room?' });
  const tabs = h('div', { class: 'tabs map__tabs' });
  const out = h('button', { class: 'btn map__zoom', type: 'button', 'aria-label': 'Zoom out' }, '−');
  const into = h('button', { class: 'btn map__zoom', type: 'button', 'aria-label': 'Zoom in' }, '+');
  const fit = h('button', { class: 'btn map__zoom', type: 'button', 'aria-label': 'Fit the floor to the window' }, 'Fit');

  function draw() {
    const width = frame.clientWidth;
    if (width === 0) return;
    const lines = routeOnFloor(opts.route, state.floor.id);
    state.plan = planOf(state.floor, width, MAP_ZOOMS[state.zoom], state.pan, near ? aroundExtentOf(state.floor, opts.around, opts.reach) : null);
    state.pan = state.plan.pan;
    paint(canvas, school, state.floor, state.plan, themeOf(frame), marks, lines);
    frame.dataset.floor = state.floor.id;
    if (opts.route) frame.dataset.route = String(lines.reduce((sum, line) => sum + line.cells.length, 0));
    if (near) frame.dataset.around = opts.around;
    frame.dataset.zoom = String(MAP_ZOOMS[state.zoom]);
    frame.dataset.cell = String(state.plan.cell);
    const ringed = state.plan.shapes.find((shape) => marks.has(shape.id) && marks.get(shape.id).ring);
    pulse.hidden = !ringed;
    if (ringed) {
      pulse.style.left = ringed.box.x + 'px';
      pulse.style.top = ringed.box.y + 'px';
      pulse.style.width = ringed.box.w + 'px';
      pulse.style.height = ringed.box.h + 'px';
    }
  }

  function chrome() {
    const floor = state.floor;
    canvas.setAttribute('aria-label', (opts.label || 'Floor plan') + ': ' + floor.name + '. The rooms are listed in words on this page.');
    tabs.replaceChildren(...(near ? [] : school.floors).map((each) => {
      const current = each.id === floor.id;
      if (opts.floorHref) return h('a', { class: 'tab', href: opts.floorHref(each), 'aria-current': current ? 'page' : null, dataset: { floor: each.id } }, typed(each.name));
      return h('button', { class: 'tab', type: 'button', 'aria-current': current ? 'true' : null, dataset: { floor: each.id }, onclick: () => show(each) }, typed(each.name));
    }));
    out.setAttribute('aria-disabled', state.zoom === 0 ? 'true' : 'false');
    into.setAttribute('aria-disabled', state.zoom === MAP_ZOOMS.length - 1 ? 'true' : 'false');
    const said = opts.says ? opts.says(floor) : null;
    says.replaceChildren(...(said === null || said === undefined ? [] : [].concat(said)));
    says.hidden = says.childNodes.length === 0;
  }

  function show(floor) {
    state.floor = floor;
    state.pan = 0;
    which.replaceChildren();
    chrome();
    draw();
  }

  function zoomTo(index) {
    const next = Math.min(MAP_ZOOMS.length - 1, Math.max(0, index));
    if (next === state.zoom) return;
    // what was in the middle of the picture stays in the middle
    const before = state.plan;
    if (before) {
      const centre = before.maxPan === 0 ? before.extent.w / 2 : (state.pan + before.width / 2) / before.cell;
      const fitCell = before.cell / MAP_ZOOMS[state.zoom];
      state.pan = Math.max(0, centre * fitCell * MAP_ZOOMS[next] - before.width / 2);
    }
    state.zoom = next;
    chrome();
    draw();
  }

  out.addEventListener('click', () => zoomTo(state.zoom - 1));
  into.addEventListener('click', () => zoomTo(state.zoom + 1));
  fit.addEventListener('click', () => {
    state.pan = 0;
    if (state.zoom === 0) draw();
    else zoomTo(0);
  });

  // a drag sideways moves a zoomed-in floor; up and down is the page's
  let drag = null;
  let dragged = false;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { id: event.pointerId, x: event.clientX, pan: state.pan, moved: false };
    dragged = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id || !state.plan || state.plan.maxPan === 0) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        // a pointer that is already gone cannot be held; the drag still ends on up
      }
    }
    state.pan = drag.pan - dx;
    draw();
  });
  const end = (event) => {
    if (drag && event.pointerId === drag.id) {
      dragged = drag.moved;
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('click', (event) => {
    if (dragged) {
      dragged = false;
      return;
    }
    if (!state.plan || !school.has('room')) return;
    const box = canvas.getBoundingClientRect();
    const hit = roomsAtTap(state.plan.shapes, event.clientX - box.left, event.clientY - box.top);
    which.replaceChildren();
    if (hit.pick) {
      ctx.go(makeHash('room', hit.pick));
    } else if (hit.choices.length > 0) {
      const list = h('ul', { class: 'list' }, hit.choices.map((id) => h('li', null,
        h('a', { class: 'list__link', href: makeHash('room', id), dataset: { choice: id } },
          h('span', { class: 'list__name' }, typed(school.roomName(school.room(id), true)))))));
      which.replaceChildren(h('p', { class: 'map__ask' }, 'Which room?'), list);
      list.querySelector('a').focus();
    }
  });

  // drawn again when the frame changes width, when the plan face has loaded,
  // when the device changes between light and dark, and when the page goes to
  // paper and comes back (paper is light whatever the screen is)
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => draw()).observe(frame);
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 12px "Barlow Semi Condensed"').then(() => draw(), () => {});
  }
  if (typeof matchMedia === 'function') {
    const watched = [matchMedia('(prefers-color-scheme: dark)'), matchMedia('print')];
    const again = () => {
      if (canvas.isConnected) draw();
      else watched.forEach((query) => query.removeEventListener('change', again));
    };
    watched.forEach((query) => query.addEventListener('change', again));
  }

  chrome();
  return h('section', { class: 'mapbox', 'aria-label': opts.label || 'Floor plan' },
    h('div', { class: 'map__bar' }, near ? null : tabs, h('div', { class: 'map__zooms' }, out, into, fit)),
    frame,
    says,
    which);
}

// A room and what is near it, for a page that says where a room is. Null
// where the publisher left the map out, or the room is on no floor.
export function aroundRoom(ctx, room) {
  const school = ctx.school;
  const floor = school.floorOfRoom(room.id);
  if (!floor || !school.has('map')) return null;
  const name = school.roomName(room, true);
  return floorMap(ctx, {
    around: room.id,
    label: 'Around ' + name,
    marks: [{ roomId: room.id, ring: true }],
    says: () => [typed(name), ' is ringed, with what is near it on ', typed(floor.name), '.'],
  });
}

// A page with its map: on a phone the map sits in the page where it is given;
// from 900 px it stands beside everything else (.split in staff.css).
export function besideMap(before, map, after) {
  const rest = before.concat(after).filter(Boolean);
  const side = h('div', { class: 'split__side', style: 'grid-row: 1 / span ' + Math.max(1, rest.length) }, map);
  return h('div', { class: 'split' }, before.filter(Boolean), side, after.filter(Boolean));
}
