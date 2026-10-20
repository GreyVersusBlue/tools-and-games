// Fix… and Try it in a real browser (spec 5.8; DESIGN 5.2 and 5.4):
// node test/browser/fix.mjs
//
// The fixture is the sample school after one change made through the
// actions: 6A put in Room 103 in Period 3 on A Day, where 6B already is, so
// Room 103 has two groups (a problem the suggestion engine can work on)
// beside the school's own notes about the Cafeteria (which it cannot).
// Without the switch the engine finds four changes for the new clash; with
// it, a fifth, a move into another teacher's room, which says whose.
//
// Fix… on a fixable finding and none on the rest; the dialog working, then
// the lane's sentences as the lane gives them; the switch asking again, and
// kept for the project while the page is open; Try it starting a scenario
// and adding to an open one, opening Scenarios with the focus on the chip,
// the schedule untouched; a Try it the scenario refuses; "No small change
// clears this."; a failed and a stale answer; keyboard only; a phone at 390
// by 844 with touch; Escape and Close giving the focus back; typed names
// shown as typed.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, launch, startServer } from './harness.mjs';

const DAY_A = 'dsample00a';
const CLASH = 'room-double:' + DAY_A + ':2:rsample103';
const NOTE = 'room-no-subject:rsamplecaf';
const NO_SUGGESTION = 'No small change clears this.';
const HOSTILE = '<img src=x onerror="window.__hit=1">&amp; "6A"';
const ARABIC = 'الصف السادس';
const CLEAN = { errors: [], blocked: [], shimmed: [] };

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

// ---------------------------------------------------------------- helpers

// The engine's actions and the sample school, loaded by a module script and
// read from a global: an import() awaited inside page.evaluate once came
// back "Promise was collected" (ARCHITECTURE 6.6, SV2-71).
async function kit(page) {
  if (await page.evaluate(() => Boolean(globalThis.__fixKit))) return;
  await page.addScriptTag({ type: 'module', content: "import * as actions from './engine/actions.js'; import { sampleSchool } from './data/sample-school.js'; globalThis.__fixKit = { actions, sampleSchool };" });
  await page.waitForFunction(() => Boolean(globalThis.__fixKit), { timeout: 10000 });
}

const act = (page, name, payload) => page.evaluate((action, given) => {
  globalThis.sv2.store.apply(globalThis.__fixKit.actions[action], given);
}, name, payload);

// The schedule drawn for the store as it is, and the engine's findings in.
async function settled(page) {
  await page.waitForFunction(() => {
    const sch = document.querySelector('.sch');
    return sch && sch.dataset.pending !== 'true' && document.querySelector('link[data-sheet="schedule"]').sheet !== null;
  }, { timeout: 30000 });
}

// The sample school with 6A put in Room 103 in Period 3 on A Day (6B is
// there), through setSlot; `alter` (a function body over `project`) changes
// the school first; `period` and `room` choose another clash.
async function fixture(page, options) {
  const opts = options || {};
  await kit(page);
  await page.evaluate((alter, period, room) => {
    const { actions, sampleSchool } = globalThis.__fixKit;
    const project = sampleSchool();
    if (alter) new Function('project', alter)(project);
    const store = globalThis.sv2.store;
    store.replace(project);
    store.apply(actions.setSlot, { groupId: 'gsample06a', dayTypeId: 'dsample00a', period, slot: { room } });
  }, opts.alter || null, opts.period === undefined ? 2 : opts.period, opts.room || 'rsample103');
  await go(page, opts.hash || '#schedule/checks');
  await settled(page);
  await page.waitForFunction((id) => document.querySelector('.sch-checks tr[data-finding="' + id + '"]'), { timeout: 30000 }, opts.finding || CLASH);
}

const fixOf = (id) => '.sch-checks .sch-findings tbody tr[data-finding="' + id + '"] [data-action="fix"]';

async function waitState(page, state) {
  await page.waitForFunction((wanted) => {
    const dialog = document.getElementById('fix-dialog');
    return dialog && dialog.open && dialog.dataset.state === wanted;
  }, { timeout: 30000 }, state);
}

