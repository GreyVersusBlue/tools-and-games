// browser.mjs — Orbital's committed browser layer.
//
//   node Projects/orbital/test/browser.mjs [--only <part of a section's name>]
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

// `--only <text>` runs the sections whose name holds the text, for working on
// one. It is not a way to pass: CI runs the file bare.
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
if (ONLY) console.log(`--only "${ONLY}": every other section is skipped`);

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
  if (ONLY && !name.includes(ONLY)) return;
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

/* The atlas as it is on disk, read here and not out of the page, so a frame the
   game draws is held to the committed file and not to the game's copy of it. */
const ATLAS = JSON.parse(fs.readFileSync(path.join(HERE, '../assets/sprites/bodies.json'), 'utf8'));
const TAU = Math.PI * 2;
const sameAngle = (a, b) => { const d = (((a - b) % TAU) + TAU) % TAU; return Math.min(d, TAU - d) < 1e-6; };

/** Draw a shipped level's bodies once, at clock `ms`, and return what the
    canvas was asked for: every drawImage with the transform it ran under, and
    every glowCircle, in call order. It calls drawBody the way frame() does
    rather than waiting on a frame, so the log is one pass and the clock is the
    one named here. */
const drawn = (page, gi, ms) => page.evaluate(([gi, ms]) => {
  loadLevel(gi);
  const log = [], di = ctx.drawImage, gc = glowCircle;
  ctx.drawImage = function (img, sx, sy, sw, sh, dx, dy, dw, dh) {
    const m = ctx.getTransform();
    log.push({ what: 'frame', sheet: img === SPRITES.img, n: arguments.length,
      src: [sx, sy, sw, sh], dst: [dx, dy, dw, dh], at: [m.e, m.f], turn: Math.atan2(m.b, m.a) });
    return di.apply(ctx, arguments);
  };
  glowCircle = function (x, y, r) { log.push({ what: 'glow', x, y, r }); return gc.apply(null, arguments); };
  const posed = OrbitalPhysics.posBodies(bodies, 0);
  try { for (const b of posed) drawBody(b, ms); }
  finally { delete ctx.drawImage; glowCircle = gc; }
  return { log, view, reduced, name: L.name,
    bodies: posed.map(b => ({ type: b.type, x: b.x, y: b.y, r: b.r, dir: b.dir })) };
}, [gi, ms]);

const srv = await serve(PORT);
const browser = await launch();
let page;

