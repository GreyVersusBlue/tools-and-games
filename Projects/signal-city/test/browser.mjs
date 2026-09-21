// node test/browser.mjs        (from Projects/signal-city, after
//                               npm ci --ignore-scripts in Tools/board-check)
//
// The page itself, headless, through the shared harness: the module graph
// loads, the level select shows, a level starts, the HUD follows the world,
// a keypress queues a phase and the clearance runs, the rule panel adds the
// elapsed rule that runs level 1 out, the end card appears with stars, the
// Stem's all-red slider reaches the controller, Four Ways offers four phases
// with arrow heads and drops to flashing red and back, the sprite gallery
// draws eight rows. Screenshots land in test/shots/ (ignored by git) as
// evidence for the run.
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
    ok(sel.cards.length === 4 && sel.cards.join() === 'First Light,Stem,Four Ways,Free Play', 'with four cards, First Light first and Free Play last', sel.cards.join(', '));
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
    const panel = await page.evaluate(() => ({
      rules: !document.getElementById('rulesBox').classList.contains('hidden'),
      timing: document.getElementById('timingBox').classList.contains('hidden'),
      flash: document.getElementById('flashBox').classList.contains('hidden'),
      empty: document.querySelector('#rules .empty')?.textContent || '',
    }));
    ok(panel.rules && panel.timing && panel.flash, 'level 1 unlocks the phases and the rule panel, not the sliders or the flash buttons');
    ok(/No rules/.test(panel.empty), 'and its rule list starts empty', panel.empty);
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
    // run it out with a 22 s elapsed rule added through the panel, so the end
    // card is reachable without a human: level 1's "auto" is this panel with
    // one row in it
    await page.click('#addElapsedBtn');
    const added = await page.evaluate(() => ({ rows: document.querySelectorAll('#rules .rule').length, rules: JSON.stringify(window.__signalCity.world.controller.rules) }));
    ok(added.rows === 1 && /"when":"elapsed"/.test(added.rules) && /"seconds":20/.test(added.rules), 'the add button puts one elapsed rule in the panel and in the controller', added.rules);
    await page.evaluate(() => { const n = document.querySelector('#rules .rule input.seconds'); n.value = '22'; n.dispatchEvent(new Event('change', { bubbles: true })); });
    const edited = await page.evaluate(() => JSON.stringify(window.__signalCity.world.controller.rules));
    ok(/"seconds":22/.test(edited), 'editing the seconds field reaches the controller', edited);
    await page.click('#addQueueBtn');
    const qr = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#rules .rule')].map(r => r.className),
      badge: document.querySelector('#rules .rule.sleeping .badge')?.textContent || '',
      rules: window.__signalCity.world.controller.rules.map(r => r.when).join(','),
    }));
    ok(qr.rows.length === 2 && qr.rows[1] === 'rule sleeping' && /needs sensors \(M6\)/.test(qr.badge), 'a queue rule shows greyed with "needs sensors (M6)"', `${qr.rows.join(' | ')} ${qr.badge}`);
    await page.click('#rules .rule.sleeping .up');
    const moved = await page.evaluate(() => window.__signalCity.world.controller.rules.map(r => r.when).join(','));
    ok(moved === 'queue,elapsed', 'the up button reorders the list in the controller', moved);
    await page.click('#rules .rule.sleeping .remove');
    const left = await page.evaluate(() => window.__signalCity.world.controller.rules.map(r => `${r.when}:${r.seconds}`).join(','));
    ok(left === 'elapsed:22', 'and remove takes it out again, leaving the 22 s rule', left);
    await shot(page, 'first-light-rules');
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

  await section('Stem and the all-red slider', async () => {
    await page.click('#levelsBtn');
    await page.click('.level-card[data-level="stem"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'stem', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const s0 = await page.evaluate(() => ({
      legs: window.__signalCity.world.network.legs.join(''),
      phases: [...document.querySelectorAll('#phases .phase .name')].map(e => e.textContent),
      timing: !document.getElementById('timingBox').classList.contains('hidden'),
      flash: document.getElementById('flashBox').classList.contains('hidden'),
      allRed: window.__signalCity.world.controller.timing.allRed,
      label: document.getElementById('allRedVal').textContent,
    }));
    ok(s0.legs === 'NES' && s0.phases.length === 2, 'the Stem is a T with a main phase and a stem phase', `${s0.legs}: ${s0.phases.join(', ')}`);
    ok(s0.timing && s0.flash, 'it unlocks the sliders and not the flash buttons');
    ok(s0.allRed === 1 && s0.label === '1.0 s', 'the all-red starts at 1 s and the label says so', s0.label);
    await page.evaluate(() => { const r = document.getElementById('allRedRange'); r.value = '2.5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
    const s1 = await page.evaluate(() => ({ allRed: window.__signalCity.world.controller.timing.allRed, label: document.getElementById('allRedVal').textContent, yellow: window.__signalCity.world.controller.timing.yellow }));
    ok(s1.allRed === 2.5 && s1.label === '2.5 s' && s1.yellow === 3, 'dragging the slider to 2.5 reaches Controller.setTiming and leaves the yellow alone', `${s1.allRed} ${s1.label} yellow ${s1.yellow}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 5);
    await page.keyboard.press('2');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 3.5);
    const s2 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, stageT: window.__signalCity.world.controller.stageT }));
    ok(s2.stage === 'allred', '3.5 s after pressing 2 the clearance is in its all-red', `${s2.stage} at ${s2.stageT.toFixed(2)} s`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 1.5);
    const s3 = await page.evaluate(() => window.__signalCity.world.controller.stage);
    ok(s3 === 'allred', 'and still is 1.5 s later, because the slider said 2.5', s3);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 1.2);
    const s4 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, phase: window.__signalCity.world.controller.phase }));
    ok(s4.stage === 'green' && s4.phase === 1, 'then the stem is green', `${s4.stage} ${s4.phase}`);
    await shot(page, 'stem');
    ok(errors.length === 0, 'no page errors on the Stem', errors.join(' | '));
  });

  await section('Four Ways: protected lefts and flashing', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="four-ways"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'four-ways', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const f0 = await page.evaluate(() => ({
      lanes: window.__signalCity.world.network.lanesPerDir,
      phases: [...document.querySelectorAll('#phases .phase .name')].map(e => e.textContent),
      flash: !document.getElementById('flashBox').classList.contains('hidden'),
      note: !document.getElementById('leftsNote').classList.contains('hidden'),
      heads: window.__signalCity.world.controller.snapshot().heads,
    }));
    ok(f0.lanes === 2 && f0.phases.join() === 'N-S,N-S lefts,E-W,E-W lefts', 'two lanes each way and four phases, lefts between the throughs', f0.phases.join(', '));
    ok(f0.flash && f0.note, 'it unlocks the flash buttons and says the lefts are protected');
    ok(f0.heads['N-T'] === 'green' && f0.heads['N-L'] === 'red', 'on the N-S phase the through is green and the left arrow is red', `N-T ${f0.heads['N-T']}, N-L ${f0.heads['N-L']}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 6);
    await page.keyboard.press('2');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 5);
    const f1 = await page.evaluate(() => ({ phase: window.__signalCity.world.controller.phase, stage: window.__signalCity.world.controller.stage, heads: window.__signalCity.world.controller.snapshot().heads }));
    ok(f1.phase === 1 && f1.stage === 'green' && f1.heads['N-L'] === 'green-arrow' && f1.heads['S-L'] === 'green-arrow' && f1.heads['N-T'] === 'red', 'pressing 2 brings the lefts phase: green arrows on N-L and S-L, the throughs red', `${f1.stage} ${f1.phase}: N-L ${f1.heads['N-L']}, N-T ${f1.heads['N-T']}`);
    await new Promise(r => setTimeout(r, 300));
    await shot(page, 'four-ways-lefts');
    await page.click('#flashRedBtn');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 8);
    await new Promise(r => setTimeout(r, 300));
    const f2 = await page.evaluate(() => {
      const w = window.__signalCity.world;
      const stopped = w.cars.filter(c => !c.done && c.stoppedAtLine).length;
      return { stage: w.controller.stage, heads: w.controller.snapshot().heads, text: document.getElementById('stage').textContent, on: document.getElementById('flashRedBtn').classList.contains('on'), stopped, onMap: w.cars.filter(c => !c.done).length };
    });
    ok(f2.stage === 'flash' && f2.heads['N-T'] === 'flash-red' && f2.heads['E-L'] === 'flash-red', 'Flash red puts every head on flashing red', `${f2.stage}: N-T ${f2.heads['N-T']}, E-L ${f2.heads['E-L']}`);
    ok(/four-way stop/.test(f2.text) && f2.on, 'the panel says four-way stop and the button lights', f2.text);
    ok(f2.stopped >= 1, 'and after 8 s at least one car has stopped at its line', `${f2.stopped} of ${f2.onMap}`);
    await shot(page, 'four-ways-flash-red');
    await page.click('#flashYellowBtn');
    const f3 = await page.evaluate(() => window.__signalCity.world.controller.snapshot().heads);
    ok(f3['N-T'] === 'flash-yellow' && f3['S-L'] === 'flash-yellow' && f3['E-T'] === 'flash-red', 'Flash yellow: the main road flashes yellow, the cross street red', `N-T ${f3['N-T']}, E-T ${f3['E-T']}`);
    await page.click('#signalsBtn');
    const f4 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, next: window.__signalCity.world.controller.next }));
    ok(f4.stage === 'allred' && f4.next === 1, 'Signals goes back through an all-red to the phase that was running', `${f4.stage} next ${f4.next}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 2);
    const f5 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, phase: window.__signalCity.world.controller.phase, on: document.getElementById('signalsBtn').classList.contains('on') }));
    ok(f5.stage === 'green' && f5.phase === 1 && f5.on, 'and 2 s later the lefts are green again', `${f5.stage} ${f5.phase}`);
    ok(errors.length === 0, 'no page errors on Four Ways', errors.join(' | '));
  });

  await section('Free Play and the priority corridor', async () => {
    await page.keyboard.press('Escape');
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
