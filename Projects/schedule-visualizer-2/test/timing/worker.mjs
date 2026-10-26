// Timing: full routing, cold, in a real worker, at the size the tool
// promises to stay responsive at (the fixture in test/fixtures/big.mjs: 4
// floors of 60 by 40, 150 rooms, 80 groups, 10 periods, two own day types).
//
// The worker is a Node worker thread (node:worker_threads) running
// engine/worker.js, the module the page loads as its Web Worker, unchanged:
// this file is the thread's script too, and in the thread it stands in the
// little of a worker's global scope that engine/worker.js asks for
// (WorkerGlobalScope, self.addEventListener('message'), self.postMessage)
// and then imports it, so the thread holds the page worker's whole module
// graph and its message listener. Every batch is a fresh thread, so every
// measure is cold: a new isolate, nothing compiled, the project arriving by
// structured clone as the page sends it.
//
//   routing   in a fresh thread with engine/worker.js loaded, the project
//             posted to it, and then every route of the schedule from
//             nothing (routingGraph and crowd.js routesByRun, every run, the
//             graph built inside the measure, as routing.mjs times it), by
//             the modules engine/worker.js itself imported: budget 700 ms
//             (ARCHITECTURE 14), timed inside the thread
//   derive    in another fresh thread, the page's first question: a
//             'sv2-derive' message with the project, answered by
//             engine/worker.js's own listener, from the post to the answer
//             back on this side (routing, the crowd model, loads, places,
//             walk results, both lists of findings, and the clone each
//             way). It holds three rows of ARCHITECTURE 14 together, so its
//             budget is theirs added: routing 700, crowd 500, checks 100,
//             1300 ms
//   derive, twelve runs   the same for the fixture grown as ARCHITECTURE
//             17.8 says (test/timing/big-runs.mjs: four own day types and
//             two bell schedules), under the same 1300 ms: the cold figure
//             for a school with bell schedules, since every thread is new
//
// Each is held on the median of RUNS batches (one fresh thread each). The
// suite fails at twice each budget (SLACK 2, as every timing file here: a
// CI runner is not this machine) and prints the measured numbers either
// way. The clock is read here, in the test, never in the engine.

import { isMainThread, parentPort, Worker } from 'node:worker_threads';

const ROUTE_REQUEST = 'sv2-timing-route';
const ROUTE_ANSWER = 'sv2-timing-routed';

