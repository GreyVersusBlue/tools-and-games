// The scenario lane and the suggestion lane (engine/worker.js and
// ui/engine-client.js), in plain Node:
//   node test/ui/scenario-lane.test.mjs
//
// A second pipeline shares the first one's route cache; the worker answers
// sv2-derive-scenario with the trimmed result of the project with its
// scenario applied, and sv2-suggest with suggest()'s answer, each on a
// pipeline the main lane never sees; store.derived.scenario() is keyed by
// the three counters and the identity of project.scenario, drops a stale
// answer and remembers no failure; and the main thread gives the same
// answers as the worker. The worker's own message handler runs here, with a
// stand-in for the worker scope, the way test/engine/worker.test.mjs runs it.
// How long the lane takes at the promised size is test/timing/scenario-lane.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { applyChanges, reconcile, trimResult, compareResults } from '../../engine/scenario.js';
import { suggest, NO_SUGGESTION } from '../../engine/suggest.js';
import {
  createPipeline, pack, scenarioRun, suggestRun,
  REQUEST, ANSWER, SCENARIO_REQUEST, SCENARIO_ANSWER, SUGGEST_REQUEST, SUGGEST_ANSWER,
} from '../../engine/worker.js';
import { createEngineClient, engineFor } from '../../ui/engine-client.js';
import { sampleSchool, SAMPLE_PROBLEMS } from '../../data/sample-school.js';

const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'worker.js');
const clock = () => new Date('2026-09-01T12:00:00Z');
const DAY_A = SAMPLE_PROBLEMS.roomDouble.dayTypeId;
const PERIOD = SAMPLE_PROBLEMS.roomDouble.period;
const DOUBLE_ID = 'room-double:' + DAY_A + ':' + PERIOD + ':' + SAMPLE_PROBLEMS.roomDouble.roomId;

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

function versionsOf(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

// A room nobody is in at (day type, period), other than `not`.
function freeRoom(project, dayTypeId, period, not) {
  const used = new Set(project.groups.map((group) => effectiveSchedule(project, group.id, dayTypeId)[period].room));
  return allRooms(project).find((room) => !used.has(room.id) && room.id !== not);
}

// The sample school with a scenario of two changes open: 7C out of the
// double-booked room in Period 2, and 8A's Periods 6 and 7 swapped (the long
// walk), both on A Day.
function withScenario(store) {
  const room = freeRoom(store.project, DAY_A, PERIOD);
  store.apply(actions.newScenario, { name: 'Ease the walk' });
  store.apply(actions.addScenarioChange, { change: { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: PERIOD, roomId: room.id } });
  store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: DAY_A, groupId: 'gsample08a', periodA: 5, periodB: 6 } });
  assert.equal(store.project.scenario.changes.length, 2, 'the scenario holds two changes');
  return store;
}

// What the lane must answer for `project`, worked out straight from the
// engines on a pipeline of its own.
function expectedScenario(project) {
  const kept = reconcile(project, project.scenario).changes;
  return trimResult(createPipeline().run(applyChanges(project, kept)));
}

// engine/worker.js finding itself in a worker (a fresh copy of the module);
// messages are copied the way postMessage copies them.
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
    await import(pathToFileURL(WORKER_FILE).href + '?lane=' + scopes);
  } finally {
    if (had.self === undefined) delete globalThis.self;
    else globalThis.self = had.self;
    if (had.scopeClass === undefined) delete globalThis.WorkerGlobalScope;
    else globalThis.WorkerGlobalScope = had.scopeClass;
  }
  scope.out.splice(0);
  return {
    handle(message) {
      const event = new Event('message');
      event.data = structuredClone(message);
      scope.dispatchEvent(event);
      return scope.out.splice(0);
    },
  };
}

