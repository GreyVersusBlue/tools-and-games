// browser-check.mjs — the room on screen agrees with the room on paper.
//
// smoke-layout.mjs checks layout.js under bare Node. This boots the real page
// in real Chromium and asserts what world.js and day.js actually did with the
// description: the module-level seats and colliders are the derived ones, the
// stand-points are the description's, and the two paths that rebuild the room
// on a live page — "New Game (wipe save)" and a dev-menu venue warp — leave the
// same lists, the rings on their stations, and no error on the console. Phase 1
// shipped its first draft of day.js with a key clash that only this could see:
// every test in test/ was green, and a signed lease threw.
//
//   node tools/browser-check.mjs
//
// Lives under tools/ rather than test/ on purpose: fourth-quarter-ci.yml runs
// every test/*.mjs, and this needs playwright-core and a Chromium on disk,
// neither of which the game has any use for. Run it by hand, the way Absalom's
// and Blue Hour's test/browser.mjs are run:
//
//   npm i playwright-core          (from this folder; node_modules/ is ignored)
//   CHROME=/path/to/chrome node tools/browser-check.mjs
//
// Nothing here is a frame-timing or motion assertion, so locked #53 does not
// apply; a software-rendered Chromium reaches the same lists a real GPU does.

import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../js/layout.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "..", "..");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("nope");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/Projects/fourth-quarter/index.html`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
};
const group = t => console.log(`\n${t}`);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });

// what the page's world.js holds right now, as plain numbers
const probe = () => page.evaluate(async () => {
  const w = await import("./js/world.js");
  const v = p => ({ x: p.x, y: p.y, z: p.z });
  return {
    layout: w.currentLayout().id,
    seats: w.seats.map(s => ({ id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, ax: s.approach.x, az: s.approach.z, reachable: s.reachable })),
    colliders: w.colliders.map(b => ({ min: v(b.min), max: v(b.max) })),
    points: { door: v(w.DOOR), doorOut: v(w.DOOR_OUT), passFood: v(w.PASS_FOOD), passDrink: v(w.PASS_DRINK),
      passFoodShelf: v(w.PASS_FOOD_SHELF), passDrinkShelf: v(w.PASS_DRINK_SHELF),
      stove: v(w.STOVE_STATION), tap: v(w.TAP_STATION), upgrades: v(w.UPGRADES_STATION) },
    inBounds: [[0, 0], [2.9, -5.5], [0.5, -5.5], [6, -7], [0, 5.4]].map(([x, z]) => w.inBounds(x, z)),
    camera: v(window.__fq.camera.position),
    rings: window.__fq.day.stations.map(st => ({ id: st.point ?? st.id, x: st.ring.position.x, z: st.ring.position.z })),
  };
});

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sameRoom = (label, got, venueId) => {
  const desc = L.layoutFor(venueId);
  const seats = L.seatsFor(desc), cols = L.collidersFor(desc), pts = L.standPointsFor(desc);
  ok(`${label}: layout is ${desc.id}`, got.layout === desc.id, got.layout);
  ok(`${label}: ${seats.length} seats`, got.seats.length === seats.length, `got ${got.seats.length}`);
  ok(`${label}: every seat is the derived one, in order, on the floor under it`,
    got.seats.every((s, i) => s.id === seats[i].id && near(s.x, seats[i].x) && near(s.y, seats[i].y) && near(s.z, seats[i].z) && near(s.ax, seats[i].ax) && near(s.az, seats[i].az)));
  const reach = L.reachableSeats(desc);
  ok(`${label}: every seat carries the nav grid's reachable, and every one of them is true`,
    got.seats.every((s, i) => s.reachable === reach[i]) && reach.every(Boolean),
    `${got.seats.filter(s => s.reachable !== true).length} not reachable on the page`);
  ok(`${label}: ${cols.length} colliders`, got.colliders.length === cols.length, `got ${got.colliders.length}`);
  ok(`${label}: every collider is the derived box, in order`,
    got.colliders.every((b, i) => ["x", "y", "z"].every(a => near(b.min[a], cols[i].min[a]) && near(b.max[a], cols[i].max[a]))));
  ok(`${label}: stand-points are the description's`,
    Object.entries(got.points).every(([k, p]) => near(p.x, pts[k].x) && near(p.y, pts[k].y) && near(p.z, pts[k].z)));
  // the five probe points are the Corner Tap's; every room answers the middle
  // of its floor and a point past its south wall the same way, and only the
  // Corner Tap's doorway / wall / kitchen points are the Corner Tap's
  if (venueId === "cornerTap") {
    ok(`${label}: inBounds answers room / doorway / wall / kitchen / south wall`,
      got.inBounds.join() === [true, true, false, true, false].join(), got.inBounds.join());
  }
  ok(`${label}: camera is on the room's spawn at eye height over the floor there`,
    near(got.camera.x, pts.spawn.x) && near(got.camera.y, pts.spawn.y + 1.62) && near(got.camera.z, pts.spawn.z), JSON.stringify(got.camera));
  ok(`${label}: six rings sit on the description's stations`,
    got.rings.length === 6 && got.rings.every(r => near(r.x, pts[r.id].x) && near(r.z, pts[r.id].z)), JSON.stringify(got.rings));
};

