// signage.js — the signs a building already knows it needs.
//
// A school is covered in lettering and none of it is a design decision: the
// placard beside a classroom door says what the room record already says, and
// the illuminated EXIT over a door is over that door because the egress graph
// calls it an exit. Both are *derivations*, and this file is the one that
// makes them. Nothing here is stored, nothing here is placed by hand, and
// there is no signage tool — which is the point. Draw a room called "Room 104"
// and 104 appears beside its door; move the door and the sign moves with it.
//
// **Where a placard goes** is not the middle of the wall. ADA 703.4.2 puts a
// room sign on the *latch* side of the door, outside the room, with its centre
// between 48 and 60 inches off the floor — and the model already knows which
// jamb is the latch, because an opening records which one it hinges on. So the
// rule reads straight off the record: `hand` +1 hinges at the start of the
// run, so the latch is at the far end and the sign goes past `t1`; `hand` -1
// and it goes before `t0`. (The hand/sw convention is relative to the run, and
// everything below stays inside one segment's own frame, so nothing here has
// to flip anything — see the convention in the WISHLIST before changing that.)
//
// **Which side is outside** the room is `shapeAt`'s answer, probed off the
// segment's normal at walls.js's own probe distance. A sign that faced into
// the classroom would be a sign for the people who already know where they
// are — and a door with the same room on both sides, or with the weather on
// one of them, is signed on neither.
//
// **Exit signs stand over the exits the egress graph found**, not over every
// exterior door and not over doors somebody tagged. That is the same list
// `egressAnalysis` prices in inches of clear width, so the building's code
// analysis and the thing you can see from inside it can never disagree.
//
// Pure module: no three.js, no DOM, no canvas. Exercised by
// test/signage.test.mjs.

import { DOOR_H, WALL_H } from './grid.js';
import { shapesOf, segEnds, openingSpec, shapeAt, isBuilt, OP_DOOR } from './shapes.js';
import { wallLinesOf, lineEnds, lineKind, lineOpenings } from './wallrun.js';
import { wallProbe, WALL_T_EXT } from './walls.js';
import { buildNav } from './navgraph.js';
import { classify, isGroup } from './occupancy.js';
import { roomNumber } from './timetable.js';

// ---------- how big a sign is ----------
//
// Real sizes, in feet. A room placard is a 6x8in plate; an exit sign is the
// 8x12in box every corridor in America has over its door.
export const PLACARD_W = 0.67;
export const PLACARD_H = 0.5;
// Centre height. ADA 703.4.1 allows 48–60in to the baseline of the lowest
// line; five feet to the middle of the plate sits comfortably inside that and
// is what a tape measure finds on a real door.
export const PLACARD_Y = 5;
// How far past the jamb the plate sits, edge to edge — enough that it is
// beside the door rather than on its frame.
export const PLACARD_GAP = 0.45;
// How far proud of the wall face any sign stands.
export const SIGN_CLEAR = 0.09;

export const EXIT_W = 1.0;
export const EXIT_H = 0.67;
// Over the door and under the ceiling. A door head is 7ft, a wall is 10ft, and
// the sign wants to clear the frame without touching the slab — so it hangs
// from the higher of "just over this door" and "under this ceiling", and takes
// the lower of the two when a low ceiling and a tall door argue.
export const EXIT_GAP = 0.75;

// A storey's worth of signs, and then some. A design that trips this has more
// doors than a school has, and the cap is what keeps one merged sign mesh from
// becoming the most expensive thing in the scene.
export const MAX_SIGNS = 400;
// A room with three doors onto the same corridor does not get three plates.
export const SIGNS_PER_ROOM = 2;

// ---------- what gets a placard ----------

// The use a room reads as, on the same precedence occupancy.js uses: what
// somebody picked beats what the label says. Kept to those two — a signage
// module has no business asking about occupant loads.
export const useOf = (shape) =>
  (shape && isGroup(shape.group) ? shape.group : classify(shape && shape.name));

// A corridor has no placard, and neither does a lobby or a stair: you do not
// sign the space, you sign the doors off it. Everything else with a name does.
export const signable = (shape) =>
  !!(shape && typeof shape.name === 'string' && shape.name.trim())
  && useOf(shape) !== 'circulation';

