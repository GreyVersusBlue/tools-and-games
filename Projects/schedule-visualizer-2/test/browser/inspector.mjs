// The building inspector's five tabs, in a real browser: node test/browser/inspector.mjs
//
// On the sample school: every property of a room kept on Enter or on leaving
// the field, a teacher added where the room is, the room list sorted and
// edited in place, the floor renamed and resized with what would be lost said
// first, an image traced over (reduced on import, placed, moved, hidden,
// missing, removed), the building checks with "Show me", and the exits.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openPlanner } from './harness.mjs';
import { planReady, point, drag, state, pixel, wholeFloor, clearToast, floorIs } from './draw-pointer.mjs';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'images', 'floor-plan.png');

let session;
let page;

const text = (selector) => page.$eval(selector, (el) => el.textContent);
const value = (selector) => page.$eval(selector, (el) => el.value);
const entries = async () => (await state(page)).entries;
const project = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.sv2.store.project)));
const tab = (id) => page.click('#inspector [data-tab="' + id + '"]');

async function findRoom(number) {
  const now = await project();
  for (const floor of now.building.floors) {
    const room = floor.spaces.find((space) => space.kind === 'room' && space.number === number);
    if (room) return { ...room, floorId: floor.id, floorWidth: floor.width };
  }
  return null;
}

async function roomById(id) {
  const now = await project();
  return now.building.floors.flatMap((floor) => floor.spaces).find((space) => space.id === id) || null;
}

// Click a space of the floor on screen with the Select tool.
async function selectSpace(id) {
  const cell = await page.evaluate((wanted) => {
    const editor = document.querySelector('.bld').editor;
    const space = editor.floor.spaces.find((each) => each.id === wanted);
    return [space.cells[0] % editor.floor.width, Math.floor(space.cells[0] / editor.floor.width)];
  }, id);
  await page.keyboard.press('v');
  const at = await point(page, cell[0], cell[1]);
  await page.mouse.click(at.x, at.y);
}

async function retype(selector, typed, key) {
  await page.click(selector, { clickCount: 3 });
  if (typed === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(typed);
  if (key) await page.keyboard.press(key);
}

before(async () => {
  session = await openPlanner({ hash: '#building' });
  page = session.page;
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setOnboarding, { dismissed: true });
  });
  await planReady(page);
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- the tabs

