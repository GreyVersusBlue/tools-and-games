// smoke-layout.mjs — node test/smoke-layout.mjs
// The room as data. Two kinds of check: (1) the Corner Tap description derives
// exactly what world.js built for three rounds — the fixture in
// test/fixtures/corner-tap.json was dumped from the real page in Chromium
// (seats, THREE.Box3 colliders, inBounds() on a 0.25 m grid) before layout.js
// existed, so this is a comparison against the old function, not against a
// re-implementation of it; (2) the walkability invariant every description in
// the table has to hold, so Phase 2 can author a room without walking it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as L from "../js/layout.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "fixtures", "corner-tap.json"), "utf8"));
const tap = L.CORNER_TAP;

// --- the table ---
const LADDER = ["cornerTap", "fieldhouse", "midtown", "flagship"];
ok(Object.keys(L.LAYOUTS).length === 4, "one description per venue tier");
for (const id of LADDER) ok(L.layoutFor(id) && L.layoutFor(id).id === id, `layoutFor(${id}) is its own room`);
ok(new Set(LADDER.map(id => L.layoutFor(id))).size === 4, "four distinct descriptions, no tier borrows another's");
ok(L.layoutFor("nowhere") === L.CORNER_TAP, "an unknown venue falls back to the Corner Tap");
ok(L.layoutFor(undefined) === L.CORNER_TAP, "an unset venue falls back to the Corner Tap");
ok(Object.isFrozen(tap), "the description is frozen");

// --- (1) the Corner Tap is what world.js built ---
ok(tap.room.x === fx.points.ROOM.x && tap.room.z === fx.points.ROOM.z && tap.room.h === fx.points.ROOM.h, "ROOM matches");
ok(["x0", "x1", "z0", "z1"].every(k => tap.kitchen[k] === fx.points.KITCHEN[k]), "KITCHEN matches");

const seats = L.seatsFor(tap);
ok(seats.length === 30, `30 seats (got ${seats.length})`);
ok(seats.length === fx.seats.length, "same seat count as the fixture");
let seatDrift = 0;
seats.forEach((s, i) => {
  const f = fx.seats[i];
  if (!f || s.id !== f.id || !near(s.x, f.x) || !near(s.z, f.z) || !near(s.ax, f.ax) || !near(s.az, f.az)) seatDrift++;
});
ok(seatDrift === 0, `every seat is the fixture's, in the fixture's order (${seatDrift} differ)`);
ok(seats.slice(0, 6).every(s => s.kind === "bar") && seats.slice(6).every(s => s.kind === "table"), "six bar stools then twenty-four table stools");
ok(seats.every((s, i) => s.id === i + 1), "seat ids run 1..30");

const cols = L.collidersFor(tap);
ok(cols.length === 11, `11 colliders (got ${cols.length})`);
ok(cols.length === fx.colliders.length, "same collider count as the fixture");
let colDrift = 0;
cols.forEach((c, i) => {
  const f = fx.colliders[i];
  if (!f) { colDrift++; return; }
  for (const ax of ["x", "y", "z"]) {
    if (!near(c.min[ax], f.min[ax], 1e-6) || !near(c.max[ax], f.max[ax], 1e-6)) colDrift++;
  }
});
ok(colDrift === 0, `every collider box is the fixture's Box3, in order (${colDrift} edges differ)`);
ok(cols.every(c => c.min.y === 0 && c.max.y === L.COLLIDER_H), "colliders span floor to 2.5 m");
ok(cols.map(c => c.id).join(",") === "prep,stove,bar,table1,table2,table3,table4,table5,table6,crate1,crate2", "collider order is world.js's push order");
ok(!("min" in cols[0].min) && typeof cols[0].min.x === "number", "colliders are plain {min,max} objects");

// the rotated crate is the one box a naive w×d would get wrong
const crate2 = cols.find(c => c.id === "crate2");
ok(crate2.max.x - crate2.min.x > 0.55 + 0.12 + 0.05, "crate2's AABB is wider than its unrotated footprint");

