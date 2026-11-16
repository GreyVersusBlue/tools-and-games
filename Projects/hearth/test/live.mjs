// Hearth's public island, the page (C4): live.html against a running server/live.mjs. Browser, over http.
//
//   node live.mjs          (from Projects/hearth/test; about a minute and a half)
//
// serve.mjs serves the game and mounts the server's public folder at /hearth-live/. server/live.mjs runs in this process on a clock that
// runs 60 times faster than the wall clock (an island day every ten real seconds at HEARTH_DAY_SECONDS 600), and the page's own Date.now
// and the Date header both follow that clock, so the page sees the hour the server sees. The point of the whole page is that what it
// steps between two epochs is what the server stepped: the page hashes its own pack() at each epoch and this file compares that with
// the hash on disk, read here from the file and not from the page. Real time is never asserted on; every wait is for a state.
//
// C5 (the record) adds, below (4): the "while you were away" panel against hearth.liveSeen, "take a copy", the HUD link on index.html, and
// "yesterday at speed". The server is first run 14 island days ahead, so there is a chronicle with entries on several days to be away from.
import { chromium } from 'playwright';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';
import { createLive, envConfig } from '../server/live.mjs';
import { loadHearth } from './load.mjs';
import { fnv } from '../server/world.mjs';
import { fileURLToPath } from 'node:url';

const SPEED = 60, DAY_SECONDS = 600;
let failed = 0;
function check(name, ok, detail = '') { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; }

fs.mkdirSync(path.join(os.homedir(), '.cache'), { recursive: true }); // a fresh CI runner has no ~/.cache yet
const SCRATCH = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'hearth-live-test-'));
process.on('exit', () => fs.rmSync(SCRATCH, { recursive: true, force: true }));
const cfg = envConfig({ HEARTH_DATA: path.join(SCRATCH, 'data'), HEARTH_PUBLIC: path.join(SCRATCH, 'pub'), HEARTH_SEED: '7', HEARTH_DAY_SECONDS: String(DAY_SECONDS) });
const REAL0 = Date.now(), FAKE0 = Date.UTC(2026, 5, 1);
let skew = 0;                                    // jumped once, before the browser opens, so the island has a past (C5)
const now = () => FAKE0 + skew + (Date.now() - REAL0) * SPEED;

const live = createLive(cfg, { now, log: l => console.log('  server:', l) });
const PAST_DAYS = 14;
let ticker = null;
const startTicks = () => { if (!ticker) ticker = setInterval(() => { try { live.tick(); } catch (e) { console.log('tick threw', e.message); } }, 200); };
const stopTicks = () => { clearInterval(ticker); ticker = null; };
skew = PAST_DAYS * DAY_SECONDS * 1000;
live.tick();                                     // catch up 14 island days in one go, as a restart after a long absence would
startTicks();

const srv = await serve({ mounts: { '/hearth-live/': path.resolve(cfg.pub) }, date: now });
const bare = await serve();                      // the same game with no /hearth-live/ route: the mirror, or a disk
const LAUNCH = { args: ['--autoplay-policy=no-user-gesture-required'] };
const browser = await chromium.launch(LAUNCH).catch(() => chromium.launch({ ...LAUNCH, executablePath: '/opt/pw-browsers/chromium' }));
const bad = [];

