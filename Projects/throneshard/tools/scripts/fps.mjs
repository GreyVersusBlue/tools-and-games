import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.goto('http://localhost:4173');
await p.waitForSelector('.btn-play', { timeout: 180000 });
for (const q of ['high','low']) {
  const r = await p.evaluate(async (q) => { game.world.setQuality?.(q); await new Promise(r=>setTimeout(r,500)); const f0 = game.frame, t0 = performance.now(); await new Promise(r=>setTimeout(r,5000)); return { q, fps: (game.frame-f0)/((performance.now()-t0)/1000), calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles }; }, q);
  console.log(r);
}
await b.close();
