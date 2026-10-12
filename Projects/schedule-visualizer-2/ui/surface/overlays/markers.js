// The moving markers of playback (spec 8.1), drawn over the movement map:
// one marker a group, where the head of its column is at this second.
//
// Where a group is comes from the crowd model's `positions` and nothing else
// (ARCHITECTURE 6.3): positions[t] is the head's index along its path once
// tick t has been played, −1 in the room it leaves, `slots` and above once it
// is in the room it walks to. The index goes on counting after that, one a
// step, while the column behind the head follows it in, up to
// `slots + length − 1` when the tail is in the room: headAt gives it as the
// model has it, so coveredBy knows which cells the column has left. Only
// where a point is placed (placeAt) is an index at or past `slots` the room.
// Nothing here walks a group; it only reads.
//
//   trackOf(graph, route, path)    where each index of a path is on the map
//   headAt(positions, seconds, step, slots)   -> { index, u }: the head is u
//                                  of the way from `index` to the next index
//                                  (`slots` is not read: nothing is clamped here)
//   stairPoint(a, b, u)            a point along a stairs link's arc
//   pointOn(track, index, u, map)  the head's place in pixels, or null
//   coveredBy(track, head, length, floorId, cell)   is the column on this cell?
//   markersMark(read)              the entry for env.marks: (g, map) => {}
//
// A track:
//
//   { slots,        how many indexes the path has
//     from, to,     { floorId, cell }: the room cell left and the one arrived in
//     places }      one an index: { floorId, cell } for a corridor or stairs
//                   cell, or { a, b, u } on a stairs connection: u of the way
//                   from the end left (a) to the end arrived at (b)
//
// A step takes `step` seconds (the school's seconds per cell). Between two
// steps the marker walks from the middle of one cell to the middle of the
// next during the `step` seconds before the head takes the next slot; a group
// that is refused its step stands in the middle of its cell until then. So
// at a whole second on which the head has just stepped, the marker is on the
// middle of the cell positions[] names.
//
// What `read()` gives the mark, or null when nothing is played:
//
//   { step, style: 'tail' | 'route', size: 'small' | 'large',
//     walkers: [{ groupId, colour, track, positions, seconds, late }] }
//
// `seconds` is each walker's own clock into the transition (they differ only
// when the groups walk one after another). After a draw, `mark.drawn` holds
// where each marker was put: groupId -> { x, y, late, state, radius }, with
// state 'waiting' (in the room it leaves), 'walking', 'stairs' or 'arrived'.

import { parse, readable } from '../../colour.js';

// How much of its walk a fading tail shows, in steps, and in how many pieces.
export const TAIL_STEPS = 4;
export const TAIL_PIECES = 10;
// A marker's radius in cells, and the least it is in pixels.
export const MARKER_SIZES = { small: { cells: 0.24, least: 3.5 }, large: { cells: 0.4, least: 6 } };

// The arc of a stairs link bows to the left of the way from one end to the
// other, as drawStairLink draws it (lanes.js): the marker rides the dots.
export function stairPoint(a, b, u) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bow = Math.min(60, length * 0.2);
  const mx = (a.x + b.x) / 2 + (dy / length) * bow;
  const my = (a.y + b.y) / 2 - (dx / length) * bow;
  const v = 1 - u;
  return { x: v * v * a.x + 2 * v * u * mx + u * u * b.x, y: v * v * a.y + 2 * v * u * my + u * u * b.y };
}

