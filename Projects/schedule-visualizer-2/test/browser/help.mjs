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
// Search help (SV2-136; DESIGN 16.10 and 16.12 item 7): typing finds by words
// in any order, case and accents ignored, results are buttons in the Tab order,
// ArrowDown and ArrowUp move between them and the field, Enter or a click opens
// a result in the full body with its heading focused, Back to results is the
// next Tab stop after the field, Escape clears before it closes, Ctrl or ⌘ with F
// focuses the field and never the planner's own search, the count is spoken once
// for each change after 500 ms, markup in the text stays text, the mark pair is
// 4.5:1 in both themes, the field stays pinned on a phone and, under 500 px of
// height, it alone does (the title scrolls away, Close help stays).
//
// Every wait is on a state the page sets: the dialog's open and data-styled,
// the section's data-section, the card's hidden, and, for the search, the
// dialog's data-mode (browse, results, opened), data-pending (typing not yet
// settled) and data-said (the sentence the live region last spoke).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { openPlanner, startServer, launch, go, TOOL_DIR } from './harness.mjs';
import { HELP_TITLE } from '../../ui/help/index.js';
import { contrast } from '../../ui/colour.js';

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
  assert.equal(seen.words.length, 48, id + ': DESIGN 16.1 adds Feature, Period name, Not in school, Stairwell, Flight and Dead end; spec 2 has 20 words, DESIGN 11.1 adds 11, DESIGN 12.1 adds Staggered dismissal, DESIGN 13.1 adds Step-free, Area of refuge and Route sheet, DESIGN 14.1 adds Blocked, Lockdown map, Evacuation poster and Map pack, and DESIGN 15.1 adds Label, Kept scenario and Building comparison');
  for (const term of ['Elevator', 'Step-free', 'Area of refuge', 'Route sheet', 'Blocked', 'Lockdown map', 'Evacuation poster', 'Map pack', 'Label', 'Kept scenario', 'Building comparison', 'Feature', 'Period name', 'Not in school', 'Stairwell', 'Flight', 'Dead end']) assert.ok(seen.words.includes(term), id + ': Help\'s words lack ' + term);
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
// its end without either moving. Under 500 px of height (a phone on its side)
// the dialog itself scrolls: the title goes up with the text, and only the
// search field and Close help stay (DESIGN 16.12 item 7).
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
    const short = innerHeight < 500;
    const rolls = short ? dialog : scroller;
    return {
      short,
      title: box(dialog.querySelector('.dialog__title')),
      field: box(dialog.querySelector('.help__field')),
      close: box(close),
      scroller: box(scroller),
      dialog: box(dialog),
      bar: box(dialog.querySelector('.help__search')),
      scroll: { top: rolls.scrollTop, height: rolls.scrollHeight, client: rolls.clientHeight, width: scroller.scrollWidth, clientWidth: scroller.clientWidth },
      window: { width: innerWidth, height: innerHeight },
      page: document.documentElement.scrollWidth,
      table: (() => {
        const wrap = dialog.querySelector('.help__table');
        return wrap ? { width: wrap.scrollWidth, clientWidth: wrap.clientWidth } : { width: 0, clientWidth: 0 };
      })(),
    };
  });
  const first = await measure();
  const inside = (b, w) => b.top >= 0 && b.left >= 0 && b.bottom <= w.height && b.right <= w.width;
  assert.ok(inside(first.title, first.window), what + ': the title is not in the window to begin with ' + JSON.stringify(first));
  assert.ok(inside(first.field, first.window), what + ': the search field is not in the window ' + JSON.stringify(first));
  assert.ok(first.field.bottom - first.field.top >= 44, what + ': the search field is under 44 px for a finger');
  assert.ok(inside(first.close, first.window), what + ': Close help is not in the window ' + JSON.stringify(first));
  assert.ok(first.close.bottom - first.close.top >= 44, what + ': Close help is under 44 px for a finger');
  assert.ok(first.scroll.height > first.scroll.client + 200, what + ': the body does not scroll, so this proves nothing');
  assert.ok(first.short || first.scroll.client >= 120, what + ': the body has ' + first.scroll.client + ' px to read in');
  assert.ok(first.scroll.width <= first.scroll.clientWidth + 1, what + ': the body is wider than its box: ' + first.scroll.width + ' in ' + first.scroll.clientWidth);
  assert.ok(first.page <= first.window.width, what + ': the page is wider than the window');
  assert.ok(first.table.width <= first.table.clientWidth + 1, what + ': the shortcuts scroll sideways: ' + first.table.width + ' in ' + first.table.clientWidth);
  await page.evaluate(() => {
    const dialog = document.getElementById('help-dialog');
    const rolls = innerHeight < 500 ? dialog : dialog.querySelector('.help__scroll');
    rolls.scrollTop = rolls.scrollHeight;
  });
  await page.waitForFunction(() => {
    const dialog = document.getElementById('help-dialog');
    const rolls = innerHeight < 500 ? dialog : dialog.querySelector('.help__scroll');
    return rolls.scrollTop > 0 && rolls.scrollTop + rolls.clientHeight >= rolls.scrollHeight - 1;
  });
  const end = await measure();
  if (end.short) {
    assert.ok(end.title.bottom <= 0, what + ': under 500 px of height the title should have scrolled away ' + JSON.stringify(end.title));
  } else {
    assert.deepEqual(end.title, first.title, what + ': the title moved as the body scrolled');
  }
  if (end.short) {
    // the dialog scrolls, so the field rises to the dialog's own top edge and stays there
    assert.ok(Math.abs(end.bar.top - end.dialog.top) <= 2 && end.field.bottom <= end.window.height, what + ': the search field is not pinned at the top of the dialog ' + JSON.stringify({ bar: end.bar, dialog: end.dialog }));
  } else {
    assert.deepEqual(end.field, first.field, what + ': the search field moved as the body scrolled (it stays pinned)');
  }
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
    assert.match(travel, /Wait is 30 seconds \(the default\), from pressing the button to the doors opening; Ride per floor is 6 seconds \(the default\)/, 'the elevator\'s wait and ride (DESIGN 13.1)');
    assert.match(travel, /8 people \(the default\) fit in one \(People per trip\), so a group of 25 takes 4 trips/);
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

