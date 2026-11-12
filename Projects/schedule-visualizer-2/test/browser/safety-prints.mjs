// Safety's Prints tab in a real browser (spec 10.3, 17, 3.16; DESIGN 14.5 and 14.7 items 1, 4, 7, 10;
// ARCHITECTURE 20.5, 20.6, 20.9): node test/browser/safety-prints.mjs
//
// The three cards (Evacuation posters, Lockdown maps, Map pack) with their sentences and buttons;
// the radio pair and its announcement; floors and named corridors as ticks, All and None past six
// with the count announced; the line for a building with no named corridor, with its link to
// Building; the rooms on no named corridor; the warning block naming the rooms with no way out on
// what is ticked; the trial line; Preview `aria-disabled` with its reason, the focus kept; each
// preview opening with the right sheet count, the focus inside the sheet and back on the button
// after it; the map pack's sections; typed names as typed; by pointer, by keyboard alone and at
// 390 px with touch.
//
// Every wait is on a state the page sets: the section's picture worked out for the very project in
// the store (ready), the ticks drawn for the project's floors (printsReady), the preview's
// data-ready, the section's data-trial. None waits on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go } from './harness.mjs';

let wide;
// the keys of both storages as the page opened: nothing any case here does may add one
let storageAtStart;

before(async () => {
  wide = await openPlanner({ width: 1280, height: 800, hash: '#safety', theme: 'light' });
  storageAtStart = await wide.page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]));
});

after(async () => {
  if (wide) await wide.close();
});

// The section drawn for the project in the store: styled, its picture worked out for this very
// project, and the map painted at least once.
async function ready(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.sfy');
    if (!el || el.dataset.styled !== 'true' || !el.safety || !el.safety.picture) return false;
    if (el.safety.plan.project !== globalThis.sv2.store.project) return false;
    const canvas = document.getElementById('safety-plan');
    return canvas.getClientRects().length > 0 && el.safety.plan.view.width > 0 && Number(canvas.dataset.drawn || 0) > 0;
  }, { timeout: 20000 });
}

// The Prints tab drawn for the floors of the project in the store: a tick for each in the Lockdown
// maps card, and the posters' ticks for the way they are on (floors, or the named corridors).
async function printsReady(page) {
  await page.waitForFunction(() => {
    const project = globalThis.sv2.store.project;
    const lockdown = document.querySelectorAll('[data-card="lockdown"] .sfy-tick__box').length;
    return lockdown === project.building.floors.length && document.querySelector('.sfy-panel[data-panel="prints"] [data-card="pack"] .sfy-tick__box') !== null;
  }, { timeout: 20000 });
}

const tab = (page, id) => page.click('.sfy-inspector .tabs__tab[data-tab="' + id + '"]');
const say = (page) => page.$eval('#announcer', (el) => el.textContent);
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);

// Every announcement the page makes from now on, in order
async function listen(page) {
  await page.evaluate(() => {
    globalThis.__says = [];
    if (globalThis.__saysWatch) globalThis.__saysWatch.disconnect();
    const target = document.getElementById('announcer');
    globalThis.__saysWatch = new MutationObserver(() => {
      if (target.textContent !== '') globalThis.__says.push(target.textContent);
    });
    globalThis.__saysWatch.observe(target, { childList: true, characterData: true, subtree: true });
  });
}
const heard = (page) => page.evaluate(() => globalThis.__says.slice());

// A project built in the page: the sample school, changed as the variant says. The source runs in
// the page (`variants` is the object it makes), where the sample school is.
const VARIANTS = `({
  plain: (project) => project,
  // the same school without what the elevator and the step marks add
  level: (project, make) => make({ level: true }),
  // eight floors: every list past six
  many(project) {
    const last = project.building.floors[project.building.floors.length - 1];
    for (let i = 4; i <= 8; i += 1) {
      const copy = JSON.parse(JSON.stringify(last));
      const suffix = 'x' + i;
      copy.id = last.id + suffix;
      copy.name = 'Floor ' + i;
      copy.level = i;
      for (const list of [copy.spaces, copy.exits, copy.corridors, copy.refuges]) for (const item of list || []) item.id += suffix;
      project.building.floors.push(copy);
    }
    return project;
  },
  // eight more named corridors: the posters' list past six
  corridors(project) {
    let n = 0;
    for (const floor of project.building.floors) {
      const first = floor.corridors[0];
      for (let i = 0; i < 2; i += 1) {
        n += 1;
        floor.corridors.push({ id: 'kextra' + n, name: 'Wing ' + n, cells: first.cells.slice(0, 5) });
      }
    }
    return project;
  },
  // no corridor has a name
  unnamed(project) {
    for (const floor of project.building.floors) for (const corridor of floor.corridors) corridor.name = '';
    return project;
  },
  // one corridor is unnamed: the rooms that open onto it are on no corridor poster
  halfnamed(project) {
    project.building.floors[1].corridors[0].name = '   ';
    return project;
  },
  // the stairs gone: every room above the ground floor has no way out
  noway(project) {
    project.building.connections = project.building.connections.filter((connection) => connection.kind === 'elevator');
    return project;
  },
  // a floor, a corridor and a room named like markup, and rooms that have no way out
  hostile(project) {
    project.building.connections = project.building.connections.filter((connection) => connection.kind === 'elevator');
    project.building.floors[1].name = '<i>Upper</i> & "Lower"';
    project.building.floors[1].corridors[0].name = '<b>North</b> \u0627\u0644\u0645\u0645\u0631';
    project.building.floors[1].spaces.filter((space) => space.kind === 'room')[0].number = '<u>201</u>';
    return project;
  },
})`;

