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
// and adding to an open one, opening Scenarios with the focus on the
// scenario's name field, the schedule untouched, and what one Undo and then
// another take back; Try it saying what it did: added, already there, in
// place of an earlier change; the line about an open scenario, shown only
// with one; Try it pressed twice, and Enter again once it has landed; a Try
// it the scenario refuses; "No small change clears this."; the finding
// cleared under the dialog; a failed and a stale answer; keyboard only; a
// phone at 390 by 844 and on its side at 844 by 390, with touch; Escape and
// Close giving the focus back; typed names shown as typed.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, launch, startServer } from './harness.mjs';

const DAY_A = 'dsample00a';
const CLASH = 'room-double:' + DAY_A + ':2:rsample103';
const NOTE = 'room-no-subject:rsamplecaf';
const NO_SUGGESTION = 'No small change clears this.';
const CLEARED = 'This finding is cleared now: the schedule as it is no longer has it.';
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

// The answer for the switch as it is now: 'answered' alone is also the
// answer before the switch was pressed, so the wait names the new one by
// the switch's value the answer was asked with (data-others, set when it
// is asked; SV2-72d2 item 8).
// `state` is the state that answer ends in ('answered' when left out).
async function waitAnswer(page, others, state) {
  await page.waitForFunction((wanted, end) => {
    const dialog = document.getElementById('fix-dialog');
    return dialog && dialog.open && dialog.dataset.state === end && dialog.dataset.others === wanted;
  }, { timeout: 30000 }, String(others), state || 'answered');
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
  return { none: answer.none, suggestions: answer.suggestions.map((each) => ({ kind: each.kind, text: each.text, chip: each.chip.text, owners: each.effects.owners, change: each.change })) };
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

// What the page last said in its live region.
const said = (page) => page.$eval('#announcer', (el) => el.textContent);

// The line about an open scenario: its words, or null when it has no box.
const against = (page) => page.$eval('#fix-dialog [data-part="against"]', (el) => (el.getClientRects().length > 0 ? el.textContent : null));

// Try it has landed: Scenarios up, the dialog gone, the focus on the
// scenario's name field.
async function landed(page) {
  await page.waitForFunction(() => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.activeElement && document.activeElement.id === 'scenario-name', { timeout: 10000 });
}

// Fix… on the clash, pressed in the page: a scenario action just made can
// draw the list again between finding the button and clicking it.
const pressFix = (page) => page.$eval(fixOf(CLASH), (el) => el.click());

const tryAt = (index) => '#fix-dialog .fix-list__item[data-index="' + index + '"] [data-action="try"]';

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
const SIDE = { width: 844, height: 390, mobile: true };

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

test('Try it with no scenario open starts one named for the finding, adds the change, opens Scenarios with the focus on the name field, and leaves the schedule as it was; one Undo empties the scenario, a second closes it', async () => {
  await on(DESK, async (page) => {
    const before = await schedule(page);
    const depthBefore = await depth(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    const pick = asked.suggestions.find((each) => each.kind === 'free-room') || asked.suggestions[0];
    const at = asked.suggestions.indexOf(pick);
    await page.click(tryAt(at));
    await landed(page);
    const scenario = await scenarioOf(page);
    assert.equal(scenario.name, 'Two groups in one room on A Day, Period 3');
    assert.deepEqual(scenario.changes, [pick.change]);
    assert.equal(await page.$$eval('.scn-chip', (all) => all.length), 1);
    // the name field, never a chip's ×
    const focus = await active(page);
    assert.equal(focus.id, 'scenario-name');
    assert.equal(focus.chip, null);
    assert.equal(await said(page), 'Started the scenario Two groups in one room on A Day, Period 3 with ' + pick.chip + '. Nothing is applied yet.');
    // nothing applied: the schedule as it was
    assert.equal(await schedule(page), before);
    const depthTried = await depth(page);
    const steps = (await labels(page)).slice(-2);
    // one Undo takes the change out and leaves the scenario open, empty
    await page.click('#undo');
    await page.waitForFunction((n) => globalThis.sv2.store.history.past.length === n, { timeout: 5000 }, depthTried - 1);
    const emptied = await scenarioOf(page);
    assert.deepEqual(emptied && emptied.changes, [], 'one Undo leaves the started scenario open with no changes');
    assert.equal(emptied.name, 'Two groups in one room on A Day, Period 3');
    assert.equal(await schedule(page), before);
    // a second closes it
    await page.click('#undo');
    await page.waitForFunction((n) => globalThis.sv2.store.history.past.length === n, { timeout: 5000 }, depthTried - 2);
    assert.equal(await scenarioOf(page), null);
    assert.equal(await schedule(page), before);
    // and those were the scenario's two steps of undo, the only ones Try it made
    assert.equal(depthTried, depthBefore + 2);
    assert.match(steps[0], /^Start scenario Two groups in one room on A Day, Period 3$/);
    assert.match(steps[1], /^Add to scenario Two groups in one room on A Day, Period 3: /);
  });
});

test('Try it with a scenario open adds to it: one step of undo, the name kept, the name field focused, the change said as added', async () => {
  await on(DESK, async (page) => {
    await act(page, 'newScenario', { name: 'Morning trial' });
    await act(page, 'addScenarioChange', { change: { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample08b', periodA: 0, periodB: 1 } });
    const before = await schedule(page);
    const versions = await page.evaluate(() => [globalThis.sv2.store.geometryVersion, globalThis.sv2.store.buildingVersion, globalThis.sv2.store.scheduleVersion].join(':'));
    const depthBefore = await depth(page);
    await pressFix(page);
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    await page.click(tryAt(0));
    await landed(page);
    const scenario = await scenarioOf(page);
    assert.equal(scenario.name, 'Morning trial');
    assert.equal(scenario.changes.length, 2);
    assert.deepEqual(scenario.changes[1], asked.suggestions[0].change);
    assert.equal((await active(page)).id, 'scenario-name');
    assert.equal(await said(page), 'Added to the scenario Morning trial: ' + asked.suggestions[0].chip + '. Nothing is applied yet.');
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

test('the same suggestion tried twice from two openings: the second says the scenario already has it, adds nothing and makes no undo step', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    await page.click(tryAt(0));
    await landed(page);
    const first = await scenarioOf(page);
    const depthAfter = await depth(page);
    await go(page, '#schedule/checks');
    await settled(page);
    await page.waitForSelector(fixOf(CLASH), { timeout: 30000 });
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    assert.equal((await shown(page)).items[0].text, asked.suggestions[0].text, 'the list is the same for the schedule as it stands');
    await page.click(tryAt(0));
    await landed(page);
    assert.equal(await said(page), 'The scenario ' + first.name + ' already has this change: ' + asked.suggestions[0].chip + '. Nothing was added.');
    assert.deepEqual(await scenarioOf(page), first);
    assert.equal(await depth(page), depthAfter);
    assert.equal(await page.$$eval('.scn-chip', (all) => all.length), 1);
  });
});

test('a Try it that replaces an earlier change on the same slot says which change it took the place of', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    const at = asked.suggestions.findIndex((each) => each.change.kind === 'move');
    assert.ok(at !== -1, 'the fixture offers a move');
    const pick = asked.suggestions[at];
    await closeDialog(page);
    // the scenario moves the same group in the same period to another room
    const earlier = { ...pick.change, roomId: 'rsample101' };
    assert.notEqual(earlier.roomId, pick.change.roomId);
    await act(page, 'newScenario', { name: 'Rooms trial' });
    await act(page, 'addScenarioChange', { change: earlier });
    // the earlier change in the action's own words
    const earlierWords = (await labels(page)).at(-1).replace(/^Add to scenario Rooms trial: /, '');
    await pressFix(page);
    await waitState(page, 'answered');
    await page.click(tryAt(at));
    await landed(page);
    const scenario = await scenarioOf(page);
    assert.deepEqual(scenario.changes, [pick.change]);
    assert.equal(await said(page), 'Added to the scenario Rooms trial: ' + pick.chip + ', in place of ' + earlierWords + '. Nothing is applied yet.');
  });
});

test('the line about an open scenario shows only with one open, with its name as typed and how many changes it has', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    assert.equal(await against(page), null, 'no scenario open, no line');
    await closeDialog(page);
    await act(page, 'newScenario', { name: HOSTILE });
    await pressFix(page);
    await waitState(page, 'answered');
    assert.equal(await against(page), 'Worked out against the schedule as it stands; Try it adds to the open scenario ' + HOSTILE + ', which has no changes yet.');
    assert.equal(await page.$$eval('#fix-dialog img', (all) => all.length), 0);
    // a change added while the dialog is open is counted at once
    await act(page, 'addScenarioChange', { change: { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample08b', periodA: 0, periodB: 1 } });
    await page.waitForFunction(() => document.querySelector('#fix-dialog [data-part="against"]').textContent.includes('already has'), { timeout: 5000 });
    assert.equal(await against(page), 'Worked out against the schedule as it stands; the open scenario ' + HOSTILE + ' already has 1 change, so check the comparison in Scenarios.');
    // and the scenario discarded under it: the line goes
    await act(page, 'discardScenario', {});
    await page.waitForFunction(() => document.querySelector('#fix-dialog [data-part="against"]').hidden, { timeout: 5000 });
    assert.equal(await against(page), null);
  });
});

test('Try it pressed twice at once makes one scenario with one change; Enter again once it has landed leaves the chip in place', async () => {
  await on(DESK, async (page) => {
    const depthBefore = await depth(page);
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    const asked = await lane(page, CLASH, false);
    // every sentence the live region is given from here on
    await page.evaluate(() => {
      globalThis.__fixSaid = [];
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) globalThis.__fixSaid.push(node.textContent);
      }).observe(document.getElementById('announcer'), { childList: true });
    });
    // two presses in one turn, before Scenarios is up
    await page.$eval(tryAt(0), (el) => {
      el.click();
      el.click();
    });
    // landed: Scenarios up, the dialog gone, the focus somewhere in the lab
    await page.waitForFunction(() => location.hash === '#scenarios' && !document.querySelector('dialog[open]') && document.activeElement && document.activeElement.closest('.scn') && document.querySelector('.scn-chip'), { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => globalThis.__fixSaid.filter((text) => /^(Started|Added|The scenario|Scenario )/.test(text))), ['Started the scenario Two groups in one room on A Day, Period 3 with ' + asked.suggestions[0].chip + '. Nothing is applied yet.'], 'the second press said nothing of its own');
    assert.equal(await depth(page), depthBefore + 2);
    // Enter again, as a key held down would
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(await page.$$eval('.scn-chip', (all) => all.length), 1, 'Enter after Try it took the change out');
    assert.deepEqual((await scenarioOf(page)).changes, [asked.suggestions[0].change]);
    assert.equal(await depth(page), depthBefore + 2);
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('dialog[open]'))), false);
    assert.equal((await active(page)).id, 'scenario-name');
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
    await waitAnswer(page, true, 'none');
    assert.equal((await shown(page)).status, NO_SUGGESTION);
    assert.equal(await page.$$eval('#fix-dialog [data-action="try"]', (all) => all.length), 0);
  }, { period: 1, room: 'rsample203', finding: third });
});

