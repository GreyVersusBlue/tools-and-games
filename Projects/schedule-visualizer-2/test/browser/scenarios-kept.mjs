// Other scenarios and Compare with, in a real browser (spec 9.3; DESIGN 15.6
// and 15.9 items 7, 8, 10, 11): node test/browser/scenarios-kept.mjs
//
// The Other scenarios strip (a row for each kept scenario, its count and its
// two messages, "already in the schedule" and "no longer applies", and four
// visible buttons: Switch to, Duplicate, Rename…, Delete…); Keep and start
// another and Duplicate in the panel; the limit of twelve said and not silent;
// Switch to as one step of undo with the focus on the open scenario's name;
// Rename… (a refusal said in the dialog, Escape changing nothing); Delete…
// asking first, with the focus on the next row, else the previous, else the
// open scenario's name; Compare with (the real schedule and each kept one: 400
// ms to settle, "Working…" in the Before column, the status sentence, the
// Before heading, the difference map's legend naming the other side; the
// choice kept when another is switched to and reset when the compared one is
// switched to or deleted); Apply's added line; typed names as typed. By
// pointer, by keyboard alone, and with touch at 390 by 844 and 844 by 390.
//
// Every wait is for a state the page sets (data-compare, data-settling,
// data-difference, the dialog open), never a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, go, launch, startServer, TOOL_DIR } from './harness.mjs';

const { plainSchool } = await import(pathToFileURL(path.join(TOOL_DIR, 'test', 'engine', 'helpers.mjs')).href);

const HOSTILE = '<img src=x onerror="window.__hit=1">&amp; "Plan"';
const LONG = 'A very long scenario name that goes on past forty characters';
const DAY_A = 'dsample00a';

let browser;
let server;
let wide;

before(async () => {
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ browser, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

const move = (groupId, period, roomId) => ({ kind: 'move', dayTypeId: DAY_A, groupId, period, roomId });

// The sample school with an open scenario and four kept ones. "Library
// lessons" has three changes: one that applies, one the schedule already has
// (6A is in 201 in period 1 already) and one whose room is gone.
function fixture(extra) {
  const project = JSON.parse(JSON.stringify(plainSchool()));
  project.scenario = { id: 'eopen00001', name: 'Move 6A to 301', changes: [move('gsample06a', 1, 'rsample301')], compared: null };
  project.scenarios = [
    { id: 'ekeptlib00', name: 'Library lessons', changes: [move('gsample06b', 0, 'rsamplelib'), move('gsample06a', 0, 'rsample201'), move('gsample06c', 1, 'rnowhere00')], compared: null },
    { id: 'ekepthost0', name: HOSTILE, changes: [move('gsample06c', 0, 'rsample102')], compared: null },
    { id: 'ekeptlong0', name: LONG, changes: [move('gsample06b', 1, 'rsample103')], compared: null },
  ];
  if (extra) extra(project);
  return project;
}

// A project in the store, the lab drawn for it and its comparison settled:
// answered for the store as it is (and for the kept scenario chosen, if one),
// the difference map's picture taken, nothing settling.
async function ready(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (document.querySelector('.scn-compare')?.dataset.settling) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending && el.dataset.difference === 'shown';
  }, { timeout: 30000 });
}

async function load(page, project) {
  await page.evaluate(() => {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  });
  await page.mouse.move(1, 1);
  const close = await page.$('.toast .toast__close');
  if (close) {
    await close.click();
    await page.waitForFunction(() => !document.querySelector('.toast'));
  }
  await page.evaluate((next) => {
    delete window.__hit;
    globalThis.sv2.store.replace(next);
  }, project);
  await go(page, '#scenarios');
  await ready(page);
}

const projectOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const steps = (page) => page.evaluate(() => globalThis.sv2.store.history.past.length);
const announced = (page) => page.$eval('#announcer', (el) => el.textContent);
const names = (project) => [project.scenario ? project.scenario.name : null, project.scenarios.map((each) => each.name)];