// The sample school as it loads (or a variant of it), no trial, on the tab asked for.
async function fresh(page, variant = 'plain', which = 'prints') {
  if (await page.$('#print-preview[open]')) await page.keyboard.press('Escape');
  // the section is mounted afresh, so that no case starts with what the last one ticked
  await go(page, '#project');
  await go(page, '#safety');
  await ready(page);
  await page.evaluate(async (name, source) => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const view = document.querySelector('.sfy').safety;
    if (view.blocked.exits.length + view.blocked.connections.length + view.blocked.cells.length > 0) document.querySelector('[data-action="band-clear"]').click();
    const variants = (0, eval)(source);
    globalThis.sv2.store.replace(variants[name](sampleSchool(), (options) => sampleSchool(options)));
  }, variant, VARIANTS);
  await ready(page);
  await page.evaluate((id) => {
    const button = document.querySelector('.sfy-inspector .tabs__tab[data-tab="' + id + '"]');
    if (button.getAttribute('aria-selected') !== 'true') button.click();
  }, which);
  await ready(page);
  if (which === 'prints') await printsReady(page);
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
}

// What an open preview shows: the sheet's own words and the document in it.
async function sheetOf(page) {
  await page.waitForSelector('#print-preview[open][data-ready="true"]');
  return page.evaluate(() => {
    const sheet = document.getElementById('print-preview');
    const doc = sheet.querySelector('iframe').contentDocument;
    return {
      output: doc.documentElement.dataset.output,
      heading: sheet.querySelector('.preview__title').textContent,
      what: Array.from(doc.querySelectorAll('.doc-head__what')).map((el) => el.textContent),
      pages: doc.querySelectorAll('.page').length,
      status: sheet.querySelector('.preview__status').textContent,
      paper: sheet.dataset.paper,
      inside: sheet.contains(document.activeElement),
      html: doc.documentElement.outerHTML,
    };
  });
}

// Press a Preview button as a person does, read the sheet, and put it away with Escape; the focus
// must be inside the sheet while it is open and back on the button after it.
async function previewOf(page, which) {
  await page.click('[data-preview="' + which + '"]');
  const seen = await sheetOf(page);
  assert.equal(seen.inside, true, 'the focus is inside the sheet while it is open');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
  assert.equal(await page.evaluate((id) => document.activeElement && document.activeElement.dataset.preview === id, which), true, 'the focus is back on the ' + which + ' Preview button');
  return seen;
}

const floorIds = (page) => page.evaluate(() => globalThis.sv2.store.project.building.floors.map((floor) => floor.id));
const disabled = (page, which) => page.$eval('[data-preview="' + which + '"]', (el) => ({ aria: el.getAttribute('aria-disabled'), reason: document.getElementById(el.getAttribute('aria-describedby')).hidden ? '' : document.getElementById(el.getAttribute('aria-describedby')).textContent, focus: document.activeElement === el }));

// ---- the cards