// The real worker's handler as the client's worker. Messages wait in
// `inbox` until the case calls work() (oldest first) or workAll(); a case
// can make the next `refuse` scenario or suggestion requests fail.
async function standInWorker() {
  const scope = await workerScope();
  const listeners = { message: [], error: [], messageerror: [] };
  return {
    inbox: [],
    posted: [],
    sent: [], // { type, versions } of each message, as it was sent
    refuse: 0,
    postMessage(message) {
      this.posted.push(message.type);
      this.sent.push({ type: message.type, versions: { ...message.versions } });
      this.inbox.push(structuredClone(message));
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    terminate() {},
    emit(type, event) {
      for (const listener of listeners[type]) listener(event);
    },
    work() {
      const message = this.inbox.shift();
      assert.ok(message, 'the worker was sent something to answer');
      let answers;
      if (this.refuse > 0 && message.type !== REQUEST) {
        this.refuse -= 1;
        answers = [{ type: message.type === SCENARIO_REQUEST ? SCENARIO_ANSWER : SUGGEST_ANSWER, generation: message.generation, ok: false, error: 'It could not be worked out.' }];
      } else {
        answers = scope.handle(message);
      }
      for (const answer of answers) for (const listener of listeners.message) listener({ data: answer });
    },
    async workAll() {
      // answers lead to more requests (a comparison asks the main lane), so
      // keep going until the inbox stays empty over a turn
      for (let rounds = 0; rounds < 50; rounds += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (this.inbox.length === 0) return;
        while (this.inbox.length > 0) this.work();
      }
      throw new Error('the worker was kept busy for 50 rounds');
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Ask, let the stand-in work, and give the answer.
async function answered(worker, promise) {
  await worker.workAll();
  return promise;
}

// ------------------------------------------------------------ the pipeline

test('createPipeline({ cache }) shares the route cache: the second pipeline searches nothing; with no argument, a cache of its own', () => {
  const project = sampleSchool();
  const versions = { geometry: 1, building: 1, schedule: 1 };
  const first = createPipeline();
  const ran = first.run(project, versions);
  assert.ok(ran.work.searches > 0, 'the first pipeline searched');
  const beside = createPipeline({ cache: first.cache });
  assert.equal(beside.cache, first.cache, 'the cache handed in is the one used');
  const shared = beside.run(project, versions);
  assert.equal(shared.work.searches, 0, 'distance fields the first pipeline found are not searched again');
  assert.deepEqual(shared.findings, ran.findings);
  const alone = createPipeline();
  assert.notEqual(alone.cache, first.cache, 'with no argument a pipeline has a cache of its own');
  assert.equal(alone.run(project, versions).work.searches, ran.work.searches, 'and searches as the first one did');
  const fields = first.cache.fields.size;
  beside.clear();
  assert.equal(first.cache.fields.size, fields, 'clearing the pipeline that borrowed the cache leaves the cache to its owner');
  first.clear();
  assert.equal(first.cache.fields.size, 0, 'the owner clears it');
});

test('the message names sit beside REQUEST and ANSWER', () => {
  assert.deepEqual([REQUEST, ANSWER], ['sv2-derive', 'sv2-derived']);
  assert.deepEqual([SCENARIO_REQUEST, SCENARIO_ANSWER, SUGGEST_REQUEST, SUGGEST_ANSWER], ['sv2-derive-scenario', 'sv2-derived-scenario', 'sv2-suggest', 'sv2-suggested']);
});

// ------------------------------------------------- the worker's own handler

test('sv2-derive-scenario answers the trimmed result of the project with its scenario applied, never routes or crowd, and the project is not touched', async () => {
  const scope = await workerScope();
  const store = withScenario(storeOf(sampleSchool()));
  const before = structuredClone(store.project);
  const [reply] = scope.handle({ type: SCENARIO_REQUEST, generation: 3, project: store.project, versions: { ...versionsOf(store), schedule: 1 } });
  assert.deepEqual([reply.type, reply.generation, reply.ok], [SCENARIO_ANSWER, 3, true]);
  assert.deepEqual(Object.keys(reply.answer).sort(), ['failedWalks', 'findings', 'loads', 'places', 'walks']);
  assert.deepEqual(reply.answer, expectedScenario(store.project));
  assert.deepEqual(store.project, before, 'the real project is as it was');
  const ids = reply.answer.findings.findings.map((finding) => finding.id);
  assert.ok(!ids.includes(DOUBLE_ID), 'with 7C moved out, Room 203 is no longer double-booked in the scenario');

  const [bad] = scope.handle({ type: SCENARIO_REQUEST, generation: 4, project: { settings: null }, versions: null });
  assert.deepEqual([bad.type, bad.generation, bad.ok, typeof bad.error], [SCENARIO_ANSWER, 4, false, 'string']);
});

test('a change that no longer applies is left out of the scenario run: the answer is the run of what reconcile keeps', async () => {
  const scope = await workerScope();
  const store = withScenario(storeOf(sampleSchool()));
  store.apply(actions.deleteGroup, { id: 'gsample08a' });
  const kept = reconcile(store.project, store.project.scenario);
  assert.equal(kept.changes.length, 1, 'the swap for the deleted group is dropped');
  const [reply] = scope.handle({ type: SCENARIO_REQUEST, generation: 1, project: store.project, versions: versionsOf(store) });
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(reply.answer, trimResult(createPipeline().run(applyChanges(store.project, kept.changes))));
});

test('sv2-suggest answers suggest() for the finding, run on a pipeline of its own', async () => {
  const scope = await workerScope();
  const store = storeOf(sampleSchool());
  const finding = createPipeline().run(store.project).findings.findings.find((one) => one.id === DOUBLE_ID);
  assert.ok(finding, 'the sample school has its double-booking');
  const [reply] = scope.handle({ type: SUGGEST_REQUEST, generation: 2, project: store.project, versions: versionsOf(store), finding, options: { otherTeachersRooms: false } });
  assert.deepEqual([reply.type, reply.generation, reply.ok], [SUGGEST_ANSWER, 2, true]);
  const direct = suggest(store.project, finding, { pipeline: createPipeline(), versions: versionsOf(store) });
  assert.ok(direct.suggestions.length > 0, 'there is something to suggest');
  assert.deepEqual(reply.answer, structuredClone(direct));
});

test('the main lane is untouched by the other two: between two main requests a scenario and a suggestion change nothing it sends or keeps', async () => {
  const scope = await workerScope();
  const store = withScenario(storeOf(sampleSchool()));
  const versions = versionsOf(store);
  const [first] = scope.handle({ type: REQUEST, generation: 1, project: store.project, versions });
  const finding = createPipeline().run(store.project).findings.findings.find((one) => one.id === DOUBLE_ID);
  scope.handle({ type: SCENARIO_REQUEST, generation: 1, project: store.project, versions: { ...versions, schedule: 1 } });
  scope.handle({ type: SUGGEST_REQUEST, generation: 1, project: store.project, versions, finding, options: {} });
  const [second] = scope.handle({ type: REQUEST, generation: 2, project: store.project, versions });
  // the same counters again: the main pipeline hands back the result it had,
  // so the answer keeps every part
  assert.deepEqual(second.answer.kept.sort(), ['buildingFindings', 'crowd', 'findings', 'places', 'routes', 'walks']);
  assert.ok(second.answer.loads.every((load) => load.kept === true), 'and every day type\'s loads');
  assert.equal(second.answer.work.run, first.answer.work.run, 'no second run of the main pipeline');

  // the same in-process: a main pipeline beside two borrowers gives its own result back by ===
  const main = createPipeline();
  const result = main.run(store.project, versions);
  scenarioRun(createPipeline({ cache: main.cache }), store.project, { ...versions, schedule: 1 });
  suggestRun(createPipeline({ cache: main.cache }), store.project, versions, finding, {});
  assert.equal(main.run(store.project, versions), result);
  const packed = pack(main.run(store.project, versions), result);
  assert.equal(packed.kept.length, 6);
});

// -------------------------------------------------------------- the client

test('on the main thread the first scenario asking searches nothing: its pipeline borrows the main lane\'s route cache', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  assert.equal(client.searches, null, 'nothing has been made on this side yet');
  await store.derived.results();
  const searched = client.searches;
  assert.ok(searched > 0, 'the main lane searched');
  const answer = await store.derived.scenario();
  assert.equal(answer.result.findings.findings.some((finding) => finding.id === DOUBLE_ID), false);
  assert.equal(client.searches - searched, 0, 'the scenario run searched nothing');
  client.close();
});

test('store.derived.scenario() and suggest() refuse until an engine is attached; scenario() is null with no scenario open', async () => {
  const store = storeOf(sampleSchool());
  engineFor(store, { worker: false }).close();
  await assert.rejects(store.derived.scenario(), /engineFor\(store\)/);
  await assert.rejects(store.derived.suggest(DOUBLE_ID), /engineFor\(store\)/);
  const other = storeOf(sampleSchool());
  const client = engineFor(other, { worker: false });
  assert.equal(await other.derived.scenario(), null);
  assert.equal(client.laneStats.scenario.sent, 0, 'nothing is worked out for no scenario');
  client.close();
});

test('the main thread and the worker give the same answers: the sample school with a scenario of two changes', async () => {
  const here = withScenario(storeOf(sampleSchool()));
  const there = withScenario(storeOf(sampleSchool()));
  assert.deepEqual(here.project, there.project);
  const local = engineFor(here, { worker: false });
  const worker = await standInWorker();
  const remote = engineFor(there, { worker: () => worker });

  const a = await here.derived.scenario();
  const b = await answered(worker, there.derived.scenario());
  assert.equal(a.where, 'main');
  assert.equal(b.where, 'worker');
  assert.deepEqual(a.result, expectedScenario(here.project), 'the main thread\'s result is the engines\' own');
  assert.deepEqual(b.result, a.result, 'the worker\'s result is the same');
  assert.deepEqual(b.compare, a.compare, 'and so is the comparison');
  assert.deepEqual(a.changes, here.project.scenario.changes);

  // the comparison is compareResults of the main lane's result, trimmed, against the scenario's
  const main = trimResult(createPipeline().run(here.project));
  assert.deepEqual(a.compare, compareResults(main, a.result, { changes: here.project.scenario.changes }));
  assert.equal(a.compare.findings.resolved.some((finding) => finding.id === DOUBLE_ID), true, 'the double-booking is resolved');
  assert.deepEqual(a.compare.groups.filter((row) => row.edited).map((row) => row.groupId).sort(), ['gsample07c', 'gsample08a']);

  // compareResults' options are passed through
  const oneDay = await here.derived.scenario({ dayTypeId: DAY_A, transition: 5 });
  assert.deepEqual(oneDay.compare, compareResults(main, a.result, { dayTypeId: DAY_A, transition: 5, changes: here.project.scenario.changes }));
  assert.equal(oneDay.result, a.result, 'one run, compared two ways');

  const s1 = await here.derived.suggest(DOUBLE_ID);
  const s2 = await answered(worker, there.derived.suggest(DOUBLE_ID));
  assert.ok(s1.suggestions.length > 0);
  assert.deepEqual(s2.suggestions, s1.suggestions, 'the same suggestions either way');
  assert.deepEqual([s1.none, s2.none, s1.findingId, s1.where, s2.where], [null, null, DOUBLE_ID, 'main', 'worker']);
  const finding = createPipeline().run(here.project).findings.findings.find((one) => one.id === DOUBLE_ID);
  assert.deepEqual(s1.suggestions, suggest(here.project, finding, { pipeline: createPipeline(), versions: versionsOf(here) }).suggestions);
  const wide = await here.derived.suggest(DOUBLE_ID, { otherTeachersRooms: true, limit: 2 });
  assert.ok(wide.suggestions.length <= 2, 'the options reach suggest');
  local.close();
  remote.close();
});

test('the scenario run is keyed by the three counters and the identity of project.scenario', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const first = store.derived.scenario();
  assert.equal(store.derived.scenario(), first, 'asked twice with nothing changed: one promise');
  assert.equal(worker.posted.filter((type) => type === SCENARIO_REQUEST).length, 1);
  const one = await answered(worker, first);
  assert.equal(await store.derived.scenario(), one, 'answered, still remembered');
  assert.equal(client.laneStats.scenario.sent, 1);

  // a scenario action moves no counter, but the scenario is another object
  const counters = versionsOf(store);
  store.apply(actions.renameScenario, { name: 'Ease the walk, again' });
  assert.deepEqual(versionsOf(store), counters, 'renaming the scenario moved no counter');
  const renamed = await answered(worker, store.derived.scenario());
  assert.notEqual(renamed, one);
  assert.equal(client.laneStats.scenario.sent, 2, 'a new scenario object is asked about again');
  assert.deepEqual(renamed.result, one.result);

  // a counter: the building
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  await answered(worker, store.derived.scenario());
  assert.equal(client.laneStats.scenario.sent, 3, 'a building change is asked about again');

  // an undo brings an older scenario object back: it is asked about again, and answered alike
  store.undo();
  store.undo();
  const back = await answered(worker, store.derived.scenario());
  assert.deepEqual(back.compare, one.compare);
  client.close();
});

test('a stale answer is dropped: whoever asked before a change gets the answer for the scenario as it is now', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const old = store.derived.scenario();
  await new Promise((resolve) => setImmediate(resolve));
  store.apply(actions.removeScenarioChange, { index: 1 });
  const now = store.derived.scenario();
  await worker.workAll();
  const [a, b] = await Promise.all([old, now]);
  assert.deepEqual(a, b, 'the older asking gets the newer answer');
  assert.deepEqual(a.changes, store.project.scenario.changes, 'which is for one change');
  assert.deepEqual(a.result, expectedScenario(store.project));
  assert.equal(client.laneStats.scenario.dropped, 1, 'the answer for two changes was dropped');

  // the store moves after the scenario was answered but before it was
  // compared, and another screen asks the main lane about the store as it
  // is now: the comparison is never made against the newer main result,
  // and the scenario is worked out again for the counters as they are
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  const late = store.derived.scenario({ limit: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(worker.inbox.map((message) => message.type), [SCENARIO_REQUEST]);
  worker.work(); // the scenario answer comes; its comparison asks the main lane
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(worker.inbox.map((message) => message.type), [REQUEST]);
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground floor' });
  const elsewhere = store.derived.results();
  await worker.workAll();
  const fresh = await late;
  assert.deepEqual(fresh.versions, versionsOf(store), 'the answer is for the counters as they are now, never the older ones');
  assert.deepEqual(fresh.compare, compareResults(trimResult(await elsewhere), fresh.result, { limit: 3, changes: store.project.scenario.changes }));
  assert.equal(client.laneStats.scenario.dropped, 2, 'the run for the older counters was not compared');
  client.close();
});

test('no failure is remembered: a scenario or suggestion the worker refused is asked again, with nothing changed', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  worker.refuse = 1;
  const refused = store.derived.scenario();
  const said = assert.rejects(refused, /could not be worked out/);
  await worker.workAll();
  await said;
  assert.equal(client.laneStats.scenario.failed, 1);
  const again = store.derived.scenario();
  assert.notEqual(again, refused, 'a new promise');
  const result = await answered(worker, again);
  assert.deepEqual(result.result, expectedScenario(store.project));
  assert.equal(client.laneStats.scenario.sent, 2);

  worker.refuse = 1;
  const no = store.derived.suggest(DOUBLE_ID);
  const refusedToo = assert.rejects(no, /could not be worked out/);
  await worker.workAll();
  await refusedToo;
  const yes = await answered(worker, store.derived.suggest(DOUBLE_ID));
  assert.ok(yes.suggestions.length > 0);
  assert.deepEqual([client.laneStats.suggest.sent, client.laneStats.suggest.failed], [2, 1]);
  client.close();
});

test('suggestions: remembered for one finding, none for a finding that is not there, and an older finding nobody shows resolves null', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const a = store.derived.suggest(DOUBLE_ID);
  assert.equal(store.derived.suggest(DOUBLE_ID), a, 'asked twice: one promise');
  assert.notEqual(store.derived.suggest(DOUBLE_ID, { otherTeachersRooms: true }), a, 'other options are another asking');
  const answer = await answered(worker, store.derived.suggest(DOUBLE_ID));
  assert.ok(answer.suggestions.length > 0);
  assert.equal(await a, null, 'the first asking was overtaken by one with other options before it was answered, and nobody shows it');

  const gone = await answered(worker, store.derived.suggest('room-double:nothing:0:here'));
  assert.deepEqual([gone.suggestions, gone.none], [[], NO_SUGGESTION]);
  assert.equal(worker.posted.filter((type) => type === SUGGEST_REQUEST).length, 1, 'a finding that is not there costs no request');

  const walk = 'group-walk:' + DAY_A + ':5:gsample08a';
  const first = store.derived.suggest(DOUBLE_ID);
  const second = store.derived.suggest(walk);
  await worker.workAll();
  assert.equal(await first, null);
  const walkAnswer = await second;
  assert.equal(walkAnswer.findingId, walk);
  client.close();
});

test('closing the client refuses what the lanes still owe', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const pending = store.derived.scenario();
  await new Promise((resolve) => setImmediate(resolve));
  client.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(client.scenario(), /closed/);
  await assert.rejects(client.suggest(DOUBLE_ID), /closed/);
});

