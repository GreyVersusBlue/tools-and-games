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

const rows = [], lums = {};
// the stock checks set wood, food and granary and the clock by hand, so they get an island of their own: run on the scenes' island they left S7's lit windows with no pairs to measure
{
  const { ctx, page } = await open(7);
  await stockChecks(page);
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
