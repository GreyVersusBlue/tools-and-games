// Movement's Routes choice, Usual or Crowd-aware, in a real browser:
//   node test/browser/crowd-aware.mjs
//
// SV2-154 (DESIGN 17.4, 17.6, 17.7 items 4 to 9; ARCHITECTURE 23.5, 23.7,
// 23.12). Each journey is walked by pointer, by keyboard and by touch on a
// page 1280 wide and on one 390 wide (the phone folds the controls behind
// Change and puts the inspector in a sheet). Two schools: the two-halls
// building (test/fixtures/buildings/two-halls.mjs), where the rule moves four
// groups and waiting falls from 5 min 12 s to 2 min 12 s, and the plain
// sample, which honestly moves none.
//
// What is checked is what the page says: the Routes radio (Usual on every
// visit), the band while the answer is awaited (the lane is held by a test
// hook so the working state is there to read, never raced), the failure with
// Try again, the first line with the trade, the legend's "another way" and
// the usual route drawn faint and dashed for a chosen row, Travel time's Usual
// column and its note, Hotspots, the card's two counts, Playback, the
// export's file and header, the print's header, the presentation caption,
// and the phone's "Try crowd-aware routes" link. Every wait is on a state the
// page sets: the section's `data-crowd` ('off', 'working', 'ready', 'failed')
// and `data-pending` gone, a control's box the same two frames running; never
// a first paint and never a sleep. Touch cannot drive a native select, and
// there is none here: Routes is a radio group.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, atRest, launch, startServer, loadModule } from './harness.mjs';
import { plainSchool } from '../engine/helpers.mjs';
import { formatDuration } from '../../engine/findings.js';

const SIZES = [{ name: '1280', width: 1280, height: 900, phone: false }, { name: '390', width: 390, height: 844, phone: true }];
const MODES = ['pointer', 'keyboard', 'touch'];
// CROWD_ONLY="1280 pointer" runs one size and mode while a case is being made (everything when unset)
const ONLY = (process.env.CROWD_ONLY || '').split(' ').filter(Boolean);
const wanted = (size, mode) => ONLY.length === 0 || (ONLY.includes(size.name) && (mode === undefined || ONLY.includes(mode) || !MODES.some((m) => ONLY.includes(m))));

const HINT = 'Crowd-aware: groups that wait in a jam try a slightly longer way (at most 30 s or a quarter more walking). A what-if: checks use the usual routes.';
const WORKING = 'Working out crowd-aware routes…';
const FAILED = 'Crowd-aware routes could not be worked out. The map shows the usual routes ·';
const NOTE = 'Groups are not routed from here: this shows where the building has spare corridor room. Hotspots shows the jams it eases.';
const TWO_HALLS_LINE = 'Crowd-aware routes on A Day: 4 groups take another way: 3 min less waiting, 24 s more walking (summed over the groups’ walks); no group late. A what-if: checks use the usual routes.';
const SAMPLE_LINE = 'Crowd-aware routes on A Day: no group finds a quicker way round. The usual routes already use the building well. A what-if: checks use the usual routes.';

let browser;
let server;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

const clone = (value) => JSON.parse(JSON.stringify(value));

// ---- the page

// The two-halls school (or the sample) put in the store, and the view settled on it.
async function open(size, school) {
  const session = await openPlanner({ hash: '#movement', theme: 'light', width: size.width, height: size.height, mobile: size.phone, browser, server });
  const { page } = session;
  if (school === 'halls') {
    await loadModule(page, 'halls', 'test/fixtures/buildings/two-halls.mjs');
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      const next = globalThis.sv2modules.halls.twoHalls();
      next.settings.theme = store.project.settings.theme;
      store.replace(next);
      await store.derived.results().catch(() => null);
    });
  } else {
    await page.evaluate(async (next) => {
      const { store } = globalThis.sv2;
      next.settings.theme = store.project.settings.theme;
      store.replace(next);
      await store.derived.results().catch(() => null);
    }, clone(plainSchool()));
  }
  await settled(page);
  return session;
}

