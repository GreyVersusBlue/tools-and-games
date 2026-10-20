// The schedule after the walk-through of it, in a real browser:
// node test/browser/m2-pass.mjs
//
// The walk-through used the sample school at 1280 by 800 and at 390 by 760,
// and so do these. Each case is one thing it found, or one thing the units
// before it said they owed: the stylesheets the page links itself, a slot
// with an address, a field that an undo changed under, a picker that keeps a
// room number the building does not have, a list of groups that is one Tab
// stop, a phone on which the buttons fit and the editor is where the tap was,
// an inspector that does not say the Checks tab twice, and a message that
// does not lie on the last row of the table it is about. Assertions are on
// what the page shows; the store is read for what a reload has to keep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openPlanner, go, startServer, launch, waitForSection, visit, TOOL_DIR } from './harness.mjs';
import { SCREENS } from './screens.mjs';

const DAY_A = 'dsample00a';
const DAY_B = 'dsample00b';
const A6 = 'gsample06a';
const B6 = 'gsample06b';
const C6 = 'gsample06c';
const A7 = 'gsample07a';
const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 760, mobile: true };
const CLEAN = { errors: [], blocked: [], shimmed: [] };

let server;
let browser;

const source = (file) => readFileSync(path.join(TOOL_DIR, ...file.split('/')), 'utf8');
const settled = (page) => page.waitForFunction(() => document.querySelector('.sch')?.dataset.pending !== 'true', { timeout: 5000 });
// Into a section from another, and waited for until it is drawn. The
// schedule draws itself again when the engine's first answer for the page
// comes (ui/schedule/index.js, `walkResults`), which puts a new control in
// place of every one it had, and reads as pending until then. A click whose
// node was found before that drawing and is sent after it fails with "Node is
// detached from document" (SV2-72a: Add a group, on a slower CI runner).
const goSettled = async (page, hash) => {
  await go(page, hash);
  await settled(page);
};
const shows = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
// A wait for a state the page sets that an assertion depends on: when the
// state never comes, the case fails saying `why` (SV2-56 item 3: such a
// wait once ended in `.catch(() => {})`, and the assertion after it read
// whatever the page was left at).
async function until(page, why, fn, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: 5000 }, ...args);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    assert.fail(why + ' (waited 5 s for: ' + String(fn).replace(/\s+/g, ' ').slice(0, 160) + ')');
  }
}
// The same across a load of the page: a step of the history to an entry
// another document made may load it again, and a wait in the page is lost
// with the document it was in. Asked again until it holds or the time is out.
async function untilAcrossLoads(page, why, fn) {
  const end = Date.now() + 5000;
  for (;;) {
    try {
      if (await page.evaluate(fn)) return;
    } catch (error) {
      if (!/context was destroyed|navigat|detached/i.test(String(error.message))) throw error;
    }
    if (Date.now() > end) assert.fail(why + ' (waited 5 s for: ' + String(fn).replace(/\s+/g, ' ').slice(0, 160) + ')');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
const count = (page, selector) => page.$$eval(selector, (all) => all.length);
const activeKey = (page) => page.evaluate(() => (document.activeElement && document.activeElement.dataset.key) || null);
const keyIs = (page, key) => page.waitForFunction((wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.activeElement && document.activeElement.dataset.key === wanted, { timeout: 5000 }, key);
const slotField = (day, period, part) => '.sch-day[data-day="' + day + '"] tr[data-period="' + period + '"] [data-key="slot:' + day + ':' + period + ':' + (part || 'room') + '"]';
const slotRow = (day, period) => '.sch-day[data-day="' + day + '"] tr[data-period="' + period + '"]';
const closeToast = (page) => page.evaluate(() => document.querySelector('.toast__close')?.click());
// The box of what a selector finds, or null when it has none.
const box = (page, selector) => page.evaluate((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}, selector);
// Wait until what a selector finds is what a pointer at its middle would
// touch: nothing over it (the phone's inspector as it shuts, a message, a
// line stuck to the top of the section), and the page done drawing.
const reachable = (page, selector) => page.waitForFunction((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.getClientRects().length === 0 || document.querySelector('.sch')?.dataset.pending === 'true') return false;
  const rect = el.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return Boolean(hit) && el.contains(hit);
}, { timeout: 5000 }, selector);
// A finger's tap on the middle of what a selector finds, where it is now.
async function tapAt(page, selector) {
  await reachable(page, selector);
  const at = await box(page, selector);
  await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
}
// The same, brought to the middle of the window first (a phone's inspector
// handle and bottom bar are over its foot).
async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  await tapAt(page, selector);
}
// The phone's inspector opened or shut by its handle, and the page told so.
async function inspector(page, open) {
  await page.click('#inspector-toggle');
  await page.waitForFunction((wanted) => document.getElementById('inspector').dataset.open === wanted, { timeout: 5000 }, String(open));
}
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// What a slot holds in the store.
const stored = (page, groupId, day, period) => page.evaluate((g, d, p) => {
  const slot = globalThis.sv2.store.project.groups.find((group) => group.id === g).days[d][p];
  return { room: slot.room, roomText: slot.roomText };
}, groupId, day, period);
// A module of the tool put on the page as `globalThis.sv2modules[key]`, by a
// module script the page loads itself, and waited for: the page sets the
// key. An import() awaited inside page.evaluate came back "Protocol error
// (Runtime.callFunctionOn): Promise was collected" (SV2-72e: act's, on a page
// just opened at #movement, in 2 of 10 runs of this file with the CPU
// throttled 4 and the worker's answers late), so a module is loaded first
// and used in a synchronous evaluate after, as SV2-72a did in grid-pass.mjs.
// A load of the page empties the globals, and the module is loaded again.
async function loadModule(page, key, file) {
  const there = (wanted) => Boolean(globalThis.sv2modules && globalThis.sv2modules[wanted]);
  if (await page.evaluate(there, key)) return;
  await page.addScriptTag({ type: 'module', content: 'import * as module from ' + JSON.stringify('./' + file) + '; (globalThis.sv2modules ||= {})[' + JSON.stringify(key) + '] = module;' });
  await page.waitForFunction(there, { timeout: 5000 }, key);
}
async function act(page, name, payload) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await page.evaluate((action, given) => {
    globalThis.sv2.store.apply(globalThis.sv2modules.actions[action], given);
  }, name, payload);
}

// A page of its own for a case: the sample school, nothing saved.
async function open(hash, size, options) {
  const session = await openPlanner({ server, browser, hash, theme: 'light', ...size, ...(options || {}) });
  if (hash.startsWith('#schedule')) {
    await session.page.waitForFunction(() => getComputedStyle(document.querySelector('.sch')).containerType === 'inline-size');
    await settled(session.page);
  }
  return session;
}

// Run a case on its own page, and hold the page to having had no error. A
// case that failed is reported as it failed: what the page said is added to
// its message, and does not stand in for it (an assertion in a `finally`
// would, and the first thing to read would be the page's last complaint
// instead of the line that broke).
async function on(hash, size, run, options) {
  const session = await open(hash, size, options);
  let failed = null;
  try {
    await run(session.page, session);
  } catch (error) {
    failed = error;
  }
  const found = session.problems();
  await session.page.close().catch(() => {});
  if (failed) {
    const said = found.errors.concat(found.blocked, found.shimmed);
    if (said.length > 0 && failed instanceof Error) failed.message += '\n(and the page said: ' + said.join(' | ') + ')';
    throw failed;
  }
  assert.deepEqual(found, CLEAN);
}

before(async () => {
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// ---------------------------------------------------------------- 1 and 7: the stylesheets

test('index.html links the schedule, grid, import and movement stylesheets itself: each is loaded before its section is opened, and opening it adds no second copy', async () => {
  const page = source('index.html');
  for (const [href, name] of [['ui/schedule/schedule.css', 'schedule'], ['ui/schedule/grid/grid.css', 'grid'], ['ui/schedule/import/import.css', 'import'], ['ui/movement/movement.css', 'movement']]) {
    assert.ok(page.includes('<link rel="stylesheet" href="' + href + '" data-sheet="' + name + '">'), 'index.html has no link for ' + href);
  }
  await on('#project', DESK, async (p) => {
    const linked = () => p.evaluate(() => Object.fromEntries(['schedule', 'grid', 'import', 'movement'].map((name) => {
      const found = Array.from(document.querySelectorAll('link[data-sheet="' + name + '"]'));
      return [name, found.map((link) => [link.getAttribute('href'), link.parentNode === document.head, link.sheet ? link.sheet.cssRules.length > 5 : false])];
    })));
    const expected = {
      schedule: [['ui/schedule/schedule.css', true, true]],
      grid: [['ui/schedule/grid/grid.css', true, true]],
      import: [['ui/schedule/import/import.css', true, true]],
      movement: [['ui/movement/movement.css', true, true]],
    };
    assert.deepEqual(await linked(), expected, 'before any section asked for them');
    await go(p, '#schedule/import');
    await p.waitForSelector('.imp');
    await go(p, '#movement');
    await p.waitForFunction(() => document.querySelector('.mov')?.dataset.styled === 'true');
    assert.deepEqual(await linked(), expected, 'after the Import tab and the Movement section were opened');
  });
});

test('a page that does not link a section\'s stylesheet still gets it: the Import tab and the Movement section add their own', async () => {
  await on('#project', DESK, async (p) => {
    await p.evaluate(() => {
      for (const name of ['import', 'movement']) document.querySelector('link[data-sheet="' + name + '"]').remove();
    });
    await go(p, '#schedule/import');
    await shows(p, () => document.querySelector('link[data-sheet="import"]')?.sheet && getComputedStyle(document.querySelector('.imp-exports')).listStyleType === 'none');
    await go(p, '#movement');
    await shows(p, () => document.querySelector('link[data-sheet="movement"]')?.sheet && document.querySelector('.mov')?.dataset.styled === 'true');
    assert.equal(await count(p, 'link[data-sheet="import"]'), 1);
    assert.equal(await count(p, 'link[data-sheet="movement"]'), 1);
  });
});

test('a button that cannot be used yet is drawn dashed by the shell\'s stylesheet, on a page that has never opened the schedule', async () => {
  assert.match(source('ui/app.css'), /\.btn\[aria-disabled="true"\] \{\n {2}border-style: dashed;/);
  assert.doesNotMatch(source('ui/schedule/schedule.css'), /\.btn\[aria-disabled/);
  await on('#project', DESK, async (p) => {
    const drawn = await p.evaluate(() => {
      const button = document.createElement('button');
      button.className = 'btn';
      button.setAttribute('aria-disabled', 'true');
      button.textContent = 'Fix…';
      document.getElementById('section').append(button);
      const style = getComputedStyle(button);
      const got = [style.borderTopStyle, style.cursor];
      button.remove();
      return got;
    });
    assert.deepEqual(drawn, ['dashed', 'default']);
  });
});

test('where the Movement section sits in the shell is ui/app.css\'s to say, beside Building\'s, and the map is still edge to edge', async () => {
  assert.doesNotMatch(source('ui/movement/movement.css'), /\.surface__layout/, 'movement.css still places the section in the shell');
  // (SV2-55: the section's height is the surface's less the banners stuck to its top)
  assert.match(source('ui/app.css'), /\.surface__layout\[data-section="movement"\] \{\n {2}height: calc\(100% - var\(--banners-height, 0px\)\);\n {2}min-height: calc\(100% - var\(--banners-height, 0px\)\);\n {2}padding: 0;/);
  await on('#movement', DESK, async (p) => {
    await shows(p, () => document.querySelector('.mov')?.dataset.styled === 'true');
    const at = await p.evaluate(() => {
      const layout = getComputedStyle(document.querySelector('.surface__layout'));
      const surface = document.getElementById('surface').getBoundingClientRect();
      const section = document.querySelector('.mov').getBoundingClientRect();
      return { padding: layout.padding, grid: layout.backgroundImage, gap: layout.rowGap, left: Math.round(section.left - surface.left), top: Math.round(section.top - surface.top) };
    });
    assert.deepEqual(at, { padding: '0px', grid: 'none', gap: '0px', left: 0, top: 0 });
  });
});

// ---------------------------------------------------------------- 2 and 15: the toolbars

test('the Subjects toolbar exports the subjects CSV and goes to its import, and on Teachers and Subjects alike the two are buttons of one shape', async () => {
  await on('#schedule/subjects', DESK, async (p) => {
    // as they stand, with the pointer on neither
    const shape = async () => {
      await p.mouse.move(4, 4);
      return p.evaluate(shapeOf);
    };
    const shapeOf = () => {
      const of = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return [el.tagName, Math.round(rect.height), style.borderTopStyle, style.borderTopWidth, style.borderTopColor, style.backgroundColor, style.color, style.textDecorationLine, style.fontWeight, style.paddingLeft].join(' ');
      };
      const bar = document.querySelector('.sch [role="tabpanel"] .sch-toolbar');
      return { labels: Array.from(bar.children, (el) => el.firstChild.textContent), export: of(bar.querySelector('[data-action="export"]')), import: of(bar.querySelector('[data-action="import"]')), href: bar.querySelector('[data-action="import"]').getAttribute('href') };
    };
    const subjects = await shape();
    assert.deepEqual(subjects.labels, ['Add a subject', 'Export CSV', 'Import CSV…']);
    assert.equal(subjects.href, '#schedule/import');
    assert.equal(subjects.import.replace(/^A /, ''), subjects.export.replace(/^BUTTON /, ''), 'the link to the import is not the shape of the Export button');
    assert.match(subjects.import, / none /, 'the link is underlined like a link in a sentence');

    // the export: the file as it is handed to the browser
    await p.evaluate(() => {
      const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        blob.text().then((body) => {
          globalThis.sv2Exported = body;
        });
        return make(blob);
      };
    });
    await p.click('.sch-toolbar [data-action="export"]');
    await shows(p, () => typeof globalThis.sv2Exported === 'string');
    const csv = await p.evaluate(() => globalThis.sv2Exported);
    assert.match(csv, /Code,Subject,Colour\r\nMATH,Mathematics,#2a6f97\r\n/);
    assert.match(await text(p, '.toast .toast__text'), /^Saved Marrowby Middle School \(sample\) - subjects - \d{4}-\d\d-\d\d\.csv to your downloads\.$/);
    await closeToast(p);
    await p.click('.sch-toolbar [data-action="import"]');
    await shows(p, () => document.querySelector('.sch [role="tab"][aria-selected="true"]').textContent === 'Import');

    await go(p, '#schedule/teachers');
    await settled(p);
    const teachers = await shape();
    assert.deepEqual(teachers.labels, ['Add a teacher', 'Export CSV', 'Import CSV…']);
    assert.equal(teachers.import.replace(/^A /, ''), teachers.export.replace(/^BUTTON /, ''));
    assert.equal(teachers.export, subjects.export, 'the two tabs\' buttons differ');
  });
});

// ---------------------------------------------------------------- 3: a slot's address

test('a slot has an address: #schedule/groups/<group>/<day type>/<period> chooses the group, scrolls the row into view and puts the focus in its room field', async () => {
  await on('#schedule/groups/gsample07c/' + DAY_A + '/6', DESK, async (p) => {
    await keyIs(p, 'slot:' + DAY_A + ':6:room');
    assert.equal(await p.$eval('.sch-group[aria-selected="true"]', (el) => el.dataset.group), 'gsample07c');
    assert.equal(await text(p, '.sch-editor__title'), '7C');
    assert.equal(await p.$eval(slotRow(DAY_A, 6), (tr) => tr.dataset.shown), 'true');
    const row = await box(p, slotRow(DAY_A, 6));
    assert.ok(row.top >= 48 && row.bottom <= 800, 'the row is not in the window: ' + JSON.stringify(row));

    // the same section, another slot, with a filter that hides the group
    await p.click('[data-key="group-filter"]');
    await p.keyboard.type('6');
    await shows(p, () => document.querySelectorAll('.sch-group').length === 3);
    await go(p, '#schedule/groups/gsample08a/' + DAY_B + '/2');
    await keyIs(p, 'slot:' + DAY_B + ':2:room');
    assert.equal(await p.$eval('[data-key="group-filter"]', (el) => el.value), '', 'the filter that hid 8A is still on');
    assert.equal(await p.$eval('.sch-group[aria-selected="true"]', (el) => el.dataset.group), 'gsample08a');
    assert.equal(await count(p, '.sch-group'), 8);

    // from another tab of the section
    await go(p, '#schedule/day');
    await go(p, '#schedule/groups/' + C6 + '/' + DAY_A + '/1');
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    assert.equal(await text(p, '.sch-editor__title'), '6C');

    // a group alone is chosen; a group that is not there, a day type that is
    // not, and a period past the last leave the tab standing and mark nothing
    await go(p, '#schedule/groups/' + B6);
    await shows(p, () => document.querySelector('.sch-editor__title').textContent === '6B');
    for (const rest of ['gnobody0001/' + DAY_A + '/1', B6 + '/dnothing001/1', B6 + '/' + DAY_A + '/99', B6 + '/' + DAY_A + '/x']) {
      await go(p, '#schedule/groups/' + rest);
      await settled(p);
      assert.equal(await text(p, '.sch-editor__title'), '6B', rest);
      assert.equal(await count(p, '.sch-slot[data-shown="true"]'), 0, rest);
    }
  });
});

test('a day type that is the same as another has no rows of its own: its slot\'s address opens the row of the day it copies', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    await act(p, 'revertToBase', { dayTypeId: DAY_B });
    await settled(p);
    await go(p, '#schedule/groups/' + A7 + '/' + DAY_B + '/4');
    await keyIs(p, 'slot:' + DAY_A + ':4:room');
    assert.equal(await text(p, '.sch-editor__title'), '7A');
  });
});

test('the movement view\'s "Fix it in the schedule" goes to the slot\'s address, and the schedule opens it', async () => {
  await on('#movement', DESK, async (p) => {
    await shows(p, () => document.querySelector('.mov')?.dataset.styled === 'true');
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 2, slot: { room: null } });
    await p.click('#inspector [role="tab"][data-tab="summary"]');
    await p.waitForSelector('#inspector [data-summary="health"] [data-action="fix"]', { timeout: 15000 });
    await p.click('#inspector [data-summary="health"] [data-action="fix"]');
    await waitForSection(p, 'schedule');
    assert.equal(await p.evaluate(() => location.hash), '#schedule/groups/' + A7 + '/' + DAY_A + '/2');
    await keyIs(p, 'slot:' + DAY_A + ':2:room');
    assert.equal(await p.$eval('.sch-group[aria-selected="true"]', (el) => el.dataset.group), A7);
  });
});

