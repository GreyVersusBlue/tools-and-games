// M5 after the walk-through of it, in a real browser (spec 9, 10, 18;
// DESIGN 5.4 and 5.5): node test/browser/m5-pass.mjs
//
// The spec 18 journeys "run a scenario and apply it" and "print door
// cards", and Fix… to Try it to Apply, each driven by the keyboard alone at
// 1280 by 800 and by a finger alone at 390 by 844. A journey counts the
// pointer and key events the page received and fails on any of the other
// kind: a keyboard journey that clicked once, or a touch journey that
// pressed a key or moved a mouse, is not the journey it says it is. The one
// stand-in: a native select is chosen with page.select() after the finger's
// tap on it, as the phone's own picker would (a headless browser draws
// none). Fixtures are put in through the store's actions before a journey
// starts; nothing a journey checks is done that way.
//
// Also, from batch 17 and SV2-72e: at 844 by 390 with touch Movement and the
// lab put every floor on the stage at Fit and none under the sticky foot,
// and the layout settles (the fit and the legend's dock counted); the shell's
// own Show, on the message an Undo leaves, opens a group's address marked as
// having the list under it, so a Delete on a phone leaves the list once.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, launch, startServer, waitForSection } from './harness.mjs';

const DAY_A = 'dsample00a';
const C6 = 'gsample06c';
const CLASH = 'room-double:' + DAY_A + ':2:rsample103';
const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };
const SIDE = { width: 844, height: 390, mobile: true };
const CLEAN = { errors: [], blocked: [], shimmed: [] };

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

// ---------------------------------------------------------------- helpers

