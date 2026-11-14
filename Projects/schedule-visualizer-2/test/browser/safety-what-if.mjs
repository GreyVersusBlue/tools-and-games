// Safety's load warning and What if tab in a real browser (spec 10.1, 3.10, 3.11;
// DESIGN 14.1 to 14.4, 14.7; SV2-109): node test/browser/safety-what-if.mjs
//
// The Exits tab's warning block (the sample's Door A carries 81 % of 640 people), row words, rule
// line and the exit numbers the engine gives; the five tabs and their label; the What if tab:
// ticking an exit or stairs, the band above the map on every tab with its words and Clear, the
// results with their hidden words, Show, the "2 blocked" announcement, "Use the scenario's closures"
// with its chips, Clear and where the focus goes; the cross on the map; the Step-free view and
// Door cards under a trial; a trial that survives a move to Schedule and back, is let go when
// another project opens, and drops a blocked stairs a building change took away, saying so once.
// By pointer, by keyboard alone, and at 390 px with touch.
//
// Every wait is on a state the page sets: the section's picture worked out for the very project
// in the store and the map painted since a count (ready), the trial the section holds
// (el.safety.trial, the data-trial the section sets), a control's box at rest (atRest). None
// waits on a first paint or a fixed sleep.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { openPlanner, go, atRest } from './harness.mjs';

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
const say = (page) => page.$eval('#announcer', (el) => el.textContent);
const line = (page) => page.$eval('#safety-line .mov-line__words', (el) => el.textContent);
const tab = (page, id) => page.click('.sfy-inspector .tabs__tab[data-tab="' + id + '"]');
const text = (page, selector) => page.$eval(selector, (el) => el.textContent);
const trialOn = (page) => page.$eval('.sfy', (el) => el.dataset.trial);

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

// Back to the sample school as it loads, no trial, every room shown, on the tab asked for.
async function fresh(page, which = 'exits', variant) {
  if (await page.$('#print-preview[open]')) await page.keyboard.press('Escape');
  await go(page, '#safety');
  await ready(page);
  await page.evaluate(async (mode) => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const project = sampleSchool();
    if (mode === 'corridor') {
      const floor = project.building.floors[1];
      project.scenario = { name: 'Closures', changes: [], compared: null, levers: [{ kind: 'corridor', floorId: floor.id, cells: floor.corridors[0].cells.slice(0, 6), name: 'North Corridor' }] };
    }
    if (mode === 'scenario') {
      const floor = project.building.floors[1];
      const corridor = floor.corridors[0];
      project.scenario = { name: 'Closures', changes: [], compared: null, levers: [
        { kind: 'way', connectionId: 'csample00b', way: 'closed' },
        { kind: 'corridor', floorId: floor.id, cells: corridor.cells.slice(0, 6), name: 'North <b>Corridor</b>' },
      ] };
    }
    const view = document.querySelector('.sfy').safety;
    if (view.blocked.exits.length + view.blocked.connections.length + view.blocked.cells.length > 0) document.querySelector('[data-action="band-clear"]').click();
    globalThis.sv2.store.replace(project);
  }, variant || 'plain');
  await ready(page);
  await page.evaluate((id) => {
    const view = document.querySelector('.sfy').safety;
    view.pick(null);
    view.setView('everyone');
    const button = document.querySelector('.sfy-inspector .tabs__tab[data-tab="' + id + '"]');
    if (button.getAttribute('aria-selected') !== 'true') button.click();
  }, which);
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
}

// Tick one thing on the What if tab, as a person would, and wait for the trial to hold it
async function tickBox(page, kind, id) {
  await page.click('.sfy-tick__box[data-kind="' + kind + '"][data-id="' + id + '"]');
  await page.waitForFunction((k, i) => {
    const set = document.querySelector('.sfy').safety.blocked;
    return (k === 'exit' ? set.exits : set.connections).includes(i);
  }, {}, kind, id);
}

// The gap between each typed name in the ticks and the comma that follows it, in px, for every tick
// whose label has one: [] when none is wider than a pixel (a flex gap between a name and its comma was 4 px)
async function commaGaps(page) {
  return page.evaluate(() => {
    const found = [];
    let checked = 0;
    for (const label of document.querySelectorAll('.sfy-tick__label')) {
      for (const bdi of label.querySelectorAll('bdi')) {
        const next = bdi.nextSibling;
        if (!next || next.nodeType !== Node.TEXT_NODE || !next.nodeValue.startsWith(',')) continue;
        checked += 1;
        const range = document.createRange();
        range.setStart(next, 0);
        range.setEnd(next, 1);
        const gap = Math.abs(range.getBoundingClientRect().left - bdi.getBoundingClientRect().right);
        const gapRtl = Math.abs(range.getBoundingClientRect().right - bdi.getBoundingClientRect().left);
        if (Math.min(gap, gapRtl) > 1) found.push(label.textContent + ': ' + Math.min(gap, gapRtl).toFixed(1) + ' px');
      }
    }
    if (checked === 0) found.push('no tick has a typed name followed by a comma');
    return found;
  });
}

const FIRST_EXIT = async (page) => page.evaluate(() => document.querySelector('.sfy').safety.picture.exits[0].exitId);

// ---- the tabs and the Exits tab

test('the tablist is labelled Safety and holds Exits, Door cards, Step-free, What if and Prints, the last a panel with its heading first (SV2-111 filled it)', async () => {
  const page = wide.page;
  await fresh(page);
  assert.equal(await page.$eval('.sfy-inspector [role="tablist"]', (el) => el.getAttribute('aria-label')), 'Safety');
  assert.deepEqual(await page.$$eval('.sfy-inspector .tabs__tab', (els) => els.map((el) => [el.dataset.tab, el.textContent])), [
    ['exits', 'Exits'], ['cards', 'Door cards'], ['stepfree', 'Step-free'], ['whatif', 'What if'], ['prints', 'Prints'],
  ]);
  await tab(page, 'prints');
  await page.waitForSelector('.sfy-panel[data-panel="prints"]');
  // SV2-111 mounts the three cards under the heading (test/browser/safety-prints.mjs reads them)
  assert.equal(await page.$eval('.sfy-panel[data-panel="prints"]', (el) => el.firstElementChild.tagName + ':' + el.firstElementChild.textContent), 'H2:Prints');
});