// What a plate says. The number is the trailing number of the name — the same
// one `bindRoom` binds a timetable by, imported rather than re-derived — and
// the label is what is left once the number is taken off the end. "Room 104"
// prints 104 over ROOM; "Kitchen" prints Kitchen and nothing else; "104"
// prints 104 alone.
export function placardText(shape) {
  const name = String((shape && shape.name) || '').trim();
  const number = roomNumber(name);
  if (!number) return { name, number: null, label: name };
  const label = name.slice(0, name.length - number.length).trim().replace(/[-–—:,]+$/, '').trim();
  return { name, number: number.toUpperCase(), label };
}

// ---------- placards ----------

// **Every door on the storey, not every door a room owns.** The distinction is
// the whole of why this reads the way it does: a partition belongs to exactly
// one of the two rooms it divides (see the convention), so half the classrooms
// in any real plan have no opening on their own rings at all — theirs is
// recorded on the corridor that shares the wall. Signing a room from its own
// openings therefore signs about half a school and looks, from the outside,
// exactly like a placement bug. So a door is collected once, from wherever it
// is recorded, and *the geometry* says which rooms it divides.
//
// Each entry is a run in its own frame — `a` to `b`, the spec, and nothing
// about who owns it.
function doorsOn(floor) {
  const out = [];
  const take = (a, b, kind, o) => {
    const spec = openingSpec(o);
    if (spec.kind !== OP_DOOR) return;
    if (!isBuilt(kind)) return;
    out.push({ a, b, spec });
  };
  for (const shape of shapesOf(floor)) {
    for (const ring of shape.rings) {
      if (!ring || !ring.openings) continue;
      for (const o of ring.openings) {
        const seg = Number.isInteger(o.seg) ? o.seg : 0;
        if (seg < 0 || seg >= ring.pts.length) continue;
        const [a, b] = segEnds(ring, seg);
        take(a, b, ring.walls ? ring.walls[seg] : 0, o);
      }
    }
  }
  // ...and the doors cut into a free-standing wall, which belongs to the
  // storey and to no room at all.
  for (const line of wallLinesOf(floor)) {
    const [a, b] = lineEnds(line);
    for (const o of lineOpenings(line)) take(a, b, lineKind(line), o);
  }
  // A stable order, so a rebuild puts the same plate in the same place.
  return out.sort((p, q) => (p.a.x - q.a.x) || (p.a.z - q.a.z) || (p.spec.t - q.spec.t));
}

// One placard for one room, beside one door, or null when there is nowhere on
// the wall to put one. `side` is which side of the run the plate goes on: +1
// for the run's left-hand normal, -1 for its right.
function placardAt(shape, door, side, thickness, floorIndex) {
  const { a, b, spec } = door;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.01) return null;
  const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
  // The run's left-hand normal, the same one walls.js probes with side +1.
  const nx = -uz, nz = ux;

  const half = spec.w / 2;
  const centre = spec.t * L;
  // The latch jamb: the end of the run when the leaf hangs on the start.
  const latch = spec.hand === 1 ? 1 : -1;
  // ...and if the wall runs out on that side, the other one will do. A plate
  // on the hinge side beats no plate; one floating past the corner does not.
  const margin = PLACARD_W / 2 + 0.1;
  const reach = half + PLACARD_GAP + PLACARD_W / 2;
  let at = centre + latch * reach;
  if (at < margin || at > L - margin) {
    at = centre - latch * reach;
    if (at < margin || at > L - margin) return null;
  }

  const px = a.x + ux * at, pz = a.z + uz * at;
  const t = thickness(a.x, a.z, b.x, b.z);
  const off = t / 2 + SIGN_CLEAR;
  const text = placardText(shape);
  return {
    kind: 'placard',
    roomId: shape.id,
    floor: floorIndex,
    // The plate's own middle, standing proud of the wall face.
    x: px + nx * side * off,
    z: pz + nz * side * off,
    y: PLACARD_Y,
    // A plane's own +Z faces the way it is turned, so this is the outward
    // normal read as a heading — the same `atan2(x, z)` convention agents.js
    // faces a body with.
    yaw: Math.atan2(nx * side, nz * side),
    w: PLACARD_W,
    h: PLACARD_H,
    name: text.name,
    number: text.number,
    label: text.label,
  };
}

