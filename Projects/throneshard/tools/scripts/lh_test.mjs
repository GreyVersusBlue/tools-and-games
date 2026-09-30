// Last-hit benchmark for bots (fixed line-ups, several seeds, first N minutes).
// Usage: node scripts/lh_test.mjs [url] [minutes=10] [seeds=3] [legacy=0] [difficulty=normal]
// DIFF_OVERRIDE='{"hard":{"harass":0.12}}' patches the DIFFICULTY profiles in the page before the match, for A/B runs.
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
  const r = await p.evaluate(async ({ lu, min, legacy, diff, ov }) => {
    const g = window.game;
    if (ov) { const { DIFFICULTY } = await import('/Projects/throneshard/src/ai/BotBrain.js'); for (const k of Object.keys(ov)) Object.assign(DIFFICULTY[k], ov[k]); }
    g.botLegacyLastHit = legacy;
    g.startMatch({ ...lu, difficulty: diff });
    g.ai.setPlayerAutoplay(true);
    g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
    for (let i = 0; i < min * 60 * 20; i++) g.tick();
    return g.heroes.map((h) => ({ id: h.heroId, melee: h.isMelee, lh: h.lastHits, dn: h.denies, lane: h.lane }));
  }, { lu, min, legacy, diff, ov: process.env.DIFF_OVERRIDE ? JSON.parse(process.env.DIFF_OVERRIDE) : null });
  for (const h of r) all[h.melee ? 'melee' : 'ranged'].push(h);
  console.log(`seed ${s}:`, r.map((h) => `${h.id}${h.melee ? '(m)' : ''}[${h.lane}]=${h.lh}/${h.dn}`).join(' '));
  await b.close();
}
const med = (a) => { const v = a.map((h) => h.lh).sort((x, y) => x - y); return v.length ? (v[v.length >> 1] + v[(v.length - 1) >> 1]) / 2 : 0; };
const avg = (a) => (a.reduce((x, h) => x + h.lh, 0) / Math.max(1, a.length)).toFixed(1);
console.log(`${legacy ? 'LEGACY' : 'NEW'} ${diff}: melee LH@${min}m avg ${avg(all.melee)} (n=${all.melee.length}), ranged ${avg(all.ranged)} (n=${all.ranged.length}); medians melee ${med(all.melee)}, ranged ${med(all.ranged)}`);