test('the Exits tab: the sample\'s Door A is flagged in a warning block with its sentence, advice and the rule, and Door B is not', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  const block = await page.$eval('[data-part="load-warning"]', (el) => ({
    head: el.querySelector('.sfy-warn__head').textContent,
    sentence: el.querySelector('[data-part="load-sentence"]').textContent,
    advice: el.querySelector('.sfy-warn__advice').textContent,
    rule: el.querySelector('[data-part="load-rule"]').textContent,
    label: el.getAttribute('aria-label'),
  }));
  assert.equal(block.head, 'Warning');
  assert.equal(block.label, 'Warning');
  assert.equal(block.sentence, 'Door A (1) is the way out for rooms holding 520 of 640 people at full capacity, 81 %, where an even share of the 2 exits would be 320.');
  assert.equal(block.advice, 'The tool does not know door widths. Check this door and the way to it in your next drill.');
  assert.equal(block.rule, 'Why: an exit is flagged when its share is 1.6 times an even share and at least 50 people more.');
  const words = await page.$$eval('.sfy-exit', (rows) => rows.map((row) => [row.querySelector('.sfy-exit__name bdi').textContent, row.querySelector('[data-part="heavy"]') ? row.querySelector('[data-part="heavy"]').textContent : null]));
  assert.deepEqual(words, [['Door A', 'Far more than the others'], ['Door B', null]]);
  // the figures keep their words beside the warning
  assert.match(await text(page, '.sfy-exit[data-exit] .sfy-exit__where'), /^On Floor 1\. 12 rooms, 520 people\. Far more than the others$/);
  // no trial: no "was" and no "Blocked in this trial"
  assert.equal(await page.$$eval('[data-part="was"], [data-part="blocked"]', (els) => els.length), 0);
  assert.equal(await page.$eval('[data-part="band"]', (el) => el.hidden), true);
});

test('exit numbers on screen are the engine\'s exitNumbers: the Exits tab, the key under the map and the What if ticks', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  const seen = await page.evaluate(async () => {
    const { exitNumbers } = await import('./engine/exit-load.js');
    const numbers = exitNumbers(globalThis.sv2.store.project);
    const swatches = (selector) => Array.from(document.querySelectorAll(selector)).map((el) => [el.closest('[data-exit]').dataset.exit, Number(el.textContent)]);
    return { engine: Array.from(numbers), rows: swatches('.sfy-exit .sfy-swatch'), key: swatches('.sfy-key__item .sfy-swatch') };
  });
  assert.deepEqual(seen.rows, seen.engine);
  assert.deepEqual(seen.key, seen.engine);
  await tab(page, 'whatif');
  const ticks = await page.$$eval('.sfy-tick[data-kind="exit"]', (els) => els.map((el) => [el.dataset.id, Number(el.querySelector('.sfy-swatch').textContent)]));
  assert.deepEqual(ticks, seen.engine);
});

// ---- the What if tab by pointer

test('the What if tab: its heading and lead, the exits and the stairs by floor with their floors, the elevator and corridor lines, nothing blocked', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  assert.equal(await text(page, '.sfy-whatif .mov-panel__title'), 'What if an exit or stairs is blocked?');
  assert.match(await text(page, '.sfy-whatif .sfy-panel__lead'), /^Tick what cannot be used\. The map, Exits and Step-free then show how every room gets out without it\. This is a trial: nothing in the building changes, door cards and posters print the building as it is, and the trial stays while you move around the planner and is forgotten when you close the page or open another project\.$/);
  const exits = await page.$$eval('.sfy-tick[data-kind="exit"] label', (els) => els.map((el) => el.textContent));
  assert.deepEqual(exits, ['1Exit 1: Door A, Floor 1', '2Exit 2: Door B, Floor 1']);
  // no gap opens between a typed name and the comma after it: the words are one run of text, not flex items
  assert.deepEqual(await commaGaps(page), []);
  // the stairs are grouped by floor, each named with its floors; the chained stairwell's connections each their own row
  const groups = await page.$$eval('.sfy-ticks--floor', (els) => els.map((el) => [el.querySelector('legend').textContent, Array.from(el.querySelectorAll('label')).map((label) => label.textContent)]));
  assert.deepEqual(groups, [['Stairs from Floor 1', ['Stairs A, Floor 1 to Floor 2', 'Stairs C, Floor 1 to Floor 2']], ['Stairs from Floor 2', ['Stairs B, Floor 2 to Floor 3']]]);
  assert.equal(await text(page, '[data-line="elevators-not-listed"]'), 'Elevators are not listed: an evacuation never uses them.');
  assert.equal(await text(page, '[data-line="corridors"]'), 'To block a corridor, close it in a scenario and press Use the scenario’s closures.');
  assert.equal(await page.$eval('[data-action="use-scenario"]', (el) => el.hidden), true, 'no scenario, no button');
  assert.equal(await page.$eval('[data-action="clear-trial"]', (el) => el.hidden), true, 'nothing to clear');
  assert.equal(await text(page, '[data-part="results"] [data-part="sentence"]'), 'Nothing is blocked. Tick an exit or stairs above to see how the rooms would go out without it.');
  // a tick is 44 px high
  assert.deepEqual(await page.$$eval('.sfy-tick', (els) => els.map((el) => el.getBoundingClientRect().height).filter((height) => height < 44)), []);
});

test('ticking Stairs B: the band says so on every tab, the first line is the trial\'s sentence, the rooms on Floor 3 have no way out, and Clear puts it all back and the focus on the first tick', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await listen(page);
  const was = await drawn(page);
  await tickBox(page, 'stairs', 'csample00b');
  await ready(page, was);
  assert.equal(await trialOn(page), '1');
  // the focus stays on the tick, and the live region says how many and the sentence
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'csample00b');
  await page.waitForFunction(() => /^1 blocked\. If Stairs B, Floor 2 to Floor 3 is blocked: /.test(document.getElementById('announcer').textContent));
  // the band and the first line
  assert.equal(await page.$eval('[data-part="band"]', (el) => el.hidden), false);
  assert.equal(await text(page, '[data-part="band-words"]'), 'Trial: Stairs B blocked');
  const sentence = await text(page, '[data-part="results"] .sfy-results__sentence');
  assert.match(sentence, /^If Stairs B, Floor 2 to Floor 3 is blocked: /);
  assert.equal(await line(page), sentence, 'the screen\'s first line is the trial\'s sentence');
  // the band is above the map, never over it
  const boxes = await page.evaluate(() => ({ band: document.querySelector('[data-part="band"]').getBoundingClientRect().bottom, map: document.getElementById('safety-plan').getBoundingClientRect().top }));
  assert.ok(boxes.band <= boxes.map + 1, 'the band ends at ' + boxes.band + ' and the map begins at ' + boxes.map);
  // results: the rooms with no way out, each with noRoute's words and Show
  const lost = await page.$$eval('[data-list="lost"] .sfy-row', (rows) => rows.map((row) => [row.dataset.room, row.querySelector('.sfy-row__way').textContent]));
  assert.ok(lost.length >= 1, 'Floor 3 has rooms');
  assert.ok(lost.every(([, why]) => why.length > 10), JSON.stringify(lost));
  assert.equal(await page.$eval('[data-list="lost"]', (el) => el.dataset.count), String(lost.length));
  // the band is on every tab
  for (const id of ['exits', 'cards', 'stepfree', 'prints']) {
    await tab(page, id);
    await page.waitForSelector('.sfy-panel[data-panel="' + (id === 'exits' ? 'exits' : id) + '"]');
    assert.equal(await page.$eval('[data-part="band"]', (el) => el.getClientRects().length > 0), true, 'no band on ' + id);
  }
  // Clear on the What if tab: nothing blocked, the focus on the first tick
  await tab(page, 'whatif');
  await page.click('[data-action="clear-trial"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await page.$eval('.sfy', (el) => el.safety.trial), null);
  assert.equal(await page.$eval('[data-part="band"]', (el) => el.hidden), true);
  assert.equal(await page.evaluate(() => document.activeElement.className + ':' + document.activeElement.dataset.id), 'sfy-tick__box:' + (await FIRST_EXIT(page)));
  assert.equal(await page.$$eval('.sfy-tick__box:checked', (els) => els.length), 0);
  assert.equal(await say(page), 'The trial is cleared: every room goes out the way it did.');
  assert.match(await line(page), /^Every room’s way out, coloured by the exit it uses: 13 rooms to 2 exits\./);
});