// inBounds against the old function on a grid of 5,037 samples
const g = fx.grid;
let gridDrift = 0, gridChecked = 0, corridorDrift = 0;
g.rows.forEach((row, zi) => {
  const z = g.z0 + zi * g.step;
  for (let xi = 0; xi < row.length; xi++) {
    const x = g.x0 + xi * g.step;
    const was = row[xi] === "1", now = L.inBounds(tap, x, z, g.r);
    gridChecked++;
    if (was !== now) { gridDrift++; if (z > -6.0 && z < -4.8) corridorDrift++; }
  }
});
ok(gridChecked === 69 * 73, `grid is 69×73 samples (got ${gridChecked})`);
ok(gridDrift === 0, `inBounds agrees with the old world.js on every sample (${gridDrift} differ)`);
ok(corridorDrift === 0, `the corridor band z∈(-6,-4.8) agrees with the old world.js (${corridorDrift} differ)`);
// and the three regions each contribute samples — a grid that is all-false agrees with nothing
const count = (z0, z1) => g.rows.reduce((n, row, zi) => { const z = g.z0 + zi * g.step; return n + ((z > z0 && z < z1) ? [...row].filter(c => c === "1").length : 0); }, 0);
ok(count(-5.5, 5.5) > 2000, "fixture has walkable main-room samples");
ok(count(-9, -5.5) > 200, "fixture has walkable kitchen samples");
ok(count(-5.6, -5.4) >= 1 && count(-5.6, -5.4) <= 6, `fixture's corridor is a few samples wide at the wall (got ${count(-5.6, -5.4)})`);

const pts = L.standPointsFor(tap);
const same = (k, fk) => near(pts[k].x, fx.points[fk][0]) && near(pts[k].y, fx.points[fk][1]) && near(pts[k].z, fx.points[fk][2]);
ok(same("door", "DOOR") && same("doorOut", "DOOR_OUT"), "DOOR / DOOR_OUT match");
ok(same("passFood", "PASS_FOOD") && same("passDrink", "PASS_DRINK"), "PASS_FOOD / PASS_DRINK match");
ok(same("passFoodShelf", "PASS_FOOD_SHELF") && same("passDrinkShelf", "PASS_DRINK_SHELF"), "shelves match, y included");
ok(same("stove", "STOVE_STATION") && same("tap", "TAP_STATION") && same("upgrades", "UPGRADES_STATION"), "STOVE / TAP / UPGRADES stations match");
// day.js's six ring literals, transcribed
ok(near(pts.stock.x, 4.5) && near(pts.stock.z, -7.2), "stock ring is at the kitchen's centre x, z -7.2");
ok(near(pts.crew.x, -2) && near(pts.crew.z, -2.1), "crew ring");
ok(near(pts.promo.x, -3.2) && near(pts.promo.z, 4.3), "promo ring is ROOM.z - 1.2");
ok(near(pts.doorRing.x, 0) && near(pts.doorRing.z, 4.3), "door ring is DOOR.z - 0.9");
ok(near(pts.upgrades.x, -6.6) && near(pts.upgrades.z, -1.6), "upgrades ring is the UPGRADES_STATION");
ok(near(pts.realEstate.x, 6.7) && near(pts.realEstate.z, -0.8), "real-estate ring");
ok(L.RING_IDS.length === 6 && L.RING_IDS.every(k => pts[k]), "six ring ids, each a station");
// the literals main.js and world.js carried until Phase 2, transcribed
ok(near(pts.spawn.x, 0) && near(pts.spawn.z, 3.4), "spawn is main.js's camera literal (0, 3.4)");
const homes = [0, 1, 2].map(i => L.crewHome(tap, i));
ok(homes.every(h => near(h.z, -2.2)) && homes.map(h => h.x).join() === "0.4,-3.4,2.6", "idle servers stand at main.js's spread on the z -2.2 line");
const cooks = [0, 1, 2].map(i => L.cookSpot(tap, i));
ok(cooks.every(c => near(c.z, -9 + 1.3)) && cooks.map(c => c.x).join() === "3.9,4.4,4.9", "cooks stand on main.js's line: kitchen centre - 0.6, z0 + 1.3, every 0.5 m");
const tvm = tap.tvs.map(t => L.tvMount(tap, t));
ok(tvm.length === 3, "three TVs");
ok(near(tvm[0].x, -4.5) && near(tvm[0].y, 2.35) && near(tvm[0].z, -5.5 + 0.075 + 0.02) && tvm[0].ry === 0, "north TV is world.js's (-4.5, 2.35, nz + WALL_T/2 + 0.02, 0)");
ok(near(tvm[1].x, 8 - 0.06) && near(tvm[1].z, -2.6) && near(tvm[1].ry, -Math.PI / 2), "east TV is world.js's (ROOM.x - 0.06, 2.2, -2.6, -π/2)");
ok(near(tvm[2].x, -8 + 0.06) && near(tvm[2].z, 0.5) && near(tvm[2].ry, Math.PI / 2), "west TV is world.js's (-ROOM.x + 0.06, 2.2, 0.5, π/2)");
ok(JSON.stringify(tap.pendants.map(p => [p.x, p.z])) === JSON.stringify([[-4, 0.8], [0, 0.8], [4, 1.8], [-2, -3.2], [5.3, -4.4]]), "five pendants are world.js's `warm` literals");

