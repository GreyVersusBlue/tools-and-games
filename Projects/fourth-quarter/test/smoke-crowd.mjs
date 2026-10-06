// smoke-crowd.mjs — node test/smoke-crowd.mjs
//
// Two bodies never saw each other: Route plans against the furniture and
// nothing else. walk.js's separate() is the rule that changed that (#900), and
// its stride is what stopped a body's y jumping a kerb in one frame (#901).
// This file runs both in Node, on the real rooms, with the real Route.
//
// The pair scenes first, one rule each, then every room on the ladder under a
// crowd, with the rule off and on. "Off" is the control and it is asserted
// too: a floor where nobody overlaps without the rule would pass everything
// below while proving nothing.

import * as L from "../js/layout.js";
import { Route, separate, settleY, BODY_R, STALL_T, GHOST_T, FOOT_RATE } from "../js/walk.js";
import { runFloor, DT } from "./crowd-floor.mjs";

let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error("FAIL:", name)); };
const clone = d => JSON.parse(JSON.stringify(d));
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const TOUCHING = 2 * BODY_R - 0.02;   // 2 cm of give: one frame's stride at a walk
const BRIEF = 1.0;                    // seconds two bodies may stay inside each other

// ------------------------------------------------------------ the pair scenes
const TAP = L.LAYOUTS.cornerTap;
const LANE_Z = 4.4, A = { x: 0.5, z: LANE_Z }, B = { x: 6.5, z: LANE_Z };
ok(L.clearLine(TAP, A, B, 0.5), "the Corner Tap has a lane 6 m long and a metre wide to stage these in");

function walker(desc, from, to, speed = 1.55, more = {}) {
  return { pos: { x: from.x, y: L.floorYAt(desc, from.x, from.z), z: from.z }, to, speed, walking: true, done: null,
           route: new Route(() => desc), ghosted: false, path: [], ...more };
}
const stander = (x, z, more = {}) => ({ pos: { x, y: 0, z }, walking: false, ...more });

/** Step every walker, then separate. Returns the closest any two solid bodies
 *  came and the longest they stayed inside each other. */
function play(desc, bodies, seconds, { avoid = true, arrive = 0.12 } = {}) {
  let minD = Infinity, run = 0, worstRun = 0, t = 0;
  for (let f = 0; f < Math.round(seconds / DT); f++, t += DT) {
    for (const b of bodies) {
      if (!b.walking || !b.to || (b.start ?? 0) > t) continue;
      b.route.aim(b.pos, b.to);
      if (b.route.step(b.pos, b.speed * DT, arrive)) { b.walking = false; b.done = t; }
    }
    const here = bodies.filter(b => (b.start ?? 0) <= t);
    if (avoid) separate(desc, here, DT);
    let touching = false;
    for (let i = 0; i < here.length; i++) {
      const a = here[i];
      if (a.crowd && a.crowd.ghost > 0) a.ghosted = true;
      if (a.path) a.path.push({ x: a.pos.x, z: a.pos.z });
      for (let j = i + 1; j < here.length; j++) {
        const b = here[j];
        if (!a.walking && !b.walking) continue;
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        minD = Math.min(minD, d);
        if (d < TOUCHING) touching = true;
      }
    }
    run = touching ? run + DT : 0;
    worstRun = Math.max(worstRun, run);
  }
  return { minD, worstRun };
}
const solo = (desc, from, to, speed) => { const w = walker(desc, from, to, speed); play(desc, [w], 30); return w.done; };
const zSpan = w => [Math.min(...w.path.map(p => p.z)), Math.max(...w.path.map(p => p.z))];