// the strip as it is on screen: each row's line, messages and buttons
const rowsOf = (page) => page.$$eval('.scn-other', (items) => items.map((item) => ({
  id: item.dataset.scenario,
  line: item.querySelector('.scn-other__line').textContent,
  messages: Array.from(item.querySelectorAll('.scn-other__message')).map((each) => each.textContent),
  buttons: Array.from(item.querySelectorAll('button')).map((button) => button.textContent),
  described: Array.from(item.querySelectorAll('button')).map((button) => (button.getAttribute('aria-describedby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '')[0]),
})));

const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  return { id: el.id, text: el.textContent.slice(0, 60), action: el.dataset ? el.dataset.action || '' : '', row: el.closest('.scn-other') ? el.closest('.scn-other').dataset.scenario : '' };
});

const rowButton = (id, action) => '.scn-other[data-scenario="' + id + '"] [data-action="other-' + action + '"]';

// the select's choice, as a person makes it: the select changes, and the page
// settles for 400 ms, then asks; wait for the page's own state
async function chooseCompare(page, value) {
  await page.select('#scenario-compare-with', value);
  await page.waitForFunction(() => document.querySelector('.scn-compare')?.dataset.settling === 'true' || document.querySelector('.scn').dataset.compare !== 'ready', { timeout: 10000 }).catch(() => {});
  await ready(page);
  await page.waitForFunction((wanted) => document.querySelector('.scn').dataset.compareWith === wanted, { timeout: 10000 }, value);
  await ready(page);
}

// ---------------------------------------------------------------- pointer, wide

test('with nothing kept: no strip, no Compare with, Start a scenario as it was', async () => {
  const page = wide.page;
  await load(page, JSON.parse(JSON.stringify(plainSchool())));
  assert.equal(await page.$eval('.scn-others', (el) => el.hidden), true, 'no strip with no kept scenario');
  assert.equal(await page.$eval('.scn-compare__with', (el) => el.hidden), true, 'no Compare with with none kept');
  assert.equal(await page.$eval('.scn-start', (el) => el.hidden), false, 'Start a scenario stays');
  assert.equal(await page.$eval('#scenario-start-name', (el) => el.getClientRects().length > 0), true);
});

test('the strip: a row for each kept scenario with its count, its two messages and four named buttons', async () => {
  const page = wide.page;
  await load(page, fixture());
  assert.equal(await page.$eval('#scenario-others-title', (el) => el.textContent), 'Other scenarios');
  const rows = await rowsOf(page);
  assert.deepEqual(rows.map((row) => row.line), ['Library lessons · 3 changes', HOSTILE + ' · 1 change', LONG + ' · 1 change']);
  assert.deepEqual(rows[0].messages, ['1 change is already in the schedule', '1 change no longer applies'], 'two distinct messages, each only when true');
  assert.deepEqual(rows[1].messages, []);
  for (const row of rows) {
    assert.deepEqual(row.buttons, ['Switch to', 'Duplicate', 'Rename…', 'Delete…'], 'visible buttons, no menu');
    assert.ok(row.described.every((text) => text === row.line), 'each button is described by its row\'s line: ' + JSON.stringify(row.described));
  }
  assert.equal(await page.$('.scn-others [aria-haspopup]'), null, 'no ⋯ menu anywhere');
  assert.equal(await page.$eval('.scn-others__list', (el) => el.tagName + ':' + Array.from(el.children).every((child) => child.tagName === 'LI')), 'UL:true', 'each row a list item');
  // typed names are text: no element came of the hostile one, and nothing ran
  assert.equal(await page.$('.scn-others img'), null);
  assert.equal(await page.evaluate(() => window.__hit), undefined);
  // the kept scenarios' own changes never touch the open one's chips
  assert.equal(await page.$$eval('.scn-chip', (items) => items.length), 1);
  assert.equal(await page.$eval('#scenario-open-title', (el) => el.textContent), 'Move 6A to 301, the open scenario');
});

test('Keep and start another and Duplicate in the panel, each one step of undo', async () => {
  const page = wide.page;
  await load(page, JSON.parse(JSON.stringify(plainSchool())));
  await page.click('#scenario-start-name');
  await page.keyboard.type('Round one');
  await page.click('[data-action="start"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
  await ready(page);
  assert.equal(await page.$eval('.scn-others', (el) => el.hidden), true, 'one scenario open, none kept: no strip');
  // not on the sticky bar, which keeps its three words
  assert.deepEqual(await page.$$eval('.scn-bar button', (items) => items.map((item) => item.textContent)), ['Apply…', 'Discard…']);
  const before = await steps(page);
  await page.click('[data-action="keep-start"]');
  await page.waitForFunction(() => document.querySelector('.scn-others') && !document.querySelector('.scn-others').hidden);
  await ready(page);
  assert.equal(await steps(page), before + 1, 'one step');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Start scenario New scenario');
  assert.deepEqual(names(await projectOf(page)), ['New scenario', ['Round one']]);
  assert.deepEqual((await rowsOf(page)).map((row) => row.line), ['Round one · no changes']);
  const field = await page.evaluate(() => {
    const el = document.activeElement;
    return { id: el.id, from: el.selectionStart, to: el.selectionEnd, length: el.value.length };
  });
  assert.deepEqual(field, { id: 'scenario-name', from: 0, to: 'New scenario'.length, length: 'New scenario'.length }, 'the new scenario\'s name field is focused and selected');
  assert.match(await announced(page), /^Kept Round one\. Started New scenario\./);
  // Duplicate: the copy is kept right after, the open one stays open
  await page.click('[data-action="duplicate"]');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 2);
  await ready(page);
  assert.equal(await steps(page), before + 2);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Duplicate scenario New scenario');
  assert.deepEqual(names(await projectOf(page)), ['New scenario', ['New scenario (copy)', 'Round one']]);
  assert.equal((await focused(page)).action, 'duplicate', 'the focus stays on Duplicate');
  assert.match(await announced(page), /^Duplicated New scenario as New scenario \(copy\)\./);
  // Undo takes the copy back, then Redo brings it
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 1);
  assert.deepEqual(names(await projectOf(page)), ['New scenario', ['Round one']]);
});