test('the inspector has five tabs, in the order of the design, and only the one on show is in the page', async () => {
  assert.deepEqual(await page.$$eval('#inspector [role="tab"]', (all) => all.map((each) => each.textContent)), ['Properties', 'Rooms', 'Floor', 'Checks', 'Exits']);
  assert.equal(await page.$$eval('#inspector [role="tab"][tabindex="0"]', (all) => all.length), 1, 'the tabs are one Tab stop');
  assert.equal(await text('#inspector .bld-inspector__title'), 'Nothing is selected');
  assert.equal(await page.$('#inspector-rooms'), null);
  await page.focus('#inspector [data-tab="properties"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await text('#rooms-title'), 'The rooms of Floor 1');
  await page.keyboard.press('End');
  assert.equal(await text('#inspector .bld-inspector__title'), 'Exits');
  await page.keyboard.press('Home');
  assert.equal(await text('#inspector .bld-inspector__title'), 'Nothing is selected');
  assert.equal(await page.$eval('link[data-sheet="building-inspector"]', (link) => link.sheet !== null && new URL(link.href).origin === location.origin), true, 'the inspector\'s stylesheet is not this page\'s own');
});

// ---------------------------------------------------------------- properties of a room

test('a selected room shows every property it has', async () => {
  const room = await findRoom('101');
  await selectSpace(room.id);
  assert.equal(await text('#inspector-title'), 'Room 101');
  assert.equal(await value('#room-number'), '101');
  const now = await project();
  const teacher = now.teachers.find((each) => each.id === room.teacherIds[0]);
  assert.equal(await text('#room-teachers .bi-person__name'), teacher.name);
  assert.equal(await text('#room-teachers .bi-person__main'), 'Main teacher');
  assert.equal(await value('#room-subject'), room.subjectId);
  assert.equal(await value('#room-wing'), room.wing);
  assert.equal(await value('#room-capacity'), String(room.capacity));
  assert.equal(await page.$eval('#room-shared', (el) => el.checked), room.shared);
  assert.equal(await page.$$eval('#room-doors li', (all) => all.length), room.doors.length);
});

test('the wing is kept on Enter and the capacity on leaving the field, each as one undo step', async () => {
  const room = await findRoom('101');
  const before = await entries();
  await retype('#room-wing', 'North <wing> & "annex"', 'Enter');
  assert.equal((await roomById(room.id)).wing, 'North <wing> & "annex"');
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Edit Room 101');
  await retype('#room-capacity', '28');
  await page.click('#room-wing');
  assert.equal((await roomById(room.id)).capacity, 28, 'leaving the field did not keep the capacity');
  assert.equal(await entries(), before + 2);
  assert.equal(await value('#room-wing'), 'North <wing> & "annex"', 'the wing is not shown as typed');
});

test('a capacity that is not a number is refused under the field in a sentence, and an empty one means none', async () => {
  const room = await findRoom('101');
  const before = await entries();
  await retype('#room-capacity', 'lots', 'Enter');
  assert.equal(await page.$eval('#room-capacity', (el) => el.getAttribute('aria-invalid')), 'true');
  assert.equal(await page.$eval('#room-capacity', (el) => el.closest('.field').querySelector('.field__refusal').textContent), 'A capacity is a whole number, or empty. "lots" is neither.');
  assert.equal(await entries(), before);
  await retype('#room-capacity', '5000', 'Enter');
  assert.equal(await page.$eval('#room-capacity', (el) => el.closest('.field').querySelector('.field__refusal').textContent), 'A capacity is a whole number from 1 to 999, or empty.');
  await retype('#room-capacity', '', 'Enter');
  assert.equal((await roomById(room.id)).capacity, null);
  assert.equal(await page.$eval('#room-capacity', (el) => el.getAttribute('aria-invalid')), null);
  assert.equal(await entries(), before + 1);
});

test('the subject is chosen from the school\'s list, "No subject" empties it, and the shared flag is one click', async () => {
  const room = await findRoom('101');
  const now = await project();
  assert.deepEqual(await page.$$eval('#room-subject option', (all) => all.map((each) => each.textContent)), ['No subject'].concat(now.subjects.map((subject) => subject.name)));
  const other = now.subjects.find((subject) => subject.id !== room.subjectId);
  const before = await entries();
  await page.select('#room-subject', other.id);
  assert.equal((await roomById(room.id)).subjectId, other.id);
  await page.select('#room-subject', '');
  assert.equal((await roomById(room.id)).subjectId, null);
  await page.click('#room-shared');
  assert.equal((await roomById(room.id)).shared, true);
  assert.equal(await entries(), before + 3);
});

test('a teacher on the list is added from the picker and is not the main teacher', async () => {
  const room = await findRoom('101');
  const now = await project();
  const second = now.teachers.find((teacher) => !room.teacherIds.includes(teacher.id));
  const before = await entries();
  await page.click('#room-teacher-add');
  await page.keyboard.type(second.name.slice(0, 6));
  await page.waitForSelector('#inspector .picker__option');
  assert.equal(await text('#inspector .picker__option span'), second.name);
  await page.keyboard.press('Enter');
  const after = await roomById(room.id);
  assert.deepEqual(after.teacherIds, [room.teacherIds[0], second.id]);
  assert.equal((await project()).teachers.find((teacher) => teacher.id === second.id).roomIds.includes(room.id), true, 'the teacher\'s own list does not have the room');
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).focus, 'room-teacher-add', 'the picker lost the focus');
  assert.equal(await value('#room-teacher-add'), '');
  assert.equal(await page.$$eval('#room-teachers li', (all) => all.length), 2);
});

test('a name that is new is offered as "Add … as a new teacher", and that makes the teacher and bases them here in one step', async () => {
  const room = await findRoom('101');
  const had = (await project()).teachers.length;
  const before = await entries();
  await page.click('#room-teacher-add');
  await page.keyboard.type('Mx. <Okonkwo-Reyes>');
  await page.waitForSelector('#inspector .picker__option');
  const options = await page.$$eval('#inspector .picker__option', (all) => all.map((each) => each.firstChild.textContent));
  assert.deepEqual(options, ['Add \'Mx. <Okonkwo-Reyes>\' as a new teacher']);
  await page.keyboard.press('Enter');
  const now = await project();
  assert.equal(now.teachers.length, had + 1);
  const made = now.teachers[now.teachers.length - 1];
  assert.equal(made.name, 'Mx. <Okonkwo-Reyes>');
  assert.deepEqual(made.roomIds, [room.id]);
  assert.equal((await roomById(room.id)).teacherIds[2], made.id);
  assert.equal(await entries(), before + 1, 'adding a teacher from the room took more than one undo step');
  assert.equal((await state(page)).label, 'Add teacher Mx. <Okonkwo-Reyes>');
  assert.equal(await page.$eval('#room-teachers li:last-child .bi-person__name', (el) => el.textContent), 'Mx. <Okonkwo-Reyes>');
  assert.equal(await page.$('#room-teachers okonkwo-reyes'), null, 'a typed name was read as markup');
  // a name the school already has is not offered as new
  await page.keyboard.type('mx. <okonkwo-reyes>');
  await page.waitForSelector('#inspector .picker__empty');
  assert.equal(await page.$('#inspector .picker__option'), null);
  await retype('#room-teacher-add', '', 'Escape');
});

