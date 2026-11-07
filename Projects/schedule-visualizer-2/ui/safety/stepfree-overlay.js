// The Step-free view's marks, laid over a floor plan (DESIGN 13.6): each room's
// step-free way out in its exit's colour, a way to an area of refuge in the
// accent, dashed, a room with no step-free way framed in the problem colour,
// and each way's end labelled in words ("East Door", "Area of refuge 2").
//
// The routes are engine/evacuation.js's stepFreeWaysOut, worked out by the
// section (./model.js); nothing here routes. A step-free way keeps to one floor
// (stairs and elevators are shut), so nothing here draws between floors. The
// plain evacuation overlay (ui/surface/overlays/evacuation.js) is not touched:
// this is the section's own drawing.
//
//   stepFreeOverlay(read) -> (g, view, floor, theme) => {}   for plan.overlays
//     read()  null, or { picked: roomId | null, rooms: [{ roomId, floorId, cells,
//             way: 'exit' | 'refuge' | 'none', route, colour, mark }], ends: [{ floorId,
//             cell, label, colour, kind: 'exit' | 'refuge' }] }
//             `mark` is what the room's badge says without its colour: the exit's number,
//             "R" for a refuge, "×" for none. With a room picked only its way is drawn
//             (and the ends it uses); without, every room's.
//   END_LABEL_LEAST   the zoom (px a cell) under which labels and badges are not drawn
//   endsOf(rooms, project, colourOf) -> [{ id, floorId, cell, label, colour, kind }]
//             the distinct ends of the rooms' ways, for `read().ends`; colourOf(room) is the
//             colour a room's way is drawn in (the accent for a refuge)

import { runsOf } from '../surface/overlays/evacuation.js';

export const END_LABEL_LEAST = 8;

export function endsOf(rooms, project, colourOf) {
  const out = new Map();
  const floors = new Map(project.building.floors.map((floor) => [floor.id, floor]));
  for (const room of rooms) {
    if (room.way === 'none' || !room.route) continue;
    if (room.way === 'exit') {
      if (out.has(room.exitId)) continue;
      const exit = room.route.exit;
      out.set(room.exitId, { id: room.exitId, floorId: exit.floorId, cell: exit.cell, label: room.exitName || 'Exit', colour: colourOf(room), kind: 'exit' });
    } else {
      if (out.has(room.refugeId)) continue;
      const target = room.route.target;
      const floor = floors.get(target.floorId);
      if (!floor) continue;
      out.set(room.refugeId, { id: room.refugeId, floorId: target.floorId, cell: target.cell, label: room.refugeName || 'Area of refuge', colour: colourOf(room), kind: 'refuge' });
    }
  }
  return Array.from(out.values());
}

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

// a route's lines on this floor, a light edge under them; `dash` is the pattern of a way to a refuge
function drawWay(g, view, floor, route, colour, width, theme, dash) {
  const runs = runsOf(route).filter((run) => run[0].floorId === floor.id);
  if (runs.length === 0) return;
  g.lineJoin = 'round';
  g.lineCap = dash ? 'butt' : 'round';
  g.setLineDash([]);
  g.beginPath();
  for (const run of runs) traceRun(g, view, floor, run);
  g.strokeStyle = theme.card;
  g.lineWidth = width + 2;
  g.stroke();
  if (dash) g.setLineDash([width * 2.2, width * 1.6]);
  g.beginPath();
  for (const run of runs) traceRun(g, view, floor, run);
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
  g.setLineDash([]);
}

function frameRoom(g, view, floor, cells, colour, width, dash) {
  const size = view.size;
  const mine = new Set(cells);
  const inset = width / 2 + 1;
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineCap = 'butt';
  g.setLineDash(dash ? [width * 2.2, width * 1.6] : []);
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
  g.setLineDash([]);
}

