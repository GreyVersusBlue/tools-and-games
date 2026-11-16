// The kept-scenario lane and the other-building lane (engine/worker.js and
// ui/engine-client.js), in plain Node:
//   node test/engine/kept-lane.test.mjs
//
// ARCHITECTURE 21.2, 21.3 and 21.10. A kept scenario is worked out on a
// pipeline of its own that shares the main lane's route cache
// (store.derived.kept(id)); another building's project is worked out on a
// pipeline whose route cache is its own, under counters that are the
// comparison's number (store.derived.setOther / other / closeOther). Each lane
// has its own wanted request, its own counters and its own staleness check,
// remembers no failure, and gives the same answers on the main thread as in
// the worker. The worker's own message handler runs here, with a stand-in for
// the worker scope, the way test/ui/scenario-lane.test.mjs runs it. How long
// the lanes take at the promised size is test/timing/kept-lane.mjs; the real
// worker in a browser is test/browser/lanes-kept.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { effectiveSchedule } from '../../engine/day-types.js';
import { applyChanges, applyLevers, leverRouteOptions, leverOptionsKey, reconcile, trimResult, keptScenarios, SCENARIOS_MOST } from '../../engine/scenario.js';
import {
  createPipeline, keptRun, otherRun, scenarioRun, pack,
  REQUEST, ANSWER, SCENARIO_REQUEST, SCENARIO_ANSWER, SUGGEST_REQUEST, SUGGEST_ANSWER,
  KEPT_REQUEST, KEPT_ANSWER, KEPT_CLOSE, OTHER_REQUEST, OTHER_ANSWER, OTHER_CLOSE,
} from '../../engine/worker.js';
import { createEngineClient, engineFor } from '../../ui/engine-client.js';
import { sampleSchool, SAMPLE_PROBLEMS } from '../../data/sample-school.js';

const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'worker.js');
const clock = () => new Date('2026-09-01T12:00:00Z');
const DAY_A = SAMPLE_PROBLEMS.roomDouble.dayTypeId;
const PERIOD = SAMPLE_PROBLEMS.roomDouble.period;
const STAIRS_A = 'csample00a';

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

function versionsOf(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

function freeRoom(project, dayTypeId, period) {
  const used = new Set(project.groups.map((group) => effectiveSchedule(project, group.id, dayTypeId)[period].room));
  return allRooms(project).find((room) => !used.has(room.id));
}

// The sample school with three scenarios: "Ease the walk" and "Closed stairs"
// kept (the second with stairs A closed, a building lever) and "Trial" open.
function withScenarios(store) {
  const room = freeRoom(store.project, DAY_A, PERIOD);
  store.apply(actions.newScenario, { name: 'Ease the walk' });
  store.apply(actions.addScenarioChange, { change: { kind: 'move', dayTypeId: DAY_A, groupId: 'gsample07c', period: PERIOD, roomId: room.id } });
  store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: DAY_A, groupId: 'gsample08a', periodA: 5, periodB: 6 } });
  store.apply(actions.newScenario, { name: 'Closed stairs', keep: true });
  store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: DAY_A, groupId: 'gsample06a', periodA: 1, periodB: 2 } });
  store.apply(actions.addScenarioLever, { lever: { kind: 'way', connectionId: STAIRS_A, way: 'closed' } });
  store.apply(actions.newScenario, { name: 'Trial', keep: true });
  store.apply(actions.addScenarioChange, { change: { kind: 'swapPeriods', dayTypeId: DAY_A, groupId: 'gsample07a', periodA: 2, periodB: 3 } });
  assert.equal(keptScenarios(store.project).length, 2);
  return store;
}

const keptNamed = (project, name) => keptScenarios(project).find((scenario) => scenario.name === name);

// What the lane must answer for a kept scenario, worked out straight from the
// engines on a pipeline of its own.
function expectedKept(project, scenario) {
  const kept = reconcile(project, scenario);
  const levers = kept.levers || [];
  return trimResult(createPipeline().run(applyLevers(applyChanges(project, kept.changes), levers), undefined, leverRouteOptions(project, levers)));
}

