// The scenario lab's difference map in a real browser (spec 9.2; DESIGN 5.4;
// ARCHITECTURE 6.6 "The difference map"): node test/browser/difference.mjs
//
// A scenario on the sample school moves 7A out of the Library for Period 3:
// over the day the Main Corridor on Floor 1 gets busier and the stairs and
// their landings quieter. The map paints both (read from the overlay's
// picture, and one pixel a tint); the card by pointer, by a tap with touch,
// and at the keyboard cursor; the transition and the day type chosen in the
// comparison change the picture; the table of the ten largest changes is
// the overlay's; a change of theme paints again; with no answer nothing is
// painted; typed names show as typed; no page errors.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPlanner, launch, startServer, TOOL_DIR } from './harness.mjs';

const { mix } = await import(pathToFileURL(path.join(TOOL_DIR, 'ui', 'colour.js')).href);
const { DIFFERENCE_ALPHA } = await import(pathToFileURL(path.join(TOOL_DIR, 'ui', 'surface', 'overlays', 'difference.js')).href);

const MOVE = { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07a', period: 2, roomId: 'rsample101' };
const HOSTILE = '<img src=x onerror="window.__hit=1">&amp; "7A"';
const ARABIC = 'الممر الرئيسي';

let browser;
let server;
let wide;

before(async () => {
  server = await startServer();
  browser = await launch();
  wide = await openPlanner({ browser, server, width: 1280, height: 800, hash: '#scenarios', theme: 'light' });
});

after(async () => {
  if (wide) await wide.close();
  if (browser) await browser.close();
  if (server) await server.close();
});

// The difference painted for the store as it is: the lab's answer is the
// newest, the picture is made from it, and the map painted that picture.
async function painted(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || !el.difference || el.dataset.difference !== 'shown' || el.scenarios.pending) return false;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    return el.difference.answer === el.scenarios.answer && el.difference.painted.made === el.dataset.differenceMade;
  }, { timeout: 30000 });
}

// The sample school with nothing open, then a scenario of these changes, painted.
async function open(page, changes, name) {
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.querySelector('.scn') && document.querySelector('.scn').dataset.styled === 'true', { timeout: 20000 });
  await page.evaluate(async (list, title) => {
    const { newScenario, addScenarioChange, discardScenario } = await import(new URL('engine/actions.js', location.href).href);
    const { sampleSchool } = await import(new URL('data/sample-school.js', location.href).href);
    const store = globalThis.sv2.store;
    // the lab's choices back to every day type and the whole day
    const memory = document.querySelector('.scn').scenarios.memory;
    memory.dayTypeId = null;
    memory.transition = null;
    store.replace(sampleSchool());
    if (store.project.scenario) store.apply(discardScenario, {});
    store.apply(newScenario, { name: title });
    for (const change of list) store.apply(addScenarioChange, { change });
  }, changes, name || 'Library move');
  await painted(page);
}

function state(page) {
  return page.evaluate(() => {
    const s = document.querySelector('.scn').difference.state();
    return { ...s, answer: undefined };
  });
}

// choose in the comparison's own controls, as a reader does
async function choose(page, id, value) {
  const before = await page.$eval('.scn', (el) => el.dataset.differenceMade);
  await page.select('#' + id, value);
  await page.waitForFunction((made) => document.querySelector('.scn').dataset.differenceMade !== made, {}, before);
  await painted(page);
}

// where a cell is on the page: the map moved to bring it to the middle and
// painted again, then the cell's middle in the page
async function where(page, floorId, cell) {
  const drawn = await page.evaluate((f, c) => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const was = Number(document.getElementById('scenarios-plan').dataset.drawn || 0);
    plan.show(f, [c]);
    plan.paint();
    return was;
  }, floorId, cell);
  await page.waitForFunction((was) => Number(document.getElementById('scenarios-plan').dataset.drawn || 0) > was, {}, drawn);
  return page.evaluate((f, c) => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const box = document.getElementById('scenarios-plan').getBoundingClientRect();
    const middle = plan.cellAt(f, c);
    return middle ? { x: box.left + middle.x, y: box.top + middle.y, size: plan.view.size } : null;
  }, floorId, cell);
}

