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
const shows = (page, fn, ...args) => page.waitForFunction(fn, { timeout: 5000 }, ...args);
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
// A finger's tap on what a selector finds, brought to the middle of the
// window first (a phone's inspector handle and bottom bar are over its foot).
async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  const at = await box(page, selector);
  await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
}
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
// What a slot holds in the store.
const stored = (page, groupId, day, period) => page.evaluate((g, d, p) => {
  const slot = globalThis.sv2.store.project.groups.find((group) => group.id === g).days[d][p];
  return { room: slot.room, roomText: slot.roomText };
}, groupId, day, period);
const act = (page, name, payload) => page.evaluate(async (action, given) => {
  const actions = await import('./engine/actions.js');
  globalThis.sv2.store.apply(actions[action], given);
}, name, payload);

// A page of its own for a case: the sample school, nothing saved.
async function open(hash, size, options) {
  const session = await openPlanner({ server, browser, hash, theme: 'light', ...size, ...(options || {}) });
  if (hash.startsWith('#schedule')) {
    await session.page.waitForFunction(() => getComputedStyle(document.querySelector('.sch')).containerType === 'inline-size');
    await settled(session.page);
  }
  return session;
}

// Run a case on its own page, and hold the page to having had no error.
async function on(hash, size, run, options) {
  const session = await open(hash, size, options);
  try {
    await run(session.page, session);
  } finally {
    const found = session.problems();
    await session.page.close();
    assert.deepEqual(found, CLEAN);
  }
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
  assert.match(source('ui/app.css'), /\.surface__layout\[data-section="movement"\] \{\n {2}height: 100%;\n {2}padding: 0;/);
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
    await p.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
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
  // the page is given a moment to move
  await p.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const at = await p.evaluate(() => {
    const rows = document.querySelectorAll('.sch-edit-table tbody tr');
    const row = rows[rows.length - 1].getBoundingClientRect();
    const toast = document.querySelector('.toast').getBoundingClientRect();
    const surface = document.getElementById('surface').getBoundingClientRect();
    return { row: [row.top, row.bottom], toast: [toast.top, toast.bottom], surface: [surface.top, surface.bottom] };
  });
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

    // as it is typed: the list says what will happen, and the field is marked
    await p.click(first);
    await p.keyboard.type('Portable 9');
    assert.equal(await text(p, slotRow(DAY_A, 0) + ' .picker__empty'), 'No room matches. It is kept as typed, and marked as not in the building.');
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
    await go(p, '#schedule/groups');
    await p.click('[data-action="add-group"]');
    await keyIs(p, 'group-name');
    const day = await p.evaluate(() => globalThis.sv2.store.project.dayTypes[0].id);
    const group = await p.evaluate(() => globalThis.sv2.store.project.groups[0].id);
    const field = slotField(day, 0);
    await p.click(field);
    const line = slotRow(day, 0) + ' .picker__list > li';
    assert.equal(await count(p, line), 1);
    assert.equal(await text(p, line), 'No rooms in the building yet. Number them in Building.');
    assert.equal(await p.$eval(line + ' a', (a) => a.getAttribute('href')), '#building');
    await p.keyboard.type('B12');
    assert.equal(await text(p, line), 'No rooms in the building yet. Number them in Building.');
    await p.keyboard.press('Enter');
    await shows(p, (selector) => document.querySelector('.sch').dataset.pending !== 'true' && document.querySelector(selector).value === 'B12', field);
    assert.deepEqual(await stored(p, group, day, 0), { room: null, roomText: 'B12' });
    // the line's link, pressed
    await p.click(slotField(day, 1));
    await p.waitForSelector(slotRow(day, 1) + ' .picker__list > li a');
    await p.click(slotRow(day, 1) + ' .picker__list > li a');
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
    for (const row of rows) {
      assert.deepEqual(row.buttons.map((button) => button.label), ['Show', 'Fix…', 'Accept']);
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
    const cards = () => p.$$eval('.sch-group', (all) => all.filter((each) => each.getClientRects().length > 0).map((each) => each.dataset.group));
    // nothing chosen yet: every card, no editor, and the inspector says so
    assert.equal((await cards()).length, 8);
    assert.equal(await box(p, '.sch-editor'), null, 'the editor is on the page under the whole list');
    assert.equal(await box(p, '[data-key="group-all"]'), null);
    await p.click('#inspector-toggle');
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'Choose a group');
    assert.equal(await text(p, '#inspector .sch-panel__none'), 'Choose a group in the list, and what was found about it shows here.');
    assert.equal(await count(p, '#inspector .sch-finding'), 0);
    assert.deepEqual(await p.$eval('#inspector .sch-counts', (el) => [el.dataset.problem, el.dataset.warning, el.dataset.note]), ['1', '1', '2'], 'the counts are always there');
    await p.click('#inspector-toggle');

    // a tap on 6B, with its card at the foot of the window: the editor that
    // opens under it would be out of sight if the card stayed there
    await p.$eval('.sch-group[data-group="' + B6 + '"]', (el) => el.scrollIntoView({ block: 'end' }));
    const card = await box(p, '.sch-group[data-group="' + B6 + '"]');
    assert.ok(card.bottom > 560, 'the card is not at the foot of the window');
    await p.touchscreen.tap(card.left + card.width / 2, card.top + card.height / 2);
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
    await p.click('#inspector-toggle');
    assert.equal(await text(p, '#inspector .sch-panel__scope'), 'About 6B');
    await p.click('#inspector-toggle');

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
    assert.ok(top.top > 380 && top.bottom < 660, 'the first card is not in the lower half of the window: ' + JSON.stringify(top));
    await p.touchscreen.tap(top.left + top.width / 2, top.top + top.height / 2);
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

// ---------------------------------------------------------------- 14: Fix… says why

test('Fix… is not built yet: it is drawn dashed, says so in its title, and a press says the same in a message, by pointer and by keyboard', async () => {
  await on('#schedule/checks', DESK, async (p) => {
    const fix = '.sch-checks .sch-findings tbody tr [data-action="fix"]';
    assert.equal(await p.$eval(fix, (el) => [el.getAttribute('aria-disabled'), el.title, el.disabled, getComputedStyle(el).borderTopStyle].join('|')), 'true|Suggestions are not built yet|false|dashed');
    await p.click(fix);
    assert.equal(await text(p, '.toast .toast__text'), 'Suggestions are not built yet.');
    assert.equal(await p.evaluate(() => location.hash), '#schedule/checks');
    assert.equal(await count(p, 'dialog[open]'), 0);
    await closeToast(p);
    assert.equal(await count(p, '.toast'), 0);
    await p.focus(fix);
    await p.keyboard.press('Enter');
    assert.equal(await text(p, '.toast .toast__text'), 'Suggestions are not built yet.');
    await closeToast(p);
    // the inspector's Fix… too
    await go(p, '#schedule/teachers');
    await settled(p);
    await p.focus('#inspector [data-action="fix"]');
    await p.keyboard.press(' ');
    assert.equal(await text(p, '.toast .toast__text'), 'Suggestions are not built yet.');
  });
});

test('Fix… says why to a finger too', async () => {
  await on('#schedule/checks', PHONE, async (p) => {
    await tap(p, '.sch-checks .sch-findings tbody tr [data-action="fix"]');
    await p.waitForSelector('.toast');
    assert.equal(await text(p, '.toast .toast__text'), 'Suggestions are not built yet.');
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

// ---------------------------------------------------------------- 19: the screens

test('the sweeps have the three screens the walk-through missed, and each opens', async () => {
  const wanted = {
    'schedule-room-not-in-building': async (p) => {
      assert.equal(await p.$eval('.sch-slot .sch-room__missing:not([hidden])', (el) => el.textContent), '▲ Not in the building. It is kept as typed.');
      assert.equal(await count(p, '.sch-slot .picker__list:not([hidden]) .picker__empty'), 1, 'the picker\'s list is not open on its one line');
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
  } finally {
    const found = session.problems();
    await session.page.close();
    assert.deepEqual(found, CLEAN);
  }
});