group("boot");
await page.goto(URL_, { waitUntil: "load" });
await page.waitForTimeout(2500);
ok("no page errors on boot", errors.length === 0, errors.join(" | "));
sameRoom("boot", await probe(), "cornerTap");

group("New Game (wipe save) → rebuildVenue()");
await page.click("text=New Game (wipe save)");
await page.waitForTimeout(600);
ok("no page errors after the wipe", errors.length === 0, errors.join(" | "));
sameRoom("wipe", await probe(), "cornerTap");

group("dev warp to the flagship → rebuildVenue()");
await page.click("text=Take the Floor");
await page.waitForTimeout(300);
await page.keyboard.press("Backquote");
await page.waitForTimeout(400);
await page.click("[data-warp=flagship]", { timeout: 5000 });
await page.waitForTimeout(600);
ok("no page errors after the warp", errors.length === 0, errors.join(" | "));
const warped = await probe();
sameRoom("warp", warped, "flagship");
ok("seats did not stack across three builds", warped.seats.length === L.seatsFor(L.layoutFor("flagship")).length);

// every rung, from the flagship down and back: the dev menu is still open
for (const id of ["fieldhouse", "midtown", "cornerTap"]) {
  group(`dev warp to ${id}`);
  await page.click(`[data-warp=${id}]`, { timeout: 5000 });
  await page.waitForTimeout(600);
  ok(`no page errors after the warp to ${id}`, errors.length === 0, errors.join(" | "));
  sameRoom(id, await probe(), id);
}

// freeSeat() is the one place the reachable flag has teeth, and it is a
// list filter rather than anything that moves — mark a stool unreachable on
// the live page and it stops being handed out. Nothing here is timed, so
// locked #53 does not apply.
group("freeSeat() refuses a stool with no route");
const offered = await page.evaluate(async () => {
  const w = await import("./js/world.js");
  const p = await import("./js/patrons.js");
  const before = w.seats.filter(s => s.reachable !== false).length;
  w.seats[0].reachable = false;
  const ids = new Set();
  for (let i = 0; i < 400; i++) { const s = p.freeSeat(); if (s) ids.add(s.id); }
  w.seats[0].reachable = true;
  return { before, total: w.seats.length, drawn: [...ids].sort((a, b) => a - b) };
});
ok("every stool but the flagged one is still on offer", offered.before === offered.total, `${offered.before}/${offered.total}`);
ok("400 draws never return the flagged stool", !offered.drawn.includes(1), offered.drawn.slice(0, 4).join(","));
ok("400 draws do reach the rest of the room", offered.drawn.length >= offered.total - 4, `${offered.drawn.length}/${offered.total - 1}`);

// and the module the page loaded is the module the Node suite planned on
group("the page plans the same routes Node does");
const planned = await page.evaluate(async () => {
  const l = await import("./js/layout.js");
  const d = l.layoutFor("cornerTap");
  return {
    straight: l.pathBetween(d, { x: 0, z: 4.5 }, { x: 0, z: 2 }),
    round: l.pathBetween(d, { x: -6.6, z: 0.9 }, { x: -3.2, z: 0.9 }),
  };
});
const nodeStraight = L.pathBetween(L.CORNER_TAP, { x: 0, z: 4.5 }, { x: 0, z: 2 });
const nodeRound = L.pathBetween(L.CORNER_TAP, { x: -6.6, z: 0.9 }, { x: -3.2, z: 0.9 });
ok("a straight shot is two points in the browser too", JSON.stringify(planned.straight) === JSON.stringify(nodeStraight), JSON.stringify(planned.straight));
ok("the route round a four-top is the same list Node planned", JSON.stringify(planned.round) === JSON.stringify(nodeRound), `${planned.round.length} points`);

