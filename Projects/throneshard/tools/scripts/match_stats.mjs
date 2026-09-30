// Full bots-only match with feature/bot-quality statistics (WS5).
// Usage: node scripts/match_stats.mjs [url] [maxMinutes=60] [difficulty=normal] [seed=1] [heroId]
// Prints: duration, winner, Grimmaw kills, runes taken, wards placed, buybacks, talents chosen, melee last hits @10min.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5185';
const maxMin = +(process.argv[3] || 60);
const diff = process.argv[4] || 'normal';
const seed = +(process.argv[5] || 1);
const heroId = process.argv[6] || null;
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
await p.addInitScript((s) => { let a = s * 2654435761; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, seed);
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.evaluate(({ diff, heroId }) => {
  const g = window.game;
  g.startMatch({ heroId: heroId ?? Object.keys(g.heroDefs)[0], difficulty: diff });
  g.ai.setPlayerAutoplay?.(true);
  if (diff === 'mixed') { g.difficulty = 'normal'; g.ai.setTeamDifficulty('sunward', 'hard'); g.ai.setTeamDifficulty('duskward', 'normal'); }
  const S = (window.__S = { runes: {}, wards: { observer: 0, sentry: 0 }, wardKills: 0, buybacks: [], talents: {}, grim: [], lh10: null, scepters: 0 });
  g.bus.on('rune:picked', ({ hero, type }) => { S.runes[type] = (S.runes[type] ?? 0) + 1; });
  g.bus.on('ward:placed', ({ type }) => { S.wards[type] = (S.wards[type] ?? 0) + 1; });
  g.bus.on('unit:died', ({ unit }) => { if (unit.kind === 'ward') S.wardKills++; });
  g.bus.on('hero:buyback', ({ hero }) => S.buybacks.push(`${hero.team[0]}:${hero.heroId}@${(g.time / 60).toFixed(1)}`));
  g.bus.on('talent:chosen', ({ hero, tier, index }) => { S.talents[`${hero.heroId}`] = (S.talents[hero.heroId] ?? '') + `${tier}${'LR'[index]} `; });
  g.bus.on('grimmaw:killed', (e) => S.grim.push(`${(e?.killer?.team ?? e?.team ?? '?')}@${(g.time / 60).toFixed(1)}`));
  g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  window.__step = (secs) => { const n = Math.round(secs / 0.05); for (let i = 0; i < n && !g.matchOver; i++) { g.composer = null; g.tick(); } };
}, { diff, heroId });
const t0 = Date.now();
for (let m = 1; m <= maxMin; m++) {
  await p.evaluate(() => window.__step(60));
  const info = await p.evaluate(() => {
    const g = window.game, S = window.__S;
    if (g.time >= 600 && !S.lh10) S.lh10 = g.heroes.map((h) => ({ id: h.heroId, team: h.team, melee: h.isMelee, lh: h.lastHits, dn: h.denies }));
    return { t: g.time, over: g.matchOver, snap: g.ai.snapshot() };
  });
  if (m % 5 === 0 || info.over) console.log(`t=${(info.t / 60).toFixed(1)} towers=${JSON.stringify(info.snap.towers)} rax=${JSON.stringify(info.snap.rax)} score=${JSON.stringify(info.snap.score)} grim=${info.snap.grimmawKills} plans=${info.snap.plans}`);
  if (info.over) break;
}
const res = await p.evaluate(() => {
  const g = window.game, S = window.__S;
  const lh10 = S.lh10 ?? [];
  const melee = lh10.filter((h) => h.melee), ranged = lh10.filter((h) => !h.melee);
  const avg = (a, k) => (a.length ? +(a.reduce((s, h) => s + h[k], 0) / a.length).toFixed(1) : 0);
  return {
    minutes: +(g.time / 60).toFixed(1), over: g.matchOver, winner: g.winner, score: g.rules.score,
    grimmawKills: g.ai.neutrals.grimmawKills, grim: S.grim, runes: S.runes, wards: S.wards, wardKills: S.wardKills, buybacks: S.buybacks,
    grimmawAttempts: g.ai.stats.grimmawAttempts ?? 0, grimmawContests: g.ai.stats.grimmawContests ?? 0, runeStats: g.runes?.stats,
    talents: S.talents, scepters: g.heroes.filter((h) => h.data.hasScepter).map((h) => h.heroId),
    meleeLh10: avg(melee, 'lh'), rangedLh10: avg(ranged, 'lh'), lh10: lh10.map((h) => `${h.team[0]}:${h.id}${h.melee ? '(m)' : ''}=${h.lh}/${h.dn}`).join(' '),
    heroes: g.heroes.map((h) => `${h.team[0]}:${h.heroId} L${h.level} ${h.kills}/${h.deaths}/${h.assists} lh${h.lastHits}`).join(' | '),
  };
});
console.log(JSON.stringify(res, null, 1));
console.log('real seconds', ((Date.now() - t0) / 1000).toFixed(0));
const uniq = [...new Set(errs.map((e) => e.slice(0, 220)))];
console.log('errors/warnings:', errs.length, 'unique:', uniq.length, uniq.slice(0, 12));
await b.close();