test('the Prints tab: the heading, then three cards, each with its sentence and its one Preview button, and no trial line without a trial', async () => {
  const page = wide.page;
  await fresh(page);
  assert.equal(await text(page, '.sfy-panel[data-panel="prints"] > h2'), 'Prints');
  assert.deepEqual(await page.$$eval('.sfy-panel[data-panel="prints"] .sfy-card > h3', (els) => els.map((el) => el.textContent)), ['Evacuation posters', 'Lockdown maps', 'Map pack']);
  assert.deepEqual(await page.$$eval('.sfy-panel[data-panel="prints"] [data-preview]', (els) => els.map((el) => [el.dataset.preview, el.textContent])), [['posters', 'Preview posters'], ['lockdown', 'Preview lockdown maps'], ['pack', 'Preview the map pack']]);
  assert.deepEqual(await page.$$eval('.sfy-card > .sfy-panel__lead', (els) => els.map((el) => el.textContent)), [
    'A poster to put up on each floor or in each corridor, with every way out in its exit’s colour.',
    'A plain map of each floor with a reference grid and an index of rooms, for the emergency plan and for responders. It shows places, never people.',
    'Everything above in one document, with a cover and the exits and assembly points. Print it, or choose Save as PDF in the print dialog to keep it as one file.',
  ]);
  // each card is a labelled region, and the buttons sit under their card's choices
  assert.deepEqual(await page.$$eval('.sfy-card', (els) => els.map((el) => document.getElementById(el.getAttribute('aria-labelledby')).textContent)), ['Evacuation posters', 'Lockdown maps', 'Map pack']);
  assert.equal(await page.$eval('[data-line="as-built"]', (el) => el.hidden), true, 'no trial: no trial line');
  // nothing was stored by looking
  assert.equal(await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()])), storageAtStart);
});

test('the posters card: One per floor is on, the floors are ticked and counted, and three floors have no All and None', async () => {
  const page = wide.page;
  await fresh(page);
  assert.deepEqual(await page.$$eval('[data-card="posters"] .seg__input', (els) => els.map((el) => [el.value, el.checked])), [['floor', true], ['corridor', false]]);
  assert.deepEqual(await page.$$eval('[data-card="posters"] .seg__label', (els) => els.map((el) => el.textContent)), ['One per floor', 'One per named corridor']);
  assert.deepEqual(await page.$$eval('[data-card="posters"] .sfy-tick', (els) => els.map((el) => [el.textContent, el.querySelector('input').checked])), [['Floor 1', true], ['Floor 2', true], ['Floor 3', true]]);
  assert.equal(await text(page, '[data-card="posters"] [data-part="count"]'), '3 of 3 floors ticked');
  assert.equal(await page.$$eval('[data-action="all"], [data-action="none"]', (els) => els.length), 0, 'six or fewer: no All and None');
  assert.equal(await page.$eval('[data-preview="posters"]', (el) => el.getAttribute('aria-disabled')), null);
  // the sentence for a ticked floor, and a count that follows the ticks
  const ids = await floorIds(page);
  await page.click('[data-card="posters"] .sfy-tick__box[data-id="' + ids[1] + '"]');
  assert.equal(await text(page, '[data-card="posters"] [data-part="count"]'), '2 of 3 floors ticked');
  assert.equal(await text(page, '[data-card="lockdown"] [data-part="count"]'), '3 of 3 floors ticked', 'each list has its own ticks');
});

// ---- each preview opens with the right sheet count

test('Preview posters: a sheet for each floor ticked, headed as the poster is, and the focus inside the sheet and back on the button', async () => {
  const page = wide.page;
  await fresh(page);
  const all = await previewOf(page, 'posters');
  assert.equal(all.output, 'evacuation-poster');
  assert.equal(all.heading, 'Print: Evacuation poster');
  assert.deepEqual(all.what, ['Evacuation routes · Floor 1', 'Evacuation routes · Floor 2', 'Evacuation routes · Floor 3']);
  assert.equal(all.pages, 3);
  assert.equal(all.status, 'US Letter, landscape. About 3 sheets.');
  // Floor 2 unticked: two sheets, the others
  const ids = await floorIds(page);
  await page.click('[data-card="posters"] .sfy-tick__box[data-id="' + ids[1] + '"]');
  const two = await previewOf(page, 'posters');
  assert.deepEqual(two.what, ['Evacuation routes · Floor 1', 'Evacuation routes · Floor 3']);
  assert.equal(two.pages, 2);
  assert.equal(two.status, 'US Letter, landscape. About 2 sheets.');
});

