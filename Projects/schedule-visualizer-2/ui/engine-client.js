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
//     promise, pending or answered, so ten screens asking after one change
//     cost one run. A run that failed is not remembered: the next asking is
//     a new request. The pipeline itself keeps the routes while the geometry
//     counter stands still and runs only the transitions a change touched.
//
//     So a caller must not ask again from its own rejection handler. Each
//     asking after a failure is a new run, and a run that fails every time
//     (a project the pipeline cannot read) answers each one with another
//     rejection: with a worker that is a request posted for every answer, as
//     fast as the worker can refuse (152 in 200 ms, measured by the SV2-49
//     review); on the main thread the run and its rejection are both
//     microtasks, so the loop never yields and the tab freezes. Ask again on
//     the next change or the next press, or a bounded number of times, as the
//     publish form does (two tries, ui/staff/form.js checksStand). Keeping
//     the failed promise for the rest of its task would not help: a caller
//     asking again in its handler would get the same rejected promise and
//     loop on it instead. A run that fails after a newer change was asked
//     about is given to nobody: whoever waited on it is waiting on the newer
//     request already.
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
// asked, remembered, sent, answered, dropped, failed. `client.searches` is
// the distance fields searched on the main thread so far (null until a
// pipeline is made there).
//
// Two more lanes, for the scenario lab and the Fix… dialog, each with a
// pipeline of its own in the worker (or on the main thread, the same
// functions: scenarioRun and suggestRun in engine/worker.js), both sharing
// the main pipeline's route cache. The main lane above is not touched by
// them: its pipeline never sees a scenario or a suggestion.
//
//   const { result, compare } = await store.derived.scenario(options);
//     result    trimResult() of the project with its open scenario applied
//               (the changes reconcile keeps), { places, loads, walks,
//               findings, failedWalks }, worked out in the worker
//     compare   compareResults(main, result, options) (engine/scenario.js),
//               main being the main lane's result for the same counters,
//               trimmed the same way, and `changes` the changes applied, so
//               the edited groups are marked. options are compareResults'
//               own (dayTypeId, transition, measure, floorIds, limit).
//     also      changes (the changes applied), versions (the store's
//               counters it is for), where, generation
//     null when no scenario is open.
//   The run is remembered by the three counters and the identity of
//   project.scenario (a scenario action moves no counter, but every one
//   makes a new scenario object), and the comparison by its options too,
//   a Set among them read as its members sorted (compareResults reads
//   floorIds only as an array; a Set is handed on as one). Before a
//   comparison is made, its run is checked against the store as it is now,
//   counters and scenario both: a run for anything else is dropped and the
//   newest asked for, and with the scenario closed the answer is null. An
//   asking that finds no scenario open settles every earlier caller null
//   and drops the job they waited on, unworked.
//
//   const { suggestions, none } = await store.derived.suggest(findingId, options);
//     suggest() (engine/suggest.js) for the finding with that id in the main
//     lane's result for the same counters; options { otherTeachersRooms,
//     limit }. A finding that is not there is "No small change clears
//     this." without asking the worker. Also findingId, versions, where,
//     generation. Remembered by the counters, the id and the options.
//
// Both lanes follow the rules above: one request at a time, only the newest
// waits; a newer asking hands its answer to whoever waited on the older
// (a suggestion for another finding, asked before this one was answered,
// resolves null instead: nobody is showing it any more); an answer for
// counters the main lane has moved past is never given, the newest is; a
// failure is never remembered, and a caller must not ask again from its own
// rejection handler, for the same reason as above. A job is checked once
// more just before it is sent (or run here): one whose counters, or
// scenario, the store has moved past is dropped and asked again as the
// store is now, so a job at an older geometry never reaches the route cache
// the three pipelines share (it would empty it for the main lane). `client.laneStats`
// counts each lane: asked, remembered, sent, answered, dropped, failed.
//
// Two more lanes (ARCHITECTURE 21.2, 21.3, 21.10), each with its own wanted,
// flying and generation, its own counters and its own staleness check:
//
//   const { result, versions, where, generation } = await store.derived.kept(id, options);
//     id        the kept scenario's id; its object itself is taken too (the
//               one in project.scenarios), which reaches a scenario whose id
//               an older file repeated or left out
//     One job for each kept scenario object, asked together or alternately:
//     Promise.all([kept(A), kept(B)]) answers both, and the answer for each
//     object is remembered while the store's counters hold. They queue on
//     the one kept pipeline in the worker. Asked for nothing for KEPT_IDLE_MS,
//     the lane lets its pipeline go (answers stay), as does close().
//     result    trimResult() of the project as the kept scenario with that
//               id (one of project.scenarios) would make it: its changes
//               that still apply and its levers (scenarioProject), run with
//               its building levers as route options, worked out on a
//               pipeline of its own that shares the main lane's route cache.
//               The page compares it with compareResults(result, the open
//               scenario's result, ...): same building, so that works as it
//               is. options are not read: the answer does not depend on them.
//     versions  the store's counters it is for
//     null when no kept scenario has that id.
//   Remembered, for each scenario, by the three counters and the identity of that kept scenario
//   object (an action that changes a scenario makes a new object, so a
//   renamed or edited one is worked out again), never by its index. The lane
//   takes a schedule counter of its own that only goes up, one per new
//   job, and a levers counter that is the same for the same route options,
//   so the open scenario's runs and a kept one's never share incremental
//   work by mistake. A job is checked against the store before it is sent
//   and again when its answer comes: a store that has moved on, or a
//   scenarios list that no longer holds that very object, drops the answer,
//   and the newest is asked for (null when the scenario is gone). A failure
//   is not remembered, as everywhere here.
//
//   store.derived.setOther(project, fileName)   hold another building's project
//   const { result, where, generation, fileName } = await store.derived.other(options);
//   store.derived.closeOther()                  let it go
//     The building comparison's other side (21.3): trimResult() of the other
//     project as it is, on a pipeline whose route cache is its own and
//     whose counters are the comparison's number (1, 2, 3 ...), so its
//     routes are never served for the open project's. The worker is sent
//     the project once per comparison, and told to free it (OTHER_CLOSE)
//     when the comparison ends. other() is null while none is held; an
//     answer for a comparison that has ended or been replaced is dropped
//     and its callers get null. options are not read. The main lane and
//     the store are not touched: the other project is view state.