// A different building: the sample school with stairs B taken out.
function otherBuilding() {
  const store = storeOf(sampleSchool());
  store.apply(actions.disconnectStairs, { connectionId: 'csample00b' });
  return store.project;
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
    await import(pathToFileURL(WORKER_FILE).href + '?kept=' + scopes);
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

const ANSWER_OF = { [SCENARIO_REQUEST]: SCENARIO_ANSWER, [SUGGEST_REQUEST]: SUGGEST_ANSWER, [KEPT_REQUEST]: KEPT_ANSWER, [OTHER_REQUEST]: OTHER_ANSWER };

// The real worker's handler as the client's worker. Messages wait in `inbox`
// until work() (oldest first) or workAll(); `refuse` makes the next that many
// kept or other requests fail; `sent` says what each message was.
async function standInWorker() {
  const scope = await workerScope();
  const listeners = { message: [], error: [], messageerror: [] };
  return {
    inbox: [],
    sent: [], // { type, versions, comparison, hasProject, scenario } of each message
    refuse: 0,
    postMessage(message) {
      this.sent.push({ type: message.type, versions: message.versions ? { ...message.versions } : null, comparison: message.comparison, hasProject: message.project !== undefined });
      this.inbox.push(structuredClone(message));
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    terminate() {},
    // the worker lets the other project go without the page knowing
    forget() {
      scope.handle({ type: OTHER_CLOSE });
    },
    emit(type, event) {
      for (const listener of listeners[type]) listener(event);
    },
    count(type) {
      return this.sent.filter((one) => one.type === type).length;
    },
    work() {
      const message = this.inbox.shift();
      assert.ok(message, 'the worker was sent something to answer');
      let answers;
      if (this.refuse > 0 && (message.type === KEPT_REQUEST || message.type === OTHER_REQUEST)) {
        this.refuse -= 1;
        // the worker received it, held what it carries, and failed to work it out
        scope.handle(message);
        answers = [{ type: ANSWER_OF[message.type], generation: message.generation, ok: false, error: 'It could not be worked out.' }];
      } else {
        answers = scope.handle(message);
      }
      for (const answer of answers) for (const listener of listeners.message) listener({ data: answer });
    },
    async workAll() {
      for (let rounds = 0; rounds < 50; rounds += 1) {
        await new Promise((resolve) => setImmediate(resolve));
        if (this.inbox.length === 0) return;
        while (this.inbox.length > 0) this.work();
      }
      throw new Error('the worker was kept busy for 50 rounds');
    },
  };
}

async function answered(worker, promise) {
  await worker.workAll();
  return promise;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------- names

test('the message names of the kept lane and the other-building lane', () => {
  assert.deepEqual([KEPT_REQUEST, KEPT_ANSWER], ['sv2-derive-kept', 'sv2-derived-kept']);
  assert.deepEqual([OTHER_REQUEST, OTHER_ANSWER, OTHER_CLOSE], ['sv2-derive-other', 'sv2-derived-other', 'sv2-other-close']);
  assert.equal(KEPT_CLOSE, 'sv2-kept-close');
  assert.deepEqual([REQUEST, ANSWER], ['sv2-derive', 'sv2-derived']);
});

// ---------------------------------------------------------------- keptRun

test('keptRun is the trimmed run of the project as the kept scenario makes it, its building levers as route options; the project and the scenario are not touched', () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const before = structuredClone(store.project);
  const ease = keptNamed(store.project, 'Ease the walk');
  const closed = keptNamed(store.project, 'Closed stairs');
  const versions = { geometry: 1, building: 1, schedule: 1, levers: 0 };

  const easeAnswer = keptRun(createPipeline(), store.project, ease, versions);
  assert.deepEqual(easeAnswer, expectedKept(store.project, ease));
  assert.deepEqual(Object.keys(easeAnswer).sort(), ['bellLoads', 'failedWalks', 'findings', 'loads', 'places', 'walks']);
  assert.equal(easeAnswer.findings.findings.some((finding) => finding.id.startsWith('room-double:' + DAY_A + ':' + PERIOD)), false, 'with 7C moved out, Room 203 is no longer double-booked');

  const closedAnswer = keptRun(createPipeline(), store.project, closed, { ...versions, levers: 1 });
  assert.deepEqual(closedAnswer, expectedKept(store.project, closed));
  const options = leverRouteOptions(store.project, reconcile(store.project, closed).levers);
  assert.notEqual(leverOptionsKey(options), '', 'stairs A closed is a route option');
  const withoutLever = keptRun(createPipeline(), store.project, { ...closed, levers: [] }, versions);
  assert.notDeepEqual(closedAnswer, withoutLever, 'the closed stairs changed what the lane says');

  assert.deepEqual(store.project, before, 'the real project is as it was');
  assert.notDeepEqual(easeAnswer, scenarioRun(createPipeline(), store.project, versions), 'the open scenario is not what a kept one is run with');
});

test('a kept scenario and the open one are run alike: scenarioRun of a project whose open scenario is K is keptRun of K', () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const versions = { geometry: 1, building: 1, schedule: 1, levers: 0 };
  for (const name of ['Ease the walk', 'Closed stairs']) {
    const kept = keptNamed(store.project, name);
    const opened = { ...store.project, scenario: kept };
    assert.deepEqual(scenarioRun(createPipeline(), opened, versions), keptRun(createPipeline(), store.project, kept, versions), name);
  }
});

test('a change that no longer applies is left out of a kept scenario\'s run, as reconcile says', () => {
  const store = withScenarios(storeOf(sampleSchool()));
  store.apply(actions.deleteGroup, { id: 'gsample08a' });
  const ease = keptNamed(store.project, 'Ease the walk');
  assert.equal(reconcile(store.project, ease).changes.length, 1, 'the swap for the deleted group is dropped');
  assert.deepEqual(keptRun(createPipeline(), store.project, ease, { geometry: 1, building: 1, schedule: 1, levers: 0 }), expectedKept(store.project, ease));
});

// ---------------------------------------------------------------- the worker's handler

test('sv2-derive-kept answers keptRun; a project the lane cannot read is a failure with a message', async () => {
  const scope = await workerScope();
  const store = withScenarios(storeOf(sampleSchool()));
  const ease = keptNamed(store.project, 'Ease the walk');
  const [reply] = scope.handle({ type: KEPT_REQUEST, generation: 7, project: store.project, scenario: ease, versions: { ...versionsOf(store), schedule: 1, levers: 0 } });
  assert.deepEqual([reply.type, reply.generation, reply.ok], [KEPT_ANSWER, 7, true]);
  assert.deepEqual(reply.answer, expectedKept(store.project, ease));
  const [bad] = scope.handle({ type: KEPT_REQUEST, generation: 8, project: { settings: null }, scenario: ease, versions: null });
  assert.deepEqual([bad.type, bad.generation, bad.ok, typeof bad.error], [KEPT_ANSWER, 8, false, 'string']);
  const [again] = scope.handle({ type: KEPT_REQUEST, generation: 9, project: store.project, scenario: ease, versions: { ...versionsOf(store), schedule: 2, levers: 0 } });
  assert.equal(again.ok, true, 'the lane works again after a failure');
  assert.deepEqual(again.answer, reply.answer);
});

test('sv2-derive-other answers otherRun of the project as it is, never its own scenarios; the project goes once and sv2-other-close lets it go', async () => {
  const scope = await workerScope();
  const other = withScenarios(storeOf(otherBuilding())).project;
  assert.ok(other.scenario && keptScenarios(other).length === 2, 'the other project has scenarios of its own');
  const fresh = trimResult(createPipeline().run(other));
  const [first] = scope.handle({ type: OTHER_REQUEST, generation: 1, comparison: 1, project: other, versions: { geometry: 1, building: 1, schedule: 1 } });
  assert.deepEqual([first.type, first.generation, first.ok], [OTHER_ANSWER, 1, true]);
  assert.deepEqual(first.answer, fresh);
  assert.notDeepEqual(first.answer, scenarioRun(createPipeline(), other, { geometry: 1, building: 1, schedule: 1 }), 'its open scenario was not applied');

  const [again] = scope.handle({ type: OTHER_REQUEST, generation: 2, comparison: 1, versions: { geometry: 1, building: 1, schedule: 1 } });
  assert.equal(again.ok, true, 'the worker kept the project it was sent');
  assert.deepEqual(again.answer, fresh);
  const [elsewhere] = scope.handle({ type: OTHER_REQUEST, generation: 3, comparison: 2, versions: { geometry: 2, building: 2, schedule: 2 } });
  assert.deepEqual([elsewhere.ok, typeof elsewhere.error], [false, 'string'], 'another comparison with no project is refused');

  assert.deepEqual(scope.handle({ type: OTHER_CLOSE }), [], 'closing answers nothing');
  const [closed] = scope.handle({ type: OTHER_REQUEST, generation: 4, comparison: 1, versions: { geometry: 1, building: 1, schedule: 1 } });
  assert.equal(closed.ok, false, 'after the close the project is gone from the worker');
  const [fresher] = scope.handle({ type: OTHER_REQUEST, generation: 5, comparison: 3, project: other, versions: { geometry: 3, building: 3, schedule: 3 } });
  assert.equal(fresher.ok, true, 'and a new comparison sends it again');
});

test('the other building\'s route cache is its own: the same counters for another building never serve the main lane\'s routes', async () => {
  const scope = await workerScope();
  const sample = sampleSchool();
  const other = otherBuilding();
  const versions = { geometry: 1, building: 1, schedule: 1 };
  scope.handle({ type: REQUEST, generation: 1, project: sample, versions });
  const [reply] = scope.handle({ type: OTHER_REQUEST, generation: 1, comparison: 1, project: other, versions });
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.answer, trimResult(createPipeline().run(other)), 'the other building\'s answer is its own, whatever the main lane had worked out under the same numbers');
  assert.notDeepEqual(reply.answer, trimResult(createPipeline().run(sample)), 'and it is not the sample school\'s');
  const [kept] = scope.handle({ type: REQUEST, generation: 2, project: sample, versions });
  assert.deepEqual(kept.answer.kept.sort(), ['buildingFindings', 'crowd', 'findings', 'places', 'routes', 'walks'], 'the main lane kept everything it had');
});

