// What the engine client (ui/engine-client.js) remembers, and what it must
// not, in plain Node:
//   node test/ui/engine-client.test.mjs
//
// results() for counters already asked about is the same promise, so ten
// screens asking after one change cost one run. A run that failed is the one
// thing not remembered: the next asking, with nothing changed, goes to the
// worker again, since a failure can pass and nobody should have to edit the
// project or reload to be answered. The real client runs here against a
// stand-in worker that refuses as many requests as a case tells it to and
// answers the rest with the real pipeline. The pipeline's own cases, and the
// client's dropping of stale answers, are test/engine/worker.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createStore } from '../../engine/store.js';
import { createIds, seededRandom } from '../../engine/ids.js';
import * as actions from '../../engine/actions.js';
import { createPipeline, pack, REQUEST, ANSWER } from '../../engine/worker.js';
import { createEngineClient } from '../../ui/engine-client.js';
import { standingProject, CHECK_TRIES } from '../../ui/staff/form.js';
import { sampleSchool } from '../../data/sample-school.js';

const clock = () => new Date('2026-09-01T12:00:00Z');

function storeOf(project) {
  return createStore({ project, clock, ids: createIds(seededRandom(16)) });
}

// A worker as the client sees one. It answers when the case calls work(), and
// refuses its next `refusals` requests the way engine/worker.js does when the
// pipeline throws: ok false, and everything it had sent forgotten.
function standInWorker(refusals) {
  const listeners = { message: [], error: [], messageerror: [] };
  const pipeline = createPipeline();
  let sent = null;
  return {
    inbox: [],
    posted: 0,
    refusals,
    postMessage(message) {
      this.posted += 1;
      this.inbox.push(structuredClone(message));
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    terminate() {},
    work() {
      const message = this.inbox.shift();
      assert.ok(message && message.type === REQUEST, 'the worker was sent a request to answer');
      let answer;
      if (this.refusals > 0) {
        this.refusals -= 1;
        pipeline.clear();
        sent = null;
        answer = { type: ANSWER, generation: message.generation, ok: false, error: 'The checks could not be worked out.' };
      } else {
        const result = pipeline.run(message.project, message.versions);
        answer = { type: ANSWER, generation: message.generation, ok: true, answer: pack(result, sent) };
        sent = result;
      }
      for (const listener of listeners.message) listener({ data: answer });
    },
  };
}

test('a run the worker refused is not remembered: asked again with nothing changed, the worker is asked again and its answer is given', async () => {
  const worker = standInWorker(1);
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });

  const first = client.results();
  worker.work();
  await assert.rejects(first, /could not be worked out/);
  assert.equal(client.stats.failed, 1);

  // nothing about the project has changed
  const second = client.results();
  assert.notEqual(second, first, 'the rejected promise is not handed back');
  assert.equal(worker.posted, 2, 'the second asking reached the worker');
  assert.equal(client.stats.remembered, 0, 'a failure is not counted as remembered');
  worker.work();
  const result = await second;
  assert.equal(result.where, 'worker');
  assert.ok(Array.isArray(result.findings.findings), 'the second asking is answered with the findings');
  assert.deepEqual([client.stats.asked, client.stats.sent, client.stats.answered, client.stats.failed], [2, 2, 1, 1]);
  client.close();
});

test('a run that was answered is still remembered, and so is one still on its way: one request, one promise', async () => {
  const worker = standInWorker(0);
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });

  const first = client.results();
  assert.equal(client.results(), first, 'pending: the same promise');
  worker.work();
  await first;
  assert.equal(client.results(), first, 'answered: the same promise');
  assert.equal(worker.posted, 1);
  assert.equal(client.stats.remembered, 2);
  client.close();
});

test('every asking after a failure is one new request until one is answered: two refusals cost three runs, not more', async () => {
  const worker = standInWorker(2);
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });

  for (let n = 1; n <= 2; n += 1) {
    const refused = client.results();
    // asked again before the refusal comes: still the one request
    assert.equal(client.results(), refused);
    worker.work();
    await assert.rejects(refused, Error);
    assert.equal(worker.posted, n);
  }
  const good = client.results();
  worker.work();
  await good;
  assert.equal(client.results(), good, 'the answer after the failures is remembered like any other');
  assert.equal(worker.posted, 3);
  assert.equal(client.stats.failed, 2);
  client.close();
});

