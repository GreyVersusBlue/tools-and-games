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
import * as L_TEX from "../js/textures.js";

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
// every texture URL the page asks for, so the tier can be checked against the wire
const texRequests = [];
page.on("request", r => { if (/\/textures\//.test(r.url())) texRequests.push(r.url().replace(/^.*\/textures\//, "textures/")); });
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

group("textures: one tier, one counted set, a line on the start overlay");
// Phase 4. deviceScaleFactor is 1 above, so pickTier() lands on 1k with no
// override; every fetch must be the 1k file, all 27 must land, and the start
// overlay's line must say so. The 2k originals stay in place for `?tex=2k`.
await page.waitForFunction(() => window.__fq && window.__fq.textures.done, null, { timeout: 30000 }).catch(() => {});
const tex = await page.evaluate(() => window.__fq.textures);
const files = L_TEX.textureFiles();
ok("the page chose the 1k tier at dpr 1", tex.tier === "1k" && (await page.evaluate(() => window.__fq.texTier)) === "1k", tex.tier);
ok(`the manager finished all ${files.length} registry files`, tex.done && tex.total === files.length && tex.loaded === files.length, JSON.stringify(tex));
ok("none of them 404ed", tex.failed === 0, `${tex.failed} failed`);
ok(`${files.length} texture requests went out, every one for a 1k file`,
  texRequests.length === files.length && texRequests.every(u => /\/1k\/[^/]+_1k\.jpg$/.test(u)), texRequests.filter(u => !/\/1k\//.test(u)).join(" "));
ok("every request is a path texturePath() produces", texRequests.every(u => files.some(f => L_TEX.texturePath(f.key, f.file, "1k") === u)));
const loadLine = await page.textContent("#loadLine");
ok(`the start overlay's line reads "Textures 27 / 27 at 1k — ready."`, loadLine === `Textures ${files.length} / ${files.length} at 1k — ready.`, loadLine);
ok("the loader recorded a duration", typeof tex.ms === "number" && tex.ms >= 0, String(tex.ms));

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
// Counted at the manager, not on the wire: with mat()'s cache deleted the
// manager reached 177 loads on the first build alone while Playwright still
// saw 27 requests, because Chromium's memory cache answers a repeated URL
// without one (#147). The manager counts every load() call.
const afterWarp = await page.evaluate(() => window.__fq.textures);
ok("three builds loaded each texture once: mat() caches the material, so a rebuild reloads nothing",
  afterWarp.loaded === L_TEX.textureFiles().length, `${afterWarp.loaded} loads`);

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

group("the league is on the corkboard, on the screens, and in the books");
// Phase 6. The previous group left the dev overlay open on Midtown; this one
// runs a real night on a Mules game night and follows the result from the
// engine to the TVs to the standings.
if (await page.isVisible("#devOverlay")) await page.click("#devClose");
if (await page.isVisible("#startOverlay")) await page.click("#startBtn");
const cork = await page.evaluate(async () => {
  const C = await import("./js/campaign.js");
  const LG = await import("./js/league.js");
  const c = window.__fq.campaign;
  C.devSetDay(c, 4); // Thursday of week 0: the Mules' first game, whatever the seed
  const tn = C.tonight(c);
  window.__fq.day.promoPanel();
  const body = document.querySelector("#panelBody");
  const out = {
    valid: LG.validLeague(c.league), season: c.league.season,
    rows: body.querySelectorAll("#standings tr").length - 1,
    usRow: body.querySelector("#standings tr.us td:nth-child(2)")?.textContent.trim() ?? null,
    names: LG.TEAMS.every(t => body.textContent.includes(t.name)),
    thisWeek: body.querySelectorAll("#thisWeek tr").length,
    tonightRow: body.querySelector("#thisWeek b")?.textContent ?? null,
    hint: body.querySelector("p.hint").textContent,
    mules: !!tn.mules, opp: tn.opp ? tn.opp.short : null, home: tn.home, label: tn.label,
    winProb: C.mulesWinProb(c),
  };
  window.__fq.day.closePanel();
  return out;
});
ok("the campaign on the page carries a valid season-1 league", cork.valid && cork.season === 1);
ok("the corkboard panel lists all eight teams in the standings", cork.rows === 8 && cork.names, `${cork.rows} rows`);
ok("the Mules' row is the lit one", /Fairview Mules/.test(cork.usRow || ""), cork.usRow);
ok("this week's four games are under it, tonight's marked", cork.thisWeek === 4 && cork.tonightRow === "tonight", `${cork.thisWeek} rows, ${cork.tonightRow}`);
ok("the panel's line names tonight's opponent", cork.mules && cork.opp && cork.hint.includes(cork.opp), cork.hint);

await page.evaluate(() => window.__fq.day.cb.openDoors());
// every wait below is on the state the loop writes, not a fixed pause: the
// HUD tick that redraws the broadcast runs every 0.12 s of a loop that a busy
// machine can starve, and a fixed 400 ms once read the halftime screen early
const settled = (fn, label) => page.waitForFunction(fn, null, { timeout: 15000 }).catch(() => { throw new Error(`timed out waiting for ${label}`); });
await settled(() => window.__fq.engine && window.__fq.broadcast && window.__fq.broadcast.gameNight, "the night to open");
// Phase 8 put moments in the night; this group's arithmetic predates them,
// so its night gets none (the last group fires its own, by hand)
await page.evaluate(() => { window.__fq.engine.momentBudget = 0; });
const opened = await page.evaluate(async () => {
  const C = await import("./js/campaign.js");
  const e = window.__fq.engine, b = window.__fq.broadcast;
  return { gameNight: e.gameNight, home: e.game.home, winProb: e.winProb, themName: b.themName, usName: b.usName, bHome: b.home,
    hudGame: !!e, forecast: C.forecast(window.__fq.campaign), crowdTarget: e.crowdTarget };
});
ok("the night engine is on a game night with the league's home flag", opened.gameNight === true && opened.home === cork.home, `home ${opened.home} vs ${cork.home}`);
ok("and the league's odds, not the 0.55 coin", Math.abs(opened.winProb - cork.winProb) < 1e-9 && opened.winProb !== 0.55, `${opened.winProb}`);
ok("the broadcast names the Mules and the opponent", opened.usName === "MULES" && opened.themName === cork.opp.toUpperCase() && opened.bHome === cork.home, `${opened.usName} / ${opened.themName}`);
ok("the crowd target is the league-aware forecast", opened.crowdTarget === opened.forecast, `${opened.crowdTarget} vs ${opened.forecast}`);

// kickoff, then halftime: the standings screen for the first third of hour 5
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 2 + 0.01; });
await settled(() => window.__fq.broadcast.started, "kickoff");
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 5 + 0.01; });
// waited for rather than read after a pause; a screen that never comes up fails the assertion after 15 s
const shown = await page.waitForFunction(() => window.__fq.broadcast.showStandings === true, null, { timeout: 15000 }).then(() => true).catch(() => false);
const half = await page.evaluate(() => { const b = window.__fq.broadcast; return { started: b.started, show: b.showStandings, rows: b.standings.length, week: b.week }; });
half.show = shown;
ok("kickoff fired and the halftime standings screen is up", half.started && half.show === true && half.rows === 8 && half.week === 0, JSON.stringify(half));
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 5 + e.hourLenSec / 3 + 1; });
await settled(() => (window.__fq.engine.t - 5 * window.__fq.engine.hourLenSec) > window.__fq.engine.hourLenSec / 3 + 0.5, "the third of the hour to pass");
await page.waitForTimeout(300); // one more HUD tick after the clock moved
ok("and it is back to the field a third of the hour later", (await page.evaluate(() => window.__fq.broadcast.showStandings)) === false);

