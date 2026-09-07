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

// ------------------------------------------------------------------- nav
//
// stepToward() walks the straight line to its target and consults nothing.
// One open room hid that for three rounds; Phase 2's rooms put a wall between
// the door and half the seats, and a straight line into masonry is a patron
// standing still all night. This is the grid a body plans on: unreachable()'s
// 0.25 m cells again, but with every collider inflated by the walker's radius,
// so a corner gets turned instead of clipped. A* over eight neighbours (a
// diagonal needs both its orthogonals open, or a walker slips through the join
// of two tables), then a string-pull that drops every waypoint the walker can
// already see past — a straight shot across an empty room comes back as its
// two endpoints and nothing between them.

/** A walking body's radius. The player slides against colliders at 0.3 m; a
 *  patron mesh is a 0.2 m cylinder, and 0.25 m is what the grid gives it. */
export const WALKER_R = 0.25;

/** How far a start or a target may sit from open floor and still be planned
 *  to. Both ends are routinely inside inflated geometry on purpose: a cook
 *  stands against the prep counter, a seated patron is inside the table's
 *  box, and a leaving patron aims at a point outside the room entirely. */
export const SNAP_R = 1.0;

const DIAG = Math.SQRT2;
const LINE_STEP = 0.1;      // string-pull sampling along a candidate segment
const SAME_PT = 0.02;

/** Open for a body of radius r: inside the walkable area, and r clear of
 *  every collider. walkable() asks the same question of a point. */
export function navOpen(desc, x, z, r = WALKER_R, cols = collidersFor(desc)) {
  if (!inBounds(desc, x, z, r)) return false;
  for (const b of cols) if (pointInBox(b, x, z, r)) return false;
  return true;
}

// weak, so a description a test cloned and threw away takes its grid with it
let navCache = new WeakMap();
/** Drop the memoised grids. Only a test that mutates a description in place
 *  after planning on it needs this; the shipped descriptions are frozen. */
export function clearNavCache() { navCache = new WeakMap(); }

/** The rasterised floor: `open[zi * W + xi]` for cells on the same 0.25 m
 *  lattice unreachable() floods, spanning the room and the kitchen. */
export function navGrid(desc, r = WALKER_R) {
  let byR = navCache.get(desc);
  if (!byR) navCache.set(desc, (byR = new Map()));
  const hit = byR.get(r);
  if (hit) return hit;
  const cols = collidersFor(desc);
  const x0 = Math.floor(Math.min(-desc.room.x, desc.kitchen.x0) / GRID);
  const x1 = Math.ceil(Math.max(desc.room.x, desc.kitchen.x1) / GRID);
  const z0 = Math.floor(desc.kitchen.z0 / GRID), z1 = Math.ceil(desc.room.z / GRID);
  const W = x1 - x0 + 1, H = z1 - z0 + 1;
  const open = new Uint8Array(W * H);
  for (let zi = 0; zi < H; zi++) {
    for (let xi = 0; xi < W; xi++) {
      if (navOpen(desc, (x0 + xi) * GRID, (z0 + zi) * GRID, r, cols)) open[zi * W + xi] = 1;
    }
  }
  const g = { desc, r, x0, z0, W, H, open, cols };
  byR.set(r, g);
  return g;
}

const cellX = (g, i) => (g.x0 + (i % g.W)) * GRID;
const cellZ = (g, i) => (g.z0 + Math.floor(i / g.W)) * GRID;
export function cellPoint(g, i) { return { x: cellX(g, i), z: cellZ(g, i) }; }

/** The open cell nearest (x,z), or -1 when nothing open is within `within`.
 *  Pass Infinity to accept whatever the floor does have. */
export function nearestCell(g, x, z, within = SNAP_R) {
  const cx = Math.round(x / GRID) - g.x0, cz = Math.round(z / GRID) - g.z0;
  if (cx >= 0 && cx < g.W && cz >= 0 && cz < g.H && g.open[cz * g.W + cx]) return cz * g.W + cx;
  const rad = Number.isFinite(within) ? Math.ceil(within / GRID) : Math.max(g.W, g.H);
  let best = -1, bestD = Infinity;
  for (let dz = -rad; dz <= rad; dz++) {
    const zi = cz + dz;
    if (zi < 0 || zi >= g.H) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const xi = cx + dx;
      if (xi < 0 || xi >= g.W) continue;
      const i = zi * g.W + xi;
      if (!g.open[i]) continue;
      const d = Math.hypot(cellX(g, i) - x, cellZ(g, i) - z);
      if (d < bestD && d <= within) { bestD = d; best = i; }
    }
  }
  return best;
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Eight neighbours, minus the two diagonals that would cut a corner. */
function eachNeighbour(g, i, fn) {
  const xi = i % g.W, zi = (i - xi) / g.W;
  for (let k = 0; k < 8; k++) {
    const dx = NB[k][0], dz = NB[k][1];
    const nx = xi + dx, nz = zi + dz;
    if (nx < 0 || nx >= g.W || nz < 0 || nz >= g.H) continue;
    const n = nz * g.W + nx;
    if (!g.open[n]) continue;
    if (dx && dz && !(g.open[zi * g.W + nx] && g.open[nz * g.W + xi])) continue;
    fn(n, dx && dz ? DIAG : 1);
  }
}

