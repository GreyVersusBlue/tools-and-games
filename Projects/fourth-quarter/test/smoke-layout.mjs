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
ok(Object.keys(L.LAYOUTS).length === 4, "one description per venue tier");
for (const id of ["cornerTap", "fieldhouse", "midtown", "flagship"]) ok(L.layoutFor(id), `layoutFor(${id})`);
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

// --- (2) the walkability invariant, for every description in the table ---
for (const [id, desc] of Object.entries(L.LAYOUTS)) {
  const bad = L.validate(desc);
  ok(bad.length === 0, `${id} validates: ${bad.join("; ")}`);
}
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