test('the finding cleared under the open dialog: stale first, then Ask again says it is cleared, with no Try it, no Ask again and no word about the switch; an Undo brings the list back', async () => {
  await on(DESK, async (page) => {
    await page.click(fixOf(CLASH));
    await waitState(page, 'answered');
    await act(page, 'setSlot', { groupId: 'gsample06a', dayTypeId: DAY_A, period: 2, slot: { room: 'rsample101' } });
    await waitState(page, 'stale');
    await page.click('#fix-dialog [data-action="ask-again"]');
    await page.waitForFunction(() => !['working', 'stale'].includes(document.getElementById('fix-dialog').dataset.state), { timeout: 30000 });
    const view = await shown(page);
    assert.equal(view.state, 'cleared');
    assert.equal(view.status, CLEARED);
    assert.equal(view.items.length, 0);
    assert.equal(await page.$$eval('#fix-dialog [data-action="try"]', (all) => all.length), 0);
    assert.equal(await page.$eval('#fix-dialog [data-action="ask-again"]', (el) => el.hidden), true);
    assert.doesNotMatch(view.status, /switch|No small change/);
    // the switch asks again and gets the same
    await page.click('#fix-dialog [data-part="others"]');
    await waitAnswer(page, true, 'cleared');
    // Undo puts the clash back: stale, and Ask again lists the changes again
    await page.evaluate(() => globalThis.sv2.store.undo());
    await waitState(page, 'stale');
    await page.click('#fix-dialog [data-action="ask-again"]');
    await waitState(page, 'answered');
    assert.equal((await shown(page)).items.length, 5);
  });
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

test('keyboard only: Tab to Fix…, Enter opens it with the focus inside, Space works the switch, Tab to Try it, Enter lands on the scenario\'s name field in Scenarios', async () => {
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
    await waitAnswer(page, true);
    assert.equal((await shown(page)).others, 'true');
    await page.keyboard.press('Tab');
    assert.equal((await active(page)).action, 'try');
    await page.keyboard.press('Enter');
    await landed(page);
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
    await waitAnswer(page, true);
    assert.equal((await shown(page)).others, 'true');
    await page.$eval('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]', (el) => el.scrollIntoView({ block: 'center' }));
    await tap('#fix-dialog .fix-list__item[data-index="0"] [data-action="try"]');
    await page.waitForFunction(() => location.hash === '#scenarios' && document.querySelector('.scn-chip'), { timeout: 10000 });
    assert.equal((await scenarioOf(page)).changes.length, 1);
  }, { hash: '#schedule/checks' });
});