test('blocking Door A: "2 blocked" with Stairs B, the Exits tab says Blocked in this trial and was, Door B is the only exit left open, and the results carry hidden words for their arrows', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  const doorA = await FIRST_EXIT(page);
  await tickBox(page, 'exit', doorA);
  await page.waitForFunction(() => /^1 blocked\. If Door A is blocked: /.test(document.getElementById('announcer').textContent));
  await tickBox(page, 'stairs', 'csample00b');
  await page.waitForFunction(() => /^2 blocked\. If Door A and Stairs B, Floor 2 to Floor 3 are blocked: /.test(document.getElementById('announcer').textContent));
  assert.equal(await text(page, '[data-part="band-words"]'), 'Trial: Door A and Stairs B blocked');
  assert.equal(await text(page, '[data-part="band-short"]'), 'Trial · 2 blocked');
  // the rooms that go out another way: biggest change first, each with words for the arrows
  const moved = await page.$$eval('[data-list="moved"] .sfy-row', (rows) => rows.map((row) => ({ room: row.dataset.room, seen: row.querySelector('.sfy-row__way [aria-hidden="true"]').textContent, said: row.querySelector('.sfy-row__way .vh').textContent })));
  assert.ok(moved.length >= 1, 'Door A was the way out of twelve rooms');
  const one = moved.find((row) => row.room === 'rsample101');
  assert.ok(one, 'Room 101 goes out another way: ' + JSON.stringify(moved.map((row) => row.room)));
  assert.match(one.seen, /^Door A \(1\) → Door B \(2\) · .+ → .+$/);
  assert.match(one.said, /^Room 101: was Door A, now Door B; \d+ (seconds?|minutes?)( \d+ seconds?)?, now \d+ (seconds?|minutes?)( \d+ seconds?)?$/);
  // the exits' table: figures before → after, Door A blocked
  const rows = await page.$$eval('.sfy-table__row', (all) => all.map((row) => ({ exit: row.dataset.exit, blocked: row.dataset.blocked, rooms: row.querySelector('.sfy-table__rooms [aria-hidden="true"]').textContent, note: row.querySelector('.sfy-table__note').textContent })));
  assert.equal(rows[0].blocked, 'true');
  assert.equal(rows[0].note, 'Blocked in this trial');
  assert.match(rows[0].rooms, /^12 → 0$/);
  // the Exits tab: was, and the blocked exit's row
  await tab(page, 'exits');
  await page.waitForSelector('.sfy-panel[data-panel="exits"] [data-part="blocked"]');
  assert.equal(await text(page, '.sfy-exit[data-exit="' + doorA + '"] [data-part="blocked"]'), 'Blocked in this trial.');
  assert.equal(await text(page, '.sfy-exit[data-exit="' + doorA + '"] [data-part="was"]'), ' Was 12 rooms, 520 people.');
  assert.equal(await page.$eval('[data-part="load-note"]', (el) => el.textContent), 'Every room leaves by Door B: it is the only exit not blocked.');
  assert.equal(await page.$$eval('[data-part="load-warning"]', (els) => els.length), 0, 'a blocked exit is never flagged and one open exit has no even share');
  // Door B's row names its figures and what they were
  assert.match(await text(page, '.sfy-exit:nth-child(2) [data-part="was"]'), /^ Was 1 room, 120 people\.$/);
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('Show on a result row keeps the focus, picks the room on the map and says so; the key marks a blocked exit', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample00b');
  await page.waitForSelector('[data-list="lost"] .sfy-row__show');
  const room = await page.$eval('[data-list="lost"] .sfy-row', (el) => el.dataset.room);
  const name = await page.$eval('[data-list="lost"] .sfy-row .sfy-row__name', (el) => el.textContent);
  await page.focus('[data-list="lost"] .sfy-row__show[data-room="' + room + '"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sfy[data-picked="' + room + '"]');
  assert.equal(await say(page), name + ' shown on the map');
  assert.equal(await page.evaluate((id) => document.activeElement.dataset.room === id && document.activeElement.classList.contains('sfy-row__show'), room), true, 'the focus left Show');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick(null));
});

// ---- the map's marks