// one pixel of the map's canvas, near a cell's top left inside its tint
// (away from a corridor's name, drawn along its middle)
async function pixelAt(page, floorId, cell) {
  return page.evaluate((f, c) => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const canvas = document.getElementById('scenarios-plan');
    const ratio = window.devicePixelRatio || 1;
    const size = plan.view.size;
    const middle = plan.cellAt(f, c);
    const inset = Math.max(1, Math.round(size * 0.08));
    const x = Math.round((middle.x - size / 2 + inset + 2) * ratio);
    const y = Math.round((middle.y - size / 2 + inset + 2) * ratio);
    const [r, g, b] = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return { r, g, b, theme: plan.theme() };
  }, floorId, cell);
}

function close(pixel, hex, said) {
  const want = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  const off = Math.max(Math.abs(pixel.r - want.r), Math.abs(pixel.g - want.g), Math.abs(pixel.b - want.b));
  assert.ok(off <= 4, said + ': the pixel is rgb(' + pixel.r + ', ' + pixel.g + ', ' + pixel.b + '), the tint ' + hex + ' (' + off + ' off)');
}

const strongest = (cells) => cells.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.node - b.node)[0];

// the card as it is on screen
function cardNow(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-card="difference"]');
    const part = (name) => card.querySelector('[data-part="' + name + '"]');
    const shownText = (el) => (el && !el.hidden && el.getClientRects().length > 0 ? el.textContent : null);
    return {
      shown: !card.hidden && card.getClientRects().length > 0,
      floor: card.dataset.floor,
      cell: Number(card.dataset.cell),
      change: shownText(part('change')),
      sides: shownText(part('sides')),
      onlyBefore: shownText(part('only-before')),
      onlyAfter: shownText(part('only-after')),
      groups: Array.from(card.querySelectorAll('bdi[data-group]')).map((el) => el.textContent),
    };
  });
}

test('corridors busier and stairs quieter: the map paints both, in their tints at their strengths, and a cell with no change not at all', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  const s = await state(page);
  assert.equal(s.state, 'shown');
  assert.equal(s.transition, null);
  assert.equal(s.largest, 27);
  assert.ok(s.busier.length > 0, 'something busier');
  assert.ok(s.quieter.length > 0, 'something quieter');
  // the largest change is on Floor 1's Main Corridor, which 7A walks from Room 101
  assert.equal(s.top[0].placeId, 'ksample001');
  assert.equal(s.top[0].delta, 27);
  assert.equal(strongest(s.busier).strength, 5);
  for (const each of [...s.busier, ...s.quieter]) assert.ok(each.strength >= 1 && each.strength <= 5);
  // one pixel a tint, in the light theme, at the strongest corridor cell of
  // each (a stairs cell's tint lies on the stairs' colour): busier over the
  // day, quieter in Period 3 to Period 4, when 7A no longer leaves the Library
  await page.mouse.move(1, 1);
  const corridorOnly = (cells) => page.evaluate((list) => {
    const graph = document.querySelector('.scn').scenarios.plan.graph;
    return list.filter((each) => graph.stairs[each.node] === 0);
  }, cells);
  const hot = strongest(await corridorOnly(s.busier));
  await where(page, hot.floorId, hot.cell);
  await painted(page);
  const red = await pixelAt(page, hot.floorId, hot.cell);
  close(red, mix(red.theme.problem, red.theme.corridor, DIFFERENCE_ALPHA[hot.strength - 1]), 'busier at strength ' + hot.strength);
  await choose(page, 'scenario-compare-when', '2');
  const cool = strongest(await corridorOnly((await state(page)).quieter));
  assert.equal(cool.strength, 5);
  await where(page, cool.floorId, cool.cell);
  await painted(page);
  const green = await pixelAt(page, cool.floorId, cool.cell);
  close(green, mix(green.theme.accent, green.theme.corridor, DIFFERENCE_ALPHA[cool.strength - 1]), 'quieter at strength ' + cool.strength);
  await choose(page, 'scenario-compare-when', '');
  // a corridor cell with no change is the corridor's own colour
  const plain = await page.evaluate(() => {
    const el = document.querySelector('.scn');
    const graph = el.scenarios.plan.graph;
    const d = el.difference.difference;
    const f = graph.floorIndex.get('fsample003');
    for (let node = graph.floors[f].offset; node < graph.floors[f].offset + graph.floors[f].count; node += 1) {
      if (d.cells[node] === 0 && graph.stairs && !graph.stairs[node]) return { floorId: 'fsample003', cell: graph.nodeCell[node] };
    }
    for (let node = graph.floors[f].offset; node < graph.floors[f].offset + graph.floors[f].count; node += 1) if (d.cells[node] === 0) return { floorId: 'fsample003', cell: graph.nodeCell[node] };
    return null;
  });
  assert.ok(plain, 'a cell with no change on Floor 3');
  await where(page, plain.floorId, plain.cell);
  await painted(page);
  const unpainted = await pixelAt(page, plain.floorId, plain.cell);
  close(unpainted, unpainted.theme.corridor, 'a cell with no change');
});