// head-on down one lane: the control walks through, the rule goes round
{
  const off = play(TAP, [walker(TAP, A, B), walker(TAP, B, A)], 8, { avoid: false });
  ok(off.minD < 0.05, `with the rule off, two walkers head-on pass through each other (closest ${off.minD.toFixed(3)} m)`);
  const a = walker(TAP, A, B), b = walker(TAP, B, A);
  const on = play(TAP, [a, b], 8);
  const t = solo(TAP, A, B);
  ok(on.minD >= TOUCHING, `with it on they never come closer than their radii (closest ${on.minD.toFixed(3)} m)`);
  ok(a.done !== null && b.done !== null && a.done <= t + 0.05 && b.done <= t + 0.6, `and both arrive (${a.done?.toFixed(2)} s and ${b.done?.toFixed(2)} s against ${t.toFixed(2)} s alone)`);
  const [az0, az1] = zSpan(a), [bz0, bz1] = zSpan(b);
  ok(az1 - az0 < 1e-9, "the earlier one in the list has the right of way and keeps its line");
  ok(bz0 < LANE_Z - 0.2 && bz1 < LANE_Z + 1e-9, `the later one gives way to its own right (z ${bz0.toFixed(2)} to ${bz1.toFixed(2)} on a lane at ${LANE_Z})`);
  ok(!a.ghosted && !b.ghosted, "nobody had to walk through anybody");
}

// a standing body in the lane is walked round and not moved; so is the boss,
// whose `pos` is the camera's and must come back untouched
for (const [name, more] of [["a standing body", {}], ["the boss, walking or not", { fixed: true, walking: true, route: null }]]) {
  const post = stander(3.5, LANE_Z, more);
  post.pos.y = 1.62;
  const w = walker(TAP, A, B);
  // the walker first: later in the list is who gives way, so a boss that was
  // not `fixed` would be the one moved
  const r = play(TAP, [w, post], 8);
  ok(post.pos.x === 3.5 && post.pos.z === LANE_Z && post.pos.y === 1.62, `${name} in the lane is not moved, and its y is not written`);
  ok(r.minD >= TOUCHING && w.done !== null && !w.ghosted, `the walker goes round ${name} (closest ${r.minD.toFixed(3)} m, there in ${w.done?.toFixed(2)} s)`);
}

// a queue: the slow one in front is not shoved along by the fast one behind
{
  const from = { x: 1.5, z: LANE_Z }, mid = { x: 5.5, z: LANE_Z };
  const alone = solo(TAP, from, mid, 0.8);
  const lead = walker(TAP, from, mid, 0.8), tail = walker(TAP, A, B, 2.0);
  const r = play(TAP, [tail, lead], 12);
  const [z0, z1] = zSpan(lead);
  // not "exactly on its line": as the fast one cuts back in ahead of it the
  // slow one is, for a few frames, the one walking into somebody, and gives
  // way by under a centimetre. What it must not be is carried forward.
  ok(lead.done >= alone && lead.done <= alone + 0.1 && z1 - z0 < 0.05, `a slow walker with a fast one behind is not shoved along: it arrives when it would alone (${lead.done?.toFixed(3)} s against ${alone.toFixed(3)}), ${((z1 - z0) * 1000).toFixed(1)} mm off its line at most`);
  ok(r.minD >= TOUCHING && tail.done !== null && !tail.ghosted, `and the fast one gets past it, without walking through (closest ${r.minD.toFixed(3)} m, there in ${tail.done?.toFixed(2)} s)`);
}

// an errand: the goal is beside a seated guest, nearer than two radii
{
  const guest = stander(3.5, LANE_Z + 0.3);
  const goal = { x: 3.5, z: LANE_Z };
  const w = walker(TAP, A, goal);
  play(TAP, [guest, w], 6);
  ok(w.done !== null && Math.abs(w.done - solo(TAP, A, goal)) < 1e-9 && !w.ghosted, "a walker whose errand is beside a seated guest arrives as if the guest were not there");
}

