// Extended profiler (same seed/fast-forward as profile.mjs) with quality selection, world sub-system timings,
// main vs shadow draw-call split, and GPU-synchronised timings of the render pieces.
// usage: node scripts/ws2_perf.mjs <url> [high|low] [seconds=8] [screenshot.png]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const quality = process.argv[3] || 'high';
const secs = +(process.argv[4] || 8);
const shot = process.argv[5];
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript((q) => {
  try { localStorage.setItem('throneshard.world.quality', q); const k = 'throneshard-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.quality = q; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
  let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}, quality);
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
const r = await p.evaluate(async (secs) => {
  const g = window.game;
  g.startMatch({ heroId: 'sera' });
  g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null);
  const rr = g.renderer.render.bind(g.renderer), comp = g.composer;
  g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < 6 * 60 * 20; i++) g.tick();
  g.renderer.render = rr; g.composer = comp; g.fixedDt = undefined;
  const mid = g.heroes.find(h => h.team === 'sunward' && h.lane === 'mid') ?? g.player.hero;
  g.cameraCtl.focus(mid.position.x, mid.position.z, true);
  const T = {};
  const wrap = (name, obj, fn) => { if (!obj?.[fn]) return; const o = obj[fn].bind(obj); obj[fn] = (...a) => { const t = performance.now(); const res = o(...a); T[name] = (T[name] ?? 0) + performance.now() - t; return res; }; };
  for (const s of ['ai', 'rules', 'projectiles', 'abilities', 'items', 'world', 'vfx', 'cameraCtl', 'input', 'audio', 'ui']) if (g[s]?.update) wrap(s, g[s], 'update');
  const W = g.world;
  wrap('w.fogCompute', W, 'computeFog');
  wrap('w.fogTexture', W.fog, 'updateTexture');
  wrap('w.unitVis', W, 'applyUnitVisibility');
  wrap('w.foliage', W.foliage, 'update');
  wrap('w.lights', W.props, 'updateLights');
  wrap('w.atmoFollow', W.atmo, 'follow');
  wrap('w.atmoTime', W.atmo, 'applyTime');
  if (g.composer) wrap('render', g.composer, 'render'); else wrap('render', g.renderer, 'render');
  wrap('tickTotal', g, 'tick');
  const U = Object.getPrototypeOf(Object.getPrototypeOf(g.player.hero));
  const upd = U.update; U.update = function (dt) { const t = performance.now(); upd.call(this, dt); T.unitUpdate = (T.unitUpdate ?? 0) + performance.now() - t; };
  g.renderer.setAnimationLoop(() => g.tick());
  // frame time distribution
  const ft = []; let last = performance.now();
  const rafLoop = () => { const n = performance.now(); ft.push(n - last); last = n; if (ft.length < 100000) requestAnimationFrame(rafLoop); };
  const f0 = g.frame, t0 = performance.now();
  await new Promise(r => setTimeout(r, secs * 1000));
  const frames = g.frame - f0, el = (performance.now() - t0) / 1000;
  const out = { fps: +(frames / el).toFixed(1), units: g.units.filter(u => u.alive).length };
  for (const k in T) out[k] = +(T[k] / frames).toFixed(2);
  const R = g.renderer;
  R.info.autoReset = false;
  R.info.reset(); R.shadowMap.needsUpdate = true; rr(g.scene, g.camera);
  out.calls = R.info.render.calls; out.tris = R.info.render.triangles;
  R.shadowMap.autoUpdate = false; R.info.reset(); rr(g.scene, g.camera);
  out.mainCalls = R.info.render.calls; out.mainTris = R.info.render.triangles;
  out.shadowCalls = out.calls - out.mainCalls; out.shadowTris = out.tris - out.mainTris;
  R.shadowMap.autoUpdate = true; R.info.autoReset = true;
  out.programs = R.info.programs?.length; out.geometries = R.info.memory.geometries; out.textures = R.info.memory.textures;
  out.quality = g.world.quality;
  const fin = () => R.getContext().finish();
  const time = (fn) => { fn(); fin(); const t = performance.now(); for (let i = 0; i < 10; i++) fn(); fin(); return +((performance.now() - t) / 10).toFixed(2); };
  let objs = 0; g.scene.traverse(() => objs++); out.objs = objs;
  out.updMatrixWorld = time(() => g.scene.updateMatrixWorld());
  out.gpuFull = time(() => comp.render(0.016));
  out.gpuRaw = time(() => rr(g.scene, g.camera));
  R.shadowMap.autoUpdate = false; out.gpuRawNoShadow = time(() => rr(g.scene, g.camera)); R.shadowMap.autoUpdate = true;
  out.gpuFull2 = time(() => comp.render(0.016));
  out.fogTexCells = g.world.fog.W;
  return out;
}, secs);
if (shot) await p.screenshot({ path: shot });
r.errors = errors.slice(0, 10);
console.log(JSON.stringify(r));
await b.close();
