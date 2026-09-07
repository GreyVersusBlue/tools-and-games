// layout.js — a room is a description, not a scene.
//
// Pure: no three.js, no DOM, imports nothing. world.js builds meshes from a
// description; day.js places its station rings from the same one; the tests
// ask this file the questions world.js could never answer (is every stool
// reachable, does the corridor still join the two rooms). Everything a wall,
// a stool or a stand-point decides lives here, in metres, floor y=0, x east,
// z south. Nothing in here may decide a colour.
//
// Shape of a description:
//   id        matches a VENUES key in campaign.js
//   room      { x, z, h }      main room is x∈[-x,x], z∈[-z,z], height h
//   kitchen   { x0, x1, z0, z1 } behind the north wall (z1 === -room.z)
//   wallT     north-wall thickness (the kitchen's south wall is the same slab)
//   doorways  [{ x0, x1, corridor: { z0, z1 } }]   gaps in the north wall, and
//             the walkable band that joins the two rooms through each
//   windows   [{ x0, x1, y0, y1 }]  pass-through openings in the north wall
//   bar       { len, x, z, stools: n, stoolZ, approachZ, x0, pitch, taps }
//   tables    [{ x, z }]           four-tops, four stools on a 0.95 m ring
//   fitout    [{ id, x, z, w, d, h, rotY, pad }]  solid blocks the player
//             collides with (prep counter, stove, crates); the bar counter and
//             the table tops are colliders too, derived from `bar`/`tables`
//   stations  { door, doorOut, passFood, passDrink, passFoodShelf,
//               passDrinkShelf, stove, tap, upgrades, stock, crew, promo,
//               doorRing, realEstate }  each { x, z } (shelves carry y)

export const TABLE_SEAT_R = 0.95;     // stool ring around a four-top
export const TABLE_APPROACH = 0.55;   // how far past the stool a carrier stands
export const TABLE_TOP_R = 0.62;
export const TABLE_PAD = 0.12;
export const COLLIDER_H = 2.5;