test('a worker given up on hands the lanes to the main thread, and they are answered there', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const pending = store.derived.scenario();
  const suggested = store.derived.suggest(DOUBLE_ID);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(worker.posted.includes(SCENARIO_REQUEST), 'the scenario went to the worker');
  worker.emit('error', { message: 'could not be loaded' });
  assert.equal(client.where, 'main');
  const [scenario, suggestion] = await Promise.all([pending, suggested]);
  assert.equal(scenario.where, 'main');
  assert.deepEqual(scenario.result, expectedScenario(store.project));
  assert.equal(suggestion.where, 'main');
  assert.ok(suggestion.suggestions.length > 0);
  client.close();
});

// ------------------------------------------- the store moving under a lane

test('a scenario changed or closed while its answer waits on the main lane is never compared as it was: the newest is, or null', async () => {
  for (const closing of [false, true]) {
    const store = withScenario(storeOf(sampleSchool()));
    const worker = await standInWorker();
    const client = engineFor(store, { worker: () => worker });
    const asked = store.derived.scenario();
    await tick();
    assert.deepEqual(worker.inbox.map((message) => message.type), [SCENARIO_REQUEST]);
    worker.work(); // the scenario is answered; its comparison asks the main lane
    await tick();
    assert.deepEqual(worker.inbox.map((message) => message.type), [REQUEST], 'the comparison waits on the main lane');
    // a scenario action moves no counter: only the scenario's identity says it changed
    const counters = versionsOf(store);
    if (closing) store.apply(actions.discardScenario, {});
    else store.apply(actions.removeScenarioChange, { index: 1 });
    assert.deepEqual(versionsOf(store), counters);
    await worker.workAll();
    const got = await asked;
    if (closing) {
      assert.equal(got, null, 'the scenario was closed: null, never the comparison of the scenario as it was');
    } else {
      assert.deepEqual(got.changes.length, 1, 'the answer is for the one change left, not the two there were');
      assert.deepEqual(got.result, expectedScenario(store.project));
    }
    assert.equal(client.laneStats.scenario.dropped, 1, (closing ? 'closing' : 'removing a change') + ': the answer for the scenario as it was is dropped');
    client.close();
  }
});

