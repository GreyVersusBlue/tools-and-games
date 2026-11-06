// Safety's step-free ways out in a real browser (spec 10.1, 10.2, 11; DESIGN 13.6; SV2-104):
// node test/browser/step-free-safety.mjs
//
// The Everyone / Step-free radio group with its live words and the "never uses elevators"
// line; the Step-free view's map (labelled ends), its rooms listed by how they leave with their
// reasons and Show, the areas of refuge with "Used by"; the Step-free tab with the report, the
// "nothing marked yet" opening, the two-views line and Print as a sheet; door cards' Step-free
// ways out option and the second block. By pointer, by keyboard alone, and at 390 px with touch.
//
// Every wait is on a state the page sets: the section's picture worked out for the very project
// in the store and the map painted since a count (ready), the plan's box at rest (atRest), the
// preview's data-ready. None waits on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, atRest } from './harness.mjs';

let wide;

before(async () => {
  wide = await openPlanner({ width: 1280, height: 800, hash: '#safety', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
});

// The section drawn for the project in the store: styled, its picture worked out for this very
// project, and the map painted at least once since `since` (a count of paints).
async function ready(page, since) {
  await page.waitForFunction((was) => {
    const el = document.querySelector('.sfy');
    if (!el || el.dataset.styled !== 'true' || !el.safety || !el.safety.picture) return false;
    if (el.safety.plan.project !== globalThis.sv2.store.project) return false;
    const canvas = document.getElementById('safety-plan');
    return canvas.getClientRects().length > 0 && el.safety.plan.view.width > 0 && Number(canvas.dataset.drawn || 0) > was;
  }, { timeout: 20000 }, since === undefined ? 0 : since);
}

const drawn = (page) => page.$eval('#safety-plan', (el) => Number(el.dataset.drawn || 0));

// A building to look at. 'plain' is the sample school as it loads: no elevator, no step, no
// refuge. 'marked' has an area of refuge by Stairs A on Floor 2 (Floor 3 has none), a second
// area of refuge on Floor 1 that no room uses, and Door B with a step. 'groups' is 'marked' with
// two groups that need step-free routes. `refugeName` renames the first refuge.
async function load(page, variant, refugeName) {
  if (await page.$('#print-preview[open]')) await page.keyboard.press('Escape');
  await page.evaluate(async (which, name) => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    if (which !== 'plain') {
      const [one, two] = project.building.floors;
      const joined = project.building.connections.find((connection) => connection.label === 'A');
      const stairs = (joined.a.floorId === two.id ? joined.a : joined.b).cell;
      const beside = [stairs - two.width, stairs + 1, stairs - 1, stairs + two.width].find((cell) => two.cells[cell] === '#');
      two.refuges = [{ id: 'arefuge0001', cell: beside, name: name || 'Area of refuge' }];
      const low = one.cells.split('').findIndex((character, cell) => character === '#' && Math.floor(cell / one.width) >= 10);
      one.refuges = [{ id: 'arefuge0002', cell: low, name: 'Area of refuge 2' }];
      one.exits.find((exit) => exit.doorName === 'Door B').stepFree = false;
    }
    if (which === 'groups') {
      for (const group of project.groups.slice(0, 2)) group.stepFree = true;
    }
    globalThis.sv2.store.replace(project);
  }, variant, refugeName || null);
  await go(page, '#safety');
  await ready(page);
  await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    view.pick(null);
    view.setView('everyone');
    const exits = document.querySelector('.sfy-inspector .tabs__tab[data-tab="exits"]');
    if (exits.getAttribute('aria-selected') !== 'true') exits.click();
  });
  await ready(page);
}

const say = (page) => page.$eval('#announcer', (el) => el.textContent);
const line = (page) => page.$eval('#safety-line .mov-line__words', (el) => el.textContent);
const tab = (page, id) => page.click('.sfy-inspector .tabs__tab[data-tab="' + id + '"]');

