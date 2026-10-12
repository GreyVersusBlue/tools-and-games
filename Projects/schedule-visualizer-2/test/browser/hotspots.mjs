// The movement view's inspector, in a real browser: node test/browser/hotspots.mjs
//
// Opens the sample school's movement view and works the three tabs SV2-18
// built the way a person does: reads the first hotspot row, opens it to its
// cells, clicks it and sees the map move and the place outlined; watches the
// rings on the top places pulse and, under reduced motion, stand still; reads
// the travel-time tables; saves each CSV and the picture; opens both prints.
// What is checked is what is on the screen and in the files.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner } from './harness.mjs';

let session;
let page;
const dialogs = [];

const ACCENT = [0x0f, 0x6e, 0x66];
const text = (selector) => page.$eval(selector, (el) => el.textContent);
const view = (fn, ...args) => page.evaluate(fn, ...args);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The view has the answer for the project as it is now, and has drawn it.
async function settled() {
  await page.waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 15000 });
  await frames();
}

function frames() {
  return view(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function change(patch) {
  await view((next) => document.querySelector('.mov').movement.change(next), patch);
  await settled();
}

async function tab(id) {
  await page.click('#inspector [role="tab"][data-tab="' + id + '"]');
  await page.waitForSelector('#inspector [data-panel="' + id + '"]');
}

const OPEN = { who: 'all', groupIds: [], dayTypeId: 'dsample00a', transition: null, measure: 'busiest', floors: 'auto', labels: true, constantWidth: false };

// The colour of one pixel of the map, as [r, g, b].
function pixel(x, y) {
  return view((px, py) => {
    const canvas = document.querySelector('#movement-plan');
    const ratio = canvas.width / canvas.clientWidth;
    return Array.from(canvas.getContext('2d').getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data.slice(0, 3));
  }, x, y);
}

function near(a, b, slack) {
  return a.every((value, index) => Math.abs(value - b[index]) <= (slack === undefined ? 12 : slack));
}

// Where the map is: its zoom and its place in the window.
function where() {
  return view(() => {
    const movement = document.querySelector('.mov').movement;
    return { zoom: movement.view.zoom, x: Math.round(movement.view.x * 100) / 100, y: Math.round(movement.view.y * 100) / 100, floors: movement.world.slots.map((slot) => slot.floor.id) };
  });
}

// The hotspot rows as the table shows them.
function shownRows() {
  return page.$$eval('#inspector .mov-hot__row', (all) => all.map((row) => ({
    place: row.dataset.place,
    rank: Number(row.dataset.rank),
    load: Number(row.dataset.load),
    band: Number(row.dataset.band),
    kind: row.dataset.kind,
    name: row.querySelector('[data-action="show"]').textContent,
    floor: (row.querySelector('.mov-hot__floor') || { textContent: '' }).textContent,
    when: (row.querySelector('.mov-hot__when') || { textContent: '' }).textContent,
    groups: row.querySelector('.mov-hot__groups').textContent,
    shownLoad: row.querySelector('.mov-hot__load').textContent,
    delay: row.cells[2].textContent,
    current: row.getAttribute('aria-current'),
  })));
}

// Take what the Export tab would have downloaded.
async function delivered(action) {
  await view(() => {
    globalThis.sv2test = { files: [] };
    document.querySelector('#inspector [data-panel="export"]').exports.hooks.deliver = (file) => globalThis.sv2test.files.push(file);
  });
  await page.click('#inspector [data-action="' + action + '"]');
  await page.waitForFunction(() => globalThis.sv2test.files.length > 0);
  return view(async () => {
    const file = globalThis.sv2test.files[0];
    document.querySelector('#inspector [data-panel="export"]').exports.hooks.deliver = null;
    const head = file.blob ? Array.from(new Uint8Array(await file.blob.arrayBuffer()).slice(0, 8)) : null;
    return { fileName: file.fileName, mime: file.mime, text: file.text || null, type: file.blob ? file.blob.type : null, size: file.blob ? file.blob.size : null, head, width: file.width, height: file.height };
  });
}

async function closePreview() {
  await page.click('#print-preview [data-action="close"]');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
}

before(async () => {
  session = await openPlanner({ hash: '#movement', theme: 'light', width: 1440, height: 900 });
  page = session.page;
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });
  await settled();
});

after(async () => {
  if (session) await session.close();
});

// ---------------------------------------------------------------- hotspots

test('the inspector opens on Hotspots, and the first row is the busiest place of the school', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.equal(await text('#inspector [role="tab"][aria-selected="true"]'), 'Hotspots');
  assert.equal(await text('#inspector [data-hotspots="lead"]'), 'The 10 places anyone crosses, busiest first: every group on A Day, each place at its busiest moment. Choose a place to see it on the map.');
  const rows = await shownRows();
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].load >= row.load), 'busiest first: ' + rows.map((row) => row.load).join(' '));
  const first = rows[0];
  assert.equal(first.name, 'Main Corridor, by Door B');
  assert.equal(first.load, 177);
  assert.equal(first.shownLoad, '177');
  assert.equal(await text('#inspector .mov-hot__table thead th:nth-child(2)'), 'Students', 'the unit is the column\'s heading');
  assert.equal(first.band, 5);
  assert.equal(first.when, 'Peaks in Period 4 to Period 5');
  assert.equal(first.groups, '8 groups: 8A, 7A, 6B, 7B, 8B, 6A, 6C, 7C');
  assert.equal(first.delay, '13 s');
  assert.equal(first.current, null, 'nothing is chosen until a row is');
  // the figure the Summary gives for the busiest load is this row's
  const busiest = await view(() => document.querySelector('.mov').movement.picture.busiest.load);
  assert.equal(first.load, busiest);
  // a name two places share has its floor beside it
  const west = rows.filter((row) => row.name === 'West');
  assert.deepEqual(west.map((row) => row.floor).sort(), [' on Floor 1', ' on Floor 2']);
  assert.match(await text('#inspector [data-hotspots="notes"]'), /1 exclusion zone is left out of this table\.$/);
});

test('a row opens to its cells, busiest first, and that alone does not move the map', async () => {
  const at = await where();
  const more = '#inspector .mov-hot__row[data-rank="1"] [data-action="cells"]';
  assert.equal(await text(more), 'Show its 39 cells');
  assert.equal(await page.$eval(more, (el) => el.getAttribute('aria-expanded')), 'false');
  await page.click(more);
  assert.equal(await page.$eval(more, (el) => el.getAttribute('aria-expanded')), 'true');
  assert.equal(await text(more), 'Hide its 39 cells');
  const list = await page.$eval(more, (el) => {
    const row = document.getElementById(el.getAttribute('aria-controls'));
    return { hidden: row.hidden, cells: Array.from(row.querySelectorAll('li')).map((li) => ({ load: Number(li.dataset.load), words: li.textContent })) };
  });
  assert.equal(list.hidden, false);
  assert.equal(list.cells.length, 39);
  assert.equal(list.cells[0].load, 177, 'the busiest cell first');
  assert.match(list.cells[0].words, /^Column \d+, row \d+: 177$/);
  assert.ok(list.cells.every((cell, index) => index === 0 || list.cells[index - 1].load >= cell.load));
  assert.ok(list.cells.some((cell) => cell.words.endsWith(', left out of the scale')), 'the cells in the exclusion zone say so');
  assert.deepEqual(await where(), at, 'opening a row is not choosing it');
  assert.equal(await page.$eval('#inspector .mov-hot__row[data-rank="1"]', (el) => el.getAttribute('aria-current')), null);
  // a stairs connection has no cells to open
  assert.equal(await page.$eval('#inspector .mov-hot__row[data-kind="connection"]', (el) => el.querySelector('[data-action="cells"]')), null);
});

