// gpu-profile.mjs — measure SkyWings 64 on this machine's real GPU (WISHLIST item 2).
//
//   node Projects/skywings64/tools/gpu-profile.mjs [--vsync] [--size=1280x720] [--secs=8]
//
// A measurement, not a check: it prints numbers and exits 0 unless the page fails to start or the
// WebGL renderer turns out to be software (SwiftShader / llvmpipe / Basic Render), which would make
// every number here meaningless. Opens a visible Chrome window (headless Chrome on Windows can fall
// back to software GL), so run it alone (CLAUDE.md: one visible browser at a time).
//
// Without --vsync Chrome runs with the frame-rate limit off, so the frame interval is the real cost of
// a frame rather than the monitor's refresh. Per frame it records the rAF interval, the main-thread
// time inside game.update + sw.render, and renderer.info (draw calls and triangles over every pass of
// one displayed frame). GPU time comes from EXT_disjoint_timer_query_webgl2 when the browser exposes it.
//
// Three places, all in Rotor Rally (gc1) at quality=high, the setting the SwiftShader numbers used:
//   start     on the gyrocopter pad, no input
//   flight    the suite's gyro autopilot flying the course in real time
//   landmark  the gyro held still 220 m short of each landmark, facing it; the busiest is reported
//
// Borrows Tools/board-check's server, page prep and playwright-core, like test/browser.mjs.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BC = path.resolve(HERE, '..', '..', '..', 'Tools', 'board-check');
const { serve, prepPage } = await import(pathToFileURL(path.join(BC, 'harness.mjs')).href);
const { chromium } = createRequire(path.join(BC, 'package.json'))('playwright-core');

