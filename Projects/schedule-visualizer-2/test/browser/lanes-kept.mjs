// The kept-scenario lane and the other-building lane in a real browser, with
// the real module worker: node test/browser/lanes-kept.mjs
//
// Opens the planner on the sample school, attaches the engine client to the
// page's own store (globalThis.sv2.store), keeps two scenarios beside an open
// one and asks the new lanes the way the scenario lab will: store.derived.kept(id),
// store.derived.setOther / other / closeOther. What is checked is that the
// worker really answered each (sv2-derive-kept, sv2-derive-other), that its
// answers are the main thread's for the same project, that a kept answer is
// dropped when its object leaves scenarios and an other answer after
// closeOther, that the main lane's result stays the very object it was, and
// that nothing was fetched from anywhere else.
//
// Every case waits on a state the page sets: an answer lands in
// globalThis.sv2test.done[name] when its promise settles, and the test waits
// for that, never for a first paint or for a fixed time (ARCHITECTURE and the
// SV2-93b/94 reports: a CI runner is slower than this machine).
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
    const { sampleSchool } = await import(at('data/sample-school.js'));
    const { keptScenarios } = await import(at('engine/scenario.js'));
    // typed arrays as lists, so two results can be compared as text
    const plain = (value) => JSON.stringify(value, (key, one) => (ArrayBuffer.isView(one) ? Array.from(one) : one));
    // a promise's outcome, kept where the test can wait for it
    const done = {};
    const settle = (name, promise) => {
      delete done[name];
      promise.then((value) => { done[name] = { ok: true, value: value === null ? null : { where: value.where, generation: value.generation, fileName: value.fileName, versions: value.versions, text: plain(value.result) } }; },
        (error) => { done[name] = { ok: false, error: error.message }; });
    };
    // the sample school with stairs B taken out: another building
    const other = createStore({ project: sampleSchool(), clock: () => new Date('2026-09-01T12:00:00Z'), ids: createIds(seededRandom(16)) });
    other.apply(actions.disconnectStairs, { connectionId: 'csample00b' });
    globalThis.sv2test = { engineFor, createEngineClient, actions, keptScenarios, plain, settle, done, otherProject: other.project, kept: {} };
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

test('two scenarios are kept beside an open one, and the worker is the one answering', async () => {
  const seen = await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const client = t.engineFor(store);
    const free = 'rsample204';
    store.apply(t.actions.newScenario, { name: 'Ease the walk' });
    store.apply(t.actions.addScenarioChange, { change: { kind: 'move', dayTypeId: 'dsample00a', groupId: 'gsample07c', period: 1, roomId: free } });
    store.apply(t.actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample08a', periodA: 5, periodB: 6 } });
    store.apply(t.actions.newScenario, { name: 'Closed stairs', keep: true });
    store.apply(t.actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: 'dsample00a', groupId: 'gsample06a', periodA: 1, periodB: 2 } });
    store.apply(t.actions.addScenarioLever, { lever: { kind: 'way', connectionId: 'csample00a', way: 'closed' } });
    store.apply(t.actions.newScenario, { name: 'Trial', keep: true });
    const kept = t.keptScenarios(store.project);
    t.kept.ids = Object.fromEntries(kept.map((scenario) => [scenario.name, scenario.id]));
    t.settle('main', store.derived.results());
    return { names: kept.map((scenario) => scenario.name).sort(), open: store.project.scenario.name, where: client.where, fallback: client.fallback };
  });
  assert.deepEqual(seen.names, ['Closed stairs', 'Ease the walk']);
  assert.equal(seen.open, 'Trial');
  assert.equal(seen.where, 'worker');
  assert.equal(seen.fallback, null);
  const main = await settled('main');
  assert.equal(main.ok, true, main.error);
  assert.equal(main.value.where, 'worker');
});

test('a kept scenario is answered by the worker, and the main thread says the same', async () => {
  // one at a time here; the next case asks for both together
  await page.evaluate(() => {
    globalThis.sv2test.kept.here = globalThis.sv2test.createEngineClient(globalThis.sv2.store, { worker: false });
  });
  const texts = {};
  for (const name of ['Ease the walk', 'Closed stairs']) {
    await page.evaluate((scenario) => {
      const { store } = globalThis.sv2;
      const t = globalThis.sv2test;
      t.settle('worker:' + scenario, store.derived.kept(t.kept.ids[scenario]));
      t.settle('main:' + scenario, t.kept.here.kept(t.kept.ids[scenario]));
    }, name);
    const worker = await settled('worker:' + name);
    const main = await settled('main:' + name);
    assert.equal(worker.ok, true, worker.error);
    assert.equal(main.ok, true, main.error);
    assert.equal(worker.value.where, 'worker', name);
    assert.equal(main.value.where, 'main', name);
    assert.equal(worker.value.text, main.value.text, name + ': the worker and the main thread say the same');
    assert.ok(worker.value.text.length > 1000, 'there is something to compare');
    texts[name] = worker.value.text;
  }
  assert.notEqual(texts['Ease the walk'], texts['Closed stairs'], 'each answer is its own scenario\'s');
  const lane = await page.evaluate(() => ({ ...globalThis.sv2test.engineFor(globalThis.sv2.store).laneStats.kept }));
  assert.deepEqual({ sent: lane.sent, answered: lane.answered, failed: lane.failed }, { sent: 2, answered: 2, failed: 0 });
  await page.evaluate((saved) => { globalThis.sv2test.kept.texts = saved; }, texts);
});