try {
  // 1320x800 at dsf 1, the same view games.mjs frames Orbital in. dsf 2 doubles
  // the canvas and halves an already slow frame rate, so only the section
  // about device pixels opens a second page at 2 (#742). Everything else here
  // is independent of the ratio, and no assertion reads a pixel.
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
    t.ok(await onDisk(page) === '{"basics#0":1,"__v":2}', 'the save records the attempt count, not the stars',
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
    t.ok(await onDisk(page) === '{"basics#0":1,"__v":2}',
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
    t.ok(await onDisk(page) === '{"__v":2}', 'the save is emptied, not deleted',
      String(await onDisk(page)));
    const wiped = await cells(page);
    t.ok(wiped.every(c => c.stars === ''), 'every star is gone from the grid without a reload');
    t.ok(wiped.slice(1).every(c => c.locked), 'and everything but the first sector relocks');
    const h = await hud(page);
    t.ok(h.stars === '☆☆☆', 'the HUD loses its stars too', h.stars);
    await shot(page, 'wiped');
  });

  // The site's save bar (assets/js/gvb-save.js), Export and Import on the
  // sector map. The file never touches a disk here: the page's own download
  // and file-picker calls are caught on the way out and fed on the way in, so
  // what is read is the text the bar wrote and what is imported is that text.
  await section('The save bar: a file out, and the same file back', async () => {
    const OLD = fs.readFileSync(path.join(HERE, 'fixtures/progress-eb2806c.json'), 'utf8');
    // boot() would re-stringify it; the old build's bytes go in as they are.
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, OLD]);
    await page.reload({ waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btnStart');
    await begin(page);
    await page.keyboard.press('ArrowRight');   // a shot is aimed before the map goes up
    await openMap(page);
    const old = await cells(page);
    t.ok(old[0].stars === '★★★' && old[1].stars === '★☆☆' && old[9].stars === '★☆☆' && old[10].stars === '★★☆' && old[20].stars === '★★★',
      'a save from the build before the bar draws the stars it always did',
      [0, 1, 9, 10, 20].map(i => old[i].stars).join(' '));
    t.ok(await onDisk(page) === OLD, 'and loading it writes nothing', String(await onDisk(page)));

    const bar = await page.evaluate(() => {
      const el = document.getElementById('saveBar');
      return { role: el.getAttribute('role'), name: el.getAttribute('aria-label'),
        buttons: [...el.querySelectorAll('button')].map(b => `${b.dataset.gvb}:${b.textContent}:${b.title ? 'titled' : 'bare'}:${b.tabIndex}`).join(' | '),
        live: el.querySelector('.gvb-save-msg').getAttribute('aria-live') };
    });
    t.ok(bar.role === 'group' && bar.name === 'Save file', 'the bar is a named group', `${bar.role} "${bar.name}"`);
    t.ok(bar.buttons === 'export:Export save:titled:0 | import:Import save:titled:0',
      'holding Export and Import and no second wipe button', bar.buttons);
    t.ok(bar.live === 'polite', 'and what it says is read out');

    // Catch the download: the bar makes a Blob and clicks a link to it.
    await page.evaluate(() => {
      window.__blobs = [];
      const make = URL.createObjectURL;
      URL.createObjectURL = b => { window.__blobs.push(b); return make.call(URL, b); };
    });
    // By keyboard: Space on the focused button. Until the sector map took the
    // keys, the game's own handler swallowed it, so the button never fired, and
    // launched the shot aimed above from behind the map.
    await page.focus('#saveBar [data-gvb="export"]');
    await page.keyboard.press('Space');
    // The download is synchronous inside the click, so by the next evaluate it
    // has happened or it never will.
    const key = await page.evaluate(() => ({
      files: window.__blobs.length, said: document.querySelector('#saveBar .gvb-save-msg').textContent, mode, attempts,
    }));
    t.ok(key.files === 1 && /^Saved to orbital-save-\d{4}-\d\d-\d\d\.json$/.test(key.said),
      'Space on Export downloads the save and says so', `${key.files} file, "${key.said}"`);
    t.ok(key.mode === 'aim' && key.attempts === 0, 'and launches nothing behind the map', `${key.mode}, ${key.attempts} attempts`);
    if (!key.files) await page.click('#saveBar [data-gvb="export"]');   // the rest reads the file either way
    const out = await page.evaluate(async () => ({ text: await window.__blobs[0].text() }));
    const env = JSON.parse(out.text);
    t.ok(env.format === 'gvb-save' && env.game === 'orbital' && env.version === 2 && JSON.stringify(env.state) === OLD,
      'the file holds the campaign, key for key', JSON.stringify(env.state));

    // Wipe, then bring the file back through the picker the bar opens.
    await answering(page, true, () => page.click('#btnWipe'));
    t.ok(await onDisk(page) === '{"__v":2}' && (await cells(page)).every(c => c.stars === ''), 'wiped, the map is bare');
    const feed = text => page.evaluate(text => {
      const click = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return click.call(this);
        HTMLInputElement.prototype.click = click;
        const dt = new DataTransfer();
        dt.items.add(new File([text], 'orbital-save.json', { type: 'application/json' }));
        this.files = dt.files;
        this.dispatchEvent(new Event('change'));
      };
    }, text);
    const said = () => page.evaluate(() => document.querySelector('#saveBar .gvb-save-msg').textContent);
    await feed(out.text);
    await page.focus('#saveBar [data-gvb="import"]');
    await page.keyboard.press('Enter');
    await waitFor(page, () => document.querySelector('#saveBar .gvb-save-msg').textContent === 'Save loaded.', { timeout: 5000 });
    const back = await cells(page);
    t.ok(JSON.stringify(back) === JSON.stringify(old), 'Enter on Import puts every star and every lock back without a reload');
    t.ok(await onDisk(page) === OLD.slice(0, -1) + ',"__v":2}', 'and the save on disk is the old one plus the version stamp',
      String(await onDisk(page)));
    await page.reload({ waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btnStart');
    await begin(page);
    await openMap(page);
    t.ok(JSON.stringify(await cells(page)) === JSON.stringify(old), 'which a reload reads back to the same map');

    // A file that is not an Orbital save changes nothing and says why.
    const before = await onDisk(page);
    await feed(JSON.stringify({ format: 'gvb-save', game: 'signal-city', version: 1, state: { 'basics#3': 1 } }));
    await page.click('#saveBar [data-gvb="import"]');
    await waitFor(page, () => /not a valid orbital save/.test(document.querySelector('#saveBar .gvb-save-msg').textContent), { timeout: 5000 });
    t.ok(await onDisk(page) === before && JSON.stringify(await cells(page)) === JSON.stringify(old),
      "another game's file is refused, and the campaign is as it was", await said());
    await shot(page, 'save-bar');
  });

  await section('The body sheet is what draws a body', async () => {
    await boot(page, null);
    await waitFor(page, () => SPRITES.atlas !== null, { timeout: 10000 });
    const sheet = await page.evaluate(() => ({
      w: SPRITES.img.naturalWidth, h: SPRITES.img.naturalHeight,
      frames: Object.keys(SPRITES.atlas).sort().join(' '), types: Object.keys(COLOR).sort().join(' '),
    }));
    t.ok(sheet.w === 1024 && sheet.h === 512, 'the sheet is loaded', `${sheet.w} x ${sheet.h}`);
    t.ok(sheet.frames === Object.keys(ATLAS).sort().join(' ') && sheet.frames === sheet.types,
      'and its atlas has a frame for every body type', sheet.frames);

    // The Gauntlet (star, planet, repulse, rock) and Deep Field (black hole,
    // planet, booster, two wormholes) between them hold all seven types.
    const CLOCK = 1234;
    const seen = new Set();
    let frames = 0, bodies = 0, fromSheet = true, boxed = true, sized = true, placed = true;
    let turned = true, glowLast = true, holesFirst = true, holes = 0, detail = '';
    for (const gi of [9, 21]) {
      const d = await drawn(page, gi, CLOCK);
      const spin = d.reduced ? 0 : CLOCK * 0.001;
      const draws = d.log.filter(e => e.what === 'frame');
      frames += draws.length; bodies += d.bodies.length;
      d.bodies.forEach((b, i) => {
        const e = draws[i], f = ATLAS[b.type];
        if (!e) return;
        seen.add(b.type);
        const say = why => { if (!detail) detail = `${d.name}, ${b.type}: ${why}`; };
        if (!e.sheet || e.n !== 9) { fromSheet = false; say('not a nine-argument drawImage of the sheet'); }
        if (e.src.join() !== [f.x, f.y, f.w, f.h].join()) { boxed = false; say(`source ${e.src.join()}`); }
        // (b.r * view.s) / r, #718: the frame's r lands on the body's radius.
        const R = e.dst[2] / f.w * f.r;
        if (Math.abs(R - b.r * d.view.s) > 1e-6 || Math.abs(e.dst[2] / f.w - e.dst[3] / f.h) > 1e-9) {
          sized = false; say(`radius ${R.toFixed(3)} against ${(b.r * d.view.s).toFixed(3)}`);
        }
        // About the anchor: the frame's (ax, ay) sits on the body's centre.
        const k = e.dst[2] / f.w;
        const cx = d.view.ox + b.x * d.view.s, cy = d.view.oy + b.y * d.view.s;
        if (Math.hypot(e.at[0] - cx, e.at[1] - cy) > 1e-6 ||
            Math.abs(e.dst[0] + f.ax * k) > 1e-6 || Math.abs(e.dst[1] + f.ay * k) > 1e-6) {
          placed = false;
          say(`origin ${e.at.map(v => v.toFixed(2)).join()} against ${cx.toFixed(2)},${cy.toFixed(2)}, ` +
            `corner ${e.dst[0].toFixed(2)},${e.dst[1].toFixed(2)} against ${(-f.ax * k).toFixed(2)},${(-f.ay * k).toFixed(2)}`);
        }
        // drawBody's own turns before the sheet: the accretion rings at twice
        // the clock, the wormhole's dashes at three times, the booster along dir.
        const want = b.type === 'blackhole' ? spin * 2 : b.type === 'wormhole' ? spin * 3
                   : b.type === 'booster' ? b.dir : 0;
        if (!sameAngle(e.turn, want)) { turned = false; say(`turned ${e.turn.toFixed(4)} against ${want.toFixed(4)}`); }
        // Glow over the frame, the black hole's and the wormhole's under it (#736).
        const at = d.log.indexOf(e);
        const glow = d.log.findIndex(g => g.what === 'glow' && g.x === b.x && g.y === b.y && g.r === b.r);
        if (b.type === 'blackhole' || b.type === 'wormhole') {
          holes++;
          if (!(glow >= 0 && glow < at)) { holesFirst = false; say(`${b.type} glow at call ${glow}, frame at ${at}`); }
        }
        else if (!(glow > at)) { glowLast = false; say(`glow at call ${glow}, frame at ${at}`); }
      });
    }
    t.ok(frames === bodies && bodies === 9, 'every body in two shipped levels is one drawImage',
      `${frames} frames for ${bodies} bodies`);
    t.ok(seen.size === 7, 'and the two levels cover all seven types', [...seen].join(' '));
    t.ok(fromSheet, 'each one is a frame cut from the sheet', detail);
    t.ok(boxed, 'from its own box in the atlas on disk', detail);
    t.ok(sized, 'scaled so the frame\'s r lands on the body\'s radius', detail);
    t.ok(placed, 'with its anchor on the body\'s centre', detail);
    t.ok(turned, 'turned by the clock or by dir where the drawing used to turn', detail);
    t.ok(glowLast, 'with the glow drawn over it', detail);
    t.ok(holes === 3 && holesFirst, 'except the black hole and the wormhole, whose glow stays behind', `${holes} dark cores, glow first: ${holesFirst}${detail ? '; ' + detail : ''}`);
    await begin(page);
    await page.evaluate(() => loadLevel(21));
    await new Promise(r => setTimeout(r, 1500));
    await shot(page, 'bodies');
  });

  await section('At a device pixel ratio of 2 the playfield fills the canvas', async () => {
    // The page drew the field in CSS pixels on a canvas sized in device pixels,
    // so at 2 everything landed in the top left quarter (#742). Nothing here
    // recomputes view: the world's centre has to land on the canvas's centre,
    // its corners inside the canvas and touching it on one axis, and the
    // editor's hit test has to find a body where the canvas drew it.
    const p2 = await prepPage(browser, BASE, { width: 1320, height: 800, dsf: 2 });
    try {
      await p2.goto(BASE + PAGE_URL, { waitUntil: 'load', timeout: 45000 });
      await boot(p2, null);
      await waitFor(p2, () => SPRITES.atlas !== null, { timeout: 10000 });
      const g = await p2.evaluate(() => {
        const [cx, cy] = W2S(W / 2, H / 2), [x0, y0] = W2S(0, 0), [x1, y1] = W2S(W, H);
        return { dpr: DPR, cw: cv.width, ch: cv.height, cx, cy, x0, y0, x1, y1 };
      });
      t.ok(g.dpr === 2 && g.cw === 2640 && g.ch === 1600, 'the canvas is 2640 x 1600 for a 1320 x 800 window',
        `dpr ${g.dpr}, ${g.cw} x ${g.ch}`);
      t.ok(Math.abs(g.cx - g.cw / 2) < 1 && Math.abs(g.cy - g.ch / 2) < 1,
        'the world\'s centre lands on the canvas\'s centre',
        `${g.cx.toFixed(1)},${g.cy.toFixed(1)} against ${g.cw / 2},${g.ch / 2}`);
      const inside = g.x0 >= -0.5 && g.y0 >= -0.5 && g.x1 <= g.cw + 0.5 && g.y1 <= g.ch + 0.5;
      const fits = Math.abs(g.x1 - g.x0 - g.cw) < 1 || Math.abs(g.y1 - g.y0 - g.ch) < 1;
      t.ok(inside && fits, 'its corners are inside the canvas and the field fills it on one axis',
        `${g.x0.toFixed(0)},${g.y0.toFixed(0)} to ${g.x1.toFixed(0)},${g.y1.toFixed(0)} of ${g.cw} x ${g.ch}`);

      // The editor, on a shipped level, with the bodies drawn once and each
      // centre read off the transform drawImage ran under.
      await p2.evaluate(() => edEnter(JSON.parse(JSON.stringify(LEVELS[21]))));
      const at = await p2.evaluate(() => {
        const out = [], di = ctx.drawImage;
        ctx.drawImage = function () { const m = ctx.getTransform(); out.push([m.e, m.f]); return di.apply(ctx, arguments); };
        try { for (const b of OrbitalPhysics.posBodies(bodies, 0)) drawBody(b, 0); }
        finally { delete ctx.drawImage; }
        return out;
      });
      t.ok(at.length === 5, 'the editor draws the five bodies of Deep Field', `${at.length} drawn`);
      let hits = 0, detail = '';
      for (let i = 0; i < at.length; i++) {
        await p2.evaluate(() => edSelect(null));
        await p2.mouse.click(at[i][0] / 2, at[i][1] / 2);
        const got = await p2.evaluate(() => edSel && edSel.kind === 'body' ? bodies.indexOf(edSel.body) : -1);
        if (got === i) hits++; else if (!detail) detail = `a click on body ${i} selected ${got}`;
      }
      t.ok(hits === at.length, 'a click where the canvas drew each body selects that body',
        detail || `${hits} of ${at.length}`);
      await shot(p2, 'dsf2-editor');
    } finally { await p2.close().catch(() => {}); }
  });

  await section('The editor\'s Check counts the launches that win', async () => {
    // #877. After the verdict the Check flies the generator's census of the
    // same draft and prints its share. The two Slingshot figures are the
    // literals test/generator.mjs pins on the same census in Node; nothing
    // here counts a win. What only a page can say is that the line is there,
    // that it moves with the draft, and that the tab is alive while it counts.
    // "Alive" is not a duration (#53): it is a click handled between two
    // slices, and 1,200 separate steps where one call would have been none.
    await boot(page, null);
    await begin(page);
    /* Arms a run: logs every text the status line holds, counts and times the
       steps the Check asks OrbitalGen.makeCensus for, and at the first
       "Counting" does `mid` from a timer of its own, between two slices. */
    const arm = mid => page.evaluate(mid => {
      const el = document.getElementById('edStatus');
      const w = window.__cen = { texts: [], steps: 0, longest: 0, mid: null };
      const state = () => ({ status: el.textContent, running: edSearch !== null, tool: edTool,
        btn: document.getElementById('edCheck').textContent });
      const act = {
        click: () => document.querySelector('.ed-tool[data-tool="planet"]').click(),
        edit: () => { const i = document.querySelector('#edInsp input[aria-label="Radius"]');
          i.value = '60'; i.dispatchEvent(new Event('input', { bubbles: true })); },
      }[mid];
      if (window.__cenObs) window.__cenObs.disconnect();
      window.__cenObs = new MutationObserver(() => {
        const s = el.textContent;
        if (w.texts[w.texts.length - 1] !== s) w.texts.push(s);
        if (act && !w.armed && /Counting/.test(s)) { w.armed = true; setTimeout(() => { act(); w.mid = state(); }, 0); }
      });
      window.__cenObs.observe(el, { childList: true, characterData: true, subtree: true });
      if (!OrbitalGen.__raw) {
        OrbitalGen.__raw = OrbitalGen.makeCensus;
        OrbitalGen.makeCensus = lv => {
          const c = OrbitalGen.__raw(lv);
          return { step(n) {
            const t0 = performance.now(), r = c.step(n), d = performance.now() - t0;
            window.__cen.steps++; if (d > window.__cen.longest) window.__cen.longest = d;
            return r;
          } };
        };
      }
    }, mid);
    const check = async () => {
      await page.click('#edCheck');
      await waitFor(page, () => edSearch === null, { timeout: 120000, polling: 100 });
      return page.evaluate(() => ({ ...window.__cen, text: document.getElementById('edStatus').textContent,
        cls: document.getElementById('edStatus').className, btn: document.getElementById('edCheck').textContent }));
    };
    const VERDICT = /^Winnable: \d+° at \d+% power, found in \d+ trial launches\./;
    const counting = r => r.texts.filter(s => /Counting how many launches win… \d+%$/.test(s));

    // Slingshot as it ships, with a click on a tool while the census runs.
    await page.evaluate(() => edEnter(JSON.parse(JSON.stringify(LEVELS[2]))));
    await arm('click');
    const a = await check();
    t.ok(VERDICT.test(a.text) && a.text.endsWith(' 1.4% of launches win (17 of 1,200).'),
      'Slingshot reads its verdict and then 1.4%, 17 of 1,200', a.text);
    t.ok(a.cls === 'ed-status good' && a.btn === 'Check', 'in the good colour, with the button back to Check',
      `${a.cls}, ${a.btn}`);
    const ca = counting(a);
    t.ok(ca.length > 0 && ca.every(s => VERDICT.test(s) && s.startsWith(a.text.slice(0, a.text.indexOf(' 1.4%')))),
      'the verdict is on the line while the census counts', ca[0] || a.texts.join(' | ').slice(0, 200));
    t.ok(ca.length >= 3, 'and the count is shown moving, in slices', `${ca.length} different progress lines`);
    t.ok(a.steps === 1200, 'it is the generator\'s census, one launch a step', `${a.steps} steps, longest ${a.longest.toFixed(1)} ms`);
    t.ok(a.mid && a.mid.tool === 'planet' && a.mid.running && a.mid.btn === 'Cancel',
      'a click on a tool lands while it is still counting', JSON.stringify(a.mid));

    // The same draft with its marker widened from 40 to 60 on the slider.
    await page.evaluate(() => edSelect({ kind: 'goal' }));
    await arm(null);
    const r60 = await page.evaluate(() => { const i = document.querySelector('#edInsp input[aria-label="Radius"]');
      i.value = '60'; i.dispatchEvent(new Event('input', { bubbles: true })); return L.goal.r; });
    const b = await check();
    t.ok(r60 === 60 && b.text.endsWith(' 2.4% of launches win (29 of 1,200).'),
      'a wider marker reads 2.4%, 29 of 1,200', `marker ${r60}: ${b.text}`);
    await shot(page, 'check-census');

    // An edit while it counts stops the count and says so. Clockwork's census
    // is the longest of the 22 (4.5 s in Node), so there is room to land one.
    await page.evaluate(() => { edEnter(JSON.parse(JSON.stringify(LEVELS[7]))); edSelect({ kind: 'goal' }); });
    await arm('edit');
    const c = await check();
    await new Promise(r => setTimeout(r, 400));
    const late = await page.evaluate(() => document.getElementById('edStatus').textContent);
    t.ok(c.mid && !c.mid.running && c.mid.btn === 'Check' &&
      c.mid.status === 'The draft changed, so the Check stopped. Check again.',
      'an edit mid-count stops the Check and says why', JSON.stringify(c.mid));
    t.ok(!!c.mid && late === c.mid.status && c.steps < 1200, 'and no figure for the old draft arrives after it',
      `${c.steps} steps flown, then "${late}"`);

    // Unwinnable: the search spends its budget and the census is not flown.
    await page.evaluate(() => edEnter(OrbitalCode.decode('o1$Walled$$120,300$880,300,44$k,245,300,120,0')));
    await arm(null);
    const d = await check();
    t.ok(/^No winning shot in \d+ trial launches\./.test(d.text) &&
      d.text.endsWith(' No census: its 1,200 launches are among those.') && d.cls === 'ed-status bad',
      'a draft with no winning shot says the census was not flown', d.text);
    t.ok(d.steps === 0 && counting(d).length === 0, 'and does not fly it', `${d.steps} steps`);

    // Winnable on an angle the census skips: a found shot beside a zero.
    await page.evaluate(() => edEnter(OrbitalCode.decode('o1$Narrow$$100,300$950,322,20$')));
    await arm(null);
    const e = await check();
    t.ok(VERDICT.test(e.text) && e.cls === 'ed-status good' &&
      e.text.endsWith(' None of the census\'s 1,200 launches win, though: the window is narrower than its grid.'),
      'a shot the census never finds reads as winnable with none of 1,200', e.text);
    t.ok(e.steps === 1200, 'after flying all of it', `${e.steps} steps, longest ${e.longest.toFixed(1)} ms`);
    await page.evaluate(() => { window.__cenObs.disconnect(); OrbitalGen.makeCensus = OrbitalGen.__raw; edLeave(); });
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

  // After Clean, because this one is supposed to put an error on the console.
  await section('A sheet that will not load stops the game and says so', async () => {
    // The real loader and the real failure path against a real 404, run a
    // second time on a page whose own sheet loaded. The loop is already
    // running here, so the boot order is the next section's.
    await boot(page, null);
    await waitFor(page, () => SPRITES.atlas !== null, { timeout: 10000 });
    const errsBefore = page.__errs.length;
    await page.evaluate(() => { SPRITES.src = 'assets/sprites/missing'; return startFrames(); });
    const s = await page.evaluate(() => {
      const el = document.getElementById('linkErr');
      return { hidden: el.hidden, text: el.textContent,
        intro: document.getElementById('introScrim').classList.contains('show'),
        begin: document.getElementById('btnStart').disabled };
    });
    t.ok(!s.hidden && /assets\/sprites\/missing\.(png|json)/.test(s.text),
      'the intro card names the file that did not load', s.text);
    t.ok(s.intro && s.begin, 'and its Begin button is off', `intro ${s.intro}, disabled ${s.begin}`);
    const said = page.__errs.slice(errsBefore).filter(e => /Orbital: assets\/sprites\/missing/.test(e));
    t.ok(said.length === 1, 'the console gets the same reason once', page.__errs.slice(errsBefore).join(' | ').slice(0, 200));
    await shot(page, 'no-sheet');
  });

  await section('No frame is drawn before the sheet arrives', async () => {
    // A level with bodies in the link, so a frame drawn early would have
    // something to draw, and the atlas held back by hand so "early" is not a
    // race: the fetch waits on __release() and every requestAnimationFrame is
    // counted. Both engines take an init script, under two names.
    const code = await page.evaluate(() => OrbitalCode.encode(LEVELS[9]));
    const hold = () => {
      let release;
      const gate = new Promise(r => { release = r; });
      const f = window.fetch.bind(window), raf = window.requestAnimationFrame.bind(window);
      window.__release = release; window.__rafs = 0;
      window.fetch = (u, o) => /bodies\.json/.test(String(u)) ? gate.then(() => f(u, o)) : f(u, o);
      window.requestAnimationFrame = cb => { window.__rafs++; return raf(cb); };
    };
    if (page.evaluateOnNewDocument) await page.evaluateOnNewDocument(hold);
    else await page.addInitScript(hold);
    const errsBefore = page.__errs.length;
    await page.goto(BASE + PAGE_URL + '#l=' + code, { waitUntil: 'load', timeout: 45000 });
    await page.reload({ waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#btnStart');
    const held = await page.evaluate(() =>
      ({ bodies: bodies.length, atlas: SPRITES.atlas !== null, rafs: window.__rafs }));
    t.ok(held.bodies === 4, 'the linked level is up, with bodies to draw', `${held.bodies} bodies`);
    t.ok(!held.atlas && held.rafs === 0, 'and with the atlas held back no frame has been asked for',
      `atlas ${held.atlas}, ${held.rafs} requestAnimationFrame calls`);
    await page.evaluate(() => window.__release());
    await waitFor(page, () => SPRITES.atlas !== null && window.__rafs > 1, { timeout: 10000 });
    t.ok(page.__errs.length === errsBefore, 'the loop starts when it arrives, with no error on the way',
      page.__errs.slice(errsBefore, errsBefore + 3).join(' | '));
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