test('a blocked exit and a blocked stairs wear a cross on a white ring on the map, and the keyboard cursor over one says so', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  const doorA = await FIRST_EXIT(page);
  await tickBox(page, 'exit', doorA);
  await tickBox(page, 'stairs', 'csample00a');
  await ready(page);
  const marks = await page.evaluate(() => document.querySelector('.sfy').safety.blockedMarks());
  // an exit is one mark; a stairs is one at each end
  assert.deepEqual(marks.map((mark) => mark.name), ['Door A', 'Stairs A, Floor 1 to Floor 2', 'Stairs A, Floor 1 to Floor 2']);
  const painted = await drawn(page);
  await page.evaluate(() => document.querySelector('.sfy').safety.plan.fit());
  await ready(page, painted);
  // the ring is white and holds on the plan: a pixel inside it, clear of the cross, is white
  const pixels = await page.evaluate(() => {
    const view = document.querySelector('.sfy').safety;
    const canvas = document.getElementById('safety-plan');
    const g = canvas.getContext('2d');
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const r = Math.max(7, Math.min(14, view.plan.view.size * 0.45));
    return view.blockedMarks().map((mark) => {
      const at = view.plan.cellAt(mark.floorId, mark.cell);
      if (!at) return { name: mark.name, shown: false };
      const [red, green, blue] = g.getImageData(Math.round(at.x * ratio), Math.round((at.y + r * 0.45) * ratio), 1, 1).data;
      const [cr, cg, cb] = g.getImageData(Math.round(at.x * ratio), Math.round(at.y * ratio), 1, 1).data;
      return { name: mark.name, shown: true, ring: [red, green, blue], centre: [cr, cg, cb] };
    });
  });
  const seen = pixels.filter((pixel) => pixel.shown);
  assert.ok(seen.length >= 1, 'no mark was on the stage: ' + JSON.stringify(pixels));
  for (const pixel of seen) assert.deepEqual(pixel.ring, [255, 255, 255], pixel.name + ' has no white ring: ' + JSON.stringify(pixel));
  // the cursor over the exit's cell says it is blocked
  await page.focus('#safety-plan');
  await page.evaluate(async () => {
    const { placeOf } = await import('./ui/surface/plan-layout.js');
    const view = document.querySelector('.sfy').safety;
    const mark = view.blockedMarks()[0];
    const at = placeOf(view.plan.world, mark.floorId, mark.cell);
    view.plan.cursor.moveTo(at.x - 1, at.y, true);
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /blocked in this trial$/.test(document.getElementById('announcer').textContent));
  assert.equal(await say(page), 'Door A, blocked in this trial');
  await page.evaluate(async () => {
    const { placeOf } = await import('./ui/surface/plan-layout.js');
    const view = document.querySelector('.sfy').safety;
    const mark = view.blockedMarks()[1];
    const at = placeOf(view.plan.world, mark.floorId, mark.cell);
    view.plan.cursor.moveTo(at.x - 1, at.y, true);
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => /^Stairs A/.test(document.getElementById('announcer').textContent));
  assert.equal(await say(page), 'Stairs A, Floor 1 to Floor 2, blocked in this trial');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

// ---- the other tabs and the Step-free view under a trial

test('Door cards say they print the building as it is; the Step-free view under a trial leaves a blocked exit out and says blocked stairs change nothing', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  const doorB = await page.evaluate(() => document.querySelector('.sfy').safety.picture.exits[1].exitId);
  // the sample's step-free ways all go out by Door B (5 to an exit, 5 to an area of refuge, 3 with no way out)
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  const open = await page.evaluate(() => document.querySelector('.sfy').safety.step.counts);
  assert.deepEqual(open, { exit: 5, refuge: 5, none: 3 });
  await tickBox(page, 'exit', doorB);
  await tab(page, 'cards');
  await page.waitForSelector('[data-line="as-built"]:not([hidden])');
  assert.equal(await text(page, '[data-line="as-built"]'), 'Printed as built, not this trial.');
  // Step-free: no room goes out by the blocked exit, and the line is there
  await tab(page, 'exits');
  await page.waitForSelector('.sfy-panel[data-panel="ways"] [data-line="stairs-unchanged"]');
  assert.equal(await text(page, '[data-line="stairs-unchanged"]'), 'Blocked stairs do not change the Step-free view: it never uses stairs.');
  const blocked = await page.evaluate(() => document.querySelector('.sfy').safety.step);
  assert.deepEqual(blocked.counts, { exit: 0, refuge: 5, none: 8 });
  assert.equal(blocked.rooms.some((room) => room.exitId === doorB), false, 'a room still goes out by the blocked exit step-free');
  // blocking a stairs on top changes no step-free way
  await tab(page, 'whatif');
  await tickBox(page, 'stairs', 'csample00b');
  const after = await page.evaluate(() => document.querySelector('.sfy').safety.step.counts);
  assert.deepEqual(after, blocked.counts, 'a blocked stairs changed the step-free counts');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('everyone'));
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

// ---- the scenario's closures

test('Use the scenario\'s closures brings in its closed stairs and corridor as a chip, says so, does nothing new the second time, and a chip is removed alone', async () => {
  const page = wide.page;
  await fresh(page, 'whatif', 'scenario');
  await page.waitForSelector('[data-action="use-scenario"]:not([hidden])');
  assert.equal(await text(page, '[data-part="scenario-words"]'), 'The open scenario closes: Stairs B and North <b>Corridor</b>.');
  await listen(page);
  await page.focus('[data-action="use-scenario"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '2');
  assert.equal((await say(page)).startsWith('Brought in from the scenario: Stairs B and North <b>Corridor</b>. 2 blocked. If '), true, await say(page));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'use-scenario', 'the focus left the button');
  assert.equal(await page.$eval('.sfy-tick__box[data-id="csample00b"]', (el) => el.checked), true, 'the stairs are ticked');
  assert.equal(await text(page, '.sfy-chip__words'), 'North <b>Corridor</b> (from the scenario)');
  // the typed name in the Remove button's hidden words is set apart too
  assert.deepEqual(await page.$eval('.sfy-chip__remove .vh', (el) => Array.from(el.children).map((child) => child.tagName)), ['BDI']);
  assert.equal(await text(page, '[data-part="band-words"]'), 'Trial: Stairs B and North <b>Corridor</b> blocked');
  // again: nothing new, and it says so
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('announcer').textContent.startsWith('Nothing new'));
  assert.equal(await say(page), 'Nothing new: the scenario’s closures are already in this trial.');
  assert.equal(await trialOn(page), '2');
  // the chip's Remove takes the corridor out and leaves the stairs
  await page.click('.sfy-chip__remove');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '1');
  assert.equal(await page.$$eval('.sfy-chip', (els) => els.length), 0);
  assert.equal(await page.$eval('.sfy-tick__box[data-id="csample00b"]', (el) => el.checked), true);
  assert.equal(await text(page, '[data-part="band-words"]'), 'Trial: Stairs B blocked');
  await page.click('[data-action="clear-trial"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

// ---- the trial across sections, projects and building changes

test('a trial survives a move to Schedule and back, and another project opening lets it go', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample00b');
  await go(page, '#schedule');
  await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
  await go(page, '#safety');
  await ready(page);
  assert.equal(await trialOn(page), '1', 'the trial was forgotten on the way');
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.blocked.connections), ['csample00b']);
  assert.equal(await text(page, '[data-part="band-words"]'), 'Trial: Stairs B blocked');
  // another project opens while the section is away
  await go(page, '#schedule');
  await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const other = sampleSchool();
    other.id = 'psomeotherschool';
    globalThis.sv2.store.replace(other);
  });
  await go(page, '#safety');
  await ready(page);
  assert.equal(await trialOn(page), '0', 'the trial outlived its project');
  assert.equal(await page.$eval('[data-part="band"]', (el) => el.hidden), true);
  // and while the section is mounted
  await tab(page, 'whatif');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await page.evaluate(async () => {
    const { sampleSchool } = await import('./data/sample-school.js');
    const other = sampleSchool();
    other.id = 'psomethirdschool';
    globalThis.sv2.store.replace(other);
  });
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('a building change that removes a blocked stairs drops it from the trial and says so once', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample0up');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await listen(page);
  await page.evaluate(() => {
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    project.building.connections = project.building.connections.filter((connection) => connection.id !== 'csample0up');
    globalThis.sv2.store.replace(project);
  });
  await page.waitForFunction(() => document.querySelector('.sfy').safety.blocked.connections.length === 0 && document.querySelector('.sfy').safety.picture && document.querySelector('.sfy').safety.plan.project === globalThis.sv2.store.project);
  const gone = 'Stairs C, Floor 1 to Floor 2 is gone, so it is no longer blocked.';
  assert.equal((await heard(page)).filter((said) => said.includes('is gone')).length, 1, 'said ' + JSON.stringify(await heard(page)));
  assert.ok((await heard(page)).includes(gone), JSON.stringify(await heard(page)));
  assert.equal(await text(page, '[data-part="dropped"]'), gone);
  assert.equal(await trialOn(page), '1', 'the exit is still blocked');
  assert.equal(await page.$('.sfy-tick__box[data-id="csample0up"]'), null, 'the gone stairs still has a tick');
  // the next change of the trial clears the note
  await tickBox(page, 'stairs', 'csample00b');
  await page.waitForFunction(() => document.querySelector('[data-part="dropped"]').hidden);
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

// ---- keyboard only

test('keyboard only: arrows reach the What if tab, Space ticks and keeps the focus, the band\'s Clear moves it to the open tab\'s heading, the tab\'s Clear to the first tick', async () => {
  const page = wide.page;
  await fresh(page, 'exits');
  await page.focus('.sfy-inspector .tabs__tab[data-tab="exits"]');
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.sfy-inspector .tabs__tab[data-tab="whatif"]').getAttribute('aria-selected') === 'true');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'whatif', 'the arrows took the focus off the tab');
  // Tab: the panel, then the first tick
  let steps = 0;
  while (steps < 6 && !(await page.evaluate(() => document.activeElement.classList.contains('sfy-tick__box')))) {
    await page.keyboard.press('Tab');
    steps += 1;
  }
  assert.ok(steps <= 3, 'the first tick took ' + steps + ' Tab presses');
  const first = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '1');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), first, 'ticking moved the focus');
  await page.waitForFunction(() => /^1 blocked\. If Door A is blocked: /.test(document.getElementById('announcer').textContent));
  // Tab on through the ticks to the tab's Clear, and press it
  await page.focus('[data-action="clear-trial"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), first, 'Clear did not put the focus on the first tick');
  // the band's Clear: the focus goes to the open tab's heading
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '1');
  await page.focus('[data-action="band-clear"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'What if an exit or stairs is blocked?', 'the focus did not go to the open tab\'s heading');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H2');
});