test('the main lane is untouched by the new lanes: its pipeline hands its own result back by ===, and keeps what it sent', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const versions = versionsOf(store);
  const main = createPipeline();
  const result = main.run(store.project, versions);
  keptRun(createPipeline({ cache: main.cache }), store.project, keptNamed(store.project, 'Ease the walk'), { ...versions, schedule: 1, levers: 0 });
  otherRun(createPipeline(), otherBuilding(), { geometry: 1, building: 1, schedule: 1 });
  assert.equal(main.run(store.project, versions), result);
  assert.equal(pack(main.run(store.project, versions), result).kept.length, 6);

  const client = engineFor(store, { worker: false });
  const first = await store.derived.results();
  await store.derived.kept(keptNamed(store.project, 'Closed stairs').id);
  store.derived.setOther(otherBuilding(), 'next-year.json');
  await store.derived.other();
  const second = await store.derived.results();
  assert.equal(second, first, 'the very result object, by ===');
  assert.equal(client.stats.sent, 1, 'the main lane ran once');
  client.close();
});

// ---------------------------------------------------------------- the kept lane in the client

test('store.derived.kept(id) on the main thread and in the worker give the same answer, the engines\' own', async () => {
  const here = withScenarios(storeOf(sampleSchool()));
  const there = withScenarios(storeOf(sampleSchool()));
  const local = engineFor(here, { worker: false });
  const worker = await standInWorker();
  const remote = engineFor(there, { worker: () => worker });
  for (const name of ['Ease the walk', 'Closed stairs']) {
    const a = await here.derived.kept(keptNamed(here.project, name).id);
    const b = await answered(worker, there.derived.kept(keptNamed(there.project, name).id));
    assert.equal(a.where, 'main');
    assert.equal(b.where, 'worker');
    assert.deepEqual(a.result, expectedKept(here.project, keptNamed(here.project, name)), name + ': the main thread\'s answer is the engines\' own');
    assert.deepEqual(b.result, a.result, name + ': the worker\'s is the same');
    assert.deepEqual(a.versions, versionsOf(here), 'the answer says which counters it is for');
  }
  assert.equal(local.laneStats.kept.answered, 2);
  assert.equal(remote.laneStats.kept.answered, 2);
  assert.equal(await here.derived.kept('enothere00'), null, 'no kept scenario has that id');
  assert.equal(await here.derived.kept(here.project.scenario.id || 'x'), null, 'the open scenario is not a kept one');
  assert.equal(local.laneStats.kept.sent, 2, 'nothing was worked out for those two');
  local.close();
  remote.close();
});

test('a kept answer is remembered by the counters and that scenario object: asked twice, one run; a renamed scenario is another object and is worked out again', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const id = keptNamed(store.project, 'Ease the walk').id;
  const first = store.derived.kept(id);
  const again = store.derived.kept(id);
  assert.equal(again, first, 'the same promise');
  await worker.workAll();
  await first;
  assert.equal(store.derived.kept(id), first);
  assert.deepEqual({ asked: client.laneStats.kept.asked, remembered: client.laneStats.kept.remembered, sent: client.laneStats.kept.sent }, { asked: 3, remembered: 2, sent: 1 });
  assert.equal(worker.count(KEPT_REQUEST), 1);

  store.apply(actions.renameScenario, { id, name: 'Ease the walk, renamed' });
  const renamed = await answered(worker, store.derived.kept(id));
  assert.equal(client.laneStats.kept.sent, 2, 'a new object is a new run');
  assert.deepEqual(renamed.result, (await first).result, 'whose answer is the same: only the name changed');

  // a change the lane cannot see (another scenario's name) leaves it remembered
  store.apply(actions.renameScenario, { id: keptNamed(store.project, 'Closed stairs').id, name: 'Closed stairs, renamed' });
  assert.equal(await store.derived.kept(id), renamed, 'an unrelated scenario action does not ask again');
  assert.equal(client.laneStats.kept.sent, 2);
  client.close();
});