test('the limit of twelve: Keep and start another, Duplicate and a row\'s Duplicate say why, stay focusable and change nothing', async () => {
  const page = wide.page;
  await load(page, fixture((project) => {
    for (let i = 0; i < 8; i += 1) project.scenarios.push({ id: 'ekeptfill' + i, name: 'Filler ' + i, changes: [], compared: null });
  }));
  assert.equal((await projectOf(page)).scenarios.length, 11, 'eleven kept and one open: the most');
  const reason = 'This project keeps 12 scenarios, the most it can. Delete one first.';
  assert.equal(await page.$eval('#scenario-open-full', (el) => el.textContent), reason);
  const states = await page.$$eval('[data-action="keep-start"], [data-action="duplicate"], [data-action="other-duplicate"]', (items) => items.map((item) => [item.getAttribute('aria-disabled'), item.disabled, document.getElementById((item.getAttribute('aria-describedby') || '').split(' ').pop())?.textContent]));
  assert.ok(states.length >= 3);
  for (const [disabled, native, why] of states) {
    assert.equal(disabled, 'true');
    assert.equal(native, false, 'aria-disabled, never the disabled attribute: it stays focusable');
    assert.equal(why, reason, 'described by its reason');
  }
  const before = await steps(page);
  for (const selector of ['[data-action="keep-start"]', '[data-action="duplicate"]', '[data-action="other-duplicate"]']) {
    await page.focus(selector);
    assert.equal((await focused(page)).action, selector.match(/data-action="([^"]+)"/)[1]);
    await page.keyboard.press('Enter');
    assert.match(await announced(page), /the most it can/);
  }
  assert.equal(await steps(page), before, 'nothing was made');
  assert.equal((await projectOf(page)).scenarios.length, 11);
  // Delete one and they come back
  await page.click(rowButton('ekeptfill7', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 10);
  assert.equal(await page.$eval('[data-action="keep-start"]', (el) => el.getAttribute('aria-disabled')), null);
});

test('Switch to: one step of undo, the open scenario takes its place, the focus on the open scenario\'s name', async () => {
  const page = wide.page;
  await load(page, fixture());
  const before = await steps(page);
  await page.click(rowButton('ekeptlib00', 'switch'));
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario?.id === 'ekeptlib00');
  await ready(page);
  assert.equal(await steps(page), before + 1, 'one step');
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Open scenario Library lessons');
  const project = await projectOf(page);
  assert.deepEqual(names(project), ['Library lessons', ['Move 6A to 301', HOSTILE, LONG]], 'the open one took the kept one\'s place in the list');
  assert.deepEqual(await focused(page), { id: 'scenario-open-title', text: 'Library lessons, the open scenario', action: '', row: '' });
  assert.equal(await announced(page), 'Switched to Library lessons. Move 6A to 301 is kept.');
  assert.equal(await page.$eval('#scenario-name', (el) => el.value), 'Library lessons');
  // the open scenario's own list: its three changes, one of them no longer applying
  assert.equal(await page.$$eval('.scn-chip', (items) => items.length), 1);
  assert.equal(await page.$$eval('.scn-dropped__item', (items) => items.length), 2, 'the open scenario lists what no longer applies, as it did');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  assert.deepEqual(names(await projectOf(page)), ['Move 6A to 301', ['Library lessons', HOSTILE, LONG]]);
});

