// navgraph.js — the building, read as somewhere to walk.
//
// Phase 6's first module, and the one the rest of it stands on. Nothing here
// is new information: a room is already a flood-fill region or a polygon, a
// doorway is already a hole in a boundary, a stair already knows which two
// storeys it joins. What was missing was the sentence that connects them —
// *this room opens into that one, through here, and it is this far* — and that
// sentence is a graph.
//
// So this is a reader, in the same sense `blueprint.js` and `acoustics.js` are
// readers: it derives, it never stores, and re-deriving it after an edit is the
// whole of keeping it correct. There is no `state.nav`.
//
// **Rooms are hubs, doorways are nodes.** The graph is the classic portal
// graph with one addition: every room contributes a hub node at an interior
// point, and its doorways connect through the hub rather than to each other.
// That costs a little accuracy in a square room (you walk via the middle) and
// buys the thing a school actually needs, which is an L-shaped corridor whose
// two ends are not in line of sight. A hub is also somewhere to *be* — an
// agent with nowhere to go stands at one.
//
// **The outside is one node.** Every exterior door on the ground floor lands
// on it. That is a deliberate flattening: the site is open ground and Phase 5
// gave it a heightfield rather than obstacles, so routing across it is a
// straight line and a graph would only add nodes with nothing to say. An
// exterior door above the ground floor is not an exit — it is a door onto a
// roof or a future balcony — and is left out rather than guessed at.
//
// **A hole is not a way up.** Stairs, ramps and elevators are links you can
// travel; a plain `opening` link is a hole in a slab, and walking into one is
// what railings exist to prevent. Only the first three become edges.

import { CELL, cellIdx, getCell, floodRegion, isDoorEdge, FLOOR_H } from './grid.js';
import {
  shapesOf, shapeArea, segEnds, isBuilt, isDoorOpening, interiorPoint, shapeAt,
} from './shapes.js';
import { gridOpeningWidth } from './openings.js';
import {
  stairsOf, stairMetrics, runLength, localToWorld, elevatorSize, isRun, isElevator,
  LANDING,
} from './stairs.js';

// How far off a doorway to stand when asking which rooms it joins. Half a
// lattice cell is 2ft and the thickest wall is 0.8, so 1.4 clears the wall and
// still lands inside the smallest room either side of it.
export const PROBE = 1.4;          // ft
// A doorway narrower than this is a cupboard, not a route. (The editor won't
// draw one, but a file can carry one.)
export const MIN_PORTAL_W = 1.5;   // ft
// How far out from an exterior door people gather. Far enough to be off the
// walk and out of the way of the next person through the door.
export const MUSTER_FT = 45;       // ft
// How far either side of a doorway its two waypoints sit. A doorway is a thing
// you go *through*, and a route that merely aims at one leaves a walker
// sliding along the wall beside it: the near point lines you up with the
// opening, the far point pulls you out the other side. Three feet clears the
// thickest wall, both jambs' inflation and a body's own radius.
export const DOOR_OFFSET = 3;      // ft
// Stairs are slower than corridor, and a graph that doesn't say so routes
// everyone up and over rather than around. Multiplies the run's true length.
export const STAIR_COST = 1.7;
// A ramp is longer but easier; a lift is short, and mostly waiting.
export const RAMP_COST = 1.25;
export const ELEVATOR_COST = 45;   // ft-equivalent, wait included
// Changing storeys at all is worth avoiding when the alternative is level.
export const FLOOR_PENALTY = 8;    // ft-equivalent per storey climbed

