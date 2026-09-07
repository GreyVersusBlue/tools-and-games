// smoke-nav.mjs — node test/smoke-nav.mjs
//
// The nav grid, the planner, and the one question the geometry checks could
// never answer: can a body one quarter of a metre wide actually get there?
// smoke-layout.mjs floods the floor for a point-sized walker; this file
// floods it for a walker with shoulders, plans routes across it, and asserts
// that every point a patron or a server is ever sent to has one.
//
// Nothing here touches three.js or the DOM — layout.js is pure, and the
// planner lives in it for exactly this reason.

import * as L from "../js/layout.js";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = d => JSON.parse(JSON.stringify(d));
const LADDER = ["cornerTap", "fieldhouse", "midtown", "flagship"];
const R = L.WALKER_R;

// distance from (x,z) to the outside of an axis-aligned collider box; 0 inside
function boxDist(b, x, z) {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x);
  const dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return Math.hypot(dx, dz);
}
/** The tightest squeeze along a route, sampled every 5 cm. A walker of
 *  radius r is inside the furniture wherever this drops below r. `from` and
 *  `to` are segment indices: segment i runs pts[i] → pts[i+1], and the first
 *  and last are routinely skipped because a route into a table's box (a stool
 *  to sit on, a counter to stand at) ends inside inflated geometry on
 *  purpose. */
function clearance(desc, pts, from = 0, to = Infinity) {
  const cols = L.collidersFor(desc);
  let min = Infinity;
  const end = Math.min(to, pts.length - 2);
  for (let i = from; i <= end; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(d / 0.05));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      for (const c of cols) min = Math.min(min, boxDist(c, x, z));
    }
  }
  return min;
}
// a fixed stream, so a failing pair is the same pair next run
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// --- (1) the grid ---
for (const id of LADDER) {
  const desc = L.layoutFor(id), g = L.navGrid(desc);
  const open = g.open.reduce((a, b) => a + b, 0);
  ok(g.W === Math.ceil(Math.max(desc.room.x, desc.kitchen.x1) / L.GRID) - Math.floor(Math.min(-desc.room.x, desc.kitchen.x0) / L.GRID) + 1,
    `${id}: the grid spans the room and the kitchen in x`);
  ok(g.open.length === g.W * g.H, `${id}: grid is W×H cells`);
  ok(open > 0.25 * g.open.length, `${id}: a quarter of the bounding box is open floor (${open}/${g.open.length})`);
  ok(L.navGrid(desc) === g, `${id}: the grid is built once and memoised`);
  ok(L.navGrid(desc, 0) !== g, `${id}: a different walker radius is a different grid`);
}
{
  const t = L.CORNER_TAP;
  ok(L.navOpen(t, 0, 0), "the middle of the room takes a walker");
  ok(!L.navOpen(t, -5, 0.9), "the centre of a table does not");
  ok(!L.navOpen(t, -4.15, 0.9), "and neither does 14 cm off its east face, which walkable() allows");
  ok(L.walkable(t, -4.15, 0.9), "…walkable() does allow it: that gap is the whole point of the inflation");
  // the two tests do not nest: against a collider the nav grid is stricter
  // (it inflates by 0.25 and walkable() by nothing), and against a wall it is
  // looser (a patron is 0.25 m wide where the player slides at 0.3)
  ok(L.navOpen(t, -7.72, 0), "a patron fits closer to the west wall than the player slides");
  ok(!L.walkable(t, -7.72, 0), "…where the player's 0.3 m does not");
}