test('Switch to with no scenario open: the kept one opens and nothing is kept in its place', async () => {
  const page = wide.page;
  await load(page, fixture((project) => {
    project.scenario = null;
  }));
  assert.equal(await page.$eval('.scn-others', (el) => el.hidden), false, 'kept scenarios show with none open');
  assert.equal(await page.$eval('.scn-start', (el) => el.hidden), false, 'and so does Start a scenario');
  await page.click(rowButton('ekepthost0', 'switch'));
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario?.id === 'ekepthost0');
  await ready(page);
  assert.deepEqual(names(await projectOf(page)), [HOSTILE, ['Library lessons', LONG]]);
  assert.equal(await announced(page), 'Switched to ' + HOSTILE + '.');
});

test('Rename…: a dialog with the name selected; a taken name is said in it; Escape changes nothing', async () => {
  const page = wide.page;
  await load(page, fixture());
  const before = await steps(page);
  await page.click(rowButton('ekeptlib00', 'rename'));
  await page.waitForSelector('#scenario-rename[open]');
  const field = await page.evaluate(() => {
    const el = document.getElementById('scenario-rename-input');
    return { value: el.value, focused: document.activeElement === el, from: el.selectionStart, to: el.selectionEnd };
  });
  assert.deepEqual(field, { value: 'Library lessons', focused: true, from: 0, to: 'Library lessons'.length });
  // Escape changes nothing and gives the focus back to the button
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#scenario-rename[open]'));
  assert.equal(await steps(page), before);
  assert.deepEqual((await focused(page)).action, 'other-rename');
  // a name another scenario holds, in other letters: refused in the dialog, which stays
  await page.click(rowButton('ekeptlib00', 'rename'));
  await page.waitForSelector('#scenario-rename[open]');
  await page.keyboard.type('  move 6a to 301 ');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#scenario-rename[open] [data-part="rename-problem"]:not([hidden])'));
  assert.equal(await page.$eval('#scenario-rename [data-part="rename-problem"]', (el) => el.textContent), 'Another scenario is called   move 6a to 301 .', 'the refusal names the name as typed');
  assert.equal(await page.$eval('#scenario-rename-input', (el) => el.value), '  move 6a to 301 ', 'what was typed is still there to mend');
  assert.equal(await steps(page), before, 'a refusal changes nothing');
  // a free name, with markup in it, is kept as typed
  await page.click('#scenario-rename-input', { clickCount: 3 });
  await page.keyboard.type('Library <i>plan</i> & "more"');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#scenario-rename[open]'));
  await ready(page);
  assert.equal(await steps(page), before + 1);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Rename scenario Library lessons to Library <i>plan</i> & "more"');
  assert.deepEqual((await projectOf(page)).scenarios.map((each) => each.name), ['Library <i>plan</i> & "more"', HOSTILE, LONG]);
  assert.equal((await rowsOf(page))[0].line, 'Library <i>plan</i> & "more" · 3 changes');
  assert.equal(await page.$('.scn-others i'), null, 'markup typed is text');
  assert.deepEqual((await focused(page)).action, 'other-rename', 'the focus is back on the button that opened the dialog');
});