test('a kept answer is dropped when its object leaves scenarios, asked and answered or not', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const id = keptNamed(store.project, 'Ease the walk').id;

  // answered, then the scenario is deleted: nothing is handed out
  const answer = await answered(worker, store.derived.kept(id));
  assert.ok(answer.result.findings, 'answered');
  store.apply(actions.deleteScenario, { id });
  assert.equal(await store.derived.kept(id), null, 'the remembered answer is not given for a scenario that is gone');
  assert.equal(worker.count(KEPT_REQUEST), 1, 'and none was asked for');

  // asked, and deleted while the worker is busy: the answer comes back and is dropped
  const other = keptNamed(store.project, 'Closed stairs').id;
  const pending = store.derived.kept(other);
  assert.equal(worker.inbox.length, 1, 'the request is with the worker');
  store.apply(actions.deleteScenario, { id: other });
  const dropped = client.laneStats.kept.dropped;
  const settled = await answered(worker, pending);
  assert.equal(settled, null, 'the answer for a deleted scenario goes to nobody');
  assert.equal(client.laneStats.kept.dropped, dropped + 1);
  assert.equal(client.laneStats.kept.failed, 0);

  // opening a kept scenario takes it out of the list too: the object that was
  // kept is no longer in scenarios (the open one is no kept answer)
  const store2 = withScenarios(storeOf(sampleSchool()));
  const client2 = engineFor(store2, { worker: false });
  const id2 = keptNamed(store2.project, 'Ease the walk').id;
  const asked = store2.derived.kept(id2);
  store2.apply(actions.openScenario, { id: id2 });
  assert.equal(await asked, null, 'now open, no longer kept');
  assert.equal(await store2.derived.kept(id2), null);
  client.close();
  client2.close();
});

test('a store that moves on while a kept scenario is worked out: the newest is asked for, both callers get it, the old answer is dropped', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const id = keptNamed(store.project, 'Ease the walk').id;
  const early = store.derived.kept(id);
  store.apply(actions.setSlot, { groupId: 'gsample06b', dayTypeId: 'dsample00b', period: 0, slot: { room: null } });
  const late = store.derived.kept(id);
  assert.notEqual(early, late);
  await worker.workAll();
  const [a, b] = await Promise.all([early, late]);
  assert.deepEqual(a, b, 'whoever waited on the older request gets the newest answer');
  assert.deepEqual(a.versions, versionsOf(store));
  assert.deepEqual(a.result, expectedKept(store.project, keptNamed(store.project, 'Ease the walk')));
  assert.ok(client.laneStats.kept.dropped >= 1, 'the older answer was dropped');
  client.close();
});

test('the kept lane\'s counters: a schedule counter of its own that only goes up, a levers counter the same for the same options', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const ease = keptNamed(store.project, 'Ease the walk').id;
  const closed = keptNamed(store.project, 'Closed stairs').id;
  await answered(worker, store.derived.kept(ease));
  await answered(worker, store.derived.kept(closed));
  // asked again with nothing changed, the first answer is the one given (see the alternating test); a schedule change makes a new run
  store.apply(actions.setSlot, { groupId: 'gsample06b', dayTypeId: 'dsample00b', period: 0, slot: { room: null } });
  await answered(worker, store.derived.kept(ease));
  const sent = worker.sent.filter((one) => one.type === KEPT_REQUEST);
  assert.equal(sent.length, 3);
  assert.deepEqual(sent.map((one) => one.versions.schedule), [1, 2, 3], 'one new schedule counter for each run, never repeated');
  assert.deepEqual(sent.map((one) => one.versions.levers), [0, 1, 0], 'the same route options (none) are the same counter');
  assert.ok(sent.every((one) => one.versions.geometry === store.geometryVersion && one.versions.building === store.buildingVersion), 'geometry and building are the store\'s: the route cache stamp is shared');
  const results = await Promise.all([store.derived.kept(ease), store.derived.kept(closed)].map((p) => answered(worker, p)));
  assert.notDeepEqual(results[0].result, results[1].result, 'each answer is its own scenario\'s');
  client.close();
});

test('the kept lane remembers no failure: the next asking is a new request, and a worker that refused once answers it', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const id = keptNamed(store.project, 'Ease the walk').id;
  worker.refuse = 1;
  const failed = store.derived.kept(id);
  failed.catch(() => {});
  await worker.workAll();
  await assert.rejects(failed, /could not be worked out/);
  assert.equal(client.laneStats.kept.failed, 1);
  const next = await answered(worker, store.derived.kept(id));
  assert.deepEqual(next.result, expectedKept(store.project, keptNamed(store.project, 'Ease the walk')));
  assert.equal(worker.count(KEPT_REQUEST), 2, 'a second request, not the failed one again');
  assert.equal(client.laneStats.kept.remembered, 0);
  client.close();
});

test('a worker given up on mid-run: the kept job is worked out on the main thread instead', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const id = keptNamed(store.project, 'Closed stairs').id;
  const pending = store.derived.kept(id);
  assert.equal(worker.inbox.length, 1);
  worker.emit('error', { message: 'it died' });
  const answer = await pending;
  assert.equal(answer.where, 'main');
  assert.equal(client.where, 'main');
  assert.deepEqual(answer.result, expectedKept(store.project, keptNamed(store.project, 'Closed stairs')));
  client.close();
});

// ---------------------------------------------------------------- the other-building lane in the client

test('store.derived.other(): null while none is held; setOther holds a project, and the answer is the same on the main thread and in the worker', async () => {
  const here = storeOf(sampleSchool());
  const there = storeOf(sampleSchool());
  const local = engineFor(here, { worker: false });
  const worker = await standInWorker();
  const remote = engineFor(there, { worker: () => worker });
  assert.equal(await here.derived.other(), null);
  assert.equal(local.laneStats.other.sent, 0);

  const project = withScenarios(storeOf(otherBuilding())).project;
  here.derived.setOther(project, 'next-year.json');
  there.derived.setOther(project, 'next-year.json');
  const a = await here.derived.other();
  const b = await answered(worker, there.derived.other());
  assert.deepEqual([a.where, b.where, a.fileName, b.fileName], ['main', 'worker', 'next-year.json', 'next-year.json']);
  assert.deepEqual(a.result, trimResult(createPipeline().run(project)), 'the main thread\'s answer is the engines\' own, its scenarios not applied');
  assert.deepEqual(b.result, a.result, 'the worker\'s is the same');
  assert.equal(here.derived.other(), here.derived.other(), 'remembered');
  assert.equal(local.laneStats.other.remembered, 2);
  local.close();
  remote.close();
});

