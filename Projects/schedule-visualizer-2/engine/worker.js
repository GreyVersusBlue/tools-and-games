// The derived pipeline, and the Web Worker that runs it.
//
// Everything the tool works out from a project and never stores: the routes,
// the crowd results, the loads, the places, the walk results and the two
// lists of findings. One function works them all out in order, and it is the
// same function in the worker, on the main thread (the tests, the staff
// browser, a browser with no module workers) and in Node.
//
//   const pipeline = createPipeline();
//   const result = pipeline.run(project, { geometry, building, schedule });
//   const beside = createPipeline({ cache: pipeline.cache });
//
// The three numbers are the store's counters (store.geometryVersion,
// .buildingVersion, .scheduleVersion). A pipeline remembers its last answer
// and works out again only what the counters say could have changed:
//
//   routes and distance fields   kept while geometry is the same (a new
//                                schedule is routed again from the kept
//                                fields, which searches nothing)
//   places, building findings    kept while building is the same
//   a transition's crowd result  kept while geometry is the same, by what
//                                the transition is: the walkers going the
//                                same ways with the same head counts, the
//                                margin and the passing time, never the day
//                                type or the run it is in. So one changed
//                                slot runs two transitions again, the one
//                                into the period and the one out of it, and
//                                nothing else; a transition two runs or two
//                                day types have alike is worked out once;
//                                and one whose passing time alone differs is
//                                retimed (crowd.js retimeTransition) rather
//                                than simulated, unless a group reaches the
//                                cap
//   a run's loads                kept while building is the same and nobody's
//                                walk or head count in that run has changed
//   walk results, findings       worked out again unless all three counters
//                                are the same
//
// Left without counters, run(project) keeps nothing and works everything out.
// A part that was kept is the same object as last time, so a screen can tell
// what to redraw with `===`.
//
// createPipeline({ cache }) makes a pipeline that shares another's route
// cache (pipeline.cache): its distance fields are kept by the geometry
// counter alone, so two pipelines asked about two schedules of one building
// search each field once between them. Everything else a pipeline keeps is
// its own, so each pipeline's counters only have to be consistent with
// themselves. Left out, a cache of its own, as before.
//
// It works by run (ARCHITECTURE 17.8): each own day type with its regular
// bells, then each with each bell schedule (engine/runs.js runsOf). A run
// with regular bells is keyed by its day type id and shaped exactly as a day
// type was before bell schedules, so a project with no bell schedules gets
// the very result it got then (test/engine/runs-today.test.mjs). The
// bell-schedule runs sit beside the regular ones, each entry carrying its
// bellsId, and only when there is a bell schedule: routes.bells,
// crowd.bells, bellLoads and walks.bells. runResults(result, dayTypeId,
// bellsId) picks one run's parts out.
//
// The result:
//
//   { versions,           the counters it was worked out for, or null
//     routes,             routesByRun() (crowd.js): { days, bells?, … }
//     crowd,              simulateSchedule(): { days: [{ dayTypeId, transitions }],
//                         bells?: [{ dayTypeId, bellsId, transitions }] }
//     loads,              [loads() for each own day type, in order]
//     bellLoads,          [loads() for each bell-schedule run, in runsOf's
//                         order], only when there is one
//     places,             places()
//     walks,              walkResults(): { groups, teachers, bells?: { groups, teachers } }
//     findings,           checkSchedule(project, walks): { findings, accepted, gone }
//     buildingFindings,   buildingChecks()
//     work }              what this run had to do: { run, searches,
//                         transitions, transitionsRun, loadsRun,
//                         routesRun, buildingRun }
//
// The worker. Loaded as a module worker, this file answers messages:
//
//   out   { type: 'sv2-worker-ready' }      once, when the file and all it
//                                           imports have loaded
//   in    { type: 'sv2-derive', generation, project, versions }
//   out   { type: 'sv2-derived', generation, ok: true, answer }
//         { type: 'sv2-derived', generation, ok: false, error }
//
//   in    { type: 'sv2-derive-scenario', generation, project, versions }
//   out   { type: 'sv2-derived-scenario', generation, ok, answer | error }
//         answer is scenarioRun(): trimResult() (engine/scenario.js) of the
//         project with its open scenario applied, { places, loads, walks,
//         findings, failedWalks }; never routes or crowd positions
//   in    { type: 'sv2-suggest', generation, project, versions, finding, options }
//   out   { type: 'sv2-suggested', generation, ok, answer | error }
//         answer is suggest() (engine/suggest.js): { suggestions, none }
//
//   in    { type: 'sv2-derive-kept', generation, project, scenario, versions }
//   out   { type: 'sv2-derived-kept', generation, ok, answer | error }
//         answer is keptRun(): trimResult() of the project as the kept
//         scenario `scenario` (one of project.scenarios) would make it,
//         under that scenario's building levers as route options
//   in    { type: 'sv2-derive-other', generation, comparison, project?, versions }
//   out   { type: 'sv2-derived-other', generation, ok, answer | error }
//         answer is otherRun(): trimResult() of the other building's project
//         as it is (its own scenarios are never applied). `project` goes
//         with the first request of a comparison only (`comparison` is the
//         page's number for it); the worker keeps the last one it was sent,
//         and a request for another comparison with no project is refused
//   in    { type: 'sv2-other-close' }
//         the comparison ended: the held project and the other pipeline's
//         routes, crowd and route cache are let go. No answer.
//
// Five lanes have a pipeline each. The scenario, suggestion and kept
// pipelines share the main one's route cache; the other-building pipeline
// has a cache of its own, so one building's routes can never be served for
// the other's (ARCHITECTURE 21.3, 21.10). The main lane's pipeline is
// never handed a scenario's project or a suggestion's candidate, so its
// answers and what it keeps are exactly what they were with one lane. The
// scenario lane's `versions` are the page's own counters for that lane
// (ui/engine-client.js makes them: its schedule counter moves when the
// store's does or when project.scenario is another object); suggest puts
// every run of its own under a schedule counter below zero.
//
// `answer` is the result with every part the worker's previous answer already
// carried left out (pack): a whole part, one group's routes, one transition,
// one day type's loads. Copying every route of the big fixture across takes
// about 100 ms, more than working out a one-slot change does. The page puts the parts back from the answer before
// (unpack). Both halves of that rule are here so they cannot drift.