// ---------- the accessible graph ----------
//
// Phase 7's one genuinely new piece of navigation, and it is an option rather
// than a module: the accessible route is the same graph with the things a
// wheelchair can't use left out of it. A stair is out; a ramp and a lift stay,
// which is what Phase 2 built them for. A doorway too narrow to roll through
// is out too, and that is a *width* question rather than a kind one.
//
// The clear width a doorway offers is not the hole in the wall: a leaf parked
// at 90° and its stop eat into the opening, which is why a 36in door is the
// smallest one that gives the 32in clear ADA asks for.
export const CLEAR_LOSS = 0.33;    // ft — leaf and stop, off a doorway's width
export const MIN_CLEAR_W = 32 / 12;  // ft — ADA 404.2.3
// ...so the narrowest *opening* that passes, which is exactly a 3ft door.
export const MIN_ACCESSIBLE_W = MIN_CLEAR_W + CLEAR_LOSS;

// The clear width a doorway of this opening width actually offers. An opening
// with no leaf in it (a cased opening, a corridor mouth) loses nothing.
export const clearWidth = (w, leafed = true) =>
  Math.max(0, w - (leafed ? CLEAR_LOSS : 0));

const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------- rooms ----------

// Every distinct room on one storey, and a lookup from a point to whichever of
// them contains it.
//
// The two representations answer in the order they always do: a polygon room
// wins over the lattice under it, the same rule `shapeAt`, `finishAt` and
// `roomAt` follow. The grid half is flood-filled once per region rather than
// once per cell, and the region's cells are marked off as it goes — so this is
// linear in cells, and the map it leaves behind turns the point lookup into an
// array index.
export function floorRooms(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const rooms = [];
  if (!floor) return { rooms, cellRoom: new Int32Array(0), floor: null };

  for (const shape of shapesOf(floor)) {
    const p = interiorPoint(shape);
    rooms.push({
      id: `r${floorIndex}:s${shape.id}`,
      kind: 'room',
      rep: 'shape',
      floor: floorIndex,
      name: shape.name || null,
      x: p.x, z: p.z,
      area: shapeArea(shape),
      shape,
    });
  }

  const cellRoom = new Int32Array(floor.w * floor.h).fill(-1);
  for (let y = 0; y < floor.h; y++) {
    for (let x = 0; x < floor.w; x++) {
      const i = cellIdx(floor, x, y);
      if (cellRoom[i] >= 0 || !getCell(floor, x, y)) continue;
      const cells = floodRegion(floor, x, y);
      if (!cells.length) continue;
      const idx = rooms.length;
      let sx = 0, sz = 0, name = null, lowest = Infinity;
      for (const c of cells) {
        const ci = cellIdx(floor, c.x, c.y);
        cellRoom[ci] = idx;
        lowest = Math.min(lowest, ci);
        sx += c.x + 0.5; sz += c.y + 0.5;
        const cell = floor.cells[ci];
        if (!name && cell && cell.room) name = cell.room;
      }
      // The hub is the *cell* nearest the centroid, not the centroid: a wing
      // shaped like a T has its centre of area in the wall.
      const cx = sx / cells.length, cz = sz / cells.length;
      let best = cells[0], bestD = Infinity;
      for (const c of cells) {
        const d = (c.x + 0.5 - cx) ** 2 + (c.y + 0.5 - cz) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      rooms.push({
        // A grid region has no id of its own — the standing tax the
        // retrospective describes — so its lowest cell names it, which is
        // stable for exactly as long as the region is.
        id: `r${floorIndex}:g${lowest}`,
        kind: 'room',
        rep: 'grid',
        floor: floorIndex,
        name,
        x: (best.x + 0.5) * CELL, z: (best.y + 0.5) * CELL,
        area: cells.length * CELL * CELL,
        cells: cells.length,
      });
    }
  }
  return { rooms, cellRoom, floor };
}

// ---------- the graph ----------

// Every edge carries two numbers: what it *costs* to route over (stairs are
// slower than corridor, a lift is mostly waiting) and how far it actually is
// in feet. Phase 6 only ever wanted the first; Phase 7's travel distances are
// measured against a code limit written in feet, so they want the second.
// `dist` defaults to `cost`, which is right for every edge that is simply a
// walk across a floor.
function addEdge(adj, a, b, cost, dist = cost) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push({ to: b, cost, dist });
  adj.get(b).push({ to: a, cost, dist });
}