// What the dialog shows, read only from what has a box.
const shown = (page) => page.evaluate(() => {
  const dialog = document.getElementById('fix-dialog');
  const boxed = (el) => el && el.getClientRects().length > 0;
  const status = dialog.querySelector('[data-part="status"]');
  if (!boxed(status)) throw new Error('the status line has no box');
  return {
    state: dialog.dataset.state,
    others: dialog.dataset.others,
    status: status.textContent,
    items: Array.from(dialog.querySelectorAll('.fix-list__item')).map((item) => {
      const words = item.querySelector('.fix-list__words');
      if (!boxed(words)) throw new Error('a suggestion has no box');
      return { kind: item.dataset.kind, text: words.textContent, change: item.querySelector('[data-part="change"]').textContent, effects: item.querySelector('[data-part="effects"]').textContent };
    }),
    text: dialog.textContent,
  };
});

// The lane's own answer for the same question, as the store is now.
const lane = (page, findingId, others) => page.evaluate(async (id, otherTeachersRooms) => {
  const answer = await globalThis.sv2.store.derived.suggest(id, { otherTeachersRooms, limit: 5 });
  return { none: answer.none, suggestions: answer.suggestions.map((each) => ({ kind: each.kind, text: each.text, owners: each.effects.owners, change: each.change })) };
}, findingId, others);

const teacherNames = (page, ids) => page.evaluate((list) => list.map((id) => globalThis.sv2.store.project.teachers.find((each) => each.id === id).name), ids);

const schedule = (page) => page.evaluate(() => JSON.stringify({ groups: globalThis.sv2.store.project.groups, dayTypes: globalThis.sv2.store.project.dayTypes }));
const depth = (page) => page.evaluate(() => globalThis.sv2.store.history.past.length);
const labels = (page) => page.evaluate(() => globalThis.sv2.store.history.past.map((entry) => entry.label));
const scenarioOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project.scenario)));
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const chip = el.closest('.scn-chip');
  return { tag: el.tagName, key: el.dataset.key || null, action: el.dataset.action || null, id: el.id || null, chip: chip ? Number(chip.dataset.index) : null, inDialog: Boolean(el.closest('#fix-dialog')), label: el.getAttribute('aria-label') };
});

// Hold the lane's answer until released, to see the working state.
async function holdLane(page) {
  await page.evaluate(() => {
    const derived = globalThis.sv2.store.derived;
    const real = derived.suggest;
    globalThis.__fixHeld = [];
    derived.suggest = (id, options) => new Promise((resolve, reject) => {
      globalThis.__fixHeld.push(() => real(id, options).then(resolve, reject));
    });
    globalThis.__fixRelease = () => {
      derived.suggest = real;
      for (const go of globalThis.__fixHeld.splice(0)) go();
    };
  });
}

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
}

