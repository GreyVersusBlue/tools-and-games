// node test/ship.mjs
//
// The ship pack wired into the game (BACKLOG.md "Aphelion: Blender assets" B4).
// test/gltf-loader.mjs proves three can read the 12 files; this proves
// ship.js draws every prop, the hull and the satellites from them, where the
// primitive builders drew theirs, that every interactable is still there to
// be picked, that each system panel still has its own material for tick() to
// dim, and that the page stops, naming the file, when one is gone. Exits
// non-zero on any failure (#13).
//
// Aphelion's own copy of the shape of The Fourth Quarter's test/bar.mjs, not
// an import of it (#17). Port 8170; 8169 is The Fourth Quarter's.
//
// Same harness and trick as test/gltf-loader.mjs: the README served as plain
// text, rewritten with index.html's import map, so the page imports the game's
// own src/pieces.js and src/ship.js. No renderer: buildWorld() runs into a
// bare Scene and everything read back is off the scene graph (#39).
//
// A piece is found by its group's name, one of PIECES, and never by its type:
// the tray, the curio shelf, every POI and the exterior are bare Groups too,
// and counting Groups is how The Fourth Quarter once counted two light rigs as
// stools. Where each piece should stand is test/fixtures/ship-builders.json:
// the world box of what ship.js's builders drew, measured once off db06e5f.
// Every corner is held to 2 cm (#697).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.join(HERE, '..');
// Absolute import() needs a file URL on Windows (CLAUDE.md house rules).
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(PROJECT, '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8170; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/Projects/aphelion/README.md`;

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
const BUILDER = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'ship-builders.json'), 'utf8'));
const KINDS = Object.keys(BUILDER).filter(k => k !== 'about');
const TOL = 0.02;

// Dressing B3 built past a builder's box on purpose, in metres, added to that
// box's faces before the 2 cm is held (#703). The bed's blanket fold stands 3 cm
// over the frame's top (ship.py bed(): the fold's top is 0.59, the builder's
// 0.56). The hull's seam bands are 7.06 x 4.06 round a 7 x 4 body, so they reach
// 3 cm under it, and the pod bands are 1.24 round 1.2 pods, 2 cm past them on x.
// Named here rather than a looser TOL, so a piece put in at the wrong height
// still fails by its own 3 cm.
const DRESSING = {
  bed: { min: [0, 0, 0], max: [0, 0.03, 0] },
  hull: { min: [-0.02, -0.03, 0], max: [0.02, 0, 0] },
};

// The dimensions of every primitive the pack replaced, as ship.js gave them.
// One of these still in the scene is a builder left beside its piece.
const OLD_BOXES = [
  [4.4, 0.15, 1.0], [4.4, 0.7, 0.5], [0.8, 0.15, 0.8], [0.8, 0.9, 0.15], [0.08, 1.1, 1.4],
  [1.8, 0.8, 0.7], [2.0, 0.35, 0.95], [1.6, 0.12, 0.9], [0.4, 0.1, 0.6], [1.4, 0.06, 0.35],
  [1.6, 0.7, 0.8], [1.4, 0.12, 0.6], [1.4, 2.0, 0.15], [1.6, 0.15, 0.3], [7, 4, 25.5],
  [2.5, 1.2, 3.5], [1.2, 1.2, 4], [1.4, 2.0, 0.2], [0.8, 0.8, 1.4], [2.2, 0.05, 0.9],
];
const OLD_CYLINDERS = [[0.06, 5.6], [1.2, 0.5], [0.02, 1.6]]; // radiusTop, height