// A page of its own for a case, closed after, and what the page itself said
// went wrong asserted empty.
async function on(hash, size, run) {
  const session = await openPlanner({ server, browser, hash, theme: 'light', ...size });
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

// A wait for a state the page sets that an assertion depends on: when the
// state never comes, the case fails saying `why`.
async function until(page, why, fn, ...args) {
  try {
    await page.waitForFunction(fn, { timeout: 15000 }, ...args);
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    assert.fail(why + ' (waited 15 s for: ' + String(fn).replace(/\s+/g, ' ').slice(0, 160) + ')');
  }
}

// A module of the tool put on the page as globalThis.sv2modules[key] by a
// module script the page loads itself, and waited for by its key; a failed
// load is kept as `{ error }` and said (SV2-72e2). An import() awaited inside
// page.evaluate came back "Promise was collected" (SV2-72e). A load of the
// page empties the globals; the module is loaded again.
async function loadModule(page, key, file) {
  const held = (wanted) => {
    const value = globalThis.sv2modules && globalThis.sv2modules[wanted];
    if (!value) return null;
    return { error: value[Symbol.toStringTag] === 'Module' ? null : String(value.error) };
  };
  let state = await page.evaluate(held, key);
  if (state === null) {
    const name = JSON.stringify(key);
    await page.addScriptTag({ type: 'module', content: 'const modules = (globalThis.sv2modules ||= {}); import(' + JSON.stringify('./' + file) + ').then((module) => { modules[' + name + '] = module; }, (error) => { modules[' + name + '] = { error: String((error && error.message) || error) }; });' });
    state = await (await page.waitForFunction(held, { timeout: 10000 }, key)).jsonValue();
  }
  if (state.error !== null) {
    await page.evaluate((wanted) => delete globalThis.sv2modules[wanted], key);
    throw new Error('loadModule: ' + file + ' did not load: ' + state.error);
  }
}

// A fixture: the sample school, `alter` (a function body over `project`)
// applied to it, put in with the store's replace; then each action given.
async function fixture(page, alter, actions) {
  await loadModule(page, 'actions', 'engine/actions.js');
  await loadModule(page, 'sample', 'data/sample-school.js');
  await page.evaluate((body, steps) => {
    const { actions } = globalThis.sv2modules;
    const project = globalThis.sv2modules.sample.sampleSchool();
    project.onboarding.dismissed = true;
    if (body) new Function('project', body)(project);
    globalThis.sv2.store.replace(project);
    for (const [name, payload] of steps || []) globalThis.sv2.store.apply(actions[name], payload);
  }, alter || null, actions || []);
}

// Every pointer and key event the page gets from here on, counted by kind;
// a journey reads it at its end (journeyWas).
async function countInput(page) {
  await page.evaluate(() => {
    const seen = { keys: 0, touch: 0, mouse: 0, pen: 0 };
    globalThis.__m5input = seen;
    window.addEventListener('keydown', () => {
      seen.keys += 1;
    }, true);
    window.addEventListener('pointerdown', (event) => {
      seen[event.pointerType] = (seen[event.pointerType] || 0) + 1;
    }, true);
    window.addEventListener('mousemove', (event) => {
      // a mouse moved over the page with no pointer down; a touch's own compatibility events come with a touch pointer
      if (!event.sourceCapabilities || !event.sourceCapabilities.firesTouchEvents) seen.mousemoved = (seen.mousemoved || 0) + 1;
    }, true);
  });
}
async function journeyWas(page, kind) {
  const seen = await page.evaluate(() => globalThis.__m5input);
  if (kind === 'keyboard') {
    assert.equal(seen.mouse + seen.touch + seen.pen + (seen.mousemoved || 0), 0, 'the keyboard journey used a pointer: ' + JSON.stringify(seen));
    assert.ok(seen.keys > 0, 'no key was pressed: ' + JSON.stringify(seen));
  } else {
    assert.equal(seen.keys + seen.mouse + seen.pen + (seen.mousemoved || 0), 0, 'the touch journey used a key or a mouse: ' + JSON.stringify(seen));
    assert.ok(seen.touch > 0, 'no finger touched the page: ' + JSON.stringify(seen));
  }
}

// What the focus is on, as a selector would find it.
const focusIs = (page, selector) => page.evaluate((wanted) => {
  const el = document.activeElement;
  return Boolean(el) && el !== document.body && el.matches(wanted);
}, selector);

// Tab (or Shift+Tab) until the focus is on what `selector` finds, at most
// `most` presses: the control is reached by the keyboard, in the page's
// own order.
async function tabTo(page, selector, options) {
  const { back = false, most = 80 } = options || {};
  for (let press = 0; press <= most; press += 1) {
    if (await focusIs(page, selector)) return press;
    if (back) {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
    } else {
      await page.keyboard.press('Tab');
    }
  }
  const at = await page.evaluate(() => document.activeElement && (document.activeElement.outerHTML || '').slice(0, 160));
  throw new Error(most + ' presses of ' + (back ? 'Shift+Tab' : 'Tab') + ' did not reach ' + selector + '; the focus is on ' + at);
}

// A section's digit, pressed with the focus on the page and nothing in a field.
async function sectionKey(page, digit, id) {
  await page.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  });
  await page.keyboard.press(String(digit));
  await waitForSection(page, id);
}

// The box of what a selector finds, or null when it has none.
const box = (page, selector) => page.evaluate((wanted) => {
  const el = document.querySelector(wanted);
  if (!el || el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}, selector);

// A finger's tap on the middle of what a selector finds, brought into the
// middle of its scroller first and waited for until nothing lies over it.
async function tap(page, selector) {
  await until(page, selector + ' has no box', (wanted) => {
    const el = document.querySelector(wanted);
    return Boolean(el) && el.getClientRects().length > 0;
  }, selector);
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await until(page, 'something lies over ' + selector, (wanted) => {
    const el = document.querySelector(wanted);
    if (!el || el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit) && (el === hit || el.contains(hit) || (el.labels && Array.from(el.labels).some((label) => label.contains(hit))));
  }, selector);
  const at = await box(page, selector);
  await page.touchscreen.tap(at.left + at.width / 2, at.top + at.height / 2);
}

// A native select chosen by a finger: the tap on it, then the value, as the
// phone's own picker would set it.
async function tapSelect(page, selector, value) {
  await tap(page, selector);
  await page.select(selector, value);
}

const slotRoom = (page, groupId, dayTypeId, period) => page.evaluate((g, d, p) => globalThis.sv2.store.project.groups.find((each) => each.id === g).days[d][p].room, groupId, dayTypeId, period);
const scenarioOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));