test('the other project is sent to the worker once per comparison, under counters that are the comparison\'s number', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  await answered(worker, store.derived.results());
  const building = otherBuilding();
  assert.equal(store.derived.setOther(building, 'a.json'), 1, 'comparisons are numbered from 1');
  await answered(worker, store.derived.other());
  const first = worker.sent.filter((one) => one.type === OTHER_REQUEST);
  assert.deepEqual(first.map((one) => [one.comparison, one.hasProject, one.versions]), [[1, true, { geometry: 1, building: 1, schedule: 1 }]]);

  assert.equal(store.derived.other(), store.derived.other(), 'asked again, remembered');
  assert.equal(worker.count(OTHER_REQUEST), 1);

  // another comparison sends it again, closes the old one first, and counts 2
  assert.equal(store.derived.setOther(building, 'b.json'), 2);
  const second = await answered(worker, store.derived.other());
  assert.equal(second.fileName, 'b.json');
  const order = worker.sent.map((one) => one.type).filter((type) => type === OTHER_REQUEST || type === OTHER_CLOSE);
  assert.deepEqual(order, [OTHER_REQUEST, OTHER_CLOSE, OTHER_REQUEST]);
  const last = worker.sent.filter((one) => one.type === OTHER_REQUEST).pop();
  assert.deepEqual([last.comparison, last.hasProject, last.versions], [2, true, { geometry: 2, building: 2, schedule: 2 }]);
  client.close();
});

test('a failed other run is not remembered, and the worker still holds the project: the retry sends none', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  store.derived.setOther(otherBuilding(), 'a.json');
  worker.refuse = 1;
  const failed = store.derived.other();
  failed.catch(() => {});
  await worker.workAll();
  await assert.rejects(failed, /could not be worked out/);
  assert.equal(client.laneStats.other.failed, 1);
  const next = await answered(worker, store.derived.other());
  assert.deepEqual(next.result, trimResult(createPipeline().run(otherBuilding())));
  const sent = worker.sent.filter((one) => one.type === OTHER_REQUEST);
  assert.deepEqual(sent.map((one) => one.hasProject), [true, false], 'the project went once');
  client.close();
});

test('an other answer is dropped after closeOther, asked or answered: the callers get null and the worker is told to let go', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  store.derived.setOther(otherBuilding(), 'a.json');

  const pending = store.derived.other();
  assert.equal(worker.inbox.length, 1, 'with the worker');
  store.derived.closeOther();
  const dropped = client.laneStats.other.dropped;
  assert.equal(await pending, null, 'a caller waiting on a comparison that ended gets null');
  await worker.workAll();
  assert.equal(client.laneStats.other.dropped, dropped + 1, 'the answer that came back was dropped');
  assert.equal(worker.count(OTHER_CLOSE), 1);
  assert.equal(await store.derived.other(), null, 'no comparison is held');
  assert.equal(worker.count(OTHER_REQUEST), 1, 'and nothing more was asked');

  store.derived.closeOther();
  assert.equal(worker.count(OTHER_CLOSE), 1, 'closing with none held says nothing');

  // answered, then closed
  store.derived.setOther(otherBuilding(), 'b.json');
  const answer = await answered(worker, store.derived.other());
  assert.ok(answer.result);
  store.derived.closeOther();
  assert.equal(await store.derived.other(), null, 'the remembered answer is gone with the comparison');
  assert.equal(worker.count(OTHER_CLOSE), 2);
  client.close();
});

test('setOther while a comparison is held replaces it: the older job settles null, the new one is worked out under the next number', async () => {
  const store = storeOf(sampleSchool());
  const client = engineFor(store, { worker: false });
  store.derived.setOther(otherBuilding(), 'a.json');
  const older = store.derived.other();
  store.derived.setOther(sampleSchool(), 'b.json');
  assert.equal(await older, null);
  const newer = await store.derived.other();
  assert.equal(newer.fileName, 'b.json');
  assert.deepEqual(newer.result, trimResult(createPipeline().run(sampleSchool())), 'the second building\'s answer, not the first\'s');
  assert.throws(() => store.derived.setOther(null, 'x'), TypeError);
  client.close();
});

test('on the main thread the other building is searched on a cache of its own, and the open project\'s lane keeps its routes', async () => {
  const store = storeOf(sampleSchool());
  const client = engineFor(store, { worker: false });
  await store.derived.results();
  const searched = client.searches;
  assert.ok(searched > 0);
  store.derived.setOther(sampleSchool(), 'same.json');
  await store.derived.other();
  assert.ok(client.searches >= searched * 2, 'the same building was searched again: its route cache is not the main lane\'s (' + client.searches + ' after ' + searched + ')');
  // and the other building did not empty the cache the main lane routes from: a schedule change searches nothing
  const afterOther = client.searches;
  store.apply(actions.setSlot, { groupId: 'gsample06b', dayTypeId: 'dsample00b', period: 0, slot: { room: null } });
  await store.derived.results();
  assert.equal(client.searches - afterOther, 0, 'the main lane\'s distance fields were still there');
  const kept = withScenarios(storeOf(sampleSchool()));
  const keptClient = engineFor(kept, { worker: false });
  await kept.derived.results();
  const before = keptClient.searches;
  await kept.derived.kept(keptNamed(kept.project, 'Ease the walk').id);
  assert.equal(keptClient.searches - before, 0, 'a kept scenario with no building lever searched nothing: its pipeline borrows the main lane\'s route cache');
  client.close();
  keptClient.close();
});

// ---------------------------------------------------------------- stats, closing, attaching

test('client.laneStats counts all four lanes', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  assert.deepEqual(Object.keys(client.laneStats).sort(), ['kept', 'other', 'scenario', 'suggest']);
  await store.derived.kept(keptNamed(store.project, 'Ease the walk').id);
  store.derived.setOther(otherBuilding(), 'a.json');
  await store.derived.other();
  const { kept, other } = client.laneStats;
  assert.deepEqual([kept.asked, kept.sent, kept.answered, kept.failed], [1, 1, 1, 0]);
  assert.deepEqual([other.asked, other.sent, other.answered, other.failed], [1, 1, 1, 0]);
  assert.equal(client.laneStats.scenario.sent, 0);
  client.close();
});

