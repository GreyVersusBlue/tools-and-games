// The crowd lane (engine/worker.js and ui/engine-client.js), in plain Node:
//   node test/engine/crowd-lane.test.mjs
//
// ARCHITECTURE 23.5 as revised by 23.12. Crowd-aware routes are asked of the
// worker (CROWD_REQUEST, CROWD_ANSWER) or worked out on the main thread, by
// the one function crowdRun; the page asks store.derived.crowd({ dayTypeId,
// bellsId }) only once it holds the main answer for the store's counters,
// drops an answer the counters have moved past, resolves { failed } on a throw
// and remembers nothing. The worker's own message handler runs here, with a
// stand-in for the worker scope, as test/engine/kept-lane.test.mjs does. The
// purpose-built two-halls building is where the rule demonstrably moves groups
// (test/fixtures/buildings/two-halls.mjs). How long the run takes is
// test/timing/crowd-routes.mjs; the real worker in a browser is
// test/browser/crowd-lane.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { emptyBells } from '../../engine/schema.js';
import {
  createPipeline, crowdRun, packCrowd, unpackCrowd, unpack, pack,
  REQUEST, ANSWER, CROWD_REQUEST, CROWD_ANSWER,
} from '../../engine/worker.js';
import { createEngineClient, engineFor, READY_WAIT_MS } from '../../ui/engine-client.js';
import { sampleSchool } from '../../data/sample-school.js';
import { twoHalls } from '../fixtures/buildings/two-halls.mjs';

const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'worker.js');
const clock = () => new Date('2026-09-01T12:00:00Z');

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

