// Route lanes, load colouring and room markers, laid over a floor plan
// (spec 7.2, 7.3; DESIGN 5.3). The renderer draws the plan; this draws what
// the movement view adds, through the renderer's `overlays` hook.
//
// The lanes. Every group's route is a line in the group's colour along the
// corridors. A line keeps to the right of the way it is going, so two flows
// going opposite ways along one corridor are on opposite sides of it. Groups
// sharing a stretch are parallel lanes, the group that comes first in the
// project nearest the middle, so the order never changes when a group is
// added to the picture or taken off it. One lane is `pitch` of a cell wide,
// and the pitch is set by the fullest stretch of the whole picture, so the
// busiest corridor's bundle still fits in its half of the cell.
//
// The first half of this file is arithmetic with no canvas in it, and runs
// in Node:
//
//   buildLanes(project, entries) -> lanes
//     entries   [{ groupId, rank, route }]: a found route of routing.js and
//               the group's place in the project's list
//     lanes     { pitch, most,
//                 floors: Map floorId -> [{ groupId, rank, points: [x, y, x, y, …] }],
//                 at:     Map "groupId|floorId|cell" -> [x, y], a point of the group's lane in that cell,
//                 links:  Map connectionId -> [groupId, …] }
//     Points are in cells: (3.5, 7.5) is the middle of cell (3, 7).
//
//   laneOffset(lanes, index)   how far from the middle line lane `index` runs, in cells
//   lanePoint(lanes, groupId, floorId, cell)   [x, y] or null
//
// The second half draws:
//
//   lanesOverlay(read) -> (g, view, floor, theme) => {}   for scene.overlays
//     read()   { bands: Map floorId -> Uint8Array, lanes, colourOf(groupId),
//                markers: Map floorId -> [{ box, pills: [{ colour, text }] }],
//                constantWidth, labels, bandColours: [5 colours] } or null
//   drawStairLink(g, from, to, options)   the dotted arc between two stairs
//   BAND_EXCLUDED   the value in `bands` for a cell inside an exclusion zone

import { parse, labelOn } from '../../colour.js';
import { CELL_STAIRS } from '../../../engine/schema.js';

// Cells between the middle line of a corridor and its first lane.
export const LANE_GAP = 0.06;
// How far from the middle line a bundle may reach. The rest of the cell, a
// strip along each wall, stays clear, so the load colour under the lanes
// shows however many groups walk there.
export const LANE_REACH = 0.34;
// The widest one lane is drawn, in cells.
export const MAX_PITCH = 0.1;
// The width of a line, in pixels, when it is kept constant.
export const CONSTANT_WIDTH = 2.5;
export const BAND_EXCLUDED = 255;

function headingOf(dx, dy) {
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === 0) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 0) return 3;
  return -1;
}

// The unit step of each heading (north, east, south, west), and the side
// that is on the right of someone walking that way: for (dx, dy) it is
// (−dy, dx), with y growing down the screen.
const STEP = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const RIGHT = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// A route as runs of cells, one run a floor it crosses: the room cell it
// leaves, the corridor cells, the room cell it ends in, cut wherever a
// stairs connection is taken.
function runsOf(route) {
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
  if (route.to) run.push(route.to);
  runs.push(run);
  return runs;
}

// The steps of a run that go from a cell to one beside it: [{ x, y, cell, heading }]
// for the cell stepped from, and the last cell with no heading. A run is cut
// where two cells are not neighbours (it cannot happen on a real route).
function stepsOf(run, width) {
  const pieces = [];
  let piece = [];
  for (let i = 0; i < run.length; i += 1) {
    const x = run[i].cell % width;
    const y = Math.floor(run[i].cell / width);
    let heading = -1;
    if (i + 1 < run.length) heading = headingOf((run[i + 1].cell % width) - x, Math.floor(run[i + 1].cell / width) - y);
    piece.push({ x, y, cell: run[i].cell, heading });
    if (heading === -1) {
      if (piece.length > 1) pieces.push(piece);
      piece = [];
    }
  }
  return pieces;
}

export function laneOffset(lanes, index) {
  return LANE_GAP + (index + 0.5) * lanes.pitch;
}

