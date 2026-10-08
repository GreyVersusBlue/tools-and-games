// The derived pipeline (engine/worker.js) and the client that asks it
// (ui/engine-client.js): node test/engine/worker.test.mjs
//
// What the pipeline keeps is what a fresh run would have worked out, a
// one-slot change runs two transitions and no more, the worker's short
// answers unpack to the full result, and the client never hands a caller a
// stale answer. The worker's own message handler runs here too, with a
// stand-in for the worker scope. How long it all takes at the promised size
// is test/timing/pipeline.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { allRooms } from '../../engine/schema.js';
import { routesForSchedule, routingGraph } from '../../engine/routing.js';
import { simulateSchedule, walkResults } from '../../engine/crowd.js';
import { loads } from '../../engine/load.js';
import { places } from '../../engine/places.js';
import { checkSchedule } from '../../engine/checks.js';
import { buildingChecks } from '../../engine/building-checks.js';
import { ownDayTypes } from '../../engine/day-types.js';
import { createPipeline, pack, unpack, REQUEST, ANSWER, READY } from '../../engine/worker.js';
import { createEngineClient, engineFor } from '../../ui/engine-client.js';
import { sampleSchool } from '../../data/sample-school.js';
import { bigProject, BIG } from '../fixtures/big.mjs';

const TRANSITIONS = (BIG.periods - 1) * BIG.dayTypes;
const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'worker.js');
const clock = () => new Date('2026-09-01T12:00:00Z');

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

function versionsOf(store) {
  return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
}

// Everything worked out afresh, straight from the engines, with nothing kept.
function fresh(project) {
  const graph = routingGraph(project);
  const routes = routesForSchedule(project, graph);
  const crowd = simulateSchedule(project, routes, graph);
  const walks = walkResults(project, crowd, graph);
  return {
    routes: routes.days,
    crowd,
    loads: ownDayTypes(project).map((dayType) => loads(project, routes, dayType.id, graph)),
    places: places(project, graph),
    walks,
    findings: checkSchedule(project, walks),
    buildingFindings: buildingChecks(project, graph),
  };
}

function parts(result) {
  return {
    routes: result.routes.days,
    crowd: result.crowd,
    loads: result.loads,
    places: result.places,
    walks: result.walks,
    findings: result.findings,
    buildingFindings: result.buildingFindings,
  };
}

// Put group `g` of the big fixture in another room for one period.
function moveGroup(store, g, dayIndex, period, step) {
  const project = store.project;
  const rooms = allRooms(project);
  const group = project.groups[g];
  const dayTypeId = project.dayTypes[dayIndex].id;
  const now = group.days[dayTypeId][period].room;
  let at = (g * 7 + period * 3 + step) % rooms.length;
  if (rooms[at].id === now) at = (at + 1) % rooms.length;
  store.apply(actions.setSlot, { groupId: group.id, dayTypeId, period, slot: { room: rooms[at].id } });
  return { groupId: group.id, dayTypeId, period };
}

// -------------------------------------------------------------- pipeline

test('the sample school: the walk that does not fit is found with real crowd results', () => {
  const result = createPipeline().run(sampleSchool());
  const loud = result.findings.findings.filter((finding) => finding.severity !== 'note');
  assert.deepEqual(loud.map((finding) => finding.id).sort(), ['group-walk:dsample00a:5:gsample08a', 'room-double:dsample00a:1:rsample203']);
  const walk = loud.find((finding) => finding.kind === 'group-walk');
  assert.equal(walk.severity, 'warning');
  assert.equal(walk.text, '8A needs 4 min 21 s to get from Gym to Room 303 after Period 6 on A Day, and the passing time is 4 min.');
  // the figure in the sentence is the crowd model's, for that walk
  const timedWalk = result.walks.groups.find((entry) => entry.dayTypeId === 'dsample00a' && entry.groupId === 'gsample08a' && entry.period === 5);
  assert.equal(timedWalk.total, 261);
  assert.equal(timedWalk.late, true);
  assert.equal(result.versions, null);
  assert.deepEqual(result.buildingFindings, []);
});