// a gap one body wide: nobody can go round, so the later one is walked back
// out of it, and both still get through
{
  const d = clone(TAP);
  d.fitout.push({ id: "gapN", kind: "crate", x: 3.5, z: 3.55, w: 0.7, d: 0.7, h: 0.6, rotY: 0, pad: 0 },
                { id: "gapS", kind: "crate", x: 3.5, z: 5.2,  w: 0.7, d: 0.6, h: 0.6, rotY: 0, pad: 0 });
  let open = 0;
  for (let z = 3.9; z <= 4.9; z += 0.01) if (L.navOpen(d, 3.5, z)) open++;
  ok(open > 20 && open * 0.01 < 2 * BODY_R + 0.2, `the staged gap is open and too narrow for two (${(open * 0.01).toFixed(2)} m of floor for a body ${2 * BODY_R} m wide)`);
  const a = walker(d, A, B), b = walker(d, B, A);
  const r = play(d, [a, b], 14);
  ok(a.done !== null && b.done !== null, `two walkers head-on through it both arrive (${a.done?.toFixed(2)} s, ${b.done?.toFixed(2)} s)`);
  ok(r.worstRun <= BRIEF, `and are inside each other for no longer than ${BRIEF} s (${r.worstRun.toFixed(2)} s)`);
  // a stream each way, so the gap has a queue on both sides of it
  const crowd = [];
  for (let i = 0; i < 4; i++) crowd.push(walker(d, A, B, 1.55, { start: i * 0.7 }), walker(d, B, A, 1.55, { start: i * 0.7 }));
  const rs = play(d, crowd, 40);
  ok(crowd.every(w => w.done !== null), `four each way through the same gap all arrive (last at ${Math.max(...crowd.map(w => w.done ?? Infinity)).toFixed(1)} s)`);
  ok(rs.worstRun <= BRIEF, `with no contact longer than ${BRIEF} s (${rs.worstRun.toFixed(2)} s)`);
}

// Midtown's back-room doorway, the one door on the ladder guests walk through
{
  const d = L.LAYOUTS.midtown, W = { x: 10, z: 1.05 }, E = { x: 13.2, z: 1.05 };
  ok(L.pathBetween(d, W, E) !== null, "Midtown's doorway joins the hall to the back room");
  const crowd = [];
  for (let i = 0; i < 4; i++) crowd.push(walker(d, W, E, 1.55, { start: i * 0.7 }), walker(d, E, W, 1.55, { start: i * 0.7 }));
  const r = play(d, crowd, 20);
  ok(crowd.every(w => w.done !== null && w.done < 8), `four each way through Midtown's doorway are all through in 8 s (last at ${Math.max(...crowd.map(w => w.done ?? Infinity)).toFixed(1)} s)`);
  ok(r.worstRun <= BRIEF && crowd.every(w => !w.ghosted), `nobody walked through anybody to do it (longest contact ${r.worstRun.toFixed(2)} s)`);
}

// the last resort: a goal ringed by standing bodies cannot be walked round
{
  const goal = { x: 3.5, z: LANE_Z };
  const ring = [];
  for (let i = 0; i < 12; i++) ring.push(stander(goal.x + 0.7 * Math.cos(i * Math.PI / 6), goal.z + 0.7 * Math.sin(i * Math.PI / 6)));
  const w = walker(TAP, A, goal);
  play(TAP, [...ring, w], 12);
  ok(w.ghosted && w.done !== null && w.done < solo(TAP, A, goal) + 3 * STALL_T + GHOST_T,
    `a walker ringed off from its goal stalls, then walks through and arrives (${w.done?.toFixed(2)} s) rather than standing there`);
  ok(ring.every((b, i) => b.pos.x === goal.x + 0.7 * Math.cos(i * Math.PI / 6)), "and the ring is where it was");
}

// nothing touching, nothing moved
{
  const bodies = [walker(TAP, A, B), walker(TAP, B, A), stander(3.5, LANE_Z)];
  const before = JSON.stringify(bodies.map(b => b.pos));
  ok(separate(TAP, bodies, DT) === 0 && JSON.stringify(bodies.map(b => b.pos)) === before, "separate() on bodies that are apart touches nothing and reports nothing");
}