// Phase 3's actual claim, stepped rather than watched: build a patron for
// every fourth stool in each room, drive it at a fixed 1/60 s until it sits,
// then send it home. The dt is a number, not a frame time, so this is not a
// real-time motion assertion and locked #53 does not apply — a slow renderer
// changes how long the loop takes, not where anybody ends up.
group("patrons walk to their stools without going through the furniture");
// the loop above left the room on the Corner Tap, whose warp button is
// disabled while it is the current venue — so it goes last, unwarped
for (const id of ["fieldhouse", "midtown", "flagship", "cornerTap"]) {
  if (await page.isEnabled(`[data-warp=${id}]`)) {
    await page.click(`[data-warp=${id}]`, { timeout: 5000 });
    await page.waitForTimeout(600);
  }
  const walk = await page.evaluate(async () => {
    const THREE = await import("three");
    const w = await import("./js/world.js");
    const P = await import("./js/patrons.js");
    const L = await import("./js/layout.js");
    const desc = w.currentLayout();
    const cols = L.collidersFor(desc);
    const deep = (x, z) => {   // how far inside a collider box (0 = outside all)
      let d = 0;
      for (const b of cols) {
        if (x <= b.min.x || x >= b.max.x || z <= b.min.z || z >= b.max.z) continue;
        d = Math.max(d, Math.min(x - b.min.x, b.max.x - x, z - b.min.z, b.max.z - z));
      }
      return d;
    };
    const engine = { walkout() {}, depart() {} };
    const scene = new THREE.Scene();
    const out = { tried: 0, sat: 0, gone: 0, worst: 0, worstSeat: null, slowest: 0, stuck: [], climbed: 0, biggestRise: 0, wrongFloor: 0 };
    for (let i = 0; i < w.seats.length; i += 4) {
      w.seats.forEach((s, j) => { s.taken = j !== i; });
      const p = new P.Patron(scene, engine, false);
      if (!p.seat || p.seat.id !== w.seats[i].id) { out.stuck.push(`seat ${w.seats[i].id} was not offered`); continue; }
      out.tried++;
      const seatId = p.seat.id;
      let n = 0;
      // sample before each step, never after the last one: sitting down copies
      // the stool's own position, and a stool is tucked 6.8 cm under its
      // table's padded box by construction (0.95 / √2 against 0.62 + 0.12)
      let py = p.pos.y;
      for (; n < 4000 && p.state === "entering"; n++) {
        const d = deep(p.pos.x, p.pos.z);
        if (d > out.worst) { out.worst = d; out.worstSeat = seatId; }
        p.update(1 / 60);
        // the body's y is read off the floor after every step: on the stair
        // it rises a riser's worth per tread, and nowhere does it jump
        out.biggestRise = Math.max(out.biggestRise, Math.abs(p.pos.y - py));
        py = p.pos.y;
      }
      if (p.state === "settling") {
        out.sat++;
        if (p.pos.y > 0.5) out.climbed++;
        if (Math.abs(p.pos.y - L.floorYAt(desc, p.pos.x, p.pos.z)) > 1e-6) out.wrongFloor++;
      }
      else out.stuck.push(`seat ${seatId}: ${p.state} after ${n} steps at (${p.pos.x.toFixed(1)}, ${p.pos.z.toFixed(1)})`);
      out.slowest = Math.max(out.slowest, n);
      // and home again, starting from the stool — a start inside a box, which
      // is the case the planner has to route out of rather than through
      p.releaseSeat();
      p.state = "leaving";
      let m = 0, cleared = false;
      for (; m < 4000 && p.state === "leaving"; m++) {
        const d = deep(p.pos.x, p.pos.z);
        if (!cleared && d === 0) cleared = true;
        if (cleared && d > out.worst) { out.worst = d; out.worstSeat = seatId; }
        p.update(1 / 60);
        out.biggestRise = Math.max(out.biggestRise, Math.abs(p.pos.y - py));
        py = p.pos.y;
      }
      if (!cleared) out.stuck.push(`seat ${seatId}: never got clear of its own table on the way out`);
      if (p.state === "gone") out.gone++;
      else out.stuck.push(`seat ${seatId}: still ${p.state} on the way out`);
      out.slowest = Math.max(out.slowest, m);
      w.seats.forEach(s => { s.taken = false; });
    }

    // one server, the full ticket: idle at its home, fetch from the food pass,
    // carry it to a patron sitting at the furthest stool from the pass
    const far = w.seats.reduce((a, b) =>
      Math.hypot(b.pos.x - w.PASS_FOOD.x, b.pos.z - w.PASS_FOOD.z) > Math.hypot(a.pos.x - w.PASS_FOOD.x, a.pos.z - w.PASS_FOOD.z) ? b : a);
    const sitter = new P.Patron(scene, engine, false);
    sitter.route.clear();
    sitter.state = "settling";
    sitter.mesh.position.copy(far.pos);
    const ticket = { id: 1, kind: "food", itemId: "wings", patronId: sitter.id, placedAt: 0 };
    // deliver() answers false on purpose: the walk is what is under test, and
    // a true would ring the register and hand the patron a mesh
    const sv = new P.Server(scene, { readyUnclaimed: () => [], claim: () => true, deliver: () => false },
      "Check", L.crewHome(desc, 0), 2.0, "server");
    sv.ticket = ticket;
    sv.state = "toPass";
    const byId = new Map([[sitter.id, sitter]]);
    out.server = { reachedPass: false, reachedPatron: false, worst: 0, steps: 0 };
    for (let k = 0; k < 8000 && !(out.server.reachedPass && sv.state === "idle"); k++) {
      const d = deep(sv.mesh.position.x, sv.mesh.position.z);
      if (d > out.server.worst) out.server.worst = d;
      sv.update(1 / 60, byId);
      if (sv.state === "toPatron") out.server.reachedPass = true;
      out.server.steps = k + 1;
    }
    out.server.reachedPatron = out.server.reachedPass && sv.state === "idle";
    out.server.at = [+sv.mesh.position.x.toFixed(2), +sv.mesh.position.z.toFixed(2)];
    out.server.target = [+far.pos.x.toFixed(2), +far.pos.z.toFixed(2)];
    return out;
  });
  ok(`${id}: every sampled patron reached its stool`, walk.tried > 0 && walk.sat === walk.tried, `${walk.sat}/${walk.tried}  ${walk.stuck.join(" | ")}`);
  ok(`${id}: and every one of them left again`, walk.gone === walk.tried, `${walk.gone}/${walk.tried}`);
  ok(`${id}: nobody walked inside a table, a counter or a crate`, walk.worst < 0.01,
    `deepest ${walk.worst.toFixed(3)} m (seat ${walk.worstSeat}), longest walk ${(walk.slowest / 60).toFixed(1)} s`);
  ok(`${id}: every patron sat on the floor under its stool, and no frame lifted anyone more than a riser`,
    walk.wrongFloor === 0 && walk.biggestRise <= L.STEP_H + 1e-6, `${walk.wrongFloor} off the floor, biggest rise ${walk.biggestRise.toFixed(3)} m`);
  if (id === "flagship") ok("flagship: the three sampled deck stools were reached by climbing, and sat on the deck", walk.climbed === 3, `${walk.climbed} climbed`);
  else ok(`${id}: nobody climbed anything`, walk.climbed === 0, `${walk.climbed} climbed`);
  ok(`${id}: a server reached the food pass and then the furthest stool from it`,
    walk.server.reachedPass && walk.server.reachedPatron,
    `${walk.server.steps} steps, stopped at ${walk.server.at} for a patron at ${walk.server.target}`);
  ok(`${id}: and it did not walk through the furniture either`, walk.server.worst < 0.01,
    `deepest ${walk.server.worst.toFixed(3)} m`);
}

