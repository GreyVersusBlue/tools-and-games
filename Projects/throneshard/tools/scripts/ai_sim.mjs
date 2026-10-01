// Headless bots-only match simulation for the AI module.
// Usage: node scripts/ai_sim.mjs [url] [maxMinutes] [difficulty] [shotEveryMin]
// Steps the game with a fixed 0.05s tick without rendering (except for occasional screenshots to /tmp/ai_*.png).
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5178';
const maxMin = +(process.argv[3] || 60);
const diff = process.argv[4] || 'normal';
const shotEvery = +(process.argv[5] || 0);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || /\[AI\]/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForFunction(() => window.game && window.game.renderer && window.game.ai, null, { timeout: 60000 });
await p.waitForTimeout(3000);
const setup = await p.evaluate((diff) => {
  const g = window.game;
  if (!g.running) g.startMatch({ heroId: Object.keys(g.heroDefs)[0], difficulty: diff });
  g.difficulty = diff;
  g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null);
  g.__render = g.renderer.render.bind(g.renderer);
  g.__composer = g.composer;
  g.renderer.render = () => {};
  g.composer = null;
  g.fixedDt = 0.05;
  g.timeScale = 1;
  window.__step = (secs) => {
    const n = Math.round(secs / 0.05);
    const t0 = performance.now();
    for (let i = 0; i < n && !g.matchOver; i++) {
      g.composer = null;
      g.tick();
    }
    return performance.now() - t0;
  };
  return { heroes: g.heroes.map((h) => h.heroId + ':' + h.team + ':' + h.lane), units: g.units.length };
}, diff);
console.log('setup', JSON.stringify(setup));
let lastShot = 0;
for (let m = 1; m <= maxMin * 2; m++) {
  const ms = await p.evaluate(() => window.__step(30));
  const snap = await p.evaluate(() => window.game.ai.snapshot());
  const over = await p.evaluate(() => window.game.matchOver ? { winner: window.game.winner, time: window.game.time } : null);
  if (m % 2 === 0 || over) {
    console.log(`--- t=${(snap.time / 60).toFixed(1)}m sim ${ms.toFixed(0)}ms/30s units=${snap.units} creeps=${snap.creeps} towers=${JSON.stringify(snap.towers)} rax=${JSON.stringify(snap.rax)} throne=${snap.throneshard} plans=${snap.plans} score=${JSON.stringify(snap.score)} grimmaw=${snap.grimmawKills}`);
    for (const h of snap.heroes) console.log('   ', h);
  }
  if (shotEvery && snap.time / 60 - lastShot >= shotEvery) {
    lastShot = snap.time / 60;
    await p.evaluate(() => { const g = window.game; g.__render(g.scene, g.camera); });
    await p.screenshot({ path: `/tmp/ai_${Math.round(snap.time / 60)}.png` });
  }
  if (over) { console.log('MATCH OVER', JSON.stringify(over), (over.time / 60).toFixed(1), 'min'); break; }
}
console.log('errors:', errs.slice(0, 30));
await b.close();
