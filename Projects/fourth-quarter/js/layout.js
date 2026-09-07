// layout.js — a room is a description, not a scene.
//
// Pure: no three.js, no DOM, imports nothing. world.js builds meshes from a
// description; day.js places its station rings from the same one; the tests
// ask this file the questions world.js could never answer (is every stool
// reachable, does the corridor still join the two rooms). Everything a wall,
// a stool or a stand-point decides lives here, in metres, x east, z south,
// and the floor at y=0 everywhere a description does not say otherwise —
// floorYAt() is the one place that says otherwise. Nothing in here may decide
// a colour.
//
// Shape of a description:
//   id        matches a VENUES key in campaign.js
//   room      { x, z, h }      main room is x∈[-x,x], z∈[-z,z], height h
//   kitchen   { x0, x1, z0, z1 } behind the north wall (z1 === -room.z)
//   wallT     north-wall thickness (the kitchen's south wall is the same slab)
//   doorways  [{ x0, x1, corridor: { z0, z1 } }]   gaps in the north wall, and
//             the walkable band that joins the two rooms through each
//   annexes   [{ id, x0, x1, z0, z1, h, wall, gap: { a0, a1 } }]
//             extra floor rectangles beyond the main room and the kitchen. A
//             room is no longer one rectangle: `wall` names the main-room wall
//             the annex opens through (north | east | west | south), `gap` is
//             the doorway's span along that wall (x for north/south, z for
//             east/west), and the annex's shared edge sits one wall thickness
//             outside the room, so the wall's inner face is the plane it
//             replaces. Its own `h` is its ceiling, which need not be the
//             hall's. The walkable band through the gap is derived, not
//             authored — annexBand().
//   mezzanines [{ id, x0, x1, z0, z1, y, stair: { x0, x1, z0, z1, rise } }]
//             raised floor rectangles inside the hall, the first floors in
//             this file that are not at y = 0. The deck stands at `y`; the
//             ground under it is closed, and its edges that are not the
//             hall's walls are a rail. `stair` is a rectangle on the hall
//             floor that climbs from 0 to `y` in the direction `rise` (east |
//             west | north | south), its high end flush against the deck's
//             edge. floorYAt() reads both; a table on the deck is lifted with
//             it, and a body may only step where the floor under it changes
//             by MAX_SLOPE per metre or less, which is the rail, the facade
//             under the deck and the stair's sides in one rule — levelOpen().
//   windows   [{ x0, x1, y0, y1 }]  pass-through openings in the north wall
//   bar       { len, x, z, stools: n, stoolZ, approachZ, x0, pitch, taps }
//   tables    [{ x, z }]           four-tops, four stools on a 0.95 m ring
//   fitout    [{ id, kind, x, z, w, d, h, rotY, pad }]  solid blocks the
//             player collides with; `kind` is prep | stove | crate | crateWood
//             and says what world.js draws (a stove gets burners). The bar
//             counter and the table tops are colliders too, derived from
//             `bar`/`tables`. A room may have any number of stoves and preps.
//   tvs       [{ wall, at, y, area }]  wall is north | east | west | south,
//             `at` is the x (north/south) or z (east/west) along it, in world
//             coordinates; `area` names an annex id, or is absent for the hall
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
 *  twelve four-tops, and a kitchen with two preps and two stoves. Three of
 *  those four-tops sit in the back room off the east wall, which is the first
 *  floor rectangle in this file that is not the hall or the kitchen: 6×8 m
 *  under a lower ceiling, reached through a 1.7 m doorway. The hall's own east
 *  side was cleared to make the lane to it — the three tables that stood there
 *  are the three that moved, so the seat count is the 58 the ladder names. */
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
  annexes: [{ id: "backRoom", x0: 12.15, x1: 18.15, z0: -3.5, z1: 4.5, h: 3.2,
              wall: "east", gap: { a0: 0.2, a1: 1.9 } }],
  tables: [{ x: -9.0, z: -0.6 }, { x: -5.6, z: -0.6 }, { x: 2.4, z: -0.6 }, { x: 5.8, z: -0.6 },
           { x: -9.0, z: 2.4 },  { x: -5.6, z: 2.4 },  { x: 2.4, z: 2.4 },  { x: 5.8, z: 2.4 },
           { x: -7.3, z: 5.4 },
           // the back room, through the east doorway
           { x: 14.2, z: -1.4 }, { x: 14.2, z: 2.0 }, { x: 16.5, z: 0.3 }],
  fitout: [
    { id: "prep",   kind: "prep",      x: 4.6,   z: -10.2,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "prep2",  kind: "prep",      x: 7.4,   z: -10.2,  w: 2.4,  d: 0.9,  h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove",  kind: "stove",     x: 8.0,   z: -12.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "stove2", kind: "stove",     x: 10.2,  z: -12.45, w: 1.7,  d: 0.85, h: 0.95, rotY: 0,   pad: 0.08 },
    { id: "crate1", kind: "crate",     x: -11.0, z: -3.4,   w: 0.7,  d: 0.6,  h: 0.6,  rotY: 0,   pad: 0.06 },
    { id: "crate2", kind: "crateWood", x: -10.5, z: -3.25,  w: 0.55, d: 0.55, h: 0.5,  rotY: 0.3, pad: 0.06 },
  ],
  tvs: [{ wall: "north", at: -8.5, y: 2.6 }, { wall: "north", at: -3.5, y: 2.6 },
        { wall: "east", at: -4.0, y: 2.4 }, { wall: "west", at: 1.5, y: 2.4 }, { wall: "south", at: 4.0, y: 2.5 },
        { wall: "north", at: 15.0, y: 2.4, area: "backRoom" }],
  pendants: [{ x: -9, z: 1 }, { x: -5.6, z: 1 }, { x: 0, z: 1 }, { x: 5.8, z: 1 }, { x: 9.2, z: 1 },
             { x: -7.3, z: 5 }, { x: 7.5, z: 5 }, { x: -6, z: -5.1 }, { x: -1.5, z: -5.1 }, { x: 7, z: -6.5 },
             { x: 14.2, z: -1.2 }, { x: 14.2, z: 2.2 }, { x: 16.6, z: 0.5 }],
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
 *  sixteen four-tops, three stoves on a three-prep line. 76 seats. Three of
 *  the four-tops stand on the mezzanine, a 1.6 m deck over the hall's
 *  south-east corner reached by a 2.6 m stair beside the door — the first
 *  floor in this file that is not at y = 0. The three that went up are the
 *  three that stood on that corner, so the count is still the ladder's 76. */
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
  mezzanines: [{ id: "mezzanine", x0: 5.5, x1: 14, z0: 3.0, z1: 9, y: 1.6,
                 stair: { x0: 2.9, x1: 5.5, z0: 7.6, z1: 9, rise: "east" } }],
  tables: [{ x: -11.0, z: -2.0 }, { x: -7.6, z: -2.0 }, { x: -4.2, z: -2.0 }, { x: 3.0, z: -2.0 }, { x: 6.4, z: -2.0 }, { x: 9.8, z: -2.0 },
           { x: -11.0, z: 1.2 },  { x: -7.6, z: 1.2 },  { x: -4.2, z: 1.2 },  { x: 3.0, z: 1.2 },  { x: 6.4, z: 1.2 },
           { x: -11.0, z: 4.4 },  { x: -7.6, z: 4.4 },
           // the mezzanine, up the stair
           { x: 8.0, z: 4.8 }, { x: 11.6, z: 4.8 }, { x: 9.8, z: 7.4 }],
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
  // the two TVs on the mezzanine's walls hang 1.5 m over its deck, not the hall's floor
  tvs: [{ wall: "north", at: -10.5, y: 2.7 }, { wall: "north", at: -4.5, y: 2.7 },
        { wall: "east", at: -5.0, y: 2.5 }, { wall: "east", at: 6.0, y: 3.1 },
        { wall: "west", at: -1.0, y: 2.5 }, { wall: "west", at: 5.0, y: 2.5 }, { wall: "south", at: 9.0, y: 3.1 }],
  pendants: [{ x: -11, z: -0.4 }, { x: -7.6, z: -0.4 }, { x: -4.2, z: -0.4 }, { x: 3, z: -0.4 }, { x: 6.4, z: -0.4 }, { x: 9.8, z: -0.4 },
             { x: -9.3, z: 4.4 }, { x: 0, z: 4.4 }, { x: 8.0, z: 4.8 }, { x: 11.6, z: 4.8 }, { x: 9.8, z: 7.4 },
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
  for (const [k, p] of Object.entries(desc.stations)) out[k] = { x: p.x, y: p.y ?? floorYAt(desc, p.x, p.z), z: p.z };
  return out;
}

/** The player's six management rings, in the order day.js draws them. */
export const RING_IDS = ["stock", "crew", "promo", "doorRing", "upgrades", "realEstate"];

/** Seats in the order world.js has always added them: bar stools west to
 *  east, then each four-top's four stools starting at 45° and going round.
 *  Ids restart at 1 per call, matching the old module counter. `y` is the
 *  floor under the stool — a four-top on the mezzanine is lifted with it. */
export function seatsFor(desc) {
  const seats = [];
  const b = desc.bar;
  for (let i = 0; i < b.stools; i++) {
    const x = b.x0 + i * b.pitch;
    seats.push({ id: seats.length + 1, x, y: floorYAt(desc, x, b.stoolZ), z: b.stoolZ, ax: x, az: b.approachZ, kind: "bar" });
  }
  for (const t of desc.tables) {
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i + Math.PI / 4;
      const sx = t.x + Math.cos(a) * TABLE_SEAT_R, sz = t.z + Math.sin(a) * TABLE_SEAT_R;
      seats.push({ id: seats.length + 1, x: sx, y: floorYAt(desc, sx, sz), z: sz,
        ax: t.x + Math.cos(a) * (TABLE_SEAT_R + TABLE_APPROACH),
        az: t.z + Math.sin(a) * (TABLE_SEAT_R + TABLE_APPROACH), kind: "table" });
    }
  }
  return seats;
}