test('closing the client fails a waiting kept or other job and the lanes then refuse; with no engine attached the store says so', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const kept = store.derived.kept(keptNamed(store.project, 'Ease the walk').id);
  store.derived.setOther(otherBuilding(), 'a.json');
  const other = store.derived.other();
  kept.catch(() => {});
  other.catch(() => {});
  client.close();
  await assert.rejects(kept, /closed/);
  await assert.rejects(other, /closed/);
  await assert.rejects(client.kept('x'), /closed/);
  await assert.rejects(client.other(), /closed/);
  assert.throws(() => client.setOther(sampleSchool(), 'x'), /closed/);

  const bare = storeOf(sampleSchool());
  engineFor(bare, { worker: false }).close();
  await assert.rejects(bare.derived.kept('e'), /engineFor\(store\)/);
  await assert.rejects(bare.derived.other(), /engineFor\(store\)/);
  assert.throws(() => bare.derived.setOther(sampleSchool(), 'x'), /engineFor\(store\)/);
  bare.derived.closeOther();
});

test('createEngineClient is exported with the lanes on it', () => {
  const client = createEngineClient(storeOf(sampleSchool()), { worker: false });
  for (const name of ['kept', 'other', 'setOther', 'closeOther']) assert.equal(typeof client[name], 'function', name);
  client.close();
});

// ---------------------------------------------------------------- one job for each kept scenario (SV2-121b)

const SLOT_CHANGE = { groupId: 'gsample06b', dayTypeId: 'dsample00b', period: 0, slot: { room: null } };

test('two kept scenarios asked together are both answered: one job each, on the main thread and in the worker', async () => {
  for (const inWorker of [true, false]) {
    const store = withScenarios(storeOf(sampleSchool()));
    const worker = inWorker ? await standInWorker() : null;
    const client = engineFor(store, inWorker ? { worker: () => worker } : { worker: false });
    const a = keptNamed(store.project, 'Ease the walk');
    const b = keptNamed(store.project, 'Closed stairs');
    const both = Promise.all([store.derived.kept(a.id), store.derived.kept(b.id)]);
    if (worker) await worker.workAll();
    const [first, second] = await both;
    assert.ok(first && second, 'neither caller was told there is no such scenario (' + (inWorker ? 'worker' : 'main') + ')');
    assert.deepEqual(first.result, expectedKept(store.project, a));
    assert.deepEqual(second.result, expectedKept(store.project, b));
    assert.equal(client.laneStats.kept.sent, 2);
    assert.equal(client.laneStats.kept.answered, 2);
    assert.equal(client.laneStats.kept.dropped, 0);
    client.close();
  }
});

test('kept scenarios asked alternately are not worked out again while nothing has changed; a change works each out once more', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const a = keptNamed(store.project, 'Ease the walk').id;
  const b = keptNamed(store.project, 'Closed stairs').id;
  const first = await answered(worker, Promise.all([store.derived.kept(a), store.derived.kept(b)]));
  for (let round = 0; round < 3; round += 1) {
    const [again, other] = await Promise.all([store.derived.kept(a), store.derived.kept(b)]);
    assert.equal(again, first[0], 'the answer given before, by ===');
    assert.equal(other, first[1]);
  }
  assert.equal(worker.count(KEPT_REQUEST), 2, 'two runs in all');
  assert.equal(client.laneStats.kept.sent, 2);
  assert.equal(client.laneStats.kept.remembered, 6);
  store.apply(actions.setSlot, SLOT_CHANGE);
  const second = await answered(worker, Promise.all([store.derived.kept(a), store.derived.kept(b)]));
  assert.notEqual(second[0], first[0]);
  assert.equal(worker.count(KEPT_REQUEST), 4);
  client.close();
});

test('a kept scenario whose id an older file repeated, or left out, is answered, each by its own object', async () => {
  const base = withScenarios(storeOf(sampleSchool()));
  const [ease, closed] = keptScenarios(base.project);
  const noId = { ...closed };
  delete noId.id;
  const repeated = { ...closed, id: ease.id };
  const project = { ...base.project, scenarios: [ease, repeated, noId] };
  const store = storeOf(project);
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const [one, two, three] = keptScenarios(store.project);
  const all = Promise.all([store.derived.kept(one), store.derived.kept(two), store.derived.kept(three)]);
  await worker.workAll();
  const [x, y, z] = await all;
  assert.deepEqual(x.result, expectedKept(store.project, one));
  assert.deepEqual(y.result, expectedKept(store.project, two), 'the second with the first one\'s id has its own answer');
  assert.deepEqual(z.result, expectedKept(store.project, three), 'the one with no id is answered');
  assert.notDeepEqual(x.result, y.result);
  assert.equal(client.laneStats.kept.sent, 3);
  assert.equal(await store.derived.kept(ease.id), x, 'by id, the first one with it');
  assert.equal(await store.derived.kept({ ...ease }), null, 'an object that is not in scenarios is not a kept scenario');
  assert.equal(await store.derived.kept(undefined), null);
  client.close();
});

test('a kept scenario that left scenarios before its run is answered null and never run', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  const a = keptNamed(store.project, 'Ease the walk');
  const b = keptNamed(store.project, 'Closed stairs');
  const early = store.derived.kept(a);
  const late = store.derived.kept(b);
  store.apply(actions.deleteScenario, { id: a.id });
  assert.equal(await early, null, 'the object left scenarios before it was run');
  assert.ok((await late).result);
  assert.equal(client.laneStats.kept.answered, 1, 'only the scenario that is still kept was run');
  client.close();
});

