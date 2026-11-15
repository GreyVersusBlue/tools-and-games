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
  { id: 'S7', name: 'winter evening clear', day: 138, f: .5, wx: 'clear', snow: .8, settle: 760 }, /* C2: reaches f .80 by walking from noon; a jump to .80 left nobody home once the stream moved */
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
    H.setZoom(1); H.lookOff.smoke = true; /* A7: the smokehouse's column rises over rock and moves with animT on purpose */
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
    H.lookOff.smoke = false;
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

// ---- (6) A8: people you can tell apart. The skin of each walking person, read from the picture, is not one tone. ----
// Called in S1 (summer noon, day 128, seed 7). For every person standing in the open the pixel at the middle of the head is read off the canvas
// and matched to the nearest of the five SKIN tones; each tone is multiplied by the noon colour (skyAt) first, and a pixel within 6 per channel of a result is a match: ground, shirts and shadow do not land that close. Break: set the head
// fill in drawFolk (js/folk.js) back to the one old colour '#f1cfa5'; the count of distinct tones falls to one.
const SKIN_HEX = ['#f1cfa5', '#e6b98d', '#c98a5c', '#a86a44', '#7a4b2e'];
async function peopleChecks(page) {
  const r = await page.evaluate((skin) => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), T = 8;
    H.setZoom(1); H.draw(); /* the canvas is world-sized; at zoom 1 nothing is culled, so every person in the open is on it */
    const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const sky = H.skyAt(.5, 'summer', 'clear', 0), tones = skin.map(rgb).map(t => t.map((v, k) => v * sky[k] / 255)), got = new Set(); let sampled = 0, matched = 0;
    for (const p of H.people) {
      if (p.inside || p.dead || p.task === 'sleep' || p.inBoat) continue;
      const x = Math.round(p.x * T), y = Math.round(p.y * T - 6.5), d = g.getImageData(x, y, 1, 1).data; sampled++;
      let best = -1, bd = 1e9; tones.forEach((t, i) => { const dd = Math.max(Math.abs(t[0] - d[0]), Math.abs(t[1] - d[1]), Math.abs(t[2] - d[2])); if (dd < bd) { bd = dd; best = i; } });
      if (bd <= 6) { matched++; got.add(best); }
    }
    return { sampled, matched, tones: [...got].sort(), count: H.people.length };
  }, SKIN_HEX);
  check('people: at noon, in S1, at least three of the five skin tones are read off the picture across the people in the open', r.tones.length >= 3 && r.matched >= 5, JSON.stringify(r));
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

// ---- (5) A2: the hour is a colour. S1 against the A0 baseline, S6 rose over the land, S7 dark with its windows lit on the snow ----
const S1_BASELINE = 82.34; // mean luminance of S1 at zoom 1 on the A0 code, measured before A2 on Chromium 1194
async function lightChecks(page, id) {
  const r = await page.evaluate(id => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), W = 110, HH = 70, T = 8;
    H.setZoom(1); H.draw();
    const d = g.getImageData(0, 0, W * T, HH * T).data, tiles = H.tilesNow, road = H.road;
    const px = (x, y) => { const k = (Math.round(y) * W * T + Math.round(x)) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    const lum = (x, y) => { const c = px(x, y); return .299 * c[0] + .587 * c[1] + .114 * c[2]; };
    const tile = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return (tx < 0 || ty < 0 || tx >= W || ty >= HH) ? -1 : tiles[ty * W + tx]; };
    let t = 0; for (let i = 0; i < d.length; i += 4) t += .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
    const out = { mean: t / (d.length / 4) };
    let rs = 0, bs = 0, n = 0;
    for (let y = 0; y < HH * T; y += 2) for (let x = 0; x < W * T; x += 2) if (tile(x, y) > 0) { const c = px(x, y); rs += c[0]; bs += c[2]; n++; }
    out.landR = rs / n; out.landB = bs / n;
    // a lit window and the snow round it: the pixel 3 px under the pair against one 24 px off, on the same grass tile type, either side first
    const diffs = [], lit = [...H.litHouses];
    for (const h of lit) {
      const ax = h.x * T + 8, ay = h.y * T + 16;
      const ok = (x, y) => tile(x, y) === 2 && !road[Math.floor(y / T) * W + Math.floor(x / T)];
      if (!ok(ax, ay)) continue;
      for (const [dx, dy] of [[24, 0], [-24, 0], [0, 24], [0, -24]]) if (ok(ax + dx, ay + dy)) { diffs.push(lum(ax, ay) - lum(ax + dx, ay + dy)); break; }
    }
    diffs.sort((a, b) => a - b);
    out.lit = lit.length; out.houses = H.houses.length; out.pairs = diffs.length; out.medDiff = diffs.length ? diffs[diffs.length >> 1] : 0;
    return out;
  }, id);
  if (id === 'S1') {
    check('light: S1 (summer noon) is not dimmed: mean luminance within -15% and +4% of the A0 baseline', r.mean >= S1_BASELINE * .85 && r.mean <= S1_BASELINE * 1.04, `${r.mean.toFixed(2)} against ${S1_BASELINE}`);
  }
  if (id === 'S6') check('light: S6 (winter dusk) is warm over the land: mean red exceeds mean blue', r.landR > r.landB, `red ${r.landR.toFixed(1)}, blue ${r.landB.toFixed(1)}`);
  if (id === 'S7') {
    check('light: S7 (winter evening) mean luminance is between 30 and 95 of 255', r.mean >= 30 && r.mean <= 95, `${r.mean.toFixed(2)}`);
    check('light: S7 some windows are lit and some are not', r.lit >= 1 && r.lit < r.houses, `${r.lit} of ${r.houses} houses lit`);
    check('light: S7 the snow 3 px below a lit window is at least 60 brighter than the snow 24 px away (median over lit houses)', r.pairs >= 2 && r.medDiff >= 60, `${r.pairs} pairs, median ${r.medDiff.toFixed(1)}`);
  }
}


// ---- (6c) B5: the far island, seen. Warm pixels in the silhouette's box and pale ones where a sail goes, read off the canvas. ----
// Two far departures and the name known: two to six warm pixels. Name unknown: none. Two near departures (far 0), name known: none, and a lamp that
// has burnt out by the small hours: none. A crossing today puts pale pixels under the island that a crossing three days old does not.
// Break: count every entry of gone in farPeople regardless of far; the "near departures" assertion fails.
async function farChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), ev = (0, eval), T = 8, out = {};
    const fi = H.farIsle; out.has = !!fi; if (!fi) return out;
    const x0 = Math.max(0, Math.floor(fi.x * T)), x1 = Math.ceil((fi.x + fi.w) * T), hh = fi.h * 1.7;
    H.setZoom(1); H.setWx('clear'); H.setSnow(0); H.setFogA(0); H.setAnimT(0);
    ev('farIsle.lit=false');
    const dayStart = Math.floor(H.time / 140) * 140;
    const warm = () => { H.draw(); const d = g.getImageData(x0, 0, x1 - x0, Math.ceil(hh * 2.2)).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i] - d[i + 2] > 70) n++; return n; };
    const pale = () => { H.draw(); const d = g.getImageData(Math.max(0, x0 - (x1 - x0)), Math.floor(hh * 1.9), 3 * (x1 - x0), 20).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 190 && d[i + 2] > 165) n++; return n; };
    const setGone = (far) => ev(`gone=[${far.map((f, i) => `{name:'zz${i}',far:${f}}`).join(',')}]`);
    H.setTime(dayStart + .88 * 140);
    ev('farRec.kn=1'); setGone([1, 1]); out.two = warm();
    ev('farRec.kn=0'); out.unknown = warm();
    ev('farRec.kn=1'); setGone([0, 0]); out.near = warm();
    setGone([1, 1]); H.setTime(dayStart + .95 * 140); out.mid = warm(); H.setTime(dayStart + .17 * 140); out.late = warm();
    setGone([]); H.setTime(dayStart + .5 * 140); ev('farRec.cr=[]'); out.sail0 = pale();
    ev(`farRec.cr=[{d:dayCount,k:'left',s:'x'}]`); out.sail1 = pale();
    ev(`farRec.cr=[{d:dayCount-3,k:'left',s:'x'}]`); out.sailOld = pale();
    return out;
  });
  if (!r.has) { check('far: this island has a far island to look at', false, JSON.stringify(r)); return; }
  check('far: two people known to be on the named far island show two to six warm pixels in its box in the evening', r.two >= 2 && r.two <= 6, `${r.two}`);
  check('far: with the name not yet known the island is a shape and nothing else', r.unknown === 0, `${r.unknown} warm px`);
  check('far: two near departures and no far ones light nothing over there', r.near === 0, `${r.near} warm px`);
  check('far: the lamps burn at midnight and are out in the small hours', r.mid >= 2 && r.late === 0, `${r.mid} warm px at .95, ${r.late} at .17`);
  check('far: a crossing today puts a sail on the water; one three days old does not', r.sail1 - r.sail0 >= 2 && r.sailOld - r.sail0 <= 0, JSON.stringify({ none: r.sail0, today: r.sail1, old: r.sailOld }));
}