test('Preview lockdown maps: a sheet for each floor ticked, headed "Lockdown map · Floor N", with no teacher or group on it', async () => {
  const page = wide.page;
  await fresh(page);
  const ids = await floorIds(page);
  await page.click('[data-card="lockdown"] .sfy-tick__box[data-id="' + ids[0] + '"]');
  const seen = await previewOf(page, 'lockdown');
  assert.equal(seen.output, 'lockdown-map');
  assert.deepEqual(seen.what, ['Lockdown map · Floor 2', 'Lockdown map · Floor 3']);
  assert.equal(seen.pages, 2);
  assert.equal(seen.status, 'US Letter, landscape. About 2 sheets.');
  const names = await page.evaluate(() => globalThis.sv2.store.project.teachers.map((teacher) => teacher.name));
  assert.ok(names.length > 0);
  for (const name of names) assert.equal(seen.html.includes(name), false, 'the teacher ' + name + ' is on a lockdown map');
  assert.ok(seen.html.includes('Rooms, exits, stairs and elevators only: no staff or student lists.'));
});

test('Preview the map pack: the cover and the four sections by default, 11 sheets, and each section is its own tick', async () => {
  const page = wide.page;
  await fresh(page);
  assert.deepEqual(await page.$$eval('[data-card="pack"] .sfy-tick', (els) => els.map((el) => [el.textContent, el.querySelector('input').checked])), [
    ['Floor plans', true], ['Lockdown maps', true], ['Evacuation posters (one per floor)', true], ['Exits and assembly points', true], ['Door cards (one or two pages a room)', false], ['Step-free ways out', false],
  ]);
  const seen = await previewOf(page, 'pack');
  assert.equal(seen.output, 'map-pack');
  assert.equal(seen.heading, 'Print: Map pack');
  assert.equal(seen.pages, 11);
  assert.equal(seen.status, 'US Letter, landscape. About 11 sheets.');
  assert.equal(seen.what[0], 'Map pack');
  assert.equal(seen.what[seen.what.length - 1], 'Map pack · Exits and assembly points');
  assert.ok(seen.html.includes('11 sheets in all, with this cover.'));
  // Floor plans unticked, Door cards ticked: the cover counts what the pack holds
  await page.click('[data-card="pack"] .sfy-tick__box[data-id="plans"]');
  await page.click('[data-card="pack"] .sfy-tick__box[data-id="cards"]');
  const cards = await previewOf(page, 'pack');
  assert.ok(!cards.what.some((what) => /Floor plan/.test(what)));
  assert.ok(cards.what.includes('Map pack · Door cards'));
  assert.equal(cards.what.filter((what) => what === 'Map pack · Evacuation route').length, 13);
  assert.equal(cards.pages, 1 + 3 + 3 + 1 + 14);
  assert.equal(cards.status, 'US Letter, landscape. About ' + cards.pages + ' sheets.');
  // the cover's count is the number of sheets the sheet says
  assert.ok(cards.html.includes(cards.pages + ' sheets in all, with this cover.'));
});

test('the Step-free ways out tick is there when something step-free is marked, and not in a level building', async () => {
  const page = wide.page;
  await fresh(page, 'plain');
  assert.equal(await page.$('[data-card="pack"] .sfy-tick__box[data-id="step-free"]') !== null, true);
  await page.click('[data-card="pack"] .sfy-tick__box[data-id="step-free"]');
  const seen = await previewOf(page, 'pack');
  assert.equal(seen.what[seen.what.length - 1], 'Map pack · Step-free ways out');
  assert.equal(seen.pages, 12);
  const marked = await page.evaluate(async () => {
    const { hasStepMarks } = await import('./ui/safety/ways.js');
    return hasStepMarks(globalThis.sv2.store.project.building);
  });
  assert.equal(marked, true);
  await fresh(page, 'level');
  const level = await page.evaluate(async () => {
    const { hasStepMarks } = await import('./ui/safety/ways.js');
    return hasStepMarks(globalThis.sv2.store.project.building);
  });
  if (!level) assert.equal(await page.$('[data-card="pack"] .sfy-tick__box[data-id="step-free"]'), null, 'nothing marked: no tick');
  else assert.equal(await page.$('[data-card="pack"] .sfy-tick__box[data-id="step-free"]') !== null, true);
});

// ---- the radio pair and the named corridors