import { bellsFor } from './bells.js';
import { runsOf } from './runs.js';
import { routingGraph, runRoutes, createRouteCache } from './routing.js';
import { releaseOf } from './schema.js';
import { releaseDelay } from './release.js';
import { simulateDayTransition, walkResults, routesByRun, retimeTransition, transitionAs, transitionPlan } from './crowd.js';
import { loads } from './load.js';
import { places } from './places.js';
import { checkSchedule } from './checks.js';
import { buildingChecks } from './building-checks.js';
import { scenarioInputs, trimResult } from './scenario.js';
import { suggest } from './suggest.js';

export const REQUEST = 'sv2-derive';
export const ANSWER = 'sv2-derived';
export const READY = 'sv2-worker-ready';
export const SCENARIO_REQUEST = 'sv2-derive-scenario';
export const SCENARIO_ANSWER = 'sv2-derived-scenario';
export const SUGGEST_REQUEST = 'sv2-suggest';
export const SUGGEST_ANSWER = 'sv2-suggested';
export const KEPT_REQUEST = 'sv2-derive-kept';
export const KEPT_ANSWER = 'sv2-derived-kept';
export const OTHER_REQUEST = 'sv2-derive-other';
export const OTHER_ANSWER = 'sv2-derived-other';
export const OTHER_CLOSE = 'sv2-other-close';

// The parts of a result that are kept or sent whole.
export const WHOLE_PARTS = ['places', 'walks', 'findings', 'buildingFindings'];

