// The step-free route sheet in a real browser (spec 11; DESIGN 13.5, 13.7; SV2-103):
// node test/browser/route-sheet.mjs
//
// The journey: a small school with an elevator is built through the store's actions (two
// floors, a corridor and rooms on each, Elevator D joining them; Ada has 20 students and needs
// step-free routes, Bo stays on Floor 1). Then, by the interface:
//   the Route sheet buttons of the travel-time table (one a group, each named for its group) and
//   of the group editor; the preview opening on the sheet and the sheet read from the frame (the
//   header, the numbered directions with the ride, the one-person time against the passing
//   time, "Movement shows the whole group late here (3 trips)", the staff-only line, the two
//   floors' maps only on the walk that changes floor, labelled); Bo's sheet with no map and no
//   such line; the focus kept inside the dialog and given back; the sheet printed by Chromium on
//   Letter and on A4 (the sheets and the paper's size, no block taller than the paper);
//   and at 390 px with touch: a button a finger's size, the page scaled to the width, the Print
//   button 44 px tall, the focus in the dialog, the maps still labelled.
//
// Every wait is on a state the page sets: Movement's section `data-pending` gone with the results
// for the very project in the store, the preview's `data-ready`, the editor open on its group.
// None waits on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, waitForSection } from './harness.mjs';
import { startEmpty, planReady } from './draw-pointer.mjs';

let session;
let page;
let ada;
let bo;

const view = (fn, ...args) => page.evaluate(fn, ...args);
const text = (selector) => page.$eval(selector, (el) => el.textContent.trim());

// Build the school by the actions, in whatever page is given: Elevator D at the east end of
// each floor's corridor; Ada (20 students, step-free) from Room 101 up to Room 201, Bo from
// Room 101 to Room 102 on the same floor; three minutes between periods, which one person's walk
// (the corridor, the car's wait and its ride) fits and a class of 20 in three trips does not.
async function buildSchool(target) {
  return target.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    store.apply(actions.addFloor, { likeFloorId: store.project.building.floors[0].id });
    const floors = store.project.building.floors;
    for (const floor of floors) {
      store.apply(actions.paintCorridor, { floorId: floor.id, from: 10 * 40 + 5, to: 10 * 40 + 21 });
      store.apply(actions.placeLift, { floorId: floor.id, cells: [10 * 40 + 22] });
    }
    const rooms = [[0, 5, '101'], [0, 12, '102'], [1, 5, '201']];
    for (const [floor, x, number] of rooms) {
      store.apply(actions.placeRoom, { floorId: floors[floor].id, rect: { x, y: 7, w: 4, h: 3 }, number });
      const room = store.project.building.floors[floor].spaces.find((space) => space.number === number);
      store.apply(actions.addDoor, { roomId: room.id, cell: 9 * 40 + x + 1, side: 's' });
    }
    store.apply(actions.connectStairs, { a: { floorId: floors[0].id, cell: 10 * 40 + 22 }, b: { floorId: floors[1].id, cell: 10 * 40 + 22 } });
    store.apply(actions.setSetting, { key: 'defaultPassingSeconds', value: 170 });
    const dayTypeId = store.project.dayTypes[0].id;
    const roomOf = (number) => store.project.building.floors.flatMap((floor) => floor.spaces).find((space) => space.number === number).id;
    store.apply(actions.addGroup, { name: 'Ada', grade: '7', headCount: 20 });
    store.apply(actions.addGroup, { name: 'Bo', grade: '7' });
    const groups = store.project.groups;
    const days = { Ada: ['101', '201'], Bo: ['101', '102'] };
    for (const group of groups) {
      days[group.name].forEach((number, period) => store.apply(actions.setSlot, { groupId: group.id, dayTypeId, period, slot: { room: roomOf(number) } }));
    }
    const adaId = groups.find((group) => group.name === 'Ada').id;
    store.apply(actions.editGroup, { id: adaId, stepFree: true });
    return { ada: adaId, bo: groups.find((group) => group.name === 'Bo').id };
  });
}

before(async () => {
  session = await openPlanner({ hash: '#building', width: 1280, height: 900 });
  page = session.page;
  await startEmpty(page);
  ({ ada, bo } = await buildSchool(page));
  await planReady(page);
});

