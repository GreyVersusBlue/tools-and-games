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

// ---- (3) A1: what is only seen runs on animT, which is real seconds and stands still when paused ----
// Two draws of the same instant of sim time, animT at 0 and at 3. Water that is open sea, far from any coast and from anything that moves, and
// outside the summer shimmer's bands, can only change through the water glints; a block of rock outside the bands changes through nothing.
async function animChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), W = 110, HH = 70, T = 8;
    H.setZoom(1);
    const shot = a => { H.setAnimT(a); H.draw(); return g.getImageData(0, 0, W * T, HH * T).data; };
    const t0 = H.time, d0 = shot(0), d3 = shot(3);
    const tiles = H.tilesNow, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= HH) ? 0 : tiles[y * W + x];
    const bands = y => { for (let i = 0; i < 8; i++) { const y0 = (i * 67) % (HH * T - 8); if (y >= y0 - 1 && y < y0 + 7) return true; } return false; };
    const near = (x, y, r, f) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (f(x + i, y + j)) return true; return false; };
    const sh = [H.fishSh, H.boats, H.gulls, H.wild, H.people].flatMap(l => l.map(o => [o.x, o.y])); // everything that moves on its own
    const clear = (tx, ty) => !sh.some(([x, y]) => Math.hypot(x - tx, y - ty) < 4);
    const differs = (x, y) => { const k = (y * W * T + x) * 4; return d0[k] !== d3[k] || d0[k + 1] !== d3[k + 1] || d0[k + 2] !== d3[k + 2]; };
    let water = 0, waterPx = 0, rock = 0, rockPx = 0; const rockAt = [];
    for (let ty = 0; ty < HH; ty++) for (let tx = 0; tx < W; tx++) {
      const t = at(tx, ty);
      let kind = 0;
      if (t === 0 && !near(tx, ty, 3, (x, y) => at(x, y) !== 0) && clear(tx, ty)) kind = 1;
      else if (t === 3 && !near(tx, ty, 1, (x, y) => at(x, y) !== 3) && clear(tx, ty)) kind = 2;
      if (!kind) continue;
      for (let y = ty * T; y < ty * T + T; y++) { if (bands(y)) continue; for (let x = tx * T; x < tx * T + T; x++) {
        if (kind === 1) { waterPx++; if (differs(x, y)) water++; } else { rockPx++; if (differs(x, y)) { rock++; if (rockAt.length < 6) rockAt.push([x, y]); } } } }
    }
    const sameTime = H.time === t0;
    H.setAnimT(3); H.frame(.5, false); const held = H.animT;
    H.frame(.5, true); const ran = H.animT;
    return { water, waterPx, rock, rockPx, rockAt, sameTime, held, ran };
  });
  check('animT: with time unchanged, open water differs between animT 0 and 3 (the glints)', r.water >= 20, `${r.water} of ${r.waterPx} open-water pixels differ`);
  check('animT: with time unchanged, rock far from the coast is identical', r.rockPx > 200 && r.rock === 0, `${r.rock} of ${r.rockPx} rock pixels differ ${JSON.stringify(r.rockAt)}`);
  check('animT: setting it does not move sim time', r.sameTime, 'time moved');
  check('animT: frame(.5,false) with the loop paused leaves it where it was', r.held === 3, `3 became ${r.held}`);
  check('animT: frame(.5,true) advances it by the real seconds', Math.abs(r.ran - 3.5) < 1e-9, `3 became ${r.ran}`);
}

