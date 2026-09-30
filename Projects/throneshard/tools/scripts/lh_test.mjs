// Last-hit benchmark for bots (fixed line-ups, several seeds, first N minutes).
// Usage: node scripts/lh_test.mjs [url] [minutes=10] [seeds=3] [legacy=0] [difficulty=normal]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5185';
const min = +(process.argv[3] || 10), seeds = +(process.argv[4] || 3), legacy = process.argv[5] === '1', diff = process.argv[6] || 'normal';
const LINEUPS = [
  { heroId: 'kenshar', allies: ['brakka', 'aldric', 'isolde', 'vashkar'], enemies: ['sable', 'gorrow', 'pell', 'morvane', 'thalor'] },
  { heroId: 'sable', allies: ['gorrow', 'kenshar', 'morvane', 'thalor'], enemies: ['brakka', 'aldric', 'vesna', 'sera', 'isolde'] },
];
const all = { melee: [], ranged: [] };
for (let s = 1; s <= seeds; s++) {
  const lu = LINEUPS[(s - 1) % LINEUPS.length];
  const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  await p.addInitScript((s) => { let a = s * 7919; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, s);
  await p.goto(url);
  await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
  const r = await p.evaluate(({ lu, min, legacy, diff }) => {
    const g = window.game;
    g.botLegacyLastHit = legacy;
    g.startMatch({ ...lu, difficulty: diff });
    g.ai.setPlayerAutoplay(true);
    g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
    for (let i = 0; i < min * 60 * 20; i++) g.tick();
    return g.heroes.map((h) => ({ id: h.heroId, melee: h.isMelee, lh: h.lastHits, dn: h.denies, lane: h.lane }));
  }, { lu, min, legacy, diff });
  for (const h of r) all[h.melee ? 'melee' : 'ranged'].push(h);
  console.log(`seed ${s}:`, r.map((h) => `${h.id}${h.melee ? '(m)' : ''}[${h.lane}]=${h.lh}/${h.dn}`).join(' '));
  await b.close();
}
const avg = (a) => (a.reduce((x, h) => x + h.lh, 0) / Math.max(1, a.length)).toFixed(1);
console.log(`${legacy ? 'LEGACY' : 'NEW'} ${diff}: melee LH@${min}m avg ${avg(all.melee)} (n=${all.melee.length}), ranged ${avg(all.ranged)} (n=${all.ranged.length})`);
