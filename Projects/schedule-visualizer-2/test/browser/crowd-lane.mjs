// The crowd lane in a real browser, with the real module worker:
//   node test/browser/crowd-lane.mjs
//
// ARCHITECTURE 23.5, 23.12. Opens the planner on the sample school and asks
// store.derived.crowd({ dayTypeId, bellsId }) the way Movement will. What is
// checked is that the worker really answered (sv2-derive-crowd), that its
// answer is the main thread's for the same project (on the two-halls
// building, where groups really move), that a transition the run left alone
// is the main answer's own object, that an answer for counters the store has
// moved past is dropped, that a worker which does not know the message is
// given READY_WAIT_MS and then the main thread answers, that the main lane's
// result stays the very object it was, and that nothing was fetched from
// anywhere else.
//
// Every case waits on a state the page sets: an answer lands in
// globalThis.sv2test.done[name] when its promise settles, and the test waits
// for that, never for a first paint or for a fixed time (a CI runner is
// slower than this machine).
//
// This suite opens its own page instead of openPlanner()'s, as
// test/browser/worker.mjs does and for the same reason: the site's harness
// intercepts every request, and under Puppeteer that leaves a module worker's
// imports waiting for ever. Nothing is intercepted here, and the suite checks
// where every request went itself. A new browser has no saved project, so the
// page shows the sample school.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { launch, startServer, waitForSection, TOOL_PATH } from './harness.mjs';

let server;
let browser;
let page;
const requests = [];
const errors = [];

// The page's promise named `name` has settled: its value is in sv2test.done[name].
async function settled(name) {
  await page.waitForFunction((wanted) => globalThis.sv2test.done[wanted] !== undefined, { timeout: 60000 }, name);
  return page.evaluate((wanted) => globalThis.sv2test.done[wanted], name);
}

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
  await page.evaluate(async () => {
    const at = (file) => new URL(file, location.href).href;
    const { engineFor, createEngineClient } = await import(at('ui/engine-client.js'));
    const actions = await import(at('engine/actions.js'));
    const { createStore } = await import(at('engine/store.js'));
    const { createIds, seededRandom } = await import(at('engine/ids.js'));
    const { twoHalls } = await import(at('test/fixtures/buildings/two-halls.mjs'));
    // typed arrays as lists, so two runs can be compared as text
    const plain = (value) => JSON.stringify(value, (key, one) => (ArrayBuffer.isView(one) ? Array.from(one) : one));
    const done = {};
    // a promise's outcome, kept where the test can wait for it; `keep` says what of the answer to keep
    const settle = (name, promise, keep) => {
      delete done[name];
      promise.then((value) => { done[name] = { ok: true, value: value === null ? null : (keep ? keep(value) : value) }; },
        (error) => { done[name] = { ok: false, error: error.message }; });
    };
    const storeOf = (project) => createStore({ project, clock: () => new Date('2026-09-01T12:00:00Z'), ids: createIds(seededRandom(16)) });
    // the last transition is the only one with a crowd in it
    const halls = () => twoHalls({ pattern: 'hhha' });
    // what a run says, and which of its transitions are the main answer's own
    const said = (answer, main) => ({
      where: answer.where,
      generation: answer.generation,
      text: plain(answer.run),
      moved: answer.run.changed.length,
      waitingUsual: answer.run.figures.usual.waiting,
      waitingAware: answer.run.figures.aware.waiting,
      own: answer.run.crowd.transitions.map((transition, t) => transition === main.crowd.days[0].transitions[t]),
    });
    globalThis.sv2test = { engineFor, createEngineClient, actions, plain, settle, done, storeOf, halls, said, held: {} };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

test('the sample school: the worker answers store.derived.crowd, and finds nothing to move, as it honestly may', async () => {
  const seen = await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const client = t.engineFor(store);
    t.settle('sample-main', store.derived.results(), (main) => ({ where: main.where }));
    return { where: client.where, fallback: client.fallback };
  });
  assert.equal(seen.where, 'worker');
  assert.equal(seen.fallback, null);
  assert.equal((await settled('sample-main')).value.where, 'worker');

  await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const main = await store.derived.results();
    t.settle('sample', store.derived.crowd({ dayTypeId: store.project.dayTypes[0].id }), (answer) => ({ ...t.said(answer, main), versions: answer.versions, storeVersions: { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion } }));
  });
  const sample = await settled('sample');
  assert.equal(sample.ok, true, sample.error);
  assert.equal(sample.value.where, 'worker');
  assert.deepEqual(sample.value.versions, sample.value.storeVersions, 'it is for the counters the store has');
  assert.equal(sample.value.moved, 0, 'the sample school has nothing a slightly longer way would help');
  assert.ok(sample.value.own.length > 0 && sample.value.own.every(Boolean), 'so every transition is the main answer\'s own object');
});

