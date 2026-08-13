// Blue Hour — the browser half of the test suite.
//
// smoke.mjs checks the mountain as arithmetic under bare Node. This one checks
// the mountain as a thing that renders: it boots the real page in real Chromium
// through ?debug, and asserts draw budget, the fog cycle, the climb, the cairn
// counter, every dread beat, and a genuine W-hold up the trail.
//
//   node test/browser.mjs
//
// Needs playwright-core and a Chromium on disk — neither is a dependency of the
// piece itself, which has none. Point CHROME at a binary if the default (the
// Playwright cache) isn't where yours lives:
//
//   npm i playwright-core
//   CHROME=/path/to/chrome node test/browser.mjs
//
// Under software GL (swiftshader) this runs at a couple of frames a second, and
// main.js clamps dt to 0.1 s, so the world genuinely runs in slow motion. Every
// absolute timing number below is therefore scaled by the measured frame rate
// rather than hard-coded — see the walk group. Draw calls, triangle counts,
// page errors and state assertions are all honest regardless.
//
// Serves the site root itself so the import map and libs/ resolve exactly as
// they do in play.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..', '..', '..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = path.join(process.env.SHOTS || path.join(HERE, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;
const URL = `http://127.0.0.1:${PORT}/Projects/blue-hour-trail/?debug`;

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};
const group = t => console.log(`\n${t}`);
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
         '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1320, height: 800 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Seed a previous walk before the page ever runs, so the ghost group below can
// prove the phantom steps replayed THAT rhythm and not an invented one.
//
// Session 6 made it a WHOLE visit — up the mountain and back down again, which
// is what a real previous walker leaves behind and what no record could
// actually hold until this session (the old cap ended it partway up the
// climb). The two halves are given deliberately different gaits, 0.62 s
// climbing and 0.41 s descending, so the rhythm that comes back proves not
// just that the record was borrowed but WHICH HALF of it — and the beat these
// gaps feed is descending.
await page.addInitScript(() => {
  localStorage.setItem('blue-hour-last-walk', JSON.stringify({
    v: 1,
    steps: [
      ...Array.from({ length: 120 }, (_, i) => [i / 120, 0.62]),
      ...Array.from({ length: 120 }, (_, i) => [(120 - i) / 120, 0.41]),
    ],
  }));
});

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('#scene');
await page.waitForFunction(() => !!window.__bh, null, { timeout: 30000 });

// Golden Hour's lesson: click the overlay, not the canvas — while #overlay is
// up it covers #scene, so a canvas click never lands.
await page.click('#overlay');
await page.waitForSelector('#overlay.hidden');
await wait(1500);

group('the piece boots');
ok('no page errors on the way in', errors.length === 0, errors.slice(0, 3).join(' | '));
ok('the debug hook is up', await page.evaluate(() => typeof window.__bh.info === 'function'));
ok('the walker starts at the trailhead',
  await page.evaluate(() => Math.hypot(__bh.pos().x - 0, __bh.pos().z - 147) < 4),
  JSON.stringify(await page.evaluate(() => __bh.pos())));
ok('standing on the trail', (await page.evaluate(() => __bh.surface())) === 'trail');

group('the draw budget');
// Golden Hour's stated budget was 300 calls at its widest view. Blue Hour is
// denser (3,834 trees) but fogged to ~120 m, which is the whole bet: the fog
// is not just mood, it is the culling strategy. Measure it in both phases.
const thickInfo = await page.evaluate(async () => {
  __bh.setWeatherT(0);
  // walk the phase to its thickest by search rather than trusting a constant
  let best = { t: 0, f: __bh.fogT() };
  for (let t = 0; t < 700; t += 5) { __bh.setWeatherT(t); const f = __bh.fogT(); if (f > best.f) best = { t, f }; }
  __bh.setWeatherT(best.t);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { ...__bh.info(), fogT: __bh.fogT(), at: best.t };
});
ok('thick fog: draw calls under budget', thickInfo.calls < 300, `${thickInfo.calls} calls, ${(thickInfo.triangles / 1000).toFixed(0)}k tris at fogT ${thickInfo.fogT.toFixed(2)}`);