// One doorway, as the two rooms it joins and the point you pass through.
// `nx, nz` is the wall's normal, so a caller that wants to stand *outside* a
// door (a muster point, a queue) has the direction to hand.
function makePortal(id, x, z, nx, nz, w, floor, a, b, opts = {}) {
  return {
    id, kind: 'portal', floor, x, z, nx, nz, w,
    a, b,
    // The two places you stand to use it: `pa` on room `a`'s side, `pb` on
    // room `b`'s. Named for the rooms rather than for the normal's sign so
    // that a reader threading a route never has to work out which way a
    // doorway's normal happened to come out.
    pa: opts.pa,
    pb: opts.pb,
    exterior: opts.exterior === true,
    rep: opts.rep || 'grid',
    muster: opts.muster || null,
  };
}

// `opts.accessible` builds the same graph with the routes a wheelchair can't
// take left out of it — no stairs, and no doorway narrower than
// `opts.minWidth` (default `MIN_ACCESSIBLE_W`). Everything else about it is
// the graph the crowd walks, which is the point: an accessible route is not a
// second model of the building, it is this one with two things removed.
export function buildNav(state, opts = {}) {
  const accessible = opts.accessible === true;
  const minWidth = Number.isFinite(opts.minWidth)
    ? opts.minWidth
    : (accessible ? MIN_ACCESSIBLE_W : MIN_PORTAL_W);
  const nodes = new Map();
  const adj = new Map();
  const rooms = [];
  const portals = [];
  const links = [];
  const exits = [];
  const perFloor = [];
  const floorHt = (state && state.floorHt) || FLOOR_H;

  const put = (node) => { nodes.set(node.id, node); return node; };

  const floorCount = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < floorCount; i++) {
    const fr = floorRooms(state, i);
    perFloor.push(fr);
    for (const r of fr.rooms) { put(r); rooms.push(r); adj.set(r.id, []); }
  }

  // Which room is at a point, as a node id — or null for the outside. The
  // outside is deliberately not a room: rooms are things you can be assigned
  // to, and "outdoors" is where you are when you aren't in one.
  const roomIdAt = (floorIndex, x, z) => {
    const fr = perFloor[floorIndex];
    if (!fr || !fr.floor) return null;
    const shape = shapeAt(fr.floor, x, z);
    if (shape) return `r${floorIndex}:s${shape.id}`;
    const gx = Math.floor(x / CELL), gy = Math.floor(z / CELL);
    if (gx < 0 || gy < 0 || gx >= fr.floor.w || gy >= fr.floor.h) return null;
    const idx = fr.cellRoom[cellIdx(fr.floor, gx, gy)];
    return idx >= 0 ? fr.rooms[idx].id : null;
  };

  // The outside, made only if something opens onto it. A design with no
  // exterior door has no outside node and no exits, and every reader of this
  // graph should behave as though the building is sealed — which it is.
  let outside = null;
  const ensureOutside = () => {
    if (outside) return outside;
    outside = put({
      id: 'out', kind: 'outside', floor: 0, name: 'Outside',
      x: 0, z: 0, area: 0,
    });
    adj.set(outside.id, []);
    return outside;
  };

  // ---- doorways ----

  let pn = 0;
  const joinPortal = (x, z, nx, nz, w, floorIndex, rep) => {
    if (w < minWidth) return null;
    const a = roomIdAt(floorIndex, x + nx * PROBE, z + nz * PROBE);
    const b = roomIdAt(floorIndex, x - nx * PROBE, z - nz * PROBE);
    if (a && a === b) return null;              // a doorway inside one room
    if (!a && !b) return null;                  // a door in a wall between two outsides
    const exterior = !a || !b;
    // Above the ground floor there is nothing on the far side of an exterior
    // door — no site, no balcony, and a graph that says otherwise routes a
    // fire drill out of a second-storey window.
    if (exterior && floorIndex !== 0) return null;
    // The normal points out of the building when one side is the outside, so
    // "away from the door" is a direction anything queueing can use.
    const outward = a ? -1 : 1;
    const portal = makePortal(`p${pn++}`, x, z, nx * outward, nz * outward, w,
      floorIndex, a || null, b || null, {
        exterior,
        rep,
        pa: { x: x + nx * DOOR_OFFSET, z: z + nz * DOOR_OFFSET },
        pb: { x: x - nx * DOOR_OFFSET, z: z - nz * DOOR_OFFSET },
        muster: exterior
          ? { x: x + nx * outward * MUSTER_FT, z: z + nz * outward * MUSTER_FT }
          : null,
      });
    put(portal);
    portals.push(portal);
    adj.set(portal.id, []);
    const inner = a || b;
    const other = exterior ? ensureOutside().id : (a === inner ? b : a);
    addEdge(adj, portal.id, inner, dist2d(portal, nodes.get(inner)));
    if (exterior) {
      // The outside hub has no position of its own worth trusting, so the
      // cost of leaving is the walk to the muster point rather than to a
      // notional centre of the site.
      // Reaching the door is reaching the exit, so the walk out to the muster
      // point costs a route something and measures as nothing.
      addEdge(adj, portal.id, other, MUSTER_FT, 0);
      exits.push(portal);
    } else {
      addEdge(adj, portal.id, other, dist2d(portal, nodes.get(other)));
    }
    return portal;
  };

  for (let i = 0; i < floorCount; i++) {
    const floor = state.floors[i];
    if (!floor) continue;
    // The lattice. A grid doorway is always centred on its edge — an edge is a
    // whole cell wide and has nowhere to record a position along itself.
    for (let y = 0; y <= floor.h; y++) {
      for (let x = 0; x < floor.w; x++) {
        const v = floor.edgesH[y * floor.w + x];
        if (!isDoorEdge(v)) continue;
        joinPortal((x + 0.5) * CELL, y * CELL, 0, 1, gridOpeningWidth(v), i, 'grid');
      }
    }
    for (let y = 0; y < floor.h; y++) {
      for (let x = 0; x <= floor.w; x++) {
        const v = floor.edgesV[y * (floor.w + 1) + x];
        if (!isDoorEdge(v)) continue;
        joinPortal(x * CELL, (y + 0.5) * CELL, 1, 0, gridOpeningWidth(v), i, 'grid');
      }
    }
    // Polygon rooms. Same call, a different way of finding the point: an
    // opening records where along its run it sits, so the normal comes off the
    // segment rather than off the axis.
    for (const shape of shapesOf(floor)) {
      for (const ring of shape.rings) {
        for (let s = 0; s < ring.pts.length; s++) {
          if (!isBuilt(ring.walls[s])) continue;
          const [a, b] = segEnds(ring, s);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (len < 0.01) continue;
          const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
          for (const o of ring.openings) {
            if (o.seg !== s || !isDoorOpening(o)) continue;
            joinPortal(a.x + ux * o.t * len, a.z + uz * o.t * len, -uz, ux, o.w, i, 'shape');
          }
        }
      }
    }
  }

  // ---- stairs, ramps and lifts ----

  const metrics = stairMetrics(state);
  for (const link of stairsOf(state)) {
    if (!isRun(link) && !isElevator(link)) continue;   // a plain opening is a hole
    // A stair is a route for most people and a wall for some. On the
    // accessible graph it is simply not there, and whatever it was the only
    // way to becomes unreachable — which is the finding Phase 7 is after.
    if (accessible && link.type === 'stair') continue;
    const lo = Math.min(link.from, link.to);
    const hi = Math.max(link.from, link.to);
    if (!state.floors[lo] || !state.floors[hi]) continue;

    let foot, head, cost, span;
    if (isElevator(link)) {
      // You enter a car from local -Z, which is the same convention its doors
      // and its `rotationY` already use, so both landings are the same point.
      const ends = runLandings(link, metrics);
      foot = ends.foot; head = ends.head;
      cost = ELEVATOR_COST;
      // A lift is a ride, not a walk: it is no distance at all, which is one
      // more reason egress is not allowed to count on one.
      span = 0;
    } else {
      // The head is past the far edge of the cut, not in the middle of it: the
      // landing is inside the hole the run opens in the slab above, and
      // `openingRails` fences every side of that hole except the one you walk
      // out of — so a node on the landing itself is a node behind a
      // guardrail, and everybody routed to it queues at a handrail forever.
      // (It took a fire drill that never finished to notice.)
      const ends = runLandings(link, metrics);
      foot = ends.foot; head = ends.head;
      span = runLength(link, metrics);
      cost = span * (link.type === 'ramp' ? RAMP_COST : STAIR_COST);
    }
    const node = put({
      id: `l${link.id}`,
      kind: 'link',
      type: link.type,
      floor: lo, to: hi,
      // A link's own position is its lower landing — that is where it is on a
      // plan, and where a walker heading for it is heading.
      x: foot.x, z: foot.z,
      a: { x: foot.x, z: foot.z, floor: link.from },
      b: { x: head.x, z: head.z, floor: link.to },
      link,
    });
    links.push(node);
    adj.set(node.id, []);
    const below = roomIdAt(link.from, foot.x, foot.z);
    const above = roomIdAt(link.to, head.x, head.z);
    const climb = cost + FLOOR_PENALTY;
    if (below) {
      addEdge(adj, node.id, below, dist2d(node, nodes.get(below)) + climb / 2,
        dist2d(node, nodes.get(below)) + span / 2);
    }
    if (above) {
      addEdge(adj, node.id, above, dist2d(node.b, nodes.get(above)) + climb / 2,
        dist2d(node.b, nodes.get(above)) + span / 2);
    }
    // A stair that lands in nothing on either end joins nothing; it stays in
    // the node list so a reader can say so, but it is not a route.
  }

  return {
    floorHt,
    accessible,
    minWidth,
    nodes, adj,
    rooms, portals, links, exits,
    outside: outside ? outside.id : null,
    perFloor,
    roomIdAt,
    node: (id) => nodes.get(id) || null,
  };
}