async function previewRead(page) {
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 20000 });
  return page.evaluate(() => {
    const sheet = document.getElementById('print-preview');
    const doc = sheet.querySelector('iframe').contentDocument;
    return {
      output: doc.documentElement.dataset.output,
      cards: Array.from(doc.querySelectorAll('.card[data-card]')).map((card) => ({ room: card.dataset.card, block: card.dataset.stepfree || null })),
      blocks: Array.from(doc.querySelectorAll('.card__stepfree')).map((block) => ({ kind: block.dataset.stepfree, head: block.querySelector('.card__label').textContent, steps: Array.from(block.querySelectorAll('.card__words')).map((el) => el.textContent) })),
      rows: Array.from(doc.querySelectorAll('tr[data-room]')).map((row) => ({ room: row.dataset.room, reason: row.dataset.reason, text: row.textContent })),
      lines: Array.from(doc.querySelectorAll('[data-line]')).map((el) => el.dataset.line),
      text: doc.body.textContent,
    };
  });
}

async function closePreview(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#print-preview[open]'));
}

const COUNTS = '5 to an exit, 5 to an area of refuge, 3 with no way out';

// ---- the switch

test('the Everyone / Step-free radio group: labelled, one choice, the "never uses elevators" line under it, and the arrows move it with the focus staying on it and the live words said', async () => {
  const page = wide.page;
  await load(page, 'marked');
  const group = await page.$eval('.sfy-view [role="radiogroup"]', (el) => ({ label: document.getElementById(el.getAttribute('aria-labelledby')).textContent, options: Array.from(el.querySelectorAll('input')).map((input) => [input.value, input.checked, input.nextElementSibling.textContent]) }));
  assert.equal(group.label, 'Ways out for');
  assert.deepEqual(group.options, [['everyone', true, 'Everyone'], ['step-free', false, 'Step-free']]);
  assert.equal(await page.$eval('.sfy-view__line', (el) => el.textContent), 'An evacuation never uses elevators.');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.view), 'everyone');
  // by keyboard: the focus is on the group, an arrow chooses the other chip and the focus stays
  await page.focus('.sfy-view .seg__input[value="everyone"]');
  const before = await drawn(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.view === 'step-free');
  await ready(page, before);
  const held = await page.evaluate(() => ({ inside: Boolean(document.activeElement.closest('.sfy-view .seg')), value: document.activeElement.value }));
  assert.deepEqual(held, { inside: true, value: 'step-free' });
  assert.equal(await say(page), 'Step-free: ' + COUNTS);
  assert.equal(await line(page), 'Step-free ways out: ' + COUNTS + '.');
  // the group is one Tab stop: Tab leaves it for the next control, not the other chip
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.sfy-view .seg'))), false, 'Tab stayed in the radio group');
  await page.focus('.sfy-view .seg__input[value="step-free"]');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.view === 'everyone');
  assert.match(await say(page), /^Everyone: Every room’s way out, coloured by the exit it uses: 13 rooms to 2 exits\./);
  assert.equal(await page.evaluate(() => document.activeElement.value), 'everyone');
});

test('by pointer: the chip is pressed, the map is painted again, and the choice is let go when another project is loaded', async () => {
  const page = wide.page;
  await load(page, 'marked');
  const before = await drawn(page);
  await page.click('.sfy-view .seg__option:last-child');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.view === 'step-free');
  await ready(page, before);
  assert.equal(await page.$eval('.sfy-view .seg__input[value="step-free"]', (el) => el.checked), true);
  await load(page, 'plain');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.view), 'everyone', 'another project opens on Everyone');
  assert.equal(await page.$eval('.sfy-view .seg__input[value="everyone"]', (el) => el.checked), true);
});

// ---- the Step-free view

