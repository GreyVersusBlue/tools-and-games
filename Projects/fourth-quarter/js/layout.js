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
//   fitout    [{ id, kind, x, z, w, d, h, rotY, pad }]  solid blocks the
//             player collides with; `kind` is prep | stove | crate | crateWood
//             and says what world.js draws (a stove gets burners). The bar
//             counter and the table tops are colliders too, derived from
//             `bar`/`tables`. A room may have any number of stoves and preps.
//   tvs       [{ wall, at, y }]  wall is north | east | west | south, `at` is
//             the x (north/south) or z (east/west) along it
//   pendants  [{ x, z }]         the night rig's warm point lights
//   stations  { door, doorOut, passFood, passDrink, passFoodShelf,
//               passDrinkShelf, stove, tap, upgrades, stock, crew, promo,
//               doorRing, realEstate, spawn, crewHome, cooks }
//             each { x, z } (shelves carry y). spawn is where the camera
//             starts a day; crewHome is where idle servers stand (main.js
//             spreads them ±3.4 m in x); cooks is the west end of the cook
//             line, one cook every COOK_PITCH east of it.

export const TABLE_SEAT_R = 0.95;     // stool ring around a four-top
export const TABLE_APPROACH = 0.55;   // how far past the stool a carrier stands
export const TABLE_TOP_R = 0.62;
export const TABLE_PAD = 0.12;
export const COLLIDER_H = 2.5;
export const COOK_PITCH = 0.5;        // main.js's cook spacing along the line
export const INTERACT_R = 1.6;        // day.js nearest() / player.js nearStove()

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
    { id: "prep",   kind: "prep",      x: 2.6,  z: -7.3,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  kind: "stove",     x: 6.4,  z: -8.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", kind: "crate",     x: -6.6, z: -2.1,  w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", kind: "crateWood", x: -6.1, z: -1.95, w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  // world.js's three TV literals and five pendant literals, transcribed
  tvs: [{ wall: "north", at: -4.5, y: 2.35 }, { wall: "east", at: -2.6, y: 2.2 }, { wall: "west", at: 0.5, y: 2.2 }],
  pendants: [{ x: -4, z: 0.8 }, { x: 0, z: 0.8 }, { x: 4, z: 1.8 }, { x: -2, z: -3.2 }, { x: 5.3, z: -4.4 }],
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
    // main.js's camera literal (0, 1.62, 3.4), its server home line z -2.2
    // and its cook line (kitchen centre - 0.6, z0 + 1.3), transcribed
    spawn:          { x: 0,    z: 3.4 },
    crewHome:       { x: 0,    z: -2.2 },
    cooks:          { x: 3.9,  z: -7.7 },
  },
});

/** The Fieldhouse: two metres wider each way, a second stove, eight stools
 *  and nine four-tops. Same plan as the Corner Tap — bar west, kitchen east
 *  behind the north wall, door mid-south — so nothing that walks a straight
 *  line meets a wall it did not meet before. */
