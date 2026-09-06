// play-games.mjs — end-to-end regression suite for the non-Castle games.
//
//   npm run games                  every game in SUITES
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
import { attachSceneProbe, waitForProbe, camState, lookAt, waitFor, textContent, setFiles, walkTo } from './drive.mjs';
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
    const moved = await waitFor(p,
      () => document.querySelectorAll('#grid .cell .packet').length > 0,
      { timeout: 15000 }).then(() => true, () => false);
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
    await waitFor(p,
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      { timeout: 10000 });

    // A sink has to be on the floor before its order is on screen, so park one,
    // read it, clear it. state.sinks[0] survives the erase, so the number holds.
    await place('sink', 0, 0);
    await p.waitForSelector('#grid .cell[data-x="0"][data-y="0"].sink .sink-target');
    const want = Number((await p.$eval('.sink-target', el => el.textContent)).replace(/\D/g, ''));
    t.ok(Number.isInteger(want) && want >= 2 && want <= 12,
      'the opening order is between 2 and 12', `wants ${want}`);
    await p.click('[data-tool="erase"]');
    await p.click('#grid .cell[data-x="0"][data-y="0"]');
    await waitFor(p,
      () => document.querySelectorAll('#grid .cell:not(.empty)').length === 0,
      { timeout: 10000 });

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

    const filled = await waitFor(p,
      () => /[1-9]/.test(document.getElementById('stat-orders').textContent),
      { timeout: 30000 }).then(() => true, () => false);
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
    await waitFor(p, () => window.__ctExports.length > 0, { timeout: 5000 });
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

    // Wading: session 8 let the walk continue past the old static wall (which
    // put a walker's eyes 3.8 m underwater) up to a knee-depth limit that rides
    // the tide instead of sitting still. Walk into the water long enough and
    // the eye height should settle rather than keep dropping. camState's `y` is
    // eye height (`pos` is x/z only) — the shared-file request's own sketch
    // read `pos[1]` for this, which would be `z`, not height; adapted here.
    //
    // Re-aim toward the sea first. Two look-tests already ran (a mouse-look to
    // facing 1.2, then a 900ms ArrowLeft hold adding ~1.05 rad more) and neither
    // re-aims afterward, so by this point facing is ~2.25 rad with nothing
    // pointing the camera back at the water. controls.js's own dz = -cos(facing)
    // for a straight KeyW: facing=2.25 gives dz > 0, which is inland (confirmed
    // against golden-hour-beach/js/controls.js directly), so KeyW walked toward
    // the dunes instead of the shoreline. facing=0 gives dz = -1, straight
    // seaward — confirmed against the same formula, not guessed.
    //
    // lookAt() can't do this turn: it steers with synthetic mouse movement, and
    // the arrow-key test just above this one calls document.exitPointerLock()
    // on purpose (to prove the keyboard-only path works). controls.js's own
    // mousemove handler is gated on pointer lock (`if (document.pointerLockElement
    // !== dom) return`), so with lock released, lookAt() silently does nothing —
    // this was the actual reason the first version of this fix, which called
    // lookAt(), still measured eye height climbing instead of settling. Arrow
    // keys stay live regardless of lock state, so turn with those instead,
    // polling facing the same way walkTo() polls distance.
    for (let i = 0, facing = (await camState(p)).facing; i < 60 && Math.abs(facing) > 0.05; i++) {
      const key = facing > 0 ? 'ArrowRight' : 'ArrowLeft';
      await p.keyboard.down(key); await wait(60); await p.keyboard.up(key);
      facing = (await camState(p)).facing;
    }
    const reaimed = await camState(p);
    t.ok(Math.abs(reaimed.facing) < 0.1, 'the wading beat re-aimed toward the sea before walking in',
      `facing ${reaimed.facing.toFixed(3)}`);
    await p.keyboard.down('KeyW'); await wait(20000);
    const midWade = await camState(p);
    await wait(6000);
    const settledWade = await camState(p);
    await p.keyboard.up('KeyW');
    t.ok(Math.abs(settledWade.y - midWade.y) < 0.15,
      'walking into the water settles at a wading depth rather than continuing to drop',
      `eye y ${midWade.y.toFixed(2)} -> ${settledWade.y.toFixed(2)}`);
    t.ok(settledWade.y > 0.5, 'and the walker never goes fully underwater',
      `eye y ${settledWade.y.toFixed(2)}`);

    // Footprints: a small-geometry InstancedMesh (the wrack kinds are all
    // bigger than 60 vertices) should have instances on it after walking
    // toward the shoreline.
    const footCount = await p.evaluate(() => {
      let found = 0;
      window.__scene.traverse(o => {
        if (o.isInstancedMesh && o.geometry.attributes.position.count < 60) found = o.count;
      });
      return found;
    });
    t.ok(footCount > 0, 'footprints are left in the wet sand', `${footCount} instances`);
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
    const toasted = await waitFor(p,
      () => document.querySelectorAll('#toasts > *').length > 0,
      { timeout: 8000 }).then(() => true, () => false);
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
    const tag = () => textContent(p, '#startTag');

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
    await waitFor(p, () => window.__exports.length > 0, { timeout: 5000 });
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
    await waitFor(p, () => window.__doorExports.length > 0, { timeout: 5000 });
    const doorEnv = JSON.parse(await p.evaluate(() => window.__doorExports[0]));
    const beforeDoors = await savedState(p, 'fourth-quarter');
    t.ok(doorEnv.state.day === beforeDoors.day && Math.round(doorEnv.state.cash) === Math.round(beforeDoors.cash),
      'exporting from the Tonight panel writes the campaign as it stands, mid-day, no reload',
      `day ${doorEnv.state.day}`);

    // Open the doors for real and let the room fill, same as before this
    // session — the door save bar above didn't change any of this path.
    await p.click('[data-opendoors="1"]');
    await p.click('[data-speed="2"]').catch(() => {});
    const filled = await waitFor(p, () => {
      const n = document.getElementById('hCrowd')?.textContent || '';
      return /\d/.test(n) && parseInt(n, 10) >= 4;
    }, { timeout: 60000 }).then(() => true, () => false);
    t.ok(filled, 'the doors opened and the room filled', await textContent(p, '#hCrowd'));
    const hour = (await textContent(p, '#hHour')).trim();
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
      const reachedBox = await waitFor(p,
        () => document.getElementById('boxOverlay')?.style.display === 'flex',
        { timeout: 20000 }).then(() => true, () => false);
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
        await waitFor(p, () => window.__boxExports.length > 0, { timeout: 5000 });
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

    // --- Real Estate: walk to the station (real movement, not the dev warp
    // used above), sign the lease, and push through the dark night it opens.
    // The dev warp already covers every venue tier; this is the one thing it
    // skips — the actual Real Estate panel and the door ring's "Tonight" state
    // during a move, neither of which had any coverage before this round.
    // Fresh reload so the walk starts from the documented spawn point.
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('#wipeBtn');
    await p.click('#wipeBtn');
    await wait(600);
    await t.probe();
    await p.click('#startBtn');
    await wait(700);
    await p.keyboard.press('Backquote');
    await p.waitForSelector('#devOverlay [data-cash]');
    await p.click('[data-cash="10000"]');
    await p.click('#devClose');
    await wait(300);

    // Opening the dev console (Backquote, above) calls document.exitPointerLock()
    // (main.js:310) and closing it never re-acquires — player.js's mousemove
    // handler is gated on `this.locked`, itself only ever set true by a click on
    // the canvas (js/player.js:34, js/main.js:447). Without this click, lookAt()
    // below dispatches a mousemove the game's own handler silently ignores —
    // the actual reason the first version of this fix still failed to turn.
    await p.click('canvas');
    await wait(150);

    // steer:'lookAt' — The Fourth Quarter hand-rolls its own camera control
    // (js/player.js:182-184 overwrites camera.rotation from its own yaw/pitch
    // every frame), so walkTo()'s default aimAt() raw write gets stomped the
    // next frame and the walk never turns. lookAt() drives the same target
    // angle through the game's own mousemove handler instead.
    const reachedEstate = await walkTo(p, [6.7, -0.8], async (dist) => dist < 1.4,
      { maxBursts: 60, steer: 'lookAt', sens: 0.0023 })
      .catch(() => null);
    t.ok(!!reachedEstate, 'walked to the Real Estate station',
      reachedEstate ? `${reachedEstate.bursts} bursts, ${reachedEstate.dist}m off` : 'never got in range');
    if (reachedEstate) {
      await p.keyboard.press('KeyE');
      await p.waitForSelector('#panelOverlay [data-signlease]', { timeout: 10000 });
      const estateTitle = await textContent(p, '#panelTitle');
      t.ok(estateTitle === 'Real Estate', 'the Real Estate panel opened', estateTitle);
      const leaseDisabled = await p.$eval('[data-signlease="1"]', el => el.disabled);
      t.ok(leaseDisabled === false, 'Sign the Lease is enabled once cash covers it',
        `disabled=${leaseDisabled}`);

      await p.click('[data-signlease="1"]');
      await wait(400);
      const leased = await savedState(p, 'fourth-quarter');
      t.ok(leased.venue === 'fieldhouse' && leased.darkNightsLeft === 1,
        'signing the lease moves in and opens a dark night',
        `venue ${leased.venue}, dark nights ${leased.darkNightsLeft}`);
      const panelClosed = await p.$eval('#panelOverlay', el => el.style.display === 'none');
      t.ok(panelClosed, 'and the panel closes itself before the world rebuilds');

      // The door ring during the dark night opens "Tonight," not the normal
      // doors — same spawn-adjacent door station, different panel entirely.
      await p.keyboard.press('KeyE');
      await p.waitForSelector('#panelOverlay [data-closednight]', { timeout: 10000 });
      const tonightTitle = await textContent(p, '#panelTitle');
      const openDoorsGone = !(await p.$('[data-opendoors="1"]'));
      t.ok(tonightTitle === 'Tonight' && openDoorsGone,
        'the door ring shows "Tonight" during the move, with no Open the Doors button',
        tonightTitle);

      await p.click('[data-closednight="1"]');
      await wait(400);
      const pushed = await savedState(p, 'fourth-quarter');
      t.ok(pushed.darkNightsLeft === 0 && pushed.day === leased.day + 1,
        'pushing through clears the dark night and advances one day, zero patrons',
        `dark nights ${pushed.darkNightsLeft}, day ${leased.day} -> ${pushed.day}`);
      t.ok(pushed.cash < leased.cash, 'and cash drops (rent, wages, upkeep, no revenue)',
        `$${Math.round(leased.cash)} -> $${Math.round(pushed.cash)}`);

      await p.keyboard.press('KeyE');
      await p.waitForSelector('#panelOverlay [data-opendoors]', { timeout: 10000 });
      t.ok(true, "the door ring is back to a normal night's panel");
      await p.click('#panelClose');
    }
  },

  // ---- Torchbearer ----------------------------------------------------------
  // games.mjs's open() already Shelf-loaded Thornwake and imported the committed
  // save; it lands on bridge-fog and stops there, per that project's own
  // recipe — everything past that point is this suite's to assert on.
  'torchbearer': async (p, t) => {
    // Phase 3 gave the page a reaction prompt: a combatant carrying more than
    // one reaction (every fighter does — Reactive Strike and Shield Block) is
    // asked before one is spent, and a reaction resolves inside the action that
    // triggered it, so the ask is a synchronous confirm. Sera Voss is a fighter
    // and the Vanguard's Watch is a real fight, so one can land mid-beat.
    // Accepting keeps the behaviour these assertions were written against;
    // without a listener both drivers auto-dismiss, which would silently turn
    // every reaction off instead.
    p.on('dialog', d => d.accept());

    const state = await savedState(p, 'torchbearer');
    t.ok(state?.sceneId === 'bridge-fog', 'the imported save landed on the committed checkpoint',
      `sceneId ${state?.sceneId}`);
    t.ok(state?.companions?.[0]?.hp === 38, 'and the companion HP came through',
      `${state?.companions?.[0]?.id} at ${state?.companions?.[0]?.hp} HP`);

    await p.click('.choice-btn');
    await waitFor(p, () => document.querySelectorAll('#grid .token').length > 0, { timeout: 10000 });
    await wait(300);
    const cells = await p.$$eval('#grid .cell', els => els.length);
    const tokens = await p.$$eval('#grid .token', els => els.length);
    t.ok(cells === 91 && tokens === 5, "engaging the pickets opens the Vanguard's Watch grid",
      `${cells} cells, ${tokens} tokens`);
    await t.shot('vanguards-watch');

    // Phase 5 put nine more actions on the bar, and renderBar is the only
    // caller of half of them. smoke.mjs drives the engine and never sees this
    // function, so a button whose handler was never attached — or a renderBar
    // that throws on `this.condVal` — is invisible to 947 green assertions.
    // Wait for Sera's own turn: a companion's bar has no maneuvers on it,
    // because it has no character sheet to roll Athletics off, and initiative
    // decides which of the two comes first. End the companion's turn if it is
    // up — nothing else will, and the monsters' turns run themselves.
    for (let i = 0; i < 4; i++) {
      await waitFor(p, () => !!document.querySelector('#action-bar .act-btn'), { timeout: 25000 });
      // `hide` is the probe rather than one of the buttons asserted below, so
      // a missing maneuver is named by the assertion instead of hanging here.
      const isHero = await p.$$eval('#action-bar .act-btn', els => els.some(e => e.dataset.act === 'hide'));
      if (isHero) break;
      await p.click('#action-bar [data-act="end"]');
      await wait(400);
    }
    const acts = await p.$$eval('#action-bar .act-btn', els => els.map(e => e.dataset.act));
    const wanted = ['trip', 'shove', 'grapple', 'disarm', 'aid', 'recall', 'ready', 'delay'];
    const missing = wanted.filter(a => !acts.includes(a));
    t.ok(missing.length === 0, "the hero's action bar carries Phase 5's actions",
      missing.length ? `missing ${missing.join(', ')}` : `${acts.length} buttons`);
    // Escape and Stand are conditional and correctly absent on a standing,
    // ungrabbed hero — their presence here would mean the gate is not read.
    t.ok(!acts.includes('escape') && !acts.includes('stand'),
      'Escape and Stand stay off the bar until something is holding you or you are down',
      acts.filter(a => a === 'escape' || a === 'stand').join(', ') || 'neither');
    await t.shot('action-bar-phase-5');

    // Corrupt-file-rejected: a build naming a class/background this page never
    // loaded. Thornwake is already loaded from the beat above, so this
    // exercises loadSave's ancestry/background/class check specifically, not
    // the separate advId one.
    const badBuild = JSON.parse(fs.readFileSync(
      path.join(HERE, '..', '..', 'Projects', 'torchbearer', 'test', 'sera-voss.torchsave.json'), 'utf8'));
    badBuild.state.build.cls = 'nonexistent-class';
    badBuild.state.build.background = 'nonexistent-background';
    const badFile = path.join(OUT, 'torchbearer-bad-build.json');
    fs.writeFileSync(badFile, JSON.stringify(badBuild));
    await setFiles(p, badFile, () => p.click('#save-bar [data-gvb="import"]'));
    await waitFor(p, () => document.getElementById('modal-veil')?.classList.contains('open'), { timeout: 5000 });
    const modalTitle = await textContent(p, '#modal-title');
    t.ok(/Content Missing/i.test(modalTitle), 'a build naming unloaded content is refused, not crashed',
      modalTitle);
    await p.click('#modal-foot button');
    const stillHere = await savedState(p, 'torchbearer');
    t.ok(stillHere?.sceneId === 'bridge-fog', 'and the live journey survives the rejected import',
      `sceneId ${stillHere?.sceneId}`);

    // Phase 6, increment 2: the level-up, through the page's own doors. A copy
    // of the committed save at version 3 with 1,000 XP banked goes in through
    // Import (a version-2 file would have its xp zeroed by `migrate`, which is
    // the point of that migration); the title screen's Level Up button opens
    // the builder in its level-up mode; one pick per slot; Take Level 4; and
    // the slot then holds a level-4 Sera with the XP spent and both picks
    // under advances[4]. smoke.mjs pins every number this produces; what only
    // a browser can say is that the buttons are wired to them.
    const ready = JSON.parse(fs.readFileSync(
      path.join(HERE, '..', '..', 'Projects', 'torchbearer', 'test', 'sera-voss.torchsave.json'), 'utf8'));
    ready.version = 3;
    ready.state.xp = 1000;
    ready.state.build.level = 3;
    ready.state.build.advances = {};
    const readyFile = path.join(OUT, 'torchbearer-ready-to-level.json');
    fs.writeFileSync(readyFile, JSON.stringify(ready));
    await setFiles(p, readyFile, () => p.click('#save-bar [data-gvb="import"]'));
    await waitFor(p, () => window.__torchbearer?.xp === 1000, { timeout: 10000 });
    // The import lands on bridge-fog with the Vanguard's Watch still flagged
    // active from the beat above, so Title asks to abandon it; the dialog
    // listener at the top of this suite accepts.
    await p.click('#btn-to-title');
    await waitFor(p, () => document.getElementById('screen-title')?.classList.contains('active'), { timeout: 5000 });
    t.ok((await p.$eval('#btn-level-up', el => el.disabled)) === false, 'with 1,000 XP banked the title screen offers Level Up');
    const status3 = await textContent(p, '#hero-status');
    t.ok(/Fighter 3/.test(status3) && /1000 \/ 1000/.test(status3) && /ready to level/.test(status3),
      'and the status line says so', status3);
    await p.click('#btn-level-up');
    await waitFor(p, () => document.getElementById('screen-builder')?.classList.contains('active'), { timeout: 5000 });
    const rail = await p.$$eval('#builder-steps .bstep', els => els.map(e => e.textContent.replace(/^[\d✓]+/, '').trim()));
    t.ok(rail.join('|') === 'Feats|Review', 'level 4 offers a Fighter two steps: the feats it grants, then the review', rail.join(' | '));
    const slots = await p.$$eval('#builder-body .opt-card:not(.disabled)', els => [...new Set(els.map(e => e.dataset.slot))]);
    t.ok(slots.join('|') === 'class4|skill4', 'the feat step shows a class slot and a skill slot, each with something to pick', slots.join(' | '));
    t.ok(await p.$eval('#bld-next', el => el.disabled), 'Next waits for both');
    for (const slot of slots) {
      await p.click(`#builder-body .opt-card:not(.disabled)[data-slot="${slot}"]`);
      await wait(150);
    }
    t.ok(!(await p.$eval('#bld-next', el => el.disabled)), 'one pick in each and Next is live');
    await p.click('#bld-next');
    await wait(200);
    const take = await textContent(p, '#bld-next');
    t.ok(/Take Level 4/.test(take), "the review step's button takes the level", take);
    const review = await textContent(p, '#builder-body');
    t.ok(/goes from 3 to 4/.test(review) && /HP 52 → 66/.test(review), 'the review names the change: HP 52 to 66', review.slice(0, 120));
    await t.shot('level-up-review');
    await p.click('#bld-next');
    await waitFor(p, () => document.getElementById('screen-title')?.classList.contains('active'), { timeout: 5000 });
    const after = await savedState(p, 'torchbearer');
    t.ok(after?.build?.level === 4 && after?.xp === 0, 'the slot holds a level-4 hero with the XP spent',
      `level ${after?.build?.level}, xp ${after?.xp}`);
    const picks = after?.build?.advances?.['4']?.feats || {};
    t.ok(!!picks.class4 && !!picks.skill4, 'and both picks under advances[4]', JSON.stringify(picks));
    const status4 = await textContent(p, '#hero-status');
    t.ok(/Fighter 4/.test(status4) && /0 \/ 1000/.test(status4), 'the status line reads Fighter 4, 0 of 1000', status4);
    t.ok(await p.$eval('#btn-level-up', el => el.disabled), 'and Level Up is greyed again');
    await t.shot('level-4');

    // Level 5 is the level that grants everything the flow can render: four
    // boosts, a skill increase and an ancestry feat. The level-4 state the
    // page just saved goes back in with another 1,000 XP, and the three
    // other step components get driven once each.
    const ready5 = { ...ready, state: { ...after, xp: 1000 } };
    const ready5File = path.join(OUT, 'torchbearer-ready-for-5.json');
    fs.writeFileSync(ready5File, JSON.stringify(ready5));
    await setFiles(p, ready5File, () => p.click('#save-bar [data-gvb="import"]'));
    await waitFor(p, () => window.__torchbearer?.xp === 1000 && window.__torchbearer?.hero?.level === 4, { timeout: 10000 });
    await p.click('#btn-to-title');
    await waitFor(p, () => document.getElementById('screen-title')?.classList.contains('active'), { timeout: 5000 });
    await p.click('#btn-level-up');
    await waitFor(p, () => document.getElementById('screen-builder')?.classList.contains('active'), { timeout: 5000 });
    const rail5 = await p.$$eval('#builder-steps .bstep', els => els.map(e => e.textContent.replace(/^[\d✓]+/, '').trim()));
    t.ok(rail5.join('|') === 'Boosts|Skill Increase|Feats|Review', 'level 5 offers boosts, a skill increase, feats and the review', rail5.join(' | '));
    t.ok(await p.$eval('#bld-next', el => el.disabled), 'the boosts step waits for four');
    for (const [i, a] of ['str', 'dex', 'con', 'wis'].entries()) {
      await p.click(`#builder-body .abil-chip[data-g="adv${i}"][data-a="${a}"]`);
      await wait(120);
    }
    // Sera is Str +3, so every one of the four is a full boost and nothing reads as partial.
    const boxes = await p.$$eval('#builder-body .abil-box', els => els.map(e => e.textContent.trim()));
    t.ok(boxes.some(x => /Str.*\+4/.test(x)) && boxes.some(x => /Dex.*\+2/.test(x)) && !boxes.some(x => /½/.test(x)),
      'the summary moves Str to +4 and Dex to +2, and no boost is partial', boxes.join(' '));
    await t.shot('level-5-boosts');
    t.ok(!(await p.$eval('#bld-next', el => el.disabled)), 'four different attributes and Next is live');
    await p.click('#bld-next');
    await wait(200);
    const noMaster = await p.$$eval('#builder-body .skill-row', els => els.filter(e => /Master waits/.test(e.textContent)).length);
    t.ok(noMaster === 1, "Sera's one Expert skill says Master waits for 7th, and every other skill can rise", `${noMaster} row(s)`);
    t.ok((await p.$('#builder-body .pick-btn[data-s="athletics"]')) === null, "…and Athletics, her Expert skill, has no button to press");
    await p.click('#builder-body .pick-btn[data-s="intimidation"]');
    await wait(150);
    const pill = await textContent(p, '#builder-body .counter-pill');
    t.ok(/Intimidation → Expert/.test(pill), 'raising Intimidation reads as Trained to Expert', pill);
    await p.click('#bld-next');
    await wait(200);
    const slots5 = await p.$$eval('#builder-body .opt-card:not(.disabled)', els => [...new Set(els.map(e => e.dataset.slot))]);
    t.ok(slots5.join('|') === 'ancestry5', 'the feat step offers the ancestry slot alone', slots5.join(' | '));
    await p.click('#builder-body .opt-card:not(.disabled)[data-slot="ancestry5"]');
    await wait(150);
    await p.click('#bld-next');
    await wait(200);
    t.ok(/Take Level 5/.test(await textContent(p, '#bld-next')), 'the review offers level 5');
    await p.click('#bld-next');
    await waitFor(p, () => document.getElementById('screen-title')?.classList.contains('active'), { timeout: 5000 });
    const after5 = await savedState(p, 'torchbearer');
    const adv5 = after5?.build?.advances?.['5'] || {};
    t.ok(after5?.build?.level === 5 && after5?.xp === 0, 'the slot holds a level-5 hero with the XP spent', `level ${after5?.build?.level}, xp ${after5?.xp}`);
    t.ok((adv5.boosts || []).join(',') === 'str,dex,con,wis' && adv5.skillIncrease === 'intimidation' && !!(adv5.feats || {}).ancestry5,
      'and advances[5] carries the boosts, the increase and the feat', JSON.stringify(adv5));
    const hero5 = await p.evaluate(() => { const h = window.__torchbearer.hero; return { level: h.level, str: h.abil.str, dex: h.abil.dex, intim: h.skills.intimidation, hp: h.hpMax }; });
    t.ok(hero5.level === 5 && hero5.str === 4 && hero5.dex === 2 && hero5.intim === 'E' && hero5.hp === 85,
      'the live sheet is level 5: Str +4, Dex +2, Intimidation Expert, 85 HP', JSON.stringify(hero5));

    // Phase 7, increment 1: the campaign record, through the page's own doors.
    // smoke.mjs pins the gate arithmetic and the fold; what only a browser can
    // say is that the picker renders campaigns, that the board reads the gate,
    // and that a save carrying a finished road comes back as an open one.
    // Thornwake was Shelf-loaded by games.mjs's open(), so its campaign is here.
    await p.click('#btn-begin-adv');
    await waitFor(p, () => document.getElementById('modal-veil')?.classList.contains('open'), { timeout: 5000 });
    t.ok(/Choose a Road/.test(await textContent(p, '#modal-title')), 'the picker is a road picker once a campaign is loaded',
      await textContent(p, '#modal-title'));
    const campCards = await p.$$eval('#modal-body [data-camp]', els => els.map(e => e.dataset.camp));
    t.ok(campCards.includes('bell-and-bridge'), 'and The Bell and the Bridge is on it', campCards.join(', ') || 'no campaign cards');

    await p.click('#modal-body [data-camp="bell-and-bridge"]');
    await waitFor(p, () => /Bell and the Bridge/.test(document.getElementById('modal-title')?.textContent || ''), { timeout: 5000 });
    const fresh = await p.$$eval('#modal-body .opt-card', els => els.map(e => ({
      road: e.dataset.road || null, disabled: e.classList.contains('disabled'), meta: e.querySelector('.meta')?.textContent || ''
    })));
    t.ok(fresh.length === 2 && fresh[0].road === 'barrowmoor' && !fresh[0].disabled && fresh[1].road === null && fresh[1].disabled,
      'a fresh record opens Barrowmoor and closes the bridge', JSON.stringify(fresh));
    t.ok(/closed/.test(fresh[1].meta), 'and the closed road says so', fresh[1].meta);
    await t.shot('campaign-board-locked');
    await p.click('#modal-foot button:last-child');
    const picked = await savedState(p, 'torchbearer');
    t.ok(picked?.campaignId === 'bell-and-bridge' && (picked?.completed || []).length === 0,
      'picking a campaign writes campaignId into the save with nothing finished yet',
      `${picked?.campaignId} / ${JSON.stringify(picked?.completed)}`);

    // A save that says Barrowmoor is behind you, in through Import. Every field
    // goes through repair, so this is also the only place the three Phase 7
    // fields are read from a file rather than written to one.
    const onRoad = JSON.parse(fs.readFileSync(
      path.join(HERE, '..', '..', 'Projects', 'torchbearer', 'test', 'sera-voss.torchsave.json'), 'utf8'));
    onRoad.version = 3;
    onRoad.state.campaignId = 'bell-and-bridge';
    onRoad.state.completed = ['barrowmoor'];
    onRoad.state.campaignFlags = { 'barrowmoor/bell-answered': true };
    onRoad.state.advId = null;
    onRoad.state.sceneId = null;
    // Phase 7, increment 2: the purse and the pack ride in the same file. 250
    // copper is 2 gp 5 sp, chosen so the wagon below has three cards the hero
    // can afford and two it cannot — the disabled state is the only part of
    // the shop no assertion in smoke.mjs can see.
    onRoad.state.gold = 250;
    onRoad.state.inventory = ['vane-saber'];
    // Phase 7, increment 3: a hero who walked off the moor hurt, so the long
    // rest below has something to put back and the number on screen is real.
    if (onRoad.state.hero) onRoad.state.hero.hp = 12;
    const onRoadFile = path.join(OUT, 'torchbearer-on-the-road.json');
    fs.writeFileSync(onRoadFile, JSON.stringify(onRoad));
    await setFiles(p, onRoadFile, () => p.click('#save-bar [data-gvb="import"]'));
    await waitFor(p, () => window.__torchbearer?.campaignId === 'bell-and-bridge'
      && window.__torchbearer?.completed?.length === 1, { timeout: 10000 });
    const status = await textContent(p, '#hero-status');
    t.ok(/1 of 2 finished/.test(status), 'the title screen says how far down the road the hero is', status);
    t.ok(/The Road/.test(await textContent(p, '#btn-begin-adv')), 'and the Begin button is the board now',
      await textContent(p, '#btn-begin-adv'));

    await p.click('#btn-begin-adv');
    await waitFor(p, () => /Bell and the Bridge/.test(document.getElementById('modal-title')?.textContent || ''), { timeout: 5000 });
    const open = await p.$$eval('#modal-body .opt-card', els => els.map(e => ({
      road: e.dataset.road || null, meta: e.querySelector('.meta')?.textContent || ''
    })));
    t.ok(open.length === 2 && open[0].road === null && /finished/.test(open[0].meta) && open[1].road === 'thornwake',
      'a folded bell-answered opens the bridge and marks Barrowmoor finished', JSON.stringify(open));
    await t.shot('campaign-board-open');

    // And the payoff: a choice in Thornwake's opening scene that only exists
    // for a hero who walked out of Barrowmoor. `flagOk` reads it off the
    // campaign record, not off the flags this adventure has set — which are
    // empty, because the adventure just started.
    await p.click('#modal-body [data-road="thornwake"]');
    await waitFor(p, () => document.querySelectorAll('.choice-btn').length > 0, { timeout: 10000 });
    const choices = await p.$$eval('.choice-btn', els => els.map(e => e.textContent.trim()));
    t.ok(choices.some(c => /Barrowmoor/.test(c)),
      'Thornwake offers the hero a line only the campaign record could have earned', choices.join(' | '));
    await t.shot('campaign-scoped-choice');

    // Phase 7, increment 2: the shop, through the page's own doors. smoke.mjs
    // pins every coin of the arithmetic; what only a browser can say is that a
    // `"kind": "shop"` scene renders cards at all, that the ones the purse
    // cannot cover come up disabled, and that a click on one moves real money
    // in the real save.
    const toWagon = await p.$$eval('.choice-btn', els => {
      const at = els.findIndex(e => /selling/.test(e.textContent));
      return at < 0 ? null : els[at].dataset.i;
    });
    t.ok(toWagon !== null, "the bridgehead has a road to Halloran's wagon", choices.join(' | '));
    await p.click(`.choice-btn[data-i="${toWagon}"]`);
    await waitFor(p, () => document.querySelector('.shop-purse') !== null, { timeout: 10000 });
    t.ok(/2 gp, 5 sp/.test(await textContent(p, '.shop-purse')),
      'the shop prints the purse the save carried in, in coins', await textContent(p, '.shop-purse'));

    const cards = await p.$$eval('#game-center [data-buy]', els => els.map(e => ({
      i: e.dataset.buy, name: e.querySelector('h3')?.textContent || '', off: e.classList.contains('disabled')
    })));
    t.ok(cards.length === 5, 'the wagon renders one card per stocked item', JSON.stringify(cards.map(c => c.name)));
    t.ok(cards.filter(c => c.off).map(c => c.name).sort().join(', ') === 'Crossbow, Lesser Healing Potion, Minor Healing Potion',
      'and greys out exactly what 2 gp 5 sp cannot buy', JSON.stringify(cards));
    const forSale = await p.$$eval('#game-center [data-sell]', els => els.map(e => e.querySelector('h3')?.textContent || ''));
    t.ok(forSale.join(', ') === 'Vane Family Saber', 'the sell side is the hero\'s own pack', forSale.join(', ') || 'nothing');
    await t.shot('the-wagon-at-the-bridgehead');

    const dagger = cards.find(c => c.name === 'Dagger');
    await p.click(`#game-center [data-buy="${dagger.i}"]`);
    await waitFor(p, () => /2 gp, 3 sp/.test(document.querySelector('.shop-purse')?.textContent || ''), { timeout: 10000 });
    const bought = await savedState(p, 'torchbearer');
    t.ok(bought?.gold === 230 && (bought?.inventory || []).includes('dagger'),
      'buying a 2 sp dagger takes 2 sp out of the saved purse and puts the dagger in the saved pack',
      `${bought?.gold} cp / ${JSON.stringify(bought?.inventory)}`);

    // Half, rounded down, and the item leaves the pack. The saber is worth
    // 1 gp, so the wagon pays 5 sp for it.
    await p.click('#game-center [data-sell="0"]');
    await waitFor(p, () => /2 gp, 8 sp/.test(document.querySelector('.shop-purse')?.textContent || ''), { timeout: 10000 });
    const sold = await savedState(p, 'torchbearer');
    t.ok(sold?.gold === 280 && !(sold?.inventory || []).includes('vane-saber'),
      'and selling the saber pays half of its 1 gp and takes it out of the pack',
      `${sold?.gold} cp / ${JSON.stringify(sold?.inventory)}`);
    await t.shot('after-the-wagon');

    /* Phase 7, increment 3: the exploration scene, and the flag it leaves for
       the fight in the fog. The whole point of the scene kind is that the
       player picks the opening state, so the browser is the only place the
       three cards and the click on one of them exist at all. */
    const toCairns = await p.$$eval('.choice-btn', els => {
      const at = els.findIndex(e => /back to the cairns/.test(e.textContent));
      return at < 0 ? null : els[at].dataset.i;
    });
    t.ok(toCairns !== null, 'the wagon has a way back to the bridgehead');
    await p.click(`.choice-btn[data-i="${toCairns}"]`);
    await waitFor(p, () => /Where the Fog Never Lifts/.test(document.querySelector('.scene-title')?.textContent || ''), { timeout: 10000 });
    const onward = await p.$$eval('.choice-btn', els => {
      const at = els.findIndex(e => /Cross onto the bridge/.test(e.textContent));
      return at < 0 ? null : els[at].dataset.i;
    });
    t.ok(onward !== null, 'and the bridgehead leads onto the span');
    await p.click(`.choice-btn[data-i="${onward}"]`);
    await waitFor(p, () => document.querySelectorAll('#game-center [data-explore]').length > 0, { timeout: 10000 });
    const explores = await p.$$eval('#game-center [data-explore]', els => els.map(e => ({
      i: e.dataset.explore, name: e.querySelector('h3')?.textContent || '', meta: e.querySelector('.meta')?.textContent || ''
    })));
    t.ok(explores.map(a => a.name).join(', ') === 'Search, Avoid Notice, Defend',
      'the approach offers all three exploration activities', JSON.stringify(explores.map(a => a.name)));
    t.ok(/Perception · DC 18/.test(explores[0].meta), 'Search prints the skill, the DC and the hero\'s modifier', explores[0].meta);
    t.ok(/No check/.test(explores[2].meta), 'and Defend says it does not roll', explores[2].meta);
    await t.shot('how-you-cross');
    // Defend has no roll, so this assertion cannot come down to a die.
    await p.click('#game-center [data-explore="2"]');
    await waitFor(p, () => /The Fog Remembers Marching/.test(document.querySelector('.scene-title')?.textContent || ''), { timeout: 10000 });
    const braced = await savedState(p, 'torchbearer');
    t.ok(braced?.flags?.['shield-braced'] === true,
      'choosing Defend leaves the opener the next fight will consume, in the real save',
      JSON.stringify(Object.keys(braced?.flags || {})));
    t.ok(/Braced/.test(await p.evaluate(() => document.getElementById('chronicle').textContent)),
      'and the Chronicle says what it bought');

    /* Phase 7, increment 3: downtime, and it goes last because Earn Income
       moves the purse by a rolled amount — every shop assertion above is
       pinned to a coin. Camp is between the roads, and the fog is not between
       the roads: back to the title first, and the button is still greyed,
       because `this.adv` is Thornwake until something clears it. */
    await p.click('#btn-to-title');
    await waitFor(p, () => document.getElementById('screen-title').classList.contains('active'), { timeout: 5000 });
    t.ok(await p.$eval('#btn-camp', e => e.disabled), 'Make Camp is greyed with an adventure still running');
    await setFiles(p, onRoadFile, () => p.click('#save-bar [data-gvb="import"]'));
    await waitFor(p, () => window.__torchbearer?.adv === null, { timeout: 10000 });
    t.ok(!(await p.$eval('#btn-camp', e => e.disabled)),
      'and live again once a between-adventures save clears the adventure that was running');

    await p.click('#btn-camp');
    await waitFor(p, () => /Camp/.test(document.getElementById('modal-title')?.textContent || ''), { timeout: 5000 });
    const dtCards = await p.$$eval('#modal-body [data-downtime]', els => els.map(e => ({
      id: e.dataset.downtime, name: e.querySelector('h3')?.textContent || '', off: e.getAttribute('aria-disabled') === 'true'
    })));
    t.ok(dtCards.map(c => c.id).join(',') === 'rest,treat-wounds,earn-income,craft',
      'camp offers the four downtime activities', JSON.stringify(dtCards.map(c => c.id)));
    await t.shot('camp-between-the-roads');
    const hurtHP = await p.evaluate(() => window.__torchbearer.heroCombatant().hp);
    await p.click('#modal-body [data-downtime="rest"]');
    await waitFor(p, () => /Rested/.test(document.querySelector('.camp-report')?.textContent || ''), { timeout: 5000 });
    const restedHP = await p.evaluate(() => window.__torchbearer.heroCombatant().hp);
    t.ok(restedHP > hurtHP, 'a long rest puts HP back', `${hurtHP} -> ${restedHP}`);
    const afterRest = await savedState(p, 'torchbearer');
    t.ok(afterRest?.days === 1, 'and the day it cost is in the save', String(afterRest?.days));
    const purseBefore = afterRest?.gold;
    await p.click('#modal-body [data-downtime="earn-income"]');
    await waitFor(p, () => /day's work|Dismissed/.test(document.querySelector('.camp-report')?.textContent || ''), { timeout: 5000 });
    const afterWork = await savedState(p, 'torchbearer');
    t.ok(afterWork?.days === 2, 'a second activity is a second day', String(afterWork?.days));
    t.ok(afterWork?.gold >= purseBefore, 'and a day of Earn Income never costs the hero money',
      `${purseBefore} -> ${afterWork?.gold}`);
    await p.click('#modal-foot button');
    await waitFor(p, () => !document.getElementById('modal-veil').classList.contains('open'), { timeout: 5000 });
    t.ok(/2 days of downtime spent/.test(await textContent(p, '#hero-status')),
      'the title screen keeps the calendar', await textContent(p, '#hero-status'));

    /* Phase 8. Two things only a browser can say.

       First: the title screen's own top. #screen-title is a scrollable flex
       column, and a flex column that centres its children puts the overflow
       ABOVE the scroll origin, where nothing can reach it. Four packs on the
       Shelf is enough to overflow 800px, and before `justify-content: safe
       center` the title, New Game and Begin Adventure sat at y = -47 with
       scrollTop pinned at 0 — unclickable for a player and for this suite,
       which is how it was found. Scroll to the top and measure. */
    await p.evaluate(() => { document.getElementById('screen-title').scrollTop = 0; });
    const topmost = await p.evaluate(() => {
      const r = document.getElementById('btn-begin-adv').getBoundingClientRect();
      const sec = document.getElementById('screen-title');
      return { y: Math.round(r.y), cards: document.querySelectorAll('[data-shelf]').length,
               overflows: sec.scrollHeight > sec.clientHeight };
    });
    t.ok(topmost.overflows && topmost.y >= 0,
      'with the whole Shelf loaded the title screen still overflows, and its top is reachable',
      `Begin Adventure at y=${topmost.y}, ${topmost.cards} shelf cards, overflowing: ${topmost.overflows}`);

    /* Second: the pack workbench. smoke.mjs drives every function it calls;
       what it cannot see is whether the page wires them to anything. */
    await p.goto(new URL('/Projects/torchbearer/authoring.html', p.url()).href, { waitUntil: 'load' });
    await waitFor(p, () => document.querySelectorAll('#ref-boxes [data-ref]').length > 0, { timeout: 10000 });
    t.ok((await p.$$eval('#ref-boxes [data-ref]', els => els.length)) === 4,
      'the workbench offers every Shelf pack as reference content');

    const broken = JSON.stringify({
      pack: { id: 'wb-test', name: 'Workbench Test' },
      monsters: [{ id: 'wb-thing', name: 'Thing', ac: 16, hp: 10, saves: {}, tratis: ['undead'] }],
      adventures: [{ id: 'wb-adv', name: 'Adv', start: 'one', scenes: {
        one: { title: 'One', text: ['x'], choices: [{ text: 'roll', check: { skill: 'athletics', dc: 15, success: 'two' } }] },
        two: { title: 'Two', text: ['x'], ending: true, choices: [] },
        lost: { title: 'Lost', text: ['x'], choices: [] } } }]
    }, null, 2);
    await p.evaluate(text => {
      const box = document.getElementById('paste');
      box.value = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }, broken);
    await waitFor(p, () => /error/.test(document.querySelector('.verdict h3')?.textContent || ''), { timeout: 5000 });
    const found = await p.evaluate(() => ({
      verdict: document.querySelector('.verdict h3').textContent,
      errors: [...document.querySelectorAll('.block')].find(b => /Errors/.test(b.querySelector('h3').textContent))
        ?.querySelectorAll('li').length || 0,
      lines: [...document.querySelectorAll('button.hit')].map(b => b.dataset.line),
      note: [...document.querySelectorAll('.note-text')].map(e => e.textContent.trim()).join(' | '),
      walk: [...document.querySelectorAll('.walk .bad')].map(e => e.textContent.trim())
    }));
    t.ok(found.errors >= 3 && found.lines.length >= 3,
      'a broken pack reports its errors with line numbers to jump to',
      `${found.verdict}: ${found.errors} errors, lines ${found.lines.join(',')}`);
    t.ok(/tratis/.test(found.note) && /traits/.test(found.note),
      'a misspelled key is a note, not an error, and names the field it is one slip from', found.note);
    t.ok(found.walk.includes('unreachable') && found.walk.includes('check with no branch'),
      'the dry run runs on a pack that does not validate, and names both faults',
      found.walk.join(', ') || 'nothing reported');
    t.ok(await p.$eval('#btn-play', e => e.disabled), 'and Load into the game is refused while it is broken');
    await t.shot('workbench-broken-pack');

    await p.evaluate(async url => {
      const text = await (await fetch(url)).text();
      const box = document.getElementById('paste');
      box.value = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }, new URL('/Projects/torchbearer/packs/cold-harrow.json', p.url()).href);
    await waitFor(p, () => /Cold Harrow/.test(document.querySelector('.verdict h3')?.textContent || ''), { timeout: 8000 });
    const good = await p.evaluate(() => ({
      verdict: document.querySelector('.verdict h3').textContent,
      stats: document.querySelector('.walk .stats')?.textContent || '',
      faults: document.querySelectorAll('.walk .bad').length,
      play: !document.getElementById('btn-play').disabled
    }));
    t.ok(good.play && good.faults === 0 && /20 scenes, 20 reachable/.test(good.stats),
      'Cold Harrow validates in the workbench and walks clean', `${good.verdict} — ${good.stats}`);
    await t.shot('workbench-cold-harrow');

    // The courier. Clicking the button opens a second tab, which this suite has
    // no business owning, so drive the same handoff the button drives.
    const carried = await p.evaluate(() => {
      const text = document.getElementById('paste').value;
      sessionStorage.setItem('torchbearer:workbench-pack', text);
      return sessionStorage.getItem('torchbearer:workbench-pack').length;
    });
    await p.goto(new URL('/Projects/torchbearer.html?pack=workbench', p.url()).href, { waitUntil: 'load' });
    await waitFor(p, () => window.__torchbearer?.packs?.some?.(x => x.id === 'cold-harrow')
      || document.getElementById('modal-veil')?.classList.contains('open'), { timeout: 10000 });
    const delivered = await p.evaluate(() => ({
      packs: [...document.querySelectorAll('#pack-list .pk')].map(e => e.textContent.trim()),
      left: sessionStorage.getItem('torchbearer:workbench-pack'),
      title: document.getElementById('modal-title')?.textContent || ''
    }));
    t.ok(carried > 1000 && delivered.packs.some(n => /Cold Harrow/.test(n)),
      'the workbench hands a pack to the game and the game loads it',
      `${delivered.title} — packs: ${delivered.packs.join(', ')}`);
    t.ok(delivered.left === null, 'and the courier key is cleared, so a refresh does not load it twice');
    await t.shot('workbench-handoff');
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