// the final, then last call, then the books
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 6 + 0.01; });
await settled(() => window.__fq.broadcast.finished, "the final");
const fin = await page.evaluate(() => { const e = window.__fq.engine, b = window.__fq.broadcast; return { finished: b.finished, win: e.game.win, us: b.us, them: b.them }; });
ok("the final fired with a boolean result and a score that agrees with it", fin.finished && typeof fin.win === "boolean" && (fin.win ? fin.us > fin.them : fin.them > fin.us), JSON.stringify(fin));
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 8 - 0.001; });
await settled(() => document.querySelector("#boxOverlay").style.display === "flex", "the box score (2.5 s after last call)");
const books = await page.evaluate(async () => {
  const LG = await import("./js/league.js");
  const c = window.__fq.campaign;
  const g = c.league.weeks[0].find(x => x.home === LG.MULES || x.away === LG.MULES);
  return { day: c.day, played: g.played, winner: g.winner, box: document.querySelector("#boxBody").textContent,
    boxShown: document.querySelector("#boxOverlay").style.display === "flex",
    invariant: LG.allGames(c.league).every(({ g, date }) => g.played === (date < c.day)) };
});
ok("the box score is up and the books rolled to day 5", books.boxShown && books.day === 5, `day ${books.day}`);
ok("the Mules' game is in the standings with the result the room saw", books.played && (books.winner === "FVM") === fin.win, `winner ${books.winner}, engine win ${fin.win}`);
ok("the box score's game line names the opponent and the score", books.box.includes(cork.opp) && books.box.includes(`${fin.us}–${fin.them}`));
ok("the morning after holds the league's invariant", books.invariant);
ok("no page errors through a whole night", errors.length === 0, errors.join(" | "));

group("the regulars are on the corkboard, in the forecast, and in the box score");
// Phase 7. The previous group left the box score up on day 5. Take tomorrow's
// ledger, mint three regulars off the dev menu, and follow them from the
// corkboard's table to the number the door opens on to the settlement.
await page.click("#nextDayBtn");
await settled(() => document.querySelector("#boxOverlay").style.display === "none", "the day to come back");