// --- (2) the planner ---
{
  const t = L.CORNER_TAP;
  const straight = L.pathBetween(t, { x: 0, z: 4.5 }, { x: 0, z: 2 });
  ok(straight && straight.length === 2, `a straight shot across open floor is two points (got ${straight && straight.length})`);
  ok(straight && straight[0].x === 0 && straight[0].z === 4.5 && straight[1].z === 2, "…and they are the two endpoints, unmoved");

  // the straight line from this stool's approach to that one goes through a
  // four-top: what stepToward() did every night for three rounds
  const seats = L.seatsFor(t);
  const a = { x: -6.6, z: 0.9 }, b = { x: -3.2, z: 0.9 };
  ok(clearance(t, [a, b]) < 0.01, "the straight line between these two points runs through a table");
  const round = L.pathBetween(t, a, b);
  ok(round && round.length > 2, `the planned route bends round it (${round && round.length} points)`);
  ok(round && clearance(t, round) >= R, `every metre of it is ${R} m clear of the furniture (tightest ${clearance(t, round).toFixed(3)} m)`);

  // door to every stool, and the tightest squeeze on any of them
  let worst = Infinity, worstSeat = null, missing = 0;
  for (const s of seats) {
    const p = L.pathBetween(t, t.stations.door, { x: s.ax, z: s.az });
    if (!p) { missing++; continue; }
    const c = clearance(t, p, 0, p.length - 3);   // stool 1's approach is 0.11 m off a crate: that last leg is the sit-down
    if (c < worst) { worst = c; worstSeat = s.id; }
  }
  ok(missing === 0, `every Corner Tap stool has a route from the door (${missing} do not)`);
  ok(worst >= R, `the tightest door-to-stool route clears the furniture by ${worst.toFixed(3)} m (seat ${worstSeat})`);

  // a target outside the room needs the exit's slack, and gets there
  const out = L.pathToward(t, { x: 0, z: 0 }, t.stations.doorOut, R, 2.5);
  ok(out.complete, "DOOR_OUT is reachable with the exit's slack");
  ok(out.pts.at(-1).z === t.stations.doorOut.z, "…and the route ends on DOOR_OUT itself, outside the room");
  ok(!L.pathToward(t, { x: 0, z: 0 }, t.stations.doorOut).complete, "…and is refused with a stool's slack, rather than quietly landing short");

  // a start inside a collider returns a route out
  const inside = L.pathToward(t, { x: -5, z: 0.9 }, t.stations.door);
  ok(inside.complete, "a body inside a table gets a complete route to the door");
  ok(inside.pts.length >= 3, "…which is at least a leg out of the box and a leg across the floor");
  ok(L.navOpen(t, inside.pts[1].x, inside.pts[1].z), "…and its first waypoint is floor a walker fits on");
  ok(clearance(t, inside.pts, 1) >= R, "…and nothing after that leg is inside the furniture");
}

// --- (3) every room: seats, passes, and the sweep agreeing with the planner ---
for (const id of LADDER) {
  const desc = L.layoutFor(id);
  ok(L.navProblems(desc).length === 0, `${id}: ${L.navProblems(desc).join("; ") || "every walked-to point has a route from the door"}`);
  ok(L.validate(desc).length === 0, `${id}: still validates with the nav check folded in`);
  const seats = L.seatsFor(desc);
  const reach = L.reachableSeats(desc);
  ok(reach.length === seats.length && reach.every(Boolean), `${id}: all ${seats.length} stools are offered`);
  for (const k of ["passFood", "passDrink"]) {
    let miss = 0;
    for (const s of seats) if (!L.pathBetween(desc, desc.stations[k], { x: s.ax, z: s.az })) miss++;
    ok(miss === 0, `${id}: a server at ${k} has a route to every stool (${miss} do not)`);
  }
  // the two answers have to agree: a seat reachableSeats() offers is a seat
  // pathBetween() can plan, or freeSeat() hands out a stool nobody can reach
  let disagree = 0;
  for (const [i, s] of seats.entries()) {
    if (reach[i] !== !!L.pathBetween(desc, desc.stations.door, { x: s.ax, z: s.az })) disagree++;
  }
  ok(disagree === 0, `${id}: the flood and the planner agree on every stool (${disagree} differ)`);
}

// --- (4) two hundred random pairs per room all terminate ---
for (const id of LADDER) {
  const desc = L.layoutFor(id), g = L.navGrid(desc);
  const rand = rng(0x5eed + id.length);
  const X = Math.max(desc.room.x, desc.kitchen.x1), Z0 = desc.kitchen.z0, Z1 = desc.room.z;
  let planned = 0, complete = 0, bad = 0, tight = Infinity;
  for (let n = 0; n < 200; n++) {
    const from = { x: -X + rand() * 2 * X, z: Z0 + rand() * (Z1 - Z0) };
    const to = { x: -X + rand() * 2 * X, z: Z0 + rand() * (Z1 - Z0) };
    const res = L.pathToward(desc, from, to);
    planned++;
    if (!res.pts.length || res.pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) { bad++; continue; }
    if (res.pts[0].x !== from.x || res.pts[0].z !== from.z) { bad++; continue; }
    if (res.complete) {
      complete++;
      if (res.pts.at(-1).x !== to.x || res.pts.at(-1).z !== to.z) bad++;
      // both ends may be inside inflated geometry; the middle never is
      if (res.pts.length > 3) tight = Math.min(tight, clearance(desc, res.pts, 1, res.pts.length - 3));
    }
  }
  ok(planned === 200 && bad === 0, `${id}: 200 random pairs all return a finite route from the point asked for (${bad} did not)`);
  ok(complete >= 150, `${id}: most of them reach the point asked for (${complete}/200 complete)`);
  ok(tight >= R, `${id}: no middle leg of any of them is inside the furniture (tightest ${tight.toFixed(3)} m)`);
}

