// crowd-floor.mjs — a busy floor for smoke-crowd.mjs to stand on. Not a suite:
// it asserts nothing and exits 0, so CI's test/*.mjs loop passes over it.
//
// What is real here is what is under test: walk.js's Route, stepToward() and
// separate(), on layout.js's rooms. What is not is who is walking. Patron and
// Server need three.js and a scene, so the guests and runners below are
// drivers written to load the floor the way a night does (in at the door, to a
// stool, sit, out; pass, guest, home), and nothing about them is asserted.
// A guest a second for two minutes is several times a full flagship's peak
// hour (crowdTarget × 0.17 / 45 s is one every 1.3 s at 200 covers).
import * as L from "../js/layout.js";
import { Route, EXIT_SNAP, separate, BODY_R, FOOT_RATE } from "../js/walk.js";
import { mulberry32 } from "../js/engine.js";

export const DT = 1 / 60;
const WALK = 1.55, SERVER_WALK = 2.0;
function seeded(seed) { let s = seed >>> 0; return () => { const r = mulberry32(s); s = r.state; return r.value; }; }

export function runFloor(desc, { seconds = 120, seed = 1, avoid = true, every = 1, runners = 3, boss = true, dt = DT, time = false, rate = FOOT_RATE } = {}) {
  const rand = seeded(seed);
  const pts = L.standPointsFor(desc);
  const reach = L.reachableSeats(desc);
  const seats = L.seatsFor(desc).filter((s, i) => reach[i]).map(s => ({ ...s, taken: false }));
  const layoutOf = () => desc;
  const cols = L.collidersFor(desc);
  const guests = [], crew = [], all = [];
  const bossBody = boss ? { pos: { x: pts.doorRing.x, y: 0, z: pts.doorRing.z }, walking: false, fixed: true } : null;
  let nextId = 1;
  for (let i = 0; i < runners; i++) {
    const h = L.crewHome(desc, i);
    crew.push({ kind: "runner", id: "r" + i, pos: { x: h.x, y: h.y, z: h.z }, home: h, route: new Route(layoutOf), state: "idle", atHome: true, speed: SERVER_WALK, wait: 1 + i, target: null, trips: 0,
      get walking() { return this.state !== "idle" || !this.atHome; } });
  }
  const st = { frames: 0, overlapS: 0, worstRun: 0, ghosts: 0, touchingIn: 0, seated: 0, left: 0, seatT: [], exitT: [], stuck: [], sepMs: [], minD: Infinity, deliveries: 0, moved: 0, inFurniture: 0, pops: 0, maxPop: 0, maxLag: 0, popAt: '', pushedShut: 0 };
  const runs = new Map();
  let spawnT = 0, t = 0;
  const N = Math.round(seconds / dt);
  for (let f = 0; f < N; f++, t += dt) {
    spawnT -= dt;
    if (spawnT <= 0) {
      const open = seats.filter(s => !s.taken);
      if (open.length) {
        const seat = open[Math.floor(rand() * open.length)]; seat.taken = true;
        const x = pts.door.x + (rand() - 0.5) * 0.6;
        guests.push({ kind: "guest", id: nextId++, pos: { x, y: L.floorYAt(desc, x, pts.door.z), z: pts.door.z }, seat, route: new Route(layoutOf), state: "entering", speed: WALK, born: t, since: t, timer: 0,
          get walking() { return this.state === "entering" || this.state === "leaving"; }, get solid() { return this.state !== "gone"; } });
      }
      spawnT = every;
    }
    const was = new Map();
    for (const b of [...guests, ...crew]) if (b.walking) was.set(b, { x: b.pos.x, y: b.pos.y, z: b.pos.z });
    for (const g of guests) {
      if (g.state === "entering") {
        g.route.aim(g.pos, { x: g.seat.ax, z: g.seat.az });
        if (g.route.step(g.pos, WALK * dt)) {
          g.route.clear(); g.pos.x = g.seat.x; g.pos.z = g.seat.z; g.pos.y = g.seat.y;
          g.state = "seated"; g.timer = 8 + rand() * 12; st.seated++; st.seatT.push(t - g.since);
        }
      } else if (g.state === "seated") {
        g.timer -= dt;
        if (g.timer <= 0) { g.seat.taken = false; g.state = "leaving"; g.since = t; g.route.clear(); g.route.within = EXIT_SNAP; }
      } else if (g.state === "leaving") {
        g.route.aim(g.pos, pts.doorOut);
        if (g.route.step(g.pos, WALK * dt)) { g.state = "gone"; st.left++; st.exitT.push(t - g.since); }
      }
    }
    for (const r of crew) {
      if (r.state === "idle") {
        r.wait -= dt;
        const sitting = guests.filter(g => g.state === "seated");
        if (r.wait <= 0 && sitting.length) {
          r.target = sitting[Math.floor(rand() * sitting.length)];
          r.pass = rand() < 0.5 ? pts.passFood : pts.passDrink;
          r.route.clear(); r.atHome = false; r.state = "toPass";
        } else { r.route.aim(r.pos, r.home); r.atHome = r.route.step(r.pos, r.speed * dt); }
      } else if (r.state === "toPass") {
        r.route.aim(r.pos, r.pass);
        if (r.route.step(r.pos, r.speed * dt)) { r.route.clear(); r.state = "toPatron"; }
      } else {
        const p = r.target;
        if (p.state !== "seated") { r.route.clear(); r.state = "idle"; r.wait = 0.5; continue; }
        r.route.aim(r.pos, p.pos);
        if (r.route.step(r.pos, r.speed * dt, 0.75)) { st.deliveries++; r.route.clear(); r.state = "idle"; r.wait = 0.5 + rand() * 2; }
      }
    }
    const bodies = [...guests.filter(g => g.state !== "gone"), ...crew, ...(bossBody ? [bossBody] : [])];
    if (avoid) {
      const before = bodies.map(b => b.crowd ? b.crowd.ghost : 0);
      const t0 = time ? performance.now() : 0;
      st.touchingIn += separate(desc, bodies, dt);
      if (time) st.sepMs.push(performance.now() - t0);
      bodies.forEach((b, i) => { if (b.crowd && b.crowd.ghost > 0 && before[i] <= 0) st.ghosts++; if (b.crowd && b.crowd.pushed) st.moved++; });
    }
    // a stride's rise against its run: more than the floor's own slope is a pop
    for (const [b, p] of was) {
      if (!b.walking) continue;
      const run = Math.hypot(b.pos.x - p.x, b.pos.z - p.z), rise = Math.abs(b.pos.y - p.y);
      st.maxLag = Math.max(st.maxLag, Math.abs(b.pos.y - L.floorYAt(desc, b.pos.x, b.pos.z)));
      if (rise > rate * run + 1e-9) { st.pops++; if (rise > st.maxPop) { st.maxPop = rise; st.popAt = `(${b.pos.x.toFixed(2)}, ${b.pos.z.toFixed(2)}) y ${p.y.toFixed(3)} → ${b.pos.y.toFixed(3)} over ${run.toFixed(3)} m, ${b.kind} ${b.state}`; } }
      if (b.crowd && b.crowd.pushed && !L.navOpen(desc, b.pos.x, b.pos.z)) st.pushedShut++;
    }
    // what the eye would see: pairs still inside each other after the frame
    const seen = new Set();
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (!a.walking && !b.walking) continue;
      // past the walls is out of the room (walk.js rule 6)
      if (!L.inBounds(desc, a.pos.x, a.pos.z, 0) || !L.inBounds(desc, b.pos.x, b.pos.z, 0)) continue;
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      if (d < 2 * BODY_R - 0.02) {
        st.overlapS += dt; st.minD = Math.min(st.minD, d);
        const k = (a.id ?? "boss") + "|" + (b.id ?? "boss"); seen.add(k);
        const run = (runs.get(k) || 0) + dt; runs.set(k, run); if (run > st.worstRun) { st.worstRun = run; st.worstPair = k + " @" + t.toFixed(1) + " (" + a.pos.x.toFixed(2) + "," + a.pos.z.toFixed(2) + ") " + (a.state||"") + "/" + (b.state||""); }
      }
    }
    for (const k of runs.keys()) if (!seen.has(k)) runs.delete(k);
    for (const b of bodies) if (b.walking && cols.some(c => L.pointInBox(c, b.pos.x, b.pos.z, 0.1))) st.inFurniture++;
    for (const b of bodies) if (b.walking && cols.some(c => L.pointInBox(c, b.pos.x, b.pos.z, -0.05))) st.deep = (st.deep || 0) + 1;
    st.frames++;
  }
  for (const g of guests) if (g.walking && t - g.since > 30) st.stuck.push(`${g.id} ${g.state} ${(t - g.since).toFixed(0)}s`);
  st.spawned = guests.length;
  st.boss = bossBody ? { ...bossBody.pos } : null;
  st.end = JSON.stringify([...guests, ...crew].map(b => [b.id, b.state, +b.pos.x.toFixed(6), +b.pos.z.toFixed(6)]));
  return st;
}
