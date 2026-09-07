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
/** The biggest rise in the floor over any 5 cm of a route. 0 on a flat
 *  floor, 3 cm on the stair, a kerb's worth stepping onto the stair's low
 *  side, and the deck's whole 1.6 m on a route that walks off its edge. */
function biggestStep(desc, pts) {
  let worst = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < 1e-9) continue;
    const n = Math.max(1, Math.ceil(d / 0.05));
    let py = L.floorYAt(desc, a.x, a.z);
    for (let k = 1; k <= n; k++) {
      const t = k / n, y = L.floorYAt(desc, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      worst = Math.max(worst, Math.abs(y - py));
      py = y;
    }
  }
  return worst;
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
  const fb = L.floorBounds(desc);
  ok(g.W === Math.ceil(fb.x1 / L.GRID) - Math.floor(fb.x0 / L.GRID) + 1,
    `${id}: the grid spans every floor rectangle in x`);
  ok(g.H === Math.ceil(fb.z1 / L.GRID) - Math.floor(fb.z0 / L.GRID) + 1,
    `${id}: and every one of them in z`);
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
  const fb = L.floorBounds(desc);
  let planned = 0, complete = 0, bad = 0, tight = Infinity, steepest = 0;
  for (let n = 0; n < 200; n++) {
    const from = { x: fb.x0 + rand() * (fb.x1 - fb.x0), z: fb.z0 + rand() * (fb.z1 - fb.z0) };
    const to = { x: fb.x0 + rand() * (fb.x1 - fb.x0), z: fb.z0 + rand() * (fb.z1 - fb.z0) };
    const res = L.pathToward(desc, from, to);
    planned++;
    if (!res.pts.length || res.pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) { bad++; continue; }
    if (res.pts[0].x !== from.x || res.pts[0].z !== from.z) { bad++; continue; }
    if (res.complete) {
      complete++;
      if (res.pts.at(-1).x !== to.x || res.pts.at(-1).z !== to.z) bad++;
      // both ends may be inside inflated geometry; the middle never is
      if (res.pts.length > 3) tight = Math.min(tight, clearance(desc, res.pts, 1, res.pts.length - 3));
      // and no 5 cm of any of them rises more than a body steps: a route
      // that walks off the flagship's deck would show here as a 1.6 m rise
      steepest = Math.max(steepest, biggestStep(desc, res.pts));
    }
  }
  ok(planned === 200 && bad === 0, `${id}: 200 random pairs all return a finite route from the point asked for (${bad} did not)`);
  ok(complete >= 150, `${id}: most of them reach the point asked for (${complete}/200 complete)`);
  ok(tight >= R, `${id}: no middle leg of any of them is inside the furniture (tightest ${tight.toFixed(3)} m)`);
  ok(steepest <= L.STEP_H + 1e-6, `${id}: no 5 cm of any of them rises more than a ${L.STEP_H} m step (biggest ${steepest.toFixed(3)})`);
}

// --- (5) the back room, on the far side of a doorway ---
// Everything above this was one open rectangle plus a kitchen nobody drinks
// in. Midtown's back room is the first place a patron is sent that has a wall
// between it and the door, which is the thing Phase 3's planner was built for
// and the reason this room waited for it.
{
  const m = L.MIDTOWN, a = m.annexes[0];
  const seats = L.seatsFor(m);
  const back = seats.filter(s => s.ax > a.x0);
  ok(back.length === 12, `twelve stools sit behind the back room's doorway (${back.length})`);
  const reach = L.reachableSeats(m);
  ok(back.every(s => reach[s.id - 1]), "every one of them is offered");
  let worst = Infinity, worstSeat = null, missing = 0, throughDoor = 0;
  for (const s of back) {
    const p = L.pathBetween(m, m.stations.door, { x: s.ax, z: s.az });
    if (!p) { missing++; continue; }
    const c = clearance(m, p, 0, p.length - 3);
    if (c < worst) { worst = c; worstSeat = s.id; }
    // wherever the route first crosses the hall's east wall line, it is inside
    // the gap -- if it were not, the planner would be routing through masonry
    let crossed = false;
    for (let i = 0; i < p.length - 1 && !crossed; i++) {
      const A = p[i], B = p[i + 1];
      if ((A.x - m.room.x) * (B.x - m.room.x) > 0) continue;
      const z = A.z + (B.z - A.z) * ((m.room.x - A.x) / (B.x - A.x));
      if (z > a.gap.a0 && z < a.gap.a1) throughDoor++;
      crossed = true;
    }
  }
  ok(missing === 0, `every back-room stool has a route from the door (${missing} do not)`);
  ok(throughDoor === back.length, `and every one of those routes crosses the hall's east wall inside the doorway (${throughDoor}/${back.length})`);
  ok(worst >= R, `the tightest of them clears the furniture by ${worst.toFixed(3)} m (seat ${worstSeat})`);
  // a server carries from the pass, the length of the hall and through the gap
  for (const k of ["passFood", "passDrink"]) {
    let miss = 0;
    for (const s of back) if (!L.pathBetween(m, m.stations[k], { x: s.ax, z: s.az })) miss++;
    ok(miss === 0, `a server at ${k} has a route to every back-room stool (${miss} do not)`);
  }
  // and a crate in the gap takes the whole room out of the offer, while the
  // hall keeps every one of its own stools
  const blocked = clone(m);
  blocked.fitout.push({ id: "block", kind: "crate", x: a.x0, z: (a.gap.a0 + a.gap.a1) / 2,
    w: 0.6, d: a.gap.a1 - a.gap.a0 + 0.6, h: 1, rotY: 0, pad: 0 });
  const br = L.reachableSeats(blocked);
  ok(back.every(s => br[s.id - 1] === false), "a crate in the doorway takes all twelve out of the offer");
  ok(br.filter(Boolean).length === seats.length - 12, `…and leaves the hall's forty-six (${br.filter(Boolean).length})`);
  const nb = L.navProblems(blocked);
  ok(nb.length === 12 && nb.every(msg => /^seat \d+ \(table\) approach has no route from the door$/.test(msg)),
    `…and navProblems() names those twelve stools and nothing else (${nb.length}: ${nb.slice(0, 2).join("; ")})`);
}

