// tools/touch-readout.mjs — Phase 6, increment 2. The one check that can
// prove the thing this increment is for.
//
// A `title` has never shown on a touch screen, so the refusal a blocked
// cell has carried since Stage 11 was invisible to anybody holding a
// phone. The readout under the sheet fixes that, and jsdom cannot say so:
// it has no layout, no clipping stage, no coarse pointer, and its
// `pointerover` is whatever the suite dispatches. This boots the real page
// in real Chromium with a real touchscreen, taps a blocked cell and a
// ghost with `page.touchscreen.tap`, and reads the live region back.
//
// Exits non-zero on any failure (#13). Run it from this folder:
//   node tools/touch-readout.mjs
//   CHROME=/path/to/chrome node tools/touch-readout.mjs
//
// Blink takes the pointer media query as a launch setting — Playwright's
// hasTouch gives a page touch events but leaves `(pointer: coarse)`
// answering false, which no real phone does — so the flag list below is
// the same one shoot-states.mjs uses for its touch viewports.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The site root, four levels up from tools/ — the server has to serve it
// whole, because index.html reaches assets/js/gvb-save.js outside this
// project (the same reason shoot-states.mjs serves the root).
const SITE = path.resolve(HERE, '../../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/Projects/Ren-Faire-Claude/index.html`;

const ARGS = ['--no-sandbox', '--font-render-hinting=none', '--hide-scrollbars', '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=1,availableHoverTypes=1'];
const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

for (const vp of [{ name: 'phone 375x812', w: 375, h: 812 }, { name: 'tablet 820x1180', w: 820, h: 1180 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  console.log(`\n${vp.name}`);

  ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the browser really is a coarse pointer');
  const readout = () => page.evaluate(() => document.querySelector('.plat-readout').textContent);
  const idle = await readout();
  ok(idle.length > 20, `the readout is on the page at rest ("${idle.slice(0, 48)}...")`);

  await page.click('[data-action="selectBuild"][data-kind="stage"]');
  // Two ways this check lied before it told the truth. The stage clips: on
  // a 375px phone the map rests at scale 1 panned to the west edge, so most
  // markers sit outside the stage's rectangle and a tap at their
  // coordinates lands on whatever is painted there instead. And clicking
  // the palette scrolls the page down to it, which put the whole stage
  // 297px above the viewport — `elementFromPoint` answered null for every
  // marker and three assertions failed for the check's reasons, not the
  // page's. So: scroll the stage back into view, then take the first marker
  // that is inside both the stage and the screen, and confirm with
  // elementFromPoint that a tap there actually reaches it.
  await page.evaluate(() => document.querySelector('.plat-stage').scrollIntoView({ block: 'center' }));
  const visible = async (sel) => page.evaluate((s) => {
    const st = document.querySelector('.plat-stage').getBoundingClientRect();
    for (const el of document.querySelectorAll(s)) {
      const b = el.getBoundingClientRect();
      const inStage = b.left >= st.left && b.right <= st.right && b.top >= st.top && b.bottom <= st.bottom;
      const onScreen = b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth;
      if (!inStage || !onScreen || b.width === 0) continue;
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      if (document.elementFromPoint(x, y) !== el) continue;
      return { x, y, title: el.getAttribute('title') };
    }
    return null;
  }, sel);

  // A blocked cell. Tap it with a real touchscreen tap, not a mouse click.
  const blocked = await visible('.plot-marker.blocked');
  ok(!!blocked, 'a blocked cell is inside the stage to tap');
  await page.touchscreen.tap(blocked.x, blocked.y);
  const afterTap = await readout();
  ok(afterTap === blocked.title, `a real touchscreen tap on a blocked cell reads out its refusal ("${afterTap}")`);
  ok(!(await page.evaluate(() => !!document.querySelector('.plot-marker.planning'))), 'and the tap on a blocked cell built nothing');

  // A ghost. Same tap: the preview lands, then the plot is planned and the
  // numbers stay put through the render.
  const g = await visible('.plot-marker.ghost');
  ok(!!g, 'a ghost is inside the stage to tap');
  await page.touchscreen.tap(g.x, g.y);
  const afterPlace = await readout();
  ok(/Planned, nothing spent yet\./.test(afterPlace) && /×/.test(afterPlace) && /\$/.test(afterPlace),
    `a tap on a ghost plans it and leaves the numbers on screen ("${afterPlace.slice(0, 110)}")`);
  ok(await page.evaluate(() => !!document.querySelector('.plot-marker.planning')), 'and the plot is planned, not built');

  // Geometry: the readout is under the sheet, at least 44px of it, on screen.
  const m = await page.evaluate(() => {
    const r = document.querySelector('.plat-readout').getBoundingClientRect();
    const s = document.querySelector('.plat-sheet').getBoundingClientRect();
    return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), sheetBottom: Math.round(s.bottom), page: document.documentElement.scrollWidth, view: window.innerWidth };
  });
  ok(m.top >= m.sheetBottom, `the readout sits below the sheet (top ${m.top}, sheet bottom ${m.sheetBottom})`);
  const twoLines = await page.evaluate(() => {
    const el = document.querySelector('.plat-readout');
    const cs = getComputedStyle(el);
    return Math.round(2 * parseFloat(cs.lineHeight) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  });
  ok(m.h >= twoLines, `it never collapses under two lines of its own type (${m.h}px against ${twoLines}px, ${m.w}px wide)`);
  ok(m.page <= m.view, `the page still does not scroll sideways (${m.page} <= ${m.view})`);
  ok(errs.length === 0, `no page or console errors${errs.length ? ': ' + errs[0] : ''}`);
  await ctx.close();
}
await browser.close();
server.close();
console.log(`\n${pass} checks, ${fail} failed`);
process.exit(fail ? 1 : 0);