// ---------------------------------------------------------------- 4: an undo under the cursor

test('with the cursor in a slot\'s room field, an undo restores the room, and leaving the field does not put the old text back over it', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 0);
    const was = await stored(p, A6, DAY_A, 0);
    assert.equal(await p.$eval(field, (el) => el.value), '201 — Ms. Oyelaran');

    // emptied, the cursor put in the field, the emptying undone
    await act(p, 'setSlot', { groupId: A6, dayTypeId: DAY_A, period: 0, slot: { room: null } });
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '', field);
    await p.focus(field);
    await p.evaluate(() => globalThis.sv2.store.undo());
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '201 — Ms. Oyelaran', field);
    assert.equal(await activeKey(p), 'slot:' + DAY_A + ':0:room', 'the cursor is still in the field');
    // left by Tab
    await p.keyboard.press('Tab');
    await settled(p);
    assert.equal(await p.$eval(field, (el) => el.value), '201 — Ms. Oyelaran', 'leaving the field emptied it again');
    assert.deepEqual(await stored(p, A6, DAY_A, 0), was);

    // the other way about: the room taken away under the cursor stays away
    await p.focus(field);
    await act(p, 'setSlot', { groupId: A6, dayTypeId: DAY_A, period: 0, slot: { room: null } });
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '', field);
    await p.keyboard.press('Tab');
    await settled(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), { room: null, roomText: '' }, 'leaving the field put the old room back');

    // and left by going to another tab, with the undo under the cursor
    await p.focus(field);
    await p.evaluate(() => globalThis.sv2.store.undo());
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '201 — Ms. Oyelaran', field);
    await go(p, '#schedule/teachers');
    await settled(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), was, 'going to another tab emptied the slot again');
  });
});

test('text that is being typed is still carried across a redraw, caret and all', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 0);
    await p.click(field);
    await p.keyboard.type('Port');
    // something else changes the project while the word is half typed
    await act(p, 'editGroup', { id: B6, grade: '6x' });
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-group[data-group="gsample06b"] .sch-group__grade').textContent.includes('6x'));
    assert.equal(await activeKey(p), 'slot:' + DAY_A + ':0:room');
    assert.deepEqual(await p.$eval(field, (el) => [el.value, el.selectionStart, el.selectionEnd]), ['Port', 4, 4]);
    await p.keyboard.type('able 9');
    assert.equal(await p.$eval(field, (el) => el.value), 'Portable 9');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------- 5: a read-only picker

test('a picker whose field is read only neither opens its list nor picks from it', async () => {
  await on('#schedule/teachers', DESK, async (p) => {
    const first = await p.evaluate(() => globalThis.sv2.store.project.teachers[0].id);
    const field = '[data-key="teacher:' + first + ':room"]';
    const rooms = () => p.evaluate(() => globalThis.sv2.store.project.teachers[0].roomIds.length);
    const had = await rooms();
    const expanded = () => p.$eval(field, (el) => el.getAttribute('aria-expanded') + '|' + el.parentNode.querySelector('.picker__list').hidden);

    await p.$eval(field, (el) => {
      el.readOnly = true;
    });
    await p.click(field);
    assert.equal(await expanded(), 'false|true', 'a click opened the list of a read-only field');
    await p.keyboard.press('ArrowDown');
    assert.equal(await expanded(), 'false|true', 'the Down arrow opened the list of a read-only field');
    await p.keyboard.press('Enter');
    await settled(p);
    assert.equal(await rooms(), had);

    // open, a room under the cursor of the list, then made read only: Enter picks nothing
    await p.$eval(field, (el) => {
      el.readOnly = false;
    });
    await p.keyboard.press('ArrowDown');
    assert.equal(await expanded(), 'true|false', 'the list of a field that can be typed in opens');
    assert.equal(await p.$eval(field, (el) => Boolean(el.getAttribute('aria-activedescendant'))), true);
    await p.$eval(field, (el) => {
      el.readOnly = true;
    });
    await p.keyboard.press('Enter');
    await settled(p);
    assert.equal(await rooms(), had, 'Enter picked a room into a read-only field');
    assert.equal(await expanded(), 'false|true');
    // a press on an option is the same
    await p.$eval(field, (el) => {
      el.readOnly = false;
    });
    await p.keyboard.press('ArrowDown');
    await p.$eval(field, (el) => {
      el.readOnly = true;
      el.parentNode.querySelector('.picker__option').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    await settled(p);
    assert.equal(await rooms(), had, 'a press on an option picked into a read-only field');

    // and it picks again once it can be typed in
    await p.$eval(field, (el) => {
      el.readOnly = false;
    });
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await shows(p, (n) => globalThis.sv2.store.project.teachers[0].roomIds.length === n + 1, had);
  });
});

// ---------------------------------------------------------------- 6: a long message

const LONG = 'Imported “Marrowby Middle School (sample) - teachers - 2026-09-01.csv”: 14 teachers added, 3 teachers changed, 2 rows left out because they had no name.';

test('a long message wraps on a 390 px phone and stays inside the surface', async () => {
  await on('#schedule/teachers', PHONE, async (p) => {
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words, action: { label: 'Undo', run: () => {} } }), LONG);
    const at = await p.evaluate(() => {
      const toast = document.querySelector('.toast').getBoundingClientRect();
      const surface = document.getElementById('surface').getBoundingClientRect();
      const words = document.querySelector('.toast__text');
      return { left: toast.left, right: toast.right, top: toast.top, bottom: toast.bottom, surface: [surface.left, surface.right, surface.top, surface.bottom], lines: Math.round(words.getBoundingClientRect().height / parseFloat(getComputedStyle(words).lineHeight)), cut: words.scrollWidth > words.clientWidth + 1 };
    });
    assert.ok(at.left >= at.surface[0] && at.right <= at.surface[1], 'the message runs past the side of the surface: ' + JSON.stringify(at));
    assert.ok(at.top >= at.surface[2] && at.bottom <= at.surface[3] + 1, 'the message runs past the top or the foot of the surface: ' + JSON.stringify(at));
    assert.ok(at.lines >= 3, 'the words are on ' + at.lines + ' lines');
    assert.equal(at.cut, false, 'the words are cut off');
  });
});

// With the map at its full width (Getting started put away): the message is
// 34rem at most, so it does not run along the foot of the map to the legend
// in its right-hand corner. Beside the Getting started card the map is 512 px
// wide and no width of message clears the legend: that is the movement
// view's own to settle (it docks the legend, DECISIONS 2026-10-12 12:55).
test('a long message is at most 34rem wide: on the movement view it does not span the foot of the map to the legend', async () => {
  await on('#movement', DESK, async (p) => {
    await act(p, 'setOnboarding', { dismissed: true });
    await shows(p, () => document.getElementById('getting-started').hidden && document.querySelector('.mov')?.dataset.styled === 'true' && document.querySelector('.mov-legend') && !document.querySelector('.mov-legend').hidden);
    // the map drawn, the legend with it (what movementDrawn of screens.mjs waits for)
    await shows(p, () => {
      const section = document.querySelector('.mov');
      const movement = section.movement;
      return section.dataset.pending !== 'true' && movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && Number(movement.canvas.dataset.drawn || 0) > 0;
    });
    await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words, action: { label: 'Undo', run: () => {} } }), LONG);
    const toast = await box(p, '.toast');
    const legend = await box(p, '.mov-legend');
    const surface = await box(p, '#surface');
    assert.ok(toast.width <= 34 * 16 + 1, 'the message is ' + toast.width + ' px wide');
    assert.ok(toast.height > 60, 'the message did not wrap');
    assert.ok(surface.right - toast.right > 200, 'the message runs along the whole foot of the surface');
    assert.equal(overlap(toast, legend), false, 'the message lies on the legend: ' + JSON.stringify({ toast, legend }));
  });
});

// ---------------------------------------------------------------- 8: Getting started, the tabs, the message

const tabTops = (page) => page.$$eval('.sch > .tabs > .tabs__list > [role="tab"]', (all) => Array.from(new Set(all.map((tab) => Math.round(tab.getBoundingClientRect().top)))));

test('on Schedule the Getting started card is under the schedule card at full width, the seven tabs are one row above 900 px, and the Teachers table is not clipped', async () => {
  await on('#schedule/teachers', DESK, async (p) => {
    const card = await box(p, '.sch');
    const started = await box(p, '#getting-started');
    assert.ok(started, 'the sample school shows Getting started');
    assert.ok(card.width >= 800, 'the schedule card is ' + card.width + ' px wide on a 1280 px screen');
    assert.ok(started.top >= card.bottom, 'Getting started is not under the schedule card');
    assert.equal(Math.round(started.left), Math.round(card.left));
    assert.equal(Math.round(started.width), Math.round(card.width), 'Getting started is not the width of the schedule card');
    assert.equal((await tabTops(p)).length, 1, 'the tabs are on more than one row at 1280 px');
    const clipped = await p.$eval('.sch-teachers .sch-scroll', (el) => el.scrollWidth - el.clientWidth);
    assert.ok(clipped <= 0, 'the Teachers table is ' + clipped + ' px wider than its card');
    const rooms = await p.$$eval('.sch-edit-table tbody tr td:nth-child(3)', (all) => all.map((cell) => cell.getBoundingClientRect().right));
    assert.ok(rooms.every((right) => right <= card.right), 'a Rooms cell runs past the card');
    // its steps lie side by side, since the card is wide
    const stepTops = await p.$$eval('#getting-started .steps__step', (all) => Array.from(new Set(all.map((step) => Math.round(step.getBoundingClientRect().top)))));
    assert.ok(stepTops.length < 5, 'the five steps are still one under another');

    // narrower, down to where the rail folds: still one row
    for (const width of [1100, 1001, 960, 901]) {
      await p.setViewport({ width, height: 800, deviceScaleFactor: 1 });
      await shows(p, (w) => window.innerWidth === w, width);
      assert.equal((await tabTops(p)).length, 1, 'the tabs are on more than one row at ' + width + ' px');
      const last = await p.$eval('.sch > .tabs > .tabs__list', (list) => list.lastElementChild.getBoundingClientRect().right - list.getBoundingClientRect().right);
      assert.ok(last <= 1, 'the last tab is ' + last + ' px out of the row at ' + width + ' px');
    }
    // and with the reader's own larger type, which no padding makes room
    // for, the row scrolls sideways before it wraps
    await p.evaluate(() => {
      document.documentElement.style.fontSize = '24px';
    });
    assert.equal((await tabTops(p)).length, 1, 'the tabs wrap at 901 px in 24 px type');
    const row = await p.$eval('.sch > .tabs > .tabs__list', (list) => [list.scrollWidth > list.clientWidth, getComputedStyle(list).overflowX]);
    assert.deepEqual(row, [true, 'auto'], 'the row of tabs does not scroll');
  });
});

