// autofurnish.js — "make this a science lab": one room, one label, a layout
// fitted to it.
//
// The wishlist calls this the generator's smallest useful piece and says it is
// shippable first, which turned out to be exactly right — the whole-school
// generator in generate.js furnishes what it builds by calling straight into
// this file, and the Layout tool's "Auto" swatch calls the same function on
// one room you click.
//
// Three things happen here that `templatePlacements` doesn't do on its own:
//
//   **Choose.** A room called "Science Lab 2" wants the science bench layout
//   and a room called "Room 104" wants desks. That is a name-matching table
//   walked in order, the same shape and the same hazards as occupancy.js's
//   use table — and deliberately a *separate* table, because the two answer
//   different questions. Occupancy wants to know how many people fit in a
//   music room; this wants to know whether there is a template with a piano
//   in it. Where they agree they agree by coincidence of vocabulary, not by
//   sharing a row.
//
//   **Aim.** A classroom template has a front — the whiteboard wall — and
//   putting it against the door is how you get a room where the class sits
//   with its back to the board. So the layout is turned to fit the room's
//   proportions and then faced so its *back* is at the doorway: you walk in
//   behind the students and look at what they are looking at.
//
//   **Cull.** A 22ft template in a 16ft room would otherwise plant desks in
//   the wall. Every stamp is tested against the room it is going into — the
//   polygon, or the flood-filled cell region — with its own footprint as the
//   clearance, and anything that doesn't fit is dropped rather than shrunk.
//   Culling means the layout degrades to "fewer desks" instead of to
//   "furniture in the corridor", which is the behaviour a generator needs
//   when it is stamping ninety rooms nobody is going to check by eye.
//
// Pure module: no three.js, no DOM. Exercised by test/autofurnish.test.mjs.

import { CELL, getCell, edgeHIdx, edgeVIdx, isDoorEdge, floorAt } from './grid.js';
import { shapeById, shapeBBox, pointInShape, segEnds, isDoorOpening } from './shapes.js';
import { catalogEntry as defaultCatalogEntry } from './catalog.js';
import { templateByKey, templatePlacements, ROOM_TEMPLATES } from './templates.js';
import { floorRooms } from './navgraph.js';

// ---------- which layout a name asks for ----------
//
// Ordered, first match wins, specific above general — and every gotcha
// occupancy.js hit is here too. "Storeroom" contains "room"; "Learning
// Commons" is a library and "Dining Commons" is a cafeteria; a bare room
// *number* is a classroom and the bare word "room" is not.
export const ROOM_LAYOUTS = [
  { tpl: 'gym-court', match: /gym|gymnas|sports hall|fieldhouse|field house/ },
  { tpl: 'cafeteria-block', match: /cafeteria|cafetorium|dining|lunch ?room|canteen|servery/ },
  { tpl: 'library-aisle', match: /librar|media cent|learning commons|reading room/ },
  // Above the science row, which claims a bare "lab": a computer lab is a lab
  // and the bench layout is not what anybody means by one.
  { tpl: 'computer-lab-row', match: /computer|\bict\b|coding|technology lab/ },
  { tpl: 'science-lab', match: /\blab\b|laborator|science|chem|physics|biolog|makerspace|maker space|\bshop\b|wood ?shop|metal ?shop|tech ed/ },
  { tpl: 'music-room', match: /music|band|choir|orchestra|chorus/ },
  { tpl: 'restroom', match: /restroom|rest room|toilet|bathroom|washroom|\bwc\b|lavator/ },
  { tpl: 'front-office', match: /office|admin|reception|principal|counsel|health|clinic|nurse|conference|meeting|workroom|work ?room|staff/ },
  { tpl: 'kindergarten-corner', match: /kindergarten|\bpre-?k\b|\bkinder\b|early years|nursery/ },
  { tpl: 'locker-hallway', match: /corridor|hall(?!ow)|hallway|locker|lobby|vestibul|foyer/ },
  { tpl: 'reading-corner', match: /reading|resource room|breakout|quiet room|sensory/ },
  { tpl: 'classroom', match: /classroom|class ?rm|home ?room|seminar|art|studio|\broom\s*\d|\brm\.?\s*\d|^\d{1,4}[a-z]?$|grade \d/ },
  // Everything left over gets light and nothing else. A storeroom with a
  // classroom stamped in it is worse than a storeroom with a fixture in it,
  // and "I didn't know what this was" is a legitimate answer.
  { tpl: 'lighting-bay', match: /storage|storeroom|store ?room|mech|electric|boiler|custodi|janitor|utility|closet|stair|elevator/ },
];

