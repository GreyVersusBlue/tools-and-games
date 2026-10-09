// The derived pipeline in a real browser: node test/browser/worker.mjs
//
// Opens the planner on the sample school, attaches the engine client to the
// page's own store (globalThis.sv2.store) and asks for the results the way a
// screen does. What is checked is that the module worker really answered:
// the routes, crowd results, loads, places and findings came across from
// engine/worker.js, they say what the main thread says for the same project,
// a one-slot change ran two transitions, and an answer made stale by a
// change was never handed to anyone.
//
// The page has no screen that shows these yet (the findings panel and the
// movement view come next), so this suite reads the results themselves.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { launch, startServer, waitForSection, TOOL_PATH } from './harness.mjs';

// This suite opens its own page instead of openPlanner()'s. The site's
// harness answers every request itself so that it can refuse an offsite one,
// and under Puppeteer that leaves a module worker's imports waiting for
// ever: the worker never loads. Measured 2026-10-08 on the sample school:
// with interception on, six of the worker's twelve imports never finished;
// the same page with it off was answered by the worker in 152 ms. So nothing
// is intercepted here, and the suite checks where every request went itself.
// A new browser has no saved project, so the page shows the sample school.

let server;
let browser;
let page;
const requests = [];
const errors = [];

before(async () => {
  server = await startServer();
  browser = await launch();
  page = await browser.newPage();
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push('page error: ' + error.message));
  page.on('requestfailed', (request) => errors.push('request failed: ' + request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push('console: ' + message.text());
  });
  await page.goto(server.base + TOOL_PATH + '#schedule', { waitUntil: 'load' });
  await waitForSection(page, 'schedule');
  // the client, the actions and a summary of a result, kept on the page for the cases below
  await page.evaluate(async () => {
    const at = (file) => new URL(file, location.href).href;
    const { engineFor, createEngineClient } = await import(at('ui/engine-client.js'));
    const actions = await import(at('engine/actions.js'));
    const loud = (result) => result.findings.findings.filter((finding) => finding.severity !== 'note').map((finding) => finding.id).sort();
    const plain = (value) => JSON.parse(JSON.stringify(value));
    globalThis.sv2test = { engineFor, createEngineClient, actions, loud, plain, kept: {} };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

test('the worker answers for the sample school, with typed arrays and the walk that does not fit', async () => {
  const seen = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const client = t.engineFor(store);
    const result = await store.derived.results();
    t.kept.first = result;
    const walk = result.walks.groups.find((entry) => entry.dayTypeId === 'dsample00a' && entry.groupId === 'gsample08a' && entry.period === 5);
    const transition = result.crowd.days[0].transitions[5];
    const walker = transition.groups.find((group) => group.groupId === 'gsample08a');
    return {
      groups: store.project.groups.length,
      where: result.where,
      clientWhere: client.where,
      fallback: client.fallback,
      generation: result.generation,
      stats: { ...client.stats },
      loud: t.loud(result),
      text: result.findings.findings.find((finding) => finding.kind === 'group-walk').text,
      walk: [walk.walking, walk.waiting, walk.total, walk.late],
      routes: result.routes.transitions,
      days: result.crowd.days.map((day) => [day.dayTypeId, day.transitions.length]),
      positions: Object.prototype.toString.call(walker.positions),
      lastPosition: walker.positions[walker.positions.length - 1] >= walker.slots,
      cellDelay: Object.prototype.toString.call(transition.cellDelay),
      loads: result.loads.map((load) => [load.dayTypeId, load.unit, Object.prototype.toString.call(load.cells.busiest), load.max.busiest > 0]),
      places: result.places.places.length > 0 && Object.prototype.toString.call(result.places.placeOfNode),
      buildingFindings: result.buildingFindings.length,
      work: result.work,
    };
  });
  assert.equal(seen.groups, 8, 'the page is showing the sample school');
  assert.equal(seen.where, 'worker');
  assert.equal(seen.clientWhere, 'worker');
  assert.equal(seen.fallback, null);
  assert.equal(seen.generation, 1);
  // One request reaches the worker however many screens ask: the Schedule
  // section's walkResults() asks once too (SV2-13), and every ask after the
  // first is answered from memory.
  assert.deepEqual({ sent: seen.stats.sent, answered: seen.stats.answered, dropped: seen.stats.dropped, failed: seen.stats.failed }, { sent: 1, answered: 1, dropped: 0, failed: 0 });
  assert.ok(seen.stats.asked >= 1, 'nothing asked');
  assert.equal(seen.stats.remembered, seen.stats.asked - 1, 'every ask after the first should be answered from memory: ' + JSON.stringify(seen.stats));
  assert.deepEqual(seen.loud, ['group-walk:dsample00a:5:gsample08a', 'room-double:dsample00a:1:rsample203']);
  assert.equal(seen.text, '8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day, and the passing time is 4 min.');
  assert.deepEqual(seen.walk, [261, 0, 261, true]);
  assert.equal(seen.routes, 8 * 7 * 2);
  assert.deepEqual(seen.days, [['dsample00a', 7], ['dsample00b', 7]]);
  assert.equal(seen.positions, '[object Int16Array]');
  assert.equal(seen.lastPosition, true, 'the walker ends in the room');
  assert.equal(seen.cellDelay, '[object Int32Array]');
  assert.deepEqual(seen.loads, [['dsample00a', 'students', '[object Int32Array]', true], ['dsample00b', 'students', '[object Int32Array]', true]]);
  assert.equal(seen.places, '[object Int32Array]');
  assert.equal(seen.buildingFindings, 0);
  assert.equal(seen.work.transitionsRun, 14);
});

test('a worker is running engine/worker.js from this site, and nothing was fetched from anywhere else', () => {
  // the page imports engine/worker.js too (for unpack), so a request for the
  // file proves nothing: the browser is asked what workers the page has
  const running = page.workers().map((worker) => worker.url());
  assert.deepEqual(running, [server.base + TOOL_PATH + 'engine/worker.js']);
  assert.ok(requests.length > 20, 'the requests were really recorded: ' + requests.length);
  for (const url of requests) assert.ok(url.startsWith(server.base + '/') || url.startsWith('blob:') || url.startsWith('data:'), 'offsite request: ' + url);
});

test('the worker and the main thread say the same for the same project', async () => {
  const both = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const here = t.createEngineClient(store, { worker: false });
    const main = await here.results();
    const worker = await store.derived.results();
    const tell = (result) => t.plain({
      routes: result.routes.days,
      walks: result.walks,
      findings: result.findings,
      buildingFindings: result.buildingFindings,
      places: result.places.places,
      loads: result.loads.map((load) => [load.dayTypeId, load.unit, load.max, Array.from(load.cells.busiest), Array.from(load.cells.total), Array.from(load.connections.busiest)]),
      crowd: result.crowd.days.map((day) => day.transitions.map((transition) => [transition.period, transition.passingSeconds, transition.seconds, Array.from(transition.cellDelay), transition.groups.map((group) => [group.groupId, group.total, group.waiting, group.late, Array.from(group.positions)])])),
    });
    return { main: tell(main), worker: tell(worker), where: [main.where, worker.where] };
  });
  assert.deepEqual(both.where, ['main', 'worker']);
  assert.ok(both.worker.crowd[0][5][4].length > 0, 'there are walkers to compare');
  assert.deepEqual(both.worker, both.main);
});

