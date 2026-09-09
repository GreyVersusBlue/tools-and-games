// shoot-states.mjs — every phase, every desk tab, every breakpoint, as PNGs
// you can look at, plus the measurements a layout review is made of.
//
// Phase 5 of WISHLIST.md is the layout/density review that four rounds owed
// and none paid, because none had a browser. This is the browser. It plays
// a scripted season under plain Node (the same manager tests/smoke.mjs
// Section 1k uses), writes each state it wants into the page's own save
// slot, boots the real page in real Chromium at three viewports, clicks
// through the three desk tabs, and writes one full-page PNG per state per
// viewport. Beside the PNGs it prints the numbers the review is argued
// from: the two #board columns, the map against its column, the tallest
// plot card and how many stat tags it carries, the slider and the two
// <select>s, the HUD's height. Every number is getBoundingClientRect on
// the live page, not arithmetic on the stylesheet.
//
//   node tools/shoot-states.mjs                 -> shots/faire-weekend/<state>-<w>.png
//   node tools/shoot-states.mjs --label before  -> shots/faire-weekend/before/...
//   OUT=/somewhere node tools/shoot-states.mjs
//   CHROME=/path/to/chrome node tools/shoot-states.mjs
//
// Lives under tools/ rather than tests/ on purpose, the way The Fourth
// Quarter's tools/browser-check.mjs does: it needs playwright-core and a
// Chromium on disk (the container's is at /opt/pw-browsers), neither of
// which the game has any use for, and it asserts nothing. It is a camera.
// The guard-rails that came out of what it showed are Section 28 of
// tests/smoke.mjs, which parse style.css as text and need no browser.
//
// Default output is Tools/board-check/shots/games/faire-weekend/, which is
// where WISHLIST.md Phase 5 asked for the before-and-afters and is
// gitignored like the rest of shots/. Nothing under Tools/board-check is
// imported from here; the folder is only a place to put pictures.