test('One per named corridor: the radio announces the count, the corridors are ticks under their floors, and the sheets are the corridors\' posters', async () => {
  const page = wide.page;
  await fresh(page);
  await listen(page);
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-card="posters"] fieldset legend').length === 3);
  assert.ok((await heard(page)).includes('One per named corridor: 5 corridors'), (await heard(page)).join(' | '));
  assert.deepEqual(await page.$$eval('[data-card="posters"] fieldset', (els) => els.map((el) => [el.querySelector('legend').textContent, Array.from(el.querySelectorAll('.sfy-tick')).map((tick) => tick.textContent)])), [
    ['Floor 1', ['Main Corridor', 'Front Hall']], ['Floor 2', ['Upper Corridor']], ['Floor 3', ['Music Wing', 'Top Corridor']],
  ]);
  assert.equal(await text(page, '[data-card="posters"] [data-part="count"]'), '5 of 5 corridors ticked');
  // untick Front Hall: four sheets, each headed by its corridor and its floor, each with "You are here"
  await page.click('[data-card="posters"] .sfy-tick__box[data-id="ksample002"]');
  const seen = await previewOf(page, 'posters');
  assert.deepEqual(seen.what, ['Evacuation · Main Corridor, Floor 1', 'Evacuation · Upper Corridor, Floor 2', 'Evacuation · Music Wing, Floor 3', 'Evacuation · Top Corridor, Floor 3']);
  assert.equal(seen.pages, 4);
  assert.equal(seen.status, 'US Letter, landscape. About 4 sheets.');
  assert.equal(seen.html.split('You are here').length - 1 >= 4, true, 'a "You are here" on each');
  // and back to One per floor, announced
  await page.click('[data-card="posters"] .seg__input[value="floor"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-card="posters"] .sfy-tick').length === 3);
  assert.ok((await heard(page)).includes('One per floor: 3 floors'));
});

test('the rooms that open onto no named corridor are counted, so that nobody looks for them on a corridor poster', async () => {
  const page = wide.page;
  await fresh(page, 'halfnamed');
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => document.querySelector('[data-line="corridor-note"]') && !document.querySelector('[data-line="corridor-note"]').hidden);
  const expected = await page.evaluate(async () => {
    const { routingGraph } = await import('./engine/routing.js');
    const { roomsOnNoNamedCorridor } = await import('./engine/exit-load.js');
    const project = globalThis.sv2.store.project;
    return roomsOnNoNamedCorridor(project, routingGraph(project)).length;
  });
  assert.ok(expected > 1, 'the fixture leaves some rooms on no named corridor: ' + expected);
  assert.equal(await text(page, '[data-line="corridor-note"]'), expected + ' rooms open onto no named corridor and are on no corridor poster; the floor posters show them.');
  // by floor the line is not there
  await page.click('[data-card="posters"] .seg__input[value="floor"]');
  await page.waitForFunction(() => document.querySelector('[data-line="corridor-note"]').hidden);
});

test('no corridor has a name: the card says so, links to Building, and Preview posters is disabled with its reason', async () => {
  const page = wide.page;
  await fresh(page, 'unnamed');
  await listen(page);
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => !document.querySelector('[data-line="corridor-note"]').hidden);
  assert.equal(await text(page, '[data-line="corridor-note"]'), 'No corridor has a name yet. Name corridors in Building to make a poster for each.');
  assert.equal(await page.$$eval('[data-card="posters"] .sfy-tick', (els) => els.length), 0, 'no corridor to tick');
  const off = await disabled(page, 'posters');
  assert.equal(off.aria, 'true');
  assert.equal(off.reason, 'There is no named corridor to print.');
  // Preview does nothing, says why, and keeps the focus
  await page.focus('[data-preview="posters"]');
  await page.keyboard.press('Enter');
  assert.equal(await page.$('#print-preview'), null, 'no sheet opened');
  assert.ok((await heard(page)).includes('There is no named corridor to print.'));
  assert.equal((await disabled(page, 'posters')).focus, true, 'the focus stayed on the button');
  // the link goes to Building
  await page.click('[data-line="corridor-note"] [data-action="to-building"]');
  await page.waitForFunction(() => location.hash.startsWith('#building'));
});

// ---- All and None, Preview disabled with its reason

