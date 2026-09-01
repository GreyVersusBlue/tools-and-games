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
// **Rooms are surfaces, not hubs.** Phase 6 put one node in the middle of
// every room and hung its doorways off it, which is honest about topology and
// a liar about distance: two classrooms forty feet apart on one corridor
// routed through that corridor's *midpoint*, and a generated three-storey
// school reported travel distances ten to twenty feet worse than anybody
// walks. Phase 10 replaces the hub with `navmesh.js`'s tiles — a room is a
// handful of convex rectangles covering its floor — and connects everything
// standing on one tile to everything else standing on it at the straight-line
// distance between them, which inside a convex empty rectangle is the truth.
// Where two tiles of a room meet, a **gate** node sits in the opening, so an
// L-shaped corridor keeps the corner it has to be walked round.
//
// The room node survives all of that, and does what it always did except
// measure: it is a name for the room, a thing an agent can be assigned to, and
// somewhere to stand when you have nowhere to go. It is now one more anchor on
// one more tile, and a route that merely passes through a room no longer
// visits it.
//
// **The outside used to be one node**, and every exterior door on the ground
// floor landed on it at a flat forty-five feet. That was a deliberate
// flattening with a stated reason — the site was open ground, so routing
// across it was a straight line — and it stopped being true once the ground
// grew regions, a heightfield and, with Phase 17's campus, a second building
// to walk to. So the outdoors is now `sitemesh.js`'s tiles, wired exactly as a
// storey's are: an exterior door stands on the piece of ground outside it, and
// two doors forty feet apart are forty feet apart rather than ninety.
//
// The `out` node survives, and means what it always should have: **off the
// property**. Every tile that reaches the public way runs into it, one way
// only — nothing routes *through* the street to get somewhere else in the
// school, which is the same rule that kept a fire drill from leaving by one
// door and coming back in another.
//
// An exterior door above the ground floor is not an exit — it is a door onto a
// roof or a future balcony — and is left out rather than guessed at.
//
// **A hole is not a way up.** Stairs, ramps and elevators are links you can
// travel; a plain `opening` link is a hole in a slab, and walking into one is
// what railings exist to prevent. Only the first three become edges.

import { FLOOR_H } from './grid.js';
import {
  shapesOf, shapeArea, segEnds, isBuilt, isDoorOpening, interiorPoint, shapeAt, openingSpec,
} from './shapes.js';
import { meshFloor, tileFor } from './navmesh.js';
import { meshSite, yardTileFor } from './sitemesh.js';
import { siteCurbs } from './site.js';
import { MinHeap } from './heap.js';
import {
  stairsOf, stairMetrics, runLength, localToWorld, elevatorSize, isRun, isElevator,
  LANDING,
} from './stairs.js';
import { MIN_ACCESSIBLE_W, doorRolls, rampRolls } from './clearance.js';

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
// What it costs to step outside, per exterior doorway a route uses. The same
// kind of number as `STAIR_COST` and for the same reason: a route across the
// site is a real route and a shorter one is genuinely shorter, but going out
// is a door, a coat and the weather, and a graph with no charge on it walks a
// spine school's whole passing period through the light courts because that
// saves forty feet. Sixty a door means out-and-back has to save two hundred
// before anybody takes it — and it costs a campus nothing, because a campus
// has no indoor alternative to compare it with.
//
// It is charged on `cost` and not on `dist`. Every distance this tool prints
// is still the distance somebody walks.
export const OUTDOOR_COST = 60;    // ft-equivalent per exterior doorway

// ---------- the accessible graph ----------
//
// Phase 7's one genuinely new piece of navigation, and it is an option rather
// than a module: the accessible route is the same graph with the things a
// wheelchair can't use left out of it. A stair is out; a ramp stays if a chair
// can climb it (Phase 40: 1:12, and a steeper one is a stair with no treads);
// a lift stays, which is what Phase 2 built them for. A doorway too narrow to
// roll through is out too, and that is a *width* question rather than a kind
// one — and since Phase 40 a question this file no longer answers itself.
// `clearance.js` owns the door-width contract (`doorRolls`) and the ramp rule
// (`rampRolls`), and the seated walker reads the same two functions, which is
// what makes the report and the walkthrough agree about every doorway.

// ---------- rooms ----------