// ---- (6b) B2: hands that are full. One person stood on open grass at noon; what they carry is read off the canvas. ----
// Full buckets against empty ones: pixels in the person's box that are blue (b well over r and g). A basket put down for a chat: pixels of its own
// brown inside the box where they stood, once they have walked off. Break: swap the two waterSt rows in carryOf; the blue count does not rise.
async function handsChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), ev = (0, eval), T = 8, W = 110, HH = 70;
    const out = {};
    H.setZoom(1); H.setWx('clear'); H.setSnow(0); H.setTime((Math.floor(H.time / 140) + .5) * 140); H.setAnimT(0);
    const tiles = H.tilesNow; let spot = null;
    for (let ty = 8; ty < HH - 8 && !spot; ty++) for (let tx = 6; tx < W - 24 && !spot; tx++) {
      let ok = true;
      for (let y = ty - 2; y <= ty + 2 && ok; y++) for (let x = tx; x <= tx + 17; x++) if (tiles[y * W + x] !== 2 || H.road[y * W + x]) { ok = false; break; }
      if (ok) spot = { x: tx + 1, y: ty };
    }
    out.spot = spot; if (!spot) return out;
    for (const l of ['trees', 'houses', 'plots', 'works', 'wild', 'stumps', 'graves', 'snowmen']) ev(`${l}.splice(0,${l}.length,...${l}.filter(o=>!(o.x>=${spot.x - 6}&&o.x<=${spot.x + 23}&&o.y>=${spot.y - 12}&&o.y<=${spot.y + 6})))`);
    for (const p of H.people) { p.x = p.tx = 1; p.y = p.ty = 1; }
    const p = H.people.find(q => !q.dead); const stand = (x, y) => { p.x = p.tx = x; p.y = p.ty = y; p.inside = false; p.inBoat = false; p.sick = false; };
    const count = (cx, cy, test) => { H.draw(); const x0 = Math.round(cx * T) - 7, y0 = Math.round(cy * T) - 13, d = g.getImageData(x0, y0, 16, 17).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (test(d[i], d[i + 1], d[i + 2])) n++; return n; };
    const blue = (r, g2, b) => b > r + 40 && b > g2 + 15, brown = (r, g2, b) => r > 130 && r < 190 && g2 > 85 && g2 < 140 && b > 40 && b < 90 && r - b > 70;
    const cx = spot.x + 4, cy = spot.y; stand(cx, cy);
    p.task = 'water'; p.waterSt = 0; out.empty = count(cx, cy, blue);
    p.waterSt = 1; out.full = count(cx, cy, blue);
    p.waterSt = 0; p.task = 'carry'; p.carrySt = 0; count(cx, cy, brown);
    p.task = 'chat'; p.chatW = ''; stand(cx, cy); count(cx, cy, brown); /* the frame that sees the carry end puts the basket down */
    p.task = 'carry'; stand(cx, cy); H.draw(); p.task = 'chat'; H.draw(); stand(cx + 6, cy);
    out.put = count(cx, cy, brown); out.set = !!p._set;
    p.task = 'idle'; H.draw(); out.gone = count(cx, cy, brown); out.setAfter = !!p._set;
    return out;
  });
  if (!r.spot) { check('hands: an open block of grass to stand a person on', false, JSON.stringify(r)); return; }
  check('hands: a person at the well with full buckets shows more blue in their box than with empty ones', r.full - r.empty >= 2, `${r.empty} blue px empty, ${r.full} full`);
  check('hands: a basket put down for a chat stays on the ground in the path once they have walked on, and goes when the task changes', r.set && r.put >= 3 && r.gone < r.put && !r.setAfter, JSON.stringify(r));
  console.log(`      hands: ${r.empty} blue px empty, ${r.full} full; basket ${r.put} px on the ground, ${r.gone} after`);
}