test('a phone on its side at 844 by 390 with touch: the dialog inside the window, no sideways scroll, 44 px targets, Try it reached by scrolling the dialog and tapped', async () => {
  await on(SIDE, async (page) => {
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && window.innerWidth === 844 && window.innerHeight === 390), true);
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
    assert.equal(sizes.inside, true, JSON.stringify(sizes));
    assert.equal(sizes.scrollsSideways, false);
    assert.equal(sizes.tries.length, 4);
    // a scrolled dialog lays out in fractions of a pixel: 43.99997 is 44
    for (const height of [...sizes.tries, sizes.close, sizes.switchRow]) assert.ok(height >= 43.99, JSON.stringify(sizes));
    const last = tryAt(3);
    await page.$eval(last, (el) => el.scrollIntoView({ block: 'center' }));
    const reachable = await page.$eval(last, (el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    assert.equal(reachable, true, 'the last Try it scrolls into the window');
    await tap(last);
    await landed(page);
    assert.equal((await scenarioOf(page)).changes.length, 1);
  }, { hash: '#schedule/checks' });
});

// SV2-72d item 5 (W4) and item 8: the title and Close stay in the window
// with the list scrolled to its end, and the dialog's layout is its sheet's.
for (const [size, label] of [[PHONE, 'upright at 390 by 844'], [SIDE, 'on its side at 844 by 390']]) {
  test('SV2-72d 5: a phone ' + label + ' with touch: the title and Close stay in view with the list scrolled to its last Try it, and nothing is laid out by an inline style', async () => {
    await on(size, async (page) => {
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0), true);
      await page.$eval(fixOf(CLASH), (el) => el.scrollIntoView({ block: 'center' }));
      const at = await page.$eval(fixOf(CLASH), (el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.touchscreen.tap(at.x, at.y);
      await waitState(page, 'answered');
      // the switch on: five suggestions, the longest list
      await page.$eval('#fix-dialog [data-part="others"]', (el) => el.click());
      await waitAnswer(page, true);
      assert.equal(await page.$$eval('#fix-dialog .fix-list__item', (items) => items.length), 5, 'the answer with the switch on lists five');
      const view = await page.evaluate(() => {
        const dialog = document.getElementById('fix-dialog');
        const tries = dialog.querySelectorAll('[data-action="try"]');
        tries[tries.length - 1].scrollIntoView({ block: 'end' });
        const inView = (el) => {
          if (el.getClientRects().length === 0) return 'no box';
          const rect = el.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return rect.top >= 0 && rect.bottom <= window.innerHeight && Boolean(hit) && (hit === el || el.contains(hit));
        };
        const body = dialog.querySelector('.dialog__body');
        return {
          title: inView(dialog.querySelector('.dialog__title')),
          close: inView(dialog.querySelector('.dialog__buttons .btn')),
          last: inView(tries[tries.length - 1]),
          bodyScrolls: body.scrollHeight > body.clientHeight,
          dialogScrolled: dialog.scrollTop,
          styled: Array.from(dialog.querySelectorAll('[style]')).map((el) => el.className || el.tagName),
        };
      });
      assert.equal(view.last, true, 'the last Try it is in view: ' + JSON.stringify(view));
      assert.equal(view.title, true, 'the title is in view: ' + JSON.stringify(view));
      assert.equal(view.close, true, 'Close is in view: ' + JSON.stringify(view));
      assert.equal(view.dialogScrolled, 0, 'the dialog itself never scrolls: its body does');
      assert.deepEqual(view.styled, [], 'no inline style in the dialog');
      // Close still closes and gives the focus back
      await page.$eval('#fix-dialog .dialog__buttons .btn', (el) => el.click());
      await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.action), 'fix');
    }, { hash: '#schedule/checks' });
  });
}