test('the Building section keeps Getting started beside the plan, and the Staff browser has it under the preview', async () => {
  await on('#building', DESK, async (p) => {
    const plan = await box(p, '#section');
    const started = await box(p, '#getting-started');
    assert.ok(started.left >= plan.right - 1 && started.top < plan.bottom, 'on Building the card is not beside the plan: ' + JSON.stringify({ plan, started }));
    await go(p, '#staff');
    const section = await box(p, '#section');
    const under = await box(p, '#getting-started');
    assert.ok(under.top >= section.bottom, 'on the Staff browser the card is not under the section');
    assert.equal(Math.round(under.width), Math.round(section.width));
  });
});

// The message a table's own action brings, with the page at its end: not on
// the table's last row.
async function lastRowClear(p, what) {
  await p.waitForSelector('.toast');
  const read = () => {
    const rows = document.querySelectorAll('.sch-edit-table tbody tr');
    const row = rows[rows.length - 1].getBoundingClientRect();
    const toast = document.querySelector('.toast').getBoundingClientRect();
    const surface = document.getElementById('surface').getBoundingClientRect();
    return { row: [row.top, row.bottom], toast: [toast.top, toast.bottom], surface: [surface.top, surface.bottom] };
  };
  // The page moves for the message a moment after it shows. The wait is for
  // where the row and the message are, not for a count of frames; when the
  // time runs out the assertions below say where they were left.
  const clear = '(() => { const at = (' + read + ')(); return at.row[1] <= at.toast[0] && at.row[0] >= at.surface[0] && at.toast[1] <= at.surface[1] + 1; })()';
  const where = await p.waitForFunction(clear, { timeout: 5000 }).then(() => null, (error) => {
    if (error.name !== 'TimeoutError') throw error;
    return p.evaluate(read);
  });
  assert.equal(where, null, what + ': the message and the last row never came apart: ' + JSON.stringify(where));
  const at = await p.evaluate(read);
  assert.ok(at.row[1] <= at.toast[0], what + ': the message lies on the last row of the table: ' + JSON.stringify(at));
  assert.ok(at.row[0] >= at.surface[0] && at.toast[1] <= at.surface[1] + 1, what + ': the last row or the message is out of the surface: ' + JSON.stringify(at));
}

for (const [name, size] of [['1280 px', DESK], ['a 390 px phone', PHONE]]) {
  test('a message about the Teachers table never lies on its last row, at ' + name, async () => {
    await on('#schedule/teachers', size, async (p) => {
      const toEnd = () => p.evaluate(() => {
        const surface = document.getElementById('surface');
        surface.scrollTop = surface.scrollHeight;
      });
      // Getting started dismissed, from wherever it is at this width
      await p.evaluate(() => document.querySelector('#getting-started [data-action="dismiss"]').click());
      assert.equal(await text(p, '.toast .toast__text'), 'Getting started is hidden. Help brings it back.');
      await toEnd();
      await lastRowClear(p, 'Getting started hidden');
      await closeToast(p);

      // the last teacher deleted, with the page at its end
      await toEnd();
      const last = await p.evaluate(() => {
        const teachers = globalThis.sv2.store.project.teachers;
        return teachers[teachers.length - 1];
      });
      await p.evaluate((id) => document.querySelector('[data-key="teacher:' + id + ':delete"]').click(), last.id);
      await shows(p, (n) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-edit-table tbody tr').length === n, 11);
      assert.equal(await text(p, '.toast .toast__text'), 'Deleted teacher ' + last.name + '.');
      await lastRowClear(p, 'a teacher deleted');
      // the page can go no further down, and the row is still clear
      await toEnd();
      await lastRowClear(p, 'at the very end');
      await closeToast(p);

      // a message of several lines is taller than the band the page ends in: the band grows for it
      await toEnd();
      await p.evaluate((words) => globalThis.sv2.ctx.toast({ text: words + ' ' + words, action: { label: 'Undo', run: () => {} } }), LONG);
      const tall = await box(p, '.toast');
      assert.ok(tall.height > 76, 'the message is not taller than the band: ' + tall.height);
      await lastRowClear(p, 'a tall message');
    });
  });
}

// ---------------------------------------------------------------- 9: a room that is not in the building

test('the group editor keeps a room number that is not in the building, as typed: on Enter and on leaving the field, with the line under it and the finding', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const warnings = () => p.$eval('#inspector .sch-counts', (el) => Number(el.dataset.warning));
    const before = await warnings();
    const first = slotField(DAY_A, 0);
    const line = (period) => p.$eval(slotRow(DAY_A, period) + ' .sch-room__missing', (el) => (el.hidden ? null : el.textContent));

    // as it is typed: the line under the field says what will happen, and the field is marked
    await p.click(first);
    await p.keyboard.type('Portable 9');
    assert.equal(await text(p, slotRow(DAY_A, 0) + ' .sch-room__line'), 'No room matches. It is kept as typed, and marked as not in the building.');
    assert.equal(await p.$eval(first, (el) => el.classList.contains('sch-room--missing')), true, 'the field is not marked as it is typed');
    // Enter keeps it
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector + ' .sch-finding-line--warning') !== null, slotRow(DAY_A, 0));
    assert.equal(await p.$eval(first, (el) => el.value), 'Portable 9');
    assert.equal(await p.$eval(first, (el) => el.getAttribute('aria-invalid')), null, 'the text is refused');
    assert.equal(await count(p, '.sch-room .field__refusal'), 0);
    assert.equal(await line(0), '▲ Not in the building. It is kept as typed.');
    assert.equal(await p.$eval(first, (el) => el.classList.contains('sch-room--missing')), true);
    assert.match(await p.$eval(first, (el) => el.getAttribute('aria-describedby')), /-missing/);
    assert.match(await text(p, slotRow(DAY_A, 0) + ' .sch-finding-line--warning'), /6A is scheduled into "Portable 9" in Period 1 on A Day, and that room is not in the building/);
    assert.equal(await warnings(), before + 1);
    assert.equal(await activeKey(p), 'slot:' + DAY_A + ':0:room', 'the cursor left the field');
    assert.deepEqual(await stored(p, A6, DAY_A, 0), { room: null, roomText: 'Portable 9' });
    assert.equal(await p.$eval('.sch-group[aria-selected="true"] .sch-bar[data-day="' + DAY_A + '"]', (el) => el.dataset.done), '8', 'it still counts as entered');

    // leaving the field keeps it too, and a number is never turned into another: "10" is not Room 101
    await p.click(slotField(DAY_A, 1));
    await p.keyboard.type('10');
    assert.ok((await count(p, slotRow(DAY_A, 1) + ' .picker__option')) >= 3, 'rooms 101, 102 and 103 are offered');
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '10', slotField(DAY_A, 1));
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: null, roomText: '10' });
    assert.equal(await line(1), '▲ Not in the building. It is kept as typed.');

    // not even when one room alone has the typed text in its number: "Gy" is not the Gym
    await p.click(slotField(DAY_A, 4));
    await p.keyboard.type('Gy');
    assert.deepEqual(await p.$$eval(slotRow(DAY_A, 4) + ' .picker__option', (all) => all.map((el) => el.firstChild.textContent)), ['Gym — Coach Dunmore']);
    await p.keyboard.press('Escape');
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === 'Gy' && !document.querySelector(selector).parentNode.querySelector('.sch-room__missing').hidden, slotField(DAY_A, 4));
    assert.deepEqual(await stored(p, A6, DAY_A, 4), { room: null, roomText: 'Gy' });

    // a room's own number is that room, and a teacher's name that names one room is that room
    await p.click(slotField(DAY_A, 2));
    await p.keyboard.type('102');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '102 — Mr. Brightwater', slotField(DAY_A, 2));
    assert.equal(await line(2), null);
    await p.click(slotField(DAY_A, 3));
    await p.keyboard.type('dufr');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '204 — Mme. Dufrêne', slotField(DAY_A, 3));

    // Escape puts back what was there, the kept text and its line included
    await p.click(first);
    await p.keyboard.type('zzz');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval(first, (el) => el.value), 'Portable 9');
    assert.equal(await line(0), '▲ Not in the building. It is kept as typed.');
    // emptied, it is no room at all
    await p.keyboard.down('Control');
    await p.keyboard.press('a');
    await p.keyboard.up('Control');
    await p.keyboard.press('Backspace');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '' && document.querySelector(selector).closest('tr').querySelector('.sch-finding-line--warning') === null, first);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), { room: null, roomText: '' });
    assert.equal(await line(0), null);
  });
});

test('with no rooms in the building the picker\'s one line says so and goes to Building, and what is typed is kept', async () => {
  await on('#project', DESK, async (p) => {
    await p.click('#sample-school [data-action="sample"]');
    await shows(p, () => document.getElementById('sample-chip').hidden);
    await closeToast(p);
    await goSettled(p, '#schedule/groups');
    await p.click('[data-action="add-group"]');
    await keyIs(p, 'group-name');
    const day = await p.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id);
    const group = await p.evaluate(() => globalThis.sv2.store.project.groups[0].id);
    const field = slotField(day, 0);
    await p.click(field);
    const line = slotRow(day, 0) + ' .sch-room__line';
    assert.equal(await box(p, slotRow(day, 0) + ' .picker__list'), null, 'a list is drawn with nothing in it to pick');
    assert.equal(await text(p, line), 'No rooms in the building yet. Number them in Building.');
    assert.equal(await p.$eval(line + ' a', (a) => a.getAttribute('href')), '#building');
    await p.keyboard.type('B12');
    assert.equal(await text(p, line), 'No rooms in the building yet. Number them in Building.');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === 'B12', field);
    assert.deepEqual(await stored(p, group, day, 0), { room: null, roomText: 'B12' });
    // the line's link, pressed
    await p.click(slotField(day, 1));
    await p.waitForSelector(slotRow(day, 1) + ' .sch-room__line a');
    await p.click(slotRow(day, 1) + ' .sch-room__line a');
    await waitForSection(p, 'building');
  });
});

// ---------------------------------------------------------------- 10: the list of groups is one Tab stop

test('the list of groups is a listbox and one Tab stop: from the filter box, Duplicate is two Tabs away, and the arrows, Home, End, Enter and Space work it', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const stops = () => p.$$eval('.sch-groups__list [role="option"]', (all) => all.filter((each) => each.tabIndex === 0).map((each) => each.dataset.group));
    assert.equal(await p.$eval('.sch-groups__list', (el) => el.getAttribute('role') + '|' + el.getAttribute('aria-label')), 'listbox|Groups');
    assert.equal(await count(p, '.sch-groups__list > [role="option"]'), 8);
    assert.equal(await count(p, '.sch-groups__list button'), 0, 'a group is still a button of its own');
    assert.deepEqual(await p.$$eval('.sch-groups__list [role="option"]', (all) => all.filter((each) => each.getAttribute('aria-selected') === 'true').map((each) => each.dataset.group)), [A6]);
    assert.deepEqual(await stops(), [A6]);

    await p.focus('[data-key="group-filter"]');
    await p.keyboard.press('Tab');
    assert.equal(await activeKey(p), 'group:' + A6);
    await p.keyboard.press('Tab');
    assert.equal(await activeKey(p), 'group-duplicate', 'the second Tab from the filter box');
    await p.keyboard.down('Shift');
    await p.keyboard.press('Tab');
    await p.keyboard.up('Shift');
    assert.equal(await activeKey(p), 'group:' + A6);

    // the arrows move the focus and choose nothing
    await p.keyboard.press('ArrowDown');
    assert.equal(await activeKey(p), 'group:' + B6);
    assert.equal(await text(p, '.sch-editor__title'), '6A');
    assert.deepEqual(await stops(), [B6], 'the Tab stop did not follow the focus');
    await p.keyboard.press('End');
    assert.equal(await activeKey(p), 'group:gsample08b');
    await p.keyboard.press('ArrowDown');
    assert.equal(await activeKey(p), 'group:gsample08b', 'Down at the end');
    await p.keyboard.press('Home');
    assert.equal(await activeKey(p), 'group:' + A6);
    await p.keyboard.press('ArrowUp');
    assert.equal(await activeKey(p), 'group:' + A6, 'Up at the start');
    // Enter chooses, and the focus is on the same group after the tab is drawn again
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '6C');
    assert.equal(await activeKey(p), 'group:' + C6);
    assert.deepEqual(await stops(), [C6]);
    assert.equal(await p.$eval('.sch-group[data-group="gsample06c"]', (el) => el.getAttribute('aria-selected')), 'true');
    // Space too
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press(' ');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '7A');
    assert.equal(await activeKey(p), 'group:' + A7);
    // and from there the editor is one Tab away
    await p.keyboard.press('Tab');
    assert.equal(await activeKey(p), 'group-duplicate');

    // a filter that hides the chosen group leaves the list one Tab stop still
    await p.click('[data-key="group-filter"]');
    await p.keyboard.type('8');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-group').length === 2);
    assert.deepEqual(await stops(), ['gsample08a']);
    await p.keyboard.press('Tab');
    assert.equal(await activeKey(p), 'group:gsample08a');
  });
});

// ---------------------------------------------------------------- 11: a finding's buttons on a phone

const findingBoxes = (page) => page.$$eval('.sch-checks .sch-findings:not(.sch-findings--accepted) tbody tr', (rows) => rows.map((row) => {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  return { what: rect(row.querySelector('.sch-finding__what')), buttons: Array.from(row.querySelectorAll('.sch-finding__actions > *'), (button) => ({ label: button.firstChild.textContent, ...rect(button) })) };
}));

test('on a 390 px phone a finding\'s Show, Fix… and Accept are under its sentence and inside the card; on a wide screen they are beside it', async () => {
  await on('#schedule/checks', PHONE, async (p) => {
    const card = await box(p, '.sch');
    const rows = await findingBoxes(p);
    assert.equal(rows.length, 4);
    // SV2-70: Fix… on the two findings the suggestion engine can work on (the clash and the walk), none on the two notes
    assert.deepEqual(rows.map((row) => row.buttons.map((button) => button.label).join(' ')), ['Show Fix… Accept', 'Show Fix… Accept', 'Show Accept', 'Show Accept']);
    for (const row of rows) {
      for (const button of row.buttons) {
        assert.ok(button.left >= card.left && button.right <= card.right, button.label + ' runs out of the card: ' + JSON.stringify({ button, card }));
        assert.ok(button.right <= 390, button.label + ' runs off the phone');
        assert.ok(button.top >= row.what.bottom, button.label + ' is not under the sentence');
      }
    }
    const scroll = await p.$eval('.sch-checks .sch-scroll', (el) => el.scrollWidth - el.clientWidth);
    assert.ok(scroll <= 0, 'the findings table scrolls sideways by ' + scroll + ' px');
  });
  await on('#schedule/checks', DESK, async (p) => {
    for (const row of await findingBoxes(p)) {
      for (const button of row.buttons) assert.ok(button.left >= row.what.right && button.top < row.what.bottom, button.label + ' is not beside the sentence at 1280 px');
    }
  });
});