const clearInfo = await page.evaluate(async () => {
  let best = { t: 0, f: 1 };
  for (let t = 0; t < 700; t += 5) { __bh.setWeatherT(t); const f = __bh.fogT(); if (f < best.f) best = { t, f }; }
  __bh.setWeatherT(best.t);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { ...__bh.info(), fogT: __bh.fogT(), at: best.t };
});
ok('clear phase: draw calls under budget', clearInfo.calls < 300, `${clearInfo.calls} calls, ${(clearInfo.triangles / 1000).toFixed(0)}k tris at fogT ${clearInfo.fogT.toFixed(2)}`);
// The fog does NOT cull: the forest is instanced, so the same geometry is
// submitted in thick and clear alike. That is the design working as built —
// draw cost is flat regardless of weather — and it is worth pinning down,
// because it means the fog is mood and depth precision, not a perf strategy.
//
// The two phases can't be measured in the same frame, and the wildlife is
// alive between them — a deer herd or a bird crossing the frustum between
// the thick sample and the clear one moves the count and has nothing to do
// with fog (session 5 watched it happen: 24 vs 45 calls, all animals). So
// the pair retries until it lands in a quiet window; fog-dependent
// submission would differ on EVERY attempt and still fail.
let flat = null;
for (let attempt = 0; attempt < 4 && !flat; attempt++) {
  const pair = await page.evaluate(async ({ thickAt, clearAt }) => {
    const read = async t => {
      __bh.setWeatherT(t);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return __bh.info().calls;
    };
    return { thick: await read(thickAt), clear: await read(clearAt) };
  }, { thickAt: thickInfo.at, clearAt: clearInfo.at });
  if (pair.thick === pair.clear) flat = pair;
  else await wait(700);
}
ok('the weather does not change the draw cost', !!flat,
  flat ? `${flat.clear} calls in both, ${(clearInfo.triangles / 1000).toFixed(0)}k tris flat`
       : 'no equal pair in 4 attempts');

group('the fog breathes');
const swing = await page.evaluate(() => {
  let lo = 1, hi = 0;
  for (let t = 0; t < 1400; t += 2) { __bh.setWeatherT(t); const f = __bh.fogT(); lo = Math.min(lo, f); hi = Math.max(hi, f); }
  return { lo, hi };
});
ok('the cycle reaches both ends', swing.lo < 0.15 && swing.hi > 0.85,
  `${swing.lo.toFixed(2)} to ${swing.hi.toFixed(2)}`);

group('the climb');
// Teleport up the trail and confirm the piece breaks out of the fog. This is
// the payoff the README promises and nothing has ever checked it in a browser.
const summit = await page.evaluate(async () => {
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { pos: __bh.pos(), altT: __bh.altT(), info: __bh.info() };
});
ok('the bench stands above the fog line', summit.pos.y > 60, `y ${summit.pos.y.toFixed(1)}`);
ok('and the altitude blend is fully out of it', summit.altT > 0.99, `altT ${summit.altT.toFixed(2)}`);
ok('the summit view is cheap', summit.info.calls < 300, `${summit.info.calls} calls`);
await page.screenshot({ path: path.join(SHOTS, 'summit.png') });

group('the summit ends in the fog');
// This group replaces an OPEN FINDING block that measured two defects without
// asserting them. Both are fixed, so both are assertions now.
//
// 1. The weather no longer clears at the top. It used to drop the fog to 0.006
//    and hand the walker a bright empty view over a cloud sea that was itself
//    buried inside the hillside. The summit is now the thickest air on the
//    mountain, which is the promise this piece actually makes.
const summitWeather = await page.evaluate(() => ({ altT: __bh.altT(), density: __bh.density() }));
ok('the fog closes at the top rather than parting', summitWeather.density > 0.04,
  `density ${summitWeather.density.toFixed(3)} at altT ${summitWeather.altT.toFixed(2)}`);

// 2. The near-black frame is gone. The old summit measured 6-14/255 across four
//    facings; the trail below, which is deliberately dim, reads about 22.
//    Read in-page from the drawing buffer so the suite needs no PNG decoder.
const lum = await page.evaluate(() => new Promise(res => {
  const src = document.getElementById('scene');
  // The renderer runs without preserveDrawingBuffer, so sample inside a rAF —
  // after the frame is drawn, before it is cleared.
  requestAnimationFrame(() => {
    const gl = src.getContext('webgl2') || src.getContext('webgl');
    const w = src.width, h = Math.floor(src.height / 2);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);   // y=0 is the BOTTOM half
    let s = 0;
    for (let i = 0; i < buf.length; i += 4) {
      s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }
    res(s / (buf.length / 4));
  });
}));
ok('the ground at the summit is legible, not black', lum > 18,
  `lower-half luminance ${lum.toFixed(1)}/255 (was 6-14)`);