import {
  createPipeline, unpack, scenarioRun, suggestRun, keptRun, otherRun,
  REQUEST, ANSWER, READY, SCENARIO_REQUEST, SCENARIO_ANSWER, SUGGEST_REQUEST, SUGGEST_ANSWER,
  KEPT_REQUEST, KEPT_ANSWER, KEPT_CLOSE, OTHER_REQUEST, OTHER_ANSWER, OTHER_CLOSE,
} from '../engine/worker.js';
import { reconcile, trimResult, compareResults, leverRouteOptions, leverOptionsKey, keptScenarios, SCENARIOS_MOST } from '../engine/scenario.js';
import { NO_SUGGESTION } from '../engine/suggest.js';

// How long a new worker has to say it has loaded before it is given up on.
export const READY_WAIT_MS = 10000;

// How long the kept lane may go with no kept scenario asked for before its
// pipeline (the held run, on this side and in the worker) is let go.
export const KEPT_IDLE_MS = 30000;

const clients = new WeakMap();

function stampOf(versions) {
  return versions ? versions.geometry + ':' + versions.building + ':' + versions.schedule : '';
}

// compareResults' options as given, with every Set made a sorted array: a
// Set is read as the list it holds (compareResults reads only arrays), and
// two Sets are two keys (JSON.stringify writes every Set as {}).
function optionsKeyed(options) {
  const given = options || {};
  const out = {};
  for (const name of Object.keys(given)) {
    const value = given[name];
    out[name] = value instanceof Set ? Array.from(value).sort() : value;
  }
  return out;
}

function laneCounts() {
  return { asked: 0, remembered: 0, sent: 0, answered: 0, dropped: 0, failed: 0 };
}