// The two ends of a run, as the points a walker actually stands on: the foot,
// two feet short of the first tread, and the head, two feet past the far edge
// of the hole it cuts in the slab above. Exported because agents.js needs the
// same two points when it finds somebody standing halfway up one.
export function runLandings(link, metrics) {
  if (isElevator(link)) {
    const { d } = elevatorSize(link);
    const at = localToWorld(link, 0, -(d / 2 + 2));
    return { foot: at, head: at };
  }
  const run = runLength(link, metrics);
  return {
    foot: localToWorld(link, 0, -2),
    head: localToWorld(link, 0, run + LANDING + 2),
  };
}

// Which node a point is standing in: the room if it is in one, the outside if
// the design has one, null if neither.
export function nodeAt(nav, floorIndex, x, z) {
  if (!nav) return null;
  const id = nav.roomIdAt(floorIndex, x, z);
  return id || nav.outside;
}

// ---------- routing ----------

// A* over the graph. The heuristic is the straight line plus a flat charge per
// storey — admissible as long as no edge is cheaper than the distance it
// covers, which is why every vertical cost above is a *penalty on top of*
// its own geometry rather than a replacement for it.
export function findPath(nav, fromId, toId) {
  if (!nav || !fromId || !toId) return null;
  if (fromId === toId) return [fromId];
  if (!nav.nodes.has(fromId) || !nav.nodes.has(toId)) return null;
  const goal = nav.nodes.get(toId);
  const h = (id) => {
    const n = nav.nodes.get(id);
    const flat = Math.hypot(n.x - goal.x, n.z - goal.z);
    return flat + Math.abs((n.floor || 0) - (goal.floor || 0)) * FLOOR_PENALTY;
  };

  const g = new Map([[fromId, 0]]);
  const came = new Map();
  // A school's graph is a few hundred nodes, so the open set is a sorted
  // array rather than a heap — the constant factor on a binary heap costs
  // more to read than it saves to run at this size.
  const open = [{ id: fromId, f: h(fromId) }];
  const done = new Set();

  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.id === toId) {
      const path = [toId];
      let at = toId;
      while (came.has(at)) { at = came.get(at); path.push(at); }
      return path.reverse();
    }
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    for (const e of nav.adj.get(cur.id) || []) {
      if (done.has(e.to)) continue;
      const tentative = (g.get(cur.id) ?? Infinity) + e.cost;
      if (tentative >= (g.get(e.to) ?? Infinity)) continue;
      g.set(e.to, tentative);
      came.set(e.to, cur.id);
      open.push({ id: e.to, f: tentative + h(e.to) });
    }
  }
  return null;
}