group('somebody is in the lookout');
const figure = await page.evaluate(async () => {
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  await new Promise(r => setTimeout(r, 400));
  const info = __bh.dread.lookoutInfo();
  const p = __bh.pos();
  return { info, d: Math.hypot(info.x - p.x, info.z - p.z), eye: p.y };
});
ok('the figure stands on the platform, not on the ground', figure.info.y - figure.eye > 6,
  `${(figure.info.y - figure.eye).toFixed(1)} m above the walker`);
ok('and it is visible from the bench', figure.info.visible, `${figure.d.toFixed(1)} m away`);
ok('half-there at most — never resolved', figure.info.opacity <= 0.5 + 1e-6,
  `opacity ${figure.info.opacity.toFixed(2)}`);

// The whole point of it: looking away does not clear it. The shape in the trees
// is gone when you look back. This is not.
const persists = await page.evaluate(async () => {
  __bh.face(__bh.yawAlongTrail(0) + Math.PI, 0);       // look away
  await new Promise(r => setTimeout(r, 500));
  const away = __bh.dread.lookoutInfo().visible;
  __bh.face(__bh.yawAlongTrail(0), 0);                  // and back
  await new Promise(r => setTimeout(r, 500));
  return { away, back: __bh.dread.lookoutInfo().visible };
});
ok('it does not vanish when you look away and back', persists.away && persists.back);

// ...but walking up to it takes it out of view rather than resolving it.
const upClose = await page.evaluate(async () => {
  const i = __bh.dread.lookoutInfo();
  __bh.teleport(i.x, i.z);                              // directly under the tower
  await new Promise(r => setTimeout(r, 400));
  return __bh.dread.lookoutInfo();
});
ok('at the foot of the tower it is no longer at the rail', !upClose.visible);
await page.screenshot({ path: path.join(SHOTS, 'lookout.png') });

group('the cairns');
const cairn = await page.evaluate(async () => {
  const L = __bh.layout();
  const c = L.cairns[0];
  __bh.teleport(c.x, c.z);
  await new Promise(r => setTimeout(r, 300));
  return __bh.cairns();
});
ok('standing on a cairn counts it', cairn.found.length === 1, `found ${cairn.found.length} of ${cairn.total}`);
// Grant 2: the chip reads the keeper's name off the cairn — the seven-for-
// eight gap made countable without a word of explanation.
const chipText = await page.evaluate(() => document.getElementById('cairn-chip').textContent);
const firstKeeper = await page.evaluate(() => __bh.layout().cairns[0].keeper);
ok('and the chip names its keeper', chipText.includes(firstKeeper), JSON.stringify(chipText));

const allCairns = await page.evaluate(async () => {
  const L = __bh.layout();
  for (const c of L.cairns) {
    __bh.teleport(c.x, c.z);
    await new Promise(r => setTimeout(r, 120));
  }
  await new Promise(r => setTimeout(r, 200));
  return { c: __bh.cairns(), chip: document.getElementById('cairn-chip').textContent };
});
ok('all seven are reachable and counted', allCairns.c.found.length === allCairns.c.total,
  `${allCairns.c.found.length} of ${allCairns.c.total}`);
ok('and the last one says so', /all seven/.test(allCairns.chip), JSON.stringify(allCairns.chip));

group('the logbook opens under a held key');
// Grant 1: the piece's one verb. Stand over a page, hold E, read; let go and
// it's back on the ground. No state survives the release — that's the grant's
// whole shape and this group holds every edge of it.
const nearPage = await page.evaluate(async () => {
  const pg = __bh.layout().pages[0];
  __bh.teleport(pg.x, pg.z);
  await new Promise(r => setTimeout(r, 300));
  return { lb: __bh.logbook(), chip: document.getElementById('page-chip').className };
});
ok('standing over a page is noticed', nearPage.lb.near === 0, JSON.stringify(nearPage.lb));
ok('and the chip offers the verb', /show/.test(nearPage.chip));

await page.keyboard.down('KeyE');
await wait(400);
const opened = await page.evaluate(() => ({
  lb: __bh.logbook(),
  shown: document.getElementById('page-overlay').classList.contains('show'),
  text: document.getElementById('page-overlay-body').textContent,
}));
ok('holding E brings the page up', opened.shown && opened.lb.open === 0);
ok('with the keeper\'s entries on it', /Hollis/.test(opened.text) && /winch rope/.test(opened.text));
await page.screenshot({ path: path.join(SHOTS, 'logbook.png') });