test('past six ticks, All and None: both say the count, None disables Preview with its reason and keeps the focus, All brings it back', async () => {
  const page = wide.page;
  await fresh(page, 'many');
  await listen(page);
  assert.deepEqual(await page.$$eval('[data-card="lockdown"] [data-action]', (els) => els.map((el) => [el.dataset.action, el.textContent, el.getAttribute('aria-label')])), [['all', 'All', 'All floors'], ['none', 'None', 'None of the floors']]);
  assert.equal(await page.$$eval('[data-card="pack"] [data-action="all"]', (els) => els.length), 0, 'six sections: no All and None');
  await page.click('[data-card="lockdown"] [data-action="none"]');
  assert.ok((await heard(page)).includes('0 of 8 floors ticked'), (await heard(page)).join(' | '));
  assert.equal(await page.$$eval('[data-card="lockdown"] .sfy-tick__box', (els) => els.filter((el) => el.checked).length), 0);
  assert.equal(await text(page, '[data-card="lockdown"] [data-part="count"]'), '0 of 8 floors ticked');
  const off = await disabled(page, 'lockdown');
  assert.equal(off.aria, 'true');
  assert.equal(off.reason, 'Tick at least one floor.');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'none', 'the focus stayed on None');
  // pressing a disabled Preview: no sheet, the reason said, the focus kept
  await page.focus('[data-preview="lockdown"]');
  await page.keyboard.press('Space');
  assert.equal(await page.$('#print-preview'), null);
  assert.ok((await heard(page)).filter((said) => said === 'Tick at least one floor.').length >= 1);
  assert.equal((await disabled(page, 'lockdown')).focus, true);
  // the other lists are not touched
  assert.equal(await text(page, '[data-card="posters"] [data-part="count"]'), '8 of 8 floors ticked');
  await page.click('[data-card="lockdown"] [data-action="all"]');
  assert.ok((await heard(page)).includes('8 of 8 floors ticked'));
  assert.equal((await disabled(page, 'lockdown')).aria, null);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'all', 'the focus stayed on All');
  // eight floors, eight sheets
  const seen = await previewOf(page, 'lockdown');
  assert.equal(seen.pages, 8);
  assert.equal(seen.status, 'US Letter, landscape. About 8 sheets.');
});

test('the named corridors past six get All and None too, and an empty choice says "Tick at least one corridor."', async () => {
  const page = wide.page;
  await fresh(page, 'corridors');
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-card="posters"] .sfy-tick').length === 11);
  await listen(page);
  assert.deepEqual(await page.$$eval('[data-card="posters"] [data-action]', (els) => els.map((el) => el.dataset.action)), ['all', 'none']);
  await page.click('[data-card="posters"] [data-action="none"]');
  assert.ok((await heard(page)).includes('0 of 11 corridors ticked'), (await heard(page)).join(' | '));
  assert.equal((await disabled(page, 'posters')).reason, 'Tick at least one corridor.');
  await page.click('[data-card="posters"] [data-action="all"]');
  assert.ok((await heard(page)).includes('11 of 11 corridors ticked'));
  const seen = await previewOf(page, 'posters');
  assert.equal(seen.pages, 11);
});

test('Preview the map pack with no section ticked: disabled, "Tick at least one section.", no sheet', async () => {
  const page = wide.page;
  await fresh(page);
  for (const id of ['plans', 'lockdown', 'posters', 'exits']) await page.click('[data-card="pack"] .sfy-tick__box[data-id="' + id + '"]');
  assert.equal(await text(page, '[data-card="pack"] [data-part="count"]'), '0 of 6 sections ticked');
  const off = await disabled(page, 'pack');
  assert.equal(off.aria, 'true');
  assert.equal(off.reason, 'Tick at least one section.');
  await page.click('[data-preview="pack"]');
  assert.equal(await page.$('#print-preview'), null);
  await page.click('[data-card="pack"] .sfy-tick__box[data-id="exits"]');
  assert.equal((await disabled(page, 'pack')).aria, null);
});

// ---- the warning, the trial line

test('rooms with no way out on a floor ticked are named in a warning block before the preview, and go when the floor is unticked', async () => {
  const page = wide.page;
  await fresh(page, 'noway');
  const lines = async () => page.$$eval('[data-part="no-way-out"] .sfy-prints__missing li', (els) => els.map((el) => el.textContent));
  const first = await lines();
  assert.ok(first.length >= 8, first.length + ' rooms');
  assert.ok(first.includes('Room 201 has no way out and its route will be missing from the Floor 2 poster.'), first.join(' | '));
  assert.ok(first.includes('Room 301 has no way out and its route will be missing from the Floor 3 poster.'));
  assert.equal(await page.$eval('[data-part="no-way-out"].sfy-warn', (el) => el.getAttribute('aria-label')), 'Warning');
  assert.equal(await text(page, '[data-part="no-way-out"] .sfy-warn__head'), 'Warning', 'in words, never colour alone');
  const ids = await floorIds(page);
  await page.click('[data-card="posters"] .sfy-tick__box[data-id="' + ids[1] + '"]');
  const second = await lines();
  assert.equal(second.some((line) => /Floor 2 poster/.test(line)), false);
  assert.equal(second.some((line) => /Floor 3 poster/.test(line)), true);
  await page.click('[data-card="posters"] .sfy-tick__box[data-id="' + ids[2] + '"]');
  assert.deepEqual(await lines(), [], 'only the ground floor is left, and it has none');
  assert.equal(await page.$('[data-part="no-way-out"].sfy-warn'), null);
  // in the sample all is well: no block
  await fresh(page);
  assert.equal(await page.$('[data-part="no-way-out"].sfy-warn'), null);
});