// The view has the answer for the project as it is now, and has drawn it.
async function settled(page) {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true' || !section.movement) return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 20000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

// The crowd-aware answer is on screen (or the state the page says it is in).
async function crowd(page, state) {
  await page.waitForFunction((wantedState) => document.querySelector('.mov')?.dataset.crowd === wantedState, { timeout: 30000 }, state);
  await settled(page);
}

const line = (page) => page.$eval('#movement-line .mov-line__words', (el) => el.textContent.replace(/\s+/g, ' ').trim());
const choice = (page) => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.mov').movement.choice)));
const text = (page, selector) => page.$eval(selector, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const hidden = (page, selector) => page.$eval(selector, (el) => el.hidden || el.closest('[hidden]') !== null || el.getClientRects().length === 0);
const checked = (page, name) => page.$eval('input[name="' + name + '"]:checked', (el) => el.value);

// The lane held by a test hook, so the answer comes when the test lets it (and the working band is there to read).
const hold = (page) => page.evaluate(() => {
  const derived = globalThis.sv2.store.derived;
  const kept = { real: derived.crowd, release: null };
  globalThis.__crowd = kept;
  derived.crowd = (options) => new Promise((resolve) => {
    kept.release = () => kept.real.call(derived, options).then(resolve);
  });
});
const release = async (page) => {
  await page.waitForFunction(() => typeof globalThis.__crowd?.release === 'function', { timeout: 10000 });
  await page.evaluate(() => globalThis.__crowd.release());
};
// the next asking fails with this message
const failWith = (page, message) => page.evaluate((words) => {
  const derived = globalThis.sv2.store.derived;
  globalThis.__crowd = { real: globalThis.__crowd ? globalThis.__crowd.real : derived.crowd };
  derived.crowd = () => Promise.resolve({ failed: words });
}, message);
const restore = (page) => page.evaluate(() => {
  if (globalThis.__crowd) globalThis.sv2.store.derived.crowd = globalThis.__crowd.real;
  globalThis.__crowd = null;
});

// ---- the three ways of acting

async function reach(page, selector) {
  await page.evaluate((wantedSelector) => document.querySelector(wantedSelector).scrollIntoView({ block: 'center', inline: 'center' }), selector);
  return atRest(page, selector);
}

function hands(page, mode) {
  async function touch(selector) {
    const box = await reach(page, selector);
    await page.touchscreen.tap(box.left + box.width / 2, box.top + box.height / 2);
  }
  async function pointer(selector) {
    const box = await reach(page, selector);
    await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
  }
  async function keys(selector, key) {
    await reach(page, selector);
    await page.focus(selector);
    await page.keyboard.press(key || 'Enter');
  }
  return {
    // a button, link or tab
    async press(selector, key) {
      if (mode === 'touch') await touch(selector);
      else if (mode === 'pointer') await pointer(selector);
      else await keys(selector, key);
      await settled(page);
    },
    // a radio of a group: the choice made, whichever way the group is reached
    async radio(name, value) {
      const selector = 'input[name="' + name + '"][value="' + value + '"]';
      if (mode === 'keyboard') {
        const now = await checked(page, name);
        const values = await page.$$eval('input[name="' + name + '"]', (els) => els.map((el) => el.value));
        await reach(page, 'input[name="' + name + '"]:checked');
        await page.focus('input[name="' + name + '"]:checked');
        const steps = values.indexOf(value) - values.indexOf(now);
        for (let i = 0; i < Math.abs(steps); i += 1) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
      } else if (mode === 'touch') {
        await touch(selector + ' + span, ' + selector);
      } else {
        await pointer(selector + ' + span, ' + selector);
      }
      await settled(page);
    },
  };
}

async function openControls(page, act) {
  const open = await page.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded') === 'true');
  if (!open) await act.press('[data-action="change"]');
  await page.waitForFunction(() => !document.querySelector('.mov-controls').hidden);
}

async function tab(page, act, id) {
  const folded = await page.$eval('#inspector-toggle', (el) => el.getAttribute('aria-expanded') === 'false').catch(() => false);
  if (folded) await act.press('#inspector-toggle');
  await page.waitForSelector('#inspector [role="tab"][data-tab="' + id + '"]');
  await act.press('#inspector [role="tab"][data-tab="' + id + '"]', 'Enter');
  await page.waitForFunction((wantedTab) => document.querySelector('#inspector [role="tab"][aria-selected="true"]')?.dataset.tab === wantedTab, {}, id);
}

// the phone's inspector is a sheet over the map: folded, so the map is the page's to draw and to press
async function foldInspector(page) {
  if (await page.$eval('#inspector-toggle', (el) => el.getBoundingClientRect().width > 0 && matchMedia('(max-width: 640px)').matches && el.getAttribute('aria-expanded') === 'true').catch(() => false)) {
    await page.$eval('#inspector-toggle', (el) => el.click());
    await page.waitForFunction(() => document.querySelector('#inspector-toggle').getAttribute('aria-expanded') === 'false');
  }
}

// What the canvas was told about dashes over a few draws of the map.
async function dashesDrawn(page, pattern) {
  await foldInspector(page);
  await page.evaluate(() => {
    globalThis.__dashes = [];
    if (!CanvasRenderingContext2D.prototype.__spied) {
      const original = CanvasRenderingContext2D.prototype.setLineDash;
      CanvasRenderingContext2D.prototype.setLineDash = function spy(list) {
        globalThis.__dashes.push(Array.from(list));
        return original.call(this, list);
      };
      CanvasRenderingContext2D.prototype.__spied = true;
    }
  });
  return page.evaluate(async (wantedPattern) => {
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let pass = 0; pass < 5; pass += 1) {
      document.querySelector('.mov').movement.env.paint();
      await frames();
      if (globalThis.__dashes.some((list) => list.join(',') === wantedPattern)) break;
    }
    return globalThis.__dashes.map((list) => list.join(','));
  }, pattern);
}

// A box on screen: its rectangle, or null when it is not drawn (hidden, or no size)
const rectOf = (page, selector) => page.evaluate((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.closest('[hidden]') || el.getClientRects().length === 0) return null;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}, selector);
const crosses = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// What the live regions say: each time a region that a screen reader reads (aria-live, role status or alert) comes to hold
// `phrase`, one entry. The hold is counted per change, so one sentence said by two regions, or twice, is two.
const watchSays = (page, phrase) => page.evaluate((words) => {
  globalThis.__says = [];
  if (globalThis.__sayObserver) globalThis.__sayObserver.disconnect();
  const live = (node) => {
    const el = node.nodeType === 3 ? node.parentElement : node;
    return el && el.closest ? el.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]') : null;
  };
  globalThis.__sayObserver = new MutationObserver((records) => {
    for (const record of records) {
      const region = live(record.target);
      if (region && !region.closest('[hidden]') && region.textContent.includes(words)) globalThis.__says.push(region.id || region.dataset.part || region.className);
    }
  });
  globalThis.__sayObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
}, phrase);
const says = (page) => page.evaluate(() => globalThis.__says.slice());

const fitted = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// ---- the two-halls building, by pointer, keyboard and touch