// Help names every tab Safety has (read from the page's own tablist, so a sixth
// tab fails here), and says the W5 words: the trial, never printed, the prints
// and the map pack's Save as PDF, and the exit-load rule in one sentence.
test('Help’s Safety part names each of Safety’s tabs, the trial and the prints, and the numbers hold the exit-load rule', async () => {
  await on(DESK, '#safety', async (page) => {
    await page.waitForSelector('.sfy-inspector .tabs__tab[data-tab="prints"]');
    const tabLabels = await page.$$eval('.sfy-inspector .tabs__tab', (all) => all.map((tab) => tab.textContent.trim()));
    assert.deepEqual(tabLabels, ['Exits', 'Door cards', 'Step-free', 'What if', 'Prints'], 'Safety’s tabs changed: Help’s Safety part must name them');
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    const seen = await page.evaluate(() => {
      const dialog = document.getElementById('help-dialog');
      const li = dialog.querySelector('.help__section[data-section="safety"]');
      const rule = Array.from(dialog.querySelectorAll('[data-numbers="load"] li, [data-numbers="load"] p')).map((el) => el.textContent);
      return { safety: li ? li.textContent : '', rule };
    });
    // an exact, word-bounded match: "Exits" is not met by "exits"
    for (const label of tabLabels) {
      assert.ok(new RegExp('(?<![A-Za-z0-9-])' + label.replace(/-/g, '\\-') + '(?![A-Za-z0-9-])').test(seen.safety), 'Help’s Safety part does not name the ' + label + ' tab');
    }
    for (const phrase of ['five tabs', 'never printed', 'Save as PDF', 'Use the scenario’s closures', 'Clear the trial', 'evacuation posters', 'lockdown maps', 'map pack']) {
      assert.ok(seen.safety.includes(phrase), 'Help’s Safety part lacks "' + phrase + '"');
    }
    assert.equal(seen.rule.filter((text) => text.includes('1.6 times an even share') && text.includes('50 people')).length, 1, 'the load numbers lack the one-sentence exit-load rule: ' + seen.rule.length + ' sentences read');
  });
});

// W6 states, brought up as test/browser/screens.mjs's SV2-124 openers do, so the
// labels Help names are read from the real page.
async function waitSaved(page) {
  await page.waitForFunction(() => document.getElementById('save-indicator').dataset.state === 'saved' && !globalThis.sv2.storage.pending, { timeout: 15000 });
}

// a second project kept on this device, beside the open one
async function shelveOne(page, label) {
  await waitSaved(page);
  await page.evaluate((name) => new Promise((resolve, reject) => {
    const open = indexedDB.open('sv2');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('project', 'readonly').objectStore('project').get('current');
      read.onsuccess = () => {
        const base = read.result;
        const tx = db.transaction('project', 'readwrite');
        tx.objectStore('project').put({ ...base, project: { ...base.project, id: 'phelp0000', label: name }, shelvedAt: '2026-11-12T15:40:00.000Z', bytes: 2400000 }, 'shelf:phelp0000');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    };
  }), label);
}