// The counters a run is worked out for. Three are the store's (geometry,
// building, schedule); a fourth, `levers`, is the scenario lane's alone
// (ARCHITECTURE 18.3): it moves when the building levers' route options do,
// and the other lanes leave it out, which reads as 0 and is not added to the
// counters handed back, so their answers' `versions` are what they were.
// All that are given must be integers.
function countersOf(versions) {
  if (!versions) return null;
  const { geometry, building, schedule } = versions;
  const given = versions.levers !== undefined;
  if (![geometry, building, schedule].concat(given ? [versions.levers] : []).every((value) => Number.isInteger(value))) return null;
  return given ? { geometry, building, schedule, levers: versions.levers } : { geometry, building, schedule };
}

// The route options a lane's building levers mean, as routing.js takes them:
// leverRouteOptions' { ways, shutLinks, shutCells } with the closed
// connections as avoidConnections. Nothing for none, so a lane without
// building levers hands routing exactly the options it always did.
function leverOptionsOf(levers) {
  if (!levers) return {};
  const options = {};
  if (levers.ways && Object.keys(levers.ways).length > 0) options.ways = levers.ways;
  if (Array.isArray(levers.shutLinks) && levers.shutLinks.length > 0) options.avoidConnections = levers.shutLinks;
  if (Array.isArray(levers.shutCells) && levers.shutCells.length > 0) options.shutCells = levers.shutCells;
  return options;
}

// Who walks where in one transition of one day, and how many they are: the
// part of a transition that the crowd model and the loads both read.
function walkKey(project, dayRoutes, period, headCounts) {
  const pieces = [];
  for (const entry of dayRoutes.groups) {
    const way = entry.routes[period];
    if (!headCounts.has(entry.groupId) || !way || way.ok !== true || way.same === true) continue;
    pieces.push(entry.groupId + ':' + headCounts.get(entry.groupId) + ':' + way.fromRoomId + '>' + way.toRoomId);
  }
  return pieces.join(';');
}

// How long each walking group waits after the bell in one transition of one
// day (staggered dismissal, ARCHITECTURE 18.2), as the part of the walkers'
// key the delay adds: '' when nobody waits, so a project with no release keeps
// the keys it always had. It is not in walkKey, which also keys the loads: a
// delay moves no load.
function delayKey(project, dayRoutes, dayTypeId, period) {
  const pieces = [];
  for (const entry of dayRoutes.groups) {
    const way = entry.routes[period];
    if (!way || way.ok !== true || way.same === true) continue;
    const delay = releaseDelay(project, entry.groupId, dayTypeId, period, way.fromRoomId);
    if (delay > 0) pieces.push(entry.groupId + ':' + delay);
  }
  return pieces.join(';');
}

// A run's key in what a pipeline keeps: the day type id for regular bells,
// as before bell schedules; the day type and the schedule otherwise.
function runKey(dayTypeId, bellsId) {
  return typeof bellsId === 'string' ? dayTypeId + '\u0000' + bellsId : dayTypeId;
}

function sameRun(a, b) {
  return a.dayTypeId === b.dayTypeId && (typeof a.bellsId === 'string' ? a.bellsId : null) === (typeof b.bellsId === 'string' ? b.bellsId : null);
}