// `ctx` reuses a context (and so its storage; the init script is added once, with the context); `seen` is written to hearth.liveSeen first
async function open(base, file, { fast = true, ctx: have = null, seen } = {}) {
  const ctx = have || await browser.newContext({ viewport: { width: 880, height: 560 }, deviceScaleFactor: 1 });
  if (!have) await ctx.addInitScript(({ real0, fake0, speed, fast }) => {
    localStorage.setItem('hearth.auto', 'SENTINEL');
    window.HEARTH_LIVE_TUNE = { retry: 300, breath: 2500, back: 20 };
    if (fast) { const n = Date.now.bind(Date); Date.now = () => fake0 + (n() - real0) * speed; }
  }, { real0: REAL0, fake0: FAKE0 + skew, speed: SPEED, fast });
  const page = await ctx.newPage();
  if (seen !== undefined) { await page.goto(base + 'js/live-flag.js'); await page.evaluate(v => localStorage.setItem('hearth.liveSeen', v), seen); }
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

// ---- C5: the record, and coming back to it ----
// The Node side reads the chronicle out of the epoch file with the game's own scripts, so what the panel must list is not worked out by the page.
const { H: NH } = loadHearth({ globals: { btoa, atob } });
function inEpoch(n) { NH.unpack(JSON.parse(NH.lzDec(epochFile(n).save))); return { day: NH.dayCount, chron: NH.chron.map(e => ({ d: e.d, y: e.y, t: (e.st || e.label).replace(/<[^>]+>/g, '') })) }; }
const panelOf = page => page.evaluate(() => {
  const el = document.getElementById('live-away'), rows = [...el.querySelectorAll('p')].map(p => p.textContent), years = [...el.querySelectorAll('h4')].map(h => h.textContent.replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' '));
  return { hidden: el.hidden, shown: getComputedStyle(el).display !== 'none', rows, years, sub: document.getElementById('lv-away-s').textContent };
});
const readyLive = page => page.waitForFunction(() => window.__hearthLive && window.__hearthLive.ready, null, { timeout: 60000 });
stopTicks();                                            // the panel and the copy are read from one epoch that does not move under them
{
  const E = live.epoch, past = inEpoch(E), days = [...new Set(past.chron.map(e => e.d))].sort((a, b) => a - b);
  // three days back or more, and the latest such day that leaves at least three entries to list (so there is an order to check)
  const later = d => past.chron.filter(e => e.d > d).length, seenDay = days.filter(d => d <= past.day - 3 && later(d) >= 3).pop();
  check('(C5) the island has a past to be away from: an entry on a day three or more back, and entries after it', seenDay !== undefined && past.chron.some(e => e.d > seenDay), `day ${past.day}, entry days ${days.join(',')}`);
  const want = past.chron.filter(e => e.d > seenDay).slice(-40);
  const { ctx, page } = await open(srv.url, 'live.html', { seen: `0:${seenDay}` });
  await readyLive(page);
  const pn = await panelOf(page);
  console.log(`  panel: seen day ${seenDay}, island day ${past.day}, ${pn.rows.length} lines, "${pn.sub}"`);
  check('(C5) with hearth.liveSeen three days back the panel is open', !pn.hidden && pn.shown);
  check('(C5) it lists exactly the chronicle entries whose day is later than that, in order', JSON.stringify(pn.rows) === JSON.stringify(want.map(e => `day ${e.d}${e.t}`)), `page ${pn.rows.length}: ${pn.rows.slice(0, 2).join(' / ')}; want ${want.length}: ${want.slice(0, 2).map(e => e.t).join(' / ')}`);
  check('(C5) under year headings, one for each year the lines span, in order', JSON.stringify(pn.years) === JSON.stringify([...new Set(want.map(e => e.y))].map(y => `year ${y}`)), JSON.stringify(pn.years));
  check('(C5) and it says how many', /\d+ things/.test(pn.sub) || /one thing/.test(pn.sub), pn.sub);
  check('(C5) the visit is not written down until the panel is closed', await page.evaluate(() => localStorage.getItem('hearth.liveSeen')) === `0:${seenDay}`);
  await page.click('#lv-away-ok');
  const nowDay = await page.evaluate(() => window.__hearthLive.nowDay), kept = await page.evaluate(() => localStorage.getItem('hearth.liveSeen'));
  check('(C5) closing it writes era:day of today, and hides it', kept === `0:${nowDay}` && (await panelOf(page)).hidden, kept);
  check('(C5) hearth.auto is still the sentinel after all of it', await page.evaluate(() => localStorage.getItem('hearth.auto')) === 'SENTINEL');
  await page.close();
  const again = await open(srv.url, 'live.html', { ctx });
  await readyLive(again.page);
  check('(C5) a second visit the same day has nothing to say', (await panelOf(again.page)).hidden);
  await ctx.close();
  const first = await open(srv.url, 'live.html');
  await readyLive(first.page);
  const fk = await first.page.evaluate(() => localStorage.getItem('hearth.liveSeen'));
  check('(C5) a first visit shows no panel and writes the key', (await panelOf(first.page)).hidden && /^0:\d+$/.test(fk), fk);

  // take a copy: the epoch's own save string, which loadHash on index.html opens at that epoch's day
  const href = await first.page.evaluate(() => document.getElementById('lv-copy').getAttribute('href')), file = epochFile(E);
  check('(C5) "take a copy" points at index.html with the epoch file\'s own save string', href.startsWith('index.html#') && href.slice(11) === file.save, href.slice(0, 40));
  NH.unpack(JSON.parse(NH.lzDec(href.slice(11))));
  check('(C5) that string unpacks and repacks to the hash the server wrote (it is that island)', fnv(JSON.stringify(NH.pack())) === file.hash && NH.dayCount === past.day);
  const cp = await open(bare.url, href, { fast: false });
  await cp.page.evaluate(() => { window.__hearth.speed = 0; });
  const cd = await cp.page.evaluate(() => window.__hearth.dayCount);
  check('(C5) opened as index.html does, it is that island at that day', cd === past.day, `${cd} vs ${past.day}`);
  await cp.ctx.close();
  const copy = len => first.page.evaluate(n => { lvCopyUpdate({ save: 'a'.repeat(n) }); const r = { link: !document.getElementById('lv-copy').hidden, line: !document.getElementById('lv-long').hidden, text: document.getElementById('lv-long').textContent }; lvCopyUpdate(lvBody); return r; }, len);
  const c1 = await copy(1500000), c2 = await copy(1500001);
  check('(C5) a save of exactly 1,500,000 characters still gets its link', c1.link && !c1.line, JSON.stringify(c1));
  check('(C5) one character more hides it and says the island has grown too long and the saga is the way', !c2.link && c2.line && /too long/.test(c2.text) && /saga/.test(c2.text), JSON.stringify(c2));
  check('(C5) the saga link is there', await first.page.evaluate(() => document.getElementById('lv-saga').getAttribute('href')) === '/hearth-live/saga.html');
  check('(C5) and the saga and chronicle the server wrote are there to open', /<html/i.test(fs.readFileSync(path.join(cfg.pub, 'saga.html'), 'utf8')) && fs.readFileSync(path.join(cfg.pub, 'chronicle.txt'), 'utf8').length > 100);
  await first.ctx.close();

  // the HUD link on index.html: there over http, not there from a disk
  const hi = await open(bare.url, 'index.html', { fast: false });
  const hl = await hi.page.evaluate(() => { const a = document.querySelector('.live-link'); return { href: a.getAttribute('href'), shown: !a.hidden && getComputedStyle(a).display !== 'none', text: a.textContent }; });
  check('(C5) index.html served over http shows a "the public island" link to live.html', hl.shown && hl.href === 'live.html' && /public island/.test(hl.text), JSON.stringify(hl));
  await hi.ctx.close();
  const fctx = await browser.newContext(), fp = await fctx.newPage();
  await fp.goto('file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'));
  const fh = await fp.evaluate(() => { const a = document.querySelector('.live-link'); return !a.hidden && getComputedStyle(a).display !== 'none'; });
  check('(C5) and the same page opened from a disk does not', fh === false);
  await fctx.close();
}
startTicks();