const morning = await page.evaluate(() => ({
  rep: document.querySelector("#hRep").textContent,
  campaignRep: window.__fq.campaign.rep,
  ticker: document.querySelector("#ticker").textContent,
  rivalPanel: !!document.querySelector("#rivalPanel, [data-rival]"),
}));
// not 50: the night the previous group ran already settled and moved it, which
// is the point — the bug reads the campaign, it does not hold a number of its own
ok("the score bug carries the reputation beside cash", morning.rep === String(Math.round(morning.campaignRep)) && morning.campaignRep !== 50,
  `${morning.rep}, campaign ${morning.campaignRep}`);
ok("the morning ticker has the one line about the bar across town", /The End Zone/.test(morning.ticker), morning.ticker.slice(0, 120));
ok("and there is no rival panel anywhere on the page", !morning.rivalPanel);

const board = await page.evaluate(async () => {
  const C = await import("./js/campaign.js");
  const RG = await import("./js/regulars.js");
  const LG = await import("./js/league.js");
  const c = window.__fq.campaign;
  // a deterministic namer, so the assertions below can quote the roster
  let s = 424242;
  const rand = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 3; i++) C.devAddRegular(c, rand);
  const inTonight = C.regularsIn(c);
  window.__fq.day.promoPanel();
  const body = document.querySelector("#panelBody");
  const cells = [...body.querySelectorAll("#regulars tr")].slice(1).map(tr => [...tr.children].map(td => td.textContent.trim()));
  window.__fq.day.closePanel();
  window.__fq.day.doorPanel();
  const door = document.querySelector("#panelBody").textContent;
  window.__fq.day.closePanel();
  return {
    roster: c.regulars.map(r => ({ name: r.name, usual: RG.usualName(r), team: LG.teamDef(r.team).short, loyalty: r.loyalty })),
    inTonight: inTonight.map(r => r.name),
    cells, door, forecast: C.forecast(c), cap: C.regularCap(c),
    // Asked twenty times, not twice. Node's suite proves dayRoll() is a
    // function of the day; this proves the page calls it and not a coin, and
    // two calls do not: three regulars at ~0.82 each agree by luck about half
    // the time, so a `Math.random()` in showsTonight() sat green here while
    // smoke-regulars.mjs caught it (#147 — the comment has to be a claim the
    // arithmetic can actually distinguish).
    againIn: Array.from({ length: 20 }, () => C.regularsIn(c).map(r => r.name).join()),
  };
});
// the earlier groups warped the room up the ladder, so the cap is that room's
ok("three regulars are on the roster, inside this room's cap", board.roster.length === 3 && board.cap >= 3, `cap ${board.cap}`);
ok("the corkboard's table has a row each, with the name, the usual, the team and the loyalty",
  board.cells.length === 3 && board.cells.every((row, i) =>
    row[0] === board.roster[i].name && row[1] === board.roster[i].usual &&
    row[2] === board.roster[i].team && row[3] === String(board.roster[i].loyalty)),
  JSON.stringify(board.cells));
ok("the ones in tonight are marked, and only those",
  board.cells.filter(r => r[4].includes("in tonight")).map(r => r[0]).join() === board.inTonight.join(),
  `${board.cells.filter(r => r[4]).length} marked, ${board.inTonight.length} in`);
ok("the Tonight panel prints the reputation and how many are expected",
  /Reputation/.test(board.door) && board.door.includes(`${board.inTonight.length} of ${board.roster.length} expected tonight`), board.door.slice(0, 200));
ok("asking who is in tonight twenty times gives the same answer every time",
  board.againIn.every(a => a === board.inTonight.join()), `${new Set(board.againIn).size} distinct answers`);

// open the doors and run the night straight to the box score
await page.evaluate(() => window.__fq.day.cb.openDoors());
await settled(() => window.__fq.engine, "the second night to open");
await page.evaluate(() => { window.__fq.engine.momentBudget = 0; }); // as above: the loyalty sums below are the regulars' alone
const target = await page.evaluate(() => window.__fq.engine.crowdTarget);
ok("the crowd the door opens on is the forecast the corkboard printed", target === board.forecast, `${target} vs ${board.forecast}`);