// ---- (7) A9: who is who, and who is singing. A fresh seed-7 island at noon on day 128 (S1's day), clear, no snow, zoom 1. ----
// People are stood by hand on open grass, so a check reads the picture and the DOM and not the luck of where the island put them. Ties: the
// canvas with someone selected against the canvas with nobody, along one pixel row, sample by sample. Notes: pixels of the song's own colour (noteCol,
// folk.js, multiplied by the noon colour as the A8 check does) in a box over each head. Break any of them as the entry in the comment above each says.
async function whoChecks(page) {
  const r = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), ev = (0, eval), T = 8, W = 110, HH = 70;
    const out = {};
    H.setZoom(1); H.setWx('clear'); H.setSnow(0); H.setTime((Math.floor(H.time / 140) + .5) * 140); H.setAnimT(0);
    // a strip of land 18 tiles wide with no road on it; whatever stands in and round it (trees, houses, plots, works, animals) is taken
    // off the island, which is this check's own and is never stepped again, so nothing hides a line or a note
    const tiles = H.tilesNow;
    let spot = null;
    for (let ty = 8; ty < HH - 8 && !spot; ty++) for (let tx = 6; tx < W - 24 && !spot; tx++) {
      let ok = true;
      for (let y = ty; y <= ty && ok; y++) for (let x = tx; x <= tx + 17; x++) if ((tiles[y * W + x] !== 2 && tiles[y * W + x] !== 1) || H.road[y * W + x]) { ok = false; break; }
      if (ok) spot = { x: tx + 1, y: ty };
    }
    out.spot = spot;
    if (!spot) return out;
    for (const l of ['trees', 'houses', 'plots', 'works', 'wild', 'stumps', 'graves', 'snowmen']) ev(`${l}.splice(0,${l}.length,...${l}.filter(o=>!(o.x>=${spot.x - 6}&&o.x<=${spot.x + 23}&&o.y>=${spot.y - 12}&&o.y<=${spot.y + 6})))`);
    const ppl = H.people.filter(p => !p.dead && p.task !== 'boat' && p.task !== 'voyage');
    const stand = (p, x, y) => { p.x = x; p.y = y; p.tx = x; p.ty = y; p.inside = false; p.inBoat = false; p.task = 'wander'; p.sick = false; };
    const ageTo = (p, a) => { p.age0 = a - (H.dayCount - p.born) / ev('YEAR'); };   // ageOf(p) = age0 + (dayCount - born) / YEAR
    const grid = () => { const d = g.getImageData(0, 0, W * T, HH * T).data; return (x, y) => { const k = (Math.round(y) * W * T + Math.round(x)) * 4; return [d[k], d[k + 1], d[k + 2]]; }; };
    const draw = () => { H.draw(); return grid(); };
    // ---- the people for the whole check: six, each of them old enough to be grown and none of them an elder ----
    const six = ppl.slice(0, 6); if (six.length < 6) { out.few = six.length; return out; }
    six.forEach((p, i) => { ageTo(p, 30 + i * 4); p.rels = []; p.partner = null; });
    // ---- (a) name tags ----
    // The selected person is stood at the middle of the block with a partner; showCard() is the real click's own path. Their tag is read from the DOM.
    const A = six[0], B = six[1], cx = spot.x + 8, cy = spot.y;
    stand(A, cx, cy); stand(B, cx + 7, cy); A.rels = [{ who: B.name, k: 'partner' }]; B.rels = [{ who: A.name, k: 'partner' }];
    for (const p of six.slice(2)) stand(p, spot.x + 1 + (six.indexOf(p) - 2) * 4, cy - 4);
    const view = () => { const v = H.view, rc = document.getElementById('c').getBoundingClientRect(), k = v.fitS * v.zoom * v.dprE;
      return (p) => ({ x: rc.left + (p.x * T * k + document.getElementById('c').width / 2 - v.camX * T * k) / v.dprE, y: rc.top + ((p.y * T - 8) * k + document.getElementById('c').height / 2 - v.camY * T * k) / v.dprE }); };
    const tags = () => [...document.querySelectorAll('#tags .tag')].filter(e => !e.hidden).map(e => { const b = e.getBoundingClientRect(); return { n: e.textContent, x: b.left + b.width / 2, y: b.top + b.height / 2, sel: e.classList.contains('sel') }; });
    ev('showCard(null)'); H.draw(); out.tagsNone = tags().length;
    ev(`showCard(byName(${JSON.stringify(A.name)}))`); H.draw();
    const tg = tags().find(t => t.n === A.name), pr = view()(A);
    out.tagSel = tg ? { dx: Math.abs(tg.x - pr.x), dy: Math.abs(tg.y - pr.y), sel: tg.sel, n: tags().length } : null;
    // hover: nobody selected, zoom 3.2 on the middle of the block, the pointer on one of the others; zoom 1, the same pointer, shows nothing
    ev('showCard(null)');
    const C = six[2]; H.cur.x = C.x; H.cur.y = C.y; H.setZoom(1); H.draw(); out.hover1 = tags().length;
    H.setZoom(3.2, C.x, C.y); H.setCam(C.x, C.y); H.draw();
    const hv = tags(); out.hover3 = { names: hv.map(t => t.n), hasC: hv.some(t => t.n === C.name), n: hv.length };
    // eleven people packed round the pointer: no more than six tags
    const extra = ppl.slice(6, 12); extra.forEach((p, i) => stand(p, C.x + .2 * i, C.y + .1)); H.draw(); out.hoverMany = tags().length;
    H.setZoom(1); H.cur.x = 0; H.cur.y = 0; H.draw();
    // ---- (b) ties: one row of pixels from A to an o seven tiles east, the canvas with A selected against the canvas with nobody ----
    const row = (k, inside) => {
      const o = B; o.inside = !!inside; A.rels = [{ who: o.name, k }]; o.rels = [];
      ev('showCard(null)'); const base = draw(); ev(`showCard(byName(${JSON.stringify(A.name)}))`); const sel = draw();
      const y = A.y * T - 3, x0 = A.x * T + 6, x1 = o.x * T - 6; let n = 0, ch = 0, sr = 0, sg = 0, sb = 0, lo = 255;
      for (let x = x0; x < x1; x++) { n++; const a = base(x, y), b = sel(x, y); if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) >= 8) { ch++; sr += b[0]; sg += b[1]; sb += b[2]; lo = Math.min(lo, b[0], b[1], b[2]); } }
      ev('showCard(null)'); B.inside = false;
      return { n, ch, r: ch ? sr / ch : 0, g: ch ? sg / ch : 0, b: ch ? sb / ch : 0, lo };
    };
    out.partner = row('partner'); out.friend = row('friend'); out.rival = row('rival'); out.parent = row('parent'); out.indoors = row('partner', true);
    // ---- (c) singing and the teller. Four stand at the fire a row apart: two know the song, two do not, and the oldest of the four is not one of the two ----
    const [s1, s2, n1, tl] = six.slice(2, 6); [s1, s2, n1, tl].forEach((p, i) => { stand(p, spot.x + 2 + i * 4, cy); p.task = 'gather'; ageTo(p, [32, 38, 36, 55][i]); });
    for (const p of [A, B]) stand(p, p.x, cy - 5);
    const songs0 = ev('songs').slice(); ev('songs.length=0'); ev('singNow=null'); /* an earlier scene may have heard a song; its window is animT 0 to a few seconds, the same clock this check reads */
    ev(`songs.push({ci:3,comp:${JSON.stringify(s1.name)},kn:[${JSON.stringify(s1.name)},${JSON.stringify(s2.name)}],lost:0,d:dayCount})`); ev('storyDay=dayCount');
    const sky = H.skyAt(.5, 'summer', 'clear', 0), hex = ev('noteCol(songs[0])'), want = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) * sky[(i - 1) / 2] / 255);
    const notes = p => { const g2 = null; let n = 0; const cap = draw(); for (let y = p.y * T - 26; y < p.y * T - 8; y++) for (let x = p.x * T + 2; x < p.x * T + 8; x++) { const c = cap(x, y); if (Math.max(Math.abs(c[0] - want[0]), Math.abs(c[1] - want[1]), Math.abs(c[2] - want[2])) <= 6) n++; } return n; };
    out.hex = hex;
    const frames = [0, .25, .5, .75];   // the glyph rises through three frames: every one of them must read
    out.sing = frames.map(f => { H.setAnimT(f); return [s1, s2, n1, tl].map(notes); });
    // a song that is lost is silent
    ev('songs[0].lost=1'); H.setAnimT(0); out.lost = [s1, s2].map(notes); ev('songs[0].lost=0');
    // the teller: the oldest grown person at the fire stands a pixel taller. Same canvas with and without the story on the day.
    H.setAnimT(0); const on = draw(); ev('storyDay=0'); const off = draw(); ev('storyDay=dayCount');
    const diff = (p, rows) => { let n = 0; for (const yy of rows) for (const xx of [p.x * T - 1, p.x * T]) { const a = on(xx, yy), b = off(xx, yy); if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) >= 8) n++; } return n; };
    out.teller = { head: diff(tl, [tl.y * T - 9]), others: [n1].map(p => diff(p, [p.y * T - 9, p.y * T - 8, p.y * T - 5])).concat([diff(s1, [s1.y * T - 9])]) };
    // ---- (d) A13: the note follows the beat that is sung. A forced songTune (audio is off here, which is the point: the picture follows the tune with or
    // without the sound) sets singNow; the note over the composer is read at a beat and half a beat later and has to have moved; the one who knows the song
    // but is not singing yet shows nothing on the first pass and a note on the second; a lost song sets nothing.
    ev('songs.length=0'); ev('storyDay=dayCount');
    ev(`songs.push({ci:3,comp:${JSON.stringify(s1.name)},kn:[${JSON.stringify(s1.name)},${JSON.stringify(s2.name)}],lost:0,d:dayCount})`);
    ev('singNow=null'); H.setAnimT(0); ev('songTune(songs[0],2)');
    const sn = ev('singNow'), colourPx = (cap, p) => { const m = []; for (let y = p.y * T - 26; y < p.y * T - 8; y++) for (let x = p.x * T + 2; x < p.x * T + 8; x++) { const c = cap(x, y); m.push(Math.max(Math.abs(c[0] - want[0]), Math.abs(c[1] - want[1]), Math.abs(c[2] - want[2])) <= 6 ? 1 : 0); } return m; };
    const atBeat = sn ? sn.a + 3 * sn.beat : 0, atHalf = atBeat + sn.beat / 2;
    H.setAnimT(atBeat); const m0 = colourPx(draw(), s1); H.setAnimT(atHalf); const m1 = colourPx(draw(), s1);
    out.beat = { set: !!sn, names: sn && sn.names, n: sn && sn.deg.length, on0: m0.reduce((a, b) => a + b, 0), on1: m1.reduce((a, b) => a + b, 0), diff: m0.filter((v, i) => v !== m1[i]).length };
    H.setAnimT(atBeat); out.beat.s2first = colourPx(draw(), s2).reduce((a, b) => a + b, 0);
    H.setAnimT(sn.second + 2 * sn.beat); out.beat.s2second = colourPx(draw(), s2).reduce((a, b) => a + b, 0);
    ev('singNow=null'); ev('songs[0].lost=1'); ev('songTune(songs[0],2)'); out.beat.lostSets = ev('singNow') !== null; ev('songs[0].lost=0'); ev('singNow=null');
    // someone sick and still up is a shade paler
    ev('songs.length=0'); ev('storyDay=0'); stand(tl, tl.x, tl.y);
    const lum = c => .299 * c[0] + .587 * c[1] + .114 * c[2];
    const well = lum(draw()(tl.x * T, tl.y * T - 3)); tl.sick = true; const ill = lum(draw()(tl.x * T, tl.y * T - 3)); tl.sick = false;
    out.sick = { well, ill };
    return out;
  });
  const m = (o) => `${o.ch} of ${o.n} samples, mean rgb ${o.r.toFixed(0)},${o.g.toFixed(0)},${o.b.toFixed(0)}`;
  if (!r.spot || r.few) { check('who: an open block of grass to stand people on, and six people to stand', false, JSON.stringify(r)); return; }
  check('tags: nothing selected at zoom 1 and no tags', r.tagsNone === 0, `${r.tagsNone} tags`);
  check('tags: the selected person has a tag in #tags, gold, within 12 px of where they are projected', !!r.tagSel && r.tagSel.dx <= 12 && r.tagSel.dy <= 12 && r.tagSel.sel && r.tagSel.n === 1, JSON.stringify(r.tagSel));
  check('tags: at zoom 1 the pointer near people shows no tags, at zoom 3.2 it shows theirs', r.hover1 === 0 && r.hover3.hasC && r.hover3.n >= 1, `zoom 1: ${r.hover1}; zoom 3.2: ${JSON.stringify(r.hover3)}`);
  check('tags: seven people round the pointer show six tags, no more', r.hoverMany === 6, `${r.hoverMany}`);
  check('ties: a partner out of doors is joined to the selected person by a warm line the whole way', r.partner.ch >= .8 * r.partner.n && r.partner.r - r.partner.b >= 40, m(r.partner));
  check('ties: a friend is joined by a green line the whole way', r.friend.ch >= .8 * r.friend.n && r.friend.g - r.friend.r >= 30, m(r.friend));
  check('ties: a parent or child is joined by a pale line', r.parent.ch >= .8 * r.parent.n && r.parent.lo >= 150, m(r.parent) + `, darkest channel ${r.parent.lo}`);
  check('ties: a rival is joined by a red line that is dashed: about half the samples', r.rival.ch >= .35 * r.rival.n && r.rival.ch <= .7 * r.rival.n && r.rival.r - r.rival.g >= 60, m(r.rival));
  check('ties: a partner who is indoors gets no line', r.indoors.ch === 0, m(r.indoors));
  check('singing: the two who know the song have its colour over their heads at every frame of the rise, the two who do not have none', r.sing.every(f => f[0] >= 3 && f[1] >= 3 && f[2] === 0 && f[3] === 0), `${r.hex}: ${JSON.stringify(r.sing)}`);
  check('singing: a song that is lost is silent', r.lost[0] === 0 && r.lost[1] === 0, JSON.stringify(r.lost));
  check('teller: the oldest at the fire stands a pixel taller on the night; nobody else changes', r.teller.head === 2 && r.teller.others.every(n => n === 0), JSON.stringify(r.teller));
  check('sung: with singNow set by songTune, the note over the composer has the song colour and has moved half a beat later', r.beat.set && r.beat.on0 >= 3 && r.beat.on1 >= 3 && r.beat.diff >= 4, JSON.stringify(r.beat));
  check('sung: the second voice shows no note on the first pass, shows one on the second', r.beat.s2first === 0 && r.beat.s2second >= 3, JSON.stringify(r.beat));
  check('sung: a lost song sets nothing for the picture to follow', r.beat.lostSets === false, JSON.stringify(r.beat));
  check('sick: someone sick and still up is drawn paler than the same person well', r.sick.ill >= r.sick.well + 8, `${r.sick.well.toFixed(1)} well, ${r.sick.ill.toFixed(1)} ill`);
}

