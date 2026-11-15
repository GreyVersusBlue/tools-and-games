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
    if (['S1', 'S6', 'S7'].includes(sc.id)) await lightChecks(page, sc.id);
  }
  await ctx.close();
}
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