// ---------------------------------------------------------------- 12 and 17: the Groups tab on a phone

test('on a 390 px phone the list of groups and the editor take turns: a tap on 6B folds the list to its card and its Name field is in the window; the inspector says to choose a group until one is', async () => {
  await on('#schedule/groups', PHONE, async (p) => {
    // in one turn of the page: found and then asked in two, a card of a list drawn again in between has left the page and has no box
    const cards = () => p.evaluate(() => Array.from(document.querySelectorAll('.sch-group')).filter((each) => each.getClientRects().length > 0).map((each) => each.dataset.group));
    // nothing chosen yet: every card, no editor, and the inspector says so
    assert.equal((await cards()).length, 8);
    assert.equal(await box(p, '.sch-editor'), null, 'the editor is on the page under the whole list');
    assert.equal(await box(p, '[data-key="group-all"]'), null);
    await inspector(p, true);
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'Choose a group');
    assert.equal(await text(p, '#inspector .sch-panel__none'), 'Choose a group in the list, and what was found about it shows here.');
    assert.equal(await count(p, '#inspector .sch-finding'), 0);
    assert.deepEqual(await p.$eval('#inspector .sch-counts', (el) => [el.dataset.problem, el.dataset.warning, el.dataset.note]), ['1', '1', '2'], 'the counts are always there');
    await inspector(p, false);

    // a tap on 6B, with its card at the foot of the window: the editor that
    // opens under it would be out of sight if the card stayed there. (The
    // inspector is a sheet over the lower half of a phone and has only just
    // been shut: the tap waits for the card to be what is under the finger.)
    await p.$eval('.sch-group[data-group="' + B6 + '"]', (el) => el.scrollIntoView({ block: 'end' }));
    const card = await box(p, '.sch-group[data-group="' + B6 + '"]');
    assert.ok(card.bottom > 560, 'the card is not at the foot of the window');
    await tapAt(p, '.sch-group[data-group="' + B6 + '"]');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '6B' && document.querySelector('.sch-editor').getClientRects().length > 0);
    assert.deepEqual(await cards(), [B6], 'the list is not folded to the group that was tapped');
    const name = await p.evaluate(() => {
      const field = document.querySelector('[data-key="group-name"]');
      const rect = field.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { top: rect.top, bottom: rect.bottom, value: field.value, onTop: hit === field };
    });
    assert.equal(name.value, '6B');
    assert.ok(name.top >= 0 && name.bottom <= 760, 'the Name field is out of the window: ' + JSON.stringify(name));
    assert.equal(name.onTop, true, 'the Name field is under something');
    const all = await box(p, '[data-key="group-all"]');
    const chosen = await box(p, '.sch-group[data-group="' + B6 + '"]');
    assert.ok(all && all.top >= chosen.bottom && all.bottom <= name.top, '"All groups" is not between the card and the editor');
    assert.equal(await box(p, '[data-key="group-filter"]'), null, 'the filter box is still there with one card showing');
    await inspector(p, true);
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'About 6B');
    await inspector(p, false);

    // All groups: the cards again, the cursor on the one that was open
    await p.evaluate(() => document.querySelector('[data-key="group-all"]').click());
    await keyIs(p, 'group:' + B6);
    assert.equal((await cards()).length, 8);
    assert.equal(await box(p, '.sch-editor'), null);

    // the first card, tapped where the tab opens with the page at its top:
    // its editor would start under the foot of the window if the card stayed put
    await p.evaluate(() => {
      document.getElementById('surface').scrollTop = 0;
    });
    const top = await box(p, '.sch-group[data-group="' + A6 + '"]');
    // (SV2-55: with touch emulated as asked, the 44 px targets put the card at 594 to 678)
    assert.ok(top.top > 380 && top.bottom < 760, 'the first card is not in the lower half of the window: ' + JSON.stringify(top));
    await tapAt(p, '.sch-group[data-group="' + A6 + '"]');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '6A' && document.querySelector('.sch-editor').getClientRects().length > 0);
    const first = await p.evaluate(() => {
      const field = document.querySelector('[data-key="group-name"]');
      const rect = field.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { top: rect.top, bottom: rect.bottom, onTop: hit === field, card: document.querySelector('.sch-group[aria-selected="true"]').getBoundingClientRect().top };
    });
    assert.equal(first.onTop, true, 'the Name field of the first card tapped is under the foot of the window: ' + JSON.stringify(first));
    assert.ok(first.card < 200, 'the card that was tapped was not brought to the top: ' + JSON.stringify(first));

    // a slot's address, and Show on a finding, open the editor
    await go(p, '#schedule/groups/' + C6 + '/' + DAY_A + '/1');
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    assert.deepEqual(await cards(), [C6]);
  });
});

test('on a wide screen the list and the editor are side by side as before, and the inspector is about the group', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    assert.equal(await count(p, '.sch-group'), 8);
    const list = await box(p, '.sch-groups__list');
    const editor = await box(p, '.sch-editor');
    assert.ok(editor && editor.left >= list.right, 'the editor is not beside the list');
    assert.equal(await box(p, '[data-key="group-all"]'), null, '"All groups" shows on a wide screen');
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'About 6A');
    await p.click('.sch-group[data-group="' + B6 + '"]');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '6B');
    assert.equal(await count(p, '.sch-group'), 8);
    assert.equal((await p.$$eval('.sch-group', (all) => all.filter((each) => each.getClientRects().length > 0).length)), 8, 'choosing a group hid the others on a wide screen');
    assert.ok(await box(p, '[data-key="group-filter"]'));
  });
});

// ---------------------------------------------------------------- 13: the inspector beside the Checks tab

test('beside the Checks tab the inspector does not repeat its table: the counts, one line saying where the list is, and the finding selected', async () => {
  await on('#schedule/checks', DESK, async (p) => {
    assert.equal(await count(p, '.sch-checks .sch-findings:not(.sch-findings--accepted) tbody tr'), 4);
    assert.equal(await count(p, '#inspector .sch-finding'), 0, 'the inspector lists the findings beside the table of them');
    assert.deepEqual(await p.$eval('#inspector .sch-counts', (el) => [el.dataset.problem, el.dataset.warning, el.dataset.note]), ['1', '1', '2']);
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'No finding selected');
    assert.equal(await text(p, '#inspector [data-note="list"]'), 'Every finding is in the list on the left. Select one there to see it here.');

    // a click on a row selects it
    const id = await p.$eval('.sch-checks .sch-findings tbody tr[data-severity="warning"]', (row) => row.dataset.finding);
    await p.click('.sch-checks .sch-findings tbody tr[data-severity="warning"] .sch-finding__what');
    await shows(p, () => document.querySelectorAll('#inspector .sch-finding').length === 1);
    assert.equal(await p.$eval('#inspector .sch-finding', (el) => el.dataset.finding), id);
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'The finding selected');
    assert.equal(await text(p, '#inspector [data-note="list"]'), 'Every finding is in the list on the left.');
    assert.deepEqual(await p.$$eval('.sch-checks .sch-findings tbody tr[data-selected="true"]', (all) => all.map((row) => row.dataset.finding)), [id]);
    // the focus coming to another row's button selects that one
    await p.focus('.sch-checks .sch-findings tbody tr[data-severity="problem"] [data-action="show"]');
    await shows(p, () => document.querySelector('#inspector .sch-finding')?.classList.contains('sch-finding--problem'));
    assert.equal(await count(p, '#inspector .sch-finding'), 1);
    assert.equal(await count(p, '.sch-checks .sch-findings tbody tr[data-selected="true"]'), 1);
    // it is still selected after the tab is drawn again
    await act(p, 'editGroup', { id: B6, grade: '6x' });
    await settled(p);
    assert.equal(await p.$eval('.sch-checks .sch-findings tbody tr[data-selected="true"]', (row) => row.dataset.severity), 'problem');
    assert.equal(await count(p, '#inspector .sch-finding'), 1);

    // beside any other tab the inspector lists them, as before
    await go(p, '#schedule/teachers');
    await settled(p);
    assert.equal(await count(p, '#inspector .sch-finding'), 4);
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'In the whole schedule');
  });
});

// ---------------------------------------------------------------- 14: Fix… opens its dialog
// (SV2-70: Fix… is built, so these two cases moved from a press that said
// "Suggestions are not built yet" to a press that opens the Fix dialog; the
// dialog's own cases are test/browser/fix.mjs)

test('Fix… is a working button: drawn solid, its title says what it does, and a press opens the Fix dialog, by pointer and by keyboard', async () => {
  await on('#schedule/checks', DESK, async (p) => {
    const fix = '.sch-checks .sch-findings tbody tr [data-action="fix"]';
    assert.equal(await p.$eval(fix, (el) => [el.getAttribute('aria-disabled'), el.title, el.disabled, getComputedStyle(el).borderTopStyle].join('|')), '|Small changes that would clear this, to try in a scenario|false|solid');
    const opened = async (hash) => {
      await p.waitForSelector('#fix-dialog[open]');
      assert.equal(await p.evaluate(() => location.hash), hash, 'the press stays where it is');
      assert.equal(await count(p, '.toast'), 0);
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => !document.querySelector('dialog[open]'));
    };
    await p.click(fix);
    await opened('#schedule/checks');
    await p.focus(fix);
    await p.keyboard.press('Enter');
    await opened('#schedule/checks');
    // the inspector's Fix… too
    await go(p, '#schedule/teachers');
    await settled(p);
    await p.focus('#inspector [data-action="fix"]');
    await p.keyboard.press(' ');
    await opened('#schedule/teachers');
  });
});

test('Fix… opens its dialog to a finger too', async () => {
  await on('#schedule/checks', PHONE, async (p) => {
    await tap(p, '.sch-checks .sch-findings tbody tr [data-action="fix"]');
    await p.waitForSelector('#fix-dialog[open]');
    assert.equal(await count(p, '.toast'), 0);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'));
  });
});

// ---------------------------------------------------------------- 18: where the keyboard lands

test('"Add a group" by keyboard puts the focus in Name with "New group" selected, and "Add a teacher" puts it in the new row\'s Name', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    await p.focus('[data-key="group-add"]');
    await p.keyboard.press('Enter');
    await keyIs(p, 'group-name');
    assert.deepEqual(await p.evaluate(() => {
      const field = document.activeElement;
      return [field.value, field.selectionStart, field.selectionEnd];
    }), ['New group', 0, 9]);
    assert.equal(await text(p, '.sch-editor__title'), 'New group');
    // typing replaces the name
    await p.keyboard.type('8Z');
    await p.keyboard.press('Enter');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector('.sch-editor__title').textContent === '8Z');

    await go(p, '#schedule/teachers');
    await settled(p);
    await p.focus('[data-key="teacher-add"]');
    await p.keyboard.press('Enter');
    const added = await p.evaluate(() => {
      const teachers = globalThis.sv2.store.project.teachers;
      return teachers[teachers.length - 1].id;
    });
    await keyIs(p, 'teacher:' + added + ':name');
    assert.deepEqual(await p.evaluate(() => {
      const field = document.activeElement;
      return [field.value, field.selectionStart, field.selectionEnd, field.closest('tr') === field.closest('tbody').lastElementChild];
    }), ['New teacher', 0, 11, true]);
  });
});

// ---------------------------------------------------------------- from the review of the pass (SV2-48)

// The cards of the list that are on screen, read in one turn of the page.
const shownCards = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.sch-group')).filter((each) => each.getClientRects().length > 0).map((each) => each.dataset.group));
const listIs = (page, folded) => page.waitForFunction((wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.sch-groups')?.dataset.folded === wanted, { timeout: 5000 }, String(folded));
const hashOf = (page) => page.evaluate(() => location.hash);
// Type into a field over what it holds.
async function typeOver(page, selector, words) {
  await settled(page);
  await page.click(selector);
  await page.$eval(selector, (el) => el.select());
  await page.keyboard.type(words);
}
const highlighted = (page, row) => page.$$eval(row + ' .picker__option[aria-selected="true"]', (all) => all.map((el) => el.dataset.room));
const listOpen = (page, row) => page.$eval(row + ' .picker__list', (el) => !el.hidden && el.getClientRects().length > 0);
const lineOf = (page, row) => page.$eval(row + ' .sch-room__line', (el) => el.textContent);

test('on a 390 px phone "All groups" brings the list back after arriving by a slot\'s address and by Show on a finding, and it stays', async () => {
  await on('#schedule/groups/' + C6 + '/' + DAY_A + '/1', PHONE, async (p) => {
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    assert.deepEqual(await shownCards(p), [C6]);
    await tap(p, '[data-key="group-all"]');
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'by a slot\'s address: "All groups" left the list folded');
    assert.equal(await box(p, '.sch-editor'), null);
    assert.equal(await hashOf(p), '#schedule/groups', 'the list has no address of its own');
    await keyIs(p, 'group:' + C6);
    // the tab drawn again for a change to the project: still the list
    await act(p, 'editGroup', { id: A7, grade: '7' });
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 0, slot: { label: 'Homeroom' } });
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'the list folded again at the next drawing');

    // Show on a finding
    await go(p, '#schedule/checks');
    await settled(p);
    await tap(p, '.sch-findings tr[data-finding^="room-double:' + DAY_A + ':1:"] [data-action="show"]');
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    assert.equal(await hashOf(p), '#schedule/groups/' + C6 + '/' + DAY_A + '/1', 'Show does not go to the slot\'s address');
    assert.deepEqual(await shownCards(p), [C6]);
    await tap(p, '[data-key="group-all"]');
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'by Show: "All groups" left the list folded');
    // and Back from there is the Checks tab: the list took the place of the
    // editor Show opened, since the list was not under it (SV2-50 item 7)
    await p.evaluate(() => history.back());
    await shows(p, () => location.hash === '#schedule/checks' && document.querySelector('.sch-checks') !== null);
  });
});

test('the movement view\'s link to a slot opens a group that "All groups" can leave, once the window is a phone\'s', async () => {
  await on('#movement', DESK, async (p) => {
    await shows(p, () => document.querySelector('.mov')?.dataset.styled === 'true');
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 2, slot: { room: null } });
    await p.click('#inspector [role="tab"][data-tab="summary"]');
    await p.waitForSelector('#inspector [data-summary="health"] [data-action="fix"]', { timeout: 15000 });
    await p.click('#inspector [data-summary="health"] [data-action="fix"]');
    await waitForSection(p, 'schedule');
    await keyIs(p, 'slot:' + DAY_A + ':2:room');
    await p.setViewport({ width: 390, height: 760, deviceScaleFactor: 1 });
    await shows(p, () => document.querySelector('.sch').dataset.narrow === 'true' && document.querySelector('.sch').dataset.pending !== 'true');
    assert.deepEqual(await shownCards(p), [A7]);
    await p.$eval('[data-key="group-all"]', (el) => el.scrollIntoView({ block: 'center' }));
    await reachable(p, '[data-key="group-all"]');
    await p.click('[data-key="group-all"]');
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'by the movement view\'s link: "All groups" left the list folded');
  });
});