// ---- (2) the eight scenes, at zoom 1 and zoom 3.2: pictures and timing ----

// ---- (7) A4: seasons on the land. Four groups: the dry year (S1), snow, ice and bare trees (S5), and the autumn island (litter, wind, leaves). ----
// Ground pixels are read off the terrain canvas (H.terCv), which carries no light, so a colour is exactly what paintTerrain() put down. Trees are
// read off the lit picture at zoom 1, where one world pixel is one canvas pixel: a bare winter tree is dark brown, a leafed one is green.
const PAGE_HELPERS = `
  const H = window.__hearth, T = 8, W = 110, HH = 70, tiles = H.tilesNow, elev = H.elevNow, road = H.road;
  const terr = () => H.terCv.getContext('2d').getImageData(0, 0, W * T, HH * T).data;
  const farFrom = (t, list, d) => list.every(h => Math.hypot(h.x - t.x, h.y - t.y) > d);
  const waterNear = (t, d) => { for (let j = -d; j <= d; j++) for (let i = -d; i <= d; i++) { const x = (t.x | 0) + i, y = (t.y | 0) + j; if (x >= 0 && y >= 0 && x < W && y < HH && tiles[y * W + x] === 0) return true; } return false; };
  const freeTrees = (minS, max) => H.trees.filter(t => t.s > minS && t.x > 3 && t.x < W - 3 && t.y > 5 && t.y < HH - 2 && farFrom(t, H.houses, 8) && farFrom(t, [...H.people, ...H.wild, ...H.gulls, ...H.flies, ...H.boats], 5) && !waterNear(t, 5)).slice(0, max);
`;
async function dryChecks(page) {
  const r = await page.evaluate((helpers) => {
    eval(helpers.replace(/const /g, 'var '));
    const keep = H.dry01, hueOf = d => {
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = 0; y < HH; y++) for (let x = 0; x < W; x++) {
        if (tiles[y * W + x] !== 2 || road[y * W + x]) continue;
        const k = ((y * T + 3) * W * T + x * T + 3) * 4; sr += d[k]; sg += d[k + 1]; sb += d[k + 2]; n++;
      }
      const r = sr / n / 255, g = sg / n / 255, b = sb / n / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      return { hue: 60 * (mx === g ? 2 + (b - r) / c : mx === r ? ((g - b) / c + 6) % 6 : 4 + (r - g) / c), n };
    };
    const at = d => { H.setDry(d); H.draw(); return { key: paintedKey, ...hueOf(terr()) }; };
    const dry0 = at(0), tiny = at(.1), dry9 = at(.9);
    H.setDry(keep); H.draw();
    return { dry0, tiny, dry9, keep };
  }, PAGE_HELPERS);
  check('dry: S1 with setDry(.9) paints under a different paintedKey than setDry(0)', r.dry0.key !== r.dry9.key, `${r.dry0.key} and ${r.dry9.key}`);
  check('dry: a drift of .1 is under the first of four levels and does not repaint', r.dry0.key === r.tiny.key, `${r.dry0.key} and ${r.tiny.key}`);
  check('dry: the grass hue of S1 at setDry(.9) is at least 4 degrees nearer yellow than at setDry(0)', r.dry0.n > 500 && r.dry0.hue - r.dry9.hue >= 4, `${r.dry0.hue.toFixed(1)} against ${r.dry9.hue.toFixed(1)} over ${r.dry0.n} tiles`);
  console.log(`      dry: grass hue ${r.dry0.hue.toFixed(1)} at 0, ${r.dry9.hue.toFixed(1)} at .9`);
}
async function snowChecks(page) {
  const r = await page.evaluate((helpers) => {
    eval(helpers.replace(/const /g, 'var '));
    const keep = H.snowD, snowTile = (d, x, y) => { let n = 0; for (const [i, j] of [[1, 1], [6, 1], [1, 6], [6, 6]]) { const k = ((y * T + j) * W * T + x * T + i) * 4; if (Math.min(d[k], d[k + 1], d[k + 2]) > 205) n++; } return n >= 3; };
    const outside = (x, y) => farFrom({ x: x + .5, y: y + .5 }, H.houses, 9);
    const cover = (d, test) => { let n = 0, s = 0; for (let y = 1; y < HH - 1; y++) for (let x = 1; x < W - 1; x++) if (tiles[y * W + x] === 2 && !road[y * W + x] && test(x, y)) { n++; if (snowTile(d, x, y)) s++; } return { n, s }; };
    // (a) S5 as it stands
    H.paintTerrain(); let d = terr();
    const all = cover(d, outside);
    let checker = 0;
    const gs = (x, y) => tiles[y * W + x] === 2 && !road[y * W + x] && outside(x, y);
    for (let y = 1; y < HH - 2; y++) for (let x = 1; x < W - 2; x++) if (gs(x, y) && gs(x + 1, y) && gs(x, y + 1) && gs(x + 1, y + 1)) {
      const a = snowTile(d, x, y), b = snowTile(d, x + 1, y), c = snowTile(d, x, y + 1), e = snowTile(d, x + 1, y + 1);
      if ((a && e && !b && !c) || (!a && !e && b && c)) checker++;
    }
    // (b) the shore ice: every frozen tile with land to its east has the pale rim on its last two columns
    let iceN = 0, iceOk = 0;
    for (let y = 0; y < HH; y++) for (let x = 0; x < W - 1; x++) if (tiles[y * W + x] === 0 && elev[y * W + x] > .16 && tiles[y * W + x + 1] !== 0) {
      iceN++; const k0 = (y * T + 3) * W * T + x * T + 6, k1 = k0 + 1, ok = k => d[k * 4] === 232 && d[k * 4 + 1] === 242 && d[k * 4 + 2] === 248;
      if (ok(k0) && ok(k1)) iceOk++;
    }
    // (c) snow by exposure, at a light fall: open grass is covered, grass under a tree is not
    H.setSnow(.35); H.paintTerrain(); d = terr();
    const under = new Set(); for (const t of H.trees) if (t.s > .4) under.add((t.y | 0) * W + (t.x | 0));
    const open = cover(d, (x, y) => !under.has(y * W + x) && !under.has((y + 1) * W + x));
    const shade = cover(d, (x, y) => under.has(y * W + x));
    H.setSnow(.2); H.paintTerrain(); d = terr();
    const high = cover(d, (x, y) => elev[y * W + x] >= .5 && !under.has(y * W + x)), low = cover(d, (x, y) => elev[y * W + x] <= .3 && !under.has(y * W + x));
    H.setSnow(keep); H.paintTerrain(); H.setZoom(1); H.draw();
    // (d) the winter trees, read off the lit picture
    const g = document.getElementById('c').getContext('2d'); let sampled = 0, green = 0; const brown = [];
    for (const t of freeTrees(.7, 40)) {
      const bx = Math.round(t.x * T) - 12, by = Math.round(t.y * T) - 24, px = g.getImageData(bx, by, 25, 27).data; let gr = 0, br = 0;
      for (let i = 0; i < px.length; i += 4) { const R = px[i], G = px[i + 1], B = px[i + 2], lum = .299 * R + .587 * G + .114 * B; if (G > R + 15 && G > B + 15) gr++; if (lum < 120 && R > G + 4 && G > B + 4) br++; }
      sampled++; if (gr > 0) green++; brown.push(br);
    }
    brown.sort((a, b) => a - b);
    return { all, checker, iceN, iceOk, open, shade, high, low, sampled, green, medBrown: brown[brown.length >> 1] || 0 };
  }, PAGE_HELPERS);
  check('snow: in S5 at least 90% of grass tiles outside the village are snow-coloured', r.all.n > 500 && r.all.s >= .9 * r.all.n, `${r.all.s} of ${r.all.n}`);
  check('snow: in S5 no 2 by 2 block of grass alternates snow and bare ground (the checker)', r.all.n > 500 && r.checker === 0, `${r.checker} alternating blocks`);
  check('snow: shore ice leaves a pale rim on the land edge of every frozen tile in S5', r.iceN >= 5 && r.iceOk === r.iceN, `${r.iceOk} of ${r.iceN}`);
  check('snow: at a light fall (.35) open grass is covered and the grass under a tree is not', r.open.n > 300 && r.open.s >= .9 * r.open.n && r.shade.n > 20 && r.shade.s <= .25 * r.shade.n, `open ${r.open.s}/${r.open.n}, under trees ${r.shade.s}/${r.shade.n}`);
  check('snow: at a lighter fall (.2) high ground is covered before low ground', r.high.n > 50 && r.low.n > 20 && r.high.s / r.high.n - r.low.s / r.low.n >= .4, `high ${r.high.s}/${r.high.n}, low ${r.low.s}/${r.low.n}`);
  check('winter trees: no green canopy on the picture, and a dark brown bare shape on each', r.sampled >= 8 && r.green <= r.sampled * .1 && r.medBrown >= 8, `${r.sampled} trees, ${r.green} with green, median ${r.medBrown} brown pixels`);
  console.log(`      snow: ${r.all.s}/${r.all.n} covered, ${r.checker} checker blocks, ice rim ${r.iceOk}/${r.iceN}, bare trees median ${r.medBrown} brown px over ${r.sampled}`);
}
// the autumn island: its own page, because the checks set the weather and walk the clock. Day 133 is autumn's third day (no leaves yet), 134 its fourth.
async function autumnChecks() {
  const { ctx, page } = await open(7);
  await page.evaluate(() => { const H = window.__hearth; while (H.dayCount < 133) H.step(.05); H.setTime((Math.floor(H.time / 140) + .4) * 140); for (let i = 0; i < 40; i++) H.step(.05); });
  const r = await page.evaluate((helpers) => {
    eval(helpers.replace(/const /g, 'var '));
    const COL = [[[138, 74, 30], [196, 122, 42]], [[138, 46, 30], [184, 64, 42]], [[122, 106, 32], [176, 154, 44]]];
    H.setWx('overcast'); H.paintTerrain(); const d = terr();
    // (a) litter: exact autumn colours of the tree, on its own tile and the eight around it
    const lit = []; for (const t of freeTrees(.5, 60)) {
      const c = COL[t.a < .35 ? 0 : t.a < .7 ? 1 : 2]; let n = 0;
      for (let y = (t.y | 0) - 1; y <= (t.y | 0) + 1; y++) for (let x = (t.x | 0) - 1; x <= (t.x | 0) + 1; x++) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
        const k = ((y * T + j) * W * T + x * T + i) * 4; if (c.some(cc => d[k] === cc[0] && d[k + 1] === cc[1] && d[k + 2] === cc[2])) n++;
      }
      lit.push(n);
    }
    lit.sort((a, b) => a - b);
    // (b) the wind: the same instant drawn at two animT values; a tree's box differs when it swayed, and under reduced motion no box differs
    H.setZoom(1); const g = document.getElementById('c').getContext('2d'), tr = freeTrees(.5, 40);
    const shot = () => tr.map(t => g.getImageData(Math.round(t.x * T) - 14, Math.round(t.y * T) - 26, 29, 28).data);
    const moved = (a, b) => a.reduce((n, p, i) => { let df = false; for (let k = 0; k < p.length; k++) if (p[k] !== b[i][k]) { df = true; break; } return n + (df ? 1 : 0); }, 0);
    const wind = {};
    for (const rm of [false, true]) { H.RM = rm; H.setAnimT(0); H.draw(); const a = shot(); H.setAnimT(1.3); H.draw(); wind[rm ? 'rm' : 'free'] = moved(a, shot()); }
    H.RM = false; H.setAnimT(0); H.draw();
    const leaves133 = fallingLeaves;
    return { lit, sampled: lit.length, wind, boxes: tr.length, leaves133 };
  }, PAGE_HELPERS);
  await page.evaluate(() => { const H = window.__hearth; while (H.dayCount < 134) H.step(.05); });
  const q = await page.evaluate(() => { const H = window.__hearth, out = {}; H.setZoom(1); for (const rm of [false, true]) { H.RM = rm; H.draw(); out[rm ? 'rm' : 'free'] = fallingLeaves; } H.RM = false; return out; });
  check('litter: in autumn every sampled tree has at least 8 pixels of its own leaf colour on the tiles around it', r.sampled >= 6 && r.lit[0] >= 8, `${r.sampled} trees, fewest ${r.lit[0]}, median ${r.lit[r.sampled >> 1]}`);
  check('wind: at overcast, a quarter of the trees move a pixel between two animT values', r.boxes >= 6 && r.wind.free >= .25 * r.boxes, `${r.wind.free} of ${r.boxes} trees differ`);
  check('wind: under reduced motion no tree moves between two animT values', r.boxes >= 6 && r.wind.rm === 0, `${r.wind.rm} of ${r.boxes} trees differ`);
  check('leaves: none in the air on autumn day 3 of 5', r.leaves133 === 0, `${r.leaves133}`);
  check('leaves: on autumn day 4, 40 in the air, and no more than 20 under reduced motion', q.free > 20 && q.free <= 40 && q.rm > 0 && q.rm <= 20, JSON.stringify(q));
  console.log(`      autumn: litter fewest ${r.lit[0]} px per tree, wind moved ${r.wind.free}/${r.boxes} (${r.wind.rm} under RM), leaves ${q.free}/${q.rm}`);
  await ctx.close();
}