await page.keyboard.up('KeyE');
await wait(400);
const closed = await page.evaluate(() => ({
  lb: __bh.logbook(),
  shown: document.getElementById('page-overlay').classList.contains('show'),
}));
ok('letting go puts it back down', !closed.shown && closed.lb.open === -1);

const awayFromPage = await page.evaluate(async () => {
  __bh.teleport(0, 145);
  await new Promise(r => setTimeout(r, 300));
  return { lb: __bh.logbook(), chip: document.getElementById('page-chip').className };
});
ok('walking off forgets the page entirely', awayFromPage.lb.near === -1 && !/show/.test(awayFromPage.chip));
ok('every page is placed and named', await page.evaluate(() =>
  __bh.layout().pages.length === 10 && __bh.layout().pages.every(p => p.keeper && p.entries.length)));

group('the woods are not honest');
// Every dread beat, forced, with no page error and the visible ones actually
// placed on the ground in front of the camera.
for (const beat of ['snap', 'phantom', 'silence', 'howl']) {
  const before = errors.length;
  await page.evaluate(b => __bh.fireDread(b), beat);
  await wait(120);
  ok(`the ${beat} beat fires clean`, errors.length === before, errors.slice(before).join(' | '));
}
const bear = await page.evaluate(async () => {
  __bh.teleport(0, 120);
  await new Promise(r => setTimeout(r, 200));
  __bh.fireDread('bear');
  const p = __bh.pos();
  const s = __bh.dread;
  return { active: s._bearActive, life: s._bearLife, p };
});
ok('the shape is staged and on a clock', bear.active && bear.life > 0, `life ${bear.life}s`);

const silence = await page.evaluate(() => { __bh.fireDread('silence'); return __bh.dread.birdsSilent; });
ok('the birds go quiet on cue', silence === true);

group('everything here is trying to leave');
// Ladder 1: the shape's head points downhill however it is staged, and the
// phantom steps go out through the real just-stopped path with a downhill pan
// and a falling plan.
const bearHead = await page.evaluate(async () => {
  const dots = [];
  for (const [x, z] of [[0, 120], [60, 60], [-60, 20]]) {
    __bh.teleport(x, z);
    await new Promise(r => setTimeout(r, 150));
    __bh.fireDread('bear');
    dots.push(__bh.dread.bearInfo().headDownhillDot);
  }
  return dots;
});
ok('the shape faces down the mountain wherever it stands',
  bearHead.every(d => d > 0.05), bearHead.map(d => d.toFixed(2)).join(', '));

await page.evaluate(() => { __bh.teleport(0, 130); __bh.fireDread('phantom'); });
await page.keyboard.down('KeyW');
await wait(800);
await page.evaluate(() => { __bh.dread._movingFor = 4; });   // skip the slow-motion wait
await page.keyboard.up('KeyW');
await wait(700);
const phantom = await page.evaluate(() => __bh.lastPhantom());
ok('stopping fires the armed phantom steps', !!phantom && phantom.plan.length >= 2,
  phantom ? `${phantom.plan.length} steps` : 'never fired');
ok('their pitch falls step over step',
  phantom && phantom.plan.every((s, i) => i === 0 || s.rate < phantom.plan[i - 1].rate));
ok('and they are panned, not centred', phantom && typeof phantom.pan === 'number',
  phantom ? `pan ${phantom.pan.toFixed(2)}` : '');

group('the mountain remembers your last walk');
// Grant 3: the record seeded before page load is the "previous visit"; the
// phantom steps that just fired must have walked in its rhythm. See ghost.js
// and the prompt-file amendment — this is not a save, and no UI may ever
// surface any of it.
const ghostState = await page.evaluate(() => __bh.ghost());
ok('the previous walk is waiting when the page opens', ghostState.loaded && ghostState.count === 240,
  `${ghostState.count} remembered steps`);
const gaps = phantom && phantom.plan.slice(1).map((s, i) => s.at - phantom.plan[i].at);
ok('the steps that are not yours are your own, from last time',
  phantom && phantom.intervals && gaps.every(g => Math.abs(g - 0.41) < 1e-6),
  gaps ? gaps.map(g => g.toFixed(2)).join(', ') : 'no phantom fired');