after(async () => {
  if (session) await session.close();
});

// Where the focus is, for a modal dialog: inside it, or handed to the browser's own controls
// (document.body); never an element of the page behind.
const heldByDialog = () => view(() => document.activeElement === document.body || document.getElementById('print-preview').contains(document.activeElement));

// ---------------------------------------------------------------- shared reads

// Movement's section drawn for the project in the store, its results in.
async function settled(target) {
  await (target || page).waitForFunction(() => {
    const section = document.querySelector('.mov');
    if (!section || section.dataset.styled !== 'true' || section.dataset.pending === 'true') return false;
    const movement = section.movement;
    return movement.state !== null && movement.state.results !== null && movement.state.project === globalThis.sv2.store.project && movement.view.width > 0;
  }, { timeout: 20000 });
}

async function openTravel(target) {
  const here = target || page;
  await here.evaluate(() => {
    location.hash = '#movement';
  });
  await waitForSection(here, 'movement');
  await settled(here);
}

// The sheet in the preview, read from its frame once it is laid out.
async function sheetRead(target) {
  const here = target || page;
  await here.waitForSelector('#print-preview[open][data-ready="true"]', { timeout: 20000 });
  return here.evaluate(() => {
    const dialog = document.getElementById('print-preview');
    const frame = dialog.querySelector('iframe');
    const doc = frame.contentDocument;
    const blocks = Array.from(doc.querySelectorAll('[data-period]')).map((el) => ({
      kind: el.dataset.kind,
      period: Number(el.dataset.period),
      ok: el.dataset.ok === undefined ? null : el.dataset.ok === 'true',
      heading: el.querySelector('h2') ? el.querySelector('h2').textContent : null,
      steps: Array.from(el.querySelectorAll('.card__words')).map((word) => word.textContent),
      time: el.querySelector('.rs__time') ? el.querySelector('.rs__time').textContent : null,
      fits: el.querySelector('.rs__time') ? el.querySelector('.rs__time').dataset.fits : null,
      movement: el.querySelector('[data-line="movement"]') ? el.querySelector('[data-line="movement"]').textContent : null,
      maps: Array.from(el.querySelectorAll('.rs__map')).map((map) => ({ floor: map.dataset.floor, caption: map.querySelector('figcaption').textContent, width: map.querySelector('svg').getBoundingClientRect().width })),
      label: el.querySelector('.rs__maps') ? el.querySelector('.rs__maps').getAttribute('aria-label') : null,
      role: el.querySelector('.rs__maps') ? el.querySelector('.rs__maps').getAttribute('role') : null,
      line: el.tagName === 'P' ? el.textContent : null,
    }));
    return {
      output: doc.documentElement.dataset.output,
      what: Array.from(doc.querySelectorAll('.doc-head__what')).map((el) => el.textContent),
      pages: doc.querySelectorAll('.page').length,
      who: Array.from(doc.querySelectorAll('[data-line="who"]')).map((el) => el.textContent),
      times: doc.querySelector('[data-line="times"]') ? doc.querySelector('[data-line="times"]').textContent : null,
      staff: doc.querySelector('[data-line="staff-only"]') ? doc.querySelector('[data-line="staff-only"]').textContent : null,
      movementLines: doc.querySelectorAll('[data-line="movement"]').length,
      blocks,
      html: frame.srcdoc,
      paper: dialog.dataset.paper,
    };
  });
}

async function closeSheet(target) {
  const here = target || page;
  await here.keyboard.press('Escape');
  await here.waitForFunction(() => document.getElementById('print-preview') === null);
}

