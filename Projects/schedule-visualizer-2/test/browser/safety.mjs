// The Safety section in a real browser (spec 10.1, 10.2, 18 "print door
// cards"; DESIGN 5.5): node test/browser/safety.mjs
//
// A room picked by pointer and by keyboard, every room coloured by exit
// with a key that names each exit, the inspector's exits and rooms with no
// way out, door cards printed for one room, a choice of rooms and every
// room through the print preview (read from the preview's own sheets, the
// paper chosen in the sheet), typed names shown as typed, the stage and the
// toast rules at three sizes, and the time evacuationRoutes and the
// section's picture take on the 3.13 fixture in this browser. SV2-67b: where
// the focus goes when what held it hides or goes, the exits' colours past ten
// and under the badges' zoom, state gone stale while mounted (a room deleted
// or renamed, another project), a no-route room's key, a section drawn off the
// page (SV2-72c: at once, in the page's colours), and one finger and two on the map leaving the pick alone.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go } from './harness.mjs';

let wide;

before(async () => {
  wide = await openPlanner({ width: 1280, height: 800, hash: '#safety', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
});

// The section drawn for the project in the store: styled, measured, its
// picture worked out for this very project, and the map painted at least
// once since `since` (a count of paints).
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

// Back to the sample school as it loads, every room shown, nothing ticked,
// the inspector on the tab asked for.
async function fresh(page, tab = 'exits') {
  if (await page.$('#print-preview[open]')) await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    globalThis.sv2.store.replace(sampleSchool());
  });
  await go(page, '#safety');
  await ready(page);
  await page.evaluate((which) => {
    const view = document.querySelector('.sfy').safety;
    view.pick(null);
    const untick = document.querySelector('.sfy-panel [data-action="untick"]');
    if (untick && !untick.hidden) untick.click();
    const button = document.querySelector('.sfy-inspector .tabs__tab[data-tab="' + which + '"]');
    if (button.getAttribute('aria-selected') !== 'true') button.click();
  }, tab);
  await ready(page);
}

// A typed text read only from an element that is on screen.
async function seen(page, selector) {
  return page.$eval(selector, (el) => {
    if (el.getClientRects().length === 0) throw new Error(el.className + ' has no box');
    return el.textContent;
  });
}

// Where a room's middle cell is on the page, in CSS pixels.
async function roomPoint(page, roomId) {
  return page.evaluate((id) => {
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get(id);
    const cell = row.cells[Math.floor(row.cells.length / 2)];
    const at = view.plan.cellAt(row.floorId, cell);
    const box = document.getElementById('safety-plan').getBoundingClientRect();
    return at ? { x: box.left + at.x, y: box.top + at.y } : null;
  }, roomId);
}

// Every cell of a room's way out, and the room, is on the stage.
async function wayOnStage(page, roomId) {
  return page.evaluate((id) => {
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get(id);
    const places = [...row.cells.map((cell) => ({ floorId: row.floorId, cell })), ...row.route.cells, row.route.exit];
    const off = places.filter((place) => {
      const at = view.plan.cellAt(place.floorId, place.cell);
      return !at || at.x < 0 || at.y < 0 || at.x > view.plan.view.width || at.y > view.plan.view.height;
    });
    return { off: off.length, of: places.length };
  }, roomId);
}

// The print preview's document, once it is laid out: the cards in print
// order, the cover's lists, the paper, and every typed name it holds.
async function previewRead(page) {
  await page.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 20000 });
  return page.evaluate(() => {
    const sheet = document.getElementById('print-preview');
    const doc = sheet.querySelector('iframe').contentDocument;
    const cards = [];
    for (const card of doc.querySelectorAll('.card[data-card]')) if (!cards.includes(card.dataset.card)) cards.push(card.dataset.card);
    return {
      output: doc.documentElement.dataset.output,
      paper: doc.documentElement.dataset.paper + ' ' + doc.documentElement.dataset.orientation,
      sheetPaper: sheet.dataset.paper,
      sheets: Number(sheet.dataset.sheets),
      cards,
      routes: Array.from(doc.querySelectorAll('.card[data-card]')).map((card) => card.dataset.route),
      cover: Array.from(doc.querySelectorAll('.card-cover__list li')).map((li) => li.dataset.room),
      missing: Array.from(doc.querySelectorAll('.card-cover__missing li')).map((li) => ({ room: li.dataset.room, text: li.textContent })),
      names: Array.from(doc.querySelectorAll('.card__name')).map((el) => el.textContent),
      text: doc.body.textContent,
      images: doc.querySelectorAll('img').length,
    };
  });
}

async function closePreview(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#print-preview[open]'));
}

// What the sample school is, as the engine works it out.
async function sampleFacts(page) {
  return page.evaluate(() => {
    const picture = document.querySelector('.sfy').safety.picture;
    return {
      rooms: picture.rows.map((row) => ({ id: row.roomId, floorId: row.floorId, name: row.name, exit: row.exitId, ok: row.ok })),
      exits: picture.exits.map((exit) => ({ id: exit.exitId, number: exit.number, name: exit.name, rooms: exit.roomIds, people: exit.people })),
    };
  });
}

test('every room is shown coloured by its exit: the first line says so, and the key names each exit with its number and its rooms', async () => {
  const page = wide.page;
  await fresh(page);
  const facts = await sampleFacts(page);
  assert.equal(facts.exits.length, 2, 'the sample school has two exits');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'all');
  assert.equal(await seen(page, '#safety-line .mov-line__words'), 'Every room’s way out, coloured by the exit it uses: 13 rooms to 2 exits.');
  assert.equal(await page.$eval('[data-action="show-all"]', (el) => el.hidden), true, 'Show every room is offered while every room is shown');
  const key = await page.$$eval('.sfy-key__item', (items) => items.map((item) => ({ exit: item.dataset.exit, number: item.dataset.number, text: item.textContent, box: item.getClientRects().length })));
  assert.deepEqual(key.map((item) => item.exit), facts.exits.map((exit) => exit.id));
  for (const [i, item] of key.entries()) {
    const exit = facts.exits[i];
    assert.equal(item.box > 0, true, 'the key\'s item for ' + exit.name + ' is not on screen');
    assert.equal(item.text, exit.number + 'Exit ' + exit.number + ': ' + exit.name + ', ' + exit.rooms.length + (exit.rooms.length === 1 ? ' room' : ' rooms'));
  }
  // each room is drawn in its exit's colour: the frame inside the room's top left cell
  const pixels = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    const canvas = document.getElementById('safety-plan');
    const g = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const size = view.plan.view.size;
    return view.picture.rows.filter((row) => row.ok).map((row) => {
      const floor = view.plan.project.building.floors.find((each) => each.id === row.floorId);
      // the room's last cell in its top row, away from the badge on the first
      const top = Math.min(...row.cells.map((cell) => Math.floor(cell / floor.width)));
      const cell = Math.max(...row.cells.filter((each) => Math.floor(each / floor.width) === top));
      const at = view.plan.cellAt(row.floorId, cell);
      // the frame's line lies 1 to 5 px under the room's top edge: the column of pixels there, one of which is wholly the line
      const x = Math.round(at.x * ratio);
      const y = Math.round((at.y - size / 2) * ratio);
      const d = g.getImageData(x, y, 1, Math.ceil(6 * ratio)).data;
      const column = [];
      for (let i = 0; i < d.length; i += 4) column.push([d[i], d[i + 1], d[i + 2]]);
      return { room: row.roomId, number: row.exitNumber, column, want: view.colour(row.exitNumber) };
    });
  });
  for (const pixel of pixels) {
    const want = [1, 3, 5].map((i) => parseInt(pixel.want.slice(i, i + 2), 16));
    const off = Math.min(...pixel.column.map((got) => Math.max(...want.map((value, i) => Math.abs(value - got[i])))));
    assert.ok(off <= 12, pixel.room + ' is not framed in exit ' + pixel.number + '\'s colour ' + pixel.want + ': ' + JSON.stringify(pixel.column));
  }
});