// ---- (9) A5: the sun casts shadows. A fresh seed-7 island on summer day 128, zoom 1, no people moved, only the hour and the weather set. ----
// Summer's edges are .15 and .86, so e[0]+.08 is .23 and e[1]-.08 is .78. For each house whose two strips are plain grass (not road, with no other
// house or tree beside it in its row: the median over houses answers for anyone passing) the strip 6 to 14 px west of the footprint against the strip 6 to 14 px east of it, on
// the four rows from 6 to 2 px above the foot, mean luminance, west minus east, read in clear weather and in rain (which has no shadow) at each hour. Break: fix dir at
// +1 in sunAt (js/look.js); the morning check fails and the evening one stays, which is the break the design names. A second break, drop the wx==='clear'
// test from str, fails the rain pair.
async function shadowChecks() {
  const { ctx, page } = await open(7);
  const read = (f, wx) => page.evaluate(([f, wx]) => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), W = 110, HH = 70, T = 8;
    H.setTime((Math.floor(H.time / 140) + f) * 140); H.setWx(wx); H.setSnow(0); H.setZoom(1); H.draw();
    const tiles = H.tilesNow, road = H.road;
    const plain = (x, y, w, h) => { for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) { const tx = Math.floor((x + i) / T), ty = Math.floor((y + j) / T); if (tx < 0 || ty < 0 || tx >= W || ty >= HH || tiles[ty * W + tx] !== 2 || road[ty * W + tx]) return false; } return true; };
    const diffs = [], all = H.houses.slice(), trees = H.trees.slice();
    for (const h of all) {
      const x0 = h.x * T, x1 = x0 + 16, y = h.y * T + 10;
      if (!plain(x0 - 14, y, 8, 4) || !plain(x1 + 6, y, 8, 4)) continue;
      /* a shadow falls on whatever is downwind of what casts it, and the village is 24 px apart, so each house is drawn alone: the others and the trees are lifted out of the
         page's own arrays for the one draw and put back */
      H.houses.length = 0; H.houses.push(h); H.trees.length = 0; H.draw();
      const d2 = g.getImageData(0, 0, W * T, HH * T).data;
      const lum2 = (x, y, w, hh) => { let t = 0, n = 0; for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) { const k = ((y + j) * W * T + x + i) * 4; t += .299 * d2[k] + .587 * d2[k + 1] + .114 * d2[k + 2]; n++; } return t / n; };
      diffs.push(lum2(x0 - 14, y, 8, 4) - lum2(x1 + 6, y, 8, 4)); /* west minus east: negative when the west is darker */
      H.houses.length = 0; H.houses.push(...all); H.trees.length = 0; H.trees.push(...trees);
    }
    diffs.sort((a, b) => a - b);
    return { n: diffs.length, med: diffs.length ? diffs[diffs.length >> 1] : 0, sun: H.sunAt(f, 'summer', wx) };
  }, [f, wx]);
  await page.evaluate(() => { const H = window.__hearth; while (H.dayCount < 128) H.step(.05); for (let i = 0; i < 40; i++) H.step(.05); });
  const am = await read(.23, 'clear'), pm = await read(.78, 'clear'), noon = await read(.5, 'clear'), noonRain = await read(.5, 'rain'), amRain = await read(.23, 'rain'), pmRain = await read(.78, 'rain');
  /* the ground's own light and dark (relief shades the land from the north-west) leaves the west strip about 5 brighter than the east even in rain, so a shadow is what a strip
     reads in clear weather beyond what the same strip reads in rain at the same hour: the morning's west-minus-east must be at least 12 lower than the rain's, the evening's at least 12 higher */
  const mEff = amRain.med - am.med, eEff = pm.med - pmRain.med;
  check('shadow: at e[0]+.08 in clear weather the strip 6 px west of a house is darker than the strip 6 px east by at least 12 more than in rain (median over houses)', am.n >= 2 && mEff >= 12, `${am.n} houses, clear ${am.med.toFixed(1)}, rain ${amRain.med.toFixed(1)}`);
  check('shadow: at e[1]-.08 in clear weather the strip 6 px east of a house is darker than the strip 6 px west by at least 12 more than in rain (median over houses)', pm.n >= 2 && eEff >= 12, `${pm.n} houses, clear ${pm.med.toFixed(1)}, rain ${pmRain.med.toFixed(1)}`);
  check('shadow: at noon the two strips read what they read in rain, within 12: noon is flat', noon.n >= 2 && Math.abs(noon.med - noonRain.med) < 12, `${noon.n} houses, clear ${noon.med.toFixed(1)}, rain ${noonRain.med.toFixed(1)}`);
  check('shadow: in rain the morning and the evening read the same pair of strips within 4 of each other, so nothing parts them', amRain.n >= 2 && pmRain.n >= 2 && Math.abs(amRain.med - pmRain.med) <= 4, `morning ${amRain.med.toFixed(1)}, evening ${pmRain.med.toFixed(1)}`);
  check('shadow: sunAt points west in the morning and east in the evening, and is longer at the edges than at noon', am.sun.dir <= -.99 && pm.sun.dir >= .99 && am.sun.len > noon.sun.len && pm.sun.len > noon.sun.len && noon.sun.len >= .39 && am.sun.len <= 3 && am.sun.str === .28 && amRain.sun.str === 0, JSON.stringify([am.sun, pm.sun, noon.sun]));
  console.log(`      shadows: west minus east, morning ${am.med.toFixed(1)}, evening ${pm.med.toFixed(1)}, noon ${noon.med.toFixed(1)}, rain ${amRain.med.toFixed(1)}/${pmRain.med.toFixed(1)} over ${am.n} houses; sun at e[0]+.08 ${JSON.stringify(am.sun)}`);
  await ctx.close();
}
await shadowChecks();