// --- (2) the walkability invariant, for every description in the table ---
for (const [id, desc] of Object.entries(L.LAYOUTS)) {
  const bad = L.validate(desc);
  ok(bad.length === 0, `${id} validates: ${bad.join("; ")}`);
  ok(L.unreachable(desc).length === 0, `${id}: every standing point is reached from the door`);
  ok(L.standingPoints(desc).length === L.seatsFor(desc).length + 13 + 6, `${id}: standing points are every seat, 13 stations, 3 servers and 3 cooks`);
}

// --- (3) the ladder: each rung is the bigger room its VENUES blurb promises ---
const seatCounts = LADDER.map(id => L.seatsFor(L.layoutFor(id)).length);
ok(seatCounts.join() === "30,44,58,76", `seats up the ladder are 30, 44, 58, 76 (got ${seatCounts.join()})`);
ok(seatCounts.every((n, i) => i === 0 || n > seatCounts[i - 1]), "seat count is strictly monotonic up the ladder");
ok(seatCounts[1] >= 40 && seatCounts[3] >= 70, "the Fieldhouse seats 40-odd and the flagship 70+");
const stoves = LADDER.map(id => L.layoutFor(id).fitout.filter(f => f.kind === "stove").length);
ok(stoves.join() === "1,2,2,3", `stoves up the ladder are 1, 2, 2, 3 (got ${stoves.join()})`);
const taps = LADDER.map(id => L.layoutFor(id).bar.taps);
ok(taps.every((n, i) => i === 0 || n > taps[i - 1]) && taps[2] >= 6, `taps climb the ladder and Midtown has a draft wall (got ${taps.join()})`);
const floors = LADDER.map(id => L.layoutFor(id).room.x * L.layoutFor(id).room.z * 4);
ok(floors.every((a, i) => i === 0 || a > floors[i - 1]), `floor area climbs the ladder (${floors.join(", ")} m²)`);
const drinking = LADDER.map(id => L.floorArea(L.layoutFor(id)));
ok(drinking.every((a, i) => i === 0 || a > drinking[i - 1]), `and so does the floor a patron drinks on, annexes counted (${drinking.join(", ")} m²)`);
for (const id of LADDER) {
  const d = L.layoutFor(id), cols = L.collidersFor(d);
  ok(cols.length === d.fitout.length + 1 + d.tables.length, `${id}: one collider per block, the bar, and each table`);
  ok(new Set(cols.map(c => c.id)).size === cols.length, `${id}: collider ids are unique`);
  ok(d.tvs.length >= 3 && d.pendants.length >= 5, `${id}: at least three TVs and five pendants`);
}
ok(LADDER.map(id => L.layoutFor(id).tvs.length).join() === "3,4,6,7", "TVs up the ladder are 3, 4, 6, 7 — Midtown's sixth is in the back room");
// the invariant is looking at the right things
ok(L.walkable(tap, 0, 0), "the middle of the room is walkable");
ok(!L.walkable(tap, -5, 0.9), "the centre of a table is not walkable (collider)");
ok(!L.walkable(tap, 0, -7), "the wall behind the bar is not walkable (out of bounds)");
ok(L.walkable(tap, 2.9, -5.5), "the doorway is walkable through the wall");
ok(!L.walkable(tap, 0.5, -5.5), "the wall beside the doorway is not");
ok(L.walkable(tap, 6.1, -7.7), "the stove stand-point is walkable and the stove is not");
ok(!L.walkable(tap, 6.4, -8.45), "…the stove is not");