function versionsOf(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

// two-halls with a day type that is the same as the first, and a pattern in
// which only the last transition has a crowd in it
function halls(options) {
  const project = twoHalls(options);
  project.dayTypes.push({ id: 'dtfollow000', name: 'Follower', own: false, sameAs: project.dayTypes[0].id, short: '', bells: emptyBells(project.settings.periods) });
  return project;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// The client's waits are unref'd timers (a pending one must not keep a Node
// process alive), so a test that waits on one holds the process open itself.
function holdOpen() {
  const timer = setInterval(() => {}, 1000);
  return () => clearInterval(timer);
}

// a promise that must settle within `ms` (a test holding the process open would otherwise wait for ever)
function within(promise, ms, what) {
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(what + ' did not settle within ' + ms + ' ms')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let scopes = 0;
async function workerScope() {
  class WorkerGlobalScope extends EventTarget {
    constructor() {
      super();
      this.out = [];
    }

    postMessage(message) {
      this.out.push(structuredClone(message));
    }
  }
  const scope = new WorkerGlobalScope();
  const had = { self: globalThis.self, scopeClass: globalThis.WorkerGlobalScope };
  globalThis.WorkerGlobalScope = WorkerGlobalScope;
  globalThis.self = scope;
  scopes += 1;
  try {
    await import(pathToFileURL(WORKER_FILE).href + '?crowd=' + scopes);
  } finally {
    if (had.self === undefined) delete globalThis.self;
    else globalThis.self = had.self;
    if (had.scopeClass === undefined) delete globalThis.WorkerGlobalScope;
    else globalThis.WorkerGlobalScope = had.scopeClass;
  }
  const loaded = scope.out.splice(0);
  return {
    loaded,
    handle(message) {
      const event = new Event('message');
      event.data = structuredClone(message);
      scope.dispatchEvent(event);
      return scope.out.splice(0);
    },
  };
}

// Something the client can use as its worker. Messages wait in `inbox` until
// work() is called; `ignoring` lists message types this worker does not know
// (an older cached worker.js), which it takes and says nothing about.
async function standInWorker(ignoring) {
  const scope = await workerScope();
  const listeners = { message: [], error: [], messageerror: [] };
  return {
    inbox: [],
    seen: [],
    terminated: false,
    postMessage(message) {
      this.seen.push(message.type);
      this.inbox.push(structuredClone(message));
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    terminate() {
      this.terminated = true;
    },
    load() {
      for (const message of scope.loaded) for (const listener of listeners.message) listener({ data: message });
    },
    // the worker takes its oldest message and answers it; `change` may alter the answers on their way
    work(change) {
      const message = this.inbox.shift();
      if (ignoring && ignoring.includes(message.type)) return [];
      const answers = scope.handle(message);
      for (const answer of answers) {
        if (change) change(answer);
        for (const listener of listeners.message) listener({ data: answer });
      }
      return answers;
    },
    count(type) {
      return this.seen.filter((one) => one === type).length;
    },
  };
}

// the part of a run two engines must agree on, as plain data
function plain(run) {
  return JSON.parse(JSON.stringify(run, (key, value) => (ArrayBuffer.isView(value) ? Array.from(value) : value)));
}

function crowdMessage(store, extra) {
  return { type: CROWD_REQUEST, generation: 1, project: store.project, versions: versionsOf(store), dayTypeId: store.project.dayTypes[0].id, bellsId: null, ...(extra || {}) };
}

function mainMessage(store, generation) {
  return { type: REQUEST, generation: generation || 1, project: store.project, versions: versionsOf(store) };
}

// ------------------------------------------------------- the engine's side

test('crowdRun: the same run in the worker, on the main thread and straight from the engines', async () => {
  const store = storeOf(halls());
  const dayTypeId = store.project.dayTypes[0].id;
  const versions = versionsOf(store);

  const here = crowdRun(createPipeline(), store.project, versions, { dayTypeId, bellsId: null });
  assert.ok(here, 'a run');
  assert.ok(here.changed.length > 0, 'two-halls is where groups move');
  assert.ok(here.figures.aware.waiting < here.figures.usual.waiting, 'and waiting falls');

  const scope = await workerScope();
  const [main] = scope.handle(mainMessage(store));
  const mirror = unpack(main.answer, null);
  const [crowd] = scope.handle(crowdMessage(store, { generation: 2 }));
  assert.deepEqual([crowd.type, crowd.generation, crowd.ok], [CROWD_ANSWER, 2, true]);
  const there = unpackCrowd(crowd.answer, mirror);
  assert.deepEqual(plain(there), plain(here), 'what the worker answers is what the main thread works out');
});

test('crowdRun takes the pipeline\'s own result for the counters, so an unchanged transition is the very object', () => {
  // only the last transition has a crowd in it: the periods go h, h, h, a
  const store = storeOf(halls({ pattern: 'hhha' }));
  const dayTypeId = store.project.dayTypes[0].id;
  const pipeline = createPipeline();
  const main = pipeline.run(store.project, versionsOf(store));
  const run = crowdRun(pipeline, store.project, versionsOf(store), { dayTypeId });
  const usual = main.crowd.days[0].transitions;
  assert.equal(run.crowd.transitions.length, 3);
  assert.equal(run.crowd.transitions[0], usual[0], 'a transition nobody waits in is the main lane\'s object');
  assert.equal(run.crowd.transitions[1], usual[1]);
  assert.notEqual(run.crowd.transitions[2], usual[2], 'and the one groups moved in is not');
  assert.equal(pipeline.run(store.project, versionsOf(store)), main, 'the main lane\'s result is not touched');
});

test('crowdRun is null for a run the result does not have, and asks for nothing of a follower but the day it copies', () => {
  const store = storeOf(halls());
  const pipeline = createPipeline();
  const versions = versionsOf(store);
  assert.equal(crowdRun(pipeline, store.project, versions, { dayTypeId: store.project.dayTypes[0].id, bellsId: 'nobells' }), null);
  assert.equal(crowdRun(pipeline, store.project, versions, { dayTypeId: 'dnone' }), null);
  const own = crowdRun(pipeline, store.project, versions, { dayTypeId: store.project.dayTypes[0].id });
  const follower = crowdRun(pipeline, store.project, versions, { dayTypeId: 'dtfollow000' });
  assert.equal(follower.dayTypeId, own.dayTypeId, 'the run is the day it copies');
});

test('the worker packs against the main answer it last sent, only when that was for the same versions', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const scope = await workerScope();

  const [cold] = scope.handle(crowdMessage(store));
  assert.equal(cold.answer.whole, true, 'with nothing sent yet the answer is whole');

  const [main] = scope.handle(mainMessage(store, 2));
  const mirror = unpack(main.answer, null);
  const [packed] = scope.handle(crowdMessage(store, { generation: 3 }));
  assert.equal(packed.answer.whole, false, 'against a main answer for the same versions it is packed');
  assert.ok(packed.answer.run.crowd.transitions.slice(0, 2).every((one) => one === null), 'the transitions it left alone are not sent');
  assert.deepEqual(plain(unpackCrowd(packed.answer, mirror)), plain(unpackCrowd(cold.answer, null)), 'and say the same thing');

  const [forced] = scope.handle(crowdMessage(store, { generation: 4, whole: true }));
  assert.equal(forced.answer.whole, true, 'whole when the page asks for it');

  // the main lane moves on: the answer sent last is for other versions
  store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
  const [next] = scope.handle(mainMessage(store, 5));
  assert.ok(next.ok);
  const old = crowdMessage(store, { generation: 6, versions: versionsOf(storeOf(halls({ pattern: 'hhha' }))) });
  const [behind] = scope.handle(old);
  assert.equal(behind.ok, true);
  assert.equal(behind.answer.whole, true, 'a request for versions the main answer is past is sent whole');
});

test('the worker keeps its last two crowd answers and nothing else', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const scope = await workerScope();
  const at = (n) => ({ geometry: n, building: n, schedule: n });
  // the main lane holds other counters, so none of these is the main pipeline's held result
  assert.equal(scope.handle({ ...mainMessage(store), versions: at(9) })[0].ok, true);
  // three runs, one for each of three counters; the third pushes the first out
  for (const n of [1, 2, 3]) {
    const [answered] = scope.handle(crowdMessage(store, { generation: n, versions: at(n) }));
    assert.equal(answered.ok, true);
  }
  // a kept answer is given without looking at the project: a request with none still gets it
  const [second] = scope.handle(crowdMessage(store, { generation: 4, versions: at(2), project: null }));
  assert.equal(second.ok, true);
  assert.ok(second.answer.run, 'the second is still held');
  const [third] = scope.handle(crowdMessage(store, { generation: 5, versions: at(3), project: null }));
  assert.equal(third.ok, true);
  assert.ok(third.answer.run, 'and the third');
  const [first] = scope.handle(crowdMessage(store, { generation: 6, versions: at(1), project: null }));
  assert.equal(first.ok, false, 'the first has been let go: with no project it cannot be worked out again');
  assert.equal(typeof first.error, 'string');
});

test('a part the answer keeps that the page never had is a null, never a throw', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const scope = await workerScope();
  const [main] = scope.handle(mainMessage(store));
  const mirror = unpack(main.answer, null);
  const [crowd] = scope.handle(crowdMessage(store, { generation: 2 }));
  assert.equal(crowd.answer.whole, false);
  assert.equal(unpackCrowd(crowd.answer, null), null, 'no main answer held');
  assert.equal(unpackCrowd(crowd.answer, { ...mirror, versions: { ...mirror.versions, schedule: 99 } }), null, 'a main answer for other counters');
  assert.equal(unpackCrowd(crowd.answer, { ...mirror, crowd: { days: [] } }), null, 'one without the run');
  assert.equal(unpackCrowd(crowd.answer, { versions: mirror.versions }), null, 'one with nothing in it');
  assert.equal(unpackCrowd(undefined, mirror), null);
  assert.equal(unpackCrowd(null, mirror), null);
  assert.equal(packCrowd(null, mirror.versions, null), null);
  // an answer that keeps a walk (one for a run nobody moved in) from a main answer with none
  // (the sample school honestly finds nothing to move)
  const quiet = storeOf(sampleSchool());
  const pipeline = createPipeline();
  const held = pipeline.run(quiet.project, versionsOf(quiet));
  const calm = crowdRun(pipeline, quiet.project, versionsOf(quiet), { dayTypeId: 'dsample00a' });
  assert.equal(calm.changed.length, 0);
  const sentCalm = packCrowd(calm, held.versions, held);
  assert.equal(sentCalm.whole, false);
  assert.ok(sentCalm.run.walks.groups.length > 0 && sentCalm.run.walks.groups.every((walk) => walk.kept !== undefined), 'every walk of a run nobody moved in is kept');
  assert.equal(unpackCrowd(sentCalm, { ...held, walks: { ...held.walks, groups: [] } }), null, 'one whose walks are not the ones the answer kept');
  assert.deepEqual(plain(unpackCrowd(sentCalm, held)), plain(calm));
});

// ----------------------------------------------------------- on the page

test('main thread: store.derived.crowd gives the run, the transitions it left alone the main answer\'s own', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const client = engineFor(store, { worker: false });
  const main = await client.results();
  const answer = await store.derived.crowd({ dayTypeId: store.project.dayTypes[0].id });
  assert.deepEqual(Object.keys(answer).sort(), ['generation', 'run', 'versions', 'where']);
  assert.equal(answer.where, 'main');
  assert.deepEqual(answer.versions, versionsOf(store));
  assert.ok(answer.run.changed.length > 0);
  assert.equal(answer.run.crowd.transitions[0], main.crowd.days[0].transitions[0]);
  assert.equal(answer.run.crowd.transitions[1], main.crowd.days[0].transitions[1]);
  assert.equal(client.laneStats.crowd.answered, 1);
});