// --- (5b) the mezzanine, up a stair ---
// The back room is behind a wall; the flagship's deck is 1.6 m up. Every cell
// carries the floor under it now, and a neighbour more than a stride's rise
// away is not a neighbour, so a body walks up the stair and not off the
// edge -- and the string-pull cannot shortcut across it either.
{
  const f = L.FLAGSHIP, m = f.mezzanines[0], s = m.stair;
  const g = L.navGrid(f);
  const onDeck = i => { const p = L.cellPoint(g, i); return p.x >= m.x0 && p.x <= m.x1 && p.z >= m.z0 && p.z <= m.z1; };
  const onStair = p => p.x >= s.x0 && p.x < s.x1 && p.z >= s.z0 && p.z <= s.z1;
  const deckCells = [...g.open].map((o, i) => o && onDeck(i) ? i : -1).filter(i => i >= 0);
  const stairCells = [...g.open].map((o, i) => o && onStair(L.cellPoint(g, i)) ? i : -1).filter(i => i >= 0);
  ok(g.y.length === g.open.length && deckCells.length > 300 && deckCells.every(i => Math.abs(g.y[i] - m.y) < 1e-6),
    `every open cell on the deck carries the deck's height (${deckCells.length} cells)`);
  ok(stairCells.length >= 20 && stairCells.every(i => g.y[i] > 0 && g.y[i] < m.y),
    `and every open cell on the stair is somewhere between (${stairCells.length} cells)`);
  ok([...g.open].every((o, i) => !o || onDeck(i) || onStair(L.cellPoint(g, i)) || g.y[i] === 0), "and every other open cell is at 0");
  // the deck's edge is not a neighbour
  const seats = L.seatsFor(f);
  const up = seats.filter(st => st.y > 0);
  ok(up.length === 12, `twelve stools are on the deck (${up.length})`);
  const reach = L.reachableSeats(f);
  ok(up.every(st => reach[st.id - 1]), "every one of them is offered");
  let missing = 0, viaStair = 0, steepest = 0, worst = Infinity, worstSeat = null, endsUp = 0;
  for (const st of up) {
    const p = L.pathBetween(f, f.stations.door, { x: st.ax, z: st.az });
    if (!p) { missing++; continue; }
    // somewhere along it the route is on the stair, 5 cm at a time
    let stair = false;
    for (let i = 0; i < p.length - 1 && !stair; i++) {
      const a = p[i], b = p[i + 1], d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.05));
      for (let k = 0; k <= n && !stair; k++) if (onStair({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n })) stair = true;
    }
    if (stair) viaStair++;
    steepest = Math.max(steepest, biggestStep(f, p));
    if (Math.abs(L.floorYAt(f, p.at(-1).x, p.at(-1).z) - m.y) < 1e-6) endsUp++;
    const c = clearance(f, p, 0, p.length - 3);
    if (c < worst) { worst = c; worstSeat = st.id; }
  }
  ok(missing === 0, `every deck stool has a route from the door (${missing} do not)`);
  ok(viaStair === up.length, `and every one of those routes climbs the stair (${viaStair}/${up.length})`);
  ok(steepest <= L.STEP_H + 1e-6, `and no 5 cm of any of them rises more than a step (biggest ${steepest.toFixed(3)} m)`);
  ok(endsUp === up.length, "and every one of them ends on the deck");
  ok(worst >= R, `the tightest of them clears the furniture by ${worst.toFixed(3)} m (seat ${worstSeat})`);
  for (const k of ["passFood", "passDrink"]) {
    let miss = 0;
    for (const st of up) if (!L.pathBetween(f, f.stations[k], { x: st.ax, z: st.az })) miss++;
    ok(miss === 0, `a server at ${k} has a route up to every deck stool (${miss} do not)`);
  }
  // a hall-floor point under the north rail and a deck point 1.8 m south of
  // it: 3.3 m apart in a straight line, and the route is nothing like it
  const around = L.pathBetween(f, { x: 9, z: 1.5 }, { x: 9, z: 4.8 });
  const len = pts => pts.reduce((n, p, i) => i ? n + Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0, 0);
  ok(around && len(around) > 12, `from under the rail to over it is a walk round to the stair (${around && len(around).toFixed(1)} m for 3.3 m as the crow flies)`);
  // for a point-sized body, which the level test does nothing for, so it is
  // clearLine's own rule refusing this and not the cells near the rail
  ok(!L.clearLine(f, { x: 2.5, z: 8.3 }, { x: 6.5, z: 5 }, 0), "the string-pull refuses the straight line from the stair's foot across the deck's edge, on its own rule");
  ok(L.clearLine(f, { x: 2.5, z: 8.3 }, { x: 6.0, z: 8.3 }, 0), "and allows the one straight up the stair");
  // a target on the hall floor 10 cm from the panelling snaps to the hall
  // floor, not to the deck cell 35 cm away on the other side of it
  const toPanel = L.pathToward(f, f.stations.door, { x: 5.4, z: 5.0 });
  ok(toPanel.complete && toPanel.pts.every(p => L.floorYAt(f, p.x, p.z) === 0),
    `a target against the panelling is reached along the floor, never via the deck (${toPanel.pts.length} points)`);
  const fromPanel = L.pathToward(f, { x: 5.4, z: 5.0 }, f.stations.door);
  ok(fromPanel.complete && fromPanel.pts.every(p => L.floorYAt(f, p.x, p.z) === 0), "…and so is the way back");
  // a point-sized walker gets no help from the level test (levelOpen is
  // r-wide), so for it the grid's own neighbour rule is the only thing
  // between the deck and the floor: the route from the deck to the door still
  // climbs down the stair rather than stepping off the edge
  const g0 = L.navGrid(f, 0);
  const off = L.pathBetween(f, { x: 9, z: 4.8 }, { x: 9, z: 1.5 }, 0);
  ok(g0 !== g && off && len(off) > 12 && biggestStep(f, off) <= L.STEP_H + 1e-6,
    `a point-sized walker leaves the deck by the stair too (${off && len(off).toFixed(1)} m, biggest step ${off && biggestStep(f, off).toFixed(3)})`);
  // a crate across the stair's foot takes the deck out of the offer
  const blocked = clone(f);
  blocked.fitout.push({ id: "block", kind: "crate", x: s.x0 + 0.2, z: (s.z0 + s.z1) / 2, w: 1.2, d: s.z1 - s.z0 + 0.6, h: 1, rotY: 0, pad: 0 });
  const br = L.reachableSeats(blocked);
  ok(up.every(st => br[st.id - 1] === false), "a crate across the stair's foot takes all twelve out of the offer");
  ok(br.filter(Boolean).length === seats.length - 12, `…and leaves the floor's sixty-four (${br.filter(Boolean).length})`);
  const nb = L.navProblems(blocked);
  ok(nb.length === 12 && nb.every(msg => /^seat \d+ \(table\) approach has no route from the door$/.test(msg)),
    `…and navProblems() names those twelve stools and nothing else (${nb.length}: ${nb.slice(0, 2).join("; ")})`);
  // a walker on the deck with the stair gone still gets a route: to the
  // nearest deck cell to the door, and not one step further down
  const noStair = clone(f); delete noStair.mezzanines[0].stair;
  const stranded = L.pathToward(noStair, { x: 9, z: 5 }, noStair.stations.door);
  ok(!stranded.complete && stranded.pts.every(p => Math.abs(L.floorYAt(noStair, p.x, p.z) - m.y) < 1e-6),
    `with the stair gone a body on the deck is told so, and its partial route never leaves the deck (${stranded.pts.length} points)`);
}

// --- (6) a failed path is a real answer ---
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

// --- (7) reintroduce the bug (#34) ---
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