test('the Step-free view lists the rooms by how they leave with reasons and Show, and the areas of refuge with "Used by" or "Not used"', async () => {
  const page = wide.page;
  await load(page, 'marked');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await page.waitForSelector('.sfy-panel[data-panel="ways"]');
  const headings = await page.$$eval('.sfy-ways .mov-panel__sub', (els) => els.map((el) => el.textContent));
  assert.deepEqual(headings, ['To an exit (5)', 'To an area of refuge (5)', 'No step-free way out (3)']);
  const none = await page.$$eval('.sfy-ways[data-ways="none"] .sfy-way', (rows) => rows.map((row) => ({ room: row.dataset.room, reason: row.dataset.reason, text: row.querySelector('.sfy-row__way').textContent })));
  assert.deepEqual(none.map((row) => row.room).sort(), ['rsample301', 'rsample302', 'rsample303']);
  assert.ok(none.every((row) => row.reason === 'no-way' && row.text === 'No step-free way through'), JSON.stringify(none));
  // a refuge row says where it goes
  const refuge = await page.$eval('.sfy-ways[data-ways="refuge"] .sfy-way[data-room="rsample201"] .sfy-row__way', (el) => el.textContent);
  assert.match(refuge, /^Area of refuge · .+, then wait for help$/);
  // an exit row has its number, in the key's colour
  const exit = await page.$eval('.sfy-ways[data-ways="exit"] .sfy-way[data-room="rsample101"] .sfy-row__way', (el) => el.textContent);
  assert.match(exit, /^\d+ Door A · /);
  // the refuges
  const refuges = await page.$$eval('.sfy-refuge', (items) => items.map((item) => ({ id: item.dataset.refuge, used: item.dataset.used, text: item.textContent })));
  assert.deepEqual(refuges.map((item) => [item.id, item.used]), [['arefuge0002', '0'], ['arefuge0001', '5']], 'the refuges are listed floor by floor');
  const byId = new Map(refuges.map((item) => [item.id, item.text]));
  assert.ok(byId.get('arefuge0001').includes('Area of refuge') && byId.get('arefuge0001').includes('by Stairs A') && byId.get('arefuge0001').includes('Used by 5 rooms.'), byId.get('arefuge0001'));
  assert.ok(byId.get('arefuge0002').includes('Not used: every room nearby has a step-free exit.'), byId.get('arefuge0002'));
  // Show: the room's way is shown alone, in words in the first line
  const before = await drawn(page);
  await page.click('.sfy-way[data-room="rsample201"] .sfy-row__show');
  await page.waitForSelector('.sfy[data-picked="rsample201"]');
  await ready(page, before);
  assert.match(await line(page), /^Room 201 on Floor 2: no step-free exit; wait at Area of refuge, \d+ s of walking, for help\.$/);
  assert.equal(await say(page), await line(page));
  assert.equal(await page.$eval('.sfy-key__marks', (el) => el.textContent), 'Round mark: the door the room is left by. Dashed line to the rounded mark: the area of refuge, where it waits for help.');
  // a room with no way: framed, no route, its reason
  await page.click('.sfy-way[data-room="rsample302"] .sfy-row__show');
  await page.waitForSelector('.sfy[data-picked="rsample302"]');
  assert.equal(await line(page), 'Room 302 on Floor 3 has no step-free way out: no step-free way through.');
  assert.equal(await page.$eval('.sfy-key__marks', (el) => el.textContent), 'The picked room is framed. It has no step-free way out, so no route is drawn.');
  // Show every room
  await page.click('[data-action="show-all"]');
  await page.waitForFunction(() => !document.querySelector('.sfy').dataset.picked);
  assert.equal(await line(page), 'Step-free ways out: ' + COUNTS + '.');
});