// The lab drawn for the store's project and its comparison settled
// (answered for the store as it is, or nothing open).
async function labReady(page) {
  await until(page, 'the lab did not settle', () => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  });
}

// Safety drawn for the store's project, its picture worked out and painted.
async function safetyReady(page) {
  await until(page, 'Safety did not settle', () => {
    const el = document.querySelector('.sfy');
    if (!el || el.dataset.styled !== 'true' || !el.safety || !el.safety.picture) return false;
    if (el.safety.plan.project !== globalThis.sv2.store.project) return false;
    const canvas = document.getElementById('safety-plan');
    return canvas.getClientRects().length > 0 && el.safety.plan.view.width > 0 && Number(canvas.dataset.drawn || 0) > 0;
  });
}

// The print preview's document once it is laid out: the cards in print
// order, the paper, the number of sheets.
async function preview(page) {
  await until(page, 'the print preview did not lay its document out', () => Boolean(document.querySelector('#print-preview[open][data-ready="true"]')));
  return page.evaluate(() => {
    const sheet = document.getElementById('print-preview');
    const doc = sheet.querySelector('iframe').contentDocument;
    const cards = [];
    for (const card of doc.querySelectorAll('.card[data-card]')) if (!cards.includes(card.dataset.card)) cards.push(card.dataset.card);
    return {
      output: doc.documentElement.dataset.output,
      paper: doc.documentElement.dataset.paper + ' ' + doc.documentElement.dataset.orientation,
      cards,
      cover: Array.from(doc.querySelectorAll('.card-cover__list li')).map((li) => li.dataset.room),
      names: Array.from(doc.querySelectorAll('.card__name')).map((el) => el.textContent),
      text: doc.body.textContent,
    };
  });
}

// The engine's findings for the store as it is now, by id.
const findingIds = (page) => page.evaluate(async () => {
  const answer = await globalThis.sv2.store.derived.results();
  return answer.findings.findings.map((finding) => finding.id);
});

// ------------------------------------------- batch 17: Fit at 844 by 390

// Where every floor lies on a mounted plan map now, against its stage and
// the sticky foot over it, in the page's pixels; and what the fit chose.
const floorsAt = (page, which) => page.evaluate((name) => {
  const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
  const stage = plan.stage.getBoundingClientRect();
  const foot = (name === 'movement' ? document.querySelector('[data-bar="playback"]') : document.querySelector('.scn-bar'));
  const footTop = foot && foot.getClientRects().length > 0 ? foot.getBoundingClientRect().top : Infinity;
  const size = 24 * plan.view.zoom;
  // a floor's box with its name row (two cells over it)
  const floors = plan.world.slots.map((slot) => ({
    name: slot.floor.name,
    left: stage.left + plan.view.x + slot.x * size,
    right: stage.left + plan.view.x + (slot.x + slot.w) * size,
    top: stage.top + plan.view.y + (slot.y - 2) * size,
    bottom: stage.top + plan.view.y + (slot.y + slot.h) * size,
  }));
  return { stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom }, footTop, fit: plan.stage.dataset.fit, zoom: plan.view.zoom, floors, scroll: plan.root.scrollTop };
}, which);

function offStage(at) {
  const off = [];
  for (const floor of at.floors) {
    if (floor.left < at.stage.left - 0.5 || floor.right > at.stage.right + 0.5 || floor.top < at.stage.top - 0.5 || floor.bottom > at.stage.bottom + 0.5) off.push(floor.name + ' off the stage');
    if (floor.bottom > at.footTop + 0.5) off.push(floor.name + ' under the foot by ' + (floor.bottom - at.footTop).toFixed(1) + ' px');
  }
  return off;
}