// --- (5) a failed path is a real answer ---
{
  // wall a flagship four-top in on all four sides: its seats stop being offered
  const boxed = clone(L.FLAGSHIP);
  const t0 = boxed.tables[0];
  for (const [dx, dz] of [[0, -2.2], [0, 2.2], [-2.2, 0], [2.2, 0]]) {
    boxed.fitout.push({ id: `w${dx}${dz}`, kind: "crate", x: t0.x + dx, z: t0.z + dz, w: dx ? 0.3 : 4.4, d: dx ? 4.4 : 0.3, h: 1, rotY: 0, pad: 0 });
  }
  const reach = L.reachableSeats(boxed);
  const seats = L.seatsFor(boxed);
  // the flagship's twelve bar stools come first, so the boxed four-top is 13-16
  ok([13, 14, 15, 16].every(id => reach[id - 1] === false), "a walled-off four-top takes all four of its stools out of the offer");
  ok(reach.filter(Boolean).length >= seats.length - 8, `…and the rest of the room still is offered (${reach.filter(Boolean).length}/${seats.length})`);
  const walledIn = 12;
  ok(L.pathBetween(boxed, boxed.stations.door, { x: seats[walledIn].ax, z: seats[walledIn].az }) === null,
    "…and pathBetween() says null for one of them rather than a route into the wall");
  const partial = L.pathToward(boxed, boxed.stations.door, { x: seats[walledIn].ax, z: seats[walledIn].az });
  ok(!partial.complete && partial.pts.length >= 2, "…while pathToward() still hands back a route to the nearest floor it can reach");
  ok(clearance(boxed, partial.pts, 1) >= R, "…and that route is not itself inside the furniture");

  // a gap a point walks through and a body does not: a crate across all but
  // 20 cm of the corridor. This is the case Phase 2's sweep cannot see, and
  // the reason the nav grid is a second grid rather than the same one.
  const pinched = clone(L.CORNER_TAP);
  pinched.fitout.push({ id: "pinch", kind: "crate", x: 2.65, z: -5.5, w: 1.1, d: 0.4, h: 0.6, rotY: 0, pad: 0 });
  ok(!L.unreachable(pinched).length, "a 20 cm slot in the corridor is a corridor, as far as the point-sized sweep is concerned");
  const bad = L.navProblems(pinched);
  ok(bad.length === 3 && bad.every(m => /^cook \d has no route from the door$/.test(m)),
    `…and a kitchen nobody cooks in, as far as a 0.25 m body is (${bad.join("; ") || "nothing reported"})`);
  ok(L.validate(pinched).some(m => m === "cook 1 has no route from the door"), "…and validate() carries it");
}

// --- (6) reintroduce the bug (#34) ---
{
  const t = L.CORNER_TAP;
  const a = { x: -6.6, z: 0.9 }, b = { x: -3.2, z: 0.9 };
  // (a) the collider inflation, deleted
  const naive = L.pathBetween(t, a, b, 0);
  const c = clearance(t, naive);
  ok(c < 0.2, `with the inflation deleted the route shaves the table by ${c.toFixed(3)} m — inside a 0.2 m body`);
  ok(clearance(t, L.pathBetween(t, a, b)) > c, "…and the inflated grid's route for the same pair is wider");

  // (b) the doorway, blocked
  const blocked = clone(t);
  const dw = blocked.doorways[0];
  blocked.fitout.push({ id: "block", kind: "crate", x: (dw.x0 + dw.x1) / 2, z: -blocked.room.z, w: dw.x1 - dw.x0 + 0.6, d: 0.4, h: 0.6, rotY: 0, pad: 0.06 });
  ok(L.pathBetween(blocked, blocked.stations.door, blocked.stations.passFood) !== null, "a crate across the doorway leaves the room's own pass reachable");
  ok(L.pathBetween(blocked, blocked.stations.door, L.cookSpot(blocked, 0)) === null, "…and no route at all to the cook line behind it");
  const nb = L.navProblems(blocked);
  ok(nb.length === 3 && nb.every(m => /^cook \d has no route from the door$/.test(m)),
    `…and navProblems() names the three cooks and nothing else (${nb.length}: ${nb.join("; ")})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