async function chooseFile(page, selector, name, body) {
  await page.evaluate((which, fileName, contents) => {
    const input = document.querySelector(which);
    const data = new DataTransfer();
    data.items.add(new File([contents], fileName));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, name, body);
}

// the Projects card with a second project, its row buttons and the Duplicate dialog's confirm button
async function projectsLabels(page) {
  await shelveOne(page, 'Next year');
  await go(page, '#scenarios');
  await go(page, '#project');
  await page.waitForFunction(() => {
    const el = document.getElementById('projects');
    return el && !el.hasAttribute('data-pending') && el.dataset.projects === '2' && el.dataset.state === 'ready';
  }, { timeout: 20000 });
  const row = await page.evaluate(() => {
    const li = Array.from(document.querySelectorAll('#projects .proj__list li')).find((each) => !each.querySelector('.proj__pill'));
    const text = (action) => { const b = li && li.querySelector('[data-action="' + action + '"]'); return b ? b.textContent.trim() : null; };
    return { open: text('open'), rename: text('rename'), delete: text('delete') };
  });
  await page.click('[data-action="duplicate"]');
  await page.waitForSelector('dialog[open] .dialog__buttons button');
  const confirm = await page.$eval('dialog[open] .dialog__buttons button', (el) => el.textContent.trim());
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  return { ...row, confirm };
}

// the lab with three kept scenarios, then the refusal of another building and its comparison held
async function scenariosLabels(page) {
  await go(page, '#scenarios');
  await page.waitForFunction(() => document.querySelector('.scn') && document.querySelector('.scn').dataset.styled === 'true', { timeout: 20000 });
  await page.evaluate(() => {
    const move = (groupId, period, roomId) => ({ kind: 'move', dayTypeId: 'dsample00a', groupId, period, roomId });
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    project.scenario = { id: 'eopen00001', name: 'Move 6A to 301', changes: [move('gsample06a', 1, 'rsample301')], compared: null };
    project.scenarios = [
      { id: 'ekeptlib00', name: 'Library lessons', changes: [move('gsample06b', 0, 'rsamplelib')], compared: null },
      { id: 'ekeptwest0', name: 'Stagger 8th grade', changes: [move('gsample06c', 0, 'rsample102')], compared: null },
    ];
    globalThis.sv2.store.replace(project);
  });
  await page.waitForSelector('.scn-others [data-action="other-switch"]', { timeout: 30000 });
  await page.waitForSelector('#scenario-compare-with', { timeout: 30000 });
  const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());
  const labels = {
    others: await text('#scenario-others-title'),
    switchTo: await text('.scn-others [data-action="other-switch"]'),
    keep: await text('[data-action="keep-start"]'),
    compareWith: await text('label[for="scenario-compare-with"]'),
  };
  // another building: the sample school with a Floor 4 and two rooms more
  const file = await page.evaluate(async () => {
    const { writeProjectFile } = await import(new URL('engine/project-file.js', location.href).href);
    const other = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    const three = other.building.floors.find((each) => each.id === 'fsample003');
    const four = JSON.parse(JSON.stringify(three));
    four.id = 'fhelpwing4';
    four.name = 'Floor 4';
    four.level = 4;
    four.image = null;
    const stairs = 5 + 8 * four.width;
    four.cells = four.cells.slice(0, stairs) + 'S' + four.cells.slice(stairs + 1);
    three.cells = three.cells.slice(0, stairs) + 'S' + three.cells.slice(stairs + 1);
    four.corridors = [{ id: 'khelpwing1', name: 'Wing Corridor', cells: four.cells.split('').map((c, i) => (c === '#' ? i : -1)).filter((i) => i >= 0) }];
    four.spaces = four.spaces.slice(0, 2).map((space, index) => ({ ...space, id: 'rhelpwing' + (index + 1), number: '40' + (index + 1), wing: 'Wing', teacherIds: [], doors: space.doors.slice() }));
    four.exits = [];
    other.building.floors.push(four);
    other.building.connections.push({ id: 'chelpwing1', label: 'E', a: { floorId: 'fsample003', cell: stairs }, b: { floorId: 'fhelpwing4', cell: stairs }, direction: 'both' });
    return writeProjectFile(other);
  });
  await chooseFile(page, 'input[data-file="compare"]', 'next-year.json', file);
  await page.waitForSelector('.scn-file__result[data-result="refused"]', { timeout: 30000 });
  labels.compareBuildings = await text('[data-action="compare-buildings"]');
  await page.click('[data-action="compare-buildings"]');
  await page.waitForSelector('.scn-bld[data-held="true"]:not([data-working="true"])', { timeout: 30000 });
  labels.stop = await text('.scn-bld [data-action="stop-comparing"]');
  return labels;
}

