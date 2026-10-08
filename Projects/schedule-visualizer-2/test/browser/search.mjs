// Finding things, in a real browser: node test/browser/search.mjs
//
// The search box in the top bar finds rooms by number, teacher, subject and
// label on every floor, is worked by keys alone, and choosing a result goes
// to the floor, brings the room to the middle and marks it. The same happens
// for the address #building/<floorId>?room=<roomId>, which the Schedule
// section's "Show" uses.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go } from './harness.mjs';
import { planReady, state, floorIs } from './draw-pointer.mjs';

let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const options = () => page.$$eval('#search-results [role="option"]', (all) => all.map((each) => each.textContent));
const listOpen = () => page.$eval('#search-results', (el) => !el.hidden);

async function roomNumbered(number) {
  const now = await project();
  for (const floor of now.building.floors) {
    const room = floor.spaces.find((space) => space.kind === 'room' && space.number === number);
    if (room) return { ...room, floorId: floor.id, floorName: floor.name, width: floor.width };
  }
  throw new Error('no room ' + number);
}

// What the plan shows of a room: is it selected, marked, and in the middle?
function shown(room) {
  return page.evaluate((wanted) => {
    const editor = document.querySelector('.bld').editor;
    const xs = wanted.cells.map((cell) => cell % wanted.width);
    const ys = wanted.cells.map((cell) => Math.floor(cell / wanted.width));
    const middle = editor.view.toCell(editor.view.width / 2, editor.view.height / 2);
    return {
      floorId: editor.floor.id,
      selection: editor.selection.slice(),
      marked: editor.finder.marked ? editor.finder.marked.cells.slice().sort((a, b) => a - b) : null,
      offX: Math.abs(middle.x - (Math.min(...xs) + Math.max(...xs) + 1) / 2),
      offY: Math.abs(middle.y - (Math.min(...ys) + Math.max(...ys) + 1) / 2),
    };
  }, room);
}

async function assertShown(room) {
  await page.waitForFunction((id) => document.querySelector('.bld') && document.querySelector('.bld').editor.selection[0] === id, { timeout: 5000 }, room.id);
  const seen = await shown(room);
  assert.equal(seen.floorId, room.floorId, 'the floor did not change to the room\'s');
  assert.deepEqual(seen.selection, [room.id]);
  assert.deepEqual(seen.marked, room.cells.slice().sort((a, b) => a - b), 'the room is not marked');
  assert.ok(seen.offX < 0.01 && seen.offY < 0.01, 'the room is not in the middle of the window: ' + seen.offX + ', ' + seen.offY);
}

async function type(words) {
  await page.click('#search', { clickCount: 3 });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(words);
}

before(async () => {
  session = await openPlanner({ hash: '#project' });
  page = session.page;
  await page.waitForSelector('#search[data-search="ready"]');
});

after(async () => {
  if (session) await session.close();
});

test('the search box is a combobox with a list of its own, closed until something is typed', async () => {
  assert.equal(await page.$eval('#search', (el) => [el.getAttribute('role'), el.getAttribute('aria-expanded'), el.getAttribute('aria-controls')].join(' ')), 'combobox false search-results');
  assert.equal(await page.$eval('#search-results', (el) => el.getAttribute('role') + ':' + el.hidden), 'listbox:true');
});

test('from another section, a room number finds the room, and Enter goes to its floor, puts it in the middle and marks it', async () => {
  const room = await roomNumbered('203');
  await type('203');
  assert.equal(await listOpen(), true);
  assert.equal(await page.$eval('#search', (el) => el.getAttribute('aria-expanded')), 'true');
  const found = await options();
  assert.equal(found.length, 1);
  assert.match(found[0], /^Room 203 .*Floor 2$/);
  assert.equal(await page.$eval('#search', (el) => el.getAttribute('aria-activedescendant')), 'search-results-0');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'building');
  await planReady(page);
  assert.equal((await state(page)).hash, '#building/' + room.floorId + '?room=' + room.id);
  await assertShown(room);
  assert.equal(await page.$eval('#search', (el) => el.value), '', 'the box kept what was typed');
  assert.equal(await listOpen(), false);
  assert.equal(await text('#inspector-title'), 'Room 203');
  assert.equal(await text('.bld-floors__tab[aria-selected="true"] .bld-floors__name'), 'Floor 2');
});

test('a teacher\'s name finds their room on another floor, and the arrow keys move through the list', async () => {
  const now = await project();
  const room = await roomNumbered('101');
  const teacher = now.teachers.find((each) => each.id === room.teacherIds[0]);
  await type('m');
  const many = await options();
  assert.ok(many.length > 2, 'one letter found ' + many.length);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.$eval('#search', (el) => el.getAttribute('aria-activedescendant')), 'search-results-1');
  assert.equal(await page.$$eval('#search-results [aria-selected="true"]', (all) => all.map((each) => each.id).join()), 'search-results-1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.$eval('#search', (el) => el.getAttribute('aria-activedescendant')), 'search-results-' + (many.length - 1), 'Up from the first did not go to the last');
  assert.equal((await state(page)).floor, 'Floor 2', 'the arrows moved something other than the list');

  await type(teacher.name.split(' ').pop().toUpperCase());
  const found = await options();
  assert.equal(found.length, 1);
  assert.ok(found[0].startsWith('Room 101') && found[0].includes(teacher.name));
  await page.keyboard.press('Enter');
  await floorIs(page, 'Floor 1');
  await assertShown(room);
});

