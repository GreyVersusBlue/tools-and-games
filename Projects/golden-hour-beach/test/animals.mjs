// node test/animals.mjs
//
// The animal pack wired into the game (BACKLOG.md "Golden Hour: Blender
// assets" B4). test/gltf-loader.mjs proves three can read the ten files; this
// proves the game builds every creature from them and still moves each one
// the way it did. Exits non-zero on any failure (#13).
//
// Same harness and same trick as the loader test: the README served as plain
// text, rewritten with index.html's import map, so the page imports the game's
// own js/animals.js and js/wildlife.js. No renderer and no rAF: the page builds
// the wildlife into a bare Scene and steps its update() by hand at 30 fps, with
// a stand-in camera it moves next to whichever animal a group is about.
// Everything read back is off the scene graph or the mixers, because the thing
// that just happened is a pose (#39).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8165;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/golden-hour-beach/README.md`;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const group = name => console.log(`\n${name}`);
const f2 = n => (typeof n === 'number' ? n.toFixed(2) : String(n));

const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
const mapTag = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const budget = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tools', 'blender', 'budget.json'), 'utf8'));
const animalItems = Object.entries(budget.items)
  .filter(([, item]) => item.file.startsWith('assets/models/animals/')).map(([name]) => name).sort();

// How many of each the builders made, read off their loops in js/.
const COUNTS = { gull: 5, dolphin: 1, crab: 7, heron: 1, cormorant: 2, owl: 1, bat: 4, pelican: 5, seal: 3 };

