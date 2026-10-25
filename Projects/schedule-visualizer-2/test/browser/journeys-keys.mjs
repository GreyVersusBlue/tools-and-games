// The main journeys by keyboard alone: node test/browser/journeys-keys.mjs
//
// Five journeys, each from a fresh page, driven by page.keyboard and nothing
// else: Tab, Shift+Tab, the arrows, Enter, Escape and the shortcuts Help
// lists. Draw a building (a corridor and two numbered rooms), enter a
// schedule (a teacher, then a group with rooms for two periods), see movement
// (open Movement, play, find the busiest place), publish and open the file
// from disk (find a teacher and a door sign in the published file), and
// recover after a crash (by the start-up recovery dialog).
//
// page.evaluate reads what the page shows or holds, to assert on; it never
// clicks, focuses or scrolls. The setup a journey needs that a person could
// not do with keys is the harness's: a fresh page, the save held back before
// a crash, the crash itself. Every page listens from the capture phase of
// its window, and a journey fails:
//   - when a pointer, mouse, touch or wheel event reached the page at all;
//   - when a key put the focus on the page's body (a focus that was on
//     something goes nowhere): the case names the key and where the focus
//     was;
//   - when a dialog opens with no accessible name, or a name other than its
//     title (DESIGN 4: a native <dialog> with no name passes axe);
//   - when what it was Tabbing to is not reached before the page's end.
//
// Each journey runs SV2_KEYS_REPEAT times in a row (default 1; the unit was
// proved at 10, `SV2_KEYS_REPEAT=10 node test/browser/journeys-keys.mjs`).

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, startServer, launch, waitForSection, sameOrigin, TOOL_DIR, TOOL_PATH } from './harness.mjs';
import { PLAN, rect, roomCells, pause } from './draw-pointer.mjs';

const REPEAT = Math.max(1, Number(process.env.SV2_KEYS_REPEAT) || 1);
const CLEAN = { errors: [], blocked: [], shimmed: [] };
const SCRATCH_ROOT = process.env.SV2_SCRATCH ? path.resolve(process.env.SV2_SCRATCH) : path.join(TOOL_DIR, 'test', '.scratch');

let server;
let browser;
let scratch;

before(async () => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  scratch = mkdtempSync(path.join(SCRATCH_ROOT, 'keys-'));
  server = await startServer();
  browser = await launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  try {
    rmdirSync(SCRATCH_ROOT);
  } catch (error) {
    // another suite's files are still in it, or the machine named it
  }
});

// ---------------------------------------------------------------- what the page saw

// Every pointer, mouse, touch and wheel event the page receives, and every
// time the focus left something for the body. A focus that leaves with
// nowhere to go is looked at again two frames later, so a section that puts
// the focus on its surface once its sheet is in is not counted.
function listen() {
  if (globalThis.__keysLog) return;
  const log = { pointers: [], keys: 0, lost: [], lastKey: '' };
  globalThis.__keysLog = log;
  const named = (el) => {
    if (!el || !el.tagName) return String(el);
    const name = el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + name + '"';
  };
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu']) {
    addEventListener(type, (event) => {
      if (event.isTrusted) log.pointers.push(type + ' on ' + named(event.target));
    }, true);
  }
  // a click a key makes has no detail; a click with one is a button pressed
  addEventListener('click', (event) => {
    if (event.isTrusted && event.detail > 0) log.pointers.push('click on ' + named(event.target));
  }, true);
  addEventListener('keydown', (event) => {
    log.keys += 1;
    log.lastKey = event.key;
  }, true);
  addEventListener('focusout', (event) => {
    if (event.relatedTarget) return;
    const from = named(event.target);
    const key = log.lastKey;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = document.activeElement;
      if ((now === null || now === document.body) && document.hasFocus()) log.lost.push({ key, from });
    }));
  }, true);
}

async function hear(page) {
  await page.evaluate(listen);
}

// Two frames, so what a key started has been drawn and looked at.
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// The focused element, in words, for a failure to say.
function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'the body';
    const name = el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + ' "' + name + '"';
  });
}