test('a click on a row moves the map to the place and outlines it', async () => {
  const before = await where();
  // the row itself, not its button: the whole row answers
  await page.click('#inspector .mov-hot__row[data-rank="2"] .mov-hot__groups');
  await frames();
  const after = await where();
  assert.ok(after.x !== before.x || after.y !== before.y, 'the map moved: ' + JSON.stringify(before) + ' → ' + JSON.stringify(after));
  assert.equal(after.zoom, before.zoom, 'at the zoom it had');
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const panel = document.querySelector('#inspector [data-panel="hotspots"]').hotspots;
    const row = panel.rows.find((each) => each.rank === 2);
    const points = row.ends.map((end) => movement.cellAt(end.floorId, end.cell));
    const floor = movement.state.project.building.floors.find((each) => each.id === row.place.floorId);
    // the cell at the place's left end, for its outline
    const leftmost = row.place.cells.reduce((a, b) => ((b % floor.width) < (a % floor.width) ? b : a));
    return {
      selected: panel.selected,
      place: row.id,
      name: row.place.name,
      middle: { x: points.reduce((sum, at) => sum + at.x, 0) / points.length, y: points.reduce((sum, at) => sum + at.y, 0) / points.length },
      window: { width: movement.view.width, height: movement.view.height },
      size: movement.view.size,
      left: movement.cellAt(row.place.floorId, leftmost),
      said: document.getElementById('announcer').textContent,
    };
  });
  assert.equal(seen.name, 'Upper Corridor');
  assert.equal(seen.selected, seen.place);
  assert.ok(Math.abs(seen.middle.x - seen.window.width / 2) < 1 && Math.abs(seen.middle.y - seen.window.height / 2) < 1, 'the place is in the middle of the window: ' + JSON.stringify(seen.middle));
  assert.equal(seen.said, 'The map moved to Upper Corridor.');
  assert.equal(await page.$eval('#inspector .mov-hot__row[data-rank="2"]', (el) => el.getAttribute('aria-current')), 'true');
  assert.equal(await page.$eval('#inspector .mov-hot__row[data-rank="1"]', (el) => el.getAttribute('aria-current')), null);
  // the outline: the accent, along the outer edge of the place's leftmost cell
  // read close up, where the line is whole pixels wide
  const close = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const row = document.querySelector('#inspector [data-panel="hotspots"]').hotspots.rows.find((each) => each.rank === 2);
    const floor = movement.state.project.building.floors.find((each) => each.id === row.place.floorId);
    const leftmost = row.place.cells.reduce((a, b) => ((b % floor.width) < (a % floor.width) ? b : a));
    movement.env.show(floor.id, [leftmost]);
    movement.view.zoomAbout(2, movement.view.width / 2, movement.view.height / 2);
    movement.env.paint();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ at: movement.cellAt(floor.id, leftmost), size: movement.view.size }))));
  });
  const edge = await pixel(close.at.x - close.size / 2, close.at.y + close.size / 4);
  await view(() => document.querySelector('.mov').movement.fit());
  await frames();
  assert.ok(near(edge, ACCENT, 40), 'the left edge of the place is outlined in the accent: ' + edge);
  // the name is a button, for the keyboard: it does the same for another row
  await page.focus('#inspector .mov-hot__row[data-rank="1"] [data-action="show"]');
  await page.keyboard.press('Enter');
  await frames();
  assert.equal(await view(() => document.querySelector('#inspector [data-panel="hotspots"]').hotspots.selected), await page.$eval('#inspector .mov-hot__row[data-rank="1"]', (el) => el.dataset.place));
  // and a cell of the open list brings that one cell to the middle
  await page.click('#inspector .mov-hot__cells li:first-child [data-action="show-cell"]');
  await frames();
  const cell = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const row = document.querySelector('#inspector [data-panel="hotspots"]').hotspots.rows[0];
    const at = movement.cellAt(row.cells[0].floorId, row.cells[0].cell);
    return { x: at.x - movement.view.width / 2, y: at.y - movement.view.height / 2 };
  });
  assert.ok(Math.abs(cell.x) < 1 && Math.abs(cell.y) < 1, 'the busiest cell is in the middle: ' + JSON.stringify(cell));
});

test('SV2-47 item 1: with one floor on the map the table is that floor\'s, its first row is the legend\'s busiest, and a link brings every floor back', async () => {
  const whole = await shownRows();
  await change({ floors: 'fsample002' });
  assert.deepEqual((await where()).floors, ['fsample002']);
  const rows = await shownRows();
  const seen = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const panel = document.querySelector('#inspector [data-panel="hotspots"]').hotspots;
    return {
      busiest: movement.picture.busiest.load,
      max: movement.picture.load.max,
      top: movement.picture.load.edges[4],
      ends: panel.rows.map((row) => row.ends.some((end) => end.floorId === 'fsample002')),
      elsewhere: panel.elsewhere,
      rings: panel.rings.length,
      legend: document.querySelector('.mov-legend').textContent,
    };
  });
  assert.ok(rows.length > 0 && rows.length < whole.length, rows.length + ' rows of ' + whole.length);
  assert.ok(seen.ends.every(Boolean), 'every row has an end on Floor 2');
  assert.ok(!rows.some((row) => row.name === 'Main Corridor, by Door B'), 'the Floor 1 corridor, the building\'s busiest at 177, is not a row');
  assert.deepEqual(rows.map((row) => row.rank), rows.map((row, index) => index + 1));
  assert.equal(rows[0].load, seen.busiest, 'the first row is the busiest load the picture has');
  assert.equal(rows[0].load, seen.max);
  assert.equal(rows[0].band, 5);
  assert.ok(rows[0].load >= seen.top.from && rows[0].load <= seen.top.to, rows[0].load + ' is inside the legend\'s band 5, ' + seen.top.from + ' to ' + seen.top.to);
  assert.ok(seen.legend.includes(String(seen.top.from)), 'and the legend on screen shows that band: ' + seen.legend);
  assert.ok(seen.rings > 0, 'the rings are on places of the floor shown');
  assert.equal(await text('#inspector [data-hotspots="lead"]'), 'The ' + rows.length + ' places anyone crosses on Floor 2, busiest first: every group on A Day, each place at its busiest moment. Choose a place to see it on the map.');
  // the places on the other floors: one counted line, and the way back
  assert.equal(seen.elsewhere, whole.length - rows.length);
  assert.equal(await page.$eval('#inspector [data-hotspots="elsewhere"]', (el) => el.hidden), false);
  assert.equal(await text('#inspector [data-hotspots="elsewhere"]'), seen.elsewhere + ' more places on floors not shown. Show all floors');
  await page.click('#inspector [data-action="all-floors"]');
  await settled();
  assert.deepEqual((await where()).floors, ['fsample001', 'fsample002', 'fsample003'], 'every floor is on the map again');
  assert.equal(await page.$eval('#inspector [data-hotspots="elsewhere"]', (el) => el.hidden), true, 'and the line is gone');
  assert.deepEqual((await shownRows()).map((row) => row.name), whole.map((row) => row.name));
  assert.equal(await view(() => document.activeElement.dataset.action), 'show', 'the focus is on the first place, not lost with the link');
  await change(OPEN);
});

test('SV2-47 item 3: cells of a floor that is not on the map are in the middle of the window once their floor has arrived', async () => {
  await change({ floors: 'fsample001' });
  await view(() => document.querySelector('.mov').movement.fit());
  await frames();
  // a cell near a corner of Floor 2, far from where a fitted floor's middle is
  const target = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const floor = movement.state.project.building.floors.find((each) => each.id === 'fsample002');
    let cell = -1;
    for (let at = floor.cells.length - 1; at >= 0 && cell === -1; at -= 1) if (floor.cells[at] === '#') cell = at;
    movement.env.show('fsample002', [cell]);
    return cell;
  });
  await settled();
  await pause(250);
  await frames();
  const after = await view((cell) => {
    const movement = document.querySelector('.mov').movement;
    const at = movement.cellAt('fsample002', cell);
    return { floors: movement.world.slots.map((slot) => slot.floor.id), at, x: at ? at.x - movement.view.width / 2 : null, y: at ? at.y - movement.view.height / 2 : null, fitted: movement.fitted };
  }, target);
  assert.deepEqual(after.floors, ['fsample002'], 'Floor 2 is the floor on the map now');
  assert.ok(after.at && Math.abs(after.x) < 1 && Math.abs(after.y) < 1, 'the cell is in the middle of the window after the flip: ' + JSON.stringify(after));
  assert.equal(after.fitted, false, 'the map stays where it was put');
  // a stairs connection's row goes to its end on the floor shown: the floor does not flip
  const stairs = await page.$eval('#inspector .mov-hot__row[data-kind="connection"]', (el) => el.dataset.rank);
  await page.click('#inspector .mov-hot__row[data-rank="' + stairs + '"] [data-action="show"]');
  await frames();
  assert.deepEqual((await where()).floors, ['fsample002'], 'the floor on the map stays');
  const end = await view((rank) => {
    const movement = document.querySelector('.mov').movement;
    const row = document.querySelector('#inspector [data-panel="hotspots"]').hotspots.rows.find((each) => each.rank === Number(rank));
    const on = row.ends.find((each) => each.floorId === 'fsample002');
    const at = movement.cellAt(on.floorId, on.cell);
    return { x: at.x - movement.view.width / 2, y: at.y - movement.view.height / 2 };
  }, stairs);
  assert.ok(Math.abs(end.x) < 1 && Math.abs(end.y) < 1, 'its end on Floor 2 is in the middle: ' + JSON.stringify(end));
  await change(OPEN);
  await view(() => document.querySelector('.mov').movement.fit());
});