for (const theme of ['light', 'dark']) {
  test('the key\'s colours in the ' + theme + ' theme: each swatch at 3:1 on the key, its number at 4.5:1 on the swatch, no two exits alike, and the colours safety.css\'s --exit-n tokens', async () => {
    const session = theme === 'light' ? null : await openPlanner({ width: 1280, height: 800, hash: '#safety', theme });
    const page = session ? session.page : wide.page;
    try {
      if (session) await ready(page);
      else await fresh(page);
      const result = await page.evaluate(async () => {
        const { contrast } = await import('./ui/colour.js');
        const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        const key = document.querySelector('.sfy-key');
        const surface = hex(getComputedStyle(key).backgroundColor);
        const tokens = getComputedStyle(document.documentElement);
        return Array.from(document.querySelectorAll('.sfy-key .sfy-swatch')).map((swatch, i) => {
          const style = getComputedStyle(swatch);
          const fill = hex(style.backgroundColor);
          return { fill, surface, edge: contrast(fill, surface), ink: contrast(hex(style.color), fill), token: tokens.getPropertyValue('--exit-' + (i + 1)).trim() };
        });
      });
      assert.equal(result.length, 2);
      for (const swatch of result) {
        assert.ok(swatch.edge >= 3, theme + ': the swatch ' + swatch.fill + ' is ' + swatch.edge.toFixed(2) + ':1 on ' + swatch.surface);
        assert.ok(swatch.ink >= 4.5, theme + ': the number on ' + swatch.fill + ' is ' + swatch.ink.toFixed(2) + ':1');
      }
      assert.notEqual(result[0].fill, result[1].fill, 'two exits share a colour');
      // SV2-72c (W2): the exits' categorical set, never the problem red; the hues are test/ui/exit-colours.test.mjs's
      assert.deepEqual(result.map((swatch) => swatch.fill), result.map((swatch) => swatch.token), theme + ': the swatches are not the --exit-n tokens');
    } finally {
      if (session) await session.close();
    }
  });
}

test('a room picked by pointer: its way out alone, the first line and the marks say it, the same room or no room shows every room again', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  const at = await roomPoint(page, 'rsample201');
  assert.ok(at, 'Room 201 is not on the map');
  let was = await drawn(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('.sfy[data-picked="rsample201"]');
  await ready(page, was);
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'one');
  assert.match(await seen(page, '#safety-line .mov-line__words'), /^Room 201 on Floor 2: out by Door A in \d+( min( \d+ s)?| s) of walking\.$/);
  assert.equal(await seen(page, '[data-action="show-all"]'), 'Show every room');
  assert.equal(await seen(page, '.sfy-key__marks'), 'Round mark: the door the room is left by. Square mark: the exit.');
  assert.equal(await page.$eval('.sfy-key__list', (el) => el.hidden), true, 'the exits\' key stays up over a single route');
  assert.equal(await page.$eval('#announcer', (el) => el.textContent), await page.$eval('#safety-line .mov-line__words', (el) => el.textContent));
  // the Door cards tab offers this room's card
  assert.equal(await seen(page, '.sfy-panel [data-print="picked"]'), 'Print the card for Room 201');

  // a click on the same room: every room again
  was = await drawn(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
  await ready(page, was);
  assert.equal(await page.$eval('.sfy-panel [data-print="picked"]', (el) => el.hidden), true);

  // another room, then a click off every room: every room again
  const gym = await roomPoint(page, 'rsamplegym');
  await page.mouse.click(gym.x, gym.y);
  await page.waitForSelector('.sfy[data-picked="rsamplegym"]');
  assert.match(await seen(page, '#safety-line .mov-line__words'), /^Gym on Floor 1: out by Door B in /);
  const off = await page.evaluate(() => {
    const box = document.getElementById('safety-plan').getBoundingClientRect();
    return { x: box.left + 6, y: box.top + 6 };
  });
  await page.mouse.click(off.x, off.y);
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
  // and Show every room does the same
  await page.mouse.click(gym.x, gym.y);
  await page.waitForSelector('.sfy[data-picked="rsamplegym"]');
  await page.click('[data-action="show-all"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
});

test('a room picked by keyboard: the cursor over a room says where it goes out, Enter shows its way out, Escape every room again', async () => {
  const page = wide.page;
  await fresh(page);
  await page.focus('#safety-plan');
  // the cursor one cell left of Room 102's middle, then one step right onto it
  await page.evaluate(async () => {
    const { placeOf } = await import('./ui/surface/plan-layout.js');
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get('rsample102');
    const cell = row.cells[Math.floor(row.cells.length / 2)];
    const at = placeOf(view.plan.world, row.floorId, cell);
    view.plan.cursor.moveTo(at.x - 1, at.y, true);
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Room 102: out by /.test(document.getElementById('announcer').textContent));
  assert.equal(await page.$eval('#announcer', (el) => el.textContent), 'Room 102: out by Door A, number 1 in the key. Enter shows its way out.');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'all', 'the cursor alone picks nothing');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sfy[data-picked="rsample102"]');
  assert.match(await page.$eval('#announcer', (el) => el.textContent), /^Room 102 on Floor 1: out by Door A in /);
  // the cursor's ring is drawn: the map has the focus
  assert.equal(await page.evaluate(() => document.activeElement.id), 'safety-plan');
  await page.waitForFunction(() => document.querySelector('.mov-marks').dataset.cursor !== undefined);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'safety-plan', 'Escape took the focus off the map');
  // a cell that is no room: Enter picks nothing and says so
  await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    view.plan.cursor.moveTo(0, 0, true);
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('announcer').textContent === 'There is no room under the cursor.');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'all');
});

