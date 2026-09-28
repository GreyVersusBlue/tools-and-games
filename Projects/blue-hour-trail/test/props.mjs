// node test/props.mjs
//
// The trail prop pack wired into the game (BACKLOG.md "Blue Hour: Blender
// assets" B6). test/gltf-loader.mjs proves three can read the 13 files; this
// proves the game draws every prop from them, where the builders drew theirs,
// and fails loud when a file is gone. Exits non-zero on any failure (#13).
//
// Blue Hour's own copy of the shape of Golden Hour's test/props.mjs, not an
// import of it (#17). Port 8168; 8167 is Golden Hour's.
//
// Same harness and trick as test/animals.mjs: the README served as plain text,
// rewritten with index.html's import map, so the page imports the game's own
// js/pieces.js and js/props.js. No renderer: buildProps() runs into a bare
// Scene and everything read back is off the scene graph (#39).
//
// Where each prop should stand is BUILDER below: the world box of what the
// primitive builders drew, measured once over their vertices with
// Box3.setFromObject(obj, true), from js/props.js as it stood at 02cdbfa, the
// commit before B6. Those builders are gone, so the numbers are the record of
// them, not a second copy of their arithmetic. Each file is inside 10% of its
// builder's box (#653, B5), so each prop is held to 10% of its own longest
// side at every corner; the radio and the headlamp, which the walker finds,
// are held to a centimetre. So what catches a piece left in its file's frame
// (#683's origin not subtracted) is the radio, 1.8 m off, the headlamp and the
// cairns; the others' origins sit under 6 cm from the file's, or 10 cm for the
// markers, inside their 10%, and these corners cannot see that (#147).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8168; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/blue-hour-trail/README.md`;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const group = name => console.log(`\n${name}`);
const f3 = n => (typeof n === 'number' ? n.toFixed(3) : String(n));

const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
const mapTag = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const budget = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tools', 'blender', 'budget.json'), 'utf8'));
const propItems = Object.entries(budget.items)
  .filter(([, item]) => item.file.startsWith('assets/models/props/'));

// [min, max] world boxes of the old builders' meshes, in metres (see above).
// `tol` is the corner tolerance: 10% of the prop's longest side in budget.json,
// or 1 cm for the two things the walker finds. The cairns are the exception:
// each stone is a variant weathered at another stone's seed, and roughen()
// moves a vertex up to 18% of r either way, so two weatherings of the largest
// stone (r 0.38) can disagree by 2 x 0.18 x 0.38 = 0.137 m at a corner.
const BUILDER = {
  markers:   { box: [[-72.892, 1.927, -89.463], [71.25, 64.239, 135.873]], tol: 0.15 },
  cairns:    { box: [[-54.324, 7.675, -44.05], [75.513, 55.866, 102.246]], tol: 0.14 },
  bridge:    { box: [[-26.395, 1.361, 133.583], [-18.971, 2.581, 138.408]], tol: 0.7 },
  bench:     { box: [[-8.212, 63.921, -102.378], [-6.959, 64.871, -100.753]], tol: 0.16 },
  tower:     { box: [[-18.839, 63.192, -109.63], [-13.39, 75.049, -103.837]], tol: 1.19 },
  cabin:     { box: [[47.689, 27.957, 30.74], [52.723, 32.353, 34.968]], tol: 0.46 },
  radio:     { box: [[51.325, 28.812, 30.74], [51.711, 29.882, 30.981]], tol: 0.01 },
  headlamp:  { box: [[48.06, 28.671, 30.856], [48.246, 28.739, 31.045]], tol: 0.01 },
  mushrooms: { box: [[-76.502, -0.918, -99.686], [76.532, 64.535, 142.682]], tol: 0.03 },
};

