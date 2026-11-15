// Hearth's public island, the page (C4): live.html against a running server/live.mjs. Browser, over http.
//
//   node live.mjs          (from Projects/hearth/test; about a minute and a half)
//
// serve.mjs serves the game and mounts the server's public folder at /hearth-live/. server/live.mjs runs in this process on a clock that
// runs 60 times faster than the wall clock (an island day every ten real seconds at HEARTH_DAY_SECONDS 600), and the page's own Date.now
// and the Date header both follow that clock, so the page sees the hour the server sees. The point of the whole page is that what it
// steps between two epochs is what the server stepped: the page hashes its own pack() at each epoch and this file compares that with
// the hash on disk, read here from the file and not from the page. Real time is never asserted on; every wait is for a state.
import { chromium } from 'playwright';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { createLive, envConfig } from '../server/live.mjs';

const SPEED = 60, DAY_SECONDS = 600;
let failed = 0;
function check(name, ok, detail = '') { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; }

const SCRATCH = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'hearth-live-test-'));
process.on('exit', () => fs.rmSync(SCRATCH, { recursive: true, force: true }));
const cfg = envConfig({ HEARTH_DATA: path.join(SCRATCH, 'data'), HEARTH_PUBLIC: path.join(SCRATCH, 'pub'), HEARTH_SEED: '7', HEARTH_DAY_SECONDS: String(DAY_SECONDS) });
const REAL0 = Date.now(), FAKE0 = Date.UTC(2026, 5, 1);
const now = () => FAKE0 + (Date.now() - REAL0) * SPEED;

const live = createLive(cfg, { now, log: l => console.log('  server:', l) });
let ticker = null;
const startTicks = () => { if (!ticker) ticker = setInterval(() => { try { live.tick(); } catch (e) { console.log('tick threw', e.message); } }, 200); };
const stopTicks = () => { clearInterval(ticker); ticker = null; };
startTicks();

const srv = await serve({ mounts: { '/hearth-live/': path.resolve(cfg.pub) }, date: now });
const bare = await serve();                      // the same game with no /hearth-live/ route: the mirror, or a disk
const LAUNCH = { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(LAUNCH).catch(() => chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }));
const bad = [];