test('another teacher is made the main one, and a teacher is taken out of the room', async () => {
  const room = await findRoom('101');
  const ids = (await roomById(room.id)).teacherIds;
  const before = await entries();
  await page.click('#room-teachers li:nth-child(2) [data-action="main"]');
  assert.deepEqual((await roomById(room.id)).teacherIds, [ids[1], ids[0], ids[2]]);
  assert.equal(await page.$eval('#room-teachers li:first-child', (li) => li.dataset.teacher), ids[1]);
  await page.click('#room-teachers li:last-child [data-action="remove-teacher"]');
  assert.deepEqual((await roomById(room.id)).teacherIds, [ids[1], ids[0]]);
  assert.equal((await project()).teachers.find((teacher) => teacher.id === ids[2]).roomIds.length, 0);
  assert.equal(await entries(), before + 2);
});

test('clearing a room\'s details keeps the room, its cells and its doors', async () => {
  const room = await findRoom('101');
  const before = await entries();
  await page.click('#room-clear');
  const after = await roomById(room.id);
  assert.deepEqual([after.number, after.teacherIds, after.subjectId, after.wing, after.capacity, after.shared], ['', [], null, '', null, false]);
  assert.deepEqual(after.cells, room.cells);
  assert.deepEqual(after.doors, room.doors);
  assert.equal(await entries(), before + 1);
  assert.equal(await text('#inspector-title'), 'A room with no number');
  assert.equal(await page.$eval('#room-no-teachers', (el) => el.hidden), false);
  await page.click('#undo');
  assert.equal((await roomById(room.id)).number, '101');
  assert.equal(await text('#inspector-title'), 'Room 101');
  await clearToast(page);
});

