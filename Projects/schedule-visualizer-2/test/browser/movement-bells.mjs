// Movement and the scenario lab with a bell schedule, in a real browser:
// node test/browser/movement-bells.mjs
//
// DESIGN 11.7 on the sample school with an Early Release bell schedule
// (half-hour periods, periods 5 to 8 not meeting) and a C Day that is the
// same as A Day. With none, Movement has no Bells choice and the strip is
// what it was. With one: the Bells choice, the first line that names both
// choices, the strip that leaves out every transition touching a period that
// does not meet and says so, the day type that follows another named as
// "C Day (same as A Day)" with that day's results, the Travel time tab and
// its print by run, the playback bar stepping only the transitions that
// happen, and the scenario lab's comparison with its own Bells choice. By
// pointer and by keyboard. Every wait is on a state the page sets (the
// section's `data-pending` gone and its state the store's project), never on
// a first paint or a fixed sleep. Screenshots, when SV2_SHOTS names a
// folder: Movement with Early Release chosen at 1280 by 800 and 390 by 844,
// light and dark.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, launch, startServer, loadModule } from './harness.mjs';

const DAY_A = 'dsample00a';
const ER = 'bsample0er';

let server;
let browser;
let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const visible = (selector) => page.$eval(selector, (el) => !el.hidden && el.getClientRects().length > 0);
const line = () => text('#movement-line .mov-line__words');
const stripItems = () => page.$$eval('.mov-strip__item', (items) => items.map((item) => item.dataset.transition + ':' + item.getAttribute('aria-checked')));
const stripNames = () => page.$$eval('.mov-strip__item', (items) => items.map((item) => item.getAttribute('title')));

// The view has the answer for the project as it is now, and has drawn it.
async function settled() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 30000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function change(patch) {
  await page.evaluate((next) => document.querySelector('.mov').movement.change(next), patch);
  await settled();
}

// Everything as the view opens it, whatever the case before left chosen.
const OPEN = { who: 'all', groupIds: [], dayTypeId: DAY_A, bellsId: null, transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };

// Open the folded controls, as a person pressing Change does.
async function controlsOpen() {
  const folded = await page.$eval('.mov-top', (el) => el.dataset.folded === 'true');
  if (folded) await page.click('[data-action="change"]');
  await page.waitForFunction(() => document.querySelector('.mov-top').dataset.folded === 'false');
}

// Early Release and a C Day that is the same as A Day, put in by the store.
async function addBells() {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((id) => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.addBellSchedule, { id, name: 'Early Release', short: '', fromDayTypeId: store.project.dayTypes[0].id });
    store.apply(actions.setBellSchedule, { bellScheduleId: id, off: [4, 5, 6, 7] });
    const at = (minutes) => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    for (let period = 0; period < 4; period += 1) store.apply(actions.setBellSchedule, { bellScheduleId: id, period, bell: { start: at(480 + 33 * period), end: at(510 + 33 * period) } });
  }, ER);
  await settled();
}

before(async () => {
  server = await startServer();
  browser = await launch();
  session = await openPlanner({ browser, server, hash: '#movement', theme: 'light', width: 1280, height: 800 });
  page = session.page;
  await settled();
});