for (const size of SIZES) {
  for (const mode of MODES) {
    if (!wanted(size, mode)) continue;
    describe('crowd-aware routes on two-halls, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      let usualHotspots = '';
      before(async () => {
        session = await open(size, 'halls');
        page = session.page;
        act = hands(page, mode);
        await openControls(page, act);
      });
      after(async () => {
        if (session) await session.close();
      });

      test('Routes is Usual on arrival, two choices and one line, and the map is the usual picture', async () => {
        assert.equal(await checked(page, 'movement-routes'), 'usual');
        const labels = await page.$$eval('input[name="movement-routes"] + span', (els) => els.map((el) => el.textContent.trim()));
        assert.deepEqual(labels, ['Usual (quickest)', 'Crowd-aware']);
        assert.equal(await text(page, '[data-part="routes-line"]'), HINT);
        // the line is text on the page, not a pop-up of the hover: drawn, visible, inside the window, with nobody over it
        const hint = await rectOf(page, '[data-part="routes-line"]');
        assert.ok(hint && hint.width > 0 && hint.height > 0, 'the what-if line is not drawn');
        assert.ok(hint.left >= 0 && hint.right <= size.width, 'the line leaves the window: ' + JSON.stringify(hint));
        assert.equal(await page.$eval('[data-part="routes-line"]', (el) => getComputedStyle(el).position), 'static', 'the line floats over what is under it');
        // the first line a screen reader reads is the sentence: the radio group is not in it
        assert.equal(await page.$('#movement-line input'), null, 'the radio group is inside the first line');
        assert.ok(!/Usual \(quickest\)|Crowd-aware/.test(await text(page, '#movement-line')), await text(page, '#movement-line'));
        // and neither hovering nor focusing the choice moves the map or draws anything over it
        // (what moves with the section's scroll is not the map moving: the box above it and the stage's place under it)
        const stage = () => page.evaluate(() => {
          const top = document.querySelector('.mov-top').getBoundingClientRect();
          const map = document.querySelector('.mov-stage').getBoundingClientRect();
          return { above: top.height, under: map.top - top.top, height: map.height, width: map.width };
        });
        const before = await stage();
        await page.hover('input[name="movement-routes"] + span');
        await page.focus('input[name="movement-routes"]:checked');
        const after = await stage();
        assert.deepEqual(after, before, 'the map moved with the hover and the focus');
        await page.mouse.move(0, 0);
        assert.equal((await choice(page)).routes, 'usual');
        assert.equal(await page.$eval('.mov', (el) => el.dataset.crowd), 'off');
        assert.equal(await hidden(page, '[data-part="crowd"]'), true, 'no band');
        assert.match(await line(page), /^Showing 8 groups on A Day, all transitions\./);
        assert.equal(await page.$('[data-action="try-crowd"]'), null, 'with Routes in view there is no link to it');
        if (size.phone) {
          const box = await page.$eval('input[name="movement-routes"] + span', (el) => el.getBoundingClientRect().height);
          assert.ok(box >= 44, 'a finger’s target: ' + box);
        }
        usualHotspots = await (async () => {
          await tab(page, act, 'hotspots');
          return page.$eval('#inspector [data-panel="hotspots"]', (el) => el.textContent.replace(/\s+/g, ' '));
        })();
        assert.equal(await hidden(page, '#inspector [data-hotspots="what-if"]'), true, 'the usual routes\' Hotspots carry the what-if line');
      });

      test('choosing Crowd-aware: a quiet band says it is being worked out, and the map keeps the usual picture under it', async () => {
        await foldInspector(page);
        await hold(page);
        await act.radio('movement-routes', 'crowd');
        await page.waitForFunction(() => document.querySelector('.mov')?.dataset.crowd === 'working');
        assert.equal((await choice(page)).routes, 'crowd');
        assert.equal(await text(page, '[data-part="crowd-status"]'), WORKING);
        assert.equal(await page.$eval('[data-part="crowd-status"]', (el) => el.getAttribute('role')), 'status');
        assert.equal(await hidden(page, '[data-part="crowd"]'), false);
        assert.equal(await hidden(page, '[data-action="try-again"]'), true);
        const seen = await page.evaluate(() => {
          const shown = document.querySelector('.mov').movement.picture;
          return { mode: shown.routesMode, pending: shown.routesPending };
        });
        assert.deepEqual(seen, { mode: 'usual', pending: true });
        assert.match(await line(page), /^Showing 8 groups on A Day, all transitions\./, 'the first line is still the usual one');
        // the band is one line above the map, never over it
        const over = await page.evaluate(() => {
          const band = document.querySelector('[data-part="crowd"]').getBoundingClientRect();
          const map = document.querySelector('#movement-plan').getBoundingClientRect();
          return band.bottom <= map.top + 1;
        });
        assert.equal(over, true, 'the band is above the map');
        // the what-if line stands clear of the band and everything in it
        const hint = await rectOf(page, '[data-part="routes-line"]');
        const band = await rectOf(page, '[data-part="crowd"]');
        assert.ok(hint && band && !crosses(hint, band), 'the what-if line covers the band: ' + JSON.stringify({ hint, band }));
      });

      test('the answer: the first line gives the comparison and its trade, the band gives way to the one line that says what it is for', async () => {
        await release(page);
        await crowd(page, 'ready');
        assert.equal(await line(page), TWO_HALLS_LINE);
        assert.equal(await text(page, '[data-part="crowd-note"]'), NOTE);
        assert.equal(await text(page, '[data-part="crowd-status"]'), '', 'nothing is being worked out');
        const hint = await rectOf(page, '[data-part="routes-line"]');
        const note = await rectOf(page, '[data-part="crowd-note"]');
        assert.ok(hint && note && !crosses(hint, note), 'the what-if line covers the note under the first line');
        const seen = await page.evaluate(() => {
          const shown = document.querySelector('.mov').movement.picture;
          return { mode: shown.routesMode, moved: shown.changed.length, waiting: shown.compare.aware.waiting, was: shown.compare.usual.waiting, late: [shown.compare.usual.late, shown.compare.aware.late] };
        });
        assert.deepEqual(seen, { mode: 'crowd', moved: 4, waiting: 132, was: 312, late: [0, 0] });
        assert.match(await text(page, '[data-legend="routes"]'), /^Crowd-aware routes \(a what-if\): the lines and the load are the crowd-aware ones; checks use the usual routes\./);
        assert.equal(await page.$eval('.mov', (el) => el.dataset.pending || ''), '', 'the lens is not a pending answer');
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });

      test('findings never change: the main answer\'s findings are the very ones the view holds, and the Checks counts are as before', async () => {
        const same = await page.evaluate(async () => {
          const main = await globalThis.sv2.store.derived.results();
          const shown = document.querySelector('.mov').movement.state.results;
          return { found: shown.findings === main.findings, count: shown.findings.findings.length, mainCount: main.findings.findings.length, usual: shown.crowdAware.usual === main };
        });
        assert.deepEqual(same, { found: true, count: same.mainCount, mainCount: same.mainCount, usual: true });
      });

      test('Summary marks a group that took another way with the seconds it saved; its row draws the usual route faint and dashed, and again takes it away', async () => {
        await tab(page, act, 'summary');
        const rows = await page.$$eval('#inspector [data-summary="groups"] tbody tr', (els) => els.map((el) => ({ group: el.dataset.group, another: el.dataset.another === 'true', words: el.querySelector('[data-part="another-way"]')?.textContent || '' })));
        assert.equal(rows.length, 8);
        const moved = rows.filter((row) => row.another);
        assert.equal(moved.length, 4);
        assert.ok(moved.every((row) => /^another way · \d+ s saved$/.test(row.words)), moved.map((row) => row.words).join(' | '));
        assert.deepEqual(rows.filter((row) => !row.another).map((row) => row.words), ['', '', '', '']);
        // the figure of groups that cannot make a transition is the lens's, and says so (Checks keep the usual routes' count)
        assert.match(await text(page, '#inspector [data-figure="late"]'), /On crowd-aware routes \(a what-if\): checks use the usual routes\./);
        assert.ok(!(await dashesDrawn(page, '3,5')).includes('3,5'), 'no usual route is drawn until a row is chosen');
        const selector = '#inspector [data-action="show-usual"][data-group="' + moved[0].group + '"]';
        // drawing the map folded the phone's sheet: the tab is opened again for each press
        await tab(page, act, 'summary');
        assert.equal(await page.$eval(selector, (el) => el.getAttribute('aria-pressed')), 'false');
        await act.press(selector);
        assert.equal(await page.$eval(selector, (el) => el.getAttribute('aria-pressed')), 'true');
        assert.equal(await page.evaluate(() => document.querySelector('.mov').movement.env.usual()), moved[0].group);
        assert.match(await text(page, '[data-legend="usual"]'), /^Faint and dashed: the usual route of West \d\.$|^Faint and dashed: the usual route of East \d\.$/);
        assert.ok((await dashesDrawn(page, '3,5')).includes('3,5'), 'the usual route is drawn dashed');
        await tab(page, act, 'summary');
        await act.press(selector);
        assert.equal(await page.evaluate(() => document.querySelector('.mov').movement.env.usual()), null);
        assert.equal(await hidden(page, '[data-legend="usual"]'), true);
        assert.ok(!(await dashesDrawn(page, '3,5')).includes('3,5'), 'and taken away');
      });

      test('Travel time follows the chosen routes and has a Usual column with the checks note', async () => {
        await tab(page, act, 'tables');
        const table = await page.$eval('#inspector [data-travel="day"] table', (el) => ({ heads: Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent), usual: Array.from(el.querySelectorAll('td[data-cell="usual"]')).map((td) => td.textContent), waits: Array.from(el.querySelectorAll('tbody.mov-travel__group')).map((tb) => tb.dataset.total) }));
        assert.deepEqual(table.heads, ['Walking', 'Waiting', 'Total', 'Usual']);
        assert.equal(table.usual.length, 8);
        assert.ok(table.usual.every((words) => /^\d+ (s|min)/.test(words) && !/late in Checks/.test(words)), table.usual.join(' | '));
        const expected = await page.evaluate(() => {
          const shown = document.querySelector('.mov').movement.state;
          const usual = shown.results.crowdAware.usual;
          const sums = new Map();
          for (const walk of usual.walks.groups) sums.set(walk.groupId, (sums.get(walk.groupId) || 0) + walk.total);
          return shown.project.groups.map((group) => ({ id: group.id, total: sums.get(group.id) }));
        });
        const byGroup = await page.$$eval('#inspector [data-travel="day"] tbody.mov-travel__group', (els) => els.map((el) => ({ id: el.dataset.group, usual: el.querySelector('td[data-cell="usual"]').textContent })));
        for (const want of expected) assert.equal(byGroup.find((row) => row.id === want.id).usual, formatDuration(want.total), want.id);
        const lead = await text(page, '#inspector [data-travel="lead"]');
        assert.match(lead, /Crowd-aware routes \(a what-if\): the Usual column is the total on the quickest route, which is what Checks use\./);
        assert.equal(await hidden(page, '#inspector [data-travel="print-note"]'), false, 'the print says which routes it is of');
      });

      test('Hotspots follow the chosen routes', async () => {
        await tab(page, act, 'hotspots');
        const now = await page.$eval('#inspector [data-panel="hotspots"]', (el) => el.textContent.replace(/\s+/g, ' '));
        assert.notEqual(now, usualHotspots, 'the delay at the places is the crowd-aware routes\'');
        assert.ok((await page.$$eval('#inspector [data-panel="hotspots"] tbody tr', (els) => els.length)) > 0);
        // and the panel says the routes are a what-if (DESIGN 17.1, 17.4), where on the usual routes it says nothing of the kind
        assert.equal(await text(page, '#inspector [data-hotspots="what-if"]'), 'Crowd-aware routes (a what-if): the places and their loads are the crowd-aware ones. Checks use the usual routes.');
        assert.equal(await hidden(page, '#inspector [data-hotspots="what-if"]'), false);
      });

      test('the card of a corridor cell says how many groups cross on each routes', async () => {
        await foldInspector(page);
        await loadModule(page, 'model', 'ui/movement/model.js');
        const target = await page.evaluate(() => {
          const movement = document.querySelector('.mov').movement;
          const { cellCard } = globalThis.sv2modules.model;
          const state = movement.state;
          for (const floor of state.project.building.floors) {
            for (let cell = 0; cell < floor.width * floor.height; cell += 1) {
              const card = cellCard(state.project, state.results, state.graph, state.picture, floor.id, cell);
              if (card && card.crowd && card.crowd.aware !== card.crowd.usual) return { floorId: floor.id, cell, crowd: card.crowd };
            }
          }
          return null;
        });
        assert.ok(target, 'some cell is crossed by a different number of groups');
        await page.evaluate((at) => {
          const movement = document.querySelector('.mov').movement;
          movement.canvas.scrollIntoView({ block: 'center' });
          movement.fit();
          movement.env.show(at.floorId, [at.cell]);
        }, target);
        await fitted(page);
        const at = await page.evaluate((found) => {
          const movement = document.querySelector('.mov').movement;
          const box = movement.canvas.getBoundingClientRect();
          const place = movement.cellAt(found.floorId, found.cell);
          const slot = movement.world.slots.find((each) => each.floor.id === found.floorId);
          return { x: box.left + place.x, y: box.top + place.y, row: slot.y + Math.floor(found.cell / slot.floor.width) - slot.box.y, column: slot.x + (found.cell % slot.floor.width) - slot.box.x };
        }, target);
        if (mode === 'pointer') {
          await page.mouse.move(at.x, at.y);
        } else if (mode === 'touch') {
          await page.touchscreen.tap(at.x, at.y);
        } else {
          await page.evaluate((from, row) => document.querySelector('.mov').movement.cursor.moveTo(from, row, true), at.column > 0 ? at.column - 1 : at.column + 1, at.row);
          await page.focus('#movement-plan');
          await page.keyboard.press(at.column > 0 ? 'ArrowRight' : 'ArrowLeft');
        }
        await page.waitForSelector('.mov-card:not([hidden]) .mov-card__crowd:not([hidden])', { timeout: 10000 });
        const words = await text(page, '.mov-card__crowd');
        assert.equal(words, 'Crowd-aware: ' + target.crowd.aware + ' group' + (target.crowd.aware === 1 ? '' : 's') + ' here, usual: ' + target.crowd.usual);
        await page.keyboard.press('Escape');
      });

      test('Playback plays the chosen routes', async () => {
        await settled(page);
        assert.equal(await page.$eval('[data-action="play"]', (el) => el.getAttribute('aria-disabled') !== 'true' && !el.disabled), true);
        const read = await page.evaluate(() => {
          const shown = document.querySelector('.mov').movement.state;
          return { view: shown.results.crowdAware !== undefined, crowd: shown.results.crowd.days[0] === shown.results.crowdAware.run.crowd };
        });
        assert.deepEqual(read, { view: true, crowd: true });
        await act.press('.mov-strip__item[data-transition="0"]');
        await act.press('[data-action="play"]');
        await page.waitForFunction(() => document.querySelector('[data-bar="playback"]')?.dataset.started === 'true');
        await act.press('[data-action="play"]');
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
        await act.press('.mov-strip__item[data-transition="all"]');
      });

      test('Export says what-if: the files carry it and the usual total, the print header and the congestion report say which routes', async () => {
        await tab(page, act, 'export');
        assert.match(await text(page, '#inspector [data-export="crowd"]'), /^Crowd-aware routes \(a what-if\) are on:/);
        const files = await page.evaluate(async () => {
          const panel = document.querySelector('#inspector [data-panel="export"]');
          const got = [];
          panel.exports.hooks.deliver = (file) => got.push(file);
          for (const action of ['csv-transitions', 'csv-day', 'csv-hotspots']) {
            const before = got.length;
            panel.querySelector('[data-action="' + action + '"]').click();
            for (let i = 0; i < 200 && got.length === before; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          panel.exports.hooks.deliver = null;
          return got.map((file) => ({ name: file.fileName, rows: file.text.split(/\r?\n/).filter(Boolean) }));
        });
        assert.equal(files.length, 3);
        assert.ok(files.every((file) => /crowd-aware/.test(file.name)), files.map((file) => file.name).join(', '));
        const [transitions, day, hotspots] = files;
        assert.match(transitions.rows[0], /Usual total \(seconds\)/);
        assert.match(transitions.rows[1], /crowd-aware routes, a what-if/);
        assert.match(day.rows[0], /Usual total \(seconds\)/);
        assert.match(hotspots.rows[0], /,Routes$/);
        assert.match(hotspots.rows[1], /Crowd-aware routes \(a what-if\)$/);
        // the picture's header and the print's header, from the one function each reads
        await loadModule(page, 'prints', 'ui/prints/movement.js');
        const header = await page.evaluate(() => {
          const movement = document.querySelector('.mov').movement;
          const { shownSentence, render } = globalThis.sv2modules.prints;
          const shown = movement.state;
          const html = render(shown.project, null, { movement: { project: shown.project, results: shown.results, graph: shown.graph, choice: movement.picture.choice, parts: {} } });
          return { sentence: shownSentence(shown.project, movement.picture), html: typeof html === 'string' ? html : JSON.stringify(html) };
        });
        assert.match(header.sentence, /Crowd-aware routes \(a what-if\)\.$/);
        assert.match(header.html, /Crowd-aware routes are a what-if: groups that wait in a jam try a slightly longer way\. Checks use the usual routes\./);
      });

      test('the presentation\'s caption says it in full, and leaving puts the section back', async () => {
        await foldInspector(page);
        await page.keyboard.press('Escape');
        await page.evaluate(() => { document.querySelector('.mov').movement.canvas.scrollIntoView({ block: 'center' }); });
        await act.press('[data-action="present"]');
        await page.waitForFunction(() => document.querySelector('.mov')?.dataset.present === 'fullscreen' || document.querySelector('.mov')?.dataset.present === 'window');
        assert.match(await text(page, '[data-part="present-caption"]'), /A Day · All transitions of the day · crowd-aware routes \(a what-if\)/);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('.mov')?.dataset.present);
        assert.equal((await choice(page)).routes, 'crowd');
      });

      test('Try again after a failure: the line says so, the radio stays on Crowd-aware, and the usual map stands until it works', async () => {
        await foldInspector(page);
        await openControls(page, act);
        await act.radio('movement-routes', 'usual');
        assert.equal(await page.$eval('.mov', (el) => el.dataset.crowd), 'off');
        assert.equal(await hidden(page, '[data-part="crowd"]'), true, 'the band goes with the choice');
        await failWith(page, 'the engine broke');
        await watchSays(page, 'could not be worked out');
        await act.radio('movement-routes', 'crowd');
        await crowd(page, 'failed');
        assert.equal(await text(page, '[data-part="crowd-failed"]'), FAILED);
        assert.equal(await text(page, '[data-part="crowd-status"]'), '', 'the working region is empty: the failure is not said by it as well');
        // said once, by the one region the page announces in, not twice
        assert.deepEqual(await says(page), ['announcer']);
        // the what-if line is clear of the failure line and Try again
        const hint = await rectOf(page, '[data-part="routes-line"]');
        const failed = await rectOf(page, '[data-part="crowd"]');
        const again = await rectOf(page, '[data-action="try-again"]');
        assert.ok(hint && failed && again, 'the line, the failure or Try again is not drawn');
        assert.ok(!crosses(hint, failed) && !crosses(hint, again), 'the what-if line covers the failure or Try again');
        assert.equal(await checked(page, 'movement-routes'), 'crowd', 'the radio stays on Crowd-aware');
        assert.match(await line(page), /^Showing 8 groups on A Day, all transitions\./, 'the map shows the usual routes');
        assert.equal(await page.evaluate(() => document.querySelector('.mov').movement.picture.routesMode), 'usual');
        assert.equal(await hidden(page, '[data-action="try-again"]'), false);
        await restore(page);
        await act.press('[data-action="try-again"]');
        await crowd(page, 'ready');
        assert.equal(await line(page), TWO_HALLS_LINE);
        assert.equal(await hidden(page, '[data-action="try-again"]'), true);
        assert.equal(await page.evaluate(() => document.activeElement && (document.activeElement.name === 'movement-routes' || document.activeElement.dataset.action === 'change')), true, 'the focus did not fall to the page');
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });

      test('a change to the schedule asks again: the answer is for the project as it is', async () => {
        const before = await page.evaluate(() => document.querySelector('.mov').movement.state.project);
        await page.evaluate(async () => {
          const { store } = globalThis.sv2;
          // the same school as a new object: a project the lens has no answer for
          store.replace(JSON.parse(JSON.stringify(store.project)));
          await store.derived.results().catch(() => null);
        });
        await settled(page);
        await crowd(page, 'ready');
        const after = await page.evaluate(() => {
          const movement = document.querySelector('.mov').movement;
          return { same: movement.state.project === globalThis.sv2.store.project, mode: movement.picture.routesMode };
        });
        assert.deepEqual(after, { same: true, mode: 'crowd' });
        assert.ok(before);
      });

      test('Clear leaves Routes as it was, and a teacher hides it; the usual routes are back on the next visit', async () => {
        await page.evaluate(() => document.querySelector('.mov').movement.change({ who: 'teacher', teacherId: null }));
        await settled(page);
        assert.equal(await hidden(page, '[data-control="routes"]'), true, 'a teacher is not rerouted, so Routes is not offered');
        assert.equal(await hidden(page, '[data-part="crowd"]'), true);
        await page.evaluate(() => document.querySelector('.mov').movement.change({ who: 'all' }));
        await settled(page);
        await crowd(page, 'ready');
        // another section and back: Usual again
        await page.evaluate(() => { location.hash = '#schedule'; });
        await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
        await page.evaluate(() => { location.hash = '#movement'; });
        await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'movement');
        await settled(page);
        assert.equal((await choice(page)).routes, 'usual');
        assert.equal(await page.$eval('.mov', (el) => el.dataset.crowd), 'off');
      });
    });
  }
}