export function createPipeline(options) {
  const given = options && options.cache;
  const cache = given || createRouteCache();
  let held = null;
  let runs = 0;

  // run(project, versions, levers?): `levers` is leverRouteOptions' answer for
  // the building levers of this project's scenario, or left out. The routes
  // and the walks of teachers are worked out under them, and the geometry
  // that "the same" means includes them: the `levers` counter says whether
  // they are the ones the last run had.
  function run(project, versions, levers) {
    const counters = countersOf(versions);
    const before = held && held.counters && counters ? held : null;
    const sameGeometry = before !== null && before.counters.geometry === counters.geometry && (before.counters.levers || 0) === (counters.levers || 0);
    const sameBuilding = sameGeometry && before.counters.building === counters.building;
    const sameSchedule = before !== null && before.counters.schedule === counters.schedule;
    if (sameBuilding && sameSchedule) return before.result;

    runs += 1;
    const work = { run: runs, searches: 0, transitions: 0, transitionsRun: 0, loadsRun: 0, routesRun: false, buildingRun: !sameBuilding };

    const graph = sameBuilding ? before.graph : routingGraph(project);
    const routeOptions = { ...(counters ? { cache, geometryVersion: counters.geometry } : { cache }), ...leverOptionsOf(levers) };

    let routes;
    if (sameGeometry && sameSchedule) {
      routes = before.result.routes;
    } else {
      routes = routesByRun(project, graph, routeOptions);
      work.searches = routes.searches;
      work.routesRun = true;
    }

    const settings = project.settings;
    const margin = settings.checks ? settings.checks.passingMarginSeconds : 0;
    // a group's head count, and '!' after it when it needs step-free routes:
    // that flag changes its routes and so its figures without changing its
    // rooms, so it is in the walk key, the walker key and the slot key that
    // are built from this (ARCHITECTURE 19.5); nothing is added for a group
    // without it, so a project with none keeps the keys it always had
    const headCounts = new Map(project.groups.map((group) => [group.id, (group.headCount === null || group.headCount === undefined ? 'd' + settings.defaultHeadCount : String(group.headCount)) + (group.stepFree === true ? '!' : '')]));
    const counted = Array.from(headCounts.values()).join(',');

    // The transitions worked out, by what they are: the walkers (who walks
    // from which room to which, how many they are) and the margin, then the
    // passing time ('off' for a transition into or out of a period that does
    // not meet). Kept while the geometry is the same, so a transition that is
    // the same in two runs, or in two day types, is worked out once, and one
    // under another passing time is retimed when nothing but `late` changes.
    const contents = new Map();
    const hasRelease = releaseOf(project).length > 0;
    const earlier = sameGeometry ? before.contents : null;
    const contentOf = (walkers, passing, make) => {
      const what = margin + '|' + walkers;
      if (!contents.has(what)) contents.set(what, new Map(earlier && earlier.has(what) ? earlier.get(what) : []));
      const known = contents.get(what);
      if (known.has(passing)) return known.get(passing);
      // an off transition is never a met one retimed, even with the same
      // walkers (nobody): it says off: true and has no passing time
      if (passing !== 'off') for (const result of known.values()) {
        const retimed = retimeTransition(result, passing, margin);
        if (retimed) {
          known.set(passing, retimed);
          return retimed;
        }
      }
      const made = make();
      known.set(passing, made);
      work.transitionsRun += 1;
      return made;
    };

    const crowdDays = [];
    const crowdBells = [];
    const loadList = [];
    const bellLoads = [];
    const keys = new Map();
    let crowdKept = before !== null;
    const wasCrowd = before ? before.result.crowd : null;
    for (const { dayTypeId, bellsId } of runsOf(project)) {
      const dayRoutes = runRoutes(routes, dayTypeId, bellsId);
      if (!dayRoutes) continue;
      const regular = bellsId === null;
      const bells = regular ? bellsFor(project, dayTypeId) : bellsFor(project, dayTypeId, bellsId);
      const key = runKey(dayTypeId, bellsId);
      const was = before ? before.keys.get(key) : undefined;
      const wasList = wasCrowd ? (regular ? wasCrowd.days : wasCrowd.bells || []) : [];
      const wasDay = was && sameGeometry ? wasList.find((day) => sameRun(day, { dayTypeId, bellsId })) : undefined;
      const dayKeys = { transitions: [], load: '' };
      const walkKeys = [];
      const transitions = [];
      let dayKept = wasDay !== undefined && wasDay.transitions.length === settings.periods - 1;
      for (let period = 0; period + 1 < settings.periods; period += 1) {
        const rooms = walkKey(project, dayRoutes, period, headCounts);
        const plan = transitionPlan(project, bells, period);
        const passing = plan === null ? 'off' : plan.passing;
        // a walk across periods that do not meet is its own kind of
        // transition: never a next-door one retimed, and kept per period reached
        const delays = hasRelease ? delayKey(project, dayRoutes, dayTypeId, period) : '';
        const held = delays === '' ? rooms : rooms + '#' + delays;
        const walkers = plan !== null && plan.to !== period + 1 ? held + '@' + plan.to : held;
        const slotKey = passing + '|' + margin + '|' + walkers;
        walkKeys.push(rooms);
        dayKeys.transitions.push(slotKey);
        work.transitions += 1;
        if (wasDay && was.transitions[period] === slotKey && wasDay.transitions[period]) {
          const kept = wasDay.transitions[period];
          transitions.push(kept);
          const what = margin + '|' + walkers;
          if (!contents.has(what)) contents.set(what, new Map(earlier && earlier.has(what) ? earlier.get(what) : []));
          if (!contents.get(what).has(passing)) contents.get(what).set(passing, kept);
        } else {
          const result = contentOf(walkers, passing, () => simulateDayTransition(project, routes, dayTypeId, period, graph, regular ? undefined : bellsId));
          transitions.push(transitionAs(result, dayTypeId, period, bellsId));
          dayKept = false;
        }
      }
      const day = regular ? { dayTypeId, transitions } : { dayTypeId, bellsId, transitions };
      if (dayKept) {
        (regular ? crowdDays : crowdBells).push(wasDay);
      } else {
        (regular ? crowdDays : crowdBells).push(day);
        crowdKept = false;
      }

      dayKeys.load = counted + '|' + walkKeys.join('|');
      const wasLoads = before && sameBuilding ? (regular ? before.result.loads : before.result.bellLoads || []) : [];
      const wasLoad = was ? wasLoads.find((load) => sameRun(load, { dayTypeId, bellsId })) : undefined;
      if (wasLoad && was.load === dayKeys.load) {
        (regular ? loadList : bellLoads).push(wasLoad);
      } else {
        (regular ? loadList : bellLoads).push(loads(project, routes, dayTypeId, graph, regular ? undefined : bellsId));
        work.loadsRun += 1;
      }
      keys.set(key, dayKeys);
    }
    if (before && (wasCrowd.days.length !== crowdDays.length || (wasCrowd.bells || []).length !== crowdBells.length)) crowdKept = false;
    let crowd;
    if (crowdKept) {
      crowd = wasCrowd;
    } else {
      crowd = { days: crowdDays };
      if (crowdBells.length > 0) crowd.bells = crowdBells;
    }

    const walks = walkResults(project, crowd, graph, routeOptions);
    const result = {
      versions: counters,
      routes,
      crowd,
      loads: loadList,
    };
    if (bellLoads.length > 0) result.bellLoads = bellLoads;
    result.places = sameBuilding ? before.result.places : places(project, graph);
    result.walks = walks;
    result.findings = checkSchedule(project, walks);
    result.buildingFindings = sameBuilding ? before.result.buildingFindings : buildingChecks(project, graph);
    result.work = work;
    held = { counters, graph, keys, contents, result };
    return result;
  }

  return {
    run,
    // the route cache, for a pipeline that is to share it
    cache,
    // Forget everything: the next run works it all out. A cache handed in
    // is the pipeline's that made it, and stays as it is.
    clear() {
      held = null;
      if (given) return;
      cache.fields.clear();
      cache.routes.clear();
      cache.bytes = 0;
      cache.stamp = undefined;
    },
  };
}

