// Frame sequence of a fast hero on open ground, stepped at 1/60 s per frame, cropped around the hero, to judge whether the
// every-second-frame sun shadow map (World.scheduleShadows) lags visibly behind a moving unit.
// Usage: node scripts/shadow_motion.mjs <url> <outDir> [quality=high] [frames=8]
import { chromium } from 'playwright';
const [,, url, out, quality = 'high', frames = 8] = process.argv;
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
await p.evaluate((q) => { window.game.ui.settings.set?.('quality', q); }, quality);
await p.evaluate(() => window.game.startMatch({ heroId: 'sera' }));
await p.waitForTimeout(1500);
await p.evaluate(() => {
  const g = window.game, h = g.player.hero;
  g.renderer.setAnimationLoop(null); g.fixedDt = 1 / 60;
  h.position.set(-60, 0, 60); h.addModifier({ id: 'zoom', name: '', hidden: true, duration: 60, bonus: { moveSpeed: 6 } });
  g.cameraCtl.desiredDistance = 18; g.cameraCtl.focus(h.position.x, h.position.z, true);
  h.issueOrder({ type: 'move', point: h.position.clone().setX(-10) });
  for (let i = 0; i < 40; i++) g.tick();
});
console.log('quality', await p.evaluate(() => window.game.world.quality));
for (let i = 0; i < +frames; i++) {
  const info = await p.evaluate(() => { const g = window.game, h = g.player.hero; g.cameraCtl.focus(h.position.x, h.position.z, true); g.tick(); return { sh: g.world.shadowThisFrame, x: +h.position.x.toFixed(2), ms: h.getStat('moveSpeed') }; });
  await p.screenshot({ path: `${out}/f${i}.png`, clip: { x: 440, y: 210, width: 400, height: 300 } });
  console.log(i, JSON.stringify(info));
}
await b.close();