/** The Corner Tap, transcribed from what world.js built for three rounds. */
export const CORNER_TAP = Object.freeze({
  id: "cornerTap",
  room: { x: 8, z: 5.5, h: 3.1 },
  kitchen: { x0: 1, x1: 8, z0: -9, z1: -5.5 },
  wallT: 0.15,
  doorways: [{ x0: 2.1, x1: 3.7, corridor: { z0: -6.0, z1: -4.8 } }],
  windows: [{ x0: 4.5, x1: 6.2, y0: 1.05, y1: 2.05 }],
  // back edge z-4.175 → 1.25 m service lane to the north wall
  bar: { len: 7, x: -2.75, z: -3.8, depth: 0.75, pad: 0.1,
         stools: 6, x0: -5.6, pitch: 1.18, stoolZ: -3.05, approachZ: -2.4,
         taps: 3, tapX0: -4.2, tapPitch: 0.5 },
  tables: [{ x: -5, z: 0.9 }, { x: -1.6, z: 0.9 }, { x: 1.9, z: 0.9 },
           { x: -5, z: 3.4 }, { x: -1.6, z: 3.4 }, { x: 4.9, z: 2.6 }],
  fitout: [
    { id: "prep",   x: 2.6,  z: -7.3,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  x: 6.4,  z: -8.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", x: -6.6, z: -2.1,  w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", x: -6.1, z: -1.95, w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  stations: {
    door:           { x: 0,    z: 5.2 },
    doorOut:        { x: 0,    z: 6.7 },
    passFood:       { x: 5.35, z: -4.7 },
    passDrink:      { x: 0.2,  z: -2.85 },
    passFoodShelf:  { x: 5.35, y: 1.12, z: -5.5 },
    passDrinkShelf: { x: -0.3, y: 1.16, z: -3.8 },
    stove:          { x: 6.1,  z: -7.7 },
    tap:            { x: -5.5, z: -2.85 },
    upgrades:       { x: -6.6, z: -1.6 },
    stock:          { x: 4.5,  z: -7.2 },
    crew:           { x: -2,   z: -2.1 },
    promo:          { x: -3.2, z: 4.3 },
    doorRing:       { x: 0,    z: 4.3 },
    realEstate:     { x: 6.7,  z: -0.8 },
  },
});

/** One description per VENUES key. Phase 2 authors the other three; until it
 *  does, every tier is the Corner Tap, which is what world.js built anyway. */
export const LAYOUTS = Object.freeze({
  cornerTap: CORNER_TAP,
  fieldhouse: CORNER_TAP,
  midtown: CORNER_TAP,
  flagship: CORNER_TAP,
});

export function layoutFor(venueId) {
  return LAYOUTS[venueId] ?? LAYOUTS.cornerTap;
}

// ---------------------------------------------------------------- derived

/** Stand-points the player and the crew walk to, plus the door pair, as
 *  plain {x,y,z} objects — world.js turns them into Vector3 at the boundary. */
export function standPointsFor(desc) {
  const out = {};
  for (const [k, p] of Object.entries(desc.stations)) out[k] = { x: p.x, y: p.y ?? 0, z: p.z };
  return out;
}

/** The player's six management rings, in the order day.js draws them. */
export const RING_IDS = ["stock", "crew", "promo", "doorRing", "upgrades", "realEstate"];

/** Seats in the order world.js has always added them: bar stools west to
 *  east, then each four-top's four stools starting at 45° and going round.
 *  Ids restart at 1 per call, matching the old module counter. */
export function seatsFor(desc) {
  const seats = [];
  const b = desc.bar;
  for (let i = 0; i < b.stools; i++) {
    const x = b.x0 + i * b.pitch;
    seats.push({ id: seats.length + 1, x, z: b.stoolZ, ax: x, az: b.approachZ, kind: "bar" });
  }
  for (const t of desc.tables) {
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      const sx = t.x + Math.cos(a) * TABLE_SEAT_R, sz = t.z + Math.sin(a) * TABLE_SEAT_R;
      seats.push({ id: seats.length + 1, x: sx, z: sz,
        ax: t.x + Math.cos(a) * (TABLE_SEAT_R + TABLE_APPROACH),
        az: t.z + Math.sin(a) * (TABLE_SEAT_R + TABLE_APPROACH), kind: "table" });
    }
  }
  return seats;
}

/** Axis-aligned box of a w×d block centred at (x,z), turned rotY about y,
 *  padded — the same box THREE.Box3.setFromObject() reads off the mesh. */
export function blockBox({ x, z, w, d, rotY = 0, pad = 0 }) {
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  const hx = (w / 2) * c + (d / 2) * s + pad;
  const hz = (w / 2) * s + (d / 2) * c + pad;
  return { min: { x: x - hx, y: 0, z: z - hz }, max: { x: x + hx, y: COLLIDER_H, z: z + hz } };
}

/** Everything the player slides against, in the order world.js has always
 *  pushed them: kitchen prep, stove, bar counter, six table tops, crates. */
export function collidersFor(desc) {
  const byId = Object.fromEntries(desc.fitout.map(f => [f.id, f]));
  const out = [];
  const push = (id, box) => out.push({ id, ...box });
  for (const id of ["prep", "stove"]) if (byId[id]) push(id, blockBox(byId[id]));
  push("bar", blockBox({ x: desc.bar.x, z: desc.bar.z, w: desc.bar.len, d: desc.bar.depth, pad: desc.bar.pad }));
  desc.tables.forEach((t, i) => push(`table${i + 1}`,
    blockBox({ x: t.x, z: t.z, w: TABLE_TOP_R * 2, d: TABLE_TOP_R * 2, pad: TABLE_PAD })));
  for (const f of desc.fitout) if (f.id !== "prep" && f.id !== "stove") push(f.id, blockBox(f));
  return out;
}

/** Walkable test: main room ∪ kitchen ∪ each doorway's corridor band. */
export function inBounds(desc, x, z, r = 0.3) {
  const R = desc.room, K = desc.kitchen;
  if (x > -R.x + r && x < R.x - r && z > -R.z + r && z < R.z - r) return true;
  for (const d of desc.doorways) {
    if (x > d.x0 + r && x < d.x1 - r && z > d.corridor.z0 && z < d.corridor.z1) return true;
  }
  return x > K.x0 + r && x < K.x1 - r && z > K.z0 + r && z < -R.z - desc.wallT / 2;
}

export function pointInBox(box, x, z, r = 0) {
  return x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r;
}

/** Inside the walkable area and outside every collider. */
export function walkable(desc, x, z, r = 0.3, colliders = collidersFor(desc)) {
  if (!inBounds(desc, x, z, r)) return false;
  for (const b of colliders) if (pointInBox(b, x, z, 0)) return false;
  return true;
}

/**
 * The walkability invariant: every seat's approach point and every station
 * stand-point is walkable, the door is inside the room and the exit is not,
 * and every doorway actually joins the room to the kitchen. Returns a list of
 * problems, empty when the description is sound — a new floor plan is
 * authored against this, not against a walk in the browser.
 */
export function validate(desc) {
  const bad = [];
  const cols = collidersFor(desc);
  for (const s of seatsFor(desc)) {
    if (!walkable(desc, s.ax, s.az, 0.3, cols)) bad.push(`seat ${s.id} (${s.kind}) approach (${fmt(s.ax)}, ${fmt(s.az)}) is not walkable`);
  }
  const st = desc.stations;
  for (const k of ["passFood", "passDrink", "stove", "tap", ...RING_IDS]) {
    if (!st[k]) { bad.push(`station ${k} missing`); continue; }
    if (!walkable(desc, st[k].x, st[k].z, 0.3, cols)) bad.push(`station ${k} (${fmt(st[k].x)}, ${fmt(st[k].z)}) is not walkable`);
  }
  if (!inBounds(desc, st.door.x, st.door.z, 0)) bad.push("door is outside the room");
  if (inBounds(desc, st.doorOut.x, st.doorOut.z, 0)) bad.push("doorOut is inside the room");
  for (const [i, d] of desc.doorways.entries()) {
    // walk the doorway's centre line from inside the room to inside the
    // kitchen, 5 cm at a time: one unwalkable sample is a wall in the way
    const mx = (d.x0 + d.x1) / 2;
    let joined = true;
    for (let z = -desc.room.z + 0.31; z > desc.kitchen.z0 + 0.31; z -= 0.05) {
      if (!inBounds(desc, mx, z, 0.3)) { joined = false; break; }
    }
    if (!joined) bad.push(`doorway ${i} at x=${fmt(mx)} does not join the room to the kitchen`);
    if (!(d.x0 >= desc.kitchen.x0 && d.x1 <= desc.kitchen.x1)) bad.push(`doorway ${i} opens onto no kitchen`);
  }
  if (desc.kitchen.z1 !== -desc.room.z) bad.push("kitchen does not sit on the north wall");
  return bad;
}

function fmt(n) { return Math.round(n * 100) / 100; }