test('the card by pointer: the place, the change in words, before and after, and the group that walks there only after', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  const s = await state(page);
  const hot = strongest(s.busier);
  const at = await where(page, hot.floorId, hot.cell);
  await painted(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction((cell) => {
    const card = document.querySelector('[data-card="difference"]');
    return !card.hidden && card.dataset.cell === String(cell);
  }, {}, hot.cell);
  const card = await cardNow(page);
  assert.ok(card.shown);
  assert.equal(card.floor, hot.floorId);
  assert.equal(card.change, hot.delta + ' busier');
  assert.match(card.sides, /^Before \d+, after \d+ students, at its busiest in one transition, on A Day\.$/);
  const [, was, now] = card.sides.match(/Before (\d+), after (\d+)/).map(Number);
  assert.equal(now - was, hot.delta);
  assert.equal(card.onlyAfter, 'Walk here only after: 7A');
  assert.equal(card.onlyBefore, null);
  // the pointer leaves the map: the card goes
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.querySelector('[data-card="difference"]').hidden);
  // a quieter cell's card in Period 3 to Period 4, when 7A left the Library
  // before and leaves Room 101 after: the group walked there only before
  await choose(page, 'scenario-compare-when', '2');
  const cool = strongest((await state(page)).quieter);
  const there = await where(page, cool.floorId, cool.cell);
  await painted(page);
  await page.mouse.move(there.x, there.y);
  await page.waitForFunction((cell) => document.querySelector('[data-card="difference"]').dataset.cell === String(cell) && !document.querySelector('[data-card="difference"]').hidden, {}, cool.cell);
  const quiet = await cardNow(page);
  assert.equal(quiet.change, Math.abs(cool.delta) + ' quieter');
  assert.equal(quiet.onlyBefore, 'Walk here only before: 7A');
  assert.equal(quiet.onlyAfter, null);
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.querySelector('[data-card="difference"]').hidden);
  await choose(page, 'scenario-compare-when', '');
});

test('the card at the keyboard cursor: said in the live region, after the lab\'s own line; Escape puts it away', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  const s = await state(page);
  const hot = strongest(s.busier);
  await where(page, hot.floorId, hot.cell);
  await painted(page);
  await page.evaluate(async (f, c) => {
    const { placeOf } = await import(new URL('ui/surface/plan-layout.js', location.href).href);
    const plan = document.querySelector('.scn').scenarios.plan;
    const p = placeOf(plan.world, f, c);
    plan.focus();
    plan.cursor.moveTo(p.x - 1, p.y, true);
  }, hot.floorId, hot.cell);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((cell) => {
    const card = document.querySelector('[data-card="difference"]');
    return !card.hidden && card.dataset.cell === String(cell) && /busier/.test(document.getElementById('announcer').textContent);
  }, {}, hot.cell);
  const said = await page.$eval('#announcer', (el) => el.textContent);
  assert.match(said, new RegExp(': ' + hot.delta + ' busier\\. Before \\d+, after \\d+ students, at its busiest in one transition, on A Day\\. Walk here only after: 7A\\.$'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'scenarios-plan');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-card="difference"]').hidden);
});

test('the card by a tap with touch on a phone: a tap shows it and keeps it, a second tap on the cell puts it away', async () => {
  const phone = await openPlanner({ server, width: 390, height: 844, mobile: true, hash: '#scenarios', theme: 'light' });
  try {
    const page = phone.page;
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches), true, 'a touch screen');
    await open(page, [MOVE]);
    const s = await state(page);
    const hot = strongest(s.busier);
    // zoomed in, so the cell is big enough for a finger
    await page.evaluate(() => {
      const plan = document.querySelector('.scn').scenarios.plan;
      plan.view.zoom = Math.min(3, plan.view.zoom * 3);
    });
    const at = await where(page, hot.floorId, hot.cell);
    await painted(page);
    assert.ok(at.size >= 10, 'the cell is ' + at.size + ' px');
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForFunction((cell) => {
      const card = document.querySelector('[data-card="difference"]');
      return !card.hidden && card.dataset.cell === String(cell);
    }, {}, hot.cell);
    const card = await cardNow(page);
    assert.equal(card.change, hot.delta + ' busier');
    assert.equal(card.onlyAfter, 'Walk here only after: 7A');
    // the card is on the stage, inside the window
    const box = await page.$eval('[data-card="difference"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    assert.ok(box.left >= 0 && box.right <= 390, JSON.stringify(box));
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForFunction(() => document.querySelector('[data-card="difference"]').hidden);
    assert.deepEqual(phone.problems().errors, []);
  } finally {
    await phone.close();
  }
});