test('two-halls: the worker\'s run is the main thread\'s, groups move, waiting falls, and the transitions left alone are the main answer\'s own', async () => {
  await page.evaluate(() => {
    const t = globalThis.sv2test;
    const project = t.halls();
    // two stores of the one building: one with the real worker, one on the main thread
    t.held.hallsStore = t.storeOf(project);
    t.held.hereStore = t.storeOf(t.halls());
    t.held.worker = t.createEngineClient(t.held.hallsStore);
    t.held.here = t.createEngineClient(t.held.hereStore, { worker: false });
    const dayTypeId = project.dayTypes[0].id;
    const ask = async (name, client, store) => {
      const main = await client.results();
      t.settle(name, client.crowd({ dayTypeId }), (answer) => t.said(answer, main));
    };
    ask('halls-worker', t.held.worker, t.held.hallsStore);
    ask('halls-main', t.held.here, t.held.hereStore);
  });
  const worker = await settled('halls-worker');
  const main = await settled('halls-main');
  assert.equal(worker.ok, true, worker.error);
  assert.equal(main.ok, true, main.error);
  assert.deepEqual([worker.value.where, main.value.where], ['worker', 'main']);
  assert.ok(worker.value.moved > 0, 'groups moved');
  assert.ok(worker.value.waitingAware < worker.value.waitingUsual, 'and waiting fell');
  assert.equal(worker.value.text, main.value.text, 'the worker and the main thread say the same');
  assert.deepEqual(worker.value.own, [true, true, false], 'the two transitions with no crowd are the main answer\'s own objects; the one groups moved in is not');
  assert.deepEqual(main.value.own, [true, true, false], 'and so on the main thread');
});

test('the request is a message the worker answers once: the lane counted it sent and answered', async () => {
  const lane = await page.evaluate(() => ({ ...globalThis.sv2test.held.worker.laneStats.crowd }));
  assert.deepEqual(lane, { asked: 1, remembered: 0, sent: 1, answered: 1, dropped: 0, failed: 0 });
});

test('an answer for counters the store has moved past is dropped: the caller is told null, and asking again gets the store as it is', async () => {
  await page.evaluate(async () => {
    const t = globalThis.sv2test;
    // a store and client of their own, so nothing asked before is remembered
    const store = t.storeOf(t.halls());
    const client = t.createEngineClient(store);
    t.held.stale = { store, client };
    const dayTypeId = store.project.dayTypes[0].id;
    // asked at one set of counters; the building is renamed once the request is out
    t.settle('stale', client.crowd({ dayTypeId }));
    await client.results();
    store.apply(t.actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
  });
  const stale = await settled('stale');
  assert.deepEqual(stale, { ok: true, value: null });
  await page.evaluate(() => {
    const t = globalThis.sv2test;
    const { store, client } = t.held.stale;
    t.settle('fresh', client.crowd({ dayTypeId: store.project.dayTypes[0].id }), (answer) => ({ where: answer.where, moved: answer.run.changed.length, versions: answer.versions, now: { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion } }));
  });
  const fresh = await settled('fresh');
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(fresh.value.where, 'worker');
  assert.deepEqual(fresh.value.versions, fresh.value.now);
  assert.ok(fresh.value.moved > 0);
  const lane = await page.evaluate(() => ({ ...globalThis.sv2test.held.stale.client.laneStats.crowd }));
  assert.equal(lane.dropped, 1, 'the dropped answer was counted');
  assert.equal(lane.failed, 0);
});

test('a worker that does not know the message is given a wait, and then the main thread answers', async () => {
  await page.evaluate(async () => {
    const t = globalThis.sv2test;
    const store = t.storeOf(t.halls());
    const dayTypeId = store.project.dayTypes[0].id;
    // the real worker, behind a wrapper that never passes on the crowd request: an older worker.js
    const real = new Worker(new URL('engine/worker.js', location.href), { type: 'module' });
    const sent = [];
    const old = {
      postMessage(message) {
        sent.push(message.type);
        if (message.type !== 'sv2-derive-crowd') real.postMessage(message);
      },
      addEventListener: (type, listener) => real.addEventListener(type, listener),
      terminate: () => real.terminate(),
    };
    const client = t.createEngineClient(store, { worker: () => old, readyWait: 1500 });
    t.held.old = { client, sent };
    const main = await client.results();
    const started = performance.now();
    t.settle('old', client.crowd({ dayTypeId }), (answer) => ({ ...t.said(answer, main), waited: performance.now() - started }));
  });
  const old = await settled('old');
  assert.equal(old.ok, true, old.error);
  assert.equal(old.value.where, 'main');
  assert.ok(old.value.waited >= 1400, 'it waited for the worker first: ' + old.value.waited);
  assert.ok(old.value.moved > 0);
  const worker = await settled('halls-worker');
  assert.equal(old.value.text, worker.value.text, 'the same run the worker works out');
  assert.deepEqual(old.value.own, [true, true, false]);
  const after = await page.evaluate(() => ({ where: globalThis.sv2test.held.old.client.where, sent: globalThis.sv2test.held.old.sent }));
  assert.equal(after.where, 'worker', 'the worker is not given up on, only its crowd lane');
  assert.deepEqual(after.sent.filter((type) => type === 'sv2-derive-crowd'), ['sv2-derive-crowd']);
});

test('the main lane\'s result is still the very object it was, after the crowd lane ran', async () => {
  const same = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const first = await store.derived.results();
    const again = await store.derived.results();
    return { same: first === again, where: first.where, runs: first.work.run };
  });
  assert.equal(same.same, true);
  assert.equal(same.where, 'worker');
  assert.equal(same.runs, 1, 'the main pipeline ran once: the crowd lane never handed it another project');
});

test('workers are running engine/worker.js from this site, and nothing was fetched from anywhere else', async () => {
  const running = page.workers().map((worker) => worker.url());
  assert.ok(running.length >= 1);
  for (const url of running) assert.equal(url, server.base + TOOL_PATH + 'engine/worker.js');
  assert.ok(requests.length > 20, 'the requests were really recorded: ' + requests.length);
  for (const url of requests) assert.ok(url.startsWith(server.base + '/') || url.startsWith('blob:') || url.startsWith('data:'), 'offsite request: ' + url);
});

test('nothing went wrong on the page', () => {
  assert.deepEqual(errors, []);
});
