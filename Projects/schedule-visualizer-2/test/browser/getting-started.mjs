// Getting started, in a real browser: node test/browser/getting-started.mjs
//
// The card of DESIGN 5.0 on a new project: each of the five steps ticks when
// the project has what the step needs, and only then (a corridor and a room;
// every room numbered, so a new room with no number takes the tick away; a
// teacher; a group with a room in the building; the movement view opened),
// and the ticks are still there after a reload. Dismiss hides the card for
// this project and no other; Help and the About card bring it back; "Don't
// show this again" outlives a reload, the sample school loaded and removed,
// and only Help or About bring it back. The About card's Help button opens
// the whole of Help.
//
// Every change goes through the store with the page's own actions, as the
// tools do, and every read is of the card the page drew. Every wait is on a
// state the page sets: the card's hidden, a step's data-done, the section's
// data-section, the dialog's open.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, startServer, launch, go, waitForSection } from './harness.mjs';
import { HELP_TITLE } from '../../ui/help/index.js';

const CARD = '#getting-started';

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

// A page of its own for a case, opened on an empty project (the sample
// school a new device starts with, removed).
async function onEmpty(run) {
  const session = await openPlanner({ hash: '#building', server, browser, theme: 'light' });
  try {
    await session.page.evaluate(() => globalThis.sv2.ctx.removeSample());
    await session.page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].spaces.length === 0 && globalThis.sv2.store.project.groups.length === 0);
    await run(session.page);
    assert.deepEqual(session.problems().errors, [], 'the page reported errors');
  } finally {
    await session.close();
  }
}

// The page's own action, applied through the store; what it returned.
async function act(page, name, payload) {
  return page.evaluate(async (action, given) => {
    const actions = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(actions[action], given);
    const project = globalThis.sv2.store.project;
    return { floorId: project.building.floors[0].id, width: project.building.floors[0].width, dayTypeId: project.dayTypes[0].id };
  }, name, payload);
}

// What the card shows: { step: done } for the five steps, and the tally.
function ticks(page) {
  return page.evaluate((card) => {
    const element = document.querySelector(card);
    return {
      shown: !element.hidden,
      steps: Object.fromEntries(Array.from(element.querySelectorAll('.steps__step'), (li) => [li.dataset.step, li.dataset.done === 'true'])),
      tally: element.querySelector('.getting-started__tally').textContent,
    };
  }, CARD);
}

// Wait until the card has drawn this step's tick as `done`.
function tickIs(page, step, done) {
  return page.waitForFunction((card, id, wanted) => {
    const li = document.querySelector(card + ' .steps__step[data-step="' + id + '"]');
    return li !== null && li.dataset.done === String(wanted);
  }, {}, CARD, step, done);
}

const shown = (page, wanted) => page.waitForFunction((card, value) => document.querySelector(card).hidden === !value, {}, CARD, wanted);
const onboarding = (page) => page.evaluate(() => ({ ...globalThis.sv2.store.project.onboarding, steps: { ...globalThis.sv2.store.project.onboarding.steps } }));

// Save now, load the page again with what was saved, and wait for it.
async function reload(page, section) {
  // flushed until nothing is waiting, as a snapshot is (storage/snapshots.js)
  await page.waitForFunction(async () => {
    await globalThis.sv2.storage.flush();
    return globalThis.sv2.storage.pending === false;
  }, { polling: 50 });
  await page.reload({ waitUntil: 'load' });
  await waitForSection(page, section);
}

async function showFromHelp(page) {
  await page.click('#help');
  await page.waitForSelector('#help-dialog[open]');
  await page.click('#help-dialog .dialog__buttons button:first-child');
  await shown(page, true);
}