test('Delete… asks first; the focus goes to the next row, else the previous, else the open scenario\'s name', async () => {
  const page = wide.page;
  await load(page, fixture());
  const before = await steps(page);
  // asks first: the safe button is the one focused, and Escape keeps it
  await page.click(rowButton('ekepthost0', 'delete'));
  await page.waitForSelector('dialog[open]');
  assert.equal(await page.$eval('dialog[open] h2', (el) => el.textContent), 'Delete the scenario “' + HOSTILE + '”?');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep the scenario');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await steps(page), before);
  assert.equal((await focused(page)).action, 'other-delete');
  // the middle row: the focus goes to the next row's first button
  await page.click(rowButton('ekepthost0', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 2);
  assert.equal(await steps(page), before + 1);
  assert.equal(await page.evaluate(() => globalThis.sv2.store.undoLabel), 'Delete scenario ' + HOSTILE);
  assert.deepEqual(await focused(page), { id: '', text: 'Switch to', action: 'other-switch', row: 'ekeptlong0' });
  // the last row: the previous row's first button
  await page.click(rowButton('ekeptlong0', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 1);
  assert.deepEqual(await focused(page), { id: '', text: 'Switch to', action: 'other-switch', row: 'ekeptlib00' });
  // the only row: the strip goes and the focus is the open scenario's name
  await page.click(rowButton('ekeptlib00', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelector('.scn-others').hidden);
  assert.equal((await focused(page)).id, 'scenario-name');
  // one Undo brings the last back, with its changes
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 1);
  assert.deepEqual((await projectOf(page)).scenarios.map((each) => each.changes.length), [3]);
});

test('Delete… on a scenario kept while another is open leaves the open one and the real schedule as they were', async () => {
  const page = wide.page;
  const project = fixture();
  await load(page, project);
  const was = await projectOf(page);
  await page.click(rowButton('ekeptlong0', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 2);
  const now = await projectOf(page);
  assert.deepEqual(now.groups, was.groups, 'the real schedule is untouched');
  assert.deepEqual(now.scenario, was.scenario, 'the open scenario is untouched');
});

// ---------------------------------------------------------------- Compare with

test('Compare with: the real schedule and each kept scenario, long names cut at 40 characters with the whole in the title', async () => {
  const page = wide.page;
  await load(page, fixture());
  const options = await page.$$eval('#scenario-compare-with option', (items) => items.map((item) => ({ value: item.value, text: item.textContent, title: item.title })));
  assert.deepEqual(options.map((each) => each.value), ['', 'ekeptlib00', 'ekepthost0', 'ekeptlong0']);
  assert.deepEqual(options.map((each) => each.text).slice(0, 3), ['The real schedule', 'Library lessons', Array.from(HOSTILE).slice(0, 39).join('') + '…']);
  assert.equal(options[2].title, HOSTILE);
  const long = options[3];
  assert.equal(Array.from(long.text).length, 40);
  assert.equal(long.text, LONG.slice(0, 39) + '…');
  assert.equal(long.title, LONG, 'the whole name is in the title');
  assert.equal(await page.$eval('#scenario-compare-with', (el) => el.value), '', 'the real schedule is the default');
  // by default the Before column is headed Before, and the legend says busier and quieter
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Before');
  assert.match(await page.$eval('[data-part="difference-key"]', (el) => el.textContent), /^On the map: busier, quieter\./);
});

test('Compare with a kept scenario: 400 ms to settle, Working… in the Before column, then its name, the status sentence and the legend', async () => {
  const page = wide.page;
  await load(page, fixture());
  const asked = await page.evaluate(() => globalThis.sv2.store.derived && document.querySelector('.scn').scenarios.asked);
  await page.select('#scenario-compare-with', 'ekeptlib00');
  // the page says it is settling, and the Before column says it is working
  assert.equal(await page.$eval('.scn-compare', (el) => el.dataset.settling), 'true');
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Working…');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compareWith), '', 'the choice is not acted on until it has settled');
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith === 'ekeptlib00');
  await ready(page);
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Library lessons');
  assert.equal(await page.$eval('.scn-figures th:nth-child(3)', (el) => el.textContent), 'After', 'After stays After');
  // the status sentence, from the figures on screen
  const sentence = await page.$eval('.scn-compare__status', (el) => el.textContent);
  assert.match(sentence, /^Compared with Library lessons: walking (\d+ (min|s)( \d+ s)? (more|less)|the same)\.$/);
  const figures = await page.evaluate(async (base) => {
    const model = await import(base);
    const compare = document.querySelector('.scn').scenarios.compare;
    return { rows: model.figureRows(compare).map((row) => [row.id, row.before, row.after, row.difference]), sentence: model.comparedSentence('Library lessons', compare) };
  }, new URL('ui/scenarios/model.js', wide.url('')).href);
  assert.equal(figures.sentence, sentence);
  const shown = await page.$$eval('.scn-figures tbody tr', (rows) => rows.map((row) => [row.dataset.figure, ...Array.from(row.querySelectorAll('td')).map((td) => td.textContent.replace(/(better|worse)$/, ''))]));
  assert.deepEqual(shown, figures.rows, 'the table is the engine\'s own comparison of the two sides');
  // the figures are those of the kept scenario against the open one: the real
  // schedule is not the Before side (the walking time differs from the default's)
  const real = await page.evaluate(async () => {
    const answer = await globalThis.sv2.store.derived.scenario({ dayTypeId: null, transition: null, runFindings: true });
    return answer.compare.figures.walking.before;
  });
  const kept = await page.evaluate(() => document.querySelector('.scn').scenarios.compare.figures.walking.before);
  assert.notEqual(kept, real, 'Library lessons walks differently from the real schedule');
  // the legend and the table name the other side
  const key = await page.$eval('[data-part="difference-key"]', (el) => el.textContent);
  assert.match(key, /^On the map: busier than Library lessons, quieter than Library lessons\./);
  assert.equal(await page.$eval('.scn-difference-block', (el) => el.dataset.against), 'Library lessons');
  const picture = await page.evaluate(() => document.querySelector('.scn').difference.state());
  assert.equal(picture.state, 'shown');
  assert.ok(picture.busier.length + picture.quieter.length > 0, 'the map is painted with the difference against it');
  // the choice is view state: nothing of it is in the project
  assert.equal(JSON.stringify(await projectOf(page)).includes('compareWith'), false);
  assert.ok(asked !== undefined);
});

test('Compare with: a run of changes acts once, on the last, and going back to the real schedule restores Before', async () => {
  const page = wide.page;
  await load(page, fixture());
  const asked = await page.evaluate(() => document.querySelector('.scn').scenarios.asked);
  // three changes inside the 400 ms: the select fires change on each arrow key
  await page.evaluate(() => {
    const select = document.getElementById('scenario-compare-with');
    for (const value of ['ekeptlib00', 'ekepthost0', 'ekeptlong0']) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith === 'ekeptlong0');
  await ready(page);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.asked), asked + 1, 'one asking for the three changes');
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), LONG);
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.title), LONG);
  // back to the real schedule: Working…, then Before
  await page.select('#scenario-compare-with', '');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith === '');
  await ready(page);
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Before');
  assert.equal(await page.$eval('.scn-compare__status', (el) => el.textContent), '');
  assert.match(await page.$eval('[data-part="difference-key"]', (el) => el.textContent), /^On the map: busier, quieter\./);
  // a change put back before it settled is no change at all
  const again = await page.evaluate(() => document.querySelector('.scn').scenarios.asked);
  await page.evaluate(() => {
    const select = document.getElementById('scenario-compare-with');
    select.value = 'ekeptlib00';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await ready(page);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').scenarios.asked), again, 'put back inside the 400 ms: nothing asked');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compareWith), '');
});