// A node path, as somewhere to put your feet. Rooms and portals contribute one
// point each; a link contributes two — the landing you walk to and the one you
// arrive at — in whichever order this path is travelling it.
export function waypoints(nav, path, opts = {}) {
  if (!path || !path.length) return [];
  const out = [];
  let floor = opts.floor ?? (nav.nodes.get(path[0])?.floor ?? 0);
  let prev = null;
  for (const id of path) {
    const n = nav.nodes.get(id);
    if (!n) continue;
    if (n.kind === 'portal') {
      // Which side you are coming from decides the order. Failing that (a
      // route that starts at a door), the side nearest whoever is walking it.
      let fromA = prev ? prev === n.a : null;
      if (fromA === null) {
        const at = opts.at || out[out.length - 1] || n.pa;
        fromA = (at.x - n.pa.x) ** 2 + (at.z - n.pa.z) ** 2
          <= (at.x - n.pb.x) ** 2 + (at.z - n.pb.z) ** 2;
      }
      const first = fromA ? n.pa : n.pb;
      const second = fromA ? n.pb : n.pa;
      out.push({ x: first.x, z: first.z, floor: n.floor, kind: 'door', node: id, portal: n });
      out.push({ x: second.x, z: second.z, floor: n.floor, kind: 'door', node: id, portal: n });
      floor = n.floor;
      prev = id;
      continue;
    }
    prev = id;
    if (n.kind === 'link') {
      const up = Math.abs(floor - n.a.floor) <= Math.abs(floor - n.b.floor);
      const first = up ? n.a : n.b;
      const second = up ? n.b : n.a;
      out.push({ x: first.x, z: first.z, floor: first.floor, kind: 'link', node: id, link: n.link });
      out.push({ x: second.x, z: second.z, floor: second.floor, kind: 'ride', node: id, link: n.link });
      floor = second.floor;
    } else if (n.kind === 'outside') {
      // The outside hub has no place of its own: the last real point on the
      // way out was the door, and where you go from there is the caller's
      // business (a muster point, a bus, a bench).
      continue;
    } else {
      out.push({ x: n.x, z: n.z, floor: n.floor, kind: n.kind, node: id });
      floor = n.floor;
    }
  }
  return out;
}