// ---- (4) A3: the ground has a shape. Called on a fresh seed-7 island at day 0, summer-ish, no snow, before any scene moves it. ----
async function groundChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, cv = H.terCv, g = cv.getContext('2d'), W = 110, HH = 70, T = 8;
    const tiles = H.tilesNow, elev = H.elevNow, road = H.road;
    const snap = () => g.getImageData(0, 0, W * T, HH * T).data;
    H.paintTerrain(); const a = snap();
    const t0 = performance.now(); H.paintTerrain(); const ms = performance.now() - t0; g.getImageData(0, 0, 1, 1);
    const b = snap();
    let same = true; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
    const lum = (tx, ty) => { let s = 0; for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const k = ((ty * T + y) * W * T + tx * T + x) * 4; s += .299 * b[k] + .587 * b[k + 1] + .114 * b[k + 2]; } return s / (T * T); };
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= HH) ? 0 : tiles[y * W + x];
    const lo = [], hi = [];
    for (let y = 1; y < HH - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (at(x, y) !== 2 || road[y * W + x]) continue; // open grass only, so sand, rock and water edges do not decide it
      let pure = true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) !== 2) pure = false;
      if (!pure) continue;
      const nw = elev[(y - 1) * W + x - 1], me = elev[y * W + x];
      if (nw < me) lo.push(lum(x, y)); else if (nw > me) hi.push(lum(x, y));
    }
    const mean = l => l.reduce((s, v) => s + v, 0) / (l.length || 1);
    // the coast: every sand tile with water to its east must carry the wet-sand lip on its east 2 px, and the water tile the foam line
    let lipN = 0, lipOk = 0, foamOk = 0;
    const px = (x, y) => { const k = (y * W * T + x) * 4; return [b[k], b[k + 1], b[k + 2]].join(','); };
    for (let y = 0; y < HH; y++) for (let x = 0; x < W - 1; x++) if (at(x, y) === 1 && at(x + 1, y) === 0) {
      lipN++; if (px(x * T + 6, y * T + 3) === '179,159,120' && px(x * T + 7, y * T + 3) === '179,159,120') lipOk++;
      if (px((x + 1) * T, y * T + 3) === '220,236,244') foamOk++;
    }
    // rock far from the snow line gets strata: some darker band pixel (#4f4b44) on most rock tiles
    let rock = 0, strata = 0;
    for (let y = 0; y < HH; y++) for (let x = 0; x < W; x++) if (at(x, y) === 3 && elev[y * W + x] <= .7) {
      rock++; let found = false;
      for (let j = 0; j < T && !found; j++) for (let i = 0; i < T; i++) { const k = ((y * T + j) * W * T + x * T + i) * 4; if (b[k] === 79 && b[k + 1] === 75 && b[k + 2] === 68) { found = true; break; } }
      if (found) strata++;
    }
    return { same, ms, lo: lo.length, hi: hi.length, mlo: mean(lo), mhi: mean(hi), lipN, lipOk, foamOk, rock, strata };
  });
  check('ground: land tiles with a lower north-west neighbour are at least 6 brighter than those with a higher one', r.lo > 50 && r.hi > 50 && r.mlo - r.mhi >= 6,
    `${r.lo} lit tiles at ${r.mlo.toFixed(2)}, ${r.hi} shaded tiles at ${r.mhi.toFixed(2)}`);
  check('ground: a second paintTerrain() with the same key is pixel-identical', r.same, 'the repaint differs');
  check('ground: paintTerrain() takes under 60 ms', r.ms < 60, `${r.ms.toFixed(1)} ms`);
  check('ground: every sand tile with water to its east has the wet lip and the foam line', r.lipN >= 5 && r.lipOk === r.lipN && r.foamOk === r.lipN, `${r.lipN} such tiles, ${r.lipOk} lips, ${r.foamOk} foam lines`);
  check('ground: rock below the snow line carries strata bands', r.rock >= 5 && r.strata === r.rock, `${r.strata} of ${r.rock} rock tiles`);
  console.log(`      ground: ${r.lo} tiles NW-lower at ${r.mlo.toFixed(2)}, ${r.hi} NW-higher at ${r.mhi.toFixed(2)}, paint ${r.ms.toFixed(1)} ms`);
}

// ---- (5) B1: stock you can point at. A fresh seed-7 island at noon, clear, no snow, zoom 1, where one world pixel is one canvas pixel. ----
// Each pile is counted by its own colours inside the box stockSpots() gives. wood, granary and food are set through the page's global scope,
// and animT is set by hand, so the ease is the thing under test: the numbers change at once, the objects arrive one per 0.4 s.
async function stockChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), ev = (0, eval);
    const COL = { wood: [[138, 90, 46], [148, 98, 47], [107, 68, 35], [200, 147, 90]], sack: [[214, 199, 154], [179, 162, 115], [138, 122, 82]], fish: [[201, 208, 200], [125, 140, 138]] };
    H.setZoom(1); H.setWx('clear'); H.setSnow(0); H.setTime((Math.floor(H.time / 140) + .5) * 140);
    const count = k => {
      const s = ev('stockSpots()')[k], x0 = Math.round(s.x - s.w / 2) - 1, y0 = Math.round(s.y - s.h) - 2, w = s.w + 2, h = s.h + 3;
      const d = g.getImageData(x0, y0, w, h).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (COL[k].some(c => d[i] === c[0] && d[i + 1] === c[1] && d[i + 2] === c[2])) n++;
      return n;
    };
    const out = {};
    const run = (k, set, hi, t) => {
      ev(set(0)); H.setAnimT(t); H.draw(); const empty = count(k);
      ev(set(hi)); H.draw(); const same = count(k);
      H.setAnimT(t + 1.2); H.draw(); const part = count(k);
      H.setAnimT(t + 12); H.draw(); const full = count(k);
      out[k] = { empty, same, part, full };
    };
    run('wood', v => `wood=${v}`, 96, 100);
    ev('wood=12'); H.setAnimT(200); H.draw();
    run('sack', v => `granary=${v}`, 400, 300);
    ev('granary=0'); H.setAnimT(400); H.draw();
    run('fish', v => `food=${v}`, 160, 500);
    return out;
  });
  // eight fish are 4 px each, so their floor is 24, not the 60 the design gives for logs and sacks
  for (const [k, what, set, min] of [['wood', 'logs', 'setWood(96)', 60], ['sack', 'sacks', 'setGranary(400)', 60], ['fish', 'fish', 'setFood(160)', 24]]) {
    const o = r[k];
    check(`stock: ${what} are ${o.empty} px at 0 and ${o.full} px once ${set} has had 12 s of animT, at least ${min} of them`, o.empty === 0 && o.full >= min, JSON.stringify(o));
    check(`stock: the ${what} arrive over time, none at the instant the number moves, some at 1.2 s, all by 12 s`, o.same === 0 && o.part > 0 && o.part < o.full, JSON.stringify(o));
  }
  console.log(`      stock: logs ${r.wood.full} px, sacks ${r.sack.full} px, fish ${r.fish.full} px`);
}

// ---- (2) the eight scenes, at zoom 1 and zoom 3.2: pictures and timing ----
const rows = [];
{
  const { ctx, page } = await open(7);
  await groundChecks(page);
  await stockChecks(page);
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
    if (sc.id === 'S1') await animChecks(page);
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
