// node test/animals.mjs
//
// The animal pack wired into the game (BACKLOG.md "Blue Hour: Blender assets"
// B4). test/gltf-loader.mjs proves three can read the six files; this proves
// the game builds every creature from them and still moves each one the way it
// did. Exits non-zero on any failure (#13).
//
// Blue Hour's own copy of Golden Hour's test/animals.mjs, not an import of it
// (#17). Port 8166; 8165 is Golden Hour's.
//
// Same harness and same trick as the loader test: the README served as plain
// text, rewritten with index.html's import map, so the page imports the game's
// own js/animals.js and js/wildlife.js. No renderer and no rAF: the page builds
// the wildlife into a bare Scene and steps its update() by hand at 30 fps, with
// a stand-in walker it moves next to whichever animal a group is about.
// Everything read back is off the scene graph or the mixers, because the thing
// that just happened is a pose (#39). Which way a model faces is read off the
// model's own -Z, the way every file faces (#675), never off TURN.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8166; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/blue-hour-trail/README.md`;

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

// How many of each the builders made, read off their loops in js/wildlife.js.
const COUNTS = { deer: 3, 'small-bird': 7, crow: 3, squirrel: 1, owl: 1, fox: 1 };

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
    const hush = () => {};
    const audio = { rustle: hush, deerThump: hush, bird: hush, crowCaw: hush, owlHoot: hush, elkBugle: hush };
    const w = W.buildWildlife(scene, audio, animals);
    const S = w.animals;
    const controls = { pos: new THREE.Vector3(9000, 0, 9000), enabled: true };
    const walker = (x, z) => controls.pos.set(x, 0, z);
    const step = (secs, each) => {
      const n = Math.round(secs * 30);
      for (let i = 0; i < n; i++) {
        w.update(1 / 30, null, controls, 0);
        scene.updateMatrixWorld();
        if (each) each();
      }
    };
    const v = new THREE.Vector3(), fwd = new THREE.Vector3(), box = new THREE.Box3();
    // Where a model's -Z points: the way every file faces (#675).
    const nose = o => { o.getWorldDirection(fwd); return fwd.negate(); };
    const flatNose = o => { nose(o); fwd.y = 0; return fwd.normalize(); };
    const modelOf = g => g.children.find(c => /-seat$/.test(c.name)).children[0];
    const base = g => { box.setFromObject(g, true); return box.min.y; };
    // Least cosine between a group's model's nose and the way it actually
    // moved over the frame, flat, sampled while it moves at least 5 cm.
    const heading = (g, secs, when = () => true) => {
      const last = g.position.clone();
      let worst = 1, samples = 0;
      step(secs, () => {
        const dx = g.position.x - last.x, dz = g.position.z - last.z, d = Math.hypot(dx, dz);
        if (d > 0.05 && g.visible && when()) {
          const f = flatNose(modelOf(g));
          worst = Math.min(worst, (f.x * dx + f.z * dz) / d); samples++;
        }
        last.copy(g.position);
      });
      return { worst, samples };
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

    // -- the deer: `graze` head down, the game's pose for alert, back to graze
    const d0 = S.deer[0], dg = d0.g, dhead = dg.userData.head;
    // The largest swing off where it started, over a quarter of the 15.7 s
    // nod: at least 0.036 rad from any phase, where start against end can
    // read zero across the sine's crest.
    const q0 = dhead.quaternion.clone();
    let moved = 0;
    step(4, () => { moved = Math.max(moved, dhead.quaternion.angleTo(q0)); });
    out.graze = {
      state: d0.state, running: dg.userData.graze.isRunning(),
      moved, noseY: nose(dhead).y,
      base: base(dg) - F.groundHeight(dg.position.x, dg.position.z),
    };
    walker(dg.position.x + 20, dg.position.z + 2);
    step(0.2);
    const dm = flatNose(modelOf(dg)).clone();
    const tx = controls.pos.x - dg.position.x, tz = controls.pos.z - dg.position.z, td = Math.hypot(tx, tz);
    out.alert = {
      state: d0.state, running: dg.userData.graze.isRunning(), noseY: nose(dhead).y,
      rot: dhead.rotation.x, face: (dm.x * tx + dm.z * tz) / td,
    };
    walker(dg.position.x + 40, dg.position.z);
    step(0.2);
    out.regraze = { state: d0.state, running: dg.userData.graze.isRunning() };
    walker(9000, 9000);

    // -- the crows: one each way round, head first, `fly` beating the wings
    S.crows[0].orbit.dir = 1;
    S.crows[1].orbit.dir = -1;
    const cg = S.crows[0].g, cw = cg.getObjectByName('wingR');
    // Largest swing over 0.5 s: at the slowest crow's 4.4 rad/s that is 2.2
    // rad of phase, and the least it can read from any start is 0.5 x (1 -
    // cos 1.1) = 0.27 rad, a window straddling the crest. 0.1 s read 0.02.
    const cq = cw.quaternion.clone();
    let cmoved = 0;
    step(0.5, () => { cmoved = Math.max(cmoved, cw.quaternion.angleTo(cq)); });
    out.crowFly = { running: cg.userData.fly.isRunning(), moved: cmoved };
    v.setFromMatrixScale(modelOf(cg).matrixWorld);
    out.crowScale = Math.max(v.x, v.y, v.z);
    out.crowCW = heading(S.crows[0].g, 4);
    out.crowCCW = heading(S.crows[1].g, 4);

    // -- a small bird: flies head first to a new perch, its wings about the forward axis
    const b0 = S.birds[0], bg = b0.g, bw = bg.userData.wingR;
    walker(bg.position.x, bg.position.z);
    b0.timer = 0;
    let zlo = Infinity, zhi = -Infinity, twist = 0, flew = false;
    const birdHeading = heading(bg, 3, () => {
      if (b0.state !== 'fly') return false;
      flew = true;
      zlo = Math.min(zlo, bw.rotation.z); zhi = Math.max(zhi, bw.rotation.z);
      twist = Math.max(twist, Math.abs(bw.rotation.x));
      return true;
    });
    out.bird = { flew, zlo, zhi, twist, ...birdHeading };

    // -- the owl: its face on the walker, not the back of its head; then away
    const owl = scene.getObjectByName('owl-seat').parent, oh = owl.userData.head;
    walker(owl.position.x + 12, owl.position.z + 9);
    step(0.2);
    oh.getWorldPosition(v);
    const of = flatNose(oh), ox = controls.pos.x - v.x, oz = controls.pos.z - v.z, od = Math.hypot(ox, oz);
    out.owlLook = (of.x * ox + of.z * oz) / od;
    walker(owl.position.x + 3, owl.position.z + 1);
    step(0.1);
    out.owlFled = S.owl.fled;
    out.owlAway = heading(owl, 2);
    walker(9000, 9000);

    // -- the fox: crosses the trail nose first
    const fox = scene.getObjectByName('fox-seat').parent;
    const p = F.trailPoint(0.4);
    walker(p.x, p.z);
    S.fox.timer = 0;
    step(0.1);
    out.foxActive = S.fox.active;
    out.fox = heading(fox, 2);

    // -- the squirrel: on the trail edge ahead, standing on its feet (#676)
    const sq = S.sq, sg = sq.g;
    const p2 = F.trailPoint(0.2);
    walker(p2.x, p2.z);
    sq.timer = 0;
    step(1 / 30);
    let lowest = Infinity, frames = 0;
    step(3, () => {
      if (sq.state !== 'ground') return;
      frames++;
      lowest = Math.min(lowest, base(sg) - F.groundHeight(sg.position.x, sg.position.z));
    });
    out.squirrel = { lowest, frames, visible: sg.visible };
    return out;
  });

  // A missing file, on its own page so its 404 is the only error there.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const A = await import('./js/animals.js');
    try { await A.loadAnimals(['crow', 'elk']); return { resolved: true }; }
    catch (e) { return { message: String(e && e.message || e) }; }
  });
  await page2.close();

  group('the pack is what the game loads');
  ok(!r.importError, 'js/animals.js and js/wildlife.js import through the map', r.importError || '');
  ok(!r.loadError, 'loadAnimals() loads all six', r.loadError || '');
  if (r.importError || r.loadError) throw new Error('nothing to test');
  ok(r.names.join() === animalItems.join(), 'it loads every animal budget.json names, and only those',
     `[${r.names.join(', ')}]`);
  ok(missing && !missing.resolved && /elk/.test(missing.message) && /did not load/.test(missing.message),
     'a missing file rejects the load, naming the animal', missing && (missing.message || 'resolved'));

  group('every creature is built from its model');
  for (const [name, n] of Object.entries(COUNTS)) {
    ok(r.seats[name] === n, `${name}: ${n} in the scene, each seated in its builder's group`, `${r.seats[name] || 0}`);
  }
  ok(r.stray.length === 0, "no builder's mesh is left beside a model", r.stray.join(', '));

  group('the deer (#673)');
  const G = r.graze;
  ok(G.state === 'graze' && G.running && G.moved > 0.02, '`graze` nods the head while it grazes',
     `${G.state}, running ${G.running}, head swung ${G.moved.toFixed(3)} rad in 4 s`);
  ok(G.noseY < -0.5, 'and the head is down', `nose y ${f2(G.noseY)}`);
  ok(Math.abs(G.base) < 0.02, 'its hooves are on the ground', `base ${f2(G.base)} m off it`);
  const AL = r.alert;
  ok(AL.state === 'alert' && !AL.running, 'at 20 m it freezes and the clip lets go', `${AL.state}, running ${AL.running}`);
  ok(AL.noseY > -0.05 && Math.abs(AL.rot - 0.1) < 1e-6, "the head comes up, the builder's -0.1 on the turned node",
     `nose y ${f2(AL.noseY)}, head x ${f2(AL.rot)}`);
  ok(AL.face > 0.95, 'and it faces the walker, not away', `cos ${f2(AL.face)}`);
  ok(r.regraze.state === 'graze' && r.regraze.running, 'past 34 m it grazes again, `graze` playing',
     `${r.regraze.state}, running ${r.regraze.running}`);

  group('the crows (#670, #676)');
  ok(r.crowFly.running && r.crowFly.moved > 0.2, '`fly` beats the wings', `wingR swung ${f2(r.crowFly.moved)} rad in 0.5 s`);
  ok(Math.abs(r.crowScale - 1) < 1e-6, "the model is at its own size, not scaled by the builder's 2.2 again",
     `world scale ${f2(r.crowScale)}`);
  ok(r.crowCW.samples > 60 && r.crowCW.worst > 0.95, 'a dir = +1 crow flies head first',
     `least cos ${f2(r.crowCW.worst)} over ${r.crowCW.samples} frames`);
  ok(r.crowCCW.samples > 60 && r.crowCCW.worst > 0.95, 'and so does a dir = -1 crow',
     `least cos ${f2(r.crowCCW.worst)} over ${r.crowCCW.samples} frames`);

  group('the small birds (#676)');
  const B = r.bird;
  ok(B.flew && B.samples > 10 && B.worst > 0.95, 'a bird flies head first to its next perch',
     `least cos ${f2(B.worst)} over ${B.samples} frames`);
  ok(B.zhi - B.zlo > 1 && B.twist < 1e-6, 'its wings beat about the forward axis, not twisted about the span',
     `wingR z ${f2(B.zlo)} to ${f2(B.zhi)}, x ${f2(B.twist)}`);

  group('the owl (#675)');
  ok(r.owlLook > 0.95, "its face turns to the walker, not the back of its head", `cos ${f2(r.owlLook)}`);
  ok(r.owlFled && r.owlAway.samples > 10 && r.owlAway.worst > 0.95, 'at 6 m it flies off, face first',
     `fled ${r.owlFled}, least cos ${f2(r.owlAway.worst)} over ${r.owlAway.samples} frames`);

  group('the fox and the squirrel');
  ok(r.foxActive && r.fox.samples > 30 && r.fox.worst > 0.95, 'the fox crosses the trail nose first',
     `active ${r.foxActive}, least cos ${f2(r.fox.worst)} over ${r.fox.samples} frames`);
  const Q = r.squirrel;
  ok(Q.visible && Q.frames > 30 && Math.abs(Q.lowest) < 0.005, 'the squirrel stands on its feet between hops, not 2.4 cm up',
     `lowest ${Q.lowest.toFixed(3)} m off the ground over ${Q.frames} frames`);

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