// Each open dialog has the name its title gives it, checked once per opening.
async function dialogsNamed(page) {
  const opened = await page.$$('dialog[open]');
  for (const dialog of opened) {
    const seen = await dialog.evaluate((el) => {
      const was = el.__keysNamed === true;
      el.__keysNamed = true;
      const title = el.querySelector('h1, h2, h3');
      return { was, id: el.id, title: title ? title.textContent : null };
    });
    if (seen.was) continue;
    const node = await page.accessibility.snapshot({ root: dialog, interestingOnly: false });
    assert.ok(seen.title, 'the dialog ' + (seen.id || '') + ' has no title');
    assert.equal(node && node.name, seen.title, 'the dialog ' + (seen.id || '') + ' is named by its title');
    page.__keysDialogs = (page.__keysDialogs || []).concat([{ id: seen.id, title: seen.title }]);
  }
}

// What a key did to the focus and the dialogs, checked the moment it is done.
async function afterKey(page, what) {
  await frames(page);
  const lost = await page.evaluate(() => globalThis.__keysLog.lost.splice(0));
  assert.deepEqual(lost, [], what + ' put the focus on the page\'s body');
  await dialogsNamed(page);
}

// One key, or a chord written "Shift+Tab", "Control+a".
async function key(page, combo, times = 1) {
  const parts = combo.split('+');
  const last = parts.pop();
  for (let i = 0; i < times; i += 1) {
    for (const held of parts) await page.keyboard.down(held);
    await page.keyboard.press(last);
    for (const held of parts.slice().reverse()) await page.keyboard.up(held);
    await afterKey(page, combo);
  }
}

async function type(page, text) {
  await page.keyboard.type(text);
  await afterKey(page, 'typing "' + text + '"');
}

// Is the focus on what `want` names: { selector, name } (name: a string the
// element's aria-label or text starts with, or a RegExp)?
function focusIs(page, want) {
  return page.evaluate((selector, source, flags, starts) => {
    const el = document.activeElement;
    if (!el || el === document.body || (selector && !el.matches(selector))) return false;
    const name = el.getAttribute('aria-label') || el.textContent.trim().replace(/\s+/g, ' ');
    if (source !== null) return new RegExp(source, flags).test(name);
    return starts === null || name.startsWith(starts);
  }, want.selector || null, want.name instanceof RegExp ? want.name.source : null, want.name instanceof RegExp ? want.name.flags : '', typeof want.name === 'string' ? want.name : null);
}

// Tab (or Shift+Tab, `back`) until the focus is on `want`. Not reaching it
// before the page's end, or within `most` stops, is a barrier.
async function tabTo(page, want, options) {
  const back = Boolean(options && options.back);
  const most = (options && options.most) || 120;
  const words = (want.selector || '') + (want.name ? ' "' + want.name + '"' : '');
  for (let stop = 0; stop <= most; stop += 1) {
    if (await focusIs(page, want)) return stop;
    if (stop > 0 && (await page.evaluate(() => document.activeElement === document.body))) {
      assert.fail(words + ' cannot be reached by ' + (back ? 'Shift+Tab' : 'Tab') + ': the focus left the page after ' + stop + ' stops');
    }
    await key(page, back ? 'Shift+Tab' : 'Tab');
  }
  return assert.fail(words + ' was not reached in ' + most + ' ' + (back ? 'Shift+Tab' : 'Tab') + ' stops; the focus is on ' + (await focused(page)));
}

// The focus comes to rest on `selector`.
async function focusOn(page, selector, what) {
  try {
    await page.waitForFunction((wanted) => document.activeElement && document.activeElement.matches(wanted), { timeout: 5000 }, selector);
  } catch (error) {
    assert.fail(what + ': the focus is on ' + (await focused(page)) + ', not ' + selector);
  }
}

// Nothing but keys reached the page.
async function onlyKeys(page, what) {
  const log = await page.evaluate(() => globalThis.__keysLog);
  assert.ok(log, what + ': the page was not listening');
  assert.ok(log.keys > 0, what + ': no key reached the page');
  assert.deepEqual(log.pointers, [], what + ': something other than a key reached the page');
  assert.deepEqual(log.lost, [], what + ': the focus went to the body');
}

// ---------------------------------------------------------------- pages

// A fresh planner, listening: a new device, which opens on the sample school.
async function keysPlanner(hash) {
  const session = await openPlanner({ server, browser, hash: hash || '#building', theme: 'light', width: 1280, height: 900 });
  await hear(session.page);
  return session;
}

