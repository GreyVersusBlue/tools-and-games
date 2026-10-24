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
// the whole of Help. The X in the card's top right corner does what Dismiss
// does, by mouse, by keyboard (Tab to it and Enter; Escape anywhere in the
// card) and by a finger at 390 by 844, and the focus lands in the section,
// never on the body; axe finds nothing in the card in either theme (SV2-74).
//
// Every change goes through the store with the page's own actions, as the
// tools do, and every read is of the card the page drew. Every wait is on a
// state the page sets: the card's hidden, a step's data-done, the section's
// data-section, the dialog's open.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import path from 'node:path';

import { openPlanner, startServer, launch, go, waitForSection, TOOL_DIR } from './harness.mjs';
import { HELP_TITLE } from '../../ui/help/index.js';

const CARD = '#getting-started';
const CLOSE = CARD + ' [data-action="close"]';
const AXE = path.join(TOOL_DIR, 'test', 'vendor', 'axe-core', 'axe.min.js');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

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
async function onEmpty(run, options) {
  const session = await openPlanner({ hash: '#building', server, browser, theme: 'light', ...options });
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

// Wait until the card has drawn this step's tick as `done`; a card that
// never does fails with what it shows, not a bare timeout.
async function tickIs(page, step, done) {
  try {
    await page.waitForFunction((card, id, wanted) => {
      const li = document.querySelector(card + ' .steps__step[data-step="' + id + '"]');
      return li !== null && li.dataset.done === String(wanted);
    }, { timeout: 10000 }, CARD, step, done);
  } catch (error) {
    assert.fail('the step "' + step + '" did not read ' + (done ? 'done' : 'not done') + ': ' + JSON.stringify(await ticks(page)));
  }
}

async function shown(page, wanted) {
  try {
    await page.waitForFunction((card, value) => document.querySelector(card).hidden === !value, { timeout: 10000 }, CARD, wanted);
  } catch (error) {
    assert.fail('the card was ' + (wanted ? 'not shown' : 'still shown') + ': ' + JSON.stringify(await onboarding(page)));
  }
}
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

// SV2-30c: a quiet change (Dismiss, the movement tick) stays with the project
// it was made on. Undo of a load brings the other project back as it was
// left; "Don't show this again" is the one that crosses (SV2-30b).
test('Dismiss and the movement tick stay with the project they were made on: undo and redo of a load do not carry them across', async () => {
  await onEmpty(async (page) => {
    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await shown(page, true);
    await go(page, '#movement');
    await tickIs(page, 'movement', true);
    await page.click(CARD + ' [data-action="dismiss"]');
    await shown(page, false);

    await page.click('#undo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    await shown(page, true);
    await tickIs(page, 'movement', false);
    assert.deepEqual(await onboarding(page), { steps: {}, dismissed: false, neverShow: false }, 'undo of the load brought the empty project back with the sample school\'s Dismiss or tick');

    await page.click('#redo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await shown(page, false);
    assert.deepEqual(await onboarding(page), { steps: { movement: true }, dismissed: true, neverShow: false }, 'redo of the load lost what was done on the sample school');

    // never show is the person's: it reaches the project before the load too
    await showFromHelp(page);
    await page.click(CARD + ' [data-action="never"]');
    await shown(page, false);
    await page.click('#undo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    await go(page, '#building');
    assert.deepEqual(await onboarding(page), { steps: {}, dismissed: false, neverShow: true }, 'never show stayed behind with the sample school');
    assert.equal(await page.$eval(CARD, (el) => el.hidden), true, 'the card came back after an undo of the load');
  });
});

// SV2-30c: asking for the card again is changing one's mind about never
// show, so it crosses a load the way "Don't show this again" does; Dismiss
// stays with the project it was said in.
test('reopening the card from Help on the sample school takes never show off the project before the load too', async () => {
  await onEmpty(async (page) => {
    await page.click(CARD + ' [data-action="never"]');
    await shown(page, false);
    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    assert.equal((await onboarding(page)).neverShow, true, 'never show did not come with the sample school, so this proves nothing');
    await showFromHelp(page);
    await page.click(CARD + ' [data-action="dismiss"]');
    await shown(page, false);

    await page.click('#undo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    assert.deepEqual(await onboarding(page), { steps: {}, dismissed: false, neverShow: false }, 'undo of the load brought the project before it back still set to never show, or dismissed');
    await shown(page, true);
  });
});

// SV2-30c: the movement view ticks its step whenever it has something to
// draw, not only when it is opened.
test('the movement view ticks when a project comes to have something to draw while it is open: an undo, the sample school loaded', async () => {
  await onEmpty(async (page) => {
    await go(page, '#movement');
    await page.waitForSelector('.mov-empty:not([hidden])');
    // the undo of "Remove the sample school" puts the sample back under the open view
    await page.click('#undo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await page.waitForFunction(() => document.querySelector('.mov-empty').hidden === true);
    await tickIs(page, 'movement', true);
    assert.equal((await onboarding(page)).steps.movement, true);

    await page.evaluate(() => globalThis.sv2.ctx.removeSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    await tickIs(page, 'movement', false);
    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await tickIs(page, 'movement', true);
    assert.equal((await onboarding(page)).steps.movement, true, 'loading the sample school with the view open did not tick it');
    assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.section), 'movement', 'the view was left, so this proves nothing');
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

// ------------------------------------------------------------ the X (SV2-74)

// The X as the page drew it, against the card it sits in: its place in the
// card's top right corner, its size, its colour and the card's, and the
// button a screen reader finds by the name "Close Getting started".
async function closeButton(page) {
  const seen = await page.evaluate((card, close) => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const element = document.querySelector(card);
    const x = document.querySelector(close);
    if (!x) return null;
    return {
      tag: x.tagName,
      type: x.type,
      text: x.textContent,
      card: box(element),
      x: box(x),
      words: box(element.querySelector('.getting-started__words')),
      toggle: box(element.querySelector('.getting-started__toggle')),
      color: getComputedStyle(x).color,
      background: getComputedStyle(element).backgroundColor,
    };
  }, CARD, CLOSE);
  if (seen === null) assert.fail('the card has no X: ' + JSON.stringify(await page.$eval(CARD + ' .getting-started__head', (el) => el.outerHTML.slice(0, 400))));
  const named = page.__engine === 'playwright'
    ? await page.getByRole('button', { name: 'Close Getting started', exact: true }).count()
    : (await page.$$('aria/Close Getting started[role="button"]')).length;
  return { ...seen, named };
}

// The X is in the corner: at most 16 px from the card's top and right edges,
// above and to the right of the title, and clear of the words beside it.
function inTheCorner(seen, what) {
  const gaps = { right: seen.card.right - seen.x.right, top: seen.x.top - seen.card.top };
  assert.ok(gaps.right >= 0 && gaps.right <= 16 && gaps.top >= 0 && gaps.top <= 16, 'the X is not in the card\'s top right corner (' + what + '): ' + JSON.stringify({ gaps, card: seen.card, x: seen.x }));
  assert.ok(seen.x.left >= seen.words.right, 'the X sits over the title (' + what + '): ' + JSON.stringify({ x: seen.x, words: seen.words }));
  if (seen.toggle.width > 0) assert.ok(seen.x.left >= seen.toggle.right, 'the X sits over "Show the steps" (' + what + '): ' + JSON.stringify({ x: seen.x, toggle: seen.toggle }));
  assert.equal(seen.tag, 'BUTTON');
  assert.equal(seen.type, 'button');
  assert.equal(seen.named, 1, 'no one button is named "Close Getting started" (' + what + ')');
}

// The contrast of two computed colours (rgb or rgba, opaque), WCAG's formula.
function contrast(a, b) {
  const lum = (text) => {
    const [r, g, bl] = text.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// After a close: the card is hidden for this project only, and the focus is
// in the section (its surface, or what the section names as its own), never
// on the body and never left in the hidden card.
async function closedForThisProject(page, how) {
  await shown(page, false);
  const state = await onboarding(page);
  assert.deepEqual([state.dismissed, state.neverShow], [true, false], how + ' did not do what Dismiss does: ' + JSON.stringify(state));
  assert.equal(await page.$eval('.toast .toast__text', (el) => el.textContent), 'Getting started is hidden. Help brings it back.');
  const focus = await page.evaluate((card) => {
    const at = document.activeElement;
    return { body: at === document.body || at === null, inSurface: document.getElementById('surface').contains(at), inCard: document.querySelector(card).contains(at), at: at ? at.tagName + '#' + at.id + '.' + at.className : null };
  }, CARD);
  assert.deepEqual([focus.body, focus.inSurface, focus.inCard], [false, true, false], 'after ' + how + ' the focus is not in the section: ' + JSON.stringify(focus));
}

test('by mouse: the X in the top right corner hides the card for this project as Dismiss does, undo and redo of a load keep it with its project, and Help brings it back', async () => {
  await onEmpty(async (page) => {
    await page.evaluate(() => globalThis.sv2.ctx.loadSample());
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await shown(page, true);

    // the sample school's line: one short sentence, on one line
    const line = await page.$eval(CARD + ' .getting-started__sample', (el) => ({ text: el.textContent, height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
    assert.equal(line.text, 'This is the sample school. Look around.');
    assert.ok(line.height > 0 && line.height < line.lineHeight * 1.5, 'the sample school\'s line takes more than one line: ' + JSON.stringify(line));
    assert.deepEqual(await page.$$eval(CARD + ' .getting-started__buttons button', (all) => all.map((b) => b.textContent)), ['Dismiss', 'Don’t show this again'], 'the quiet buttons are not both there');

    const seen = await closeButton(page);
    inTheCorner(seen, 'at 1280 by 900');
    assert.ok(seen.x.width >= 32 && seen.x.height >= 32, 'the X is small for a mouse: ' + JSON.stringify(seen.x));
    assert.equal(seen.text, '', 'the X has words in it besides its name');

    await page.click(CLOSE);
    await closedForThisProject(page, 'the X');

    // the X's Dismiss is the sample school's: undo of the load brings the
    // empty project back with its card, redo brings the sample back hidden
    await page.click('#undo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length === 0);
    await shown(page, true);
    assert.deepEqual(await onboarding(page), { steps: {}, dismissed: false, neverShow: false }, 'undo of the load brought the X\'s Dismiss across');
    await page.click('#redo');
    await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
    await shown(page, false);
    assert.equal((await onboarding(page)).dismissed, true, 'redo of the load lost the X\'s Dismiss');

    await showFromHelp(page);
    assert.equal((await onboarding(page)).dismissed, false);
  });
});

test('by keyboard: Tab reaches the X and Enter closes the card; Escape with the focus in the card closes it too', async () => {
  await onEmpty(async (page) => {
    // the X is in the tab order just before the first step
    await page.focus(CARD + ' .steps__step a');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'close', 'Shift+Tab from the first step did not reach the X');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Draw or trace a floor', 'Tab from the X did not go on to the first step');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Enter');
    await closedForThisProject(page, 'Enter on the X');

    // Escape from wherever Help's reopen puts the focus in the card, and from a step's link
    await showFromHelp(page);
    await page.keyboard.press('Escape');
    await closedForThisProject(page, 'Escape');
    await showFromHelp(page);
    await page.focus(CARD + ' .steps__step[data-step="teachers"] a');
    await page.keyboard.press('Escape');
    await closedForThisProject(page, 'Escape on a step\'s link');
    assert.equal(await page.evaluate(() => document.querySelector('.surface__layout').dataset.section), 'building', 'Escape went somewhere');
  });
});

test('by touch at 390 by 844: the X is 44 px square in the folded card\'s corner, and a tap closes it', async () => {
  await onEmpty(async (page) => {
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has no coarse pointer');
    await go(page, '#schedule/teachers');
    await shown(page, true);
    const seen = await closeButton(page);
    inTheCorner(seen, 'at 390 by 844');
    assert.ok(seen.x.width >= 44 && seen.x.height >= 44, 'the X is under 44 px for a finger: ' + JSON.stringify(seen.x));
    assert.ok(seen.x.right <= 390, 'the X is off the screen: ' + JSON.stringify(seen.x));
    await page.tap(CLOSE);
    await closedForThisProject(page, 'a tap on the X');
  }, { width: 390, height: 844, mobile: true });
});

// The folded head on a phone is one line (SV2-32o): the X made "Getting
// started" wrap at 390 px and the card 26 px taller (65 to 91), which put
// the first group card of m2-pass under the inspector's handle. The title
// never wraps, and under 640 px the button reads "Steps" by its name
// "Show the steps", so the card is 65 px high at 390 as before SV2-74, and
// at 320 too (where before SV2-74 the title wrapped and it was 91).
for (const [width, height] of [[390, 844], [320, 640]]) {
  test('by touch at ' + width + ' by ' + height + ': the folded head is one line, the title, "Steps" and the X side by side, the card 65 px high, the X 44 px in its corner', async () => {
    await onEmpty(async (page) => {
      await go(page, '#schedule/teachers');
      await shown(page, true);
      const head = await page.evaluate((card) => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const element = document.querySelector(card);
        const title = element.querySelector('.card__title');
        const toggle = element.querySelector('.getting-started__toggle');
        return { card: box(element), title: box(title), lineHeight: parseFloat(getComputedStyle(title).lineHeight), toggle: box(toggle), shows: toggle.innerText.trim(), name: toggle.getAttribute('aria-label') };
      }, CARD);
      assert.equal(head.title.height, head.lineHeight, 'the title is not one line at ' + width + ': ' + JSON.stringify(head));
      assert.equal(Math.round(head.card.height), 65, 'the folded card is not 65 px high at ' + width + ': ' + JSON.stringify(head));
      assert.equal(head.shows, 'Steps');
      assert.equal(head.name, 'Show the steps');
      const named = page.__engine === 'playwright'
        ? await page.getByRole('button', { name: 'Show the steps', exact: true }).count()
        : (await page.$$('aria/Show the steps[role="button"]')).length;
      assert.equal(named, 1, 'no one button is named "Show the steps"');
      const seen = await closeButton(page);
      inTheCorner(seen, 'at ' + width + ' by ' + height);
      assert.ok(seen.x.width >= 44 && seen.x.height >= 44, 'the X is under 44 px for a finger: ' + JSON.stringify(seen.x));
      assert.ok(head.title.right <= head.toggle.left && head.toggle.top < seen.x.bottom && seen.x.top < head.toggle.bottom && head.title.top < head.toggle.bottom, 'the title, the button and the X are not on one row: ' + JSON.stringify({ head, x: seen.x }));
      await page.tap(CARD + ' [data-action="steps"]');
      await page.waitForFunction((card) => document.querySelector(card + ' [data-action="steps"]').getAttribute('aria-expanded') === 'true', {}, CARD);
      assert.equal(await page.$eval(CARD + ' [data-action="steps"]', (el) => el.getAttribute('aria-label')), 'Hide the steps');
    }, { width, height, mobile: true });
  });
}

for (const theme of ['light', 'dark']) {
  test('axe finds nothing in the card in the ' + theme + ' theme, and the X stands out from the card', async () => {
    await onEmpty(async (page) => {
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
      const seen = await closeButton(page);
      const ratio = contrast(seen.color, seen.background);
      assert.ok(ratio >= 3, 'the X\'s line is ' + ratio.toFixed(2) + ':1 on the card in the ' + theme + ' theme (' + seen.color + ' on ' + seen.background + ')');
      await page.addScriptTag({ path: AXE });
      for (const where of ['empty', 'sample']) {
        if (where === 'sample') {
          await page.evaluate(() => globalThis.sv2.ctx.loadSample());
          await page.waitForFunction(() => globalThis.sv2.store.project.groups.length > 0);
          await shown(page, true);
        }
        const found = await page.evaluate((card, tags) => globalThis.axe.run(document.querySelector(card), { runOnly: { type: 'tag', values: tags } }), CARD, AXE_TAGS);
        assert.ok(found.passes.length > 5, 'axe ran very few rules');
        assert.deepEqual(found.violations.map((violation) => violation.id + ': ' + violation.nodes.map((node) => node.target.join(' ')).join(', ')), [], 'on the ' + where + ' project');
      }
    }, { theme });
  });
}