const server = await serve(PORT);
const browser = await launch();
let r = null, missing = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);

  r = await page.evaluate(async () => {
    const out = {};
    let THREE, A, W, F;
    try {
      THREE = await import('three');
      A = await import('./js/animals.js');
      W = await import('./js/wildlife.js');
      F = await import('./js/field.js');
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    out.names = A.ANIMALS.slice().sort();

    let animals;
    try { animals = await A.loadAnimals(); }
    catch (e) { out.loadError = String(e && e.message || e); return out; }

    const scene = new THREE.Scene();
    const w = W.buildWildlife(scene, null, animals);
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 2, 14);
    let night = 0, T = 0;
    const step = (secs, each) => {
      const n = Math.round(secs * 30);
      for (let i = 0; i < n; i++) {
        w.update(1 / 30, cam, 0.5, 0, night, 0);
        T += 1 / 30;
        scene.updateMatrixWorld();
        if (each) each();
      }
    };
    const v = new THREE.Vector3(), fwd = new THREE.Vector3();
    // Where an object's -Z points, flat: the way every model faces (#656).
    const facing = o => {
      o.getWorldDirection(fwd);          // +Z in world for a non-camera
      fwd.negate(); fwd.y = 0; return fwd.normalize();
    };

    // -- every creature is the pack's, and nothing else of the builders' is left
    const seats = {};
    scene.traverse(o => { const m = /^(.*)-seat$/.exec(o.name); if (m) (seats[m[1]] ||= []).push(o); });
    out.seats = Object.fromEntries(Object.entries(seats).map(([k, a]) => [k, a.length]));
    out.stray = [];
    for (const list of Object.values(seats)) {
      for (const seat of list) {
        seat.parent.traverse(o => {
          if (!o.isMesh) return;
          let p = o; while (p && p !== seat) p = p.parent;
          if (!p && !out.stray.includes(seat.name)) out.stray.push(seat.name);
        });
      }
    }
    const flock = scene.getObjectByName('sanderlings');
    let src = null;
    animals.sanderling.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    out.flock = flock && {
      instanced: !!flock.isInstancedMesh, count: flock.count,
      verts: flock.geometry.attributes.position.count, srcVerts: src.geometry.attributes.position.count,
      sameMaterial: flock.material === src.material,
    };

    // -- the gulls: `fly` in the air, head first on the way in, folded on the sand
    const gulls = seats.gull.map(s => s.parent);
    const g = gulls[0], gd = g.userData;
    const q0 = gd.wingR.quaternion.clone();
    step(0.2);
    out.gullFly = { running: gd.fly.isRunning(), moved: gd.wingR.quaternion.angleTo(q0) };
    // Crumbs on the dry sand by the camp, and this gull's orbit put over them.
    const cx = F.CAMP.x - 6, cz = F.CAMP.z - 6;
    // 48 to 72 m out, inside the 80 m it notices crumbs from, so the run in
    // is long enough to read its heading on.
    gd.orbit.cx = cx; gd.orbit.cz = cz - 60; gd.orbit.r = 12;
    w.feedAt(cx, cz);
    cam.position.set(cx + 40, 2, cz + 40);
    let worst = 1, samples = 0, t = 0, inFor = 0;
    const land = { t: -1 };
    step(40, () => {
      t += 1 / 30;
      inFor = gd.mode === 'approach' ? inFor + 1 / 30 : 0;
      // A second to swing round off the orbit (turnToward eases), then held.
      if (gd.mode === 'approach' && gd.spot && inFor > 1) {
        const dx = gd.spot.x - g.position.x, dz = gd.spot.z - g.position.z, d = Math.hypot(dx, dz);
        if (d > 6) { const f = facing(g); worst = Math.min(worst, (f.x * dx + f.z * dz) / d); samples++; }
      }
      if (gd.mode === 'ground' && land.t < 0) {
        land.t = t;
        land.running = gd.fly.isRunning();
        land.wingR = gd.wingR.rotation.y; land.wingL = gd.wingL.rotation.y;
        land.base = g.position.y - A.LIFT.gull - F.groundHeight(g.position.x, g.position.z);
      }
    });
    out.gullIn = { worst, samples, land, mode: gd.mode };
    // The crumbs run out 45 s after they were thrown; the gull leaves.
    step(30);
    out.gullOut = { mode: gd.mode, running: gd.fly.isRunning() };

    // -- the pelicans: `fly` through a flap train, faded to a flat glide between
    const pel = seats.pelican.map(s => s.parent);
    cam.position.set(0, 2, 14);
    // The flock's flapClock has run since the build, as T has: a train is the
    // first 2.6 s of every 7. Step to 1.3 s into a cycle, then to 5.5.
    const toCycle = at => step(((at - (T % 7)) + 7) % 7);
    toCycle(1.3);
    const lead = pel[0].userData, wing = pel[0].getObjectByName('wingR');
    out.pelTrain = { weight: lead.fly.getEffectiveWeight(), rot: wing.quaternion.angleTo(new THREE.Quaternion()) };
    toCycle(5.5);   // gliding since 2.6
    out.pelGlide = { weight: lead.fly.getEffectiveWeight(), rot: wing.quaternion.angleTo(new THREE.Quaternion()) };

    // -- the heron: `strike` once, then back to the statue
    const heron = seats.heron[0].parent, head = heron.getObjectByName('head');
    const rest = head.position.clone();
    cam.position.set(heron.position.x + 30, 2, heron.position.z);
    // Culled until now (300 m past its radius), so its first strike is 4 s off.
    let strikeAt = -1, maxOff = 0, t2 = 0, back = null, running = null;
    step(8, () => {
      t2 += 1 / 30;
      const s = heron.userData.strike;
      if (s.isRunning() && strikeAt < 0) strikeAt = t2;
      if (strikeAt >= 0 && t2 < strikeAt + 0.5) maxOff = Math.max(maxOff, head.position.distanceTo(rest));
      // A tenth of a second after the half-second dart, well before the next
      // (7 s at the soonest).
      if (strikeAt >= 0 && back === null && t2 >= strikeAt + 0.6) {
        back = head.position.distanceTo(rest); running = s.isRunning();
      }
    });
    out.heron = { strikeAt, maxOff, loop: heron.userData.strike.loop === THREE.LoopOnce, back, running };

    // -- the cormorants: `dry`, the wings' slow half-fold
    const corm = seats.cormorant[0].parent, cw = corm.getObjectByName('wingR');
    cam.position.set(corm.position.x + 20, 2, corm.position.z);
    let lo = Infinity, hi = -Infinity;
    step(12, () => { lo = Math.min(lo, cw.scale.x); hi = Math.max(hi, cw.scale.x); });
    out.corm = { lo, hi };

    // -- the seals: `breathe`, and the head the game raises
    const seals = seats.seal.map(s => s.parent);
    cam.position.set(seals[0].position.x + 40, 2, seals[0].position.z + 10);
    const sealRoot = seals[0].getObjectByName('seal');
    const heads = seals.map(s => { const h = s.getObjectByName('head'); return { h, rest: h.position.y, max: -Infinity }; });
    let slo = Infinity, shi = -Infinity;
    step(15, () => {
      // Along (z) and up (y); x, across, holds still (#657).
      slo = Math.min(slo, sealRoot.scale.y); shi = Math.max(shi, sealRoot.scale.y);
      for (const h of heads) h.max = Math.max(h.max, h.h.position.y - h.rest);
    });
    out.seal = { slo, shi, raised: Math.max(...heads.map(h => h.max)) };

    // -- the owl: out at night, its head on the walker, its hunt on the hook
    const owl = w.owl;
    out.owlDay = owl.forceHunt(0.5);
    night = 1;
    const perch = owl.info().perches[owl.info().perch];
    cam.position.set(perch.x + 14, perch.y - 1.5, perch.z + 8);
    step(1);
    const owlObj = scene.getObjectByName('owl');
    const oh = owlObj.getObjectByName('head');
    oh.getWorldPosition(v);
    const f = facing(oh), tx = cam.position.x - v.x, tz = cam.position.z - v.z, td = Math.hypot(tx, tz);
    out.owlLook = (f.x * tx + f.z * tz) / td;
    out.owlOut = owl.info().out;
    out.owlHunt = owl.forceHunt(0.5);
    step(0.1);
    out.owlHunting = owl.info().hunting;

    // -- the bats: two wing nodes, beaten about the forward axis
    const bat = seats.bat[0].parent, bw = bat.getObjectByName('wingR');
    cam.position.set(25, 2, 55);
    let blo = Infinity, bhi = -Infinity;
    step(1, () => { blo = Math.min(blo, bw.rotation.z); bhi = Math.max(bhi, bw.rotation.z); });
    out.bat = { blo, bhi, twist: bw.rotation.x };

    // -- the crabs, at night on the wrack line: standing on the sand
    const crab = seats.crab[0];
    crab.getWorldPosition(v);
    out.crabBase = v.y - F.groundHeight(v.x, v.z);
    return out;
  });

  // A missing file, on its own page so its 404 is the only error there.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const A = await import('./js/animals.js');
    try { await A.loadAnimals(['gull', 'kittiwake']); return { resolved: true }; }
    catch (e) { return { message: String(e && e.message || e) }; }
  });
  await page2.close();

  group('the pack is what the game loads');
  ok(!r.importError, 'js/animals.js and js/wildlife.js import through the map', r.importError || '');
  ok(!r.loadError, 'loadAnimals() loads all ten', r.loadError || '');
  if (r.importError || r.loadError) throw new Error('nothing to test');
  ok(r.names.join() === animalItems.join(), 'it loads every animal budget.json names, and only those',
     `[${r.names.join(', ')}]`);
  ok(missing && !missing.resolved && /kittiwake/.test(missing.message) && /did not load/.test(missing.message),
     'a missing file rejects the load, naming the animal', missing && (missing.message || 'resolved'));

  group('every creature is built from its model');
  for (const [name, n] of Object.entries(COUNTS)) {
    ok(r.seats[name] === n, `${name}: ${n} in the scene, each seated in its builder's group`, `${r.seats[name] || 0}`);
  }
  ok(r.stray.length === 0, "no builder's mesh is left beside a model", r.stray.join(', '));
  ok(r.flock && r.flock.instanced && r.flock.count === 10 && r.flock.verts === r.flock.srcVerts && r.flock.sameMaterial,
     "sanderling: the flock's InstancedMesh draws the model's geometry and material (#659)",
     r.flock ? `${r.flock.count} birds, ${r.flock.verts} of ${r.flock.srcVerts} vertices` : 'no flock');

  group('the gulls (#661)');
  ok(r.gullFly.running && r.gullFly.moved > 0.02, '`fly` beats the wings in the air', `wingR turned ${f2(r.gullFly.moved)} rad in 0.2 s`);
  ok(r.gullIn.samples > 10 && r.gullIn.worst > 0.95, 'on the way in to the crumbs it flies head first, not wingtip first',
     `least cos to the spot ${f2(r.gullIn.worst)} over ${r.gullIn.samples} frames`);
  const L = r.gullIn.land;
  ok(L.t > 0, 'it lands at the crumbs', L.t > 0 ? `${f2(L.t)} s after they were thrown` : `still ${r.gullIn.mode}`);
  if (L.t > 0) {
    ok(!L.running && L.wingR < -1 && L.wingL > 1, 'on the sand the clip lets go and the wings fold back',
       `running ${L.running}, wingR y ${f2(L.wingR)}, wingL y ${f2(L.wingL)}`);
    ok(Math.abs(L.base) < 0.01, 'and its feet are on the sand', `base ${f2(L.base)} m off the ground`);
  }
  ok(r.gullOut.mode !== 'ground' && r.gullOut.running, 'when the crumbs are gone it leaves, flapping',
     `${r.gullOut.mode}, fly running ${r.gullOut.running}`);

  group('the pelicans (#662)');
  ok(r.pelTrain.weight > 0.9 && r.pelTrain.rot > 0.05, 'in a flap train `fly` has the wings',
     `weight ${f2(r.pelTrain.weight)}, wingR ${f2(r.pelTrain.rot)} rad off rest`);
  ok(r.pelGlide.weight < 0.05 && r.pelGlide.rot < 0.03, "between trains its weight fades out and the wings rest flat",
     `weight ${f2(r.pelGlide.weight)}, wingR ${f2(r.pelGlide.rot)} rad off rest`);

  group('the estuary');
  ok(r.heron.loop && r.heron.strikeAt > 0 && r.heron.maxOff > 0.2, "the heron's `strike` plays once and darts the head",
     `at ${f2(r.heron.strikeAt)} s, head ${f2(r.heron.maxOff)} m off rest`);
  ok(r.heron.running === false && r.heron.back !== null && r.heron.back < 0.01, 'and the head is back where it rests',
     `${f2(r.heron.back)} m off 0.6 s after, running ${r.heron.running}`);
  ok(r.corm.hi - r.corm.lo > 0.1, "the cormorant's `dry` folds and spreads the wings", `wing scale ${f2(r.corm.lo)} to ${f2(r.corm.hi)} in 12 s`);

  group('the seals');
  ok(r.seal.shi - r.seal.slo > 0.02, '`breathe` swells the body', `scale ${r.seal.slo.toFixed(3)} to ${r.seal.shi.toFixed(3)}`);
  ok(r.seal.raised > 0.15, 'and the game still raises a head', `${f2(r.seal.raised)} m over its rest`);

  group('the night');
  ok(r.owlDay === false, 'by day the owl will not hunt', JSON.stringify(r.owlDay));
  ok(r.owlOut && r.owlLook > 0.95, "at night the owl's face turns to the walker, not the back of its head",
     `cos ${f2(r.owlLook)}`);
  ok(!!r.owlHunt && r.owlHunting, 'and owlHunt(p) starts a hunt', JSON.stringify(r.owlHunt));
  ok(r.bat.bhi - r.bat.blo > 1 && Math.abs(r.bat.twist) < 1e-6, "a bat's wings beat about its forward axis (#663)",
     `wingR z ${f2(r.bat.blo)} to ${f2(r.bat.bhi)}, x ${f2(r.bat.twist)}`);
  ok(Math.abs(r.crabBase) < 0.01, "a crab's model stands on the sand", `base ${f2(r.crabBase)} m off the ground`);

  group('the page');
  ok(page.__errs.length === 0, 'no page errors or failed requests', page.__errs.join(' | '));
  ok(page.__blocked.length === 0 && page.__shimmed.length === 0, 'nothing asked for anything offsite',
     [...page.__blocked, ...page.__shimmed].join(' | '));
  await page.close();
} catch (e) {
  if (e.message !== 'nothing to test') { failed++; console.log(`  FAIL  the suite threw  ${e.stack || e}`); }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