// A page of its own for a case, the fixture loaded; closed after, and the
// page's own complaints asserted empty.
async function on(size, run, options) {
  const session = await openPlanner({ server, browser, hash: '#schedule/checks', theme: 'light', ...size });
  let failed = null;
  try {
    await settled(session.page);
    await fixture(session.page, options);
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

const DESK = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844, mobile: true };

// ---------------------------------------------------------------- the button

test('Fix… is on the findings the engine can work on and on no other: the clash and the long walk have it, the notes have none, not even a disabled one', async () => {
  await on(DESK, async (page) => {
    const rows = await page.$$eval('.sch-checks .sch-findings tbody tr[data-finding]', (all) => all.map((row) => ({ id: row.dataset.finding, severity: row.dataset.severity, fix: row.querySelectorAll('[data-action="fix"]').length, disabled: row.querySelectorAll('[aria-disabled="true"]').length })));
    const of = (id) => rows.find((row) => row.id === id);
    assert.equal(of(CLASH).fix, 1, 'the clash made through setSlot has Fix…');
    assert.equal(of(NOTE).fix, 0, 'a note no small change clears has no Fix…');
    for (const row of rows) {
      assert.equal(row.fix, row.severity === 'note' ? 0 : 1, row.id);
      assert.equal(row.disabled, 0, row.id + ' has a disabled button');
    }
    // the findings panel beside another tab follows the same rule
    await go(page, '#schedule/teachers');
    await settled(page);
    const panel = await page.$$eval('#inspector .sch-finding', (all) => all.map((li) => ({ id: li.dataset.finding, fix: li.querySelectorAll('[data-action="fix"]').length })));
    assert.ok(panel.some((row) => row.id === CLASH && row.fix === 1), JSON.stringify(panel));
    assert.ok(panel.some((row) => row.id === NOTE && row.fix === 0), JSON.stringify(panel));
  });
});

// ---------------------------------------------------------------- the dialog

test('the dialog says it is working until the lane answers, then lists the lane\'s sentences in its words, each the change then what else it changes, never "best"', async () => {
  await on(DESK, async (page) => {
    await holdLane(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'working');
    const working = await shown(page);
    assert.equal(working.status, 'Working out small changes that would clear this…');
    assert.equal(working.items.length, 0);
    assert.equal(await page.$eval('#fix-dialog [data-part="list"]', (el) => el.getAttribute('aria-busy')), 'true');
    assert.equal(await page.$eval('#fix-dialog [data-part="finding"]', (el) => el.textContent), await page.$eval('.sch-checks tr[data-finding="' + CLASH + '"] .sch-finding__what', (el) => el.textContent));
    // the dialog took the focus on open
    assert.equal((await active(page)).inDialog, true);
    await page.evaluate(() => globalThis.__fixRelease());
    await waitState(page, 'answered');
    const answered = await shown(page);
    const asked = await lane(page, CLASH, false);
    assert.equal(asked.suggestions.length, 4, 'the fixture gives four without the switch');
    assert.deepEqual(answered.items.map((item) => item.text), asked.suggestions.map((each) => each.text));
    assert.deepEqual(answered.items.map((item) => item.kind), asked.suggestions.map((each) => each.kind));
    for (const item of answered.items) {
      assert.equal(item.change + ': ' + item.effects, item.text);
      assert.match(item.effects, /walking, (no new findings|one new|\d+ new)/, item.text);
    }
    assert.equal(answered.status, '4 changes would clear this. Each says what else it changes.');
    assert.equal(answered.others, 'false');
    assert.equal(await page.$eval('#fix-dialog [data-part="list"]', (el) => el.getAttribute('aria-busy')), 'false');
    assert.doesNotMatch(answered.text, /\bbest\b/i);
    assert.equal(await page.$$eval('#fix-dialog [data-action="try"]', (all) => all.length), 4);
  });
});

test('the switch asks again with other teachers\' rooms: working, then five, the new kind naming the room\'s teacher; it is kept for the project while the page is open', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    assert.equal(await page.$eval('#fix-dialog [data-part="others"]', (el) => el.checked + '|' + el.getAttribute('role')), 'false|switch');
    await holdLane(page);
    await page.click('#fix-dialog [data-part="others"]');
    await waitState(page, 'working');
    assert.equal((await shown(page)).others, 'true');
    await page.evaluate(() => globalThis.__fixRelease());
    await waitState(page, 'answered');
    const answered = await shown(page);
    const asked = await lane(page, CLASH, true);
    assert.deepEqual(answered.items.map((item) => item.text), asked.suggestions.map((each) => each.text));
    const theirs = asked.suggestions.filter((each) => each.kind === 'other-teachers-room');
    assert.equal(theirs.length, 1, 'one move into another teacher\'s room on this fixture');
    for (const each of theirs) {
      const names = await teacherNames(page, each.owners);
      assert.ok(names.length > 0);
      for (const name of names) assert.ok(each.text.includes(name + '’s room') || each.text.includes(name + "'s room"), each.text + ' should say whose room: ' + name);
    }
    assert.equal(answered.items.filter((item) => item.kind === 'other-teachers-room').length, 1);
    assert.match(answered.items.find((item) => item.kind === 'other-teachers-room').text, /Ms\. Thistlewood's room/);
    // closed and opened again: still on
    await closeDialog(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    assert.equal(await page.$eval('#fix-dialog [data-part="others"]', (el) => el.checked), true);
    assert.equal((await shown(page)).items.length, 5);
    // stored nowhere: not in the project, not in localStorage
    assert.equal(await page.evaluate(() => JSON.stringify(globalThis.sv2.store.project).includes('otherTeachersRooms')), false);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((key) => localStorage.getItem(key).includes('otherTeachersRooms') || /fix/i.test(key))), false);
    // another project (another id) starts with the switch off
    await closeDialog(page);
    await fixture(page, { alter: "project.id = 'pfixother01';" });
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    assert.equal(await page.$eval('#fix-dialog [data-part="others"]', (el) => el.checked), false);
  });
});

