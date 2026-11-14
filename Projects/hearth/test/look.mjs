// Hearth's look rig (A0 of DESIGN-arc-three.md): eight scenes of seed 7, each drawn at zoom 1 and zoom 3.2, timed, and optionally
// written out as pictures.
//
//   node look.mjs [--out <dir>] [--budget-median 12] [--budget-p95 24]
//
// The page is opened over http (serve.mjs) so the canvas is never tainted, and its own loop is paused as harness.mjs does, so every
// step is this file's. Viewport 880 by 560 at scale 1 with the HUD and log hidden: one world pixel is one canvas pixel at zoom 1.
// Pictures go to --out, or a temp folder, never into the repo, where every file is a public URL. Exits non-zero when drawing touches
// the simulation's stream, or when a scene's draw() is over the timing budget.
import { chromium } from 'playwright';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : dflt; }
const BUDGET_MEDIAN = +arg('budget-median', 12); // 3.2 asks for 6 ms; A14 tightens it. 12 is today's looser ceiling.
const BUDGET_P95 = +arg('budget-p95', 24);
const OUT = arg('out', null) || fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-look-'));
fs.mkdirSync(OUT, { recursive: true });

// day, hour fraction, weather, snow depth, extra settle steps. Days run forward on one island, so the list is in day order.
const SCENES = [
  { id: 'S1', name: 'summer noon clear', day: 128, f: .5, wx: 'clear', snow: 0 },
  { id: 'S2', name: 'summer dusk clear', day: 128, f: .85, wx: 'clear', snow: 0 },
  { id: 'S3', name: 'summer noon rain', day: 128, f: .5, wx: 'rain', snow: 0 },
  { id: 'S4', name: 'autumn morning fog', day: 133, f: .3, wx: 'fog', snow: 0, settle: 600 },
  { id: 'S5', name: 'winter noon snowing', day: 138, f: .5, wx: 'snow', snow: .8 },
  { id: 'S6', name: 'winter dusk clear', day: 138, f: .72, wx: 'clear', snow: .8 },
  { id: 'S7', name: 'winter evening clear', day: 138, f: .80, wx: 'clear', snow: .8 },
  { id: 'S8', name: 'spring dawn', day: 143, f: .22, wx: 'clear', snow: 0 },
];

const LAUNCH = { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(LAUNCH).catch(() => chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }));
const srv = await serve();
const warns = [];

async function open(seed) {
  const ctx = await browser.newContext({ viewport: { width: 880, height: 560 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { const t = m.text(); if (t.includes('non-finite') || t.startsWith('hearth:')) warns.push(t); });
  page.on('pageerror', e => warns.push('PAGEERROR: ' + e.message));
  await page.goto(srv.url + 'index.html');
  await page.waitForFunction(() => !!window.__hearth);
  await page.waitForFunction(() => window.__hearth.sheet.ready || !!window.__hearth.sheet.fail);
  const f = await page.evaluate(() => window.__hearth.sheet.fail);
  if (f) warns.push('SHEET: ' + f);
  await page.evaluate(() => { const b = document.getElementById('b-pause'); if (b.textContent !== '▶') b.click(); });
  await page.addStyleTag({ content: '#hud,#log,#hint{display:none!important}' });
  await page.evaluate(s => window.__hearth.newWorld(s), seed);
  return { ctx, page };
}

// the same FNV-1a over pack() that harness.mjs prints, so the numbers compare
async function packHash(page) {
  return page.evaluate(() => {
    const s = JSON.stringify(window.__hearth.pack());
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16) + ':' + s.length;
  });
}

let failed = 0;
function check(name, ok, detail = '') { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; }

// ---- (1) drawing is off the stream: two pages, five days, one drawing on top of its own frames ----
{
  const run = async extra => {
    const { ctx, page } = await open(7);
    await page.evaluate(extra => {
      const H = window.__hearth;
      for (let i = 0; i < 2800 * 5; i++) { H.step(.05); if (extra && i % 10 === 0) H.draw(); }
    }, extra);
    const h = await packHash(page);
    await ctx.close();
    return h;
  };
  const plain = await run(false), drawn = await run(true);
  check('drawing is off the stream: draw() every 10 steps leaves the pack hash as it was', plain === drawn, `${plain} without, ${drawn} with`);
}

// ---- (2) the eight scenes, at zoom 1 and zoom 3.2: pictures and timing ----
const rows = [];
{
  const { ctx, page } = await open(7);
  for (const sc of SCENES) {
    await page.evaluate(sc => {
      const H = window.__hearth;
      while (H.dayCount < sc.day) H.step(.05);
      H.setTime((Math.floor(H.time / 140) + sc.f) * 140);
      H.setWx(sc.wx); H.setSnow(sc.snow);
      for (let i = 0; i < 40 + (sc.settle || 0); i++) H.step(.05);
    }, sc);
    for (const z of [1, 3.2]) {
      await page.evaluate(z => {
        const H = window.__hearth, hs = H.houses;
        H.setZoom(1);
        if (z > 1) {
          const mx = hs.reduce((a, h) => a + h.x, 0) / hs.length, my = hs.reduce((a, h) => a + h.y, 0) / hs.length;
          H.setZoom(z, mx, my); H.setCam(mx, my);
        }
        H.draw();
      }, z);
      const ms = await page.evaluate(() => {
        // a software canvas queues its drawing and pays for it on some later call (one draw in thirty read 48 ms and the rest 1 ms), so each
        // timed call ends with a one-pixel readback that forces the queue out: the number is the frame's cost, not a luck of where the flush fell
        const H = window.__hearth, g = document.getElementById('c').getContext('2d'), out = [];
        H.draw(); g.getImageData(0, 0, 1, 1);
        for (let i = 0; i < 30; i++) { const t = performance.now(); H.draw(); g.getImageData(0, 0, 1, 1); out.push(performance.now() - t); }
        return out.sort((a, b) => a - b);
      });
      const med = (ms[14] + ms[15]) / 2, p95 = ms[Math.min(29, Math.ceil(.95 * 30) - 1)];
      rows.push({ id: sc.id, name: sc.name, z, med, p95 });
      const png = await page.locator('#c').screenshot();
      fs.writeFileSync(path.join(OUT, `${sc.id}-${sc.name.replace(/ /g, '-')}-z${z}.png`), png);
    }
  }
  await ctx.close();
}
console.log('\nscene                          zoom   median ms   p95 ms');
for (const r of rows) console.log(`${(r.id + ' ' + r.name).padEnd(30)} ${String(r.z).padEnd(5)} ${r.med.toFixed(2).padStart(9)} ${r.p95.toFixed(2).padStart(8)}`);
console.log(`pictures: ${OUT}\n`);
check(`timing: every scene's draw() median is at or under ${BUDGET_MEDIAN} ms and p95 at or under ${BUDGET_P95} ms`,
  rows.every(r => r.med <= BUDGET_MEDIAN && r.p95 <= BUDGET_P95),
  rows.filter(r => r.med > BUDGET_MEDIAN || r.p95 > BUDGET_P95).map(r => `${r.id} z${r.z} ${r.med.toFixed(1)}/${r.p95.toFixed(1)}`).join(', '));
check('no warnings from the page', warns.length === 0, warns.slice(0, 3).join(' | '));

await browser.close();
srv.close();
console.log(failed ? `FAIL: ${failed} look checks` : 'PASS: look');
process.exit(failed ? 1 : 0);