// Chromium's print of a document: its sheets and each one's size in points.
async function printed(html) {
  const paper = await session.browser.newPage();
  try {
    await paper.goto(session.url(''), { waitUntil: 'load' });
    await paper.evaluate((markup) => {
      document.open();
      document.write(markup);
      document.close();
    }, html);
    await paper.waitForFunction(() => document.readyState === 'complete' && Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every((link) => link.sheet !== null));
    await paper.evaluate(() => document.fonts.ready.then(() => true));
    assert.equal(await paper.evaluate(() => getComputedStyle(document.querySelector('.doc-head__what')).fontWeight), '700', 'print.css is applied');
    // the tallest block, in millimetres, and how the browser means to break it
    const blocks = await paper.evaluate(() => Array.from(document.querySelectorAll('.rs__block')).map((el) => ({ mm: (el.getBoundingClientRect().height * 25.4) / 96, breaks: getComputedStyle(el).breakInside })));
    const pdf = Buffer.from(await paper.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1');
    const boxes = Array.from(pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)).map((match) => [Math.round(Number(match[3])), Math.round(Number(match[4]))]);
    return { boxes, sheets: (pdf.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, blocks };
  } finally {
    await paper.close();
  }
}

// the letter the building gave the elevator
const carLetter = async () => (await view(() => globalThis.sv2.store.project)).building.connections.find((connection) => connection.kind === 'elevator').car;

// ---------------------------------------------------------------- 1280: the travel-time table

test('the travel-time table has a Route sheet button in each group\'s row, named for the group, in the whole-day table only', async () => {
  await openTravel();
  await page.click('#inspector [role="tab"][data-tab="tables"]');
  await page.waitForSelector('#inspector [data-panel="tables"] [data-travel="day"] .mov-travel__group');
  const buttons = await page.$$eval('#inspector [data-panel="tables"] button[data-print="route-sheet"]', (all) => all.map((el) => ({ group: el.dataset.group, text: el.textContent, name: el.getAttribute('aria-label'), table: el.closest('[data-travel]').dataset.travel, id: el.id })));
  assert.deepEqual(buttons.map((button) => [button.group, button.text, button.name, button.table]), [[ada, 'Route sheet', 'Route sheet for Ada', 'day'], [bo, 'Route sheet', 'Route sheet for Bo', 'day']]);
  assert.equal(new Set(buttons.map((button) => button.id)).size, 2, 'two buttons, two ids');
  // each sits in a row of its own under the group's figures, tied to the group by headers
  const row = await page.$eval('#inspector [data-panel="tables"] button[data-group="' + ada + '"]', (el) => ({ headers: el.closest('td').getAttribute('headers'), group: document.getElementById(el.closest('td').getAttribute('headers')).textContent, span: el.closest('td').colSpan }));
  assert.match(row.group, /Ada/);
  assert.ok(row.span >= 3);
});

test('Ada\'s button opens her sheet: the header, the directions with the ride, the one-person time, the whole group late, the staff-only line and the two maps', async () => {
  const button = '#inspector [data-panel="tables"] button[data-group="' + ada + '"]';
  await page.click(button);
  const read = await sheetRead();
  assert.equal(read.output, 'route-sheet');
  assert.deepEqual(read.what, ['Step-free route sheet']);
  assert.equal(read.pages, 1, 'the day type on the map: one sheet');
  assert.match(read.who[0], /^Group Ada · A Day$/);
  assert.equal(read.times, 'Times are for one person, without crowds, including each elevator’s wait.');
  const letter = await carLetter();
  assert.equal(read.staff, 'Elevator ' + letter + ' is staff and authorised only: arrange access with the office.');
  const walk = read.blocks.find((block) => block.kind === 'walk');
  assert.equal(walk.period, 0);
  assert.equal(walk.heading, 'Period 1 → Period 2 · Room 101 to Room 201');
  assert.deepEqual(walk.steps.filter((step) => /^Take Elevator/.test(step)), ['Take Elevator ' + letter + ' up to Floor 2.'], 'one ride, as a step of its own');
  assert.equal(walk.steps.some((step) => /stairs/i.test(step)), false);
  // one person, an empty corridor: the walk and the car's wait and ride fit the passing time (Movement says the whole class does not)
  assert.match(walk.time, /^\d+ min \d+ s · passing time 2 min 50 s · fits, .+ to spare$/);
  assert.equal(walk.fits, 'true');
  assert.equal(walk.movement, 'Movement shows the whole group late here (3 trips)');
  assert.equal(read.movementLines, 1);
  // the maps: the walk changes floor, so both floors, in order, each a real drawing, labelled
  assert.deepEqual(walk.maps.map((map) => map.caption), ['Floor 1 · start', 'Floor 2 · end']);
  assert.ok(walk.maps.every((map) => map.width > 40), 'each plan is drawn: ' + walk.maps.map((map) => map.width).join(', '));
  assert.equal(walk.role, 'img');
  assert.equal(walk.label, 'Route from Floor 1 to Floor 2 by Elevator ' + letter);
  // the second transition: she has no room in Period 3, one line
  assert.equal(read.blocks.find((block) => block.period === 1).line, 'Period 2 → Period 3 · No room in Period 3, so no walk.');
});

test('the dialog keeps the focus inside while it is open and gives it back to the button on Escape', async () => {
  assert.equal(await view(() => document.activeElement.closest('#print-preview') !== null), true, 'the focus went into the dialog on opening');
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    assert.equal(await heldByDialog(), true, 'Tab ' + (step + 1) + ' stayed with the dialog');
  }
  await closeSheet();
  assert.equal(await view(() => document.activeElement.dataset.group), ada, 'the focus is back on Ada\'s Route sheet button');
});