// ---- 390 px with touch

test('at 390 px with touch: five tabs scroll sideways with the focused one in view, the tab is one column, ticks and Clear are 44 px, the band is one line, nothing runs off the side', async () => {
  const session = await openPlanner({ width: 390, height: 844, mobile: true, hash: '#safety', theme: 'light' });
  const page = session.page;
  try {
    await ready(page);
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
    assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the page has touch');
    await page.tap('#inspector-toggle');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'true' && document.getElementById('inspector').dataset.mode === 'sheet');
    // the tabs scroll sideways; arrowing to the last brings it into view
    const list = await page.$eval('.sfy-inspector .tabs__list', (el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
    assert.ok(list.scroll > list.client, 'five tabs fit in ' + list.client + ' px: nothing to scroll');
    assert.equal(list.overflow, 'auto');
    await page.focus('.sfy-inspector .tabs__tab[data-tab="exits"]');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.sfy-inspector .tabs__tab[data-tab="prints"]').getAttribute('aria-selected') === 'true');
    const inView = async (id) => page.evaluate((tabId) => {
      const box = document.querySelector('.sfy-inspector .tabs__tab[data-tab="' + tabId + '"]').getBoundingClientRect();
      const bounds = document.querySelector('.sfy-inspector .tabs__list').getBoundingClientRect();
      return box.left >= bounds.left - 1 && box.right <= bounds.right + 1;
    }, id);
    await page.waitForFunction(() => {
      const box = document.querySelector('.sfy-inspector .tabs__tab[data-tab="prints"]').getBoundingClientRect();
      const bounds = document.querySelector('.sfy-inspector .tabs__list').getBoundingClientRect();
      return box.right <= bounds.right + 1;
    });
    assert.equal(await inView('prints'), true, 'the focused tab is not in view');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('.sfy-inspector .tabs__tab[data-tab="whatif"]').getAttribute('aria-selected') === 'true');
    assert.equal(await inView('whatif'), true, 'What if is not in view');
    // the What if tab: one column, 44 px ticks
    await page.waitForSelector('.sfy-panel[data-panel="whatif"] .sfy-tick');
    const small = async (selector) => page.$$eval(selector, (els) => els.filter((el) => el.getClientRects().length > 0).map((el) => Math.min(el.getBoundingClientRect().height, el.getBoundingClientRect().width)).filter((size) => size < 44));
    assert.deepEqual(await small('.sfy-tick'), []);
    const lefts = await page.$$eval('.sfy-tick', (els) => Array.from(new Set(els.map((el) => Math.round(el.getBoundingClientRect().left)))));
    assert.equal(lefts.length, 1, 'the ticks are not one column: ' + lefts);
    await page.tap('.sfy-tick__box[data-kind="stairs"][data-id="csample00b"]');
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '1');
    await page.waitForSelector('.sfy-table__row');
    // the table's rows are two lines: the exit, then its figures
    const row = await page.$eval('.sfy-table__row', (el) => ({ display: getComputedStyle(el).display, head: getComputedStyle(el.querySelector('th')).display, flex: getComputedStyle(el.querySelector('th')).flexBasis }));
    assert.equal(row.display, 'flex');
    assert.equal(row.flex, '100%');
    // Clear the trial
    assert.deepEqual(await small('[data-action="clear-trial"], .sfy-row__show'), []);
    // nothing runs off the side
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways');
    assert.equal(await page.evaluate(() => { const sheet = document.getElementById('inspector'); return sheet.scrollWidth <= sheet.clientWidth + 1; }), true, 'the sheet scrolls sideways');
    // Show: the sheet shuts, the room is on the map
    const room = await page.$eval('[data-list="lost"] .sfy-row', (el) => el.dataset.room);
    await page.$eval('.sfy-row__show[data-room="' + room + '"]', (el) => el.scrollIntoView({ block: 'center' }));
    const at = await page.$eval('.sfy-row__show[data-room="' + room + '"]', (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForSelector('.sfy[data-picked="' + room + '"]');
    await page.waitForFunction(() => document.getElementById('inspector').dataset.open === 'false');
    // the band: one line, "Trial · 1 blocked · Clear", Clear 44 px
    const band = await atRest(page, '[data-part="band"]');
    const shapes = await page.evaluate(() => ({
      long: getComputedStyle(document.querySelector('[data-part="band-words"]')).display,
      short: getComputedStyle(document.querySelector('[data-part="band-short"]')).display,
      text: document.querySelector('[data-part="band-short"]').textContent,
      clear: document.querySelector('[data-action="band-clear"]').getBoundingClientRect().height,
      clearWide: document.querySelector('[data-action="band-clear"]').getBoundingClientRect().width,
      lineHeight: parseFloat(getComputedStyle(document.querySelector('.sfy-band__text')).lineHeight),
      textHeight: document.querySelector('.sfy-band__text').getBoundingClientRect().height,
    }));
    assert.equal(shapes.long, 'none');
    assert.notEqual(shapes.short, 'none');
    assert.equal(shapes.text, 'Trial · 1 blocked');
    assert.ok(shapes.clear >= 44 && shapes.clearWide >= 44, 'Clear is ' + shapes.clearWide + ' by ' + shapes.clear);
    assert.ok(shapes.textHeight <= shapes.lineHeight * 1.5, 'the band wraps: ' + shapes.textHeight + ' px of text on lines ' + shapes.lineHeight + ' px high');
    assert.ok(band.width <= 390, 'the band is ' + band.width + ' px wide');
    await page.tap('[data-action="band-clear"]');
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
    assert.deepEqual(session.problems().errors, []);
  } finally {
    await session.close();
  }
});

test('no text node in the Safety inspector reads "null" or "undefined" with a trial on, in every tab and both views', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await tickBox(page, 'stairs', 'csample00b');
  const bad = () => page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('.sfy'), NodeFilter.SHOW_TEXT);
    const found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const said = node.nodeValue.trim();
      if (/(^|\s)(null|undefined|NaN)(\s|$)/.test(said)) found.push(JSON.stringify(said) + ' in ' + (node.parentElement.className || node.parentElement.tagName));
    }
    return found;
  });
  for (const view of ['everyone', 'step-free']) {
    await page.evaluate((value) => document.querySelector('.sfy').safety.setView(value), view);
    for (const id of ['exits', 'cards', 'stepfree', 'whatif', 'prints']) {
      await tab(page, id);
      await page.waitForFunction((wanted) => document.querySelector('.sfy-inspector .tabs__tab[data-tab="' + wanted + '"]').getAttribute('aria-selected') === 'true', {}, id);
      assert.deepEqual(await bad(), [], view + '/' + id);
    }
  }
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('everyone'));
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