import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = path.resolve(ROOT, '..', '..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SAVE_KEY = 'renn-faire-sim-save-v1';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const label = flag('--label');
const only = flag('--only');
const OUT = path.join(process.env.OUT || path.join(SITE, 'Tools', 'board-check', 'shots', 'games', 'faire-weekend'), label || '');
fs.mkdirSync(OUT, { recursive: true });

// Every import goes through a file:// URL so the same file runs on Windows.
const mod = p => pathToFileURL(path.join(ROOT, p)).href;
const State = await import(mod('js/state.js'));
const { currentGridSize, isFootprintWithinCurrentGrid, quoteBuild, isLegalPlacement, reachabilityDistance, footprintFor, performerFor, signingBar, pendingBeats } = await import(mod('js/engine.js'));
const { CONFIG, PERFORMERS, VENDORS, TIME_BLOCKS } = await import(mod('js/data.js'));

/* ---------------- the scripted manager (tests/smoke.mjs Section 1k) ------- */

const tryBuild = (s, kind, reserve) => {
  const size = currentGridSize(s);
  let best = null;
  for (let y = 0; y < size.rows; y++) for (let x = 0; x < size.cols; x++) {
    if (!isFootprintWithinCurrentGrid(s, kind, x, y) || !quoteBuild(kind, x, y, s.builtPlots) || !isLegalPlacement(kind, x, y, s.builtPlots).ok) continue;
    const d = reachabilityDistance({ kind, x, y, ...footprintFor(kind) });
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.d) best = { x, y, d, cost: quoteBuild(kind, x, y, s.builtPlots).cost };
  }
  if (!best || s.cash - best.cost < reserve) return s;
  const r = State.buildPlot(s, kind, best.x, best.y);
  return r.error ? s : r.state;
};
const manage = (s, o) => {
  const cnt = k => s.builtPlots.filter(p => p.kind === k && p.status === 'built').length;
  const plan = [['stage', 1], ['food', 2], ['vendor', 2], ['stage', 2], ['demo', 1], ['food', o.stalls], ['vendor', o.stalls], ['stage', o.stages], ['demo', 2]];
  for (let i = 0; i < 16; i++) {
    const before = s.cash;
    const step = plan.find(([k, n]) => cnt(k) < n);
    if (!step) break;
    s = tryBuild(s, step[0], 600);
    if (s.cash === before) break;
  }
  for (const v of [...VENDORS].sort((a, b) => b.quality - a.quality)) {
    if (!s.hiredVendors.includes(v.id)) { const r = State.hireVendor(s, v.id, 'weekend'); if (!r.error) s = r.state; }
  }
  s = State.autoFillStalls(s).state;
  const stages = s.builtPlots.filter(p => p.kind === 'stage' && p.status === 'built');
  const want = Math.min(stages.length * TIME_BLOCKS.length, o.acts);
  const pool = PERFORMERS.map(p => performerFor(s, p.id)).sort((a, b) => b.popularity - a.popularity);
  for (const p of pool) {
    if (s.roster.includes(p.id) || signingBar(s, p)) continue;
    if (s.roster.length >= want) break;
    if (s.cash < 1500) break;
    const r = State.contractPerformer(s, p.id, 'weekend');
    if (!r.error) s = r.state;
  }
  for (const b of TIME_BLOCKS) for (const st of stages) s = State.unassignSchedule(s, b.id, st.id).state;
  const acts = [...s.roster].map(id => performerFor(s, id)).sort((a, b) => b.popularity - a.popularity);
  let i = 0;
  for (const b of TIME_BLOCKS) for (const st of stages) { if (i < acts.length) s = State.assignSchedule(s, b.id, st.id, acts[i++].id).state; }
  for (const pb of pendingBeats(s)) s = State.resolveBeat(s, pb.beat.id, pb.beat.choices[0].id).state;
  s = State.setTicketPrice(s, CONFIG.priceAnchor).state;
  if (!s.activeCampaign && s.cash > 6000) { const r = State.launchCampaign(s, 'ad_crier'); if (!r.error) s = r.state; }
  return s;
};
// Play until the close of weekend `untilSeason`, returning the state parked
// on that weekend-end desk (or wherever the run stopped first).
const playTo = (s, seed, o, untilSeason) => {
  for (let d = 0; d < 60; d++) {
    s = manage(s, o);
    s = State.runDay(s, seed + d * 101).state;
    s = State.nextDay(s).state;
    if (s.phase === 'gameOver' || s.phase === 'victory') return s;
    if (s.phase === 'weekendEnd') {
      if (s.season >= untilSeason) return s;
      s = State.startNextWeekend(s).state;
    }
  }
  return s;
};

/* ---------------- the states ---------------------------------------------- */

const o = { stalls: 3, stages: 5, acts: 8 };
const fresh = State.createInitialState(20260909);
const w1 = playTo(State.createInitialState(20260909), 4242, o, 1);          // weekendEnd, Weekend 1
const w3plan = manage(State.startNextWeekend(playTo(State.createInitialState(20260909), 4242, o, 3)).state, o); // plan, Weekend 4 opens Deep Woods
const w5end = playTo(State.createInitialState(20260909), 4242, o, 5);        // weekendEnd, Weekend 5
const w6plan = manage(State.startNextWeekend(w5end).state, o);               // plan, Weekend 6, built out
const w6report = State.runDay(w6plan, 777).state;                           // report on a built-out faire
const w6end = playTo(State.createInitialState(20260909), 4242, o, 6);       // weekendEnd at the target: the ledger
let winner = State.createInitialState(20260909); winner.reputation = CONFIG.winCondition.minReputation;
const victory = playTo(winner, 4242, o, 6);                                 // victory, if the manager gets there
const broke = { ...w6plan, cash: CONFIG.bankruptcyFloor - 1200, bankrupt: true, phase: 'gameOver' };

// A DOM click rather than a pointer click: the sticky HUD sits over
// whatever Playwright scrolls into view, and the page re-renders whole
// after every action anyway, so there is nothing for a real pointer to
// prove here.
const tap = (p, sel) => p.evaluate(sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; }, sel);