const server = await serve(PORT);
const browser = await launch();
let r = null, missing = null;
try {
  const page = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  r = await page.evaluate(async ({ OLD_BOXES, OLD_CYLINDERS }) => {
    const out = {};
    let THREE, P, S;
    try {
      THREE = await import('three');
      P = await import('./src/pieces.js');
    } catch (e) { out.importError = String(e && e.message || e); return out; }
    // ship.js awaits the whole pack at its top, so its import is the load.
    try { S = await import('./src/ship.js'); }
    catch (e) { out.loadError = String(e && e.message || e); return out; }
    out.pieces = P.PIECES.slice();
    out.at = P.AT;
    const j = n => fetch(`./data/${n}.json`).then(res => res.json());
    const [rooms, systems, poi] = await Promise.all([j('rooms'), j('systems'), j('poi')]);
    const scene = new THREE.Scene();
    const refs = S.buildWorld(scene, rooms, systems.systems, poi);
    scene.updateMatrixWorld(true);
    const M = S.M;

    const r4 = v => v.toArray().map(n => Math.round(n * 10000) / 10000);
    const byName = {}, rotated = [], wrongMat = [], stray = [];
    scene.traverse(o => {
      if (o.isGroup && P.PIECES.includes(o.name)) {
        (byName[o.name] ??= []).push(o);
        const turn = o.name === 'panel' ? null : [o.rotation.x, o.rotation.y, o.rotation.z];
        if (turn && turn.some(a => a !== 0)) rotated.push(`${o.name} ${turn.map(a => a.toFixed(3)).join(',')}`);
        for (const m of o.children) {
          // the panel's own `panel` part is checked below, against its system
          if (o.name === 'panel' && m.name === 'panel') continue;
          if (m.material !== M[m.name]) wrongMat.push(`${o.name}/${m.name}`);
        }
        return;
      }
      if (!o.isMesh) return;
      const p = o.geometry.parameters || {};
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      if (o.geometry.type === 'BoxGeometry' && OLD_BOXES.some(([w, h, d]) => near(p.width, w) && near(p.height, h) && near(p.depth, d)))
        stray.push(`box ${p.width} x ${p.height} x ${p.depth}`);
      if (o.geometry.type === 'CylinderGeometry' && OLD_CYLINDERS.some(([rt, h]) => near(p.radiusTop, rt) && near(p.height, h)))
        stray.push(`cylinder r ${p.radiusTop} h ${p.height}`);
    });

    out.counts = Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, v.length]));
    out.rotated = rotated; out.wrongMat = wrongMat; out.stray = stray;
    // panels in systems.json order and satellites in poi.json order, as the fixture has them
    const inOrder = {
      panel: systems.systems.map(s => refs.panels[s.id].mesh),
      satellite: poi.pois.map(q => refs.pois[q.id].group.children.find(c => c.name === 'satellite')),
    };
    out.boxes = {};
    for (const [k, list] of Object.entries(byName)) {
      out.boxes[k] = (inOrder[k] || list).map(o => { const b = new THREE.Box3().setFromObject(o, true); return [r4(b.min), r4(b.max)]; });
    }

    // Each system panel: a panel piece turned by its rotY, whose `panel` part
    // wears that system's own material, the one tick() dims.
    out.panels = systems.systems.map(s => {
      const pr = refs.panels[s.id], g = pr.mesh;
      const face = g && g.children.find(m => m.name === 'panel');
      return {
        id: s.id, isPiece: !!g && g.name === 'panel', rotY: g ? g.rotation.y : null, want: s.panel.rotY,
        own: !!face && face.material === pr.mat && pr.mat !== M.panel && pr.mat.name === 'panel',
      };
    });
    out.distinctPanelMats = new Set(systems.systems.map(s => refs.panels[s.id].mat)).size;

    // Every interactable, and what it is now.
    out.interactables = refs.interactables.map(i => ({
      type: i.type, id: i.id || '',
      what: i.mesh.isGroup ? `group ${i.mesh.name}` : `${i.mesh.parent && i.mesh.parent.name}/${i.mesh.name}`,
    }));

    // What stays the game's (#701).
    const ext = refs.exterior;
    out.kept = {
      glows: ext.children.filter(o => o.isMesh && o.geometry.type === 'CircleGeometry' && o.material.isMeshBasicMaterial).length,
      strips: systems.systems.filter(s => refs.panels[s.id].strip && refs.panels[s.id].strip.material.isMeshBasicMaterial).length,
      stars: scene.children.filter(o => o.isPoints).length,
      sun: scene.children.filter(o => o.isMesh && o.geometry.type === 'SphereGeometry' && o.material.isMeshBasicMaterial).length,
      windows: refs.windowMeshes.length,
    };
    return out;
  }, { OLD_BOXES, OLD_CYLINDERS });

  // One missing file at a time: the fetch for it answers 404 and the game's
  // own loadPieces() has to reject, naming it. On its own page, so the stand-in
  // 404s are the only thing that failed there. Three's FileLoader hands a
  // request for a URL already in flight the first request's answer, so each
  // round ends with a whole load on the real fetch, and the next round's 404
  // is its own.
  const page2 = await prepPage(browser, BASE, { width: 320, height: 240, dsf: 1 });
  await page2.goto(PAGE, { waitUntil: 'load' });
  await page2.setContent(`<!doctype html><meta charset="utf-8">${mapTag}<body></body>`);
  missing = await page2.evaluate(async () => {
    const P = await import('./src/pieces.js');
    const real = window.fetch;
    const out = {};
    for (const name of P.PIECES) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith(`/ship/${name}.glb`)) return Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }));
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
  ok(!r.importError, 'src/pieces.js imports through the map', r.importError || '');
  ok(!r.loadError, 'src/ship.js imports, and its top-level load of all 12 lands', r.loadError || '');

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
  const offAt = want.filter(n => JSON.stringify(r.at[n]) !== JSON.stringify(budget.items[n].at));
  ok(offAt.length === 0, "AT is budget.json's `at` for every piece", offAt.join(', '));

  group('every piece is built from the pack, where its builder stood');
  ok(r.stray.length === 0, "no builder's primitive is left beside a piece", r.stray.join(', '));
  ok(r.wrongMat.length === 0, 'every part wears M[its name], the one shared material (#691)', r.wrongMat.join(', '));
  ok(r.rotated.length === 0, 'no piece but the panel is turned (#700)', r.rotated.join(', '));
  for (const k of KINDS) {
    const b = BUILDER[k], n = r.boxes[k] || [];
    if (!ok(n.length === b.length, `${k}: ${b.length} as the builder drew, counted by group name`, `${n.length}`)) continue;
    let worst = 0;
    const dress = DRESSING[k] ? [DRESSING[k].min, DRESSING[k].max] : [[0, 0, 0], [0, 0, 0]];
    b.forEach((bb, i) => { for (let e = 0; e < 2; e++) for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(bb[e][a] + dress[e][a] - n[i][e][a])); });
    ok(worst <= TOL, `${k}: every corner within ${TOL * 100} cm of the builder's${DRESSING[k] ? ', plus its dressing' : ''}`, `worst ${worst.toFixed(3)} m`);
  }

  group('the system panels still show the power state');
  for (const p of r.panels) {
    ok(p.isPiece && Math.abs(p.rotY - p.want) < 1e-9, `${p.id}: a panel piece turned by systems.json's rotY`, `${p.rotY} of ${p.want}`);
    ok(p.own, `${p.id}: its panel part wears the system's own clone of M.panel, the one tick() dims`);
  }
  ok(r.distinctPanelMats === r.panels.length, 'no two systems share a panel material', `${r.distinctPanelMats} for ${r.panels.length}`);

  group('every interactable is still there, found by its material');
  const expect = [
    ['system', 'power', 'group panel'], ['system', 'oxygen', 'group panel'], ['system', 'hull', 'group panel'],
    ['bed', '', 'bed/bed'], ['plant', '', 'tray/soil'],
    ['airlock-inner', '', 'group hatch-inner'], ['airlock-outer', '', 'group hatch-outer'],
  ];
  const got = r.interactables.map(i => `${i.type} ${i.id} ${i.what}`);
  for (const [type, id, what] of expect) ok(got.includes(`${type} ${id} ${what}`), `${type}${id ? ' ' + id : ''} is the ${what.replace('group ', 'whole ')}`, got.filter(g => g.startsWith(type)).join(' | '));
  const pois = r.interactables.filter(i => i.type === 'poi');
  ok(pois.length === 3 && pois.every(i => i.what === 'satellite/sat'), "every POI's interactable is its satellite's sat part",
    pois.map(i => `${i.id} ${i.what}`).join(', '));
  ok(r.interactables.length === expect.length + 3, 'and nothing else is', `${r.interactables.length}`);

  group("what stays the game's (#701)");
  ok(r.kept.glows === 2, 'both engine glows, in the exterior', `${r.kept.glows}`);
  ok(r.kept.strips === 3, 'a gauge strip a panel', `${r.kept.strips}`);
  ok(r.kept.stars === 1 && r.kept.sun === 1, 'the starfield and the sun', `${r.kept.stars} and ${r.kept.sun}`);
  ok(r.kept.windows === 3, 'the cockpit window and both portholes', `${r.kept.windows}`);

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