test('what the pipeline keeps is what a fresh run works out, after every kind of change', () => {
  const store = storeOf(bigProject({ seed: 2 }));
  const pipeline = createPipeline();
  const check = (label) => {
    const result = pipeline.run(store.project, versionsOf(store));
    assert.deepEqual(parts(result), fresh(store.project), label);
    return result;
  };
  check('cold');
  moveGroup(store, 3, 0, 4, 0);
  check('one slot');
  moveGroup(store, 3, 0, 0, 1);
  moveGroup(store, 40, 1, 9, 2);
  check('the first period of one day and the last of the other');
  store.apply(actions.editGroup, { id: store.project.groups[7].id, headCount: 61 });
  check('a head count');
  store.apply(actions.setSetting, { key: 'defaultHeadCount', value: 13 });
  check('the default head count');
  store.apply(actions.setSetting, { key: 'checks.passingMarginSeconds', value: 45 });
  check('the passing margin');
  store.apply(actions.setSetting, { key: 'defaultPassingSeconds', value: 200 });
  check('the default passing time');
  store.apply(actions.setSetting, { key: 'secondsPerCell', value: 2 });
  check('the walking speed');
  const room = allRooms(store.project)[11];
  store.apply(actions.deleteSpaces, { spaceIds: [room.id] });
  check('a room deleted');
  store.undo();
  check('and put back');
  store.apply(actions.deleteGroup, { id: store.project.groups[0].id });
  check('a group deleted');
});

test('one changed slot runs the transition into the period and the one out of it, and keeps the rest', () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const pipeline = createPipeline();
  const cold = pipeline.run(store.project, versionsOf(store));
  assert.equal(cold.work.transitionsRun, TRANSITIONS);
  assert.equal(pipeline.run(store.project, versionsOf(store)), cold, 'the same counters give the same object');

  const edit = moveGroup(store, 9, 1, 4, 0);
  const after = pipeline.run(store.project, versionsOf(store));
  assert.equal(after.work.transitionsRun, 2);
  assert.equal(after.work.loadsRun, 1);
  assert.ok(after.work.searches <= 2, 'at most the two new journeys were searched: ' + after.work.searches);
  after.crowd.days.forEach((day, d) => {
    const was = cold.crowd.days[d];
    if (day.dayTypeId !== edit.dayTypeId) {
      assert.equal(day, was, 'the other day type is the same object');
      return;
    }
    day.transitions.forEach((transition, period) => {
      const ran = period === edit.period - 1 || period === edit.period;
      assert.equal(transition !== was.transitions[period], ran, 'transition ' + period + (ran ? ' was run again' : ' was kept'));
    });
  });
  assert.equal(after.loads.filter((load, index) => load === cold.loads[index]).length, 1, 'the other day type\'s loads are kept');
  assert.equal(after.places, cold.places);
  assert.equal(after.buildingFindings, cold.buildingFindings);

  moveGroup(store, 9, 1, 0, 1);
  assert.equal(pipeline.run(store.project, versionsOf(store)).work.transitionsRun, 1, 'the first period has one transition');
});

test('a room number retyped searches nothing and keeps every crowd result; a painted cell runs it all again', () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const pipeline = createPipeline();
  const cold = pipeline.run(store.project, versionsOf(store));

  store.apply(actions.renameFloor, { id: store.project.building.floors[1].id, name: 'Mezzanine' });
  assert.deepEqual(versionsOf(store), { geometry: 0, building: 1, schedule: 0 });
  const floorNamed = pipeline.run(store.project, versionsOf(store));
  assert.equal(floorNamed.routes, cold.routes, 'a building change that is not geometry keeps the routes as they are');
  assert.equal(floorNamed.crowd, cold.crowd);
  assert.deepEqual(floorNamed.loads, cold.loads);
  assert.notEqual(floorNamed.places, cold.places);
  assert.deepEqual([floorNamed.work.transitionsRun, floorNamed.work.searches, floorNamed.work.routesRun, floorNamed.work.buildingRun], [0, 0, false, true]);

  // a room's number is in the findings' sentences, so it moves the schedule counter too
  const room = allRooms(store.project)[20];
  store.apply(actions.setRoomFields, { roomId: room.id, number: 'Annexe <b>' });
  assert.deepEqual(versionsOf(store), { geometry: 0, building: 2, schedule: 1 });
  const renamed = pipeline.run(store.project, versionsOf(store));
  assert.equal(renamed.crowd, cold.crowd);
  assert.deepEqual([renamed.work.transitionsRun, renamed.work.searches, renamed.work.routesRun], [0, 0, true]);
  assert.deepEqual(renamed.routes.days, cold.routes.days);
  assert.ok(renamed.findings.findings.some((finding) => finding.text.includes('Annexe <b>')), 'the findings name the room as it is typed now');

  const floor = store.project.building.floors[0];
  store.apply(actions.paintCorridor, { floorId: floor.id, cells: [0] });
  assert.equal(store.geometryVersion, 1);
  const painted = pipeline.run(store.project, versionsOf(store));
  assert.equal(painted.work.transitionsRun, TRANSITIONS);
  assert.ok(painted.work.searches > 100);
});