test('on the main thread too: a run that threw is run again on the next asking', async () => {
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: false });
  const good = store.project;
  // break the project behind the store's back, the way no action can, without moving a counter
  store.replace({ ...good, settings: null });
  const stamp = [store.geometryVersion, store.buildingVersion, store.scheduleVersion].join(':');
  const first = client.results();
  await assert.rejects(first, Error);
  assert.equal([store.geometryVersion, store.buildingVersion, store.scheduleVersion].join(':'), stamp, 'the counters stood still');
  const second = client.results();
  assert.notEqual(second, first);
  await assert.rejects(second, Error);
  assert.equal(client.stats.sent, 2, 'the second asking ran the pipeline again');
  assert.equal(client.stats.failed, 2);
  client.close();
});

test('a failure does not disturb the request after a change: the newer project is answered once', async () => {
  const worker = standInWorker(1);
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });

  const refused = client.results();
  worker.work();
  await assert.rejects(refused, Error);

  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  const next = client.results();
  assert.equal(client.results(), next);
  worker.work();
  const result = await next;
  assert.equal(result.generation, 2);
  assert.equal(worker.posted, 2);
  client.close();
});

// SV2-51 item 3. The run for the older counters fails after the project has
// changed and been asked about again: its failure is given to nobody, since
// whoever asked for it was handed the newer request when that was asked, and
// the newer request goes to the worker next and answers both.
test('a run that fails after a newer change was asked about: neither caller sees the failure, and the newer answer reaches both', async () => {
  const worker = standInWorker(1);
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: () => worker });

  const older = client.results();
  store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
  const newer = client.results();
  assert.notEqual(newer, older);
  assert.equal(worker.posted, 1, 'the newer request waits while the worker is busy');
  worker.work(); // the worker refuses the older run
  assert.equal(worker.posted, 2, 'the newer request goes as soon as the worker is free');
  assert.deepEqual([client.stats.failed, client.stats.dropped], [0, 1], 'the refusal is dropped, not given to a caller');
  worker.work();
  const [a, b] = await Promise.all([older, newer]);
  assert.equal(a.generation, 2, 'the older caller gets the newer answer');
  assert.equal(b.generation, 2);
  assert.equal(a, b);
  client.close();
});

// The header is what stands between a caller and the storm: the client keeps
// no failure, so it is the caller's to not ask again from its own rejection.
test('the header says a caller must not ask again from its own rejection, and why', () => {
  const header = readFileSync(new URL('../../ui/engine-client.js', import.meta.url), 'utf8').split('\nimport ')[0];
  assert.match(header, /a caller must not ask again from its own rejection handler/);
  assert.match(header, /the tab freezes/);
  assert.match(header, /two tries, ui\/staff\/form\.js checksStand/);
});

// SV2-53 item 5: the behaviour behind the header's rule. The page's one
// caller that asks again after a refusal is Publish (ui/staff/form.js,
// checksStand through standingProject). Here it runs against the real client
// on the main thread, where a run and its refusal are both microtasks, so a
// caller asking again from its own refusal without a bound would never let a
// timer fire. It asks CHECK_TRIES times and gives up; a stand-in for the
// page's askChecks counts, and stops a runaway at 50 so a broken bound fails
// here instead of hanging the suite.
test('Publish asks a project that cannot be checked twice and gives up: two runs, and the loop yields', async () => {
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: false });
  store.replace({ ...store.project, settings: null });
  let asked = 0;
  let ticked = false;
  setTimeout(() => { ticked = true; }, 0);
  const ask = () => {
    asked += 1;
    if (asked > 50) return Promise.resolve(true);
    return client.results().then(() => true, () => false);
  };
  const standing = await standingProject(() => store.project, ask, () => false);
  assert.equal(standing, null, 'no project stands: Publish refuses with its sentence');
  assert.equal(CHECK_TRIES, 2);
  assert.equal(asked, 2, 'asked twice, not from its own refusal without end');
  assert.deepEqual([client.stats.sent, client.stats.failed], [2, 2], 'two runs, both refused');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ticked, true, 'a timer fired: the main thread was let go');
  client.close();
});

test('a project that changes while it is asked about is asked about again, and that is not one of the tries', async () => {
  const store = storeOf(sampleSchool());
  const client = createEngineClient(store, { worker: false });
  let asked = 0;
  const ask = (project) => {
    asked += 1;
    const answer = client.results().then(() => true, () => false);
    // the first asking is overtaken by an edit
    if (asked === 1) store.apply(actions.renameFloor, { id: 'fsample001', name: 'Ground' });
    return answer;
  };
  const standing = await standingProject(() => store.project, ask, () => false);
  assert.equal(standing, store.project, 'the project as it is now stands');
  assert.equal(asked, 2);
  client.close();
});