async function finish(session, run) {
  let failed = null;
  try {
    await run(session.page, session);
  } catch (error) {
    failed = error;
    if (process.env.SV2_KEYS_SHOTS) await session.page.screenshot({ path: path.join(process.env.SV2_KEYS_SHOTS, 'failed-' + Date.now() + '.png') }).catch(() => {});
  }
  const found = session.problems();
  await session.close();
  if (failed) throw failed;
  assert.deepEqual(found, CLEAN);
}

// A section opened by its key, and drawn.
async function section(page, digit, id) {
  await key(page, digit);
  await waitForSection(page, id);
  await afterKey(page, 'the section ' + id + ' drawn');
}

// ---------------------------------------------------------------- 1. draw a building

const cursorAt = (page) => page.evaluate(() => {
  const { cursor } = document.querySelector('.bld').editor;
  return [cursor.x, cursor.y];
});

// The plan's cursor to a cell, by the arrows.
async function walk(page, x, y) {
  const [cx, cy] = await cursorAt(page);
  if (x !== cx) await key(page, x > cx ? 'ArrowRight' : 'ArrowLeft', Math.abs(x - cx));
  if (y !== cy) await key(page, y > cy ? 'ArrowDown' : 'ArrowUp', Math.abs(y - cy));
  assert.deepEqual(await cursorAt(page), [x, y], 'the cursor did not get to the cell');
}

// A drag by keys: Shift held over the arrows; letting it go ends the drag.
async function shiftDrag(page, from, to) {
  await walk(page, from[0], from[1]);
  await page.keyboard.down('Shift');
  if (to[0] !== from[0]) await key(page, to[0] > from[0] ? 'ArrowRight' : 'ArrowLeft', Math.abs(to[0] - from[0]));
  if (to[1] !== from[1]) await key(page, to[1] > from[1] ? 'ArrowDown' : 'ArrowUp', Math.abs(to[1] - from[1]));
  await page.keyboard.up('Shift');
  await afterKey(page, 'Shift let go');
}

const ROOMS = PLAN.rooms.slice(0, 2);

// From the sample school a fresh page opens on: remove it in Project, then
// draw a corridor and two numbered rooms on the empty floor.
async function drawBuilding(page) {
  await section(page, '7', 'project');
  await tabTo(page, { selector: 'button', name: 'Remove the sample school' });
  await key(page, 'Enter');
  await page.waitForFunction(() => {
    const { building, groups } = globalThis.sv2.store.project;
    return building.floors.length === 1 && building.floors[0].spaces.length === 0 && groups.length === 0;
  }, { timeout: 5000 });
  // the Building key from inside the Project page: the plan has the keyboard
  await section(page, '1', 'building');
  await focusOn(page, '#plan', 'Building opened by its key');
  await key(page, 'c');
  await shiftDrag(page, PLAN.corridor.from, PLAN.corridor.to);
  await key(page, 'r');
  for (const room of ROOMS) {
    await shiftDrag(page, room.from, room.to);
    await focusOn(page, '#room-number', 'a room placed by keys');
    await type(page, room.number);
    await key(page, 'Enter');
    await focusOn(page, '#plan', 'Enter in the number field');
  }
  const floor = await page.evaluate(() => {
    const first = globalThis.sv2.store.project.building.floors[0];
    return { width: first.width, cells: first.cells, numbers: first.spaces.map((space) => space.number).sort() };
  });
  const corridor = rect(floor.width, PLAN.corridor.from[0], PLAN.corridor.from[1], PLAN.corridor.to[0] - PLAN.corridor.from[0] + 1, 1);
  assert.ok(corridor.every((cell) => floor.cells[cell] === '#'), 'the corridor is on the floor');
  assert.equal(floor.cells.split('').filter((cell) => cell === '#').length, corridor.length, 'the corridor and nothing else is walkable');
  assert.deepEqual(floor.numbers, ROOMS.map((room) => room.number));
  for (const room of ROOMS) {
    assert.deepEqual(await roomCells(page, room.number), rect(floor.width, room.from[0], room.from[1], room.to[0] - room.from[0] + 1, room.to[1] - room.from[1] + 1));
  }
  assert.equal(await page.$eval('#plan-counts [data-count="rooms"]', (el) => el.textContent), '2 of 2 rooms numbered');
}