// The map laid out and painted, and measured where the section is scrolled
// now (data-docked-at: dock() ran since the last scroll).
async function mapSettled(page, which) {
  await until(page, which + '\'s map did not lay itself out', (name) => {
    const plan = name === 'movement' ? document.querySelector('.mov')?.movement?.plan : document.querySelector('.scn')?.scenarios?.plan;
    if (!plan || plan.root.dataset.styled !== 'true' || !plan.world || !plan.stage.dataset.fit) return false;
    return Number(plan.canvas.dataset.drawn || 0) > 0 && plan.root.dataset.dockedAt === String(Math.round(plan.root.scrollTop));
  }, which);
}

// Counted from here: each change of the stage's fit (data-fit) and of
// Movement's legend dock (data-docked). A fit or a dock that judges the
// layout it made can make two layouts choose each other (SV2-72c3).
const countTurns = (page, which) => page.evaluate((name) => {
  const plan = name === 'movement' ? document.querySelector('.mov').movement.plan : document.querySelector('.scn').scenarios.plan;
  globalThis.__m5turns = { fit: 0, dock: 0 };
  const watch = (el, attribute, key) => {
    if (!el) return;
    new MutationObserver((records) => {
      for (const record of records) if (record.oldValue !== el.getAttribute(attribute)) globalThis.__m5turns[key] += 1;
    }).observe(el, { attributes: true, attributeFilter: [attribute], attributeOldValue: true });
  };
  watch(plan.stage, 'data-fit', 'fit');
  watch(document.querySelector('.mov-legend'), 'data-docked', 'dock');
}, which);

for (const which of ['movement', 'scenarios']) {
  test('batch 17: at 844 by 390 with touch ' + (which === 'movement' ? 'Movement' : 'the lab, a scenario open,') + ' puts every floor on the stage at Fit and none under the sticky foot, as it opens and when Fit is tapped, and the layout settles', async () => {
    await on('#project', SIDE, async (page) => {
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page is not a touch screen’s');
      await fixture(page, null, which === 'scenarios' ? [['newScenario', { name: 'Trial' }]] : []);
      await go(page, '#' + which);
      await mapSettled(page, which);
      await countTurns(page, which);
      const opened = await floorsAt(page, which);
      assert.ok(opened.zoom < 0.3, 'the floors are not near the least zoom: the case tests nothing: ' + JSON.stringify(opened));
      assert.deepEqual(offStage(opened), [], 'as it opens: ' + JSON.stringify(opened));
      await tap(page, '#section [data-action="fit"]');
      await mapSettled(page, which);
      const fitted = await floorsAt(page, which);
      assert.deepEqual(offStage(fitted), [], 'after Fit: ' + JSON.stringify(fitted));
      const turns = await page.evaluate(() => globalThis.__m5turns);
      assert.ok(turns.fit <= 2 && turns.dock <= 1, 'the layout did not settle: ' + JSON.stringify(turns));
    });
  });
}

// ------------------------------------------- SV2-72e's open line: the toast's Show

// The shell's own Show, on the message an Undo leaves, opened its address
// with navigate(), unmarked, so on a phone a Show over the list and then a
// Delete wrote the list in the slot's place: Back from the list was the list
// again. A group or slot address goes through openAddress (SV2-72e's rule).
const hashOf = (page) => page.evaluate(() => location.hash);
const listIs = (page, folded) => until(page, 'the list is not ' + (folded ? 'folded' : 'shown'), (wanted) => document.querySelector('.sch')?.dataset.pending !== 'true' && document.querySelector('.sch-groups')?.dataset.folded === wanted, String(folded));
const step = (page) => page.evaluate(() => new Promise((resolve) => {
  window.addEventListener('popstate', () => resolve(), { once: true });
  history.back();
}));
async function backTo(page, start, most) {
  const seen = [await hashOf(page)];
  while (seen[seen.length - 1] !== start && seen.length <= most) {
    await step(page);
    seen.push(await hashOf(page));
  }
  return seen;
}
const closeToast = (page) => page.evaluate(() => document.querySelector('.toast__close')?.click());