test('the top places carry a ring that pulses when the ranking changes, and stands still under reduced motion', async () => {
  // moving: a new ranking sets the rings going, and the map is drawn again and again
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await change({ transition: 2 });
  await frames();
  const moving = await view(() => {
    const panel = document.querySelector('#inspector [data-panel="hotspots"]');
    const layer = panel.hotspots.layer;
    const plan = document.querySelector('#movement-plan');
    return {
      pulse: panel.dataset.pulse,
      moving: panel.hotspots.moving,
      rings: panel.hotspots.rings.map((ring) => ring.rank),
      drawn: Number(plan.dataset.drawn),
      frames: panel.hotspots.frames,
      over: layer !== null && layer.previousElementSibling === plan && layer.width === plan.width && layer.height === plan.height,
      box: layer ? [layer.clientWidth, layer.clientHeight, plan.clientWidth, plan.clientHeight] : null,
      through: layer ? getComputedStyle(layer).pointerEvents : null,
    };
  });
  assert.equal(moving.pulse, 'moving');
  assert.equal(moving.moving, true);
  assert.deepEqual(Array.from(new Set(moving.rings)), [1, 2, 3], 'a ring on each of the top three places');
  assert.equal(moving.over, true, 'the pulse has a canvas of its own, laid over the map\'s and the same size');
  assert.deepEqual(moving.box.slice(0, 2), moving.box.slice(2));
  assert.equal(moving.through, 'none', 'and every pointer goes through it to the map');
  await pause(400);
  // SV2-47 item 5: a tick of the pulse draws on that canvas and never asks for the floors again
  const later = await view(() => {
    const panel = document.querySelector('#inspector [data-panel="hotspots"]').hotspots;
    const ring = panel.rings[0];
    const g = panel.layer.getContext('2d');
    const ratio = panel.layer.width / panel.layer.clientWidth;
    // the travelling ring is somewhere between the ring and 0.7 of a radius out: look for ink along a spoke
    let inked = 0;
    for (let d = ring.r - 3; d <= ring.r * 1.7 + 3; d += 0.5) if (g.getImageData(Math.round((ring.x - d) * ratio), Math.round(ring.y * ratio), 1, 1).data[3] > 0) inked += 1;
    return { drawn: Number(document.querySelector('#movement-plan').dataset.drawn), frames: panel.frames, inked };
  });
  assert.equal(later.drawn, moving.drawn, 'the map itself is not drawn again while the rings pulse: ' + moving.drawn + ' → ' + later.drawn);
  assert.ok(later.frames >= moving.frames + 3, 'the pulse draws frame after frame on its own canvas: ' + moving.frames + ' → ' + later.frames);
  assert.ok(later.inked > 0, 'and the travelling ring is on it');

  // still: the same change under reduced motion draws the rings once and leaves them
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await change({ transition: 4 });
  await frames();
  await pause(150);
  const still = await view(() => {
    const movement = document.querySelector('.mov').movement;
    const panel = document.querySelector('#inspector [data-panel="hotspots"]');
    // close in on the first ring, so its line is clear of its neighbours
    const first = panel.hotspots.rows[0];
    const cell = first.cells.find((each) => !each.excluded);
    movement.env.show(cell.floorId, [cell.cell]);
    movement.view.zoomAbout(2, movement.view.width / 2, movement.view.height / 2);
    movement.env.paint();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
      pulse: panel.dataset.pulse,
      moving: panel.hotspots.moving,
      ring: panel.hotspots.rings.find((ring) => ring.rank === 1),
      rings: panel.hotspots.rings.length,
      drawn: Number(document.querySelector('#movement-plan').dataset.drawn),
    }))));
  });
  assert.equal(still.pulse, 'still');
  assert.equal(still.moving, false);
  assert.ok(still.rings >= 1);
  const stillFrames = await view(() => document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames);
  await pause(400);
  assert.equal(await view(() => document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames), stillFrames, 'and no frame of a pulse is drawn');
  assert.equal(await view(() => {
    const layer = document.querySelector('#inspector [data-panel="hotspots"]').hotspots.layer;
    return Array.from(layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data).some((value) => value !== 0);
  }), false, 'the pulse\'s canvas is empty');
  assert.equal(await view(() => Number(document.querySelector('#movement-plan').dataset.drawn)), still.drawn, 'nothing is drawn again: the ring does not move');
  // the still ring is there, in the accent, at its radius from the busiest cell
  const onRing = await pixel(still.ring.x - still.ring.r, still.ring.y);
  assert.ok(near(onRing, ACCENT, 40), 'a ring round the busiest place: ' + onRing);
  // inside it, along the wall of the busiest cell, the map shows through
  const inside = await pixel(still.ring.x, still.ring.y - 21);
  assert.ok(!near(inside, ACCENT, 40), 'a ring, not a disc: ' + inside);

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await change(OPEN);
  await view(() => document.querySelector('.mov').movement.fit());
});

test('the rings follow the map while another tab is open, and go when nothing is shown', async () => {
  // the panel's element leaves the page with its tab; keep hold of it
  await view(() => {
    globalThis.sv2rings = document.querySelector('#inspector [data-panel="hotspots"]');
  });
  await tab('summary');
  assert.equal(await view(() => globalThis.sv2rings.isConnected), false);
  await change({ transition: 6 });
  await frames();
  const seen = await view(async () => {
    const { hotspotRows } = await import(new URL('ui/movement/hotspots.js', location.href).href);
    const movement = document.querySelector('.mov').movement;
    const state = movement.state;
    const rows = hotspotRows(state.project, state.results, state.graph, movement.picture);
    const cell = rows[0].cells.find((each) => !each.excluded);
    const at = movement.cellAt(cell.floorId, cell.cell);
    const ring = globalThis.sv2rings.hotspots.rings.find((each) => each.rank === 1);
    return { at, ring, top: rows[0].place.name, told: globalThis.sv2rings.hotspots.rows[0].when };
  });
  assert.equal(seen.told, 'Period 4 to Period 5', 'the panel was last told of the whole day, where the first place peaks in another transition');
  assert.ok(seen.ring, 'the first place of ' + seen.top + ' has its ring');
  assert.ok(Math.abs(seen.ring.x - seen.at.x) < 0.5 && Math.abs(seen.ring.y - seen.at.y) < 0.5, 'on the busiest cell of the transition the map shows now: ' + JSON.stringify(seen));
  await change({ who: 'groups', groupIds: [] });
  await frames();
  assert.equal(await view(() => globalThis.sv2rings.hotspots.rings.length), 0, 'nothing shown, no ring');
  await tab('hotspots');
  assert.equal(await text('#inspector [data-hotspots="lead"]'), 'Nothing is shown, so there is nothing to rank. Choose a group, a grade or every group.');
  assert.equal(await page.$eval('#inspector .mov-hot', (el) => el.hidden), true);
  await change(OPEN);
  await frames();
  assert.deepEqual(Array.from(new Set(await view(() => globalThis.sv2rings.hotspots.rings.map((ring) => ring.rank)))), [1, 2, 3]);
});

// ---------------------------------------------------------------- travel time

