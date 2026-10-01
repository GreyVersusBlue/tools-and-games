// node test/bar.mjs
//
// The bar pack wired into the game (WISHLIST.md "Blender assets" B4).
// test/gltf-loader.mjs proves three can read the 22 files; this proves
// world.js draws every fixture and every stick of furniture from them, where
// the primitive builders drew theirs, in all four rooms, and that the page
// stops, naming the file, when one is gone. Exits non-zero on any failure (#13).
//
// The Fourth Quarter's own copy of the shape of Blue Hour's test/props.mjs, not
// an import of it (#17). Port 8169; 8168 is Blue Hour's.
//
// Same harness and trick as test/gltf-loader.mjs: the README served as plain
// text, rewritten with index.html's import map, so the page imports the game's
// own js/pieces.js and js/world.js. No renderer: buildWorld() runs into a bare
// Scene and everything read back is off the scene graph (#39).
//
// Where each piece should stand is test/fixtures/bar-builders.json: the world
// box of what the primitive builders drew, measured once over their vertices
// with Box3.setFromObject(obj, true), off js/world.js at 3a5db43, the commit
// before B4. Those builders are gone, so the numbers are the record of them,
// not a second copy of their arithmetic. Every corner is held to 2 cm. The
// files were built at the boxes they replace, so all but two land exactly; the
// stool stands 1 cm taller (its leg started 1 cm up in stool(), B3) and the
// stove's grates reach 9 mm past its block. A budget-sized 10% would have
// passed a bottle or a tap put in at its centre height instead of its base.
// The counter, the kick and the three shelves are held as one box a run, which
// is what catches a run that stops short; whether the west end is mirrored has
// its own line, because a mirrored end has the same box.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8169; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/fourth-quarter/README.md`;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const group = name => console.log(`\n${name}`);

const html = fs.readFileSync(path.join(PROJECT, 'index.html'), 'utf8');
const mapTag = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const budget = JSON.parse(fs.readFileSync(path.join(PROJECT, 'tools', 'blender', 'budget.json'), 'utf8'));
const BUILDER = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'bar-builders.json'), 'utf8'));
const VENUES = Object.keys(BUILDER).filter(k => k !== 'about');

const TOL = 0.02;
const ONE = ['corkboard', 'counter', 'kick', 'shelf-back', 'shelf-kitchen', 'sill'];

