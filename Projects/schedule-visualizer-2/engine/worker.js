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
//
// The three numbers are the store's counters (store.geometryVersion,
// .buildingVersion, .scheduleVersion). A pipeline remembers its last answer
// and works out again only what the counters say could have changed:
//
//   routes and distance fields   kept while geometry is the same (a new
//                                schedule is routed again from the kept
//                                fields, which searches nothing)
//   places, building findings    kept while building is the same
//   a transition's crowd result  kept while geometry is the same and the
//                                transition has the same walkers going the
//                                same ways with the same head counts in the
//                                same passing time. So one changed slot runs
//                                two transitions again, the one into the
//                                period and the one out of it, and nothing
//                                else.
//   a day type's loads           kept while building is the same and nobody's
//                                walk or head count on that day has changed
//   walk results, findings       worked out again unless all three counters
//                                are the same
//
// Left without counters, run(project) keeps nothing and works everything out.
// A part that was kept is the same object as last time, so a screen can tell
// what to redraw with `===`.
//
// The result:
//
//   { versions,           the counters it was worked out for, or null
//     routes,             routesForSchedule()
//     crowd,              simulateSchedule(): { days: [{ dayTypeId, transitions }] }
//     loads,              [loads() for each own day type, in order]
//     places,             places()
//     walks,              walkResults(): { groups, teachers }
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
// `answer` is the result with every part the worker's previous answer already
// carried left out (pack): a whole part, one group's routes, one transition,
// one day type's loads. Copying every route of the big fixture across takes
// about 100 ms, more than working out a one-slot change does. The page puts the parts back from the answer before
// (unpack). Both halves of that rule are here so they cannot drift.

import { ownDayTypes } from './day-types.js';
import { bellsFor } from './bells.js';
import { routingGraph, routesForSchedule, createRouteCache } from './routing.js';
import { simulateDayTransition, walkResults } from './crowd.js';
import { loads } from './load.js';
import { places } from './places.js';
import { checkSchedule } from './checks.js';
import { buildingChecks } from './building-checks.js';

export const REQUEST = 'sv2-derive';
export const ANSWER = 'sv2-derived';
export const READY = 'sv2-worker-ready';

// The parts of a result that are kept or sent whole.
export const WHOLE_PARTS = ['places', 'walks', 'findings', 'buildingFindings'];

function countersOf(versions) {
  if (!versions) return null;
  const { geometry, building, schedule } = versions;
  if (![geometry, building, schedule].every((value) => Number.isInteger(value))) return null;
  return { geometry, building, schedule };
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

export function createPipeline() {
  const cache = createRouteCache();
  let held = null;
  let runs = 0;

  function run(project, versions) {
    const counters = countersOf(versions);
    const before = held && held.counters && counters ? held : null;
    const sameGeometry = before !== null && before.counters.geometry === counters.geometry;
    const sameBuilding = sameGeometry && before.counters.building === counters.building;
    const sameSchedule = before !== null && before.counters.schedule === counters.schedule;
    if (sameBuilding && sameSchedule) return before.result;

    runs += 1;
    const work = { run: runs, searches: 0, transitions: 0, transitionsRun: 0, loadsRun: 0, routesRun: false, buildingRun: !sameBuilding };

    const graph = sameBuilding ? before.graph : routingGraph(project);
    const routeOptions = counters ? { cache, geometryVersion: counters.geometry } : { cache };

    let routes;
    if (sameGeometry && sameSchedule) {
      routes = before.result.routes;
    } else {
      routes = routesForSchedule(project, graph, routeOptions);
      work.searches = routes.searches;
      work.routesRun = true;
    }

    const settings = project.settings;
    const margin = settings.checks ? settings.checks.passingMarginSeconds : 0;
    const headCounts = new Map(project.groups.map((group) => [group.id, group.headCount === null || group.headCount === undefined ? 'd' + settings.defaultHeadCount : String(group.headCount)]));
    const counted = Array.from(headCounts.values()).join(',');

    const crowdDays = [];
    const loadList = [];
    const keys = new Map();
    let crowdKept = before !== null;
    for (const dayType of ownDayTypes(project)) {
      const dayRoutes = routes.days.find((day) => day.dayTypeId === dayType.id);
      if (!dayRoutes) continue;
      const bells = bellsFor(project, dayType.id);
      const was = before ? before.keys.get(dayType.id) : undefined;
      const wasDay = was && sameGeometry ? before.result.crowd.days.find((day) => day.dayTypeId === dayType.id) : undefined;
      const dayKeys = { transitions: [], load: '' };
      const walkKeys = [];
      const transitions = [];
      let dayKept = wasDay !== undefined && wasDay.transitions.length === settings.periods - 1;
      for (let period = 0; period + 1 < settings.periods; period += 1) {
        const walkers = walkKey(project, dayRoutes, period, headCounts);
        const key = bells[period].passingAfter + '|' + margin + '|' + walkers;
        walkKeys.push(walkers);
        dayKeys.transitions.push(key);
        work.transitions += 1;
        if (wasDay && was.transitions[period] === key && wasDay.transitions[period]) {
          transitions.push(wasDay.transitions[period]);
        } else {
          transitions.push(simulateDayTransition(project, routes, dayType.id, period, graph));
          work.transitionsRun += 1;
          dayKept = false;
        }
      }
      if (dayKept) {
        crowdDays.push(wasDay);
      } else {
        crowdDays.push({ dayTypeId: dayType.id, transitions });
        crowdKept = false;
      }

      dayKeys.load = counted + '|' + walkKeys.join('|');
      const wasLoad = was && sameBuilding ? before.result.loads.find((load) => load.dayTypeId === dayType.id) : undefined;
      if (wasLoad && was.load === dayKeys.load) {
        loadList.push(wasLoad);
      } else {
        loadList.push(loads(project, routes, dayType.id, graph));
        work.loadsRun += 1;
      }
      keys.set(dayType.id, dayKeys);
    }
    if (before && before.result.crowd.days.length !== crowdDays.length) crowdKept = false;
    const crowd = crowdKept ? before.result.crowd : { days: crowdDays };

    const walks = walkResults(project, crowd, graph, routeOptions);
    const result = {
      versions: counters,
      routes,
      crowd,
      loads: loadList,
      places: sameBuilding ? before.result.places : places(project, graph),
      walks,
      findings: checkSchedule(project, walks),
      buildingFindings: sameBuilding ? before.result.buildingFindings : buildingChecks(project, graph),
      work,
    };
    held = { counters, graph, keys, result };
    return result;
  }

  return {
    run,
    // Forget everything: the next run works it all out.
    clear() {
      held = null;
      cache.fields.clear();
      cache.routes.clear();
      cache.bytes = 0;
      cache.stamp = undefined;
    },
  };
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

// What to send for `result` when the other side already has `previous` (the
// result sent before, or null). A part that is the same object is left out.
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
    answer.routes = {
      ...result.routes,
      days: result.routes.days.map((day) => {
        const was = previous ? previous.routes.days.find((other) => other.dayTypeId === day.dayTypeId) : undefined;
        const wasGroups = new Map(was ? was.groups.map((group) => [group.groupId, group.routes]) : []);
        return {
          dayTypeId: day.dayTypeId,
          groups: day.groups.map((group) => {
            const before = wasGroups.get(group.groupId);
            const same = before !== undefined && before.length === group.routes.length && group.routes.every((found, t) => sameRoute(found, before[t]));
            return { groupId: group.groupId, routes: same ? null : group.routes };
          }),
        };
      }),
    };
  }
  if (previous && previous.crowd === result.crowd) {
    answer.kept.push('crowd');
  } else {
    answer.crowd = result.crowd.days.map((day) => {
      const was = previous ? previous.crowd.days.find((other) => other.dayTypeId === day.dayTypeId) : undefined;
      return {
        dayTypeId: day.dayTypeId,
        transitions: day.transitions.map((transition, period) => (was && was.transitions[period] === transition ? null : transition)),
      };
    });
  }
  answer.loads = result.loads.map((load) => (previous && previous.loads.includes(load) ? { dayTypeId: load.dayTypeId, kept: true } : load));
  return answer;
}