// ---------------------------------------------------------------- the kerb
// The flagship's stair is a ramp; its north side near the foot is a kerb the
// planner lets a body step over. Straight across it, one stride at a time.
{
  const d = L.LAYOUTS.flagship, s = d.mezzanines[0].stair;
  const x = s.x0 + 0.24, from = { x, z: s.z0 - 0.5 }, to = { x, z: s.z0 + 0.5 };
  const kerb = L.floorYAt(d, x, s.z0 + 0.001);
  ok(kerb > 0.1 && kerb <= L.STEP_H && L.clearLine(d, from, to), `the stair's side ${(x - s.x0).toFixed(2)} m up from its foot is a ${kerb.toFixed(3)} m kerb a body may step over`);
  ok(FOOT_RATE > L.MAX_SLOPE, "feet follow the floor faster than the steepest floor rises, so nobody sinks into the stair");
  for (const [name, a, b] of [["up", from, to], ["down", to, from]]) {
    const w = walker(d, a, b, 2.0);
    let worst = 0, worstFloor = 0, lag = 0, py = w.pos.y, pf = w.pos.y;
    for (let f = 0; f < 200 && w.walking; f++) {
      const px = w.pos.x, pz = w.pos.z;
      w.route.aim(w.pos, b);
      if (w.route.step(w.pos, w.speed * DT)) w.walking = false;
      const run = Math.hypot(w.pos.x - px, w.pos.z - pz), fy = L.floorYAt(d, w.pos.x, w.pos.z);
      if (w.walking) worst = Math.max(worst, Math.abs(w.pos.y - py) / run);
      worstFloor = Math.max(worstFloor, Math.abs(fy - pf));
      lag = Math.max(lag, Math.abs(w.pos.y - fy));
      py = w.pos.y; pf = fy;
    }
    ok(worstFloor > 0.1, `stepping ${name} it, the floor under the body changes ${worstFloor.toFixed(3)} m in one stride`);
    ok(worst <= FOOT_RATE + 1e-9, `and the body does not: its steepest stride is ${worst.toFixed(2)} m per metre against a limit of ${FOOT_RATE}`);
    ok(lag <= L.STEP_H && !w.walking && w.pos.y === L.floorYAt(d, w.pos.x, w.pos.z), `never more than a riser off the floor (${lag.toFixed(3)} m), and standing on it at the end`);
  }
  // stopping two strides past the kerb: arriving is standing on the floor
  {
    const w = walker(d, from, { x, z: s.z0 + 0.04 }, 2.0);
    let lagged = 0;
    for (let f = 0; f < 200 && w.walking; f++) {
      w.route.aim(w.pos, w.to);
      lagged = Math.max(lagged, Math.abs(w.pos.y - L.floorYAt(d, w.pos.x, w.pos.z)));
      if (w.route.step(w.pos, w.speed * DT, 0.01)) w.walking = false;
    }
    ok(lagged > 0.05 && !w.walking && w.pos.y === L.floorYAt(d, w.pos.x, w.pos.z), `a body that stops just past the kerb, ${lagged.toFixed(3)} m short of it a stride before, is on the floor when it stops`);
  }
  // the deck's edge: two bodies all but on one point beside it, and the shove
  // that would clear them lands on open deck 1.6 m up. A shove is not a climb.
  {
    const edge = d.mezzanines[0].x0, z = 5, x0 = edge - 0.3;
    const a = stander(x0, z), b = walker(d, { x: x0 + 0.0035, z: z + 0.0035 }, { x: x0, z: z - 3 });
    b.route.aim(b.pos, b.to);
    ok(L.navOpen(d, x0, z) && L.navOpen(d, x0 + 0.56, z) && L.floorYAt(d, x0 + 0.56, z) === d.mezzanines[0].y, "there is open floor under the deck's edge and open deck 0.56 m from it");
    ok(separate(d, [a, b], DT) === 1 && b.pos.x < edge && b.pos.y === 0, `a body shoved toward the deck stays on the floor it was on (x ${b.pos.x.toFixed(3)}, y ${b.pos.y})`);
  }
  const p = { x: 0, y: 0.5, z: 0 };
  settleY(TAP, p, 0.1);
  ok(Math.abs(p.y - (0.5 - FOOT_RATE * 0.1)) < 1e-12, "settleY() moves a body toward the floor by what its stride earns and no more");
  settleY(TAP, p, 10);
  ok(p.y === 0, "and lands it exactly on the floor once the stride covers what is left");
}