test('Compare with keeps its choice when another scenario is switched to, and resets when it is the one switched to or deleted', async () => {
  const page = wide.page;
  await load(page, fixture());
  await chooseCompare(page, 'ekeptlib00');
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Library lessons');
  // another kept scenario is switched to: the choice stays
  await page.click(rowButton('ekepthost0', 'switch'));
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario?.id === 'ekepthost0');
  await ready(page);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compareWith), 'ekeptlib00', 'the choice is kept');
  assert.equal(await page.$eval('#scenario-compare-with', (el) => el.value), 'ekeptlib00');
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Library lessons');
  assert.equal(await announced(page), 'Switched to ' + HOSTILE + '. Move 6A to 301 is kept.');
  // the scenario compared with is switched to: back to the real schedule, and the sentence says so
  await page.click(rowButton('ekeptlib00', 'switch'));
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario?.id === 'ekeptlib00');
  await ready(page);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compareWith), '');
  assert.equal(await page.$eval('#scenario-compare-with', (el) => el.value), '');
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Before');
  assert.match(await announced(page), /You switched to the scenario you were comparing with, so it is now compared with the real schedule\.$/);
  // deleted
  await chooseCompare(page, 'ekeptlong0');
  await page.click(rowButton('ekeptlong0', 'delete'));
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] .btn--danger');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith === '');
  await ready(page);
  assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), 'Before');
  assert.match(await announced(page), /The scenario you were comparing with is gone/);
});