test('closing the scenario drops the job it wanted: whoever waited gets null, and nothing more is worked out', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const first = store.derived.scenario(); // sent
  await tick();
  store.apply(actions.removeScenarioChange, { index: 1 });
  const second = store.derived.scenario(); // waits behind the first
  store.apply(actions.discardScenario, {});
  assert.equal(await store.derived.scenario(), null);
  // at once, before the worker answers anything
  const early = await Promise.race([Promise.all([first, second]), tick().then(() => 'still waiting')]);
  assert.deepEqual(early, [null, null], 'both earlier askings resolve null as soon as no scenario is found open, not when the worker answers');
  await worker.workAll();
  assert.equal(worker.posted.filter((type) => type === SCENARIO_REQUEST).length, 1, 'the job that waited was never sent');

  // on the main thread the job waits a turn before it runs; closed in that turn, it never runs
  const here = withScenario(storeOf(sampleSchool()));
  const local = engineFor(here, { worker: false });
  const pending = here.derived.scenario();
  here.apply(actions.discardScenario, {});
  assert.equal(await here.derived.scenario(), null);
  assert.equal(await pending, null);
  assert.equal(local.laneStats.scenario.answered, 0, 'the closed scenario was never worked out');
  client.close();
  local.close();
});

test('a lane job whose counters the store has moved past is never sent: it is asked again with the counters as they are, so the shared route cache keeps the newest geometry', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  await answered(worker, store.derived.results());
  const first = store.derived.scenario(); // sent
  await tick();
  store.apply(actions.removeScenarioChange, { index: 1 });
  const queued = store.derived.scenario(); // waits behind the first, at these counters
  store.apply(actions.paintCorridor, { floorId: 'fsample003', cells: [0] });
  const moved = store.derived.results(); // the main lane at the new geometry
  await tick();
  worker.work(); // the first scenario answer: the queued job's turn
  assert.deepEqual(worker.inbox.map((message) => message.type), [REQUEST, SCENARIO_REQUEST]);
  worker.work();
  worker.work();
  // a schedule-only edit on the main lane: the geometry the route cache holds is its own
  store.apply(actions.setSlot, { groupId: 'gsample07c', dayTypeId: DAY_A, period: PERIOD, slot: { label: 'Moved here' } });
  const edited = store.derived.results();
  worker.work();
  const after = await edited;
  assert.equal(after.work.searches, 0, 'no route is searched again after a schedule-only edit: a stale scenario job reset the shared cache to an older geometry');
  const scenarios = worker.sent.filter((message) => message.type === SCENARIO_REQUEST);
  assert.equal(scenarios[1].versions.geometry, (await moved).versions.geometry, 'the second scenario request is for the geometry as it is now');
  await worker.workAll();
  const [a, b] = await Promise.all([first, queued]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.versions, versionsOf(store));
  assert.ok(client.laneStats.scenario.dropped >= 2, 'the first answer and the stale job were dropped');

  // the suggestion lane: a job made ready at older counters, waiting behind another
  const walk = 'group-walk:' + DAY_A + ':5:gsample08a';
  const one = store.derived.suggest(DOUBLE_ID);
  await tick(); // ready, and sent
  const two = store.derived.suggest(walk);
  await tick(); // ready, and waiting
  const before = worker.sent.length;
  store.apply(actions.paintCorridor, { floorId: 'fsample003', cells: [1] });
  await worker.workAll();
  assert.equal(await one, null);
  const answer = await two;
  assert.deepEqual(answer.versions, versionsOf(store), 'the suggestion is for the counters as they are now');
  const stale = worker.sent.slice(before).filter((message) => message.type === SUGGEST_REQUEST && message.versions.geometry !== store.geometryVersion);
  assert.deepEqual(stale, [], 'no suggestion was sent at the older geometry');
  client.close();
});