test('without counters nothing is kept', () => {
  const project = sampleSchool();
  const pipeline = createPipeline();
  const first = pipeline.run(project);
  const second = pipeline.run(project);
  assert.notEqual(second, first);
  assert.equal(second.work.transitionsRun, 14);
  assert.deepEqual(parts(second), parts(first));
});

// ------------------------------------------------------ the short answers

test('a packed answer leaves out what was sent before, and unpacks to the whole result', () => {
  const store = storeOf(bigProject({ seed: 1 }));
  const pipeline = createPipeline();
  const cold = pipeline.run(store.project, versionsOf(store));
  const first = unpack(structuredClone(pack(cold, null)), null);
  assert.deepEqual(first, cold);

  const edit = moveGroup(store, 9, 1, 4, 0);
  const after = pipeline.run(store.project, versionsOf(store));
  const answer = structuredClone(pack(after, cold));
  assert.deepEqual(answer.kept.sort(), ['buildingFindings', 'places']);
  const sentRoutes = answer.routes.days.flatMap((day) => day.groups.filter((group) => group.routes !== null).map((group) => day.dayTypeId + ' ' + group.groupId));
  assert.deepEqual(sentRoutes, [edit.dayTypeId + ' ' + edit.groupId], 'only the changed group\'s routes are sent');
  const sentTransitions = answer.crowd.flatMap((day) => day.transitions.map((transition, period) => (transition === null ? null : day.dayTypeId + ' ' + period)).filter(Boolean));
  assert.deepEqual(sentTransitions, [edit.dayTypeId + ' 3', edit.dayTypeId + ' 4']);
  assert.equal(answer.loads.filter((load) => load.kept === true).length, 1);

  const second = unpack(answer, first);
  assert.deepEqual(second, after);
  assert.equal(second.places, first.places, 'a kept part is the object this side already had');
  assert.equal(second.crowd.days[0], first.crowd.days[0], 'and so is the day type nothing changed on');
  assert.equal(second.crowd.days[1].transitions[0], first.crowd.days[1].transitions[0], 'and a transition that was not run again');
  assert.notEqual(second.crowd.days[1].transitions[4], first.crowd.days[1].transitions[4]);
  assert.throws(() => unpack(answer, null), /never had/);
});

// ------------------------------------------------- the worker's own handler

// engine/worker.js with a stand-in for the worker scope: a fresh copy of the
// module (the query makes it one) that finds itself in a worker and answers
// messages. What goes in and out is copied the way postMessage copies it.
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
    await import(pathToFileURL(WORKER_FILE).href + '?scope=' + scopes);
  } finally {
    if (had.self === undefined) delete globalThis.self;
    else globalThis.self = had.self;
    if (had.scopeClass === undefined) delete globalThis.WorkerGlobalScope;
    else globalThis.WorkerGlobalScope = had.scopeClass;
  }
  return {
    // what the worker posted as it loaded
    loaded: scope.out.splice(0),
    // hand the worker one message and return what it posted back
    handle(message) {
      const event = new Event('message');
      event.data = structuredClone(message);
      scope.dispatchEvent(event);
      return scope.out.splice(0);
    },
  };
}