// Every distinct room on one storey. Since Phase 12 that is exactly
// `floor.shapes`, in order, and the row carries the room's own record along
// with it — the name, the occupancy group somebody picked, the design load
// somebody typed — so `occupancy.js` never has to go back to the file.
//
// The `r<floor>:s<id>` node id is a room's name outside the file, and it is
// stable now for as long as the room is rather than for as long as its lowest
// cell happens to be. That sentence is what Phase 13's session log and Phase
// 14's timetable binding were both waiting on.
export function floorRooms(state, floorIndex) {
  const floor = state && state.floors ? state.floors[floorIndex] : null;
  const rooms = [];
  if (!floor) return { rooms, floor: null };

  for (const shape of shapesOf(floor)) {
    const p = interiorPoint(shape);
    rooms.push({
      id: `r${floorIndex}:s${shape.id}`,
      kind: 'room',
      rep: 'shape',
      floor: floorIndex,
      roomId: shape.id,
      name: shape.name || null,
      group: shape.group || null,
      load: Number.isFinite(shape.load) ? shape.load : null,
      x: p.x, z: p.z,
      area: shapeArea(shape),
      shape,
    });
  }
  return { rooms, floor };
}


// ---------- the graph ----------

// Every edge carries three things: what it *costs* to route over (stairs are
// slower than corridor, a lift is mostly waiting), how far it actually is in
// feet, and which room it lies in. Phase 6 only ever wanted the first; Phase
// 7's travel distances are measured against a code limit written in feet, so
// they want the second; and Phase 10's mesh wants the third, because an edge
// between two doorways now crosses a room rather than passing through its
// hub, and a reader threading a route has no other way to know which side of
// a doorway it came out on. `room` is null for the two edges that lie in no
// room at all — a door onto the outside, and the climb inside a stair.
function addEdge(adj, a, b, cost, dist = cost, room = null, extra = null) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push({ to: b, cost, dist, room, ...extra });
  adj.get(b).push({ to: a, cost, dist, room, ...extra });
}

// One edge, one way. The only thing in the graph that needs it is the step off
// the property: the public way is where a route *ends*, and an undirected edge
// into it would make the street a corridor joining every door in the school to
// every other at no cost — which is precisely the flattening this phase took
// out of the front door.
function addArc(adj, a, b, cost, dist = cost, extra = null) {
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push({ to: b, cost, dist, room: null, ...extra });
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
    rep: opts.rep || 'shape',
    muster: opts.muster || null,
    // How it is hung — none, a single leaf, a pair — which is what decides
    // its clear width (Phase 40, `clearance.js`).
    leaf: Number.isInteger(opts.leaf) ? opts.leaf : 1,
  };
}