test('a follower day type asks, and is answered, as the day it copies', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: 'dtfollow000' });
  worker.work();
  await tick();
  const request = worker.inbox[0];
  assert.equal(request.type, CROWD_REQUEST);
  assert.equal(request.dayTypeId, store.project.dayTypes[0].id, 'the request carries the effective day type');
  assert.equal(request.bellsId, null);
  worker.work();
  const answer = await asked;
  assert.equal(answer.run.dayTypeId, store.project.dayTypes[0].id);
  // asking as the day it copies is the same asking
  assert.equal(client.crowd({ dayTypeId: store.project.dayTypes[0].id }), client.crowd({ dayTypeId: 'dtfollow000' }));
  assert.equal(await client.crowd({ dayTypeId: 'dnone' }), null, 'a day type that is not there is null, and nothing is sent');
  assert.equal(worker.count(CROWD_REQUEST), 1);
});

test('the page asks only once the main answer for the store\'s counters is held', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  await tick();
  assert.deepEqual(worker.seen, [REQUEST], 'the main request is out; the crowd one is not');
  assert.equal(client.laneStats.crowd.sent, 0);
  worker.work(); // the main answer
  await tick();
  assert.deepEqual(worker.seen, [REQUEST, CROWD_REQUEST], 'and once the main answer is held, the crowd one goes');
  worker.work();
  const answer = await asked;
  assert.equal(answer.where, 'worker');
  assert.equal(answer.generation, 1);
  assert.equal(answer.run.crowd.transitions[0], (await client.results()).crowd.days[0].transitions[0], 'a part left alone is the main answer\'s own object');
  assert.deepEqual({ ...client.laneStats.crowd }, { asked: 1, remembered: 0, sent: 1, answered: 1, dropped: 0, failed: 0 });
});