// A whole route between two points, as waypoints. The start and end points
// themselves are not in it — an agent is already at one and steers to the
// other — but the rooms they are in are where the graph is entered and left.
export function route(nav, from, toId) {
  const startId = nodeAt(nav, from.floor, from.x, from.z);
  if (!startId) return null;
  const path = findPath(nav, startId, toId);
  if (!path) return null;
  const wp = waypoints(nav, path, { floor: from.floor, at: from });
  // The first waypoint is the hub of the room you are already standing in.
  // Walking to it first is a detour to the middle of the room you are leaving,
  // so it goes — unless it is where you were headed.
  if (wp.length > 1 && wp[0].node === startId) wp.shift();
  return wp;
}

// ---------- egress ----------

// How far every node is from the nearest exit, and which exit that is.
// Multi-source Dijkstra, which is one queue rather than one search per exit —
// and the answer Phase 7's egress checks want as much as this phase's fire
// drill does.
export function egressField(nav, opts = {}) {
  // `metric` walks the same graph on real feet rather than on routing cost —
  // what Phase 7 measures against a code limit. The route a body takes is the
  // cheap one either way; this only changes the number written beside it.
  const weight = opts.metric ? (e) => e.dist : (e) => e.cost;
  const dist = new Map();
  const via = new Map();
  if (!nav || !nav.exits.length) return { dist, via, reached: 0 };
  const open = [];
  for (const e of nav.exits) {
    dist.set(e.id, 0);
    via.set(e.id, e.id);
    open.push({ id: e.id, d: 0 });
  }
  const done = new Set();
  while (open.length) {
    open.sort((a, b) => a.d - b.d);
    const cur = open.shift();
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    for (const e of nav.adj.get(cur.id) || []) {
      // The outside is where you are going, not somewhere you pass through: a
      // route that leaves by one door and comes back in another is not egress.
      if (e.to === nav.outside) continue;
      const d = cur.d + weight(e);
      if (d >= (dist.get(e.to) ?? Infinity)) continue;
      dist.set(e.to, d);
      via.set(e.to, via.get(cur.id));
      open.push({ id: e.to, d });
    }
  }
  return { dist, via, reached: dist.size };
}