test('Bo\'s sheet: one walk on Floor 1, so no map and no "late" line, and no staff-only line', async () => {
  await page.click('#inspector [data-panel="tables"] button[data-group="' + bo + '"]');
  const read = await sheetRead();
  assert.match(read.who[0], /^Group Bo · A Day$/);
  const walk = read.blocks.find((block) => block.kind === 'walk');
  assert.equal(walk.heading, 'Period 1 → Period 2 · Room 101 to Room 102');
  assert.deepEqual(walk.maps, []);
  assert.equal(walk.label, null);
  assert.equal(read.movementLines, 0);
  assert.equal(read.staff, null);
  assert.equal(walk.steps.some((step) => /Elevator|stairs/i.test(step)), false);
  await closeSheet();
});

// ---------------------------------------------------------------- 1280: the group editor

test('the group editor\'s Route sheet button prints her day on every day type, with no Movement line (the results are not at hand there)', async () => {
  await view((id) => {
    location.hash = '#schedule/groups/' + id;
  }, ada);
  await page.waitForFunction((id) => document.querySelector('.sch-editor')?.dataset.group === id, {}, ada);
  assert.equal(await text('[data-key="group-route-sheet"]'), 'Route sheet');
  // (SV2-103b) the preview holds no Movement results, so a plain line by the button says what the sheet times
  assert.equal(await text('[data-part="route-sheet-scope"]'), 'This sheet times one person; open it from Movement › Travel time to see whether the whole group is late.');
  await page.click('[data-key="group-route-sheet"]');
  const read = await sheetRead();
  const own = await view(() => globalThis.sv2.store.project.dayTypes.filter((dayType) => dayType.own).length);
  assert.equal(read.pages, own, 'a sheet for each own day type');
  assert.equal(read.who.length, own);
  assert.match(read.who[0], /^Group Ada · A Day$/);
  assert.equal(read.movementLines, 0);
  assert.ok(read.blocks.some((block) => block.kind === 'walk' && block.maps.length === 2));
  await closeSheet();
  assert.equal(await view(() => document.activeElement.dataset.key), 'group-route-sheet', 'the focus is back on the button');
});

// ---------------------------------------------------------------- 1280: the teacher's row

test('SV2-103b: a teacher\'s row has a Route sheet button, named for the teacher, that opens that teacher\'s sheet and gives the focus back', async () => {
  const teacher = await view(async () => {
    const actions = await import('./engine/actions.js');
    const { store } = globalThis.sv2;
    store.apply(actions.addTeacher, { name: 'Ms. Orchid' });
    return store.project.teachers.find((each) => each.name === 'Ms. Orchid').id;
  });
  await view(() => { location.hash = '#schedule/teachers'; });
  const key = 'teacher:' + teacher + ':route-sheet';
  await page.waitForSelector('[data-key="' + key + '"]');
  assert.equal(await text('[data-key="' + key + '"]'), 'Route sheet for Ms. Orchid');
  await page.click('[data-key="' + key + '"]');
  const read = await sheetRead();
  assert.equal(read.output, 'route-sheet');
  assert.ok(read.who.length > 0 && read.who.every((who) => who.startsWith('Teacher Ms. Orchid · ')), read.who.join(' | '));
  await closeSheet();
  assert.equal(await view(() => document.activeElement.dataset.key), key, 'the focus is back on the button');
});