const server = await serve(PORT);
const browser = await launch();
let r = null, missing = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);

  r = await page.evaluate(async () => {
    const out = {};
    let THREE, P, B, F;
    try {
      THREE = await import('three');
      P = await import('./js/pieces.js');
      B = await import('./js/props.js');
      F = await import('./js/field.js');
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    out.names = P.PIECES.slice().sort();
    out.origin = P.ORIGIN;
    out.ref = P.REF;

    let pieces;
    try { pieces = await P.loadPieces(); }
    catch (e) { out.loadError = String(e && e.message || e); return out; }

    const scene = new THREE.Scene();
    const props = B.buildProps(scene, pieces);
    scene.updateMatrixWorld(true);
    const root = scene.getObjectByName('props');
    const L = F.LAYOUT;

    // -- nothing in the props but pieces, and the bootprints' one quad buffer
    const pieceGeos = new Set(Object.values(pieces).flat().map(p => p.geometry));
    out.stray = [];
    root.traverse(o => {
      if (o.isMesh && !pieceGeos.has(o.geometry) && o.name !== 'bootprints') out.stray.push(o.name || o.type);
    });

    // -- world boxes, over vertices
    out.boxes = {};
    const b = new THREE.Box3();
    for (const name of ['markers', 'cairns', 'bridge', 'bench', 'tower', 'cabin', 'radio', 'headlamp', 'mushrooms']) {
      const o = root.getObjectByName(name);
      if (!o) { out.boxes[name] = null; continue; }
      b.setFromObject(o, true);
      out.boxes[name] = [b.min.toArray(), b.max.toArray()];
    }

    // -- the instanced sets: counts and scales
    const sets = name => root.getObjectByName(name).children.filter(c => c.isInstancedMesh);
    const count = (list, pred = () => true) => list.filter(pred).reduce((n, c) => n + c.count, 0);
    const m4 = new THREE.Matrix4(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), q = new THREE.Quaternion();
    const markers = sets('markers');
    out.markers = {
      sets: markers.map(c => c.name).sort(),
      posts: count(markers, c => /wood$/.test(c.name)),
      blazes: count(markers, c => /marker-blaze$/.test(c.name)),
      want: L.markers.length,
      blazeBasic: markers.filter(c => /marker-blaze$/.test(c.name)).every(c => c.material.isMeshBasicMaterial),
    };
    const cairns = sets('cairns');
    out.cairns = {
      sets: cairns.map(c => c.name).sort(),
      stones: count(cairns),
      want: L.cairns.reduce((n, c) => n + c.stones, 0),
    };
    const mush = sets('mushrooms');
    let lo = Infinity, hi = -Infinity;
    for (const c of mush) {
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m4); m4.decompose(p3, q, s3);
        lo = Math.min(lo, s3.x); hi = Math.max(hi, s3.x);
      }
    }
    const glowCap = mush.find(c => c.name === 'mushroom-glow/mushroom-glow');
    out.mushrooms = {
      sets: mush.map(c => c.name).sort(),
      plain: mush.filter(c => /^mushroom\//.test(c.name)).map(c => c.count),
      glow: mush.filter(c => /^mushroom-glow\//.test(c.name)).map(c => c.count),
      wantPlain: L.mushrooms.filter(m => !m.glow).reduce((n, m) => n + m.count, 0),
      wantGlow: L.mushrooms.filter(m => m.glow).reduce((n, m) => n + m.count, 0),
      lo, hi,
      emissive: glowCap ? glowCap.material.emissive.getHexString(THREE.SRGBColorSpace) : null,
    };

    // -- the unlit glass, and the cabin window the fog lights
    const tower = root.getObjectByName('tower'), cabin = root.getObjectByName('cabin');
    const lamp = root.getObjectByName('headlamp');
    const panes = tower.getObjectByName('panes'), win = cabin.getObjectByName('window');
    const lens = lamp.children.find(c => c.material.name === 'headlamp-lens');
    out.glass = {
      panes: !!panes && panes.material.isMeshBasicMaterial,
      window: !!win && win.material.isMeshBasicMaterial,
      lens: !!lens && lens.material.isMeshBasicMaterial,
    };
    props.update(1 / 30, 0);
    const clear = win.material.color.getHexString(THREE.SRGBColorSpace);
    props.update(1 / 30, 1);
    const thick = win.material.color.getHexString(THREE.SRGBColorSpace);
    props.update(1 / 30, 0.5);
    const half = win.material.color.getHexString(THREE.SRGBColorSpace);
    out.window = { clear, thick, half };

    // -- the headlamp: where LAYOUT.headlamp says, and gone once taken
    lamp.getWorldPosition(p3);
    out.lampAt = { dx: p3.x - L.headlamp.x, dz: p3.z - L.headlamp.z, dy: p3.y - F.groundHeight(L.headlamp.x, L.headlamp.z) };
    out.lampShown = lamp.visible;
    props.takeHeadlamp();
    let shown = 0;
    lamp.traverseVisible(o => { if (o.isMesh) shown++; });
    out.lampTaken = { visible: lamp.visible, meshes: lamp.children.length, shown };
    return out;
  });

  // One missing file at a time: the fetch for it answers 404 and the game's
  // own loadPieces() has to reject, naming it. On its own page, so the
  // stand-in 404s are the only thing that failed there.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const P = await import('./js/pieces.js');
    const real = window.fetch;
    const out = {};
    // A rejected load leaves the other twelve in flight, and three's
    // FileLoader hands a later request for the same URL the one in flight, so
    // each round ends with a whole load on the real fetch, which joins those
    // and settles only once every one of them has landed.
    for (const name of P.PIECES) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith(`/props/${name}.glb`)) return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
        return real(input, init);
      };
      try { await P.loadPieces(); out[name] = { resolved: true }; }
      catch (e) { out[name] = { message: String(e && e.message || e) }; }
      window.fetch = real;
      try { await P.loadPieces(); } catch { /* a file really gone: its own line says so */ }
    }
    return out;
  });
  await page2.close();

  group('the pack is what the game loads');
  ok(!r.importError, 'js/pieces.js and js/props.js import through the map', r.importError || '');
  ok(!r.loadError, 'loadPieces() loads all 13', r.loadError || '');

  group('a missing file stops the game, by name (one line a piece)');
  for (const [name, item] of propItems.sort(([a], [b]) => a.localeCompare(b))) {
    const onDisk = fs.existsSync(path.join(PROJECT, item.file));
    const m = missing[name];
    ok(onDisk && m && !m.resolved && m.message.includes(`the ${name} piece did not load`),
      `${name}: ${item.file} is there, and without it loadPieces() rejects naming it`,
      onDisk ? (m && (m.message || 'resolved')) : 'not on disk');
  }

  if (r.importError || r.loadError) throw new Error('nothing to test');
  group('what it loads');
  const want = propItems.map(([name]) => name).sort();
  ok(r.names.join() === want.join(), 'it loads every prop budget.json names, and only those', `[${r.names.join(', ')}]`);
  const offOrigin = propItems.filter(([name, item]) =>
    JSON.stringify(r.origin[name]) !== JSON.stringify(item.ref.origin)).map(([name]) => name);
  ok(offOrigin.length === 0, "each piece's origin is budget.json's ref.origin (#683)", offOrigin.join(', '));
  const offRef = Object.entries(r.ref).filter(([name, ref]) =>
    Object.entries(ref).some(([k, v]) => budget.items[name].ref[k] !== v)).map(([name]) => name);
  ok(offRef.length === 0, "each scale reference is budget.json's ref (#684)", offRef.join(', '));

  group('every prop is built from the pack');
  ok(r.stray.length === 0, "no builder's primitive is left beside a piece", r.stray.join(', '));
  const M = r.markers;
  ok(M.sets.join() === 'marker-1/marker-blaze,marker-1/wood,marker-2/marker-blaze,marker-2/wood',
    'the markers are two variants, one set per material', M.sets.join(', '));
  ok(M.posts === M.want && M.blazes === M.want, `${M.want} markers, a post and a blaze each`, `${M.posts} posts, ${M.blazes} blazes`);
  ok(M.blazeBasic, 'the blazes are unlit');
  const C = r.cairns;
  ok(C.sets.length === 3 && C.stones === C.want, `the cairns are ${C.want} stones in three variants`,
    `${C.stones} in [${C.sets.join(', ')}]`);
  const U = r.mushrooms;
  ok(U.sets.length === 4, 'the mushrooms are one instanced set per material per file', U.sets.join(', '));
  ok(U.plain.every(n => n === U.wantPlain) && U.glow.every(n => n === U.wantGlow),
    `${U.wantPlain} plain and ${U.wantGlow} glowing, as field.js has them`, `plain ${U.plain}, glow ${U.glow}`);
  ok(U.lo >= 0.6 && U.hi <= 1.9 && U.hi - U.lo > 1, 'scaled 0.6 to 1.9, as the builder scaled them',
    `${f3(U.lo)} to ${f3(U.hi)}`);
  ok(U.emissive === '2a3a26', "the glowing caps carry the builder's emissive", `#${U.emissive}`);

  group("each prop stands where its builder's stood");
  for (const [name, { box, tol }] of Object.entries(BUILDER)) {
    const got = r.boxes[name];
    if (!got) { ok(false, `${name} is in the scene`); continue; }
    let worst = 0;
    for (let c = 0; c < 2; c++) for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(got[c][a] - box[c][a]));
    ok(worst <= tol, `${name}: every corner within ${tol} m of the builder's box`, `worst ${f3(worst)} m`);
  }

  group('the glass (B6)');
  ok(r.glass.panes && r.glass.window && r.glass.lens, "the tower's panes, the cabin's window and the headlamp's lens are unlit",
    JSON.stringify(r.glass));
  const W = r.window;
  ok(W.clear === '8a6a30' && W.thick === 'd9a545', "update() lerps the cabin window from the builder's warm to its bright",
    `#${W.clear} at fog 0, #${W.half} at 0.5, #${W.thick} at 1`);
  ok(W.half !== W.clear && W.half !== W.thick, 'and passes between them');

  group('the headlamp');
  const A = r.lampAt;
  ok(Math.hypot(A.dx, A.dz) < 1e-6 && Math.abs(A.dy) < 1e-6, "its group stands on LAYOUT.headlamp's ground point",
    `off by ${f3(Math.hypot(A.dx, A.dz))} m across, ${f3(A.dy)} m up`);
  ok(r.lampShown && !r.lampTaken.visible && r.lampTaken.meshes === 3 && r.lampTaken.shown === 0,
    'takeHeadlamp() hides the whole lamp, body, strap and lens',
    `${r.lampTaken.meshes} parts, ${r.lampTaken.shown} still drawn`);

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