/** Axis-aligned box of a w×d block centred at (x,z), turned rotY about y,
 *  padded — the same box THREE.Box3.setFromObject() reads off the mesh. It
 *  stands on the floor under its centre, COLLIDER_H tall. */
export function blockBox({ x, z, w, d, rotY = 0, pad = 0 }, y = 0) {
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  const hx = (w / 2) * c + (d / 2) * s + pad;
  const hz = (w / 2) * s + (d / 2) * c + pad;
  return { min: { x: x - hx, y, z: z - hz }, max: { x: x + hx, y: y + COLLIDER_H, z: z + hz } };
}

/** Everything the player slides against, in the order world.js has always
 *  pushed them: kitchen preps and stoves, bar counter, table tops, crates. */
const KITCHEN_KINDS = ["prep", "stove"];
export function collidersFor(desc) {
  const out = [];
  const push = (id, box) => out.push({ id, ...box });
  const on = b => blockBox(b, floorYAt(desc, b.x, b.z));
  for (const f of desc.fitout) if (KITCHEN_KINDS.includes(f.kind)) push(f.id, on(f));
  push("bar", on({ x: desc.bar.x, z: desc.bar.z, w: desc.bar.len, d: desc.bar.depth, pad: desc.bar.pad }));
  desc.tables.forEach((t, i) => push(`table${i + 1}`,
    on({ x: t.x, z: t.z, w: TABLE_TOP_R * 2, d: TABLE_TOP_R * 2, pad: TABLE_PAD })));
  for (const f of desc.fitout) if (!KITCHEN_KINDS.includes(f.kind)) push(f.id, on(f));
  return out;
}