test('on a 390 px phone the Back button from a group\'s editor is the list, with the focus on the group\'s card, and not the way out of the section', async () => {
  await on('#schedule/groups', PHONE, async (p) => {
    // The tap draws the tab once. The address follows the drawing, and the
    // address saying what is already drawn draws nothing: a second drawing
    // would take the editor from under the finger. Counted by the columns
    // the tab puts up at each drawing, until the page has heard the address.
    const routed = p.evaluate(() => new Promise((resolve) => {
      globalThis.drawings = 0;
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) if (node.classList && node.classList.contains('sch-groups__cols')) globalThis.drawings += 1;
      }).observe(document.querySelector('.sch-groups'), { childList: true });
      window.addEventListener('hashchange', () => setTimeout(() => resolve('heard'), 0), { once: true });
      // not a wait: the limit after which the case says no address came
      setTimeout(() => resolve('no address in 5 s'), 5000);
    }));
    await tap(p, '.sch-group[data-group="' + B6 + '"]');
    assert.equal(await routed, 'heard', 'choosing a group on a phone did not change the address');
    await listIs(p, true);
    assert.equal(await hashOf(p), '#schedule/groups/' + B6, 'a group chosen on a phone has no place in the history');
    assert.equal(await p.evaluate(() => globalThis.drawings), 1, 'the tap drew the tab more than once');
    assert.deepEqual(await shownCards(p), [B6]);
    await p.focus('[data-key="group-name"]');
    await p.evaluate(() => history.back());
    await listIs(p, false);
    assert.equal(await hashOf(p), '#schedule/groups');
    assert.equal(await p.$eval('.surface__layout', (el) => el.dataset.section), 'schedule', 'Back left the section');
    assert.equal((await shownCards(p)).length, 8);
    assert.equal(await box(p, '.sch-editor'), null);
    await keyIs(p, 'group:' + B6);
    // Forward is the editor again
    await p.evaluate(() => history.forward());
    await listIs(p, true);
    assert.deepEqual(await shownCards(p), [B6]);
    // an address whose group is not in the project is the list
    await go(p, '#schedule/groups/gnobody0001/' + DAY_A + '/1');
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'an address naming no group left the editor of another open');

    // an undo that takes back the group whose editor is open: the list
    // comes back, since the editor would be another group's
    await tap(p, '[data-action="add-group"]');
    await listIs(p, true);
    await keyIs(p, 'group-name');
    assert.equal(await text(p, '.sch-editor__title'), 'New group');
    await p.evaluate(() => globalThis.sv2.store.undo());
    await listIs(p, false);
    assert.equal((await shownCards(p)).length, 8, 'the list stayed folded on a group that is gone');
    assert.equal(await p.evaluate(() => document.activeElement === document.body), false, 'the focus fell to the page');
  });
});

test('in the room picker Enter keeps what was typed exactly as leaving the field does, and picks only what the arrow keys highlighted', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    await typeOver(p, field, '10');
    assert.ok((await count(p, row + ' .picker__option')) >= 3, 'rooms 101, 102 and 103 are offered');
    assert.deepEqual(await highlighted(p, row), [], 'a room is highlighted that no arrow key went to');
    assert.equal(await p.$eval(field, (el) => el.getAttribute('aria-activedescendant')), null);
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '10' && !document.querySelector(selector).parentNode.querySelector('.sch-room__missing').hidden, field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: null, roomText: '10' }, '"10" and Enter is not Room 101');
    await keyIs(p, 'slot:' + DAY_A + ':1:room');

    // the arrow keys go to a room, and Enter picks that one
    await typeOver(p, field, '10');
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(p, row), ['rsample101']);
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(p, row), ['rsample102']);
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '101 — Ms. Halloran', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample101', roomText: '' });
    // typing again takes the highlight off: Enter after it reads the text
    await typeOver(p, field, '10');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.type('3');
    assert.deepEqual(await highlighted(p, row), []);
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value.startsWith('103 — '), field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample103', roomText: '' }, 'a whole number typed and Enter is that room');
  });
});

test('a room field that holds a room opens with that room highlighted, by a click, by ArrowDown and from a slot\'s address: Enter leaves the slot as it was', async () => {
  await on('#schedule/groups/' + A6 + '/' + DAY_A + '/0', DESK, async (p) => {
    const field = slotField(DAY_A, 0);
    const row = slotRow(DAY_A, 0);
    await keyIs(p, 'slot:' + DAY_A + ':0:room');
    const before = await stored(p, A6, DAY_A, 0);
    assert.match(before.room, /^rsample/, 'the case needs a slot with a room');
    const same = () => p.evaluate(() => globalThis.sv2.store.project === globalThis.kept);
    await p.evaluate(() => {
      globalThis.kept = globalThis.sv2.store.project;
    });
    // where the address put the cursor: ArrowDown opens the list
    await p.keyboard.press('ArrowDown');
    assert.equal(await listOpen(p, row), true);
    assert.deepEqual(await highlighted(p, row), [before.room], 'opened by ArrowDown, the highlight is not on the slot\'s own room');
    assert.equal(await p.$eval(row + ' .picker__option', (el) => el.dataset.room), '', 'the case needs "No room" at the head of the list');
    await p.keyboard.press('Enter');
    assert.equal(await listOpen(p, row), false);
    await settled(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), before, 'Enter on a list just opened changed the slot');
    assert.equal(await same(), true, 'Enter on a list just opened made a change to the project');
    // by a click
    await p.keyboard.press('Tab');
    await p.click(field);
    assert.equal(await listOpen(p, row), true);
    assert.deepEqual(await highlighted(p, row), [before.room], 'opened by a click, the highlight is not on the slot\'s own room');
    await p.keyboard.press('Enter');
    await settled(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), before);
    assert.equal(await same(), true);
    // one ArrowUp from there is "No room", and Enter then is meant
    await p.click(field);
    const at = await p.$$eval(row + ' .picker__option', (all) => all.findIndex((el) => el.getAttribute('aria-selected') === 'true'));
    for (let i = 0; i < at; i += 1) await p.keyboard.press('ArrowUp');
    assert.deepEqual(await highlighted(p, row), ['']);
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 0), { room: null, roomText: '' });
  });
});

test('text that two rooms answer to is kept as typed: Enter leaves the list open on the two and says so, leaving the field picks neither', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    // Ms. Halloran is based in 101; now in 102 as well
    await act(p, 'editTeacher', { id: 'tsample001', roomIds: ['rsample101', 'rsample102'] });
    await settled(p);
    const field = slotField(DAY_A, 2);
    const row = slotRow(DAY_A, 2);
    const before = await stored(p, A6, DAY_A, 2);
    await typeOver(p, field, 'halloran');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector(selector + ' .sch-room__line').textContent !== '', row);
    assert.equal(await lineOf(p, row), '2 rooms match. Pick one from the list.');
    assert.equal(await listOpen(p, row), true, 'the list shut on Enter');
    const offered = await p.$$eval(row + ' .picker__option', (all) => all.map((el) => [el.dataset.room, el.firstChild.textContent.includes('Ms. Halloran')]));
    assert.deepEqual(offered, [['rsample101', true], ['rsample102', true]]);
    assert.deepEqual(await highlighted(p, row), []);
    assert.equal(await p.$eval(field, (el) => el.value), 'halloran');
    assert.deepEqual(await stored(p, A6, DAY_A, 2), before, 'Enter picked one of the two');
    // a second Enter picks neither still
    await p.keyboard.press('Enter');
    assert.equal(await listOpen(p, row), true);
    assert.deepEqual(await stored(p, A6, DAY_A, 2), before);

    // leaving the field keeps the text, and the line stays to say why
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === 'halloran' && !document.querySelector(selector).parentNode.querySelector('.sch-room__missing').hidden, field);
    assert.deepEqual(await stored(p, A6, DAY_A, 2), { room: null, roomText: 'halloran' }, 'leaving the field picked one of the two');
    assert.equal(await lineOf(p, row), '2 rooms match. Pick one from the list.');

    // the field opened again is on the two, and the arrows pick
    await p.click(field);
    assert.deepEqual(await p.$$eval(row + ' .picker__option', (all) => all.map((el) => el.dataset.room)), ['rsample101', 'rsample102']);
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value.startsWith('102 — '), field);
    assert.deepEqual(await stored(p, A6, DAY_A, 2), { room: 'rsample102', roomText: '' });
    assert.equal(await lineOf(p, row), '');
  });
});

test('the picker\'s line of words is a status the field is described by, and its link to the building is a Tab away and keeps what was typed', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const row = slotRow(DAY_A, 0);
    await typeOver(p, slotField(DAY_A, 0), 'zzz');
    const said = await p.$eval(row, (tr) => {
      const input = tr.querySelector('.picker__input');
      const line = tr.querySelector('.sch-room__line');
      return { role: line.getAttribute('role'), boxed: line.getClientRects().length > 0, described: (input.getAttribute('aria-describedby') || '').split(' ').includes(line.id), words: line.textContent };
    });
    assert.deepEqual(said, { role: 'status', boxed: true, described: true, words: 'No room matches. It is kept as typed, and marked as not in the building.' });
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    assert.equal(await lineOf(p, row), '');
    assert.equal(await p.$eval(row + ' .picker__input', (el) => (el.getAttribute('aria-describedby') || '').includes('-line')), false, 'the field is described by a line with no words');
  });
  await on('#project', DESK, async (p) => {
    await p.click('#sample-school [data-action="sample"]');
    await shows(p, () => document.getElementById('sample-chip').hidden);
    await closeToast(p);
    await goSettled(p, '#schedule/groups');
    await p.click('[data-action="add-group"]');
    await keyIs(p, 'group-name');
    const day = await p.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id);
    const group = await p.evaluate(() => globalThis.sv2.store.project.groups[0].id);
    await p.click(slotField(day, 0));
    await p.keyboard.type('B12');
    // by keyboard: the link is the next stop, and the picker has not shut on it
    await p.keyboard.press('Tab');
    const on = await p.evaluate(() => {
      const el = document.activeElement;
      return { tag: el.tagName, href: el.getAttribute('href'), inLine: Boolean(el.closest('.sch-room__line')), row: el.closest('tr')?.dataset.period };
    });
    assert.deepEqual(on, { tag: 'A', href: '#building', inLine: true, row: '0' }, 'Tab from the field did not reach the line\'s link');
    await p.keyboard.press('Enter');
    await waitForSection(p, 'building');
    assert.deepEqual(await stored(p, group, day, 0), { room: null, roomText: 'B12' }, 'what was typed was lost on the way to the building');
  });
});

test('narrowed under 640 px with the cursor in the editor and no card chosen by hand, the focus is on the group\'s card and not on the page', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    await p.click('[data-key="group-name"]');
    assert.equal(await activeKey(p), 'group-name');
    await p.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await shows(p, () => document.querySelector('.sch').dataset.narrow === 'true' && document.querySelector('.sch').dataset.pending !== 'true');
    assert.equal(await box(p, '.sch-editor'), null, 'the case needs the editor out of sight at 600 px');
    assert.equal(await p.evaluate(() => document.activeElement === document.body), false, 'the focus fell to the page');
    assert.equal(await activeKey(p), 'group:' + A6);
    // and the list's keys work from there
    await p.keyboard.press('ArrowDown');
    assert.equal(await activeKey(p), 'group:' + B6);
  });
});

test('a filter that matches no group leaves no listbox without an option, a selected finding says so to a screen reader, and the inspector follows the 900 px crossing', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const list = () => p.$eval('.sch-groups__list', (el) => [el.getAttribute('role'), el.getAttribute('aria-label'), el.querySelectorAll('[role="option"]').length]);
    assert.deepEqual(await list(), ['listbox', 'Groups', 8]);
    await p.click('[data-key="group-filter"]');
    await p.keyboard.type('zzzz');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-group').length === 0);
    assert.deepEqual(await list(), [null, null, 0], 'a listbox with no option');
    assert.equal(await text(p, '.sch-groups__tally'), 'No group matches “zzzz”.');
    for (let i = 0; i < 4; i += 1) await p.keyboard.press('Backspace');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-group').length === 8);
    assert.deepEqual(await list(), ['listbox', 'Groups', 8]);

    await go(p, '#schedule/checks');
    await settled(p);
    const current = () => p.$$eval('.sch-checks .sch-findings:not(.sch-findings--accepted) tbody tr', (rows) => rows.map((row) => [row.getAttribute('aria-current'), row.dataset.selected || null]));
    assert.deepEqual((await current()).filter((row) => row[0] !== null || row[1] !== null), [], 'a finding is selected before one was chosen');
    await p.click('.sch-checks .sch-findings tbody tr:nth-child(2) .sch-finding__what');
    await shows(p, () => document.querySelector('#inspector .sch-panel__scope').textContent === 'The finding selected');
    const marked = await current();
    assert.deepEqual(marked[1], ['true', 'true']);
    assert.deepEqual(marked.filter((row) => row[0] !== null), [['true', 'true']], 'more than one row says it is the one');
    // drawn again, the row still says so
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 0, slot: { label: 'Homeroom' } });
    await settled(p);
    assert.deepEqual((await current()).filter((row) => row[0] !== null), [['true', 'true']]);
    // another row chosen: that one says so, and the first no longer does
    await p.click('.sch-checks .sch-findings tbody tr:nth-child(1) .sch-finding__what');
    await shows(p, () => document.querySelector('.sch-checks .sch-findings tbody tr').dataset.selected === 'true');
    const moved = await current();
    assert.deepEqual(moved[0], ['true', 'true']);
    assert.deepEqual(moved[1], [null, null], 'the row that was selected still says it is');

    // where the list is: beside the inspector, and above it once it is a sheet
    const where = () => text(p, '#inspector .sch-panel__more[data-note="list"]');
    assert.match(await where(), /^Every finding is in the list on the left\./);
    await p.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
    await shows(p, () => document.querySelector('#inspector .sch-panel').dataset.where === 'above');
    assert.match(await where(), /^Every finding is in the list above\./);
    await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await shows(p, () => document.querySelector('#inspector .sch-panel').dataset.where === 'on the left');
    assert.match(await where(), /^Every finding is in the list on the left\./);
  });
});

