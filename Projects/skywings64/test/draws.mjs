// draws.mjs — how many draw calls one frame of SkyWings 64 costs, from nine fixed viewpoints.
//
//   node Projects/skywings64/test/draws.mjs                 hold the counts to test/draws.json
//   node Projects/skywings64/test/draws.mjs --write         record test/draws.json afresh
//   node Projects/skywings64/test/draws.mjs --shots=DIR     also save each view as PNG and raw RGBA
//   node Projects/skywings64/test/draws.mjs --compare=DIR   and diff each view against the RGBA in DIR
//   node Projects/skywings64/test/draws.mjs --first=3       only the first three views (what test/browser.mjs runs)
//
// The views are tools/gpu-profile.mjs's: Rotor Rally (gc1) at quality=high, on the gyro pad and with
// the gyro held 60 m up and 220 m short of each of eight landmarks. Unlike the profile this never
// lets the page's own frame loop start: it steps the game through window.__qa.sim from a fixed clock
// with a seeded Math.random, so the LOD tiers, the streamed grass, the wind and the clouds are the
// same on every run, then renders one frame by hand.
// Each draw (one renderBufferDirect) is counted by pass and by who owns the object:
//   vegetation  landmarks/vegetation: trees, bushes, rocks, grass
//   statics     everything else under landmarks: props, buildings, the GLB swaps
//   terrain     the heightfield chunks
//   rest        water, sky, the aircraft, the course, particles
// The views run in one page, in order, and the boats, balloons and traffic move on the game time
// that has passed, so a view's count belongs to its place in the order: a partial run is always the
// first N views, never a pick.
// A count is all this can prove. Chromium here renders in software (SwiftShader), so nothing in this
// file says anything about milliseconds: tools/gpu-profile.mjs on a real GPU does that (#789).
// Exits non-zero when a pinned count has moved past its tolerance, on a page error, or when the
// pixel comparison asked for by --compare is over --max (#13).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.join(HERE, 'draws.json');
export const PORT = 8174; // browser.mjs 8172, gpu-profile.mjs 8173
export const BUCKETS = ['scene.vegetation', 'scene.statics', 'scene.terrain', 'scene.rest', 'shadow.vegetation', 'shadow.statics', 'shadow.terrain', 'shadow.rest', 'post'];
// A pinned count may move by this much before the check fails: the larger of TOL_ABS draws and
// TOL_REL of the count. Two runs of the same code agree to the draw, so this is slack for a prop
// or two, not for a tier that has come un-batched.
// `uncastInBox` is the number of vegetation instances that cast no shadow yet stand inside the
// sun's shadow box: the shadows the near-tier rule has taken out of the picture, every one of them
// at least the near tier's distance from the camera. It may not rise more than UNCAST_SLACK.
export const UNCAST_SLACK = 10;
export const TOL_ABS = 2, TOL_REL = 0.04;

export const VIEWS = {
  pad: null, castle: [400, -500], heads: [1500, -300], lighthouse: [650, 1300], mountain: [-300, -400],
  windmills: [425, 420], cabins: [-336, 615], runway: [155, 470], bridge: [null, 380],
};

// Pure: every way `now` has left `pinned`, as strings naming the view and the bucket. Node only.
export function compareCounts(pinned, now, tolAbs = TOL_ABS, tolRel = TOL_REL) {
  const out = [];
  for (const view of Object.keys(pinned)) {
    if (!now[view]) { out.push(`${view}: view missing`); continue; }
    for (const b of [...BUCKETS, 'total']) {
      const want = pinned[view].draws[b], got = now[view].draws[b];
      const tol = Math.max(tolAbs, Math.ceil(want * tolRel));
      if (!(Math.abs(got - want) <= tol)) out.push(`${view}: ${b} draws ${got}, pinned ${want} (tolerance ${tol})`);
    }
    if (!(now[view].uncastInBox <= pinned[view].uncastInBox + UNCAST_SLACK)) out.push(`${view}: ${now[view].uncastInBox} vegetation instances inside the shadow box cast no shadow, pinned ${pinned[view].uncastInBox} (slack ${UNCAST_SLACK})`);
  }
  return out;
}

// Pure: two RGBA buffers of the same size -> how far apart they are. A pixel "differs" when any
// channel is more than `thresh` (of 255) away.
export function diffPixels(a, b, thresh = 8) {
  if (a.length !== b.length) return { differ: 1, max: 255, mean: 255, sizeMismatch: true };
  let n = 0, max = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > thresh) n++;
    if (d > max) max = d;
    sum += d;
  }
  const px = a.length / 4;
  return { differ: n / px, max, mean: sum / px };
}

