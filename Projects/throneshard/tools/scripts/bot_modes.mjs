// Time-in-mode histogram for bot heroes over the first N minutes: which `debug` states the laners spend the time in.
// Usage: node scripts/bot_modes.mjs [url] [difficulty=normal] [minutes=10] [seed=1]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5185', diff = process.argv[3] || 'normal', min = +(process.argv[4] || 10), s = +(process.argv[5] || 1);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
await p.addInitScript((s) => { let a = s * 7919; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, s);
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
const r = await p.evaluate(({ min, diff }) => {
  const g = window.game;
  g.startMatch({ heroId: 'kenshar', allies: ['brakka', 'aldric', 'isolde', 'vashkar'], enemies: ['sable', 'gorrow', 'pell', 'morvane', 'thalor'], difficulty: diff });
  g.ai.setPlayerAutoplay(true);
  g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  const hist = {}, mel = g.heroes.filter((h) => h.isMelee);
  for (let i = 0; i < min * 60 * 20; i++) {
    g.tick();
    if (i % 20) continue;
    for (const h of mel) { const c = h.controller; const k = !h.alive ? 'dead' : `${c?.mode ?? '?'}/${(c?.debug ?? '').split(' ')[0]}`; hist[k] = (hist[k] ?? 0) + 1; }
  }
  return { hist, lh: mel.map((h) => `${h.heroId}=${h.lastHits}`).join(' ') };
}, { min, diff });
const tot = Object.values(r.hist).reduce((a, b) => a + b, 0);
console.log(diff, r.lh);
console.log(Object.entries(r.hist).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(0)}%`).join('  '));
await b.close();