test('at 390 px the room field is the row\'s full width under the period\'s name, and "203 — Ms. Vandermeer" is not cut', async () => {
  await on('#schedule/groups/' + C6 + '/' + DAY_A + '/1', PHONE, async (p) => {
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    const fields = await p.$$eval('.sch-day[data-day="' + DAY_A + '"] .sch-slot', (rows) => rows.map((tr) => {
      const input = tr.querySelector('.sch-room .picker__input');
      const name = tr.querySelector('.sch-slot__period').getBoundingClientRect();
      const field = input.getBoundingClientRect();
      const menu = tr.querySelector('.sch-slot__menu').getBoundingClientRect();
      const around = tr.getBoundingClientRect();
      return { value: input.value, cut: input.scrollWidth > input.clientWidth, under: field.top >= name.bottom - 1, width: field.width, row: around.width, menuBeside: menu.left >= field.right && menu.right <= around.right + 1 && menu.top < field.bottom && menu.bottom > field.top };
    }));
    assert.equal(fields.length, 8);
    assert.equal(fields[1].value, '203 — Ms. Vandermeer');
    for (const field of fields) {
      assert.equal(field.cut, false, JSON.stringify(field));
      assert.equal(field.under, true, 'the field is beside the period\'s name: ' + JSON.stringify(field));
      assert.ok(field.width >= field.row - 60, 'the field is not the row\'s width: ' + JSON.stringify(field));
      assert.equal(field.menuBeside, true, 'the row\'s menu is not beside the field: ' + JSON.stringify(field));
    }
    // the table is still a table of rows to a screen reader
    const roles = await p.$eval('.sch-day[data-day="' + DAY_A + '"] .sch-slots', (table) => [getComputedStyle(table).display, table.querySelectorAll('thead th').length, table.querySelector('caption') !== null]);
    assert.deepEqual(roles, ['block', 3, true]);
  });
  // on a wide screen the name is beside the field as before
  await on('#schedule/groups', DESK, async (p) => {
    const beside = await p.$eval('.sch-slot', (tr) => tr.querySelector('.sch-slot__period').getBoundingClientRect().right <= tr.querySelector('.sch-room .picker__input').getBoundingClientRect().left + 1 && getComputedStyle(tr).display === 'table-row');
    assert.equal(beside, true);
  });
});

// ---------------------------------------------------------------- 19: the screens

test('the sweeps have the three screens the walk-through missed, and each opens', async () => {
  const wanted = {
    'schedule-room-not-in-building': async (p) => {
      assert.equal(await p.$eval('.sch-slot .sch-room__missing:not([hidden])', (el) => el.textContent), '▲ Not in the building. It is kept as typed.');
      assert.equal(await text(p, '.sch-slot[data-period="1"] .sch-room__line'), 'No room matches. It is kept as typed, and marked as not in the building.', 'the next field\'s line does not say that nothing matches');
    },
    'schedule-checks-phone': async (p) => {
      assert.equal(await p.evaluate(() => window.innerWidth), 390);
      assert.equal(await count(p, '.sch-checks .sch-findings tbody tr'), 4);
    },
    'schedule-group-editor-phone': async (p) => {
      assert.equal(await p.evaluate(() => window.innerWidth), 390);
      assert.equal(await p.$$eval('.sch-group', (all) => all.filter((each) => each.getClientRects().length > 0).length), 1);
      assert.ok(await box(p, '.sch-editor [data-key="group-name"]'));
    },
  };
  assert.equal(SCREENS.some((screen) => screen.id === 'schedule-room-refused-and-missing'), false, 'the screen of the refusal that is no longer given is still in the sweep');
  const session = await openPlanner({ server, browser, hash: '#project', theme: 'light', ...DESK });
  let failed = null;
  try {
    for (const [id, check] of Object.entries(wanted)) {
      const screen = SCREENS.find((each) => each.id === id);
      assert.ok(screen, id + ' is not in test/browser/screens.mjs');
      await visit(session, screen);
      await check(session.page);
    }
    // the size is put back when the sweep leaves a phone screen
    await visit(session, SCREENS.find((each) => each.id === 'schedule-groups'));
    await shows(session.page, () => window.innerWidth === 1280);
  } catch (error) {
    failed = error;
  }
  const found = session.problems();
  await session.page.close().catch(() => {});
  if (failed) throw failed;
  assert.deepEqual(found, CLEAN);
});

// The SV2-57 review: three of the schedule's phone screens were resized by
// their own `open` after a load at the sweep's size, so axe and the
// no-offsite count saw them with a mouse, never with touch. They are loaded
// at a phone's size with touch now, as the sweeps load every `viewport`
// screen (harness.mjs, visit), and the size is the sweep's own again after.
test('SV2-72e item 2: the schedule\'s phone screens in the sweeps run at a phone\'s size with touch, and the next screen at the sweep\'s size', async () => {
  const phones = ['schedule-checks-phone', 'schedule-group-editor-phone', 'schedule-grid-phone'];
  const session = await openPlanner({ server, browser, hash: '#project', theme: 'light', ...DESK });
  let failed = null;
  try {
    for (const id of phones) {
      const screen = SCREENS.find((each) => each.id === id);
      assert.ok(screen, id + ' is not in test/browser/screens.mjs');
      await visit(session, screen);
      const seen = await session.page.evaluate(() => ({ width: window.innerWidth, touch: navigator.maxTouchPoints > 0, coarse: matchMedia('(pointer: coarse)').matches }));
      assert.deepEqual(seen, { width: 390, touch: true, coarse: true }, id + ' ran without touch, or not at a phone\'s width');
    }
    await visit(session, SCREENS.find((each) => each.id === 'schedule-groups'));
    const back = await session.page.evaluate(() => ({ width: window.innerWidth, touch: navigator.maxTouchPoints > 0 }));
    assert.deepEqual(back, { width: 1280, touch: false }, 'the screen after a phone\'s is not at the sweep\'s size');
  } catch (error) {
    failed = error;
  }
  const found = session.problems();
  await session.page.close().catch(() => {});
  if (failed) throw failed;
  assert.deepEqual(found, CLEAN);
});

// ---------------------------------------------------------------- SV2-50: the phone's history, and the focus

const onPage = (page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);
const drawnNarrow = (page, narrow) => shows(page, (wanted) => document.querySelector('.sch')?.dataset.narrow === wanted && document.querySelector('.sch').dataset.pending !== 'true', String(narrow));

test('SV2-50 item 1: on a phone the Show of an undone slot change is the slot\'s address, so the editor opens on it and not the list', async () => {
  await on('#schedule/groups', PHONE, async (p) => {
    // the page's own app.js (the same address, so the same module, not a second boot)
    await loadModule(p, 'app', 'ui/app.js');
    const hashes = await p.evaluate((g, d) => {
      const { hashForFocus } = globalThis.sv2modules.app;
      return [
        hashForFocus({ section: 'schedule', tab: 'groups', groupId: g, dayTypeId: d, period: 3 }),
        hashForFocus({ section: 'schedule', tab: 'groups', groupId: g, dayTypeId: d, period: 0 }),
        hashForFocus({ section: 'schedule', tab: 'groups', groupId: g }),
        hashForFocus({ section: 'schedule', tab: 'groups' }),
        hashForFocus({ section: 'schedule', tab: 'teachers', teacherId: 'tsample001' }),
      ];
    }, C6, DAY_A);
    assert.deepEqual(hashes, ['#schedule/groups/' + C6 + '/' + DAY_A + '/3', '#schedule/groups/' + C6 + '/' + DAY_A + '/0', '#schedule/groups/' + C6, '#schedule/groups', '#schedule/teachers']);

    // the journey: a change, its undo from the list, and the message's Show
    await act(p, 'setSlot', { groupId: C6, dayTypeId: DAY_A, period: 3, slot: { label: 'Choir' } });
    await listIs(p, false);
    await p.evaluate(() => globalThis.sv2.ctx.undo());
    await shows(p, () => document.querySelector('.toast .toast__action')?.textContent === 'Show');
    await tap(p, '.toast .toast__action');
    await shows(p, () => location.hash !== '#schedule/groups');
    assert.equal(await hashOf(p), '#schedule/groups/' + C6 + '/' + DAY_A + '/3', 'Show went to the list');
    await keyIs(p, 'slot:' + DAY_A + ':3:room');
    await listIs(p, true);
    assert.deepEqual(await shownCards(p), [C6]);
  });
});

test('SV2-50 item 2: when the filter hides the chosen group the focus goes to the list\'s Tab stop, never to the page: at the 640 crossing, and at "All groups" after a rename', async () => {
  // 6A open with the filter at "7", the cursor in its Name, narrowed to 600
  await on('#schedule/groups', DESK, async (p) => {
    await p.click('[data-key="group-filter"]');
    await p.keyboard.type('7');
    await shows(p, () => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-group').length === 3);
    assert.equal(await text(p, '.sch-editor__title'), '6A', 'the case needs 6A open behind the filter');
    await p.click('[data-key="group-name"]');
    assert.equal(await activeKey(p), 'group-name');
    await p.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });
    await drawnNarrow(p, true);
    assert.equal(await box(p, '.sch-editor'), null, 'the case needs the editor out of sight at 600 px');
    assert.equal(await onPage(p), false, 'at the 640 crossing the focus fell to the page');
    assert.equal(await activeKey(p), 'group:' + A7, 'the focus is not on the first card the filter leaves');
  });
  // on a phone: "B" in the filter (6B, 7B, 8B by name), 6B chosen and renamed
  // out of it, "All groups"; and "6B", which leaves nothing once 6B is renamed
  for (const [filter, wanted] of [['B', 'group:gsample07b'], ['6B', 'group-filter']]) {
    await on('#schedule/groups', PHONE, async (p) => {
      await p.click('[data-key="group-filter"]');
      await p.keyboard.type(filter);
      await shows(p, (n) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelectorAll('.sch-group').length === n, filter === 'B' ? 3 : 1);
      await tap(p, '.sch-group[data-group="' + B6 + '"]');
      await listIs(p, true);
      await typeOver(p, '[data-key="group-name"]', 'Quarry');
      await p.keyboard.press('Enter');
      await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === 'Quarry' && document.querySelector('.sch').dataset.pending !== 'true');
      await tap(p, '[data-key="group-all"]');
      await listIs(p, false);
      assert.equal(await onPage(p), false, 'filter ' + filter + ': at "All groups" the focus fell to the page');
      assert.equal(await activeKey(p), wanted, 'filter ' + filter);
    });
  }
});

test('SV2-50 item 3: at the 900 crossing the focus in the inspector stays on its control, a tablet turned either way; to a sheet that starts shut it goes to the sheet\'s button', async () => {
  await on('#schedule/checks', { width: 1180, height: 820 }, async (p) => {
    await p.click('.sch-checks .sch-findings tbody tr:nth-child(1) .sch-finding__what');
    await shows(p, () => document.querySelector('#inspector .sch-panel__scope')?.textContent === 'The finding selected');
    const control = '#inspector .sch-panel__list [data-action="accept"]';
    const key = await p.$eval(control, (el) => el.dataset.key);
    const turn = async (width, height, where) => {
      await p.setViewport({ width, height, deviceScaleFactor: 1 });
      await shows(p, (wanted) => document.querySelector('#inspector .sch-panel')?.dataset.where === wanted, where);
      assert.equal(await onPage(p), false, 'turned to ' + width + ' px the focus fell to the page');
    };
    await p.focus(control);
    assert.equal(await activeKey(p), key);
    // the sheet has never been opened, so it starts shut
    await turn(820, 1180, 'above');
    assert.equal(await p.evaluate(() => document.getElementById('inspector').dataset.open), 'false', 'the case needs the sheet shut');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'inspector-toggle');
    // opened by hand: from here on the panel is in sight on both sides
    await inspector(p, true);
    await p.focus(control);
    await turn(1180, 820, 'on the left');
    assert.equal(await activeKey(p), key, 'turned to 1180 px the focus is not on its control');
    await turn(820, 1180, 'above');
    assert.equal(await activeKey(p), key, 'turned to 820 px the focus is not on its control');
  });
});

test('SV2-50 item 4: a phone turned upright with a group chosen has the group\'s address, so Back is the list and not the way out of the section', async () => {
  await on('#project', { width: 844, height: 390, mobile: true }, async (p) => {
    await go(p, '#schedule/groups');
    await settled(p);
    await p.click('.sch-group[data-group="' + B6 + '"]');
    await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === '6B' && document.querySelector('.sch').dataset.pending !== 'true');
    assert.equal(await hashOf(p), '#schedule/groups', 'the case needs a wide screen that writes no address for a click');
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await drawnNarrow(p, true);
    assert.deepEqual(await shownCards(p), [B6]);
    assert.equal(await hashOf(p), '#schedule/groups/' + B6, 'turned upright, the editor has no place in the history');
    await p.evaluate(() => history.back());
    await listIs(p, false);
    assert.equal(await hashOf(p), '#schedule/groups');
    assert.equal(await p.$eval('.surface__layout', (el) => el.dataset.section), 'schedule', 'Back left the section');
    assert.equal((await shownCards(p)).length, 8);
    // turned on its side and upright again with the list showing: the list's address stays
    await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await drawnNarrow(p, false);
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await drawnNarrow(p, true);
    assert.equal(await hashOf(p), '#schedule/groups');
    assert.equal((await shownCards(p)).length, 8);
  });
});

test('SV2-50 item 7: on a phone the history holds a group once: "All groups" goes back to the list under the editor, and Delete and an undone Add leave no second list', async () => {
  await on('#project', PHONE, async (p) => {
    await go(p, '#schedule/groups');
    await settled(p);
    const backToProject = async (why) => {
      // every step back fires popstate, one between two entries of the same address too
      await p.evaluate(() => new Promise((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        history.back();
      }));
      assert.equal(await hashOf(p), '#project', why);
      await waitForSection(p, 'project');
      await p.evaluate(() => history.forward());
      await waitForSection(p, 'schedule');
      await listIs(p, false);
    };
    // "All groups" from an editor chosen in the list
    await tap(p, '.sch-group[data-group="' + B6 + '"]');
    await listIs(p, true);
    await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + B6);
    await tap(p, '[data-key="group-all"]');
    await listIs(p, false);
    await shows(p, () => location.hash === '#schedule/groups');
    await backToProject('Back from the list after "All groups" is not the page the list was come to from');

    // Delete
    await tap(p, '.sch-group[data-group="' + C6 + '"]');
    await listIs(p, true);
    await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + C6);
    await tap(p, '[data-action="delete"]');
    await listIs(p, false);
    await shows(p, () => location.hash === '#schedule/groups');
    await closeToast(p);
    assert.equal((await shownCards(p)).length, 7);
    await backToProject('Back from the list after a Delete is not the page the list was come to from');

    // an Add, undone
    await tap(p, '[data-action="add-group"]');
    await listIs(p, true);
    await shows(p, () => /^#schedule\/groups\/g/.test(location.hash));
    await p.evaluate(() => globalThis.sv2.store.undo());
    await listIs(p, false);
    // the step back to the list is the browser's to take
    await until(p, 'an undone Add left the gone group\'s address in the history', () => location.hash === '#schedule/groups');
    await backToProject('Back from the list after an undone Add is not the page the list was come to from');
  });
});