test('SV2-72e\'s open line: Undo, then the message\'s Show, then a Delete on a phone at the list: Back from the list is the page before it, the list once', async () => {
  await on('#project', PHONE, async (page) => {
    await go(page, '#schedule/groups');
    await listIs(page, false);
    await loadModule(page, 'actions', 'engine/actions.js');
    await page.evaluate((groupId, dayTypeId) => {
      globalThis.sv2.store.apply(globalThis.sv2modules.actions.setSlot, { groupId, dayTypeId, period: 3, slot: { label: 'Choir' } });
    }, C6, DAY_A);
    await listIs(page, false);
    await page.evaluate(() => globalThis.sv2.ctx.undo());
    await until(page, 'the Undo left no Show', () => document.querySelector('.toast .toast__action')?.textContent === 'Show');
    await tap(page, '.toast .toast__action');
    const slot = '#schedule/groups/' + C6 + '/' + DAY_A + '/3';
    await until(page, 'Show did not go to the slot\'s address', (hash) => location.hash === hash && document.querySelector('.sch').dataset.pending !== 'true', slot);
    await listIs(page, true);
    await closeToast(page);
    assert.deepEqual(await page.evaluate(() => history.state), { scheduleListUnder: true }, 'the message\'s Show over the list made an entry with no mark');
    await tap(page, '[data-action="delete"]');
    await closeToast(page);
    await listIs(page, false);
    await until(page, 'the page is not at the list, or is on a spent entry', () => location.hash === '#schedule/groups' && !(history.state && history.state.scheduleSpent) && document.querySelector('.sch').dataset.pending !== 'true');
    assert.deepEqual(await backTo(page, '#project', 4), ['#schedule/groups', '#project'], 'Back from the list showed the list twice');
  });
});

// ------------------------------------------- spec 18: run a scenario and apply it

// 8A's long walk out of the Gym in Period 6 on A Day, tried in the Library.
test('spec 18, run a scenario and apply it, by the keyboard alone at 1280 by 800', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page);
    await countInput(page);
    await sectionKey(page, 4, 'scenarios');
    await labReady(page);
    await tabTo(page, '#scenario-start-name');
    await page.keyboard.type('Library swap');
    await page.keyboard.press('Enter');
    await until(page, 'Enter in the name field did not start a scenario', () => document.querySelector('.scn').dataset.mode === 'open');
    await labReady(page);
    await tabTo(page, '#scenario-move-group');
    await page.keyboard.type('8A');
    await tabTo(page, '#scenario-move-period');
    await page.keyboard.type('Period 6');
    await until(page, 'the form does not say where 8A is in Period 6', () => document.querySelector('.scn-form__now')?.textContent === 'Now: Gym.');
    await tabTo(page, '.scn-field--room input');
    await page.keyboard.type('Library');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await tabTo(page, '[data-action="add-change"]');
    await page.keyboard.press('Enter');
    await until(page, 'the change was not added as a chip', () => document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.match(await page.$eval('.scn-chip .scn-chip__words', (el) => el.textContent), /8A/);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplegym', 'nothing is applied before Apply');
    await tabTo(page, '[data-action="apply"]');
    await page.keyboard.press('Enter');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('#scenario-apply'))), true, 'the focus is not in the summary');
    await tabTo(page, '#scenario-apply .btn--primary', { most: 8 });
    await page.keyboard.press('Enter');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplelib');
    await journeyWas(page, 'keyboard');
  });
});