// Midtown's back room is the first thing in this project world.js draws that
// is not the hall or the kitchen, and every Node assertion about it is about
// layout.js. This is the other half: build both rooms into a throwaway scene
// on the live page and measure what actually came out. It runs last because
// buildWorld() repoints world.js's module state at whatever it built.
group("world.js draws the second rectangle");
const built = await page.evaluate(async () => {
  const THREE = await import("three");
  const W = await import("./js/world.js");
  const L = await import("./js/layout.js");
  const read = venue => {
    const scene = new THREE.Scene();
    const r = W.buildWorld(scene, venue);
    const desc = L.layoutFor(venue);
    const meshes = [], lights = [], world = [];
    const wp = new THREE.Vector3();
    r.group.traverse(o => {
      if (o.isMesh) {
        meshes.push({ x: o.position.x, y: o.position.y, z: o.position.z, ry: o.rotation.y, rx: o.rotation.x });
        o.getWorldPosition(wp);
        const sz = o.geometry.parameters;
        world.push({ x: wp.x, y: wp.y, z: wp.z, rx: o.rotation.x, geo: o.geometry.type, w: sz.width, h: sz.height, d: sz.depth, rt: sz.radiusTop });
      }
      if (o.isLight && o.position) lights.push({ x: o.position.x, y: o.position.y, z: o.position.z });
    });
    const key = [...r.nightRig.children, ...r.dayRig.children].filter(l => l.isDirectionalLight)
      .map(l => ({ left: l.shadow.camera.left, right: l.shadow.camera.right, top: l.shadow.camera.top, bottom: l.shadow.camera.bottom }));
    const box = new THREE.Box3().setFromObject(r.group);
    return { meshes, lights, world, key, box: { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z }, h: desc.room.h };
  };
  return { tap: read("cornerTap"), mid: read("midtown"), flag: read("flagship") };
});
{
  const m = L.MIDTOWN, a = m.annexes[0], t = m.wallT;
  const near2 = (p, q) => Math.abs(p - q) <= 1e-6;
  const cx = (a.x0 + a.x1) / 2, cz = (a.z0 + a.z1) / 2;
  const inAnnex = p => p.x > a.x0 && p.x < a.x1 && p.z > a.z0 && p.z < a.z1;
  const floors = built.mid.meshes.filter(o => near2(o.x, cx) && near2(o.z, cz) && near2(o.y, 0));
  ok("the back room has a floor at its centre, y=0", floors.length === 1, `${floors.length} meshes there`);
  const ceils = built.mid.meshes.filter(o => near2(o.x, cx) && near2(o.z, cz) && near2(o.y, a.h));
  ok(`the back room's ceiling is at its own ${a.h} m, not the hall's ${m.room.h}`, ceils.length === 1, `${ceils.length} meshes there`);
  ok("nothing sits at the hall's ceiling height over the back room",
    !built.mid.meshes.some(o => inAnnex(o) && near2(o.y, m.room.h)));
  // the hall's east wall is boxes now, offset half a thickness outside the room
  const segs = L.wallSegments(m, "east");
  const onEast = segs.map(seg => built.mid.meshes.some(o =>
    near2(o.x, m.room.x + t / 2) && near2(o.z, (seg.a0 + seg.a1) / 2) && near2(o.y, (seg.y0 + seg.y1) / 2)));
  ok("every span of the hall's east wall is in the scene, half a thickness outside the room",
    segs.length === 3 && onEast.every(Boolean), `${onEast.filter(Boolean).length}/${segs.length}`);
  ok("and the middle one is the header, its underside on the doorway",
    near2((segs[1].y0 + segs[1].y1) / 2, (L.DOOR_H + m.room.h) / 2), `y0=${segs[1].y0}`);
  // the Corner Tap's east wall is the plane it always was: one mesh on the
  // room's own line, and nothing offset outside it (the kitchen's east wall
  // shares that x, so it is the z that separates them)
  const tapRoom = L.CORNER_TAP.room;
  const tapEast = built.tap.meshes.filter(o => near2(o.x, tapRoom.x) && near2(o.y, tapRoom.h / 2) && Math.abs(o.z) < tapRoom.z);
  ok("a room with no annex still gets the single plane on its east wall", tapEast.length === 1, `${tapEast.length} meshes on it`);
  ok("…and nothing offset outside it", !built.tap.meshes.some(o => near2(o.x, tapRoom.x + L.CORNER_TAP.wallT / 2) && Math.abs(o.z) < tapRoom.z));
  // the annex's own three walls
  const walls = L.annexWalls(m, a);
  ok("the back room's three outer walls are all in the scene",
    walls.every(w => built.mid.meshes.some(o => near2(o.x, w.x) && near2(o.z, w.z) && near2(o.y, a.h / 2))), `${walls.length} expected`);
  // pendants hang off the ceiling they are actually under
  const pend = built.mid.lights.filter(inAnnex);
  ok(`the back room's pendants hang 40 cm under its own ceiling (${a.h - 0.4} m)`,
    pend.length >= 3 && pend.filter(l => near2(l.y, a.h - 0.4)).length === 3,
    pend.map(l => l.y.toFixed(2)).join(","));
  ok("and nothing in there hangs at the hall's pendant height", !pend.some(l => near2(l.y, m.room.h - 0.4)));
  // the shadow cameras reach it
  ok("both shadow cameras cover the back room",
    built.mid.key.length === 2 && built.mid.key.every(k => k.right >= a.x1 + 1 - 1e-6),
    built.mid.key.map(k => `${k.left}..${k.right}`).join(" / "));
  ok("and the Corner Tap's are the ±9 / 7 / -10 they always were",
    built.tap.key.every(k => near2(k.left, -9) && near2(k.right, 9) && near2(k.top, 7) && near2(k.bottom, -10)),
    JSON.stringify(built.tap.key[0]));
  ok("the built group reaches the back room's far wall", built.mid.box.x1 >= a.x1 - 1e-6, built.mid.box.x1.toFixed(3));
}