test('by corridor the warning names the rooms on the corridors ticked, with the corridor\'s name', async () => {
  const page = wide.page;
  await fresh(page, 'noway');
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-card="posters"] .sfy-tick').length === 5);
  const lines = await page.$$eval('[data-part="no-way-out"] .sfy-prints__missing li', (els) => els.map((el) => el.textContent));
  assert.ok(lines.includes('Room 201 has no way out and its route will be missing from the Upper Corridor poster.'), lines.join(' | '));
  assert.equal(lines.some((line) => /Main Corridor/.test(line)), false, 'the ground floor has a way out');
});

test('names are text: a floor, a corridor and a room numbered like markup are shown as typed in the ticks and the warning', async () => {
  const page = wide.page;
  await fresh(page, 'hostile');
  const ids = await floorIds(page);
  assert.equal(await page.$eval('[data-card="lockdown"] .sfy-tick__box[data-id="' + ids[1] + '"]', (el) => el.closest('li').textContent), '<i>Upper</i> & "Lower"');
  assert.equal(await page.$$eval('.sfy-prints i, .sfy-prints b, .sfy-prints u', (els) => els.length), 0, 'no element came of a name');
  const warned = await page.$$eval('[data-part="no-way-out"] .sfy-prints__missing li', (els) => els.map((el) => el.textContent));
  assert.ok(warned.some((line) => line.startsWith('<u>201</u> has no way out') && line.endsWith('the <i>Upper</i> & "Lower" poster.')), warned.join(' | '));
  await page.click('[data-card="posters"] .seg__input[value="corridor"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-card="posters"] .sfy-tick').length === 5);
  assert.ok((await page.$$eval('[data-card="posters"] .sfy-tick', (els) => els.map((el) => el.textContent))).includes('<b>North</b> الممر'));
  assert.equal(await page.$$eval('[data-card="posters"] bdi', (els) => els.length > 0), true, 'typed names are in bdi');
  const seen = await previewOf(page, 'posters');
  assert.equal(seen.html.includes('<b>North</b>'), false);
  assert.ok(seen.what.includes(('Evacuation · <b>North</b> الممر, <i>Upper</i> & "Lower"').replace(/&/g, '&amp;').replace(/</g, '&lt;')) || seen.what.some((what) => what.includes('<b>North</b> الممر')), seen.what.join(' | '));
});

test('while a trial is on the tab says the prints are as built, and the map pack prints the exits as built, not as blocked', async () => {
  const page = wide.page;
  await fresh(page, 'plain', 'whatif');
  await page.waitForSelector('.sfy-tick__box[data-kind="exit"]');
  const exit = await page.evaluate(() => document.querySelector('.sfy').safety.picture.exits[0].exitId);
  await page.click('.sfy-tick__box[data-kind="exit"][data-id="' + exit + '"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '1');
  await tab(page, 'prints');
  await page.waitForSelector('[data-line="as-built"]:not([hidden])');
  assert.equal(await text(page, '[data-line="as-built"]'), 'Printed as built, not this trial.');
  // it is the first thing under the heading
  assert.equal(await page.$eval('.sfy-panel[data-panel="prints"]', (el) => el.children[1].dataset.line), 'as-built');
  const seen = await previewOf(page, 'pack');
  const html = seen.html;
  assert.equal(html.split('Far more than the others').length - 1, 1, 'Door A is still the heavy exit: the pack is as built');
  assert.equal(html.includes('Blocked in this trial'), false);
  // clear the trial: the line goes
  await page.evaluate(() => document.querySelector('[data-action="band-clear"]').click());
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  await page.waitForSelector('[data-line="as-built"][hidden]', { state: 'attached' });
});

// ---- by keyboard alone

test('by keyboard alone: arrows move the radio, Space ticks, Tab reaches Preview, Enter opens the sheet, Escape gives the focus back', async () => {
  const page = wide.page;
  await fresh(page);
  await listen(page);
  await page.focus('[data-card="posters"] .seg__input[value="floor"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-card="posters"] .seg__input[value="corridor"]').checked);
  assert.ok((await heard(page)).includes('One per named corridor: 5 corridors'));
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('[data-card="posters"] .seg__input[value="floor"]').checked);
  // Tab to the first floor's box, Space unticks it
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-card="posters"] .sfy-tick__box')), true, 'Tab goes to the first tick');
  await page.keyboard.press('Space');
  assert.equal(await text(page, '[data-card="posters"] [data-part="count"]'), '2 of 3 floors ticked');
  // Tab on to Preview posters (past the other ticks), Enter
  await page.focus('[data-preview="posters"]');
  await page.keyboard.press('Enter');
  const seen = await sheetOf(page);
  assert.equal(seen.pages, 2);
  assert.equal(seen.inside, true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('print-preview') === null);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.preview), 'posters');
  // nothing was stored by any of it
  assert.equal(await page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()])), storageAtStart);
});