export function trackOf(graph, route, path) {
  if (!graph || !route || !path) return null;
  const cellOf = (node) => ({ floorId: graph.floors[graph.nodeFloor[node]].id, cell: graph.nodeCell[node] });
  const places = new Array(path.length);
  for (let p = 0; p < path.length; p += 1) {
    if (path.links[p] === -1) {
      places[p] = cellOf(path.nodes[p]);
      continue;
    }
    // a run of stairs slots: from the cell before it to the cell after it
    let end = p;
    while (end < path.length && path.links[end] !== -1) end += 1;
    if (p === 0 || end >= path.length) return null;
    const a = cellOf(path.nodes[p - 1]);
    const b = cellOf(path.nodes[end]);
    for (let j = p; j < end; j += 1) places[j] = { a, b, u: (j - p + 1) / (end - p + 1) };
    p = end - 1;
  }
  return {
    slots: path.length,
    from: route.from ? { floorId: route.from.floorId, cell: route.from.cell } : places[0],
    to: route.to ? { floorId: route.to.floorId, cell: route.to.cell } : places[path.length - 1],
    places,
  };
}

export function headAt(positions, seconds, step, slots) {
  const last = positions.length - 1;
  if (last < 0) return { index: -1, u: 0 };
  const t = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, last));
  const tick = Math.floor(t);
  const index = positions[tick];
  // the tick on which the head takes the next slot, or, once it is in the
  // room, the tick on which the column behind it takes its next step in
  let next = tick + 1;
  while (next <= last && positions[next] === index) next += 1;
  if (next > last) return { index, u: 0 };
  const start = next - step;
  return { index, u: t <= start ? 0 : Math.min(1, (t - start) / step) };
}

function placeAt(track, index) {
  if (index < 0) return track.from;
  if (index >= track.slots) return track.to;
  return track.places[index];
}

// A place in pixels. On the stairs with one end off the map, the end that is
// on it stands for the connection.
function pixelOf(place, map) {
  if (!place) return null;
  if (!place.a) return map.point(place.floorId, place.cell);
  const a = map.point(place.a.floorId, place.a.cell);
  const b = map.point(place.b.floorId, place.b.cell);
  if (a && b) return stairPoint(a, b, place.u);
  return a || b;
}

export function pointOn(track, index, u, map) {
  const here = pixelOf(placeAt(track, index), map);
  if (!(u > 0)) return here;
  const there = pixelOf(placeAt(track, index + 1), map);
  if (!here || !there) return here || there;
  return { x: here.x + (there.x - here.x) * u, y: here.y + (there.y - here.y) * u };
}

function stateOf(track, head) {
  if (head.index < 0) return 'waiting';
  if (head.index >= track.slots) return 'arrived';
  return track.places[head.index].a ? 'stairs' : 'walking';
}

// Is any part of a column `length` slots long, with its head here, on this
// cell? A head more than half way through its step is counted on the cell it
// is stepping onto, which is where its marker is seen.
export function coveredBy(track, head, length, floorId, cell) {
  const front = head.index + (head.u >= 0.5 ? 1 : 0);
  for (let index = Math.min(front, track.slots - 1); index > front - length && index >= 0; index -= 1) {
    const place = track.places[index];
    if (!place.a && place.floorId === floorId && place.cell === cell) return true;
  }
  return false;
}

function line(g, points, colour, width, alpha) {
  let open = false;
  g.beginPath();
  for (const point of points) {
    if (!point) {
      open = false;
    } else if (open) {
      g.lineTo(point.x, point.y);
    } else {
      g.moveTo(point.x, point.y);
      open = true;
    }
  }
  g.globalAlpha = alpha;
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.stroke();
  g.globalAlpha = 1;
}

// The whole of the route walked so far: from the room, through every index
// the head has passed, to where the head is.
function drawRoute(g, map, walker, head, at, radius) {
  const points = [pixelOf(walker.track.from, map)];
  for (let index = 0; index <= Math.min(head.index, walker.track.slots - 1); index += 1) points.push(pixelOf(walker.track.places[index], map));
  points.push(at);
  line(g, points, walker.shade, Math.max(2, radius * 0.9), 0.6);
}