test('the transition and the day type chosen in the comparison change the picture, with no second control', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  // the lab's controls are the only ones: nothing of the difference map's own
  assert.equal(await page.$$eval('.scn select', (els) => els.filter((el) => el.closest('[data-part="difference"]')).length), 0);
  const counts = async () => {
    const s = await state(page);
    return { transition: s.transition, busier: s.busier.length, quieter: s.quieter.length };
  };
  await choose(page, 'scenario-compare-when', '1');
  assert.deepEqual(await counts(), { transition: 1, busier: 31, quieter: 0 });
  await choose(page, 'scenario-compare-when', '2');
  assert.deepEqual(await counts(), { transition: 2, busier: 6, quieter: 25 });
  assert.match(await page.$eval('#scenario-difference-title', (el) => el.textContent), /in Period 3 to Period 4$/);
  // the card says the transition
  const s = await state(page);
  const cool = strongest(s.quieter);
  const at = await where(page, cool.floorId, cool.cell);
  await painted(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => !document.querySelector('[data-card="difference"]').hidden);
  assert.match((await cardNow(page)).sides, /, in Period 3 to Period 4, on A Day\.$/);
  await page.mouse.move(1, 1);
  // B Day: the move is on A Day, so nothing changes, and the table says so
  await choose(page, 'scenario-compare-day', 'dsample00b');
  assert.deepEqual(await counts(), { transition: 2, busier: 0, quieter: 0 });
  assert.equal(await page.$eval('[data-part="difference-note"]', (el) => el.textContent), 'No corridor gets busier or quieter in this transition.');
  assert.equal(await page.$$eval('[data-part="difference-table"] tbody tr', (rows) => rows.length), 0);
  // back to every day type and the whole day
  await choose(page, 'scenario-compare-day', '');
  await choose(page, 'scenario-compare-when', '');
  assert.deepEqual(await counts(), { transition: null, busier: 14, quieter: 2 });
});

test('the text alternative: the table of the ten largest changes is the overlay\'s, in words, beside the map', async () => {
  const page = wide.page;
  await open(page, [MOVE, { kind: 'swapPeriods', dayTypeId: 'dsample00b', groupId: 'gsample06a', periodA: 0, periodB: 3 }]);
  const s = await state(page);
  const rows = await page.$$eval('[data-part="difference-table"] tbody tr', (els) => els.map((tr) => ({
    placeId: tr.dataset.place,
    delta: Number(tr.dataset.delta),
    boxed: tr.getClientRects().length > 0,
    cells: Array.from(tr.children).map((cell) => cell.textContent),
  })));
  assert.ok(rows.length > 0 && rows.length <= 10);
  assert.deepEqual(rows.map((row) => [row.placeId, row.delta]), s.top.map((row) => [row.placeId, row.delta]));
  assert.ok(rows.every((row) => row.boxed), 'every row is on screen in the inspector');
  // largest first, and the first is the map's largest change
  assert.equal(Math.abs(rows[0].delta), s.largest);
  for (let i = 1; i < rows.length; i += 1) assert.ok(Math.abs(rows[i].delta) <= Math.abs(rows[i - 1].delta));
  for (const [i, row] of rows.entries()) {
    const top = s.top[i];
    assert.equal(row.cells[2], String(top.before));
    assert.equal(row.cells[3], String(top.after));
    assert.equal(row.cells[4], row.delta > 0 ? row.delta + ' busier' : Math.abs(row.delta) + ' quieter');
    assert.ok(row.cells[1].length > 0, 'a floor');
  }
  // the key says it in words too
  assert.match(await page.$eval('[data-part="difference-key"]', (el) => el.textContent), /^On the map: busier, quieter\. The stronger the colour, the larger the change; the largest is \d+ students\./);
  // the table sits in the inspector beside the comparison, under the map's own heading
  assert.equal(await page.$eval('[data-part="difference"]', (el) => Boolean(el.closest('.scn-inspector'))), true);
});