export function buildLanes(project, entries) {
  const widthOf = new Map(project.building.floors.map((floor) => [floor.id, floor.width]));
  // every step of every route, and who takes each directed step
  const users = new Map();
  const walks = [];
  const links = new Map();
  const seen = new Set();
  // The walks are taken in an order of their own (the project's order of
  // groups, then the walk), never the order they were given in: which of a
  // group's two walks through a cell gives the cell its lane point, and
  // which line is drawn over which, must not change when a transition is
  // taken off the picture and put back.
  const ordered = [];
  for (const entry of entries) {
    const route = entry.route;
    if (!route || route.ok !== true || route.same === true || !Array.isArray(route.cells) || route.cells.length === 0) continue;
    // the same walk in two transitions is one line
    ordered.push({ entry, once: entry.groupId + '|' + route.fromRoomId + '|' + route.toRoomId + '|' + route.cells.length + '|' + (route.connections || []).join(',') });
  }
  ordered.sort((a, b) => a.entry.rank - b.entry.rank || (a.once < b.once ? -1 : a.once > b.once ? 1 : 0));
  for (const { entry, once } of ordered) {
    const route = entry.route;
    for (const id of route.connections || []) {
      if (!links.has(id)) links.set(id, []);
      if (!links.get(id).includes(entry.groupId)) links.get(id).push(entry.groupId);
    }
    if (seen.has(once)) continue;
    seen.add(once);
    for (const run of runsOf(route)) {
      if (run.length === 0) continue;
      const floorId = run[0].floorId;
      const width = widthOf.get(floorId);
      if (!width) continue;
      for (const piece of stepsOf(run, width)) {
        for (let j = 0; j + 1 < piece.length; j += 1) {
          const key = floorId + ':' + piece[j].cell + ':' + piece[j].heading;
          if (!users.has(key)) users.set(key, new Set());
          users.get(key).add(entry.rank);
        }
        walks.push({ groupId: entry.groupId, rank: entry.rank, floorId, piece });
      }
    }
  }

  let most = 0;
  const order = new Map();
  for (const [key, ranks] of users) {
    const sorted = Array.from(ranks).sort((a, b) => a - b);
    order.set(key, sorted);
    if (sorted.length > most) most = sorted.length;
  }
  const lanes = { pitch: most === 0 ? MAX_PITCH : Math.min(MAX_PITCH, (LANE_REACH - LANE_GAP) / most), most, floors: new Map(), at: new Map(), links };

  for (const walk of walks) {
    const { piece, floorId } = walk;
    const offsets = [];
    for (let j = 0; j + 1 < piece.length; j += 1) {
      offsets.push(laneOffset(lanes, order.get(floorId + ':' + piece[j].cell + ':' + piece[j].heading).indexOf(walk.rank)));
    }
    const points = [];
    const put = (j, x, y) => {
      points.push(x, y);
      const key = walk.groupId + '|' + floorId + '|' + piece[j].cell;
      if (j > 0 && j < piece.length - 1 && !lanes.at.has(key)) lanes.at.set(key, [x, y]);
    };
    const last = piece.length - 1;
    for (let j = 0; j <= last; j += 1) {
      const cx = piece[j].x + 0.5;
      const cy = piece[j].y + 0.5;
      const before = j > 0 ? piece[j - 1].heading : -1;
      const after = j < last ? piece[j].heading : -1;
      if (before === -1 || after === -1) {
        // an end: beside the middle of the cell, on the lane of its one step
        const heading = before === -1 ? after : before;
        const off = before === -1 ? offsets[0] : offsets[last - 1];
        put(j, cx + RIGHT[heading][0] * off, cy + RIGHT[heading][1] * off);
      } else if (before === after) {
        const a = offsets[j - 1];
        const b = offsets[j];
        if (a === b) {
          put(j, cx + RIGHT[after][0] * a, cy + RIGHT[after][1] * a);
        } else {
          // the bundle is fuller or thinner from here: the lane moves over inside this cell
          put(j, cx - STEP[after][0] * 0.25 + RIGHT[after][0] * a, cy - STEP[after][1] * 0.25 + RIGHT[after][1] * a);
          points.push(cx + STEP[after][0] * 0.25 + RIGHT[after][0] * b, cy + STEP[after][1] * 0.25 + RIGHT[after][1] * b);
        }
      } else if ((before + 2) % 4 === after) {
        // straight back the way it came
        put(j, cx + RIGHT[before][0] * offsets[j - 1], cy + RIGHT[before][1] * offsets[j - 1]);
        points.push(cx + RIGHT[after][0] * offsets[j], cy + RIGHT[after][1] * offsets[j]);
      } else {
        // a turn: where the lane coming in meets the lane going out
        put(j, cx + RIGHT[before][0] * offsets[j - 1] + RIGHT[after][0] * offsets[j], cy + RIGHT[before][1] * offsets[j - 1] + RIGHT[after][1] * offsets[j]);
      }
    }
    if (!lanes.floors.has(floorId)) lanes.floors.set(floorId, []);
    lanes.floors.get(floorId).push({ groupId: walk.groupId, rank: walk.rank, points });
  }
  // drawn in the project's order, so which line is on top never depends on the choice
  for (const list of lanes.floors.values()) list.sort((a, b) => a.rank - b.rank);
  return lanes;
}