test('the key in the Step-free view: each exit used, each refuge used, and the rooms with no way; the marks in a sentence', async () => {
  const page = wide.page;
  await load(page, 'marked');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await page.waitForSelector('.sfy-key__item[data-refuge]');
  const items = await page.$$eval('.sfy-key__item', (els) => els.map((el) => ({ exit: el.dataset.exit || null, refuge: el.dataset.refuge || null, none: el.dataset.none || null, text: el.textContent })));
  assert.deepEqual(items.map((item) => [item.exit, item.refuge, item.none]), [['xsample00a', null, null], [null, 'arefuge0001', null], [null, null, '3']], 'Door B has a step, so only Door A is used; the unused refuge is not in the key');
  assert.ok(items[1].text.startsWith('RArea of refuge: Area of refuge, 5 rooms'), items[1].text);
  assert.ok(items[2].text.endsWith('No step-free way out, 3 rooms'), items[2].text);
  assert.equal(await page.$eval('.sfy-key__note[data-note="step-free"]', (el) => el.hidden), false);
  assert.equal(await page.$eval('.sfy-key__note[data-note="step-free"]', (el) => el.textContent), 'Solid line: a step-free way to an exit, in its colour. Dashed line: a way to an area of refuge, where help comes. A framed room marked × has no step-free way out.');
  // the exits' numbers are the Everyone view's
  const numbers = await page.evaluate(() => document.querySelector('.sfy').safety.step.exits.map((exit) => [exit.exitId, exit.number]));
  assert.deepEqual(numbers, [['xsample00a', 1]]);
});

test('the ends of the ways are labelled in words on the map, and what is drawn is the section\'s own: a refuge\'s way dashed in the accent, an exit\'s way solid in its colour', async () => {
  const page = wide.page;
  await load(page, 'marked');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await ready(page, 0);
  const picture = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    return { ends: view.stepEnds().map((end) => [end.kind, end.label, end.floorId]), ways: view.step.rooms.map((room) => room.way) };
  });
  assert.deepEqual(picture.ends, [['exit', 'Door A', 'fsample001'], ['refuge', 'Area of refuge', 'fsample002']]);
  assert.deepEqual(picture.ways, ['exit', 'exit', 'exit', 'exit', 'exit', 'refuge', 'refuge', 'refuge', 'refuge', 'refuge', 'none', 'none', 'none']);
  // the map is painted with the overlay: the badge of a refuge room is the accent
  const painted = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    const g = document.getElementById('safety-plan').getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const size = view.plan.view.size;
    // every pixel of the badge's box (the room's first cell, 2 px in from its corner)
    const colours = (floorId, cells) => {
      const first = Math.min(...cells);
      const at = view.plan.cellAt(floorId, first);
      const out = [];
      for (let dx = 3; dx <= 11; dx += 2) {
        for (let dy = 3; dy <= 11; dy += 2) {
          const d = g.getImageData(Math.round((at.x - size / 2 + dx) * ratio), Math.round((at.y - size / 2 + dy) * ratio), 1, 1).data;
          out.push([d[0], d[1], d[2]]);
        }
      }
      return out;
    };
    const room = view.step.rooms.find((each) => each.roomId === 'rsample201');
    const lost = view.step.rooms.find((each) => each.roomId === 'rsample301');
    return { size, refuge: colours(room.floorId, room.cells), lost: colours(lost.floorId, lost.cells) };
  });
  assert.ok(painted.size >= 8, 'the map is zoomed far enough for badges: ' + painted.size);
  // the accent the map is drawn with (the renderer's theme, as the overlay is given it)
  const accent = await page.evaluate(() => {
    const hex = document.querySelector('.sfy').safety.plan.theme().accent;
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  });
  const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 16);
  assert.ok(painted.refuge.some((pixel) => near(pixel, accent)), 'the badge of a room that waits at a refuge is not the accent: ' + painted.refuge + ' vs ' + accent);
  assert.ok(!painted.lost.some((pixel) => near(pixel, accent)), 'a room with no way out is drawn in the accent');
});