// One run's parts of a pipeline result (or of a scenario lane's trimmed
// one, which has no routes or crowd): { routes, crowd, loads, walks: {
// groups, teachers } }, each null (or empty lists) where the result has
// none. dayTypeId is the run's own day type (a day type that is the same as
// A Day is A Day's runs: ask effectiveDayType first); bellsId null or left
// out is the regular bells.
export function runResults(result, dayTypeId, bellsId) {
  const run = { dayTypeId, bellsId: typeof bellsId === 'string' ? bellsId : null };
  const regular = run.bellsId === null;
  const pick = (list) => (Array.isArray(list) ? list.find((entry) => entry && sameRun(entry, run)) || null : null);
  const walks = result && result.walks ? (regular ? result.walks : result.walks.bells) : null;
  const mine = (list) => (Array.isArray(list) ? list.filter((walk) => sameRun(walk, run)) : []);
  return {
    routes: result && result.routes ? pick(regular ? result.routes.days : result.routes.bells) : null,
    crowd: result && result.crowd ? pick(regular ? result.crowd.days : result.crowd.bells) : null,
    loads: result ? pick(regular ? result.loads : result.bellLoads) : null,
    walks: { groups: mine(walks ? walks.groups : null), teachers: mine(walks ? walks.teachers : null) },
  };
}