// ---- (10) A6: weather that lands. A fresh seed-7 island on summer day 128 at noon, zoom 1, whole island in view, animT held still. ----
// Foam is counted as new when overcast weather drawn at the same instant (no rain, so no rings, the same clouds) lacks it, which keeps the island's own bright pixels out of the count. Foam is a pixel on a water tile that is bright and not warm (lum over 185, blue at least red): the rain streaks over dark water read about 110, so only a ring
// reaches it. The land is the mean luminance of every land tile's pixels, sampled every second pixel, so the same measure reads the whole island. wetA is set by the
// page's setter, because easing it in takes twenty seconds of animT. The wet check compares rain with the land wet against rain with it dry, which is the ground and
// nothing else: the design's S3 against S1 would pass on the rain's own darker sky alone. Break 1: gate the splashes on !rain in wetStep's caller (drawWet) and the foam
// check fails. Break 2: draw the wet mask at alpha 0; the wet check fails. Break 3: dry at 1/9 the rate and the dry-again check fails; the in-between checks
// stay. Break 4: leave drawRoofWet's fillRect out; the roof check fails.
async function rainChecks() {
  const { ctx, page } = await open(7);
  await page.evaluate(() => { const H = window.__hearth; while (H.dayCount < 128) H.step(.05); H.setTime((Math.floor(H.time / 140) + .5) * 140); for (let i = 0; i < 40; i++) H.step(.05); H.setSnow(0); H.setZoom(1); H.setAnimT(500.5); });
  const read = (wx, wet, dAnim) => page.evaluate(([wx, wet, dAnim]) => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), Wd = 110, HH = 70, T = 8;
    H.setWx(wx); if (wet !== null) H.setWetA(wet); if (dAnim) H.setAnimT(H.animT + dAnim); H.draw();
    const d = g.getImageData(0, 0, Wd * T, HH * T).data, tl = H.tilesNow;
    let foam = 0, fresh = 0, lt = 0, ln = 0; const mask = new Uint8Array(Wd * T * HH * T), base = window.__clearFoam;
    for (let y = 0; y < HH * T; y++) for (let x = 0; x < Wd * T; x++) {
      const k = (y * Wd * T + x) * 4, wt = tl[((y / T) | 0) * Wd + ((x / T) | 0)] === 0, l = .299 * d[k] + .587 * d[k + 1] + .114 * d[k + 2];
      if (wt) { if (l > 185 && d[k + 2] >= d[k]) { foam++; mask[k >> 2] = 1; if (base && !base[k >> 2]) fresh++; } } else if (((x + y) & 1) === 0) { lt += l; ln++; }
    }
    if (wx === 'overcast') window.__clearFoam = mask;
    return { foam, fresh, land: lt / ln, wetA: H.wetA };
  }, [wx, wet, dAnim]);
  const clear = await read('clear', 0, 0); await read('overcast', 0, 0); const rainDry = await read('rain', 0, 0), rainWet = await read('rain', 1, 0);
  check('rain: rings on the water, at least 40 foam-coloured pixels on water in rain that overcast weather at the same instant does not have', rainDry.fresh >= 40, `rain ${rainDry.foam}, new ${rainDry.fresh}`);
  check('rain: wet ground, land luminance with wetA at 1 is 8% or more below the same rain with wetA at 0', rainWet.land <= rainDry.land * .92, `dry ${rainDry.land.toFixed(1)}, wet ${rainWet.land.toFixed(1)}`);
  /* the time constants: from dry, 10 s of animT in rain is half wet; from wet, 10 s of clear is still over .8; 100 s of clear is dry and the land is back within 2% */
  await read('clear', 0, 0);
  await read('rain', 0, 0);
  const in10 = await read('rain', null, 10), out10a = await read('rain', 1, 0), out10 = await read('clear', null, 10), out100 = await read('clear', null, 100), back = await read('clear', null, 0);
  check('rain: the ground wets over 20 s of animT: half wet at 10 s, between .4 and .6', in10.wetA > .4 && in10.wetA < .6, `wetA ${in10.wetA.toFixed(3)}`);
  check('rain: the ground stays dark for a while after it stops: wetA over .8 at 10 s of clear weather', out10.wetA > .8 && out10a.wetA === 1, `wetA ${out10.wetA.toFixed(3)}`);
  check('rain: with weather back to clear and animT 100 s on, wetA is 0 and land luminance is within 2% of clear', out100.wetA === 0 && Math.abs(back.land - clear.land) <= clear.land * .02, `wetA ${out100.wetA}, land ${back.land.toFixed(1)} against ${clear.land.toFixed(1)}`);
  /* the roofs: the top edge of each house, as the page finds it, read with the roof line and without it */
  const roof = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), T = 8, Wd = 110, HH = 70;
    H.setWx('rain'); const lum = wet => { H.setWetA(wet); H.draw(); const d = g.getImageData(0, 0, Wd * T, HH * T).data, out = [];
      for (const h of H.houses) { const nm = H.roofFrame(h.r), f = H.sheet.atlas.frames[nm]; let t = 0, n = 0;
        for (const p of H.roofEdge(nm)) { const x = h.x * T - f.ax + p[0], y = h.y * T - f.ay + p[1]; if (x < 0 || y < 0 || x >= Wd * T || y >= HH * T) continue; const k = (y * Wd * T + x) * 4; t += .299 * d[k] + .587 * d[k + 1] + .114 * d[k + 2]; n++; }
        out.push(n ? t / n : 0); }
      return out; };
    const dry = lum(0), wet = lum(1), diffs = dry.map((v, i) => wet[i] - v).sort((a, b) => a - b);
    return { n: diffs.length, med: diffs[diffs.length >> 1], pts: H.roofEdge(H.roofFrame(H.houses[0].r)).length };
  });
  check('rain: a bright line along each roof\'s top edge, at least 15 brighter in luminance (median over houses) with wetA at 1 than at 0', roof.n >= 2 && roof.pts >= 8 && roof.med >= 15, `${roof.n} houses, ${roof.pts} edge pixels on the first, median ${roof.med.toFixed(1)}`);
  /* lightning goes through the light map: at night with flash at 1 the grass is grass-coloured and brighter than without, not a white sheet */
  const fl = await page.evaluate(() => {
    const H = window.__hearth, g = document.getElementById('c').getContext('2d'), T = 8, Wd = 110, HH = 70;
    H.setWx('thunder'); H.setWetA(0); H.setTime((Math.floor(H.time / 140) + .97) * 140);
    const grab = f => { H.setFlash(f); H.draw(); const d = g.getImageData(0, 0, Wd * T, HH * T).data, tl = H.tilesNow, rd = H.road; let r = 0, gg = 0, b = 0, n = 0;
      for (let y = 4; y < HH * T; y += 8) for (let x = 4; x < Wd * T; x += 8) { const ti = ((y / T) | 0) * Wd + ((x / T) | 0); if (tl[ti] !== 2 || rd[ti]) continue; const k = (y * Wd * T + x) * 4; r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
      return { r: r / n, g: gg / n, b: b / n, n }; };
    const off = grab(0), on = grab(1);
    return { off, on };
  });
  const lum3 = c => .299 * c.r + .587 * c.g + .114 * c.b;
  check('rain: a flash at night shows the grass its own colour, over 40% brighter than without and green above red by 10, not a white sheet', fl.on.n > 100 && lum3(fl.on) > lum3(fl.off) * 1.4 && fl.on.g - fl.on.r >= 10, `off ${JSON.stringify(fl.off)}, on ${JSON.stringify(fl.on)}`);
  console.log(`      rain: foam clear ${clear.foam}, rain ${rainDry.foam} (${rainDry.fresh} new); land dry ${rainDry.land.toFixed(1)}, wet ${rainWet.land.toFixed(1)} (clear ${clear.land.toFixed(1)}, back ${back.land.toFixed(1)}); roofs ${roof.med.toFixed(1)} over ${roof.n}`);
  await ctx.close();
}
await rainChecks();