// Something the client can use as its worker. Messages wait in `inbox` until
// the test calls work(), so a test decides when an answer comes back.
async function standInWorker() {
  const scope = await workerScope();
  const listeners = { message: [], error: [], messageerror: [] };
  return {
    inbox: [],
    posted: 0,
    terminated: false,
    postMessage(message) {
      this.posted += 1;
      this.inbox.push(structuredClone(message));
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    terminate() {
      this.terminated = true;
    },
    // the worker's own "I have loaded" reaches the page
    load() {
      for (const message of scope.loaded) for (const listener of listeners.message) listener({ data: message });
    },
    // the worker takes its oldest message and answers it
    work() {
      const message = this.inbox.shift();
      for (const answer of scope.handle(message)) for (const listener of listeners.message) listener({ data: answer });
    },
    emit(type, event) {
      for (const listener of listeners[type]) listener(event);
    },
  };
}

test('the worker answers a request with the generation it was given, and a short answer the second time', async () => {
  const scope = await workerScope();
  assert.deepEqual(scope.loaded, [{ type: READY }], 'it says it has loaded, once');
  const store = storeOf(sampleSchool());
  const [first] = scope.handle({ type: REQUEST, generation: 7, project: store.project, versions: versionsOf(store) });
  assert.deepEqual([first.type, first.generation, first.ok], [ANSWER, 7, true]);
  assert.deepEqual(first.answer.kept, []);
  const whole = unpack(first.answer, null);
  assert.deepEqual(parts(whole), fresh(store.project));

  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  const [second] = scope.handle({ type: REQUEST, generation: 8, project: store.project, versions: versionsOf(store) });
  assert.equal(second.generation, 8);
  assert.deepEqual(second.answer.kept.sort(), ['crowd', 'routes']);
  assert.deepEqual(parts(unpack(second.answer, whole)), fresh(store.project));

  assert.deepEqual(scope.handle({ type: 'something-else' }), [], 'another kind of message is not answered');
  const [bad] = scope.handle({ type: REQUEST, generation: 9, project: { settings: null }, versions: null });
  assert.deepEqual([bad.generation, bad.ok, typeof bad.error], [9, false, 'string']);
  const [again] = scope.handle({ type: REQUEST, generation: 10, project: store.project, versions: versionsOf(store) });
  assert.deepEqual(again.answer.kept, [], 'after a failure the worker sends everything again');
});

// ------------------------------------------------------------- the client

test('store.derived.results() refuses until an engine is attached, then gives the result', async () => {
  const store = storeOf(sampleSchool());
  await assert.rejects(store.derived.results(), /engineFor\(store\)/);
  assert.throws(() => store.derived.use({}), TypeError);
  const client = engineFor(store, { worker: false });
  assert.equal(engineFor(store), client, 'a second call gives the same client');
  const result = await store.derived.results();
  assert.equal(result.where, 'main');
  assert.deepEqual(parts(result), fresh(store.project));
  client.close();
  await assert.rejects(store.derived.results(), /engineFor\(store\)/);
});

test('asking twice between two changes is one request and one promise', async () => {
  const worker = await standInWorker();
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });
  const a = client.results();
  const b = client.results();
  assert.equal(a, b);
  assert.equal(worker.posted, 1);
  worker.work();
  const result = await a;
  assert.equal(result.where, 'worker');
  assert.equal(result.generation, 1);
  assert.equal(client.results(), a, 'and still the same promise once it has been answered');
  assert.equal(worker.posted, 1);
  assert.deepEqual(parts(result), fresh(store.project));
  assert.deepEqual({ ...client.stats }, { asked: 3, remembered: 2, sent: 1, answered: 1, dropped: 0, failed: 0 });
});

