// Evacuation routes, laid over a floor plan (spec 10.1; DESIGN 5.5). The
// renderer draws the plan; this draws the ways out through the renderer's
// `overlays` hook, as lanes.js draws the walks. The routes are
// engine/evacuation.js's, worked out by the section; nothing here routes.
//
// Two pictures:
//   'all'   every room's way out in the colour of the exit it uses: the
//           route's line along the corridors, a frame inside the room, and
//           the exit's number in a badge on the room's corner, so a room can
//           be read without the colour (the key under the map names each
//           number; the inspector lists them in words)
//   'one'   the picked room's way out: one strong line from the round mark
//           at the door the walker leaves by to the square mark at the exit,
//           the room framed (the marks are the door card's, ui/prints/door-cards.js)
//
// The first half of this file has no canvas in it and runs in Node:
//
//   exitPalette(style) -> ['#rrggbb' or null, …]
//     the exits' colours of the theme on screen: --exit-1 to --exit-EXIT_COUNT
//     read from `style` (a getComputedStyle, or anything with
//     getPropertyValue), null for one that is not a colour. The values are
//     tokens of ui/safety/safety.css (SV2-72c), a categorical set clear of
//     the hues of --problem and --warning (EXIT_HUE_CLEAR), each 3:1 on the
//     corridor, the floor and the stairs; test/ui/exit-colours.test.mjs
//     holds them
//   exitColours(count, palette, fallback?) -> ['#rrggbb', …]
//     one colour an exit, in key order: the palette, repeated past its
//     length (the key says so; the number is the exit's identity); a token
//     that could not be read is `fallback` ('#808080' when not given)
//   EXIT_COUNT       8, the tokens there are
//   EXIT_HUE_CLEAR   40, the least OKLCh hue angle, in degrees, between an
//     exit's colour (one with chroma, EXIT_GREY or more) and --problem or
//     --warning in either theme. SV2-67b's set began with the presets' red,
//     on a safety map the problem colour: the first exit read as an alarm
//   EXIT_APART     the least OKLab distance between any two of the set in
//     either theme: 0.13 (SV2-67b's pair called alike was 0.121); the eight
//     are at least 0.147 apart (light) and 0.158 (dark)
//   oklab(colour) -> [L, a, b]   Björn Ottosson's OKLab, for that distance
//   apart(a, b) -> number        the OKLab distance between two colours
//   runsOf(route) -> [[{ floorId, cell }, …], …]
//     a route as runs of cells, one run a floor it crosses, cut where a
//     stairs connection is taken: the room cell it leaves by first
//
// The second half draws:
//
//   evacuationOverlay(read) -> (g, view, floor, theme) => {}   for map.overlays
//     read()   null, or { mode: 'all' | 'one',
//                         rooms: [{ roomId, floorId, cells, route, colour, number }],
//                         picked: roomId or null, lost }
//              rooms: every room with a way out (cells: the room's own
//              cells; route: routeToExit's; colour and number: its exit's in
//              the key). In 'one' only the picked room's entry is drawn; a
//              picked room with no way out is not among them, and is framed
//              in the problem colour from `lost`: { floorId, cells }
//   EXIT_KEY_LEAST   the zoom (px a cell) under which badges are not drawn

import { labelOn, parse } from '../../colour.js';

export const EXIT_KEY_LEAST = 10;

export const EXIT_COUNT = 8;

export const EXIT_APART = 0.13;

export const EXIT_HUE_CLEAR = 40;

// under this OKLCh chroma a colour is a grey, and has no hue to keep clear
export const EXIT_GREY = 0.04;

export function exitPalette(style) {
  const out = [];
  for (let n = 1; n <= EXIT_COUNT; n += 1) {
    const value = style && typeof style.getPropertyValue === 'function' ? String(style.getPropertyValue('--exit-' + n)).trim() : '';
    out.push(parse(value) ? value : null);
  }
  return out;
}

export function exitColours(count, palette, fallback) {
  const list = Array.isArray(palette) && palette.length > 0 ? palette : [];
  const other = fallback || '#808080';
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(list.length > 0 ? list[i % list.length] || other : other);
  return out;
}