// ---------------------------------------------------------------- 1280: the scenario lab

test('the scenario lab offers no stairs where the building has only an elevator, and its cursor and its pick call a stop an elevator', async () => {
  await view(() => {
    location.hash = '#scenarios';
  });
  const labReady = () => page.waitForFunction(() => {
    const el = document.querySelector('.scn');
    if (!el || el.dataset.styled !== 'true' || !el.scenarios) return false;
    if (el.dataset.mode === 'empty') return true;
    if (el.scenarios.plan.project !== globalThis.sv2.store.project) return false;
    if (el.dataset.mode === 'none') return el.dataset.compare === 'none';
    return el.dataset.compare === 'ready' && !el.scenarios.pending;
  }, { timeout: 30000 });
  await labReady();
  await page.click('#scenario-start-name');
  await page.keyboard.type('Lift check');
  await page.click('[data-action="start"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.mode === 'open');
  await labReady();
  await page.click('.scn-add .seg input[value="building"] + .seg__label');
  await page.waitForFunction(() => document.querySelector('.scn-form').dataset.kind === 'building');
  // the elevator is not a stair to close or turn: the form has none to offer, and says so
  assert.equal(await text('.scn-form [data-part="none"]'), 'The building has no stairs connecting floors yet.');
  assert.equal(await page.$('#scenario-building-stair'), null, 'no list of stairs with an elevator in it');
  // the cursor on a stop says elevator, never stairs: the difference card speaks on a cell with a node
  // ("by Room 101, Floor 1, elevator: no change. ..."), and a lift stop has one
  const floor = await view(() => globalThis.sv2.store.project.building.floors[0]);
  const stop = floor.lifts[0];
  const cursorOn = (floorId, cell) => page.evaluate((f, c) => {
    const plan = document.querySelector('.scn').scenarios.plan;
    const at = plan.cellAt(f, c);
    plan.focus();
    plan.cursor.moveTo(Math.floor((at.x - plan.view.x) / plan.view.size), Math.floor((at.y - plan.view.y) / plan.view.size), true);
  }, floorId, cell);
  const said = () => text('#announcer');
  await cursorOn(floor.id, stop - 1);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /, elevator: /.test(document.getElementById('announcer').textContent));
  assert.doesNotMatch(await said(), /stairs/);
  // picking a corridor by keyboard: the same stop is refused in its own words, and nothing is added
  await page.click('.scn-seats__what input[value="corridor"] + .seg__label');
  await page.waitForSelector('[data-key="scenario-building-pick"]');
  await page.click('[data-key="scenario-building-pick"]');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === 'true');
  await cursorOn(floor.id, stop - 1);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /elevator stop/.test(document.getElementById('announcer').textContent));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /elevator stop/.test(document.getElementById('announcer').textContent));
  assert.equal(await view(() => (globalThis.sv2.store.project.scenarios || []).every((scenario) => (scenario.levers || []).length === 0)), true, 'no lever was made of an elevator stop');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.scn').dataset.picking === undefined);
});

// ---------------------------------------------------------------- 1280: Chromium prints it

test('Chromium prints the sheet on US Letter and on A4: its sheets, the paper\'s size, and every block short enough for one page and told not to split', async () => {
  await openTravel();
  for (const [size, points, millimetres] of [['letter', [612, 792], 279.4 - 28], ['a4', [595, 842], 297 - 28]]) {
    await view(async (paper) => {
      const actions = await import('./engine/actions.js');
      globalThis.sv2.store.apply(actions.setSetting, { key: 'paper.size', value: paper });
    }, size);
    await page.click('#inspector [role="tab"][data-tab="tables"]');
    await page.waitForSelector('#inspector [data-panel="tables"] button[data-group="' + ada + '"]');
    await page.click('#inspector [data-panel="tables"] button[data-group="' + ada + '"]');
    const read = await sheetRead();
    assert.equal(read.paper, size + ' portrait');
    assert.ok(read.html.includes('<style id="page-size">@page { size: ' + (size === 'a4' ? 'A4' : 'letter') + ' portrait; }</style>'), size + ': the page rule');
    const pdf = await printed(read.html);
    assert.ok(pdf.sheets >= 1, size + ': sheets ' + pdf.sheets);
    for (const box of pdf.boxes) assert.deepEqual(box, points, size + ': the paper in points');
    assert.ok(pdf.blocks.length >= 1);
    for (const block of pdf.blocks) {
      assert.equal(block.breaks, 'avoid', size + ': a block is told not to split');
      assert.ok(block.mm < millimetres, size + ': a block ' + Math.round(block.mm) + ' mm tall in ' + Math.round(millimetres) + ' mm of page');
    }
    await closeSheet();
  }
});