const server = await serve(PORT);
const browser = await launch();
let r = null, missing = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  r = await page.evaluate(async ({ venues, ONE }) => {
    const out = {};
    let THREE, P, W, M;
    try {
      THREE = await import('three');
      P = await import('./js/pieces.js');
      M = await import('./js/materials.js');
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    // world.js awaits the whole pack at its top, so its import is the load.
    try { W = await import('./js/world.js'); }
    catch (e) { out.loadError = String(e && e.message || e); return out; }
    out.pieces = P.PIECES.slice();
    out.box = P.BOX;
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const r4 = v => v.toArray().map(n => Math.round(n * 10000) / 10000);
    out.venues = {};
    for (const venue of venues) {
      const { group } = W.buildWorld(new THREE.Scene(), venue);
      group.updateMatrixWorld(true);
      const cat = {}, stray = [], wrongMat = [], unmirrored = [];
      const add = (k, o) => (cat[k] ??= []).push(o);
      for (const o of group.children) {
        if (o.isGroup && P.PIECES.includes(o.name)) {
          const k = o.name.startsWith('bottle-') ? 'bottle' : o.name.startsWith('counter-') ? 'counter' : o.name;
          add(k, o);
          for (const m of o.children) {
            // a keyed part wears the game's own mat(key), the one cached object
            if (P.keyed(m.material) && m.material !== M.mat(m.material.name)) wrongMat.push(`${o.name}/${m.material.name}`);
          }
          continue;
        }
        // a primitive with the replaced builders' dimensions is one left behind
        if (!o.isMesh) continue;
        const p = o.geometry.parameters || {};
        if (o.geometry.type === 'CylinderGeometry' && [0.045, 0.03, 0.08, 0.22, 0.035].some(v => near(p.radiusTop, v))) stray.push(`cylinder r ${p.radiusTop}`);
        if (o.geometry.type === 'BoxGeometry' && [[1.7, 0.95], [2.4, 0.95], [0.7, 0.6], [0.55, 0.5], [1.4, 2.3], [1.5, 1], [1.62, 1.12], [1.95, 1.15]]
          .some(([w, h]) => near(p.width, w) && near(p.height, h))) stray.push(`box ${p.width} x ${p.height}`);
        if (o.geometry.type === 'PlaneGeometry' && near(p.width, 0.22) && near(p.height, 0.28)) stray.push('note');
      }
      const ends = (cat.counter || []).filter(o => o.name === 'counter-end').sort((a, b) => a.position.x - b.position.x);
      if (!(ends.length === 2 && ends[0].scale.x < 0 && ends[1].scale.x > 0)) unmirrored.push(ends.map(e => `${e.position.x.toFixed(2)} sx ${e.scale.x}`).join(', '));
      const boxes = {};
      for (const [k, list] of Object.entries(cat)) {
        const bs = list.map(o => new THREE.Box3().setFromObject(o, true));
        boxes[k] = ONE.includes(k) ? [bs.reduce((a, b) => a.union(b))].map(b => [r4(b.min), r4(b.max)])
          : bs.map(b => [r4(b.min), r4(b.max)]);
      }
      const bottleOrder = (cat.bottle || []).slice().sort((a, b) => a.position.x - b.position.x).map(o => o.name);
      out.venues[venue] = { boxes, stray, wrongMat, unmirrored, bottleOrder };
    }
    return out;
  }, { venues: VENUES, ONE });

  // One missing file at a time: the fetch for it answers 404 and the game's
  // own loadPieces() has to reject, naming it. On its own page, so the stand-in
  // 404s are the only thing that failed there. Three's FileLoader hands a
  // request for a URL already in flight the first request's answer, so each
  // round ends with a whole load on the real fetch, which settles only once
  // every file has landed, and the next round's 404 is its own. That load is
  // what keeps the rounds apart, whichever way loadPieces() settles: these
  // lines cannot tell its Promise.allSettled from a Promise.all, and passed
  // 180 of 180 with it changed to one on purpose.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const P = await import('./js/pieces.js');
    const real = window.fetch;
    const out = {};
    for (const name of P.PIECES) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith(`/bar/${name}.glb`)) return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
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
  ok(!r.importError, 'js/pieces.js and js/materials.js import through the map', r.importError || '');
  ok(!r.loadError, 'js/world.js imports, and its top-level load of all 22 lands', r.loadError || '');

  group('a missing file stops the game, by name (one line a piece)');
  for (const [name, item] of Object.entries(budget.items).sort(([a], [b]) => a.localeCompare(b))) {
    const onDisk = fs.existsSync(path.join(PROJECT, item.file));
    const m = missing[name];
    ok(onDisk && m && !m.resolved && m.message.includes(`the ${name} piece did not load`),
      `${name}: ${item.file} is there, and without it loadPieces() rejects naming it`,
      onDisk ? (m ? (m.message || 'resolved') : 'not in PIECES') : 'not on disk');
  }

  if (r.importError || r.loadError) throw new Error('nothing to test');
  group('what it loads');
  const want = Object.keys(budget.items).sort();
  ok(r.pieces.slice().sort().join() === want.join(), 'PIECES is every model budget.json names, and only those',
    `[${r.pieces.join(', ')}]`);
  const offBox = want.filter(n => JSON.stringify(r.box[n]) !== JSON.stringify(budget.items[n].box));
  ok(offBox.length === 0, "BOX is budget.json's box for every piece", offBox.join(', '));

  for (const venue of VENUES) {
    const v = r.venues[venue], old = BUILDER[venue];
    group(`${venue}: every fixture is built from the pack, where its builder's stood`);
    ok(v.stray.length === 0, "no builder's primitive is left beside a piece", v.stray.join(', '));
    ok(v.wrongMat.length === 0, "every keyed part wears the game's own mat(key)", v.wrongMat.join(', '));
    ok(v.unmirrored.length === 0, 'the counter has two ends, the west one mirrored (#690)', v.unmirrored.join(' | '));
    const cycle = ['bottle-green', 'bottle-amber', 'bottle-violet', 'bottle-blue', 'bottle-gold'];
    ok(v.bottleOrder.every((n, i) => n === cycle[i % 5]), 'the bottles run green, amber, violet, blue, gold, as they were coloured',
      v.bottleOrder.slice(0, 6).join(', '));
    for (const k of Object.keys(old).sort()) {
      const b = BUILDER[venue][k], n = v.boxes[k] || [];
      if (!ok(n.length === b.length, `${k}: ${b.length} as the builder drew`, `${n.length}`)) continue;
      // pair each builder's box with the nearest unclaimed piece, by its worst corner
      const gap = (p, q) => { let w = 0; for (let e = 0; e < 2; e++) for (let a = 0; a < 3; a++) w = Math.max(w, Math.abs(p[e][a] - q[e][a])); return w; };
      const left = n.slice();
      let worst = 0;
      for (const bb of b) {
        let best = 0;
        left.forEach((q, i) => { if (gap(bb, q) < gap(bb, left[best])) best = i; });
        worst = Math.max(worst, gap(bb, left[best]));
        left.splice(best, 1);
      }
      ok(worst <= TOL, `${k}: every corner within ${TOL * 100} cm of the builder's`, `worst ${worst.toFixed(3)} m`);
    }
  }

  group('the page');
  ok(page.__errs.length === 0, 'no page errors or failed requests', page.__errs.join(' | '));
  ok(page.__blocked.length === 0 && page.__shimmed.length === 0, 'nothing asked for anything offsite',
     [...page.__blocked, ...page.__shimmed].join(' | '));
  await page.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