// ------------------------------------------------- more than one rectangle
//
// A room was the hall plus the kitchen behind it, and nothing else could be
// authored: inBounds() named the two rectangles, unreachable() and navGrid()
// rastered exactly their bounding box, and world.js drew each of the hall's
// four walls as one unbroken plane. Midtown's back room is the first floor
// rectangle that is neither, so all four of those had to stop naming rooms and
// start reading a list. An annex carries its own ceiling height; the doorway
// band through its shared wall is derived from the wall it opens through
// rather than authored, which is one fewer number to get wrong.

export const DOOR_H = 2.2;      // world.js's doorway header height
const DOOR_REACH = 0.5;         // how far a doorway band overhangs each side

/** Every walkable rectangle, as { id, x0, x1, z0, z1, h }: the hall, the
 *  kitchen, and each annex. A description with no annexes comes back as the
 *  two rectangles it always was. */
export function areasOf(desc) {
  const R = desc.room, K = desc.kitchen;
  const out = [
    { id: "room", x0: -R.x, x1: R.x, z0: -R.z, z1: R.z, h: R.h },
    { id: "kitchen", x0: K.x0, x1: K.x1, z0: K.z0, z1: K.z1, h: R.h },
  ];
  for (const a of desc.annexes ?? []) {
    out.push({ id: a.id, x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1, h: a.h ?? R.h });
  }
  return out;
}

/** The rectangle a point sits in, or null. The hall wins a tie, which only a
 *  description validate() already refuses could produce. */
export function areaAt(desc, x, z) {
  for (const a of areasOf(desc)) if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return a;
  return null;
}

/** The ceiling over a point. An annex may hang lower than the hall, and a
 *  pendant hung at the hall's height inside one is a lamp in the plaster. */
export function ceilingAt(desc, x, z) {
  return (areaAt(desc, x, z) ?? { h: desc.room.h }).h;
}

/** The walkable band through an annex's doorway, derived from the wall it
 *  opens through. `axis` is the direction of travel: the band is not inset
 *  across that axis, so it overhangs both rooms' insets and the wall slab
 *  between them; along the wall it is the gap itself. */
export function annexBand(desc, a) {
  const R = desc.room, g = a.gap;
  switch (a.wall) {
    case "east":  return { axis: "x", x0: R.x - DOOR_REACH,  x1: a.x0 + DOOR_REACH,  z0: g.a0, z1: g.a1 };
    case "west":  return { axis: "x", x0: a.x1 - DOOR_REACH, x1: -R.x + DOOR_REACH,  z0: g.a0, z1: g.a1 };
    case "north": return { axis: "z", x0: g.a0, x1: g.a1, z0: a.z1 - DOOR_REACH, z1: -R.z + DOOR_REACH };
    case "south": return { axis: "z", x0: g.a0, x1: g.a1, z0: R.z - DOOR_REACH,  z1: a.z0 + DOOR_REACH };
    default: return null;
  }
}

/** The bounding box of every walkable rectangle. unreachable() and navGrid()
 *  raster this; before annexes they rastered the hall and the kitchen, and for
 *  a description with none this is still exactly that box. */
export function floorBounds(desc) {
  const as = areasOf(desc);
  return {
    x0: Math.min(...as.map(a => a.x0)), x1: Math.max(...as.map(a => a.x1)),
    z0: Math.min(...as.map(a => a.z0)), z1: Math.max(...as.map(a => a.z1)),
  };
}