// ---- the lens when what it was asked for is not what is on screen (SV2-153b; the review of SV2-154, items 6, 7 and 9)

describe('crowd-aware routes: an answer that went out of date, a choice the project put right, a view that goes', () => {
  let session;
  let page;
  before(async () => {
    session = await open(SIZES[0], 'halls');
    page = session.page;
  });
  after(async () => {
    if (session) await session.close();
  });

  // A lane that answers null (the counters moved before it ran) for the first `nulls` askings, then for real; each asking is logged.
  // Askings numbered in `held` wait for the test to let them go with `answerHeld`.
  const lane = (nulls, held) => page.evaluate((count, holding) => {
    const derived = globalThis.sv2.store.derived;
    const real = globalThis.__crowdReal || derived.crowd;
    globalThis.__crowdReal = real;
    const log = { calls: 0, held: {} };
    globalThis.__lane = log;
    derived.crowd = (options) => {
      log.calls += 1;
      const n = log.calls;
      if (holding.includes(n)) return new Promise((resolve) => { log.held[n] = () => resolve(null); });
      if (n <= count) return Promise.resolve(null);
      return real.call(derived, options);
    };
  }, nulls, held || []);
  const calls = () => page.evaluate(() => globalThis.__lane.calls);
  const unlane = () => page.evaluate(() => { globalThis.sv2.store.derived.crowd = globalThis.__crowdReal; globalThis.__lane = null; });

  test('a null answer is asked for again, and the good one is on screen: one choice, two askings', async () => {
    await lane(1);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'crowd' }));
    await crowd(page, 'ready');
    assert.equal(await calls(), 2, 'the null was not asked for again, or was asked for more than once');
    assert.equal(await line(page), TWO_HALLS_LINE);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'usual' }));
    await settled(page);
    await unlane();
  });

  test('the count of a key\'s askings starts again when the key changes: a stale answer does not use up the next asking\'s tries', async () => {
    // asking 1 and 2 answer null (two tries used), asking 3 is held while the project changes; askings 4 to 6 answer null (three
    // tries) and asking 7 is the good one. Were the count kept across the change, the third null of the new project would fail it.
    await lane(6, [3]);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'crowd' }));
    await page.waitForFunction(() => typeof globalThis.__lane.held[3] === 'function', { timeout: 10000 });
    assert.equal(await calls(), 3);
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      store.replace(JSON.parse(JSON.stringify(store.project)));
      await store.derived.results().catch(() => null);
    });
    await page.waitForFunction(() => globalThis.__lane.calls >= 7, { timeout: 10000 });
    await crowd(page, 'ready');
    assert.equal(await calls(), 7);
    assert.equal(await line(page), TWO_HALLS_LINE);
    // the old asking's answer, let go now, is dropped: nothing changes
    await page.evaluate(() => globalThis.__lane.held[3]());
    await settled(page);
    assert.equal(await page.$eval('.mov', (el) => el.dataset.crowd), 'ready');
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'usual' }));
    await settled(page);
    await unlane();
  });

  test('the answer that never stops keeping out of date ends in the failure line, never in "Working out" for ever', async () => {
    await lane(99);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'crowd' }));
    await crowd(page, 'failed');
    assert.equal(await text(page, '[data-part="crowd-failed"]'), FAILED);
    assert.equal(await calls(), 4, 'one asking and three tries');
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'usual' }));
    await settled(page);
    await unlane();
  });

  test('a main answer that fails while Crowd-aware is on ends in the routes\' failure line, and the next good one in the lens', async () => {
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'crowd' }));
    await crowd(page, 'ready');
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      globalThis.__results = store.derived.results;
      store.derived.results = () => Promise.reject(new Error('the engine broke'));
      store.replace(JSON.parse(JSON.stringify(store.project)));
      await store.derived.results().catch(() => null);
    });
    await page.waitForFunction(() => /could not be worked out/.test(document.querySelector('#movement-line .mov-line__words').textContent), { timeout: 10000 });
    // not "Working out" with nothing left to wait for
    assert.notEqual(await page.$eval('.mov', (el) => el.dataset.crowd), 'working');
    assert.equal(await hidden(page, '[data-part="crowd-status"]'), true, 'the working band stands over a failure');
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      store.derived.results = globalThis.__results;
      store.replace(JSON.parse(JSON.stringify(store.project)));
      await store.derived.results().catch(() => null);
    });
    await settled(page);
    await crowd(page, 'ready');
    assert.equal(await line(page), TWO_HALLS_LINE);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ routes: 'usual' }));
    await settled(page);
  });

  test('a day type the project takes away while Crowd-aware shows it: the choice goes to the day type left, and the lens is asked for that one', async () => {
    // a school of two day types on the view's second, with Crowd-aware on
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      const next = JSON.parse(JSON.stringify(store.project));
      const first = next.dayTypes[0];
      const second = JSON.parse(JSON.stringify(first));
      second.id = 'dtwo00000';
      second.name = 'B Day';
      next.dayTypes.push(second);
      for (const group of next.groups) group.days[second.id] = JSON.parse(JSON.stringify(group.days[first.id]));
      store.replace(next);
      await store.derived.results().catch(() => null);
    });
    await settled(page);
    await page.evaluate(() => document.querySelector('.mov').movement.change({ dayTypeId: 'dtwo00000', routes: 'crowd' }));
    await crowd(page, 'ready');
    assert.match(await line(page), /^Crowd-aware routes on B Day: /);
    await page.evaluate(async () => {
      const { store } = globalThis.sv2;
      const next = JSON.parse(JSON.stringify(store.project));
      next.dayTypes = next.dayTypes.filter((dayType) => dayType.id !== 'dtwo00000');
      for (const group of next.groups) delete group.days.dtwo00000;
      store.replace(next);
      await store.derived.results().catch(() => null);
    });
    await settled(page);
    await crowd(page, 'ready');
    assert.match(await line(page), /^Crowd-aware routes on A Day: /, 'the view is still waiting for an answer about the day type that is gone');
    assert.equal((await choice(page)).dayTypeId, await page.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id));
    assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  });

  test('going to another section takes away every listener on a media query the view put up', async () => {
    await page.evaluate(() => { location.hash = '#schedule'; });
    await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
    await page.evaluate(() => {
      const live = new Map();
      globalThis.__mql = { live, added: 0, removed: 0 };
      const add = MediaQueryList.prototype.addEventListener;
      const remove = MediaQueryList.prototype.removeEventListener;
      MediaQueryList.prototype.addEventListener = function spiedAdd(type, listener, options) {
        if (type === 'change') {
          if (!live.has(this)) live.set(this, new Set());
          live.get(this).add(listener);
          globalThis.__mql.added += 1;
        }
        return add.call(this, type, listener, options);
      };
      MediaQueryList.prototype.removeEventListener = function spiedRemove(type, listener, options) {
        if (type === 'change' && live.has(this) && live.get(this).delete(listener)) globalThis.__mql.removed += 1;
        return remove.call(this, type, listener, options);
      };
    });
    await page.evaluate(() => { location.hash = '#movement'; });
    await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'movement');
    await settled(page);
    const during = await page.evaluate(() => ({ added: globalThis.__mql.added, removed: globalThis.__mql.removed }));
    assert.ok(during.added > 0, 'the view put up no listener: the case tests nothing');
    await page.evaluate(() => { location.hash = '#schedule'; });
    await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
    const left = await page.evaluate(() => {
      const open = [];
      for (const [list, listeners] of globalThis.__mql.live) if (listeners.size > 0) open.push(list.media + ' x' + listeners.size);
      return open;
    });
    assert.deepEqual(left, [], 'a media query is still listened to after the view went');
  });
});