after(async () => {
  if (session) await session.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

test('with no bell schedule Movement has no Bells choice, all seven transitions, and its first line as it was', async () => {
  await controlsOpen();
  assert.equal(await visible('[data-control="bells-box"]'), false, 'no Bells choice');
  assert.equal((await stripItems()).length, 8, 'All and seven transitions');
  assert.equal(await visible('.mov-strip__note'), false, 'nothing to say about periods that do not meet');
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
});

test('adding a bell schedule shows the Bells choice, Regular first, and changes nothing drawn until it is chosen', async () => {
  const before = await line();
  await addBells();
  await controlsOpen();
  assert.equal(await visible('[data-control="bells-box"]'), true);
  assert.deepEqual(await page.$$eval('[data-control="bells"] option', (all) => all.map((each) => each.textContent)), ['Regular', 'Early Release']);
  assert.equal(await page.$eval('[data-control="bells"]', (el) => el.value), '', 'Regular is chosen');
  assert.equal(await line(), before, 'the regular picture is as it was');
  assert.equal((await stripItems()).length, 8);
});

test('choosing Early Release by pointer: the first line names both, the strip leaves out the periods that do not meet and says so', async () => {
  await page.select('[data-control="bells"]', ER);
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day with Early Release bells, all transitions. No route failed.');
  assert.deepEqual(await stripItems(), ['all:true', '0:false', '1:false', '2:false'], 'the three transitions between periods that meet');
  assert.equal(await text('.mov-strip__note'), 'Periods 5 to 8 do not meet');
  assert.equal(await visible('.mov-strip__note'), true);
  assert.ok((await stripNames()).every((name) => !/Period [5-8]/.test(name.replace(/Period \d to Period \d/, (m) => m.replace(/Period [1-4]/g, '')))), 'no name of a transition into period 5 or later');
  // one transition by pointer: its clock range is the schedule's
  await page.click('.mov-strip__item[data-transition="1"]');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day with Early Release bells, Period 2 to Period 3 (9:03 to 9:06). No route failed.');
  await page.click('.mov-strip__item[data-transition="all"]');
  await settled();
});

test('the strip is one Tab stop and the arrow keys, Home and End stay among the transitions that happen', async () => {
  await page.focus('.mov-strip__item[aria-checked="true"]');
  await page.keyboard.press('End');
  await settled();
  assert.deepEqual(await stripItems(), ['all:false', '0:false', '1:false', '2:true'], 'End is the last transition that happens, not period 7 into 8');
  await page.keyboard.press('ArrowRight');
  await settled();
  assert.equal((await stripItems())[0], 'all:true', 'ArrowRight wraps to All');
  await page.keyboard.press('ArrowLeft');
  await settled();
  assert.equal((await stripItems())[3], '2:true');
  await page.keyboard.press('Home');
  await settled();
  assert.equal((await stripItems())[0], 'all:true');
});

test('the Bells choice by keyboard: the arrow keys on the focused choice change the picture, and Regular puts it back', async () => {
  await page.focus('[data-control="bells"]');
  await page.keyboard.press('ArrowUp');
  await settled();
  assert.equal(await line(), 'Showing 8 groups on A Day, all transitions. No route failed.');
  assert.equal(await visible('.mov-strip__note'), false, 'every period meets again');
  assert.equal((await stripItems()).length, 8);
  await page.keyboard.press('ArrowDown');
  await settled();
  assert.equal(await text('.mov-line__words'), 'Showing 8 groups on A Day with Early Release bells, all transitions. No route failed.');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.control), 'bells', 'the choice keeps the focus while the picture changes');
});

test('the picture under Early Release is its own: fewer walks drawn, its load, its figures', async () => {
  const figures = await page.evaluate(() => {
    const picture = document.querySelector('.mov').movement.picture;
    return { drawn: picture.drawn + picture.same, bellsId: picture.bellsId, max: picture.load.max, source: picture.load.source.bellsId, transitions: picture.transitions.map((each) => each.period) };
  });
  assert.deepEqual(figures, { drawn: 24, bellsId: ER, max: figures.max, source: ER, transitions: [0, 1, 2] });
  assert.ok(figures.max > 0);
  // the legend's walks: three a group
  const walks = await page.evaluate(() => document.querySelector('.mov').movement.state.picture.groups.length);
  assert.equal(walks, 8);
});

test('Travel time under Early Release is that run\'s tables, headed with the bells, with three transitions to pick from', async () => {
  const opened = await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((each) => /Travel time/.test(each.textContent));
    if (tab) tab.click();
    return Boolean(tab);
  });
  assert.ok(opened, 'the Travel time tab');
  await page.waitForSelector('[data-panel="tables"] [data-travel="lead"]');
  await settled();
  assert.match(await text('[data-travel="lead"]'), /A Day with Early Release bells/);
  assert.deepEqual(await page.$$eval('[data-travel="pick"] option', (all) => all.map((each) => each.textContent.replace(/ \(.*\)$/, ''))), ['Period 1 to Period 2', 'Period 2 to Period 3', 'Period 3 to Period 4']);
  assert.match(await text('[data-travel="day-title"]'), /The whole day/);
  assert.equal(await page.$$eval('[data-travel="day"] tbody', (all) => all.length), 8, 'every group');
});

