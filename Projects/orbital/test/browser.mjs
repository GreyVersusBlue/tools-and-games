// browser.mjs — Orbital's committed browser layer.
//
//   node Projects/orbital/test/browser.mjs
//
// Exits non-zero on any missed beat (locked decision #13). Screenshots in
// ./shots/.
//
// Round 1 hand-drove a live session to answer the reset-confirmation and
// mobile-aim questions and deliberately committed nothing. What was missing was
// the repeatable half: the sector grid's render and its unlock rule, the star
// display, the save, and the three buttons that write it. That is what is here.
// `test/physics.mjs`, `test/levelcode.mjs` and `test/generator.mjs` already own
// the model underneath and none of them opens a browser.
//
// Borrows Tools/board-check's harness rather than copying it. Bare specifiers
// inside those files resolve from THEIR folder, so nothing needs installing
// under Projects/.
//
// It opens the page itself rather than going through `games.mjs`'s `enter()`.
// That entry's `open()` seeds `deepspace#10` and clicks its way to the twelfth
// Deep Space sector, because it exists to frame a preview capture of "Deep
// Field". Half of what is below is about what the grid looks like on a save
// that has nothing in it, which that opening has already spent.
//
// ---------------------------------------------------------------------------
// Why one live flight, and why exactly one.
//
// Orbital's rAF loop runs at 6 to 7 frames a second under the software-rendered
// Chromium this repo's Linux harness drives, measured against 51 on a page that
// draws nothing. The compositor is not the bottleneck — the canvas draw is, and
// `drawBg` repaints 160 stars and two gradients across the whole window every
// frame. `stepFly` advances 1/60 s of flight per frame, so a shot costs about
// ten wall-clock seconds per sim-second here.
//
// So the shot this file flies is the shortest winning one on the first level, a
// straight line at full power across an empty field: 1.57 s of sim, about 10 s
// of wall clock. `OrbitalPhysics.findWinningShot` on that same level returns a
// 10.56 s arc, which would be a hundred seconds of CI on its own.
//
// Locked decision #53 — a real-time movement assertion under software
// rasterization is inconclusive either way — does not reach this. Nothing here
// is timed. `substep` advances a fixed DT and the flight is a count of frames,
// not a duration, so a slow frame rate changes how long the suite takes and not
// one digit of what it reports. The two assertions that would fall foul of #53,
// "the probe got there in N seconds" and "the frame rate held", are not here on
// purpose.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { waitFor } from '../../../Tools/board-check/drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const PORT = 8155; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'orbital_progress_v2';
const PAGE_URL = '/Projects/orbital/';

fs.mkdirSync(OUT, { recursive: true });

let checks = 0, failures = 0, shotN = 0;
const t = {
  ok(cond, label, detail = '') {
    checks++;
    if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
    else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
  },
};
/* Each section runs inside its own try/catch, and a section that throws costs
   its own checks and no others. The first deliberate break of this file (#34)
   was the mid-flight reset guard: the probe stopped dead, the wait for the
   flight to end timed out, and the abort took the twelve wipe and clean checks
   down with it. A suite that reports a second bug by not looking for it is
   worth less than one that reports one. */
async function section(name, fn) {
  console.log('\n' + name);
  try { await fn(); }
  catch (err) {
    checks++; failures++;
    console.log(`  FAIL  the section threw  ${err && err.message ? err.message : err}`);
  }
}
const shot = async (page, label) =>
  page.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`) });

/* Every page.evaluate below takes exactly one argument. Puppeteer's signature is
   (fn, ...args) and Playwright's is (fn, arg); one argument is the only shape
   that means the same thing to both, and this file has to pass in CI on Linux
   (puppeteer) and by hand on Windows (playwright). Same reason drive.mjs's
   waitFor exists. */

/** Seed the save, reload so the page reads it at script-eval time, and wait. */
async function boot(page, progress) {
  await page.evaluate(([k, v]) => {
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
  }, [KEY, progress]);
  await page.reload({ waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('#btnStart');
}

/** Past the intro card. Level 0 is already loaded behind it. */
async function begin(page) {
  await page.click('#btnStart');
  await waitFor(page, () => !document.getElementById('introScrim').classList.contains('show'),
    { timeout: 5000 });
}

async function openMap(page) {
  await page.click('#btnLevels');
  await waitFor(page, () => document.getElementById('lvlScrim').classList.contains('show'),
    { timeout: 5000 });
}

/** The sector grid as the DOM has it: one entry per cell, in order. */
const cells = page => page.evaluate(() =>
  [...document.querySelectorAll('#lvlGrid .cell')].map(c => ({
    tag: c.tagName,
    locked: c.classList.contains('locked'),
    n: c.querySelector('.n').textContent,
    stars: c.querySelector('.st').textContent.trim(),
  })));

const hud = page => page.evaluate(() => ({
  pack: document.getElementById('packName').textContent,
  num: document.getElementById('lvlNum').textContent,
  total: document.getElementById('lvlTotal').textContent,
  name: document.getElementById('lvlName').textContent,
  attempts: document.getElementById('attempts').textContent,
  stars: document.getElementById('hudStars').textContent,
}));

const onDisk = page => page.evaluate(k => localStorage.getItem(k), KEY);

/* `#btnWipe` is behind a native confirm(). Both engines expose it as a `dialog`
   event with accept()/dismiss(), so one handler covers them — but only if the
   handler is registered before the click, because the renderer is blocked until
   it answers. `seen` is the point of the return value: without it, a confirm()
   that ever went away would leave the accept path passing for the wrong reason. */