// ---- the phone's link, where Routes is folded behind Change

for (const size of SIZES) {
  if (!size.phone || !wanted(size)) continue;
  for (const mode of ['touch', 'keyboard']) {
    if (!wanted(size, mode)) continue;
    describe('Try crowd-aware routes, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      before(async () => {
        session = await open(size, 'halls');
        page = session.page;
        act = hands(page, mode);
        // the device may remember the controls open from an earlier visit: they are folded for this one
        if (await page.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded') === 'true')) await act.press('[data-action="change"]');
        await page.waitForFunction(() => document.querySelector('.mov-controls').hidden);
      });
      after(async () => {
        if (session) await session.close();
      });

      test('with Routes folded away and a place with waiting, the first line ends "· Try crowd-aware routes", a link that chooses it', async () => {
        assert.equal(await page.$eval('.mov-controls', (el) => el.hidden), true, 'the controls are folded');
        assert.equal(await hidden(page, '[data-action="try-crowd"]'), false);
        assert.equal(await text(page, '.mov-line__try'), '· Try crowd-aware routes');
        const box = await page.$eval('[data-action="try-crowd"]', (el) => el.getBoundingClientRect().height);
        assert.ok(box >= 44, 'a finger’s target: ' + box);
        // the first line, the link included, is at most three lines before Change (a line is a band of the sentence's own rectangles)
        const lines = await page.evaluate(() => {
          const words = document.querySelector('#movement-line .mov-line__words');
          const centres = [];
          for (const node of words.childNodes) {
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) if (rect.width > 0) centres.push((rect.top + rect.bottom) / 2);
          }
          centres.sort((a, b) => a - b);
          let found = 0;
          let last = -Infinity;
          for (const centre of centres) {
            if (centre - last > 12) found += 1;
            last = centre;
          }
          return found;
        });
        assert.ok(lines <= 3, 'the first line is ' + lines + ' lines');
        await act.press('[data-action="try-crowd"]');
        await crowd(page, 'ready');
        assert.equal((await choice(page)).routes, 'crowd');
        assert.equal(await line(page), TWO_HALLS_LINE);
        assert.equal(await page.$('[data-action="try-crowd"]'), null, 'chosen, it is not offered again');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), 'change', 'the focus stays on the line');
      });

      test('the controls opened show Routes on Crowd-aware', async () => {
        await openControls(page, act);
        assert.equal(await checked(page, 'movement-routes'), 'crowd');
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });
    });
  }
}