// The scenario lane's answer: the project with its open scenario's changes
// applied and then its levers (applyLevers: bells, leaving late, seats and
// head counts), run with the building levers as route options
// (leverRouteOptions: a stair one way or closed, closed corridor cells; the
// building itself is never edited, ARCHITECTURE 18.3). Only those that still apply go in (reconcile, which leaves
// out a change or lever whose group, room, day type or period is gone, one a
// later one replaces, and one the schedule already has), run on `pipeline`, trimmed
// to what compareResults reads. The project handed in is not changed. With
// no scenario open, the project as it is. It is keptRun of the open scenario,
// so the open and the kept runs cannot drift apart.
export function scenarioRun(pipeline, project, versions) {
  return keptRun(pipeline, project, project.scenario, versions);
}

// The suggestion lane's answer: suggest() run on `pipeline`, which must not
// be the main lane's (engine/suggest.js, "Counters"). `versions` are the
// store's; suggest reads only their geometry and building counters.
export function suggestRun(pipeline, project, versions, finding, options) {
  const opts = options || {};
  return suggest(project, finding, { pipeline, versions: countersOf(versions), otherTeachersRooms: opts.otherTeachersRooms === true, limit: opts.limit });
}

// The kept-scenario lane's answer (ARCHITECTURE 21.2, 21.10): the project as
// the kept scenario `scenario` would make it (scenarioInputs: the changes
// that still apply, then its levers that do), run with that scenario's
// building levers as route options, trimmed to what compareResults reads.
// Run on its own pipeline (which may share the main lane's route cache).
// The project and the scenario handed in are not changed; `scenario` need
// not be the open one, and the project's open scenario is not read.
export function keptRun(pipeline, project, scenario, versions) {
  const inputs = scenarioInputs(project, scenario);
  return trimResult(pipeline.run(inputs.project, versions, inputs.routeOptions));
}

// The other-building lane's answer (ARCHITECTURE 21.3, 21.10): the other
// project as it is, run on a pipeline whose route cache is its own,
// trimmed. Its scenarios, open or kept, are not applied: the comparison is
// of the two buildings and their schedules, not of anyone's trials.
export function otherRun(pipeline, project, versions) {
  return trimResult(pipeline.run(project, versions));
}

// Is this the route the other side already has? A route that was walked is
// one object for as long as the geometry stands (the route cache hands the
// same one out). "The same room" and the failures are small and made afresh
// each time, so those are compared by what they say.
function sameRoute(found, before) {
  if (found === before) return true;
  const walked = (way) => way.ok === true && way.same !== true;
  if (walked(found) || walked(before)) return false;
  return JSON.stringify(found) === JSON.stringify(before);
}

// A list of runs (routes.days, routes.bells, crowd.days, crowd.bells) as
// sent: each run's entry with the parts the other side already has as null.
function packRuns(list, previousList, packOne) {
  return list.map((entry) => {
    const was = (previousList || []).find((other) => sameRun(other, entry));
    return packOne(entry, was);
  });
}

function packRouteDay(day, was) {
  const wasGroups = new Map(was ? was.groups.map((group) => [group.groupId, group.routes]) : []);
  const head = typeof day.bellsId === 'string' ? { dayTypeId: day.dayTypeId, bellsId: day.bellsId } : { dayTypeId: day.dayTypeId };
  return {
    ...head,
    groups: day.groups.map((group) => {
      const before = wasGroups.get(group.groupId);
      const same = before !== undefined && before.length === group.routes.length && group.routes.every((found, t) => sameRoute(found, before[t]));
      return { groupId: group.groupId, routes: same ? null : group.routes };
    }),
  };
}

function packCrowdDay(day, was) {
  const head = typeof day.bellsId === 'string' ? { dayTypeId: day.dayTypeId, bellsId: day.bellsId } : { dayTypeId: day.dayTypeId };
  return { ...head, transitions: day.transitions.map((transition, period) => (was && was.transitions[period] === transition ? null : transition)) };
}