// W6 (SV2-124): Help names the Project section's own buttons, read from the
// page, so a button renamed there fails here, and says each W6 idea in words.
test('Help’s Project and Scenarios parts name the Projects card’s buttons and the W6 ideas', async () => {
  await on(DESK, '#project', async (page) => {
    await page.waitForSelector('[data-action="start-another"]');
    const onPage = await page.evaluate(() => ['start-another', 'duplicate'].map((action) => document.querySelector('[data-action="' + action + '"]').textContent.trim()));
    assert.deepEqual(onPage, ['Start another project…', 'Duplicate this project'], 'the Projects card’s buttons changed: Help must name them');
    const part = await page.evaluate(() => Array.from(document.querySelectorAll('button, label')).map((el) => el.textContent.trim()).filter((text) => text === 'Import part of a project file…' || text === 'Replace with a new empty project'));
    assert.deepEqual([...new Set(part)].sort(), ['Import part of a project file…', 'Replace with a new empty project']);
    // the labels Help names, read from the real Projects card and lab, so a renamed button fails here
    const row = await projectsLabels(page);
    assert.deepEqual(row, { open: 'Open', rename: 'Rename…', delete: 'Delete…', confirm: 'Duplicate and open it' }, 'a Projects row button or the Duplicate dialog’s confirm button changed: Help must name it');
    const lab = await scenariosLabels(page);
    assert.deepEqual(lab, { others: 'Other scenarios', switchTo: 'Switch to', keep: 'Keep and start another', compareWith: 'Compare with', compareBuildings: 'Compare the two buildings', stop: 'Stop comparing' }, 'a Scenarios label changed: Help must name it');
    await go(page, '#project');
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    const said = await page.evaluate(() => ({
      project: document.querySelector('.help__section[data-section="project"]').textContent,
      scenarios: document.querySelector('.help__section[data-section="scenarios"]').textContent,
    }));
    for (const phrase of ['Projects on this device', 'The Label is', 'Start another project', 'Duplicate this project', 'Open switches', 'Rename…', 'Delete…', 'Export it first', 'Keep it as another project', 'Open followed by that project’s label', 'Of other projects', 'Of projects no longer on this device', 'Cannot be read', 'Restore as a project', 'Import part of a project file', 'only the building, only the schedule or only the settings', 'Bring it in', 'a snapshot is taken first', 'Replace with a new empty project']) {
      assert.ok(said.project.includes(phrase), 'Help’s Project part lacks "' + phrase + '"');
    }
    for (const label of [row.open, row.rename, row.delete, row.confirm]) assert.ok(said.project.includes(label), 'Help’s Project part does not name ' + label);
    for (const phrase of [...Object.values(lab), 'Duplicate', 'Rename…', 'Delete…', 'only in one building', 'not saved']) {
      assert.ok(said.scenarios.includes(phrase), 'Help’s Scenarios part lacks "' + phrase + '"');
    }
    for (const word of ['Label', 'Kept scenario', 'Building comparison']) {
      const meaning = await page.$eval('#help-dialog dt[data-term="' + word + '"] + dd', (el) => el.textContent);
      assert.ok(meaning.endsWith('.') && !meaning.includes('. '), word + ' is not one sentence');
    }
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

// ---- Search help (SV2-136) ----

const FIELD = '#help-dialog .help__field';
const dialogState = (page) => page.evaluate(() => {
  const d = document.getElementById('help-dialog');
  return { mode: d.dataset.mode, pending: d.dataset.pending || null, found: d.dataset.found || null, said: d.dataset.said || null };
});
// typed into the field, then settled: the results are drawn and the 150 ms are over
async function typeQuery(page, text) {
  await page.focus(FIELD);
  await page.$eval(FIELD, (el) => { el.value = ''; });
  await page.keyboard.type(text);
  await page.waitForFunction(() => { const d = document.getElementById('help-dialog'); return d.dataset.mode !== undefined && !d.dataset.pending; });
}
const resultsNow = (page) => page.$$eval('#help-dialog .help__result', (all) => all.map((button) => ({
  title: button.querySelector('.help__result-title').textContent,
  section: button.querySelector('.help__result-section').textContent,
  text: button.querySelector('.help__result-text').textContent,
  marks: Array.from(button.querySelectorAll('mark')).map((mark) => mark.textContent),
})));
const activeIs = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, text: el.textContent.trim().slice(0, 60), classes: el.className, result: el.dataset.result || null, landed: el.dataset.landed || null };
});
const pressKeys = async (page, ...keys) => {
  for (const key of keys) await page.keyboard.press(key);
};
async function openHelpOn(page, hash) {
  await go(page, hash);
  await blurAll(page);
  await page.keyboard.press('?');
  await page.waitForSelector(OPEN);
  // the dialog rises into place over 200 ms: measure it at rest
  await page.evaluate(() => Promise.all(document.getElementById('help-dialog').getAnimations().map((animation) => animation.finished.catch(() => undefined))));
}

test('Search help: words in any order, case and accents ignored, results are buttons with the matched words marked, and one character searches nothing', async () => {
  await on(DESK, '#building', async (page) => {
    await openHelpOn(page, '#building');
    assert.equal(await page.$eval(FIELD, (el) => el.getAttribute('title')), 'Search help (Ctrl+F)');
    assert.equal(await page.$eval('#help-dialog label[for="' + (await page.$eval(FIELD, (el) => el.id)) + '"]', (el) => el.textContent), 'Search help');
    assert.ok((await page.$eval(FIELD, (el) => el.getBoundingClientRect().height)) >= 44, 'the field is under 44 px');
    assert.deepEqual(await dialogState(page), { mode: 'browse', pending: null, found: null, said: null });
    // one character: the body stays
    await typeQuery(page, 'a');
    assert.equal((await dialogState(page)).mode, 'browse');
    assert.equal(await page.$('#help-dialog .help__result'), null);
    // two words, any order, any case
    await typeQuery(page, 'FLIGHT stairwell');
    const one = await resultsNow(page);
    await typeQuery(page, 'stairwell flight');
    const two = await resultsNow(page);
    assert.ok(one.length > 0, 'nothing found for two words of the glossary');
    assert.deepEqual(one, two, 'the order of the words changed the results');
    assert.ok(one.every((r) => r.marks.length > 0), 'a result without a marked word');
    // accents: the words have none, the query does
    await typeQuery(page, 'stáirwéll');
    assert.deepEqual((await resultsNow(page)).map((r) => r.title).slice(0, 1), ['Stairwell']);
    // the glossary word comes first, and is one sentence under its own name with its section
    await typeQuery(page, 'dead end');
    const dead = await resultsNow(page);
    assert.equal(dead[0].title, 'Dead end');
    assert.equal(dead[0].section, 'The words the planner uses');
    assert.ok(dead[0].marks.length > 0, 'the matched words are marked');
    assert.match(dead[0].text, /6 cells/);
    assert.equal(await page.$eval('#help-dialog .help__count', (el) => el.textContent), dead.length + ' results');
    // every result is a native button in the Tab order, and is 44 px tall
    const kinds = await page.$$eval('#help-dialog .help__result', (all) => all.map((el) => ({ tag: el.tagName, type: el.type, tab: el.tabIndex, height: el.getBoundingClientRect().height })));
    assert.ok(kinds.every((k) => k.tag === 'BUTTON' && k.type === 'button' && k.tab === 0 && k.height >= 44), JSON.stringify(kinds.find((k) => !(k.tag === 'BUTTON' && k.tab === 0 && k.height >= 44))));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Search help: no results says so in words; the live region speaks a count once for each change, after 500 ms of quiet', async () => {
  await on(DESK, '#building', async (page) => {
    await openHelpOn(page, '#building');
    await page.evaluate(() => {
      const status = document.querySelector('#help-dialog [role="status"]');
      globalThis.spoken = [];
      new MutationObserver(() => globalThis.spoken.push(status.textContent)).observe(status, { childList: true, characterData: true, subtree: true });
    });
    await typeQuery(page, 'qqqzz');
    assert.equal(await page.$eval('#help-dialog .help__none', (el) => el.textContent), 'No results for ‘qqqzz’. Try fewer or different words.');
    assert.equal(await page.$('#help-dialog .help__result'), null);
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.said === 'No results for ‘qqqzz’. Try fewer or different words.');
    // a second no-result query changes the words, so it is said again; the same words are not
    await typeQuery(page, 'qqqzzs');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.said === 'No results for ‘qqqzzs’. Try fewer or different words.');
    // typing a character at a time, fast, says one thing at the end and nothing between
    await typeQuery(page, 'stairwell');
    await page.waitForFunction(() => /^\d+ results?$/.test(document.getElementById('help-dialog').dataset.said || ''));
    const said = await page.evaluate(() => globalThis.spoken.slice());
    assert.equal(said.length, 3, 'the region spoke ' + JSON.stringify(said));
    assert.match(said[2], /^\d+ results?$/);
    // the same count again is not spoken again: a query with the same results
    const before = await page.evaluate(() => globalThis.spoken.length);
    await typeQuery(page, 'stairwell ');
    await typeQuery(page, 'stairwell');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.pending === undefined);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 700)));
    assert.equal(await page.evaluate(() => globalThis.spoken.length), before, 'an unchanged count was spoken again');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Search help, by keyboard: ArrowDown from the field to the first result, ArrowDown and ArrowUp between results, ArrowUp from the first back to the field; Enter opens the first', async () => {
  await on(DESK, '#building', async (page) => {
    await openHelpOn(page, '#building');
    await typeQuery(page, 'stairs');
    const all = await resultsNow(page);
    assert.ok(all.length > 3, 'too few results to walk through');
    await page.keyboard.press('ArrowDown');
    assert.equal((await activeIs(page)).result, '0');
    await pressKeys(page, 'ArrowDown', 'ArrowDown');
    assert.equal((await activeIs(page)).result, '2');
    await page.keyboard.press('ArrowUp');
    assert.equal((await activeIs(page)).result, '1');
    await pressKeys(page, 'ArrowUp', 'ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('help__field')), true, 'ArrowUp from the first result did not go back to the field');
    // Tab order: the field, then the clear button, then the results (the box is not a stop)
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Clear search');
    await page.keyboard.press('Tab');
    assert.equal((await activeIs(page)).result, '0', 'the first result is not the next Tab stop after Clear search');
    // the focused result stays in the results area's view
    for (let n = 0; n < Math.min(all.length - 1, 12); n += 1) await page.keyboard.press('ArrowDown');
    const visible = await page.evaluate(() => {
      const scroller = document.querySelector('#help-dialog .help__scroll').getBoundingClientRect();
      const at = document.activeElement.getBoundingClientRect();
      return at.top >= scroller.top - 1 && at.bottom <= scroller.bottom + 1;
    });
    assert.equal(visible, true, 'the focused result is out of view');
    // Enter on the field opens the first result
    await page.focus(FIELD);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'opened');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Search help: a result opens its part in the full body, heading focused, the field keeps its text, and Back to results is the next Tab stop after the field', async () => {
  await on(DESK, '#building', async (page) => {
    await openHelpOn(page, '#building');
    await typeQuery(page, 'flight');
    const found = await resultsNow(page);
    const at = found.findIndex((r) => r.title === 'Flight');
    assert.ok(at >= 0, 'no result for the glossary word Flight');
    await page.click('#help-dialog .help__result[data-result="' + at + '"]');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'opened');
    // the full body is back, scrolled to the word, its term focused
    const where = await page.evaluate(() => {
      const dialog = document.getElementById('help-dialog');
      const scroller = dialog.querySelector('.help__scroll').getBoundingClientRect();
      const el = document.activeElement;
      const box = el.getBoundingClientRect();
      return { term: el.dataset.term || null, landed: el.dataset.landed || null, inside: box.top >= scroller.top - 1 && box.bottom <= scroller.bottom + 1, parts: dialog.querySelectorAll('[data-part]').length, results: dialog.querySelectorAll('.help__result').length, field: dialog.querySelector('.help__field').value };
    });
    assert.deepEqual(where, { term: 'Flight', landed: 'true', inside: true, parts: 5, results: 0, field: 'flight' });
    // Back to results is the next Tab stop after the field
    await page.focus(FIELD);
    await page.keyboard.press('Tab');
    assert.equal((await activeIs(page)).text, 'Back to results');
    assert.ok((await page.$eval('#help-dialog .help__back', (el) => el.getBoundingClientRect().height)) >= 44);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'results');
    assert.equal((await activeIs(page)).result, String(at), 'the result that was opened is not the one focused when the list comes back');
    assert.equal(await page.$eval('#help-dialog .help__back', (el) => el.hidden), true, 'Back to results is still shown over the list');
    // the other kinds open too: a shortcut's row, a section, a numbers sentence, a gesture
    for (const [query, check] of [
      ['Go to the search box', (a) => a.tag === 'TR'],
      ['dead end', (a) => a.tag === 'DT' || a.tag === 'H4'],
      ['crossing wait', (a) => a.tag === 'H4'],
      ['pinch', (a) => a.tag === 'H4'],
    ]) {
      await typeQuery(page, query);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'opened');
      const there = await activeIs(page);
      assert.ok(check(there) && there.landed === 'true', query + ' opened somewhere else: ' + JSON.stringify(there));
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Search help: Escape clears a non-empty field first and closes Help the second time; Clear search empties it; Ctrl and ⌘ with F focus the field, never the planner\'s search', async () => {
  await on(DESK, '#building', async (page) => {
    await openHelpOn(page, '#building');
    await typeQuery(page, 'stairs');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('help-dialog') !== null && document.getElementById('help-dialog').open), true, 'the first Escape closed Help');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'browse');
    assert.equal(await page.$eval(FIELD, (el) => el.value), '');
    assert.equal(await page.$eval('#help-dialog .help__clear', (el) => el.hidden), true);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('help__field')), true);
    // Clear search
    await typeQuery(page, 'stairs');
    await page.click('#help-dialog .help__clear');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'browse');
    assert.equal(await page.$eval(FIELD, (el) => el.value), '');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('help__field')), true, 'Clear search did not give the focus to the field');
    // Ctrl+F, and ⌘F, with the focus elsewhere in Help
    for (const modifier of ['Control', 'Meta']) {
      await page.focus('#help-dialog .dialog__buttons button:last-child');
      await page.keyboard.down(modifier);
      await page.keyboard.press('f');
      await page.keyboard.up(modifier);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('help__field')), true, modifier + '+F did not focus Help\'s field');
      assert.equal(await page.evaluate(() => document.activeElement.id === 'search'), false, modifier + '+F went to the planner\'s search');
    }
    await page.keyboard.press('Escape');
    await helpGone(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'help');
  });
});