test('the inspector lists each exit with the rooms it serves and their people, and a room named there is picked and brought onto the map', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  const facts = await sampleFacts(page);
  const capacity = await page.evaluate(() => {
    const out = {};
    for (const floor of globalThis.sv2.store.project.building.floors) for (const space of floor.spaces) if (space.kind === 'room') out[space.id] = space.capacity;
    return out;
  });
  const listed = await page.$$eval('.sfy-exit', (items) => items.map((item) => ({
    exit: item.dataset.exit,
    name: item.querySelector('.sfy-exit__name').textContent,
    where: item.querySelector('.sfy-exit__where').textContent,
    assembly: item.querySelector('.sfy-exit__assembly').textContent,
    rooms: Array.from(item.querySelectorAll('.sfy-room')).map((button) => ({ id: button.dataset.room, text: button.textContent })),
    box: item.getClientRects().length,
  })));
  assert.deepEqual(listed.map((item) => item.exit), facts.exits.map((exit) => exit.id));
  const names = new Map(facts.rooms.map((room) => [room.id, room.name]));
  for (const [i, item] of listed.entries()) {
    const exit = facts.exits[i];
    assert.ok(item.box > 0);
    assert.equal(item.name, exit.number + 'Exit ' + exit.number + ': ' + exit.name);
    assert.deepEqual(item.rooms.map((room) => room.id), exit.rooms, exit.name + ' does not list the rooms that go out by it');
    assert.deepEqual(item.rooms.map((room) => room.text), exit.rooms.map((id) => names.get(id)));
    const people = exit.rooms.reduce((sum, id) => sum + (capacity[id] || 0), 0);
    assert.equal(exit.people, people);
    assert.equal(item.where, 'On Floor 1. ' + exit.rooms.length + (exit.rooms.length === 1 ? ' room, ' : ' rooms, ') + people + ' people.');
    assert.match(item.assembly, /^Assembly point: ./);
  }
  // every room is in one exit's list
  assert.deepEqual(listed.flatMap((item) => item.rooms.map((room) => room.id)).sort(), facts.rooms.map((room) => room.id).sort());
  assert.equal(await seen(page, '.sfy-missing__none'), 'Every room has a way out.');

  // a room's button picks it, presses it, and brings its whole way out onto the map
  await page.evaluate(() => {
    const plan = document.querySelector('.sfy').safety.plan;
    plan.fit();
    for (let i = 0; i < 6; i += 1) plan.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
  });
  const before = await wayOnStage(page, 'rsample303');
  assert.ok(before.off > 0, 'zoomed in, Room 303\'s way out was all on the stage already: the case tests nothing');
  await page.click('.sfy-exit .sfy-room[data-room="rsample303"]');
  await page.waitForSelector('.sfy[data-picked="rsample303"]');
  assert.equal(await page.$eval('.sfy-exit .sfy-room[data-room="rsample303"]', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('.sfy-exit .sfy-room[data-room="rsample101"]', (el) => el.getAttribute('aria-pressed')), 'false');
  assert.deepEqual(await wayOnStage(page, 'rsample303'), { off: 0, of: before.of }, 'Room 303\'s way out is not all on the map');
});

// The sample school with one room that opens onto nothing: a block of empty
// cells on Floor 1 with no corridor or stairs beside it.
async function withCutOffRoom(page) {
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    const floor = project.building.floors[0];
    const owned = new Set(floor.spaces.flatMap((space) => space.cells));
    const free = (x, y) => x >= 0 && y >= 0 && x < floor.width && y < floor.height && floor.cells[y * floor.width + x] === '.' && !owned.has(y * floor.width + x);
    const walk = (x, y) => x >= 0 && y >= 0 && x < floor.width && y < floor.height && floor.cells[y * floor.width + x] !== '.';
    let found = null;
    for (let y = 1; y < floor.height - 3 && !found; y += 1) {
      for (let x = 1; x < floor.width - 3 && !found; x += 1) {
        let ok = true;
        for (let dy = -1; dy <= 2 && ok; dy += 1) for (let dx = -1; dx <= 2 && ok; dx += 1) if (!free(x + dx, y + dy) || walk(x + dx, y + dy)) ok = false;
        if (ok) found = [x, y];
      }
    }
    const [x, y] = found;
    const cells = [y * floor.width + x, y * floor.width + x + 1, (y + 1) * floor.width + x, (y + 1) * floor.width + x + 1];
    floor.spaces.push({ id: 'rsafetycut', kind: 'room', cells, number: 'Annex 9', teacherIds: [], subjectId: null, wing: '', capacity: 12, shared: false, doors: [] });
    globalThis.sv2.store.replace(project);
  });
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.missing === '1');
}

test('a room with no way out: the first line counts it, the inspector lists it with the routing engine\'s sentence, its card says so', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  await withCutOffRoom(page);
  assert.equal(await seen(page, '#safety-line .mov-line__words'), 'Every room’s way out, coloured by the exit it uses: 13 rooms to 2 exits. 1 room has no way out.');
  const sentence = await page.evaluate(() => document.querySelector('.sfy').safety.picture.missing[0].sentence);
  assert.equal(sentence, 'Annex 9 on Floor 1 does not open onto a corridor.');
  const row = await page.$eval('.sfy-missing__row[data-room="rsafetycut"]', (el) => ({ button: el.querySelector('.sfy-room').textContent, why: el.querySelector('.sfy-missing__why').textContent, box: el.getClientRects().length }));
  assert.deepEqual(row, { button: 'Annex 9', why: sentence, box: 1 });
  assert.equal(await page.$eval('.sfy-missing', (el) => el.dataset.missing), '1');
  // picked: the first line says it has no way out
  await page.click('.sfy-missing__row .sfy-room');
  await page.waitForSelector('.sfy[data-picked="rsafetycut"]');
  assert.equal(await seen(page, '#safety-line .mov-line__words'), 'Annex 9 has no way out. ' + sentence);
  // the key says what is drawn for it, a frame and no route, not the round and square marks
  assert.equal(await seen(page, '.sfy-key__marks'), 'The picked room is framed. It has no way out, so no route is drawn.');
  // in the Door cards list, in words where the way out would be
  await page.click('.sfy-inspector .tabs__tab[data-tab="cards"]');
  assert.equal(await seen(page, '.sfy-row[data-room="rsafetycut"] .sfy-row__way'), sentence);
  // its card, printed alone, has the cover listing it
  await page.click('.sfy-panel [data-print="picked"]');
  const read = await previewRead(page);
  assert.equal(read.output, 'door-cards');
  assert.deepEqual(read.cards, ['rsafetycut']);
  assert.deepEqual(read.routes, ['none']);
  assert.deepEqual(read.missing.map((each) => each.room), ['rsafetycut']);
  assert.ok(read.missing[0].text.includes(sentence), read.missing[0].text);
  await closePreview(page);
});

test('door cards for the picked room print through the preview: one card, the paper chosen in the sheet', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample204'));
  await page.waitForFunction(() => !document.querySelector('.sfy-panel [data-print="picked"]').hidden);
  await page.click('.sfy-panel [data-print="picked"]');
  let read = await previewRead(page);
  assert.equal(read.output, 'door-cards');
  assert.deepEqual(read.cards, ['rsample204']);
  assert.deepEqual(read.cover, [], 'one card with a way out prints with no cover sheet');
  assert.deepEqual(read.names, ['Room 204']);
  assert.ok(read.text.includes('Evacuation route'));
  assert.equal(read.sheets, 1);
  // the paper, chosen in the preview's own sheet controls
  await page.click('#print-preview input[value="a4"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]');
  await page.click('#print-preview input[value="landscape"]');
  await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a4 landscape"]');
  read = await previewRead(page);
  assert.equal(read.paper, 'a4 landscape');
  assert.deepEqual(read.cards, ['rsample204']);
  await closePreview(page);
  // the focus is back on the button that opened it
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'picked');
  // put the paper back, for the cases after
  await page.evaluate(async () => {
    const { setSetting } = await import('./engine/actions.js');
    globalThis.sv2.store.apply(setSetting, { key: 'paper.size', value: 'letter' });
    globalThis.sv2.store.apply(setSetting, { key: 'paper.orientation', value: 'portrait' });
  });
});