/** Floor a patron drinks on, in m²: the hall plus every annex, kitchen out. */
export function floorArea(desc) {
  return areasOf(desc).filter(a => a.id !== "kitchen")
    .reduce((n, a) => n + (a.x1 - a.x0) * (a.z1 - a.z0), 0);
}

/** The spans of one hall wall, as world.js has to draw it: the wall minus
 *  every annex gap, plus a header over each gap. `a0`/`a1` run along the wall
 *  (x for north/south, z for east/west) and `y0`/`y1` are its height band. A
 *  wall with no gap comes back as the single full-height span world.js has
 *  always drawn as one plane. */
export function wallSegments(desc, wall) {
  const R = desc.room;
  const along = (wall === "north" || wall === "south") ? R.x : R.z;
  const gaps = (desc.annexes ?? []).filter(a => a.wall === wall).map(a => a.gap)
    .slice().sort((p, q) => p.a0 - q.a0);
  const out = [];
  let cur = -along;
  for (const g of gaps) {
    if (g.a0 > cur) out.push({ a0: cur, a1: g.a0, y0: 0, y1: R.h });
    out.push({ a0: g.a0, a1: g.a1, y0: DOOR_H, y1: R.h });
    cur = g.a1;
  }
  if (cur < along) out.push({ a0: cur, a1: along, y0: 0, y1: R.h });
  return out;
}

/** Which hall walls a gap was cut in, so world.js knows to draw that one as
 *  boxes (a wall with a room on both sides has to read from both). */
export function gappedWalls(desc) {
  return new Set((desc.annexes ?? []).map(a => a.wall));
}

/** An annex's own three outer walls as boxes: { x, z, len, ry }, each a
 *  BoxGeometry(len, h, wallT) centred half a thickness outside the rectangle,
 *  so its inner face is the rectangle's edge. The fourth side is shared with
 *  the hall and belongs to wallSegments(). */
export function annexWalls(desc, a) {
  const t = desc.wallT, shared = { east: "west", west: "east", north: "south", south: "north" }[a.wall];
  const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2;
  const w = a.x1 - a.x0 + 2 * t, d = a.z1 - a.z0 + 2 * t;
  const all = {
    north: { x: cx, z: a.z0 - t / 2, len: w, ry: 0 },
    south: { x: cx, z: a.z1 + t / 2, len: w, ry: 0 },
    west:  { x: a.x0 - t / 2, z: cz, len: d, ry: Math.PI / 2 },
    east:  { x: a.x1 + t / 2, z: cz, len: d, ry: Math.PI / 2 },
  };
  return Object.entries(all).filter(([side]) => side !== shared).map(([side, b]) => ({ side, ...b }));
}

// ------------------------------------------------- a floor that is not flat
//
// Every rectangle above is at y = 0, and everything that walks was written as
// if the floor could be nothing else: Route, stepToward(), the grid's cells,
// seatsFor(), the camera and the player's ground plane were all (x, z). The
// flagship's mezzanine is the one floor that is not, so the height under a
// point is now a question this file answers — floorYAt() — and one rule
// decides where a body may step: between two points the floor may change by
// one step (STEP_H), or by MAX_SLOPE per metre, whichever is more. A stair is
// a floor that changes by less than that; its side near the foot is a kerb a
// body steps up. The deck's edge, the panelling under it and the stair's
// sides higher up all change by the whole height of the deck in no distance,
// so a body that is r wide is kept r off every one of them without any of the
// three being a collider. The rule is stated for two points and a distance,
// so the grid's neighbours, the string-pull's 10 cm samples and the level test
// at r all give the same answer — the first draft compared per sample and A*
// took a diagonal onto the stair's side that the string-pull then refused.

/** The tallest single step a body takes: one stair riser. The stair itself
 *  is a ramp, so this only ever happens stepping onto its side near the foot,
 *  and a body's y is read off the floor, so that step is one frame's pop. */
export const STEP_H = 0.18;
/** The steepest continuous floor a body walks: rise per metre of run. A 1.6 m
 *  deck up a 2.6 m stair is 0.62; the deck's own edge is 1.6 m in no run. */
export const MAX_SLOPE = 0.75;
const RISE_EPS = 1e-6;

/** May a body step from a floor at ya to one at yb, `dist` apart? */
export function stepOK(ya, yb, dist) {
  return Math.abs(ya - yb) <= Math.max(STEP_H, MAX_SLOPE * dist) + RISE_EPS;
}

/** May a body step from a to b? stepOK() over each half of the span, so a
 *  kerb in the middle of a hop is judged as the kerb it is and not as slope:
 *  two grid cells 0.35 m apart on the diagonal may not hide a 0.26 m drop
 *  between them that a 10 cm sample of the same line would refuse. */
export function stepBetween(desc, ax, az, bx, bz) {
  const h = Math.hypot(bx - ax, bz - az) / 2;
  const ya = floorYAt(desc, ax, az), yb = floorYAt(desc, bx, bz);
  const ym = floorYAt(desc, (ax + bx) / 2, (az + bz) / 2);
  return stepOK(ya, ym, h) && stepOK(ym, yb, h);
}