test('Search help: what a project calls things, and anything typed there, is text: a period word that looks like markup is found and shown as typed', async () => {
  await on(DESK, '#project', async (page) => {
    await page.evaluate(async () => {
      const { setPeriodCustom } = await import(new URL('engine/w7-actions.js', location.href).href);
      globalThis.sv2.store.apply(setPeriodCustom, { word: '<img src=x>', plural: 'Imgs', count: 'number' });
    });
    await openHelpOn(page, '#project');
    await typeQuery(page, 'img');
    const found = await resultsNow(page);
    assert.ok(found.length > 0, 'the school\'s own word is not in the index');
    assert.ok(found.some((r) => r.text.includes('<img src=x>')), 'the word is not shown as typed: ' + JSON.stringify(found.map((r) => r.text)));
    assert.equal(await page.$('#help-dialog img'), null, 'a result was parsed as markup');
    assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#help-dialog mark')).every((mark) => mark.children.length === 0)), true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await helpGone(page);
  });
});

test('Search help: the mark pair reads at 4.5:1 in the light and the dark theme, as drawn', async () => {
  for (const theme of ['light', 'dark']) {
    const session = await openPlanner({ hash: '#building', server, browser, theme, ...DESK });
    try {
      const { page } = session;
      await blurAll(page);
      await page.keyboard.press('?');
      await page.waitForSelector(OPEN);
      await typeQuery(page, 'stairs');
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      const colours = await page.$eval('#help-dialog mark', (mark) => ({ ink: getComputedStyle(mark).color, ground: getComputedStyle(mark).backgroundColor }));
      const rgb = (text) => '#' + text.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      assert.ok(contrast(rgb(colours.ink), rgb(colours.ground)) >= 4.5, theme + ': the mark is ' + contrast(rgb(colours.ink), rgb(colours.ground)).toFixed(2) + ':1 (' + JSON.stringify(colours) + ')');
    } finally {
      await session.close();
    }
  }
});

