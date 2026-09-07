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
for (const id of LADDER) {
  const d = L.layoutFor(id), cols = L.collidersFor(d);
  ok(cols.length === d.fitout.length + 1 + d.tables.length, `${id}: one collider per block, the bar, and each table`);
  ok(new Set(cols.map(c => c.id)).size === cols.length, `${id}: collider ids are unique`);
  ok(d.tvs.length >= 3 && d.pendants.length >= 5, `${id}: at least three TVs and five pendants`);
}
ok(LADDER.map(id => L.layoutFor(id).tvs.length).join() === "3,4,5,7", "TVs up the ladder are 3, 4, 5, 7");
// the invariant is looking at the right things
ok(L.walkable(tap, 0, 0), "the middle of the room is walkable");
ok(!L.walkable(tap, -5, 0.9), "the centre of a table is not walkable (collider)");
ok(!L.walkable(tap, 0, -7), "the wall behind the bar is not walkable (out of bounds)");
ok(L.walkable(tap, 2.9, -5.5), "the doorway is walkable through the wall");
ok(!L.walkable(tap, 0.5, -5.5), "the wall beside the doorway is not");
ok(L.walkable(tap, 6.1, -7.7), "the stove stand-point is walkable and the stove is not");
ok(!L.walkable(tap, 6.4, -8.45), "…the stove is not");

// --- reintroduce the bug (the two the wishlist names) ---
const clone = d => JSON.parse(JSON.stringify(d));
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
const kind = clone(tap); kind.fitout[1].kind = "crate"; // the stove is a crate now
ok(L.collidersFor(kind).map(c => c.id).join(",") === "prep,bar,table1,table2,table3,table4,table5,table6,stove,crate1,crate2", "collider order follows fitout kind, not id: a stove marked crate drops behind the tables");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