// ---------------------------------------------------------------- Try it

test('Try it with no scenario open starts one named for the finding, adds the change, opens Scenarios with the focus on its chip, and leaves the schedule as it was', async () => {
  await on(DESK, async (page) => {
    const before = await schedule(page);
    const depthBefore = await depth(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    const pick = asked.suggestions.find((each) => each.kind === 'free-room') || asked.suggestions[0];
    const at = asked.suggestions.indexOf(pick);
    await page.click('#fix-dialog .fix-list__item[data-index="' + at + '"] [data-action="try"]');
    await page.waitForFunction(() => location.hash === '#scenarios' && !document.querySelector('dialog[open]'), { timeout: 10000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest('.scn-chip'), { timeout: 10000 });
    const scenario = await scenarioOf(page);
    assert.equal(scenario.name, 'Two groups in one room on A Day, Period 3');
    assert.deepEqual(scenario.changes, [pick.change]);
    assert.equal(await page.$$eval('.scn-chip', (all) => all.length), 1);
    const focus = await active(page);
    assert.equal(focus.chip, 0);
    assert.equal(focus.action, 'remove');
    // nothing applied: the schedule as it was, and only the scenario's two steps of undo
    assert.equal(await schedule(page), before);
    assert.equal(await depth(page), depthBefore + 2);
    const steps = (await labels(page)).slice(-2);
    assert.match(steps[0], /^Start scenario Two groups in one room on A Day, Period 3$/);
    assert.match(steps[1], /^Add to scenario Two groups in one room on A Day, Period 3: /);
  });
});

test('Try it with a scenario open adds to it: one step of undo, the name kept, the new chip focused', async () => {
  await on(DESK, async (page) => {
    await act(page, 'newScenario', { name: 'Morning trial' });
    await act(page, 'addScenarioChange', { change: { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample08b', periodA: 0, periodB: 1 } });
    const before = await schedule(page);
    const versions = await page.evaluate(() => [globalThis.sv2.store.geometryVersion, globalThis.sv2.store.buildingVersion, globalThis.sv2.store.scheduleVersion].join(':'));
    const depthBefore = await depth(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    await page.click('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await page.waitForFunction(() => location.hash === '#scenarios' && document.activeElement && document.activeElement.closest('.scn-chip'), { timeout: 10000 });
    const scenario = await scenarioOf(page);
    assert.equal(scenario.name, 'Morning trial');
    assert.equal(scenario.changes.length, 2);
    assert.deepEqual(scenario.changes[1], asked.suggestions[0].change);
    assert.equal((await active(page)).chip, 1);
    assert.equal(await schedule(page), before);
    assert.equal(await page.evaluate(() => [globalThis.sv2.store.geometryVersion, globalThis.sv2.store.buildingVersion, globalThis.sv2.store.scheduleVersion].join(':')), versions);
    assert.equal(await depth(page), depthBefore + 1);
    assert.match((await labels(page)).at(-1), /^Add to scenario Morning trial: /);
  });
});

test('a Try it the scenario refuses says the action\'s own sentence in the dialog, starts nothing and stays put; the list said first that the schedule had changed', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    const pick = asked.suggestions[0];
    // the group the first change moves is deleted under the open dialog
    const depthBefore = await depth(page);
    await act(page, 'deleteGroup', { id: pick.change.groupId });
    await waitState(page, 'stale');
    assert.equal((await shown(page)).status, 'The schedule has changed since this list was worked out, so it may no longer clear this. Ask again to work it out for the schedule as it is.');
    assert.equal(await page.$eval('#fix-dialog [data-action="ask-again"]', (el) => el.getClientRects().length > 0), true);
    const said = await page.evaluate((change) => {
      const { actions } = globalThis.__fixKit;
      const project = globalThis.sv2.store.project;
      try {
        actions.addScenarioChange(actions.newScenario(project, { name: 'x' }), { change });
        return null;
      } catch (error) {
        return error.message;
      }
    }, pick.change);
    assert.ok(said, 'the action refuses the change now');
    await page.click('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await page.waitForFunction(() => {
      const alert = document.querySelector('#fix-dialog [data-part="refusal"]');
      return alert && !alert.hidden && alert.getClientRects().length > 0;
    }, { timeout: 5000 });
    assert.equal(await page.$eval('#fix-dialog [data-part="refusal"]', (el) => el.getAttribute('role') + '|' + el.textContent), 'alert|' + said);
    assert.equal(await scenarioOf(page), null);
    assert.equal(await depth(page), depthBefore + 1, 'only the deletion');
    assert.equal(await page.evaluate(() => location.hash), '#schedule/checks');
    assert.equal(await page.evaluate(() => document.getElementById('fix-dialog').open), true);
  });
});

// ---------------------------------------------------------------- the other answers

test('"No small change clears this." with and without the switch: a third group in Room 203 in Period 2', async () => {
  const third = 'room-double:' + DAY_A + ':1:rsample203';
  await on(DESK, async (page) => {
    await page.click(fixOf(third));
    await waitState(page, 'none');
    assert.deepEqual((await lane(page, third, false)).suggestions, []);
    const off = await shown(page);
    assert.equal(off.status, NO_SUGGESTION + ' Other teachers’ rooms were not looked at: the switch above looks at them too.');
    assert.equal(off.items.length, 0);
    await page.click('#fix-dialog [data-part="others"]');
    await waitState(page, 'none');
    assert.equal((await shown(page)).status, NO_SUGGESTION);
    assert.equal(await page.$$eval('#fix-dialog [data-action="try"]', (all) => all.length), 0);
  }, { period: 1, room: 'rsample203', finding: third });
});

test('a failed answer says so in a sentence, and Ask again is a press that asks once more', async () => {
  await on(DESK, async (page) => {
    await page.evaluate(() => {
      const derived = globalThis.sv2.store.derived;
      globalThis.__fixReal = derived.suggest;
      globalThis.__fixAsked = 0;
      derived.suggest = () => {
        globalThis.__fixAsked += 1;
        return Promise.reject(new Error('The worker stopped.'));
      };
    });
    await page.click(fixOf(CLASH));
    await waitState(page, 'failed');
    assert.equal((await shown(page)).status, 'The changes could not be worked out: The worker stopped. Ask again, or close this and press Fix… later.');
    assert.equal(await page.evaluate(() => globalThis.__fixAsked), 1, 'a failure is never asked again by itself');
    await page.evaluate(() => {
      globalThis.sv2.store.derived.suggest = globalThis.__fixReal;
    });
    await page.click('#fix-dialog [data-action="ask-again"]');
    await waitState(page, 'answered');
    assert.equal((await shown(page)).items.length, 4);
    assert.equal(await page.$eval('#fix-dialog [data-action="ask-again"]', (el) => el.hidden), true);
  });
});

// ---------------------------------------------------------------- keyboard, phone, focus

test('keyboard only: Tab to Fix…, Enter opens it with the focus inside, Space works the switch, Tab to Try it, Enter lands on the chip in Scenarios', async () => {
  await on(DESK, async (page) => {
    await page.focus('.sch-checks tr[data-finding="' + CLASH + '"] [data-action="show"]');
    await page.keyboard.press('Tab');
    assert.equal((await active(page)).action, 'fix');
    await page.keyboard.press('Enter');
    await waitState(page, 'answered');
    assert.equal((await active(page)).inDialog, true);
    // Tab goes round inside: from Close to the switch
    let guard = 0;
    while ((await page.evaluate(() => document.activeElement.dataset.part || null)) !== 'others' && guard < 12) {
      await page.keyboard.press('Tab');
      guard += 1;
      assert.equal((await active(page)).inDialog, true, 'Tab left the dialog');
    }
    await page.keyboard.press('Space');
    await waitState(page, 'answered');
    assert.equal((await shown(page)).others, 'true');
    await page.keyboard.press('Tab');
    assert.equal((await active(page)).action, 'try');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#scenarios' && document.activeElement && document.activeElement.closest('.scn-chip'), { timeout: 10000 });
    assert.equal((await scenarioOf(page)).changes.length, 1);
  });
});

test('Escape and Close give the focus back to the Fix… that opened it; with that finding gone, to the first control of its list', async () => {
  await on(DESK, async (page) => {
    const key = await page.$eval(fixOf(CLASH), (el) => el.dataset.key);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    await closeDialog(page);
    assert.equal((await active(page)).key, key);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    await page.click('#fix-dialog .dialog__buttons .btn');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.equal((await active(page)).key, key);
    // the tab drawn again under the dialog (a new button, the same name)
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    await act(page, 'editGroup', { id: 'gsample08b', grade: '8x' });
    await settled(page);
    await closeDialog(page);
    assert.equal((await active(page)).key, key);
    // the clash put right under the dialog: its row is gone
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    await act(page, 'setSlot', { groupId: 'gsample06a', dayTypeId: DAY_A, period: 2, slot: { room: 'rsample101' } });
    await settled(page);
    await page.waitForFunction((id) => !document.querySelector('.sch-checks tr[data-finding="' + id + '"]'), {}, CLASH);
    await closeDialog(page);
    const first = await page.evaluate(() => {
      const list = document.querySelector('.sch-checks');
      const stops = Array.from(list.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hidden && el.getClientRects().length > 0);
      return stops[0] === document.activeElement;
    });
    assert.equal(first, true, 'the focus is on the Checks list\'s first control: ' + JSON.stringify(await active(page)));
  });
});

test('a phone at 390 by 844 with touch: the dialog inside the window, 44 px targets, the switch and Try it by a finger', async () => {
  await on(PHONE, async (page) => {
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && window.innerWidth === 390), true);
    await page.$eval(fixOf(CLASH), (el) => el.scrollIntoView({ block: 'center' }));
    const tap = async (selector) => {
      const at = await page.$eval(selector, (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.touchscreen.tap(at.x, at.y);
    };
    await tap(fixOf(CLASH));
    await waitState(page, 'answered');
    const sizes = await page.evaluate(() => {
      const dialog = document.getElementById('fix-dialog');
      const rect = dialog.getBoundingClientRect();
      const tall = (el) => el.getBoundingClientRect().height;
      return {
        inside: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
        scrollsSideways: dialog.scrollWidth > dialog.clientWidth,
        tries: Array.from(dialog.querySelectorAll('[data-action="try"]')).map(tall),
        close: tall(dialog.querySelector('.dialog__buttons .btn')),
        switchRow: tall(dialog.querySelector('[data-part="others"]').closest('label')),
      };
    });
    assert.equal(sizes.inside, true);
    assert.equal(sizes.scrollsSideways, false);
    assert.equal(sizes.tries.length, 4);
    for (const height of [...sizes.tries, sizes.close, sizes.switchRow]) assert.ok(height >= 44, JSON.stringify(sizes));
    await tap('#fix-dialog [data-part="others"]');
    await waitState(page, 'answered');
    assert.equal((await shown(page)).others, 'true');
    await page.$eval('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]', (el) => el.scrollIntoView({ block: 'center' }));
    await tap('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await page.waitForFunction(() => location.hash === '#scenarios' && document.querySelector('.scn-chip'), { timeout: 10000 });
    assert.equal((await scenarioOf(page)).changes.length, 1);
  }, { hash: '#schedule/checks' });
});

test('hostile and non-Latin names show as typed in the finding and in every sentence, and no markup runs', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const view = await shown(page);
    assert.ok(view.text.includes(HOSTILE), 'the hostile name as typed');
    assert.ok(view.text.includes(ARABIC), 'the Arabic name as typed');
    assert.deepEqual(view.items.map((item) => item.text), (await lane(page, CLASH, false)).suggestions.map((each) => each.text));
    assert.ok(view.items.some((item) => item.text.includes(HOSTILE) || item.text.includes(ARABIC)), 'a sentence names a renamed group');
    assert.equal(await page.$$eval('#fix-dialog img', (all) => all.length), 0);
    assert.equal(await page.evaluate(() => window.__hit === undefined), true);
    // the names are in <bdi>, so a right-to-left name keeps its place
    assert.ok(await page.$$eval('#fix-dialog .fix-list__words bdi', (all, wanted) => all.some((el) => wanted.includes(el.textContent)), [HOSTILE, ARABIC]));
    await page.click('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await page.waitForFunction(() => location.hash === '#scenarios' && document.querySelector('.scn-chip'), { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__hit === undefined), true);
  }, { alter: "project.groups.find((g) => g.id === 'gsample06a').name = " + JSON.stringify(HOSTILE) + "; project.groups.find((g) => g.id === 'gsample06b').name = " + JSON.stringify(ARABIC) + ';' });
});