test('Compare with a scenario that is renamed or edited is asked again, with the new name in the heading', async () => {
  const page = wide.page;
  await load(page, fixture());
  await chooseCompare(page, 'ekeptlib00');
  await page.click(rowButton('ekeptlib00', 'rename'));
  await page.waitForSelector('#scenario-rename[open]');
  await page.keyboard.type('Library, mornings');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#scenario-rename[open]'));
  await ready(page);
  await page.waitForFunction(() => document.querySelector('[data-part="before-heading"]')?.textContent === 'Library, mornings');
  assert.equal(await page.$eval('.scn', (el) => el.dataset.compareWith), 'ekeptlib00');
  assert.match(await page.$eval('.scn-compare__status', (el) => el.textContent), /^Compared with Library, mornings: /);
});

test('Apply adds its line while scenarios are kept, and they stay kept', async () => {
  const page = wide.page;
  await load(page, fixture());
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  assert.equal(await page.$eval('#scenario-apply [data-part="kept-stay"]', (el) => el.textContent), 'Kept scenarios stay kept. They are compared with the schedule as it will be.');
  await page.click('#scenario-apply .btn--primary');
  await page.waitForFunction(() => globalThis.sv2.store.project.scenario === null);
  await ready(page);
  assert.deepEqual((await projectOf(page)).scenarios.map((each) => each.name), ['Library lessons', HOSTILE, LONG], 'the kept scenarios stay kept');
  // with none kept, no such line
  await load(page, fixture((project) => {
    project.scenarios = [];
  }));
  await page.click('[data-action="apply"]');
  await page.waitForSelector('#scenario-apply[open]');
  assert.equal(await page.$('#scenario-apply [data-part="kept-stay"]'), null);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
});

// ---------------------------------------------------------------- keyboard alone

test('by keyboard alone: Switch to, Duplicate, Rename…, Delete… and Compare with, with the focus where it should be', async () => {
  const page = wide.page;
  await load(page, fixture());
  const press = async (key, times) => {
    for (let i = 0; i < (times || 1); i += 1) await page.keyboard.press(key);
  };
  // from the strip's heading, Tab walks the first row's four buttons
  await page.focus('#scenario-others-title');
  await press('Tab');
  assert.equal((await focused(page)).action, 'other-switch');
  await press('Tab');
  assert.equal((await focused(page)).action, 'other-duplicate');
  await press('Space');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 4);
  assert.equal((await focused(page)).action, 'other-duplicate', 'the focus stays on the button used');
  assert.deepEqual((await projectOf(page)).scenarios.map((each) => each.name).slice(0, 2), ['Library lessons', 'Library lessons (copy)']);
  await press('Tab');
  assert.equal((await focused(page)).action, 'other-rename');
  await press('Enter');
  await page.waitForSelector('#scenario-rename[open]');
  await page.keyboard.type('Library, afternoons');
  await press('Enter');
  await page.waitForFunction(() => !document.querySelector('#scenario-rename[open]'));
  assert.equal((await focused(page)).action, 'other-rename');
  assert.equal((await rowsOf(page))[0].line, 'Library, afternoons · 3 changes');
  await press('Tab');
  assert.equal((await focused(page)).action, 'other-delete');
  await press('Enter');
  await page.waitForSelector('dialog[open]');
  // the dialog traps focus: Tab from the safe button goes round to the action
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep the scenario');
  await press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Delete the scenario');
  await press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 3);
  const next = (await projectOf(page)).scenarios[0].id;
  assert.equal((await focused(page)).row, next, 'the next row\'s first button (the copy)');
  assert.equal((await focused(page)).action, 'other-switch');
  // Switch to by Enter: the focus is the open scenario's name
  await press('Enter');
  await page.waitForFunction((id) => globalThis.sv2.store.project.scenario?.id === id, {}, next);
  assert.equal((await focused(page)).id, 'scenario-open-title');
  await ready(page);
  // Compare with: the select by the arrow keys
  await page.focus('#scenario-compare-with');
  await press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith !== '');
  await ready(page);
  const chosen = await page.$eval('.scn', (el) => el.dataset.compareWith);
  assert.ok(chosen !== '' && chosen !== next);
  assert.match(await page.$eval('.scn-compare__status', (el) => el.textContent), /^Compared with .+: walking /);
  assert.equal((await focused(page)).id, 'scenario-compare-with', 'the focus stays on the select');
});