// yesterday at speed. Epochs 0 and 1 are taken away, so "a real day back" (epoch 0 on this clock, which has 144 epochs to a real day) has to find the oldest kept.
{
  for (const n of [0, 1]) fs.rmSync(path.join(cfg.pub, 'epoch', `0-${n}.json`));
  const present = await lp.evaluate(() => ({ day: window.__hearth.dayCount }));
  const eAt = await lp.evaluate(() => window.__hearthLive.epoch);   // the epoch the page is on when it leaves the present
  await lp.click('#lv-back');
  await lp.waitForFunction(() => window.__hearthLive.back, null, { timeout: 30000 });
  const bk = await lp.evaluate(() => ({ from: window.__hearthLive.backFrom, day: window.__hearth.dayCount, banner: !document.getElementById('live-back').hidden, text: document.getElementById('live-back').textContent }));
  check('(C5) "yesterday at speed" starts at the oldest epoch kept (the first two files were gone)', bk.from === epochStep(2), `${bk.from}`);
  check('(C5) the island is the older one, with a banner that says it is a look back', bk.day < present.day && bk.banner && /look back/.test(bk.text), JSON.stringify(bk));
  await lp.waitForFunction(() => !window.__hearthLive.back, null, { timeout: 240000 });
  check('(C5) the server moved on to a later epoch while the page was looking back (else the check below could not tell a return from a stay)', live.epoch > eAt, `page left at ${eAt}, server at ${live.epoch}`);
  const nBack = await lp.evaluate(() => window.__hearthLive.log.length);   // boundaries the page crossed while it waited to start do not count; only the first one after the return
  await lp.waitForFunction(n => window.__hearthLive.log.length > n, nBack, { timeout: 60000 });
  const lg = await lp.evaluate(() => window.__hearthLive.log), last = lg[lg.length - 1];
  check('(C5) back at the present, the banner is gone and hearth.auto was never touched', await lp.evaluate(() => document.getElementById('live-back').hidden && localStorage.getItem('hearth.auto') === 'SENTINEL'));
  check('(C5) and at the next epoch boundary the page\'s hash equals the server\'s again', last.mine === epochFile(last.n).hash && await lp.evaluate(() => window.__hearthLive.mismatches) === 0, `${last.n}: page ${last.mine} server ${epochFile(last.n).hash}`);
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