test('no more answers are held than SCENARIOS_MOST: the oldest is worked out again, the newest is remembered', async () => {
  const base = withScenarios(storeOf(sampleSchool()));
  const [ease] = keptScenarios(base.project);
  // more than a project keeps, as an older or hand-made file might: distinct objects
  const many = Array.from({ length: SCENARIOS_MOST + 2 }, (unused, index) => ({ ...ease, id: 'ekept' + String(index).padStart(5, '0') }));
  const store = storeOf({ ...base.project, scenarios: many });
  const client = engineFor(store, { worker: false });
  for (const scenario of many) await store.derived.kept(scenario);
  assert.equal(client.laneStats.kept.sent, many.length);
  await store.derived.kept(many[many.length - 1]);
  assert.equal(client.laneStats.kept.sent, many.length, 'the newest is remembered');
  await store.derived.kept(many[0]);
  assert.equal(client.laneStats.kept.sent, many.length + 1, 'the oldest was let go, and is worked out again');
  client.close();
});

// ---------------------------------------------------------------- the shared route cache

test('kept scenarios with closed stairs and a one-way lever leave the main lane\'s routes and searches as they were', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  store.apply(actions.newScenario, { name: 'One way', keep: true });
  store.apply(actions.addScenarioLever, { lever: { kind: 'way', connectionId: STAIRS_A, way: 'ab' } });
  store.apply(actions.newScenario, { name: 'Open again', keep: true });
  const client = engineFor(store, { worker: false });
  const first = await store.derived.results();
  // a run's routes, without how many searches it took to get them
  const routesOf = (result) => ({ ...result.routes, searches: 0 });
  assert.deepEqual(routesOf(first), routesOf(createPipeline().run(store.project)));
  const one = keptNamed(store.project, 'One way');
  const closed = keptNamed(store.project, 'Closed stairs');
  assert.notEqual(leverOptionsKey(leverRouteOptions(store.project, reconcile(store.project, one).levers)), leverOptionsKey(leverRouteOptions(store.project, reconcile(store.project, closed).levers)), 'two different route options');
  const kept = await Promise.all([one, closed, keptNamed(store.project, 'Ease the walk')].map((scenario) => store.derived.kept(scenario)));
  assert.notDeepEqual(kept[0].result, kept[1].result);
  store.apply(actions.setSlot, SLOT_CHANGE);
  const before = client.searches;
  const second = await store.derived.results();
  assert.notEqual(second, first);
  assert.deepEqual(routesOf(second), routesOf(createPipeline().run(store.project)), 'the main lane\'s routes are the engine\'s own, whatever the kept runs searched under');
  assert.equal(client.searches - before, 0, 'the kept runs did not take the distance fields the main lane routes from');
  assert.equal(second.work.searches, 0);
  // and the other way round: a kept run after the main lane's, under the same counters, is the engine's own
  const again = await store.derived.kept(closed);
  assert.deepEqual(again.result, expectedKept(store.project, keptNamed(store.project, 'Closed stairs')));
  client.close();
});

test('a kept job sent at one geometry is never run after a main job at the next: it is dropped and asked again', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  const a = keptNamed(store.project, 'Ease the walk');
  const b = keptNamed(store.project, 'Closed stairs');
  const pa = store.derived.kept(a);
  const pb = store.derived.kept(b);
  assert.equal(worker.inbox.length, 1, 'one kept job is with the worker, the other waits behind it');
  store.apply(actions.disconnectStairs, { connectionId: 'csample00b' });
  assert.ok(store.geometryVersion > worker.sent[0].versions.geometry);
  const main = store.derived.results();
  await worker.workAll();
  const [ra, rb] = await Promise.all([pa, pb]);
  await main;
  assert.deepEqual([ra.versions.geometry, rb.versions.geometry], [store.geometryVersion, store.geometryVersion]);
  assert.deepEqual(rb.result, expectedKept(store.project, keptNamed(store.project, 'Closed stairs')));
  let newest = 0;
  for (const one of worker.sent) {
    if (one.type === REQUEST) newest = Math.max(newest, one.versions.geometry);
    if (one.type === KEPT_REQUEST) assert.ok(one.versions.geometry >= newest, 'a kept job at geometry ' + one.versions.geometry + ' was sent after a main job at ' + newest);
  }
  assert.ok(client.laneStats.kept.dropped >= 1);
  client.close();
});

// ---------------------------------------------------------------- letting go

test('the worker lets its kept pipeline go on sv2-kept-close and makes it again for the next kept request', async () => {
  const scope = await workerScope();
  const store = withScenarios(storeOf(sampleSchool()));
  const ease = keptNamed(store.project, 'Ease the walk');
  const request = (generation) => ({ type: KEPT_REQUEST, generation, project: store.project, scenario: ease, versions: { ...versionsOf(store), schedule: generation, levers: 0 } });
  const [before] = scope.handle(request(1));
  assert.equal(before.ok, true);
  assert.deepEqual(scope.handle({ type: KEPT_CLOSE }), [], 'no answer');
  const [after] = scope.handle(request(2));
  assert.equal(after.ok, true, 'the lane works after the close');
  assert.deepEqual(after.answer, before.answer);
  assert.deepEqual(scope.handle({ type: KEPT_CLOSE }), []);
  assert.deepEqual(scope.handle({ type: KEPT_CLOSE }), [], 'closing twice is harmless');
});

test('the client lets the kept pipeline go when no kept scenario has been asked for for the idle time (keptIdle): one sv2-kept-close, answers stay', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker, keptIdle: 100 });
  const a = keptNamed(store.project, 'Ease the walk').id;
  const b = keptNamed(store.project, 'Closed stairs').id;
  const first = await answered(worker, store.derived.kept(a));
  assert.equal(worker.count(KEPT_CLOSE), 0);
  // a pending job keeps the pipeline: nothing is closed while one waits
  const pending = store.derived.kept(b);
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(worker.count(KEPT_CLOSE), 0, 'a job with the worker is not cut off');
  await worker.workAll();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(worker.count(KEPT_CLOSE), 1, 'one close for the idle time');
  assert.equal(await store.derived.kept(a), first, 'the answer is still remembered');
  assert.equal(worker.count(KEPT_REQUEST), 2);
  // the lane works again after the close
  store.apply(actions.setSlot, SLOT_CHANGE);
  const again = await answered(worker, store.derived.kept(a));
  assert.deepEqual(again.result, expectedKept(store.project, keptNamed(store.project, 'Ease the walk')));
  client.close();
});