// --- (4) a room that is more than one rectangle ---
// Midtown's back room is the first floor rectangle in this file that is
// neither the hall nor the kitchen. Everything that used to name those two by
// hand -- inBounds(), the two grids' bounding boxes, and the hall's walls --
// now reads areasOf(), and a description with no annex has to come out of that
// exactly as it went in.
{
  const m = L.MIDTOWN, a = m.annexes[0];
  ok(["cornerTap", "fieldhouse", "flagship"].every(id => (L.layoutFor(id).annexes ?? []).length === 0),
    "only Midtown has a second room so far");
  ok(L.areasOf(L.CORNER_TAP).length === 2, "a room with no annex is the two rectangles it always was");
  ok(L.areasOf(m).length === 3 && L.areasOf(m).some(r => r.id === "backRoom"), "Midtown is the hall, the kitchen and the back room");
  ok(near(a.x0, m.room.x + m.wallT), `the back room's shared edge is one wall thickness outside the hall (${a.x0})`);
  ok(L.ceilingAt(m, 14.2, 0) === a.h && a.h < m.room.h, `the back room hangs lower than the hall (${a.h} m under ${m.room.h})`);
  ok(L.ceilingAt(m, 0, 0) === m.room.h, "…and the hall is still the hall's height");
  ok(L.ceilingAt(L.CORNER_TAP, 0, 0) === L.CORNER_TAP.room.h, "a room with no annex answers its own height everywhere");
  // inBounds through the doorway, and not through the wall beside it
  ok(L.inBounds(m, 12.075, 1.05), "the back room's doorway is walkable through the wall");
  ok(!L.inBounds(m, 12.075, 4.0), "the wall beside it is not");
  ok(L.inBounds(m, 15, 0), "the middle of the back room is walkable");
  ok(!L.inBounds(m, 19, 0), "past its east wall is not");
  ok(!L.inBounds(m, 15, 6), "and neither is the dead ground beside it, level with the hall's south end");
  // the two grids grew east with it
  const fb = L.floorBounds(m);
  ok(near(fb.x1, a.x1) && near(fb.x0, -m.room.x), `the floor's bounding box reaches the back room's far wall (${fb.x0}..${fb.x1})`);
  ok(L.floorBounds(L.FLAGSHIP).x1 === L.FLAGSHIP.room.x && L.floorBounds(L.FLAGSHIP).z0 === L.FLAGSHIP.kitchen.z0,
    "a room with no annex has the bounding box the hall and the kitchen always gave it");
  // the wall the doorway is cut in
  const east = L.wallSegments(m, "east");
  ok(east.length === 3, `the hall's east wall is two spans and a header (${east.length})`);
  ok(east[1].y0 === L.DOOR_H && near(east[1].a0, a.gap.a0) && near(east[1].a1, a.gap.a1), "…the middle one being the header over the doorway");
  ok(near(east[0].a0, -m.room.z) && near(east[2].a1, m.room.z), "…and the two spans reach the wall's ends");
  ok(L.wallSegments(m, "south").length === 1 && L.wallSegments(L.CORNER_TAP, "east").length === 1,
    "a wall with no doorway is one span, which is the plane world.js always drew");
  ok(L.gappedWalls(m).has("east") && !L.gappedWalls(m).has("south") && L.gappedWalls(L.CORNER_TAP).size === 0,
    "only the east wall is gapped, and only Midtown has one");
  const aw = L.annexWalls(m, a);
  ok(aw.length === 3 && !aw.some(w => w.side === "west"), "the back room draws its own three walls and leaves the shared one to the hall");
  ok(aw.every(w => L.areaAt(m, w.x, w.z) === null || w.side === "west"), "…and every one of them stands outside the floor it encloses");
  // three four-tops moved into it rather than were added to the ladder
  const mseats = L.seatsFor(m);
  ok(mseats.length === 58, `Midtown still seats the ladder's 58 with a second room (${mseats.length})`);
  const inAnnex = mseats.filter(s => s.x > a.x0).length;
  ok(inAnnex === 12, `twelve of them are behind the doorway (${inAnnex})`);
  ok(near(L.floorArea(m), m.room.x * m.room.z * 4 + (a.x1 - a.x0) * (a.z1 - a.z0)),
    `floorArea is the hall plus the annex and not the kitchen (${L.floorArea(m)} m²)`);
  const atv = m.tvs.find(t => t.area === "backRoom");
  const amount = L.tvMount(m, atv);
  ok(!!atv && amount && near(amount.z, a.z0 + 0.06) && amount.ry === 0,
    "the back room's TV hangs on its own north wall, six centimetres off it, not on the hall's");
}

const clone = d => JSON.parse(JSON.stringify(d));