export const FIELDHOUSE = Object.freeze({
  id: "fieldhouse",
  room: { x: 10, z: 6.5, h: 3.3 },
  kitchen: { x0: 1, x1: 10, z0: -10.5, z1: -6.5 },
  wallT: 0.15,
  doorways: [{ x0: 2.1, x1: 3.7, corridor: { z0: -7.0, z1: -5.8 } }],
  windows: [{ x0: 5.0, x1: 7.5, y0: 1.05, y1: 2.05 }],
  bar: { len: 8.5, x: -4.5, z: -4.8, depth: 0.75, pad: 0.1,
         stools: 8, x0: -8.2, pitch: 1.06, stoolZ: -4.05, approachZ: -3.4,
         taps: 4, tapX0: -6.0, tapPitch: 0.5 },
  tables: [{ x: -6.6, z: 0.2 }, { x: -3.2, z: 0.2 }, { x: 1.6, z: 0.2 }, { x: 5.0, z: 0.2 },
           { x: -6.6, z: 3.2 }, { x: -3.2, z: 3.2 }, { x: 1.6, z: 3.2 }, { x: 5.0, z: 3.2 },
           { x: 8.0, z: 1.7 }],
  fitout: [
    { id: "prep",   kind: "prep",      x: 3.0,  z: -8.5,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  kind: "stove",     x: 6.0,  z: -9.95, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove2", kind: "stove",     x: 8.2,  z: -9.95, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", kind: "crate",     x: -9.0, z: -2.6,  w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", kind: "crateWood", x: -8.5, z: -2.45, w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  tvs: [{ wall: "north", at: -6.5, y: 2.5 }, { wall: "east", at: -3.0, y: 2.3 },
        { wall: "west", at: 1.0, y: 2.3 }, { wall: "south", at: 5.0, y: 2.4 }],
  pendants: [{ x: -5, z: 0.8 }, { x: -1, z: 0.8 }, { x: 3.5, z: 1.5 }, { x: 7.5, z: 1.7 },
             { x: -3, z: -4.2 }, { x: 6.2, z: -5.5 }],
  stations: {
    door:           { x: 0,     z: 6.2 },
    doorOut:        { x: 0,     z: 7.7 },
    passFood:       { x: 6.25,  z: -5.7 },
    passDrink:      { x: 0.2,   z: -3.85 },
    passFoodShelf:  { x: 6.25,  y: 1.12, z: -6.5 },
    passDrinkShelf: { x: -1.3,  y: 1.16, z: -4.8 },
    stove:          { x: 6.0,   z: -9.2 },
    tap:            { x: -8.1,  z: -3.85 },
    upgrades:       { x: -9.0,  z: -2.1 },
    stock:          { x: 3.0,   z: -7.3 },
    crew:           { x: -2.5,  z: -2.6 },
    promo:          { x: -3.5,  z: 5.3 },
    doorRing:       { x: 0,     z: 5.3 },
    realEstate:     { x: 8.6,   z: -1.5 },
    spawn:          { x: 0,     z: 4.4 },
    crewHome:       { x: 0,     z: -3.2 },
    cooks:          { x: 4.6,   z: -9.2 },
  },
});

/** Midtown Draft Hall: a ten-metre bar with a six-tap draft wall, ten stools,
 *  twelve four-tops, and a kitchen with two preps and two stoves. */
export const MIDTOWN = Object.freeze({
  id: "midtown",
  room: { x: 12, z: 7.5, h: 3.5 },
  kitchen: { x0: 0, x1: 12, z0: -13, z1: -7.5 },
  wallT: 0.15,
  doorways: [{ x0: 1.6, x1: 3.2, corridor: { z0: -8.0, z1: -6.8 } }],
  windows: [{ x0: 5.5, x1: 8.5, y0: 1.05, y1: 2.05 }],
  bar: { len: 10, x: -6, z: -5.8, depth: 0.75, pad: 0.1,
         stools: 10, x0: -10.5, pitch: 1.05, stoolZ: -5.05, approachZ: -4.4,
         taps: 6, tapX0: -8.5, tapPitch: 0.5 },
  tables: [{ x: -9.0, z: -0.6 }, { x: -5.6, z: -0.6 }, { x: 2.4, z: -0.6 }, { x: 5.8, z: -0.6 }, { x: 9.2, z: -0.6 },
           { x: -9.0, z: 2.4 },  { x: -5.6, z: 2.4 },  { x: 2.4, z: 2.4 },  { x: 5.8, z: 2.4 },  { x: 9.2, z: 2.4 },
           { x: -7.3, z: 5.4 },  { x: 7.5, z: 5.4 }],
  fitout: [
    { id: "prep",   kind: "prep",      x: 4.6,   z: -10.2,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "prep2",  kind: "prep",      x: 7.4,   z: -10.2,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  kind: "stove",     x: 8.0,   z: -12.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove2", kind: "stove",     x: 10.2,  z: -12.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", kind: "crate",     x: -11.0, z: -3.4,   w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", kind: "crateWood", x: -10.5, z: -3.25,  w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  tvs: [{ wall: "north", at: -8.5, y: 2.6 }, { wall: "north", at: -3.5, y: 2.6 },
        { wall: "east", at: -4.0, y: 2.4 }, { wall: "west", at: 1.5, y: 2.4 }, { wall: "south", at: 4.0, y: 2.5 }],
  pendants: [{ x: -9, z: 1 }, { x: -5.6, z: 1 }, { x: 0, z: 1 }, { x: 5.8, z: 1 }, { x: 9.2, z: 1 },
             { x: -7.3, z: 5 }, { x: 7.5, z: 5 }, { x: -6, z: -5.1 }, { x: -1.5, z: -5.1 }, { x: 7, z: -6.5 }],
  stations: {
    door:           { x: 0,     z: 7.2 },
    doorOut:        { x: 0,     z: 8.7 },
    passFood:       { x: 7.0,   z: -6.7 },
    passDrink:      { x: -0.5,  z: -4.85 },
    passFoodShelf:  { x: 7.0,   y: 1.12, z: -7.5 },
    passDrinkShelf: { x: -1.8,  y: 1.16, z: -5.8 },
    stove:          { x: 8.0,   z: -11.7 },
    tap:            { x: -10.4, z: -4.85 },
    upgrades:       { x: -11.0, z: -2.9 },
    stock:          { x: 2.0,   z: -11.0 },
    crew:           { x: -3.0,  z: -3.6 },
    promo:          { x: -3.6,  z: 6.3 },
    doorRing:       { x: 0,     z: 6.3 },
    realEstate:     { x: 10.6,  z: -3.4 },
    spawn:          { x: 0,     z: 5.4 },
    crewHome:       { x: 0,     z: -4.2 },
    cooks:          { x: 6.0,   z: -11.7 },
  },
});

/** The Fourth Quarter: twelve stools on a twelve-metre bar with eight taps,
 *  sixteen four-tops, three stoves on a three-prep line. 76 seats. */
export const FLAGSHIP = Object.freeze({
  id: "flagship",
  room: { x: 14, z: 9, h: 3.8 },
  kitchen: { x0: -2, x1: 14, z0: -14.5, z1: -9 },
  wallT: 0.15,
  doorways: [{ x0: 0.4, x1: 2.0, corridor: { z0: -9.5, z1: -8.3 } }],
  windows: [{ x0: 5.5, x1: 9.5, y0: 1.05, y1: 2.05 }],
  bar: { len: 12, x: -7.4, z: -7.3, depth: 0.75, pad: 0.1,
         stools: 12, x0: -12.9, pitch: 1.04, stoolZ: -6.55, approachZ: -5.9,
         taps: 8, tapX0: -10.7, tapPitch: 0.5 },
  tables: [{ x: -11.0, z: -2.0 }, { x: -7.6, z: -2.0 }, { x: -4.2, z: -2.0 }, { x: 3.0, z: -2.0 }, { x: 6.4, z: -2.0 }, { x: 9.8, z: -2.0 },
           { x: -11.0, z: 1.2 },  { x: -7.6, z: 1.2 },  { x: -4.2, z: 1.2 },  { x: 3.0, z: 1.2 },  { x: 6.4, z: 1.2 },  { x: 9.8, z: 1.2 },
           { x: -11.0, z: 4.4 },  { x: -7.6, z: 4.4 },  { x: 6.4, z: 4.4 },   { x: 9.8, z: 4.4 }],
  fitout: [
    { id: "prep",   kind: "prep",      x: 3.0,   z: -11.7,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "prep2",  kind: "prep",      x: 5.8,   z: -11.7,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "prep3",  kind: "prep",      x: 8.6,   z: -11.7,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  kind: "stove",     x: 6.0,   z: -13.95, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove2", kind: "stove",     x: 8.2,   z: -13.95, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove3", kind: "stove",     x: 10.4,  z: -13.95, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", kind: "crate",     x: -13.3, z: -5.0,   w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", kind: "crateWood", x: -12.75, z: -4.85, w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  tvs: [{ wall: "north", at: -10.5, y: 2.7 }, { wall: "north", at: -4.5, y: 2.7 },
        { wall: "east", at: -5.0, y: 2.5 }, { wall: "east", at: 3.0, y: 2.5 },
        { wall: "west", at: -1.0, y: 2.5 }, { wall: "west", at: 5.0, y: 2.5 }, { wall: "south", at: 6.0, y: 2.6 }],
  pendants: [{ x: -11, z: -0.4 }, { x: -7.6, z: -0.4 }, { x: -4.2, z: -0.4 }, { x: 3, z: -0.4 }, { x: 6.4, z: -0.4 }, { x: 9.8, z: -0.4 },
             { x: -9.3, z: 4.4 }, { x: 0, z: 4.4 }, { x: 8.1, z: 4.4 },
             { x: -10, z: -6.6 }, { x: -5, z: -6.6 }, { x: 0, z: -6.6 }, { x: 7.5, z: -8 }],
  stations: {
    door:           { x: 0,      z: 8.7 },
    doorOut:        { x: 0,      z: 10.2 },
    passFood:       { x: 7.5,    z: -8.2 },
    passDrink:      { x: -1.95,  z: -6.35 },
    passFoodShelf:  { x: 7.5,    y: 1.12, z: -9 },
    passDrinkShelf: { x: -2.45,  y: 1.16, z: -7.3 },
    stove:          { x: 6.0,    z: -13.2 },
    tap:            { x: -12.65, z: -6.35 },
    upgrades:       { x: -13.1,  z: -4.0 },
    stock:          { x: -0.5,   z: -12.5 },
    crew:           { x: -3.0,   z: -4.6 },
    promo:          { x: -3.8,   z: 7.8 },
    doorRing:       { x: 0,      z: 7.8 },
    realEstate:     { x: 12.6,   z: -4.0 },
    spawn:          { x: 0,      z: 6.9 },
    crewHome:       { x: -1.0,   z: -5.7 },
    cooks:          { x: 4.0,    z: -13.2 },
  },
});

/** One description per VENUES key, up the ladder. */
export const LAYOUTS = Object.freeze({
  cornerTap: CORNER_TAP,
  fieldhouse: FIELDHOUSE,
  midtown: MIDTOWN,
  flagship: FLAGSHIP,
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
 *  pushed them: kitchen preps and stoves, bar counter, table tops, crates. */
const KITCHEN_KINDS = ["prep", "stove"];
export function collidersFor(desc) {
  const out = [];
  const push = (id, box) => out.push({ id, ...box });
  for (const f of desc.fitout) if (KITCHEN_KINDS.includes(f.kind)) push(f.id, blockBox(f));
  push("bar", blockBox({ x: desc.bar.x, z: desc.bar.z, w: desc.bar.len, d: desc.bar.depth, pad: desc.bar.pad }));
  desc.tables.forEach((t, i) => push(`table${i + 1}`,
    blockBox({ x: t.x, z: t.z, w: TABLE_TOP_R * 2, d: TABLE_TOP_R * 2, pad: TABLE_PAD })));
  for (const f of desc.fitout) if (!KITCHEN_KINDS.includes(f.kind)) push(f.id, blockBox(f));
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

// ------------------------------------------------- placements world.js reads

export const CREW_SPREAD = [0.4, -3.4, 2.6];   // main.js's idle-server offsets

/** Where the i-th cook stands: the cook line runs east from stations.cooks. */
export function cookSpot(desc, i) {
  const c = desc.stations.cooks;
  return { x: c.x + i * COOK_PITCH, z: c.z };
}

/** Where the i-th floor staffer idles between tickets. */
export function crewHome(desc, i) {
  const h = desc.stations.crewHome;
  return { x: h.x + CREW_SPREAD[i % CREW_SPREAD.length], z: h.z };
}

const TV_INSET = 0.06;
/** A TV's mount as world.js draws it: centre and yaw, hung on the named wall.
 *  The north wall is a brick slab, so the inset there clears half its thickness. */
export function tvMount(desc, tv) {
  const R = desc.room;
  switch (tv.wall) {
    case "north": return { x: tv.at, y: tv.y, z: -R.z + desc.wallT / 2 + 0.02, ry: 0 };
    case "east":  return { x: R.x - TV_INSET, y: tv.y, z: tv.at, ry: -Math.PI / 2 };
    case "west":  return { x: -R.x + TV_INSET, y: tv.y, z: tv.at, ry: Math.PI / 2 };
    case "south": return { x: tv.at, y: tv.y, z: R.z - TV_INSET, ry: Math.PI };
    default: return null;
  }
}

/** Every named point a body has to be able to stand on, for validate() and
 *  the reachability sweep: seat approaches, the carrier and player stations,
 *  the six rings, the spawn, three idle servers and three cooks. */
export function standingPoints(desc) {
  const pts = [];
  for (const s of seatsFor(desc)) pts.push({ name: `seat ${s.id} (${s.kind}) approach`, x: s.ax, z: s.az });
  const st = desc.stations;
  for (const k of ["passFood", "passDrink", "stove", "tap", ...RING_IDS, "spawn", "crewHome", "cooks"]) {
    if (st[k]) pts.push({ name: `station ${k}`, x: st[k].x, z: st[k].z });
  }
  for (let i = 0; i < 3; i++) {
    if (st.crewHome) { const h = crewHome(desc, i); pts.push({ name: `server ${i + 1} home`, x: h.x, z: h.z }); }
    if (st.cooks) { const c = cookSpot(desc, i); pts.push({ name: `cook ${i + 1}`, x: c.x, z: c.z }); }
  }
  return pts;
}

/**
 * Flood-fill the walkable floor from the door on a 0.25 m grid and report
 * which standing points it never reaches. A point can be walkable and still
 * be walled off — a crate across the doorway leaves every stove stand-point
 * walkable and unreachable, which no per-point check can see. This is a
 * reachability sweep, not a planner; Phase 3's nav grid may reuse the cells.
 */
export const GRID = 0.25;
export function unreachable(desc, r = 0.3) {
  const cols = collidersFor(desc);
  const x0 = Math.floor(-desc.room.x / GRID), x1 = Math.ceil(desc.room.x / GRID);
  const z0 = Math.floor(desc.kitchen.z0 / GRID), z1 = Math.ceil(desc.room.z / GRID);
  const W = x1 - x0 + 1;
  const key = (xi, zi) => (zi - z0) * W + (xi - x0);
  const open = new Uint8Array(W * (z1 - z0 + 1));
  for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) {
    if (walkable(desc, xi * GRID, zi * GRID, r, cols)) open[key(xi, zi)] = 1;
  }
  const seen = new Uint8Array(open.length);
  const queue = [];
  const d = desc.stations.door;
  // seed: every open cell within a metre of the door point (the door itself
  // sits on the wall line, outside the r=0.3 walkable band)
  for (let zi = z0; zi <= z1; zi++) for (let xi = x0; xi <= x1; xi++) {
    if (open[key(xi, zi)] && Math.hypot(xi * GRID - d.x, zi * GRID - d.z) <= 1) { seen[key(xi, zi)] = 1; queue.push([xi, zi]); }
  }
  while (queue.length) {
    const [xi, zi] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = xi + dx, nz = zi + dz;
      if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
      const k = key(nx, nz);
      if (open[k] && !seen[k]) { seen[k] = 1; queue.push([nx, nz]); }
    }
  }
  const reached = (x, z) => {
    // any flooded cell within one grid step of the point
    for (let zi = Math.floor(z / GRID); zi <= Math.ceil(z / GRID); zi++)
      for (let xi = Math.floor(x / GRID); xi <= Math.ceil(x / GRID); xi++)
        if (xi >= x0 && xi <= x1 && zi >= z0 && zi <= z1 && seen[key(xi, zi)]) return true;
    return false;
  };
  return standingPoints(desc).filter(p => !reached(p.x, p.z)).map(p => p.name);
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
  for (const p of standingPoints(desc)) {
    if (!walkable(desc, p.x, p.z, 0.3, cols)) bad.push(`${p.name} (${fmt(p.x)}, ${fmt(p.z)}) is not walkable`);
  }
  const st = desc.stations;
  for (const k of ["passFood", "passDrink", "stove", "tap", ...RING_IDS, "spawn", "crewHome", "cooks"]) {
    if (!st[k]) bad.push(`station ${k} missing`);
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
  // no two things the player interacts with by proximity within one
  // interaction radius of each other: day.js's nearest() takes the closest
  // ring inside 1.6 m, and player.js answers nearStove()/nearTap() at 1.6 m
  const near = ["stove", "tap", ...RING_IDS].filter(k => st[k]);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const a = st[near[i]], b = st[near[j]], dist = Math.hypot(a.x - b.x, a.z - b.z);
    if (dist < INTERACT_R) bad.push(`stations ${near[i]} and ${near[j]} are ${fmt(dist)} m apart (interaction range is ${INTERACT_R})`);
  }
  // TVs hang on a wall of the main room, inside its span and below its ceiling
  for (const [i, tv] of (desc.tvs ?? []).entries()) {
    const m = tvMount(desc, tv);
    if (!m) { bad.push(`tv ${i} names no wall (${tv.wall})`); continue; }
    const span = (tv.wall === "north" || tv.wall === "south") ? desc.room.x : desc.room.z;
    if (Math.abs(tv.at) > span - 1) bad.push(`tv ${i} at ${fmt(tv.at)} runs off the ${tv.wall} wall`);
    if (tv.y < 1.2 || tv.y > desc.room.h - 0.6) bad.push(`tv ${i} at y=${fmt(tv.y)} is not on the wall`);
  }
  for (const [i, p] of (desc.pendants ?? []).entries()) {
    if (!inBounds(desc, p.x, p.z, 0)) bad.push(`pendant ${i} (${fmt(p.x)}, ${fmt(p.z)}) hangs outside the room`);
  }
  for (const name of unreachable(desc)) bad.push(`${name} cannot be reached from the door`);
  return bad;
}

function fmt(n) { return Math.round(n * 100) / 100; }