test('client.searches never goes down: closing the comparison or the client folds the other building\'s searches into a total', async () => {
  const store = storeOf(sampleSchool());
  const client = engineFor(store, { worker: false });
  assert.equal(client.searches, null, 'none made yet');
  await store.derived.results();
  const main = client.searches;
  store.derived.setOther(sampleSchool(), 'same.json');
  await store.derived.other();
  const both = client.searches;
  assert.ok(both >= 2 * main, 'the other building searched on its own cache');
  store.derived.closeOther();
  assert.equal(client.searches, both, 'closeOther let the cache go and kept its searches');
  store.derived.setOther(sampleSchool(), 'again.json');
  await store.derived.other();
  assert.ok(client.searches >= both + main);
  const last = client.searches;
  store.derived.setOther(otherBuilding(), 'replaced.json');
  assert.ok(client.searches >= last, 'a replaced comparison counts too');
  await store.derived.other();
  const beforeClose = client.searches;
  client.close();
  assert.equal(client.searches, beforeClose, 'closing the client does not lose them either');
});

test('the idle release of the kept pipeline on the main thread loses no searches', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false, keptIdle: 20 });
  await store.derived.kept(keptNamed(store.project, 'Closed stairs').id);
  const before = client.searches;
  assert.ok(before > 0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(client.searches, before);
  const again = await store.derived.kept(keptNamed(store.project, 'Ease the walk').id);
  assert.ok(again.result, 'the lane makes its pipeline again');
  assert.ok(client.searches >= before);
  client.close();
});

// ---------------------------------------------------------------- a refusal that the project was not sent

test('a worker that no longer holds the other project says so, and the retry carries it', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  store.derived.setOther(otherBuilding(), 'a.json');
  worker.refuse = 1;
  const failed = store.derived.other();
  failed.catch(() => {});
  await worker.workAll();
  await assert.rejects(failed, /could not be worked out/);
  // the retry goes without the project (the worker holds it); then the worker loses it
  const second = store.derived.other();
  second.catch(() => {});
  worker.forget();
  await worker.workAll();
  await assert.rejects(second, /was not sent/);
  const third = await answered(worker, store.derived.other());
  assert.deepEqual(third.result, trimResult(createPipeline().run(otherBuilding())));
  assert.deepEqual(worker.sent.filter((one) => one.type === OTHER_REQUEST).map((one) => one.hasProject), [true, false, true], 'the project went again after the refusal');
  client.close();
});

// ---------------------------------------------------------------- the main thread, which has no worker to be late

const betweenRunAndAnswer = (change) => Promise.resolve().then(change);

test('main thread: a kept answer the store has moved past is dropped and the newest given', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  const id = keptNamed(store.project, 'Ease the walk').id;
  const asked = store.derived.kept(id);
  // runs in the microtask after the lane's own run and before its answer is looked at
  const moved = betweenRunAndAnswer(() => store.apply(actions.setSlot, SLOT_CHANGE));
  const answer = await asked;
  await moved;
  assert.deepEqual(answer.versions, versionsOf(store), 'the answer is for the store as it now is');
  assert.deepEqual(answer.result, expectedKept(store.project, keptNamed(store.project, 'Ease the walk')));
  assert.equal(client.laneStats.kept.dropped, 1);
  assert.equal(client.laneStats.kept.sent, 2);
  assert.equal(client.laneStats.kept.asked, 1, 'the page asked once: the lane\'s own asking again is not counted');
  client.close();
});

test('main thread: a kept scenario deleted before its run, or after it and before the answer, is answered null', async () => {
  const store = withScenarios(storeOf(sampleSchool()));
  const client = engineFor(store, { worker: false });
  const a = keptNamed(store.project, 'Ease the walk').id;
  const b = keptNamed(store.project, 'Closed stairs').id;
  const before = store.derived.kept(a);
  store.apply(actions.deleteScenario, { id: a });
  assert.equal(await before, null);
  assert.equal(client.laneStats.kept.answered, 0, 'never run');
  const after = store.derived.kept(b);
  const gone = betweenRunAndAnswer(() => store.apply(actions.deleteScenario, { id: b }));
  assert.equal(await after, null);
  await gone;
  assert.equal(client.laneStats.kept.answered, 1, 'run, and the answer went to nobody');
  assert.equal(client.laneStats.kept.dropped, 2);
  assert.equal(client.laneStats.kept.failed, 0);
  client.close();
});

test('main thread: closeOther while the other building is being worked out gives its callers null', async () => {
  const store = storeOf(sampleSchool());
  const client = engineFor(store, { worker: false });
  store.derived.setOther(otherBuilding(), 'a.json');
  const asked = store.derived.other();
  const closing = betweenRunAndAnswer(() => store.derived.closeOther());
  assert.equal(await asked, null);
  await closing;
  assert.equal(client.laneStats.other.answered, 1, 'it was run');
  assert.equal(client.laneStats.other.dropped, 1, 'and its answer dropped');
  assert.equal(await store.derived.other(), null);
  // a comparison held again is worked out afresh
  store.derived.setOther(otherBuilding(), 'b.json');
  assert.deepEqual((await store.derived.other()).result, trimResult(createPipeline().run(otherBuilding())));
  client.close();
});

test('a worker given up on while the other building is with it: the main thread works it out from the project the page holds', async () => {
  const store = storeOf(sampleSchool());
  const worker = await standInWorker();
  const client = engineFor(store, { worker: () => worker });
  store.derived.setOther(otherBuilding(), 'a.json');
  const pending = store.derived.other();
  assert.deepEqual(worker.sent.map((one) => [one.type, one.hasProject]), [[OTHER_REQUEST, true]], 'the project went with the first request');
  worker.emit('error', { message: 'it died' });
  const answer = await pending;
  assert.equal(answer.where, 'main');
  assert.deepEqual(answer.result, trimResult(createPipeline().run(otherBuilding())));
  assert.equal(answer.fileName, 'a.json');
  assert.equal(client.laneStats.other.failed, 0);
  // the next comparison is worked out here too
  store.derived.setOther(sampleSchool(), 'b.json');
  const next = await store.derived.other();
  assert.equal(next.where, 'main');
  assert.deepEqual(next.result, trimResult(createPipeline().run(sampleSchool())));
  client.close();
});

void tick;