async function open(base, file, { fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 880, height: 560 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(({ real0, fake0, speed, fast }) => {
    localStorage.setItem('hearth.auto', 'SENTINEL');
    window.HEARTH_LIVE_TUNE = { retry: 300, breath: 2500 };
    if (fast) { const n = Date.now.bind(Date); Date.now = () => fake0 + (n() - real0) * speed; }
  }, { real0: REAL0, fake0: FAKE0, speed: SPEED, fast });
  const page = await ctx.newPage();
  page.on('console', m => { const t = m.text(); if (t.startsWith('hearth:') || t.includes('non-finite')) bad.push(t); });
  page.on('pageerror', e => bad.push('PAGEERROR: ' + e.message));
  await page.goto(base + file);
  await page.waitForFunction(() => !!window.__hearth);
  return { ctx, page };
}
const epochFile = n => JSON.parse(fs.readFileSync(path.join(cfg.pub, 'epoch', `0-${n}.json`), 'utf8'));
const epochStep = n => n === 0 ? 0 : 2240 + 2800 * (n - 1);

// ---- (1), (2), (3): the page across three epoch boundaries ----
const { ctx: lctx, page: lp } = await open(srv.url, 'live.html');
await lp.waitForFunction(() => window.__hearthLive && window.__hearthLive.ready, null, { timeout: 60000 });
await lp.waitForFunction(() => window.__hearth.sheet.ready || !!window.__hearth.sheet.fail);
await lp.waitForFunction(() => window.__hearthLive.log.length >= 3, null, { timeout: 150000 });
const log = await lp.evaluate(() => window.__hearthLive.log.slice(0, 3));
console.log('  boundaries:', log.map(l => `${l.n}@${l.step} ${l.mine}`).join('  '));
check('(1) three epoch boundaries, in order, each at the step the arithmetic gives', log.every((l, i) => l.n === log[0].n + i && l.step === epochStep(l.n)), JSON.stringify(log));
check('(1) at every one the page\'s own hash equals the hash the server wrote in its file (lockstep)', log.every(l => l.mine === epochFile(l.n).hash), log.map(l => `${l.n}: page ${l.mine} server ${epochFile(l.n).hash}`).join('; '));
check('(1) and the page counted no mismatch', await lp.evaluate(() => window.__hearthLive.mismatches) === 0);
check('(2) hearth.auto, set to a sentinel before the visit, is unchanged after it', await lp.evaluate(() => localStorage.getItem('hearth.auto')) === 'SENTINEL');
const stat = await lp.evaluate(() => document.getElementById('live-status').textContent);
check('the status line names the village, the year, the day and the people', /year \d+/.test(stat) && /day \d+/.test(stat) && /\d+ people/.test(stat), stat);
check('the speed buttons and the keep and new-island buttons are not shown', await lp.evaluate(() => ['ctl', 'b-morning', 'b-share', 'b-new', 'hint'].every(i => getComputedStyle(document.getElementById(i)).display === 'none')));

// (3) a click on water, where the offline page would skip a stone. The same click on index.html is the control: it has to skip one.
async function waterClick(page) {
  const pt = await page.evaluate(() => {
    const H = window.__hearth, c = document.getElementById('c'), r = c.getBoundingClientRect(), v = H.view, k = v.fitS * v.zoom * v.dprE;
    for (let y = 4; y < 66; y += 2) for (let x = 4; x < 106; x += 2) {
      if (H.tilesNow[y * 110 + x] !== 0) continue;
      const cx = ((x + .5) * 8 * k + c.width / 2 - v.camX * 8 * k) / v.dprE + r.left, cy = ((y + .5) * 8 * k + c.height / 2 - v.camY * 8 * k) / v.dprE + r.top;
      if (cx > 0 && cy > 70 && cx < innerWidth && cy < innerHeight - 20 && document.elementFromPoint(cx, cy) === c) return { x: cx, y: cy };
    }
    return null;
  });
  if (!pt) return null;
  // skipN is the island's own count of stones skipped, and it is saved, so it outlasts the stone itself, which a fast clock ages out in a blink
  const before = await page.evaluate(() => window.__hearth.skipN);
  await page.mouse.click(pt.x, pt.y);
  return page.evaluate(b => window.__hearth.skipN - b, before);
}
const wl = await waterClick(lp);
const { ctx: octx, page: op } = await open(bare.url, 'index.html', { fast: false });
await op.waitForFunction(() => window.__hearth.sheet.ready || !!window.__hearth.sheet.fail);
const wo = await waterClick(op);
check('(3) the control: a click on water on index.html skips a stone', wo === 1, String(wo));
check('(3) a click on water on live.html adds no skipped stone', wl === 0, String(wl));
await octx.close();

// ---- (4) the server stops: the breath line, and the page resumes when it is back ----
{
  const e0 = live.epoch;
  await new Promise(ok => { const t = setInterval(() => { if (live.epoch > e0) { clearInterval(t); ok(); } }, 50); });
  stopTicks();                                          // the next epoch's file will not exist until the ticks start again
  const n0 = await lp.evaluate(() => window.__hearthLive.log.length);
  await lp.waitForFunction(() => window.__hearthLive.breath, null, { timeout: 60000 });
  const note = await lp.evaluate(() => { const e = document.getElementById('live-note'); return { hidden: e.hidden, text: e.textContent, shown: getComputedStyle(e).display }; });
  check('(4) with the server stopped the page shows the breath line', !note.hidden && note.shown !== 'none' && /catching its breath/.test(note.text), JSON.stringify(note));
  startTicks();
  await lp.waitForFunction(n => !window.__hearthLive.breath && window.__hearthLive.log.length > n, n0, { timeout: 60000 });
  check('(4) and it resumes when the server is back, the line gone', await lp.evaluate(() => document.getElementById('live-note').hidden));
  await lp.waitForFunction(n => window.__hearthLive.log.length > n + 1, n0, { timeout: 60000 });
  const l2 = await lp.evaluate(() => window.__hearthLive.log);
  check('(4) and still in lockstep afterwards, boundary by boundary', l2.every(l => l.mine === epochFile(l.n).hash) && await lp.evaluate(() => window.__hearthLive.mismatches) === 0, JSON.stringify(l2.filter(l => l.mine !== epochFile(l.n).hash)));
}
stopTicks();
await lctx.close();

// ---- (5) opened with the route removed: one quiet line, a link to index.html, nothing thrown ----
{
  const { ctx, page } = await open(bare.url, 'live.html', { fast: false });
  await page.waitForFunction(() => !document.getElementById('live-note').hidden, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const o = await page.evaluate(() => ({ text: document.getElementById('live-note').textContent, href: (document.querySelector('#live-note a') || {}).getAttribute?.('href'), ready: window.__hearthLive.ready, dead: window.__hearthLive.dead }));
  check('(5) with no /hearth-live/ route the page says where the island lives and links index.html', /kept on the site/.test(o.text) && o.href === 'index.html' && !o.ready && o.dead, JSON.stringify(o));
  await ctx.close();
}
check('no page error and no hearth: console line anywhere in the run', bad.length === 0, bad.join(' | '));

await browser.close();
srv.close(); bare.close();
console.log(failed ? `FAIL: ${failed} live checks failed` : 'PASS: live.mjs');
process.exit(failed ? 1 : 0);