// A dialog a key opened closes on Escape, with the focus back where it was.
async function openAndEscape(page, combo, id, back) {
  await key(page, combo);
  await page.waitForSelector('#' + id + '[open]', { timeout: 10000 });
  await afterKey(page, 'the dialog ' + id + ' opened');
  assert.ok((page.__keysDialogs || []).some((seen) => seen.id === id), 'the dialog ' + id + ' was looked at');
  assert.equal(await page.evaluate((wanted) => document.getElementById(wanted).contains(document.activeElement), id), true, 'the dialog ' + id + ' has the focus: ' + (await focused(page)));
  await key(page, 'Escape');
  await page.waitForFunction((wanted) => document.getElementById(wanted) === null || !document.getElementById(wanted).open, { timeout: 5000 }, id);
  await focusOn(page, back, 'Escape in the dialog ' + id);
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('draw a building by keys: the sample removed, a corridor and two numbered rooms (run ' + run + ' of ' + REPEAT + ')', async () => {
    await finish(await keysPlanner('#building'), async (page) => {
      await drawBuilding(page);
      // Help, from the plan, and back
      await openAndEscape(page, '?', 'help-dialog', '#plan');
      await onlyKeys(page, 'draw a building');
    });
  });
}

// ---------------------------------------------------------------- 2. enter a schedule

const TEACHER = 'Ms. Wrenfield';
const GROUP = '7 Alder';

const project = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const roomId = async (page, number) => (await project(page)).building.floors.flatMap((floor) => floor.spaces).find((space) => space.number === number).id;

// The option a combobox's arrow keys have highlighted, as text.
const highlighted = (page) => page.evaluate(() => {
  const input = document.activeElement;
  const id = input && input.getAttribute('aria-activedescendant');
  const option = id ? document.getElementById(id) : null;
  return option ? option.textContent.trim() : null;
});

async function enterSchedule(page) {
  await drawBuilding(page);
  // the Schedule key from the plan: the section has the keyboard
  await section(page, '2', 'schedule');
  await focusOn(page, '#surface', 'Schedule opened by its key');
  // the tabs are one Tab stop; the arrows go along them
  await tabTo(page, { selector: '[role="tab"]', name: 'Groups' });
  await key(page, 'ArrowRight', 2);
  await page.waitForFunction(() => location.hash === '#schedule/teachers', { timeout: 5000 });
  await tabTo(page, { selector: '[data-action="add-teacher"]' });
  await key(page, 'Enter');
  await focusOn(page, 'input[name="teacherName"]', 'Add a teacher');
  await key(page, 'Control+a');
  await type(page, TEACHER);
  await key(page, 'Tab');
  await page.waitForFunction((name) => globalThis.sv2.store.project.teachers.some((teacher) => teacher.name === name), { timeout: 5000 }, TEACHER);
  // the teacher's room: typed into the picker, the option chosen by the arrows
  await tabTo(page, { selector: '[role="combobox"]', name: 'Add a room for ' + TEACHER });
  await type(page, ROOMS[0].number);
  await key(page, 'ArrowDown');
  assert.equal(await highlighted(page), ROOMS[0].number, 'the arrow highlights the room typed');
  await key(page, 'Enter');
  const first = await roomId(page, ROOMS[0].number);
  await page.waitForFunction((name, id) => globalThis.sv2.store.project.teachers.find((teacher) => teacher.name === name).roomIds.includes(id), { timeout: 5000 }, TEACHER, first);

  // the teacher list's print preview, and back
  await tabTo(page, { selector: '#print-teachers' }, { back: true });
  await openAndEscape(page, 'Enter', 'print-preview', '#print-teachers');

  // back along the page to the tabs, and Groups
  await tabTo(page, { selector: '[role="tab"]', name: 'Teachers' }, { back: true });
  await key(page, 'ArrowLeft', 2);
  await page.waitForFunction(() => location.hash === '#schedule/groups', { timeout: 5000 });
  await tabTo(page, { selector: '[data-action="add-group"]' });
  await key(page, 'Enter');
  await focusOn(page, 'input[name="groupName"]', 'Add a group');
  await key(page, 'Control+a');
  await type(page, GROUP);
  await key(page, 'Tab');
  await page.waitForFunction((name) => globalThis.sv2.store.project.groups.some((group) => group.name === name), { timeout: 5000 }, GROUP);
  // a room for each of the first two periods, typed; Enter keeps what was typed
  for (const [period, room] of ROOMS.entries()) {
    await tabTo(page, { selector: '[role="combobox"]', name: 'Room for Period ' + (period + 1) + ' on A Day' });
    await type(page, room.number);
    await key(page, 'Enter');
    const id = await roomId(page, room.number);
    await page.waitForFunction((name, at, wanted) => {
      const group = globalThis.sv2.store.project.groups.find((each) => each.name === name);
      const day = globalThis.sv2.store.project.dayTypes[0].id;
      return group.days[day][at].room === wanted;
    }, { timeout: 5000 }, GROUP, period, id);
  }
  const done = await project(page);
  const group = done.groups.find((each) => each.name === GROUP);
  const day = group.days[done.dayTypes[0].id];
  assert.deepEqual(day.slice(0, 2).map((slot) => slot.room), [first, await roomId(page, ROOMS[1].number)]);
  assert.ok(day.slice(2).every((slot) => slot.room === null), 'only the first two periods have rooms');
  // the teacher follows the room: Period 1's teacher field says whose room it is
  assert.match(await page.$eval('[role="combobox"][aria-label^="Teacher for Period 1 on A Day"]', (el) => el.getAttribute('aria-label')), new RegExp('the room’s: ' + TEACHER.replace('.', '\\.')));
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('enter a schedule by keys: a teacher with a room, then a group with rooms for two periods (run ' + run + ' of ' + REPEAT + ')', async () => {
    await finish(await keysPlanner('#building'), async (page) => {
      await enterSchedule(page);
      await onlyKeys(page, 'enter a schedule');
    });
  });
}