// ---- SV2-109b: what the review said these cases did not prove

test('at 1280 and at 1024 every tab lies wholly inside the tablist, with the inspector at its default width', async () => {
  const inside = (page) => page.evaluate(() => {
    const list = document.querySelector('.sfy-inspector .tabs__list').getBoundingClientRect();
    return Array.from(document.querySelectorAll('.sfy-inspector .tabs__tab')).map((tab) => {
      const box = tab.getBoundingClientRect();
      return { tab: tab.textContent, whole: box.left >= list.left - 0.5 && box.right <= list.right + 0.5 && box.top >= list.top - 0.5 && box.bottom <= list.bottom + 0.5, fits: tab.scrollWidth <= tab.clientWidth };
    });
  });
  await fresh(wide.page);
  const at1280 = await inside(wide.page);
  assert.deepEqual(at1280.filter((tab) => !tab.whole || !tab.fits), [], 'a tab is cut off at 1280: ' + JSON.stringify(at1280));
  const session = await openPlanner({ width: 1024, height: 768, hash: '#safety', theme: 'light' });
  try {
    await ready(session.page);
    const at1024 = await inside(session.page);
    assert.deepEqual(at1024.filter((tab) => !tab.whole || !tab.fits), [], 'a tab is cut off at 1024: ' + JSON.stringify(at1024));
  } finally {
    await session.close();
  }
});

// the pixel at a room's × badge (its first cell's top left, 3 px in), as [r, g, b], or null when it is not on the stage
async function badgePixel(page, roomId) {
  await page.evaluate((id) => {
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get(id);
    view.plan.show(row.floorId, row.cells);
    view.plan.fit();
  }, roomId);
  // the map has been painted for the move once two frames have passed
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate((id) => {
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get(id);
    const first = Math.min(...row.cells);
    const at = view.plan.cellAt(row.floorId, first);
    if (!at) return null;
    const canvas = document.getElementById('safety-plan');
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const size = view.plan.view.size;
    const data = canvas.getContext('2d').getImageData(Math.round((at.x - size / 2 + 3) * ratio), Math.round((at.y - size / 2 + 3) * ratio), 1, 1).data;
    return { pixel: [data[0], data[1], data[2]], problem: view.plan.theme().problem, size };
  }, roomId);
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// a pixel is the colour when each channel is within 10 of it (the canvas blends at an edge)
const near = (pixel, colour) => pixel.every((value, i) => Math.abs(value - colour[i]) <= 10);

test('rooms a trial leaves with no way out are framed and marked × on the map in both views, the cursor says so in words, and the key has a line for them', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  // no trial: no room is marked ×
  await tickBox(page, 'stairs', 'csample00b');
  await ready(page);
  const lost = await page.evaluate(() => document.querySelector('.sfy').safety.picture.trial.rooms.filter((room) => room.change === 'lost').map((room) => room.roomId));
  assert.ok(lost.length >= 1, 'Stairs B leaves Floor 3 with no way out');
  for (const view of ['everyone', 'step-free']) {
    await page.evaluate((value) => document.querySelector('.sfy').safety.setView(value), view);
    await ready(page);
    for (const room of lost) {
      const seen = await badgePixel(page, room);
      assert.ok(seen && seen.size >= 10, view + ': ' + room + ' is not on the stage at a size that draws badges: ' + JSON.stringify(seen));
      assert.ok(near(seen.pixel, rgbOf(seen.problem)), view + ': ' + room + ' carries no × badge in the problem colour: ' + JSON.stringify(seen));
    }
  }
  // a room that keeps its way out carries no such badge
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('everyone'));
  await ready(page);
  const kept = await badgePixel(page, 'rsample101');
  assert.equal(near(kept.pixel, rgbOf(kept.problem)), false, 'Room 101 keeps its way out and is marked ×');
  // the key's line
  const key = await page.$eval('[data-part="key"] [data-none]', (el) => el.textContent);
  assert.equal(key, '×No way out in this trial, ' + (lost.length === 1 ? '1 room' : lost.length + ' rooms'));
  // the cursor's words
  const name = await page.evaluate((id) => document.querySelector('.sfy').safety.picture.byRoom.get(id).name, lost[0]);
  await page.focus('#safety-plan');
  await page.evaluate(async (id) => {
    const { placeOf } = await import('./ui/surface/plan-layout.js');
    const view = document.querySelector('.sfy').safety;
    const row = view.picture.byRoom.get(id);
    const at = placeOf(view.plan.world, row.floorId, row.cells[0]);
    view.plan.cursor.moveTo(at.x - 1, at.y, true);
  }, lost[0]);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((words) => document.getElementById('announcer').textContent === words, {}, name + ', no way out in this trial');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await page.$('[data-part="key"] [data-none]'), null, 'the key keeps its line with no trial');
});

