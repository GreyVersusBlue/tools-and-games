// play-games.mjs — end-to-end regression suite for the six non-Castle games.
//
//   npm run games                  all six
//   npm run games fourth-quarter   just one
//
// Castle Conundrum has play-castle.mjs, which goes deeper than this on one game.
// This is the same idea spread across the rest of the board: drive the real page
// with real clicks and keystrokes, then assert what a player would notice.
//
// WHY, given four of these projects already have Node smoke suites: those suites
// import the engine modules and drive them directly (Faire Weekend's even builds a
// JSDOM). They are good, and they are blind to the wiring — a method that main.js
// calls and the phase object never had, a button whose handler was never attached,
// a save that loads into a blank room. `day.rebuildStations` was exactly that:
// 122 campaign assertions passed while "New Game" threw on the first click a real
// player makes. Nothing here re-tests engine arithmetic; every beat is something
// that only breaks in a browser.
//
// WHY HEADED: three of the six render WebGL and need pointer lock. Same reason as
// play-castle.mjs and capture-previews.mjs — see README.md. Windows will open and
// visibly play. That is expected.
//
// Screenshots land in ./shots/games/. Exits non-zero on any missed beat.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, launch, prepPage } from './harness.mjs';
import { attachSceneProbe, waitForProbe, camState, lookAt } from './drive.mjs';
import { GAMES, enter, savedState, wait } from './games.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'shots', 'games');
const PORT = 8126; // 8123 checks/shoot, 8124 play-castle, 8125 previews
const BASE = `http://127.0.0.1:${PORT}`;

/* ------------------------------------------------------------------- beats -- */

