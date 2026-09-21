// node test/browser.mjs        (from Projects/signal-city, after
//                               npm ci --ignore-scripts in Tools/board-check)
//
// The page itself, headless, through the shared harness: the module graph
// loads, the level select shows, a level starts, the HUD follows the world,
// a keypress queues a phase and the clearance runs, the end card appears with
// stars, the sprite gallery draws eight rows. Screenshots land in
// test/shots/ (ignored by git) as evidence for the run.
//
// Nothing here is timed against wall clock (#53 does not reach it): the loop
// is fixed-step, and every "after N steps" below is __signalCity.step(N),
// which steps the world by hand while rAF only draws.
//
// Every page.evaluate takes one argument: puppeteer on Linux, playwright on
// Windows, and one argument is the shape both accept (see Orbital's suite).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from '../../../Tools/board-check/harness.mjs';
import { waitFor } from '../../../Tools/board-check/drive.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots');
const PORT = 8157; // see Tools/board-check/README.md for the ports already in use
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'signal_city_v1';

fs.mkdirSync(OUT, { recursive: true });

let checks = 0, failures = 0, shotN = 0;
const ok = (cond, label, detail = '') => {
  checks++;
  if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
};
async function section(name, fn) {
  console.log('\n' + name);
  try { await fn(); }
  catch (err) { checks++; failures++; console.log(`  FAIL  the section threw  ${err && err.message ? err.message : err}`); }
}
const shot = (page, label) => page.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${label}.png`) });

const server = await serve(PORT);
const browser = await launch();
try {
  const errors = [];
  const page = await prepPage(browser, BASE, { width: 1280, height: 900, dsf: 1 });
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await section('the page loads', async () => {
    await page.goto(`${BASE}/Projects/signal-city/?debug`, { waitUntil: 'load', timeout: 45000 });
    await waitFor(page, () => !!window.__signalCity, { timeout: 15000 });
    ok(true, 'main.js ran and exposed the debug hook');
    const sel = await page.evaluate(() => ({
      shown: document.getElementById('selectScrim').classList.contains('show'),
      cards: [...document.querySelectorAll('.level-card .lv-name')].map(e => e.textContent),
      stars: document.getElementById('starTotal').textContent,
    }));
    ok(sel.shown, 'the level select is up');
    ok(sel.cards.length === 2 && sel.cards[0] === 'First Light', 'with two cards, First Light first', sel.cards.join(', '));
    ok(sel.stars === '0 stars', 'and no stars yet', sel.stars);
    await shot(page, 'select');
    ok(errors.length === 0, 'no page errors so far', errors.join(' | '));
  });

  await section('First Light, played by hand', async () => {
    await page.click('.level-card[data-level="first-light"]');
    await waitFor(page, () => window.__signalCity.world && !document.getElementById('selectScrim').classList.contains('show'), { timeout: 5000 });
    const h0 = await page.evaluate(() => ({
      name: document.getElementById('levelName').textContent,
      phases: document.querySelectorAll('#phases .phase').length,
      clock: document.getElementById('clock').textContent,
      seed: window.__signalCity.world.seed,
    }));
    ok(h0.name === 'First Light' && h0.phases === 2, 'the HUD names the level and offers two phases', `${h0.name}, ${h0.phases} phases`);
    ok(h0.seed === 7, 'debug runs seed 7 so the run is repeatable', String(h0.seed));
    // pause the real-time loop and step by hand
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    await page.evaluate(n => window.__signalCity.step(n), 60 * 20);
    await new Promise(r => setTimeout(r, 300));      // let rAF draw and the HUD refresh
    const h1 = await page.evaluate(() => ({
      clock: document.getElementById('clock').textContent,
      onMap: window.__signalCity.world.cars.filter(c => !c.done).length,
      stage: document.getElementById('stage').textContent,
      green: document.querySelector('#phases .phase.green')?.dataset.phase,
    }));
    ok(h1.clock === '2:40' || h1.clock === '2:39', 'after 20 s of steps the clock reads 2:40 (2:39 if a frame ran before the pause)', h1.clock);
    ok(h1.onMap > 3, 'cars are on the map', String(h1.onMap));
    ok(h1.green === '0' && /N-S green/.test(h1.stage), 'phase 1 is green and the panel says so', h1.stage);
    await shot(page, 'first-light-20s');
    // press 2: yellow, all-red, then E-W green
    await page.keyboard.press('2');
    await new Promise(r => setTimeout(r, 100));
    const q = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, next: window.__signalCity.world.controller.next }));
    ok(q.stage === 'yellow' && q.next === 1, 'pressing 2 twenty seconds in goes yellow at once with E-W queued', `${q.stage}, next ${q.next}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 5);
    await new Promise(r => setTimeout(r, 300));
    const h2 = await page.evaluate(() => ({
      stage: window.__signalCity.world.controller.stage, phase: window.__signalCity.world.controller.phase,
      green: document.querySelector('#phases .phase.green')?.dataset.phase,
      heads: window.__signalCity.world.controller.snapshot().heads,
    }));
    ok(h2.stage === 'green' && h2.phase === 1 && h2.green === '1', 'five seconds later E-W is green on the panel', `${h2.stage} ${h2.phase} button ${h2.green}`);
    ok(h2.heads['E-T'] === 'green' && h2.heads['N-T'] === 'red', 'and the heads agree', `E-T ${h2.heads['E-T']}, N-T ${h2.heads['N-T']}`);
    // the canvas is not a flat colour: cars and roads drew
    const px = await page.evaluate(() => {
      const c = document.getElementById('board');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
      return seen.size;
    });
    ok(px > 12, 'the board has more than a dozen distinct colours in it', `${px}`);
    await shot(page, 'first-light-ew-green');
    // zoom in for a close look at the sprites on the road
    await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__signalCity.game.renderer.zoomBy(1.15); });
    await new Promise(r => setTimeout(r, 200));
    await shot(page, 'first-light-zoomed');
    await page.evaluate(() => { window.__signalCity.game.renderer.fit(window.__signalCity.world); });
    // run it out with a 22 s auto rule so the end card is reachable without a human
    await page.evaluate(() => { window.__signalCity.world.controller.rules = [{ when: 'elapsed', seconds: 22, then: 'next' }]; });
    for (let i = 0; i < 8; i++) await page.evaluate(n => window.__signalCity.step(n), 60 * 20);
    // the last step crosses duration inside the page's own loop, so unpause and wait for the card
    await page.evaluate(() => { window.__signalCity.game.paused = false; });
    await waitFor(page, () => document.getElementById('endScrim').classList.contains('show'), { timeout: 15000 });
    const end = await page.evaluate(() => ({
      title: document.getElementById('endTitle').textContent,
      stars: document.getElementById('endStars').textContent,
      body: document.getElementById('endBody').textContent,
      saved: localStorage.getItem('signal_city_v1'),
      result: window.__signalCity.game.result,
    }));
    ok(/Cleared/.test(end.body) && /Points/.test(end.body), 'the end card lists cleared and points');
    ok(end.stars.length === 3 && end.result.stars >= 1, 'it shows stars and the run survived', `${end.stars} (${end.result.cleared} cleared, ${end.result.collisions} collisions, wait ${end.result.avgWait.toFixed(0)} s)`);
    ok(end.saved && JSON.parse(end.saved).levels && JSON.parse(end.saved).levels['first-light'].stars === end.result.stars, 'and the save on disk carries those stars under signal_city_v1', end.saved && end.saved.slice(0, 80));
    await shot(page, 'end-card');
    ok(errors.length === 0, 'no page errors through the run', errors.join(' | '));
  });

  await section('Free Play and the priority corridor', async () => {
    await page.click('#levelsBtn');
    await page.click('.level-card[data-level="free-play"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'free-play', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    await page.evaluate(n => window.__signalCity.step(n), 60 * 62);
    await new Promise(r => setTimeout(r, 300));
    const e = await page.evaluate(() => {
      const w = window.__signalCity.world;
      const amb = w.cars.find(c => !c.done && c.archetype === 'emergency');
      const kinds = new Set(w.cars.filter(c => !c.done).map(c => c.archetype));
      return { amb: !!amb, priority: amb && amb.priority, btn: document.getElementById('priorityBtn').classList.contains('show'), kinds: [...kinds] };
    });
    ok(e.amb && !e.priority && e.btn, 'at 62 s the ambulance is on the map and the priority button shows');
    ok(e.kinds.length >= 4, 'several archetypes are driving', e.kinds.join(', '));
    await shot(page, 'free-play-ambulance');
    await page.keyboard.press('e');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 6);
    await new Promise(r => setTimeout(r, 300));
    const p = await page.evaluate(() => {
      const w = window.__signalCity.world;
      const amb = w.cars.find(c => c.archetype === 'emergency');
      return { priority: amb && amb.priority, stage: document.getElementById('stage').textContent, head: w.controller.head('W-T'), pre: !!w.controller.preemption };
    });
    ok(p.priority && p.pre, 'E calls the corridor');
    ok(/PRIORITY/.test(p.stage) && p.head === 'green', 'the panel says PRIORITY and the westbound head is green', `${p.stage}, W-T ${p.head}`);
    await shot(page, 'free-play-priority');
    ok(errors.length === 0, 'no page errors in free play', errors.join(' | '));
  });

  await section('the sprite gallery', async () => {
    await page.goto(`${BASE}/Projects/signal-city/sprites.html`, { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 800));
    const g = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      text: document.body.textContent,
      button: !!document.querySelector('button'),
    }));
    ok(g.canvases >= 8, 'the gallery drew at least eight canvases', String(g.canvases));
    ok(/STUDENT|student/i.test(g.text) && /trucker/i.test(g.text), 'and names the archetypes');
    ok(g.button, 'with a download button');
    await shot(page, 'sprites');
    ok(errors.length === 0, 'no page errors on the gallery', errors.join(' | '));
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