function linear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function oklab(colour) {
  const c = parse(colour);
  if (!c) throw new TypeError('Not a colour this tool can read: ' + String(colour));
  const r = linear(c.r);
  const g = linear(c.g);
  const b = linear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function apart(a, b) {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function runsOf(route) {
  if (!route || !route.ok || !Array.isArray(route.cells)) return [];
  const runs = [];
  let run = route.from ? [route.from] : [];
  const cuts = new Set(route.connectionAt || []);
  route.cells.forEach((place, index) => {
    run.push(place);
    if (cuts.has(index)) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs.filter((each) => each.length > 0);
}

// ---- drawing

function middle(view, floor, cell) {
  const size = view.size;
  return { x: view.x + ((cell % floor.width) + 0.5) * size, y: view.y + (Math.floor(cell / floor.width) + 0.5) * size };
}

function traceRun(g, view, floor, run) {
  const first = middle(view, floor, run[0].cell);
  g.moveTo(first.x, first.y);
  for (let i = 1; i < run.length; i += 1) {
    const next = middle(view, floor, run[i].cell);
    g.lineTo(next.x, next.y);
  }
}

// a route's lines on this floor, with a light edge under them so a line
// shows on a room's fill and on a corridor of its own colour
function drawRoute(g, view, floor, route, colour, width, theme) {
  const runs = runsOf(route).filter((run) => run[0].floorId === floor.id);
  if (runs.length === 0) return;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  for (const run of runs) traceRun(g, view, floor, run);
  g.strokeStyle = theme.card;
  g.lineWidth = width + 2;
  g.stroke();
  g.beginPath();
  for (const run of runs) traceRun(g, view, floor, run);
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
}

// the room's cells framed inside their edge, cell by cell, so a room of any
// shape is followed
function frameRoom(g, view, floor, cells, colour, width) {
  const size = view.size;
  const mine = new Set(cells);
  const inset = width / 2 + 1;
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'square';
  g.beginPath();
  for (const cell of cells) {
    const x = cell % floor.width;
    const y = Math.floor(cell / floor.width);
    const left = view.x + x * size;
    const top = view.y + y * size;
    if (y === 0 || !mine.has(cell - floor.width)) {
      g.moveTo(left, top + inset);
      g.lineTo(left + size, top + inset);
    }
    if (y === floor.height - 1 || !mine.has(cell + floor.width)) {
      g.moveTo(left, top + size - inset);
      g.lineTo(left + size, top + size - inset);
    }
    if (x === 0 || !mine.has(cell - 1)) {
      g.moveTo(left + inset, top);
      g.lineTo(left + inset, top + size);
    }
    if (x === floor.width - 1 || !mine.has(cell + 1)) {
      g.moveTo(left + size - inset, top);
      g.lineTo(left + size - inset, top + size);
    }
  }
  g.stroke();
}

// the exit's number on the room's first cell (its top left as drawn)
function badge(g, view, floor, cells, colour, number, theme) {
  const size = view.size;
  if (size < EXIT_KEY_LEAST) return;
  const first = cells.reduce((best, cell) => (best === null || cell < best ? cell : best), null);
  if (first === null) return;
  const font = Math.round(Math.max(9, Math.min(14, size * 0.5)));
  const text = String(number);
  g.font = '600 ' + font + 'px ' + theme.font;
  const wide = Math.max(font + 4, Math.ceil(g.measureText(text).width) + 6);
  const high = font + 4;
  const left = Math.round(view.x + (first % floor.width) * size + 2);
  const top = Math.round(view.y + Math.floor(first / floor.width) * size + 2);
  g.fillStyle = colour;
  g.fillRect(left, top, wide, high);
  g.strokeStyle = theme.card;
  g.lineWidth = 1;
  g.strokeRect(left + 0.5, top + 0.5, wide - 1, high - 1);
  g.fillStyle = labelOn(colour, theme.ink, theme.paper);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, left + wide / 2, top + high / 2 + 0.5);
}

// the round mark at the door the walker leaves by, the square at the exit
function ends(g, view, floor, route, colour, theme) {
  const size = view.size;
  const r = Math.max(5, Math.min(12, size * 0.38));
  if (route.from && route.from.floorId === floor.id) {
    const at = middle(view, floor, route.from.cell);
    g.beginPath();
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
    g.fillStyle = colour;
    g.fill();
    g.strokeStyle = theme.card;
    g.lineWidth = 2;
    g.stroke();
  }
  if (route.exit && route.exit.floorId === floor.id) {
    const at = middle(view, floor, route.exit.cell);
    const side = r * 2;
    g.fillStyle = colour;
    g.fillRect(at.x - r, at.y - r, side, side);
    g.strokeStyle = theme.card;
    g.lineWidth = 2;
    g.strokeRect(at.x - r, at.y - r, side, side);
  }
}

export function evacuationOverlay(read) {
  return (g, view, floor, theme) => {
    const picture = read();
    if (!picture || !Array.isArray(picture.rooms)) return;
    const size = view.size;
    g.save();
    if (picture.mode === 'one') {
      const entry = picture.rooms.find((each) => each.roomId === picture.picked);
      if (entry) {
        const colour = theme.accent;
        drawRoute(g, view, floor, entry.route, colour, Math.max(3, Math.min(10, size * 0.32)), theme);
        if (entry.floorId === floor.id) frameRoom(g, view, floor, entry.cells, colour, Math.max(2, Math.min(4, size * 0.12)));
        ends(g, view, floor, entry.route, colour, theme);
      } else if (picture.lost && picture.lost.floorId === floor.id) {
        frameRoom(g, view, floor, picture.lost.cells, theme.problem, Math.max(2, Math.min(4, size * 0.12)));
      }
    } else {
      const width = Math.max(2, Math.min(6, size * 0.18));
      for (const entry of picture.rooms) drawRoute(g, view, floor, entry.route, entry.colour, width, theme);
      for (const entry of picture.rooms) {
        if (entry.floorId !== floor.id) continue;
        frameRoom(g, view, floor, entry.cells, entry.colour, Math.max(2, Math.min(4, size * 0.12)));
        badge(g, view, floor, entry.cells, entry.colour, entry.number, theme);
      }
    }
    g.restore();
  };
}
