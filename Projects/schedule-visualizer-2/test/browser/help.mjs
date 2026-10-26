// Help, in a real browser: node test/browser/help.mjs
//
// Help opened on every section of the rail, by the ? key at 1280 by 900 and
// by a finger on the top bar's ? at 390 by 844: the section open now leads
// and is marked, every section, shortcut, gesture, word and number is there,
// the focus starts on Close help and goes back to the opener. The title and
// Close stay in view while the body scrolls, at 390 by 844 and at 844 by 390
// with touch, and nothing is wider than the window. The parts' buttons move
// to their part; the numbers follow the project's settings; Show Getting
// started brings the card back; Escape closes it on the touch path too; a
// school's own period word (Mod) is what the dialog says; axe finds nothing
// in either theme at 1280 by 900, 390 by 844 and 844 by 390, and on a phone
// in either theme the title and Close stay in view.
//
// Every wait is on a state the page sets: the dialog's open and data-styled,
// the section's data-section, the card's hidden.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, startServer, launch, go, TOOL_DIR } from './harness.mjs';
import { HELP_TITLE } from '../../ui/help/index.js';

const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const DESK = { width: 1280, height: 900 };
const UPRIGHT = { width: 390, height: 844, mobile: true };
const ON_ITS_SIDE = { width: 844, height: 390, mobile: true };
const OPEN = '#help-dialog[open][data-styled="true"]';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function on(size, hash, run) {
  const session = await openPlanner({ hash, server, browser, ...size });
  try {
    await run(session.page);
  } finally {
    await session.close();
  }
}

// The rail's sections, in its order.
const railIds = (page) => page.$$eval('#rail a[data-section]', (all) => all.map((a) => a.dataset.section));

// What the open dialog says, read only from elements that have a box.
function readHelp(page) {
  return page.evaluate(() => {
    const dialog = document.getElementById('help-dialog');
    const shown = (el) => el.getClientRects().length > 0;
    const all = (selector) => Array.from(dialog.querySelectorAll(selector)).filter(shown);
    const title = document.getElementById(dialog.getAttribute('aria-labelledby'));
    return {
      title: title && shown(title) ? title.textContent : null,
      focus: document.activeElement.textContent,
      lead: (all('[data-lead]')[0] || {}).dataset?.lead || null,
      sections: all('.help__section').map((li) => li.dataset.section),
      here: all('.help__section[data-here="true"]').map((li) => li.dataset.section),
      firsts: all('.help__section').map((li) => li.textContent.includes('First: ')),
      keys: all('tbody tr').map((row) => row.dataset.key),
      groups: all('dd[data-group]').map((dd) => dd.dataset.group),
      devices: all('[data-device]').map((el) => el.dataset.device),
      words: all('dt[data-term]').map((dt) => dt.dataset.term),
      numbers: all('[data-numbers]').map((el) => el.dataset.numbers),
      jumps: all('[data-jump]').map((button) => button.dataset.jump),
      text: dialog.textContent,
    };
  });
}

async function checkHelp(page, id, rail) {
  const seen = await readHelp(page);
  assert.equal(seen.title, HELP_TITLE, id + ': the dialog is not named by its title');
  assert.equal(seen.focus, 'Close help', id + ': the safe button is not focused');
  assert.equal(seen.lead, id, id + ': Help does not lead with the section open now');
  assert.deepEqual(seen.sections, rail, id + ': the sections are not the rail’s');
  assert.deepEqual(seen.here, [id], id + ': the section open now is not the one marked');
  assert.ok(seen.firsts.every(Boolean), id + ': a section has no first step');
  const registered = await page.evaluate(() => globalThis.sv2.shortcuts.list());
  assert.deepEqual(seen.keys, registered.map((entry) => entry.id), id + ': the shortcuts are not the shell’s list');
  assert.deepEqual(seen.groups, [...new Set(registered.map((entry) => entry.group))], id + ': a group of shortcuts is not explained');
  assert.deepEqual(seen.devices, ['mouse', 'touch', 'pen', 'keyboard']);
  assert.equal(seen.words.length, 27, id + ': spec 2 has 20 words and DESIGN 11.1 adds 7');
  assert.deepEqual(seen.numbers, ['load', 'travel', 'late']);
  assert.deepEqual(seen.jumps, ['sections', 'keys', 'gestures', 'words', 'numbers']);
  assert.doesNotMatch(seen.text, /—/, 'an em dash in Help');
}

async function blurAll(page) {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
}

const helpGone = (page) => page.waitForFunction(() => document.getElementById('help-dialog') === null);