test('asked twice it is one request and one promise; a different run replaces it and its caller gets null', async () => {
  const store = storeOf(sampleSchool());
  const client = engineFor(store, { worker: false });
  const a = client.crowd({ dayTypeId: 'dsample00a' });
  assert.equal(client.crowd({ dayTypeId: 'dsample00a' }), a);
  assert.equal(client.laneStats.crowd.remembered, 1);
  const b = client.crowd({ dayTypeId: 'dsample00b' });
  assert.notEqual(a, b);
  assert.equal(await a, null, 'nobody is showing day A any more');
  const answer = await b;
  assert.equal(answer.run.dayTypeId, 'dsample00b');
  assert.equal(client.crowd({ dayTypeId: 'dsample00b' }), b, 'an answered asking is remembered while the counters stand');
});

test('an answer for counters the store has moved past is dropped, and the page is told null', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 1);
  store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
  worker.work(); // the answer for the counters before the change
  assert.equal(await asked, null);
  assert.equal(client.laneStats.crowd.dropped, 1);
  // asking again is a new request for the store as it is
  const again = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work(); // the main answer for the new counters
  await tick();
  worker.work();
  const answer = await again;
  assert.deepEqual(answer.versions, versionsOf(store));
});

test('counters that move before the main answer comes: null, and nothing is sent', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
  worker.work(); // the stale main answer: the page waits for the newest
  await tick();
  worker.work(); // the newest
  assert.equal(await asked, null);
  assert.equal(worker.count(CROWD_REQUEST), 0, 'the crowd request was never sent');
  assert.equal(client.laneStats.crowd.sent, 0);
});