// One entry per screen the review has to look at. `tab` clicks a desk tab
// after boot; `then` runs page-side after that (a ghost-marker palette, an
// open offer row). Terminal phases have no tabs and take the whole board.
const STATES = [
  { id: 'plan-fresh-office', save: fresh, tab: 'office' },
  { id: 'plan-fresh-backstage', save: fresh, tab: 'backstage' },
  { id: 'plan-fresh-fairfloor', save: fresh, tab: 'fairfloor' },
  { id: 'plan-fresh-placing', save: fresh, tab: 'fairfloor', then: p => tap(p, '[data-action="selectBuild"][data-kind="stage"]') },
  { id: 'plan-w4-office', save: w3plan, tab: 'office' },
  { id: 'plan-w4-backstage', save: w3plan, tab: 'backstage' },
  { id: 'plan-w4-fairfloor', save: w3plan, tab: 'fairfloor' },
  { id: 'plan-w6-office', save: w6plan, tab: 'office' },
  { id: 'plan-w6-backstage', save: w6plan, tab: 'backstage' },
  { id: 'plan-w6-negotiating', save: w6plan, tab: 'backstage', then: p => tap(p, '[data-action="negotiate"]') },
  { id: 'plan-w6-fairfloor', save: w6plan, tab: 'fairfloor' },
  { id: 'report-w6', save: w6report },
  { id: 'weekend-end-w1', save: w1 },
  { id: 'weekend-end-w5', save: w5end },
  { id: 'weekend-end-w6', save: w6end },
  { id: 'victory', save: victory },
  { id: 'game-over', save: broke },
];
const VIEWPORTS = [
  { w: 1280, h: 900, dsf: 1 },
  { w: 1080, h: 900, dsf: 1 },
  { w: 820, h: 1180, dsf: 2, mobile: true },   // an iPad Air, portrait: the 721-1080 band is a tablet band
  { w: 375, h: 812, dsf: 2, mobile: true },
];

/* ---------------- server + browser ---------------------------------------- */

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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

const BASE_ARGS = ['--no-sandbox', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text'];
const browser = await chromium.launch({ executablePath: CHROME, args: BASE_ARGS });
// Playwright's hasTouch gives a page touch events but leaves the pointer
// media query at "fine", which no real phone or tablet does, and the CSS
// that hangs off (pointer: coarse) needs the real answer. Blink takes it
// as a launch setting (pointer type 4 is coarse, hover type 1 is none),
// so the touch viewports get their own browser.
const touchBrowser = await chromium.launch({ executablePath: CHROME, args: [...BASE_ARGS, '--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=1,availableHoverTypes=1'] });

// The numbers. Everything here is a live rectangle, rounded to the pixel.
const MEASURE = () => {
  const r = sel => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const all = sel => [...document.querySelectorAll(sel)].map(el => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; });
  const out = {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hud: r('#hud'),
    hudRows: new Set([...document.querySelectorAll('#ledger .ledger-label')].map(e => Math.round(e.getBoundingClientRect().top))).size,
    grounds: r('#grounds'), plat: r('.plat'), sheet: r('.plat-sheet'), map: r('.grounds-map'), desk: r('#desk'), content: r('#content'),
    cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    coarse: matchMedia('(pointer: coarse)').matches,
    // The map's *tracks*, as opposed to the .grounds-map box, which through
    // Phase 4 stretched to the sheet's width and painted its brown gap
    // colour over everything east of the last column.
    tracks: (() => { const cs = [...document.querySelectorAll('.terrain-cell')]; if (!cs.length) return null; const l = Math.min(...cs.map(c => c.getBoundingClientRect().left)), r = Math.max(...cs.map(c => c.getBoundingClientRect().right)); return { w: Math.round(r - l), left: Math.round(l) }; })(),
    tables: [...document.querySelectorAll('table')].map(t => ({ cls: t.className, w: Math.round(t.getBoundingClientRect().width), scrolls: t.parentElement.scrollWidth > t.parentElement.clientWidth })),
    marker: (() => { const m = all('.plot-marker'); return m.length ? m[0] : null; })(),
    slider: r('input[type=range]'),
    selects: all('select'),
    tabs: all('.tab-btn'),
    meters: all('.meter'),
    priceCurve: r('.price-curve'),
    priceBars: all('.price-curve > i').length,
    palette: all('.palette-buttons .btn'),
    plotCards: [...document.querySelectorAll('.plot-card')].map(c => ({ h: Math.round(c.getBoundingClientRect().height), tags: c.querySelectorAll('.hint-tag, .warn-tag').length, statsH: Math.round(c.querySelector('.plot-stats').getBoundingClientRect().height) })),
    stub: r('.ticket-stub'),
  };
  if (out.tracks && out.sheet) out.matRight = out.sheet.x + out.sheet.w - (out.tracks.left + out.tracks.w);
  if (out.tracks && out.map) out.slab = out.map.w - out.tracks.w;
  if (out.plat && out.grounds) out.platSlack = out.grounds.w - out.plat.w;
  return out;
};