// Layouts that repeat across a room bigger than one of them. A cafeteria is
// bays of tables and a library is aisles of stacks; a classroom is not two
// classrooms, however big the room gets.
export const TILEABLE = new Set([
  'cafeteria-block', 'library-aisle', 'computer-lab-row', 'lighting-bay', 'locker-hallway',
]);

export function templateForRoom(name) {
  const s = (name || '').toLowerCase().trim();
  if (!s) return null;
  for (const row of ROOM_LAYOUTS) if (row.match.test(s)) return row.tpl;
  return null;
}

// ---------- what shape the room is ----------
//
// A `floorRooms` row plus the floor it came from is enough to answer "is this
// point in the room" for either representation, which is all the culling
// needs. Grid regions are the awkward half, as always: the row carries a cell
// *count* and a hub, not the cells, so the region is re-flooded from the hub.
// The standing tax, collected again.

function gridCellsOf(floor, room) {
  const cx = Math.floor(room.x / CELL), cy = Math.floor(room.z / CELL);
  const seen = new Set();
  const cells = [];
  const stack = [[cx, cy]];
  const key = (x, y) => y * floor.w + x;
  if (!getCell(floor, cx, cy)) return cells;
  seen.add(key(cx, cy));
  while (stack.length) {
    const [x, y] = stack.pop();
    cells.push({ x, y });
    const step = (nx, ny, edge) => {
      if (nx < 0 || ny < 0 || nx >= floor.w || ny >= floor.h) return;
      if (edge) return;                       // a boundary of any kind stops the flood
      if (!getCell(floor, nx, ny)) return;
      const k = key(nx, ny);
      if (seen.has(k)) return;
      seen.add(k);
      stack.push([nx, ny]);
    };
    step(x - 1, y, floor.edgesV[edgeVIdx(floor, x, y)]);
    step(x + 1, y, floor.edgesV[edgeVIdx(floor, x + 1, y)]);
    step(x, y - 1, floor.edgesH[edgeHIdx(floor, x, y)]);
    step(x, y + 1, floor.edgesH[edgeHIdx(floor, x, y + 1)]);
  }
  return cells;
}

// `{ inside(x, z), box, doors }` for one room. `box` is world feet, `doors`
// are the midpoints of every opening on the room's boundary — which is what
// decides which way the layout faces.
export function roomGeometry(state, floorIndex, room) {
  const floor = floorAt(state, floorIndex);
  if (!floor || !room) return null;

  if (room.rep === 'shape') {
    const shape = room.shape || shapeById(floor, Number(String(room.id).split(':s')[1]));
    if (!shape) return null;
    const bb = shapeBBox(shape);
    const doors = [];
    for (const ring of shape.rings) {
      for (const op of ring.openings || []) {
        if (!isDoorOpening(op)) continue;
        const [a, b] = segEnds(ring, op.seg);
        if (!a || !b) continue;
        doors.push({ x: a.x + (b.x - a.x) * op.t, z: a.z + (b.z - a.z) * op.t });
      }
    }
    return {
      rep: 'shape',
      box: { x0: bb.x0, z0: bb.z0, x1: bb.x1, z1: bb.z1 },
      inside: (x, z) => pointInShape(shape, x, z),
      doors,
    };
  }

  const cells = gridCellsOf(floor, room);
  if (!cells.length) return null;
  const set = new Set(cells.map((c) => c.y * floor.w + c.x));
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const doors = [];
  for (const c of cells) {
    x0 = Math.min(x0, c.x * CELL); x1 = Math.max(x1, (c.x + 1) * CELL);
    z0 = Math.min(z0, c.y * CELL); z1 = Math.max(z1, (c.y + 1) * CELL);
    if (isDoorEdge(floor.edgesH[edgeHIdx(floor, c.x, c.y)]))
      doors.push({ x: (c.x + 0.5) * CELL, z: c.y * CELL });
    if (isDoorEdge(floor.edgesH[edgeHIdx(floor, c.x, c.y + 1)]))
      doors.push({ x: (c.x + 0.5) * CELL, z: (c.y + 1) * CELL });
    if (isDoorEdge(floor.edgesV[edgeVIdx(floor, c.x, c.y)]))
      doors.push({ x: c.x * CELL, z: (c.y + 0.5) * CELL });
    if (isDoorEdge(floor.edgesV[edgeVIdx(floor, c.x + 1, c.y)]))
      doors.push({ x: (c.x + 1) * CELL, z: (c.y + 0.5) * CELL });
  }
  return {
    rep: 'grid',
    box: { x0, z0, x1, z1 },
    inside: (x, z) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(z / CELL);
      if (cx < 0 || cy < 0 || cx >= floor.w || cy >= floor.h) return false;
      return set.has(cy * floor.w + cx);
    },
    doors,
  };
}