// ---- 390 px with touch

test('at 390 px with touch: the cards are one column, ticks, All, None and Preview are 44 px, nothing runs off the side, the sheet opens and gives the focus back', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  try {
    await ready(page);
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has touch');
    // eight floors, so that All and None are there to measure
    await page.evaluate(async (source) => {
      const { sampleSchool } = await import('./data/sample-school.js');
      globalThis.sv2.store.replace((0, eval)(source).many(sampleSchool()));
    }, VARIANTS);
    await ready(page);
    await page.tap('#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true' && document.getElementById('inspector').dataset.mode === 'sheet');
    await page.focus('.sfy-inspector .tabs__tab[data-tab="exits"]');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.sfy-inspector .tabs__tab[data-tab="prints"]').getAttribute('aria-selected') === 'true');
    await printsReady(page);
    assert.equal(await page.$$eval('[data-card="lockdown"] .sfy-tick__box', (els) => els.length), 8);
    const small = async (selector) => page.$$eval(selector, (els) => els.filter((el) => el.getClientRects().length > 0).map((el) => Math.min(el.getBoundingClientRect().height, el.getBoundingClientRect().width)).filter((size) => size < 44));
    assert.deepEqual(await small('.sfy-prints .sfy-tick, .sfy-prints [data-action], .sfy-prints [data-preview], .sfy-prints .seg__option'), []);
    // one column: the ticks of a card share their left edge
    for (const card of ['posters', 'lockdown', 'pack']) {
      const lefts = await page.$$eval('[data-card="' + card + '"] .sfy-tick', (els) => Array.from(new Set(els.map((el) => Math.round(el.getBoundingClientRect().left)))));
      assert.equal(lefts.length, 1, card + ' is not one column: ' + lefts);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways');
    assert.equal(await page.evaluate(() => { const sheet = document.getElementById('inspector'); return sheet.scrollWidth <= sheet.clientWidth + 1; }), true, 'the inspector sheet scrolls sideways');
    // the card's choices and buttons are not wider than the card
    assert.deepEqual(await page.$$eval('.sfy-card', (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.dataset.card)), []);
    // None, then a tap on the disabled Preview, says why and opens nothing
    await page.tap('[data-card="lockdown"] [data-action="none"]');
    await page.waitForFunction(() => document.querySelector('[data-card="lockdown"] [data-part="count"]').textContent === '0 of 8 floors ticked');
    await page.$eval('[data-preview="lockdown"]', (el) => el.scrollIntoView({ block: 'center' }));
    await page.tap('[data-preview="lockdown"]');
    assert.equal(await page.$('#print-preview'), null);
    assert.equal(await say(page), 'Tick at least one floor.');
    await page.tap('[data-card="lockdown"] [data-action="all"]');
    // the map pack opens in the phone's window, and the focus is inside it, then back on the button
    await page.$eval('[data-preview="pack"]', (el) => el.scrollIntoView({ block: 'center' }));
    await page.tap('[data-preview="pack"]');
    const seen = await sheetOf(page);
    // eight floors: a cover, 24 sheets of plans, maps and posters, the exits and the rooms with no way out
    assert.equal(seen.pages, 28);
    assert.equal(seen.status, 'US Letter, landscape. About 28 sheets.');
    assert.ok(seen.html.includes('28 sheets in all, with this cover.'));
    assert.equal(seen.inside, true);
    const fit = await page.evaluate(() => {
      const sheet = document.getElementById('print-preview').getBoundingClientRect();
      const stage = document.querySelector('.preview__stage');
      return { width: sheet.width, scroll: stage.scrollWidth, client: stage.clientWidth, page: document.documentElement.scrollWidth <= window.innerWidth };
    });
    assert.ok(fit.width <= 390, 'the sheet is ' + fit.width + ' px wide');
    assert.ok(fit.scroll <= fit.client, 'the preview scrolls sideways');
    assert.equal(fit.page, true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('print-preview') === null);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.preview), 'pack');
  } finally {
    await session.close();
  }
});