// The flagship's mezzanine is the first floor world.js draws that is not at
// y = 0. Measure what came out of buildWorld(): the deck at its height, the
// stools and table tops on it lifted with it, nine solid steps that climb to
// it, a rail along its two open edges and panelling under them.
group("world.js draws the mezzanine");
{
  const f = L.FLAGSHIP, m = f.mezzanines[0], s = m.stair;
  const near2 = (p, q) => Math.abs(p - q) <= 1e-6;
  const cx = (m.x0 + m.x1) / 2, cz = (m.z0 + m.z1) / 2;
  const W = built.flag.world;
  const inDeck = o => o.x > m.x0 && o.x < m.x1 && o.z > m.z0 && o.z < m.z1;
  const inStair = o => o.x > s.x0 && o.x < s.x1 && o.z > s.z0 && o.z < s.z1;
  const deck = W.filter(o => near2(o.x, cx) && near2(o.z, cz) && near2(o.y, m.y) && o.geo === "PlaneGeometry");
  ok(`the deck is a floor plane at its centre, ${m.y} m up`, deck.length === 1, `${deck.length} planes there`);
  ok("the hall's own floor is still at 0 under it", built.flag.world.some(o => near2(o.x, 0) && near2(o.z, 0) && near2(o.y, 0) && o.geo === "PlaneGeometry"));
  // stool tops are 0.72 m up their stool, table tops 0.92: twelve and three lifted
  const tops = W.filter(o => o.rt === 0.22 && inDeck(o));
  ok("twelve stool tops stand on the deck, 0.72 m over it", tops.length === 12 && tops.every(o => near2(o.y, m.y + 0.72)), `${tops.length}, at ${tops[0] && tops[0].y.toFixed(2)}`);
  ok("and none on the deck is at the hall floor's stool height", !tops.some(o => near2(o.y, 0.72)));
  const tables = W.filter(o => o.rt === L.TABLE_TOP_R && inDeck(o));
  ok("three table tops stand on it, 0.92 m over it", tables.length === 3 && tables.every(o => near2(o.y, m.y + 0.92)), `${tables.length}`);
  ok(`the other ${L.seatsFor(f).length - 12} stool tops are at 0.72`, W.filter(o => o.rt === 0.22 && !inDeck(o) && near2(o.y, 0.72)).length === L.seatsFor(f).length - 12);
  // the stair: solid steps, each a riser taller than the last
  const steps = W.filter(o => inStair(o) && o.geo === "BoxGeometry" && o.y < m.y && o.h > 0.1).sort((a, b) => a.x - b.x);
  const n = Math.ceil(m.y / 0.18);
  ok(`${n} steps climb the stair, each a riser taller than the last`,
    steps.length === n && steps.every((o, i) => near2(o.h, (i + 1) * m.y / n) && near2(o.y, o.h / 2)),
    steps.map(o => o.h.toFixed(2)).join(","));
  ok("the top step's tread is level with the deck", steps.length && near2(steps.at(-1).h, m.y));
  ok("and the steps are the stair's full width", steps.every(o => near2(o.d, s.z1 - s.z0)));
  // rails on the two open edges, panelling under them, nothing on the walls
  const edges = L.mezzanineEdges(f, m);
  const rails = W.filter(o => near2(o.y, m.y + 1.0) && o.geo === "BoxGeometry" && o.h === 0.06);
  ok("a rail runs along each open edge, a metre over the deck", rails.length === edges.length && edges.every(e => rails.some(r =>
    e.side === "north" ? near2(r.z, m.z0) && near2(r.x, (e.a0 + e.a1) / 2) : near2(r.x, m.x0) && near2(r.z, (e.a0 + e.a1) / 2))),
    `${rails.length} rails for ${edges.length} edges`);
  ok("the west rail stops where the stair lands", rails.some(r => near2(r.x, m.x0) && near2(r.w, s.z0 - m.z0)));
  const panels = W.filter(o => near2(o.y, (m.y - 0.22) / 2) && o.geo === "BoxGeometry" && o.d === 0.08);
  ok("panelling closes the ground under both open edges", panels.length === 2 && panels.every(o => near2(o.h, m.y - 0.22)), `${panels.length}`);
  ok("and nothing rails or panels the east and south edges, which are the hall's walls",
    !W.some(o => (near2(o.x, m.x1) || near2(o.z, m.z1)) && (o.h === 0.06 || o.d === 0.08) && o.y > 0.2 && o.y < m.y + 1.1 && inDeck({ x: Math.min(o.x, m.x1 - 0.01), z: Math.min(o.z, m.z1 - 0.01) })));
  ok("the Corner Tap draws no deck, rails or panelling",
    !built.tap.world.some(o => o.geo === "BoxGeometry" && ((o.h === 0.06 && o.d === 0.06) || (o.d === 0.08 && o.w > 3))) &&
    built.tap.world.every(o => o.geo !== "PlaneGeometry" || o.rx !== -Math.PI / 2 || near2(o.y, 0)));
}