// ------------------------------------------------------------- the busy floor
const SECONDS = 120;
let costWorst = 0;
for (const id of ["cornerTap", "fieldhouse", "midtown", "flagship"]) {
  const desc = L.LAYOUTS[id];
  const off = runFloor(desc, { seconds: SECONDS, seed: 7, avoid: false });
  const on = runFloor(desc, { seconds: SECONDS, seed: 7, time: true });
  const tag = `${id}:`;
  ok(off.seated >= 80 && off.left >= 60 && off.deliveries >= 8, `${tag} the floor is busy (${off.seated} seated, ${off.left} out the door, ${off.deliveries} deliveries in ${SECONDS} s)`);
  ok(off.overlapS >= 60 && off.worstRun > 2, `${tag} with the rule off, bodies stand in each other (${off.overlapS.toFixed(0)} body-seconds, one pair for ${off.worstRun.toFixed(1)} s)`);
  ok(on.overlapS <= 0.1 * off.overlapS, `${tag} with it on that is ${on.overlapS.toFixed(1)} body-seconds, under a tenth`);
  ok(on.worstRun <= BRIEF, `${tag} no two are inside each other for longer than ${BRIEF} s (${on.worstRun.toFixed(2)} s)`);
  ok(on.ghosts <= 10, `${tag} the last resort was needed ${on.ghosts} times, not routinely`);
  ok(on.stuck.length === 0 && off.stuck.length === 0, `${tag} nobody is still walking 30 s after setting off (${on.stuck.join("; ") || "none"})`);
  ok(on.seated >= 0.9 * off.seated && on.left >= 0.9 * off.left && on.deliveries >= 0.6 * off.deliveries, `${tag} the floor still flows (${on.seated} seated, ${on.left} out, ${on.deliveries} deliveries)`);
  ok(mean(on.seatT) <= 1.15 * mean(off.seatT) && mean(on.exitT) <= 1.15 * mean(off.exitT) && Math.max(...on.exitT) <= Math.max(...off.exitT) + 5,
    `${tag} and no slower than 15% (to a stool ${mean(on.seatT).toFixed(2)} s against ${mean(off.seatT).toFixed(2)}, out ${mean(on.exitT).toFixed(2)} against ${mean(off.exitT).toFixed(2)}, slowest out ${Math.max(...on.exitT).toFixed(1)} s)`);
  ok(on.pushedShut === 0, `${tag} nobody was pushed off open floor`);
  ok(on.inFurniture <= 1.25 * off.inFurniture, `${tag} or further into the furniture than a route already goes (${on.inFurniture} body-frames against ${off.inFurniture})`);
  ok(on.boss.x === desc.stations.doorRing.x && on.boss.z === desc.stations.doorRing.z && on.boss.y === 0, `${tag} the boss, standing inside the door all night, was not moved`);
  ok(on.pops === 0 && off.pops === 0 && on.maxLag <= L.STEP_H, `${tag} no stride lifted a body faster than ${FOOT_RATE} m per metre (furthest off the floor ${on.maxLag.toFixed(3)} m)`);
  const again = runFloor(desc, { seconds: 30, seed: 7 }), again2 = runFloor(desc, { seconds: 30, seed: 7 }), other = runFloor(desc, { seconds: 30, seed: 8 });
  ok(again.end === again2.end && again.overlapS === again2.overlapS, `${tag} the same seed gives the same floor`);
  ok(again.end !== other.end, `${tag} and another seed a different one`);
  // The cost. There is no frame budget written down for this game; what is
  // written down is the planner's (WISHLIST: 0.45 ms a typical plan), so that
  // is the yardstick, with room for a slow runner.
  const ms = on.sepMs.slice().sort((a, b) => a - b), avg = mean(ms);
  costWorst = Math.max(costWorst, avg);
  ok(avg < 0.45, `${tag} separate() costs ${avg.toFixed(3)} ms a frame on average, under one typical plan (median ${ms[ms.length >> 1].toFixed(3)}, p99 ${ms[Math.floor(ms.length * 0.99)].toFixed(3)})`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