// The exit a point should leave by, and how far it is. Null when the design
// has no exterior door, or when this part of it can't reach one — which is
// itself worth knowing, and is exactly what Phase 7 will report.
export function nearestExit(nav, field, floorIndex, x, z) {
  const id = nav.roomIdAt(floorIndex, x, z);
  if (!id) return null;
  const exitId = field.via.get(id);
  if (!exitId) return null;
  const exit = nav.nodes.get(exitId);
  return { exit, dist: field.dist.get(id) ?? Infinity };
}

// Rooms with no way out at all, for a caller that wants to say so.
export function unreachableRooms(nav, field) {
  return nav.rooms.filter((r) => !field.dist.has(r.id));
}

// ---------- describing it ----------

// A one-line summary, for a panel that wants to say what the graph found
// without the caller counting arrays itself.
export function navSummary(nav) {
  const doors = nav.portals.filter((p) => !p.exterior).length;
  return {
    rooms: nav.rooms.length,
    doors,
    exits: nav.exits.length,
    links: nav.links.length,
    outside: !!nav.outside,
  };
}

// Rooms big enough to hold a class, in descending order of area — the pool a
// timetable draws from. A corridor is a room too, and this is what keeps a
// class from being scheduled into one: a teaching space is bounded, and a hall
// long enough to be a wing is not.
export function teachingRooms(nav, opts = {}) {
  const min = opts.minArea ?? 250;
  const max = opts.maxArea ?? 4000;
  const named = (r) => (r.name || '').toLowerCase();
  const excluded = /hall|corridor|lobby|stair|closet|restroom|toilet|mech|storage/;
  return nav.rooms
    .filter((r) => r.area >= min && r.area <= max && !excluded.test(named(r)))
    .sort((a, b) => b.area - a.area);
}

// Rooms that read as circulation — where a crowd goes between classes, and
// where a passing period is worth watching. The complement of the above, minus
// the rooms too small to stand in.
export function commonRooms(nav, opts = {}) {
  const min = opts.minArea ?? 120;
  const teaching = new Set(teachingRooms(nav, opts).map((r) => r.id));
  return nav.rooms.filter((r) => r.area >= min && !teaching.has(r.id));
}