// ...and from the half of that walk that was going the same way these steps
// are. The seeded record crosses every stretch of trail twice; asked at three
// altitudes, the answer is the descent's 0.41 s and never the climb's 0.62.
const whoseGait = await page.evaluate(() => [0.15, 0.5, 0.9].map(t => __bh.dread.ghostRhythm(t)));
ok('and they are the steps they took coming DOWN, at every altitude',
  whoseGait.every(r => r && r.length && r.every(g => Math.abs(g - 0.41) < 1e-6)),
  whoseGait.map(r => (r ? r[0].toFixed(2) : 'null')).join(', '));

await page.keyboard.down('KeyW');
await wait(7000);          // world time runs ~10x slow here; ~3 footsteps' worth
await page.keyboard.up('KeyW');
const recording = await page.evaluate(() => ({ g: __bh.ghost(), saved: __bh.ghostSave() }));
ok('and this walk is being recorded for the next one', recording.g.walked > 0,
  `${recording.g.walked} steps so far`);
ok('too short a walk refuses to become a ghost', recording.saved === false);

group('the director spends beats off-gaze');
// Ladder 2: a yaw-dwell histogram decides which side a visual beat lands on,
// and a stared-at treeline never fires. The suite paints stares straight into
// the histogram — real dwell accrues at a tenth speed under swiftshader, and
// the arithmetic being tested is the same either way. One real-accrual check
// keeps the painting honest.
const accrues = await page.evaluate(async () => {
  const d = __bh.dread;
  d._gaze.fill(0);
  __bh.face(1.0, 0);
  await new Promise(r => setTimeout(r, 2000));
  return d.dwellAt(1.0);
});
ok('watching a direction is remembered', accrues > 0, `${accrues.toFixed(2)} s dwell`);

const offGaze = await page.evaluate(async () => {
  const d = __bh.dread;
  const yaw = 1.0;
  __bh.teleport(0, 100);
  __bh.face(yaw, 0);
  await new Promise(r => setTimeout(r, 200));
  const results = [];
  for (let i = 0; i < 5; i++) {
    d._gaze.fill(0);
    // stare down the LEFT candidate arc (world yaw + 25°..80°)
    for (let a = yaw + 0.44; a < yaw + 1.4; a += 0.1) d._gaze[d.bucketOf(a)] = 10;
    const fired = __bh.fireDread('eyes');
    const e = d.eyesInfo();
    const p = __bh.pos();
    // the piece's yaw convention for the placement direction
    const eyeYaw = Math.atan2(-(e.x - p.x), -(e.z - p.z));
    let diff = eyeYaw - yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    results.push({ fired, diff });
  }
  return results;
});
ok('a beat lands on the unwatched side, every time',
  offGaze.every(r => r.fired && r.diff < 0),
  offGaze.map(r => (r.diff * 180 / Math.PI).toFixed(0) + '°').join(', '));

const stared = await page.evaluate(async () => {
  const d = __bh.dread;
  const yaw = 1.0;
  __bh.face(yaw, 0);
  d._gaze.fill(0);
  // stare down BOTH candidate arcs
  for (let a = yaw - 1.4; a < yaw + 1.4; a += 0.1) d._gaze[d.bucketOf(a)] = 10;
  const before = d._lastBeat;
  const fired = __bh.fireDread('eyes');
  return { fired, lastBeat: d._lastBeat, before };
});
ok('a stared-at treeline never fires', stared.fired === false);
ok('and a declined beat is not remembered as the last one', stared.lastBeat === stared.before);

group('the small wrongnesses');
// Ladder 3-5: the dead radio at the cabin, the bootprints under the fog, the
// steam at the cab glass. None of them is a beat you could prove happened.
const radio = await page.evaluate(async () => {
  const L = __bh.layout();
  __bh.teleport(L.cabin.x + 6, L.cabin.z + 6);
  await new Promise(r => setTimeout(r, 200));
  const fired = __bh.fireDread('radio');
  return { fired, last: __bh.lastRadio() };
});
ok('the dead radio finds a carrier', radio.fired === 'radio' && !!radio.last,
  radio.last ? `pan ${radio.last.pan.toFixed(2)}` : '');
ok('and nothing answers at the cabin', radio.last && radio.last.echoGain === 0);

const prints = await page.evaluate(async () => {
  // thickest fog the cycle reaches, then the clearest
  let thick = { t: 0, f: 0 }, clear = { t: 0, f: 1 };
  for (let t = 0; t < 700; t += 5) {
    __bh.setWeatherT(t); const f = __bh.fogT();
    if (f > thick.f) thick = { t, f };
    if (f < clear.f) clear = { t, f };
  }
  __bh.setWeatherT(thick.t);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const inFog = __bh.bootprints();
  __bh.setWeatherT(clear.t);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const inClear = __bh.bootprints();
  return { inFog, inClear };
});
ok('the bootprints surface in thick fog', prints.inFog.opacity > 0.3,
  `opacity ${prints.inFog.opacity.toFixed(2)}, ${prints.inFog.prints} prints`);