test('each step ticks when the project has what it needs, and only then, and the ticks outlast a reload', async () => {
  await onEmpty(async (page) => {
    assert.deepEqual(await ticks(page), { shown: true, steps: { floor: false, rooms: false, teachers: false, groups: false, movement: false }, tally: '0 of 5 done.' });
    assert.deepEqual(await page.$$eval(CARD + ' .steps__step a', (all) => all.map((a) => [a.textContent, a.getAttribute('href')])), [
      ['Draw or trace a floor', '#building'],
      ['Number the rooms', '#building'],
      ['Add teachers', '#schedule/teachers'],
      ['Add groups', '#schedule/groups'],
      ['Look at the movement view', '#movement'],
    ]);

    // a corridor alone is not a drawn floor
    const { floorId, width, dayTypeId } = await act(page, 'paintCorridor', { floorId: await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].id), from: 2 * 40, to: 2 * 40 + 9 });
    assert.equal(width, 40);
    assert.equal((await ticks(page)).steps.floor, false, 'a corridor with no room ticked the floor');
    // a room beside it: the floor is drawn, but the room has no number
    await act(page, 'placeRoom', { floorId, cells: [width + 1, width + 2] });
    await tickIs(page, 'floor', true);
    assert.deepEqual((await ticks(page)).steps, { floor: true, rooms: false, teachers: false, groups: false, movement: false });
    const roomId = await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].spaces[0].id);
    await act(page, 'setRoomFields', { roomId, number: '101' });
    await tickIs(page, 'rooms', true);
    assert.equal((await ticks(page)).tally, '2 of 5 done.');
    // every room: a second room with no number takes the tick away again
    await act(page, 'placeRoom', { floorId, cells: [width + 5] });
    await tickIs(page, 'rooms', false);
    const second = await page.evaluate(() => globalThis.sv2.store.project.building.floors[0].spaces[1].id);
    await act(page, 'setRoomFields', { roomId: second, number: '102' });
    await tickIs(page, 'rooms', true);

    await act(page, 'addTeacher', { name: 'Mx. Ferngrove' });
    await tickIs(page, 'teachers', true);

    // a group alone, then a group with a room number that is not in the building, then one that is
    await act(page, 'addGroup', { name: '7-1' });
    const groupId = await page.evaluate(() => globalThis.sv2.store.project.groups[0].id);
    assert.equal((await ticks(page)).steps.groups, false, 'a group with no room ticked Add groups');
    await act(page, 'setSlot', { groupId, dayTypeId, period: 0, slot: { room: null, roomText: '999', label: '', teacherIds: [] } });
    assert.equal((await ticks(page)).steps.groups, false, 'a room that is not in the building ticked Add groups');
    await act(page, 'setSlot', { groupId, dayTypeId, period: 0, slot: { room: roomId, label: '', teacherIds: [] } });
    await tickIs(page, 'groups', true);
    assert.deepEqual(await ticks(page), { shown: true, steps: { floor: true, rooms: true, teachers: true, groups: true, movement: false }, tally: '4 of 5 done.' });

    // the last is ticked by looking: the movement view's own link
    await page.click(CARD + ' .steps__step[data-step="movement"] a');
    await waitForSection(page, 'movement');
    await tickIs(page, 'movement', true);
    assert.deepEqual(await ticks(page), { shown: true, steps: { floor: true, rooms: true, teachers: true, groups: true, movement: true }, tally: 'All five are done.' });

    await reload(page, 'movement');
    await tickIs(page, 'movement', true);
    assert.deepEqual(await ticks(page), { shown: true, steps: { floor: true, rooms: true, teachers: true, groups: true, movement: true }, tally: 'All five are done.' }, 'the ticks did not outlast a reload');
  });
});

test('the movement view ticks nothing while it has nothing to draw', async () => {
  await onEmpty(async (page) => {
    await go(page, '#movement');
    await page.waitForSelector('.mov-empty:not([hidden])');
    await go(page, '#building');
    assert.equal((await ticks(page)).steps.movement, false, 'an empty movement view ticked its step');
    assert.equal((await onboarding(page)).steps.movement, undefined);
  });
});

test('Dismiss hides the card for this project, after a reload too, and not for the next project; Help brings it back', async () => {
  await onEmpty(async (page) => {
    await page.click(CARD + ' [data-action="dismiss"]');
    await shown(page, false);
    assert.equal(await page.$eval('.toast .toast__text', (el) => el.textContent), 'Getting started is hidden. Help brings it back.');
    assert.deepEqual([(await onboarding(page)).dismissed, (await onboarding(page)).neverShow], [true, false]);
    await go(page, '#schedule/groups');
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back on another section');
    await reload(page, 'schedule');
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back after a reload');

    await showFromHelp(page);
    assert.equal(await page.evaluate((card) => document.querySelector(card).contains(document.activeElement), CARD), true, 'the focus is not in the card');
    assert.equal((await onboarding(page)).dismissed, false);

    // dismissed again, then the sample school in its place: a project of its own, with its card
    await page.click(CARD + ' [data-action="dismiss"]');
    await shown(page, false);
    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await shown(page, true);
  });
});

test('"Don\'t show this again" outlives a reload and the sample school loaded and removed; Help and About bring it back', async () => {
  await onEmpty(async (page) => {
    await page.click(CARD + ' [data-action="never"]');
    await shown(page, false);
    assert.equal((await onboarding(page)).neverShow, true);
    await reload(page, 'building');
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back after a reload');

    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back with the sample school');
    assert.equal((await onboarding(page)).neverShow, true);
    await page.evaluate(() => globalThis.sv2.ctx.removeSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back when the sample school went');

    await showFromHelp(page);
    assert.equal((await onboarding(page)).neverShow, false, 'asking for the card is changing one\'s mind');

    await page.click(CARD + ' [data-action="never"]');
    await shown(page, false);
    await go(page, '#project');
    await page.click('#about [data-action="show-getting-started"]');
    await shown(page, true);
  });
});

test('the About card\'s Help button reads Help and opens the whole of Help, and the focus comes back to it', async () => {
  await onEmpty(async (page) => {
    await go(page, '#project');
    assert.equal(await page.$eval('#about [data-action="help"]', (el) => el.textContent), 'Help');
    await page.click('#about [data-action="help"]');
    await page.waitForSelector('#help-dialog[open]');
    const seen = await page.evaluate(() => {
      const dialog = document.getElementById('help-dialog');
      return {
        title: document.getElementById(dialog.getAttribute('aria-labelledby')).textContent,
        sections: dialog.querySelectorAll('.help__section').length,
        rail: document.querySelectorAll('#rail a[data-section]').length,
        keys: dialog.querySelectorAll('tbody tr').length > 0,
      };
    });
    assert.deepEqual(seen, { title: HELP_TITLE, sections: seen.rail, rail: seen.rail, keys: true });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('help-dialog') === null || !document.getElementById('help-dialog').open);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'help');
  });
});