test('door cards for the rooms ticked in the list print in room order, with the cover sheet; the count and Untick all follow the boxes', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  assert.equal(await page.$eval('.sfy-panel [data-print="chosen"]', (el) => el.getAttribute('aria-disabled')), 'true');
  // pressed with nothing ticked: it says what to do and opens nothing
  await page.click('.sfy-panel [data-print="chosen"]');
  await page.waitForFunction(() => document.getElementById('announcer').textContent === 'Tick rooms in the list below first.');
  assert.equal(await page.$('#print-preview[open]'), null);
  // ticked out of order: Floor 3, Floor 1, Floor 2
  for (const id of ['rsample302', 'rsample101', 'rsample204']) await page.click('.sfy-row[data-room="' + id + '"] .sfy-row__box');
  assert.equal(await seen(page, '.sfy-panel [data-print="chosen"]'), 'Print the 3 rooms ticked');
  assert.equal(await page.$eval('.sfy-panel [data-print="chosen"]', (el) => el.hasAttribute('aria-disabled')), false);
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.chosen.sort()), ['rsample101', 'rsample204', 'rsample302']);
  await page.click('.sfy-panel [data-print="chosen"]');
  const read = await previewRead(page);
  assert.deepEqual(read.cards, ['rsample101', 'rsample204', 'rsample302'], 'the cards are not in room order');
  assert.deepEqual(read.cover, ['rsample101', 'rsample204', 'rsample302'], 'the cover does not list the pile');
  assert.ok(read.sheets >= 4, 'a cover and three cards are at least four sheets: ' + read.sheets);
  await closePreview(page);
  // the focus is back on the button that opened it
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'chosen');
  // the ticks outlive a visit to another section
  await go(page, '#movement');
  await go(page, '#safety');
  await ready(page);
  await page.click('.sfy-inspector .tabs__tab[data-tab="cards"]');
  assert.equal(await page.$eval('.sfy-row[data-room="rsample204"] .sfy-row__box', (el) => el.checked), true);
  await page.click('.sfy-panel [data-action="untick"]');
  assert.equal(await page.$eval('.sfy-panel [data-print="chosen"]', (el) => el.dataset.count), '0');
  assert.equal(await page.$$eval('.sfy-row__box:checked', (boxes) => boxes.length), 0);
  assert.equal(await page.$eval('.sfy-panel [data-action="untick"]', (el) => el.hidden), true);
});

test('door cards for every room: the whole building in room order behind a cover sheet', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  const facts = await sampleFacts(page);
  assert.equal(await seen(page, '.sfy-panel [data-print="all"]'), 'Print every room’s card (13)');
  await page.click('.sfy-panel [data-print="all"]');
  const read = await previewRead(page);
  // room order: floor by floor, then number (sortRoomRows)
  const order = await page.evaluate(async () => {
    const { roomsFor } = await import('./ui/prints/door-cards.js');
    return roomsFor(globalThis.sv2.store.project, {}).rows.map((row) => row.id);
  });
  assert.deepEqual(read.cards, order);
  assert.equal(read.cards.length, facts.rooms.length);
  assert.deepEqual(read.cover, order);
  assert.deepEqual(read.routes.filter((route) => route !== 'ok'), []);
  await closePreview(page);
  // the focus is back on the button that opened it
  assert.equal(await page.evaluate(() => document.activeElement.dataset.print), 'all');
});

test('the text alternative: every room with its exit, its walking time and the first step, floor by floor, and Show picks it', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  const rows = await page.$$eval('.sfy-row', (items) => items.map((item) => ({ room: item.dataset.room, name: item.querySelector('.sfy-row__name').textContent, way: item.querySelector('.sfy-row__way').textContent, floor: item.closest('.sfy-floor').querySelector('legend').textContent })));
  const expected = await page.evaluate(async () => {
    const { buildGraph } = await import('./engine/graph.js');
    const { evacuationRoutes, doorCard, byExit } = await import('./engine/evacuation.js');
    const { formatDuration } = await import('./engine/findings.js');
    const project = globalThis.sv2.store.project;
    const graph = buildGraph(project);
    const evacuation = evacuationRoutes(project, graph);
    const exits = byExit(project, evacuation);
    return evacuation.rooms.map((entry) => {
      const floor = project.building.floors.find((each) => each.id === entry.floorId);
      const number = exits.findIndex((exit) => exit.exitId === entry.route.exitId) + 1;
      const card = doorCard(project, graph, entry.route);
      return { room: entry.roomId, floor: floor.name, way: number + ' ' + exits[number - 1].doorName + ' · ' + formatDuration(entry.route.seconds) + ' · ' + card.steps[0].text };
    });
  });
  assert.deepEqual(rows.map((row) => row.room), expected.map((row) => row.room));
  for (const [i, row] of rows.entries()) {
    assert.equal(row.floor, expected[i].floor);
    assert.equal(row.way, expected[i].way, row.name);
  }
  // Show puts that room's way out on the map
  await page.click('.sfy-row[data-room="rsample203"] [data-action="show"]');
  await page.waitForSelector('.sfy[data-picked="rsample203"]');
});

test('typed names, hostile and in other scripts, are shown and printed exactly as typed', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  const typed = { room: '<img src=x onerror="globalThis.sv2pwned=1">', other: '教室 ١٢ — غرفة', door: '"><script>globalThis.sv2pwned=2</script>', assembly: '<b>Lawn</b> & “field”', floor: 'Étage <1>' };
  await page.evaluate(async (t) => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    const floor = project.building.floors[0];
    floor.name = t.floor;
    floor.spaces.find((space) => space.id === 'rsample101').number = t.room;
    floor.spaces.find((space) => space.id === 'rsample102').number = t.other;
    floor.exits[0].doorName = t.door;
    floor.exits[0].assembly = t.assembly;
    globalThis.sv2.store.replace(project);
  }, typed);
  await ready(page);
  assert.equal(await seen(page, '.sfy-key__name'), typed.door);
  assert.equal(await seen(page, '.sfy-exit .sfy-exit__assembly bdi'), typed.assembly);
  assert.equal(await seen(page, '.sfy-exit__where bdi'), typed.floor);
  assert.equal(await seen(page, '.sfy-room[data-room="rsample101"]'), typed.room);
  assert.equal(await seen(page, '.sfy-room[data-room="rsample102"]'), 'Room ' + typed.other);
  await page.click('.sfy-room[data-room="rsample101"]');
  await page.waitForSelector('.sfy[data-picked="rsample101"]');
  assert.match(await seen(page, '#safety-line .mov-line__words'), new RegExp('^' + typed.room.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' on ' + typed.floor + ': out by '));
  await page.click('.sfy-inspector .tabs__tab[data-tab="cards"]');
  assert.equal(await seen(page, '.sfy-row[data-room="rsample102"] .sfy-row__name'), 'Room ' + typed.other);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sfy img, .sfy-inspector img, .sfy script, .sfy-inspector script, .sfy b, .sfy-inspector b').length), 0);
  await page.click('.sfy-panel [data-print="picked"]');
  const read = await previewRead(page);
  assert.deepEqual(read.names, [typed.room]);
  assert.ok(read.text.includes(typed.door) && read.text.includes(typed.assembly) && read.text.includes(typed.floor), 'the card does not carry the names as typed');
  assert.equal(read.images, 0, 'a typed name became an element on the card');
  await closePreview(page);
  assert.equal(await page.evaluate(() => globalThis.sv2pwned), undefined, 'a typed name ran as script');
});