// ---------------------------------------------------------------- 3. see movement

// The movement view has the answer for the project as it is, and its first rows.
const movementReady = (page) => page.waitForFunction(() => {
  const section = document.querySelector('.mov');
  const panel = document.querySelector('[data-panel="hotspots"]');
  if (!section || section.dataset.styled !== 'true' || !panel) return false;
  const { state } = section.movement;
  return state !== null && state.results !== null && state.project === globalThis.sv2.store.project && panel.hotspots.rows.length > 0;
}, { timeout: 15000 });

async function seeMovement(page) {
  // a fresh page has no focus: the skip link is the first stop, and it puts
  // the keyboard on the plan
  await key(page, 'Tab');
  assert.equal(await focusIs(page, { selector: 'a.skip' }), true, 'the first Tab is the skip link');
  await key(page, 'Enter');
  await focusOn(page, '#plan', 'the skip link');
  // the Movement key from the plan: the map has the keyboard
  await section(page, '3', 'movement');
  await focusOn(page, '#movement-plan', 'Movement opened by its key');
  await movementReady(page);
  await tabTo(page, { selector: '.mov-pb__play' });
  await key(page, 'Enter');
  await page.waitForFunction(() => document.querySelector('.mov-pb__play').textContent === 'Pause', { timeout: 5000 });
  // the busiest place: the first row of Hotspots, chosen by Enter
  await tabTo(page, { selector: '[data-panel="hotspots"] .mov-hot__name' });
  await key(page, 'Enter');
  const found = await page.evaluate(() => {
    const { hotspots } = document.querySelector('[data-panel="hotspots"]');
    return {
      selected: hotspots.selected,
      first: hotspots.rows[0].id,
      load: hotspots.rows[0].load,
      most: Math.max(...hotspots.rows.map((row) => row.load)),
      busiest: document.querySelector('.mov').movement.picture.busiest.load,
      playing: document.querySelector('.mov-pb__play').textContent,
    };
  });
  assert.equal(found.selected, found.first, 'Enter on the first row chooses the busiest place');
  assert.equal(found.load, found.most, 'the first row is the busiest');
  assert.equal(found.load, found.busiest, 'and its load is the map\'s busiest');
  assert.equal(found.playing, 'Pause', 'the groups are still walking');
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('see movement by keys: open Movement, play, find the busiest place (run ' + run + ' of ' + REPEAT + ')', async () => {
    await finish(await keysPlanner('#building'), async (page) => {
      await seeMovement(page);
      await onlyKeys(page, 'see movement');
    });
  });
}