// ---- the same link on a tablet: Routes is folded behind Change from 641 to 899 px too (DESIGN 17.7 item 9; SV2-153b)

describe('Try crowd-aware routes, touch at 768 (a tablet: the controls fold, Routes goes with them)', () => {
  const tablet = { name: '768', width: 768, height: 1024, phone: true };
  let session;
  let page;
  let act;
  before(async () => {
    session = await open(tablet, 'halls');
    page = session.page;
    act = hands(page, 'touch');
    // the device may remember the controls open from an earlier visit: they are folded for this one
    if (await page.$eval('[data-action="change"]', (el) => el.getAttribute('aria-expanded') === 'true')) await act.press('[data-action="change"]');
    await page.waitForFunction(() => document.querySelector('.mov-controls').hidden);
  });
  after(async () => {
    if (session) await session.close();
  });

  test('folded, with a place that has waiting, the first line ends with the link, a finger\'s size, and it chooses Crowd-aware', async () => {
    assert.equal(await page.$eval('.mov-controls', (el) => el.hidden), true, 'the controls are folded at 768 px');
    assert.equal(await hidden(page, '[data-action="try-crowd"]'), false, 'the link is not offered between 641 and 899 px');
    assert.equal(await text(page, '.mov-line__try'), '· Try crowd-aware routes');
    assert.ok((await page.$eval('[data-action="try-crowd"]', (el) => el.getBoundingClientRect().height)) >= 44, 'a finger\'s target');
    // the first line stays a sentence and its offer: at most two lines before Change
    const lines = await page.evaluate(() => {
      const words = document.querySelector('#movement-line .mov-line__words');
      const centres = [];
      for (const node of words.childNodes) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) centres.push((rect.top + rect.bottom) / 2);
      }
      centres.sort((a, b) => a - b);
      let found = 0;
      let last = -Infinity;
      for (const centre of centres) {
        if (centre - last > 12) found += 1;
        last = centre;
      }
      return found;
    });
    assert.ok(lines <= 2, 'the first line is ' + lines + ' lines');
    await act.press('[data-action="try-crowd"]');
    await crowd(page, 'ready');
    assert.equal((await choice(page)).routes, 'crowd');
    assert.equal(await line(page), TWO_HALLS_LINE);
    assert.equal(await page.$('[data-action="try-crowd"]'), null, 'chosen, it is not offered again');
    assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  });
});