test('Travel time: the transition with the day\'s slowest walk, and its first row is the slowest', async () => {
  await tab('tables');
  assert.match(await text('#inspector [data-travel="lead"]'), /^How long every group takes on A Day, slowest first\./);
  assert.equal(await page.$eval('#inspector [data-travel="pick"]', (el) => el.value), '5');
  assert.equal(await page.$eval('#inspector [data-travel="pick"]', (el) => el.selectedOptions[0].textContent), 'Period 6 to Period 7 (1:08 to 1:12)');
  assert.equal(await text('#inspector [data-travel="transition-line"]'), 'Passing time 4 min. This transition holds the day\'s slowest walk.');
  const rows = await page.$$eval('#inspector [data-travel="transition"] tbody', (all) => all.map((body) => ({
    group: body.dataset.group,
    total: Number(body.dataset.total),
    late: body.dataset.late,
    who: body.querySelector('th').textContent,
    times: Array.from(body.querySelectorAll('td')).map((cell) => cell.textContent),
    headers: Array.from(body.querySelectorAll('td')).map((cell) => cell.getAttribute('headers').split(' ').map((id) => document.getElementById(id).textContent.slice(0, 7)).join('|')),
  })));
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].group, 'gsample08a');
  assert.equal(rows[0].total, Math.max(...rows.map((row) => row.total)), 'the first row is the slowest');
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].total >= row.total), 'slowest first: ' + rows.map((row) => row.total).join(' '));
  assert.equal(rows[0].who, '8AGym to 303Late by 21 s');
  assert.deepEqual(rows[0].times, ['4 min 21 s', 'none', '4 min 21 s']);
  assert.equal(rows[0].late, 'true');
  assert.match(rows[1].who, /In time$/);
  assert.deepEqual(rows[0].headers.map((each) => each.split('|')[1]), ['Walking', 'Waiting', 'Total'], 'each time names its column');
  assert.ok(rows[0].headers.every((each) => each.startsWith('8A')), 'and its group');
  // the same figures the crowd model gave
  const walks = await view(() => document.querySelector('.mov').movement.state.results.walks.groups.filter((walk) => walk.dayTypeId === 'dsample00a' && walk.period === 5).map((walk) => [walk.groupId, walk.total]));
  assert.deepEqual(rows.map((row) => [row.group, row.total]).sort(), walks.sort());

  // the whole day, slowest first
  const day = await page.$$eval('#inspector [data-travel="day"] tbody', (all) => all.map((body) => ({ group: body.dataset.group, total: Number(body.dataset.total), who: body.querySelector('th').textContent })));
  assert.equal(day.length, 8);
  assert.ok(day.every((row, index) => index === 0 || day[index - 1].total >= row.total), 'slowest first: ' + day.map((row) => row.total).join(' '));
  assert.match(day.find((row) => row.group === 'gsample08a').who, /^8A7 walks, the slowest 4 min 21 s ?late once$/);
});

test('another transition can be picked for the table alone; one chosen on the map leads the table', async () => {
  await page.select('#inspector [data-travel="pick"]', '0');
  assert.equal(await page.$eval('#inspector [data-travel="transition"]', (el) => el.dataset.period), '0');
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), null, 'the map still shows the whole day');
  assert.equal(await text('#inspector [data-travel="transition-line"]'), 'Passing time 4 min.');
  const first = await page.$$eval('#inspector [data-travel="transition"] tbody', (all) => all.map((body) => Number(body.dataset.total)));
  assert.ok(first.every((total, index) => index === 0 || first[index - 1] >= total));
  await change({ transition: 2 });
  assert.equal(await page.$eval('#inspector [data-travel="pick"]', (el) => el.value), '2', 'the map\'s transition is the table\'s');
  // and from here the picker changes the map
  await page.select('#inspector [data-travel="pick"]', '3');
  await settled();
  assert.equal(await view(() => document.querySelector('.mov').movement.choice.transition), 3);
  assert.equal(await page.$eval('#inspector [data-travel="transition"]', (el) => el.dataset.period), '3');
  await change(OPEN);
  assert.equal(await page.$eval('#inspector [data-travel="pick"]', (el) => el.value), '5', 'back to the slowest when the map shows the day');
});

// ---------------------------------------------------------------- export

