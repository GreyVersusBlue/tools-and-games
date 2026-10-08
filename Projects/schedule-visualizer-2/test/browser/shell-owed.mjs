// What two more units owed, in a real browser:
// node test/browser/shell-owed.mjs
//
// The harness (SV2-14's trap): the bare address opens the section this
// browser was last on, so a session opened with no address after a sweep
// that ended on Project waited for a Building that never came. openPlanner()
// now names Building in the address when the caller names nothing.
//
// The shell (SV2-12's hooks): index.html links the Schedule section's
// stylesheet, the grid's and the print sheet's; the grid's keys are in Help
// whichever section is open; and Schedule's item on the rail carries a dot
// while the grid holds edits that are not applied.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, waitForSection, TOOL_PATH } from './harness.mjs';

let session;
let page;

before(async () => {
  // straight to Project: neither Building nor Schedule has been on screen
  session = await openPlanner({ hash: '#project', theme: 'light' });
  page = session.page;
});

after(async () => {
  if (session) await session.close();
});

const lastSection = (from) => from.evaluate(() => (JSON.parse(localStorage.getItem('sv2:device')) || {}).lastSection);
const shown = (from) => from.evaluate(() => document.querySelector('.surface__layout').dataset.section);

// ---------------------------------------------------------------- the stylesheets

test('index.html links the Schedule, grid and print stylesheets itself, and they are loaded before either section is opened', async () => {
  const sheets = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]'), (link) => ({ href: link.getAttribute('href'), rules: link.sheet ? link.sheet.cssRules.length : 0, own: link.parentNode === document.head && !link.dataset.sv2 })));
  for (const href of ['ui/schedule/schedule.css', 'ui/schedule/grid/grid.css', 'ui/print.css']) {
    const found = sheets.filter((sheet) => sheet.href === href);
    assert.equal(found.length, 1, href + ' is linked ' + found.length + ' times before any section asked for it');
    assert.ok(found[0].rules > 5, href + ' is linked and has not loaded');
  }
});

test('opening the grid adds no second copy of either stylesheet', async () => {
  await go(page, '#schedule/grid');
  await page.waitForSelector('.grd-cell--slot');
  const counts = await page.evaluate(() => ['schedule/schedule.css', 'schedule/grid/grid.css'].map((name) => Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((link) => link.href.endsWith('/ui/' + name)).length));
  assert.deepEqual(counts, [1, 1]);
  await go(page, '#project');
});

// ---------------------------------------------------------------- the grid's keys

test('Help lists the grid\'s keys from the start, whichever section is open', async () => {
  const fresh = await openPlanner({ hash: '#project', browser: session.browser, server: session.server, keep: true });
  try {
    const { keys, registered } = await fresh.page.evaluate(async (path) => {
      const { GRID_KEYS } = await import(path + 'ui/schedule/grid/index.js');
      return { keys: GRID_KEYS.map((key) => [key.id, key.does, key.shown]), registered: globalThis.sv2.shortcuts.list().map((entry) => [entry.id, entry.group]) };
    }, TOOL_PATH);
    assert.equal(keys.length, 8);
    for (const [id] of keys) assert.deepEqual(registered.filter((entry) => entry[0] === id), [[id, 'Schedule grid']], id + ' is on the shell\'s list once, under the grid\'s heading');
    await fresh.page.keyboard.press('?');
    await fresh.page.waitForSelector('#help-dialog[open]');
    const rows = await fresh.page.$$eval('#help-dialog tbody tr', (all) => all.map((row) => row.textContent));
    for (const [id, does] of keys) assert.ok(rows.some((row) => row.includes(does)), 'Help has no row for ' + id + ': "' + does + '"');
    await fresh.page.keyboard.press('Escape');
  } finally {
    await fresh.close();
  }
});

// ---------------------------------------------------------------- the dot on the rail

const dot = () => page.evaluate(() => {
  const all = document.querySelectorAll('#rail .rail__dot');
  const el = all[0];
  if (!el) return null;
  const style = getComputedStyle(el);
  const item = el.closest('.rail__item');
  return { count: all.length, section: item.dataset.section, hidden: el.hidden, display: style.display, width: style.width, colour: style.backgroundColor, round: style.borderTopLeftRadius, says: el.textContent, inside: el.getBoundingClientRect().left >= item.getBoundingClientRect().left && el.getBoundingClientRect().right <= item.getBoundingClientRect().right };
});