test('with no exits, or no rooms, the section says what to do first and draws no map', async () => {
  const page = wide.page;
  await fresh(page);
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    for (const floor of project.building.floors) floor.exits = [];
    globalThis.sv2.store.replace(project);
  });
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'empty');
  assert.equal(await seen(page, '.sfy-empty .intro__headline'), 'This is the safety section.');
  assert.equal(await seen(page, '.sfy-empty .intro__facts'), 'No exits are marked yet, for 13 rooms.');
  assert.equal(await page.$eval('.sfy .mov-map', (el) => el.hidden), true);
  assert.equal(await page.$eval('#inspector', (el) => el.hidden), true, 'an inspector with nothing in it is up');
  await page.click('.sfy-empty [data-action="to-building"]');
  await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'building');
  // and back to the sample: the map again
  await fresh(page);
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'all');
});

test('spec 18, "print door cards": from the rail to a room tapped on the map, its card in the preview on A4, closed; then every room\'s', async () => {
  const session = await openPlanner({ width: 1280, height: 800, hash: '#building', theme: 'light' });
  const page = session.page;
  try {
    await page.focus('body');
    await page.keyboard.press('5');
    await page.waitForFunction(() => document.querySelector('.surface__layout').dataset.section === 'safety');
    await ready(page);
    const at = await roomPoint(page, 'rsample303');
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('.sfy[data-picked="rsample303"]');
    await page.click('.sfy-inspector .tabs__tab[data-tab="cards"]');
    await page.click('.sfy-panel [data-print="picked"]');
    await page.waitForSelector('#print-preview[open][data-ready="true"]');
    await page.click('#print-preview input[value="a4"]');
    await page.waitForSelector('#print-preview[data-ready="true"][data-paper="a4 portrait"]');
    let read = await previewRead(page);
    assert.deepEqual(read.cards, ['rsample303']);
    assert.deepEqual(read.names, ['Room 303']);
    assert.ok(read.text.includes('Take stairs B down to Floor 2.'), 'Room 303 is on Floor 3: its card says to take the stairs');
    await closePreview(page);
    await page.click('.sfy-panel [data-print="all"]');
    read = await previewRead(page);
    assert.equal(read.cards.length, 13);
    assert.equal(read.paper, 'a4 portrait', 'the paper chosen last time is the one offered');
    await closePreview(page);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// The stage and the toast rules of the plan map (DESIGN 5.3; DECISIONS
// 2026-10-15 11:54, 2026-10-16 01:15) hold on Safety.
for (const [name, size] of [['390 by 844 with touch', { width: 390, height: 844, mobile: true }], ['844 by 390 with touch', { width: 844, height: 390, mobile: true }], ['1280 by 800', { width: 1280, height: 800 }]]) {
  test('at ' + name + ': the stage keeps its least, the key is reached under it, nothing runs off the side, and a message lies above the zoom buttons', async () => {
    const session = await openPlanner({ ...size, hash: '#safety', theme: 'light' });
    const page = session.page;
    try {
      await ready(page);
      const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      assert.equal(touch, size.mobile === true, 'the page is not under the pointer asked for');
      const shape = await page.evaluate(async () => {
        const { stageLeast } = await import('./ui/surface/plan-layout.js');
        const view = document.querySelector('.sfy').safety;
        const stage = document.querySelector('.sfy .mov-stage');
        const zoom = document.querySelector('.sfy .mov-zoom');
        const margin = parseFloat(getComputedStyle(zoom).left) || 0;
        const root = document.querySelector('.sfy');
        return {
          stage: stage.getBoundingClientRect().height,
          least: stageLeast(view.plan.world, stage.clientWidth, zoom.offsetHeight + margin * 2),
          wide: root.scrollWidth - root.clientWidth,
          zoomInStage: zoom.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 0.5 && zoom.getBoundingClientRect().top >= stage.getBoundingClientRect().top - 0.5,
        };
      });
      assert.ok(shape.stage >= shape.least - 0.5, 'the stage is ' + shape.stage + ' px, under its least ' + shape.least);
      // SV2-72c (W5): on a phone on its side Safety keeps 160 px of map (it had 135 under the first line and the key)
      if (size.height < 500) assert.ok(shape.stage >= 160 - 0.5, 'on a phone on its side the stage is ' + shape.stage + ' px, under 160');
      assert.ok(shape.wide <= 0, 'the section runs ' + shape.wide + ' px off the side');
      assert.ok(shape.zoomInStage, 'the zoom buttons are not on the stage');
      // the key, under the stage, is reached by scrolling the section to its end
      await page.evaluate(() => {
        const root = document.querySelector('.sfy');
        root.scrollTop = root.scrollHeight;
      });
      await page.waitForFunction(() => {
        const key = document.querySelector('.sfy-key').getBoundingClientRect();
        const root = document.querySelector('.sfy').getBoundingClientRect();
        return key.height > 0 && key.bottom <= root.bottom + 0.5 && key.top >= root.top - 0.5;
      });
      // the section scrolled to its end: the dock is measured again there
      await page.waitForFunction(() => {
        const root = document.querySelector('.sfy');
        return root.dataset.dockedAt === String(Math.round(root.scrollTop)) && document.getElementById('surface').style.getPropertyValue('--toast-clear') !== '';
      });
      await page.evaluate(() => globalThis.sv2.ctx.toast({ text: 'A message from the shell, long enough to take most of a phone’s width.' }));
      await page.waitForSelector('.toast');
      const boxes = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        };
        return { toast: box(document.querySelector('.toast')), zoom: box(document.querySelector('.sfy .mov-zoom')), surface: box(document.getElementById('surface')) };
      });
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.equal(overlap(boxes.toast, boxes.zoom), false, 'the message lies on the zoom buttons: ' + JSON.stringify(boxes));
      assert.ok(boxes.toast.bottom <= boxes.surface.bottom && boxes.toast.top >= boxes.surface.top, 'the message is out of the surface');
      assert.ok(boxes.zoom.top - boxes.toast.bottom <= 24, 'the message is ' + (boxes.zoom.top - boxes.toast.bottom) + ' px above the zoom buttons, not just above them');
      // the message goes (on a phone on its side it lies over the map)
      await page.click('.toast .toast__close');
      await page.waitForFunction(() => !document.querySelector('.toast'));
      // a tap (or a click) on a room picks it at this size too
      await page.evaluate(() => {
        document.querySelector('.sfy').scrollTop = 0;
        document.querySelector('.sfy').safety.plan.fit();
      });
      await page.waitForFunction(() => document.querySelector('.sfy').dataset.dockedAt === '0');
      const at = await roomPoint(page, 'rsamplegym');
      const visible = await page.evaluate((p) => {
        const stage = document.querySelector('.sfy .mov-stage').getBoundingClientRect();
        const zoom = document.querySelector('.sfy .mov-zoom').getBoundingClientRect();
        const inside = (r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
        return inside(stage) && !inside(zoom) && p.y < window.innerHeight;
      }, at);
      assert.ok(visible, 'the Gym is not on screen to be picked at ' + JSON.stringify(at));
      if (size.mobile) await page.touchscreen.tap(at.x, at.y);
      else await page.mouse.click(at.x, at.y);
      await page.waitForSelector('.sfy[data-picked="rsamplegym"]');
      assert.deepEqual(session.problems().errors, []);
    } finally {
      await session.close();
    }
  });
}

test('on a phone with touch the inspector is a sheet: a room tapped in it shuts the sheet and shows its way out on the map, a 44 px target', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  try {
    await ready(page);
    await page.tap('#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true' && document.getElementById('inspector').dataset.mode === 'sheet' && document.querySelectorAll('#inspector .sfy-room').length > 0);
    const button = '#inspector .sfy-exit .sfy-room[data-room="rsample302"]';
    await page.$eval(button, (el) => el.scrollIntoView({ block: 'center' }));
    const at = await page.$eval(button, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, height: r.height };
    });
    assert.ok(at.height >= 44, 'a room\'s button is ' + at.height + ' px high under a finger');
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForSelector('.sfy[data-picked="rsample302"]');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'false');
    // its whole way out is on the map, and the sheet is not over it
    const way = await wayOnStage(page, 'rsample302');
    assert.equal(way.off, 0, 'Room 302\'s way out is not all on the map: ' + JSON.stringify(way));
    // the Door cards tab's controls take a finger too
    await page.tap('#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true');
    await page.tap('.sfy-inspector .tabs__tab[data-tab="cards"]');
    const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('.sfy-panel[data-panel="cards"] .btn:not([hidden]), .sfy-panel[data-panel="cards"] .sfy-row__show')).filter((el) => el.getClientRects().length > 0).map((el) => Math.min(el.getBoundingClientRect().height, el.getBoundingClientRect().width)));
    assert.ok(sizes.length > 13 && sizes.every((size) => size >= 44), 'a control under a finger is under 44 px: ' + JSON.stringify(sizes));
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// ---- SV2-67b: the focus, the colours past ten and under the badges' zoom,
// state gone stale while mounted, a draw waiting off the page, touch