// ---- A7: weather that lands, the cold half. Smoke over the houses with somebody home, fog that is thickest at the edge, snow that leaves the roofs ----
async function coldChecks() {
  const prep = async (sc, extra) => {
    const { ctx, page } = await open(7);
    await page.evaluate(sc => { const H = window.__hearth; while (H.dayCount < sc.day) H.step(.05); H.setTime((Math.floor(H.time / 140) + sc.f) * 140); H.setWx(sc.wx); H.setSnow(sc.snow); for (let i = 0; i < 40 + (sc.settle || 0); i++) H.step(.05); H.setZoom(1); H.setAnimT(500.5); }, sc);
    return { ctx, page };
  };
  /* S6: winter dusk. Smoke-coloured pixels in the 20 px above each house, while its people are home and after everybody has been moved away */
  {
    const { ctx, page } = await prep(SCENES[5]);
    const r = await page.evaluate(() => {
      const H = window.__hearth, g = document.getElementById('c').getContext('2d'), T = 8, Wd = 110, HH = 70, cols = [[0xcf, 0xc8, 0xbe], [0x6a, 0x6f, 0x8e]];
      /* put somebody home in four houses (asleep at the door) and everybody else a long way off; then the same frame with smoke taken away, so what differs is the smoke */
      H.houses.forEach((h, i) => { for (const p of H.people) if (p.home === h) { if (i % 3 === 0) { p.x = h.x + 1; p.y = h.y + 2; p.inside = false; p.task = 'sleep'; } else { p.x = 1; p.y = 1; p.inside = false; p.task = 'idle'; } } });
      for (const p of H.people) { p.shelterH = null; if (!H.houses.includes(p.home) || !(H.houses.indexOf(p.home) % 3 === 0)) { p.x = 1; p.y = 1; p.inside = false; p.task = 'idle'; } }
      const grab = () => { H.draw(); return g.getImageData(0, 0, Wd * T, HH * T).data; };
      const withS = grab(); H.lookOff.smoke = true; const noS = grab(); H.lookOff.smoke = false;
      const out = []; for (const h of H.houses) { let n = 0; for (let y = Math.max(0, h.y * T - 20); y < h.y * T + 1; y++) for (let x = h.x * T + 6; x < Math.min(Wd * T, h.x * T + 24); x++) { const k = (y * Wd * T + x) * 4; if (Math.abs(withS[k] - noS[k]) + Math.abs(withS[k + 1] - noS[k + 1]) + Math.abs(withS[k + 2] - noS[k + 2]) > 20 && cols.some(c => Math.hypot(withS[k] - c[0], withS[k + 1] - c[1], withS[k + 2] - c[2]) < 70)) n++; }
        out.push({ n, home: H.houseOccupied(h) }); }
      return { out, pos: H.houses.map(h => [h.x, h.y]) };
    });
    const hm = r.out.filter(o => o.home), away = r.out.filter((o, i) => !o.home && !r.out.some((q, j) => q.home && Math.abs(r.pos[i][0] - r.pos[j][0]) < 4 && Math.abs(r.pos[i][1] - r.pos[j][1]) < 4)); /* a neighbour's column can lean over its neighbour: only houses with no occupied house within 4 tiles are asked for none */
    check('smoke: in S6 every house with somebody home has at least 4 smoke-coloured pixels in the 20 px above it', hm.length >= 2 && hm.every(o => o.n >= 4), JSON.stringify(r.out));
    check('smoke: in S6 above a house whose people have been moved away there is none', away.length >= 2 && away.every(o => o.n === 0), JSON.stringify(r.out));
    console.log(`      smoke: ${hm.length} of ${r.out.length} houses with somebody home, smoke pixels ${hm.map(o => o.n).join(',')}; away ${away.map(o => o.n).join(',')}`);
    await ctx.close();
  }
  /* S4: autumn fog. Saturation at the four corners of the view against the middle, with fog and with it taken away */
  {
    const { ctx, page } = await prep(SCENES[3]);
    const r = await page.evaluate(() => {
      const H = window.__hearth, g = document.getElementById('c').getContext('2d'), cvs = document.getElementById('c'), w = cvs.width, h = cvs.height;
      const sat = (d, x0, y0) => { let t = 0, n = 0; for (let y = y0; y < y0 + 40; y++) for (let x = x0; x < x0 + 40; x++) { const k = (y * w + x) * 4, mx = Math.max(d[k], d[k + 1], d[k + 2]), mn = Math.min(d[k], d[k + 1], d[k + 2]); if (mx > 0) { t += (mx - mn) / mx; n++; } } return t / n; };
      const read = () => { H.draw(); const d = g.getImageData(0, 0, w, h).data; const c = [[0, 0], [w - 40, 0], [0, h - 40], [w - 40, h - 40]].map(([x, y]) => sat(d, x, y)); return { centre: sat(d, w / 2 - 20, h / 2 - 20), corner: c.reduce((a, b) => a + b, 0) / 4 }; };
      const fog = read(), fogA = H.fogA;
      H.setFogA(0); const clear = read();
      return { fog, clear, fogA };
    });
    check('fog: in S4 the colour saturation at the view\'s corners is lower than at its centre', r.fogA > .3 && r.fog.corner < r.fog.centre, JSON.stringify(r));
    check('fog: the corners lose at least .1 more saturation to the fog than the centre does', (r.clear.corner - r.fog.corner) - (r.clear.centre - r.fog.centre) >= .1, JSON.stringify(r));
    await ctx.close();
  }
  /* S5-like: snow thinning on the roofs sheds pixels that move; deep snow and falling snow do not */
  {
    const { ctx, page } = await prep(SCENES[4]);
    const r = await page.evaluate(() => {
      const H = window.__hearth, g = document.getElementById('c').getContext('2d'), T = 8, Wd = 110, HH = 70, f = H.sheet.atlas.frames['house-snow'];
      const diff = sd => { H.setWx('clear'); H.setSnow(sd); H.setAnimT(500.5); H.lookOff.shed = false; H.draw(); const a = g.getImageData(0, 0, Wd * T, HH * T).data; H.lookOff.shed = true; H.draw(); const b = g.getImageData(0, 0, Wd * T, HH * T).data; H.lookOff.shed = false; let n = 0;
        for (const h of H.houses) { const oy = h.y * T - f.ay, ox = h.x * T - f.ax; for (let y = oy; y < oy + f.h + 5; y++) for (let x = ox; x < ox + f.w; x++) { if (x < 0 || y < 0 || x >= Wd * T || y >= HH * T) continue; const k = (y * Wd * T + x) * 4; if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 30) n++; } }
        return n; };
      const thin = diff(.2); H.setSnow(.2); const sh1 = H.snowSheds(); const deep = diff(.5); H.setSnow(.5); const sh2 = H.snowSheds();
      return { thin, deep, sheds: sh1, notShed: sh2 };
    });
    check('snow: at a thinning .2 under clear sky pixels move below the roofs\' south eaves, and not at .5', r.sheds && !r.notShed && r.thin >= 8 && r.deep === 0, JSON.stringify(r));
    await ctx.close();
  }
}
await coldChecks();

