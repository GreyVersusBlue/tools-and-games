// WS5 feature screenshots: runes, ward placement + vision circle, talent panel, buyback, Ascendant Scepter tooltip.
// Usage: node scripts/ws5_shots.mjs [url] [outDir=/tmp/ws5]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5185';
const out = process.argv[3] || '/tmp/ws5';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 120000 });
await p.evaluate(() => {
  const g = window.game;
  g.ui.startMatch({ heroId: 'sera' });
  window.__ff = (sec) => { const rr = g.renderer.render; g.renderer.render = () => {}; const c = g.composer; g.composer = null; g.fixedDt = 0.05; for (let i = 0; i < sec * 20; i++) g.tick(); g.fixedDt = undefined; g.renderer.render = rr; g.composer = c; };
});
await p.waitForTimeout(1500);
const settle = async (ms = 1500) => p.waitForTimeout(ms);
// 1. runes: fast-forward to 2:05 with autoplay, then look at the power rune
await p.evaluate(() => { const g = window.game; g.ai.setPlayerAutoplay(true); window.__ff(126); g.ai.setPlayerAutoplay(false); });
const rune = await p.evaluate(() => {
  const g = window.game;
  const r = g.runes.runes.find((x) => x.kind === 'power') ?? g.runes.runes[0];
  if (!r) return null;
  const h = g.player.hero;
  h.position.set(r.pos.x + 3, 0, r.pos.z + 3); h.issueOrder({ type: 'stop' });
  g.cameraCtl.focus(r.pos.x, r.pos.z, true);
  return { type: r.type, x: r.pos.x, z: r.pos.z };
});
console.log('rune', JSON.stringify(rune));
await settle(2000);
await p.screenshot({ path: `${out}/rune.png` });
// 2. ward targeting with vision circle, then placed
await p.evaluate(() => {
  const g = window.game, h = g.player.hero;
  h.gold = 99999;
  const f = g.items; const sh = [-86, 84];
  const pos = h.position.clone();
  h.position.set(sh[0], 0, sh[1]);
  for (const id of ['lookout_ward', 'seeker_ward']) { const st = f.stock?.[h.team]?.[id]; if (st) st.count = 4; }
  window.__buys = ['lookout_ward', 'seeker_ward', 'ascendant_scepter', 'bottle'].map((id) => id + ':' + JSON.stringify(f.buy(h, id).reason ?? 'ok'));
  f.deliverStash?.(h);
  h.position.copy(pos);
  g.cameraCtl.focus(h.position.x, h.position.z, true);
});
await settle(800);
const slot = await p.evaluate(() => window.game.player.hero.inventory.findIndex((i) => i?.def.id === 'lookout_ward'));
console.log('ward slot', slot, await p.evaluate(() => window.__buys));
await p.mouse.move(700, 330);
await p.evaluate((s) => window.game.input.beginItemCast(s), slot);
await p.mouse.move(720, 320);
await settle(800);
await p.screenshot({ path: `${out}/ward_targeting.png` });
await p.mouse.click(720, 320);
await settle(1500);
const sslot = await p.evaluate(() => window.game.player.hero.inventory.findIndex((i) => i?.def.id === 'seeker_ward'));
await p.evaluate((s) => window.game.input.beginItemCast(s), sslot);
await p.mouse.move(560, 380);
await settle(300);
await p.mouse.click(560, 380);
await settle(1500);
await p.screenshot({ path: `${out}/ward_placed.png` });
// 3. talent panel + scepter tooltip
await p.evaluate(() => {
  const g = window.game, h = g.player.hero;
  h.addXp(30000);
  for (let i = 0; i < 20; i++) for (let k = 3; k >= 0; k--) h.levelAbility(k);
  g.talents.choose(h, 10, 0); g.talents.choose(h, 15, 1);
  h.abilityPoints = Math.max(h.abilityPoints, 2);
  g.cameraCtl.focus(h.position.x, h.position.z, true);
});
await settle(600);
await p.click('.tal-btn');
await settle(800);
await p.screenshot({ path: `${out}/talents.png` });
await p.click('.tal-btn');
const abs = await p.$$('.bp-abilities .ab-frame');
if (abs[3]) { await abs[3].hover(); await settle(700); await p.screenshot({ path: `${out}/scepter_tooltip.png` }); }
await p.mouse.move(640, 200);
// 4. buyback: jump to 25 min game time, kill the hero
await p.evaluate(() => { const g = window.game, h = g.player.hero; g.time = 1500; h.gold = 3000; h.takeDamage(1e6, 'pure', null); });
await settle(1500);
await p.screenshot({ path: `${out}/buyback.png` });
const bb = await p.evaluate(() => { const g = window.game, h = g.player.hero; return { cost: g.rules.buybackCost(h), can: g.rules.canBuyback(h) }; });
await p.click('.btn-buyback').catch(() => {});
await settle(800);
const after = await p.evaluate(() => { const h = window.game.player.hero; return { alive: h.alive, cd: Math.round(h.buybackCooldown), gold: Math.round(h.gold) }; });
console.log('buyback', JSON.stringify(bb), '->', JSON.stringify(after));
await p.screenshot({ path: `${out}/after_buyback.png` });
const uniq = [...new Set(errs)];
console.log('errors', errs.length, uniq.slice(0, 10));
await b.close();