test('SV2-50 item 5: in the group editor a room with no number is not picked by "with", the words that stand for it, and its teacher still picks it', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    await act(p, 'setRoomFields', { roomId: 'rsample103', number: '' });
    await settled(p);
    const field = slotField(DAY_A, 2);
    await typeOver(p, field, 'with');
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === 'with', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 2), { room: null, roomText: 'with' }, '"with" picked the room with no number');
    const teacher = await p.evaluate(() => {
      const project = globalThis.sv2.store.project;
      const room = project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === 'rsample103');
      return project.teachers.find((each) => each.id === room.teacherIds[0]).name;
    });
    await typeOver(p, field, teacher.split(' ').pop());
    await p.keyboard.press('Tab');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value !== 'with', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 2), { room: 'rsample103', roomText: '' }, 'its teacher\'s name did not pick the room with no number');
  });
});

test('SV2-50 item 6: the arrow keys\' highlight under an open list survives a drawing: "10", ArrowDown, the project changed elsewhere, Enter picks Room 101', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    await typeOver(p, field, '10');
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(p, row), ['rsample101']);
    // a drawing under the open list, as the walk's answer makes one
    const before = await p.$(field);
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 0, slot: { label: 'Homeroom' } });
    await settled(p);
    assert.equal(await p.evaluate((el) => el.isConnected, before), false, 'the case needs the field drawn again');
    assert.equal(await activeKey(p), 'slot:' + DAY_A + ':1:room');
    assert.equal(await listOpen(p, row), true, 'the list shut at the drawing');
    assert.deepEqual(await highlighted(p, row), ['rsample101'], 'the highlight was lost at the drawing');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '101 — Ms. Halloran', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample101', roomText: '' });
  });
});

test('SV2-50 item 8: the section left behind hears nothing more: a group chosen, Project opened, the window narrowed under 640 px, and the address is still Project\'s', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    await p.click('.sch-group[data-group="' + B6 + '"]');
    await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === '6B' && document.querySelector('.sch').dataset.pending !== 'true');
    await go(p, '#project');
    // a query made now hears the change after the section's, made earlier
    const crossed = p.evaluate(() => new Promise((resolve) => {
      window.matchMedia('(max-width: 640px)').addEventListener('change', () => setTimeout(resolve, 0), { once: true });
    }));
    await p.setViewport({ width: 390, height: 760, deviceScaleFactor: 1 });
    await crossed;
    assert.equal(await hashOf(p), '#project', 'the schedule left behind changed the address');
    assert.equal(await p.$eval('.surface__layout', (el) => el.dataset.section), 'project');
  });
});

// Chromium's tree keeps a table's roles under display: block and grid with
// the written roles taken out (SV2-50 took every one out and ran it), so the
// tree alone cannot catch their loss here. The roles a browser that drops
// them (WebKit) needs are read from the markup first (SV2-54 item 6): with
// any of them deleted this case fails; the tree is then read as well.
test('SV2-50 item 9: on a phone the slot table names its roles in the markup (table, row groups, rows, headers, cells), and is a table in Chromium\'s accessibility tree', async () => {
  await on('#schedule/groups/' + A6, PHONE, async (p) => {
    await listIs(p, true);
    assert.equal(await p.$eval('.sch-day[data-day="' + DAY_A + '"] .sch-slots', (el) => getComputedStyle(el).display), 'block', 'the case needs the phone\'s row layout');
    const written = await p.$eval('.sch-day[data-day="' + DAY_A + '"] .sch-slots', (table) => {
      const roleOf = (el) => el.getAttribute('role');
      return {
        table: roleOf(table),
        groups: Array.from(table.querySelectorAll(':scope > thead, :scope > tbody')).map(roleOf),
        rows: Array.from(table.querySelectorAll('tr')).map(roleOf),
        heads: Array.from(table.querySelectorAll('thead th')).map(roleOf),
        rowHeads: Array.from(table.querySelectorAll('tbody th')).map(roleOf),
        cells: Array.from(table.querySelectorAll('td')).map(roleOf),
      };
    });
    const periods = await p.evaluate(() => globalThis.sv2.store.project.settings.periods);
    const all = (role, n) => Array(n).fill(role);
    assert.equal(written.table, 'table', 'the table does not name its role');
    assert.deepEqual(written.groups, ['rowgroup', 'rowgroup'], 'the head and body do not name their role');
    assert.deepEqual(written.rows, all('row', periods + 1), 'a row does not name its role');
    assert.deepEqual(written.heads, all('columnheader', 3), 'a column heading does not name its role');
    assert.deepEqual(written.rowHeads, all('rowheader', periods), 'a period\'s heading does not name its role');
    assert.deepEqual(written.cells, all('cell', periods * 2), 'a cell does not name its role');
    const table = await p.$('.sch-day[data-day="' + DAY_A + '"] .sch-slots');
    const tree = await p.accessibility.snapshot({ root: table, interestingOnly: false });
    const roles = [];
    const walk = (node) => {
      roles.push(node.role);
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
    assert.equal(tree.role, 'table', 'the table is not a table to a screen reader');
    assert.equal(roles.filter((role) => role === 'row').length, periods + 1, 'a row per period and the heading row');
    assert.equal(roles.filter((role) => role === 'rowheader').length, periods);
    assert.equal(roles.filter((role) => role === 'columnheader').length, 3);
    assert.equal(roles.filter((role) => role === 'cell').length, periods * 2);
  });
});

test('SV2-50 item 10: an option is picked by a click or a tap, not as the pointer comes down: a press dragged off the list picks nothing', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    await typeOver(p, field, '10');
    const option = row + ' .picker__option[data-room="rsample102"]';
    const at = await box(p, option);
    await p.mouse.move(at.left + at.width / 2, at.top + at.height / 2);
    await p.mouse.down();
    await p.mouse.move(at.left + at.width / 2, at.top - 200, { steps: 4 });
    await p.mouse.up();
    assert.equal(await activeKey(p), 'slot:' + DAY_A + ':1:room', 'the press took the focus from the field');
    assert.equal(await p.$eval(field, (el) => el.value), '10', 'a press on an option picked it');
    assert.equal(await stored(p, A6, DAY_A, 1).then((slot) => slot.room === 'rsample102'), false, 'a press on an option picked it');
    // the click is the pick
    await p.click(option);
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value.startsWith('102 — '), field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample102', roomText: '' });
  });
  // a tap on a phone
  await on('#schedule/groups/' + A6 + '/' + DAY_A + '/1', PHONE, async (p) => {
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    await keyIs(p, 'slot:' + DAY_A + ':1:room');
    await p.$eval(field, (el) => el.select());
    await p.keyboard.type('10');
    await tapAt(p, row + ' .picker__option[data-room="rsample103"]');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value.startsWith('103 — '), field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample103', roomText: '' });
  });
});

test('SV2-50 item 11: the room picker\'s "Number them in Building." keeps the focus across a drawing', async () => {
  await on('#project', DESK, async (p) => {
    await p.click('#sample-school [data-action="sample"]');
    await shows(p, () => document.getElementById('sample-chip').hidden);
    await closeToast(p);
    await goSettled(p, '#schedule/groups');
    await p.click('[data-action="add-group"]');
    await keyIs(p, 'group-name');
    const day = await p.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id);
    const group = await p.evaluate(() => globalThis.sv2.store.project.groups[0].id);
    await p.click(slotField(day, 0));
    await p.waitForSelector(slotRow(day, 0) + ' .sch-room__line a');
    await p.keyboard.press('Tab');
    const key = 'slot:' + day + ':0:room:building';
    assert.equal(await activeKey(p), key, 'the case needs the focus on the link');
    await act(p, 'setSlot', { groupId: group, dayTypeId: day, period: 3, slot: { label: 'Choir' } });
    await settled(p);
    assert.equal(await onPage(p), false, 'the focus fell to the page');
    assert.equal(await activeKey(p), key, 'the focus left the link at the drawing');
    assert.equal(await p.evaluate(() => document.activeElement.isConnected), true);
  });
});

// ---------------------------------------------------------------- SV2-54: from the review of SV2-50

const depth = (page) => page.evaluate(() => globalThis.sv2.store.history.past.length);
// One step of the browser's history, waited for: every step fires popstate.
const step = (page, how) => page.evaluate((way) => new Promise((resolve) => {
  window.addEventListener('popstate', () => resolve(), { once: true });
  if (way === 'back') history.back();
  else history.forward();
}), how);
// The history's entries from here back to the page the case started on,
// read by stepping back through them; the case is left on that page.
async function backTo(page, start, most) {
  const seen = [await hashOf(page)];
  while (seen[seen.length - 1] !== start && seen.length <= most) {
    await step(page, 'back');
    seen.push(await hashOf(page));
  }
  return seen;
}

test('SV2-54 item 3: a drawing under an open list commits nothing: "10", ArrowDown, a drawing, Enter is one change, and Undo returns the slot as it was, not "10"', async () => {
  await on('#schedule/groups', DESK, async (p) => {
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    const was = await stored(p, A6, DAY_A, 1);
    assert.notEqual(was.room, 'rsample101', 'the case needs a slot that is not Room 101');
    await typeOver(p, field, '10');
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(p, row), ['rsample101']);
    // the drawing, made by a change elsewhere (one entry of its own)
    const before = await p.$(field);
    await act(p, 'setSlot', { groupId: A7, dayTypeId: DAY_A, period: 0, slot: { label: 'Homeroom' } });
    await settled(p);
    assert.equal(await p.evaluate((el) => el.isConnected, before), false, 'the case needs the field drawn again');
    const drawn = await depth(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), was, 'the drawing committed the half-typed text');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '101 — Ms. Halloran', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample101', roomText: '' });
    assert.equal(await depth(p), drawn + 1, 'Enter after the drawing made more than one entry');
    await p.evaluate(() => globalThis.sv2.store.undo());
    await settled(p);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), was, 'Undo did not return the slot as it was');
  });
});

// SV2-54b: the drawing that scrolls to a slot's address puts the focus in
// the slot's first control. When that is the room picker being typed in (the
// slot's address asked for again, as a second Show on it does), the picker
// is handed over there as at any drawing: before, the typed text and the
// highlight were dropped there and the new field opened on the slot's old
// text, with nothing said.
test('SV2-54b: a slot\'s address asked for again while its room field is being typed in carries the text and the highlight over: "10", ArrowDown, the address, Enter is Room 101 and one change', async () => {
  const address = '#schedule/groups/' + A6 + '/' + DAY_A + '/1';
  await on(address, DESK, async (p) => {
    const key = 'slot:' + DAY_A + ':1:room';
    const field = slotField(DAY_A, 1);
    const row = slotRow(DAY_A, 1);
    await keyIs(p, key);
    const was = await stored(p, A6, DAY_A, 1);
    assert.notEqual(was.room, 'rsample101', 'the case needs a slot that is not Room 101');
    await typeOver(p, field, '10');
    await p.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(p, row), ['rsample101']);
    const before = await p.$(field);
    const start = await depth(p);
    await p.evaluate((hash) => globalThis.sv2.ctx.navigate(hash), address);
    await settled(p);
    assert.equal(await p.evaluate((el) => el.isConnected, before), false, 'the case needs the field drawn again by the scroll to the slot');
    assert.equal(await p.$eval(row, (tr) => tr.dataset.shown), 'true', 'the case needs the row marked as the address\'s slot');
    assert.equal(await activeKey(p), key);
    assert.equal(await p.$eval(field, (el) => el.value), '10', 'the typed text was lost at the scroll to the slot');
    assert.deepEqual(await highlighted(p, row), ['rsample101'], 'the highlight was lost at the scroll to the slot');
    assert.deepEqual(await stored(p, A6, DAY_A, 1), was, 'the drawing committed the half-typed text');
    assert.equal(await depth(p), start, 'the drawing made an entry');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === '101 — Ms. Halloran', field);
    assert.deepEqual(await stored(p, A6, DAY_A, 1), { room: 'rsample101', roomText: '' });
    assert.equal(await depth(p), start + 1, 'Enter after the drawing made more than one entry');
  });
});

test('SV2-54 item 4: a phone turned upright after a group was chosen while it lay on its side leaves the list and that group in the history, never the list twice', async () => {
  const UPRIGHT = { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  const SIDE = { width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  await on('#project', { width: 390, height: 844, mobile: true }, async (p) => {
    await go(p, '#schedule/groups');
    await settled(p);
    await tap(p, '.sch-group[data-group="' + B6 + '"]');
    await listIs(p, true);
    await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + B6);
    await p.setViewport(SIDE);
    await drawnNarrow(p, false);
    await p.click('.sch-group[data-group="' + C6 + '"]');
    await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === '6C' && document.querySelector('.sch').dataset.pending !== 'true');
    await p.setViewport(UPRIGHT);
    await drawnNarrow(p, true);
    assert.deepEqual(await shownCards(p), [C6]);
    assert.equal(await hashOf(p), '#schedule/groups/' + C6);
    assert.deepEqual(await backTo(p, '#project', 4), ['#schedule/groups/' + C6, '#schedule/groups', '#project'], 'the history from 6C back to Project');
  });
});