const rows = [], lums = {};
// the stock checks set wood, food and granary and the clock by hand, so they get an island of their own: run on the scenes' island they left S7's lit windows with no pairs to measure
{
  const { ctx, page } = await open(7);
  await stockChecks(page);
  await ctx.close();
}
{
  const { ctx, page } = await open(7);
  await page.evaluate(() => { const H = window.__hearth; while (H.dayCount < 128) H.step(.05); H.setTime((Math.floor(H.time / 140) + .5) * 140); for (let i = 0; i < 40; i++) H.step(.05); });
  await whoChecks(page);
  await ctx.close();
}
{
  const { ctx, page } = await open(7);
  await handsChecks(page);
  await ctx.close();
}
{
  const { ctx, page } = await open(7);
  await farChecks(page);
  await ctx.close();
}
{
  const { ctx, page } = await open(7);
  await groundChecks(page);
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
      const lum = z === 1 ? await page.evaluate(() => { const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; return t / (d.length / 4); }) : null;
      if (lum !== null) lums[sc.id] = lum;
      rows.push({ id: sc.id, name: sc.name, z, med, p95 });
      const png = await page.locator('#c').screenshot();
      fs.writeFileSync(path.join(OUT, `${sc.id}-${sc.name.replace(/ /g, '-')}-z${z}.png`), png);
    }
    if (sc.id === 'S1') await animChecks(page);
    if (sc.id === 'S1') await peopleChecks(page);
    if (sc.id === 'S1') await dryChecks(page);
    if (sc.id === 'S5') await snowChecks(page);
    if (['S1', 'S6', 'S7'].includes(sc.id)) await lightChecks(page, sc.id);
  }
  await ctx.close();
}
await autumnChecks();
console.log('\nscene                          zoom   median ms   p95 ms');
for (const r of rows) console.log(`${(r.id + ' ' + r.name).padEnd(30)} ${String(r.z).padEnd(5)} ${r.med.toFixed(2).padStart(9)} ${r.p95.toFixed(2).padStart(8)}`);
console.log('mean luminance at zoom 1: ' + Object.entries(lums).map(([k, v]) => k + ' ' + v.toFixed(2)).join('  '));
console.log(`pictures: ${OUT}\n`);
check(`timing: every scene's draw() median is at or under ${BUDGET_MEDIAN} ms and p95 at or under ${BUDGET_P95} ms`,
  rows.every(r => r.med <= BUDGET_MEDIAN && r.p95 <= BUDGET_P95),
  rows.filter(r => r.med > BUDGET_MEDIAN || r.p95 > BUDGET_P95).map(r => `${r.id} z${r.z} ${r.med.toFixed(1)}/${r.p95.toFixed(1)}`).join(', '));
check('no warnings from the page', warns.length === 0, warns.slice(0, 3).join(' | '));

await browser.close();
srv.close();
console.log(failed ? `FAIL: ${failed} look checks` : 'PASS: look');
process.exit(failed ? 1 : 0);