// ---------------------------------------------------------------- 4. publish, and open the file from disk

const PASSCODE = 'bulldogs2015';

async function publishFile(page, folder) {
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: folder });
  await key(page, 'Tab');
  await key(page, 'Enter');
  await focusOn(page, '#plan', 'the skip link');
  await section(page, '6', 'staff');
  await tabTo(page, { selector: '#publish-file' }, { most: 200 });
  await key(page, 'Enter');
  await page.waitForFunction(() => /^Published /.test(document.querySelector('[data-says="published"]').textContent), { timeout: 30000 });
  let names = [];
  for (let tries = 0; tries < 100 && !(names.length === 1 && names[0].endsWith('.html')); tries += 1) {
    await pause(100);
    names = readdirSync(folder);
  }
  assert.equal(names.length, 1, 'one file was downloaded: ' + names.join(', '));
  return path.join(folder, names[0]);
}

// A published file opened from disk in a browser profile of its own, every request counted.
async function openFile(file) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(listen);
  const url = pathToFileURL(file).href;
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  return {
    page,
    errors,
    asked: () => requests.filter((each) => each !== url && !each.startsWith(url + '#') && !each.startsWith('data:')),
    close: () => context.close(),
  };
}

const fileIs = (page, wanted) => page.waitForFunction((want) => document.getElementById('app').dataset.state === want, { timeout: 30000 }, wanted);
const heading = (page) => page.$eval('h1', (el) => el.textContent);

async function useFile(page) {
  await fileIs(page, 'locked');
  await tabTo(page, { selector: '#passcode' });
  await type(page, PASSCODE);
  await key(page, 'Enter');
  await fileIs(page, 'open');
  // find a teacher: the search box, a part of the name, the arrow, Enter
  await tabTo(page, { selector: '#find' });
  await type(page, 'Hallor');
  await page.waitForSelector('a.list__link[data-result="teacher"]');
  await key(page, 'ArrowDown');
  assert.equal(await focusIs(page, { selector: 'a.list__link[data-result="teacher"]', name: 'Ms. Halloran' }), true, 'the arrow goes to the first result: ' + (await focused(page)));
  await key(page, 'Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/teacher/') && document.querySelector('h1').textContent === 'Ms. Halloran', { timeout: 5000 });
  // the teacher's room, and its door sign
  await tabTo(page, { selector: 'main a[href^="#/room/"]' });
  await key(page, 'Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/room/') && document.querySelector('[data-output="door"]'), { timeout: 5000 });
  const room = await heading(page);
  await tabTo(page, { selector: '[data-output="door"]' });
  await key(page, 'Enter');
  await page.waitForFunction(() => location.hash.startsWith('#/door/') && document.querySelector('.sign__number'), { timeout: 5000 });
  return { room, number: await page.$eval('.sign__number', (el) => el.textContent), sign: await page.$eval('.sign', (el) => el.textContent) };
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('publish by keys and open the file from disk: find a teacher and a door sign by keys in the file (run ' + run + ' of ' + REPEAT + ')', async () => {
    const folder = mkdtempSync(path.join(scratch, 'publish-'));
    let file;
    await finish(await keysPlanner('#building'), async (page) => {
      file = await publishFile(page, folder);
      await onlyKeys(page, 'publish');
    });
    const reader = await openFile(file);
    try {
      const found = await useFile(reader.page);
      assert.equal(found.room, 'Room 101');
      assert.equal(found.number, '101');
      assert.ok(found.sign.includes('Ms. Halloran'), 'the door sign names the teacher: ' + found.sign);
      await onlyKeys(reader.page, 'the published file');
      assert.deepEqual(reader.asked(), [], 'the file asked for nothing beyond itself');
      assert.deepEqual(reader.errors, []);
    } finally {
      await reader.close();
    }
  });
}

// ---------------------------------------------------------------- 5. recover after a crash

const SCHOOL = 'Hollowmere Upper School';