// a server carries a ticket up the stair to a deck stool — the furthest
// stool from the pass is in the hall's south-west corner, so the walk above
// never climbs with a ticket in hand
group("a server carries a ticket up to the mezzanine");
await page.click("[data-warp=flagship]", { timeout: 5000 });
await page.waitForTimeout(600);
const climbed = await page.evaluate(async () => {
  const THREE = await import("three");
  const w = await import("./js/world.js");
  const P = await import("./js/patrons.js");
  const L = await import("./js/layout.js");
  const desc = w.currentLayout(), m = desc.mezzanines[0];
  const cols = L.collidersFor(desc);
  const deep = (x, z) => {
    let d = 0;
    for (const b of cols) {
      if (x <= b.min.x || x >= b.max.x || z <= b.min.z || z >= b.max.z) continue;
      d = Math.max(d, Math.min(x - b.min.x, b.max.x - x, z - b.min.z, b.max.z - z));
    }
    return d;
  };
  const scene = new THREE.Scene();
  const target = w.seats.filter(s => s.pos.y > 0).reduce((p, q) => (q.pos.x > p.pos.x ? q : p));
  const sitter = new P.Patron(scene, { walkout() {}, depart() {} }, false);
  sitter.route.clear(); sitter.state = "settling"; sitter.mesh.position.copy(target.pos);
  const sv = new P.Server(scene, { readyUnclaimed: () => [], claim: () => true, deliver: () => false },
    "Check", L.crewHome(desc, 0), 2.0, "server");
  sv.ticket = { id: 1, kind: "food", itemId: "wings", patronId: sitter.id, placedAt: 0 };
  sv.state = "toPass";
  const byId = new Map([[sitter.id, sitter]]);
  let reachedPass = false, worst = 0, steps = 0, onDeck = false, biggestRise = 0, py = sv.mesh.position.y, onStair = false;
  for (let k = 0; k < 8000 && !(reachedPass && sv.state === "idle"); k++) {
    const { x, y, z } = sv.mesh.position;
    worst = Math.max(worst, deep(x, z));
    if (Math.abs(y - m.y) < 1e-6) onDeck = true;
    if (y > 0.3 && y < m.y - 0.3) onStair = true;
    sv.update(1 / 60, byId);
    biggestRise = Math.max(biggestRise, Math.abs(sv.mesh.position.y - py));
    py = sv.mesh.position.y;
    if (sv.state === "toPatron") reachedPass = true;
    steps = k + 1;
  }
  return { reachedPass, done: sv.state === "idle", worst, steps, onDeck, onStair, biggestRise,
    y: sv.mesh.position.y, seat: target.id, at: [+sv.mesh.position.x.toFixed(2), +sv.mesh.position.z.toFixed(2)] };
});
ok("it reached the pass and then the deck's furthest stool", climbed.reachedPass && climbed.done,
  `seat ${climbed.seat}, ${climbed.steps} steps, stopped at ${climbed.at}`);