export function lanePoint(lanes, groupId, floorId, cell) {
  return lanes.at.get(groupId + '|' + floorId + '|' + cell) || null;
}

// ---------------------------------------------------------------- drawing

// The width of one line in pixels at this zoom.
export function lineWidth(lanes, size, constant) {
  if (constant) return CONSTANT_WIDTH;
  return Math.max(1, lanes.pitch * size * 0.8);
}

function drawBands(g, view, floor, bands, colours) {
  const seen = view.visible(floor);
  const size = view.size;
  const X = (column) => Math.round(view.x + column * size);
  const Y = (row) => Math.round(view.y + row * size);
  const frame = Math.max(2, Math.round(size / 6));
  for (let y = seen.y0; y < seen.y1; y += 1) {
    let start = -1;
    let kind = 0;
    for (let x = seen.x0; x <= seen.x1; x += 1) {
      const cell = y * floor.width + x;
      let now = x < seen.x1 ? bands[cell] : 0;
      if (now === BAND_EXCLUDED) now = 0;
      // a stairs cell keeps its letter: it gets a frame, below
      const stairs = now !== 0 && floor.cells[cell] === CELL_STAIRS;
      if (stairs) {
        g.fillStyle = colours[now - 1];
        const left = X(x);
        const top = Y(y);
        const w = X(x + 1) - left;
        const h = Y(y + 1) - top;
        g.fillRect(left, top, w, frame);
        g.fillRect(left, top + h - frame, w, frame);
        g.fillRect(left, top, frame, h);
        g.fillRect(left + w - frame, top, frame, h);
        now = 0;
      }
      if (now !== kind) {
        if (kind !== 0) {
          g.fillStyle = colours[kind - 1];
          g.fillRect(X(start), Y(y), X(x) - X(start), Y(y + 1) - Y(y));
        }
        start = x;
        kind = now;
      }
    }
  }
}

// The corridor names again, over the load colouring, with a light edge so
// they read on any band.
function drawNames(g, view, floor, theme) {
  const size = view.size;
  if (size < 12) return;
  const seen = view.visible(floor);
  const nameSize = Math.min(13, Math.max(9, Math.round(size * 0.5)));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (const corridor of floor.corridors) {
    if (corridor.cells.length === 0 || corridor.name === '') continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (const cell of corridor.cells) {
      const x = cell % floor.width;
      const y = Math.floor(cell / floor.width);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < seen.x0 || x0 >= seen.x1 || y1 < seen.y0 || y0 >= seen.y1) continue;
    const across = x1 - x0 >= y1 - y0;
    const text = corridor.name.toUpperCase();
    g.font = '500 ' + nameSize + 'px ' + theme.font;
    if ('letterSpacing' in g) g.letterSpacing = '0.08em';
    if (g.measureText(text).width <= ((across ? x1 - x0 : y1 - y0) + 1) * size - 8) {
      g.save();
      g.translate(view.x + ((x0 + x1 + 1) / 2) * size, view.y + ((y0 + y1 + 1) / 2) * size);
      if (!across) g.rotate(-Math.PI / 2);
      g.strokeStyle = theme.card;
      g.lineWidth = 3;
      g.strokeText(text, 0, 0.5);
      g.fillStyle = theme.ink;
      g.fillText(text, 0, 0.5);
      g.restore();
    }
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  }
}

function trace(g, view, points) {
  const size = view.size;
  g.moveTo(view.x + points[0] * size, view.y + points[1] * size);
  for (let i = 2; i < points.length; i += 2) g.lineTo(view.x + points[i] * size, view.y + points[i + 1] * size);
}

function drawLines(g, view, list, lanes, colourOf, constant, theme) {
  const width = lineWidth(lanes, view.size, constant);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // a light edge under every line first, so a line shows on a band of its own colour
  if (width >= 2) {
    g.beginPath();
    for (const lane of list) trace(g, view, lane.points);
    g.strokeStyle = theme.card;
    g.globalAlpha = 0.7;
    g.lineWidth = width + 1.5;
    g.stroke();
    g.globalAlpha = 1;
  }
  let colour = null;
  for (const lane of list) {
    const next = colourOf(lane.groupId);
    if (next !== colour) {
      if (colour !== null) g.stroke();
      colour = next;
      g.beginPath();
      g.strokeStyle = colour;
      g.lineWidth = width;
    }
    trace(g, view, lane.points);
  }
  if (colour !== null) g.stroke();
}