/** Every cell the floor joins to `i`, by the same neighbour rule A* uses, so
 *  "the planner will find a route" and "this flood reached it" never differ. */
export function navComponent(g, i) {
  const seen = new Uint8Array(g.open.length);
  if (i < 0) return seen;
  seen[i] = 1;
  const q = [i];
  while (q.length) {
    const c = q.pop();
    eachNeighbour(g, c, n => { if (!seen[n]) { seen[n] = 1; q.push(n); } });
  }
  return seen;
}

// a binary heap of cell indices, keyed by f
function heapPush(h, f, node, key) {
  h.push(node); f.push(key);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (f[p] <= f[i]) break;
    [h[p], h[i]] = [h[i], h[p]]; [f[p], f[i]] = [f[i], f[p]];
    i = p;
  }
}
function heapPop(h, f) {
  const top = h[0];
  const n = h.pop(), k = f.pop();
  if (h.length) {
    h[0] = n; f[0] = k;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && f[l] < f[m]) m = l;
      if (r < h.length && f[r] < f[m]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; [f[m], f[i]] = [f[i], f[m]];
      i = m;
    }
  }
  return top;
}

/** A* from cell s to cell t. When t is walled off, `cells` is the route to
 *  the closed cell that got nearest it — a body that cannot reach its target
 *  still gets somewhere, which is the whole point of not freezing. */
function astar(g, s, t) {
  const n = g.open.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tx = t % g.W, tz = (t - tx) / g.W;
  const h = i => {
    const xi = i % g.W, dx = Math.abs(xi - tx), dz = Math.abs((i - xi) / g.W - tz);
    return dx + dz + (DIAG - 2) * Math.min(dx, dz);
  };
  const heap = [], keys = [];
  gScore[s] = 0;
  heapPush(heap, keys, s, h(s));
  let best = s, bestH = h(s);
  while (heap.length) {
    const c = heapPop(heap, keys);
    if (closed[c]) continue;
    closed[c] = 1;
    const hc = h(c);
    if (hc < bestH) { bestH = hc; best = c; }
    if (c === t) return { cells: trace(came, s, t), complete: true };
    eachNeighbour(g, c, (nb, w) => {
      const ng = gScore[c] + w;
      if (ng < gScore[nb]) { gScore[nb] = ng; came[nb] = c; heapPush(heap, keys, nb, ng + h(nb)); }
    });
  }
  return { cells: trace(came, s, best), complete: false };
}
function trace(came, s, t) {
  const out = [t];
  let c = t;
  while (c !== s && came[c] >= 0) { c = came[c]; out.push(c); }
  return out.reverse();
}

/** Every 10 cm of a→b is open for a body of radius r. */
export function clearLine(desc, a, b, r = WALKER_R, cols = collidersFor(desc)) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(d / LINE_STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!navOpen(desc, a.x + dx * t, a.z + dz * t, r, cols)) return false;
  }
  return true;
}

function dedupe(pts) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]], last = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.z - q.z) < SAME_PT) continue;
    if (Math.hypot(p.x - last.x, p.z - last.z) < SAME_PT) continue;
    out.push(p);
  }
  out.push(last);
  return out;
}

/** Throw away every waypoint the walker can see past. `lockFirst` and
 *  `lockLast` hold the two legs that leave and enter inflated geometry — the
 *  step out of a table's box, the step through the door — which no clearance
 *  test can approve and no walker may skip. */
function stringPull(desc, pts, r, cols, lockFirst, lockLast) {
  if (pts.length < 3) return pts.slice();
  const end = pts.length - 1;
  const free = lockLast ? end - 1 : end;
  const out = [pts[0]];
  let i = 0;
  if (lockFirst) { out.push(pts[1]); i = 1; }
  while (i < end) {
    const cap = i >= free ? end : free;
    let next = i + 1;
    for (let j = cap; j > i + 1; j--) {
      if (clearLine(desc, pts[i], pts[j], r, cols)) { next = j; break; }
    }
    out.push(pts[next]);
    i = next;
  }
  return out;
}