test('two kept scenarios asked together are both answered by the worker, as on the main thread, and neither is worked out again', async () => {
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    t.kept.sentBefore = t.engineFor(store).laneStats.kept.sent;
    // a client of its own with nothing remembered, so both really go to the worker
    t.kept.fresh = t.createEngineClient(store);
    t.settle('both-a', t.kept.fresh.kept(t.kept.ids['Ease the walk']));
    t.settle('both-b', t.kept.fresh.kept(t.kept.ids['Closed stairs']));
  });
  const a = await settled('both-a');
  const b = await settled('both-b');
  assert.equal(a.ok, true, a.error);
  assert.equal(b.ok, true, b.error);
  assert.ok(a.value && b.value, 'neither caller was told there is no such scenario');
  assert.equal(a.value.where, 'worker');
  assert.equal(b.value.where, 'worker');
  const texts = await page.evaluate(() => globalThis.sv2test.kept.texts);
  assert.equal(a.value.text, texts['Ease the walk']);
  assert.equal(b.value.text, texts['Closed stairs']);
  const lane = await page.evaluate(() => {
    const t = globalThis.sv2test;
    const stats = { ...t.kept.fresh.laneStats.kept };
    t.kept.fresh.close();
    return stats;
  });
  assert.deepEqual({ sent: lane.sent, answered: lane.answered, failed: lane.failed }, { sent: 2, answered: 2, failed: 0 });
});

test('a kept answer is dropped when its object leaves scenarios, and none is remembered for a scenario that is gone', async () => {
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const id = t.kept.ids['Closed stairs'];
    t.kept.droppedBefore = t.engineFor(store).laneStats.kept.dropped;
    // asked of a store whose counters have not moved, so it goes to the worker; the scenario is deleted before the answer is looked at
    store.apply(t.actions.renameScenario, { id, name: 'Closed stairs again' });
    t.settle('leaving', store.derived.kept(id));
    store.apply(t.actions.deleteScenario, { id });
  });
  const leaving = await settled('leaving');
  assert.equal(leaving.ok, true, leaving.error);
  assert.equal(leaving.value, null, 'an answer for a scenario that is gone goes to nobody');
  const after = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    const again = await store.derived.kept(t.kept.ids['Closed stairs']);
    const lane = t.engineFor(store).laneStats.kept;
    return { again, dropped: lane.dropped - t.kept.droppedBefore, failed: lane.failed, left: t.keptScenarios(store.project).map((scenario) => scenario.name) };
  });
  assert.equal(after.again, null);
  assert.ok(after.dropped >= 1, 'the dropped answer was counted');
  assert.equal(after.failed, 0);
  assert.deepEqual(after.left, ['Ease the walk']);
});

test('another building is answered by the worker on its own pipeline, the main thread says the same, and closeOther drops it', async () => {
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    t.kept.mainResult = null;
    store.derived.setOther(t.otherProject, 'next-year.json');
    t.kept.here.setOther(t.otherProject, 'next-year.json');
    t.settle('other-worker', store.derived.other());
    t.settle('other-main', t.kept.here.other());
  });
  const worker = await settled('other-worker');
  const main = await settled('other-main');
  assert.equal(worker.ok, true, worker.error);
  assert.equal(main.ok, true, main.error);
  assert.deepEqual([worker.value.where, main.value.where, worker.value.fileName], ['worker', 'main', 'next-year.json']);
  assert.equal(worker.value.text, main.value.text, 'the same answer from the worker and the main thread');
  const sample = await settled('main');
  assert.notEqual(worker.value.text, sample.value && sample.value.text, 'and it is the other building\'s, not the open project\'s');

  // the comparison ends with an answer on its way: nobody gets it
  await page.evaluate(() => {
    const { store } = globalThis.sv2;
    const t = globalThis.sv2test;
    store.derived.closeOther();
    t.settle('closed', store.derived.other());
    store.derived.setOther(t.otherProject, 'again.json');
    t.settle('asked', store.derived.other());
    store.derived.closeOther();
  });
  const closed = await settled('closed');
  assert.deepEqual(closed, { ok: true, value: null }, 'no comparison is held');
  const asked = await settled('asked');
  assert.deepEqual(asked, { ok: true, value: null }, 'closed while the worker was working: the answer goes to nobody');
  const lane = await page.evaluate(() => {
    const stats = globalThis.sv2test.engineFor(globalThis.sv2.store).laneStats.other;
    return { sent: stats.sent, answered: stats.answered, failed: stats.failed };
  });
  assert.equal(lane.failed, 0);
  assert.equal(lane.sent, 2, 'two comparisons were sent to the worker');
});

test('the main lane\'s result is still the very object it was, after both new lanes ran', async () => {
  const same = await page.evaluate(async () => {
    const { store } = globalThis.sv2;
    const first = await store.derived.results();
    const again = await store.derived.results();
    return { same: first === again, where: first.where, runs: first.work.run };
  });
  assert.equal(same.same, true);
  assert.equal(same.where, 'worker');
  assert.equal(same.runs, 1, 'the main pipeline ran once: neither lane ever handed it a project');
});

test('a worker is running engine/worker.js from this site, and nothing was fetched from anywhere else', () => {
  const running = page.workers().map((worker) => worker.url());
  assert.deepEqual(running, [server.base + TOOL_PATH + 'engine/worker.js']);
  assert.ok(requests.length > 20, 'the requests were really recorded: ' + requests.length);
  for (const url of requests) assert.ok(url.startsWith(server.base + '/') || url.startsWith('blob:') || url.startsWith('data:'), 'offsite request: ' + url);
});

test('nothing went wrong on the page', () => {
  assert.deepEqual(errors, []);
});
