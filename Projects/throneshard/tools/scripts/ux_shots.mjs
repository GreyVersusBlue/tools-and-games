// UX screenshot harness (WS4): menu, hero select, settings/keybinds, tooltips, tutorial tip, HUD at 3 resolutions,
// minimap. Usage: node scripts/ux_shots.mjs <url> [outDir=/tmp/ws4] [hero=sera]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:5173';
const out = process.argv[3] || '/tmp/ws4';
const hero = process.argv[4] || 'sera';
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const shot = async (n) => { try { await p.screenshot({ path: `${out}/${n}.png`, timeout: 120000 }); } catch (e) { console.log('shot fail', n, e.message); } };
await p.goto(url);
await p.evaluate(() => { try { localStorage.removeItem('throneshard.tutorial'); } catch {} });
await p.waitForSelector('.btn-play', { timeout: 180000 });
await p.waitForTimeout(1500);
await shot('01_menu');
await p.click('[data-act=settings]');
await p.waitForTimeout(600);
await shot('02_settings');
await p.click('.set-tabs button[data-tab=controls]');
await p.waitForTimeout(300);
await shot('03_settings_keybinds');
await p.click('.md-x');
await p.waitForTimeout(400);
await p.click('.btn-play');
await p.waitForSelector(`.pk-card[data-id="${hero}"]`, { timeout: 30000 });
await p.click(`.pk-card[data-id="${hero}"]`);
await p.waitForTimeout(800);
await shot('04_heroselect');
await p.click('.btn-lock');
await p.waitForFunction(() => window.game?.running, null, { timeout: 60000 });
await p.waitForTimeout(3500);
await shot('05_hud_tutorial');
// learn Q and hover it for a tooltip
await p.evaluate(() => { game.player.hero.levelAbility(0); game.player.hero.addGold?.(3000); });
await p.waitForTimeout(300);
const ab = await p.$('.bp-abilities .ab:nth-child(1) .ab-frame');
if (ab) { await ab.hover(); await p.waitForTimeout(500); await shot('06_tooltip_ability'); }
const ab4 = await p.$('.bp-abilities .ab:nth-child(4) .ab-frame');
if (ab4) { await ab4.hover(); await p.waitForTimeout(500); await shot('07_tooltip_ult'); }
// item tooltip: buy a Flicker Dagger (if possible) and hover it
await p.evaluate(() => { const h = game.player.hero; h.gold = 5000; game.items?.buy?.(h, 'flicker_dagger'); });
await p.waitForTimeout(400);
const inv = await p.$('.inv-grid .inv:first-child');
if (inv) { await inv.hover(); await p.waitForTimeout(500); await shot('08_tooltip_item'); }
await p.mouse.move(640, 300);
// fast-forward a bit so heroes spread out and minimap is interesting
await p.evaluate(() => {
  const g = window.game; g.ai.setPlayerAutoplay?.(true);
  g.renderer.setAnimationLoop(null); const r = g.renderer.render.bind(g.renderer); const c = g.composer;
  g.renderer.render = () => {}; g.composer = null; g.fixedDt = 0.05;
  for (let i = 0; i < 2400; i++) g.tick();
  g.renderer.render = r; g.composer = c; g.fixedDt = undefined; g.renderer.setAnimationLoop(() => g.tick());
  g.ai.setPlayerAutoplay?.(false);
  const h = g.player.hero; g.cameraCtl?.focus?.(h.position.x, h.position.z, true);
});
await p.waitForTimeout(2500);
for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(1500);
  await shot(`10_hud_${w}x${h}`);
}
await p.setViewportSize({ width: 1280, height: 720 });
await p.waitForTimeout(800);
const mm = await p.$('.hud-minimap');
if (mm) await mm.screenshot({ path: `${out}/11_minimap.png` });
const uniq = [...new Set(errs)];
console.log('errors/warnings (' + uniq.length + '):\n' + uniq.slice(0, 40).join('\n'));
await b.close();