// `opts.accessible` builds the same graph with the routes a wheelchair can't
// take left out of it — no stairs, no ramp steeper than a chair climbs, and
// no doorway `doorRolls` refuses (a 3ft leaf, a 6ft pair, a 32in cased
// opening are the narrowest of each). `minWidth` is the plain graph's floor
// under a doorway (a cupboard is not a route) and is reported on the
// accessible one for what it is worth. Everything else about it is the graph
// the crowd walks, which is the point: an accessible route is not a second
// model of the building, it is this one with three things removed.
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
  const gates = [];
  const perFloor = [];
  const mesh = [];
  const tiles = new Map();
  const floorHt = (state && state.floorHt) || FLOOR_H;
  // The outdoors, meshed — built on demand, because a sealed building has no
  // outside at all and meshing a site nobody can reach is thirty milliseconds
  // spent on nothing.
  let yard = null;
  const ways = [];

  const put = (node) => { nodes.set(node.id, node); return node; };

  const floorCount = state && state.floors ? state.floors.length : 0;
  for (let i = 0; i < floorCount; i++) {
    const fr = floorRooms(state, i);
    perFloor.push(fr);
    for (const r of fr.rooms) { put(r); rooms.push(r); adj.set(r.id, []); }
    // The walkable surface, cut into convex tiles. This is the whole of what
    // Phase 10 added to this file: everything below hangs points on tiles, and
    // the graph falls out of which points share one.
    const m = meshFloor(state, i, fr);
    mesh.push(m);
    for (const t of m.tiles) tiles.set(t.id, t);
    for (const g of m.gates) { put(g); gates.push(g); adj.set(g.id, []); }
  }

  // Somewhere to stand, hung on the tile it stands on. `extra` and `span` are
  // what a *vertical* anchor carries: the head of a stair is a point in the
  // upper room that costs a climb to reach from anywhere else on that tile,
  // and charging it here rather than on a separate edge is what keeps a stair
  // one node instead of two.
  const attach = (floorIndex, roomId, id, x, z, extra = 0, span = 0) => {
    if (!roomId) return false;
    const found = tileFor(mesh[floorIndex], roomId, x, z);
    if (!found) return false;
    found.tile.anchors.push({ id, x, z, extra, span });
    return true;
  };

  // A gate belongs to exactly two tiles, and is the only anchor that does —
  // which is precisely why it is the thing that joins them. Hung on both by
  // name rather than by position: the gate sits *on* the boundary, and asking
  // which tile a boundary point is in has no right answer.
  for (const m of mesh) {
    for (const g of m.gates) {
      for (const tid of [g.a, g.b]) {
        const t = tiles.get(tid);
        if (t) t.anchors.push({ id: g.id, x: g.x, z: g.z, extra: 0, span: 0 });
      }
    }
  }

  // The room node, on whichever of its tiles its own point falls. It measures
  // nothing any more — it is a name, an assignment target and somewhere to
  // stand — but it still has to be *on* the mesh, or a room with a door at the
  // far end of it would be a room nothing could route out of.
  for (const r of rooms) attach(r.floor, r.id, r.id, r.x, r.z);

  // Which room is at a point, as a node id — or null for the outside. The
  // outside is deliberately not a room: rooms are things you can be assigned
  // to, and "outdoors" is where you are when you aren't in one.
  const roomIdAt = (floorIndex, x, z) => {
    const fr = perFloor[floorIndex];
    if (!fr || !fr.floor) return null;
    const shape = shapeAt(fr.floor, x, z);
    return shape ? `r${floorIndex}:s${shape.id}` : null;
  };

  // The outside, made only if something opens onto it. A design with no
  // exterior door has no outside node and no exits, and every reader of this
  // graph should behave as though the building is sealed — which it is.
  let outside = null;
  const ensureOutside = () => {
    if (outside) return outside;
    outside = put({
      id: 'out', kind: 'outside', outdoors: true, floor: 0, name: 'Outside',
      x: 0, z: 0, area: 0,
    });
    // Nothing is ever pushed into this list. `out` is a sink: you reach the
    // public way and you are done, and a route that wanted to come back would
    // have to come back through the ground it left over.
    adj.set(outside.id, []);
    yard = opts.yard || meshSite(state, { field: opts.siteField });
    return outside;
  };

  // ---- doorways ----

  let pn = 0;
  const joinPortal = (x, z, nx, nz, w, floorIndex, rep, leaf = 1) => {
    if (accessible ? !doorRolls(w, leaf) : w < minWidth) return null;
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
    const pa = { x: x + nx * DOOR_OFFSET, z: z + nz * DOOR_OFFSET };
    const pb = { x: x - nx * DOOR_OFFSET, z: z - nz * DOOR_OFFSET };
    const portal = makePortal(`p${pn++}`, x, z, nx * outward, nz * outward, w,
      floorIndex, a || null, b || null, {
        exterior,
        rep,
        leaf,
        pa,
        pb,
        muster: exterior
          ? { x: x + nx * outward * MUSTER_FT, z: z + nz * outward * MUSTER_FT }
          : null,
      });
    put(portal);
    portals.push(portal);
    adj.set(portal.id, []);
    // A doorway stands on the tile either side of it, three feet out. That is
    // the whole of joining it to the building now: the tile's own wiring
    // connects it to every other door, gate and stair standing on the same
    // patch of floor, at the distance between them.
    if (a) attach(floorIndex, a, portal.id, pa.x, pa.z);
    if (b) attach(floorIndex, b, portal.id, pb.x, pb.z);
    if (exterior) {
      // A door onto the site stands on the piece of ground outside it, exactly
      // as an interior door stands on the floor either side of it. That one
      // line is what replaced the forty-five-foot flat charge onto a hub: the
      // tile's own wiring joins this door to every other door, gate and public
      // way standing on the same patch of ground, at the distance between
      // them.
      ensureOutside();
      const out = a ? pb : pa;
      const found = yardTileFor(yard, out.x, out.z);
      if (found) {
        found.tile.anchors.push({
          id: portal.id, x: out.x, z: out.z, extra: OUTDOOR_COST, span: 0,
        });
      }
      exits.push(portal);
    }
    return portal;
  };

  for (let i = 0; i < floorCount; i++) {
    const floor = state.floors[i];
    if (!floor) continue;
    // An opening records where along its run it sits, so the normal comes off
    // the segment rather than off an axis.
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
            joinPortal(a.x + ux * o.t * len, a.z + uz * o.t * len, -uz, ux, o.w, i,
              undefined, openingSpec(o).leaf);
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
    // ...and a ramp steeper than 1:12 is a stair with no treads on it.
    if (accessible && link.type === 'ramp' && !rampRolls(link)) continue;
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
    // The climb is charged on the *upper* anchor rather than split across two
    // edges: every route between the storey above and this stair pays it once,
    // and a route that merely walks past the foot of it pays nothing.
    attach(link.from, below, node.id, foot.x, foot.z, 0, 0);
    attach(link.to, above, node.id, head.x, head.z, cost + FLOOR_PENALTY, span);
    // A stair that lands in nothing on either end joins nothing; it stays in
    // the node list so a reader can say so, but it is not a route.
  }

  // ---- the outdoors ----
  //
  // The same two things a storey contributes, and for the same two reasons: a
  // gate is where two tiles of walkable ground meet, and it is the one thing
  // out here that becomes a node; a way node is where a tile reaches the
  // public way, and it is where a route out of the building ends.
  const curbs = [];
  if (yard) {
    for (const g of yard.gates) {
      put(g);
      gates.push(g);
      adj.set(g.id, []);
      for (const tid of [g.a, g.b]) {
        const t = yard.byId.get(tid);
        if (t) t.anchors.push({ id: g.id, x: g.x, z: g.z, extra: 0, span: 0 });
      }
    }
    for (const w of yard.ways) {
      put(w);
      ways.push(w);
      adj.set(w.id, []);
      const t = yard.byId.get(w.tile);
      if (t) t.anchors.push({ id: w.id, x: w.x, z: w.z, extra: 0, span: 0 });
      // ...and off the property. One way only — see `addArc`.
      addArc(adj, w.id, ensureOutside().id, 0, 0);
    }
    // Phase 39: the curb. A region kind that implies curb points — a bus
    // loop's bays, a drop-off's pull-ins, a parking lot's aisles — hangs each
    // of them on the piece of ground it stands on, exactly the way a doorway
    // stands on the tile outside it. That one line is the whole of what lets
    // a route *begin* at the curb in the morning and *end* at one after the
    // last bell. The ids come off `siteCurbs` rather than being minted here,
    // so the crowd (which assigns people their curb from the same list) and
    // this graph can never name the same point differently.
    for (const c of siteCurbs(state)) {
      const found = yardTileFor(yard, c.x, c.z);
      if (!found) continue;
      const node = put({
        id: c.id, kind: 'curb', outdoors: true, floor: 0,
        name: c.name, x: c.x, z: c.z, region: c.region, curb: c.kind,
      });
      curbs.push(node);
      adj.set(node.id, []);
      found.tile.anchors.push({ id: node.id, x: c.x, z: c.z, extra: 0, span: 0 });
    }
  }

  // ---- the tiles, wired ----
  //
  // Everything standing on one convex rectangle is joined to everything else
  // standing on it, at the straight line between them — which is the true
  // walking distance, because there is nothing in a tile to walk round. This
  // one loop is the whole of what replaced the hub.
  //
  // Since Phase 17 the outdoors is in the same loop, because the outdoors is
  // the same thing: convex rectangles of somewhere you can stand. A yard edge
  // carries the tile it crosses under `yard` rather than under `room`, so a
  // reader threading a route can say which piece of ground it walked over
  // without the site turning up in a list of rooms.
  const wire = (list, roomOf, extraOf) => {
    for (const t of list) {
      const as = t.anchors;
      for (let i = 0; i < as.length; i++) {
        for (let j = i + 1; j < as.length; j++) {
          if (as[i].id === as[j].id) continue;
          const d = Math.hypot(as[i].x - as[j].x, as[i].z - as[j].z);
          addEdge(adj, as[i].id, as[j].id,
            d + as[i].extra + as[j].extra,
            d + as[i].span + as[j].span,
            roomOf(t), extraOf ? extraOf(t) : null);
        }
      }
    }
  };
  for (const m of mesh) wire(m.tiles, (t) => t.room);
  if (yard) wire(yard.tiles, () => null, (t) => ({ yard: t.id }));

  // Which doorways and links belong to a room, by construction rather than by
  // walking the graph. A door at the far end of a long room is no longer a
  // neighbour of that room's node — it is a neighbour of the *tile* it stands
  // on — so a reader counting the ways out of a room has to ask this instead.
  const portalsByRoom = new Map();
  const linksByRoom = new Map();
  const push = (map, id, v) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(v);
  };
  for (const p of portals) { push(portalsByRoom, p.a, p); push(portalsByRoom, p.b, p); }
  for (const l of links) {
    push(linksByRoom, roomIdAt(l.link.from, l.a.x, l.a.z), l);
    push(linksByRoom, roomIdAt(l.link.to, l.b.x, l.b.z), l);
  }

  return {
    floorHt,
    accessible,
    minWidth,
    nodes, adj,
    rooms, portals, links, exits, gates,
    mesh,
    // The outdoors: the mesh itself, the nodes on it that mean "the street",
    // and the ones that mean "where a vehicle lets you out". All null-safe —
    // a sealed building has none of them.
    yard,
    ways,
    curbs,
    outside: outside ? outside.id : null,
    perFloor,
    roomIdAt,
    node: (id) => nodes.get(id) || null,
    tileAt: (floorIndex, x, z) => {
      const id = roomIdAt(floorIndex, x, z);
      if (!id) return null;
      const found = tileFor(mesh[floorIndex], id, x, z);
      return found && found.inside ? found.tile : null;
    },
    // The piece of ground a point is standing on, for a caller out on the
    // site. Nearest rather than null when the point is in a flower bed: a
    // walker who got somewhere the mesh calls unwalkable still has to be able
    // to walk out of it.
    yardTile: (x, z) => {
      const found = yardTileFor(yard, x, z);
      return found ? found.tile : null;
    },
    portalsOf: (roomId) => portalsByRoom.get(roomId) || [],
    linksOf: (roomId) => linksByRoom.get(roomId) || [],
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

// Is this node out on the site? The one question three readers ask — the
// egress field (which may not pass through the outdoors), a route printer
// (which may want to say so), and the discharge walk below (which may go
// nowhere else).
export const outdoors = (nav, id) => {
  if (!nav || !id) return false;
  if (id === nav.outside) return true;
  const n = nav.nodes.get(id);
  return !!(n && n.outdoors);
};

// ---------- routing ----------

// The edge joining two adjacent nodes, so a reader threading a path can ask
// which room it was walking through. `opts.adj` is the one-node overlay a
// route from an arbitrary point hangs itself on — see `pointEntry`.
const edgeOn = (nav, a, b, opts = {}) => {
  const list = (opts.adj && opts.adj.has(a)) ? opts.adj.get(a) : (nav.adj.get(a) || []);
  return list.find((e) => e.to === b) || null;
};

const adjOf = (nav, id, opts) =>
  ((opts.adj && opts.adj.has(id)) ? opts.adj.get(id) : (nav.adj.get(id) || []));
const nodeOf = (nav, id, opts) =>
  ((opts.nodes && opts.nodes.has(id)) ? opts.nodes.get(id) : nav.nodes.get(id));

// A* over the graph. The heuristic is the straight line plus a flat charge per
// storey — admissible as long as no edge is cheaper than the distance it
// covers, which is why every vertical cost above is a *penalty on top of*
// its own geometry rather than a replacement for it.
export function findPath(nav, fromId, toId, opts = {}) {
  if (!nav || !fromId || !toId) return null;
  if (fromId === toId) return [fromId];
  const start = nodeOf(nav, fromId, opts);
  const goal = nodeOf(nav, toId, opts);
  if (!start || !goal) return null;
  const h = (id) => {
    const n = nodeOf(nav, id, opts);
    if (!n) return 0;
    const flat = Math.hypot(n.x - goal.x, n.z - goal.z);
    return flat + Math.abs((n.floor || 0) - (goal.floor || 0)) * FLOOR_PENALTY;
  };

  const g = new Map([[fromId, 0]]);
  const came = new Map();
  // The open set is a binary heap. It was a sorted array until Phase 17, on a
  // stated measurement — a school's graph was a few hundred nodes and the sort
  // cost less to run than a heap costs to read. A campus with a meshed site
  // round it is a few thousand, which is past where that trade turns over, and
  // sorting the whole open set on every pop is the term that does the turning.
  const open = new MinHeap();
  open.push({ id: fromId }, h(fromId));
  const done = new Set();

  while (open.size) {
    const cur = open.pop();
    if (cur.id === toId) {
      const path = [toId];
      let at = toId;
      while (came.has(at)) { at = came.get(at); path.push(at); }
      return path.reverse();
    }
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    for (const e of adjOf(nav, cur.id, opts)) {
      if (done.has(e.to)) continue;
      const tentative = (g.get(cur.id) ?? Infinity) + e.cost;
      if (tentative >= (g.get(e.to) ?? Infinity)) continue;
      g.set(e.to, tentative);
      came.set(e.to, cur.id);
      open.push({ id: e.to }, tentative + h(e.to));
    }
  }
  return null;
}

// How far a path actually is, in feet, and which rooms it crossed on the way.
//
// `findPath` optimises `cost` — the number with the stair penalties and the
// lift's wait folded into it — and every reader that wants to print a distance
// wants `dist` instead, which is the same route measured in feet. Phase 7 got
// away without this because egress measures its distances with a field rather
// than a path; Phase 15's passing-period travel is one named room to another
// named room, which is a path, and a number about the school day that quoted
// the lift's wait in feet would be a number about nothing.
export function pathDistance(nav, path, opts = {}) {
  if (!nav || !path || path.length < 2) {
    return { dist: 0, cost: 0, rooms: [], links: 0, outdoor: 0 };
  }
  let dist = 0, cost = 0, links = 0, outdoor = 0;
  const rooms = [];
  for (let i = 1; i < path.length; i++) {
    const e = edgeOn(nav, path[i - 1], path[i], opts);
    if (!e) continue;
    dist += e.dist;
    cost += e.cost;
    // How much of the walk is out on the site. Zero for every design before
    // Phase 17 and for every scheme but the campus after it — where it is the
    // number that says what the scheme costs you in February.
    if (e.yard) outdoor += e.dist;
    if (e.room && rooms[rooms.length - 1] !== e.room) rooms.push(e.room);
  }
  // How many times the route changed storey — a stair, a ramp or a lift, each
  // of which is one node in the path and none of which is a distance in feet.
  for (const id of path) {
    const n = nodeOf(nav, id, opts);
    if (n && n.kind === 'link') links++;
  }
  return { dist, cost, rooms, links, outdoor };
}

// Does this route leave the building? True for a step across the site as well
// as for a node standing on it — two doors on one piece of ground are joined
// directly, so a path between two blocks of a campus can go outdoors without
// visiting a single outdoor *node*.
export function goesOutdoors(nav, path, opts = {}) {
  if (!nav || !path || path.length < 2) return false;
  for (let i = 1; i < path.length; i++) {
    if (outdoors(nav, path[i])) return true;
    const e = edgeOn(nav, path[i - 1], path[i], opts);
    if (e && e.yard) return true;
  }
  return false;
}

// A node path, as somewhere to put your feet. Gates and room nodes contribute
// one point each; a doorway contributes two — the side you arrive at and the
// side you leave by — and a link contributes two, the landing you walk to and
// the one you arrive at.
//
// **Which side of a doorway you came from is read off the edge you came in
// on**, not off the node before it. Under the portal graph the node before a
// doorway was always one of the two rooms it joined, so comparing ids was
// enough; on the mesh a route arrives at a door from the gate or the door it
// was last standing beside, and the only thing that still knows which room
// the walk was crossing is the edge itself.
export function waypoints(nav, path, opts = {}) {
  if (!path || !path.length) return [];
  const out = [];
  let floor = opts.floor ?? (nodeOf(nav, path[0], opts)?.floor ?? 0);
  for (let i = 0; i < path.length; i++) {
    const n = nodeOf(nav, path[i], opts);
    if (!n) continue;
    const inEdge = i > 0 ? edgeOn(nav, path[i - 1], path[i], opts) : null;
    const outEdge = i + 1 < path.length ? edgeOn(nav, path[i], path[i + 1], opts) : null;
    if (n.kind === 'portal') {
      // `room === n.a` reads true for an exterior door approached from the
      // outside as well, since both sides of that comparison are null there.
      let fromA;
      if (inEdge) fromA = inEdge.room === n.a;
      else if (outEdge) fromA = outEdge.room !== n.a;
      else {
        const at = opts.at || out[out.length - 1] || n.pa;
        fromA = (at.x - n.pa.x) ** 2 + (at.z - n.pa.z) ** 2
          <= (at.x - n.pb.x) ** 2 + (at.z - n.pb.z) ** 2;
      }
      const first = fromA ? n.pa : n.pb;
      const second = fromA ? n.pb : n.pa;
      out.push({ x: first.x, z: first.z, floor: n.floor, kind: 'door', node: n.id, portal: n });
      out.push({ x: second.x, z: second.z, floor: n.floor, kind: 'door', node: n.id, portal: n });
      floor = n.floor;
    } else if (n.kind === 'link') {
      // Which way you are travelling it: whichever end you are not already on.
      // A link reached from the room below is climbed; one reached from above
      // is descended, and a route that only walks past its foot never gets
      // here at all.
      const up = Math.abs(floor - n.a.floor) <= Math.abs(floor - n.b.floor);
      const first = up ? n.a : n.b;
      const second = up ? n.b : n.a;
      out.push({ x: first.x, z: first.z, floor: first.floor, kind: 'link', node: n.id, link: n.link });
      out.push({ x: second.x, z: second.z, floor: second.floor, kind: 'ride', node: n.id, link: n.link });
      floor = second.floor;
    } else if (n.kind === 'outside') {
      // The outside hub has no place of its own: the last real point on the
      // way out was the door, and where you go from there is the caller's
      // business (a muster point, a bus, a bench).
      continue;
    } else if (n.kind === 'point') {
      // Where the walker already is. It is in the path so that the first edge
      // out of it knows which room it crosses; it is not somewhere to walk to.
      continue;
    } else {
      out.push({
        x: n.x, z: n.z, floor: n.floor,
        kind: n.kind === 'gate' ? 'walk' : n.kind,
        node: n.id,
      });
      floor = n.floor;
    }
  }
  return out;
}

// A point on the mesh, as a node the graph doesn't have: joined to everything
// standing on the tile the point is standing on, at the straight line to each.
// This is what makes a route start from where somebody actually is rather than
// from the middle of the room they are in — the last detour the hub left
// behind, and the cheapest one to remove.
export function pointEntry(nav, from) {
  const roomId = nav.roomIdAt(from.floor ?? 0, from.x, from.z);
  // Outdoors, the same trick over the same kind of tile: somebody standing in
  // the car park is joined to the doors and gates on that piece of ground at
  // the straight line to each, rather than teleported onto a hub that was
  // forty-five feet from every door in the school.
  const found = roomId
    ? tileFor(nav.mesh[from.floor ?? 0], roomId, from.x, from.z)
    : yardTileFor(nav.yard, from.x, from.z);
  if (!roomId && !found) return nav.outside ? { id: nav.outside } : null;
  if (!found || !found.tile.anchors.length) return { id: roomId || nav.outside };
  const id = '@';
  const node = { id, kind: 'point', floor: from.floor ?? 0, x: from.x, z: from.z, room: roomId };
  if (!roomId) node.outdoors = true;
  const edges = found.tile.anchors.map((a) => {
    const d = Math.hypot(a.x - from.x, a.z - from.z);
    return { to: a.id, cost: d + a.extra, dist: d + a.span, room: found.tile.room || null };
  });
  return {
    id,
    opts: { nodes: new Map([[id, node]]), adj: new Map([[id, edges]]) },
  };
}

// A whole route between two points, as waypoints. The start point itself is
// not in it — an agent is already standing on it — but every step after it is
// measured from there rather than from the middle of the room it is in.
export function route(nav, from, toId) {
  const entry = pointEntry(nav, from);
  if (!entry) return null;
  const opts = entry.opts || {};
  const path = findPath(nav, entry.id, toId, opts);
  if (!path) return null;
  const wp = waypoints(nav, path, { ...opts, floor: from.floor, at: from });
  // A route that begins at the room you are standing in begins with a walk to
  // that room's own node, which is a detour to the middle of the room you are
  // leaving. It goes — unless it is where you were headed.
  if (wp.length > 1 && wp[0].node === entry.id) wp.shift();
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
  const metric = !!opts.metric;
  const weight = metric ? (e) => e.dist : (e) => e.cost;
  const dist = new Map();
  const via = new Map();
  if (!nav || !nav.exits.length) return { dist, via, reached: 0, metric };
  const open = new MinHeap();
  for (const e of nav.exits) {
    dist.set(e.id, 0);
    via.set(e.id, e.id);
    open.push({ id: e.id, d: 0 }, 0);
  }
  const done = new Set();
  while (open.size) {
    const cur = open.pop();
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    for (const e of nav.adj.get(cur.id) || []) {
      // The outdoors is where you are going, not somewhere you pass through: a
      // route that leaves by one door and comes back in another is not egress.
      // That was one comparison against the outside hub until Phase 17 gave
      // the site real tiles; it is the same rule, asked of all of them.
      if (outdoors(nav, e.to)) continue;
      const d = cur.d + weight(e);
      if (d >= (dist.get(e.to) ?? Infinity)) continue;
      dist.set(e.to, d);
      via.set(e.to, via.get(cur.id));
      open.push({ id: e.to, d }, d);
    }
  }
  return { dist, via, reached: dist.size, metric };
}

// How far it is out of the building **from a point**, rather than from the
// room the point is in. This is the mesh cashed in: the tile under your feet
// is convex, so the walk to anything standing on it is the straight line, and
// the field already knows how far each of those is from a door. Phase 7's
// travel distances were the hub's distance plus the room's own radius, which
// double-counted the room every time; this is what a tape measure says.
// `known` names the room the point belongs to when the caller already knows —
// a room's own corner sits *on* its boundary, and asking a point-in-polygon
// test which side of itself a vertex is on has no answer worth having.
export function pointField(nav, field, floorIndex, x, z, known = null) {
  if (!nav || !field) return null;
  const roomId = known || nav.roomIdAt(floorIndex, x, z);
  if (!roomId) return null;
  const found = nav.mesh[floorIndex] ? tileFor(nav.mesh[floorIndex], roomId, x, z) : null;
  if (!found) {
    const d = field.dist.get(roomId);
    return d === undefined ? null : { dist: d, via: field.via.get(roomId), room: roomId };
  }
  let best = null;
  for (const a of found.tile.anchors) {
    const reach = field.dist.get(a.id);
    if (reach === undefined) continue;
    const step = Math.hypot(a.x - x, a.z - z) + (field.metric ? a.span : a.extra);
    const total = reach + step;
    if (!best || total < best.dist) best = { dist: total, via: field.via.get(a.id), room: roomId };
  }
  return best;
}

// The exit a point should leave by, and how far it is. Null when the design
// has no exterior door, or when this part of it can't reach one — which is
// itself worth knowing, and is exactly what Phase 7 will report.
export function nearestExit(nav, field, floorIndex, x, z) {
  const at = pointField(nav, field, floorIndex, x, z);
  if (!at || !at.via) return null;
  const exit = nav.nodes.get(at.via);
  return { exit, dist: at.dist };
}

// ---------- exit discharge ----------

// How far it is from every exterior door to the public way, over the ground
// rather than through it. Multi-source Dijkstra from the way nodes, the same
// shape as `egressField` and for the same reason: one queue rather than one
// search per door.
//
// **It never goes back inside.** A discharge route that entered one door and
// left by another would be a corridor with a lawn in it. So the walk relaxes
// into outdoor nodes and into exterior doorways, and an exterior doorway is
// settled rather than expanded — you have arrived at it, and what is on the
// far side of it is the building's problem, not the site's.
//
// How steep the walk is is deliberately *not* here. It is a property of the
// route that comes out rather than of the search, and charging it per edge
// would mean charging the steepest cell of a five-hundred-foot lawn to a route
// that crosses one corner of it. `sitemesh.js`'s `pathGrade` measures the line
// the route actually walks, once, afterwards.
export function dischargeField(nav) {
  const dist = new Map();
  const via = new Map();
  const prev = new Map();
  const ways = (nav && nav.ways) || [];
  if (!ways.length) return { dist, via, prev, ways: 0 };
  const open = new MinHeap();
  for (const w of ways) {
    dist.set(w.id, 0);
    via.set(w.id, w.id);
    open.push({ id: w.id, d: 0 }, 0);
  }
  const done = new Set();
  while (open.size) {
    const cur = open.pop();
    if (done.has(cur.id)) continue;
    done.add(cur.id);
    const here = nav.nodes.get(cur.id);
    // A doorway is where the site stops.
    if (here && here.kind === 'portal') continue;
    for (const e of nav.adj.get(cur.id) || []) {
      if (e.to === nav.outside) continue;
      const n = nav.nodes.get(e.to);
      if (!n) continue;
      if (!n.outdoors && !(n.kind === 'portal' && n.exterior)) continue;
      const d = cur.d + e.dist;
      if (d >= (dist.get(e.to) ?? Infinity)) continue;
      dist.set(e.to, d);
      via.set(e.to, via.get(cur.id));
      prev.set(e.to, cur.id);
      open.push({ id: e.to, d }, d);
    }
  }
  return { dist, via, prev, ways: ways.length };
}

// The route itself, as node ids from the door to the public way. Read off the
// field's own back-pointers rather than searched for again.
export function dischargePath(field, exitId) {
  if (!field || !field.dist.has(exitId)) return null;
  const path = [exitId];
  let at = exitId;
  while (field.prev.has(at)) { at = field.prev.get(at); path.push(at); }
  return path;
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
    // What the rooms are actually made of, since Phase 10: the rectangles the
    // walk is measured across, and the seams between them.
    tiles: nav.mesh.reduce((n, m) => n + m.tiles.length, 0),
    gates: nav.gates.length,
    outside: !!nav.outside,
    // ...and what the outdoors came out as, since Phase 17. Zero of both on a
    // sealed building, which is the one design that genuinely has no outside.
    yard: nav.yard ? nav.yard.tiles.length : 0,
    ways: nav.ways ? nav.ways.length : 0,
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