// ---------------------------------------------------------------- 390 px, by touch

async function finger(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
}

async function tapOn(target, cdp, selector) {
  const at = await target.evaluate((wanted) => {
    const el = document.querySelector(wanted);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, width: box.width, height: box.height, covered: !(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
  }, selector);
  assert.ok(at, 'nothing matches ' + selector);
  assert.equal(at.covered, false, selector + ' is covered');
  assert.ok(at.height >= 44, selector + ' is ' + Math.round(at.width) + ' by ' + Math.round(at.height) + ' px: under a finger\'s 44');
  await finger(cdp, 'touchStart', at.x, at.y);
  await finger(cdp, 'touchEnd');
}

test('at 390 px with touch: the Route sheet button is a finger\'s size, the sheet is scaled to the width, Print is 44 px tall, the focus stays in the dialog and the maps are labelled', async () => {
  const phone = await openPlanner({ hash: '#building', width: 390, height: 844, mobile: true });
  const target = phone.page;
  try {
    const cdp = typeof target.createCDPSession === 'function' ? await target.createCDPSession() : await target.context().newCDPSession(target);
    assert.equal(await target.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has no coarse pointer');
    await startEmpty(target);
    const made = await buildSchool(target);
    await planReady(target);
    await openTravel(target);
    await tapOn(target, cdp, '#inspector-toggle');
    await target.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true');
    await target.click('#inspector [role="tab"][data-tab="tables"]');
    await target.waitForSelector('#inspector [data-panel="tables"] button[data-group="' + made.ada + '"]');
    await tapOn(target, cdp, '#inspector [data-panel="tables"] button[data-group="' + made.ada + '"]');
    const read = await sheetRead(target);
    assert.equal(read.output, 'route-sheet');
    const walk = read.blocks.find((block) => block.kind === 'walk');
    assert.equal(walk.label.startsWith('Route from Floor 1 to Floor 2 by Elevator '), true);
    assert.equal(walk.role, 'img');
    assert.ok(walk.maps.every((map) => map.width > 0), 'the maps have a size');
    // the page is scaled down to the phone's width, never wider than it, and the dialog does not scroll the page sideways
    const fit = await target.evaluate(() => {
      const dialog = document.getElementById('print-preview');
      const frame = dialog.querySelector('iframe');
      const box = frame.getBoundingClientRect();
      const print = dialog.querySelector('[data-action="print"]').getBoundingClientRect();
      return { scale: frame.style.transform, right: Math.round(box.right), print: Math.round(print.height), scroll: document.documentElement.scrollWidth, inside: dialog.contains(document.activeElement) };
    });
    const scale = Number(/scale\(([\d.]+)\)/.exec(fit.scale)[1]);
    assert.ok(scale < 1, 'the sheet is scaled down to fit: ' + fit.scale);
    assert.ok(fit.right <= 390, 'the scaled sheet ends inside 390 px: ' + fit.right);
    assert.ok(fit.print >= 44, 'the Print button is ' + fit.print + ' px tall');
    assert.ok(fit.scroll <= 390, 'the page does not scroll sideways');
    assert.equal(fit.inside, true, 'the focus is in the dialog');
    // Tab never leaves it
    for (let step = 0; step < 6; step += 1) {
      await target.keyboard.press('Tab');
      assert.equal(await target.evaluate(() => document.activeElement === document.body || document.getElementById('print-preview').contains(document.activeElement)), true, 'Tab ' + (step + 1) + ' stayed with the dialog');
    }
    await tapOn(target, cdp, '#print-preview [data-action="close"]');
    await target.waitForFunction(() => document.getElementById('print-preview') === null);
  } finally {
    await phone.close();
  }
});