const SUITES = {
  // ---- Integer Foundry ------------------------------------------------------
  // The one project on the board with no Node test of any kind: its whole engine
  // is an IIFE inside a single HTML file, reachable only through a browser.
  'integer-foundry': async (p, t) => {
    const place = async (tool, x, y) => {
      await p.click(`[data-tool="${tool}"]`);
      await p.click(`#grid .cell[data-x="${x}"][data-y="${y}"]`);
    };

    const tools = await p.$$eval('#tools .tool-btn', els => els.map(e => e.dataset.tool));
    t.ok(tools.length >= 5, 'the fabricator palette is built', tools.join(' '));
    const locked = await p.$$eval('#tools .tool-btn.locked', els => els.map(e => e.dataset.tool));
    t.ok(locked.length > 0, 'the shop-gated fabricators start locked', locked.join(' '));

    // A source, two belts, a +1, two more belts, a second +1 and a sink: the
    // shortest line that exercises a packet being made, moved, operated on twice
    // and consumed.
    await place('source', 0, 2);
    for (const x of [1, 2]) await place('belt', x, 2);
    await place('add1', 3, 2);
    for (const x of [4, 5]) await place('belt', x, 2);
    await place('add1', 6, 2);
    await place('sink', 7, 2);
    const placed = await p.$$eval('#grid .cell:not(.empty)', els => els.length);
    t.ok(placed === 8, 'eight fabricators on the grid', `${placed} non-empty cells`);

    // TICK_MS is 550 and the source fires every 3 ticks, so a packet needs ~1.7 s
    // to appear and ~4 s to walk the line. Fifteen seconds is several deliveries.
    const moved = await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell .packet').length > 0,
      null, { timeout: 15000 }).then(() => true, () => false);
    t.ok(moved, 'packets are moving down the line');
    await wait(14000);
    await t.shot('line-running');

    const s = await savedState(p, 'integer-foundry');
    t.ok(!!s, 'the game wrote a save');
    const target = s.sinks[0].target;
    t.ok(typeof target === 'number' && target >= 2, 'the sink is asking for a number', `target ${target}`);

    // The log on screen, not the one in the save. The save is debounced rather
    // than on a timer now, so it is under a second behind rather than up to eight,
    // but locked decision #39 still holds: assert the DOM for what just happened.
    //
    // A source emits a 1 and the two +1s each add one, so whatever reaches the
    // sink has to be a 3. That one number is the whole pipeline: packet spawned,
    // carried down the belts, operated on twice, judged on arrival. The target is
    // randomised per order, so a 3 is almost certainly the wrong answer here —
    // and being told so, in those words, is the assertion.
    const lines = await p.$$eval('#log div', els => els.map(e => e.textContent.trim()));
    t.ok(lines.length > 1, 'the foundry log filled', `${lines.length} lines`);
    const verdicts = lines.filter(l => /sink|order filled/i.test(l));
    t.ok(verdicts.length > 0, 'the sink judged the packets that arrived', verdicts[0] || '');
    t.ok(verdicts.some(l => /\b3\b/.test(l)), 'and they arrived as 3s — both +1 fabricators applied');

    // The reload test: the grid, the ingots and the offline-progress branch
    // (which reads lastSave before anything else runs) all come back through it.
    await p.reload({ waitUntil: 'load' });
    await GAMES['integer-foundry'].open(p);
    const back = await p.$$eval('#grid .cell:not(.empty)', els => els.length);
    t.ok(back === 8, 'the built line came back after a reload', `${back} cells`);

    // Fill the order the game actually asked for. Every order is now guaranteed
    // buildable on the floor the player has (Projects/integer-foundry/js/targets.js),
    // so the target does not need seeding and the outgoing page's autosave does not
    // need disarming: read the number and build a line that delivers it. Erase the
    // demo line first — its sink already paid out a 3 and won't ask again until it
    // does, which would leave nothing to build toward.
    await p.click('[data-tool="erase"]');
    for (const [x, y] of [[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2]]) {
      await p.click(`#grid .cell[data-x="${x}"][data-y="${y}"]`);
    }
    await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      null, { timeout: 10000 });

    // A sink has to be on the floor before its order is on screen, so park one,
    // read it, clear it. state.sinks[0] survives the erase, so the number holds.
    await place('sink', 0, 0);
    await p.waitForSelector('#grid .cell[data-x="0"][data-y="0"].sink .sink-target');
    const want = Number((await p.$eval('.sink-target', el => el.textContent)).replace(/\D/g, ''));
    t.ok(Number.isInteger(want) && want >= 2 && want <= 12,
      'the opening order is between 2 and 12', `wants ${want}`);
    await p.click('[data-tool="erase"]');
    await p.click('#grid .cell[data-x="0"][data-y="0"]');
    await p.waitForFunction(
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      null, { timeout: 10000 });

    // A source emits 1 and every +1 adds one, so `want` needs want-1 of them. Row
    // 2 west to east, turn down at column 7, row 3 east to west: 14 operator cells
    // available, and the opening ramp never asks for more than 12.
    const chain = [];
    for (let x = 1; x <= 7 && chain.length < want - 1; x++) chain.push({ x, y: 2, dir: 'E' });
    if (chain.length < want - 1) {
      chain[chain.length - 1].dir = 'S';
      for (let x = 7; x >= 1 && chain.length < want - 1; x--) chain.push({ x, y: 3, dir: 'W' });
    }
    const last = chain[chain.length - 1];
    const sinkAt = !last ? { x: 1, y: 2 }
      : last.dir === 'E' ? { x: last.x + 1, y: last.y }
      : last.dir === 'S' ? { x: last.x, y: last.y + 1 }
      : { x: last.x - 1, y: last.y };

    await place('source', 0, 2);
    await p.click('[data-tool="add1"]');
    for (const c of chain) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    // Clicking a placed tile with the same tool selected steps its output E>S>W>N.
    for (const c of chain) {
      const turns = c.dir === 'E' ? 0 : c.dir === 'S' ? 1 : 2;
      for (let i = 0; i < turns; i++) await p.click(`#grid .cell[data-x="${c.x}"][data-y="${c.y}"]`);
    }
    await place('sink', sinkAt.x, sinkAt.y);
    t.ok((await p.$$eval('#grid .cell:not(.empty)', els => els.length)) === want + 1,
      'built a line of exactly the right length', `for an order of ${want}`);

    const filled = await p.waitForFunction(
      () => /[1-9]/.test(document.getElementById('stat-orders').textContent),
      null, { timeout: 30000 }).then(() => true, () => false);
    await t.shot('order-filled');
    const live = await p.evaluate(() => ({
      orders: document.getElementById('stat-orders').textContent.trim(),
      ingots: document.getElementById('stat-ingots').textContent.trim(),
      log: [...document.querySelectorAll('#log div')].map(e => e.textContent.trim()),
    }));
    t.ok(filled, 'a matching packet filled the order',
      live.log.find(l => /order filled/i.test(l)) || live.log[0] || '');
    t.ok(new RegExp(`Order filled: ${want} `).test(live.log.join(' | ')),
      `the sink took a ${want}`, live.log.find(l => /order filled/i.test(l)) || '');
    t.ok(/[1-9]/.test(live.ingots), 'and the sink paid out in ingots', `${live.ingots} ingots`);

    // The save is debounced at 700ms now, not an 8-second interval, but locked
    // decision #39 still holds: assert the DOM for what just happened, and give
    // the save a moment before reading it for what has to survive a reload.
    await wait(1500);
    const s2 = await savedState(p, 'integer-foundry');
    t.ok(s2.ordersFilled > 0 && s2.ingots > 0, 'and the takings reached the save',
      `${s2.ordersFilled} orders, ${s2.ingots} ingots`);
    t.ok(s2.lifetimeIngots >= s2.ingots, 'lifetime ingots tracks at least the current pile');
    t.ok(s2.sinks[0].target !== want || s2.ordersFilled > 1,
      'the sink rolled a new order after filling one', `now wants ${s2.sinks[0].target}`);
  },

  // ---- Closing Time ---------------------------------------------------------
  'closing-time': async (p, t) => {
    const navs = await p.$$eval('#nav [data-nav]', els => els.map(e => e.dataset.nav));
    t.ok(navs.length === 6, 'six desk screens in the nav', navs.join(' '));

    // Every screen renders. renderMLS, renderMyListings and renderOffice each
    // reach into state that is empty on day one, which is where a render throws.
    for (const nav of navs) {
      await p.click(`#nav [data-nav="${nav}"]`);
      await wait(150);
      const kids = await p.$$eval('#main > *', els => els.length);
      t.ok(kids > 0, `the ${nav} screen renders`, `${kids} top-level nodes`);
    }
    await p.click('#nav [data-nav="mls"]');
    const listings = await p.$$eval('.mls-grid > *', els => els.length);
    t.ok(listings > 3, 'the MLS board is populated', `${listings} listings`);

    // Two weeks of days. endDay() is the whole simulation: the calendar, market
    // drift, client patience, deal timers and the random event roll all tick
    // there, and a thrown error inside any of them leaves the day counter stuck.
    const before = await savedState(p, 'closing-time');
    let handled = 0;
    for (let i = 0; i < 14; i++) {
      // An event can queue a modal decision, and endDay() refuses to run while
      // one is pending — it toasts and returns. Take the first offered choice.
      for (let guard = 0; guard < 4 && await p.$('#modal-root .modal'); guard++) {
        const choice = await p.$('#modal-root .modal-actions button');
        if (!choice) break;
        await choice.click();
        await wait(200);
        handled++;
      }
      await p.click('#endDayBtn');
      await wait(220);
    }
    const after = await savedState(p, 'closing-time');
    await t.shot('two-weeks-in');
    t.ok(after.day === before.day + 14, 'fourteen days actually passed',
      `day ${before.day} -> ${after.day}${handled ? `, ${handled} decision(s) taken` : ''}`);
    t.ok(after.log.length > before.log.length, 'the ledger recorded the fortnight',
      `${before.log.length} -> ${after.log.length} entries`);
    t.ok(Number.isFinite(after.cash), 'cash is still a number', String(after.cash));
    t.ok(after.market.rate > 0 && after.market.rate < 30, 'the mortgage rate drifted inside sane bounds',
      `${after.market.rate.toFixed(2)}%`);
    t.ok(after.clients.length > 0, 'clients came through the door', `${after.clients.length} on the books`);
    const dom = Object.values(after.listingsState).some(l => l.dom > 0);
    t.ok(dom, 'listings are ageing on the market');

    // The career resumes rather than re-offering the brokerage modal.
    await p.reload({ waitUntil: 'load' });
    await GAMES['closing-time'].open(p);
    const resumed = await savedState(p, 'closing-time');
    t.ok(!(await p.$('.start-screen')), 'a reload resumes the career instead of asking again');
    t.ok(resumed.day === after.day, 'and resumes on the same day', `day ${resumed.day}`);

    // A random event can leave a modal open on resume — the save bar sits under
    // it (`.modal-back` covers the screen) until it's dismissed.
    const closeModals = async () => {
      for (let g = 0; g < 4 && await p.$('#modal-root .modal'); g++) {
        const choice = await p.$('#modal-root .modal-actions button');
        if (!choice) break;
        await choice.click(); await wait(200);
      }
    };
    await closeModals();

    // The save moved onto assets/js/gvb-save.js this session — the version stamp,
    // the footer save bar, and the export/import/corrupt/legacy paths it added.
    t.ok(resumed.__v === 1, 'the save carries a version stamp');

    const kinds = await p.$$eval('#save-bar [data-gvb]', els => els.map(e => e.dataset.gvb));
    t.ok(kinds.join(' ') === 'export import', 'export and import are in the footer', kinds.join(' '));

    await p.evaluate(() => {
      window.__ctExports = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { blob.text().then(txt => window.__ctExports.push(txt)); return create(blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (!this.download) return click.call(this); };
    });
    await p.click('#save-bar [data-gvb="export"]');
    await p.waitForFunction(() => window.__ctExports.length > 0, null, { timeout: 5000 });
    const ctText = await p.evaluate(() => window.__ctExports[0]);
    const ctEnv = JSON.parse(ctText);
    t.ok(ctEnv.format === 'gvb-save' && ctEnv.game === 'closing-time', 'export wrote a gvb-save envelope');
    t.ok(ctEnv.state.day === resumed.day, 'holding the career it was taken from', `day ${ctEnv.state.day}`);
    const topbarAtExport = await p.$eval('.stat-val', el => el.textContent.trim());

    // Import takes the career back. End four more days first so there is
    // something for the import to undo, then answer the file chooser before
    // opening it. Assert the DOM (locked decision #39), not just the save, so an
    // import that lands in state without redrawing does not pass by accident.
    for (let i = 0; i < 4; i++) {
      await closeModals();
      await p.click('#endDayBtn'); await wait(220);
    }
    await closeModals();
    fs.writeFileSync(path.join(OUT, 'ct-export.json'), ctText);
    await setFiles(p, path.join(OUT, 'ct-export.json'), () => p.click('#save-bar [data-gvb="import"]'));
    await wait(500);
    const topbarAfterImport = await p.$eval('.stat-val', el => el.textContent.trim());
    const importedState = await savedState(p, 'closing-time');
    t.ok(importedState.day === resumed.day, 'import restored the earlier career',
      `back to day ${importedState.day}`);
    t.ok(topbarAfterImport === topbarAtExport,
      'the topbar redrew to match, not just the save underneath it',
      `"${topbarAfterImport}"`);

    // A corrupt save does not boot the game.
    await p.evaluate(() => localStorage.setItem('closingTime.save.v1',
      JSON.stringify({ day: 'tuesday', cash: 'lots', clients: 'none' })));
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.start-screen, #nav [data-nav]');
    t.ok(!!(await p.$('.start-screen')), 'a corrupt save drops you at the start screen, not into it');

    // A legacy save with no __v and no seed still loads and still plays.
    await p.evaluate(() => localStorage.setItem('closingTime.save.v1', JSON.stringify({
      day: 3, cash: 5000, brokerageId: 'bk_indep', clients: [],
    })));
    await p.reload({ waitUntil: 'load' });
    await GAMES['closing-time'].open(p);
    const legacy = await savedState(p, 'closing-time');
    t.ok(!(await p.$('.start-screen')), 'an unversioned legacy save boots straight into the desk');
    t.ok(typeof legacy.seed === 'number' && Number.isFinite(legacy.seed),
      'and got a real seed rather than an undefined one', `seed ${legacy.seed}`);
  },

  // ---- Faire Weekend --------------------------------------------------------
  'faire-weekend': async (p, t) => {
    const tabs = await p.$$eval('#tabs [data-tab]', els => els.map(e => e.dataset.tab));
    t.ok(tabs.length === 3, 'three desk tabs during the planning phase', tabs.join(' '));

    // Build the four cheapest kinds. startingCash is 5200 and a Stage is 1700.
    let planned = 0;
    for (const kind of ['demo', 'food', 'vendor', 'stage']) {
      await p.click(`[data-action="selectBuild"][data-kind="${kind}"]`);
      const ghost = await p.$('.plot-marker.ghost');
      if (!ghost) { await p.click('[data-action="cancelBuild"]').catch(() => {}); continue; }
      await ghost.click();
      await wait(150);
      planned++;
    }
    t.ok(planned === 4, 'four structures placed on the site plan', `${planned} placed`);

    const cashBefore = (await savedState(p, 'faire-weekend')).cash;
    await p.click('[data-tab="fairfloor"]');
    await wait(300);
    // The commit banner is rendered by renderFairFloor, so this click finds
    // nothing while the Office tab is up.
    await p.click('[data-action="commitAll"]');
    await wait(400);
    const mid = await savedState(p, 'faire-weekend');
    t.ok(mid.builtPlots.length >= 3, 'committing turned plans into built plots',
      `${mid.builtPlots.length} built`);
    t.ok(mid.cash < cashBefore, 'and the build was paid for', `$${cashBefore} -> $${mid.cash}`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await t.shot('grounds-built');

    // Run the weekend. The phase machine is plan -> (openGates) -> report ->
    // (nextDay) -> plan, with weekendEnd between weekends; simulateDay() is the
    // engine's centrepiece and openGates is the only thing that calls it in anger.
    let days = 0;
    for (let i = 0; i < 4; i++) {
      const gates = await p.$('[data-action="openGates"]');
      if (gates) {
        await gates.click();
        await wait(450);
        days++;
        await p.click('[data-action="nextDay"]').catch(() => {});
        await wait(350);
      }
      await p.click('[data-action="startNextWeekend"]').catch(() => {});
      await wait(300);
    }
    const after = await savedState(p, 'faire-weekend');
    await t.shot('after-the-weekend');
    t.ok(days >= 2, 'the gates opened on more than one day', `${days} day(s) run`);
    t.ok(after.history.length === days, 'every day left a result in the history',
      `${after.history.length} results`);
    t.ok(after.day > mid.day || after.season > mid.season, 'the calendar moved',
      `day ${mid.day} -> ${after.day}, weekend ${mid.season} -> ${after.season}`);
    t.ok(Number.isFinite(after.cash), 'cash is still a number', String(after.cash));
    t.ok(after.reputation >= 0 && after.reputation <= 100, 'reputation stayed in range',
      String(Math.round(after.reputation)));
    // Reading a completed run out of history, not lastResult — still the right
    // source for a day that's over.
    const gate = after.history[0]?.attendance;
    t.ok(Number.isFinite(gate) && gate > 0, 'guests came through the gate',
      `${gate} on the first day`);

    await p.reload({ waitUntil: 'load' });
    await GAMES['faire-weekend'].open(p);
    const resumed = await savedState(p, 'faire-weekend');
    t.ok(resumed.builtPlots.length === after.builtPlots.length,
      'the grounds came back after a reload', `${resumed.builtPlots.length} plots`);

    // Stage 21: a report is now on disk while it is on screen, so the suite can
    // assert the thing an earlier comment here used to work around. Open one
    // more day and read the save mid-report, without clicking Next Day first.
    const gates = await p.$('[data-action="openGates"]');
    if (gates) {
      await gates.click();
      await wait(450);
      const midReport = await savedState(p, 'faire-weekend');
      t.ok(midReport.phase === 'report',
        'the save says "report" while a report is on screen', midReport.phase);
      t.ok(Number.isFinite(midReport.lastResult?.attendance),
        'and it carries the day it is showing',
        `${midReport.lastResult?.attendance} through the gate`);

      // The screen and the save agree — locked decision #39 still applies, so
      // the gate figure is read off the DOM and compared to the save, not
      // trusted from the save alone.
      const onScreen = await p.$eval('.ticket-stub',
        el => el.textContent.replace(/[^0-9]/g, ' ').trim().split(/\s+/).map(Number));
      t.ok(onScreen.includes(midReport.lastResult.attendance),
        'the attendance on the ticket stub is the attendance in the save');

      // And the day is final: reloading comes back to the same report rather
      // than rewinding to before the gates opened.
      const cashAtReport = midReport.cash;
      await p.reload({ waitUntil: 'load' });
      await GAMES['faire-weekend'].open(p);
      const afterReload = await savedState(p, 'faire-weekend');
      t.ok(afterReload.cash === cashAtReport,
        'reloading on a report keeps the day rather than replaying it',
        `$${cashAtReport} -> $${afterReload.cash}`);
      t.ok(!(await p.$('[data-action="openGates"]')),
        'and the gates cannot be opened twice on the same day');
    }
  },

  // ---- Golden Hour ----------------------------------------------------------
  // The sand was hotlinked from dl.polyhaven.org until session 7 vendored it, so
  // the beats that matter here are that the real photographed texture is on the
  // ground and that nothing left the site to put it there.
  'golden-hour': async (p, t) => {
    const start = await camState(p);
    await p.keyboard.down('KeyW'); await wait(2500); await p.keyboard.up('KeyW');
    const walked = await camState(p);
    const moved = Math.hypot(walked.pos[0] - start.pos[0], walked.pos[1] - start.pos[1]);
    t.ok(moved > 2, 'W walks down the beach', `${moved.toFixed(2)} m`);

    const turned = await lookAt(p, { facing: 1.2, pitch: -0.05, sens: 0.0022 });
    t.ok(Math.abs(turned.facing - 1.2) < 0.15, 'mouse look turns the camera', `facing ${turned.facing}`);

    const scene = await p.evaluate(() => {
      const s = window.__scene;
      let meshes = 0, lights = 0, textured = 0, sand = null, normals = false;
      s.traverse(o => {
        if (o.isLight) lights++;
        if (!o.isMesh) return;
        meshes++;
        const map = o.material?.map;
        if (!map) return;
        textured++;
        // A CanvasTexture's image is a <canvas> with no src; a file-backed one is
        // an <img>. That difference is how you tell the real photographed sand
        // from terrain.js's procedural stand-in without looking at the screen.
        if (map.image?.src) { sand = map.image.src; normals = !!o.material.normalMap; }
      });
      return { meshes, lights, textured, sand, normals };
    });
    t.ok(scene.meshes > 3, 'the beach is built', `${scene.meshes} meshes, ${scene.lights} lights`);
    t.ok(/aerial_beach_01_diff_1k\.jpg$/.test(scene.sand || ''),
      'the photographed sand texture loaded, not the procedural stand-in',
      scene.sand || '(canvas texture only)');
    t.ok(/^http:\/\/127\.0\.0\.1/.test(scene.sand || ''), 'and it came from the site itself');
    t.ok(scene.normals, 'the normal map came with it');
    t.ok(p.__blocked.length === 0, 'nothing offsite was even attempted',
      p.__blocked.slice(0, 2).join(' | '));
    await t.shot('shoreline');

    // The beach has things on it as of session 8: a groyne at the west end, a
    // boulder cluster at the east, driftwood, and a 460-piece wrack line along
    // the tide mark. Six merged/instanced meshes for the lot. Assert the wrack
    // is instanced rather than 460 objects, because the day someone "simplifies"
    // that into a loop is the day this page starts costing 460 draw calls.
    const props = await p.evaluate(() => {
      let instanced = 0, instances = 0, merged = 0;
      window.__scene.traverse(o => {
        if (o.isInstancedMesh) { instanced++; instances += o.count; }
        else if (o.isMesh && o.geometry?.attributes?.position?.count > 400
                 && !o.material?.uniforms) merged++;
      });
      return { instanced, instances, merged };
    });
    t.ok(props.instances > 400, 'the wrack line is on the sand',
      `${props.instances} pieces across ${props.instanced} instanced meshes`);
    t.ok(props.instanced <= 4, 'and it is instanced, not 460 separate objects');

    // Arrow keys look. This is the whole keyboard-only path: nothing in this
    // piece needs aiming, so nothing in it should require pointer lock, and a
    // player who presses Esc must still be able to turn around.
    await p.evaluate(() => document.exitPointerLock?.());
    await wait(200);
    const beforeTurn = await camState(p);
    await p.keyboard.down('ArrowLeft'); await wait(900); await p.keyboard.up('ArrowLeft');
    const afterTurn = await camState(p);
    const dyaw = Math.abs(afterTurn.facing - beforeTurn.facing);
    t.ok(dyaw > 0.5, 'the arrow keys turn the camera with pointer lock released',
      `${dyaw.toFixed(2)} rad`);

    // The sun descends while you walk, and everything derived from it moves with
    // it. Reading the fog is the cheap way to catch the failure that matters:
    // one of the eight things setSunElevation() drives getting left behind.
    const sunNow = await p.evaluate(() => {
      let el = null;
      window.__scene.traverse(o => {
        const u = o.material?.uniforms;
        if (u?.sunPosition) el = Math.asin(u.sunPosition.value.y) * 180 / Math.PI;
      });
      return { el, fog: window.__scene.fog.color.getHexString() };
    });
    await wait(6000);
    const sunLater = await p.evaluate(() => {
      let el = null;
      window.__scene.traverse(o => {
        const u = o.material?.uniforms;
        if (u?.sunPosition) el = Math.asin(u.sunPosition.value.y) * 180 / Math.PI;
      });
      return { el, fog: window.__scene.fog.color.getHexString() };
    });
    t.ok(sunLater.el < sunNow.el - 0.02, 'the sun is going down',
      `${sunNow.el.toFixed(2)}° to ${sunLater.el.toFixed(2)}° in 6 s`);
    t.ok(sunLater.fog !== sunNow.fog, 'and the fog colour came with it',
      `#${sunNow.fog} to #${sunLater.fog}`);
  },

  // ---- Aphelion -------------------------------------------------------------
  'aphelion': async (p, t) => {
    const fade = await p.$eval('#fade', el => +getComputedStyle(el).opacity);
    t.ok(fade < 0.15, 'the fade from black finished', `opacity ${fade}`);

    const hud = await p.evaluate(() => {
      const w = id => document.getElementById(id)?.style.width || '';
      return {
        power: w('bar-power'), oxygen: w('bar-oxygen'), hull: w('bar-hull'),
        day: document.getElementById('daybox')?.textContent.trim(),
      };
    });
    t.ok(!!hud.power && !!hud.oxygen && !!hud.hull, 'the three HUD gauges have values',
      `power ${hud.power}, oxygen ${hud.oxygen}, hull ${hud.hull}`);
    t.ok(!!hud.day, 'the day counter is on screen', hud.day);

    // The opening CERES line lands a beat after the fade, not with it — waiting
    // for it rather than sampling once is the difference between testing the
    // toast and testing this script's timing.
    const toasted = await p.waitForFunction(
      () => document.querySelectorAll('#toasts > *').length > 0,
      null, { timeout: 8000 }).then(() => true, () => false);
    const said = await p.$eval('#toasts', el => el.textContent.trim().slice(0, 60)).catch(() => '');
    t.ok(toasted, 'the opening CERES message arrived', said);

    const start = await camState(p);
    await p.keyboard.down('KeyW'); await wait(1600); await p.keyboard.up('KeyW');
    const moved = await camState(p);
    const d = Math.hypot(moved.pos[0] - start.pos[0], moved.pos[1] - start.pos[1]);
    t.ok(d > 1, 'W walks through the hab', `${d.toFixed(2)} m`);
    await t.shot('aboard');

    // TAB reads the logbook. It is the only UI besides the gauges, and it is
    // wired on document rather than on an element, which is the kind of thing
    // that quietly stops working.
    await p.keyboard.press('Tab');
    await wait(400);
    const open = await p.$eval('#logbook', el => el.classList.contains('open'));
    t.ok(open, 'TAB opens the logbook');
    await p.keyboard.press('Tab');
    await wait(300);
    t.ok(!(await p.$eval('#logbook', el => el.classList.contains('open'))), 'and TAB closes it again');

    // The save bar, adopted onto assets/js/gvb-save.js this session. It lives in
    // the logbook rather than a title screen — this game has no persistent title
    // card to hang one off, since it vanishes for good once you board.
    await p.keyboard.press('Tab'); // reopen the logbook
    await wait(400);
    const barButtons = await p.$$eval('#savebar button', els => els.map(b => b.dataset.gvb));
    t.ok(barButtons.join(',') === 'export,import,reset',
      'the save bar mounted three buttons in the logbook', barButtons.join(', '));

    const exported = await p.evaluate(() => new Promise(resolve => {
      const orig = URL.createObjectURL;
      URL.createObjectURL = blob => { blob.text().then(resolve); return orig(blob); };
      document.querySelector('[data-gvb="export"]').click();
    }));
    const env = JSON.parse(exported);
    t.ok(env.format === 'gvb-save' && env.game === 'aphelion' && env.version === 1,
      'Export save produced a gvb-save envelope', `${env.game} v${env.version}`);
    await p.keyboard.press('Tab');
  },

  // ---- The Fourth Quarter ---------------------------------------------------
  // The reason this file exists this session: the game just moved onto the shared
  // save system (assets/js/gvb-save.js), and nothing in Node can test a file
  // export, a file import, or a room being rebuilt around a loaded campaign.
  'fourth-quarter': async (p, t) => {
    const KEY = 'fq3d-save';
    const tag = () => p.textContent('#startTag');

    // --- the save bar mounted, with the buttons this page asked for and no others
    const bar = await p.$$eval('#saveBar button', els =>
      els.map(e => ({ kind: e.dataset.gvb, label: e.textContent.trim() })));
    t.ok(bar.length === 2, 'the save bar mounted two buttons', bar.map(b => b.label).join(' / '));
    t.ok(bar.map(b => b.kind).join(',') === 'export,import', 'export and import, in that order');
    t.ok(!bar.some(b => b.kind === 'reset'),
      "no second 'start over' — #wipeBtn above it already does that");

    t.ok((await tag()).includes('Day 1 at The Corner Tap'), 'a wiped save opens on day 1', await tag());

    await p.click('#startBtn');
    await wait(700);

    // --- dev menu: cash, stock, and a warp up every rung of the venue ladder.
    // rebuildVenue() tears the room down and builds the next tier's, and it used
    // to throw halfway through on a method DayPhase never had. Warping all four
    // tiers is the cheapest way to run that path four times.
    await p.keyboard.press('Backquote');
    await p.waitForSelector('#devOverlay [data-cash]');
    await p.click('[data-cash="10000"]');
    await p.click('[data-fillstock="1"]');
    for (const tier of ['fieldhouse', 'midtown', 'flagship']) {
      const btn = await p.$(`[data-warp="${tier}"]`);
      if (btn) { await btn.click(); await wait(400); }
    }
    await p.click('[data-day="7"]');
    await p.click('#devClose');
    await wait(400);
    const warped = await savedState(p, 'fourth-quarter');
    t.ok(warped.venue === 'flagship', 'warped up the whole venue ladder without throwing',
      `venue ${warped.venue}, day ${warped.day}`);
    t.ok(warped.cash >= 10000, 'the dev cash landed', `$${Math.round(warped.cash)}`);
    t.ok(p.__errs.length === 0, 'every venue rebuild ran clean',
      p.__errs.slice(0, 2).join(' | '));
    await t.shot('flagship-day');

    // --- the stored save is the slot's shape
    t.ok(warped.__v === 1, 'the stored save carries the schema version', `__v ${warped.__v}`);

    // --- a reload resumes it: this is slot.load() against a real localStorage,
    // and it also puts the start screen (and its save bar) back on top.
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#startBtn');
    const resumedTag = await tag();
    t.ok(resumedTag.includes('The Fourth Quarter') && resumedTag.includes(`Day ${warped.day}`),
      'a reload resumes the campaign and the start screen names the tier', resumedTag);

    // --- export. Capture what a download would write without writing one:
    // exportToFile builds a Blob, makes an object URL and clicks an <a download>.
    // Hooking createObjectURL reads the exact bytes the player would get, and
    // neutering the anchor keeps the browser from actually saving a file.
    // (Re-installed after the reload, which threw the last hook away.)
    await p.evaluate(() => {
      window.__exports = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { blob.text().then(txt => window.__exports.push(txt)); return create(blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (!this.download) return click.call(this); };
    });
    await p.click('#saveBar [data-gvb="export"]');
    await p.waitForFunction(() => window.__exports.length > 0, null, { timeout: 5000 });
    const text = await p.evaluate(() => window.__exports[0]);
    let env = null;
    try { env = JSON.parse(text); } catch (e) { /* asserted below */ }
    t.ok(!!env && env.format === 'gvb-save', 'Export save produced a gvb-save envelope');
    t.ok(env?.game === 'fourth-quarter' && env?.version === 1, 'stamped with the game and version',
      `${env?.game} v${env?.version}`);
    t.ok(env?.state?.venue === 'flagship' && env?.state?.day === warped.day,
      'holding the campaign as it stands', `day ${env?.state?.day} at ${env?.state?.venue}`);
    const said = await p.$eval('#saveBar .gvb-save-msg', el => el.textContent);
    t.ok(/fourth-quarter-save-\d{4}-\d{2}-\d{2}\.json/.test(said),
      'and the bar named the file it wrote', said);
    await t.shot('start-screen-save-bar');

    // --- import: hand the file back through the real picker, onto a wiped save,
    // so restoring the campaign is the only way the day can come back.
    fs.writeFileSync(path.join(OUT, 'fq-export.json'), text);
    await p.click('#wipeBtn');
    await wait(500);
    t.ok((await savedState(p, 'fourth-quarter')).day === 1, 'wiped back to day 1 before importing');
    await setFiles(p, path.join(OUT, 'fq-export.json'), () => p.click('#saveBar [data-gvb="import"]'));
    await wait(900);
    const imported = await savedState(p, 'fourth-quarter');
    t.ok(imported && imported.venue === 'flagship' && imported.day === warped.day,
      'importing the file restored the campaign over a wiped save',
      `day ${imported?.day} at ${imported?.venue}`);
    t.ok((await tag()).includes('The Fourth Quarter'),
      'and the room was rebuilt at the imported tier', await tag());

    // --- a save written before the slot existed: no version stamp, and missing
    // every field added since the first release. This is the migration path in a
    // real browser rather than in a stub.
    await p.evaluate(k => localStorage.setItem(k, JSON.stringify({
      day: 12, cash: 4321,
      stock: { wings: 5, beer: 9 },
      staff: [{ name: 'Old Timer', wage: 60 }],
    })), KEY);
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#startBtn');
    const legacyTag = await tag();
    t.ok(legacyTag.includes('Day 12'), 'an unversioned pre-slot save still boots', legacyTag);

    // Repair happens in memory on load; the disk only catches up when the game
    // next saves, so nudge it (the dev menu saves on every click).
    await p.click('#startBtn');
    await wait(600);
    await p.keyboard.press('Backquote');
    await p.waitForSelector('#devOverlay [data-cash]');
    await p.click('[data-cash="100"]');
    await p.click('#devClose');
    await wait(300);
    const repaired = await savedState(p, 'fourth-quarter');
    t.ok(repaired.day === 12 && Math.round(repaired.cash) === 4421,
      'the legacy books came through intact', `day ${repaired.day}, $${Math.round(repaired.cash)}`);
    t.ok(Array.isArray(repaired.upgrades) && !!repaired.stats && repaired.venue === 'cornerTap',
      'and got repaired on the way in');
    t.ok(typeof repaired.staff[0].speed === 'number',
      'including the walking speed a roleless staffer never had', String(repaired.staff[0].speed));
    t.ok(repaired.__v === 1, 'and it is re-saved with a version stamp');

    // --- New Game, from the start screen. The path that threw all session 6.
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#wipeBtn');
    const errsBefore = p.__errs.length;
    await p.click('#wipeBtn');
    await wait(600);
    const fresh = await savedState(p, 'fourth-quarter');
    t.ok(fresh.day === 1 && fresh.venue === 'cornerTap', 'New Game wiped back to day 1',
      `day ${fresh.day} at ${fresh.venue}`);
    t.ok((await tag()).includes('Day 1 at The Corner Tap'), 'and the start screen agrees', await tag());
    t.ok(p.__errs.length === errsBefore, 'with nothing thrown on the way',
      p.__errs.slice(errsBefore, errsBefore + 2).join(' | '));

    // --- open the doors: the night sim boots and patrons arrive.
    // Re-probe: window.__cam belonged to the page that was reloaded away.
    await t.probe();
    await p.click('#startBtn');
    await wait(700);
    await p.keyboard.press('Backquote');
    await p.waitForSelector('#devOverlay [data-cash]');
    await p.click('[data-cash="10000"]');
    await p.click('[data-fillstock="1"]');
    await p.click('#devClose');
    await wait(300);

    // --- the save bar is also on the Tonight panel and the box score, not just
    // the start overlay (v7 §9's open item, answered this session).
    await p.keyboard.press('KeyE');
    await p.waitForSelector('#panelOverlay [data-opendoors]', { timeout: 10000 });
    let doorBar = await p.$$eval('#doorSaveBar button', els => els.map(b => b.dataset.gvb));
    t.ok(doorBar.join(',') === 'export,import', 'the Tonight panel mounted its own save bar', doorBar.join(', '));
    await p.click('#panelClose');
    await wait(200);
    await p.keyboard.press('KeyE');
    await p.waitForSelector('#panelOverlay [data-opendoors]', { timeout: 10000 });
    doorBar = await p.$$eval('#doorSaveBar button', els => els.map(b => b.dataset.gvb));
    t.ok(doorBar.length === 2, 'reopening the panel does not stack a second pair', doorBar.join(', '));

    await p.evaluate(() => {
      window.__doorExports = [];
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = blob => { blob.text().then(txt => window.__doorExports.push(txt)); return create(blob); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (!this.download) return click.call(this); };
    });
    await p.click('#doorSaveBar [data-gvb="export"]');
    await p.waitForFunction(() => window.__doorExports.length > 0, null, { timeout: 5000 });
    const doorEnv = JSON.parse(await p.evaluate(() => window.__doorExports[0]));
    const beforeDoors = await savedState(p, 'fourth-quarter');
    t.ok(doorEnv.state.day === beforeDoors.day && Math.round(doorEnv.state.cash) === Math.round(beforeDoors.cash),
      'exporting from the Tonight panel writes the campaign as it stands, mid-day, no reload',
      `day ${doorEnv.state.day}`);

    // Open the doors for real and let the room fill, same as before this
    // session — the door save bar above didn't change any of this path.
    await p.click('[data-opendoors="1"]');
    await p.click('[data-speed="2"]').catch(() => {});
    const filled = await p.waitForFunction(() => {
      const n = document.getElementById('hCrowd')?.textContent || '';
      return /\d/.test(n) && parseInt(n, 10) >= 4;
    }, null, { timeout: 60000 }).then(() => true, () => false);
    t.ok(filled, 'the doors opened and the room filled', await p.textContent('#hCrowd'));
    const hour = (await p.textContent('#hHour')).trim();
    t.ok(hour !== 'DAY', 'the night clock is running', hour);
    await lookAt(p, { facing: 0, pitch: 0, sens: 0.0023 });
    await t.shot('night-open');

    // The dev menu's fast path to a box score — reaching one at 1x costs six
    // real minutes once the doors are open, and the 1x/2x speed buttons are not
    // clickable under pointer lock (found this session; see the notes for that
    // bug), so this only works once a night is actually running.
    await p.keyboard.press('Backquote');
    await p.waitForSelector('#devOverlay [data-cash]');
    const skip = await p.$('[data-skipclose="1"]');
    if (skip) {
      await skip.click();
      await wait(200);
      await p.click('#devClose').catch(() => {});
      const reachedBox = await p.waitForFunction(
        () => document.getElementById('boxOverlay')?.style.display === 'flex',
        null, { timeout: 20000 }).then(() => true, () => false);
      t.ok(reachedBox, 'the dev menu can skip straight to a box score');
      if (reachedBox) {
        const boxBar = await p.$$eval('#boxSaveBar button', els => els.map(b => b.dataset.gvb));
        t.ok(boxBar.join(',') === 'export,import', 'the box score mounted its own save bar too', boxBar.join(', '));
        t.ok(!doorBar.includes('reset') && !boxBar.includes('reset'),
          'neither new mount offers a second campaign-eraser next to the dev menu');

        await p.evaluate(() => {
          window.__boxExports = [];
          const create = URL.createObjectURL.bind(URL);
          URL.createObjectURL = blob => { blob.text().then(txt => window.__boxExports.push(txt)); return create(blob); };
        });
        await p.click('#boxSaveBar [data-gvb="export"]');
        await p.waitForFunction(() => window.__boxExports.length > 0, null, { timeout: 5000 });
        fs.writeFileSync(path.join(OUT, 'fq-box-export.json'), await p.evaluate(() => window.__boxExports[0]));
        const boxDay = (await savedState(p, 'fourth-quarter')).day;

        await p.click('#nextDayBtn').catch(() => {});
        await wait(400);
        await p.keyboard.press('Backquote');
        await p.waitForSelector('#devOverlay [data-cash]');
        await p.click('[data-day="7"]');
        await p.click('#devClose');
        await wait(300);
        const movedOn = await savedState(p, 'fourth-quarter');
        t.ok(movedOn.day > boxDay, 'the campaign moved on past the exported day',
          `day ${boxDay} -> ${movedOn.day}`);

        // Import from the start screen's bar. #wipeBtn only exists there, and
        // getting there from a live campaign means a reload, not a click —
        // reloading always shows the overlay, per the first beat in this suite.
        await p.reload({ waitUntil: 'load' });
        await p.waitForSelector('#startBtn');
        await setFiles(p, path.join(OUT, 'fq-box-export.json'), () => p.click('#saveBar [data-gvb="import"]'));
        await wait(600);
        const restored = await savedState(p, 'fourth-quarter');
        t.ok(restored.day === boxDay, 'importing the box-score export restored that earlier day',
          `day ${restored.day}`);
      }
    }
  },
};

/**
 * Errors a suite is allowed to produce, because it caused them on purpose.
 *
 * Empty since session 7 vendored Golden Hour's sand texture — it was the only
 * entry, because running that page with the hotlink blocked meant two log lines
 * per refusal (the harness's `reqfail:` with the URL, and Chrome's bare
 * "Failed to load resource: net::ERR_FAILED"). Kept because the next deliberate
 * failure will want it.
 */
const EXPECTED_ERRS = {};

/** Extra arguments for a game's `open()`. See GAMES in games.mjs. */
const OPEN_OPTS = {
  // The save bar lives on the start overlay, so don't dismiss it on the way in.
  'fourth-quarter': { start: false },
};

/* --------------------------------------------------------------- file picker - */

/**
 * Run `trigger` and answer the file chooser it opens with `file`.
 *
 * gvb-save's promptImport() creates a hidden <input type="file"> and clicks it,
 * which is a real chooser; it has to be answered by the driver, and the two
 * engines this harness supports do that differently. Registering the handler
 * before the click matters — the chooser is a one-shot event.
 */
async function setFiles(page, file, trigger) {
  if (page.__engine === 'puppeteer') {
    const [chooser] = await Promise.all([page.waitForFileChooser(), trigger()]);
    await chooser.accept([file]);
    return;
  }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(file);
}

/* ------------------------------------------------------------------- run ----- */

const only = process.argv[2];
const names = Object.keys(SUITES).filter(n => !only || n === only);
if (!names.length) {
  console.error(`no such game: ${only}\nknown: ${Object.keys(SUITES).join(', ')}`);
  process.exit(2);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const server = await serve(PORT);
const browser = await launch({ headed: true });
let failures = 0, checks = 0;

for (const name of names) {
  const g = GAMES[name];
  console.log(`\n${name} — ${g.title}`);
  const page = await prepPage(browser, BASE, {
    width: g.vw, height: g.vh, dsf: g.dsf ?? 1,
    // Deliberately empty even for Golden Hour: see its suite.
    allow: [],
  });
  page.setDefaultTimeout(45000);

  let shotN = 0;
  const t = {
    ok(cond, label, detail = '') {
      checks++;
      if (cond) console.log(`  ok    ${label}${detail ? '  ' + detail : ''}`);
      else { failures++; console.log(`  FAIL  ${label}${detail ? '  ' + detail : ''}`); }
    },
    async shot(label) {
      const f = path.join(OUT, `${name}-${String(++shotN).padStart(2, '0')}-${label}.png`);
      await page.screenshot({ path: f });
      return f;
    },
    // A suite that reloads the page has to call this again before touching the
    // camera: window.__scene and window.__cam belong to the document that went
    // away with the reload.
    probe: () => probe(),
  };
  const probe = async () => {
    if (!g.three) return;
    await attachSceneProbe(page, g.three);
    await waitForProbe(page);
  };

  try {
    await enter(page, name, { base: BASE, probe, open: OPEN_OPTS[name] || {} });
    await SUITES[name](page, t);
    const expected = EXPECTED_ERRS[name];
    const errs = page.__errs.filter(e => !(expected && expected.test(e)));
    t.ok(errs.length === 0,
      expected ? 'no unexpected page or console errors' : 'no page or console errors',
      errs.slice(0, 3).join(' | '));
    // Zero, everywhere, since the sand texture was vendored. If this ever fails,
    // something on the site started reaching out again.
    const offsite = [...new Set(page.__blocked)];
    t.ok(offsite.length === 0, 'no offsite requests', offsite.slice(0, 3).join(' | '));
  } catch (err) {
    failures++;
    console.log(`  ABORTED  ${String(err.message || err).slice(0, 200)}`);
    await t.shot('aborted').catch(() => {});
    if (page.__errs.length) console.log(`           errs: ${page.__errs.slice(0, 3).join(' | ')}`);
  }
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${checks} checks, ${failures ? `${failures} FAILED` : '0 failed'} — shots in ${path.relative(HERE, OUT)}`);
process.exit(failures ? 1 : 0);
