// node test/props.mjs
//
// The prop pack wired into the game (BACKLOG.md "Golden Hour: Blender assets"
// B6). test/gltf-loader.mjs proves three can read the 45 files; this proves
// the game draws every prop from them and puts each where field.js says it
// goes. Exits non-zero on any failure (#13).
//
// Same harness and trick as test/animals.mjs, port 8167: the README served as
// plain text, rewritten with index.html's import map, so the page imports the
// game's own builders. No renderer: each builder runs into a bare Scene with
// stand-ins for the camera, the walker, the sea and the interact registry, and
// everything read back is off the scene graph (#39). Where a piece should
// stand is read off field.js's own numbers (LAYOUT, PIER, pierDeckY,
// groundHeight) and compared with the piece's world box, measured over its
// vertices; nothing here repeats a builder's placement arithmetic.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8167; // see Tools/board-check/README.md for the ports already in use
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
const f3 = n => (typeof n === 'number' ? n.toFixed(3) : String(n));

const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
const mapTag = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const budget = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tools', 'blender', 'budget.json'), 'utf8'));
const propItems = Object.entries(budget.items)
  .filter(([, item]) => item.file.startsWith('assets/models/props/')).map(([name]) => name).sort();

const server = await serve(PORT);
const browser = await launch();
let r = null, missing = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body><div id="shell-caption"></div></body>`);

  r = await page.evaluate(async () => {
    const out = {};
    let THREE, P, F, props, pier, stones, shells, castles;
    try {
      THREE = await import('three');
      P = await import('./js/pieces.js');
      F = await import('./js/field.js');
      props = await import('./js/props.js');
      pier = await import('./js/pier.js');
      stones = await import('./js/stones.js');
      shells = await import('./js/shells.js');
      castles = await import('./js/sandcastle.js');
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    out.names = P.PIECES.slice().sort();

    let pieces;
    try { pieces = await P.loadPieces(); }
    catch (e) { out.loadError = String(e && e.message || e); return out; }

    // Stand-ins: a registry that records what the builders register, a camera,
    // a walker, a sea at y 0, and an audio that says nothing.
    const regs = [];
    const interact = {
      isTouch: false, hintEl: document.createElement('div'),
      register: e => regs.push(e), setOverride() {}, clearOverride() {},
    };
    const camera = new THREE.PerspectiveCamera();
    const controls = { pos: new THREE.Vector3() };
    const ocean = { water: { position: { y: 0 } } };
    const hush = () => {};
    const audio = { thud: hush, plink: hush, splash: hush };

    const scene = new THREE.Scene();
    const tag = (label, fn) => { const before = new Set(scene.children); fn(); for (const c of scene.children) if (!before.has(c)) c.userData.by = label; };
    let st, sh, sc;
    tag('props', () => props.buildProps(scene, pieces));
    tag('pier', () => pier.buildPier(scene, pieces));
    tag('stones', () => { st = stones.buildStones(scene, interact, controls, camera, audio, ocean, pieces); });
    const nStoneRegs = regs.length;
    tag('shells', () => { sh = shells.buildShells(scene, interact, controls, camera, audio, pieces); });
    const nShellRegs = regs.length - nStoneRegs;
    tag('castles', () => { sc = castles.buildSandcastles(scene, interact, controls, camera, audio, ocean, pieces); });
    scene.updateMatrixWorld(true);

    // -- every mesh the builders made draws a piece, and every piece is drawn
    const byGeo = new Map(Object.entries(pieces).map(([n, p]) => [p.geometry, n]));
    const drawn = new Set();
    out.foreign = [];
    out.byName = {};
    scene.traverse(o => {
      if (!o.isMesh) return;
      if (o.name === 'tide-pool-water' || o.geometry.type === 'RingGeometry') return;   // procedural by design
      const n = byGeo.get(o.geometry);
      if (!n || o.material !== pieces[n].material) { out.foreign.push(`${o.name || o.type}:${o.geometry.type}`); return; }
      drawn.add(n);
      (out.byName[n] ||= []).push(o);
    });
    out.undrawn = P.PIECES.filter(n => !drawn.has(n));
    out.foreignCount = out.foreign.length;
    out.foreign = out.foreign.slice(0, 6);

    // A piece's world box over its vertices, instanced or not.
    const v = new THREE.Vector3(), m = new THREE.Matrix4(), box = new THREE.Box3();
    const boxOf = (mesh, i) => {
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld); }
      else m.copy(mesh.matrixWorld);
      const p = mesh.geometry.attributes.position;
      box.makeEmpty();
      for (let k = 0; k < p.count; k++) box.expandByPoint(v.fromBufferAttribute(p, k).applyMatrix4(m));
      return { min: box.min.clone(), max: box.max.clone(), c: box.getCenter(new THREE.Vector3()) };
    };
    const all = (names, keep = () => true) => {
      const list = [];
      for (const n of names) for (const mesh of (out.byName[n] || []).filter(keep)) {
        const count = mesh.isInstancedMesh ? mesh.count : 1;
        for (let i = 0; i < count; i++) list.push(boxOf(mesh, i));
      }
      return list;
    };
    const near = (list, x, z) => {
      let best = null, bd = Infinity;
      for (const b of list) { const d = Math.hypot(b.c.x - x, b.c.z - z); if (d < bd) { bd = d; best = b; } }
      return { b: best, d: bd };
    };
    const worst = (entries, fn) => entries.reduce((w, e) => Math.max(w, fn(e)), 0);

    // -- the groyne: each post from its base to its top (field.js)
    const posts = all(['groyne-post-1', 'groyne-post-2', 'groyne-post-3']);
    out.groyne = {
      n: posts.length, want: F.LAYOUT.groyne.length,
      base: worst(F.LAYOUT.groyne, p => Math.abs(near(posts, p.x, p.z).b.min.y - p.base)),
      top: worst(F.LAYOUT.groyne, p => Math.abs(near(posts, p.x, p.z).b.max.y - p.top)),
      off: worst(F.LAYOUT.groyne, p => near(posts, p.x, p.z).d),
    };

    // -- the boulders: centred on their entries, their tops r x flat over
    // where the builder sank them
    const rocks = all(['boulder-1', 'boulder-2', 'boulder-3']);
    out.rocks = {
      n: rocks.length, want: F.LAYOUT.rocks.length,
      off: worst(F.LAYOUT.rocks, e => near(rocks, e.x, e.z).d / e.r),
      top: worst(F.LAYOUT.rocks, e => Math.abs(near(rocks, e.x, e.z).b.max.y - (F.groundHeight(e.x, e.z) - e.sink + e.r * e.flat)) / e.r),
    };

    // -- the driftwood: each log on the sand less its sink
    const logs = all(['driftwood-1', 'driftwood-2', 'driftwood-3', 'driftwood-4']);
    out.drift = {
      n: logs.length,
      off: worst(F.LAYOUT.driftwood, d => near(logs, d.x, d.z).d),
      base: worst(F.LAYOUT.driftwood, d => Math.abs(near(logs, d.x, d.z).b.min.y - (F.groundHeight(d.x, d.z) - d.sink))),
    };

    // -- the fence: each post's top at its h over the sand
    const fence = all(['fence-post-1', 'fence-post-2', 'fence-post-3']);
    out.fence = {
      n: fence.length, want: F.LAYOUT.dunes.fence.length,
      top: worst(F.LAYOUT.dunes.fence, f => Math.abs(near(fence, f.x, f.z).b.max.y - (F.groundHeight(f.x, f.z) + f.h))),
    };

    // -- the wrack: three instanced draws, one per kind, as many as LAYOUT has
    const kinds = { shell: 0, pebble: 0, weed: 0 };
    for (const w of F.LAYOUT.wrack) kinds[w.kind]++;
    out.wrack = Object.fromEntries(Object.keys(kinds).map(k => {
      const list = out.byName[`wrack-${k}`] || [];
      return [k, { meshes: list.length, instanced: list.every(x => x.isInstancedMesh), count: list.reduce((s, x) => s + x.count, 0), want: kinds[k] }];
    }));

    // -- the pier: planks on field.js's deck, sound piles standing through it
    const planks = all(['pier-plank-1', 'pier-plank-2', 'pier-plank-3']);
    out.planks = {
      n: planks.length,
      deck: worst(planks, b => Math.abs(b.max.y - F.pierDeckY(b.c.z))),
      inside: planks.every(b => F.onPier(b.c.x, b.c.z)),
    };
    const piles = all(['pier-pile-1', 'pier-pile-2']);
    out.piles = {
      n: piles.length,
      top: worst(piles, b => Math.abs(b.max.y - (F.pierDeckY(b.c.z) + 0.15))),
      sound: piles.every(b => b.c.z >= F.PIER.deckEnd - 0.3),
    };
    const stumps = all(['pier-stump-1', 'pier-stump-2']);
    out.stumps = { n: stumps.length, below: stumps.every(b => b.max.y < F.pierDeckY(b.c.z)), past: stumps.every(b => b.c.z < F.PIER.deckEnd + 0.3) };
    const beams = all(['pier-stringer']);
    out.beams = { n: beams.length, under: beams.every(b => b.max.y < F.pierDeckY(b.c.z) && b.max.y > F.pierDeckY(b.c.z) - 0.5) };

    // -- the skimming stones: on the sand of their patch
    const lying = all(['skimming-stone-1', 'skimming-stone-2', 'skimming-stone-3'], mesh => mesh.parent.name === 'stone-patches');
    const flat = F.LAYOUT.stones.flatMap(p => p.stones);
    out.stones = {
      n: lying.length, want: flat.length,
      off: worst(flat, s => near(lying, s.x, s.z).d),
      base: worst(flat, s => Math.abs(near(lying, s.x, s.z).b.min.y - F.groundHeight(s.x, s.z))),
    };
    out.patchRegs = regs.slice(0, nStoneRegs).map((g, i) => ({
      r: g.radius, dx: g.x - F.LAYOUT.stones[i].x, dz: g.z - F.LAYOUT.stones[i].z,
    }));

    // -- the shells: each find where its entry lies, registered as before
    out.shells = {
      n: sh.shells.length, want: F.LAYOUT.shells.length,
      regs: regs.slice(nStoneRegs, nStoneRegs + nShellRegs).map(g => g.radius),
      home: worst(F.LAYOUT.shells.map((e, i) => [e, sh.shells[i]]), ([e, s]) => Math.hypot(s.home.x - e.x, s.home.z - e.z)),
      sit: F.LAYOUT.shells.map((e, i) => {
        const g = sh.shells[i].mesh, b = boxOf(g.children[0]);
        return b.min.y - F.groundHeight(e.x, e.z);
      }),
      grouped: sh.shells.every(s => s.mesh.isGroup && s.mesh.children.length === 1),
    };
    out.shells.lo = Math.min(...out.shells.sit); out.shells.hi = Math.max(...out.shells.sit);
    delete out.shells.sit;

    // -- a sandcastle: shaped on damp sand, risen, its base on the sand
    const castleReg = regs[regs.length - 1];
    const cz = F.shorelineZ(0) + 5;
    controls.pos.set(0, F.groundHeight(0, cz) + 1.6, cz);
    camera.position.copy(controls.pos); camera.lookAt(0, controls.pos.y, cz + 10); camera.updateMatrixWorld();
    out.castle = { r: castleReg.radius, avail: castleReg.available() };
    if (out.castle.avail) {
      castleReg.use();
      for (let i = 0; i < 90; i++) sc.update(1 / 30);
      scene.updateMatrixWorld(true);
      const cg = scene.getObjectByName('sandcastle');
      const b = boxOf(cg.children[0]);
      out.castle.base = b.min.y - F.groundHeight(cg.position.x, cg.position.z);
      out.castle.height = b.max.y - b.min.y;
      out.castle.scale = cg.scale.x;
    }

    // -- a thrown stone: picked up, wound up, thrown; it spins about its middle
    const patch = F.LAYOUT.stones[1];
    controls.pos.set(patch.x, F.groundHeight(patch.x, patch.z) + 1.6, patch.z);
    camera.position.copy(controls.pos); camera.lookAt(patch.x, controls.pos.y - 0.2, patch.z - 20); camera.updateMatrixWorld();
    regs[1].use();
    document.dispatchEvent(new MouseEvent('mousedown'));
    for (let i = 0; i < 15; i++) st.update(1 / 30);
    document.dispatchEvent(new MouseEvent('mouseup'));
    const fly = scene.getObjectByName('stone-in-hand');
    const start = fly.position.clone();
    let spin = 0;
    for (let i = 0; i < 12; i++) {
      st.update(1 / 30);
      scene.updateMatrixWorld(true);
      const b = boxOf(fly.children[0]);
      spin = Math.max(spin, b.c.distanceTo(fly.position));
    }
    out.throw = { moved: fly.position.distanceTo(start), spin, size: new THREE.Vector3().setFromMatrixScale(fly.children[0].matrixWorld).x };
    return out;
  });

  // A missing file, on its own page so its 404 is the only error there.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const P = await import('./js/pieces.js');
    try { await P.loadPieces(['boulder-1', 'lobster-pot']); return { resolved: true }; }
    catch (e) { return { message: String(e && e.message || e) }; }
  });
  await page2.close();

  group('the pack is what the game loads');
  ok(!r.importError, 'js/pieces.js and the five builders import through the map', r.importError || '');
  ok(!r.loadError, 'loadPieces() loads all 45', r.loadError || '');
  if (r.importError || r.loadError) throw new Error('nothing to test');
  ok(r.names.join() === propItems.join(), 'it loads every prop budget.json names, and only those', `${r.names.length} of ${propItems.length}`);
  ok(missing && !missing.resolved && /lobster-pot/.test(missing.message) && /did not load/.test(missing.message),
     'a missing file rejects the load, naming the piece', missing && (missing.message || 'resolved'));

  group('every prop is drawn from the pack');
  ok(r.foreignCount === 0, 'no mesh the builders made draws anything but a piece (the pool water and splash rings aside)',
     r.foreignCount ? `${r.foreignCount}: ${r.foreign.join(', ')}` : '');
  ok(r.undrawn.length === 0, 'and every piece in the pack is drawn somewhere', r.undrawn.join(', '));

  group('each piece stands where field.js says (B6)');
  const G = r.groyne;
  ok(G.n === G.want && G.off < 0.3, `groyne: ${G.want} posts, each on its entry`, `${G.n}, furthest ${f2(G.off)} m off`);
  ok(G.base < 0.25 && G.top < 0.3, 'from its base to its top', `worst base ${f2(G.base)} m, top ${f2(G.top)} m off`);
  const R = r.rocks;
  ok(R.n === R.want && R.off < 0.25, `boulders: ${R.want}, each centred on its entry`, `${R.n}, worst ${f2(R.off)} r off`);
  ok(R.top < 0.25, "each top r x flat over where it was sunk", `worst ${f2(R.top)} r off`);
  const D = r.drift;
  ok(D.n === 4 && D.off < 0.6 && D.base < 0.15, 'driftwood: four logs, each on the sand less its sink',
     `${D.n}, worst ${f2(D.off)} m off, base ${f2(D.base)} m off`);
  const FE = r.fence;
  ok(FE.n === FE.want && FE.top < 0.12, `fence: ${FE.want} posts, each top h over the sand`, `${FE.n}, worst ${f2(FE.top)} m off`);
  for (const [k, w] of Object.entries(r.wrack)) {
    ok(w.meshes === 1 && w.instanced && w.count === w.want, `wrack ${k}: one instanced draw of ${w.want}`,
       `${w.meshes} mesh(es), ${w.count}`);
  }

  group('the pier: its deck is field.js\'s');
  ok(r.planks.n > 30 && r.planks.deck < 0.015 && r.planks.inside, 'every plank\'s top is on pierDeckY, inside onPier',
     `${r.planks.n} planks, worst ${f3(r.planks.deck)} m off`);
  ok(r.piles.n > 0 && r.piles.sound && r.piles.top < 0.12, 'the sound piles stand 0.15 through the deck',
     `${r.piles.n}, worst ${f2(r.piles.top)} m off`);
  ok(r.stumps.n > 0 && r.stumps.below && r.stumps.past, 'the stumps stand past deckEnd, below the deck line', `${r.stumps.n}`);
  ok(r.beams.n === 2 && r.beams.under, 'two stringers under the planks', `${r.beams.n}`);

  group('what is picked up does not move (interact.js)');
  ok(r.stones.n === r.stones.want && r.stones.off < 0.05 && r.stones.base < 0.03,
     `the ${r.stones.want} skimming stones lie on their spots, on the sand`,
     `${r.stones.n}, worst ${f3(r.stones.off)} m off, base ${f3(r.stones.base)} m off`);
  ok(r.patchRegs.length === 3 && r.patchRegs.every(p => p.r === 3.2 && p.dx === 0 && p.dz === 0),
     'each patch still answers at 3.2 m from its middle', JSON.stringify(r.patchRegs.map(p => p.r)));
  const S = r.shells;
  ok(S.n === S.want && S.regs.length === S.want && S.regs.every(x => x === 2.2) && S.home < 1e-9 && S.grouped,
     `the ${S.want} finds are where their entries lie, each answering at 2.2 m`, `${S.n}, worst ${f3(S.home)} m off`);
  ok(S.lo > -0.1 && S.hi < 0.05, 'each lies in the sand, not over it', `base ${f3(S.lo)} to ${f3(S.hi)} m off the ground`);
  const C = r.castle;
  ok(C.r === 2 && C.avail, 'the sandcastle verb still answers at 2 m on damp sand', JSON.stringify({ r: C.r, avail: C.avail }));
  if (C.avail) {
    ok(Math.abs(C.base) < 0.01 && Math.abs(C.height - 0.94) < 0.1 && Math.abs(C.scale - 1) < 1e-6,
       'a castle rises to full size standing on the sand', `base ${f3(C.base)} m off, ${f2(C.height)} m tall, scale ${f2(C.scale)}`);
  }
  const T = r.throw;
  ok(T.moved > 1, 'a stone picked up and thrown flies', `${f2(T.moved)} m in 0.4 s`);
  ok(T.spin < 0.005 && Math.abs(T.size - 0.06 / 0.065) < 1e-6, 'spinning about its own middle, at its old size',
     `middle ${f3(T.spin)} m off, scale ${f3(T.size)}`);

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