const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el.tagName, id: el.id, cls: el.className, room: el.dataset.room || null, print: el.dataset.print || null };
});

async function apply(page, name, payload) {
  await page.evaluate(async (n, p) => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions[n], p);
  }, name, payload);
}

test('Show every room and Untick all hide themselves when pressed from the keyboard: the focus goes to the map and to the first box, never to the page', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample302'));
  await page.waitForFunction(() => !document.querySelector('[data-action="show-all"]').hidden);
  await page.focus('[data-action="show-all"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
  assert.equal((await active(page)).id, 'safety-plan', 'Show every room left the focus on ' + JSON.stringify(await active(page)));
  // two rooms ticked by the keyboard, then Untick all by the keyboard
  for (const id of ['rsample302', 'rsample101']) {
    await page.focus('.sfy-row[data-room="' + id + '"] .sfy-row__box');
    await page.keyboard.press('Space');
  }
  await page.waitForFunction(() => document.querySelector('.sfy-panel [data-print="chosen"]').dataset.count === '2');
  await page.focus('.sfy-panel [data-action="untick"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sfy-panel [data-print="chosen"]').dataset.count === '0');
  const first = await page.$eval('.sfy-row .sfy-row__box', (el) => el.dataset.room);
  const now = await active(page);
  assert.equal(now.cls, 'sfy-row__box', 'Untick all left the focus on ' + JSON.stringify(now));
  assert.equal(now.room, first, 'the focus is not on the list\'s first box');
});

test('a room whose row holds the focus is deleted: the focus goes to the row now in its place, in the Door cards list and in the Exits list', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  const order = await page.$$eval('.sfy-row', (rows) => rows.map((row) => row.dataset.room));
  const at = order.indexOf('rsample302');
  await page.focus('.sfy-row[data-room="rsample302"] .sfy-row__box');
  await apply(page, 'deleteSpaces', { spaceIds: ['rsample302'] });
  await page.waitForFunction(() => !document.querySelector('.sfy-row[data-room="rsample302"]'));
  let now = await active(page);
  assert.equal(now.cls, 'sfy-row__box', 'the focus went to ' + JSON.stringify(now));
  assert.equal(now.room, order[at + 1], 'the focus is not on the box of the row after Room 302');
  // the Exits tab: a room's button
  await page.click('.sfy-inspector .tabs__tab[data-tab="exits"]');
  const buttons = await page.$$eval('.sfy-exit .sfy-room', (list) => list.map((el) => el.dataset.room));
  const gone = buttons[buttons.length - 1];
  await page.focus('.sfy-exit .sfy-room[data-room="' + gone + '"]');
  await apply(page, 'deleteSpaces', { spaceIds: [gone] });
  await page.waitForFunction((id) => !document.querySelector('.sfy-room[data-room="' + id + '"]'), {}, gone);
  now = await active(page);
  assert.equal(now.cls, 'sfy-room', 'the focus went to ' + JSON.stringify(now));
  assert.equal(now.room, buttons[buttons.length - 2], 'the last room\'s button gone, the focus is not on the one before it');
});