test('one changed slot: the worker runs two transitions and sends back only what changed', async () => {
  // The answer is kept on the page and read in a second evaluate: a promise
  // awaited across one long evaluate was once garbage-collected on CI's runner
  // ("Protocol error (Runtime.callFunctionOn): Promise was collected").
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    t.kept.second = null;
    // 7C leaves Room 203 in Period 2 on A Day: the double booking goes
    store.apply(t.actions.setSlot, { groupId: 'gsample07c', dayTypeId: 'dsample00a', period: 1, slot: { room: null } });
    store.derived.results().then((result) => { t.kept.second = result; });
  });
  await page.waitForFunction(() => globalThis.sv2test.kept.second !== null, { timeout: 15000 });
  const seen = await page.evaluate(() => {
    const t = globalThis.sv2test;
    const first = t.kept.first;
    const result = t.kept.second;
    const dayA = result.crowd.days[0];
    return {
      where: result.where,
      generation: result.generation,
      work: result.work,
      loud: t.loud(result),
      empty: result.findings.findings.some((finding) => finding.kind === 'empty-period' && finding.where.groupIds.includes('gsample07c')),
      sameObjects: {
        places: result.places === first.places,
        buildingFindings: result.buildingFindings === first.buildingFindings,
        otherDay: result.crowd.days[1] === first.crowd.days[1],
        otherLoads: result.loads[1] === first.loads[1],
      },
      ranAgain: dayA.transitions.map((transition, period) => transition !== first.crowd.days[0].transitions[period]),
      otherGroupRoutes: result.routes.days[0].groups.filter((group, index) => group === first.routes.days[0].groups[index]).length,
    };
  });
  assert.equal(seen.where, 'worker');
  assert.equal(seen.generation, 2);
  assert.equal(seen.work.transitionsRun, 2);
  assert.equal(seen.work.searches, 0);
  assert.deepEqual(seen.loud, ['group-walk:dsample00a:5:gsample08a']);
  assert.equal(seen.empty, true, 'and the empty period is noted');
  assert.deepEqual(seen.sameObjects, { places: true, buildingFindings: true, otherDay: true, otherLoads: true });
  assert.deepEqual(seen.ranAgain, [true, true, false, false, false, false, false]);
  assert.equal(seen.otherGroupRoutes, 7, 'the seven other groups\' routes were not sent again');
});

test('an answer made stale by a change is dropped, and both callers get the newest', async () => {
  const seen = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const client = t.engineFor(store);
    const dropped = client.stats.dropped;
    store.apply(t.actions.setSlot, { groupId: 'gsample07c', dayTypeId: 'dsample00a', period: 1, slot: { room: 'rsample203' } });
    const early = store.derived.results(); // goes to the worker
    store.undo(); // and is stale before it comes back
    const late = store.derived.results();
    const [a, b] = await Promise.all([early, late]);
    return {
      same: a === b,
      generation: b.generation,
      dropped: client.stats.dropped - dropped,
      loud: t.loud(b),
      where: b.where,
      matchesMain: JSON.stringify(t.plain((await t.createEngineClient(store, { worker: false }).results()).findings)) === JSON.stringify(t.plain(b.findings)),
    };
  });
  assert.equal(seen.same, true);
  assert.equal(seen.generation, 4);
  assert.equal(seen.dropped, 1);
  assert.equal(seen.where, 'worker');
  assert.deepEqual(seen.loud, ['group-walk:dsample00a:5:gsample08a'], 'the double booking that was undone is not reported');
  assert.equal(seen.matchesMain, true, 'the answer after a dropped one is still whole');
});

test('nothing went wrong on the page', () => {
  assert.deepEqual(errors, []);
});