test('spec 18, run a scenario and apply it, by a finger alone at 390 by 844', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page);
    await countInput(page);
    await tap(page, '.rail a[href="#scenarios"]');
    await waitForSection(page, 'scenarios');
    await labReady(page);
    await tap(page, '[data-action="start"]');
    await until(page, 'the button did not start a scenario', () => document.querySelector('.scn').dataset.mode === 'open');
    await labReady(page);
    await tapSelect(page, '#scenario-move-group', 'gsample08a');
    await tapSelect(page, '#scenario-move-period', '5');
    await until(page, 'the form does not say where 8A is in Period 6', () => document.querySelector('.scn-form__now')?.textContent === 'Now: Gym.');
    await tap(page, '.scn-field--room input');
    await until(page, 'the room picker did not open its list', () => Boolean(document.querySelector('.scn-field--room .picker__list:not([hidden])')));
    const option = await page.$$eval('.scn-field--room .picker__option', (items) => items.findIndex((item) => item.textContent.startsWith('Library')));
    assert.ok(option >= 0, 'the picker offers no Library');
    await tap(page, '.scn-field--room .picker__option:nth-child(' + (option + 1) + ')');
    await tap(page, '[data-action="add-change"]');
    await until(page, 'the change was not added as a chip', () => document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplegym', 'nothing is applied before Apply');
    await tap(page, '[data-action="apply"]');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tap(page, '#scenario-apply .btn--primary');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    await labReady(page);
    assert.equal(await slotRoom(page, 'gsample08a', DAY_A, 5), 'rsamplelib');
    await journeyWas(page, 'touch');
  });
});

// ------------------------------------------- spec 18: print door cards

test('spec 18, print door cards, by the keyboard alone at 1280 by 800: one room shown from the list, a choice of two, then every room, on A4', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page);
    await countInput(page);
    await sectionKey(page, 5, 'safety');
    await safetyReady(page);
    // the inspector's tabs are one Tab stop with arrows between them
    await tabTo(page, '.sfy-inspector .tabs__tab[aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    await until(page, 'ArrowRight did not open Door cards', () => document.querySelector('.sfy-inspector .tabs__tab[data-tab="cards"]').getAttribute('aria-selected') === 'true');
    // Room 303 shown from the list: picked, then its card printed
    await tabTo(page, '.sfy-panel [data-action="show"][id$="-rsample303-show"]');
    await page.keyboard.press('Enter');
    await until(page, 'Show did not pick Room 303', () => document.querySelector('.sfy')?.dataset.picked === 'rsample303');
    await tabTo(page, '.sfy-panel [data-print="picked"]');
    await page.keyboard.press('Enter');
    let read = await preview(page);
    assert.equal(read.output, 'door-cards');
    assert.deepEqual(read.cards, ['rsample303']);
    assert.ok(read.text.includes('Take stairs B down to Floor 2.'), 'Room 303 is on Floor 3: its card says to take the stairs');
    // A4, by the arrows in the paper's radio group
    await tabTo(page, '#print-preview input[name$="size"]:checked, #print-preview input[value="letter"]', { most: 20 });
    await page.keyboard.press('ArrowRight');
    await until(page, 'the arrow did not choose A4', () => Boolean(document.querySelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]')));
    read = await preview(page);
    assert.equal(read.paper, 'a4 portrait');
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'picked', 'the focus is not back on the button that opened the preview');
    // two rooms ticked, printed in room order behind a cover sheet
    for (const room of ['rsample302', 'rsample301']) {
      await tabTo(page, '.sfy-panel input[type="checkbox"][id$="-' + room + '"]', { back: true });
      await page.keyboard.press('Space');
    }
    await tabTo(page, '.sfy-panel [data-print="chosen"]', { back: true });
    await page.keyboard.press('Enter');
    read = await preview(page);
    assert.deepEqual(read.cards, ['rsample301', 'rsample302']);
    assert.deepEqual(read.cover, ['rsample301', 'rsample302']);
    assert.equal(read.paper, 'a4 portrait', 'the paper chosen last time is the one offered');
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await tabTo(page, '.sfy-panel [data-print="all"]');
    await page.keyboard.press('Enter');
    read = await preview(page);
    assert.equal(read.cards.length, 13);
    await page.keyboard.press('Escape');
    await until(page, 'Escape did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await journeyWas(page, 'keyboard');
  });
});