function packLoads(list, previousList) {
  return list.map((load) => {
    if (!previousList || !previousList.includes(load)) return load;
    return typeof load.bellsId === 'string' ? { dayTypeId: load.dayTypeId, bellsId: load.bellsId, kept: true } : { dayTypeId: load.dayTypeId, kept: true };
  });
}

// What to send for `result` when the other side already has `previous` (the
// result sent before, or null). A part that is the same object is left out.
// The bell-schedule runs (routes.bells, crowd.bells, bellLoads) go as the
// regular ones do, run by run.
export function pack(result, previous) {
  const answer = { versions: result.versions, work: result.work, kept: [], routes: null, crowd: null, loads: null };
  for (const part of WHOLE_PARTS) {
    if (previous && previous[part] === result[part]) answer.kept.push(part);
    else answer[part] = result[part];
  }
  // Routes go group by group: a group whose every walk is the route object
  // it was last time is left out, so one changed slot sends one group's day.
  if (previous && previous.routes === result.routes) {
    answer.kept.push('routes');
  } else {
    answer.routes = { ...result.routes, days: packRuns(result.routes.days, previous ? previous.routes.days : null, packRouteDay) };
    if (Array.isArray(result.routes.bells)) answer.routes.bells = packRuns(result.routes.bells, previous ? previous.routes.bells : null, packRouteDay);
  }
  if (previous && previous.crowd === result.crowd) {
    answer.kept.push('crowd');
  } else {
    answer.crowd = packRuns(result.crowd.days, previous ? previous.crowd.days : null, packCrowdDay);
    if (Array.isArray(result.crowd.bells)) answer.crowdBells = packRuns(result.crowd.bells, previous ? previous.crowd.bells : null, packCrowdDay);
  }
  answer.loads = packLoads(result.loads, previous ? previous.loads : null);
  if (Array.isArray(result.bellLoads)) answer.bellLoads = packLoads(result.bellLoads, previous ? previous.bellLoads : null);
  return answer;
}

// The result an answer stands for, given the result the answer before it
// stood for. Kept parts are the same objects as in `previous`.
export function unpack(answer, previous) {
  const need = (found, what) => {
    if (found === undefined || found === null) throw new Error('The answer keeps ' + what + ' from an answer this side never had.');
    return found;
  };
  const was = (list, entry) => (Array.isArray(list) ? list.find((other) => sameRun(other, entry)) : undefined);
  const result = { versions: answer.versions, work: answer.work };
  for (const part of WHOLE_PARTS) {
    result[part] = answer.kept.includes(part) ? need(previous && previous[part], part) : answer[part];
  }
  const routeDay = (list) => (day) => {
    const before = was(list, day);
    const head = typeof day.bellsId === 'string' ? { dayTypeId: day.dayTypeId, bellsId: day.bellsId } : { dayTypeId: day.dayTypeId };
    return {
      ...head,
      groups: day.groups.map((group) => {
        if (group.routes !== null) return group;
        return need(before && before.groups.find((other) => other.groupId === group.groupId), 'a group\'s routes');
      }),
    };
  };
  if (answer.kept.includes('routes')) {
    result.routes = need(previous && previous.routes, 'routes');
  } else {
    result.routes = { ...answer.routes, days: answer.routes.days.map(routeDay(previous ? previous.routes.days : null)) };
    if (Array.isArray(answer.routes.bells)) result.routes.bells = answer.routes.bells.map(routeDay(previous ? previous.routes.bells : null));
  }
  const crowdDay = (list) => (day) => {
    const before = was(list, day);
    // a day with nothing new in it is the day this side already has
    if (before && before.transitions.length === day.transitions.length && day.transitions.every((transition) => transition === null)) return before;
    const head = typeof day.bellsId === 'string' ? { dayTypeId: day.dayTypeId, bellsId: day.bellsId } : { dayTypeId: day.dayTypeId };
    return { ...head, transitions: day.transitions.map((transition, period) => (transition === null ? need(before && before.transitions[period], 'a transition') : transition)) };
  };
  if (answer.kept.includes('crowd')) {
    result.crowd = need(previous && previous.crowd, 'crowd');
  } else {
    result.crowd = { days: answer.crowd.map(crowdDay(previous ? previous.crowd.days : null)) };
    if (Array.isArray(answer.crowdBells)) result.crowd.bells = answer.crowdBells.map(crowdDay(previous ? previous.crowd.bells : null));
  }
  const loadsOf = (list, previousList) => list.map((load) => (load.kept === true ? need(was(previousList, load), 'loads') : load));
  result.loads = loadsOf(answer.loads, previous ? previous.loads : null);
  if (Array.isArray(answer.bellLoads)) result.bellLoads = loadsOf(answer.bellLoads, previous ? previous.bellLoads : null);
  return result;
}