test('no failure is remembered on the main thread either: a scenario or suggestion that could not be worked out here is worked out again, with nothing changed', async () => {
  const real = withScenario(storeOf(sampleSchool()));
  // a stand-in store whose project cannot be read until `unreadable` is
  // turned off; the counters and the scenario object stay the same throughout
  let unreadable = true;
  const broken = { ...real.project, settings: null };
  const stand = {
    get project() {
      return unreadable ? broken : real.project;
    },
    get geometryVersion() {
      return real.geometryVersion;
    },
    get buildingVersion() {
      return real.buildingVersion;
    },
    get scheduleVersion() {
      return real.scheduleVersion;
    },
    derived: { engine: null, use() {} },
  };
  const client = createEngineClient(stand, { worker: false });
  assert.equal(client.where, 'main');
  const refused = client.scenario();
  await assert.rejects(refused);
  assert.deepEqual([client.laneStats.scenario.sent, client.laneStats.scenario.failed], [1, 1]);
  const noSuggestion = client.suggest(DOUBLE_ID);
  await assert.rejects(noSuggestion);
  assert.equal(client.laneStats.suggest.failed, 1);

  unreadable = false;
  const again = client.scenario();
  assert.notEqual(again, refused, 'a new promise');
  assert.equal(client.laneStats.scenario.sent, 2, 'the same counters and scenario are run again: the failure was not remembered');
  assert.deepEqual((await again).result, expectedScenario(real.project));
  const yes = client.suggest(DOUBLE_ID);
  assert.notEqual(yes, noSuggestion);
  assert.ok((await yes).suggestions.length > 0, 'the suggestion is worked out again');
  client.close();
});

test('compareResults options key the comparison: two Sets of floors are two comparisons, each of its own floors', async () => {
  const store = withScenario(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  const ground = await store.derived.scenario({ floorIds: new Set(['fsample001']) });
  const upper = await store.derived.scenario({ floorIds: new Set(['fsample002']) });
  const main = trimResult(createPipeline().run(store.project));
  const changes = store.project.scenario.changes;
  assert.deepEqual(upper.compare, compareResults(main, upper.result, { floorIds: ['fsample002'], changes }), 'the second Set is not answered with the first one\'s comparison');
  assert.deepEqual(ground.compare, compareResults(main, ground.result, { floorIds: ['fsample001'], changes }));
  assert.notDeepEqual(ground.compare.places, upper.compare.places);
  const same = store.derived.scenario({ floorIds: new Set(['fsample002']) });
  assert.equal(same, store.derived.scenario({ floorIds: new Set(['fsample002']) }), 'the same floors in another Set: one comparison');
  client.close();
});
