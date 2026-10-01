// WS5 quick feature smoke: runes / talents / scepter / buyback / wards. Usage: node scripts/ws5_smoke.mjs [url] [minutes]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5185';
const min = +(process.argv[3] || 3);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message + e.stack));
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
await p.waitForTimeout(1000);
const r = await p.evaluate((min) => {
  const g = window.game;
  g.startMatch({ heroId: 'sera' });
  g.ai.setPlayerAutoplay(true);
  const ev = { runes: {}, wards: 0, talents: [], bb: 0 };
  g.bus.on('rune:picked', ({ hero, type }) => { ev.runes[type] = (ev.runes[type] ?? 0) + 1; });
  g.bus.on('ward:placed', () => ev.wards++);
  g.bus.on('talent:chosen', ({ hero, tier, talent }) => ev.talents.push(hero.heroId + ':' + tier + ':' + talent.name));
  g.bus.on('hero:buyback', () => ev.bb++);
  g.renderer.setAnimationLoop(null); g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < min * 60 * 20 && !g.matchOver; i++) g.tick();
  const h = g.player.hero;
  // force talents / scepter test on player hero
  h.addXp(40000); const lvl = h.level;
  const lag = h.abilities[3]; while (h.canLevelAbility(3)) h.levelAbility(3);
  const before = lag.v('damage'), cdBefore = lag.getCooldown();
  const t25 = g.talents.choose(h, 25, 0);
  const t10 = g.talents.choose(h, 10, 1);
  const after = lag.v('damage');
  h.data.hasScepter = true;
  const desc = lag.def.description;
  return { time: g.time, ev, runesOnMap: g.runes.runes.map((r) => r.type), stats: g.runes.stats, lvl, before, after, cdBefore, t25: t25.ok, t10: t10.ok, as: h.getStat('attackSpeed'), desc, bbCost: g.rules.buybackCost(h) };
}, min);
console.log(JSON.stringify(r, null, 1));
console.log('errors', errs.length, errs.slice(0, 10));
await b.close();