ok("it was on the stair on the way, and on the deck at the end", climbed.onStair && climbed.onDeck && Math.abs(climbed.y - L.FLAGSHIP.mezzanines[0].y) < 1e-6, `ended at y=${climbed.y.toFixed(2)}`);
ok(`no frame lifted it more than a riser (${L.STEP_H} m)`, climbed.biggestRise <= L.STEP_H + 1e-6, `biggest ${climbed.biggestRise.toFixed(3)} m`);
ok("and it did not walk through the furniture or the rail", climbed.worst < 0.01, `deepest ${climbed.worst.toFixed(3)} m`);

// the player: the camera is slid by hand, one 10 cm step per call, which is
// what a frame of WASD does — nothing here is timed, so locked #53 does not
// apply. It stops at the panelling under the deck, climbs the stair, stops
// at the rail, and comes back down.
group("the player's camera stops at the panelling, climbs the stair, stops at the rail");
const slid = await page.evaluate(async () => {
  const THREE = await import("three");
  const { EYE } = await import("./js/player.js");
  const pl = window.__fq.player, cam = window.__fq.camera;
  const run = (x, z, dx, dz, n) => {
    cam.position.set(x, EYE, z); pl.slide(new THREE.Vector3(0, 0, 0));
    const ys = [cam.position.y];
    for (let i = 0; i < n; i++) { pl.slide(new THREE.Vector3(dx, 0, dz)); ys.push(cam.position.y); }
    return { x: cam.position.x, y: cam.position.y, z: cam.position.z, ys };
  };
  const out = {};
  out.panel = run(4.0, 5.0, 0.1, 0, 40);          // east into the panelling under the deck
  out.stair = run(2.0, 8.3, 0.1, 0, 60);          // east up the stair onto the deck
  out.rail = run(6.5, 8.3, 0, -0.1, 80);          // north across the deck into the rail (x 6.5 clears the (8, 4.8) table)
  out.westRail = run(7.0, 6.5, -0.1, 0, 40);      // west into the west rail
  out.down = run(6.5, 8.3, -0.1, 0, 60);          // west down the stair
  out.eye = EYE;
  return out;
});
{
  const m = L.FLAGSHIP.mezzanines[0];
  const E = slid.eye;
  ok("sliding east on the hall floor stops 0.3 m short of the panelling, at floor eye height",
    slid.panel.x <= m.x0 - 0.3 + 1e-6 && slid.panel.x > m.x0 - 0.45 && near(slid.panel.y, E), `x=${slid.panel.x.toFixed(2)} y=${slid.panel.y.toFixed(2)}`);
  ok("sliding east up the stair lands on the deck at eye height over it",
    slid.stair.x >= m.x0 + 0.5 && near(slid.stair.y, E + m.y), `x=${slid.stair.x.toFixed(2)} y=${slid.stair.y.toFixed(2)}`);
  const rises = slid.stair.ys.slice(1).map((y, i) => y - slid.stair.ys[i]);
  ok("and the eye rose 10 cm at a time, never dropped, never jumped",
    rises.every(r => r >= -1e-9 && r < 0.1), `biggest ${Math.max(...rises).toFixed(3)} m, smallest ${Math.min(...rises).toFixed(3)}`);
  ok("sliding north across the deck stops 0.3 m short of the rail, still on the deck",
    slid.rail.z >= m.z0 + 0.3 - 1e-6 && slid.rail.z < m.z0 + 0.45 && near(slid.rail.y, E + m.y), `z=${slid.rail.z.toFixed(2)} y=${slid.rail.y.toFixed(2)}`);
  ok("sliding west across the deck stops at the west rail",
    slid.westRail.x >= m.x0 + 0.3 - 1e-6 && slid.westRail.x < m.x0 + 0.45 && near(slid.westRail.y, E + m.y), `x=${slid.westRail.x.toFixed(2)}`);
  ok("and sliding west down the stair comes back to the hall floor",
    slid.down.x < m.stair.x0 && near(slid.down.y, E), `x=${slid.down.x.toFixed(2)} y=${slid.down.y.toFixed(2)}`);
}