// The result an answer stands for, given the result the answer before it
// stood for. Kept parts are the same objects as in `previous`.
export function unpack(answer, previous) {
  const need = (found, what) => {
    if (found === undefined || found === null) throw new Error('The answer keeps ' + what + ' from an answer this side never had.');
    return found;
  };
  const result = { versions: answer.versions, work: answer.work };
  for (const part of WHOLE_PARTS) {
    result[part] = answer.kept.includes(part) ? need(previous && previous[part], part) : answer[part];
  }
  if (answer.kept.includes('routes')) {
    result.routes = need(previous && previous.routes, 'routes');
  } else {
    result.routes = {
      ...answer.routes,
      days: answer.routes.days.map((day) => {
        const was = previous ? previous.routes.days.find((other) => other.dayTypeId === day.dayTypeId) : undefined;
        return {
          dayTypeId: day.dayTypeId,
          groups: day.groups.map((group) => {
            if (group.routes !== null) return group;
            return need(was && was.groups.find((other) => other.groupId === group.groupId), 'a group\'s routes');
          }),
        };
      }),
    };
  }
  if (answer.kept.includes('crowd')) {
    result.crowd = need(previous && previous.crowd, 'crowd');
  } else {
    result.crowd = {
      days: answer.crowd.map((day) => {
        const was = previous ? previous.crowd.days.find((other) => other.dayTypeId === day.dayTypeId) : undefined;
        return {
          dayTypeId: day.dayTypeId,
          transitions: day.transitions.map((transition, period) => (transition === null ? need(was && was.transitions[period], 'a transition') : transition)),
        };
      }),
    };
  }
  result.loads = answer.loads.map((load) => (load.kept === true ? need(previous && previous.loads.find((other) => other.dayTypeId === load.dayTypeId), 'loads') : load));
  return result;
}

// In a worker, answer requests. Anywhere else this file only exports.
const scope = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope ? self : null;

if (scope) {
  const pipeline = createPipeline();
  let sent = null;
  scope.addEventListener('message', (event) => {
    const message = event.data;
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
      scope.postMessage({ type: ANSWER, generation: message.generation, ok: false, error: error && error.message ? String(error.message) : String(error) });
    }
  });
  // a worker whose imports never arrive says nothing, and the page stops waiting for it
  scope.postMessage({ type: READY });
}
