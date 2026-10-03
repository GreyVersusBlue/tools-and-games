// capture-hearth.mjs — the one preview frame Hearth needs, without a games.mjs entry.
//
//   npm run hearth        writes candidates/hearth-00-village.png
//
// Hearth is a 2D canvas, so this runs headless and needs no GPU (TG-20). It is not
// a RECIPES entry in capture-previews.mjs because #84 kept Hearth out of games.mjs:
// the board's suite is headed and would be a shallower copy of the harness's `save`
// mode. This file is only the picture. It drives the game through window.__hearth
// the way Projects/hearth/test/harness.mjs does: pause the loop, seed an island, step
// it by hand, so the same seed gives the same frame.
//
// The frame: island 7 at day 30, clear weather, late morning, zoomed on the
// village. It asserts the sheet loaded, the island is populated and built, and no
// page error fired, and exits non-zero otherwise. Then LOOK at the PNG and
// `npm run promote hearth` (it is in candidates/chosen.json).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'candidates');
const PORT = 8127;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = 7, DAYS = 30, ZOOM = 2.2, ANCHOR = [62, 42];

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(PORT);
const browser = await launch();
const page = await prepPage(browser, BASE, { width: 990, height: 600, dsf: 1 });
page.setDefaultTimeout(45000);

let failed = null;
try {
  await page.goto(`${BASE}/Projects/hearth/`);
  await page.waitForFunction(() => !!window.__hearth);
  await page.waitForFunction(() => window.__hearth.sheet.ready || !!window.__hearth.sheet.fail);
  await page.evaluate(() => { const b = document.getElementById('b-pause'); if (b.textContent !== '▶') b.click(); });
  const info = await page.evaluate(([seed, days, zoom, ax, ay]) => {
    const H = window.__hearth;
    H.newWorld(seed);
    for (let n = 0; H.dayCount < days && n < 2e5; n++) H.step(0.05);
    H.setWx('clear');
    for (let i = 0; i < 1100; i++) H.step(0.05);   // from the start of the day to late morning
    H.setWx('clear');
    H.setZoom(zoom, ax, ay);
    for (let i = 0; i < 20; i++) H.step(0.05);
    document.getElementById('hint').style.display = 'none';   // the controls line crosses the bottom of a 330 px thumbnail
    H.draw();
    return { day: H.dayCount, pop: H.people.length, houses: H.houses.length,
             bldg: H.bldg.map(b => b.kind), sheet: H.sheet.fail || 'ok', wx: H.wx };
  }, [SEED, DAYS, ZOOM, ...ANCHOR]);
  console.log(JSON.stringify(info));
  if (info.sheet !== 'ok') throw new Error(`building sheet: ${info.sheet}`);
  if (info.pop < 5 || info.houses < 3 || !info.bldg.length) throw new Error('island is not populated and built');
  if (page.__errs.length) throw new Error(`page errors: ${page.__errs.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: path.join(OUT, 'hearth-00-village.png') });
} catch (e) { failed = e; }
await browser.close();
server.close();
if (failed) { console.error('FAIL ' + (failed.message || failed)); process.exit(1); }
console.log('wrote candidates/hearth-00-village.png: LOOK at it, then `npm run promote hearth`');