test('a stale answer is dropped: whoever asked before a change gets the answer for the project as it is now', async () => {
  const worker = await standInWorker();
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });
  const before = client.results();
  store.apply(actions.setSlot, { groupId: 'gsample08a', dayTypeId: 'dsample00a', period: 6, slot: { room: 'rsample203' } });
  const middle = client.results();
  store.apply(actions.setSlot, { groupId: 'gsample06c', dayTypeId: 'dsample00a', period: 1, slot: { room: null } });
  const latest = client.results();
  assert.equal(worker.posted, 1, 'the worker is busy with the first request; the others wait');

  let settled = 0;
  for (const promise of [before, middle, latest]) promise.then(() => { settled += 1; });
  worker.work(); // the answer for generation 1 comes back
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, 0, 'nobody is given the stale answer');
  assert.equal(client.stats.dropped, 1);
  assert.equal(worker.posted, 2, 'and only the newest request was sent after it');
  assert.equal(worker.inbox[0].generation, 3);

  worker.work();
  const results = await Promise.all([before, middle, latest]);
  assert.equal(results[0], results[2]);
  assert.equal(results[1], results[2]);
  assert.equal(results[2].generation, 3);
  assert.deepEqual(parts(results[2]), fresh(store.project), 'the answer after a dropped one still unpacks to the whole result');
  assert.equal(results[2].findings.findings.some((finding) => finding.id === 'room-double:dsample00a:1:rsample203'), false, 'the double booking was cleared by the last change');
  assert.equal(results[2].work.transitionsRun, 2 + 2, 'the worker kept what it had: two transitions around each changed slot');
});

test('a worker that stops is given up on and the main thread answers', async () => {
  const worker = await standInWorker();
  const store = storeOf(sampleSchool());
  const reasons = [];
  const client = createEngineClient(store, { worker: () => worker, onFallback: (reason) => reasons.push(reason) });
  const promise = client.results();
  assert.equal(client.where, 'worker');
  worker.emit('error', { message: 'could not be loaded' });
  const result = await promise;
  assert.equal(result.where, 'main');
  assert.equal(client.where, 'main');
  assert.equal(worker.terminated, true);
  assert.deepEqual(reasons, ['The worker stopped: could not be loaded']);
  assert.equal(client.fallback, reasons[0]);
  assert.deepEqual(parts(result), fresh(store.project));
});

test('a worker that never says it has loaded is given up on after the wait; one that does is kept', async () => {
  const silent = await standInWorker();
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => silent, readyWait: 30 });
  const promise = client.results();
  assert.equal(silent.posted, 1);
  // nothing calls silent.work(): only the wait running out can answer this.
  // The client's timer does not hold Node open, so the test holds it.
  const hold = setTimeout(() => {}, 5000);
  const result = await promise;
  clearTimeout(hold);
  assert.equal(result.where, 'main');
  assert.equal(client.fallback, 'The worker had not loaded after 30 ms.');
  assert.equal(silent.terminated, true);

  const loaded = await standInWorker();
  const kept = createEngineClient(storeOf(sampleSchool()), { worker: () => loaded, readyWait: 30 });
  loaded.load();
  const answer = kept.results();
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(kept.where, 'worker', 'a worker that loaded is not given up on while it works');
  loaded.work();
  assert.equal((await answer).where, 'worker');
});

test('a worker that cannot be started, and no worker at all, both mean the main thread', async () => {
  const store = storeOf(sampleSchool());
  const broken = createEngineClient(store, { worker: () => { throw new Error('no workers here'); } });
  assert.equal(broken.where, 'main');
  assert.equal(broken.fallback, 'The worker could not be started: no workers here');
  assert.equal((await broken.results()).where, 'main');
  assert.equal(typeof Worker, 'undefined', 'Node has no Worker global');
  const plain = createEngineClient(store);
  assert.equal(plain.where, 'main');
  assert.equal(plain.fallback, null);
  assert.equal((await plain.results()).where, 'main');
});

test('a failure in the worker rejects that request and the next change starts clean', async () => {
  const worker = await standInWorker();
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });
  client.results();
  worker.work();
  await client.results();

  // break the project behind the store's back, the way no action can
  store.replace({ ...store.project, settings: null });
  const bad = client.results();
  worker.work();
  await assert.rejects(bad, Error);
  assert.equal(client.stats.failed, 1);

  store.replace(sampleSchool());
  const good = client.results();
  worker.work();
  assert.deepEqual(parts(await good), fresh(store.project));
});