// SV2-72d2 item 7: the body scrolls, and a scroller clips what is drawn
// outside its padding box. A phone upright, with touch.
const tapOn = async (page, selector) => {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center' }));
  const at = await page.$eval(selector, (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.touchscreen.tap(at.x, at.y);
};

test('SV2-72d2 7: at 390 by 844 with touch the focus rings of the switch and of every Try it are drawn whole inside the scrolling body', async () => {
  await on(PHONE, async (page) => {
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0), true);
    await tapOn(page, fixOf(CLASH));
    await waitState(page, 'answered');
    await page.$eval('#fix-dialog [data-part="others"]', (el) => el.click());
    await waitAnswer(page, true);
    const wanted = await page.$$eval('#fix-dialog [data-part="others"], #fix-dialog [data-action="try"]', (all) => all.length);
    assert.equal(wanted, 6, 'the switch and five Try it');
    // each reached by the keyboard, as a ring is drawn for it, and read as it is drawn
    const rings = [];
    for (let press = 0; press < 40 && rings.length < wanted; press += 1) {
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || !el.matches('#fix-dialog [data-part="others"], #fix-dialog [data-action="try"]')) return null;
        const body = el.closest('.dialog__body');
        const style = getComputedStyle(el);
        const reach = style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        const rect = el.getBoundingClientRect();
        const edge = body.getBoundingClientRect();
        const box = { left: edge.left + body.clientLeft, top: edge.top + body.clientTop };
        box.right = box.left + body.clientWidth;
        box.bottom = box.top + body.clientHeight;
        const ring = { left: rect.left - reach, right: rect.right + reach, top: rect.top - reach, bottom: rect.bottom + reach };
        return {
          what: el.dataset.part || el.dataset.action + ' ' + el.closest('.fix-list__item').dataset.index,
          visible: el.matches(':focus-visible'),
          reach,
          clipped: ['left', 'top'].filter((side) => ring[side] < box[side] - 0.5).concat(['right', 'bottom'].filter((side) => ring[side] > box[side] + 0.5)),
          ring,
          box,
        };
      });
      if (ring && !rings.some((each) => each.what === ring.what)) rings.push(ring);
    }
    assert.deepEqual(rings.map((ring) => ring.what), ['others', 'try 0', 'try 1', 'try 2', 'try 3', 'try 4'], 'every control reached by Tab');
    for (const ring of rings) {
      assert.ok(ring.visible && ring.reach >= 4, ring.what + ' has its ring: ' + JSON.stringify(ring));
      assert.deepEqual(ring.clipped, [], ring.what + '\'s ring is cut at the body\'s edge: ' + JSON.stringify(ring));
    }
  }, { hash: '#schedule/checks' });
});