test('a change of theme paints again in the theme\'s tints', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  const s = await state(page);
  const hot = strongest(s.busier);
  await where(page, hot.floorId, hot.cell);
  await painted(page);
  const light = await page.evaluate(() => document.querySelector('.scn').difference.painted.theme);
  await page.evaluate(async () => {
    const { setSetting } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(setSetting, { key: 'theme', value: 'dark' });
  });
  await page.waitForFunction((was) => document.documentElement.dataset.theme === 'dark' && document.querySelector('.scn').difference.painted.theme !== was, {}, light);
  try {
    const pixel = await pixelAt(page, hot.floorId, hot.cell);
    assert.equal(pixel.theme.corridor, '#2a2f36');
    close(pixel, mix(pixel.theme.problem, pixel.theme.corridor, DIFFERENCE_ALPHA[hot.strength - 1]), 'dark: problem at strength ' + hot.strength);
    // the key's swatches follow the tokens
    const swatch = await page.$eval('[data-part="difference-key"] .mov-swatch', (el) => getComputedStyle(el).backgroundColor);
    assert.ok(swatch !== 'rgba(0, 0, 0, 0)', swatch);
  } finally {
    await page.evaluate(async () => {
      const { setSetting } = await import(new URL('engine/actions.js', location.href).href);
      globalThis.sv2.store.apply(setSetting, { key: 'theme', value: 'auto' });
    });
  }
});

test('with no answer nothing is painted: the scenario discarded, the table hidden, the overlay drawing nothing on the next paint', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  await page.evaluate(async () => {
    const { discardScenario } = await import(new URL('engine/actions.js', location.href).href);
    globalThis.sv2.store.apply(discardScenario, {});
  });
  await page.waitForFunction(() => document.querySelector('.scn').dataset.difference === 'none');
  const s = await state(page);
  assert.deepEqual([s.busier.length, s.quieter.length, s.top.length], [0, 0, 0]);
  assert.equal(await page.$eval('[data-part="difference"]', (el) => el.hidden), true);
  const made = await page.$eval('.scn', (el) => el.dataset.differenceMade);
  // the map paints again and the overlay draws nothing
  const count = await page.evaluate(() => document.querySelector('.scn').difference.painted.count);
  const drawn = await page.evaluate(() => {
    const was = Number(document.getElementById('scenarios-plan').dataset.drawn || 0);
    document.querySelector('.scn').scenarios.plan.paint();
    return was;
  });
  await page.waitForFunction((was) => Number(document.getElementById('scenarios-plan').dataset.drawn || 0) > was, {}, drawn);
  assert.equal(await page.evaluate(() => document.querySelector('.scn').difference.painted.count), count);
  assert.equal(await page.$eval('.scn', (el) => el.dataset.differenceMade), made);
});

test('typed names show as typed: a group and a corridor renamed with markup and Arabic, in the card and the table', async () => {
  const page = wide.page;
  await open(page, [MOVE]);
  await page.evaluate(async (hostile, arabic) => {
    const { editGroup, renameCorridor } = await import(new URL('engine/actions.js', location.href).href);
    const store = globalThis.sv2.store;
    store.apply(editGroup, { id: 'gsample07a', name: hostile });
    store.apply(renameCorridor, { floorId: 'fsample001', corridorId: 'ksample001', name: arabic });
  }, HOSTILE, ARABIC);
  await painted(page);
  const s = await state(page);
  const hot = strongest(s.busier);
  const at = await where(page, hot.floorId, hot.cell);
  await painted(page);
  await page.mouse.move(at.x, at.y);
  await page.waitForFunction(() => !document.querySelector('[data-card="difference"]').hidden);
  const card = await cardNow(page);
  assert.deepEqual(card.groups, [HOSTILE]);
  assert.equal(card.onlyAfter, 'Walk here only after: ' + HOSTILE);
  const place = await page.$eval('[data-card="difference"] .mov-card__place', (el) => el.textContent);
  assert.ok(place.startsWith(ARABIC), place);
  const first = await page.$eval('[data-part="difference-table"] tbody tr th', (el) => el.textContent);
  assert.ok(first.startsWith(ARABIC), first);
  assert.equal(await page.evaluate(() => window.__hit), undefined, 'the markup in a name ran');
  assert.equal(await page.$$eval('.scn img[src="x"]', (els) => els.length), 0);
  await page.mouse.move(1, 1);
});

test('no page errors on the wide page', () => {
  assert.deepEqual(wide.problems().errors, []);
});