ok('and are gone in clear air — deniable, like everything here', prints.inClear.opacity < 0.05,
  `opacity ${prints.inClear.opacity.toFixed(2)}`);

const steamAt = await page.evaluate(async () => {
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  await new Promise(r => setTimeout(r, 200));
  const s = __bh.steam();
  return { d: Math.hypot(s.x - L.tower.x, s.z - L.tower.z), y: s.y, benchY: __bh.pos().y };
});
ok('the steam rises at the cab glass', steamAt.d > 1.0 && steamAt.d < 2.0,
  `${steamAt.d.toFixed(2)} m out from the tower axis`);
ok('at cab height, not on the ground', steamAt.y - steamAt.benchY > 6,
  `y ${steamAt.y.toFixed(1)}, walker eye ${steamAt.benchY.toFixed(1)}`);

// The check the whole billboard family actually needs: PIXELS. This session
// found the mist and the breath had never rendered a single frame — their
// billboard winding faces away from the camera and FrontSide culled them,
// with zero page errors and zero warnings. Geometry assertions can't see
// that; only the drawing buffer can. Stage every steam quad, stand at the
// bench facing the cab, and demand the wisp be measurably brighter than the
// dark cab face behind it.
const steamPixels = await page.evaluate(() => new Promise(res => {
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  __bh.face(Math.atan2(-(L.tower.x - L.bench.x), -(L.tower.z - L.bench.z)), 0.28);
  __bh.steamBurst();
  setTimeout(() => requestAnimationFrame(() => {
    const src = document.getElementById('scene');
    const gl = src.getContext('webgl2') || src.getContext('webgl');
    // A tight box on the cab face where the wisp rises. The bench view is
    // deterministic, so the framing is too.
    const x0 = Math.floor(src.width * 0.45), w = Math.floor(src.width * 0.10);
    const yTop = Math.floor(src.height * 0.14), h = Math.floor(src.height * 0.15);
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x0, src.height - (yTop + h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const lums = [];
    for (let i = 0; i < buf.length; i += 4) {
      lums.push(0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]);
    }
    lums.sort((a, b) => a - b);
    res({
      median: lums[lums.length >> 1],
      max: lums[lums.length - 1],
      alpha: __bh.steam().alpha0,
    });
  }), 1400);
}));
ok('and the steam is pixels, not just geometry', steamPixels.max > steamPixels.median + 18,
  `max ${steamPixels.max.toFixed(0)} vs median ${steamPixels.median.toFixed(0)}, quad alpha ${steamPixels.alpha.toFixed(2)}`);