test('a worker that ignores the type is left to after READY_WAIT_MS, and the main thread answers', async () => {
  const release = holdOpen();
  assert.equal(READY_WAIT_MS, 10000);
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker([CROWD_REQUEST]);
  const client = createEngineClient(store, { worker: () => worker, readyWait: 40 });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work(); // the main answer
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 1);
  worker.work(); // taken and ignored
  const answer = await asked;
  assert.equal(answer.where, 'main');
  assert.equal(client.where, 'worker', 'the worker is not given up on: only its crowd lane is');
  const here = crowdRun(createPipeline(), store.project, versionsOf(store), { dayTypeId: store.project.dayTypes[0].id });
  assert.deepEqual(plain(answer.run), plain(here));
  assert.equal(answer.run.crowd.transitions[0], (await client.results()).crowd.days[0].transitions[0], 'a part left alone is still the main answer\'s own object');
  // the next asking does not wait for it again
  store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
  const next = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  assert.equal((await next).where, 'main');
  assert.equal(worker.count(CROWD_REQUEST), 1, 'and sent it nothing');
  release();
});

test('the crowd lane\'s wait is cleared when the worker answers, so nothing runs twice', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker, readyWait: 30 });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  await tick();
  worker.work();
  const answer = await asked;
  assert.equal(answer.where, 'worker');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(client.where, 'worker');
  assert.equal(client.laneStats.crowd.answered, 1);
});

test('a failure is { failed }, and remembered by nobody: the next asking is a new request', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  await tick();
  worker.work((answer) => {
    if (answer.type === CROWD_ANSWER) Object.assign(answer, { ok: false, answer: undefined, error: 'It broke.' });
  });
  assert.deepEqual(await asked, { failed: 'It broke.' });
  assert.equal(client.laneStats.crowd.failed, 1);
  const again = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 2, 'asked again, not given the failure');
  worker.work();
  assert.ok((await again).run, 'and it works');
});

test('a throw on the main thread is { failed } too, and the main lane is as it was', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const mended = store.project;
  // the store as the client sees it, its project's groups unreadable: only the crowd lane reads them again
  const broken = { ...mended };
  Object.defineProperty(broken, 'groups', { get() { throw new Error('The groups are gone.'); }, enumerable: true });
  let current = mended;
  const seen = Object.create(store, { project: { get: () => current } });
  const client = engineFor(seen, { worker: false });
  const main = await client.results();
  current = broken;
  const failed = await client.crowd({ dayTypeId: mended.dayTypes[0].id });
  assert.deepEqual(failed, { failed: 'The groups are gone.' });
  assert.equal(client.laneStats.crowd.failed, 1);
  assert.equal(await client.results(), main, 'the main lane\'s answer is the same promise\'s');
  current = mended;
  const mendedAnswer = await client.crowd({ dayTypeId: mended.dayTypes[0].id });
  assert.ok(mendedAnswer.run, 'and asking again works');
});