// Every room placard on one storey. `floorIndex` is which storey; the shapes
// carry no storey of their own, so it is stamped onto each sign here for the
// benefit of everything downstream that draws per floor.
export function placardsFor(state, floorIndex, opts = {}) {
  const floor = state && state.floors && state.floors[floorIndex];
  if (!floor) return [];
  const cap = opts.max ?? MAX_SIGNS;
  if (cap <= 0) return [];
  const thickness = wallProbe(floor);
  const made = new Map();      // room id -> plates so far
  const out = [];
  for (const door of doorsOn(floor)) {
    if (out.length >= cap) break;
    const { a, b, spec } = door;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.01) continue;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const nx = -uz, nz = ux;
    const px = a.x + ux * spec.t * L, pz = a.z + uz * spec.t * L;
    // Far enough off the boundary to clear the wall and still land inside the
    // room on the other side of it — walls.js's own probe distance.
    const probe = Math.max(1.2, thickness(a.x, a.z, b.x, b.z) + 0.6);
    const left = shapeAt(floor, px + nx * probe, pz + nz * probe);
    const right = shapeAt(floor, px - nx * probe, pz - nz * probe);
    // A doorway inside one room divides nothing, and a door onto the weather
    // has no reader on the far side: you do not sign the outdoors.
    if (!left || !right || left === right) continue;
    for (const [room, side] of [[left, -1], [right, 1]]) {
      if (!signable(room)) continue;
      const n = made.get(room.id) || 0;
      if (n >= SIGNS_PER_ROOM || out.length >= cap) continue;
      // The plate goes on the *other* side of the door from the room it names.
      const sign = placardAt(room, door, side, thickness, floorIndex);
      if (!sign) continue;
      out.push(sign);
      made.set(room.id, n + 1);
    }
  }
  return out;
}

// ---------- exit signs ----------

// How high over a door an exit sign hangs, given the door's own head height.
// Stated as a function because the two limits argue on a low ceiling and the
// answer has to be the same everywhere it is asked.
export function exitSignY(headH = DOOR_H, wallH = WALL_H) {
  const over = headH + EXIT_GAP;
  const under = wallH - EXIT_H / 2 - 0.25;
  return Math.max(headH + EXIT_H / 2 + 0.1, Math.min(over, under));
}

// One glowing EXIT over each of the egress graph's own exits, facing back into
// the building — the sign is for the person looking for the way out, not for
// the car park.
//
// `opts.nav` reuses a graph the caller already built, the same bargain
// `egressAnalysis` offers; without one this builds its own.
export function exitSignsFor(state, opts = {}) {
  if (!state || !state.floors || !state.floors.length) return [];
  const nav = opts.nav || buildNav(state);
  const cap = opts.max ?? MAX_SIGNS;
  const out = [];
  for (const p of nav.exits || []) {
    if (out.length >= cap) break;
    const floor = state.floors[p.floor];
    if (!floor) continue;
    // The portal's normal points out of the building. The sign faces the other
    // way, and stands proud of the inside face of the wall.
    const nx = -p.nx, nz = -p.nz;
    const len = Math.hypot(nx, nz);
    if (!(len > 1e-6)) continue;
    const ux = nx / len, uz = nz / len;
    // A door onto the site is in an exterior wall by construction — that is
    // what made it an exit — so `WALL_T_EXT` is the thickness, not a guess.
    const off = WALL_T_EXT / 2 + SIGN_CLEAR;
    out.push({
      kind: 'exit',
      id: p.id,
      floor: p.floor,
      x: p.x + ux * off,
      z: p.z + uz * off,
      y: exitSignY(DOOR_H, WALL_H),
      yaw: Math.atan2(ux, uz),
      w: EXIT_W,
      h: EXIT_H,
      // What the exit is worth, so a reader that wants to say "this one is
      // narrow" has the number without going back to the graph.
      clear: p.w,
    });
  }
  return out;
}

// ---------- everything, once ----------

// Both kinds for one storey, which is what render.js asks for per floor.
export function signsFor(state, floorIndex, opts = {}) {
  const placards = placardsFor(state, floorIndex, opts);
  const exits = (opts.exits || exitSignsFor(state, opts))
    .filter((s) => s.floor === floorIndex);
  return { placards, exits };
}