test('each table is a CSV named for the school, what it is and the day, and its first line is its headings', async () => {
  await tab('export');
  const hot = await delivered('csv-hotspots');
  assert.match(hot.fileName, /^Marrowby Middle School \(sample\) - hotspots - \d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(hot.mime, 'text/csv');
  const hotLines = hot.text.split('\r\n');
  // SV2-47 item 7: one column a group on the map, holding in how many transitions it crosses the place
  assert.equal(hotLines[0], '﻿Rank,Place,Floor,Kind,Load (students),When,Delay (seconds),Delay over the day (seconds),Cells,Groups,6A,6B,6C,7A,7B,7C,8A,8B');
  assert.equal(hotLines[1], '1,"Main Corridor, by Door B",Floor 1,corridor,177,Period 4 to Period 5,13,147,39,8,1,1,1,1,1,1,1,1');
  assert.equal(hotLines.length, 12, 'the headings, ten places, and the end of the last line');
  assert.equal(await text('#inspector [data-export="status"]'), 'Saved ' + hot.fileName + '.');

  const byTransition = await delivered('csv-transitions');
  assert.match(byTransition.fileName, /^Marrowby Middle School \(sample\) - travel time by transition - \d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(byTransition.text.split('\r\n')[0], '﻿Day type,Transition,Passing time (seconds),Group,From room,To room,Walking (seconds),Waiting (seconds),Total (seconds),Late,Late by (seconds)');
  assert.ok(byTransition.text.includes('\r\nA Day,Period 6 to Period 7,240,8A,Gym,303,261,0,261,late,21\r\n'));

  const byGroup = await delivered('csv-day');
  assert.match(byGroup.fileName, /^Marrowby Middle School \(sample\) - travel time by group - \d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(byGroup.text.split('\r\n')[0], '﻿Day type,Group,Walks,Walking (seconds),Waiting (seconds),Total (seconds),Late walks,Slowest walk,Slowest walk (seconds)');
  assert.equal(byGroup.text.split('\r\n').length, 10);
});

test('with nothing between the button and the browser, a CSV is a download with that name and those bytes', async () => {
  await view(() => {
    globalThis.sv2test = { clicks: [] };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function capture() {
      if (this.download) globalThis.sv2test.clicks.push({ download: this.download, href: this.href });
      else click.call(this);
    };
  });
  await page.click('#inspector [data-action="csv-day"]');
  await page.waitForFunction(() => globalThis.sv2test.clicks.length > 0);
  const file = await view(async () => {
    const one = globalThis.sv2test.clicks[0];
    const blob = await (await fetch(one.href)).blob();
    return { download: one.download, type: blob.type, head: Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 11)) };
  });
  assert.match(file.download, /^Marrowby Middle School \(sample\) - travel time by group - \d{4}-\d{2}-\d{2}\.csv$/);
  assert.match(file.type, /^text\/csv/);
  assert.deepEqual(file.head, [0xef, 0xbb, 0xbf, ...Buffer.from('Day type')], 'a byte-order mark, then the headings');
  assert.equal(await text('.toast .toast__text'), 'Saved ' + file.download + ' to your downloads.');
  await view(() => {
    delete HTMLAnchorElement.prototype.click;
  });
});

test('the picture is drawn from the model at three resolutions, on light paper whatever the theme', async () => {
  const sizes = await view(() => document.querySelector('#inspector [data-panel="export"]').exports.sizes());
  assert.deepEqual(sizes.map((size) => [size.id, size.scale]), [['standard', 1], ['high', 2], ['print', 4]]);
  assert.deepEqual([sizes[1].width, sizes[1].height], [sizes[0].width * 2, sizes[0].height * 2]);
  assert.deepEqual([sizes[2].width, sizes[2].height], [sizes[0].width * 4, sizes[0].height * 4]);
  assert.deepEqual(await page.$$eval('#inspector [data-export="resolution"] option', (all) => all.map((option) => option.textContent)), sizes.map((size) => size.label + ' (' + size.width + ' × ' + size.height + ')'));
  assert.equal(await text('#inspector [data-export="size"]'), 'The image is ' + sizes[0].width + ' by ' + sizes[0].height + ' pixels.');
  // larger than the map on screen: it is not a copy of the window
  const screen = await view(() => ({ width: document.querySelector('#movement-plan').width, height: document.querySelector('#movement-plan').height }));
  assert.ok(sizes[2].width * sizes[2].height > screen.width * screen.height * 4, 'print resolution holds far more than the window does');

  // what is in it, read at each resolution: an empty cell of the first floor,
  // the wall strip of the busiest corridor cell, and the paper outside the map
  const read = (resolution, pattern) => view((res, lines) => {
    const movement = document.querySelector('.mov').movement;
    const drawn = document.querySelector('#inspector [data-panel="export"]').exports.picture({ resolution: res, pattern: lines });
    const g = drawn.canvas.getContext('2d');
    const at = (x, y) => Array.from(g.getImageData(Math.round(x * drawn.scale), Math.round(y * drawn.scale), 1, 1).data.slice(0, 3));
    const cellOrigin = (floorId, cell) => {
      const slot = drawn.world.slots.find((each) => each.floor.id === floorId);
      return { x: drawn.origin.x + (slot.x + (cell % slot.floor.width) - slot.box.x) * 24, y: drawn.origin.y + (slot.y + Math.floor(cell / slot.floor.width) - slot.box.y) * 24 };
    };
    const first = drawn.world.slots[0];
    const busiest = movement.picture.busiest;
    const corner = cellOrigin(busiest.floorId, busiest.cell);
    // every pixel of the busiest cell
    const whole = Array.from(g.getImageData(Math.round(corner.x * drawn.scale), Math.round(corner.y * drawn.scale), Math.round(24 * drawn.scale), Math.round(24 * drawn.scale)).data);
    return {
      pixels: drawn.pixels,
      paper: at(3, 3),
      air: at(drawn.origin.x + first.x * 24 + 12, drawn.origin.y + first.y * 24 + 12),
      band: at(corner.x + 2, corner.y + 2),
      whole: res === 'standard' ? whole : null,
      inPage: document.querySelector('.mov-export-host') !== null,
    };
  }, resolution, pattern === true);

  for (const size of sizes) {
    const got = await read(size.id);
    assert.deepEqual(got.pixels, { width: size.width, height: size.height }, size.id);
    assert.deepEqual(got.paper, [255, 255, 255], size.id + ': white round the map');
    assert.ok(near(got.air, [0xe8, 0xe3, 0xd8], 6), size.id + ': an empty cell in the light theme\'s colour: ' + got.air);
    assert.ok(near(got.band, [0xb3, 0x26, 0x1e], 12), size.id + ': the busiest cell in the top band\'s colour: ' + got.band);
    assert.equal(got.inPage, false, 'the canvas it was drawn on is gone from the page');
  }
  // the pattern that stands beside the colour on paper
  const plain = await read('standard');
  const lined = await read('standard', true);
  let changed = 0;
  for (let i = 0; i < plain.whole.length; i += 4) if (Math.abs(plain.whole[i] - lined.whole[i]) + Math.abs(plain.whole[i + 1] - lined.whole[i + 1]) + Math.abs(plain.whole[i + 2] - lined.whole[i + 2]) > 30) changed += 1;
  assert.ok(changed >= 30, 'with the pattern, lines cross the busiest cell: ' + changed + ' of its 576 pixels changed');
  assert.deepEqual((await read('standard')).whole, plain.whole, 'and without it the same picture is drawn each time');

  // the same under a dark screen
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await frames();
  assert.ok(near(await pixel(4, 4), [0x15, 0x18, 0x1c], 8), 'the screen is dark: ' + await pixel(4, 4));
  const dark = await read('standard');
  assert.ok(near(dark.air, [0xe8, 0xe3, 0xd8], 6), 'and the picture is still on light paper: ' + dark.air);
  assert.deepEqual(dark.paper, [255, 255, 255]);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await frames();
});

test('Save the picture gives a PNG of the resolution chosen, named like every download', async () => {
  const sizes = await view(() => document.querySelector('#inspector [data-panel="export"]').exports.sizes());
  await page.select('#inspector [data-export="resolution"]', 'high');
  assert.equal(await text('#inspector [data-export="size"]'), 'The image is ' + sizes[1].width + ' by ' + sizes[1].height + ' pixels.');
  const file = await delivered('png');
  assert.match(file.fileName, /^Marrowby Middle School \(sample\) - movement picture - \d{4}-\d{2}-\d{2}\.png$/);
  assert.equal(file.type, 'image/png');
  assert.deepEqual(file.head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'the PNG signature');
  assert.deepEqual([file.width, file.height], [sizes[1].width, sizes[1].height]);
  assert.ok(file.size > 20000, 'a picture, not a blank: ' + file.size + ' bytes');
  // without the legend and the scale the picture is shorter
  await page.click('#inspector [data-part="legend"]');
  await page.click('#inspector [data-part="scale"]');
  const shorter = await view(() => document.querySelector('#inspector [data-panel="export"]').exports.sizes());
  assert.ok(shorter[0].height < sizes[0].height && shorter[0].width === sizes[0].width, sizes[0].height + ' → ' + shorter[0].height);
  await page.click('#inspector [data-part="legend"]');
  await page.click('#inspector [data-part="scale"]');
  await page.select('#inspector [data-export="resolution"]', 'standard');
});

test('Print the picture opens the preview with the map, what is shown, and the parts that are ticked', async () => {
  await change({ transition: 3 });
  await page.click('#inspector [data-action="print-picture"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const read = () => page.evaluate(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    const image = doc.querySelector('.plan-figure image');
    const plan = doc.querySelector('.plan-figure__plan');
    return {
      output: doc.documentElement.dataset.output,
      theme: doc.documentElement.dataset.theme,
      what: doc.querySelector('.doc-head__what').textContent,
      school: doc.querySelector('.doc-head__school').textContent,
      lead: doc.querySelector('.doc-lead').textContent,
      headings: Array.from(doc.querySelectorAll('h2')).map((el) => el.textContent),
      image: image ? image.getAttribute('href').slice(0, 22) : null,
      shape: image ? Number(image.getAttribute('width')) / Number(image.getAttribute('height')) : null,
      box: plan ? plan.getBoundingClientRect().width / plan.getBoundingClientRect().height : null,
      fits: plan ? plan.getBoundingClientRect().right <= doc.querySelector('.page').getBoundingClientRect().right : null,
      firstPlace: (doc.querySelector('.doc-table--places tbody th') || { textContent: '' }).textContent,
      scripts: doc.querySelectorAll('script').length,
      size: image ? [Number(image.getAttribute('width')), Number(image.getAttribute('height'))] : null,
      peaks: Array.from(doc.querySelectorAll('.doc-table--places thead th')).map((el) => el.textContent),
      late: Array.from(doc.querySelectorAll('.doc-table--groups thead th')).map((el) => el.textContent)[4] || null,
    };
  });
  const first = await read();
  // SV2-47 item 4: the colour scale is on the paper once. The image carries no key; the section stands alone.
  const keys = await view(() => {
    const panel = document.querySelector('#inspector [data-panel="export"]').exports;
    const bare = panel.picture({ pattern: true, side: 3200, bare: true, legend: false, scale: false });
    const keyed = panel.picture({ pattern: true, side: 3200, bare: true, legend: false, scale: true });
    return { bare: [bare.width, bare.height], keyed: [keyed.width, keyed.height] };
  });
  assert.deepEqual(first.size, keys.bare, 'the image on the paper is the picture with no key');
  assert.equal(keys.keyed[1] - keys.bare[1], 74, 'which is shorter by the key\'s height');
  assert.equal(first.headings.filter((heading) => heading === 'Colour scale').length, 1, 'and the scale is there once, as its own section');
  // SV2-47 item 9: one transition is printed, so no place "peaks in" it, and Late is that transition's
  assert.ok(!first.peaks.includes('Peaks in'), first.peaks.join(' | '));
  assert.equal(first.late, 'Late in this transition');
  assert.equal(first.output, 'movement');
  assert.equal(first.theme, 'light');
  assert.equal(first.what, 'Movement picture');
  assert.equal(first.school, 'Marrowby Middle School (sample)');
  assert.equal(first.lead, 'Showing every group (8) on A Day: Period 4 to Period 5, 11:24 to 11:28, 4 min of passing time. Corridors are coloured by the students crossing each cell in this transition.');
  assert.deepEqual(first.headings, ['Groups on the map', 'Colour scale', 'Busiest places']);
  assert.equal(first.image, 'data:image/png;base64,');
  assert.ok(Math.abs(first.shape - first.box) < 0.01, 'the map keeps its shape on the sheet');
  assert.equal(first.fits, true, 'and is inside the sheet');
  assert.equal(first.firstPlace, 'Main Corridor, by Door B');
  assert.equal(first.scripts, 0);
  assert.equal(await text('#print-preview .preview__title'), 'Print: Movement picture');
  // the paper can be turned, and the document is the same picture
  await page.click('#print-preview input[value="landscape"]');
  await page.waitForSelector('#print-preview[data-paper="letter landscape"][data-ready="true"]');
  assert.equal((await read()).lead, first.lead);
  await page.click('#print-preview input[value="portrait"]');
  await page.waitForSelector('#print-preview[data-paper="letter portrait"][data-ready="true"]');
  await closePreview();
  assert.equal(await view(() => document.activeElement.dataset.action), 'print-picture', 'the focus is back on the button');

  // a part not ticked is not on the paper
  await page.click('#inspector [data-part="hotspots"]');
  await page.click('#inspector [data-part="legend"]');
  await page.click('#inspector [data-action="print-picture"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  assert.deepEqual((await read()).headings, ['Colour scale']);
  await closePreview();
  await page.click('#inspector [data-part="hotspots"]');
  await page.click('#inspector [data-part="legend"]');
  await view(() => globalThis.sv2.store.undo());
  await view(() => globalThis.sv2.store.undo());
  await change(OPEN);
});

test('Print the congestion report opens it for every group, whatever the map shows', async () => {
  await change({ who: 'groups', groupIds: ['gsample06a'] });
  await page.click('#inspector [data-action="print-congestion"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const seen = await page.evaluate(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    const rows = (name) => Array.from(doc.querySelectorAll('.doc-table--' + name)[0].querySelectorAll('tbody tr')).map((row) => Array.from(row.cells).map((cell) => cell.textContent.trim()));
    return {
      output: doc.documentElement.dataset.output,
      what: doc.querySelector('.doc-head__what').textContent,
      lead: doc.querySelector('.doc-lead').textContent,
      headings: Array.from(doc.querySelectorAll('h2')).map((el) => el.textContent),
      worst: rows('worst'),
      places: rows('places'),
      late: rows('late'),
    };
  });
  assert.equal(seen.output, 'congestion');
  assert.equal(seen.what, 'Congestion report');
  assert.equal(seen.lead, 'On A Day the busiest place is Main Corridor, by Door B: 177 students in Period 4 to Period 5. 1 group cannot arrive in time, on 1 walk.');
  assert.deepEqual(seen.headings, ['A Day', 'The 3 worst transitions', 'The 10 busiest places', 'Groups that cannot arrive in time', 'B Day', 'The 3 worst transitions', 'The 10 busiest places', 'Groups that cannot arrive in time']);
  assert.equal(seen.worst.length, 3);
  assert.equal(seen.worst[0][0], 'Period 5 to Period 6');
  assert.equal(seen.places.length, 10);
  assert.deepEqual(seen.places[0].slice(0, 3), ['1', 'Main Corridor, by Door B', '177 students']);
  assert.deepEqual(seen.late, [['8A', 'Period 6 to Period 7', 'Gym', '303', '4 min 21 s', 'none', '4 min 21 s', '4 min', 'Late by 21 s']]);
  await closePreview();
  await change(OPEN);
});