const report = {};
for (const vp of VIEWPORTS) {
  for (const st of STATES) {
    if (only && !st.id.includes(only)) continue;
    const ctx = await (vp.mobile ? touchBrowser : browser).newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dsf, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    const save = JSON.stringify({ ...st.save, __v: 2 });
    await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [SAVE_KEY, save]);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto(URL_, { waitUntil: 'load' });
    await page.waitForSelector('.grounds-map, .ticket-stub');
    await page.evaluate(() => document.fonts.ready);
    if (st.tab) { await tap(page, `[data-tab="${st.tab}"]`); await page.waitForTimeout(80); }
    if (st.then) { await st.then(page); await page.waitForTimeout(80); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(120);
    // Measure before the screenshot: a full-page capture resizes the
    // viewport through device-metrics emulation and, on the way back,
    // Chromium drops the touch emulation with it, so (pointer: coarse)
    // reads false afterwards on the very context that was created touch.
    const m = await page.evaluate(MEASURE);
    m.errors = errs;
    const file = path.join(OUT, `${st.id}-${vp.w}.png`);
    await page.screenshot({ path: file, fullPage: true });
    (report[st.id] ||= {})[vp.w] = m;
    const bits = [
      `page ${m.page.w}x${m.page.h}${m.overflowX ? ' OVERFLOW-X' : ''}`,
      m.hud ? `hud ${m.hud.h}h/${m.hudRows}row` : '',
      m.plat ? `plat ${m.plat.w}w (tracks ${m.tracks.w}, slab ${m.slab}, mat-right ${m.matRight}, cell ${m.cell}${m.coarse ? ' coarse' : ''})` : '',
      m.tables.length ? `tables ${m.tables.map(t => `${t.cls.replace(/-table/, '')}:${t.w}${t.scrolls ? '↔' : ''}`).join(' ')}` : '',
      m.desk ? `desk ${m.desk.w}w` : '',
      m.slider ? `slider ${m.slider.w}x${m.slider.h}` : '',
      m.selects.length ? `select ${m.selects.map(s => `${s.w}x${s.h}`).join(' ')}` : '',
      m.plotCards.length ? `cards ${m.plotCards.length}, tallest ${Math.max(...m.plotCards.map(c => c.h))}h, most tags ${Math.max(...m.plotCards.map(c => c.tags))}` : '',
      m.stub ? `stub ${m.stub.w}w` : '',
      errs.length ? `ERRORS ${errs.length}` : '',
    ].filter(Boolean).join(' · ');
    console.log(`${path.relative(SITE, file).padEnd(70)} ${bits}`);
    await ctx.close();
  }
}
fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(report, null, 1));
console.log(`\n${Object.keys(report).length} states x ${VIEWPORTS.length} viewports -> ${path.relative(SITE, OUT)}/`);
await browser.close();
await touchBrowser.close();
server.close();
