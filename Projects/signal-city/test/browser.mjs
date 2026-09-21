// node test/browser.mjs        (from Projects/signal-city, after
//                               npm ci --ignore-scripts in Tools/board-check)
//
// The page itself, headless, through the shared harness: the module graph
// loads, the level select shows, a level starts, the HUD follows the world,
// a keypress queues a phase and the clearance runs, the rule panel adds the
// elapsed rule that runs level 1 out, the end card appears with stars, the
// Stem's all-red slider reaches the controller, Four Ways offers four phases
// with arrow heads and drops to flashing red and back, Crossing takes a
// pedestrian call and walks it with the loops live, Two Blocks shows two
// boxes and drives the one the panel selects, its offset slider moves the
// east box through a yellow and not a jump while the platoon diagram draws,
// Rush Hour's surge, outage and ambulance clock reach the event line and
// the box (M7), the sprite gallery draws eight rows. Screenshots land in test/shots/ (ignored by git) as evidence
// for the run.
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
    ok(sel.cards.length === 7 && sel.cards.join() === 'First Light,Stem,Four Ways,Crossing,Two Blocks,Rush Hour,Free Play', 'with seven cards, First Light first and Free Play last', sel.cards.join(', '));
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
    ok(qr.rows.length === 2 && qr.rows[1] === 'rule sleeping' && /needs sensors/.test(qr.badge), 'a queue rule on a level without sensors shows greyed with "needs sensors"', `${qr.rows.join(' | ')} ${qr.badge}`);
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

  await section('Crossing: a call, a walk, and the loops live', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="crossing"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'crossing', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const c0 = await page.evaluate(() => ({
      phases: [...document.querySelectorAll('#phases .phase .name')].map(e => e.textContent),
      walks: window.__signalCity.world.controller.phases.map(p => p.walks.join('+')),
      peds: !document.getElementById('pedsBox').classList.contains('hidden'),
      sensorsNote: !document.getElementById('sensorsNote').classList.contains('hidden'),
      calls: [...document.querySelectorAll('#calls .call')].map(b => b.dataset.leg),
      rows: [...document.querySelectorAll('#rules .rule')].map(r => r.className),
      badge: document.querySelector('#rules .badge')?.textContent || '',
      sensors: window.__signalCity.world.sensors,
      loops: [window.__signalCity.world.hasLoop(0, 'N', 1), window.__signalCity.world.hasLoop(0, 'N', 0)],
    }));
    ok(c0.phases.join() === 'N-S,N-S lefts,E-W,E-W lefts' && c0.walks.join('|') === 'P-E+P-W||P-N+P-S|', 'Four Ways\' four phases, the throughs carrying the parallel walks', c0.walks.join(' | '));
    ok(c0.peds && c0.calls.join('') === 'NESW', 'the panel shows a call button per leg', c0.calls.join(''));
    ok(c0.sensors && c0.sensorsNote && c0.loops[0] && !c0.loops[1], 'the loops are live, on the left bays only', `bay ${c0.loops[0]}, curb ${c0.loops[1]}`);
    ok(c0.rows.length === 3 && c0.rows.filter(r => /sensed/.test(r)).length === 2 && !c0.rows.some(r => /sleeping/.test(r)) && c0.badge === '', 'its two queue rules show live, not greyed, with no badge', c0.rows.join(' | '));
    await page.click('#calls .call[data-leg="N"]');
    const c1 = await page.evaluate(() => ({
      pending: !!window.__signalCity.world.pedCalls[0].N,
      cls: document.querySelector('#calls .call[data-leg="N"]').className,
      head: window.__signalCity.world.controller.pedHead('N'),
    }));
    ok(c1.pending && /waiting/.test(c1.cls) && c1.head === 'dont-walk', 'pressing N registers a call that waits: N-S is green and its walk runs with E-W', `${c1.cls}, ${c1.head}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 5);
    await page.keyboard.press('3');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 6);
    await new Promise(r => setTimeout(r, 300));
    const c2 = await page.evaluate(() => ({
      phase: window.__signalCity.world.controller.phase, stage: window.__signalCity.world.controller.stage,
      head: window.__signalCity.world.controller.pedHead('N'),
      walkers: window.__signalCity.world.walkers.filter(w => !w.done).length,
      cls: document.querySelector('#calls .call[data-leg="N"]').className,
      state: document.querySelector('#calls .call[data-leg="N"] .state').textContent,
      stageText: document.getElementById('stage').textContent,
    }));
    ok(c2.phase === 2 && c2.stage === 'green' && c2.head === 'walk', 'six seconds after pressing 3, E-W is green and the N crossing says WALK', `${c2.stage} ${c2.phase}, ${c2.head}`);
    ok(c2.walkers >= 1 && /walk/.test(c2.cls) && c2.state === 'WALK' && /WALK N/.test(c2.stageText), 'a walker is on the zebra and the panel says so', `${c2.walkers} walkers, ${c2.state}, ${c2.stageText}`);
    await shot(page, 'crossing-walk');
    await page.keyboard.press('1');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 3);
    const c3 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, next: window.__signalCity.world.controller.next, walk: window.__signalCity.world.controller.walk && window.__signalCity.world.controller.walk.stage }));
    ok(c3.stage === 'green' && c3.next === 0 && c3.walk, 'pressing 1 during the walk is held: the green waits for the clearance', `${c3.stage} next ${c3.next}, walk ${c3.walk}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 22);
    const c4 = await page.evaluate(() => ({ stage: window.__signalCity.world.controller.stage, phase: window.__signalCity.world.controller.phase, head: window.__signalCity.world.controller.pedHead('N'), struck: window.__signalCity.world.stats.struck }));
    ok(c4.head === 'dont-walk' && (c4.stage !== 'green' || c4.phase !== 2), 'and once it has cleared the change goes through', `${c4.stage} ${c4.phase}, ${c4.head}`);
    ok(c4.struck === 0, 'nobody was struck');
    await page.click('#addQueueBtn');
    const c5 = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#rules .rule')].map(r => r.className), badge: document.querySelector('#rules .badge')?.textContent || '' }));
    ok(c5.rows.length === 4 && /sensed/.test(c5.rows[3]) && c5.badge === '', 'a queue rule added here is live at once', c5.rows[3]);
    ok(errors.length === 0, 'no page errors on Crossing', errors.join(' | '));
  });

  await section('Two Blocks: the corridor and the box the panel drives', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="two-blocks"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'two-blocks', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const t0 = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer;
      return {
        nodes: w.nodes.length, origins: w.nodes.map(n => n.origin[0]).join(','),
        offsets: w.controllers.map(c => c.offset).join(','),
        buttons: [...document.querySelectorAll('#nodes .node')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
        note: document.getElementById('offsetNote').classList.contains('hidden') ? '' : document.getElementById('offsetNote').textContent,
        stage: document.getElementById('stage').textContent,
        aspect: r.width / r.height, scale: r.scale,
        phases: [...document.querySelectorAll('#phases .phase .name')].map(e => e.textContent),
      };
    });
    ok(t0.nodes === 2 && t0.origins === '-110,110' && t0.offsets === '0,16', 'two boxes 220 m apart, the east one 16 s behind', `${t0.origins} offsets ${t0.offsets}`);
    ok(t0.buttons.join() === 'West box*,East box' && /16 s behind/.test(t0.note), 'the panel offers both boxes, the west one selected, and names the offset', `${t0.buttons.join()} ${t0.note}`);
    ok(/^W: .* · E: /.test(t0.stage) && t0.phases.join() === 'E-W,N-S', 'the stage line reads both boxes, and E-W is phase 1', t0.stage);
    ok(t0.aspect > 1.6 && t0.scale >= 2.5, 'the board is wider than it is tall to frame both boxes', `${t0.aspect.toFixed(2)} at ${t0.scale.toFixed(2)} px/m`);
    await page.click('#nodes .node[data-node="1"]');
    await page.keyboard.press('2');
    const t1 = await page.evaluate(() => ({ node: window.__signalCity.game.node, on: document.querySelector('#nodes .node.on').dataset.node, c0: window.__signalCity.world.controllers[0].next, c1: window.__signalCity.world.controllers[1].next, s1: window.__signalCity.world.controllers[1].stage }));
    ok(t1.node === 1 && t1.on === '1', 'clicking East box selects it');
    ok(t1.c1 === 1 && t1.s1 === 'yellow' && t1.c0 === null, 'and pressing 2 reaches the east controller, not the west', `east next ${t1.c1} ${t1.s1}, west next ${t1.c0}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 40);
    await new Promise(r => setTimeout(r, 300));
    const t2 = await page.evaluate(() => ({ handoffs: window.__signalCity.world.stats.handoffs, onMap: window.__signalCity.world.cars.filter(c => !c.done).length, nodes: new Set(window.__signalCity.world.cars.filter(c => !c.done).map(c => c.path.node)).size }));
    ok(t2.handoffs > 0 && t2.nodes === 2, 'forty seconds in, cars have crossed from one box to the other', `${t2.handoffs} handoffs, ${t2.onMap} on the map`);
    await shot(page, 'two-blocks');
    ok(errors.length === 0, 'no page errors on Two Blocks', errors.join(' | '));
  });

  await section('Two Blocks: the offset slider and the platoon diagram (M7)', async () => {
    const s0 = await page.evaluate(() => {
      const r = document.getElementById('offsetRange'), c = document.getElementById('wave');
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const colours = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) colours.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      return { shown: !document.getElementById('waveBox').classList.contains('hidden'), min: r.min, max: r.max, value: r.value, label: document.getElementById('offsetVal').textContent, colours: colours.size, samples: window.__signalCity.game.wave.samples.length, w: c.width, h: c.height };
    });
    ok(s0.shown && s0.min === '0' && s0.max === '42' && s0.value === '16' && s0.label === '16 s', 'the slider runs 0 to 42 on the 43 s cycle and sits at the level\'s 16', `${s0.min}..${s0.max} at ${s0.value}, ${s0.label}`);
    ok(s0.colours >= 4 && s0.w > 100, 'the diagram drew more than a flat colour', `${s0.colours} colours sampled on ${s0.w}x${s0.h}`);
    ok(s0.samples >= 30, 'and holds the last twenty seconds of samples', `${s0.samples} samples`);
    // move the slider to 27 with the east box mid-green: no jump, a shift queued
    const before = await page.evaluate(() => { const c = window.__signalCity.world.controllers[1]; return { stage: c.stage, phase: c.phase, stageT: c.stageT, t: window.__signalCity.world.t }; });
    await page.evaluate(v => { const r = document.getElementById('offsetRange'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, 27);
    const s1 = await page.evaluate(() => {
      const w = window.__signalCity.world, c = w.controllers[1];
      return { offset: c.offset, shift: c.shift, stage: c.stage, phase: c.phase, stageT: c.stageT, west: w.controllers[0].offset, note: document.getElementById('offsetNote').textContent, label: document.getElementById('offsetVal').textContent };
    });
    ok(s1.offset === 27 && s1.west === 0 && Math.abs(s1.shift - 11) < 1e-9, 'sliding to 27 queues 11 s of cuts on the east box and leaves the west one alone', `offset ${s1.offset} shift ${s1.shift} west ${s1.west}`);
    ok(s1.stage === before.stage && s1.phase === before.phase && s1.stageT === before.stageT, 'and the east box did not jump at the call', `${s1.stage} ${s1.phase} ${s1.stageT.toFixed(2)}`);
    ok(/27 s behind/.test(s1.note) && /11 s still to cut/.test(s1.note) && s1.label === '27 s', 'the note names the new offset and what is still to cut', s1.note);
    // step through the shift: the log after the call is only yellow, all-red, green
    const mark = await page.evaluate(() => window.__signalCity.world.controllers[1].log.length);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 60);
    await new Promise(r => setTimeout(r, 300));
    const s2 = await page.evaluate(m => {
      const c = window.__signalCity.world.controllers[1];
      return { shift: c.shift, kinds: c.log.slice(m).map(e => e.kind), note: document.getElementById('offsetNote').textContent, offsetOf: window.__signalCity.world.offsetOf() };
    }, mark);
    const order = ['yellow', 'allred', 'green'];
    const legal = s2.kinds.filter(k => order.includes(k)).every((k, i, a) => i === 0 || k === order[(order.indexOf(a[i - 1]) + 1) % 3]);
    ok(Math.abs(s2.shift) < 1e-6 && s2.offsetOf === 27, 'a minute on the shift is paid and the corridor reads 27', `shift ${s2.shift}`);
    ok(legal && s2.kinds.includes('yellow'), 'and every change on the way ran yellow then all-red', s2.kinds.join(' '));
    ok(!/Re-aligning/.test(s2.note), 'the note has dropped the re-aligning line', s2.note);
    await shot(page, 'two-blocks-wave');
    ok(errors.length === 0, 'no page errors on the slider', errors.join(' | '));
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

  await section('Rush Hour: the surge, the outage and the ambulance clock (M7)', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="rush-hour"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'rush-hour', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const r0 = await page.evaluate(() => ({ hidden: document.getElementById('eventLine').classList.contains('hidden'), text: document.getElementById('eventLine').textContent }));
    ok(r0.hidden && r0.text === '', 'before anything happens the event line is hidden');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 61);
    await new Promise(r => setTimeout(r, 300));
    const r1 = await page.evaluate(() => ({ hidden: document.getElementById('eventLine').classList.contains('hidden'), text: document.getElementById('eventLine').textContent, scale: window.__signalCity.world.demandScale(), power: window.__signalCity.world.powerOut }));
    ok(!r1.hidden && /Rush hour: traffic at 170%/.test(r1.text) && Math.abs(r1.scale - 1.7) < 1e-9 && !r1.power, 'at 61 s the event line says rush hour at 170% and the spawner reads 1.7', r1.text);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 50);
    await new Promise(r => setTimeout(r, 300));
    const r2 = await page.evaluate(() => {
      const w = window.__signalCity.world, c = w.controller;
      return { power: w.powerOut, stage: c.stage, heads: [...new Set(c.movements.map(m => c.head(m)))].join(), line: document.getElementById('eventLine').textContent, stageText: document.getElementById('stage').textContent, disabled: [...document.querySelectorAll('#phases .phase')].every(b => b.disabled) && document.getElementById('flashRedBtn').disabled };
    });
    ok(r2.power && r2.stage === 'dark' && r2.heads === 'dark', 'at 111 s the power is out and every head is dark', r2.heads);
    ok(/Power out/.test(r2.line) && /Rush hour/.test(r2.line) && /dark: four-way stop/.test(r2.stageText), 'the event line says so, with the surge still on, and the stage line reads a four-way stop', `${r2.stageText} | ${r2.line}`);
    ok(r2.disabled, 'and the phase and flash buttons are disabled');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    const r3 = await page.evaluate(() => { const c = window.__signalCity.world.controller; return { stage: c.stage, next: c.next }; });
    ok(r3.stage === 'dark' && r3.next === null, 'pressing 1 and 2 reaches nothing: the box stays dark', `${r3.stage} next ${r3.next}`);
    await shot(page, 'rush-hour-outage');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 30);
    await new Promise(r => setTimeout(r, 300));
    const r4 = await page.evaluate(() => { const w = window.__signalCity.world; return { power: w.powerOut, stage: w.controller.stage, line: document.getElementById('eventLine').textContent, outages: w.stats.outages }; });
    ok(!r4.power && r4.stage !== 'dark' && r4.outages === 1 && !/Power out/.test(r4.line), 'at 141 s the power is back and the line has dropped the outage', `${r4.stage} | ${r4.line}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 45);
    await new Promise(r => setTimeout(r, 300));
    const r5 = await page.evaluate(() => { const w = window.__signalCity.world; const e = w.activeEvent('ambulance'); return { amb: !!e, clock: w.ambulanceClock(), line: document.getElementById('eventLine').textContent, btn: document.getElementById('priorityBtn').classList.contains('show'), late: document.getElementById('eventLine').classList.contains('late') }; });
    ok(r5.amb && r5.clock > 38 && r5.clock <= 40 && r5.btn, 'at 186 s the ambulance is on the map with 40 s on the clock and the corridor button shows', `clock ${r5.clock && r5.clock.toFixed(1)}`);
    ok(/Ambulance from W: (39|40) s to get it through/.test(r5.line) && !r5.late, 'the event line counts it down', r5.line);
    await page.keyboard.press('e');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 1);
    const r6 = await page.evaluate(() => { const w = window.__signalCity.world; const e = w.activeEvent('ambulance'); return { priority: e && e.car.priority, movements: w.controller.preemption ? w.controller.preemption.movements.join() : '', stageText: document.getElementById('stage').textContent }; });
    ok(r6.priority && r6.movements === 'W-L,W-T,W-R' && /PRIORITY/.test(r6.stageText), 'E calls the corridor for the whole W leg', r6.movements);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 39);
    await new Promise(r => setTimeout(r, 300));
    const r7 = await page.evaluate(() => { const w = window.__signalCity.world; return { amb: !!w.activeEvent('ambulance'), late: w.stats.ambulanceLate, hidden: document.getElementById('eventLine').classList.contains('hidden'), cleared: w.stats.cleared }; });
    ok(!r7.amb && r7.late === 0 && r7.hidden, 'forty seconds on it is through, on time, and the event line is hidden again', `${r7.cleared} cleared`);
    await shot(page, 'rush-hour-ambulance');
    ok(errors.length === 0, 'no page errors on Rush Hour', errors.join(' | '));
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