test('with nothing on the map the picture and the hotspots cannot be exported, and the button says why', async () => {
  await change({ who: 'groups', groupIds: [] });
  for (const action of ['png', 'print-picture', 'csv-hotspots']) assert.equal(await page.$eval('#inspector [data-action="' + action + '"]', (el) => el.getAttribute('aria-disabled')), 'true', action);
  for (const action of ['csv-transitions', 'csv-day', 'print-congestion']) assert.equal(await page.$eval('#inspector [data-action="' + action + '"]', (el) => el.getAttribute('aria-disabled')), null, action + ' does not depend on the map');
  await page.click('#inspector [data-action="png"]');
  assert.equal(await text('#inspector [data-export="status"]'), 'Nothing is shown on the map. Choose a group, a grade or every group first.');
  assert.equal(await page.$('#print-preview'), null);
  await change(OPEN);
  assert.equal(await page.$eval('#inspector [data-action="png"]', (el) => el.getAttribute('aria-disabled')), null);
});

// ---------------------------------------------------------------- SV2-47: the SV2-18 review

test('SV2-47 item 2: a picture the browser cannot hold is never saved blank: it is saved a size down, and the tab says which and why', async () => {
  await tab('export');
  const panel = '#inspector [data-panel="export"]';
  // the probe itself, on this browser: a canvas past its limit takes no pixel, an ordinary one does
  const real = await view(async () => {
    const { canvasHolds } = await import(new URL('ui/movement/export.js', location.href).href);
    return { ordinary: canvasHolds(800, 600), tooWide: canvasHolds(70000, 8), tooTall: canvasHolds(8, 70000) };
  });
  assert.equal(real.ordinary, true);
  assert.equal(real.tooWide, false, 'a canvas 70000 pixels wide is handed over by Chromium and stays blank: the probe says so');
  assert.equal(real.tooTall, false);

  const sizes = await view(() => document.querySelector('#inspector [data-panel="export"]').exports.sizes());
  // a browser that holds less than this map at print size, as WebKit's 16.7 million pixels would be for a larger one: it holds the high size
  const limit = sizes[1].width * sizes[1].height + 1;
  await view((most) => {
    globalThis.sv2asked = [];
    document.querySelector('#inspector [data-panel="export"]').exports.hooks.holds = (width, height) => {
      globalThis.sv2asked.push([width, height]);
      return width * height <= most;
    };
  }, limit);
  await page.select(panel + ' [data-export="resolution"]', 'print');
  assert.equal(await text(panel + ' [data-export="size"]'), 'This browser cannot hold the map at that resolution (' + sizes[2].width + ' by ' + sizes[2].height + ' pixels), so the image is ' + sizes[1].width + ' by ' + sizes[1].height + ' pixels.');
  const file = await delivered('png');
  assert.deepEqual([file.width, file.height], [sizes[1].width, sizes[1].height], 'one step down from print is the high size');
  assert.deepEqual(file.head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(file.size > 20000, 'a picture, not a blank: ' + file.size + ' bytes');
  assert.equal(await text(panel + ' [data-export="status"]'), 'Saved ' + file.fileName + '. This browser could not hold the picture at print resolution (' + sizes[2].width + ' by ' + sizes[2].height + ' pixels), so it was saved one size down, at ' + sizes[1].width + ' by ' + sizes[1].height + ' pixels.');
  assert.ok((await view(() => globalThis.sv2asked)).some((size) => size[0] === sizes[2].width && size[1] === sizes[2].height), 'the size meant was asked for before anything was drawn');
  // what is drawn at the size held has the map on it: its corner is paper, and it is not one flat colour
  const inside = await view(() => {
    const drawn = document.querySelector('#inspector [data-panel="export"]').exports.picture({ resolution: 'print' });
    const g = drawn.canvas.getContext('2d');
    const data = g.getImageData(0, 0, drawn.pixels.width, Math.min(400, drawn.pixels.height)).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3]);
    return { fell: drawn.fell, scale: drawn.scale, asked: drawn.asked, colours: seen.size, corner: Array.from(g.getImageData(1, 1, 1, 1).data) };
  });
  assert.deepEqual([inside.fell, inside.scale, inside.asked], [1, 2, 4]);
  assert.deepEqual(inside.corner, [255, 255, 255, 255]);
  assert.ok(inside.colours > 3, 'more than paper is on it: ' + inside.colours + ' colours');
  // a browser that holds nothing at all: no file, and the reason
  await view(() => {
    globalThis.sv2test = { files: [] };
    const exportsOf = document.querySelector('#inspector [data-panel="export"]').exports;
    exportsOf.hooks.holds = () => false;
    exportsOf.hooks.deliver = (got) => globalThis.sv2test.files.push(got);
  });
  await page.click(panel + ' [data-action="png"]');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast__text')).some((el) => el.textContent.startsWith('That was not exported.')));
  assert.equal(await view(() => globalThis.sv2test.files.length), 0, 'nothing is saved rather than a blank');
  assert.equal(await text('.toast .toast__text'), 'That was not exported. This browser could not make an image of this map, even a small one.');
  await view(() => {
    const exportsOf = document.querySelector('#inspector [data-panel="export"]').exports;
    exportsOf.hooks.holds = null;
    exportsOf.hooks.deliver = null;
  });
  await page.select(panel + ' [data-export="resolution"]', 'standard');
  assert.equal(await text(panel + ' [data-export="size"]'), 'The image is ' + sizes[0].width + ' by ' + sizes[0].height + ' pixels.');
});