// --- (5) a floor that is not flat ---
// The flagship's mezzanine is the first floor in the file that is not at
// y = 0. floorYAt() is the one place that says so; seats, colliders and
// stand-points carry the floor under them; and one rule -- the floor under a
// body changes by MAX_SLOPE per metre or less -- is the rail, the panelling
// under the deck and the stair's sides at once.
{
  const f = L.FLAGSHIP, m = f.mezzanines[0], s = m.stair;
  ok(["cornerTap", "fieldhouse", "midtown"].every(id => (L.layoutFor(id).mezzanines ?? []).length === 0),
    "only the flagship has a floor that is not at y = 0");
  ok(m.y > 1 && s.rise === "east" && near(s.x1, m.x0), `the deck is ${m.y} m up, and the stair tops out against its west edge`);
  ok(L.floorYAt(f, 0, 0) === 0 && L.floorYAt(f, 9, 6) === m.y, "the hall floor is at 0 and the deck at its height");
  ok(L.floorYAt(f, s.x0, 8.3) === 0 && near(L.floorYAt(f, s.x1, 8.3), m.y), "the stair is at 0 at its foot and the deck's height at its top");
  ok(near(L.floorYAt(f, (s.x0 + s.x1) / 2, 8.3), m.y / 2), "and half way up half way along");
  ok(near(L.floorYAt(f, s.x0 + 0.65, 8.3), m.y / 4), "a quarter of the way along is a quarter of the way up: a ramp, not a step");
  ok(L.floorYAt(f, 4, 5) === 0, "beside the stair, on the hall floor, is 0");
  ok(L.floorYAt(L.CORNER_TAP, 0, 0) === 0 && L.floorYAt(L.MIDTOWN, 15, 0) === 0, "a room with no mezzanine is 0 everywhere, the back room included");
  ok(L.stepOK(0, 0.15, 0.25) && L.stepOK(0, L.STEP_H, 0.05) && !L.stepOK(0, 0.25, 0.25) && !L.stepOK(0, m.y, 0.25) && L.stepOK(0, 0.6, 1) && !L.stepOK(0, 0.8, 1),
    `a body steps up one riser (${L.STEP_H} m) in one stride and climbs ${L.MAX_SLOPE} per metre: 25 cm in a cell is neither, and the deck's edge is not`);
  // the one rule, from four sides
  ok(L.inBounds(f, 5.1, 5, 0.3) && !L.inBounds(f, 5.3, 5, 0.3), "a 0.3 m body on the hall floor stops 0.3 m short of the panelling under the deck");
  ok(L.inBounds(f, 5.85, 5, 0.3) && !L.inBounds(f, 5.7, 5, 0.3), "and on the deck stops 0.3 m short of the rail");
  ok(L.inBounds(f, 9, 3.35, 0.3) && !L.inBounds(f, 9, 3.2, 0.3), "the deck's north rail too");
  ok(L.inBounds(f, 4.2, 8.3, 0.3), "the middle of the stair takes a body");
  ok(!L.inBounds(f, 4.8, 7.4, 0.3) && L.inBounds(f, 3.0, 7.4, 0.3), "the hall floor beside the stair is closed near the top, where the side is a drop, and open at the foot, where it is a step");
  ok(L.inBounds(f, 5.3, 5, 0) && L.inBounds(f, 5.7, 5, 0), "a point-sized body is on the floor either side of the edge: the rule is about width");
  // what carries the floor's height
  const seats = L.seatsFor(f);
  const up = seats.filter(st => st.y > 0);
  ok(seats.length === 76, `the flagship still seats the ladder's 76 with a mezzanine (${seats.length})`);
  ok(up.length === 12 && up.every(st => near(st.y, m.y)), `twelve of them are on the deck, at its height (${up.length})`);
  ok(seats.filter(st => st.y === 0).length === 64, "and the other sixty-four are on the floor");
  ok(up.every(st => near(L.floorYAt(f, st.ax, st.az), m.y)), "every deck stool's approach is on the deck too");
  ok(f.tables.filter(t => L.floorYAt(f, t.x, t.z) > 0).length === 3, "three four-tops moved up, not four");
  const cols = L.collidersFor(f);
  const lifted = cols.filter(c => c.min.y > 0);
  ok(lifted.length === 3 && lifted.every(c => near(c.min.y, m.y) && near(c.max.y, m.y + L.COLLIDER_H)),
    `the three tables' colliders stand on the deck, COLLIDER_H tall (${lifted.length})`);
  ok(cols.filter(c => c.min.y === 0).length === cols.length - 3, "and every other collider stands on the floor");
  const pts = L.standPointsFor(f);
  ok(Object.values(pts).every(p => near(p.y, f.stations[Object.keys(pts).find(k => pts[k] === p)].y ?? L.floorYAt(f, p.x, p.z))),
    "every stand-point carries the floor under it");
  ok([0, 1, 2].every(i => L.crewHome(f, i).y === 0 && L.cookSpot(f, i).y === 0), "the crew's homes and the cook line carry theirs");
  ok(L.seatsFor(L.CORNER_TAP).every(st => st.y === 0) && L.collidersFor(L.CORNER_TAP).every(c => c.min.y === 0),
    "the Corner Tap's seats and colliders are at 0, as the fixture already says");
  // the walls and edges world.js draws
  const edges = L.mezzanineEdges(f, m);
  ok(edges.length === 2 && edges.some(e => e.side === "north" && near(e.a0, m.x0) && near(e.a1, m.x1)),
    `the deck rails its north edge end to end (${JSON.stringify(edges)})`);
  ok(edges.some(e => e.side === "west" && near(e.a0, m.z0) && near(e.a1, s.z0)), "and its west edge down to where the stair lands, and no further");
  ok(!edges.some(e => e.side === "east" || e.side === "south"), "the east and south edges are the hall's walls and get no rail");
  const deckTv = f.tvs.filter(tv => L.floorYAt(f, L.tvMount(f, tv).x, L.tvMount(f, tv).z) > 0);
  ok(deckTv.length === 2 && deckTv.every(tv => tv.y - m.y >= 1.2), `two TVs hang on the mezzanine's walls, measured from the deck (${deckTv.map(t => t.y).join(",")})`);
  ok(near(L.floorArea(f), f.room.x * f.room.z * 4), "the deck is over the hall, so the floor a patron drinks on does not double count it");
  // the sweep climbs the stair, and only the stair
  ok(L.unreachable(f).length === 0, "every deck stool's approach is reached from the door");
  const footBlocked = clone(f);
  // the crate covers the foot and the first 80 cm of the stair, because a
  // stair's side is a step near its foot -- the rule says so, and it is right
  footBlocked.fitout.push({ id: "block", kind: "crate", x: s.x0 + 0.2, z: (s.z0 + s.z1) / 2, w: 1.2, d: s.z1 - s.z0 + 0.6, h: 1, rotY: 0, pad: 0 });
  const ub = L.unreachable(footBlocked);
  ok(ub.length === 12 && ub.every(n => /^seat (6[5-9]|7[0-6]) \(table\) approach$/.test(n)),
    `a crate across the stair's foot strands the twelve deck stools and nothing else (${ub.length}: ${ub[0]})`);
  // a point-sized sweep gets no help from the level test, so only the flood's
  // own step rule keeps it off the stair's side above the crate and off the
  // deck's edge -- and it agrees
  ok(L.unreachable(footBlocked, 0).length === 12, `and a point-sized sweep, kept off the stair's side by nothing but the step rule, agrees (${L.unreachable(footBlocked, 0).length})`);
}