/**
 * The honest answer to "walk me from here to there": a list of waypoints
 * starting at `from`, and whether it actually ends at `to`. When `to` is
 * walled off, `complete` is false and the route ends at the reachable point
 * nearest it — a patron with no route to the door leaves by the nearest exit
 * the floor does join to, and nothing stands still because the plan failed.
 * `within` is how far the target may sit from open floor: DOOR_OUT is outside
 * the room on purpose and needs more slack than a stool does.
 */
export function pathToward(desc, from, to, r = WALKER_R, within = SNAP_R) {
  const g = navGrid(desc, r);
  const A = { x: from.x, z: from.z }, B = { x: to.x, z: to.z };
  let s = nearestCell(g, A.x, A.z, SNAP_R);
  if (s < 0) s = nearestCell(g, A.x, A.z, Infinity);
  let t = nearestCell(g, B.x, B.z, within);
  const goalNear = t >= 0;
  if (!goalNear) t = nearestCell(g, B.x, B.z, Infinity);
  if (s < 0 || t < 0) return { pts: [A], complete: false };
  const res = astar(g, s, t);
  const complete = goalNear && res.complete;
  const pts = [A];
  for (const c of res.cells) pts.push(cellPoint(g, c));
  if (complete) pts.push(B);
  const clean = dedupe(pts);
  if (clean.length < 2) return { pts: clean, complete };
  const lockFirst = !navOpen(desc, A.x, A.z, r, g.cols);
  const lockLast = complete && !navOpen(desc, B.x, B.z, r, g.cols);
  return { pts: stringPull(desc, clean, r, g.cols, lockFirst, lockLast), complete };
}

/** The route from `from` to `to`, or null when the floor does not join them.
 *  The first point is `from` and the last is `to`; a straight shot across an
 *  empty room is exactly those two. */
export function pathBetween(desc, from, to, r = WALKER_R, within = SNAP_R) {
  const res = pathToward(desc, from, to, r, within);
  return res.complete ? res.pts : null;
}

/** Which seats a body can actually get to from the door, by seat order.
 *  world.js hangs this on each seat and freeSeat() never offers a false. */
export function reachableSeats(desc, from = desc.stations.door, r = WALKER_R) {
  const g = navGrid(desc, r);
  const seen = navComponent(g, nearestCell(g, from.x, from.z, SNAP_R));
  return seatsFor(desc).map(s => {
    const t = nearestCell(g, s.ax, s.az, SNAP_R);
    return t >= 0 && seen[t] === 1;
  });
}

/** Every point a walking body aims at, and how far from open floor each is
 *  allowed to sit. doorOut is outside the room by design, so it gets more
 *  slack than a seat approach, which should be floor a patron fits on. */
export function navRoutes(desc) {
  const st = desc.stations, out = [];
  for (const s of seatsFor(desc)) out.push({ name: `seat ${s.id} (${s.kind}) approach`, x: s.ax, z: s.az });
  for (const k of ["passFood", "passDrink"]) if (st[k]) out.push({ name: `station ${k}`, x: st[k].x, z: st[k].z });
  if (st.doorOut) out.push({ name: "station doorOut", x: st.doorOut.x, z: st.doorOut.z, within: 2.5 });
  for (let i = 0; i < 3; i++) {
    if (st.crewHome) { const h = crewHome(desc, i); out.push({ name: `server ${i + 1} home`, x: h.x, z: h.z }); }
    if (st.cooks) { const c = cookSpot(desc, i); out.push({ name: `cook ${i + 1}`, x: c.x, z: c.z }); }
  }
  return out;
}

/** The pathing half of the invariant: a walker of WALKER_R can get from the
 *  door to every point a walker is ever sent to. unreachable() answers this
 *  for a point-sized body; a body has width, and 0.25 m of it is the
 *  difference between a stool being offered and a patron in a wall. */
export function navProblems(desc, r = WALKER_R) {
  const g = navGrid(desc, r);
  const d = desc.stations.door;
  const s = nearestCell(g, d.x, d.z, SNAP_R);
  if (s < 0) return [`the door (${fmt(d.x)}, ${fmt(d.z)}) is not within ${SNAP_R} m of floor a ${r} m walker fits on`];
  const seen = navComponent(g, s);
  const bad = [];
  for (const p of navRoutes(desc)) {
    const t = nearestCell(g, p.x, p.z, p.within ?? SNAP_R);
    if (t < 0) bad.push(`${p.name} (${fmt(p.x)}, ${fmt(p.z)}) is not within ${p.within ?? SNAP_R} m of floor a ${r} m walker fits on`);
    else if (!seen[t]) bad.push(`${p.name} has no route from the door`);
  }
  return bad;
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
  for (const m of navProblems(desc)) bad.push(m);
  return bad;
}

function fmt(n) { return Math.round(n * 100) / 100; }