// The engine stood in for, as test/browser/movement.mjs does it.
const standIn = (kind) => view((which) => {
  const derived = globalThis.sv2.store.derived;
  if (!globalThis.sv2Kept) globalThis.sv2Kept = derived.engine;
  const real = globalThis.sv2Kept;
  if (which === 'fails') derived.use({ results: () => new Promise((resolve, reject) => { setTimeout(() => reject(new Error('The engine stopped')), 0); }) });
  else if (which === 'waits') {
    const gate = new Promise((resolve) => { globalThis.sv2LetGo = resolve; });
    derived.use({ results: () => gate.then(() => real.results()) });
  } else derived.use(real);
}, kind);

const rename = (name) => view(async (next) => {
  const { editGroup } = await import(new URL('engine/actions.js', location.href).href);
  globalThis.sv2.store.apply(editGroup, { id: 'gsample07a', name: next });
}, name);

test('SV2-47 item 6: while an answer is awaited, or could not be had, the Export tab says the map is from before the change, and a print is made from that one project', async () => {
  await change(OPEN);
  await tab('export');
  const panel = '#inspector [data-panel="export"]';
  assert.equal(await page.$eval(panel, (el) => el.dataset.behind), 'no');
  assert.equal(await page.$eval(panel + ' [data-export="behind"]', (el) => el.hidden), true);

  // pending: the project has changed and the answer is held back
  await standIn('waits');
  await rename('7A East');
  await page.waitForFunction(() => document.querySelector('#inspector [data-panel="export"]').dataset.behind === 'pending', { timeout: 5000 });
  assert.equal(await text(panel + ' [data-export="behind"]'), 'The routes are being worked out again after your last change. Until they are, the map, and everything exported here, is from before that change.');
  assert.equal(await page.$eval(panel + ' [data-export="behind"]', (el) => el.hidden), false);
  for (const action of ['png', 'print-picture', 'csv-hotspots', 'csv-transitions', 'csv-day', 'print-congestion']) assert.equal(await page.$eval(panel + ' [data-action="' + action + '"]', (el) => el.getAttribute('aria-disabled')), null, action + ' stays as it was');
  // the print now: its image is the old map, and so are its tables and sentences, whatever the project has become
  await page.click(panel + ' [data-action="print-picture"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const names = () => page.evaluate(() => {
    const doc = document.querySelector('#print-preview iframe').contentDocument;
    return { groups: Array.from(doc.querySelectorAll('.doc-table--groups tbody th')).map((el) => el.textContent.trim()), all: doc.body.textContent.includes('7A East'), image: doc.querySelector('.plan-figure image') !== null };
  });
  const printed = await names();
  assert.equal(await view(() => globalThis.sv2.store.project.groups.find((group) => group.id === 'gsample07a').name), '7A East', 'the project has moved on');
  assert.deepEqual(printed.groups, ['6A', '6B', '6C', '7A', '7B', '7C', '8A', '8B'], 'the print is of the project the image was drawn from');
  assert.equal(printed.all, false);
  assert.equal(printed.image, true);
  // turning the paper renders the document again: still that one project
  await page.click('#print-preview input[value="landscape"]');
  await page.waitForSelector('#print-preview[data-paper="letter landscape"][data-ready="true"]');
  assert.deepEqual((await names()).groups, printed.groups);
  assert.equal((await names()).all, false);
  await page.click('#print-preview input[value="portrait"]');
  await page.waitForSelector('#print-preview[data-paper="letter portrait"][data-ready="true"]');
  await closePreview();
  // the congestion report the same
  await page.click(panel + ' [data-action="print-congestion"]');
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  const report = await page.evaluate(() => {
    const body = document.querySelector('#print-preview iframe').contentDocument.body.textContent;
    return { now: body.includes('7A East'), then: body.includes('7A') };
  });
  assert.deepEqual(report, { now: false, then: true }, 'the report is of the results on screen');
  await closePreview();
  // a CSV the same: it is the map as drawn
  const day = await delivered('csv-day');
  assert.ok(day.text.includes(',7A,') && !day.text.includes('7A East'));

  // the answer comes: the line goes
  await view(() => globalThis.sv2LetGo());
  await settled();
  assert.equal(await page.$eval(panel, (el) => el.dataset.behind), 'no');
  assert.equal(await page.$eval(panel + ' [data-export="behind"]', (el) => el.hidden), true);
  assert.ok((await delivered('csv-day')).text.includes('7A East'));

  // stale: the next answer cannot be had
  await standIn('fails');
  await rename('7A West');
  await page.waitForFunction(() => document.querySelector('.mov').dataset.stale === 'true', { timeout: 5000 });
  assert.equal(await page.$eval(panel, (el) => el.dataset.behind), 'stale');
  assert.equal(await text(panel + ' [data-export="behind"]'), 'The routes could not be worked out after your last change. The map, and everything exported here, is from before that change.');
  assert.equal(await page.$eval(panel + ' [data-action="png"]', (el) => el.getAttribute('aria-disabled')), null);
  assert.ok((await delivered('csv-day')).text.includes('7A East'), 'what is saved is the last answer\'s');

  await standIn('real');
  // back to the sample: the two names, and the paper turned twice in the preview
  await view(() => {
    const { store } = globalThis.sv2;
    for (let i = 0; i < 12 && store.project.groups.find((group) => group.id === 'gsample07a').name !== '7A'; i += 1) store.undo();
  });
  await settled();
  assert.equal(await view(() => globalThis.sv2.store.project.groups.find((group) => group.id === 'gsample07a').name), '7A');
  assert.equal(await page.$eval(panel, (el) => el.dataset.behind), 'no');
});

test('SV2-47 item 8: a day type that is the same as another has that one\'s tables and files, named "(same as A Day)"', async () => {
  await view(async () => {
    const { replaceProject } = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    const project = JSON.parse(JSON.stringify(store.project));
    project.dayTypes[1].own = false;
    project.dayTypes[1].bells = project.dayTypes[1].bells.map(() => null);
    for (const group of project.groups) delete group.days[project.dayTypes[1].id];
    store.apply(replaceProject, { project, label: 'B Day the same as A Day' });
  });
  await settled();
  await change({ dayTypeId: 'dsample00b' });
  await tab('tables');
  assert.match(await text('#inspector [data-travel="lead"]'), /^How long every group takes on B Day \(same as A Day\), slowest first\./);
  assert.equal(await page.$eval('#inspector [data-panel="tables"]', (el) => el.dataset.day), 'dsample00a', 'one day type answers for the bells and the rows');
  assert.equal(await page.$eval('#inspector [data-travel="pick"]', (el) => el.selectedOptions[0].textContent), 'Period 6 to Period 7 (1:08 to 1:12)', 'A Day\'s bells');
  const first = await page.$eval('#inspector [data-travel="transition"] tbody', (body) => ({ group: body.dataset.group, total: body.dataset.total }));
  assert.deepEqual(first, { group: 'gsample08a', total: '261' }, 'A Day\'s slowest walk');
  assert.equal(await page.$eval('#inspector [data-travel="day"] caption', (el) => el.textContent), 'Each group over the whole of B Day (same as A Day), slowest first');
  await tab('export');
  const byTransition = await delivered('csv-transitions');
  assert.ok(byTransition.text.includes('\r\nB Day (same as A Day),Period 6 to Period 7,240,8A,Gym,303,261,0,261,late,21\r\n'), byTransition.text.slice(0, 400));
  const byGroup = await delivered('csv-day');
  assert.equal(byGroup.text.split('\r\n').length, 10);
  assert.ok(byGroup.text.split('\r\n').slice(1, 9).every((line) => line.startsWith('B Day (same as A Day),')));
  await view(() => globalThis.sv2.store.undo());
  await settled();
  await change(OPEN);
});