test('a refuge named like markup is text everywhere it is shown: the list, the key, the first line and the map\'s label', async () => {
  const page = wide.page;
  const name = '<b>Refuge</b> & "two" مأوى';
  await load(page, 'marked', name);
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await page.waitForSelector('.sfy-refuge');
  await page.click('.sfy-way[data-room="rsample201"] .sfy-row__show');
  await page.waitForSelector('.sfy[data-picked="rsample201"]');
  assert.equal(await page.$$eval('.sfy-inspector b, .sfy-key b, #safety-line b', (els) => els.length), 0, 'markup was made');
  assert.ok((await line(page)).includes(name), await line(page));
  const texts = await page.$$eval('.sfy-refuge[data-refuge="arefuge0001"] .sfy-refuge__name > bdi:first-child, .sfy-key__item[data-refuge="arefuge0001"] .sfy-key__name', (els) => els.map((el) => el.textContent));
  assert.ok(texts.length >= 1 && texts.every((text) => text === name), JSON.stringify(texts));
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.stepEnds().find((end) => end.kind === 'refuge').label), name);
});

// ---- the Step-free tab

test('the Step-free tab with nothing marked opens with "Nothing step-free is marked yet" and a way to Building, then says every room can be reached', async () => {
  const page = wide.page;
  await load(page, 'plain');
  await tab(page, 'stepfree');
  await page.waitForSelector('.sfy-panel[data-panel="stepfree"]');
  const read = await page.evaluate(() => ({
    unmarked: document.querySelector('.sfy-report .sfy-unmarked .sfy-panel__lead').textContent,
    first: document.querySelector('.sfy-report').children[1].className,
    views: document.querySelector('.sfy-report [data-line="views"]').textContent,
    rooms: Array.from(document.querySelectorAll('.sfy-report .sfy-row[data-room]')).map((row) => [row.dataset.room, row.dataset.reason, row.querySelector('.sfy-row__way').textContent]),
  }));
  assert.equal(read.unmarked, 'Nothing step-free is marked yet, so this assumes every door and corridor is level. Mark steps, doors with a step, elevators and areas of refuge in Building first.');
  assert.equal(read.first, 'sfy-unmarked', 'the opening comes first, under the title');
  assert.equal(read.views, 'Reaching a room may use an elevator; leaving in an emergency may not.');
  // the sample school has stairs only: Floors 2 and 3 cannot be reached
  assert.equal(read.rooms.length, 8);
  assert.ok(read.rooms.every(([, reason]) => reason === 'floor'));
  assert.deepEqual(read.rooms.map(([id]) => id).slice(0, 2), ['rsample201', 'rsample202']);
  assert.equal(read.rooms[0][2], 'Floor 2 has no elevator stop');
  // the link leads to Building
  await page.click('.sfy-report [data-action="to-building"]');
  await page.waitForFunction(() => location.hash === '#building');
  await go(wide.page, '#safety');
  await ready(page);
});

test('the Step-free view opens with the same sentence when nothing is marked', async () => {
  const page = wide.page;
  await load(page, 'plain');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await page.waitForSelector('.sfy-panel[data-panel="ways"] .sfy-unmarked');
  assert.equal(await page.$eval('.sfy-panel[data-panel="ways"] .sfy-unmarked .sfy-panel__lead', (el) => el.textContent), 'Nothing step-free is marked yet, so this assumes every door and corridor is level. Mark steps, doors with a step, elevators and areas of refuge in Building first.');
  assert.equal(await page.$eval('.sfy-panel[data-panel="ways"] .sfy-unmarked [data-action="to-building"]', (el) => el.textContent), 'Go to Building');
});