test('an answer the page cannot put together is asked for again, whole, and not more than once', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  await tick();
  // the answer says it is for other counters than the main answer the page holds
  worker.work((answer) => {
    if (answer.type === CROWD_ANSWER) answer.answer.versions = { ...answer.answer.versions, schedule: 99 };
  });
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 2, 'it was asked for again');
  assert.equal(worker.inbox[0].whole, true, 'whole');
  worker.work();
  const answer = await asked;
  assert.ok(answer.run.changed.length > 0);
  assert.equal(client.laneStats.crowd.answered, 1);
});

test('close() settles a crowd asking and leaves no timer behind', async () => {
  const release = holdOpen();
  const store = storeOf(halls({ pattern: 'hhha' }));
  const worker = await standInWorker([CROWD_REQUEST]);
  const client = createEngineClient(store, { worker: () => worker, readyWait: 20 });
  worker.load();
  const asked = client.crowd({ dayTypeId: store.project.dayTypes[0].id });
  worker.work();
  await tick();
  client.close();
  assert.deepEqual(await asked, { failed: 'This engine client has been closed.' });
  await assert.rejects(client.crowd({ dayTypeId: store.project.dayTypes[0].id }), /closed/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
});

test('store.derived.crowd refuses until an engine is attached', async () => {
  const store = storeOf(halls());
  const client = engineFor(store, { worker: false });
  assert.equal(typeof store.derived.crowd, 'function');
  assert.ok((await store.derived.crowd({ dayTypeId: store.project.dayTypes[0].id })).run);
  client.close();
  await assert.rejects(store.derived.crowd({ dayTypeId: store.project.dayTypes[0].id }), /engineFor\(store\)/);
});

// ------------------------------------------- the lane is never left wedged

test('a replacing asking while one is with the worker: the first is null, the second is sent and settles with its own answer', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const a = client.crowd({ dayTypeId: 'dsample00a' });
  worker.work(); // the main answer
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 1, 'day A is out');
  const b = client.crowd({ dayTypeId: 'dsample00a', bellsId: 'bsample0er' });
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 1, 'the second waits while the first is with the worker');
  worker.work(); // the answer for day A, which nobody is showing now
  assert.equal(await a, null);
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 2, 'and once it is answered, the second goes');
  assert.equal(worker.inbox[0].bellsId, 'bsample0er');
  worker.work();
  const answer = await b;
  assert.equal(answer.where, 'worker');
  assert.equal(answer.run.dayTypeId, 'dsample00a');
  assert.equal(answer.run.bellsId, 'bsample0er');
});

test('a failed answer for a replaced asking also lets the lane go', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = createEngineClient(store, { worker: () => worker });
  worker.load();
  const a = client.crowd({ dayTypeId: 'dsample00a' });
  worker.work();
  await tick();
  const b = client.crowd({ dayTypeId: 'dsample00b' });
  await tick();
  worker.work((answer) => {
    if (answer.type === CROWD_ANSWER) Object.assign(answer, { ok: false, answer: undefined, error: 'It broke.' });
  });
  assert.equal(await a, null);
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 2);
  worker.work();
  assert.equal((await b).run.dayTypeId, 'dsample00b');
});