group("a regular is a person on the floor");
// Phase 7, increment 2. The night is open with three regulars on the roster
// and the day's coin says who is in. Stock every shelf, then move the clock
// to the hour the first one is due and watch them come through the door as a
// body: a nameplate, a stool at the bar, the usual on the ticket, and the
// boss walking up to put the first round on the house.
// the settle-then-decide timers are 3.5-12.5 sim seconds; the canvas sits over the button, so click it from inside the page
await page.evaluate(() => document.querySelector('[data-speed="2"]').click());
const roster = await page.evaluate(async () => {
  const C = await import("./js/campaign.js");
  const { FOOD } = await import("./js/engine.js");
  const c = window.__fq.campaign;
  for (const id of FOOD) c.stock[id] = 60;
  return { inTonight: C.regularsIn(c).map(r => ({ id: r.id, name: r.name, usual: r.usual, loyalty: r.loyalty })), engineRegs: window.__fq.engine.regulars.map(r => r.id) };
});
ok("the engine was handed tonight's list, the day's coin's list", roster.engineRegs.join() === roster.inTonight.map(r => r.id).join(), `${roster.engineRegs.length} handed`);
const first = roster.inTonight[0];
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 1 + 0.01; });
await settled(() => window.__fq.patrons.some(p => p.regular), "the first regular to come through the door");
const arrived = await page.evaluate(() => {
  const e = window.__fq.engine;
  const p = window.__fq.patrons.find(p => p.regular);
  return { name: p.regular.name, id: p.regular.id, seatKind: p.seat && p.seat.kind, nameplate: p.mesh.children.some(m => m.name === "nameplate"),
    plates: window.__fq.patrons.filter(q => q.mesh.children.some(m => m.name === "nameplate")).length,
    regs: window.__fq.patrons.filter(q => q.regular).length,
    inBar: e.inBar, bodies: window.__fq.patrons.filter(q => q.state !== "gone" && q.state !== "leaving").length,
    seated: e.regularsSeated.slice(), ticker: document.querySelector("#ticker").textContent };
});
ok("the first name on the list is the one who came in at hour 1", arrived.name === first.name && arrived.regs === 1, `${arrived.name} vs ${first.name}`);
ok("they wear a nameplate, and nobody else does", arrived.nameplate && arrived.plates === 1, `${arrived.plates} plates`);
// luck-sensitive on purpose: with the preference removed a random open
// stool is a bar stool about a quarter of the time in this room
ok("they took a stool at the bar", arrived.seatKind === "bar", `kind ${arrived.seatKind}`);
ok("they came through the door as a spawn: the engine's headcount is the bodies in the room", arrived.inBar === arrived.bodies && arrived.seated.join() === first.id, `inBar ${arrived.inBar}, bodies ${arrived.bodies}`);
ok("the ticker says they're in", arrived.ticker.includes(`${first.name.split(" ")[0]}'s in`), arrived.ticker.slice(-120));

// the usual, pre-filled on the ticket
// a walk across a big room and two timers, under a software renderer whose
// frames cap the sim at 0.05 s each: two minutes, not the usual fifteen seconds
const patient = (fn, label) => page.waitForFunction(fn, null, { timeout: 120000 }).catch(() => { throw new Error(`timed out waiting for ${label}`); });
await patient(() => window.__fq.patrons.find(p => p.regular).ticket, "the regular to order");
const usual = await page.evaluate(async () => {
  const { MENU } = await import("./js/engine.js");
  const p = window.__fq.patrons.find(p => p.regular);
  return { item: p.ticket.itemId, usual: p.regular.usual, regularId: p.ticket.regularId, price: p.ticket.price, shelf: MENU[p.regular.usual].price, snubbed: p.snubbed };
});
// also luck-sensitive: chooseOrder() lands on the usual about a quarter of
// the time, so a broken pre-fill passes here one run in four — the Node
// suite's usualFor() assertions are the ones that cannot
ok("the ticket is the usual, at the shelf price, with the regular's id on it",
  usual.item === usual.usual && usual.regularId === first.id && usual.price === usual.shelf && !usual.snubbed, JSON.stringify(usual));

