// World / structure screenshots with fog of war revealed. usage:
//   node scripts/ws2_shots.mjs <url> <outDir> [high|low] [spec...]
// spec = name:x:z:dist[:hideUi]  e.g. base:-76:76:46   (dist = camera distance; 17..46 in game, more allowed)
// Default spec list covers bases, lanes and the jungle. Match is started but paused at t=0 (daytime).
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173';
const out = process.argv[3] || '/tmp/ws2/shots';
const quality = process.argv[4] || 'high';
let specs = process.argv.slice(5);
if (!specs.length) specs = [
  'rad_base:-72:72:46', 'duskward_base:72:-72:46', 'mid_lane:-20:20:31', 'jungle_far:-45:10:46', 'jungle_near:-45:10:20',
  'rad_t1_mid:-30:30:22', 'duskward_t1_mid:30:-30:22', 'rad_rax:-62:62:24', 'duskward_rax:62:-62:24', 'sun_throneshard:-76:76:26', 'duskward_throneshard:76:-76:26',
  'rad_fountain:-90:90:24', 'duskward_fountain:90:-90:24', 'rad_shop:-86:84:18',
];
const { mkdirSync } = await import('node:fs');
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.addInitScript((q) => {
  try { localStorage.setItem('throneshard.world.quality', q); const k = 'throneshard-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.quality = q; localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ }
}, quality);
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
await p.goto(url);
await p.waitForFunction(() => window.game?.ui && document.querySelector('.btn-play'), null, { timeout: 180000 });
await p.evaluate(() => {
  const g = window.game;
  g.startMatch({ heroId: 'sera' });
  g.ai.setPlayerAutoplay?.(false);
  g.paused = true;
  const F = g.world.fog;
  g.world.computeFog = () => {};
  for (const t of ['sunward', 'duskward']) F.vis[t].fill(1);
  F.visVersion = { sunward: 99, duskward: 99 };
  F.fillDisplay(1);
  const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none';
});
for (const s of specs) {
  const [name, x, z, dist] = s.split(':');
  await p.evaluate(([x, z, d]) => {
    const c = window.game.cameraCtl;
    c.locked = false; c.follow = false;
    c.focus(+x, +z, true);
    c.desiredDistance = c.distance = +d;
    c.minDist = 1; c.maxDist = 200;
  }, [x, z, dist]);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${name}.png` });
  const st = await p.evaluate(() => ({ ...window.game.world.foliage?.stats, calls: window.game.renderer.info.render.calls, tris: window.game.renderer.info.render.triangles }));
  console.log(name, JSON.stringify(st));
}
console.log('errors', JSON.stringify(errs.filter((e) => !/failed to load (kenshar|isolde|pell|sera|gorrow|vesna|aldric|morvane|sable|thalor|vashkar|ondur|liora|rift_stalker|bone_shaman|creep_|neutral_|grimmaw|summon_)/.test(e)).slice(0, 12)));
await b.close();