const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith('--' + k)); return a ? (a.includes('=') ? a.split('=')[1] : true) : d; };
const VSYNC = !!arg('vsync', false);
const SWIFT = !!arg('swiftshader', false); // the same run on Chrome's software GL, for comparison only
const [W, H] = String(arg('size', '1280x720')).split('x').map(Number);
const SECS = +arg('secs', 8);
const PORT = 8173; // test/browser.mjs uses 8172
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/Projects/skywings64/index.html?quality=high&touch=0&unlock=1`;

const LANDMARKS = {
  castle: [400, -500], heads: [1500, -300], lighthouse: [650, 1300], mountain: [-300, -400],
  windmills: [425, 420], cabins: [-336, 615], runway: [155, 470], bridge: [null, 380],
};

const server = await serve(PORT);
const flags = ['--mute-audio', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling', '--ignore-gpu-blocklist'];
if (!VSYNC) flags.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
if (SWIFT) flags.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel, headless: false, args: flags }); break; } catch (e) { /* next */ }
}
if (!browser) { console.error('no Chrome or Edge to launch'); process.exit(1); }
browser.__engine = 'playwright';

let code = 0;
try {
  const page = await prepPage(browser, BASE, { width: W, height: H, dsf: 1 });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__qa && window.__game && window.__sw && window.__sw.renderer, { timeout: 120000 });
  await page.evaluate(PAGE);
  const gpu = await page.evaluate(() => window.__gp.gpuInfo());
  console.log(`GPU: ${gpu.renderer}  (${gpu.vendor})`);
  console.log(`viewport ${W}x${H}, ${VSYNC ? 'vsync on' : 'frame-rate limit off'}, quality ${gpu.quality}, timer query: ${gpu.timer}, canvas ${gpu.canvas}`);
  if (!SWIFT && /swiftshader|llvmpipe|basic render|software/i.test(gpu.renderer)) { console.error('software renderer: numbers would be meaningless'); code = 1; }
  else {
    await page.evaluate(() => window.__gp.settle());
    const rows = [];
    const show = (label, r) => {
      rows.push({ label, ...r });
      console.log(`${label.padEnd(20)} ${String(r.frames).padStart(5)} fr  ` +
        `interval mean ${r.ms.mean} p50 ${r.ms.p50} p95 ${r.ms.p95} p99 ${r.ms.p99} max ${r.ms.max} ms  ` +
        `cpu ${r.cpu.mean}/${r.cpu.p95}  gpu ${r.gpu ? r.gpu.mean + '/' + r.gpu.p95 : '-'}  ` +
        `calls ${r.calls.p50} (${r.calls.min}-${r.calls.max})  tris ${(r.tris.p50 / 1e6).toFixed(2)} M (max ${(r.tris.max / 1e6).toFixed(2)})  pr ${r.pr}  ${r.state}`);
    };
    const bd = async (label) => { const b = await page.evaluate(() => window.__gp.breakdown()); console.log('  ' + label + ' passes ' + JSON.stringify(b.passes)); for (const t of b.top) console.log('    ' + t); };
    show('start (pad)', await page.evaluate((s) => window.__gp.start(s), SECS));
    await bd('start');
    const fl = await page.evaluate((s) => window.__gp.flight(s), SECS);
    fl.forEach((r, i) => {
      show(`flight ${i + 1} (${r.rings})`, r);
      if (r.bd) { console.log('  flight passes ' + JSON.stringify(r.bd.passes)); for (const t of r.bd.top) console.log('    ' + t); }
    });
    let best = null;
    for (const [name, [x, z]] of Object.entries(LANDMARKS)) {
      const r = await page.evaluate(([n, x, z, s]) => window.__gp.hold(n, x, z, s), [name, x, z, SECS]);
      show('over ' + name, r);
      if (['runway', 'lighthouse', 'cabins'].includes(name)) await bd(name);
      if (!best || r.tris.p50 > best.r.tris.p50) best = { name, r };
    }
    console.log(`\nbusiest landmark by triangles: ${best.name}`);
    const [bx, bz] = LANDMARKS[best.name];
    await page.evaluate(([n, x, z]) => window.__gp.hold(n, x, z, 1), [best.name, bx, bz]);
    const rep = await page.evaluate(() => window.__gp.report());
    console.log('static at that view: ' + JSON.stringify(rep));
    const errs = page.__errs || [];
    for (const e of errs) console.log('page error: ' + String(e).slice(0, 300));
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(code);

// ---------------------------------------------------------------- in-page side
function PAGE() {
  const q = window.__qa, g = q.game, sw = window.__sw, R = sw.renderer, gl = R.getContext();
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const hdTo = (v, x, z) => Math.atan2(-(x - v.position.x), -(z - v.position.z));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // per-frame instrumentation: renderer.info over every pass of one sw.render, its main-thread time,
  // and (if the extension is there) its GPU time
  R.info.autoReset = false;
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let rec = null, cpuU = 0, nRender = 0;
  const origRender = sw.render.bind(sw);
  sw.render = function (...a) {
    R.info.reset(); nRender++;
    let qy = null;
    if (tq && rec) { qy = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, qy); }
    const t0 = performance.now();
    const out = origRender(...a);
    const t1 = performance.now();
    if (qy) { gl.endQuery(tq.TIME_ELAPSED_EXT); pending.push({ q: qy, into: rec }); }
    if (rec) { rec.cpu.push(t1 - t0 + cpuU); rec.calls.push(R.info.render.calls); rec.tris.push(R.info.render.triangles); }
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) p.into.gpu.push(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p.q); pending.splice(i, 1);
      }
    }
    return out;
  };
  let hold = null;
  const origUpdate = g.update.bind(g);
  g.update = function (dt, el) {
    if (hold) { const v = g.vehicle; v.position.copy(hold.p); v.velocity.set(0, 0, 0); v.heading = hold.h; v.pitch = 0; v.roll = 0; }
    const t0 = performance.now(); const out = origUpdate(dt, el); cpuU = performance.now() - t0;
    return out;
  };
  let pilot = null;
  const inp = g.input, origIn = inp.update;
  inp.update = function (d) { origIn.call(inp, d); if (pilot) pilot(inp, g, d); };

  const stat = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), pick = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const r = (x) => Math.round(x * 100) / 100;
    return { mean: r(a.reduce((x, y) => x + y, 0) / a.length), p50: r(pick(0.5)), p95: r(pick(0.95)), p99: r(pick(0.99)), min: r(s[0]), max: r(s[s.length - 1]) };
  };
  async function measure(ms) {
    rec = { iv: [], cpu: [], gpu: [], calls: [], tris: [] };
    const r0 = rec;
    await new Promise((done) => {
      let last = 0; const end = performance.now() + ms;
      const f = (t) => { if (last) r0.iv.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else done(); };
      requestAnimationFrame(f);
    });
    rec = null; await sleep(200);
    return { frames: r0.iv.length, ms: stat(r0.iv), cpu: stat(r0.cpu), gpu: stat(r0.gpu), calls: stat(r0.calls), tris: stat(r0.tris),
      pr: sw.pixelRatio, state: g.state, pos: g.vehicle && g.vehicle.position.toArray().map(Math.round) };
  }

  // the suite's gyro autopilot (test/checks.js `powered('gyro')`), driving real-time input here
  function gyroPilot(i, g) {
    const v = g.vehicle, Wd = g.world, c = g.course, vmax = 24;
    if (!v || g.state !== 'FLIGHT') return;
    const r = c.openRing(); let a;
    if (r) {
      const s = (v.position.x - r.position.x) * r.normal.x + (v.position.y - r.position.y) * r.normal.y + (v.position.z - r.position.z) * r.normal.z;
      const k = clamp(s * 0.6, -45, 45);
      a = { x: r.position.x + r.normal.x * k, y: r.position.y + r.normal.y * k, z: r.position.z + r.normal.z * k, ring: r };
    } else { const t = c.getTarget(v); if (!t) return; a = { x: t.x, y: t.y, z: t.z, pad: true }; }
    const dist = Math.hypot(a.x - v.position.x, a.z - v.position.z);
    const herr = wrap(hdTo(v, a.x, a.z) - v.heading);
    const fwd = -Math.sin(v.heading) * v.velocity.x - Math.cos(v.heading) * v.velocity.z;
    const gy = Math.max(0, Wd.heightAt(v.position.x, v.position.z));
    let ahead = gy;
    for (const s of [0.5, 1, 2, 3, 4.5]) ahead = Math.max(ahead, Wd.heightAt(v.position.x + v.velocity.x * s, v.position.z + v.velocity.z * s));
    let ty, vdes;
    if (a.ring) { ty = a.ring.position.y; vdes = clamp(dist * 0.5, 12, vmax); }
    else { ty = dist > 25 ? Math.max(a.y + 25, gy + 20) : a.y; vdes = clamp(dist * 0.3, 0, vmax); }
    ty = Math.max(ty, ahead + (a.pad && dist < 25 ? -100 : 14));
    i.yaw = clamp(-herr * 2.5, -1, 1);
    i.roll = fwd > 6 ? clamp(-herr * 1.2, -0.7, 0.7) : 0;
    i.pitch = clamp(((Math.abs(herr) > 0.8 ? 0 : vdes) - fwd) * 0.12, -0.8, 1);
    let vyDes = clamp((ty - v.position.y) * 0.5, -5, 8);
    if (a.pad && dist < 10 && Math.hypot(v.velocity.x, v.velocity.z) < 4) { vyDes = v.altitude > 6 ? -3 : -1.2; i.pitch = clamp(-fwd * 0.3, -0.5, 0.5); i.roll = 0; }
    i.throttle = clamp(0.5 + (vyDes - v.velocity.y) * 0.12, 0, 1);
  }

  window.__gp = {
    gpuInfo() {
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), timer: !!tq, quality: sw.quality, canvas: R.domElement.width + 'x' + R.domElement.height };
    },
    async settle() {
      q.start('gc1');
      if (window.__models) await window.__models.allModelsSettled?.();
      await sleep(8000); // models, lazy vegetation cells, shader compiles
    },
    async start(secs) { hold = null; pilot = null; q.start('gc1'); await sleep(3000); return measure(secs * 1000); },
    async flight(secs) {
      hold = null; q.start('gc1'); pilot = gyroPilot;
      const out = [];
      for (let k = 0; k < 6 && g.state === 'FLIGHT'; k++) { const r = await measure(secs * 1000); r.rings = g.course.hits + '/' + g.course.ringsTotal; if (k === 1) r.bd = await window.__gp.breakdown(); out.push(r); }
      pilot = null;
      return out;
    },
    async hold(name, x, z, secs) {
      pilot = null; q.start('gc1');
      const Wd = g.world;
      if (x == null) { // the bridge spans the canyon at z; find the canyon's low point along it
        let bx = 0, by = Infinity; for (let t = -1200; t <= 1200; t += 10) { const y = Wd.heightAt(t, z); if (y < by && y > -5) { by = y; bx = t; } } x = bx;
      }
      const px = x, pz = z + 220, gy = Math.max(Wd.heightAt(x, z), Wd.heightAt(px, pz), 0);
      const p = new g.vehicle.position.constructor(px, gy + 60, pz);
      hold = { p, h: Math.atan2(-(x - px), -(z - pz)) };
      await sleep(3000);
      const r = await measure(secs * 1000); r.at = [Math.round(x), Math.round(z)];
      window.__gp.last = name;
      return r;
    },
    // one frame, attributed: every renderBufferDirect call (one draw) by pass and by the top-level scene
    // group the object hangs from (or its own name)
    async breakdown() {
      const passes = {}, owners = {};
      let pass = 'main';
      const sm = R.shadowMap, smr = sm.render.bind(sm);
      sm.render = function (...a) { const p = pass; pass = 'shadow'; try { return smr(...a); } finally { pass = p; } };
      const origR = R.render.bind(R);
      R.render = function (s, c) { const p = pass; if (pass !== 'shadow') pass = s === sw.scene ? 'scene' : 'post'; try { return origR(s, c); } finally { pass = p; } };
      const rbd = R.renderBufferDirect;
      R.renderBufferDirect = function (cam, scn, geo, mat, obj, grp) {
        const tri = geo.index ? geo.index.count / 3 : (geo.attributes.position ? geo.attributes.position.count / 3 : 0);
        const n = obj.isInstancedMesh ? obj.count : 1;
        const pp = passes[pass] || (passes[pass] = { calls: 0, tris: 0 }); pp.calls++; pp.tris += tri * n;
        if (pass === 'scene' || pass === 'shadow') {
          const chain = []; for (let o = obj; o && o !== sw.scene; o = o.parent) chain.unshift(o.name || o.type);
          const key = pass + ':' + chain.slice(0, chain[0] === 'landmarks' ? 2 : 1).join('/');
          const w = owners[key] || (owners[key] = { calls: 0, tris: 0 }); w.calls++; w.tris += tri * n;
        }
        return rbd.call(R, cam, scn, geo, mat, obj, grp);
      };
      const n0 = nRender;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const nf = Math.max(1, nRender - n0);
      for (const o of [passes, owners]) for (const k in o) { o[k].calls = Math.round(o[k].calls / nf); o[k].tris = Math.round(o[k].tris / nf); }
      R.renderBufferDirect = rbd; R.render = origR; sm.render = smr;
      const top = Object.entries(owners).sort((a, b) => b[1].calls - a[1].calls).slice(0, 18)
        .map(([k, v]) => k + ' ' + v.calls + ' calls ' + (v.tris / 1e3).toFixed(0) + 'k tris');
      return { passes, top, shadow: { type: R.shadowMap.type, enabled: R.shadowMap.enabled } };
    },
    async report() {
      const m = await import(new URL('src/render/perf.js', location.href).href);
      const o = m.perfReport(R, sw.scene);
      return { programs: o.memory.programs, geometries: o.memory.geometries, textures: o.memory.textures, meshes: o.scene.meshes,
        visibleMeshes: o.scene.visibleMeshes, instanced: o.scene.instanced, instances: o.scene.instances, materials: o.scene.materials,
        texMB: o.textures.estMB, instancingCandidates: o.instancingCandidates.slice(0, 6) };
    },
  };
}