test('the Door cards list shows the building as built under a trial: Door A blocked still names Door A for Room 101, and Stairs B blocked leaves Floor 3\'s ways in the list', async () => {
  const page = wide.page;
  await fresh(page, 'cards');
  const ways = () => page.$$eval('.sfy-row', (rows) => rows.map((row) => [row.dataset.room, row.dataset.ok, row.querySelector('.sfy-row__way').textContent]));
  const asBuilt = await ways();
  assert.ok(asBuilt.length >= 13);
  assert.match(asBuilt.find(([room]) => room === 'rsample101')[2], /^1 Door A /);
  await tab(page, 'whatif');
  const doorA = await FIRST_EXIT(page);
  await tickBox(page, 'exit', doorA);
  await tab(page, 'cards');
  await page.waitForSelector('[data-line="as-built"]:not([hidden])');
  assert.match((await ways()).find(([room]) => room === 'rsample101')[2], /^1 Door A /, 'under a trial the list names the trial\'s exit');
  assert.deepEqual(await ways(), asBuilt, 'the list is not the building as built');
  await tab(page, 'whatif');
  await tickBox(page, 'stairs', 'csample00b');
  await tab(page, 'cards');
  assert.deepEqual(await ways(), asBuilt, 'a blocked stairs changed the list');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('the trial\'s picture depends on the building only: a schedule change keeps the very same picture, and the step-free report is worked out once per building and schedule, not once per tick', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample00b');
  const before = await page.evaluate(() => {
    globalThis.__picture = document.querySelector('.sfy').safety.picture;
    return true;
  });
  assert.equal(before, true);
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setSetting, { key: 'defaultHeadCount', value: globalThis.sv2.store.project.settings.defaultHeadCount + 1 });
  });
  await ready(page);
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.picture === globalThis.__picture), true, 'a schedule change worked the trial out again');
  // the step-free report: one object while the building and schedule stand, whatever is ticked
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  const report = await page.evaluate(() => {
    globalThis.__report = document.querySelector('.sfy').safety.step.report;
    return true;
  });
  assert.equal(report, true);
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  assert.equal(await page.evaluate(() => document.querySelector('.sfy').safety.step.report === globalThis.__report), true, 'a tick worked the step-free report out again');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('everyone'));
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('removing the last chip with no scenario button and no Clear leaves the focus on the first tick, never on the page', async () => {
  const page = wide.page;
  await fresh(page, 'whatif', 'corridor');
  await page.waitForSelector('[data-action="use-scenario"]:not([hidden])');
  await page.click('[data-action="use-scenario"]');
  await page.waitForSelector('.sfy-chip__remove');
  // the scenario goes away while its corridor stays blocked: no button to bring it in again
  await page.evaluate(() => {
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    delete project.scenario;
    globalThis.sv2.store.replace(project);
  });
  await ready(page);
  await page.waitForFunction(() => document.querySelector('[data-action="use-scenario"]').hidden);
  assert.equal(await trialOn(page), '1');
  await page.click('.sfy-chip__remove');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await page.$eval('[data-action="clear-trial"]', (el) => el.hidden), true);
  const held = await page.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className);
  assert.equal(held, 'INPUT.sfy-tick__box', 'the focus is on ' + held);
});