test('an other space has a label, a kind and a colour', async () => {
  const now = await project();
  const space = now.building.floors[0].spaces.find((each) => each.kind === 'other');
  await selectSpace(space.id);
  assert.equal(await value('#space-label'), space.label);
  assert.equal(await value('#space-kind'), space.otherKind);
  assert.equal(await value('#space-colour'), space.colour);
  const before = await entries();
  await retype('#space-label', 'Nurse & <first aid>', 'Enter');
  const kind = space.otherKind === 'office' ? 'storage' : 'office';
  await page.select('#space-kind', kind);
  await page.$eval('#space-colour', (el) => {
    el.value = '#336699';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const after = await roomById(space.id);
  assert.deepEqual([after.label, after.otherKind, after.colour], ['Nurse & <first aid>', kind, '#336699']);
  assert.equal(await entries(), before + 3);
  assert.equal(await text('#inspector-title'), 'Nurse & <first aid>');
});

// ---------------------------------------------------------------- the room list

test('the Rooms tab lists the rooms of the floor on screen, sorted by number, and carries the two print buttons', async () => {
  await tab('rooms');
  const now = await project();
  const rooms = now.building.floors[0].spaces.filter((space) => space.kind === 'room');
  assert.equal(await page.$$eval('#rooms-table tbody tr', (all) => all.length), rooms.length);
  assert.match(await text('#rooms-lead'), new RegExp('^Floor 1 has ' + rooms.length + ' rooms\\. Press a heading to sort by it\\.$'));
  const numbers = () => page.$$eval('#rooms-table tbody tr input[name="number"]', (all) => all.map((input) => input.value));
  const sorted = rooms.map((each) => each.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  assert.deepEqual(await numbers(), sorted);
  assert.equal(await page.$eval('#rooms-table th[aria-sort]', (th) => th.textContent.trim() + ':' + th.getAttribute('aria-sort')), 'Room:ascending');
  await page.click('#rooms-table th:first-child .table__sort');
  assert.deepEqual(await numbers(), sorted.slice().reverse());
  await page.click('#rooms-table th:first-child .table__sort');
  assert.deepEqual(await page.$$eval('#rooms-print button', (all) => all.map((button) => button.id + ':' + button.textContent)), ['print-floor-plan:Print the floor plan', 'print-room-list:Print the room list']);
});

test('a room is edited in place in the list: the same actions, the same refusals, and its row stays where it is', async () => {
  const room = await findRoom('102');
  const row = '#rooms-table tr[data-key="' + room.id + '"] ';
  const before = await entries();
  const order = await page.$$eval('#rooms-table tbody tr', (all) => all.map((tr) => tr.dataset.key));
  await retype(row + 'input[name="number"]', '199', 'Enter');
  assert.equal((await roomById(room.id)).number, '199');
  assert.equal(await entries(), before + 1);
  assert.deepEqual(await page.$$eval('#rooms-table tbody tr', (all) => all.map((tr) => tr.dataset.key)), order, 'the rows moved under the typing');
  assert.equal(await page.evaluate(() => document.activeElement.name), 'number', 'the field lost the focus when its number was kept');
  // the room whose row has the focus is the one selected on the plan
  assert.deepEqual((await state(page)).selection, [room.id]);
  // a number another room has: refused under the field
  await retype(row + 'input[name="number"]', '101', 'Enter');
  assert.match(await page.$eval(row + '.field__refusal', (el) => el.textContent), /101/);
  assert.equal((await roomById(room.id)).number, '199');
  await page.keyboard.press('Escape');
  assert.equal(await value(row + 'input[name="number"]'), '199');

  const now = await project();
  const teacher = now.teachers.find((each) => !room.teacherIds.includes(each.id));
  await page.select(row + 'select[name="teacher"]', teacher.id);
  assert.equal((await roomById(room.id)).teacherIds[0], teacher.id, 'the teacher chosen is not the main teacher');
  assert.deepEqual((await roomById(room.id)).teacherIds.slice(1), room.teacherIds.slice(1), 'the other teachers of the room were dropped');
  await page.select(row + 'select[name="subject"]', '');
  assert.equal((await roomById(room.id)).subjectId, null);
  await retype(row + 'input[name="capacity"]', '31', 'Enter');
  assert.equal((await roomById(room.id)).capacity, 31);
  assert.equal(await entries(), before + 4);
  await retype(row + 'input[name="number"]', '102', 'Enter');
});

test('the list sorts by any column, and the room list prints in the order on screen', async () => {
  await page.click('#rooms-table th:nth-child(4) .table__sort');
  const seats = await page.$$eval('#rooms-table tbody tr input[name="capacity"]', (all) => all.map((input) => (input.value === '' ? -1 : Number(input.value))));
  assert.deepEqual(seats, seats.slice().sort((a, b) => a - b));
  await page.click('#rooms-table th:nth-child(4) .table__sort');
  const down = await page.$$eval('#rooms-table tbody tr input[name="number"]', (all) => all.map((input) => input.value));
  await page.click('#print-room-list');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const printed = await page.evaluate(() => Array.from(document.querySelector('#print-preview iframe').contentDocument.querySelectorAll('.doc-table--rooms tbody th'), (th) => th.textContent));
  assert.deepEqual(printed, down);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#print-preview[open]') === null);
  assert.equal((await state(page)).focus, 'print-room-list', 'the focus did not go back to the button');
  await page.click('#rooms-table th:first-child .table__sort');
});

test('a floor with no rooms says what to do, and the list follows the floor on screen', async () => {
  await page.click('#add-floor');
  await floorIs(page, 'Floor 4');
  assert.equal(await text('#rooms-title'), 'The rooms of Floor 4');
  assert.equal(await text('#rooms-lead'), 'There are no rooms on Floor 4 yet. Choose the Room tool (R) and drag on the plan.');
  assert.equal(await page.$('#rooms-table table'), null);
});

// ---------------------------------------------------------------- the floor

test('the Floor tab renames the floor, and the tab in the top bar follows', async () => {
  await tab('floor');
  assert.equal(await text('#floor-about'), 'Floor 4 is 40 × 14 squares. It is floor 4 of 4 in the tabs.');
  const before = await entries();
  await retype('#floor-name', 'Roof <deck>', 'Enter');
  assert.equal((await project()).building.floors[3].name, 'Roof <deck>');
  assert.equal(await entries(), before + 1);
  assert.equal(await text('#floor-title'), 'Roof <deck>');
  assert.equal(await text('.bld-floors__tab[aria-selected="true"] .bld-floors__name'), 'Roof <deck>');
  assert.equal(await text('#floor-delete'), 'Delete Roof <deck>');
});

test('a floor is moved among the tabs, and the first and last cannot go further', async () => {
  assert.equal(await page.$eval('#floor-later', (el) => el.disabled), true);
  const before = await entries();
  await page.click('#floor-earlier');
  const names = (await project()).building.floors.map((floor) => floor.name);
  assert.deepEqual(names, ['Floor 1', 'Floor 2', 'Roof <deck>', 'Floor 3']);
  assert.equal(await entries(), before + 1);
  assert.equal(await text('#floor-about'), 'Roof <deck> is 40 × 14 squares. It is floor 3 of 4 in the tabs.');
  assert.equal(await page.$eval('#floor-later', (el) => el.disabled), false);
});

test('a size preset fills the two fields and says what the floor would be; nothing changes until Resize', async () => {
  const before = await entries();
  assert.equal(await text('#floor-size-preview'), 'That is the size Roof <deck> is now.');
  assert.equal(await page.$eval('#floor-resize', (el) => el.getAttribute('aria-disabled')), 'true');
  assert.deepEqual(await page.$$eval('#inspector-floor [data-preset]', (all) => all.map((button) => button.textContent)), ['Small 30 × 20', 'Medium 40 × 30', 'Large 60 × 40']);
  await page.click('#inspector-floor [data-preset="large"]');
  assert.deepEqual([await value('#floor-width'), await value('#floor-height')], ['60', '40']);
  assert.equal(await text('#floor-size-preview'), 'Roof <deck> would be 60 × 40 squares. Nothing drawn would be cut off.');
  assert.equal(await text('#floor-resize'), 'Resize to 60 × 40');
  assert.equal(await entries(), before);
  await page.click('#floor-resize');
  const floor = (await project()).building.floors[2];
  assert.deepEqual([floor.width, floor.height], [60, 40]);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Resize Roof <deck> to 60 by 40');
  assert.equal(await text('#floor-about'), 'Roof <deck> is 60 × 40 squares. It is floor 3 of 4 in the tabs.');
});

test('a size out of range, or one that is not a number, is refused in the preview and Resize does nothing', async () => {
  const before = await entries();
  await retype('#floor-width', '4');
  assert.equal(await text('#floor-size-preview'), 'A floor is from 5 to 200 cells each way, and that would make Roof <deck> 4 by 40. Pick a size in that range.');
  assert.equal(await page.$eval('#floor-resize', (el) => el.getAttribute('aria-disabled')), 'true');
  await page.click('#floor-resize');
  await retype('#floor-width', 'wide');
  assert.equal(await text('#floor-size-preview'), 'A size is two whole numbers of squares, each from 5 to 200.');
  await page.keyboard.press('Enter');
  assert.equal(await entries(), before);
  assert.equal((await project()).building.floors[2].width, 60);
});

test('a size that would cut off drawn cells says what would be lost, asks, and cancelling changes nothing', async () => {
  await page.click('.bld-floors__tab');
  await floorIs(page, 'Floor 1');
  const start = (await project()).building.floors[0];
  const before = await entries();
  await retype('#floor-width', '20');
  const preview = await text('#floor-size-preview');
  assert.match(preview, /^Floor 1 would be 20 × 14 squares\. That would cut off /);
  assert.match(preview, /Gym/);
  assert.match(preview, /corridor cells/);
  assert.match(preview, /scheduled into what would go/);
  assert.equal(await page.$eval('#floor-size-preview', (el) => el.dataset.loss), 'true');
  await page.click('#floor-resize');
  await page.waitForSelector('#resize-dialog[open]');
  assert.equal(await text('#resize-dialog .dialog__title'), 'Resize Floor 1 to 20 × 14 and remove what is cut off?');
  assert.deepEqual(await page.$$eval('#resize-dialog .dialog__buttons button', (all) => all.map((button) => button.textContent)), ['Resize and remove what is cut off', 'Keep Floor 1 at 40 × 14']);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  assert.equal(await entries(), before);
  assert.deepEqual((await project()).building.floors[0], start);
});

test('the same resize, agreed to, cuts the floor from the chosen edge in one undo step, and undo puts everything back', async () => {
  const start = (await project()).building.floors[0];
  const before = await entries();
  // cut at the left instead: the rooms on the right stay
  await page.click('input[name="floor-side-x"][value="left"]');
  assert.match(await text('#floor-size-preview'), /That would cut off 3 rooms, 2 other spaces, 5 cells of Cafeteria/);
  await page.click('#floor-resize');
  await page.waitForSelector('#resize-dialog[open]');
  await page.click('#resize-dialog .btn--danger');
  await page.waitForFunction(() => document.querySelector('dialog.dialog[open]') === null);
  const after = (await project()).building.floors[0];
  assert.equal(after.width, 20);
  assert.equal(after.spaces.some((space) => space.number === '101'), false);
  assert.equal(after.spaces.some((space) => space.number === 'Gym'), true);
  assert.equal(await entries(), before + 1);
  assert.match((await state(page)).said, /^Resized Floor 1 to 20 by 14, which removed /);
  assert.deepEqual([await value('#floor-width'), await value('#floor-height')], ['20', '14']);
  await page.click('#undo');
  assert.deepEqual((await project()).building.floors[0], start);
  assert.equal(await value('#floor-width'), '40');
  await clearToast(page);
});

// ---------------------------------------------------------------- tracing

async function storedImage(imageId) {
  return page.evaluate(async (id) => {
    const held = await globalThis.sv2.storage.getImage(id);
    if (!held) return null;
    const bitmap = await createImageBitmap(held.blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    g.drawImage(bitmap, 0, 0);
    const at = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    // in the fixture, scaled by 0.8: (40, 40) is clear, (88, 400) is a wall, (240, 300) the tinted room
    return { type: held.blob.type, bytes: held.blob.size, width: held.width, height: held.height, decoded: [bitmap.width, bitmap.height], clear: at(40, 40), wall: at(88, 400), tinted: at(240, 300) };
  }, imageId);
}

async function upload() {
  const input = await page.$('#trace-file');
  if (typeof input.uploadFile === 'function') await input.uploadFile(FIXTURE);
  else await input.setInputFiles(FIXTURE);
}

test('an image chosen for a floor is reduced on import, given a light backing, stored once and fitted to the floor', async () => {
  await wholeFloor(page);
  assert.equal(await text('#trace-heading'), 'Trace over a floor plan');
  assert.equal(await page.$('#trace-opacity'), null);
  const empty = await pixel(page, 2, 12, 0.5, 0.5);
  const before = await entries();
  await upload();
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].image !== null);
  const image = (await project()).building.floors[0].image;
  // the fixture is 2000 by 1500 pixels
  assert.deepEqual([image.width, image.height], [1600, 1200], 'the image was not reduced to 1600 on its longer side');
  assert.match(image.imageId, /^i[a-z0-9]{9}$/);
  assert.deepEqual([image.opacity, image.rotation, image.visible, image.locked, image.missing], [0.4, 0, true, false, false]);
  // 40 by 14 squares: the height decides, and the image sits in the middle
  assert.ok(Math.abs(image.scale - 14 / 1200) < 1e-9);
  assert.ok(Math.abs(image.y) < 1e-9 && Math.abs(image.x - (40 - 1600 * image.scale) / 2) < 1e-9);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Trace over an image on Floor 1');
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text').textContent), 'The image lies under Floor 1, reduced from 2000 × 1500 to 1600 × 1200 pixels. Draw over it.');

  const stored = await storedImage(image.imageId);
  assert.equal(stored.type, 'image/jpeg');
  assert.deepEqual([stored.width, stored.height], [1600, 1200]);
  assert.deepEqual(stored.decoded, [1600, 1200]);
  assert.ok(stored.clear.slice(0, 3).every((channel) => channel >= 250), 'the clear part of the image has no light backing: ' + stored.clear);
  assert.ok(stored.wall.slice(0, 3).every((channel) => channel <= 90), 'the wall is not dark: ' + stored.wall);
  assert.ok(stored.tinted[2] > stored.tinted[0], 'the tinted room lost its colour: ' + stored.tinted);
  assert.deepEqual(await page.evaluate(() => import('./engine/validate.js').then((module) => module.validate(globalThis.sv2.store.project))), []);

  // on the plan: the wall of the image shows through an empty cell
  assert.equal(await text('#trace-facts'), 'The image is 1600 × 1200 pixels, drawn 18.7 × 14 squares.');
  await page.waitForFunction(() => {
    const editor = document.querySelector('.bld').editor;
    editor.drawNow();
    return true;
  });
  // the image's left wall: 100 px of 2000 in from its left edge
  const wallX = image.x + 105 * 0.8 * image.scale;
  const shown = await pixel(page, Math.floor(wallX), 12, wallX - Math.floor(wallX), 0.5);
  assert.notEqual(shown, empty, 'the image is not drawn under the plan');
  await clearToast(page);
});

test('opacity, width, turn and place are each kept as one step, and a width of nothing is refused', async () => {
  const before = await entries();
  await page.$eval('#trace-opacity', (el) => {
    el.value = '70';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal((await project()).building.floors[0].image.opacity, 0.7);
  assert.equal(await text('#trace-opacity-value'), '70%');
  await retype('#trace-width', '24', 'Enter');
  let image = (await project()).building.floors[0].image;
  assert.ok(Math.abs(image.scale * image.width - 24) < 1e-9);
  await retype('#trace-rotation', '90', 'Enter');
  await retype('#trace-x', '3.5', 'Enter');
  await retype('#trace-y', '-2', 'Enter');
  image = (await project()).building.floors[0].image;
  assert.deepEqual([image.rotation, image.x, image.y], [90, 3.5, -2]);
  assert.equal(await entries(), before + 5);
  assert.equal((await state(page)).label, 'Adjust the traced image on Floor 1');
  await retype('#trace-width', '0', 'Enter');
  assert.equal(await page.$eval('#trace-width', (el) => el.closest('.field').querySelector('.field__refusal').textContent), 'The image needs a width above 0 squares.');
  await page.keyboard.press('Escape');
  assert.equal(await entries(), before + 5);
  await page.click('#trace-fit');
  image = (await project()).building.floors[0].image;
  assert.deepEqual([image.rotation, image.y], [0, 0]);
});

test('the image is moved by dragging it on the plan, as one undo step, and the tool in hand does not draw', async () => {
  const start = (await project()).building.floors[0];
  const before = await entries();
  await page.keyboard.press('c');
  await page.click('#trace-move');
  assert.equal(await page.$eval('#trace-move', (el) => el.getAttribute('aria-pressed') + ':' + el.textContent), 'true:Done moving');
  assert.match((await state(page)).hint, /^Drag the image to where it belongs\./);
  await drag(page, [20, 3], [23, 5]);
  const after = (await project()).building.floors[0];
  assert.ok(Math.abs(after.image.x - (start.image.x + 3)) < 0.05 && Math.abs(after.image.y - (start.image.y + 2)) < 0.05, 'the image did not move with the drag: ' + [after.image.x, after.image.y]);
  assert.equal(after.cells, start.cells, 'the Corridor tool painted while the image was being moved');
  assert.equal(await entries(), before + 1);
  await page.focus('#plan');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#trace-move', (el) => el.getAttribute('aria-pressed') + ':' + el.textContent), 'false:Move it by dragging');
  assert.match((await state(page)).hint, /^Corridor:/);
  await page.keyboard.press('v');
});

test('a locked image cannot be moved or resized, and a hidden one is not drawn', async () => {
  await page.click('#trace-locked');
  assert.equal((await project()).building.floors[0].image.locked, true);
  assert.deepEqual(await page.$$eval('#trace-width, #trace-rotation, #trace-x, #trace-y, #trace-move, #trace-fit', (all) => all.map((el) => el.disabled)), [true, true, true, true, true, true]);
  assert.equal(await page.$eval('#trace-opacity', (el) => el.disabled), false, 'opacity is not a place: a locked image can still be faded');
  await page.click('#trace-locked');
  assert.equal(await page.$eval('#trace-move', (el) => el.disabled), false);

  const image = (await project()).building.floors[0].image;
  const wallX = image.x + 105 * 0.8 * image.scale;
  const at = [Math.floor(wallX), 12, wallX - Math.floor(wallX), 0.5];
  const shown = await pixel(page, ...at);
  await page.click('#trace-visible');
  assert.equal((await project()).building.floors[0].image.visible, false);
  const hidden = await pixel(page, ...at);
  assert.notEqual(hidden, shown, 'hiding the image changed nothing on the plan');
  await page.click('#trace-visible');
  assert.equal(await pixel(page, ...at), shown);
});

test('an image that is not on this device says so, keeps its place, and comes back when the file is chosen again', async () => {
  const before = (await project()).building.floors[0].image;
  await page.evaluate(async () => {
    const { setTraceImage } = await import('./ui/building/trace.js');
    const { store } = globalThis.sv2;
    store.apply(setTraceImage, { floorId: store.project.building.floors[0].id, image: { missing: true } });
  });
  assert.equal(await page.$eval('#trace-missing', (el) => el.hidden), false);
  assert.equal(await text('#trace-missing p'), 'The image for this floor is not on this device. Where it goes is kept. Choose the file again to see it.');
  assert.equal(await value('#trace-x'), String(Math.round(before.x * 100) / 100), 'the place was not kept');
  await upload();
  await page.waitForFunction(() => globalThis.sv2.store.project.building.floors[0].image.missing === false);
  const after = (await project()).building.floors[0].image;
  assert.equal(after.imageId, before.imageId, 'the same file again made another image');
  assert.deepEqual([after.x, after.y, after.rotation], [before.x, before.y, before.rotation]);
  assert.ok(Math.abs(after.scale * after.width - before.scale * before.width) < 1e-9, 'the image is not as wide as it was');
  assert.equal(await page.$eval('#trace-missing', (el) => el.hidden), true);
  await clearToast(page);
});

test('the image belongs to its floor: another floor has none, and removing it is one step that undo takes back', async () => {
  await page.click('.bld-floors__tab[aria-selected="false"]');
  await floorIs(page, 'Floor 2');
  assert.equal(await page.$('#trace-opacity'), null);
  assert.notEqual(await page.$('#trace-choose'), null);
  await page.click('.bld-floors__tab');
  await floorIs(page, 'Floor 1');
  const before = await entries();
  const had = (await project()).building.floors[0].image;
  await page.click('#trace-remove');
  assert.equal((await project()).building.floors[0].image, null);
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Remove the traced image from Floor 1');
  assert.notEqual(await page.$('#trace-choose'), null);
  await page.click('#undo');
  assert.deepEqual((await project()).building.floors[0].image, had);
  assert.notEqual(await page.$('#trace-opacity'), null);
  await clearToast(page);
});

test('a file that is not an image is refused in a sentence and nothing changes', async () => {
  const before = await entries();
  await page.evaluate(async () => {
    const editor = document.querySelector('.bld').editor;
    await editor.trace.importFile(new File(['not a picture'], 'notes.png', { type: 'image/png' }));
  });
  assert.equal(await page.evaluate(() => document.querySelector('.toast .toast__text').textContent), 'That file could not be read as an image. Choose a photo or a scan of the plan: a PNG or a JPEG.');
  assert.equal(await entries(), before);
  await clearToast(page);
});

// ---------------------------------------------------------------- checks

test('the Checks tab lists what the building checks found, worst first, in sentences', async () => {
  // something wrong on Floor 2: a room with no number that touches no corridor, and stairs joined to nothing
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    const floorId = store.project.building.floors[1].id;
    store.apply(actions.placeRoom, { floorId, rect: { x: 30, y: 11, w: 2, h: 2 } });
    store.apply(actions.placeStairs, { floorId, cells: [13 * 40 + 36] });
  });
  await tab('checks');
  const found = await page.evaluate(async () => (await import('./engine/building-checks.js')).buildingChecks(globalThis.sv2.store.project));
  const rows = await page.$$eval('#building-findings li', (all) => all.map((li) => ({ id: li.dataset.finding, kind: li.dataset.kind, text: li.querySelector('.bi-finding__text').textContent, severity: li.className.replace(/.*bi-finding--/, '') })));
  assert.equal(rows.length, found.length);
  assert.deepEqual(rows.map((row) => row.id).sort(), found.map((finding) => finding.id).sort());
  const order = { problem: 0, warning: 1, note: 2 };
  assert.deepEqual(rows.map((row) => order[row.severity]), rows.map((row) => order[row.severity]).slice().sort(), 'the findings are not worst first');
  const kinds = rows.map((row) => row.kind);
  for (const kind of ['room-no-number', 'room-no-corridor', 'stairs-unconnected']) assert.ok(kinds.includes(kind), 'no ' + kind + ' finding');
  const unnumbered = rows.find((row) => row.kind === 'room-no-number');
  assert.equal(unnumbered.text, 'Warning: A room on Floor 2 has no number. Give it one so that groups can be scheduled into it.');
  const problems = found.filter((finding) => finding.severity === 'problem').length;
  const warnings = found.filter((finding) => finding.severity === 'warning').length;
  assert.equal(await text('#checks-lead'), 'The building checks found ' + problems + (problems === 1 ? ' problem' : ' problems') + ' and ' + warnings + (warnings === 1 ? ' warning' : ' warnings') + '.');
});

test('"Show me" goes to the floor the finding is on, brings the place to the middle and marks it', async () => {
  assert.equal((await state(page)).floor, 'Floor 1');
  const row = '#building-findings li[data-kind="stairs-unconnected"] ';
  await page.click(row + '[data-action="show"]');
  await floorIs(page, 'Floor 2');
  const seen = await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    const middle = editor.view.toCell(editor.view.width / 2, editor.view.height / 2);
    return { marked: editor.finder.marked, middle: [middle.x, middle.y], hash: location.hash, floorId: editor.floor.id };
  });
  assert.deepEqual(seen.marked.cells, [13 * 40 + 36]);
  assert.equal(seen.marked.floorId, seen.floorId);
  assert.ok(Math.abs(seen.middle[0] - 36.5) < 0.01 && Math.abs(seen.middle[1] - 13.5) < 0.01, 'the stairs are not in the middle of the window: ' + seen.middle);
  assert.equal(seen.hash, '#building/' + seen.floorId);
  assert.match((await state(page)).said, /^On Floor 2: The stairs on Floor 2 at column 37, row 14 are not connected/);
  // the mark is drawn: the accent, just inside the cell's edge
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.equal(await pixel(page, 36, 13, 0.02, 0.5), accent);
  assert.equal(await page.$eval('.bld-floors__tab[aria-selected="true"] .bld-floors__name', (el) => el.textContent), 'Floor 2');
});