test('a subject and an other space\'s label are found, and a result is chosen with the pointer', async () => {
  const now = await project();
  const room = await roomNumbered('101');
  const subject = now.subjects.find((each) => each.id === room.subjectId);
  await type(subject.name);
  assert.ok((await options()).some((option) => option.startsWith('Room 101')), 'the subject did not find its room');
  let other = null;
  for (const floor of now.building.floors) {
    const space = floor.spaces.find((each) => each.kind === 'other' && each.label !== '');
    if (space && floor.id !== room.floorId) other = { ...space, floorId: floor.id, floorName: floor.name, width: floor.width };
  }
  if (!other) {
    const floor = now.building.floors[0];
    const space = floor.spaces.find((each) => each.kind === 'other' && each.label !== '');
    other = { ...space, floorId: floor.id, floorName: floor.name, width: floor.width };
  }
  await type(other.label);
  const at = await page.$eval('#search-results [role="option"]', (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, label: el.firstChild.textContent };
  });
  assert.equal(at.label, other.label);
  await page.mouse.click(at.x, at.y);
  await assertShown(other);
});

test('Escape closes the list and keeps the focus and what was typed; nothing found is said in a sentence', async () => {
  await type('zzqq');
  assert.equal(await page.$('#search-results [role="option"]'), null);
  assert.equal(await text('#search-results .picker__empty'), 'No room or space in the building matches “zzqq”. Search looks at room numbers, teachers, subjects, wings and labels.');
  await page.keyboard.press('Enter');
  assert.equal(await listOpen(), true, 'Enter on nothing closed the list');
  await page.keyboard.press('Escape');
  assert.equal(await listOpen(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id + ':' + document.activeElement.value), 'search:zzqq');
  await page.keyboard.press('ArrowDown');
  assert.equal(await listOpen(), true, 'Down did not open the list again');
  await type('');
  assert.equal(await listOpen(), false);
});

test('Ctrl+F from the plan goes to the box, and a tool letter typed there is a letter', async () => {
  await page.focus('#plan');
  const tool = (await state(page)).tool;
  await page.keyboard.down('Control');
  await page.keyboard.press('f');
  await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
  await page.keyboard.type('gym');
  assert.equal((await state(page)).tool, tool, 'a letter typed into the search box changed the tool');
  assert.equal((await options())[0].startsWith('Gym'), true);
  await page.keyboard.press('Enter');
  await assertShown(await roomNumbered('Gym'));
});

test('a name typed with markup in it is found and shown as text', async () => {
  const room = await roomNumbered('102');
  await page.evaluate(async (id) => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setRoomFields, { roomId: id, number: 'Lab <img src=x onerror=alert(1)>' });
  }, room.id);
  await type('<img');
  assert.equal(await page.$eval('#search-results [role="option"] .bld-search__name', (el) => el.textContent), 'Lab <img src=x onerror=alert(1)>');
  assert.equal(await page.$('#search-results img'), null, 'a room\'s name was read as markup');
  await page.keyboard.press('Escape');
  await type('');
  await page.click('#undo');
});

test('the address #building/<floor>?room=<room> shows the room, from inside the section and on a fresh load', async () => {
  const room = await roomNumbered('303');
  const other = await roomNumbered('101');
  await go(page, '#building/' + other.floorId);
  await floorIs(page, other.floorName);
  await go(page, '#building/' + room.floorId + '?room=' + room.id);
  await assertShown(room);
  // the address stays as it was asked for, and a change to the project does not rewrite it
  await page.evaluate(async (id) => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setRoomFields, { roomId: id, wing: 'Top' });
  }, room.id);
  assert.equal((await state(page)).hash, '#building/' + room.floorId + '?room=' + room.id);

  // a fresh load of that address: the room is shown once the plan has a size
  await page.goto('about:blank');
  await page.goto(session.url('#building/' + room.floorId + '?room=' + room.id), { waitUntil: 'load' });
  await planReady(page);
  await assertShown(room);
});

test('an address that names a room that is gone shows the floor and marks nothing, and one with the wrong floor still finds the room', async () => {
  const room = await roomNumbered('101');
  const second = (await project()).building.floors[1];
  await go(page, '#building/' + second.id + '?room=rnotthere0');
  await floorIs(page, second.name);
  assert.equal(await page.evaluate(() => document.querySelector('.bld').editor.finder.marked), null);
  assert.deepEqual((await state(page)).selection, []);
  await go(page, '#building/' + second.id + '?room=' + room.id);
  await assertShown(room);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