test('the counters move while one is with the worker, then a new asking: it is sent once the main answer comes, and settles', async () => {
  // in either order: a worker answers in turn, but the lane must not count on it
  for (const mainFirst of [false, true]) {
    const store = storeOf(halls({ pattern: 'hhha' }));
    const dayTypeId = store.project.dayTypes[0].id;
    const worker = await standInWorker();
    const client = createEngineClient(store, { worker: () => worker });
    worker.load();
    const a = client.crowd({ dayTypeId });
    worker.work(); // the main answer
    await tick();
    assert.equal(worker.count(CROWD_REQUEST), 1);
    store.apply(actions.renameFloor, { id: store.project.building.floors[0].id, name: 'Ground' });
    const b = client.crowd({ dayTypeId });
    await tick();
    assert.deepEqual(worker.inbox.map((one) => one.type), [CROWD_REQUEST, REQUEST], 'the old crowd request, then the main one for the new counters');
    if (mainFirst) worker.inbox.reverse();
    worker.work(); // one of the two
    await tick();
    worker.work(); // and the other
    await tick();
    assert.equal(worker.count(CROWD_REQUEST), 2, 'the new asking goes (' + (mainFirst ? 'main answer first' : 'crowd answer first') + ')');
    worker.work();
    const answer = await b;
    assert.deepEqual(answer.versions, versionsOf(store));
    assert.ok(answer.run.changed.length > 0);
    assert.deepEqual(await a, answer, 'the first asking, for the same day, is given the new answer');
  }
});

test('a timeout for a replaced asking: the lane is the main thread\'s from then on, and the new day type settles there', async () => {
  const release = holdOpen();
  const store = storeOf(sampleSchool());
  const worker = await standInWorker([CROWD_REQUEST]);
  const client = createEngineClient(store, { worker: () => worker, readyWait: 40 });
  worker.load();
  const a = client.crowd({ dayTypeId: 'dsample00a' });
  worker.work(); // the main answer
  await tick();
  assert.equal(worker.count(CROWD_REQUEST), 1);
  worker.work(); // taken and ignored
  const b = client.crowd({ dayTypeId: 'dsample00b' });
  assert.equal(await a, null);
  let answer;
  try {
    answer = await within(b, 5000, 'day B');
  } finally {
    release();
  }
  assert.equal(answer.where, 'main');
  assert.equal(answer.run.dayTypeId, 'dsample00b');
  assert.equal(worker.count(CROWD_REQUEST), 1, 'the worker was not asked again');
  assert.equal(client.where, 'worker');
});

test('a crowd request for other versions leaves the main lane\'s held answer as it was', async () => {
  const store = storeOf(halls({ pattern: 'hhha' }));
  const scope = await workerScope();
  const [main] = scope.handle(mainMessage(store));
  assert.equal(main.answer.work.run, 1);
  // a crowd request for counters the main lane does not hold
  const later = storeOf(halls({ pattern: 'hhha' }));
  later.apply(actions.renameFloor, { id: later.project.building.floors[0].id, name: 'Ground' });
  const [other] = scope.handle(crowdMessage(later, { generation: 2 }));
  assert.equal(other.ok, true);
  assert.equal(other.answer.whole, true);
  const fresh = crowdRun(createPipeline(), later.project, versionsOf(later), { dayTypeId: later.project.dayTypes[0].id });
  assert.deepEqual(plain(other.answer.run), plain(fresh), 'worked out for its own versions');
  // the main lane asked again for its counters: the held result, not a new run
  const [again] = scope.handle(mainMessage(store, 3));
  assert.equal(again.answer.work.run, 1, 'the main pipeline did not run again');
  assert.ok(['places', 'buildingFindings', 'walks', 'findings'].every((part) => again.answer.kept.includes(part)), 'and every part is the one sent before');
  assert.ok(again.answer.kept.includes('routes') && again.answer.kept.includes('crowd'));
  // and a crowd request for its own counters is still packed against it, an unchanged transition the very object
  const mirror = unpack(main.answer, null);
  const [own] = scope.handle(crowdMessage(store, { generation: 4 }));
  assert.equal(own.answer.whole, false);
  assert.equal(unpackCrowd(own.answer, mirror).crowd.transitions[0], mirror.crowd.days[0].transitions[0]);
});

test('the main lane and the other lanes answer exactly as they did: pack and unpack are untouched', async () => {
  const store = storeOf(sampleSchool());
  const result = createPipeline().run(store.project, versionsOf(store));
  const again = unpack(pack(result, null), null);
  assert.deepEqual(plain(again.crowd), plain(result.crowd));
  assert.deepEqual(plain(again.routes), plain(result.routes));
});