if (!isMainThread) {
  // ---- in the thread: a worker's scope, as far as engine/worker.js reads it
  class WorkerGlobalScope {}
  const scope = Object.create(WorkerGlobalScope.prototype);
  scope.addEventListener = (type, listener) => {
    if (type === 'message') parentPort.on('message', (data) => listener({ data }));
  };
  scope.postMessage = (message) => parentPort.postMessage(message);
  globalThis.WorkerGlobalScope = WorkerGlobalScope;
  globalThis.self = scope;
  // the same module instance engine/worker.js imports, so what is timed is its routing
  const { routingGraph, createRouteCache } = await import('../../engine/routing.js');
  const { routesByRun } = await import('../../engine/crowd.js');
  const { buildGraph } = await import('../../engine/graph.js');
  parentPort.on('message', (message) => {
    if (!message || message.type !== ROUTE_REQUEST) return;
    const project = message.project;
    const started = performance.now();
    const routes = routesByRun(project, routingGraph(project, buildGraph(project)), { cache: createRouteCache(), geometryVersion: 1 });
    const ms = performance.now() - started;
    let ok = 0;
    for (const day of routes.days) for (const group of day.groups) for (const found of group.routes) if (found.ok && !found.same) ok += 1;
    parentPort.postMessage({ type: ROUTE_ANSWER, ms, transitions: routes.transitions, searches: routes.searches, ok });
  });
  // engine/worker.js says READY once it and all it imports have loaded
  await import('../../engine/worker.js');
} else {
  const { default: test } = await import('node:test');
  const { default: assert } = await import('node:assert/strict');
  const { READY, REQUEST, ANSWER } = await import('../../engine/worker.js');
  const { bigProject, BIG } = await import('../fixtures/big.mjs');
  const { bigRunsProject, BIG_RUNS } = await import('./big-runs.mjs');

  const ROUTING_BUDGET = 700;
  const DERIVE_BUDGET = 700 + 500 + 100;
  const SLACK = 2;
  const RUNS = 5;
  const TRANSITIONS = (BIG.periods - 1) * BIG.dayTypes;
  // A thread that never says READY or never answers fails the case, never hangs it.
  const WAIT_MS = 60000;

  function within(promise, what) {
    let timer = null;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(what + ': nothing came in ' + WAIT_MS / 1000 + ' s')), WAIT_MS);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // A fresh thread running engine/worker.js; resolves once it says READY.
  function startThread() {
    const thread = new Worker(new URL(import.meta.url));
    const ready = new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message && message.type === READY) {
          thread.off('message', onMessage);
          resolve();
        }
      };
      thread.on('message', onMessage);
      thread.once('error', reject);
      thread.once('exit', (code) => reject(new Error('the worker thread stopped before it was ready, code ' + code)));
    });
    return { thread, ready: within(ready, 'engine/worker.js in a worker thread never said ' + READY) };
  }

  // Post `message` and resolve with the first answer of type `type`.
  function ask(thread, message, type) {
    return within(new Promise((resolve, reject) => {
      const onMessage = (answer) => {
        if (answer && answer.type === type) {
          thread.off('message', onMessage);
          resolve(answer);
        }
      };
      thread.on('message', onMessage);
      thread.once('error', reject);
      thread.postMessage(message);
    }), 'the worker thread never answered ' + message.type);
  }

  const median = (list) => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];

  test('full routing on the big fixture, cold, in a worker thread running engine/worker.js: under ' + ROUTING_BUDGET + ' ms', async () => {
    const project = bigProject({ seed: 1 });
    const inside = [];
    const round = [];
    let last = null;
    for (let run = 0; run < RUNS; run += 1) {
      const { thread, ready } = startThread();
      try {
        await ready;
        const started = performance.now();
        last = await ask(thread, { type: ROUTE_REQUEST, project }, ROUTE_ANSWER);
        round.push(performance.now() - started);
        inside.push(last.ms);
      } finally {
        await thread.terminate();
      }
    }
    const at = median(inside);
    console.log('# worker routing, cold: median ' + at.toFixed(1) + ' ms in the thread of ' + inside.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + ROUTING_BUDGET + ', fails at ' + ROUTING_BUDGET * SLACK + '); post to answer, the project cloned in: median ' + median(round).toFixed(1) + ' ms; ' + last.transitions + ' transitions, ' + last.ok + ' journeys, ' + last.searches + ' searches');

    assert.equal(last.transitions, BIG.groups * TRANSITIONS);
    assert.ok(last.ok > 1000, 'the fixture is really routed: ' + last.ok + ' journeys found a way');
    assert.ok(last.searches > 100, 'and cold really searched: ' + last.searches);
    assert.ok(at < ROUTING_BUDGET * SLACK, 'full routing in the worker took ' + at.toFixed(1) + ' ms at the median, over ' + ROUTING_BUDGET * SLACK);
  });

  test('the page\'s first question to a cold worker, the whole derive of the big fixture: under ' + DERIVE_BUDGET + ' ms', async () => {
    const project = bigProject({ seed: 1 });
    const versions = { geometry: 1, building: 1, schedule: 1 };
    const each = [];
    let last = null;
    for (let run = 0; run < RUNS; run += 1) {
      const { thread, ready } = startThread();
      try {
        await ready;
        const started = performance.now();
        last = await ask(thread, { type: REQUEST, generation: run + 1, project, versions }, ANSWER);
        each.push(performance.now() - started);
      } finally {
        await thread.terminate();
      }
    }
    const at = median(each);
    assert.equal(last.ok, true, 'the worker answered: ' + last.error);
    const answer = last.answer;
    console.log('# worker derive, cold, post to answer: median ' + at.toFixed(1) + ' ms of ' + each.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + DERIVE_BUDGET + ', fails at ' + DERIVE_BUDGET * SLACK + '); ' + answer.work.searches + ' searches, ' + answer.work.transitionsRun + ' transitions, ' + answer.walks.groups.length + ' group walks, ' + answer.findings.findings.length + ' findings');

    assert.deepEqual(answer.versions, versions);
    assert.equal(answer.work.run, 1, 'the first run of the thread');
    assert.equal(answer.work.routesRun, true);
    assert.ok(answer.work.searches > 100, 'cold really searched: ' + answer.work.searches);
    assert.equal(answer.work.transitionsRun, TRANSITIONS, 'every transition was walked');
    assert.deepEqual(answer.kept, [], 'nothing was left out of a first answer');
    assert.ok(answer.walks.groups.length > 1000, 'the fixture really walks: ' + answer.walks.groups.length);
    assert.ok(at < DERIVE_BUDGET * SLACK, 'the first derive in the worker took ' + at.toFixed(1) + ' ms at the median, over ' + DERIVE_BUDGET * SLACK);
  });

  test('the page\'s first question to a cold worker for the twelve runs of the grown fixture: under ' + DERIVE_BUDGET + ' ms', async () => {
    const project = bigRunsProject({ seed: 1 });
    const versions = { geometry: 1, building: 1, schedule: 1 };
    const each = [];
    let last = null;
    for (let run = 0; run < RUNS; run += 1) {
      const { thread, ready } = startThread();
      try {
        await ready;
        const started = performance.now();
        last = await ask(thread, { type: REQUEST, generation: run + 1, project, versions }, ANSWER);
        each.push(performance.now() - started);
      } finally {
        await thread.terminate();
      }
    }
    const at = median(each);
    assert.equal(last.ok, true, 'the worker answered: ' + last.error);
    const answer = last.answer;
    console.log('# worker derive, twelve runs, cold, post to answer: median ' + at.toFixed(1) + ' ms of ' + each.map((ms) => ms.toFixed(1)).join(', ') + ' (budget ' + DERIVE_BUDGET + ', fails at ' + DERIVE_BUDGET * SLACK + '); ' + answer.work.transitions + ' transitions, ' + answer.work.transitionsRun + ' simulated, ' + (answer.walks.groups.length + answer.walks.bells.groups.length) + ' group walks, ' + answer.findings.findings.length + ' findings');
    assert.equal(answer.work.transitions, (BIG.periods - 1) * BIG_RUNS.runs);
    assert.equal(answer.crowdBells.length, BIG_RUNS.runs - BIG_RUNS.ownDayTypes);
    assert.ok(at < DERIVE_BUDGET * SLACK, 'the first derive of twelve runs took ' + at.toFixed(1) + ' ms at the median, over ' + DERIVE_BUDGET * SLACK);
  });
}