// ---- the sample school: no group finds a quicker way round

for (const size of SIZES) {
  for (const mode of ['pointer', 'keyboard', 'touch']) {
    if (!wanted(size, mode)) continue;
    describe('crowd-aware routes on the sample, ' + mode + ' at ' + size.name, () => {
      let session;
      let page;
      let act;
      before(async () => {
        session = await open(size, 'sample');
        page = session.page;
        act = hands(page, mode);
        await openControls(page, act);
      });
      after(async () => {
        if (session) await session.close();
      });

      test('no group moves: the sentence says so and the usual routes already use the building well', async () => {
        await act.radio('movement-routes', 'crowd');
        await crowd(page, 'ready');
        assert.equal(await line(page), SAMPLE_LINE);
        const seen = await page.evaluate(() => {
          const shown = document.querySelector('.mov').movement.picture;
          return { mode: shown.routesMode, moved: shown.changed.length, same: shown.compare.usual.waiting === shown.compare.aware.waiting };
        });
        assert.deepEqual(seen, { mode: 'crowd', moved: 0, same: true });
        assert.equal(await text(page, '[data-part="crowd-note"]'), NOTE);
      });

      test('Summary marks no group, and Travel time has its Usual column all the same', async () => {
        await tab(page, act, 'summary');
        assert.equal(await page.$$eval('#inspector [data-summary="groups"] tr[data-another]', (els) => els.length), 0);
        assert.equal(await page.$$eval('#inspector [data-action="show-usual"]', (els) => els.length), 0);
        await tab(page, act, 'tables');
        const heads = await page.$$eval('#inspector [data-travel="day"] thead th', (els) => els.map((el) => el.textContent));
        assert.ok(heads.includes('Usual'), heads.join(', '));
        assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
      });

      test('back to Usual: the first line, the legend and Travel time are the usual ones again', async () => {
        await openControls(page, act);
        await act.radio('movement-routes', 'usual');
        assert.match(await line(page), /^Showing 8 groups on A Day, all transitions\./);
        assert.equal(await hidden(page, '[data-legend="routes"]'), true);
        const heads = await page.$$eval('#inspector [data-travel="day"] thead th', (els) => els.map((el) => el.textContent));
        assert.ok(!heads.includes('Usual'));
      });
    });
  }
}