test('SV2-47 item 9: with one transition on the map no row says "Peaks in", and the file names that transition', async () => {
  await tab('hotspots');
  assert.ok((await shownRows()).every((row) => row.when.startsWith('Peaks in ')), 'over the day every place says where it peaks');
  await change({ transition: 2 });
  const rows = await shownRows();
  assert.ok(rows.length > 0);
  assert.deepEqual(rows.map((row) => row.when), rows.map(() => ''), 'one transition is shown: there is no other to peak in');
  assert.match(await text('#inspector [data-hotspots="lead"]'), /each place in Period 3 to Period 4\. Choose a place/);
  assert.match(await text('#inspector [data-hotspots="notes"]'), /Delay is the waiting the crowd model found at the place in that transition, /);
  await tab('export');
  const hot = await delivered('csv-hotspots');
  assert.ok(hot.text.split('\r\n').slice(1, -1).every((line) => line.includes(',Period 3 to Period 4,')), hot.text.slice(0, 300));
  await change({ transition: null, measure: 'total' });
  const total = await delivered('csv-hotspots');
  assert.ok(total.text.split('\r\n').slice(1, -1).every((line) => line.includes(',the whole day,')), total.text.slice(0, 300));
  await change(OPEN);
  await tab('hotspots');
});

test('SV2-47 items 5 and 9, at the size the tool promises: "Show all 64 places" shows them, a tick of the pulse is far under a frame, and leaving the view leaves no timer', async () => {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await view(async () => {
    const { bigProject } = await import(new URL('test/fixtures/big.mjs', location.href).href);
    const { replaceProject } = await import(new URL('engine/actions.js', location.href).href);
    const project = bigProject({ seed: 1 });
    project.onboarding.dismissed = true;
    globalThis.sv2.store.apply(replaceProject, { project, label: 'Load the timing fixture' });
  });
  await settled();
  await tab('hotspots');
  assert.equal((await shownRows()).length, 10, 'the table opens with ten');
  const all = '#inspector [data-action="all-places"]';
  assert.equal(await page.$eval(all, (el) => el.hidden), false);
  assert.equal(await text(all), 'Show all 64 places');
  await page.click(all);
  const rows = await shownRows();
  assert.equal(rows.length, 64);
  assert.deepEqual(rows.map((row) => row.rank), Array.from({ length: 64 }, (unused, index) => index + 1));
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].load >= row.load), 'busiest first to the last');
  assert.equal(await text(all), 'Show the first 10 only');
  assert.equal(await view(() => document.activeElement.dataset.action), 'all-places', 'the focus stays on the button');
  await page.click(all);
  assert.equal((await shownRows()).length, 10);
  assert.equal(await text(all), 'Show all 64 places');

  // a tick of the pulse on this map: the map's canvas is not drawn again, and the tick itself is measured
  await change({ transition: 1 });
  await frames();
  const before = await view(() => ({ moving: document.querySelector('#inspector [data-panel="hotspots"]').hotspots.moving, drawn: Number(document.querySelector('#movement-plan').dataset.drawn), frames: document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames }));
  assert.equal(before.moving, true);
  await pause(300);
  const after = await view(() => ({ drawn: Number(document.querySelector('#movement-plan').dataset.drawn), frames: document.querySelector('#inspector [data-panel="hotspots"]').hotspots.frames }));
  assert.equal(after.drawn, before.drawn, 'the map of four floors is not drawn again by the pulse');
  assert.ok(after.frames > before.frames, 'while the pulse goes on: ' + before.frames + ' → ' + after.frames);
  const ticks = await view(async () => {
    const { pulseFrame } = await import(new URL('ui/movement/hotspots.js', location.href).href);
    const panel = document.querySelector('#inspector [data-panel="hotspots"]').hotspots;
    const g = panel.layer.getContext('2d');
    const each = [];
    for (let i = 0; i < 60; i += 1) {
      const started = performance.now();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, panel.layer.width, panel.layer.height);
      pulseFrame(g, panel.rings, 1 - i / 60, { accent: '#0f6e66' });
      each.push(performance.now() - started);
    }
    each.sort((a, b) => a - b);
    return { median: each[30], worst: each[59], rings: panel.rings.length };
  });
  console.log('# hotspot pulse in the page, the 3.13 fixture: one tick median ' + ticks.median.toFixed(2) + ' ms, worst ' + ticks.worst.toFixed(2) + ' ms (budget 16), ' + ticks.rings + ' rings');
  assert.ok(ticks.median < 16, 'a tick of the pulse takes ' + ticks.median.toFixed(2) + ' ms at the median, over 16');

  // leaving the view mid-pulse: the panel's timer is cleared and its canvas and mark are gone
  await change({ transition: 2 });
  await frames();
  await view(() => {
    const section = document.querySelector('.mov');
    globalThis.sv2left = { panel: document.querySelector('#inspector [data-panel="hotspots"]'), env: section.movement.env };
  });
  assert.equal(await view(() => globalThis.sv2left.panel.hotspots.moving), true);
  assert.ok(await view(() => globalThis.sv2left.env.marks.some((mark) => mark.id === 'hotspots')));
  await view(() => { location.hash = '#project'; });
  await page.waitForFunction(() => document.querySelector('.mov') === null);
  const left = await view(() => ({ frames: globalThis.sv2left.panel.hotspots.frames, pulse: globalThis.sv2left.panel.dataset.pulse, layer: globalThis.sv2left.panel.hotspots.layer.isConnected, mark: globalThis.sv2left.env.marks.some((mark) => mark.id === 'hotspots') }));
  await pause(300);
  assert.equal(await view(() => globalThis.sv2left.panel.hotspots.frames), left.frames, 'no frame is drawn after the view has gone: the timer was cleared');
  assert.notEqual(left.pulse, 'moving');
  assert.equal(left.layer, false, 'the pulse\'s canvas left the page');
  assert.equal(left.mark, false, 'and the panel\'s mark left the map\'s list');
  await view(() => { location.hash = '#movement'; });
  await page.waitForFunction(() => document.querySelector('.mov') !== null);
  await view(() => globalThis.sv2.store.undo());
  await settled();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await change(OPEN);
  await tab('hotspots');
  assert.equal((await shownRows())[0].name, 'Main Corridor, by Door B', 'the sample school is back');
});

// ---------------------------------------------------------------- names

test('a name is shown exactly as typed in the hotspot table and the travel-time tables, and in the CSV', async () => {
  const hostile = { group: '<img src=x onerror=alert(1)> & "7A"', corridor: '</td><script>alert(2)</script>, Main' };
  await view(async (names) => {
    const { editGroup, renameCorridor } = await import(new URL('engine/actions.js', location.href).href);
    const { store } = globalThis.sv2;
    store.apply(editGroup, { id: 'gsample08a', name: names.group });
    const floor = store.project.building.floors[0];
    const corridor = floor.corridors.find((each) => each.name === 'Main Corridor');
    store.apply(renameCorridor, { floorId: floor.id, corridorId: corridor.id, name: names.corridor });
  }, hostile);
  await settled();
  await tab('hotspots');
  const rows = await shownRows();
  assert.equal(rows[0].name, hostile.corridor + ', by Door B');
  assert.ok(rows[0].groups.includes(hostile.group), rows[0].groups);
  await tab('tables');
  assert.ok((await text('#inspector [data-travel="transition"] tbody[data-group="gsample08a"] th')).startsWith(hostile.group));
  assert.equal(await page.$$eval('#inspector img, #inspector script', (all) => all.length), 0, 'no name became an element');
  await tab('export');
  const hot = await delivered('csv-hotspots');
  assert.ok(hot.text.includes('"' + (hostile.corridor + ', by Door B').replaceAll('"', '""') + '"'), 'the corridor as typed, quoted because of its comma');
  assert.ok(hot.text.includes(hostile.group.replaceAll('"', '""')));
  assert.match(hot.fileName, /^Marrowby Middle School \(sample\) - hotspots - /);
  await view(() => {
    globalThis.sv2.store.undo();
    globalThis.sv2.store.undo();
  });
  await settled();
  await tab('hotspots');
  assert.equal((await shownRows())[0].name, 'Main Corridor, by Door B');
});

test('nothing went wrong on the way, and nothing was asked of another origin', async () => {
  assert.deepEqual(session.problems(), { errors: [], blocked: [], shimmed: [] });
  assert.deepEqual(session.offsite, []);
  assert.deepEqual(dialogs, []);
});