// ---------- aiming the layout ----------

const TURNS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

// A template's local +Z is "into the room, away from the front wall". Turned
// by θ, that points along world (sinθ, cosθ) — the same convention
// `templatePlacements` rotates a stamp by, so the two can never drift.
const backDirection = (theta) => ({ x: Math.sin(theta), z: Math.cos(theta) });

function chooseRotation(tpl, geo, opts = {}) {
  if (typeof opts.rotationY === 'number') return opts.rotationY;
  const bw = geo.box.x1 - geo.box.x0, bd = geo.box.z1 - geo.box.z0;
  const cx = (geo.box.x0 + geo.box.x1) / 2, cz = (geo.box.z0 + geo.box.z1) / 2;
  // Toward the doors, averaged — a room with two doors on the same wall gets
  // that wall, and a room with doors on opposite walls gets a coin toss that
  // at least isn't random.
  let dx = 0, dz = 0;
  for (const d of geo.doors) { dx += d.x - cx; dz += d.z - cz; }
  const len = Math.hypot(dx, dz);
  if (len > 0.001) { dx /= len; dz /= len; }

  let best = 0, bestScore = -Infinity;
  for (const theta of TURNS) {
    const swap = Math.abs(Math.sin(theta)) > 0.5;
    const fw = swap ? tpl.footprint.d : tpl.footprint.w;
    const fd = swap ? tpl.footprint.w : tpl.footprint.d;
    // Fitting the room's proportions is worth far more than facing the door:
    // a layout that runs the wrong way across a long thin room is wrong in a
    // way nobody has to be told, and a board on the side wall merely reads as
    // an unusual classroom.
    const fits = (fw <= bw + 0.01 ? 1 : bw / fw) * (fd <= bd + 0.01 ? 1 : bd / fd);
    const back = backDirection(theta);
    const facing = len > 0.001 ? back.x * dx + back.z * dz : 0;
    const score = fits * 4 + facing;
    if (score > bestScore) { bestScore = score; best = theta; }
  }
  return best;
}

// ---------- fitting and culling ----------

// Anchors the template is stamped at. One at the room's centre normally; a
// grid of them across the room for the layouts that tile.
function anchorsFor(tpl, geo, rotationY) {
  const cx = (geo.box.x0 + geo.box.x1) / 2, cz = (geo.box.z0 + geo.box.z1) / 2;
  if (!TILEABLE.has(tpl.key)) return [{ x: cx, z: cz }];
  const swap = Math.abs(Math.sin(rotationY)) > 0.5;
  const fw = Math.max(2, swap ? tpl.footprint.d : tpl.footprint.w);
  const fd = Math.max(2, swap ? tpl.footprint.w : tpl.footprint.d);
  const bw = geo.box.x1 - geo.box.x0, bd = geo.box.z1 - geo.box.z0;
  const nx = Math.max(1, Math.floor(bw / fw));
  const nz = Math.max(1, Math.floor(bd / fd));
  if (nx === 1 && nz === 1) return [{ x: cx, z: cz }];
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      out.push({
        x: geo.box.x0 + bw * (i + 0.5) / nx,
        z: geo.box.z0 + bd * (j + 0.5) / nz,
      });
    }
  }
  return out;
}

