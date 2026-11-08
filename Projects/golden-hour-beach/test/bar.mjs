// node test/bar.mjs
//
// The sandbar and runnel (#953, kept by Devon) in a real page. test/smoke.mjs
// pins the shape on the arithmetic in field.js; nothing walked it in a browser.
// This boots index.html with ?debug, moves the walker onto the bar with
// __gh.teleport and the sea with __gh.setTideT at low, rising, mid and high
// water, and reads positions and depths back. The depths come from field.js
// imported into the same page, and the tide from __gh.tide(), so none of them
// is a number the page under test handed back about itself. No frame rates:
// SwiftShader timing says nothing (#53), and every beat is read after a hand
// scrub, which is the kind of assertion #53 does not reach.
// Exits non-zero on any failure (#13).

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { serve, launch, prepPage } =
  await import(pathToFileURL(path.join(HERE, '..', '..', '..', 'Tools', 'board-check', 'harness.mjs')).href);

const PORT = 8179;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
const ok = (cond, what, detail = '') => {
  if (cond) { passed++; console.log(`  ok    ${what}${detail ? '  ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? '  ' + detail : ''}`); }
  return cond;
};
const group = name => console.log(`\n${name}`);

const server = await serve(PORT);
const browser = await launch();
try {
  const page = await prepPage(browser, BASE, { width: 640, height: 400, dsf: 1 });
  await page.goto(`${BASE}/Projects/golden-hour-beach/?debug`, { waitUntil: 'load' });
  await page.waitForSelector('#scene');
  await page.click('#overlay');
  await page.waitForSelector('#overlay.hidden', { state: 'attached' });
  const frames = n => page.evaluate(n => new Promise(r => {
    let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
  }), n);
  await frames(3);

  group('the bar and the runnel in the page (#953)');
  ok(await page.evaluate(() => typeof window.__gh?.teleport === 'function' && typeof window.__gh?.setTideT === 'function'),
    'with ?debug the page has teleport and setTideT');

  // One round trip per tide: scrub the sea, put the walker on the beach and then
  // on the crest, let a few frames run so the controls have had their say, and
  // read everything back. field.js is the page's own module, the second copy
  // only of the ground, never of the rule under test.
  const TIDE_T = { low: 600, rising: 1200, mid: 1500, high: 1800 };
  const read = (name, t) => page.evaluate(async ([name, t]) => {
    const F = await import(new URL('js/field.js', location.href).href);
    const gh = window.__gh;
    gh.setTideT(t);
    gh.teleport(370, 3);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const beach = gh.pos();
    const crestZ = F.shorelineZ(F.BAR.x) + F.BAR.s;
    gh.teleport(F.BAR.x, crestZ);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const crest = gh.pos();
    const tide = gh.tide();
    const level = tide.y;                       // sea level the page is drawing, wave off
    const top = F.seaLevel(1, t);               // the top of the highest wave at this tide
    const bottom = F.seaLevel(0, t);
    // The ford: deepest step from the beach to the crest down the middle columns.
    const fordW = F.BAR.half * F.BAR.fordHalf;
    let deepest = 0;
    for (let x = F.BAR.x - fordW; x <= F.BAR.x + fordW; x += 0.5) {
      for (let s = 0; s >= F.BAR.s; s -= 0.25) {
        deepest = Math.max(deepest, F.seaLevel(1, t) - F.sandHeight(x, F.shorelineZ(x) + s));
      }
    }
    // The beach's own water's edge at x 370, off the ground.
    const edgeZ = F.waterLineZ(F.BAR.x, level);
    return {
      name, t, beach, crest, crestZ, level, top, bottom, tideT: tide.t,
      crestGround: F.groundHeight(crest.x, crest.z), deepest,
      edgeMiss: Math.abs(F.groundHeight(F.BAR.x - 60, F.waterLineZ(F.BAR.x - 60, level)) - level),
      edgeZ,
    };
  }, [name, t]);

  const R = {};
  for (const [name, t] of Object.entries(TIDE_T)) R[name] = await read(name, t);

  for (const r of Object.values(R)) {
    // The tide clock keeps running in real time after the scrub (0.4 s here), so it is read to the second.
    ok(r.tideT >= r.t && r.tideT < r.t + 5, `${r.name} water: setTideT(${r.t}) is the page's tide`, `t ${r.tideT.toFixed(1)}, sea ${r.level.toFixed(3)}`);
    ok(Math.abs(r.beach.x - 370) < 1e-6 && Math.abs(r.beach.z - 3) < 1e-6, `${r.name} water: teleport(370, 3) leaves the walker on the beach`,
      `at ${r.beach.x.toFixed(2)}, ${r.beach.z.toFixed(2)}`);
  }

  // Low water: they can stand on the bar, and the crest is above the top of the highest wave.
  const lo = R.low;
  ok(Math.abs(lo.crest.x - 370) < 1e-6 && Math.abs(lo.crest.z - lo.crestZ) < 1e-6,
    'low water: the walker teleported onto the crest is still on it after the controls have run',
    `at ${lo.crest.x.toFixed(2)}, ${lo.crest.z.toFixed(2)}, crest z ${lo.crestZ.toFixed(2)}`);
  ok(lo.crestGround > lo.top,
    'low water: the ground under them is above the top of the highest wave',
    `${lo.crestGround.toFixed(3)} against ${lo.top.toFixed(3)}`);

  // Rising and mid water: the walker is where they were put; the sea is rising.
  ok(R.low.level < R.rising.level && R.rising.level < R.high.level && R.low.level < R.mid.level && R.mid.level <= R.high.level,
    'the sea is higher at rising, mid and high water than at low', Object.values(R).map(r => r.level.toFixed(2)).join(' < '));
  // High water: the bar is under the lowest wave, so standing there is a wade.
  ok(R.high.crestGround < R.high.bottom,
    'high water: the bar is under even the lowest wave', `${R.high.crestGround.toFixed(3)} against ${R.high.bottom.toFixed(3)}`);

  // The ford, as smoke.mjs pins it: under the knee at the top of the highest wave of high water.
  ok(R.high.deepest < 0.45 && R.high.deepest > 0.3 && Math.abs(R.high.deepest - 0.43) < 0.01,
    'the ford is 0.43 m at the deepest at the top of the highest wave of high water',
    `${R.high.deepest.toFixed(3)} m`);
  ok(Object.values(R).every(r => r.deepest < 0.45), 'and under the knee (0.45 m) at every tide the page was put through',
    Object.values(R).map(r => r.deepest.toFixed(3)).join(', '));

  // The water's edge on the plain beach beside the bar, at low and high tide: exact at low (the
  // ground there is a clean wedge), inside the beach's own undulation at high (smoke.mjs 0.10 m).
  ok(R.low.edgeMiss < 1e-9, "low water: the water's edge is where the water meets the ground", `${R.low.edgeMiss.toExponential(1)} m`);
  ok(R.high.edgeMiss < 0.10, "high water: the water's edge lands inside the beach's undulation", `${R.high.edgeMiss.toFixed(3)} m`);
} finally {
  await browser.close();
  server.close?.();
}

console.log(`\n${passed + failed} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