const staged = (how) => page.evaluate(async (path, what) => {
  const grid = await import(path + 'ui/schedule/grid/staged.js');
  const project = globalThis.sv2.store.project;
  if (what === 'stage') {
    grid.stageSlot(project.id, project.groups[0].id, project.dayTypes[0].id, 0, { room: null, roomText: 'Portable 4' });
    grid.touch(project.id);
  } else grid.discard(project.id);
}, TOOL_PATH, how);

test('Schedule\'s rail item carries a dot while the grid holds edits that are not applied, and only then', async () => {
  const before = await dot();
  assert.ok(before, 'the rail has no dot element');
  assert.deepEqual([before.count, before.section, before.hidden, before.display], [1, 'schedule', true, 'none'], 'nothing is staged, so nothing shows');

  // staged edits make the browser ask before the page is left, so whatever
  // happens below they are discarded before the next test loads a page
  await staged('stage');
  try {
    await whileStaged();
  } finally {
    await staged('discard');
  }
  assert.equal((await dot()).hidden, true, 'discarded, and the dot is still there');
});

async function whileStaged() {
  const on = await dot();
  assert.deepEqual([on.hidden, on.display !== 'none', on.width, on.round, on.inside], [false, true, '8px', '50%', true], 'an edit is staged and the dot is not drawn');
  const warning = await page.evaluate(() => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--warning)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  assert.equal(on.colour, warning, 'app.css draws it in the warning colour');
  assert.equal(on.says, ', grid edits not applied', 'and it says so to a screen reader');
  assert.deepEqual(await page.$eval('#rail .rail__dot .vh', (words) => [words.getBoundingClientRect().width, words.getBoundingClientRect().height]), [1, 1], 'the words are for a screen reader only');

  // the edits belong to the project: another project has none, and coming back brings the dot back
  await page.evaluate(() => globalThis.sv2.ctx.removeSample());
  assert.equal((await dot()).hidden, true, 'the empty project has no staged edits');
  await page.evaluate(() => globalThis.sv2.ctx.undo());
  assert.equal((await dot()).hidden, false, 'the sample school is back, and so are its staged edits');
}

// ---------------------------------------------------------------- the harness

test('the bare address opens the section this browser was last on: Building when nothing is remembered, Project after a visit to Project', async () => {
  await go(page, '#schedule');
  await go(page, '#project');
  assert.equal(await lastSection(page), 'project');
  await page.goto(session.url(''), { waitUntil: 'load' });
  await waitForSection(page, 'project');
  await page.evaluate(() => localStorage.removeItem('sv2:device'));
  await page.goto('about:blank');
  await page.goto(session.url(''), { waitUntil: 'load' });
  await waitForSection(page, 'building');
  assert.equal(await shown(page), 'building');
});

test('a session opened with no address after a sweep that ended on Project still opens Building', async () => {
  await go(page, '#project');
  assert.equal(await lastSection(page), 'project', 'the sweep\'s last screen is the one this browser remembers');
  const next = await openPlanner({ browser: session.browser, server: session.server, keep: true }).catch((error) => error);
  assert.ok(!(next instanceof Error), 'the next session did not open: ' + (next instanceof Error ? next.message : ''));
  try {
    assert.equal(await shown(next.page), 'building');
    assert.match(await next.page.evaluate(() => location.hash), /^#building/, 'the address names the section, so nothing remembered can change it');
  } finally {
    await next.close();
  }
});

test('an address the caller names is opened as before, and `hash: \'\'` is still the bare address', async () => {
  const named = await openPlanner({ hash: '#schedule/checks', browser: session.browser, server: session.server, keep: true });
  assert.equal(await shown(named.page), 'schedule');
  await named.close();
  await page.evaluate(() => localStorage.removeItem('sv2:device'));
  const bare = await openPlanner({ hash: '', browser: session.browser, server: session.server, keep: true });
  assert.equal(await bare.page.evaluate(() => location.hash.startsWith('#building') || location.hash === ''), true);
  assert.equal(bare.requests[0], session.url(''), 'the first request is the address with no section in it');
  await bare.close();
});