// the boss walks up: the prompt offers the round, E comps it, a second E does not
const comp = await page.evaluate(() => {
  const p = window.__fq.patrons.find(p => p.regular);
  const cam = window.__fq.camera, pl = window.__fq.player;
  cam.position.set(p.pos.x + 0.4, p.pos.y + 1.62, p.pos.z + 0.4);
  const prompt = pl.promptText(window.__fq.patronsById);
  const r1 = pl.tryInteract(window.__fq.scene, window.__fq.patronsById);
  const after = { price: p.ticket.price, comped: p.ticket.comped, set: [...window.__fq.engine.comped] };
  const r2 = pl.tryInteract(window.__fq.scene, window.__fq.patronsById);
  const promptAfter = pl.promptText(window.__fq.patronsById);
  // a second E falls through to whatever else is in reach — a stool by the
  // drink pass gets "Nothing on the bar yet", one further along gets nothing
  // — so what is asserted is that it did not comp anything, not what it said
  const after2 = { set: [...window.__fq.engine.comped], price: p.ticket.price };
  return { prompt, r1, after, r2, after2, promptAfter, revenue: window.__fq.engine.revenue };
});
ok("standing at the regular, the prompt offers their first round on the house, priced", /first round on the house \(\$\d+/.test(comp.prompt), comp.prompt);
ok("E puts it on the house: the ticket rings at $0 and the engine records who", comp.r1 && comp.r1.good && /on the house/.test(comp.r1.msg) && comp.after.price === 0 && comp.after.comped && comp.after.set.join() === first.id, JSON.stringify(comp.after));
ok("a second E comps nothing, and the prompt no longer offers it",
  !(comp.r2 && /on the house/.test(comp.r2.msg)) && comp.after2.set.join() === first.id && comp.after2.price === 0 && !/on the house/.test(comp.promptAfter),
  `${JSON.stringify(comp.r2)} / ${comp.promptAfter}`);

// now 86 their usual for the books: the settlement charges the 8 off the shelf
// at close, and gives the 4 back for the round — the two numbers the floor and
// the books each own, on one person
const second = roster.inTonight[1] || null;
await page.evaluate(({ first, second }) => {
  const c = window.__fq.campaign;
  c.stock[first.usual] = 0;
  if (second) c.stock[second.usual] = 0; // the second regular finds theirs gone at the door
}, { first, second });
ok("a second regular is in tonight, so the snub can be watched on the floor", !!second, second ? second.name : "only one in");
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 2 + 0.01; });
await settled(() => window.__fq.patrons.filter(p => p.regular).length >= 2, "the second regular to come in at hour 2");
await patient(() => window.__fq.patrons.filter(p => p.regular)[1].ticket || window.__fq.patrons.filter(p => p.regular)[1].state === "leaving", "the second regular to order");
// the snub's ticker line is an engine event, handed out on the update after the order
// waited for as an assertion, not a throw: a snub line that never arrives
// (written to the engine's log instead of queued as an event) is a FAIL that
// names itself, and the run goes on to the books
const sawSnubLine = await page.waitForFunction(() => /came in for the .* and you're out/.test(document.querySelector("#ticker").textContent), null, { timeout: 30000 }).then(() => true).catch(() => false);
ok("the snub's ticker line arrives on the update after the order", sawSnubLine);
const snub = await page.evaluate(() => {
  const p = window.__fq.patrons.filter(p => p.regular)[1];
  return { name: p.regular.name, usual: p.regular.usual, item: p.ticket && p.ticket.itemId, snubbed: p.snubbed, engine: [...window.__fq.engine.snubbed],
    ticker: document.querySelector("#ticker").textContent };
});
ok("they came in for the usual, found it 86'd, and ordered something else", second && snub.name === second.name && snub.snubbed && snub.item && snub.item !== snub.usual, JSON.stringify(snub));
ok("the engine recorded the snub and the ticker said so", snub.engine.join() === (second && second.id) && /came in for the .* and you're out/.test(snub.ticker), snub.ticker.slice(-140));
// restock the second one's usual, so the books charge only the first — unless
// the two share a usual, in which case the shelf is bare for both at close
const sameUsual = !!second && second.usual === first.usual;
await page.evaluate(({ second, sameUsual }) => { if (second && !sameUsual) window.__fq.campaign.stock[second.usual] = 60; }, { second, sameUsual });
await page.evaluate(() => document.querySelector('[data-speed="1"]').click());

await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 8 - 0.001; });
await settled(() => document.querySelector("#boxOverlay").style.display === "flex", "the second box score");
// the score bug is redrawn by the loop's 0.12 s HUD tick, not by showBoxScore(),
// so wait for the tick rather than reading the number the settlement replaced
await settled(() => document.querySelector("#hRep").textContent === String(Math.round(window.__fq.campaign.rep)), "the HUD tick after settlement");
const after = await page.evaluate(() => {
  const c = window.__fq.campaign;
  return { box: document.querySelector("#boxBody").textContent, rep: c.rep, bug: document.querySelector("#hRep").textContent,
    roster: c.regulars.map(r => ({ name: r.name, loyalty: r.loyalty })) };
});
const fRow = after.roster.find(r => r.name === first.name);
const sRow = second && after.roster.find(r => r.name === second.name);
ok("the box score has a section on the room's people with the reputation move", /The Room's People/.test(after.box) && /Reputation/.test(after.box));
ok("it names who was in tonight", board.inTonight.every(n => after.box.includes(n)), board.inTonight.join(", "));
ok("and names the one who came in for the usual and found you out", after.box.includes("and you were out") && after.box.includes(first.name));
ok("and the one whose first round was on the house", /First round on the house/.test(after.box) && after.box.includes(first.name));
ok("that regular lost 8 for the 86 and got 4 back for the round: down 4", fRow && first.loyalty - fRow.loyalty === 4, `${first.loyalty} → ${fRow && fRow.loyalty}`);
ok(sameUsual ? "the snubbed one shares the usual, so the books charge them the 8 too" : "the snubbed one, restocked before close, is up the good night's 3 and no more",
  sRow && sRow.loyalty - second.loyalty === (sameUsual ? -8 : 3), `${second && second.loyalty} → ${sRow && sRow.loyalty}`);
ok("the score bug's reputation is the campaign's after settlement", after.bug === String(Math.round(after.rep)), `${after.bug} vs ${after.rep}`);
ok("no page errors through the second night", errors.length === 0, errors.join(" | "));


group("the night has moments");
// Phase 8. A third night, with the cards fired by hand off the dev menu
// rather than waited on: a person who walks in from the door (the
// inspector), a lit prop (the tap), a card that clears bodies out (the
// rowdy fans), and one left unanswered at last call. The sim keeps running
// under the panel, and the books settle what the floor reports.
await page.click("#nextDayBtn");
await settled(() => document.querySelector("#boxOverlay").style.display === "none", "the third day to come back");
const cdBefore = await page.evaluate(() => JSON.stringify(window.__fq.campaign.eventCd));
ok("the campaign's cooldown record is empty after two nights with no moments", cdBefore === "{}", cdBefore);
await page.evaluate(async () => {
  const { MENU } = await import("./js/engine.js");
  for (const id in MENU) window.__fq.campaign.stock[id] = 60;
  window.__fq.day.cb.openDoors();
});
await settled(() => window.__fq.engine, "the third night to open");
const opened3 = await page.evaluate(() => {
  const e = window.__fq.engine;
  return { budget: e.momentBudget, roll: typeof e.momentRoll, viewRep: e.view().rep, rep: window.__fq.campaign.rep, viewKeys: Object.keys(e.view()).sort().join(), moment: e.moment, day: window.__fq.campaign.day };
});
ok("the engine opened with a moments budget off the chaos roll and the books' view", opened3.budget >= 0 && opened3.budget <= 3 && opened3.roll === "function" && opened3.viewRep === opened3.rep && opened3.moment === null, JSON.stringify(opened3));
ok("the view carries the books' half and the floor's", /buzz/.test(opened3.viewKeys) && /regularsIn/.test(opened3.viewKeys) && /crowd/.test(opened3.viewKeys) && /flags/.test(opened3.viewKeys) && /budget/.test(opened3.viewKeys), opened3.viewKeys);
// the coin is not this group's: no card of its own, so every card below is the one fired by hand
await page.evaluate(() => { window.__fq.engine.momentBudget = 0; });

/** Fire a card the way a developer would: the dev menu's select and button. */
const fire = id => page.evaluate(id => {
  window.__fq.dev.open();
  document.querySelector("#devMoment").value = id;
  document.querySelector("[data-firemoment]").click();
  return { open: window.__fq.dev.isOpen(), pending: window.__fq.engine.moment && window.__fq.engine.moment.event.id };
}, id);

// 1. the inspector: a person, from the door to the kitchen pass
await page.evaluate(() => { window.__fq.campaign.stock.wings = 500; }); // a walk-in the inspector will not like
const insp = await fire("inspect");
ok("the dev menu fires a card and closes: the engine has a pending moment", !insp.open && insp.pending === "inspect", JSON.stringify(insp));
const inspFloor = await page.evaluate(async () => {
  const w = await import("./js/world.js");
  const m = window.__fq.moment;
  return { has: !!m, who: m && m.who, plate: m && m.mesh.children.some(x => x.name === "nameplate"), marker: m && m.mesh.children.some(x => x.geometry && x.geometry.type === "ConeGeometry"),
    ring: window.__fq.scene.children.some(x => x.name === "momentRing"), atDoor: m && Math.hypot(m.pos.x - w.DOOR.x, m.pos.z - w.DOOR.z) < 1,
    anchor: m && { x: m.anchor.x, z: m.anchor.z }, passFood: { x: w.PASS_FOOD.x, z: w.PASS_FOOD.z },
    ticker: document.querySelector("#ticker").textContent, fired: window.__fq.engine.view().fired.join() };
});
ok("the inspector is a person on the floor: a name over the head, a marker, a lit ring, in from the door", inspFloor.has && inspFloor.who === "Inspector" && inspFloor.plate && inspFloor.marker && inspFloor.ring && inspFloor.atDoor, JSON.stringify(inspFloor));
ok("the card's anchor is the kitchen pass, the description's stand-point", inspFloor.anchor && near(inspFloor.anchor.x, inspFloor.passFood.x) && near(inspFloor.anchor.z, inspFloor.passFood.z), JSON.stringify(inspFloor.anchor));
ok("the ticker announced it and the engine counts it as fired", /⚠ Health Inspector!/.test(inspFloor.ticker) && inspFloor.fired === "inspect", inspFloor.fired);
await page.evaluate(() => document.querySelector('[data-speed="2"]').click());
await patient(() => window.__fq.moment && window.__fq.moment.arrived, "the inspector to reach the pass");
const inspArrived = await page.evaluate(() => { const m = window.__fq.moment; return { d: Math.hypot(m.pos.x - m.anchor.x, m.pos.z - m.anchor.z) }; });
ok("they walk to the anchor and stand there", inspArrived.d < 0.5, `${inspArrived.d.toFixed(2)} m off`);
// the boss walks up: the prompt names the card, E opens the panel, the sim runs on under it
await page.evaluate(() => { const m = window.__fq.moment, cam = window.__fq.camera; cam.position.set(m.pos.x + 0.5, m.pos.y + 1.62, m.pos.z + 0.5); });
await settled(() => document.querySelector("#prompt").textContent === "E — Health Inspector", "the prompt to name the card");
ok("standing at the inspector, the prompt is the card, ahead of the pass behind them", true);
const panel = await page.evaluate(() => {
  window.__fq.player.onInteract();
  const t0 = window.__fq.engine.t;
  return new Promise(res => setTimeout(() => res({
    open: window.__fq.day.panelOpen(), momentOpen: window.__fq.day.momentOpen, title: document.querySelector("#panelTitle").textContent,
    body: document.querySelector("#panelBody").textContent, buttons: [...document.querySelectorAll("[data-moment]")].map(b => b.textContent.trim()),
    ran: window.__fq.engine.t - t0, pointer: !!document.pointerLockElement, prompt: document.querySelector("#prompt").textContent,
  }), 600));
});
ok("E opens the card as the management panel: title, body, one button per choice", panel.open && panel.momentOpen && panel.title === "Health Inspector" && /clipboard/.test(panel.body) && panel.buttons.length === 1 && /Open the kitchen/.test(panel.buttons[0]), JSON.stringify(panel.buttons));
// any advance at all is the claim: a sim paused under the panel reads
// exactly 0, and the software renderer's few frames a second make the
// amount itself meaningless (#53)
ok("and the sim kept running while it was up", panel.ran > 0, `${panel.ran.toFixed(2)} sim seconds in 0.6 real`);
ok("the prompt is blank under a panel", panel.prompt === "");
const answered = await page.evaluate(() => {
  const e = window.__fq.engine;
  const before = { net: e.eventNet, rep: e.eventRep, cash: document.querySelector("#hCash").textContent };
  // guarded: with the E priority or the button's wiring broken there is no
  // button, and a null click crashed the run where the next line should fail
  const btn = document.querySelector("[data-moment='0']");
  if (btn) btn.click();
  return { before, open: window.__fq.day.panelOpen(), pending: e.moment, net: e.eventNet, rep: e.eventRep, resolved: e.moments.map(m => `${m.id}:${m.choice}:${m.auto}`).join(),
    floor: !!window.__fq.moment, leaving: window.__fq.leavingMoments.length, ring: window.__fq.scene.children.some(x => x.name === "momentRing"),
    ticker: document.querySelector("#ticker").textContent };
});
ok("the button answers it: the panel closes, the moment is resolved, once, by the boss", !answered.open && answered.pending === null && answered.resolved === "inspect:0:false", answered.resolved);
ok("an overstocked walk-in fails the inspection: $200 into the night's ledger and 5 off your name, carried for the books", answered.before.net === 0 && answered.net === -200 && answered.rep === -5, `${answered.net} / ${answered.rep}`);
ok("the choice's line is on the ticker", /Inspector flags aging stock/.test(answered.ticker), answered.ticker.slice(-120));
ok("the ring is gone and the inspector is walking out", !answered.floor && !answered.ring && answered.leaving === 1);
await patient(() => window.__fq.leavingMoments.length === 0, "the inspector to be gone out the door");
const cashLine = await page.evaluate(() => ({ hud: document.querySelector("#hCash").textContent, expect: "$" + Math.round(window.__fq.campaign.cash + window.__fq.engine.revenue + window.__fq.engine.tips + window.__fq.engine.eventNet) }));
ok("the score bug's cash carries the $200", cashLine.hud === cashLine.expect, `${cashLine.hud} vs ${cashLine.expect}`);

// 2. the tap: a lit prop at the tap station, and a flag the engine reads
const tap = await fire("tap");
const tapFloor = await page.evaluate(async () => {
  const w = await import("./js/world.js");
  const m = window.__fq.moment;
  return { pending: window.__fq.engine.moment.event.id, who: m.who, plate: m.mesh.children.some(x => x.name === "nameplate"), arrived: m.arrived,
    atTap: Math.hypot(m.pos.x - w.TAP_STATION.x, m.pos.z - w.TAP_STATION.z) < 0.01, ring: window.__fq.scene.children.some(x => x.name === "momentRing") };
});
ok("the blown tap is a lit prop at the tap station: no person, no name, already there", tap.pending === "tap" && tapFloor.who === null && !tapFloor.plate && tapFloor.arrived && tapFloor.atTap && tapFloor.ring, JSON.stringify(tapFloor));
const tapOut = await page.evaluate(() => {
  const e = window.__fq.engine;
  const beerBefore = e.inStock("beer");
  window.__fq.openMomentPanel();
  const labels = [...document.querySelectorAll("[data-moment]")].map(b => b.textContent.trim());
  document.querySelector("[data-moment='1']").click();
  return { beerBefore, labels, tapBroken: e.flags.tapBroken, beerAfter: e.inStock("beer"), stockBeer: e.stock.beer, resolved: e.moments.map(m => m.id).join(), floor: !!window.__fq.moment, ticker: document.querySelector("#ticker").textContent };
});
ok("the panel prices the repair off the upgrades, and leaving it sets the night flag", /\$120/.test(tapOut.labels[0]) && tapOut.tapBroken === true && tapOut.resolved === "inspect,tap", JSON.stringify(tapOut.labels));
ok("with the line dead the beer is 86'd though the kegs are full", tapOut.beerBefore && !tapOut.beerAfter && tapOut.stockBeer > 0, `stock ${tapOut.stockBeer}`);
ok("a prop is gone the moment it is answered", !tapOut.floor && /Taps are dead/.test(tapOut.ticker));

// 3. the rowdy fans: bodies leave now, on the card's word
await page.evaluate(() => { const e = window.__fq.engine; if (e.t < e.hourLenSec * 2) e.t = e.hourLenSec * 2 + 0.01; });
await patient(() => window.__fq.patrons.filter(p => ["settling", "deciding", "waiting", "consuming"].includes(p.state)).length >= 8, "eight bodies seated");
const rowdy = await fire("rowdy");
const cleared = await page.evaluate(() => {
  const e = window.__fq.engine;
  const seated = () => window.__fq.patrons.filter(p => ["settling", "deciding", "waiting", "consuming"].includes(p.state)).length;
  const before = { inBar: e.inBar, seated: seated(), walkouts: e.walkouts };
  window.__fq.openMomentPanel();
  document.querySelector("[data-moment='0']").click();
  return { before, inBar: e.inBar, seated: seated(), walkouts: e.walkouts, rep: e.eventRep, resolved: e.moments.map(m => m.id).join() };
});
ok("showing them the door clears six bodies: the headcount and the seats both drop by six, and nobody is a walkout", rowdy.pending === "rowdy" && cleared.before.inBar - cleared.inBar === 6 && cleared.before.seated - cleared.seated === 6 && cleared.walkouts === cleared.before.walkouts, JSON.stringify(cleared));
ok("and the rep is up 2 on the night, net -3 with the inspector's", cleared.rep === -3 && cleared.resolved === "inspect,tap,rowdy", `${cleared.rep}`);

// 4. the legend, unanswered at last call: the first option, marked
const hero = await fire("hero");
ok("a fourth card is on the floor, waiting", hero.pending === "hero");
await page.evaluate(() => document.querySelector('[data-speed="1"]').click());
const dayOfNight = await page.evaluate(() => window.__fq.campaign.day);
await page.evaluate(() => { const e = window.__fq.engine; e.t = e.hourLenSec * 8 - 0.001; });
await settled(() => document.querySelector("#boxOverlay").style.display === "flex", "the third box score");
const books3 = await page.evaluate(() => {
  const c = window.__fq.campaign, e = window.__fq.engine;
  return { box: document.querySelector("#boxBody").textContent, resolved: e.moments.map(m => `${m.id}:${m.choice}:${m.auto}`).join(), net: e.eventNet,
    cd: c.eventCd, day: c.day, floor: !!window.__fq.moment, ring: window.__fq.scene.children.some(x => x.name === "momentRing"), total: e.summary().total, take: e.summary().revenue + e.summary().tips };
});
ok("last call resolved the legend to its first option and said nobody chose", books3.resolved === "inspect:0:false,tap:1:false,rowdy:0:false,hero:0:true", books3.resolved);
ok("its $40 round is in the ledger: -$240 for the night, and the take carries it", books3.net === -240 && Math.abs(books3.total - (books3.take - 240)) <= 1, `${books3.net}, total ${books3.total}`);
ok("the floor is clear at close", !books3.floor && !books3.ring);
ok("the box score has a section on the night's moments, each card by name, the unanswered one marked",
  /The Night's Moments/.test(books3.box) && /Health Inspector/.test(books3.box) && /Keg Tap Blows/.test(books3.box) && /Rival Fans Get Loud/.test(books3.box) && /A Legend Walks In/.test(books3.box) && /ran its course/.test(books3.box) && /−\$240/.test(books3.box),
  books3.box.slice(books3.box.indexOf("The Night's Moments"), books3.box.indexOf("The Night's Moments") + 200));
ok("every card that fired is on cooldown from the night it fired: 7, 4, 2 and 5 nights",
  books3.cd.inspect === dayOfNight + 7 && books3.cd.tap === dayOfNight + 4 && books3.cd.rowdy === dayOfNight + 2 && books3.cd.hero === dayOfNight + 5 && Object.keys(books3.cd).length === 4, JSON.stringify(books3.cd));
ok("and the record is in the save on disk", await page.evaluate(() => { const c = JSON.parse(localStorage.getItem("fq3d-save")); return !!(c && c.eventCd && c.eventCd.inspect); }));
ok("no page errors through a night of moments", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