test('a day type that is the same as another is named "C Day (same as A Day)" and shows that day\'s results under Early Release', async () => {
  await page.evaluate((a) => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.addDayType, { name: 'C Day', own: false, sameAs: a });
  }, DAY_A);
  await settled();
  await controlsOpen();
  const names = await page.$$eval('[data-control="day"] option', (all) => all.map((each) => each.textContent));
  assert.deepEqual(names, ['A Day', 'B Day', 'C Day (same as A Day)']);
  const asA = await page.evaluate(() => document.querySelector('.mov').movement.picture.load.max);
  const dayC = await page.$$eval('[data-control="day"] option', (all) => all.find((each) => /^C Day/.test(each.textContent)).value);
  await page.select('[data-control="day"]', dayC);
  await settled();
  assert.equal(await line(), 'Showing 8 groups on C Day with Early Release bells, all transitions. No route failed.', 'its own name');
  assert.equal(await page.evaluate(() => document.querySelector('.mov').movement.picture.load.max), asA, 'A Day\'s results');
  assert.deepEqual((await stripItems()).length, 4);
  await page.select('[data-control="day"]', DAY_A);
  await settled();
});

test('the playback bar steps only the transitions that happen', async () => {
  await change({ ...OPEN, bellsId: ER });
  const reach = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.mov-bar button'));
    return buttons.map((each) => each.getAttribute('aria-label') || each.textContent);
  });
  assert.ok(reach.some((label) => /Next/.test(label)) && reach.some((label) => /Previous/.test(label)), 'previous and next: ' + reach.join(' | '));
  const press = async (word) => {
    await page.evaluate((w) => Array.from(document.querySelectorAll('.mov-bar button')).find((each) => new RegExp(w).test(each.getAttribute('aria-label') || each.textContent)).click(), word);
    await settled();
  };
  const at = () => page.evaluate(() => document.querySelector('.mov').movement.choice.transition);
  const enabled = (word) => page.evaluate((w) => Array.from(document.querySelectorAll('.mov-bar button')).find((each) => new RegExp(w).test(each.getAttribute('aria-label') || each.textContent)).getAttribute('aria-disabled') !== 'true', word);
  assert.equal(await enabled('Previous'), false, 'nothing before All');
  await press('Next');
  assert.equal(await at(), 0);
  await press('Next');
  await press('Next');
  assert.equal(await at(), 2);
  assert.equal(await enabled('Next'), false, 'period 4 into 5 does not happen, so there is no next');
  assert.equal(await enabled('Previous'), true);
  await press('Previous');
  assert.equal(await at(), 1);
  await change({ ...OPEN, bellsId: ER });
});

// The sheet on show, as a reader sees it: its headings and its text.
async function sheet() {
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 30000 });
  return page.evaluate(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    return { headings: Array.from(doc.querySelectorAll('h2')).map((each) => each.textContent), text: doc.body.textContent.replace(/\s+/g, ' ') };
  });
}

async function closeSheet() {
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
}