export async function measure({ width = 960, height = 540, shots = null, first = 99, log = () => {} } = {}) {
  const views = Object.keys(VIEWS).slice(0, first);
  const BASE = `http://127.0.0.1:${PORT}`;
  const server = await serve(PORT);
  const browser = await launch();
  const out = {};
  try {
    const page = await prepPage(browser, BASE, { width, height, dsf: 1 });
    // Before any of the page's code: no frame loop at all, and a seeded Math.random. The game then
    // never runs a frame this file did not ask for, so clouds, sails, smoke and traffic stand
    // where the fixed clock puts them and two runs can be compared pixel by pixel.
    await (page.evaluateOnNewDocument || page.addInitScript).call(page, () => {
      window.requestAnimationFrame = () => 0;
      let s = 0x9e3779b9;
      Math.random = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      window.__reseed = (n) => { s = n | 0; };
    });
    await page.goto(`${BASE}/Projects/skywings64/index.html?quality=high&touch=0&unlock=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__qa && window.__game && window.__sw && window.__sw.renderer && window.__sw.composer && window.__sw.envMap, { timeout: 240000, polling: 250 });
    await page.evaluate(PAGE);
    await page.evaluate(() => window.__dc.settle());
    if (shots) fs.mkdirSync(shots, { recursive: true });
    for (const name of views) {
      const at = VIEWS[name], t0 = Date.now();
      const r = await page.evaluate(([n, a, s]) => window.__dc.view(n, a, s), [name, at, !!shots]);
      if (shots) {
        fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(shots, name + '.rgba'), Buffer.from(r.rgba, 'base64'));
      }
      delete r.png; delete r.rgba;
      out[name] = r;
      log(`${name.padEnd(11)} ${String(r.draws.total).padStart(4)} draws  ${(r.tris.total / 1e6).toFixed(2)} M tris  ` +
        BUCKETS.map((b) => b.replace('scene.', '').replace('shadow.', 's:') + ' ' + r.draws[b]).join('  ') + `  uncast in box ${r.uncastInBox}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    out.__errors = (page.__errs || []).map((e) => String(e).slice(0, 300));
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

// ---------------------------------------------------------------- in-page side
function PAGE() {
  const q = window.__qa, g = q.game, sw = window.__sw, R = sw.renderer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.SW_ADAPTIVE = false;
  R.info.autoReset = false;

  let hold = null;
  const origUpdate = g.update.bind(g);
  g.update = function (dt, el) {
    if (hold) { const v = g.vehicle; v.position.copy(hold.p); v.velocity.set(0, 0, 0); v.heading = hold.h; v.pitch = 0; v.roll = 0; }
    return origUpdate(dt, el);
  };

  function bucketOf(obj) {
    const chain = []; for (let o = obj; o && o !== sw.scene; o = o.parent) chain.unshift(o.name || o.type);
    const owner = chain.slice(0, chain[0] === 'landmarks' ? 2 : 1).join('/');
    const b = chain[0] === 'terrain' ? 'terrain' : chain[0] !== 'landmarks' ? 'rest' : chain[1] === 'vegetation' ? 'vegetation' : 'statics';
    return [b, owner];
  }
  function countedRender() {
    const draws = { total: 0 }, tris = { total: 0 }, owners = {};
    let pass = 'scene';
    const sm = R.shadowMap, smr = sm.render;
    sm.render = function (...a) { const p = pass; pass = 'shadow'; try { return smr.apply(sm, a); } finally { pass = p; } };
    const origR = R.render;
    R.render = function (s, c) { const p = pass; if (pass !== 'shadow') pass = s === sw.scene ? 'scene' : 'post'; try { return origR.call(R, s, c); } finally { pass = p; } };
    const rbd = R.renderBufferDirect;
    R.renderBufferDirect = function (cam, scn, geo, mat, obj, grp) {
      // the range three will draw (its own arithmetic); an empty one returns before any GL call
      const dr = geo.drawRange, full = geo.index ? geo.index.count : (geo.attributes.position ? geo.attributes.position.count : 0);
      let a = dr.start, b = dr.start + dr.count;
      if (grp) { a = Math.max(a, grp.start); b = Math.min(b, grp.start + grp.count); }
      const n = Math.min(full, b) - Math.max(0, a), copies = obj.isInstancedMesh ? obj.count : geo.isInstancedBufferGeometry ? Math.min(geo.instanceCount, geo._maxInstanceCount ?? Infinity) : 1;
      if (!(n > 0) || copies === 0) return rbd.call(R, cam, scn, geo, mat, obj, grp);
      const tri = (obj.isMesh ? n / 3 : 0) * copies;
      let key = 'post', owner = null;
      if (pass !== 'post') { const [b, o] = bucketOf(obj); key = pass + '.' + b; owner = pass + ':' + o; }
      draws[key] = (draws[key] || 0) + 1; tris[key] = (tris[key] || 0) + tri; draws.total++; tris.total += tri;
      if (owner) { const w = owners[owner] || (owners[owner] = { draws: 0, tris: 0 }); w.draws++; w.tris += tri; }
      return rbd.call(R, cam, scn, geo, mat, obj, grp);
    };
    R.info.reset();
    try { sw.render(1 / 60); } finally { R.renderBufferDirect = rbd; R.render = origR; sm.render = smr; }
    return { draws, tris, owners, info: { calls: R.info.render.calls, triangles: R.info.render.triangles } };
  }
  // bytes the scene's geometry holds: every attribute and index once, plus per-instance matrices and colours
  function memory() {
    const seen = new Set(); let geo = 0, inst = 0, meshes = 0, instanced = 0;
    sw.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      meshes++;
      if (o.isInstancedMesh) { instanced++; inst += o.instanceMatrix.array.byteLength + (o.instanceColor ? o.instanceColor.array.byteLength : 0); }
      const ge = o.geometry; if (!ge || seen.has(ge)) return; seen.add(ge);
      for (const k in ge.attributes) { const a = ge.attributes[k], arr = a.isInterleavedBufferAttribute ? a.data.array : a.array; if (!seen.has(arr)) { seen.add(arr); geo += arr.byteLength; } }
      if (ge.index) geo += ge.index.array.byteLength;
    });
    return { geometryMB: +((geo + inst) / 1048576).toFixed(2), meshes, instanced, geometries: R.info.memory.geometries, textures: R.info.memory.textures };
  }

  // vegetation that casts no shadow (every batch past the near tier) and stands inside the sun's
  // shadow box, 30 m of slack for the tallest tree: each one is a shadow the old per-cell meshes drew
  function uncastInBox() {
    const veg = sw.scene.getObjectByName('vegetation'), bs = veg && veg.userData.batches;
    if (!bs) return null;
    const cam = sw.sun.shadow.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorldInverse.elements, pad = 30;
    let n = 0;
    for (const b of bs) {
      if (b.cast || !b.mesh) continue;
      const a = b.mesh.instanceMatrix.array;
      for (let i = 0; i < b.n; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        const lx = e[0] * x + e[4] * y + e[8] * z + e[12], ly = e[1] * x + e[5] * y + e[9] * z + e[13], lz = e[2] * x + e[6] * y + e[10] * z + e[14];
        if (lx > cam.left - pad && lx < cam.right + pad && ly > cam.bottom - pad && ly < cam.top + pad && -lz > cam.near - pad && -lz < cam.far + pad) n++;
      }
    }
    return n;
  }

  let perf = null;
  window.__dc = {
    async settle() {
      q.start('gc1');
      if (window.__models && window.__models.allModelsSettled) await window.__models.allModelsSettled();
      const L = g.world.meshes.landmarks;
      for (let n = 0; n < 300 && !L.getObjectByName('glb:heads'); n++) await sleep(200);
      await sleep(1500);
      perf = await import(new URL('src/render/perf.js', location.href).href);
    },
    async view(name, at, shot) {
      // three's UUIDs draw on Math.random too, so reseed before the course is built: a ring's phase
      // must not depend on how many objects the page has made so far
      hold = null; window.__reseed(7); q.start('gc1');
      const Wd = g.world, v = g.vehicle;
      if (at) {
        let [x, z] = at;
        if (x == null) { let by = Infinity; x = 0; for (let t = -1200; t <= 1200; t += 10) { const y = Wd.heightAt(t, z); if (y < by && y > -5) { by = y; x = t; } } }
        const px = x, pz = z + 220, gy = Math.max(Wd.heightAt(x, z), Wd.heightAt(px, pz), 0);
        hold = { p: new v.position.constructor(px, gy + 60, pz), h: Math.atan2(-(x - px), -(z - pz)) };
      }
      // a fixed clock: wind sway, clouds and water read g.elapsed, and the LOD tick and the grass
      // stream (two cells a tick) need game time to fill in
      g.elapsed = 100; window.__reseed(7);
      q.sim(12, null, { dt: 1 / 30 });
      g.camera.updateMatrixWorld();
      sw.rescan();
      countedRender();                 // flags new meshes as shadow casters and compiles what is new
      const r = countedRender();
      let png = null, rgba = null;
      if (shot) {
        const c = document.createElement('canvas'); c.width = R.domElement.width; c.height = R.domElement.height;
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(R.domElement, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768));
        rgba = btoa(s); png = c.toDataURL('image/png');
      }
      const p = perf.perfReport(R, sw.scene);
      const owners = Object.entries(r.owners).sort((a, b) => b[1].draws - a[1].draws).slice(0, 14).map(([k, w]) => `${k} ${w.draws} draws ${Math.round(w.tris / 1e3)}k tris`);
      const round = (o) => { for (const k in o) o[k] = Math.round(o[k]); return o; };
      for (const k of ['scene.vegetation', 'scene.statics', 'scene.terrain', 'scene.rest', 'shadow.vegetation', 'shadow.statics', 'shadow.terrain', 'shadow.rest', 'post']) { r.draws[k] = r.draws[k] || 0; r.tris[k] = r.tris[k] || 0; }
      return { draws: r.draws, tris: round(r.tris), rendererInfo: r.info, uncastInBox: uncastInBox(), owners, memory: { ...memory(), textureMB: p.textures.estMB, programs: p.memory.programs },
        camera: g.camera.position.toArray().map((n) => Math.round(n * 10) / 10), size: [R.domElement.width, R.domElement.height], png, rgba };
    },
  };
}