group('no billboard in this piece goes dark silently');
// Session 4 found the mist and the breath had never rendered a single frame —
// the shared billboard winding faces away from the camera and FrontSide culled
// them with zero errors and zero warnings. The steam got a pixel check that
// session; these are the same check for the other two members of the family.
// Each stages its system deterministically (bank placement is random per load
// and drifts, so the suite MOVES a bank rather than hoping one is in frame),
// reads the drawing buffer with the mesh shown and hidden, and demands the
// difference. Any silent way the mesh can die — culling, winding, a zeroed
// alpha, a broken texture — shows up here as a zero.
const mistPixels = await page.evaluate(async () => {
  const boxRead = () => new Promise(res => {
    requestAnimationFrame(() => {
      const src = document.getElementById('scene');
      const gl = src.getContext('webgl2') || src.getContext('webgl');
      const x0 = Math.floor(src.width * 0.25), w = Math.floor(src.width * 0.5);
      const yTop = Math.floor(src.height * 0.2), h = Math.floor(src.height * 0.5);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, src.height - (yTop + h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let s = 0;
      for (let i = 0; i < buf.length; i += 4) s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      res(s / (buf.length / 4));
    });
  });
  let thick = { t: 0, f: 0 };
  for (let t = 0; t < 700; t += 2) { __bh.setWeatherT(t); if (__bh.fogT() > thick.f) thick = { t, f: __bh.fogT() }; }
  __bh.setWeatherT(thick.t);
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  const yaw = __bh.yawAlongTrail(9999);
  __bh.face(yaw, 0.05);
  await new Promise(r => requestAnimationFrame(r));
  const p = __bh.pos();
  __bh.mistReroot(0, p.x - Math.sin(yaw) * 15, p.y - 2.5, p.z - Math.cos(yaw) * 15, 26, 9);
  __bh.mistShow(true);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const on = await boxRead();
  __bh.mistShow(false);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const off = await boxRead();
  __bh.mistShow(true);
  return { on, off };
});
// Measured margin at authoring time: +8.2 to +8.8. Anything under a third of
// that means the bank is not reaching the screen.
ok('a staged mist bank is pixels, not just geometry', mistPixels.on - mistPixels.off > 2.5,
  `box ${mistPixels.on.toFixed(1)} with the bank, ${mistPixels.off.toFixed(1)} without`);

const breathPixels = await page.evaluate(async () => {
  const boxRead = () => new Promise(res => {
    requestAnimationFrame(() => {
      const src = document.getElementById('scene');
      const gl = src.getContext('webgl2') || src.getContext('webgl');
      const x0 = Math.floor(src.width * 0.3), w = Math.floor(src.width * 0.4);
      const yTop = Math.floor(src.height * 0.25), h = Math.floor(src.height * 0.5);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(x0, src.height - (yTop + h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let s = 0;
      for (let i = 0; i < buf.length; i += 4) s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      res(s / (buf.length / 4));
    });
  });
  const yaw = __bh.yawAlongTrail(9999);
  __bh.face(yaw + Math.PI, 0.35);
  // the camera picks the new facing up on the NEXT frame, and the burst reads
  // the camera — a burst in the same frame breathes out behind the view
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  __bh.breathBurst();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const on = await boxRead();
  __bh.breathShow(false);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const off = await boxRead();
  __bh.breathShow(true);
  return { on, off };
});
// Measured margin at authoring time: +7.3.
ok('a burst of breath is pixels, not just geometry', breathPixels.on - breathPixels.off > 2.5,
  `box ${breathPixels.on.toFixed(1)} breathing, ${breathPixels.off.toFixed(1)} holding it`);

group('above the fog line the beats change in kind');
// Ladder 7: the transmission exists ONLY at altitude — no low-altitude fog
// can reach its gate — and it answers itself: a carrier burst, then the same
// burst back fainter and delayed. Your own static, from nowhere.
const gates = await page.evaluate(async () => {
  __bh.teleport(0, 140);
  await new Promise(r => setTimeout(r, 200));
  const below = __bh.dreadCandidates(1.0);       // thickest possible fog, low down
  const L = __bh.layout();
  __bh.teleport(L.bench.x, L.bench.z);
  await new Promise(r => setTimeout(r, 200));
  const above = __bh.dreadCandidates(0.0);       // clearest fog, high up
  return { below, above };
});
ok('no amount of fog reaches the transmission from below', !gates.below.includes('transmission'),
  gates.below.join(', '));
ok('and above the fog line it is simply there', gates.above.includes('transmission'),
  gates.above.join(', '));

const transmission = await page.evaluate(() => {
  const fired = __bh.fireDread('transmission');
  return { fired, last: __bh.lastRadio() };
});
ok('the carrier opens at the summit', transmission.fired === 'transmission' && !!transmission.last);
ok('answered by nothing but your own delayed static', transmission.last.echoGain === 0.5,
  `echo ${transmission.last.echoGain}`);

group('the headlamp');
// Ladder 6: findable at the cabin, one toggle, and honest — the cone is a
// real light and the world outside it genuinely darkens while it burns.
const beforeFound = await page.evaluate(async () => {
  __bh.teleport(0, 140);           // nowhere near the cabin
  await new Promise(r => setTimeout(r, 200));
  return __bh.headlamp();
});
await page.keyboard.press('KeyF');
await wait(300);
const fNoLamp = await page.evaluate(() => __bh.headlamp());
ok('F does nothing before the lamp is found', !beforeFound.found && !fNoLamp.on);

const pickup = await page.evaluate(async () => {
  const h = __bh.layout().headlamp;
  __bh.teleport(h.x, h.z);
  await new Promise(r => setTimeout(r, 400));
  return { lamp: __bh.headlamp(), chip: document.getElementById('cairn-chip').textContent };
});
ok('walking to the cabin step finds it', pickup.lamp.found, JSON.stringify(pickup.chip));

const ambientOff = await page.evaluate(() => __bh.headlamp().ambient);
await page.keyboard.press('KeyF');
await wait(2800);       // the mix eases over ~5 world frames; give slow GL room
const lit = await page.evaluate(() => ({ lamp: __bh.headlamp(), music: __bh.music() }));
// The scale changed in session 5: decay 1 / intensity 4.5 replaced the old
// decay 2 / 34 after the seams pass caught the near ground blowing out white.
ok('one press and it burns', lit.lamp.on && lit.lamp.intensity > 2.7,
  `intensity ${lit.lamp.intensity.toFixed(1)}`);
ok('and the world outside the cone genuinely darkens', lit.lamp.ambient < ambientOff * 0.75,
  `ambient ${ambientOff.toFixed(2)} down to ${lit.lamp.ambient.toFixed(2)}`);
ok('the drone carries a barely-there partial while it burns', lit.music.voices.d5 > 0,
  `d5 ${lit.music.voices.d5}`);

// The dread director reads the lamp: eyes land just past the cone's edge.
const litEyes = await page.evaluate(async () => {
  const d = __bh.dread;
  d._gaze.fill(0);
  __bh.face(0.5, 0);
  await new Promise(r => setTimeout(r, 200));
  const angles = [];
  for (let i = 0; i < 5; i++) {
    d._gaze.fill(0);
    __bh.fireDread('eyes');
    const e = d.eyesInfo();
    const p = __bh.pos();
    let diff = Math.atan2(-(e.x - p.x), -(e.z - p.z)) - 0.5;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    angles.push(Math.abs(diff));
  }
  return angles;
});
ok('beats hug the darkness just past the cone while it burns',
  litEyes.every(a => a > 0.35 && a < 0.85),
  litEyes.map(a => (a * 180 / Math.PI).toFixed(0) + '°').join(', '));

await page.keyboard.press('KeyF');
await wait(800);
const dark = await page.evaluate(() => ({ lamp: __bh.headlamp(), music: __bh.music() }));
ok('a second press puts it out', !dark.lamp.on && dark.music.voices.d5 === 0);
await page.screenshot({ path: path.join(SHOTS, 'headlamp.png') });

group('the frame rate here');
// Every timing number below is hostage to this. Measure it rather than assume.
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  const f = () => { if (performance.now() - t0 < 3000) { n++; requestAnimationFrame(f); } else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(f);
}));
console.log(`  note  ${fps.toFixed(1)} fps under swiftshader at 1320x800 — software rasterization, not a GPU number`);
// main.js clamps dt to 0.1 s, so below 10 fps the world runs in slow motion.
// That is correct behaviour (it stops a stalled tab from teleporting the
// walker), but it means walk distances here are compressed by ~fps/10.
const slowFactor = Math.min(1, fps / 10);

group('the walk');
// A real W-hold up the trail. Face along the centerline — a guessed yaw walks
// into BOUNDS.maxZ 5 m from the trailhead and reads as a movement bug.
const walked = await page.evaluate(async () => {
  __bh.teleport(0, 145);
  __bh.face(__bh.yawAlongTrail(0), 0);
  await new Promise(r => setTimeout(r, 200));
  return __bh.pos();
});
await page.keyboard.down('KeyW');
await wait(6000);
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => __bh.pos());
const dist = Math.hypot(after.x - walked.x, after.z - walked.z);
// 2.0 m/s nominal, x0.45 worst-case uphill slowdown, x the sandbox's slow
// motion. Anything above half of that floor means walking genuinely works.
const floor = 6 * 2.0 * 0.45 * slowFactor * 0.5;
ok('holding W covers ground up the trail', dist > floor,
  `${dist.toFixed(1)} m in 6 s (floor ${floor.toFixed(1)} m at ${fps.toFixed(1)} fps)`);
ok('the walker gained elevation', after.y > walked.y, `y ${walked.y.toFixed(2)} to ${after.y.toFixed(2)}`);
ok('and stayed on the mountain',
  Number.isFinite(after.y) && after.y > -5 && after.y < 90, `y ${after.y.toFixed(1)}`);
ok('still on the trail, not lost in the woods',
  ['trail', 'bridge'].includes(await page.evaluate(() => __bh.surface())),
  await page.evaluate(() => __bh.surface()));

group('the whole run');
ok('no page errors, start to finish', errors.length === 0, errors.slice(0, 5).join(' | '));

await page.screenshot({ path: path.join(SHOTS, 'trail.png') });

console.log(`\n${pass + fail} checks, ${fail} failed`);
console.log(`shots in ${SHOTS}`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