// ---------------------------------------------------------------- a phone, with touch

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test('with touch at ' + size.width + ' by ' + size.height + ': rows wrap, buttons are a finger\'s size, nothing scrolls sideways, and taps do it all', async () => {
    // a browser of its own: a second planner page in the wide one's browser would be a follower tab
    const phone = await openPlanner({ server, width: size.width, height: size.height, mobile: true, hash: '#scenarios', theme: 'light' });
    try {
      const page = phone.page;
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is touched, not clicked');
      await load(page, fixture());
      // the strip is a list of rows, never a scroller; buttons are 44 px; the page does not scroll sideways
      const layout = await page.evaluate(() => {
        const list = document.querySelector('.scn-others__list');
        const rows = Array.from(list.children).map((row) => row.getBoundingClientRect());
        return {
          listScrolls: list.scrollWidth > list.clientWidth + 1,
          stacked: rows.every((row, i) => i === 0 || row.top >= rows[i - 1].bottom - 1),
          small: Array.from(document.querySelectorAll('.scn-others button, .scn-open__actions button')).filter((button) => button.getBoundingClientRect().height < 43.5).length,
          docWide: document.documentElement.scrollWidth > innerWidth + 1,
          panelWide: document.querySelector('.scn-panel').scrollWidth > document.querySelector('.scn-panel').clientWidth + 1,
          within: Array.from(document.querySelectorAll('.scn-other button')).every((button) => button.getBoundingClientRect().right <= innerWidth + 1),
        };
      });
      assert.deepEqual(layout, { listScrolls: false, stacked: true, small: 0, docWide: false, panelWide: false, within: true });
      // Keep and start another, by taps; the new scenario's name is focused
      await page.$eval('[data-action="keep-start"]', (el) => el.scrollIntoView({ block: 'center' }));
      await page.tap('[data-action="keep-start"]');
      await page.waitForFunction(() => document.querySelectorAll('.scn-other').length === 4);
      await ready(page);
      assert.equal((await focused(page)).id, 'scenario-name');
      // Switch to the first kept row, Compare with another, Delete the third
      await page.$eval(rowButton('ekeptlib00', 'switch'), (el) => el.scrollIntoView({ block: 'center' }));
      await page.tap(rowButton('ekeptlib00', 'switch'));
      await page.waitForFunction(() => globalThis.sv2.store.project.scenario?.id === 'ekeptlib00');
      await ready(page);
      await page.select('#scenario-compare-with', 'ekepthost0');
      await page.waitForFunction(() => document.querySelector('.scn').dataset.compareWith === 'ekepthost0');
      await ready(page);
      assert.equal(await page.$eval('[data-part="before-heading"]', (el) => el.textContent), HOSTILE);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'a long Before heading does not widen the page');
      await page.$eval(rowButton('ekeptlong0', 'delete'), (el) => el.scrollIntoView({ block: 'center' }));
      await page.tap(rowButton('ekeptlong0', 'delete'));
      await page.waitForSelector('dialog[open]');
      const dialog = await page.$$eval('dialog[open] .btn', (items) => items.map((item) => item.getBoundingClientRect().height));
      assert.ok(dialog.every((height) => height >= 43.5), 'the dialog\'s buttons are a finger\'s size: ' + dialog.join(', '));
      await page.tap('dialog[open] .btn--danger');
      await page.waitForFunction(() => !document.querySelector('[data-scenario="ekeptlong0"]'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(phone.problems().errors, []);
    } finally {
      await phone.close();
    }
  });
}

test('no error was logged and nothing left the page', async () => {
  assert.deepEqual(wide.problems().errors, []);
  assert.deepEqual(wide.offsite, []);
});