test('the picked room deleted while mounted is said in the live region and every room is shown; a ticked room deleted is let go; the picked room renamed keeps its pick under its new name', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  for (const id of ['rsample302', 'rsample101']) await page.click('.sfy-row[data-room="' + id + '"] .sfy-row__box');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample302'));
  await page.waitForSelector('.sfy[data-picked="rsample302"]');
  await apply(page, 'deleteSpaces', { spaceIds: ['rsample302'] });
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'all');
  assert.equal(await page.$eval('#announcer', (el) => el.textContent), 'Room 302 is no longer in the building; showing every room.');
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.picked), null);
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.chosen), ['rsample101']);
  assert.equal(await seen(page, '.sfy-panel [data-print="chosen"]'), 'Print the 1 room ticked');
  assert.equal(await page.$eval('.sfy-panel [data-print="picked"]', (el) => el.hidden), true);
  assert.equal(await seen(page, '#safety-line .mov-line__words'), 'Every room’s way out, coloured by the exit it uses: 12 rooms to 2 exits.');
  // a ticked room deleted, not picked
  await apply(page, 'deleteSpaces', { spaceIds: ['rsample101'] });
  await page.waitForFunction(() => document.querySelector('.sfy-panel [data-print="chosen"]').dataset.count === '0');
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.chosen), []);
  // the picked room renamed: still picked, the line and the button under the name as typed
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample204'));
  await page.waitForSelector('.sfy[data-picked="rsample204"]');
  await apply(page, 'setRoomFields', { roomId: 'rsample204', number: '<b>Lab</b> 4' });
  await page.waitForFunction(() => document.getElementById('safety-line').textContent.includes('<b>Lab</b> 4'));
  const name = await page.evaluate(() => document.querySelector('.sfy').safety.picture.byRoom.get('rsample204').name);
  assert.ok(name.includes('<b>Lab</b> 4'), name);
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.picked), 'rsample204');
  assert.ok((await seen(page, '#safety-line .mov-line__words')).startsWith(name + ' on Floor 2: out by '));
  assert.equal(await seen(page, '.sfy-panel [data-print="picked"]'), 'Print the card for ' + name);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.sfy b, .sfy-inspector b').length), 0);
});

test('another project put in while the section is mounted lets go of the picked room and the ticks, though its rooms have the same ids', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  await page.click('.sfy-row[data-room="rsample101"] .sfy-row__box');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample204'));
  await page.waitForSelector('.sfy[data-picked="rsample204"]');
  const was = await page.evaluate(() => globalThis.sv2.store.project.id);
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    project.id = project.id + 'x';
    globalThis.sv2.store.replace(project);
  });
  await ready(page);
  assert.notEqual(await page.evaluate(() => globalThis.sv2.store.project.id), was);
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.picked), null, 'the pick of another project is kept');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.mode), 'all');
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.chosen), [], 'the ticks of another project are kept');
  assert.equal(await page.$eval('.sfy-row[data-room="rsample101"] .sfy-row__box', (el) => el.checked), false);
  assert.equal(await page.$eval('.sfy-panel [data-print="chosen"]', (el) => el.dataset.count), '0');
});

test('twelve exits: the key lists twelve numbers and says the colours repeat after eight, exit 9 in exit 1\'s colour', async () => {
  const page = wide.page;
  await fresh(page);
  assert.equal(await page.$eval('.sfy-key [data-note="repeat"]', (el) => el.hidden), true, 'with two exits the key says the colours repeat');
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const { isEdgeCorridorCell } = await import('./engine/schema.js');
    const project = sampleSchool();
    let n = project.building.floors.reduce((sum, floor) => sum + floor.exits.length, 0);
    for (const floor of project.building.floors) {
      const taken = new Set(floor.exits.map((exit) => exit.cell));
      for (let cell = 0; cell < floor.cells.length && n < 12; cell += 1) {
        if (taken.has(cell) || !isEdgeCorridorCell(floor, cell)) continue;
        n += 1;
        floor.exits.push({ id: 'xsafety' + String(n).padStart(3, '0'), cell, doorName: 'Door ' + n, assembly: '' });
      }
    }
    globalThis.sv2.store.replace(project);
  });
  await ready(page);
  await page.waitForFunction(() => document.querySelectorAll('.sfy-key__item').length === 12);
  const key = await page.$$eval('.sfy-key__item', (items) => items.map((item) => item.dataset.number + '|' + item.querySelector('.sfy-swatch').textContent));
  assert.deepEqual(key, Array.from({ length: 12 }, (_, i) => (i + 1) + '|' + (i + 1)));
  assert.equal(await seen(page, '.sfy-key [data-note="repeat"]'), 'The colours repeat after exit 8: the number on each room says which exit.');
  const colours = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    return Array.from({ length: 12 }, (_, i) => view.colour(i + 1));
  });
  assert.equal(colours[8], colours[0]);
  assert.equal(new Set(colours.slice(0, 8)).size, 8);
  // the key's swatch of exit 9 carries its number on exit 1's colour
  assert.equal(await page.$eval('.sfy-key__item[data-number="9"] .sfy-swatch', (el) => el.style.backgroundColor), await page.$eval('.sfy-key__item[data-number="1"] .sfy-swatch', (el) => el.style.backgroundColor));
});

test('a phone at Fit: the badges are under their least, and the key says zooming in shows the numbers; zoomed in to them, it says nothing of it', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  try {
    await ready(page);
    const fit = await page.evaluate(async () => {
      const { EXIT_KEY_LEAST } = await import('./ui/surface/overlays/evacuation.js');
      return { size: document.querySelector('.sfy').safety.plan.view.size, least: EXIT_KEY_LEAST };
    });
    assert.ok(fit.size < fit.least, 'at Fit a cell is ' + fit.size + ' px, not under the badges\' ' + fit.least + ': the case tests nothing');
    // the map painted at Fit (ready): the key has said it
    assert.equal(await page.$eval('.sfy-key [data-note="zoom"]', (el) => el.hidden), false, 'at Fit, with no badge drawn, the key does not say that zooming in shows the numbers');
    assert.equal(await page.$eval('.sfy-key [data-note="zoom"]', (el) => el.textContent), 'Zoom in to see each room’s exit number on the map.');
    // zoomed in from the keyboard until the badges are drawn
    await page.focus('#safety-plan');
    for (let i = 0; i < 12 && (await page.evaluate(() => document.querySelector('.sfy').safety.plan.view.size)) < fit.least; i += 1) await page.keyboard.press('=');
    assert.ok(await page.evaluate((least) => document.querySelector('.sfy').safety.plan.view.size >= least, fit.least), 'the map did not zoom to the badges');
    await page.waitForFunction(() => document.querySelector('.sfy-key [data-note="zoom"]').hidden);
    // back to Fit: said again
    await page.keyboard.press('0');
    await page.waitForFunction(() => !document.querySelector('.sfy-key [data-note="zoom"]').hidden);
    // with a room picked no badge is drawn at any zoom: nothing said of them
    await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample204'));
    await page.waitForFunction(() => document.querySelector('.sfy-key [data-note="zoom"]').hidden);
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

function touch(cdp, type, fingers) {
  return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers.map((finger) => ({ x: Math.round(finger.x), y: Math.round(finger.y), id: finger.id, radiusX: 4, radiusY: 4, force: 1 })) });
}