// ---------------------------------------------------------------- command line
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith('--' + k)); return a ? (a.includes('=') ? a.split('=').slice(1).join('=') : true) : d; };
  const shots = arg('shots', null), cmp = arg('compare', null), write = !!arg('write', false);
  const thresh = +arg('thresh', 8), maxDiffer = +arg('max', 0.0001);
  const only = arg('first', null);
  const now = await measure({ shots: shots || (cmp ? path.join(HERE, '..', '.draws-shots') : null), first: only ? +only : undefined, log: console.log });
  const errors = now.__errors; delete now.__errors;
  let failures = 0;
  for (const e of errors) { failures++; console.log('  FAIL  page error: ' + e); }
  for (const [name, r] of Object.entries(now)) {
    if (r.rendererInfo.calls !== r.draws.total) { failures++; console.log(`  FAIL  ${name}: counted ${r.draws.total} draws, renderer.info says ${r.rendererInfo.calls}`); }
  }
  if (shots) fs.writeFileSync(path.join(shots, 'counts.json'), JSON.stringify(now, null, 1));
  if (write && only) { console.log('  FAIL  --write records all nine views; drop --first'); failures++; } else if (write) {
    const fx = { note: 'Written by `node test/draws.mjs --write`. Draw calls and triangles of one frame per view, Rotor Rally at quality=high, 960x540, software GL. Counts only: see the head of draws.mjs.', views: now };
    fs.writeFileSync(FIXTURE, JSON.stringify(fx, null, 1) + '\n');
    console.log('wrote ' + path.relative(process.cwd(), FIXTURE));
  } else {
    const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).views;
    if (only) for (const k of Object.keys(pinned)) if (!now[k]) delete pinned[k];
    const moved = compareCounts(pinned, now);
    for (const m of moved) { failures++; console.log('  FAIL  ' + m); }
    console.log(`${Object.keys(pinned).length} views held to test/draws.json, ${moved.length} count(s) moved`);
  }
  if (cmp) {
    const dir = shots || path.join(HERE, '..', '.draws-shots');
    let worst = null;
    for (const name of Object.keys(now)) {
      const d = diffPixels(fs.readFileSync(path.join(cmp, name + '.rgba')), fs.readFileSync(path.join(dir, name + '.rgba')), thresh);
      console.log(`  ${d.differ <= maxDiffer ? 'ok  ' : 'FAIL'}  ${name}: ${(d.differ * 100).toFixed(3)} % of pixels differ by more than ${thresh}/255 (max ${d.max}, mean ${d.mean.toFixed(3)})`);
      if (d.differ > maxDiffer) failures++;
      if (!worst || d.differ > worst.d.differ) worst = { name, d };
    }
    console.log(`worst view: ${worst.name}, ${(worst.d.differ * 100).toFixed(3)} %`);
    if (!shots) fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failures ? 1 : 0);
}