test('the two prints take the same choices: the congestion report and the travel times are of Early Release', async () => {
  await change({ ...OPEN, bellsId: ER });
  await page.click('#inspector [role="tab"][data-tab="export"]');
  await page.waitForSelector('#inspector [data-panel="export"] [data-action="print-congestion"]');
  await page.click('#inspector [data-action="print-congestion"]');
  const report = await sheet();
  assert.ok(report.headings.includes('A Day with Early Release bells') && report.headings.includes('B Day with Early Release bells'), report.headings.join(' | '));
  assert.ok(!report.text.includes('Period 5 to Period 6'), 'no transition that does not happen');
  await closeSheet();
  await page.click('#inspector [role="tab"]:not([aria-selected="true"])[data-tab="tables"]');
  await page.waitForSelector('#inspector [data-panel="tables"] [data-action="print-travel-time"]');
  await page.click('#inspector [data-action="print-travel-time"]');
  const travel = await sheet();
  assert.deepEqual(travel.headings.filter((each) => /^Period/.test(each)), ['Period 1 to Period 2', 'Period 2 to Period 3', 'Period 3 to Period 4']);
  assert.ok(travel.text.includes('A Day with Early Release bells'));
  await closeSheet();
  await change({ ...OPEN });
  await page.click('#inspector [role="tab"]:not([aria-selected="true"])[data-tab="export"]');
  await page.click('#inspector [data-action="print-congestion"]');
  const plain = await sheet();
  assert.ok(plain.headings.includes('A Day') && !plain.text.includes('Early Release'), 'regular bells: the report as it was');
  await closeSheet();
  await change({ ...OPEN, bellsId: ER });
});

test('hostile names stay text: a bell schedule named with markup is a choice, a caption and a heading as typed', async () => {
  const hostile = '<img src=x onerror="window.__bellhit=1">';
  await page.evaluate((name, id) => {
    const { store } = globalThis.sv2;
    const { actions } = globalThis.sv2modules;
    store.apply(actions.setBellSchedule, { bellScheduleId: id, name });
  }, hostile, ER);
  await settled();
  assert.equal(await page.$eval('[data-control="bells"] option:nth-child(2)', (el) => el.textContent), hostile);
  assert.equal(await line(), 'Showing 8 groups on A Day with ' + hostile + ' bells, all transitions. No route failed.');
  assert.equal(await page.evaluate(() => window.__bellhit), undefined, 'nothing ran');
  assert.equal(await page.$('#movement-line img'), null);
  await page.evaluate((id) => {
    globalThis.sv2.store.apply(globalThis.sv2modules.actions.setBellSchedule, { bellScheduleId: id, name: 'Early Release' });
  }, ER);
  await settled();
});

test('the scenario lab\'s comparison has its own Bells choice, and its Places list offers only the transitions that happen', async () => {
  await go(page, '#scenarios');
  await page.evaluate(async () => {
    const { newScenario, addScenarioChange } = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    store.apply(newScenario, { name: 'Bells' });
    store.apply(addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' } });
  });
  const ready = () => page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    return Boolean(el) && el.dataset.styled === 'true' && Boolean(el.scenarios) && el.scenarios.plan.project === globalThis.sv2.store.project && el.dataset.compare === 'ready' && !el.scenarios.pending;
  }, { timeout: 30000 });
  await ready();
  assert.equal(await page.$eval('#scenario-compare-bells', (el) => el.closest('.field').hidden), false, 'the Bells choice is there');
  assert.deepEqual(await page.$$eval('#scenario-compare-bells option', (all) => all.map((each) => each.textContent)), ['Regular', 'Early Release']);
  assert.equal((await page.$$eval('#scenario-compare-when option', (all) => all.length)), 8, 'the whole day and seven transitions');
  await page.select('#scenario-compare-bells', ER);
  await ready();
  assert.deepEqual(await page.$$eval('#scenario-compare-when option', (all) => all.map((each) => each.textContent)), ['The whole day', 'Period 1 to Period 2', 'Period 2 to Period 3', 'Period 3 to Period 4']);
  // the answer is the bell run's: asked with the schedule, and the difference map reads its loads
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.compare.bellsId), ER, 'the comparison is of Early Release');
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.memory.bellsId), ER);
  assert.notEqual(await page.evaluate(() => document.querySelector('.scn').difference.difference === null), true, 'the difference map is made from the bell run\'s loads');
  await page.select('#scenario-compare-when', '2');
  await ready();
  // back to Regular: the transitions are all seven again
  await page.select('#scenario-compare-bells', '');
  await ready();
  assert.equal((await page.$$eval('#scenario-compare-when option', (all) => all.length)), 8);
  await page.evaluate(async () => {
    const { discardScenario } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(discardScenario, {});
  });
});