test('Help opens on every section by the ? key, leads with that section, has everything, and gives the focus back', async () => {
  await on(DESK, '#building', async (page) => {
    const rail = await railIds(page);
    assert.equal(rail.length, 7);
    for (const id of rail) {
      await go(page, '#' + id);
      await blurAll(page);
      await page.keyboard.press('?');
      await page.waitForSelector(OPEN);
      await checkHelp(page, id, rail);
      await page.keyboard.press('Escape');
      await helpGone(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help', id + ': the focus did not go back to the top bar’s ?');
    }
  });
});

// The title and Close in the window, and the body between them scrolled to
// its end without either moving.
async function holdsItsEnds(page, what) {
  // the dialog rises into place over 200 ms: measure where it comes to rest
  await page.evaluate(() => Promise.all(document.getElementById('help-dialog').getAnimations().map((animation) => animation.finished.catch(() => undefined))));
  const measure = () => page.evaluate(() => {
    const dialog = document.getElementById('help-dialog');
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const close = Array.from(dialog.querySelectorAll('.dialog__buttons button')).find((b) => b.textContent === 'Close help');
    const scroller = dialog.querySelector('.help__scroll');
    return {
      title: box(dialog.querySelector('.dialog__title')),
      close: box(close),
      scroller: box(scroller),
      scroll: { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, width: scroller.scrollWidth, clientWidth: scroller.clientWidth },
      window: { width: innerWidth, height: innerHeight },
      page: document.documentElement.scrollWidth,
      table: (() => {
        const wrap = dialog.querySelector('.help__table');
        return { width: wrap.scrollWidth, clientWidth: wrap.clientWidth };
      })(),
    };
  });
  const first = await measure();
  const inside = (b, w) => b.top >= 0 && b.left >= 0 && b.bottom <= w.height && b.right <= w.width;
  assert.ok(inside(first.title, first.window), what + ': the title is not in the window ' + JSON.stringify(first));
  assert.ok(inside(first.close, first.window), what + ': Close help is not in the window ' + JSON.stringify(first));
  assert.ok(first.close.bottom - first.close.top >= 44, what + ': Close help is under 44 px for a finger');
  assert.ok(first.scroll.height > first.scroll.client + 200, what + ': the body does not scroll, so this proves nothing');
  assert.ok(first.scroll.client >= 120, what + ': the body has ' + first.scroll.client + ' px to read in');
  assert.ok(first.scroll.width <= first.scroll.clientWidth + 1, what + ': the body is wider than its box: ' + first.scroll.width + ' in ' + first.scroll.clientWidth);
  assert.ok(first.page <= first.window.width, what + ': the page is wider than the window');
  assert.ok(first.table.width <= first.table.clientWidth + 1, what + ': the shortcuts scroll sideways: ' + first.table.width + ' in ' + first.table.clientWidth);
  await page.evaluate(() => {
    const scroller = document.querySelector('#help-dialog .help__scroll');
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForFunction(() => {
    const scroller = document.querySelector('#help-dialog .help__scroll');
    return scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  });
  const end = await measure();
  assert.deepEqual(end.title, first.title, what + ': the title moved as the body scrolled');
  assert.deepEqual(end.close, first.close, what + ': Close help moved as the body scrolled');
  assert.ok(inside(end.close, end.window), what + ': Close help left the window');
}

test('by a finger at 390 by 844: Help opens on every section from the top bar, keeps its title and Close in view, and closes', async () => {
  await on(UPRIGHT, '#building', async (page) => {
    const rail = await railIds(page);
    for (const id of rail) {
      await go(page, '#' + id);
      assert.ok(await page.$eval('#help', (el) => el.getClientRects().length > 0), id + ': the top bar has no ? on a phone');
      await page.tap('#help');
      await page.waitForSelector(OPEN);
      await checkHelp(page, id, rail);
      await holdsItsEnds(page, id + ' at 390 by 844');
      await page.tap('#help-dialog .dialog__buttons button:last-child');
      await helpGone(page);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help', id + ': the focus did not go back to the ?');
    }
  });
});

test('on a phone on its side, 844 by 390 with touch: the title and Close stay in view while the body scrolls', async () => {
  await on(ON_ITS_SIDE, '#movement', async (page) => {
    await page.tap('#help');
    await page.waitForSelector(OPEN);
    await checkHelp(page, 'movement', await railIds(page));
    await holdsItsEnds(page, '844 by 390');
    await page.tap('#help-dialog .dialog__buttons button:last-child');
    await helpGone(page);
  });
});

test('by a finger at 390 by 844, Escape closes Help and gives the focus back to the ?', async () => {
  await on(UPRIGHT, '#safety', async (page) => {
    await page.tap('#help');
    await page.waitForSelector(OPEN);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close help');
    await page.keyboard.press('Escape');
    await helpGone(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'help', 'the focus did not go back to the ?');
  });
});

test('the parts’ buttons move the body to their part and put the focus on its heading', async () => {
  await on(DESK, '#schedule', async (page) => {
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    for (const part of ['numbers', 'keys', 'words']) {
      await page.click('#help-dialog [data-jump="' + part + '"]');
      await page.waitForFunction((wanted) => document.activeElement.closest('[data-part]')?.dataset.part === wanted && document.activeElement.classList.contains('help__title'), {}, part);
      const where = await page.evaluate(() => {
        const scroller = document.querySelector('#help-dialog .help__scroll').getBoundingClientRect();
        const heading = document.activeElement.getBoundingClientRect();
        return { top: heading.top - scroller.top, inside: heading.top >= scroller.top - 1 && heading.bottom <= scroller.bottom };
      });
      assert.ok(where.inside, part + ': its heading is not in the body’s view ' + JSON.stringify(where));
    }
    // the hash never changed: the planner is still on Schedule
    assert.equal(await page.evaluate(() => location.hash.split('/')[0]), '#schedule');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('the numbers are this project’s settings, with the defaults beside them', async () => {
  await on(DESK, '#project', async (page) => {
    // Settings, Seconds per corridor cell: 5
    const found = await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll('.setting__label')).find((el) => el.textContent === 'Seconds per corridor cell');
      const input = label && document.querySelector('input[aria-labelledby="' + label.id + '"]');
      if (input) input.dataset.helpTest = 'cell';
      return Boolean(input);
    });
    assert.ok(found, 'no Seconds per corridor cell field on Project');
    const field = await page.$('input[data-help-test="cell"]');
    await field.click({ clickCount: 3 });
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => globalThis.sv2.store.project.settings.secondsPerCell === 5);
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    const travel = await page.$eval('#help-dialog [data-numbers="travel"]', (el) => el.textContent);
    assert.match(travel, /5 seconds \(the default is 3 seconds\) for each cell of corridor/);
    assert.match(travel, /8 seconds \(the default\) on stairs/);
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('a school that says Mod sees Mod in Help, in the words and in the numbers', async () => {
  await on(DESK, '#project', async (page) => {
    await page.click('#settings input[name="periodWord"][value="Mod"]');
    await page.waitForFunction(() => globalThis.sv2.store.project.settings.periodWord === 'Mod');
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    const seen = await readHelp(page);
    assert.ok(seen.words.includes('Mod') && !seen.words.includes('Period'), 'the words list the school’s word: ' + seen.words.join(', '));
    const said = await page.$eval('#help-dialog dt[data-term="Mod"] + dd', (el) => el.textContent);
    assert.match(said, /This school’s word for it is mod, and the planner says mod everywhere\./);
    const late = await page.$eval('#help-dialog [data-numbers="late"]', (el) => el.textContent);
    assert.match(late, /from the end of one mod to the start of the next/);
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Show Getting started brings the card back and puts the focus in it', async () => {
  await on(DESK, '#building', async (page) => {
    await page.click('#getting-started [data-action="dismiss"]');
    await page.waitForFunction(() => document.getElementById('getting-started').hidden === true);
    await page.click('#help');
    await page.waitForSelector(OPEN);
    await page.click('#help-dialog .dialog__buttons button:first-child');
    await page.waitForFunction(() => document.getElementById('getting-started').hidden === false);
    assert.equal(await page.evaluate(() => document.getElementById('getting-started').contains(document.activeElement)), true, 'the focus is not in the card');
  });
});

for (const [theme, size] of [['light', DESK], ['dark', DESK], ['light', UPRIGHT], ['dark', UPRIGHT], ['light', ON_ITS_SIDE], ['dark', ON_ITS_SIDE]]) {
  test('axe finds nothing in Help, in the ' + theme + ' theme at ' + size.width + ' by ' + size.height, async () => {
    const session = await openPlanner({ hash: '#safety', server, browser, theme, ...size });
    const { page } = session;
    try {
      await blurAll(page);
      await page.keyboard.press('?');
      await page.waitForSelector(OPEN);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      await page.addScriptTag({ path: AXE });
      const found = await page.evaluate((tags) => globalThis.axe.run(document.getElementById('help-dialog'), { runOnly: { type: 'tag', values: tags } }), TAGS);
      assert.ok(found.passes.length > 5, 'axe ran very few rules');
      assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), []);
      if (size.mobile) await holdsItsEnds(page, theme + ' at ' + size.width + ' by ' + size.height);
    } finally {
      await session.close();
    }
  });
}