// --- reintroduce the bug (the two the wishlist names) ---
const tableOnStool = clone(tap);
tableOnStool.tables.push({ x: seats[0].ax, z: seats[0].az }); // a table on stool 1's approach
const b1 = L.validate(tableOnStool);
ok(b1.some(m => m.startsWith("seat 1 ")), `a table on a stool's approach fails the invariant (${b1[0] ?? "no problem reported"})`);
const doorEast = clone(tap);
doorEast.doorways[0].x0 += 1; doorEast.doorways[0].x1 += 1;
let eastDrift = 0;
g.rows.forEach((row, zi) => { const z = g.z0 + zi * g.step; if (z <= -6.0 || z >= -4.8) return;
  for (let xi = 0; xi < row.length; xi++) if ((row[xi] === "1") !== L.inBounds(doorEast, g.x0 + xi * g.step, z, g.r)) eastDrift++; });
ok(eastDrift > 0, `a doorway a metre east disagrees with the fixture's corridor (${eastDrift} samples)`);
const doorOff = clone(tap);
doorOff.doorways[0].x0 = 7.5; doorOff.doorways[0].x1 = 9.1; // past the kitchen's east wall
ok(L.validate(doorOff).some(m => m.includes("opens onto no kitchen")), "a doorway past the kitchen wall is refused");
const walled = clone(tap);
walled.doorways[0].corridor = { z0: -5.4, z1: -4.8 }; // corridor stops short of the wall
ok(L.validate(walled).some(m => m.includes("does not join")), "a corridor that stops short of the wall is refused");
const stoveOnStation = clone(tap);
stoveOnStation.fitout.find(f => f.id === "stove").z = -7.7;
ok(L.validate(stoveOnStation).some(m => m.startsWith("station stove")), "a stove over its own stand-point is refused");
// Phase 2's guards. A crate across the doorway leaves every kitchen point
// walkable — and the flood fill from the door never gets there.
for (const [id, desc] of Object.entries(L.LAYOUTS)) {
  const blocked = clone(desc);
  const dw = blocked.doorways[0];
  blocked.fitout.push({ id: "block", kind: "crate", x: (dw.x0 + dw.x1) / 2, z: -blocked.room.z, w: dw.x1 - dw.x0 + 0.6, d: 0.4, h: 0.6, rotY: 0, pad: 0.06 });
  const bb = L.validate(blocked);
  ok(!bb.some(m => m.includes("is not walkable")) && bb.some(m => m === "station stove cannot be reached from the door"),
    `${id}: a crate across the doorway strands the stove, and only the sweep sees it (${bb.length} problems)`);
}
const boxed = clone(L.FLAGSHIP);
const t0 = boxed.tables[0];
for (const [dx, dz] of [[0, -2.2], [0, 2.2], [-2.2, 0], [2.2, 0]]) boxed.fitout.push({ id: `w${dx}${dz}`, kind: "crate", x: t0.x + dx, z: t0.z + dz, w: dx ? 0.3 : 4.4, d: dx ? 4.4 : 0.3, h: 1, rotY: 0, pad: 0 });
ok(L.validate(boxed).some(m => m === "seat 13 (table) approach cannot be reached from the door"), "a table walled off on four sides has unreachable seats");
const crowded = clone(tap);
crowded.stations.tap = { x: crowded.stations.upgrades.x + 0.5, z: crowded.stations.upgrades.z };
ok(L.validate(crowded).some(m => m.startsWith("stations tap and upgrades are 0.5 m apart")), "a tap station half a metre from the upgrades ring is refused");
const tvOff = clone(tap);
tvOff.tvs[0].at = 7.5; tvOff.tvs[1].y = 3.0;
const tb = L.validate(tvOff);
ok(tb.some(m => m.includes("runs off the north wall")) && tb.some(m => m.includes("y=3 is not on the wall")), "a TV past the wall's end or above the ceiling line is refused");
const tvWall = clone(tap); tvWall.tvs[0].wall = "ceiling";
ok(L.validate(tvWall).some(m => m.includes("names no wall")), "a TV on a wall that does not exist is refused");
const pendantOut = clone(tap); pendantOut.pendants.push({ x: 0, z: 7 });
ok(L.validate(pendantOut).some(m => m.includes("pendant 5") && m.includes("outside the room")), "a pendant past the south wall is refused");
const noSpawn = clone(tap); delete noSpawn.stations.spawn;
ok(L.validate(noSpawn).some(m => m === "station spawn missing"), "a room with no spawn is refused");
const cookInStove = clone(tap); cookInStove.stations.cooks = { x: 5.5, z: -8.45 };
ok(L.validate(cookInStove).some(m => m.startsWith("cook 2 ")), "a cook line that runs into the stove is refused at the cook it hits");
// the annex checks, each broken on its own
{
  const m = L.MIDTOWN;
  const shifted = clone(m); shifted.annexes[0].x0 += 0.1; // off the hall's wall by 10 cm
  ok(L.validate(shifted).some(msg => msg.includes("shared edge is at 12.25")),
    "a back room shoved 10 cm off the hall's east wall is refused, and named");
  const gapOff = clone(m); gapOff.annexes[0].gap = { a0: 5.0, a1: 6.7 }; // past the annex's south edge
  ok(L.validate(gapOff).some(msg => msg.includes("doorway opens onto no annex")),
    "a doorway cut in the hall wall past the annex's end is refused");
  const overlap = clone(m); overlap.annexes[0].x0 = 8; overlap.annexes[0].x1 = 14;
  ok(L.validate(overlap).some(msg => msg === "annex backRoom overlaps room"),
    "a back room sitting on top of the hall is refused");
  const northAnnex = clone(m); northAnnex.annexes[0].wall = "north";
  ok(L.validate(northAnnex).some(msg => msg.includes("the hall's north wall is the kitchen's")),
    "an annex opening through the north wall is refused: that wall is the kitchen's");
  const squat = clone(m); squat.annexes[0].h = 2.4;
  ok(L.validate(squat).some(msg => msg.includes("does not clear its own doorway")),
    "a back room with a 2.4 m ceiling over a 2.2 m doorway header is refused");
  const twins = clone(m); twins.annexes.push(clone(m.annexes[0]));
  ok(L.validate(twins).some(msg => msg.includes("has no unique id")), "two annexes with one id are refused");
  const tvOverDoor = clone(m); tvOverDoor.tvs[2].at = 1.0; // the hall's east TV, over the doorway
  ok(L.validate(tvOverDoor).some(msg => msg.includes("hangs over the backRoom doorway")),
    "a TV hung over the back room's doorway is refused");
  const tvNowhere = clone(m); tvNowhere.tvs[5].area = "cellar";
  ok(L.validate(tvNowhere).some(msg => msg.includes("is no room of this one")),
    "a TV in a room the description does not have is refused");
  const tvOffAnnex = clone(m); tvOffAnnex.tvs[5].at = 18.0; // past the back room's east wall
  ok(L.validate(tvOffAnnex).some(msg => msg.includes("runs off the north wall")),
    "the back room's TV is measured against the back room's wall, not the hall's");
  const pendantOutAnnex = clone(m); pendantOutAnnex.pendants.push({ x: 18.6, z: 0 });
  ok(L.validate(pendantOutAnnex).some(msg => msg.includes("hangs outside the room")),
    "a pendant past the back room's east wall is refused");
  // and the annex is what makes its own floor walkable: drop it and every
  // point out there stops being on the floor at all
  const dropped = clone(m); dropped.annexes = [];
  const dm = L.validate(dropped).filter(msg => msg.includes("is not walkable"));
  ok(dm.length === 12, `with the annex dropped, its twelve stool approaches are off the floor (${dm.length})`);
}
// the mezzanine checks, each broken on its own
{
  const f = L.FLAGSHIP;
  const has = (d, text) => L.validate(d).some(msg => msg.includes(text));
  const noStair = clone(f); delete noStair.mezzanines[0].stair;
  const ns = L.validate(noStair);
  ok(ns.some(msg => msg === "mezzanine mezzanine has no stair") && ns.filter(msg => msg.endsWith("cannot be reached from the door")).length === 12,
    `a deck with no stair is refused by name, and its twelve stools are unreachable (${ns.length} problems)`);
  const steep = clone(f); steep.mezzanines[0].stair.x0 = 4.0; // 1.5 m of run for 1.6 m of rise
  ok(has(steep, "steeper than a body walks"), "a stair steeper than MAX_SLOPE is refused");
  const short = clone(f); short.mezzanines[0].stair.x1 = 5.3; // stops 20 cm short of the deck
  ok(has(short, "tops out at 5.3, not against the deck's edge at 5.5"), "a stair that stops short of the deck is refused, and named");
  const narrow = clone(f); narrow.mezzanines[0].stair.z0 = 8.4; // 0.6 m wide
  ok(has(narrow, "too narrow for a body"), "a stair 0.6 m wide is refused");
  const outside = clone(f); outside.mezzanines[0].x1 = 15;
  ok(has(outside, "mezzanine mezzanine runs outside the hall"), "a deck past the hall's east wall is refused");
  const flat = clone(f); flat.mezzanines[0].y = 0;
  ok(has(flat, "is a floor, not a mezzanine"), "a deck at y = 0 is refused: do not ship a flat rectangle called a mezzanine");
  const tall = clone(f); tall.mezzanines[0].y = 2.5;
  ok(has(tall, "1.3 m of headroom"), "a deck 1.3 m under the ceiling is refused");
  const onBar = clone(f); onBar.mezzanines[0].x0 = -14; onBar.mezzanines[0].z0 = -9; onBar.mezzanines[0].z1 = -5;
  ok(has(onBar, "stands on the bar"), "a deck over the bar is refused");
  const onCrate = clone(f); onCrate.fitout.push({ id: "keg", kind: "crate", x: 8, z: 6, w: 0.6, d: 0.6, h: 0.6, rotY: 0, pad: 0.06 });
  ok(has(onCrate, "stands on keg"), "a crate under the deck is refused by name");
  const onStair = clone(f); onStair.tables.push({ x: 4.2, z: 8.3 });
  ok(has(onStair, "stands on mezzanine mezzanine's stair"), "a table on the stair is refused");
  const twins = clone(f); twins.mezzanines.push(clone(f.mezzanines[0]));
  ok(has(twins, "has no unique id"), "two mezzanines with one id are refused");
  const lowTv = clone(f); lowTv.tvs[3].y = 2.5; // the deck's east TV, 90 cm over the deck
  ok(has(lowTv, "tv 3 at y=2.5 is not on the wall"), "a TV 90 cm over the deck is refused: the wall is measured from the floor under it");
  ok(!has(f, "not on the wall"), "…and at 3.1 it is on the wall");
  // the stair's sides are a drop, and the rule is what closes them
  const wide = clone(f); wide.mezzanines[0].stair.z0 = 5.0; // 4 m wide, still on the hall floor
  ok(L.validate(wide).length === 0, "a wider stair still validates (the check below is about what it changes)");
  ok(L.inBounds(wide, 4.8, 7.4, 0.3) && !L.inBounds(f, 4.8, 7.4, 0.3), "and the hall floor beside the old stair's side, closed before, is stair now");
}
const kind = clone(tap); kind.fitout[1].kind = "crate"; // the stove is a crate now
ok(L.collidersFor(kind).map(c => c.id).join(",") === "prep,bar,table1,table2,table3,table4,table5,table6,stove,crate1,crate2", "collider order follows fitout kind, not id: a stove marked crate drops behind the tables");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