test('"Show me" for a room selects it; the mark goes on Escape and on the next click on the plan', async () => {
  await page.click('#building-findings li[data-kind="room-no-number"] [data-action="show"]');
  const seen = await page.evaluate(() => {
    const editor = document.querySelector('.bld').editor;
    return { marked: editor.finder.marked.cells.length, selection: editor.selection.length, room: editor.floor.spaces.find((space) => space.id === editor.selection[0]).number };
  });
  assert.deepEqual(seen, { marked: 4, selection: 1, room: '' });
  await page.focus('#plan');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.querySelector('.bld').editor.finder.marked), null);
  assert.equal((await state(page)).selection.length, 1, 'the first Escape took the selection as well as the mark');
});

test('a finding goes from the list when what it is about is put right', async () => {
  const had = await page.$$eval('#building-findings li', (all) => all.length);
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    const room = store.project.building.floors[1].spaces.find((space) => space.kind === 'room' && space.number === '');
    store.apply(actions.setRoomFields, { roomId: room.id, number: '250' });
  });
  assert.equal(await page.$$eval('#building-findings li', (all) => all.length), had - 1);
  assert.equal(await page.$('#building-findings li[data-kind="room-no-number"]'), null);
});

// ---------------------------------------------------------------- exits

test('the Exits tab lists every exit of the building with its door name and assembly point, kept as typed', async () => {
  await tab('exits');
  const now = await project();
  const all = now.building.floors.flatMap((floor) => floor.exits.map((exit) => ({ floor: floor.name, ...exit })));
  assert.equal(await text('#exits-lead'), 'The building has ' + all.length + ' exits.');
  assert.deepEqual(await page.$$eval('#exits-list li', (rows) => rows.map((row) => row.dataset.exit)), all.map((exit) => exit.id));
  assert.equal(await value('#exits-list li input'), all[0].doorName);
  const before = await entries();
  await retype('#exits-list li:first-child input[data-key^="assembly"]', 'Car park, by the "big" oak <tree>', 'Enter');
  assert.equal((await project()).building.floors[0].exits[0].assembly, 'Car park, by the "big" oak <tree>');
  assert.equal(await entries(), before + 1);
  assert.equal((await state(page)).label, 'Edit the exit ' + all[0].doorName);
});

test('an exit is shown on its floor and taken off from the tab', async () => {
  const before = await entries();
  await page.click('#exits-list li:first-child [data-action="show"]');
  await floorIs(page, 'Floor 1');
  const exit = (await project()).building.floors[0].exits[0];
  assert.deepEqual(await page.evaluate(() => document.querySelector('.bld').editor.finder.marked.cells), [exit.cell]);
  await page.click('#exits-list li:first-child [data-action="remove-exit"]');
  assert.equal((await project()).building.floors[0].exits.length, 1);
  assert.equal(await entries(), before + 1);
  assert.equal(await text('#exits-lead'), 'The building has 1 exit.');
  assert.equal(await page.$$eval('#exits-list li', (rows) => rows.length), 1);
  await clearToast(page);
});

test('after all of that the page has logged no error', () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
});