// the badge on the room's first cell: the exit's number, R, or ×; in a mark of its own colour
function badge(g, view, floor, cells, colour, text, theme, labelOn) {
  const size = view.size;
  if (size < END_LABEL_LEAST) return;
  const first = cells.reduce((best, cell) => (best === null || cell < best ? cell : best), null);
  if (first === null) return;
  const font = Math.round(Math.max(9, Math.min(14, size * 0.5)));
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

// the round mark at the door the walker leaves by
function start(g, view, floor, route, colour, theme) {
  if (!route || !route.from || route.from.floorId !== floor.id) return;
  const r = Math.max(5, Math.min(12, view.size * 0.38));
  const at = middle(view, floor, route.from.cell);
  g.beginPath();
  g.arc(at.x, at.y, r, 0, Math.PI * 2);
  g.fillStyle = colour;
  g.fill();
  g.strokeStyle = theme.card;
  g.lineWidth = 2;
  g.stroke();
}

// an end: a square for an exit, a rounded square outline for a refuge, and its name in words on a halo
function drawEnd(g, view, floor, end, theme) {
  const size = view.size;
  const r = Math.max(5, Math.min(12, size * 0.38));
  const at = middle(view, floor, end.cell);
  if (end.kind === 'exit') {
    g.fillStyle = end.colour;
    g.fillRect(at.x - r, at.y - r, r * 2, r * 2);
    g.strokeStyle = theme.card;
    g.lineWidth = 2;
    g.strokeRect(at.x - r, at.y - r, r * 2, r * 2);
  } else {
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(at.x - r, at.y - r, r * 2, r * 2, r * 0.45);
    else g.rect(at.x - r, at.y - r, r * 2, r * 2);
    g.fillStyle = theme.card;
    g.fill();
    g.strokeStyle = end.colour;
    g.lineWidth = 3;
    g.stroke();
  }
  if (size < END_LABEL_LEAST || !end.label) return;
  const font = Math.round(Math.max(10, Math.min(13, size * 0.45)));
  g.font = '600 ' + font + 'px ' + theme.font;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  const y = at.y - r - 3;
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = theme.card;
  g.strokeText(end.label, at.x, y);
  g.fillStyle = theme.ink;
  g.fillText(end.label, at.x, y);
}

export function stepFreeOverlay(read, labelOn) {
  return (g, view, floor, theme) => {
    const picture = read();
    if (!picture || !Array.isArray(picture.rooms)) return;
    const size = view.size;
    g.save();
    const picked = picture.picked ? picture.rooms.find((each) => each.roomId === picture.picked) : null;
    const shown = picked ? [picked] : picture.rooms;
    const width = picked ? Math.max(3, Math.min(10, size * 0.32)) : Math.max(2, Math.min(6, size * 0.18));
    for (const room of shown) {
      if (room.way === 'none' || !room.route) continue;
      const colour = room.way === 'refuge' ? theme.accent : room.colour;
      drawWay(g, view, floor, room.route, colour, width, theme, room.way === 'refuge');
    }
    for (const room of shown) {
      if (room.floorId !== floor.id) continue;
      const frame = Math.max(2, Math.min(4, size * 0.12));
      if (room.way === 'none') {
        frameRoom(g, view, floor, room.cells, theme.problem, frame, false);
        if (!picked) badge(g, view, floor, room.cells, theme.problem, '×', theme, labelOn);
      } else {
        const colour = room.way === 'refuge' ? theme.accent : room.colour;
        frameRoom(g, view, floor, room.cells, colour, frame, room.way === 'refuge');
        if (!picked) badge(g, view, floor, room.cells, colour, room.mark, theme, labelOn);
      }
    }
    if (picked) start(g, view, floor, picked.route, picked.way === 'refuge' ? theme.accent : picked.colour, theme);
    const used = picked ? new Set([picked.way === 'exit' ? picked.exitId : picked.refugeId]) : null;
    for (const end of picture.ends || []) {
      if (end.floorId !== floor.id) continue;
      if (used && !used.has(end.id)) continue;
      drawEnd(g, view, floor, end, theme);
    }
    g.restore();
  };
}