test('SV2-54 item 5: Forward after a Delete or an undone Add never lands on the gone group, nor shows the list twice; also from an entry the list was not under, and after a reload', async () => {
  // a Delete and an undone Add, from editors chosen in the list
  for (const how of ['delete', 'undone add']) {
    await on('#project', PHONE, async (p) => {
      await go(p, '#schedule/groups');
      await settled(p);
      let gone;
      if (how === 'delete') {
        await tap(p, '.sch-group[data-group="' + C6 + '"]');
        await listIs(p, true);
        await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + C6);
        gone = C6;
        await tap(p, '[data-action="delete"]');
        await closeToast(p);
      } else {
        await tap(p, '[data-action="add-group"]');
        await listIs(p, true);
        await shows(p, () => /^#schedule\/groups\/g/.test(location.hash));
        gone = (await hashOf(p)).split('/').pop();
        await p.evaluate(() => globalThis.sv2.store.undo());
      }
      await listIs(p, false);
      await until(p, how + ': not on the list', () => location.hash === '#schedule/groups');
      await step(p, 'forward');
      // the page steps back off the spent entry it was taken to (groups.js)
      await until(p, how + ': Forward was left on the spent entry', () => !(history.state && history.state.scheduleSpent) && document.querySelector('.sch')?.dataset.pending !== 'true');
      assert.equal(await hashOf(p), '#schedule/groups', how + ': Forward landed on the gone group\'s address');
      assert.notEqual(await hashOf(p), '#schedule/groups/' + gone);
      await listIs(p, false);
      assert.deepEqual(await backTo(p, '#project', 3), ['#schedule/groups', '#project'], how + ': Back after Forward showed the list twice');
    });
  }
  // an entry the list was not under: the group's address came to from Project
  await on('#project', PHONE, async (p) => {
    await go(p, '#schedule/groups/' + C6);
    await listIs(p, true);
    await tap(p, '[data-action="delete"]');
    await closeToast(p);
    await listIs(p, false);
    assert.equal(await hashOf(p), '#schedule/groups');
    assert.deepEqual(await backTo(p, '#project', 3), ['#schedule/groups', '#project']);
    await step(p, 'forward');
    await waitForSection(p, 'schedule');
    await listIs(p, false);
    assert.equal(await hashOf(p), '#schedule/groups', 'Forward from Project landed on the gone group\'s address');
  });
  // a reload between the Delete and Forward
  await on('#project', PHONE, async (p) => {
    await go(p, '#schedule/groups');
    await settled(p);
    await tap(p, '.sch-group[data-group="' + C6 + '"]');
    await listIs(p, true);
    await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + C6);
    await tap(p, '[data-action="delete"]');
    await listIs(p, false);
    await shows(p, () => location.hash === '#schedule/groups');
    await p.reload();
    await waitForSection(p, 'schedule');
    await settled(p);
    await p.evaluate(() => history.forward());
    // a step to an entry another document made may load the page again
    await untilAcrossLoads(p, 'after a reload Forward never came back to the list', () => location.hash === '#schedule/groups'
      && !(history.state && history.state.scheduleSpent)
      && document.querySelector('.sch')?.dataset.pending !== 'true'
      && document.querySelector('.sch-groups')?.dataset.folded === 'false');
    assert.equal(await hashOf(p), '#schedule/groups', 'after a reload Forward landed on the gone group\'s address');
    assert.deepEqual(await backTo(p, '#project', 3), ['#schedule/groups', '#project'], 'after a reload the list is twice in the history');
  });
});

// The review of SV2-54 (probe-wide-delete.mjs): a group chosen on a phone,
// the phone turned on its side, the group deleted there or its Add undone
// (a wide screen writes no address, so the page stays on the gone group's),
// turned upright. Before, the turn left the gone group's entry above the
// list as a second list: "All groups" from the next group went back to it,
// and Back from there was the list again.
test('SV2-56 item 1: a Delete or an undone Add while wide, then upright, a tap on another group, All groups and Back never shows the list twice', async () => {
  const UPRIGHT = { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  const SIDE = { width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  for (const how of ['delete', 'undone add', 'delete, then a group chosen wide']) {
    await on('#project', { width: 390, height: 844, mobile: true }, async (p) => {
      await go(p, '#schedule/groups');
      await settled(p);
      if (how === 'undone add') {
        await tap(p, '[data-action="add-group"]');
        await listIs(p, true);
        await shows(p, () => /^#schedule\/groups\/g/.test(location.hash) && !location.hash.includes('gsample'));
      } else {
        await tap(p, '.sch-group[data-group="' + C6 + '"]');
        await listIs(p, true);
        await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + C6);
      }
      const gone = await hashOf(p);
      await p.setViewport(SIDE);
      await drawnNarrow(p, false);
      if (how === 'undone add') await p.evaluate(() => globalThis.sv2.store.undo());
      else await p.click('[data-action="delete"]');
      await closeToast(p);
      await until(p, how + ': the group is still in the list', (id) => !document.querySelector('.sch-group[data-group="' + id + '"]') && document.querySelector('.sch').dataset.pending !== 'true', gone.split('/').pop());
      assert.equal(await hashOf(p), gone, how + ': the case needs the wide screen to have left the gone group\'s address');
      if (how === 'delete, then a group chosen wide') {
        await p.click('.sch-group[data-group="' + B6 + '"]');
        await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === '6B' && document.querySelector('.sch').dataset.pending !== 'true');
        await p.setViewport(UPRIGHT);
        await drawnNarrow(p, true);
        await until(p, how + ': turned upright, the page is not at 6B\'s address', (hash) => location.hash === hash, '#schedule/groups/' + B6);
        assert.deepEqual(await backTo(p, '#project', 4), ['#schedule/groups/' + B6, '#schedule/groups', '#project'], how + ': the history from 6B back to Project');
        return;
      }
      await p.setViewport(UPRIGHT);
      await drawnNarrow(p, true);
      await listIs(p, false);
      await until(p, how + ': turned upright, the page is still at the gone group\'s address', () => location.hash === '#schedule/groups' && !(history.state && history.state.scheduleSpent));
      await tap(p, '.sch-group[data-group="' + B6 + '"]');
      await listIs(p, true);
      await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + B6);
      await tap(p, '[data-key="group-all"]');
      await listIs(p, false);
      await until(p, how + ': "All groups" did not come back to the list', () => location.hash === '#schedule/groups');
      assert.deepEqual(await backTo(p, '#project', 4), ['#schedule/groups', '#project'], how + ': Back from the list showed the list twice');
    });
  }
});

// The review of SV2-56 (probe-history.mjs, A): the same with the only
// group. The turn upright did nothing when the project had no groups left,
// so the gone group's entry stayed above the list: "Add a group", "All
// groups" and Back showed the list twice.
test('SV2-56b: the only group deleted while wide, then upright, Add a group, All groups and Back never shows the list twice', async () => {
  const UPRIGHT = { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  const SIDE = { width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  await on('#project', { width: 390, height: 844, mobile: true }, async (p) => {
    await loadModule(p, 'actions', 'engine/actions.js');
    await p.evaluate((keep) => {
      const { actions } = globalThis.sv2modules;
      for (const group of globalThis.sv2.store.project.groups.slice()) {
        if (group.id !== keep) globalThis.sv2.store.apply(actions.deleteGroup, { id: group.id });
      }
    }, C6);
    assert.deepEqual(await p.evaluate(() => globalThis.sv2.store.project.groups.map((group) => group.id)), [C6], 'the case needs 6C to be the only group');
    await go(p, '#schedule/groups');
    await settled(p);
    await tap(p, '.sch-group[data-group="' + C6 + '"]');
    await listIs(p, true);
    await shows(p, (hash) => location.hash === hash, '#schedule/groups/' + C6);
    await p.setViewport(SIDE);
    await drawnNarrow(p, false);
    await p.click('[data-action="delete"]');
    await closeToast(p);
    await until(p, 'the only group was not deleted', () => document.querySelector('[data-action="add-group"]') && !document.querySelector('.sch-group') && document.querySelector('.sch').dataset.pending !== 'true');
    assert.equal(await hashOf(p), '#schedule/groups/' + C6, 'the case needs the wide screen to have left the gone group\'s address');
    await p.setViewport(UPRIGHT);
    await drawnNarrow(p, true);
    await until(p, 'turned upright with no groups left, the page is still at the gone group\'s address', () => location.hash === '#schedule/groups');
    await tap(p, '[data-action="add-group"]');
    await listIs(p, true);
    await shows(p, () => /^#schedule\/groups\/g/.test(location.hash) && !location.hash.includes('gsample'));
    await tap(p, '[data-key="group-all"]');
    await listIs(p, false);
    await until(p, '"All groups" did not come back to the list', () => location.hash === '#schedule/groups');
    assert.deepEqual(await backTo(p, '#project', 4), ['#schedule/groups', '#project'], 'Back from the list showed the list twice');
  });
});

// ---------------------------------------------------------------- SV2-72e

// The review of SV2-56, finding 3 (probe-history.mjs, B): a finding's Show
// beside the list (the inspector's panel, on a phone on its side) opened the
// slot's address over the list with no mark, so a Delete on the phone, or
// one on its side and then the turn upright, wrote the list in its place:
// Back from the list was the list again. Every group or slot address the
// schedule opens goes through one rule now (groups.js, `openAddress`).
test('SV2-72e item 1: a finding\'s Show over the list, then a Delete on the phone or on its side and upright: Back from the list is the page before it, the list once', async () => {
  const UPRIGHT = { width: 390, height: 844, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  const SIDE = { width: 844, height: 390, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
  const slot = '#schedule/groups/' + C6 + '/' + DAY_A + '/1';
  for (const where of ['upright', 'on its side']) {
    await on('#project', { width: 844, height: 390, mobile: true }, async (p) => {
      await go(p, '#schedule/groups');
      await settled(p);
      await p.click('.sch-group[data-group="' + C6 + '"]');
      await shows(p, () => document.querySelector('.sch-editor__title')?.textContent === '6C' && document.querySelector('.sch').dataset.pending !== 'true');
      assert.equal(await hashOf(p), '#schedule/groups', 'the case needs the page at the list, as a wide screen leaves it after a click');
      await inspector(p, true);
      await tap(p, '#inspector .sch-finding[data-finding^="room-double:' + DAY_A + ':1:"] [data-action="show"]');
      await until(p, 'Show did not go to the slot\'s address', (hash) => location.hash === hash && document.querySelector('.sch').dataset.pending !== 'true', slot);
      await inspector(p, false);
      if (where === 'upright') {
        await p.setViewport(UPRIGHT);
        await drawnNarrow(p, true);
        assert.deepEqual(await shownCards(p), [C6]);
        await tap(p, '[data-action="delete"]');
      } else {
        await p.click('[data-action="delete"]');
        await closeToast(p);
        await until(p, '6C is still in the list', (id) => !document.querySelector('.sch-group[data-group="' + id + '"]') && document.querySelector('.sch').dataset.pending !== 'true', C6);
        assert.equal(await hashOf(p), slot, 'the case needs the wide screen to have left the gone group\'s address');
        await p.setViewport(UPRIGHT);
        await drawnNarrow(p, true);
      }
      await closeToast(p);
      await listIs(p, false);
      await until(p, where + ': the page is not at the list, or is on a spent entry', () => location.hash === '#schedule/groups' && !(history.state && history.state.scheduleSpent) && document.querySelector('.sch').dataset.pending !== 'true');
      assert.deepEqual(await backTo(p, '#project', 4), ['#schedule/groups', '#project'], where + ': Back from the list showed the list twice');
    });
  }
});

// SV2-54's case "from an entry the list was not under", with the link that
// makes such an entry: Movement's "Fix it in the schedule" opens a slot's
// address from #movement, by the same rule. There is no list under it, so
// the gone group's address becomes the list's, and Back is Movement.
test('SV2-72e item 1: Movement\'s link into a slot, then a Delete on a phone: the list in the slot\'s place, and Back is Movement', async () => {
  await on('#project', { width: 390, height: 844, mobile: true }, async (p) => {
    await go(p, '#movement');
    await shows(p, () => document.querySelector('.mov')?.movement?.env !== undefined);
    await p.evaluate((slot) => document.querySelector('.mov').movement.env.fix({ slot }), { groupId: C6, dayTypeId: DAY_A, period: 2 });
    await waitForSection(p, 'schedule');
    await settled(p);
    await listIs(p, true);
    assert.equal(await hashOf(p), '#schedule/groups/' + C6 + '/' + DAY_A + '/2');
    assert.equal(await p.evaluate(() => history.state), null, 'opened from Movement, the entry is not marked as having the list under it');
    await tap(p, '[data-action="delete"]');
    await closeToast(p);
    await listIs(p, false);
    await until(p, 'the Delete did not come to the list', () => location.hash === '#schedule/groups' && document.querySelector('.sch').dataset.pending !== 'true');
    assert.deepEqual(await backTo(p, '#movement', 3), ['#schedule/groups', '#movement']);
  });
});

test('SV2-54 item 5: on a phone a tap on the chosen card, on a slot\'s address Show went to, adds nothing to the history', async () => {
  await on('#schedule/groups', PHONE, async (p) => {
    await act(p, 'setSlot', { groupId: C6, dayTypeId: DAY_A, period: 3, slot: { label: 'Choir' } });
    await listIs(p, false);
    await p.evaluate(() => globalThis.sv2.ctx.undo());
    await shows(p, () => document.querySelector('.toast .toast__action')?.textContent === 'Show');
    await tap(p, '.toast .toast__action');
    await shows(p, () => location.hash !== '#schedule/groups');
    await listIs(p, true);
    await closeToast(p);
    const slot = '#schedule/groups/' + C6 + '/' + DAY_A + '/3';
    assert.equal(await hashOf(p), slot);
    const length = await p.evaluate(() => history.length);
    await tap(p, '.sch-group[data-group="' + C6 + '"]');
    await settled(p);
    await listIs(p, true);
    assert.equal(await p.evaluate(() => history.length), length, 'the tap on the chosen card made an entry');
    assert.deepEqual(await backTo(p, '#schedule/groups', 3), [slot, '#schedule/groups']);
  });
});

// Seen by the Foreman at 390 by 844: the chosen card was scrolled to the
// surface's very top, its edge under the top bar's (48.9 against 49).
test('SV2-54 item 9: on a phone the chosen group\'s card arrives clear of the top bar, with paper between them', async () => {
  await on('#schedule/groups', { width: 390, height: 844, mobile: true }, async (p) => {
    for (const group of [B6, 'gsample08b']) {
      if (await box(p, '[data-key="group-all"]')) {
        await tap(p, '[data-key="group-all"]');
        await listIs(p, false);
      }
      await tap(p, '.sch-group[data-group="' + group + '"]');
      await listIs(p, true);
      const where = await p.evaluate((g) => {
        const card = document.querySelector('.sch-group[data-group="' + g + '"]').getBoundingClientRect();
        const bar = document.getElementById('topbar').getBoundingClientRect();
        return { card: card.top, bar: bar.bottom, scrolled: document.getElementById('surface').scrollTop };
      }, group);
      assert.ok(where.scrolled > 0, 'the case needs the surface scrolled to the card');
      assert.ok(where.card >= where.bar + 8, group + ': the card\'s top edge is at ' + where.card.toFixed(1) + ', the bar\'s foot at ' + where.bar.toFixed(1));
      assert.ok(where.card <= where.bar + 32, group + ': the card is not at the top of the surface (' + where.card.toFixed(1) + ')');
    }
  });
});

test('SV2-54 item 8: an address that chooses nothing new redraws the inspector alone, and the focus in it stays on its control', async () => {
  await on('#schedule/checks', DESK, async (p) => {
    await p.click('.sch-checks .sch-findings tbody tr:nth-child(1) .sch-finding__what');
    await shows(p, () => document.querySelector('#inspector .sch-panel__scope')?.textContent === 'The finding selected');
    const control = '#inspector .sch-panel__list [data-action="accept"]';
    const key = await p.$eval(control, (el) => el.dataset.key);
    await p.focus(control);
    const old = await p.$(control);
    // the same address again (a link to where the page is): route() is asked, and draws the inspector
    await p.evaluate(() => globalThis.sv2.ctx.navigate('#schedule/checks'));
    assert.equal(await p.evaluate((el) => el.isConnected, old), false, 'the case needs the inspector drawn again');
    assert.equal(await onPage(p), false, 'the focus fell to the page');
    assert.equal(await activeKey(p), key);
  });
});
