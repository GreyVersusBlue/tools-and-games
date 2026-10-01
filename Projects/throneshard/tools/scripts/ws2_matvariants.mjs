// Diagnostic: find materials shared by objects that need different shader programs (instancing/skinning/
// receiveShadow/vertex colors...), which makes three.js re-resolve programs (getParameters) every draw.
// usage: node scripts/ws2_matvariants.mjs <url>
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
const r = await p.evaluate(async () => {
  const g = window.game;
  g.startMatch({ heroId: 'sera' });
  g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null);
  const rr = g.renderer.render.bind(g.renderer), comp = g.composer;
  g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < 3 * 60 * 20; i++) g.tick();
  g.renderer.render = rr; g.composer = comp; g.fixedDt = undefined;
  g.renderer.setAnimationLoop(() => g.tick());
  await new Promise((r) => setTimeout(r, 1500));
  const mats = new Map();
  g.scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isSprite && !o.isLine) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m) continue;
      const v = [o.isInstancedMesh ? 'inst' : '', o.isSkinnedMesh ? 'skin' : '', o.receiveShadow ? 'rs' : '', o.geometry?.attributes?.color ? 'vc' : '', o.instanceColor ? 'ic' : '', o.isBatchedMesh ? 'batch' : '', Object.keys(o.geometry?.morphAttributes ?? {}).length ? 'morph' : ''].join('|');
      if (!mats.has(m)) mats.set(m, new Map());
      const mm = mats.get(m);
      let n = o.name; let x = o; while (x && !n) { x = x.parent; n = x?.name; }
      mm.set(v, (mm.get(v) ?? []).concat(n || o.type));
    }
  });
  const out = [];
  for (const [m, vs] of mats) if (vs.size > 1) out.push({ mat: m.type + ':' + (m.name || '') + ':' + m.uuid.slice(0, 6), variants: [...vs].map(([k, v]) => k + ' x' + v.length + ' e.g. ' + [...new Set(v)].slice(0, 3).join(',')) });
  // per-frame program-change detection: count material.version bumps over 60 frames
  const ver = new Map(); for (const m of mats.keys()) ver.set(m, m.version);
  await new Promise((r) => setTimeout(r, 1000));
  const bumped = []; for (const [m, v] of ver) if (m.version !== v) bumped.push(m.type + ':' + (m.name || '') + ' +' + (m.version - v) + ' used by ' + [...mats.get(m).values()].flat().slice(0, 4).join(',') + ' transparent=' + m.transparent + ' map=' + !!m.map);
  const stacks = new Set();
  for (const [m, v] of ver) if (m.version !== v) {
    let at = m._alphaTest;
    Object.defineProperty(m, 'needsUpdate', { set(x) { stacks.add('needsUpdate ' + new Error().stack.split('\n').slice(2, 5).join(' <- ')); if (x) m.version++; }, configurable: true });
    Object.defineProperty(m, 'alphaTest', { get() { return at; }, set(x) { if ((at > 0) !== (x > 0)) { stacks.add('alphaTest ' + new Error().stack.split('\n').slice(2, 5).join(' <- ')); m.version++; } at = x; }, configurable: true });
  }
  await new Promise((r) => setTimeout(r, 500));
  return { stacks: [...stacks], nMats: mats.size, shared: out, bumped: bumped.slice(0, 30), programs: g.renderer.info.programs.length };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