test('on a phone, one finger moving the map and two pinching it over rooms leave the picked room as it is; a tap picks', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  const cdp = await page.createCDPSession();
  const view = () => page.evaluate(() => {
    const v = document.querySelector('.sfy').safety.plan.view;
    return { x: v.x, y: v.y, zoom: v.zoom, picked: document.querySelector('.sfy').safety.picked };
  });
  try {
    await ready(page);
    const gym = await roomPoint(page, 'rsamplegym');
    await page.touchscreen.tap(gym.x, gym.y);
    await page.waitForSelector('.sfy[data-picked="rsamplegym"]');
    // one finger from the middle of Room 101, 60 px right and 40 down
    const from = await roomPoint(page, 'rsample101');
    let before = await view();
    await touch(cdp, 'touchStart', [{ ...from, id: 1 }]);
    for (let i = 1; i <= 6; i += 1) await touch(cdp, 'touchMove', [{ x: from.x + 10 * i, y: from.y + 7 * i, id: 1 }]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction((was) => document.querySelector('.sfy').safety.plan.view.x !== was, {}, before.x);
    let after = await view();
    assert.equal(after.picked, 'rsamplegym', 'a one-finger drag over Room 101 changed the pick');
    assert.equal(after.zoom, before.zoom, 'a one-finger drag changed the zoom');
    // two fingers about Room 102, drawn apart
    const mid = await roomPoint(page, 'rsample102');
    before = after;
    await touch(cdp, 'touchStart', [{ x: mid.x - 20, y: mid.y, id: 1 }]);
    await touch(cdp, 'touchStart', [{ x: mid.x - 20, y: mid.y, id: 1 }, { x: mid.x + 20, y: mid.y, id: 2 }]);
    for (const reach of [30, 40, 50, 60]) await touch(cdp, 'touchMove', [{ x: mid.x - reach, y: mid.y, id: 1 }, { x: mid.x + reach, y: mid.y, id: 2 }]);
    await touch(cdp, 'touchEnd', []);
    await page.waitForFunction((was) => document.querySelector('.sfy').safety.plan.view.zoom > was * 1.5, {}, before.zoom);
    after = await view();
    assert.equal(after.picked, 'rsamplegym', 'a pinch over Room 102 changed the pick');
    assert.equal(await page.$eval('.sfy', (el) => el.dataset.picked), 'rsamplegym');
    // and a tap on a room still picks it
    const room = await roomPoint(page, 'rsample102');
    await page.touchscreen.tap(room.x, room.y);
    await page.waitForSelector('.sfy[data-picked="rsample102"]');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await cdp.detach();
    await session.close();
  }
});

test('the section mounted off the page draws at once in the page\'s colours, asking for no frame; put on the page, it draws again', async () => {
  // SV2-72c item 7: the renderer no longer keeps a theme read off the page
  // (every token #888888), so Safety's wait for the page (SV2-67b, one frame
  // at a time) is gone
  const session = await openPlanner({ width: 1280, height: 800, hash: '#building', theme: 'light' });
  const page = session.page;
  try {
    await page.evaluate(async () => {
      globalThis.sfyModule = await import('./ui/safety/index.js');
    });
    // mounted and never put on the page: drawn already, its key in the theme's exit colours
    const first = await page.evaluate(() => {
      const ctx = { ...globalThis.sv2.ctx, setInspector() {} };
      globalThis.sfyOff = globalThis.sfyModule.section.mount(ctx);
      const el = globalThis.sfyOff.element;
      const tokens = getComputedStyle(document.documentElement);
      return {
        connected: el.isConnected,
        mode: el.dataset.mode,
        waiting: 'waiting' in el.safety,
        swatches: Array.from(el.querySelectorAll('.sfy-key .sfy-swatch')).map((swatch) => swatch.style.backgroundColor),
        tokens: [1, 2].map((n) => tokens.getPropertyValue('--exit-' + n).trim()),
        ink: el.safety.plan.theme().ink,
        pageInk: tokens.getPropertyValue('--ink').trim(),
      };
    });
    const rgb = (hex) => 'rgb(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
    assert.deepEqual({ connected: first.connected, mode: first.mode, waiting: first.waiting }, { connected: false, mode: 'all', waiting: false });
    assert.deepEqual(first.swatches, first.tokens.map(rgb), 'the key off the page is not in the theme\'s exit colours');
    assert.equal(first.ink, first.pageInk, 'the map\'s theme read off the page is not the page\'s');
    await page.evaluate(() => globalThis.sfyOff.unmount());
    // a second one put on the page, in a dark island, reads the island's colours: nothing read off the page was kept
    const dark = await page.evaluate(() => {
      const ctx = { ...globalThis.sv2.ctx, setInspector() {} };
      globalThis.sfyOn = globalThis.sfyModule.section.mount(ctx);
      const before = globalThis.sfyOn.element.safety.plan.theme().corridor;
      const box = document.createElement('div');
      box.id = 'sfy-off-test';
      box.dataset.theme = 'dark';
      box.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:500px;visibility:hidden';
      box.append(globalThis.sfyOn.element);
      document.body.append(box);
      return { before, after: globalThis.sfyOn.element.safety.plan.theme().corridor, island: getComputedStyle(box).getPropertyValue('--corridor').trim() };
    });
    assert.notEqual(dark.before, dark.island, 'the page and the island have the same corridor: the case tests nothing');
    assert.equal(dark.after, dark.island, 'the theme read off the page was kept once the map was on it');
    await page.waitForFunction(() => globalThis.sfyOn.element.dataset.mode === 'all' && Number(document.querySelector('#sfy-off-test canvas.mov-plan').dataset.drawn || 0) > 0);
    await page.evaluate(() => {
      globalThis.sfyOn.unmount();
      document.getElementById('sfy-off-test').remove();
    });
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

// The section's whole picture on the 3.13 fixture in Chromium on huginn
// (SV2-67b, 2026-10-19): 72 to 118 ms over 13 runs of this file, so a
// budget of 150 ms, failing at 300.
const PICTURE_BUDGET = 150;

test('evacuationRoutes on the 3.13 fixture (4 floors of 60 by 40, 150 rooms) in this browser, once', async () => {
  const page = wide.page;
  const ms = await page.evaluate(async () => {
    const { bigProject } = await import('./test/fixtures/big.mjs');
    const { buildGraph } = await import('./engine/graph.js');
    const { routingGraph } = await import('./engine/routing.js');
    const { evacuationRoutes } = await import('./engine/evacuation.js');
    const project = bigProject({ seed: 1 });
    const started = performance.now();
    const graph = routingGraph(project, buildGraph(project));
    const evacuation = evacuationRoutes(project, graph);
    const routes = performance.now() - started;
    if (evacuation.rooms.length !== 150) throw new Error('the fixture has ' + evacuation.rooms.length + ' rooms');
    // and the section's whole picture: the routes, the exits, a card's first step for every room
    const { safetyPicture } = await import('./ui/safety/model.js');
    const again = performance.now();
    safetyPicture(project, buildGraph(project));
    return { routes, picture: performance.now() - again };
  });
  console.log('# evacuationRoutes on the 3.13 fixture in Chromium: ' + ms.routes.toFixed(1) + ' ms with the graph; the section\'s whole picture ' + ms.picture.toFixed(1) + ' ms');
  // the timing suite's budget for routes, cards and all is 300 ms, failing at twice that
  assert.ok(ms.routes < 600, 'evacuationRoutes took ' + ms.routes + ' ms');
  // the section's picture, which the page works out once a state of the
  // building: PICTURE_BUDGET measured here, failing at twice it
  assert.ok(ms.picture < PICTURE_BUDGET * 2, 'the section\'s picture took ' + ms.picture.toFixed(1) + ' ms, over twice its budget of ' + PICTURE_BUDGET + ' ms');
});