test('SV2-72d2 7: at 390 by 844 with touch a Try it the scenario refuses brings its alert into the body\'s view', async () => {
  await on(PHONE, async (page) => {
    await tapOn(page, fixOf(CLASH));
    await waitState(page, 'answered');
    await page.$eval('#fix-dialog [data-part="others"]', (el) => el.click());
    await waitAnswer(page, true);
    const asked = await lane(page, CLASH, true);
    // the group the first change moves is deleted under the open dialog
    await act(page, 'deleteGroup', { id: asked.suggestions[0].change.groupId });
    await waitState(page, 'stale');
    await page.$eval('#fix-dialog .dialog__body', (el) => {
      el.scrollTop = 0;
    });
    await tapOn(page, tryAt(0));
    await page.waitForFunction(() => {
      const alert = document.querySelector('#fix-dialog [data-part="refusal"]');
      return alert && !alert.hidden && alert.getClientRects().length > 0;
    }, { timeout: 5000 });
    const seen = await page.evaluate(() => {
      const body = document.querySelector('#fix-dialog .dialog__body');
      const alert = body.querySelector('[data-part="refusal"]').getBoundingClientRect();
      const edge = body.getBoundingClientRect();
      const top = edge.top + body.clientTop;
      return { scrolls: body.scrollHeight > body.clientHeight, alert: { top: alert.top, bottom: alert.bottom }, body: { top, bottom: top + body.clientHeight }, inWindow: alert.top >= 0 && alert.bottom <= innerHeight };
    });
    assert.ok(seen.scrolls, 'the body scrolls here, so the alert could be out of its view: ' + JSON.stringify(seen));
    assert.ok(seen.alert.top >= seen.body.top - 0.5 && seen.alert.bottom <= seen.body.bottom + 0.5 && seen.inWindow, 'the refusal is in view: ' + JSON.stringify(seen));
    assert.equal(await scenarioOf(page), null, 'and nothing was started');
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