/** 0 at the foot of a stair, 1 at its top. */
function stairT(s, x, z) {
  switch (s.rise) {
    case "east":  return (x - s.x0) / (s.x1 - s.x0);
    case "west":  return (s.x1 - x) / (s.x1 - s.x0);
    case "south": return (z - s.z0) / (s.z1 - s.z0);
    case "north": return (s.z1 - z) / (s.z1 - s.z0);
    default: return 0;
  }
}

/** The floor under a point: 0 everywhere but a mezzanine, the deck's height
 *  on one, and the interpolated height on its stair. A point on both the deck
 *  and the stair (their shared edge) is the deck's. */
export function floorYAt(desc, x, z) {
  for (const m of desc.mezzanines ?? []) {
    if (x >= m.x0 && x <= m.x1 && z >= m.z0 && z <= m.z1) return m.y;
    const s = m.stair;
    if (s && x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return m.y * stairT(s, x, z);
  }
  return 0;
}

/** A body of radius r stands on one floor: the floor r away in each of the
 *  four directions is within a step of the floor under its centre. This is
 *  the rail along the deck, the panelling under it and the stair's sides,
 *  without any of them being a collider — and on the stair itself it is what
 *  lets a body climb, because the rise across r is under the slope. */
export function levelOpen(desc, x, z, r) {
  if (!(desc.mezzanines?.length) || r <= 0) return true;
  return stepBetween(desc, x, z, x + r, z) && stepBetween(desc, x, z, x - r, z) &&
         stepBetween(desc, x, z, x, z + r) && stepBetween(desc, x, z, x, z - r);
}

/** The deck's edges that are not the hall's walls, in world coordinates, as
 *  { side, a0, a1 } along that side (x for north/south, z for east/west) —
 *  the spans world.js rails and panels. The span the stair lands on is left
 *  out: the stair is what closes it. */
export function mezzanineEdges(desc, m) {
  const R = desc.room, s = m.stair, out = [];
  const sides = { north: [m.z0, -R.z], south: [m.z1, R.z], west: [m.x0, -R.x], east: [m.x1, R.x] };
  for (const [side, [at, wall]] of Object.entries(sides)) {
    if (Math.abs(at - wall) < 1e-9) continue;
    const along = side === "north" || side === "south";
    let spans = [[along ? m.x0 : m.z0, along ? m.x1 : m.z1]];
    // the stair's top is flush against the side it rises toward
    const lands = s && { east: "west", west: "east", north: "south", south: "north" }[s.rise] === side;
    if (lands) {
      const lo = along ? s.x0 : s.z0, hi = along ? s.x1 : s.z1;
      spans = spans.flatMap(([a, b]) => [[a, Math.min(b, lo)], [Math.max(a, hi), b]]).filter(([a, b]) => b - a > 1e-9);
    }
    for (const [a0, a1] of spans) out.push({ side, a0, a1 });
  }
  return out;
}

/** Walkable test: hall ∪ kitchen ∪ each doorway's corridor band ∪ each annex
 *  and the band through its doorway — and, where the floor is not flat, on
 *  one floor (levelOpen). */
export function inBounds(desc, x, z, r = 0.3) {
  return inRects(desc, x, z, r) && levelOpen(desc, x, z, r);
}
function inRects(desc, x, z, r) {
  const R = desc.room, K = desc.kitchen;
  if (x > -R.x + r && x < R.x - r && z > -R.z + r && z < R.z - r) return true;
  for (const d of desc.doorways) {
    if (x > d.x0 + r && x < d.x1 - r && z > d.corridor.z0 && z < d.corridor.z1) return true;
  }
  for (const a of desc.annexes ?? []) {
    if (x > a.x0 + r && x < a.x1 - r && z > a.z0 + r && z < a.z1 - r) return true;
    const b = annexBand(desc, a);
    if (!b) continue;
    if (b.axis === "x") { if (x > b.x0 && x < b.x1 && z > b.z0 + r && z < b.z1 - r) return true; }
    else if (x > b.x0 + r && x < b.x1 - r && z > b.z0 && z < b.z1) return true;
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
  const c = desc.stations.cooks, x = c.x + i * COOK_PITCH;
  return { x, y: floorYAt(desc, x, c.z), z: c.z };
}

/** Where the i-th floor staffer idles between tickets. */
export function crewHome(desc, i) {
  const h = desc.stations.crewHome, x = h.x + CREW_SPREAD[i % CREW_SPREAD.length];
  return { x, y: floorYAt(desc, x, h.z), z: h.z };
}

const TV_INSET = 0.06;
/** The rectangle a TV hangs in: the hall, or the annex its `area` names.
 *  Returns null for an `area` no annex answers to. */
export function tvArea(desc, tv) {
  const R = desc.room;
  if (!tv.area) return { id: "room", x0: -R.x, x1: R.x, z0: -R.z, z1: R.z, h: R.h };
  return areasOf(desc).find(a => a.id === tv.area) ?? null;
}

/** A TV's mount as world.js draws it: centre and yaw, hung on the named wall
 *  of the rectangle it belongs to. The hall's north wall is a brick slab, so
 *  the inset there clears half its thickness; every other wall's inner face is
 *  the rectangle's own edge, slab or plane, so 6 cm clears it. */
export function tvMount(desc, tv) {
  const rc = tvArea(desc, tv);
  if (!rc) return null;
  const hall = rc.id === "room";
  switch (tv.wall) {
    case "north": return { x: tv.at, y: tv.y, z: rc.z0 + (hall ? desc.wallT / 2 + 0.02 : TV_INSET), ry: 0 };
    case "east":  return { x: rc.x1 - TV_INSET, y: tv.y, z: tv.at, ry: -Math.PI / 2 };
    case "west":  return { x: rc.x0 + TV_INSET, y: tv.y, z: tv.at, ry: Math.PI / 2 };
    case "south": return { x: tv.at, y: tv.y, z: rc.z1 - TV_INSET, ry: Math.PI };
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
  const fb = floorBounds(desc);
  const x0 = Math.floor(fb.x0 / GRID), x1 = Math.ceil(fb.x1 / GRID);
  const z0 = Math.floor(fb.z0 / GRID), z1 = Math.ceil(fb.z1 / GRID);
  const W = x1 - x0 + 1;
  const key = (xi, zi) => (zi - z0) * W + (xi - x0);
  const open = new Uint8Array(W * (z1 - z0 + 1));
  const flat = !(desc.mezzanines?.length);
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
      // the next cell has to be a step away, not a climb: the deck's edge is
      // a whole floor's rise in one cell, and the stair is not
      if (open[k] && !seen[k] && (flat || stepBetween(desc, xi * GRID, zi * GRID, nx * GRID, nz * GRID))) { seen[k] = 1; queue.push([nx, nz]); }
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
 *  lattice unreachable() floods, spanning every floor rectangle, and
 *  `y[...]` the floor under each open cell. */
export function navGrid(desc, r = WALKER_R) {
  let byR = navCache.get(desc);
  if (!byR) navCache.set(desc, (byR = new Map()));
  const hit = byR.get(r);
  if (hit) return hit;
  const cols = collidersFor(desc);
  const fb = floorBounds(desc);
  const x0 = Math.floor(fb.x0 / GRID), x1 = Math.ceil(fb.x1 / GRID);
  const z0 = Math.floor(fb.z0 / GRID), z1 = Math.ceil(fb.z1 / GRID);
  const W = x1 - x0 + 1, H = z1 - z0 + 1;
  const open = new Uint8Array(W * H);
  const y = new Float32Array(W * H);   // the floor under each open cell
  for (let zi = 0; zi < H; zi++) {
    for (let xi = 0; xi < W; xi++) {
      const px = (x0 + xi) * GRID, pz = (z0 + zi) * GRID;
      if (navOpen(desc, px, pz, r, cols)) { open[zi * W + xi] = 1; y[zi * W + xi] = floorYAt(desc, px, pz); }
    }
  }
  const g = { desc, r, x0, z0, W, H, open, y, cols, flat: !(desc.mezzanines?.length) };
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
  // a target on the deck snaps to a cell on the deck, never to the hall floor
  // under its rail: the cell has to be a step from the point, not a climb
  const py = floorYAt(g.desc, x, z);
  const fits = i => stepOK(py, g.y[i], Math.hypot(cellX(g, i) - x, cellZ(g, i) - z));
  if (cx >= 0 && cx < g.W && cz >= 0 && cz < g.H && g.open[cz * g.W + cx] && fits(cz * g.W + cx)) return cz * g.W + cx;
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
      if (d < bestD && d <= within && fits(i)) { bestD = d; best = i; }
    }
  }
  return best;
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Eight neighbours, minus the two diagonals that would cut a corner, and
 *  minus any cell more than a stride's rise above or below this one — a body
 *  walks up the stair, not off the deck's edge. */
function eachNeighbour(g, i, fn) {
  const xi = i % g.W, zi = (i - xi) / g.W;
  for (let k = 0; k < 8; k++) {
    const dx = NB[k][0], dz = NB[k][1];
    const nx = xi + dx, nz = zi + dz;
    if (nx < 0 || nx >= g.W || nz < 0 || nz >= g.H) continue;
    const n = nz * g.W + nx;
    if (!g.open[n]) continue;
    if (dx && dz && !(g.open[zi * g.W + nx] && g.open[nz * g.W + xi])) continue;
    const w = dx && dz ? DIAG : 1;
    if (!g.flat && !stepBetween(g.desc, cellX(g, i), cellZ(g, i), cellX(g, n), cellZ(g, n))) continue;
    fn(n, w);
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

/** Every 10 cm of a→b is open for a body of radius r, and no 10 cm of it
 *  rises more than a stride: the string-pull may not shortcut from the stair's
 *  foot to the deck across the edge of the deck. */
export function clearLine(desc, a, b, r = WALKER_R, cols = collidersFor(desc)) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(d / LINE_STEP));
  let py = floorYAt(desc, a.x, a.z);
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a.x + dx * t, z = a.z + dz * t;
    if (!navOpen(desc, x, z, r, cols)) return false;
    const y = floorYAt(desc, x, z);
    if (!stepOK(py, y, d / n)) return false;
    py = y;
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
  // annexes: a second rectangle is a wall between the door and part of the
  // room, so every one of these is load-bearing. The shared edge has to sit
  // exactly one wall thickness outside the hall, because world.js draws that
  // wall as a box whose inner face is the plane it replaces — a hair either
  // way is a gap you can see through or a slab inside the annex.
  const seenAnnex = new Set();
  for (const [i, a] of (desc.annexes ?? []).entries()) {
    const R = desc.room, t = desc.wallT, name = `annex ${a.id ?? i}`;
    if (!a.id || seenAnnex.has(a.id)) bad.push(`${name} has no unique id`);
    seenAnnex.add(a.id);
    if (!(a.x1 > a.x0 && a.z1 > a.z0)) { bad.push(`${name} is not a rectangle`); continue; }
    const band = annexBand(desc, a);
    if (!band) { bad.push(`${name} opens through no wall (${a.wall})`); continue; }
    // the north wall carries the kitchen doorway, the pass window and the back
    // bar's shelf, and world.js draws it as brick rather than from
    // wallSegments(); an annex behind it would have to share all three
    if (a.wall === "north") { bad.push(`${name} opens north, and the hall's north wall is the kitchen's`); continue; }
    const edge = { east: [a.x0, R.x + t], west: [a.x1, -R.x - t],
                   north: [a.z1, -R.z - t], south: [a.z0, R.z + t] }[a.wall];
    if (Math.abs(edge[0] - edge[1]) > 1e-9) {
      bad.push(`${name}'s shared edge is at ${fmt(edge[0])}, not the ${fmt(edge[1])} that puts the hall's ${a.wall} wall against it`);
    }
    const sideways = a.wall === "north" || a.wall === "south";
    const along = sideways ? R.x : R.z;
    const lo = sideways ? a.x0 : a.z0, hi = sideways ? a.x1 : a.z1;
    if (lo < -along || hi > along) bad.push(`${name} runs past the ends of the hall's ${a.wall} wall`);
    if (!(a.gap.a1 > a.gap.a0)) bad.push(`${name}'s doorway is not a gap`);
    else if (a.gap.a0 < lo || a.gap.a1 > hi) bad.push(`${name}'s doorway opens onto no annex`);
    if (!(a.h > DOOR_H + 0.3)) bad.push(`${name}'s ceiling at ${fmt(a.h)} m does not clear its own doorway`);
    for (const o of areasOf(desc)) {
      if (o.id === a.id) continue;
      if (a.x0 < o.x1 && a.x1 > o.x0 && a.z0 < o.z1 && a.z1 > o.z0) bad.push(`${name} overlaps ${o.id}`);
    }
    // walk the doorway's centre line from inside the hall to inside the annex,
    // 5 cm at a time — the same question the north doorway is asked
    const mid = (a.gap.a0 + a.gap.a1) / 2;
    const from = { east: R.x - 0.31, west: -R.x + 0.31, north: -R.z + 0.31, south: R.z - 0.31 }[a.wall];
    const to = { east: a.x1 - 0.31, west: a.x0 + 0.31, north: a.z0 + 0.31, south: a.z1 - 0.31 }[a.wall];
    const step = to > from ? 0.05 : -0.05;
    let joined = true;
    for (let u = from; step > 0 ? u < to : u > to; u += step) {
      const [x, z] = band.axis === "x" ? [u, mid] : [mid, u];
      if (!inBounds(desc, x, z, 0.3)) { joined = false; break; }
    }
    if (!joined) bad.push(`${name}'s doorway at ${fmt(mid)} does not join it to the hall`);
  }
  // mezzanines: a raised floor inside the hall. Everything here is what makes
  // the one step rule enough — the deck inside the hall's walls, the stair
  // flush against the deck's edge and no steeper than a body climbs, and
  // nothing under the deck that anybody needs to reach.
  const seenMezz = new Set();
  for (const [i, m] of (desc.mezzanines ?? []).entries()) {
    const R = desc.room, name = `mezzanine ${m.id ?? i}`;
    if (!m.id || seenMezz.has(m.id)) bad.push(`${name} has no unique id`);
    seenMezz.add(m.id);
    if (!(m.x1 > m.x0 && m.z1 > m.z0)) { bad.push(`${name} is not a rectangle`); continue; }
    if (!(m.y > 0)) bad.push(`${name} at y=${fmt(m.y ?? 0)} is a floor, not a mezzanine`);
    if (m.x0 < -R.x || m.x1 > R.x || m.z0 < -R.z || m.z1 > R.z) bad.push(`${name} runs outside the hall`);
    if (R.h - m.y < 2.0) bad.push(`${name} leaves ${fmt(R.h - m.y)} m of headroom under the hall's ceiling`);
    const s = m.stair;
    if (!s) { bad.push(`${name} has no stair`); continue; }
    if (!(s.x1 > s.x0 && s.z1 > s.z0)) { bad.push(`${name}'s stair is not a rectangle`); continue; }
    if (!["east", "west", "north", "south"].includes(s.rise)) { bad.push(`${name}'s stair rises nowhere (${s.rise})`); continue; }
    if (s.x0 < -R.x || s.x1 > R.x || s.z0 < -R.z || s.z1 > R.z) bad.push(`${name}'s stair runs outside the hall`);
    const along = s.rise === "east" || s.rise === "west";
    const run = along ? s.x1 - s.x0 : s.z1 - s.z0, width = along ? s.z1 - s.z0 : s.x1 - s.x0;
    if (m.y / run > MAX_SLOPE) bad.push(`${name}'s stair climbs ${fmt(m.y)} m in ${fmt(run)} m, steeper than a body walks (${MAX_SLOPE})`);
    if (width < 0.9) bad.push(`${name}'s stair is ${fmt(width)} m wide, too narrow for a body and its shoulders`);
    const top = { east: [s.x1, m.x0], west: [s.x0, m.x1], south: [s.z1, m.z0], north: [s.z0, m.z1] }[s.rise];
    if (Math.abs(top[0] - top[1]) > 1e-9) bad.push(`${name}'s stair tops out at ${fmt(top[0])}, not against the deck's edge at ${fmt(top[1])}`);
    const lo = along ? s.z0 : s.x0, hi = along ? s.z1 : s.x1, dlo = along ? m.z0 : m.x0, dhi = along ? m.z1 : m.x1;
    if (lo < dlo || hi > dhi) bad.push(`${name}'s stair lands past the deck's edge`);
    if (s.x0 < m.x1 && s.x1 > m.x0 && s.z0 < m.z1 && s.z1 > m.z0) bad.push(`${name}'s stair overlaps its deck`);
    // nothing anybody has to reach may stand under the deck or the stair:
    // the bar, a stove, a crate — a table on the deck is lifted with it
    const under = (x, z) => (x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1) || (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);
    if (under(desc.bar.x, desc.bar.z)) bad.push(`${name} stands on the bar`);
    for (const f of desc.fitout) if (under(f.x, f.z)) bad.push(`${name} stands on ${f.id}`);
    for (const t of desc.tables) if (under(t.x, t.z) && floorYAt(desc, t.x, t.z) < m.y) bad.push(`a table at (${fmt(t.x)}, ${fmt(t.z)}) stands on ${name}'s stair`);
  }
  // no two things the player interacts with by proximity within one
  // interaction radius of each other: day.js's nearest() takes the closest
  // ring inside 1.6 m, and player.js answers nearStove()/nearTap() at 1.6 m
  const near = ["stove", "tap", ...RING_IDS].filter(k => st[k]);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
    const a = st[near[i]], b = st[near[j]], dist = Math.hypot(a.x - b.x, a.z - b.z);
    if (dist < INTERACT_R) bad.push(`stations ${near[i]} and ${near[j]} are ${fmt(dist)} m apart (interaction range is ${INTERACT_R})`);
  }
  // TVs hang on a wall of the hall or of one of its annexes, inside that
  // rectangle's span, below its ceiling, and not across a doorway
  for (const [i, tv] of (desc.tvs ?? []).entries()) {
    if (tv.area && !(desc.annexes ?? []).some(a => a.id === tv.area)) {
      bad.push(`tv ${i} hangs in ${tv.area}, which is no room of this one`); continue;
    }
    const m = tvMount(desc, tv);
    if (!m) { bad.push(`tv ${i} names no wall (${tv.wall})`); continue; }
    const rc = tvArea(desc, tv);
    const sideways = tv.wall === "north" || tv.wall === "south";
    const lo = sideways ? rc.x0 : rc.z0, hi = sideways ? rc.x1 : rc.z1;
    if (tv.at < lo + 1 || tv.at > hi - 1) bad.push(`tv ${i} at ${fmt(tv.at)} runs off the ${tv.wall} wall`);
    // measured from the floor under the mount: a TV on the mezzanine's wall
    // hangs over the deck, not the hall floor
    const over = tv.y - floorYAt(desc, m.x, m.z);
    if (over < 1.2 || tv.y > rc.h - 0.6) bad.push(`tv ${i} at y=${fmt(tv.y)} is not on the wall`);
    if (!tv.area) for (const a of desc.annexes ?? []) {
      if (a.wall === tv.wall && tv.at > a.gap.a0 - 1 && tv.at < a.gap.a1 + 1) {
        bad.push(`tv ${i} at ${fmt(tv.at)} hangs over the ${a.id} doorway`);
      }
    }
  }
  for (const [i, p] of (desc.pendants ?? []).entries()) {
    if (!inBounds(desc, p.x, p.z, 0)) bad.push(`pendant ${i} (${fmt(p.x)}, ${fmt(p.z)}) hangs outside the room`);
  }
  for (const name of unreachable(desc)) bad.push(`${name} cannot be reached from the door`);
  for (const m of navProblems(desc)) bad.push(m);
  return bad;
}

function fmt(n) { return Math.round(n * 100) / 100; }