test('theme switch with a trial on: the ticks, the What if results, the Exits tab and the Door cards list take the new theme\'s exit colours', async () => {
  const page = wide.page;
  const swatchesAre = (selector) => page.evaluate((query) => {
    const view = document.querySelector('.sfy').safety;
    const probe = document.createElement('div');
    document.body.append(probe);
    const colourOf = (value) => {
      probe.style.background = value;
      return getComputedStyle(probe).backgroundColor;
    };
    const wrong = [];
    const all = Array.from(document.querySelectorAll(query));
    for (const el of all) {
      const number = Number(el.textContent);
      if (!(number > 0)) continue;
      const have = getComputedStyle(el).backgroundColor;
      const want = colourOf(view.colour(number));
      if (have !== want) wrong.push(number + ': ' + have + ' is not ' + want);
    }
    probe.remove();
    return { count: all.length, wrong };
  }, selector);
  await fresh(page, 'whatif');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  try {
    for (const [tabId, selector] of [['whatif', '.sfy-panel[data-panel="whatif"] .sfy-swatch'], ['exits', '.sfy-panel[data-panel="exits"] .sfy-swatch'], ['cards', '.sfy-panel[data-panel="cards"] .sfy-swatch']]) {
      await tab(page, tabId);
      for (const scheme of ['dark', 'light']) {
        const was = await drawn(page);
        const ink = await page.evaluate(() => document.querySelector('.sfy').safety.plan.theme().paper);
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
        await page.waitForFunction((old) => document.querySelector('.sfy').safety.plan.theme().paper !== old, {}, ink);
        await ready(page, was);
        const seen = await swatchesAre(selector);
        assert.ok(seen.count >= 2, tabId + ': ' + seen.count + ' swatches');
        assert.deepEqual(seen.wrong, [], tabId + ' in ' + scheme);
      }
    }
    // the What if results' own table is among the swatches checked
    await tab(page, 'whatif');
    assert.ok((await page.$$eval('.sfy-table__exit .sfy-swatch', (els) => els.length)) >= 2);
  } finally {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  }
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('a right-to-left exit and room name is set apart in the ticks, the band, the results and the hidden words, and the ticks keep no gap before the comma', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  const rtl = 'باب أ';
  const room = 'غرفة ٣٠٣';
  await page.evaluate(([door, number]) => {
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    project.building.floors[0].exits[0].doorName = door;
    for (const floor of project.building.floors) for (const space of floor.spaces) if (space.id === 'rsample303') space.number = number;
    globalThis.sv2.store.replace(project);
  }, [rtl, room]);
  await ready(page);
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await tickBox(page, 'stairs', 'csample00b');
  await ready(page);
  assert.deepEqual(await commaGaps(page), [], 'a gap before the comma with a right-to-left name');
  // every text node that carries either name is the child of a <bdi>, wherever it is in the section
  const loose = await page.evaluate(([door, number]) => {
    const found = [];
    const walker = document.createTreeWalker(document.querySelector('.sfy'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      if ((value.includes(door) || value.includes(number)) && node.parentElement.tagName !== 'BDI' && !node.parentElement.closest('bdi')) found.push(JSON.stringify(value) + ' in ' + node.parentElement.className);
    }
    return found;
  }, [rtl, room]);
  assert.deepEqual(loose, [], 'a typed name is not in a <bdi>');
  assert.match(await text(page, '[data-part="band-words"]'), /^Trial: .*Stairs B blocked$/);
  // the Show button's hidden words and the results rows
  const shows = await page.$$eval('.sfy-row__show .vh', (els) => els.map((el) => Array.from(el.children).map((child) => child.tagName)));
  assert.ok(shows.length >= 1);
  assert.ok(shows.every((tags) => tags.join() === 'BDI'), JSON.stringify(shows));
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('a capacity edit with a trial on moves the trial\'s figures, and the exits table, the band and the picture follow', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  const figures = () => page.$$eval('.sfy-table__row', (rows) => rows.map((row) => row.querySelector('.sfy-table__people [aria-hidden="true"]').textContent));
  const was = await figures();
  assert.deepEqual(was, ['520 → 0', '120 → 640']);
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.setRoomFields, { roomId: 'rsample101', capacity: 40 });
  });
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.sfy-table__row .sfy-table__people [aria-hidden="true"]').textContent === '530 → 0');
  assert.deepEqual(await figures(), ['530 → 0', '120 → 650'], 'the trial\'s figures did not follow the capacity');
  assert.equal(await trialOn(page), '1', 'the edit let the trial go');
  await page.evaluate(() => globalThis.sv2.store.undo());
  await ready(page);
  await page.waitForFunction(() => document.querySelector('.sfy-table__row .sfy-table__people [aria-hidden="true"]').textContent === '520 → 0');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('Undo after a blocked stairs is erased: the trial stays without it and the loss was said once, and nothing more is said when it comes back', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample0up');
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await listen(page);
  await page.evaluate(async () => {
    const actions = await import('./engine/actions.js');
    globalThis.sv2.store.apply(actions.disconnectStairs, { connectionId: 'csample0up' });
  });
  await page.waitForFunction(() => document.querySelector('.sfy').safety.blocked.connections.length === 0 && document.querySelector('.sfy').safety.plan.project === globalThis.sv2.store.project);
  await ready(page);
  const gone = 'Stairs C, Floor 1 to Floor 2 is gone, so it is no longer blocked.';
  assert.equal((await heard(page)).filter((said) => said.includes('is gone')).length, 1, JSON.stringify(await heard(page)));
  const spoken = (await heard(page)).length;
  await page.evaluate(() => globalThis.sv2.store.undo());
  await page.waitForFunction(() => document.querySelector('.sfy').safety.plan.project === globalThis.sv2.store.project && document.querySelector('.sfy-tick__box[data-id="csample0up"]'));
  await ready(page);
  // the stairs is back in the building, unticked; the exit is still blocked; the loss is not said again
  assert.equal(await page.$eval('.sfy-tick__box[data-id="csample0up"]', (el) => el.checked), false);
  assert.deepEqual(await page.evaluate(() => document.querySelector('.sfy').safety.blocked.connections), []);
  assert.equal(await trialOn(page), '1');
  assert.equal((await heard(page)).filter((said) => said.includes('is gone')).length, 1, 'said again after Undo: ' + JSON.stringify(await heard(page)));
  assert.equal((await heard(page)).filter((said) => said.includes(gone)).length, 1);
  assert.ok((await heard(page)).length >= spoken);
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('a change that takes out a blocked stairs and the picked room says both in one announcement, and one that leaves the section with nothing still says what the trial dropped', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await tickBox(page, 'stairs', 'csample0up');
  await page.evaluate(() => document.querySelector('.sfy').safety.pick('rsample101'));
  await listen(page);
  await page.evaluate(() => {
    const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
    project.building.connections = project.building.connections.filter((connection) => connection.id !== 'csample0up');
    for (const floor of project.building.floors) floor.spaces = floor.spaces.filter((space) => space.id !== 'rsample101');
    globalThis.sv2.store.replace(project);
  });
  await page.waitForFunction(() => document.querySelector('.sfy').safety.blocked.connections.length === 0 && document.querySelector('.sfy').safety.plan.project === globalThis.sv2.store.project);
  const said = (await heard(page)).filter((each) => each.includes('is gone') || each.includes('no longer in the building'));
  assert.deepEqual(said, ['Room 101 is no longer in the building; showing every room. Stairs C, Floor 1 to Floor 2 is gone, so it is no longer blocked.']);
  // the building loses every exit: nothing to draw, and the dropped exit is still said
  try {
    await tickBox(page, 'exit', await FIRST_EXIT(page));
    await listen(page);
    await page.evaluate(() => {
      const project = JSON.parse(JSON.stringify(globalThis.sv2.store.project));
      for (const floor of project.building.floors) floor.exits = [];
      globalThis.sv2.store.replace(project);
    });
    await page.waitForFunction(() => document.querySelector('.sfy').dataset.mode === 'empty');
    assert.deepEqual((await heard(page)).filter((each) => each.includes('is gone')), ['Door A is gone, so it is no longer blocked.']);
  } finally {
    await page.evaluate(async () => {
      const { sampleSchool } = await import('./data/sample-school.js');
      globalThis.sv2.store.replace(sampleSchool());
    });
    await ready(page);
  }
});

test('a trial writes no storage key: the keys of localStorage and sessionStorage are the same after ticking, bringing in closures and clearing', async () => {
  const page = wide.page;
  await fresh(page, 'whatif', 'scenario');
  const keys = () => page.evaluate(() => JSON.stringify([Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]));
  const before = await keys();
  await tickBox(page, 'exit', await FIRST_EXIT(page));
  await tickBox(page, 'stairs', 'csample00a');
  await page.click('[data-action="use-scenario"]');
  await page.waitForSelector('.sfy-chip');
  await go(page, '#schedule');
  await page.waitForFunction(() => document.querySelector('.surface__layout')?.dataset.section === 'schedule');
  await go(page, '#safety');
  await ready(page);
  assert.equal(await keys(), before, 'a trial wrote a storage key');
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
  assert.equal(await keys(), before);
  assert.equal(before, storageAtStart, 'a case before this one wrote a storage key');
});

test('the Step-free view under a trial: a blocked exit leaves its rooms marked ×, blocked stairs leave it as it was, and the key says how many have no way', async () => {
  const page = wide.page;
  await fresh(page, 'whatif');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('step-free'));
  const doorB = await page.evaluate(() => document.querySelector('.sfy').safety.picture.exits[1].exitId);
  await tickBox(page, 'exit', doorB);
  await ready(page);
  assert.equal(await text(page, '[data-part="key"] [data-none]'), '×No step-free way out, 8 rooms');
  assert.equal(await page.$eval('.sfy', (el) => el.dataset.view), 'step-free');
  // the trial's step-free ways went through the cache the section keeps for them
  assert.ok(await page.evaluate(() => document.querySelector('.sfy').safety.stepRouteCache.searches) > 0, 'the step-free ways did not use the route cache');
  const none = await page.evaluate(() => document.querySelector('.sfy').safety.step.rooms.filter((room) => room.way === 'none').map((room) => room.roomId));
  assert.equal(none.length, 8);
  const seen = await badgePixel(page, none[0]);
  assert.ok(near(seen.pixel, rgbOf(seen.problem)), 'no × on a room with no step-free way under the trial: ' + JSON.stringify(seen));
  await tickBox(page, 'stairs', 'csample00b');
  await ready(page);
  assert.equal(await text(page, '[data-part="key"] [data-none]'), '×No step-free way out, 8 rooms', 'a blocked stairs changed the step-free view');
  await page.evaluate(() => document.querySelector('.sfy').safety.setView('everyone'));
  await page.click('[data-action="band-clear"]');
  await page.waitForFunction(() => document.querySelector('.sfy').dataset.trial === '0');
});

test('no script error was raised by any of this', async () => {
  assert.deepEqual(wide.problems().errors, []);
});