// Where a room's middle cell is on the page, in CSS pixels.
const roomPoint = (page, roomId) => page.evaluate((id) => {
  const view = document.querySelector('.sfy').safety;
  const row = view.picture.byRoom.get(id);
  const cell = row.cells[Math.floor(row.cells.length / 2)];
  const at = view.plan.cellAt(row.floorId, cell);
  const rect = document.getElementById('safety-plan').getBoundingClientRect();
  return at ? { x: rect.left + at.x, y: rect.top + at.y } : null;
}, roomId);

test('spec 18, print door cards, by a finger alone at 390 by 844: a room tapped on the map, its card on A4, then every room', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page);
    await countInput(page);
    await tap(page, '.rail a[href="#safety"]');
    await waitForSection(page, 'safety');
    await safetyReady(page);
    await page.$eval('#safety-plan', (el) => el.scrollIntoView({ block: 'center' }));
    const at = await roomPoint(page, 'rsample303');
    assert.ok(at, 'Room 303 is not on the map at Fit');
    await page.touchscreen.tap(at.x, at.y);
    await until(page, 'the tap did not pick Room 303', () => document.querySelector('.sfy')?.dataset.picked === 'rsample303');
    // the inspector is a sheet on a phone
    await tap(page, '#inspector-toggle');
    await until(page, 'the sheet did not open', () => document.getElementById('inspector').dataset.open === 'true');
    await tap(page, '.sfy-inspector .tabs__tab[data-tab="cards"]');
    await until(page, 'Door cards did not open', () => document.querySelector('.sfy-inspector .tabs__tab[data-tab="cards"]').getAttribute('aria-selected') === 'true');
    await tap(page, '.sfy-panel [data-print="picked"]');
    let read = await preview(page);
    assert.deepEqual(read.cards, ['rsample303']);
    assert.deepEqual(read.names, ['Room 303']);
    await tap(page, '#print-preview input[value="a4"]');
    await until(page, 'the tap did not choose A4', () => Boolean(document.querySelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]')));
    await tap(page, '#print-preview [data-action="close"]');
    await until(page, 'Close did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await tap(page, '.sfy-panel [data-print="all"]');
    read = await preview(page);
    assert.equal(read.cards.length, 13);
    assert.equal(read.paper, 'a4 portrait', 'the paper chosen last time is the one offered');
    await tap(page, '#print-preview [data-action="close"]');
    await until(page, 'Close did not close the preview', () => !document.querySelector('#print-preview[open]'));
    await journeyWas(page, 'touch');
  });
});

// ------------------------------------------- Fix… to Try it to Apply

// 6A put in Room 103 in Period 3 on A Day, where 6B is: a problem the
// suggestion engine can work on (test/browser/fix.mjs's fixture).
const CLASHED = [['setSlot', { groupId: 'gsample06a', dayTypeId: DAY_A, period: 2, slot: { room: 'rsample103' } }]];
const fixOf = '.sch-checks .sch-findings tbody tr[data-finding="' + CLASH + '"] [data-action="fix"]';

async function checksReady(page) {
  await until(page, 'the Checks tab did not list the clash', (id) => {
    const sch = document.querySelector('.sch');
    return sch && sch.dataset.pending !== 'true' && Boolean(document.querySelector('.sch-checks tr[data-finding="' + id + '"]'));
  }, CLASH);
}
const fixState = (page, state) => until(page, 'the Fix dialog is not ' + state, (wanted) => {
  const dialog = document.getElementById('fix-dialog');
  return Boolean(dialog) && dialog.open && dialog.dataset.state === wanted;
}, state);
// The change the first suggestion makes, as the lane gives it.
const firstChange = (page) => page.evaluate(async (id) => (await globalThis.sv2.store.derived.suggest(id, { otherTeachersRooms: false, limit: 5 })).suggestions[0].change, CLASH);
// What a change puts in each slot it names, read from the store as it is.
const slotsOf = (page, change) => page.evaluate((c) => {
  const rooms = (g) => globalThis.sv2.store.project.groups.find((each) => each.id === g).days[c.dayTypeId].map((slot) => slot.room);
  if (c.kind === 'move') return [rooms(c.groupId)[c.period]];
  if (c.kind === 'swapPeriods') return [rooms(c.groupId)[c.periodA], rooms(c.groupId)[c.periodB]];
  return [rooms(c.groupA)[c.period], rooms(c.groupB)[c.period]];
}, change);