// Is there room for this piece here? A floor-standing prop needs its own
// footprint clear of the boundary; a wall or ceiling mount is *supposed* to
// be against something, so it only has to be in the room at all.
function stampFits(pl, geo, entry) {
  if (!geo.inside(pl.x, pl.z)) return false;
  if (!entry || entry.mount !== 'floor') return true;
  const c = Math.cos(pl.rotationY || 0), s = Math.sin(pl.rotationY || 0);
  const hw = (entry.w || 1) / 2, hd = (entry.d || 1) / 2;
  for (const [ox, oz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
    if (!geo.inside(pl.x + ox * c + oz * s, pl.z - ox * s + oz * c)) return false;
  }
  return true;
}

// The placements one room's layout comes to: chosen, aimed, tiled if it tiles,
// and culled. `{ placements, tpl, rotationY, dropped }` — `dropped` is how
// many stamps didn't fit, which is the number that tells you the template was
// too big for the room rather than that the room was empty.
export function furnishRoom(state, floorIndex, room, opts = {}) {
  const catalogGet = opts.catalogGet || defaultCatalogEntry;
  const key = opts.template || templateForRoom(room && room.name);
  const tpl = key ? templateByKey(key) : null;
  if (!tpl) return { placements: [], tpl: null, key, rotationY: 0, dropped: 0, reason: 'no layout for this name' };
  const geo = opts.geometry || roomGeometry(state, floorIndex, room);
  if (!geo) return { placements: [], tpl, key, rotationY: 0, dropped: 0, reason: 'room has no shape' };

  const rotationY = chooseRotation(tpl, geo, opts);
  const placements = [];
  let dropped = 0;
  // A tiled layout stamps the same props at several anchors, so the same
  // spot can be claimed twice by two neighbouring bays; a coarse dedupe on
  // position keeps a stack of two trash cans out of the corner.
  const taken = new Set();
  for (const anchor of anchorsFor(tpl, geo, rotationY)) {
    for (const pl of templatePlacements(tpl, anchor.x, anchor.z, rotationY)) {
      const entry = catalogGet(pl.type);
      if (!stampFits(pl, geo, entry)) { dropped++; continue; }
      const k = `${pl.type}:${Math.round(pl.x * 2)}:${Math.round(pl.z * 2)}`;
      if (taken.has(k)) { dropped++; continue; }
      taken.add(k);
      placements.push({ ...pl, floor: floorIndex });
    }
  }
  return { placements, tpl, key: tpl.key, rotationY, dropped, reason: null };
}

// ---------- the whole building ----------

// Every room on every storey that has a name a layout answers to. `skipEmpty`
// leaves furnished rooms alone — the generator uses it so re-running it over a
// half-edited design doesn't double every classroom.
export function furnishPlan(state, opts = {}) {
  const rooms = [];
  const count = state && state.floors ? state.floors.length : 0;
  const only = opts.floors || null;
  for (let i = 0; i < count; i++) {
    if (only && !only.includes(i)) continue;
    for (const room of floorRooms(state, i).rooms) {
      if (!room.name) continue;
      const r = furnishRoom(state, i, room, opts);
      if (!r.placements.length) continue;
      rooms.push({ floor: i, room: room.id, name: room.name, ...r });
    }
  }
  return {
    rooms,
    placements: rooms.flatMap((r) => r.placements),
    dropped: rooms.reduce((n, r) => n + r.dropped, 0),
  };
}

// The names in the layout table, for a panel that wants to say what it knows.
export const LAYOUT_KEYS = ROOM_TEMPLATES.map((t) => t.key);
