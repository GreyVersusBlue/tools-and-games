// The page's side of the derived pipeline (engine/worker.js): asks for the
// routes, crowd results, loads, places, walk results and findings of the
// store's project, and hands them to whoever reads store.derived.results().
//
//   import { engineFor } from './engine-client.js';
//   engineFor(store);                       // once; safe to call again
//   const result = await store.derived.results();
//   result.findings.findings, result.routes, result.crowd, result.loads …
//   result.where                            'worker' or 'main'
//
// The work runs in a module worker, so the drawing surface stays instant
// while a whole school is routed. Where a module worker cannot be had (Node,
// an older browser, a worker that fails to load or throws) the same pipeline
// runs on the main thread instead, and `client.where` says which. A worker
// that has not said it is loaded after 10 seconds is given up on too: a
// worker whose imports never arrive raises no error, and without the limit
// nobody waiting on it would ever be answered.
//
// What this file adds to the pipeline:
//
//   Remembering. results() for counters already asked about is the same
//     promise, pending or settled, so ten screens asking after one change
//     cost one run. The pipeline itself keeps the routes while the geometry
//     counter stands still and runs only the transitions a change touched.
//   One request at a time. While the worker is busy a newer request waits,
//     and only the newest waits: three keystrokes during one run cost two
//     runs, not four.
//   Stale answers are dropped. Every request carries a generation number.
//     An answer whose number is not the newest request's is never given to
//     a caller; whoever was waiting on the older request gets the newest
//     answer when it comes. (Its parts are still kept on this side, because
//     the worker's next answer leaves out what it has already sent.)
//
// `client.stats` counts what happened, for the tests and the console:
// asked, remembered, sent, answered, dropped, failed.

import { createPipeline, unpack, REQUEST, ANSWER, READY } from '../engine/worker.js';

// How long a new worker has to say it has loaded before it is given up on.
export const READY_WAIT_MS = 10000;

const clients = new WeakMap();

function startWorker() {
  return new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
}