test('Fix… to Try it to Apply, by the keyboard alone at 1280 by 800: the clash is cleared in the schedule', async () => {
  await on('#movement', DESK, async (page) => {
    await fixture(page, null, CLASHED);
    await countInput(page);
    await sectionKey(page, 2, 'schedule');
    // the Checks tab, by the schedule's own tabs: one Tab stop, arrows between them
    await tabTo(page, '.sch .tabs__tab[aria-selected="true"]');
    // the arrows select as they go; Checks is the one before Import, the last
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await until(page, 'the keyboard did not open Checks', () => location.hash === '#schedule/checks');
    await checksReady(page);
    await tabTo(page, fixOf);
    await page.keyboard.press('Enter');
    await fixState(page, 'answered');
    const change = await firstChange(page);
    const before = await slotsOf(page, change);
    await tabTo(page, '#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]', { most: 12 });
    await page.keyboard.press('Enter');
    await until(page, 'Try it did not land on the scenario\'s name', () => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.activeElement?.id === 'scenario-name');
    await labReady(page);
    assert.deepEqual((await scenarioOf(page)).changes, [change]);
    assert.deepEqual(await slotsOf(page, change), before, 'Try it changed the schedule');
    await tabTo(page, '[data-action="apply"]');
    await page.keyboard.press('Enter');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tabTo(page, '#scenario-apply .btn--primary', { most: 8 });
    await page.keyboard.press('Enter');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    assert.notDeepEqual(await slotsOf(page, change), before, 'Apply left the slots as they were');
    assert.equal((await findingIds(page)).includes(CLASH), false, 'the clash is still a finding after Apply');
    await journeyWas(page, 'keyboard');
  });
});

test('Fix… to Try it to Apply, by a finger alone at 390 by 844: the clash is cleared in the schedule', async () => {
  await on('#movement', PHONE, async (page) => {
    await fixture(page, null, CLASHED);
    await countInput(page);
    await tap(page, '.rail a[href="#schedule"]');
    await waitForSection(page, 'schedule');
    await tap(page, '.sch .tabs__tab[data-tab="checks"]');
    await until(page, 'the tap did not open Checks', () => location.hash === '#schedule/checks');
    await checksReady(page);
    await tap(page, fixOf);
    await fixState(page, 'answered');
    const change = await firstChange(page);
    const before = await slotsOf(page, change);
    await tap(page, '#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await until(page, 'Try it did not open the scenario', () => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.querySelectorAll('.scn-chip').length === 1);
    await labReady(page);
    assert.deepEqual((await scenarioOf(page)).changes, [change]);
    assert.deepEqual(await slotsOf(page, change), before, 'Try it changed the schedule');
    await tap(page, '[data-action="apply"]');
    await until(page, 'Apply… opened no summary', () => Boolean(document.querySelector('#scenario-apply[open]')));
    await tap(page, '#scenario-apply .btn--primary');
    await until(page, 'the scenario was not applied', () => globalThis.sv2.store.project.scenario === null && !document.querySelector('dialog[open]'));
    assert.notDeepEqual(await slotsOf(page, change), before, 'Apply left the slots as they were');
    assert.equal((await findingIds(page)).includes(CLASH), false, 'the clash is still a finding after Apply');
    await journeyWas(page, 'touch');
  });
});
