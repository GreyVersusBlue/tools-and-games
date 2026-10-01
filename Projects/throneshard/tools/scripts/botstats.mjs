import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => { errs.push('pageerror: ' + e.message); console.log('pageerror', e.message); });
await p.goto(process.argv[2] || 'http://localhost:4173');
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
const r = await p.evaluate((min) => {
  const g = window.game; g.startMatch({ heroId: 'sera' }); g.ai.setPlayerAutoplay?.(true);
  const casts = {}; g.bus.on('ability:cast', ({ hero, ability }) => { const k = (hero?.heroId ?? '?') + '.' + (ability?.def?.id ?? '?'); casts[k] = (casts[k] ?? 0) + 1; });
  let items = 0; g.bus.on('item:used', () => items++);
  g.renderer.setAnimationLoop(null); window.__rr = g.renderer.render; window.__comp = g.composer; g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < min * 60 * 20 && !g.matchOver; i++) g.tick();
  return { time: Math.round(g.time), over: g.matchOver, winner: g.winner, score: g.rules.score, itemUses: items, totalCasts: Object.values(casts).reduce((a, b) => a + b, 0), casts };
}, +(process.argv[3] || 15));
delete r.casts; console.log(JSON.stringify(r));
if (r.over) { await p.evaluate(() => { const g = window.game; g.renderer.render = window.__rr; g.composer = window.__comp; g.fixedDt = undefined; g.renderer.setAnimationLoop(() => g.tick()); }); await p.setViewportSize({ width: 1280, height: 720 }); await p.waitForTimeout(4000); await p.screenshot({ path: (process.env.SHOT_DIR || '/tmp') + '/play_end.png' }); }
const uniq = [...new Set(errs)];
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 40).join('\n'));
await b.close();
