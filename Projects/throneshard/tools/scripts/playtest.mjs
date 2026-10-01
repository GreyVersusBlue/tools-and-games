// End-to-end playtest through the real UI: menu → hero select → match, real mouse/keyboard input,
// then fast-forwards the simulation and reports errors + state. Screenshots: $SHOT_DIR/play_*.png (default /tmp)
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const hero = process.argv[3] || 'sera';
const simMin = +(process.argv[4] || 8);
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
const SHOT_DIR = process.env.SHOT_DIR || '/tmp';
const shot = async (n) => { try { await p.screenshot({ path: `${SHOT_DIR}/play_${n}.png`, timeout: 120000 }); } catch (e) { console.log('shot fail', n, e.message); } };
const t0 = Date.now();
await p.goto(url);
await p.waitForSelector('.btn-play', { timeout: 180000 });
console.log('menu after', (Date.now() - t0) / 1000, 's');
await p.waitForTimeout(1500);
await shot('1_menu');
await p.click('.btn-play');
await p.waitForSelector(`.pk-card[data-id="${hero}"]`, { timeout: 30000 });
await p.click(`.pk-card[data-id="${hero}"]`);
await p.waitForTimeout(800);
await shot('2_pick');
await p.click('.btn-lock');
await p.waitForFunction(() => window.game?.running, null, { timeout: 60000 });
await p.waitForTimeout(3000);
await shot('3_ingame');
// Real input: right-click ground to the upper-right of screen center → hero should get a move order
const before = await p.evaluate(() => { const h = game.player.hero; return [h.position.x, h.position.z]; });
await p.mouse.click(900, 250, { button: 'right' });
await p.waitForTimeout(3000);
const after = await p.evaluate(() => { const h = game.player.hero; return { pos: [h.position.x, h.position.z], order: h.order.type, lvl: h.level, pts: h.abilityPoints }; });
console.log('move test', before, after);
// Level Q via ctrl+Q? use API, then press Q + click
await p.evaluate(() => game.player.hero.levelAbility(0));
await p.keyboard.press('q');
await p.waitForTimeout(500);
const targ = await p.evaluate(() => JSON.stringify(game.input.targeting ? { kind: game.input.targeting.kind, tt: game.input.targeting.targetType } : null));
console.log('targeting after Q', targ);
await p.mouse.click(760, 300);
await p.waitForTimeout(1500);
console.log('Q cd', await p.evaluate(() => game.player.hero.abilities[0].cooldownRemaining));
await shot('4_cast');
// fast forward with fixed dt, render off
const res = await p.evaluate(async (simMin) => {
  const g = window.game;
  g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null);
  const render = g.renderer.render.bind(g.renderer); const comp = g.composer;
  g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  const t = performance.now();
  const steps = simMin * 60 / 0.05;
  for (let i = 0; i < steps && !g.matchOver; i++) g.tick();
  const ms = performance.now() - t;
  g.renderer.render = render; g.composer = comp; g.fixedDt = undefined;
  g.renderer.setAnimationLoop(() => g.tick());
  const h = g.player.hero;
  g.cameraCtl?.focus?.(h.position.x, h.position.z, true);
  return { ms: Math.round(ms), time: g.time, units: g.units.length, score: g.rules.score, towers: g.units.filter(u=>u.kind==='tower').length,
    heroes: g.heroes.map(h => `${h.heroId}(${h.team[0]}) L${h.level} ${h.kills}/${h.deaths}/${h.assists} lh${h.lastHits} g${Math.round(h.gold)} items:${h.inventory.filter(Boolean).map(i=>i.def.id).join(',')}`),
    scene: g.scene.children.length, vfx: g.vfx?.count?.() ?? null };
}, simMin);
console.log(JSON.stringify(res, null, 1));
await p.waitForTimeout(4000);
await shot('5_later');
// find a fight: focus camera on the unit cluster with most heroes
await p.evaluate(() => { const hs = game.heroes.filter(h => h.alive); const h = hs.find(x=>x.state==='attacking') ?? hs[0]; game.cameraCtl.focus(h.position.x, h.position.z, true); });
await p.waitForTimeout(3000);
await shot('6_fight');
await p.keyboard.down('Tab'); await p.waitForTimeout(1200); await shot('7_score'); await p.keyboard.up('Tab');
await p.keyboard.press('F4'); await p.waitForTimeout(1200); await shot('8_shop'); await p.keyboard.press('F4');
const uniq = [...new Set(errs)];
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 40).join('\n'));
await b.close();
