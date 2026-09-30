// GPU cost experiments: toggles scene parts / passes and measures finish()-synced frame time (median of rounds).
// usage: node scripts/ws2_gpuexp.mjs <url> [high|low]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const quality = process.argv[3] || 'high';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript((q) => {
  try { localStorage.setItem('throneshard.world.quality', q); const k = 'throneshard-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.quality = q; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
  let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}, quality);
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
const r = await p.evaluate(async () => {
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
  g.renderer.render = () => {}; g.composer = null;
  for (let i = 0; i < 10; i++) g.tick();
  g.renderer.render = rr; g.composer = comp;
  const R = g.renderer, fin = () => R.getContext().finish();
  const W = g.world, P = W.post;
  const find = (name) => g.scene.children.find((o) => o.name === name);
  const exps = {
    base: [() => {}, () => {}],
    noShadowUpd: [() => { R.shadowMap.autoUpdate = false; }, () => { R.shadowMap.autoUpdate = true; }],
    noFoliage: [() => { W.foliage.group.visible = false; }, () => { W.foliage.group.visible = true; }],
    noGround: [() => { W.ground.visible = false; }, () => { W.ground.visible = true; }],
    noProps: [() => { W.props.group.visible = false; }, () => { W.props.group.visible = true; }],
    noRiver: [() => { W.river.visible = false; }, () => { W.river.visible = true; }],
    noLights: [() => { for (const l of W.props.lights) l.visible = false; }, () => { for (const l of W.props.lights) l.visible = true; }],
    noBloom: [() => { P.bloom.enabled = false; }, () => { P.bloom.enabled = true; }],
    noSmaa: [() => { P.smaa.enabled = false; }, () => { P.smaa.enabled = W.quality === 'high'; }],
    noGrade: [() => { P.grade.enabled = false; }, () => { P.grade.enabled = true; }],
    terrLQ: [() => { W.terrainMat.userData.uniforms.uHQ.value = 0; }, () => { W.terrainMat.userData.uniforms.uHQ.value = W.quality === 'high' ? 1 : 0; }],
    noGrass: [() => { for (const m of W.foliage.grassMeshes) m.visible = false; }, () => { for (const m of W.foliage.grassMeshes) m.visible = m.count > 0; }],
    noTrees: [() => { for (const m of W.foliage.treeMeshes) m.userData.v = m.visible, m.visible = false; }, () => { for (const m of W.foliage.treeMeshes) m.visible = m.userData.v; }],
    noUnits: [() => { for (const u of g.units) if (u.object) u.object.userData.v = u.object.visible, u.object.visible = false; }, () => { for (const u of g.units) if (u.object) u.object.visible = u.object.userData.v; }],
    rawOnly: [() => { g.composer = null; }, () => { g.composer = comp; }],
  };
  const render = () => { if (g.composer) g.composer.render(0.016); else rr(g.scene, g.camera); };
  const res = {};
  for (const k in exps) res[k] = [];
  for (let round = 0; round < 7; round++) {
    for (const [k, [on, off]] of Object.entries(exps)) {
      on(); render(); fin();
      const t = performance.now();
      for (let i = 0; i < 8; i++) render();
      fin();
      res[k].push((performance.now() - t) / 8);
      off();
    }
  }
  const med = (a) => { a = [...a].sort((x, y) => x - y); return +a[a.length >> 1].toFixed(2); };
  const out = {};
  for (const k in res) out[k] = med(res[k]);
  return out;
});
console.log(JSON.stringify(r));
await b.close();