test('Search help on a phone: the field stays pinned under the title while the body scrolls, and a result opens by a tap with Back to results a finger tall', async () => {
  await on(UPRIGHT, '#building', async (page) => {
    await page.tap('#help');
    await page.waitForSelector(OPEN);
    await page.tap(FIELD);
    await page.keyboard.type('stairs');
    await page.waitForFunction(() => { const d = document.getElementById('help-dialog'); return d.dataset.mode === 'results' && !d.dataset.pending; });
    const before = await page.evaluate(() => { const r = document.querySelector('#help-dialog .help__field').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
    await page.evaluate(() => { const s = document.querySelector('#help-dialog .help__scroll'); s.scrollTop = s.scrollHeight; });
    await page.waitForFunction(() => { const s = document.querySelector('#help-dialog .help__scroll'); return s.scrollTop > 0; });
    const after = await page.evaluate(() => { const r = document.querySelector('#help-dialog .help__field').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
    assert.deepEqual(after, before, 'the field moved as the results scrolled');
    assert.ok(before[1] - before[0] >= 44);
    await page.tap('#help-dialog .help__result');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'opened');
    const back = await page.$eval('#help-dialog .help__back', (el) => { const r = el.getBoundingClientRect(); return { height: r.height, shown: r.width > 0, inside: r.right <= innerWidth && r.left >= 0 }; });
    assert.ok(back.shown && back.inside && back.height >= 44, 'Back to results: ' + JSON.stringify(back));
    await holdsItsEnds(page, 'results opened, 390 by 844');
    await page.tap('#help-dialog .help__back');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'results');
    await page.tap('#help-dialog .help__clear');
    await page.waitForFunction(() => document.getElementById('help-dialog').dataset.mode === 'browse');
    await page.tap('#help-dialog .dialog__buttons button:last-child');
    await helpGone(page);
  });
});

test('Search help on a phone on its side: under 500 px of height only the field stays pinned, the title scrolls away and Close help stays', async () => {
  await on(ON_ITS_SIDE, '#movement', async (page) => {
    await page.tap('#help');
    await page.waitForSelector(OPEN);
    await page.tap(FIELD);
    await page.keyboard.type('the');
    await page.waitForFunction(() => { const d = document.getElementById('help-dialog'); return d.dataset.mode === 'results' && !d.dataset.pending; });
    await holdsItsEnds(page, 'results at 844 by 390');
    await page.tap('#help-dialog .dialog__buttons button:last-child');
    await helpGone(page);
  });
});

// W7: Help names each ability with the words the screens use, read from the real page.
const scheduleReady = (page) => page.waitForFunction(() => document.querySelector('.sch') && document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('link[data-sheet="schedule"]').sheet !== null);

async function helpPart(page, id) {
  await blurAll(page);
  await page.keyboard.press('?');
  await page.waitForSelector(OPEN);
  const text = await page.$eval('#help-dialog .help__section[data-section="' + id + '"]', (el) => el.textContent);
  await page.keyboard.press('Escape');
  await helpGone(page);
  return text;
}

test('Help\'s Building part names the W7 controls as the screens label them, and states the dead-end thresholds', async () => {
  await on(DESK, '#building', async (page) => {
    await page.waitForSelector('#floor-actions');
    await page.click('#floor-actions');
    await page.waitForSelector('.menu[role="menu"]');
    const menu = await page.$$eval('.menu [role^="menuitem"]', (items) => items.map((item) => item.textContent.replace('●', '').trim()));
    assert.deepEqual(menu, ['Rename…', 'Duplicate floor…', 'Move left', 'Move right', 'Delete…'].filter((label) => menu.includes(label)), 'the floor menu changed: ' + menu.join(' | '));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.menu[role="menu"]') === null);
    await page.click('[data-tool="room"]');
    await page.waitForSelector('#auto-number');
    await page.click('#auto-number');
    await page.waitForFunction(() => !document.getElementById('next-number-field').hidden);
    const options = await page.evaluate(() => [document.querySelector('#auto-number').closest('label').textContent.trim(), document.querySelector('label[for="next-number"]').textContent.trim()]);
    assert.deepEqual(options, ['Auto-number', 'Next number']);
    const said = await helpPart(page, 'building');
    for (const item of menu) assert.ok(said.includes(item.replace(/ (left|right)$/, '')), 'Help\'s Building part does not name the floor menu\'s ' + item);
    for (const label of [...options, 'Features', 'Edit the features list…', 'Add a feature', 'Add common ones', 'Stairwell through floors…', 'Make one stairwell', 'Connect another floor…', 'Remove from stairwell', 'Split into separate stairs', 'Join the parts', 'Show me', 'Which way', 'Join the stairs and elevators', 'teachers in rooms']) {
      assert.ok(said.includes(label), 'Help\'s Building part lacks "' + label + '"');
    }
    for (const phrase of ['on top of the building', 'same row and column', 'parts meet on one floor', 'highest number on the floor', 'longer than 6 cells', 'longer than 20 feet (6.1 metres)', 'a note when it is longer', 'a warning when it leads to no room, other space, stair or exit', 'with a door or without']) {
      assert.ok(said.includes(phrase), 'Help\'s Building part lacks "' + phrase + '"');
    }
  });
});

test('Help\'s Schedule part names the period word, the period names and Part-time as the Day and Teachers tabs label them', async () => {
  await on(DESK, '#schedule/day', async (page) => {
    await scheduleReady(page);
    const day = await page.evaluate(() => ({
      other: Array.from(document.querySelectorAll('.sch label')).map((el) => el.textContent.trim()).filter((text) => text === 'Other word…'),
      names: document.querySelector('[data-key="names:toggle"]').textContent.replace(/\s+/g, ' ').trim(),
    }));
    assert.deepEqual(day.other, ['Other word…']);
    assert.match(day.names, /^Name periods \(Lunch, Advisory\)…/);
    const said = await helpPart(page, 'schedule');
    for (const phrase of ['Other word…', 'Name periods (Lunch, Advisory)…', 'Count as', 'Mark it as lunch for the whole school', 'Not in school, never Planning', 'Add another time']) {
      assert.ok(said.includes(phrase), 'Help\'s Schedule part lacks "' + phrase + '"');
    }
  });
  await on(DESK, '#schedule/teachers', async (page) => {
    await scheduleReady(page);
    const heads = await page.$$eval('.sch-teachers thead th', (all) => all.map((th) => th.textContent.trim()));
    assert.ok(heads.includes('Part-time'), 'the Teachers table has no Part-time column: ' + heads.join(', '));
    await page.click('[data-key="teacher:tsample001:part:button"]');
    await page.waitForSelector('[data-part-editor="tsample001"]');
    const choices = await page.$$eval('[data-part-editor="tsample001"] label', (all) => all.map((el) => el.textContent.trim()));
    assert.ok(choices.includes('Only in school on…') && choices.includes('Not in school…'), 'the editor\'s choices changed: ' + choices.join(' | '));
    const said = await helpPart(page, 'schedule');
    for (const phrase of ['Part-time', 'Only in school on…', 'Not in school…']) assert.ok(said.includes(phrase), 'Help\'s Schedule part lacks "' + phrase + '"');
  });
});

test('Help\'s glossary has the six W7 words, each one sentence, and the thresholds are the ones Checks uses', async () => {
  await on(DESK, '#building', async (page) => {
    await blurAll(page);
    await page.keyboard.press('?');
    await page.waitForSelector(OPEN);
    for (const term of ['Feature', 'Period name', 'Not in school', 'Stairwell', 'Flight', 'Dead end']) {
      const meaning = await page.$eval('#help-dialog dt[data-term="' + term + '"] + dd', (el) => el.textContent);
      assert.ok(meaning.endsWith('.') && !meaning.includes('. '), term + ' is not one sentence: ' + meaning);
    }
    const flight = await page.$eval('#help-dialog dt[data-term="Flight"] + dd', (el) => el.textContent);
    assert.equal(flight, 'The stairs between two floors of a stairwell.');
    const dead = await page.$eval('#help-dialog dt[data-term="Dead end"] + dd', (el) => el.textContent);
    assert.match(dead, /longer than 6 cells, or 20 feet \(6\.1 metres\) when the Cell scale is set/);
    const travel = await page.$eval('#help-dialog [data-numbers="travel"]', (el) => el.textContent);
    assert.match(travel, /longer than 6 cells, or, with a Cell scale, longer than 20 feet \(6\.1 metres\)/);
    assert.match(travel, /counts as served, with a door or without/);
    await page.keyboard.press('Escape');
    await helpGone(page);
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

for (const [theme, size] of [['light', DESK], ['dark', DESK], ['light', UPRIGHT], ['dark', UPRIGHT], ['light', ON_ITS_SIDE], ['dark', ON_ITS_SIDE]]) {
  test('axe finds nothing in Help with search results shown, in the ' + theme + ' theme at ' + size.width + ' by ' + size.height, async () => {
    const session = await openPlanner({ hash: '#safety', server, browser, theme, ...size });
    const { page } = session;
    try {
      await blurAll(page);
      await page.keyboard.press('?');
      await page.waitForSelector(OPEN);
      await typeQuery(page, 'dead end');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
      await page.addScriptTag({ path: AXE });
      const found = await page.evaluate((tags) => globalThis.axe.run(document.getElementById('help-dialog'), { runOnly: { type: 'tag', values: tags } }), TAGS);
      assert.ok(found.passes.length > 5, 'axe ran very few rules');
      assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), []);
    } finally {
      await session.close();
    }
  });
}