// In a worker, answer requests. Anywhere else this file only exports.
const scope = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope ? self : null;

if (scope) {
  const pipeline = createPipeline();
  const scenarioPipeline = createPipeline({ cache: pipeline.cache });
  const suggestionPipeline = createPipeline({ cache: pipeline.cache });
  const keptPipeline = createPipeline({ cache: pipeline.cache });
  // no cache argument: the other building's routes are kept apart from this one's
  const otherPipeline = createPipeline();
  let otherHeld = null; // { comparison, project }: the last one sent
  let sent = null;
  const said = (error) => (error && error.message ? String(error.message) : String(error));
  scope.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === SCENARIO_REQUEST) {
      try {
        const answer = scenarioRun(scenarioPipeline, message.project, message.versions);
        scope.postMessage({ type: SCENARIO_ANSWER, generation: message.generation, ok: true, answer });
      } catch (error) {
        scenarioPipeline.clear();
        scope.postMessage({ type: SCENARIO_ANSWER, generation: message.generation, ok: false, error: said(error) });
      }
      return;
    }
    if (message && message.type === KEPT_REQUEST) {
      try {
        const answer = keptRun(keptPipeline, message.project, message.scenario, message.versions);
        scope.postMessage({ type: KEPT_ANSWER, generation: message.generation, ok: true, answer });
      } catch (error) {
        keptPipeline.clear();
        scope.postMessage({ type: KEPT_ANSWER, generation: message.generation, ok: false, error: said(error) });
      }
      return;
    }
    if (message && message.type === OTHER_REQUEST) {
      try {
        if (message.project !== undefined) otherHeld = { comparison: message.comparison, project: message.project };
        if (!otherHeld || otherHeld.comparison !== message.comparison) throw new Error('The other project was not sent to this worker.');
        const answer = otherRun(otherPipeline, otherHeld.project, message.versions);
        scope.postMessage({ type: OTHER_ANSWER, generation: message.generation, ok: true, answer });
      } catch (error) {
        otherPipeline.clear();
        scope.postMessage({ type: OTHER_ANSWER, generation: message.generation, ok: false, error: said(error) });
      }
      return;
    }
    if (message && message.type === OTHER_CLOSE) {
      otherHeld = null;
      otherPipeline.clear();
      return;
    }
    if (message && message.type === SUGGEST_REQUEST) {
      try {
        const answer = suggestRun(suggestionPipeline, message.project, message.versions, message.finding, message.options);
        scope.postMessage({ type: SUGGEST_ANSWER, generation: message.generation, ok: true, answer });
      } catch (error) {
        suggestionPipeline.clear();
        scope.postMessage({ type: SUGGEST_ANSWER, generation: message.generation, ok: false, error: said(error) });
      }
      return;
    }
    if (!message || message.type !== REQUEST) return;
    try {
      const result = pipeline.run(message.project, message.versions);
      const answer = pack(result, sent);
      sent = result;
      scope.postMessage({ type: ANSWER, generation: message.generation, ok: true, answer });
    } catch (error) {
      // the page starts again from nothing after a failure, so this side does too
      pipeline.clear();
      sent = null;
      scope.postMessage({ type: ANSWER, generation: message.generation, ok: false, error: said(error) });
    }
  });
  // a worker whose imports never arrive says nothing, and the page stops waiting for it
  scope.postMessage({ type: READY });
}