test('the report by floor with each reason and Show, the step-free groups in those rooms, the two-views line, and Print as a sheet (the step-free output)', async () => {
  const page = wide.page;
  await load(page, 'groups');
  await tab(page, 'stepfree');
  await page.waitForSelector('.sfy-panel[data-panel="stepfree"]');
  assert.equal(await page.$('.sfy-report .sfy-unmarked'), null, 'something is marked: no opening');
  const floors = await page.$$eval('.sfy-floor-report', (els) => els.map((el) => [el.dataset.floor, el.querySelector('.sfy-floor__name').textContent, el.querySelectorAll('.sfy-row').length]));
  assert.deepEqual(floors, [['fsample002', 'Floor 2 (5)', 5], ['fsample003', 'Floor 3 (3)', 3]]);
  const groups = await page.$$eval('.sfy-group', (els) => els.map((el) => el.textContent));
  assert.ok(groups.length > 0 && groups.every((text) => / in (Room|Library)/.test(text)), JSON.stringify(groups));
  assert.equal(await page.$eval('.sfy-report [data-line="views"]', (el) => el.textContent), 'Reaching a room may use an elevator; leaving in an emergency may not.');
  // Show: the room's own way (or none) on the map
  await page.click('.sfy-report .sfy-row[data-room="rsample302"] .sfy-row__show');
  await page.waitForSelector('.sfy[data-picked="rsample302"]');
  // Print opens the report as a sheet
  await page.click('.sfy-report [data-print="step-free"]');
  const read = await previewRead(page);
  assert.equal(read.output, 'step-free');
  assert.equal(read.rows.length, 8);
  assert.deepEqual(read.rows.map((row) => row.reason), Array(8).fill('floor'));
  assert.ok(read.text.includes('Step-free groups in these rooms'));
  assert.ok(read.lines.includes('views') && !read.lines.includes('unmarked'));
  await closePreview(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'step-free', 'the focus is back on Print');
});

test('the Step-free tab by keyboard alone: the tab with the arrows, Show with Enter, Print with Space and the sheet closed with Escape', async () => {
  const page = wide.page;
  await load(page, 'groups');
  await page.focus('.sfy-inspector .tabs__tab[data-tab="exits"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('.sfy-panel[data-panel="stepfree"]');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'stepfree');
  await page.focus('.sfy-report .sfy-row[data-room="rsample301"] .sfy-row__show');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sfy[data-picked="rsample301"]');
  await page.focus('.sfy-report [data-print="step-free"]');
  await page.keyboard.press('Space');
  const read = await previewRead(page);
  assert.equal(read.output, 'step-free');
  await closePreview(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'step-free');
  // the cursor on the map says the step-free way in the Step-free view
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  await ready(page, 0);
  const at = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get('rsample201');
    const cell = row.cells[0];
    const point = view.plan.cellAt(row.floorId, cell);
    const box = document.getElementById('safety-plan').getBoundingClientRect();
    return { x: box.left + point.x, y: box.top + point.y };
  });
  await atRest(page, '#safety-plan');
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.sfy[data-picked="rsample201"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sfy').dataset.picked);
});

// ---- door cards

test('door cards: Step-free ways out is off for a building with nothing marked and on once it has a refuge or a step, and the choice is kept', async () => {
  const page = wide.page;
  await load(page, 'plain');
  await tab(page, 'cards');
  assert.equal(await page.$eval('[data-option="step-free"]', (el) => el.checked), false);
  assert.equal(await page.$eval('label[for$="-step"]', (el) => el.textContent.trim()), 'Step-free ways out');
  await load(page, 'marked');
  await tab(page, 'cards');
  assert.equal(await page.$eval('[data-option="step-free"]', (el) => el.checked), true);
  await page.click('[data-option="step-free"]');
  await tab(page, 'exits');
  await tab(page, 'cards');
  assert.equal(await page.$eval('[data-option="step-free"]', (el) => el.checked), false, 'the choice is kept for the project');
});