// a server carrying to the back room specifically: the furthest stool from
// the pass is in the hall's south-west corner, so the walk above never goes
// through the doorway with a ticket in hand
group("a server carries a ticket into the back room");
await page.click("[data-warp=midtown]", { timeout: 5000 });
await page.waitForTimeout(600);
const carried = await page.evaluate(async () => {
  const THREE = await import("three");
  const w = await import("./js/world.js");
  const P = await import("./js/patrons.js");
  const L = await import("./js/layout.js");
  const desc = w.currentLayout(), a = desc.annexes[0];
  const cols = L.collidersFor(desc);
  const deep = (x, z) => {
    let d = 0;
    for (const b of cols) {
      if (x <= b.min.x || x >= b.max.x || z <= b.min.z || z >= b.max.z) continue;
      d = Math.max(d, Math.min(x - b.min.x, b.max.x - x, z - b.min.z, b.max.z - z));
    }
    return d;
  };
  const scene = new THREE.Scene();
  const target = w.seats.filter(s => s.pos.x > a.x0).reduce((p, q) => (q.pos.x > p.pos.x ? q : p));
  const sitter = new P.Patron(scene, { walkout() {}, depart() {} }, false);
  sitter.route.clear(); sitter.state = "settling"; sitter.mesh.position.copy(target.pos);
  const sv = new P.Server(scene, { readyUnclaimed: () => [], claim: () => true, deliver: () => false },
    "Check", L.crewHome(desc, 0), 2.0, "server");
  sv.ticket = { id: 1, kind: "food", itemId: "wings", patronId: sitter.id, placedAt: 0 };
  sv.state = "toPass";
  const byId = new Map([[sitter.id, sitter]]);
  let reachedPass = false, worst = 0, steps = 0, enteredAnnex = false;
  for (let k = 0; k < 8000 && !(reachedPass && sv.state === "idle"); k++) {
    const { x, z } = sv.mesh.position;
    worst = Math.max(worst, deep(x, z));
    if (x > a.x0) enteredAnnex = true;
    sv.update(1 / 60, byId);
    if (sv.state === "toPatron") reachedPass = true;
    steps = k + 1;
  }
  return { reachedPass, done: sv.state === "idle", worst, steps, enteredAnnex,
    seat: target.id, at: [+sv.mesh.position.x.toFixed(2), +sv.mesh.position.z.toFixed(2)] };
});
ok("it reached the pass and then the back room's furthest stool", carried.reachedPass && carried.done,
  `seat ${carried.seat}, ${carried.steps} steps, stopped at ${carried.at}`);
ok("it actually crossed into the back room", carried.enteredAnnex);
ok("and it did not walk through the furniture or the wall", carried.worst < 0.01, `deepest ${carried.worst.toFixed(3)} m`);

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