// Where a finding with this id is in a main-lane result, counted or accepted.
function findingIn(result, findingId) {
  const checked = result && result.findings;
  for (const list of checked ? [checked.findings, checked.accepted] : []) {
    for (const finding of Array.isArray(list) ? list : []) if (finding && finding.id === findingId) return finding;
  }
  return null;
}

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

  // the scenario and suggestion lanes: { wanted, flying, generation, stats }
  const lanes = {
    scenario: { request: SCENARIO_REQUEST, answer: SCENARIO_ANSWER, wanted: null, flying: null, generation: 0, stats: laneCounts() },
    suggest: { request: SUGGEST_REQUEST, answer: SUGGEST_ANSWER, wanted: null, flying: null, generation: 0, stats: laneCounts() },
    kept: { request: KEPT_REQUEST, answer: KEPT_ANSWER, wanted: null, flying: null, generation: 0, stats: laneCounts() },
    other: { request: OTHER_REQUEST, answer: OTHER_ANSWER, wanted: null, flying: null, generation: 0, stats: laneCounts(), projectSentFor: null },
  };
  let localScenario = null;
  let localSuggest = null;
  let localKept = null;
  let localOther = null;
  // the kept lane's jobs, one for each kept scenario object (never its id:
  // an older file may repeat one or have none), the newest answer or the
  // job still being worked out; never more than SCENARIOS_MOST
  const keptJobs = new Map();
  let keptIdleTimer = null;
  // the kept lane's own counters: the schedule counter goes up with each new
  // job (a new job is for new counters or a new scenario object, or follows
  // a failure), and the levers counter is one number per distinct route
  // options, so a kept scenario's runs under the same options keep what they share.
  // keptLevers gets one entry for each distinct route-options key this client
  // has seen and never shrinks: the keys are the combinations of building
  // levers the page's kept scenarios have, a handful, and the numbers must stay
  // the same for the same options for as long as the client lives (a number
  // reused for other options would let a run take another's routes), so there
  // is nothing safe to forget. The counters mean nothing outside this client.
  let keptCounter = 0;
  const keptLevers = new Map([['', 0]]);
  // the searches of route caches already let go, so client.searches only goes up
  let searchesReleased = 0;
  let cachesReleased = false;
  // the comparison held, if any: { comparison, project, fileName }
  let otherHeld = null;
  let otherComparison = 0;
  // the scenario lane's own schedule counter: it moves when the store's
  // counters do or project.scenario is another object
  const scenarioIds = new WeakMap();
  let scenarioIdNext = 0;
  let scenarioKey = null;
  let scenarioCounter = 0;
  // the scenario lane's fourth counter (ARCHITECTURE 18.3): it moves when the
  // building levers' route options do, so the lane's transition results are
  // never served across a closure. The geometry counter stays the store's:
  // the three lanes share one route cache and one stamp.
  let leversKey = '';
  let leversCounter = 0;

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
    job.failed = true;
    stats.failed += 1;
    job.reject(error);
  }

  function localMain() {
    if (!local) local = createPipeline();
    return local;
  }

  function runHere(job) {
    localMain();
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

  function laneSettle(lane, job, value) {
    job.settled = true;
    job.resolve({ ...value, project: job.project, storeVersions: job.storeVersions, scenario: job.scenario, comparison: job.comparison });
  }

  function laneFail(lane, job, error) {
    // the worker no longer holds the other project (it says so): the retry carries it
    if (lane === lanes.other && error && /was not sent/.test(String(error.message))) lane.projectSentFor = null;
    job.settled = true;
    job.failed = true;
    lane.stats.failed += 1;
    job.reject(error);
  }

  // A pipeline about to be let go: its route cache's searches are kept in a
  // running total unless another pipeline here still holds that cache.
  function release(pipeline) {
    if (!pipeline) return;
    cachesReleased = true;
    const rest = [local, localScenario, localSuggest, localKept, localOther].filter((one) => one && one !== pipeline);
    if (!rest.some((one) => one.cache === pipeline.cache)) searchesReleased += pipeline.cache.searches;
  }

  // The jobs of a lane that are not settled, and the one to send next (the
  // kept lane has one for each scenario, the oldest asked first).
  function liveJobs(lane) {
    if (lane === lanes.kept) return Array.from(keptJobs.values()).filter((job) => !job.settled);
    return lane.wanted && !lane.wanted.settled ? [lane.wanted] : [];
  }

  function nextJob(lane) {
    if (lane !== lanes.kept) return lane.wanted;
    let next = null;
    for (const job of liveJobs(lane)) if (!job.sent && (next === null || job.generation < next.generation)) next = job;
    return next;
  }

  function isWanted(lane, job) {
    return lane === lanes.kept ? keptJobs.get(job.scenario) === job : lane.wanted === job;
  }

  function runLaneHere(lane, job) {
    try {
      let answer;
      if (lane === lanes.scenario) {
        if (!localScenario) localScenario = createPipeline({ cache: localMain().cache });
        try {
          answer = scenarioRun(localScenario, job.project, job.versions);
        } catch (error) {
          localScenario.clear();
          throw error;
        }
      } else if (lane === lanes.kept) {
        if (!localKept) localKept = createPipeline({ cache: localMain().cache });
        try {
          answer = keptRun(localKept, job.project, job.scenario, job.versions);
        } catch (error) {
          localKept.clear();
          throw error;
        }
      } else if (lane === lanes.other) {
        // a cache of its own: the other building's routes are never the open project's
        if (!localOther) localOther = createPipeline();
        try {
          answer = otherRun(localOther, job.project, job.versions);
        } catch (error) {
          localOther.clear();
          throw error;
        }
      } else {
        if (!localSuggest) localSuggest = createPipeline({ cache: localMain().cache });
        try {
          answer = suggestRun(localSuggest, job.project, job.versions, job.finding, job.options);
        } catch (error) {
          localSuggest.clear();
          throw error;
        }
      }
      lane.stats.answered += 1;
      laneSettle(lane, job, { answer, where: 'main', generation: job.generation });
    } catch (error) {
      laneFail(lane, job, error);
    }
  }

  // Is this lane job for the store as it is? Its counters, and for the
  // scenario lane the identity of project.scenario too.
  function laneCurrent(lane, job) {
    // the other building is view state: it does not move with the store
    if (lane === lanes.other) return otherHeld !== null && otherHeld.comparison === job.comparison;
    if (stampOf(job.storeVersions) !== stampOf(currentVersions())) return false;
    // a kept answer is for that very object, wherever it now is in the list
    if (lane === lanes.kept) return keptScenarios(store.project).includes(job.scenario);
    return lane !== lanes.scenario || store.project.scenario === job.project.scenario;
  }

  // A job about to be worked out for a store that has moved on is dropped,
  // and the lane asked again as the store is now; with no scenario open, the
  // scenario lane's callers get null. Never sent: a job at an older geometry
  // would reset the route cache all three pipelines share.
  function dropStale(lane, job) {
    if (laneCurrent(lane, job)) return false;
    lane.stats.dropped += 1;
    if (lane === lanes.scenario) askScenario();
    else if (lane === lanes.kept) askKept(job.scenario, job.given);
    else if (lane !== lanes.other) client.suggest(job.findingId, job.given);
    // the asking above settles the job (laneJob) when it makes a new one;
    // when it makes none (no scenario open, no such kept scenario, the other
    // comparison ended) the job is settled null here, and never asked again
    // as it was
    if (!job.settled) {
      job.settled = true;
      job.dead = true;
      job.resolve(null);
      if (lane === lanes.kept) {
        if (isWanted(lane, job)) keptJobs.delete(job.scenario);
      } else if (lane.wanted === job) lane.wanted = null;
    }
    return true;
  }

  // What a lane's job is sent as. The other building's project goes once per
  // comparison, with the first request; the worker keeps it.
  function laneMessage(lane, job) {
    const base = { type: lane.request, generation: job.generation, versions: job.versions };
    if (lane === lanes.kept) return { ...base, project: job.project, scenario: job.scenario };
    if (lane === lanes.other) return lane.projectSentFor === job.comparison ? { ...base, comparison: job.comparison } : { ...base, comparison: job.comparison, project: job.project };
    return { ...base, project: job.project, finding: job.finding, options: job.options };
  }

  function pumpLane(lane) {
    const job = nextJob(lane);
    if (closed || !job || job.settled || job.sent || !job.ready) return;
    if (where === 'main') {
      if (dropStale(lane, job)) return;
      job.sent = true;
      lane.stats.sent += 1;
      Promise.resolve().then(() => {
        if (!isWanted(lane, job) || closed || job.settled) return;
        if (dropStale(lane, job)) return;
        runLaneHere(lane, job);
      });
      return;
    }
    if (lane.flying !== null) return;
    if (dropStale(lane, job)) return;
    job.sent = true;
    lane.flying = job.generation;
    lane.stats.sent += 1;
    try {
      worker.postMessage(laneMessage(lane, job));
      if (lane === lanes.other) lane.projectSentFor = job.comparison;
    } catch (error) {
      giveUpOnWorker('The project could not be sent to the worker: ' + error.message);
    }
  }

  // A new job on a lane: the one before it, if still waiting, gets this
  // one's answer when it is about the same thing, and null when not.
  function laneJob(lane, fields) {
    lane.generation += 1;
    const job = { ...fields, generation: lane.generation, sent: false, settled: false, failed: false };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    const older = lane === lanes.kept ? keptJobs.get(fields.scenario) : lane.wanted;
    if (older && !older.settled) {
      older.settled = true;
      older.resolve(older.subject === job.subject ? job.promise : null);
    }
    if (lane === lanes.kept) {
      // the newest last, so the oldest answers go first when there are too many
      keptJobs.delete(fields.scenario);
      keptJobs.set(fields.scenario, job);
    } else {
      lane.wanted = job;
    }
    return job;
  }

  function onLaneMessage(lane, message) {
    if (message.generation !== lane.flying) return;
    lane.flying = null;
    const job = liveJobs(lane).find((one) => one.generation === message.generation) || null;
    if (message.ok !== true) {
      if (job) laneFail(lane, job, new Error(message.error));
      else lane.stats.dropped += 1;
    } else {
      lane.stats.answered += 1;
      if (job) laneSettle(lane, job, { answer: message.answer, where: 'worker', generation: message.generation });
      else lane.stats.dropped += 1;
    }
    pumpLane(lane);
  }

  function currentVersions() {
    return { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
  }

  // The scenario lane's job for the store as it is now: the one wanted
  // already when it is for these counters and this scenario, else a new one.
  // With no scenario open, null, and a job still waiting is settled null
  // and never worked out.
  function askScenario() {
    const lane = lanes.scenario;
    const project = store.project;
    if (!project.scenario) {
      const older = lane.wanted;
      if (older && !older.settled) {
        older.settled = true;
        older.resolve(null);
        // one already with the worker is counted when its answer comes
        if (!older.sent || where === 'main') lane.stats.dropped += 1;
      }
      lane.wanted = null;
      return null;
    }
    const versions = currentVersions();
    if (!scenarioIds.has(project.scenario)) {
      scenarioIdNext += 1;
      scenarioIds.set(project.scenario, scenarioIdNext);
    }
    const key = stampOf(versions) + '|' + scenarioIds.get(project.scenario);
    const held = lane.wanted;
    if (held && held.key === key && !held.failed) {
      lane.stats.remembered += 1;
      return held;
    }
    if (key !== scenarioKey) {
      scenarioKey = key;
      scenarioCounter += 1;
      // a project the lane cannot read is a failure of the lane's own answer,
      // as it always was; it has no route options to key here
      let optionsKey = '';
      try {
        optionsKey = leverOptionsKey(leverRouteOptions(project, reconcile(project, project.scenario).levers));
      } catch (error) {
        optionsKey = '';
      }
      if (optionsKey !== leversKey) {
        leversKey = optionsKey;
        leversCounter += 1;
      }
    }
    const job = laneJob(lane, {
      key,
      subject: 'scenario',
      project,
      storeVersions: versions,
      versions: { geometry: versions.geometry, building: versions.building, schedule: scenarioCounter, levers: leversCounter },
      ready: true,
      compares: new Map(),
    });
    pumpLane(lane);
    return job;
  }

  // The kept lane's job for a kept scenario (its id, or that very object),
  // for the store as it is now: the one held for that object already when it
  // is for these counters, else a new one; null when no kept scenario is
  // that. Jobs for other scenarios are left as they are: each has its own.
  function askKept(ref, given) {
    if (closed) return null;
    const lane = lanes.kept;
    const project = store.project;
    const list = keptScenarios(project);
    let scenario;
    if (typeof ref === 'string') scenario = list.find((kept) => kept && kept.id === ref);
    else if (ref !== null && typeof ref === 'object' && list.includes(ref)) scenario = ref;
    if (!scenario) return null;
    // a settled job for an object that has left the list is let go; too many, the oldest settled
    for (const [object, one] of keptJobs) if (one.settled && !list.includes(object)) keptJobs.delete(object);
    const room = keptJobs.has(scenario) ? SCENARIOS_MOST : SCENARIOS_MOST - 1;
    for (const [object, one] of keptJobs) {
      if (keptJobs.size <= room) break;
      if (one.settled && object !== scenario) keptJobs.delete(object);
    }
    touchKept();
    const versions = currentVersions();
    if (!scenarioIds.has(scenario)) {
      scenarioIdNext += 1;
      scenarioIds.set(scenario, scenarioIdNext);
    }
    const key = stampOf(versions) + '|' + scenarioIds.get(scenario);
    const held = keptJobs.get(scenario);
    if (held && held.key === key && !held.failed && !held.dead) {
      lane.stats.remembered += 1;
      return held;
    }
    keptCounter += 1;
    // a scenario the lane cannot read fails in the lane's own answer; it has no route options to key here
    let optionsKey = '';
    try {
      optionsKey = leverOptionsKey(leverRouteOptions(project, reconcile(project, scenario).levers));
    } catch (error) {
      optionsKey = '';
    }
    if (!keptLevers.has(optionsKey)) keptLevers.set(optionsKey, keptLevers.size);
    const job = laneJob(lane, {
      key,
      subject: 'kept',
      given,
      scenario,
      project,
      storeVersions: versions,
      versions: { geometry: versions.geometry, building: versions.building, schedule: keptCounter, levers: keptLevers.get(optionsKey) },
      ready: true,
    });
    job.answered = job.promise.then((run) => {
      // the idle time counts from the answer, not from the asking: a run can take longer than it
      touchKept();
      if (run === null) return null;
      // the store has moved on since this was worked out, its counters or
      // the list that held the scenario: the newest instead, null if it is gone
      if (stampOf(run.storeVersions) !== stampOf(currentVersions()) || !keptScenarios(store.project).includes(run.scenario)) {
        lane.stats.dropped += 1;
        const again = askKept(run.scenario, given);
        return again ? again.answered : null;
      }
      return { result: run.answer, versions: run.storeVersions, where: run.where, generation: run.generation };
    });
    pumpLane(lane);
    return job;
  }

  // The kept lane was asked for something just now: it may keep its pipeline
  // for KEPT_IDLE_MS more (options.keptIdle, for the tests). When the time is
  // up with a job still waiting, it waits again.
  function touchKept() {
    if (closed) return;
    if (keptIdleTimer !== null) clearTimeout(keptIdleTimer);
    const wait = Number.isFinite(opts.keptIdle) ? opts.keptIdle : KEPT_IDLE_MS;
    keptIdleTimer = setTimeout(() => {
      keptIdleTimer = null;
      if (closed) return;
      if (liveJobs(lanes.kept).length > 0) {
        touchKept();
        return;
      }
      releaseKept();
    }, wait);
    if (keptIdleTimer && typeof keptIdleTimer.unref === 'function') keptIdleTimer.unref();
  }

  // The kept pipeline's held run is let go here and in the worker. The
  // answers stay (small, and what the page asks again for); the next job
  // makes the pipeline again.
  function releaseKept() {
    release(localKept);
    localKept = null;
    if (worker && where === 'worker') {
      try {
        worker.postMessage({ type: KEPT_CLOSE });
      } catch (error) {
        giveUpOnWorker('A message could not be sent to the worker: ' + error.message);
      }
    }
  }

  // The comparison ends: a job waiting is settled null and never worked out,
  // the worker is told to let the other project go, and so is this side.
  function endOther() {
    const lane = lanes.other;
    const older = lane.wanted;
    if (older && !older.settled) {
      older.settled = true;
      older.resolve(null);
      // one already with the worker is counted when its answer comes
      if (!older.sent || where === 'main') lane.stats.dropped += 1;
    }
    lane.wanted = null;
    lane.projectSentFor = null;
    otherHeld = null;
    if (worker && where === 'worker') {
      try {
        worker.postMessage({ type: OTHER_CLOSE });
      } catch (error) {
        giveUpOnWorker('A message could not be sent to the worker: ' + error.message);
      }
    }
    release(localOther);
    localOther = null;
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
    for (const lane of Object.values(lanes)) {
      lane.flying = null;
      for (const job of liveJobs(lane)) job.sent = false;
    }
    if (typeof opts.onFallback === 'function') opts.onFallback(reason);
    pump();
    for (const lane of Object.values(lanes)) {
      // on this side each pump sends one job: the kept lane may have a job for each scenario
      for (let more = 0; more < 2 * SCENARIOS_MOST && nextJob(lane); more += 1) pumpLane(lane);
    }
  }

  function onMessage(event) {
    const message = event.data;
    if (message && (message.type === READY || message.type === ANSWER || message.type === SCENARIO_ANSWER || message.type === SUGGEST_ANSWER || message.type === KEPT_ANSWER || message.type === OTHER_ANSWER)) stopWaitingForReady();
    if (message && message.type === KEPT_ANSWER) return onLaneMessage(lanes.kept, message);
    if (message && message.type === OTHER_ANSWER) return onLaneMessage(lanes.other, message);
    if (message && message.type === SCENARIO_ANSWER) return onLaneMessage(lanes.scenario, message);
    if (message && message.type === SUGGEST_ANSWER) return onLaneMessage(lanes.suggest, message);
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
    // Distance fields searched on this side so far, by the pipelines here
    // (they share one route cache, counted once), and by one let go (the
    // other building's, a closed comparison's): it never goes down. Null while none is made.
    get searches() {
      const caches = new Set([local, localScenario, localSuggest, localKept, localOther].filter(Boolean).map((pipeline) => pipeline.cache));
      if (caches.size === 0 && !cachesReleased) return null;
      return searchesReleased + Array.from(caches).reduce((sum, cache) => sum + cache.searches, 0);
    },
    get laneStats() {
      return { scenario: lanes.scenario.stats, suggest: lanes.suggest.stats, kept: lanes.kept.stats, other: lanes.other.stats };
    },
    // A promise for the result of the store's project as it is now.
    results() {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      stats.asked += 1;
      const versions = { geometry: store.geometryVersion, building: store.buildingVersion, schedule: store.scheduleVersion };
      const stamp = versions.geometry + ':' + versions.building + ':' + versions.schedule;
      // a run that failed is asked again, never remembered: a failure can pass
      if (wanted && wanted.stamp === stamp && !wanted.failed) {
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
    // The open scenario worked out, and compared with the real schedule.
    // The shape is in the header.
    scenario(options) {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      const lane = lanes.scenario;
      lane.stats.asked += 1;
      const asked = optionsKeyed(options);
      delete asked.changes;
      const job = askScenario();
      if (!job) return Promise.resolve(null);
      const askedKey = JSON.stringify(asked);
      const held = job.compares.get(askedKey);
      if (held) return held;
      const promise = job.promise.then((run) => (run === null ? null : client.results().then((main) => {
        // the store has moved on since this was worked out, its counters or
        // its scenario: the newest instead, or null when the scenario is closed
        if (stampOf(main.versions) !== stampOf(run.storeVersions) || stampOf(main.versions) !== stampOf(currentVersions()) || store.project.scenario !== run.project.scenario) {
          lane.stats.dropped += 1;
          return client.scenario(options);
        }
        const kept = reconcile(run.project, run.project.scenario);
        const changes = kept.changes;
        // the levers too, so a head-count or a staggered dismissal marks its groups
        const compare = compareResults(trimResult(main), run.answer, { ...asked, changes, levers: kept.levers || [] });
        return { result: run.answer, compare, changes, levers: kept.levers || [], versions: run.storeVersions, where: run.where, generation: run.generation };
      })));
      job.compares.set(askedKey, promise);
      // a comparison that failed is not remembered either
      promise.catch(() => {
        if (job.compares.get(askedKey) === promise) job.compares.delete(askedKey);
      });
      return promise;
    },
    // Suggestions for the finding with this id. The shape is in the header.
    suggest(findingId, options) {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      const lane = lanes.suggest;
      lane.stats.asked += 1;
      const given = options || {};
      const asked = { otherTeachersRooms: given.otherTeachersRooms === true, limit: Number.isInteger(given.limit) ? given.limit : null };
      const versions = currentVersions();
      const stamp = stampOf(versions);
      const subject = JSON.stringify([findingId, asked.otherTeachersRooms, asked.limit]);
      const key = stamp + '|' + subject;
      if (lane.wanted && lane.wanted.key === key && !lane.wanted.failed) {
        lane.stats.remembered += 1;
        return lane.wanted.answered;
      }
      const job = laneJob(lane, { key, stamp, subject, findingId, given: options, project: store.project, storeVersions: versions, versions, options: asked, finding: null, ready: false });
      job.answered = job.promise.then((run) => (run === null ? null : { ...run.answer, findingId, versions: run.storeVersions, where: run.where, generation: run.generation }));
      // the finding is the main lane's, for the same counters
      client.results().then((main) => {
        if (job.settled || closed) return;
        if (stampOf(main.versions) !== job.stamp) {
          // the store has moved on: the newest instead, which this job waits on
          lane.stats.dropped += 1;
          client.suggest(findingId, options);
          return;
        }
        const finding = findingIn(main, findingId);
        if (!finding) {
          laneSettle(lane, job, { answer: { suggestions: [], none: NO_SUGGESTION }, where, generation: job.generation });
          return;
        }
        job.finding = finding;
        job.ready = true;
        pumpLane(lane);
      }, (error) => {
        if (!job.settled) laneFail(lane, job, error);
      });
      return job.answered;
    },
    // The kept scenario with this id worked out. The shape is in the header.
    kept(id, options) {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      lanes.kept.stats.asked += 1;
      const job = askKept(id, options);
      return job ? job.answered : Promise.resolve(null);
    },
    // Hold another building's project for a comparison, replacing one held.
    setOther(project, fileName) {
      if (closed) throw new Error('This engine client has been closed.');
      if (!project || typeof project !== 'object') throw new TypeError('setOther needs the other project.');
      if (otherHeld) endOther();
      otherComparison += 1;
      otherHeld = { comparison: otherComparison, project, fileName: typeof fileName === 'string' ? fileName : '' };
      return otherComparison;
    },
    // The comparison is over: let the other project go. Harmless when none is held.
    closeOther() {
      if (closed || !otherHeld) return;
      endOther();
    },
    // The other building worked out. The shape is in the header.
    other(options) {
      if (closed) return Promise.reject(new Error('This engine client has been closed.'));
      const lane = lanes.other;
      lane.stats.asked += 1;
      if (!otherHeld) return Promise.resolve(null);
      const held = lane.wanted;
      if (held && held.comparison === otherHeld.comparison && !held.failed && !held.dead) {
        lane.stats.remembered += 1;
        return held.answered;
      }
      const comparison = otherHeld.comparison;
      const fileName = otherHeld.fileName;
      const job = laneJob(lane, {
        key: 'other:' + comparison,
        subject: 'other:' + comparison,
        comparison,
        project: otherHeld.project,
        storeVersions: null,
        // the comparison's own number in all three, counting up from 1: never the store's
        versions: { geometry: comparison, building: comparison, schedule: comparison },
        ready: true,
      });
      job.answered = job.promise.then((run) => {
        if (run === null) return null;
        if (otherHeld === null || otherHeld.comparison !== run.comparison) {
          lane.stats.dropped += 1;
          return null;
        }
        return { result: run.answer, where: run.where, generation: run.generation, fileName };
      });
      pumpLane(lane);
      return job.answered;
    },
    close() {
      if (closed) return;
      closed = true;
      stopWaitingForReady();
      if (worker) worker.terminate();
      worker = null;
      if (wanted && !wanted.settled) fail(wanted, new Error('This engine client has been closed.'));
      for (const lane of Object.values(lanes)) {
        for (const job of liveJobs(lane)) laneFail(lane, job, new Error('This engine client has been closed.'));
      }
      if (keptIdleTimer !== null) clearTimeout(keptIdleTimer);
      keptIdleTimer = null;
      // let everything held go: the comparison, the pipelines, the answers
      endOther();
      release(localKept);
      localKept = null;
      keptJobs.clear();
      if (store.derived.engine === client) store.derived.use(null);
      if (clients.get(store) === client) clients.delete(store);
    },
  };
  return client;
}

// store.derived.scenario(options), store.derived.suggest(findingId,
// options), store.derived.kept(id, options), store.derived.other(options),
// setOther(project, fileName) and closeOther(), beside store.derived.results(): each asks the engine attached
// with use(), and refuses in the same words while none is. engine/store.js
// is not this file's, so they are put on the store's derived object here,
// once, on the first engineFor().
const NOTHING_ATTACHED = 'Nothing is attached to work out routes and findings. Call engineFor(store) from ui/engine-client.js first.';

function addLanes(derived) {
  if (typeof derived.scenario !== 'function') {
    derived.scenario = (options) => (derived.engine && typeof derived.engine.scenario === 'function' ? derived.engine.scenario(options) : Promise.reject(new Error(NOTHING_ATTACHED)));
  }
  if (typeof derived.suggest !== 'function') {
    derived.suggest = (findingId, options) => (derived.engine && typeof derived.engine.suggest === 'function' ? derived.engine.suggest(findingId, options) : Promise.reject(new Error(NOTHING_ATTACHED)));
  }
  if (typeof derived.kept !== 'function') {
    derived.kept = (id, options) => (derived.engine && typeof derived.engine.kept === 'function' ? derived.engine.kept(id, options) : Promise.reject(new Error(NOTHING_ATTACHED)));
  }
  if (typeof derived.other !== 'function') {
    derived.other = (options) => (derived.engine && typeof derived.engine.other === 'function' ? derived.engine.other(options) : Promise.reject(new Error(NOTHING_ATTACHED)));
  }
  if (typeof derived.setOther !== 'function') {
    derived.setOther = (project, fileName) => {
      if (!derived.engine || typeof derived.engine.setOther !== 'function') throw new Error(NOTHING_ATTACHED);
      return derived.engine.setOther(project, fileName);
    };
  }
  if (typeof derived.closeOther !== 'function') {
    derived.closeOther = () => {
      if (derived.engine && typeof derived.engine.closeOther === 'function') derived.engine.closeOther();
    };
  }
}

// The store's engine client, made and attached to store.derived on the first
// call. Options count only on that first call.
export function engineFor(store, options) {
  let client = clients.get(store);
  if (!client) {
    client = createEngineClient(store, options);
    clients.set(store, client);
    store.derived.use(client);
    addLanes(store.derived);
  }
  return client;
}