test('door cards with Step-free ways out carry the second block where the way differs, "Wait at Area of refuge, by Stairs A, for help." and a room with none says why; unticked there is none', async () => {
  const page = wide.page;
  await load(page, 'marked');
  await tab(page, 'cards');
  // the tick is kept for the project: put it on, whatever an earlier case left
  if (!(await page.$eval('[data-option="step-free"]', (el) => el.checked))) await page.click('[data-option="step-free"]');
  await page.click('.sfy-panel [data-print="all"]');
  let read = await previewRead(page);
  assert.equal(read.output, 'door-cards');
  const kinds = read.cards.reduce((all, card) => ({ ...all, [card.block || 'none-block']: (all[card.block || 'none-block'] || 0) + 1 }), {});
  assert.equal(kinds.refuge, 5, JSON.stringify(kinds));
  assert.equal(kinds.none, 3, JSON.stringify(kinds));
  assert.ok(read.blocks.every((block) => block.head === 'Step-free way out'));
  const refuge = read.blocks.find((block) => block.kind === 'refuge');
  assert.equal(refuge.steps[refuge.steps.length - 1], 'Wait at Area of refuge, by Stairs A, for help.');
  assert.ok(read.text.includes('There is no step-free way out from this room: no step-free way through.'));
  assert.ok(read.text.includes('Step-free way outs'), 'the cover names them');
  await closePreview(page);
  // unticked: no second block
  await page.click('[data-option="step-free"]');
  await page.click('.sfy-panel [data-print="all"]');
  read = await previewRead(page);
  assert.deepEqual(read.blocks, []);
  assert.ok(read.cards.every((card) => card.block === null));
  await closePreview(page);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'all');
});

// ---- 390 px with touch

test('at 390 px with touch: the chips, Show, the tick and Print are 44 px, nothing runs off the side, and a Show shuts the sheet on the room\'s way', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  try {
    await load(page, 'groups');
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has touch');
    await page.tap('#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true' && document.getElementById('inspector').dataset.mode === 'sheet');
    // the chips
    const chips = await page.$$eval('.sfy-view .seg__label', (els) => els.map((el) => [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)]));
    assert.equal(chips.length, 2);
    assert.ok(chips.every(([width, height]) => width >= 44 && height >= 44), JSON.stringify(chips));
    await page.tap('.sfy-view .seg__option:last-child');
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.view === 'step-free');
    await page.waitForSelector('.sfy-panel[data-panel="ways"] .sfy-way');
    const small = async (selector) => page.$$eval(selector, (els) => els.filter((el) => el.getClientRects().length > 0).map((el) => Math.min(el.getBoundingClientRect().height, el.getBoundingClientRect().width)).filter((size) => size < 44));
    assert.deepEqual(await small('.sfy-panel[data-panel="ways"] .sfy-row__show, .sfy-panel[data-panel="ways"] .btn'), []);
    // the report and Print
    await page.tap('.sfy-inspector .tabs__tab[data-tab="stepfree"]');
    await page.waitForSelector('.sfy-panel[data-panel="stepfree"]');
    assert.deepEqual(await small('.sfy-panel[data-panel="stepfree"] .sfy-row__show, .sfy-panel[data-panel="stepfree"] .btn'), []);
    // the Door cards tab's tick
    await page.tap('.sfy-inspector .tabs__tab[data-tab="cards"]');
    assert.deepEqual(await small('.sfy-cards__step-label'), [], 'the tick\'s label is under a finger');
    const label = await page.$eval('.sfy-cards__step-label', (el) => el.getBoundingClientRect().height);
    assert.ok(label >= 44, 'the tick\'s label is ' + label + ' px high');
    // nothing runs off the side
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways');
    assert.equal(await page.evaluate(() => { const sheet = document.getElementById('inspector'); return sheet.scrollWidth <= sheet.clientWidth + 1; }), true, 'the sheet scrolls sideways');
    // Show on a room in the report: the sheet shuts and the room's way is on the map
    await page.tap('.sfy-inspector .tabs__tab[data-tab="stepfree"]');
    await page.$eval('.sfy-report .sfy-row[data-room="rsample302"] .sfy-row__show', (el) => el.scrollIntoView({ block: 'center' }));
    const at = await page.$eval('.sfy-report .sfy-row[data-room="rsample302"] .sfy-row__show', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForSelector('.sfy[data-picked="rsample302"]');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'false');
    assert.equal(await line(page), 'Room 302 on Floor 3 has no step-free way out: no step-free way through.');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('no script error was raised by any of this', async () => {
  assert.deepEqual(wide.problems().errors, []);
});