// The last few steps of the walk, fading away behind the marker.
function drawTail(g, map, walker, at, radius, step) {
  const reach = TAIL_STEPS * step;
  let before = at;
  for (let piece = 1; piece <= TAIL_PIECES; piece += 1) {
    const seconds = walker.seconds - (reach * piece) / TAIL_PIECES;
    if (seconds < 0) break;
    const head = headAt(walker.positions, seconds, step, walker.track.slots);
    const point = pointOn(walker.track, head.index, head.u, map);
    if (!point) break;
    const fade = 1 - piece / (TAIL_PIECES + 1);
    line(g, [before, point], walker.shade, Math.max(1.5, radius * 1.3 * fade), 0.75 * fade);
    before = point;
  }
}

// The marker itself. A group on time is a disc; a late one is a diamond with
// a rim in the problem colour and a mark in its middle, so late does not rest
// on colour. In a room (not yet left, or arrived) it is hollow.
function drawHead(g, at, radius, walker, state, theme) {
  const hollow = state === 'waiting' || state === 'arrived';
  const r = walker.late ? radius * 1.25 : radius;
  g.beginPath();
  if (walker.late) {
    g.moveTo(at.x, at.y - r);
    g.lineTo(at.x + r, at.y);
    g.lineTo(at.x, at.y + r);
    g.lineTo(at.x - r, at.y);
    g.closePath();
  } else {
    g.arc(at.x, at.y, r, 0, Math.PI * 2);
  }
  g.fillStyle = hollow ? theme.card : walker.shade;
  g.fill();
  g.lineJoin = 'round';
  if (walker.late) {
    g.strokeStyle = theme.card;
    g.lineWidth = 4.5;
    g.stroke();
    g.strokeStyle = theme.problem;
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = hollow ? theme.problem : theme.card;
    g.fillRect(at.x - 1, at.y - r * 0.5, 2, r * 0.6);
    g.fillRect(at.x - 1, at.y + r * 0.25, 2, 2);
  } else {
    g.strokeStyle = hollow ? walker.shade : theme.card;
    g.lineWidth = hollow ? 2 : 1.5;
    g.stroke();
    if (!hollow) {
      g.beginPath();
      g.arc(at.x, at.y, r + 1.25, 0, Math.PI * 2);
      g.strokeStyle = theme.ink;
      g.lineWidth = 1;
      g.stroke();
    }
  }
}

export function markersMark(read) {
  const shades = new Map();
  // A group's colour as a marker: its own, strengthened where it would not
  // show on a corridor of this theme.
  function shadeOf(colour, theme) {
    const key = colour + ':' + theme.corridor;
    if (!shades.has(key)) shades.set(key, parse(colour) ? readable(colour, theme.corridor, 3) : theme.ink2);
    return shades.get(key);
  }

  function mark(g, map) {
    mark.drawn = new Map();
    const scene = read();
    if (!scene) return;
    const size = MARKER_SIZES[scene.size] || MARKER_SIZES.small;
    const radius = Math.max(size.least, map.view.size * size.cells);
    const walkers = [];
    for (const walker of scene.walkers) {
      const head = headAt(walker.positions, walker.seconds, scene.step, walker.track.slots);
      const at = pointOn(walker.track, head.index, head.u, map);
      if (!at) continue;
      walkers.push({ ...walker, head, at, state: stateOf(walker.track, head), shade: shadeOf(walker.colour, map.theme) });
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // every trail first, so no marker is under another group's trail
    for (const walker of walkers) {
      if (walker.state === 'waiting') continue;
      if (scene.style === 'route') drawRoute(g, map, walker, walker.head, walker.at, radius);
      else if (walker.state !== 'arrived') drawTail(g, map, walker, walker.at, radius, scene.step);
    }
    for (const walker of walkers) {
      drawHead(g, walker.at, radius, walker, walker.state, map.theme);
      mark.drawn.set(walker.groupId, { x: walker.at.x, y: walker.at.y, late: walker.late === true, state: walker.state, radius });
    }
  }
  mark.drawn = new Map();
  return mark;
}