// A marker for each group a room sees, with the periods it is there: small
// pills from the room's top left corner, a row at a time, and "+3" when the
// room has no space for the rest. Dots when the labels are off or too small.
function drawMarkers(g, view, floor, markers, labels, theme) {
  const size = view.size;
  const seen = view.visible(floor);
  const font = Math.round(Math.min(13, size * 0.42));
  const words = labels && font >= 9;
  const high = words ? font + 4 : Math.max(4, Math.min(8, Math.round(size * 0.3)));
  const gap = 2;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '600 ' + font + 'px ' + theme.font;
  for (const marker of markers) {
    const box = marker.box;
    if (box.x1 <= seen.x0 || box.x0 >= seen.x1 || box.y1 <= seen.y0 || box.y0 >= seen.y1) continue;
    const left = view.x + box.x0 * size + 3;
    const right = view.x + box.x1 * size - 3;
    const bottom = view.y + box.y1 * size - 3;
    let x = left;
    let y = view.y + box.y0 * size + 3;
    for (let i = 0; i < marker.pills.length; i += 1) {
      const pill = marker.pills[i];
      const wide = words ? Math.ceil(g.measureText(pill.text).width) + 8 : high;
      if (x + wide > right && x > left) {
        x = left;
        y += high + gap;
      }
      const rest = marker.pills.length - i;
      if (y + high > bottom && i > 0) {
        // no room for the rest: say how many
        if (words) {
          g.fillStyle = theme.ink;
          g.fillText('+' + rest, Math.min(x, right - g.measureText('+' + rest).width), y - gap - high / 2 + 0.5);
        }
        break;
      }
      const fill = parse(pill.colour) ? pill.colour : theme.ink2;
      g.fillStyle = fill;
      g.beginPath();
      if (words) g.rect(Math.round(x), Math.round(y), wide, high);
      else g.arc(x + high / 2, y + high / 2, high / 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = theme.card;
      g.lineWidth = 1;
      g.stroke();
      if (words) {
        g.fillStyle = labelOn(fill, theme.ink, theme.paper);
        g.fillText(pill.text, Math.round(x) + 4, Math.round(y) + high / 2 + 0.5);
      }
      x += wide + gap;
    }
  }
}

export function lanesOverlay(read) {
  return (g, view, floor, theme) => {
    const picture = read();
    if (!picture) return;
    const bands = picture.bands ? picture.bands.get(floor.id) : null;
    if (bands) {
      drawBands(g, view, floor, bands, picture.bandColours);
      drawNames(g, view, floor, theme);
    }
    const list = picture.lanes ? picture.lanes.floors.get(floor.id) : null;
    if (list && list.length > 0) drawLines(g, view, list, picture.lanes, picture.colourOf, picture.constantWidth === true, theme);
    const markers = picture.markers ? picture.markers.get(floor.id) : null;
    if (markers && markers.length > 0) drawMarkers(g, view, floor, markers, picture.labels !== false, theme);
  };
}

// The link between the two ends of a stairs connection in use: a dotted arc
// from one stairs cell to the other, wherever on the window each is.
//   from, to   { x, y } in pixels; `to` may be null when the other end is on
//              a floor that is not on screen: the arc then leaves upward and
//              `options.text` says where it goes
//   options    { colour, edge, width, text, font, ink }
export function drawStairLink(g, from, to, options) {
  const width = options.width || 2;
  const end = to || { x: from.x + 34, y: from.y - 26 };
  const dx = end.x - from.x;
  const dy = end.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  // the arc bows to the left of the way from → to, by a fifth of its length at most
  const bow = Math.min(60, length * 0.2);
  const mx = (from.x + end.x) / 2 + (dy / length) * bow;
  const my = (from.y + end.y) / 2 - (dx / length) * bow;
  g.save();
  g.lineCap = 'round';
  for (const pass of ['edge', 'colour']) {
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.quadraticCurveTo(mx, my, end.x, end.y);
    g.setLineDash([0.01, width * 2.6]);
    g.strokeStyle = options[pass];
    g.lineWidth = pass === 'edge' ? width + 2 : width;
    g.stroke();
  }
  g.setLineDash([]);
  for (const point of to ? [from, end] : [from]) {
    g.beginPath();
    g.arc(point.x, point.y, width + 1.5, 0, Math.PI * 2);
    g.fillStyle = options.colour;
    g.fill();
    g.strokeStyle = options.edge;
    g.lineWidth = 1;
    g.stroke();
  }
  if (!to && options.text) {
    g.font = '600 11px ' + options.font;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = options.edge;
    g.lineWidth = 3;
    g.strokeText(options.text, end.x + 5, end.y);
    g.fillStyle = options.ink;
    g.fillText(options.text, end.x + 5, end.y);
  }
  g.restore();
}
