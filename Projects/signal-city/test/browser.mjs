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
// the box (M7), School Run's zone and cones and Main Street's platoons
// reach the event line and the board, the sprite gallery draws ten rows.
// The UI pass adds: the tab each level opens on and nothing under the fold,
// the phase cards' arrows against the controller's phases, the Signal
// line's cause and the strip after a press, a rule, the offset, the
// corridor and the outage, the firing rule's card, the lane washes and the
// hover preview, the banner queue, the split stats, a board that reaches
// the fold; and the visual pass: the ground drawn once per camera and
// slid under a drag, brake lamps, indicators, pavement, the stop-line
// wash, dusk and night. M8 adds the campaign: shut cards on a fresh save,
// a star opening the next, the shop spending stars into unlocks, and a
// bought phase on the Stem, marked and run by its key; then the roundabout
// bought, First Light played as a ring with no controls, and switched off
// again in the shop. M9 adds a generated grid of six boxes through the
// debug hook: the picker by number, the camera framing the district, a
// click on the board selecting a ring and the ring note following it, and
// twelve boxes still framed. Endless (M9) adds its card, shut until Two
// Blocks has a star, a day survived and the next day built with box 1's
// timing kept, a locked grid ending the run, Again, and the best on the
// card after a reload. Screenshots land in test/shots/ (ignored by git)
// as evidence for the run.
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
// The UI pass: which tab the panel shows, and a phase card's drawn arrows
// against the controller's own phase list.
const tabShown = page => page.evaluate(() => ({ tab: document.getElementById('panel').dataset.tab, selected: document.querySelector('#tabs .tab[aria-selected="true"]')?.dataset.tab, offered: [...document.querySelectorAll('#tabs .tab:not(.hidden)')].map(b => b.dataset.tab).join(',') }));
const diagrams = page => page.evaluate(() => {
  const c = window.__signalCity.game.ctl;
  return [...document.querySelectorAll('#phases .phase')].map(b => {
    const p = c.phases[+b.dataset.phase];
    const drawn = [...b.querySelectorAll('.dia path.mv')].map(e => e.dataset.mv).sort().join(',');
    return { n: b.querySelectorAll('.dia path.mv').length, heads: b.querySelectorAll('.dia path.head').length, want: p.movements.length, same: drawn === p.movements.slice().sort().join(','), text: b.textContent };
  });
});
// Every visible thing on the page sits above the fold.
const belowFold = page => page.evaluate(() => {
  const H = window.innerHeight, out = [];
  for (const e of document.querySelectorAll('.panel *, #board, .top *')) {
    const r = e.getBoundingClientRect();
    if (r.width && r.height && r.bottom > H + 0.5) out.push(`${e.id || e.className || e.tagName} ${Math.round(r.bottom)}`);
  }
  return { out, scroll: document.scrollingElement.scrollHeight, H };
});
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
      cards: [...document.querySelectorAll('.level-card:not(.endless) .lv-name')].map(e => e.textContent),
      endless: !!document.querySelector('.level-card.endless.locked[data-level="endless"]'),
      stars: document.getElementById('starTotal').textContent,
    }));
    ok(sel.shown, 'the level select is up');
    ok(sel.cards.length === 9 && sel.cards.join() === 'First Light,Stem,Four Ways,Crossing,Two Blocks,Rush Hour,School Run,Main Street,Free Play', 'with nine cards, First Light first and Free Play last', sel.cards.join(', '));
    ok(sel.endless, 'and after them Endless, shut (M9)');
    ok(sel.stars === '0 stars', 'and no stars yet', sel.stars);
    const camp = await page.evaluate(() => ({
      locked: [...document.querySelectorAll('.level-card.locked:not(.endless)')].map(e => e.dataset.level),
      disabled: [...document.querySelectorAll('.level-card:not(.endless)')].filter(e => e.disabled).length,
      next: [...document.querySelectorAll('.level-card.next')].map(e => e.dataset.level).join(),
      shut: document.querySelector('.level-card[data-level="stem"] .lv-shut')?.textContent || '',
      wallet: document.getElementById('wallet').textContent,
      shop: [...document.querySelectorAll('#shopList .shop-item')].map(e => `${e.dataset.item}:${e.querySelector('.buy').disabled ? 'off' : 'on'}`).join(),
    }));
    ok(camp.locked.join() === 'stem,four-ways,crossing,two-blocks,rush-hour,school-run,main-street' && camp.disabled === 7,
      'a fresh save has seven cards shut and disabled, First Light and Free Play open (M8)', camp.locked.join());
    ok(camp.next === 'first-light' && camp.shut === 'A star on First Light opens it.', 'First Light is marked next and the Stem says what opens it', `${camp.next}; ${camp.shut}`);
    ok(camp.wallet === '0 to spend' && camp.shop === 'lefts:off,split:off,sensors:off,roundabout:off', 'the shop has four things on it and nothing to spend', `${camp.wallet}; ${camp.shop}`);
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
    const tab0 = await tabShown(page);
    ok(tab0.tab === 'phases' && tab0.selected === 'phases' && tab0.offered === 'phases,rules', 'it opens on the Phases tab, its lesson, and offers only Phases and Rules', JSON.stringify(tab0));
    const dia0 = await diagrams(page);
    ok(dia0.length === 2 && dia0.every(d => d.n === d.want && d.heads === d.want && d.same && d.n === 6), 'each phase card draws one arrow per movement of its phase, six each, and no N-T text', dia0.map(d => `${d.n}/${d.want} ${d.text}`).join(' | '));
    const help0 = await page.evaluate(() => ({ hidden: document.getElementById('helpBox').classList.contains('hidden'), hint: document.getElementById('hint').textContent, keysShown: !!document.querySelector('.keys').getClientRects().length }));
    ok(help0.hidden && !help0.keysShown && /Press 1 and 2/.test(help0.hint), 'the hint and the key list start behind the ? button', JSON.stringify(help0).slice(0, 90));
    await page.click('#helpBtn');
    const help1 = await page.evaluate(() => ({ shown: !document.getElementById('helpBox').classList.contains('hidden') && !!document.getElementById('hint').getClientRects().length, expanded: document.getElementById('helpBtn').getAttribute('aria-expanded') }));
    ok(help1.shown && help1.expanded === 'true', 'and ? shows them', JSON.stringify(help1));
    await page.click('#helpBtn');
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
    const st1 = await page.evaluate(() => ({ avg: document.getElementById('avgWait').textContent, waiting: document.getElementById('waitingNow').textContent, honks: document.getElementById('honks').textContent, sat: document.getElementById('satVal').textContent, ped: document.getElementById('pedLateStat').classList.contains('hidden'), m: window.__signalCity.meters() }));
    ok(st1.avg === `${st1.m.avgWait.toFixed(0)} s` && st1.waiting === String(st1.m.waiting) && st1.honks === String(st1.m.honks) && st1.sat === `${Math.round(st1.m.satisfaction * 100)}%`, 'the old Satisfaction line is four stats of its own: average wait, waiting, honks, mood', `${st1.avg} · ${st1.waiting} · ${st1.honks} · ${st1.sat}`);
    ok(st1.ped, 'and a level with no crossings shows no walkers stat');
    const cz = await page.evaluate(() => ({ text: document.getElementById('cause').textContent, by: document.getElementById('cause').dataset.by, segs: [...document.querySelectorAll('#strip .seg')].map(e => e.dataset.stage + ':' + e.dataset.by) }));
    ok(cz.by === 'start' && /opening phase/.test(cz.text) && cz.segs.join() === 'green:start', 'before anyone touches it the Signal line and the strip name the level\'s start', `${cz.text} | ${cz.segs.join()}`);
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
    // half a second more: the green began on the last of those steps when no frame ran before the pause, and a run of 0 s draws nothing
    await page.evaluate(n => window.__signalCity.step(n), 30);
    const cy = await page.evaluate(() => ({ text: document.getElementById('cause').textContent, by: document.getElementById('cause').dataset.by, segs: [...document.querySelectorAll('#strip .seg')].map(e => e.dataset.stage + ':' + e.dataset.by) }));
    ok(cy.by === 'player' && cy.text === 'Changed by you', 'the Signal line says the change was yours', cy.text);
    ok(cy.segs.join() === 'green:start,yellow:player,allred:player,green:player', 'and the strip shows the first green, then your yellow, all-red and green', cy.segs.join());
    // (b) the lanes that may go are washed green: sample 4 m up the E and N approaches
    const wash = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer, net = w.network, c = window.__signalCity.canvas().getContext('2d');
      // the median of 9 samples 9 to 17 m up the lane's centre: clear of the turn arrow, robust to a car
      const at = leg => {
        const px = [];
        for (let k = 0; k < 9; k++) { const p = net.lanePoint(leg, 0, true, net.stopDist + 9 + k), q = r.toScreen(p[0], p[1]); const d = c.getImageData(Math.round(q.x * r.dpr), Math.round(q.y * r.dpr), 1, 1).data; px.push([d[0], d[1], d[2]]); }
        px.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
        return px[4];
      };
      return { E: at('E'), N: at('N'), lanes: [r.laneState(w, net, 'E', 0), r.laneState(w, net, 'N', 0)] };
    });
    ok(wash.E[1] - wash.E[0] > 25 && Math.abs(wash.N[1] - wash.N[0]) < 12 && wash.lanes.join() === 'green,', 'the E approach on its green is washed green on the board and the N one on its red is plain asphalt', `E ${wash.E} N ${wash.N}`);
    // (b) hovering a phase card previews its movements as arrows over the box
    await page.hover('#phases .phase[data-phase="0"]');
    await new Promise(r => setTimeout(r, 200));
    const pv = await page.evaluate(() => {
      const r = window.__signalCity.game.renderer, c = window.__signalCity.canvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] >> 4 === 7 && d[i + 1] >> 4 === 13 && d[i + 2] >> 4 === 15) n++;
      return { data: document.getElementById('boardWrap').dataset.preview, n, card: document.querySelector('#phases .phase.previewing')?.dataset.phase };
    });
    ok(pv.data.split(',').sort().join() === 'N-L,N-R,N-T,S-L,S-R,S-T' && pv.card === '0', 'hovering card 1 previews N-S on the board', pv.data);
    ok(pv.n > 200, 'and its arrows are drawn over the asphalt in the preview blue', `${pv.n} pixels`);
    await page.screenshot({ path: path.join(OUT, '03b-first-light-preview.png') });   // off the numbering, so the shots the M7 handoffs cite keep their numbers
    await page.mouse.move(5, 5);
    await new Promise(r => setTimeout(r, 200));
    const pv2 = await page.evaluate(() => ({ data: document.getElementById('boardWrap').dataset.preview, pre: window.__signalCity.game.renderer.preview }));
    ok(pv2.data === '' && pv2.pre === null, 'and moving off it clears the preview');
    // the canvas is not a flat colour: cars and roads drew
    const px = await page.evaluate(() => {
      const c = window.__signalCity.canvas();
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
    await page.click('#tabs .tab[data-tab="rules"]');
    ok((await tabShown(page)).tab === 'rules' && await page.evaluate(() => !document.getElementById('phases').getClientRects().length), 'the Rules tab shows the rules and hides the phase cards');
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

  await section('the campaign: a star opens the next level, and stars buy phases (M8)', async () => {
    await page.click('#levelsBtn');
    const c0 = await page.evaluate(() => ({
      stem: document.querySelector('.level-card[data-level="stem"]').disabled,
      four: document.querySelector('.level-card[data-level="four-ways"]').disabled,
      fourText: document.querySelector('.level-card[data-level="four-ways"]').textContent,
      next: document.querySelector('.level-card.next')?.dataset.level,
      earned: window.__signalCity.game.save.levels['first-light'].stars,
      wallet: document.getElementById('wallet').textContent,
    }));
    ok(!c0.stem && c0.four && /A star on Stem opens it/.test(c0.fourText) && c0.next === 'stem', 'First Light\'s star opened the Stem and only the Stem, now marked next', JSON.stringify(c0).slice(0, 120));
    ok(c0.wallet === `${c0.earned} to spend`, 'and its stars are there to spend', c0.wallet);
    await page.evaluate(() => document.querySelector('.level-card[data-level="four-ways"]').click());
    const stay = await page.evaluate(() => ({ shown: document.getElementById('selectScrim').classList.contains('show'), level: window.__signalCity.world.level.id }));
    ok(stay.shown && stay.level === 'first-light', 'a click on a shut card starts nothing', JSON.stringify(stay));
    // three stars each on the Stem and Four Ways, as if they had been played
    await page.evaluate(() => { const g = window.__signalCity.game; for (const id of ['stem', 'four-ways']) g.save.levels[id] = { stars: 3, best: 100, plays: 1 }; g.slot.save(g.save); g.buildLevelSelect(); });
    const w0 = await page.evaluate(() => parseInt(document.getElementById('wallet').textContent, 10));
    await page.click('.shop-item[data-item="lefts"] .buy');
    const c1 = await page.evaluate(() => ({
      wallet: parseInt(document.getElementById('wallet').textContent, 10),
      owned: document.querySelector('.shop-item[data-item="lefts"]').classList.contains('owned'),
      label: document.querySelector('.shop-item[data-item="lefts"] .buy').textContent,
      sensors: document.querySelector('.shop-item[data-item="sensors"]').textContent,
      saved: JSON.parse(localStorage.getItem('signal_city_v1')),
      stem: document.querySelector('.level-card[data-level="stem"] .lv-bought')?.textContent || '',
      four: document.querySelector('.level-card[data-level="four-ways"] .lv-bought')?.textContent || '',
    }));
    const unlocks = (c1.saved.data || c1.saved).unlocks || [];
    ok(c1.wallet === w0 - 3 && c1.owned && c1.label === 'owned', 'buying protected turns takes 3 stars and marks them owned', `${w0} to ${c1.wallet}`);
    ok(unlocks.includes('lefts'), 'and the save under signal_city_v1 carries them in unlocks', JSON.stringify(unlocks));
    ok(/A star on Crossing puts it on the shelf/.test(c1.sensors), 'Sensors wait for a star on Crossing and say so');
    ok(c1.stem === '+ protected turns' && c1.four === '', 'the Stem\'s card says it takes them; Four Ways, whose lefts have arrows already, does not', `"${c1.stem}" / "${c1.four}"`);
    await page.click('.level-card[data-level="stem"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'stem', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const p0 = await page.evaluate(() => ({
      cards: [...document.querySelectorAll('#phases .phase')].map(b => `${b.querySelector('.name').textContent}${b.classList.contains('bought') ? '+' : ''}`),
      note: !document.getElementById('boughtNote').classList.contains('hidden') && !!document.getElementById('boughtNote').textContent,
    }));
    ok(p0.cards.join() === 'N-S,E-W,N-S arrows+' && p0.note, 'the Stem opens with its two phases and a third, bought, marked, and a note on what that means', p0.cards.join(' | '));
    await page.keyboard.press('3');
    await page.evaluate(n => window.__signalCity.step(n), Math.round(60 * 8.2));
    const p1 = await page.evaluate(() => ({ stage: document.getElementById('stage').textContent, head: window.__signalCity.world.controller.head('N-L'), t: window.__signalCity.world.controller.head('N-T') }));
    ok(/^N-S arrows green/.test(p1.stage) && p1.head === 'green-arrow' && p1.t === 'red', 'key 3 runs it: the Signal line reads N-S arrows green, N-L on its arrow, N-T red', `${p1.stage}; ${p1.head}, ${p1.t}`);
    await shot(page, 'campaign-stem-arrows');
    // put the save back the way the rest of the suite expects it: nothing
    // bought, and every level open
    await page.evaluate(() => {
      const g = window.__signalCity.game;
      g.save.unlocks = ['phases'];
      for (const c of document.querySelectorAll('.level-card:not(.endless)')) if (!g.save.levels[c.dataset.level]) g.save.levels[c.dataset.level] = { stars: 0, best: 0, plays: 1 };
      g.slot.save(g.save); g.buildLevelSelect();
    });
    ok(errors.length === 0, 'no page errors in the campaign', errors.join(' | '));
  });

  await section('the roundabout: bought, played as a ring, switched off (M8, #594 to #599)', async () => {
    await page.keyboard.press('Escape');
    // stars enough, Rush Hour's among them; the levels go back as they were after
    const before = await page.evaluate(() => { const g = window.__signalCity.game; const b = JSON.stringify(g.save.levels); for (const id of ['first-light', 'stem', 'four-ways', 'crossing', 'two-blocks', 'rush-hour']) g.save.levels[id] = { stars: 3, best: 100, plays: 1 }; g.slot.save(g.save); g.buildLevelSelect(); return b; });
    const r0 = await page.evaluate(() => ({ wallet: parseInt(document.getElementById('wallet').textContent, 10), btn: document.querySelector('.shop-item[data-item="roundabout"] .buy').textContent, off: document.querySelector('.shop-item[data-item="roundabout"] .buy').disabled }));
    ok(r0.btn === '6 ★' && !r0.off, 'with Rush Hour starred the roundabout is on the shelf at 6', `${r0.btn}, ${r0.wallet} to spend`);
    await page.click('.shop-item[data-item="roundabout"] .buy');
    const r1 = await page.evaluate(() => {
      const b = document.querySelector('.shop-item[data-item="roundabout"] .buy');
      const saved = JSON.parse(localStorage.getItem('signal_city_v1'));
      return {
        wallet: parseInt(document.getElementById('wallet').textContent, 10), label: b.textContent, pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'),
        unlocks: (saved.data || saved).unlocks || [],
        cards: Object.fromEntries([...document.querySelectorAll('.level-card')].map(c => [c.dataset.level, c.querySelector('.lv-bought')?.textContent || ''])),
      };
    });
    ok(r1.wallet === r0.wallet - 6 && r1.unlocks.includes('roundabout'), 'buying it takes 6 and the save carries it in unlocks', `${r0.wallet} to ${r1.wallet}; ${r1.unlocks.join(',')}`);
    ok(r1.label === 'on' && r1.pressed === 'true' && r1.on, 'owned, its button is a switch, and it starts on', `${r1.label} ${r1.pressed}`);
    ok(r1.cards['first-light'] === '+ roundabout' && r1.cards.stem === '+ roundabout' && r1.cards['free-play'] === '+ roundabout' && r1.cards['four-ways'] === '' && r1.cards['rush-hour'] === '',
      'First Light, the Stem and Free Play say they take it; Four Ways and Rush Hour do not', JSON.stringify(r1.cards));
    await page.click('.level-card[data-level="first-light"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'first-light', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const r2 = await page.evaluate(() => ({
      ring: window.__signalCity.world.nodes[0].roundabout === true,
      note: !document.getElementById('ringNote').classList.contains('hidden'),
      offered: [...document.querySelectorAll('#tabs .tab:not(.hidden)')].map(b => b.dataset.tab).join(','),
      stage: document.getElementById('stage').textContent, cause: document.getElementById('cause').textContent,
      target: window.__signalCity.world.level.target, waitTarget: window.__signalCity.world.level.waitTarget,
      strip: document.getElementById('strip').classList.contains('hidden'), hint: document.getElementById('hint').textContent,
    }));
    ok(r2.ring && r2.note && r2.offered === '', 'First Light opens as a ring: the note shows and no tab is offered', `tabs "${r2.offered}"`);
    ok(r2.stage === 'Roundabout: no signals' && r2.cause === 'Every entry yields to the ring' && r2.strip, 'the Signal line says there are none, with no strip of phases under it', `${r2.stage}; ${r2.cause}`);
    ok(/^Nothing to press here/.test(r2.hint), 'and the help says there is nothing to press, not First Light\'s "press 1 and 2"', r2.hint.slice(0, 40));
    ok(r2.target === 30 && r2.waitTarget === 6, 'and the level is scored on the ring\'s own calibration', `${r2.target}, ${r2.waitTarget} s`);
    await page.keyboard.press('2');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 40);
    await new Promise(r => setTimeout(r, 300));
    const r3 = await page.evaluate(() => {
      const w = window.__signalCity.world;
      const ring = w.cars.filter(c => !c.done && c.front > c.path.boxEnter && c.rear < c.path.boxExit).length;
      return { stage: w.controller.stage, cleared: w.stats.cleared, coll: document.getElementById('collisions').textContent, ring, clearedHud: document.getElementById('cleared').textContent };
    });
    ok(r3.stage === 'dark' && r3.cleared > 0 && r3.clearedHud.startsWith(`${r3.cleared} /`), 'a key reaches nothing; at 40 s the cars are going round and the HUD counts them', `${r3.clearedHud}, ${r3.ring} on the ring, collisions ${r3.coll}`);
    await shot(page, 'roundabout-first-light');
    // Free Play on the ring: its ambulance comes at 60 s and yields like
    // anyone, so the priority button stays hidden
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="free-play"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'free-play', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    await page.evaluate(n => window.__signalCity.step(n), 60 * 62);
    await new Promise(r => setTimeout(r, 300));
    const fp = await page.evaluate(() => ({ ring: window.__signalCity.world.nodes[0].roundabout === true, amb: window.__signalCity.world.cars.some(c => !c.done && c.archetype === 'emergency'), btn: document.getElementById('priorityBtn').classList.contains('show') }));
    ok(fp.ring && fp.amb && !fp.btn, 'Free Play on the ring: its ambulance is on the map at 62 s and no priority button offers a corridor the ring would refuse', JSON.stringify(fp));
    // switched off in the shop, First Light is its signals again
    await page.keyboard.press('Escape');
    await page.click('.shop-item[data-item="roundabout"] .buy');
    const r4 = await page.evaluate(() => ({ label: document.querySelector('.shop-item[data-item="roundabout"] .buy').textContent, card: document.querySelector('.level-card[data-level="first-light"] .lv-bought')?.textContent || '', unlocks: window.__signalCity.game.save.unlocks.join() }));
    ok(r4.label === 'off' && r4.card === '' && r4.unlocks.includes('roundabout'), 'the switch reads off, First Light\'s card no longer says it, and the ring is still owned', JSON.stringify(r4));
    await page.click('.level-card[data-level="first-light"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'first-light', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const r5 = await page.evaluate(() => ({ strip: !document.getElementById('strip').classList.contains('hidden'), ring: !!window.__signalCity.world.nodes[0].roundabout, note: document.getElementById('ringNote').classList.contains('hidden'), offered: [...document.querySelectorAll('#tabs .tab:not(.hidden)')].map(b => b.dataset.tab).join(','), stage: document.getElementById('stage').textContent }));
    ok(!r5.ring && r5.note && r5.offered === 'phases,rules' && /green/.test(r5.stage) && r5.strip, 'and plays with its lights, its phases and rules tabs and its strip back', `${r5.offered}; ${r5.stage}`);
    // back as the rest of the suite expects: nothing bought, the switch on, the levels as they were
    await page.evaluate(b => { const g = window.__signalCity.game; g.save.unlocks = ['phases']; g.save.levels = JSON.parse(b); g.ringOn = true; g.slot.save(g.save); g.buildLevelSelect(); }, before);
    ok(errors.length === 0, 'no page errors on the ring', errors.join(' | '));
  });

  await section('Stem and the all-red slider', async () => {
    await page.keyboard.press('Escape');
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
    const tabS = await tabShown(page);
    ok(tabS.tab === 'timing' && tabS.offered === 'phases,timing,rules', 'it opens on the Timing tab, where the all-red is', JSON.stringify(tabS));
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
    const dia4 = await diagrams(page);
    ok(dia4.length === 4 && dia4.every(d => d.n === d.want && d.same) && dia4.map(d => d.n).join() === '4,2,4,2', 'Four Ways\' cards draw 4, 2, 4 and 2 arrows: the throughs and rights, then the two lefts', dia4.map(d => d.n).join());
    await shot(page, 'four-ways-lefts');
    await page.click('#tabs .tab[data-tab="mode"]');
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
    const cf = await page.evaluate(() => ({ text: document.getElementById('cause').textContent, last: [...document.querySelectorAll('#strip .seg')].pop()?.dataset.stage }));
    ok(cf.text === 'Flash mode, set by you' && cf.last === 'flash', 'the Signal line names flash mode and the strip ends in it', `${cf.text} | ${cf.last}`);
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
    const tabC = await tabShown(page);
    ok(tabC.tab === 'crossings' && tabC.offered === 'phases,timing,rules,crossings,mode', 'it opens on the Crossings tab, its lesson, and offers all five', JSON.stringify(tabC));
    for (const t of ['crossings', 'phases', 'timing', 'rules', 'mode']) {
      await page.click(`#tabs .tab[data-tab="${t}"]`);
      const f = await belowFold(page);
      ok(f.out.length === 0 && f.scroll <= f.H, `at 1280x900 nothing on the ${t} tab is below the fold`, f.out.slice(0, 4).join(', ') || `page ${f.scroll} of ${f.H}`);
    }
    await page.click('#tabs .tab[data-tab="crossings"]');
    ok(await page.evaluate(() => !document.getElementById('pedLateStat').classList.contains('hidden')), 'a level with crossings shows the walkers stat');
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
    // (d) a rule fires: the Signal line names it and why, its card flashes,
    // and the strip marks the change as the rule's
    const rf = await page.evaluate(() => {
      const g = window.__signalCity, c = g.world.controller;
      for (let i = 0; i < 60 * 120 && c.cause.by !== 'rule'; i++) g.world.step();
      g.step(1);
      const row = document.querySelector('#rules .rule.fired');
      return { cause: { ...c.cause }, text: document.getElementById('cause').textContent, fired: row ? +row.dataset.i : -1, rows: document.querySelectorAll('#rules .rule.fired').length, tab: document.querySelector('#tabs .tab[data-tab="rules"]').classList.contains('fired'), strip: [...document.querySelectorAll('#strip .seg')].map(e => e.dataset.by) };
    });
    ok(rf.cause.by === 'rule' && rf.text === `Changed by ${rf.cause.text}` && /^Changed by rule \d: (\d+ s of [NESW-]+( lefts)?|[NESW]-[LTR] had \d+ queued)$/.test(rf.text), 'when a rule fires the Signal line names the rule and why it fired', rf.text);
    ok(rf.fired === rf.cause.rule && rf.rows === 1, 'and that rule\'s card, and only that one, flashes', `card ${rf.fired} of rule ${rf.cause.rule}`);
    ok(rf.tab, 'with the Rules tab flashing too, since the panel is on another tab');
    ok(rf.strip.slice(-1)[0] === 'rule', 'and the strip\'s newest run is the rule\'s', rf.strip.join(','));
    await page.click('#tabs .tab[data-tab="rules"]');
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
    const fit = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer, b = document.getElementById('board').getBoundingClientRect();
      return { bottom: b.bottom, H: window.innerHeight, onScreen: w.nodes.every(n => { const p = r.toScreen(n.origin[0], n.origin[1]); return p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height; }) };
    });
    ok(t0.scale >= 2.5 && fit.onScreen, 'the board frames both boxes', `${t0.aspect.toFixed(2)} at ${t0.scale.toFixed(2)} px/m`);
    ok(fit.bottom <= fit.H && fit.H - fit.bottom <= 24, 'and runs down to the fold, with no empty band under it', `board ends at ${Math.round(fit.bottom)} of ${fit.H}`);
    const tabT = await tabShown(page);
    ok(tabT.tab === 'timing', 'Two Blocks opens on the Timing tab, where the offset is', JSON.stringify(tabT));
    await page.click('#nodes .node[data-node="1"]');
    await page.keyboard.press('2');
    await page.click('#tabs .tab[data-tab="timing"]');
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
    const co = await page.evaluate(() => { const g = window.__signalCity, c = g.world.controllers[1]; for (let i = 0; i < 60 * 30 && !(c.cause.by === 'offset' && c.stage === 'yellow'); i++) g.world.step(); g.step(1); return { text: document.getElementById('cause').textContent, by: c.cause.by, node: g.game.node }; });
    ok(co.by === 'offset' && co.node === 1 && /^E: Changed by the offset: \d+ s still to cut$/.test(co.text), 'the east box\'s next change is the offset\'s, and the Signal line says what is left to cut', co.text);
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
    const lum = () => page.evaluate(() => { const c = window.__signalCity.canvas(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, t = 0; for (let i = 0; i < d.length; i += 4 * 53) { t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; } return { lum: t / n, light: document.getElementById('boardWrap').dataset.light }; });
    const duskL = await lum();
    ok(duskL.light === 'dusk', 'Rush Hour is played at dusk', JSON.stringify(duskL));
    await page.evaluate(n => window.__signalCity.step(n), 60 * 50);
    await new Promise(r => setTimeout(r, 300));
    const r2 = await page.evaluate(() => {
      const w = window.__signalCity.world, c = w.controller;
      return { power: w.powerOut, stage: c.stage, heads: [...new Set(c.movements.map(m => c.head(m)))].join(), line: document.getElementById('eventLine').textContent, stageText: document.getElementById('stage').textContent, disabled: [...document.querySelectorAll('#phases .phase')].every(b => b.disabled) && document.getElementById('flashRedBtn').disabled };
    });
    ok(r2.power && r2.stage === 'dark' && r2.heads === 'dark', 'at 111 s the power is out and every head is dark', r2.heads);
    ok(/Power out/.test(r2.line) && /Rush hour/.test(r2.line) && /dark: four-way stop/.test(r2.stageText), 'the event line says so, with the surge still on, and the stage line reads a four-way stop', `${r2.stageText} | ${r2.line}`);
    ok(r2.disabled, 'and the phase and flash buttons are disabled');
    const nightL = await lum();
    ok(nightL.light === 'night' && nightL.lum < 0.6 * duskL.lum, 'and the outage is night: the board is under 60% of the dusk board\'s brightness', `${nightL.lum.toFixed(1)} vs ${duskL.lum.toFixed(1)}`);
    // the cars are on the board, not the ground: each is tinted over its own body
    const carLum = await page.evaluate(() => {
      const g = window.__signalCity, r = g.game.renderer, w = g.world;
      const car = w.cars.find(c => { if (c.done || c.stats.trailer) return false; const p = r.toScreen(c.rects()[0].x, c.rects()[0].y); return p.x > 20 && p.y > 20 && p.x < r.width - 20 && p.y < r.height - 20; });
      if (!car) return null;
      const read = () => { r.draw(w, 0); const b = car.rects()[0], p = r.toScreen(b.x, b.y), d = g.canvas().getContext('2d').getImageData(Math.round(p.x * r.dpr) - 1, Math.round(p.y * r.dpr) - 1, 3, 3).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; return t / 9; };
      const tinted = read();
      r._tintMovers = () => {}; const bare = read(); delete r._tintMovers;
      return { id: car.id, tinted, bare };
    });
    ok(carLum && carLum.tinted < 0.7 * carLum.bare, 'and every car is darkened to the night with it, not left lit on a dark board', carLum ? `car ${carLum.id}: ${carLum.tinted.toFixed(0)} against ${carLum.bare.toFixed(0)} untinted` : 'no car on screen');
    ok(await page.evaluate(() => document.getElementById('cause').textContent) === 'Dark: the power is out', 'the Signal line names the outage as the cause');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    const r3 = await page.evaluate(() => { const c = window.__signalCity.world.controller; return { stage: c.stage, next: c.next }; });
    ok(r3.stage === 'dark' && r3.next === null, 'pressing 1 and 2 reaches nothing: the box stays dark', `${r3.stage} next ${r3.next}`);
    await shot(page, 'rush-hour-outage');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 30);
    await new Promise(r => setTimeout(r, 300));
    const r4 = await page.evaluate(() => { const w = window.__signalCity.world; return { power: w.powerOut, stage: w.controller.stage, line: document.getElementById('eventLine').textContent, outages: w.stats.outages }; });
    ok(!r4.power && r4.stage !== 'dark' && r4.outages === 1 && !/Power out/.test(r4.line), 'at 141 s the power is back and the line has dropped the outage', `${r4.stage} | ${r4.line}`);
    const cb = await page.evaluate(() => ({ text: document.getElementById('cause').textContent, strip: [...document.querySelectorAll('#strip .seg')].map(e => e.dataset.stage + ':' + e.dataset.by).slice(-3) }));
    ok(cb.text === 'Changed by the power coming back' && cb.strip.includes('dark:outage'), 'and the Signal line and the strip say it was the power coming back, after a dark run', `${cb.text} | ${cb.strip.join()}`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 45);
    await new Promise(r => setTimeout(r, 300));
    const r5 = await page.evaluate(() => { const w = window.__signalCity.world; const e = w.activeEvent('ambulance'); return { amb: !!e, clock: w.ambulanceClock(), line: document.getElementById('eventLine').textContent, btn: document.getElementById('priorityBtn').classList.contains('show'), late: document.getElementById('eventLine').classList.contains('late') }; });
    ok(r5.amb && r5.clock > 38 && r5.clock <= 40 && r5.btn, 'at 186 s the ambulance is on the map with 40 s on the clock and the corridor button shows', `clock ${r5.clock && r5.clock.toFixed(1)}`);
    ok(/Ambulance from W: (39|40) s to get it through/.test(r5.line) && !r5.late, 'the event line counts it down', r5.line);
    await page.keyboard.press('e');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 1);
    const r6 = await page.evaluate(() => { const w = window.__signalCity.world; const e = w.activeEvent('ambulance'); return { priority: e && e.car.priority, movements: w.controller.preemption ? w.controller.preemption.movements.join() : '', stageText: document.getElementById('stage').textContent }; });
    ok(r6.priority && r6.movements === 'W-L,W-T,W-R' && /PRIORITY/.test(r6.stageText), 'E calls the corridor for the whole W leg', r6.movements);
    ok(await page.evaluate(() => document.getElementById('cause').textContent) === 'Changed by the priority corridor', 'and the Signal line names the corridor');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 39);
    await new Promise(r => setTimeout(r, 300));
    const r7 = await page.evaluate(() => { const w = window.__signalCity.world; return { amb: !!w.activeEvent('ambulance'), late: w.stats.ambulanceLate, hidden: document.getElementById('eventLine').classList.contains('hidden'), cleared: w.stats.cleared }; });
    ok(!r7.amb && r7.late === 0 && r7.hidden, 'forty seconds on it is through, on time, and the event line is hidden again', `${r7.cleared} cleared`);
    await shot(page, 'rush-hour-ambulance');
    ok(errors.length === 0, 'no page errors on Rush Hour', errors.join(' | '));
  });

  await section('School Run: the zone, the beacons and the cones (M7)', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="school-run"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'school-run', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const tabR = await tabShown(page);
    ok(tabR.tab === 'rules' && tabR.offered === 'phases,timing,rules,crossings', 'School Run opens on the Rules tab: its lesson is giving each phase longer', JSON.stringify(tabR));
    await page.evaluate(n => window.__signalCity.step(n), 60 * 41);
    await new Promise(r => setTimeout(r, 300));
    // a pixel sample in a window around one beacon: the diamond is #ffd21e
    const sample = (label, wx, wy, half) => page.evaluate(([wx, wy, half]) => {
      const r = window.__signalCity.game.renderer, c = window.__signalCity.canvas();
      const p = r.toScreen(wx, wy);
      const d = c.getContext('2d').getImageData(Math.round((p.x - half) * r.dpr), Math.round((p.y - half) * r.dpr), Math.round(2 * half * r.dpr), Math.round(2 * half * r.dpr)).data;
      const seen = {};
      for (let i = 0; i < d.length; i += 4) { const k = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`; seen[k] = (seen[k] || 0) + 1; }
      return seen;
    }, [wx, wy, half]);
    const s1 = await page.evaluate(() => {
      const w = window.__signalCity.world, net = w.network;
      return { line: document.getElementById('eventLine').textContent, scale: w.speedScale, ped: w.pedScale(), zone: !!w.activeEvent('school'), beacon: [net.stopDist + 14, -(net.halfRoad + 2.0)] };
    });
    ok(s1.zone && s1.scale === 0.5 && s1.ped === 4 && /School zone for \d+ s more: every car at 50% speed, and children crossing/.test(s1.line), 'at 41 s the zone is on, the world reads half speed and four times the calls, and the event line says so', s1.line);
    // the E leg's beacon stands at (stopDist + 14, -(halfRoad + 2)): yellow #ffd21e is 15,13,1 at 4 bits
    const px = await sample('beacon', s1.beacon[0], s1.beacon[1], 4);
    ok((px['15,13,1'] || 0) > 4, 'the E beacon\'s yellow diamond is on the board', JSON.stringify(px).slice(0, 120));
    await shot(page, 'school-run-zone');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 110);
    await new Promise(r => setTimeout(r, 300));
    const s2 = await page.evaluate(() => {
      const w = window.__signalCity.world, net = w.network, e = w.activeEvent('closure');
      // the first cone of the taper: at d0 from the centre on W, at the curb side of lane 0
      const d = [-1, 0], rr = [0, 1];
      const inner = (net.lanesPerDir - 0 - 0.5) * 3.5;
      return { line: document.getElementById('eventLine').textContent, closed: net.isClosed('W', 0), zone: !!w.activeEvent('school'), scale: w.speedScale, cone: e ? [d[0] * e.d0 + rr[0] * (inner + 1.75), d[1] * e.d0 + rr[1] * (inner + 1.75)] : null, merges: w.stats.merges };
    });
    ok(!s2.zone && s2.scale === 1 && s2.closed && /Lane closed on W for \d+ s more/.test(s2.line), 'at 151 s the zone is over and the W curb lane is closed, and the line says so', s2.line);
    const cone = await sample('cone', s2.cone[0], s2.cone[1], 3);
    // a cone is orange (#ff7a1a) with a white ring, so at 2 px across most of its pixels are the blend
    const orange = Object.entries(cone).filter(([k]) => { const [r, g, b] = k.split(',').map(Number); return r === 15 && g >= 7 && g <= 11 && b <= 7; }).reduce((n, [, v]) => n + v, 0);
    ok(orange > 2, 'the first cone of the taper is orange on the board', `${orange} orange pixels of ${JSON.stringify(cone).slice(0, 100)}`);
    // (a) two banners at once queue in the board's top-left corner and never
    // overlap: at 151 s the zone's end and the closure's start both announce
    const bn = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); return { list: window.__signalCity.banners(), board: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }; });
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const pairs = bn.list.flatMap((a, i) => bn.list.slice(i + 1).filter(b => hit(a, b)).map(b => `${a.text} over ${b.text}`));
    ok(bn.list.length >= 2, 'two event banners are up at once', bn.list.map(b => b.text).join(', '));
    ok(bn.list.length >= 2 && pairs.length === 0, 'and no two of them overlap', pairs.join('; ') || bn.list.map(b => `${b.text} ${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)}`).join(' | '));
    const midX = (bn.board.left + bn.board.right) / 2, midY = (bn.board.top + bn.board.bottom) / 2;
    ok(bn.list.length >= 2 && bn.list.every(b => b.left >= bn.board.left && b.top >= bn.board.top && b.right <= midX && b.bottom <= midY), 'they queue in the board\'s top-left quarter, clear of the box', bn.list.map(b => `${Math.round(b.left)},${Math.round(b.top)}`).join(' '));
    await shot(page, 'school-run-cones');
    ok(errors.length === 0, 'no page errors on School Run', errors.join(' | '));
  });

  await section('Main Street: the motorcade, the corridor and the held green (M7)', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="main-street"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'main-street', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    await page.evaluate(n => window.__signalCity.step(n), 60 * 52);
    await new Promise(r => setTimeout(r, 300));
    const m1 = await page.evaluate(() => { const w = window.__signalCity.world, p = w.platoon; return { kind: p && p.kind, n: p && p.cars.length, line: document.getElementById('eventLine').textContent, btn: document.getElementById('priorityBtn').classList.contains('show') }; });
    ok(m1.kind === 'motorcade' && m1.n >= 2 && m1.btn && /Motorcade from W: 5 cars, \d still to arrive\. Hold its green until the last is through; E calls its corridor\./.test(m1.line), 'at 52 s the motorcade is arriving, the corridor button shows, and the line says what to do', m1.line);
    await page.keyboard.press('e');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 1);
    await new Promise(r => setTimeout(r, 300));
    const m2 = await page.evaluate(() => { const w = window.__signalCity.world, p = w.platoon; return { priority: p && p.priority, all: p && p.cars.every(c => c.priority), movements: w.controller.preemption ? w.controller.preemption.movements.join() : '', stageText: document.getElementById('stage').textContent, line: document.getElementById('eventLine').textContent }; });
    ok(m2.priority && m2.all && m2.movements === 'W-L,W-T,W-R' && /PRIORITY/.test(m2.stageText) && /its corridor is called/.test(m2.line), 'E calls the corridor for the whole platoon and the line says it is called', `${m2.movements} | ${m2.line}`);
    await shot(page, 'main-street-motorcade');
    await page.evaluate(n => window.__signalCity.step(n), 60 * 40);
    const m3 = await page.evaluate(() => { const w = window.__signalCity.world; return { platoon: !!w.platoon, splits: w.stats.platoonSplits, cleared: w.stats.cleared }; });
    ok(!m3.platoon && m3.splits === 0, 'forty seconds on it is through, unsplit', `${m3.cleared} cleared`);
    await page.evaluate(n => window.__signalCity.step(n), 60 * 70);
    await new Promise(r => setTimeout(r, 300));
    const m4 = await page.evaluate(() => { const w = window.__signalCity.world, p = w.platoon; return { kind: p && p.kind, line: document.getElementById('eventLine').textContent, btn: document.getElementById('priorityBtn').classList.contains('show'), phase: w.controller.phase, stage: w.controller.stage }; });
    ok(m4.kind === 'procession' && !m4.btn && /Funeral procession from N: 8 cars/.test(m4.line) && /it gets no escort/.test(m4.line), 'at 163 s the procession is arriving with no corridor button and the line says it gets no escort', m4.line);
    // press the N-S phase: a request if E-W is up, a hold if N-S is already green
    const before = await page.evaluate(() => { const c = window.__signalCity.world.controller; return { phase: c.phase, stage: c.stage, heldT: c.heldT, next: c.next }; });
    await page.keyboard.press('1');
    const after = await page.evaluate(() => { const c = window.__signalCity.world.controller; return { phase: c.phase, stage: c.stage, heldT: c.heldT, next: c.next, log: c.log.slice(-1)[0].kind }; });
    const wasGreen = before.phase === 0 && before.stage === 'green' && before.next === null;
    ok(wasGreen ? (after.heldT > 0 && after.log === 'hold') : (after.next === 0 || after.phase === 0), wasGreen ? 'pressing 1 on the N-S green holds it: the rule counts from now' : 'pressing 1 asks for N-S', JSON.stringify(after));
    await shot(page, 'main-street-procession');
    ok(errors.length === 0, 'no page errors on Main Street', errors.join(' | '));
  });

  await section('the visual pass: the cached ground, the lamps, the washes', async () => {
    await page.keyboard.press('Escape');
    await page.click('.level-card[data-level="free-play"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'free-play', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    await page.evaluate(n => window.__signalCity.step(n), 60 * 40);
    await new Promise(r => setTimeout(r, 400));
    const light = await page.evaluate(() => document.getElementById('boardWrap').dataset.light);
    ok(light === 'day', 'Free Play is played by day', light);
    // the ground is drawn once per camera, not once per frame
    const b0 = await page.evaluate(() => window.__signalCity.game.renderer.staticBuilds);
    await new Promise(r => setTimeout(r, 500));
    const b1 = await page.evaluate(() => window.__signalCity.game.renderer.staticBuilds);
    await page.evaluate(() => window.__signalCity.game.renderer.zoomBy(1.1));
    await new Promise(r => setTimeout(r, 300));
    const b2 = await page.evaluate(() => window.__signalCity.game.renderer.staticBuilds);
    ok(b1 === b0 && b2 === b0 + 1, 'half a second of frames rebuilds the static layer no times, and a zoom rebuilds it once', `${b0} → ${b1} → ${b2}`);
    await page.evaluate(() => window.__signalCity.game.renderer.fit(window.__signalCity.world));
    // a drag slides the ground and redraws it once, on release
    const box = await page.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height * 0.3 }; });
    await new Promise(r => setTimeout(r, 300));   // the fit() above redraws the ground on the next frame: let it
    const d0 = await page.evaluate(() => window.__signalCity.game.renderer.staticBuilds);
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) { await page.mouse.move(box.x + k * 12, box.y + k * 6); await new Promise(r => setTimeout(r, 60)); }
    const mid = await page.evaluate(() => ({ builds: window.__signalCity.game.renderer.staticBuilds, slide: document.getElementById('ground').style.transform }));
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 300));
    const after = await page.evaluate(() => ({ builds: window.__signalCity.game.renderer.staticBuilds, slide: document.getElementById('ground').style.transform }));
    ok(mid.builds === d0 && /translate\(72px, 36px\)/.test(mid.slide), 'a 72 px drag slides the ground under the board without redrawing it', `${d0} → ${mid.builds}, ${mid.slide}`);
    ok(after.builds === d0 + 1 && after.slide === '', 'and letting go redraws it once, in place', `${after.builds}, '${after.slide}'`);
    await page.evaluate(() => window.__signalCity.game.renderer.fit(window.__signalCity.world));
    // a pixel search in a small window round a world point, in device pixels
    const find = (x, y, half, test) => page.evaluate(([x, y, half, test]) => {
      const r = window.__signalCity.game.renderer, c = window.__signalCity.canvas(), p = r.toScreen(x, y);
      const d = c.getContext('2d').getImageData(Math.round((p.x - half) * r.dpr), Math.round((p.y - half) * r.dpr), Math.round(2 * half * r.dpr), Math.round(2 * half * r.dpr)).data;
      const f = new Function('r', 'g', 'b', `return ${test}`);
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++;
      return n;
    }, [x, y, half, test]);
    await page.evaluate(() => window.__signalCity.game.renderer.draw(window.__signalCity.world, 0));
    // the brake lamps of a car standing at a red
    const stopped = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer;
      const c = w.cars.find(c => !c.done && c.braking && c.v === 0 && !c.stats.trailer && (() => { const p = r.toScreen(c.path.at(c.s).x, c.path.at(c.s).y); return p.x > 20 && p.y > 20 && p.x < r.width - 20 && p.y < r.height - 20; })());
      if (!c) return null;
      const b = c.rects()[0], x = -b.length / 2, cos = Math.cos(b.heading), sin = Math.sin(b.heading);
      return { id: c.id, x: b.x + x * cos, y: b.y + x * sin };
    });
    const red = stopped ? await find(stopped.x, stopped.y, 5, 'r > 200 && g < 90 && b < 90') : 0;
    ok(stopped && red >= 2, 'a car standing at its line shows lit brake lamps at its tail', stopped ? `car ${stopped.id}: ${red} lamp-red pixels` : 'no standing car on screen');
    // an indicator: step until a turning car is on screen with its lamp in the on half of the blink
    const turning = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer;
      for (let i = 0; i < 60 * 60; i++) {
        const c = w.cars.find(c => !c.done && c.indicator && !c.stats.trailer && c.front > c.path.stopLine - 30 && c.front < c.path.stopLine);
        if (c && Math.floor(w.t * 3) % 2 === 0) {
          r.draw(w, 0);
          const b = c.rects()[0], side = c.indicator === 'L' ? -1 : 1, x = b.length / 2 - 0.3, y = side * (b.width / 2 - 0.1), cos = Math.cos(b.heading), sin = Math.sin(b.heading);
          return { id: c.id, ind: c.indicator, x: b.x + x * cos - y * sin, y: b.y + x * sin + y * cos };
        }
        w.step();
      }
      return null;
    });
    const amber = turning ? await find(turning.x, turning.y, 4, 'r > 220 && g > 140 && g < 200 && b < 80') : 0;
    ok(turning && amber >= 2, 'a car about to turn blinks its indicator on the side it is turning to', turning ? `car ${turning.id} ${turning.ind}: ${amber} amber pixels` : 'no turning car found');
    // the pavement beside a leg, and the wash behind a red stop line
    const spots = await page.evaluate(() => {
      const w = window.__signalCity.world, net = w.network, c = w.controller;
      const redLeg = net.legs.find(l => !['L', 'T', 'R'].some(t => c.movements.includes(`${l}-${t}`) && c.head(`${l}-${t}`) !== 'red'));
      return { walk: [-(net.halfRoad + 1.3), -40], redLeg, wash: redLeg ? net.lanePoint(redLeg, 0, true, net.stopDist + 0.4) : null };
    });
    const pave = await find(spots.walk[0], spots.walk[1], 1.5, 'Math.abs(r - 169) < 14 && Math.abs(g - 167) < 14 && Math.abs(b - 157) < 14');
    ok(pave >= 4, 'the N leg has pavement beside its curb', `${pave} pavement pixels`);
    const wash = spots.wash ? await find(spots.wash[0], spots.wash[1], 1.5, 'r > g + 40') : 0;
    ok(spots.redLeg && wash >= 4, 'and a leg on red has a red wash behind its stop line', `${spots.redLeg}: ${wash} red pixels`);
    await shot(page, 'visual-pass');
    ok(errors.length === 0, 'no page errors in the visual pass', errors.join(' | '));
  });

  await section('endless (M9): the card, a day survived, the next day, a run lost, the best kept', async () => {
    // a clean record, and Two Blocks without its star: the card is shut
    const keep = await page.evaluate(() => { const g = window.__signalCity.game; const k = JSON.stringify({ tb: g.save.levels['two-blocks'] || null, e: g.save.endless }); g.save.levels['two-blocks'] = { stars: 0, best: 0, plays: 1 }; g.save.endless = { days: 0, points: 0, seed: null, runs: 0 }; g.slot.save(g.save); g.buildLevelSelect(); g.state = 'select'; document.getElementById('endScrim').classList.remove('show'); document.getElementById('selectScrim').classList.add('show'); return k; });
    const c0 = await page.evaluate(() => { const c = document.querySelector('.level-card[data-level="endless"]'); return { last: c === document.querySelector('#levelList').lastElementChild, disabled: c.disabled, text: c.textContent }; });
    ok(c0.last && c0.disabled && /A star on Two Blocks opens it/.test(c0.text), 'the Endless card comes last, shut, and says a star on Two Blocks opens it', c0.text);
    await page.evaluate(() => { const g = window.__signalCity.game; g.save.levels['two-blocks'].stars = 1; g.slot.save(g.save); g.buildLevelSelect(); });
    const c1 = await page.evaluate(() => { const c = document.querySelector('.level-card[data-level="endless"]'); return { disabled: c.disabled, best: c.querySelector('.lv-best')?.textContent }; });
    ok(!c1.disabled && c1.best === 'no run yet', 'a star on Two Blocks opens it, with no run yet to beat', c1.best);
    await page.click('.level-card[data-level="endless"]');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.level.id === 'endless', { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const d1 = await page.evaluate(() => ({
      name: document.getElementById('levelName').textContent, nodes: window.__signalCity.world.nodes.length, run: window.__signalCity.run,
      cleared: document.getElementById('cleared').textContent, tab: document.getElementById('panel').dataset.tab, nodeBar: !document.getElementById('nodes').classList.contains('hidden'),
    }));
    ok(d1.name === 'Endless, day 1' && d1.nodes === 1 && d1.run.seed === 7 && d1.run.day === 1, 'the card starts day 1: one box, on the city the debug seed rolls', `${d1.name}, ${d1.nodes} box, seed ${d1.run.seed}`);
    ok(d1.cleared === '0 / 20' && d1.tab === 'rules', 'the HUD asks for the day\'s 20, and the panel opens on the rules', `${d1.cleared}, ${d1.tab}`);
    // something the player set on box 1, to see it again tomorrow
    await page.evaluate(() => { window.__signalCity.game.setTiming({ allRed: 2.5 }); });
    for (let i = 0; i < 9; i++) await page.evaluate(n => window.__signalCity.step(n), 60 * 20);
    await page.evaluate(() => { window.__signalCity.game.paused = false; });
    await waitFor(page, () => document.getElementById('endScrim').classList.contains('show'), { timeout: 15000 });
    const e1 = await page.evaluate(() => ({
      title: document.getElementById('endTitle').textContent, stars: document.getElementById('endStars').textContent,
      run: document.querySelector('#endBody [data-run]')?.textContent, best: document.querySelector('#endBody [data-best]')?.textContent,
      city: document.querySelector('#endBody [data-city]')?.textContent,
      button: document.getElementById('retryBtn').textContent, result: window.__signalCity.game.result,
      saved: (s => (s.data || s).endless)(JSON.parse(localStorage.getItem('signal_city_v1'))), levels: Object.keys((s => (s.data || s).levels)(JSON.parse(localStorage.getItem('signal_city_v1')))),
    }));
    ok(e1.title === 'Day 1 survived.' && e1.stars === '' && e1.button === 'Next day', 'the day ends on "Day 1 survived.", no stars, and a Next day button', `${e1.title} ${e1.result.cleared}/${e1.result.target}; ${e1.button}`);
    ok(e1.run === `1 day · ${e1.result.points} points` && /^1 day · \d+ points · new$/.test(e1.best) && e1.city === '7', 'the card reads the run, the city it is on and the new best', `${e1.run}; city ${e1.city}; ${e1.best}`);
    ok(e1.saved.days === 1 && e1.saved.points === e1.result.points && e1.saved.runs === 1 && e1.saved.seed === 7 && !e1.levels.includes('endless'), 'and the save under signal_city_v1 holds the best under endless, not among the levels', JSON.stringify(e1.saved));
    await page.click('#retryBtn');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.nodes.length === 2, { timeout: 5000 });
    await page.evaluate(() => { window.__signalCity.game.paused = true; });
    const d2 = await page.evaluate(() => ({
      name: document.getElementById('levelName').textContent, run: window.__signalCity.run, cleared: document.getElementById('cleared').textContent,
      allRed: window.__signalCity.world.controllers.map(c => c.timing.allRed), slider: document.getElementById('allRedVal').textContent,
      buttons: [...document.querySelectorAll('#nodes .node')].map(b => b.textContent).join(), t: window.__signalCity.world.t,
    }));
    ok(d2.name === 'Endless, day 2' && d2.run.day === 2 && d2.run.days === 1 && d2.cleared === '0 / 28' && d2.buttons === 'Box 1,Box 2', 'Next day builds day 2: two boxes, a target of 28, the run one day in', `${d2.name}, ${d2.cleared}, ${d2.buttons}`);
    // a fresh World: yesterday's ended at 180 s. Not 0: the page runs a
    // frame or two between the click and the pause above.
    ok(d2.allRed.join() === '2.5,1' && d2.slider === '2.5 s' && d2.t < 1, 'box 1 kept its 2.5 s all-red overnight into a fresh day, the new box has the default, and the slider shows box 1\'s', `${d2.allRed.join(', ')}; ${d2.slider}; ${d2.t.toFixed(2)} s in`);
    // the grid locks: the run is over, and the best stays
    await page.evaluate(() => { window.__signalCity.step(60); window.__signalCity.world.stats.gridlock = true; window.__signalCity.game.paused = false; });
    await waitFor(page, () => document.getElementById('endScrim').classList.contains('show'), { timeout: 15000 });
    const e2 = await page.evaluate(() => ({
      title: document.getElementById('endTitle').textContent, why: document.querySelector('#endBody .end-why')?.textContent,
      run: document.querySelector('#endBody [data-run]')?.textContent, best: document.querySelector('#endBody [data-best]')?.textContent,
      button: document.getElementById('retryBtn').textContent, saved: (s => (s.data || s).endless)(JSON.parse(localStorage.getItem('signal_city_v1'))),
    }));
    ok(e2.title === 'The run is over.' && /the grid locked/.test(e2.why) && e2.button === 'Again', 'a locked grid ends the run: "The run is over.", the reason, and Again', `${e2.title} ${e2.why}`);
    ok(/^1 day · /.test(e2.run) && !/new/.test(e2.best) && e2.saved.days === 1 && e2.saved.runs === 1, 'the run stands at the one day it survived, and the best is unchanged', `${e2.run}; ${e2.best}; ${JSON.stringify(e2.saved)}`);
    await page.click('#retryBtn');
    await waitFor(page, () => window.__signalCity.world && window.__signalCity.world.nodes.length === 1, { timeout: 5000 });
    const d3 = await page.evaluate(() => ({ run: window.__signalCity.run, name: document.getElementById('levelName').textContent, allRed: window.__signalCity.world.controllers[0].timing.allRed }));
    ok(d3.run.seed === 7 && d3.run.day === 1 && d3.run.days === 0 && d3.name === 'Endless, day 1' && d3.allRed === 1, 'Again starts the same city over from day 1, with nothing carried', JSON.stringify(d3.run));
    // what a reload has to survive: the best on the card (#39)
    await page.reload({ waitUntil: 'load' });
    await waitFor(page, () => !!window.__signalCity && !!document.querySelector('.level-card[data-level="endless"]'), { timeout: 15000 });
    const c2 = await page.evaluate(() => ({ best: document.querySelector('.level-card[data-level="endless"] .lv-best')?.textContent, e: window.__signalCity.game.save.endless }));
    ok(c2.best === `best 1 day · ${e1.result.points} points` && c2.e.runs === 1, 'after a reload the card reads the best; the second run, left before its first day ended, is not counted', `${c2.best}; ${c2.e.runs} run`);
    await page.evaluate(() => document.querySelector('.level-card[data-level="endless"]').scrollIntoView({ block: 'center' }));
    await shot(page, 'endless-card');
    // put the save back
    await page.evaluate(k => { const g = window.__signalCity.game; const o = JSON.parse(k); if (o.tb) g.save.levels['two-blocks'] = o.tb; else delete g.save.levels['two-blocks']; g.save.endless = o.e; g.slot.save(g.save); g.buildLevelSelect(); }, keep);
    ok(errors.length === 0, 'no page errors through a run', errors.join(' | '));
  });

  await section('a grid of six boxes (M9): the picker, the camera, a ring among signals', async () => {
    // growCells(2, 6): 1,1 1,2 0,1 2,2oT 3,2 0,0o, two rings and a T across the whole 4 by 3 district
    await page.evaluate(() => { window.__signalCity.startGrid(2, 6); window.__signalCity.game.paused = true; });
    await new Promise(r => setTimeout(r, 300));
    const g0 = await page.evaluate(() => {
      const w = window.__signalCity.world, r = window.__signalCity.game.renderer;
      return {
        nodes: w.nodes.length, rings: w.nodes.filter(n => n.roundabout).map(n => n.node).join(','),
        buttons: [...document.querySelectorAll('#nodes .node')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
        widths: [...document.querySelectorAll('#nodes .node')].map(b => Math.round(b.getBoundingClientRect().width)),
        onScreen: w.nodes.map(n => { const p = r.toScreen(n.origin[0], n.origin[1]); return p.x > 20 && p.x < r.width - 20 && p.y > 20 && p.y < r.height - 20; }),
        scale: r.scale, stage: document.getElementById('stage').textContent, ringNote: !document.getElementById('ringNote').classList.contains('hidden'),
      };
    });
    ok(g0.nodes === 6 && g0.rings === '3,5', 'six boxes, the fourth and sixth of them rings', `rings at ${g0.rings}`);
    ok(g0.buttons.join() === 'Box 1*,Box 2,Box 3,Box 4 · ring,Box 5,Box 6 · ring', 'the panel offers every box by number, the rings marked, the first selected', g0.buttons.join());
    ok(g0.widths.every(x => x >= 70), 'and the buttons wrap three to a row rather than shrink past reading', g0.widths.join(' '));
    ok(g0.onScreen.every(Boolean) && g0.scale >= 1.2 && g0.scale < 2.5, 'the camera frames all six boxes, under the corridor\'s 2.5 px/m floor', `${g0.onScreen.join(' ')} at ${g0.scale.toFixed(2)} px/m`);
    ok(/^Box 1: /.test(g0.stage) && !/ · Box/.test(g0.stage) && !g0.ringNote, 'the stage line reads the selected box alone, and it is a signal', g0.stage);
    // a click on the board at box 4 (a ring) selects it
    const at = await page.evaluate(() => { const n = window.__signalCity.world.nodes[3], r = window.__signalCity.game.renderer, b = document.getElementById('board').getBoundingClientRect(); const p = r.toScreen(n.origin[0], n.origin[1]); return { x: b.left + p.x, y: b.top + p.y }; });
    await page.mouse.click(at.x, at.y);
    await page.evaluate(() => window.__signalCity.step(1));
    const g1 = await page.evaluate(() => ({
      node: window.__signalCity.game.node, on: document.querySelector('#nodes .node.on')?.dataset.node,
      note: document.getElementById('ringNote').classList.contains('hidden') ? '' : document.getElementById('ringNote').textContent,
      strip: !document.getElementById('strip').classList.contains('hidden'),
      disabled: [...document.querySelectorAll('#phases .phase')].every(b => b.disabled),
      stage: document.getElementById('stage').textContent,
    }));
    ok(g1.node === 3 && g1.on === '3', 'a click on the board at the fourth box selects it', `node ${g1.node}`);
    ok(/^A roundabout/.test(g1.note) && !/shop/.test(g1.note) && !g1.strip, 'the ring note shows, without the shop\'s switch a grid has none of, and the strip hides', g1.note);
    ok(g1.disabled && g1.stage === 'Box 4: Roundabout: no signals', 'its phase buttons are off and the stage line says why', g1.stage);
    await page.click('#nodes .node[data-node="1"]');
    await page.keyboard.press('2');
    const g2 = await page.evaluate(() => ({ node: window.__signalCity.game.node, next: window.__signalCity.world.controllers.map(c => c.next), note: !document.getElementById('ringNote').classList.contains('hidden'), strip: !document.getElementById('strip').classList.contains('hidden') }));
    ok(g2.node === 1 && g2.next[1] === 1 && g2.next.filter(x => x !== null).length === 1 && !g2.note && g2.strip, 'Box 2 by its button, and pressing 2 reaches its controller and no other', JSON.stringify(g2.next));
    await page.evaluate(n => window.__signalCity.step(n), 60 * 60);
    await new Promise(r => setTimeout(r, 300));
    const g3 = await page.evaluate(() => { const w = window.__signalCity.world; return { handoffs: w.stats.handoffs, nodes: new Set(w.cars.filter(c => !c.done).map(c => c.path.node)).size }; });
    ok(g3.handoffs > 10 && g3.nodes >= 5, 'a minute in, cars cross between the boxes and most boxes have some', `${g3.handoffs} handoffs, cars at ${g3.nodes} boxes`);
    await shot(page, 'grid-6');
    // the whole district: twelve boxes still framed
    await page.evaluate(() => { window.__signalCity.startGrid(2, 12); window.__signalCity.game.paused = true; });
    await new Promise(r => setTimeout(r, 300));
    const g4 = await page.evaluate(() => { const w = window.__signalCity.world, r = window.__signalCity.game.renderer; return { n: document.querySelectorAll('#nodes .node').length, onScreen: w.nodes.every(n => { const p = r.toScreen(n.origin[0], n.origin[1]); return p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height; }), scale: r.scale }; });
    ok(g4.n === 12 && g4.onScreen, 'twelve boxes, twelve buttons, every box on the board', `at ${g4.scale.toFixed(2)} px/m`);
    await shot(page, 'grid-12');
    ok(errors.length === 0, 'no page errors on a grid', errors.join(' | '));
  });

  await section('the sprite gallery', async () => {
    await page.goto(`${BASE}/Projects/signal-city/sprites.html`, { waitUntil: 'load', timeout: 45000 });
    await new Promise(r => setTimeout(r, 800));
    const g = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      text: document.body.textContent,
      button: !!document.querySelector('button'),
    }));
    ok(g.canvases >= 10, 'the gallery drew at least ten canvases', String(g.canvases));
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