// options.worker: leave out to use a module worker where there is one;
//   false for the main thread; or a function that returns something with
//   postMessage, addEventListener and terminate (the tests' stand-in).
// options.onFallback(reason): called once if the worker is given up on.
// options.readyWait: milliseconds to wait for the worker to load (10000).
export function createEngineClient(store, options) {
  const opts = options || {};
  const stats = { asked: 0, remembered: 0, sent: 0, answered: 0, dropped: 0, failed: 0 };
  let worker = null;
  let local = null;
  let where = 'main';
  let fallback = null; // why the worker was given up on, when it was
  let generation = 0;
  let wanted = null; // the newest request
  let flying = null; // the generation the worker is working on
  let mirror = null; // the result the worker's last answer stood for
  let closed = false;
  let readyTimer = null;

  function stopWaitingForReady() {
    if (readyTimer !== null) clearTimeout(readyTimer);
    readyTimer = null;
  }

  function settle(job, result) {
    job.settled = true;
    job.resolve(result);
  }

  function fail(job, error) {
    job.settled = true;
    stats.failed += 1;
    job.reject(error);
  }

  function runHere(job) {
    if (!local) local = createPipeline();
    try {
      const result = local.run(job.project, job.versions);
      stats.answered += 1;
      settle(job, { ...result, where: 'main', generation: job.generation });
    } catch (error) {
      local.clear();
      fail(job, error);
    }
  }

  function pump() {
    if (closed || !wanted || wanted.settled || wanted.sent) return;
    const job = wanted;
    if (where === 'main') {
      job.sent = true;
      stats.sent += 1;
      // after the caller's own turn, so results() never blocks the line that asked
      Promise.resolve().then(() => {
        if (job === wanted && !closed) runHere(job);
      });
      return;
    }
    if (flying !== null) return;
    job.sent = true;
    flying = job.generation;
    stats.sent += 1;
    try {
      worker.postMessage({ type: REQUEST, generation: job.generation, project: job.project, versions: job.versions });
    } catch (error) {
      giveUpOnWorker('The project could not be sent to the worker: ' + error.message);
    }
  }

  function giveUpOnWorker(reason) {
    if (where === 'main') return;
    stopWaitingForReady();
    where = 'main';
    fallback = reason;
    flying = null;
    mirror = null;
    if (worker) {
      try {
        worker.terminate();
      } catch (error) { /* it is gone either way */ }
      worker = null;
    }
    if (wanted && !wanted.settled) wanted.sent = false;
    if (typeof opts.onFallback === 'function') opts.onFallback(reason);
    pump();
  }

  function onMessage(event) {
    const message = event.data;
    if (message && (message.type === READY || message.type === ANSWER)) stopWaitingForReady();
    if (!message || message.type !== ANSWER || message.generation !== flying) return;
    flying = null;
    const job = wanted && wanted.generation === message.generation ? wanted : null;
    if (message.ok !== true) {
      // the worker forgot everything when it failed, and so does this side
      mirror = null;
      if (job) fail(job, new Error(message.error));
      else stats.dropped += 1;
      pump();
      return;
    }
    try {
      mirror = unpack(message.answer, mirror);
    } catch (error) {
      giveUpOnWorker(error.message);
      return;
    }
    stats.answered += 1;
    if (job) settle(job, { ...mirror, where: 'worker', generation: message.generation });
    else stats.dropped += 1;
    pump();
  }

  if (opts.worker !== false) {
    try {
      worker = typeof opts.worker === 'function' ? opts.worker() : typeof Worker === 'function' ? startWorker() : null;
    } catch (error) {
      worker = null;
      fallback = 'The worker could not be started: ' + error.message;
    }
    if (worker) {
      where = 'worker';
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        giveUpOnWorker('The worker stopped: ' + (event && event.message ? event.message : 'it could not be loaded'));
      });
      worker.addEventListener('messageerror', () => giveUpOnWorker('An answer from the worker could not be read.'));
      const wait = Number.isFinite(opts.readyWait) ? opts.readyWait : READY_WAIT_MS;
      readyTimer = setTimeout(() => {
        readyTimer = null;
        giveUpOnWorker('The worker had not loaded after ' + wait + ' ms.');
      }, wait);
      // in Node (the tests) a pending timer must not keep the process alive
      if (readyTimer && typeof readyTimer.unref === 'function') readyTimer.unref();
    }
  }

  const client = {
    stats,
    get where() {
      return where;
    },
    get fallback() {
      return fallback;
    },
    // A promise for the result of the store's project as it is now.
    results() {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      stats.asked += 1;
      const versions = { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
      const stamp = versions.geometry + ':' + versions.building + ':' + versions.schedule;
      if (wanted && wanted.stamp === stamp) {
        stats.remembered += 1;
        return wanted.promise;
      }
      generation += 1;
      const job = { stamp, generation, versions, project: store.project, sent: false, settled: false };
      job.promise = new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
      });
      // whoever is still waiting on the older request gets this one's answer
      if (wanted && !wanted.settled) {
        wanted.settled = true;
        wanted.resolve(job.promise);
      }
      wanted = job;
      pump();
      return job.promise;
    },
    close() {
      if (closed) return;
      closed = true;
      stopWaitingForReady();
      if (worker) worker.terminate();
      worker = null;
      if (wanted && !wanted.settled) fail(wanted, new Error('This engine client has been closed.'));
      if (store.derived.engine === client) store.derived.use(null);
      if (clients.get(store) === client) clients.delete(store);
    },
  };
  return client;
}

// The store's engine client, made and attached to store.derived on the first
// call. Options count only on that first call.
export function engineFor(store, options) {
  let client = clients.get(store);
  if (!client) {
    client = createEngineClient(store, options);
    clients.set(store, client);
    store.derived.use(client);
  }
  return client;
}
