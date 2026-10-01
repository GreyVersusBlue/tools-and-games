// CPU profile (V8 sampling) of the live game loop mid-fight: prints the top self-time functions.
// usage: node scripts/ws2_cpuprof.mjs <url> [high|low] [seconds=6]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const quality = process.argv[3] || 'high';
const secs = +(process.argv[4] || 6);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript((q) => {
  try { localStorage.setItem('throneshard.world.quality', q); const k = 'throneshard-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.quality = q; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
  let a = 12345; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}, quality);
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
await p.evaluate(() => {
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
  g.renderer.setAnimationLoop(() => g.tick());
});
await p.waitForTimeout(1500);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await p.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const cf = n.callFrame;
  const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
for (const [k, v] of top) console.log(((v / total) * 100).toFixed(1).padStart(5) + '%', (v / 1000 / secs).toFixed(1).padStart(6) + 'ms/s', k);
void dt;
await b.close();