async function answering(page, accept, fn) {
  let seen = false;
  const handler = d => { seen = true; return accept ? d.accept() : d.dismiss(); };
  page.on('dialog', handler);
  try { await fn(); } finally { page.off('dialog', handler); }
  return seen;
}

const srv = await serve(PORT);
const browser = await launch();
let page;

try {
  // 1320x800 at dsf 1, the same view games.mjs frames Orbital in. dsf 2 doubles
  // the canvas and halves an already slow frame rate for nothing: no assertion
  // here reads a pixel.
  page = await prepPage(browser, BASE, { width: 1320, height: 800, dsf: 1 });
  await page.goto(BASE + PAGE_URL, { waitUntil: 'load', timeout: 45000 });

  await section('Boot, on a save with nothing in it', async () => {
    await boot(page, null);
    const h = await hud(page);
    t.ok(h.name === 'First Light', 'level 0 is loaded behind the intro card', h.name);
    t.ok(h.pack === 'Basics' && h.num === '01' && h.total === '10', 'and the HUD names its pack',
      `${h.pack} ${h.num}/${h.total}`);
    t.ok(h.stars === '☆☆☆', 'with no stars on it yet', h.stars);
    const intro = await page.evaluate(() =>
      document.getElementById('introScrim').classList.contains('show'));
    t.ok(intro, 'the intro card is up');
    await shot(page, 'intro');
  });

  await section('The sector grid renders, and locks', async () => {
    await begin(page);
    await openMap(page);
    const c = await cells(page);
    t.ok(c.length === 22, 'all 22 sectors are on the map', `${c.length} cells`);
    const packs = await page.evaluate(() =>
      [...document.querySelectorAll('#lvlGrid .pack-h span:first-child')].map(s => s.textContent));
    t.ok(packs.join(' | ') === 'Basics | Deep Space', 'under one heading per pack', packs.join(' | '));
    t.ok(c[0].n === '01' && c[9].n === '10' && c[10].n === '01' && c[21].n === '12',
      'and each pack numbers from 01 again', `${c[0].n} ${c[9].n} ${c[10].n} ${c[21].n}`);

    t.ok(c[0].tag === 'BUTTON' && !c[0].locked, 'the first sector is open', c[0].tag);
    const locked = c.slice(1).filter(x => x.locked).length;
    t.ok(locked === 21, 'and every other one is locked on a fresh save', `${locked} of 21`);
    t.ok(c.slice(1).every(x => x.tag === 'DIV'),
      'a locked cell is a div, so there is nothing to click');
    await shot(page, 'grid-fresh');
  });

  await section('A record on a sector opens the next one', async () => {
    await boot(page, { 'basics#0': 1 });
    await begin(page);
    await openMap(page);
    const c = await cells(page);
    t.ok(!c[0].locked && !c[1].locked, 'the sector after the one you played is open');
    t.ok(c[2].locked, 'and the one after that is not', `cell 3 locked: ${c[2].locked}`);
  });

  await section('A record on a sector also opens that sector', async () => {
    // buildGrid()'s second clause: `|| progress[LEVELS[idx].key] != null`. It is
    // what keeps a sector you have a star on reachable when the chain in front
    // of it is gone — a wiped-then-partly-replayed save, or a pack reordered
    // under a save that predates it.
    await boot(page, { 'deepspace#3': 2 });
    await begin(page);
    await openMap(page);
    const c = await cells(page);
    t.ok(!c[13].locked, 'deepspace#3 is open on its own record', `cell 14 locked: ${c[13].locked}`);
    t.ok(c[12].locked, 'while the sector in front of it stays locked',
      `cell 13 locked: ${c[12].locked}`);
    t.ok(c[0].locked === false, 'and the first sector is always open');
  });

  await section('Stars read off the attempt count', async () => {
    // starsFor: 1 attempt is three stars, 3 is two, 4 is one.
    await boot(page, { 'basics#0': 1, 'basics#1': 3, 'basics#2': 4 });
    await begin(page);
    const h = await hud(page);
    t.ok(h.stars === '★★★', 'the HUD shows the current sector\'s best', h.stars);
    await openMap(page);
    const c = await cells(page);
    t.ok(c[0].stars === '★★★', 'one attempt is three stars', c[0].stars);
    t.ok(c[1].stars === '★★☆', 'three attempts is two', c[1].stars);
    t.ok(c[2].stars === '★☆☆', 'four is one', c[2].stars);
    t.ok(c[3].stars === '', 'and an unplayed sector shows none', JSON.stringify(c[3].stars));
    await shot(page, 'grid-stars');
  });

  await section('Clicking an open sector loads it', async () => {
    await page.evaluate(() => document.querySelectorAll('#lvlGrid .cell')[2].click());
    await waitFor(page, () => !document.getElementById('lvlScrim').classList.contains('show'),
      { timeout: 5000 });
    const h = await hud(page);
    t.ok(h.name === 'Slingshot' && h.num === '03', 'the third sector is up', `${h.num} ${h.name}`);
    t.ok(h.stars === '★☆☆', 'with its own stars in the HUD', h.stars);
    t.ok(h.attempts === '0', 'and the attempt count starts over', h.attempts);
  });

  await section('One flight, from the aim to the save', async () => {
    await boot(page, null);
    await begin(page);
    // The aim the player would drag: straight at the marker, full power. First
    // Light has no bodies, so the flight plan is the line and 1.57 s of it.
    const predicted = await page.evaluate(() => {
      const a = Math.atan2(L.goal.y - L.start.y, L.goal.x - L.start.x);
      aim = { dx: Math.cos(a) * OrbitalPhysics.MAXDRAG, dy: Math.sin(a) * OrbitalPhysics.MAXDRAG };
      computePlan();
      // The same solve computePlan just ran, kept so the live flight can be held
      // to it. physics.js's header claims one stepper drives both the dotted
      // preview and the flight; `solve` is the preview side and `stepFly` is the
      // live side, and they are two separate call sites of `substep`. What this
      // pins is that they agree, which is what the player is promised. What
      // `substep` itself does is test/physics.mjs's, not this file's.
      // It re-derives the launch velocity from planPow/planAng rather than
      // taking launch()'s word for it, which is the whole point: a launch that
      // flies something other than what was drawn has to show up here.
      const sp = planPow * OrbitalPhysics.MAXSPEED;
      const r = OrbitalPhysics.solve(probe, { x: Math.cos(planAng) * sp, y: Math.sin(planAng) * sp }, L);
      return { outcome: plan.outcome, pts: plan.length, t: r.t, x: r.x, y: r.y };
    });
    t.ok(predicted.outcome === 'WIN', 'the flight plan says this shot wins',
      `${predicted.outcome}, ${predicted.pts} points`);
    await shot(page, 'aimed');

    await page.evaluate(() => launch());
    const h0 = await hud(page);
    t.ok(h0.attempts === '1', 'launching counts the attempt', h0.attempts);

    // The suite's one long wait. See the header for what it is waiting on.
    await waitFor(page, () => mode === 'done', { timeout: 60000, polling: 250 });
    const h = await hud(page);
    const end = await page.evaluate(() => ({ t: tSim, x: probe.x, y: probe.y }));
    t.ok(await page.evaluate(() => won), 'the live flight wins');
    // Fixed DT and the same substep count, so this is an equality and not a
    // tolerance. First Light is an empty field, which makes the END POSITION a
    // weak assertion on its own: a launch at 90% speed crosses the goal circle
    // at very nearly the same point, just later. The clock is what tells the
    // plan and the flight apart. Both are here; the first deliberate break that
    // ran green was exactly this shot at 0.9x MAXSPEED (#34).
    t.ok(Math.abs(end.t - predicted.t) < 1e-9, 'after exactly the flight time the plan drew',
      `${end.t.toFixed(6)} s against ${predicted.t.toFixed(6)}`);
    t.ok(Math.hypot(end.x - predicted.x, end.y - predicted.y) < 1e-6,
      'and on the plan\'s last point',
      `(${end.x.toFixed(3)}, ${end.y.toFixed(3)}) against (${predicted.x.toFixed(3)}, ${predicted.y.toFixed(3)})`);
    const flash = await page.evaluate(() => document.getElementById('flash').textContent);
    t.ok(flash === 'MARKER REACHED', 'the board says so', flash);
    t.ok(h.stars === '★★★', 'a first-attempt win is three stars', h.stars);
    const next = await page.evaluate(() =>
      document.getElementById('btnNext').classList.contains('show'));
    t.ok(next, 'and the next-sector button is up');
    await shot(page, 'won');

    // #39: the DOM for what just happened, the save for what a reload survives.
    t.ok(await onDisk(page) === '{"basics#0":1}', 'the save records the attempt count, not the stars',
      String(await onDisk(page)));
  });

  await section('Reset re-seats the probe, and will not touch a flight in progress', async () => {
    await page.click('#btnReset');
    const after = await page.evaluate(() => ({
      next: document.getElementById('btnNext').classList.contains('show'),
      atStart: probe.x === L.start.x && probe.y === L.start.y,
      plan: plan.length,
    }));
    t.ok(!after.next, 'the next-sector button goes away');
    t.ok(after.atStart, 'the probe is back on the pad');
    t.ok(after.plan === 0, 'and the flight plan is cleared');

    // Mid-flight the button is a no-op, which is the guard `mode !== "fly"`.
    // There is no DOM for "the probe is still out there", so this one reads the
    // state directly.
    await page.evaluate(() => {
      const a = Math.atan2(L.goal.y - L.start.y, L.goal.x - L.start.x);
      aim = { dx: Math.cos(a) * OrbitalPhysics.MAXDRAG, dy: Math.sin(a) * OrbitalPhysics.MAXDRAG };
      computePlan(); launch();
    });
    await waitFor(page, () => mode === 'fly' && probe.x > L.start.x + 40, { timeout: 30000 });
    await page.click('#btnReset');
    const mid = await page.evaluate(() => ({ mode, x: Math.round(probe.x), startX: L.start.x }));
    t.ok(mid.mode === 'fly' && mid.x > mid.startX + 40, 'a launched probe keeps flying',
      `${mid.mode}, x ${mid.x} of ${mid.startX}`);
    await waitFor(page, () => mode === 'done', { timeout: 60000, polling: 250 });
    t.ok(await onDisk(page) === '{"basics#0":1}',
      'and a second win at two attempts does not overwrite a better record',
      String(await onDisk(page)));
  });

  await section('Reset progress asks first', async () => {
    await boot(page, { 'basics#0': 1, 'basics#1': 3 });
    await begin(page);
    await openMap(page);

    const askedA = await answering(page, false, () => page.click('#btnWipe'));
    t.ok(askedA, 'the wipe button opens a confirm');
    t.ok(await onDisk(page) === '{"basics#0":1,"basics#1":3}',
      'and saying no leaves the save alone', String(await onDisk(page)));
    const kept = await cells(page);
    t.ok(kept[0].stars === '★★★' && !kept[2].locked, 'the grid is untouched');

    const askedB = await answering(page, true, () => page.click('#btnWipe'));
    t.ok(askedB, 'saying yes goes through the same confirm');
    t.ok(await onDisk(page) === '{}', 'the save is emptied, not deleted',
      String(await onDisk(page)));
    const wiped = await cells(page);
    t.ok(wiped.every(c => c.stars === ''), 'every star is gone from the grid without a reload');
    t.ok(wiped.slice(1).every(c => c.locked), 'and everything but the first sector relocks');
    const h = await hud(page);
    t.ok(h.stars === '☆☆☆', 'the HUD loses its stars too', h.stars);
    await shot(page, 'wiped');
  });

  await section('Clean', async () => {
    t.ok(page.__errs.length === 0, 'no page or console errors', page.__errs.slice(0, 3).join(' | '));
    const offsite = [...new Set(page.__blocked)];
    t.ok(offsite.length === 0, 'no offsite requests', offsite.slice(0, 3).join(' | '));
    // __blocked alone is not an offsite inventory: a Google Fonts request is
    // satisfied by the harness shim and never reaches it. Orbital vendors its
    // two families under Projects/orbital/fonts/, so this is empty too.
    const shimmed = [...new Set(page.__shimmed)];
    t.ok(shimmed.length === 0, 'and nothing was served by the font shim', shimmed.slice(0, 3).join(' | '));
  });
} catch (err) {
  failures++;
  console.log('\n  FAIL  the suite threw');
  console.log(err);
} finally {
  if (page) await page.close().catch(() => {});
  await browser.close().catch(() => {});
  srv.close();
}

console.log(`\n${checks - failures}/${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