// Kill the page's process (no pagehide, no flush), close its target, and wait
// until the editing tab's lock is free, so the next page is the editing one.
async function crash(page) {
  const client = await page.createCDPSession();
  const { targetInfo } = await client.send('Target.getTargetInfo');
  const probe = await browser.newPage();
  await probe.goto(server.base + TOOL_PATH + 'icon.svg', { waitUntil: 'load' });
  const lockHeld = () => probe.evaluate(async () => (await navigator.locks.query()).held.some((lock) => lock.name === 'sv2:project'));
  assert.equal(await lockHeld(), true, 'the probe sees the editing tab holding the lock');
  client.send('Page.crash').catch(() => {});
  await pause(500);
  await Promise.race([page.close().catch(() => {}), pause(3000)]);
  const connection = (await probe.createCDPSession()).connection();
  await connection.send('Target.closeTarget', { targetId: targetInfo.targetId }).catch(() => {});
  await probe.waitForFunction(async () => !(await navigator.locks.query()).held.some((lock) => lock.name === 'sv2:project'), { timeout: 15000, polling: 250 });
  await probe.close();
}

for (let run = 1; run <= REPEAT; run += 1) {
  test('recover after a crash by keys: the work is in a recovery point, the page dies, and the start-up dialog brings it back by keys (run ' + run + ' of ' + REPEAT + ')', async () => {
    const session = await keysPlanner('#project');
    const { page } = session;
    await page.waitForFunction(() => globalThis.sv2.storage && globalThis.sv2.storage.state.available && !globalThis.sv2.storage.state.readOnly, { timeout: 15000 });
    // The crash comes after the recovery point and before the save: the
    // save is held back a minute and a point is taken every 300 ms, which is
    // the harness standing in for a page that died inside the save's delay.
    await page.evaluate(() => globalThis.sv2.storage.setTiming({ delay: 60000, maxWait: 60000, recoveryMs: 300 }));
    // the work, by keys: the school's name, from the top bar
    await tabTo(page, { selector: '#school-name' });
    await key(page, 'Enter');
    await focusOn(page, '#school-name-field', 'the school name opened by Enter');
    await type(page, SCHOOL);
    await key(page, 'Enter');
    await focusOn(page, '#school-name', 'Enter in the school name');
    await page.waitForFunction((name) => globalThis.sv2.store.project.settings.schoolName === name, { timeout: 5000 }, SCHOOL);
    await page.waitForFunction((name) => new Promise((resolve) => {
      const open = indexedDB.open('sv2-recovery');
      open.onsuccess = () => {
        const all = open.result.transaction('recovery', 'readonly').objectStore('recovery').getAll();
        all.onsuccess = () => {
          open.result.close();
          resolve(all.result.some((point) => point.project.settings.schoolName === name));
        };
      };
    }), { timeout: 10000 }, SCHOOL);
    await onlyKeys(page, 'the work before the crash');
    const problems = session.problems();
    await crash(page);
    assert.deepEqual(problems, CLEAN);

    // the next start: the planner asks before it draws
    const next = await browser.newPage();
    try {
      await next.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
      await next.evaluateOnNewDocument(listen);
      const errors = [];
      next.on('pageerror', (error) => errors.push('page error: ' + error.message));
      const offsite = [];
      next.on('request', (request) => {
        if (!sameOrigin(request.url(), server.base)) offsite.push(request.url());
      });
      await next.goto(server.base + TOOL_PATH + '#building', { waitUntil: 'load' });
      await next.waitForSelector('#recovery-dialog[open]');
      await dialogsNamed(next);
      assert.deepEqual(next.__keysDialogs, [{ id: 'recovery-dialog', title: 'No saved project was found, but there is a recovery point.' }]);
      // the dialog has the keyboard; Tab goes round its buttons to Restore
      assert.equal(await next.evaluate(() => document.getElementById('recovery-dialog').contains(document.activeElement)), true, 'the dialog has the focus: ' + (await focused(next)));
      await tabTo(next, { selector: '#recovery-dialog button', name: 'Restore the recovery point' }, { most: 6 });
      await key(next, 'Enter');
      await waitForSection(next, 'building');
      // the keyboard is on the section's surface, not on the page's body
      await focusOn(next, '#plan', 'the start-up dialog answered');
      assert.equal(await next.evaluate(() => globalThis.sv2.store.project.settings.schoolName), SCHOOL);
      assert.match(await next.$eval('.school__text', (el) => el.textContent), new RegExp(SCHOOL));
      await onlyKeys(next, 'the recovery dialog');
      assert.deepEqual(errors, []);
      assert.deepEqual(offsite, []);
    } finally {
      await next.close();
    }
  });
}
